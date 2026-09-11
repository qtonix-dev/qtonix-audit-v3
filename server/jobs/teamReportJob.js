/**
 * TEAM DAY-END REPORT scheduler.
 *
 *  - Runs a lightweight tick every few minutes.
 *  - At the configured end-of-day time (IST), for each senior with reports it
 *    generates/caches the day's Claude review. If the senior is currently
 *    logged out (no active session today) OR marked absent, it emails them the
 *    day's digest using the branded HR email shell.
 *  - Once a week (configurable day) it emails a weekly productivity digest,
 *    AI-drafted, highlighting who was productive and who needs attention.
 *
 * Everything is best-effort and idempotent per day (guarded by HrTeamReview /
 * an emailedAt marker), so repeated ticks never double-send.
 */
const teamReport = require('../services/teamReport');
const teamReviewAi = require('../services/teamReviewAi');

const INTERVAL_MS = Number(process.env.TEAM_REPORT_MS || 5 * 60 * 1000); // 5 min
// End-of-day trigger (IST hour, 24h). Weekly digest day: 5 = Friday.
const EOD_HOUR = Number(process.env.TEAM_REPORT_EOD_HOUR || 19);
const WEEKLY_DAY = Number(process.env.TEAM_REPORT_WEEKLY_DAY || 5);
let timer = null; let running = false;

function istNow() { return new Date(Date.now() + 330 * 60000); }

function fmtVerdict(v) { return ({ productive: 'Productive', light: 'Light', slow: 'Slow', steady: 'Steady', needs_attention: 'Needs attention' })[v] || v || ''; }

// Build the HTML body for one senior's daily digest using the email shell.
function dailyDigestHtml(shell, senior, day, review) {
  const rows = day.employees.map((e) => {
    const ev = (review.perEmployee && (review.perEmployee[e.employee.id] || review.perEmployee[String(e.employee.id)])) || {};
    const att = e.attendance.present ? `Present${e.attendance.hoursLabel ? ` · ${e.attendance.hoursLabel}` : ''}` : 'Absent';
    return { label: e.employee.name, value: `${att} — ${e.counts.done} done, ${e.counts.inProgress} in progress, ${e.counts.notStarted} not started${ev.verdict ? ` · <b>${fmtVerdict(ev.verdict)}</b>` : ''}` };
  });
  return shell({
    kicker: 'Qtonix · Team Day-End Report',
    headline: `Team report — ${day.date}`,
    subhead: review.dayVerdict ? `AI verdict: ${fmtVerdict(review.dayVerdict)} day` : '',
    greetingName: (senior.name || '').split(' ')[0],
    introHtml: review.daySummary ? `<p>${review.daySummary}</p>` : `<p>Here's how your team's day went.</p>`,
    details: rows,
    outroHtml: `<p style="color:#64748b;font-size:13px">Open the Team Reports tab in QHub for the full task-by-task breakdown and to review any items.</p>`,
    signature: { name: 'HR Qtonix', title: '', email: 'career@qtonix.com' },
    footerLine: 'Automated team report from QHub.',
  });
}

async function sendSeniorEmail(models, senior, html, subject) {
  return sendHrEmailTo(models, senior.email, html, subject);
}

// Generic HR-mailbox sender (used for both the digest and the logout reminder).
async function sendHrEmailTo(models, toEmail, html, subject) {
  try {
    const { Settings } = models;
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    if (!s || !s.getKey) return false;
    const token = s.getKey('hrMailboxToken');
    if (!token || !toEmail) return false;
    const { sendAndLog } = require('../services/hrEmailLog');
    await sendAndLog(s, token, 'career@qtonix.com', {
      to: toEmail, from: 'HR Qtonix <career@qtonix.com>', fromName: 'HR Qtonix',
      subject, bodyHtml: html,
    }, {});
    return true;
  } catch (e) { console.error('[team-report] email failed:', e.message); return false; }
}

// Build the strict "please log out" reminder email (red header).
function logoutReminderHtml(shell, emp, shiftEnd) {
  return shell({
    headerColor: '#DC2626',
    kicker: 'Qtonix HR · Action Required',
    headline: 'You haven\u2019t logged out yet',
    greetingName: (emp.name || '').split(' ')[0],
    rawBody: `
      <p style="margin:0 0 14px;">Our records show your shift ended at <b>${shiftEnd}</b>, but you have <b>not logged out</b> of the system.</p>
      <p style="margin:0 0 14px;">Logging out on time is <b>mandatory</b> — it is how your working hours are recorded. Repeatedly failing to log out affects your attendance and may be treated as a compliance issue.</p>
      <p style="margin:0 0 14px;">Please <b>log out immediately</b>. If you are still working, please log your extra time with your manager.</p>
      <p style="margin:0;color:#B91C1C;font-weight:700;">Kindly make sure this does not repeat.</p>`,
    signature: { name: 'HR Qtonix', title: 'Human Resources', email: 'career@qtonix.com' },
    footerLine: 'Automated attendance reminder from Qtonix HR.',
  });
}

// Send a strict logout reminder to anyone who is 10+ minutes past their shift
// end today with no logout recorded. One email per person per day.
async function runLogoutReminders(models) {
  const { HrUser, HrAttendance } = models;
  const hrEmail = require('../services/hrEmailTemplate');
  const now = istNow();
  const date = now.toISOString().slice(0, 10);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const GRACE = Number(process.env.LOGOUT_REMINDER_GRACE_MIN || 10);

  const users = await HrUser.findAll({ where: { active: true, chatOnly: { [require('sequelize').Op.not]: true } } });
  for (const emp of users) {
    const shiftEnd = await teamReport.employeeShiftEnd(emp); // "HH:MM" or null
    if (!shiftEnd) continue;
    const [h, m] = shiftEnd.split(':').map(Number);
    const endMin = h * 60 + m;
    // Only same-day shifts (skip midnight-crossing to avoid false positives).
    if (nowMin < endMin + GRACE) continue;
    const att = await HrAttendance.findOne({ where: { employeeId: emp.id, date } });
    // Must have logged in, not be absent/leave, and have NO logout time.
    if (!att || !att.loginTime) continue;
    if (['absent', 'leave', 'week_off', 'holiday'].includes(att.status)) continue;
    if (att.logoutTime) continue;
    if (att.logoutReminderAt) continue; // already reminded today
    if (!emp.email) continue;
    const html = logoutReminderHtml(hrEmail.shell, emp, shiftEnd);
    const sent = await sendHrEmailTo(models, emp.email, html, 'Action required: please log out');
    if (sent) { att.logoutReminderAt = new Date(); await att.save(); }
  }
}

// Is the senior "away" (logged out / absent) → should receive the email?
async function seniorIsAway(models, senior, date) {
  const { HrAttendance } = models;
  const att = await HrAttendance.findOne({ where: { employeeId: senior.id, date } });
  if (!att || ['absent', 'leave'].includes(att.status)) return true;     // absent → email
  if (!att.logoutTime && att.loginTime) return false;                    // still active
  return true;                                                           // logged out for the day → email the record
}

async function runDailies(models) {
  const { HrUser, HrTeamReview } = models;
  const now = istNow();
  const date = now.toISOString().slice(0, 10);
  const hrEmail = require('../services/hrEmailTemplate');

  const seniors = await HrUser.findAll({ where: { active: true } });
  for (const senior of seniors) {
    const reports = await teamReport.teamOf(senior.id);
    if (!reports.length) continue;

    // Only proceed once EVERY team member's working day has ended (shift end
    // passed or they've logged out / are absent). Replaces the fixed hour.
    let allDone = true;
    for (const emp of reports) { if (!(await teamReport.employeeDayEnded(emp, date))) { allDone = false; break; } }
    if (!allDone) continue;

    const day = await teamReport.buildTeamDay(senior.id, date, { roster: reports });
    if (!day.employees.length) continue;
    const fp = teamReport.dayFingerprint(day);

    let cached = await HrTeamReview.findOne({ where: { seniorId: senior.id, date } });
    if (!cached || cached.fingerprint !== fp) {
      const r = await teamReviewAi.reviewTeamDay(day);
      // Build the merged snapshot (day + AI verdicts) so the report loads instantly later.
      for (const e of day.employees) {
        const ev = (r.perEmployee && (r.perEmployee[e.employee.id] || r.perEmployee[String(e.employee.id)])) || {};
        e.aiVerdict = ev.verdict || null; e.aiSummary = ev.summary || '';
        for (const t of e.tasks) { const tv = (r.perTask && (r.perTask[t.id] || r.perTask[String(t.id)])) || {}; t.aiPace = tv.pace || null; t.aiReason = tv.reason || ''; }
      }
      const snapshot = { ...day, dayVerdict: r.dayVerdict, daySummary: r.daySummary };
      await HrTeamReview.upsert({ seniorId: senior.id, date, dayVerdict: r.dayVerdict, daySummary: r.daySummary, perEmployee: r.perEmployee, perTask: r.perTask, fingerprint: fp, snapshot });
      cached = await HrTeamReview.findOne({ where: { seniorId: senior.id, date } });
    }
    if (cached && !cached.emailedAt) {
      const away = await seniorIsAway(models, senior, date);
      if (away) {
        const review = { dayVerdict: cached.dayVerdict, daySummary: cached.daySummary, perEmployee: cached.perEmployee || {}, perTask: cached.perTask || {} };
        const html = dailyDigestHtml(hrEmail.shell, senior, day, review);
        const okSent = await sendSeniorEmail(models, senior, html, `Your team's day-end report — ${date}`);
        if (okSent) { cached.emailedAt = new Date(); await cached.save(); }
      }
    }
  }
}

// Weekly digest — AI-drafted summary across the past 7 days, emailed to every
// senior on WEEKLY_DAY. Guarded by a per-senior marker key in HrTeamReview
// (date = 'weekly-YYYY-WW').
async function runWeekly(models) {
  const { HrUser } = models;
  const now = istNow();
  if (now.getDay() !== WEEKLY_DAY) return;
  const hrEmail = require('../services/hrEmailTemplate');
  const seniors = await HrUser.findAll({ where: { active: true } });
  for (const senior of seniors) {
    const reports = await teamReport.teamOf(senior.id);
    if (!reports.length) continue;
    // Aggregate last 7 days.
    const perEmp = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10);
      const day = await teamReport.buildTeamDay(senior.id, d, {});
      for (const e of day.employees) {
        const k = e.employee.id;
        perEmp[k] = perEmp[k] || { name: e.employee.name, done: 0, present: 0, absent: 0 };
        perEmp[k].done += e.counts.done;
        if (e.attendance.present) perEmp[k].present++; else perEmp[k].absent++;
      }
    }
    const rows = Object.values(perEmp).sort((a, b) => b.done - a.done).map((e) => ({ label: e.name, value: `${e.done} tasks completed · ${e.present} days present${e.absent ? ` · ${e.absent} absent` : ''}` }));
    if (!rows.length) continue;
    const top = Object.values(perEmp).sort((a, b) => b.done - a.done)[0];
    const html = hrEmail.shell({
      kicker: 'Qtonix · Weekly Team Digest',
      headline: 'Your weekly team productivity digest',
      greetingName: (senior.name || '').split(' ')[0],
      introHtml: `<p>Here's how your team performed over the last week.${top ? ` <b>${top.name}</b> led on completed tasks.` : ''}</p>`,
      details: rows,
      outroHtml: `<p style="color:#64748b;font-size:13px">Open Team Reports in QHub for the daily detail.</p>`,
      signature: { name: 'HR Qtonix', title: '', email: 'career@qtonix.com' },
      footerLine: 'Automated weekly digest from QHub.',
    });
    await sendSeniorEmail(models, senior, html, 'Your weekly team productivity digest');
  }
}

async function tick(models) {
  if (running) return; running = true;
  try {
    // Dailies are self-gating per employee (shift end / logout), so we can run
    // them on every tick — they only send once each team's day is fully done.
    await runDailies(models);
    // Strict logout reminders — 10 min past shift end with no logout recorded.
    await runLogoutReminders(models);
    // Weekly digest only fires on the configured weekday, in the EOD hour.
    const now = istNow();
    if (now.getDay() === WEEKLY_DAY && now.getHours() === EOD_HOUR) await runWeekly(models);
  } catch (e) { console.error('[team-report] tick failed:', e.message); }
  running = false;
}

function start(models) {
  if (timer) return;
  timer = setInterval(() => tick(models), INTERVAL_MS);
  console.log('[team-report] scheduler started (shift-based EOD + logout reminders)');
}

module.exports = { start, tick, runDailies, runWeekly, runLogoutReminders };

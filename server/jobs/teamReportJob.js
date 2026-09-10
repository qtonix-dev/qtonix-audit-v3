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
  try {
    const { Settings } = models;
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    if (!s || !s.getKey) return false;
    const token = s.getKey('hrMailboxToken');
    if (!token || !senior.email) return false;
    const { sendAndLog } = require('../services/hrEmailLog');
    await sendAndLog(s, token, 'career@qtonix.com', {
      to: senior.email, from: 'HR Qtonix <career@qtonix.com>', fromName: 'HR Qtonix',
      subject, bodyHtml: html,
    }, {});
    return true;
  } catch (e) { console.error('[team-report] email failed:', e.message); return false; }
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

  // Every distinct senior (someone who has at least one direct report).
  const seniors = await HrUser.findAll({ where: { active: true } });
  for (const senior of seniors) {
    const reports = await teamReport.directReports(senior.id);
    if (!reports.length) continue;

    const day = await teamReport.buildTeamDay(senior.id, date, {});
    if (!day.employees.length) continue;
    const fp = teamReport.dayFingerprint(day);

    // Generate + cache the review if needed.
    let cached = await HrTeamReview.findOne({ where: { seniorId: senior.id, date } });
    if (!cached || cached.fingerprint !== fp) {
      const r = await teamReviewAi.reviewTeamDay(day);
      await HrTeamReview.upsert({ seniorId: senior.id, date, dayVerdict: r.dayVerdict, daySummary: r.daySummary, perEmployee: r.perEmployee, perTask: r.perTask, fingerprint: fp });
      cached = await HrTeamReview.findOne({ where: { seniorId: senior.id, date } });
    }
    // Email only if away and not already emailed today.
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
    const reports = await teamReport.directReports(senior.id);
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
    const now = istNow();
    // Only fire the heavy work in the end-of-day hour window.
    if (now.getHours() === EOD_HOUR) {
      await runDailies(models);
      await runWeekly(models);
    }
  } catch (e) { console.error('[team-report] tick failed:', e.message); }
  running = false;
}

function start(models) {
  if (timer) return;
  // HrTeamReview needs an emailedAt column for the daily guard.
  timer = setInterval(() => tick(models), INTERVAL_MS);
  console.log('[team-report] scheduler started (EOD hour', EOD_HOUR, 'IST)');
}

module.exports = { start, tick, runDailies, runWeekly };

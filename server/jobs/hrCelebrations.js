/**
 * HR celebration auto-mailer. Once a day it sends founder-signed emails from
 * adam@qtonix.com (Sandeep Kumar Swain, Founder / Director):
 *   - Birthday wish        → on the employee's birthday
 *   - Work anniversary     → on the anniversary of joining (>= 1 year)
 *   - New-joinee welcome   → the day the employee joins (joiningDate == today)
 *
 * Every send is de-duplicated via the CrmEmailLog table (unique dedupeKey), so a
 * restart, a second app instance, or multiple ticks in a day never double-send.
 * Dedupe keys embed the year so the same person is greeted again next year.
 */
const gmail = require('../services/gmail');
const tpl = require('../services/hrEmailTemplate');
const { connectedMailboxes } = require('./crmReminders');

const INTERVAL_MS = Number(process.env.HR_CELEBRATION_MS || 60 * 60 * 1000); // hourly
let timer = null;
let running = false;

// IST "today" parts.
function istParts() {
  const ist = new Date(Date.now() + (5 * 60 + 30) * 60000);
  return { y: ist.getUTCFullYear(), m: ist.getUTCMonth() + 1, d: ist.getUTCDate() };
}
// Does a YYYY-MM-DD fall on today's month+day (ignoring year)?
function isTodayMonthDay(dateStr, t) {
  if (!dateStr) return false;
  const s = String(dateStr).slice(0, 10);
  const mm = Number(s.slice(5, 7)), dd = Number(s.slice(8, 10));
  return mm === t.m && dd === t.d;
}

// Pick the sender mailbox for founder emails: prefer adam@qtonix.com, else any
// connected admin mailbox.
function pickFounder(pool) {
  if (!pool.length) return null;
  return pool.find((m) => m.email === 'adam@qtonix.com') || pool[0];
}

async function sendOnce(models, s, sender, { dedupeKey, type, userId, toName, to, subject, bodyHtml }) {
  const { CrmEmailLog } = models;
  if (!to) return false;
  const existing = await CrmEmailLog.findOne({ where: { dedupeKey } });
  if (existing) return true;
  let logRow;
  try { logRow = await CrmEmailLog.create({ dedupeKey, type, userId: userId || null, toName: toName || '', toEmail: to, subject: subject || '', status: 'pending' }); }
  catch { return true; } // unique violation → another tick already handling it
  try {
    await gmail.sendMessage(s, sender.token, sender.email, {
      from: `${JSON.stringify('Sandeep Kumar Swain')} <${sender.email}>`,
      to, subject, bodyHtml,
    });
    logRow.status = 'sent'; logRow.sentAt = new Date(); await logRow.save();
    return true;
  } catch (e) {
    logRow.status = 'failed'; logRow.error = String(e.message || e).slice(0, 500); await logRow.save();
    console.error(`[hr-celebration] send failed (${type}):`, e.message);
    return false;
  }
}

async function tick(models) {
  if (running) return; running = true;
  try {
    const { HrUser, Settings } = models;
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const pool = await connectedMailboxes(models);
    const sender = pickFounder(pool);
    if (!sender) { running = false; return; } // no connected mailbox yet

    const t = istParts();
    const year = t.y;
    const emps = await HrUser.findAll({ where: { active: true } });
    let sent = 0;
    for (const e of emps) {
      if (!e.email) continue;

      // 1) Birthday
      if (isTodayMonthDay(e.birthday, t)) {
        const ok = await sendOnce(models, s, sender, {
          dedupeKey: `hrbday:${e.id}:${year}`, type: 'hr_birthday', userId: e.id, toName: e.name,
          to: e.email, subject: `Happy Birthday, ${String(e.name).split(' ')[0]}! \uD83C\uDF82`,
          bodyHtml: tpl.birthdayWish({ employeeName: e.name }),
        });
        if (ok) sent += 1;
      }

      // 2) Work anniversary (>= 1 year) OR new-joinee welcome (joined today).
      if (e.joiningDate && isTodayMonthDay(e.joiningDate, t)) {
        const joinYear = Number(String(e.joiningDate).slice(0, 4));
        const years = year - joinYear;
        const joinedText = (() => { try { return new Date(String(e.joiningDate).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return null; } })();
        if (years >= 1) {
          const ok = await sendOnce(models, s, sender, {
            dedupeKey: `hranniv:${e.id}:${year}`, type: 'hr_anniversary', userId: e.id, toName: e.name,
            to: e.email, subject: `Happy Work Anniversary, ${String(e.name).split(' ')[0]}! \uD83C\uDFC6`,
            bodyHtml: tpl.workAnniversary({ employeeName: e.name, years, joinedText, department: e.department, branch: e.branch }),
          });
          if (ok) sent += 1;
        } else if (years === 0) {
          const ok = await sendOnce(models, s, sender, {
            dedupeKey: `hrwelcome:${e.id}`, type: 'hr_welcome', userId: e.id, toName: e.name,
            to: e.email, subject: `Welcome to Qtonix, ${String(e.name).split(' ')[0]}! \uD83D\uDC4B`,
            bodyHtml: tpl.welcomeJoinee({ employeeName: e.name, designation: e.designation, department: e.department, branch: e.branch }),
          });
          if (ok) sent += 1;
        }
      }
    }
    if (sent) console.log(`[hr-celebration] sent ${sent} email(s)`);
  } catch (e) {
    console.error('[hr-celebration] tick failed:', e.message);
  } finally { running = false; }
}

function start(models) {
  if (timer) return;
  setTimeout(() => tick(models), 25000); // shortly after boot
  timer = setInterval(() => tick(models), INTERVAL_MS);
  console.log(`[hr-celebration] started (every ${Math.round(INTERVAL_MS / 60000)} min)`);
}

module.exports = { start, tick };

/**
 * Payment reminder mailer (HR expenses & recurring vendor bills).
 *
 *  1) Approved-but-unpaid expenses with a payDueDate → remind 3 days before the
 *     due date if not yet paid.
 *  2) Vendors with a recurring monthly payment day → remind 3 days before that
 *     day each month.
 *
 * Recipients (per the agreed rule):
 *   • every active admin, PLUS
 *   • every all-branch HR manager, PLUS
 *   • HR staff / HR managers scoped to the item's branch.
 *
 * Every send is de-duplicated via CrmEmailLog (unique dedupeKey) so restarts or a
 * second instance never double-send. Expense reminders dedupe on the due date;
 * vendor reminders dedupe on the YYYY-MM month.
 */
const gmail = require('../services/gmail');
const tpl = require('../services/hrEmailTemplate');
const { connectedMailboxes } = require('./crmReminders');

const INTERVAL_MS = Number(process.env.PAYMENT_REMINDER_MS || 60 * 60 * 1000); // hourly
let timer = null;
let running = false;

// IST "today".
function istParts() {
  const ist = new Date(Date.now() + (5 * 60 + 30) * 60000);
  return { y: ist.getUTCFullYear(), m: ist.getUTCMonth() + 1, d: ist.getUTCDate(), date: ist };
}
function ymd(d) { return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }
// The IST date that is `n` days from today, as YYYY-MM-DD.
function istDatePlus(n) {
  const ist = new Date(Date.now() + (5 * 60 + 30) * 60000);
  ist.setUTCDate(ist.getUTCDate() + n);
  return ymd(ist);
}
function inr(n) { return `₹${Number(n || 0).toLocaleString('en-IN')}`; }
function fmtDate(s) { try { return new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return s; } }

// Days in an IST month (m is 1-based).
function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

// Is a branch matched by an HR user's scope? Admins & all-branch managers match
// any branch. A branch-scoped HR matches only their branch. An unscoped HR (no
// manager scope) still receives items for their own branch.
function hrMatchesBranch(u, branch) {
  const scope = String(u.hrManagerScope || '').trim().toLowerCase();
  if (scope === 'all') return true;
  const b = String(branch || '').toLowerCase();
  const ub = String(u.branch || '').toLowerCase();
  if (!b) return true;                       // no branch on the item → everyone HR
  if (scope && scope === b) return true;      // scoped to this branch
  if (!scope && ub === b) return true;        // unscoped HR in this branch
  return false;
}

// Resolve the recipient list for a branch: all admins + all-branch HR managers +
// branch-scoped HR. Returns [{name,email}], de-duplicated by email.
async function recipientsForBranch(models, branch) {
  const { User, HrUser } = models;
  const out = new Map();
  const admins = await User.findAll({ where: { role: 'admin', active: true } });
  admins.forEach((a) => { if (a.email) out.set(a.email.toLowerCase(), { name: a.name, email: a.email }); });
  // HR staff: managers (any scope) + HR-department / hr / recruiter people.
  const hrUsers = await HrUser.findAll({ where: { active: true } });
  for (const u of hrUsers) {
    const deptIsHr = /^(hr|human resource|human resources)$/i.test(String(u.department || '').trim());
    const isHr = deptIsHr || ['hr', 'recruiter'].includes(u.type) || u.isHrManager || (u.hrManagerScope || '').trim();
    if (!isHr) continue;
    if (!u.email) continue;
    if (hrMatchesBranch(u, branch)) out.set(u.email.toLowerCase(), { name: u.name, email: u.email });
  }
  return [...out.values()];
}

async function sendOnce(models, s, sender, { dedupeKey, type, to, toName, subject, bodyHtml }) {
  const { CrmEmailLog } = models;
  if (!to) return false;
  if (await CrmEmailLog.findOne({ where: { dedupeKey } })) return true;
  let logRow;
  try { logRow = await CrmEmailLog.create({ dedupeKey, type, toName: toName || '', toEmail: to, subject: subject || '', status: 'pending' }); }
  catch { return true; }
  try {
    await gmail.sendMessage(s, sender.token, sender.email, { from: `"Qtonix HR" <${sender.email}>`, to, subject, bodyHtml });
    logRow.status = 'sent'; logRow.sentAt = new Date(); await logRow.save();
    return true;
  } catch (e) {
    logRow.status = 'failed'; logRow.error = String(e.message || e).slice(0, 500); await logRow.save();
    console.error('[payment-reminder] send failed:', e.message);
    return false;
  }
}

const founderSig = { name: 'Qtonix HR', title: 'Finance & HR', email: '' };

// 1) Expense payment-due reminders (3 days before payDueDate, if unpaid).
async function runExpenseReminders(models, s, sender) {
  const { HrExpense } = models;
  const target = istDatePlus(3);
  const rows = await HrExpense.findAll({ where: { status: 'approved', payDueDate: target } });
  let sent = 0;
  for (const e of rows) {
    const recips = await recipientsForBranch(models, e.branch);
    for (const r of recips) {
      const bodyHtml = tpl.shell({
        kicker: 'Qtonix Finance', headline: 'Payment due in 3 days', greetingName: r.name,
        introHtml: `A vendor payment is coming due. Please make sure <strong>${inr(e.amount)}</strong> to <strong>${e.payeeName || 'the vendor'}</strong> is paid by <strong>${fmtDate(e.payDueDate)}</strong>.`,
        details: [
          { label: 'Expense', value: e.title || '—' },
          { label: 'Payee', value: e.payeeName || '—' },
          { label: 'Amount', value: inr(e.amount) },
          { label: 'Due date', value: fmtDate(e.payDueDate) },
          { label: 'Branch', value: e.branch || '—' },
        ],
        outroHtml: 'Once paid, mark it as paid in HRMS → Core HR → Expenses so this reminder closes out.',
        signature: founderSig, footerLine: 'Automated payment reminder from Qtonix HRMS.',
      });
      await sendOnce(models, s, sender, {
        dedupeKey: `expdue:${e.id}:${target}:${r.email}`, type: 'expense_due', to: r.email, toName: r.name,
        subject: `Payment due in 3 days — ${e.payeeName || e.title} (${inr(e.amount)})`, bodyHtml,
      });
      sent++;
    }
    e.payDueReminderSent = target; await e.save();
  }
  return sent;
}

// 2) Recurring vendor bill reminders (3 days before the recurring day-of-month).
async function runVendorReminders(models, s, sender) {
  const { HrVendor } = models;
  const t = istParts();
  const monthKey = `${t.y}-${String(t.m).padStart(2, '0')}`;
  const vendors = await HrVendor.findAll({ where: { active: true, recurringPayment: true } });
  let sent = 0;
  for (const v of vendors) {
    if (!v.recurringDay) continue;
    // Clamp the day to the month length, then check if that day is 3 days away.
    const dim = daysInMonth(t.y, t.m);
    const payDay = Math.min(Number(v.recurringDay), dim);
    // Reminder day = payDay - 3, wrapping into the previous month if needed. To
    // keep it simple and robust, compare the target pay-date (this month) to the
    // date 3 days from now.
    const target = istDatePlus(3);
    const payDateStr = `${t.y}-${String(t.m).padStart(2, '0')}-${String(payDay).padStart(2, '0')}`;
    if (payDateStr !== target) continue;
    const recips = await recipientsForBranch(models, v.branch);
    const label = v.recurringLabel || v.name;
    for (const r of recips) {
      const bodyHtml = tpl.shell({
        kicker: 'Qtonix Finance', headline: 'Recurring bill due in 3 days', greetingName: r.name,
        introHtml: `The monthly payment for <strong>${label}</strong> (${v.name}) is due on <strong>${fmtDate(payDateStr)}</strong>. Please arrange the payment.`,
        details: [
          { label: 'Vendor', value: v.name },
          ...(v.recurringLabel ? [{ label: 'For', value: v.recurringLabel }] : []),
          ...(v.recurringAmount ? [{ label: 'Typical amount', value: inr(v.recurringAmount) }] : []),
          { label: 'Due date', value: fmtDate(payDateStr) },
          { label: 'Branch', value: v.branch || '—' },
        ],
        outroHtml: 'Raise the expense in HRMS → Core HR → Expenses and record the payment once done.',
        signature: founderSig, footerLine: 'Automated recurring-bill reminder from Qtonix HRMS.',
      });
      await sendOnce(models, s, sender, {
        dedupeKey: `vendordue:${v.id}:${monthKey}:${r.email}`, type: 'vendor_recurring', to: r.email, toName: r.name,
        subject: `Recurring bill due in 3 days — ${label} (${v.name})`, bodyHtml,
      });
      sent++;
    }
    v.recurringReminderSent = monthKey; await v.save();
  }
  return sent;
}

async function tick(models) {
  if (running) return; running = true;
  try {
    const { Settings } = models;
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const pool = await connectedMailboxes(models);
    const sender = pool.find((m) => m.email === 'adam@qtonix.com') || pool[0];
    if (!sender) { running = false; return; }
    const a = await runExpenseReminders(models, s, sender);
    const b = await runVendorReminders(models, s, sender);
    if (a || b) console.log(`[payment-reminder] sent ${a} expense + ${b} vendor reminder(s)`);
  } catch (e) {
    console.error('[payment-reminder] tick failed:', e.message);
  } finally { running = false; }
}

function start(models) {
  if (timer) return;
  setTimeout(() => tick(models), 30 * 1000); // shortly after boot
  timer = setInterval(() => tick(models), INTERVAL_MS);
  console.log('[payment-reminder] started');
}

module.exports = { start, tick, runExpenseReminders, runVendorReminders, recipientsForBranch, istDatePlus };

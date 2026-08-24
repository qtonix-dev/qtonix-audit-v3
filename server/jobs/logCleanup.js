/**
 * Weekly log cleanup. Runs Sunday ~9 AM IST (low-traffic window) and deletes
 * audit + call logs older than 3 months, keeping only the recent 3 months.
 * We check hourly and fire once per Sunday-9AM slot (guarded by lastRun).
 */
const { Op } = require('sequelize');

const CHECK_MS = Number(process.env.LOG_CLEANUP_CHECK_MS || 60 * 60 * 1000); // hourly
let timer = null;
let running = false;
let lastRunKey = null; // 'YYYY-MM-DD' of the last Sunday we ran, to avoid double-runs

// Current time in IST (Asia/Kolkata is UTC+5:30, no DST).
function istNow() { return new Date(Date.now() + 330 * 60000); }

async function runCleanup(models) {
  if (running) return;
  running = true;
  try {
    const { AuditLog, CallLog } = models;
    // Cutoff = 3 months ago (90 days). Anything older is removed.
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    let audit = 0, calls = 0;
    if (AuditLog) audit = await AuditLog.destroy({ where: { createdAt: { [Op.lt]: cutoff } } });
    if (CallLog) calls = await CallLog.destroy({ where: { createdAt: { [Op.lt]: cutoff } } });
    console.log(`[log-cleanup] removed ${audit} audit + ${calls} call logs older than ${cutoff.toISOString().slice(0, 10)}`);
  } catch (e) {
    console.error('[log-cleanup] failed:', e.message);
  } finally {
    running = false;
  }
}

function tick(models) {
  const now = istNow();
  const isSunday = now.getUTCDay() === 0;      // istNow shifted, so use UTC accessors
  const hour = now.getUTCHours();
  const key = now.toISOString().slice(0, 10);  // IST date
  // Fire once when it's Sunday and the 9 AM hour has arrived, guarded per day.
  if (isSunday && hour >= 9 && lastRunKey !== key) {
    lastRunKey = key;
    runCleanup(models);
  }
}

function start(models) {
  if (timer) return;
  // Run one check shortly after boot, then hourly.
  setTimeout(() => tick(models), 30 * 1000);
  timer = setInterval(() => tick(models), CHECK_MS);
  console.log('[log-cleanup] scheduled (Sunday ~9AM IST, prune >3 months)');
}

module.exports = { start, runCleanup };

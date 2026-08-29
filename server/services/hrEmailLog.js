// Shared helper: send an HR email through the gmail service AND record it to
// CrmEmailLog so it appears in Admin → Emails (last-activity + activity popup).
// Every send gets a unique dedupeKey, so repeat sends of the same type are all
// logged. Logging is best-effort and never blocks the actual send.
const gmail = require('./gmail');

async function sendAndLog(s, token, mailboxEmail, msg, { type, userId } = {}) {
  const { CrmEmailLog } = require('../models');
  const to = Array.isArray(msg.to) ? msg.to.join(', ') : (msg.to || '');
  const subject = msg.subject || '';
  let logRow = null;
  if (type) {
    const dedupeKey = `${type}:${to}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`.slice(0, 160);
    try {
      logRow = await CrmEmailLog.create({
        dedupeKey, type, userId: userId || null,
        toEmail: String(to).slice(0, 255), toName: String(msg.toName || '').slice(0, 255),
        subject: String(subject).slice(0, 2000), status: 'pending',
      });
    } catch { /* best-effort */ }
  }
  try {
    const result = await gmail.sendMessage(s, token, mailboxEmail, msg);
    if (logRow) { try { logRow.status = 'sent'; logRow.sentAt = new Date(); await logRow.save(); } catch {} }
    return result;
  } catch (e) {
    if (logRow) { try { logRow.status = 'failed'; logRow.sentAt = new Date(); logRow.error = String(e.message || e).slice(0, 2000); await logRow.save(); } catch {} }
    throw e;
  }
}

module.exports = { sendAndLog };

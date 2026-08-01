/**
 * Scheduled-email dispatcher. Gmail has no native schedule-send, so composed
 * emails with a future sendAt are stored in scheduled_emails and delivered here
 * when their time arrives, from the owning user's connected mailbox.
 */
const gmail = require('../services/gmail');
const fs = require('fs');

const INTERVAL_MS = Number(process.env.SCHED_EMAIL_MS || 60 * 1000); // check each minute
let timer = null;
let running = false;

async function buildAttachments(list, lead, models) {
  const { Report } = models;
  const out = [];
  for (const a of (Array.isArray(list) ? list : [])) {
    if (a && a.contentBase64 && a.filename) {
      out.push({ filename: a.filename, mimeType: a.mimeType || 'application/octet-stream', contentBase64: a.contentBase64 });
    } else if (a && a.reportId) {
      const report = await Report.findByPk(a.reportId);
      if (report && report.pdfPath && fs.existsSync(report.pdfPath)) {
        const buf = fs.readFileSync(report.pdfPath);
        out.push({ filename: `${(report.businessName || 'report').replace(/[^a-z0-9]+/gi, '-')}.pdf`, mimeType: 'application/pdf', contentBase64: buf.toString('base64') });
      }
    }
  }
  return out;
}

async function dispatchDue(models) {
  const { ScheduledEmail, User, Lead, LeadEmail, Settings, Op } = models;
  const due = await ScheduledEmail.findAll({ where: { status: 'pending', sendAt: { [Op.lte]: new Date() } }, limit: 20 });
  if (due.length === 0) return { sent: 0 };
  const s = await Settings.findOne({ where: { singleton: 'settings' } });
  let sent = 0;
  for (const job of due) {
    try {
      const sender = await User.findByPk(job.userId);
      if (!sender || !sender.gmailRefreshToken) { job.status = 'failed'; job.error = 'Sender mailbox not connected.'; await job.save(); continue; }
      const lead = job.leadId ? await Lead.findByPk(job.leadId) : null;
      const attachments = await buildAttachments(job.attachments, lead, models);
      // Open-tracking pixel (automatic on every send).
      let body = job.bodyHtml; let trackToken = null;
      try {
        const base = (process.env.APP_URL || '').replace(/\/+$/, '');
        if (base) {
          const crypto = require('crypto');
          trackToken = crypto.randomBytes(16).toString('hex');
          await models.EmailOpen.create({ token: trackToken, leadId: job.leadId || null, userId: sender.id, toEmail: job.toEmail || '', subject: job.subject || '', threadId: job.threadId || null, sentAt: new Date() });
          body = `${body || ''}<img src="${base}/api/track/open/${trackToken}.gif" width="1" height="1" alt="" style="display:none;width:1px;height:1px" />`;
        }
      } catch (e) { /* tracking best-effort */ }
      const res = await gmail.sendMessage(s, sender.getGmailRefreshToken(), sender.gmailConnectedEmail, {
        from: sender.gmailConnectedEmail, to: job.toEmail, cc: job.ccEmail, bcc: job.bccEmail,
        subject: job.subject, bodyHtml: body, threadId: job.threadId, inReplyTo: job.inReplyTo, attachments,
      });
      if (trackToken) { try { await models.EmailOpen.update({ gmailMessageId: res.id, threadId: res.threadId || job.threadId || null }, { where: { token: trackToken } }); } catch (e) { /* */ } }
      job.status = 'sent'; job.sentMessageId = res.id; await job.save();
      await LeadEmail.create({
        leadId: job.leadId || null, userId: sender.id, gmailMessageId: res.id, threadId: res.threadId || job.threadId || '',
        direction: 'outbound', fromEmail: sender.gmailConnectedEmail, fromName: sender.name,
        toEmail: job.toEmail, ccEmail: job.ccEmail, bccEmail: job.bccEmail, subject: job.subject,
        snippet: String(job.bodyHtml || '').replace(/<[^>]+>/g, '').slice(0, 200), bodyHtml: job.bodyHtml,
        attachments: (attachments || []).map((a) => ({ filename: a.filename, mimeType: a.mimeType })),
        sentAt: new Date(), isRead: true,
      }).catch(() => {});
      sent++;
    } catch (e) {
      job.status = 'failed'; job.error = e.message; await job.save().catch(() => {});
      console.error(`[sched-email] job ${job.id} failed:`, e.message);
    }
  }
  return { sent };
}

function start(models) {
  if (timer) return;
  const tick = async () => {
    if (running) return; running = true;
    try { const r = await dispatchDue(models); if (r.sent) console.log('[sched-email]', JSON.stringify(r)); }
    catch (e) { console.error('[sched-email] pass failed:', e.message); }
    finally { running = false; }
  };
  setTimeout(tick, 15000);
  timer = setInterval(tick, INTERVAL_MS);
  console.log(`[sched-email] dispatcher every ${Math.round(INTERVAL_MS / 1000)}s`);
}

module.exports = { start, dispatchDue };

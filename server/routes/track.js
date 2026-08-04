const express = require('express');
const router = express.Router();
const { EmailOpen, Lead } = require('../models');

// A 1x1 transparent GIF, served for every pixel hit regardless of outcome so
// the recipient's client always gets a valid image.
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
function sendPixel(res) {
  res.set('Content-Type', 'image/gif');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.end(PIXEL);
}

/**
 * GET /api/track/open/:token.gif — the tracking pixel. Public (no auth: the
 * recipient isn't logged in). Records the open, and on the FIRST open posts a
 * note to the lead's timeline. Always returns the pixel.
 */
router.get('/open/:token.gif', async (req, res) => {
  try {
    const token = String(req.params.token || '').slice(0, 64);
    const row = await EmailOpen.findOne({ where: { token } });
    if (row) {
      const now = new Date();
      const firstOpen = !row.firstOpenAt;
      row.opens = (row.opens || 0) + 1;
      row.lastOpenAt = now;
      if (firstOpen) row.firstOpenAt = now;
      await row.save();

      // On the first open, drop a note on the lead's timeline.
      if (firstOpen && row.leadId) {
        try {
          const lead = await Lead.findByPk(row.leadId);
          if (lead) {
            const tl = Array.isArray(lead.timeline) ? lead.timeline : [];
            tl.push({
              type: 'email', direction: 'open',
              text: `📖 Email opened by recipient: "${row.subject || '(no subject)'}"`,
              time: now.toISOString(), author: 'Recipient',
            });
            lead.timeline = tl; lead.changed('timeline', true);
            await lead.save();
          }
        } catch (e) { /* best-effort */ }
      }
    }
  } catch (e) { /* never fail the pixel */ }
  return sendPixel(res);
});

// Some clients strip the extension; accept a bare token too.
router.get('/open/:token', async (req, res) => {
  req.params.token = String(req.params.token || '').replace(/\.gif$/i, '');
  // Reuse the handler logic by delegating.
  try {
    const token = String(req.params.token || '').slice(0, 64);
    const row = await EmailOpen.findOne({ where: { token } });
    if (row) {
      const now = new Date();
      const firstOpen = !row.firstOpenAt;
      row.opens = (row.opens || 0) + 1; row.lastOpenAt = now;
      if (firstOpen) row.firstOpenAt = now;
      await row.save();
      if (firstOpen && row.leadId) {
        try {
          const lead = await Lead.findByPk(row.leadId);
          if (lead) {
            const tl = Array.isArray(lead.timeline) ? lead.timeline : [];
            tl.push({ type: 'email', direction: 'open', text: `📖 Email opened by recipient: "${row.subject || '(no subject)'}"`, time: now.toISOString(), author: 'Recipient' });
            lead.timeline = tl; lead.changed('timeline', true); await lead.save();
          }
        } catch (e) { /* */ }
      }
    }
  } catch (e) { /* */ }
  return sendPixel(res);
});

/**
 * GET /api/track/click/:token — a tracked link/attachment. Records the click on
 * the matching EmailOpen row, drops a timeline note (first click / download),
 * then 302-redirects to the real destination. Public (recipient isn't logged
 * in). Query: u = destination URL (encoded), l = label (e.g. the link text or
 * file name), d = "1" when it's a download/attachment.
 */
router.get('/click/:token', async (req, res) => {
  const dest = (() => {
    try { return decodeURIComponent(String(req.query.u || '')); } catch { return ''; }
  })();
  const label = String(req.query.l || '').slice(0, 200);
  const isDownload = String(req.query.d || '') === '1';
  try {
    const token = String(req.params.token || '').slice(0, 64);
    const row = await EmailOpen.findOne({ where: { token } });
    if (row) {
      const now = new Date();
      const firstClick = !row.firstClickAt;
      row.clicks = (row.clicks || 0) + 1;
      row.lastClickAt = now;
      if (firstClick) row.firstClickAt = now;
      // A click proves the email was opened — backfill the open too.
      if (!row.firstOpenAt) { row.firstOpenAt = now; row.opens = (row.opens || 0) + 1; row.lastOpenAt = now; }
      const log = Array.isArray(row.clickLog) ? row.clickLog : [];
      log.push({ at: now.toISOString(), label: label || dest, url: dest, download: isDownload });
      row.clickLog = log; row.changed('clickLog', true);
      await row.save();

      if (row.leadId) {
        try {
          const lead = await Lead.findByPk(row.leadId);
          if (lead) {
            const tl = Array.isArray(lead.timeline) ? lead.timeline : [];
            const verb = isDownload ? '📎 Recipient downloaded' : '🔗 Recipient clicked';
            tl.push({
              type: 'email', direction: isDownload ? 'download' : 'click',
              text: `${verb} ${label ? `"${label}"` : 'a link'} in "${row.subject || '(no subject)'}"`,
              time: now.toISOString(), author: 'Recipient',
            });
            lead.timeline = tl; lead.changed('timeline', true); lead.lastActivityAt = now;
            await lead.save();
          }
        } catch (e) { /* best-effort */ }
      }
    }
  } catch (e) { /* never fail the redirect */ }
  // Redirect to the real destination (or a blank page if none/unsafe).
  if (/^https?:\/\//i.test(dest)) return res.redirect(302, dest);
  return res.status(204).end();
});

module.exports = router;

const router = require('express').Router();
const { User, Lead, LeadEmail, Settings, Op } = require('../models');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const gmail = require('../services/gmail');

// --- Admin: Gmail OAuth app keys --------------------------------------------

router.get('/config', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    res.json({
      configured: gmail.isConfigured(s),
      clientId: s.getKey('gmailClientId') || '',
      hasSecret: !!s.getKey('gmailClientSecret'),
      redirectUri: gmail.redirectUri(),
    });
  } catch (e) { next(e); }
});

router.put('/config', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const keys = { ...(s.apiKeys || {}) };
    if (b.clientId !== undefined) keys.gmailClientId = String(b.clientId).trim();
    if (b.clientSecret !== undefined && b.clientSecret && !String(b.clientSecret).includes('•')) keys.gmailClientSecret = String(b.clientSecret).trim();
    s.apiKeys = keys; s.changed('apiKeys', true);
    await s.save();
    const fresh = await Settings.findOne({ where: { singleton: 'settings' } });
    res.json({ ok: gmail.isConfigured(fresh), message: gmail.isConfigured(fresh) ? 'Gmail app credentials saved.' : 'Enter both the Client ID and Client Secret.' });
  } catch (e) { next(e); }
});

// --- Per-user connect flow --------------------------------------------------

/** Start OAuth: returns the Google consent URL for the logged-in user. */
router.get('/connect', requireAuth, async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    if (!gmail.isConfigured(s)) return res.status(400).json({ error: 'Gmail isn’t set up yet. Ask an admin to add the app credentials.' });
    // state carries the user id, signed lightly with the JWT secret to prevent tampering.
    const jwt = require('jsonwebtoken');
    const state = jwt.sign({ uid: req.user.id }, process.env.JWT_SECRET || 'change-me-in-production', { expiresIn: '10m' });
    res.json({ url: gmail.authUrl(s, state) });
  } catch (e) { next(e); }
});

/** OAuth callback (Google redirects the browser here). Attaches the refresh
 *  token to the user, then closes the popup / redirects back to the app. */
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const done = (msg, ok) => res.send(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px;text-align:center">
    <h2 style="color:${ok ? '#059669' : '#DC2626'}">${msg}</h2>
    <p style="color:#64748B">You can close this window.</p>
    <script>try{window.opener&&window.opener.postMessage({gmail:'${ok ? 'connected' : 'error'}'},'*')}catch(e){};setTimeout(()=>window.close(),1500)</script></body>`);
  try {
    if (error) return done('Connection cancelled.', false);
    const jwt = require('jsonwebtoken');
    let uid;
    try { uid = jwt.verify(String(state), process.env.JWT_SECRET || 'change-me-in-production').uid; }
    catch { return done('This connection link expired. Please try again.', false); }
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const { refreshToken, email } = await gmail.exchangeCode(s, code);
    if (!refreshToken) return done('Google did not return a refresh token. Remove the app’s access in your Google account and try again.', false);
    const user = await User.findByPk(uid);
    if (!user) return done('User not found.', false);
    user.gmailRefreshToken = refreshToken; // encrypted by model hook
    user.gmailConnectedEmail = email;
    user.gmailConnectedAt = new Date();
    await user.save();
    done(`Gmail connected${email ? ` (${email})` : ''}.`, true);
  } catch (e) {
    console.error('[gmail] callback error', e.message);
    done('Something went wrong connecting Gmail.', false);
  }
});

/** Current user's connection status. */
router.get('/status', requireAuth, async (req, res, next) => {
  try {
    const u = await User.findByPk(req.user.id);
    res.json({ connected: !!u.gmailRefreshToken, email: u.gmailConnectedEmail || '', connectedAt: u.gmailConnectedAt });
  } catch (e) { next(e); }
});

router.post('/disconnect', requireAuth, async (req, res, next) => {
  try {
    const u = await User.findByPk(req.user.id);
    u.gmailRefreshToken = null; u.gmailConnectedEmail = null; u.gmailConnectedAt = null; u.gmailHistoryId = null;
    await u.save();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// --- Lead email thread ------------------------------------------------------

// Build the Gmail search query for a lead: their email plus their domain.
function leadQuery(lead) {
  const parts = [];
  if (lead.email) parts.push(`from:${lead.email}`, `to:${lead.email}`);
  const domain = (lead.domain || '').replace(/^www\./, '');
  if (domain) { parts.push(`from:@${domain}`, `to:@${domain}`); }
  return parts.join(' OR ');
}

/**
 * GET /api/gmail/lead/:leadId — the email thread for a lead, from the current
 * user's synced mailbox. Reads from our DB (populated by background sync); if
 * empty, does a one-off live fetch so the first open isn't blank.
 */
router.get('/lead/:leadId', requireAuth, async (req, res, next) => {
  try {
    const lead = await Lead.findByPk(req.params.leadId);
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });
    const u = await User.findByPk(req.user.id);
    if (!u.gmailRefreshToken) return res.json({ connected: false, emails: [] });

    let rows = await LeadEmail.findAll({ where: { leadId: lead.id, userId: u.id }, order: [['sentAt', 'DESC']], limit: 50 });

    // First open with nothing synced yet → do a live fetch and persist.
    if (rows.length === 0 && (lead.email || lead.domain)) {
      const s = await Settings.findOne({ where: { singleton: 'settings' } });
      const q = leadQuery(lead);
      if (q) {
        const msgs = await gmail.searchMessages(s, u.getGmailRefreshToken(), u.gmailConnectedEmail, q, 25);
        for (const m of msgs) {
          await LeadEmail.findOrCreate({ where: { userId: u.id, gmailMessageId: m.gmailMessageId }, defaults: { ...m, leadId: lead.id, userId: u.id } }).catch(() => {});
        }
        rows = await LeadEmail.findAll({ where: { leadId: lead.id, userId: u.id }, order: [['sentAt', 'DESC']], limit: 50 });
      }
    }
    res.json({ connected: true, email: u.gmailConnectedEmail, emails: rows.map((r) => r.toJSON()) });
  } catch (e) { next(e); }
});

/** POST /api/gmail/lead/:leadId/send — send an email to the lead. */
router.post('/lead/:leadId/send', requireAuth, async (req, res, next) => {
  try {
    const lead = await Lead.findByPk(req.params.leadId);
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });
    const u = await User.findByPk(req.user.id);
    if (!u.gmailRefreshToken) return res.status(400).json({ error: 'Connect your Gmail first (Users portal → Connect Gmail).' });
    const { to, subject, body, threadId, inReplyTo } = req.body || {};
    const recipient = to || lead.email;
    if (!recipient) return res.status(400).json({ error: 'This lead has no email address on file.' });
    if (!subject || !body) return res.status(400).json({ error: 'Subject and message are both required.' });
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const sent = await gmail.sendMessage(s, u.getGmailRefreshToken(), u.gmailConnectedEmail, { to: recipient, subject, bodyHtml: body, threadId, inReplyTo });
    // Store our own copy as an outbound record.
    await LeadEmail.create({
      leadId: lead.id, userId: u.id, gmailMessageId: sent.id, threadId: sent.threadId || threadId || '',
      direction: 'outbound', fromEmail: u.gmailConnectedEmail, fromName: u.name, toEmail: recipient,
      subject, snippet: String(body).replace(/<[^>]+>/g, '').slice(0, 200), bodyHtml: body, sentAt: new Date(), isRead: true,
    }).catch(() => {});
    res.json({ ok: true, id: sent.id });
  } catch (e) { next(e); }
});

/** POST /api/gmail/email/:id/read — mark a synced email read. */
router.post('/email/:id/read', requireAuth, async (req, res, next) => {
  try {
    const row = await LeadEmail.findByPk(req.params.id);
    if (!row || row.userId !== req.user.id) return res.status(404).json({ error: 'Not found.' });
    row.isRead = true; await row.save();
    const u = await User.findByPk(req.user.id);
    if (u.gmailRefreshToken) {
      const s = await Settings.findOne({ where: { singleton: 'settings' } });
      gmail.markRead(s, u.getGmailRefreshToken(), row.gmailMessageId).catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;

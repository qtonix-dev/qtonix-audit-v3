const router = require('express').Router();
const fs = require('fs');
const { User, Lead, LeadEmail, ScheduledEmail, Mailbox, Signature, Report, Settings, Op } = require('../models');
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
      baseUrlOk: gmail.hasValidBaseUrl(),
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
    if (!gmail.hasValidBaseUrl()) return res.status(400).json({ error: 'The server’s public URL (APP_URL) isn’t configured, so Google would reject the sign-in. Ask an admin to set APP_URL and redeploy.' });
    // `extra` (admin only) links an additional mailbox with a friendly label
    // rather than replacing the user's primary one.
    const extra = req.query.extra === '1';
    if (extra && req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can link additional mailboxes.' });
    const label = String(req.query.label || '').slice(0, 120);
    const jwt = require('jsonwebtoken');
    const state = jwt.sign({ uid: req.user.id, extra, label }, process.env.JWT_SECRET || 'change-me-in-production', { expiresIn: '10m' });
    res.json({ url: gmail.authUrl(s, state) });
  } catch (e) { next(e); }
});

/** OAuth callback (Google redirects the browser here). Attaches the refresh
 *  token to the user (or an extra Mailbox row), then closes the popup. */
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const done = (msg, ok) => res.send(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px;text-align:center">
    <h2 style="color:${ok ? '#059669' : '#DC2626'}">${msg}</h2>
    <p style="color:#64748B">You can close this window.</p>
    <script>try{window.opener&&window.opener.postMessage({gmail:'${ok ? 'connected' : 'error'}'},'*')}catch(e){};setTimeout(()=>window.close(),1500)</script></body>`);
  try {
    if (error) return done('Connection cancelled.', false);
    const jwt = require('jsonwebtoken');
    let payload;
    try { payload = jwt.verify(String(state), process.env.JWT_SECRET || 'change-me-in-production'); }
    catch { return done('This connection link expired. Please try again.', false); }
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const { refreshToken, email } = await gmail.exchangeCode(s, code);
    if (!refreshToken) return done('Google did not return a refresh token. Remove the app’s access in your Google account and try again.', false);
    const user = await User.findByPk(payload.uid);
    if (!user) return done('User not found.', false);

    if (payload.extra && user.role === 'admin') {
      // Link as an additional mailbox (or update the token if already linked).
      const [mb] = await Mailbox.findOrCreate({ where: { userId: user.id, email }, defaults: { userId: user.id, email, label: payload.label || email.split('@')[0] } });
      mb.refreshToken = refreshToken;
      if (payload.label) mb.label = payload.label;
      mb.active = true;
      await mb.save();
      return done(`Mailbox linked: ${email}.`, true);
    }

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

// --- Multiple mailboxes (admin) + signatures --------------------------------

/** GET /api/gmail/mailboxes — the user's linked mailboxes (primary + extras)
 *  with signatures. Extras are admin-only. */
router.get('/mailboxes', requireAuth, async (req, res, next) => {
  try {
    const u = await User.findByPk(req.user.id);
    const list = [];
    if (u.gmailConnectedEmail) list.push({ _id: `user:${u.id}`, kind: 'primary', label: 'Me', email: u.gmailConnectedEmail, connected: !!u.gmailRefreshToken, signature: u.emailSignature || '' });
    if (u.role === 'admin') {
      const extras = await Mailbox.findAll({ where: { userId: u.id, active: true }, order: [['label', 'ASC']] });
      extras.forEach((m) => list.push({ _id: m.id, kind: 'extra', label: m.label, email: m.email, connected: m.connected, signature: m.signature || '' }));
    }
    res.json({ isAdmin: u.role === 'admin', defaultSignature: u.emailSignature || '', mailboxes: list });
  } catch (e) { next(e); }
});

/** DELETE /api/gmail/mailboxes/:id — unlink an extra mailbox (admin). */
router.delete('/mailboxes/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const m = await Mailbox.findByPk(req.params.id);
    if (!m || m.userId !== req.user.id) return res.status(404).json({ error: 'Mailbox not found.' });
    await m.destroy();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** PUT /api/gmail/mailboxes/:id — rename or set an extra mailbox's signature. */
router.put('/mailboxes/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const m = await Mailbox.findByPk(req.params.id);
    if (!m || m.userId !== req.user.id) return res.status(404).json({ error: 'Mailbox not found.' });
    const b = req.body || {};
    if (b.label !== undefined) m.label = String(b.label).slice(0, 120);
    if (b.signature !== undefined) m.signature = b.signature;
    await m.save();
    res.json(m.toJSON());
  } catch (e) { next(e); }
});

/** PUT /api/gmail/signature — set the user's default signature (HTML). */
router.put('/signature', requireAuth, async (req, res, next) => {
  try {
    const u = await User.findByPk(req.user.id);
    u.emailSignature = (req.body && req.body.signature) || '';
    await u.save();
    res.json({ ok: true, signature: u.emailSignature });
  } catch (e) { next(e); }
});

// --- Signature library ------------------------------------------------------

/** GET /api/gmail/signatures — the user's signature library. */
router.get('/signatures', requireAuth, async (req, res, next) => {
  try {
    const rows = await Signature.findAll({ where: { userId: req.user.id }, order: [['isDefault', 'DESC'], ['name', 'ASC']] });
    res.json(rows.map((r) => r.toJSON()));
  } catch (e) { next(e); }
});

/** POST /api/gmail/signatures — create a signature. */
router.post('/signatures', requireAuth, async (req, res, next) => {
  try {
    const b = req.body || {};
    const row = await Signature.create({
      userId: req.user.id, name: (b.name || 'Signature').slice(0, 120), bodyHtml: b.bodyHtml || '',
      scope: b.scope === 'mailbox' ? 'mailbox' : 'all', mailboxRef: b.scope === 'mailbox' ? (b.mailboxRef || null) : null,
      isDefault: !!b.isDefault,
    });
    if (row.isDefault) await Signature.update({ isDefault: false }, { where: { userId: req.user.id, id: { [Op.ne]: row.id } } });
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

/** PUT /api/gmail/signatures/:id — update a signature. */
router.put('/signatures/:id', requireAuth, async (req, res, next) => {
  try {
    const row = await Signature.findByPk(req.params.id);
    if (!row || row.userId !== req.user.id) return res.status(404).json({ error: 'Signature not found.' });
    const b = req.body || {};
    if (b.name !== undefined) row.name = String(b.name).slice(0, 120);
    if (b.bodyHtml !== undefined) row.bodyHtml = b.bodyHtml;
    if (b.scope !== undefined) { row.scope = b.scope === 'mailbox' ? 'mailbox' : 'all'; row.mailboxRef = b.scope === 'mailbox' ? (b.mailboxRef || null) : null; }
    if (b.isDefault !== undefined) row.isDefault = !!b.isDefault;
    await row.save();
    if (row.isDefault) await Signature.update({ isDefault: false }, { where: { userId: req.user.id, id: { [Op.ne]: row.id } } });
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

/** DELETE /api/gmail/signatures/:id */
router.delete('/signatures/:id', requireAuth, async (req, res, next) => {
  try {
    const row = await Signature.findByPk(req.params.id);
    if (!row || row.userId !== req.user.id) return res.status(404).json({ error: 'Signature not found.' });
    await row.destroy();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/**
 * POST /api/gmail/ai-draft — generate an email draft via OpenAI. Wired now;
 * fuller prompt/behaviour to come. Returns { draft } HTML.
 */
router.post('/ai-draft', requireAuth, async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const key = s.getKey('openai');
    if (!key) return res.status(400).json({ error: 'OpenAI isn’t configured yet. Ask an admin to add the API key in Admin → API keys.' });
    const b = req.body || {};
    const lead = b.leadId ? await Lead.findByPk(b.leadId) : null;
    const prompt = b.prompt || 'Write a short, friendly follow-up email to this lead.';
    const context = lead ? `Lead: ${lead.firstName || ''} ${lead.lastName || ''}, website ${lead.website || 'n/a'}, email ${lead.email || 'n/a'}.` : '';

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: b.model || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a helpful sales assistant that drafts concise, professional emails. Return only the email body as simple HTML (no <html> wrapper).' },
          { role: 'user', content: `${context}\n\n${prompt}` },
        ],
        max_tokens: 600,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(502).json({ error: data.error?.message || 'OpenAI request failed.' });
    const draft = data.choices?.[0]?.message?.content || '';
    res.json({ draft });
  } catch (e) { next(e); }
});

// --- Lead email thread ------------------------------------------------------

// Which user mailboxes may the viewer see for lead emails?
//   admin    → everyone
//   manager  → self + direct-report agents (managerId === manager.id)
//   agent/LM → self only
async function visibleUserIds(viewer) {
  if (viewer.role === 'admin') {
    const all = await User.findAll({ attributes: ['id'] });
    return all.map((u) => u.id);
  }
  if (viewer.role === 'manager') {
    const team = await User.findAll({ where: { managerId: viewer.id }, attributes: ['id'] });
    return [viewer.id, ...team.map((u) => u.id)];
  }
  return [viewer.id];
}

// Build the Gmail search query for a lead: their email plus their domain.
function leadQuery(lead) {
  const parts = [];
  if (lead.email) parts.push(`from:${lead.email}`, `to:${lead.email}`);
  const domain = (lead.domain || '').replace(/^www\./, '');
  if (domain) { parts.push(`from:@${domain}`, `to:@${domain}`); }
  return parts.join(' OR ');
}

/**
 * GET /api/gmail/lead/:leadId — lead email list, filtered by the viewer's
 * visibility scope. Reads from our DB (populated by background sync); if the
 * viewer has their own mailbox connected and nothing is synced, does a one-off
 * live fetch of their own mailbox so the first open isn't blank.
 */
router.get('/lead/:leadId', requireAuth, async (req, res, next) => {
  try {
    const lead = await Lead.findByPk(req.params.leadId);
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });
    const viewer = await User.findByPk(req.user.id);
    const allowed = await visibleUserIds(viewer);

    // Live backfill from the viewer's OWN mailbox on first open.
    const mine = await LeadEmail.count({ where: { leadId: lead.id, userId: viewer.id } });
    if (mine === 0 && viewer.gmailRefreshToken && (lead.email || lead.domain)) {
      const s = await Settings.findOne({ where: { singleton: 'settings' } });
      const q = leadQuery(lead);
      if (q) {
        try {
          const msgs = await gmail.searchMessages(s, viewer.getGmailRefreshToken(), viewer.gmailConnectedEmail, q, 25);
          for (const m of msgs) {
            await LeadEmail.findOrCreate({ where: { userId: viewer.id, gmailMessageId: m.gmailMessageId }, defaults: { ...m, leadId: lead.id, userId: viewer.id } }).catch(() => {});
          }
        } catch (e) { /* live fetch is best-effort */ }
      }
    }

    const rows = await LeadEmail.findAll({
      where: { leadId: lead.id, userId: { [Op.in]: allowed } },
      order: [['sentAt', 'DESC']], limit: 200,
    });
    const emails = rows.map((r) => r.toJSON());
    const unread = emails.filter((e) => e.direction === 'inbound' && !e.isRead).length;

    // Mailboxes the viewer can send AS (their own, plus — for admins/managers —
    // any connected mailbox in their scope, so they can send on behalf).
    const scopeUsers = await User.findAll({ where: { id: { [Op.in]: allowed }, gmailRefreshToken: { [Op.ne]: null } }, attributes: ['id', 'name', 'gmailConnectedEmail', 'emailSignature'] });
    const fromOptions = scopeUsers.filter((u) => u.gmailConnectedEmail).map((u) => ({ value: `user:${u.id}`, userId: u.id, email: u.gmailConnectedEmail, name: u.name, self: u.id === viewer.id, signature: u.emailSignature || '' }));
    // The viewer's own extra mailboxes (admins).
    if (viewer.role === 'admin') {
      const extras = await Mailbox.findAll({ where: { userId: viewer.id, active: true, refreshToken: { [Op.ne]: null } } });
      extras.forEach((m) => fromOptions.push({ value: `mailbox:${m.id}`, mailboxId: m.id, email: m.email, name: m.label || m.email, self: true, signature: m.signature || viewer.emailSignature || '' }));
    }

    // Overlay signatures from the viewer's signature library: a mailbox-scoped
    // signature wins for its target; otherwise the default 'all' signature.
    const sigs = await Signature.findAll({ where: { userId: viewer.id } });
    const allSig = sigs.find((x) => x.scope === 'all' && x.isDefault) || sigs.find((x) => x.scope === 'all');
    fromOptions.forEach((o) => {
      const specific = sigs.find((x) => x.scope === 'mailbox' && x.mailboxRef === o.value);
      if (specific) o.signature = specific.bodyHtml || o.signature;
      else if (allSig) o.signature = allSig.bodyHtml || o.signature;
    });

    res.json({
      connected: !!viewer.gmailRefreshToken || (viewer.role === 'admin' && fromOptions.length > 0),
      email: viewer.gmailConnectedEmail,
      defaultSignature: viewer.emailSignature || '',
      fromOptions,
      unread,
      emails,
    });
  } catch (e) { next(e); }
});

/** GET /api/gmail/lead/:leadId/unread — just the unread count (for the badge). */
router.get('/lead/:leadId/unread', requireAuth, async (req, res, next) => {
  try {
    const viewer = await User.findByPk(req.user.id);
    const allowed = await visibleUserIds(viewer);
    const unread = await LeadEmail.count({ where: { leadId: req.params.leadId, userId: { [Op.in]: allowed }, direction: 'inbound', isRead: false } });
    res.json({ unread });
  } catch (e) { next(e); }
});

/** GET /api/gmail/thread/:threadId — every message in a Gmail thread. */
router.get('/thread/:threadId', requireAuth, async (req, res, next) => {
  try {
    const viewer = await User.findByPk(req.user.id);
    const allowed = await visibleUserIds(viewer);
    // Prefer our stored copies (respecting visibility); fall back to live fetch
    // from the viewer's mailbox for anything not yet synced.
    let rows = await LeadEmail.findAll({ where: { threadId: req.params.threadId, userId: { [Op.in]: allowed } }, order: [['sentAt', 'ASC']] });
    if (rows.length === 0 && viewer.gmailRefreshToken) {
      const s = await Settings.findOne({ where: { singleton: 'settings' } });
      try {
        const msgs = await gmail.getThread(s, viewer.getGmailRefreshToken(), viewer.gmailConnectedEmail, req.params.threadId);
        return res.json({ messages: msgs });
      } catch (e) { /* fall through */ }
    }
    res.json({ messages: rows.map((r) => r.toJSON()) });
  } catch (e) { next(e); }
});

// Resolve the mailbox to send from. Accepts a `from` value of "user:<id>" or
// "mailbox:<id>" (or a bare numeric userId for back-compat). Returns a
// normalized sender { id, email, name, getToken(), signature } or null.
async function resolveSender(viewer, from) {
  // Back-compat: bare number = userId.
  let kind = 'user', id = viewer.id;
  if (from && /^(user|mailbox):/.test(String(from))) { const [k, i] = String(from).split(':'); kind = k; id = Number(i); }
  else if (from) { kind = 'user'; id = Number(from); }

  if (kind === 'mailbox') {
    if (viewer.role !== 'admin') return null;
    const m = await Mailbox.findByPk(id);
    if (!m || m.userId !== viewer.id || !m.refreshToken) return null;
    return { id: `mailbox:${m.id}`, email: m.email, name: m.label || m.email, getToken: () => m.getRefreshToken(), signature: m.signature || viewer.emailSignature || '', dbUserId: viewer.id };
  }
  // user mailbox
  if (id === viewer.id) {
    if (!viewer.gmailRefreshToken) return null;
    return { id: viewer.id, email: viewer.gmailConnectedEmail, name: viewer.name, getToken: () => viewer.getGmailRefreshToken(), signature: viewer.emailSignature || '', dbUserId: viewer.id };
  }
  const allowed = await visibleUserIds(viewer);
  if (!allowed.includes(id)) return null;
  const target = await User.findByPk(id);
  if (!target || !target.gmailRefreshToken) return null;
  return { id: target.id, email: target.gmailConnectedEmail, name: target.name, getToken: () => target.getGmailRefreshToken(), signature: target.emailSignature || '', dbUserId: target.id };
}

// Turn requested attachments into MIME-ready parts. Supports uploaded files
// ({filename,mimeType,contentBase64}) and CRM reports ({reportId}).
async function buildAttachments(list, lead) {
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

// Append an entry to a lead's timeline for an email event.
async function emailTimeline(lead, text, author, meta) {
  try {
    const tl = Array.isArray(lead.timeline) ? lead.timeline : [];
    tl.push({ type: 'email', text, time: new Date().toISOString(), author, ...(meta || {}) });
    lead.timeline = tl; lead.changed('timeline', true); lead.lastActivityAt = new Date();
    await lead.save();
  } catch (e) { /* timeline is best-effort */ }
}

/**
 * POST /api/gmail/lead/:leadId/send — send now (or schedule). Handles new mail,
 * reply, reply-all and forward via To/Cc/Bcc + attachments. If sendAt is given,
 * the email is queued and delivered later by the dispatcher.
 */
router.post('/lead/:leadId/send', requireAuth, async (req, res, next) => {
  try {
    const lead = await Lead.findByPk(req.params.leadId);
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });
    const viewer = await User.findByPk(req.user.id);
    const b = req.body || {};
    const sender = await resolveSender(viewer, b.from || b.fromUserId);
    if (!sender) return res.status(400).json({ error: 'Connect a Gmail mailbox first, or pick one you’re allowed to send from.' });

    const to = b.to || lead.email;
    if (!to) return res.status(400).json({ error: 'Add at least one recipient.' });
    if (!b.subject || !b.body) return res.status(400).json({ error: 'Subject and message are both required.' });

    // Scheduled send → queue it.
    if (b.sendAt) {
      const when = new Date(b.sendAt);
      if (isNaN(when.getTime()) || when.getTime() < Date.now() - 60000) return res.status(400).json({ error: 'Pick a valid future date and time.' });
      const sched = await ScheduledEmail.create({
        leadId: lead.id, userId: sender.dbUserId, fromEmail: sender.email,
        toEmail: Array.isArray(to) ? to.join(', ') : to, ccEmail: b.cc || null, bccEmail: b.bcc || null,
        subject: b.subject, bodyHtml: b.body, attachments: b.attachments || null,
        threadId: b.threadId || null, inReplyTo: b.inReplyTo || null,
        timezone: b.timezone || 'Asia/Kolkata', sendAt: when,
      });
      await emailTimeline(lead, `Email scheduled: "${b.subject}" for ${when.toLocaleString('en-IN', { timeZone: b.timezone || 'Asia/Kolkata' })}`, sender.name, { direction: 'scheduled' });
      return res.json({ ok: true, scheduled: true, id: sched.id, sendAt: when });
    }

    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const attachments = await buildAttachments(b.attachments, lead);
    const sent = await gmail.sendMessage(s, sender.getToken(), sender.email, {
      from: sender.email, to, cc: b.cc, bcc: b.bcc,
      subject: b.subject, bodyHtml: b.body, threadId: b.threadId, inReplyTo: b.inReplyTo, attachments,
    });
    await LeadEmail.create({
      leadId: lead.id, userId: sender.dbUserId, gmailMessageId: sent.id, threadId: sent.threadId || b.threadId || '',
      direction: 'outbound', fromEmail: sender.email, fromName: sender.name,
      toEmail: Array.isArray(to) ? to.join(', ') : to, ccEmail: b.cc || null, bccEmail: b.bcc || null,
      subject: b.subject, snippet: String(b.body).replace(/<[^>]+>/g, '').slice(0, 200), bodyHtml: b.body,
      attachments: (attachments || []).map((a) => ({ filename: a.filename, mimeType: a.mimeType })),
      sentAt: new Date(), isRead: true,
    }).catch(() => {});
    await emailTimeline(lead, `Email sent: "${b.subject}"`, sender.name, { direction: 'outbound' });
    res.json({ ok: true, id: sent.id });
  } catch (e) { next(e); }
});

/** GET /api/gmail/lead/:leadId/scheduled — pending scheduled emails for a lead. */
router.get('/lead/:leadId/scheduled', requireAuth, async (req, res, next) => {
  try {
    const viewer = await User.findByPk(req.user.id);
    const allowed = await visibleUserIds(viewer);
    const rows = await ScheduledEmail.findAll({ where: { leadId: req.params.leadId, userId: { [Op.in]: allowed }, status: 'pending' }, order: [['sendAt', 'ASC']] });
    res.json(rows.map((r) => { const o = r.toJSON(); delete o.attachments; return o; }));
  } catch (e) { next(e); }
});

/** POST /api/gmail/scheduled/:id/cancel — cancel a pending scheduled email. */
router.post('/scheduled/:id/cancel', requireAuth, async (req, res, next) => {
  try {
    const viewer = await User.findByPk(req.user.id);
    const allowed = await visibleUserIds(viewer);
    const row = await ScheduledEmail.findByPk(req.params.id);
    if (!row || !allowed.includes(row.userId)) return res.status(404).json({ error: 'Not found.' });
    if (row.status !== 'pending') return res.status(400).json({ error: 'That email already went out or was cancelled.' });
    row.status = 'cancelled'; await row.save();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** GET /api/gmail/lead/:leadId/reports — CRM reports available to attach. */
router.get('/lead/:leadId/reports', requireAuth, async (req, res, next) => {
  try {
    const reports = await Report.findAll({
      where: { leadId: req.params.leadId },
      attributes: ['id', 'businessName', 'createdAt', 'pdfPath'],
      order: [['createdAt', 'DESC']],
    });
    res.json(reports.filter((r) => r.pdfPath).map((r) => ({ _id: r.id, id: r.id, businessName: r.businessName, createdAt: r.createdAt })));
  } catch (e) { next(e); }
});

/** GET /api/gmail/email/:id/attachment/:attId — download an inbound attachment. */
router.get('/email/:id/attachment/:attId', requireAuth, async (req, res, next) => {
  try {
    const viewer = await User.findByPk(req.user.id);
    const allowed = await visibleUserIds(viewer);
    const row = await LeadEmail.findByPk(req.params.id);
    if (!row || !allowed.includes(row.userId)) return res.status(404).json({ error: 'Not found.' });
    const owner = await User.findByPk(row.userId);
    if (!owner || !owner.gmailRefreshToken) return res.status(400).json({ error: 'Mailbox not connected.' });
    const meta = (row.attachments || []).find((a) => a.attachmentId === req.params.attId);
    if (!meta) return res.status(404).json({ error: 'Attachment not found.' });
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const data = await gmail.getAttachment(s, owner.getGmailRefreshToken(), row.gmailMessageId, req.params.attId);
    const buf = Buffer.from(String(data).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${meta.filename}"`);
    res.send(buf);
  } catch (e) { next(e); }
});

/** POST /api/gmail/email/:id/read — mark a synced email read. */
router.post('/email/:id/read', requireAuth, async (req, res, next) => {
  try {
    const viewer = await User.findByPk(req.user.id);
    const allowed = await visibleUserIds(viewer);
    const row = await LeadEmail.findByPk(req.params.id);
    if (!row || !allowed.includes(row.userId)) return res.status(404).json({ error: 'Not found.' });
    row.isRead = true; await row.save();
    const owner = await User.findByPk(row.userId);
    if (owner && owner.gmailRefreshToken) {
      const s = await Settings.findOne({ where: { singleton: 'settings' } });
      gmail.markRead(s, owner.getGmailRefreshToken(), row.gmailMessageId).catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** POST /api/gmail/email/:id/star — toggle star. */
router.post('/email/:id/star', requireAuth, async (req, res, next) => {
  try {
    const viewer = await User.findByPk(req.user.id);
    const allowed = await visibleUserIds(viewer);
    const row = await LeadEmail.findByPk(req.params.id);
    if (!row || !allowed.includes(row.userId)) return res.status(404).json({ error: 'Not found.' });
    row.starred = !row.starred; await row.save();
    res.json({ ok: true, starred: row.starred });
  } catch (e) { next(e); }
});

/**
 * GET /api/gmail/awaiting-reply — leads with an inbound email that has no
 * outbound reply in the same thread yet. Scoped to the viewer's visibility.
 * Splits into `awaiting` (<24h) and `missed` (≥24h since the inbound arrived).
 */
router.get('/awaiting-reply', requireAuth, async (req, res, next) => {
  try {
    const viewer = await User.findByPk(req.user.id);
    const allowed = await visibleUserIds(viewer);
    const rows = await LeadEmail.findAll({
      where: { userId: { [Op.in]: allowed } },
      order: [['sentAt', 'DESC']],
      limit: 2000,
    });

    // Group by thread; a thread needs a reply if its latest message is inbound.
    const byThread = new Map();
    for (const r of rows) {
      const key = r.threadId || `single:${r.gmailMessageId}`;
      if (!byThread.has(key)) byThread.set(key, []);
      byThread.get(key).push(r);
    }
    const pending = [];
    for (const [, msgs] of byThread) {
      msgs.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt)); // newest first
      const latest = msgs[0];
      if (latest.direction !== 'inbound') continue; // already replied (latest outbound)
      // The most recent inbound that still awaits a reply.
      pending.push(latest);
    }

    // Attach lead info; drop any whose lead is gone.
    const leadIds = [...new Set(pending.map((p) => p.leadId))];
    const leads = await Lead.findAll({ where: { id: { [Op.in]: leadIds } }, attributes: ['id', 'firstName', 'lastName', 'website', 'email', 'ownerId'] });
    const leadById = new Map(leads.map((l) => [l.id, l]));

    const now = Date.now();
    const shape = (p) => {
      const lead = leadById.get(p.leadId);
      if (!lead) return null;
      const ageMs = now - new Date(p.sentAt).getTime();
      return {
        emailId: p._id, leadId: p.leadId,
        leadName: `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || lead.website || lead.email || 'Lead',
        ownerId: lead.ownerId,
        fromName: p.fromName, fromEmail: p.fromEmail,
        subject: p.subject, snippet: p.snippet, threadId: p.threadId,
        receivedAt: p.sentAt, ageMs,
      };
    };
    const items = pending.map(shape).filter(Boolean).sort((a, b) => b.ageMs - a.ageMs);
    const DAY = 24 * 60 * 60 * 1000;
    res.json({
      awaiting: items.filter((i) => i.ageMs < DAY),
      missed: items.filter((i) => i.ageMs >= DAY),
    });
  } catch (e) { next(e); }
});

module.exports = router;

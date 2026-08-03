const router = require('express').Router();
const fs = require('fs');
const crypto = require('crypto');
const { User, Lead, LeadEmail, ScheduledEmail, Mailbox, Signature, EmailTemplate, EmailOpen, BusinessBrief, Report, Settings, Op } = require('../models');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const gmail = require('../services/gmail');

// Validate an IANA timezone string; fall back to IST if it's missing or the JS
// runtime doesn't recognise it (prevents "Invalid time zone specified" crashes
// when scheduling emails).
function safeTimezone(tz) {
  const fallback = 'Asia/Kolkata';
  if (!tz || typeof tz !== 'string') return fallback;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; }
  catch { return fallback; }
}

/**
 * Create an open-tracking pixel for an outgoing email and append it to the body.
 * Returns { body, token }. Tracking is automatic on every send. The pixel URL
 * uses APP_URL (the public Railway URL) so the recipient's client can load it.
 * If APP_URL isn't set, we skip tracking gracefully (body unchanged).
 */
async function attachTrackingPixel({ body, leadId, userId, toEmail, subject, threadId }) {
  const base = (process.env.APP_URL || '').replace(/\/+$/, '');
  if (!base) return { body, token: null };
  const token = crypto.randomBytes(16).toString('hex');
  try {
    await EmailOpen.create({
      token, leadId: leadId || null, userId,
      toEmail: Array.isArray(toEmail) ? toEmail.join(', ') : (toEmail || ''),
      subject: subject || '', threadId: threadId || null, sentAt: new Date(),
    });
  } catch (e) { return { body, token: null }; }
  const pixel = `<img src="${base}/api/track/open/${token}.gif" width="1" height="1" alt="" style="display:none;width:1px;height:1px" />`;
  return { body: `${body || ''}${pixel}`, token };
}

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

/** GET /api/gmail/signature-templates — built-in signature gallery, pre-filled
 *  with the agent's details, company social links (admin-set, universal), the
 *  agent's own Calendly link, and a photo (their avatar, or the company logo as
 *  a fallback). */
router.get('/signature-templates', requireAuth, async (req, res, next) => {
  try {
    const sig = require('../services/signatureTemplates');
    const u = await User.findByPk(req.user.id);
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const aliases = Array.isArray(u.aliases) ? u.aliases.filter(Boolean) : [];
    const company = (s && s.socialLinks) || {};
    const mine = (u.socialLinks && typeof u.socialLinks === 'object') ? u.socialLinks : {};
    // Photo: agent avatar first, else the company logo (absolute URL).
    let photo = u.avatar || '';
    if (!photo && s && s.logoPath) {
      const base = (process.env.APP_URL || '').replace(/\/+$/, '');
      photo = /^https?:/i.test(s.logoPath) ? s.logoPath : `${base}${s.logoPath}`;
    }
    const vals = {
      name: aliases[0] || u.name,
      title: u.designation || 'Sales Manager',
      company: (s && s.companyName) || 'Qtonix',
      email: u.gmailConnectedEmail || u.email,
      phone: u.phone || '',
      website: company.website || (s && s.website) || '',
      photo,
      // Company socials are universal; Calendly is the agent's own.
      linkedin: company.linkedin || '',
      facebook: company.facebook || '',
      instagram: company.instagram || '',
      calendly: mine.calendly || '',
    };
    res.json(sig.templates.map((t) => ({ id: t.id, name: t.name, description: t.description, html: sig.render(t, vals) })));
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
 * POST /api/gmail/ai-draft — generate an email draft via OpenAI, acting as a
 * senior sales manager at Qtonix. Pulls the lead's details, AI brief and recent
 * email history for context. Supports several modes (see buildModeInstruction).
 * Returns { subject, body } — body is HTML, subject plain text.
 */
router.post('/ai-draft', requireAuth, async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const key = s.getKey('openai');
    if (!key) return res.status(400).json({ error: 'OpenAI isn’t configured yet. Ask an admin to add the API key in Admin → API keys.' });
    const b = req.body || {};
    const lead = b.leadId ? await Lead.findByPk(b.leadId) : null;

    // Lead-less path (e.g. All Email to a non-lead recipient): draft purely from
    // the agent's custom prompt using the default senior-sales-manager persona.
    if (!lead) {
      const viewer0 = await User.findByPk(req.user.id);
      const aliases0 = Array.isArray(viewer0.aliases) ? viewer0.aliases.filter(Boolean) : [];
      const signName0 = (aliases0[0] || viewer0.name || 'The Qtonix team').trim();
      const prompt = String(b.prompt || '').trim();
      if (!prompt) return res.status(400).json({ error: 'Add a short prompt describing what the email should say.' });
      const system0 = [
        'Act as a senior professional sales manager having experience in Digital Marketing, Social Media Marketing, Website design & Development.',
        'Tone should be friendly, professional, confident. Make the draft well structured and in proper flow, with formatting.',
        `Sign off as "${signName0}" on its own line, after "Best regards," (do NOT sign off as "The Qtonix team").`,
        'FORMATTING: the body must be clean HTML with proper spacing — wrap every paragraph in its own <p> tag, use <br> for line breaks, and <ul><li> for any lists. Separate the greeting, each paragraph, and the sign-off into distinct <p> tags. Do NOT return a single run-on block or plain text with no tags.',
        'Return your answer as strict JSON: {"subject": "...", "body": "<p>...</p><p>...</p>"}. No markdown, no <html> wrapper, no commentary outside the JSON.',
      ].join(' ');
      const userMsg0 = [
        b.to ? `Recipient: ${Array.isArray(b.to) ? b.to.join(', ') : b.to}` : '',
        b.subject ? `Current subject (optional): ${b.subject}` : '',
        `TASK:\n${prompt}`,
      ].filter(Boolean).join('\n');
      const resp0 = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: b.model || 'gpt-4o-mini', messages: [{ role: 'system', content: system0 }, { role: 'user', content: userMsg0 }], max_tokens: 1000, response_format: { type: 'json_object' } }),
      });
      const data0 = await resp0.json();
      if (!resp0.ok) return res.status(502).json({ error: data0.error?.message || 'OpenAI request failed.' });
      const raw0 = data0.choices?.[0]?.message?.content || '{}';
      let parsed0 = {};
      try { parsed0 = JSON.parse(raw0); } catch { parsed0 = { subject: '', body: raw0 }; }
      let body0 = formatEmailBody(parsed0.body || '');
      if (signName0 && signName0 !== 'The Qtonix team') body0 = body0.replace(/The Qtonix team/gi, signName0);
      return res.json({ subject: parsed0.subject || '', body: body0 });
    }

    // Assemble context: lead details, AI brief (if any), recent email history.
    const viewer = await User.findByPk(req.user.id);
    const leadName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || lead.website || 'there';
    const details = [
      `Name: ${leadName}`,
      lead.website ? `Website: ${lead.website}` : '',
      lead.email ? `Email: ${lead.email}` : '',
      lead.phone ? `Phone: ${lead.phone}` : '',
      lead.country ? `Country: ${lead.country}` : '',
      lead.timezone ? `Timezone: ${lead.timezone}` : '',
    ].filter(Boolean).join('\n');

    let briefText = '';
    if (lead.domain) {
      const brief = await BusinessBrief.findOne({ where: { domain: lead.domain }, order: [['createdAt', 'DESC']] });
      if (brief && brief.brief) {
        try { briefText = typeof brief.brief === 'string' ? brief.brief : JSON.stringify(brief.brief); }
        catch { briefText = ''; }
        briefText = briefText.slice(0, 6000);
      }
    }

    // Recent thread/email history for this lead (viewer's scope).
    const allowed = await visibleUserIds(viewer);
    const recent = await LeadEmail.findAll({ where: { leadId: lead.id, userId: { [Op.in]: allowed } }, order: [['sentAt', 'DESC']], limit: 6 });
    const history = recent.reverse().map((m) => `[${m.direction === 'outbound' ? 'Us' : leadName} · ${new Date(m.sentAt).toLocaleDateString()}] ${m.subject ? `(${m.subject}) ` : ''}${String(m.bodyText || m.snippet || '').replace(/\s+/g, ' ').slice(0, 400)}`).join('\n');
    const lastInbound = recent.slice().reverse().find((m) => m.direction === 'inbound');

    const modeInstruction = buildModeInstruction(b, { leadName, phone: lead.phone, briefText, lastInbound, history });

    // The name the agent signs off with: their first client-facing alias (a
    // "sudo name"), falling back to their real name.
    const aliases = Array.isArray(viewer.aliases) ? viewer.aliases.filter(Boolean) : [];
    const signName = (aliases[0] || viewer.name || 'The Qtonix team').trim();

    const system = [
      'You are a senior sales manager at Qtonix, a digital marketing and website design company.',
      'You write emails to prospects and clients. Tone: professional, warm and friendly, confident but never pushy.',
      `Keep emails well-structured and concise. Sign off as "${signName}" on its own line, after "Best regards," (do NOT sign off as "The Qtonix team").`,
      'FORMATTING: the body must be clean HTML with proper spacing — wrap every paragraph in its own <p> tag, use <br> for line breaks, and <ul><li> for any lists. Separate the greeting, each paragraph, and the sign-off into distinct <p> tags. Do NOT return a single run-on block or plain text with no tags.',
      'Return your answer as strict JSON: {"subject": "...", "body": "<p>...</p><p>...</p>"}. No markdown, no <html> wrapper, no commentary outside the JSON.',
    ].join(' ');

    const userMsg = [
      'LEAD DETAILS:', details,
      briefText ? `\nAI BRIEF (use to personalise and add value):\n${briefText}` : '',
      history ? `\nRECENT EMAIL HISTORY (most recent last):\n${history}` : '',
      `\nTASK:\n${modeInstruction}`,
    ].filter(Boolean).join('\n');

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: b.model || 'gpt-4o-mini',
        messages: [{ role: 'system', content: system }, { role: 'user', content: userMsg }],
        max_tokens: 1000,
        response_format: { type: 'json_object' },
      }),
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(502).json({ error: data.error?.message || 'OpenAI request failed.' });
    const raw = data.choices?.[0]?.message?.content || '{}';
    let parsed = {};
    try { parsed = JSON.parse(raw); } catch { parsed = { subject: '', body: raw }; }
    let body = formatEmailBody(parsed.body || '');
    // Safety net: if the model still signed off generically, swap in the agent's
    // sign-off name.
    if (signName && signName !== 'The Qtonix team') {
      body = body.replace(/The Qtonix team/gi, signName);
    }
    res.json({ subject: parsed.subject || '', body });
  } catch (e) { next(e); }
});

/**
 * Turn whatever the model returns (plain text, single-newline lines, or <p>
 * tags whose margins a contentEditable would collapse) into clean, well-spaced
 * paragraphs. Each paragraph gets an explicit bottom margin via inline style so
 * the gaps survive both the editor and the final sent email.
 */
function formatEmailBody(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  // If it's HTML, flatten block tags back to newlines so we can re-space evenly.
  if (/<(p|br|div|ul|ol|li|table)\b/i.test(s)) {
    s = s
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, '\n\n')
      .replace(/<\s*li\b[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, '') // strip any remaining tags
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>');
  }
  // Split into paragraphs on blank lines; if the model used single newlines
  // only (the common failure), treat each non-empty line as its own paragraph.
  const hasBlankLines = /\n\s*\n/.test(s);
  const parts = hasBlankLines
    ? s.split(/\n\s*\n/)
    : s.split(/\n/);
  const paras = parts.map((p) => p.trim()).filter(Boolean);
  return paras
    .map((p) => `<p style="margin:0 0 14px 0">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

// Translate the requested mode + inputs into a concrete instruction for the LLM.
function buildModeInstruction(b, ctx) {
  const { leadName, phone, briefText, lastInbound, history } = ctx;
  switch (b.mode) {
    case 'technical':
      return `Write a detailed first "technical" outreach email to ${leadName}. Use the AI brief above to reference specific, concrete observations about their website and online presence, demonstrating genuine expertise and building confidence. Explain briefly how Qtonix can help. End by asking them to share the best date and time for a detailed meeting/call. ${briefText ? '' : 'If no brief is available, keep the technical observations general but still credible.'}`;
    case 'followup':
      return `Write a friendly follow-up reminder to ${leadName}. ${lastInbound ? `Their last message to us said: "${String(lastInbound.bodyText || lastInbound.snippet || '').slice(0, 500)}". Reference it naturally.` : 'Reference our previous conversation naturally.'} Politely ask for an update, and include one or two attention-grabbing points (a fresh insight, a quick win, or a relevant result) to re-engage them.`;
    case 'newreminder':
      return `Write a reminder email to ${leadName} based on this instruction from the sales rep: "${b.prompt || 'Send a gentle reminder.'}"`;
    case 'voicemail':
      return `Write a short email to ${leadName} explaining that we tried to call them${phone ? ` on ${phone}` : ''} but it went to voicemail. Politely ask them to share their availability for a quick call. Keep it brief and friendly.`;
    case 'meeting': {
      const when = [b.meetingDate, b.meetingTime].filter(Boolean).join(' at ');
      return `Write an email to ${leadName} requesting a meeting${when ? ` on ${when}${b.timezone ? ` (${b.timezone})` : ''}` : ''}. Propose the time clearly, explain briefly what we'll cover, and ask them to confirm or suggest an alternative.`;
    }
    case 'custom':
    default:
      return b.prompt || 'Write a professional, friendly email to this lead.';
  }
}

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

    // From-address options depend on the viewer's role AND this lead's owner:
    //   admin   → all admins + the lead owner + the owner's manager
    //   manager → self + the lead owner / owning agent
    //   agent   → self only
    let fromUserIds = new Set();
    const owner = lead.ownerId ? await User.findByPk(lead.ownerId) : null;
    if (viewer.role === 'admin') {
      const admins = await User.findAll({ where: { role: 'admin', active: true }, attributes: ['id'] });
      admins.forEach((a) => fromUserIds.add(a.id));
      if (owner) {
        fromUserIds.add(owner.id);
        if (owner.managerId) fromUserIds.add(owner.managerId);
      }
    } else if (viewer.role === 'manager') {
      fromUserIds.add(viewer.id);
      if (owner) fromUserIds.add(owner.id);
    } else {
      fromUserIds.add(viewer.id);
    }
    // Keep only those actually in the viewer's visibility scope and connected.
    const scopeUsers = await User.findAll({ where: { id: { [Op.in]: [...fromUserIds] }, gmailRefreshToken: { [Op.ne]: null } }, attributes: ['id', 'name', 'gmailConnectedEmail', 'emailSignature'] });
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
/**
 * Ensure a message's attachments and inline images are hosted on ImageKit and
 * its HTML has cid: references rewritten to real URLs. Downloads from Gmail once,
 * caches the hosted URL back onto the row so we don't re-upload. Best-effort:
 * failures leave the original data intact.
 */
async function hydrateMedia(row, viewer, settings) {
  try {
    const imagekit = require('../services/imagekit');
    if (!(await imagekit.isConfigured())) return row.toJSON();
    const owner = await User.findByPk(row.userId);
    const token = owner && owner.gmailRefreshToken ? owner.getGmailRefreshToken() : (viewer.gmailRefreshToken ? viewer.getGmailRefreshToken() : null);
    if (!token) return row.toJSON();
    const folder = imagekit.emailFolder(owner || viewer);
    let changed = false;
    let html = row.bodyHtml || '';

    // Inline images: upload each, then rewrite its cid: reference in the HTML.
    const inlines = Array.isArray(row.inlines) ? [...row.inlines] : [];
    for (const inl of inlines) {
      if (!inl.url && inl.attachmentId) {
        try {
          const raw = await gmail.getAttachment(settings, token, row.gmailMessageId, inl.attachmentId);
          const b64 = String(raw || '').replace(/-/g, '+').replace(/_/g, '/');
          const up = await imagekit.uploadFile({ base64: b64, fileName: inl.filename || 'image', folder });
          inl.url = up.url; changed = true;
        } catch (e) { /* leave as-is */ }
      }
      if (inl.url && inl.contentId) {
        const cid = inl.contentId.replace(/^<|>$/g, '');
        html = html.replace(new RegExp(`cid:${cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), inl.url);
      }
    }

    // File attachments: re-host so the CRM can link them directly.
    const attachments = Array.isArray(row.attachments) ? [...row.attachments] : [];
    for (const att of attachments) {
      if (!att.url && att.attachmentId) {
        try {
          const raw = await gmail.getAttachment(settings, token, row.gmailMessageId, att.attachmentId);
          const b64 = String(raw || '').replace(/-/g, '+').replace(/_/g, '/');
          const up = await imagekit.uploadFile({ base64: b64, fileName: att.filename || 'attachment', folder });
          att.url = up.url; att.size = att.size || up.size; changed = true;
        } catch (e) { /* leave as-is */ }
      }
    }

    if (changed || html !== row.bodyHtml) {
      row.inlines = inlines; row.attachments = attachments; row.bodyHtml = html;
      row.changed('inlines', true); row.changed('attachments', true);
      await row.save();
    }
    return row.toJSON();
  } catch (e) {
    return row.toJSON();
  }
}

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
    const settings = await Settings.findOne({ where: { singleton: 'settings' } });
    const messages = [];
    for (const r of rows) messages.push(await hydrateMedia(r, viewer, settings));
    res.json({ messages });
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
        timezone: safeTimezone(b.timezone), sendAt: when,
      });
      await emailTimeline(lead, `Email scheduled: "${b.subject}" for ${when.toLocaleString('en-IN', { timeZone: safeTimezone(b.timezone) })}`, sender.name, { direction: 'scheduled' });
      return res.json({ ok: true, scheduled: true, id: sched.id, sendAt: when });
    }

    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const attachments = await buildAttachments(b.attachments, lead);
    // Add an open-tracking pixel (automatic on every send).
    const track = await attachTrackingPixel({ body: b.body, leadId: lead.id, userId: sender.dbUserId, toEmail: to, subject: b.subject, threadId: b.threadId });
    const sent = await gmail.sendMessage(s, sender.getToken(), sender.email, {
      from: sender.email, to, cc: b.cc, bcc: b.bcc,
      subject: b.subject, bodyHtml: track.body, threadId: b.threadId, inReplyTo: b.inReplyTo, attachments,
    });
    // Record the Gmail message/thread id on the tracking row.
    if (track.token) { try { await EmailOpen.update({ gmailMessageId: sent.id, threadId: sent.threadId || b.threadId || null }, { where: { token: track.token } }); } catch (e) { /* */ } }
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
    // The CRM went live on 3 Aug 2026 — inbound mail received before that is
    // pre-launch and must not surface as awaiting/missed replies.
    const GO_LIVE = new Date('2026-08-03T00:00:00Z').getTime();
    for (const [, msgs] of byThread) {
      msgs.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt)); // newest first
      const latest = msgs[0];
      if (latest.direction !== 'inbound') continue; // already replied (latest outbound)
      if (latest.dismissedFromMissed) continue; // an admin cleared this one
      if (new Date(latest.sentAt).getTime() < GO_LIVE) continue; // pre-launch
      // The most recent inbound that still awaits a reply.
      pending.push(latest);
    }

    // Attach lead info; drop any whose lead is gone.
    const leadIds = [...new Set(pending.map((p) => p.leadId))];
    const leads = await Lead.findAll({ where: { id: { [Op.in]: leadIds } }, attributes: ['id', 'firstName', 'lastName', 'website', 'email', 'ownerId', 'ownerName'] });
    const leadById = new Map(leads.map((l) => [l.id, l]));
    // Owner names for the dashboard rows (who is responsible for replying).
    const ownerIds = [...new Set(leads.map((l) => l.ownerId).filter(Boolean))];
    const owners = await User.findAll({ where: { id: { [Op.in]: ownerIds } }, attributes: ['id', 'name', 'role'] });
    const ownerById = new Map(owners.map((u) => [u.id, u]));

    const now = Date.now();
    const shape = (p) => {
      const lead = leadById.get(p.leadId);
      if (!lead) return null;
      const ageMs = now - new Date(p.sentAt).getTime();
      const owner = ownerById.get(lead.ownerId);
      return {
        emailId: p.id, leadId: p.leadId,
        leadName: `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || lead.website || lead.email || 'Lead',
        ownerId: lead.ownerId,
        ownerName: owner ? owner.name : (lead.ownerName || ''),
        ownerRole: owner ? owner.role : '',
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

/**
 * POST /api/gmail/awaiting-reply/:emailId/dismiss — admin clears a missed
 * commitment for everyone (marks the inbound email handled globally).
 */
router.post('/awaiting-reply/:emailId/dismiss', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const row = await LeadEmail.findByPk(req.params.emailId);
    if (!row) return res.status(404).json({ error: 'Email not found.' });
    row.dismissedFromMissed = true;
    await row.save();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// --- Email templates --------------------------------------------------------

/** GET /api/gmail/templates — the user's own templates plus any global ones.
 *  Admins see all templates (own + everyone's + global). */
router.get('/templates', requireAuth, async (req, res, next) => {
  try {
    const where = req.user.role === 'admin'
      ? {}
      : { [Op.or]: [{ userId: req.user.id }, { isGlobal: true }] };
    const rows = await EmailTemplate.findAll({ where, order: [['isGlobal', 'DESC'], ['name', 'ASC']] });
    // Tag ownership for the UI.
    const out = rows.map((r) => { const o = r.toJSON(); o.mine = r.userId === req.user.id; return o; });
    res.json(out);
  } catch (e) { next(e); }
});

/** POST /api/gmail/templates — create. Only admins may set isGlobal. */
router.post('/templates', requireAuth, async (req, res, next) => {
  try {
    const b = req.body || {};
    const row = await EmailTemplate.create({
      userId: req.user.id, name: (b.name || 'Template').slice(0, 160),
      subject: b.subject || '', bodyHtml: b.bodyHtml || '',
      isGlobal: req.user.role === 'admin' ? !!b.isGlobal : false,
    });
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

/** PUT /api/gmail/templates/:id — update own (or any, for admins). */
router.put('/templates/:id', requireAuth, async (req, res, next) => {
  try {
    const row = await EmailTemplate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Template not found.' });
    if (row.userId !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
    const b = req.body || {};
    if (b.name !== undefined) row.name = String(b.name).slice(0, 160);
    if (b.subject !== undefined) row.subject = b.subject;
    if (b.bodyHtml !== undefined) row.bodyHtml = b.bodyHtml;
    if (b.isGlobal !== undefined && req.user.role === 'admin') row.isGlobal = !!b.isGlobal;
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

/** DELETE /api/gmail/templates/:id — delete own (or any, for admins). */
router.delete('/templates/:id', requireAuth, async (req, res, next) => {
  try {
    const row = await EmailTemplate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Template not found.' });
    if (row.userId !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
    await row.destroy();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** GET /api/gmail/template-variables — the list of variables templates can use. */
router.get('/template-variables', requireAuth, (req, res) => {
  res.json([
    { key: 'lead.firstName', label: 'Lead First Name' },
    { key: 'lead.lastName', label: 'Lead Last Name' },
    { key: 'lead.fullName', label: 'Lead Full Name' },
    { key: 'lead.domain', label: 'Domain Name' },
    { key: 'lead.website', label: 'Website' },
    { key: 'lead.country', label: 'Country' },
    { key: 'lead.email', label: 'Email' },
    { key: 'lead.phone', label: 'Phone' },
    { key: 'brief.mobileSpeed', label: 'PageSpeed (Mobile)' },
    { key: 'brief.desktopSpeed', label: 'PageSpeed (Desktop)' },
    { key: 'brief.aiScore', label: 'AI Score' },
    { key: 'brief.keywords', label: 'Keyword List' },
    { key: 'brief.competitors', label: 'Competitor List' },
    { key: 'brief.painPoints', label: 'Pain Points' },
  ]);
});

// Build the variable → value map for a lead (pulls brief values when present).
async function templateVars(lead) {
  const v = {
    'lead.firstName': lead.firstName || '',
    'lead.lastName': lead.lastName || '',
    'lead.fullName': `${lead.firstName || ''} ${lead.lastName || ''}`.trim(),
    'lead.domain': lead.domain || '',
    'lead.website': lead.website || '',
    'lead.country': lead.country || '',
    'lead.email': lead.email || '',
    'lead.phone': lead.phone || '',
    'brief.mobileSpeed': '', 'brief.desktopSpeed': '', 'brief.aiScore': '',
    'brief.keywords': '', 'brief.competitors': '', 'brief.painPoints': '',
  };
  if (lead.domain) {
    const row = await BusinessBrief.findOne({ where: { domain: lead.domain }, order: [['createdAt', 'DESC']] });
    const b = row && row.brief ? (typeof row.brief === 'string' ? safeJson(row.brief) : row.brief) : null;
    if (b) {
      // Brief shape varies; probe common locations defensively.
      const pick = (...paths) => { for (const p of paths) { const val = p; if (val !== undefined && val !== null && val !== '') return val; } return ''; };
      v['brief.mobileSpeed'] = String(pick(b.pageSpeedMobile, b.mobileSpeed, b.speed?.mobile, b.scores?.mobileSpeed) || '');
      v['brief.desktopSpeed'] = String(pick(b.pageSpeedDesktop, b.desktopSpeed, b.speed?.desktop, b.scores?.desktopSpeed) || '');
      v['brief.aiScore'] = String(pick(b.aiScore, b.scores?.ai, b.aiVisibilityScore) || '');
      const kw = pick(b.keywords, b.keywordList, b.topKeywords);
      v['brief.keywords'] = Array.isArray(kw) ? kw.map((k) => (k.keyword || k.term || k)).slice(0, 15).join(', ') : String(kw || '');
      const comp = pick(b.competitors, b.competitorList);
      v['brief.competitors'] = Array.isArray(comp) ? comp.map((c) => (c.name || c.domain || c)).slice(0, 15).join(', ') : String(comp || '');
      const pp = pick(b.painPoints, b.pain_points, b.issues);
      v['brief.painPoints'] = Array.isArray(pp) ? pp.map((p) => (p.text || p.title || p)).slice(0, 15).join('; ') : String(pp || '');
    }
  }
  return v;
}
function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

// Replace {{var}} tokens in an HTML/text string using a value map.
function applyVars(str, vars) {
  return String(str || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

/** POST /api/gmail/templates/:id/apply — return the template with variables
 *  resolved against a given lead. Body: { leadId }. */
router.post('/templates/:id/apply', requireAuth, async (req, res, next) => {
  try {
    const tpl = await EmailTemplate.findByPk(req.params.id);
    if (!tpl) return res.status(404).json({ error: 'Template not found.' });
    if (tpl.userId !== req.user.id && !tpl.isGlobal && req.user.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
    const lead = await Lead.findByPk((req.body || {}).leadId);
    if (!lead) return res.status(400).json({ error: 'Lead not found.' });
    const vars = await templateVars(lead);
    res.json({ subject: applyVars(tpl.subject, vars), body: applyVars(tpl.bodyHtml, vars) });
  } catch (e) { next(e); }
});

// --- All Email (Gmail-style mailbox browser) --------------------------------

/**
 * Resolve which connected mailbox the viewer is browsing in All Email.
 * By default it's their own. Admins may pass ?as=<userId> to view another
 * connected user's mailbox. Returns { user, token, settings } or null.
 */
async function resolveBrowseMailbox(viewer, asUserId) {
  const settings = await Settings.findOne({ where: { singleton: 'settings' } });
  let target = viewer;
  if (asUserId && viewer.role === 'admin') {
    const u = await User.findByPk(Number(asUserId));
    if (u && u.gmailRefreshToken) target = u;
  }
  if (!target.gmailRefreshToken) return null;
  return { user: target, token: target.getGmailRefreshToken(), settings };
}

/** GET /api/gmail/all/mailboxes — connected mailboxes the viewer can browse.
 *  Everyone gets their own; admins get every connected user + extra mailboxes. */
router.get('/all/mailboxes', requireAuth, async (req, res, next) => {
  try {
    const viewer = await User.findByPk(req.user.id);
    const list = [];
    if (viewer.gmailRefreshToken && viewer.gmailConnectedEmail) list.push({ value: String(viewer.id), label: 'Me', email: viewer.gmailConnectedEmail, signature: viewer.emailSignature || '' });
    if (viewer.role === 'admin') {
      const users = await User.findAll({ where: { gmailRefreshToken: { [Op.ne]: null }, id: { [Op.ne]: viewer.id } }, attributes: ['id', 'name', 'gmailConnectedEmail', 'emailSignature'] });
      users.forEach((u) => list.push({ value: String(u.id), label: u.name, email: u.gmailConnectedEmail, signature: u.emailSignature || '' }));
    }
    res.json({ mailboxes: list, isAdmin: viewer.role === 'admin' });
  } catch (e) { next(e); }
});

/** GET /api/gmail/all/folder — live list of a Gmail folder/label.
 *  Query: box (INBOX|SENT|SPAM|TRASH|STARRED|ALL), labelId, q, pageToken, as. */
router.get('/all/folder', requireAuth, async (req, res, next) => {
  try {
    const viewer = await User.findByPk(req.user.id);
    const mb = await resolveBrowseMailbox(viewer, req.query.as);
    if (!mb) return res.status(400).json({ error: 'No connected mailbox. Connect Gmail in Email settings first.' });
    const box = String(req.query.box || 'INBOX').toUpperCase();
    const out = await gmail.listFolder(mb.settings, mb.token, mb.user.gmailConnectedEmail, {
      box, labelId: req.query.labelId || null, q: req.query.q || '',
      max: Math.min(50, Number(req.query.max) || 25), pageToken: req.query.pageToken || null,
    });
    // Flag which messages are tied to a CRM lead (so the UI can hide delete for
    // those). Match by our stored copies first (fast), else by counterparty.
    const ids = out.messages.map((m) => m.gmailMessageId);
    const linked = ids.length ? await LeadEmail.findAll({ where: { gmailMessageId: { [Op.in]: ids } }, attributes: ['gmailMessageId', 'leadId'] }) : [];
    const leadByMsg = new Map(linked.map((r) => [r.gmailMessageId, r.leadId]));
    out.messages.forEach((m) => { m.leadId = leadByMsg.get(m.gmailMessageId) || null; });
    res.json(out);
  } catch (e) { next(e); }
});

/** GET /api/gmail/all/labels — the mailbox's Gmail labels. */
router.get('/all/labels', requireAuth, async (req, res, next) => {
  try {
    const viewer = await User.findByPk(req.user.id);
    const mb = await resolveBrowseMailbox(viewer, req.query.as);
    if (!mb) return res.json({ labels: [] });
    const labels = await gmail.listLabels(mb.settings, mb.token);
    res.json({ labels });
  } catch (e) { next(e); }
});

/** POST /api/gmail/all/labels — create a custom label. Body: { name, color, as }. */
router.post('/all/labels', requireAuth, async (req, res, next) => {
  try {
    const viewer = await User.findByPk(req.user.id);
    const mb = await resolveBrowseMailbox(viewer, (req.body || {}).as);
    if (!mb) return res.status(400).json({ error: 'No connected mailbox.' });
    const b = req.body || {};
    if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'Label name is required.' });
    const label = await gmail.createLabel(mb.settings, mb.token, String(b.name).trim(), b.color || null);
    res.json(label);
  } catch (e) { next(e); }
});

/** PATCH /api/gmail/all/labels/:id — rename/recolor. Body: { name, color, as }. */
router.patch('/all/labels/:id', requireAuth, async (req, res, next) => {
  try {
    const viewer = await User.findByPk(req.user.id);
    const mb = await resolveBrowseMailbox(viewer, (req.body || {}).as);
    if (!mb) return res.status(400).json({ error: 'No connected mailbox.' });
    const patch = {};
    if (req.body.name !== undefined) patch.name = String(req.body.name).trim();
    if (req.body.color !== undefined) patch.color = req.body.color;
    const label = await gmail.updateLabel(mb.settings, mb.token, req.params.id, patch);
    res.json(label);
  } catch (e) { next(e); }
});

/** DELETE /api/gmail/all/labels/:id?as= — delete a custom label. */
router.delete('/all/labels/:id', requireAuth, async (req, res, next) => {
  try {
    const viewer = await User.findByPk(req.user.id);
    const mb = await resolveBrowseMailbox(viewer, req.query.as);
    if (!mb) return res.status(400).json({ error: 'No connected mailbox.' });
    await gmail.deleteLabel(mb.settings, mb.token, req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** POST /api/gmail/all/message/:gmailMessageId/labels — apply/remove labels.
 *  Body: { add:[labelId], remove:[labelId], as }. */
router.post('/all/message/:gmailMessageId/labels', requireAuth, async (req, res, next) => {
  try {
    const viewer = await User.findByPk(req.user.id);
    const mb = await resolveBrowseMailbox(viewer, (req.body || {}).as);
    if (!mb) return res.status(400).json({ error: 'No connected mailbox.' });
    await gmail.modifyMessageLabels(mb.settings, mb.token, req.params.gmailMessageId, { add: req.body.add || [], remove: req.body.remove || [] });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** POST /api/gmail/all/message/:gmailMessageId/star — star/unstar. Body {starred, as}. */
router.post('/all/message/:gmailMessageId/star', requireAuth, async (req, res, next) => {
  try {
    const viewer = await User.findByPk(req.user.id);
    const mb = await resolveBrowseMailbox(viewer, (req.body || {}).as);
    if (!mb) return res.status(400).json({ error: 'No connected mailbox.' });
    await gmail.setStar(mb.settings, mb.token, req.params.gmailMessageId, !!req.body.starred);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** DELETE /api/gmail/all/message/:gmailMessageId?as= — trash a message. Only
 *  allowed when the email is NOT tied to a CRM lead. */
router.delete('/all/message/:gmailMessageId', requireAuth, async (req, res, next) => {
  try {
    const viewer = await User.findByPk(req.user.id);
    const mb = await resolveBrowseMailbox(viewer, req.query.as);
    if (!mb) return res.status(400).json({ error: 'No connected mailbox.' });
    // Guard: refuse to delete an email that belongs to a CRM lead thread.
    const linked = await LeadEmail.findOne({ where: { gmailMessageId: req.params.gmailMessageId } });
    if (linked && linked.leadId) return res.status(400).json({ error: 'This email is linked to a lead and can’t be deleted here.' });
    await gmail.trashMessage(mb.settings, mb.token, req.params.gmailMessageId);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** GET /api/gmail/all/thread/:threadId?as= — full thread for the reader,
 *  fetched live from the browsed mailbox (works for non-lead emails too). */
router.get('/all/thread/:threadId', requireAuth, async (req, res, next) => {
  try {
    const viewer = await User.findByPk(req.user.id);
    const mb = await resolveBrowseMailbox(viewer, req.query.as);
    if (!mb) return res.status(400).json({ error: 'No connected mailbox.' });
    const msgs = await gmail.getThread(mb.settings, mb.token, mb.user.gmailConnectedEmail, req.params.threadId);
    res.json({ messages: msgs });
  } catch (e) { next(e); }
});

/** POST /api/gmail/all/send — send a new mail / reply / forward directly from
 *  the browsed mailbox, independent of any lead. Body: { to, cc, bcc, subject,
 *  body, threadId, inReplyTo, attachments:[{filename,mimeType,contentBase64}],
 *  as }. If the thread or recipient matches a known lead, we also log the
 *  outbound copy against that lead so the CRM stays in sync. */
router.post('/all/send', requireAuth, async (req, res, next) => {
  try {
    const viewer = await User.findByPk(req.user.id);
    const b = req.body || {};
    const mb = await resolveBrowseMailbox(viewer, b.as);
    if (!mb) return res.status(400).json({ error: 'Connect a Gmail mailbox first.' });
    const to = b.to;
    if (!to || (Array.isArray(to) && to.length === 0)) return res.status(400).json({ error: 'Add at least one recipient.' });
    if (!b.subject || !b.body) return res.status(400).json({ error: 'Subject and message are both required.' });

    // Attachments here arrive already base64-encoded from the browser (no CRM
    // report shortcut in All Email), so pass them straight through.
    const attachments = Array.isArray(b.attachments)
      ? b.attachments.filter((a) => a && a.contentBase64).map((a) => ({ filename: a.filename || 'attachment', mimeType: a.mimeType || 'application/octet-stream', contentBase64: a.contentBase64 }))
      : [];

    // Resolve a lead link first (so tracking can attribute to the lead).
    let linkedLeadId = null;
    try {
      if (b.threadId) {
        const existing = await LeadEmail.findOne({ where: { threadId: b.threadId, leadId: { [Op.ne]: null } } });
        if (existing) linkedLeadId = existing.leadId;
      }
      if (!linkedLeadId) {
        const firstTo = (Array.isArray(to) ? to[0] : String(to).split(',')[0] || '').trim().toLowerCase();
        if (firstTo) { const lead = await Lead.findOne({ where: { email: firstTo } }); if (lead) linkedLeadId = lead.id; }
      }
    } catch (e) { /* */ }

    // Scheduled send → queue it (tracking pixel is added by the dispatcher).
    if (b.sendAt) {
      const when = new Date(b.sendAt);
      if (isNaN(when.getTime()) || when.getTime() < Date.now() - 60000) return res.status(400).json({ error: 'Pick a valid future date and time.' });
      const sched = await ScheduledEmail.create({
        leadId: linkedLeadId, userId: mb.user.id, fromEmail: mb.user.gmailConnectedEmail,
        toEmail: Array.isArray(to) ? to.join(', ') : to, ccEmail: b.cc || null, bccEmail: b.bcc || null,
        subject: b.subject, bodyHtml: b.body, attachments: attachments.length ? attachments : null,
        threadId: b.threadId || null, inReplyTo: b.inReplyTo || null,
        timezone: safeTimezone(b.timezone), sendAt: when,
      });
      return res.json({ ok: true, scheduled: true, id: sched.id, sendAt: when });
    }

    const track = await attachTrackingPixel({ body: b.body, leadId: linkedLeadId, userId: mb.user.id, toEmail: to, subject: b.subject, threadId: b.threadId });
    const sent = await gmail.sendMessage(mb.settings, mb.token, mb.user.gmailConnectedEmail, {
      from: mb.user.gmailConnectedEmail, to, cc: b.cc, bcc: b.bcc,
      subject: b.subject, bodyHtml: track.body, threadId: b.threadId, inReplyTo: b.inReplyTo, attachments,
    });
    if (track.token) { try { await EmailOpen.update({ gmailMessageId: sent.id, threadId: sent.threadId || b.threadId || null }, { where: { token: track.token } }); } catch (e) { /* */ } }

    // Best-effort: record the outbound message so it shows on the lead too.
    try {
      const toStr = Array.isArray(to) ? to.join(', ') : String(to);
      await LeadEmail.create({
        leadId: linkedLeadId, userId: mb.user.id, gmailMessageId: sent.id, threadId: sent.threadId || b.threadId || '',
        direction: 'outbound', fromEmail: mb.user.gmailConnectedEmail, fromName: mb.user.name,
        toEmail: toStr, ccEmail: b.cc || null, bccEmail: b.bcc || null,
        subject: b.subject, snippet: String(b.body).replace(/<[^>]+>/g, '').slice(0, 200), bodyHtml: b.body,
        attachments: attachments.map((a) => ({ filename: a.filename, mimeType: a.mimeType })),
        sentAt: new Date(), isRead: true,
      });
    } catch (e) { /* logging is best-effort */ }

    res.json({ ok: true, id: sent.id, threadId: sent.threadId });
  } catch (e) { next(e); }
});

/** GET /api/gmail/unopened — tracked emails the viewer sent that haven't been
 *  opened after 24h, for the dashboard follow-up nudge. Scoped by visibility. */
router.get('/unopened', requireAuth, async (req, res, next) => {
  try {
    const viewer = await User.findByPk(req.user.id);
    const allowed = await visibleUserIds(viewer);
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await EmailOpen.findAll({
      where: { userId: { [Op.in]: allowed }, firstOpenAt: null, sentAt: { [Op.lte]: cutoff } },
      order: [['sentAt', 'DESC']], limit: 100,
    });
    // Attach owner + lead names.
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const leadIds = [...new Set(rows.map((r) => r.leadId).filter(Boolean))];
    const users = await User.findAll({ where: { id: { [Op.in]: userIds } }, attributes: ['id', 'name'] });
    const leads = leadIds.length ? await Lead.findAll({ where: { id: { [Op.in]: leadIds } }, attributes: ['id', 'firstName', 'lastName'] }) : [];
    const uById = new Map(users.map((u) => [u.id, u.name]));
    const lById = new Map(leads.map((l) => [l.id, `${l.firstName || ''} ${l.lastName || ''}`.trim()]));
    const now = Date.now();
    res.json({
      items: rows.map((r) => ({
        id: r.id, leadId: r.leadId, leadName: r.leadId ? (lById.get(r.leadId) || 'Lead') : null,
        ownerName: uById.get(r.userId) || '', toEmail: r.toEmail, subject: r.subject,
        sentAt: r.sentAt, ageMs: now - new Date(r.sentAt).getTime(),
      })),
    });
  } catch (e) { next(e); }
});

module.exports = router;

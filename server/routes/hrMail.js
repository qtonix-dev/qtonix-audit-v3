/**
 * HR recruitment email + calendar, built on the shared recruitment mailbox
 * (e.g. career@qtonix.com). All recruiters send from and read this one inbox,
 * so candidates always correspond with a single address.
 *
 * Reuses the CRM's gmail service (searchMessages/getThread/sendMessage/
 * createCalendarEvent). The refresh token lives in Settings.apiKeys.hrMailboxToken
 * and the address in Settings.hrMailbox.email.
 */
const router = require('express').Router();
const { Settings, HrCandidate, HrJobPost, HrUser } = require('../models');
const gmail = require('../services/gmail');
const { requireHrAccess, requireScheduler } = require('../middleware/hrAuth');

async function hrMailbox() {
  const s = await Settings.findOne({ where: { singleton: 'settings' } });
  const token = s.getKey('hrMailboxToken');
  const email = (s.hrMailbox && s.hrMailbox.email) || '';
  return { s, token, email };
}

// Connection status (any HR user can see whether the shared inbox is linked).
router.get('/mailbox/status', requireHrAccess, async (req, res, next) => {
  try {
    const { token, email, s } = await hrMailbox();
    res.json({ connected: !!token, email, connectedAt: (s.hrMailbox && s.hrMailbox.connectedAt) || null, configured: gmail.isConfigured(s) });
  } catch (e) { next(e); }
});

// Begin linking the shared mailbox (HR admin only). Reuses the same Google
// OAuth app as the CRM; the state marks this as the HR mailbox.
router.get('/mailbox/connect', requireHrAccess, async (req, res, next) => {
  try {
    if (!req.isHrAdmin) return res.status(403).json({ error: 'Only an admin can link the recruitment mailbox.' });
    const { s } = await hrMailbox();
    if (!gmail.isConfigured(s)) return res.status(400).json({ error: 'Google isn’t set up yet. Add the app credentials in CRM Admin → API keys.' });
    if (!gmail.hasValidBaseUrl()) return res.status(400).json({ error: 'The server’s public URL (APP_URL) isn’t configured.' });
    const jwt = require('jsonwebtoken');
    const state = jwt.sign({ hrMailbox: true }, process.env.JWT_SECRET || 'change-me-in-production', { expiresIn: '10m' });
    res.json({ url: gmail.authUrl(s, state) });
  } catch (e) { next(e); }
});

router.post('/mailbox/disconnect', requireHrAccess, async (req, res, next) => {
  try {
    if (!req.isHrAdmin) return res.status(403).json({ error: 'Only an admin can unlink the recruitment mailbox.' });
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const keys = { ...(s.apiKeys || {}) }; keys.hrMailboxToken = '';
    s.apiKeys = keys; s.changed('apiKeys', true);
    s.hrMailbox = { email: '', connectedAt: null };
    await s.save();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// The candidate's email conversation (searched in the shared mailbox by their
// address). Returns normalised messages, newest last.
router.get('/candidates/:id/emails', requireHrAccess, async (req, res, next) => {
  try {
    const { s, token, email } = await hrMailbox();
    if (!token) return res.json({ connected: false, messages: [] });
    const cand = await HrCandidate.findByPk(req.params.id);
    if (!cand) return res.status(404).json({ error: 'Candidate not found.' });
    if (!cand.email) return res.json({ connected: true, messages: [] });
    const raw = await gmail.searchMessages(s, token, email, `{from:${cand.email} to:${cand.email} cc:${cand.email}}`, 40);
    const candEmail = cand.email.toLowerCase();
    const candName = (cand.name || '').toLowerCase();
    const msgs = raw
      .filter((m) => {
        const hay = `${m.fromEmail || ''} ${m.fromName || ''} ${m.toEmail || ''} ${m.ccEmail || ''}`.toLowerCase();
        return hay.includes(candEmail) || (candName && hay.includes(candName));
      })
      .map((m) => ({
        id: m.gmailMessageId,
        threadId: m.threadId,
        messageId: m.rfcMessageId,
        direction: m.direction,
        from: m.fromEmail,
        fromName: m.fromName,
        to: m.toEmail,
        subject: m.subject,
        snippet: m.snippet,
        bodyHtml: m.bodyHtml || '',
        date: m.sentAt ? new Date(m.sentAt).toISOString() : null,
      }))
      .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    res.json({ connected: true, mailbox: email, messages: msgs });
  } catch (e) { next(e); }
});

// Send an email to the candidate from the shared mailbox (compose or reply).
router.post('/candidates/:id/emails/send', requireHrAccess, async (req, res, next) => {
  try {
    const { s, token, email } = await hrMailbox();
    if (!token) return res.status(400).json({ error: 'The recruitment mailbox isn’t linked yet. Ask an admin to connect it in HR Admin.' });
    const cand = await HrCandidate.findByPk(req.params.id);
    if (!cand) return res.status(404).json({ error: 'Candidate not found.' });
    const b = req.body || {};
    const to = b.to || cand.email;
    if (!to) return res.status(400).json({ error: 'No recipient email.' });
    const sent = await gmail.sendMessage(s, token, email, {
      from: email, to, cc: b.cc, bcc: b.bcc,
      subject: b.subject || `Regarding your application`,
      bodyHtml: b.body || '',
      inReplyTo: b.inReplyTo || null,
      threadId: b.threadId || null,
      attachments: [],
    });
    // Log to the candidate timeline.
    const t = Array.isArray(cand.timeline) ? cand.timeline.slice() : [];
    t.unshift({ id: `t${Date.now()}`, type: 'email', text: `${req.hrActor.name} emailed the candidate: “${(b.subject || '').slice(0, 80)}”.`, by: req.hrActor.name, at: new Date().toISOString() });
    cand.timeline = t; cand.changed('timeline', true);
    await cand.save();
    res.json({ ok: true, id: sent && sent.id });
  } catch (e) { next(e); }
});

// AI draft for HR emails — recruitment-specific modes.
router.post('/candidates/:id/emails/ai-draft', requireHrAccess, async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const key = s.getKey('anthropic');
    if (!key) return res.status(400).json({ error: 'AI isn’t configured. Add an Anthropic API key in CRM Admin → API keys.' });
    const cand = await HrCandidate.findByPk(req.params.id);
    if (!cand) return res.status(404).json({ error: 'Candidate not found.' });
    const job = cand.jobPostId ? await HrJobPost.findByPk(cand.jobPostId) : null;
    const { draftRecruitmentEmail } = require('../services/hrRecruitAI');
    const out = await draftRecruitmentEmail(key, {
      mode: req.body.mode, prompt: req.body.prompt,
      candidateName: cand.name, roleTitle: job ? job.title : (req.body.roleTitle || 'the role'),
      recruiterName: req.hrActor.name,
      meetingWhen: req.body.meetingWhen, meetLink: req.body.meetLink,
    });
    res.json(out);
  } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
});

// Schedule an interview: create a Google Calendar event with a Meet link,
// invite the candidate, and (optionally) email them the details.
router.post('/candidates/:id/schedule-interview', requireHrAccess, requireScheduler, async (req, res, next) => {
  try {
    const { s, token, email } = await hrMailbox();
    if (!token) return res.status(400).json({ error: 'The recruitment mailbox isn’t linked yet. Ask an admin to connect it in HR Admin.' });
    const cand = await HrCandidate.findByPk(req.params.id);
    if (!cand) return res.status(404).json({ error: 'Candidate not found.' });
    const job = cand.jobPostId ? await HrJobPost.findByPk(cand.jobPostId) : null;
    const b = req.body || {};
    if (!b.start) return res.status(400).json({ error: 'Pick a date and time.' });
    const start = new Date(b.start);
    const end = new Date(start.getTime() + (Number(b.durationMins) || 30) * 60000);
    // Resolve panelists from the Employee list (HrUser). Only their emails are
    // added to the calendar invite; their identity is stored for feedback.
    let panelists = [];
    if (Array.isArray(b.panelistIds) && b.panelistIds.length) {
      const emps = await HrUser.findAll({ where: { id: b.panelistIds } });
      panelists = emps.map((e) => ({ id: e.id, name: e.name, department: e.department || '', email: e.email }));
    }
    const roundLabel = (() => { const st = (job && job.stages || []).find((x) => x.id === b.round); return st ? st.label : (b.round || ''); })();
    const title = b.title || `${roundLabel ? roundLabel + ' — ' : 'Interview: '}${cand.name}${job ? ` (${job.title})` : ''}`;
    let event = {};
    try {
      event = await gmail.createCalendarEvent(s, token, {
        summary: title,
        description: b.notes || `Interview with ${cand.name}${job ? ` for ${job.title}` : ''}.`,
        start: start.toISOString(), end: end.toISOString(),
        attendees: [cand.email, ...panelists.map((p) => p.email), ...(Array.isArray(b.extraAttendees) ? b.extraAttendees : [])].filter(Boolean),
        timeZone: b.timeZone || 'Asia/Kolkata',
      });
    } catch (ex) {
      return res.status(502).json({ error: 'Could not create the calendar event. The mailbox may need re-linking to grant Calendar access.' });
    }
    // Record on the candidate.
    const iv = {
      id: `iv${Date.now()}`, at: start.toISOString(), end: end.toISOString(),
      mode: b.mode || 'online', round: b.round || '', roundLabel, notes: b.notes || '',
      by: req.hrActor.name, meetLink: event.meetLink, eventLink: event.htmlLink,
      panelists, feedbackByPanelist: {},
    };
    const list = Array.isArray(cand.interviews) ? cand.interviews.slice() : [];
    list.unshift(iv);
    cand.interviews = list; cand.changed('interviews', true);
    const t = Array.isArray(cand.timeline) ? cand.timeline.slice() : [];
    const panelNames = panelists.map((p) => p.name).join(', ');
    t.unshift({ id: `t${Date.now()}`, type: 'interview', text: `${roundLabel || 'Interview'} scheduled by ${req.hrActor.name} for ${start.toLocaleString()}${event.meetLink ? ' (Google Meet)' : ''}${panelNames ? ` · Panel: ${panelNames}` : ''}.`, by: req.hrActor.name, at: new Date().toISOString() });
    cand.timeline = t; cand.changed('timeline', true);
    await cand.save();

    // Optionally email the candidate the invite details.
    if (b.sendEmail !== false && cand.email) {
      const when = start.toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'short' });
      const bodyHtml = `<p>Hi ${cand.name.split(' ')[0]},</p>
<p>We'd like to invite you to ${roundLabel ? `the <strong>${roundLabel}</strong>` : 'an interview'}${job ? ` for the <strong>${job.title}</strong> role` : ''}.</p>
<p><strong>When:</strong> ${when}<br>${event.meetLink ? `<strong>Google Meet:</strong> <a href="${event.meetLink}">${event.meetLink}</a>` : ''}</p>
${b.notes ? `<p>${b.notes}</p>` : ''}
<p>A calendar invite has been sent to your email. Please confirm you can make it.</p>
<p>Best regards,<br>${req.hrActor.name}</p>`;
      try { await gmail.sendMessage(s, token, email, { from: email, to: cand.email, subject: `Interview invitation${job ? ` — ${job.title}` : ''}`, bodyHtml, attachments: [] }); } catch { /* invite already created; email is best-effort */ }
    }
    res.json({ ok: true, meetLink: event.meetLink, eventLink: event.htmlLink, interview: iv });
  } catch (e) { next(e); }
});

module.exports = router;

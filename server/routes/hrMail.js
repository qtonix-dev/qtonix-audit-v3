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
const { Op, Settings, HrCandidate, HrJobPost, HrUser, HrDirectorProfile, HrEmail, User } = require('../models');

// Resolve a mixed list of panelist IDs (numeric HrUser ids and 'admin:<id>'
// director ids) into { id, name, department, email } records for the invite and
// feedback tracking. Directors use their HRMS overlay details when present.
async function resolvePanelists(panelIds) {
  if (!Array.isArray(panelIds) || !panelIds.length) return [];
  const empIds = [], adminIds = [];
  panelIds.forEach((pid) => {
    const s = String(pid);
    if (s.startsWith('admin:')) adminIds.push(Number(s.slice(6)));
    else if (/^\d+$/.test(s)) empIds.push(Number(s));
  });
  const out = [];
  if (empIds.length) {
    const emps = await HrUser.findAll({ where: { id: empIds } });
    emps.forEach((e) => out.push({ id: e.id, name: e.name, department: e.department || '', email: e.email }));
  }
  if (adminIds.length) {
    const admins = await User.findAll({ where: { id: adminIds, role: 'admin' } });
    const overlays = await HrDirectorProfile.findAll({ where: { userId: adminIds } });
    const byUser = {}; overlays.forEach((o) => { byUser[o.userId] = o; });
    admins.forEach((a) => { const o = byUser[a.id]; out.push({ id: `admin:${a.id}`, name: (o && o.name) || a.name, department: 'Leadership', email: (o && o.email) || a.email }); });
  }
  return out;
}
const gmail = require('../services/gmail');
const { requireHrAccess, requireScheduler, canViewInternal } = require('../middleware/hrAuth');

async function hrMailbox() {
  const s = await Settings.findOne({ where: { singleton: 'settings' } });
  const token = s.getKey('hrMailboxToken');
  const email = (s.hrMailbox && s.hrMailbox.email) || '';
  return { s, token, email };
}

// The full list of shared HR mailboxes: the legacy "default" one (if linked)
// plus any additional mailboxes in Settings.hrMailboxes. Each carries its own
// decrypted refresh token.
function hrMailboxList(s) {
  const out = [];
  const defToken = s.getKey('hrMailboxToken');
  const defEmail = (s.hrMailbox && s.hrMailbox.email) || '';
  if (defEmail) out.push({ id: 'default', email: defEmail, label: 'Careers', connectedAt: (s.hrMailbox && s.hrMailbox.connectedAt) || null, token: defToken, isDefault: true });
  for (const m of (Array.isArray(s.hrMailboxes) ? s.hrMailboxes : [])) {
    if (m.id === 'default') continue; // already covered by legacy fields
    const token = s.getKey(`hrMailboxToken:${m.id}`);
    out.push({ id: m.id, email: m.email, label: m.label || (m.email || '').split('@')[0], connectedAt: m.connectedAt || null, token, isDefault: false });
  }
  return out;
}

// Resolve one mailbox by id (defaults to the first connected mailbox).
async function resolveHrMailbox(mailboxId) {
  const s = await Settings.findOne({ where: { singleton: 'settings' } });
  const list = hrMailboxList(s).filter((m) => m.token);
  const mb = mailboxId ? list.find((m) => m.id === mailboxId) : list[0];
  return { s, mb: mb || null, list };
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
    const cand = await HrCandidate.findByPk(req.params.id);
    if (!cand) return res.status(404).json({ error: 'Candidate not found.' });
    if (!cand.email) return res.json({ connected: true, messages: [] });

    const toClient = (m) => ({
      id: m.gmailMessageId, threadId: m.threadId, messageId: m.rfcMessageId,
      direction: m.direction, from: m.fromEmail, fromName: m.fromName, to: m.toEmail,
      subject: m.subject, snippet: m.snippet, bodyHtml: m.bodyHtml || '',
      date: m.sentAt ? new Date(m.sentAt).toISOString() : null,
    });

    // Serve cached emails immediately when we have them (fast path). A refresh
    // from Gmail runs in the background so the next open is up to date. When the
    // cache is empty we do a one-time synchronous fetch so the first view works.
    const cached = await HrEmail.findAll({ where: { candidateId: cand.id }, order: [['sentAt', 'ASC']] });
    const refresh = async () => {
      try {
        const { s, token, email } = await hrMailbox();
        if (!token) return [];
        const raw = await gmail.searchMessages(s, token, email, `{from:${cand.email} to:${cand.email} cc:${cand.email}}`, 40);
        const candEmail = cand.email.toLowerCase();
        const candName = (cand.name || '').toLowerCase();
        const matches = raw.filter((m) => {
          const hay = `${m.fromEmail || ''} ${m.fromName || ''} ${m.toEmail || ''} ${m.ccEmail || ''}`.toLowerCase();
          return hay.includes(candEmail) || (candName && hay.includes(candName));
        });
        for (const m of matches) {
          await HrEmail.upsert({
            candidateId: cand.id, gmailMessageId: m.gmailMessageId, threadId: m.threadId || '',
            rfcMessageId: m.rfcMessageId || null, direction: m.direction, fromEmail: m.fromEmail || '',
            fromName: m.fromName || '', toEmail: m.toEmail || '', ccEmail: m.ccEmail || '',
            subject: m.subject || '', snippet: m.snippet || '', bodyHtml: m.bodyHtml || '',
            sentAt: m.sentAt ? new Date(m.sentAt) : null,
          }).catch(() => {});
        }
        return matches;
      } catch { return []; }
    };

    if (cached.length > 0) {
      res.json({ connected: true, messages: cached.map(toClient), cached: true });
      refresh(); // fire-and-forget; updates the cache for next time
      return;
    }
    // Cold cache — fetch once synchronously.
    await refresh();
    const fresh = await HrEmail.findAll({ where: { candidateId: cand.id }, order: [['sentAt', 'ASC']] });
    res.json({ connected: true, messages: fresh.map(toClient) });
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
    const attachments = Array.isArray(b.attachments) ? b.attachments : [];
    const sent = await gmail.sendMessage(s, token, email, {
      from: email, to, cc: b.cc, bcc: b.bcc,
      subject: b.subject || `Regarding your application`,
      bodyHtml: b.body || '',
      inReplyTo: b.inReplyTo || null,
      threadId: b.threadId || null,
      attachments,
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
    // If none are passed, fall back to the job's default panel for this round.
    let panelIds = Array.isArray(b.panelistIds) ? b.panelistIds : [];
    if (!panelIds.length && job && job.roundPanels && b.round && Array.isArray(job.roundPanels[b.round])) {
      panelIds = job.roundPanels[b.round];
    }
    const panelists = await resolvePanelists(panelIds);
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
      console.error('[calendar] createCalendarEvent failed:', ex && (ex.response && ex.response.data ? JSON.stringify(ex.response.data) : ex.message));
      return res.status(502).json({ error: gmail.calendarErrorMessage ? gmail.calendarErrorMessage(ex) : 'Could not create the calendar event. The mailbox may need re-linking to grant Calendar access.' });
    }
    // Record on the candidate.
    const iv = {
      id: `iv${Date.now()}`, at: start.toISOString(), end: end.toISOString(),
      mode: b.mode || 'online', round: b.round || '', roundLabel, notes: b.notes || '',
      by: req.hrActor.name, scheduledById: req.hrActor.kind === 'hr' ? req.hrActor.id : null,
      scheduledByAdmin: req.hrActor.kind === 'admin' ? req.hrActor.id : null,
      createdAt: new Date().toISOString(),
      meetLink: event.meetLink, eventLink: event.htmlLink, eventId: event.eventId, iCalUID: event.iCalUID,
      panelists, feedbackByPanelist: {},
    };
    const list = Array.isArray(cand.interviews) ? cand.interviews.slice() : [];
    list.unshift(iv);
    cand.interviews = list; cand.changed('interviews', true);
    const t = Array.isArray(cand.timeline) ? cand.timeline.slice() : [];
    const panelNames = panelists.map((p) => p.name).join(', ');
    const istStr = (d) => { try { return new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }); } catch { return new Date(d).toLocaleString(); } };
    t.unshift({ id: `t${Date.now()}`, type: 'interview', text: `${roundLabel || 'Interview'} scheduled by ${req.hrActor.name} for ${istStr(start)}${event.meetLink ? ' (Google Meet)' : ''}${panelNames ? ` · Panel: ${panelNames}` : ''}.`, by: req.hrActor.name, at: new Date().toISOString() });
    cand.timeline = t; cand.changed('timeline', true);
    await cand.save();

    // Email the candidate AND each panelist the invite, each with an .ics
    // attachment so any mail client shows Accept/Decline and adds it to their
    // calendar — independent of their provider. We track exactly who was
    // emailed so the UI reports the true result instead of assuming success.
    const buildIcs = (forAttendee) => {
      const ics = gmail.buildIcsInvite({
        uid: event.iCalUID || `${iv.id}@qtonix`,
        summary: title,
        description: `${b.notes || `Interview with ${cand.name}${job ? ` for ${job.title}` : ''}.`}`,
        start: start.toISOString(), end: end.toISOString(),
        organizerEmail: email || (s.hrMailbox && s.hrMailbox.email) || '', organizerName: 'Qtonix Recruitment',
        attendees: [cand.email, ...panelists.map((p) => p.email)].filter(Boolean),
        meetLink: event.meetLink, location: event.meetLink || 'Online',
        timeZone: b.timeZone || 'Asia/Kolkata',
      });
      return [{ filename: 'invite.ics', mimeType: 'text/calendar; method=REQUEST; charset=UTF-8', contentBase64: Buffer.from(ics, 'utf8').toString('base64') }];
    };
    const when = start.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'short' });
    const emailed = [];
    const failed = [];
    const sendTo = async (to, bodyHtml, subject) => {
      try { await gmail.sendMessage(s, token, email, { from: email, to, bodyHtml, subject, attachments: buildIcs(to) }); emailed.push(to); }
      catch (e) { console.error('[interview] email to', to, 'failed:', e && (e.response && e.response.data ? JSON.stringify(e.response.data) : e.message)); failed.push(to); }
    };

    // Candidate invite.
    if (b.sendEmail !== false && cand.email) {
      const bodyHtml = `<p>Hi ${cand.name.split(' ')[0]},</p>
<p>We'd like to invite you to ${roundLabel ? `the <strong>${roundLabel}</strong>` : 'an interview'}${job ? ` for the <strong>${job.title}</strong> role` : ''}.</p>
<p><strong>When:</strong> ${when}<br>${event.meetLink ? `<strong>Google Meet:</strong> <a href="${event.meetLink}">${event.meetLink}</a>` : ''}</p>
${b.notes ? `<p>${b.notes}</p>` : ''}
<p>A calendar invite is attached — open it to add the meeting to your calendar and confirm you can make it.</p>
<p>Best regards,<br>${req.hrActor.name}</p>`;
      await sendTo(cand.email, bodyHtml, `Interview invitation${job ? ` — ${job.title}` : ''}`);
    }

    // Panel invites — each panelist gets the same event with the Meet link.
    if (b.sendEmail !== false) {
      for (const p of panelists) {
        if (!p.email) continue;
        const bodyHtml = `<p>Hi ${(p.name || '').split(' ')[0] || 'there'},</p>
<p>You're on the panel for ${roundLabel ? `the <strong>${roundLabel}</strong>` : 'an interview'} with <strong>${cand.name}</strong>${job ? ` for the <strong>${job.title}</strong> role` : ''}.</p>
<p><strong>When:</strong> ${when}<br>${event.meetLink ? `<strong>Google Meet:</strong> <a href="${event.meetLink}">${event.meetLink}</a>` : ''}</p>
${b.notes ? `<p>${b.notes}</p>` : ''}
<p>A calendar invite is attached. Please add it to your calendar.</p>
<p>— Qtonix Recruitment</p>`;
        await sendTo(p.email, bodyHtml, `Interview panel${job ? ` — ${job.title}` : ''} (${cand.name})`);
      }
    }
    const notes = [];
    if (!event.meetLink) notes.push('The calendar event was created, but a Google Meet link couldn’t be generated automatically. Add one manually if needed.');
    if (failed.length) notes.push(`Could not email: ${failed.join(', ')}. Check the recruitment mailbox connection in HR Admin.`);
    res.json({
      ok: true, meetLink: event.meetLink, eventLink: event.htmlLink, interview: iv,
      emailed, failed,
      emailSummary: emailed.length ? `Invite emailed to ${emailed.length} recipient${emailed.length === 1 ? '' : 's'}${failed.length ? `; ${failed.length} failed` : ''}.` : (b.sendEmail === false ? 'Email sending was turned off.' : 'No invite emails were sent.'),
      note: notes.join(' '),
    });
  } catch (e) { next(e); }
});

// Reschedule an existing interview: move the Google Calendar event, update the
// stored record, and re-send the invite (with a fresh .ics) to candidate + panel.
router.post('/candidates/:id/interview/:ivId/reschedule', requireHrAccess, requireScheduler, async (req, res, next) => {
  try {
    const { s, token, email } = await hrMailbox();
    if (!token) return res.status(400).json({ error: 'The recruitment mailbox isn’t linked yet.' });
    const cand = await HrCandidate.findByPk(req.params.id);
    if (!cand) return res.status(404).json({ error: 'Candidate not found.' });
    const list = Array.isArray(cand.interviews) ? cand.interviews.slice() : [];
    const idx = list.findIndex((x) => x.id === req.params.ivId);
    if (idx < 0) return res.status(404).json({ error: 'Interview not found.' });
    const iv = { ...list[idx] };
    const b = req.body || {};
    if (!b.start) return res.status(400).json({ error: 'Pick a new date and time.' });
    const start = new Date(b.start);
    const end = new Date(start.getTime() + (Number(b.durationMins) || (iv.end && iv.at ? (new Date(iv.end) - new Date(iv.at)) / 60000 : 30)) * 60000);
    const job = cand.jobPostId ? await HrJobPost.findByPk(cand.jobPostId) : null;
    const panelists = Array.isArray(iv.panelists) ? iv.panelists : [];
    const title = `${iv.roundLabel ? iv.roundLabel + ' — ' : 'Interview: '}${cand.name}${job ? ` (${job.title})` : ''}`;

    // Move the calendar event if we have one; otherwise create a fresh one.
    let event = { meetLink: iv.meetLink, htmlLink: iv.eventLink, eventId: iv.eventId, iCalUID: iv.iCalUID };
    try {
      if (iv.eventId) {
        event = await gmail.updateCalendarEvent(s, token, iv.eventId, {
          start: start.toISOString(), end: end.toISOString(), timeZone: b.timeZone || 'Asia/Kolkata',
          summary: title, attendees: [cand.email, ...panelists.map((p) => p.email)].filter(Boolean),
        });
        event.meetLink = event.meetLink || iv.meetLink;
      } else {
        event = await gmail.createCalendarEvent(s, token, { summary: title, description: iv.notes || '', start: start.toISOString(), end: end.toISOString(), attendees: [cand.email, ...panelists.map((p) => p.email)].filter(Boolean), timeZone: b.timeZone || 'Asia/Kolkata' });
      }
    } catch (ex) {
      console.error('[calendar] reschedule failed:', ex && (ex.response && ex.response.data ? JSON.stringify(ex.response.data) : ex.message));
      return res.status(502).json({ error: gmail.calendarErrorMessage ? gmail.calendarErrorMessage(ex) : 'Could not update the calendar event.' });
    }

    iv.at = start.toISOString(); iv.end = end.toISOString();
    iv.meetLink = event.meetLink || iv.meetLink; iv.eventLink = event.htmlLink || iv.eventLink;
    iv.eventId = event.eventId || iv.eventId; iv.iCalUID = event.iCalUID || iv.iCalUID;
    iv.rescheduledAt = new Date().toISOString(); iv.rescheduledBy = req.hrActor.name;
    list[idx] = iv; cand.interviews = list; cand.changed('interviews', true);
    const istStr = (d) => { try { return new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }); } catch { return new Date(d).toLocaleString(); } };
    const tl = Array.isArray(cand.timeline) ? cand.timeline.slice() : [];
    tl.unshift({ id: `t${Date.now()}`, type: 'interview', text: `${iv.roundLabel || 'Interview'} rescheduled by ${req.hrActor.name} to ${istStr(start)}.`, by: req.hrActor.name, at: new Date().toISOString() });
    cand.timeline = tl; cand.changed('timeline', true);
    await cand.save();

    // Re-send invite (updated .ics with higher SEQUENCE so clients update).
    const emailed = [], failed = [];
    if (b.sendEmail !== false) {
      const when = istStr(start);
      const recipients = [cand.email, ...panelists.map((p) => p.email)].filter(Boolean);
      const buildIcs = () => {
        const ics = gmail.buildIcsInvite({ uid: iv.iCalUID || `${iv.id}@qtonix`, summary: title, description: iv.notes || '', start: start.toISOString(), end: end.toISOString(), organizerEmail: email || (s.hrMailbox && s.hrMailbox.email) || '', organizerName: 'Qtonix Recruitment', attendees: recipients, meetLink: iv.meetLink, location: iv.meetLink || 'Online', timeZone: b.timeZone || 'Asia/Kolkata', sequence: 1 });
        return [{ filename: 'invite.ics', mimeType: 'text/calendar; method=REQUEST; charset=UTF-8', contentBase64: Buffer.from(ics, 'utf8').toString('base64') }];
      };
      for (const to of recipients) {
        const bodyHtml = `<p>Hi,</p><p>The interview${job ? ` for <strong>${job.title}</strong>` : ''} with <strong>${cand.name}</strong> has been <strong>rescheduled</strong>.</p><p><strong>New time:</strong> ${when}<br>${iv.meetLink ? `<strong>Google Meet:</strong> <a href="${iv.meetLink}">${iv.meetLink}</a>` : ''}</p><p>An updated calendar invite is attached.</p><p>— Qtonix Recruitment</p>`;
        try { await gmail.sendMessage(s, token, email, { from: email, to, bodyHtml, subject: `Interview rescheduled${job ? ` — ${job.title}` : ''}`, attachments: buildIcs() }); emailed.push(to); }
        catch (e) { console.error('[interview] reschedule email to', to, 'failed:', e.message); failed.push(to); }
      }
    }
    res.json({ ok: true, interview: iv, emailed, failed, emailSummary: emailed.length ? `Update emailed to ${emailed.length} recipient${emailed.length === 1 ? '' : 's'}.` : 'No emails sent.' });
  } catch (e) { next(e); }
});

// Cancel an interview: delete the Google Calendar event, remove it from the
// candidate, and notify candidate + panel.
router.post('/candidates/:id/interview/:ivId/cancel', requireHrAccess, requireScheduler, async (req, res, next) => {
  try {
    const { s, token, email } = await hrMailbox();
    const cand = await HrCandidate.findByPk(req.params.id);
    if (!cand) return res.status(404).json({ error: 'Candidate not found.' });
    const list = Array.isArray(cand.interviews) ? cand.interviews.slice() : [];
    const idx = list.findIndex((x) => x.id === req.params.ivId);
    if (idx < 0) return res.status(404).json({ error: 'Interview not found.' });
    const iv = list[idx];
    const job = cand.jobPostId ? await HrJobPost.findByPk(cand.jobPostId) : null;
    const b = req.body || {};

    // Best-effort: remove the Google Calendar event.
    if (token && iv.eventId) {
      try { await gmail.deleteCalendarEvent(s, token, iv.eventId); }
      catch (e) { console.error('[calendar] delete failed:', e && (e.response && e.response.data ? JSON.stringify(e.response.data) : e.message)); }
    }

    list.splice(idx, 1); cand.interviews = list; cand.changed('interviews', true);
    const tl = Array.isArray(cand.timeline) ? cand.timeline.slice() : [];
    tl.unshift({ id: `t${Date.now()}`, type: 'interview', text: `${iv.roundLabel || 'Interview'} cancelled by ${req.hrActor.name}.`, by: req.hrActor.name, at: new Date().toISOString() });
    cand.timeline = tl; cand.changed('timeline', true);
    await cand.save();

    // Notify with a CANCEL .ics so it drops off attendees' calendars.
    const emailed = [], failed = [];
    if (token && b.sendEmail !== false) {
      const panelists = Array.isArray(iv.panelists) ? iv.panelists : [];
      const recipients = [cand.email, ...panelists.map((p) => p.email)].filter(Boolean);
      const title = `${iv.roundLabel ? iv.roundLabel + ' — ' : 'Interview: '}${cand.name}${job ? ` (${job.title})` : ''}`;
      const ics = gmail.buildIcsInvite({ uid: iv.iCalUID || `${iv.id}@qtonix`, summary: title, description: 'This interview has been cancelled.', start: iv.at, end: iv.end || iv.at, organizerEmail: email || (s.hrMailbox && s.hrMailbox.email) || '', organizerName: 'Qtonix Recruitment', attendees: recipients, timeZone: 'Asia/Kolkata', method: 'CANCEL', status: 'CANCELLED', sequence: 2 });
      const att = [{ filename: 'cancel.ics', mimeType: 'text/calendar; method=CANCEL; charset=UTF-8', contentBase64: Buffer.from(ics, 'utf8').toString('base64') }];
      for (const to of recipients) {
        const bodyHtml = `<p>Hi,</p><p>The interview${job ? ` for <strong>${job.title}</strong>` : ''} with <strong>${cand.name}</strong> has been <strong>cancelled</strong>.</p>${b.reason ? `<p>${b.reason}</p>` : ''}<p>— Qtonix Recruitment</p>`;
        try { await gmail.sendMessage(s, token, email, { from: email, to, bodyHtml, subject: `Interview cancelled${job ? ` — ${job.title}` : ''}`, attachments: att }); emailed.push(to); }
        catch (e) { console.error('[interview] cancel email to', to, 'failed:', e.message); failed.push(to); }
      }
    }
    res.json({ ok: true, emailed, failed, emailSummary: emailed.length ? `Cancellation emailed to ${emailed.length} recipient${emailed.length === 1 ? '' : 's'}.` : 'Interview cancelled.' });
  } catch (e) { next(e); }
});


// Create a lightweight Google Meet for a salary discussion (Offer tab).
router.post('/candidates/:id/offer-meet', requireHrAccess, requireScheduler, async (req, res, next) => {
  try {
    const { s, token } = await hrMailbox();
    if (!token) return res.status(400).json({ error: 'The recruitment mailbox isn’t linked yet.' });
    const cand = await HrCandidate.findByPk(req.params.id);
    if (!cand) return res.status(404).json({ error: 'Candidate not found.' });
    const b = req.body || {};
    if (!b.start) return res.status(400).json({ error: 'Pick a date and time.' });
    const start = new Date(b.start);
    const end = new Date(start.getTime() + (Number(b.durationMins) || 30) * 60000);
    let event = {};
    try {
      event = await gmail.createCalendarEvent(s, token, {
        summary: `Salary discussion — ${cand.name}`,
        description: b.notes || 'Salary discussion.',
        start: start.toISOString(), end: end.toISOString(),
        attendees: [cand.email].filter(Boolean),
        timeZone: b.timeZone || 'Asia/Kolkata',
      });
    } catch (ex) { console.error('[calendar] offer-meet failed:', ex && (ex.response && ex.response.data ? JSON.stringify(ex.response.data) : ex.message)); return res.status(502).json({ error: gmail.calendarErrorMessage ? gmail.calendarErrorMessage(ex) : 'Could not create the Meet. The mailbox may need re-linking for Calendar access.' }); }
    res.json({ ok: true, meetLink: event.meetLink, eventLink: event.htmlLink });
  } catch (e) { next(e); }
});

// Send an offer-related email (LOI or offer letter) from the shared mailbox,
// optionally with an attachment (offer letter PDF).
router.post('/candidates/:id/offer-email', requireHrAccess, requireScheduler, async (req, res, next) => {
  try {
    const { s, token, email } = await hrMailbox();
    if (!token) return res.status(400).json({ error: 'The recruitment mailbox isn’t linked yet.' });
    const cand = await HrCandidate.findByPk(req.params.id);
    if (!cand) return res.status(404).json({ error: 'Candidate not found.' });
    const b = req.body || {};
    if (!cand.email) return res.status(400).json({ error: 'Candidate has no email.' });
    const attachments = [];
    if (b.attachmentBase64 && b.attachmentName) {
      const raw = String(b.attachmentBase64).replace(/^data:[^;]+;base64,/, '');
      const mime = (String(b.attachmentBase64).match(/^data:([^;]+);base64,/) || [])[1] || 'application/pdf';
      attachments.push({ filename: b.attachmentName, mimeType: mime, contentBase64: raw });
    }
    await gmail.sendMessage(s, token, email, { from: email, to: cand.email, subject: b.subject || 'Regarding your offer', bodyHtml: b.body || '', attachments });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- Dashboard: unread / unreplied incoming mail (HR + admin only) ----
// Searches the shared recruitment inbox for the most recent inbound messages,
// groups by thread, and surfaces those whose latest message is inbound (nobody
// replied yet). Each is matched to a candidate and attributed to that
// candidate's assigned HR (falling back to "Unassigned"). Split into awaiting
// (<24h) and missed (>=24h). Cached ~60s so the dashboard stays snappy.
let _unreadCache = { at: 0, data: null };
router.get('/unread-mail', requireHrAccess, async (req, res, next) => {
  try {
    const { canViewInternal } = require('../middleware/hrAuth');
    if (!canViewInternal(req)) return res.json({ awaiting: [], missed: [] });
    // Serve from cache when fresh (shared inbox is the same for everyone).
    if (_unreadCache.data && Date.now() - _unreadCache.at < 60 * 1000) {
      return res.json(_unreadCache.data);
    }
    const { s, token, email } = await hrMailbox();
    if (!token) return res.json({ connected: false, awaiting: [], missed: [] });

    // Pull the last ~50 inbound messages from the shared inbox.
    const raw = await gmail.searchMessages(s, token, email, 'in:inbox -in:chats newer_than:30d', 50);
    // Group by thread; keep only threads whose newest message is inbound.
    const byThread = new Map();
    for (const m of raw) {
      const key = m.threadId || `single:${m.gmailMessageId}`;
      if (!byThread.has(key)) byThread.set(key, []);
      byThread.get(key).push(m);
    }
    const pending = [];
    for (const [, msgs] of byThread) {
      msgs.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
      const latest = msgs[0];
      if (!latest || latest.direction !== 'inbound') continue; // already replied
      pending.push(latest);
    }
    // Match each pending inbound to a candidate by the sender address.
    const cands = await HrCandidate.findAll({ attributes: ['id', 'name', 'email', 'recruiterId', 'recruiterName'] });
    const byEmail = new Map();
    cands.forEach((c) => { if (c.email) byEmail.set(c.email.toLowerCase(), c); });
    const now = Date.now();
    const dismissed = new Set(Array.isArray(s.hrDismissedUnread) ? s.hrDismissedUnread : []);
    const items = pending.filter((m) => !dismissed.has(m.gmailMessageId)).map((m) => {
      const from = (m.fromEmail || '').toLowerCase();
      const cand = byEmail.get(from) || null;
      const ageMs = now - new Date(m.sentAt).getTime();
      return {
        emailId: m.gmailMessageId, threadId: m.threadId,
        candidateId: cand ? cand.id : null,
        candidateName: cand ? cand.name : (m.fromName || m.fromEmail || 'Unknown'),
        ownerName: cand ? (cand.recruiterName || 'Unassigned') : 'Unassigned',
        ownerId: cand ? (cand.recruiterId || null) : null,
        fromName: m.fromName, fromEmail: m.fromEmail,
        subject: m.subject, snippet: m.snippet,
        receivedAt: m.sentAt ? new Date(m.sentAt).toISOString() : null, ageMs,
        hoursWaiting: Math.max(0, Math.round(ageMs / 3600000)),
      };
    }).sort((a, b) => b.ageMs - a.ageMs);
    const DAY = 24 * 60 * 60 * 1000;
    const data = {
      connected: true, mailbox: email,
      awaiting: items.filter((i) => i.ageMs < DAY),
      missed: items.filter((i) => i.ageMs >= DAY),
    };
    _unreadCache = { at: Date.now(), data };
    res.json(data);
  } catch (e) { next(e); }
});

// Admin dismisses an unread-email item (hidden from the dashboard box).
router.post('/unread-mail/:emailId/dismiss', requireHrAccess, async (req, res, next) => {
  try {
    if (!req.isHrAdmin) return res.status(403).json({ error: 'Only an admin can dismiss.' });
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const list = Array.isArray(s.hrDismissedUnread) ? s.hrDismissedUnread.slice() : [];
    if (!list.includes(req.params.emailId)) list.push(req.params.emailId);
    s.hrDismissedUnread = list.slice(-1000); s.changed('hrDismissedUnread', true);
    await s.save();
    _unreadCache = { at: 0, data: null }; // bust cache so it refreshes
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- Multi-mailbox management (HR admin) ----

// List all shared HR mailboxes (metadata only, no tokens).
router.get('/mailboxes', requireHrAccess, async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const list = hrMailboxList(s).map((m) => ({ id: m.id, email: m.email, label: m.label, connectedAt: m.connectedAt, isDefault: m.isDefault, connected: !!m.token }));
    res.json({ mailboxes: list, configured: gmail.isConfigured(s) });
  } catch (e) { next(e); }
});

// Begin linking an ADDITIONAL mailbox (HR admin only). Mints a fresh id.
router.get('/mailboxes/connect', requireHrAccess, async (req, res, next) => {
  try {
    if (!req.isHrAdmin) return res.status(403).json({ error: 'Only an admin can add a mailbox.' });
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    if (!gmail.isConfigured(s)) return res.status(400).json({ error: 'Google isn’t set up yet. Add the app credentials in CRM Admin → API keys.' });
    if (!gmail.hasValidBaseUrl()) return res.status(400).json({ error: 'The server’s public URL (APP_URL) isn’t configured.' });
    // If the default mailbox isn't linked yet, link that first; else a new id.
    const hasDefault = !!s.getKey('hrMailboxToken');
    const mbId = hasDefault ? `mb${Date.now().toString(36)}` : 'default';
    const jwt = require('jsonwebtoken');
    const state = jwt.sign({ hrMailbox: true, hrMailboxId: mbId, label: (req.query.label || '').slice(0, 40) }, process.env.JWT_SECRET || 'change-me-in-production', { expiresIn: '10m' });
    res.json({ url: gmail.authUrl(s, state) });
  } catch (e) { next(e); }
});

// Disconnect a specific mailbox by id (HR admin only).
router.post('/mailboxes/:id/disconnect', requireHrAccess, async (req, res, next) => {
  try {
    if (!req.isHrAdmin) return res.status(403).json({ error: 'Only an admin can remove a mailbox.' });
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const id = req.params.id;
    const keys = { ...(s.apiKeys || {}) };
    if (id === 'default') { keys.hrMailboxToken = ''; s.hrMailbox = { email: '', connectedAt: null }; }
    else { delete keys[`hrMailboxToken:${id}`]; }
    s.apiKeys = keys; s.changed('apiKeys', true);
    s.hrMailboxes = (Array.isArray(s.hrMailboxes) ? s.hrMailboxes : []).filter((m) => m.id !== id);
    s.changed('hrMailboxes', true);
    await s.save();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- All-email view (replicates the CRM All Email UI). HR + admin only. ----
// Only schedulers (hr/recruiter/manager/tl) and admins may browse the inbox.
function requireMailViewer(req, res, next) {
  if (!canViewInternal(req)) return res.status(403).json({ error: 'Not allowed.' });
  next();
}

// The list of mailboxes the Email tab can switch between (for the picker).
router.get('/all/mailboxes', requireHrAccess, requireMailViewer, async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    // The composer signature comes from the logged-in HR user's own default
    // signature (the shared inbox has no per-user signature of its own).
    let sig = '';
    if (req.hrUser && Array.isArray(req.hrUser.emailSignatures)) {
      const def = req.hrUser.emailSignatures.find((x) => x.isDefault) || req.hrUser.emailSignatures[0];
      sig = def ? def.body : '';
    }
    const list = hrMailboxList(s).filter((m) => m.token).map((m) => ({ value: m.id, userId: m.id, email: m.email, label: m.label, signature: sig }));
    res.json({ mailboxes: list, isAdmin: !!req.isHrAdmin, canSwitch: list.length > 1 });
  } catch (e) { next(e); }
});

// List a folder/label of a mailbox. Query: box, labelId, q, pageToken, as (mailbox id).
router.get('/all/folder', requireHrAccess, requireMailViewer, async (req, res, next) => {
  try {
    const { mb } = await resolveHrMailbox(req.query.as);
    if (!mb) return res.status(400).json({ error: 'No recruitment mailbox is linked. Add one in HR Admin → Settings.' });
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const out = await gmail.listFolder(s, mb.token, mb.email, {
      box: String(req.query.box || 'INBOX').toUpperCase(),
      labelId: req.query.labelId || null, q: req.query.q || '',
      max: Math.min(50, Number(req.query.max) || 25), pageToken: req.query.pageToken || null,
    });
    // Tag which messages tie to a candidate (by counterparty email).
    const emails = [...new Set(out.messages.map((m) => (m.direction === 'inbound' ? m.fromEmail : m.toEmail)).filter(Boolean).map((e) => e.toLowerCase()))];
    const cands = emails.length ? await HrCandidate.findAll({ where: { email: { [Op.in]: emails } }, attributes: ['id', 'name', 'email'] }) : [];
    const byEmail = new Map(cands.map((c) => [(c.email || '').toLowerCase(), c]));
    out.messages.forEach((m) => { const key = (m.direction === 'inbound' ? m.fromEmail : m.toEmail || '').toLowerCase(); const c = byEmail.get(key); m.candidateId = c ? c.id : null; m.candidateName = c ? c.name : null; });
    res.json(out);
  } catch (e) { next(e); }
});

router.get('/all/labels', requireHrAccess, requireMailViewer, async (req, res, next) => {
  try {
    const { mb } = await resolveHrMailbox(req.query.as);
    if (!mb) return res.json({ labels: [] });
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    res.json({ labels: await gmail.listLabels(s, mb.token) });
  } catch (e) { next(e); }
});

router.get('/all/thread/:threadId', requireHrAccess, requireMailViewer, async (req, res, next) => {
  try {
    const { mb } = await resolveHrMailbox(req.query.as);
    if (!mb) return res.status(400).json({ error: 'No recruitment mailbox linked.' });
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const messages = await gmail.getThread(s, mb.token, mb.email, req.params.threadId);
    // Best-effort mark the thread read.
    try { await gmail.markRead(s, mb.token, req.params.threadId); } catch {}
    res.json({ messages });
  } catch (e) { next(e); }
});

router.post('/all/send', requireHrAccess, requireMailViewer, async (req, res, next) => {
  try {
    const b = req.body || {};
    const { mb } = await resolveHrMailbox(b.as);
    if (!mb) return res.status(400).json({ error: 'No recruitment mailbox linked.' });
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const attachments = Array.isArray(b.attachments) ? b.attachments : [];
    await gmail.sendMessage(s, mb.token, mb.email, {
      from: mb.email, to: b.to, cc: b.cc, bcc: b.bcc, subject: b.subject || '',
      bodyHtml: b.body || '', threadId: b.threadId || null, inReplyTo: b.inReplyTo || null, attachments,
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Star / unstar (matches CRM contract: POST {starred, as}).
router.post('/all/message/:id/star', requireHrAccess, requireMailViewer, async (req, res, next) => {
  try {
    const { mb } = await resolveHrMailbox((req.body || {}).as);
    if (!mb) return res.status(400).json({ error: 'No recruitment mailbox linked.' });
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    await gmail.setStar(s, mb.token, req.params.id, !!(req.body || {}).starred);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Apply / remove labels (matches CRM contract: POST {add, remove, as}).
router.post('/all/message/:id/labels', requireHrAccess, requireMailViewer, async (req, res, next) => {
  try {
    const b = req.body || {};
    const { mb } = await resolveHrMailbox(b.as);
    if (!mb) return res.status(400).json({ error: 'No recruitment mailbox linked.' });
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    await gmail.modifyMessageLabels(s, mb.token, req.params.id, { add: b.add || [], remove: b.remove || [] });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Trash a message (matches CRM contract: DELETE /all/message/:id?as=).
router.delete('/all/message/:id', requireHrAccess, requireMailViewer, async (req, res, next) => {
  try {
    const { mb } = await resolveHrMailbox(req.query.as);
    if (!mb) return res.status(400).json({ error: 'No recruitment mailbox linked.' });
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    await gmail.trashMessage(s, mb.token, req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Create / delete custom labels (matches CRM contract).
router.post('/all/labels', requireHrAccess, requireMailViewer, async (req, res, next) => {
  try {
    const b = req.body || {};
    const { mb } = await resolveHrMailbox(b.as);
    if (!mb) return res.status(400).json({ error: 'No recruitment mailbox linked.' });
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const label = await gmail.createLabel(s, mb.token, b.name, b.color);
    res.json({ label });
  } catch (e) { next(e); }
});

router.delete('/all/labels/:id', requireHrAccess, requireMailViewer, async (req, res, next) => {
  try {
    const { mb } = await resolveHrMailbox(req.query.as);
    if (!mb) return res.status(400).json({ error: 'No recruitment mailbox linked.' });
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    await gmail.deleteLabel(s, mb.token, req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// AI draft for the shared Email tab (generic, prompt-based).
router.post('/all/ai-draft', requireHrAccess, requireMailViewer, async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const key = s.getKey('anthropic');
    if (!key) return res.status(400).json({ error: 'AI isn’t configured. Add an Anthropic API key in CRM Admin → API keys.' });
    const b = req.body || {};
    // Try to match a candidate by the first recipient for a friendlier draft.
    let candidateName = '';
    const firstTo = Array.isArray(b.to) ? (b.to[0] || '') : String(b.to || '').split(',')[0];
    if (firstTo) { const cand = await HrCandidate.findOne({ where: { email: String(firstTo).trim().toLowerCase() }, attributes: ['name'] }); if (cand) candidateName = cand.name; }
    const { draftRecruitmentEmail } = require('../services/hrRecruitAI');
    const out = await draftRecruitmentEmail(key, {
      mode: 'custom',
      prompt: b.prompt || 'Write a professional, friendly email.',
      candidateName: candidateName || 'there',
      roleTitle: b.roleTitle || 'the role',
      recruiterName: req.hrActor.name,
    });
    res.json(out);
  } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
});

module.exports = router;

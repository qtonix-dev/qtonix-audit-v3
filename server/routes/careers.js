/**
 * Public, unauthenticated careers endpoints backing the embeddable application
 * form. A published job post exposes a stable token; anyone with the token can
 * view the (public-safe) posting and submit an application.
 */
const express = require('express');
const router = express.Router();
const { HrJobPost, HrCandidate, Settings, HrUser } = require('../models');

// Only expose fields that are safe to show a candidate — never internal ids,
// creator, salary when hidden, etc.
function publicView(job) {
  return {
    token: job.publicToken,
    title: job.title,
    department: job.department,
    workMode: job.workMode,
    locations: job.locations || [],
    description: job.description,
    skills: (job.skills || []).map((s) => (typeof s === 'string' ? s : s.name)),
    experienceType: job.experienceType,
    expMin: job.expMin, expMax: job.expMax,
    employmentType: job.employmentType,
    employmentLevel: job.employmentLevel,
    education: job.education,
    openings: job.openings,
    salary: job.hideSalary ? null : {
      min: job.salaryMin, max: job.salaryMax,
      period: job.salaryPeriod, currency: job.salaryCurrency,
    },
    formFields: job.formFields || {},
    questions: (job.questions || []).map((q) => ({ id: q.id, type: q.type, question: q.question, mandatory: q.mandatory, options: q.options || [] })),
  };
}

router.get('/:token', async (req, res, next) => {
  try {
    const job = await HrJobPost.findOne({ where: { publicToken: req.params.token, status: 'published' } });
    if (!job) return res.status(404).json({ error: 'This position is no longer available.' });
    res.json(publicView(job));
  } catch (e) { next(e); }
});

router.post('/:token/apply', async (req, res, next) => {
  try {
    const job = await HrJobPost.findOne({ where: { publicToken: req.params.token, status: 'published' } });
    if (!job) return res.status(404).json({ error: 'This position is no longer available.' });
    const b = req.body || {};
    const name = `${(b.firstName || '').trim()} ${(b.lastName || '').trim()}`.trim();
    if (!name) return res.status(400).json({ error: 'Your name is required.' });
    if (!b.email || !/^[^@]+@[^@]+\.[^@]+$/.test(b.email)) return res.status(400).json({ error: 'A valid email is required.' });

    // Phone must be a real Indian mobile: +91 followed by 10 digits (we accept
    // any separators/spaces and a leading 0 or +91, then normalise).
    const rawPhone = String(b.phone || '').trim();
    const digits = rawPhone.replace(/\D/g, '');
    let phone10 = '';
    if (digits.length === 10) phone10 = digits;
    else if (digits.length === 12 && digits.startsWith('91')) phone10 = digits.slice(2);
    else if (digits.length === 11 && digits.startsWith('0')) phone10 = digits.slice(1);
    if (!/^[6-9]\d{9}$/.test(phone10)) {
      return res.status(400).json({ error: 'Enter a valid 10-digit Indian mobile number (e.g. +91 98765 43210).' });
    }
    const normalizedPhone = `+91${phone10}`;

    // Salary answers must be plain numbers — reject "15K", "15 lakh", etc. so we
    // don't store un-parseable values. Only validates when a value was entered.
    const answersIn = (b.answers && typeof b.answers === 'object') ? b.answers : {};
    const salaryFields = [['currentCtc', 'Current salary'], ['expectedCtc', 'Expected salary']];
    for (const [key, label] of salaryFields) {
      const v = answersIn[key];
      if (v == null || String(v).trim() === '') continue;
      if (!/^\d+(\.\d+)?$/.test(String(v).trim())) {
        return res.status(400).json({ error: `${label} must be a number in rupees (e.g. 15000, not "15K" or "15 lakh").` });
      }
    }

    const fields = job.formFields || {};
    // Enforce server-side that mandatory fields were provided.
    const answers = (b.answers && typeof b.answers === 'object') ? b.answers : {};
    const missing = [];
    if (fields.resume === 'mandatory' && !b.resumeUrl) missing.push('Resume');
    if (fields.currentLocation === 'mandatory' && !b.currentLocation) missing.push('Current location');
    for (const q of (job.questions || [])) {
      if (q.mandatory && !answers[q.id]) missing.push(q.question);
    }
    if (missing.length) return res.status(400).json({ error: `Please complete: ${missing.join(', ')}` });

    const firstStage = (job.stages && job.stages[0] && job.stages[0].id) || 'applied';
    // Pull resume text for keyword search + resume-match scoring, if a resume was uploaded.
    let resumeText = '';
    if (b.resumeText) resumeText = String(b.resumeText).slice(0, 50000);
    // Auto-assign to the job's HR: if exactly one HR is assigned, credit them as
    // the recruiter. If multiple (or none), leave unassigned for an HR manager or
    // admin to distribute.
    const assignedIds = Array.isArray(job.assignedHrIds) ? job.assignedHrIds : [];
    let recruiterId = null, recruiterName = '';
    if (assignedIds.length === 1) {
      const hr = await HrUser.findByPk(assignedIds[0]);
      if (hr) { recruiterId = hr.id; recruiterName = hr.name; }
    }
    const tl = [{ id: `t${Date.now()}`, type: 'applied', text: `Applied via the careers page to ${job.title}.`, by: name, at: new Date().toISOString() }];
    if (recruiterId) tl.push({ id: `t${Date.now() + 1}`, type: 'assigned', text: `Auto-assigned to ${recruiterName} (job's HR).`, by: 'System', at: new Date().toISOString() });
    const row = await HrCandidate.create({
      name, email: String(b.email).slice(0, 160), phone: normalizedPhone,
      jobPostId: job.id, stage: firstStage,
      recruiterId, recruiterName,
      resumeUrl: String(b.resumeUrl || '').slice(0, 400),
      resumeText,
      currentLocation: String(b.currentLocation || '').slice(0, 160),
      answers, source: 'careers_page',
      timeline: tl,
    });
    res.json({ ok: true, id: row.id });
    // Score the resume match in the background.
    try { const { scoreResumeMatchBg } = require('./hr'); if (scoreResumeMatchBg) scoreResumeMatchBg(row.id); } catch {}
    // Send the candidate an application-confirmation email (best-effort).
    sendApplicationConfirmation(row, job).catch(() => {});
    // Notify HR/recruiters of the new application.
    notifyNewApplication(row, job).catch(() => {});
  } catch (e) { next(e); }
});

// Sanitise a job title into a safe ImageKit folder segment.
function safeFolder(s) { return String(s || 'job').replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'job'; }

// Public resume/photo upload (candidate applying via the form). Tied to a valid
// published-job token; stores under HRMS/<Job>/Resumes on ImageKit.
router.post('/:token/upload', async (req, res, next) => {
  try {
    const job = await HrJobPost.findOne({ where: { publicToken: req.params.token, status: 'published' } });
    if (!job) return res.status(404).json({ error: 'This position is no longer available.' });
    const { base64, fileName, kind } = req.body || {};
    if (!base64) return res.status(400).json({ error: 'No file provided.' });
    // Resumes must be a document (pdf/doc/docx). Photos allow images.
    const nameLc = String(fileName || '').toLowerCase();
    const dataPrefix = String(base64).slice(0, 100).toLowerCase();
    if (kind !== 'photo') {
      const okExt = /\.(pdf|doc|docx)$/.test(nameLc);
      const okMime = dataPrefix.includes('application/pdf') || dataPrefix.includes('msword') || dataPrefix.includes('wordprocessingml') || dataPrefix.includes('application/octet-stream');
      if (!okExt && !okMime) return res.status(400).json({ error: 'Please upload your resume as a PDF or Word document.' });
    }
    const imagekit = require('../services/imagekit');
    const sub = kind === 'photo' ? 'Photos' : 'Resumes';
    const out = await imagekit.uploadFile({ base64, fileName: fileName || 'resume', folder: `HRMS/${safeFolder(job.title)}/${sub}` });
    // Confirm the upload actually produced a usable URL — otherwise the
    // candidate record would store a blank/broken resume link.
    if (!out || !out.url || !/^https?:\/\//i.test(out.url)) {
      return res.status(502).json({ error: 'Upload did not complete. Please try again in a moment.' });
    }
    res.json({ url: out.url, name: out.name });
  } catch (e) {
    if (/not configured/i.test(e.message)) return res.status(400).json({ error: 'File uploads are not set up yet. Please paste a link instead.' });
    next(e);
  }
});

// --- v177: application confirmation + new-application notification ---
async function sendApplicationConfirmation(cand, job) {
  if (!cand.email) return;
  const s = await Settings.findOne({ where: { singleton: 'settings' } });
  const token = s && s.getKey ? s.getKey('hrMailboxToken') : null;
  const mailbox = s && s.hrMailbox ? s.hrMailbox.email : '';
  if (!token || !mailbox) return;
  const gmail = require('../services/gmail');
  const first = String(cand.name || 'there').split(' ')[0];
  const bodyHtml = `<p>Hi ${first},</p><p>Thanks for applying for the <b>${job.title}</b> role at Qtonix. We've received your application and our team will review it shortly.</p><p>If your profile matches, we'll be in touch about next steps.</p><p>Warm regards,<br/>The Talent Team</p>`;
  try { await gmail.sendMessage(s, token, mailbox, { from: mailbox, to: cand.email, subject: `We received your application — ${job.title}`, bodyHtml }); } catch {}
}

async function notifyNewApplication(cand, job) {
  try {
    const hrRoute = require('./hr');
    if (!hrRoute.notify) return;
    // Notify the job creator (if HR) and all recruiters/HR.
    const recruiters = await HrUser.findAll({ where: { active: true } });
    for (const u of recruiters) {
      if (['hr', 'recruiter', 'manager', 'tl'].includes(u.type)) {
        await hrRoute.notify(u.id, { type: 'application', text: `New application from ${cand.name} for ${job.title}.`, candidateId: cand.id });
      }
    }
  } catch (e) { /* best-effort */ }
}

// Public careers landing: list all published jobs + branding.
router.get('/careers/:brandToken', async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const branding = s.hrCareers || {};
    if (!branding.token || branding.token !== req.params.brandToken) return res.status(404).json({ error: 'Careers page not found.' });
    const jobs = await HrJobPost.findAll({ where: { status: 'published' }, order: [['publishedAt', 'DESC']] });
    res.json({
      branding: { logo: branding.logo || '', title: branding.title || 'Careers', description: branding.description || '' },
      jobs: jobs.map((j) => ({ token: j.publicToken, title: j.title, department: j.department, workMode: j.workMode, locations: j.locations || [], employmentType: j.employmentType })),
    });
  } catch (e) { next(e); }
});

// Public self-schedule: candidate views their confirmed slots + questions.
router.get('/schedule/:token', async (req, res, next) => {
  try {
    // Find the candidate whose selfSchedule token matches.
    const all = await HrCandidate.findAll();
    const row = all.find((c) => c.selfSchedule && c.selfSchedule.token === req.params.token && c.selfSchedule.active);
    if (!row) return res.status(404).json({ error: 'This scheduling link is no longer available.' });
    const ss = row.selfSchedule;
    const job = row.jobPostId ? await HrJobPost.findByPk(row.jobPostId) : null;
    // Only expose slots that at least one panelist confirmed.
    const slots = (ss.slots || []).filter((s) => (s.confirmedBy || []).length > 0).map((s) => ({ id: s.id, at: s.at }));
    res.json({
      candidateName: row.name, roleTitle: job ? job.title : '', roundLabel: ss.roundLabel, durationMins: ss.durationMins,
      phone: row.phone || '', email: row.email || '',
      questions: ss.questions || [], slots, booked: ss.booked || null,
    });
  } catch (e) { next(e); }
});

// Public self-schedule: candidate picks a slot, updates contact, answers questions.
router.post('/schedule/:token/book', async (req, res, next) => {
  try {
    const all = await HrCandidate.findAll();
    const row = all.find((c) => c.selfSchedule && c.selfSchedule.token === req.params.token && c.selfSchedule.active);
    if (!row) return res.status(404).json({ error: 'This scheduling link is no longer available.' });
    const ss = row.selfSchedule;
    if (ss.booked) return res.status(400).json({ error: 'You have already booked a slot.' });
    const b = req.body || {};
    const slot = (ss.slots || []).find((s) => s.id === b.slotId && (s.confirmedBy || []).length > 0);
    if (!slot) return res.status(400).json({ error: 'Please pick a valid slot.' });
    if (b.phone) row.phone = String(b.phone).slice(0, 40);
    if (b.email) row.email = String(b.email).slice(0, 160);
    const job = row.jobPostId ? await HrJobPost.findByPk(row.jobPostId) : null;

    // Book a Google Meet via the shared mailbox.
    let meetLink = '', eventLink = '';
    try {
      const s = await Settings.findOne({ where: { singleton: 'settings' } });
      const token = s && s.getKey ? s.getKey('hrMailboxToken') : null;
      if (token) {
        const gmail = require('../services/gmail');
        const start = new Date(slot.at);
        const end = new Date(start.getTime() + (ss.durationMins || 45) * 60000);
        const panelists = await HrUser.findAll({ where: { id: ss.panelistIds || [] } });
        const ev = await gmail.createCalendarEvent(s, token, {
          summary: `${ss.roundLabel} — ${row.name}${job ? ` (${job.title})` : ''}`,
          description: 'Interview booked by the candidate.',
          start: start.toISOString(), end: end.toISOString(),
          attendees: [row.email, ...panelists.map((p) => p.email)].filter(Boolean),
          timeZone: 'Asia/Kolkata',
        });
        meetLink = ev.meetLink || ''; eventLink = ev.htmlLink || '';
      }
    } catch (e) { /* meet optional */ }

    ss.booked = { slotId: slot.id, at: slot.at, meetLink, eventLink, answers: b.answers && typeof b.answers === 'object' ? b.answers : {}, phone: row.phone, email: row.email, bookedAt: new Date().toISOString() };
    // Also record as an interview on the candidate.
    const interviews = Array.isArray(row.interviews) ? row.interviews.slice() : [];
    const panelists = await HrUser.findAll({ where: { id: ss.panelistIds || [] } });
    interviews.unshift({
      id: `iv${Date.now()}`, at: slot.at, end: new Date(new Date(slot.at).getTime() + (ss.durationMins || 45) * 60000).toISOString(),
      mode: 'video', roundLabel: ss.roundLabel, notes: 'Booked by candidate via self-schedule.', by: row.name,
      meetLink, eventLink, panelists: panelists.map((p) => ({ id: p.id, name: p.name, department: p.department, email: p.email })), feedbackByPanelist: {},
    });
    row.interviews = interviews; row.changed('interviews', true);
    row.selfSchedule = ss; row.changed('selfSchedule', true);
    const t = Array.isArray(row.timeline) ? row.timeline.slice() : [];
    t.unshift({ id: `t${Date.now()}`, at: new Date().toISOString(), type: 'interview', text: `${row.name} booked ${ss.roundLabel} for ${new Date(slot.at).toLocaleString()}.`, by: row.name });
    row.timeline = t; row.changed('timeline', true);
    await row.save();

    // Notify panelists + recruiter.
    try {
      const hrRoute = require('./hr');
      for (const pid of ss.panelistIds || []) await hrRoute.notify(pid, { type: 'interview', text: `${row.name} booked ${ss.roundLabel} for ${new Date(slot.at).toLocaleString()}.`, candidateId: row.id });
      if (row.recruiterId) await hrRoute.notify(row.recruiterId, { type: 'interview', text: `${row.name} booked their interview.`, candidateId: row.id });
    } catch {}
    res.json({ ok: true, meetLink });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.safeFolder = safeFolder;

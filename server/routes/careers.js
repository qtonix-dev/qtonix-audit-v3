/**
 * Public, unauthenticated careers endpoints backing the embeddable application
 * form. A published job post exposes a stable token; anyone with the token can
 * view the (public-safe) posting and submit an application.
 */
const express = require('express');
const router = express.Router();
const { Op, HrJobPost, HrCandidate, Settings, HrUser } = require('../models');

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
      answers, source: 'public_form',
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

// --- Assessment task: public fetch + file submission -------------------------

// Find a candidate + task by public token. Returns { cand, task } or null.
async function findTaskByToken(token) {
  const rows = await HrCandidate.findAll({ where: { rejected: false } });
  for (const c of rows) {
    const t = (Array.isArray(c.tasks) ? c.tasks : []).find((x) => x.token === token);
    if (t) return { cand: c, task: t };
  }
  return null;
}

// Public: fetch task info for the upload page. 410 when expired/invalid so the
// page can show its "no longer active" state.
router.get('/task/:token', async (req, res, next) => {
  try {
    const found = await findTaskByToken(req.params.token);
    if (!found) return res.status(404).json({ error: 'This task link is not valid.' });
    const { cand, task } = found;
    // A submitted task that hasn't had more info requested is closed.
    if (task.submittedAt && task.status !== 'info_requested') {
      return res.json({ submitted: true, candidateName: cand.name });
    }
    if (new Date(task.deadline).getTime() < Date.now()) {
      return res.status(410).json({ error: 'This task upload link has expired. Please contact the recruitment team to have it reactivated.' });
    }
    const job = cand.jobPostId ? await HrJobPost.findByPk(cand.jobPostId) : null;
    const infoRequested = task.status === 'info_requested';
    res.json({
      candidateName: cand.name,
      role: job ? job.title : '',
      taskTitle: task.title || '',
      taskDetails: task.details || '',
      deadline: task.deadline,
      submitted: false,
      infoRequested,
      infoRequestMessage: infoRequested && task.infoRequest ? (task.infoRequest.message || '') : '',
    });
  } catch (e) { next(e); }
});

// Public: candidate submits their task files. Uploads each to ImageKit under
// HRMS/<Job>/Tasks, appends them to the candidate's attachments (tagged as a
// task submission) and marks the task submitted.
router.post('/task/:token/submit', async (req, res, next) => {
  try {
    const found = await findTaskByToken(req.params.token);
    if (!found) return res.status(404).json({ error: 'This task link is not valid.' });
    const { cand, task } = found;
    if (task.submittedAt) return res.status(400).json({ error: 'This task has already been submitted.' });
    if (new Date(task.deadline).getTime() < Date.now()) return res.status(410).json({ error: 'This task upload link has expired.' });
    const files = Array.isArray(req.body && req.body.files) ? req.body.files : [];
    if (!files.length) return res.status(400).json({ error: 'Please attach at least one file.' });

    const imagekit = require('../services/imagekit');
    const job = cand.jobPostId ? await HrJobPost.findByPk(cand.jobPostId) : null;
    const folder = `HRMS/${safeFolder(job ? job.title : 'job')}/Tasks`;
    const uploaded = [];
    for (const f of files) {
      if (!f || !f.base64) continue;
      const out = await imagekit.uploadFile({ base64: f.base64, fileName: (f.name || 'task-file').slice(0, 120), folder });
      if (out && out.url && /^https?:\/\//i.test(out.url)) uploaded.push({ name: out.name || f.name || 'file', url: out.url, at: new Date().toISOString() });
    }
    if (!uploaded.length) return res.status(502).json({ error: 'Upload did not complete. Please try again in a moment.' });

    // Is this a response to an "additional information" request? If so, append
    // the new files to the existing set rather than replacing them.
    const isAdditional = task.status === 'info_requested';
    const now = new Date().toISOString();
    const tasks = (Array.isArray(cand.tasks) ? cand.tasks : []).map((t) => {
      if (t.token !== task.token) return t;
      const priorFiles = isAdditional && Array.isArray(t.files) ? t.files : [];
      const merged = [...priorFiles, ...uploaded];
      return { ...t, files: merged, submittedAt: now, status: 'submitted', infoRequest: isAdditional ? { ...(t.infoRequest || {}), respondedAt: now } : (t.infoRequest || null) };
    });
    cand.tasks = tasks; cand.changed('tasks', true);
    const atts = Array.isArray(cand.attachments) ? cand.attachments.slice() : [];
    for (const u of uploaded) atts.push({ id: `att${Date.now()}${Math.random().toString(36).slice(2, 6)}`, name: u.name, url: u.url, at: u.at, source: 'task', taskId: task.id });
    cand.attachments = atts; cand.changed('attachments', true);
    const tl = Array.isArray(cand.timeline) ? cand.timeline.slice() : [];
    tl.unshift({ id: `t${Date.now()}`, type: 'task', text: isAdditional
      ? `${cand.name} submitted ${uploaded.length} additional file${uploaded.length === 1 ? '' : 's'} as requested.`
      : `${cand.name} submitted ${uploaded.length} file${uploaded.length === 1 ? '' : 's'} for the assessment task.`, by: cand.name, at: now });
    cand.timeline = tl; cand.changed('timeline', true);
    await cand.save();

    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const { email: mailbox, token } = recruitmentMailbox(s);
    const gmail = require('../services/gmail');
    const hrEmail = require('../services/hrEmailTemplate');

    // 1) Thank-you email to the candidate (CC assigned HR).
    if (cand.email && token && mailbox) {
      try {
        const sig = { name: 'Qtonix Recruitment Team', title: 'Talent Acquisition · Qtonix', email: mailbox };
        const bodyHtml = hrEmail.taskReceived({ candidateName: cand.name, role: job ? job.title : '', isAdditional, signature: sig });
        // CC: recruiter + job assigned HR.
        const ccSet = new Set();
        if (cand.recruiterId) { const u = await HrUser.findByPk(cand.recruiterId); if (u && u.email) ccSet.add(u.email.toLowerCase()); }
        const ids = (job && Array.isArray(job.assignedHrIds)) ? job.assignedHrIds : [];
        if (ids.length) { const staff = await HrUser.findAll({ where: { id: { [Op.in]: ids } } }); staff.forEach((u) => { if (u.email) ccSet.add(u.email.toLowerCase()); }); }
        ccSet.delete(String(cand.email).toLowerCase()); ccSet.delete(String(mailbox).toLowerCase());
        await require('../services/hrEmailLog').sendAndLog(s, token, mailbox, { from: mailbox, to: cand.email, cc: Array.from(ccSet), subject: isAdditional ? `We received your additional information${job ? ` — ${job.title}` : ''}` : `We received your task submission${job ? ` — ${job.title}` : ''}`, bodyHtml }, { type: 'hr_task_received' });
      } catch (e) { console.error('[task] thank-you email failed:', e.message); }
    }

    // 2) Notify HR (assigned) + the interview-panel reviewers to review + give feedback.
    try {
      const hrRoute = require('./hr');
      if (hrRoute.notify) {
        const notifyIds = new Set(); const adminIds = new Set();
        for (const aid of (task.assignedIds || [])) { const s2 = String(aid); if (s2.startsWith('admin:')) adminIds.add(s2); else notifyIds.add(Number(aid)); }
        if (cand.recruiterId) notifyIds.add(Number(cand.recruiterId));
        const jids = (job && Array.isArray(job.assignedHrIds)) ? job.assignedHrIds : [];
        jids.forEach((id) => notifyIds.add(Number(id)));
        // The task creator should also hear about it (could be an admin).
        if (task.createdById != null) { const cs = String(task.createdById); if (cs.startsWith('admin:')) adminIds.add(cs); else if (/^\d+$/.test(cs)) notifyIds.add(Number(cs)); }
        const msg = isAdditional
          ? `${cand.name} submitted the additional information you requested — please review and submit your feedback.`
          : `${cand.name} submitted their assessment task — please review and submit your feedback.`;
        for (const id of notifyIds) { if (id) await hrRoute.notify(id, { type: 'task', text: msg, candidateId: cand.id }); }
        for (const aid of adminIds) { await hrRoute.notify(aid, { type: 'task', text: msg, candidateId: cand.id }); }
      }
    } catch { /* best-effort */ }

    res.json({ ok: true, files: uploaded.length });
  } catch (e) {
    if (/not configured/i.test(e.message)) return res.status(400).json({ error: 'File uploads are not set up on this account yet.' });
    next(e);
  }
});

// ===== Candidate onboarding (document collection before joining) ===========
async function findOnboardingByToken(token) {
  if (!token) return null;
  // Fast path: query the JSON column directly (works on MySQL). The token is a
  // 32-char hex string, so a LIKE on the serialized JSON is safe and lets the
  // database do the filtering instead of loading every candidate row.
  try {
    const { sequelize } = require('../models');
    const dialect = sequelize.getDialect();
    if (dialect === 'mysql') {
      const hit = await HrCandidate.findOne({
        where: sequelize.and(
          { blacklisted: false },
          sequelize.where(sequelize.fn('JSON_UNQUOTE', sequelize.fn('JSON_EXTRACT', sequelize.col('onboarding'), sequelize.literal("'$.token'"))), token)
        ),
      });
      return hit || null;
    }
  } catch (e) { /* fall through to the scan below */ }
  // Fallback (SQLite / anything else): scan, but only pull the columns we need.
  const rows = await HrCandidate.findAll({ where: { blacklisted: false }, attributes: ['id', 'name', 'email', 'phone', 'jobPostId', 'recruiterId', 'stage', 'offer', 'onboarding'] });
  for (const c of rows) {
    if (c.onboarding && c.onboarding.token === token) return c;
  }
  return null;
}

// Public: fetch the onboarding form context for the candidate page.
router.get('/onboarding/:token', async (req, res, next) => {
  try {
    const cand = await findOnboardingByToken(req.params.token);
    if (!cand) return res.status(404).json({ error: 'This onboarding link is not valid.' });
    const onb = cand.onboarding || {};
    const offer = cand.offer || {};
    // The link expires the day BEFORE joining (documents should be in by then).
    // HR can reactivate it from the onboarding panel if the candidate needs more
    // time. An expired link shows a friendly message instead of the form.
    const toYmd = (v) => { if (!v) return ''; const s = String(v); let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`; m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/); if (m) { let a = Number(m[1]), b = Number(m[2]); const y = m[3]; let d, mo; if (a > 12) { d = a; mo = b; } else if (b > 12) { mo = a; d = b; } else { d = a; mo = b; } return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; } const dd = new Date(s); return isNaN(dd.getTime()) ? '' : dd.toISOString().slice(0, 10); };
    const jd = toYmd(offer.joiningDate);
    if (jd && !onb.reactivatedUntil) {
      const istTodayStr = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
      // Expiry day = joining date minus 1 day. Expired once today >= expiry day.
      const expiryMs = new Date(jd + 'T00:00:00Z').getTime() - 86400000;
      const todayMs = new Date(istTodayStr + 'T00:00:00Z').getTime();
      if (todayMs >= expiryMs && onb.status !== 'submitted') {
        return res.json({ expired: true, candidateName: cand.name });
      }
    }
    // A manual reactivation window (HR-granted) overrides expiry until its date.
    if (onb.reactivatedUntil) {
      const istTodayStr = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
      if (new Date(istTodayStr + 'T00:00:00Z').getTime() > new Date(String(onb.reactivatedUntil).slice(0, 10) + 'T00:00:00Z').getTime() && onb.status !== 'submitted') {
        return res.json({ expired: true, candidateName: cand.name });
      }
    }
    if (onb.status === 'submitted') return res.json({ submitted: true, candidateName: cand.name });
    const job = cand.jobPostId ? await HrJobPost.findByPk(cand.jobPostId) : null;
    // HR contact = job's assigned HR, else the recruiter.
    let hr = null;
    const ids = (job && Array.isArray(job.assignedHrIds)) ? job.assignedHrIds : [];
    if (ids.length) hr = await HrUser.findByPk(ids[0]);
    if (!hr && cand.recruiterId) hr = await HrUser.findByPk(cand.recruiterId);
    const experienced = (job && job.experienceType && job.experienceType !== 'freshers');
    res.json({
      submitted: false,
      candidateName: cand.name,
      role: job ? job.title : '',
      branch: (job && job.locations && job.locations[0]) || '',
      joiningDate: offer.joiningDate || '',
      joiningTime: offer.joiningTime || '',
      experienced: !!experienced,
      hr: hr ? { name: hr.name, phone: hr.phone || '', avatar: hr.avatar || null } : null,
      prefill: {
        name: cand.name || '', email: cand.email || '', phone: cand.phone || '',
      },
      draft: onb.draft || null,
      queries: (onb.queries || []).map((q) => ({ id: q.id, message: q.message, at: q.at, reply: q.reply || null, repliedAt: q.repliedAt || null })),
    });
  } catch (e) { next(e); }
});

// Public: candidate posts a question/query. Stored on the onboarding blob and
// surfaced to HR in Core HR → Onboarding for a reply.
router.post('/onboarding/:token/query', async (req, res, next) => {
  try {
    const cand = await findOnboardingByToken(req.params.token);
    if (!cand) return res.status(404).json({ error: 'This onboarding link is not valid.' });
    const msg = String((req.body && req.body.message) || '').trim();
    if (!msg) return res.status(400).json({ error: 'Please type your question.' });
    if (msg.length > 2000) return res.status(400).json({ error: 'Your message is too long.' });
    const onb = cand.onboarding || {};
    onb.queries = Array.isArray(onb.queries) ? onb.queries : [];
    const q = { id: 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), message: msg, at: new Date().toISOString(), reply: null, repliedAt: null };
    onb.queries.push(q);
    cand.onboarding = onb; cand.changed('onboarding', true);
    await cand.save();
    res.json({ ok: true, query: { id: q.id, message: q.message, at: q.at, reply: null, repliedAt: null } });
  } catch (e) { next(e); }
});

// Public: autosave a partial draft (fields only, no files) so a candidate can
// finish later from the same link.
router.post('/onboarding/:token/draft', async (req, res, next) => {
  try {
    const cand = await findOnboardingByToken(req.params.token);
    if (!cand) return res.status(404).json({ error: 'This onboarding link is not valid.' });
    const onb = cand.onboarding || {};
    if (onb.status === 'submitted') return res.status(400).json({ error: 'Already submitted.' });
    onb.draft = (req.body && typeof req.body.draft === 'object') ? req.body.draft : onb.draft;
    cand.onboarding = onb; cand.changed('onboarding', true);
    await cand.save();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Public: candidate submits all onboarding fields + documents. Uploads each
// file to ImageKit under HRMS/Onboarding/<Candidate Name>/, stores field values
// + doc URLs on candidate.onboarding, marks submitted, notifies HR.
router.post('/onboarding/:token/submit', async (req, res, next) => {
  try {
    const cand = await findOnboardingByToken(req.params.token);
    if (!cand) return res.status(404).json({ error: 'This onboarding link is not valid.' });
    const onb = cand.onboarding || {};
    if (onb.status === 'submitted') return res.status(400).json({ error: 'You have already submitted your details.' });
    const body = req.body || {};
    const fields = body.fields || {};
    const filesIn = body.files || {}; // { key: [{name,base64}] or {name,base64} }

    const imagekit = require('../services/imagekit');
    const folder = `HRMS/Onboarding/${safeFolder(cand.name)}`;
    const uploadOne = async (f) => {
      if (!f || !f.base64) return null;
      const out = await imagekit.uploadFile({ base64: f.base64, fileName: (f.name || 'file').slice(0, 120), folder });
      return (out && out.url && /^https?:\/\//i.test(out.url)) ? { name: out.name || f.name || 'file', url: out.url, at: new Date().toISOString() } : null;
    };
    const uploadMany = async (arr) => {
      const out = [];
      for (const f of (Array.isArray(arr) ? arr : [])) { const u = await uploadOne(f); if (u) out.push(u); }
      return out;
    };

    const docs = {};
    docs.photo = await uploadOne(filesIn.photo);
    docs.panCard = await uploadOne(filesIn.panCard);
    docs.aadhaarCard = await uploadOne(filesIn.aadhaarCard);
    docs.addressProof = await uploadOne(filesIn.addressProof);
    docs.degreeCertificate = await uploadOne(filesIn.degreeCertificate);
    docs.marksheets = await uploadMany(filesIn.marksheets);

    const prevCompanies = [];
    const companiesIn = Array.isArray(body.prevCompanies) ? body.prevCompanies : [];
    for (const c of companiesIn) {
      prevCompanies.push({
        name: String(c.name || '').slice(0, 160),
        expLetters: await uploadMany(c.expLetters),
        salarySlips: await uploadMany(c.salarySlips),
      });
    }

    onb.fields = {
      name: String(fields.name || cand.name || '').slice(0, 160),
      email: String(fields.email || '').slice(0, 160),
      phone: String(fields.phone || '').slice(0, 40),
      fatherName: String(fields.fatherName || '').slice(0, 160),
      dob: String(fields.dob || '').slice(0, 10),
      maritalStatus: String(fields.maritalStatus || '').slice(0, 20),
      anniversary: String(fields.anniversary || '').slice(0, 10),
      presentAddress: String(fields.presentAddress || '').slice(0, 500),
      permanentAddress: String(fields.permanentAddress || '').slice(0, 500),
      bloodGroup: String(fields.bloodGroup || '').slice(0, 8),
      pan: String(fields.pan || '').toUpperCase().slice(0, 12),
      aadhaar: String(fields.aadhaar || '').replace(/\s+/g, '').slice(0, 12),
      addressProofType: String(fields.addressProofType || '').slice(0, 40),
      qualification: String(fields.qualification || '').slice(0, 40),
      qualificationOther: String(fields.qualificationOther || '').slice(0, 80),
    };
    onb.docs = docs;
    onb.prevCompanies = prevCompanies;
    onb.status = 'submitted';
    onb.submittedAt = new Date().toISOString();
    onb.docsComplete = true;
    onb.draft = null;
    cand.onboarding = onb; cand.changed('onboarding', true);

    // Mirror uploaded files into the candidate's attachments for easy access.
    const atts = Array.isArray(cand.attachments) ? cand.attachments.slice() : [];
    const pushAtt = (u, label) => { if (u && u.url) atts.push({ id: `att${Date.now()}${Math.random().toString(36).slice(2, 6)}`, name: `${label}: ${u.name}`, url: u.url, at: u.at, source: 'onboarding' }); };
    pushAtt(docs.photo, 'Photo'); pushAtt(docs.panCard, 'PAN'); pushAtt(docs.aadhaarCard, 'Aadhaar');
    pushAtt(docs.addressProof, 'Address proof'); pushAtt(docs.degreeCertificate, 'Degree');
    (docs.marksheets || []).forEach((u) => pushAtt(u, 'Marksheet'));
    prevCompanies.forEach((c) => { (c.expLetters || []).forEach((u) => pushAtt(u, `${c.name} letter`)); (c.salarySlips || []).forEach((u) => pushAtt(u, `${c.name} salary slip`)); });
    cand.attachments = atts; cand.changed('attachments', true);

    const tl = Array.isArray(cand.timeline) ? cand.timeline.slice() : [];
    tl.unshift({ id: `t${Date.now()}`, type: 'onboarding', text: `${cand.name} submitted their onboarding documents.`, by: cand.name, at: onb.submittedAt });
    cand.timeline = tl; cand.changed('timeline', true);
    await cand.save();

    // Notify assigned HR + recruiter that docs are in.
    try {
      const job = cand.jobPostId ? await HrJobPost.findByPk(cand.jobPostId) : null;
      const ids = new Set();
      if (cand.recruiterId) ids.add(cand.recruiterId);
      ((job && job.assignedHrIds) || []).forEach((id) => ids.add(id));
      for (const id of ids) {
        await require('../models').HrNotification.create({ userId: id, actorKind: 'hr', type: 'info', text: `${cand.name} has submitted their onboarding documents — ready to create the employee record.` }).catch(() => {});
      }
    } catch {}

    // Confirmation email to the candidate.
    try {
      const s = await Settings.findOne({ where: { singleton: 'settings' } });
      const { email: mailbox, token } = recruitmentMailbox(s);
      if (cand.email && token && mailbox) {
        const gmail = require('../services/gmail');
        const hrEmail = require('../services/hrEmailTemplate');
        const bodyHtml = hrEmail.onboardingReceived ? hrEmail.onboardingReceived({ candidateName: cand.name }) : `<p>Hi ${cand.name},</p><p>We've received your onboarding documents. Thank you!</p>`;
        await require('../services/hrEmailLog').sendAndLog(s, token, mailbox, { from: mailbox, to: cand.email, subject: 'We received your onboarding documents — Qtonix', bodyHtml }, { type: 'onboarding_received' });
      }
    } catch (e) { console.error('[onboarding] confirmation email failed:', e.message); }

    res.json({ ok: true });
  } catch (e) {
    if (/not configured/i.test(e.message)) return res.status(400).json({ error: 'File uploads are not set up on this account yet.' });
    next(e);
  }
});

async function sendApplicationConfirmation(cand, job) {
  if (!cand.email) return;
  const s = await Settings.findOne({ where: { singleton: 'settings' } });
  const { email: mailbox, token } = recruitmentMailbox(s);
  if (!token || !mailbox) { console.error('[careers] confirmation skipped: no linked recruitment mailbox/token'); return; }
  const gmail = require('../services/gmail');
  const hrEmail = require('../services/hrEmailTemplate');
  const bodyHtml = hrEmail.applicationThankYou({
    candidateName: cand.name, role: job.title,
    signature: { name: 'Qtonix Recruitment Team', title: 'Talent Acquisition · Qtonix', email: mailbox || 'career@qtonix.com' },
  });
  // CC the job's assigned HR so they see the acknowledgement sent to the candidate.
  let cc = [];
  try {
    const ids = (job && Array.isArray(job.assignedHrIds)) ? job.assignedHrIds : [];
    if (ids.length) { const staff = await HrUser.findAll({ where: { id: { [Op.in]: ids } } }); cc = staff.map((u) => u.email).filter(Boolean).filter((e) => e.toLowerCase() !== String(cand.email).toLowerCase() && e.toLowerCase() !== String(mailbox).toLowerCase()); }
  } catch {}
  try { await require('../services/hrEmailLog').sendAndLog(s, token, mailbox, { from: mailbox, to: cand.email, cc, subject: `We received your application — ${job.title}`, bodyHtml }, { type: 'hr_application_thankyou' }); } catch (e) { console.error('[careers] confirmation email failed:', e.message); }
}

// Resolve the recruitment mailbox address: the legacy single hrMailbox if
// present, else the 'default' entry (or first) from the hrMailboxes list.
function recruitmentMailboxEmail(s) {
  if (s && s.hrMailbox && s.hrMailbox.email) return s.hrMailbox.email;
  const list = (s && Array.isArray(s.hrMailboxes)) ? s.hrMailboxes : [];
  const def = list.find((m) => m.id === 'default') || list[0];
  return (def && def.email) || '';
}

// Resolve BOTH the mailbox address and its refresh token, handling the two ways
// a mailbox can be connected: the legacy default (token under 'hrMailboxToken')
// and named mailboxes (token under 'hrMailboxToken:<id>'). Returns { email, token }
// or nulls when nothing is connected. Mirrors hrMail.js's mailbox resolution so
// careers auto-emails send from whichever mailbox is actually linked.
function recruitmentMailbox(s) {
  if (!s || !s.getKey) return { email: '', token: null };
  // 1) Legacy default token + address.
  const defToken = s.getKey('hrMailboxToken');
  if (defToken) {
    const email = (s.hrMailbox && s.hrMailbox.email) || recruitmentMailboxEmail(s);
    if (email) return { email, token: defToken };
  }
  // 2) Named mailboxes — first one with a token wins (prefer 'default' id).
  const list = Array.isArray(s.hrMailboxes) ? s.hrMailboxes : [];
  const ordered = [...list].sort((a, b) => (a.id === 'default' ? -1 : 0) - (b.id === 'default' ? -1 : 0));
  for (const m of ordered) {
    const t = s.getKey(`hrMailboxToken:${m.id}`) || (m.id === 'default' ? defToken : null);
    if (t && m.email) return { email: m.email, token: t };
  }
  return { email: recruitmentMailboxEmail(s), token: defToken || null };
}

async function notifyNewApplication(cand, job) {
  // (1) In-app notifications to HR/recruiters.
  try {
    const hrRoute = require('./hr');
    if (hrRoute.notify) {
      const recruiters = await HrUser.findAll({ where: { active: true } });
      for (const u of recruiters) {
        if (['hr', 'recruiter', 'manager', 'tl'].includes(u.type)) {
          await hrRoute.notify(u.id, { type: 'application', text: `New application from ${cand.name} for ${job.title}.`, candidateId: cand.id });
        }
      }
    }
  } catch (e) { /* best-effort */ }
  // (2) Email the recruitment inbox (career@qtonix.com) with the applicant's
  // details so the team is alerted even when not logged in.
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const { email: mailbox, token } = recruitmentMailbox(s);
    if (!token || !mailbox) { console.error('[careers] internal notice skipped: no linked recruitment mailbox/token'); return; }
    const gmail = require('../services/gmail');
    const hrEmail = require('../services/hrEmailTemplate');
    const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
    const jobLocation = Array.isArray(job.locations) && job.locations.length ? job.locations.join(', ') : '';
    const bodyHtml = hrEmail.applicationInternalNotice({
      candidateName: cand.name, role: job.title, candidateEmail: cand.email, candidatePhone: cand.phone,
      jobLocation, source: 'Careers page',
      viewUrl: appUrl ? `${appUrl}/hr/recruitment` : '',
    });
    await require('../services/hrEmailLog').sendAndLog(s, token, mailbox, { from: mailbox, to: mailbox, subject: `New application — ${job.title} (${cand.name})`, bodyHtml }, { type: 'hr_application_notice' });
  } catch (e) { console.error('[careers] internal notice email failed:', e.message); }
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

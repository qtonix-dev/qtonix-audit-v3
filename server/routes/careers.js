/**
 * Public, unauthenticated careers endpoints backing the embeddable application
 * form. A published job post exposes a stable token; anyone with the token can
 * view the (public-safe) posting and submit an application.
 */
const express = require('express');
const router = express.Router();
const { HrJobPost, HrCandidate } = require('../models');

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
    const row = await HrCandidate.create({
      name, email: String(b.email).slice(0, 160), phone: String(b.phone || '').slice(0, 40),
      jobPostId: job.id, stage: firstStage,
      resumeUrl: String(b.resumeUrl || '').slice(0, 400),
      resumeText,
      currentLocation: String(b.currentLocation || '').slice(0, 160),
      answers, source: 'careers_page',
      timeline: [{ id: `t${Date.now()}`, type: 'applied', text: `Applied via the careers page to ${job.title}.`, by: name, at: new Date().toISOString() }],
    });
    res.json({ ok: true, id: row.id });
    // Score the resume match in the background.
    try { const { scoreResumeMatchBg } = require('./hr'); if (scoreResumeMatchBg) scoreResumeMatchBg(row.id); } catch {}
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
    const imagekit = require('../services/imagekit');
    const sub = kind === 'photo' ? 'Photos' : 'Resumes';
    const out = await imagekit.uploadFile({ base64, fileName: fileName || 'resume', folder: `HRMS/${safeFolder(job.title)}/${sub}` });
    res.json({ url: out.url, name: out.name });
  } catch (e) {
    if (/not configured/i.test(e.message)) return res.status(400).json({ error: 'File uploads are not set up yet. Please paste a link instead.' });
    next(e);
  }
});

module.exports = router;
module.exports.safeFolder = safeFolder;

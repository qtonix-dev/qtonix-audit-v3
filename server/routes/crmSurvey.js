/**
 * Sales-CRM pulse surveys — ported from the HRMS survey system. Admins create
 * and analyse; all active CRM users respond. Results split by team. Reuses the
 * shared survey AI service (adaptive follow-ups, sentiment, aggregate, personal
 * success message).
 */
const express = require('express');
const router = express.Router();
const { Op, CrmSurvey, CrmSurveyResponse, User, Settings } = require('../models');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const DEFAULT_MOOD_QUESTIONS = [
  { id: 'q1', text: 'Our workplace is free from distraction', type: 'scale5', comment: true, options: [] },
];
const SURVEY_Q_TYPES = ['scale5', 'single_choice', 'multi_choice', 'short_answer'];

function sanitizeQuestions(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((q, i) => {
    const type = SURVEY_Q_TYPES.includes(q.type) ? q.type : 'scale5';
    const isChoice = type === 'single_choice' || type === 'multi_choice';
    const options = isChoice && Array.isArray(q.options)
      ? q.options.map((o) => String(o).slice(0, 160)).filter((o) => o.trim()).slice(0, 12) : [];
    return { id: q.id || `q${i + 1}`, text: String(q.text || '').slice(0, 300), type, comment: q.comment === true, options };
  }).filter((q) => {
    if (!q.text.trim()) return false;
    if ((q.type === 'single_choice' || q.type === 'multi_choice') && q.options.length < 2) return false;
    return true;
  });
}

function surveyPeriodKey(frequency, d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0');
  if (frequency === 'weekly') {
    const oneJan = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil((((d - oneJan) / 86400000) + oneJan.getDay() + 1) / 7);
    return `${y}-W${String(week).padStart(2, '0')}`;
  }
  if (frequency === 'one_time') return 'once';
  return `${y}-${m}`;
}
async function ensureSurveyPeriod(survey) {
  if (survey.status !== 'active') return survey;
  const key = surveyPeriodKey(survey.frequency);
  if (survey.period !== key) { survey.period = key; survey.periodStartedAt = new Date(); await survey.save(); }
  return survey;
}
async function anthropicKey() {
  const s = await Settings.findOne();
  return s && s.getKey ? s.getKey('anthropic') : null;
}

// ---- Admin: list / create / update / delete ----
router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const rows = await CrmSurvey.findAll({ where: { active: true }, order: [['createdAt', 'DESC']] });
    const out = [];
    for (const s of rows) { await ensureSurveyPeriod(s); const count = await CrmSurveyResponse.count({ where: { surveyId: s.id, period: s.period } }); out.push({ ...s.toJSON(), responseCount: count }); }
    res.json({ surveys: out });
  } catch (e) { next(e); }
});

router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'Survey name is required.' });
    const frequency = ['one_time', 'weekly', 'monthly'].includes(b.frequency) ? b.frequency : 'one_time';
    const qs = sanitizeQuestions(b.questions);
    const questions = qs.length ? qs : DEFAULT_MOOD_QUESTIONS;
    const row = await CrmSurvey.create({
      name: String(b.name).slice(0, 160), description: String(b.description || '').slice(0, 2000),
      template: 'employee_mood', frequency, questions, status: 'active',
      period: surveyPeriodKey(frequency), periodStartedAt: new Date(),
      createdById: req.user.id, createdByName: req.user.name,
    });
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

router.put('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const row = await CrmSurvey.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Survey not found.' });
    const b = req.body || {};
    if (b.name !== undefined) row.name = String(b.name).slice(0, 160);
    if (b.description !== undefined) row.description = String(b.description).slice(0, 2000);
    if (b.frequency !== undefined && ['one_time', 'weekly', 'monthly'].includes(b.frequency)) row.frequency = b.frequency;
    if (Array.isArray(b.questions)) { row.questions = sanitizeQuestions(b.questions); row.changed('questions', true); }
    if (b.status !== undefined && ['active', 'closed'].includes(b.status)) row.status = b.status;
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const row = await CrmSurvey.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Survey not found.' });
    row.active = false; row.status = 'closed'; await row.save();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- Employee (any active CRM user): pending / follow-ups / respond ----
router.get('/pending', requireAuth, async (req, res, next) => {
  try {
    const surveys = await CrmSurvey.findAll({ where: { active: true, status: 'active' } });
    const pending = [];
    for (const s of surveys) {
      await ensureSurveyPeriod(s);
      const done = await CrmSurveyResponse.count({ where: { surveyId: s.id, period: s.period, employeeId: req.user.id } });
      if (!done) pending.push({ _id: s.id, name: s.name, description: s.description, questions: s.questions, frequency: s.frequency, period: s.period });
    }
    res.json({ pending });
  } catch (e) { next(e); }
});

router.post('/:id/followups', requireAuth, async (req, res, next) => {
  try {
    const survey = await CrmSurvey.findByPk(req.params.id);
    if (!survey) return res.status(404).json({ error: 'Survey not found.' });
    const key = await anthropicKey();
    if (!key) return res.json({ questions: [] });
    const { followUpQuestions } = require('../services/hrSurveyAI');
    const questions = await followUpQuestions(key, { questions: survey.questions, answers: (req.body && req.body.answers) || {} });
    res.json({ questions });
  } catch (e) { res.json({ questions: [] }); }
});

router.post('/:id/respond', requireAuth, async (req, res, next) => {
  try {
    const survey = await CrmSurvey.findByPk(req.params.id);
    if (!survey || survey.status !== 'active') return res.status(404).json({ error: 'This survey is not accepting responses.' });
    await ensureSurveyPeriod(survey);
    const already = await CrmSurveyResponse.findOne({ where: { surveyId: survey.id, period: survey.period, employeeId: req.user.id } });
    if (already) return res.status(409).json({ error: 'You’ve already responded to this survey for this period.' });
    const me = await User.findByPk(req.user.id);

    const b = req.body || {};
    const raw = (b.answers && typeof b.answers === 'object') ? b.answers : {};
    const answers = {};
    for (const q of (survey.questions || [])) {
      const a = raw[q.id] || {}; const entry = {};
      if (q.type === 'scale5') { const n = Number(a.score); if (Number.isFinite(n)) entry.score = n; }
      else if (q.type === 'single_choice') { if (a.choice != null) entry.choice = String(a.choice).slice(0, 160); }
      else if (q.type === 'multi_choice') { entry.choices = Array.isArray(a.choices) ? a.choices.map((c) => String(c).slice(0, 160)).slice(0, 12) : []; }
      else if (q.type === 'short_answer') { if (a.text != null) entry.text = String(a.text).slice(0, 2000); }
      if (q.comment && a.comment != null) entry.comment = String(a.comment).slice(0, 2000);
      answers[q.id] = entry;
    }
    const followups = Array.isArray(b.followups) ? b.followups.map((f) => ({ question: String(f.question || '').slice(0, 240), answer: String(f.answer || '').slice(0, 20) })) : [];

    // Behaviour signals → derived hesitation flags (same logic as HRMS).
    const rawBeh = (b.behavior && typeof b.behavior === 'object') ? b.behavior : {};
    const perQ = {}; const times = [];
    for (const q of (survey.questions || [])) {
      const x = rawBeh[q.id] || {};
      const e = { timeMs: Math.max(0, Math.round(Number(x.timeMs) || 0)), backspaces: Math.max(0, Math.round(Number(x.backspaces) || 0)), changes: Math.max(0, Math.round(Number(x.changes) || 0)) };
      perQ[q.id] = e; if (e.timeMs > 0) times.push(e.timeMs);
    }
    const avgTime = times.length ? times.reduce((a, c) => a + c, 0) / times.length : 0;
    for (const q of (survey.questions || [])) { const e = perQ[q.id]; e.slow = avgTime > 0 && e.timeMs >= avgTime * 1.6 && e.timeMs > 4000; e.heavyEdit = e.backspaces >= 15 || e.changes >= 3; e.hesitation = !!(e.slow || e.heavyEdit); }
    const behavior = { perQuestion: perQ, avgTimeMs: Math.round(avgTime), flagged: Object.entries(perQ).filter(([, e]) => e.hesitation).map(([qid]) => qid) };

    const scores = (survey.questions || []).filter((q) => q.type === 'scale5').map((q) => Number((answers[q.id] || {}).score)).filter((n) => Number.isFinite(n));
    const avgScore = scores.length ? scores.reduce((a, c) => a + c, 0) / scores.length : null;
    const hasLow = scores.some((n) => n <= 3);

    const row = await CrmSurveyResponse.create({
      surveyId: survey.id, period: survey.period, employeeId: me.id, employeeName: me.name,
      department: me.role || '', branch: me.team || '', answers, followups, avgScore, behavior,
    });

    let message = `Thank you, ${(me.name || '').split(' ')[0]}. Your feedback truly helps us improve.`;
    try { const key = await anthropicKey(); if (key) { const { successMessage } = require('../services/hrSurveyAI'); message = await successMessage(key, { employeeName: me.name, avgScore, sentimentLabel: hasLow ? 'low' : 'ok', hasLowScores: hasLow }); } } catch {}
    res.json({ ok: true, id: row.id, message });
  } catch (e) { next(e); }
});

// ---- Admin: results & analysis ----
router.get('/:id/periods', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const rows = await CrmSurveyResponse.findAll({ where: { surveyId: req.params.id }, attributes: ['period'], group: ['period'], order: [['period', 'DESC']] });
    res.json({ periods: rows.map((r) => r.period).filter(Boolean) });
  } catch (e) { next(e); }
});

router.get('/:id/results', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const survey = await CrmSurvey.findByPk(req.params.id);
    if (!survey) return res.status(404).json({ error: 'Survey not found.' });
    const period = req.query.period || survey.period;
    const responses = await CrmSurveyResponse.findAll({ where: { surveyId: survey.id, period } });
    const total = responses.length;
    const analysis = (survey.analysis && survey.analysis[period]) || null;
    const tally = (list) => { const t = { positive: 0, neutral: 0, negative: 0 }; list.forEach((r) => { const l = r.sentiment && r.sentiment.label; if (t[l] != null) t[l] += 1; }); return t; };
    const withSent = responses.filter((r) => r.sentiment && r.sentiment.label);
    const counts = tally(withSent);
    const pct = (n) => withSent.length ? Math.round((n / withSent.length) * 100) : 0;
    const groupBy = (keyFn) => {
      const g = {}; responses.forEach((r) => { const k = keyFn(r) || '—'; (g[k] = g[k] || []).push(r); });
      return Object.entries(g).map(([k, list]) => {
        const c = tally(list.filter((r) => r.sentiment && r.sentiment.label)); const n = list.filter((r) => r.sentiment && r.sentiment.label).length;
        const avg = list.filter((r) => r.avgScore != null);
        return { key: k, count: list.length, avgScore: avg.length ? +(avg.reduce((a, r) => a + r.avgScore, 0) / avg.length).toFixed(2) : null,
          positive: n ? Math.round(c.positive / n * 100) : 0, neutral: n ? Math.round(c.neutral / n * 100) : 0, negative: n ? Math.round(c.negative / n * 100) : 0 };
      }).sort((a, b) => b.count - a.count);
    };
    const responseDetail = responses.map((r) => {
      const beh = r.behavior || {}; const flagged = Array.isArray(beh.flagged) ? beh.flagged : [];
      const flaggedQ = flagged.map((qid) => { const q = (survey.questions || []).find((x) => x.id === qid); return q ? q.text : null; }).filter(Boolean);
      return { _id: r.id, employeeName: r.employeeName, department: r.department, branch: r.branch, avgScore: r.avgScore, sentiment: r.sentiment || null, hesitationCount: flagged.length, hesitationQuestions: flaggedQ };
    });
    res.json({
      survey: { _id: survey.id, name: survey.name, frequency: survey.frequency, questions: survey.questions },
      period, total, analysed: withSent.length,
      sentiment: { positive: pct(counts.positive), neutral: pct(counts.neutral), negative: pct(counts.negative) },
      good: analysis ? analysis.good : [], improve: analysis ? analysis.improve : [], summary: analysis ? analysis.summary : '',
      byBranch: groupBy((r) => r.branch), // team split
      responses: responseDetail,
      analysedAt: analysis ? analysis.at : null,
    });
  } catch (e) { next(e); }
});

router.post('/:id/analyze', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const survey = await CrmSurvey.findByPk(req.params.id);
    if (!survey) return res.status(404).json({ error: 'Survey not found.' });
    const key = await anthropicKey();
    if (!key) return res.status(400).json({ error: 'AI isn’t configured. Add an Anthropic API key in Admin → API keys.' });
    const period = req.body && req.body.period ? req.body.period : survey.period;
    const responses = await CrmSurveyResponse.findAll({ where: { surveyId: survey.id, period } });
    if (!responses.length) return res.status(400).json({ error: 'No responses to analyse for this period yet.' });
    const { analyseResponse, aggregateAnalysis } = require('../services/hrSurveyAI');
    for (const r of responses) {
      if (r.sentiment && r.sentiment.label) continue;
      try { const sent = await analyseResponse(key, { questions: survey.questions, answers: r.answers, followups: r.followups, avgScore: r.avgScore, behavior: r.behavior }); r.sentiment = sent; r.changed('sentiment', true); await r.save(); } catch {}
    }
    const blobs = responses.map((r) => {
      const txt = (survey.questions || []).map((q) => {
        const a = (r.answers || {})[q.id] || {}; let ans = '—';
        if (q.type === 'scale5') ans = a.score != null ? `${a.score}/5` : '—';
        else if (q.type === 'single_choice') ans = a.choice != null ? a.choice : '—';
        else if (q.type === 'multi_choice') ans = Array.isArray(a.choices) && a.choices.length ? a.choices.join(', ') : '—';
        else if (q.type === 'short_answer') ans = a.text || '—';
        return `${q.text}: ${ans}${a.comment ? ` — "${a.comment}"` : ''}`;
      }).join('; ');
      const fu = (r.followups || []).map((f) => `${f.question} → ${f.answer}`).join('; ');
      return { department: r.department, branch: r.branch, avgScore: r.avgScore, sentiment: r.sentiment && r.sentiment.label, text: txt + (fu ? ` | Follow-ups: ${fu}` : '') };
    });
    let agg = { good: [], improve: [], summary: '' };
    try { agg = await aggregateAnalysis(key, { surveyName: survey.name, blobs }); } catch {}
    const nextAnalysis = { ...(survey.analysis || {}) };
    nextAnalysis[period] = { at: new Date().toISOString(), good: agg.good, improve: agg.improve, summary: agg.summary };
    survey.analysis = nextAnalysis; survey.changed('analysis', true); await survey.save();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;

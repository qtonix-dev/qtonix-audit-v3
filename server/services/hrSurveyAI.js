/**
 * AI helpers for the Employee Mood survey. All calls go through the shared
 * callClaude() so usage is tracked and key handling stays consistent.
 *
 *  - followUpQuestions(): when a submission is low (<=3), Claude proposes 2-3
 *    yes/no counter-questions to understand the mood in more depth.
 *  - analyseResponse(): a per-response sentiment read (how they FEEL, from tone
 *    and language, not just the words).
 *  - aggregateAnalysis(): the monthly roll-up — sentiment split, top good/
 *    improvement points, and department/branch breakdowns.
 *  - successMessage(): a short, personal thank-you written as if the HR manager
 *    is replying to this specific employee.
 */
const { callClaude } = require('./aiVisibility');

function parseJson(text) {
  const cleaned = String(text).replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.search(/[[{]/);
  if (start === -1) throw new Error('No JSON in model response');
  const open = cleaned[start];
  const close = open === '[' ? ']' : '}';
  const end = cleaned.lastIndexOf(close);
  return JSON.parse(cleaned.slice(start, end + 1));
}

// Build a compact text view of a submission for prompting.
function describeSubmission({ questions, answers, followups }) {
  const lines = [];
  for (const q of (questions || [])) {
    const a = (answers || {})[q.id] || {};
    lines.push(`Q: ${q.text}\n  score: ${a.score != null ? a.score : '—'}/5${a.comment ? `\n  comment: ${a.comment}` : ''}`);
  }
  for (const f of (followups || [])) lines.push(`Follow-up: ${f.question}\n  answer: ${f.answer}`);
  return lines.join('\n');
}

/**
 * Ask Claude for 2-3 yes/no follow-up questions when the mood looks low.
 * Returns [{ id, text }]. Empty array on any failure (non-blocking).
 */
async function followUpQuestions(apiKey, { questions, answers }) {
  const summary = describeSubmission({ questions, answers, followups: [] });
  const system = [
    'You are an empathetic HR analyst running an employee-mood pulse survey.',
    'An employee just gave one or more low scores (3 or below on a 1-5 agreement scale).',
    'Propose 2 to 3 short YES/NO follow-up questions that gently dig into WHY the mood is low,',
    'so HR can understand the underlying cause (workload, environment, management, clarity, recognition, etc.).',
    'Questions must be answerable with a simple Yes or No, neutral and non-leading, and must not name individuals.',
    'Return STRICT JSON: {"questions":["...","..."]}. No commentary.',
  ].join(' ');
  try {
    const out = await callClaude(apiKey, { system, maxTokens: 400, messages: [{ role: 'user', content: `The employee's responses so far:\n\n${summary}\n\nGenerate the follow-up questions.` }] });
    const parsed = parseJson(out);
    const list = Array.isArray(parsed.questions) ? parsed.questions.slice(0, 3) : [];
    return list.map((t, i) => ({ id: `f${i + 1}`, text: String(t).slice(0, 240) }));
  } catch { return []; }
}

/**
 * Per-response sentiment: reads tone + language, not just the literal words.
 * Returns { label: 'positive'|'neutral'|'negative', tone, note }.
 */
async function analyseResponse(apiKey, { questions, answers, followups, avgScore }) {
  const summary = describeSubmission({ questions, answers, followups });
  const system = [
    'You are an expert people-analytics AI. Decode how the employee genuinely FEELS,',
    'not just what they literally wrote. Weigh tone, word choice, hedging, and the numeric scores.',
    'Classify overall sentiment as exactly one of: positive, neutral, negative.',
    'Also give a one-word tone (e.g. frustrated, hopeful, disengaged, content, anxious) and a short note (<=20 words).',
    'Return STRICT JSON: {"label":"...","tone":"...","note":"..."}. No commentary.',
  ].join(' ');
  const out = await callClaude(apiKey, { system, maxTokens: 300, messages: [{ role: 'user', content: `Average score: ${avgScore != null ? avgScore.toFixed(2) : 'n/a'}/5\n\n${summary}` }] });
  const p = parseJson(out);
  const label = ['positive', 'neutral', 'negative'].includes(p.label) ? p.label : 'neutral';
  return { label, tone: String(p.tone || '').slice(0, 40), note: String(p.note || '').slice(0, 160) };
}

/**
 * Monthly roll-up across all responses. `responses` is an array of
 * { department, branch, avgScore, sentiment, answers-as-text }. Returns
 * { good:[3], improve:[3], summary }. Sentiment %s and dept/branch splits are
 * computed in the route from stored per-response sentiment; this call adds the
 * qualitative good/improvement points.
 */
async function aggregateAnalysis(apiKey, { surveyName, blobs }) {
  const system = [
    'You are a people-analytics AI summarising an employee-mood survey for leadership.',
    'From the anonymised set of employee responses, identify the strongest themes.',
    'Give exactly 3 "good" points (what is working well) and exactly 3 "improve" points (where action is needed).',
    'Each point: a short, specific phrase (<=12 words), grounded in the responses, no names.',
    'Also give a 1-2 sentence overall summary of the mood.',
    'Return STRICT JSON: {"good":["","",""],"improve":["","",""],"summary":"..."}. No commentary.',
  ].join(' ');
  const joined = blobs.slice(0, 200).map((b, i) => `#${i + 1} [${b.department || '—'} / ${b.branch || '—'}] score ${b.avgScore != null ? b.avgScore.toFixed(1) : '—'} · ${b.sentiment || '—'}\n${b.text}`).join('\n\n');
  const out = await callClaude(apiKey, { system, maxTokens: 700, messages: [{ role: 'user', content: `Survey: ${surveyName}\n\nResponses:\n\n${joined}` }] });
  const p = parseJson(out);
  const trim3 = (a) => (Array.isArray(a) ? a.slice(0, 3).map((s) => String(s).slice(0, 120)) : []);
  return { good: trim3(p.good), improve: trim3(p.improve), summary: String(p.summary || '').slice(0, 400) };
}

/**
 * A short, warm, personal thank-you shown on submit — written as if the HR
 * manager is replying to this specific person, acknowledging how they seem to
 * feel. Plain text, 2-3 sentences. Falls back to a generic line on failure.
 */
async function successMessage(apiKey, { employeeName, avgScore, sentimentLabel, hasLowScores }) {
  const first = String(employeeName || 'there').split(' ')[0];
  const system = [
    'You are the HR manager personally replying to an employee who just completed a mood pulse survey.',
    'Write a warm, sincere, 2-3 sentence thank-you addressed to them by first name.',
    'If they seem to be having a hard time, acknowledge it with genuine care and reassure them HR is listening and will act.',
    'If they seem positive, share that warmth back. Never be corporate or robotic. No emojis. Plain text only.',
    'Return STRICT JSON: {"message":"..."}. No commentary.',
  ].join(' ');
  try {
    const out = await callClaude(apiKey, { system, maxTokens: 300, messages: [{ role: 'user', content: `Employee first name: ${first}\nAverage score: ${avgScore != null ? avgScore.toFixed(1) : 'n/a'}/5\nSentiment: ${sentimentLabel || 'unknown'}\nGave low scores: ${hasLowScores ? 'yes' : 'no'}` }] });
    const p = parseJson(out);
    return String(p.message || '').slice(0, 600) || `Thank you so much, ${first}. Your honest feedback genuinely helps us make this a better place to work.`;
  } catch {
    return `Thank you so much, ${first}. Your honest feedback genuinely helps us make this a better place to work — we're listening.`;
  }
}

module.exports = { followUpQuestions, analyseResponse, aggregateAnalysis, successMessage };

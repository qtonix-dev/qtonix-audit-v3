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

// Build a compact text view of a submission for prompting. Handles every
// question type (scale, single/multi choice, short answer) plus optional notes.
function describeSubmission({ questions, answers, followups }) {
  const lines = [];
  for (const q of (questions || [])) {
    const a = (answers || {})[q.id] || {};
    let ans = '—';
    if (q.type === 'scale5') ans = a.score != null ? `${a.score}/5` : '—';
    else if (q.type === 'single_choice') ans = a.choice != null ? `"${a.choice}"` : '—';
    else if (q.type === 'multi_choice') ans = Array.isArray(a.choices) && a.choices.length ? a.choices.map((c) => `"${c}"`).join(', ') : '—';
    else if (q.type === 'short_answer') ans = a.text ? `"${a.text}"` : '—';
    let line = `Q: ${q.text}\n  answer: ${ans}`;
    if (a.comment) line += `\n  comment: ${a.comment}`;
    lines.push(line);
  }
  for (const f of (followups || [])) lines.push(`Follow-up: ${f.question}\n  answer: ${f.answer}`);
  return lines.join('\n');
}

/**
 * Ask Claude for 2-3 yes/no follow-up questions when the mood looks low.
 * Returns [{ id, text }]. Empty array on any failure (non-blocking).
 */
async function followUpQuestions(apiKey, { questions, answers, guardrails = false }) {
  const summary = describeSubmission({ questions, answers, followups: [] });
  const guardrailLines = guardrails ? [
    'STRICT TOPIC GUARDRAILS — never ask about, hint at, or invite complaints regarding any of these:',
    'salary, pay, compensation, raises, bonuses, or money; leave, PTO, holidays, time-off, or attendance policy;',
    'benefits, perks, or reimbursements; layoffs, firing, resignation, or job security; legal, HR complaints, harassment, or disputes;',
    'or anything that solicits a grievance which could place the company in a negative or legal position.',
    'Keep the questions strictly about the employee\'s own experience, motivation and day-to-day working conditions.',
    'If a low score relates to a guardrailed topic, ask a neutral question about general wellbeing or support instead.',
  ] : [];
  const system = [
    'You are an empathetic HR analyst running an employee-mood pulse survey.',
    'An employee just gave one or more low scores (3 or below on a 1-5 agreement scale).',
    'Propose 2 to 3 short YES/NO follow-up questions that gently dig into WHY the mood is low,',
    'so HR can understand the underlying cause (workload, environment, clarity, recognition, collaboration, growth, etc.).',
    'Questions must be answerable with a simple Yes or No, neutral and non-leading, and must not name individuals.',
    ...guardrailLines,
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
 * Also weighs RESPONSE BEHAVIOUR (how long they lingered on each question and
 * how much they self-edited) to catch diplomatic/guarded answers.
 * Returns { label: 'positive'|'neutral'|'negative', tone, note }.
 */
async function analyseResponse(apiKey, { questions, answers, followups, avgScore, behavior }) {
  const summary = describeSubmission({ questions, answers, followups });
  // Turn behaviour into a readable hint the model can reason over.
  let behaviourText = '';
  if (behavior && behavior.perQuestion) {
    const notes = [];
    for (const q of (questions || [])) {
      const e = behavior.perQuestion[q.id];
      if (!e) continue;
      const bits = [];
      if (e.slow) bits.push('paused notably longer than their own average');
      if (e.heavyEdit) bits.push(`self-edited heavily (${e.backspaces} backspaces, ${e.changes} answer changes)`);
      if (bits.length) notes.push(`- "${q.text}": ${bits.join('; ')}`);
    }
    if (notes.length) behaviourText = `\n\nResponse behaviour signals (hesitation can mean they wanted to say more but answered diplomatically out of caution):\n${notes.join('\n')}`;
  }
  const system = [
    'You are an expert people-analytics AI. Decode how the employee genuinely FEELS,',
    'not just what they literally wrote. Weigh tone, word choice, hedging, and the numeric scores.',
    'ALSO weigh response behaviour: lingering long on a question or heavily self-editing often signals',
    'the person wanted to say something but softened it out of caution or fear — read past the diplomatic surface.',
    'Classify overall sentiment as exactly one of: positive, neutral, negative.',
    'Give a one-word tone (e.g. frustrated, hopeful, disengaged, content, anxious, guarded), a short note (<=24 words),',
    'and a "summary": a 2-3 sentence plain-language read of what THIS person actually thinks and feels — the substance of',
    'their view, what is driving it, and anything they seem to be holding back. Do not use their name.',
    'Return STRICT JSON: {"label":"...","tone":"...","note":"...","summary":"..."}. No commentary.',
  ].join(' ');
  const out = await callClaude(apiKey, { system, maxTokens: 500, messages: [{ role: 'user', content: `Average score: ${avgScore != null ? avgScore.toFixed(2) : 'n/a'}/5\n\n${summary}${behaviourText}` }] });
  const p = parseJson(out);
  const label = ['positive', 'neutral', 'negative'].includes(p.label) ? p.label : 'neutral';
  return { label, tone: String(p.tone || '').slice(0, 40), note: String(p.note || '').slice(0, 200), summary: String(p.summary || '').slice(0, 600) };
}

/**
 * Roll-up across all responses. `responses` is an array of
 * { department, branch, avgScore, sentiment, answers-as-text }. Returns
 * { good:[5], improve:[5], summary, departmentSummaries:[{name, summary, ...}] }.
 * Sentiment %s and dept/branch splits are computed in the route from stored
 * per-response sentiment; this call adds the qualitative analysis.
 */
async function aggregateAnalysis(apiKey, { surveyName, blobs }) {
  // Which departments are present, so we can ask for a per-department read.
  const depts = Array.from(new Set(blobs.map((b) => (b.department || '').trim()).filter(Boolean)));
  const deptLine = depts.length
    ? `The responses span these departments: ${depts.join(', ')}. For departmentSummaries, produce one entry PER department listed, each a 2-3 sentence read of how that department specifically feels and why (grounded in their responses). If a department has too few responses to read confidently, say so briefly in its summary.`
    : 'There are no distinct departments; return an empty departmentSummaries array.';
  const system = [
    'You are a people-analytics AI summarising an employee-mood survey for leadership.',
    'From the anonymised set of employee responses, produce a thorough, decision-useful analysis.',
    'Give exactly 5 "good" points (what is working well) and exactly 5 "improve" points (where action is needed).',
    'Each point: a specific, grounded phrase (<=16 words), no names.',
    'Write a DETAILED overall summary (4-6 sentences): the general mood, the main drivers behind it,',
    'any notable tensions or divides, how strongly people feel, and what leadership should pay attention to first.',
    deptLine,
    'Return STRICT JSON: {"good":["","","","",""],"improve":["","","","",""],"summary":"...","departmentSummaries":[{"name":"","summary":""}]}. No commentary.',
  ].join(' ');
  const joined = blobs.slice(0, 200).map((b, i) => `#${i + 1} [${b.department || '—'} / ${b.branch || '—'}] score ${b.avgScore != null ? b.avgScore.toFixed(1) : '—'} · ${b.sentiment || '—'}\n${b.text}`).join('\n\n');
  const out = await callClaude(apiKey, { system, maxTokens: 1600, messages: [{ role: 'user', content: `Survey: ${surveyName}\n\nResponses:\n\n${joined}` }] });
  const p = parseJson(out);
  const trimN = (a, n, len) => (Array.isArray(a) ? a.slice(0, n).map((s) => String(s).slice(0, len)) : []);
  const deptSummaries = Array.isArray(p.departmentSummaries)
    ? p.departmentSummaries.slice(0, 40).map((d) => ({ name: String(d.name || '').slice(0, 80), summary: String(d.summary || '').slice(0, 600) })).filter((d) => d.name)
    : [];
  return { good: trimN(p.good, 5, 140), improve: trimN(p.improve, 5, 140), summary: String(p.summary || '').slice(0, 1200), departmentSummaries: deptSummaries };
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

/**
 * Deep report insights for the detailed survey PDF. Takes the same anonymised
 * blobs plus per-person rows (name + sentiment) and returns action-oriented
 * sections for leadership. Names ARE used here because this is the internal
 * management report (not shared with employees).
 */
async function surveyReportInsights(apiKey, { surveyName, people }) {
  const system = [
    'You are a senior people-analytics advisor preparing a confidential management report from an employee-mood survey.',
    'You are given each employee\'s name, average score, sentiment and a short read of their responses.',
    'Produce STRICT JSON with these keys:',
    '"attention": array of {name, reason} — employees whose mood/answers suggest they need attention now (<=25 words reason).',
    '"oneToOne": array of {name, reason} — employees who would benefit from a 1:1 conversation (<=25 words).',
    '"forHR": array of strings — concrete points the HR team should discuss or act on (<=20 words each).',
    '"forManager": array of strings — points for the Team Lead / Manager to address with their team (<=20 words each).',
    '"forManagement": array of strings — strategic actions senior management should take (<=20 words each).',
    'Base everything strictly on the provided data. Only list people who genuinely warrant it — empty arrays are fine.',
    'Return ONLY the JSON object. No commentary.',
  ].join(' ');
  const roster = people.slice(0, 200).map((p, i) => `#${i + 1} ${p.name || 'Employee'} [${p.department || '—'}] score ${p.avgScore != null ? p.avgScore.toFixed(1) : '—'} · ${p.sentiment || 'unrated'}${p.summary ? ` — ${p.summary}` : ''}`).join('\n');
  try {
    const out = await callClaude(apiKey, { system, maxTokens: 2000, messages: [{ role: 'user', content: `Survey: ${surveyName}\n\nEmployees:\n\n${roster}` }] });
    const p = parseJson(out);
    const arrOf = (a, keys) => Array.isArray(a) ? a.slice(0, 30).map((x) => {
      if (typeof x === 'string') return x.slice(0, 200);
      const o = {}; keys.forEach((k) => { o[k] = String(x[k] || '').slice(0, 200); }); return o;
    }) : [];
    return {
      attention: arrOf(p.attention, ['name', 'reason']).filter((x) => x.name),
      oneToOne: arrOf(p.oneToOne, ['name', 'reason']).filter((x) => x.name),
      forHR: arrOf(p.forHR).filter(Boolean),
      forManager: arrOf(p.forManager).filter(Boolean),
      forManagement: arrOf(p.forManagement).filter(Boolean),
    };
  } catch {
    return { attention: [], oneToOne: [], forHR: [], forManager: [], forManagement: [] };
  }
}

module.exports = { followUpQuestions, analyseResponse, aggregateAnalysis, surveyReportInsights, successMessage };

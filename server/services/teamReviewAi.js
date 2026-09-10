// ===========================================================================
// CLAUDE REVIEW for team day-end reports.
// Given an assembled team-day (attendance + tasks + timing + notes + baseline),
// asks Claude to judge each task's pace (fast/good/slow) against its title,
// priority, and the employee's own historical median, plus a per-employee and
// whole-day verdict. Results are cached by the caller (HrTeamReview).
// ===========================================================================
const { Settings } = require('../models');
let recordApiCall; try { ({ recordApiCall } = require('../models')); } catch { recordApiCall = () => {}; }

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

async function getKey() {
  try { const s = await Settings.findOne({ where: { singleton: 'settings' } }); return s && s.getKey && s.getKey('anthropic'); } catch { return null; }
}

async function callClaude(apiKey, { system, messages, maxTokens = 1500 }) {
  try { recordApiCall && recordApiCall('anthropic'); } catch {}
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

function parseJson(text) {
  const cleaned = String(text).replace(/```json|```/g, '').trim();
  const s = cleaned.indexOf('{'); const e = cleaned.lastIndexOf('}');
  if (s === -1 || e === -1) throw new Error('No JSON in model reply');
  return JSON.parse(cleaned.slice(s, e + 1));
}

function fmtMs(ms) { if (!ms) return '—'; const m = Math.round(ms / 60000); const h = Math.floor(m / 60); return h > 0 ? `${h}h ${m % 60}m` : `${m}m`; }

// Compact the day into a prompt-friendly structure.
function describeDay(day) {
  return day.employees.map((e) => {
    const base = e.baseline ? `median ${fmtMs(e.baseline.medianMs)} over ${e.baseline.samples} past tasks` : 'no prior history';
    const tasks = e.tasks.map((t) => {
      const notes = (t.notes || []).map((n) => `${n.by}: ${n.body}`).join(' | ');
      return {
        id: t.id, title: t.title, priority: t.priority, status: t.stage,
        timeTaken: fmtMs(t.timeMs), overdue: t.overdue,
        notes: notes || null,
      };
    });
    return {
      employeeId: e.employee.id, name: e.employee.name, role: e.employee.designation,
      present: e.attendance.present, hours: e.attendance.hoursLabel,
      baseline: base, dayNote: e.note || null, tasks,
    };
  });
}

const SYSTEM = `You are a fair, supportive engineering manager reviewing a team's day-end work log.
For EACH task, judge the pace as "fast", "good", or "slow" by comparing the time taken against:
  - the nature/complexity implied by the task title,
  - its priority,
  - and the employee's own historical median (their baseline).
A short/simple task taking many hours is "slow"; a substantial task done quickly is "fast"; reasonable is "good". If a task is still in progress or has no reliable time, use pace "na".
For EACH employee, give a one-word verdict ("productive", "steady", or "needs_attention") and ONE short encouraging sentence.
For the whole DAY, give a verdict ("productive", "light", or "slow") and ONE short summary sentence naming standouts and anyone who may need a check-in.
Be constructive and concise. Never be harsh.
Reply with ONLY valid JSON in exactly this shape:
{"day":{"verdict":"productive","summary":"..."},"employees":{"<employeeId>":{"verdict":"productive","summary":"..."}},"tasks":{"<taskId>":{"pace":"fast","reason":"..."}}}`;

// Main entry: returns { dayVerdict, daySummary, perEmployee:{id:{verdict,summary}}, perTask:{id:{pace,reason}} }.
// Falls back to a heuristic (no AI) when no key is configured or the call fails.
async function reviewTeamDay(day) {
  const apiKey = await getKey();
  if (!apiKey || !day.employees.length) return heuristicReview(day);
  try {
    const payload = describeDay(day);
    const text = await callClaude(apiKey, {
      system: SYSTEM,
      messages: [{ role: 'user', content: `Date: ${day.date}\nTeam log:\n${JSON.stringify(payload, null, 1)}` }],
      maxTokens: 1800,
    });
    const j = parseJson(text);
    return {
      dayVerdict: (j.day && j.day.verdict) || 'productive',
      daySummary: (j.day && j.day.summary) || '',
      perEmployee: j.employees || {},
      perTask: j.tasks || {},
      ai: true,
    };
  } catch (e) {
    return { ...heuristicReview(day), aiError: String(e.message).slice(0, 120) };
  }
}

// Deterministic fallback so the feature always works without a key.
function heuristicReview(day) {
  const perTask = {}; const perEmployee = {};
  for (const e of day.employees) {
    const med = e.baseline ? e.baseline.medianMs : null;
    for (const t of e.tasks) {
      if (t.stage !== 'completed' || !t.timeMs) { perTask[t.id] = { pace: 'na', reason: '' }; continue; }
      let pace = 'good';
      if (med) { if (t.timeMs <= med * 0.6) pace = 'fast'; else if (t.timeMs >= med * 1.6) pace = 'slow'; }
      perTask[t.id] = { pace, reason: '' };
    }
    const done = e.counts.done; const total = e.counts.total || 1;
    const ratio = done / total;
    let verdict = 'steady';
    if (!e.attendance.present) verdict = 'needs_attention';
    else if (ratio >= 0.6 && done >= 1) verdict = 'productive';
    else if (e.counts.overdue > 0 || (done === 0 && total > 0)) verdict = 'needs_attention';
    perEmployee[e.employee.id] = { verdict, summary: '' };
  }
  const dayRatio = day.totalPlanned ? day.totalDone / day.totalPlanned : 0;
  const dayVerdict = dayRatio >= 0.6 ? 'productive' : (dayRatio >= 0.3 ? 'light' : 'slow');
  return { dayVerdict, daySummary: '', perEmployee, perTask, ai: false };
}

module.exports = { reviewTeamDay, heuristicReview };

/**
 * AI helpers for tasks — description rewrite/improve/tone, and note suggestions.
 * Reuses the shared Claude client. All functions are best-effort: on any failure
 * they throw, and the route turns that into a friendly error.
 */
const { callClaude } = require('./aiVisibility');

function stripHtml(s) { return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }

// Improve / rewrite / retone a task description. `mode` ∈
//   improve | rewrite | professional | shorter | friendly
async function rewriteDescription(apiKey, { title, text, mode }) {
  const clean = stripHtml(text).slice(0, 4000);
  const t = String(title || '').slice(0, 200);
  const INSTRUCT = {
    improve: 'Fix all grammar and spelling, then expand it into a clear, well-structured task description. Add helpful detail a teammate would need (what, why, acceptance/verification), inferred sensibly from the task — but do not invent specific facts, names, dates or numbers that aren\'t implied.',
    rewrite: 'Rewrite it fresh in clear, natural language while keeping the exact same meaning and scope. Fix grammar. Do not add new facts.',
    professional: 'Rewrite in a professional, formal business tone. Fix grammar. Keep the meaning; do not add new facts.',
    shorter: 'Condense to the essentials — the shortest version that still fully conveys the task. Fix grammar. Remove fluff.',
    friendly: 'Rewrite in a warm, friendly, approachable tone while staying clear and useful. Fix grammar. Keep the meaning.',
  };
  const instruction = INSTRUCT[mode] || INSTRUCT.improve;
  const system = 'You improve task descriptions for a work management tool. Return ONLY the improved description text, with no preamble, quotes, or markdown headings. Plain sentences and short paragraphs. Never use placeholders like [name] or [date].';
  const out = await callClaude(apiKey, {
    system,
    maxTokens: 900,
    messages: [{ role: 'user', content: `Task title: "${t}"\n\nCurrent description:\n"""${clean || '(empty)'}"""\n\n${instruction}\n\nReturn only the new description.` }],
  });
  return String(out || '').trim();
}

// Suggest the 3 most relevant note/comment options for a task's current
// situation. Returns an array of short strings (may start with an emoji).
async function suggestNotes(apiKey, { title, description, status }) {
  const t = String(title || '').slice(0, 200);
  const d = stripHtml(description).slice(0, 1500);
  const s = String(status || '').slice(0, 40);
  const system = 'You suggest short status-update comments a teammate might post on a task. Output STRICT JSON: an array of exactly 3 strings, each a natural one-line comment (may start with a relevant emoji), tailored to the task and its status. No prose, no markdown, no keys — just the JSON array.';
  const out = await callClaude(apiKey, {
    system,
    maxTokens: 400,
    messages: [{ role: 'user', content: `Task: "${t}"\nStatus: ${s || 'unknown'}\nDescription: ${d || '(none)'}\n\nGive the 3 most useful, situation-appropriate note options for someone updating this task now.` }],
  });
  let arr = [];
  try { const m = String(out).match(/\[[\s\S]*\]/); arr = JSON.parse(m ? m[0] : out); } catch { arr = []; }
  if (!Array.isArray(arr)) arr = [];
  return arr.filter((x) => typeof x === 'string' && x.trim()).slice(0, 3).map((x) => x.trim().slice(0, 200));
}

// Retone a note the user typed. `mode` ∈ professional | shorter | friendly
async function retoneNote(apiKey, { text, mode }) {
  const clean = String(text || '').slice(0, 1000).trim();
  if (!clean) return '';
  const INSTRUCT = {
    professional: 'Rewrite this note in a professional, polished tone. Fix grammar. Keep it one to two sentences.',
    shorter: 'Make this note shorter and crisper while keeping the point. Fix grammar.',
    friendly: 'Rewrite this note in a warm, friendly tone. Fix grammar. Keep it brief.',
  };
  const system = 'You rewrite short work-note comments. Return ONLY the rewritten note text — no quotes, no preamble.';
  const out = await callClaude(apiKey, {
    system, maxTokens: 200,
    messages: [{ role: 'user', content: `Note: "${clean}"\n\n${INSTRUCT[mode] || INSTRUCT.professional}\n\nReturn only the rewritten note.` }],
  });
  return String(out || '').trim();
}

module.exports = { rewriteDescription, suggestNotes, retoneNote };

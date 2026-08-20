/**
 * Optional OpenAI pass that rewrites AI-generated survey summaries into plain,
 * simple, easy-to-read language. Used after the Claude analysis; if no OpenAI
 * key is set (or the call fails), the caller keeps the original summaries.
 *
 * Takes { overall, branches:[{name,summary}], departments:[{name,summary}] }
 * (any subset) and returns the same shape with simplified text.
 */
const OPENAI_API = 'https://api.openai.com/v1/chat/completions';
const MODEL = process.env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini';

async function callOpenAI(apiKey, { system, user, maxTokens = 1500 }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  let res;
  try {
    res = await fetch(OPENAI_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          { role: 'user', content: user },
        ],
        max_tokens: maxTokens,
        temperature: 0.3,
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'OpenAI request timed out' : e.message);
  } finally { clearTimeout(timer); }
  if (!res.ok) { const t = await res.text(); throw new Error(`OpenAI ${res.status}: ${t.slice(0, 200)}`); }
  const data = await res.json();
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
}

function parseJson(text) {
  const cleaned = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.search(/[[{]/);
  if (start === -1) throw new Error('No JSON in response');
  return JSON.parse(cleaned.slice(start));
}

/**
 * Rewrite the provided summaries in plain language. Returns { overall, branches,
 * departments } with the same names but simplified summaries, or null on failure.
 */
async function rewriteSummaries(apiKey, { overall, branches, departments } = {}) {
  if (!apiKey) return null;
  const payload = {
    overall: overall || '',
    branches: Array.isArray(branches) ? branches.map((b) => ({ name: b.name, summary: b.summary })) : [],
    departments: Array.isArray(departments) ? departments.map((d) => ({ name: d.name, summary: d.summary })) : [],
  };
  // Nothing to do.
  if (!payload.overall && !payload.branches.length && !payload.departments.length) return null;
  const system = [
    'You rewrite workplace survey summaries into plain, simple, easy-to-read English.',
    'Keep every fact and nuance, but use short sentences and everyday words a busy manager can skim.',
    'Do not add new information, do not invent numbers, do not use names that were not there.',
    'Keep a warm, professional, neutral tone. Keep roughly the same length or slightly shorter.',
    'Return STRICT JSON with the SAME structure and the SAME names you were given: {"overall":"...","branches":[{"name":"","summary":""}],"departments":[{"name":"","summary":""}]}.',
    'If a field was empty, return it empty. No commentary.',
  ].join(' ');
  try {
    const out = await callOpenAI(apiKey, { system, user: JSON.stringify(payload), maxTokens: 2000 });
    const p = parseJson(out);
    const mapArr = (arr, orig) => Array.isArray(arr)
      ? arr.map((x) => ({ name: String(x.name || '').slice(0, 80), summary: String(x.summary || '').slice(0, 1000) })).filter((x) => x.name)
      : orig;
    return {
      overall: typeof p.overall === 'string' && p.overall.trim() ? p.overall.slice(0, 1600) : payload.overall,
      branches: mapArr(p.branches, payload.branches),
      departments: mapArr(p.departments, payload.departments),
    };
  } catch {
    return null;
  }
}

module.exports = { rewriteSummaries, callOpenAI };

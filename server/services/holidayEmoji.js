/**
 * Picks a relevant emoji for a holiday name. Uses a fast keyword matcher that
 * covers common Indian and global holidays; for anything unmatched it can fall
 * back to OpenAI (once per distinct name) and caches the result in Settings so
 * the AI call never repeats.
 */
const OPENAI_API = 'https://api.openai.com/v1/chat/completions';
const MODEL = process.env.OPENAI_META_MODEL || 'gpt-4o-mini';

// Keyword → emoji. First match wins; keys are matched case-insensitively as
// substrings, so "Diwali / Deepavali" covers both.
const MAP = [
  [/diwali|deepavali|deepawali/, '🪔'],
  [/holi/, '🎨'],
  [/christmas|xmas/, '🎄'],
  [/new year/, '🎉'],
  [/independence/, '🇮🇳'],
  [/republic/, '🇮🇳'],
  [/gandhi|jayanti/, '🕊️'],
  [/eid|ramadan|ramzan|bakrid|id-ul|id ul/, '🌙'],
  [/raksha|rakhi/, '🧵'],
  [/janmashtami|krishna/, '🦚'],
  [/ganesh|chaturthi|vinayaka/, '🐘'],
  [/durga|dussehra|dasara|vijayadashami|navratri|puja|pooja/, '🙏'],
  [/onam/, '🌸'],
  [/pongal|sankranti|makar/, '🌾'],
  [/baisakhi|vaisakhi/, '🌾'],
  [/lohri/, '🔥'],
  [/good friday|easter/, '✝️'],
  [/buddha|purnima/, '☸️'],
  [/mahavir/, '🕉️'],
  [/guru nanak|gurpurab|gurupurab/, '🙏'],
  [/labour|labor|may day/, '🛠️'],
  [/valentine/, '❤️'],
  [/women/, '👩'],
  [/karwa|karva/, '🌕'],
  [/ratha|jagannath|rath yatra/, '🛕'],
  [/ugadi|gudi/, '🌱'],
  [/bihu/, '🌾'],
  [/christmas eve/, '🎄'],
  [/anniversary|foundation|founding/, '🏢'],
  [/festival|fest/, '🎊'],
  [/harvest/, '🌾'],
];

function localEmoji(name) {
  const n = String(name || '').toLowerCase();
  for (const [re, emoji] of MAP) if (re.test(n)) return emoji;
  return null;
}

async function aiEmoji(apiKey, name) {
  try {
    const res = await fetch(OPENAI_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL, temperature: 0, max_tokens: 8,
        messages: [
          { role: 'system', content: 'Reply with exactly ONE emoji that best represents the given holiday. No words, no punctuation, just the emoji.' },
          { role: 'user', content: String(name || '').slice(0, 80) },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const txt = ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '').trim();
    // Keep only the first emoji-ish glyph.
    const m = [...txt].find((ch) => ch.codePointAt(0) > 0x2000);
    return m || null;
  } catch { return null; }
}

// Resolve emoji for a list of holiday names. Uses local map first; AI-fills the
// rest if an OpenAI key is available, caching every resolution in Settings.
async function resolveHolidayEmojis(names, { settings, apiKey } = {}) {
  const cache = (settings && settings.holidayEmojiCache) || {};
  const out = {};
  let cacheDirty = false;
  for (const name of names) {
    const key = String(name || '').toLowerCase().trim();
    if (!key) { out[name] = '📅'; continue; }
    if (cache[key]) { out[name] = cache[key]; continue; }
    let e = localEmoji(name);
    if (!e && apiKey) e = await aiEmoji(apiKey, name);
    if (!e) e = '📅';
    out[name] = e; cache[key] = e; cacheDirty = true;
  }
  if (cacheDirty && settings) { settings.holidayEmojiCache = cache; settings.changed('holidayEmojiCache', true); try { await settings.save(); } catch {} }
  return out;
}

module.exports = { resolveHolidayEmojis, localEmoji };

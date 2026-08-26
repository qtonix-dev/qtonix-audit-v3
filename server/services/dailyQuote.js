/**
 * Daily motivational quote for the employee dashboard.
 *
 * Returns one short, well-known quote from a real, famous person, changing once
 * per day. The day's pick is cached in Settings (settings.dailyQuoteCache, keyed
 * by IST date) so everyone sees the same quote all day and OpenAI is called at
 * most once per day. If no key is set (or the call fails / returns junk), we fall
 * back to a curated pool rotated by day-of-year, so this never breaks and never
 * shows an empty quote.
 */
const OPENAI_API = 'https://api.openai.com/v1/chat/completions';

// Curated fallback pool — real, widely-attributed quotes. Rotated by day so the
// dashboard still changes daily even with no API key.
const FALLBACK = [
  { quote: 'The only way to do great work is to love what you do.', author: 'Steve Jobs' },
  { quote: 'Success is not final, failure is not fatal: it is the courage to continue that counts.', author: 'Winston Churchill' },
  { quote: 'The future belongs to those who believe in the beauty of their dreams.', author: 'Eleanor Roosevelt' },
  { quote: 'It always seems impossible until it is done.', author: 'Nelson Mandela' },
  { quote: 'Quality is not an act, it is a habit.', author: 'Aristotle' },
  { quote: 'The best way to predict the future is to create it.', author: 'Peter Drucker' },
  { quote: 'Whether you think you can or you think you cannot, you are right.', author: 'Henry Ford' },
  { quote: 'Strive not to be a success, but rather to be of value.', author: 'Albert Einstein' },
  { quote: 'The mind is everything. What you think you become.', author: 'Buddha' },
  { quote: 'Well done is better than well said.', author: 'Benjamin Franklin' },
  { quote: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
  { quote: 'Do what you can, with what you have, where you are.', author: 'Theodore Roosevelt' },
  { quote: 'A person who never made a mistake never tried anything new.', author: 'Albert Einstein' },
  { quote: 'You miss 100 percent of the shots you never take.', author: 'Wayne Gretzky' },
  { quote: 'The harder I work, the luckier I get.', author: 'Samuel Goldwyn' },
  { quote: 'Everything you have ever wanted is on the other side of fear.', author: 'George Addair' },
  { quote: 'Believe you can and you are halfway there.', author: 'Theodore Roosevelt' },
  { quote: 'Genius is one percent inspiration and ninety-nine percent perspiration.', author: 'Thomas Edison' },
  { quote: 'What we think, we become.', author: 'Buddha' },
  { quote: 'Opportunities do not happen. You create them.', author: 'Chris Grosser' },
  { quote: 'The way to get started is to quit talking and begin doing.', author: 'Walt Disney' },
  { quote: 'If you want to lift yourself up, lift up someone else.', author: 'Booker T. Washington' },
  { quote: 'Perseverance is not a long race; it is many short races one after another.', author: 'Walter Elliot' },
  { quote: 'Hardships often prepare ordinary people for an extraordinary destiny.', author: 'C. S. Lewis' },
  { quote: 'The best preparation for tomorrow is doing your best today.', author: 'H. Jackson Brown Jr.' },
  { quote: 'Start where you are. Use what you have. Do what you can.', author: 'Arthur Ashe' },
  { quote: 'Act as if what you do makes a difference. It does.', author: 'William James' },
  { quote: 'Setting goals is the first step in turning the invisible into the visible.', author: 'Tony Robbins' },
  { quote: 'Dream big and dare to fail.', author: 'Norman Vaughan' },
  { quote: 'Little things make big days.', author: 'Isabel Marant' },
  { quote: 'It is never too late to be what you might have been.', author: 'George Eliot' },
];

function istDateStr() {
  return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
}
function dayOfYear(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((d - start) / 86400000);
}
function fallbackFor(dateStr) {
  return FALLBACK[dayOfYear(dateStr) % FALLBACK.length];
}

async function fromOpenAI(apiKey, recentAuthors) {
  const avoid = (recentAuthors || []).slice(0, 10).join(', ');
  const body = {
    model: 'gpt-4o-mini',
    temperature: 1,
    messages: [
      { role: 'system', content: 'You return a single famous, real, correctly-attributed motivational quote. Keep the quote under 25 words. Reply ONLY with compact JSON: {"quote":"...","author":"..."} and nothing else. Do not invent quotes or authors.' },
      { role: 'user', content: `Give me one motivational quote from a well-known real person for a workplace dashboard.${avoid ? ` Avoid these authors used recently: ${avoid}.` : ''}` },
    ],
  };
  const res = await fetch(OPENAI_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const data = await res.json();
  let txt = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  txt = txt.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(txt);
  const quote = String(parsed.quote || '').trim();
  const author = String(parsed.author || '').trim();
  if (!quote || !author || quote.length > 220) throw new Error('bad quote payload');
  return { quote, author };
}

/**
 * Resolve today's quote. Uses the cached value if it's for today; otherwise
 * generates via OpenAI (if a key is available) and caches it, else falls back
 * to the curated pool. Always resolves to a valid { quote, author, date }.
 */
async function getDailyQuote({ settings, apiKey } = {}) {
  const date = istDateStr();
  const cache = (settings && settings.dailyQuoteCache) || {};
  if (cache && cache.date === date && cache.quote && cache.author) {
    return { quote: cache.quote, author: cache.author, date };
  }
  let picked = null;
  if (apiKey) {
    try { picked = await fromOpenAI(apiKey, (cache && cache.recentAuthors) || []); } catch { picked = null; }
  }
  if (!picked) picked = fallbackFor(date);

  if (settings) {
    const recentAuthors = [picked.author, ...(((cache && cache.recentAuthors) || []))].slice(0, 12);
    settings.dailyQuoteCache = { date, quote: picked.quote, author: picked.author, recentAuthors };
    settings.changed('dailyQuoteCache', true);
    try { await settings.save(); } catch {}
  }
  return { quote: picked.quote, author: picked.author, date };
}

module.exports = { getDailyQuote, fallbackFor };

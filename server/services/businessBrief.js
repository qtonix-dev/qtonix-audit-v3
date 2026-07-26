/**
 * AI BUSINESS BRIEF
 * -----------------
 * Reads a prospect's website and turns it into a short brief an agent can skim
 * before dialling: what the business actually sells, whether their contact
 * details and social presence are in order, which services we could pitch, and
 * the specific weaknesses worth raising on the call.
 *
 * Two stages, deliberately separated:
 *   1. Crawl the site ourselves and extract hard facts (NAP, social links,
 *      schema, headings, word count). These are checks, not opinions, so doing
 *      them in code is cheaper and more reliable than asking a model.
 *   2. Hand those facts plus the page text to Claude for the judgement calls —
 *      positioning, target market, keywords, pain points, pitch angle.
 *
 * Results are cached on the lead. A brief only changes when the site changes,
 * so re-crawling on every click would waste time and API credit; the UI offers
 * a refresh once the cached copy is a week old.
 */

const cheerio = require('cheerio');
const { crawlHomepage, normaliseUrl, getPageSpeed } = require('./crawler');

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

/** How long a cached brief stays fresh before we offer a refresh. */
const CACHE_DAYS = 7;

async function callClaude(apiKey, { system, messages, maxTokens = 2000 }) {
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

/** Pull the first JSON object out of a model reply, tolerating stray prose. */
function parseJson(text) {
  const cleaned = String(text).replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON found in model response');
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * Hard facts pulled straight from the HTML — no model involved.
 * NAP = Name, Address, Phone, the local-SEO basics.
 */
function extractSignals(html, website) {
  const $ = cheerio.load(html);
  const text = $('body').text().replace(/\s+/g, ' ');

  // Phone: tel: links are the reliable signal; loose digit matching produces
  // too many false hits from prices and dates.
  const telLinks = $('a[href^="tel:"]').map((_, el) => $(el).attr('href').replace('tel:', '').trim()).get();
  const phoneInText = /(\+?\d[\d\s().-]{7,}\d)/.exec(text);
  const phones = [...new Set([...telLinks, ...(phoneInText ? [phoneInText[1].trim()] : [])])].slice(0, 3);

  const emails = [...new Set(
    $('a[href^="mailto:"]').map((_, el) => $(el).attr('href').replace('mailto:', '').split('?')[0].trim()).get(),
  )].slice(0, 3);

  // Address: prefer structured markup, fall back to a postal-code-ish pattern.
  let address = '';
  $('script[type="application/ld+json"]').each((_, el) => {
    if (address) return;
    try {
      const walk = (n) => {
        if (!n || address) return;
        if (Array.isArray(n)) return n.forEach(walk);
        if (typeof n === 'object') {
          if (n.address && typeof n.address === 'object') {
            const a = n.address;
            address = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, a.addressCountry]
              .filter(Boolean).join(', ');
          }
          Object.values(n).forEach(walk);
        }
      };
      walk(JSON.parse($(el).contents().text()));
    } catch { /* malformed schema is common; ignore */ }
  });
  if (!address) {
    const m = /\d{1,5}\s+[\w\s.,'-]{5,60}\b(?:\d{5}(?:-\d{4})?|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})/i.exec(text);
    if (m) address = m[0].trim();
  }

  const SOCIALS = {
    facebook: /facebook\.com/i, instagram: /instagram\.com/i, linkedin: /linkedin\.com/i,
    twitter: /(?:twitter\.com|x\.com)/i, youtube: /youtube\.com/i, tiktok: /tiktok\.com/i,
    pinterest: /pinterest\./i,
  };
  const social = {};
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    for (const [name, re] of Object.entries(SOCIALS)) {
      if (!social[name] && re.test(href)) social[name] = href;
    }
  });

  const headings = $('h1, h2').map((_, el) => $(el).text().replace(/\s+/g, ' ').trim()).get()
    .filter(Boolean).slice(0, 25);

  return {
    title: $('title').first().text().trim().slice(0, 200),
    metaDescription: ($('meta[name="description"]').attr('content') || '').trim().slice(0, 400),
    headings,
    phones, emails, address,
    social,
    hasNap: { name: !!$('title').first().text().trim(), address: !!address, phone: phones.length > 0 },
    napComplete: !!address && phones.length > 0,
    socialCount: Object.keys(social).length,
    hasContactPage: $('a[href*="contact" i]').length > 0,
    hasBlog: $('a[href*="blog" i], a[href*="news" i]').length > 0,
    hasSsl: String(website || '').startsWith('https'),
    // Trimmed page text for the model. Enough to judge positioning without
    // sending an entire site and burning tokens.
    bodyText: text.slice(0, 12000),
  };
}

const SYSTEM = `You are an experienced sales manager and website expert at a digital marketing agency.
An agent is about to phone this prospect cold. Give them a brief that makes them sound informed.

Be specific and concrete. Never invent facts: if the site does not say something, say it is unclear.
Write plainly, for someone skimming 30 seconds before dialling. No marketing fluff.
Respond with JSON only — no preamble, no code fences.`;

function buildPrompt(signals, ctx) {
  return `Analyse this business from its homepage.

BUSINESS: ${ctx.businessName || 'Unknown'}
WEBSITE: ${ctx.website}
TITLE: ${signals.title}
META: ${signals.metaDescription}
HEADINGS: ${signals.headings.join(' | ')}

TECHNICAL FACTS ALREADY CHECKED (trust these over your own reading):
- Phone on site: ${signals.phones.length ? signals.phones.join(', ') : 'NOT FOUND'}
- Address on site: ${signals.address || 'NOT FOUND'}
- Email on site: ${signals.emails.length ? signals.emails.join(', ') : 'NOT FOUND'}
- Social profiles linked: ${signals.socialCount ? Object.keys(signals.social).join(', ') : 'NONE'}
- Blog/news section: ${signals.hasBlog ? 'yes' : 'no'}
- HTTPS: ${signals.hasSsl ? 'yes' : 'no'}

PAGE TEXT:
${signals.bodyText}

SCORING THE SITE FOR AI SEARCH (aiSeoScore, 0-10 whole numbers):
Judge how likely this site is to be surfaced and quoted by AI assistants
(ChatGPT, Perplexity, Google AI Overviews) when someone asks about what it sells.
Weigh: does it answer real questions in plain language, or is it brochure copy?
Is there structured data? Are entity signals (who, where, what) explicit?
Is there depth worth citing, or one thin page? Are the local signals complete?
Calibrate honestly — most small business sites land between 2 and 5. Reserve
8+ for sites with genuine depth, structure and answerability. Give the score
in aiSeoScore, a one-line justification in aiSeoReason, and 3-5 contributing
factors each scored out of 10 in aiSeoBreakdown.

Return exactly this JSON shape:
{
  "summary": "3-4 sentences: what this business does, who it serves, how it positions itself.",
  "aiSeoScore": 0,
  "aiSeoReason": "1-2 sentences justifying the score, naming the biggest single factor.",
  "aiSeoBreakdown": [
    {"factor": "e.g. Content depth / Schema markup / Local signals / Answerability", "score": 0, "note": "one short line"}
  ],
  "industry": "short industry label",
  "offerings": ["main products or services, up to 6"],
  "targetAudience": "who their customers appear to be",
  "targetArea": "geographic area served, or 'Unclear' if not stated",
  "marketPosition": "1-2 sentences on how competitive their space looks and where they sit in it",
  "keywords": ["8-12 realistic search terms their customers would use"],
  "painPoints": [
    {"issue": "specific weakness visible on the site", "why": "why it costs them business", "mention": "how to raise it on a call without being rude"}
  ],
  "servicesToPitch": [
    {"service": "one of: SEO, Local SEO, AI SEO, Google Ads, Social Media Marketing, Website Design, Website Development, Logo Design, Website Maintenance, Complete Digital Marketing", "why": "why it fits this specific business", "priority": "high|medium|low"}
  ],
  "conversationStarters": ["2-3 opening lines the agent can actually open the call with. Write them the way a seasoned cold-calling sales manager would — someone who knows the first sentence decides whether the prospect keeps listening. Lead with something specific and true about THEIR business that earns attention immediately (a detail from their site, their market, their location). Confident and specific, warm not slick, and grounded in a real observation — never generic filler like 'I hope you're doing well'. No buzzwords, no exclamation marks, no hype. Each line should make the prospect think 'this person actually looked at my business'."],
  "shareWithCustomer": [
    {"point": "a concrete, positive or useful fact about their business/site the agent can mention to build rapport or credibility on the call", "detail": "one short line the agent can say"}
  ],
  "aiSeoScore": 0,
  "aiSeoReason": "one sentence justifying the score",
  "aiSeoBreakdown": [
    {"factor": "short factor name", "score": 0, "note": "what is good or missing"}
  ]
}

For aiSeoScore, rate 0-10 how well this site is set up to be found and cited by AI
search (ChatGPT, Perplexity, Google AI Overviews). Judge on: clear factual content
a model can quote, structured data, entity clarity (who they are, where, what they
do), depth of topical coverage, and whether key facts like NAP are machine-readable.
A brochure site with three vague pages scores 2-3. A site with detailed service
pages, schema markup and complete contact details scores 7-8. Reserve 9-10 for
sites with genuinely comprehensive, well-structured, citable content.
Give 3-5 entries in aiSeoBreakdown, each scored 0-10.`;
}

/**
 * Produce a brief for one lead's website.
 * Returns the object stored on lead.aiBrief.
 */
async function generateBrief(apiKey, { website, businessName, pageSpeedKey }) {
  if (!website) throw new Error('This lead has no website to analyse.');
  const url = normaliseUrl(website).toString();

  // Reuse the audit crawler so redirects, timeouts and user-agent handling
  // behave identically to the report pipeline.
  let html = '';
  try {
    const crawl = await crawlHomepage(url);
    html = crawl.html || '';
  } catch (e) {
    throw new Error(`Could not read the website (${e.message}). Check the URL is correct and the site is online.`);
  }
  if (!html) throw new Error('The website returned no readable content.');

  const signals = extractSignals(html, url);

  // Claude and both PageSpeed runs go out together: PageSpeed takes 15-30s per
  // strategy, so doing them in sequence would triple the wait. PageSpeed is
  // allowed to fail without sinking the brief — the written analysis is the
  // part the agent actually needs.
  // PageSpeed is the slow part (15-30s per strategy). Cap it so the brief comes
  // back quickly: if a strategy hasn't returned within the budget we resolve
  // without it and the UI shows the speed section as still loading / n-a. The
  // written analysis is what the agent needs first.
  const PS_BUDGET_MS = 12000;
  const withTimeout = (p) => Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('pagespeed timed out')), PS_BUDGET_MS)),
  ]);

  const [rawResult, mobileResult, desktopResult] = await Promise.allSettled([
    callClaude(apiKey, {
      system: SYSTEM,
      maxTokens: 2500,
      messages: [{ role: 'user', content: buildPrompt(signals, { website: url, businessName }) }],
    }),
    pageSpeedKey ? withTimeout(getPageSpeed(url, pageSpeedKey, 'mobile')) : Promise.reject(new Error('no key')),
    pageSpeedKey ? withTimeout(getPageSpeed(url, pageSpeedKey, 'desktop')) : Promise.reject(new Error('no key')),
  ]);

  if (rawResult.status !== 'fulfilled') throw rawResult.reason;
  const ai = parseJson(rawResult.value);

  const speedOf = (r) => (r.status === 'fulfilled' && r.value ? {
    performance: r.value.performance, seo: r.value.seo,
    accessibility: r.value.accessibility, bestPractices: r.value.bestPractices,
    lcp: r.value.lab && r.value.lab.lcp, cls: r.value.lab && r.value.lab.cls,
  } : null);

  const clamp10 = (n) => Math.max(0, Math.min(10, Math.round(Number(n) || 0)));

  return {
    generatedAt: new Date().toISOString(),
    website: url,
    // Code-verified checks, kept separate from the model's interpretation so
    // the UI can show them as facts rather than opinions.
    checks: {
      nap: {
        complete: signals.napComplete,
        name: signals.hasNap.name, address: signals.address || '',
        phone: signals.phones[0] || '', email: signals.emails[0] || '',
      },
      social: { count: signals.socialCount, links: signals.social },
      hasBlog: signals.hasBlog,
      hasSsl: signals.hasSsl,
      hasContactPage: signals.hasContactPage,
    },
    summary: String(ai.summary || ''),
    // AI-search readiness, 0-10, with the reasoning kept so the agent can
    // defend the number on a call rather than just quoting it.
    aiSeoScore: clamp10(ai.aiSeoScore),
    aiSeoReason: String(ai.aiSeoReason || ''),
    aiSeoBreakdown: Array.isArray(ai.aiSeoBreakdown)
      ? ai.aiSeoBreakdown.slice(0, 6).map((f) => ({
        factor: String(f.factor || ''), score: clamp10(f.score), note: String(f.note || ''),
      }))
      : [],
    // Google PageSpeed, both strategies. Null when the key is missing or the
    // call failed — the panel simply omits the section in that case.
    speed: { mobile: speedOf(mobileResult), desktop: speedOf(desktopResult) },
    industry: String(ai.industry || ''),
    offerings: Array.isArray(ai.offerings) ? ai.offerings.slice(0, 8) : [],
    targetAudience: String(ai.targetAudience || ''),
    targetArea: String(ai.targetArea || ''),
    marketPosition: String(ai.marketPosition || ''),
    keywords: Array.isArray(ai.keywords) ? ai.keywords.slice(0, 15) : [],
    painPoints: Array.isArray(ai.painPoints) ? ai.painPoints.slice(0, 8) : [],
    servicesToPitch: Array.isArray(ai.servicesToPitch) ? ai.servicesToPitch.slice(0, 6) : [],
    conversationStarters: Array.isArray(ai.conversationStarters) ? ai.conversationStarters.slice(0, 4) : [],
    shareWithCustomer: Array.isArray(ai.shareWithCustomer) ? ai.shareWithCustomer.slice(0, 6) : [],
  };
}

/** True once a cached brief is old enough to be worth refreshing. */
function isStale(brief) {
  if (!brief || !brief.generatedAt) return true;
  const age = Date.now() - new Date(brief.generatedAt).getTime();
  return age > CACHE_DAYS * 24 * 60 * 60 * 1000;
}

module.exports = { generateBrief, isStale, CACHE_DAYS };

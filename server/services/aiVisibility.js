/**
 * AI Visibility (GEO / AEO) module — the differentiator in the report.
 *
 * Two independent signals, deliberately kept separate:
 *
 *   1. SERP-side (SE Ranking):  does Google's AI Overview cite this domain?
 *      -> hard, verifiable data. Lives in seranking.js.
 *
 *   2. Assistant-side (Claude): when a buyer asks an AI assistant for a
 *      recommendation in this category, does the brand get named?
 *      -> that's this file.
 *
 * Honesty constraint: we probe Claude, and we say so in the report. We do NOT
 * claim to speak for ChatGPT/Gemini/Perplexity from a single Claude call — that
 * would be fabricated data. Where a multi-engine claim is needed, SE Ranking's
 * AI Search endpoints provide real cross-engine data; this module is scoped to
 * what it can actually verify.
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

async function callClaude(apiKey, { system, messages, maxTokens = 1500, tools }) {
  const body = { model: MODEL, max_tokens: maxTokens, messages };
  if (system) body.system = system;
  if (tools) body.tools = tools;

  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

function parseJson(text) {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.search(/[[{]/);
  if (start === -1) throw new Error('No JSON found in model response');
  const candidate = cleaned.slice(start);
  return JSON.parse(candidate);
}

/**
 * Step 1: derive the buying questions a real customer would ask an assistant.
 * Grounded in the site's own content so the prompts are category-accurate.
 */
async function generateBuyerPrompts(apiKey, { businessName, website, industry, location, services }) {
  const text = await callClaude(apiKey, {
    system:
      'You are a market researcher. Output ONLY valid JSON, no preamble, no markdown fences.',
    messages: [
      {
        role: 'user',
        content: `Business: ${businessName}
Website: ${website}
Industry / what they do: ${industry || 'unknown'}
Location served: ${location || 'not specified'}
Services they want to market: ${(services || []).join(', ')}

Write 8 questions a genuine prospective CUSTOMER would type into an AI assistant when they are close to buying in this category — the kind of question where being recommended wins the deal.

Rules:
- Do NOT mention "${businessName}" in any question. We are testing unprompted recall.
- Make them category + location specific, the way a real buyer phrases things.
- Mix: "best X in Y", "who should I hire for X", "top X companies", comparison questions.

Return JSON exactly:
{"prompts":["...","..."]}`,
      },
    ],
    maxTokens: 800,
  });
  return parseJson(text).prompts;
}

/**
 * Step 2: ask each buyer question with NO brand hint, then check whether the
 * brand surfaced on its own. This is the share-of-voice measurement.
 */
async function probePrompt(apiKey, prompt, businessName, domain) {
  const answer = await callClaude(apiKey, {
    system:
      'Answer as you normally would for a member of the public asking for a recommendation. Name specific real companies where you can. Be concise.',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 900,
  });

  const haystack = answer.toLowerCase();
  const brandTokens = businessName.toLowerCase().split(/\s+/).filter((t) => t.length > 3);
  const bareDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

  const mentioned =
    haystack.includes(businessName.toLowerCase()) ||
    haystack.includes(bareDomain.toLowerCase()) ||
    (brandTokens.length > 0 && brandTokens.every((t) => haystack.includes(t)));

  // Who DID get named? That's the competitive set the client is losing to.
  let competitorsNamed = [];
  try {
    const extracted = await callClaude(apiKey, {
      system: 'Output ONLY valid JSON, no preamble, no markdown fences.',
      messages: [
        {
          role: 'user',
          content: `From the text below, list every company/brand name that is recommended or named as an option. Exclude generic terms and directories.

TEXT:
${answer.slice(0, 4000)}

Return JSON exactly: {"companies":["...","..."]}`,
        },
      ],
      maxTokens: 400,
    });
    competitorsNamed = parseJson(extracted).companies || [];
  } catch {
    competitorsNamed = [];
  }

  return {
    prompt,
    mentioned,
    competitorsNamed,
    answerExcerpt: answer.slice(0, 600),
  };
}

/**
 * Step 3: technical AI-readability checks. These are the things that actually
 * move the needle on being cited, and each maps to a billable fix.
 */
function analyseAiReadiness(crawl) {
  const checks = [];
  const schemaTypes = crawl.schemaTypes || [];

  checks.push({
    id: 'llms_txt',
    label: 'llms.txt file',
    pass: !!crawl.hasLlmsTxt,
    detail: crawl.hasLlmsTxt
      ? 'Present — AI crawlers have a guide to your content.'
      : 'Missing. AI crawlers have no map of what matters on your site.',
  });
  checks.push({
    id: 'org_schema',
    label: 'Organization / LocalBusiness schema',
    pass: schemaTypes.some((t) => /organization|localbusiness/i.test(t)),
    detail: schemaTypes.length
      ? `Found: ${schemaTypes.slice(0, 6).join(', ')}`
      : 'No structured data found. AI systems cannot reliably identify who you are.',
  });
  checks.push({
    id: 'faq_schema',
    label: 'FAQ / Q&A structured content',
    pass: schemaTypes.some((t) => /faq|qapage/i.test(t)),
    detail: 'Answer-formatted content is what gets quoted in AI answers.',
  });
  checks.push({
    id: 'author_eeat',
    label: 'E-E-A-T signals (author, credentials)',
    pass: !!crawl.hasAuthorSignals,
    detail: crawl.hasAuthorSignals
      ? 'Author/credential markup present.'
      : 'No author or credential signals. AI weights expertise heavily.',
  });
  checks.push({
    id: 'crawlable',
    label: 'Content readable without JavaScript',
    pass: !!crawl.serverRenderedContent,
    detail: crawl.serverRenderedContent
      ? 'Content is in the HTML — AI crawlers can read it.'
      : 'Content requires JavaScript. Most AI crawlers will see an empty page.',
  });
  checks.push({
    id: 'robots_ai',
    label: 'AI crawlers allowed in robots.txt',
    pass: !crawl.blocksAiCrawlers,
    detail: crawl.blocksAiCrawlers
      ? 'robots.txt blocks GPTBot / ClaudeBot / PerplexityBot — you are invisible by choice.'
      : 'AI crawlers are permitted.',
  });

  return checks;
}

/**
 * Orchestrator. Returns everything the AI Visibility section of the report needs.
 */
async function runAiVisibility(apiKey, ctx) {
  const { businessName, website, industry, location, services, crawl, aiOverview } = ctx;

  const prompts = await generateBuyerPrompts(apiKey, {
    businessName,
    website,
    industry,
    location,
    services,
  });

  // Sequential to respect API rate limits and keep credit burn predictable.
  const results = [];
  for (const p of prompts) {
    try {
      results.push(await probePrompt(apiKey, p, businessName, website));
    } catch (e) {
      results.push({ prompt: p, mentioned: false, competitorsNamed: [], error: e.message });
    }
  }

  const valid = results.filter((r) => !r.error);
  const mentions = valid.filter((r) => r.mentioned).length;
  const shareOfVoice = valid.length ? Math.round((mentions / valid.length) * 100) : 0;

  // Rank the brands the assistant recommends instead.
  const tally = {};
  for (const r of valid) {
    for (const c of r.competitorsNamed) {
      const key = c.trim();
      if (!key || key.toLowerCase() === businessName.toLowerCase()) continue;
      tally[key] = (tally[key] || 0) + 1;
    }
  }
  const rivals = Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, count]) => ({ name, count, outOf: valid.length }));

  const readiness = analyseAiReadiness(crawl || {});
  const readinessScore = Math.round(
    (readiness.filter((c) => c.pass).length / readiness.length) * 100
  );

  return {
    promptsTested: valid.length,
    mentions,
    shareOfVoice,
    rivals,
    results,
    readiness,
    readinessScore,
    // Real Google AI Overview data from SE Ranking, kept distinct from the probe.
    aiOverview: aiOverview || null,
    methodology:
      'Assistant recall measured by asking Claude (Sonnet 4.6) buyer-intent questions with no brand hint. AI Overview data sourced from live Google SERP tracking.',
  };
}

/** Cover tagline — generated from findings, never from a static list. */
async function generateTagline(apiKey, ctx) {
  const text = await callClaude(apiKey, {
    system: 'You are a senior copywriter. Output ONLY valid JSON, no preamble, no fences.',
    messages: [
      {
        role: 'user',
        content: `Write the cover of a free SEO audit for a prospect.

Business: ${ctx.businessName}
Industry: ${ctx.industry || 'unknown'}
Website: ${ctx.website}
Their customers: ${ctx.audience || 'unknown'}

THE ACTUAL FINDINGS:
- Domain Authority: ${ctx.domainAuthority} (competitors average ${ctx.competitorAuthority})
- Keywords on page 1: ${ctx.page1Keywords}
- Estimated monthly organic visits: ${ctx.traffic}
- Named by AI assistants in ${ctx.aiShareOfVoice}% of buyer questions
- Biggest technical problem: ${ctx.topIssue}
- Losing to: ${(ctx.competitors || []).slice(0, 3).join(', ')}

Write:
1. "headline" — max 7 words. Two parts: a bold first phrase, then a lighter second phrase. Name the SPECIFIC pain from the findings above, in the language of THEIR industry. Not generic SEO speak. Think "Be the tutor students actually find." — concrete, human, about their customer.
2. "subhead" — one sentence, max 30 words, addressed to the owner. What this report is and what it will do for them.
3. "headlineBold" — the first part of the headline that should be bold.
4. "headlineLight" — the rest of the headline.

Return JSON exactly:
{"headline":"...","headlineBold":"...","headlineLight":"...","subhead":"..."}`,
      },
    ],
    maxTokens: 500,
  });
  return parseJson(text);
}

/** Executive summary written from real numbers, with money attached. */
async function generateExecutiveSummary(apiKey, ctx) {
  const text = await callClaude(apiKey, {
    system: 'You are a senior SEO strategist. Output ONLY valid JSON, no preamble, no fences.',
    messages: [
      {
        role: 'user',
        content: `Write the executive summary of an SEO audit. Be direct and specific. Never invent numbers — use only what is given.

DATA:
${JSON.stringify(ctx, null, 2)}

Write:
1. "headA" — a short bold statement praising what is genuinely good, max 6 words, ending in a full stop. E.g. "The tutoring is excellent."
2. "headB" — the contrasting problem clause, max 10 words. E.g. "The problem is nobody can find it in search."
3. "verdict" — 2-3 sentences expanding on headA/headB, citing real numbers from the data. Respectful, never insulting.
4. "diagnosis" — 2 sentences naming the specific causes, phrased as fixable. Start with "Two things cause that, and both are fixable:" where it fits.
5. "findings" — exactly 3 objects: {"title":"...","detail":"...","impact":"..."}. Each must cite a real number. "impact" states the cost in traffic/money. Use loss framing.
6. "opportunity" — one italic-quote sentence naming the single biggest upside. Written to be read aloud.

Return JSON exactly:
{"headA":"...","headB":"...","verdict":"...","diagnosis":"...","findings":[{"title":"","detail":"","impact":""}],"opportunity":"..."}`,
      },
    ],
    maxTokens: 1200,
  });
  return parseJson(text);
}

/**
 * Social media (SMO) assessment. Given which social profiles were found linked
 * on the site (and which weren't), Claude gives a short, specific verdict and
 * recommendations. No external social API needed — we detect links from the
 * crawl and let Claude reason about the presence/gaps.
 */
async function assessSocial(apiKey, { businessName, industry, found, missing }) {
  const text = await callClaude(apiKey, {
    system: 'You are a social media marketing strategist. Output ONLY valid JSON, no preamble, no fences. Be specific and practical. Judge only what is given.',
    messages: [
      {
        role: 'user',
        content: `Business: ${businessName}${industry ? ' — ' + industry : ''}
Social profiles linked from their website: ${found.length ? found.join(', ') : 'NONE'}
Networks with no link found: ${missing.length ? missing.join(', ') : 'none'}

Return JSON exactly:
{"verdict":"2 sentences on their current social presence based on what's linked — note if none are linked, that's a visible trust gap","priorities":["the 2-3 networks this specific business should prioritise and why, each a short phrase"],"recommendation":"one actionable sentence on the single most important social move for them"}`,
      },
    ],
    maxTokens: 500,
  });
  return parseJson(text);
}

/**
 * Review the homepage <title> and meta description and give a short, specific
 * remark. Fed only the real crawled values — no invention. Returns
 * { titleRemark, metaRemark, overall } or null on failure.
 */
async function assessOnPage(apiKey, { businessName, title, titleLength, metaDescription, metaDescriptionLength }) {
  const text = await callClaude(apiKey, {
    system: 'You are a senior SEO strategist reviewing on-page tags. Output ONLY valid JSON, no preamble, no fences. Be specific and practical. Never invent facts — judge only what is given. Ideal title 50-60 chars; ideal meta description 140-160 chars.',
    messages: [
      {
        role: 'user',
        content: `Business: ${businessName}
Current page title (${titleLength} chars): ${title || '(empty)'}
Current meta description (${metaDescriptionLength} chars): ${metaDescription || '(empty)'}

Return JSON exactly:
{"titleRemark":"one sentence assessing the title — note length issues and whether it targets what buyers search","metaRemark":"one sentence assessing the meta description — if empty, say Google will auto-generate a poor snippet","overall":"one short actionable recommendation sentence"}`,
      },
    ],
    maxTokens: 400,
  });
  return parseJson(text);
}

/**
 * Summarise Google review sentiment into 2-3 plain sentences the report can
 * quote. Fed only the review text we already fetched from Places — no invention.
 * Returns a short string, or null on failure (the section degrades gracefully).
 */
async function summariseReviews(apiKey, { businessName, rating, reviewCount, reviews }) {
  const sample = (reviews || [])
    .filter((r) => r.text)
    .slice(0, 5)
    .map((r, i) => `${i + 1}. (${r.rating || '?'}★) ${String(r.text).slice(0, 400)}`)
    .join('\n');

  if (!sample) return null;

  const text = await callClaude(apiKey, {
    maxTokens: 300,
    system:
      'You summarise Google review sentiment for a local-SEO audit. Be factual and neutral. ' +
      'Base every statement only on the reviews provided. 2-3 sentences. No marketing hype. ' +
      'Note recurring praise and any recurring complaints. Return plain text only.',
    messages: [
      {
        role: 'user',
        content:
          `Business: ${businessName}\nOverall rating: ${rating ?? 'n/a'} from ${reviewCount ?? 0} reviews.\n` +
          `Recent reviews:\n${sample}\n\nWrite a short, balanced summary of what customers say.`,
      },
    ],
  });

  return (text || '').trim() || null;
}

/**
 * Infer the services the BUSINESS actually offers, from real signals scraped
 * off their site (nav labels, service links, headings) plus the page title and
 * meta description. This is deliberately separate from the services our agent
 * ticked when running the report — the cover should describe the prospect's
 * business, not our pitch.
 */
async function detectBusinessServices(apiKey, ctx) {
  const signals = (ctx.serviceSignals || []).slice(0, 60);
  // Nothing useful scraped — let the caller fall back.
  if (!signals.length && !ctx.title && !ctx.metaDescription) return null;

  const text = await callClaude(apiKey, {
    system: 'You identify what a business sells. Output ONLY valid JSON, no preamble, no fences.',
    messages: [
      {
        role: 'user',
        content: `Identify the services/products THIS BUSINESS OFFERS to its own customers.

Business: ${ctx.businessName || 'unknown'}
Website: ${ctx.website || 'unknown'}
Page title: ${ctx.title || ''}
Meta description: ${ctx.metaDescription || ''}
Main heading(s): ${(ctx.h1s || []).slice(0, 5).join(' | ')}
Section headings: ${(ctx.h2s || []).slice(0, 20).join(' | ')}
Navigation & link labels scraped from the site:
${signals.map((s) => `- ${s}`).join('\n')}

Rules:
- List only what the business SELLS or PROVIDES to its customers.
- Ignore navigation chrome: Home, About, About Us, Contact, Blog, Careers, Login, Cart, Privacy, Terms, FAQ, Portfolio, Gallery, Testimonials, Reviews.
- Ignore marketing-agency services (SEO, PPC, social media marketing) UNLESS this business is itself a marketing agency selling them.
- Use the business's own wording, tidied to Title Case. Max 4 words each.
- Return 3 to 8 items, most prominent first. If you genuinely cannot tell, return an empty list.

Return JSON exactly:
{"services":["...","..."],"industry":"short industry label"}`,
      },
    ],
    maxTokens: 400,
  });
  const parsed = parseJson(text);
  if (!parsed || !Array.isArray(parsed.services)) return null;
  const clean = parsed.services
    .map((s) => String(s || '').replace(/\s+/g, ' ').trim())
    .filter((s) => s && s.length <= 40)
    .slice(0, 8);
  return clean.length ? { services: clean, industry: parsed.industry || '' } : null;
}

module.exports = {
  runAiVisibility,
  generateTagline,
  generateExecutiveSummary,
  summariseReviews,
  assessOnPage,
  assessSocial,
  callClaude,
  analyseAiReadiness,
  detectBusinessServices,
};

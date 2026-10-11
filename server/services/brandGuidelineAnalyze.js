/**
 * Brand Guideline analysis: turns a crawled website + a few user inputs into a
 * full, print-ready brand guideline (the "Pack Wheel" format) — foundation,
 * visual identity, voice & messaging and a social-media playbook.
 *
 * Everything is GROUNDED in the real site: the copy, product names, colours,
 * fonts and images all come from the crawl, so the guideline reads like it was
 * written for that brand rather than generated from a template. The AI fills in
 * the narrative (story, pillars, audiences, voice, social plan); the palette,
 * fonts and images are taken straight from the harvested assets.
 */
const { callAI } = require('./aiVisibility');

function parseJson(text) {
  const cleaned = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.search(/[[{]/);
  if (start === -1) return {};
  try { return JSON.parse(cleaned.slice(start)); } catch {
    // tolerate a trailing comma / truncation by trimming to the last closing brace
    const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return {}; }
  }
}

// Map a harvested colour role to a human label + a usage note, Pack-Wheel style.
function nameColor(role, i) {
  const brandNames = ['Brand Primary', 'Brand Accent'];
  const map = {
    brand: { label: brandNames[i] || 'Brand Colour', use: 'Logo, accents, buttons' },
    accent: { label: 'Accent', use: 'Highlights, labels, links' },
    dark: { label: 'Charcoal', use: 'Text, dark backgrounds' },
    light: { label: 'Light', use: 'Backgrounds, product shots' },
    neutral: { label: 'Neutral', use: 'Dividers, secondary text' },
  };
  return map[role] || { label: 'Colour', use: 'Secondary' };
}

// Build the palette cards from harvested colours (user overrides merge on top).
function buildPalette(assets, overrides) {
  let cols = Array.isArray(overrides) && overrides.length ? overrides
    : (assets.colors || []).slice(0, 8);
  // ensure we always have a dark + a light anchor for a usable palette
  const roles = cols.map((c) => c.role);
  if (!roles.includes('dark')) cols.push({ hex: '#242424', rgb: '36 36 36', role: 'dark' });
  if (!roles.includes('light')) cols.push({ hex: '#F5F1E8', rgb: '245 241 232', role: 'light' });
  let brandIdx = 0;
  return cols.slice(0, 8).map((c) => {
    const meta = nameColor(c.role, c.role === 'brand' ? brandIdx++ : 0);
    return { hex: c.hex, rgb: c.rgb, label: c.label || meta.label, use: c.use || meta.use, role: c.role };
  });
}

// Pick representative images by kind for the photography/lifestyle/product pages.
function pickImages(assets) {
  const imgs = assets.images || [];
  const byKind = (k) => imgs.filter((i) => i.kind === k);
  const hero = (byKind('og')[0] || byKind('hero')[0] || imgs[0] || {}).url || '';
  const used = new Set([hero]);
  const take = (arr, n) => { const out = []; for (const i of arr) { if (out.length >= n) break; if (i && i.url && !used.has(i.url)) { used.add(i.url); out.push(i); } } return out; };
  const lifestyle = take([...byKind('hero'), ...byKind('lifestyle')], 6);
  const product = take(byKind('product'), 4);
  // if a bucket is thin, backfill from whatever's left (no duplicates)
  const pool = imgs.filter((i) => !used.has(i.url));
  while (lifestyle.length < 4 && pool.length) { const i = pool.shift(); used.add(i.url); lifestyle.push(i); }
  while (product.length < 3 && pool.length) { const i = pool.shift(); used.add(i.url); product.push(i); }
  return { hero, lifestyle, product, all: imgs };
}

/**
 * Generate the whole guideline.
 * @param {object} crawl   crawler output (brand, nap, bodyTextSample, title, …)
 * @param {object} assets  harvestBrandAssets output (images, colors, fonts)
 * @param {object} meta    { businessName, website, industry, audiences[],
 *                           postsPerMonth, platforms[], cadence, peakSeason,
 *                           tone, logo, preparedBy, preparedByRole, contactEmail,
 *                           contactPhone, monthYear, colorOverrides, fontOverride }
 * @param {object} keys    { anthropicKey, openaiKey }
 */
async function buildGuidelineData(crawl, assets, meta, keys) {
  const business = meta.businessName || crawl.domain || 'the brand';
  const siteText = (crawl.bodyTextSample || '').slice(0, 2500);
  const palette = buildPalette(assets, meta.colorOverrides);
  const images = pickImages(assets);
  const fonts = (meta.fontOverride && [meta.fontOverride]) || (assets.fonts && assets.fonts.length ? assets.fonts : ['Raleway']);
  const primaryFont = fonts[0] || 'Raleway';

  const base = {
    report: { business, website: meta.website || crawl.domain, monthYear: meta.monthYear, type: 'Brand Guidelines' },
    preparedBy: meta.preparedBy || 'Adam G, Project Manager',
    preparedByRole: meta.preparedByRole || 'Project Manager',
    contactEmail: meta.contactEmail || 'adam@qtonix.com',
    contactPhone: meta.contactPhone || '+91-8249016547',
    logo: meta.logo || '',
    cover: { heroImage: images.hero },
    palette,
    fonts,
    primaryFont,
    images,
    platforms: meta.platforms || ['Instagram', 'Facebook', 'YouTube'],
    postsPerMonth: meta.postsPerMonth || 10,
  };

  // Shared context block for every prompt so the AI stays grounded.
  const ctx = `BRAND: ${business}
WEBSITE: ${meta.website || crawl.domain}
INDUSTRY / WHAT THEY SELL: ${meta.industry || 'infer from the site text'}
TARGET AUDIENCES (if given): ${(meta.audiences || []).join('; ') || 'infer from the site'}
TONE PREFERENCE: ${meta.tone || 'infer a fitting tone from the site'}
PRODUCT / BRAND NAME AS WRITTEN: ${(crawl.brand && crawl.brand.primary) || business}
HOMEPAGE TITLE: ${crawl.title || ''}
META DESCRIPTION: ${crawl.metaDescription || ''}
HOMEPAGE TEXT (excerpt): ${siteText}`;

  const sys = 'You are a senior brand strategist writing a professional brand guideline for a client. Write in clear, concrete, plain English grounded ONLY in the brand context given — never invent facts, prices or stats that are not supported by the site text. Match the brand\'s own wording for product names. Output ONLY valid JSON, no markdown fences, no commentary.';

  // --- Call 1: Brand foundation -------------------------------------------
  const foundationPrompt = `${ctx}

Write the BRAND FOUNDATION. Return JSON exactly:
{
  "tagline": "a short signature line (3-6 words) that could sit on the cover",
  "coverSubtitle": "one sentence describing what this guide is, in the brand's voice",
  "story": "EXACTLY 2 short sentences (max 40 words total) on the brand's origin / what it does, grounded in the site. Keep it tight — it sits beside a photo.",
  "timeline": [ {"year":"YYYY or stage","event":"short milestone"} ... up to 6; omit if the site gives no history — return [] ],
  "positioning": "one clear positioning sentence (what they do, for whom)",
  "signatureLine": "the one line to repeat everywhere",
  "standForHeadline": "a bold 1-sentence statement of what the brand stands for",
  "pillars": [ {"title":"2-4 word pillar","text":"1 sentence"} x4 — the four things the brand always says ],
  "proofPoints": [ {"stat":"a SHORT metric or value, 1-3 words max, e.g. '<20 lb', 'Lifetime', '200 lb', '10-30 mi' — NOT a product name or a phrase","label":"what it means, one short line"} x3-6 — ONLY hard facts/numbers supported by the site. If the site has no real numbers, return [] rather than inventing or using product names as stats ],
  "products": [ {"name":"product/service name","tag":"short qualifier","points":["bullet", ...]} x1-3 — the product or service family ],
  "audiences": [ {"name":"audience","desc":"1 sentence","line":"a short rallying line in quotes"} x3-4 — who they build/sell for ]
}`;

  // --- Call 2: Voice & messaging ------------------------------------------
  const voicePrompt = `${ctx}

Write VOICE & MESSAGING. Return JSON exactly:
{
  "voiceIntro": "1 sentence describing how the brand sounds",
  "voiceTable": [ {"trait":"word","are":"what we are — 1 sentence","areNot":"what we are not — 1 sentence"} x4-5 ],
  "beforeAfter": [ {"context":"Website | Social caption","before":"an off-brand example","after":"the on-brand rewrite"} x2 ],
  "wordsWeUse": ["word", ... 6-10],
  "wordsWeAvoid": ["word", ... 6-10],
  "namesClaims": { "write": [ {"write":"correct form","never":"wrong form"} x4-6 ], "approvedClaims": ["claim", ...], "checkFirst": ["thing to verify before using", ...] },
  "photoShow": ["what to show in photos", ... 4],
  "photoAvoid": ["what to avoid", ... 4],
  "photoProduct": { "background":"rule", "framing":"rule", "quality":"rule" }
}`;

  // --- Call 3: Social media playbook --------------------------------------
  const socialPrompt = `${ctx}

TARGET VOLUME: about ${base.postsPerMonth} posts per month.
PLATFORMS: ${base.platforms.join(', ')}.
POSTING CADENCE (if given): ${meta.cadence || 'propose a sensible weekly rhythm'}.
PEAK SEASON (if given): ${meta.peakSeason || 'infer any seasonality from the industry, or treat as year-round'}.

Write the SOCIAL MEDIA playbook. Return JSON exactly:
{
  "creativeSpecs": [ {"ratio":"4:5","name":"Feed post","size":"1080 x 1350","note":"short note"}, {"ratio":"1:1",...}, {"ratio":"9:16",...}, {"ratio":"16:9",...} ],
  "creativeRules": ["short rule", ... 4-6],
  "contentPillars": [ {"pct":"30%","title":"pillar","desc":"what goes here","example":"e.g. a sample post idea"} x4-5 — percentages must sum to 100 ],
  "rhythm": "1-2 sentences describing the posting rhythm for ~${base.postsPerMonth} posts/month across the chosen platforms, with any pre-season ramp",
  "calendar": [ {"period":"month range or season","label":"phase name","focus":"what to post then"} x3-5 — the content year ],
  "calendarRule": "1 sentence rule of thumb for the year",
  "checklist": ["pre-publish check item", ... 8 — the 8-point check before anything goes live]
}`;

  const run = async (prompt, max) => {
    try { const out = await callAI({ ...keys, system: sys, messages: [{ role: 'user', content: prompt }], maxTokens: max }); return parseJson(out); }
    catch (e) { console.error('[brandGuideline] AI call failed:', e.message); return {}; }
  };

  const [foundation, voice, social] = await Promise.all([
    run(foundationPrompt, 2200),
    run(voicePrompt, 2200),
    run(socialPrompt, 2200),
  ]);

  return { ...base, foundation, voice, social };
}

module.exports = { buildGuidelineData, buildPalette, pickImages };

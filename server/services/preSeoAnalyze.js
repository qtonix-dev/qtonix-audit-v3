/**
 * Pre-SEO report analysis: turn the raw crawl + screenshots into the full report
 * JSON the preSeoReport.hbs template consumes.
 *
 * Two halves:
 *   - DETERMINISTIC: stat tiles, PASS/FAIL checklists, on-page table, KPI baseline
 *     etc. are computed straight from crawl data so they are always factually
 *     correct (never hallucinated).
 *   - CLAUDE: the narrative — observations, top-5 issues, the 10 health-bar
 *     scores, "working vs fixing", keyword opportunity map, and the week-by-week
 *     action plan — is written by Claude from the same data (+ screenshots).
 */
const { callAI, callClaude, callOpenai } = require('./aiVisibility');

const RED = '#dc2626', AMBER = '#f59e0b', GREEN = '#16a34a';

function pf(ok) { return ok ? 'PASS' : 'FAIL'; }
function barColor(s) { return s <= 3 ? RED : s <= 6 ? AMBER : GREEN; }

// ---- deterministic facts from the crawl -----------------------------------
function facts(crawl) {
  const c = crawl || {};
  const html = c.html || '';
  const robotsMeta = (html.match(/<meta[^>]+name=["']robots["'][^>]*>/i) || [])[0] || '';
  const noindex = /noindex/i.test(robotsMeta);
  const hasSitemap = !!(c.sitemap && c.sitemap.exists);
  const hasRobots = !!(c.robots && c.robots.exists);
  const hasMetaDesc = !!(c.metaDescription && c.metaDescription.length > 0);
  const hasSchema = !!c.hasSchema;
  const hasOg = (c.ogTags || 0) > 0;
  const https = !!c.https;
  const canonical = !!c.canonical;
  const mobile = !!c.hasViewport;
  const ps = c.pageSpeed || {};
  const psM = ps.mobile || {}, psD = ps.desktop || {};
  const sizeMb = c.htmlBytes ? (c.htmlBytes / 1048576) : null;
  return {
    noindex, robotsMeta, hasSitemap, hasRobots, hasMetaDesc, hasSchema, hasOg, https, canonical, mobile,
    title: c.title || '', titleLength: c.titleLength || 0,
    imageCount: c.imageCount || 0, imagesNoAlt: c.imagesNoAlt || 0,
    h1Count: c.h1Count || 0, wordCount: c.wordCount || 0,
    domain: c.domain || '', website: c.website || c.finalUrl || '',
    schemaTypes: c.schemaTypes || [], blocksAiCrawlers: !!c.blocksAiCrawlers,
    social: c.social || {}, socialNetworks: c.socialNetworks || [],
    perfMobile: psM.performance, perfDesktop: psD.performance,
    lcp: (psM.field && psM.field.lcp) || (psM.lab && psM.lab.lcp) || null,
    cls: (psM.field && psM.field.cls) != null ? (psM.field && psM.field.cls) : ((psM.lab && psM.lab.cls) != null ? psM.lab.cls : null),
    inp: (psM.field && psM.field.inp) || null,
    tbt: (psM.lab && psM.lab.tbt) || null,
    fcp: (psM.lab && psM.lab.fcp) || null,
    speedIndex: (psM.lab && psM.lab.speedIndex) || null,
    cruxOverall: (psM.field && psM.field.overall) || null,
    sizeMb: sizeMb != null ? Number(sizeMb.toFixed(2)) : null,
    // new crawl-derived fields
    tracking: c.tracking || {},
    nap: c.nap || { present: false },
    brand: c.brand || { candidates: [], variants: [], primary: '' },
    ogImage: c.ogImage || '',
    htmlTextRatio: c.htmlTextRatio != null ? c.htmlTextRatio : null,
    totalPages: (c.sitemap && c.sitemap.urlCount) || null,
    internalLinks: c.internalLinks != null ? c.internalLinks : null,
    bodyTextSample: c.bodyTextSample || '',
    sitemapIsIndex: !!(c.sitemap && c.sitemap.isIndex),
    childSitemaps: (c.sitemap && c.sitemap.childSitemaps) || 0,
    sitemapUserNone: !!(c.sitemap && c.sitemap.userConfirmedNone),
  };
}

// ---- build the deterministic report skeleton ------------------------------
function skeleton(f, meta) {
  const mSize = f.sizeMb != null ? `${f.sizeMb} MB` : '—';
  return {
    report: {
      businessName: meta.businessName, shortName: meta.shortName || (meta.businessName || '').split(' ')[0],
      domain: f.domain, website: f.website, monthYear: meta.monthYear, auditDate: meta.auditDate,
      pagesReviewed: meta.totalPages || meta.pagesReviewed || 1,
      pagesLabel: meta.totalPages ? 'pages found in the sitemap' : 'homepage reviewed in depth',
      preparedBy: meta.preparedBy, preparedByRole: meta.preparedByRole || 'Project Manager', contactEmail: meta.contactEmail,
      contactPhone: meta.contactPhone, clientLogo: meta.clientLogo || '',
      logoInitials: String(meta.businessName || f.domain || '?').replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?',
      services: Array.isArray(meta.services) ? meta.services : [],
      healthScore: { value: 0, deg: 0 }, // filled after Claude scores the bars
    },
    toc: TOC,
    ch1: {
      stats: [
        { v: String(f.healthStatValue != null ? f.healthStatValue : '—'), l: 'overall health score (out of 100)' },
        { v: f.totalPages ? String(f.totalPages) : (f.sitemapUserNone ? 'none' : '—'), l: f.totalPages ? 'pages found in the XML sitemap' : (f.sitemapUserNone ? 'no XML sitemap on the site' : 'pages in sitemap (not detected)') },
        { v: f.perfMobile != null ? String(f.perfMobile) : '—', l: 'mobile page-speed score (PageSpeed)' },
        { v: `${f.imagesNoAlt}/${f.imageCount}`, l: 'homepage images missing alt text' },
      ],
      summary: [
        { el: 'Website visible on Google / Bing', status: pf(!f.noindex), remark: f.noindex ? 'noindex tag found on homepage' : 'No noindex block' },
        { el: 'XML Sitemap', status: pf(f.hasSitemap), remark: f.hasSitemap ? 'Found' : 'Not found' },
        { el: 'Robots.txt', status: pf(f.hasRobots), remark: f.hasRobots ? (f.hasSitemap ? 'Present' : 'Present, sitemap line missing') : 'Not found' },
        { el: 'HTTPS / SSL', status: pf(f.https), remark: f.https ? 'Active' : 'Not active' },
        { el: 'Canonical Tags', status: pf(f.canonical), remark: f.canonical ? 'Present' : 'Missing' },
        { el: 'Meta Titles optimized', status: pf(f.titleLength > 15 && !/^[\w\s]{1,20}$/.test(f.title)), remark: f.title ? `"${f.title.slice(0, 50)}"` : 'Missing' },
        { el: 'Meta Descriptions', status: pf(f.hasMetaDesc), remark: f.hasMetaDesc ? 'Present' : 'Missing on homepage' },
        { el: 'Schema Markup', status: pf(f.hasSchema), remark: f.hasSchema ? f.schemaTypes.join(', ') : 'Not found' },
        { el: 'Open Graph / Social Tags', status: pf(f.hasOg), remark: f.hasOg ? 'Present' : 'Not found' },
        { el: 'Mobile Friendly', status: pf(f.mobile), remark: f.mobile ? 'Viewport set' : 'No viewport meta' },
      ],
    },
    // technical + on-page tables (chapters 3 & 5) are injected by the renderer
    // path from these same facts; Claude fills the narrative sections.
    _facts: f,
  };
}

const TOC = [
  { n: '01', t: 'Overall Site Observation', d: 'Health score, top issues and what is already working' },
  { n: '02', t: 'Search Visibility Stats', d: 'Organic traffic, keywords and Google index check' },
  { n: '03', t: 'Technical SEO Stats', d: 'Meta robots, robots.txt, XML sitemap, response codes' },
  { n: '04', t: 'Page Performance & Mobile', d: 'PageSpeed, Core Web Vitals, page size, responsiveness' },
  { n: '05', t: 'On Page SEO Stats', d: 'Titles, descriptions, headings, images, schema, social tags' },
  { n: '06', t: 'Content Quality & Trust', d: 'Dummy text, testimonials, thin pages, E-E-A-T' },
  { n: '07', t: 'Site Architecture', d: 'Menu, URLs, internal linking and page structure' },
  { n: '08', t: 'Off Page Stats', d: 'Backlink profile, authority and link opportunities' },
  { n: '09', t: 'Competitor Overview', d: 'How the market looks in search' },
  { n: '10', t: 'Keyword Opportunity Map', d: 'The searches each page should target' },
  { n: '11', t: 'AI Search Visibility', d: 'ChatGPT, Perplexity, Gemini and Google AI Overviews' },
  { n: '12', t: 'Tracking & Social Profiles', d: 'Analytics, tag manager, pixels and social media presence' },
  { n: '13', t: 'Action Plan & Approval', d: 'What we need from you to get started' },
];

// ---- Claude: write the narrative JSON -------------------------------------
async function analyzeNarrative(keys, { facts: f, meta, screenshots }) {
  const system = `You are a senior SEO auditor at Qtonix writing a client-facing Pre-SEO audit report. Match the EXACT tone of Qtonix's reference report:
- Plain, calm, honest language a non-technical business owner understands. Short sentences. No jargon without a plain explanation. No hype, no sales pressure, no exclamation marks.
- Reassuring and reframing: a low starting score is normal for a new or small site; "most of the gap comes from fixes we can make in the first week"; the client "only needs to approve the plan and share access" — "nothing needs to be changed on your side".
- Always frame fixes as "Our team will…" / "Qtonix will…" done "on your approval". Name the single biggest issue clearly and say it will be the first task.
- Be specific and factual from the data; never invent numbers. When a figure needs a tool the client must provide (SEMrush, Moz, PageSpeed screenshot), say it will be confirmed from that source rather than guessing.
- Example of the target voice: "The website looks modern and all the main sections are in place. But during the audit we found that search engines are blocked from indexing the whole website. Because of this, the site is not showing on Google or Bing right now, not even when someone searches the brand name."
Output ONLY valid JSON, no markdown, matching the requested schema exactly.`;

  const dataBlock = {
    domain: f.domain, business: meta.businessName,
    noindex: f.noindex, robotsMeta: f.robotsMeta, hasSitemap: f.hasSitemap, hasRobots: f.hasRobots,
    https: f.https, canonical: f.canonical, hasMetaDesc: f.hasMetaDesc, title: f.title, titleLength: f.titleLength,
    hasSchema: f.hasSchema, schemaTypes: f.schemaTypes, hasOpenGraph: f.hasOg, mobileViewport: f.mobile,
    images: f.imageCount, imagesWithoutAlt: f.imagesNoAlt, h1Count: f.h1Count, homepageWords: f.wordCount,
    homepageSizeMb: f.sizeMb, perfMobile: f.perfMobile, perfDesktop: f.perfDesktop,
    coreWebVitals: { lcp: f.lcp, inp: f.inp, cls: f.cls },
    socialProfilesFound: f.socialNetworks, blocksAiCrawlers: f.blocksAiCrawlers,
    metaDescription: f.metaDesc, totalPages: f.totalPages, htmlTextRatio: f.htmlTextRatio,
    tracking: f.tracking, brandVariants: (f.brand && f.brand.variants) || [],
    homepageTextSample: (f.bodyTextSample || '').slice(0, 1500),
  };

  const schema = `{
  "healthBars": [ {"n":"Crawling & Indexing","s":0-10}, {"n":"On-Page SEO","s":0-10}, {"n":"Content & Trust","s":0-10}, {"n":"Speed & Core Web Vitals","s":0-10}, {"n":"Mobile & UX Basics","s":0-10}, {"n":"Schema & Social Tags","s":0-10}, {"n":"Backlinks & Authority","s":0-10}, {"n":"Tracking & Measurement","s":0-10}, {"n":"AI Search Visibility","s":0-10}, {"n":"Brand & Social Presence","s":0-10} ],
  "homepageNotes": ["2 short paragraphs about the homepage"],
  "topIssues": [ {"issue":"...","priority":"CRITICAL|HIGH|MEDIUM"} x5 ],
  "working": ["6 short bullet points of what is already good"],
  "fixing": ["6 short bullet points of what needs fixing"],
  "keyTakeaway": "1 short paragraph, the single most important issue",
  "about": "1 short paragraph: this report shows where the site stands; Qtonix will do the fixes after approval",
  "searchVisibilityObs": ["2-4 short bullet points for the SEMrush/traffic section — each a plain fact, no screenshot talk"],
  "indexCheckObs": ["2-4 short bullet points for the Google index (site:) check — state which page types are indexed; NEVER mention a screenshot or that a result count is not visible; if the exact indexed count is unknown say it will be confirmed from Google Search Console"],
  "contentMatch": "1 short sentence: does the homepage body content actually match its title and meta description (topic alignment)?",
  "contentQuality": "1 short sentence: spelling/grammar quality, and whether the copy reads like thin or auto-generated content or like genuine human-written content",
  "keywordTargets": [ {"page":"Home","keyword":"...","supporting":"...","difficulty":"GOOD|MODERATE|HARD|VERY HARD"} x6-8 ],
  "competitorOpenings": [ {"strength":"competitor strength","opening":"where this site can win"} x3-4 ],
  "weeks": [ {"label":"Week 1","sub":"Foundations","items":["..."]}, {"label":"Week 2","sub":"Research","items":["..."]}, {"label":"Week 3","sub":"Content","items":["..."]}, {"label":"Week 4","sub":"Grow & report","items":["..."]} ]
}`;

  const content = [{ type: 'text', text: `Audit data for ${f.domain}:\n${JSON.stringify(dataBlock, null, 2)}\n\nWrite the report narrative as JSON in exactly this schema:\n${schema}\n\nScore each health bar 0-10 strictly from the data (e.g. noindex → Crawling 1; no schema/OG → Schema 0-1; no analytics evidence → Tracking 1). Return ONLY the JSON.` }];
  // Attach any uploaded screenshots as images so Claude can read SEMrush/PageSpeed/etc.
  for (const s of (screenshots || []).slice(0, 6)) {
    if (s.base64 && s.mime) content.push({ type: 'image', source: { type: 'base64', media_type: s.mime, data: s.base64 } });
  }

  const out = await callAI({ anthropicKey: keys.anthropicKey, openaiKey: keys.openaiKey, system, messages: [{ role: 'user', content }], maxTokens: 3000 });
  return parseJson(out);
}

function parseJson(s) {
  if (!s) return {};
  let t = String(s).trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  try { return JSON.parse(t); } catch { return {}; }
}

// ---- per-section screenshot analysis (vision) -----------------------------
// Each uploaded screenshot is read by Claude IN THE CONTEXT of its section, so
// the observation is a real, specific read of the image (e.g. "Authority Score
// 14, Organic Traffic 57, 27 keywords") — not a generic "screenshot from X".
// SHOT_CONTEXT maps a slot key to what the image shows + what to pull from it.
const SHOT_CONTEXT = {
  '2.1': { tool: 'SEMrush Domain Overview', want: 'Authority Score, Organic Traffic (monthly visits), number of Organic Keywords, Referring Domains / Backlinks, and the traffic trend (growing, flat or declining).' },
  '2.2': { tool: 'Google "site:" search results', want: 'which pages Google has indexed and whether the main sections appear. If the total result count is not shown, do NOT mention that or the screenshot — simply state which page types you can see are indexed and that the full indexed count will be confirmed from Google Search Console.' },
  '3.1': { tool: 'view-source of the homepage', want: 'the meta robots tag value (index/noindex), the <title>, and the canonical URL.' },
  '3.2': { tool: 'the robots.txt file', want: 'which paths are disallowed, whether a Sitemap: line is present, and whether any AI crawlers (GPTBot, PerplexityBot, ClaudeBot, Google-Extended) are blocked.' },
  '3.3': { tool: 'the XML sitemap', want: 'whether the sitemap loads, how many URLs/child sitemaps it lists, and whether the main pages are included.' },
  '3.4': { tool: 'Screaming Frog Response Codes', want: 'how many URLs return 200 vs 3xx redirects vs 4xx/5xx errors, and whether any broken links or redirect chains are visible.' },
  '4.1': { tool: 'PageSpeed Insights (Mobile)', want: 'the Performance score, and the LCP, CLS, TBT / Speed Index values, and any flagged "Opportunities".' },
  '4.2': { tool: 'PageSpeed Insights (Desktop)', want: 'the Performance score and the core metrics (LCP, CLS), and how it compares to mobile.' },
  '4.4': { tool: 'the homepage rendered on mobile/tablet/desktop', want: 'whether the layout adapts cleanly to each screen size, and any obvious overflow, overlap or broken responsiveness.' },
  '5.2': { tool: 'Google Rich Results Test', want: 'which structured-data / schema types were detected, and whether any errors or warnings are shown.' },
  '5.3': { tool: 'the Open Graph / social share preview', want: 'whether a share image, title and description are present and look correct, or whether the preview is blank/broken.' },
  '8.1': { tool: 'SEMrush Backlink table', want: 'total backlinks, referring domains, authority score, toxicity, and the strongest referring domains visible.' },
  '8.2': { tool: 'Moz / authority checker', want: 'Domain Authority (DA), Page Authority (PA), Spam Score, and linking root domains.' },
  '9.1': { tool: 'SEMrush competitor traffic chart', want: 'which competitor domains appear, their estimated monthly traffic/keywords, and how this site compares to them.' },
  '10.2': { tool: 'SEMrush Keyword Magic Tool', want: 'the main keywords shown with their search volume and KD% (difficulty), and which look like realistic targets.' },
};

// Returns an ARRAY of short bullet strings (2-4), so every observation reads as
// scannable points rather than a wall of text. The report never says a
// screenshot was used or that something "wasn't visible in the screenshot".
async function analyzeShot(keys, slot, image, { domain, business }) {
  const ctx = SHOT_CONTEXT[slot] || { tool: 'an SEO tool', want: 'the key figures and what they mean for this website.' };
  const system = `You are a senior SEO auditor writing the "Current Observation" for ONE section of a client-facing audit report. You are given a ${ctx.tool} view for ${business} (${domain}). Read the real numbers and text in it.
Pull out: ${ctx.want}
STRICT RULES:
- Write the finding as an AUDITOR stating facts about the website — NOT as someone describing a picture. NEVER mention "the screenshot", "this view", "the image", "shown here", or that a count/figure "is not visible/displayed". The client must never feel they are reading a caption of a pasted screenshot.
- If an expected figure genuinely isn't present, don't flag its absence — instead state what you CAN confirm, and say the precise figure "will be confirmed from [the right tool, e.g. Google Search Console / SEMrush]".
- Output 2 to 4 SHORT bullet points. Each bullet is one plain, calm fact a non-technical owner understands, with the real number where you have it. No hype, no exclamation marks, no invented numbers.
- Where something is weak, end that bullet with the fix in plain words ("our team will …").
- Output ONLY a JSON array of strings, e.g. ["...","..."]. No other text.`;
  const content = [
    { type: 'text', text: `Write the Current Observation bullets for the ${slot} section of ${domain}.` },
    { type: 'image', source: { type: 'base64', media_type: image.mime, data: image.base64 } },
  ];
  const toBullets = (raw) => {
    if (!raw) return null;
    try { const arr = JSON.parse((raw.match(/\[[\s\S]*\]/) || [raw])[0]); if (Array.isArray(arr) && arr.length) return arr.map((x) => String(x).trim()).filter(Boolean).slice(0, 5); } catch {}
    // fallback: split a paragraph into sentence bullets
    return String(raw).split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 4).slice(0, 4);
  };
  try {
    if (keys.anthropicKey) return toBullets((await callClaude(keys.anthropicKey, { system, messages: [{ role: 'user', content }], maxTokens: 600 })).trim());
  } catch (e) { console.error('[preSeoAnalyze] shot analysis (claude) failed for', slot, e.message); }
  try {
    if (keys.openaiKey) return toBullets((await callOpenaiVision(keys.openaiKey, system, content)).trim());
  } catch (e) { console.error('[preSeoAnalyze] shot analysis (openai) failed for', slot, e.message); }
  return null;
}

// OpenAI vision: gpt-4o-mini accepts image_url content blocks (base64 data URI).
async function callOpenaiVision(apiKey, system, claudeContent) {
  const parts = claudeContent.map((b) => b.type === 'image'
    ? { type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } }
    : { type: 'text', text: b.text });
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 500, messages: [{ role: 'system', content: system }, { role: 'user', content: parts }] }),
  });
  if (!res.ok) throw new Error(`OpenAI vision ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
}

// ---- AI Answers (section 11.1): query ChatGPT + Claude live ----------------
// Instead of asking the user to paste a ChatGPT/Perplexity screenshot, we ask
// both models the real "best X" buying question and record which brands each
// names and whether the client's brand appears. Returns a section-ready object.
async function aiAnswers(keys, { facts: f, meta }) {
  const business = meta.businessName || f.domain;
  const bareDomain = (f.domain || '').replace(/^www\./, '');
  // Derive the category/audience from the homepage title + schema so the query
  // is realistic for this specific business.
  let query = '';
  try {
    const q = await callAI({
      anthropicKey: keys.anthropicKey, openaiKey: keys.openaiKey, maxTokens: 400,
      system: 'You are a market researcher. First understand exactly what product or service the business sells and who buys it, from the evidence given. Then write the single most natural "best X" question a real prospective CUSTOMER would type into ChatGPT when close to buying in that specific category. Output ONLY valid JSON, no markdown.',
      messages: [{ role: 'user', content: `Business: ${business}\nWebsite: ${f.domain}\nHomepage title: ${f.title}\nMeta description: ${f.metaDesc || ''}\nSchema types: ${(f.schemaTypes || []).join(', ')}\nServices detected on site: ${(meta.services || []).join(', ') || 'infer from the text'}\nHomepage text (excerpt): ${(f.bodyTextSample || '').slice(0, 1200)}\n\nRules:\n- The question must match what this business ACTUALLY sells (e.g. if they sell a cooking-oil longevity device to restaurants, ask what a restaurant operator would ask, not a generic consumer question).\n- Do NOT mention "${business}" or the domain in the question.\n- Make it specific to the category and the buyer, the way a real person phrases it.\nReturn JSON: {"query":"...","category":"short category label","audience":"who asks this"}` }],
    });
    const parsed = parseJson(q);
    query = parsed.query || '';
  } catch {}
  if (!query) query = `What are the best ${f.title ? f.title.split('|')[0].trim() : 'options'} available?`;

  const ask = async (provider) => {
    const sys = 'Answer as you normally would for a member of the public asking for a recommendation. Name specific real companies/brands/products where you can. Be concise (under 200 words).';
    const msgs = [{ role: 'user', content: query }];
    try {
      if (provider === 'claude' && keys.anthropicKey) return await callClaude(keys.anthropicKey, { system: sys, messages: msgs, maxTokens: 700 });
      if (provider === 'openai' && keys.openaiKey) return await callOpenai(keys.openaiKey, { system: sys, messages: msgs, maxTokens: 700 });
    } catch (e) { console.error('[preSeoAnalyze] aiAnswers', provider, 'failed:', e.message); }
    return '';
  };
  const [claudeAns, openaiAns] = await Promise.all([ask('claude'), ask('openai')]);

  const mentioned = (txt) => {
    if (!txt) return null;
    const h = txt.toLowerCase();
    return h.includes(business.toLowerCase()) || h.includes(bareDomain.toLowerCase());
  };
  // Pull the brand names each model recommended.
  const extractBrands = async (txt) => {
    if (!txt) return [];
    try {
      const out = await callAI({
        anthropicKey: keys.anthropicKey, openaiKey: keys.openaiKey, maxTokens: 300,
        system: 'Output ONLY valid JSON, no markdown.',
        messages: [{ role: 'user', content: `List every company/brand/product named as an option in this text. Exclude generic terms and directories.\n\nTEXT:\n${txt.slice(0, 3000)}\n\nReturn JSON: {"brands":["..."]}` }],
      });
      return (parseJson(out).brands || []).slice(0, 8);
    } catch { return []; }
  };
  const [claudeBrands, openaiBrands] = await Promise.all([extractBrands(claudeAns), extractBrands(openaiAns)]);

  const rows = [];
  if (claudeAns) rows.push({ model: 'Claude', brands: claudeBrands, mentioned: mentioned(claudeAns) });
  if (openaiAns) rows.push({ model: 'ChatGPT (GPT-4o)', brands: openaiBrands, mentioned: mentioned(openaiAns) });

  const anyMention = rows.some((r) => r.mentioned);
  const allBrands = [...new Set([...claudeBrands, ...openaiBrands])].filter((b) => b.toLowerCase() !== business.toLowerCase());
  let obs;
  if (!rows.length) {
    obs = 'AI assistant results could not be retrieved for this report. Our team will run these checks manually and include them in the first monthly report.';
  } else if (anyMention) {
    obs = `We asked ChatGPT and Claude the question a buyer would ask — "${query}" — without naming the brand. ${business} was mentioned in the answer, which is a good early signal. The brands named most often were ${allBrands.slice(0, 5).join(', ') || 'a mix of larger players'}. Our team will strengthen this further with schema, FAQ content and listings so the brand is recommended more consistently.`;
  } else {
    obs = `We asked ChatGPT and Claude the question a buyer would ask — "${query}" — without naming the brand. ${business} was not mentioned in either answer; the assistants recommended ${allBrands.slice(0, 5).join(', ') || 'other, better-known brands'} instead. This is the AI-search gap we will close by getting the site indexed, adding answer-friendly FAQ content and schema, and building listings and article mentions so AI tools start naming the brand.`;
  }
  return { query, obs, rows, anyMention };
}

// ---- assemble final report data -------------------------------------------
async function buildReportData(crawl, meta, keys, screenshots) {
  const f = facts(crawl);
  const base = skeleton(f, meta);
  let n = {};
  try { n = await analyzeNarrative(keys, { facts: f, meta, screenshots }); } catch (e) { console.error('[preSeoAnalyze] claude failed:', e.message); }

  // Per-section vision read of each UPLOADED screenshot → a real observation.
  // Keyed by slot ('2.1','4.1',...); auto-captured boxes are skipped (they are
  // generated from crawl data, not uploads, and need no vision pass).
  const shotObs = {};
  for (const s of (screenshots || [])) {
    if (!s || !s.base64 || !s.mime || !SHOT_CONTEXT[s.key]) continue;
    const text = await analyzeShot(keys, s.key, s, { domain: f.domain, business: meta.businessName });
    if (text) shotObs[s.key] = text;
  }

  // AI Answers (11.1): live ChatGPT + Claude query, no screenshot needed.
  let ai = null;
  try { ai = await aiAnswers(keys, { facts: f, meta }); } catch (e) { console.error('[preSeoAnalyze] aiAnswers failed:', e.message); }

  // health score + bars
  const bars = (n.healthBars && n.healthBars.length === 10 ? n.healthBars : defaultBars(f)).map((x) => ({ n: x.n, s: clamp(x.s), pct: Math.max(3, clamp(x.s) * 10), color: barColor(clamp(x.s)) }));
  const total = bars.reduce((a, c) => a + c.s, 0); // out of 100
  base.report.healthScore = { value: total, deg: Math.round(total / 100 * 360) };
  // Now that the score exists, put it into the first overview stat tile.
  if (base.ch1.stats && base.ch1.stats[0]) base.ch1.stats[0].v = String(total);

  base.ch1.homepageNotes = n.homepageNotes || ['The homepage was reviewed as part of this audit.'];
  base.ch1.healthBars = bars;
  base.ch1.topIssues = (n.topIssues || deriveTopIssues(f)).slice(0, 5);
  base.ch1.working = n.working || [];
  base.ch1.fixing = n.fixing || [];
  base.ch1.keyTakeaway = n.keyTakeaway || 'The audit identified the key issues to fix before the campaign starts.';
  base.ch1.about = n.about || `This report shows where ${f.domain} stands today. Every fix listed will be carried out by the Qtonix team once you approve the plan.`;

  base.chapters = buildChapters(f, n, meta, { shotObs, ai });
  delete base._facts;
  return base;
}

// "What We Need From You" adapts to how the client handles access. Some share
// credentials directly; some prefer we coordinate with their existing developer.
function accessCols(mode) {
  const approval = ['Approval of the items in this report', 'Approval of new page content before it goes live'];
  if (mode === 'coordinate') {
    return { leftTitle: 'Approval', left: approval, rightTitle: 'Access (via your developer)', right: [
      'An introduction to your website developer or agency so we can coordinate the changes',
      'Read access to Google Analytics / Search Console (or a report export)',
      'A point of contact for scheduling the technical fixes',
    ] };
  }
  if (mode === 'share') {
    return { leftTitle: 'Approval', left: approval, rightTitle: 'Access', right: [
      'Website admin / CMS login',
      'Hosting / DNS access (for technical fixes)',
      'Any existing Google Analytics, Search Console or Tag Manager accounts',
    ] };
  }
  // unsure → offer both paths so it fits any client.
  return { leftTitle: 'Approval', left: approval, rightTitle: 'Access (whichever suits you)', right: [
    'Either share website admin / hosting access directly,',
    'or introduce us to your developer and we will coordinate the changes with them.',
    'Plus access to any existing Analytics / Search Console accounts, or a report export.',
  ] };
}

function clamp(s) { s = Math.round(Number(s)); return Number.isFinite(s) ? Math.max(0, Math.min(10, s)) : 0; }
function defaultBars(f) {
  return [
    { n: 'Crawling & Indexing', s: f.noindex ? 1 : (f.hasSitemap ? 7 : 4) },
    { n: 'On-Page SEO', s: (f.hasMetaDesc ? 2 : 0) + (f.titleLength > 20 ? 2 : 1) },
    { n: 'Content & Trust', s: f.wordCount > 300 ? 5 : 2 },
    { n: 'Speed & Core Web Vitals', s: f.perfMobile != null ? Math.round(f.perfMobile / 10) : 4 },
    { n: 'Mobile & UX Basics', s: f.mobile ? 6 : 2 },
    { n: 'Schema & Social Tags', s: (f.hasSchema ? 3 : 0) + (f.hasOg ? 2 : 0) },
    { n: 'Backlinks & Authority', s: 1 },
    { n: 'Tracking & Measurement', s: 1 },
    { n: 'AI Search Visibility', s: f.noindex ? 0 : 2 },
    { n: 'Brand & Social Presence', s: Math.min(5, (f.socialNetworks || []).length) },
  ];
}
function deriveTopIssues(f) {
  const out = [];
  if (f.noindex) out.push({ issue: 'The homepage carries a noindex tag, so search engines are told not to list the site.', priority: 'CRITICAL' });
  if (!f.hasSitemap) out.push({ issue: 'No XML sitemap found.', priority: 'CRITICAL' });
  if (!f.hasMetaDesc) out.push({ issue: 'Meta description is missing.', priority: 'HIGH' });
  if (!f.hasSchema) out.push({ issue: 'No schema markup found.', priority: 'HIGH' });
  if (!f.hasOg) out.push({ issue: 'No Open Graph / social sharing tags.', priority: 'MEDIUM' });
  return out;
}

// Build chapters 2..14 + appendix. Narrative fields come from Claude (n),
// factual tables from crawl facts (f). Screenshot slots reference shot keys the
// capture step / uploads fill.
// Section 11.1 "AI Answers", built from the live ChatGPT + Claude query (no
// screenshot). Shows the observation plus a table: AI model → brands it named →
// whether this brand was mentioned. Always research-backed, so never pruned.
function aiAnswersSection(ai, f, meta) {
  const business = meta.businessName || f.domain;
  const base = { num: '11.1', heading: 'AI Answers', src: 'ChatGPT + Claude (live query)', research: true };
  if (!ai || !ai.rows || !ai.rows.length) {
    return { ...base, bullets: [{ kind: 'info', title: 'Current Observation', badge: 'INFO', text: (ai && ai.obs) || 'AI assistant results will be included in the first monthly report.' }] };
  }
  const yesno = (m) => (m === true ? 'YES' : m === false ? 'NO' : '—');
  return {
    ...base,
    bullets: [{ kind: ai.anyMention ? 'good' : 'high', title: 'Current Observation', badge: ai.anyMention ? 'GOOD' : 'HIGH', text: ai.obs }],
    table: {
      cols: [{ label: 'AI assistant', width: '22%' }, { label: `Brands it recommended`, }, { label: `${business} named?`, align: 'c', width: '18%' }],
      rows: ai.rows.map((r) => [
        { text: r.model, bold: true },
        { text: (r.brands && r.brands.length) ? r.brands.slice(0, 6).join(', ') : '—' },
        { badge: yesno(r.mentioned), align: 'c' },
      ]),
    },
  };
}

// NAP (Name, Address, Phone) shown as a clean key/value table, with multiple
// addresses / phones listed when the site has them.
function napSection(f, meta) {
  const nap = f.nap || {};
  const addresses = Array.isArray(nap.addresses) ? nap.addresses : (nap.address ? [nap.address] : []);
  const phones = Array.isArray(nap.phones) ? nap.phones : (nap.phone ? [nap.phone] : []);
  const emails = Array.isArray(nap.emails) ? nap.emails : (nap.email ? [nap.email] : []);
  const rows = [];
  rows.push([{ text: 'Name', bold: true }, { text: nap.name || '—' }]);
  if (addresses.length <= 1) {
    rows.push([{ text: 'Address', bold: true }, { text: addresses[0] || '—' }]);
  } else {
    addresses.forEach((a, i) => rows.push([{ text: `Address ${i + 1}`, bold: true }, { text: a }]));
  }
  if (phones.length <= 1) {
    rows.push([{ text: 'Phone number', bold: true }, { text: phones[0] || '—' }]);
  } else {
    phones.forEach((p, i) => rows.push([{ text: `Phone ${i + 1}`, bold: true }, { text: p }]));
  }
  if (emails.length) rows.push([{ text: emails.length > 1 ? 'Emails' : 'Email', bold: true }, { text: emails.join(', ') }]);

  const missing = [!nap.name && 'business name', !addresses.length && 'address', !phones.length && 'phone number'].filter(Boolean);
  const bullets = missing.length
    ? [{ kind: 'high', title: 'Current Observation', badge: 'HIGH', list: [
        `The following contact details are not clearly published on the site: ${missing.join(', ')}.`,
        'Consistent name, address and phone (NAP) across the site and listings is an important local-SEO and trust signal — our team will add and standardise it.',
      ] }]
    : [{ kind: 'good', title: 'Current Observation', badge: 'GOOD', list: [
        'Name, address and phone are published on the site.',
        'We will make sure they match exactly across the site, Google Business Profile and all directory listings.',
      ] }];

  return { num: '5.2', heading: 'Business Contact (NAP)', src: 'Name · Address · Phone', table: { cols: [{ label: 'Field', width: '26%' }, { label: 'Found on site' }], rows }, bullets };
}

function buildChapters(f, n, meta, extra) {
  const yn = (ok) => (ok ? 'PASS' : 'FAIL');
  const perfM = f.perfMobile != null ? String(f.perfMobile) : '__';
  const perfD = f.perfDesktop != null ? String(f.perfDesktop) : '__';
  const shotObs = (extra && extra.shotObs) || {};
  const ai = (extra && extra.ai) || null;
  // A section's uploaded-screenshot observation, as a Current Observation bullet.
  // shotObs[num] is an ARRAY of bullet strings from the vision read → render as
  // a bulleted Current Observation (never a plain paragraph).
  const badgeFor = (kind) => kind === 'good' ? 'GOOD' : kind === 'crit' ? 'CRITICAL' : kind === 'high' ? 'HIGH' : kind === 'med' ? 'MEDIUM' : 'INFO';
  const obsBullet = (num, kind) => {
    const v = shotObs[num];
    if (!v) return null;
    const b = { kind: kind || 'info', title: 'Current Observation', badge: badgeFor(kind) };
    if (Array.isArray(v)) b.list = v; else b.text = v;
    return [b];
  };
  // Build a Current Observation from a narrative value that may be an array of
  // bullets (preferred) or a single string. Always prefers bullets.
  const obs = (val, kind, fallback) => {
    const b = { kind: kind || 'info', title: 'Current Observation', badge: badgeFor(kind) };
    if (Array.isArray(val) && val.length) b.list = val;
    else if (typeof val === 'string' && val.trim()) b.text = val;
    else if (Array.isArray(fallback)) b.list = fallback;
    else b.text = fallback;
    return [b];
  };
  return [
    { no: '02', title: 'Search Visibility Stats', sub: 'Current organic traffic, keywords and whether Google has the site in its index.', sections: [
      { num: '2.1', heading: 'Overall Site Stats', src: 'SEMrush', manual: true, research: true, shot: { label: 'SEMrush > Domain Overview > ' + f.domain, note: 'Highlight Authority Score, Organic Traffic and Keywords.' }, bullets: obsBullet('2.1', 'info') || obs(n.searchVisibilityObs, 'info', ['Organic traffic, keyword rankings and domain authority will be confirmed from SEMrush.', 'These figures form the baseline we will grow from.']) },
      { num: '2.2', heading: 'Google Index Check', src: 'site:' + f.domain, manual: true, research: true, shot: { label: 'Google search: site:' + f.domain, note: 'Red box on "No results" if the site is not indexed.' }, bullets: obsBullet('2.2', f.noindex ? 'crit' : 'info') || obs(n.indexCheckObs, f.noindex ? 'crit' : 'info', f.noindex ? ['The site carries a noindex tag, so no pages appear in Google or Bing.', 'Our team will remove it and request indexing as the first task.'] : ['The main pages (home, contact, products, about) are set up to be indexed.', 'The exact number of indexed pages will be confirmed from Google Search Console.']) },
    ] },
    { no: '03', title: 'Technical SEO Stats', sub: 'Can search engines find, crawl and index the website?', sections: [
      { num: '3.1', heading: 'Meta Robots Tag', src: 'Page Source', research: true, shot: { label: 'view-source of the homepage' }, bullets: (obsBullet('3.1', f.noindex ? 'crit' : 'good') || [{ kind: f.noindex ? 'crit' : 'good', title: 'Current Observation', badge: f.noindex ? 'CRITICAL' : 'GOOD', text: f.noindex ? `The homepage meta robots tag is set to ${f.robotsMeta.includes('nofollow') ? 'noindex, nofollow' : 'noindex'}. This tells Google and Bing not to show the site in search results.` : 'No noindex block found on the homepage.' }]), willdo: f.noindex ? { text: 'Remove the blocking setting from all pages, submit the website to Google and Bing, and request indexing. This will be our first task after approval.' } : null },
      { num: '3.2', heading: 'Robots.txt', src: f.domain + '/robots.txt', research: true, shot: { label: f.domain + '/robots.txt' }, bullets: obsBullet('3.2', 'info') || [{ kind: 'info', title: 'Current Observation', badge: 'MEDIUM', text: `${f.hasRobots ? 'A robots.txt file is present.' : 'No robots.txt found.'} ${f.blocksAiCrawlers ? 'It blocks some AI crawlers.' : 'AI crawlers (GPTBot, PerplexityBot, ClaudeBot, Google-Extended) are not blocked, which is good.'} ${f.hasSitemap ? '' : 'The Sitemap line is missing and will be added by our team.'}` }] },
      { num: '3.3', heading: 'XML Sitemap', src: 'Browser', research: true, shot: { label: f.domain + '/sitemap_index.xml' }, bullets: obsBullet('3.3', f.hasSitemap ? 'good' : 'crit') || [{ kind: f.hasSitemap ? 'good' : 'crit', title: 'Current Observation', badge: f.hasSitemap ? 'GOOD' : 'CRITICAL', text: f.hasSitemap ? `An XML sitemap is present and lists ${f.totalPages || 'several'} page${f.totalPages === 1 ? '' : 's'}${f.sitemapIsIndex ? `, organised as a sitemap index across ${f.childSitemaps} child sitemaps (each child groups a set of pages — they are not pages themselves).` : '.'} This gives search engines a clear map of the site.` : (f.sitemapUserNone ? 'You confirmed the site has no XML sitemap. Our team will create one and submit it to Google and Bing.' : 'No XML sitemap was found at the usual locations. Our team will create one and submit it to Google and Bing.') }] },
      { num: '3.4', heading: 'Response Codes & Links', src: 'Screaming Frog', manual: true, shot: { label: 'Screaming Frog > Response Codes > All', note: 'Red box on 4xx and 3xx rows.' }, bullets: obsBullet('3.4', 'info') },
      { num: '3.5', heading: 'Technical Checklist', table: { cols: [{ label: 'Check', width: '34%' }, { label: 'Status', align: 'c', width: '14%' }, { label: 'Finding' }], rows: [
        [{ text: 'Meta robots tag', bold: true }, { badge: yn(!f.noindex), align: 'c' }, { text: f.noindex ? 'noindex found' : 'Indexable' }],
        [{ text: 'XML sitemap', bold: true }, { badge: yn(f.hasSitemap), align: 'c' }, { text: f.hasSitemap ? 'Present' : 'Not found' }],
        [{ text: 'Robots.txt', bold: true }, { badge: yn(f.hasRobots), align: 'c' }, { text: f.hasRobots ? 'Present' : 'Not found' }],
        [{ text: 'HTTPS / SSL', bold: true }, { badge: yn(f.https), align: 'c' }, { text: f.https ? 'Active' : 'Not active' }],
        [{ text: 'Canonical tags', bold: true }, { badge: yn(f.canonical), align: 'c' }, { text: f.canonical ? 'Present' : 'Missing' }],
        [{ text: 'Mobile viewport', bold: true }, { badge: yn(f.mobile), align: 'c' }, { text: f.mobile ? 'Set' : 'Missing' }],
      ] } },
    ] },
    { no: '04', title: 'Page Performance & Mobile Usability', sub: 'How fast the website loads and how it works on mobile.',
      stats: [{ v: f.sizeMb != null ? `${f.sizeMb} MB` : '—', l: 'homepage size (target under 2 MB)' }, { v: String(f.imageCount), l: 'images on the homepage' }, { v: String(f.imagesNoAlt), l: 'images missing alt text' }],
      sections: [
        { num: '4.1', heading: 'Page Performance: Mobile', src: 'Lighthouse', manual: true, research: f.perfMobile != null, shot: { label: 'PageSpeed Insights > ' + f.domain + ' > Mobile', note: 'Red box on Performance score, LCP and Speed Index.' }, bullets: obsBullet('4.1', f.perfMobile != null && f.perfMobile < 50 ? 'crit' : 'high') || (f.perfMobile != null ? [{ kind: f.perfMobile < 50 ? 'crit' : f.perfMobile < 90 ? 'high' : 'good', title: 'Current Observation', badge: f.perfMobile < 50 ? 'CRITICAL' : f.perfMobile < 90 ? 'HIGH' : 'GOOD', text: `The mobile performance score is ${f.perfMobile}/100${f.cls != null ? ` and the layout shift (CLS) score is ${f.cls}` : ''}. ${f.perfMobile < 90 ? 'Google uses these as ranking signals, so improving them is a priority. Our team will work on image sizes, render-blocking files and server response time.' : 'This is in good shape.'}` }] : null) },
        { num: '4.2', heading: 'Page Performance: Desktop', src: 'Lighthouse', manual: true, research: f.perfDesktop != null, shot: { label: 'PageSpeed Insights > ' + f.domain + ' > Desktop' }, bullets: obsBullet('4.2', f.perfDesktop != null && f.perfDesktop < 50 ? 'crit' : 'high') || (f.perfDesktop != null ? [{ kind: f.perfDesktop < 50 ? 'crit' : f.perfDesktop < 90 ? 'high' : 'good', title: 'Current Observation', badge: f.perfDesktop < 50 ? 'CRITICAL' : f.perfDesktop < 90 ? 'HIGH' : 'GOOD', text: `The desktop performance score is ${f.perfDesktop}/100. ${f.perfDesktop < 90 ? 'Desktop is usually faster than mobile; the same speed fixes will lift both.' : 'This is in good shape.'}` }] : null) },
        { num: '4.3', heading: 'Core Web Vitals', src: "Google PageSpeed Insights", table: { cols: [{ label: 'Metric' }, { label: 'What it measures' }, { label: 'Good target' }, { label: 'This site' }], rows: [
          [{ text: 'LCP', bold: true }, { text: 'How quickly the main content appears' }, { text: '2.5 s or less' }, { text: f.lcp ? (f.lcp / 1000).toFixed(1) + ' s' : 'No data' }],
          [{ text: 'INP', bold: true }, { text: 'How quickly the page reacts to a tap' }, { text: '200 ms or less' }, { text: f.inp ? f.inp + ' ms' : (f.tbt ? `~${Math.round(f.tbt)} ms TBT` : 'Low traffic — no field data') }],
          [{ text: 'CLS', bold: true }, { text: 'Whether the layout jumps while loading' }, { text: '0.1 or less' }, { text: f.cls != null ? Number(f.cls).toFixed(3) : 'No data' }],
          [{ text: 'TBT', bold: true }, { text: 'Total time the page is blocked from input' }, { text: '200 ms or less' }, { text: f.tbt != null ? `${Math.round(f.tbt)} ms` : 'No data' }],
          [{ text: 'Speed Index', bold: true }, { text: 'How fast content is visually populated' }, { text: '3.4 s or less' }, { text: f.speedIndex != null ? (f.speedIndex / 1000).toFixed(1) + ' s' : 'No data' }],
          [{ text: 'Performance Score', bold: true }, { text: 'Lighthouse lab test, 0 to 100' }, { text: '90+' }, { text: `Mobile ${perfM} / Desktop ${perfD}` }],
        ] } },
        { num: '4.4', heading: 'Mobile Usability', src: 'Responsiveness', shot: { label: 'Homepage on mobile, tablet and desktop', device: true }, bullets: [{ kind: f.mobile ? 'good' : 'high', title: 'Current Observation', badge: f.mobile ? 'GOOD' : 'HIGH', text: f.mobile ? 'The website is mobile friendly and the layout adjusts well. We will re-test on real devices after the speed work.' : 'No mobile viewport meta found — the site may not display correctly on phones.' }] },
      ] },
    { no: '05', title: 'On Page SEO Stats', sub: 'Titles, descriptions, headings, images, schema and social tags.', sections: [
      { num: '5.1', heading: 'Meta Title & Meta Description', src: 'Homepage',
        serp: { url: f.domain, title: f.title || `${meta.businessName}`, desc: f.metaDesc || 'No meta description set — Google will auto-generate a snippet from page text, which is usually weaker.' },
        bullets: [{ kind: 'high', title: 'Current Observation', badge: 'HIGH', list: [
          `Title: ${f.title ? '"' + f.title + '" (' + f.titleLength + ' chars)' : 'missing'}${f.titleLength > 60 ? ' — a little long, may be truncated in Google' : f.titleLength && f.titleLength < 30 ? ' — short, room to add keywords' : ''}`,
          `Meta description: ${f.hasMetaDesc ? 'present (' + (f.metaDesc ? f.metaDesc.length : 0) + ' chars)' : 'missing'}`,
          `H1 tags: ${f.h1Count}${f.h1Count !== 1 ? (f.h1Count === 0 ? ' — no H1 found' : ' — more than one H1') : ''}`,
          `Images: ${f.imageCount} on the homepage, ${f.imagesNoAlt} missing alt text`,
          `Schema types: ${f.hasSchema ? f.schemaTypes.join(', ') : 'none found'}`,
        ] }, ...(f.brand && f.brand.variants && f.brand.variants.length ? [{ kind: 'high', title: 'Brand name consistency', badge: 'HIGH', text: `The brand name is written inconsistently across the site: ${f.brand.variants.map((v) => v.map((x) => '"' + x + '"').join(' vs ')).join('; ')}. Pick one exact spelling and use it everywhere (header, footer, titles, schema) so search engines and AI tools treat it as one consistent brand.` }] : [])] },
      napSection(f, meta),
      { num: '5.3', heading: 'Schema Markup', src: 'Rich Results Test', research: true, shot: { label: 'Google Rich Results Test > ' + f.domain, note: 'Red box on "No items detected".' }, bullets: obsBullet('5.2', f.hasSchema ? 'good' : 'high') || [{ kind: f.hasSchema ? 'good' : 'high', title: 'Current Observation', badge: f.hasSchema ? 'GOOD' : 'HIGH', text: f.hasSchema ? `Schema found: ${f.schemaTypes.join(', ')}.` : 'No schema markup found. Our team will add Organization, WebSite and relevant schema so Google and AI tools understand the brand.' }], willdo: f.hasSchema ? null : { text: 'Add the required schema markup across the website.' } },
      { num: '5.4', heading: 'Social Tags', src: 'Open Graph', research: true, shot: { label: 'Open Graph preview of ' + f.domain }, bullets: obsBullet('5.3', f.hasOg ? 'good' : 'high') || [{ kind: f.hasOg ? 'good' : 'high', title: 'Current Observation', badge: f.hasOg ? 'GOOD' : 'MEDIUM', text: f.hasOg ? 'Open Graph tags are present.' : 'No Open Graph tags found. When the link is shared on WhatsApp, Facebook or Discord, it will not show a proper preview. Our team will add social tags and a branded share image.' }] },
      { num: '5.5', heading: 'Images', src: 'Crawl', bullets: [{ kind: 'high', title: 'Current Observation', badge: 'HIGH', list: [`Images on homepage: ${f.imageCount}`, `Images missing alt text: ${f.imagesNoAlt}`] }], willdo: { text: 'Add descriptive alt text to all images and compress large files.' } },
    ] },
    { no: '06', title: 'Content Quality & Trust', sub: 'Google rewards Experience, Expertise, Authority and Trust (E-E-A-T).', sections: [
      { num: '6.1', heading: 'Content Review', bullets: [{ kind: f.wordCount < 300 ? 'high' : 'good', title: 'Current Observation', badge: f.wordCount < 300 ? 'HIGH' : 'GOOD', list: [
        `Homepage word count: ${f.wordCount}${f.wordCount < 300 ? ' — thin for a page meant to rank' : f.wordCount < 600 ? ' — a reasonable start, more depth would help' : ' — a healthy amount of content'}`,
        `HTML-to-text ratio: ${f.htmlTextRatio != null ? (f.htmlTextRatio * 100).toFixed(1) + '%' : 'n/a'}${f.htmlTextRatio != null && f.htmlTextRatio < 0.08 ? ' — low, the page is heavy on code vs. readable text' : ''}`,
        `Content vs. title/description: ${n.contentMatch || 'checked against the homepage title and meta description'}`,
        `Writing quality: ${n.contentQuality || 'reviewed for spelling, clarity and signs of thin or auto-generated copy'}`,
      ] }, ...(f.brand && f.brand.variants && f.brand.variants.length ? [{ kind: 'high', title: 'Brand consistency (E-E-A-T)', badge: 'HIGH', text: `The brand name appears in more than one form (${f.brand.variants.map((v) => v.join(' / ')).join('; ')}). Inconsistent naming weakens trust signals; we will standardise it across every page.` }] : [])], willdo: { text: 'Our content team will write SEO-friendly content for every main page (300+ words each), fix any spelling or clarity issues, align copy with the target keywords, and remove placeholder or thin text.' } },
    ] },
    { no: '07', title: 'Site Architecture', sub: 'Menu, URL structure and how pages link to each other.', sections: [
      // Architecture-specific findings only — the PASS/FAIL technical items
      // already live in 1.5 Quick Summary and 3.5 Technical Checklist, so they
      // are not repeated here.
      { num: '7.1', heading: 'Architecture Analysis', table: { cols: [{ label: 'Element' }, { label: 'Finding' }], rows: [
        [{ text: 'Pages in the sitemap', bold: true }, { text: f.totalPages ? `${f.totalPages} URLs${f.sitemapIsIndex ? ` across ${f.childSitemaps} child sitemaps` : ''}` : (f.sitemapUserNone ? 'No sitemap — recommend creating one' : 'Not detected') }],
        [{ text: 'Internal links on homepage', bold: true }, { text: `${f.internalLinks != null ? f.internalLinks : '—'}${f.internalLinks != null && f.internalLinks < 10 ? ' (thin internal linking)' : ''}` }],
        [{ text: 'Canonical tags', bold: true }, { text: f.canonical ? 'Present — helps avoid duplicate content' : 'Missing — duplicate-content risk' }],
        [{ text: 'URL style', bold: true }, { text: n.urlStyle || 'Readable, keyword-friendly URLs are recommended across all pages' }],
      ] } },
      { num: '7.2', heading: 'Structure Notes', bullets: [{ kind: 'info', title: 'Current Observation', badge: 'INFO', text: n.architectureObs || `The site's main sections are reachable from the top navigation. As new content pages are added, our team will plan a clear category structure and internal-linking plan so both visitors and search engines can find every page easily.` }] },
    ] },
    { no: '08', title: 'Off Page Stats', sub: 'Who links to the website today, and how strong those links are.', sections: [
      { num: '8.1', heading: 'Backlink Status', src: 'SEMrush', manual: true, shot: { label: 'SEMrush backlink table for ' + f.domain }, bullets: obsBullet('8.1', 'high') },
      { num: '8.2', heading: 'Website Authority', src: 'Moz', manual: true, shot: { label: 'Authority checker > ' + f.domain, note: 'Red box on DA, PA and Spam Score.' }, bullets: obsBullet('8.2', 'info') },
    ] },
    { no: '09', title: 'Competitor Overview', sub: 'How the market looks in search.', sections: [
      { num: '9.1', heading: 'Competitor Traffic', src: 'SEMrush', manual: true, shot: { label: 'Estimated monthly traffic chart for the top competitors' }, bullets: obsBullet('9.1', 'info') },
      { num: '9.2', heading: 'Where You Can Win', table: { cols: [{ label: 'Competitor strength' }, { label: 'Your opening' }], rows: (n.competitorOpenings || [{ strength: 'Big players own broad terms', opening: 'Target niche, buying-intent searches first' }]).map((o) => [{ text: o.strength }, { text: o.opening }]) } },
    ] },
    { no: '10', title: 'Keyword Opportunity Map', sub: 'The main search phrase each page should focus on.', sections: [
      { num: '10.1', heading: 'Proposed Keyword Targets', src: 'For approval', table: { cols: [{ label: 'Page' }, { label: 'Primary keyword' }, { label: 'Supporting keywords' }, { label: 'Difficulty', align: 'c', width: '14%' }], rows: (n.keywordTargets || []).map((k) => [{ text: k.page, bold: true }, { text: k.keyword }, { text: k.supporting }, { badge: (k.difficulty || 'MODERATE'), align: 'c' }]) } },
      { num: '10.2', heading: 'Keyword Research', src: 'SEMrush Keyword Magic Tool', manual: true, shot: { label: 'SEMrush > Keyword Magic Tool', note: 'Red box on volume and KD% for the main keywords.' }, bullets: obsBullet('10.2', 'info') },
    ] },
    { no: '11', title: 'AI Search Visibility', sub: 'ChatGPT, Perplexity, Gemini and Google AI Overviews.', sections: [
      aiAnswersSection(ai, f, meta),
      { num: '11.2', heading: 'AI Readiness Checklist', table: { cols: [{ label: 'Check' }, { label: 'Status', align: 'c', width: '14%' }, { label: 'Finding' }], rows: [
        [{ text: 'Indexed in Google and Bing', bold: true }, { badge: yn(!f.noindex), align: 'c' }, { text: f.noindex ? 'Blocked by noindex' : 'Indexable' }],
        [{ text: 'AI crawlers allowed', bold: true }, { badge: yn(!f.blocksAiCrawlers), align: 'c' }, { text: f.blocksAiCrawlers ? 'Some blocked' : 'Not blocked in robots.txt' }],
        [{ text: 'Organization schema with social links', bold: true }, { badge: yn(f.hasSchema), align: 'c' }, { text: f.hasSchema ? 'Present' : 'Missing' }],
        [{ text: 'Answer-friendly content (FAQs, guides)', bold: true }, { badge: 'FAIL', align: 'c' }, { text: 'To build' }],
      ] }, willdo: { text: 'Get the website indexed, add answer-friendly FAQ content and schema, and work on listings and article mentions so AI tools start recommending the brand.' } },
    ] },
    { no: '12', title: 'Tracking & Social Profiles', sub: 'Analytics setup and social media presence.', sections: [
      { num: '12.1', heading: 'Tracking & Analytics', src: 'Page source', table: { cols: [{ label: 'Tool' }, { label: 'Status', align: 'c', width: '16%' }, { label: 'What it does' }], rows: [
        [{ text: 'Google Analytics 4', bold: true }, { badge: yn(!!f.tracking.ga4), align: 'c' }, { text: 'Measures visitors, traffic sources and conversions' }],
        [{ text: 'Google Tag Manager', bold: true }, { badge: yn(!!f.tracking.gtm), align: 'c' }, { text: 'Manages all tracking tags in one place' }],
        [{ text: 'Google Search Console', bold: true }, { badge: f.tracking.gsc ? 'PASS' : 'UNKNOWN', align: 'c' }, { text: 'Shows how the site performs in Google search (verify from the account)' }],
        [{ text: 'Bing Webmaster Tools', bold: true }, { badge: f.tracking.bing ? 'PASS' : 'UNKNOWN', align: 'c' }, { text: 'The Bing equivalent of Search Console' }],
        [{ text: 'Meta (Facebook) Pixel', bold: true }, { badge: yn(!!f.tracking.metaPixel), align: 'c' }, { text: 'Tracks visitors for Facebook/Instagram ads' }],
        [{ text: 'Other tools', bold: true }, { badge: (f.tracking.hotjar || f.tracking.clarity || f.tracking.linkedinInsight || f.tracking.tiktokPixel || f.tracking.ua) ? 'PASS' : 'NONE', align: 'c' }, { text: [f.tracking.ua && 'Universal Analytics (old)', f.tracking.hotjar && 'Hotjar', f.tracking.clarity && 'Clarity', f.tracking.linkedinInsight && 'LinkedIn Insight', f.tracking.tiktokPixel && 'TikTok Pixel'].filter(Boolean).join(', ') || 'None detected' }],
      ] }, bullets: [{ kind: (f.tracking.ga4 || f.tracking.gtm) ? 'info' : 'high', title: 'Current Observation', badge: (f.tracking.ga4 || f.tracking.gtm) ? 'INFO' : 'HIGH', text: (f.tracking.ga4 || f.tracking.gtm) ? `Some tracking is already installed${f.tracking.ga4 ? ' (GA4)' : ''}${f.tracking.gtm ? ', via Google Tag Manager' : ''}. Our team will confirm it is recording correctly and fill any gaps. Search Console access can only be confirmed from the account itself.` : 'No analytics or tag-manager code was detected in the page source. Without tracking there is no way to measure what is working, so this is a priority to set up.' }], willdo: { text: 'Confirm or set up Google Analytics 4, Google Tag Manager, Search Console and Bing Webmaster Tools, with conversion tracking for the actions that matter to the business.' } },
      { num: '12.2', heading: 'Social Profiles', table: { cols: [{ label: 'Profile' }, { label: 'Status', align: 'c', width: '14%' }, { label: 'Link' }], rows: ['facebook', 'instagram', 'twitter', 'youtube', 'tiktok', 'linkedin'].map((k) => [{ text: k.charAt(0).toUpperCase() + k.slice(1), bold: true }, { badge: yn(!!f.social[k]), align: 'c' }, { text: f.social[k] || '—' }]) } },
    ] },
    { no: '13', title: 'Action Plan & Approval', sub: 'What we will do after your approval, and what we need from you.', sections: [
      { num: '13.1', heading: 'What We Need From You', cols: accessCols(meta.accessMode) },
    ] },
    { no: 'A', title: 'Method & Glossary', sub: 'How this audit was done and what the SEO terms mean.', sections: [
      { num: 'A.1', heading: 'How This Audit Was Done', table: { cols: [{ label: 'Area' }, { label: 'Source and date' }], rows: [
        [{ text: 'On-page & technical checks', bold: true }, { text: 'Automated crawl of the live site, ' + meta.auditDate }],
        [{ text: 'Page speed', bold: true }, { text: 'Google PageSpeed Insights' }],
        [{ text: 'Backlinks & competitors', bold: true }, { text: 'SEMrush (from uploaded screenshots)' }],
      ] } },
      { num: 'A.2', heading: 'Glossary', table: { cols: [{ label: 'Term' }, { label: 'Plain meaning' }], rows: [
        [{ text: 'Indexing', bold: true }, { text: 'Google saving a page so it can appear in search results' }],
        [{ text: 'noindex', bold: true }, { text: 'A tag asking search engines not to show a page' }],
        [{ text: 'Meta description', bold: true }, { text: 'The short summary shown under the title in Google' }],
        [{ text: 'Schema markup', bold: true }, { text: 'Code that describes a business or page for search engines' }],
        [{ text: 'Core Web Vitals', bold: true }, { text: "Google's speed and stability measurements" }],
        [{ text: 'E-E-A-T', bold: true }, { text: 'Experience, Expertise, Authority, Trust: how Google judges quality' }],
      ] } },
    ] },
  ];
}

// Patch an already-built report at PDF-generation time: read any uploaded
// screenshots (which usually arrive AFTER the initial run, in the review step)
// and write a real per-section observation from each, and refresh the live AI
// Answers section. Mutates `data` in place. Preserves all other user edits.
async function refreshUploads(data, crawl, meta, keys, screenshots) {
  const f = facts(crawl || {});
  // 1) per-section observations from uploaded screenshots
  for (const s of (screenshots || [])) {
    if (!s || !s.base64 || !s.mime || !SHOT_CONTEXT[s.key]) continue;
    let bullets = null;
    try { bullets = await analyzeShot(keys, s.key, s, { domain: f.domain || (data.report && data.report.domain), business: meta.businessName || (data.report && data.report.businessName) }); }
    catch (e) { console.error('[preSeoAnalyze] refresh shot failed', s.key, e.message); }
    if (!bullets || !bullets.length) continue;
    const sec = findSection(data, s.key);
    if (sec) {
      const joined = bullets.join(' ').toLowerCase();
      const kind = /not indexed|no pages|blocked|missing|slow|0\/100|fail|low|urgent|critical/.test(joined) ? 'high' : 'info';
      sec.bullets = [{ kind, title: 'Current Observation', badge: kind === 'high' ? 'HIGH' : 'INFO', list: bullets }];
    }
  }
  // 2) refresh AI Answers (11.1)
  try {
    const ai = await aiAnswers(keys, { facts: f, meta });
    const sec = findSection(data, '11.1');
    const built = aiAnswersSection(ai, f, meta);
    if (sec) Object.assign(sec, built);
  } catch (e) { console.error('[preSeoAnalyze] refresh aiAnswers failed:', e.message); }
  return data;
}

function findSection(data, num) {
  for (const ch of (data.chapters || [])) for (const sec of (ch.sections || [])) if (sec.num === num) return sec;
  return null;
}

module.exports = { buildReportData, facts, refreshUploads };

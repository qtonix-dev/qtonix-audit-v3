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
const { callAI } = require('./aiVisibility');

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
    cls: (psM.field && psM.field.cls) || (psM.lab && psM.lab.cls) || null,
    inp: (psM.field && psM.field.inp) || null,
    sizeMb: sizeMb != null ? Number(sizeMb.toFixed(2)) : null,
  };
}

// ---- build the deterministic report skeleton ------------------------------
function skeleton(f, meta) {
  const mSize = f.sizeMb != null ? `${f.sizeMb} MB` : '—';
  return {
    report: {
      businessName: meta.businessName, shortName: meta.shortName || (meta.businessName || '').split(' ')[0],
      domain: f.domain, website: f.website, monthYear: meta.monthYear, auditDate: meta.auditDate,
      pagesReviewed: meta.pagesReviewed || 1, preparedBy: meta.preparedBy, contactEmail: meta.contactEmail,
      contactPhone: meta.contactPhone, clientLogo: meta.clientLogo || '',
      healthScore: { value: 0, deg: 0 }, // filled after Claude scores the bars
    },
    toc: TOC,
    ch1: {
      stats: [
        { v: f.noindex ? 'blocked' : 'OK', l: f.noindex ? 'pages blocked from Google (noindex)' : 'indexing allowed' },
        { v: '—', l: 'pages indexed in Google & Bing (manual check)' },
        { v: f.hasMetaDesc ? 'yes' : 'no', l: 'homepage has a meta description' },
        { v: '—', l: 'backlinks (from SEMrush upload)' },
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
  { n: '12', t: 'Tracking & Social Profiles', d: 'Analytics setup and social media presence' },
  { n: '13', t: 'Baseline KPIs', d: 'The starting numbers we will report progress against' },
  { n: '14', t: 'Action Plan & Approval', d: 'What we will do after approval, plus approval checklist' },
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
  };

  const schema = `{
  "healthBars": [ {"n":"Crawling & Indexing","s":0-10}, {"n":"On-Page SEO","s":0-10}, {"n":"Content & Trust","s":0-10}, {"n":"Speed & Core Web Vitals","s":0-10}, {"n":"Mobile & UX Basics","s":0-10}, {"n":"Schema & Social Tags","s":0-10}, {"n":"Backlinks & Authority","s":0-10}, {"n":"Tracking & Measurement","s":0-10}, {"n":"AI Search Visibility","s":0-10}, {"n":"Brand & Social Presence","s":0-10} ],
  "homepageNotes": ["2 short paragraphs about the homepage"],
  "topIssues": [ {"issue":"...","priority":"CRITICAL|HIGH|MEDIUM"} x5 ],
  "working": ["6 short bullet points of what is already good"],
  "fixing": ["6 short bullet points of what needs fixing"],
  "keyTakeaway": "1 short paragraph, the single most important issue",
  "about": "1 short paragraph: this report shows where the site stands; Qtonix will do the fixes after approval",
  "searchVisibilityObs": "observation for the SEMrush/traffic section",
  "indexCheckObs": "observation for the Google index (site:) check",
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

// ---- assemble final report data -------------------------------------------
async function buildReportData(crawl, meta, keys, screenshots) {
  const f = facts(crawl);
  const base = skeleton(f, meta);
  let n = {};
  try { n = await analyzeNarrative(keys, { facts: f, meta, screenshots }); } catch (e) { console.error('[preSeoAnalyze] claude failed:', e.message); }

  // health score + bars
  const bars = (n.healthBars && n.healthBars.length === 10 ? n.healthBars : defaultBars(f)).map((x) => ({ n: x.n, s: clamp(x.s), pct: Math.max(3, clamp(x.s) * 10), color: barColor(clamp(x.s)) }));
  const total = bars.reduce((a, c) => a + c.s, 0); // out of 100
  base.report.healthScore = { value: total, deg: Math.round(total / 100 * 360) };

  base.ch1.homepageNotes = n.homepageNotes || ['The homepage was reviewed as part of this audit.'];
  base.ch1.healthBars = bars;
  base.ch1.topIssues = (n.topIssues || deriveTopIssues(f)).slice(0, 5);
  base.ch1.working = n.working || [];
  base.ch1.fixing = n.fixing || [];
  base.ch1.keyTakeaway = n.keyTakeaway || 'The audit identified the key issues to fix before the campaign starts.';
  base.ch1.about = n.about || `This report shows where ${f.domain} stands today. Every fix listed will be carried out by the Qtonix team once you approve the plan.`;

  base.chapters = buildChapters(f, n, meta);
  delete base._facts;
  return base;
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
function buildChapters(f, n, meta) {
  const yn = (ok) => (ok ? 'PASS' : 'FAIL');
  const perfM = f.perfMobile != null ? String(f.perfMobile) : '__';
  const perfD = f.perfDesktop != null ? String(f.perfDesktop) : '__';
  return [
    { no: '02', title: 'Search Visibility Stats', sub: 'Current organic traffic, keywords and whether Google has the site in its index.', sections: [
      { num: '2.1', heading: 'Overall Site Stats', src: 'SEMrush', shot: { label: 'SEMrush > Domain Overview > ' + f.domain, note: 'Highlight Authority Score, Organic Traffic and Keywords.' }, bullets: [{ kind: 'info', title: 'Current Observation', badge: 'INFO', text: n.searchVisibilityObs || 'Organic traffic and keywords are the baseline we will grow from.' }] },
      { num: '2.2', heading: 'Google Index Check', src: 'site:' + f.domain, shot: { label: 'Google search: site:' + f.domain, note: 'Red box on "No results" if the site is not indexed.' }, bullets: [{ kind: f.noindex ? 'crit' : 'info', title: 'Current Observation', badge: f.noindex ? 'CRITICAL' : 'INFO', text: n.indexCheckObs || (f.noindex ? 'The site is blocked from indexing, so no pages appear in Google or Bing.' : 'Index coverage will be confirmed from Search Console.') }] },
    ] },
    { no: '03', title: 'Technical SEO Stats', sub: 'Can search engines find, crawl and index the website?', sections: [
      { num: '3.1', heading: 'Meta Robots Tag', src: 'Page Source', shot: { label: 'view-source of the homepage' }, bullets: [{ kind: f.noindex ? 'crit' : 'good', title: 'Current Observation', badge: f.noindex ? 'CRITICAL' : 'GOOD', text: f.noindex ? `The homepage meta robots tag is set to ${f.robotsMeta.includes('nofollow') ? 'noindex, nofollow' : 'noindex'}. This tells Google and Bing not to show the site in search results.` : 'No noindex block found on the homepage.' }], willdo: f.noindex ? { text: 'Remove the blocking setting from all pages, submit the website to Google and Bing, and request indexing. This will be our first task after approval.' } : null },
      { num: '3.2', heading: 'Robots.txt', src: f.domain + '/robots.txt', shot: { label: f.domain + '/robots.txt' }, bullets: [{ kind: 'info', title: 'Current Observation', badge: 'MEDIUM', text: `${f.hasRobots ? 'A robots.txt file is present.' : 'No robots.txt found.'} ${f.blocksAiCrawlers ? 'It blocks some AI crawlers.' : 'AI crawlers (GPTBot, PerplexityBot, ClaudeBot, Google-Extended) are not blocked, which is good.'} ${f.hasSitemap ? '' : 'The Sitemap line is missing and will be added by our team.'}` }] },
      { num: '3.3', heading: 'XML Sitemap', src: 'Browser', shot: { label: f.domain + '/sitemap_index.xml and /sitemap.xml' }, bullets: [{ kind: f.hasSitemap ? 'good' : 'crit', title: 'Current Observation', badge: f.hasSitemap ? 'GOOD' : 'CRITICAL', text: f.hasSitemap ? 'An XML sitemap is present.' : 'The website does not have an XML sitemap. Our team will create it and submit it to Google and Bing.' }] },
      { num: '3.4', heading: 'Response Codes & Links', src: 'Screaming Frog', shot: { label: 'Screaming Frog > Response Codes > All', note: 'Red box on 4xx and 3xx rows.' } },
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
        { num: '4.1', heading: 'Page Performance: Mobile', src: 'Lighthouse', shot: { label: 'PageSpeed Insights > ' + f.domain + ' > Mobile', note: 'Red box on Performance score, LCP and Speed Index.' } },
        { num: '4.2', heading: 'Page Performance: Desktop', src: 'Lighthouse', shot: { label: 'PageSpeed Insights > ' + f.domain + ' > Desktop' } },
        { num: '4.3', heading: 'Core Web Vitals', src: "Google's speed signals", table: { cols: [{ label: 'Metric' }, { label: 'What it measures' }, { label: 'Good target' }, { label: 'This site' }], rows: [
          [{ text: 'LCP', bold: true }, { text: 'How quickly the main content appears' }, { text: '2.5 s or less' }, { text: f.lcp ? (f.lcp / 1000).toFixed(1) + ' s' : '__ s' }],
          [{ text: 'INP', bold: true }, { text: 'How quickly the page reacts to a tap' }, { text: '200 ms or less' }, { text: f.inp ? f.inp + ' ms' : '__ ms' }],
          [{ text: 'CLS', bold: true }, { text: 'Whether the layout jumps while loading' }, { text: '0.1 or less' }, { text: f.cls != null ? String(f.cls) : '__' }],
          [{ text: 'Performance Score', bold: true }, { text: 'Lighthouse lab test, 0 to 100' }, { text: '90+' }, { text: `M: ${perfM} / D: ${perfD}` }],
        ] } },
        { num: '4.4', heading: 'Mobile Usability', src: 'Responsiveness', shot: { label: 'Homepage on mobile, tablet and desktop' }, bullets: [{ kind: f.mobile ? 'good' : 'high', title: 'Current Observation', badge: f.mobile ? 'GOOD' : 'HIGH', text: f.mobile ? 'The website is mobile friendly and the layout adjusts well. We will re-test on real devices after the speed work.' : 'No mobile viewport meta found — the site may not display correctly on phones.' }] },
      ] },
    { no: '05', title: 'On Page SEO Stats', sub: 'Titles, descriptions, headings, images, schema and social tags.', sections: [
      { num: '5.1', heading: 'Meta Title & Meta Description', src: 'Homepage', bullets: [{ kind: 'high', title: 'Current Observation', badge: 'HIGH', list: [`Title: ${f.title ? '"' + f.title + '" (' + f.titleLength + ' chars)' : 'missing'}`, `Meta description: ${f.hasMetaDesc ? 'present' : 'missing'}`, `H1 tags: ${f.h1Count}`, `Homepage word count: ${f.wordCount}`] }] },
      { num: '5.2', heading: 'Schema Markup', src: 'Rich Results Test', shot: { label: 'Google Rich Results Test > ' + f.domain, note: 'Red box on "No items detected".' }, bullets: [{ kind: f.hasSchema ? 'good' : 'high', title: 'Current Observation', badge: f.hasSchema ? 'GOOD' : 'HIGH', text: f.hasSchema ? `Schema found: ${f.schemaTypes.join(', ')}.` : 'No schema markup found. Our team will add Organization, WebSite and relevant schema so Google and AI tools understand the brand.' }], willdo: f.hasSchema ? null : { text: 'Add the required schema markup across the website.' } },
      { num: '5.3', heading: 'Social Tags', src: 'Open Graph', shot: { label: 'Open Graph preview of ' + f.domain }, bullets: [{ kind: f.hasOg ? 'good' : 'high', title: 'Current Observation', badge: f.hasOg ? 'GOOD' : 'MEDIUM', text: f.hasOg ? 'Open Graph tags are present.' : 'No Open Graph tags found. When the link is shared on WhatsApp, Facebook or Discord, it will not show a proper preview. Our team will add social tags and a branded share image.' }] },
      { num: '5.4', heading: 'Images', src: 'Crawl', bullets: [{ kind: 'high', title: 'Current Observation', badge: 'HIGH', list: [`Images on homepage: ${f.imageCount}`, `Images missing alt text: ${f.imagesNoAlt}`] }], willdo: { text: 'Add descriptive alt text to all images and compress large files.' } },
    ] },
    { no: '06', title: 'Content Quality & Trust', sub: 'Google rewards Experience, Expertise, Authority and Trust (E-E-A-T).', sections: [
      { num: '6.1', heading: 'Content Review', bullets: [{ kind: f.wordCount < 300 ? 'high' : 'good', title: 'Current Observation', badge: f.wordCount < 300 ? 'HIGH' : 'GOOD', text: `The homepage has about ${f.wordCount} words. ${f.wordCount < 300 ? 'This is thin for a page meant to rank; more original, keyword-focused content is needed.' : 'This is a reasonable amount of content.'}` }], willdo: { text: 'Our content team will write SEO-friendly content for every main page (300+ words each) and remove any placeholder or dummy text.' } },
    ] },
    { no: '07', title: 'Site Architecture', sub: 'Menu, URL structure and how pages link to each other.', sections: [
      { num: '7.1', heading: 'Architecture Analysis', table: { cols: [{ label: 'Element' }, { label: f.domain, align: 'c', width: '24%' }], rows: [
        [{ text: 'HTTPS enabled' }, { badge: yn(f.https), align: 'c' }],
        [{ text: 'XML sitemap + optimized robots.txt' }, { badge: yn(f.hasSitemap && f.hasRobots), align: 'c' }],
        [{ text: 'Schema markup present' }, { badge: yn(f.hasSchema), align: 'c' }],
        [{ text: 'Social sharing (Open Graph) tags' }, { badge: yn(f.hasOg), align: 'c' }],
        [{ text: 'Mobile viewport set' }, { badge: yn(f.mobile), align: 'c' }],
      ] } },
    ] },
    { no: '08', title: 'Off Page Stats', sub: 'Who links to the website today, and how strong those links are.', sections: [
      { num: '8.1', heading: 'Backlink Status', src: 'SEMrush', shot: { label: 'SEMrush backlink table for ' + f.domain }, bullets: [{ kind: 'high', title: 'Current Observation', badge: 'HIGH', text: 'Backlink detail will be added from the SEMrush upload. Link building will start from a clean baseline.' }] },
      { num: '8.2', heading: 'Website Authority', src: 'Moz', shot: { label: 'Authority checker > ' + f.domain, note: 'Red box on DA, PA and Spam Score.' } },
    ] },
    { no: '09', title: 'Competitor Overview', sub: 'How the market looks in search.', sections: [
      { num: '9.1', heading: 'Competitor Traffic', src: 'SEMrush', shot: { label: 'Estimated monthly traffic chart for the top competitors' } },
      { num: '9.2', heading: 'Where You Can Win', table: { cols: [{ label: 'Competitor strength' }, { label: 'Your opening' }], rows: (n.competitorOpenings || [{ strength: 'Big players own broad terms', opening: 'Target niche, buying-intent searches first' }]).map((o) => [{ text: o.strength }, { text: o.opening }]) } },
    ] },
    { no: '10', title: 'Keyword Opportunity Map', sub: 'The main search phrase each page should focus on.', sections: [
      { num: '10.1', heading: 'Proposed Keyword Targets', src: 'For approval', table: { cols: [{ label: 'Page' }, { label: 'Primary keyword' }, { label: 'Supporting keywords' }, { label: 'Difficulty', align: 'c', width: '14%' }], rows: (n.keywordTargets || []).map((k) => [{ text: k.page, bold: true }, { text: k.keyword }, { text: k.supporting }, { badge: (k.difficulty || 'MODERATE'), align: 'c' }]) } },
      { num: '10.2', heading: 'Keyword Research', src: 'SEMrush Keyword Magic Tool', shot: { label: 'SEMrush > Keyword Magic Tool', note: 'Red box on volume and KD% for the main keywords.' } },
    ] },
    { no: '11', title: 'AI Search Visibility', sub: 'ChatGPT, Perplexity, Gemini and Google AI Overviews.', sections: [
      { num: '11.1', heading: 'AI Answers', src: 'ChatGPT / Perplexity', shot: { label: 'ChatGPT or Perplexity answer for the main "best X" query', note: 'Red box on the list of tools / brands mentioned.' } },
      { num: '11.2', heading: 'AI Readiness Checklist', table: { cols: [{ label: 'Check' }, { label: 'Status', align: 'c', width: '14%' }, { label: 'Finding' }], rows: [
        [{ text: 'Indexed in Google and Bing', bold: true }, { badge: yn(!f.noindex), align: 'c' }, { text: f.noindex ? 'Blocked by noindex' : 'Indexable' }],
        [{ text: 'AI crawlers allowed', bold: true }, { badge: yn(!f.blocksAiCrawlers), align: 'c' }, { text: f.blocksAiCrawlers ? 'Some blocked' : 'Not blocked in robots.txt' }],
        [{ text: 'Organization schema with social links', bold: true }, { badge: yn(f.hasSchema), align: 'c' }, { text: f.hasSchema ? 'Present' : 'Missing' }],
        [{ text: 'Answer-friendly content (FAQs, guides)', bold: true }, { badge: 'FAIL', align: 'c' }, { text: 'To build' }],
      ] }, willdo: { text: 'Get the website indexed, add answer-friendly FAQ content and schema, and work on listings and article mentions so AI tools start recommending the brand.' } },
    ] },
    { no: '12', title: 'Tracking & Social Profiles', sub: 'Analytics setup and social media presence.', sections: [
      { num: '12.1', heading: 'Social Profiles', table: { cols: [{ label: 'Profile' }, { label: 'Status', align: 'c', width: '14%' }, { label: 'Link' }], rows: ['facebook', 'instagram', 'twitter', 'youtube', 'tiktok', 'linkedin'].map((k) => [{ text: k.charAt(0).toUpperCase() + k.slice(1), bold: true }, { badge: yn(!!f.social[k]), align: 'c' }, { text: f.social[k] || '—' }]) }, bullets: [{ kind: 'high', title: 'Current Observation', badge: 'HIGH', text: 'Analytics setup (GA4, Search Console, Bing, Tag Manager) needs to be confirmed and installed. Social profiles are shown above.' }], willdo: { text: 'Set up GA4, Search Console, Bing Webmaster Tools and Tag Manager with conversion tracking.' } },
    ] },
    { no: '13', title: 'Baseline KPIs', sub: `The starting numbers on ${meta.auditDate}. Every monthly report will update this table.`, sections: [
      { num: '13.1', heading: 'KPI Tracker', table: { cols: [{ label: 'KPI' }, { label: 'Baseline' }, { label: 'Month 1' }, { label: 'Month 3' }, { label: 'Month 6' }], rows: [
        [{ text: 'Pages indexed in Google', bold: true }, { text: f.noindex ? '0' : '—' }, { text: '' }, { text: '' }, { text: '' }],
        [{ text: 'Homepage has meta description', bold: true }, { text: f.hasMetaDesc ? 'yes' : 'no' }, { text: '' }, { text: '' }, { text: '' }],
        [{ text: 'Schema markup', bold: true }, { text: f.hasSchema ? 'yes' : 'no' }, { text: '' }, { text: '' }, { text: '' }],
        [{ text: 'Homepage size', bold: true }, { text: f.sizeMb != null ? f.sizeMb + ' MB' : '—' }, { text: '' }, { text: '' }, { text: '' }],
        [{ text: 'PageSpeed (mobile)', bold: true }, { text: perfM }, { text: '' }, { text: '' }, { text: '' }],
        [{ text: 'Social profiles linked', bold: true }, { text: String((f.socialNetworks || []).length) }, { text: '' }, { text: '' }, { text: '' }],
      ] } },
    ] },
    { no: '14', title: 'Action Plan & Approval', sub: 'What our team will do after your approval, and when.', sections: [
      { num: '14.1', heading: 'Week by Week Plan', weeks: [{ label: 'Day 0', sub: 'Approval', who: meta.shortName || 'Client', items: ['Review this report and approve the plan', 'Share website admin and Google account access'] }, ...(n.weeks || []).map((w) => ({ label: w.label, sub: w.sub, who: 'Qtonix', items: w.items }))] },
      { num: '14.2', heading: 'What We Need From You', cols: { leftTitle: 'Approval', left: ['Approval of the items in this report', 'Approval of new page content before it goes live'], rightTitle: 'Access', right: ['Website admin login', 'Hosting / DNS access', 'Any existing Analytics or Search Console accounts'] } },
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

module.exports = { buildReportData, facts };

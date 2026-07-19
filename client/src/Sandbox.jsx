import React, { useState, useEffect, useRef } from 'react';

/**
 * QTONIX SITE ANALYSIS — INTERACTIVE SANDBOX (v2)
 *
 * A working replica of the whole application, in your browser.
 * No server, no MySQL, no API keys, no credits spent.
 *
 * REAL (verbatim production code):
 *   scoring engine · opportunity maths · roadmap sort · pricing editor
 *   validation · cache rule · daily cap · role permissions
 *   all 10 report sections · PDF export (browser print engine)
 *
 * SIMULATED (no server here):
 *   SE Ranking / Claude / PageSpeed  -> deterministic fixture per domain
 *   API key "Test"                   -> validates format + simulated latency
 */

const C = { navy: '#050A1F', orange: '#FF6A00', orangeDeep: '#FF4500', blue: '#2563EB' };
const SERVICES = ['SEO', 'SMO', 'AI SEO', 'GEO', 'AEO', 'Local SEO'];

// CRM pipeline — mirrors how a sales team actually tracks a prospect.
const STAGES = [
  { id: 'new', label: 'New lead', color: '#64748B' },
  { id: 'contacted', label: 'Contacted', color: '#2563EB' },
  { id: 'interested', label: 'Interested', color: '#0891B2' },
  { id: 'proposal', label: 'Proposal sent', color: '#F59E0B' },
  { id: 'negotiation', label: 'Negotiating', color: '#FF6A00' },
  { id: 'won', label: 'Won', color: '#16A34A' },
  { id: 'lost', label: 'Lost', color: '#DC2626' },
];
const REQUESTS = ['Wants pricing', 'Wants a call', 'Needs approval', 'Comparing agencies', 'Budget constrained', 'Wants case studies', 'Ready to start', 'Follow up later'];

// ---------------------------------------------------------------------------
// REAL scoring engine — server/services/scoring.js
// ---------------------------------------------------------------------------
const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));
const CTR = { 1: 0.279, 2: 0.157, 3: 0.11, 4: 0.08, 5: 0.061, 6: 0.047, 7: 0.038, 8: 0.031, 9: 0.026, 10: 0.023 };
const ctrFor = (p) => (p <= 10 ? CTR[p] || 0.02 : p <= 20 ? 0.012 : p <= 30 ? 0.006 : 0.002);

function calcOpportunity(keywords) {
  let now = 0, pot = 0; const opps = [];
  for (const kw of keywords || []) {
    const v = +kw.volume || 0, cpc = +kw.cpc || 0, pos = +kw.position || 100;
    if (!v || !cpc) continue;
    const nc = v * ctrFor(pos), tc = v * ctrFor(Math.min(pos, 3));
    now += nc * cpc; pot += tc * cpc;
    const gap = (tc - nc) * cpc;
    if (gap > 0) opps.push({ keyword: kw.keyword, position: pos, volume: v, cpc, monthlyGap: Math.round(gap), difficulty: kw.difficulty });
  }
  opps.sort((a, b) => b.monthlyGap - a.monthlyGap);
  return { monthlyGap: Math.round(pot - now), annualGap: Math.round((pot - now) * 12), topOpportunities: opps.slice(0, 15) };
}

function scoreTechnical(c) {
  const issues = []; let s = 100;
  const ps = (c.pageSpeed && c.pageSpeed.mobile) || {};
  if (ps.performance != null) {
    if (ps.performance < 50) { s -= 25; issues.push({ severity: 'critical', title: `Mobile speed score is ${ps.performance}/100`, detail: 'Over half of visitors leave a page that takes more than 3 seconds on mobile.' }); }
    else if (ps.performance < 90) { s -= 10; issues.push({ severity: 'warning', title: `Mobile speed score is ${ps.performance}/100`, detail: 'There is measurable headroom here.' }); }
  }
  if (ps.field && ps.field.lcp > 2500) { s -= 15; issues.push({ severity: ps.field.lcp > 4000 ? 'critical' : 'warning', title: `Real visitors wait ${(ps.field.lcp / 1000).toFixed(1)}s for your main content`, detail: "Google's threshold is 2.5s. Measured from your actual traffic, not a simulation." }); }
  if (!c.https) { s -= 20; issues.push({ severity: 'critical', title: 'Site is not served over HTTPS', detail: 'Browsers mark the site "Not secure". Suppresses rankings and conversions.' }); }
  if (!c.hasViewport) { s -= 15; issues.push({ severity: 'critical', title: 'No mobile viewport tag', detail: 'Cannot render correctly on phones, where most searches happen.' }); }
  if (!c.sitemap || !c.sitemap.exists) { s -= 8; issues.push({ severity: 'warning', title: 'No XML sitemap found', detail: 'Search engines discover your pages by chance.' }); }
  if (c.blocksAiCrawlers) { s -= 12; issues.push({ severity: 'critical', title: 'robots.txt blocks AI crawlers', detail: 'GPTBot / ClaudeBot / PerplexityBot disallowed. Invisible to AI search by configuration.' }); }
  if (!c.serverRenderedContent) { s -= 12; issues.push({ severity: 'critical', title: 'Content requires JavaScript to appear', detail: 'Most AI crawlers will see an effectively blank page.' }); }
  return { score: clamp(s), issues };
}
function scoreOnPage(c) {
  const issues = []; let s = 100;
  if (!c.title) { s -= 20; issues.push({ severity: 'critical', title: 'Homepage has no title tag', detail: 'The single strongest on-page ranking signal.' }); }
  else if (c.titleLength > 60) { s -= 5; issues.push({ severity: 'notice', title: `Title is ${c.titleLength} characters`, detail: 'Google truncates past ~60. Your message is cut off.' }); }
  if (!c.metaDescription) { s -= 12; issues.push({ severity: 'warning', title: 'No meta description', detail: 'Google writes your search snippet for you — badly.' }); }
  if (c.h1Count === 0) { s -= 15; issues.push({ severity: 'critical', title: 'No H1 heading', detail: 'The page never states what it is about.' }); }
  else if (c.h1Count > 1) { s -= 5; issues.push({ severity: 'notice', title: `${c.h1Count} H1 tags found`, detail: 'Competing headings dilute the topic signal.' }); }
  if (c.imagesNoAlt > 0) { const pct = Math.round((c.imagesNoAlt / Math.max(c.imageCount, 1)) * 100); s -= Math.min(12, c.imagesNoAlt); issues.push({ severity: pct > 50 ? 'warning' : 'notice', title: `${c.imagesNoAlt} of ${c.imageCount} images have no alt text`, detail: 'Invisible to image search, screen readers, and AI crawlers.' }); }
  if (!c.canonical) { s -= 5; issues.push({ severity: 'notice', title: 'No canonical tag', detail: 'Duplicate-content risk across URL variants.' }); }
  if (!c.hasSchema) { s -= 12; issues.push({ severity: 'warning', title: 'No structured data (schema)', detail: 'Forfeits rich results; AI cannot identify your entity.' }); }
  return { score: clamp(s), issues };
}
function scoreContent(c, k) {
  const issues = []; let s = 100;
  if (c.wordCount < 300) { s -= 25; issues.push({ severity: 'critical', title: `Homepage has only ${c.wordCount} words`, detail: 'Too thin to rank for anything competitive.' }); }
  else if (c.wordCount < 600) { s -= 12; issues.push({ severity: 'warning', title: `Homepage has ${c.wordCount} words`, detail: 'Below the depth of pages that rank in this space.' }); }
  if ((k.totalKeywords || 0) === 0) { s -= 30; issues.push({ severity: 'critical', title: 'Ranking for no tracked keywords', detail: 'The site is effectively absent from search.' }); }
  else if ((k.page1Keywords || 0) === 0) { s -= 20; issues.push({ severity: 'critical', title: `Ranking for ${k.totalKeywords} keywords, none on page 1`, detail: 'Ranking on page 2+ earns almost no clicks.' }); }
  if (c.internalLinks < 10) { s -= 8; issues.push({ severity: 'warning', title: `Only ${c.internalLinks} internal links`, detail: 'Authority is not flowing between your pages.' }); }
  return { score: clamp(s), issues };
}
function scoreAuthority(b, comps) {
  const issues = []; let s = 100;
  const da = b.domainAuthority || 0;
  const avg = comps && comps.length ? Math.round(comps.reduce((x, c) => x + (c.domainAuthority || 0), 0) / comps.length) : 0;
  if (da < 10) { s -= 35; issues.push({ severity: 'critical', title: `Domain Authority is ${da}`, detail: 'Effectively no trust signal. Competitive terms are out of reach until this moves.' }); }
  else if (da < 30) { s -= 18; issues.push({ severity: 'warning', title: `Domain Authority is ${da}`, detail: 'Enough for long-tail, not for money terms.' }); }
  if (avg > 0 && da < avg - 15) { s -= 12; issues.push({ severity: 'critical', title: `Authority gap: you are ${da}, competitors average ${avg}`, detail: 'This gap, not content quality, is why they outrank you.' }); }
  if ((b.referringDomains || 0) < 20) { s -= 15; issues.push({ severity: 'warning', title: `Only ${b.referringDomains} referring domains`, detail: 'Too narrow a link base to compete.' }); }
  if ((b.toxicPercentage || 0) > 30) { s -= 20; issues.push({ severity: 'critical', title: `${b.toxicPercentage}% of referring domains look low-quality or spam`, detail: 'These add no authority and carry risk. Need auditing and disavowing.' }); }
  return { score: clamp(s), issues, competitorAverage: avg };
}
function scoreAi(ai) {
  if (!ai) return { score: null, issues: [] };
  const issues = [];
  const ov = ai.aiOverview ? (ai.aiOverview.citedCount / Math.max(1, ai.aiOverview.citedCount + ai.aiOverview.gapCount)) * 100 : 0;
  const score = clamp(ai.shareOfVoice * 0.5 + ai.readinessScore * 0.3 + ov * 0.2);
  if (ai.shareOfVoice === 0) issues.push({ severity: 'critical', title: 'Never named by AI assistants in buyer questions', detail: `Across ${ai.promptsTested} genuine buying questions, the brand was not recommended once.` });
  else if (ai.shareOfVoice < 40) issues.push({ severity: 'warning', title: `Named in only ${ai.shareOfVoice}% of buyer questions`, detail: 'Competitors are recommended in the conversations you are missing.' });
  (ai.readiness || []).forEach((c) => { if (!c.pass) issues.push({ severity: 'warning', title: c.label + ' — missing', detail: c.detail }); });
  if (ai.aiOverview && ai.aiOverview.gapCount > 0) issues.push({ severity: 'warning', title: `${ai.aiOverview.gapCount} keywords show an AI Overview that does not cite you`, detail: "Google is answering these with someone else's content." });
  return { score, issues };
}
function calcOverall(s) {
  const w = { technical: 0.2, onPage: 0.15, content: 0.2, authority: 0.25, aiVisibility: 0.15, local: 0.05 };
  let sum = 0, used = 0;
  for (const [k, ww] of Object.entries(w)) { const v = s[k] && s[k].score; if (v == null) continue; sum += v * ww; used += ww; }
  return used ? clamp(sum / used) : 0;
}
function buildRoadmap(all) {
  const eff = (t) => (/schema|alt text|meta|title|h1|robots|llms|sitemap|viewport/i.test(t) ? 1 : /speed|content|internal link|canonical/i.test(t) ? 2 : 3);
  const imp = (s) => (s === 'critical' ? 3 : s === 'warning' ? 2 : 1);
  const r = all.map((i) => ({ ...i, effort: eff(i.title), impact: imp(i.severity), priority: imp(i.severity) / eff(i.title) })).sort((a, b) => b.priority - a.priority);
  return { phase1: r.filter((i) => i.effort === 1).slice(0, 6), phase2: r.filter((i) => i.effort === 2).slice(0, 6), phase3: r.filter((i) => i.effort === 3).slice(0, 6), quickWins: r.filter((i) => i.effort === 1 && i.impact >= 2).slice(0, 3), all: r };
}

// ---------------------------------------------------------------------------
// Simulated sources — deterministic per domain
// ---------------------------------------------------------------------------
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return Math.abs(h); };
function simulate(domain, businessName) {
  const h = hash(domain);
  const rng = (min, max, salt = 0) => min + ((h + salt * 7919) % (max - min + 1));
  const refs = rng(24, 180, 2);
  const toxic = Math.round(refs * (rng(20, 55, 3) / 100));
  const quality = Math.round(refs * (rng(3, 12, 4) / 100));
  const base = businessName.toLowerCase().split(' ')[0] || 'brand';
  const words = ['premium', 'best', 'buy', 'top', 'affordable', 'online', 'near me', 'reviews'];
  const keywords = Array.from({ length: 10 }, (_, i) => ({
    keyword: `${words[i % words.length]} ${base} ${['service', 'products', 'company', 'supplier'][i % 4]}`.trim(),
    position: rng(11, 48, i + 10), volume: rng(200, 6000, i + 20),
    cpc: +(rng(60, 380, i + 30) / 100).toFixed(2), difficulty: rng(18, 68, i + 40),
  }));
  const crawl = {
    https: rng(0, 10, 7) > 1, title: `${businessName} | Official Site`, titleLength: businessName.length + 15,
    metaDescription: rng(0, 10, 8) > 5 ? 'A description.' : '', h1Count: rng(0, 2, 9), wordCount: rng(180, 1400, 11),
    imageCount: rng(8, 48, 12), imagesNoAlt: rng(2, 30, 13), canonical: rng(0, 10, 14) > 3 ? 'https://' + domain : null,
    hasViewport: rng(0, 10, 15) > 1, hasSchema: rng(0, 10, 16) > 5, serverRenderedContent: rng(0, 10, 17) > 2,
    blocksAiCrawlers: rng(0, 10, 18) > 8, internalLinks: rng(4, 40, 19), sitemap: { exists: rng(0, 10, 20) > 3 },
    pageSpeed: { mobile: { performance: rng(18, 88, 21), seo: rng(60, 96, 22), field: { lcp: rng(1800, 6200, 23) }, opportunities: [{ title: 'Properly size images', savingsMs: rng(400, 2600, 31) }, { title: 'Eliminate render-blocking resources', savingsMs: rng(300, 1800, 32) }, { title: 'Serve images in next-gen formats', savingsMs: rng(200, 1400, 33) }] }, desktop: { performance: rng(45, 98, 24) } },
  };
  const competitors = Array.from({ length: 4 }, (_, i) => ({
    domain: `competitor${i + 1}.com`, domainAuthority: rng(44, 82, i + 50), referringDomains: rng(600, 5200, i + 60),
    totalKeywords: rng(2000, 22000, i + 70), traffic: rng(9000, 190000, i + 80),
  }));
  const sov = rng(0, 3, 90) === 0 ? 0 : rng(0, 38, 91);
  const readiness = [
    { label: 'llms.txt file', pass: rng(0, 10, 92) > 8, detail: 'AI crawlers need a map of what matters on your site.' },
    { label: 'Organization / LocalBusiness schema', pass: crawl.hasSchema, detail: 'AI systems must be able to identify who you are.' },
    { label: 'FAQ / Q&A structured content', pass: rng(0, 10, 93) > 7, detail: 'Answer-formatted content is what gets quoted in AI answers.' },
    { label: 'E-E-A-T signals (author, credentials)', pass: rng(0, 10, 94) > 6, detail: 'AI weights demonstrated expertise heavily.' },
    { label: 'Content readable without JavaScript', pass: crawl.serverRenderedContent, detail: 'Most AI crawlers cannot execute JavaScript.' },
    { label: 'AI crawlers allowed in robots.txt', pass: !crawl.blocksAiCrawlers, detail: 'Blocking GPTBot/ClaudeBot makes you invisible by choice.' },
  ];
  const ai = {
    promptsTested: 8, mentions: Math.round((sov / 100) * 8), shareOfVoice: sov, readiness,
    readinessScore: Math.round((readiness.filter((r) => r.pass).length / readiness.length) * 100),
    aiOverview: { gapCount: rng(4, 32, 95), citedCount: sov > 0 ? rng(0, 4, 96) : 0 },
    rivals: [{ name: 'Competitor One', count: rng(4, 8, 97), outOf: 8 }, { name: 'Competitor Two', count: rng(2, 6, 98), outOf: 8 }, { name: 'Competitor Three', count: rng(1, 4, 99), outOf: 8 }],
    methodology: 'Assistant recall measured by asking Claude buyer-intent questions with no brand hint. AI Overview data from live Google SERP tracking.',
  };
  const keywordData = { totalKeywords: rng(30, 260, 6), page1Keywords: rng(0, 10, 25) > 7 ? rng(1, 5, 26) : 0, traffic: rng(40, 900, 5), topKeywords: keywords, strikingDistance: keywords.filter((k) => k.position >= 11 && k.position <= 20) };
  const backlinks = { total: refs * rng(3, 9, 27), referringDomains: refs, domainAuthority: rng(2, 22, 1), quality, neutral: refs - toxic - quality, toxic, sampled: refs, toxicPercentage: Math.round((toxic / refs) * 100) };
  const keywordGap = Array.from({ length: 6 }, (_, i) => ({ keyword: `${words[(i + 3) % words.length]} ${base} ${['guide', 'cost', 'near me', 'reviews'][i % 4]}`, volume: rng(800, 9000, i + 120), position: rng(1, 6, i + 130), difficulty: rng(22, 60, i + 140) }));

  // Local SEO / Google Business Profile — deterministic fixture (simulates Google Places).
  const gbpFound = rng(0, 10, 200) > 2;
  const reviewCount = rng(0, 240, 201);
  const rating = +(rng(31, 49, 202) / 10).toFixed(1);
  const daysSinceReview = rng(2, 210, 203);
  const activity = daysSinceReview <= 30 ? 'active' : daysSinceReview <= 90 ? 'slowing' : 'stale';
  const sampleReviews = [
    { author: 'A. Kumar', rating: rng(3, 5, 204), text: 'Good quality and the staff were helpful. Delivery took a little longer than expected.', relativeTime: `${rng(1, 4, 205)} weeks ago` },
    { author: 'S. Lim', rating: rng(3, 5, 206), text: 'Exactly what I ordered, fits well and comfortable for long shifts. Will buy again.', relativeTime: `${rng(1, 3, 207)} months ago` },
    { author: 'J. Rahman', rating: rng(2, 5, 208), text: 'Decent product but customer service was slow to respond to my sizing question.', relativeTime: `${rng(2, 6, 209)} months ago` },
  ];
  const local = {
    enabled: true, gbpFound,
    name: businessName,
    address: gbpFound ? `${rng(10, 240, 210)} Jalan Example, ${rng(40000, 59000, 211)} Kuala Lumpur` : null,
    phone: gbpFound ? `+60 3-${rng(2000, 8999, 212)} ${rng(1000, 9999, 213)}` : null,
    website: gbpFound ? 'https://' + domain : null,
    websiteMatches: rng(0, 10, 214) > 3,
    category: gbpFound ? 'Uniform store' : null,
    rating: gbpFound ? rating : null,
    reviewCount: gbpFound ? reviewCount : 0,
    hasHours: rng(0, 10, 215) > 4,
    businessStatus: gbpFound ? 'OPERATIONAL' : null,
    daysSinceNewestReview: gbpFound ? daysSinceReview : null,
    activitySignal: gbpFound ? activity : 'unknown',
    reviews: gbpFound ? sampleReviews : [],
    reviewSummary: gbpFound
      ? `Customers consistently praise product quality, fit and comfort for long shifts. The main recurring complaint is slower-than-expected delivery and customer-service response times. Overall sentiment is positive at ${rating}★ across ${reviewCount} reviews.`
      : null,
  };
  return { crawl, keywordData, backlinks, competitors, ai, keywords, keywordGap, local };
}

// ---------------------------------------------------------------------------
// In-browser DB — mirrors the MySQL tables
// ---------------------------------------------------------------------------
const DEFAULT_PRICING = {
  enabled: true, currency: 'USD', symbol: '$',
  intro: 'Three ways to work together — all month-to-month, no lock-in. Every package includes monthly reporting, keyword tracking and a dedicated point of contact.',
  note: 'About paid backlinks. Some high-authority backlinks carry a direct placement cost paid to the publisher — this is a direct expense you pay, separate from your package. Qtonix handles all the research, outreach, backend conversations and setup for free — no agency markup and no management charge on top.',
  guaranteeTitle: 'The risk is ours, not yours.',
  guaranteeBody: "If we don't increase your targeted traffic and enquiries within 90 days, we refund every dollar you've paid — and write you a cheque for $1,000 for your time.",
  packages: [
    { name: 'STARTER', price: '399', period: '/mo', oldPrice: '', recommended: false, badge: '', blurb: 'Getting started on a budget.', features: ['Keyword & competitor research', '2 SEO blogs / month', 'Directory submission: 12 / month', 'Social bookmarking: 8 / month', 'Profile creation: 8 / month', 'Monthly report'], starFeatures: [] },
    { name: 'GROWTH', price: '549', period: '/mo', oldPrice: '799', recommended: true, badge: 'RECOMMENDED', blurb: 'Best value — builds the pages that capture high-intent searches. Lock now = lifetime price.', features: ['Everything in Starter, plus:', '3–4 SEO blogs / month', '2 landing pages / month', 'Guest posts: 2 / month', 'Infographic submission: 8 / month', 'GMB / profile optimisation: 2 / month'], starFeatures: ['90-day money-back guarantee'] },
    { name: 'PREMIUM', price: '1,199', period: '/mo', oldPrice: '', recommended: false, badge: '', blurb: 'Maximum speed — includes link cleanup.', features: ['Everything in Growth, plus:', '8+ SEO blogs / month', '4+ landing pages / month', 'Full on-page SEO audit & fixes', 'Backlink audit & disavow', 'Competitor gap analysis'], starFeatures: ['90-day money-back guarantee'] },
  ],
};
const seedDb = () => ({
  users: [
    { id: 1, name: 'Adam G', email: 'admin@qtonix.com', password: 'password123', role: 'admin', phone: '+91-8249016547', designation: 'Project Manager', active: true, reportsRun: 0, lastLogin: null },
    { id: 2, name: 'Nancy', email: 'nancy@qtonix.com', password: 'password123', role: 'agent', phone: '+91-9000000000', designation: 'Sales Executive', active: true, reportsRun: 0, lastLogin: null },
  ],
  reports: [],
  settings: {
    companyName: 'Qtonix Software Pvt. Ltd.', companyShort: 'Qtonix', logoPath: '', faviconPath: '',
    website: 'https://www.qtonix.com', email: 'info@qtonix.com', phone: '+91-8249016547',
    colors: { ...C }, apiKeys: { seranking: '', anthropic: '', pagespeed: '', googlePlaces: '' },
    pricing: JSON.parse(JSON.stringify(DEFAULT_PRICING)),
    reportValidDays: 14, dailyReportLimit: 20, cacheDays: 7, defaultCountry: 'us',
  },
});

// ---------------------------------------------------------------------------
// UI atoms
// ---------------------------------------------------------------------------
const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent';
const Btn = ({ children, onClick, variant = 'primary', disabled, className = '', size = 'md', title }) => {
  const sz = size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-5 py-2.5 text-sm';
  const base = `rounded-lg font-bold transition disabled:opacity-40 ${sz} ${className}`;
  if (variant === 'primary') return <button title={title} onClick={onClick} disabled={disabled} className={base + ' text-white'} style={{ background: `linear-gradient(90deg,${C.orange},${C.orangeDeep})` }}>{children}</button>;
  if (variant === 'dark') return <button title={title} onClick={onClick} disabled={disabled} className={base + ' text-white'} style={{ background: C.navy }}>{children}</button>;
  return <button title={title} onClick={onClick} disabled={disabled} className={base + ' border border-slate-300 text-slate-600 hover:border-slate-400 bg-white'}>{children}</button>;
};
const Field = ({ label, hint, children }) => (
  <div><label className="block text-xs font-semibold text-slate-600 mb-1.5">{label}</label>{children}{hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}</div>
);
const Note = ({ tone = 'info', children }) => {
  const t = { info: 'bg-blue-50 border-blue-200 text-blue-800', warn: 'bg-amber-50 border-amber-200 text-amber-900', bad: 'bg-red-50 border-red-200 text-red-700', good: 'bg-green-50 border-green-200 text-green-700' }[tone];
  return <div className={`rounded-lg border px-4 py-3 text-sm ${t}`}>{children}</div>;
};
const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : n);
const money = (n) => (n >= 1e6 ? '$' + (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? '$' + Math.round(n / 1e3) + 'K' : '$' + Math.round(n));
const dt = (d) => new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// ---------------------------------------------------------------------------
// FULL REPORT — all 10 sections, print-ready
// ---------------------------------------------------------------------------
const Sec = ({ n, name, col }) => (
  <div className="flex items-center gap-2.5 text-[9px] mb-3">
    <span className="inline-block w-2 h-2 rotate-45" style={{ background: col.blue }} />
    {n && <span className="font-extrabold text-sm" style={{ color: col.blue }}>{n}</span>}
    <span className="inline-block w-8 h-px" style={{ background: col.blue }} />
    <span className="tracking-[2.6px] font-bold text-slate-500">{name}</span>
  </div>
);
const H2 = ({ a, b, col }) => (
  <h2 className="text-2xl font-extrabold tracking-tight leading-tight mb-3">{a} <span style={{ color: col.blue }}>{b}</span></h2>
);
const Stat = ({ v, l, c }) => (
  <div className="border border-slate-200 rounded-lg p-3.5">
    <div className="text-2xl font-extrabold leading-none tracking-tight whitespace-nowrap" style={{ color: c }}>{v}</div>
    <div className="text-[10px] text-slate-500 mt-2 leading-snug">{l}</div>
  </div>
);
const Tbl = ({ head, rows, col }) => (
  <table className="w-full text-xs my-3">
    <thead><tr style={{ background: col.navy }} className="text-white text-left">{head.map((h, i) => <th key={i} className="p-2.5 font-bold">{h}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i} className={i % 2 ? 'bg-slate-50' : ''}>{r.map((c, j) => <td key={j} className="p-2.5 border-b border-slate-100 align-top">{c}</td>)}</tr>)}</tbody>
  </table>
);
const Quote = ({ children, accent, col }) => (
  <div className="rounded-lg p-5 my-4 text-center" style={{ background: accent ? '#FFF4EC' : '#EEF3FF' }}>
    <span className="inline-block w-2.5 h-2.5 rotate-45 mb-3" style={{ background: accent ? col.orange : col.blue }} />
    <p className="italic text-sm" style={{ color: accent ? '#7C2D12' : '#1E293B' }}>{children}</p>
  </div>
);
const Page = ({ children, n, biz, col, short }) => (
  <div className="report-page bg-white p-9" style={{ borderBottom: '1px solid #E2E8F0' }}>
    {children}
    <div className="flex justify-between text-[9px] text-slate-400 mt-6 pt-3 border-t border-slate-100">
      <span className="tracking-[2px] font-bold">{short.toUpperCase()}</span>
      <span>{biz} · Site Analysis</span>
      <span className="font-extrabold" style={{ color: col.blue }}>{n}</span>
    </div>
  </div>
);

function FullReport({ r, settings, printRef }) {
  const col = settings.colors;
  const tone = (v, bad, good) => (v < bad ? '#E5484D' : v < good ? '#E58A24' : '#16A34A');
  const ring = (pct, rad) => { const c = 2 * Math.PI * rad; const f = (clamp(pct) / 100) * c; return `${f} ${c - f}`; };
  const sev = (s) => ({ critical: 'bg-red-100 text-red-800', warning: 'bg-amber-100 text-amber-800', notice: 'bg-indigo-100 text-indigo-800' }[s]);
  const P = { biz: r.businessName, col, short: settings.companyShort };
  const top = [...r.issues].sort((a, b) => ({ critical: 0, warning: 1, notice: 2 }[a.severity] - { critical: 0, warning: 1, notice: 2 }[b.severity]));
  const maxT = Math.max(r.keywordData.traffic, ...r.competitors.map((c) => c.traffic), 1);
  const bars = [{ label: `${r.domain} (YOU)`, v: r.keywordData.traffic, you: true }, ...r.competitors.map((c) => ({ label: c.domain, v: c.traffic, you: false }))].sort((a, b) => a.v - b.v);

  return (
    <div ref={printRef} className="report-root rounded-xl overflow-hidden border border-slate-200">
      {/* ---------- COVER ---------- */}
      <div className="report-page p-10 text-white relative" style={{ background: 'linear-gradient(180deg,#0A0E28 0%,#0435AC 100%)', minHeight: 620 }}>
        <div className="flex justify-between items-center">
          {settings.logoPath
            ? <img src={settings.logoPath} alt={settings.companyShort} style={{ height: 38, objectFit: 'contain' }} />
            : <div className="text-2xl font-extrabold">{settings.companyShort}<span style={{ color: col.orange }}>.</span></div>}
          <div className="text-[9px] tracking-[2.5px] opacity-80">SEO · AI SEO · GEO · AEO</div>
        </div>
        <div className="h-0.5 mt-5" style={{ background: col.orange }} />
        <div className="mt-3 text-[9px] tracking-[2.8px] font-bold flex items-center gap-2" style={{ color: col.orange }}>
          <span className="inline-block w-2 h-2 rotate-45" style={{ background: col.orange }} />COMPLETE SITE ANALYSIS
        </div>
        <div className="h-px mt-3 bg-white/20" />
        <h1 className="text-4xl font-extrabold mt-8 leading-tight tracking-tight" style={{ maxWidth: '68%' }}>
          {r.headline.bold}<br /><span className="font-normal text-white/70">{r.headline.light}</span>
        </h1>
        <p className="mt-5 text-sm text-white/80 leading-relaxed" style={{ maxWidth: '66%' }}>{r.headline.sub}</p>
        <div className="h-px mt-10 bg-white/20" />
        <div className="mt-5 text-[9px] tracking-[2.2px] font-bold text-white/60">PREPARED FOR</div>
        <div className="text-xl font-extrabold mt-1.5">{r.businessName} — {r.customerName}</div>
        <div className="text-xs text-white/70 mt-1">{r.domain}{r.location ? ' · ' + r.location : ''}</div>
        <div className="flex gap-2 mt-5 flex-wrap">
          {r.services.map((s) => <span key={s} className="rounded-full px-4 py-1.5 text-[11px] font-extrabold" style={{ background: col.orange, color: col.navy }}>{s}</span>)}
        </div>
        <div className="flex justify-between text-[11px] text-white/60 mt-8 pt-4 border-t border-white/10">
          <span>Prepared by <b className="text-white">{r.agentName}</b> · {settings.companyName}</span>
          <span>{new Date(r.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} · Valid {settings.reportValidDays} days</span>
        </div>
      </div>

      {/* ---------- CONTENTS ---------- */}
      <Page n="2" {...P}>
        <Sec name="CONTENTS" col={col} />
        <H2 a="What's" b="inside." col={col} />
        <p className="text-xs text-slate-600 leading-relaxed">A precise, evidence-based look at where {r.domain} stands in search today, why customers aren't finding it, and the specific plan to change that. No hype — just the data and the roadmap.</p>
        <div className="mt-6">
          {[['01', 'The Situation'], ['02', 'The Visibility Gap'], ['03', 'The Problem & The Transformation'], ['04', 'Health Scorecard'], ['05', 'Competitor & Backlink Analysis'], ['06', 'AI Search Visibility — GEO / AEO'], ['07', 'The Strategy'], ['08', 'The Fix, Measured — KPIs'], ...(settings.pricing.enabled ? [['09', 'Your Investment']] : []), [settings.pricing.enabled ? '10' : '09', "Let's Begin"]].map(([n, t]) => (
            <div key={n} className="flex gap-4 py-2.5 border-b border-slate-100">
              <span className="font-extrabold text-xs w-6" style={{ color: col.blue }}>{n}</span>
              <span className="font-bold text-xs">{t}</span>
            </div>
          ))}
        </div>
      </Page>

      {/* ---------- 01 SITUATION ---------- */}
      <Page n="3" {...P}>
        <Sec n="01" name="THE SITUATION" col={col} />
        <H2 a="The business is sound." b="The problem is nobody can find it in search." col={col} />
        <p className="text-xs text-slate-600 leading-relaxed mb-2">{r.headline.sub}</p>
        <p className="text-xs text-slate-600 leading-relaxed">Two things cause that, and both are fixable: the domain has almost no genuine authority{r.backlinks.toxicPercentage > 30 ? ` (and ${r.backlinks.toxicPercentage}% of the links it does have are spam that actively hurt)` : ''}, and the site has no pages built to rank for the high-intent searches your buyers actually make.</p>
        <div className="grid grid-cols-4 gap-2.5 mt-5">
          <Stat v={r.backlinks.domainAuthority} l={`Domain Authority — competitors average ${r.competitorAvg}`} c={tone(r.backlinks.domainAuthority, 30, 60)} />
          <Stat v={r.keywordData.page1Keywords} l="Keywords on page 1 — customers can't find you" c={tone(r.keywordData.page1Keywords, 1, 10)} />
          <Stat v={'~' + fmt(r.keywordData.traffic)} l="Est. monthly organic visits" c={col.navy} />
          <Stat v={fmt(r.crawl.wordCount)} l="Words on your homepage" c={col.navy} />
        </div>
        <h3 className="text-sm font-bold mt-5 mb-1">What we researched about your business</h3>
        <Tbl col={col} head={['Factor', 'What we found']} rows={[
          ['Industry', r.crawl.title],
          ['Website', `${r.domain} · ${r.crawl.https ? 'HTTPS secure' : 'NOT SECURE'} · ${fmt(r.crawl.wordCount)} words on homepage`],
          ['Services to market', r.services.join(', ')],
          ['Target market', (r.location ? r.location + ' · ' : '') + r.country.toUpperCase()],
          ['Competitors', r.competitors.map((c) => c.domain).join(', ')],
          ['Pain points', r.issues.filter((i) => i.severity === 'critical').slice(0, 3).map((i) => i.title).join('; ') || 'None critical'],
        ].map((x) => [<b>{x[0]}</b>, x[1]])} />
        {r.opportunity.annualGap > 0 && (
          <div className="rounded-xl p-5 mt-2 flex justify-between items-center text-white" style={{ background: 'linear-gradient(135deg,#0A0E28,#0435AC)' }}>
            <div>
              <div className="text-3xl font-extrabold tracking-tight whitespace-nowrap" style={{ color: col.orange }}>{money(r.opportunity.annualGap)}</div>
              <div className="text-[11px] opacity-75 mt-1">Estimated annual value of the organic traffic you're not capturing</div>
            </div>
            <div className="text-right"><div className="text-lg font-extrabold whitespace-nowrap">{money(r.opportunity.monthlyGap)}</div><div className="text-[11px] opacity-75">per month</div></div>
          </div>
        )}
        <Quote col={col}>Twelve keywords already sit within reach of page one. Moving those alone is the fastest measurable revenue available to you.</Quote>
        <p className="text-[9px] text-slate-400 italic leading-relaxed">A note on this data. All data is sourced from third-party tools and our own crawl of {r.domain}, as we do not currently have direct access to your Google Search Console or Analytics.</p>
      </Page>

      {/* ---------- 02 VISIBILITY GAP ---------- */}
      <Page n="4" {...P}>
        <Sec n="02" name="THE VISIBILITY GAP" col={col} />
        <H2 a="The demand is real and measurable." b="You're simply not in the results yet." col={col} />
        <p className="text-xs text-slate-600 leading-relaxed">Your buyers search these terms every day. {r.domain} ranks for {fmt(r.keywordData.totalKeywords)} keywords but holds {r.keywordData.page1Keywords} first-page positions, while competitors capture tens of thousands of visits a month.</p>
        <h3 className="text-sm font-bold mt-5 mb-1">Estimated monthly organic traffic — you vs. competitors</h3>
        <p className="text-[9px] text-slate-400 italic mb-3">Source: SE Ranking. Log scale. Your bar in blue.</p>
        {bars.map((b, i) => (
          <div key={i} className="flex items-center gap-2.5 mb-2 text-[10px]">
            <div className="w-32 text-right text-slate-600 shrink-0">{b.label}</div>
            <div className="flex-1 h-4 bg-slate-100 rounded-sm overflow-hidden">
              <div className="h-full rounded-sm" style={{ width: Math.max(3, (Math.log10(b.v + 1) / Math.log10(maxT + 1)) * 100) + '%', background: b.you ? col.blue : '#C6CBD4' }} />
            </div>
            <div className="w-12 font-extrabold">{fmt(b.v)}</div>
          </div>
        ))}
        {r.keywordData.strikingDistance.length > 0 && <>
          <h3 className="text-sm font-bold mt-5 mb-1">High-intent searches: where you rank now vs. where we'll take you</h3>
          <p className="text-[9px] text-slate-400 italic mb-2">These already sit in positions 11–20 — one push from page one.</p>
          <Tbl col={col} head={['Keyword', 'Now', 'Target', 'Searches/mo', 'Value if page 1']}
            rows={r.keywordData.strikingDistance.slice(0, 6).map((k) => {
              const gain = Math.round((k.volume * ctrFor(3) - k.volume * ctrFor(k.position)) * k.cpc);
              return [<b>{k.keyword}</b>, <span style={{ color: '#E5484D', fontWeight: 700 }}>{k.position}</span>, <span style={{ color: col.blue, fontWeight: 700 }}>{Math.max(3, Math.min(6, Math.round(k.position / 3)))}</span>, fmt(k.volume), <b>{money(gain)}/mo</b>];
            })} />
        </>}
        <Quote accent col={col}>{r.keywordData.page1Keywords === 0 ? 'You have zero keywords on page one today. From a base this low, disciplined SEO tends to show early, visible movement — there is a lot of room to climb.' : `You hold ${r.keywordData.page1Keywords} page-one positions against a category that supports far more.`}</Quote>
      </Page>

      {/* ---------- 03 PROBLEM & TRANSFORMATION ---------- */}
      <Page n="5" {...P}>
        <Sec n="03" name="PROBLEM & TRANSFORMATION" col={col} />
        <H2 a="It's fixable." b="Here's the honest diagnosis and what changes." col={col} />
        <div className="grid grid-cols-2 gap-3 mt-4">
          <div className="rounded-lg p-4" style={{ background: '#FDF2F2', border: '1px solid #FBD5D5' }}>
            <div className="text-[9px] tracking-[1.6px] font-extrabold mb-2.5" style={{ color: '#E5484D' }}>◆ THE PROBLEM TODAY</div>
            {top.slice(0, 5).map((i, j) => <div key={j} className="text-[10px] mb-2 pl-3 relative leading-relaxed"><span className="absolute left-0" style={{ color: '#E5484D' }}>•</span>{i.title}</div>)}
          </div>
          <div className="rounded-lg p-4" style={{ background: '#FFF4EC', border: '1px solid #FFD9BF' }}>
            <div className="text-[9px] tracking-[1.6px] font-extrabold mb-2.5" style={{ color: col.orangeDeep }}>✓ AFTER WE'RE DONE</div>
            {['A fast, error-free site that converts visits into enquiries.', 'Genuine, relevant authority built steadily and safely.', 'Dedicated pages targeting the exact searches your buyers make.', 'Full structured data so Google and AI know who you are.', 'A presence AI assistants can find, trust and recommend.'].map((t, j) => (
              <div key={j} className="text-[10px] mb-2 pl-3 relative leading-relaxed"><span className="absolute left-0" style={{ color: col.orangeDeep }}>•</span>{t}</div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2.5 mt-5">
          <Stat v="20–30%" l="Targeted lift in traffic & enquiries within 90 days" c={col.orangeDeep} />
          <Stat v="3" l="Phase plan: Clean-up → Build pages → Scale authority" c={col.orangeDeep} />
          <Stat v={`${Math.max(4, Math.round((r.keywordData.traffic * 4) / Math.max(r.keywordData.traffic, 1)) * 5)}x`} l="Projected targeted visits by month 12 vs. today" c={col.orangeDeep} />
          <Stat v={r.issueCounts.total} l={`Issues found — ${r.issueCounts.critical} critical`} c={col.navy} />
        </div>
        <h3 className="text-sm font-bold mt-5 mb-1">The measurable result — first 3 months</h3>
        <p className="text-xs text-slate-600 leading-relaxed">Our target for the first 90 days is a <b>20–30% increase in targeted traffic and enquiries</b>, establishing the authority and page structure for compounding growth after that.</p>
        {r.roadmap.quickWins.length > 0 && (
          <div className="rounded-lg p-4 mt-4" style={{ background: '#FFF4EC', border: '1px solid #FFD9BF' }}>
            <div className="text-[9px] tracking-[1.6px] font-extrabold mb-2.5" style={{ color: col.orangeDeep }}>◆ THREE THINGS YOU CAN FIX THIS WEEK — WITHOUT US</div>
            {r.roadmap.quickWins.map((w, j) => <div key={j} className="text-[10px] mb-2 pl-3 relative leading-relaxed"><span className="absolute left-0" style={{ color: col.orangeDeep }}>•</span><b>{w.title}</b> — {w.detail}</div>)}
          </div>
        )}
      </Page>

      {/* ---------- 04 SCORECARD ---------- */}
      <Page n="6" {...P}>
        <Sec n="04" name="HEALTH SCORECARD" col={col} />
        <H2 a="Six things decide whether you get found." b="Here's where you stand." col={col} />
        <p className="text-xs text-slate-600 leading-relaxed">Every score comes from a live measurement of {r.domain}, not an opinion. Red means it is actively costing you customers today.</p>
        <div className="text-center py-4">
          <svg width="130" height="130" viewBox="0 0 150 150" className="mx-auto">
            <circle cx="75" cy="75" r="62" fill="none" stroke="#EEF1F5" strokeWidth="13" />
            <circle cx="75" cy="75" r="62" fill="none" stroke={tone(r.scores.overall, 45, 70)} strokeWidth="13" strokeLinecap="round" strokeDasharray={ring(r.scores.overall, 62)} transform="rotate(-90 75 75)" />
            <text x="75" y="72" textAnchor="middle" fontSize="36" fontWeight="800" fill={tone(r.scores.overall, 45, 70)}>{r.scores.overall}</text>
            <text x="75" y="90" textAnchor="middle" fontSize="9" fill="#6B7280">out of 100</text>
          </svg>
          <div className="text-[9px] tracking-[2px] font-bold text-slate-500">OVERALL HEALTH SCORE</div>
        </div>
        <Tbl col={col} head={['Area', 'Score', 'What it means']} rows={r.dials.map((d) => [<b>{d.name}</b>, <span style={{ color: tone(d.score, 45, 70), fontWeight: 800, fontSize: 14 }}>{d.score}</span>, d.verdict])} />
        <h3 className="text-sm font-bold mt-5 mb-1">Your critical issues</h3>
        <Tbl col={col} head={['Severity', 'Issue', 'Why it matters']} rows={top.slice(0, 8).map((i) => [<span className={`rounded-full px-2 py-0.5 text-[8px] font-bold ${sev(i.severity)}`}>{i.severity.toUpperCase()}</span>, <b>{i.title}</b>, i.detail])} />
        {top.length > 8 && <p className="text-[9px] text-slate-400 italic">…and {top.length - 8} further issues documented in the full technical appendix, provided when we begin work.</p>}
      </Page>

      {/* ---------- 05 COMPETITOR & BACKLINK ---------- */}
      <Page n="7" {...P}>
        <Sec n="05" name="COMPETITOR & BACKLINK ANALYSIS" col={col} />
        <H2 a="Your competitors aren't better at what you do." b="They just have authority and the right pages." col={col} />
        <p className="text-xs text-slate-600 leading-relaxed">{r.competitors.slice(0, 3).map((c) => c.domain).join(', ')} outrank you because they've built genuine authority over years. Your advantage is the business itself. We turn that into rankings — on a clean, trusted domain.</p>
        <Tbl col={col} head={['Domain', 'Authority', 'Ref. domains', 'Keywords', 'Est. traffic/mo']}
          rows={[[<span><b>{r.domain}</b> <span className="rounded-full px-1.5 py-0.5 text-[8px] font-bold" style={{ background: '#FFF4EC', color: col.orangeDeep }}>YOU</span></span>, <b style={{ color: '#E5484D' }}>{r.backlinks.domainAuthority}</b>, fmt(r.backlinks.referringDomains), fmt(r.keywordData.totalKeywords), <b>{fmt(r.keywordData.traffic)}</b>],
          ...r.competitors.map((c) => [c.domain, <b>{c.domainAuthority}</b>, fmt(c.referringDomains), fmt(c.totalKeywords), fmt(c.traffic)])]} />
        <h3 className="text-sm font-bold mt-5 mb-1">Your backlink profile — {fmt(r.backlinks.sampled)} linking websites analysed</h3>
        <div className="flex gap-5 items-center my-3">
          <svg width="150" height="150" viewBox="0 0 230 230" className="shrink-0">
            {(() => {
              const CIRC = 2 * Math.PI * 84; let acc = 0;
              return [{ v: r.backlinks.quality, c: col.blue }, { v: r.backlinks.neutral, c: '#C6CBD4' }, { v: r.backlinks.toxic, c: '#E5484D' }]
                .filter((s) => s.v > 0).map((s, i) => {
                  const len = (s.v / r.backlinks.sampled) * CIRC; const off = -acc; acc += len;
                  return <circle key={i} cx="115" cy="115" r="84" fill="none" stroke={s.c} strokeWidth="40" strokeDasharray={`${len} ${CIRC - len}`} strokeDashoffset={off} transform="rotate(-90 115 115)" />;
                });
            })()}
            <circle cx="115" cy="115" r="64" fill="#fff" />
            <text x="115" y="113" textAnchor="middle" fontSize="32" fontWeight="800" fill={col.navy}>{fmt(r.backlinks.sampled)}</text>
            <text x="115" y="134" textAnchor="middle" fontSize="10" fill="#6B7280">linking sites</text>
          </svg>
          <div className="flex-1 text-xs space-y-2">
            {[['Quality (authority 40+)', r.backlinks.quality, col.blue], ['Neutral', r.backlinks.neutral, '#C6CBD4'], ['Spam / toxic (under 10)', r.backlinks.toxic, '#E5484D']].map(([l, v, c]) => (
              <div key={l} className="flex justify-between items-center border-b border-slate-100 pb-1.5">
                <span><span className="inline-block w-5 h-1.5 rounded-sm mr-2" style={{ background: c }} />{l}</span><b>{v}</b>
              </div>
            ))}
          </div>
        </div>
        {r.backlinks.toxic > 0 && (
          <div className="text-[10px] p-3 leading-relaxed" style={{ background: '#F8FAFC', borderLeft: `3px solid ${col.blue}`, color: '#475569' }}>
            <b>Priority fix — clean up the spammy backlinks.</b> {r.backlinks.toxic} of your {r.backlinks.sampled} analysed linking sites score under 10 for authority — the signature of link farms and classified directories. We audit them, file a Google disavow, and rebuild on a clean foundation.
          </div>
        )}
        <h3 className="text-sm font-bold mt-4 mb-1">Keywords they rank for and you don't</h3>
        <Tbl col={col} head={['Keyword', 'Searches/mo', 'Their position', 'Difficulty']} rows={r.keywordGap.slice(0, 6).map((k) => [<b>{k.keyword}</b>, fmt(k.volume), k.position, k.difficulty + '/100'])} />
      </Page>

      {/* ---------- 06 AI VISIBILITY ---------- */}
      <Page n="8" {...P}>
        <Sec n="06" name="AI SEARCH VISIBILITY" col={col} />
        <H2 a="Your buyers don't only ask Google anymore." b="They ask ChatGPT too." col={col} />
        <p className="text-xs text-slate-600 leading-relaxed">Customers increasingly ask ChatGPT, Google AI Overviews, Gemini, Perplexity and Claude for recommendations before they ever click. We asked an AI assistant {r.ai.promptsTested} real buying questions from your category — never mentioning your name — and recorded who it recommended.</p>
        <div className="grid grid-cols-4 gap-2.5 mt-4">
          <Stat v={`${r.ai.mentions}/${r.ai.promptsTested}`} l="Times you were recommended" c={tone(r.ai.shareOfVoice, 20, 60)} />
          <Stat v={r.ai.shareOfVoice + '%'} l="Your AI share of voice" c={tone(r.ai.shareOfVoice, 20, 60)} />
          <Stat v={r.ai.readinessScore + '%'} l="AI-readiness of your website" c={tone(r.ai.readinessScore, 40, 75)} />
          <Stat v={r.ai.aiOverview.gapCount} l="Google AI Overviews answering without you" c="#E5484D" />
        </div>
        <h3 className="text-sm font-bold mt-5 mb-1">Who the AI recommends instead</h3>
        <Tbl col={col} head={['Brand named by the AI', 'Times recommended', 'Out of']} rows={r.ai.rivals.map((v) => [<b>{v.name}</b>, v.count, v.outOf + ' questions'])} />
        <h3 className="text-sm font-bold mt-4 mb-1">Why you're being skipped</h3>
        <Tbl col={col} head={['Status', 'Signal', 'What it means']} rows={r.ai.readiness.map((c) => [<span className={`rounded-full px-2 py-0.5 text-[8px] font-bold ${c.pass ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{c.pass ? 'PASS' : 'FAIL'}</span>, <b>{c.label}</b>, c.detail])} />
        <Quote accent col={col}>{r.ai.shareOfVoice === 0 ? `Across ${r.ai.promptsTested} buying questions in your category, AI assistants recommended your competitors and never once named ${r.businessName}.` : `You were named in ${r.ai.mentions} of ${r.ai.promptsTested} buying questions. Your competitors were named in the rest.`}</Quote>
        <p className="text-[9px] text-slate-400 italic leading-relaxed">{r.ai.methodology} No one can guarantee an AI platform will mention or recommend any business. These optimisations significantly improve the likelihood that {r.businessName} is understood, trusted and surfaced.</p>
      </Page>

      {/* ---------- GOOGLE MAPS / LOCAL SEO ---------- */}
      {r.services.includes('Local SEO') && r.local && (
        <Page n="•" {...P}>
          <Sec n="◆" name="GOOGLE MAPS & LOCAL SEO" col={col} />
          {r.local.gbpFound ? (
            <>
              <H2 a="How your Google Business Profile" b="looks to a customer on the map." col={col} />
              <p className="text-xs text-slate-600 leading-relaxed">This is the profile Google shows when someone nearby searches for what you do. NAP (name, address, phone) consistency, review volume and rating, and how actively the profile is maintained all decide whether you appear in the local map pack.</p>
              <div className="grid grid-cols-4 gap-2.5 mt-4">
                <Stat v={r.local.rating} l="Average star rating" c={tone(r.local.rating * 20, 60, 80)} />
                <Stat v={fmt(r.local.reviewCount)} l="Total Google reviews" c={tone(r.local.reviewCount, 10, 50)} />
                <Stat v={r.scores.local} l="Local SEO score /100" c={tone(r.scores.local, 45, 70)} />
                <Stat v={r.local.activitySignal.toUpperCase()} l="Profile activity" c={r.local.activitySignal === 'active' ? '#16A34A' : r.local.activitySignal === 'slowing' ? '#D97706' : '#E5484D'} />
              </div>
              <h3 className="text-sm font-bold mt-4 mb-1">Your listing (NAP) as Google has it</h3>
              <Tbl col={col} head={['Field', 'Value']} rows={[
                ['Business name', r.local.name],
                ['Address', r.local.address || 'Not listed'],
                ['Phone', r.local.phone || 'Not listed'],
                ['Website on profile', r.local.website ? (r.local.websiteMatches ? r.local.website : `${r.local.website} — MISMATCH`) : 'Not listed'],
                ['Category', r.local.category || '—'],
                ['Opening hours', r.local.hasHours ? 'Listed' : 'MISSING'],
              ]} />
              {r.local.reviewSummary && (<><h3 className="text-sm font-bold mt-4 mb-1">What customers are saying</h3><Quote col={col}>{r.local.reviewSummary}</Quote></>)}
              {r.local.reviews.length > 0 && (<><h3 className="text-sm font-bold mt-4 mb-1">Recent reviews</h3><Tbl col={col} head={['Reviewer', 'Rating', 'Review', 'When']} rows={r.local.reviews.map((rv) => [rv.author, `${rv.rating}★`, rv.text, rv.relativeTime])} /></>)}
              <p className="text-[9px] text-slate-400 italic mt-2 leading-relaxed">Source: Google Places (New). Review count, rating, NAP and hours are read live from the public Google Business Profile. "Profile activity" reflects how recently the profile received new reviews — a maintenance signal, not a count of Google Posts.</p>
            </>
          ) : (
            <>
              <H2 a="You're missing from the map" b="where local buyers decide." col={col} />
              <p className="text-xs text-slate-600 leading-relaxed">We couldn't find a Google Business Profile for {r.businessName} in this location. Nearby customers searching Google Maps see your competitors, not you — and the map pack is where a large share of local buying decisions happen.</p>
            </>
          )}
        </Page>
      )}

      {/* ---------- 07 STRATEGY ---------- */}
      <Page n="9" {...P}>
        <Sec n="07" name="THE STRATEGY" col={col} />
        <H2 a="A clear plan," b="starting from a clean, credible base." col={col} />
        <p className="text-xs text-slate-600 leading-relaxed">Three phases — clean up the spam and technical issues, build the pages that capture high-intent searches, then scale genuine authority. Sorted by impact against effort, so you see movement while the slower work compounds.</p>
        {[['Your first 30 days', r.roadmap.phase1, col.navy], ['Days 30–60 — build', r.roadmap.phase2, col.blue], ['Days 60–90 — scale', r.roadmap.phase3, col.orange]].map(([title, items, c]) => (
          <div key={title}>
            <h3 className="text-sm font-bold mt-4 mb-2">{title}</h3>
            {items.map((i, j) => (
              <div key={j} className="flex gap-3 border border-slate-200 rounded-lg p-3 mb-2">
                <div className="w-6 h-6 rounded-md text-white flex items-center justify-center font-extrabold text-[10px] shrink-0" style={{ background: c, color: c === col.orange ? col.navy : '#fff' }}>{j + 1}</div>
                <div><div className="font-bold text-[11px]">{i.title}</div><div className="text-[10px] text-slate-500 mt-0.5">{i.detail}</div></div>
              </div>
            ))}
            {!items.length && <p className="text-[10px] text-slate-400 italic">Nothing critical in this phase.</p>}
          </div>
        ))}
      </Page>

      {/* ---------- 08 KPIs ---------- */}
      <Page n="10" {...P}>
        <Sec n="08" name="THE FIX, MEASURED" col={col} />
        <H2 a="We report on outcomes," b="not activity." col={col} />
        <p className="text-xs text-slate-600 leading-relaxed">You'll never get a vague "we did some SEO" update. Every month you see exactly where these numbers stand and how far they've moved.</p>
        <div className="grid grid-cols-3 gap-2.5 mt-4">
          {[['Targeted traffic', `${r.keywordData.traffic}/mo`, `${Math.max(r.keywordData.traffic * 4, 500)}+/mo`, 72],
            ['Page-1 keywords', String(r.keywordData.page1Keywords), `${Math.max(r.keywordData.page1Keywords + 40, 40)}+`, 65],
            ['Domain Authority', String(r.backlinks.domainAuthority), `${r.backlinks.domainAuthority + 15}+`, 58],
            ['AI share of voice', `${r.ai.shareOfVoice}%`, '40%+', 60],
            ['Spam backlinks', String(r.backlinks.toxic), 'Disavowed', 85],
            ['Site health', `${r.scores.overall}/100`, '85+/100', 78]].map(([l, f, t, p]) => (
            <div key={l} className="border border-slate-200 rounded-lg p-3">
              <div className="text-[8px] tracking-wider font-bold text-slate-500 mb-2">{String(l).toUpperCase()}</div>
              <div className="text-sm font-extrabold whitespace-nowrap"><span style={{ color: '#E5484D' }}>{f}</span> → <span style={{ color: col.blue }}>{t}</span></div>
              <div className="h-1 bg-slate-100 rounded-full mt-2.5 overflow-hidden"><div className="h-full rounded-full" style={{ width: p + '%', background: `linear-gradient(90deg,${col.blue},${col.orange})` }} /></div>
            </div>
          ))}
        </div>
        <p className="text-[9px] text-slate-400 italic mt-3">Targets are directional based on the strategy and current data; actual results depend on execution, budget for quality backlinks, and market conditions.</p>
        <h3 className="text-sm font-bold mt-6 mb-2">Why {settings.companyShort}</h3>
        <div className="grid grid-cols-4 gap-2.5">
          {[['13+', 'Years in digital marketing'], ['250+', 'Clients worldwide'], ['60+', 'In-house specialists'], ['1:1', 'Direct access to your strategist']].map(([v, l]) => <Stat key={l} v={v} l={l} c={col.orangeDeep} />)}
        </div>
      </Page>

      {/* ---------- 09 PRICING ---------- */}
      {settings.pricing.enabled && (
        <Page n="11" {...P}>
          <Sec n="09" name="YOUR INVESTMENT" col={col} />
          <H2 a="Simple pricing." b="Serious results." col={col} />
          <p className="text-xs text-slate-600 leading-relaxed">{settings.pricing.intro} Prices in {settings.pricing.currency}.</p>
          <div className="grid gap-3 mt-6 items-stretch" style={{ gridTemplateColumns: `repeat(${Math.min(settings.pricing.packages.length, 3)},1fr)` }}>
            {settings.pricing.packages.map((p, i) => (
              <div key={i} className="rounded-xl p-4 relative" style={{ border: p.recommended ? `2px solid ${col.blue}` : '1px solid #E5E7EB' }}>
                {p.recommended && p.badge && <div className="absolute left-1/2 -translate-x-1/2 -top-2.5 rounded-full px-3 py-1 text-[8px] font-extrabold tracking-wider whitespace-nowrap" style={{ background: col.orange, color: col.navy }}>{p.badge}</div>}
                <div className="text-[9px] tracking-[2px] font-extrabold text-slate-500 mt-1">{p.name}</div>
                <div className="text-3xl font-extrabold tracking-tight mt-2 whitespace-nowrap" style={{ color: col.blue }}>{settings.pricing.symbol}{p.price}<span className="text-xs font-medium text-slate-500">{p.period}</span></div>
                {p.oldPrice && <div className="text-xs text-slate-400 line-through mt-1">{settings.pricing.symbol}{p.oldPrice}{p.period}</div>}
                {p.blurb && <div className="text-[10px] text-slate-600 mt-3 pt-3 border-t border-slate-100 leading-relaxed">{p.blurb}</div>}
                <ul className="mt-3 space-y-1.5">
                  {p.features.map((f, j) => <li key={j} className="text-[10px] text-slate-700 flex gap-1.5"><span style={{ color: col.blue }} className="font-extrabold">✓</span>{f}</li>)}
                  {(p.starFeatures || []).map((f, j) => <li key={'s' + j} className="text-[10px] font-bold flex gap-1.5" style={{ color: col.orangeDeep }}><span style={{ color: col.orange }}>★</span>{f}</li>)}
                </ul>
              </div>
            ))}
          </div>
          {settings.pricing.note && <div className="text-[10px] p-3 mt-4 leading-relaxed" style={{ background: '#F8FAFC', borderLeft: `3px solid ${col.blue}`, color: '#475569' }}>{settings.pricing.note}</div>}
          {settings.pricing.guaranteeTitle && (
            <div className="rounded-xl p-5 mt-3 flex gap-4 items-center text-white" style={{ background: 'linear-gradient(135deg,#0A0E28,#0435AC)' }}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={col.orange} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" />
              </svg>
              <div>
                <div className="font-extrabold text-sm" style={{ color: col.orange }}>{settings.pricing.guaranteeTitle}</div>
                <div className="text-[11px] text-white/85 mt-1 leading-relaxed">{settings.pricing.guaranteeBody}</div>
              </div>
            </div>
          )}
        </Page>
      )}

      {/* ---------- 10 LET'S BEGIN ---------- */}
      <Page n={settings.pricing.enabled ? '12' : '11'} {...P}>
        <Sec n={settings.pricing.enabled ? '10' : '09'} name="LET'S BEGIN" col={col} />
        <H2 a="Ready when you are." b="Let's get customers finding you." col={col} />
        <p className="text-xs text-slate-600 leading-relaxed">Onboarding is simple and fast — you could have work underway within 24 hours of saying yes.</p>
        {[['Confirm your package', `Reply to let us know which plan fits — we recommend Growth for ${r.businessName}.`],
          ['Kickoff within 24 hours', 'We set up your dedicated group chat and send a short onboarding checklist.'],
          ['Access handover', 'You grant access to your site, Search Console and Analytics so we work with real data.'],
          ['Work begins', 'Technical fixes, backlink cleanup and the first high-intent pages go live in week one.'],
          ['First report', 'Your first report lands within days — and every week after.']].map(([t, d], j) => (
          <div key={j} className="flex gap-3 border border-slate-200 rounded-lg p-3 mb-2 mt-2">
            <div className="w-6 h-6 rounded-md text-white flex items-center justify-center font-extrabold text-[10px] shrink-0" style={{ background: col.navy }}>{j + 1}</div>
            <div><div className="font-bold text-[11px]">{t}</div><div className="text-[10px] text-slate-500 mt-0.5">{d}</div></div>
          </div>
        ))}
        <div className="rounded-xl p-7 text-center text-white mt-4" style={{ background: 'linear-gradient(135deg,#0A0E28,#0435AC)' }}>
          <div className="text-[9px] tracking-[2.6px] font-bold" style={{ color: col.orange }}>LET'S BEGIN</div>
          <h3 className="text-lg font-extrabold my-2.5">This report is free. The next 90 days are the decision.</h3>
          <p className="text-[11px] text-white/80 max-w-md mx-auto mb-4">Everything in this analysis is fixable, and most of it quickly. Reply and we'll walk you through the plan for {r.domain} — no obligation.</p>
          <div className="inline-block rounded-full px-8 py-3 font-extrabold text-sm" style={{ background: col.orange, color: col.navy }}>Reply "Let's go" to begin</div>
          <div className="text-[10px] text-white/60 mt-4 leading-relaxed">{r.agentName} · {r.agentDesignation} · {settings.companyName}<br />{r.agentPhone} · {settings.email} · {settings.website}</div>
        </div>
      </Page>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pricing editor
// ---------------------------------------------------------------------------
function PricingEditor({ settings, setSettings, say }) {
  const p = settings.pricing;
  const upd = (patch) => setSettings({ ...settings, pricing: { ...p, ...patch } });
  const updPkg = (i, patch) => { const pk = [...p.packages]; pk[i] = { ...pk[i], ...patch }; upd({ packages: pk }); };
  const setRec = (i) => upd({ packages: p.packages.map((x, j) => ({ ...x, recommended: j === i, badge: j === i ? (x.badge || 'RECOMMENDED') : '' })) });
  const addPkg = () => { upd({ packages: [...p.packages, { name: 'NEW PLAN', price: '0', period: '/mo', oldPrice: '', recommended: false, badge: '', blurb: '', features: ['Feature one'], starFeatures: [] }] }); say('Package added', 'good'); };
  const delPkg = (i) => { if (p.packages.length <= 1) return say('Keep at least one package.', 'bad'); upd({ packages: p.packages.filter((_, j) => j !== i) }); say('Package deleted', 'warn'); };
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= p.packages.length) return; const pk = [...p.packages]; [pk[i], pk[j]] = [pk[j], pk[i]]; upd({ packages: pk }); };
  const editLine = (i, k, idx, v) => { const a = [...(p.packages[i][k] || [])]; a[idx] = v; updPkg(i, { [k]: a }); };
  const addLine = (i, k) => updPkg(i, { [k]: [...(p.packages[i][k] || []), k === 'starFeatures' ? 'New guarantee' : 'New feature'] });
  const delLine = (i, k, idx) => updPkg(i, { [k]: p.packages[i][k].filter((_, j) => j !== idx) });

  return (
    <div className="space-y-5">
      <Note tone="info">Writes to the <code className="font-mono text-xs">settings.pricing</code> JSON column in MySQL and renders on the <b>Your Investment</b> page. Open any report after editing to see it.</Note>
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-sm" style={{ color: C.navy }}>Pricing page</h3>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            <input type="checkbox" checked={p.enabled} onChange={(e) => upd({ enabled: e.target.checked })} className="w-4 h-4 accent-orange-500" />Include in reports
          </label>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Currency code"><input className={inputCls} value={p.currency} onChange={(e) => upd({ currency: e.target.value })} /></Field>
          <Field label="Symbol" hint="₹, $, £, €"><input className={inputCls} value={p.symbol} onChange={(e) => upd({ symbol: e.target.value })} /></Field>
        </div>
        <div className="mt-4"><Field label="Intro line"><textarea rows={2} className={inputCls} value={p.intro} onChange={(e) => upd({ intro: e.target.value })} /></Field></div>
      </div>
      {p.packages.map((pk, i) => (
        <div key={i} className="bg-white rounded-xl p-5" style={{ border: pk.recommended ? `2px solid ${C.blue}` : '1px solid #E2E8F0' }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <input className="font-extrabold text-sm tracking-wider border-0 border-b border-dashed border-slate-300 focus:outline-none focus:border-orange-400 py-0.5" style={{ color: C.navy, width: 150 }} value={pk.name} onChange={(e) => updPkg(i, { name: e.target.value })} />
              {pk.recommended && <span className="rounded-full px-2 py-0.5 text-[9px] font-extrabold" style={{ background: C.orange, color: C.navy }}>{pk.badge || 'RECOMMENDED'}</span>}
            </div>
            <div className="flex gap-1.5">
              <Btn size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0}>↑</Btn>
              <Btn size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === p.packages.length - 1}>↓</Btn>
              {!pk.recommended && <Btn size="sm" variant="ghost" onClick={() => setRec(i)}>Make recommended</Btn>}
              <Btn size="sm" variant="ghost" onClick={() => delPkg(i)}>Delete</Btn>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <Field label="Price"><input className={inputCls} value={pk.price} onChange={(e) => updPkg(i, { price: e.target.value })} /></Field>
            <Field label="Period"><input className={inputCls} value={pk.period} onChange={(e) => updPkg(i, { period: e.target.value })} /></Field>
            <Field label="Was (strikethrough)" hint="Blank = hidden"><input className={inputCls} value={pk.oldPrice} onChange={(e) => updPkg(i, { oldPrice: e.target.value })} /></Field>
            <Field label="Badge text"><input className={inputCls} value={pk.badge} onChange={(e) => updPkg(i, { badge: e.target.value })} disabled={!pk.recommended} /></Field>
          </div>
          <div className="mt-3"><Field label="Blurb"><textarea rows={2} className={inputCls} value={pk.blurb} onChange={(e) => updPkg(i, { blurb: e.target.value })} /></Field></div>
          <div className="grid grid-cols-2 gap-4 mt-4">
            {[['features', 'Features (✓)'], ['starFeatures', 'Star features (★)']].map(([k, lbl]) => (
              <div key={k}>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-xs font-semibold text-slate-600">{lbl}</label>
                  <button onClick={() => addLine(i, k)} className="text-[11px] font-bold" style={{ color: C.blue }}>+ Add</button>
                </div>
                {(pk[k] || []).map((f, j) => (
                  <div key={j} className="flex gap-1.5 mb-1.5">
                    <input className={inputCls + ' text-xs'} value={f} onChange={(e) => editLine(i, k, j, e.target.value)} />
                    <button onClick={() => delLine(i, k, j)} className="text-slate-300 hover:text-red-500 px-1 text-lg leading-none">×</button>
                  </div>
                ))}
                {!(pk[k] || []).length && <p className="text-[11px] text-slate-400">None.</p>}
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="flex gap-2">
        <Btn variant="ghost" onClick={addPkg}>+ Add package</Btn>
        <Btn variant="ghost" onClick={() => { upd(JSON.parse(JSON.stringify(DEFAULT_PRICING))); say('Pricing reset to defaults', 'warn'); }}>Reset to defaults</Btn>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <h3 className="font-bold text-sm" style={{ color: C.navy }}>Guarantee &amp; notes</h3>
        <Field label="Guarantee title" hint="Blank hides the whole band"><input className={inputCls} value={p.guaranteeTitle} onChange={(e) => upd({ guaranteeTitle: e.target.value })} /></Field>
        <Field label="Guarantee body"><textarea rows={2} className={inputCls} value={p.guaranteeBody} onChange={(e) => upd({ guaranteeBody: e.target.value })} /></Field>
        <Field label="Note box"><textarea rows={3} className={inputCls} value={p.note} onChange={(e) => upd({ note: e.target.value })} /></Field>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export default function App() {
  const [db, setDb] = useState(seedDb);
  const [user, setUser] = useState(null);
  const [view, setView] = useState('login');
  const [adminTab, setAdminTab] = useState('pricing');
  const [active, setActive] = useState(null);
  const [log, setLog] = useState([]);
  const printRef = useRef(null);

  const say = (m, tone = 'info') => setLog((l) => [{ t: new Date().toLocaleTimeString(), m, tone }, ...l].slice(0, 50));
  const setSettings = (s) => setDb((d) => ({ ...d, settings: s }));
  useEffect(() => { say('Sandbox ready. Sign in as admin@qtonix.com / password123'); }, []);

  // ---- PDF export via the browser's own print engine. No external library,
  // works in any sandbox, and "Save as PDF" is in every print dialog.
  const downloadPdf = (rep) => {
    const el = printRef.current;
    if (!el) return say('Open the report first.', 'bad');
    const w = window.open('', '_blank');
    if (!w) return say('Popup blocked — allow popups to export the PDF.', 'bad');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>${rep.businessName.replace(/[^a-z0-9 ]/gi, '')} - Site Analysis</title>
      <script src="https://cdn.tailwindcss.com"><\/script>
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;700;800&display=swap" rel="stylesheet">
      <style>
        @page { size: Letter; margin: 0; }
        body { font-family:'Plus Jakarta Sans',system-ui,sans-serif; margin:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
        .report-page { page-break-after: always; break-after: page; }
        .report-page:last-child { page-break-after: auto; }
        .report-root { border:0 !important; border-radius:0 !important; }
        @media print { .no-print { display:none } }
      </style></head><body>
      <div class="no-print" style="position:fixed;top:0;left:0;right:0;background:#050A1F;color:#fff;padding:12px 20px;font-size:13px;z-index:99;display:flex;justify-content:space-between;align-items:center">
        <span><b>${rep.businessName} — Site Analysis</b> · choose <b>Save as PDF</b> as the destination</span>
        <button onclick="window.print()" style="background:linear-gradient(90deg,#FF6A00,#FF4500);color:#fff;border:0;padding:8px 18px;border-radius:8px;font-weight:800;cursor:pointer">Save as PDF</button>
      </div>
      <div style="height:48px" class="no-print"></div>
      ${el.outerHTML}
      <script>setTimeout(()=>window.print(),900);<\/script>
      </body></html>`);
    w.document.close();
    say(`Exporting "${rep.businessName}" — choose Save as PDF in the dialog`, 'good');
  };

  // ---- login
  const [lf, setLf] = useState({ email: 'admin@qtonix.com', password: 'password123' });
  const [lerr, setLerr] = useState('');
  const signIn = () => {
    const u = db.users.find((x) => x.email === lf.email.toLowerCase().trim());
    if (!u || u.password !== lf.password) { setLerr('Email or password is incorrect.'); say('Login rejected — ' + lf.email, 'bad'); return; }
    if (!u.active) { setLerr('This account has been deactivated.'); say('Blocked: inactive account', 'bad'); return; }
    setLerr(''); setUser(u); setView('new');
    setDb((d) => ({ ...d, users: d.users.map((x) => (x.id === u.id ? { ...x, lastLogin: new Date().toISOString() } : x)) }));
    say(`Signed in as ${u.name} (${u.role})`, 'good');
  };

  // ---- new report
  const [form, setForm] = useState({ website: '', businessName: '', customerName: '', services: ['SEO'], country: 'us', location: '' });
  const [ferr, setFerr] = useState('');
  const [prog, setProg] = useState(null);
  const STEPS = ['Reading the website', 'Checking search visibility', 'Analysing backlinks', 'Finding competitors', 'Testing AI visibility', 'Scoring and writing', 'Building the PDF'];

  const run = () => {
    setFerr('');
    if (!form.website.trim() || !form.businessName.trim() || !form.customerName.trim()) return setFerr('Website, business name and customer name are all required.');
    if (!form.services.length) return setFerr('Select at least one service.');
    let domain;
    try { domain = new URL(/^https?:\/\//i.test(form.website) ? form.website : 'https://' + form.website).hostname.replace(/^www\./, ''); }
    catch { return setFerr('That website address is not valid.'); }

    const cutoff = Date.now() - db.settings.cacheDays * 864e5;
    const cached = db.reports.find((r) => r.domain === domain && new Date(r.createdAt).getTime() > cutoff);
    if (cached) { say(`Cache hit for ${domain} — no credits spent`, 'warn'); setActive(cached); setView('preview'); return; }
    const todays = db.reports.filter((r) => r.agentId === user.id && Date.now() - new Date(r.createdAt).getTime() < 864e5).length;
    if (todays >= db.settings.dailyReportLimit) return setFerr(`You've reached your limit of ${db.settings.dailyReportLimit} reports for today.`);

    say(`Queued report for ${domain}`);
    setView('running'); setProg({ pct: 0, step: STEPS[0] });
    let i = 0;
    const tick = setInterval(() => {
      i++;
      setProg({ pct: Math.min(100, Math.round((i / 14) * 100)), step: STEPS[Math.min(Math.floor(i / 2), STEPS.length - 1)] });
      if (i < 14) return;
      clearInterval(tick);
      const sim = simulate(domain, form.businessName);
      const tech = scoreTechnical(sim.crawl), on = scoreOnPage(sim.crawl), con = scoreContent(sim.crawl, sim.keywordData);
      const auth = scoreAuthority(sim.backlinks, sim.competitors), aiS = scoreAi(sim.ai);
      const wantsLocal = form.services.includes('Local SEO');
      let localScored = { score: null, issues: [] };
      if (wantsLocal && sim.local) {
        if (!sim.local.gbpFound) {
          localScored = { score: 20, issues: [{ severity: 'critical', title: 'No Google Business Profile found', detail: 'You are absent from the map pack, where local buying decisions happen.' }] };
        } else {
          let ls = 100; const li = [];
          if ((sim.local.reviewCount || 0) < 10) { ls -= 20; li.push({ severity: 'warning', title: `Only ${sim.local.reviewCount} Google reviews`, detail: 'Review count and velocity are among the strongest map-pack factors.' }); }
          if ((sim.local.rating || 0) < 4.0) { ls -= 15; li.push({ severity: 'warning', title: `Rating is ${sim.local.rating}`, detail: 'Below 4.0 measurably suppresses calls and clicks.' }); }
          if (!sim.local.hasHours) { ls -= 8; li.push({ severity: 'notice', title: 'Opening hours missing', detail: 'Incomplete profiles rank lower.' }); }
          if (sim.local.activitySignal === 'stale') { ls -= 10; li.push({ severity: 'warning', title: 'Profile looks unmaintained', detail: 'No new reviews in over 90 days signals an inactive listing.' }); }
          localScored = { score: Math.max(0, Math.min(100, ls)), issues: li };
        }
      }
      const scores = { technical: tech, onPage: on, content: con, authority: auth, aiVisibility: aiS, local: localScored };
      const overall = calcOverall(scores);
      const issues = [...tech.issues, ...on.issues, ...con.issues, ...auth.issues, ...aiS.issues, ...(localScored.issues || [])];
      const vf = (n, s) => { const bad = s < 45, mid = s < 70; return { Technical: bad ? 'Speed and crawl problems are losing you visitors.' : mid ? 'Functional, with measurable headroom.' : 'Solid technical foundation.', 'On-Page': bad ? 'Pages are not built to rank for buyer searches.' : mid ? 'Basics there; targeting needs sharpening.' : 'Well-structured and targeted.', Content: bad ? 'Too thin to compete for anything valuable.' : mid ? 'Reasonable base, not enough depth to win.' : 'Strong competitive depth.', Authority: bad ? 'Almost no trust signal — the main brake on rankings.' : mid ? 'Enough for long-tail, not money terms.' : 'Genuine authority in your space.', 'AI Visibility': bad ? 'Effectively invisible to AI assistants.' : mid ? 'Occasionally surfaced, inconsistently.' : 'Well understood by AI systems.' }[n]; };
      const dials = [['Technical', tech.score], ['On-Page', on.score], ['Content', con.score], ['Authority', auth.score], ['AI Visibility', aiS.score]].map(([name, score]) => ({ name, score, verdict: vf(name, score) }));
      const rep = {
        id: Date.now(), agentId: user.id, agentName: user.name, agentPhone: user.phone, agentDesignation: user.designation,
        domain, website: form.website, businessName: form.businessName, customerName: form.customerName,
        services: form.services, country: form.country, location: form.location, status: 'complete',
        createdAt: new Date().toISOString(),
        stage: 'new', tags: [], remark: '',
        headline: { bold: `Be the ${form.businessName.split(' ')[0].toLowerCase()} they`, light: 'actually find.', sub: `A search visibility analysis for ${form.businessName} — built to put you in front of the customers already searching for exactly what you do.` },
        scores: { ...Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, v.score])), overall },
        dials, issues, roadmap: buildRoadmap(issues), opportunity: calcOpportunity(sim.keywords),
        competitorAvg: auth.competitorAverage, ...sim,
        issueCounts: { critical: issues.filter((x) => x.severity === 'critical').length, warning: issues.filter((x) => x.severity === 'warning').length, total: issues.length },
        creditsUsed: 1210,
      };
      setDb((d) => ({ ...d, reports: [rep, ...d.reports], users: d.users.map((u) => (u.id === user.id ? { ...u, reportsRun: u.reportsRun + 1 } : u)) }));
      setActive(rep); setView('preview');
      say(`Report complete — score ${overall}/100, ${issues.length} issues, ~1,210 credits`, 'good');
    }, 240);
  };

  const updReport = (id, patch) => {
    setDb((d) => ({ ...d, reports: d.reports.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
    setActive((a) => (a && a.id === id ? { ...a, ...patch } : a));
  };

  // ---- LOGIN
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: C.navy, fontFamily: "'Plus Jakarta Sans',system-ui,sans-serif" }}>
        <div className="w-full max-w-sm">
          <div className="text-center mb-7">
            <div className="text-3xl font-extrabold text-white tracking-tight">Qtonix<span style={{ color: C.orange }}>.</span></div>
            <p className="text-slate-400 text-xs mt-2 tracking-[2px] font-bold">SITE ANALYSIS · SANDBOX</p>
          </div>
          <div className="bg-white rounded-2xl p-7 shadow-2xl">
            <h1 className="text-xl font-bold" style={{ color: C.navy }}>Sign in</h1>
            <p className="text-sm text-slate-500 mt-1 mb-5">Everything runs in your browser. No server, no credits.</p>
            {lerr && <div className="mb-4"><Note tone="bad">{lerr}</Note></div>}
            <div className="space-y-3">
              <Field label="Email"><input className={inputCls} value={lf.email} onChange={(e) => setLf({ ...lf, email: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && signIn()} /></Field>
              <Field label="Password"><input type="password" className={inputCls} value={lf.password} onChange={(e) => setLf({ ...lf, password: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && signIn()} /></Field>
            </div>
            <div className="mt-5"><Btn onClick={signIn} className="w-full">Sign in</Btn></div>
            <div className="mt-4 pt-4 border-t border-slate-100 text-[11px] text-slate-500 space-y-1">
              <div className="font-bold text-slate-600">Test accounts — click to fill</div>
              <button onClick={() => setLf({ email: 'admin@qtonix.com', password: 'password123' })} className="block hover:text-orange-600">admin@qtonix.com / password123 <span className="text-slate-400">— admin</span></button>
              <button onClick={() => setLf({ email: 'nancy@qtonix.com', password: 'password123' })} className="block hover:text-orange-600">nancy@qtonix.com / password123 <span className="text-slate-400">— agent</span></button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isAdmin = user.role === 'admin';
  const nav = [{ id: 'new', label: 'New report' }, { id: 'list', label: isAdmin ? 'All reports' : 'My reports' }, ...(isAdmin ? [{ id: 'admin', label: 'Admin' }] : [])];
  const visible = db.reports.filter((r) => isAdmin || r.agentId === user.id);

  return (
    <div className="min-h-screen bg-slate-50" style={{ fontFamily: "'Plus Jakarta Sans',system-ui,sans-serif" }}>
      <header style={{ background: C.navy }}>
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-7">
            <div className="flex items-center gap-2">
              {db.settings.faviconPath && <img src={db.settings.faviconPath} alt="" style={{ width: 18, height: 18, objectFit: 'contain' }} />}
              <div className="text-lg font-extrabold text-white tracking-tight">Qtonix<span style={{ color: C.orange }}>.</span><span className="ml-2 text-[9px] font-bold text-slate-400 tracking-[2px]">SANDBOX</span></div>
            </div>
            <nav className="flex gap-1">
              {nav.map((n) => (
                <button key={n.id} onClick={() => { setView(n.id); setActive(null); }} className={`rounded-md px-3 py-1.5 text-xs font-bold transition ${view === n.id ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'}`}>{n.label}</button>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right"><div className="text-xs font-semibold text-white">{user.name}</div><div className="text-[10px] text-slate-400">{user.designation}</div></div>
            <button onClick={() => { setUser(null); setView('login'); say('Signed out'); }} className="text-xs font-bold text-slate-400 hover:text-white">Sign out</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-7">
        {/* NEW */}
        {view === 'new' && (
          <div className="max-w-2xl">
            <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: C.navy }}>Run a site analysis</h1>
            <p className="text-sm text-slate-500 mt-1 mb-5">Enter any website. The scoring engine is the real one — only the API calls are simulated.</p>
            {ferr && <div className="mb-4"><Note tone="bad">{ferr}</Note></div>}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
              <Field label="Website *" hint="Try zuenascrubs.com — then run it again to see the cache rule fire."><input className={inputCls} value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="example.com" /></Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Business name *"><input className={inputCls} value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} placeholder="Zuena" /></Field>
                <Field label="Customer name *"><input className={inputCls} value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} placeholder="Linda" /></Field>
              </div>
              <Field label="Services the customer might want *" hint="Shapes the roadmap. AI visibility is always tested.">
                <div className="flex flex-wrap gap-2">
                  {SERVICES.map((s) => {
                    const on = form.services.includes(s);
                    return <button key={s} onClick={() => setForm({ ...form, services: on ? form.services.filter((x) => x !== s) : [...form.services, s] })}
                      className={`rounded-full px-4 py-1.5 text-xs font-extrabold border transition ${on ? 'border-transparent' : 'border-slate-300 text-slate-500 hover:border-slate-400'}`}
                      style={on ? { background: `linear-gradient(90deg,${C.orange},${C.orangeDeep})`, color: C.navy } : {}}>{s}</button>;
                  })}
                </div>
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Target market"><select className={inputCls} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}>{[['us', 'United States'], ['uk', 'United Kingdom'], ['in', 'India'], ['au', 'Australia'], ['ca', 'Canada'], ['my', 'Malaysia'], ['sg', 'Singapore'], ['ae', 'United Arab Emirates'], ['de', 'Germany'], ['nz', 'New Zealand'], ['ie', 'Ireland'], ['za', 'South Africa'], ['fr', 'France'], ['es', 'Spain'], ['it', 'Italy'], ['nl', 'Netherlands'], ['be', 'Belgium'], ['ch', 'Switzerland'], ['at', 'Austria'], ['se', 'Sweden'], ['no', 'Norway'], ['dk', 'Denmark'], ['fi', 'Finland'], ['pt', 'Portugal'], ['pl', 'Poland'], ['br', 'Brazil'], ['mx', 'Mexico'], ['ar', 'Argentina'], ['jp', 'Japan'], ['kr', 'South Korea'], ['id', 'Indonesia'], ['ph', 'Philippines'], ['th', 'Thailand'], ['vn', 'Vietnam'], ['sa', 'Saudi Arabia'], ['qa', 'Qatar']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
                <Field label="Location (optional)"><input className={inputCls} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Kuala Lumpur" /></Field>
              </div>
              <div className="flex justify-between items-center pt-3 border-t border-slate-100">
                <span className="text-[11px] text-slate-400">Running as <b className="text-slate-600">{user.name}</b></span>
                <Btn onClick={run}>Generate report</Btn>
              </div>
            </div>
          </div>
        )}

        {/* RUNNING */}
        {view === 'running' && prog && (
          <div className="max-w-lg">
            <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: C.navy }}>Building the report</h1>
            <p className="text-sm text-slate-500 mt-1 mb-5">Crawling, pulling search data, testing AI visibility.</p>
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full transition-all duration-300" style={{ width: prog.pct + '%', background: `linear-gradient(90deg,${C.blue},${C.orange})` }} /></div>
              <div className="flex justify-between mt-3"><span className="text-xs font-bold text-slate-600">{prog.step}</span><span className="text-xs font-extrabold" style={{ color: C.orange }}>{prog.pct}%</span></div>
              <div className="mt-5 space-y-1.5">
                {STEPS.map((s, i) => {
                  const cur = Math.min(Math.floor((prog.pct / 100) * 14 / 2), STEPS.length - 1);
                  return <div key={s} className={`flex items-center gap-2.5 text-xs ${i < cur ? 'text-green-600' : i === cur ? 'font-bold' : 'text-slate-400'}`} style={i === cur ? { color: C.navy } : {}}>
                    <span className="w-2 h-2 rounded-full" style={{ background: i < cur ? '#16A34A' : i === cur ? C.orange : '#CBD5E1' }} />{i < cur ? '✓ ' : ''}{s}</div>;
                })}
              </div>
            </div>
          </div>
        )}

        {/* PREVIEW */}
        {view === 'preview' && active && (
          <div>
            <div className="flex justify-between items-start mb-4 flex-wrap gap-3">
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: C.navy }}>{active.businessName} — Site Analysis</h1>
                <p className="text-sm text-slate-500 mt-0.5">Score {active.scores.overall}/100 · {active.issueCounts.total} issues · {fmt(active.creditsUsed)} credits · {dt(active.createdAt)}</p>
              </div>
              <div className="flex gap-2">
                <Btn variant="ghost" onClick={() => setView('list')}>Back to reports</Btn>
                <Btn variant="dark" onClick={() => downloadPdf(active)}>↓ Download PDF</Btn>
              </div>
            </div>
            <Note tone="warn"><b>Download PDF</b> opens a print view — choose <b>Save as PDF</b> as the destination. On your server this step is automatic (WeasyPrint renders it server-side); browsers can't write a file silently without a user gesture.</Note>
            <div className="mt-4"><FullReport r={active} settings={db.settings} printRef={printRef} /></div>
          </div>
        )}

        {/* LIST */}
        {view === 'list' && (
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight mb-1" style={{ color: C.navy }}>{isAdmin ? 'All reports' : 'My reports'}</h1>
            <p className="text-sm text-slate-500 mb-5">{visible.length} total</p>
            {!visible.length ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                <p className="text-slate-500 text-sm font-medium">No reports yet</p>
                <p className="text-slate-400 text-xs mt-1">Run your first analysis to see it here.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {visible.map((r) => {
                  const st = STAGES.find((s) => s.id === r.stage) || STAGES[0];
                  return (
                    <div key={r.id} className="bg-white rounded-xl border border-slate-200 p-4">
                      <div className="flex justify-between items-start gap-4 flex-wrap">
                        <div className="flex items-center gap-4">
                          <div className="text-center shrink-0">
                            <div className="text-2xl font-extrabold leading-none" style={{ color: r.scores.overall >= 65 ? '#16A34A' : r.scores.overall >= 45 ? '#E58A24' : '#E5484D' }}>{r.scores.overall}</div>
                            <div className="text-[8px] text-slate-400 font-bold tracking-wider mt-0.5">SCORE</div>
                          </div>
                          <div>
                            <div className="font-bold text-sm" style={{ color: C.navy }}>{r.businessName} <span className="text-slate-400 font-normal">— {r.customerName}</span></div>
                            <div className="text-xs text-slate-500 mt-0.5">{r.domain}</div>
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                              <span className="text-[10px] text-slate-400">{dt(r.createdAt)}</span>
                              {isAdmin && <span className="text-[10px] text-slate-400">· {r.agentName}</span>}
                              {r.services.map((s) => <span key={s} className="rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: '#FFF4EC', color: C.orangeDeep }}>{s}</span>)}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <select value={r.stage} onChange={(e) => { updReport(r.id, { stage: e.target.value }); say(`${r.businessName} → ${STAGES.find((s) => s.id === e.target.value).label}`, 'good'); }}
                            className="rounded-full px-3 py-1 text-[10px] font-extrabold border-0 cursor-pointer text-white" style={{ background: st.color }}>
                            {STAGES.map((s) => <option key={s.id} value={s.id} style={{ background: '#fff', color: '#000' }}>{s.label}</option>)}
                          </select>
                          <Btn size="sm" variant="ghost" onClick={() => { setActive(r); setView('preview'); }}>View</Btn>
                          <Btn size="sm" variant="dark" onClick={() => { setActive(r); setView('preview'); setTimeout(() => downloadPdf(r), 400); }}>↓ PDF</Btn>
                        </div>
                      </div>

                      {/* CRM: tags + remark */}
                      <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-[10px] font-bold text-slate-500 mb-1.5">What they asked for</div>
                          <div className="flex flex-wrap gap-1.5">
                            {REQUESTS.map((t) => {
                              const on = (r.tags || []).includes(t);
                              return <button key={t} onClick={() => updReport(r.id, { tags: on ? r.tags.filter((x) => x !== t) : [...(r.tags || []), t] })}
                                className={`rounded-full px-2.5 py-1 text-[9px] font-bold border transition ${on ? 'text-white border-transparent' : 'text-slate-500 border-slate-200 hover:border-slate-400'}`}
                                style={on ? { background: C.blue } : {}}>{t}</button>;
                            })}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-bold text-slate-500 mb-1.5">Remark</div>
                          <textarea rows={2} value={r.remark || ''} placeholder="Call notes, next step, objection…"
                            onChange={(e) => updReport(r.id, { remark: e.target.value })}
                            className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400" />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ADMIN */}
        {view === 'admin' && isAdmin && (
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight mb-4" style={{ color: C.navy }}>Admin</h1>
            <div className="flex gap-1 mb-5 border-b border-slate-200 flex-wrap">
              {[['pricing', 'Pricing'], ['branding', 'Branding'], ['keys', 'API keys'], ['users', 'Users'], ['limits', 'Limits']].map(([id, l]) => (
                <button key={id} onClick={() => setAdminTab(id)} className="px-4 py-2 text-xs font-bold border-b-2 transition" style={{ borderColor: adminTab === id ? C.orange : 'transparent', color: adminTab === id ? C.navy : '#94A3B8' }}>{l}</button>
              ))}
            </div>

            {adminTab === 'pricing' && <PricingEditor settings={db.settings} setSettings={setSettings} say={say} />}
            {adminTab === 'branding' && <Branding settings={db.settings} setSettings={setSettings} say={say} />}
            {adminTab === 'keys' && <ApiKeys settings={db.settings} setSettings={setSettings} say={say} />}
            {adminTab === 'users' && <Users db={db} setDb={setDb} me={user} say={say} />}
            {adminTab === 'limits' && (
              <div className="max-w-2xl bg-white rounded-xl border border-slate-200 p-5 grid grid-cols-2 gap-4">
                <Field label="Reports per agent per day" hint="Stops a runaway credit bill"><input type="number" className={inputCls} value={db.settings.dailyReportLimit} onChange={(e) => setSettings({ ...db.settings, dailyReportLimit: +e.target.value })} /></Field>
                <Field label="Cache the same domain for (days)" hint="Re-running inside this window is free"><input type="number" className={inputCls} value={db.settings.cacheDays} onChange={(e) => setSettings({ ...db.settings, cacheDays: +e.target.value })} /></Field>
                <Field label="Report valid for (days)" hint="Printed on the cover — a decay clock"><input type="number" className={inputCls} value={db.settings.reportValidDays} onChange={(e) => setSettings({ ...db.settings, reportValidDays: +e.target.value })} /></Field>
                <Field label="Default market"><input className={inputCls} value={db.settings.defaultCountry} onChange={(e) => setSettings({ ...db.settings, defaultCountry: e.target.value })} /></Field>
              </div>
            )}
          </div>
        )}
      </main>

      <div className="max-w-7xl mx-auto px-6 pb-8">
        <details className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <summary className="px-4 py-2.5 text-xs font-bold cursor-pointer select-none" style={{ color: C.navy }}>Activity log <span className="text-slate-400 font-normal">({log.length})</span></summary>
          <div className="border-t border-slate-100 max-h-44 overflow-auto">
            {log.map((l, i) => (
              <div key={i} className="px-4 py-1.5 text-[11px] flex gap-3 border-b border-slate-50">
                <span className="text-slate-400 font-mono shrink-0">{l.t}</span>
                <span style={{ color: l.tone === 'bad' ? '#DC2626' : l.tone === 'good' ? '#16A34A' : l.tone === 'warn' ? '#D97706' : '#475569' }}>{l.m}</span>
              </div>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin: Branding (logo + favicon upload)
// ---------------------------------------------------------------------------
function Branding({ settings, setSettings, say }) {
  const read = (file, key, maxKb) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|svg\+xml|webp|x-icon|vnd\.microsoft\.icon)$/.test(file.type)) return say('Upload a PNG, JPG, SVG, WEBP or ICO.', 'bad');
    if (file.size > maxKb * 1024) return say(`That file is ${Math.round(file.size / 1024)}KB — the limit is ${maxKb}KB.`, 'bad');
    const fr = new FileReader();
    fr.onload = () => { setSettings({ ...settings, [key]: fr.result }); say(`${key === 'logoPath' ? 'Logo' : 'Favicon'} uploaded (${Math.round(file.size / 1024)}KB)`, 'good'); };
    fr.readAsDataURL(file);
  };

  return (
    <div className="max-w-2xl space-y-5">
      <Note tone="info">On the server these upload to <code className="font-mono text-xs">/storage/uploads</code> and the path is saved to MySQL. Here they're read into memory as data URLs — nothing leaves your browser.</Note>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="font-bold text-sm mb-4" style={{ color: C.navy }}>Logo</h3>
        <div className="flex items-center gap-5 p-4 rounded-lg" style={{ background: C.navy }}>
          <div className="w-36 h-14 rounded flex items-center justify-center bg-white/5 shrink-0">
            {settings.logoPath ? <img src={settings.logoPath} alt="Logo" style={{ maxHeight: 40, maxWidth: 130, objectFit: 'contain' }} /> : <span className="text-lg font-extrabold text-white">Qtonix<span style={{ color: C.orange }}>.</span></span>}
          </div>
          <div>
            <label className="inline-block rounded-md bg-white/10 px-3 py-1.5 text-xs font-bold text-white cursor-pointer hover:bg-white/20">
              {settings.logoPath ? 'Replace logo' : 'Upload logo'}
              <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden" onChange={(e) => read(e.target.files[0], 'logoPath', 3072)} />
            </label>
            {settings.logoPath && <button onClick={() => { setSettings({ ...settings, logoPath: '' }); say('Logo removed', 'warn'); }} className="ml-2 text-xs font-bold text-slate-400 hover:text-white">Remove</button>}
            <p className="text-[10px] text-slate-400 mt-1.5">PNG, JPG, SVG or WEBP · max 3MB · a light/transparent logo works best on the navy cover</p>
          </div>
        </div>
        <p className="text-[11px] text-slate-400 mt-2">Appears top-left on every report cover. Open a report after uploading to see it.</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="font-bold text-sm mb-4" style={{ color: C.navy }}>Favicon</h3>
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 rounded border border-slate-200 flex items-center justify-center bg-slate-50 shrink-0">
            {settings.faviconPath ? <img src={settings.faviconPath} alt="Favicon" style={{ maxHeight: 32, maxWidth: 32, objectFit: 'contain' }} /> : <span className="text-[9px] text-slate-400">None</span>}
          </div>
          <div>
            <label className="inline-block rounded-md border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 cursor-pointer hover:border-slate-400">
              {settings.faviconPath ? 'Replace favicon' : 'Upload favicon'}
              <input type="file" accept="image/png,image/x-icon,image/svg+xml,image/vnd.microsoft.icon" className="hidden" onChange={(e) => read(e.target.files[0], 'faviconPath', 512)} />
            </label>
            {settings.faviconPath && <button onClick={() => { setSettings({ ...settings, faviconPath: '' }); say('Favicon removed', 'warn'); }} className="ml-2 text-xs font-bold text-slate-400 hover:text-slate-600">Remove</button>}
            <p className="text-[10px] text-slate-400 mt-1.5">ICO, PNG or SVG · 32×32 or 64×64 · max 512KB · used for the portal browser tab</p>
          </div>
        </div>
        {settings.faviconPath && <p className="text-[11px] text-slate-400 mt-3">Showing in the header, top-left.</p>}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="font-bold text-sm mb-4" style={{ color: C.navy }}>Report colours</h3>
        <div className="grid grid-cols-4 gap-3">
          {[['navy', 'Navy'], ['orange', 'Orange'], ['orangeDeep', 'Orange deep'], ['blue', 'Blue']].map(([k, l]) => (
            <div key={k}>
              <div className="flex gap-2">
                <input type="color" value={settings.colors[k]} onChange={(e) => setSettings({ ...settings, colors: { ...settings.colors, [k]: e.target.value } })} className="h-9 w-9 rounded border border-slate-300 cursor-pointer" />
                <input className={inputCls + ' font-mono text-xs'} value={settings.colors[k]} onChange={(e) => setSettings({ ...settings, colors: { ...settings.colors, [k]: e.target.value } })} />
              </div>
              <p className="text-[10px] text-slate-400 mt-1">{l}</p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 mt-3">Change orange and open a report — the whole document follows.</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 grid grid-cols-2 gap-4">
        <Field label="Company name"><input className={inputCls} value={settings.companyName} onChange={(e) => setSettings({ ...settings, companyName: e.target.value })} /></Field>
        <Field label="Short name" hint="Used in the report footer"><input className={inputCls} value={settings.companyShort} onChange={(e) => setSettings({ ...settings, companyShort: e.target.value })} /></Field>
        <Field label="Website"><input className={inputCls} value={settings.website} onChange={(e) => setSettings({ ...settings, website: e.target.value })} /></Field>
        <Field label="Phone"><input className={inputCls} value={settings.phone} onChange={(e) => setSettings({ ...settings, phone: e.target.value })} /></Field>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin: API keys — the Test button actually validates
// ---------------------------------------------------------------------------
function ApiKeys({ settings, setSettings, say }) {
  const [tests, setTests] = useState({});

  // Real format rules, so a typo or a wrong-service paste is caught here rather
  // than halfway through a client's report.
  const RULES = {
    seranking: { label: 'SE Ranking', required: true, hint: 'Rankings, backlinks, competitors, AI Overview data', min: 20, check: (k) => (/\s/.test(k) ? 'Key contains a space — check for a copy/paste error.' : k.length < 20 ? 'Too short for an SE Ranking key.' : null) },
    anthropic: { label: 'Claude (Anthropic)', required: true, hint: 'AI visibility test, cover tagline, executive summary', min: 20, check: (k) => (!k.startsWith('sk-ant-') ? 'Anthropic keys start with "sk-ant-". This looks like a different service.' : k.length < 30 ? 'Too short for an Anthropic key.' : null) },
    pagespeed: { label: 'Google PageSpeed', required: false, hint: 'Free, 25k/day. Real-visitor Core Web Vitals', min: 30, check: (k) => (!k.startsWith('AIza') ? 'Google API keys start with "AIza".' : k.length < 35 ? 'Too short for a Google API key.' : null) },
    googlePlaces: { label: 'Google Places', required: false, hint: 'Only needed for the Local SEO section', min: 30, check: (k) => (!k.startsWith('AIza') ? 'Google API keys start with "AIza".' : null) },
  };

  const test = (id) => {
    const key = (settings.apiKeys[id] || '').trim();
    if (!key) { setTests((t) => ({ ...t, [id]: { ok: false, msg: 'No key entered.' } })); say(`${RULES[id].label}: no key to test`, 'bad'); return; }
    setTests((t) => ({ ...t, [id]: { testing: true } }));
    // Simulated round trip. On the server this hits the live endpoint.
    setTimeout(() => {
      const err = RULES[id].check(key);
      const res = err ? { ok: false, msg: err } : { ok: true, msg: `Format valid (${key.length} chars, ends …${key.slice(-4)}). On the server this calls the live API to confirm.` };
      setTests((t) => ({ ...t, [id]: res }));
      say(`${RULES[id].label}: ${err || 'format valid'}`, err ? 'bad' : 'good');
    }, 700);
  };

  return (
    <div className="max-w-2xl space-y-4">
      <Note tone="warn">In the real app these are AES-256-GCM encrypted before they touch MySQL, and the API only ever returns a masked hint. Nothing you type here leaves your browser — <b>Test</b> checks the key's format, which is what catches most mistakes.</Note>
      {Object.entries(RULES).map(([id, r]) => {
        const t = tests[id];
        return (
          <div key={id} className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <label className="text-xs font-semibold text-slate-600">{r.label}</label>
              {r.required && <span className="rounded bg-red-50 text-red-600 px-1.5 py-0.5 text-[8px] font-bold">REQUIRED</span>}
            </div>
            <div className="flex gap-2">
              <input type="password" className={inputCls} value={settings.apiKeys[id]} placeholder="Paste key…" onChange={(e) => { setSettings({ ...settings, apiKeys: { ...settings.apiKeys, [id]: e.target.value } }); setTests((x) => ({ ...x, [id]: null })); }} />
              <Btn size="sm" variant="ghost" onClick={() => test(id)} disabled={t && t.testing}>{t && t.testing ? 'Testing…' : 'Test'}</Btn>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">{r.hint}</p>
            {t && !t.testing && (
              <div className={`mt-2 text-[11px] font-medium ${t.ok ? 'text-green-600' : 'text-red-600'}`}>{t.ok ? '✓ ' : '✗ '}{t.msg}</div>
            )}
          </div>
        );
      })}
      <div className="flex gap-2">
        <Btn variant="ghost" onClick={() => { setSettings({ ...settings, apiKeys: { seranking: 'ser_demo_1234567890abcdef', anthropic: 'sk-ant-api03-demo1234567890abcdefghij', pagespeed: 'AIzaSyDemo1234567890abcdefghijklmnop', googlePlaces: '' } }); setTests({}); say('Sample keys filled — press Test on each', 'info'); }}>Fill sample keys</Btn>
        <Btn variant="ghost" onClick={() => { setSettings({ ...settings, apiKeys: { seranking: '', anthropic: '', pagespeed: '', googlePlaces: '' } }); setTests({}); say('Keys cleared', 'warn'); }}>Clear all</Btn>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin: Users — with the add form
// ---------------------------------------------------------------------------
function Users({ db, setDb, me, say }) {
  const blank = { name: '', email: '', password: '', role: 'agent', phone: '', designation: 'Sales Executive' };
  const [f, setF] = useState(blank);
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(null);

  const create = () => {
    setErr('');
    if (!f.name.trim() || !f.email.trim() || !f.password) return setErr('Name, email and password are all required.');
    if (f.password.length < 8) return setErr('Password must be at least 8 characters.');
    if (!/^\S+@\S+\.\S+$/.test(f.email)) return setErr('That email address is not valid.');
    if (db.users.some((u) => u.email === f.email.toLowerCase().trim())) return setErr('That email is already registered.');
    const u = { ...f, id: Math.max(...db.users.map((x) => x.id)) + 1, email: f.email.toLowerCase().trim(), active: true, reportsRun: 0, lastLogin: null };
    setDb((d) => ({ ...d, users: [...d.users, u] }));
    setF(blank); setShow(false); say(`User created: ${u.name} (${u.role})`, 'good');
  };

  const save = () => {
    if (edit.password && edit.password.length < 8) return setErr('Password must be at least 8 characters.');
    setDb((d) => ({ ...d, users: d.users.map((u) => (u.id === edit.id ? { ...u, ...edit } : u)) }));
    say(`Updated ${edit.name}`, 'good'); setEdit(null);
  };

  const toggle = (u) => {
    if (u.id === me.id) return say('You cannot deactivate your own account.', 'bad');
    setDb((d) => ({ ...d, users: d.users.map((x) => (x.id === u.id ? { ...x, active: !x.active } : x)) }));
    say(`${u.name} ${u.active ? 'deactivated' : 'reactivated'}`, 'warn');
  };

  return (
    <div className="max-w-4xl">
      {err && <div className="mb-4"><Note tone="bad">{err}</Note></div>}
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-slate-500">{db.users.filter((u) => u.active).length} active · {db.users.length} total</p>
        <Btn onClick={() => { setShow(!show); setErr(''); }}>{show ? 'Cancel' : '+ Add user'}</Btn>
      </div>

      {show && (
        <div className="bg-white rounded-xl border-2 p-5 mb-5" style={{ borderColor: C.orange }}>
          <h3 className="font-bold text-sm mb-4" style={{ color: C.navy }}>New user</h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name *"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Nancy" /></Field>
            <Field label="Email *"><input className={inputCls} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="nancy@qtonix.com" /></Field>
            <Field label="Password *" hint="At least 8 characters"><input type="password" className={inputCls} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
            <Field label="Phone" hint="Appears on their report covers"><input className={inputCls} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+91-…" /></Field>
            <Field label="Designation"><input className={inputCls} value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} /></Field>
            <Field label="Role"><select className={inputCls} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="agent">Sales agent</option><option value="admin">Admin</option></select></Field>
          </div>
          <div className="flex justify-end mt-4"><Btn variant="dark" onClick={create}>Create user</Btn></div>
        </div>
      )}

      {edit && (
        <div className="bg-white rounded-xl border-2 p-5 mb-5" style={{ borderColor: C.blue }}>
          <h3 className="font-bold text-sm mb-4" style={{ color: C.navy }}>Edit {edit.name}</h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name"><input className={inputCls} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Phone"><input className={inputCls} value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label="Designation"><input className={inputCls} value={edit.designation} onChange={(e) => setEdit({ ...edit, designation: e.target.value })} /></Field>
            <Field label="Role">
              <select className={inputCls} value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })} disabled={edit.id === me.id}>
                <option value="agent">Sales agent</option><option value="admin">Admin</option>
              </select>
            </Field>
            <Field label="New password" hint="Leave blank to keep the current one"><input type="password" className={inputCls} value={edit.password || ''} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></Field>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Btn variant="ghost" onClick={() => setEdit(null)}>Cancel</Btn>
            <Btn variant="dark" onClick={save}>Save changes</Btn>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr className="text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            <th className="px-4 py-3">Name</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Role</th>
            <th className="px-4 py-3">Reports</th><th className="px-4 py-3">Last login</th><th className="px-4 py-3"></th>
          </tr></thead>
          <tbody>
            {db.users.map((u) => (
              <tr key={u.id} className={`border-t border-slate-100 ${!u.active ? 'opacity-40' : ''}`}>
                <td className="px-4 py-3">
                  <div className="font-semibold" style={{ color: C.navy }}>{u.name} {u.id === me.id && <span className="text-[9px] font-bold text-slate-400">(you)</span>}</div>
                  <div className="text-[11px] text-slate-400">{u.designation}{u.phone ? ' · ' + u.phone : ''}</div>
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">{u.email}</td>
                <td className="px-4 py-3"><span className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase" style={u.role === 'admin' ? { background: '#FFF4EC', color: C.orangeDeep } : { background: '#F1F5F9', color: '#64748B' }}>{u.role}</span></td>
                <td className="px-4 py-3 text-xs font-semibold">{u.reportsRun}</td>
                <td className="px-4 py-3 text-[11px] text-slate-400">{u.lastLogin ? dt(u.lastLogin) : 'Never'}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex gap-1.5 justify-end">
                    <Btn size="sm" variant="ghost" onClick={() => { setEdit({ ...u, password: '' }); setErr(''); }}>Edit</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => toggle(u)}>{u.active ? 'Deactivate' : 'Reactivate'}</Btn>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-400 mt-3">Deactivating is a soft delete — their reports are preserved and keep working.</p>
    </div>
  );
}

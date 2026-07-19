/**
 * Render test with realistic fixture data.
 * Mirrors the exact shape runReport.js produces, so if this renders, the real
 * pipeline renders.
 */
const fs = require('fs/promises');
const path = require('path');
const { renderHtml } = require('./services/renderer');
const scoring = require('./services/scoring');

// A plausible small-business profile: strong offering, invisible in search.
const crawl = {
  finalUrl: 'https://zuenascrubs.com/',
  statusCode: 200,
  https: true,
  responseMs: 1840,
  title: 'Zuena | Premium Medical Scrubs for Healthcare Professionals',
  titleLength: 58,
  metaDescription: '',
  metaDescriptionLength: 0,
  h1s: ['Comfort That Works As Hard As You Do'],
  h1Count: 1,
  wordCount: 412,
  imageCount: 34,
  imagesNoAlt: 21,
  canonical: 'https://zuenascrubs.com/',
  viewport: 'width=device-width, initial-scale=1',
  hasViewport: true,
  ogTags: 4,
  schemaTypes: ['WebSite'],
  hasSchema: true,
  hasAuthorSignals: false,
  serverRenderedContent: true,
  scriptCount: 28,
  internalLinks: 24,
  externalLinks: 6,
  hasLlmsTxt: false,
  blocksAiCrawlers: false,
  robots: { exists: true, blocksAiCrawlers: false, sitemapUrls: [] },
  sitemap: { exists: true, url: 'https://zuenascrubs.com/sitemap.xml', urlCount: 47 },
  pageSpeed: {
    mobile: {
      performance: 34, seo: 78, accessibility: 71, bestPractices: 75,
      lab: { lcp: 5200, fcp: 2900, cls: 0.24, tbt: 890 },
      field: { lcp: 4180, inp: 310, cls: 0.19, overall: 'SLOW' },
      opportunities: [
        { title: 'Properly size images', savingsMs: 2400 },
        { title: 'Eliminate render-blocking resources', savingsMs: 1650 },
        { title: 'Serve images in next-gen formats', savingsMs: 1200 },
        { title: 'Reduce unused JavaScript', savingsMs: 780 },
      ],
    },
    desktop: { performance: 68, seo: 82 },
  },
};

const keywordList = [
  { keyword: 'medical scrubs malaysia', position: 14, volume: 2400, cpc: 1.8, difficulty: 34 },
  { keyword: 'premium scrubs for nurses', position: 18, volume: 1600, cpc: 2.1, difficulty: 41 },
  { keyword: 'best scrubs brand', position: 27, volume: 5400, cpc: 1.4, difficulty: 58 },
  { keyword: 'comfortable nursing uniforms', position: 12, volume: 880, cpc: 1.9, difficulty: 29 },
  { keyword: 'buy scrubs online', position: 31, volume: 3200, cpc: 2.4, difficulty: 52 },
  { keyword: 'jogger scrubs', position: 16, volume: 1900, cpc: 1.6, difficulty: 38 },
  { keyword: 'antimicrobial scrubs', position: 19, volume: 720, cpc: 2.8, difficulty: 31 },
  { keyword: 'scrubs for doctors', position: 44, volume: 2100, cpc: 1.7, difficulty: 47 },
];

const striking = keywordList.filter((k) => k.position >= 11 && k.position <= 20);

const keywordData = {
  totalKeywords: 118,
  page1Keywords: 0,
  traffic: 210,
  trafficValue: 380,
  distribution: { top1_5: 0, top6_10: 0, top11_20: 12, top21_50: 38, top51_100: 68 },
  topKeywords: keywordList,
  strikingDistance: striking,
  topPages: [],
  history: [],
};

const backlinks = {
  total: 486, referringDomains: 94, domainAuthority: 8, pageAuthority: 12,
  dofollow: 402, nofollow: 84, eduLinks: 0, govLinks: 0,
  quality: 6, neutral: 47, toxic: 41, sampled: 94, toxicPercentage: 44,
  topAnchors: [], topPages: [],
};

const competitors = [
  { domain: 'figsscrubs.com', commonKeywords: 62, totalKeywords: 18400, missingKeywords: 18338, traffic: 148000, trafficValue: 210000, relevance: 8.2, backlinks: 42000, referringDomains: 3800, domainAuthority: 72 },
  { domain: 'jaanuu.com', commonKeywords: 48, totalKeywords: 9200, missingKeywords: 9152, traffic: 61000, trafficValue: 88000, relevance: 6.4, backlinks: 18000, referringDomains: 1900, domainAuthority: 64 },
  { domain: 'cherokeeuniforms.com', commonKeywords: 39, totalKeywords: 6100, missingKeywords: 6061, traffic: 34000, trafficValue: 41000, relevance: 5.1, backlinks: 11000, referringDomains: 1200, domainAuthority: 58 },
  { domain: 'scrubsandbeyond.com', commonKeywords: 31, totalKeywords: 4800, missingKeywords: 4769, traffic: 22000, trafficValue: 26000, relevance: 4.3, backlinks: 7400, referringDomains: 890, domainAuthority: 51 },
];

const keywordGap = [
  { keyword: 'scrubs with pockets', volume: 4400, position: 3, difficulty: 42 },
  { keyword: 'stretch scrub pants', volume: 2900, position: 2, difficulty: 38 },
  { keyword: 'plus size scrubs', volume: 3600, position: 5, difficulty: 45 },
  { keyword: 'scrub sets for women', volume: 8100, position: 4, difficulty: 55 },
  { keyword: 'medical uniforms near me', volume: 1800, position: 6, difficulty: 33 },
  { keyword: 'best scrubs for long shifts', volume: 1300, position: 1, difficulty: 27 },
];

const ai = {
  promptsTested: 8,
  mentions: 0,
  shareOfVoice: 0,
  rivals: [
    { name: 'FIGS', count: 7, outOf: 8 },
    { name: 'Jaanuu', count: 6, outOf: 8 },
    { name: 'Cherokee', count: 4, outOf: 8 },
    { name: 'Wear Figs', count: 3, outOf: 8 },
    { name: 'Scrubs & Beyond', count: 2, outOf: 8 },
  ],
  results: [],
  readiness: [
    { id: 'llms_txt', label: 'llms.txt file', pass: false, detail: 'Missing. AI crawlers have no map of what matters on your site.' },
    { id: 'org_schema', label: 'Organization / LocalBusiness schema', pass: false, detail: 'Only WebSite schema found. AI systems cannot reliably identify who you are.' },
    { id: 'faq_schema', label: 'FAQ / Q&A structured content', pass: false, detail: 'Answer-formatted content is what gets quoted in AI answers.' },
    { id: 'author_eeat', label: 'E-E-A-T signals (author, credentials)', pass: false, detail: 'No author or credential signals. AI weights expertise heavily.' },
    { id: 'crawlable', label: 'Content readable without JavaScript', pass: true, detail: 'Content is in the HTML — AI crawlers can read it.' },
    { id: 'robots_ai', label: 'AI crawlers allowed in robots.txt', pass: true, detail: 'AI crawlers are permitted.' },
  ],
  readinessScore: 33,
  aiOverview: { gapCount: 23, citedCount: 0, gaps: [], wins: [] },
  methodology: 'Assistant recall measured by asking Claude (Sonnet 4.6) buyer-intent questions with no brand hint. AI Overview data sourced from live Google SERP tracking.',
};

async function main() {
  const technical = scoring.scoreTechnical(crawl);
  const onPage = scoring.scoreOnPage(crawl);
  const content = scoring.scoreContent(crawl, keywordData);
  const authority = scoring.scoreAuthority(backlinks, competitors);
  const local = scoring.scoreLocal({ enabled: false });
  const aiScore = scoring.scoreAiVisibility(ai);

  const scores = { technical, onPage, content, authority, local, aiVisibility: aiScore };
  const overall = scoring.calculateOverall(scores);
  const allIssues = [
    ...technical.issues, ...onPage.issues, ...content.issues,
    ...authority.issues, ...local.issues, ...aiScore.issues,
  ];
  const roadmap = scoring.buildRoadmap(allIssues, ['SEO', 'AI SEO', 'GEO', 'AEO']);
  const opportunity = scoring.calculateOpportunityValue(keywordList);

  console.log('--- SCORES ---');
  console.log('overall:', overall, scoring.grade(overall));
  console.log('technical:', technical.score, '| onPage:', onPage.score, '| content:', content.score);
  console.log('authority:', authority.score, '| ai:', aiScore.score);
  console.log('issues:', allIssues.length, '| critical:', allIssues.filter(i => i.severity === 'critical').length);
  console.log('opportunity: $' + opportunity.annualGap + '/yr, $' + opportunity.monthlyGap + '/mo');
  console.log('quickWins:', roadmap.quickWins.map(w => w.title));

  const payload = {
    report: {
      id: 'test123456',
      website: 'https://zuenascrubs.com',
      domain: 'zuenascrubs.com',
      businessName: 'Zuena',
      customerName: 'Linda',
      services: ['SEO', 'AI SEO', 'GEO', 'AEO'],
      country: 'my',
      location: 'Malaysia',
      industryLine: 'Premium medical scrubs for healthcare professionals',
      agentName: 'Adam G',
      agentPhone: '+91-8249016547',
      agentEmail: 'adam@qtonix.com',
      agentDesignation: 'Project Manager',
      date: new Date(),
      validDays: 14,
    },
    pricing: {
      enabled: true, currency: 'USD', symbol: '$',
      intro: 'Three ways to work together — all month-to-month, no lock-in. Every package includes monthly reporting, keyword tracking and a dedicated point of contact.',
      note: 'About paid backlinks. Some high-authority backlinks carry a direct placement cost paid to the publisher — this is a direct expense you pay, separate from your package. Qtonix handles all the research, outreach, backend conversations and setup for free — no agency markup and no management charge on top. And we only ever place genuine, relevant links.',
      guaranteeTitle: 'The risk is ours, not yours.',
      guaranteeBody: "If we don't increase your targeted traffic and enquiries within 90 days, we refund every dollar you've paid — and write you a cheque for $1,000 for your time.",
      packages: [
        { name:'STARTER', price:'399', period:'/mo', blurb:'Getting started on a budget.', recommended:false,
          features:['Keyword & competitor research','2 SEO blogs / month','Directory submission: 12 / month','Social bookmarking: 8 / month','Profile creation: 8 / month','Q&A submission: 8 / month','Monthly report'], starFeatures:[] },
        { name:'GROWTH', price:'549', period:'/mo', oldPrice:'799', recommended:true, badge:'RECOMMENDED',
          blurb:'Best value — builds the pages that capture high-intent searches. Lock now = lifetime price, even when our rates rise.',
          features:['Everything in Starter, plus:','3–4 SEO blogs / month','2 landing pages / month','Guest posts: 2 / month','Article / blog submission: 8 / month','Infographic submission: 8 / month','PR submission: 1 / month','GMB / profile optimisation: 2 / month'],
          starFeatures:['90-day money-back guarantee'] },
        { name:'PREMIUM', price:'1,199', period:'/mo', blurb:'Maximum speed — includes link cleanup.', recommended:false,
          features:['Everything in Growth, plus:','8+ SEO blogs / month','4+ landing pages / month','Full on-page SEO audit & fixes','Backlink audit & disavow','Technical SEO: speed, schema, JS fixes','Competitor gap analysis'],
          starFeatures:['90-day money-back guarantee'] },
      ],
    },
    settings: {
      companyName: 'Qtonix Software Pvt. Ltd.',
      companyShort: 'Qtonix',
      logoPath: '',
      website: 'https://www.qtonix.com',
      email: 'info@qtonix.com',
      phone: '+91-8249016547',
      colors: { navy: '#050A1F', orange: '#FF6A00', orangeDeep: '#FF4500', blue: '#2563EB' },
    },
    headline: {
      headlineBold: 'Be the scrubs nurses',
      headlineLight: 'actually find.',
      headline: 'Be the scrubs nurses actually find.',
      subhead: 'A search visibility analysis for Zuena — built to put your premium scrubs in front of the healthcare professionals already searching for exactly what you make.',
    },
    summary: {
      headA: 'The product is excellent.',
      headB: 'The problem is nobody can find it in search.',
      diagnosis: 'Two things cause that, and both are fixable: the domain has almost no genuine authority (and 44% of the links it does have are spam that actively hurt), and the site has no pages built to rank for high-intent searches like "medical scrubs malaysia" or "jogger scrubs". We present the evidence plainly and let it speak for itself.',
      verdict: 'The product and brand are genuinely strong — premium scrubs with a clear point of view in a category people buy repeatedly. The gap is purely discoverability: zuenascrubs.com has a Domain Authority of 8 against competitors averaging 61, and ranks on zero first-page positions for the searches nurses actually make.',
      findings: [
        { title: 'No page-1 rankings', detail: 'You rank for 118 keywords, but not one sits on page one. 12 sit in positions 11-20 — close, but earning almost nothing.', impact: 'Roughly 210 visits/month against a category demand of 25,000+.' },
        { title: 'Authority gap of 53 points', detail: 'DA 8 vs competitors at 51-72. 44% of your 94 referring domains are low-quality spam.', impact: 'Competitive terms are unreachable until this is rebuilt.' },
        { title: 'Invisible to AI assistants', detail: 'Across 8 buying questions, AI named FIGS 7 times and Zuena zero times.', impact: 'Every AI-assisted purchase in your category goes to a competitor.' },
      ],
      opportunity: 'Twelve keywords already sit in positions 11-20. Moving those alone to page one is the fastest measurable revenue available to you.',
    },
    scores: {
      overall,
      grade: scoring.grade(overall),
      technical: technical.score,
      onPage: onPage.score,
      content: content.score,
      authority: authority.score,
      local: local.score,
      aiVisibility: aiScore.score,
    },
    crawl, keywordData, backlinks, competitors, keywordGap, ai, opportunity, roadmap,
    issues: allIssues,
    issueCounts: {
      critical: allIssues.filter(i => i.severity === 'critical').length,
      warning: allIssues.filter(i => i.severity === 'warning').length,
      notice: allIssues.filter(i => i.severity === 'notice').length,
      total: allIssues.length,
    },
  };

  const { renderReport } = require('./services/renderer');
  payload.report.id = 'demo01';
  const { pdfPath, htmlPath } = await renderReport(payload);
  console.log('\nHTML:', htmlPath);
  console.log('PDF :', pdfPath);
  return pdfPath;
}

main().catch((e) => { console.error(e); process.exit(1); });

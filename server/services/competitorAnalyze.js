/**
 * Competitor Analysis — data + AI assembly for the Competitor Analysis report.
 *
 * Produces the exact view model consumed by templates/competitorReport.hbs.
 *
 * Grounding rules (enforced here, because the report runs autonomously):
 *   - Every NUMBER (keyword counts, volumes, positions, backlink totals, DA,
 *     bar widths) comes from SE Ranking or the crawl — NEVER from the model.
 *   - Every factual CLAIM about a site must be supported by crawl/API evidence.
 *     Claude is given the evidence and told to assert only what it supports.
 *   - A verification pass re-checks the draft against the evidence and drops
 *     anything unproven (we drop, we don't hedge).
 *   - New findings enrich the existing sections; no new pages.
 *
 * The code owns the scorecard, bar charts, keyword tables, backlink numbers and
 * intent split (deterministic). Claude owns the prose: headline, exec findings,
 * who-is comparison, SWOT, opportunity-map page recommendations, callouts — all
 * written around the numbers the code computed.
 */
const { callClaude, callAI } = require('./aiVisibility');

// ---- small helpers ---------------------------------------------------------
function toDomain(url) {
  if (!url) return '';
  let s = String(url).trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0];
  return s.replace(/^www\./, '');
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function fmt(n) { return num(n).toLocaleString('en-US'); }
// Bar width as a percentage of the larger of the two values (min 2% so a tiny
// bar is still visible, like the reference reports).
function pct(v, max) { if (!max) return 2; return Math.max(2, Math.round((num(v) / max) * 100)); }
function monthName(d) { return d.toLocaleString('en-US', { month: 'short', year: 'numeric' }); }
function fullDate(d) { return d.toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); }

// Market code → display label + short tag (mirrors the reference covers).
const MARKETS = {
  us: ['United States', 'US'], uk: ['United Kingdom', 'UK'], ca: ['Canada', 'CA'],
  au: ['Australia', 'AU'], in: ['India', 'IN'], ae: ['United Arab Emirates', 'UAE'],
  de: ['Germany', 'DE'], fr: ['France', 'FR'], es: ['Spain', 'ES'], it: ['Italy', 'IT'],
  nl: ['Netherlands', 'NL'], sg: ['Singapore', 'SG'], za: ['South Africa', 'ZA'],
  ie: ['Ireland', 'IE'], nz: ['New Zealand', 'NZ'], worldwide: ['Worldwide', 'Worldwide'],
};
function marketLabels(code) { const m = MARKETS[String(code).toLowerCase()]; return m || [String(code || 'US').toUpperCase(), String(code || 'US').toUpperCase()]; }

// ---- SE Ranking fetch for one side ----------------------------------------
// Returns a flat, safe shape; any failing call degrades to zeros/empties so the
// report still renders. keywordLimit keeps credit spend predictable.
async function fetchSide(se, domain, source) {
  const safe = async (fn, fallback) => { try { return await fn(); } catch (e) { console.error(`[competitor] ${domain} call failed:`, e.message); return fallback; } };
  const [overview, keywordsRes, backlinks] = await Promise.all([
    safe(() => se.getDomainOverview(domain, source), {}),
    safe(() => se.getDomainKeywords(domain, source, { limit: 100 }), {}),
    safe(() => se.getBacklinkSummary(domain, 'domain'), {}),
  ]);
  // Normalise overview (organic block) — SE Ranking shapes vary by endpoint.
  const org = (overview && overview.organic) || overview || {};
  const kwRows = Array.isArray(keywordsRes) ? keywordsRes : (keywordsRes.data || keywordsRes.keywords || keywordsRes.rows || []);
  const bl = (backlinks && backlinks.summary && backlinks.summary[0]) || backlinks || {};
  const tops = {
    top1_5: num(org.top1_5 ?? org.tops_1_5 ?? org.new_1_5),
    top6_10: num(org.top6_10 ?? org.tops_6_10),
    top11_20: num(org.top11_20 ?? org.tops_11_20),
    top21_50: num(org.top21_50 ?? org.tops_21_50),
    top51_100: num(org.top51_100 ?? org.tops_51_100),
  };
  return {
    domain,
    keywords: num(org.keywords_count ?? org.keywords ?? kwRows.length),
    traffic: num(org.traffic_sum ?? org.traffic),
    trafficValue: num(org.price_sum ?? org.price),
    newCount: num(org.keywords_new_count), upCount: num(org.keywords_up_count),
    downCount: num(org.keywords_down_count), lostCount: num(org.keywords_lost_count),
    tops,
    page1: tops.top1_5 + tops.top6_10,
    top5: tops.top1_5,
    kwRows: kwRows.map((r) => ({
      kw: r.keyword || r.kw || '', vol: num(r.volume ?? r.search_volume), pos: num(r.position ?? r.pos),
      cpc: num(r.cpc), diff: num(r.difficulty ?? r.competition_index ?? r.kd),
      intents: r.intents || r.intent || '',
    })).filter((r) => r.kw),
    backlinks: num(bl.backlinks ?? bl.total ?? bl.backlinks_total),
    refdomains: num(bl.refdomains ?? bl.referring_domains),
    dofollowRef: num(bl.dofollow_refdomains ?? bl.dofollow),
    nofollowBacklinks: num(bl.nofollow_backlinks),
    fromHomeRef: num(bl.from_home_page_refdomains ?? bl.from_home_page_backlinks),
    da: num(bl.domain_inlink_rank ?? bl.domain_authority ?? bl.inlink_rank),
    topAnchors: (bl.top_anchors_by_refdomains || bl.top_anchors_by_backlinks || []).slice(0, 10),
    topPages: (bl.top_pages_by_refdomains || bl.top_pages_by_backlinks || []).slice(0, 6),
    topTlds: (bl.top_tlds || []).slice(0, 10),
    topCountries: (bl.top_countries || []).slice(0, 10),
  };
}

// Crawl summary trimmed to what the model needs as evidence (keeps tokens sane).
function crawlEvidence(crawl) {
  if (!crawl) return {};
  return {
    finalUrl: crawl.finalUrl || '', title: crawl.title || '', metaDesc: crawl.metaDesc || '',
    h1s: (crawl.h1s || []).slice(0, 8), schemaTypes: (crawl.schemaTypes || []).slice(0, 12),
    socialLinks: crawl.socialLinks || {}, wordCount: crawl.wordCount || null,
    bodyTextSample: (crawl.bodyTextSample || crawl.bodyText || '').slice(0, 2500),
    pageCount: crawl.pageCount || (crawl.sitemap && crawl.sitemap.urlCount) || null,
    httpsOk: crawl.httpsOk, statusCode: crawl.statusCode,
  };
}

// Shared JSON extraction from a Claude reply. Tolerant of markdown fences,
// leading/trailing prose, and trailing commas.
function parseJson(txt) {
  if (!txt) return null;
  let s = String(txt).trim();
  // Strip a ```json ... ``` (or ``` ... ```) fence if present.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // Otherwise slice from the first { to the last } so leading/trailing prose is dropped.
  if (s[0] !== '{') { const i = s.indexOf('{'); const j = s.lastIndexOf('}'); if (i !== -1 && j > i) s = s.slice(i, j + 1); }
  const attempts = [s, s.replace(/,\s*([}\]])/g, '$1')]; // 2nd: drop trailing commas
  for (const a of attempts) { try { return JSON.parse(a); } catch { /* try next */ } }
  return null;
}

// ---- competitor validation (used by the wizard, exported) ------------------
// Returns { isCompetitor: bool, confidence: 'high'|'medium'|'low', reason }.
async function validateCompetitor({ anthropicKey, clientSite, clientName, competitorName, competitorSite, clientCrawl, compCrawl }) {
  if (!anthropicKey) return { isCompetitor: true, confidence: 'low', reason: 'No AI key — skipped validation.' };
  const ev = { client: crawlEvidence(clientCrawl), competitor: crawlEvidence(compCrawl) };
  const system = 'You are an SEO analyst. Decide whether the named competitor is a genuine SEO/market competitor of the client — i.e. they sell to a similar audience and would compete for similar searches. Judge ONLY from the evidence given. A supplier, partner, directory, unrelated industry, or a typo/wrong site is NOT a competitor. Respond with strict JSON.';
  const content = `CLIENT: ${clientName || clientSite} (${clientSite})\nClient site evidence: ${JSON.stringify(ev.client)}\n\nCOMPETITOR: ${competitorName} (${competitorSite})\nCompetitor site evidence: ${JSON.stringify(ev.competitor)}\n\nReturn JSON: {"isCompetitor": true|false, "confidence": "high"|"medium"|"low", "reason": "one sentence a salesperson would understand"}`;
  try {
    const out = await callClaude(anthropicKey, { system, messages: [{ role: 'user', content }], maxTokens: 300 });
    const j = parseJson(out);
    if (j && typeof j.isCompetitor === 'boolean') return j;
  } catch (e) { console.error('[competitor] validate failed:', e.message); }
  return { isCompetitor: true, confidence: 'low', reason: 'Could not verify automatically.' };
}

// ---- market suggestion (when no target market is set) ---------------------
async function suggestMarket({ anthropicKey, clientCrawl, compCrawl }) {
  if (!anthropicKey) return 'us';
  const ev = { client: crawlEvidence(clientCrawl), competitor: crawlEvidence(compCrawl) };
  const system = 'You pick the single most relevant Google country database (SE Ranking code) to compare two sites in. Use TLDs, phone/address, currency and language in the evidence. Reply with strict JSON.';
  const codes = Object.keys(MARKETS).filter((c) => c !== 'worldwide').join(', ');
  const content = `Evidence: ${JSON.stringify(ev)}\n\nValid codes: ${codes}.\nReturn JSON: {"market":"<code>","why":"short"}`;
  try { const j = parseJson(await callClaude(anthropicKey, { system, messages: [{ role: 'user', content }], maxTokens: 150 })); if (j && j.market && MARKETS[j.market]) return j.market; } catch (e) { console.error('[competitor] suggestMarket failed:', e.message); }
  return 'us';
}

module.exports = { fetchSide, crawlEvidence, parseJson, validateCompetitor, suggestMarket, marketLabels, toDomain, num, fmt, pct, fullDate, monthName, buildCompetitorViewModel };

// ---- the big one: assemble the whole view model ----------------------------
async function buildCompetitorViewModel(input) {
  const {
    anthropicKey, openaiKey, source, clientName, competitorName,
    clientSide, compSide, clientCrawl, compCrawl,
    preparedBy, preparedByRole, preparedFor, today = new Date(),
  } = input;
  const [marketLabel, marketShort] = marketLabels(source);
  const client = clientSide, comp = compSide;
  const clientDomain = client.domain, compDomain = comp.domain;

  // ---- deterministic scorecard numbers (from SE Ranking) ----
  const scoreMetrics = {
    keywords: [comp.keywords, client.keywords],
    visits: [comp.traffic, client.traffic],
    trafficValue: [comp.trafficValue, client.trafficValue],
    top5: [comp.top5, client.top5],
    p6_10: [comp.tops.top6_10, client.tops.top6_10],
    p11_20: [comp.tops.top11_20, client.tops.top11_20],
    p21_100: [comp.tops.top21_50 + comp.tops.top51_100, client.tops.top21_50 + client.tops.top51_100],
  };
  const barMax1 = Math.max(client.keywords, comp.keywords, 1);
  const barMaxP1 = Math.max(client.page1, comp.page1, 1);
  const barMaxT5 = Math.max(client.top5, comp.top5, 1);
  const barMaxV = Math.max(client.traffic, comp.traffic, 1);
  const scorecardBars = [
    { label: 'Ranking keywords', clientVal: fmt(client.keywords), compVal: fmt(comp.keywords), clientPct: pct(client.keywords, barMax1), compPct: pct(comp.keywords, barMax1) },
    { label: 'Keywords on page 1', clientVal: fmt(client.page1), compVal: fmt(comp.page1), clientPct: pct(client.page1, barMaxP1), compPct: pct(comp.page1, barMaxP1) },
    { label: 'Keywords in top 5', clientVal: fmt(client.top5), compVal: fmt(comp.top5), clientPct: pct(client.top5, barMaxT5), compPct: pct(comp.top5, barMaxT5) },
    { label: 'Visits per month', clientVal: fmt(client.traffic), compVal: fmt(comp.traffic), clientPct: pct(client.traffic, barMaxV), compPct: pct(comp.traffic, barMaxV) },
  ];
  const barMaxBL = Math.max(client.backlinks, comp.backlinks, 1);
  const barMaxRD = Math.max(client.refdomains, comp.refdomains, 1);
  const barMaxDF = Math.max(client.dofollowRef, comp.dofollowRef, 1);
  const barMaxDA = Math.max(client.da, comp.da, 1);
  const backBars = [
    { label: 'Total backlinks', clientVal: fmt(client.backlinks), compVal: fmt(comp.backlinks), clientPct: pct(client.backlinks, barMaxBL), compPct: pct(comp.backlinks, barMaxBL) },
    { label: 'Linking websites', clientVal: fmt(client.refdomains), compVal: fmt(comp.refdomains), clientPct: pct(client.refdomains, barMaxRD), compPct: pct(comp.refdomains, barMaxRD) },
    { label: 'Dofollow websites', clientVal: fmt(client.dofollowRef), compVal: fmt(comp.dofollowRef), clientPct: pct(client.dofollowRef, barMaxDF), compPct: pct(comp.dofollowRef, barMaxDF) },
    { label: 'Domain authority score', clientVal: fmt(client.da), compVal: fmt(comp.da), clientPct: pct(client.da, barMaxDA), compPct: pct(comp.da, barMaxDA) },
  ];
  const clientLeads = client.keywords >= comp.keywords;

  // ---- data block handed to Claude as the sole source of truth ----
  const dataForAI = {
    market: marketLabel,
    client: { name: clientName, domain: clientDomain, ...numsFor(client), topKeywords: client.kwRows.slice(0, 40), topAnchors: client.topAnchors, topPages: client.topPages, crawl: crawlEvidence(clientCrawl) },
    competitor: { name: competitorName, domain: compDomain, ...numsFor(comp), topKeywords: comp.kwRows.slice(0, 40), topAnchors: comp.topAnchors, topPages: comp.topPages, topTlds: comp.topTlds, topCountries: comp.topCountries, crawl: crawlEvidence(compCrawl) },
    clientLeads,
  };

  const narrativeOut = await generateNarrative({ anthropicKey, openaiKey }, dataForAI);
  const narrative = narrativeOut.vm;
  const aiDiag = narrativeOut.diag;

  // ---- assemble view model (numbers from code, prose from narrative) ----
  const vm = {
    h: { client: clientName, competitor: competitorName },
    cover: {
      marketLabel, marketShort, dataMonth: monthName(today),
      headlineHtml: narrative.cover.headlineHtml,
      sub: `A side-by-side look at how ${clientName} and ${competitorName} perform in Google ${marketShort} — keywords, traffic, links, website quality — and the plan to pull ahead.`,
      clientDomain, compDomain,
      preparedBy: preparedBy || 'Qtonix', preparedByRole: preparedByRole || 'Qtonix Software Pvt. Ltd.',
      clientName, preparedFor: preparedFor || clientName, date: fullDate(today),
    },
    toc: buildToc(competitorName, clientName, clientLeads),
    exec: {
      title: narrative.exec.title,
      leadHtml: narrative.exec.leadHtml,
      kpis: [
        { k: 'Ranking keywords', v: fmt(client.keywords), vs: fmt(comp.keywords), d: narrative.exec.kpiNotes[0] || '' },
        { k: 'Visits / month', v: fmt(client.traffic), vs: fmt(comp.traffic), d: narrative.exec.kpiNotes[1] || `Est. organic, Google ${marketShort}` },
        { k: 'Linking websites', v: fmt(client.refdomains), vs: fmt(comp.refdomains), d: narrative.exec.kpiNotes[2] || '' },
        { k: 'Shared keywords', v: fmt(narrative.sharedCount ?? 0), vs: '', d: narrative.exec.kpiNotes[3] || '' },
      ],
      findings: narrative.exec.findings,
      recommendation: narrative.exec.recommendation,
    },
    who: narrative.who,
    scorecard: {
      title: narrative.scorecard.title,
      lead: `These are Google ${marketShort} figures for ${monthName(today)}. "Top 10" means page one of Google — where almost all clicks happen.`,
      bars: scorecardBars,
      rows: buildScorecardRows(client, comp, clientName, clientLeads),
      calloutTitle: narrative.scorecard.calloutTitle,
      calloutBody: narrative.scorecard.calloutBody,
    },
    ranks: narrative.ranks,
    health: narrative.health,
    tech: narrative.tech,
    back: {
      title: narrative.back.title, lead: narrative.backlinkLead,
      bars: backBars, compPoints: narrative.back.compPoints, clientPoints: narrative.back.clientPoints,
      risksTitle: narrative.back.risksTitle, risks: narrative.back.risks,
    },
    swot: narrative.swot,
    opp: narrative.opp,
    notes: buildNotes(marketShort, monthName(today), fullDate(today)),
  };
  // back cover text
  vm.back.headlineHtml = narrative.backCoverHeadlineHtml;
  vm.back.sub = "We'd be glad to walk you through this report on a call and agree the first steps. The first fixes can begin within days of approval.";
  vm.back.email = input.email || 'adam@qtonix.com';
  vm.back.phone = input.phone || '+91-8249016547';
  vm.back.web = input.web || 'www.qtonix.com';
  vm.back.year = String(today.getFullYear());
  vm._aiDiag = aiDiag; // diagnostics for the runner to persist (not rendered)
  return vm;
}

function numsFor(s) {
  return {
    keywords: s.keywords, visits: s.traffic, trafficValue: s.trafficValue,
    top5: s.top5, page1: s.page1, pos6_10: s.tops.top6_10, pos11_20: s.tops.top11_20,
    pos21_100: s.tops.top21_50 + s.tops.top51_100,
    backlinks: s.backlinks, refdomains: s.refdomains, dofollowRefdomains: s.dofollowRef,
    nofollowBacklinks: s.nofollowBacklinks, domainAuthority: s.da, fromHomepageRefdomains: s.fromHomeRef,
    newThisMonth: s.newCount, lostThisMonth: s.lostCount, upThisMonth: s.upCount, downThisMonth: s.downCount,
  };
}

function buildToc(competitor, client, clientLeads) {
  return [
    { n: '01', title: 'Executive summary', desc: 'The key findings on one page' },
    { n: '02', title: `Who ${competitor} is`, desc: 'Business, offer and positioning compared' },
    { n: '03', title: 'Head-to-head scorecard', desc: 'Keywords, traffic, rankings and authority' },
    { n: '04', title: `What ${competitor} ranks for`, desc: 'Its keywords and the gap it leaves open' },
    { n: '05', title: `${client} keyword health check`, desc: 'Right-intent vs wrong-intent rankings' },
    { n: '06', title: 'Website & technical review', desc: 'Content, trust and technical issues on both sites' },
    { n: '07', title: 'Backlink comparison', desc: 'Link quality, risks and wasted link value' },
    { n: '08', title: `SWOT — ${competitor} through ${client}'s eyes`, desc: 'What to watch and what to exploit' },
    { n: '09', title: 'Keyword opportunity map', desc: `The searches ${client} should own next` },
    { n: '10', title: 'How to read this report', desc: 'Data notes and definitions' },
  ];
}

function buildScorecardRows(client, comp, clientName, clientLeads) {
  const b = (v) => `<b>${fmt(v)}</b>`;
  const movement = (s) => {
    const parts = [];
    if (s.newCount) parts.push(`+${fmt(s.newCount)} new`);
    if (s.upCount) parts.push(`${fmt(s.upCount)} ↑`);
    if (s.downCount) parts.push(`${fmt(s.downCount)} ↓`);
    if (s.lostCount) parts.push(`<span style="color:var(--red);font-weight:700">${fmt(s.lostCount)} lost</span>`);
    return parts.join(' · ') || '—';
  };
  const wrap = (s, isClient) => (isClient && client.keywords >= comp.keywords) || (!isClient && comp.keywords > client.keywords);
  const cell = (val, strong) => strong ? b(val) : fmt(val);
  return [
    { metric: 'Ranking keywords', compHtml: cell(comp.keywords, comp.keywords > client.keywords), clientHtml: cell(client.keywords, client.keywords >= comp.keywords), means: 'How many searches the site appears for' },
    { metric: 'Est. visits / month', compHtml: cell(comp.traffic, comp.traffic > client.traffic), clientHtml: cell(client.traffic, client.traffic >= comp.traffic), means: `People arriving from Google` },
    { metric: 'Traffic value / month', compHtml: '$' + fmt(comp.trafficValue), clientHtml: '$' + fmt(client.trafficValue), means: 'What those clicks would cost as ads' },
    { metric: 'Keywords in top 5', compHtml: cell(comp.top5, comp.top5 > client.top5), clientHtml: cell(client.top5, client.top5 >= comp.top5), means: 'Strong positions that get clicks' },
    { metric: 'Keywords position 6–10', compHtml: cell(comp.tops.top6_10, false), clientHtml: cell(client.tops.top6_10, client.tops.top6_10 >= comp.tops.top6_10), means: 'Still page one' },
    { metric: 'Keywords position 11–20', compHtml: cell(comp.tops.top11_20, false), clientHtml: cell(client.tops.top11_20, client.tops.top11_20 >= comp.tops.top11_20), means: 'Page two — closest to quick wins' },
    { metric: 'Keywords position 21–100', compHtml: fmt(comp.tops.top21_50 + comp.tops.top51_100), clientHtml: fmt(client.tops.top21_50 + client.tops.top51_100), means: 'Visible but rarely clicked' },
    { metric: "This month's movement", compHtml: movement(comp), clientHtml: movement(client), means: client.keywords >= comp.keywords ? `${clientName}'s ranking movement` : 'Ranking movement' },
  ];
}

function buildNotes(marketShort, dataMonth, reviewDate) {
  return {
    about: [
      `All search figures are for <b>Google ${marketShort}, ${dataMonth}</b>, and include all subdomains of each website.`,
      'Search volumes and visits are <b>estimates</b> based on industry search data. They show scale and direction, not exact counts. Your own Google Search Console and Analytics will show the precise numbers.',
      `Website observations were taken from a live review of both sites on ${reviewDate}.`,
      'Backlink figures reflect links found at the time of the review; numbers change as links are added or removed.',
    ],
    terms: [
      { term: 'Keyword', def: 'A word or phrase people type into Google.' },
      { term: 'Searches / month', def: `About how many times that phrase is searched in ${marketShort === 'Worldwide' ? 'total' : 'the ' + marketShort} each month.` },
      { term: 'Position', def: 'Where the website appears in Google. 1–10 is page one.' },
      { term: 'Search intent', def: 'What the searcher actually wants — to learn, compare or buy.' },
      { term: 'Difficulty', def: 'How hard it is to reach page one, on a 0–100 scale. Under 20 is easy.' },
      { term: 'Traffic value', def: 'What the same visits would cost if bought as Google Ads.' },
      { term: 'Backlink', def: 'A link from another website to yours — like a recommendation.' },
      { term: 'Dofollow / nofollow', def: "Dofollow links pass trust to your site; nofollow links mostly don't." },
      { term: 'Domain authority score', def: "A 0–100 score of how trusted a website's link profile is." },
      { term: '301 redirect', def: 'A permanent forward from an old page address to a new one, keeping its rankings and links.' },
      { term: 'Disavow', def: 'Telling Google to ignore specific harmful links.' },
      { term: 'Structured data', def: 'Hidden code that helps Google show extras like star ratings and FAQs in results.' },
    ],
  };
}

// ---- the narrative: generated in THREE focused, resilient Claude calls -------
// A single 8k-token JSON call was all-or-nothing: one malformed character made
// the whole report drop to the generic fallback (which is what produced the thin
// WebFx report). Splitting into three smaller, section-grouped calls means each
// returns a small, reliably-parseable JSON, and a failure in one group only
// degrades that group — the rest stay rich. Numbers are code-owned, so the
// narrative can't invent figures regardless.
const NARRATIVE_SYSTEM = [
  'You are a senior SEO strategist writing a detailed, client-facing competitor analysis for a digital agency (Qtonix).',
  'You are given VERIFIED DATA: SE Ranking metrics plus a crawl of each website (title, meta description, H1s, schema types, social links, a body-text sample).',
  'Write genuinely insightful, specific analysis — the depth a senior consultant would deliver, not filler.',
  'HARD RULES:',
  '- Never invent numbers. Use only figures present in the data.',
  '- Every claim about a website must be grounded in that site\'s crawl evidence. If the evidence does not support a claim, do not make it. Prefer fewer, true points over padding.',
  '- Read the crawl closely and surface what actually matters for THIS pair: what each business sells and how it positions itself, placeholder/dummy text, missing reviews or proof, thin content, dead links, trust signals, the intent behind the keywords, open keyword gaps, link-profile quality and risks. You are NOT limited to any fixed set of points — add whatever is clearly evidenced and useful.',
  '- Plain, confident British-business English. Concrete and specific. No hype, no emojis.',
  'Return STRICT, VALID JSON only — no markdown fence, no prose around it.',
].join('\n');

function dataContext(data) {
  return `VERIFIED DATA (client is "${data.client.name}" / ${data.client.domain}; competitor is "${data.competitor.name}" / ${data.competitor.domain}; market = Google ${data.market}; the stronger site on raw numbers is ${data.clientLeads ? 'the CLIENT' : 'the COMPETITOR'}):\n${JSON.stringify(data)}`;
}

// Returns { json, status } where status is 'ok' | 'empty' | 'parse-failed' |
// 'error:<msg>'. Uses callAI so a Claude failure falls back to OpenAI (if a key
// is set) before giving up. The status is recorded on the report for diagnosis.
async function callJson(keys, userContent, maxTokens, diag, label) {
  let out = '';
  try {
    out = await callAI({ anthropicKey: keys.anthropicKey, openaiKey: keys.openaiKey, system: NARRATIVE_SYSTEM, messages: [{ role: 'user', content: userContent }], maxTokens: maxTokens || 2000 });
  } catch (e) {
    const msg = String(e.message || e).slice(0, 160);
    console.error(`[competitor] narrative ${label} call failed:`, msg);
    diag[label] = 'error: ' + msg; return null;
  }
  if (!out || !out.trim()) { diag[label] = 'empty'; console.error(`[competitor] narrative ${label} empty response`); return null; }
  const j = parseJson(out);
  if (!j) { diag[label] = 'parse-failed'; console.error(`[competitor] narrative ${label} unparseable (first 300):`, String(out).slice(0, 300)); return null; }
  diag[label] = 'ok'; return j;
}

// generateNarrative returns { vm, diag } so the runner can store diagnostics.
async function generateNarrative(keys, data) {
  const anthropicKey = keys && keys.anthropicKey;
  const openaiKey = keys && keys.openaiKey;
  const fallback = fallbackNarrative(data);
  const diag = { hasAnthropicKey: !!anthropicKey, hasOpenaiKey: !!openaiKey };
  if (!anthropicKey && !openaiKey) { diag.result = 'no-ai-key'; return { vm: fallback, diag }; }
  const ctx = dataContext(data);

  // --- Group A: cover + exec + who-is + scorecard callout + backlink framing ---
  const keysObj = { anthropicKey, openaiKey };
  const pA = callJson(keysObj, `${ctx}

Write the opening + comparison sections. STRICT JSON:
{
 "cover":{"headlineHtml":"3-line cover headline; wrap the key phrase in <span>...</span>; <br> between lines"},
 "backCoverHeadlineHtml":"2-line closing headline; one phrase in <span>...</span>; <br> between lines",
 "sharedCount":<integer keywords both sites rank for; 0 if unknown/none>,
 "exec":{"title":"one-line verdict","leadHtml":"2-3 sentence summary, <strong>/<em> ok","kpiNotes":["under ranking-keywords","under visits","under linking-websites","under shared-keywords"],"findings":[{"n":"1","title":"Bold lead-in.","bodyHtml":"specific finding","impact":"High|Medium|Medium–High|Big opportunity|Opportunity|Info","pill":"p-r|p-a|p-g|p-n|p-o"}],"recommendation":"one-line recommendation"},
 "who":{"title":"headline","lead":"intro","rows":[{"label":"What they sell","compHtml":"...","clientHtml":"..."},{"label":"How customers buy","compHtml":"...","clientHtml":"..."},{"label":"Headline claim","compHtml":"...","clientHtml":"..."},{"label":"Positioning","compHtml":"...","clientHtml":"..."},{"label":"Proof & trust","compHtml":"...","clientHtml":"..."},{"label":"Website","compHtml":"...","clientHtml":"..."},{"label":"Social presence","compHtml":"...","clientHtml":"..."}],"compWins":["3-5 bullets"],"clientWins":["3-5 bullets"],"sideNote":"optional cross-site observation ONLY if genuinely relevant, else empty string"},
 "scorecard":{"title":"who-wins headline","calloutTitle":"...","calloutBody":"2-3 sentences interpreting the gap"},
 "backlinkLead":"1-2 sentence plain-English intro to backlinks",
 "back":{"title":"backlink section headline","compPoints":["3-4 bullets on the competitor's link profile"],"clientPoints":["3-4 bullets on the client's link profile"],"risksTitle":"Two risks to fix OR empty string","risks":[{"risk":"...","detailHtml":"...","priority":"High|Medium","pill":"p-r|p-a"}]}
}
Give exactly 5 findings. Fill who-is rows ONLY from crawl evidence (use "—" where a site shows nothing). Make win-boxes specific to each business.`, 2600, diag, 'A');

  // --- Group B: competitor keywords + client keyword health + opportunity map ---
  const pB = callJson(keysObj, `${ctx}

Write the keyword sections. "ranks" = the COMPETITOR's keywords (competitor.topKeywords). "health" = the CLIENT's keywords (client.topKeywords) split by search intent. "opp" = searches the CLIENT should target next. STRICT JSON:
{
 "ranks":{"title":"headline about what the competitor ranks for","lead":"1-2 sentences","rows":[{"kw":"keyword","vol":"volume","pos":"position","type":"Own brand|Brand misspelling|Other brands|Buyer search|Information search","pill":"p-n|p-a|p-o","strong":true}],"trafficTitle":"optional subhead","trafficBody":"optional","calloutTitle":"The gap it leaves open","calloutHtml":"2-3 sentences","note2Title":"optional","note2Body":"optional"},
 "health":{"eyebrow":"${data.client.name} keyword health check","title":"headline","leadHtml":"1-2 sentences","wrongTitle":"short label for wrong/low-intent group","wrong":[{"kw":"...","vol":"...","pos":"...","why":"why this visitor isn't ideal"}],"rightTitle":"short label for right-intent group","right":[{"kw":"...","vol":"...","pos":"...","status":"Keep|Push to page 1|Needs own page|Needs a guide","pill":"p-g|p-o|p-r"}],"calloutTitle":"In plain words","calloutBody":"2-3 sentences"},
 "opp":{"title":"The searches ${data.client.name} should own next","lead":"1-2 sentences","rows":[{"kw":"...","vol":"...","diff":"...","client":"— or current position","strong":true,"page":true,"rowspan":2,"pageShade":true,"pageHtml":"<b>Page name</b> description"}],"supportTitle":"Blog topics that support these pages","supportLeft":["2-4 blog ideas"],"supportRight":["2-4 blog ideas"],"calloutTitle":"Why this matters","calloutBody":"2-3 sentences"}
}
Use the real keyword/volume/position values from the data. In "opp", group rows that share a "page to build" using rowspan on the first row of the group (set page:true + pageHtml + rowspan on the first, and page:false on the rest), and set pageShade:true to tint a group.`, 2800, diag, 'B');

  // --- Group C: website & technical review + SWOT ---
  const pC = callJson(keysObj, `${ctx}

Write the website review + SWOT. STRICT JSON:
{
 "tech":{"title":"headline about both sites' technical/content state","clientRows":[{"issue":"short issue name","sawHtml":"what the crawl shows — specific","priority":"High|Medium|Strength","pill":"p-r|p-a|p-g"}],"compRows":[{"issue":"...","sawHtml":"..."}]},
 "swot":{"strengths":["4-6 bullets — the COMPETITOR's strengths"],"weaknesses":["4-6 bullets — the COMPETITOR's weaknesses"],"opportunities":["4-6 bullets — opportunities for ${data.client.name}"],"threats":["4-6 bullets — threats to ${data.client.name}"],"calloutTitle":"The positioning message we recommend","calloutBody":"2-3 sentences"}
}
Base every tech row on actual crawl evidence (title/meta/h1s/body/social). Include a "What's working"/Strength row for the client when the evidence supports it. SWOT strengths/weaknesses describe the COMPETITOR; opportunities/threats describe what that means for the CLIENT.`, 2600, diag, 'C');

  const [A, B, C] = await Promise.all([pA, pB, pC]);
  // Merge each group onto the fallback independently, so a failed group only
  // falls back for its own sections.
  let vm = fallback;
  if (A) vm = mergeNarrative(vm, A);
  if (B) vm = mergeNarrative(vm, B);
  if (C) vm = mergeNarrative(vm, C);
  diag.result = (A || B || C) ? 'ai' : 'all-fallback';
  return { vm, diag };
}

// Fill any missing keys from the fallback so the template never sees undefined.
function mergeNarrative(base, got) {
  const out = JSON.parse(JSON.stringify(base));
  const deep = (t, s) => { for (const k of Object.keys(s || {})) { if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k])) { t[k] = t[k] || {}; deep(t[k], s[k]); } else if (s[k] !== undefined && s[k] !== null && !(Array.isArray(s[k]) && s[k].length === 0 && Array.isArray(t[k]) && t[k].length)) { t[k] = s[k]; } } };
  deep(out, got);
  return out;
}

// Deterministic, data-only narrative used when there is no AI key or the model
// fails — still a valid, truthful (if plain) report built purely from numbers.
function fallbackNarrative(data) {
  const c = data.client, k = data.competitor, lead = data.clientLeads;
  const winner = lead ? c : k, loser = lead ? k : c;
  const compKw = data.competitor.topKeywords || [];
  const cliKw = data.client.topKeywords || [];
  return {
    cover: { headlineHtml: `${c.name} vs<br><span>${k.name}</span><br>in search` },
    backCoverHeadlineHtml: `Ready to grow<br><span>${c.name}'s search?</span>`,
    sharedCount: 0,
    exec: {
      title: `${winner.name} leads on the core search numbers today`,
      leadHtml: `This report compares ${c.name} and ${k.name} in Google ${data.market}. ${winner.name} currently ranks for ${fmt(winner.keywords)} keywords versus ${fmt(loser.keywords)}, and draws an estimated ${fmt(winner.visits)} organic visits a month.`,
      kpiNotes: [lead ? `${c.name} ranks for more` : `${k.name} ranks for more`, `Est. organic, Google ${data.market}`, lead ? `${c.name} has more referring domains` : `${k.name} has more referring domains`, 'Keywords both sites rank for'],
      findings: [
        { n: '1', title: 'Keyword footprint.', bodyHtml: `${c.name} ranks for ${fmt(c.keywords)} keywords; ${k.name} for ${fmt(k.keywords)}.`, impact: lead ? 'Info' : 'High', pill: lead ? 'p-n' : 'p-r' },
        { n: '2', title: 'Organic traffic.', bodyHtml: `Estimated visits: ${c.name} ${fmt(c.visits)}/mo, ${k.name} ${fmt(k.visits)}/mo.`, impact: 'Info', pill: 'p-n' },
        { n: '3', title: 'Link authority.', bodyHtml: `Referring domains: ${c.name} ${fmt(c.refdomains)}, ${k.name} ${fmt(k.refdomains)}; domain authority ${fmt(c.domainAuthority)} vs ${fmt(k.domainAuthority)}.`, impact: 'Info', pill: 'p-n' },
      ],
      recommendation: `Build dedicated pages for the high-intent searches in this niche and strengthen ${c.name}'s links to close the gap with ${k.name}.`,
    },
    who: {
      title: 'How the two businesses compare', lead: `Both ${c.name} and ${k.name} operate in the same space; the comparison below is drawn from each site.`,
      rows: [
        { label: 'Website title', compHtml: k.crawl.title || '—', clientHtml: c.crawl.title || '—' },
        { label: 'Homepage focus', compHtml: (k.crawl.metaDesc || '—').slice(0, 140), clientHtml: (c.crawl.metaDesc || '—').slice(0, 140) },
      ],
      compWins: [`Ranks for ${fmt(k.keywords)} keywords.`], clientWins: [`Ranks for ${fmt(c.keywords)} keywords.`], sideNote: '',
    },
    scorecard: { title: lead ? `${c.name} leads on most measures` : `${k.name} leads on most measures`, calloutTitle: 'Reading the numbers', calloutBody: `These figures show where each site stands today in Google ${data.market}. The gaps point to where ${c.name} can realistically win.` },
    ranks: { title: `What ${k.name} ranks for`, lead: `${k.name} ranks for ${fmt(k.keywords)} keywords in Google ${data.market}. The highest-volume ones are listed below.`, rows: compKw.slice(0, 10).map((r) => ({ kw: r.kw, vol: fmt(r.vol), pos: String(r.pos), type: r.pos <= 10 ? 'Buyer search' : 'Other', pill: 'p-o', strong: r.vol >= 50 })), calloutTitle: 'The gap to target', calloutHtml: `Where ${k.name} ranks weakly or not at all, ${c.name} has room to win with dedicated pages.` },
    health: { eyebrow: `${c.name} keyword health check`, title: 'Where the current rankings help — and where they do not', leadHtml: `${c.name} ranks for ${fmt(c.keywords)} keywords. Sorted by intent below.`, wrongTitle: 'Lower-intent rankings', wrong: cliKw.filter((r) => r.pos <= 20).slice(0, 7).map((r) => ({ kw: r.kw, vol: fmt(r.vol), pos: String(r.pos), why: 'Review the intent behind this search' })), rightTitle: 'High-intent rankings to protect and push', right: cliKw.slice(0, 8).map((r) => ({ kw: r.kw, vol: fmt(r.vol), pos: String(r.pos), status: r.pos <= 5 ? 'Keep' : r.pos <= 20 ? 'Push to page 1' : 'Needs own page', pill: r.pos <= 5 ? 'p-g' : r.pos <= 20 ? 'p-o' : 'p-r' })), calloutTitle: 'In plain words', calloutBody: 'The rankings above are the fastest wins — protect the strong ones and push the near-misses onto page one.' },
    tech: { title: 'Website & technical review', clientRows: [{ issue: 'Homepage', sawHtml: `Title: "${c.crawl.title || '—'}". ${c.crawl.metaDesc ? 'Meta description present.' : 'No meta description found.'}`, priority: c.crawl.metaDesc ? 'Strength' : 'Medium', pill: c.crawl.metaDesc ? 'p-g' : 'p-a' }], compRows: [{ issue: 'Homepage', sawHtml: `Title: "${k.crawl.title || '—'}".` }] },
    backlinkLead: 'Backlinks are links from other websites. Google treats them like recommendations: more good ones means more trust.',
    back: { title: lead ? `${c.name} has the stronger link profile` : `${k.name} has the stronger link profile`, compPoints: [`${fmt(k.backlinks)} backlinks from ${fmt(k.refdomains)} websites.`, `Domain authority ${fmt(k.domainAuthority)}.`], clientPoints: [`${fmt(c.backlinks)} backlinks from ${fmt(c.refdomains)} websites.`, `Domain authority ${fmt(c.domainAuthority)}.`], risksTitle: '', risks: [] },
    swot: { strengths: [`Ranks for ${fmt(k.keywords)} keywords.`], weaknesses: ['See website review for specifics.'], opportunities: [`Target the high-intent searches ${k.name} ranks weakly for.`], threats: [`${k.name} could extend its lead if it invests in content.`], calloutTitle: 'The positioning to pursue', calloutBody: `Lead with ${c.name}'s clearest advantage and build content around the searches that bring real buyers.` },
    opp: { title: `The searches ${c.name} should own next`, lead: `Google ${data.market} estimates. Difficulty is on a 0–100 scale — lower is easier to win.`, rows: cliKw.slice(0, 10).map((r) => ({ kw: r.kw, vol: fmt(r.vol), diff: fmt(r.diff), client: r.pos ? String(r.pos) : '—', strong: r.vol >= 50 })), calloutTitle: 'Why this matters', calloutBody: 'Ranking on page one for well-targeted searches produces a steady flow of high-value enquiries.' },
  };
}

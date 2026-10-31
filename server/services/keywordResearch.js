/**
 * Keyword Analysis — data + AI assembly for the Keyword Analysis report.
 *
 * Produces the view model consumed by templates/keywordReport.hbs and the full
 * keyword list for the .xlsx export. Mirrors the StrataSound reference report.
 *
 * Grounding rules (same discipline as the competitor report):
 *   - Every NUMBER (volume, US volume, difficulty/KD, CPC) comes from SE Ranking
 *     — NEVER from the model.
 *   - The keyword UNIVERSE is built from real data: each domain's ranked
 *     keywords + related/similar expansion of the seeds + metrics enrichment.
 *   - The AI only CLUSTERS, LABELS, PRIORITISES and WRITES PROSE around that
 *     real data (topic names, intent, target pages, findings, GEO questions).
 *   - If the AI fails, a deterministic fallback still groups the real keywords.
 *
 * Pipeline (see keywordRunner.js):
 *   crawl client+competitors -> AI seeds from content (+ customer seeds)
 *   -> ranked keywords per domain -> related/similar expansion of seeds
 *   -> metrics enrichment -> dedupe into a universe -> AI clusters+prioritises
 *   -> competitor landscape -> GEO questions -> keyword-to-page plan.
 */
const { callClaude, callAI } = require('./aiVisibility');
const shared = require('./competitorAnalyze');
const { crawlEvidence, parseJson, toDomain, num, fmt, marketLabels, fullDate, monthName } = shared;

// ---- small helpers ---------------------------------------------------------
function normKw(k) { return String(k || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function kFmt(n) {
  // "12.9K" style used in the report tables.
  const v = num(n);
  if (v >= 1000) return (v / 1000).toFixed(v >= 100000 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return String(v);
}
function kdBand(kd) {
  const v = num(kd);
  if (v < 40) return { label: 'easy', pill: 'p-g' };
  if (v < 70) return { label: 'moderate', pill: 'p-a' };
  return { label: 'hard', pill: 'p-r' };
}
function priorityFromKd(kd) {
  const v = num(kd);
  if (v < 40) return 'P1';
  if (v < 70) return 'P2';
  return 'P3';
}
// Rough search-intent label from the keyword wording (for the Excel export).
function intentOf(kw) {
  const k = ' ' + String(kw || '').toLowerCase() + ' ';
  if (/\b(buy|price|pricing|cost|cheap|best|hire|company|agency|services?|near me|quote|custom)\b/.test(k)) return 'Commercial';
  if (/\b(how|what|why|guide|tutorial|vs|alternative|free|ideas?)\b/.test(k)) return 'Informational';
  return 'Commercial';
}

// Normalise a keyword row from any SE Ranking endpoint into one shape:
// { kw, volume (global), usVolume, kd (difficulty), cpc, competition }
function normKwRow(r, opts = {}) {
  if (!r) return null;
  const kw = normKw(r.keyword ?? r.kw ?? r.query ?? r.name);
  if (!kw) return null;
  return {
    kw,
    volume: num(r.volume ?? r.search_volume ?? r.global_volume ?? r.vol),
    usVolume: opts.usVolume != null ? num(opts.usVolume) : num(r.us_volume ?? r.volume_us ?? 0),
    kd: num(r.difficulty ?? r.kd ?? r.competition_index ?? r.keyword_difficulty),
    cpc: num(r.cpc ?? r.cost_per_click),
    competition: num(r.competition ?? r.competition_index),
  };
}

// Pull rows out of whatever envelope an endpoint returns.
function rowsOf(res) {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  return res.data || res.keywords || res.rows || res.result || res.results || [];
}

// ---- SE Ranking: ranked keywords for one domain ----------------------------
// Returns { domain, keywords (count), traffic, trafficValue, da, rows[] }.
async function fetchDomainKeywords(se, domain, source, limit = 250) {
  const safe = async (fn, fb) => { try { return await fn(); } catch (e) { console.error(`[keyword] ${domain} ${e.message}`); return fb; } };
  const [overview, kwRes] = await Promise.all([
    safe(() => se.getDomainOverview(domain, source), {}),
    safe(() => se.getDomainKeywords(domain, source, { limit }), {}),
  ]);
  const org = (overview && overview.organic) || overview || {};
  const rows = rowsOf(kwRes).map((r) => normKwRow(r)).filter(Boolean);
  return {
    domain,
    keywords: num(org.keywords_count ?? org.keywords ?? rows.length),
    traffic: num(org.traffic_sum ?? org.traffic),
    trafficValue: num(org.price_sum ?? org.price),
    da: num(org.domain_trust ?? org.domain_authority ?? 0),
    rows,
  };
}

// ---- SE Ranking: expand a seed keyword -------------------------------------
// related + similar, merged and de-duped. Cheap caps keep credit spend sane.
async function expandSeed(se, seed, source, perSeed = 40) {
  const safe = async (fn) => { try { return await fn(); } catch (e) { console.error(`[keyword] expand "${seed}": ${e.message}`); return null; } };
  const [rel, sim] = await Promise.all([
    safe(() => se.getRelatedKeywords(seed, source, perSeed)),
    safe(() => se.getSimilarKeywords(seed, source, perSeed)),
  ]);
  const out = [];
  for (const res of [rel, sim]) for (const r of rowsOf(res)) { const n = normKwRow(r); if (n) out.push(n); }
  return out;
}

// ---- build the keyword universe (REAL data only) ---------------------------
// Merges: client ranked kw + competitor ranked kw + expanded seeds. US volume
// is taken from the US-database pass; global from the worldwide/primary pass.
// Returns a de-duped map keyword -> row with best-known metrics.
function mergeUniverse(lists) {
  const map = new Map();
  for (const list of lists) for (const r of (list || [])) {
    if (!r || !r.kw) continue;
    const cur = map.get(r.kw);
    if (!cur) { map.set(r.kw, { ...r }); continue; }
    // keep the richest values seen
    cur.volume = Math.max(cur.volume, r.volume);
    cur.usVolume = Math.max(cur.usVolume, r.usVolume);
    cur.kd = cur.kd || r.kd;
    cur.cpc = cur.cpc || r.cpc;
  }
  return map;
}

// ---- AI: derive seed keywords from the crawled site content ----------------
async function deriveSeeds({ anthropicKey, openaiKey }, clientCrawl, compCrawls, clientName, providedSeeds) {
  const fallback = (providedSeeds && providedSeeds.length) ? providedSeeds.slice(0, 12) : [];
  if (!anthropicKey && !openaiKey) return fallback;
  const ev = {
    client: crawlEvidence(clientCrawl),
    competitors: (compCrawls || []).map((c) => crawlEvidence(c)),
    providedSeeds: providedSeeds || [],
  };
  const system = 'You are an SEO keyword strategist. From the website evidence, list the SEED keyword themes to research — the core product/service terms real buyers would search. Short head terms (1-3 words), not long questions. Reply STRICT JSON.';
  const content = `Business: ${clientName}\nEvidence (client site, competitor sites, any seeds the client gave): ${JSON.stringify(ev)}\n\nReturn JSON: {"seeds":["12-20 seed keywords, lowercase, deduped, on-topic"]}`;
  try {
    const j = parseJson(await callAI({ anthropicKey, openaiKey, system, messages: [{ role: 'user', content }], maxTokens: 700, temperature: 0.2 }));
    const seeds = (j && Array.isArray(j.seeds)) ? j.seeds.map(normKw).filter(Boolean) : [];
    const merged = [...new Set([...(providedSeeds || []).map(normKw), ...seeds])].filter(Boolean);
    if (merged.length) return merged.slice(0, 20);
  } catch (e) { console.error('[keyword] deriveSeeds failed:', e.message); }
  return fallback;
}

// ---- AI: cluster + prioritise the universe into topic groups ---------------
// The AI gets the keyword list WITH metrics and returns grouping only — it never
// invents a keyword or a number. We re-attach the real metrics by keyword after.
const CLUSTER_SYSTEM = [
  'You are a senior SEO strategist building a keyword plan for a client, written for a smart business owner (not an SEO).',
  'You are given a list of REAL keywords, each with real metrics (global volume, US volume, difficulty KD 0-100, CPC).',
  'Your job: GROUP them into topic clusters, name each cluster, give each a target page, pick the strongest keywords to RECOMMEND (star), and write short plain-English framing. You also pick the overall recommended set.',
  'HARD RULES:',
  '- NEVER invent a keyword or change a metric. Only use keywords from the given list, spelled exactly.',
  '- Group by what the SEARCHER wants (intent), not by surface words. 6-9 clusters.',
  '- Recommend keywords a NEW or growing site can realistically win (favour lower KD) plus a few strategic head terms.',
  '- Plain, confident British-business English. No hype, no emojis.',
  'Return STRICT, VALID JSON only — no markdown fence, no prose around it.',
].join('\n');

async function clusterKeywords(keys, data) {
  const diag = {};
  const universe = data.universe; // [{kw,volume,usVolume,kd,cpc}]
  const kwOnly = universe.map((r) => ({ kw: r.kw, g: r.volume, u: r.usVolume, kd: r.kd, cpc: r.cpc }));
  const content = `Business: ${data.clientName} (${data.clientDomain}). What it offers: ${JSON.stringify(crawlEvidence(data.clientCrawl))}
Market: ${data.marketLabel}. Recommend about ${data.recommendCount} keywords in total.
KEYWORDS (use ONLY these, exact spelling): ${JSON.stringify(kwOnly)}

Return STRICT JSON:
{
 "clusters":[{"name":"short topic name","targetPage":"/path/ or 'Home page' or 'Blog'","intro":"1 sentence on who searches this and why it fits","keywords":["exact keywords from the list, strongest first"],"recommended":["subset of this cluster's keywords to star"]}],
 "recommendedTotal":<integer count of starred keywords across all clusters>
}
6-9 clusters. Every keyword must come from the list. Put each keyword in exactly one cluster. Order clusters from most commercial/winnable to broadest.`;
  let j = null;
  try {
    j = parseJson(await callAI({ anthropicKey: keys.anthropicKey, openaiKey: keys.openaiKey, system: CLUSTER_SYSTEM, messages: [{ role: 'user', content }], maxTokens: 8000, temperature: 0.2 }));
    diag.cluster = j ? 'ok' : 'parse-failed';
  } catch (e) { diag.cluster = 'error:' + String(e.message).slice(0, 80); }
  return { clusters: (j && Array.isArray(j.clusters)) ? j.clusters : null, diag };
}

// Deterministic fallback clustering: bucket by difficulty band so the report is
// still useful if the AI fails entirely. Real data only.
function fallbackClusters(universe) {
  const byBand = { 'Quick wins (easier to rank)': [], 'Build-up terms (moderate)': [], 'Long-term head terms (hard)': [] };
  for (const r of universe) {
    if (r.kd < 40) byBand['Quick wins (easier to rank)'].push(r.kw);
    else if (r.kd < 70) byBand['Build-up terms (moderate)'].push(r.kw);
    else byBand['Long-term head terms (hard)'].push(r.kw);
  }
  return Object.entries(byBand).filter(([, ks]) => ks.length).map(([name, ks]) => ({
    name, targetPage: '', intro: '', keywords: ks, recommended: ks.slice(0, Math.min(5, ks.length)),
  }));
}

// ---- AI: the surrounding prose (summary, business, GEO, readiness) ---------
const PROSE_SYSTEM = [
  'You are a senior SEO strategist writing a keyword analysis report for a client — a smart business owner, not an SEO.',
  'You are given real data about the business and its keyword plan. Write the narrative sections: summary findings, who the business serves, the GEO/AI-search question list, and website readiness notes.',
  'HARD RULES: never invent a metric; quote site evidence where you can; plain confident British-business English; no hype, no emojis.',
  'Return STRICT, VALID JSON only — no fence, no prose around it.',
].join('\n');

async function generateProse(keys, data) {
  const diag = {};
  const ctx = `Business: ${data.clientName} (${data.clientDomain}).
Site evidence: ${JSON.stringify(crawlEvidence(data.clientCrawl))}
Market: ${data.marketLabel}. Shortlisted ${data.totalKeywords} keywords in ${data.clusterCount} topics; recommending ${data.recommendCount}. Quick wins (KD<40): ${data.quickWins}. Total monthly searches (global): ${data.totalVolume}.
Top clusters: ${JSON.stringify(data.clusterSummaries)}
Client currently ranks for ${data.clientRanksCount} keywords.`;
  const content = `${ctx}

Return STRICT JSON:
{
 "summaryTitle":"a verdict headline, e.g. 'Where <brand> can win in search'",
 "summaryLead":"2-3 sentences: how many ideas researched, how many shortlisted, the total demand, and the ask (choose N for the campaign).",
 "keyFindings":[{"title":"Bold lead-in.","body":"one sharp finding, quote a real number/keyword"}],
 "recommendation":"one-line recommendation for the keyword mix",
 "business":{"title":"What <brand> offers and who searches for it","lead":"2-3 sentences on the product and brand promise (quote the site)","audiences":[{"name":"audience name","desc":"one line"}],"differentTitle":"How <brand> is different","different":"2-3 sentences on the angle that is less crowded in search"},
 "geoIntro":"2-3 sentences on why AI assistants (ChatGPT, Gemini, Perplexity, AI Overviews) matter and what to target",
 "geoTopics":[{"topic":"a topic AI assistants answer in this space","content":"the content we will create","page":"target page"}],
 "geoQuestions":[{"q":"a question a user asks an AI assistant","type":"Real AI prompt|Target prompt","where":"which page answers it"}],
 "readinessIntro":"1-2 sentences framing the technical items found",
 "readiness":[{"found":"what we found","why":"why it matters","fix":"what Qtonix will do"}]
}
Give 4-6 key findings, 3-5 audiences, 5-7 GEO topics, 10-14 GEO questions, 4-6 readiness items. Base readiness on the site evidence (noindex, placeholder text, thin pages, missing meta, broken links) — if evidence is thin, give the standard launch-readiness checks.`;
  let j = null;
  try {
    j = parseJson(await callAI({ anthropicKey: keys.anthropicKey, openaiKey: keys.openaiKey, system: PROSE_SYSTEM, messages: [{ role: 'user', content }], maxTokens: 6000, temperature: 0.2 }));
    diag.prose = j ? 'ok' : 'parse-failed';
  } catch (e) { diag.prose = 'error:' + String(e.message).slice(0, 80); }
  return { prose: j, diag };
}

// ---- assemble the full view model ------------------------------------------
async function buildKeywordViewModel(input) {
  const {
    anthropicKey, openaiKey, source, marketLabel,
    clientName, clientDomain, clientCrawl,
    competitors,        // [{name, domain, keywords, traffic, da, type}]
    clientSide,         // fetchDomainKeywords result for the client
    universe,           // [{kw,volume,usVolume,kd,cpc}] (de-duped, real)
    providedSeeds, preparedBy, preparedByRole, today = new Date(),
    recommendCount = 30,
  } = input;
  const keys = { anthropicKey, openaiKey };
  const diag = { hasAnthropicKey: !!anthropicKey, hasOpenaiKey: !!openaiKey };

  // 1. Cluster (AI) with deterministic fallback.
  const universeByKw = new Map(universe.map((r) => [r.kw, r]));
  const cl = await clusterKeywords(keys, { clientName, clientDomain, clientCrawl, marketLabel, recommendCount, universe });
  Object.assign(diag, cl.diag);
  let clusters = cl.clusters || fallbackClusters(universe);

  // Re-attach REAL metrics to every keyword the AI placed, drop any it invented,
  // and build the rendered rows with ★ + priority + KD band.
  const seenKw = new Set();
  const outClusters = clusters.map((c) => {
    const rec = new Set((c.recommended || []).map(normKw));
    const rows = (c.keywords || []).map(normKw)
      .filter((kw) => universeByKw.has(kw) && !seenKw.has(kw))
      .map((kw) => {
        seenKw.add(kw);
        const r = universeByKw.get(kw);
        return {
          kw, star: rec.has(kw),
          globalVol: kFmt(r.volume), usVol: kFmt(r.usVolume || r.volume),
          kd: r.kd, kdPill: kdBand(r.kd).pill,
          cpc: r.cpc ? '$' + r.cpc.toFixed(2) : '–',
          priority: priorityFromKd(r.kd),
          _vol: r.volume, _usVol: r.usVolume || r.volume, _kd: r.kd, _cpc: r.cpc || 0,
          _intent: intentOf(kw),
        };
      });
    const groupVol = rows.reduce((s, r) => s + r._vol, 0);
    const groupUsVol = rows.reduce((s, r) => s + r._usVol, 0);
    const avgKd = rows.length ? Math.round(rows.reduce((s, r) => s + r._kd, 0) / rows.length) : 0;
    const qw = rows.filter((r) => r._kd < 40).length;
    return {
      name: c.name, targetPage: c.targetPage || '', intro: c.intro || '',
      count: rows.length, recommended: rows.filter((r) => r.star).length,
      volLabel: kFmt(groupVol) + ' global searches/mo', rows,
      _groupVol: groupVol, _groupUsVol: groupUsVol, _avgKd: avgKd, _quickWins: qw,
    };
  }).filter((c) => c.rows.length);

  // 2. Totals (all REAL).
  const allRows = outClusters.flatMap((c) => c.rows);
  const totalKeywords = allRows.length;
  const starred = allRows.filter((r) => r.star).length;
  const quickWins = universe.filter((r) => r.kd < 40).length;
  const totalVolume = universe.reduce((s, r) => s + r.volume, 0);
  const usVolume = universe.reduce((s, r) => s + (r.usVolume || 0), 0);

  // 3. Prose (AI) with fallbacks.
  const clusterSummaries = outClusters.map((c) => ({ name: c.name, count: c.count, vol: c.volLabel, page: c.targetPage }));
  const pr = await generateProse(keys, {
    clientName, clientDomain, clientCrawl, marketLabel,
    totalKeywords, recommendCount: starred || recommendCount, quickWins,
    totalVolume: kFmt(totalVolume), clusterCount: outClusters.length, clusterSummaries,
    clientRanksCount: clientSide ? clientSide.keywords : 0,
  });
  Object.assign(diag, pr.diag);
  const prose = pr.prose || {};

  // 4. Competitor landscape rows (real).
  const landscape = (competitors || []).map((c) => ({
    name: c.name, type: c.type || '—',
    keywords: kFmt(c.keywords), visits: kFmt(c.traffic),
    da: c.da ? String(c.da) : '–',
  }));
  landscape.push({ name: clientName, type: input.clientType || 'This business', keywords: kFmt(clientSide ? clientSide.keywords : 0), visits: kFmt(clientSide ? clientSide.traffic : 0), da: (clientSide && clientSide.da) ? String(clientSide.da) : '–', self: true });

  // 5. Keyword-to-page plan from clusters (one main keyword per page).
  const pagePlan = outClusters.map((c) => {
    const main = c.rows.find((r) => r.star) || c.rows[0];
    return { page: c.targetPage || c.name, mainKeyword: main ? main.kw : '', cluster: c.name };
  });

  const vm = {
    cover: {
      client: clientName, domain: clientDomain,
      marketLabel, date: monthName(today), // monthName already includes the year, e.g. "Nov 2026"
      preparedBy: preparedBy || 'Qtonix', preparedByRole: preparedByRole || 'Project Manager, Qtonix',
    },
    stats: {
      shortlisted: totalKeywords, clusters: outClusters.length,
      recommend: starred || recommendCount,
      volume: kFmt(totalVolume), usVolume: kFmt(usVolume), quickWins,
    },
    summary: {
      title: prose.summaryTitle || `Where ${clientName} can win in search`,
      lead: prose.summaryLead || `We researched keyword ideas around ${clientName}'s offering and shortlisted ${totalKeywords} across ${outClusters.length} topics, together worth about ${kFmt(totalVolume)} searches a month.`,
      findings: Array.isArray(prose.keyFindings) ? prose.keyFindings : [],
      recommendation: prose.recommendation || `Choose a mix of ${starred || recommendCount}: a few head terms plus the easier-to-win terms where this site can reach page one first.`,
    },
    business: prose.business || { title: `What ${clientName} offers and who searches for it`, lead: '', audiences: [], differentTitle: 'How it is different', different: '' },
    landscape,
    clusters: outClusters,
    pagePlan,
    geo: {
      intro: prose.geoIntro || 'AI assistants now answer many how-to questions directly and name the tools they trust. These are the questions to be named in.',
      questions: Array.isArray(prose.geoQuestions) ? prose.geoQuestions : [],
    },
    readiness: {
      intro: prose.readinessIntro || 'A few technical items will stop the site ranking until fixed; Qtonix handles these as part of set-up.',
      rows: Array.isArray(prose.readiness) ? prose.readiness : [],
    },
    // Structured data for the multi-sheet .xlsx export (raw numbers, so Excel
    // can sum/filter). Sheet 1 keywords, Sheet 2 cluster summary, Sheet 3 GEO.
    export: {
      client: clientName, domain: clientDomain, recommendCount: starred || recommendCount,
      keywords: allRows.map((r, i) => {
        const cl2 = outClusters.find((c) => c.rows.includes(r));
        return {
          n: i + 1, keyword: r.kw, cluster: cl2 ? cl2.name : '', targetPage: cl2 ? (cl2.targetPage || cl2.name) : '',
          globalVol: r._vol, usVol: r._usVol, kd: r._kd, intent: r._intent,
          cpc: r._cpc, priority: r.priority, recommended: r.star ? '★' : '', selection: r.star ? 'X' : '',
        };
      }),
      clusters: outClusters.map((c) => ({
        name: c.name, targetPage: c.targetPage || c.name, count: c.count,
        globalVol: c._groupVol, usVol: c._groupUsVol, avgKd: c._avgKd, quickWins: c._quickWins, recommended: c.recommended,
      })),
      geoTopics: Array.isArray(prose.geoTopics) ? prose.geoTopics : [],
      geoQuestions: Array.isArray(prose.geoQuestions) ? prose.geoQuestions : [],
    },
    _diag: diag,
  };
  return vm;
}

module.exports = {
  normKw, kFmt, kdBand, priorityFromKd, normKwRow, rowsOf,
  fetchDomainKeywords, expandSeed, mergeUniverse,
  deriveSeeds, clusterKeywords, fallbackClusters,
  generateProse, buildKeywordViewModel,
};

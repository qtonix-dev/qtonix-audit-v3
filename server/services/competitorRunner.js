/**
 * Competitor Analysis runner: fetch SE Ranking for both domains → crawl both
 * sites → build the view model (data + grounded AI narrative + verification) →
 * render to PDF/HTML. Stored on the PreSeoReport row with kind='competitor'.
 *
 * Mirrors preSeoRunner's status/progress lifecycle so the existing Reports UI
 * (polling + view + download + share) works unchanged.
 */
const crawler = require('./crawler');
const { SERanking } = require('./seranking');
const { renderCompetitor } = require('./renderer');
const analyze = require('./competitorAnalyze');

async function setStatus(id, patch) {
  const { PreSeoReport } = require('../models');
  const r = await PreSeoReport.findByPk(id);
  if (!r) return;
  Object.assign(r, patch);
  await r.save();
}

// Full pipeline: data → narrative → render. Fire-and-forget from the route.
async function run(reportId) {
  const { PreSeoReport, Settings } = require('../models');
  try {
    const report = await PreSeoReport.findByPk(reportId);
    if (!report) return;
    const opts = report.runOptions || {};
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const anthropicKey = s && s.getKey ? s.getKey('anthropic') : null;
    const openaiKey = s && s.getKey ? s.getKey('openai') : null;
    const serKey = s && s.getKey ? s.getKey('seranking') : null;
    const psKey = s && s.getKey ? s.getKey('pagespeed') : null;

    const clientSite = report.website;
    const competitorSite = opts.competitorSite || opts.competitorWebsite || '';
    const clientName = report.businessName || analyze.toDomain(clientSite);
    const competitorName = opts.competitorName || analyze.toDomain(competitorSite);

    // 1. Crawl both sites (free, parallel). Needed for evidence + market pick.
    await setStatus(reportId, { status: 'capturing', progress: 12, currentStep: 'Reading both websites' });
    const [clientCrawl, compCrawl] = await Promise.all([
      crawler.runTechnicalAudit(clientSite, psKey).catch((e) => { console.error('[competitor] client crawl:', e.message); return {}; }),
      crawler.runTechnicalAudit(competitorSite, psKey).catch((e) => { console.error('[competitor] comp crawl:', e.message); return {}; }),
    ]);

    // ---- SE Ranking 24h cache ---------------------------------------------
    // SE Ranking data barely moves day to day, and every overview/keywords/
    // backlinks call costs credits. So on a re-run within SE_CACHE_HOURS of the
    // last fetch — for the SAME client domain, competitor domain and chosen
    // market — we reuse the stored SE Ranking payloads and SKIP all SE Ranking
    // calls (market probe + both fetchSide). The crawl and the AI write-up are
    // free, so those still run fresh, which is usually the point of a re-run.
    // A user who wants genuinely fresh numbers can force it (see forceData).
    const SE_CACHE_HOURS = 24;
    const cache = opts.seCache || null;
    const chosen = String(opts.source || opts.market || '').toLowerCase();
    const forceData = !!opts.forceData; // set by a "fresh data" re-run; cleared after
    const clientDomain = analyze.toDomain(clientSite);
    const compDomain = analyze.toDomain(competitorSite);
    const cacheAgeHrs = cache && cache.fetchedAt ? (Date.now() - new Date(cache.fetchedAt).getTime()) / 36e5 : Infinity;
    const cacheMarketOk = cache && (!chosen || !analyze.marketLabels(chosen) || cache.source === chosen);
    const cacheFresh = !forceData && cache && cache.clientSide && cache.compSide
      && cache.clientDomain === clientDomain && cache.compDomain === compDomain
      && cacheMarketOk && cacheAgeHrs < SE_CACHE_HOURS;

    let source, clientStronghold, clientSide, compSide;

    if (cacheFresh) {
      // Reuse stored SE Ranking data — no API calls, no credits spent.
      console.log(`[competitor] reusing SE Ranking cache for report ${reportId} (age ${cacheAgeHrs.toFixed(1)}h < ${SE_CACHE_HOURS}h) — no credits spent`);
      await setStatus(reportId, { status: 'analyzing', progress: 45, currentStep: 'Reusing recent search data (fetched within 24h) — no new credits used' });
      source = cache.source;
      clientStronghold = cache.clientStronghold || null;
      clientSide = cache.clientSide;
      compSide = cache.compSide;
    } else {
      if (!serKey) {
        await setStatus(reportId, { status: 'failed', error: 'SE Ranking API key not configured. Add it in Admin → API keys.' });
        return;
      }
      const se = new SERanking(serKey);

      // 2. Resolve the market. Always probe both domains across markets (cheap) so
      // we know where each is strongest. Primary market = the user's choice if set,
      // else the COMPETITOR's strongest market (their home turf). ALWAYS compute the
      // client's stronghold relative to the primary market, so if the client is
      // strongest elsewhere the report notes it — even when a market was chosen.
      await setStatus(reportId, { progress: 30, currentStep: 'Choosing the best market to compare in' });
      const aiGuess = await analyze.suggestMarket({ anthropicKey, clientCrawl, compCrawl });
      const resolved = await analyze.resolveMarkets(se, clientDomain, compDomain, { aiGuess, clientCrawl, compCrawl, primaryOverride: (chosen && analyze.marketLabels(chosen)) ? chosen : null });
      source = (chosen && analyze.marketLabels(chosen)) ? chosen : (resolved.market || 'us');
      clientStronghold = resolved.clientStronghold;

      // 3. SE Ranking for both domains.
      await setStatus(reportId, { status: 'analyzing', progress: 45, currentStep: `Fetching Google ${analyze.marketLabels(source)[1]} data for both sites` });
      [clientSide, compSide] = await Promise.all([
        analyze.fetchSide(se, clientDomain, source),
        analyze.fetchSide(se, compDomain, source),
      ]);
    }

    // 4. Build the view model (code owns numbers; AI owns prose; then verify).
    await setStatus(reportId, { status: 'analyzing', progress: 68, currentStep: 'Writing and fact-checking the analysis' });
    const vm = await analyze.buildCompetitorViewModel({
      anthropicKey, openaiKey, source, clientName, competitorName,
      clientSide, compSide, clientCrawl, compCrawl, clientStronghold,
      preparedBy: opts.preparedBy || report.createdByName || 'Qtonix',
      preparedByRole: opts.preparedByRole || 'Project Manager, Qtonix',
      preparedFor: opts.preparedFor || clientName,
    });
    const aiDiag = vm._aiDiag || {}; delete vm._aiDiag;
    console.log('[competitor] narrative diagnostics for report', reportId, JSON.stringify(aiDiag));

    // Persist the view model as `data` + the raw crawl for later re-runs, and
    // cache the raw SE Ranking payloads so a re-run within 24h (same domains +
    // market) can reuse them and spend no credits. If this run reused the cache,
    // keep the ORIGINAL fetchedAt so the 24h window is measured from the real
    // fetch, not from each re-run. Clear forceData so it's a one-shot override.
    const seCache = {
      clientDomain, compDomain, source,
      fetchedAt: (cacheFresh && cache && cache.fetchedAt) ? cache.fetchedAt : new Date().toISOString(),
      clientSide, compSide, clientStronghold,
    };
    const nextOpts = { ...opts, source, competitorName, competitorSite, aiDiag, seCache };
    delete nextOpts.forceData;
    await setStatus(reportId, {
      data: vm, crawl: { client: analyze.crawlEvidence(clientCrawl), competitor: analyze.crawlEvidence(compCrawl) },
      runOptions: nextOpts,
      status: 'rendering', progress: 85, currentStep: 'Rendering the report',
    });

    // 5. Render PDF + HTML.
    const slug = `${analyze.toDomain(clientSite)}-vs-${analyze.toDomain(competitorSite)}-${report.id}`;
    const out = await renderCompetitor(vm, slug);
    await setStatus(reportId, {
      ...out, status: 'complete', completedAt: new Date(), progress: 100, currentStep: 'Complete',
    });
  } catch (e) {
    console.error('[competitorRunner] failed:', e);
    await setStatus(reportId, { status: 'failed', error: String(e.message || e).slice(0, 1000) });
  }
}

// Re-render from the stored view model without re-fetching data (cheap; no credits).
async function regenerate(reportId) {
  const { PreSeoReport } = require('../models');
  const report = await PreSeoReport.findByPk(reportId);
  if (!report || !report.data || !report.data.cover) throw new Error('No stored report to regenerate.');
  await setStatus(reportId, { status: 'rendering', currentStep: 'Re-rendering', progress: 85 });
  const opts = report.runOptions || {};
  const slug = `${report.domain}-vs-${analyze.toDomain(opts.competitorSite || '')}-${report.id}`;
  const out = await renderCompetitor(report.data, slug);
  await setStatus(reportId, { ...out, status: 'complete', completedAt: new Date(), progress: 100, currentStep: 'Complete' });
}

module.exports = { run, regenerate };

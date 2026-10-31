/**
 * Keyword Analysis runner: crawl the client + competitor sites -> derive seed
 * keywords from content (+ any the customer gave) -> pull ranked keywords for
 * each domain -> expand the seeds via related/similar -> enrich + merge into a
 * real keyword universe -> build the view model (AI clusters/prioritises/writes
 * prose) -> render PDF/HTML + .xlsx. Stored on PreSeoReport with kind='keyword'.
 *
 * Mirrors competitorRunner's status/progress lifecycle and 24h SE Ranking cache
 * so the existing Reports UI (poll/view/download/share) works unchanged.
 */
const crawler = require('./crawler');
const { SERanking } = require('./seranking');
const { renderKeyword } = require('./renderer');
const kw = require('./keywordResearch');
const analyze = require('./competitorAnalyze'); // reuse toDomain, marketLabels, crawlEvidence

async function setStatus(id, patch) {
  const { PreSeoReport } = require('../models');
  const r = await PreSeoReport.findByPk(id);
  if (!r) return;
  Object.assign(r, patch);
  await r.save();
}

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

    const clientSiteUrl = report.website;
    const clientName = report.businessName || analyze.toDomain(clientSiteUrl);
    const clientDomain = analyze.toDomain(clientSiteUrl);
    const competitorSites = (opts.competitorSites || []).filter(Boolean);
    const providedSeeds = (opts.seeds || []).map(kw.normKw).filter(Boolean);

    // 1. Crawl client + competitors (free, parallel).
    await setStatus(reportId, { status: 'capturing', progress: 10, currentStep: 'Reading the websites' });
    const [clientCrawl, ...compCrawls] = await Promise.all([
      crawler.runTechnicalAudit(clientSiteUrl, psKey).catch((e) => { console.error('[keyword] client crawl:', e.message); return {}; }),
      ...competitorSites.map((u) => crawler.runTechnicalAudit(u, psKey).catch((e) => { console.error('[keyword] comp crawl:', e.message); return {}; })),
    ]);

    if (!serKey) { await setStatus(reportId, { status: 'failed', error: 'SE Ranking API key not configured. Add it in Admin → API keys.' }); return; }

    // Market: explicit choice, else US (the report shows global + US volumes).
    const source = (String(opts.source || opts.market || '').toLowerCase()) || 'us';
    const marketLabel = analyze.marketLabels(source)[0];

    // --- 24h SE Ranking cache (same client+competitors+market) ---------------
    const SE_CACHE_HOURS = 24;
    const cache = opts.seCache || null;
    const forceData = !!opts.forceData;
    const sig = [clientDomain, ...competitorSites.map(analyze.toDomain)].sort().join('|') + '::' + source + '::' + providedSeeds.sort().join(',');
    const ageHrs = cache && cache.fetchedAt ? (Date.now() - new Date(cache.fetchedAt).getTime()) / 36e5 : Infinity;
    const cacheFresh = !forceData && cache && cache.sig === sig && cache.universe && cache.clientSide && ageHrs < SE_CACHE_HOURS;

    let clientSide, competitors, universe, seeds;

    if (cacheFresh) {
      console.log(`[keyword] reusing SE Ranking cache for report ${reportId} (age ${ageHrs.toFixed(1)}h) — no credits spent`);
      await setStatus(reportId, { status: 'analyzing', progress: 45, currentStep: 'Reusing recent search data (within 24h) — no new credits used' });
      ({ clientSide, competitors, universe, seeds } = cache);
    } else {
      const se = new SERanking(serKey);

      // 2. Derive seeds from content (+ customer seeds).
      await setStatus(reportId, { status: 'analyzing', progress: 25, currentStep: 'Finding the best keyword themes from the site' });
      seeds = await kw.deriveSeeds({ anthropicKey, openaiKey }, clientCrawl, compCrawls, clientName, providedSeeds);

      // 3. Ranked keywords for client + each competitor (real).
      await setStatus(reportId, { status: 'analyzing', progress: 45, currentStep: `Fetching Google ${marketLabel} keyword data` });
      const sideResults = await Promise.all([
        kw.fetchDomainKeywords(se, clientDomain, source, 250),
        ...competitorSites.map((u) => kw.fetchDomainKeywords(se, analyze.toDomain(u), source, 150)),
      ]);
      clientSide = sideResults[0];
      const compSides = sideResults.slice(1);
      competitors = compSides.map((cs, i) => ({
        name: (opts.competitorNames && opts.competitorNames[i]) || analyze.toDomain(competitorSites[i]),
        domain: cs.domain, keywords: cs.keywords, traffic: cs.traffic, da: cs.da,
        type: (opts.competitorTypes && opts.competitorTypes[i]) || '',
      }));

      // 4. Expand seeds (cap breadth for predictable credit spend).
      await setStatus(reportId, { status: 'analyzing', progress: 62, currentStep: 'Researching related keywords around the themes' });
      const seedCap = Math.min(seeds.length, 12);
      const expansions = await Promise.all(seeds.slice(0, seedCap).map((sd) => kw.expandSeed(se, sd, source, 40)));

      // 5. Merge everything into one real universe, de-duped.
      const universeMap = kw.mergeUniverse([
        clientSide.rows,
        ...compSides.map((cs) => cs.rows),
        ...expansions,
        seeds.map((sd) => ({ kw: sd, volume: 0, usVolume: 0, kd: 0, cpc: 0 })), // ensure seeds are present
      ]);
      // Enrich seed rows that still lack metrics, in one metrics call.
      const needMetrics = [...universeMap.values()].filter((r) => !r.volume).map((r) => r.kw).slice(0, 100);
      if (needMetrics.length) {
        try {
          const m = await se.getKeywordsMetrics(needMetrics, source);
          for (const row of kw.rowsOf(m)) { const n = kw.normKwRow(row); if (n && universeMap.has(n.kw)) { const cur = universeMap.get(n.kw); cur.volume = n.volume || cur.volume; cur.kd = n.kd || cur.kd; cur.cpc = n.cpc || cur.cpc; } }
        } catch (e) { console.error('[keyword] metrics enrich:', e.message); }
      }
      // Keep only keywords with real demand; sort by volume; cap the universe.
      universe = [...universeMap.values()].filter((r) => r.volume > 0).sort((a, b) => b.volume - a.volume).slice(0, 200);
    }

    // 6. Build the view model.
    await setStatus(reportId, { status: 'analyzing', progress: 75, currentStep: 'Grouping keywords and writing the report' });
    const vm = await kw.buildKeywordViewModel({
      anthropicKey, openaiKey, source, marketLabel,
      clientName, clientDomain, clientCrawl,
      competitors, clientSide, universe, providedSeeds: seeds,
      preparedBy: opts.preparedBy || report.createdByName || 'Qtonix',
      preparedByRole: opts.preparedByRole || 'Project Manager, Qtonix',
      recommendCount: opts.recommendCount || 30,
    });
    const aiDiag = vm._diag || {}; delete vm._diag;
    const exportData = vm.export || {}; // structured 3-sheet payload for the xlsx
    console.log('[keyword] diagnostics for report', reportId, JSON.stringify(aiDiag));

    // Persist + refresh cache.
    const seCache = { sig, fetchedAt: (cacheFresh && cache && cache.fetchedAt) ? cache.fetchedAt : new Date().toISOString(), clientSide, competitors, universe, seeds };
    const nextOpts = { ...opts, source, seCache, aiDiag };
    delete nextOpts.forceData;
    await setStatus(reportId, {
      data: vm, crawl: { client: analyze.crawlEvidence(clientCrawl) },
      runOptions: nextOpts, status: 'rendering', progress: 88, currentStep: 'Rendering the report',
    });

    // 7. Render PDF + HTML + xlsx.
    const slug = `${clientDomain}-keyword-analysis-${report.id}`;
    const out = await renderKeyword(vm, slug, exportData);
    // The model has no xlsx columns; the xlsx is served from the local path
    // (derived from pdfPath) and, if uploaded, its URL is stashed in runOptions.
    const { xlsxUrl, xlsxFileId, xlsxPath, ...persist } = out;
    const finalOpts = { ...nextOpts };
    if (xlsxUrl) finalOpts.xlsxUrl = xlsxUrl;
    await setStatus(reportId, { ...persist, runOptions: finalOpts, status: 'complete', completedAt: new Date(), progress: 100, currentStep: 'Complete' });
  } catch (e) {
    console.error('[keywordRunner] failed:', e);
    await setStatus(reportId, { status: 'failed', error: String(e.message || e).slice(0, 1000) });
  }
}

module.exports = { run };

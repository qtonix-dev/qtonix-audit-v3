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
    const chosen = String(opts.source || opts.market || '').toLowerCase();
    const aiGuess = await analyze.suggestMarket({ anthropicKey, clientCrawl, compCrawl });
    const resolved = await analyze.resolveMarkets(se, analyze.toDomain(clientSite), analyze.toDomain(competitorSite), { aiGuess, clientCrawl, compCrawl, primaryOverride: (chosen && analyze.marketLabels(chosen)) ? chosen : null });
    let source = (chosen && analyze.marketLabels(chosen)) ? chosen : (resolved.market || 'us');
    let clientStronghold = resolved.clientStronghold;

    // 3. SE Ranking for both domains.
    await setStatus(reportId, { status: 'analyzing', progress: 45, currentStep: `Fetching Google ${analyze.marketLabels(source)[1]} data for both sites` });
    const [clientSide, compSide] = await Promise.all([
      analyze.fetchSide(se, analyze.toDomain(clientSite), source),
      analyze.fetchSide(se, analyze.toDomain(competitorSite), source),
    ]);

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

    // Persist the view model as `data` + the raw crawl for later re-runs.
    await setStatus(reportId, {
      data: vm, crawl: { client: analyze.crawlEvidence(clientCrawl), competitor: analyze.crawlEvidence(compCrawl) },
      runOptions: { ...opts, source, competitorName, competitorSite, aiDiag },
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

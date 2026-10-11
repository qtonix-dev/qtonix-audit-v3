/**
 * Brand Guideline runner: crawl the client's website → harvest its real images,
 * palette and fonts → have the AI write the full guideline grounded in that
 * material → render the landscape PDF and store it on ImageKit.
 *
 * Shares the PreSeoReport table (distinguished by kind='brand_guideline') so it
 * reuses the same status/progress/sharing/ImageKit plumbing. The report.data
 * holds the guideline payload the brandGuideline.hbs template consumes.
 */
const { PreSeoReport, Settings } = require('../models');
const crawler = require('./crawler');
const { buildGuidelineData } = require('./brandGuidelineAnalyze');
const { renderBrandGuideline } = require('./renderer');

function istNow() { return new Date(Date.now() + 330 * 60000); }
function monthYear() { return istNow().toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).toUpperCase(); }

async function setStatus(id, patch) {
  try { const r = await PreSeoReport.findByPk(id); if (r) { Object.assign(r, patch); await r.save(); } } catch {}
}

// Reuse the Pre-SEO logo extractor so the cover/logo pages get the real mark.
function logoFor(crawl, domain) {
  const html = (crawl && crawl.html) || '';
  const base = (crawl && crawl.finalUrl) || (domain ? `https://${domain}` : '');
  const abs = (u) => { try { return new URL(u, base).href; } catch { return ''; } };
  const attr = (tag, name, val) => {
    const re = new RegExp(`<${tag}[^>]*${name}=["']${val}["'][^>]*>`, 'i');
    const m = html.match(re); if (!m) return '';
    const h = m[0].match(/(?:href|content)=["']([^"']+)["']/i);
    return h ? abs(h[1]) : '';
  };
  const touch = attr('link', 'rel', 'apple-touch-icon') || attr('link', 'rel', 'apple-touch-icon-precomposed');
  if (touch) return touch;
  const iconM = html.match(/<link[^>]*rel=["'][^"']*icon[^"']*["'][^>]*>/i);
  if (iconM) { const h = iconM[0].match(/href=["']([^"']+)["']/i); if (h) { const u = abs(h[1]); if (u && !/\.ico(\?|$)/i.test(u)) return u; } }
  const og = attr('meta', 'property', 'og:image') || attr('meta', 'name', 'og:image');
  if (og) return og;
  const d = (domain || base || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  return d ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=128` : '';
}

// Full pipeline: crawl → harvest → AI → data (status 'ready' for review).
async function run(reportId) {
  const report = await PreSeoReport.findByPk(reportId);
  if (!report) return;
  try {
    const s = await Settings.findOne();
    const anthropicKey = s && s.getKey ? s.getKey('anthropic') : null;
    const openaiKey = s && s.getKey ? s.getKey('openai') : null;
    const ro = report.runOptions || {};

    await setStatus(reportId, { status: 'capturing', progress: 12, currentStep: 'Fetching the website' });
    let crawl = {};
    try { crawl = await crawler.crawlHomepage(report.website); } catch (e) { console.error('[brandGuide] crawl failed:', e.message); }
    crawl.website = report.website; crawl.domain = report.domain;

    await setStatus(reportId, { crawl, status: 'analyzing', progress: 45, currentStep: 'Harvesting images, colours and fonts' });
    const assets = crawler.harvestBrandAssets(crawl.html || '', crawl.finalUrl || report.website);

    // User overrides from the wizard (optional).
    const colorOverrides = Array.isArray(ro.colorOverrides) && ro.colorOverrides.length ? ro.colorOverrides : null;
    const logo = ro.logoUrl || logoFor(crawl, report.domain);

    const meta = {
      businessName: report.businessName || report.domain,
      website: report.website,
      industry: ro.industry || '',
      audiences: Array.isArray(ro.audiences) ? ro.audiences : (ro.audiences ? String(ro.audiences).split(/[,;]/).map((x) => x.trim()).filter(Boolean) : []),
      postsPerMonth: Number(ro.postsPerMonth) || 10,
      platforms: Array.isArray(ro.platforms) && ro.platforms.length ? ro.platforms : ['Instagram', 'Facebook', 'YouTube'],
      cadence: ro.cadence || '',
      peakSeason: ro.peakSeason || '',
      tone: ro.tone || '',
      logo,
      colorOverrides,
      fontOverride: ro.fontOverride || '',
      monthYear: monthYear(),
      preparedBy: report.createdByName ? `${report.createdByName}, Project Manager` : 'Adam G, Project Manager',
      preparedByRole: 'Project Manager',
      contactEmail: ro.contactEmail || 'adam@qtonix.com',
      contactPhone: '+91-8249016547',
    };

    await setStatus(reportId, { progress: 60, currentStep: 'Writing the guideline with AI' });
    const data = await buildGuidelineData(crawl, assets, meta, { anthropicKey, openaiKey });

    await setStatus(reportId, { data, status: 'ready', progress: 100, currentStep: 'Ready for review' });
  } catch (e) {
    console.error('[brandGuide] run failed:', e.message);
    await setStatus(reportId, { status: 'failed', error: String(e.message || e).slice(0, 1000) });
  }
}

// Render the PDF from the (possibly user-edited) data.
async function generate(reportId) {
  const report = await PreSeoReport.findByPk(reportId);
  if (!report || !report.data || !report.data.report) throw new Error('Guideline not analysed yet.');
  try {
    const ik = require('./imagekit');
    if (report.pdfFileId) ik.deleteFile(report.pdfFileId).catch(() => {});
    if (report.htmlFileId) ik.deleteFile(report.htmlFileId).catch(() => {});
  } catch {}
  await setStatus(reportId, { status: 'rendering', currentStep: 'Generating PDF' });
  const { pdfPath, htmlPath, pdfUrl, htmlUrl, pdfFileId, htmlFileId } =
    await renderBrandGuideline(report.data, `${report.domain}-${report.id}`);
  await setStatus(reportId, { status: 'complete', pdfPath, htmlPath, pdfUrl, htmlUrl, pdfFileId, htmlFileId, completedAt: new Date(), currentStep: 'Complete', progress: 100 });
  return { pdfPath, htmlPath, pdfUrl, htmlUrl };
}

module.exports = { run, generate, setStatus };

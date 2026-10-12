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

    await setStatus(reportId, { crawl, status: 'analyzing', progress: 40, currentStep: 'Harvesting images, colours and fonts' });
    const assets = crawler.harvestBrandAssets(crawl.html || '', crawl.finalUrl || report.website);

    // Multi-page crawl: visit About / Products / Services / product pages so the
    // guideline has REAL product photos and accurate "what we sell / who we
    // serve" copy, not just the homepage. Product-page images are tagged
    // 'product' and lead the product pool; everything merges into the asset set.
    let keyPages = { images: [], productImages: [], mergedText: '', mergedH1s: [], mergedH2s: [], pages: [] };
    try {
      await setStatus(reportId, { progress: 48, currentStep: 'Reading product & key pages' });
      keyPages = await crawler.crawlKeyPages(report.website, crawl);
    } catch (e) { console.error('[brandGuide] key-page crawl failed:', e.message); }
    if (keyPages.images && keyPages.images.length) {
      // Dedup against what the homepage already gave us.
      const have = new Set((assets.images || []).map((i) => i.url));
      const add = keyPages.images.filter((i) => i && i.url && !have.has(i.url));
      assets.images = [...(assets.images || []), ...add];
    }
    // Feed the richer, multi-page text + headings to the AI writer.
    crawl.multiPageText = keyPages.mergedText || '';
    crawl.h1s = [...new Set([...(crawl.h1s || []), ...(keyPages.mergedH1s || [])])];
    crawl.h2s = [...new Set([...(crawl.h2s || []), ...(keyPages.mergedH2s || [])])];
    crawl.serviceSignals = [...new Set([...(crawl.serviceSignals || []), ...(keyPages.mergedH2s || [])])].slice(0, 80);

    // Merge any images the user uploaded on the review step — they take priority
    // (prepended) so the user's own photos lead the pool, over the site-pulled ones.
    const extraImages = Array.isArray(ro.extraImages) ? ro.extraImages.filter((i) => i && i.url) : [];
    if (extraImages.length) {
      assets.images = [...extraImages.map((i) => ({ url: i.url, alt: i.alt || '', kind: i.kind || 'lifestyle', uploaded: true })), ...(assets.images || [])];
    }
    // Honour deletions: photos the user removed on the review step stay out.
    const removedUrls = new Set(Array.isArray(ro.removedImages) ? ro.removedImages : []);
    if (removedUrls.size) assets.images = (assets.images || []).filter((i) => !removedUrls.has(i.url));

    // User overrides from the wizard (optional).
    const colorOverrides = Array.isArray(ro.colorOverrides) && ro.colorOverrides.length ? ro.colorOverrides : null;
    // Logo priority: user-uploaded/URL override → the REAL site wordmark the
    // harvester found → logoFor() (which may fall back to a favicon). Never use
    // the tiny Google-favicon fallback when a proper logo was harvested.
    const harvestedLogo = assets.logo || '';
    const logo = ro.logoUrl || ro.logoFull || harvestedLogo || logoFor(crawl, report.domain);
    // Whether we have a GENUINE logo (user-uploaded or harvested from the site),
    // as opposed to only a favicon fallback. When false, the UI prompts the user
    // to upload the four logo versions, since AI can't reproduce a logo reliably.
    const hasRealLogo = !!(ro.logoUrl || ro.logoFull || harvestedLogo);
    // The four explicit versions (user-uploaded); each falls back to the primary.
    const logos = {
      full: ro.logoFull || ro.logoUrl || harvestedLogo || '',
      reverse: ro.logoReverse || '',
      one: ro.logoOne || '',
      icon: ro.logoIcon || '',
    };

    const meta = {
      businessName: report.businessName || report.domain,
      website: report.website,
      industry: ro.industry || '',
      whatTheySell: ro.whatTheySell || '',
      audiences: Array.isArray(ro.audiences) ? ro.audiences : (ro.audiences ? String(ro.audiences).split(/[,;]/).map((x) => x.trim()).filter(Boolean) : []),
      postsPerMonth: Number(ro.postsPerMonth) || 10,
      platforms: Array.isArray(ro.platforms) && ro.platforms.length ? ro.platforms : ['Instagram', 'Facebook', 'YouTube'],
      cadence: ro.cadence || '',
      peakSeason: ro.peakSeason || '',
      tone: ro.tone || '',
      logo,
      logos,
      hasRealLogo,
      coverImageUrl: ro.coverImageUrl || '',
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

// ---------------------------------------------------------------------------
// Pre-download AI verification for a brand guideline. Checks the factual bits
// the guideline asserts — business name, tagline, and the contact details on
// the back cover — against the crawl evidence, and flags mismatches (e.g. the
// brand name on the site differs from what the guideline shows). Same resolve-
// in-a-popup pattern as the Pre-SEO report.
// ---------------------------------------------------------------------------
async function verify(reportId) {
  const report = await PreSeoReport.findByPk(reportId);
  if (!report || !report.data) throw new Error('Guideline not analysed yet.');
  const data = report.data;
  const crawl = report.crawl || {};
  const nap = (crawl.nap) || {};
  const f = data.foundation || {};

  const cur = {
    name: (data.report && data.report.business) || report.businessName || '',
    tagline: f.tagline || '',
    contactEmail: data.contactEmail || '',
    contactPhone: data.contactPhone || '',
  };
  const evidence = {
    domain: crawl.domain || report.domain,
    siteBrand: (crawl.brand && crawl.brand.primary) || '',
    schemaName: (nap.schema && nap.schema.schemaName) || (nap.name) || '',
    pageName: (nap.schema && nap.schema.pageName) || '',
    title: crawl.title || '',
    guidelineName: cur.name,
    guidelineTagline: cur.tagline,
    bodyTextSample: (crawl.bodyTextSample || '').slice(0, 1200),
  };

  let ai = null;
  try {
    const s = await Settings.findOne();
    const anthropicKey = s && s.getKey ? s.getKey('anthropic') : null;
    const openaiKey = s && s.getKey ? s.getKey('openai') : null;
    if (anthropicKey || openaiKey) {
      const { callAI } = require('./aiVisibility');
      const sys = 'You QA a brand guideline before it is sent to a client. Compare the name and tagline the guideline shows against the evidence from the website. Flag anything that looks wrong or inconsistent (e.g. the brand name differs from the site, the tagline is marketing fluff not grounded in the site). Output ONLY JSON.';
      const prompt = `Evidence:\n${JSON.stringify(evidence, null, 2)}\n\nReturn JSON exactly:\n{ "checks":[ { "id":"name|tagline", "verdict":"ok|fix|uncertain", "suggestion":"recommended value or empty", "confidence":0-100, "note":"one short reason" } ] }`;
      const out = await callAI({ anthropicKey, openaiKey, system: sys, messages: [{ role: 'user', content: prompt }], maxTokens: 600 });
      try { ai = JSON.parse((out || '').replace(/```json|```/g, '').trim()); } catch { ai = null; }
    }
  } catch (e) { console.error('[brandGuide] verify AI failed:', e.message); }

  const aiByField = {}; if (ai && Array.isArray(ai.checks)) for (const c of ai.checks) if (c && c.id) aiByField[c.id] = c;

  // Rule-based brand-name mismatch (works even without AI).
  const soft = (x) => String(x || '').toLowerCase().replace(/\b(inc|ltd|llc|corp|co|the|company|limited)\b/g, '').replace(/[^a-z0-9]/g, '');
  const same = (a, b) => { const x = soft(a), y = soft(b); return x && y && (x === y || x.includes(y) || y.includes(x)); };
  const siteName = evidence.schemaName || evidence.siteBrand || evidence.pageName || '';
  const nameMismatch = siteName && cur.name && !same(siteName, cur.name);

  const mk = (id, label, current, ruleVerdict, ruleNote) => {
    const a = aiByField[id] || {};
    const rank = { fix: 2, uncertain: 1, ok: 0 };
    const v = (rank[ruleVerdict || 'ok'] >= rank[a.verdict || 'ok']) ? (ruleVerdict || a.verdict || 'ok') : a.verdict;
    return { id, label, current, aiSuggestion: a.suggestion != null ? String(a.suggestion) : (ruleVerdict === 'fix' ? siteName : ''), aiConfidence: a.confidence != null ? a.confidence : null, aiVerdict: v || 'ok', note: a.note || ruleNote || '' };
  };

  const checks = [
    mk('name', 'Brand name', cur.name, nameMismatch ? 'fix' : (cur.name ? 'ok' : 'uncertain'), nameMismatch ? `The site's brand name looks like "${siteName}", which differs from "${cur.name}".` : ''),
    mk('tagline', 'Tagline', cur.tagline, cur.tagline ? 'ok' : 'uncertain', ''),
  ];
  const needsReview = checks.some((c) => c.aiVerdict !== 'ok');
  return { checks, notes: [], needsReview };
}

async function applyVerification(reportId, resolutions) {
  const report = await PreSeoReport.findByPk(reportId);
  if (!report || !report.data) throw new Error('Guideline not analysed yet.');
  let v = null; try { v = await verify(reportId); } catch {}
  const byId = {}; if (v) for (const c of v.checks) byId[c.id] = c;
  const resolve = (id) => {
    const r = (resolutions && resolutions[id]) || { mode: 'keep' };
    const c = byId[id] || {};
    if (r.mode === 'blank') return '';
    if (r.mode === 'custom') return r.value != null ? r.value : '';
    if (r.mode === 'ai') return c.aiSuggestion || c.current || '';
    return c.current != null ? c.current : '';
  };
  const d = JSON.parse(JSON.stringify(report.data));
  const name = resolve('name'); const tagline = resolve('tagline');
  if (name) { d.report = d.report || {}; d.report.business = name; report.businessName = name; }
  if (tagline != null) { d.foundation = d.foundation || {}; d.foundation.tagline = tagline; }
  report.data = d; report.changed('data', true);
  await report.save();
  return { ok: true };
}

module.exports = { run, generate, setStatus, verify, applyVerification };

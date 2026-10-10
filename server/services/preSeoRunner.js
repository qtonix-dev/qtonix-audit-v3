/**
 * Pre-SEO report runner: orchestrates crawl → auto-capture → Claude analysis →
 * assemble report JSON. Runs in-process (best-effort, non-blocking) and updates
 * the PreSeoReport row's status/progress as it goes. PDF generation is a separate
 * step (generate()) so the user can review/edit the data first.
 */
const path = require('path');
const fs = require('fs/promises');
const { PreSeoReport, Settings } = require('../models');
const crawler = require('./crawler');
const { captureAuto } = require('./preSeoCapture');
const { buildReportData, refreshUploads } = require('./preSeoAnalyze');
const { renderPreSeo } = require('./renderer');
const { toRenderUrl, UPLOAD_DIR } = require('./preSeoStore');

function istNow() { return new Date(Date.now() + 330 * 60000); }
function monthYear() { return istNow().toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).toUpperCase(); }
function auditDate() { const d = istNow(); return `${d.getUTCDate()} ${d.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })} ${d.getUTCFullYear()}`; }

async function setStatus(id, patch) {
  try { const r = await PreSeoReport.findByPk(id); if (r) { Object.assign(r, patch); await r.save(); } } catch {}
}

// Kick off crawl + capture + analysis for a report (fire-and-forget).
async function run(reportId) {
  const report = await PreSeoReport.findByPk(reportId);
  if (!report) return;
  try {
    const s = await Settings.findOne();
    const anthropicKey = s && s.getKey ? s.getKey('anthropic') : null;
    const openaiKey = s && s.getKey ? s.getKey('openai') : null;
    const psKey = s && s.getKey ? s.getKey('pagespeed') : null;

    const seed = report.data || {};
    const sitemapUrl = seed._sitemapUrl || '';
    const noSitemap = !!seed._noSitemap;
    const accessMode = seed._accessMode || 'unsure';

    await setStatus(reportId, { status: 'capturing', progress: 10, currentStep: 'Fetching the website' });
    let crawl = {};
    try { crawl = await crawler.runTechnicalAudit(report.website, psKey, { sitemapUrl, noSitemap }); } catch (e) { console.error('[preSeo] crawl failed:', e.message); }
    crawl.website = report.website;
    crawl.domain = report.domain;
    await setStatus(reportId, { crawl, progress: 35, currentStep: 'Capturing screenshots' });

    // Auto screenshots (homepage, responsive, branded boxes) with red highlights.
    let shots = {};
    try { const cap = await captureAuto(crawl, reportId, (step) => setStatus(reportId, { currentStep: step })); shots = cap.shots || {}; } catch (e) { console.error('[preSeo] capture failed:', e.message); }
    // merge over any already-uploaded shots (uploads win)
    const existing = report.shots || {};
    const merged = { ...shots, ...existing };
    await setStatus(reportId, { shots: merged, status: 'analyzing', progress: 60, currentStep: 'Analysing with AI' });

    // Gather uploaded screenshots as base64 for Claude vision.
    const screenshots = await loadUploadedImages(merged);

    const seededServices = Array.isArray(seed._services) ? seed._services : [];
    const sm = crawl.sitemap || {};
    const totalPages = sm.urlCount && sm.urlCount > 0 ? sm.urlCount : null;
    const meta = {
      businessName: report.businessName || report.domain, shortName: (report.businessName || report.domain || '').split(' ')[0],
      monthYear: monthYear(), auditDate: auditDate(),
      pagesReviewed: totalPages || 1, totalPages,
      sitemapState: noSitemap ? 'none' : (sm.exists ? 'found' : 'missing'),
      preparedBy: report.createdByName || 'Adam G, Project Manager',
      preparedByRole: 'Project Manager',
      contactEmail: report.createdByEmail || 'adam@qtonix.com', contactPhone: '+91-8249016547',
      clientLogo: logoFor(crawl, report.domain),
      services: seededServices, accessMode,
    };
    const data = await buildReportData(crawl, meta, { anthropicKey, openaiKey }, screenshots);
    // attach shot urls into the data so the template can show them
    attachShots(data, merged);

    await setStatus(reportId, { data, status: 'ready', progress: 100, currentStep: 'Ready for review' });
  } catch (e) {
    console.error('[preSeo] run failed:', e.message);
    await setStatus(reportId, { status: 'failed', error: String(e.message || e).slice(0, 1000) });
  }
}

// Best-effort brand logo for the cover: prefer an apple-touch-icon or a
// <link rel="icon"> (usually the real logo mark), then og:image, and finally a
// high-res Google favicon — which works for any domain. Returns an absolute URL.
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
  // apple-touch-icon and shortcut/icon links are usually the brand mark.
  const touch = attr('link', 'rel', 'apple-touch-icon') || attr('link', 'rel', 'apple-touch-icon-precomposed');
  if (touch) return touch;
  const iconM = html.match(/<link[^>]*rel=["'][^"']*icon[^"']*["'][^>]*>/i);
  if (iconM) { const h = iconM[0].match(/href=["']([^"']+)["']/i); if (h) { const u = abs(h[1]); if (u && !/\.ico(\?|$)/i.test(u)) return u; } }
  const og = attr('meta', 'property', 'og:image') || attr('meta', 'name', 'og:image');
  if (og) return og;
  // Fallback: Google's favicon service at a usable size.
  const d = (domain || base || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  return d ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=128` : '';
}

async function loadUploadedImages(shots) {
  const out = [];
  for (const [key, v] of Object.entries(shots || {})) {
    if (!v || v.source !== 'upload' || !v.url) continue;
    try {
      let buf;
      if (/^https?:\/\//i.test(v.url)) {
        const res = await fetch(v.url); buf = Buffer.from(await res.arrayBuffer());
      } else if (v.url.startsWith('/uploads/')) {
        buf = await fs.readFile(path.join(UPLOAD_DIR, path.basename(v.url)));
      } else continue;
      const mime = /\.jpe?g($|\?)/i.test(v.url) ? 'image/jpeg' : 'image/png';
      out.push({ key, base64: buf.toString('base64'), mime });
    } catch {}
  }
  return out;
}

// Push shot urls into the report data's screenshot slots (ch1.homepageShot, and
// each chapter section .shot.img) by matching slot keys to the section labels.
function attachShots(data, shots) {
  const url = (k) => (shots[k] && shots[k].url) || null;
  if (url('homepage')) data.ch1.homepageShot = toPublic(url('homepage'));
  const bySlot = {
    '3.1': 'pagesource', '3.2': 'robots', '3.3': 'sitemap', '5.2': 'schema', '5.3': 'og', '4.4': 'responsive',
  };
  for (const ch of (data.chapters || [])) {
    for (const sec of (ch.sections || [])) {
      const slot = bySlot[sec.num];
      if (slot && url(slot) && sec.shot) { sec.shot.img = toPublic(url(slot)); }
      // also allow manual-upload slots keyed by section number (e.g. '2.1')
      if (url(sec.num) && sec.shot) sec.shot.img = toPublic(url(sec.num));
    }
  }
}
function toPublic(u) {
  // Remote (ImageKit) URLs load directly; local /uploads map to file:// for PDF.
  return toRenderUrl(u);
}

// Drop or trim sections that have nothing to show. Rule (per the report spec):
//   - A section flagged `manual` whose screenshot was NOT uploaded AND which has
//     no research-backed content (no `research` flag, no bullets, no table) is
//     removed entirely — no empty orange "[ PASTE SCREENSHOT HERE ]" box.
//   - A `manual` section with research content but no image keeps its content
//     and just loses the empty shot box.
//   - Auto-captured / research sections are always kept.
// A section is considered to "have content" if it carries a table, bullets,
// willdo, cols or weeks — i.e. something beyond the screenshot placeholder.
function hasBody(sec) {
  return !!(sec.table || (sec.bullets && sec.bullets.length) || sec.willdo || sec.cols || sec.weeks || sec.image);
}
function pruneSections(data) {
  for (const ch of (data.chapters || [])) {
    ch.sections = (ch.sections || []).filter((sec) => {
      const hasImg = !!(sec.shot && sec.shot.img);
      if (hasImg) return true;                 // uploaded/auto image → keep
      if (!sec.manual) return true;            // normal research section → keep
      // manual section, no image:
      if (sec.research && hasBody(sec)) {       // keep the researched content...
        delete sec.shot;                        // ...but remove the empty box
        return true;
      }
      return false;                             // nothing to show → drop section
    });
  }
  // A chapter with no sections left would render an empty band; drop it too.
  data.chapters = (data.chapters || []).filter((ch) => (ch.sections && ch.sections.length) || ch.stats);
}

// Generate the PDF from the (possibly edited) report data.
async function generate(reportId) {
  const report = await PreSeoReport.findByPk(reportId);
  if (!report || !report.data || !report.data.report) throw new Error('Report not analysed yet.');
  await setStatus(reportId, { status: 'rendering', currentStep: 'Reading uploaded screenshots' });
  // Work on a deep copy so pruning/refresh for the PDF never mutates the stored
  // data (the user may upload more screenshots and regenerate).
  const pdfData = JSON.parse(JSON.stringify(report.data));

  // Read the uploaded screenshots now (they usually arrive in the review step,
  // after run()) and write a real per-section observation from each, plus the
  // live AI Answers section. This is why uploaded sections get relevant text.
  try {
    const s = await Settings.findOne();
    const keys = { anthropicKey: s && s.getKey ? s.getKey('anthropic') : null, openaiKey: s && s.getKey ? s.getKey('openai') : null };
    const screenshots = await loadUploadedImages(report.shots || {});
    const meta = {
      businessName: report.businessName || report.domain,
      shortName: (report.businessName || report.domain || '').split(' ')[0],
    };
    await setStatus(reportId, { currentStep: 'Analysing screenshots with AI' });
    await refreshUploads(pdfData, report.crawl || {}, meta, keys, screenshots);
    // persist the refreshed observations back to the stored data too, so the
    // review view and any re-download reflect them (without the prune).
    const stored = JSON.parse(JSON.stringify(pdfData));
    report.data = stored; report.changed('data', true); await report.save();
  } catch (e) { console.error('[preSeo] refresh uploads failed:', e.message); }

  await setStatus(reportId, { currentStep: 'Generating PDF' });
  // re-attach shots as file:// for the PDF, then drop empty/un-uploaded sections
  attachShots(pdfData, report.shots || {});
  pruneSections(pdfData);
  const { pdfPath, htmlPath } = await renderPreSeo(pdfData, `${report.domain}-${report.id}`);
  await setStatus(reportId, { status: 'complete', pdfPath, htmlPath, completedAt: new Date(), currentStep: 'Complete', progress: 100 });
  return { pdfPath, htmlPath };
}

module.exports = { run, generate, setStatus };

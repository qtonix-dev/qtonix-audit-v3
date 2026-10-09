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
const { buildReportData } = require('./preSeoAnalyze');
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

    await setStatus(reportId, { status: 'capturing', progress: 10, currentStep: 'Fetching the website' });
    let crawl = {};
    try { crawl = await crawler.runTechnicalAudit(report.website, psKey); } catch (e) { console.error('[preSeo] crawl failed:', e.message); }
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

    const meta = {
      businessName: report.businessName || report.domain, shortName: (report.businessName || report.domain || '').split(' ')[0],
      monthYear: monthYear(), auditDate: auditDate(), pagesReviewed: (crawl.sitemap && crawl.sitemap.urlCount) || 1,
      preparedBy: report.createdByName || 'Adam G, Project Manager',
      contactEmail: 'adam@qtonix.com', contactPhone: '+91-8249016547', clientLogo: '',
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

// Generate the PDF from the (possibly edited) report data.
async function generate(reportId) {
  const report = await PreSeoReport.findByPk(reportId);
  if (!report || !report.data || !report.data.report) throw new Error('Report not analysed yet.');
  await setStatus(reportId, { status: 'rendering', currentStep: 'Generating PDF' });
  // re-attach shots as file:// for the PDF
  attachShots(report.data, report.shots || {});
  const { pdfPath, htmlPath } = await renderPreSeo(report.data, `${report.domain}-${report.id}`);
  await setStatus(reportId, { status: 'complete', pdfPath, htmlPath, completedAt: new Date(), currentStep: 'Complete', progress: 100 });
  return { pdfPath, htmlPath };
}

module.exports = { run, generate, setStatus };

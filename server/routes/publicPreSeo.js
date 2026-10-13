/**
 * Public, unauthenticated Pre-SEO report sharing — same trackable pattern as
 * publicReports.js, on a separate /pr/:slug path so Pre-SEO and CRM report links
 * never collide.
 *   GET /pr/:slug          → branded wrapper (iframe preview + Download button)
 *   GET /pr/:slug/view     → the report HTML
 *   GET /pr/:slug/download → the report PDF
 * Every view/download is logged (time, IP, UA) onto the report.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { PreSeoReport } = require('../models');

function clientIp(req) {
  const xf = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || req.ip || (req.connection && req.connection.remoteAddress) || '';
}

async function track(report, type, req) {
  try {
    const ip = clientIp(req);
    const ua = String(req.headers['user-agent'] || '').slice(0, 200);
    const views = Array.isArray(report.publicViews) ? report.publicViews.slice() : [];
    const now = Date.now();
    const recent = views.find((v) => v.type === type && v.ip === ip && (now - new Date(v.at).getTime()) < 30000);
    if (recent) return;
    views.push({ at: new Date().toISOString(), ip, ua, type });
    report.publicViews = views; report.changed('publicViews', true);
    await report.save();
  } catch (e) { /* best-effort */ }
}

async function findShared(slug) {
  const r = await PreSeoReport.findOne({ where: { publicSlug: slug } });
  if (!r || !r.publicEnabled) return null;
  return r;
}

router.get('/pr/:slug', async (req, res) => {
  const r = await findShared(req.params.slug);
  if (!r) return res.status(404).send(notFoundHtml());
  await track(r, 'view', req);
  res.set('Cache-Control', 'no-store');
  res.send(wrapperHtml(r));
});

router.get('/pr/:slug/view', async (req, res) => {
  const r = await findShared(req.params.slug);
  if (!r) return res.status(404).send('Report not available.');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  // Prefer the durable ImageKit copy; local disk only as a fast path if present.
  if (r.htmlPath && fs.existsSync(r.htmlPath)) return res.sendFile(path.resolve(r.htmlPath), { etag: false, lastModified: false });
  if (r.htmlUrl) return res.redirect(302, r.htmlUrl);
  return res.status(404).send('Report not ready yet.');
});

// Inline PDF for the fit-to-width viewer (not counted as a download).
router.get('/pr/:slug/pdf', async (req, res) => {
  const r = await findShared(req.params.slug);
  if (!r) return res.status(404).send('Report not available.');
  res.set('Cache-Control', 'no-store');
  if (r.pdfPath && fs.existsSync(r.pdfPath)) {
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', 'inline');
    return res.sendFile(path.resolve(r.pdfPath));
  }
  if (r.pdfUrl) return res.redirect(302, r.pdfUrl);
  return res.status(404).send('The report is not ready yet.');
});

router.get('/pr/:slug/download', async (req, res) => {
  const r = await findShared(req.params.slug);
  if (!r) return res.status(404).send('Report not available.');
  await track(r, 'download', req);
  if (r.pdfPath && fs.existsSync(r.pdfPath)) {
    const safe = `${String(r.businessName || r.domain || 'report').replace(/[^a-z0-9]/gi, '-')}-Pre-SEO-Audit.pdf`;
    return res.download(r.pdfPath, safe);
  }
  if (r.pdfUrl) return res.redirect(302, r.pdfUrl);
  return res.status(404).send('The PDF is not ready yet.');
});

function esc(s) { return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function wrapperHtml(r) {
  const title = `${r.businessName || r.domain} — Pre-SEO Audit`;
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" type="image/png" sizes="32x32" href="/brand/favicon-32.png">
<title>${esc(title)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#0A0E27;color:#fff;display:flex;flex-direction:column}
  header{display:flex;align-items:center;justify-content:space-between;padding:12px 20px;background:linear-gradient(90deg,#0A0E28,#0435AC);gap:12px;flex-wrap:wrap;flex:none}
  .brand{font-weight:800;font-size:17px}.brand span{color:#FF6A00}
  .ttl{font-size:13px;color:#C9D8FF;font-weight:600}
  .dl{background:linear-gradient(90deg,#FF6A00,#FF4500);color:#fff;border:0;border-radius:9px;padding:10px 18px;font-weight:700;font-size:13px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
  /* Grey stage; the real HTML report (fixed 816px / 8.5in wide) is rendered at
     its TRUE width and SCALED to fit, centred, so it reads at document width
     with blank grey margins left & right — no PDF-viewer zoom quirks. */
  .stage{flex:1;background:#3a3d42;min-height:0;overflow:auto;padding:20px 0}
  .scaler{margin:0 auto;transform-origin:top center}
  .doc{width:816px;background:#fff;border-radius:6px;box-shadow:0 10px 40px rgba(0,0,0,.35);overflow:hidden}
  .doc iframe{width:816px;height:100%;border:0;display:block;background:#fff}
</style></head><body>
<header>
  <div><div class="brand">Qtonix<span>.</span></div><div class="ttl">${esc(r.businessName || r.domain)} — Pre-SEO Audit Report</div></div>
  <a class="dl" href="/pr/${esc(r.publicSlug)}/download">&#8595; Download PDF</a>
</header>
<div class="stage" id="stage">
  <div class="scaler" id="scaler">
    <div class="doc" id="doc"><iframe id="rpt" title="report" src="/pr/${esc(r.publicSlug)}/view"></iframe></div>
  </div>
</div>
<script>
(function(){
  var DOC_W = 816;            // the report's true width (8.5in)
  var stage = document.getElementById('stage');
  var scaler = document.getElementById('scaler');
  var doc = document.getElementById('doc');
  var frame = document.getElementById('rpt');
  function fit(){
    // Available width inside the stage, leaving a side gutter for the grey margin.
    var avail = stage.clientWidth - 48;
    var scale = Math.min(1, avail / DOC_W);
    if (scale <= 0) scale = 1;
    scaler.style.transform = 'scale(' + scale + ')';
    // Reserve the scaled footprint so the stage scrolls correctly.
    var h = frame.getAttribute('data-h') || 0;
    scaler.style.width = DOC_W + 'px';
    scaler.style.height = (h ? (h * scale) + 'px' : '');
    doc.style.height = h ? (h + 'px') : '';
  }
  // Measure the report's real height once it loads, then size & scale.
  frame.addEventListener('load', function(){
    try {
      var d = frame.contentDocument || frame.contentWindow.document;
      var h = Math.max(d.body.scrollHeight, d.documentElement.scrollHeight, 1056);
      frame.setAttribute('data-h', h);
    } catch(e){ frame.setAttribute('data-h', 1056 * 20); } // cross-origin fallback: tall enough for a multi-page report
    fit();
  });
  window.addEventListener('resize', fit);
  fit();
})();
</script>
</body></html>`;
}

function notFoundHtml() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Report not found</title>
<style>body{font-family:system-ui,sans-serif;background:#0A0E27;color:#fff;height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px}
.b{font-weight:800;font-size:22px;margin-bottom:8px}.b span{color:#FF6A00}p{color:#9fb0d0;font-size:14px}</style></head>
<body><div><div class="b">Qtonix<span>.</span></div><p>This report link is no longer available.</p></div></body></html>`;
}

module.exports = router;

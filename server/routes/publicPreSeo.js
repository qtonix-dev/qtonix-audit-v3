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

/* Screen-only override injected into EVERY served report, so interior pages
   get the SAME side margin as the cover/back even on reports whose stored HTML
   predates the @media screen fix. @page interior margins apply only in PDF, so
   without this the on-screen interior content runs to the edge of the white
   frame. Harmless in print (scoped to @media screen) and idempotent. */
const SCREEN_MARGIN_OVERRIDE = `
<style id="qtx-screen-margin">
@media screen{
  html,body{ background:#fff !important; width:816px !important; margin:0 auto !important; overflow-x:hidden !important; }
  .cover,.toc-page,.back{ width:816px !important; margin:0 !important; }
  .page{ width:816px !important; padding:0.62in 0.62in 0.72in !important; margin:0 !important; background:#fff !important; box-sizing:border-box !important; }
}
</style>`;

function injectScreenMargin(html) {
  const s = String(html || '');
  if (s.includes('qtx-screen-margin')) return s; // already present
  // The override is sized for the US-Letter Pre-SEO/Brand templates (816px). The
  // Competitor Analysis template is A4 and ships its own @media screen rules, so
  // skip injection for it or the on-screen layout would be distorted.
  if (/width:\s*210mm/.test(s) || s.includes('competitorReport')) return s;
  if (s.includes('</head>')) return s.replace('</head>', SCREEN_MARGIN_OVERRIDE + '</head>');
  return SCREEN_MARGIN_OVERRIDE + s;
}

router.get('/pr/:slug/view', async (req, res) => {
  const r = await findShared(req.params.slug);
  if (!r) return res.status(404).send('Report not available.');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  // Prefer the durable ImageKit copy; local disk only as a fast path if present.
  // Read the HTML and inject the screen-margin override so old reports get the
  // consistent side margin too (sendFile/redirect would bypass the injection).
  try {
    if (r.htmlPath && fs.existsSync(r.htmlPath)) {
      const html = fs.readFileSync(r.htmlPath, 'utf8');
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.send(injectScreenMargin(html));
    }
    if (r.htmlUrl) {
      const resp = await fetch(r.htmlUrl);
      if (resp.ok) {
        const html = await resp.text();
        res.set('Content-Type', 'text/html; charset=utf-8');
        return res.send(injectScreenMargin(html));
      }
      return res.redirect(302, r.htmlUrl); // fallback: serve as-is
    }
  } catch (e) {
    if (r.htmlUrl) return res.redirect(302, r.htmlUrl);
  }
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
  /* Grey stage; the white report (fixed 816px / 8.5in wide) sits centred with
     grey margins on both outer sides. The report's own content has its white
     side margin injected into /view, so there are TWO margins as intended:
     the grey stage gutter outside, and the white content inset inside. */
  .stage{flex:1;background:#3a3d42;min-height:0;overflow:auto;padding:24px 0}
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
    // Scale the 816px document down to fit, centred, leaving a grey side gutter.
    // Capped at 1 so the document never upscales past its true width.
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

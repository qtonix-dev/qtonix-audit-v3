/**
 * Public, unauthenticated Brand-Guideline sharing at /bg/:slug.
 *
 * A brand guideline is a LANDSCAPE slide deck (13.333in × 7.5in). An HTML iframe
 * would squash it on a portrait/narrow screen, so the viewer embeds the PDF
 * itself (#view=FitH) — the browser scales each landscape page to the viewport
 * width with the correct aspect ratio, so nothing is distorted. A "Download PDF"
 * button sits in the branded header.
 *   GET /bg/:slug          → branded wrapper (fit-to-width PDF viewer)
 *   GET /bg/:slug/file     → the PDF (inline, for the iframe)
 *   GET /bg/:slug/download → the PDF (attachment)
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { PreSeoReport } = require('../models');

const BG_KIND = 'brand_guideline';

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
    if (views.find((v) => v.type === type && v.ip === ip && (now - new Date(v.at).getTime()) < 30000)) return;
    views.push({ at: new Date().toISOString(), ip, ua, type });
    report.publicViews = views; report.changed('publicViews', true);
    await report.save();
  } catch { /* best-effort */ }
}
async function findShared(slug) {
  const r = await PreSeoReport.findOne({ where: { publicSlug: slug, kind: BG_KIND } });
  if (!r || !r.publicEnabled) return null;
  return r;
}
function esc(s) { return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

router.get('/bg/:slug', async (req, res) => {
  const r = await findShared(req.params.slug);
  if (!r) return res.status(404).send(notFoundHtml());
  await track(r, 'view', req);
  res.set('Cache-Control', 'no-store');
  res.send(wrapperHtml(r));
});

// The self-contained HTML deck (web fonts) — scaled to fit in the viewer.
router.get('/bg/:slug/view', async (req, res) => {
  const r = await findShared(req.params.slug);
  if (!r) return res.status(404).send('Guideline not available.');
  res.set('Cache-Control', 'no-store');
  if (r.htmlPath && fs.existsSync(r.htmlPath)) return res.sendFile(path.resolve(r.htmlPath));
  if (r.htmlUrl) return res.redirect(302, r.htmlUrl);
  return res.status(404).send('The guideline is not ready yet.');
});

// The PDF, inline, for the iframe viewer.
router.get('/bg/:slug/file', async (req, res) => {
  const r = await findShared(req.params.slug);
  if (!r) return res.status(404).send('Guideline not available.');
  res.set('Cache-Control', 'no-store');
  if (r.pdfPath && fs.existsSync(r.pdfPath)) {
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', 'inline');
    return res.sendFile(path.resolve(r.pdfPath));
  }
  if (r.pdfUrl) return res.redirect(302, r.pdfUrl);
  return res.status(404).send('The guideline is not ready yet.');
});

router.get('/bg/:slug/download', async (req, res) => {
  const r = await findShared(req.params.slug);
  if (!r) return res.status(404).send('Guideline not available.');
  await track(r, 'download', req);
  const safe = `${String(r.businessName || r.domain || 'brand').replace(/[^a-z0-9]/gi, '-')}-Brand-Guidelines.pdf`;
  if (r.pdfPath && fs.existsSync(r.pdfPath)) return res.download(r.pdfPath, safe);
  if (r.pdfUrl) return res.redirect(302, r.pdfUrl);
  return res.status(404).send('The PDF is not ready yet.');
});

function wrapperHtml(r) {
  const title = `${r.businessName || r.domain} — Brand Guidelines`;
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" type="image/png" sizes="32x32" href="/brand/favicon-32.png">
<title>${esc(title)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#1a1a1e;color:#fff;display:flex;flex-direction:column}
  header{display:flex;align-items:center;justify-content:space-between;padding:12px 20px;background:linear-gradient(90deg,#16161a,#242424);gap:12px;flex-wrap:wrap;flex:none}
  .brand{font-weight:800;font-size:17px}.brand span{color:#E55B2A}
  .ttl{font-size:13px;color:#d9cfc4;font-weight:600}
  .dl{background:linear-gradient(90deg,#FF6A00,#E55B2A);color:#fff;border:0;border-radius:9px;padding:10px 18px;font-weight:700;font-size:13px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
  /* The landscape deck HTML (1280px wide) is rendered at its true width and
     SCALED to fit, centred, so slides show at full document width with blank
     grey margins left & right. */
  .stage{flex:1;background:#2a2a2e;min-height:0;overflow:auto;padding:20px 0}
  .scaler{margin:0 auto;transform-origin:top center}
  .doc{width:1280px;background:#000;border-radius:6px;box-shadow:0 10px 40px rgba(0,0,0,.4);overflow:hidden}
  .doc iframe{width:1280px;height:100%;border:0;display:block}
</style></head><body>
<header>
  <div><div class="brand">Qtonix<span>.</span></div><div class="ttl">${esc(r.businessName || r.domain)} — Brand Guidelines</div></div>
  <a class="dl" href="/bg/${esc(r.publicSlug)}/download">&#8595; Download PDF</a>
</header>
<div class="stage" id="stage">
  <div class="scaler" id="scaler"><div class="doc" id="doc"><iframe id="rpt" title="brand guideline" src="/bg/${esc(r.publicSlug)}/view"></iframe></div></div>
</div>
<script>
(function(){
  var DOC_W=1280, stage=document.getElementById('stage'), scaler=document.getElementById('scaler'), doc=document.getElementById('doc'), frame=document.getElementById('rpt');
  function fit(){ var avail=stage.clientWidth-48; var s=Math.min(1,avail/DOC_W); if(s<=0)s=1; scaler.style.transform='scale('+s+')'; var h=+frame.getAttribute('data-h')||720; scaler.style.width=DOC_W+'px'; scaler.style.height=(h*s)+'px'; doc.style.height=h+'px'; }
  frame.addEventListener('load',function(){ try{var d=frame.contentDocument||frame.contentWindow.document; frame.setAttribute('data-h',Math.max(d.body.scrollHeight,d.documentElement.scrollHeight,720)); }catch(e){ frame.setAttribute('data-h',720*24); } fit(); });
  window.addEventListener('resize',fit); fit();
})();
</script>
</body></html>`;
}
function notFoundHtml() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Guideline not found</title>
<style>body{font-family:system-ui,sans-serif;background:#1a1a1e;color:#fff;height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px}
.b{font-weight:800;font-size:22px;margin-bottom:8px}.b span{color:#E55B2A}p{color:#b7a99b;font-size:14px}</style></head>
<body><div><div class="b">Qtonix<span>.</span></div><p>This brand-guideline link is no longer available.</p></div></body></html>`;
}

module.exports = router;

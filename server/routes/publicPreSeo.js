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
  body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#0A0E27;color:#fff;height:100vh;display:flex;flex-direction:column}
  header{display:flex;align-items:center;justify-content:space-between;padding:12px 20px;background:linear-gradient(90deg,#0A0E28,#0435AC);gap:12px;flex-wrap:wrap}
  .brand{font-weight:800;font-size:17px}.brand span{color:#FF6A00}
  .ttl{font-size:13px;color:#C9D8FF;font-weight:600}
  .dl{background:linear-gradient(90deg,#FF6A00,#FF4500);color:#fff;border:0;border-radius:9px;padding:10px 18px;font-weight:700;font-size:13px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
  /* Grey stage; the document sits in a card whose shape matches the PAGE
     (portrait Letter = 8.5:11), so the PDF fills the card with no white gap,
     and the blank space is the grey stage on the left and right. The stage
     scrolls if the page is taller than the viewport. */
  .stage{flex:1;background:#3a3d42;min-height:0;display:flex;justify-content:center;align-items:flex-start;padding:20px;overflow:auto}
  .frame{width:min(100%, calc((100vh - 110px) * 0.773));background:#fff;border-radius:6px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.35);aspect-ratio:8.5 / 11}
  iframe,object{width:100%;height:100%;border:0;display:block}
  @media (max-width:720px){ .stage{padding:10px;align-items:stretch} .frame{width:100%;height:100%;aspect-ratio:auto} }
</style></head><body>
<header>
  <div><div class="brand">Qtonix<span>.</span></div><div class="ttl">${esc(r.businessName || r.domain)} — Pre-SEO Audit Report</div></div>
  <a class="dl" href="/pr/${esc(r.publicSlug)}/download">&#8595; Download PDF</a>
</header>
<div class="stage">
  <div class="frame">
    <!-- Embed the PDF fit-to-width so the fixed-size report scales cleanly. The
         HTML view stays available as a fallback if the PDF can't be shown. -->
    <object data="/pr/${esc(r.publicSlug)}/pdf#view=FitH&toolbar=1" type="application/pdf">
      <iframe title="report" src="/pr/${esc(r.publicSlug)}/view"></iframe>
    </object>
  </div>
</div>
</body></html>`;
}

function notFoundHtml() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Report not found</title>
<style>body{font-family:system-ui,sans-serif;background:#0A0E27;color:#fff;height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px}
.b{font-weight:800;font-size:22px;margin-bottom:8px}.b span{color:#FF6A00}p{color:#9fb0d0;font-size:14px}</style></head>
<body><div><div class="b">Qtonix<span>.</span></div><p>This report link is no longer available.</p></div></body></html>`;
}

module.exports = router;

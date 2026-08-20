/**
 * Public, unauthenticated report sharing.
 *   GET /r/:slug            → a lightweight wrapper page: the branded report
 *                             preview in an iframe + a Download button.
 *   GET /r/:slug/view       → the report HTML itself (regenerated live).
 *   GET /r/:slug/download   → the report PDF.
 * Every view/download is logged (time, IP, user-agent) onto the report and a
 * note is pushed to its CRM activity so the agent can see the customer opened it.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { Report } = require('../models');

let renderWithLiveSettings;
try { renderWithLiveSettings = require('./reports').renderWithLiveSettings; } catch { renderWithLiveSettings = null; }

function clientIp(req) {
  const xf = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || req.ip || (req.connection && req.connection.remoteAddress) || '';
}

// Record a view/download and add a CRM activity note (best-effort, deduped so a
// browser fetching view + assets in quick succession doesn't spam the log).
async function track(report, type, req) {
  try {
    const ip = clientIp(req);
    const ua = String(req.headers['user-agent'] || '').slice(0, 200);
    const views = Array.isArray(report.publicViews) ? report.publicViews.slice() : [];
    const now = Date.now();
    // Dedupe: same ip + type within 30s counts once.
    const recent = views.find((v) => v.type === type && v.ip === ip && (now - new Date(v.at).getTime()) < 30000);
    if (recent) return;
    views.push({ at: new Date().toISOString(), ip, ua, type });
    report.publicViews = views; report.changed('publicViews', true);
    // Add a CRM activity entry the agent will see on the report.
    const activity = Array.isArray(report.activity) ? report.activity.slice() : [];
    activity.unshift({
      at: new Date().toISOString(),
      kind: 'public_' + type,
      text: `Customer ${type === 'download' ? 'downloaded' : 'opened'} the shared report${ip ? ` (IP ${ip})` : ''}.`,
      by: 'Public link',
    });
    report.activity = activity; report.changed('activity', true);
    await report.save();
  } catch (e) { /* best-effort tracking must never break the response */ }
}

async function findShared(slug) {
  const report = await Report.findOne({ where: { publicSlug: slug } });
  if (!report || !report.publicEnabled) return null;
  return report;
}

// Wrapper page — branded, minimal chrome, report in an iframe + download button.
router.get('/r/:slug', async (req, res) => {
  const report = await findShared(req.params.slug);
  if (!report) return res.status(404).send(notFoundHtml());
  await track(report, 'view', req);
  const title = `${report.businessName} — Site Analysis`;
  res.set('Cache-Control', 'no-store');
  res.send(wrapperHtml(report, title));
});

// The report HTML itself (same live render as the in-app preview).
router.get('/r/:slug/view', async (req, res) => {
  const report = await findShared(req.params.slug);
  if (!report) return res.status(404).send('Report not available.');
  try {
    if (report.status === 'complete' && report.data && Object.keys(report.data).length && renderWithLiveSettings) {
      try { await renderWithLiveSettings(report); }
      catch (e) { if (!report.htmlPath || !fs.existsSync(report.htmlPath)) return res.status(503).send('Report is being prepared, please try again shortly.'); }
    } else if (!report.htmlPath || !fs.existsSync(report.htmlPath)) {
      return res.status(404).send('Report not available yet.');
    }
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.sendFile(path.resolve(report.htmlPath), { etag: false, lastModified: false });
  } catch (e) { res.status(500).send('Could not load the report.'); }
});

// The report PDF.
router.get('/r/:slug/download', async (req, res) => {
  const report = await findShared(req.params.slug);
  if (!report) return res.status(404).send('Report not available.');
  await track(report, 'download', req);
  try {
    if (report.status === 'complete' && report.data && Object.keys(report.data).length && renderWithLiveSettings) {
      try { await renderWithLiveSettings(report); }
      catch (e) { if (!report.pdfPath || !fs.existsSync(report.pdfPath)) return res.status(503).send('The PDF is being prepared, please try again shortly.'); }
    } else if (!report.pdfPath || !fs.existsSync(report.pdfPath)) {
      return res.status(404).send('The PDF is not ready yet.');
    }
    const safe = `${report.businessName.replace(/[^a-z0-9]/gi, '-')}-Site-Analysis.pdf`;
    res.download(report.pdfPath, safe);
  } catch (e) { res.status(500).send('Could not download the report.'); }
});

function esc(s) { return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function wrapperHtml(report, title) {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#0A0E27;color:#fff;height:100vh;display:flex;flex-direction:column}
  header{display:flex;align-items:center;justify-content:space-between;padding:12px 20px;background:linear-gradient(90deg,#0A0E28,#0435AC);gap:12px;flex-wrap:wrap}
  .brand{font-weight:800;font-size:17px}.brand span{color:#FF6A00}
  .ttl{font-size:13px;color:#C9D8FF;font-weight:600}
  .dl{background:linear-gradient(90deg,#FF6A00,#FF4500);color:#fff;border:0;border-radius:9px;padding:10px 18px;font-weight:700;font-size:13px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
  .frame{flex:1;background:#fff}
  iframe{width:100%;height:100%;border:0;display:block}
</style></head><body>
<header>
  <div><div class="brand">Qtonix<span>.</span></div><div class="ttl">${esc(report.businessName)} — Site Analysis Report</div></div>
  <a class="dl" href="/r/${esc(report.publicSlug)}/download">&#8595; Download PDF</a>
</header>
<div class="frame"><iframe title="report" src="/r/${esc(report.publicSlug)}/view"></iframe></div>
</body></html>`;
}

function notFoundHtml() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Report not found</title>
<style>body{font-family:system-ui,sans-serif;background:#0A0E27;color:#fff;height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px}
.b{font-weight:800;font-size:22px;margin-bottom:8px}.b span{color:#FF6A00}p{color:#9fb0d0;font-size:14px}</style></head>
<body><div><div class="b">Qtonix<span>.</span></div><p>This report link is no longer available.</p></div></body></html>`;
}

module.exports = router;

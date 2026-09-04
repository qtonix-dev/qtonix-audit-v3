require('dotenv').config();

// Bump this on every release so /api/health reveals exactly what's deployed —
// the quickest way to confirm a Railway rebuild actually shipped the new code.
const APP_VERSION = 'v401';
global.__APP_VERSION__ = APP_VERSION;

const express = require('express');
const { initDb, sequelize, Op, User, pruneDuplicateIndexes } = require('./models');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

const auth = require('./routes/auth');
const reports = require('./routes/reports');
const admin = require('./routes/admin');
const demo = require('./routes/demo');
const demoApp = require('./routes/demoApp');
const leads = require('./routes/leads');
const reviews = require('./routes/reviews');
const briefs = require('./routes/briefs');
const tv = require('./routes/tv');
const hr = require('./routes/hr');
const gmailRoutes = require('./routes/gmail');

const app = express();

// Railway (and most hosts) put a reverse proxy in front of the app. Trusting it
// lets express-rate-limit read the real client IP from X-Forwarded-For instead
// of erroring. '1' = trust the first proxy hop.
app.set('trust proxy', 1);

// Content Security Policy. The default helmet CSP is `default-src 'self'`, which
// blocks the browser from uploading avatars to ImageKit and from loading images
// served off ImageKit's CDN. We keep a tight policy but explicitly allow the
// ImageKit upload endpoint (connect-src) and image hosts (img-src), plus data:
// URIs used for in-app previews.
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      // Avatar uploads POST to upload.imagekit.io; API + own origin also allowed.
      'connect-src': ["'self'", 'https://upload.imagekit.io', 'https://api.imagekit.io', 'https://ik.imagekit.io'],
      // Images may come from our origin, ImageKit's CDN, data URIs, and any https
      // host (signature logos/photos can be hosted anywhere the admin points to).
      'img-src': ["'self'", 'data:', 'blob:', 'https:'],
      'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
      // Resume/attachment PDFs are hosted on ImageKit and can be previewed inline;
      // the Google Docs viewer is a fallback embed for PDFs that won't render
      // directly. Both must be allowed as frame sources.
      'frame-src': ["'self'", 'https://ik.imagekit.io', 'https://docs.google.com', 'https://drive.google.com'],
    },
  },
}));
app.use(cors({ origin: process.env.CLIENT_ORIGIN || true, credentials: true }));
app.use(express.json({ limit: '20mb' }));

// ===== Hostname-aware routing (must run BEFORE any page route) =====
// A single Railway service is reached on several custom domains at once
// (people.qtonix.com, career.qtonix.com, crmnest.com, reports.qtonix.com). The
// app separates its surfaces by PATH, so without this every domain would serve
// every page. This "walls off" each domain: it works out which surface a PATH
// belongs to and, if that differs from the surface of the DOMAIN the request
// arrived on, 302-redirects to the correct domain. Candidate pages then only
// live on career., the HR portal only on people., and so on. It runs before the
// public /careers, /jobs, /onboarding, /task routes so it can redirect them.
const PATH_SURFACE = [
  { surface: 'careers', prefixes: ['/careers', '/jobs', '/task', '/onboarding', '/schedule'] },
  { surface: 'hrms', prefixes: ['/hr'] },
  { surface: 'reports', prefixes: ['/r/'] },
  // 'crm' owns everything else (the CRM SPA: /, /dashboard, /leads, /admin, …)
];
function surfaceOfPath(p) {
  for (const row of PATH_SURFACE) { if (row.prefixes.some((pre) => p === pre || p.startsWith(pre + '/'))) return row.surface; }
  return 'crm';
}
app.use(async (req, res, next) => {
  try {
    if (req.method !== 'GET') return next();
    const p = req.path;
    // Never touch API, uploads, brand/OG assets, the demo page, cross-app /go/
    // redirects, or any file request.
    if (p.startsWith('/api') || p.startsWith('/uploads') || p.startsWith('/brand') || p.startsWith('/og') || p.startsWith('/demo') || p.startsWith('/go/') || p.includes('.')) return next();

    const pu = require('./services/publicUrl');
    const hostSurface = await pu.surfaceForHost(req);
    if (!hostSurface) return next(); // raw Railway host / unconfigured → default behaviour

    // Candidate + report paths always belong to their own surfaces, on ANY host.
    const careersPrefixes = ['/careers', '/jobs', '/task', '/onboarding', '/schedule'];
    const isCareersPath = careersPrefixes.some((pre) => p === pre || p.startsWith(pre + '/'));
    const isReportPath = p.startsWith('/r/');

    // Careers domain: its root serves the listing directly; a careers path stays;
    // anything else (an HRMS/CRM path) is redirected to where it belongs.
    if (hostSurface === 'careers') {
      if (p === '/' || p === '') return serveCareersRoot(req, res);
      if (isCareersPath) return next();
      // fallthrough to cross-surface redirect below
    }

    // HRMS domain: URLs are CLEAN (no /hr prefix). The HR SPA is served at the
    // root here, so any non-careers/report path is an HRMS path and just serves
    // the app. Only candidate/report paths get redirected away.
    if (hostSurface === 'hrms') {
      if (isCareersPath || isReportPath) {
        const targetSurface = isReportPath ? 'reports' : 'careers';
        const targetBase = await pu.baseFor(targetSurface, req);
        const targetHost = pu.hostOf(targetBase);
        const hereHost = String(req.get('host') || '').split(':')[0].toLowerCase();
        if (targetBase && targetHost && targetHost !== hereHost) return res.redirect(302, `${targetBase}${req.url}`);
      }
      // A visitor landing on the legacy /hr(/...) path on the HRMS domain gets
      // sent to the clean equivalent so old links redirect to the new URLs.
      if (p === '/hr' || p.startsWith('/hr/')) {
        const clean = p.replace(/^\/hr/, '') || '/';
        return res.redirect(301, clean + (req.url.slice(p.length) || ''));
      }
      return next(); // serve the HR app at the clean path
    }

    // CRM / reports domains: candidate + /hr paths go to their surfaces.
    const pathSurface = isCareersPath ? 'careers' : (isReportPath ? 'reports' : (p === '/hr' || p.startsWith('/hr/') ? 'hrms' : hostSurface));
    if (pathSurface !== hostSurface) {
      const targetBase = await pu.baseFor(pathSurface, req);
      const targetHost = pu.hostOf(targetBase);
      const hereHost = String(req.get('host') || '').split(':')[0].toLowerCase();
      if (targetBase && targetHost && targetHost !== hereHost) return res.redirect(302, `${targetBase}${req.url}`);
    }
    return next();
  } catch (e) { return next(); }
});

// Login is the brute-force surface. Everything else is behind a token.
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Too many attempts. Try again in 15 minutes.' } }));
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 120 }));

app.use('/uploads', express.static(path.join(__dirname, '../storage/uploads')));
// Brand assets (favicon in its various sizes). Served from server/public/brand
// so every page — SPA, reporting, and the public career/job/task/onboarding
// pages — can point at a stable, cacheable icon URL.
app.use('/brand', express.static(path.join(__dirname, 'public/brand'), { maxAge: '7d' }));
app.get('/favicon.ico', (req, res) => res.sendFile(path.join(__dirname, 'public/brand/favicon-32.png')));
app.use('/api/auth', auth);
app.use('/api/reports', reports);
app.use('/api/admin', admin);
app.use('/api/surveys', require('./routes/crmSurvey'));
app.use('/api/demo', demo);
// Shareable training sandbox: /api/demo-app/<token>/... — token-gated inside
// the router, serving fabricated data only. See routes/demoApp.js.
app.use('/api/demo-app/:token', demoApp);
app.use('/api/leads', leads);
app.use('/api/reviews', reviews);
app.use('/api/briefs', briefs);
app.use('/api/tv', tv);
app.use('/api/hr', hr);
app.use('/api/hr', require('./routes/hrMail'));
app.use('/api/hr/attendance', require('./routes/hrAttendance'));
app.use('/api/hr/tasks', require('./routes/hrTasks'));
app.use('/api/hr/tasks', require('./routes/tasks'));
app.use('/api/hr/chat', require('./routes/chat'));
app.use('/api/hr/surveys', require('./routes/hrCrmSurvey'));
app.use('/api/careers', require('./routes/careers'));
app.use('/api/gmail', gmailRoutes);
app.use('/api/track', require('./routes/track'));
app.use('/api/callhippo', require('./routes/callhippo'));
app.use('/api/icons', require('./routes/icons'));

// Public demo page. Only reachable when DEMO_MODE=true; the API routes behind
// it enforce that independently, so serving the HTML is harmless either way.
app.get('/demo', (req, res) => {
  if (process.env.DEMO_MODE !== 'true') return res.status(404).send('Not found.');
  res.sendFile(path.join(__dirname, 'public/demo.html'));
});

// Public, embeddable application form (form only) for a published job.
// <iframe src="…/careers/<token>/embed">. Served before the SPA catch-all.
app.get('/careers/:token/embed', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/careers.html'));
});

app.get('/careers-shared.js', (req, res) => {
  res.type('application/javascript').sendFile(path.join(__dirname, 'public/careers-shared.js'));
});
app.get('/onboarding-shared.js', (req, res) => {
  res.type('application/javascript').sendFile(path.join(__dirname, 'public/onboarding-shared.js'));
});

// Branded OG share image (1200x630, blue box + centered logo). Cached on disk;
// regenerated when missing or when ?refresh=1. Served for all share cards.
app.get('/og/share.png', async (req, res) => {
  try {
    const jobMeta = require('./services/jobMeta');
    const p = jobMeta.ogImagePath();
    const fs2 = require('fs');
    if (req.query.refresh === '1' || !fs2.existsSync(p)) {
      const { Settings } = require('./models');
      const s = await Settings.findOne({ where: { singleton: 'settings' } });
      const branding = (s && s.hrCareers) || {};
      await jobMeta.buildOgImage(branding.logo || '');
    }
    if (fs2.existsSync(p)) { res.type('png'); return res.sendFile(p); }
    return res.status(404).end();
  } catch (e) { return res.status(404).end(); }
});

// Public listing page — the full job post with the application form on the
// Public branded careers listing (all published roles at one URL).
// Shared handler for BOTH /jobs/:token and /careers/:token. A token can be an
// individual job's publicToken OR the careers/brand token — the visible page is
// the same (the careers listing renders client-side), but the injected SEO must
// differ: an individual-job token gets that job's title/description/keywords,
// anything else gets the careers-page SEO. Keeping both routes on one function
// means they can never drift apart again.
async function servePublicCareersOrJob(req, res, tokenPathPrefix) {
  const { HrJobPost, Settings } = require('./models');
  const og = require('./services/ogTags');
  const pu = require('./services/publicUrl');
  // Individual job → the single-job DETAIL template (careers-page.html, which
  // fetches /api/careers/<token>). Careers landing → the LISTING template
  // (jobs-page.html, which fetches /api/careers/careers/<token>). Serving the
  // wrong one is what made an individual job show "Careers page not found".
  const jobTmpl = path.join(__dirname, 'public/careers-page.html');
  const listTmpl = path.join(__dirname, 'public/jobs-page.html');
  try {
    const token = req.params.token;
    const { Op } = require('sequelize');
    const job = await HrJobPost.findOne({ where: { [Op.or]: [{ slug: token }, { publicToken: token }] } });
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const branding = (s && s.hrCareers) || {};
    const base = await pu.baseFor('careers', req);
    if (job) {
      // Canonical clean URL is /jobs/<slug>. If reached via the opaque token or
      // the /careers/ prefix, 301 to the clean slug so engines index one address.
      let slug = job.slug;
      if (!slug) { try { slug = await require('./routes/careers').ensureJobSlug(job); } catch {} }
      slug = slug || job.publicToken;
      const canonical = `/jobs/${slug}`;
      if (req.path !== canonical) return res.redirect(301, canonical);
      const selfUrl = `${base}${canonical}`;
      const loc = Array.isArray(job.locations) && job.locations.length ? job.locations.join(', ') : (job.branch || '');
      const title = job.seoTitle || job.ogTitle || `${job.title}${job.department ? ` — ${job.department}` : ''} | Qtonix Careers`;
      const desc = job.seoDescription || job.ogDescription || og.clip((job.description || '').replace(/<[^>]+>/g, ' ') || `${job.title}${loc ? ` · ${loc}` : ''} — apply now at Qtonix.`);
      const jsonLd = og.jobPostingLd(job, { url: selfUrl, base, logo: branding.logo || `${base}/og/share.png` });
      const html = og.injectIntoHtml(jobTmpl, {
        title, description: desc, image: `${base}/og/share.png`, url: selfUrl, jsonLd,
        keywords: Array.isArray(job.seoKeywords) ? job.seoKeywords : [],
      });
      res.set('Cache-Control', 'no-cache, must-revalidate');
      return res.type('html').send(html);
    }
    const selfUrl = `${base}${tokenPathPrefix}/${token}`;
    // The token was NOT an individual job → it's the careers/brand token (or an
    // unknown token). If it matches the careers page, 301 to the clean root URL
    // so the ugly /careers/<token> address consolidates to career.qtonix.com/.
    if (branding.token && token === branding.token) {
      return res.redirect(301, '/');
    }
    // Careers landing page fallback (unknown token still shows the listing).
    const title = branding.seoTitle || branding.ogTitle || (branding.title ? `${branding.title} | Qtonix Careers` : 'Careers at Qtonix');
    const description = branding.seoDescription || branding.ogDescription || branding.description || 'Explore open roles and join our team at Qtonix.';
    const jobs = await HrJobPost.findAll({ where: { status: 'published' }, order: [['createdAt', 'DESC']], limit: 50 });
    const jsonLd = og.careersItemListLd(jobs, { base });
    const html = og.injectIntoHtml(listTmpl, {
      title, description, image: `${base}/og/share.png`, url: `${base}/`, jsonLd,
      keywords: Array.isArray(branding.seoKeywords) ? branding.seoKeywords : [],
    });
    res.set('Cache-Control', 'no-cache, must-revalidate');
    res.type('html').send(html);
  } catch (e) { res.sendFile(listTmpl); }
}

app.get('/jobs/:token', (req, res) => servePublicCareersOrJob(req, res, '/jobs'));

// Cross-app navigation helpers. These let one app link to another regardless of
// which domain you're on, and they bypass the hostname wall-off (they're under
// /go/, which the middleware ignores). /go/crm always lands on the CRM (its
// configured domain, else the raw deployment URL); /go/hr lands on the HR portal.
app.get('/go/crm', async (req, res) => {
  const pu = require('./services/publicUrl');
  const domains = await pu.loadDomains();
  const base = pu.normalizeOrigin(domains.crm) || pu.envOrigin() || `${req.protocol}://${req.get('host')}`;
  // If CRM has no dedicated domain and we're currently ON the HRMS domain,
  // the raw deployment URL (envOrigin) is where the CRM actually lives.
  return res.redirect(302, `${base}/`);
});
app.get('/go/hr', async (req, res) => {
  const pu = require('./services/publicUrl');
  const domains = await pu.loadDomains();
  const configured = pu.normalizeOrigin(domains.hrms);
  // On a configured HRMS domain the app runs at the clean root (no /hr prefix),
  // so send there directly. Without a dedicated domain, the HR app lives under
  // /hr on the raw deployment.
  if (configured) return res.redirect(302, `${configured}/`);
  const base = pu.envOrigin() || `${req.protocol}://${req.get('host')}`;
  return res.redirect(302, `${base}/hr`);
});

// Serve the careers listing at the clean root URL (career.qtonix.com/) with the
// careers-page SEO injected. Used by the hostname middleware for the root path.
async function serveCareersRoot(req, res) {
  const { HrJobPost, Settings } = require('./models');
  const og = require('./services/ogTags');
  const pu = require('./services/publicUrl');
  const listTmpl = path.join(__dirname, 'public/jobs-page.html');
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const branding = (s && s.hrCareers) || {};
    const base = await pu.baseFor('careers', req);
    const title = branding.seoTitle || branding.ogTitle || (branding.title ? `${branding.title} | Qtonix Careers` : 'Careers at Qtonix');
    const description = branding.seoDescription || branding.ogDescription || branding.description || 'Explore open roles and join our team at Qtonix.';
    const jobs = await HrJobPost.findAll({ where: { status: 'published' }, order: [['createdAt', 'DESC']], limit: 50 });
    const jsonLd = og.careersItemListLd(jobs, { base });
    const html = og.injectIntoHtml(listTmpl, {
      title, description, image: `${base}/og/share.png`, url: `${base}/`, jsonLd,
      keywords: Array.isArray(branding.seoKeywords) ? branding.seoKeywords : [],
    });
    res.set('Cache-Control', 'no-cache, must-revalidate');
    res.type('html').send(html);
  } catch (e) { res.sendFile(listTmpl); }
}

// ===== SEO discovery files for the careers site =====
// Served at the careers domain root: an XML sitemap and an llms.txt, both
// listing every open job so search engines and LLM crawlers can find them.
async function publishedJobsForSeo() {
  const { HrJobPost } = require('./models');
  const careers = require('./routes/careers');
  const jobs = await HrJobPost.findAll({ where: { status: 'published' }, order: [['publishedAt', 'DESC']] });
  await Promise.all(jobs.map((j) => careers.ensureJobSlug(j)));
  return jobs;
}

app.get('/sitemap.xml', async (req, res) => {
  try {
    const pu = require('./services/publicUrl');
    const base = await pu.baseFor('careers', req);
    const jobs = await publishedJobsForSeo();
    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const urls = [
      { loc: `${base}/`, priority: '1.0', changefreq: 'daily' },
      ...jobs.map((j) => ({ loc: `${base}/jobs/${j.slug || j.publicToken}`, lastmod: (j.updatedAt || j.publishedAt || new Date()).toISOString().slice(0, 10), priority: '0.8', changefreq: 'weekly' })),
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url>\n    <loc>${esc(u.loc)}</loc>\n${u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>\n` : ''}    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`).join('\n')}\n</urlset>\n`;
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('application/xml').send(xml);
  } catch (e) { res.status(500).type('application/xml').send('<?xml version="1.0"?><urlset/>'); }
});

app.get('/llms.txt', async (req, res) => {
  try {
    const { Settings } = require('./models');
    const pu = require('./services/publicUrl');
    const base = await pu.baseFor('careers', req);
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const branding = (s && s.hrCareers) || {};
    const jobs = await publishedJobsForSeo();
    const strip = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const lines = [];
    lines.push(`# ${branding.title || 'Qtonix Careers'}`);
    lines.push('');
    lines.push(`> ${branding.seoDescription || branding.description || 'Open positions at Qtonix. Apply online.'}`);
    lines.push('');
    lines.push(`Careers home: ${base}/`);
    lines.push(`Sitemap: ${base}/sitemap.xml`);
    lines.push('');
    lines.push('## Open Positions');
    lines.push('');
    for (const j of jobs) {
      const loc = Array.isArray(j.locations) && j.locations.length ? j.locations.join(', ') : (j.branch || '');
      const meta = [j.department, loc, ({ in_office: 'In office', hybrid: 'Hybrid', remote: 'Remote' })[j.workMode]].filter(Boolean).join(' · ');
      lines.push(`- [${j.title}](${base}/jobs/${j.slug || j.publicToken})${meta ? ` — ${meta}` : ''}`);
      const summary = j.seoDescription || strip(j.description).slice(0, 200);
      if (summary) lines.push(`  ${summary}`);
    }
    lines.push('');
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('text/plain').send(lines.join('\n'));
  } catch (e) { res.status(500).type('text/plain').send('# Careers'); }
});

app.get('/robots.txt', async (req, res) => {
  try {
    const pu = require('./services/publicUrl');
    const base = await pu.baseFor('careers', req);
    res.type('text/plain').send(`User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`);
  } catch (e) { res.type('text/plain').send('User-agent: *\nAllow: /\n'); }
});

// Public candidate task-upload page (assessment task). Same standalone-HTML
// pattern as the careers/schedule pages; the token is in the path.
app.get('/task/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/task-page.html'));
});

// Public candidate onboarding page (document collection before joining). Same
// standalone-HTML pattern; the token is in the path.
app.get('/onboarding/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/onboarding-page.html'));
});

// Public candidate self-schedule page (Calendly-style). Same pattern as careers.
app.get('/schedule/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/schedule-page.html'));
});

// The shareable careers page. Same token space as /jobs/:token — a token may be
// an individual job or the careers/brand token, and the shared handler injects
// the right SEO for each. (This is why /careers/<jobToken> now shows THAT job's
// title instead of the generic careers title.)
app.get('/careers/:token', (req, res) => servePublicCareersOrJob(req, res, '/careers'));

// Public shareable Site Analysis report links (/r/:slug), no auth. Served before
// the SPA catch-all so the customer sees the branded report + download button.
app.use('/', require('./routes/publicReports'));

// Lightweight liveness probe — never touches the DB, so the platform can tell
// the process is up even during a database blip and won't kill the container.
app.get('/healthz', (req, res) => res.status(200).send('ok'));

app.get('/api/health', async (req, res) => {
  let db = false;
  try { await sequelize.authenticate(); db = true; } catch { db = false; }
  res.json({ ok: true, version: APP_VERSION, db, dialect: sequelize.getDialect(), time: new Date() });
});

// -- Optionally serve the built React frontend from the same server.
// If client/dist exists (you ran `npm run build` in client/), the whole app is
// reachable from this one Node process — handy for a single-host Railway deploy.
// On a split deploy (frontend on Vercel), this block is simply inert.
const clientDist = path.join(__dirname, '../client/dist');
if (require('fs').existsSync(clientDist)) {
  // `index: false` stops express.static from auto-serving index.html at '/', so
  // our handler below runs for the root and can inject the surface flag on the
  // HRMS domain. Static still serves JS/CSS/assets normally.
  app.use(express.static(clientDist, { index: false }));
  const indexHtmlPath = path.join(clientDist, 'index.html');
  let _indexHtmlCache = null;
  const readIndexHtml = () => { if (_indexHtmlCache == null) { try { _indexHtmlCache = require('fs').readFileSync(indexHtmlPath, 'utf8'); } catch { _indexHtmlCache = ''; } } return _indexHtmlCache; };
  // Exclude the API, uploads and the standalone /demo page — but NOT
  // /demo-app/<token>, which is the React app running in training mode and so
  // must fall through to index.html like any other client route.
  app.get(/^\/(?!api\/|api$|uploads|demo(?:$|\/)).*/, async (req, res) => {
    try {
      const pu = require('./services/publicUrl');
      const surface = await pu.surfaceForHost(req);
      // On the HRMS domain we serve the HR app at the ROOT with clean URLs (no
      // /hr prefix). We tell the SPA which mode it's in by injecting a global
      // flag; main.jsx reads it to mount the right app at '/'.
      if (surface === 'hrms') {
        const html = readIndexHtml().replace('<head>', `<head>\n    <script>window.__SURFACE__="hrms";</script>`);
        res.set('Cache-Control', 'no-cache');
        return res.type('html').send(html);
      }
    } catch {}
    res.sendFile(indexHtmlPath);
  });
}

app.use((err, req, res, next) => {
  console.error('[api]', err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

const PORT = process.env.PORT || 4000;

// Process-level safety nets. On a hosted platform an unhandled error must not
// take the whole container down (which makes the domain stop resolving). Log
// loudly and keep serving; the platform's own health checks can recycle us if
// truly wedged.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason && reason.stack ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.stack ? err.stack : err);
});

// Connect to the DB with retries instead of exiting on the first failure —
// on Railway the database can lag the app during a co-deploy/restart.
async function connectWithRetry(attempt = 1) {
  const MAX = 10;
  try {
    // Repair the schema BEFORE attempting a sync. Sequelize's alter-sync
    // accumulates duplicate indexes on MySQL and eventually breaches the
    // 64-key-per-table limit, at which point every sync fails. Pruning has to
    // happen first, and must not be blocked by the very failure it fixes.
    if (attempt === 1) {
      try {
        await sequelize.authenticate();
        await pruneDuplicateIndexes();
      } catch (e) {
        console.error('[schema] pre-sync index repair skipped:', e.message);
      }
    }
    await initDb();
    console.log(`Database connected (${sequelize.getDialect()})`);
    return true;
  } catch (e) {
    console.error(`Database connect attempt ${attempt}/${MAX} failed:`, e.message);
    if (attempt >= MAX) {
      // Start the server anyway so the domain resolves and /healthz responds;
      // routes that need the DB will error individually until it recovers.
      console.error('Proceeding to listen without a confirmed DB connection.');
      return false;
    }
    await new Promise((r) => setTimeout(r, Math.min(2000 * attempt, 15000)));
    return connectWithRetry(attempt + 1);
  }
}

connectWithRetry()
  .then(async (connected) => {
    if (connected) {
    // -- One-time, idempotent migration: rename the old default admin
    // (admin@qtonix.com) to the real owner account. Name "Sandeep" with the
    // sales alias "Adam G", email adam@qtonix.com. Runs in place (rename, not
    // delete+recreate) so the account never "comes back" as a new admin, and
    // repairs denormalized owner/agent names on leads and reports. Runs BEFORE
    // the boot safety-net so a stale ADMIN_EMAIL env can't recreate the old
    // account first. Safe to leave in: once renamed there is nothing to do.
    try {
      const fromEmail = (process.env.RENAME_ADMIN_FROM || 'admin@qtonix.com').toLowerCase().trim();
      const toEmail = (process.env.RENAME_ADMIN_TO || 'adam@qtonix.com').toLowerCase().trim();
      const toName = process.env.RENAME_ADMIN_NAME || 'Sandeep';
      const toAlias = process.env.RENAME_ADMIN_ALIAS || 'Adam G';
      const old = await User.findOne({ where: { email: fromEmail } });
      if (old) {
        const clash = await User.findOne({ where: { email: toEmail } });
        if (clash && clash.id !== old.id) {
          console.log(`[admin-rename] ${toEmail} already exists (id ${clash.id}); leaving ${fromEmail} untouched.`);
        } else {
          const oldName = old.name;
          old.email = toEmail; old.name = toName;
          const aliases = Array.isArray(old.aliases) ? old.aliases.filter(Boolean) : [];
          if (!aliases.includes(toAlias)) aliases.unshift(toAlias);
          old.aliases = aliases; old.changed('aliases', true);
          old.role = 'admin'; old.active = true;
          // Apply the password from ADMIN_PASSWORD as part of the rename. Because
          // the rename only fires while admin@qtonix.com still exists (i.e. once),
          // this is inherently a one-time password set — no RESET_ADMIN needed.
          // RENAME_ADMIN_SET_PASSWORD=false opts out if you want to keep the
          // existing password untouched.
          const setPw = String(process.env.RENAME_ADMIN_SET_PASSWORD || 'true').toLowerCase() !== 'false';
          const pw = process.env.ADMIN_PASSWORD;
          let pwNote = '';
          if (setPw && pw) {
            const bcrypt = require('bcryptjs');
            old.passwordHash = await bcrypt.hash(pw, 12);
            pwNote = ' Password set from ADMIN_PASSWORD.';
          }
          await old.save();
          const { Lead, Report } = require('./models');
          try { await Lead.update({ ownerName: toName }, { where: { ownerId: old.id } }); } catch {}
          try { await Report.update({ agentName: toName }, { where: { agentId: old.id } }); } catch {}
          if (oldName) {
            try { await Lead.update({ ownerName: toName }, { where: { ownerName: oldName } }); } catch {}
            try { await Report.update({ agentName: toName }, { where: { agentName: oldName } }); } catch {}
          }
          console.log(`[admin-rename] ${fromEmail} → ${toEmail} (name "${toName}", alias "${toAlias}"). Owner names repaired.${pwNote}`);
        }
      }
    } catch (e) {
      console.error('[admin-rename] skipped:', e.message);
    }

    // -- Boot-time admin safety net. Never throws (so it can't cause a 502).
    // Ensures an admin can always sign in. IMPORTANT: it only recreates the
    // default admin when NO active admin exists at all. Once ownership has been
    // handed to another admin (e.g. Sandeep) and the old default account was
    // deleted, this must NOT resurrect it — otherwise a deleted admin keeps
    // coming back on every deploy. If RESET_ADMIN=true it still resets the
    // password on the existing default account when present.
    try {
      const bcrypt = require('bcryptjs');
      const email = (process.env.ADMIN_EMAIL || 'adam@qtonix.com').toLowerCase().trim();
      const password = process.env.ADMIN_PASSWORD;
      if (password) {
        const existing = await User.findOne({ where: { email } });
        const activeAdmins = await User.count({ where: { role: 'admin', active: true } });
        if (!existing) {
          if (activeAdmins > 0) {
            // Another admin already runs the system — never recreate the old one.
            console.log('[admin] default account absent but an active admin exists — not recreating.');
          } else {
            await User.create({
              name: process.env.ADMIN_NAME || 'Sandeep',
              email,
              passwordHash: await bcrypt.hash(password, 12),
              role: 'admin',
              phone: process.env.ADMIN_PHONE || '',
              designation: 'Administrator',
            });
            console.log('[admin] created (no active admin existed):', email);
          }
        } else if (String(process.env.RESET_ADMIN).toLowerCase() === 'true') {
          existing.passwordHash = await bcrypt.hash(password, 12);
          existing.role = 'admin';
          existing.active = true;
          await existing.save();
          console.log('[admin] password RESET for:', email, '(remove RESET_ADMIN now)');
        } else {
          console.log('[admin] exists:', email, '(set RESET_ADMIN=true to reset password)');
        }
      }
    } catch (e) {
      console.error('[admin] boot check skipped:', e.message);
    }

    // -- One-time, opt-in cleanup for a stale/duplicated admin that keeps
    // reappearing. Set CLEANUP_ADMIN_EMAIL=<old email> (and deploy once) to:
    //   1. reassign that account's leads/reports to the current primary admin,
    //   2. fix any leads/reports still carrying the old owner NAME,
    //   3. delete the stale account.
    // Remove the env var after one successful deploy. Never throws.
    try {
      const staleEmail = (process.env.CLEANUP_ADMIN_EMAIL || '').toLowerCase().trim();
      if (staleEmail) {
        const stale = await User.findOne({ where: { email: staleEmail } });
        // The admin who should receive the data: prefer CLEANUP_REASSIGN_TO
        // (an email), else the oldest OTHER active admin.
        const reassignEmail = (process.env.CLEANUP_REASSIGN_TO || '').toLowerCase().trim();
        let target = null;
        if (reassignEmail) target = await User.findOne({ where: { email: reassignEmail, active: true } });
        if (!target) target = await User.findOne({ where: { role: 'admin', active: true, email: { [Op.ne]: staleEmail } }, order: [['id', 'ASC']] });
        if (!stale) {
          console.log('[cleanup] no account with email', staleEmail, '— nothing to remove.');
        } else if (!target) {
          console.log('[cleanup] skipped: no other active admin to receive', staleEmail, "'s data.");
        } else {
          const { Lead, Report, MonthlyTarget } = require('./models');
          await Lead.update({ ownerId: target.id, ownerName: target.name }, { where: { ownerId: stale.id } });
          await Report.update({ agentId: target.id, agentName: target.name }, { where: { agentId: stale.id } });
          // Also repair any leads/reports that kept the old NAME but a different id.
          if (stale.name) {
            await Lead.update({ ownerName: target.name }, { where: { ownerName: stale.name, ownerId: target.id } });
          }
          await User.update({ managerId: null }, { where: { managerId: stale.id } });
          try { await MonthlyTarget.destroy({ where: { userId: stale.id } }); } catch {}
          await stale.destroy();
          console.log(`[cleanup] removed stale account ${staleEmail}; data reassigned to ${target.email}. Remove CLEANUP_ADMIN_EMAIL now.`);
        }
      }
    } catch (e) {
      console.error('[cleanup] legacy admin cleanup skipped:', e.message);
    }

    // -- One-time (idempotent) migration of existing reports into the new Leads
    // CRM. Safe on every boot; skips already-linked reports. Never throws.
    try {
      const { migrateLeadsFromReports } = require('./migrateLeadsFromReports');
      await migrateLeadsFromReports();
    } catch (e) {
      console.error('[migrate] leads migration skipped:', e.message);
    }

    // -- Backfill CRM config that older databases predate. Additive and
    // idempotent: only inserts what's missing, never overwrites admin edits.
    try {
      const { Settings } = require('./models');
      const s = await Settings.findOne({ where: { singleton: 'settings' } });
      if (s && s.crmConfig) {
        const cfg = { ...s.crmConfig };
        let changed = false;
        // "Call back generated" — the funnel's earliest stage.
        const statuses = Array.isArray(cfg.leadStatuses) ? cfg.leadStatuses : [];
        if (!statuses.some((x) => x.id === 'callback')) {
          cfg.leadStatuses = [{ id: 'callback', label: 'Call back generated', color: '#8B5CF6' }, ...statuses];
          changed = true;
        }
        // "Release" — lets an agent hand a lead back; it leaves their CRM and
        // waits in the Released tab for an admin/lead-manager to reassign.
        if (!(cfg.leadStatuses || statuses).some((x) => x.id === 'release')) {
          cfg.leadStatuses = [...(cfg.leadStatuses || statuses), { id: 'release', label: 'Release', color: '#78716C' }];
          changed = true;
        }
        if (!Array.isArray(cfg.presalesEmails)) { cfg.presalesEmails = []; changed = true; }
        if (!Array.isArray(cfg.presalesTeam)) { cfg.presalesTeam = []; changed = true; }
        // Older configs stored the pre-sales team as plain name strings. Convert
        // any string entries to { name, monthlyTarget } so targets can be set.
        if (Array.isArray(cfg.presalesTeam) && cfg.presalesTeam.some((x) => typeof x === 'string')) {
          cfg.presalesTeam = cfg.presalesTeam.map((x) => typeof x === 'string' ? { name: x, monthlyTarget: 0 } : x);
          changed = true;
        }
        if (changed) { s.crmConfig = cfg; s.changed('crmConfig', true); await s.save(); }
      }
    } catch (e) {
      console.error('[migrate] crm config backfill skipped:', e.message);
    }

    // Backfill the normalised `domain` for any lead that has a website but no
    // domain stored (older leads created before the column was populated, or via
    // paths that didn't set it). Without this, the duplicate-website check can't
    // match legacy leads and would wrongly accept duplicates.
    try {
      const { Lead } = require('./models');
      const { Op } = require('sequelize');
      // Same canonical normalisation as the server's toDomain: naked domain,
      // no protocol/www/path/port.
      const toDomain = (website) => {
        if (!website) return '';
        let s = String(website).trim().toLowerCase();
        if (!s) return '';
        s = s.replace(/^[a-z]+:\/\//, '');
        s = s.split(/[/?#]/)[0];
        s = s.replace(/^[^@]*@/, '').replace(/:\d+$/, '').replace(/^www\./, '');
        return s.trim();
      };
      const needing = await Lead.findAll({
        where: { website: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] } },
        attributes: ['id', 'website', 'domain'],
      });
      let fixed = 0;
      for (const l of needing) {
        const d = toDomain(l.website);
        if (!d) continue;
        // Store BOTH website and domain as the naked domain so they're always
        // identical and consistent \u2014 this is what makes duplicate detection
        // reliable regardless of how the URL was originally typed.
        if (l.website !== d || l.domain !== d) { l.website = d; l.domain = d; await l.save(); fixed++; }
      }
      if (fixed) console.log(`[migrate] normalised website+domain on ${fixed} lead(s)`);
    } catch (e) {
      console.error('[migrate] domain backfill skipped:', e.message);
    }

    // One-time backfill: leads marked converted before convertedAt was tracked
    // (e.g. set directly from the edit form) may have a null convertedAt, which
    // stranded them off the Converted tab's dated views. Stamp them with their
    // createdAt (or now) so they appear correctly.
    try {
      const { Lead, Op } = require('./models');
      const stranded = await Lead.findAll({ where: { status: 'converted', convertedAt: null }, attributes: ['id', 'createdAt'] });
      let stamped = 0;
      for (const l of stranded) {
        l.convertedAt = l.createdAt || new Date();
        await l.save();
        stamped++;
      }
      if (stamped) console.log(`[migrate] backfilled convertedAt on ${stamped} converted lead(s)`);
    } catch (e) {
      console.error('[migrate] convertedAt backfill skipped:', e.message);
    }

    // One-time backfill: leave rows approved/declined under an older version may
    // have null approvedBy / decidedAt, which made the Leave console show blank
    // "Approved By" / "Date". Stamp them from the intended approver + updatedAt so
    // decided requests always show who acted and when.
    try {
      const { HrLeave, Op } = require('./models');
      const legacy = await HrLeave.findAll({ where: { status: { [Op.in]: ['approved', 'rejected'] }, [Op.or]: [{ approvedBy: null }, { decidedAt: null }] } });
      let fixed = 0;
      for (const r of legacy) {
        let touched = false;
        if (!r.approvedBy && r.status === 'approved' && r.approverName) { r.approvedBy = r.approverName; touched = true; }
        if (!r.decidedAt) { r.decidedAt = r.updatedAt || r.createdAt || new Date(); touched = true; }
        if (touched) { await r.save(); fixed++; }
      }
      if (fixed) console.log(`[migrate] backfilled decided fields on ${fixed} leave row(s)`);
    } catch (e) {
      console.error('[migrate] leave decided-field backfill skipped:', e.message);
    }

    // One-time backfill: normalise candidate joining dates to yyyy-mm-dd. Dates
    // entered in Indian DD/MM/YYYY (or other) formats were being misread (e.g.
    // 2/9/2026 parsed as 9 Feb), which hid future joiners from the onboarding
    // page. Rewrite any non-ISO joining date to canonical ISO so comparisons and
    // display are correct everywhere.
    try {
      const { HrCandidate } = require('./models');
      const { normalizeJoiningYmd } = require('./routes/hr');
      if (typeof normalizeJoiningYmd === 'function') {
        const cands = await HrCandidate.findAll();
        let fixed = 0;
        for (const c of cands) {
          const offer = c.offer;
          if (!offer || !offer.joiningDate) continue;
          const raw = String(offer.joiningDate);
          if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) continue; // already clean ISO
          const norm = normalizeJoiningYmd(raw);
          if (norm && norm !== raw) { offer.joiningDate = norm; c.offer = offer; c.changed('offer', true); await c.save(); fixed++; }
        }
        if (fixed) console.log(`[migrate] normalised joining date on ${fixed} candidate(s)`);
      }
    } catch (e) {
      console.error('[migrate] joining-date normalise skipped:', e.message);
    }

    // One-time migration: "callback" is reserved for the Call Backs section
    // (cold-calling prospects). Any lead sitting in callback status whose source
    // is NOT cold calling was mis-categorised — move it to "followup" so it
    // stops appearing in the Call Backs tab. Genuine cold-calling prospects stay.
    try {
      const { Lead, Op } = require('./models');
      const [affected] = await Lead.update(
        { status: 'followup' },
        { where: { status: 'callback', leadSource: { [Op.notLike]: '%cold%' } } }
      );
      if (affected) console.log(`[migrate] moved ${affected} non-cold-calling callback lead(s) to followup`);
    } catch (e) {
      console.error('[migrate] callback→followup migration skipped:', e.message);
    }

    // One-time cleanup: keep only the latest report per lead. Older reports for
    // the same lead are deleted (with their PDFs); a timeline note on the lead
    // records that a prior report existed. Runs every boot but is a no-op once
    // each lead has a single report.
    try {
      const { Report, Lead } = require('./models');
      const fs = require('fs');
      const all = await Report.findAll({
        where: { leadId: { [Op.ne]: null } },
        attributes: ['id', 'leadId', 'businessName', 'domain', 'pdfPath', 'createdAt'],
        order: [['leadId', 'ASC'], ['createdAt', 'DESC']],
      });
      const seen = new Set();
      const toDelete = [];
      for (const r of all) {
        if (seen.has(r.leadId)) toDelete.push(r); // not the newest for this lead
        else seen.add(r.leadId);
      }
      let removed = 0;
      for (const old of toDelete) {
        try { if (old.pdfPath && fs.existsSync(old.pdfPath)) fs.unlinkSync(old.pdfPath); } catch { /* best effort */ }
        try {
          const lead = await Lead.findByPk(old.leadId, { attributes: ['id', 'timeline'] });
          if (lead) {
            const tl = Array.isArray(lead.timeline) ? lead.timeline : [];
            tl.push({
              type: 'report',
              text: `Older report (${old.businessName || old.domain || 'analysis'}, ${new Date(old.createdAt).toLocaleDateString('en-GB')}) removed — keeping only the latest`,
              time: new Date().toISOString(), author: 'system',
            });
            lead.timeline = tl; lead.changed('timeline', true);
            await lead.save();
          }
        } catch { /* best effort timeline note */ }
        await Report.destroy({ where: { id: old.id } });
        removed++;
      }
      if (removed) console.log(`[migrate] removed ${removed} older report(s), keeping latest per lead`);
    } catch (e) {
      console.error('[migrate] report dedup skipped:', e.message);
    }
    // Seed the two default HR branches once, so the branch dropdown isn't empty.
    try {
      const { HrBranch, HrDepartment } = require('./models');
      for (const name of ['Bhubaneswar', 'Kolkata']) {
        await HrBranch.findOrCreate({ where: { name }, defaults: { name } });
      }
      for (const name of ['Human Resources', 'Sales', 'Operations', 'Technology', 'Finance']) {
        await HrDepartment.findOrCreate({ where: { name }, defaults: { name } });
      }
      const { HrShift } = require('./models');
      await HrShift.findOrCreate({ where: { name: 'General (9-6)' }, defaults: { name: 'General (9-6)', startTime: '09:00', endTime: '18:00', breakStart: '13:00', breakEnd: '13:45' } });
    } catch (e) {
      console.error('[migrate] HR branch/department seed skipped:', e.message);
    }
    // One-time, idempotent: normalize stored employee names to Title Case
    // ("SANDEEP KUMAR SWAIN" → "Sandeep Kumar Swain") so every place that shows a
    // name is uniform. Only rows whose name actually changes are saved.
    try {
      const { HrUser } = require('./models');
      const tc = (raw) => {
        const s = String(raw || '').trim().replace(/\s+/g, ' ');
        if (!s) return s;
        const small = new Set(['de', 'da', 'van', 'von', 'der', 'bin', 'al', 'la', 'le']);
        return s.split(' ').map((word, i) => word.split('-').map((part) => {
          if (!part) return part;
          const lower = part.toLowerCase();
          if (i > 0 && small.has(lower)) return lower;
          return lower.replace(/(^|['’])([a-z\u00C0-\u024F])/g, (m, p1, p2) => p1 + p2.toUpperCase());
        }).join('-')).join(' ');
      };
      const people = await HrUser.findAll();
      let fixed = 0;
      for (const u of people) {
        const norm = tc(u.name);
        if (norm && norm !== u.name) { u.name = norm; await u.save(); fixed += 1; }
      }
      if (fixed) console.log(`[migrate] normalized ${fixed} employee name(s) to Title Case`);
    } catch (e) {
      console.error('[migrate] employee name normalization skipped:', e.message);
    }
    } // end if (connected)

    app.listen(PORT, () => {
      console.log(`API listening on :${PORT}`);
      if (process.env.DEMO_MODE === 'true') console.log(`Demo page: http://localhost:${PORT}/demo`);
      // Fail reports that have been stuck 'running'/'queued' too long (e.g. a
      // hung upstream request before the request timeouts were added), so they
      // don't spin forever. Runs on boot and every 5 minutes.
      const reapStalled = async () => {
        try {
          const { Report } = require('./models');
          const cutoff = new Date(Date.now() - 15 * 60 * 1000);
          const [n] = await Report.update(
            { status: 'failed', error: 'Report timed out and was stopped. Please run it again.', currentStep: 'Failed' },
            { where: { status: { [Op.in]: ['running', 'queued'] }, updatedAt: { [Op.lt]: cutoff } } },
          );
          if (n) console.log(`[reaper] marked ${n} stalled report(s) as failed`);
        } catch (e) { console.error('[reaper] failed:', e.message); }
      };
      reapStalled();
      setInterval(reapStalled, 5 * 60 * 1000);
      // Background Gmail sync (per-user OAuth mailboxes → lead_emails).
      try { require('./jobs/gmailSync').start(require('./models')); }
      catch (e) { console.error('[gmail-sync] not started:', e.message); }
      // Scheduled-email dispatcher (sends queued emails at their chosen time).
      try { require('./jobs/scheduledEmail').start(require('./models')); }
      catch (e) { console.error('[sched-email] not started:', e.message); }
      // Weekly log cleanup (Sunday ~9AM IST, prunes audit+call logs older than 3 months).
      try { require('./jobs/logCleanup').start(require('./models')); }
      catch (e) { console.error('[log-cleanup] not started:', e.message); }
      // One-time OG meta/image backfill for existing published jobs.
      try { require('./jobs/ogBackfill').start(require('./models')); }
      catch (e) { console.error('[og-backfill] not started:', e.message); }
      // Unopened-email nudge (flags tracked emails not opened within 24h).
      try { require('./jobs/unopenedEmail').start(require('./models')); }
      catch (e) { console.error('[unopened-email] not started:', e.message); }
      // Sales-CRM automated emails (activity reminders, target congratulations,
      // encouragement nudges) — sent from the admin mailbox.
      try { require('./jobs/crmReminders').start(require('./models')); }
      catch (e) { console.error('[crm-mail] not started:', e.message); }
      // HR celebration emails (birthday, work anniversary, new-joinee welcome) —
      // founder-signed, sent from adam@qtonix.com.
      try { require('./jobs/hrCelebrations').start(require('./models')); }
      catch (e) { console.error('[hr-celebration] not started:', e.message); }
      // Expense & recurring-vendor payment reminders (3 days before due) to
      // admins + HR (branch-scoped).
      try { require('./jobs/paymentReminders').start(require('./models')); }
      catch (e) { console.error('[payment-reminder] not started:', e.message); }
      try { require('./jobs/onboarding').start(require('./models')); }
      catch (e) { console.error('[onboarding-job] not started:', e.message); }
      try { require('./jobs/badges').start(require('./models')); }
      catch (e) { console.error('[badges-job] not started:', e.message); }
      try { require('./services/rewardSeed').seed(require('./models')); }
      catch (e) { console.error('[reward-seed] failed:', e.message); }
    });
  })
  .catch((e) => {
    console.error('Boot error (continuing to listen):', e.message);
    app.listen(PORT, () => console.log(`API listening on :${PORT} (degraded)`));
  });

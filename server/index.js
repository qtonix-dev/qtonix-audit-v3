require('dotenv').config();

// Bump this on every release so /api/health reveals exactly what's deployed —
// the quickest way to confirm a Railway rebuild actually shipped the new code.
const APP_VERSION = 'v116';

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
      'frame-src': ["'self'"],
    },
  },
}));
app.use(cors({ origin: process.env.CLIENT_ORIGIN || true, credentials: true }));
app.use(express.json({ limit: '2mb' }));

// Login is the brute-force surface. Everything else is behind a token.
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Too many attempts. Try again in 15 minutes.' } }));
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 120 }));

app.use('/uploads', express.static(path.join(__dirname, '../storage/uploads')));
app.use('/api/auth', auth);
app.use('/api/reports', reports);
app.use('/api/admin', admin);
app.use('/api/demo', demo);
// Shareable training sandbox: /api/demo-app/<token>/... — token-gated inside
// the router, serving fabricated data only. See routes/demoApp.js.
app.use('/api/demo-app/:token', demoApp);
app.use('/api/leads', leads);
app.use('/api/reviews', reviews);
app.use('/api/briefs', briefs);
app.use('/api/tv', tv);
app.use('/api/hr', hr);
app.use('/api/gmail', gmailRoutes);
app.use('/api/track', require('./routes/track'));
app.use('/api/icons', require('./routes/icons'));

// Public demo page. Only reachable when DEMO_MODE=true; the API routes behind
// it enforce that independently, so serving the HTML is harmless either way.
app.get('/demo', (req, res) => {
  if (process.env.DEMO_MODE !== 'true') return res.status(404).send('Not found.');
  res.sendFile(path.join(__dirname, 'public/demo.html'));
});

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
  app.use(express.static(clientDist));
  // Exclude the API, uploads and the standalone /demo page — but NOT
  // /demo-app/<token>, which is the React app running in training mode and so
  // must fall through to index.html like any other client route.
  app.get(/^\/(?!api\/|api$|uploads|demo(?:$|\/)).*/, (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
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
    // -- Boot-time admin safety net. Never throws (so it can't cause a 502).
    // Ensures the admin account exists. If RESET_ADMIN=true, it also overwrites
    // the admin password with the current ADMIN_PASSWORD — set that variable,
    // deploy once, log in, then remove RESET_ADMIN.
    try {
      const bcrypt = require('bcryptjs');
      const email = (process.env.ADMIN_EMAIL || 'admin@qtonix.com').toLowerCase().trim();
      const password = process.env.ADMIN_PASSWORD;
      if (password) {
        const existing = await User.findOne({ where: { email } });
        if (!existing) {
          await User.create({
            name: process.env.ADMIN_NAME || 'Adam G',
            email,
            passwordHash: await bcrypt.hash(password, 12),
            role: 'admin',
            phone: process.env.ADMIN_PHONE || '+91-8249016547',
            designation: 'Project Manager',
          });
          console.log('[admin] created:', email);
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
    } // end if (connected)

    app.listen(PORT, () => {
      console.log(`API listening on :${PORT}`);
      if (process.env.DEMO_MODE === 'true') console.log(`Demo page: http://localhost:${PORT}/demo`);
      // Background Gmail sync (per-user OAuth mailboxes → lead_emails).
      try { require('./jobs/gmailSync').start(require('./models')); }
      catch (e) { console.error('[gmail-sync] not started:', e.message); }
      // Scheduled-email dispatcher (sends queued emails at their chosen time).
      try { require('./jobs/scheduledEmail').start(require('./models')); }
      catch (e) { console.error('[sched-email] not started:', e.message); }
      // Unopened-email nudge (flags tracked emails not opened within 24h).
      try { require('./jobs/unopenedEmail').start(require('./models')); }
      catch (e) { console.error('[unopened-email] not started:', e.message); }
    });
  })
  .catch((e) => {
    console.error('Boot error (continuing to listen):', e.message);
    app.listen(PORT, () => console.log(`API listening on :${PORT} (degraded)`));
  });

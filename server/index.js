require('dotenv').config();

// Bump this on every release so /api/health reveals exactly what's deployed —
// the quickest way to confirm a Railway rebuild actually shipped the new code.
const APP_VERSION = 'v273';

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

// Login is the brute-force surface. Everything else is behind a token.
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Too many attempts. Try again in 15 minutes.' } }));
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 120 }));

app.use('/uploads', express.static(path.join(__dirname, '../storage/uploads')));
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
app.use('/api/hr/daily', require('./routes/hrDaily'));
app.use('/api/hr/tasks', require('./routes/hrTasks'));
app.use('/api/hr/tasks', require('./routes/tasks'));
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

// Public listing page — the full job post with the application form on the
// Public branded careers listing (all published roles at one URL).
app.get('/jobs/:token', async (req, res) => {
  try {
    const { HrJobPost, Settings } = require('./models');
    const og = require('./services/ogTags');
    const job = await HrJobPost.findOne({ where: { publicToken: req.params.token } });
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const branding = (s && s.hrCareers) || {};
    const base = `${req.protocol}://${req.get('host')}`;
    if (job) {
      const loc = Array.isArray(job.locations) && job.locations.length ? job.locations.join(', ') : (job.branch || '');
      const desc = og.clip((job.description || '').replace(/<[^>]+>/g, ' ') || `${job.title}${loc ? ` · ${loc}` : ''} — apply now at Qtonix.`);
      const html = og.injectIntoHtml(path.join(__dirname, 'public/jobs-page.html'), {
        title: `${job.title}${job.department ? ` — ${job.department}` : ''} | Qtonix Careers`,
        description: desc, image: branding.logo || '', url: `${base}/jobs/${req.params.token}`,
      });
      return res.type('html').send(html);
    }
    res.sendFile(path.join(__dirname, 'public/jobs-page.html'));
  } catch (e) { res.sendFile(path.join(__dirname, 'public/jobs-page.html')); }
});

// Public candidate task-upload page (assessment task). Same standalone-HTML
// pattern as the careers/schedule pages; the token is in the path.
app.get('/task/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/task-page.html'));
});

// Public candidate self-schedule page (Calendly-style). Same pattern as careers.
app.get('/schedule/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/schedule-page.html'));
});

// right (the shareable careers page). Same token, no auth.
app.get('/careers/:token', async (req, res) => {
  try {
    const { Settings } = require('./models');
    const og = require('./services/ogTags');
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const branding = (s && s.hrCareers) || {};
    const base = `${req.protocol}://${req.get('host')}`;
    const html = og.injectIntoHtml(path.join(__dirname, 'public/careers-page.html'), {
      title: branding.title ? `${branding.title} | Qtonix Careers` : 'Careers at Qtonix',
      description: branding.description || 'Explore open roles and join our team at Qtonix.',
      image: branding.logo || '', url: `${base}/careers/${req.params.token}`,
    });
    res.type('html').send(html);
  } catch (e) { res.sendFile(path.join(__dirname, 'public/careers-page.html')); }
});

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
      // Unopened-email nudge (flags tracked emails not opened within 24h).
      try { require('./jobs/unopenedEmail').start(require('./models')); }
      catch (e) { console.error('[unopened-email] not started:', e.message); }
      // Sales-CRM automated emails (activity reminders, target congratulations,
      // encouragement nudges) — sent from the admin mailbox.
      try { require('./jobs/crmReminders').start(require('./models')); }
      catch (e) { console.error('[crm-mail] not started:', e.message); }
    });
  })
  .catch((e) => {
    console.error('Boot error (continuing to listen):', e.message);
    app.listen(PORT, () => console.log(`API listening on :${PORT} (degraded)`));
  });

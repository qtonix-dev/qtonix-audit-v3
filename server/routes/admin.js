const router = require('express').Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { User, Report, Settings, AuditLog, MonthlyTarget, Lead, sequelize, Op, defaultPricing } = require('../models');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { SERanking } = require('../services/seranking');
const imagekit = require('../services/imagekit');

router.use(requireAuth, requireAdmin);

// ---- Logo upload -----------------------------------------------------------
const UPLOAD_DIR = path.join(__dirname, '../../storage/uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const makeUpload = (kind, maxBytes, extRe, mimeRe, msg) =>
  multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, UPLOAD_DIR),
      filename: (req, file, cb) => cb(null, `${kind}-${Date.now()}${path.extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: maxBytes },
    fileFilter: (req, file, cb) => {
      // Whitelist extension AND mimetype: either alone is trivially spoofed.
      if (extRe.test(file.originalname) && mimeRe.test(file.mimetype)) return cb(null, true);
      cb(new Error(msg));
    },
  });

const upload = makeUpload('logo', 3 * 1024 * 1024, /\.(png|jpg|jpeg|svg|webp)$/i,
  /^image\/(png|jpeg|svg\+xml|webp)$/, 'Upload a PNG, JPG, SVG or WEBP image.');

const uploadFavicon = makeUpload('favicon', 512 * 1024, /\.(png|ico|svg)$/i,
  /^image\/(png|svg\+xml|x-icon|vnd\.microsoft\.icon)$/, 'Upload an ICO, PNG or SVG.');

// ---- Settings --------------------------------------------------------------
router.get('/settings', async (req, res) => {
  let s = await Settings.findOne({ where: { singleton: 'settings' } });
  if (!s) s = await Settings.create({ singleton: 'settings', pricing: defaultPricing() });
  res.json(s.toSafeJSON());
});

// ImageKit — CRM reuses the same keys the HR portal stores. Status + auth
// params so the browser can upload agent avatars straight to ImageKit.
router.get('/imagekit', async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const cfg = imagekit.getConfig(s);
    res.json({ configured: imagekit.isConfigured(s), publicKey: cfg.publicKey || '', urlEndpoint: cfg.urlEndpoint || '', hasPrivateKey: !!cfg.privateKey });
  } catch (e) { next(e); }
});

router.put('/imagekit', async (req, res, next) => {
  try {
    const b = req.body || {};
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const keys = { ...(s.apiKeys || {}) };
    if (b.publicKey !== undefined) keys.imagekitPublic = String(b.publicKey).trim();
    if (b.urlEndpoint !== undefined) keys.imagekitEndpoint = String(b.urlEndpoint).trim();
    if (b.privateKey !== undefined && b.privateKey && !String(b.privateKey).includes('•')) keys.imagekitPrivate = String(b.privateKey).trim();
    s.apiKeys = keys; s.changed('apiKeys', true);
    await s.save();
    const fresh = await Settings.findOne({ where: { singleton: 'settings' } });
    res.json(await imagekit.testConnection(fresh));
  } catch (e) { next(e); }
});

router.get('/imagekit/auth', async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    if (!imagekit.isConfigured(s)) return res.status(400).json({ error: 'ImageKit is not connected. Add the keys in Admin → ImageKit.' });
    res.json(imagekit.getAuthParams(s));
  } catch (e) { next(e); }
});

/**
 * GET /api/admin/callhippo — the CallHippo integration status for the settings
 * page: whether the API token is set, and the exact webhook URL to paste into
 * CallHippo (with a per-install secret path token that we generate once).
 */
router.get('/callhippo', async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    // Generate the webhook secret on first access so the URL is stable.
    let secret = s.getKey('callHippoWebhookSecret');
    if (!secret) {
      secret = require('crypto').randomBytes(18).toString('hex');
      s.apiKeys = { ...s.apiKeys, callHippoWebhookSecret: require('../models').encrypt(secret) };
      s.changed('apiKeys', true);
      await s.save();
    }
    const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    res.json({
      hasToken: !!s.getKey('callHippoToken'),
      webhookUrl: `${base}/api/callhippo/webhook/${secret}`,
    });
  } catch (e) { next(e); }
});

router.put('/settings', async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const body = req.body || {};

    const plain = ['companyName','companyShort','website','email','phone','address',
                   'fontFamily','reportValidDays','dailyReportLimit','cacheDays','defaultCountry'];
    for (const f of plain) if (body[f] !== undefined) s[f] = body[f];
    if (body.colors) { s.colors = { ...s.colors, ...body.colors }; s.changed('colors', true); }
    if (body.socialLinks) { s.socialLinks = { ...(s.socialLinks || {}), ...body.socialLinks }; s.changed('socialLinks', true); }
    if (body.pricing) { s.pricing = body.pricing; s.changed('pricing', true); }
    if (body.crmConfig) { s.crmConfig = body.crmConfig; s.changed('crmConfig', true); }

    // Only overwrite a key if a real new value was sent — the UI shows masked
    // placeholders, and saving the form must not wipe the stored key.
    if (body.apiKeys) {
      const next = { ...s.apiKeys };
      for (const [k, v] of Object.entries(body.apiKeys)) {
        // The UI shows masked placeholders. Saving the form must never wipe a
        // stored key just because the field still shows the mask.
        if (v && !String(v).startsWith('••')) next[k] = v;
      }
      s.apiKeys = next;
      s.changed('apiKeys', true);
    }

    await s.save();
    await AuditLog.create({ userId: req.user.id, userName: req.user.name, action: 'settings.update', ip: req.ip });
    res.json(s.toSafeJSON());
  } catch (e) { next(e); }
});

router.post('/settings/logo', upload.single('logo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file received.' });
    const s = await Settings.findOne({ singleton: 'settings' });
    // Remove the previous file so uploads don't accumulate forever.
    if (s.logoPath) {
      const old = path.join(UPLOAD_DIR, path.basename(s.logoPath));
      if (fs.existsSync(old)) fs.unlinkSync(old);
    }
    s.logoPath = `/uploads/${req.file.filename}`;
    await s.save();
    await AuditLog.create({ userId: req.user.id, userName: req.user.name, action: 'settings.logo', ip: req.ip });
    res.json({ logoPath: s.logoPath });
  } catch (e) { next(e); }
});

router.post('/settings/favicon', uploadFavicon.single('favicon'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file received.' });
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    if (s.faviconPath) {
      const old = path.join(UPLOAD_DIR, path.basename(s.faviconPath));
      if (fs.existsSync(old)) fs.unlinkSync(old);
    }
    s.faviconPath = `/uploads/${req.file.filename}`;
    await s.save();
    await AuditLog.create({ userId: req.user.id, userName: req.user.name, action: 'settings.favicon', ip: req.ip });
    res.json({ faviconPath: s.faviconPath });
  } catch (e) { next(e); }
});

/**
 * Save a branding image URL (logo or favicon) that was uploaded to ImageKit by
 * the browser. Storing the full ImageKit URL — rather than a local file path —
 * means the logo/favicon survive server restarts and redeploys (Railway's disk
 * is ephemeral, so ./storage/uploads files are wiped ~daily, which caused the
 * logo to keep disappearing).
 */
router.post('/settings/branding-url', async (req, res, next) => {
  try {
    const { kind, url } = req.body || {};
    if (!['logo', 'favicon'].includes(kind)) return res.status(400).json({ error: 'kind must be logo or favicon.' });
    if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'A valid https URL is required.' });
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const key = kind === 'logo' ? 'logoPath' : 'faviconPath';
    // Clean up a previous LOCAL file if we're replacing one (ImageKit URLs are
    // left as-is; ImageKit manages its own storage).
    if (s[key] && s[key].startsWith('/uploads/')) {
      const old = path.join(UPLOAD_DIR, path.basename(s[key]));
      if (fs.existsSync(old)) { try { fs.unlinkSync(old); } catch { /* ignore */ } }
    }
    s[key] = url;
    await s.save();
    await AuditLog.create({ userId: req.user.id, userName: req.user.name, action: `settings.${kind}`, ip: req.ip });
    res.json({ [key]: url });
  } catch (e) { next(e); }
});

/** Remove logo or favicon. */
router.delete('/settings/:asset(logo|favicon)', async (req, res, next) => {
  try {
    const key = req.params.asset === 'logo' ? 'logoPath' : 'faviconPath';
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    if (s[key] && s[key].startsWith('/uploads/')) {
      // Only local files need unlinking; ImageKit URLs are left to ImageKit.
      const f = path.join(UPLOAD_DIR, path.basename(s[key]));
      if (fs.existsSync(f)) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
    }
    s[key] = '';
    await s.save();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** Test a key before saving it — a bad key should fail here, not mid-report. */
router.post('/settings/test-key', async (req, res) => {
  const { service, key } = req.body || {};
  const s = await Settings.findOne({ where: { singleton: 'settings' } });
  const useKey = key && !String(key).startsWith('••') ? key : s.getKey(service);
  if (!useKey) return res.status(400).json({ ok: false, error: 'No key to test.' });

  try {
    if (service === 'seranking') {
      const se = new SERanking(useKey);
      const sub = await se.getSubscription();
      return res.json({ ok: true, detail: sub });
    }
    if (service === 'anthropic') {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': useKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`);
      return res.json({ ok: true, detail: 'Key is valid.' });
    }
    if (service === 'pagespeed') {
      const u = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://example.com&key=${useKey}`;
      const r = await fetch(u);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return res.json({ ok: true, detail: 'Key is valid.' });
    }
    if (service === 'googlePlaces') {
      // Text Search (New) with a minimal field mask is the cheapest valid probe.
      const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': useKey,
          'X-Goog-FieldMask': 'places.id',
        },
        body: JSON.stringify({ textQuery: 'coffee', maxResultCount: 1 }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`);
      return res.json({ ok: true, detail: 'Key is valid. (Ensure "Places API (New)" is enabled.)' });
    }
    if (service === 'callHippoToken') {
      // Validate the CallHippo API token via a cheap read (user list). If that
      // path 404s on the account, try the numbers list before giving up.
      const probes = ['https://web.callhippo.com/v1/user/list', 'https://web.callhippo.com/v1/number/list'];
      let lastErr = null;
      for (const url of probes) {
        try {
          const r = await fetch(url, { headers: { apiToken: useKey, apitoken: useKey, accept: 'application/json' } });
          if (r.ok) return res.json({ ok: true, detail: 'Token is valid.' });
          lastErr = `HTTP ${r.status}`;
          if (r.status === 401 || r.status === 403) throw new Error(`HTTP ${r.status}: token rejected`);
        } catch (e) { lastErr = e.message; }
      }
      throw new Error(lastErr || 'Could not validate token.');
    }
    if (service === 'openai') {
      // Listing models is a cheap, read-only way to validate the key.
      const r = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${useKey}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`);
      return res.json({ ok: true, detail: 'Key is valid.' });
    }
    res.status(400).json({ ok: false, error: 'Unknown service.' });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ---- Users -----------------------------------------------------------------
router.get('/users', async (req, res) => {
  const users = await User.findAll({ attributes: { exclude: ['passwordHash'] }, order: [['createdAt', 'DESC']] });
  res.json(users);
});

/**
 * GET /api/admin/monthly-targets?period=YYYY-MM[&managerId=]
 * Returns agents/managers with their stored target+achieved for the month.
 * With managerId, scopes to that manager plus the agents in their team/shift.
 */
router.get('/monthly-targets', async (req, res, next) => {
  try {
    const period = String(req.query.period || '');
    if (!/^\d{4}-\d{2}$/.test(period)) return res.status(400).json({ error: 'A valid period (YYYY-MM) is required.' });
    const managerId = req.query.managerId ? Number(req.query.managerId) : null;

    const users = (await User.findAll({
      where: { role: { [Op.in]: ['agent', 'manager'] } },
      attributes: ['id', 'name', 'role', 'team', 'shift', 'targets', 'managerId', 'archived'],
      order: [['role', 'DESC'], ['name', 'ASC']],
    })).map((u) => u.toJSON());

    let scoped = users;
    if (managerId) {
      const mgr = users.find((u) => u.id === managerId && u.role === 'manager');
      if (mgr) {
        // The manager plus every agent under them — matched by managerId first
        // (survives team/shift changes and covers archived agents whose team was
        // recorded), falling back to team+shift for older records.
        scoped = users.filter((u) => u.id === managerId
          || (u.role === 'agent' && (u.managerId === managerId || (u.team === mgr.team && u.shift === mgr.shift))));
      } else {
        scoped = [];
      }
    }

    const stored = await MonthlyTarget.findAll({ where: { period, userId: { [Op.in]: scoped.map((u) => u.id).concat(-1) } } });
    const byUser = {};
    stored.forEach((s) => { byUser[s.userId] = s.toJSON(); });

    // Live CRM collected sales for the month, per user — used to pre-fill the
    // Achieved column when there's no saved override. Mirrors the sales math
    // used elsewhere: first paid installment of each closed-won deal (recurring
    // counts only its first cycle), converted to USD, dated by paidDate.
    const [py, pm] = period.split('-').map(Number);
    const mStart = new Date(py, pm - 1, 1);
    const mEnd = new Date(py, pm, 1);
    const settings = await Settings.findOne();
    const fx = (settings && settings.crmConfig && settings.crmConfig.fxRates) || { USD: 1 };
    const toUsd = (amt, cur) => (Number(amt) || 0) / (fx[cur || 'USD'] || 1);
    const liveByUser = {};
    const scopedIds = scoped.map((u) => u.id);
    if (scopedIds.length) {
      const leads = await Lead.findAll({ where: { ownerId: { [Op.in]: scopedIds } }, attributes: ['ownerId', 'deals'] });
      for (const l of leads) {
        for (const d of (l.deals || [])) {
          if (d.stage !== 'closed_won') continue;
          for (const it of (d.installments || [])) {
            if (it.recurring && Number(it.seq || 0) > 1) continue;
            if (it.paid && it.paidDate) {
              const pd = new Date(it.paidDate);
              if (pd >= mStart && pd < mEnd) liveByUser[l.ownerId] = (liveByUser[l.ownerId] || 0) + toUsd(it.amount, d.currency);
            }
          }
        }
      }
    }

    const rows = scoped.map((u) => {
      const t = u.targets || {};
      const currentTarget = (t.sales && t.sales.enabled) ? Number(t.sales.monthly || 0) : 0;
      const rec = byUser[u.id];
      const liveAchieved = Math.round(liveByUser[u.id] || 0);
      return {
        userId: u.id, name: u.name, role: u.role, team: u.team, shift: u.shift,
        managerId: u.managerId, archived: !!u.archived,
        // Saved row wins; otherwise pre-fill target from the user config and
        // achieved from live CRM sales (admin can overwrite before saving).
        targetUsd: rec ? rec.targetUsd : currentTarget,
        achievedUsd: rec ? rec.achievedUsd : liveAchieved,
        liveAchievedUsd: liveAchieved, // always the live figure, for reference
        hasRecord: !!rec,
      };
    });

    res.json({ period, managerId, rows });
  } catch (e) { next(e); }
});

/**
 * POST /api/admin/archived-agents — create a record for a departed agent who
 * was never in the system, so their historical monthly targets can be entered.
 * Stored as an inactive+archived user (excluded from every live surface),
 * optionally linked to the manager/team they worked under.
 */
router.post('/archived-agents', async (req, res, next) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Enter the agent’s name.' });
    const managerId = b.managerId ? Number(b.managerId) : null;
    let team = b.team || null, shift = b.shift || null;
    if (managerId) {
      const mgr = await User.findByPk(managerId);
      if (mgr && mgr.role === 'manager') { team = team || mgr.team; shift = shift || mgr.shift; }
    }
    const email = `departed+${Date.now()}@archived.local`;
    const bcrypt = require('bcryptjs');
    const passwordHash = await bcrypt.hash(`archived-${Date.now()}-${Math.random()}`, 10);
    const user = await User.create({
      name, email, passwordHash, role: 'agent',
      team, shift, managerId, active: false, archived: true,
    });
    await AuditLog.create({
      userId: req.user.id, userName: req.user.name, action: 'archived-agent.create',
      target: name, ip: req.ip,
    });
    res.status(201).json({ id: user.id, name: user.name, role: 'agent', team, shift, managerId, archived: true });
  } catch (e) { next(e); }
});

/** POST /api/admin/monthly-targets — upsert one user's target+achieved for a month. */
router.post('/monthly-targets', async (req, res, next) => {
  try {
    const b = req.body || {};
    const userId = Number(b.userId);
    const period = String(b.period || '');
    if (!userId || !/^\d{4}-\d{2}$/.test(period)) return res.status(400).json({ error: 'userId and a valid period are required.' });
    const user = await User.findByPk(userId);
    if (!user || !['agent', 'manager'].includes(user.role)) return res.status(404).json({ error: 'User not found.' });

    const [row] = await MonthlyTarget.findOrCreate({
      where: { userId, period },
      defaults: { userId, period, userName: user.name, role: user.role },
    });
    row.userName = user.name;
    row.role = user.role;
    if (b.targetUsd !== undefined) row.targetUsd = Math.max(0, Number(b.targetUsd) || 0);
    if (b.achievedUsd !== undefined) row.achievedUsd = Math.max(0, Number(b.achievedUsd) || 0);
    row.enteredById = req.user.id;
    row.enteredByName = req.user.name;
    await row.save();

    await AuditLog.create({
      userId: req.user.id, userName: req.user.name, action: 'monthly-target.save',
      target: `${user.name} (${period})`, ip: req.ip,
    });
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

router.post('/users', async (req, res, next) => {
  try {
    const { name, email, password, role, phone, designation, team, shift, aliases, managerScopes, jobType, managerId, targets, birthday, joiningDate, maritalStatus, anniversary, canViewConverted, callHippoEmail } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const exists = await User.findOne({ where: { email: String(email).toLowerCase() } });
    if (exists) return res.status(409).json({ error: 'That email is already registered.' });

    const validRole = ['agent', 'manager', 'admin', 'leadmanager'].includes(role) ? role : 'agent';
    // Admins and lead managers sit outside the branch/shift structure — admins
    // oversee everything, lead managers coordinate intake across the floor.
    const outsideStructure = validRole === 'admin' || validRole === 'leadmanager';
    const user = await User.create({
      name, email: String(email).toLowerCase(), passwordHash: await bcrypt.hash(password, 12),
      role: validRole, phone: phone || '', designation: designation || 'Sales Executive',
      birthday: birthday || null, joiningDate: joiningDate || null,
      // Work anniversary is derived from joiningDate; marriage anniversary only
      // applies when married.
      maritalStatus: ['single', 'married'].includes(maritalStatus) ? maritalStatus : null,
      anniversary: (maritalStatus === 'married' && anniversary) ? anniversary : null,
      canViewConverted: !!canViewConverted,
      team: outsideStructure ? null : (['Bhubaneswar', 'Kolkata'].includes(team) ? team : 'Bhubaneswar'),
      shift: outsideStructure ? null : (['Morning', 'Night'].includes(shift) ? shift : 'Morning'),
      managerScopes: validRole === 'manager' && Array.isArray(managerScopes) ? managerScopes : [],
      jobType: validRole === 'agent' ? (['bde', 'presales'].includes(jobType) ? jobType : 'bde') : null,
      managerId: validRole === 'agent' && managerId ? Number(managerId) : null,
      targets: targets && typeof targets === 'object' ? targets : undefined,
      aliases: Array.isArray(aliases) ? aliases : (aliases ? String(aliases).split(',').map((a) => a.trim()).filter(Boolean) : []),
      callHippoEmail: callHippoEmail ? String(callHippoEmail).toLowerCase().trim() : null,
    });
    await AuditLog.create({ userId: req.user.id, userName: req.user.name, action: 'user.create', target: user.email, ip: req.ip });
    const out = user.toJSON(); delete out.passwordHash;
    res.status(201).json(out);
  } catch (e) { next(e); }
});

router.put('/users/:id', async (req, res, next) => {
  try {
    const { name, email, role, phone, designation, active, password, team, shift, aliases, managerScopes, jobType, managerId, targets, avatar, birthday, joiningDate, maritalStatus, anniversary, canViewConverted, callHippoEmail } = req.body || {};
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    // An admin locking themselves out is unrecoverable without DB access.
    if (user.id === req.user.id && (active === false || role === 'agent' || role === 'manager')) {
      return res.status(400).json({ error: 'You cannot deactivate or demote your own account.' });
    }

    if (name !== undefined) user.name = name;
    // Login email is editable (this is the address the user signs in with).
    // Validate format and enforce uniqueness across users.
    if (email !== undefined) {
      const next = String(email).toLowerCase().trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) return res.status(400).json({ error: 'Please enter a valid email address.' });
      if (next !== (user.email || '').toLowerCase()) {
        const clash = await User.findOne({ where: { email: next } });
        if (clash && clash.id !== user.id) return res.status(409).json({ error: 'That email is already in use by another user.' });
        user.email = next;
      }
    }
    if (birthday !== undefined) user.birthday = birthday || null;
    if (joiningDate !== undefined) user.joiningDate = joiningDate || null;
    if (maritalStatus !== undefined) {
      user.maritalStatus = ['single', 'married'].includes(maritalStatus) ? maritalStatus : null;
      // Clear the wedding date if they're no longer married.
      if (user.maritalStatus !== 'married') user.anniversary = null;
    }
    if (anniversary !== undefined && user.maritalStatus === 'married') user.anniversary = anniversary || null;
    if (canViewConverted !== undefined) user.canViewConverted = !!canViewConverted;
    if (role !== undefined) user.role = ['agent', 'manager', 'admin', 'leadmanager'].includes(role) ? role : 'agent';
    if (phone !== undefined) user.phone = phone;
    if (designation !== undefined) user.designation = designation;
    if (team !== undefined && ['Bhubaneswar', 'Kolkata'].includes(team)) user.team = team;
    if (shift !== undefined && ['Morning', 'Night'].includes(shift)) user.shift = shift;
    // Admins have no branch/shift — they oversee all groups.
    if (user.role === 'admin') { user.team = null; user.shift = null; }
    if (managerScopes !== undefined) user.managerScopes = Array.isArray(managerScopes) ? managerScopes : [];
    // Clear scopes if no longer a manager.
    if (user.role !== 'manager') user.managerScopes = [];
    if (targets !== undefined && targets && typeof targets === 'object') { user.targets = targets; user.changed('targets', true); }
    // Job type + reporting manager only apply to agents.
    if (user.role === 'agent') {
      if (jobType !== undefined) user.jobType = ['bde', 'presales'].includes(jobType) ? jobType : 'bde';
      if (managerId !== undefined) user.managerId = managerId ? Number(managerId) : null;
    } else {
      user.jobType = null;
      user.managerId = null;
    }
    if (aliases !== undefined) user.aliases = Array.isArray(aliases) ? aliases : String(aliases).split(',').map((a) => a.trim()).filter(Boolean);
    if (callHippoEmail !== undefined) user.callHippoEmail = callHippoEmail ? String(callHippoEmail).toLowerCase().trim() : null;
    if (active !== undefined) user.active = !!active;
    // Avatar as a data URL (base64). Guard size (~200KB of base64) to keep the
    // row small; the client downscales before upload.
    if (avatar !== undefined) {
      if (avatar && String(avatar).length > 300000) return res.status(400).json({ error: 'Image too large — please use a smaller photo.' });
      user.avatar = avatar || null;
    }
    if (password) {
      if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      user.passwordHash = await bcrypt.hash(password, 12);
    }
    await user.save();
    await AuditLog.create({ userId: req.user.id, userName: req.user.name, action: 'user.update', target: user.email, ip: req.ip });
    const out2 = user.toJSON(); delete out2.passwordHash;
    res.json(out2);
  } catch (e) { next(e); }
});

// GET /api/admin/users/:id/impact — how many leads/reports this user owns, so
// the delete dialog can prompt for a reassignment target.
router.get('/users/:id/impact', async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const [leads, reports, reportsBy] = await Promise.all([
      Lead.count({ where: { ownerId: user.id } }),
      Report.count({ where: { agentId: user.id } }),
      User.count({ where: { managerId: user.id } }),
    ]);
    res.json({ leads, reports, directReports: reportsBy });
  } catch (e) { next(e); }
});

// DELETE /api/admin/users/:id — permanently remove a user. Their owned leads and
// reports are reassigned to `reassignTo` (required when they own any), so nothing
// is orphaned. Guards: can't delete self or the last active admin.
router.delete('/users/:id', async (req, res, next) => {
  try {
    if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account.' });
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    // Never allow removing the last remaining admin.
    if (user.role === 'admin') {
      const admins = await User.count({ where: { role: 'admin', active: true } });
      if (admins <= 1) return res.status(400).json({ error: 'You cannot delete the last active admin.' });
    }

    const ownedLeads = await Lead.count({ where: { ownerId: user.id } });
    const ownedReports = await Report.count({ where: { agentId: user.id } });
    const reassignTo = (req.body && req.body.reassignTo) ? Number(req.body.reassignTo) : null;

    if (ownedLeads > 0 || ownedReports > 0) {
      if (!reassignTo) return res.status(400).json({ error: 'Choose a user to receive this person’s leads and reports before deleting.' });
      if (reassignTo === user.id) return res.status(400).json({ error: 'Pick a different user to receive the leads and reports.' });
      const target = await User.findOne({ where: { id: reassignTo, active: true } });
      if (!target) return res.status(400).json({ error: 'The selected user to receive the data is not valid.' });
      // Move ownership. enteredById (historical "who keyed it") is left intact.
      if (ownedLeads > 0) await Lead.update({ ownerId: target.id, assignedAt: new Date() }, { where: { ownerId: user.id } });
      if (ownedReports > 0) await Report.update({ agentId: target.id, agentName: target.name }, { where: { agentId: user.id } });
    }

    // Clear reporting lines that point at this user so nobody reports to a ghost.
    await User.update({ managerId: null }, { where: { managerId: user.id } });
    // Remove personal records tied to the account.
    try { await MonthlyTarget.destroy({ where: { userId: user.id } }); } catch {}

    const label = user.email;
    await user.destroy();
    await AuditLog.create({ userId: req.user.id, userName: req.user.name, action: 'user.delete', target: `${label}${reassignTo ? ` → reassigned ${ownedLeads} leads / ${ownedReports} reports` : ''}`, ip: req.ip });
    res.json({ ok: true, reassigned: { leads: ownedLeads, reports: ownedReports } });
  } catch (e) { next(e); }
});

// ---- Dashboard -------------------------------------------------------------
router.get('/stats', async (req, res, next) => {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [total, complete, failed, running, last30, credits, byAgent] = await Promise.all([
      Report.count(),
      Report.count({ where: { status: 'complete' } }),
      Report.count({ where: { status: 'failed' } }),
      Report.count({ where: { status: { [Op.in]: ['queued', 'running'] } } }),
      Report.count({ where: { createdAt: { [Op.gte]: since } } }),
      Report.sum('creditsUsed'),
      Report.findAll({
        attributes: ['agentName', [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
                     [sequelize.fn('SUM', sequelize.col('creditsUsed')), 'credits']],
        group: ['agentName'], order: [[sequelize.literal('count'), 'DESC']], limit: 10, raw: true,
      }),
    ]);

    let seCredits = null;
    let keyStatus = { seranking: false, anthropic: false, googlePlaces: false };
    try {
      const s = await Settings.findOne({ where: { singleton: 'settings' } });
      if (s) {
        keyStatus = {
          seranking: !!s.getKey('seranking'),
          anthropic: !!s.getKey('anthropic'),
          googlePlaces: !!s.getKey('googlePlaces'),
        };
        if (s.getKey('seranking')) seCredits = await new SERanking(s.getKey('seranking')).getSubscription();
      }
    } catch { /* credit balance is nice-to-have, never block the dashboard */ }

    res.json({
      reports: { total, complete, failed, running, last30 },
      creditsUsed: credits || 0,
      byAgent: byAgent.map((a) => ({ _id: a.agentName, count: Number(a.count), credits: Number(a.credits || 0) })),
      seRankingAccount: seCredits,
      keyStatus,
    });
  } catch (e) { next(e); }
});

/** Restore the shipped pricing defaults — an undo for a mangled pricing table. */
router.post('/settings/pricing/reset', async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    s.pricing = defaultPricing();
    s.changed('pricing', true);
    await s.save();
    await AuditLog.create({ userId: req.user.id, userName: req.user.name, action: 'pricing.reset', ip: req.ip });
    res.json(s.toSafeJSON());
  } catch (e) { next(e); }
});

router.get('/logs', async (req, res) => {
  const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit, 10) || 100));
  const logs = await AuditLog.findAll({ order: [['createdAt', 'DESC']], limit });
  res.json(logs);
});

/**
 * GET /api/admin/imagekit-usage — ImageKit account usage for the current month
 * (bandwidth + storage + requests). Uses the stored private key via Basic auth.
 * Works on the free tier; returns { configured:false } if no key.
 */
router.get('/imagekit-usage', async (req, res) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const cfg = imagekit.getConfig(s);
    if (!cfg.privateKey) return res.json({ configured: false });
    const now = new Date();
    const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const end = now.toISOString().slice(0, 10);
    const auth = Buffer.from(`${cfg.privateKey}:`).toString('base64');
    const url = `https://api.imagekit.io/v1/accounts/usage?startDate=${start}&endDate=${end}`;
    let data = null, error = null;
    try {
      const r = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
      const txt = await r.text();
      if (!r.ok) { error = `HTTP ${r.status}`; }
      else { try { data = JSON.parse(txt); } catch { data = null; } }
    } catch (e) { error = e.message; }
    res.json({ configured: true, period: start.slice(0, 7), start, end, data, error });
  } catch (e) {
    res.json({ configured: false, error: e.message });
  }
});

/**
 * GET /api/admin/api-usage — self-tracked call counts for paid APIs that don't
 * expose a billable balance (Anthropic, OpenAI). Returns this month + all time.
 */
router.get('/api-usage', async (req, res, next) => {
  try {
    const { ApiUsage } = require('../models');
    const now = new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const rows = await ApiUsage.findAll();
    const out = {};
    for (const r of rows) {
      const p = r.provider;
      out[p] = out[p] || { month: 0, total: 0 };
      out[p].total += r.count;
      if (r.period === period) out[p].month += r.count;
    }
    res.json({ period, usage: out });
  } catch (e) { next(e); }
});

/**
 * GET /api/admin/seranking-credits — remaining balance from SE Ranking plus the
 * credits we've consumed through this app (summed from report runs).
 */
router.get('/seranking-credits', async (req, res) => {
  try {
    const settings = await Settings.findOne({ where: { singleton: 'settings' } });
    const key = settings && settings.getKey ? settings.getKey('seranking') : null;

    // Our own usage, straight from the reports we've run.
    const { Report, Op: SOp } = require('../models');
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const allRows = await Report.findAll({ attributes: ['creditsUsed', 'createdAt'] });
    let usedTotal = 0, usedMonth = 0;
    for (const r of allRows) {
      const c = Number(r.creditsUsed || 0);
      usedTotal += c;
      if (r.createdAt && new Date(r.createdAt) >= startOfMonth) usedMonth += c;
    }

    if (!key) return res.json({ configured: false, usedTotal, usedMonth, remaining: null });

    let remaining = null, raw = null, error = null, limit = null, expiresAt = null;
    try {
      const { SERanking } = require('../services/seranking');
      const client = new SERanking(key);
      raw = await client.getBalance();
      // getBalance now normalises the /account/subscription response.
      remaining = raw && raw.remaining != null ? raw.remaining : null;
      limit = raw && raw.limit != null ? raw.limit : null;
      expiresAt = raw && raw.expiresAt ? raw.expiresAt : null;
    } catch (e) {
      // Balance is a nice-to-have; our self-tracked usage below is the reliable
      // figure, so a read failure is a soft note rather than a hard error.
      error = e.message;
    }
    res.json({ configured: true, remaining, limit, expiresAt, usedTotal, usedMonth, error });
  } catch (e) {
    res.json({ configured: false, remaining: null, usedTotal: 0, usedMonth: 0, error: e.message });
  }
});

/**
 * GET /api/admin/seranking-diagnose?domain=example.com — live diagnostic. Calls
 * the balance, domain overview, and backlink summary directly and returns the
 * RAW responses (or the exact error), so we can see whether the key works, the
 * account has credits, and which fields the API actually returns. This is how we
 * diagnose "all zeros" without guessing at field names.
 */
router.get('/seranking-diagnose', async (req, res) => {
  try {
    const settings = await Settings.findOne({ where: { singleton: 'settings' } });
    const key = settings && settings.getKey ? settings.getKey('seranking') : null;
    if (!key) return res.json({ configured: false, error: 'No SE Ranking API key configured.' });

    const domain = (req.query.domain || 'seranking.com').toString().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    const rawSource = (req.query.source || 'us').toString();
    const { normaliseSource } = require('../services/seRegions');
    const source = normaliseSource(rawSource, 'us');
    const { SERanking } = require('../services/seranking');
    const se = new SERanking(key);

    const out = { configured: true, domain, source, requestedSource: rawSource, keyPreview: `${key.slice(0, 4)}…${key.slice(-3)}`, steps: {} };

    const attempt = async (label, fn) => {
      try {
        const t0 = Date.now();
        const val = await fn();
        out.steps[label] = { ok: true, ms: Date.now() - t0, sample: JSON.stringify(val).slice(0, 1200) };
      } catch (e) {
        out.steps[label] = { ok: false, error: e.message, status: e.status || null, body: e.body ? JSON.stringify(e.body).slice(0, 600) : null };
      }
    };

    await attempt('balance', () => se.getBalance());
    await attempt('domain_overview', () => se.getDomainOverview(domain, source));
    await attempt('backlink_summary', () => se.getBacklinkSummary(domain, 'domain'));

    res.json(out);
  } catch (e) {
    res.json({ configured: false, error: e.message });
  }
});

/**
 * Demo / training mode. Switching it on mints a random token and exposes the
 * whole app at /demo-app/<token> filled with fabricated data, so agents can be
 * trained on the live interface without touching a real client record.
 * Regenerating the token instantly invalidates any link already shared.
 */
router.get('/demo-app', async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    res.json({
      enabled: !!(s && s.demoAppEnabled),
      token: (s && s.demoAppToken) || null,
      startedAt: (s && s.demoAppStartedAt) || null,
    });
  } catch (e) { next(e); }
});

router.put('/demo-app', async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    if (!s) return res.status(500).json({ error: 'Settings not initialised.' });
    const b = req.body || {};

    if (b.enabled !== undefined) {
      const turningOn = !!b.enabled && !s.demoAppEnabled;
      s.demoAppEnabled = !!b.enabled;
      // Mint a token the first time it is switched on, and stamp the start so
      // the admin screen can show how long the link has been live.
      if (s.demoAppEnabled && !s.demoAppToken) s.demoAppToken = require('crypto').randomBytes(24).toString('hex');
      if (turningOn) s.demoAppStartedAt = new Date();
      if (!s.demoAppEnabled) s.demoAppStartedAt = null;
    }
    if (b.regenerate) {
      s.demoAppToken = require('crypto').randomBytes(24).toString('hex');
      s.demoAppStartedAt = new Date();
    }
    await s.save();
    await AuditLog.create({
      userId: req.user.id, userName: req.user.name, action: 'demoApp.settings',
      target: s.demoAppEnabled ? 'enabled' : 'disabled', ip: req.ip,
    });
    res.json({ enabled: !!s.demoAppEnabled, token: s.demoAppToken, startedAt: s.demoAppStartedAt });
  } catch (e) { next(e); }
});

/**
 * Motivator TV admin: enable/disable the board, regenerate its access token,
 * and manage the announcement ticker.
 */
router.get('/tv', async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    res.json({
      enabled: !!(s && s.tvEnabled),
      token: (s && s.tvToken) || null,
      announcements: (s && Array.isArray(s.tvAnnouncements)) ? s.tvAnnouncements : [],
    });
  } catch (e) { next(e); }
});

router.put('/tv', async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    if (!s) return res.status(500).json({ error: 'Settings not initialised.' });
    const b = req.body || {};

    if (b.enabled !== undefined) {
      s.tvEnabled = !!b.enabled;
      // Mint a token the first time the board is switched on.
      if (s.tvEnabled && !s.tvToken) s.tvToken = require('crypto').randomBytes(24).toString('hex');
    }
    if (b.regenerate) s.tvToken = require('crypto').randomBytes(24).toString('hex');
    if (b.announcements !== undefined && Array.isArray(b.announcements)) {
      s.tvAnnouncements = b.announcements.map((a) => String(a || '').slice(0, 300)).filter(Boolean).slice(0, 20);
      s.changed('tvAnnouncements', true);
    }
    await s.save();
    await AuditLog.create({
      userId: req.user.id, userName: req.user.name, action: 'tv.settings',
      target: s.tvEnabled ? 'enabled' : 'disabled', ip: req.ip,
    });
    res.json({ enabled: !!s.tvEnabled, token: s.tvToken, announcements: s.tvAnnouncements || [] });
  } catch (e) { next(e); }
});

module.exports = router;

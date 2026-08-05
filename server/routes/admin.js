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

/** Remove logo or favicon. */
router.delete('/settings/:asset(logo|favicon)', async (req, res, next) => {
  try {
    const key = req.params.asset === 'logo' ? 'logoPath' : 'faviconPath';
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    if (s[key]) {
      const f = path.join(UPLOAD_DIR, path.basename(s[key]));
      if (fs.existsSync(f)) fs.unlinkSync(f);
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

    const rows = scoped.map((u) => {
      const t = u.targets || {};
      const currentTarget = (t.sales && t.sales.enabled) ? Number(t.sales.monthly || 0) : 0;
      const rec = byUser[u.id];
      return {
        userId: u.id, name: u.name, role: u.role, team: u.team, shift: u.shift,
        managerId: u.managerId, archived: !!u.archived,
        targetUsd: rec ? rec.targetUsd : currentTarget,
        achievedUsd: rec ? rec.achievedUsd : 0,
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
    const { name, email, password, role, phone, designation, team, shift, aliases, managerScopes, jobType, managerId, targets, birthday, joiningDate, maritalStatus, anniversary, canViewConverted } = req.body || {};
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
    });
    await AuditLog.create({ userId: req.user.id, userName: req.user.name, action: 'user.create', target: user.email, ip: req.ip });
    const out = user.toJSON(); delete out.passwordHash;
    res.status(201).json(out);
  } catch (e) { next(e); }
});

router.put('/users/:id', async (req, res, next) => {
  try {
    const { name, role, phone, designation, active, password, team, shift, aliases, managerScopes, jobType, managerId, targets, avatar, birthday, joiningDate, maritalStatus, anniversary, canViewConverted } = req.body || {};
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    // An admin locking themselves out is unrecoverable without DB access.
    if (user.id === req.user.id && (active === false || role === 'agent' || role === 'manager')) {
      return res.status(400).json({ error: 'You cannot deactivate or demote your own account.' });
    }

    if (name !== undefined) user.name = name;
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

router.delete('/users/:id', async (req, res, next) => {
  try {
    if (Number(req.params.id) === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account.' });
    }
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    // Soft delete: reports reference this agent and must keep working.
    user.active = false;
    await user.save();
    await AuditLog.create({ userId: req.user.id, userName: req.user.name, action: 'user.deactivate', target: user.email, ip: req.ip });
    res.json({ ok: true, message: 'Account deactivated. Their reports are preserved.' });
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
  const logs = await AuditLog.findAll({ order: [['createdAt', 'DESC']], limit: 100 });
  res.json(logs);
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

    let remaining = null, raw = null, error = null;
    try {
      const { SERanking } = require('../services/seranking');
      const client = new SERanking(key);
      raw = await client.getBalance();
      // Shape varies by plan — pick the first numeric that looks like a balance.
      const cand = raw && (raw.balance ?? raw.credits ?? raw.available ?? (raw.data && (raw.data.balance ?? raw.data.credits)));
      remaining = Number.isFinite(Number(cand)) ? Number(cand) : null;
    } catch (e) {
      error = e.message;
    }
    res.json({ configured: true, remaining, usedTotal, usedMonth, error });
  } catch (e) {
    res.json({ configured: false, remaining: null, usedTotal: 0, usedMonth: 0, error: e.message });
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

const router = require('express').Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { User, Report, Settings, AuditLog, sequelize, Op, defaultPricing } = require('../models');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { SERanking } = require('../services/seranking');

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

router.put('/settings', async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const body = req.body || {};

    const plain = ['companyName','companyShort','website','email','phone','address',
                   'fontFamily','reportValidDays','dailyReportLimit','cacheDays','defaultCountry'];
    for (const f of plain) if (body[f] !== undefined) s[f] = body[f];
    if (body.colors) { s.colors = { ...s.colors, ...body.colors }; s.changed('colors', true); }
    if (body.pricing) { s.pricing = body.pricing; s.changed('pricing', true); }

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

router.post('/users', async (req, res, next) => {
  try {
    const { name, email, password, role, phone, designation, team, shift, aliases } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const exists = await User.findOne({ where: { email: String(email).toLowerCase() } });
    if (exists) return res.status(409).json({ error: 'That email is already registered.' });

    const user = await User.create({
      name, email: String(email).toLowerCase(), passwordHash: await bcrypt.hash(password, 12),
      role: role === 'admin' ? 'admin' : 'agent', phone: phone || '', designation: designation || 'Sales Executive',
      team: ['Bhubaneswar', 'Kolkata'].includes(team) ? team : 'Bhubaneswar',
      shift: ['Morning', 'Night'].includes(shift) ? shift : 'Morning',
      aliases: Array.isArray(aliases) ? aliases : (aliases ? String(aliases).split(',').map((a) => a.trim()).filter(Boolean) : []),
    });
    await AuditLog.create({ userId: req.user.id, userName: req.user.name, action: 'user.create', target: user.email, ip: req.ip });
    const out = user.toJSON(); delete out.passwordHash;
    res.status(201).json(out);
  } catch (e) { next(e); }
});

router.put('/users/:id', async (req, res, next) => {
  try {
    const { name, role, phone, designation, active, password, team, shift, aliases } = req.body || {};
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    // An admin locking themselves out is unrecoverable without DB access.
    if (user.id === req.user.id && (active === false || role === 'agent')) {
      return res.status(400).json({ error: 'You cannot deactivate or demote your own account.' });
    }

    if (name !== undefined) user.name = name;
    if (role !== undefined) user.role = role === 'admin' ? 'admin' : 'agent';
    if (phone !== undefined) user.phone = phone;
    if (designation !== undefined) user.designation = designation;
    if (team !== undefined && ['Bhubaneswar', 'Kolkata'].includes(team)) user.team = team;
    if (shift !== undefined && ['Morning', 'Night'].includes(shift)) user.shift = shift;
    if (aliases !== undefined) user.aliases = Array.isArray(aliases) ? aliases : String(aliases).split(',').map((a) => a.trim()).filter(Boolean);
    if (active !== undefined) user.active = !!active;
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

module.exports = router;

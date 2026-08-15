/**
 * HR module API — mounted at /api/hr. Completely separate from the Site
 * Analysis / CRM routes. Access is HR-staff-or-admin only (see hrAuth).
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { Op, HrUser, HrBranch, HrDepartment, HrShift, HrHoliday, HrJobPost, HrCandidate, User, AuditLog, Settings } = require('../models');
const { signHr, requireHrAccess, requireHrAdmin, requireScheduler } = require('../middleware/hrAuth');
const imagekit = require('../services/imagekit');

const router = express.Router();

const USER_TYPES = ['hr', 'recruiter', 'manager', 'tl', 'senior', 'junior', 'trainee', 'intern', 'employee'];
// Roles that count as "HR staff" for edit permissions on locked profile
// sections (payroll, performance, identity). Everyone else is view-only there.
const HR_STAFF_TYPES = ['hr', 'recruiter'];

// Profile completion: the sections we score a profile against. Each present +
// non-empty section counts toward the percentage shown in the admin list.
function profileCompletion(hrUser) {
  const p = hrUser.profile || {};
  const filled = (obj, keys) => obj && keys.some((k) => obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '');
  const checks = [
    !!hrUser.avatar,                                             // photo
    filled(p.payroll, ['basic', 'hra', 'ta', 'da', 'other', 'pf', 'esi']),
    filled(p.bank, ['bankName', 'accountNumber', 'ifsc', 'accountType']),
    filled(p.personal, ['homeAddress', 'personalEmail', 'dob', 'maritalStatus']),
    Array.isArray(p.documents) && p.documents.length > 0,
    p.education && (filled(p.education.tenth, ['institution', 'year', 'percent']) || filled(p.education.twelfth, ['institution', 'year', 'percent']) || filled(p.education.graduation, ['institution', 'year', 'percent'])),
    p.employment && (p.employment.fresher === true || (Array.isArray(p.employment.records) && p.employment.records.length > 0)),
  ];
  const done = checks.filter(Boolean).length;
  return Math.round((done / checks.length) * 100);
}


// --- Auth -------------------------------------------------------------------

/**
 * POST /api/hr/auth/login — HR staff OR the shared admin. HR staff get an HR
 * token; the admin gets... their normal CRM admin token (so the same admin
 * account bridges both portals). CRM agents/managers are refused.
 */
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

    // 1) HR staff.
    const hr = await HrUser.findOne({ where: { email: String(email).toLowerCase().trim() } });
    if (hr) {
      if (!hr.active) return res.status(403).json({ error: 'This account is no longer active.' });
      const ok = await bcrypt.compare(password, hr.passwordHash);
      if (!ok) return res.status(401).json({ error: 'Incorrect email or password.' });
      return res.json({ token: signHr(hr), user: { ...hr.toJSON(), portal: 'hr', isAdmin: false } });
    }

    // 2) A CRM admin logging into HR. Reuse the CRM credentials, but ONLY admins
    //    are allowed through the HR door.
    const u = await User.findOne({ where: { email: String(email).toLowerCase().trim() } });
    if (!u) return res.status(401).json({ error: 'Incorrect email or password.' });
    const ok = await bcrypt.compare(password, u.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Incorrect email or password.' });
    if (u.role !== 'admin') return res.status(403).json({ error: 'The HR portal is only available to HR staff and admins.' });
    if (!u.active) return res.status(403).json({ error: 'This account is no longer active.' });

    // Sign a normal CRM admin token (same shape auth.js uses).
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ id: u.id, role: u.role, name: u.name }, process.env.JWT_SECRET || 'change-me-in-production', { expiresIn: '12h' });
    res.json({ token, user: { _id: u.id, id: u.id, name: u.name, email: u.email, role: 'admin', portal: 'hr', isAdmin: true } });
  } catch (e) {
    console.error('[hr] login error', e.message);
    res.status(500).json({ error: 'Something went wrong signing in.' });
  }
});

/** GET /api/hr/me — the signed-in HR actor (staff or admin), for the greeting. */
router.get('/me', requireHrAccess, (req, res) => {
  if (req.hrActor.kind === 'admin') {
    return res.json({ _id: req.adminUser.id, name: req.adminUser.name, type: 'admin', isAdmin: true });
  }
  res.json({ ...req.hrUser.toJSON(), isAdmin: false, completion: profileCompletion(req.hrUser) });
});

// --- Dashboard --------------------------------------------------------------

/** GET /api/hr/dashboard — minimal figures for the HR dashboard scaffold. */
router.get('/dashboard', requireHrAccess, async (req, res, next) => {
  try {
    const [staff, openJobs, candidates, onboarded] = await Promise.all([
      HrUser.count({ where: { active: true } }),
      HrJobPost.count({ where: { status: 'open' } }),
      HrCandidate.count(),
      HrCandidate.count({ where: { stage: 'onboarded' } }),
    ]);
    res.json({
      greetingName: req.hrActor.name,
      metrics: { staff, openJobs, candidates, onboarded },
    });
  } catch (e) { next(e); }
});

// --- ImageKit (admin only) --------------------------------------------------

/** GET /api/hr/imagekit — connection status + public config (no private key). */
router.get('/imagekit', requireHrAccess, async (req, res, next) => {
  try {
    const settings = await Settings.findOne({ where: { singleton: 'settings' } });
    const cfg = imagekit.getConfig(settings);
    res.json({
      configured: imagekit.isConfigured(settings),
      publicKey: cfg.publicKey || '',
      urlEndpoint: cfg.urlEndpoint || '',
      hasPrivateKey: !!cfg.privateKey,
    });
  } catch (e) { next(e); }
});

/** PUT /api/hr/imagekit — save keys (admin), then report connection status. */
router.put('/imagekit', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    const settings = await Settings.findOne({ where: { singleton: 'settings' } });
    const keys = { ...(settings.apiKeys || {}) };
    if (b.publicKey !== undefined) keys.imagekitPublic = String(b.publicKey).trim();
    if (b.urlEndpoint !== undefined) keys.imagekitEndpoint = String(b.urlEndpoint).trim();
    // Only overwrite the private key if a new (non-masked) value is supplied.
    if (b.privateKey !== undefined && b.privateKey && !String(b.privateKey).includes('•')) keys.imagekitPrivate = String(b.privateKey).trim();
    settings.apiKeys = keys; settings.changed('apiKeys', true);
    await settings.save();
    const fresh = await Settings.findOne({ where: { singleton: 'settings' } });
    const test = await imagekit.testConnection(fresh);
    res.json(test);
  } catch (e) { next(e); }
});

/** GET /api/hr/imagekit/auth — short-lived auth params for a browser upload. */
router.get('/imagekit/auth', requireHrAccess, async (req, res, next) => {
  try {
    const settings = await Settings.findOne({ where: { singleton: 'settings' } });
    if (!imagekit.isConfigured(settings)) return res.status(400).json({ error: 'ImageKit is not connected. Ask an admin to set it up.' });
    res.json(imagekit.getAuthParams(settings));
  } catch (e) { next(e); }
});

// --- Departments (admin only for writes) ------------------------------------

router.get('/departments', requireHrAccess, async (req, res, next) => {
  try { res.json((await HrDepartment.findAll({ order: [['name', 'ASC']] })).map((d) => d.toJSON())); }
  catch (e) { next(e); }
});

router.post('/departments', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const name = String((req.body && req.body.name) || '').trim();
    if (!name) return res.status(400).json({ error: 'Department name is required.' });
    const [row] = await HrDepartment.findOrCreate({ where: { name }, defaults: { name } });
    res.status(201).json(row.toJSON());
  } catch (e) { next(e); }
});

router.put('/departments/:id', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const row = await HrDepartment.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Department not found.' });
    if (req.body && req.body.name !== undefined) row.name = String(req.body.name).trim();
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

router.delete('/departments/:id', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const row = await HrDepartment.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Department not found.' });
    await row.destroy();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// --- Shifts (admin only for writes) -----------------------------------------

router.get('/shifts', requireHrAccess, async (req, res, next) => {
  try { res.json((await HrShift.findAll({ order: [['name', 'ASC']] })).map((s) => s.toJSON())); }
  catch (e) { next(e); }
});

router.post('/shifts', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!String(b.name || '').trim()) return res.status(400).json({ error: 'Shift name is required.' });
    const row = await HrShift.create({
      name: String(b.name).trim(),
      startTime: b.startTime || '', endTime: b.endTime || '',
      breakStart: b.breakStart || '', breakEnd: b.breakEnd || '',
    });
    res.status(201).json(row.toJSON());
  } catch (e) { next(e); }
});

router.put('/shifts/:id', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const row = await HrShift.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Shift not found.' });
    const b = req.body || {};
    ['name', 'startTime', 'endTime', 'breakStart', 'breakEnd'].forEach((k) => { if (b[k] !== undefined) row[k] = b[k]; });
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

router.delete('/shifts/:id', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const row = await HrShift.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Shift not found.' });
    await row.destroy();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// --- Holidays (admin only for writes; per-branch) ---------------------------

router.get('/holidays', requireHrAccess, async (req, res, next) => {
  try {
    const where = {};
    if (req.query.branch) where.branch = { [Op.in]: [req.query.branch, ''] };
    const rows = await HrHoliday.findAll({ where, order: [['date', 'ASC']] });
    res.json(rows.map((h) => h.toJSON()));
  } catch (e) { next(e); }
});

router.post('/holidays', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!String(b.name || '').trim() || !b.date) return res.status(400).json({ error: 'Holiday name and date are required.' });
    const row = await HrHoliday.create({ name: String(b.name).trim(), date: b.date, branch: b.branch || '' });
    res.status(201).json(row.toJSON());
  } catch (e) { next(e); }
});

router.put('/holidays/:id', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const row = await HrHoliday.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Holiday not found.' });
    const b = req.body || {};
    ['name', 'date', 'branch'].forEach((k) => { if (b[k] !== undefined) row[k] = b[k]; });
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

router.delete('/holidays/:id', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const row = await HrHoliday.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Holiday not found.' });
    await row.destroy();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// --- Branches (admin only) --------------------------------------------------

router.get('/branches', requireHrAccess, async (req, res, next) => {
  try {
    const rows = await HrBranch.findAll({ order: [['name', 'ASC']] });
    res.json(rows.map((b) => b.toJSON()));
  } catch (e) { next(e); }
});

router.post('/branches', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const name = String((req.body && req.body.name) || '').trim();
    if (!name) return res.status(400).json({ error: 'Branch name is required.' });
    const [row] = await HrBranch.findOrCreate({ where: { name }, defaults: { name } });
    res.status(201).json(row.toJSON());
  } catch (e) { next(e); }
});

router.put('/branches/:id', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const row = await HrBranch.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Branch not found.' });
    if (req.body && req.body.name !== undefined) row.name = String(req.body.name).trim();
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

router.delete('/branches/:id', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const row = await HrBranch.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Branch not found.' });
    await row.destroy();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// --- HR users (admin only) --------------------------------------------------

/** Reporting-authority options: existing HR staff + CRM admins. */
router.get('/reporting-options', requireHrAccess, async (req, res, next) => {
  try {
    const hr = await HrUser.findAll({ where: { active: true }, attributes: ['id', 'name', 'type', 'designation'], order: [['name', 'ASC']] });
    const admins = await User.findAll({ where: { role: 'admin', active: true }, attributes: ['id', 'name'], order: [['name', 'ASC']] });
    res.json({
      hr: hr.map((h) => ({ id: h.id, name: h.name, type: h.type, designation: h.designation })),
      admins: admins.map((a) => ({ id: a.id, name: a.name })),
    });
  } catch (e) { next(e); }
});

router.get('/users', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const rows = await HrUser.findAll({ order: [['createdAt', 'DESC']] });
    res.json(rows.map((u) => ({ ...u.toJSON(), completion: profileCompletion(u) })));
  } catch (e) { next(e); }
});

/**
 * GET /api/hr/employees — directory of all HR staff with completion %. Powers
 * the top-level "Employee" menu. Available to any HR user (read-only list).
 */
router.get('/employees', requireHrAccess, async (req, res, next) => {
  try {
    const rows = await HrUser.findAll({ order: [['name', 'ASC']] });
    res.json(rows.map((u) => ({
      _id: u.id, id: u.id, name: u.name, employeeId: u.employeeId, email: u.email,
      type: u.type, designation: u.designation, branch: u.branch, department: u.department,
      avatar: u.avatar, active: u.active, completion: profileCompletion(u),
    })));
  } catch (e) { next(e); }
});

/**
 * GET /api/hr/profile/:id — full profile. HR staff may read their own; an admin
 * may read anyone's.
 */
router.get('/profile/:id', requireHrAccess, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const isSelf = req.hrUser && req.hrUser.id === id;
    const canEditLocked = req.isHrAdmin || (req.hrUser && HR_STAFF_TYPES.includes(req.hrUser.type));
    if (!canEditLocked && !isSelf) {
      return res.status(403).json({ error: 'You can only view your own profile.' });
    }
    const row = await HrUser.findByPk(id);
    if (!row) return res.status(404).json({ error: 'Profile not found.' });
    const shift = row.shiftId ? await HrShift.findByPk(row.shiftId) : null;
    res.json({ ...row.toJSON(), completion: profileCompletion(row), canEditLocked, shift: shift ? shift.toJSON() : null });
  } catch (e) { next(e); }
});

/**
 * PUT /api/hr/profile/:id — update the profile. Permission model:
 *   - Employee (self): may edit personal, documents, education, employment,
 *     bank, and their avatar/phone. Payroll & performance are view-only.
 *   - HR staff / Admin: may edit everything, including payroll, performance,
 *     and the core identity fields (via /users for identity).
 */
router.put('/profile/:id', requireHrAccess, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const isSelf = req.hrUser && req.hrUser.id === id;
    const canEditLocked = req.isHrAdmin || (req.hrUser && HR_STAFF_TYPES.includes(req.hrUser.type));
    if (!canEditLocked && !isSelf) {
      return res.status(403).json({ error: 'You can only edit your own profile.' });
    }
    const row = await HrUser.findByPk(id);
    if (!row) return res.status(404).json({ error: 'Profile not found.' });
    const b = req.body || {};

    if (b.avatar !== undefined) row.avatar = b.avatar;
    if (b.phone !== undefined) row.phone = b.phone;

    if (b.profile !== undefined && b.profile && typeof b.profile === 'object') {
      const current = row.profile || {};
      const incoming = b.profile;
      // Sections anyone (incl. the employee) may edit about themselves.
      const openSections = ['personal', 'documents', 'bank', 'education', 'employment'];
      // Sections only HR/Admin may edit.
      const lockedSections = ['payroll', 'performance'];
      const merged = { ...current };
      openSections.forEach((s) => { if (incoming[s] !== undefined) merged[s] = incoming[s]; });
      lockedSections.forEach((s) => {
        if (incoming[s] !== undefined) {
          if (canEditLocked) merged[s] = incoming[s];
          // else silently ignore — employee can't change payroll/performance.
        }
      });
      row.profile = merged; row.changed('profile', true);
    }
    await row.save();
    res.json({ ...row.toJSON(), completion: profileCompletion(row), canEditLocked });
  } catch (e) { next(e); }
});

/** POST /api/hr/profile/:id/timeline — HR/Admin adds a note to the record. */
router.post('/profile/:id/timeline', requireHrAccess, async (req, res, next) => {
  try {
    const canEdit = req.isHrAdmin || (req.hrUser && HR_STAFF_TYPES.includes(req.hrUser.type));
    if (!canEdit) return res.status(403).json({ error: 'Only HR or admin can add timeline notes.' });
    const row = await HrUser.findByPk(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Profile not found.' });
    const text = String((req.body && req.body.text) || '').trim();
    if (!text) return res.status(400).json({ error: 'Note text is required.' });
    const tl = Array.isArray(row.timeline) ? row.timeline : [];
    tl.unshift({ at: new Date().toISOString(), kind: 'note', text, by: req.hrActor.name });
    row.timeline = tl; row.changed('timeline', true);
    await row.save();
    res.json({ ok: true, timeline: row.timeline });
  } catch (e) { next(e); }
});

router.post('/users', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const email = String(b.email || '').toLowerCase().trim();
    const password = String(b.password || '');
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are all required.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    const type = USER_TYPES.includes(b.type) ? b.type : 'employee';

    const exists = await HrUser.findOne({ where: { email } });
    if (exists) return res.status(409).json({ error: 'An HR user with that email already exists.' });

    const passwordHash = await bcrypt.hash(password, 10);
    const row = await HrUser.create({
      name, email, passwordHash, type,
      employeeId: b.employeeId || null,
      phone: b.phone || '+91 ',
      designation: b.designation || '',
      branch: b.branch || 'Bhubaneswar',
      department: b.department || '',
      joiningDate: b.joiningDate || null,
      shiftId: b.shiftId ? Number(b.shiftId) : null,
      branchIncharge: !!b.branchIncharge,
      avatar: b.avatar || null,
      reportsToId: b.reportsToId ? Number(b.reportsToId) : null,
      reportsToAdminId: b.reportsToAdminId ? Number(b.reportsToAdminId) : null,
      targets: type === 'recruiter'
        ? { dailyInterviews: Number((b.targets && b.targets.dailyInterviews) || 0), monthlyOnboarding: Number((b.targets && b.targets.monthlyOnboarding) || 0) }
        : { dailyInterviews: 0, monthlyOnboarding: 0 },
      timeline: [{ at: new Date().toISOString(), kind: 'created', text: `Employee record created by ${req.hrActor.name}`, by: req.hrActor.name }],
    });
    await AuditLog.create({ userId: req.hrActor.id, userName: req.hrActor.name, action: 'hr.user.create', target: name, ip: req.ip }).catch(() => {});
    res.status(201).json(row.toJSON());
  } catch (e) { next(e); }
});

router.put('/users/:id', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const row = await HrUser.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'HR user not found.' });
    const b = req.body || {};
    if (b.name !== undefined) row.name = String(b.name).trim();
    if (b.employeeId !== undefined) row.employeeId = b.employeeId || null;
    if (b.phone !== undefined) row.phone = b.phone;
    if (b.designation !== undefined) row.designation = b.designation;
    if (b.type !== undefined && USER_TYPES.includes(b.type)) row.type = b.type;
    if (b.branch !== undefined) row.branch = b.branch;
    if (b.department !== undefined) row.department = b.department;
    if (b.joiningDate !== undefined) row.joiningDate = b.joiningDate || null;
    if (b.shiftId !== undefined) row.shiftId = b.shiftId ? Number(b.shiftId) : null;
    if (b.branchIncharge !== undefined) row.branchIncharge = !!b.branchIncharge;
    if (b.reportsToId !== undefined) row.reportsToId = b.reportsToId ? Number(b.reportsToId) : null;
    if (b.reportsToAdminId !== undefined) row.reportsToAdminId = b.reportsToAdminId ? Number(b.reportsToAdminId) : null;
    if (b.active !== undefined) row.active = !!b.active;
    if (b.avatar !== undefined) row.avatar = b.avatar;
    if (b.targets !== undefined) {
      row.targets = { dailyInterviews: Number(b.targets.dailyInterviews || 0), monthlyOnboarding: Number(b.targets.monthlyOnboarding || 0) };
    }
    if (b.password) {
      if (String(b.password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      row.passwordHash = await bcrypt.hash(String(b.password), 10);
    }
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

// --- Recruitment: job-post builder --------------------------------------

const crypto = require('crypto');
const DEFAULT_STAGES = [
  { id: 'sourced', label: 'Sourced', color: '#94A3B8' },
  { id: 'applied', label: 'Applied', color: '#2563EB' },
  { id: 'contacted', label: 'Contacted', color: '#7C3AED' },
  { id: 'interview', label: 'Interview', color: '#F5A524' },
  { id: 'offered', label: 'Offered', color: '#0EA5E9' },
  { id: 'hired', label: 'Hired', color: '#16A34A' },
  { id: 'rejected', label: 'Rejected', color: '#DC2626' },
];
const DEFAULT_FORM_FIELDS = {
  photo: 'off', currentLocation: 'mandatory',
  resume: 'mandatory', workExperience: 'optional', educationDetails: 'optional',
  noticePeriod: 'optional', ctc: 'optional', portfolio: 'off', gender: 'off',
};

async function anthropicKey() {
  const s = await Settings.findOne({ where: { singleton: 'settings' } });
  const key = s && s.getKey ? s.getKey('anthropic') : null;
  if (!key) { const e = new Error('AI is not configured. Add an Anthropic API key in the CRM admin settings.'); e.status = 400; throw e; }
  return key;
}

router.get('/job-posts', requireHrAccess, async (req, res, next) => {
  try {
    const rows = await HrJobPost.findAll({ order: [['createdAt', 'DESC']] });
    // Applied-candidate counts per job (single grouped query).
    const counts = await HrCandidate.findAll({
      attributes: ['jobPostId', [HrCandidate.sequelize.fn('COUNT', HrCandidate.sequelize.col('id')), 'n']],
      group: ['jobPostId'], raw: true,
    });
    const byJob = {}; counts.forEach((c) => { byJob[c.jobPostId] = Number(c.n); });
    res.json(rows.map((r) => ({ ...r.toJSON(), applicantCount: byJob[r.id] || 0 })));
  } catch (e) { next(e); }
});

router.get('/job-posts/:id', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrJobPost.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Job post not found.' });
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

// Create or update a draft (the builder auto-saves as the HR moves through steps).
router.post('/job-posts', requireHrAccess, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.title || !String(b.title).trim()) return res.status(400).json({ error: 'Job title is required.' });
    const fields = pickJobFields(b);
    fields.createdById = req.hrActor.id;
    fields.createdByName = req.hrActor.name;
    if (!fields.stages || !fields.stages.length) fields.stages = DEFAULT_STAGES;
    if (!fields.formFields || !Object.keys(fields.formFields).length) fields.formFields = DEFAULT_FORM_FIELDS;
    const row = await HrJobPost.create(fields);
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

router.put('/job-posts/:id', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrJobPost.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Job post not found.' });
    const fields = pickJobFields(req.body || {});
    Object.assign(row, fields);
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

// Publish: mint a public token (if not already) and flip status to published.
router.post('/job-posts/:id/publish', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrJobPost.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Job post not found.' });
    if (!row.publicToken) row.publicToken = crypto.randomBytes(12).toString('hex');
    row.status = 'published';
    row.publishedAt = new Date();
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

router.post('/job-posts/:id/close', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrJobPost.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Job post not found.' });
    row.status = 'closed'; await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

// Toggle a published job between Live and Paused (paused hides the public form
// but keeps the post and its candidates).
router.post('/job-posts/:id/pause', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrJobPost.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Job post not found.' });
    if (row.status === 'paused') { row.status = 'published'; if (!row.publishedAt) row.publishedAt = new Date(); }
    else if (row.status === 'published') { row.status = 'paused'; }
    else return res.status(400).json({ error: 'Only a published job can be paused.' });
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

router.delete('/job-posts/:id', requireHrAccess, async (req, res, next) => {
  try {
    if (!req.isHrAdmin) return res.status(403).json({ error: 'Only an admin can delete a job post.' });
    const row = await HrJobPost.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Job post not found.' });
    await row.destroy();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// --- AI helpers for the builder ---

router.post('/job-posts/ai/rewrite-jd', requireHrAccess, async (req, res, next) => {
  try {
    const key = await anthropicKey();
    const { rewriteJobDescription } = require('../services/hrRecruitAI');
    const html = await rewriteJobDescription(key, {
      title: req.body.title, department: req.body.department,
      draft: req.body.description, workMode: req.body.workMode,
    });
    res.json({ description: html });
  } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
});

router.post('/job-posts/ai/suggest-skills', requireHrAccess, async (req, res, next) => {
  try {
    const key = await anthropicKey();
    const { suggestSkills } = require('../services/hrRecruitAI');
    const skills = await suggestSkills(key, { title: req.body.title, description: req.body.description });
    res.json({ skills });
  } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
});

// Parse an uploaded JD. Accepts either extracted `text` OR a `base64` file
// (PDF/DOCX/txt) which we extract server-side — no browser CDN modules needed.
router.post('/job-posts/ai/parse-jd', requireHrAccess, async (req, res, next) => {
  try {
    const key = await anthropicKey();
    const { parseUploadedJD, extractFileText } = require('../services/hrRecruitAI');
    let text = req.body.text;
    if ((!text || String(text).trim().length < 30) && req.body.base64) {
      try { text = await extractFileText({ base64: req.body.base64, fileName: req.body.fileName }); }
      catch (ex) { return res.status(400).json({ error: 'Could not read that file. Try a text-based PDF or DOCX.' }); }
    }
    if (!text || String(text).trim().length < 30) {
      return res.status(400).json({ error: 'Could not read enough text from that file. Try a text-based PDF or DOCX.' });
    }
    const parsed = await parseUploadedJD(key, { text });
    res.json(parsed);
  } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
});

// Whitelist of job-post fields the client may set (prevents mass-assignment).
function pickJobFields(b) {
  const out = {};
  const str = ['title', 'branch', 'description', 'department', 'workMode', 'salaryPeriod',
    'salaryCurrency', 'experienceType', 'employmentType', 'employmentLevel', 'education', 'status'];
  const num = ['salaryMin', 'salaryMax', 'expMin', 'expMax', 'openings'];
  const json = ['locations', 'skills', 'formFields', 'questions', 'stages'];
  for (const k of str) if (b[k] !== undefined) out[k] = String(b[k]).slice(0, 20000);
  for (const k of num) if (b[k] !== undefined && b[k] !== '' && b[k] !== null) out[k] = Number(b[k]);
  for (const k of json) if (b[k] !== undefined) out[k] = b[k];
  if (b.hideSalary !== undefined) out.hideSalary = !!b.hideSalary;
  // Never let the client set status to published via a plain save.
  if (out.status && !['draft', 'closed'].includes(out.status)) delete out.status;
  return out;
}

router.get('/candidates', requireHrAccess, async (req, res, next) => {
  try {
    const where = {};
    if (req.query.stage) where.stage = String(req.query.stage);
    if (req.query.jobPostId) where.jobPostId = Number(req.query.jobPostId);
    let rows = await HrCandidate.findAll({ where, order: [['createdAt', 'DESC']] });
    // Keyword search across name, email, skills and resume text (forward-only:
    // resumeText is populated for candidates added after this feature shipped).
    const q = String(req.query.q || '').toLowerCase().trim();
    if (q) {
      rows = rows.filter((r) => {
        const a = r.answers || {};
        const hay = `${r.name} ${r.email} ${(a.skills || []).join(' ')} ${r.resumeText || ''}`.toLowerCase();
        return hay.includes(q);
      });
    }
    const tag = String(req.query.tag || '').toLowerCase().trim();
    if (tag) rows = rows.filter((r) => (r.tags || []).some((t) => String(t).toLowerCase() === tag));
    // Strip the big resumeText from list payloads.
    res.json(rows.map((r) => { const o = r.toJSON(); delete o.resumeText; return o; }));
  } catch (e) { next(e); }
});

// HR uploads a candidate's resume/photo to ImageKit under HRMS/<Job>/Resumes.
router.post('/candidates/upload', requireHrAccess, async (req, res, next) => {
  try {
    const { base64, fileName, kind, jobPostId } = req.body || {};
    if (!base64) return res.status(400).json({ error: 'No file provided.' });
    let jobName = 'General';
    if (jobPostId) { const j = await HrJobPost.findByPk(jobPostId); if (j) jobName = j.title; }
    const { safeFolder } = require('./careers');
    const imagekit = require('../services/imagekit');
    const sub = kind === 'photo' ? 'Photos' : 'Resumes';
    const out = await imagekit.uploadFile({ base64, fileName: fileName || 'resume', folder: `HRMS/${safeFolder(jobName)}/${sub}` });
    // For resumes, also extract text so it can be stored for keyword search.
    let text = '';
    if (sub === 'Resumes') { try { const { extractFileText } = require('../services/hrRecruitAI'); text = await extractFileText({ base64, fileName: fileName || 'resume' }); } catch { /* non-fatal */ } }
    res.json({ url: out.url, name: out.name, text: text ? text.slice(0, 50000) : '' });
  } catch (e) {
    if (/not configured/i.test(e.message)) return res.status(400).json({ error: 'ImageKit is not configured. Add ImageKit keys in admin settings.' });
    next(e);
  }
});

// Check for existing candidates with the same email or phone (duplicate warning).
router.get('/candidates/check-duplicate', requireHrAccess, async (req, res, next) => {
  try {
    const email = String(req.query.email || '').toLowerCase().trim();
    const phone = String(req.query.phone || '').replace(/[^0-9]/g, '');
    if (!email && !phone) return res.json({ duplicates: [] });
    const rows = await HrCandidate.findAll({ order: [['createdAt', 'DESC']], limit: 200 });
    const dups = rows.filter((r) => {
      const re = String(r.email || '').toLowerCase().trim();
      const rp = String(r.phone || '').replace(/[^0-9]/g, '');
      return (email && re && re === email) || (phone && rp && rp === phone);
    }).map((r) => ({ id: r.id, name: r.name, email: r.email, phone: r.phone, jobPostId: r.jobPostId, stage: r.stage }));
    res.json({ duplicates: dups });
  } catch (e) { next(e); }
});

// HR manually adds a candidate to a job (full application data).
router.post('/candidates', requireHrAccess, async (req, res, next) => {
  try {
    const b = req.body || {};
    const name = b.name || `${(b.firstName || '').trim()} ${(b.lastName || '').trim()}`.trim();
    if (!name) return res.status(400).json({ error: 'Candidate name is required.' });
    const job = b.jobPostId ? await HrJobPost.findByPk(b.jobPostId) : null;
    const firstStage = (job && job.stages && job.stages[0] && job.stages[0].id) || 'applied';
    const now = new Date().toISOString();
    const row = await HrCandidate.create({
      name,
      email: String(b.email || '').slice(0, 160),
      phone: String(b.phone || '').slice(0, 40),
      jobPostId: b.jobPostId || null,
      stage: b.stage || firstStage,
      recruiterId: req.hrActor.id,
      recruiterName: req.hrActor.name || '',
      resumeUrl: String(b.resumeUrl || '').slice(0, 400),
      resumeText: String(b.resumeText || '').slice(0, 50000),
      tags: Array.isArray(b.tags) ? b.tags.slice(0, 20).map((t) => String(t).slice(0, 40)) : [],
      currentLocation: String(b.currentLocation || '').slice(0, 160),
      answers: (b.answers && typeof b.answers === 'object') ? b.answers : {},
      source: 'manual',
      timeline: [
        { id: `t${Date.now()}`, type: 'assigned', text: `${req.hrActor.name} assigned as the recruiter.`, by: req.hrActor.name, at: now },
        { id: `t${Date.now() + 1}`, type: 'imported', text: `Added by ${req.hrActor.name}${job ? ` to ${job.title}` : ''}.`, by: req.hrActor.name, at: now },
      ],
    });
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

// Parse an uploaded resume. Accepts extracted `text` OR a `base64` file.
router.post('/candidates/ai/parse-resume', requireHrAccess, async (req, res, next) => {
  try {
    const key = await anthropicKey();
    const { parseResume, extractFileText } = require('../services/hrRecruitAI');
    let text = req.body.text;
    if ((!text || String(text).trim().length < 30) && req.body.base64) {
      try { text = await extractFileText({ base64: req.body.base64, fileName: req.body.fileName }); }
      catch (ex) { return res.status(400).json({ error: 'Could not read that file. Try a text-based PDF or DOCX.' }); }
    }
    if (!text || String(text).trim().length < 30) {
      return res.status(400).json({ error: 'Could not read enough text from that file. Try a text-based PDF or DOCX.' });
    }
    const parsed = await parseResume(key, { text });
    res.json({ ...parsed, _text: String(text).slice(0, 50000) });
  } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
});

// Edit core candidate fields.
router.patch('/candidates/:id', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    const b = req.body || {};
    if (b.name !== undefined) row.name = String(b.name).slice(0, 120);
    if (b.email !== undefined) row.email = String(b.email).slice(0, 160);
    if (b.phone !== undefined) row.phone = String(b.phone).slice(0, 40);
    if (b.jobPostId !== undefined) row.jobPostId = b.jobPostId || null;
    if (b.currentLocation !== undefined) row.currentLocation = String(b.currentLocation).slice(0, 160);
    if (b.rating !== undefined) row.rating = Math.max(0, Math.min(5, Number(b.rating) || 0));
    if (b.tags !== undefined && Array.isArray(b.tags)) { row.tags = b.tags.slice(0, 20).map((t) => String(t).slice(0, 40)); row.changed('tags', true); }
    if (b.answers && typeof b.answers === 'object') { row.answers = { ...(row.answers || {}), ...b.answers }; row.changed('answers', true); }
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

// Full candidate detail (with job for stages/questions context).
router.get('/candidates/:id', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    const job = row.jobPostId ? await HrJobPost.findByPk(row.jobPostId) : null;
    res.json({ ...row.toJSON(), job: job ? job.toJSON() : null });
  } catch (e) { next(e); }
});

const pushTimeline = (row, entry) => {
  const t = Array.isArray(row.timeline) ? row.timeline.slice() : [];
  t.unshift({ id: `t${Date.now()}`, at: new Date().toISOString(), ...entry });
  row.timeline = t; row.changed('timeline', true);
};

// Move a candidate between hiring-flow stages (logs to timeline).
router.patch('/candidates/:id/stage', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    const from = row.stage;
    row.stage = String(req.body.stage || 'applied');
    row.rejected = false;
    let label = row.stage;
    if (row.jobPostId) { const j = await HrJobPost.findByPk(row.jobPostId); const st = (j && j.stages || []).find((s) => s.id === row.stage); if (st) label = st.label; }
    pushTimeline(row, { type: 'stage', text: `Moved to ${label}.`, by: req.hrActor.name });
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

// Reject a candidate.
router.post('/candidates/:id/reject', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    row.rejected = true; row.stage = 'rejected';
    row.rejectionReason = String(req.body.reason || '').slice(0, 300);
    pushTimeline(row, { type: 'reject', text: `Rejected by ${req.hrActor.name}${req.body.reason ? ` — ${String(req.body.reason).slice(0, 200)}` : ''}.`, by: req.hrActor.name });
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

// Edit an existing comment (only the author, or an admin).
router.patch('/candidates/:id/comments/:commentId', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    const list = Array.isArray(row.comments) ? row.comments.slice() : [];
    const idx = list.findIndex((c) => c.id === req.params.commentId);
    if (idx < 0) return res.status(404).json({ error: 'Comment not found.' });
    if (list[idx].byId !== req.hrActor.id && !req.isHrAdmin) return res.status(403).json({ error: 'You can only edit your own comment.' });
    if (!req.body.text || !String(req.body.text).trim()) return res.status(400).json({ error: 'Comment cannot be empty.' });
    list[idx] = { ...list[idx], text: String(req.body.text).slice(0, 4000), edited: true, editedAt: new Date().toISOString() };
    row.comments = list; row.changed('comments', true);
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

// Add a comment / note.
router.post('/candidates/:id/comments', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    if (!req.body.text || !String(req.body.text).trim()) return res.status(400).json({ error: 'Comment cannot be empty.' });
    const list = Array.isArray(row.comments) ? row.comments.slice() : [];
    list.unshift({ id: `c${Date.now()}`, by: req.hrActor.name, byId: req.hrActor.id, text: String(req.body.text).slice(0, 4000), at: new Date().toISOString() });
    row.comments = list; row.changed('comments', true);
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

// Submit feedback (any HR / senior can add their own).
router.post('/candidates/:id/feedback', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    const b = req.body || {};
    const entry = {
      id: `f${Date.now()}`, by: req.hrActor.name, byId: req.hrActor.id, at: new Date().toISOString(),
      skills: Array.isArray(b.skills) ? b.skills.map((s) => ({ name: String(s.name || '').slice(0, 60), rating: Math.max(0, Math.min(5, Number(s.rating) || 0)) })) : [],
      verdict: ['definitely', 'yes', 'no', 'not_sure'].includes(b.verdict) ? b.verdict : 'not_sure',
      note: String(b.note || '').slice(0, 4000),
      // Optional interview/panel context.
      interviewId: b.interviewId || null,
      round: b.round || '',
      roundLabel: b.roundLabel || '',
    };
    const list = Array.isArray(row.feedback) ? row.feedback.slice() : [];
    list.unshift(entry);
    row.feedback = list; row.changed('feedback', true);
    // Mark this panelist as having submitted for the interview.
    if (b.interviewId) {
      const ivs = (row.interviews || []).map((iv) => {
        if (iv.id !== b.interviewId) return iv;
        const fbp = { ...(iv.feedbackByPanelist || {}) }; fbp[req.hrActor.id] = true;
        return { ...iv, feedbackByPanelist: fbp };
      });
      row.interviews = ivs; row.changed('interviews', true);
    }
    pushTimeline(row, { type: 'feedback', text: `${req.hrActor.name} submitted feedback${entry.roundLabel ? ` for ${entry.roundLabel}` : ''} (${entry.verdict.replace('_', ' ')}).`, by: req.hrActor.name });
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

// A panelist's own interview assignments, grouped by job. Any HR user (incl.
// plain employees) can see the interviews they've been assigned to.
router.get('/my-interviews', requireHrAccess, async (req, res, next) => {
  try {
    if (req.hrActor.kind !== 'hr') return res.json({ jobs: [] }); // admins don't sit on panels
    const myId = req.hrActor.id;
    const rows = await HrCandidate.findAll({ order: [['updatedAt', 'DESC']] });
    const jobsById = {};
    for (const r of rows) {
      const mine = (r.interviews || []).filter((iv) => (iv.panelists || []).some((p) => p.id === myId));
      if (!mine.length) continue;
      const job = r.jobPostId ? await HrJobPost.findByPk(r.jobPostId) : null;
      const jkey = r.jobPostId || 'none';
      if (!jobsById[jkey]) jobsById[jkey] = { jobId: r.jobPostId, jobTitle: job ? job.title : 'General', candidates: [] };
      mine.forEach((iv) => {
        jobsById[jkey].candidates.push({
          candidateId: r.id, name: r.name, email: r.email, stage: r.stage,
          interviewId: iv.id, at: iv.at, mode: iv.mode, round: iv.round, roundLabel: iv.roundLabel,
          meetLink: iv.meetLink, notes: iv.notes,
          submitted: !!(iv.feedbackByPanelist || {})[myId],
        });
      });
    }
    res.json({ jobs: Object.values(jobsById) });
  } catch (e) { next(e); }
});

// AI Recruiter — screen the candidate against the job requirements.
router.post('/candidates/:id/ai-screen', requireHrAccess, async (req, res, next) => {
  try {
    const key = await anthropicKey();
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    const job = row.jobPostId ? await HrJobPost.findByPk(row.jobPostId) : null;
    const { screenCandidate } = require('../services/hrRecruitAI');
    const result = await screenCandidate(key, { candidate: row.toJSON(), job: job ? job.toJSON() : null });
    row.aiSummary = result; row.changed('aiSummary', true);
    await row.save();
    res.json(result);
  } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
});

// ---- Activities (tasks & calls) ----
router.post('/candidates/:id/activities', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    const b = req.body || {};
    const act = {
      id: `act${Date.now()}`, kind: b.kind === 'call' ? 'call' : 'task', mode: b.mode === 'done' ? 'done' : 'scheduled',
      title: String(b.title || '').slice(0, 200), agenda: String(b.agenda || '').slice(0, 200),
      date: b.date || '', time: b.time || '', description: String(b.description || b.note || '').slice(0, 2000),
      priority: ['High', 'Medium', 'Low'].includes(b.priority) ? b.priority : 'Medium',
      assignedToId: b.assignedToId || null, assignedToName: String(b.assignedToName || '').slice(0, 120),
      reminderOn: !!b.reminderOn, done: b.mode === 'done',
      by: req.hrActor.name, at: new Date().toISOString(),
    };
    const list = Array.isArray(row.activities) ? row.activities.slice() : [];
    list.unshift(act);
    row.activities = list; row.changed('activities', true);
    const label = act.kind === 'call' ? (act.agenda || 'Call') : (act.title || 'Task');
    pushTimeline(row, { type: act.kind, text: `${act.mode === 'done' ? 'Logged' : 'Scheduled'} ${act.kind}: ${label}${act.assignedToName ? ` (→ ${act.assignedToName})` : ''}.`, by: req.hrActor.name });
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

router.patch('/candidates/:id/activities/:actId', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    const list = (row.activities || []).map((a) => a.id === req.params.actId ? { ...a, ...req.body, id: a.id } : a);
    row.activities = list; row.changed('activities', true);
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

router.delete('/candidates/:id/activities/:actId', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    row.activities = (row.activities || []).filter((a) => a.id !== req.params.actId); row.changed('activities', true);
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

// ---- Attachments ----
router.post('/candidates/:id/attachments', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    const { base64, fileName } = req.body || {};
    if (!base64) return res.status(400).json({ error: 'No file provided.' });
    const { safeFolder } = require('./careers');
    const imagekit = require('../services/imagekit');
    const job = row.jobPostId ? await HrJobPost.findByPk(row.jobPostId) : null;
    const out = await imagekit.uploadFile({ base64, fileName: fileName || 'file', folder: `HRMS/${safeFolder(job ? job.title : 'General')}/Attachments` });
    const list = Array.isArray(row.attachments) ? row.attachments.slice() : [];
    list.unshift({ id: `at${Date.now()}`, name: out.name || fileName, url: out.url, at: new Date().toISOString(), by: req.hrActor.name });
    row.attachments = list; row.changed('attachments', true);
    pushTimeline(row, { type: 'attachment', text: `${req.hrActor.name} uploaded an attachment: ${out.name || fileName}.`, by: req.hrActor.name });
    await row.save();
    res.json(row.toJSON());
  } catch (e) {
    if (/not configured/i.test(e.message)) return res.status(400).json({ error: 'ImageKit is not configured. Add ImageKit keys in admin settings.' });
    next(e);
  }
});

router.delete('/candidates/:id/attachments/:attId', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    row.attachments = (row.attachments || []).filter((a) => a.id !== req.params.attId); row.changed('attachments', true);
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

// ---- Delete candidate (admin only) ----
router.delete('/candidates/:id', requireHrAccess, async (req, res, next) => {
  try {
    if (!req.isHrAdmin) return res.status(403).json({ error: 'Only an admin can delete a candidate.' });
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    await row.destroy();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- Rejection reasons ----
router.get('/rejection-reasons', requireHrAccess, async (req, res, next) => {
  try { const s = await Settings.findOne({ where: { singleton: 'settings' } }); res.json({ reasons: s.hrRejectionReasons || [] }); }
  catch (e) { next(e); }
});
router.post('/rejection-reasons', requireHrAccess, async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const reason = String(req.body.reason || '').trim().slice(0, 120);
    if (!reason) return res.status(400).json({ error: 'Reason cannot be empty.' });
    const list = Array.isArray(s.hrRejectionReasons) ? s.hrRejectionReasons.slice() : [];
    if (!list.includes(reason)) list.push(reason);
    s.hrRejectionReasons = list; s.changed('hrRejectionReasons', true); await s.save();
    res.json({ reasons: list });
  } catch (e) { next(e); }
});

// ---- HR email templates ----
router.get('/email-templates', requireHrAccess, async (req, res, next) => {
  try { const s = await Settings.findOne({ where: { singleton: 'settings' } }); res.json({ templates: s.hrEmailTemplates || [] }); }
  catch (e) { next(e); }
});
router.post('/email-templates', requireHrAccess, async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const list = Array.isArray(s.hrEmailTemplates) ? s.hrEmailTemplates.slice() : [];
    const b = req.body || {};
    if (b.id) {
      const idx = list.findIndex((t) => t.id === b.id);
      if (idx >= 0) list[idx] = { ...list[idx], name: String(b.name || '').slice(0, 120), subject: String(b.subject || '').slice(0, 300), body: String(b.body || '').slice(0, 20000) };
    } else {
      list.push({ id: `tpl${Date.now()}`, name: String(b.name || 'Untitled').slice(0, 120), subject: String(b.subject || '').slice(0, 300), body: String(b.body || '').slice(0, 20000) });
    }
    s.hrEmailTemplates = list; s.changed('hrEmailTemplates', true); await s.save();
    res.json({ templates: list });
  } catch (e) { next(e); }
});
router.delete('/email-templates/:tplId', requireHrAccess, async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    s.hrEmailTemplates = (s.hrEmailTemplates || []).filter((t) => t.id !== req.params.tplId); s.changed('hrEmailTemplates', true); await s.save();
    res.json({ templates: s.hrEmailTemplates });
  } catch (e) { next(e); }
});

// ---- Personal email signature ----
router.get('/signature', requireHrAccess, async (req, res, next) => {
  try {
    if (req.hrActor.kind !== 'hr') return res.json({ signature: '' });
    res.json({ signature: req.hrUser.emailSignature || '' });
  } catch (e) { next(e); }
});
router.post('/signature', requireHrAccess, async (req, res, next) => {
  try {
    if (req.hrActor.kind !== 'hr') return res.status(400).json({ error: 'Only employees have a personal signature.' });
    req.hrUser.emailSignature = String(req.body.signature || '').slice(0, 5000);
    await req.hrUser.save();
    res.json({ signature: req.hrUser.emailSignature });
  } catch (e) { next(e); }
});

// ---- Bulk actions ----
router.post('/candidates/bulk', requireHrAccess, async (req, res, next) => {
  try {
    const b = req.body || {};
    const ids = Array.isArray(b.ids) ? b.ids : [];
    if (!ids.length) return res.status(400).json({ error: 'No candidates selected.' });
    const rows = await HrCandidate.findAll({ where: { id: ids } });
    for (const row of rows) {
      if (b.action === 'move' && b.stage) { row.stage = String(b.stage); row.rejected = false; pushTimeline(row, { type: 'stage', text: `Moved to ${b.stage} (bulk) by ${req.hrActor.name}.`, by: req.hrActor.name }); }
      else if (b.action === 'reject') { row.rejected = true; row.stage = 'rejected'; row.rejectionReason = String(b.reason || '').slice(0, 300); pushTimeline(row, { type: 'reject', text: `Rejected (bulk) by ${req.hrActor.name}${b.reason ? ` — ${b.reason}` : ''}.`, by: req.hrActor.name }); }
      else if (b.action === 'assign' && b.recruiterId) { const u = await HrUser.findByPk(b.recruiterId); if (u) { row.recruiterId = u.id; row.recruiterName = u.name; pushTimeline(row, { type: 'assigned', text: `${u.name} assigned as recruiter (bulk) by ${req.hrActor.name}.`, by: req.hrActor.name }); } }
      await row.save();
    }
    res.json({ ok: true, count: rows.length });
  } catch (e) { next(e); }
});

// ---- Offer management ----
router.post('/candidates/:id/offer', requireHrAccess, requireScheduler, async (req, res, next) => {
  try {
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    const b = req.body || {};
    const offer = row.offer || { active: true, status: 'discussion', salaryDiscussions: [], approvals: [], loi: null, offerLetter: null, finalCtc: '', joiningDate: '' };
    offer.active = true;
    const now = new Date().toISOString();
    switch (b.op) {
      case 'add_discussion':
        offer.salaryDiscussions.unshift({ id: `sd${Date.now()}`, at: b.at || now, mode: b.mode || 'phone', meetLink: b.meetLink || '', offered: b.offered || '', candidateAsk: b.candidateAsk || '', notes: b.notes || '', by: req.hrActor.name });
        pushTimeline(row, { type: 'offer', text: `Salary discussion logged by ${req.hrActor.name}${b.offered ? ` (offered ${b.offered})` : ''}.`, by: req.hrActor.name });
        break;
      case 'request_approval':
        offer.approvals.unshift({ id: `ap${Date.now()}`, requestedBy: req.hrActor.name, candidateAsk: b.candidateAsk || '', justification: b.justification || '', status: 'pending', counterOffer: '', decidedBy: '', at: now });
        offer.status = 'approval_pending';
        pushTimeline(row, { type: 'offer', text: `${req.hrActor.name} requested management approval for a higher package${b.candidateAsk ? ` (${b.candidateAsk})` : ''}.`, by: req.hrActor.name });
        break;
      case 'send_loi':
        offer.loi = { sentAt: now, by: req.hrActor.name, subject: b.subject || '', body: b.body || '', status: b.emailSent ? 'sent' : 'draft' };
        offer.status = 'loi_sent';
        pushTimeline(row, { type: 'offer', text: `Letter of Intent ${b.emailSent ? 'sent' : 'drafted'} by ${req.hrActor.name}.`, by: req.hrActor.name });
        break;
      case 'send_offer_letter':
        offer.offerLetter = { sentAt: now, by: req.hrActor.name, fileUrl: b.fileUrl || '', fileName: b.fileName || '', status: b.emailSent ? 'sent' : 'draft' };
        offer.finalCtc = b.finalCtc || offer.finalCtc;
        offer.joiningDate = b.joiningDate || offer.joiningDate;
        offer.status = 'offer_sent';
        pushTimeline(row, { type: 'offer', text: `Offer letter ${b.emailSent ? 'sent' : 'attached'} by ${req.hrActor.name}${b.finalCtc ? ` (CTC ${b.finalCtc})` : ''}.`, by: req.hrActor.name });
        break;
      case 'set_status':
        offer.status = b.status || offer.status;
        if (b.status === 'accepted') pushTimeline(row, { type: 'offer', text: `Candidate accepted the offer.`, by: req.hrActor.name });
        if (b.status === 'declined') pushTimeline(row, { type: 'offer', text: `Candidate declined the offer.`, by: req.hrActor.name });
        break;
      default: return res.status(400).json({ error: 'Unknown offer operation.' });
    }
    row.offer = offer; row.changed('offer', true);
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

// Admin decides on a salary-approval request (counter-offer).
router.post('/candidates/:id/offer/approve', requireHrAccess, async (req, res, next) => {
  try {
    if (!req.isHrAdmin) return res.status(403).json({ error: 'Only an admin can approve.' });
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row || !row.offer) return res.status(404).json({ error: 'Offer not found.' });
    const b = req.body || {};
    const offer = row.offer;
    const ap = (offer.approvals || []).find((a) => a.id === b.approvalId);
    if (!ap) return res.status(404).json({ error: 'Approval request not found.' });
    ap.status = b.decision === 'approved' ? 'approved' : b.decision === 'countered' ? 'countered' : 'rejected';
    ap.counterOffer = b.counterOffer || '';
    ap.decidedBy = req.hrActor.name;
    ap.decidedAt = new Date().toISOString();
    offer.status = 'discussion';
    pushTimeline(row, { type: 'offer', text: `${req.hrActor.name} ${ap.status} the approval request${ap.counterOffer ? ` — counter: ${ap.counterOffer}` : ''}.`, by: req.hrActor.name });
    row.offer = offer; row.changed('offer', true);
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

// Pending approval requests across candidates (admin in-app queue).
router.get('/offer-approvals', requireHrAccess, async (req, res, next) => {
  try {
    if (!req.isHrAdmin) return res.json({ requests: [] });
    const rows = await HrCandidate.findAll({ order: [['updatedAt', 'DESC']] });
    const requests = [];
    for (const r of rows) {
      const pend = ((r.offer && r.offer.approvals) || []).filter((a) => a.status === 'pending');
      pend.forEach((a) => requests.push({ candidateId: r.id, candidateName: r.name, ...a }));
    }
    res.json({ requests });
  } catch (e) { next(e); }
});

module.exports = router;

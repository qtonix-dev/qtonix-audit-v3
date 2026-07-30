/**
 * HR module API — mounted at /api/hr. Completely separate from the Site
 * Analysis / CRM routes. Access is HR-staff-or-admin only (see hrAuth).
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { Op, HrUser, HrBranch, HrDepartment, HrShift, HrHoliday, HrJobPost, HrCandidate, User, AuditLog, Settings } = require('../models');
const { signHr, requireHrAccess, requireHrAdmin } = require('../middleware/hrAuth');
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

// --- Recruitment scaffolding (lists only; functionality comes later) --------

router.get('/job-posts', requireHrAccess, async (req, res, next) => {
  try { res.json((await HrJobPost.findAll({ order: [['createdAt', 'DESC']] })).map((r) => r.toJSON())); }
  catch (e) { next(e); }
});

router.get('/candidates', requireHrAccess, async (req, res, next) => {
  try {
    const where = {};
    if (req.query.stage) where.stage = String(req.query.stage);
    res.json((await HrCandidate.findAll({ where, order: [['createdAt', 'DESC']] })).map((r) => r.toJSON()));
  } catch (e) { next(e); }
});

module.exports = router;

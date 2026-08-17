/**
 * HR module API — mounted at /api/hr. Completely separate from the Site
 * Analysis / CRM routes. Access is HR-staff-or-admin only (see hrAuth).
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { Op, HrUser, HrBranch, HrDepartment, HrShift, HrHoliday, HrJobPost, HrCandidate, HrNotification, HrAnnouncement, HrOnboarding, HrSurvey, HrSurveyResponse, HrDirectorProfile, User, AuditLog, Settings } = require('../models');
const { signHr, requireHrAccess, requireHrAdmin, requireScheduler, requireHrManager, canViewInternal, canManageBranch } = require('../middleware/hrAuth');
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
      await AuditLog.create({ userId: hr.id, userName: hr.name, action: 'hr.login', target: 'HR portal', ip: req.ip }).catch(() => {});
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
    await AuditLog.create({ userId: u.id, userName: u.name, action: 'hr.login', target: 'HR portal (admin)', ip: req.ip }).catch(() => {});
    res.json({ token, user: { _id: u.id, id: u.id, name: u.name, email: u.email, role: 'admin', portal: 'hr', isAdmin: true, isHrManager: false } });
  } catch (e) {
    console.error('[hr] login error', e.message);
    res.status(500).json({ error: 'Something went wrong signing in.' });
  }
});

/** POST /api/hr/auth/logout — records the logout event (best-effort). */
router.post('/auth/logout', requireHrAccess, async (req, res) => {
  try { await AuditLog.create({ userId: req.hrActor.id, userName: req.hrActor.name, action: 'hr.logout', target: 'HR portal', ip: req.ip }); } catch {}
  res.json({ ok: true });
});

/** GET /api/hr/me — the signed-in HR actor (staff or admin), for the greeting. */
router.get('/me', requireHrAccess, (req, res) => {
  if (req.hrActor.kind === 'admin') {
    return res.json({ _id: req.adminUser.id, name: req.adminUser.name, type: 'admin', isAdmin: true, isHrManager: false });
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
    const list = rows.map((u) => ({
      _id: u.id, id: u.id, name: u.name, employeeId: u.employeeId, email: u.email,
      type: u.type, designation: u.designation, branch: u.branch, department: u.department,
      avatar: u.avatar, active: u.active, completion: profileCompletion(u),
    }));
    // Also surface CRM admins as "Directors" so HR can pick them as interview
    // panelists. Their HRMS-side details come from the overlay table (their CRM
    // name may be a sales alias), falling back to the CRM record.
    const admins = await User.findAll({ where: { role: 'admin', active: true }, attributes: ['id', 'name', 'email'], order: [['name', 'ASC']] });
    const overlays = await HrDirectorProfile.findAll();
    const byUser = {}; overlays.forEach((o) => { byUser[o.userId] = o; });
    admins.forEach((a) => {
      const o = byUser[a.id];
      list.push({
        _id: `admin:${a.id}`, id: `admin:${a.id}`, isDirector: true,
        name: (o && o.name) || a.name, employeeId: (o && o.employeeId) || '', email: (o && o.email) || a.email,
        type: 'director', designation: 'Director', branch: '', department: 'Leadership',
        avatar: (o && o.avatar) || null, active: true, completion: 100,
      });
    });
    res.json(list);
  } catch (e) { next(e); }
});

// Edit a director's HRMS-side details (name, employee id, email) only. Never
// touches their CRM login. Admin only.
router.put('/directors/:userId', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const userId = Number(req.params.userId);
    const admin = await User.findOne({ where: { id: userId, role: 'admin' } });
    if (!admin) return res.status(404).json({ error: 'Director (admin) not found.' });
    const b = req.body || {};
    const [row] = await HrDirectorProfile.findOrCreate({ where: { userId }, defaults: { userId } });
    if (b.name !== undefined) row.name = String(b.name).slice(0, 160) || null;
    if (b.employeeId !== undefined) row.employeeId = String(b.employeeId).slice(0, 60) || null;
    if (b.email !== undefined) row.email = String(b.email).slice(0, 160) || null;
    if (b.avatar !== undefined) row.avatar = b.avatar || null;
    await row.save();
    hrLog(req, 'director.update', row.name || admin.name);
    res.json({ ok: true, director: { _id: `admin:${userId}`, name: row.name || admin.name, employeeId: row.employeeId || '', email: row.email || admin.email } });
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
    if (b.birthday !== undefined) row.birthday = b.birthday || null;
    if (b.maritalStatus !== undefined) {
      row.maritalStatus = ['single', 'married'].includes(b.maritalStatus) ? b.maritalStatus : null;
      if (row.maritalStatus !== 'married') row.anniversary = null;
    }
    if (b.anniversary !== undefined && row.maritalStatus === 'married') row.anniversary = b.anniversary || null;

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

router.post('/users', requireHrAccess, requireHrManager, async (req, res, next) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const email = String(b.email || '').toLowerCase().trim();
    const password = String(b.password || '');
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are all required.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    const type = USER_TYPES.includes(b.type) ? b.type : 'employee';
    // An HR Manager can only add employees to their own branch.
    const branch = b.branch || (req.isHrManager ? req.hrBranch : '') || 'Bhubaneswar';
    if (!canManageBranch(req, branch)) return res.status(403).json({ error: `You can only add employees to your branch (${req.hrBranch}).` });

    const exists = await HrUser.findOne({ where: { email } });
    if (exists) return res.status(409).json({ error: 'An HR user with that email already exists.' });

    const passwordHash = await bcrypt.hash(password, 10);
    const row = await HrUser.create({
      name, email, passwordHash, type,
      employeeId: b.employeeId || null,
      phone: b.phone || '+91 ',
      designation: b.designation || '',
      branch,
      department: b.department || '',
      joiningDate: b.joiningDate || null,
      shiftId: b.shiftId ? Number(b.shiftId) : null,
      branchIncharge: !!b.branchIncharge,
      // Only an admin may grant the HR-Manager role or the announce permission.
      isHrManager: req.isHrAdmin ? !!b.isHrManager : false,
      canPostAnnouncements: req.isHrAdmin ? !!b.canPostAnnouncements : false,
      avatar: b.avatar || null,
      reportsToId: b.reportsToId ? Number(b.reportsToId) : null,
      reportsToAdminId: b.reportsToAdminId ? Number(b.reportsToAdminId) : null,
      targets: (b.targets && (b.targets.dailyInterviews != null || b.targets.monthlyOnboarding != null))
        ? { dailyInterviews: Number((b.targets && b.targets.dailyInterviews) || 0), monthlyOnboarding: Number((b.targets && b.targets.monthlyOnboarding) || 0) }
        : { dailyInterviews: 0, monthlyOnboarding: 0 },
      timeline: [{ at: new Date().toISOString(), kind: 'created', text: `Employee record created by ${req.hrActor.name}`, by: req.hrActor.name }],
    });
    await AuditLog.create({ userId: req.hrActor.id, userName: req.hrActor.name, action: 'hr.user.create', target: name, ip: req.ip }).catch(() => {});
    res.status(201).json(row.toJSON());
  } catch (e) { next(e); }
});

router.put('/users/:id', requireHrAccess, requireHrManager, async (req, res, next) => {
  try {
    const row = await HrUser.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'HR user not found.' });
    // HR Managers can only edit employees in their own branch, and cannot move
    // someone out of their branch.
    if (!canManageBranch(req, row.branch)) return res.status(403).json({ error: 'You can only manage employees in your branch.' });
    const b = req.body || {};
    if (b.branch !== undefined && !canManageBranch(req, b.branch)) return res.status(403).json({ error: 'You can only assign employees to your branch.' });
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
    // HR-Manager role and the announce permission are admin-granted only.
    if (b.isHrManager !== undefined && req.isHrAdmin) row.isHrManager = !!b.isHrManager;
    if (b.canPostAnnouncements !== undefined && req.isHrAdmin) row.canPostAnnouncements = !!b.canPostAnnouncements;
    if (b.birthday !== undefined) row.birthday = b.birthday || null;
    if (b.maritalStatus !== undefined) row.maritalStatus = b.maritalStatus || null;
    if (b.anniversary !== undefined) row.anniversary = b.anniversary || null;
    if (b.canPostAnnouncements !== undefined) row.canPostAnnouncements = !!b.canPostAnnouncements;
    if (b.targets !== undefined) {
      row.targets = { dailyInterviews: Number(b.targets.dailyInterviews || 0), monthlyOnboarding: Number(b.targets.monthlyOnboarding || 0) };
    }
    if (b.password) {
      if (String(b.password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      row.passwordHash = await bcrypt.hash(String(b.password), 10);
    }
    await row.save();
    hrLog(req, 'user.update', row.name);
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

// Delete an employee (admin only). Blocks self-deletion.
router.delete('/users/:id', requireHrAccess, requireHrManager, async (req, res, next) => {
  try {
    const row = await HrUser.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Employee not found.' });
    if (!canManageBranch(req, row.branch)) return res.status(403).json({ error: 'You can only delete employees in your branch.' });
    // An HR Manager cannot delete another manager or an admin-level record.
    if (!req.isHrAdmin && row.isHrManager) return res.status(403).json({ error: 'Only an admin can remove an HR manager.' });
    const nm = row.name;
    await row.destroy();
    hrLog(req, 'user.delete', nm);
    res.json({ ok: true });
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

// Whether a candidate has enough to score (else "not available").
function scorable(row) {
  const a = row.answers || {};
  return !!(row.resumeText || row.resumeUrl || (a.skills || []).length || (a.work || []).length || (a.education || []).length);
}

// Score (or re-score) a candidate's resume match in the background. Never throws
// to the caller — logs and moves on so the main request isn't blocked/broken.
async function scoreResumeMatchBg(candidateId) {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    if (s && s.hrAutoScore === false) return; // auto-scoring disabled by admin
    const key = s && s.getKey ? s.getKey('anthropic') : null;
    if (!key) return;
    const row = await HrCandidate.findByPk(candidateId);
    if (!row) return;
    if (!scorable(row)) { row.resumeMatch = { level: 'not_available', score: 0, reason: 'No resume or profile data.', scoredAt: new Date().toISOString() }; row.changed('resumeMatch', true); await row.save(); return; }
    const job = row.jobPostId ? await HrJobPost.findByPk(row.jobPostId) : null;
    const { scoreResumeMatch } = require('../services/hrRecruitAI');
    const result = await scoreResumeMatch(key, { candidate: row.toJSON(), job: job ? job.toJSON() : null });
    // Re-fetch to avoid clobbering concurrent edits, then persist just the match.
    const fresh = await HrCandidate.findByPk(candidateId);
    if (!fresh) return;
    fresh.resumeMatch = result; fresh.changed('resumeMatch', true);
    await fresh.save();
  } catch (e) { console.error('[resumeMatch] scoring failed:', e.message); }
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
    // Resolve assigned-HR names for display.
    const allIds = [...new Set(rows.flatMap((r) => Array.isArray(r.assignedHrIds) ? r.assignedHrIds : []))];
    const hrById = {};
    if (allIds.length) { const hrs = await HrUser.findAll({ where: { id: allIds }, attributes: ['id', 'name', 'avatar'] }); hrs.forEach((h) => { hrById[h.id] = { id: h.id, name: h.name, avatar: h.avatar }; }); }
    res.json(rows.map((r) => ({
      ...r.toJSON(), applicantCount: byJob[r.id] || 0,
      assignedHr: (Array.isArray(r.assignedHrIds) ? r.assignedHrIds : []).map((id) => hrById[id]).filter(Boolean),
    })));
  } catch (e) { next(e); }
});

router.get('/job-posts/:id', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrJobPost.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Job post not found.' });
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

// Assign / update the HR team on a job post (from the job list or builder).
router.put('/job-posts/:id/assigned-hr', requireHrAccess, requireHrManager, async (req, res, next) => {
  try {
    const row = await HrJobPost.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Job post not found.' });
    const ids = Array.isArray((req.body || {}).assignedHrIds) ? req.body.assignedHrIds.map(Number).filter(Boolean) : [];
    row.assignedHrIds = ids; row.changed('assignedHrIds', true);
    await row.save();
    hrLog(req, 'job.assign-hr', `${row.title} → ${ids.length} HR`);
    // Notify newly assigned HR.
    try { for (const id of ids) await notify(id, { type: 'info', text: `You were assigned to the job “${row.title}”.` }); } catch {}
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

// Set the default interview panel for a stage on a job post.
router.put('/job-posts/:id/round-panels', requireHrAccess, requireHrManager, async (req, res, next) => {
  try {
    const row = await HrJobPost.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Job post not found.' });
    const panels = (req.body && typeof req.body.roundPanels === 'object') ? req.body.roundPanels : {};
    // Sanitize: stageId -> array of numeric HR ids.
    const clean = {};
    for (const k of Object.keys(panels)) clean[k] = Array.isArray(panels[k]) ? panels[k].map(Number).filter(Boolean) : [];
    row.roundPanels = clean; row.changed('roundPanels', true);
    await row.save();
    hrLog(req, 'job.round-panels', row.title);
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

// Create or update a draft (the builder auto-saves as the HR moves through steps).
// Only admins and HR managers create job posts.
router.post('/job-posts', requireHrAccess, requireScheduler, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.title || !String(b.title).trim()) return res.status(400).json({ error: 'Job title is required.' });
    const fields = pickJobFields(b);
    fields.createdById = req.hrActor.id;
    fields.createdByName = req.hrActor.name;
    if (!fields.stages || !fields.stages.length) fields.stages = DEFAULT_STAGES;
    if (!fields.formFields || !Object.keys(fields.formFields).length) fields.formFields = DEFAULT_FORM_FIELDS;
    // Auto-assign the creating HR (unless admin) so it lands in their "My jobs".
    if (req.hrActor.kind === 'hr') {
      const assigned = Array.isArray(fields.assignedHrIds) ? fields.assignedHrIds.map(Number) : [];
      if (!assigned.includes(Number(req.hrActor.id))) assigned.push(Number(req.hrActor.id));
      fields.assignedHrIds = assigned;
    }
    const row = await HrJobPost.create(fields);
    hrLog(req, 'job.create', row.title);
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

router.put('/job-posts/:id', requireHrAccess, requireHrManager, async (req, res, next) => {
  try {
    const row = await HrJobPost.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Job post not found.' });
    const fields = pickJobFields(req.body || {});
    Object.assign(row, fields);
    // Ensure JSON columns persist (Sequelize needs an explicit change flag).
    ['locations', 'skills', 'formFields', 'questions', 'stages', 'assignedHrIds', 'roundPanels'].forEach((k) => { if (fields[k] !== undefined) row.changed(k, true); });
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

// Publish: mint a public token (if not already) and flip status to published.
router.post('/job-posts/:id/publish', requireHrAccess, requireHrManager, async (req, res, next) => {
  try {
    const row = await HrJobPost.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Job post not found.' });
    if (!row.publicToken) row.publicToken = crypto.randomBytes(12).toString('hex');
    row.status = 'published';
    row.publishedAt = new Date();
    await row.save();
    hrLog(req, 'job.publish', row.title);
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

router.post('/job-posts/:id/close', requireHrAccess, requireHrManager, async (req, res, next) => {
  try {
    const row = await HrJobPost.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Job post not found.' });
    row.status = 'closed'; await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

// Toggle a published job between Live and Paused (paused hides the public form
// but keeps the post and its candidates).
router.post('/job-posts/:id/pause', requireHrAccess, requireHrManager, async (req, res, next) => {
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

router.delete('/job-posts/:id', requireHrAccess, requireHrManager, async (req, res, next) => {
  try {
    if (!req.isHrAdmin) return res.status(403).json({ error: 'Only an admin can delete a job post.' });
    const row = await HrJobPost.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Job post not found.' });
    const jt = row.title;
    await row.destroy();
    hrLog(req, 'job.delete', jt);
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
  const json = ['locations', 'skills', 'formFields', 'questions', 'stages', 'assignedHrIds', 'roundPanels'];
  for (const k of str) if (b[k] !== undefined) out[k] = String(b[k]).slice(0, 20000);
  for (const k of num) if (b[k] !== undefined && b[k] !== '' && b[k] !== null) out[k] = Number(b[k]);
  for (const k of json) if (b[k] !== undefined) out[k] = b[k];
  if (b.hideSalary !== undefined) out.hideSalary = !!b.hideSalary;
  // Never let the client set status to published via a plain save.
  if (out.status && !['draft', 'closed'].includes(out.status)) delete out.status;
  return out;
}

// Whether the actor may add candidates to a specific job post.
//  - Admin: any job.
//  - HR Manager: any job they're assigned to; if unassigned, only admin/HR
//    manager whose branch matches the job location may add (managers help staff
//    unassigned jobs in their branch).
//  - HR/recruiter/etc: only if they're in the job's assignedHrIds.
//  - Unassigned job: admin only (or a branch HR manager).
function candidateAddGate(req, job) {
  if (req.isHrAdmin) return { ok: true };
  const assigned = (Array.isArray(job.assignedHrIds) ? job.assignedHrIds : []).map(Number);
  const meId = Number(req.hrActor.id);
  if (assigned.includes(meId)) return { ok: true };
  // HR Manager for the job's branch can add even when not personally assigned.
  if (req.isHrManager && canManageBranch(req, job.branch)) return { ok: true };
  if (assigned.length === 0) return { ok: false, error: 'This job has no HR assigned yet. An admin or HR manager must assign it before candidates can be added.' };
  return { ok: false, error: 'You are not assigned to this job. Ask an admin or HR manager to assign you before adding candidates.' };
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
    // Restrictive assignment: only HR assigned to this job may add candidates to
    // it. Admins add to any job; an unassigned job is admin-only. Candidates with
    // no job (general pool) are allowed for any scheduler.
    if (job) {
      const gate = candidateAddGate(req, job);
      if (!gate.ok) return res.status(403).json({ error: gate.error });
    } else if (!canViewInternal(req)) {
      return res.status(403).json({ error: 'Only HR can add candidates.' });
    }
    const firstStage = (job && job.stages && job.stages[0] && job.stages[0].id) || 'applied';
    const now = new Date().toISOString();
    const VALID_SOURCES = ['manual', 'linkedin', 'naukri', 'indeed', 'referral', 'careers_page', 'public_form'];
    const source = VALID_SOURCES.includes(b.source) ? b.source : 'manual';
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
      source,
      timeline: [
        { id: `t${Date.now()}`, type: 'assigned', text: `${req.hrActor.name} assigned as the recruiter.`, by: req.hrActor.name, at: now },
        { id: `t${Date.now() + 1}`, type: 'imported', text: `Added by ${req.hrActor.name}${job ? ` to ${job.title}` : ''}${source !== 'manual' ? ` (source: ${source})` : ''}.`, by: req.hrActor.name, at: now },
      ],
    });
    res.json(row.toJSON());
    hrLog(req, 'candidate.create', row.name);
    // Score the resume match in the background (auto on add).
    scoreResumeMatchBg(row.id);
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
    // Assign / reassign the recruiter (HR owner). Any HR/admin can do this.
    if (b.recruiterId !== undefined) {
      if (!b.recruiterId) {
        row.recruiterId = null; row.recruiterName = '';
        pushTimeline(row, { type: 'assigned', text: `${req.hrActor.name} unassigned the recruiter.`, by: req.hrActor.name });
      } else {
        const u = await HrUser.findByPk(b.recruiterId);
        if (u) {
          const changed = row.recruiterId !== u.id;
          row.recruiterId = u.id; row.recruiterName = u.name;
          if (changed) {
            pushTimeline(row, { type: 'assigned', text: `${req.hrActor.name} assigned ${u.name} as the recruiter.`, by: req.hrActor.name });
            if (u.id !== req.hrActor.id) notify(u.id, { type: 'info', text: `You were assigned to candidate ${row.name} by ${req.hrActor.name}.`, candidateId: row.id });
          }
        }
      }
    }
    await row.save();
    hrLog(req, 'candidate.update', row.name);
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

// Full candidate detail (with job for stages/questions context).
router.get('/candidates/:id', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    const job = row.jobPostId ? await HrJobPost.findByPk(row.jobPostId) : null;
    const out = { ...row.toJSON(), job: job ? job.toJSON() : null };
    // Pure interview panelists don't see internal notes, offer, or salary/approval.
    if (!canViewInternal(req)) {
      out.comments = (out.comments || []).filter((c) => !c.internal);
      out.offer = null;
      out.canViewInternal = false;
    } else {
      out.canViewInternal = true;
    }
    res.json(out);
  } catch (e) { next(e); }
});

// Best-effort audit log for an HR action. Never throws.
async function hrLog(req, action, target) {
  try {
    await AuditLog.create({ userId: req.hrActor && req.hrActor.id, userName: req.hrActor && req.hrActor.name, action: `hr.${action}`, target: target ? String(target).slice(0, 200) : null, ip: req.ip });
  } catch (e) { /* non-fatal */ }
}

// Create an in-app notification for an HR user (best-effort, never throws).
async function notify(userId, { type, text, candidateId }) {
  try {
    if (!userId) return;
    // Directors (CRM admins) are referenced as 'admin:<id>' in panels; they don't
    // receive in-app HR notifications, so skip non-numeric ids.
    if (!/^\d+$/.test(String(userId))) return;
    const body = String(text || '').slice(0, 500);
    // Dedupe: don't recreate an identical notification for the same user that
    // already exists unread (background jobs re-run and would otherwise pile up
    // the same alert every cycle).
    const dup = await HrNotification.findOne({ where: { userId, text: body, read: false } });
    if (dup) return;
    await HrNotification.create({ userId, type: type || 'info', text: body, candidateId: candidateId || null });
  } catch (e) { console.error('[notify] failed:', e.message); }
}
// Resolve @mentions in a comment body to HrUsers and notify them.
async function notifyMentions(text, { candidateId, candidateName, by }) {
  try {
    const handles = Array.from(new Set((String(text).match(/@([a-zA-Z0-9._-]+)/g) || []).map((h) => h.slice(1).toLowerCase())));
    if (!handles.length) return;
    const users = await HrUser.findAll();
    for (const u of users) {
      const uname = String(u.name || '').toLowerCase().replace(/\s+/g, '');
      const uemail = String(u.email || '').split('@')[0].toLowerCase();
      if (handles.some((h) => uname.includes(h) || uemail === h)) {
        await notify(u.id, { type: 'mention', text: `${by} mentioned you on ${candidateName}.`, candidateId });
      }
    }
  } catch (e) { console.error('[notifyMentions] failed:', e.message); }
}

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
    hrLog(req, 'candidate.stage', `${row.name} → ${label}`);
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
    hrLog(req, 'candidate.reject', `${row.name}${req.body.reason ? ` — ${String(req.body.reason).slice(0, 120)}` : ''}`);
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
    // Only HR/admin can mark a note internal; panelists never can.
    const internal = !!req.body.internal && canViewInternal(req);
    const text = String(req.body.text).slice(0, 4000);
    const list = Array.isArray(row.comments) ? row.comments.slice() : [];
    list.unshift({ id: `c${Date.now()}`, by: req.hrActor.name, byId: req.hrActor.id, text, internal, at: new Date().toISOString() });
    row.comments = list; row.changed('comments', true);
    await row.save();
    notifyMentions(text, { candidateId: row.id, candidateName: row.name, by: req.hrActor.name });
    const out = row.toJSON();
    if (!canViewInternal(req)) out.comments = (out.comments || []).filter((c) => !c.internal);
    res.json(out);
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
    // Mark this panelist as having submitted for the interview. An admin acting
    // as a Director panelist is stored under the 'admin:<id>' panelist key.
    if (b.interviewId) {
      const ivs = (row.interviews || []).map((iv) => {
        if (iv.id !== b.interviewId) return iv;
        const fbp = { ...(iv.feedbackByPanelist || {}) };
        const adminKey = `admin:${req.hrActor.id}`;
        const panelHasAdmin = (iv.panelists || []).some((p) => String(p.id) === adminKey);
        fbp[req.isHrAdmin && panelHasAdmin ? adminKey : req.hrActor.id] = true;
        return { ...iv, feedbackByPanelist: fbp };
      });
      row.interviews = ivs; row.changed('interviews', true);
    }
    pushTimeline(row, { type: 'feedback', text: `${req.hrActor.name} submitted feedback${entry.roundLabel ? ` for ${entry.roundLabel}` : ''} (${entry.verdict.replace('_', ' ')}).`, by: req.hrActor.name });
    await row.save();
    res.json(row.toJSON());
    // Re-score the resume match, folding in the new feedback + all notes.
    scoreResumeMatchBg(row.id);
  } catch (e) { next(e); }
});

// Manually (re)score a candidate's resume match on demand.
router.post('/candidates/:id/resume-match', requireHrAccess, async (req, res, next) => {
  try {
    const key = await anthropicKey();
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    if (!scorable(row)) {
      row.resumeMatch = { level: 'not_available', score: 0, reason: 'No resume or profile data.', scoredAt: new Date().toISOString() };
      row.changed('resumeMatch', true); await row.save();
      return res.json(row.toJSON());
    }
    const job = row.jobPostId ? await HrJobPost.findByPk(row.jobPostId) : null;
    const { scoreResumeMatch } = require('../services/hrRecruitAI');
    const result = await scoreResumeMatch(key, { candidate: row.toJSON(), job: job ? job.toJSON() : null });
    row.resumeMatch = result; row.changed('resumeMatch', true);
    await row.save();
    res.json(row.toJSON());
  } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
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
    const nm = row.name;
    await row.destroy();
    hrLog(req, 'candidate.delete', nm);
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
// Placeholder variables a recruitment template can use (mirrors CRM's
// template-variables). Derived from candidate detail fields.
router.get('/template-variables', requireHrAccess, (req, res) => {
  res.json([
    { key: 'candidate_name', label: 'Candidate name' },
    { key: 'first_name', label: 'First name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'role', label: 'Role / job title' },
    { key: 'current_designation', label: 'Current designation' },
    { key: 'current_company', label: 'Current company' },
    { key: 'location', label: 'Location' },
    { key: 'expected_ctc', label: 'Expected CTC' },
    { key: 'notice_period', label: 'Notice period' },
    { key: 'recruiter_name', label: 'Recruiter name (you)' },
    { key: 'company', label: 'Our company' },
  ]);
});

// AI-draft a recruitment email template (candidate-agnostic). Uses OpenAI, same
// as the CRM's email drafting. HR then inserts placeholders where needed.
router.post('/templates/ai-draft', requireHrAccess, async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const key = s && s.getKey ? s.getKey('openai') : null;
    if (!key) return res.status(400).json({ error: 'OpenAI isn’t configured yet. Ask an admin to add the API key in CRM Admin → API keys.' });
    const prompt = String((req.body || {}).prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'Add a short prompt describing the email.' });
    const signName = req.hrActor.name || 'The Talent Team';
    const system = [
      'Act as a professional HR / talent acquisition specialist at a software company writing a recruitment email template.',
      'The email is a reusable TEMPLATE, so where a candidate-specific value belongs, use one of these placeholders EXACTLY: {{candidate_name}}, {{first_name}}, {{role}}, {{current_company}}, {{current_designation}}, {{company}}, {{recruiter_name}}.',
      'For example greet with "Hi {{first_name}}," and refer to the position as "{{role}}".',
      'Tone: warm, professional, concise. Structure the body as clean HTML — wrap each paragraph in its own <p> tag, use <br> and <ul><li> where useful. No <html> wrapper.',
      'Return strict JSON: {"subject":"...","body":"<p>...</p>"}. No markdown, no commentary outside the JSON.',
    ].join(' ');
    try { const { recordApiCall } = require('../models'); recordApiCall && recordApiCall('openai'); } catch {}
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: system }, { role: 'user', content: `TASK:\n${prompt}` }], max_tokens: 1000, response_format: { type: 'json_object' } }),
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(502).json({ error: (data.error && data.error.message) || 'OpenAI request failed.' });
    let parsed = {};
    try { parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}'); } catch { parsed = {}; }
    res.json({ subject: parsed.subject || '', body: parsed.body || '' });
  } catch (e) { next(e); }
});

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
      else if (b.action === 'assign' && b.recruiterId) {
        if (!req.isHrAdmin && !req.isHrManager) return res.status(403).json({ error: 'Only an admin or HR manager can reassign candidates.' });
        const u = await HrUser.findByPk(b.recruiterId); if (u) { row.recruiterId = u.id; row.recruiterName = u.name; pushTimeline(row, { type: 'assigned', text: `${u.name} assigned as recruiter (bulk) by ${req.hrActor.name}.`, by: req.hrActor.name }); }
      }
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
    hrLog(req, 'offer.' + (b.op || 'update'), `${row.name}${b.status ? ` — ${b.status}` : ''}`);
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

// ---- Self profile (the logged-in employee) ----
router.get('/profile-me', requireHrAccess, async (req, res, next) => {
  try {
    if (req.hrActor.kind !== 'hr') return res.json({ isAdmin: true, name: req.hrActor.name });
    const u = req.hrUser;
    res.json({ ...u.toJSON(), completion: profileCompletion(u) });
  } catch (e) { next(e); }
});

router.put('/profile-me', requireHrAccess, async (req, res, next) => {
  try {
    if (req.hrActor.kind !== 'hr') return res.status(400).json({ error: 'Admins manage their profile in the CRM.' });
    const u = req.hrUser; const b = req.body || {};
    if (b.phone !== undefined) u.phone = String(b.phone).slice(0, 40);
    if (b.avatar !== undefined) u.avatar = b.avatar || null;
    if (b.birthday !== undefined) u.birthday = b.birthday || null;
    if (b.maritalStatus !== undefined) {
      u.maritalStatus = ['single', 'married'].includes(b.maritalStatus) ? b.maritalStatus : null;
      if (u.maritalStatus !== 'married') u.anniversary = null;
    }
    if (b.anniversary !== undefined && u.maritalStatus === 'married') u.anniversary = b.anniversary || null;
    await u.save();
    res.json(u.toJSON());
  } catch (e) { next(e); }
});

// Change own password (needs current password).
router.post('/profile-me/password', requireHrAccess, async (req, res, next) => {
  try {
    if (req.hrActor.kind !== 'hr') return res.status(400).json({ error: 'Admins change their password in the CRM.' });
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    const ok = await bcrypt.compare(String(currentPassword || ''), req.hrUser.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });
    req.hrUser.passwordHash = await bcrypt.hash(String(newPassword), 10);
    await req.hrUser.save();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Upload an avatar/profile picture to ImageKit → returns the URL.
router.post('/profile-me/avatar', requireHrAccess, async (req, res, next) => {
  try {
    const { base64, fileName } = req.body || {};
    if (!base64) return res.status(400).json({ error: 'No image provided.' });
    const out = await imagekit.uploadFile({ base64, fileName: fileName || 'avatar', folder: 'HRMS/Avatars' });
    if (req.hrActor.kind === 'hr') { req.hrUser.avatar = out.url; await req.hrUser.save(); }
    res.json({ url: out.url });
  } catch (e) {
    if (/not configured/i.test(e.message)) return res.status(400).json({ error: 'ImageKit is not configured. Add ImageKit keys in admin settings.' });
    next(e);
  }
});

// ---- Signature templates (named, like the CRM) ----
// Built-in gallery — the exact same 3 templates as the Sales CRM, pre-filled
// with this HR user's details, company socials, and avatar.
router.get('/signature-templates', requireHrAccess, async (req, res, next) => {
  try {
    const sig = require('../services/signatureTemplates');
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const company = (s && s.socialLinks) || {};
    const u = req.hrUser || {};
    const mine = (u.socialLinks && typeof u.socialLinks === 'object') ? u.socialLinks : {};
    const vals = {
      name: u.name || (req.adminUser && req.adminUser.name) || 'Your Name',
      title: u.designation || 'Talent Acquisition',
      company: (s && s.companyName) || 'Qtonix',
      email: u.email || (req.adminUser && req.adminUser.email) || '',
      phone: u.phone || '',
      website: company.website || (s && s.website) || '',
      photo: u.avatar || '',
      linkedin: company.linkedin || '',
      facebook: company.facebook || '',
      instagram: company.instagram || '',
      calendly: mine.calendly || '',
    };
    res.json(sig.templates.map((t) => ({ id: t.id, name: t.name, description: t.description, html: sig.render(t, vals) })));
  } catch (e) { next(e); }
});

router.get('/signatures', requireHrAccess, async (req, res, next) => {
  try {
    if (req.hrActor.kind !== 'hr') return res.json({ signatures: [] });
    res.json({ signatures: req.hrUser.emailSignatures || [] });
  } catch (e) { next(e); }
});

router.post('/signatures', requireHrAccess, async (req, res, next) => {
  try {
    if (req.hrActor.kind !== 'hr') return res.status(400).json({ error: 'Only employees have signatures.' });
    const u = req.hrUser; const b = req.body || {};
    const list = Array.isArray(u.emailSignatures) ? u.emailSignatures.slice() : [];
    if (b.id) {
      const idx = list.findIndex((s) => s.id === b.id);
      if (idx >= 0) list[idx] = { ...list[idx], name: String(b.name || '').slice(0, 120), body: String(b.body || '').slice(0, 8000) };
    } else {
      list.push({ id: `sig${Date.now()}`, name: String(b.name || 'Signature').slice(0, 120), body: String(b.body || '').slice(0, 8000), isDefault: list.length === 0 });
    }
    if (b.isDefault && b.id) list.forEach((s) => { s.isDefault = s.id === b.id; });
    u.emailSignatures = list; u.changed('emailSignatures', true);
    await u.save();
    res.json({ signatures: list });
  } catch (e) { next(e); }
});

router.delete('/signatures/:sigId', requireHrAccess, async (req, res, next) => {
  try {
    if (req.hrActor.kind !== 'hr') return res.status(400).json({ error: 'Only employees have signatures.' });
    const u = req.hrUser;
    u.emailSignatures = (u.emailSignatures || []).filter((s) => s.id !== req.params.sigId); u.changed('emailSignatures', true);
    await u.save();
    res.json({ signatures: u.emailSignatures });
  } catch (e) { next(e); }
});

// ---- Admin user management (activate/deactivate, reset password) ----
router.post('/users/:id/reset-password', requireHrAccess, requireHrManager, async (req, res, next) => {
  try {
    const u = await HrUser.findByPk(req.params.id);
    if (!u) return res.status(404).json({ error: 'User not found.' });
    if (!canManageBranch(req, u.branch)) return res.status(403).json({ error: 'You can only reset passwords for employees in your branch.' });
    const np = String((req.body && (req.body.password || req.body.newPassword)) || '');
    if (np.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    u.passwordHash = await bcrypt.hash(np, 10);
    await u.save();
    hrLog(req, 'user.reset-password', u.name);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/users/:id/active', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const u = await HrUser.findByPk(req.params.id);
    if (!u) return res.status(404).json({ error: 'User not found.' });
    u.active = !!req.body.active;
    await u.save();
    res.json({ ok: true, active: u.active });
  } catch (e) { next(e); }
});

// Self-schedule requests where I'm a panelist and haven't confirmed yet.
router.get('/my-schedule-requests', requireHrAccess, async (req, res, next) => {
  try {
    if (req.hrActor.kind !== 'hr') return res.json({ requests: [] });
    const uid = req.hrUser.id;
    const cands = await HrCandidate.findAll();
    const requests = [];
    for (const c of cands) {
      const ss = c.selfSchedule;
      if (ss && ss.active && !ss.booked && (ss.panelistIds || []).includes(uid)) {
        requests.push({
          candidateId: c.id, candidateName: c.name, roundLabel: ss.roundLabel,
          slots: (ss.slots || []).map((s) => ({ id: s.id, at: s.at, confirmed: (s.confirmedBy || []).includes(uid) })),
        });
      }
    }
    res.json({ requests });
  } catch (e) { next(e); }
});

// ---- Notifications (in-app bell) ----
router.get('/notifications', requireHrAccess, async (req, res, next) => {
  try {
    if (req.hrActor.kind !== 'hr') return res.json({ notifications: [], unread: 0 });
    const rows = await HrNotification.findAll({ where: { userId: req.hrUser.id }, order: [['createdAt', 'DESC']], limit: 50 });
    const unread = await HrNotification.count({ where: { userId: req.hrUser.id, read: false } });
    res.json({ notifications: rows.map((r) => r.toJSON()), unread });
  } catch (e) { next(e); }
});
router.post('/notifications/read', requireHrAccess, async (req, res, next) => {
  try {
    if (req.hrActor.kind !== 'hr') return res.json({ ok: true });
    const ids = Array.isArray(req.body.ids) ? req.body.ids : null;
    const where = { userId: req.hrUser.id };
    if (ids) where.id = ids;
    await HrNotification.update({ read: true }, { where });
    res.json({ ok: true });
  } catch (e) { next(e); }
});
// Delete a single notification (persists — won't reappear on refresh).
router.delete('/notifications/:id', requireHrAccess, async (req, res, next) => {
  try {
    if (req.hrActor.kind !== 'hr') return res.json({ ok: true });
    await HrNotification.destroy({ where: { id: req.params.id, userId: req.hrUser.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});
// Clear all of my notifications.
router.post('/notifications/clear', requireHrAccess, async (req, res, next) => {
  try {
    if (req.hrActor.kind !== 'hr') return res.json({ ok: true });
    await HrNotification.destroy({ where: { userId: req.hrUser.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- Recruiter dashboard stats ----
// ---- HR target progress (per HR user: daily scheduling + monthly hiring) ----
router.get('/targets-progress', requireHrAccess, async (req, res, next) => {
  try {
    const users = await HrUser.findAll({ where: { active: true } });
    const withTargets = users.filter((u) => u.targets && (Number(u.targets.dailyInterviews) > 0 || Number(u.targets.monthlyOnboarding) > 0));
    if (!withTargets.length) return res.json({ rows: [] });
    const cands = await HrCandidate.findAll();
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const rows = withTargets.map((u) => {
      // Interviews this HR scheduled today (across candidate.interviews[].scheduledById or createdBy name).
      let interviewsToday = 0;
      let onboardedThisMonth = 0;
      cands.forEach((c) => {
        (c.interviews || []).forEach((iv) => {
          const at = iv.createdAt || iv.at;
          const byMe = iv.scheduledById === u.id || iv.createdBy === u.name || iv.by === u.name;
          if (byMe && at && new Date(at).getTime() >= startOfDay) interviewsToday += 1;
        });
        // Onboarded = accepted offer, credited to the recruiter, this month.
        if (c.offer && c.offer.status === 'accepted' && (c.recruiterId === u.id || c.recruiterName === u.name)) {
          const doneAt = (c.offer.offerLetter && c.offer.offerLetter.sentAt) || c.updatedAt;
          if (doneAt && new Date(doneAt).getTime() >= startOfMonth) onboardedThisMonth += 1;
        }
      });
      const t = u.targets || {};
      return {
        id: u.id, name: u.name, avatar: u.avatar || null, designation: u.designation || '',
        dailyTarget: Number(t.dailyInterviews) || 0, dailyDone: interviewsToday,
        monthlyTarget: Number(t.monthlyOnboarding) || 0, monthlyDone: onboardedThisMonth,
      };
    });
    res.json({ rows });
  } catch (e) { next(e); }
});

router.get('/dashboard-stats', requireHrAccess, async (req, res, next) => {
  try {
    const jobs = await HrJobPost.findAll();
    const openJobs = jobs.filter((j) => j.status === 'published').length;
    const cands = await HrCandidate.findAll();
    const now = Date.now();
    const weekAgo = now - 7 * 864e5;
    const applicationsThisWeek = cands.filter((c) => new Date(c.createdAt).getTime() >= weekAgo).length;
    // Candidates per stage (per job stage id → label handled client-side; here counts by stage id).
    const byStage = {};
    cands.forEach((c) => { if (!c.rejected) byStage[c.stage] = (byStage[c.stage] || 0) + 1; });
    // Time-to-hire: avg days from created → offer accepted, for accepted offers.
    const hireDays = [];
    cands.forEach((c) => {
      if (c.offer && c.offer.status === 'accepted') {
        const acc = (c.offer.salaryDiscussions || []); // fallback
        const created = new Date(c.createdAt).getTime();
        const done = c.offer.offerLetter && c.offer.offerLetter.sentAt ? new Date(c.offer.offerLetter.sentAt).getTime() : now;
        hireDays.push(Math.max(0, Math.round((done - created) / 864e5)));
      }
    });
    const avgTimeToHire = hireDays.length ? Math.round(hireDays.reduce((a, b) => a + b, 0) / hireDays.length) : null;
    const totalActive = cands.filter((c) => !c.rejected).length;
    const hired = cands.filter((c) => c.offer && c.offer.status === 'accepted').length;
    res.json({ openJobs, applicationsThisWeek, byStage, avgTimeToHire, totalActive, hired, totalCandidates: cands.length });
  } catch (e) { next(e); }
});

// ---- Source analytics ----
router.get('/source-analytics', requireHrAccess, async (req, res, next) => {
  try {
    const cands = await HrCandidate.findAll();
    const by = {};
    const bump = (src, key) => { by[src] = by[src] || { source: src, total: 0, hired: 0, rejected: 0, inProcess: 0 }; by[src][key] += 1; };
    cands.forEach((c) => {
      const src = c.source || 'manual';
      bump(src, 'total');
      if (c.offer && c.offer.status === 'accepted') bump(src, 'hired');
      else if (c.rejected) bump(src, 'rejected');
      else bump(src, 'inProcess');
    });
    const rows = Object.values(by).map((r) => ({ ...r, hireRate: r.total ? Math.round((r.hired / r.total) * 100) : 0 })).sort((a, b) => b.total - a.total);
    res.json({ sources: rows });
  } catch (e) { next(e); }
});

// ---- Self-schedule interviews ----
// HR creates/updates the slot offer.
router.post('/candidates/:id/self-schedule', requireHrAccess, requireScheduler, async (req, res, next) => {
  try {
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    const b = req.body || {};
    const crypto = require('crypto');
    const ss = row.selfSchedule && row.selfSchedule.token ? row.selfSchedule : {
      active: true, token: crypto.randomBytes(12).toString('hex'), createdBy: req.hrActor.name, createdAt: new Date().toISOString(), booked: null,
    };
    ss.active = true;
    ss.roundLabel = String(b.roundLabel || ss.roundLabel || 'Interview').slice(0, 80);
    ss.durationMins = Number(b.durationMins) || ss.durationMins || 45;
    ss.panelistIds = Array.isArray(b.panelistIds) ? b.panelistIds : (ss.panelistIds || []);
    ss.slots = Array.isArray(b.slots) ? b.slots.map((s, i) => ({ id: s.id || `slot${Date.now()}_${i}`, at: s.at, confirmedBy: s.confirmedBy || [] })) : (ss.slots || []);
    ss.questions = Array.isArray(b.questions) ? b.questions.map((q, i) => ({ id: q.id || `q${Date.now()}_${i}`, type: q.type === 'task' ? 'task' : 'text', prompt: String(q.prompt || '').slice(0, 500) })) : (ss.questions || []);
    row.selfSchedule = ss; row.changed('selfSchedule', true);
    pushTimeline(row, { type: 'interview', text: `${req.hrActor.name} set up self-scheduling (${ss.slots.length} slots).`, by: req.hrActor.name });
    await row.save();
    // Notify panelists to confirm availability.
    for (const pid of ss.panelistIds) await notify(pid, { type: 'interview', text: `Confirm your availability for ${row.name}'s interview.`, candidateId: row.id });
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

// Panelist confirms which slots they're available for.
router.post('/candidates/:id/self-schedule/confirm', requireHrAccess, async (req, res, next) => {
  try {
    if (req.hrActor.kind !== 'hr') return res.status(403).json({ error: 'Only panelists confirm slots.' });
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row || !row.selfSchedule) return res.status(404).json({ error: 'No schedule found.' });
    const ss = row.selfSchedule;
    const chosen = Array.isArray(req.body.slotIds) ? req.body.slotIds : [];
    ss.slots = (ss.slots || []).map((s) => {
      const set = new Set(s.confirmedBy || []);
      if (chosen.includes(s.id)) set.add(req.hrUser.id); else set.delete(req.hrUser.id);
      return { ...s, confirmedBy: Array.from(set) };
    });
    row.selfSchedule = ss; row.changed('selfSchedule', true);
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

// ---- HR settings: auto-score toggle + careers branding ----
router.get('/settings', requireHrAccess, async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    res.json({ autoScore: s.hrAutoScore !== false, careers: s.hrCareers || {} });
  } catch (e) { next(e); }
});
router.put('/settings', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const b = req.body || {};
    if (b.autoScore !== undefined) s.hrAutoScore = !!b.autoScore;
    if (b.careers && typeof b.careers === 'object') {
      const crypto = require('crypto');
      const cur = s.hrCareers || {};
      s.hrCareers = {
        logo: b.careers.logo !== undefined ? String(b.careers.logo).slice(0, 400) : cur.logo || '',
        title: b.careers.title !== undefined ? String(b.careers.title).slice(0, 160) : cur.title || 'Careers',
        description: b.careers.description !== undefined ? String(b.careers.description).slice(0, 4000) : cur.description || '',
        token: cur.token || crypto.randomBytes(8).toString('hex'),
      };
      s.changed('hrCareers', true);
    }
    await s.save();
    hrLog(req, 'settings.update', b.careers ? 'careers page' : (b.autoScore !== undefined ? `auto-score ${b.autoScore ? 'on' : 'off'}` : 'settings'));
    res.json({ autoScore: s.hrAutoScore !== false, careers: s.hrCareers || {} });
  } catch (e) { next(e); }
});

// ---- Audit logs (HR-scoped view) + API usage ----
router.get('/logs', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const limit = Math.min(1000, Number(req.query.limit) || 300);
    const where = {};
    // Optional filter by a specific actor.
    if (req.query.userId) where.userId = Number(req.query.userId);
    if (req.query.userName) where.userName = req.query.userName;
    // Optional action-category filter (e.g. 'hr' or 'auth').
    if (req.query.category === 'hr') where.action = { [Op.like]: 'hr.%' };
    else if (req.query.category === 'auth') where.action = { [Op.in]: ['login', 'logout', 'hr.login', 'hr.logout'] };
    const logs = await AuditLog.findAll({ where, order: [['createdAt', 'DESC']], limit });
    // Distinct actors present in the log, for the filter dropdown.
    const all = await AuditLog.findAll({ attributes: ['userId', 'userName'], group: ['userId', 'userName'], order: [['userName', 'ASC']] });
    const users = all.map((r) => ({ userId: r.userId, userName: r.userName })).filter((u) => u.userName);
    res.json({ logs: logs.map((l) => l.toJSON ? l.toJSON() : l), users });
  } catch (e) { next(e); }
});
router.get('/api-usage', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const { ApiUsage } = require('../models');
    const rows = await ApiUsage.findAll();
    const usage = {};
    rows.forEach((r) => { usage[r.provider] = (usage[r.provider] || 0) + r.count; });
    res.json({ usage });
  } catch (e) { next(e); }
});

// ---- Dashboard: missed commitments (HR + admin) ----
// Surfaces things HR/panelists agreed to do but didn't, past their time:
//  • interview feedback not submitted (per missing panelist)
//  • overdue calls / tasks (candidate.activities)
//  • candidate in an interview stage with no upcoming interview booked
//  • self-schedule link sent but the candidate never booked (past a grace window)
// Scoped to the logged-in HR user; admins see everyone (with per-owner rollup).
router.get('/missed-commitments', requireHrAccess, async (req, res, next) => {
  try {
    if (!canViewInternal(req)) return res.json({ stillOpen: 0, items: [], byOwner: [] });
    const isAdmin = !!req.isHrAdmin;
    const meId = req.hrActor.id;
    const meName = req.hrActor.name;
    const now = Date.now();
    const GRACE = 60 * 60 * 1000; // 1h past agreed time
    const NO_INTERVIEW_GRACE = 48 * 60 * 60 * 1000; // 48h in an interview stage w/o a booking
    const SELF_SCHED_GRACE = (2 * 24 + 0) * 60 * 60 * 1000; // 2 days & 0 hours (X days & X hours)

    const rows = await HrCandidate.findAll({ where: { rejected: false } });
    const jobsCache = {};
    const jobFor = async (id) => { if (!id) return null; if (jobsCache[id] === undefined) jobsCache[id] = await HrJobPost.findByPk(id); return jobsCache[id]; };
    const items = [];
    const byOwner = {};
    const bump = (ownerId, ownerName) => { const k = ownerId || 0; byOwner[k] = byOwner[k] || { ownerId: ownerId || null, ownerName: ownerName || 'Unassigned', missed: 0 }; byOwner[k].missed++; };
    // Is this item relevant to the current viewer (when not admin)?
    const mineOwner = (c) => c.recruiterId === meId || c.recruiterName === meName;

    for (const c of rows) {
      const dismissed = Array.isArray(c.dismissedMissed) ? c.dismissedMissed : [];
      const ownerName = c.recruiterName || 'Unassigned';
      const ownerId = c.recruiterId || null;

      // 1) Interview feedback not submitted by a panelist after the interview time.
      for (const iv of (c.interviews || [])) {
        const at = iv.at ? new Date(iv.at).getTime() : 0;
        if (!at || now < at + GRACE) continue; // not yet past the interview + grace
        const fb = iv.feedbackByPanelist || {};
        for (const p of (iv.panelists || [])) {
          if (fb[p.id]) continue; // submitted
          const aid = `fb-${c.id}-${iv.id}-${p.id}`;
          if (dismissed.includes(aid)) continue;
          // Visibility: admin sees all; a panelist sees their own missing feedback;
          // the assigned recruiter sees it for their candidate.
          const relevant = isAdmin || p.id === meId || mineOwner(c);
          if (!relevant) continue;
          items.push({ activityId: aid, candidateId: c.id, candidateName: c.name, kind: 'feedback',
            title: `Interview feedback pending — ${iv.roundLabel || iv.round || 'interview'}`,
            ownerId: p.id, ownerName: p.name || ownerName, dueAt: new Date(at).toISOString(),
            hoursLate: Math.max(0, Math.round((now - at) / 3600000)) });
          bump(p.id, p.name || ownerName);
        }
      }

      // 2) Overdue calls / tasks.
      for (const a of (c.activities || [])) {
        if (a.done || a.status === 'done') continue;
        const dueRaw = a.dueDate ? `${a.dueDate}T${a.time || (a.kind === 'call' ? '09:00' : '17:00')}` : (a.at || '');
        const due = dueRaw ? new Date(dueRaw).getTime() : 0;
        if (!due || now < due + GRACE) continue;
        const aid = `act-${c.id}-${a.id}`;
        if (dismissed.includes(aid)) continue;
        const relevant = isAdmin || mineOwner(c) || a.byId === meId;
        if (!relevant) continue;
        items.push({ activityId: aid, candidateId: c.id, candidateName: c.name, kind: a.kind === 'call' ? 'call' : 'task',
          title: a.title || (a.kind === 'call' ? 'Scheduled call' : 'Task'),
          ownerId, ownerName, dueAt: new Date(due).toISOString(),
          hoursLate: Math.max(0, Math.round((now - due) / 3600000)) });
        bump(ownerId, ownerName);
      }

      // 3) Candidate sat in an interview-type stage with no upcoming interview booked.
      const job = await jobFor(c.jobPostId);
      const stage = (job && job.stages || []).find((s) => s.id === c.stage);
      const looksInterview = stage && /interview|screen|round|technical|hr round/i.test(stage.label || '');
      if (looksInterview) {
        const hasUpcoming = (c.interviews || []).some((iv) => iv.at && new Date(iv.at).getTime() > now - GRACE);
        const enteredStageAt = (() => {
          const tl = (c.timeline || []).filter((t) => t.type === 'stage');
          const last = tl[tl.length - 1];
          return last && last.at ? new Date(last.at).getTime() : new Date(c.updatedAt).getTime();
        })();
        if (!hasUpcoming && now > enteredStageAt + NO_INTERVIEW_GRACE) {
          const aid = `noiv-${c.id}-${c.stage}`;
          if (!dismissed.includes(aid) && (isAdmin || mineOwner(c))) {
            items.push({ activityId: aid, candidateId: c.id, candidateName: c.name, kind: 'schedule',
              title: `No interview scheduled — ${stage.label}`,
              ownerId, ownerName, dueAt: new Date(enteredStageAt + NO_INTERVIEW_GRACE).toISOString(),
              hoursLate: Math.max(0, Math.round((now - enteredStageAt - NO_INTERVIEW_GRACE) / 3600000)) });
            bump(ownerId, ownerName);
          }
        }
      }

      // 4) Self-schedule link sent but candidate never booked (past grace).
      const ss = c.selfSchedule;
      if (ss && ss.active && !ss.booked && ss.createdAt) {
        const sentAt = new Date(ss.createdAt).getTime();
        if (now > sentAt + SELF_SCHED_GRACE) {
          const aid = `ss-${c.id}`;
          if (!dismissed.includes(aid) && (isAdmin || mineOwner(c))) {
            items.push({ activityId: aid, candidateId: c.id, candidateName: c.name, kind: 'selfschedule',
              title: `Interview booking link unbooked — ${ss.roundLabel || 'interview'}`,
              ownerId, ownerName, dueAt: new Date(sentAt + SELF_SCHED_GRACE).toISOString(),
              hoursLate: Math.max(0, Math.round((now - sentAt - SELF_SCHED_GRACE) / 3600000)) });
            bump(ownerId, ownerName);
          }
        }
      }
    }

    items.sort((a, b) => b.hoursLate - a.hoursLate);
    res.json({
      stillOpen: items.length,
      items: items.slice(0, 100),
      byOwner: Object.values(byOwner).sort((a, b) => b.missed - a.missed),
    });
  } catch (e) { next(e); }
});

// Admin clears a missed-commitment item.
router.post('/missed-commitments/:candidateId/dismiss', requireHrAccess, async (req, res, next) => {
  try {
    if (!canViewInternal(req)) return res.status(403).json({ error: 'Not allowed.' });
    const row = await HrCandidate.findByPk(req.params.candidateId);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    const aid = String((req.body || {}).activityId || '');
    if (!aid) return res.status(400).json({ error: 'activityId is required.' });
    // Admins can clear anything; otherwise the item must belong to this user —
    // either their candidate, or a feedback item addressed to them (fb-…-<myId>).
    if (!req.isHrAdmin) {
      const mine = row.recruiterId === req.hrActor.id || row.recruiterName === req.hrActor.name;
      const myFeedback = aid.startsWith('fb-') && aid.endsWith(`-${req.hrActor.id}`);
      if (!mine && !myFeedback) return res.status(403).json({ error: 'You can only clear your own items.' });
    }
    const list = Array.isArray(row.dismissedMissed) ? row.dismissedMissed.slice() : [];
    if (!list.includes(aid)) list.push(aid);
    row.dismissedMissed = list; row.changed('dismissedMissed', true);
    await row.save();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- Dashboard: birthdays & work anniversaries (this week) ----
// Mirrors the CRM celebrations widget, over the HR employee roster.
router.get('/celebrations', requireHrAccess, async (req, res, next) => {
  try {
    const users = await HrUser.findAll({ where: { active: true }, attributes: ['id', 'name', 'avatar', 'birthday', 'joiningDate', 'anniversary', 'designation'] });
    const now = new Date();
    const mmdd = (d) => { if (!d) return null; const x = new Date(d); return `${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
    const today = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
    const items = [];
    users.forEach((u) => {
      if (mmdd(u.birthday) === today) items.push({ id: u.id, name: u.name, avatar: u.avatar, type: 'birthday' });
      if (mmdd(u.joiningDate) === today) {
        const years = u.joiningDate ? (now.getFullYear() - new Date(u.joiningDate).getFullYear()) : 0;
        if (years > 0) items.push({ id: u.id, name: u.name, avatar: u.avatar, type: 'work', years, yearsLabel: ordinal(years) });
      }
      if (mmdd(u.anniversary) === today) items.push({ id: u.id, name: u.name, avatar: u.avatar, type: 'anniversary' });
    });
    res.json({ items });
  } catch (e) { next(e); }
});

// ---- Announcements / notice board ----
router.get('/announcements', requireHrAccess, async (req, res, next) => {
  try {
    const rows = await HrAnnouncement.findAll({ where: { active: true }, order: [['pinned', 'DESC'], ['createdAt', 'DESC']], limit: 200 });
    // An employee sees 'all' plus announcements targeted at their branch. Admins
    // and HR managers see everything (so they can manage it).
    const myBranch = req.hrUser ? req.hrUser.branch : '';
    const canSeeAll = !!req.isHrAdmin || !!req.isHrManager;
    const visible = rows.filter((r) => canSeeAll || r.audience === 'all' || r.audience === myBranch);
    const canPost = !!req.isHrAdmin || !!req.isHrManager || !!(req.hrUser && req.hrUser.canPostAnnouncements);
    res.json({ announcements: visible.map((r) => r.toJSON()), canPost, myBranch, isManager: !!req.isHrManager, isAdmin: !!req.isHrAdmin });
  } catch (e) { next(e); }
});
// Admins, HR managers, and HR granted the permission may post.
function requireAnnouncer(req, res, next) {
  if (req.isHrAdmin || req.isHrManager || (req.hrUser && req.hrUser.canPostAnnouncements)) return next();
  return res.status(403).json({ error: 'You don’t have permission to post announcements.' });
}
router.post('/announcements', requireHrAccess, requireAnnouncer, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.title || !String(b.title).trim()) return res.status(400).json({ error: 'A title is required.' });
    const audience = String(b.audience || 'all').slice(0, 80);
    const row = await HrAnnouncement.create({ title: String(b.title).slice(0, 200), body: String(b.body || ''), pinned: !!b.pinned, audience, authorId: req.hrActor.id, authorName: req.hrActor.name });
    hrLog(req, 'announcement.create', `${row.title} (${audience})`);
    // Notify the targeted staff of the new announcement.
    try {
      const where = { active: true };
      if (audience !== 'all') where.branch = audience;
      const staff = await HrUser.findAll({ where, attributes: ['id'] });
      for (const u of staff) await notify(u.id, { type: 'info', text: `📢 New announcement: ${row.title}` });
    } catch {}
    res.json(row.toJSON());
  } catch (e) { next(e); }
});
router.put('/announcements/:id', requireHrAccess, requireAnnouncer, async (req, res, next) => {
  try {
    const row = await HrAnnouncement.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Announcement not found.' });
    if (!req.isHrAdmin && row.authorId !== req.hrActor.id) return res.status(403).json({ error: 'You can only edit your own announcements.' });
    const b = req.body || {};
    if (b.title !== undefined) row.title = String(b.title).slice(0, 200);
    if (b.body !== undefined) row.body = String(b.body);
    if (b.pinned !== undefined) row.pinned = !!b.pinned;
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});
router.delete('/announcements/:id', requireHrAccess, requireAnnouncer, async (req, res, next) => {
  try {
    const row = await HrAnnouncement.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Announcement not found.' });
    if (!req.isHrAdmin && row.authorId !== req.hrActor.id) return res.status(403).json({ error: 'You can only delete your own announcements.' });
    row.active = false; await row.save();
    hrLog(req, 'announcement.delete', row.title);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- Onboarding checklist ----
// The admin-configured template (task names) lives in Settings.
router.get('/onboarding-template', requireHrAccess, async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    res.json({ tasks: Array.isArray(s.hrOnboardingTasks) ? s.hrOnboardingTasks : [] });
  } catch (e) { next(e); }
});
router.put('/onboarding-template', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const tasks = Array.isArray((req.body || {}).tasks) ? req.body.tasks.map((t) => String(t).slice(0, 200)).filter(Boolean) : [];
    s.hrOnboardingTasks = tasks; s.changed('hrOnboardingTasks', true);
    await s.save();
    hrLog(req, 'onboarding.template.update', `${tasks.length} tasks`);
    res.json({ tasks });
  } catch (e) { next(e); }
});
// Per-employee checklist: auto-seeds from the template on first view.
router.get('/employees/:id/onboarding', requireHrAccess, async (req, res, next) => {
  try {
    const empId = Number(req.params.id);
    let rows = await HrOnboarding.findAll({ where: { employeeId: empId }, order: [['order', 'ASC'], ['id', 'ASC']] });
    if (rows.length === 0) {
      const s = await Settings.findOne({ where: { singleton: 'settings' } });
      const tmpl = Array.isArray(s.hrOnboardingTasks) ? s.hrOnboardingTasks : [];
      if (tmpl.length) {
        await HrOnboarding.bulkCreate(tmpl.map((task, i) => ({ employeeId: empId, task, order: i })));
        rows = await HrOnboarding.findAll({ where: { employeeId: empId }, order: [['order', 'ASC'], ['id', 'ASC']] });
      }
    }
    const list = rows.map((r) => r.toJSON());
    const done = list.filter((r) => r.done).length;
    res.json({ tasks: list, done, total: list.length, percent: list.length ? Math.round((done / list.length) * 100) : 0 });
  } catch (e) { next(e); }
});
router.post('/employees/:id/onboarding', requireHrAccess, requireScheduler, async (req, res, next) => {
  try {
    const empId = Number(req.params.id);
    const task = String((req.body || {}).task || '').slice(0, 200).trim();
    if (!task) return res.status(400).json({ error: 'Task text is required.' });
    const max = await HrOnboarding.max('order', { where: { employeeId: empId } });
    const row = await HrOnboarding.create({ employeeId: empId, task, order: (Number.isFinite(max) ? max : 0) + 1 });
    res.json(row.toJSON());
  } catch (e) { next(e); }
});
router.patch('/employees/:id/onboarding/:taskId', requireHrAccess, requireScheduler, async (req, res, next) => {
  try {
    const row = await HrOnboarding.findByPk(req.params.taskId);
    if (!row || row.employeeId !== Number(req.params.id)) return res.status(404).json({ error: 'Task not found.' });
    if ((req.body || {}).done !== undefined) { row.done = !!req.body.done; row.doneAt = row.done ? new Date() : null; row.doneById = row.done ? req.hrActor.id : null; }
    if ((req.body || {}).task !== undefined) row.task = String(req.body.task).slice(0, 200);
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});
router.delete('/employees/:id/onboarding/:taskId', requireHrAccess, requireScheduler, async (req, res, next) => {
  try {
    const row = await HrOnboarding.findByPk(req.params.taskId);
    if (!row || row.employeeId !== Number(req.params.id)) return res.status(404).json({ error: 'Task not found.' });
    await row.destroy();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- Reset an employee's password (admin only) ----
// ---- Dashboard: HR leaderboard ----
// Per-HR productivity: interviews scheduled ("candidates added") and candidates
// joined ("monthly hiring") — for today and this month — ranked, so the team
// can see who's leading.
router.get('/leaderboard', requireHrAccess, async (req, res, next) => {
  try {
    const users = await HrUser.findAll({ where: { active: true }, attributes: ['id', 'name', 'avatar', 'designation', 'type'] });
    const cands = await HrCandidate.findAll();
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const stat = new Map(); // id -> counters
    users.forEach((u) => stat.set(u.id, { id: u.id, name: u.name, avatar: u.avatar || null, designation: u.designation || '', scheduledToday: 0, scheduledMonth: 0, joinedToday: 0, joinedMonth: 0 }));
    const bump = (id, key) => { const s = stat.get(id); if (s) s[key] += 1; };
    const nameToId = new Map(users.map((u) => [u.name, u.id]));
    cands.forEach((c) => {
      // Interviews scheduled ("candidate added = scheduling").
      (c.interviews || []).forEach((iv) => {
        const at = iv.createdAt || iv.at;
        const id = iv.scheduledById || nameToId.get(iv.createdBy) || nameToId.get(iv.by);
        if (!id || !at) return;
        const ts = new Date(at).getTime();
        if (ts >= startOfMonth) bump(id, 'scheduledMonth');
        if (ts >= startOfDay) bump(id, 'scheduledToday');
      });
      // Candidates joined (accepted offer), credited to the recruiter.
      if (c.offer && c.offer.status === 'accepted') {
        const id = c.recruiterId || nameToId.get(c.recruiterName);
        const doneAt = (c.offer.offerLetter && c.offer.offerLetter.sentAt) || c.updatedAt;
        if (id && doneAt) {
          const ts = new Date(doneAt).getTime();
          if (ts >= startOfMonth) bump(id, 'joinedMonth');
          if (ts >= startOfDay) bump(id, 'joinedToday');
        }
      }
    });
    // Only include HR who scheduled or hired at least once this month (keeps it tidy).
    let rows = Array.from(stat.values()).filter((r) => r.scheduledMonth > 0 || r.joinedMonth > 0);
    // Rank by month scheduled, then month joined.
    rows.sort((a, b) => (b.scheduledMonth - a.scheduledMonth) || (b.joinedMonth - a.joinedMonth) || a.name.localeCompare(b.name));
    rows = rows.map((r, i) => ({ ...r, rank: i + 1 }));
    res.json({ rows, leader: rows[0] || null });
  } catch (e) { next(e); }
});

// ============================ SURVEYS ==============================
// Employee Mood pulse surveys. Admin creates/launches; all active employees
// respond; results are analysed monthly with Claude.

const DEFAULT_MOOD_QUESTIONS = [
  { id: 'q1', text: 'Our workplace is free from distraction', type: 'scale5', comment: true, options: [] },
];

const SURVEY_Q_TYPES = ['scale5', 'single_choice', 'multi_choice', 'short_answer'];
// Normalise an admin-supplied questions array into the stored shape. Each:
//   { id, text, type, comment(bool), options:[string] (choice types only) }
function sanitizeQuestions(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((q, i) => {
    const type = SURVEY_Q_TYPES.includes(q.type) ? q.type : 'scale5';
    const isChoice = type === 'single_choice' || type === 'multi_choice';
    const options = isChoice && Array.isArray(q.options)
      ? q.options.map((o) => String(o).slice(0, 160)).filter((o) => o.trim()).slice(0, 12)
      : [];
    return {
      id: q.id || `q${i + 1}`,
      text: String(q.text || '').slice(0, 300),
      type,
      comment: q.comment === true, // opt-in note box (default off for new types)
      options,
    };
  }).filter((q) => {
    if (!q.text.trim()) return false;
    // Choice questions must have at least two options to be usable.
    if ((q.type === 'single_choice' || q.type === 'multi_choice') && q.options.length < 2) return false;
    return true;
  });
}

// Current period key for a survey's frequency.
function surveyPeriodKey(frequency, d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  if (frequency === 'weekly') {
    // ISO-ish week: year + week number.
    const oneJan = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil((((d - oneJan) / 86400000) + oneJan.getDay() + 1) / 7);
    return `${y}-W${String(week).padStart(2, '0')}`;
  }
  if (frequency === 'one_time') return 'once';
  return `${y}-${m}`; // monthly (default)
}

// Roll a survey's period forward if its frequency window has elapsed. Returns
// the (possibly updated) survey.
async function ensureSurveyPeriod(survey) {
  if (survey.status !== 'active') return survey;
  const key = surveyPeriodKey(survey.frequency);
  if (survey.period !== key) {
    survey.period = key; survey.periodStartedAt = new Date();
    await survey.save();
  }
  return survey;
}

// --- Admin: list / create / update / close ---
router.get('/surveys', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const rows = await HrSurvey.findAll({ where: { active: true }, order: [['createdAt', 'DESC']] });
    for (const s of rows) await ensureSurveyPeriod(s);
    // Attach response counts for the current period.
    const out = [];
    for (const s of rows) {
      const count = await HrSurveyResponse.count({ where: { surveyId: s.id, period: s.period } });
      out.push({ ...s.toJSON(), responseCount: count });
    }
    res.json({ surveys: out });
  } catch (e) { next(e); }
});

router.post('/surveys', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'Survey name is required.' });
    const template = b.template === 'employee_mood' ? 'employee_mood' : 'employee_mood';
    const frequency = ['one_time', 'weekly', 'monthly'].includes(b.frequency) ? b.frequency : 'one_time';
    const questions = Array.isArray(b.questions) && b.questions.length
      ? (sanitizeQuestions(b.questions).length ? sanitizeQuestions(b.questions) : DEFAULT_MOOD_QUESTIONS)
      : DEFAULT_MOOD_QUESTIONS;
    const row = await HrSurvey.create({
      name: String(b.name).slice(0, 160), description: String(b.description || '').slice(0, 2000),
      template, frequency, questions, status: 'active',
      period: surveyPeriodKey(frequency), periodStartedAt: new Date(),
      createdById: req.hrActor.id, createdByName: req.hrActor.name,
    });
    hrLog(req, 'survey.launch', `${row.name} (${frequency})`);
    // Notify all active employees to complete it.
    try { const staff = await HrUser.findAll({ where: { active: true }, attributes: ['id'] }); for (const u of staff) await notify(u.id, { type: 'info', text: `📝 New survey: ${row.name} — please share your feedback.` }); } catch {}
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

router.put('/surveys/:id', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const row = await HrSurvey.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Survey not found.' });
    const b = req.body || {};
    if (b.name !== undefined) row.name = String(b.name).slice(0, 160);
    if (b.description !== undefined) row.description = String(b.description).slice(0, 2000);
    if (b.frequency !== undefined && ['one_time', 'weekly', 'monthly'].includes(b.frequency)) row.frequency = b.frequency;
    if (Array.isArray(b.questions)) { row.questions = sanitizeQuestions(b.questions); row.changed('questions', true); }
    if (b.status !== undefined && ['active', 'closed'].includes(b.status)) row.status = b.status;
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

router.delete('/surveys/:id', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const row = await HrSurvey.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Survey not found.' });
    row.active = false; row.status = 'closed'; await row.save();
    hrLog(req, 'survey.delete', row.name);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// --- Employee: surveys pending for me (this period, not yet answered) ---
router.get('/surveys/pending', requireHrAccess, async (req, res, next) => {
  try {
    // Admin viewing the portal isn't an employee; nothing pending.
    if (req.hrActor.kind === 'admin') return res.json({ pending: [] });
    const surveys = await HrSurvey.findAll({ where: { active: true, status: 'active' } });
    const pending = [];
    for (const s of surveys) {
      await ensureSurveyPeriod(s);
      const done = await HrSurveyResponse.count({ where: { surveyId: s.id, period: s.period, employeeId: req.hrActor.id } });
      if (!done) pending.push({ _id: s.id, name: s.name, description: s.description, questions: s.questions, frequency: s.frequency, period: s.period });
    }
    res.json({ pending });
  } catch (e) { next(e); }
});

// Generate adaptive follow-up questions mid-submission when the mood is low.
router.post('/surveys/:id/followups', requireHrAccess, async (req, res, next) => {
  try {
    const survey = await HrSurvey.findByPk(req.params.id);
    if (!survey) return res.status(404).json({ error: 'Survey not found.' });
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const key = s && s.getKey ? s.getKey('anthropic') : null;
    if (!key) return res.json({ questions: [] }); // AI not configured → skip follow-ups gracefully
    const answers = (req.body && req.body.answers) || {};
    const { followUpQuestions } = require('../services/hrSurveyAI');
    const questions = await followUpQuestions(key, { questions: survey.questions, answers });
    res.json({ questions });
  } catch (e) { res.json({ questions: [] }); }
});

// Submit my response. Computes avg, stores follow-ups, returns a personal
// AI-written success message.
router.post('/surveys/:id/respond', requireHrAccess, async (req, res, next) => {
  try {
    if (req.hrActor.kind === 'admin') return res.status(400).json({ error: 'Admins don’t submit survey responses.' });
    const survey = await HrSurvey.findByPk(req.params.id);
    if (!survey || survey.status !== 'active') return res.status(404).json({ error: 'This survey is not accepting responses.' });
    await ensureSurveyPeriod(survey);
    const already = await HrSurveyResponse.findOne({ where: { surveyId: survey.id, period: survey.period, employeeId: req.hrActor.id } });
    if (already) return res.status(409).json({ error: 'You’ve already responded to this survey for this period.' });

    const b = req.body || {};
    const raw = (b.answers && typeof b.answers === 'object') ? b.answers : {};
    // Normalise each answer to its question type so storage stays clean.
    const answers = {};
    for (const q of (survey.questions || [])) {
      const a = raw[q.id] || {};
      const entry = {};
      if (q.type === 'scale5') { const n = Number(a.score); if (Number.isFinite(n)) entry.score = n; }
      else if (q.type === 'single_choice') { if (a.choice != null) entry.choice = String(a.choice).slice(0, 160); }
      else if (q.type === 'multi_choice') { entry.choices = Array.isArray(a.choices) ? a.choices.map((c) => String(c).slice(0, 160)).slice(0, 12) : []; }
      else if (q.type === 'short_answer') { if (a.text != null) entry.text = String(a.text).slice(0, 2000); }
      if (q.comment && a.comment != null) entry.comment = String(a.comment).slice(0, 2000);
      answers[q.id] = entry;
    }
    const followups = Array.isArray(b.followups) ? b.followups.map((f) => ({ question: String(f.question || '').slice(0, 240), answer: String(f.answer || '').slice(0, 20) })) : [];

    // Response-behaviour signals (client-tracked). Derive per-question hesitation
    // relative to THIS person's own pace, so we can tell the AI where they paused
    // or heavily self-edited (a sign of diplomatic, guarded answers).
    const rawBeh = (b.behavior && typeof b.behavior === 'object') ? b.behavior : {};
    const perQ = {};
    const times = [];
    for (const q of (survey.questions || [])) {
      const x = rawBeh[q.id] || {};
      const e = {
        timeMs: Math.max(0, Math.round(Number(x.timeMs) || 0)),
        backspaces: Math.max(0, Math.round(Number(x.backspaces) || 0)),
        changes: Math.max(0, Math.round(Number(x.changes) || 0)),
      };
      perQ[q.id] = e;
      if (e.timeMs > 0) times.push(e.timeMs);
    }
    const avgTime = times.length ? times.reduce((a, c) => a + c, 0) / times.length : 0;
    // Flag questions where they lingered (>1.6x their own average) or self-edited
    // a lot (many backspaces / repeated selection changes).
    for (const q of (survey.questions || [])) {
      const e = perQ[q.id];
      e.slow = avgTime > 0 && e.timeMs >= avgTime * 1.6 && e.timeMs > 4000;
      e.heavyEdit = e.backspaces >= 15 || e.changes >= 3;
      e.hesitation = !!(e.slow || e.heavyEdit);
    }
    const behavior = { perQuestion: perQ, avgTimeMs: Math.round(avgTime), flagged: Object.entries(perQ).filter(([, e]) => e.hesitation).map(([qid]) => qid) };

    // Average of the scale scores only (choice/short-answer have no numeric value).
    const scores = (survey.questions || []).filter((q) => q.type === 'scale5').map((q) => Number((answers[q.id] || {}).score)).filter((n) => Number.isFinite(n));
    const avgScore = scores.length ? scores.reduce((a, c) => a + c, 0) / scores.length : null;
    const hasLow = scores.some((n) => n <= 3);

    const me = req.hrUser;
    const row = await HrSurveyResponse.create({
      surveyId: survey.id, period: survey.period, employeeId: me.id, employeeName: me.name,
      department: me.department || '', branch: me.branch || '',
      answers, followups, avgScore, behavior,
    });

    // Personal, AI-written thank-you (best-effort).
    let message = `Thank you, ${(me.name || '').split(' ')[0]}. Your feedback truly helps us improve.`;
    try {
      const s = await Settings.findOne({ where: { singleton: 'settings' } });
      const key = s && s.getKey ? s.getKey('anthropic') : null;
      if (key) { const { successMessage } = require('../services/hrSurveyAI'); message = await successMessage(key, { employeeName: me.name, avgScore, sentimentLabel: hasLow ? 'low' : 'ok', hasLowScores: hasLow }); }
    } catch {}
    res.json({ ok: true, id: row.id, message });
  } catch (e) { next(e); }
});

// --- Results & sentiment analysis (admin) ---
// List the periods that have responses, for the period picker.
router.get('/surveys/:id/periods', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const rows = await HrSurveyResponse.findAll({ where: { surveyId: req.params.id }, attributes: ['period'], group: ['period'], order: [['period', 'DESC']] });
    res.json({ periods: rows.map((r) => r.period).filter(Boolean) });
  } catch (e) { next(e); }
});

// Results for a survey + period: sentiment split, top points, dept/branch
// breakdown. Pass ?analyze=1 to (re)run the AI; otherwise returns cached.
router.get('/surveys/:id/results', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const survey = await HrSurvey.findByPk(req.params.id);
    if (!survey) return res.status(404).json({ error: 'Survey not found.' });
    const period = req.query.period || survey.period;
    const responses = await HrSurveyResponse.findAll({ where: { surveyId: survey.id, period } });
    const total = responses.length;
    const analysis = (survey.analysis && survey.analysis[period]) || null;
    // Sentiment split from stored per-response reads.
    const tally = (list) => { const t = { positive: 0, neutral: 0, negative: 0 }; list.forEach((r) => { const l = r.sentiment && r.sentiment.label; if (t[l] != null) t[l] += 1; }); return t; };
    const withSent = responses.filter((r) => r.sentiment && r.sentiment.label);
    const counts = tally(withSent);
    const pct = (n) => withSent.length ? Math.round((n / withSent.length) * 100) : 0;
    // Group helper for dept/branch splits.
    const groupBy = (keyFn) => {
      const g = {};
      responses.forEach((r) => { const k = keyFn(r) || '—'; (g[k] = g[k] || []).push(r); });
      return Object.entries(g).map(([k, list]) => {
        const c = tally(list.filter((r) => r.sentiment && r.sentiment.label));
        const n = list.filter((r) => r.sentiment && r.sentiment.label).length;
        const avg = list.filter((r) => r.avgScore != null);
        return { key: k, count: list.length, avgScore: avg.length ? +(avg.reduce((a, r) => a + r.avgScore, 0) / avg.length).toFixed(2) : null,
          positive: n ? Math.round(c.positive / n * 100) : 0, neutral: n ? Math.round(c.neutral / n * 100) : 0, negative: n ? Math.round(c.negative / n * 100) : 0 };
      }).sort((a, b) => b.count - a.count);
    };
    // Per-response detail for the admin table (name, sentiment, and where the
    // employee hesitated — surfaced from the behaviour signals).
    const responseDetail = responses.map((r) => {
      const beh = r.behavior || {};
      const flagged = Array.isArray(beh.flagged) ? beh.flagged : [];
      const flaggedQ = flagged.map((qid) => { const q = (survey.questions || []).find((x) => x.id === qid); return q ? q.text : null; }).filter(Boolean);
      return {
        _id: r.id, employeeName: r.employeeName, department: r.department, branch: r.branch,
        avgScore: r.avgScore, sentiment: r.sentiment || null,
        hesitationCount: flagged.length, hesitationQuestions: flaggedQ,
      };
    });
    res.json({
      survey: { _id: survey.id, name: survey.name, frequency: survey.frequency, questions: survey.questions },
      period, total, analysed: withSent.length,
      sentiment: { positive: pct(counts.positive), neutral: pct(counts.neutral), negative: pct(counts.negative) },
      good: analysis ? analysis.good : [], improve: analysis ? analysis.improve : [], summary: analysis ? analysis.summary : '',
      byDepartment: groupBy((r) => r.department), byBranch: groupBy((r) => r.branch),
      responses: responseDetail,
      analysedAt: analysis ? analysis.at : null,
    });
  } catch (e) { next(e); }
});

// Run the AI analysis for a survey + period: per-response sentiment + aggregate.
router.post('/surveys/:id/analyze', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const survey = await HrSurvey.findByPk(req.params.id);
    if (!survey) return res.status(404).json({ error: 'Survey not found.' });
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const key = s && s.getKey ? s.getKey('anthropic') : null;
    if (!key) return res.status(400).json({ error: 'AI isn’t configured. Add an Anthropic API key in CRM Admin → API keys.' });
    const period = req.body && req.body.period ? req.body.period : survey.period;
    const responses = await HrSurveyResponse.findAll({ where: { surveyId: survey.id, period } });
    if (!responses.length) return res.status(400).json({ error: 'No responses to analyse for this period yet.' });
    const { analyseResponse, aggregateAnalysis } = require('../services/hrSurveyAI');
    // 1) Per-response sentiment (only those not yet analysed, to save calls).
    for (const r of responses) {
      if (r.sentiment && r.sentiment.label) continue;
      try {
        const sent = await analyseResponse(key, { questions: survey.questions, answers: r.answers, followups: r.followups, avgScore: r.avgScore, behavior: r.behavior });
        r.sentiment = sent; r.changed('sentiment', true); await r.save();
      } catch {}
    }
    // 2) Aggregate good/improve/summary.
    const blobs = responses.map((r) => {
      const txt = (survey.questions || []).map((q) => {
        const a = (r.answers || {})[q.id] || {};
        let ans = '—';
        if (q.type === 'scale5') ans = a.score != null ? `${a.score}/5` : '—';
        else if (q.type === 'single_choice') ans = a.choice != null ? a.choice : '—';
        else if (q.type === 'multi_choice') ans = Array.isArray(a.choices) && a.choices.length ? a.choices.join(', ') : '—';
        else if (q.type === 'short_answer') ans = a.text || '—';
        return `${q.text}: ${ans}${a.comment ? ` — "${a.comment}"` : ''}`;
      }).join('; ');
      const fu = (r.followups || []).map((f) => `${f.question} → ${f.answer}`).join('; ');
      return { department: r.department, branch: r.branch, avgScore: r.avgScore, sentiment: r.sentiment && r.sentiment.label, text: txt + (fu ? ` | Follow-ups: ${fu}` : '') };
    });
    let agg = { good: [], improve: [], summary: '' };
    try { agg = await aggregateAnalysis(key, { surveyName: survey.name, blobs }); } catch (e) { /* keep sentiment even if summary fails */ }
    const nextAnalysis = { ...(survey.analysis || {}) };
    nextAnalysis[period] = { at: new Date().toISOString(), good: agg.good, improve: agg.improve, summary: agg.summary };
    survey.analysis = nextAnalysis; survey.changed('analysis', true); await survey.save();
    hrLog(req, 'survey.analyze', `${survey.name} (${period})`);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.scoreResumeMatchBg = scoreResumeMatchBg;
module.exports.notify = notify;

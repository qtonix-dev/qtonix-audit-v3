/**
 * HR module API — mounted at /api/hr. Completely separate from the Site
 * Analysis / CRM routes. Access is HR-staff-or-admin only (see hrAuth).
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { Op, HrUser, HrBranch, HrDepartment, HrShift, HrHoliday, HrJobPost, HrCandidate, HrNotification, HrAnnouncement, HrFeedback, HrVendor, HrExpense, HrOnboarding, HrOnboardingTask, HrAttendance, HrLeave, HrLateCheck, HrSurvey, HrSurveyResponse, HrDirectorProfile, HrEmail, User, AuditLog, Settings, CrmEmailLog } = require('../models');
const { signHr, requireHrAccess, requireHrAdmin, requireScheduler, requireHrManager, requireJobPoster, canViewInternal, canManageBranch } = require('../middleware/hrAuth');
const imagekit = require('../services/imagekit');
const { resolveHolidayEmojis } = require('../services/holidayEmoji');

const router = express.Router();

// Resolve the "assigned HR" email list for a candidate, used to CC HR on every
// candidate-facing email so they can see what's sent. Combines the candidate's
// recruiter (if any) with the job's assigned HR staff. De-duplicated; excludes
// the recruitment mailbox itself and the candidate's own address.
async function assignedHrCc(candidate, { excludeEmail } = {}) {
  const emails = new Set();
  try {
    if (candidate.recruiterId) {
      const u = await HrUser.findByPk(candidate.recruiterId);
      if (u && u.email) emails.add(u.email.toLowerCase());
    }
    if (candidate.jobPostId) {
      const job = await HrJobPost.findByPk(candidate.jobPostId);
      const ids = (job && Array.isArray(job.assignedHrIds)) ? job.assignedHrIds : [];
      if (ids.length) {
        const staff = await HrUser.findAll({ where: { id: { [Op.in]: ids } } });
        staff.forEach((u) => { if (u.email) emails.add(u.email.toLowerCase()); });
      }
    }
  } catch (e) { console.error('[cc] resolve assigned HR failed:', e.message); }
  if (excludeEmail) emails.delete(String(excludeEmail).toLowerCase());
  if (candidate.email) emails.delete(String(candidate.email).toLowerCase());
  return Array.from(emails);
}

const USER_TYPES = ['hr', 'recruiter', 'manager', 'tl', 'senior', 'junior', 'trainee', 'intern', 'employee'];

// Resolve the recruitment mailbox address: the legacy single hrMailbox if set,
// else the 'default' (or first) entry from the hrMailboxes list. Mirrors the
// resilient lookup used by the careers auto-emails.
function mailboxEmail(s) {
  if (s && s.hrMailbox && s.hrMailbox.email) return s.hrMailbox.email;
  const list = (s && Array.isArray(s.hrMailboxes)) ? s.hrMailboxes : [];
  const def = list.find((m) => m.id === 'default') || list[0];
  return (def && def.email) || '';
}

// Send an HR email AND record it to CrmEmailLog so it shows in Admin → Emails
// (last activity + the activity popup). Delegates to the shared hrEmailLog
// service; each send gets a unique dedupeKey so repeat sends are all logged.
async function sendHrEmailLogged(s, token, mailbox, msg, opts = {}) {
  const { sendAndLog } = require('../services/hrEmailLog');
  return sendAndLog(s, token, mailbox, msg, opts);
}

// Pre-shortlist pipeline stages — moving INTO one of these never triggers the
// "resume shortlisted" email. Anything beyond these (interview, offered, hired,
// or a custom later stage) means the candidate has passed the Contacted stage.
const PRE_SHORTLIST_STAGES = new Set(['sourced', 'source', 'applied', 'contacted', 'rejected', 'reject', 'declined', 'disqualified']);

// Send the "resume shortlisted for interview" auto-email (best-effort). Sets the
// shortlistEmailSent flag on success so it only ever goes out once. Returns true
// if emailed.
async function sendShortlistEmail(row, hrActor) {
  if (!row.email || row.shortlistEmailSent) return false;
  try {
    const gmail = require('../services/gmail');
    const hrEmail = require('../services/hrEmailTemplate');
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const token = s && s.getKey ? s.getKey('hrMailboxToken') : null;
    const mailbox = mailboxEmail(s);
    if (!token || !mailbox) return false;
    const job = row.jobPostId ? await HrJobPost.findByPk(row.jobPostId) : null;
    const sig = await rejectSignature(hrActor, mailbox);
    const bodyHtml = hrEmail.shortlistedEmail({ candidateName: row.name, role: job ? job.title : '', signature: sig });
    const cc = await assignedHrCc(row, { excludeEmail: mailbox });
    await sendHrEmailLogged(s, token, mailbox, { from: mailbox, to: row.email, cc, subject: `You've been shortlisted${job ? ` — ${job.title}` : ''}`, bodyHtml }, { type: 'hr_shortlisted' });
    row.shortlistEmailSent = true;
    return true;
  } catch (e) { console.error('[shortlist] email failed:', e.message); return false; }
}

// Signature block for a rejection email from the acting HR person.
async function rejectSignature(hrActor, mailbox) {
  let email = mailbox || 'career@qtonix.com';
  let name = (hrActor && hrActor.name) || 'Qtonix Recruitment Team';
  let title = 'Talent Acquisition · Qtonix';
  try {
    if (hrActor && hrActor.kind === 'hr') {
      const u = await HrUser.findByPk(hrActor.id);
      if (u) { name = u.name || name; if (u.designation) title = `${u.designation} · Qtonix`; if (u.email) email = u.email; }
    } else if (hrActor && hrActor.kind === 'admin') {
      const u = await User.findByPk(hrActor.id);
      if (u && u.email) email = u.email;
    }
  } catch {}
  return { name, title, email };
}
// Roles that count as "HR staff" for edit permissions on locked profile
// sections (payroll, performance, identity). Everyone else is view-only there.
const HR_STAFF_TYPES = ['hr', 'recruiter'];

// Normalize a person's name to "First Middle Last" casing so names are stored
// uniformly (e.g. "SANDEEP KUMAR SWAIN" → "Sandeep Kumar Swain"). Preserves
// intra-word punctuation (O'Brien, Jean-Paul) and common lowercase particles.
function titleCaseName(raw) {
  const s = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!s) return s;
  const small = new Set(['de', 'da', 'van', 'von', 'der', 'bin', 'al', 'la', 'le']);
  return s.split(' ').map((word, i) => word.split('-').map((part) => {
    if (!part) return part;
    const lower = part.toLowerCase();
    if (i > 0 && small.has(lower)) return lower;
    // Handle O'Brien / D'Souza
    return lower.replace(/(^|['’])([a-z\u00C0-\u024F])/g, (m, p1, p2) => p1 + p2.toUpperCase());
  }).join('-')).join(' ');
}


// A candidate is considered hired/onboarded if their pipeline stage is a hired
// stage OR they have an accepted offer. This covers both workflows: HR moving
// the candidate's stage directly to "Hired", and completing the offer flow.
// Custom job pipelines may use variants like 'onboarded'/'joined', so accept
// those stage ids too.
const HIRED_STAGE_IDS = new Set(['hired', 'onboarded', 'joined', 'selected']);
function isHiredCandidate(c) {
  if (!c) return false;
  const stage = String(c.stage || '').toLowerCase();
  if (HIRED_STAGE_IDS.has(stage)) return true;
  if (c.offer && c.offer.status === 'accepted') return true;
  return false;
}

// Normalise a joining date from any stored/entered format to yyyy-mm-dd.
// India is day-first, so a slash/dash numeric date is treated as DD/MM/YYYY
// unless the first part is clearly a month indicator. Returns '' if unparseable.
function normalizeJoiningYmd(v) {
  if (!v) return '';
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); // ISO / ISO datetime
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/); // DD/MM/YYYY (India) or MM/DD/YYYY
  if (m) {
    let a = Number(m[1]), b = Number(m[2]); const y = m[3];
    let day, mon;
    if (a > 12) { day = a; mon = b; } else if (b > 12) { mon = a; day = b; } else { day = a; mon = b; }
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) return `${y}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const d = new Date(s); // fallback: engine parse (ISO datetime, GMT string, etc.)
  if (!isNaN(d.getTime())) {
    const ist = new Date(d.getTime() + 330 * 60000);
    return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')}`;
  }
  return '';
}

// Normalise a phone to +91XXXXXXXXXX for a 10-digit Indian mobile; keep an
// existing country code otherwise. Deterministic (no network needed).
function normalizePhoneServer(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  if (s.startsWith('+')) { const d = s.slice(1).replace(/\D/g, ''); return d ? `+${d}` : ''; }
  const digits = s.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`;
  return `+${digits}`;
}

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
router.get('/me', requireHrAccess, async (req, res, next) => {
  try {
    if (req.hrActor.kind === 'admin') {
      return res.json({ _id: req.adminUser.id, name: req.adminUser.name, type: 'admin', isAdmin: true, isHrManager: false, hasReports: true });
    }
    // hasReports → does anyone report to this user? Drives whether the
    // Recognition menu item is shown (seniors with a team see it).
    const reportCount = await HrUser.count({ where: { reportsToId: req.hrUser.id, active: true } });
    res.json({ ...req.hrUser.toJSON(), isAdmin: false, isHrManager: req.isHrManager, hrManagerScope: req.hrManagerScope, hrManagerAll: req.hrManagerAll, hasReports: reportCount > 0, completion: profileCompletion(req.hrUser) });
  } catch (e) { next(e); }
});

// --- Dashboard --------------------------------------------------------------

/** GET /api/hr/dashboard — minimal figures for the HR dashboard scaffold. */
// Recently added (any source) and recently submitted (careers page) candidates
// for the HR dashboard notification box. Returns up to 5 of each.
router.get('/recent-candidates', requireHrAccess, async (req, res, next) => {
  try {
    const jobs = await HrJobPost.findAll({ attributes: ['id', 'title'] });
    const jobTitle = (id) => { const j = jobs.find((x) => x.id === id); return j ? j.title : ''; };
    const shape = (c) => ({ _id: c.id, name: c.name, jobPostId: c.jobPostId, jobTitle: jobTitle(c.jobPostId), recruiterName: c.recruiterName || '', source: c.source, createdAt: c.createdAt, stage: c.stage });
    const added = await HrCandidate.findAll({ order: [['createdAt', 'DESC']], limit: 5 });
    const submitted = await HrCandidate.findAll({ where: { source: { [Op.in]: ['public_form', 'careers_page'] } }, order: [['createdAt', 'DESC']], limit: 5 });
    res.json({ added: added.map(shape), submitted: submitted.map(shape) });
  } catch (e) { next(e); }
});

router.get('/dashboard', requireHrAccess, async (req, res, next) => {
  try {
    // The HR dashboard (recruitment/people overview) is for HR staff + admins
    // only. A non-HR employee (e.g. a Sales manager) gets the employee
    // dashboard instead and must not read HR-wide figures.
    if (!(req.hrActor.kind === 'admin' || req.isHrRole || req.isHrManager)) {
      return res.status(403).json({ error: 'The HR dashboard is only available to HR staff.' });
    }
    const [staff, openJobs, candidates, allCands] = await Promise.all([
      HrUser.count({ where: { active: true } }),
      HrJobPost.count({ where: { status: 'open' } }),
      HrCandidate.count(),
      HrCandidate.findAll({ attributes: ['stage', 'offer'] }),
    ]);
    // A candidate counts as hired/onboarded when their stage is a hired stage OR
    // they have an accepted offer — either path HR uses should be reflected.
    const onboarded = allCands.filter(isHiredCandidate).length;
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
      graceMinutes: Number.isFinite(Number(b.graceMinutes)) ? Number(b.graceMinutes) : 20,
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
    if (b.graceMinutes !== undefined && Number.isFinite(Number(b.graceMinutes))) row.graceMinutes = Number(b.graceMinutes);
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
    // Attach a relevant emoji per holiday (cached; AI-filled when a key exists).
    let emojiByName = {};
    try {
      const s = await Settings.findOne({ where: { singleton: 'settings' } });
      const apiKey = s && s.getKey ? s.getKey('openai') : null;
      const names = [...new Set(rows.map((h) => h.name))];
      emojiByName = await resolveHolidayEmojis(names, { settings: s, apiKey });
    } catch {}
    res.json(rows.map((h) => ({ ...h.toJSON(), emoji: emojiByName[h.name] || '📅' })));
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
    if (req.body && req.body.address !== undefined) row.address = String(req.body.address).slice(0, 500);
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
    // Respect the HR-side "hidden" flag so admins removed from the HR employee
    // list also disappear from reporting options and the org chart.
    const hiddenIds = new Set((await HrDirectorProfile.findAll({ where: { hidden: true }, attributes: ['userId'] })).map((o) => o.userId));
    const visibleAdmins = admins.filter((a) => !hiddenIds.has(a.id));
    res.json({
      hr: hr.map((h) => ({ id: h.id, name: h.name, type: h.type, designation: h.designation })),
      admins: visibleAdmins.map((a) => ({ id: a.id, name: a.name })),
    });
  } catch (e) { next(e); }
});

router.get('/users', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const rows = await HrUser.findAll({ order: [['createdAt', 'DESC']] });
    res.json(rows.map((u) => ({ ...u.toJSON(), completion: profileCompletion(u) })));
  } catch (e) { next(e); }
});

// GET /api/hr/users/:id — full record for one HR user, used to populate the edit
// form (the directory list is trimmed and omits many fields). Admin/manager.
router.get('/users/:id', requireHrAccess, requireScheduler, async (req, res, next) => {
  try {
    const u = await HrUser.findByPk(req.params.id);
    if (!u) return res.status(404).json({ error: 'Employee not found.' });
    res.json({ ...u.toJSON(), completion: profileCompletion(u) });
  } catch (e) { next(e); }
});

/**
 * GET /api/hr/employees — directory of all HR staff with completion %. Powers
 * the top-level "Employee" menu. Available to any HR user (read-only list).
 */
router.get('/employees', requireHrAccess, async (req, res, next) => {
  try {
    const rows = await HrUser.findAll({ order: [['name', 'ASC']] });
    let list = rows.map((u) => ({
      _id: u.id, id: u.id, name: u.name, employeeId: u.employeeId, email: u.email,
      type: u.type, designation: u.designation, branch: u.branch, department: u.department,
      avatar: u.avatar, active: u.active, completion: profileCompletion(u),
      shiftId: u.shiftId, isHrManager: u.isHrManager, hrManagerScope: u.hrManagerScope || '',
      branchIncharge: u.branchIncharge, targets: u.targets, canPostAnnouncements: u.canPostAnnouncements,
      phone: u.phone, joiningDate: u.joiningDate,
    }));
    // ?hrDept=1 → only employees in the Human Resources department (used wherever
    // an HR/recruiter must be picked). Directors/CRM admins are excluded.
    if (['1', 'true', 'yes'].includes(String(req.query.hrDept || '').toLowerCase())) {
      const isHrDept = (u) => /^(hr|human resources|human resource)$/i.test(String(u.department || '').trim());
      return res.json(list.filter((u) => u.active !== false && isHrDept(u)));
    }
    // Also surface CRM admins as "Directors" so HR can pick them as interview
    // panelists. Their HRMS-side details come from the overlay table (their CRM
    // name may be a sales alias), falling back to the CRM record.
    const admins = await User.findAll({ where: { role: 'admin', active: true }, attributes: ['id', 'name', 'email'], order: [['name', 'ASC']] });
    const overlays = await HrDirectorProfile.findAll();
    const byUser = {}; overlays.forEach((o) => { byUser[o.userId] = o; });
    // Prune overlays whose CRM admin no longer exists (deleted in CRM), so stale
    // director rows don't linger in the HR list.
    const liveAdminIds = new Set(admins.map((a) => a.id));
    const orphanIds = overlays.filter((o) => !liveAdminIds.has(o.userId)).map((o) => o.userId);
    if (orphanIds.length) { try { await HrDirectorProfile.destroy({ where: { userId: { [Op.in]: orphanIds } } }); } catch {} }
    admins.forEach((a) => {
      const o = byUser[a.id];
      if (o && o.hidden) return; // manually removed from the HR list
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

// Remove a director from the HR employee list (does NOT touch their CRM login —
// they simply no longer appear as an HR "Director"/panelist). Admin only.
router.delete('/directors/:userId', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const userId = Number(req.params.userId);
    const [row] = await HrDirectorProfile.findOrCreate({ where: { userId }, defaults: { userId } });
    row.hidden = true; await row.save();
    hrLog(req, 'director.hide', row.name || String(userId));
    res.json({ ok: true });
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
    const canEditLocked = req.isHrAdmin || req.isHrManager || (req.hrUser && HR_STAFF_TYPES.includes(req.hrUser.type));
    const row = await HrUser.findByPk(id);
    if (!row) return res.status(404).json({ error: 'Profile not found.' });
    // A department head (manager/TL) may view profiles of people in their own
    // department, so they can give recognition/reviews.
    const canReviewThis = await canReviewEmployee(req, row);
    if (!canEditLocked && !isSelf && !canReviewThis) {
      return res.status(403).json({ error: 'You can only view your own profile.' });
    }
    const shift = row.shiftId ? await HrShift.findByPk(row.shiftId) : null;
    // Payroll/compensation may be edited by Admin, HR staff (hr/recruiter), and
    // HR Managers WITHIN THEIR BRANCH SCOPE (all-branch managers → everyone).
    const canEditPayroll = req.isHrAdmin || req.isHrManager || (req.hrUser && HR_STAFF_TYPES.includes(req.hrUser.type));
    res.json({ ...row.toJSON(), completion: profileCompletion(row), canEditLocked, canEditPayroll, canReview: canReviewThis, canEditSelf: isSelf || canEditLocked, shift: shift ? shift.toJSON() : null });
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
    const canEditLocked = req.isHrAdmin || req.isHrManager || (req.hrUser && HR_STAFF_TYPES.includes(req.hrUser.type));
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
      const openSections = ['personal', 'documents', 'bank', 'education', 'employment', 'hiringDocs'];
      // Sections only Admin or an HR Manager may edit (payroll, performance
      // cards, salary history, attendance and leave live in dedicated endpoints).
      const lockedSections = ['payroll', 'performance', 'payrollHistory', 'performanceCards'];
      // Payroll/compensation may be edited by Admin, HR Managers, and HR staff
      // (hr/recruiter) — the people who actually maintain compensation records.
      // Payroll/compensation may be edited by Admin, HR staff (hr/recruiter),
      // and HR Managers (the people who maintain compensation records).
      const canEditPayroll = req.isHrAdmin || req.isHrManager || (req.hrUser && HR_STAFF_TYPES.includes(req.hrUser.type));
      const merged = { ...current };
      openSections.forEach((s) => { if (incoming[s] !== undefined) merged[s] = incoming[s]; });
      lockedSections.forEach((s) => {
        if (incoming[s] !== undefined) {
          if (canEditPayroll) merged[s] = incoming[s];
          // else silently ignore — only admins/HR managers change these.
        }
      });
      row.profile = merged; row.changed('profile', true);
    }
    await row.save();
    const canEditPayrollResp = req.isHrAdmin || req.isHrManager || (req.hrUser && HR_STAFF_TYPES.includes(req.hrUser.type));
    res.json({ ...row.toJSON(), completion: profileCompletion(row), canEditLocked, canEditPayroll: canEditPayrollResp, canEditSelf: isSelf || canEditLocked });
  } catch (e) { next(e); }
});

// ===== Badges & Performance recognition =====
// Named appreciation badges a senior can award. Auto-badge ids (tenure/
// punctuality milestones) are defined in jobs/badges.js and share this shape.
const BADGE_CATALOG = [
  { id: 'customer_hero', name: 'Customer Hero', icon: '⭐', color: '#F59E0B', desc: 'Outstanding customer care' },
  { id: 'above_beyond', name: 'Above & Beyond', icon: '🚀', color: '#2563EB', desc: 'Went the extra mile' },
  { id: 'team_player', name: 'Team Player', icon: '🤝', color: '#0EA5E9', desc: 'Great collaboration & support' },
  { id: 'innovator', name: 'Innovator', icon: '💡', color: '#7C3AED', desc: 'Fresh ideas that made a difference' },
  { id: 'problem_solver', name: 'Problem Solver', icon: '🧩', color: '#16A34A', desc: 'Cracked a tough problem' },
  { id: 'quick_learner', name: 'Quick Learner', icon: '📚', color: '#DB2777', desc: 'Picked things up fast' },
  { id: 'reliable', name: 'Ever Reliable', icon: '🛡️', color: '#475569', desc: 'Consistently dependable' },
  { id: 'star_performer', name: 'Star Performer', icon: '🌟', color: '#EA580C', desc: 'Standout results this period' },
];
function badgeById(id) { return BADGE_CATALOG.find((b) => b.id === id) || null; }

// Can this actor give a performance card to `emp`? HR staff/admins always can.
// A senior can recognize/review only the employees who report to them —
// directly, or anywhere down their reporting line (their reports' reports too).
// This is async because it may walk the reporting chain upward from emp.
async function canReviewEmployee(req, emp) {
  if (req.isHrAdmin || req.isHrManager) return true;
  const actor = req.hrUser;
  if (!actor || !emp) return false;
  if (HR_STAFF_TYPES.includes(actor.type)) return true; // hr / recruiter
  if (actor.id === emp.id) return false;                // can't review yourself
  // Walk up emp's reporting chain — if the actor is anywhere above emp, they're
  // a senior of this employee and may review them.
  let cur = emp; let hops = 0; const seen = new Set([emp.id]);
  while (cur && cur.reportsToId && hops < 8) {
    if (cur.reportsToId === actor.id) return true;      // actor is in emp's chain
    if (seen.has(cur.reportsToId)) break;
    seen.add(cur.reportsToId);
    cur = await HrUser.findByPk(cur.reportsToId);
    if (!cur) break;
    hops += 1;
  }
  return false;
}

// GET the badge catalog (for the "give appreciation" picker).
router.get('/badges/catalog', requireHrAccess, async (req, res) => {
  res.json({ badges: BADGE_CATALOG });
});

// People the current actor may recognize/review, for the Recognition page and
// the dashboard card. HR/admin → everyone active; a senior → their reporting
// line (direct + indirect reports). Also returns recent recognition activity.
router.get('/recognition/team', requireHrAccess, async (req, res, next) => {
  try {
    const active = await HrUser.findAll({ where: { active: true }, order: [['name', 'ASC']] });
    const canAll = req.isHrAdmin || req.isHrManager || (req.hrUser && HR_STAFF_TYPES.includes(req.hrUser.type));
    let team = [];
    if (canAll) {
      team = active.filter((u) => !(req.hrUser && u.id === req.hrUser.id));
    } else if (req.hrUser) {
      // Build the set of everyone below this actor in the reporting tree.
      const byManager = {};
      for (const u of active) { if (u.reportsToId) (byManager[u.reportsToId] = byManager[u.reportsToId] || []).push(u); }
      const out = []; const seen = new Set(); const stack = [...(byManager[req.hrUser.id] || [])];
      while (stack.length) { const u = stack.pop(); if (seen.has(u.id)) continue; seen.add(u.id); out.push(u); (byManager[u.id] || []).forEach((c) => stack.push(c)); }
      team = out;
    }
    const teamOut = team.map((u) => ({ id: u.id, name: u.name, designation: u.designation || '', department: u.department || '', avatar: u.avatar || '', badges: ((u.profile || {}).performanceCards || []).filter((c) => c.kind === 'praise').length }));
    // Recent recognition across the visible team (last 20 appreciations).
    const recent = [];
    for (const u of team) {
      for (const c of ((u.profile || {}).performanceCards || [])) {
        if (c.kind === 'praise') recent.push({ employeeId: u.id, employeeName: u.name, badge: c.badge || null, title: c.title || '', by: c.by || '', byRole: c.byRole || '', date: c.date, auto: !!c.auto });
      }
    }
    recent.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    res.json({ canReviewAnyone: canAll, team: teamOut, recent: recent.slice(0, 20) });
  } catch (e) { next(e); }
});

// The logged-in employee's OWN recognition — counts + full list, for the
// dashboard card and its "view all" popup.
router.get('/me/recognition', requireHrAccess, async (req, res, next) => {
  try {
    if (!req.hrUser) return res.json({ counts: { praise: 0, review: 0, yellow: 0, red: 0 }, badges: [], cards: [] });
    const me = await HrUser.findByPk(req.hrUser.id);
    const cards = ((me && me.profile && me.profile.performanceCards) || []).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const counts = { praise: 0, review: 0, yellow: 0, red: 0 };
    for (const c of cards) { if (counts[c.kind] !== undefined) counts[c.kind]++; }
    const badges = cards.filter((c) => c.badge || (c.kind === 'praise' && c.badgeId)).map((c) => ({ icon: (c.badge && c.badge.icon) || '🌟', name: (c.badge && c.badge.name) || c.title || 'Appreciation', color: (c.badge && c.badge.color) || '#EA580C', by: c.auto ? 'Auto' : c.by, date: c.date, auto: !!c.auto }));
    res.json({ counts, badges, cards });
  } catch (e) { next(e); }
});

// Counts + recent-3 for ONE employee (shown in the give-recognition popup once
// a senior selects someone). Same permission as reviewing them.
router.get('/employees/:id/recognition-summary', requireHrAccess, async (req, res, next) => {
  try {
    const emp = await HrUser.findByPk(Number(req.params.id));
    if (!emp) return res.status(404).json({ error: 'Employee not found.' });
    if (!(await canReviewEmployee(req, emp))) return res.status(403).json({ error: 'Not allowed.' });
    const cards = ((emp.profile || {}).performanceCards || []).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const counts = { praise: 0, review: 0, yellow: 0, red: 0 };
    for (const c of cards) { if (counts[c.kind] !== undefined) counts[c.kind]++; }
    const recent = cards.slice(0, 3).map((c) => ({ kind: c.kind, title: c.title || '', badge: c.badge || null, by: c.auto ? 'System' : (c.by || 'HR'), byRole: c.auto ? 'Automatic' : (c.byRole || ''), date: c.date, auto: !!c.auto }));
    res.json({ counts, recent });
  } catch (e) { next(e); }
});

// ALL recognition across the company — for admins and HR managers. Branch-scoped
// HR managers see only their branch. Supports filters + pagination.
router.get('/recognition/all', requireHrAccess, async (req, res, next) => {
  try {
    const canAll = req.isHrAdmin || req.hrManagerAll;
    const scopedBranch = (!canAll && req.isHrManager) ? (req.hrManagerScope && req.hrManagerScope !== 'all' ? req.hrManagerScope : req.hrBranch) : '';
    // Only admins and HR managers may see the company-wide log.
    if (!(req.isHrAdmin || req.isHrManager)) return res.status(403).json({ error: 'Only HR managers and admins can view all recognition.' });
    const q = req.query || {};
    const typeF = ['praise', 'review', 'yellow', 'red'].includes(q.type) ? q.type : '';
    const branchF = canAll ? String(q.branch || '') : scopedBranch;   // scoped managers are locked to their branch
    const deptF = String(q.department || '').trim().toLowerCase();
    const giverF = String(q.givenBy || '').trim().toLowerCase();
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(q.from)) ? q.from : '';
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(q.to)) ? q.to : '';
    const page = Math.max(1, parseInt(q.page, 10) || 1);
    const perPage = 12;

    const emps = await HrUser.findAll({ where: { active: true } });
    const branches = [...new Set(emps.map((e) => e.branch).filter(Boolean))].sort();
    const departments = [...new Set(emps.map((e) => e.department).filter(Boolean))].sort();
    const givers = new Set();
    let rows = [];
    for (const e of emps) {
      if (scopedBranch && String(e.branch || '') !== scopedBranch) continue;         // branch scope
      if (branchF && String(e.branch || '') !== branchF) continue;
      if (deptF && String(e.department || '').trim().toLowerCase() !== deptF) continue;
      for (const c of ((e.profile || {}).performanceCards || [])) {
        if (c.by && !c.auto) givers.add(c.by);
        if (typeF && c.kind !== typeF) continue;
        if (giverF && String(c.by || '').trim().toLowerCase() !== giverF) continue;
        if (from && String(c.date || '') < from) continue;
        if (to && String(c.date || '') > to) continue;
        rows.push({
          id: c.id, employeeId: e.id, employeeName: e.name, department: e.department || '', branch: e.branch || '',
          kind: c.kind, title: c.title || '', note: c.note || '', badge: c.badge || null,
          by: c.auto ? 'System' : (c.by || 'HR'), byRole: c.auto ? 'Automatic' : (c.byRole || ''), date: c.date, auto: !!c.auto,
        });
      }
    }
    rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const total = rows.length;
    const pageRows = rows.slice((page - 1) * perPage, page * perPage);
    res.json({
      scopedBranch: scopedBranch || null,
      filters: { branches, departments, givers: [...givers].sort() },
      rows: pageRows, total, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)),
    });
  } catch (e) { next(e); }
});

// POST a performance card (appreciation / review / yellow / red). Department
// heads may card their own department; HR/admin anyone. Appreciations may carry
// a badge and fire team + HR/Admin notifications (with an optional announcement).
router.post('/employees/:id/performance', requireHrAccess, async (req, res, next) => {
  try {
    const emp = await HrUser.findByPk(Number(req.params.id));
    if (!emp) return res.status(404).json({ error: 'Employee not found.' });
    if (!(await canReviewEmployee(req, emp))) return res.status(403).json({ error: 'You can only review employees who report to you.' });
    const b = req.body || {};
    const kind = ['praise', 'review', 'yellow', 'red'].includes(b.kind) ? b.kind : null;
    if (!kind) return res.status(400).json({ error: 'Invalid review type.' });
    const note = String(b.note || '').slice(0, 2000).trim();
    let title = String(b.title || '').slice(0, 160).trim();
    const badge = (kind === 'praise' && b.badgeId) ? badgeById(String(b.badgeId)) : null;
    if (badge && !title) title = badge.name;
    if (!title && !note) return res.status(400).json({ error: 'Add a title or a note.' });
    const dateStr = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? b.date : new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
    const byName = req.hrActor.name || (req.hrUser && req.hrUser.name) || 'HR';
    const actorRole = req.isHrAdmin ? 'Admin' : (req.hrUser && (req.hrUser.type === 'manager' ? 'Manager' : req.hrUser.type === 'tl' ? 'Team Lead' : (HR_STAFF_TYPES.includes(req.hrUser.type) ? 'HR' : 'HR')));
    const card = {
      id: `perf${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
      kind, title, note, date: dateStr,
      by: byName, byRole: actorRole, byId: req.hrActor.id || null,
      badgeId: badge ? badge.id : null, badge: badge ? { id: badge.id, name: badge.name, icon: badge.icon, color: badge.color } : null,
      auto: false, createdAt: new Date().toISOString(),
    };
    const profile = emp.profile || {};
    profile.performanceCards = [...(profile.performanceCards || []), card];
    emp.profile = profile; emp.changed('profile', true);
    await emp.save();

    // Notify on appreciation: the joiner's team (same department) + HR & Admin.
    let notified = 0;
    if (kind === 'praise') {
      const badgeText = badge ? ` and earned the “${badge.name}” badge ${badge.icon}` : '';
      const msg = `🎉 ${emp.name} received an appreciation from ${byName}${badgeText}.`;
      try {
        const dept = String(emp.department || '').trim().toLowerCase();
        const team = await HrUser.findAll({ where: { active: true } });
        const recipients = new Set();
        for (const u of team) {
          if (u.id === emp.id) continue; // the person themselves is notified separately
          const sameDept = dept && String(u.department || '').trim().toLowerCase() === dept;
          const isHrStaff = HR_STAFF_TYPES.includes(u.type) || u.isHrManager;
          if (sameDept || isHrStaff) recipients.add(u.id);
        }
        for (const uid of recipients) { try { await HrNotification.create({ userId: uid, actorKind: 'hr', type: 'info', text: msg }); notified++; } catch {} }
        // The recipient of the praise gets a personal note.
        try { await HrNotification.create({ userId: emp.id, actorKind: 'hr', type: 'info', text: `🎉 You received an appreciation from ${byName}${badgeText}!` }); } catch {}
        // Notify CRM admins too.
        try { const admins = await User.findAll({ where: { role: 'admin', active: true } }); for (const a of admins) { await HrNotification.create({ userId: a.id, actorKind: 'admin', type: 'info', text: msg }); } } catch {}
      } catch {}

      // Optional celebratory announcement to the whole branch.
      if (b.announce) {
        try {
          await HrAnnouncement.create({
            title: `👏 Kudos to ${emp.name}!`,
            body: `${emp.name}${emp.department ? ` (${emp.department})` : ''} was recognized by ${byName}${badge ? ` with the <strong>${badge.name}</strong> badge ${badge.icon}` : ''}.${note ? ` "${note}"` : ''} Well done! 🎉`,
            pinned: false, audience: emp.branch || 'all',
            authorId: req.hrActor.id, authorName: byName,
          });
        } catch {}
      }
    }
    res.json({ ok: true, card, notified });
  } catch (e) { next(e); }
});

// DELETE a performance card (HR/admin, or the department head who gave it).
router.delete('/employees/:id/performance/:cardId', requireHrAccess, async (req, res, next) => {
  try {
    const emp = await HrUser.findByPk(Number(req.params.id));
    if (!emp) return res.status(404).json({ error: 'Employee not found.' });
    const profile = emp.profile || {};
    const cards = profile.performanceCards || [];
    const card = cards.find((c) => c.id === req.params.cardId);
    if (!card) return res.status(404).json({ error: 'Note not found.' });
    if (card.auto) return res.status(400).json({ error: 'Automatic badges can’t be removed.' });
    const canDelete = req.isHrAdmin || req.isHrManager || (req.hrActor.id && card.byId === req.hrActor.id);
    if (!canDelete) return res.status(403).json({ error: 'Only HR, an admin, or the person who gave it can remove this.' });
    profile.performanceCards = cards.filter((c) => c.id !== req.params.cardId);
    emp.profile = profile; emp.changed('profile', true);
    await emp.save();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** POST /api/hr/profile/:id/timeline — HR/Admin adds a note to the record. */
router.post('/profile/:id/timeline', requireHrAccess, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
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

// ---- Attendance & Leave (Admin / HR Manager manage; employee views own) ----

// Whether the viewer may manage attendance/leave for others.
function canManagePeople(req) { return req.isHrAdmin || req.isHrManager; }
// Default paid-leave allocation assigned at joining (can be overridden per user
// via profile.leaveAllocation).
const DEFAULT_LEAVE_ALLOCATION = { casual: 12, medical: 12, privilege: 12, wfh: 24 };

// Is the employee within probation (first 3 months) or serving notice on `date`?
// During these windows paid leave isn't allowed (it can still be taken, unpaid).
function leavePaidEligibility(emp, dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  // Probation: first 3 months from joining date.
  if (emp.joiningDate) {
    const join = new Date(emp.joiningDate);
    const probationEnd = new Date(join); probationEnd.setMonth(probationEnd.getMonth() + 3);
    if (date < probationEnd) return { paidAllowed: false, reason: 'probation' };
  }
  // Notice period: if a noticeStart/lastWorkingDay is recorded on the profile.
  const p = emp.profile || {};
  const notice = p.notice || {};
  if (notice.lastWorkingDay) {
    const lwd = new Date(notice.lastWorkingDay);
    const noticeStart = notice.noticeStart ? new Date(notice.noticeStart) : null;
    if (date <= lwd && (!noticeStart || date >= noticeStart)) return { paidAllowed: false, reason: 'notice' };
  }
  return { paidAllowed: true, reason: null };
}

// GET attendance for an employee within a month (?month=YYYY-MM).
router.get('/employees/:id/attendance', requireHrAccess, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const isSelf = req.hrUser && req.hrUser.id === id;
    if (!canManagePeople(req) && !isSelf) return res.status(403).json({ error: 'Not allowed.' });
    const month = String(req.query.month || '').match(/^\d{4}-\d{2}$/) ? req.query.month : new Date().toISOString().slice(0, 7);
    const rows = await HrAttendance.findAll({ where: { employeeId: id, date: { [Op.like]: `${month}-%` } }, order: [['date', 'ASC']] });
    res.json({ month, canManage: canManagePeople(req), days: rows.map((r) => r.toJSON()) });
  } catch (e) { next(e); }
});

// Upsert a single day's attendance (Admin / HR Manager).
router.put('/employees/:id/attendance/:date', requireHrAccess, async (req, res, next) => {
  try {
    if (!canManagePeople(req)) return res.status(403).json({ error: 'Only an admin or HR manager can mark attendance.' });
    const id = Number(req.params.id);
    const date = String(req.params.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date.' });
    const b = req.body || {};
    const emp = await HrUser.findByPk(id);
    if (!emp) return res.status(404).json({ error: 'Employee not found.' });
    if (!canManageBranch(req, emp.branch)) return res.status(403).json({ error: 'You can only manage employees in your branch.' });
    // Late = login later than the shift start (if a shift is set).
    let late = !!b.late;
    if (b.loginTime && emp.shiftId) {
      const shift = await HrShift.findByPk(emp.shiftId);
      if (shift && shift.startTime && b.loginTime > shift.startTime) late = true;
    }
    const [row] = await HrAttendance.findOrCreate({ where: { employeeId: id, date }, defaults: { employeeId: id, date } });
    if (b.status !== undefined) row.status = b.status;
    if (b.loginTime !== undefined) row.loginTime = b.loginTime || null;
    if (b.logoutTime !== undefined) row.logoutTime = b.logoutTime || null;
    if (b.note !== undefined) row.note = String(b.note || '').slice(0, 200);
    row.late = late; row.markedById = req.hrActor.id; row.source = 'manual';
    await row.save();
    hrLog(req, 'attendance.mark', `${emp.name} ${date} ${row.status}`);
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

// Bulk mark (e.g. mark whole month or a set of dates at once).
router.post('/employees/:id/attendance/bulk', requireHrAccess, async (req, res, next) => {
  try {
    if (!canManagePeople(req)) return res.status(403).json({ error: 'Only an admin or HR manager can mark attendance.' });
    const id = Number(req.params.id);
    const emp = await HrUser.findByPk(id);
    if (!emp) return res.status(404).json({ error: 'Employee not found.' });
    if (!canManageBranch(req, emp.branch)) return res.status(403).json({ error: 'You can only manage employees in your branch.' });
    const entries = Array.isArray(req.body && req.body.entries) ? req.body.entries : [];
    let n = 0;
    for (const e of entries) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) continue;
      const [row] = await HrAttendance.findOrCreate({ where: { employeeId: id, date: e.date }, defaults: { employeeId: id, date: e.date } });
      if (e.status) row.status = e.status;
      if (e.loginTime !== undefined) row.loginTime = e.loginTime || null;
      if (e.logoutTime !== undefined) row.logoutTime = e.logoutTime || null;
      row.markedById = req.hrActor.id; await row.save(); n += 1;
    }
    hrLog(req, 'attendance.bulk', `${n} days`);
    res.json({ ok: true, updated: n });
  } catch (e) { next(e); }
});

// Leave summary + records for an employee (allocation, used, balance, list).
router.get('/employees/:id/leave', requireHrAccess, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const isSelf = req.hrUser && req.hrUser.id === id;
    if (!canManagePeople(req) && !isSelf) return res.status(403).json({ error: 'Not allowed.' });
    const emp = await HrUser.findByPk(id);
    if (!emp) return res.status(404).json({ error: 'Employee not found.' });
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const policy = getHrPolicy(s);
    const alloc = allocationFor(policy, emp);
    const catId = (emp.profile && emp.profile.leaveCategory) || 'default';
    const rows = await HrLeave.findAll({ where: { employeeId: id }, order: [['date', 'DESC']] });
    // Used = sum of paid leave days per type (half = 0.5). WFH tracked separately.
    const usedPaid = { casual: 0, medical: 0, privilege: 0, wfh: 0 };
    const usedUnpaid = { casual: 0, medical: 0, privilege: 0, wfh: 0 };
    rows.forEach((r) => {
      const d = r.duration === 'half' ? 0.5 : 1;
      (r.paid ? usedPaid : usedUnpaid)[r.type] = ((r.paid ? usedPaid : usedUnpaid)[r.type] || 0) + d;
    });
    res.json({
      canManage: canManagePeople(req),
      allocation: alloc, usedPaid, usedUnpaid, leaveCategory: catId, categories: policy.categories,
      balance: Object.fromEntries(Object.keys(alloc).map((k) => [k, +(alloc[k] - (usedPaid[k] || 0)).toFixed(1)])),
      leaves: rows.map((r) => r.toJSON()),
    });
  } catch (e) { next(e); }
});

// ===== Core HR → Leave console (Admin / HR Manager) =====
// Company-wide leave overview: every employee (in scope) with their leave
// credit, plus a feed of recent requests with approver info, and quick pulse
// counts. Scope follows the branch model (all-branch/admin → everyone).
router.get('/leave/overview', requireHrAccess, async (req, res, next) => {
  try {
    if (!canManagePeople(req)) return res.status(403).json({ error: 'Only an admin or HR manager can view the leave console.' });
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const policy = getHrPolicy(s);
    const all = await HrUser.findAll({ where: { active: true }, order: [['name', 'ASC']] });
    // Scope: admins & all-branch managers see everyone; scoped managers see their branch.
    const inScope = (u) => req.isHrAdmin || req.hrManagerAll || !req.hrManagerScope
      || String(u.branch || '').toLowerCase() === String(req.hrManagerScope || req.hrBranch || '').toLowerCase();
    const emps = all.filter(inScope);
    const empIds = emps.map((e) => e.id);
    const leaves = empIds.length ? await HrLeave.findAll({ where: { employeeId: empIds }, order: [['date', 'DESC']] }) : [];

    // Per-employee used totals + balances.
    const usedByEmp = {};
    leaves.forEach((r) => {
      if (r.status === 'rejected') return; // declined leave doesn't consume credit
      const d = r.duration === 'half' ? 0.5 : 1;
      const u = usedByEmp[r.employeeId] || (usedByEmp[r.employeeId] = { casual: 0, medical: 0, privilege: 0, wfh: 0 });
      if (r.paid && r.status === 'approved') u[r.type] = (u[r.type] || 0) + d;
    });
    const nameById = Object.fromEntries(emps.map((e) => [e.id, e]));
    // Also resolve names for any leave owners not in the active in-scope set (e.g.
    // deactivated employees) so their historical requests never render nameless.
    const missingIds = [...new Set(leaves.map((l) => l.employeeId).filter((id) => !nameById[id]))];
    if (missingIds.length) {
      const extra = await HrUser.findAll({ where: { id: missingIds } });
      extra.forEach((e) => { nameById[e.id] = e; });
    }
    // Per-employee leave history (grouped so a multi-day request is one entry).
    const historyByEmp = {};
    leaves.forEach((r) => {
      const key = `${r.employeeId}|${r.groupId || `s:${r.id}`}`;
      (historyByEmp[key] || (historyByEmp[key] = [])).push(r);
    });
    const empHistory = {};
    Object.values(historyByEmp).forEach((grp) => {
      grp.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const first = grp[0];
      const days = grp.reduce((n, r) => n + (r.duration === 'half' ? 0.5 : 1), 0);
      const stage = first.status === 'rejected' ? 'declined' : first.status === 'approved' ? 'approved'
        : (grp.some((r) => r.viewedByApprover) ? 'pending' : 'applied');
      (empHistory[first.employeeId] || (empHistory[first.employeeId] = [])).push({
        type: first.type, from: grp[0].date, to: grp[grp.length - 1].date, days,
        duration: grp.length === 1 ? first.duration : 'full',
        reason: first.reason || '', status: stage,
        appliedAt: first.createdAt,
        // Legacy rows approved before these fields were written may lack approvedBy/
        // decidedAt — fall back to the intended approver and the row's updatedAt so
        // the console never shows blanks for a decided request.
        decidedByName: first.approvedBy || (stage === 'approved' || stage === 'declined' ? (first.approverName || null) : null),
        decidedAt: grp.map((r) => r.decidedAt).filter(Boolean).sort().pop() || (stage === 'approved' || stage === 'declined' ? (grp.map((r) => r.updatedAt).filter(Boolean).sort().pop() || null) : null),
        remark: first.remark || null,
      });
    });
    Object.values(empHistory).forEach((list) => list.sort((a, b) => String(b.from).localeCompare(String(a.from))));

    const employees = emps.map((e) => {
      const alloc = allocationFor(policy, e);
      const used = usedByEmp[e.id] || { casual: 0, medical: 0, privilege: 0, wfh: 0 };
      const balance = Object.fromEntries(Object.keys(alloc).map((k) => [k, +(alloc[k] - (used[k] || 0)).toFixed(1)]));
      return { id: e.id, name: e.name, avatar: e.avatar, branch: e.branch || '', department: e.department || '', designation: e.designation || '', allocation: alloc, used, balance, history: empHistory[e.id] || [] };
    });

    // Requests feed. Multi-day requests share a groupId — collapse to one card
    // with a date range. Newest first. HR-recorded (back-dated) leaves are NOT
    // employee applications, so they're excluded from this inbox — they still
    // appear in balances, history and attendance.
    const byGroup = {};
    leaves.forEach((r) => {
      if (r.recordedByHr) return; // hide HR-recorded entries from the requests inbox
      const key = r.groupId || `single:${r.id}`;
      (byGroup[key] || (byGroup[key] = [])).push(r);
    });
    const requests = Object.values(byGroup).map((grp) => {
      grp.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const first = grp[0];
      const emp = nameById[first.employeeId] || {};
      const days = grp.reduce((n, r) => n + (r.duration === 'half' ? 0.5 : 1), 0);
      // Stage: rejected→declined, approved→approved, pending+viewed→pending, pending→applied.
      let stage = first.status === 'rejected' ? 'declined' : first.status === 'approved' ? 'approved'
        : (grp.some((r) => r.viewedByApprover) ? 'pending' : 'applied');
      const decided = stage === 'approved' || stage === 'declined';
      const decidedAt = grp.map((r) => r.decidedAt).filter(Boolean).sort().pop()
        || (decided ? (grp.map((r) => r.updatedAt).filter(Boolean).sort().pop() || null) : null);
      return {
        groupId: first.groupId || null,
        ids: grp.map((r) => r.id),
        employeeId: first.employeeId,
        employeeName: emp.name || 'Employee', avatar: emp.avatar, branch: emp.branch || '', department: emp.department || '',
        type: first.type, paid: first.paid,
        from: grp[0].date, to: grp[grp.length - 1].date, days,
        duration: grp.length === 1 ? first.duration : 'full',
        reason: first.reason || '',
        appliedAt: first.createdAt,
        status: stage,
        approverId: first.approverId, approverName: first.approverName,
        // Legacy approved/declined rows may lack approvedBy — fall back to the
        // intended approver so the console never shows a blank decider.
        decidedByName: first.approvedBy || (decided ? (first.approverName || null) : null), decidedAt,
        remark: first.remark || null,
        documentUrl: first.documentUrl || null,
        canDecide: first.status === 'pending' && (
          (first.decidedByKind === 'admin' && req.hrActor.kind === 'admin' && first.approverId === req.adminUser?.id) ||
          (first.decidedByKind !== 'admin' && req.hrActor.kind === 'hr' && first.approverId === req.hrUser?.id) ||
          canManagePeople(req) // admins / HR managers can act on any request in scope
        ),
      };
    }).sort((a, b) => {
      // Newest leave DATE first (the leave's start date), applied date as tiebreak.
      const d = String(b.from || '').localeCompare(String(a.from || ''));
      if (d !== 0) return d;
      return new Date(b.appliedAt || b.from) - new Date(a.appliedAt || a.from);
    });

    // Pulse counts.
    const today = istDateStr();
    const weekEnd = new Date(Date.now() + 330 * 60000); weekEnd.setDate(weekEnd.getDate() + 7);
    const weekEndStr = weekEnd.toISOString().slice(0, 10);
    const onLeaveToday = leaves.filter((r) => r.status === 'approved' && r.date === today && r.type !== 'wfh')
      .map((r) => ({ id: r.employeeId, name: (nameById[r.employeeId] || {}).name, type: r.type, duration: r.duration }));
    const onLeaveWeek = new Set(leaves.filter((r) => r.status === 'approved' && r.date >= today && r.date <= weekEndStr && r.type !== 'wfh').map((r) => r.employeeId));
    const counts = {
      pendingApprovals: requests.filter((r) => r.status === 'applied' || r.status === 'pending').length,
      onLeaveToday: onLeaveToday.length,
      onLeaveWeek: onLeaveWeek.size,
      employees: employees.length,
    };

    res.json({ employees, requests, onLeaveToday, counts, categories: policy.categories });
  } catch (e) { next(e); }
});

// Mark a pending request as seen by the approver → moves "Applied" to "Pending".
router.post('/leave/:groupOrId/seen', requireHrAccess, async (req, res, next) => {
  try {
    if (!canManagePeople(req)) return res.status(403).json({ error: 'Not allowed.' });
    const key = req.params.groupOrId;
    const where = key.startsWith('g:') ? { groupId: key.slice(2) } : { id: Number(key) };
    const rows = await HrLeave.findAll({ where });
    for (const r of rows) { if (r.status === 'pending' && !r.viewedByApprover) { r.viewedByApprover = true; await r.save(); } }
    res.json({ ok: true, updated: rows.length });
  } catch (e) { next(e); }
});

// Approve / decline a leave request (by groupId or single id) from the console.
router.post('/leave/:groupOrId/decide', requireHrAccess, async (req, res, next) => {
  try {
    if (!canManagePeople(req)) return res.status(403).json({ error: 'Only an admin or HR manager can decide leave.' });
    const decision = req.body && req.body.decision; // 'approve' | 'decline'
    if (!['approve', 'decline'].includes(decision)) return res.status(400).json({ error: 'Invalid decision.' });
    const remark = String((req.body && req.body.remark) || (req.body && req.body.note) || '').slice(0, 500);
    const key = req.params.groupOrId;
    const where = key.startsWith('g:') ? { groupId: key.slice(2) } : { id: Number(key) };
    const rows = await HrLeave.findAll({ where });
    if (!rows.length) return res.status(404).json({ error: 'Request not found.' });
    const actorName = req.hrActor.name;
    const now = new Date();
    for (const r of rows) {
      if (r.status !== 'pending') continue;
      r.status = decision === 'approve' ? 'approved' : 'rejected';
      r.approvedBy = actorName;
      r.decidedById = req.hrActor.id;
      r.decidedAt = now;
      r.decidedByKind = req.hrActor.kind;
      r.viewedByApprover = true;
      if (remark) r.remark = remark;
      // Reflect an approved full-day leave onto the attendance calendar.
      if (decision === 'approve') {
        try {
          const [att] = await HrAttendance.findOrCreate({ where: { employeeId: r.employeeId, date: r.date }, defaults: { employeeId: r.employeeId, date: r.date } });
          att.status = r.duration === 'half' ? 'half_day' : (r.type === 'wfh' ? 'wfh' : 'leave');
          att.note = `leave:${r.type}`; att.approvedBy = actorName; await att.save();
        } catch {}
      }
      await r.save();
    }
    const emp = await HrUser.findByPk(rows[0].employeeId);
    hrLog(req, `leave.${decision}`, emp ? emp.name : String(rows[0].employeeId));
    // Notify the employee.
    try {
      await HrNotification.create({ userId: rows[0].employeeId, actorKind: 'hr', type: 'info',
        text: `Your ${rows[0].type} leave (${rows[0].date}${rows.length > 1 ? ` +${rows.length - 1}` : ''}) was ${decision === 'approve' ? 'approved' : 'declined'} by ${actorName}.` });
    } catch {}
    res.json({ ok: true, status: decision === 'approve' ? 'approved' : 'rejected', updated: rows.length });
  } catch (e) { next(e); }
});

// Set an employee's paid-leave allocation (Admin / HR Manager) — usually at joining.
router.put('/employees/:id/leave-allocation', requireHrAccess, async (req, res, next) => {
  try {
    if (!canManagePeople(req)) return res.status(403).json({ error: 'Only an admin or HR manager can set leave allocation.' });
    const emp = await HrUser.findByPk(Number(req.params.id));
    if (!emp) return res.status(404).json({ error: 'Employee not found.' });
    if (!canManageBranch(req, emp.branch)) return res.status(403).json({ error: 'You can only manage employees in your branch.' });
    const b = req.body || {};
    const alloc = { ...DEFAULT_LEAVE_ALLOCATION, ...((emp.profile && emp.profile.leaveAllocation) || {}) };
    ['casual', 'medical', 'privilege', 'wfh'].forEach((k) => { if (b[k] !== undefined) { const n = Number(b[k]); alloc[k] = Number.isFinite(n) && n >= 0 ? n : 0; } });
    emp.profile = { ...(emp.profile || {}), leaveAllocation: alloc }; emp.changed('profile', true);
    await emp.save();
    hrLog(req, 'leave.allocation', emp.name);
    res.json({ ok: true, allocation: alloc });
  } catch (e) { next(e); }
});

// Assign an employee to a leave category (Admin / HR Manager). The category's
// allocation then applies to them (unless a per-employee override exists).
router.put('/employees/:id/leave-category', requireHrAccess, async (req, res, next) => {
  try {
    if (!canManagePeople(req)) return res.status(403).json({ error: 'Only an admin or HR manager can change the leave category.' });
    const emp = await HrUser.findByPk(Number(req.params.id));
    if (!emp) return res.status(404).json({ error: 'Employee not found.' });
    if (!canManageBranch(req, emp.branch)) return res.status(403).json({ error: 'You can only manage employees in your branch.' });
    const catId = String((req.body && req.body.categoryId) || 'default');
    emp.profile = { ...(emp.profile || {}), leaveCategory: catId };
    // Clear any per-employee override so the category allocation takes effect.
    if (req.body && req.body.clearOverride) delete emp.profile.leaveAllocation;
    emp.changed('profile', true); await emp.save();
    hrLog(req, 'leave.category', `${emp.name} → ${catId}`);
    res.json({ ok: true, leaveCategory: catId });
  } catch (e) { next(e); }
});

// Monthly attendance summary + late-entry salary deduction for an employee.
// Late = login later than shift start + grace. Half-day penalties: N consecutive
// late, or M non-consecutive late in the month. Deficit hours (short of the
// shift length on worked days) convert to a salary deduction.
router.get('/employees/:id/attendance-summary', requireHrAccess, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const isSelf = req.hrUser && req.hrUser.id === id;
    if (!canManagePeople(req) && !isSelf) return res.status(403).json({ error: 'Not allowed.' });
    const emp = await HrUser.findByPk(id);
    if (!emp) return res.status(404).json({ error: 'Employee not found.' });
    const month = String(req.query.month || '').match(/^\d{4}-\d{2}$/) ? req.query.month : new Date().toISOString().slice(0, 7);
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const policy = getHrPolicy(s);
    const lateRule = policy.lateRule;
    const shift = emp.shiftId ? await HrShift.findByPk(emp.shiftId) : null;
    const shiftStart = shift && shift.startTime ? shift.startTime : '09:30';
    const shiftHours = Number(lateRule.shiftHours) || 9;
    const rows = await HrAttendance.findAll({ where: { employeeId: id, date: { [Op.like]: `${month}-%` } }, order: [['date', 'ASC']] });

    const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const graceLimit = toMin(shiftStart) + (Number(lateRule.graceMinutes) || 30);

    let lateDays = 0, deficitMinutes = 0, consecRun = 0, maxConsec = 0;
    const lateHalfDays = []; // dates auto-marked half-day due to lateness
    const perDay = [];
    for (const r of rows) {
      const login = toMin(r.loginTime); const logout = toMin(r.logoutTime);
      let isLate = false;
      if ((r.status === 'present' || r.status === 'half_day') && login != null) {
        isLate = login > graceLimit;
        // Deficit = shortfall vs shift hours (only counts worked days with both times).
        if (logout != null) {
          const worked = logout - login; const expected = shiftHours * 60;
          if (worked < expected) deficitMinutes += (expected - worked);
        }
      }
      if (isLate) { lateDays += 1; consecRun += 1; maxConsec = Math.max(maxConsec, consecRun); }
      else consecRun = 0;
      perDay.push({ date: r.date, status: r.status, late: isLate, loginTime: r.loginTime, logoutTime: r.logoutTime });
    }
    // Half-day penalties: number of half-days from consecutive runs of >= threshold,
    // plus (if total late >= monthly threshold) one more.
    const consecHalf = Math.floor(maxConsec / (lateRule.consecutiveForHalfDay || 3));
    const monthlyHalf = lateDays >= (lateRule.monthlyForHalfDay || 6) ? 1 : 0;
    const penaltyHalfDays = consecHalf + monthlyHalf;

    // Salary deduction from deficit hours. perDaySalary = monthlyCTC/30;
    // perHour = perDaySalary/shiftHours; deduction = perHour * deficitHours.
    const payHist = (emp.profile && emp.profile.payrollHistory) || [];
    const latest = payHist.slice().sort((a, b) => (b.effectiveDate || '').localeCompare(a.effectiveDate || ''))[0];
    const monthlyCtc = latest ? Number(latest.ctc) / 12 : 0; // ctc stored annual → monthly
    const perDaySalary = monthlyCtc / 30;
    const perHour = perDaySalary / shiftHours;
    const deficitHours = +(deficitMinutes / 60).toFixed(2);
    const deficitDeduction = +(perHour * deficitHours).toFixed(2);
    const halfDayDeduction = +(perDaySalary * 0.5 * penaltyHalfDays).toFixed(2);

    res.json({
      month, shiftStart, graceMinutes: lateRule.graceMinutes, shiftHours,
      lateDays, maxConsecutiveLate: maxConsec, penaltyHalfDays,
      deficitHours, monthlyCtc: +monthlyCtc.toFixed(2), perDaySalary: +perDaySalary.toFixed(2), perHour: +perHour.toFixed(2),
      deficitDeduction, halfDayDeduction, totalDeduction: +(deficitDeduction + halfDayDeduction).toFixed(2),
      canManage: canManagePeople(req), perDay,
    });
  } catch (e) { next(e); }
});

// ===================== BRANCH-WIDE ATTENDANCE (Core HR → Attendance) =====================
// Weekend-off rules per branch + holidays. A date is "off" (no attendance needed)
// when it is a Sunday (all branches), a branch-specific Saturday rule, or an
// admin-configured holiday for that branch.
function nthWeekdayOfMonth(dateStr) {
  // Returns which occurrence (1st..5th) of its weekday this date is within its month.
  const d = new Date(dateStr + 'T00:00:00');
  return Math.floor((d.getDate() - 1) / 7) + 1;
}
function branchWeekendOff(dateStr, branch) {
  const d = new Date(dateStr + 'T00:00:00');
  const dow = d.getDay(); // 0=Sun ... 6=Sat
  if (dow === 0) return true;                       // all Sundays off, every branch
  const b = String(branch || '').toLowerCase();
  if (dow === 6) {                                  // Saturday rules
    if (b === 'kolkata') return true;               // Kolkata: every Saturday off
    if (b === 'bhubaneswar') {                      // Bhubaneswar: 2nd & 4th Saturday off
      const nth = nthWeekdayOfMonth(dateStr);
      return nth === 2 || nth === 4;
    }
  }
  return false;
}
// Effective branches this actor may manage (for the branch selector / scope).
async function scopedBranches(req) {
  const all = (await HrBranch.findAll({ order: [['name', 'ASC']] })).map((b) => b.name);
  if (req.isHrAdmin || req.hrManagerAll) return all;
  if (req.isHrManager) {
    const scope = req.hrManagerScope || req.hrBranch;
    return all.filter((n) => String(n).toLowerCase() === String(scope).toLowerCase());
  }
  return [];
}

// GET /attendance/calendar?month=YYYY-MM&branch=  → per-day off flags + completion counts
router.get('/attendance/calendar', requireHrAccess, async (req, res, next) => {
  try {
    if (!canManagePeople(req)) return res.status(403).json({ error: 'Only an admin or HR manager can view attendance.' });
    const month = String(req.query.month || '').match(/^\d{4}-\d{2}$/) ? req.query.month : new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7);
    const branches = await scopedBranches(req);
    // Which branch(es) this calendar covers: a specific in-scope branch, or all scoped.
    let branch = req.query.branch ? String(req.query.branch) : '';
    if (branch && !branches.some((b) => b.toLowerCase() === branch.toLowerCase())) return res.status(403).json({ error: 'Branch not in your scope.' });
    const activeBranches = branch ? [branch] : branches;

    const [year, mon] = month.split('-').map(Number);
    const daysInMonth = new Date(year, mon, 0).getDate();
    const allHolidays = await HrHoliday.findAll();
    const holidays = allHolidays.filter((h) => String(h.date).slice(0, 7) === month);
    const holiSet = {}; // date -> [names] for the covered branches ('' = all branches)
    holidays.forEach((h) => {
      const hb = String(h.branch || '');
      const applies = !hb || activeBranches.some((b) => b.toLowerCase() === hb.toLowerCase());
      if (applies) (holiSet[String(h.date)] = holiSet[String(h.date)] || []).push(h.name);
    });
    // Per-day: active employees whose own branch is working that date (excludes
    // e.g. Kolkata staff on their off-Saturdays), plus present-rate for coloring.
    const activeEmps = await HrUser.findAll({ where: { active: true } });
    const inScope = activeEmps.filter((e) => activeBranches.some((b) => b.toLowerCase() === String(e.branch || '').toLowerCase()));
    const empById = {}; inScope.forEach((e) => { empById[e.id] = e; });
    const inScopeIds = new Set(inScope.map((e) => e.id));
    const marks = await HrAttendance.findAll({ where: { date: { [Op.like]: `${month}-%` } } });
    const marksByDate = {};
    marks.forEach((m) => { if (inScopeIds.has(m.employeeId)) (marksByDate[m.date] = marksByDate[m.date] || []).push(m); });
    const presentVal = (st) => (st === 'present' || st === 'wfh') ? 1 : (st === 'half_day' ? 0.5 : 0);

    const days = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${month}-${String(day).padStart(2, '0')}`;
      const offForAll = activeBranches.length > 0 && activeBranches.every((b) => branchWeekendOff(dateStr, b));
      const holidayNames = holiSet[dateStr] || [];
      const isHoliday = holidayNames.length > 0;
      const disabled = offForAll || isHoliday;
      // Employees actually expected to work this specific date (branch not off, no branch holiday).
      const expected = inScope.filter((e) => !branchWeekendOff(dateStr, e.branch)
        && !allHolidays.some((h) => String(h.date) === dateStr && (!h.branch || String(h.branch).toLowerCase() === String(e.branch || '').toLowerCase())));
      const totalDay = expected.length;
      const dayMarks = (marksByDate[dateStr] || []).filter((m) => empById[m.employeeId] && expected.some((e) => e.id === m.employeeId));
      let present = 0; dayMarks.forEach((m) => { present += presentVal(m.status); });
      const marked = dayMarks.length;
      const presentPct = totalDay > 0 ? Math.round((present / totalDay) * 100) : 0;
      days.push({
        date: dateStr, day, dow: new Date(dateStr + 'T00:00:00').getDay(),
        disabled, weekendOff: offForAll, holiday: isHoliday, holidayNames,
        reason: isHoliday ? 'holiday' : (offForAll ? 'weekend' : null),
        holidayName: holidayNames[0] || null,
        marked, present, total: totalDay, totalActive: totalDay, presentPct,
      });
    }
    res.json({ month, branch: branch || null, branches, days });
  } catch (e) { next(e); }
});

// DELETE /attendance/wipe-all → clears ALL attendance + leave records (admin only).
router.delete('/attendance/wipe-all', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const att = await HrAttendance.destroy({ where: {} });
    const lv = await HrLeave.destroy({ where: {} });
    hrLog(req, 'attendance.wipe', `attendance=${att} leaves=${lv}`);
    res.json({ ok: true, attendanceDeleted: att, leavesDeleted: lv });
  } catch (e) { next(e); }
});

// GET /attendance/approvers/:employeeId → the list of people who can approve
// this employee's leave/WFH: their reports-to chain (senior → their senior → …),
// plus HR Managers (all-branch, and managers scoped to the employee's branch),
// plus admins. Searchable dropdown on the client.
router.get('/attendance/approvers/:employeeId', requireHrAccess, async (req, res, next) => {
  try {
    if (!canManagePeople(req)) return res.status(403).json({ error: 'Not allowed.' });
    const emp = await HrUser.findByPk(Number(req.params.employeeId));
    if (!emp) return res.status(404).json({ error: 'Employee not found.' });
    const out = []; const seen = new Set();
    const add = (u, role) => { if (!u || seen.has(`hr:${u.id}`)) return; seen.add(`hr:${u.id}`); out.push({ id: u.id, name: u.name, designation: u.designation || '', branch: u.branch || '', role }); };

    // 1) Walk the reports-to chain.
    let cur = emp; let hops = 0;
    while (cur && cur.reportsToId && hops < 8) {
      const senior = await HrUser.findByPk(cur.reportsToId);
      if (!senior || seen.has(`hr:${senior.id}`)) break;
      add(senior, 'Reporting manager');
      cur = senior; hops += 1;
    }
    // 2) HR Managers: all-branch, plus those scoped to the employee's branch.
    const managers = await HrUser.findAll({ where: { active: true } });
    managers.forEach((m) => {
      const scope = m.hrManagerScope || (m.isHrManager ? (m.branch || '') : '');
      if (!scope) return;
      if (scope.toLowerCase() === 'all') add(m, 'HR Manager (all branches)');
      else if (String(scope).toLowerCase() === String(emp.branch || '').toLowerCase()) add(m, 'HR Manager');
    });
    // 3) Admins (CRM users) who can approve.
    const admins = await User.findAll({ where: { active: true } });
    admins.forEach((a) => { if ((a.role === 'admin') && !seen.has(`admin:${a.id}`)) { seen.add(`admin:${a.id}`); out.push({ id: `admin:${a.id}`, name: a.name, designation: 'Admin', branch: '', role: 'Admin' }); } });

    res.json({ approvers: out });
  } catch (e) { next(e); }
});

// GET /attendance/day/:date?branch= → active employees grouped branch→dept with marks
router.get('/attendance/day/:date', requireHrAccess, async (req, res, next) => {
  try {
    if (!canManagePeople(req)) return res.status(403).json({ error: 'Only an admin or HR manager can view attendance.' });
    const date = String(req.params.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date.' });
    const branches = await scopedBranches(req);
    let branch = req.query.branch ? String(req.query.branch) : '';
    if (branch && !branches.some((b) => b.toLowerCase() === branch.toLowerCase())) return res.status(403).json({ error: 'Branch not in your scope.' });
    const activeBranches = branch ? [branch] : branches;

    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const policy = getHrPolicy(s);
    const grace = Number(policy.lateRule.graceMinutes) || 30;

    const activeEmps = await HrUser.findAll({ where: { active: true }, order: [['name', 'ASC']] });
    // Exclude employees whose OWN branch is a weekend-off on this specific date
    // (e.g. Kolkata staff on a 2nd Saturday when viewing "All branches"), and
    // anyone whose branch has a holiday that day.
    const allHolidays = await HrHoliday.findAll();
    const branchHoliday = (br) => allHolidays.some((h) => String(h.date) === date && (!h.branch || String(h.branch).toLowerCase() === String(br || '').toLowerCase()));
    const inScope = activeEmps.filter((e) =>
      activeBranches.some((b) => b.toLowerCase() === String(e.branch || '').toLowerCase())
      && !branchWeekendOff(date, e.branch)
      && !branchHoliday(e.branch)
    );
    const shifts = {}; (await HrShift.findAll()).forEach((sh) => { shifts[sh.id] = sh; });
    const marks = {}; (await HrAttendance.findAll({ where: { date } })).forEach((m) => { marks[m.employeeId] = m; });

    // Group branch → department
    const groups = {};
    for (const e of inScope) {
      const bKey = e.branch || '—';
      const dKey = e.department || '—';
      groups[bKey] = groups[bKey] || {};
      groups[bKey][dKey] = groups[bKey][dKey] || [];
      const sh = e.shiftId ? shifts[e.shiftId] : null;
      const m = marks[e.id] || null;
      const leaveType = m && m.note && m.note.startsWith('leave:') ? m.note.slice(6) : null;
      groups[bKey][dKey].push({
        id: e.id, name: e.name, employeeId: e.employeeId, designation: e.designation,
        shiftName: sh ? sh.name : null, shiftStart: sh ? sh.startTime : null, shiftEnd: sh ? sh.endTime : null,
        status: m ? m.status : null, loginTime: m ? m.loginTime : null, logoutTime: m ? m.logoutTime : null,
        late: m ? m.late : false, leaveType, note: m ? m.note : null,
        approvedBy: m ? m.approvedBy : null, notes: m ? m.notes : null, source: m ? m.source : null,
        timeEdited: m && m.timeEditedAt ? {
          byName: m.timeEditedByName, byAvatar: m.timeEditedByAvatar, at: m.timeEditedAt,
          originalLogin: m.originalLoginTime, originalLogout: m.originalLogoutTime,
        } : null,
        mark: m ? { status: m.status, loginTime: m.loginTime, logoutTime: m.logoutTime, late: m.late, leaveType, note: m.note, approvedBy: m.approvedBy, notes: m.notes } : null,
      });
    }
    res.json({ date, branch: branch || null, branches, graceMinutes: grace, groups });
  } catch (e) { next(e); }
});

// ===========================================================================
// EMPLOYEE SELF-SERVICE (employee dashboard): web clock, leave apply/history,
// approvals, who's-in, celebrations, personal attendance calendar.
// ===========================================================================
const nowIST = () => new Date(Date.now() + 330 * 60000);
const istDateStr = () => nowIST().toISOString().slice(0, 10);
const istHHMM = () => nowIST().toISOString().slice(11, 16);
const hhmmToMin = (t) => { if (!t) return null; const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };

// Resolve who may approve THIS employee's leave: their reports-to chain; if none
// resolvable, branch HR managers + admins. Returns {approverId, approverName, kind}.
async function resolveLeaveApprover(emp) {
  if (emp.reportsToId) {
    const senior = await HrUser.findByPk(emp.reportsToId);
    if (senior && senior.active) return { approverId: senior.id, approverName: senior.name, kind: 'hr' };
  }
  if (emp.reportsToAdminId) {
    const adm = await User.findByPk(emp.reportsToAdminId);
    if (adm && adm.active) return { approverId: adm.id, approverName: adm.name, kind: 'admin' };
  }
  // Fallback: an all-branch or same-branch HR manager (never the employee).
  const mgrs = await HrUser.findAll({ where: { active: true } });
  const branchMgr = mgrs.find((m) => (m.hrManagerScope || '').toLowerCase() === String(emp.branch || '').toLowerCase() && m.id !== emp.id);
  if (branchMgr) return { approverId: branchMgr.id, approverName: branchMgr.name, kind: 'hr' };
  const allMgr = mgrs.find((m) => (m.hrManagerScope || '').toLowerCase() === 'all' && m.id !== emp.id);
  if (allMgr) return { approverId: allMgr.id, approverName: allMgr.name, kind: 'hr' };
  const admin = await User.findOne({ where: { role: 'admin', active: true } });
  if (admin) return { approverId: admin.id, approverName: admin.name, kind: 'admin' };
  return { approverId: null, approverName: 'HR', kind: 'hr' };
}

// The reporting chain of approvers for an employee: immediate senior, then that
// senior's senior, walking reportsToId upward. Never includes the employee. If
// there's no reporting line, falls back to the resolved HR-manager/admin.
async function resolveApproverChain(emp) {
  const chain = [];
  const seen = new Set([emp.id]);
  let cur = emp; let hops = 0;
  while (cur && cur.reportsToId && hops < 8) {
    if (seen.has(cur.reportsToId)) break;
    const senior = await HrUser.findByPk(cur.reportsToId);
    if (!senior || !senior.active) break;
    seen.add(senior.id);
    chain.push({ id: senior.id, name: senior.name, designation: senior.designation || '', kind: 'hr' });
    cur = senior; hops += 1;
  }
  // Admin reporting line (if the employee reports directly to a CRM admin).
  if (!chain.length && emp.reportsToAdminId) {
    const adm = await User.findByPk(emp.reportsToAdminId);
    if (adm && adm.active) chain.push({ id: `admin:${adm.id}`, name: adm.name, designation: 'Admin', kind: 'admin' });
  }
  if (!chain.length) {
    const fb = await resolveLeaveApprover(emp);
    if (fb.approverId) chain.push({ id: fb.approverId, name: fb.approverName, designation: '', kind: fb.kind });
  }
  return chain;
}

// GET /me/clock → today's web-clock state for the signed-in employee.
router.get('/me/clock', requireHrAccess, async (req, res, next) => {
  try {
    if (req.hrActor.kind !== 'hr') return res.json({ state: 'na' });
    const empId = req.hrActor.id;
    const date = istDateStr();
    // On approved leave today?
    const leave = await HrLeave.findOne({ where: { employeeId: empId, date, status: 'approved' } });
    const row = await HrAttendance.findOne({ where: { employeeId: empId, date } });
    const breaks = (row && Array.isArray(row.breaks)) ? row.breaks : [];
    let breakMin = 0; breaks.forEach((b) => { const s = hhmmToMin(b.start), e = hhmmToMin(b.end); if (s != null && e != null) breakMin += (e - s); });
    let state = 'out';
    if (leave && leave.duration === 'full') state = 'leave';
    else if (row) {
      if (row.breakOpen) state = 'break';
      else if (row.logoutTime) state = 'done';
      else if (row.loginTime) state = 'in';
    }
    res.json({
      state, date,
      loginTime: row ? row.loginTime : null, logoutTime: row ? row.logoutTime : null,
      breakOpen: row ? row.breakOpen : null, breaks, breakMin, late: row ? row.late : false,
      onLeave: !!leave, leaveType: leave ? leave.type : null,
      shift: null,
    });
  } catch (e) { next(e); }
});

// POST /me/clock  body:{action:'in'|'break'|'break_end'|'out'} → mutate the state.
router.post('/me/clock', requireHrAccess, async (req, res, next) => {
  try {
    if (req.hrActor.kind !== 'hr') return res.status(403).json({ error: 'Only employees can clock in.' });
    const emp = await HrUser.findByPk(req.hrActor.id);
    if (!emp) return res.status(404).json({ error: 'Not found.' });
    const action = String((req.body && req.body.action) || '');
    const date = istDateStr();
    const time = istHHMM();
    // Block clocking on a full-day approved leave.
    const leave = await HrLeave.findOne({ where: { employeeId: emp.id, date, status: 'approved', duration: 'full' } });
    if (leave && action === 'in') return res.status(400).json({ error: 'You are on approved leave today.' });

    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const policy = getHrPolicy(s);
    const grace = Number(policy.lateRule.graceMinutes) || 30;
    let [row] = await HrAttendance.findOrCreate({ where: { employeeId: emp.id, date }, defaults: { status: 'present', source: 'api' } });

    if (action === 'in') {
      if (row.loginTime) return res.status(400).json({ error: 'Already clocked in.' });
      row.loginTime = time; row.status = 'present'; row.source = 'api';
      // Late = login later than shift start + grace (if a shift is set).
      const shift = emp.shiftId ? await HrShift.findByPk(emp.shiftId) : null;
      if (shift && shift.startTime) row.late = hhmmToMin(time) > hhmmToMin(shift.startTime) + grace;
      row.markedById = emp.id;
    } else if (action === 'break') {
      if (!row.loginTime) return res.status(400).json({ error: 'Clock in first.' });
      if (row.breakOpen) return res.status(400).json({ error: 'Already on a break.' });
      if (row.logoutTime) return res.status(400).json({ error: 'You have clocked out.' });
      row.breakOpen = time;
    } else if (action === 'break_end') {
      if (!row.breakOpen) return res.status(400).json({ error: 'You are not on a break.' });
      const list = Array.isArray(row.breaks) ? row.breaks.slice() : [];
      list.push({ start: row.breakOpen, end: time });
      row.breaks = list; row.changed('breaks', true); row.breakOpen = null;
    } else if (action === 'out') {
      if (!row.loginTime) return res.status(400).json({ error: 'Clock in first.' });
      // Auto-close an open break at logout.
      if (row.breakOpen) { const list = Array.isArray(row.breaks) ? row.breaks.slice() : []; list.push({ start: row.breakOpen, end: time }); row.breaks = list; row.changed('breaks', true); row.breakOpen = null; }
      row.logoutTime = time;
    } else {
      return res.status(400).json({ error: 'Unknown action.' });
    }
    await row.save();
    res.json({ ok: true, date, loginTime: row.loginTime, logoutTime: row.logoutTime, breakOpen: row.breakOpen, breaks: row.breaks, late: row.late });
  } catch (e) { next(e); }
});

// GET /me/leave → the signed-in employee's balance + full history.
router.get('/me/leave', requireHrAccess, async (req, res, next) => {
  try {
    if (req.hrActor.kind !== 'hr') return res.json({ allocation: {}, balance: {}, leaves: [] });
    const emp = await HrUser.findByPk(req.hrActor.id);
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const policy = getHrPolicy(s);
    const alloc = allocationFor(policy, emp);
    const rows = await HrLeave.findAll({ where: { employeeId: emp.id }, order: [['date', 'DESC']] });
    const used = { casual: 0, medical: 0, privilege: 0, wfh: 0 };
    rows.forEach((r) => { if (r.status === 'approved') used[r.type] = (used[r.type] || 0) + (r.duration === 'half' ? 0.5 : 1); });
    const approver = await resolveLeaveApprover(emp);
    const approverChain = await resolveApproverChain(emp);
    res.json({
      allocation: alloc, used,
      balance: Object.fromEntries(Object.keys(alloc).map((k) => [k, +(alloc[k] - (used[k] || 0)).toFixed(1)])),
      approverName: approver.approverName,
      approverChain,
      leaves: rows.map((r) => r.toJSON()),
    });
  } catch (e) { next(e); }
});

// POST /me/leave → apply for leave (self). Creates a PENDING request routed to
// the employee's approver.
router.post('/me/leave', requireHrAccess, async (req, res, next) => {
  try {
    if (req.hrActor.kind !== 'hr') return res.status(403).json({ error: 'Only employees can apply for leave.' });
    const emp = await HrUser.findByPk(req.hrActor.id);
    const b = req.body || {};
    const type = ['casual', 'medical', 'privilege', 'wfh'].includes(b.type) ? b.type : null;
    const duration = b.duration === 'half' ? 'half' : 'full';
    if (!type) return res.status(400).json({ error: 'Choose a valid leave type.' });
    const valid = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');

    // Build the list of dates. Half day → a single date. Full day → a From/To
    // range (inclusive); a single date is just from===to.
    let dates = [];
    if (duration === 'half') {
      const date = valid(b.date) ? b.date : (valid(b.from) ? b.from : null);
      if (!date) return res.status(400).json({ error: 'Choose a valid date.' });
      dates = [date];
    } else {
      const from = valid(b.from) ? b.from : (valid(b.date) ? b.date : null);
      const to = valid(b.to) ? b.to : from;
      if (!from) return res.status(400).json({ error: 'Choose a valid start date.' });
      if (to < from) return res.status(400).json({ error: 'The end date can’t be before the start date.' });
      // Expand inclusive range into individual dates (cap at 60 days).
      let cur = new Date(from + 'T00:00:00'); const end = new Date(to + 'T00:00:00'); let guard = 0;
      while (cur <= end && guard < 60) { dates.push(cur.toISOString().slice(0, 10)); cur.setDate(cur.getDate() + 1); guard += 1; }
    }

    // Reject if any date already has a pending/approved request of this type.
    const existing = await HrLeave.findAll({ where: { employeeId: emp.id, type, status: { [Op.in]: ['pending', 'approved'] } } });
    const clash = dates.find((d) => existing.some((e) => e.date === d));
    if (clash) return res.status(400).json({ error: `You already have a request for ${clash}.` });

    // Medical leave requires a supporting document when the EMPLOYEE applies
    // themselves (HR recording on an employee's behalf is exempt).
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const rules = (getHrPolicy(s).leaveRules) || {};
    if (type === 'medical' && rules.medical && rules.medical.requireDocument && !b.documentUrl) {
      return res.status(400).json({ error: 'Medical leave requires a supporting document. Please attach the medical certificate.', policyBlock: 'medical_doc' });
    }

    const approver = await resolveLeaveApprover(emp);
    const groupId = dates.length > 1 ? `lg${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` : null;
    const reason = String(b.reason || '').slice(0, 300);
    const documentUrl = b.documentUrl ? String(b.documentUrl).slice(0, 500) : null;
    const created = [];
    for (const date of dates) {
      const row = await HrLeave.create({
        employeeId: emp.id, type, date, duration, paid: type !== 'wfh',
        reason, documentUrl, status: 'pending', groupId,
        appliedById: emp.id, approverId: approver.approverId, approverName: approver.approverName, decidedByKind: approver.kind,
      });
      created.push(row.toJSON());
    }
    res.status(201).json({ status: 'pending', days: created.length, groupId, leaves: created });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// Daily late-check. For a given senior (a lead/department head/manager who has
// direct reports), find today's team members who are "late": their shift start
// + the shift's own grace has passed and they still have no login recorded, and
// they aren't on approved leave / holiday / week-off. Upserts an HrLateCheck row
// per late employee (idempotent) and returns the rows joined with the employee.
async function computeLateForSenior(seniorId, dateStr) {
  const team = await HrUser.findAll({ where: { reportsToId: seniorId, active: true } });
  if (!team.length) return [];
  const nowMin = hhmmToMin(istHHMM());
  const s = await Settings.findOne({ where: { singleton: 'settings' } });
  const policy = getHrPolicy(s);
  const shiftCache = {};
  const getShift = async (sid) => { if (!sid) return null; if (shiftCache[sid] === undefined) shiftCache[sid] = await HrShift.findByPk(sid); return shiftCache[sid]; };
  // Batch-load everything we need for the whole team + this date up front, so
  // the per-employee loop does no queries (was 4-5 queries per employee).
  const teamIds = team.map((e) => e.id);
  const attByEmp = {}; const leaveSet = new Set(); const lateByEmp = {};
  if (teamIds.length) {
    (await HrAttendance.findAll({ where: { employeeId: teamIds, date: dateStr } })).forEach((a) => { attByEmp[a.employeeId] = a; });
    (await HrLeave.findAll({ where: { employeeId: teamIds, date: dateStr, status: 'approved' } })).forEach((l) => { leaveSet.add(l.employeeId); });
    (await HrLateCheck.findAll({ where: { employeeId: teamIds, date: dateStr } })).forEach((r) => { lateByEmp[r.employeeId] = r; });
  }
  const holidaysToday = await HrHoliday.findAll({ where: { date: dateStr } });
  const isHolidayFor = (branch) => holidaysToday.some((h) => h.branch === '' || h.branch === (branch || ''));
  const results = [];
  for (const emp of team) {
    if (!emp.shiftId) continue; // no shift → can't judge lateness
    const shift = await getShift(emp.shiftId);
    if (!shift || !shift.startTime) continue;
    const startMin = hhmmToMin(shift.startTime);
    const grace = Number.isFinite(Number(shift.graceMinutes)) ? Number(shift.graceMinutes) : 20;
    if (startMin == null) continue;
    // Only flag once the grace window has fully passed for today.
    if (nowMin == null || nowMin < startMin + grace) continue;
    // Skip anyone on approved leave / holiday / week-off today, or already logged in.
    const att = attByEmp[emp.id];
    if (att && att.loginTime) continue;                       // already clocked in
    if (att && ['leave', 'holiday', 'week_off', 'half_day'].includes(att.status)) continue;
    if (leaveSet.has(emp.id)) continue;
    if (isWeekOff(policy, emp.branch, dateStr)) continue;
    if (isHolidayFor(emp.branch)) continue;

    // Upsert the late-check record (idempotent for the day).
    let row = lateByEmp[emp.id];
    if (!row) {
      row = await HrLateCheck.create({
        date: dateStr, employeeId: emp.id, seniorId, branch: emp.branch || '',
        shiftStart: shift.startTime, graceMinutes: grace,
      });
    }
    results.push({ row, emp });
  }
  return results;
}

// GET /me/reviews → items awaiting THIS person's action: juniors' pending leave
// they can approve (as reports-to senior, or as branch HR manager/admin).
router.get('/me/reviews', requireHrAccess, async (req, res, next) => {
  try {
    const actorId = req.hrActor.id;
    const isAdminActor = req.hrActor.kind === 'admin' || req.isHrAdmin;
    const pend = await HrLeave.findAll({ where: { status: 'pending' }, order: [['date', 'ASC']] });
    // Batch-load every applicant referenced by a pending leave in ONE query, so
    // the branch-permission check below doesn't do a findByPk per leave.
    const pendEmpIds = [...new Set(pend.map((l) => l.employeeId).filter(Boolean))];
    const usersById = {};
    if (pendEmpIds.length) { (await HrUser.findAll({ where: { id: pendEmpIds } })).forEach((u) => { usersById[u.id] = u; }); }
    const decidable = [];
    for (const lv of pend) {
      let canDecide = false;
      if (lv.approverId && ((lv.decidedByKind === 'admin' && isAdminActor && lv.approverId === actorId) || (lv.decidedByKind !== 'admin' && req.hrActor.kind === 'hr' && lv.approverId === actorId))) canDecide = true;
      if (!canDecide) {
        const applicant = usersById[lv.employeeId];
        if (applicant && canManageBranch(req, applicant.branch)) canDecide = true;
      }
      if (canDecide) decidable.push(lv);
    }
    // Group multi-day requests (same groupId) into a single review item; the
    // client approves/rejects the whole group via the group key.
    const nameOf = (id) => { const u = usersById[id]; return u ? u.name : 'Employee'; };
    const groups = {};
    for (const lv of decidable) {
      const key = lv.groupId || `single:${lv.id}`;
      if (!groups[key]) groups[key] = { key, ids: [], employeeId: lv.employeeId, type: lv.type, duration: lv.duration, reason: lv.reason, dates: [] };
      groups[key].ids.push(lv.id); groups[key].dates.push(lv.date);
    }
    // Batch-load prior approved leaves for all these employees in ONE query,
    // then group them in memory (instead of a findAll per review group).
    const groupEmpIds = [...new Set(Object.values(groups).map((g) => g.employeeId).filter(Boolean))];
    const prevByEmp = {};
    if (groupEmpIds.length) {
      const allPrev = await HrLeave.findAll({ where: { employeeId: groupEmpIds, status: 'approved' }, order: [['date', 'DESC']] });
      for (const l of allPrev) { (prevByEmp[l.employeeId] = prevByEmp[l.employeeId] || []).push(l); }
    }
    const todayStr = istDateStr();
    const out = [];
    for (const g of Object.values(groups)) {
      g.dates.sort();
      // Last approved leave this employee took before now (for context in the popup).
      let lastLeave = null;
      try {
        const prev = prevByEmp[g.employeeId] || [];
        const past = prev.filter((l) => l.date < todayStr);
        if (past.length) {
          const gid = past[0].groupId;
          const sameGroup = gid ? past.filter((l) => l.groupId === gid) : [past[0]];
          const ds = sameGroup.map((l) => l.date).sort();
          const daysAgo = Math.round((new Date(todayStr) - new Date(ds[ds.length - 1])) / 86400000);
          lastLeave = { from: ds[0], to: ds[ds.length - 1], days: ds.length, type: past[0].type, daysAgo };
        }
      } catch {}
      out.push({
        id: g.ids[0], groupKey: g.key, ids: g.ids, kind: 'leave',
        who: nameOf(g.employeeId), employeeId: g.employeeId,
        type: g.type, duration: g.duration, reason: g.reason,
        date: g.dates[0], dateTo: g.dates[g.dates.length - 1], days: g.dates.length,
        dates: g.dates, lastLeave,
      });
    }

    // Interview review items: for interviews this person sat on whose time has
    // passed, ask attended/no-show; once attended, ask for feedback until given.
    if (req.hrActor.kind === 'hr') {
      const myId = req.hrActor.id;
      const cands = await HrCandidate.findAll({ order: [['updatedAt', 'DESC']] });
      const nowMs = Date.now();
      for (const c of cands) {
        for (const iv of (c.interviews || [])) {
          const onPanel = (iv.panelists || []).some((p) => p.id === myId);
          if (!onPanel || !iv.at) continue;
          if (new Date(iv.at).getTime() > nowMs) continue; // still upcoming
          const attendance = (iv.attendanceByPanelist || {})[myId]; // 'attended' | 'no_show' | undefined
          const feedbackDone = !!(iv.feedbackByPanelist || {})[myId];
          if (!attendance) {
            out.push({ id: `iv-att-${c.id}-${iv.id}`, kind: 'interview_attendance', candidateId: c.id, interviewId: iv.id,
              who: c.name, roundLabel: iv.roundLabel || '', at: iv.at });
          } else if (attendance === 'attended' && !feedbackDone) {
            out.push({ id: `iv-fb-${c.id}-${iv.id}`, kind: 'interview_feedback', candidateId: c.id, interviewId: iv.id,
              who: c.name, roundLabel: iv.roundLabel || '', at: iv.at });
          }
        }
      }
    }

    // Expense approvals: submitted expenses awaiting admin sign-off. Only admins
    // approve expenses, so these appear for admin actors.
    if (isAdminActor) {
      const pendingExp = await HrExpense.findAll({ where: { status: 'submitted' }, order: [['createdAt', 'ASC']] });
      for (const ex of pendingExp) {
        out.push({
          id: `exp-${ex.id}`, kind: 'expense_approval', expenseId: ex.id,
          who: ex.raisedByName || 'HR', title: ex.title, amount: Number(ex.amount || 0),
          category: ex.category || '', branch: ex.branch || '', payeeName: ex.payeeName || '',
          payeeType: ex.payeeType, invoiceUrl: ex.invoiceUrl || '', at: ex.createdAt,
        });
      }
    }

    // Daily late-check. A senior (anyone with direct reports) sees a review item
    // listing today's team members who are late (past shift start + grace with no
    // login). They set coming / not coming / not picking + notes per person.
    if (req.hrActor.kind === 'hr') {
      const todayStr = istDateStr();
      const late = await computeLateForSenior(actorId, todayStr);
      // Only pending (not yet actioned by the senior) drive the review card.
      const pendingLate = late.filter(({ row }) => row.seniorStatus === 'pending');
      if (pendingLate.length) {
        out.push({
          id: `late-${todayStr}`, kind: 'late_check', date: todayStr,
          count: pendingLate.length,
          people: pendingLate.map(({ row, emp }) => ({
            id: row.id, employeeId: emp.id, name: emp.name, phone: emp.phone || '',
            avatar: emp.avatar || null, shiftStart: row.shiftStart, graceMinutes: row.graceMinutes,
            status: row.seniorStatus, notes: row.seniorNotes || '',
          })),
        });
      }
    }

    // HR follow-up on late-checks: branch HR managers / admins see employees a
    // senior has actioned, so they can review the status + notes and handle the
    // "not picking the call" ones.
    if (canManagePeople(req)) {
      const todayStr = istDateStr();
      const actioned = await HrLateCheck.findAll({
        where: { date: todayStr, seniorStatus: { [Op.ne]: 'pending' }, hrStatus: { [Op.in]: ['pending'] } },
        order: [['seniorUpdatedAt', 'ASC']],
      });
      const inScope = actioned.filter((r) => canManageBranch(req, r.branch));
      if (inScope.length) {
        const empIds = [...new Set(inScope.map((r) => r.employeeId))];
        const seniorIds = [...new Set(inScope.map((r) => r.seniorId).filter(Boolean))];
        const emps = await HrUser.findAll({ where: { id: empIds } });
        const seniors = await HrUser.findAll({ where: { id: seniorIds } });
        const empById = Object.fromEntries(emps.map((e) => [e.id, e]));
        const seniorById = Object.fromEntries(seniors.map((e) => [e.id, e]));
        out.push({
          id: `late-hr-${todayStr}`, kind: 'late_check_hr', date: todayStr,
          count: inScope.length,
          people: inScope.map((r) => {
            const e = empById[r.employeeId] || {};
            const sr = seniorById[r.seniorId] || {};
            return {
              id: r.id, employeeId: r.employeeId, name: e.name || 'Employee', phone: e.phone || '',
              avatar: e.avatar || null, branch: r.branch,
              seniorName: sr.name || '', seniorStatus: r.seniorStatus, seniorNotes: r.seniorNotes || '',
              hrStatus: r.hrStatus, hrNotes: r.hrNotes || '',
            };
          }),
        });
      }
    }

    // Onboarding tasks routed to this person's department (e.g. IT: prepare a
    // computer for a new joiner). Shows for anyone whose department matches.
    try {
      const me = req.hrUser;
      const myDept = me && me.department ? String(me.department).trim().toLowerCase() : '';
      if (myDept) {
        const openTasks = await HrOnboardingTask.findAll({ where: { done: false }, order: [['createdAt', 'ASC']] });
        const mine = openTasks.filter((t) => String(t.forDepartment || '').trim().toLowerCase() === myDept);
        for (const t of mine) {
          out.push({ id: `onbtask-${t.id}`, kind: 'onboarding_task', taskId: t.id, title: t.label, sub: t.sub, candidateName: t.candidateName });
        }
      }
    } catch {}

    // "Did they join?" — for hired candidates whose joining date has arrived but
    // whose joined/not-joined status hasn't been confirmed yet. Shown to the
    // candidate's assigned HR / recruiter (and to HR admins/managers), so they
    // can confirm the person joined (→ employee) or didn't (→ blacklist).
    try {
      const me = req.hrActor;
      const canConfirm = req.isHrAdmin || req.isHrManager || (req.hrUser && HR_STAFF_TYPES.includes(req.hrUser.type));
      if (canConfirm) {
        const istToday = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
        const hired = await HrCandidate.findAll({ where: { blacklisted: false } });
        // Pre-filter on the cheap in-memory checks first, then batch-load the
        // jobs for the survivors in ONE query (avoids a findByPk per candidate).
        const candidates = hired.filter((c) => {
          const offer = c.offer || {};
          if (!offer.joiningDate) return false;
          if (offer.joinedConfirmed || offer.notJoined) return false;
          return String(offer.joiningDate).slice(0, 10) <= istToday; // joining day reached
        });
        const jobIds = [...new Set(candidates.map((c) => c.jobPostId).filter(Boolean))];
        const jobsById = {};
        if (jobIds.length) { (await HrJobPost.findAll({ where: { id: jobIds } })).forEach((j) => { jobsById[j.id] = j; }); }
        for (const c of candidates) {
          const offer = c.offer || {};
          const jd = String(offer.joiningDate).slice(0, 10);
          const job = c.jobPostId ? jobsById[c.jobPostId] : null;
          const assigned = (job && Array.isArray(job.assignedHrIds)) ? job.assignedHrIds : [];
          const isMine = req.isHrAdmin || (req.isHrManager && (me.branchScope === 'all' || !me.branch || c.branch === me.branch || (job && (job.locations || []).includes(me.branch)))) || assigned.includes(me.id) || c.recruiterId === me.id;
          if (!isMine) continue;
          out.push({ id: `joinconfirm-${c.id}`, kind: 'join_confirm', candidateId: c.id, candidateName: c.name, role: job ? job.title : '', joiningDate: jd });
        }
      }
    } catch {}

    res.json({ reviews: out, count: out.length });
  } catch (e) { next(e); }
});

// Mark a routed onboarding task (e.g. IT computer prep) done. Flips the linked
// HR checklist item on the candidate too.
router.post('/onboarding-task/:id/done', requireHrAccess, async (req, res, next) => {
  try {
    const t = await HrOnboardingTask.findByPk(req.params.id);
    if (!t) return res.status(404).json({ error: 'Task not found.' });
    t.done = true; t.doneAt = new Date(); t.doneById = req.hrActor.id; t.doneByName = req.hrActor.name;
    await t.save();
    // Flip the linked HR checklist item on the candidate.
    if (t.hrTaskId) {
      const cand = await HrCandidate.findByPk(t.candidateId);
      if (cand && cand.onboarding && Array.isArray(cand.onboarding.hrTasks)) {
        const onb = cand.onboarding;
        onb.hrTasks = onb.hrTasks.map((x) => (x.id === t.hrTaskId ? { ...x, done: true, doneAt: new Date().toISOString(), meta: { ...(x.meta || {}), completedBy: req.hrActor.name } } : x));
        cand.onboarding = onb; cand.changed('onboarding', true);
        await cand.save();
      }
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Confirm whether a hired candidate joined on their joining day. Called from the
// HR review-tab "Did they join?" task. joined=true marks joinedConfirmed (they
// become an employee via the onboarding panel / create-employee); joined=false
// records the reason and moves the candidate to the Blacklist.
router.post('/candidates/:id/join-confirm', requireHrAccess, async (req, res, next) => {
  try {
    if (!(req.isHrAdmin || req.isHrManager || (req.hrUser && HR_STAFF_TYPES.includes(req.hrUser.type)))) {
      return res.status(403).json({ error: 'You don’t have permission to confirm joining.' });
    }
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    const offer = row.offer || {};
    const b = req.body || {};
    if (b.joined === true) {
      offer.joinedConfirmed = true; offer.notJoined = false; offer.notJoinedReason = '';
      row.offer = offer; row.changed('offer', true);
      pushTimeline(row, { type: 'offer', text: `${row.name} confirmed as JOINED by ${req.hrActor.name}.`, by: req.hrActor.name });
    } else {
      if (!String(b.reason || '').trim()) return res.status(400).json({ error: 'Please provide a reason for not joining.' });
      offer.notJoined = true; offer.joinedConfirmed = false;
      offer.notJoinedAt = new Date().toISOString();
      offer.notJoinedReason = String(b.reason).slice(0, 300);
      row.offer = offer; row.changed('offer', true);
      row.blacklisted = true; row.blacklistedAt = new Date(); row.blacklistReason = String(b.reason).slice(0, 300);
      pushTimeline(row, { type: 'offer', text: `${row.name} marked did-not-join by ${req.hrActor.name} — moved to Blacklist. Reason: ${String(b.reason).slice(0, 150)}`, by: req.hrActor.name });
    }
    await row.save();
    res.json({ ok: true });
  } catch (e) { next(e); }
});
// team members. body: { updates: [{ id, status, notes }] } where status is one
// of coming | not_coming | not_picking. On save, notify the branch HR manager(s)
// so they can follow up (especially "not picking").
router.post('/me/late-check/:date', requireHrAccess, async (req, res, next) => {
  try {
    if (req.hrActor.kind !== 'hr') return res.status(403).json({ error: 'Only a team lead can update this.' });
    const date = String(req.params.date || '');
    const updates = Array.isArray(req.body && req.body.updates) ? req.body.updates : [];
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update.' });
    const VALID = ['coming', 'not_coming', 'not_picking'];
    const now = new Date();
    const touched = [];
    for (const u of updates) {
      const row = await HrLateCheck.findOne({ where: { id: Number(u.id), date, seniorId: req.hrActor.id } });
      if (!row) continue; // only the owning senior can update their rows
      if (!VALID.includes(u.status)) continue;
      row.seniorStatus = u.status;
      row.seniorNotes = String(u.notes || '').slice(0, 500);
      row.seniorUpdatedAt = now;
      await row.save();
      touched.push(row);
    }
    if (!touched.length) return res.status(400).json({ error: 'No matching records to update.' });

    // Notify branch HR manager(s) + admins for each affected branch (deduped),
    // and drop an in-app notification so they open the follow-up review.
    try {
      const byBranch = {};
      touched.forEach((r) => { (byBranch[r.branch || ''] || (byBranch[r.branch || ''] = [])).push(r); });
      for (const [branch, rows] of Object.entries(byBranch)) {
        // Branch HR managers: HR users flagged as managers scoped to this branch
        // or all branches; plus admins.
        const hrMgrs = await HrUser.findAll({ where: { active: true, isHrManager: true } });
        const scoped = hrMgrs.filter((m) => {
          const sc = String(m.hrManagerScope || '').toLowerCase();
          return sc === 'all' || sc === String(branch || '').toLowerCase();
        });
        const seniorName = req.hrActor.name;
        for (const m of scoped) {
          if (m.id === req.hrActor.id) continue;
          await HrNotification.create({ userId: m.id, actorKind: 'hr', type: 'info',
            text: `${seniorName} updated the daily late-check for ${branch || 'the team'} — ${rows.length} employee${rows.length === 1 ? '' : 's'} to review${rows.some((r) => r.seniorStatus === 'not_picking') ? ' (some not picking calls)' : ''}.` });
          rows.forEach((r) => { r.notifiedHrAt = new Date(); });
        }
      }
      await Promise.all(touched.map((r) => r.save()));
    } catch {}

    hrLog(req, 'latecheck.senior', `${date} · ${touched.length} updated`);
    res.json({ ok: true, updated: touched.length });
  } catch (e) { next(e); }
});

// POST /late-check/:date/hr — a branch HR manager / admin records the final
// follow-up status + notes (e.g. after calling an employee the senior couldn't
// reach). body: { updates: [{ id, status, notes }] } status: coming|not_coming|resolved.
router.post('/late-check/:date/hr', requireHrAccess, async (req, res, next) => {
  try {
    if (!canManagePeople(req)) return res.status(403).json({ error: 'Only an admin or HR manager can update this.' });
    const date = String(req.params.date || '');
    const updates = Array.isArray(req.body && req.body.updates) ? req.body.updates : [];
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update.' });
    const VALID = ['coming', 'not_coming', 'resolved'];
    const now = new Date();
    let n = 0;
    for (const u of updates) {
      const row = await HrLateCheck.findOne({ where: { id: Number(u.id), date } });
      if (!row) continue;
      if (!canManageBranch(req, row.branch)) continue;
      if (!VALID.includes(u.status)) continue;
      row.hrStatus = u.status;
      row.hrNotes = String(u.notes || '').slice(0, 500);
      row.hrById = req.hrActor.id;
      row.hrByName = req.hrActor.name;
      row.hrUpdatedAt = now;
      await row.save();
      n++;
    }
    hrLog(req, 'latecheck.hr', `${date} · ${n} updated`);
    res.json({ ok: true, updated: n });
  } catch (e) { next(e); }
});

// POST /me/interview/:candidateId/:interviewId/attendance  body:{attended:bool}
// Panelist marks whether the candidate attended (or was a no-show).
router.post('/me/interview/:candidateId/:interviewId/attendance', requireHrAccess, async (req, res, next) => {
  try {
    if (req.hrActor.kind !== 'hr') return res.status(403).json({ error: 'Only panelists can do this.' });
    const myId = req.hrActor.id;
    const c = await HrCandidate.findByPk(Number(req.params.candidateId));
    if (!c) return res.status(404).json({ error: 'Candidate not found.' });
    const ivs = Array.isArray(c.interviews) ? c.interviews.slice() : [];
    const iv = ivs.find((x) => String(x.id) === String(req.params.interviewId));
    if (!iv) return res.status(404).json({ error: 'Interview not found.' });
    if (!(iv.panelists || []).some((p) => p.id === myId)) return res.status(403).json({ error: 'You are not on this panel.' });
    iv.attendanceByPanelist = { ...(iv.attendanceByPanelist || {}), [myId]: req.body && req.body.attended ? 'attended' : 'no_show' };
    c.interviews = ivs; c.changed('interviews', true); await c.save();
    res.json({ ok: true, attendance: iv.attendanceByPanelist[myId] });
  } catch (e) { next(e); }
});

// POST /me/leave/:id/decide  body:{approve:bool} → approve/reject a pending leave.
// If the leave belongs to a multi-day group, the whole group is decided together.
router.post('/me/leave/:id/decide', requireHrAccess, async (req, res, next) => {
  try {
    const lv = await HrLeave.findByPk(Number(req.params.id));
    if (!lv) return res.status(404).json({ error: 'Leave request not found.' });
    if (lv.status !== 'pending') return res.status(400).json({ error: 'This request was already decided.' });
    const actorId = req.hrActor.id;
    const isAdminActor = req.hrActor.kind === 'admin' || req.isHrAdmin;
    const applicant = await HrUser.findByPk(lv.employeeId);
    let allowed = false;
    if (lv.approverId && ((lv.decidedByKind === 'admin' && isAdminActor && lv.approverId === actorId) || (lv.decidedByKind !== 'admin' && req.hrActor.kind === 'hr' && lv.approverId === actorId))) allowed = true;
    if (!allowed && applicant && canManageBranch(req, applicant.branch)) allowed = true;
    if (!allowed) return res.status(403).json({ error: 'You can’t decide this request.' });

    const approve = !!(req.body && req.body.approve);
    const decisionNote = String((req.body && req.body.note) || '').slice(0, 300) || null;
    // Gather every pending day in this request (grouped multi-day, or just this one).
    const rows = lv.groupId
      ? await HrLeave.findAll({ where: { groupId: lv.groupId, status: 'pending' } })
      : [lv];
    for (const r of rows) {
      r.status = approve ? 'approved' : 'rejected';
      r.decidedById = actorId; r.decidedAt = new Date();
      r.approvedBy = approve ? req.hrActor.name : null;
      if (decisionNote) r.reason = r.reason ? `${r.reason} — ${decisionNote}` : decisionNote;
      await r.save();
      if (approve) {
        const attStatus = r.type === 'wfh' ? 'wfh' : (r.duration === 'half' ? 'half_day' : 'leave');
        const [att] = await HrAttendance.findOrCreate({ where: { employeeId: r.employeeId, date: r.date }, defaults: { status: attStatus } });
        att.status = attStatus; att.note = `leave:${r.type}`; att.approvedBy = req.hrActor.name; if (decisionNote) att.notes = decisionNote; await att.save();
      }
    }
    res.json({ ok: true, status: approve ? 'approved' : 'rejected', days: rows.length });
  } catch (e) { next(e); }
});

// GET /me/org-chart → the organization chart, scoped & masked for the viewer.
//   • Admin / HR staff (or all-branch HR manager) → the FULL chart: every
//     department, every person, with phone + email, plus admins with contact.
//   • Everyone else → their OWN department in full (name, designation, phone,
//     email); every OTHER department shows only its TOP lead with name +
//     designation (no phone/email); admins show name + designation only.
// Contact details for out-of-scope people are never sent to the browser.
router.get('/me/org-chart', requireHrAccess, async (req, res, next) => {
  try {
    const ORDER = { director: 0, admin: 0, manager: 1, tl: 2, senior: 3, hr: 3, recruiter: 3, junior: 4, employee: 5, trainee: 6, intern: 7 };
    const all = (await HrUser.findAll({ where: { active: true } }))
      .sort((a, b) => (ORDER[a.type] ?? 9) - (ORDER[b.type] ?? 9) || (a.name || '').localeCompare(b.name || ''));
    const adminRows = await User.findAll({ where: { role: 'admin', active: true }, attributes: ['id', 'name', 'designation', 'phone', 'email'], order: [['name', 'ASC']] });
    const hiddenIds = new Set((await HrDirectorProfile.findAll({ where: { hidden: true }, attributes: ['userId'] })).map((o) => o.userId));
    const admins = adminRows.filter((a) => !hiddenIds.has(a.id));

    // Full-access viewers: admins and HR staff (hr/recruiter/HR-dept), plus HR
    // managers (they administer people).
    const fullAccess = req.hrActor.kind === 'admin' || req.isHrRole || req.isHrManager;

    const card = (u, full) => ({
      _id: u.id, name: u.name, type: u.type,
      designation: u.designation || '', department: u.department || '',
      avatar: u.avatar || null, branchIncharge: !!u.branchIncharge, branch: u.branch || '',
      reportsToId: u.reportsToId || null, reportsToAdminId: u.reportsToAdminId || null,
      phone: full ? (u.phone || '') : '', email: full ? (u.email || '') : '', masked: !full,
    });

    // Group by department.
    const byDept = {};
    all.forEach((u) => { const d = (u.department && String(u.department).trim()) || 'Unassigned'; (byDept[d] = byDept[d] || []).push(u); });

    const myDept = String((req.hrUser && req.hrUser.department) || '').trim().toLowerCase();

    // Is this HrUser the top lead of their department (doesn't report to another
    // lead in the same department)?
    const LEAD = new Set(['manager', 'tl', 'senior']);
    const byId = new Map(all.map((u) => [u.id, u]));
    const isTopLead = (u) => {
      if (!LEAD.has(u.type)) return false;
      const mgr = u.reportsToId ? byId.get(u.reportsToId) : null;
      if (mgr && LEAD.has(mgr.type) && String(mgr.department || '').toLowerCase() === String(u.department || '').toLowerCase()) return false;
      return true;
    };

    const departments = Object.keys(byDept).sort((a, b) => (a === 'Unassigned') - (b === 'Unassigned') || a.localeCompare(b)).map((dept) => {
      const people = byDept[dept];
      const isMine = fullAccess || (myDept && dept.toLowerCase() === myDept);
      if (isMine) return { name: dept, mine: true, people: people.map((u) => card(u, true)) };
      // other department → only the top lead(s), name + designation, masked.
      const heads = people.filter(isTopLead);
      const show = heads.length ? heads : people.slice(0, 1); // fallback: first person
      return { name: dept, mine: false, people: show.map((u) => card(u, false)) };
    });

    res.json({
      fullAccess,
      admins: admins.map((a) => ({ _id: a.id, name: a.name, type: 'admin', designation: a.designation || 'Director', phone: fullAccess ? (a.phone || '') : '', email: fullAccess ? (a.email || '') : '', masked: !fullAccess })),
      departments,
    });
  } catch (e) { next(e); }
});

// GET /me/whos-in → today's attendance status, scoped to the viewer:
//   • Admin        → their immediate reporting employees (reportsToAdminId).
//   • HR manager   → their own team first, then all other employees in scope
//                    (branch for a scoped manager, everyone for an all-branch one).
//   • Employee/HR  → their team (direct reports) + same department.
// Each person carries group:'team'|'others' so the UI can section them.
router.get('/me/whos-in', requireHrAccess, async (req, res, next) => {
  try {
    const date = istDateStr();
    const all = await HrUser.findAll({ where: { active: true } });

    let scoped; // [{ user, group }]
    if (req.hrActor.kind === 'admin') {
      // Admin: their direct reports (employees who report to this admin).
      const adminId = req.adminUser.id;
      scoped = all.filter((u) => u.reportsToAdminId === adminId).map((u) => ({ user: u, group: 'team' }));
    } else {
      const me = await HrUser.findByPk(req.hrActor.id);
      if (!me) return res.json({ people: [], counts: {} });
      const isTeam = (u) => u.reportsToId === me.id
        || (u.department && me.department && u.department.toLowerCase() === me.department.toLowerCase());
      if (req.isHrManager) {
        // Manager: team first, then everyone else in scope. All-branch managers
        // see every branch; scoped managers see only their own branch.
        const inScope = (u) => req.hrManagerAll || !req.hrManagerScope
          || String(u.branch || '').toLowerCase() === String(req.hrManagerScope || req.hrBranch || '').toLowerCase();
        scoped = all.filter((u) => u.id !== me.id && inScope(u))
          .map((u) => ({ user: u, group: isTeam(u) ? 'team' : 'others' }));
      } else {
        // Plain employee / HR staff: team + same department only.
        scoped = all.filter((u) => u.id !== me.id && isTeam(u)).map((u) => ({ user: u, group: 'team' }));
      }
    }

    const ids = scoped.map((x) => x.user.id);
    const att = ids.length ? await HrAttendance.findAll({ where: { employeeId: ids, date } }) : [];
    const byEmp = Object.fromEntries(att.map((a) => [a.employeeId, a]));
    const meId = req.hrActor.kind === 'hr' ? req.hrActor.id : null;
    const statusOf = (p) => {
      const a = byEmp[p.id];
      let status = 'not_in', at = null;
      if (a) {
        if (a.status === 'leave' || a.status === 'half_day') status = 'leave';
        else if (a.loginTime) { status = a.late ? 'late' : 'in'; at = a.loginTime; }
      }
      return { status, at };
    };
    const people = scoped.map(({ user: p, group }) => {
      const { status, at } = statusOf(p);
      return { id: p.id, name: p.name, department: p.department, branch: p.branch, group, reportsToMe: meId ? p.reportsToId === meId : false, status, at };
    }).sort((x, y) => {
      // Team first, then others; within each, by name.
      if (x.group !== y.group) return x.group === 'team' ? -1 : 1;
      return x.name.localeCompare(y.name);
    });
    const counts = { not_in: 0, late: 0, in: 0, leave: 0 };
    people.forEach((p) => { counts[p.status === 'in' ? 'in' : p.status] = (counts[p.status === 'in' ? 'in' : p.status] || 0) + 1; });
    res.json({ people, counts });
  } catch (e) { next(e); }
});

// ===== Core HR → Expenses & Vendors =====
// Default expense categories; admins/HR managers can edit the list (stored in
// Settings.hrExpenseCategories).
const DEFAULT_EXPENSE_CATEGORIES = ['Rent', 'Utilities', 'Salary advance', 'Vendor payment', 'Office supplies', 'Travel', 'Food & Welfare', 'Marketing', 'Software / Subscriptions', 'Reimbursement', 'Miscellaneous'];
const EXPENSE_BRANCHES = ['Bhubaneswar', 'Kolkata'];
const PAYMENT_METHODS = ['cash', 'bank', 'upi', 'cheque'];
const BANK_NAMES = ['kotak', 'indian', 'indian_cc'];

async function getExpenseCategories(s) {
  const list = s && s.hrExpenseCategories;
  return Array.isArray(list) && list.length ? list : DEFAULT_EXPENSE_CATEGORIES;
}
// A valid GSTIN is 15 chars: 2 digits, 10-char PAN, 1 entity digit, 'Z', 1 checksum.
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

// ---- Expense categories ----
router.get('/expense-categories', requireHrAccess, async (req, res, next) => {
  try { const s = await Settings.findOne({ where: { singleton: 'settings' } }); res.json({ categories: await getExpenseCategories(s), branches: EXPENSE_BRANCHES }); }
  catch (e) { next(e); }
});
// HR managers + admins can edit the category list.
router.put('/expense-categories', requireHrAccess, async (req, res, next) => {
  try {
    if (!canManagePeople(req)) return res.status(403).json({ error: 'Only an admin or HR manager can edit categories.' });
    const list = Array.isArray(req.body && req.body.categories) ? req.body.categories.map((c) => String(c).trim()).filter(Boolean).slice(0, 60) : null;
    if (!list) return res.status(400).json({ error: 'categories must be an array.' });
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    s.hrExpenseCategories = list; s.changed('hrExpenseCategories', true); await s.save();
    res.json({ categories: list });
  } catch (e) { next(e); }
});

// ---- Vendors ----
router.get('/vendors', requireHrAccess, async (req, res, next) => {
  try {
    const where = {};
    if (req.query.active !== 'all') where.active = true;
    const rows = await HrVendor.findAll({ where, order: [['name', 'ASC']] });
    res.json({ vendors: rows.map((r) => r.toJSON()) });
  } catch (e) { next(e); }
});
function validateVendor(b) {
  const name = String(b.name || '').trim();
  if (!name) return { error: 'Vendor / company name is required.' };
  const hasGst = !!b.hasGst;
  let gstin = null;
  if (hasGst) {
    gstin = String(b.gstin || '').trim().toUpperCase();
    if (gstin.length !== 15 || !GSTIN_RE.test(gstin)) return { error: 'Enter a valid 15-character GSTIN.' };
  }
  // Normalise + validate saved payment modes.
  const modesIn = Array.isArray(b.paymentModes) ? b.paymentModes : [];
  const modes = [];
  for (const m of modesIn) {
    const t = String(m && m.type || '').toLowerCase();
    if (!PAYMENT_METHODS.includes(t)) continue;
    if (t === 'cash' || t === 'cheque') { modes.push({ type: t }); }
    else if (t === 'bank') {
      const bankName = String(m.bankName || '').trim();
      const accountNumber = String(m.accountNumber || '').trim();
      const ifsc = String(m.ifsc || '').trim().toUpperCase();
      if (!accountNumber || !ifsc || !bankName) return { error: 'Bank transfer needs account number, bank name and IFSC.' };
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return { error: 'Enter a valid 11-character IFSC code.' };
      modes.push({ type: 'bank', accountName: String(m.accountName || '').trim(), accountNumber, bankName, ifsc, accountType: String(m.accountType || '').trim() });
    } else if (t === 'upi') {
      const upiId = String(m.upiId || '').trim();
      if (!upiId) return { error: 'UPI needs a UPI ID.' };
      modes.push({ type: 'upi', upiId, mobile: String(m.mobile || '').trim() });
    }
  }
  return {
    data: {
      name, contactPerson: String(b.contactPerson || '').trim() || null,
      phone: String(b.phone || '').trim() || null, email: String(b.email || '').trim() || null,
      address: String(b.address || '').trim() || null, city: String(b.city || '').trim() || null,
      state: String(b.state || '').trim() || null, zip: String(b.zip || '').trim() || null,
      hasGst, gstin, category: String(b.category || '').trim() || null,
      branch: EXPENSE_BRANCHES.includes(b.branch) ? b.branch : null,
      paymentModes: modes,
      // Recurring monthly bill reminder.
      recurringPayment: !!b.recurringPayment,
      recurringDay: b.recurringPayment && Number(b.recurringDay) >= 1 && Number(b.recurringDay) <= 31 ? Number(b.recurringDay) : null,
      recurringAmount: b.recurringPayment && Number(b.recurringAmount) > 0 ? Number(b.recurringAmount) : null,
      recurringLabel: b.recurringPayment ? (String(b.recurringLabel || '').trim() || null) : null,
      notes: String(b.notes || '').trim() || null,
    },
  };
}
router.post('/vendors', requireHrAccess, async (req, res, next) => {
  try {
    if (!canManagePeople(req)) return res.status(403).json({ error: 'Only an admin or HR manager can add vendors.' });
    const v = validateVendor(req.body || {});
    if (v.error) return res.status(400).json({ error: v.error });
    const row = await HrVendor.create({ ...v.data, createdById: req.hrActor.id, createdByName: req.hrActor.name });
    res.status(201).json(row.toJSON());
  } catch (e) { next(e); }
});
router.put('/vendors/:id', requireHrAccess, async (req, res, next) => {
  try {
    if (!canManagePeople(req)) return res.status(403).json({ error: 'Only an admin or HR manager can edit vendors.' });
    const row = await HrVendor.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Vendor not found.' });
    const v = validateVendor(req.body || {});
    if (v.error) return res.status(400).json({ error: v.error });
    Object.assign(row, v.data);
    if (req.body.active !== undefined) row.active = !!req.body.active;
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});
router.delete('/vendors/:id', requireHrAccess, async (req, res, next) => {
  try {
    if (!canManagePeople(req)) return res.status(403).json({ error: 'Only an admin or HR manager can delete vendors.' });
    const row = await HrVendor.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Vendor not found.' });
    // If the vendor has expenses, soft-delete (deactivate) to preserve history.
    const used = await HrExpense.count({ where: { vendorId: row.id } });
    if (used > 0) { row.active = false; await row.save(); return res.json({ ok: true, deactivated: true }); }
    await row.destroy();
    res.json({ ok: true, deleted: true });
  } catch (e) { next(e); }
});
// Vendor payment history — paid expenses for this vendor.
router.get('/vendors/:id/history', requireHrAccess, async (req, res, next) => {
  try {
    const rows = await HrExpense.findAll({ where: { vendorId: req.params.id }, order: [['paidAt', 'DESC'], ['createdAt', 'DESC']] });
    res.json({ expenses: rows.map((r) => r.toJSON()) });
  } catch (e) { next(e); }
});

// ---- Expenses ----
function expenseScopeOk(req, branch) {
  // All-branch managers & admins: any branch. Scoped managers: their branch only.
  if (req.isHrAdmin || req.hrManagerAll || !req.hrManagerScope) return true;
  return String(branch || '').toLowerCase() === String(req.hrManagerScope || req.hrBranch || '').toLowerCase();
}
router.get('/expenses', requireHrAccess, async (req, res, next) => {
  try {
    if (!canManagePeople(req)) return res.status(403).json({ error: 'Only an admin or HR manager can view expenses.' });
    const where = {};
    // Branch scoping for single-branch managers.
    if (!(req.isHrAdmin || req.hrManagerAll || !req.hrManagerScope)) where.branch = req.hrManagerScope || req.hrBranch;
    const rows = await HrExpense.findAll({ where, order: [['expenseDate', 'DESC'], ['createdAt', 'DESC']], limit: 2000 });
    // Attach each vendor's saved payment modes so the Pay window can show full
    // bank-account / cheque-payee details without a second lookup.
    const vendorIds = [...new Set(rows.map((r) => r.vendorId).filter(Boolean))];
    const vendors = vendorIds.length ? await HrVendor.findAll({ where: { id: vendorIds }, attributes: ['id', 'name', 'paymentModes'] }) : [];
    const vendorById = Object.fromEntries(vendors.map((v) => [v.id, v]));
    // Summary counts (INR amounts).
    const monthStr = istDateStr().slice(0, 7);
    let paidThisMonth = 0, totalThisMonth = 0;
    const counts = { submitted: 0, approved: 0, paid: 0, rejected: 0 };
    rows.forEach((r) => {
      counts[r.status] = (counts[r.status] || 0) + 1;
      if ((r.expenseDate || '').slice(0, 7) === monthStr) totalThisMonth += Number(r.amount || 0);
      if (r.status === 'paid' && (r.paymentDate || r.expenseDate || '').slice(0, 7) === monthStr) paidThisMonth += Number(r.amount || 0);
    });
    res.json({
      expenses: rows.map((r) => { const o = r.toJSON(); const v = r.vendorId ? vendorById[r.vendorId] : null; o.vendorPaymentModes = v && Array.isArray(v.paymentModes) ? v.paymentModes : []; return o; }),
      counts: { pending: counts.submitted, approved: counts.approved, paid: counts.paid, rejected: counts.rejected },
      paidThisMonth, totalThisMonth,
    });
  } catch (e) { next(e); }
});
// Employee payment types. HR may use all five; employee self-claims may use all
// EXCEPT 'incentive'. 'other' requires a description.
const EMPLOYEE_PAY_TYPES = ['ta', 'da', 'other', 'advance', 'incentive'];
const EMPLOYEE_CLAIM_PAY_TYPES = ['ta', 'da', 'other', 'advance']; // no incentive
// Normalize a line-items array [{ particular, amount, date? }] → cleaned array
// with positive numeric amounts and trimmed particulars. Returns [] if none.
function sanitizeLineItems(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const li of raw) {
    if (!li) continue;
    const particular = String(li.particular || li.description || '').trim();
    const amount = Number(String(li.amount != null ? li.amount : '').toString().replace(/[^0-9.]/g, ''));
    if (!particular && !(amount > 0)) continue;
    const item = { particular: particular || 'Item', amount: Number.isFinite(amount) && amount > 0 ? amount : 0 };
    const date = String(li.date || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) item.date = date;
    out.push(item);
  }
  return out;
}
function buildExpensePayee(b) {
  const payeeType = b.payeeType === 'employee' ? 'employee' : 'vendor';
  const employeePayType = payeeType === 'employee' && EMPLOYEE_PAY_TYPES.includes(String(b.employeePayType || '').toLowerCase())
    ? String(b.employeePayType).toLowerCase() : null;
  return {
    payeeType,
    vendorId: payeeType === 'vendor' ? (b.vendorId || null) : null,
    employeeId: payeeType === 'employee' ? (b.employeeId || null) : null,
    employeePayType,
  };
}
router.post('/expenses', requireHrAccess, async (req, res, next) => {
  try {
    if (!canManagePeople(req)) return res.status(403).json({ error: 'Only an admin or HR manager can raise expenses.' });
    const b = req.body || {};
    const title = String(b.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Title is required.' });
    if (!EXPENSE_BRANCHES.includes(b.branch)) return res.status(400).json({ error: 'Choose a branch.' });
    if (!expenseScopeOk(req, b.branch)) return res.status(403).json({ error: 'You can only raise expenses for your branch.' });
    const payee = buildExpensePayee(b);
    // Optional itemization: normalize line items and, when present, derive the
    // amount from their sum (the UI locks the amount field in that case).
    const lineItems = sanitizeLineItems(b.lineItems);
    let amount = Number(b.amount || 0);
    if (lineItems && lineItems.length) amount = lineItems.reduce((s, li) => s + li.amount, 0);
    if (!(amount > 0)) return res.status(400).json({ error: 'Enter a valid amount.' });
    if (b.expenseDate !== undefined && b.expenseDate !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.expenseDate))) return res.status(400).json({ error: 'Invalid expense date. Use YYYY-MM-DD.' });
    // Employee payments must carry a pay type; 'other' requires a description.
    if (payee.payeeType === 'employee') {
      if (!payee.employeePayType) return res.status(400).json({ error: 'Choose the type of employee payment (TA, DA, Other, Advance or Incentive).' });
      if (payee.employeePayType === 'other' && !String(b.description || '').trim()) return res.status(400).json({ error: 'Please add details for an "Other expenses" payment.' });
    }
    // Resolve payee name.
    let payeeName = String(b.payeeName || '').trim();
    if (!payeeName && payee.payeeType === 'vendor' && payee.vendorId) { const v = await HrVendor.findByPk(payee.vendorId); payeeName = v ? v.name : ''; }
    if (!payeeName && payee.payeeType === 'employee' && payee.employeeId) { const e = await HrUser.findByPk(payee.employeeId); payeeName = e ? e.name : ''; }
    const row = await HrExpense.create({
      title, category: String(b.category || '').trim() || null, amount, currency: 'INR',
      expenseDate: b.expenseDate || istDateStr(), branch: b.branch, ...payee, payeeName: payeeName || null,
      description: String(b.description || '').trim() || null,
      invoiceUrl: String(b.invoiceUrl || '').trim() || null, invoiceName: String(b.invoiceName || '').trim() || null,
      lineItems: lineItems && lineItems.length ? lineItems : null,
      selectedPaymentMode: (b.selectedPaymentMode && typeof b.selectedPaymentMode === 'object') ? b.selectedPaymentMode : null,
      status: 'submitted', raisedById: req.hrActor.id, raisedByKind: req.hrActor.kind, raisedByName: req.hrActor.name,
    });
    hrLog(req, 'expense.raise', title);
    res.status(201).json(row.toJSON());
  } catch (e) { next(e); }
});
router.put('/expenses/:id', requireHrAccess, async (req, res, next) => {
  try {
    if (!canManagePeople(req)) return res.status(403).json({ error: 'Not allowed.' });
    const row = await HrExpense.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Expense not found.' });
    if (row.status === 'paid') return res.status(400).json({ error: 'A paid expense cannot be edited.' });
    const b = req.body || {};
    if (b.title !== undefined) row.title = String(b.title).trim() || row.title;
    if (b.category !== undefined) row.category = String(b.category).trim() || null;
    if (b.amount !== undefined && Number(b.amount) > 0) row.amount = Number(b.amount);
    if (b.expenseDate !== undefined) row.expenseDate = b.expenseDate;
    if (b.branch !== undefined && EXPENSE_BRANCHES.includes(b.branch)) row.branch = b.branch;
    if (b.description !== undefined) row.description = String(b.description).trim() || null;
    if (b.invoiceUrl !== undefined) { row.invoiceUrl = String(b.invoiceUrl).trim() || null; row.invoiceName = String(b.invoiceName || '').trim() || row.invoiceName; }
    if (b.payeeType !== undefined) { Object.assign(row, buildExpensePayee(b)); if (b.payeeName) row.payeeName = String(b.payeeName).trim(); }
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});
// Admin approves / rejects.
router.post('/expenses/:id/decide', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const row = await HrExpense.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Expense not found.' });
    // A regular expense is approved from 'submitted'. An employee CLAIM is
    // approved by admin from 'hr_approved' (after HR has set the amount).
    const okFrom = row.isClaim ? 'hr_approved' : 'submitted';
    if (row.status !== okFrom) return res.status(400).json({ error: row.isClaim ? 'Only an HR-reviewed claim can be approved or rejected by admin.' : 'Only a submitted expense can be approved or rejected.' });
    const decision = req.body && req.body.decision;
    if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ error: 'Invalid decision.' });
    if (decision === 'approve') {
      row.status = 'approved'; row.approvedById = req.hrActor.id; row.approvedByName = req.hrActor.name; row.approvedAt = new Date();
      // Optional payment-due date (when the vendor should be paid by). A daily
      // job reminds admins + HR 3 days before this date if not yet paid.
      const due = String((req.body && req.body.payDueDate) || '').trim();
      if (due && /^\d{4}-\d{2}-\d{2}$/.test(due)) { row.payDueDate = due; row.payDueReminderSent = null; }
    } else {
      row.status = 'rejected'; row.rejectionReason = String((req.body && req.body.reason) || '').slice(0, 500) || null;
      row.approvedById = req.hrActor.id; row.approvedByName = req.hrActor.name; row.approvedAt = new Date();
    }
    await row.save();
    hrLog(req, `expense.${decision}`, row.title);
    try { if (row.raisedById) await HrNotification.create({ userId: row.raisedById, actorKind: 'hr', type: 'info', text: `${row.isClaim ? 'Your claim' : 'Expense'} "${row.title}" (₹${Number(row.amount).toLocaleString('en-IN')}) was ${decision === 'approve' ? 'approved' : 'rejected'} by ${req.hrActor.name}.${decision === 'approve' && row.isClaim ? ' It will be settled shortly.' : ''}` }); } catch {}
    res.json(row.toJSON());
  } catch (e) { next(e); }
});
// ===== Employee expense-claim flow (self-service reimbursement) =============
// Lifecycle: submitted → hr_approved (HR sets reimbursable amount + notes) →
// approved (admin) → settle (cheque|cash → paid, or salary → queued_for_payroll
// → paid when a payslip picks it up).
//
// Any active employee may raise a claim for themselves. Pay type excludes
// 'incentive'. HR reviews & can only reduce/keep the amount, then admin approves.

// POST /me/claims — employee raises a reimbursement claim for themselves.
router.post('/me/claims', requireHrAccess, async (req, res, next) => {
  try {
    if (req.hrActor.kind !== 'hr') return res.status(403).json({ error: 'Only employees can raise a claim.' });
    const me = req.hrUser;
    const b = req.body || {};
    const title = String(b.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Title is required.' });
    const payType = EMPLOYEE_CLAIM_PAY_TYPES.includes(String(b.employeePayType || '').toLowerCase()) ? String(b.employeePayType).toLowerCase() : null;
    if (!payType) return res.status(400).json({ error: 'Choose the claim type (TA, DA, Other or Advance).' });
    const description = String(b.description || '').trim();
    if (payType === 'other' && !description) return res.status(400).json({ error: 'Please add details for an "Other expenses" claim.' });
    // Itemized claim: when line items are supplied (one per invoice particular,
    // possibly across several uploaded files), the claimed amount is their sum.
    const lineItems = sanitizeLineItems(b.lineItems);
    let amount = Number(b.amount || 0);
    if (lineItems && lineItems.length) amount = lineItems.reduce((s, li) => s + li.amount, 0);
    if (!(amount > 0)) return res.status(400).json({ error: 'Enter a valid amount, or add at least one invoice item.' });
    // Multiple invoice attachments [{ url, name, date }].
    const attachments = Array.isArray(b.attachments) ? b.attachments
      .filter((a) => a && a.url).map((a) => ({ url: String(a.url), name: String(a.name || 'invoice'), ...(/^\d{4}-\d{2}-\d{2}$/.test(String(a.date || '')) ? { date: a.date } : {}) }))
      .slice(0, 20) : [];
    const firstAtt = attachments[0] || null;
    const row = await HrExpense.create({
      title, category: 'Reimbursement', amount, currency: 'INR',
      expenseDate: b.expenseDate || (firstAtt && firstAtt.date) || istDateStr(), branch: me.branch || 'Bhubaneswar',
      payeeType: 'employee', employeeId: me.id, payeeName: me.name, employeePayType: payType,
      description: description || null,
      // Keep the first file in the single-invoice fields for back-compat, and the
      // full set in attachments.
      invoiceUrl: (firstAtt && firstAtt.url) || String(b.invoiceUrl || '').trim() || null,
      invoiceName: (firstAtt && firstAtt.name) || String(b.invoiceName || '').trim() || null,
      attachments: attachments.length ? attachments : null,
      lineItems: lineItems && lineItems.length ? lineItems : null,
      status: 'submitted', isClaim: true, claimedAmount: amount,
      raisedById: me.id, raisedByKind: 'hr', raisedByName: me.name,
    });
    hrLog(req, 'claim.raise', title);
    res.status(201).json(row.toJSON());
  } catch (e) { next(e); }
});

// GET /me/claims — the caller's own claims.
router.get('/me/claims', requireHrAccess, async (req, res, next) => {
  try {
    if (req.hrActor.kind !== 'hr') return res.json({ claims: [] });
    const rows = await HrExpense.findAll({ where: { isClaim: true, employeeId: req.hrActor.id }, order: [['createdAt', 'DESC']], limit: 500 });
    res.json({ claims: rows.map((r) => r.toJSON()) });
  } catch (e) { next(e); }
});

// GET /claims — claims for HR/admin to review, branch-scoped. Optional ?status=.
router.get('/claims', requireHrAccess, async (req, res, next) => {
  try {
    if (!canManagePeople(req)) return res.status(403).json({ error: 'Only an admin or HR manager can view claims.' });
    const where = { isClaim: true };
    if (!(req.isHrAdmin || req.hrManagerAll || !req.hrManagerScope)) where.branch = req.hrManagerScope || req.hrBranch;
    if (req.query.status) where.status = String(req.query.status);
    const rows = await HrExpense.findAll({ where, order: [['createdAt', 'DESC']], limit: 1000 });
    const counts = { submitted: 0, hr_approved: 0, approved: 0, queued_for_payroll: 0, paid: 0, rejected: 0 };
    (await HrExpense.findAll({ where: { isClaim: true, ...(where.branch ? { branch: where.branch } : {}) }, attributes: ['status'] }))
      .forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
    res.json({ claims: rows.map((r) => r.toJSON()), counts });
  } catch (e) { next(e); }
});

// POST /expenses/:id/hr-review — HR sets the reimbursable amount + notes.
// Moves a claim submitted → hr_approved, or rejects it. HR may only reduce or
// keep the claimed amount, never increase it.
router.post('/expenses/:id/hr-review', requireHrAccess, async (req, res, next) => {
  try {
    if (!canManagePeople(req)) return res.status(403).json({ error: 'Only an admin or HR manager can review claims.' });
    const row = await HrExpense.findByPk(req.params.id);
    if (!row || !row.isClaim) return res.status(404).json({ error: 'Claim not found.' });
    if (row.status !== 'submitted') return res.status(400).json({ error: 'Only a submitted claim can be reviewed.' });
    const b = req.body || {};
    const decision = b.decision;
    if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ error: 'Invalid decision.' });
    if (decision === 'reject') {
      row.status = 'rejected';
      row.hrReviewNotes = String(b.notes || '').slice(0, 1000) || null;
      row.hrReviewedById = req.hrActor.id; row.hrReviewedByName = req.hrActor.name; row.hrReviewedAt = new Date();
      row.rejectionReason = String(b.notes || 'Rejected by HR').slice(0, 500);
      await row.save();
      hrLog(req, 'claim.hr_reject', row.title);
      try { await HrNotification.create({ userId: row.employeeId, actorKind: 'hr', type: 'info', text: `Your claim "${row.title}" was rejected by ${req.hrActor.name}.` }); } catch {}
      return res.json(row.toJSON());
    }
    // approve → set reimbursable amount (≤ claimed) + notes.
    const approvedAmount = Number(b.approvedAmount);
    const claimed = Number(row.claimedAmount || row.amount || 0);
    if (!(approvedAmount > 0)) return res.status(400).json({ error: 'Enter the reimbursable amount.' });
    if (approvedAmount > claimed) return res.status(400).json({ error: `The reimbursable amount cannot exceed the claimed amount (₹${claimed.toLocaleString('en-IN')}).` });
    row.approvedAmount = approvedAmount;
    row.amount = approvedAmount; // the amount that will actually be paid
    row.hrReviewNotes = String(b.notes || '').slice(0, 1000) || null;
    row.hrReviewedById = req.hrActor.id; row.hrReviewedByName = req.hrActor.name; row.hrReviewedAt = new Date();
    row.status = 'hr_approved';
    await row.save();
    hrLog(req, 'claim.hr_approve', row.title);
    try {
      const note = approvedAmount < claimed ? ` (adjusted from ₹${claimed.toLocaleString('en-IN')})` : '';
      await HrNotification.create({ userId: row.employeeId, actorKind: 'hr', type: 'info', text: `Your claim "${row.title}" was reviewed by ${req.hrActor.name}. Reimbursable: ₹${approvedAmount.toLocaleString('en-IN')}${note}. Awaiting final approval.` });
    } catch {}
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

// POST /expenses/:id/settle — after admin approval, choose how a claim is paid.
//   settlementMethod: 'cheque' | 'cash' → stays 'approved', settle via pay window.
//   settlementMethod: 'salary' → status 'queued_for_payroll' (picked up by payslip).
router.post('/expenses/:id/settle', requireHrAccess, async (req, res, next) => {
  try {
    if (!canManagePeople(req)) return res.status(403).json({ error: 'Not allowed.' });
    const row = await HrExpense.findByPk(req.params.id);
    if (!row || !row.isClaim) return res.status(404).json({ error: 'Claim not found.' });
    if (row.status !== 'approved') return res.status(400).json({ error: 'Only an approved claim can be settled.' });
    const method = String((req.body && req.body.settlementMethod) || '').toLowerCase();
    if (!['cheque', 'cash', 'salary'].includes(method)) return res.status(400).json({ error: 'Choose how to settle: cheque, cash or next salary.' });
    row.settlementMethod = method;
    if (method === 'salary') {
      row.status = 'queued_for_payroll';
      await row.save();
      hrLog(req, 'claim.queue_salary', row.title);
      try { await HrNotification.create({ userId: row.employeeId, actorKind: 'hr', type: 'info', text: `Your claim "${row.title}" (₹${Number(row.amount).toLocaleString('en-IN')}) will be added to your next salary.` }); } catch {}
    } else {
      // cheque / cash → leave as 'approved' so the existing Pay window settles it.
      await row.save();
      hrLog(req, 'claim.settle_' + method, row.title);
    }
    res.json(row.toJSON());
  } catch (e) { next(e); }
});


// --- Payslip integration (ready for the future payroll module) --------------
// Returns approved claims queued to be paid via salary and not yet on a payslip.
// The payslip module calls this to add a "Reimbursements" line, then calls
// markReimbursementsPaid() with the payslip id.
async function getPendingSalaryReimbursements(employeeId /*, month */) {
  const where = { isClaim: true, status: 'queued_for_payroll', settlementMethod: 'salary', payslipId: null };
  if (employeeId) where.employeeId = employeeId;
  const rows = await HrExpense.findAll({ where, order: [['approvedAt', 'ASC']] });
  return rows.map((r) => ({ id: r.id, employeeId: r.employeeId, title: r.title, amount: Number(r.amount || 0), payType: r.employeePayType, approvedAt: r.approvedAt }));
}
// Mark queued claims as paid and stamp the payslip they were included in.
async function markReimbursementsPaid(claimIds, payslipId, actor) {
  if (!Array.isArray(claimIds) || !claimIds.length) return 0;
  const rows = await HrExpense.findAll({ where: { id: claimIds, isClaim: true, status: 'queued_for_payroll' } });
  for (const r of rows) {
    r.status = 'paid'; r.paymentMethod = 'salary'; r.payslipId = payslipId || null;
    r.paymentDate = istDateStr(); r.paidById = actor ? actor.id : null; r.paidByName = actor ? actor.name : 'Payroll'; r.paidAt = new Date();
    await r.save();
  }
  return rows.length;
}
// Expose the queue now (admin/HR); the payslip UI comes later.
router.get('/reimbursements/pending-salary', requireHrAccess, async (req, res, next) => {
  try {
    if (!canManagePeople(req)) return res.status(403).json({ error: 'Not allowed.' });
    const employeeId = req.query.employeeId ? Number(req.query.employeeId) : null;
    const items = await getPendingSalaryReimbursements(employeeId);
    res.json({ items, total: items.reduce((s, x) => s + x.amount, 0) });
  } catch (e) { next(e); }
});

router.get('/expenses/monthly', requireHrAccess, async (req, res, next) => {
  try {
    if (!canManagePeople(req)) return res.status(403).json({ error: 'Not allowed.' });
    const where = {};
    if (!(req.isHrAdmin || req.hrManagerAll || !req.hrManagerScope)) where.branch = req.hrManagerScope || req.hrBranch;
    const rows = await HrExpense.findAll({ where, limit: 5000 });
    const byMonth = {};
    for (const r of rows) {
      const m = (r.expenseDate || '').slice(0, 7);
      if (!m) continue;
      if (!byMonth[m]) byMonth[m] = { month: m, count: 0, total: 0, paid: 0 };
      byMonth[m].count++; byMonth[m].total += Number(r.amount || 0);
      if (r.status === 'paid') byMonth[m].paid += Number(r.amount || 0);
    }
    const months = Object.values(byMonth).sort((a, b) => b.month.localeCompare(a.month)).map((m) => {
      const [y, mo] = m.month.split('-');
      const label = new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      return { ...m, label };
    });
    res.json({ months });
  } catch (e) { next(e); }
});

// AI invoice reader: HR uploads an invoice, we extract vendor/amount/date and
// pre-fill the New Expense form. Mirrors the candidate resume parser (Claude).
// Accepts { base64, fileName }. Falls back gracefully — the caller still keeps
// the file as the attachment even if parsing returns nothing.
router.post('/expenses/parse-invoice', requireHrAccess, async (req, res, next) => {
  try {
    if (!canManagePeople(req)) return res.status(403).json({ error: 'Not allowed.' });
    const b = req.body || {};
    const base64 = String(b.base64 || '');
    const fileName = String(b.fileName || '');
    if (!base64) return res.status(400).json({ error: 'No file provided.' });
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const apiKey = s && s.getKey ? s.getKey('anthropic') : null;
    if (!apiKey) return res.json({ ok: false, reason: 'ai_unavailable', fields: null });

    const { parseInvoice, extractFileText } = require('../services/hrRecruitAI');
    // Decide image vs text. Images go to Claude vision; PDFs/DOCX are extracted.
    const m = base64.match(/^data:([^;]+);base64,(.*)$/s);
    const mime = m ? m[1] : '';
    const isImage = /image\//.test(mime) || /\.(png|jpe?g|webp|gif)$/i.test(fileName);
    let fields = null;
    try {
      if (isImage) {
        const data = m ? m[2] : base64;
        fields = await parseInvoice(apiKey, { image: { base64: data, mediaType: mime || 'image/jpeg' } });
      } else {
        const text = await extractFileText({ base64, fileName });
        if (!text || !text.trim()) return res.json({ ok: false, reason: 'no_text', fields: null });
        fields = await parseInvoice(apiKey, { text });
      }
    } catch (e) {
      return res.json({ ok: false, reason: 'parse_failed', error: e.message, fields: null });
    }

    // Try to match the extracted vendor name to an existing active vendor.
    let matchedVendorId = null; let matchedVendorName = null;
    const vn = String((fields && fields.vendorName) || '').trim().toLowerCase();
    if (vn) {
      const vendors = await HrVendor.findAll({ where: { active: true } });
      // exact, then contains, then token overlap.
      let hit = vendors.find((v) => v.name.toLowerCase() === vn)
        || vendors.find((v) => v.name.toLowerCase().includes(vn) || vn.includes(v.name.toLowerCase()));
      if (hit) { matchedVendorId = hit.id; matchedVendorName = hit.name; }
    }
    res.json({ ok: true, fields, matchedVendorId, matchedVendorName });
  } catch (e) { next(e); }
});

// Mark an approved expense as paid (raising HR or admin).
router.post('/expenses/:id/pay', requireHrAccess, async (req, res, next) => {
  try {
    if (!canManagePeople(req)) return res.status(403).json({ error: 'Not allowed.' });
    const row = await HrExpense.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Expense not found.' });
    if (row.status !== 'approved') return res.status(400).json({ error: 'Only an approved expense can be marked paid.' });
    const b = req.body || {};
    const method = String(b.paymentMethod || '').toLowerCase();
    if (!PAYMENT_METHODS.includes(method)) return res.status(400).json({ error: 'Choose a payment method.' });
    row.paymentMethod = method;
    row.paymentDate = b.paymentDate || istDateStr();
    row.paymentRef = String(b.paymentRef || '').trim() || null;
    // Reset method-specific fields, then set the ones relevant to this method.
    row.bankName = null; row.paymentUpiId = null; row.paymentMobile = null;
    row.chequeNumber = null; row.chequeBank = null; row.chequeDate = null;
    if (method === 'bank') {
      if (!BANK_NAMES.includes(String(b.bankName || ''))) return res.status(400).json({ error: 'Choose the bank for the transfer.' });
      row.bankName = b.bankName;
      if (!row.paymentRef) return res.status(400).json({ error: 'Transaction ID is required for a bank transfer.' });
    } else if (method === 'upi') {
      row.paymentUpiId = String(b.paymentUpiId || '').trim() || null;
      row.paymentMobile = String(b.paymentMobile || '').trim() || null;
      if (!row.paymentUpiId) return res.status(400).json({ error: 'UPI ID is required for a UPI payment.' });
      if (!row.paymentRef) return res.status(400).json({ error: 'UPI transaction / reference ID is required.' });
    } else if (method === 'cheque') {
      row.chequeNumber = String(b.chequeNumber || b.paymentRef || '').trim() || null;
      row.chequeBank = String(b.chequeBank || '').trim() || null;
      row.chequeDate = String(b.chequeDate || '').trim() || null;
      if (!row.chequeNumber) return res.status(400).json({ error: 'Cheque number is required.' });
      // Keep paymentRef mirrored to the cheque number for backward compatibility.
      row.paymentRef = row.chequeNumber;
    }
    row.status = 'paid'; row.paidById = req.hrActor.id; row.paidByName = req.hrActor.name; row.paidAt = new Date();
    await row.save();
    hrLog(req, 'expense.pay', row.title);
    res.json(row.toJSON());
  } catch (e) { next(e); }
});
router.delete('/expenses/:id', requireHrAccess, async (req, res, next) => {
  try {
    if (!canManagePeople(req)) return res.status(403).json({ error: 'Not allowed.' });
    const row = await HrExpense.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Expense not found.' });
    if (row.status === 'paid') return res.status(400).json({ error: 'A paid expense cannot be deleted.' });
    await row.destroy();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- Feedback & Error Reports (raised from the fixed side button) ----

// POST /feedback → anyone signed into the HRMS can raise a bug/suggestion.
router.post('/feedback', requireHrAccess, async (req, res, next) => {
  try {
    const b = req.body || {};
    const message = String(b.message || '').trim();
    if (!message) return res.status(400).json({ error: 'Please describe the issue or feedback.' });
    const kind = ['bug', 'suggestion', 'other'].includes(b.kind) ? b.kind : 'bug';
    const actor = req.hrActor;
    const email = actor.kind === 'hr' ? (req.hrUser && req.hrUser.email) : (req.adminUser && req.adminUser.email);
    const row = await HrFeedback.create({
      reporterId: actor.id, reporterKind: actor.kind, reporterName: actor.name, reporterEmail: email || null,
      kind, message: message.slice(0, 5000),
      pageUrl: String(b.pageUrl || '').slice(0, 400) || null,
      screenshotUrl: String(b.screenshotUrl || '').slice(0, 600) || null,
      userAgent: String(b.userAgent || '').slice(0, 400) || null,
      status: 'new',
    });
    res.status(201).json(row.toJSON());
  } catch (e) { next(e); }
});

// GET /feedback → admin-only list of reports, newest first (optional ?status=).
router.get('/feedback', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const where = {};
    if (req.query.status && ['new', 'seen', 'resolved'].includes(req.query.status)) where.status = req.query.status;
    const rows = await HrFeedback.findAll({ where, order: [['createdAt', 'DESC']], limit: 300 });
    const counts = { new: 0, seen: 0, resolved: 0 };
    (await HrFeedback.findAll({ attributes: ['status'] })).forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
    res.json({ items: rows.map((r) => r.toJSON()), counts });
  } catch (e) { next(e); }
});

// PATCH /feedback/:id → admin updates status / adds an internal note.
router.patch('/feedback/:id', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const row = await HrFeedback.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Report not found.' });
    const b = req.body || {};
    if (b.status !== undefined && ['new', 'seen', 'resolved'].includes(b.status)) row.status = b.status;
    if (b.adminNote !== undefined) row.adminNote = String(b.adminNote || '').slice(0, 2000);
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

// GET /me/quote-of-the-day → today's motivational quote for the dashboard hero.
router.get('/me/quote-of-the-day', requireHrAccess, async (req, res, next) => {
  try {
    const { getDailyQuote } = require('../services/dailyQuote');
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const apiKey = s && s.getKey ? s.getKey('openai') : null;
    const q = await getDailyQuote({ settings: s, apiKey });
    res.json(q);
  } catch (e) {
    // Never break the dashboard over a quote — return a safe fallback.
    try { const { fallbackFor } = require('../services/dailyQuote'); const d = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10); res.json({ ...fallbackFor(d), date: d }); }
    catch { res.json({ quote: 'The best way to predict the future is to create it.', author: 'Peter Drucker' }); }
  }
});

// GET /me/celebrations → company-wide birthdays / work anniversaries / new joinees.
router.get('/me/celebrations', requireHrAccess, async (req, res, next) => {
  try {
    const all = await HrUser.findAll({ where: { active: true } });
    const today = nowIST();
    const md = (d) => { const x = new Date(d); return [x.getMonth(), x.getDate()]; };
    const within = (d, days) => {
      if (!d) return null; const [mo, da] = md(d);
      const now = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      let next = new Date(today.getFullYear(), mo, da);
      if (next < now) next = new Date(today.getFullYear() + 1, mo, da);
      const diff = Math.round((next - now) / 86400000);
      return diff <= days ? diff : null;
    };
    const lbl = (diff) => diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : `in ${diff}d`;
    const birthdays = [], annivs = [], joinees = [];
    all.forEach((u) => {
      const bd = within(u.birthday, 30);
      if (bd != null) birthdays.push({ name: u.name, sub: `${u.department || ''}${u.branch ? ' · ' + u.branch : ''}`, when: lbl(bd), diff: bd });
      if (u.joiningDate) {
        const ja = within(u.joiningDate, 30);
        const years = today.getFullYear() - new Date(u.joiningDate).getFullYear();
        if (ja != null && years >= 1) annivs.push({ name: u.name, sub: `${years} year${years > 1 ? 's' : ''} · ${u.department || ''}`, when: lbl(ja), diff: ja });
        // New joinees: joined within the last 30 days.
        const jd = new Date(u.joiningDate); const daysSince = Math.round((today - jd) / 86400000);
        if (daysSince >= 0 && daysSince <= 30) joinees.push({ name: u.name, sub: `${u.department || ''}${u.branch ? ' · ' + u.branch : ''}`, when: 'New', diff: daysSince });
      }
    });
    birthdays.sort((a, b) => a.diff - b.diff); annivs.sort((a, b) => a.diff - b.diff); joinees.sort((a, b) => a.diff - b.diff);
    res.json({ birthdays, anniversaries: annivs, joinees });
  } catch (e) { next(e); }
});

// GET /me/attendance-calendar?month=YYYY-MM → the signed-in employee's own month
// of attendance for the calendar popup (present/late/absent/leave/holiday/weekoff).
router.get('/me/attendance-calendar', requireHrAccess, async (req, res, next) => {
  try {
    if (req.hrActor.kind !== 'hr') return res.json({ month: '', days: {} });
    const emp = await HrUser.findByPk(req.hrActor.id);
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : istDateStr().slice(0, 7);
    const rows = await HrAttendance.findAll({ where: { employeeId: emp.id } });
    const marks = {};
    rows.forEach((r) => { if (String(r.date).slice(0, 7) === month) marks[r.date] = r; });
    const holidaysAll = await HrHoliday.findAll();
    const holidays = {};
    holidaysAll.forEach((h) => { if (String(h.date).slice(0, 7) === month && (!h.branch || h.branch === emp.branch)) holidays[String(h.date)] = h.name; });
    const [y, m] = month.split('-').map(Number);
    const dim = new Date(y, m, 0).getDate();
    const days = {};
    for (let d = 1; d <= dim; d++) {
      const ds = `${month}-${String(d).padStart(2, '0')}`;
      const mk = marks[ds];
      let status = 'none';
      if (holidays[ds]) status = 'holiday';
      else if (branchWeekendOff(ds, emp.branch)) status = 'weekoff';
      else if (mk) {
        if (mk.status === 'leave' || mk.status === 'half_day') status = 'leave';
        else if (mk.status === 'wfh') status = 'present';
        else if (mk.status === 'absent' || mk.status === 'lop') status = 'absent';
        else if (mk.loginTime) status = mk.late ? 'late' : 'present';
      }
      days[ds] = { status, login: mk ? mk.loginTime : null, logout: mk ? mk.logoutTime : null, holiday: holidays[ds] || null,
        timeEdited: mk && mk.timeEditedAt ? { byName: mk.timeEditedByName, byAvatar: mk.timeEditedByAvatar, at: mk.timeEditedAt, originalLogin: mk.originalLoginTime, originalLogout: mk.originalLogoutTime } : null };
    }
    res.json({ month, branch: emp.branch, days });
  } catch (e) { next(e); }
});

// PUT /attendance/day/:date  → bulk upsert marks for a day.
// body: { entries: [{ employeeId, status, loginTime?, logoutTime?, leaveType? }] }
// status: present | absent_leave | half_day | lop
router.put('/attendance/day/:date', requireHrAccess, async (req, res, next) => {
  try {
    if (!canManagePeople(req)) return res.status(403).json({ error: 'Only an admin or HR manager can mark attendance.' });
    const date = String(req.params.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date.' });
    const entries = Array.isArray(req.body && req.body.entries) ? req.body.entries : [];
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const policy = getHrPolicy(s);
    const grace = Number(policy.lateRule.graceMinutes) || 30;
    const toMin = (t) => { if (!t) return null; const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
    const VALID = ['present', 'absent_leave', 'half_day', 'lop', 'wfh'];
    const LEAVE_TYPES = ['casual', 'medical', 'privilege', 'wfh'];
    const WFH_YEARLY_CAP = 12;

    const results = [];
    for (const en of entries) {
      const emp = await HrUser.findByPk(Number(en.employeeId));
      if (!emp) { results.push({ employeeId: en.employeeId, error: 'not found' }); continue; }
      if (!canManageBranch(req, emp.branch)) { results.push({ employeeId: en.employeeId, error: 'out of scope' }); continue; }
      // Toggled-off → remove this day's attendance + leave for the employee.
      if (en.clear) {
        await HrAttendance.destroy({ where: { employeeId: emp.id, date } });
        await HrLeave.destroy({ where: { employeeId: emp.id, date } });
        results.push({ employeeId: emp.id, cleared: true });
        continue;
      }
      let status = VALID.includes(en.status) ? en.status : 'present';
      let note = null;
      let forcedLop = false;
      let wfhExtra = false, wfhDeficit = false;

      // WFH — a WORK status (counts present). Tracked by date like leave.
      // Yearly cap 12 (block the 13th); 2nd+ in a month is flagged for a 30%
      // per-day payroll deduction; under 8h worked is flagged as a time deficit.
      if (status === 'wfh') {
        const year = date.slice(0, 4);
        const month = date.slice(0, 7);
        const yearRows = await HrAttendance.findAll({ where: { employeeId: emp.id, status: 'wfh', date: { [Op.like]: `${year}-%` } } });
        const yearUsed = yearRows.filter((r) => r.date !== date).length;
        if (yearUsed >= WFH_YEARLY_CAP) { results.push({ employeeId: emp.id, error: 'wfh yearly limit reached (12)' }); continue; }
        const monthUsed = yearRows.filter((r) => r.date !== date && r.date.slice(0, 7) === month).length;
        wfhExtra = monthUsed >= 1; // this WFH is the 2nd+ in the month → 30% deduction
        // Time-deficit: need >= 8h between login and logout.
        const li = toMin(en.loginTime), lo = toMin(en.logoutTime);
        if (li != null && lo != null) { const worked = lo - li; wfhDeficit = worked < 8 * 60; }
        note = 'wfh' + (wfhExtra ? ':extra' : '') + (wfhDeficit ? ':deficit' : '');
        await HrLeave.destroy({ where: { employeeId: emp.id, date } });
      } else if (status === 'absent_leave' || status === 'half_day') {
        // Leave-backed statuses deduct from the chosen leave type's balance NOW.
        // If balance is insufficient, force LOP (no negative balances).
        const leaveType = ['casual', 'medical', 'privilege'].includes(en.leaveType) ? en.leaveType : (en.leaveType === 'wfh' ? null : null);
        if (!leaveType) { results.push({ employeeId: en.employeeId, error: 'leave type required' }); continue; }
        const need = status === 'half_day' ? 0.5 : 1;
        const alloc = { ...DEFAULT_LEAVE_ALLOCATION, ...((emp.profile && emp.profile.leaveAllocation) || {}) };
        const month = date.slice(0, 7);
        const existing = await HrLeave.findAll({ where: { employeeId: emp.id, type: leaveType } });
        let used = 0;
        existing.forEach((l) => { if (l.date !== date && String(l.date).slice(0, 7) === month) used += (l.duration === 'half' ? 0.5 : 1); });
        const remaining = (Number(alloc[leaveType]) || 0) - used;
        if (remaining >= need) {
          await HrLeave.destroy({ where: { employeeId: emp.id, date } });
          await HrLeave.create({ employeeId: emp.id, type: leaveType, date, duration: need === 0.5 ? 'half' : 'full', paid: true, status: 'approved', appliedById: req.hrActor ? req.hrActor.id : null });
          note = 'leave:' + leaveType;
        } else {
          await HrLeave.destroy({ where: { employeeId: emp.id, date } });
          forcedLop = true;
          if (status === 'absent_leave') { status = 'lop'; note = 'lop:no_balance'; }
          else { note = 'half_lop:no_balance'; }
        }
      } else {
        // present / lop → clear any leave record for the date.
        await HrLeave.destroy({ where: { employeeId: emp.id, date } });
      }

      // Late detection for present/half_day with a login time and a shift start.
      // WFH is NOT late-checked (they can log in anytime; 8h deficit rule applies).
      let late = false;
      if ((status === 'present' || status === 'half_day')) {
        const sh = emp.shiftId ? await HrShift.findByPk(emp.shiftId) : null;
        const start = sh && sh.startTime ? sh.startTime : null;
        const login = toMin(en.loginTime);
        if (start && login != null) late = login > (toMin(start) + grace);
      }

      // Map to the HrAttendance.status vocabulary. WFH stored as 'wfh'.
      const attStatus = status === 'absent_leave' ? 'leave' : status; // present|half_day|lop|leave|wfh
      const approvedBy = (status === 'absent_leave' || status === 'half_day' || status === 'wfh') ? (String(en.approvedBy || '').slice(0, 160) || null) : null;
      const notes = en.notes ? String(en.notes).slice(0, 500) : null;
      const [row] = await HrAttendance.findOrCreate({ where: { employeeId: emp.id, date }, defaults: { status: attStatus } });
      const newLogin = en.loginTime || null;
      const newLogout = en.logoutTime || null;
      // Audit: if HR changes a login/logout time that already had a value (i.e. an
      // override of what the employee web-clocked, or a prior manual entry), record
      // who corrected it, when, and the original times. First correction captures
      // the true original; later edits keep the earliest original.
      const timeChanged = (row.loginTime || null) !== newLogin || (row.logoutTime || null) !== newLogout;
      const hadClock = !!(row.loginTime || row.logoutTime);
      if (timeChanged && hadClock) {
        if (!row.timeEditedAt) { // capture the pre-edit original only once
          row.originalLoginTime = row.loginTime || null;
          row.originalLogoutTime = row.logoutTime || null;
        }
        row.timeEditedById = req.hrActor ? req.hrActor.id : null;
        row.timeEditedByName = req.hrActor ? req.hrActor.name : null;
        row.timeEditedByAvatar = emp && req.hrUser ? (req.hrUser.avatar || null) : null;
        row.timeEditedAt = new Date();
      }
      row.status = attStatus;
      row.loginTime = newLogin;
      row.logoutTime = newLogout;
      row.late = late;
      row.note = note;
      row.approvedBy = approvedBy;
      row.notes = notes;
      row.markedById = req.hrActor ? req.hrActor.id : null;
      await row.save();
      // Mirror approver onto the leave record where one was created.
      if (note && note.startsWith('leave:') && approvedBy) {
        const lv = await HrLeave.findOne({ where: { employeeId: emp.id, date } });
        if (lv) { lv.approvedBy = approvedBy; if (notes) lv.reason = notes; await lv.save(); }
      }
      results.push({ employeeId: emp.id, status: attStatus, late, forcedLop, wfhExtra, wfhDeficit });
    }
    hrLog(req, 'attendance.day', `${date}: ${results.length} employees`);
    res.json({ date, results });
  } catch (e) { next(e); }
});

// GET /attendance/late-penalties?month=YYYY-MM&branch= → per-employee late counters.
// Rule (thresholds from editable global setting): every N consecutive working-day
// late entries earns one half-day penalty; PLUS every M late entries in the month
// not consumed by a streak earns one more. Counters only — payroll reads these.
router.get('/attendance/late-penalties', requireHrAccess, async (req, res, next) => {
  try {
    if (!canManagePeople(req)) return res.status(403).json({ error: 'Not allowed.' });
    const month = String(req.query.month || '').match(/^\d{4}-\d{2}$/) ? req.query.month : new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7);
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const policy = getHrPolicy(s);
    const consecThreshold = Number(policy.lateRule.consecutiveForHalfDay) || 3;
    const monthlyThreshold = Number(policy.lateRule.monthlyForHalfDay) || 6;
    const branches = await scopedBranches(req);
    let branch = req.query.branch ? String(req.query.branch) : '';
    if (branch && !branches.some((b) => b.toLowerCase() === branch.toLowerCase())) return res.status(403).json({ error: 'Branch not in your scope.' });
    const activeBranches = branch ? [branch] : branches;

    const emps = (await HrUser.findAll({ where: { active: true }, order: [['name', 'ASC']] }))
      .filter((e) => activeBranches.some((b) => b.toLowerCase() === String(e.branch || '').toLowerCase()));
    const rows = await HrAttendance.findAll({ where: { date: { [Op.like]: `${month}-%` }, late: true }, order: [['date', 'ASC']] });
    const lateByEmp = {}; rows.forEach((r) => { (lateByEmp[r.employeeId] = lateByEmp[r.employeeId] || []).push(r.date); });

    const out = emps.map((e) => {
      const dates = (lateByEmp[e.id] || []).slice().sort();
      let penalties = 0, consumed = 0, runLen = 0, prev = null;
      const isWorkday = (dStr) => !branchWeekendOff(dStr, e.branch);
      for (const d of dates) {
        if (prev) {
          let gapHasWorkday = false;
          const cur = new Date(prev + 'T00:00:00');
          cur.setDate(cur.getDate() + 1);
          const end = new Date(d + 'T00:00:00');
          while (cur < end) {
            const ds = cur.toISOString().slice(0, 10);
            if (isWorkday(ds)) { gapHasWorkday = true; break; }
            cur.setDate(cur.getDate() + 1);
          }
          runLen = gapHasWorkday ? 1 : runLen + 1;
        } else runLen = 1;
        prev = d;
        if (runLen >= consecThreshold) { penalties += 1; consumed += consecThreshold; runLen = 0; }
      }
      const remaining = dates.length - consumed;
      const monthlyPenalties = monthlyThreshold > 0 ? Math.floor(remaining / monthlyThreshold) : 0;
      penalties += monthlyPenalties;
      return { employeeId: e.id, name: e.name, branch: e.branch, lateCount: dates.length, halfDayPenalties: penalties };
    });
    res.json({ month, branch: branch || null, consecThreshold, monthlyThreshold, employees: out });
  } catch (e) { next(e); }
});

// GET /attendance/day/:date/summary → the four summary boxes (half-day = 0.5 present)
router.get('/attendance/day/:date/summary', requireHrAccess, async (req, res, next) => {
  try {
    if (!canManagePeople(req)) return res.status(403).json({ error: 'Not allowed.' });
    const date = String(req.params.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date.' });
    const branches = await scopedBranches(req);
    const allHolidays = await HrHoliday.findAll();
    const branchHoliday = (br) => allHolidays.some((h) => String(h.date) === date && (!h.branch || String(h.branch).toLowerCase() === String(br || '').toLowerCase()));
    const activeEmps = (await HrUser.findAll({ where: { active: true } }))
      .filter((e) => branches.some((b) => b.toLowerCase() === String(e.branch || '').toLowerCase()))
      .filter((e) => !branchWeekendOff(date, e.branch) && !branchHoliday(e.branch));
    const marks = {}; (await HrAttendance.findAll({ where: { date } })).forEach((m) => { marks[m.employeeId] = m; });
    // WFH counts as present (they're working). Half-day = 0.5.
    const presentVal = (m) => { if (!m) return 0; if (m.status === 'present' || m.status === 'wfh') return 1; if (m.status === 'half_day') return 0.5; return 0; };
    const byBranch = {};
    let totalPresent = 0, totalAbsent = 0, lateCount = 0, total = activeEmps.length;
    for (const e of activeEmps) {
      const bk = e.branch || '—';
      byBranch[bk] = byBranch[bk] || { present: 0, total: 0 };
      byBranch[bk].total += 1;
      const m = marks[e.id];
      const pv = presentVal(m);
      byBranch[bk].present += pv;
      totalPresent += pv;
      if (pv === 0 && m) totalAbsent += 1; // marked but not present (leave/lop)
      if (m && m.late) lateCount += 1;
    }
    const pct = (p, t) => t > 0 ? Math.round((p / t) * 100) : 0;
    // Include EVERY scoped branch, even ones that are off this date, so the
    // per-branch box always shows (as "Week Off" when the branch is off).
    const branchList = branches.map((b) => {
      const off = branchWeekendOff(date, b) || branchHoliday(b);
      const v = byBranch[b] || { present: 0, total: 0 };
      return { branch: b, count: v.present, present: v.present, total: v.total, pct: pct(v.present, v.total), weekOff: off && v.total === 0, holiday: branchHoliday(b) };
    });
    res.json({
      date,
      present: { count: totalPresent, value: totalPresent, total, pct: pct(totalPresent, total) },
      byBranch: branchList,
      absent: { count: totalAbsent },
      late: { count: lateCount },
    });
  } catch (e) { next(e); }
});

// Record a leave. Enforces the probation/notice rule: paid leave isn't allowed
// then, but the leave can still be taken as UNPAID.
router.post('/employees/:id/leave', requireHrAccess, async (req, res, next) => {
  try {
    if (!canManagePeople(req)) return res.status(403).json({ error: 'Only an admin or HR manager can record leave.' });
    const id = Number(req.params.id);
    const emp = await HrUser.findByPk(id);
    if (!emp) return res.status(404).json({ error: 'Employee not found.' });
    if (!canManageBranch(req, emp.branch)) return res.status(403).json({ error: 'You can only manage employees in your branch.' });
    const b = req.body || {};
    // LOP (loss of pay) is a valid recorded type; it is always unpaid.
    const type = ['casual', 'medical', 'privilege', 'wfh', 'lop'].includes(b.type) ? b.type : null;
    if (!type) return res.status(400).json({ error: 'Invalid leave type.' });
    const duration = b.duration === 'half' ? 'half' : 'full';
    const valid = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');

    // Build the date list. Half day → one date. Full day → an inclusive From/To
    // range (every calendar day counts). A single date is from === to.
    let dates = [];
    if (duration === 'half') {
      const date = valid(b.date) ? b.date : (valid(b.from) ? b.from : null);
      if (!date) return res.status(400).json({ error: 'Choose a valid date.' });
      dates = [date];
    } else {
      const from = valid(b.from) ? b.from : (valid(b.date) ? b.date : null);
      const to = valid(b.to) ? b.to : from;
      if (!from) return res.status(400).json({ error: 'Choose a valid start date.' });
      if (to < from) return res.status(400).json({ error: 'The end date can’t be before the start date.' });
      let cur = new Date(from + 'T00:00:00'); const end = new Date(to + 'T00:00:00'); let guard = 0;
      while (cur <= end && guard < 120) { dates.push(cur.toISOString().slice(0, 10)); cur.setDate(cur.getDate() + 1); guard += 1; }
    }

    // Policy checks (unless the caller explicitly overrides with force:true).
    // LOP is exempt (it's already unpaid and usually recorded after the fact).
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const policy = getHrPolicy(s);
    const rules = policy.leaveRules || {};
    const force = b.force === true;
    if (!force && type !== 'lop') {
      for (const d of dates) {
        // Sandwich rule (casual by default; medical exempt).
        if (rules[type] && rules[type].sandwichBlock) {
          const day = new Date(d + 'T00:00:00');
          const adj = [new Date(day.getTime() - 86400000), new Date(day.getTime() + 86400000)].map((x) => x.toISOString().slice(0, 10));
          const holidays = await HrHoliday.findAll({ where: { date: adj } });
          const hset = new Set(holidays.map((h) => h.date));
          for (const ad of adj) {
            if (isWeekOff(policy, emp.branch, ad) || hset.has(ad)) {
              return res.status(400).json({ error: `Casual leave can't be taken immediately before or after a week-off or holiday. Use medical leave, or override if this is an exception.`, policyBlock: 'sandwich' });
            }
          }
        }
      }
      // Medical document is OPTIONAL when HR records leave on an employee's
      // behalf (HR has verified the situation directly). It stays REQUIRED when
      // the employee applies themselves (enforced in POST /me/leave).
      // (No medical-document block here.)
      // Privilege leave requires N days advance notice (based on the first date).
      if (type === 'privilege' && rules.privilege && rules.privilege.noticeDays) {
        const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00');
        const leaveDay = new Date(dates[0] + 'T00:00:00');
        const daysAhead = Math.round((leaveDay - today) / 86400000);
        if (daysAhead < rules.privilege.noticeDays) {
          return res.status(400).json({ error: `Privilege leave must be applied at least ${rules.privilege.noticeDays} days in advance (this is ${daysAhead} day${daysAhead === 1 ? '' : 's'} ahead). Override if this is an exception.`, policyBlock: 'notice' });
        }
      }
    }

    const groupId = dates.length > 1 ? `rg${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` : null;
    const reason = String(b.reason || '').slice(0, 300);
    const actorName = req.hrActor.name;
    const now = new Date();
    let anyForcedUnpaid = false; let forcedReason = null;
    const created = [];
    for (const date of dates) {
      // LOP and WFH are never "paid leave"; others honor paid unless probation/notice.
      let paid = type === 'lop' || type === 'wfh' ? false : (b.paid !== false);
      if (paid) { const elig = leavePaidEligibility(emp, date); if (!elig.paidAllowed) { paid = false; anyForcedUnpaid = true; forcedReason = elig.reason; } }
      const row = await HrLeave.create({
        employeeId: id, type, date, duration,
        paid, reason, status: 'approved',
        appliedById: req.hrActor.id, recordedByHr: true,
        approvedBy: actorName, approverId: req.hrActor.id, approverName: actorName,
        decidedById: req.hrActor.id, decidedAt: now, decidedByKind: req.hrActor.kind,
        groupId, documentUrl: b.documentUrl || null,
      });
      created.push(row);
      // Reflect on the attendance calendar for that day.
      try {
        const [att] = await HrAttendance.findOrCreate({ where: { employeeId: id, date }, defaults: { employeeId: id, date } });
        att.status = type === 'wfh' ? 'present' : (duration === 'half' ? 'half_day' : 'leave');
        att.note = `${type}${paid ? '' : ' (unpaid)'}`; att.markedById = req.hrActor.id; await att.save();
      } catch {}
    }
    hrLog(req, 'leave.add', `${emp.name} ${type} ${dates[0]}${dates.length > 1 ? `→${dates[dates.length - 1]}` : ''}${anyForcedUnpaid ? ' (unpaid — probation/notice)' : ''}`);
    res.json({ ...created[0].toJSON(), days: dates.length, groupId, forcedUnpaid: anyForcedUnpaid, forcedReason: anyForcedUnpaid ? forcedReason : null });
  } catch (e) { next(e); }
});

// Delete a leave record.
router.delete('/employees/:id/leave/:leaveId', requireHrAccess, async (req, res, next) => {
  try {
    if (!canManagePeople(req)) return res.status(403).json({ error: 'Only an admin or HR manager can remove leave.' });
    const emp = await HrUser.findByPk(Number(req.params.id));
    if (!emp) return res.status(404).json({ error: 'Employee not found.' });
    if (!canManageBranch(req, emp.branch)) return res.status(403).json({ error: 'You can only manage employees in your branch.' });
    const row = await HrLeave.findOne({ where: { id: Number(req.params.leaveId), employeeId: Number(req.params.id) } });
    if (!row) return res.status(404).json({ error: 'Leave record not found.' });
    await row.destroy();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Check paid-leave eligibility for a date (used by the UI to warn before saving).
router.get('/employees/:id/leave-eligibility', requireHrAccess, async (req, res, next) => {
  try {
    const emp = await HrUser.findByPk(Number(req.params.id));
    if (!emp) return res.status(404).json({ error: 'Employee not found.' });
    const date = String(req.query.date || new Date().toISOString().slice(0, 10));
    res.json(leavePaidEligibility(emp, date));
  } catch (e) { next(e); }
});

router.post('/users', requireHrAccess, requireHrManager, async (req, res, next) => {
  try {
    const b = req.body || {};
    const name = titleCaseName(String(b.name || '').trim());
    const email = String(b.email || '').toLowerCase().trim();
    const password = String(b.password || '');
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are all required.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (!b.shiftId) return res.status(400).json({ error: 'Please assign a shift.' });
    const type = USER_TYPES.includes(b.type) ? b.type : 'employee';
    // An HR Manager can only add employees to their own branch.
    const branch = b.branch || (req.isHrManager ? req.hrBranch : '') || 'Bhubaneswar';
    if (!canManageBranch(req, branch)) return res.status(403).json({ error: `You can only add employees to your branch (${req.hrBranch}).` });

    // Duplicate guards: email, phone and name must be unique across employees.
    const phone = String(b.phone || '').trim();
    const normPhone = (p) => String(p || '').replace(/[^\d]/g, '').slice(-10); // last 10 digits
    const all = await HrUser.findAll();
    if (await HrUser.findOne({ where: { email } })) return res.status(409).json({ error: 'An employee with that email already exists.' });
    if (normPhone(phone) && normPhone(phone).length >= 10 && all.some((u) => normPhone(u.phone) === normPhone(phone))) return res.status(409).json({ error: 'An employee with that phone number already exists.' });
    if (all.some((u) => (u.name || '').trim().toLowerCase() === name.toLowerCase())) return res.status(409).json({ error: 'An employee with that name already exists.' });
    // Employee ID must be unique by its NUMBER only — the QB/QK branch prefix is
    // ignored (QB001 and QK001 collide because the number 001 is the same).
    const idNum = (v) => String(v || '').replace(/[^\d]/g, '');
    const newIdNum = idNum(b.employeeId);
    if (newIdNum && all.some((u) => idNum(u.employeeId) && idNum(u.employeeId) === newIdNum)) {
      return res.status(409).json({ error: `Employee ID number ${newIdNum} is already in use (the branch prefix like QB/QK is ignored — only the number must be unique).` });
    }

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
      hrManagerScope: req.isHrAdmin ? String(b.hrManagerScope || '').trim() : '',
      isHrManager: req.isHrAdmin ? (!!b.isHrManager || !!String(b.hrManagerScope || '').trim()) : false,
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
    // Duplicate guards (excluding this record).
    const others = (await HrUser.findAll()).filter((u) => u.id !== row.id);
    const normPhone = (p) => String(p || '').replace(/[^\d]/g, '').slice(-10);
    const idNum = (v) => String(v || '').replace(/[^\d]/g, '');
    if (b.email !== undefined) {
      const email = String(b.email).toLowerCase().trim();
      if (email && others.some((u) => (u.email || '').toLowerCase() === email)) return res.status(409).json({ error: 'An employee with that email already exists.' });
      row.email = email || row.email;
    }
    if (b.phone !== undefined && normPhone(b.phone).length >= 10 && others.some((u) => normPhone(u.phone) === normPhone(b.phone))) {
      return res.status(409).json({ error: 'An employee with that phone number already exists.' });
    }
    if (b.name !== undefined && String(b.name).trim() && others.some((u) => (u.name || '').trim().toLowerCase() === String(b.name).trim().toLowerCase())) {
      return res.status(409).json({ error: 'An employee with that name already exists.' });
    }
    if (b.employeeId !== undefined && idNum(b.employeeId) && others.some((u) => idNum(u.employeeId) === idNum(b.employeeId))) {
      return res.status(409).json({ error: `Employee ID number ${idNum(b.employeeId)} is already in use (branch prefix ignored).` });
    }
    if (b.name !== undefined) row.name = titleCaseName(String(b.name).trim());
    if (b.employeeId !== undefined) row.employeeId = b.employeeId || null;
    if (b.phone !== undefined) row.phone = b.phone;
    if (b.designation !== undefined) row.designation = b.designation;
    if (b.type !== undefined && USER_TYPES.includes(b.type)) row.type = b.type;
    if (b.branch !== undefined) row.branch = b.branch;
    if (b.department !== undefined) row.department = b.department;
    if (b.joiningDate !== undefined) row.joiningDate = b.joiningDate || null;
    // Probation + exit tracking (drives the HR Manager daily console).
    if (b.probationEndDate !== undefined) row.probationEndDate = b.probationEndDate || null;
    if (b.probationStatus !== undefined) row.probationStatus = ['on_probation', 'confirmed', 'extended'].includes(b.probationStatus) ? b.probationStatus : '';
    if (b.exitStatus !== undefined) row.exitStatus = ['notice', 'exited'].includes(b.exitStatus) ? b.exitStatus : '';
    if (b.lastWorkingDay !== undefined) row.lastWorkingDay = b.lastWorkingDay || null;
    if (b.shiftId !== undefined) row.shiftId = b.shiftId ? Number(b.shiftId) : null;
    if (b.branchIncharge !== undefined) row.branchIncharge = !!b.branchIncharge;
    if (b.reportsToId !== undefined) row.reportsToId = b.reportsToId ? Number(b.reportsToId) : null;
    if (b.reportsToAdminId !== undefined) row.reportsToAdminId = b.reportsToAdminId ? Number(b.reportsToAdminId) : null;
    if (b.active !== undefined) row.active = !!b.active;
    if (b.avatar !== undefined) row.avatar = b.avatar;
    // HR-Manager role and the announce permission are admin-granted only.
    if (b.hrManagerScope !== undefined && req.isHrAdmin) {
      row.hrManagerScope = String(b.hrManagerScope || '').trim();
      row.isHrManager = !!row.hrManagerScope; // keep boolean mirror in sync
    } else if (b.isHrManager !== undefined && req.isHrAdmin) {
      row.isHrManager = !!b.isHrManager;
      if (!b.isHrManager) row.hrManagerScope = '';
    }
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
    // Candidate counts per job, split by how they entered: public_form = they
    // applied themselves; anything else (manual) = HR added them.
    const counts = await HrCandidate.findAll({
      attributes: ['jobPostId', 'source', [HrCandidate.sequelize.fn('COUNT', HrCandidate.sequelize.col('id')), 'n']],
      group: ['jobPostId', 'source'], raw: true,
    });
    const appliedByJob = {}; const addedByJob = {}; const totalByJob = {};
    counts.forEach((c) => {
      const n = Number(c.n);
      totalByJob[c.jobPostId] = (totalByJob[c.jobPostId] || 0) + n;
      if (c.source === 'public_form' || c.source === 'careers_page') appliedByJob[c.jobPostId] = (appliedByJob[c.jobPostId] || 0) + n;
      else addedByJob[c.jobPostId] = (addedByJob[c.jobPostId] || 0) + n;
    });
    // Resolve assigned-HR names for display.
    const allIds = [...new Set(rows.flatMap((r) => Array.isArray(r.assignedHrIds) ? r.assignedHrIds : []))];
    const hrById = {};
    if (allIds.length) { const hrs = await HrUser.findAll({ where: { id: allIds }, attributes: ['id', 'name', 'avatar'] }); hrs.forEach((h) => { hrById[h.id] = { id: h.id, name: h.name, avatar: h.avatar }; }); }
    res.json(rows.map((r) => ({
      ...r.toJSON(),
      applicantCount: totalByJob[r.id] || 0,
      appliedCount: appliedByJob[r.id] || 0,
      addedCount: addedByJob[r.id] || 0,
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
router.post('/job-posts', requireHrAccess, requireJobPoster, async (req, res, next) => {
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

router.put('/job-posts/:id', requireHrAccess, requireJobPoster, async (req, res, next) => {
  try {
    const row = await HrJobPost.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Job post not found.' });
    const fields = pickJobFields(req.body || {});
    Object.assign(row, fields);
    // Ensure JSON columns persist (Sequelize needs an explicit change flag).
    ['locations', 'skills', 'formFields', 'questions', 'stages', 'assignedHrIds', 'roundPanels'].forEach((k) => { if (fields[k] !== undefined) row.changed(k, true); });
    await row.save();
    // If a title/description/location-affecting change lands on a published
    // job, refresh the cached AI share meta (best-effort, non-blocking).
    try {
      if (row.status === 'published' && (fields.title !== undefined || fields.description !== undefined || fields.locations !== undefined || fields.department !== undefined || fields.skills !== undefined)) {
        const jobMeta = require('../services/jobMeta');
        const s = await Settings.findOne({ where: { singleton: 'settings' } });
        const key = s && s.getKey ? s.getKey('openai') : null;
        const meta = await jobMeta.generateJobMeta(row, key);
        row.ogTitle = meta.title; row.ogDescription = meta.description; row.ogGeneratedAt = new Date();
        await row.save();
      }
    } catch (e) { console.error('[job.update] meta refresh failed:', e.message); }
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

// Publish: mint a public token (if not already) and flip status to published.
router.post('/job-posts/:id/publish', requireHrAccess, requireJobPoster, async (req, res, next) => {
  try {
    const row = await HrJobPost.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Job post not found.' });
    if (!row.publicToken) row.publicToken = crypto.randomBytes(12).toString('hex');
    row.status = 'published';
    row.publishedAt = new Date();
    await row.save();
    // Generate + cache AI share meta (best-effort; doesn't block publishing).
    try {
      const jobMeta = require('../services/jobMeta');
      const s = await Settings.findOne({ where: { singleton: 'settings' } });
      const key = s && s.getKey ? s.getKey('openai') : null;
      const meta = await jobMeta.generateJobMeta(row, key);
      row.ogTitle = meta.title; row.ogDescription = meta.description; row.ogGeneratedAt = new Date();
      await row.save();
      // Ensure the branded OG image exists (built once, shared by all posts).
      const branding = (s && s.hrCareers) || {};
      const fs2 = require('fs');
      if (!fs2.existsSync(jobMeta.ogImagePath())) await jobMeta.buildOgImage(branding.logo || '');
    } catch (e) { console.error('[job.publish] meta gen failed:', e.message); }
    hrLog(req, 'job.publish', row.title);
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

router.post('/job-posts/:id/close', requireHrAccess, requireJobPoster, async (req, res, next) => {
  try {
    const row = await HrJobPost.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Job post not found.' });
    row.status = 'closed'; await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

// Toggle a published job between Live and Paused (paused hides the public form
// but keeps the post and its candidates).
router.post('/job-posts/:id/pause', requireHrAccess, requireJobPoster, async (req, res, next) => {
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

router.delete('/job-posts/:id', requireHrAccess, requireJobPoster, async (req, res, next) => {
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

// ===== Careers / Job SEO =====
// List every job with its editable SEO fields, plus the careers-page SEO, for
// the admin SEO panel. Managers/admins only.
router.get('/seo/jobs', requireHrAccess, requireHrManager, async (req, res, next) => {
  try {
    const jobs = await HrJobPost.findAll({ order: [['createdAt', 'DESC']], attributes: ['id', 'title', 'department', 'status', 'publicToken', 'locations', 'workMode', 'seoTitle', 'seoDescription', 'seoKeywords', 'seoGeneratedAt'] });
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const careers = (s && s.hrCareers) || {};
    res.json({
      careersSeo: { title: careers.seoTitle || '', description: careers.seoDescription || '', keywords: careers.seoKeywords || [], image: careers.seoImage || careers.ogImage || '' },
      jobs: jobs.map((j) => ({
        id: j.id, title: j.title, department: j.department, status: j.status,
        token: j.publicToken, locations: j.locations || [], workMode: j.workMode,
        seoTitle: j.seoTitle || '', seoDescription: j.seoDescription || '', seoKeywords: j.seoKeywords || [],
        seoGeneratedAt: j.seoGeneratedAt,
      })),
    });
  } catch (e) { next(e); }
});

// Ensure a job has a clean slug and return it (for the Share modal's pretty URL).
router.get('/jobs/:id/slug', requireHrAccess, async (req, res, next) => {
  try {
    const job = await HrJobPost.findByPk(Number(req.params.id));
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    const slug = await require('./careers').ensureJobSlug(job);
    res.json({ slug, token: job.publicToken });
  } catch (e) { next(e); }
});

// Save one job's SEO fields (admin-edited). Empty strings clear the override.
router.put('/seo/jobs/:id', requireHrAccess, requireHrManager, async (req, res, next) => {
  try {
    const job = await HrJobPost.findByPk(Number(req.params.id));
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    const b = req.body || {};
    if (b.seoTitle !== undefined) job.seoTitle = String(b.seoTitle).slice(0, 200);
    if (b.seoDescription !== undefined) job.seoDescription = String(b.seoDescription).slice(0, 400);
    if (b.seoKeywords !== undefined) job.seoKeywords = Array.isArray(b.seoKeywords) ? b.seoKeywords.map((k) => String(k).slice(0, 60)).slice(0, 12) : [];
    await job.save();
    res.json({ id: job.id, seoTitle: job.seoTitle, seoDescription: job.seoDescription, seoKeywords: job.seoKeywords });
  } catch (e) { next(e); }
});

// AI-generate SEO title + description for ONE job (does not save until the admin
// clicks save — returns the suggestion so they can review/edit first).
router.post('/seo/jobs/:id/generate', requireHrAccess, requireHrManager, async (req, res, next) => {
  try {
    const job = await HrJobPost.findByPk(Number(req.params.id));
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const apiKey = s && s.getKey ? s.getKey('openai') : null;
    const { generateJobSeo } = require('../services/jobMeta');
    const seo = await generateJobSeo(job, apiKey);
    res.json({ id: job.id, ...seo, ai: !!apiKey });
  } catch (e) { next(e); }
});

// AI-generate + SAVE SEO for ALL published jobs in one shot ("Generate all").
router.post('/seo/jobs/generate-all', requireHrAccess, requireHrManager, async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const apiKey = s && s.getKey ? s.getKey('openai') : null;
    const { generateJobSeo } = require('../services/jobMeta');
    const onlyEmpty = !!(req.body && req.body.onlyEmpty);
    const jobs = await HrJobPost.findAll({ where: { status: 'published' } });
    const results = [];
    for (const job of jobs) {
      if (onlyEmpty && (job.seoTitle || job.seoDescription)) { results.push({ id: job.id, skipped: true }); continue; }
      const seo = await generateJobSeo(job, apiKey);
      job.seoTitle = seo.title; job.seoDescription = seo.description; job.seoKeywords = seo.keywords || []; job.seoGeneratedAt = new Date();
      await job.save();
      results.push({ id: job.id, title: job.title, seoTitle: seo.title, seoDescription: seo.description, seoKeywords: seo.keywords || [] });
    }
    res.json({ ai: !!apiKey, count: results.filter((r) => !r.skipped).length, results });
  } catch (e) { next(e); }
});

// Save the careers-page SEO (lives on Settings.hrCareers alongside branding).
router.put('/seo/careers', requireHrAccess, requireHrManager, async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const b = req.body || {};
    const careers = { ...(s.hrCareers || {}) };
    if (b.title !== undefined) careers.seoTitle = String(b.title).slice(0, 200);
    if (b.description !== undefined) careers.seoDescription = String(b.description).slice(0, 400);
    if (b.keywords !== undefined) careers.seoKeywords = Array.isArray(b.keywords) ? b.keywords.map((k) => String(k).slice(0, 60)).slice(0, 12) : [];
    if (b.image !== undefined) careers.seoImage = String(b.image).slice(0, 500);
    s.hrCareers = careers; s.changed('hrCareers', true); await s.save();
    res.json({ title: careers.seoTitle || '', description: careers.seoDescription || '', keywords: careers.seoKeywords || [], image: careers.seoImage || '' });
  } catch (e) { next(e); }
});

// AI-generate careers-page SEO (returns suggestion; not saved until reviewed).
router.post('/seo/careers/generate', requireHrAccess, requireHrManager, async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const apiKey = s && s.getKey ? s.getKey('openai') : null;
    const jobs = await HrJobPost.findAll({ where: { status: 'published' }, attributes: ['title'] });
    const { generateCareersSeo } = require('../services/jobMeta');
    const seo = await generateCareersSeo(jobs, (s && s.hrCareers) || {}, apiKey);
    res.json({ ...seo, ai: !!apiKey });
  } catch (e) { next(e); }
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
    // Hired candidates live in their own "Hired" tab. The main candidate list
    // hides them; the Hired tab (?hired=only) shows only them.
    const hiredMode = String(req.query.hired || '').toLowerCase();
    const rejectedMode = String(req.query.rejected || '').toLowerCase();
    const blacklistMode = String(req.query.blacklist || '').toLowerCase();
    const isHired = (r) => isHiredCandidate(r);
    // A candidate counts as rejected if the flag is set OR they sit in a
    // rejected-type stage (covers older data rejected before the flag existed).
    const REJECTED_STAGES = new Set(['rejected', 'reject', 'declined', 'disqualified']);
    const isRejected = (r) => r.rejected || REJECTED_STAGES.has(String(r.stage || '').toLowerCase());
    const isBlacklisted = (r) => !!r.blacklisted;
    // Cold candidates are parked; ?cold=only shows just them, ?cold=hide removes
    // them from the list. Default keeps them (badged) so they stay findable.
    const coldMode = String(req.query.cold || '').toLowerCase();
    if (coldMode === 'only') rows = rows.filter((r) => r.cold && !isRejected(r) && !isBlacklisted(r));
    else if (coldMode === 'hide') rows = rows.filter((r) => !r.cold);
    if (blacklistMode === 'only') rows = rows.filter(isBlacklisted);
    else if (rejectedMode === 'only') rows = rows.filter((r) => isRejected(r) && !isBlacklisted(r));
    else if (hiredMode === 'only') rows = rows.filter((r) => !isRejected(r) && !isBlacklisted(r) && isHired(r));
    else if (hiredMode !== 'all' && !req.query.stage && !req.query.jobPostId) rows = rows.filter((r) => !isHired(r) && !isRejected(r) && !isBlacklisted(r));
    // Non-HR employees (plain panelists) may only see candidates whose interview
    // panel they sit on — never the whole pipeline.
    const isHrDeptActor = req.hrUser && /^(hr|human resource|human resources)$/i.test(String(req.hrUser.department || '').trim());
    const isHrLikeActor = !!req.isHrAdmin || !!req.isHrManager || (req.hrUser && ['hr', 'recruiter'].includes(req.hrUser.type)) || isHrDeptActor;
    if (!isHrLikeActor && req.hrActor && req.hrActor.kind === 'hr') {
      const myId = req.hrActor.id;
      rows = rows.filter((r) => (r.interviews || []).some((iv) => (iv.panelists || []).some((p) => p.id === myId)));
    }
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
    // Determine recipient scope. 'admin:<id>' → a CRM admin; a bare number → HR.
    let actorKind = 'hr';
    let id = userId;
    const sid = String(userId);
    if (sid.startsWith('admin:')) { actorKind = 'admin'; id = sid.slice(6); }
    if (!/^\d+$/.test(String(id))) return;
    const body = String(text || '').slice(0, 500);
    // Dedupe: don't recreate an identical unread notification for the same user.
    const dup = await HrNotification.findOne({ where: { userId: id, actorKind, text: body, read: false } });
    if (dup) return;
    await HrNotification.create({ userId: id, actorKind, type: type || 'info', text: body, candidateId: candidateId || null });
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

// ===== Onboarding helpers ==================================================
// The standard HR onboarding checklist, grouped by phase relative to joining.
// `auto` items are driven by a button/automation; the rest are manual ticks.
// `route` marks a task that fans out to another department's review feed.
function onboardingChecklistSeed() {
  return [
    // Prepare — 2 days before (kicked off once candidate docs are complete)
    { id: 'notify_seniors', phase: 'prepare', label: 'Email department PM & Team Leads about the new joiner', auto: true },
    { id: 'seating', phase: 'prepare', label: 'Finalize seating arrangement with senior' },
    { id: 'inform_it', phase: 'prepare', label: 'Inform IT to prepare the computer', route: 'IT & Hardware' },
    { id: 'id_card', phase: 'prepare', label: 'Contact vendor for ID-card printing', wantsDate: true },
    { id: 'welcome_kit', phase: 'prepare', label: 'Prepare welcome kit' },
    // Set up — 1 day before
    { id: 'desk_check', phase: 'setup', label: 'Check desk & computer are ready' },
    { id: 'company_email', phase: 'setup', label: 'Create company email' },
    { id: 'teams_id', phase: 'setup', label: 'Create Microsoft Teams ID' },
    { id: 'activate_hrms', phase: 'setup', label: 'Activate HRMS Employee ID & login', createsEmployee: true },
    // Joining day — confirm & welcome
    { id: 'confirm_joining', phase: 'joinday', label: 'Mark Joined / Not joined / Postpone', confirm: true },
    { id: 'welcome_email', phase: 'joinday', label: 'Send welcome-aboard email', auto: true },
    { id: 'doc_verify', phase: 'joinday', label: 'Physical document verification (originals)' },
    { id: 'sign_agreement', phase: 'joinday', label: 'Sign Employee Agreement' },
    { id: 'sign_rulebook', phase: 'joinday', label: 'Sign Employee Rule Book' },
    // Induction — day one
    { id: 'welcome_meeting', phase: 'induction', label: 'Team welcome meeting & introduction', meeting: true },
    { id: 'hr_induction', phase: 'induction', label: 'HR induction / company presentation' },
    { id: 'hrms_demo', phase: 'induction', label: 'HRMS demo' },
    { id: 'crm_demo', phase: 'induction', label: 'Sales CRM demo', salesOnly: true },
    { id: 'office_tour', phase: 'induction', label: 'Office tour' },
    { id: 'share_creds', phase: 'induction', label: 'Share all credentials' },
    { id: 'kpi_kra', phase: 'induction', label: 'Email KPI & KRA', auto: true },
  ].map((t) => ({ ...t, done: false, doneAt: null, doneById: null, meta: {} }));
}

function getAppUrl() { return (process.env.APP_URL || '').replace(/\/$/, ''); }

function onboardingInit() {
  return {
    token: crypto.randomBytes(16).toString('hex'),
    activatedAt: null,
    status: 'pending',
    joiningTime: '',
    fields: {}, docs: {}, prevCompanies: [], draft: null,
    submittedAt: null, docsComplete: false,
    hrTasks: onboardingChecklistSeed(),
    welcomeEmailSentAt: null, reminderSentAt: null, seniorNotifiedAt: null,
    reportingSentAt: null, welcomeAboardSentAt: null,
    convertedEmployeeId: null, joiningChanges: [],
  };
}


// Move a candidate between hiring-flow stages (logs to timeline).
router.patch('/candidates/:id/stage', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    const from = row.stage;
    const requested = String(req.body.stage || 'applied');
    const job = row.jobPostId ? await HrJobPost.findByPk(row.jobPostId) : null;
    const stageLabel = (id) => { const st = (job && job.stages || []).find((s) => s.id === id); return st ? st.label : id; };

    // Moving to a HIRED stage requires a completed (accepted) offer. If the offer
    // isn't done, redirect to the "Offered" stage and tell the client to open the
    // Offer tab so HR can complete it. Once accepted, the offer flow moves them to
    // Hired automatically.
    const movingToHired = HIRED_STAGE_IDS.has(requested.toLowerCase());
    const offerDone = row.offer && row.offer.status === 'accepted';

    // Moving to a "rejected" stage must capture a reason. Unless a reason is
    // supplied in this same call, tell the client to open the reject dialog
    // instead of completing the move silently.
    const REJECTED_STAGE_IDS = new Set(['rejected', 'reject', 'declined', 'disqualified']);
    const movingToRejected = REJECTED_STAGE_IDS.has(requested.toLowerCase());
    if (movingToRejected && !req.body.reason) {
      return res.json({ ...row.toJSON(), needsReason: true, message: 'A rejection reason is required.' });
    }
    if (movingToRejected && req.body.reason) {
      row.stage = 'rejected'; row.rejected = true; row.rejectedAt = new Date();
      row.rejectionReason = String(req.body.reason).slice(0, 300);
      pushTimeline(row, { type: 'reject', text: `Rejected by ${req.hrActor.name} — ${String(req.body.reason).slice(0, 200)}.`, by: req.hrActor.name });
      await row.save();
      hrLog(req, 'candidate.reject', `${row.name} — ${String(req.body.reason).slice(0, 120)}`);
      return res.json(row.toJSON());
    }
    if (movingToHired && !offerDone) {
      const offeredStage = (job && job.stages || []).find((s) => ['offered', 'offer'].includes(String(s.id).toLowerCase()));
      row.stage = offeredStage ? offeredStage.id : 'offered';
      row.rejected = false;
      // Mark that a hire is intended but pending offer completion.
      const offer = row.offer || {};
      offer.pendingHire = true; offer.active = true;
      if (!offer.status) offer.status = 'discussion';
      row.offer = offer; row.changed('offer', true);
      pushTimeline(row, { type: 'stage', text: `${req.hrActor.name} marked ${row.name} for hire — offer needs completing first.`, by: req.hrActor.name });
      await row.save();
      hrLog(req, 'candidate.stage', `${row.name} → hire pending offer`);
      return res.json({ ...row.toJSON(), offerIncomplete: true, message: 'Complete the offer process to finish hiring this candidate.' });
    }

    row.stage = requested;
    row.rejected = false;
    // Keep the offer state consistent with the pipeline: the offer process only
    // belongs to the Offered/Hired stages. If a candidate is moved back to an
    // earlier stage, clear the "pending hire" marker and deactivate an offer that
    // never actually progressed — otherwise they'd wrongly linger in the
    // dashboard "Offers to complete" list.
    const offerStageIds = new Set((job && job.stages || []).filter((s) => ['offered', 'offer'].includes(String(s.id).toLowerCase())).map((s) => s.id));
    const inOfferOrHired = HIRED_STAGE_IDS.has(requested.toLowerCase()) || offerStageIds.has(requested);
    if (!inOfferOrHired && row.offer) {
      const o = row.offer;
      if (o.status !== 'accepted') {
        o.pendingHire = false;
        // If nothing real happened in the offer (no discussions, LOI, letter,
        // approvals), turn the tab off entirely.
        const hasProgress = (o.salaryDiscussions && o.salaryDiscussions.length) || (o.approvals && o.approvals.length) || o.loi || o.offerLetter;
        if (!hasProgress) o.active = false;
        row.offer = o; row.changed('offer', true);
      }
    }
    pushTimeline(row, { type: 'stage', text: `Moved to ${stageLabel(requested)}.`, by: req.hrActor.name });
    // Auto-email: the candidate has passed the Contacted stage (moved to a stage
    // other than sourced/applied/contacted/rejected) — their resume is
    // shortlisted for interview. Sends once, tracked by shortlistEmailSent.
    let shortlisted = false;
    if (!PRE_SHORTLIST_STAGES.has(requested.toLowerCase())) {
      shortlisted = await sendShortlistEmail(row, req.hrActor);
      if (shortlisted) pushTimeline(row, { type: 'email', text: `Shortlist email sent to ${row.name}.`, by: req.hrActor.name });
    }
    await row.save();
    hrLog(req, 'candidate.stage', `${row.name} → ${stageLabel(requested)}`);
    res.json({ ...row.toJSON(), shortlistEmailed: shortlisted });
  } catch (e) { next(e); }
});

// Reject a candidate.
// Mark a candidate "cold" (parked — didn't respond / position paused) or
// reactivate them. Cold candidates need no action and are excluded from active
// pipeline attention until reopened.
router.post('/candidates/:id/cold', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    const makeCold = req.body.cold !== false; // default true
    row.cold = makeCold;
    row.coldAt = makeCold ? new Date() : null;
    row.coldReason = makeCold ? String(req.body.reason || '').slice(0, 300) : '';
    pushTimeline(row, { type: 'stage', text: makeCold ? `${req.hrActor.name} marked ${row.name} as cold${req.body.reason ? ` — ${req.body.reason}` : ''}.` : `${req.hrActor.name} reactivated ${row.name} from cold.`, by: req.hrActor.name });
    await row.save();
    hrLog(req, 'candidate.cold', `${row.name} → ${makeCold ? 'cold' : 'active'}`);
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

router.post('/candidates/:id/reject', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    row.rejected = true; row.stage = 'rejected'; row.rejectedAt = new Date();
    row.rejectionReason = String(req.body.reason || '').slice(0, 300);
    pushTimeline(row, { type: 'reject', text: `Rejected by ${req.hrActor.name}${req.body.reason ? ` — ${String(req.body.reason).slice(0, 200)}` : ''}.`, by: req.hrActor.name });
    await row.save();
    hrLog(req, 'candidate.reject', `${row.name}${req.body.reason ? ` — ${String(req.body.reason).slice(0, 120)}` : ''}`);

    // Optionally email the candidate the rejection (subject/body come from the
    // reviewed draft on the client). Best-effort — rejection is already recorded.
    let emailed = false;
    if (req.body.sendEmail && row.email && req.body.subject && req.body.body) {
      try {
        const gmail = require('../services/gmail');
        const hrEmail = require('../services/hrEmailTemplate');
        const s = await Settings.findOne({ where: { singleton: 'settings' } });
        const token = s && s.getKey ? s.getKey('hrMailboxToken') : null;
        const mailbox = mailboxEmail(s);
        if (token && mailbox) {
          const job = row.jobPostId ? await HrJobPost.findByPk(row.jobPostId) : null;
          const sig = await rejectSignature(req.hrActor, mailbox);
          // Wrap the HR-reviewed draft body in the branded rejection template.
          const bodyHtml = hrEmail.rejectionEmail({ role: job ? job.title : '', bodyHtml: String(req.body.body).slice(0, 8000), signature: sig });
          const cc = await assignedHrCc(row, { excludeEmail: mailbox });
          await sendHrEmailLogged(s, token, mailbox, { from: mailbox, to: row.email, cc, subject: String(req.body.subject).slice(0, 200), bodyHtml, attachments: [] }, { type: 'hr_reject_or_custom' });
          emailed = true;
          pushTimeline(row, { type: 'rejection', text: `Rejection email sent to ${row.name} by ${req.hrActor.name}.`, by: req.hrActor.name });
          await row.save();
        }
      } catch (e) { console.error('[reject] email failed:', e.message); }
    }
    res.json({ ...row.toJSON(), emailed });
  } catch (e) { next(e); }
});

// AI-draft a warm, professional rejection email personalised to this candidate.
router.post('/candidates/:id/reject-email/draft', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const key = s && s.getKey ? s.getKey('openai') : null;
    if (!key) return res.status(400).json({ error: 'OpenAI isn’t configured yet. Ask an admin to add the API key in CRM Admin → API keys.' });
    const job = row.jobPostId ? await HrJobPost.findByPk(row.jobPostId) : null;
    const reason = String((req.body || {}).reason || '').slice(0, 300);
    // The HR's own signature (default from their library, else the legacy single).
    let hrSig = '';
    if (req.hrActor.kind === 'hr') {
      const hrUser = await HrUser.findByPk(req.hrActor.id);
      if (hrUser) {
        const lib = Array.isArray(hrUser.emailSignatures) ? hrUser.emailSignatures : [];
        const def = lib.find((x) => x.isDefault) || lib[0];
        hrSig = (def && def.body) || hrUser.emailSignature || '';
      }
    }
    const system = [
      'Act as a warm, empathetic HR / talent acquisition specialist writing a candidate rejection email after an application or interview.',
      'The tone must be professional, kind and encouraging, and must NOT hurt the candidate’s sentiment. Thank them sincerely for their time and interest.',
      'Do NOT quote any internal reason verbatim or list specific shortcomings — if a reason is given, use it only to gently shape the wording, keeping it gracious and general.',
      'Include a genuine, positive note that we will keep their profile in mind and will surely inform them if a relevant opening comes up in the future, and wish them all the best for their future endeavours.',
      'Keep it concise (3–4 short paragraphs). Structure the body as clean HTML — wrap each paragraph in its own <p> tag. No <html> wrapper. Do NOT add a signature or sign-off name — a signature will be appended separately.',
      'Return strict JSON: {"subject":"...","body":"<p>...</p>"}. No markdown, no commentary outside the JSON.',
    ].join(' ');
    const ctx = `Candidate: ${row.name}\nRole: ${job ? job.title : 'the role'}\nCompany: Qtonix\nRecruiter: ${req.hrActor.name}\nReason provided by HR (optional, for tone only, do not quote): ${reason || 'none — write a warm generic rejection'}`;
    try { const { recordApiCall } = require('../models'); recordApiCall && recordApiCall('openai'); } catch {}
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: system }, { role: 'user', content: ctx }], max_tokens: 800, response_format: { type: 'json_object' } }),
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(502).json({ error: (data.error && data.error.message) || 'OpenAI request failed.' });
    let parsed = {};
    try { parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}'); } catch { parsed = {}; }
    // Normalize the drafted body so paragraphs always have visible spacing:
    // if the model returned plain text or <br>-joined lines instead of <p>
    // blocks, convert double-newlines / stray lines into proper paragraphs.
    let body = String(parsed.body || '').trim();
    if (body && !/<p[\s>]/i.test(body)) {
      const parts = body.split(/\n{2,}|<br\s*\/?>\s*<br\s*\/?>/i).map((x) => x.trim()).filter(Boolean);
      body = parts.map((p) => `<p style="margin:0 0 14px;line-height:1.6;">${p.replace(/\n/g, '<br>')}</p>`).join('');
    } else {
      // Ensure existing <p> tags carry spacing even if the client strips classes.
      body = body.replace(/<p(?![^>]*style=)/gi, '<p style="margin:0 0 14px;line-height:1.6;"');
    }
    // The branded rejection template appends the HR signature block on send, so
    // the draft body stays as clean message paragraphs. If the HR has a custom
    // signature, it's still applied by the template via their profile.
    res.json({ subject: parsed.subject || `Update on your application${job ? ` — ${job.title}` : ''}`, body });
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
// Mark an interview as completed (used by the "Mark completed" action).
router.post('/candidates/:id/interview/:ivId/complete', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    const ivs = (row.interviews || []).map((iv) => iv.id === req.params.ivId ? { ...iv, completed: true, completedAt: iv.completedAt || new Date().toISOString(), completedBy: iv.completedBy || req.hrActor.name } : iv);
    const found = ivs.some((iv) => iv.id === req.params.ivId);
    if (!found) return res.status(404).json({ error: 'Interview not found.' });
    row.interviews = ivs; row.changed('interviews', true);
    pushTimeline(row, { type: 'interview', text: `${req.hrActor.name} marked the interview completed.`, by: req.hrActor.name });
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

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
    // Resolve which interview this feedback is for. If not given explicitly,
    // attach it to the interview where this submitter is a panelist (the most
    // recent one if several), so panel "Pending/Submitted" status updates.
    const actorId = req.hrActor.id;
    const adminKey = `admin:${actorId}`;
    const isPanelistOn = (iv) => (iv.panelists || []).some((p) => {
      const pid = String(p.id); return pid === String(actorId) || pid === adminKey || pid.replace(/^admin:/, '') === String(actorId) || (p.name && p.name === req.hrActor.name);
    });
    let targetIvId = b.interviewId || null;
    if (!targetIvId) {
      const mine = (row.interviews || []).filter(isPanelistOn).sort((a, z) => new Date(z.at) - new Date(a.at));
      if (mine.length) targetIvId = mine[0].id;
    }
    entry.interviewId = targetIvId;
    if (targetIvId && !entry.roundLabel) { const iv0 = (row.interviews || []).find((iv) => iv.id === targetIvId); if (iv0) { entry.roundLabel = iv0.roundLabel || ''; entry.round = iv0.round || ''; } }
    list.unshift(entry);
    row.feedback = list; row.changed('feedback', true);
    // Mark this panelist as having submitted for the interview. Store under the
    // matching panelist key (raw id or 'admin:<id>') so status resolves.
    if (targetIvId) {
      const ivs = (row.interviews || []).map((iv) => {
        if (iv.id !== targetIvId) return iv;
        const fbp = { ...(iv.feedbackByPanelist || {}) };
        // Mark ONLY the submitting person's own panelist entry, so a co-panelist's
        // pending reminder is untouched. Match the actor against how they're stored
        // in the panel (raw id, 'admin:<id>', or by name), and flag that exact key.
        for (const p of (iv.panelists || [])) {
          const pid = String(p.id);
          const isMe = pid === String(actorId) || pid === adminKey || pid.replace(/^admin:/, '') === String(actorId) || (p.name && p.name === req.hrActor.name);
          if (isMe) fbp[p.id] = true;
        }
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

// ---- Assessment tasks -------------------------------------------------------

// Resolve assigned employee ids (numeric HrUser + 'admin:<id>' directors) into
// { id, name, email } records for storage + notification.
async function resolveAssignees(ids) {
  const out = [];
  for (const raw of (ids || [])) {
    const sid = String(raw);
    if (sid.startsWith('admin:')) {
      const u = await User.findByPk(sid.slice(6));
      if (u) out.push({ id: sid, name: u.name, email: u.email });
    } else {
      const u = await HrUser.findByPk(sid);
      if (u) out.push({ id: u.id, name: u.name, email: u.email });
    }
  }
  return out;
}

const TASK_WINDOW_MS = 48 * 60 * 60 * 1000; // 48 hours

// Lightweight allowlist sanitizer for rich-text task details. Keeps basic
// formatting tags (produced by the editor) and strips anything unsafe —
// scripts, styles, event handlers, and javascript: URLs — before the HTML is
// stored, shown on the public upload page, or embedded in candidate emails.
function sanitizeTaskHtml(input) {
  let html = String(input || '');
  if (!html) return '';
  // Drop entire dangerous elements with their content.
  html = html.replace(/<\s*(script|style|iframe|object|embed|link|meta)[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  html = html.replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*>/gi, '');
  const ALLOWED = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'span', 'div']);
  html = html.replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (m, tag, attrs) => {
    const t = String(tag).toLowerCase();
    if (!ALLOWED.has(t)) return '';
    const closing = /^<\//.test(m);
    if (closing) return `</${t}>`;
    // Only keep href on <a>, and only http(s)/mailto.
    let keep = '';
    if (t === 'a') {
      const hrefMatch = attrs.match(/href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const href = hrefMatch ? (hrefMatch[2] || hrefMatch[3] || hrefMatch[4] || '') : '';
      if (/^(https?:|mailto:)/i.test(href)) keep = ` href="${href.replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer"`;
    }
    return `<${t}${keep}>`;
  });
  // Strip any leftover on* handlers or javascript: that slipped through.
  html = html.replace(/javascript:/gi, '');
  return html.slice(0, 8000);
}

// Assign an assessment task to a candidate: create the task, email the candidate
// a link to the public upload page (active 48h). HR, an assigned employee, or an
// admin may send. Old tasks/files are preserved — a re-assign adds a new task.
router.post('/candidates/:id/assign-task', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    const b = req.body || {};
    const details = String(b.details || '').trim();
    if (!details || !details.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()) return res.status(400).json({ error: 'Please enter the task details.' });
    const detailsHtml = sanitizeTaskHtml(details);
    const assignees = await resolveAssignees(b.assignedIds || []);
    // Permission: admins and HR schedulers can always send. A non-scheduler
    // employee may send only if they're one of the assignees.
    const meId = String(req.hrActor.id);
    const isAssignee = assignees.some((a) => String(a.id) === meId || String(a.id) === `admin:${meId}`);
    if (!req.isHrAdmin && !canViewInternal(req) && !isAssignee) {
      return res.status(403).json({ error: 'You don’t have permission to assign this task.' });
    }
    const now = Date.now();
    const task = {
      id: `tk${now}`,
      title: String(b.title || '').slice(0, 160),
      details: detailsHtml.slice(0, 8000),
      assignedIds: assignees.map((a) => a.id),
      assignedNames: assignees.map((a) => a.name),
      token: crypto.randomBytes(12).toString('hex'),
      createdBy: req.hrActor.name,
      createdById: req.hrActor.kind === 'admin' ? `admin:${req.hrActor.id}` : req.hrActor.id,
      createdAt: new Date(now).toISOString(),
      deadline: new Date(now + TASK_WINDOW_MS).toISOString(),
      status: 'pending',
      submittedAt: null,
      files: [],
      reactivatedAt: null,
    };
    const tasks = Array.isArray(row.tasks) ? row.tasks.slice() : [];
    tasks.unshift(task);
    row.tasks = tasks; row.changed('tasks', true);
    pushTimeline(row, { type: 'task', text: `${req.hrActor.name} assigned an assessment task${task.title ? ` (“${task.title}”)` : ''}${assignees.length ? ` · Reviewers: ${assignees.map((a) => a.name).join(', ')}` : ''}.`, by: req.hrActor.name });
    await row.save();

    // Email the candidate the task + upload link (best-effort).
    let emailed = false;
    if (row.email) {
      try {
        const gmail = require('../services/gmail');
        const hrEmail = require('../services/hrEmailTemplate');
        const s = await Settings.findOne({ where: { singleton: 'settings' } });
        const token = s && s.getKey ? s.getKey('hrMailboxToken') : null;
        const mailbox = mailboxEmail(s);
        if (token && mailbox) {
          const job = row.jobPostId ? await HrJobPost.findByPk(row.jobPostId) : null;
          const sig = await rejectSignature(req.hrActor, mailbox);
          const appUrl = await require('../services/publicUrl').baseFor('careers', req);
          const uploadUrl = `${appUrl}/task/${task.token}`;
          const deadlineText = new Date(task.deadline).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'short' });
          const bodyHtml = hrEmail.taskAssignment({
            candidateName: row.name, role: job ? job.title : '', taskTitle: task.title,
            taskDetailsHtml: task.details,
            deadlineText: `${deadlineText} IST`, uploadUrl, signature: sig,
          });
          const cc = await assignedHrCc(row, { excludeEmail: mailbox });
          await sendHrEmailLogged(s, token, mailbox, { from: mailbox, to: row.email, cc, subject: `Assessment task${job ? ` — ${job.title}` : ''}`, bodyHtml }, { type: 'hr_task_assignment' });
          emailed = true;
        }
      } catch (e) { console.error('[task] assign email failed:', e.message); }
    }
    res.json({ ...row.toJSON(), emailed, taskId: task.id });
  } catch (e) { next(e); }
});

// Delete an assessment task from a candidate. HR/admin only.
router.delete('/candidates/:id/task/:taskId', requireHrAccess, async (req, res, next) => {
  try {
    if (!req.isHrAdmin && !canViewInternal(req)) return res.status(403).json({ error: 'Only HR or an admin can delete a task.' });
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    const tasks = Array.isArray(row.tasks) ? row.tasks.slice() : [];
    const idx = tasks.findIndex((t) => t.id === req.params.taskId);
    if (idx < 0) return res.status(404).json({ error: 'Task not found.' });
    const removed = tasks[idx];
    tasks.splice(idx, 1);
    row.tasks = tasks; row.changed('tasks', true);
    pushTimeline(row, { type: 'task', text: `${req.hrActor.name} deleted the assessment task${removed.title ? ` (“${removed.title}”)` : ''}.`, by: req.hrActor.name });
    await row.save();
    res.json({ ...row.toJSON(), deletedTaskId: req.params.taskId });
  } catch (e) { next(e); }
});

// Edit an assessment task's details (title/details). Reactivates the 48h window
// on the SAME token and emails the candidate a correction ("ignore the previous
// email") with the updated details. HR/admin only.
router.patch('/candidates/:id/task/:taskId', requireHrAccess, async (req, res, next) => {
  try {
    if (!req.isHrAdmin && !canViewInternal(req)) return res.status(403).json({ error: 'Only HR or an admin can edit a task.' });
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    const tasks = Array.isArray(row.tasks) ? row.tasks.slice() : [];
    const idx = tasks.findIndex((t) => t.id === req.params.taskId);
    if (idx < 0) return res.status(404).json({ error: 'Task not found.' });
    if (tasks[idx].submittedAt) return res.status(400).json({ error: 'This task was already submitted and can’t be edited.' });
    const b = req.body || {};
    const prev = tasks[idx];
    const newTitle = b.title !== undefined ? String(b.title).slice(0, 160) : prev.title;
    const rawDetails = b.details !== undefined ? String(b.details) : prev.details;
    const newDetails = b.details !== undefined ? sanitizeTaskHtml(rawDetails) : prev.details;
    if (b.details !== undefined && !newDetails.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()) return res.status(400).json({ error: 'Please enter the task details.' });
    const changed = newTitle !== prev.title || newDetails !== prev.details;
    if (!changed) return res.status(400).json({ error: 'No changes to the task details.' });
    const now = Date.now();
    // Editing re-opens the 48h window on the same token so the link stays valid.
    tasks[idx] = { ...prev, title: newTitle, details: newDetails, deadline: new Date(now + TASK_WINDOW_MS).toISOString(), status: 'pending', editedAt: new Date(now).toISOString(), editedBy: req.hrActor.name };
    row.tasks = tasks; row.changed('tasks', true);
    pushTimeline(row, { type: 'task', text: `${req.hrActor.name} edited the assessment task${newTitle ? ` (“${newTitle}”)` : ''} and re-sent the corrected details.`, by: req.hrActor.name });
    await row.save();

    // Email the candidate the correction (best-effort), same upload link.
    let emailed = false;
    if (row.email && b.notify !== false) {
      try {
        const gmail = require('../services/gmail');
        const hrEmail = require('../services/hrEmailTemplate');
        const s = await Settings.findOne({ where: { singleton: 'settings' } });
        const token = s && s.getKey ? s.getKey('hrMailboxToken') : null;
        const mailbox = mailboxEmail(s);
        if (token && mailbox) {
          const job = row.jobPostId ? await HrJobPost.findByPk(row.jobPostId) : null;
          const sig = await rejectSignature(req.hrActor, mailbox);
          const appUrl = await require('../services/publicUrl').baseFor('careers', req);
          const t = tasks[idx];
          const deadlineText = new Date(t.deadline).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'short' });
          const bodyHtml = hrEmail.taskUpdated({
            candidateName: row.name, role: job ? job.title : '', taskTitle: t.title,
            taskDetailsHtml: t.details,
            deadlineText: `${deadlineText} IST`, uploadUrl: `${appUrl}/task/${t.token}`, signature: sig,
          });
          const cc = await assignedHrCc(row, { excludeEmail: mailbox });
          await sendHrEmailLogged(s, token, mailbox, { from: mailbox, to: row.email, cc, subject: `Updated assessment task details${job ? ` — ${job.title}` : ''}`, bodyHtml }, { type: 'hr_task_updated' });
          emailed = true;
        }
      } catch (e) { console.error('[task] edit email failed:', e.message); }
    }
    res.json({ ...row.toJSON(), emailed, taskId: prev.id });
  } catch (e) { next(e); }
});

// Reactivate an expired (unsubmitted) task link: push the deadline 48h from now
// and set it back to pending. Same token, so the URL goes live again. HR/admin.
router.post('/candidates/:id/task/:taskId/reactivate', requireHrAccess, async (req, res, next) => {
  try {
    if (!req.isHrAdmin && !canViewInternal(req)) return res.status(403).json({ error: 'Only HR or an admin can reactivate a task link.' });
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    const tasks = Array.isArray(row.tasks) ? row.tasks.slice() : [];
    const idx = tasks.findIndex((t) => t.id === req.params.taskId);
    if (idx < 0) return res.status(404).json({ error: 'Task not found.' });
    if (tasks[idx].submittedAt) return res.status(400).json({ error: 'This task was already submitted.' });
    const now = Date.now();
    tasks[idx] = { ...tasks[idx], deadline: new Date(now + TASK_WINDOW_MS).toISOString(), status: 'pending', reactivatedAt: new Date(now).toISOString() };
    row.tasks = tasks; row.changed('tasks', true);
    pushTimeline(row, { type: 'task', text: `${req.hrActor.name} reactivated the task upload link (48h).`, by: req.hrActor.name });
    await row.save();

    // Optionally re-email the candidate.
    let emailed = false;
    if (req.body && req.body.notify && row.email) {
      try {
        const gmail = require('../services/gmail');
        const hrEmail = require('../services/hrEmailTemplate');
        const s = await Settings.findOne({ where: { singleton: 'settings' } });
        const token = s && s.getKey ? s.getKey('hrMailboxToken') : null;
        const mailbox = mailboxEmail(s);
        if (token && mailbox) {
          const job = row.jobPostId ? await HrJobPost.findByPk(row.jobPostId) : null;
          const sig = await rejectSignature(req.hrActor, mailbox);
          const appUrl = await require('../services/publicUrl').baseFor('careers', req);
          const t = tasks[idx];
          const deadlineText = new Date(t.deadline).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'short' });
          const bodyHtml = hrEmail.taskAssignment({
            candidateName: row.name, role: job ? job.title : '', taskTitle: t.title,
            taskDetailsHtml: t.details,
            deadlineText: `${deadlineText} IST`, uploadUrl: `${appUrl}/task/${t.token}`, signature: sig,
          });
          const cc = await assignedHrCc(row, { excludeEmail: mailbox });
          await sendHrEmailLogged(s, token, mailbox, { from: mailbox, to: row.email, cc, subject: `Your assessment task link is active again${job ? ` — ${job.title}` : ''}`, bodyHtml }, { type: 'hr_task_reactivate' });
          emailed = true;
        }
      } catch (e) { console.error('[task] reactivate email failed:', e.message); }
    }
    res.json({ ...row.toJSON(), emailed });
  } catch (e) { next(e); }
});

// A reviewer (assigned interview-panel employee / HR / admin) submits feedback
// on a candidate's task submission. Feedback is stored on the task and mirrored
// into the candidate's feedback list. This marks the task review complete.
router.post('/candidates/:id/task/:taskId/feedback', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    const b = req.body || {};
    const verdict = String(b.verdict || '').trim(); // e.g. 'strong' | 'good' | 'weak' | ''
    const note = String(b.note || '').trim();
    if (!note && !verdict) return res.status(400).json({ error: 'Please add your feedback.' });
    const tasks = Array.isArray(row.tasks) ? row.tasks.slice() : [];
    const idx = tasks.findIndex((t) => t.id === req.params.taskId);
    if (idx < 0) return res.status(404).json({ error: 'Task not found.' });
    // Permission: admins/HR schedulers always; otherwise must be an assigned reviewer.
    const meId = String(req.hrActor.id);
    const isReviewer = (tasks[idx].assignedIds || []).some((a) => String(a) === meId || String(a) === `admin:${meId}`);
    if (!req.isHrAdmin && !canViewInternal(req) && !isReviewer) return res.status(403).json({ error: 'You don’t have permission to review this task.' });
    const entry = { id: `tf${Date.now()}`, by: req.hrActor.name, byId: req.hrActor.id, verdict, note, at: new Date().toISOString() };
    const fbList = Array.isArray(tasks[idx].feedback) ? tasks[idx].feedback.slice() : [];
    fbList.unshift(entry);
    tasks[idx] = { ...tasks[idx], feedback: fbList, status: 'reviewed', reviewedAt: entry.at };
    row.tasks = tasks; row.changed('tasks', true);
    // Mirror into the candidate's general feedback list so it shows in Feedback tab.
    const cfb = Array.isArray(row.feedback) ? row.feedback.slice() : [];
    cfb.unshift({ id: `f${Date.now()}`, by: req.hrActor.name, byId: req.hrActor.id, verdict: verdict || 'note', note: `[Task review] ${note}`, at: entry.at, taskId: tasks[idx].id });
    row.feedback = cfb; row.changed('feedback', true);
    pushTimeline(row, { type: 'task', text: `${req.hrActor.name} submitted task feedback${verdict ? ` (${verdict})` : ''}.`, by: req.hrActor.name });
    await row.save();
    // Notify HR that the review is done.
    try {
      const notifyIds = new Set();
      if (row.recruiterId) notifyIds.add(Number(row.recruiterId));
      const job = row.jobPostId ? await HrJobPost.findByPk(row.jobPostId) : null;
      ((job && job.assignedHrIds) || []).forEach((id) => notifyIds.add(Number(id)));
      notifyIds.delete(Number(req.hrActor.id));
      for (const id of notifyIds) { if (id) await notify(id, { type: 'task', text: `${req.hrActor.name} reviewed ${row.name}'s task and submitted feedback.`, candidateId: row.id }); }
    } catch {}
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

// A reviewer requests additional information from the candidate. Reopens the
// task upload link (fresh 48h), emails the candidate (CC assigned HR) with the
// message, and asks them to upload more files via the same link.
router.post('/candidates/:id/task/:taskId/request-info', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    const message = String((req.body || {}).message || '').trim();
    if (!message) return res.status(400).json({ error: 'Please describe what additional information you need.' });
    const tasks = Array.isArray(row.tasks) ? row.tasks.slice() : [];
    const idx = tasks.findIndex((t) => t.id === req.params.taskId);
    if (idx < 0) return res.status(404).json({ error: 'Task not found.' });
    const meId = String(req.hrActor.id);
    const isReviewer = (tasks[idx].assignedIds || []).some((a) => String(a) === meId || String(a) === `admin:${meId}`);
    if (!req.isHrAdmin && !canViewInternal(req) && !isReviewer) return res.status(403).json({ error: 'You don’t have permission to review this task.' });
    const now = Date.now();
    // Reopen: clear submittedAt, set status info_requested, new 48h deadline.
    tasks[idx] = { ...tasks[idx], status: 'info_requested', submittedAt: null, deadline: new Date(now + TASK_WINDOW_MS).toISOString(),
      infoRequest: { message: message.slice(0, 2000), by: req.hrActor.name, at: new Date(now).toISOString(), respondedAt: null } };
    row.tasks = tasks; row.changed('tasks', true);
    pushTimeline(row, { type: 'task', text: `${req.hrActor.name} requested additional information from ${row.name} for the task.`, by: req.hrActor.name });
    await row.save();

    // Email the candidate (CC assigned HR).
    let emailed = false;
    if (row.email) {
      try {
        const gmail = require('../services/gmail');
        const hrEmail = require('../services/hrEmailTemplate');
        const s = await Settings.findOne({ where: { singleton: 'settings' } });
        const token = s && s.getKey ? s.getKey('hrMailboxToken') : null;
        const mailbox = mailboxEmail(s);
        if (token && mailbox) {
          const job = row.jobPostId ? await HrJobPost.findByPk(row.jobPostId) : null;
          const sig = await rejectSignature(req.hrActor, mailbox);
          const appUrl = await require('../services/publicUrl').baseFor('careers', req);
          const t = tasks[idx];
          const deadlineText = new Date(t.deadline).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'short' });
          const bodyHtml = hrEmail.taskAdditionalInfoRequest({
            candidateName: row.name, role: job ? job.title : '',
            messageHtml: message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>'),
            deadlineText: `${deadlineText} IST`, uploadUrl: `${appUrl}/task/${t.token}`, signature: sig,
          });
          const cc = await assignedHrCc(row, { excludeEmail: mailbox });
          await sendHrEmailLogged(s, token, mailbox, { from: mailbox, to: row.email, cc, subject: `Additional information requested${job ? ` — ${job.title}` : ''}`, bodyHtml }, { type: 'hr_task_addinfo' });
          emailed = true;
        }
      } catch (e) { console.error('[task] request-info email failed:', e.message); }
    }
    res.json({ ...row.toJSON(), emailed });
  } catch (e) { next(e); }
});

// One-time maintenance: normalise all existing candidate phone numbers to the
// +91XXXXXXXXXX format. Uses OpenAI to interpret messy/edge-case numbers when a
// key is present, with a deterministic fallback. Admin only.
router.post('/candidates/normalize-phones', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const rows = await HrCandidate.findAll();
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const key = s && s.getKey ? s.getKey('openai') : null;
    let updated = 0; const ambiguous = [];
    for (const c of rows) {
      if (!c.phone) continue;
      const norm = normalizePhoneServer(c.phone);
      if (norm && norm !== c.phone) { c.phone = norm; await c.save(); updated += 1; }
      else if (norm && !/^\+\d{10,15}$/.test(norm)) ambiguous.push({ id: c.id, phone: c.phone });
    }
    if (key && ambiguous.length) {
      try {
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({ model: 'gpt-4o-mini', response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: 'You normalise phone numbers to E.164. For Indian mobiles output +91 then 10 digits. Return strict JSON {"results":[{"id":<id>,"phone":"+91XXXXXXXXXX"}]} only. If unsure, omit that id.' },
              { role: 'user', content: JSON.stringify(ambiguous.slice(0, 100)) },
            ], max_tokens: 1500 }),
        });
        const data = await resp.json();
        if (resp.ok) {
          let parsed = {}; try { parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}'); } catch {}
          for (const r of (parsed.results || [])) {
            const cand = rows.find((x) => x.id === r.id);
            if (cand && /^\+\d{10,15}$/.test(String(r.phone || ''))) { cand.phone = r.phone; await cand.save(); updated += 1; }
          }
        }
      } catch { /* best-effort */ }
    }
    hrLog(req, 'candidate.normalize_phones', `${updated} updated`);
    res.json({ ok: true, updated, total: rows.length });
  } catch (e) { next(e); }
});

// AI summary of rejections — clusters reasons across the rejected candidates
// (optionally filtered), returning top-5 reasons and suggestions. Admin/HR.
router.post('/candidates/rejection-summary', requireHrAccess, async (req, res, next) => {
  try {
    const b = req.body || {};
    let rows = await HrCandidate.findAll({ where: { rejected: true } });
    if (b.jobPostId) rows = rows.filter((c) => c.jobPostId === Number(b.jobPostId));
    if (b.hrId) rows = rows.filter((c) => String(c.recruiterId || '') === String(b.hrId));
    if (b.monthOnly) {
      const now = new Date();
      rows = rows.filter((c) => { const d = new Date(c.rejectedAt || c.updatedAt || c.createdAt); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth(); });
    }
    const jobCache = {};
    const jobFor = async (id) => { if (!id) return null; if (!(id in jobCache)) jobCache[id] = await HrJobPost.findByPk(id); return jobCache[id]; };
    if (b.department) {
      const keep = [];
      for (const c of rows) { const j = await jobFor(c.jobPostId); if (j && j.department === b.department) keep.push(c); }
      rows = keep;
    }
    if (rows.length === 0) return res.json({ summary: null, count: 0, message: 'No rejected candidates match these filters.' });

    const items = [];
    for (const c of rows.slice(0, 200)) {
      const j = await jobFor(c.jobPostId);
      const a = c.answers || {};
      items.push({
        position: (j && j.title) || 'Unknown', department: (j && j.department) || '', location: (j && (j.locations || []).join(', ')) || a.city || '',
        hr: c.recruiterName || 'Unassigned', reason: c.rejectionReason || '(no reason recorded)',
        skills: (a.skills || []).slice(0, 6).join(', '),
      });
    }
    const key = await anthropicKey();
    if (!key) return res.json({ summary: null, count: rows.length, message: 'AI is not configured. Add an Anthropic key in settings.' });
    const { callClaude } = require('../services/aiVisibility');
    const sys = 'You are an expert technical recruiter analysing why candidates were rejected. Given a JSON list of rejected candidates (position, department, location, HR, reason, skills), produce a concise analysis. Return STRICT JSON only, no prose, no markdown: {"overview":"2-3 sentence summary","byPosition":[{"position":"","count":0,"topReason":""}],"topReasons":[{"reason":"","count":0,"detail":""}],"suggestions":[""]}. topReasons must be the 5 most common rejection themes (cluster similar wordings together). suggestions: 3-5 concrete improvements based on the patterns across positions, locations and HR.';
    let out;
    try {
      const raw = await callClaude(key, { system: sys, messages: [{ role: 'user', content: JSON.stringify(items) }], maxTokens: 1500 });
      const txt = String(raw || '').replace(/```json|```/g, '').trim();
      out = JSON.parse(txt);
    } catch (e) { return res.json({ summary: null, count: rows.length, message: 'Could not analyse right now. Please try again.' }); }
    res.json({ summary: out, count: rows.length });
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
    // Only the columns we need; interviews live in JSON so we still scan, but we
    // avoid pulling large unrelated blobs and we batch the job lookups.
    const rows = await HrCandidate.findAll({ order: [['updatedAt', 'DESC']], attributes: ['id', 'name', 'email', 'stage', 'jobPostId', 'interviews'] });
    const mineByRow = new Map();
    for (const r of rows) {
      const mine = (r.interviews || []).filter((iv) => (iv.panelists || []).some((p) => p.id === myId));
      if (mine.length) mineByRow.set(r, mine);
    }
    const jobIds = [...new Set([...mineByRow.keys()].map((r) => r.jobPostId).filter(Boolean))];
    const jById = {};
    if (jobIds.length) { (await HrJobPost.findAll({ where: { id: jobIds }, attributes: ['id', 'title'] })).forEach((j) => { jById[j.id] = j; }); }
    const jobsById = {};
    for (const [r, mine] of mineByRow) {
      const job = r.jobPostId ? jById[r.jobPostId] : null;
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

// GET /api/hr/all-interviews — a flat list of scheduled interviews for the
// calendar/list views, filtered by role:
//   • admin: every interview
//   • HR scheduler (hr/recruiter/manager/tl): interviews they scheduled OR sit
//     on the panel for
//   • plain employee / panelist: only interviews where they're a panelist
// Each entry carries the candidate, job, timing, meet link and participants.
router.get('/all-interviews', requireHrAccess, async (req, res, next) => {
  try {
    const actor = req.hrActor;
    const isAdmin = actor.kind === 'admin';
    const myId = actor.id;
    const rows = await HrCandidate.findAll({ order: [['updatedAt', 'DESC']] });
    // Avatar lookups: HR users by id + name, and admin users by id, so the
    // interview list can show a circle photo (or initials) for the scheduler
    // and each attendee.
    const hrUsers = await HrUser.findAll({ attributes: ['id', 'name', 'avatar'] });
    const adminUsers = await User.findAll({ attributes: ['id', 'name', 'avatar'] });
    const avatarById = {};
    const avatarByName = {};
    hrUsers.forEach((u) => { avatarById[String(u.id)] = u.avatar || ''; if (u.name) avatarByName[u.name.toLowerCase()] = u.avatar || ''; });
    adminUsers.forEach((u) => { avatarById[`admin:${u.id}`] = u.avatar || ''; if (u.name) avatarByName[u.name.toLowerCase()] = u.avatar || ''; });
    const jobCache = {};
    const getJob = async (id) => { if (!id) return null; if (!(id in jobCache)) jobCache[id] = await HrJobPost.findByPk(id); return jobCache[id]; };
    const out = [];
    for (const r of rows) {
      const ivs = r.interviews || [];
      if (!ivs.length) continue;
      for (const iv of ivs) {
        const onPanel = (iv.panelists || []).some((p) => String(p.id) === String(myId) || String(p.id) === `admin:${myId}`);
        const scheduledByMe = isAdmin ? false : (iv.scheduledById === myId || iv.by === actor.name);
        // Visibility gate.
        let visible = false;
        if (isAdmin) visible = true;
        else if (actor.type && ['hr', 'recruiter', 'manager', 'tl'].includes(actor.type)) visible = scheduledByMe || onPanel;
        else visible = onPanel; // plain employees / pure panelists
        if (!visible) continue;
        const job = await getJob(r.jobPostId);
        const schedAvatar = (iv.scheduledById != null && avatarById[String(iv.scheduledById)]) || (iv.by && avatarByName[String(iv.by).toLowerCase()]) || '';
        out.push({
          interviewId: iv.id, candidateId: r.id, candidateName: r.name, candidateEmail: r.email,
          jobId: r.jobPostId, jobTitle: job ? job.title : 'General',
          at: iv.at, end: iv.end, mode: iv.mode, round: iv.round, roundLabel: iv.roundLabel,
          meetLink: iv.meetLink || '', eventLink: iv.eventLink || '', notes: iv.notes || '',
          scheduledBy: iv.by || '', scheduledById: iv.scheduledById || null, scheduledByAvatar: schedAvatar,
          stage: r.stage,
          panelists: (iv.panelists || []).map((p) => ({ id: p.id, name: p.name, email: p.email, avatar: avatarById[String(p.id)] || avatarByName[String(p.name || '').toLowerCase()] || '' })),
          amPanelist: onPanel, scheduledByMe,
        });
      }
    }
    out.sort((a, b) => new Date(a.at) - new Date(b.at));
    res.json({ interviews: out });
  } catch (e) { next(e); }
});
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
    const { base64, fileName, docType } = req.body || {};
    if (!base64) return res.status(400).json({ error: 'No file provided.' });
    const { safeFolder } = require('./careers');
    const imagekit = require('../services/imagekit');
    const job = row.jobPostId ? await HrJobPost.findByPk(row.jobPostId) : null;
    const out = await imagekit.uploadFile({ base64, fileName: fileName || 'file', folder: `HRMS/${safeFolder(job ? job.title : 'General')}/Attachments` });
    const list = Array.isArray(row.attachments) ? row.attachments.slice() : [];
    const allowedTypes = ['Resume', 'Work Portfolio', 'Task', 'Other'];
    const type = allowedTypes.includes(docType) ? docType : 'Other';
    list.unshift({ id: `at${Date.now()}${Math.floor(Math.random() * 1000)}`, name: out.name || fileName, url: out.url, docType: type, at: new Date().toISOString(), by: req.hrActor.name });
    row.attachments = list; row.changed('attachments', true);
    pushTimeline(row, { type: 'attachment', text: `${req.hrActor.name} uploaded ${type === 'Other' ? 'an attachment' : `a ${type.toLowerCase()}`}: ${out.name || fileName}.`, by: req.hrActor.name });
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
      else if (b.action === 'reject') { row.rejected = true; row.stage = 'rejected'; row.rejectedAt = new Date(); row.rejectionReason = String(b.reason || '').slice(0, 300); pushTimeline(row, { type: 'reject', text: `Rejected (bulk) by ${req.hrActor.name}${b.reason ? ` — ${b.reason}` : ''}.`, by: req.hrActor.name }); }
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
    // Older offer objects may predate these arrays (or have them as null), which
    // would make .unshift/.find crash. Normalise them before any operation.
    if (!Array.isArray(offer.salaryDiscussions)) offer.salaryDiscussions = [];
    if (!Array.isArray(offer.approvals)) offer.approvals = [];
    const now = new Date().toISOString();
    switch (b.op) {
      case 'add_discussion':
        offer.salaryDiscussions.unshift({ id: `sd${Date.now()}`, at: b.at || now, mode: b.mode || 'phone', meetLink: b.meetLink || '', offered: b.offered || '', candidateAsk: b.candidateAsk || '', notes: b.notes || '', by: req.hrActor.name });
        pushTimeline(row, { type: 'offer', text: `Salary offer logged by ${req.hrActor.name}${b.offered ? ` (offered ${b.offered}${b.candidateAsk ? `, asked ${b.candidateAsk}` : ''})` : ''}.`, by: req.hrActor.name });
        break;
      case 'manage_hire': {
        // Edit accepted salary, joining date/time and joined/not-joined in one go.
        if (b.acceptedAmount !== undefined) {
          const amt = String(b.acceptedAmount).slice(0, 60);
          offer.acceptedAmount = amt;
          offer.finalCtc = amt || offer.finalCtc;
          // Keep the accepted salary-offer row in sync if there is one.
          if (offer.acceptedOfferId && Array.isArray(offer.salaryDiscussions)) {
            const d = offer.salaryDiscussions.find((x) => x.id === offer.acceptedOfferId);
            if (d) { d.offered = amt; d.editedAt = now; d.editedBy = req.hrActor.name; }
          }
        }
        const prevDate = offer.joiningDate ? normalizeJoiningYmd(offer.joiningDate) : '';
        const newDate = b.joiningDate !== undefined ? (b.joiningDate ? (normalizeJoiningYmd(b.joiningDate) || String(b.joiningDate).slice(0, 40)) : '') : prevDate;
        if (b.joiningDate !== undefined) offer.joiningDate = newDate;
        if (b.joiningTime !== undefined) offer.joiningTime = String(b.joiningTime || '').slice(0, 8);
        // Record a joining-date change with its reason, and re-baseline onboarding.
        if (prevDate && newDate && prevDate !== newDate) {
          const onb = row.onboarding || {};
          onb.joiningChanges = Array.isArray(onb.joiningChanges) ? onb.joiningChanges : [];
          onb.joiningChanges.push({ from: prevDate, to: newDate, reason: String(b.changeReason || '').slice(0, 300), by: req.hrActor.name, at: now });
          // Clear one-shot send markers so reminders recompute against the new date.
          onb.welcomeEmailSentAt = null; onb.reminderSentAt = null; onb.seniorNotifiedAt = null; onb.reportingSentAt = null;
          row.onboarding = onb; row.changed('onboarding', true);
          pushTimeline(row, { type: 'offer', text: `Joining date changed ${prevDate} → ${newDate} by ${req.hrActor.name}${b.changeReason ? ` — ${String(b.changeReason).slice(0, 150)}` : ''}.`, by: req.hrActor.name });
        }
        // Initialize onboarding whenever the joining date is set to a FUTURE
        // date and no onboarding record exists yet. A past/blank date means the
        // candidate has effectively already joined or not, so onboarding is
        // skipped and HR confirms the joined/not-joined status instead.
        const istTodayMs2 = new Date(new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
        const newDateMs = newDate ? new Date(newDate + 'T00:00:00Z').getTime() : 0;
        if (newDate && newDateMs >= istTodayMs2 && !row.onboarding) {
          row.onboarding = onboardingInit();
          row.changed('onboarding', true);
        }
        if (b.joinedConfirmed !== undefined) offer.joinedConfirmed = !!b.joinedConfirmed;
        if (b.notJoined) {
          offer.notJoined = true;
          offer.notJoinedAt = offer.notJoinedAt || now;
          offer.notJoinedReason = String(b.notJoinedReason || '').slice(0, 300);
          // A candidate who accepted but didn't join is moved to the Blacklist.
          row.blacklisted = true;
          row.blacklistedAt = new Date();
          row.blacklistReason = String(b.notJoinedReason || '').slice(0, 300);
        } else {
          offer.notJoined = false; offer.notJoinedAt = null; offer.notJoinedReason = '';
          // Un-marking did-not-join also lifts the blacklist (if it was set this way).
          if (row.blacklisted) { row.blacklisted = false; row.blacklistedAt = null; row.blacklistReason = ''; }
        }
        pushTimeline(row, { type: 'offer', text: `Hire details updated by ${req.hrActor.name}${offer.notJoined ? ' — marked did-not-join, moved to Blacklist' : (offer.joiningDate ? ` — joining ${offer.joiningDate}` : '')}.`, by: req.hrActor.name });
        break;
      }
      case 'mark_not_joined':
        offer.notJoined = true;
        offer.notJoinedAt = now;
        offer.notJoinedReason = String(b.reason || '').slice(0, 300);
        pushTimeline(row, { type: 'offer', text: `Marked as did-not-join by ${req.hrActor.name}${b.reason ? ` — ${String(b.reason).slice(0, 150)}` : ''}.`, by: req.hrActor.name });
        break;
      case 'edit_discussion': {
        const list = offer.salaryDiscussions || [];
        const d = list.find((x) => x.id === b.discussionId);
        if (!d) return res.status(404).json({ error: 'Salary offer not found.' });
        if (b.offered !== undefined) d.offered = String(b.offered).slice(0, 60);
        if (b.candidateAsk !== undefined) d.candidateAsk = String(b.candidateAsk).slice(0, 60);
        if (b.notes !== undefined) d.notes = String(b.notes).slice(0, 300);
        d.editedAt = now; d.editedBy = req.hrActor.name;
        // If this offer was the accepted one, keep the final amount in sync.
        if (offer.acceptedOfferId === d.id) { offer.acceptedAmount = d.offered; offer.finalCtc = d.offered || offer.finalCtc; }
        offer.salaryDiscussions = [...list];
        pushTimeline(row, { type: 'offer', text: `Salary offer edited by ${req.hrActor.name}${d.offered ? ` (now offered ${d.offered}${d.candidateAsk ? `, asked ${d.candidateAsk}` : ''})` : ''}.`, by: req.hrActor.name });
        break;
      }
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
      case 'set_hired_offer': {
        const offered = String(b.offered || '').slice(0, 60);
        offer.acceptedAmount = offered;
        offer.finalCtc = offered || offer.finalCtc;
        offer.status = 'accepted';
        offer.active = true;
        if (!Array.isArray(offer.salaryDiscussions)) offer.salaryDiscussions = [];
        offer.salaryDiscussions.unshift({ id: `sd${Date.now()}`, at: now, mode: 'manual', meetLink: '', offered, candidateAsk: String(b.candidateAsk || '').slice(0, 60), notes: String(b.note || '').slice(0, 300), by: req.hrActor.name });
        offer.acceptedOfferId = offer.salaryDiscussions[0].id;
        pushTimeline(row, { type: 'offer', text: `Hired offer recorded by ${req.hrActor.name}${offered ? ` (offered ${offered}${b.candidateAsk ? `, asked ${b.candidateAsk}` : ''})` : ''}.`, by: req.hrActor.name });
        break;
      }
      case 'set_status':
        if (b.status === 'accepted') {
          const list = offer.salaryDiscussions || [];
          if (!list.length) return res.status(400).json({ error: 'Log at least one salary offer before marking accepted.' });
          // Use the chosen offer if given, else the most recent logged offer.
          const chosen = list.find((d) => d.id === b.acceptedOfferId) || list[0];
          const finalPrice = (b.finalPrice != null && String(b.finalPrice).trim()) ? String(b.finalPrice).trim() : (chosen.offered || '');
          offer.acceptedOfferId = chosen.id;
          offer.acceptedAmount = finalPrice;
          offer.finalCtc = finalPrice || offer.finalCtc;
          if (b.note) offer.acceptNote = String(b.note).slice(0, 500);
          if (b.joiningDate) offer.joiningDate = String(b.joiningDate).slice(0, 40);
          offer.status = 'accepted';
          // Start onboarding if the joining date is in the future.
          {
            const istToday2 = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
            const jd2 = offer.joiningDate ? String(offer.joiningDate).slice(0, 10) : '';
            if (jd2 && jd2 > istToday2 && !row.onboarding) { row.onboarding = onboardingInit(); row.changed('onboarding', true); }
          }
          pushTimeline(row, { type: 'offer', text: `Candidate accepted the offer${finalPrice ? ` at ${finalPrice}` : ''}${offer.joiningDate ? `, joining ${offer.joiningDate}` : ''}${b.note ? ` — ${String(b.note).slice(0, 150)}` : ''}.`, by: req.hrActor.name });
        } else if (b.status === 'declined') {
          // Record the final numbers, then move the candidate to Rejected.
          if (b.candidateAsk != null || b.offered != null) {
            offer.declinedSummary = { candidateAsk: String(b.candidateAsk || '').slice(0, 60), offered: String(b.offered || '').slice(0, 60) };
          }
          if (b.note) offer.declineNote = String(b.note).slice(0, 500);
          offer.status = 'declined';
          const reasonBits = [];
          if (b.offered) reasonBits.push(`offered ${b.offered}`);
          if (b.candidateAsk) reasonBits.push(`asked ${b.candidateAsk}`);
          const reasonText = `Offer declined${reasonBits.length ? ` (${reasonBits.join(', ')})` : ''}${b.note ? ` — ${String(b.note).slice(0, 150)}` : ''}`;
          row.rejected = true; row.stage = 'rejected'; row.rejectedAt = new Date();
          row.rejectionReason = reasonText.slice(0, 300);
          pushTimeline(row, { type: 'reject', text: `${reasonText}. Moved to Rejected by ${req.hrActor.name}.`, by: req.hrActor.name });
        } else {
          offer.status = b.status || offer.status;
        }
        break;
      default: return res.status(400).json({ error: 'Unknown offer operation.' });
    }
    row.offer = offer; row.changed('offer', true);
    // When the offer is accepted, the hiring is complete — automatically move the
    // candidate into the Hired stage of their pipeline and clear the pending flag.
    if (offer.status === 'accepted') {
      const job = row.jobPostId ? await HrJobPost.findByPk(row.jobPostId) : null;
      const hiredStage = (job && job.stages || []).find((s) => HIRED_STAGE_IDS.has(String(s.id).toLowerCase()));
      const targetStage = hiredStage ? hiredStage.id : 'hired';
      if (row.stage !== targetStage) {
        row.stage = targetStage; row.rejected = false;
        pushTimeline(row, { type: 'stage', text: `${row.name} moved to Hired — offer accepted.`, by: req.hrActor.name });
      }
      if (offer.pendingHire) { offer.pendingHire = false; row.changed('offer', true); }
    }
    await row.save();
    hrLog(req, 'offer.' + (b.op || 'update'), `${row.name}${b.status ? ` — ${b.status}` : ''}`);
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

// ===== Onboarding (HR side) ================================================
// Full onboarding detail for the candidate's Hired record: candidate documents
// + the HR checklist + assigned-HR contact + the public onboarding URL.
// List all candidates currently in onboarding (hired, with a joining date) for
// the Core HR → Onboarding page. Includes progress + status at a glance.
// Diagnostic: why a candidate is / isn't on the onboarding list. Admin/HR only.
router.get('/onboarding/debug', requireHrAccess, async (req, res, next) => {
  try {
    const rows = await HrCandidate.findAll({ where: { blacklisted: false } });
    const istTodayStr = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
    const istTodayMs = new Date(istTodayStr + 'T00:00:00Z').getTime();
    const toYmd = normalizeJoiningYmd;
    const report = rows.map((c) => {
      const offer = c.offer || {};
      const rawJd = offer.joiningDate || '';
      const jd = toYmd(rawJd);
      const hired = isHiredCandidate(c);
      let reason = 'shown';
      if (offer.notJoined) reason = 'marked notJoined';
      else if (offer.joinedConfirmed) reason = 'joinedConfirmed (already joined)';
      else if (!hired) reason = `not a hired candidate (stage: ${c.stage || '—'}, offer: ${offer.status || '—'})`;
      else if (rawJd && !jd) reason = `joiningDate "${rawJd}" could not be parsed`;
      else if (jd && !(new Date(jd + 'T00:00:00Z').getTime() > istTodayMs)) reason = `joining date ${jd} is not in the future (today ${istTodayStr})`;
      return { id: c.id, name: c.name, stage: c.stage, offerStatus: offer.status || null, isHired: hired, rawJoiningDate: rawJd || null, parsedJoiningDate: jd || null, blacklisted: !!c.blacklisted, joinedConfirmed: !!offer.joinedConfirmed, notJoined: !!offer.notJoined, hasOnboarding: !!c.onboarding, wouldShow: reason === 'shown', reason };
    });
    res.json({ istToday: istTodayStr, total: rows.length, shown: report.filter((r) => r.wouldShow).length, candidates: report });
  } catch (e) { next(e); }
});

router.get('/onboarding', requireHrAccess, async (req, res, next) => {
  try {
    const rows = await HrCandidate.findAll({ where: { blacklisted: false } });
    // IST "today" as a yyyy-mm-dd string and as a day-start timestamp.
    const istTodayStr = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
    const istTodayMs = new Date(istTodayStr + 'T00:00:00Z').getTime();
    const toYmd = normalizeJoiningYmd;
    // First pass: keep only candidates that belong on the board (cheap checks).
    const keep = [];
    for (const c of rows) {
      const offer = c.offer || {};
      if (offer.notJoined || offer.joinedConfirmed) continue; // joined → employee; not-joined → blacklist
      if (!isHiredCandidate(c)) continue;
      const jd = toYmd(offer.joiningDate || '');
      if (jd) {
        const jdMs = new Date(jd + 'T00:00:00Z').getTime();
        if (jdMs < istTodayMs) continue; // confidently past → drop
      }
      keep.push(c);
    }
    // Lazy-init onboarding blobs for survivors, then persist them in parallel
    // (instead of awaiting a save per row inside the loop).
    const toSave = [];
    for (const c of keep) { if (!c.onboarding) { c.onboarding = onboardingInit(); c.changed('onboarding', true); toSave.push(c); } }
    if (toSave.length) await Promise.all(toSave.map((c) => c.save()));
    // Batch-load every needed job in ONE query.
    const jobIds = [...new Set(keep.map((c) => c.jobPostId).filter(Boolean))];
    const jobsById = {};
    if (jobIds.length) { (await HrJobPost.findAll({ where: { id: jobIds } })).forEach((j) => { jobsById[j.id] = j; }); }
    const out = [];
    for (const c of keep) {
      const offer = c.offer || {};
      const onb = c.onboarding;
      const job = c.jobPostId ? jobsById[c.jobPostId] : null;
      const isSales = /sales/i.test(String((job && job.department) || ''));
      const tasks = (onb.hrTasks || []).filter((t) => !t.salesOnly || isSales);
      const doneCount = tasks.filter((t) => t.done).length;
      out.push({
        id: c.id, name: c.name, role: job ? job.title : '', department: job ? job.department : '',
        branch: (job && job.locations && job.locations[0]) || c.branch || '',
        joiningDate: offer.joiningDate, joiningTime: offer.joiningTime || '',
        docsStatus: onb.status || 'pending',
        docsSubmittedAt: onb.submittedAt || null,
        converted: !!onb.convertedEmployeeId,
        joined: !!offer.joinedConfirmed,
        tasksDone: doneCount, tasksTotal: tasks.length,
      });
    }
    // Soonest upcoming joining date first; candidates without a date go last.
    out.sort((a, b) => {
      const ax = a.joiningDate ? String(normalizeJoiningYmd(a.joiningDate)) : '';
      const bx = b.joiningDate ? String(normalizeJoiningYmd(b.joiningDate)) : '';
      if (ax && bx) return ax.localeCompare(bx);
      if (ax) return -1;
      if (bx) return 1;
      return String(a.name).localeCompare(String(b.name));
    });
    res.json({ candidates: out });
  } catch (e) { next(e); }
});

router.get('/candidates/:id/onboarding', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    if (!row.onboarding) { row.onboarding = onboardingInit(); row.changed('onboarding', true); await row.save(); }
    const onb = row.onboarding;
    // Self-heal: if the onboarding link went missing (e.g. an earlier physical-
    // verify/undo left the token blank) and the candidate isn't currently marked
    // physically verified, regenerate the token so the link works again.
    if (!onb.token && !onb.docsPhysical) {
      onb.token = crypto.randomBytes(16).toString('hex');
      row.onboarding = onb; row.changed('onboarding', true);
      await row.save();
    }
    // Self-heal: if the senior notice was already sent (seniorNotifiedAt set) but
    // the "Email department PM & Team Leads" task wasn't marked done (older
    // records, before auto-complete existed), mark it done now.
    if (onb.seniorNotifiedAt && Array.isArray(onb.hrTasks)) {
      const t = onb.hrTasks.find((x) => x.id === 'notify_seniors');
      if (t && !t.done) {
        onb.hrTasks = onb.hrTasks.map((x) => x.id === 'notify_seniors'
          ? { ...x, done: true, doneAt: onb.seniorNotifiedAt, meta: { ...(x.meta || {}), autoSent: true, sentAt: onb.seniorNotifiedAt } }
          : x);
        row.onboarding = onb; row.changed('onboarding', true); await row.save();
      }
    }
    const job = row.jobPostId ? await HrJobPost.findByPk(row.jobPostId) : null;
    let hr = null;
    const ids = (job && Array.isArray(job.assignedHrIds)) ? job.assignedHrIds : [];
    if (ids.length) hr = await HrUser.findByPk(ids[0]);
    if (!hr && row.recruiterId) hr = await HrUser.findByPk(row.recruiterId);
    const appUrl = await require('../services/publicUrl').baseFor('careers', req);
    const isSales = /sales/i.test(String((job && job.department) || '') + ' ' + String(row.stage || ''));
    // Whether the candidate's onboarding link is currently expired — mirrors the
    // public page's rule exactly so the drawer only offers "reactivate" when the
    // link has actually lapsed. Rule: expires the day BEFORE joining; a manual
    // reactivation window (reactivatedUntil) overrides that until its date; a
    // submitted onboarding is never "expired".
    const linkStatus = (() => {
      const offer = row.offer || {};
      if (onb.status === 'submitted') return { expired: false, submitted: true };
      const jd = normalizeJoiningYmd(offer.joiningDate || '');
      const istTodayStr = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
      const todayMs = new Date(istTodayStr + 'T00:00:00Z').getTime();
      if (onb.reactivatedUntil) {
        const untilMs = new Date(String(onb.reactivatedUntil).slice(0, 10) + 'T00:00:00Z').getTime();
        return { expired: todayMs > untilMs, reactivatedUntil: String(onb.reactivatedUntil).slice(0, 10), expiryDate: String(onb.reactivatedUntil).slice(0, 10) };
      }
      if (!jd) return { expired: false }; // no joining date → can't be expired
      const expiryMs = new Date(jd + 'T00:00:00Z').getTime() - 86400000; // day before joining
      const expiryDate = new Date(expiryMs).toISOString().slice(0, 10);
      return { expired: todayMs >= expiryMs, expiryDate };
    })();
    res.json({
      candidate: { id: row.id, name: row.name, email: row.email, phone: row.phone },
      role: job ? job.title : '',
      department: job ? job.department : '',
      isSales,
      offer: row.offer || {},
      onboarding: onb,
      onboardingUrl: onb.token ? `${appUrl}/onboarding/${onb.token}` : '',
      linkStatus,
      hr: hr ? { id: hr.id, name: hr.name, phone: hr.phone || '', email: hr.email || '' } : null,
      convertedEmployeeId: onb.convertedEmployeeId || null,
      queries: (onb.queries || []).map((q) => ({ id: q.id, message: q.message, at: q.at, reply: q.reply || null, repliedAt: q.repliedAt || null, repliedByName: q.repliedByName || null })),
      hrStaff: (await HrUser.findAll({ where: { active: true } })).filter((u) => ['hr', 'recruiter', 'manager'].includes(u.type) || u.isHrManager || u.isHrAdmin).map((u) => ({ id: u.id, name: u.name })),
      physicalCollectedDate: onb.physicalCollectedDate || null,
    });
  } catch (e) { next(e); }
});

// Send (or resend) the onboarding welcome email to the candidate with the link.
// Mark the candidate's documents as verified physically (in person). No
// onboarding link/token is created and no welcome/reminder email is sent, but
// the rest of the onboarding (checklist, senior notice, reporting details,
// welcome-aboard, KPI/KRA) proceeds normally. Toggleable.
// Reactivate an expired onboarding link — grants the candidate access again
// until a chosen date (defaults to the joining date). HR uses this when a
// candidate needs a little more time to submit documents.
router.post('/candidates/:id/onboarding/reactivate', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    const onb = row.onboarding || onboardingInit();
    if (!onb.token) onb.token = crypto.randomBytes(16).toString('hex');
    const until = String((req.body && req.body.until) || '').slice(0, 10);
    onb.reactivatedUntil = until || (row.offer && row.offer.joiningDate ? String(row.offer.joiningDate).slice(0, 10) : new Date(Date.now() + 330 * 60000 + 3 * 86400000).toISOString().slice(0, 10));
    row.onboarding = onb; row.changed('onboarding', true);
    pushTimeline(row, { type: 'onboarding', text: `Onboarding link reactivated until ${onb.reactivatedUntil} by ${req.hrActor.name}.`, by: req.hrActor.name });
    await row.save();
    res.json({ ok: true, reactivatedUntil: onb.reactivatedUntil });
  } catch (e) { next(e); }
});

// HR replies to a candidate's onboarding query. Saves the reply and emails the
// candidate their original question + the answer (Application-thank-you layout).
router.post('/candidates/:id/onboarding/query/:queryId/reply', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    const reply = String((req.body && req.body.reply) || '').trim();
    if (!reply) return res.status(400).json({ error: 'Please type a reply.' });
    const onb = row.onboarding || {};
    const q = (onb.queries || []).find((x) => x.id === req.params.queryId);
    if (!q) return res.status(404).json({ error: 'Query not found.' });
    q.reply = reply.slice(0, 4000); q.repliedAt = new Date().toISOString(); q.repliedById = req.hrActor.id; q.repliedByName = req.hrActor.name;
    row.onboarding = onb; row.changed('onboarding', true);
    await row.save();
    // Email the candidate their question + the answer.
    try {
      const s = await Settings.findOne({ where: { singleton: 'settings' } });
      const token = s && s.getKey ? s.getKey('hrMailboxToken') : null;
      const mailbox = mailboxEmail(s);
      const to = (onb.fields && onb.fields.email) || row.email;
      if (token && mailbox && to) {
        const gmail = require('../services/gmail');
        const hrEmail = require('../services/hrEmailTemplate');
        const bodyHtml = hrEmail.onboardingQueryReply({ candidateName: (onb.fields && onb.fields.name) || row.name, question: q.message, answer: reply, hrName: req.hrActor.name });
        await sendHrEmailLogged(s, token, mailbox, { from: mailbox, to, subject: 'Response to your onboarding question — Qtonix', bodyHtml }, { type: 'onboarding_query_reply' });
        q.emailedAt = new Date().toISOString(); row.changed('onboarding', true); await row.save();
      }
    } catch (e) { /* reply saved even if email fails */ }
    res.json({ ok: true, query: q });
  } catch (e) { next(e); }
});

router.post('/candidates/:id/onboarding/docs-physical', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    const b = req.body || {};
    const onb = row.onboarding || onboardingInit();
    if (b.on === false) {
      // Undo physical verification: restore the public onboarding page (new
      // token) and the previous status, and clear the physical email markers so
      // the welcome/reminder can be sent again.
      if (onb.docsPhysical) {
        onb.docsPhysical = false;
        onb.docsComplete = false;
        if (onb.status === 'submitted' && onb.physicalMarkedStatus) onb.status = onb.physicalMarkedStatus;
        if (!onb.token) onb.token = crypto.randomBytes(16).toString('hex'); // restore the link
        if (onb.welcomeEmailSentAt === 'physical') onb.welcomeEmailSentAt = null;
        if (onb.reminderSentAt === 'physical') onb.reminderSentAt = null;
        onb.verifiedById = null; onb.verifiedByName = null;
      }
      pushTimeline(row, { type: 'onboarding', text: `Physical document verification undone by ${req.hrActor.name} — onboarding link restored.`, by: req.hrActor.name });
    } else {
      // Mark verified in person. Suppress the public page + welcome/reminder
      // emails by clearing the token and setting the one-shot email markers.
      onb.docsPhysical = true;
      onb.physicalMarkedStatus = onb.status || 'pending';
      onb.status = 'submitted';
      onb.docsComplete = true;
      onb.submittedAt = onb.submittedAt || new Date().toISOString();
      onb.token = null; // no public onboarding page
      onb.welcomeEmailSentAt = onb.welcomeEmailSentAt || 'physical'; // suppress welcome
      onb.reminderSentAt = onb.reminderSentAt || 'physical'; // suppress reminder
      // Who collected the documents, and when (HR-provided).
      onb.physicalCollectedDate = String((b.date || '')).slice(0, 10) || new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
      if (b.verifiedById) {
        const verifier = await HrUser.findByPk(b.verifiedById);
        onb.verifiedById = b.verifiedById;
        onb.verifiedByName = verifier ? verifier.name : req.hrActor.name;
      } else {
        onb.verifiedById = req.hrActor.id; onb.verifiedByName = req.hrActor.name;
      }
      pushTimeline(row, { type: 'onboarding', text: `Documents verified physically (collected ${onb.physicalCollectedDate}) by ${onb.verifiedByName}, recorded by ${req.hrActor.name} — no onboarding link sent; checklist and other automations continue.`, by: req.hrActor.name });
    }
    row.onboarding = onb; row.changed('onboarding', true);
    await row.save();
    res.json({ ok: true, onboarding: onb });
  } catch (e) { next(e); }
});

router.post('/candidates/:id/onboarding/send-welcome', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    if (!row.email) return res.status(400).json({ error: 'This candidate has no email on file.' });
    if (!row.onboarding) { row.onboarding = onboardingInit(); row.changed('onboarding', true); }
    const onb = row.onboarding;
    const job = row.jobPostId ? await HrJobPost.findByPk(row.jobPostId) : null;
    const offer = row.offer || {};
    const appUrl = await require('../services/publicUrl').baseFor('careers', req);
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const token = s && s.getKey ? s.getKey('hrMailboxToken') : null;
    const mailbox = mailboxEmail(s);
    if (!token || !mailbox) return res.status(400).json({ error: 'No recruitment mailbox is linked. Connect one in Admin → Email.' });
    const gmail = require('../services/gmail');
    const hrEmail = require('../services/hrEmailTemplate');
    const jd = offer.joiningDate ? new Date(offer.joiningDate + 'T00:00:00') : null;
    const joiningDateText = jd ? jd.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
    const deadline = jd ? new Date(jd.getTime() - 3 * 86400000) : null;
    const deadlineText = deadline ? deadline.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
    let hr = null; const ids = (job && job.assignedHrIds) || []; if (ids.length) hr = await HrUser.findByPk(ids[0]);
    const sig = hr ? { name: hr.name, title: `HR \u00b7 Qtonix`, email: mailbox } : { name: 'Qtonix Recruitment Team', title: 'Talent Acquisition \u00b7 Qtonix', email: mailbox };
    const bodyHtml = hrEmail.onboardingWelcome({
      candidateName: row.name, role: job ? job.title : '', joiningDateText,
      department: job ? job.department : '', deadlineText,
      onboardingUrl: onb.token ? `${appUrl}/onboarding/${onb.token}` : '', signature: sig,
    });
    const cc = []; if (hr && hr.email) cc.push(hr.email);
    await sendHrEmailLogged(s, token, mailbox, { from: mailbox, to: row.email, cc, subject: `Welcome to Qtonix, ${String(row.name).split(' ')[0]}! \u2013 Next Steps`, bodyHtml }, { type: 'onboarding_welcome' });
    onb.welcomeEmailSentAt = new Date().toISOString();
    if (!onb.activatedAt) onb.activatedAt = onb.welcomeEmailSentAt;
    row.onboarding = onb; row.changed('onboarding', true);
    pushTimeline(row, { type: 'onboarding', text: `Onboarding welcome email sent to ${row.name} by ${req.hrActor.name}.`, by: req.hrActor.name });
    await row.save();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Create an employee (HrUser) from a submitted onboarding candidate. HR supplies
// the org-specific fields (Employee ID, branch, reporting manager/TL). All
// onboarding documents are carried over and linked to the new employee.
router.post('/candidates/:id/onboarding/create-employee', requireHrAccess, async (req, res, next) => {
  try {
    if (!(req.isHrAdmin || req.isHrManager || (req.hrUser && HR_STAFF_TYPES.includes(req.hrUser.type)))) {
      return res.status(403).json({ error: 'You don\u2019t have permission to create employees.' });
    }
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    const onb = row.onboarding || {};
    if (onb.convertedEmployeeId) {
      const existing = await HrUser.findByPk(onb.convertedEmployeeId);
      if (existing) return res.status(400).json({ error: 'An employee has already been created for this candidate.' });
    }
    const b = req.body || {};
    if (!b.email || !b.password || !b.type) return res.status(400).json({ error: 'Email, password and role are required.' });
    const email = String(b.email).toLowerCase().trim();
    const dup = await HrUser.findOne({ where: { email } });
    if (dup) return res.status(409).json({ error: 'An employee with this email already exists.' });
    const f = onb.fields || {};
    const docs = onb.docs || {};
    const linkedDocs = [];
    const add = (u, kind) => { if (u && u.url) linkedDocs.push({ name: u.name, url: u.url, kind, at: u.at || new Date().toISOString() }); };
    add(docs.photo, 'photo'); add(docs.panCard, 'pan'); add(docs.aadhaarCard, 'aadhaar');
    add(docs.addressProof, 'address_proof'); add(docs.degreeCertificate, 'degree');
    (docs.marksheets || []).forEach((u) => add(u, 'marksheet'));
    (onb.prevCompanies || []).forEach((c) => { (c.expLetters || []).forEach((u) => add(u, 'experience_letter')); (c.salarySlips || []).forEach((u) => add(u, 'salary_slip')); });

    const passwordHash = await bcrypt.hash(String(b.password), 10);
    const marital = /married/i.test(f.maritalStatus || '') ? 'married' : (f.maritalStatus ? 'single' : null);
    const emp = await HrUser.create({
      name: f.name || row.name, email, passwordHash, type: b.type,
      employeeId: b.employeeId || null,
      phone: f.phone || row.phone || '+91 ',
      designation: b.designation || (row.jobPostId ? '' : ''),
      branch: b.branch || '',
      department: b.department || '',
      joiningDate: (row.offer && row.offer.joiningDate) || null,
      shiftId: b.shiftId ? Number(b.shiftId) : null,
      reportsToId: b.reportsToId ? Number(b.reportsToId) : null,
      reportsToAdminId: b.reportsToAdminId ? Number(b.reportsToAdminId) : null,
      avatar: docs.photo && docs.photo.url ? docs.photo.url : null,
      birthday: f.dob || null,
      maritalStatus: marital,
      anniversary: f.anniversary || null,
      fatherName: f.fatherName || '',
      bloodGroup: f.bloodGroup || '',
      panNumber: f.pan || '',
      aadhaarNumber: f.aadhaar || '',
      presentAddress: f.presentAddress || '',
      permanentAddress: f.permanentAddress || '',
      onboardingDocs: linkedDocs,
      fromCandidateId: row.id,
      active: true,
    });
    // Seed the standard employee onboarding checklist (existing mechanism).
    try {
      const tmpl = (s => (s && Array.isArray(s.hrOnboardingTasks)) ? s.hrOnboardingTasks : [])(await Settings.findOne({ where: { singleton: 'settings' } }));
      let order = 0;
      for (const t of tmpl) { await HrOnboarding.create({ employeeId: emp.id, task: t, order: order++ }); }
    } catch {}
    onb.convertedEmployeeId = emp.id;
    // Mark the "activate HRMS" checklist item done.
    onb.hrTasks = (onb.hrTasks || []).map((t) => (t.id === 'activate_hrms' ? { ...t, done: true, doneAt: new Date().toISOString(), doneById: req.hrActor.id, meta: { ...(t.meta || {}), employeeId: emp.id } } : t));
    row.onboarding = onb; row.changed('onboarding', true);
    pushTimeline(row, { type: 'onboarding', text: `${row.name} was created as an employee (ID ${emp.employeeId || emp.id}) by ${req.hrActor.name}.`, by: req.hrActor.name });
    await row.save();
    res.json({ ok: true, employeeId: emp.id });
  } catch (e) { next(e); }
});

// Update a single HR onboarding checklist task: toggle done, or run its
// automation (route a task to another department, save a vendor delivery date,
// or create the team welcome-meeting announcement).
router.post('/candidates/:id/onboarding/task/:taskId', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    if (!row.onboarding) return res.status(400).json({ error: 'Onboarding not started.' });
    const onb = row.onboarding;
    const tasks = onb.hrTasks || [];
    const idx = tasks.findIndex((t) => t.id === req.params.taskId);
    if (idx < 0) return res.status(404).json({ error: 'Task not found.' });
    const task = tasks[idx];
    const b = req.body || {};
    const nowIso = new Date().toISOString();
    const job = row.jobPostId ? await HrJobPost.findByPk(row.jobPostId) : null;

    // --- Automations -------------------------------------------------------
    if (b.action === 'route_it' || (task.route && b.action === 'route')) {
      // Fan the task out to the target department's employees' review feed.
      const dept = task.route || 'IT & Hardware';
      const existing = await HrOnboardingTask.findOne({ where: { candidateId: row.id, hrTaskId: task.id, done: false } });
      if (!existing) {
        await HrOnboardingTask.create({
          candidateId: row.id, candidateName: row.name, forDepartment: dept,
          branch: (job && job.locations && job.locations[0]) || '',
          label: `Prepare computer & desk for ${row.name}`,
          sub: `New joiner${job ? ` · ${job.title}` : ''}${row.offer && row.offer.joiningDate ? ` · joining ${row.offer.joiningDate}` : ''}`,
          hrTaskId: task.id,
        });
      }
      task.meta = { ...(task.meta || {}), routedTo: dept, routedAt: nowIso };
      pushTimeline(row, { type: 'onboarding', text: `Task sent to ${dept} team: prepare computer for ${row.name}.`, by: req.hrActor.name });
    } else if (b.action === 'vendor_date') {
      task.meta = { ...(task.meta || {}), deliveryDate: String(b.deliveryDate || '').slice(0, 10) };
      task.done = true; task.doneAt = nowIso; task.doneById = req.hrActor.id;
      pushTimeline(row, { type: 'onboarding', text: `ID card ordered for ${row.name} — expected ${task.meta.deliveryDate || 'TBD'}.`, by: req.hrActor.name });
    } else if (b.action === 'welcome_meeting') {
      // Create an announcement for the joiner's branch to attend.
      const dept = (job && job.department) || row.department || '';
      const branch = (job && job.locations && job.locations[0]) || row.branch || '';
      const timeStr = String(b.time || '').slice(0, 40);
      const dateStr = String(b.date || (row.offer && row.offer.joiningDate) || '').slice(0, 10);
      const when = [dateStr ? new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }) : '', timeStr].filter(Boolean).join(' at ');
      const ann = await HrAnnouncement.create({
        title: `Welcome ${row.name} to the team! 🎉`,
        body: `Please join us in the <strong>Conference Room</strong>${when ? ` on <strong>${when}</strong>` : ''} to welcome ${row.name}${job ? `, our new ${job.title}` : ''}${dept ? ` in ${dept}` : ''}. Let's give them a warm start!`,
        pinned: false, audience: branch || 'all',
        authorId: req.hrActor.id, authorName: req.hrActor.name,
      });
      task.meta = { ...(task.meta || {}), announcementId: ann.id, meetingTime: timeStr, meetingDate: dateStr, place: 'Conference Room' };
      task.done = true; task.doneAt = nowIso; task.doneById = req.hrActor.id;
      pushTimeline(row, { type: 'onboarding', text: `Welcome-meeting announcement posted for ${dept || 'the team'} (${when || 'Conference Room'}).`, by: req.hrActor.name });
    } else if (b.action === 'welcome_aboard') {
      // Send the welcome-aboard email (candidate joined). Reminds them to bring
      // originals for verification.
      const s = await Settings.findOne({ where: { singleton: 'settings' } });
      const token = s && s.getKey ? s.getKey('hrMailboxToken') : null;
      const mailbox = mailboxEmail(s);
      if (!token || !mailbox) return res.status(400).json({ error: 'No recruitment mailbox is linked.' });
      const gmail = require('../services/gmail');
      const hrEmail = require('../services/hrEmailTemplate');
      const empName = (onb.fields && onb.fields.name) || row.name;
      const bodyHtml = hrEmail.welcomeJoinee({ employeeName: empName, designation: job ? job.title : '', department: job ? job.department : '', branch: (job && job.locations && job.locations[0]) || '' });
      const to = (onb.fields && onb.fields.email) || row.email;
      await sendHrEmailLogged(s, token, mailbox, { from: mailbox, to, subject: `Welcome to Qtonix, ${String(empName).split(' ')[0]}! 🎉`, bodyHtml }, { type: 'onboarding_welcome_aboard' });
      task.meta = { ...(task.meta || {}), sentAt: nowIso };
      task.done = true; task.doneAt = nowIso; task.doneById = req.hrActor.id;
      onb.welcomeAboardSentAt = nowIso;
      pushTimeline(row, { type: 'onboarding', text: `Welcome-aboard email sent to ${empName} by ${req.hrActor.name}.`, by: req.hrActor.name });
    } else if (b.action === 'notify_seniors') {
      // Manually send the "new joiner" notice to the department PM & Team Leads
      // now (instead of waiting for the automatic 2-days-before send).
      const s = await Settings.findOne({ where: { singleton: 'settings' } });
      const token = s && s.getKey ? s.getKey('hrMailboxToken') : null;
      const mailbox = mailboxEmail(s);
      if (!token || !mailbox) return res.status(400).json({ error: 'No recruitment mailbox is linked. Connect one in Admin → Email.' });
      const hrEmail = require('../services/hrEmailTemplate');
      const dept = String((job && job.department) || row.department || '').trim().toLowerCase();
      const active = await HrUser.findAll({ where: { active: true } });
      const sameDept = (u) => dept && String(u.department || '').trim().toLowerCase() === dept;
      // Strictly the joiner's OWN department: PMs (managers) + TLs in that dept.
      const seniors = active.filter((u) => u.email && (u.type === 'manager' || u.type === 'tl') && sameDept(u));
      if (!seniors.length) return res.status(400).json({ error: `No Project Manager or Team Lead found in the ${(job && job.department) || row.department || 'candidate\'s'} department to notify.` });
      // Keep HR & HR-managers in copy.
      const ccEmails = active.filter((u) => u.email && (['hr', 'recruiter'].includes(u.type) || u.isHrManager)).map((u) => u.email);
      const joiningDateText = row.offer && row.offer.joiningDate ? new Date(String(row.offer.joiningDate).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
      const sentTo = [];
      for (const mgr of seniors) {
        const bodyHtml = hrEmail.onboardingSeniorNotice({ managerName: mgr.name, candidateName: row.name, role: job ? job.title : '', department: (job && job.department) || row.department || '', joiningDateText, signature: null });
        try { await sendHrEmailLogged(s, token, mailbox, { from: mailbox, to: mgr.email, toName: mgr.name, cc: ccEmails, subject: `New joiner: ${row.name}${job ? ` (${job.title})` : ''}`, bodyHtml }, { type: 'onboarding_senior', userId: mgr.id }); sentTo.push({ name: mgr.name, email: mgr.email }); } catch {}
      }
      if (!sentTo.length) return res.status(502).json({ error: 'Could not send the notification. Please try again.' });
      onb.seniorNotifiedAt = nowIso;
      task.meta = { ...(task.meta || {}), autoSent: false, sentAt: nowIso, recipients: sentTo, sentBy: req.hrActor.name };
      task.done = true; task.doneAt = nowIso; task.doneById = req.hrActor.id;
      pushTimeline(row, { type: 'onboarding', text: `New-joiner notice sent to ${sentTo.map((r) => r.name).join(', ')} by ${req.hrActor.name}.`, by: req.hrActor.name });
    } else {
      // Plain toggle.
      task.done = b.done !== undefined ? !!b.done : !task.done;
      task.doneAt = task.done ? nowIso : null;
      task.doneById = task.done ? req.hrActor.id : null;
    }
    tasks[idx] = task;
    onb.hrTasks = tasks;
    row.onboarding = onb; row.changed('onboarding', true);
    await row.save();
    res.json({ ok: true, task });
  } catch (e) { next(e); }
});

// Draft a KPI & KRA email for a joiner using OpenAI. Returns HTML for HR/admin
// to review and edit before sending (does NOT send).
router.post('/candidates/:id/onboarding/kpi-draft', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    const b = req.body || {};
    const notesRaw = String(b.notes || '');
    const notesText = notesRaw.replace(/<br\s*\/?>(?=)/gi, '\n').replace(/<\/(p|div|li|ul|ol|h[1-6])>/gi, '\n').replace(/<li[^>]*>/gi, '• ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim();
    if (!notesText) return res.status(400).json({ error: 'Please enter the KRA & KPI details first.' });
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const key = s && s.getKey ? s.getKey('openai') : null;
    if (!key) return res.status(400).json({ error: 'OpenAI isn’t configured yet. Ask an admin to add the API key in CRM Admin → API keys.' });
    const job = row.jobPostId ? await HrJobPost.findByPk(row.jobPostId) : null;
    const empName = (row.onboarding && row.onboarding.fields && row.onboarding.fields.name) || row.name;
    const role = job ? job.title : (b.role || '');
    const dept = job ? job.department : '';
    const jobDesc = (job && (job.description || job.jd || '')) ? String(job.description || job.jd).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1500) : '';
    const system = [
      'You are an experienced HR business partner writing the KRA (Key Result Areas) and KPI (Key Performance Indicators) section of a welcome email for a new employee at Qtonix (a software & digital-marketing company).',
      'You are given: the role, the job description, and the HR team’s own KRA/KPI notes. Refine and structure the HR notes into a clear, polished, encouraging list for the employee’s first 3–6 months. Stay faithful to the HR notes — expand and clarify them, align them with the job description, but do not invent unrelated responsibilities.',
      'Output clean, EMAIL-SAFE HTML using INLINE styles only (no <style> blocks, no classes). Structure exactly:',
      '<p style="margin:0 0 14px;line-height:1.6;color:#334155;">[one short warm intro sentence]</p>',
      '<p style="margin:0 0 8px;font-weight:700;color:#0A0E28;">Key Result Areas</p>',
      '<ul style="margin:0 0 16px;padding-left:20px;color:#334155;line-height:1.7;"><li style="margin:0 0 6px;">…</li>…</ul>',
      '<p style="margin:0 0 8px;font-weight:700;color:#0A0E28;">Key Performance Indicators</p>',
      '<ul style="margin:0 0 4px;padding-left:20px;color:#334155;line-height:1.7;"><li style="margin:0 0 6px;">…</li>…</ul>',
      'Each list should have 3–6 items. No <html>/<body> wrapper, no email signature, no headings other than the two shown.',
      'Return strict JSON: {"body":"<p>...</p>..."}. No markdown, no commentary outside the JSON.',
    ].join('\n');
    const ctx = `Employee: ${empName}\nRole: ${role || 'the role'}\nDepartment: ${dept || 'n/a'}\n\nJob description:\n${jobDesc || '(not provided)'}\n\nHR's KRA & KPI notes (use these as the basis):\n${notesText}`;
    try { const { recordApiCall } = require('../models'); recordApiCall && recordApiCall('openai'); } catch {}
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: system }, { role: 'user', content: ctx }], max_tokens: 1100, response_format: { type: 'json_object' } }),
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(502).json({ error: (data.error && data.error.message) || 'OpenAI request failed.' });
    let parsed = {}; try { parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}'); } catch { parsed = {}; }
    let body = String(parsed.body || '').trim();
    // Safety net: if the model returned plain text, wrap into styled paragraphs.
    if (body && !/<(p|ul|ol|div)[\s>]/i.test(body)) {
      body = `<p style="margin:0 0 14px;line-height:1.6;color:#334155;">${body.replace(/\n{2,}/g, '</p><p style="margin:0 0 14px;line-height:1.6;color:#334155;">').replace(/\n/g, '<br>')}</p>`;
    }
    res.json({ body, employeeName: empName, role });
  } catch (e) { next(e); }
});

// Send the (HR-reviewed) KPI & KRA email to the joiner.
router.post('/candidates/:id/onboarding/kpi-send', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrCandidate.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Candidate not found.' });
    const b = req.body || {};
    if (!b.body || !String(b.body).trim()) return res.status(400).json({ error: 'Nothing to send — draft the KPI/KRA first.' });
    const onb = row.onboarding || {};
    const to = (onb.fields && onb.fields.email) || row.email;
    if (!to) return res.status(400).json({ error: 'No email on file for this employee.' });
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const token = s && s.getKey ? s.getKey('hrMailboxToken') : null;
    const mailbox = mailboxEmail(s);
    if (!token || !mailbox) return res.status(400).json({ error: 'No HR mailbox is linked.' });
    const job = row.jobPostId ? await HrJobPost.findByPk(row.jobPostId) : null;
    const empName = (onb.fields && onb.fields.name) || row.name;
    const gmail = require('../services/gmail');
    const hrEmail = require('../services/hrEmailTemplate');
    const bodyHtml = hrEmail.onboardingKpiKra({ employeeName: empName, role: job ? job.title : '', bodyHtml: String(b.body) });
    await sendHrEmailLogged(s, token, mailbox, { from: mailbox, to, subject: `Your KPIs & KRAs at Qtonix, ${String(empName).split(' ')[0]}`, bodyHtml }, { type: 'onboarding_kpi_kra' });
    // mark the kpi_kra task done
    if (Array.isArray(onb.hrTasks)) {
      onb.hrTasks = onb.hrTasks.map((t) => (t.id === 'kpi_kra' ? { ...t, done: true, doneAt: new Date().toISOString(), doneById: req.hrActor.id } : t));
      row.onboarding = onb; row.changed('onboarding', true);
    }
    pushTimeline(row, { type: 'onboarding', text: `KPI & KRA email sent to ${empName} by ${req.hrActor.name}.`, by: req.hrActor.name });
    await row.save();
    res.json({ ok: true });
  } catch (e) { next(e); }
});


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

// Remove the signed-in employee's profile photo.
router.delete('/profile-me/avatar', requireHrAccess, async (req, res, next) => {
  try {
    if (req.hrActor.kind === 'hr' && req.hrUser) { req.hrUser.avatar = null; await req.hrUser.save(); }
    res.json({ ok: true, avatar: '' });
  } catch (e) { next(e); }
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
// Resolve the current actor's notification scope: HR staff use their HrUser.id;
// admins use their CRM User.id under the 'admin' namespace.
function notifScope(req) {
  if (req.hrActor && req.hrActor.kind === 'admin') return { userId: req.hrActor.id, actorKind: 'admin' };
  if (req.hrUser) return { userId: req.hrUser.id, actorKind: 'hr' };
  return null;
}

router.get('/notifications', requireHrAccess, async (req, res, next) => {
  try {
    const scope = notifScope(req);
    if (!scope) return res.json({ notifications: [], unread: 0 });
    const rows = await HrNotification.findAll({ where: scope, order: [['createdAt', 'DESC']], limit: 50 });
    const unread = await HrNotification.count({ where: { ...scope, read: false } });
    res.json({ notifications: rows.map((r) => r.toJSON()), unread });
  } catch (e) { next(e); }
});
router.post('/notifications/read', requireHrAccess, async (req, res, next) => {
  try {
    const scope = notifScope(req);
    if (!scope) return res.json({ ok: true });
    const ids = Array.isArray(req.body.ids) ? req.body.ids : null;
    const where = { ...scope };
    if (ids) where.id = ids;
    await HrNotification.update({ read: true }, { where });
    res.json({ ok: true });
  } catch (e) { next(e); }
});
// Delete a single notification (persists — won't reappear on refresh).
router.delete('/notifications/:id', requireHrAccess, async (req, res, next) => {
  try {
    const scope = notifScope(req);
    if (!scope) return res.json({ ok: true });
    await HrNotification.destroy({ where: { ...scope, id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});
// Clear all of my notifications.
router.post('/notifications/clear', requireHrAccess, async (req, res, next) => {
  try {
    const scope = notifScope(req);
    if (!scope) return res.json({ ok: true });
    await HrNotification.destroy({ where: scope });
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
      // Daily target measures candidates this HR added today (each added candidate
      // = an interview lined up). Monthly target measures onboarded/accepted hires.
      let addedToday = 0;
      let onboardedThisMonth = 0;
      cands.forEach((c) => {
        const minesCand = c.recruiterId === u.id || c.recruiterName === u.name;
        if (minesCand && c.createdAt && new Date(c.createdAt).getTime() >= startOfDay) addedToday += 1;
        // Onboarded = hired (accepted offer OR moved to a hired stage), credited
        // to the recruiter, this month.
        if (minesCand && isHiredCandidate(c)) {
          const doneAt = (c.offer && c.offer.offerLetter && c.offer.offerLetter.sentAt) || c.updatedAt;
          if (doneAt && new Date(doneAt).getTime() >= startOfMonth) onboardedThisMonth += 1;
        }
      });
      const t = u.targets || {};
      return {
        id: u.id, name: u.name, avatar: u.avatar || null, designation: u.designation || '',
        dailyTarget: Number(t.dailyInterviews) || 0, dailyDone: addedToday,
        monthlyTarget: Number(t.monthlyOnboarding) || 0, monthlyDone: onboardedThisMonth,
      };
    });
    res.json({ rows });
  } catch (e) { next(e); }
});

router.get('/dashboard-stats', requireHrAccess, async (req, res, next) => {
  try {
    const jobs = await HrJobPost.findAll();
    // Open positions = ACTIVE (published) out of the TOTAL of all real listings
    // (published + paused + draft + closed). Drafts count toward total; only
    // published are "active/open".
    const totalJobs = jobs.length;
    const activeJobs = jobs.filter((j) => j.status === 'published').length;
    const openJobs = activeJobs; // kept for back-compat (numeric)

    const cands = await HrCandidate.findAll();
    const now = Date.now();
    const weekAgo = now - 7 * 864e5;

    // Total applications = every candidate/application on the platform.
    const totalApplications = cands.length;

    // Applications this week = added to the platform in the last 7 days.
    const applicationsThisWeek = cands.filter((c) => c.createdAt && new Date(c.createdAt).getTime() >= weekAgo).length;

    // Classification helpers.
    const REJECTED_STAGES = new Set(['rejected', 'reject', 'declined', 'disqualified']);
    const isRejected = (c) => !!c.rejected || REJECTED_STAGES.has(String(c.stage || '').toLowerCase());
    const isHired = (c) => isHiredCandidate(c);
    const isCold = (c) => !!c.cold;

    // Active candidates = in an active stage, EXCLUDING hired, rejected and cold.
    const activeCandidates = cands.filter((c) => !isHired(c) && !isRejected(c) && !isCold(c)).length;

    // Candidates per stage (active only) for the funnel.
    const byStage = {};
    cands.forEach((c) => { if (!isHired(c) && !isRejected(c) && !isCold(c)) byStage[c.stage] = (byStage[c.stage] || 0) + 1; });

    // Avg time-to-hire: days from application (createdAt) → when they became
    // hired. Prefer the timeline entry that moved them to a hired stage; fall
    // back to the offer's accepted/joining date; then offer letter sent date.
    const hireDays = [];
    cands.forEach((c) => {
      if (!isHired(c) || !c.createdAt) return;
      const created = new Date(c.createdAt).getTime();
      let hiredAt = null;
      // 1) timeline move into a hired stage
      const tl = Array.isArray(c.timeline) ? c.timeline : [];
      for (const ev of tl) {
        const txt = String((ev && ev.text) || '').toLowerCase();
        if (/\b(hired|onboarded|joined|selected)\b/.test(txt) && ev.at) { hiredAt = new Date(ev.at).getTime(); break; }
      }
      // 2) offer joining/accepted date
      if (!hiredAt && c.offer) {
        if (c.offer.joiningDate) hiredAt = new Date(c.offer.joiningDate).getTime();
        else if (c.offer.offerLetter && c.offer.offerLetter.sentAt) hiredAt = new Date(c.offer.offerLetter.sentAt).getTime();
      }
      if (hiredAt && hiredAt >= created) hireDays.push(Math.round((hiredAt - created) / 864e5));
    });
    const avgTimeToHire = hireDays.length ? Math.round(hireDays.reduce((a, b) => a + b, 0) / hireDays.length) : null;

    const hired = cands.filter(isHired).length;
    res.json({
      // Open positions as a fraction (active / total).
      openJobs, activeJobs, totalJobs,
      totalApplications,
      totalActive: activeCandidates,
      applicationsThisWeek,
      avgTimeToHire,
      byStage, hired, totalCandidates: cands.length,
    });
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
      if (isHiredCandidate(c)) bump(src, 'hired');
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
    const pu = require('../services/publicUrl');
    const careersBase = await pu.baseFor('careers', req);
    // CRM location for the "back to CRM" link. Prefer a configured CRM domain,
    // else the raw request host (the Railway URL) — never the HRMS domain, which
    // would just bounce back into the HR portal.
    const domains = await pu.loadDomains();
    const crmBase = pu.normalizeOrigin(domains.crm) || pu.envOrigin() || '';
    res.json({ autoScore: s.hrAutoScore !== false, careers: s.hrCareers || {}, careersDomain: careersBase, crmDomain: crmBase });
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
    // If careers branding changed, refresh the careers AI meta + rebuild the OG
    // image with the (possibly new) logo. Best-effort, non-blocking on failure.
    if (b.careers && typeof b.careers === 'object') {
      try {
        const jobMeta = require('../services/jobMeta');
        const key = s.getKey ? s.getKey('openai') : null;
        const jobs = await HrJobPost.findAll({ where: { status: 'published' }, order: [['createdAt', 'DESC']], limit: 30 });
        const meta = await jobMeta.generateCareersMeta(jobs, s.hrCareers, key);
        const cur = s.hrCareers || {};
        s.hrCareers = { ...cur, ogTitle: meta.title, ogDescription: meta.description };
        s.changed('hrCareers', true);
        await s.save();
        // Rebuild the branded share image with the current logo.
        if (b.careers.logo !== undefined) await jobMeta.buildOgImage(s.hrCareers.logo || '');
      } catch (e) { console.error('[settings] careers meta gen failed:', e.message); }
    }
    hrLog(req, 'settings.update', b.careers ? 'careers page' : (b.autoScore !== undefined ? `auto-score ${b.autoScore ? 'on' : 'off'}` : 'settings'));
    res.json({ autoScore: s.hrAutoScore !== false, careers: s.hrCareers || {} });
  } catch (e) { next(e); }
});

// ---- Send test emails (admin) — verify all recruitment email designs render
// ---- HR email catalog (Admin → Emails tab) ---------------------------------
// Mirrors the Sales-CRM email catalog: one table of every recruitment email,
// who it goes to, which mailbox it sends from, a preview, and recent activity.
// HR emails all send from the linked recruitment mailbox (career@qtonix.com).
const HR_EMAIL_CATALOG = [
  { id: 'application_thankyou', name: 'Application thank-you', description: 'Sent to a candidate right after they apply, confirming we received it.', sentTo: 'The applicant', subjectMatch: ['received your application', 'thank you for applying'] },
  { id: 'application_internal', name: 'New application (internal)', description: 'Internal notice to the recruitment team when a new application arrives.', sentTo: 'Recruitment team', subjectMatch: ['new application'] },
  { id: 'shortlisted', name: 'Shortlisted', description: 'Sent when a candidate is moved past the Contacted stage — they’ve been shortlisted for interview.', sentTo: 'The candidate', subjectMatch: ["you've been shortlisted", 'been shortlisted', 'shortlisted'] },
  { id: 'interview_candidate', name: 'Interview invite (candidate)', description: 'Interview invitation sent to the candidate with the schedule + meeting link.', sentTo: 'The candidate', subjectMatch: ['interview invitation', 'interview invite'] },
  { id: 'interview_panel', name: 'Interview invite (panel)', description: 'Interview details sent to the internal panellists / interviewers.', sentTo: 'Interview panellists', subjectMatch: ['interview panel'] },
  { id: 'interview_reschedule', name: 'Interview reschedule', description: 'Sent when an interview is rescheduled, to the candidate (and panel).', sentTo: 'Candidate & panel', subjectMatch: ['interview rescheduled'] },
  { id: 'assessment_task', name: 'Assessment task', description: 'Sends an assessment/assignment task to a candidate with a deadline + upload link.', sentTo: 'The candidate', subjectMatch: ['assessment task'] },
  { id: 'task_updated', name: 'Assessment task — updated', description: 'Correction email when a task’s details are edited: asks the candidate to ignore the previous email and use the updated details (same upload link).', sentTo: 'The candidate', subjectMatch: ['updated assessment task', 'updated task details'] },
  { id: 'task_received', name: 'Task received', description: 'Confirms to the candidate that their submitted task was received.', sentTo: 'The candidate', subjectMatch: ['task received', 'we received your submission', 'submission received'] },
  { id: 'task_additional_info', name: 'Task — more info requested', description: 'Asks a candidate for additional information / a revised task submission.', sentTo: 'The candidate', subjectMatch: ['additional information', 'more information'] },
  { id: 'rejection', name: 'Rejection', description: 'Sent to a candidate when their application is not moving forward.', sentTo: 'The candidate', subjectMatch: ['update on your application', 'regarding your application'] },
  { id: 'offer', name: 'Offer', description: 'Sends the offer email (with attachments) to a selected candidate.', sentTo: 'The candidate', subjectMatch: ['regarding your offer', 'your offer', 'offer of employment'] },
  // Employee celebration emails — founder-signed, auto-sent from adam@qtonix.com.
  // Their activity comes from CrmEmailLog (employee recipients, not candidates).
  { id: 'celebration_birthday', name: 'Birthday wish', description: 'Auto-sent to an employee on their birthday, signed by the Founder.', sentTo: 'The employee', source: 'celebration', logType: 'hr_birthday' },
  { id: 'celebration_anniversary', name: 'Work anniversary', description: 'Auto-sent to an employee on their work anniversary (1+ years), signed by the Founder.', sentTo: 'The employee', source: 'celebration', logType: 'hr_anniversary' },
  { id: 'celebration_welcome', name: 'Welcome (new joinee)', description: 'Auto-sent to a new employee on their joining day, signed by the Founder.', sentTo: 'The employee', source: 'celebration', logType: 'hr_welcome' },
];

function hrPreviewHtml(id, sig, mailbox) {
  const hrEmail = require('../services/hrEmailTemplate');
  const role = 'Senior Frontend Engineer';
  const when = 'Tuesday, 26 August 2026, 5:30 PM IST';
  const base = (process.env.APP_URL || '').replace(/\/$/, '');
  const rejectBody = '<p style="margin:0 0 14px;line-height:1.6;">Dear Ava,</p><p style="margin:0 0 14px;line-height:1.6;">Thank you for taking the time to apply and for sharing your background with us.</p><p style="margin:0 0 14px;line-height:1.6;">After careful consideration, we have decided to move forward with other candidates. We wish you the very best.</p>';
  const recruitSig = { name: 'Qtonix Recruitment Team', title: 'Talent Acquisition · Qtonix', email: mailbox };
  switch (id) {
    case 'application_thankyou': return hrEmail.applicationThankYou({ candidateName: 'Ava Thompson', role, signature: recruitSig });
    case 'application_internal': return hrEmail.applicationInternalNotice({ candidateName: 'Ava Thompson', role, candidateEmail: 'ava@example.com', candidatePhone: '+91 98765 43210', jobLocation: 'Bhubaneswar', source: 'Careers page', viewUrl: `${base}/hr/recruitment` });
    case 'shortlisted': return hrEmail.shortlistedEmail({ candidateName: 'Ava Thompson', role, signature: sig });
    case 'interview_candidate': return hrEmail.interviewInviteCandidate({ candidateName: 'Ava Thompson', role, roundLabel: 'Technical Round', whenText: when, durationMins: 30, mode: 'online', meetLink: 'https://meet.google.com/abc-defg-hij', notes: '', signature: sig });
    case 'interview_panel': return hrEmail.interviewInvitePanel({ panelistName: 'Rahul Verma', candidateName: 'Ava Thompson', role, roundLabel: 'Technical Round', whenText: when, durationMins: 30, mode: 'online', meetLink: 'https://meet.google.com/abc-defg-hij', notes: '', signature: sig });
    case 'interview_reschedule': return hrEmail.interviewReschedule({ recipientName: 'Ava Thompson', isPanel: false, candidateName: 'Ava Thompson', role, roundLabel: 'Technical Round', whenText: 'Thursday, 28 August 2026, 3:00 PM IST', durationMins: 30, mode: 'online', meetLink: 'https://meet.google.com/abc-defg-hij', notes: '', signature: sig });
    case 'assessment_task': return hrEmail.taskAssignment({ candidateName: 'Ava Thompson', role, taskTitle: 'Build a responsive dashboard component', taskDetailsHtml: 'Build a small React dashboard with a chart and a filterable table. Include a short README.', deadlineText: 'Sunday, 24 August 2026, 5:30 PM IST', uploadUrl: `${base}/task/sample-token`, signature: sig });
    case 'task_updated': return hrEmail.taskUpdated({ candidateName: 'Ava Thompson', role, taskTitle: 'Build a responsive dashboard component', taskDetailsHtml: 'Build a small React dashboard with a chart and a filterable table. Include a short README. (Updated: please use the new design tokens shared in the brief.)', deadlineText: 'Sunday, 24 August 2026, 5:30 PM IST', uploadUrl: `${base}/task/sample-token`, signature: sig });
    case 'task_received': return hrEmail.taskReceived({ candidateName: 'Ava Thompson', role, isAdditional: false, signature: sig });
    case 'task_additional_info': return hrEmail.taskAdditionalInfoRequest({ candidateName: 'Ava Thompson', role, messageHtml: 'Could you please share the source repository link and a short note on your approach?', deadlineText: 'Friday, 29 August 2026, 5:30 PM IST', uploadUrl: `${base}/task/sample-token`, signature: sig });
    case 'rejection': return hrEmail.rejectionEmail({ role, bodyHtml: rejectBody, signature: sig });
    case 'offer': return hrEmail.shell({ kicker: 'Offer', heroIcon: '\uD83C\uDF89', headline: 'We\u2019d love for you to join us', subhead: role, greetingName: 'Ava', introHtml: 'We\u2019re delighted to offer you the role of <strong>' + role + '</strong> at Qtonix. Your offer letter is attached with the details of compensation, start date, and next steps.', outroHtml: 'Please review the attached letter and reply with any questions. We\u2019re excited to have you on board!', signature: sig });
    case 'celebration_birthday': return hrEmail.birthdayWish({ employeeName: 'Ravi Kumar' });
    case 'celebration_anniversary': return hrEmail.workAnniversary({ employeeName: 'Meena Patel', years: 3, joinedText: '12 August 2023', department: 'Engineering', branch: 'Bhubaneswar' });
    case 'celebration_welcome': return hrEmail.welcomeJoinee({ employeeName: 'Arjun Das', designation: 'Software Engineer', department: 'Engineering', branch: 'Bhubaneswar' });
    default: return null;
  }
}

router.get('/email-catalog', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const mailbox = mailboxEmail(s);
    const token = s && s.getKey ? s.getKey('hrMailboxToken') : null;
    // Recent outbound HR emails power the "last activity" column (matched by subject).
    let outbound = [];
    try { outbound = await HrEmail.findAll({ where: { direction: 'outbound' }, order: [['sentAt', 'DESC']], limit: 800 }); } catch { outbound = []; }
    const matchRows = (subjectMatch) => outbound.filter((e) => { const sub = String(e.subject || '').toLowerCase(); return subjectMatch.some((m) => sub.includes(m)); });
    // Celebration emails log to CrmEmailLog (employee recipients), keyed by type.
    let celLogs = [];
    try { celLogs = await CrmEmailLog.findAll({ where: { type: ['hr_birthday', 'hr_anniversary', 'hr_welcome'], status: 'sent' }, order: [['sentAt', 'DESC']], limit: 2000 }); } catch { celLogs = []; }
    const celByType = (t) => celLogs.filter((r) => r.type === t);
    const emails = HR_EMAIL_CATALOG.map((e) => {
      if (e.source === 'celebration') {
        const acts = celByType(e.logType);
        return { id: e.id, name: e.name, description: e.description, sentTo: e.sentTo, sentFrom: 'adam@qtonix.com', editableSender: false, lastSentAt: acts.length ? acts[0].sentAt : null, totalSent: acts.length, auto: true };
      }
      const acts = matchRows(e.subjectMatch);
      return { id: e.id, name: e.name, description: e.description, sentTo: e.sentTo, sentFrom: mailbox || '(recruitment mailbox not linked)', editableSender: false, lastSentAt: acts.length ? acts[0].sentAt : null, totalSent: acts.length };
    });
    res.json({ emails, mailbox, connected: !!(mailbox && token) });
  } catch (e) { next(e); }
});

router.get('/email-catalog/:id/activity', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const meta = HR_EMAIL_CATALOG.find((e) => e.id === req.params.id);
    if (!meta) return res.status(404).json({ error: 'Unknown email.' });
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(50, Math.max(5, parseInt(req.query.pageSize, 10) || 15));

    // Celebration emails: activity comes from CrmEmailLog (employee recipients).
    if (meta.source === 'celebration') {
      let logs = [];
      try { logs = await CrmEmailLog.findAll({ where: { type: meta.logType }, order: [['sentAt', 'DESC']], limit: 2000 }); } catch { logs = []; }
      const total = logs.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const start = (page - 1) * pageSize;
      const rows = logs.slice(start, start + pageSize);
      // Backfill missing names from HrUser where we have userId.
      const needIds = [...new Set(rows.filter((r) => !r.toName && r.userId).map((r) => r.userId))];
      const users = needIds.length ? await HrUser.findAll({ where: { id: needIds } }) : [];
      const nameOf = Object.fromEntries(users.map((u) => [u.id, u.name]));
      return res.json({
        activity: rows.map((r) => ({
          toEmail: r.toEmail || '', toName: r.toName || nameOf[r.userId] || '',
          candidateId: null, employeeId: r.userId || null,
          sentAt: r.sentAt, status: r.status || 'sent', subject: r.subject || '',
        })),
        page, pageSize, total, totalPages,
      });
    }

    let outbound = [];
    try { outbound = await HrEmail.findAll({ where: { direction: 'outbound' }, order: [['sentAt', 'DESC']], limit: 2000 }); } catch { outbound = []; }
    const all = outbound.filter((e) => { const sub = String(e.subject || '').toLowerCase(); return meta.subjectMatch.some((m) => sub.includes(m)); });
    const total = all.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    const rows = all.slice(start, start + pageSize);
    const candIds = [...new Set(rows.map((r) => r.candidateId).filter(Boolean))];
    const cands = candIds.length ? await HrCandidate.findAll({ where: { id: candIds } }) : [];
    const nameOf = Object.fromEntries(cands.map((c) => [c.id, c.name]));
    res.json({
      activity: rows.map((r) => ({
        toEmail: (r.toEmail || '').split(',')[0].trim(),
        toName: nameOf[r.candidateId] || '',
        candidateId: r.candidateId || null,
        sentAt: r.sentAt, status: 'sent', subject: r.subject || '',
      })),
      page, pageSize, total, totalPages,
    });
  } catch (e) { next(e); }
});

router.get('/email-catalog/:id/preview', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const meta = HR_EMAIL_CATALOG.find((e) => e.id === req.params.id);
    if (!meta) return res.status(404).send('Unknown email.');
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const mailbox = mailboxEmail(s) || 'career@qtonix.com';
    const sig = { name: 'Qtonix Recruitment Team', title: 'Talent Acquisition · Qtonix', email: mailbox };
    const html = hrPreviewHtml(req.params.id, sig, mailbox);
    if (!html) return res.status(404).send('No preview available.');
    res.set('Content-Type', 'text/html').send(html);
  } catch (e) { next(e); }
});

// correctly in a real inbox. Sends one of each designed template with sample
// data to the given address.
router.post('/settings/test-emails', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const to = String((req.body || {}).email || '').trim();
    if (!to || !/^[^@]+@[^@]+\.[^@]+$/.test(to)) return res.status(400).json({ error: 'Enter a valid email address to send the test emails to.' });
    const gmail = require('../services/gmail');
    const hrEmail = require('../services/hrEmailTemplate');
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const token = s && s.getKey ? s.getKey('hrMailboxToken') : null;
    const mailbox = mailboxEmail(s);
    if (!token || !mailbox) return res.status(400).json({ error: 'Link the recruitment mailbox first — test emails send from it.' });

    const sig = { name: req.hrActor.name || 'Qtonix Recruitment Team', title: 'Talent Acquisition · Qtonix', email: mailbox };
    const role = 'Senior Frontend Engineer';
    const when = 'Tuesday, 26 August 2026, 5:30 PM IST';
    const rejectBody = '<p style="margin:0 0 14px;line-height:1.6;">Dear Ava,</p><p style="margin:0 0 14px;line-height:1.6;">Thank you for taking the time to apply and for sharing your background with us.</p><p style="margin:0 0 14px;line-height:1.6;">After careful consideration, we have decided to move forward with other candidates. We wish you the very best.</p>';
    // Each: [label, subject, html]
    const samples = [
      ['Interview invite (candidate)', `Interview invitation — ${role}`, hrEmail.interviewInviteCandidate({ candidateName: 'Ava Thompson', role, roundLabel: 'Technical Round', whenText: when, durationMins: 30, mode: 'online', meetLink: 'https://meet.google.com/abc-defg-hij', notes: '', signature: sig })],
      ['Interview invite (panel)', `Interview panel — ${role} (Ava Thompson)`, hrEmail.interviewInvitePanel({ panelistName: 'Rahul Verma', candidateName: 'Ava Thompson', role, roundLabel: 'Technical Round', whenText: when, durationMins: 30, mode: 'online', meetLink: 'https://meet.google.com/abc-defg-hij', notes: '', signature: sig })],
      ['Interview reschedule', `Interview rescheduled — ${role}`, hrEmail.interviewReschedule({ recipientName: 'Ava Thompson', isPanel: false, candidateName: 'Ava Thompson', role, roundLabel: 'Technical Round', whenText: 'Thursday, 28 August 2026, 3:00 PM IST', durationMins: 30, mode: 'online', meetLink: 'https://meet.google.com/abc-defg-hij', notes: '', signature: sig })],
      ['Application thank-you', `We received your application — ${role}`, hrEmail.applicationThankYou({ candidateName: 'Ava Thompson', role, signature: { name: 'Qtonix Recruitment Team', title: 'Talent Acquisition · Qtonix', email: mailbox } })],
      ['New application (internal)', `New application — ${role} (Ava Thompson)`, hrEmail.applicationInternalNotice({ candidateName: 'Ava Thompson', role, candidateEmail: 'ava@example.com', candidatePhone: '+91 98765 43210', jobLocation: 'Bhubaneswar', source: 'Careers page', viewUrl: `${(process.env.APP_URL || '').replace(/\/$/, '')}/hr/recruitment` })],
      ['Shortlisted', `You've been shortlisted — ${role}`, hrEmail.shortlistedEmail({ candidateName: 'Ava Thompson', role, signature: sig })],
      ['Assessment task', `Assessment task — ${role}`, hrEmail.taskAssignment({ candidateName: 'Ava Thompson', role, taskTitle: 'Build a responsive dashboard component', taskDetailsHtml: 'Build a small React dashboard with a chart and a filterable table. Include a short README.', deadlineText: 'Sunday, 24 August 2026, 5:30 PM IST', uploadUrl: `${(process.env.APP_URL || '').replace(/\/$/, '')}/task/sample-token`, signature: sig })],
      ['Rejection', `Update on your application — ${role}`, hrEmail.rejectionEmail({ role, bodyHtml: rejectBody, signature: sig })],
      ['Onboarding welcome', `Welcome to Qtonix, Ava! – Next Steps`, hrEmail.onboardingWelcome({ candidateName: 'Ava Thompson', role, joiningDateText: 'Monday, 8 September 2026', department: 'Engineering', deadlineText: 'Friday, 5 September 2026', onboardingUrl: `${(process.env.APP_URL || '').replace(/\/$/, '')}/onboarding/sample-token`, signature: sig })],
      ['Onboarding reminder', `Reminder: complete your Qtonix onboarding`, hrEmail.onboardingReminder({ candidateName: 'Ava Thompson', role, deadlineText: 'Friday, 5 September 2026', onboardingUrl: `${(process.env.APP_URL || '').replace(/\/$/, '')}/onboarding/sample-token`, signature: sig })],
      ['Onboarding — documents received', `We received your onboarding documents — Qtonix`, hrEmail.onboardingReceived({ candidateName: 'Ava Thompson' })],
      ['New joiner notice (PM & TLs)', `New joiner: Ava Thompson (${role})`, hrEmail.onboardingSeniorNotice({ managerName: 'Rahul Verma', candidateName: 'Ava Thompson', role, department: 'Engineering', joiningDateText: 'Monday, 8 September 2026', signature: sig })],
      ['Reporting details', `Your first day at Qtonix — reporting details`, hrEmail.onboardingReportingDetails({ candidateName: 'Ava Thompson', role, joiningDateText: 'Monday, 8 September 2026', reportingTime: '09:30 AM', officeAddress: 'Plot 12, Info City, Bhubaneswar 751024', contactPerson: 'Anshika Priyadarshini', contactPhone: '+91 90400 06123', signature: sig })],
      ['Welcome aboard (joined)', `Welcome to Qtonix, Ava! 🎉`, hrEmail.welcomeJoinee({ employeeName: 'Ava Thompson', designation: role, department: 'Engineering', branch: 'Bhubaneswar' })],
      ['KPI & KRA', `Your KPIs & KRAs at Qtonix, Ava`, hrEmail.onboardingKpiKra({ employeeName: 'Ava Thompson', role, bodyHtml: '<p style="margin:0 0 14px;line-height:1.6;">We\u2019re excited to have you! Here are your focus areas for the first few months.</p><p style="margin:0 0 8px;"><strong>Key Result Areas</strong></p><ul><li>Deliver assigned frontend features on schedule</li><li>Maintain code quality and reviews</li><li>Collaborate with design & backend</li></ul><p style="margin:12px 0 8px;"><strong>Key Performance Indicators</strong></p><ul><li>90%+ sprint commitments met</li><li>&lt;2 post-release defects per feature</li><li>Positive peer-review feedback</li></ul>', signature: sig })],
      ['Onboarding question reply', `Response to your onboarding question — Qtonix`, hrEmail.onboardingQueryReply({ candidateName: 'Ava Thompson', question: 'What documents should I bring on my first day?', answer: 'Please bring your original PAN, Aadhaar, and degree certificates. Photocopies will be collected at the office.', hrName: 'Anshika Priyadarshini' })],
    ];
    const sentList = [], failed = [];
    for (const [label, subject, html] of samples) {
      try { await gmail.sendMessage(s, token, mailbox, { from: mailbox, to, subject: `[TEST] ${subject}`, bodyHtml: html }); sentList.push(label); }
      catch (e) { console.error('[test-email]', label, 'failed:', e.message); failed.push(label); }
    }
    hrLog(req, 'settings.test-emails', `to ${to} — ${sentList.length} sent`);
    res.json({ ok: true, to, sent: sentList, failed, count: sentList.length });
  } catch (e) { next(e); }
});

// ---- HR leave / attendance policy (Admin only) ----
const DEFAULT_HR_POLICY = {
  categories: [{ id: 'default', name: 'Default', allocation: { casual: 12, medical: 12, privilege: 12, wfh: 24 } }],
  leaveRules: {
    casual: { sandwichBlock: true },
    medical: { requireDocument: true, sandwichBlock: false },
    privilege: { noticeDays: 7 },
    wfh: {},
  },
  lateRule: { graceMinutes: 30, consecutiveForHalfDay: 3, monthlyForHalfDay: 6, shiftHours: 9 },
  weekOff: { byBranch: {}, default: { type: 'all_sundays' } },
};
function getHrPolicy(s) {
  const p = (s && s.hrPolicy) || {};
  return {
    categories: Array.isArray(p.categories) && p.categories.length ? p.categories : DEFAULT_HR_POLICY.categories,
    leaveRules: { ...DEFAULT_HR_POLICY.leaveRules, ...(p.leaveRules || {}) },
    lateRule: { ...DEFAULT_HR_POLICY.lateRule, ...(p.lateRule || {}) },
    weekOff: { byBranch: (p.weekOff && p.weekOff.byBranch) || {}, default: (p.weekOff && p.weekOff.default) || DEFAULT_HR_POLICY.weekOff.default },
  };
}
// Resolve a branch's week-off rule → is a given date a week-off?
function isWeekOff(policy, branch, dateStr) {
  const rule = (policy.weekOff.byBranch && policy.weekOff.byBranch[branch]) || policy.weekOff.default || { type: 'all_sundays' };
  const d = new Date(dateStr + 'T00:00:00');
  const dow = d.getDay(); // 0 Sun … 6 Sat
  const nthWeek = Math.ceil(d.getDate() / 7); // 1st..5th occurrence of that weekday
  if (rule.type === 'all_sundays') return dow === 0;
  if (rule.type === 'sat_sun') return dow === 0 || dow === 6;
  if (rule.type === 'alt_sat_sun') return dow === 0 || (dow === 6 && (nthWeek === 2 || nthWeek === 4));
  if (rule.type === 'custom' && Array.isArray(rule.days)) return rule.days.includes(dow);
  return dow === 0;
}
// Resolve the allocation for an employee (category on profile overrides).
function allocationFor(policy, emp) {
  const catId = (emp.profile && emp.profile.leaveCategory) || 'default';
  const cat = policy.categories.find((c) => c.id === catId) || policy.categories[0];
  return { ...DEFAULT_LEAVE_ALLOCATION, ...((cat && cat.allocation) || {}), ...((emp.profile && emp.profile.leaveAllocation) || {}) };
}

router.get('/policy', requireHrAccess, async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    res.json({ policy: getHrPolicy(s), canManage: req.isHrAdmin });
  } catch (e) { next(e); }
});
router.put('/policy', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const cur = getHrPolicy(s);
    const b = req.body || {};
    const next2 = {
      categories: Array.isArray(b.categories) ? b.categories : cur.categories,
      leaveRules: { ...cur.leaveRules, ...(b.leaveRules || {}) },
      lateRule: { ...cur.lateRule, ...(b.lateRule || {}) },
      weekOff: b.weekOff ? { byBranch: b.weekOff.byBranch || {}, default: b.weekOff.default || cur.weekOff.default } : cur.weekOff,
    };
    s.hrPolicy = next2; s.changed('hrPolicy', true);
    await s.save();
    hrLog(req, 'policy.update', 'leave/attendance policy');
    res.json({ policy: getHrPolicy(s) });
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
// Candidates who are hired-in-stage OR flagged for hire but whose offer isn't
// completed yet — surfaced to the responsible HR (admin sees all) so they finish
// the offer process. This is the "already moved" catch-up list.
router.get('/pending-offers', requireHrAccess, async (req, res, next) => {
  try {
    const isAdmin = !!req.isHrAdmin;
    const meId = req.hrActor.id;
    const meName = req.hrActor.name;
    const rows = await HrCandidate.findAll({ where: { rejected: false } });
    const jobCache = {};
    const jobFor = async (id) => { if (!id) return null; if (!(id in jobCache)) jobCache[id] = await HrJobPost.findByPk(id); return jobCache[id]; };
    const items = [];
    for (const c of rows) {
      const offerDone = c.offer && c.offer.status === 'accepted';
      if (offerDone) continue; // offer already complete — nothing to do
      const stageL = String(c.stage || '').toLowerCase();
      const inHiredStage = HIRED_STAGE_IDS.has(stageL);
      const job = await jobFor(c.jobPostId);
      const inOfferStage = (job && job.stages || []).some((s) => ['offered', 'offer'].includes(String(s.id).toLowerCase()) && s.id === c.stage);
      // Show any candidate sitting in an Offer or Hired stage whose offer isn't
      // accepted yet. Being in that stage is the signal — we don't require the
      // internal pendingHire flag (a candidate dragged straight to Offered should
      // still appear). Candidates in earlier stages never show.
      if (!inHiredStage && !inOfferStage) continue;
      const mine = c.recruiterId === meId || c.recruiterName === meName;
      if (!isAdmin && !mine) continue;
      items.push({
        candidateId: c.id, candidateName: c.name, recruiterName: c.recruiterName || 'Unassigned',
        stage: c.stage, offerStatus: (c.offer && c.offer.status) || 'not_started',
        reason: inHiredStage ? 'Marked hired but offer not completed' : 'In offer stage — complete the offer',
      });
    }
    res.json({ count: items.length, items });
  } catch (e) { next(e); }
});

router.get('/missed-commitments', requireHrAccess, async (req, res, next) => {
  try {
    // Schedulers/admins get the full missed-commitments view. Regular employees
    // who sit on interview panels still need to see THEIR OWN pending interview
    // feedback, so we don't block them entirely — we just restrict them to their
    // own feedback items below (panelOnly).
    const fullView = canViewInternal(req);
    const isAdmin = !!req.isHrAdmin;
    const panelOnly = !fullView;
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
        // A fully-completed interview clears all its feedback reminders.
        if (iv.completed) continue;
        const fb = iv.feedbackByPanelist || {};
        // Feedback entries logged against this interview, for resolving whether a
        // specific panelist has submitted even if the panelist-key wasn't set.
        const ivFeedback = (c.feedback || []).filter((f) => f.interviewId === iv.id);
        // Has THIS panelist submitted? True if their panelist-key is flagged, or
        // a feedback entry for this interview was authored by them (matched by
        // id, admin:<id>, or name). This keeps tracking per-panelist: one
        // panelist submitting never clears another's pending reminder.
        const panelistSubmitted = (p) => {
          if (fb[p.id]) return true;
          const pidRaw = String(p.id).replace(/^admin:/, '');
          return ivFeedback.some((f) => String(f.byId) === pidRaw || `admin:${f.byId}` === String(p.id) || (f.by && p.name && f.by === p.name));
        };
        for (const p of (iv.panelists || [])) {
          if (panelistSubmitted(p)) continue; // this panelist has submitted
          const aid = `fb-${c.id}-${iv.id}-${p.id}`;
          if (dismissed.includes(aid)) continue;
          // Does this panelist entry refer to the current viewer?
          const pidRaw = String(p.id).replace(/^admin:/, '');
          const isMe = String(p.id) === String(meId) || pidRaw === String(meId) || (p.name && p.name === meName);
          // Visibility: in panel-only mode a viewer sees ONLY their own pending
          // feedback. In full view, admins see all, the recruiter sees their
          // candidate's, and a panelist sees their own.
          const relevant = panelOnly ? isMe : (isAdmin || isMe || mineOwner(c));
          if (!relevant) continue;
          items.push({ activityId: aid, candidateId: c.id, candidateName: c.name, kind: 'feedback',
            title: `Interview feedback pending — ${iv.roundLabel || iv.round || 'interview'}`,
            ownerId: p.id, ownerName: p.name || ownerName, dueAt: new Date(at).toISOString(),
            hoursLate: Math.max(0, Math.round((now - at) / 3600000)) });
          bump(p.id, p.name || ownerName);
        }
      }

      // Panel-only viewers see just their own feedback reminders — skip the
      // recruiter-oriented sections (calls, tasks, stalled stages, etc.).
      if (panelOnly) continue;

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
    const now = new Date(Date.now() + (5 * 60 + 30) * 60000); // IST
    const mmdd = (d) => { if (!d) return null; const s = String(d).slice(0, 10); return `${s.slice(5, 7)}-${s.slice(8, 10)}`; };
    const today = `${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
    const items = [];
    users.forEach((u) => {
      if (mmdd(u.birthday) === today) items.push({ id: u.id, name: u.name, avatar: u.avatar, type: 'birthday' });
      if (mmdd(u.joiningDate) === today) {
        const years = u.joiningDate ? (now.getUTCFullYear() - new Date(String(u.joiningDate).slice(0, 10) + 'T00:00:00').getUTCFullYear()) : 0;
        if (years > 0) items.push({ id: u.id, name: u.name, avatar: u.avatar, type: 'work', years, yearsLabel: ordinal(years) });
        else items.push({ id: u.id, name: u.name, avatar: u.avatar, type: 'joinee', designation: u.designation });
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
// Per-HR productivity: candidates added and interviews scheduled (each split
// today / this week / this month), plus joined this month (offer accepted and
// on a Hired stage). Each metric is compared against the HR's own targets.
router.get('/leaderboard', requireHrAccess, async (req, res, next) => {
  try {
    const users = await HrUser.findAll({ where: { active: true }, attributes: ['id', 'name', 'avatar', 'designation', 'type', 'targets'] });
    const cands = await HrCandidate.findAll();
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    // Week starts Monday.
    const dow = (now.getDay() + 6) % 7;
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow).getTime();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const workingDaysInMonth = 26; // for scaling a daily target to a monthly expectation

    const stat = new Map();
    users.forEach((u) => {
      const t = u.targets || {};
      stat.set(u.id, {
        id: u.id, name: u.name, avatar: u.avatar || null, designation: u.designation || '',
        added: { today: 0, week: 0, month: 0 }, interviews: { today: 0, week: 0, month: 0 }, joined: { month: 0 },
        targets: { daily: Number(t.dailyInterviews) || 0, monthlyJoin: Number(t.monthlyOnboarding) || 0 },
      });
    });
    const nameToId = new Map(users.map((u) => [u.name, u.id]));
    const bump = (id, metric, ts) => {
      const s = stat.get(id); if (!s) return;
      if (ts >= startOfMonth) s[metric].month += 1;
      if (s[metric].week !== undefined && ts >= startOfWeek) s[metric].week += 1;
      if (s[metric].today !== undefined && ts >= startOfDay) s[metric].today += 1;
    };
    const idTs = (iv) => {
      if (iv.createdAt) return new Date(iv.createdAt).getTime();
      const m = /^iv(\d+)$/.exec(iv.id || ''); return m ? Number(m[1]) : (iv.at ? new Date(iv.at).getTime() : 0);
    };
    cands.forEach((c) => {
      const ownerId = c.recruiterId || nameToId.get(c.recruiterName);
      // Candidates added — time-bucketed by when the candidate was created.
      if (ownerId && c.createdAt) bump(ownerId, 'added', new Date(c.createdAt).getTime());
      // Interviews scheduled — bucketed by when they were scheduled.
      (c.interviews || []).forEach((iv) => {
        const id = iv.scheduledById || nameToId.get(iv.by) || ownerId;
        if (id) bump(id, 'interviews', idTs(iv));
      });
      // Joined this month — offer accepted AND on a Hired stage.
      const joined = c.offer && c.offer.status === 'accepted' && HIRED_STAGE_IDS.has(String(c.stage || '').toLowerCase());
      if (joined && ownerId) {
        const doneAt = (c.offer.offerLetter && c.offer.offerLetter.sentAt) || c.updatedAt;
        const ts = doneAt ? new Date(doneAt).getTime() : startOfMonth;
        if (ts >= startOfMonth) { const s = stat.get(ownerId); if (s) s.joined.month += 1; }
      }
    });
    // Attach target comparisons: daily target applies to today's interviews;
    // a monthly interview expectation = daily × working days.
    let rows = Array.from(stat.values()).map((s) => ({
      ...s,
      targetInfo: {
        dailyInterviews: s.targets.daily,
        monthlyInterviews: s.targets.daily * workingDaysInMonth,
        monthlyJoin: s.targets.monthlyJoin,
        dailyMet: s.targets.daily ? s.interviews.today >= s.targets.daily : null,
        monthlyInterviewMet: s.targets.daily ? s.interviews.month >= s.targets.daily * workingDaysInMonth : null,
        monthlyJoinMet: s.targets.monthlyJoin ? s.joined.month >= s.targets.monthlyJoin : null,
      },
    })).filter((r) => r.added.month > 0 || r.interviews.month > 0 || r.joined.month > 0);
    rows.sort((a, b) => (b.joined.month - a.joined.month) || (b.interviews.month - a.interviews.month) || (b.added.month - a.added.month) || a.name.localeCompare(b.name));
    rows = rows.map((r, i) => ({ ...r, rank: i + 1 }));
    res.json({ rows, leader: rows[0] || null });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.scoreResumeMatchBg = scoreResumeMatchBg;
module.exports.notify = notify;
// For the future payroll/payslip module:
module.exports.getPendingSalaryReimbursements = getPendingSalaryReimbursements;
module.exports.markReimbursementsPaid = markReimbursementsPaid;
module.exports.normalizeJoiningYmd = normalizeJoiningYmd;

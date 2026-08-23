// ===========================================================================
// HR Manager — Daily Console
// A mostly-automated daily workspace for the HR Manager: an auto-collected
// snapshot (attendance, recruitment, new joiners, probation, notice period),
// an admin-configurable recurring checklist, ad-hoc + admin-assigned tasks, and
// a one-click end-of-day report that's emailed to admin (and stored in-app).
// ===========================================================================
const express = require('express');
const router = express.Router();
const {
  Op, HrUser, HrJobPost, HrCandidate, HrAttendance, HrLeave, HrOnboarding,
  HrDailyTask, HrChecklistItem, HrDailyReport, Settings, User,
} = require('../models');
const { requireHrAccess, requireHrAdmin } = require('../middleware/hrAuth');

// ---- IST date helpers ------------------------------------------------------
// The office runs on IST (UTC+5:30, no DST). "Today" is the IST calendar day.
function istParts(d = new Date()) {
  const ist = new Date(d.getTime() + (5 * 60 + 30) * 60000);
  return { y: ist.getUTCFullYear(), m: ist.getUTCMonth(), dom: ist.getUTCDate(),
    dow: ist.getUTCDay(), ymd: ist.toISOString().slice(0, 10) };
}
function todayYmd() { return istParts().ymd; }
function daysBetween(ymdA, ymdB) {
  const a = new Date(ymdA + 'T00:00:00Z'); const b = new Date(ymdB + 'T00:00:00Z');
  return Math.round((a - b) / 86400000);
}
function fmtYmd(ymd) {
  if (!ymd) return '';
  try { return new Date(ymd + 'T00:00:00+05:30').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return ymd; }
}

// The HR user whose console we're viewing. Defaults to the acting HR user; an
// admin may pass ?ownerId= to view a specific HR Manager's console.
async function resolveOwner(req) {
  const qId = req.query.ownerId || (req.body && req.body.ownerId);
  if (qId && req.isHrAdmin) {
    const u = await HrUser.findByPk(qId);
    if (u) return u;
  }
  // HR staff act as themselves (req.hrUser is the HrUser). CRM admins have no
  // HrUser row, so they must pass ?ownerId, or we fall back to the first HR
  // Manager (so an admin opening the console sees a sensible default).
  if (req.hrUser) return req.hrUser;
  if (req.isHrAdmin) {
    const mgr = await HrUser.findOne({ where: { active: true, isHrManager: true } });
    if (mgr) return mgr;
    const byType = await HrUser.findOne({ where: { active: true, type: 'manager' } });
    if (byType) return byType;
    // No HR Manager configured — fall back to any active HR user so the admin
    // still sees a populated console rather than an error.
    return HrUser.findOne({ where: { active: true }, order: [['id', 'ASC']] });
  }
  return null;
}

// ---- Auto-collection: the live daily snapshot ------------------------------
async function collectSnapshot(ownerBranch) {
  const today = todayYmd();
  const branchWhere = ownerBranch ? { branch: ownerBranch } : {};

  // Workforce + attendance --------------------------------------------------
  const staff = await HrUser.findAll({ where: { active: true, ...branchWhere } });
  const staffIds = staff.map((u) => u.id);
  const attToday = staffIds.length
    ? await HrAttendance.findAll({ where: { date: today, employeeId: { [Op.in]: staffIds } } })
    : [];
  const attById = Object.fromEntries(attToday.map((a) => [a.employeeId, a]));
  let present = 0, absent = 0, onLeave = 0, halfDay = 0, late = 0, notMarked = 0;
  for (const u of staff) {
    const a = attById[u.id];
    if (!a) { notMarked += 1; continue; }
    const st = String(a.status || '').toLowerCase();
    if (st === 'present') present += 1;
    else if (st === 'absent') absent += 1;
    else if (st === 'leave') onLeave += 1;
    else if (st === 'half_day') { halfDay += 1; present += 1; }
    if (a.late) late += 1;
  }
  // Pending leave requests (need HR action)
  const pendingLeaves = staffIds.length
    ? await HrLeave.findAll({ where: { status: 'pending', employeeId: { [Op.in]: staffIds } }, order: [['date', 'ASC']] })
    : [];
  const nameOf = Object.fromEntries(staff.map((u) => [u.id, u.name]));
  const leaveRequests = pendingLeaves.map((l) => ({ id: l.id, employee: nameOf[l.employeeId] || '—', type: l.type, date: l.date, duration: l.duration, reason: l.reason || '' }));

  // Recruitment snapshot ----------------------------------------------------
  const openJobs = await HrJobPost.count({ where: { status: 'open', ...(ownerBranch ? { branch: ownerBranch } : {}) } });
  const cands = await HrCandidate.findAll();
  const HIRED = new Set(['hired', 'joined', 'onboarded']);
  const isHired = (c) => HIRED.has(String(c.stage || '').toLowerCase()) || (c.offer && c.offer.status === 'accepted');
  let shortlisted = 0, offersReleased = 0, offersAccepted = 0;
  let interviewsScheduledToday = 0, interviewsDoneToday = 0;
  const upcomingJoinings = [];
  for (const c of cands) {
    const stage = String(c.stage || '').toLowerCase();
    if (!['applied', 'sourced', 'source', 'contacted', 'rejected', 'reject'].includes(stage) && !c.rejected) shortlisted += 1;
    if (c.offer && c.offer.status) {
      if (['released', 'sent', 'accepted', 'pending'].includes(String(c.offer.status).toLowerCase())) offersReleased += 1;
      if (String(c.offer.status).toLowerCase() === 'accepted') offersAccepted += 1;
      const jd = c.offer.joiningDate;
      if (jd && String(c.offer.status).toLowerCase() === 'accepted' && jd >= today) upcomingJoinings.push({ name: c.name, joiningDate: jd });
    }
    for (const iv of (c.interviews || [])) {
      const ivDate = (iv.date || (iv.at ? String(iv.at).slice(0, 10) : '') || '').slice(0, 10);
      if (ivDate === today) { interviewsScheduledToday += 1; if (iv.done || iv.status === 'done' || iv.completed) interviewsDoneToday += 1; }
    }
  }
  upcomingJoinings.sort((a, b) => a.joiningDate.localeCompare(b.joiningDate));

  // New joiners (first week / first month) ----------------------------------
  const newJoiners = staff
    .filter((u) => u.joiningDate)
    .map((u) => ({ id: u.id, name: u.name, designation: u.designation || '', joiningDate: String(u.joiningDate).slice(0, 10), daysSince: daysBetween(today, String(u.joiningDate).slice(0, 10)) }))
    .filter((u) => u.daysSince >= 0 && u.daysSince <= 30)
    .sort((a, b) => a.daysSince - b.daysSince);
  // Onboarding completion for new joiners
  const njIds = newJoiners.map((n) => n.id);
  const onboardRows = njIds.length ? await HrOnboarding.findAll({ where: { employeeId: { [Op.in]: njIds } } }) : [];
  const onboardBy = {};
  for (const o of onboardRows) { const g = onboardBy[o.employeeId] || { total: 0, done: 0 }; g.total += 1; if (o.done) g.done += 1; onboardBy[o.employeeId] = g; }
  newJoiners.forEach((n) => { const g = onboardBy[n.id]; n.onboarding = g ? `${g.done}/${g.total}` : '—'; n.window = n.daysSince <= 7 ? 'first_week' : 'first_month'; });

  // Probation ending soon (next 14 days) ------------------------------------
  const probation = staff
    .filter((u) => u.probationEndDate && u.probationStatus !== 'confirmed')
    .map((u) => ({ id: u.id, name: u.name, designation: u.designation || '', endDate: String(u.probationEndDate).slice(0, 10), daysLeft: daysBetween(String(u.probationEndDate).slice(0, 10), today), status: u.probationStatus || 'on_probation' }))
    .filter((u) => u.daysLeft <= 14)  // ending soon or overdue
    .sort((a, b) => a.daysLeft - b.daysLeft);

  // Notice-period employees -------------------------------------------------
  const notice = staff
    .filter((u) => u.exitStatus === 'notice' || u.lastWorkingDay)
    .filter((u) => u.exitStatus !== 'exited')
    .map((u) => ({ id: u.id, name: u.name, designation: u.designation || '', lastWorkingDay: u.lastWorkingDay ? String(u.lastWorkingDay).slice(0, 10) : '', daysLeft: u.lastWorkingDay ? daysBetween(String(u.lastWorkingDay).slice(0, 10), today) : null }))
    .sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999));

  return {
    date: today,
    workforce: { total: staff.length, present, absent, onLeave, halfDay, late, notMarked },
    leaveRequests,
    recruitment: { openJobs, shortlisted, offersReleased, offersAccepted, interviewsScheduledToday, interviewsDoneToday, upcomingJoinings },
    newJoiners,
    probation,
    notice,
  };
}

// The HR Manager's personal recruitment contribution KPI for the day. Counts
// interviews where they're a panelist, candidates they added, offers they moved.
async function collectContribution(ownerId) {
  if (!ownerId) return { interviewsTaken: 0, candidatesAdded: 0, offersClosed: 0 };
  const today = todayYmd();
  const cands = await HrCandidate.findAll();
  let interviewsTaken = 0, candidatesAdded = 0, offersClosed = 0;
  for (const c of cands) {
    if (c.recruiterId === ownerId) {
      // candidate added today?
      const created = c.createdAt ? new Date(c.createdAt) : null;
      if (created && istParts(created).ymd === today) candidatesAdded += 1;
    }
    for (const iv of (c.interviews || [])) {
      const panel = iv.panelistIds || iv.panelists || [];
      const ivDate = (iv.date || (iv.at ? String(iv.at).slice(0, 10) : '')).slice(0, 10);
      if (ivDate === today && Array.isArray(panel) && panel.map(String).includes(String(ownerId))) interviewsTaken += 1;
    }
    for (const fb of (c.feedback || [])) {
      if (String(fb.byId) === String(ownerId) && fb.at && istParts(new Date(fb.at)).ymd === today) { /* feedback given */ }
    }
    if (c.offer && c.offer.status === 'accepted' && c.recruiterId === ownerId) {
      const acceptedAt = c.offer.acceptedAt || c.offer.updatedAt;
      if (acceptedAt && istParts(new Date(acceptedAt)).ymd === today) offersClosed += 1;
    }
  }
  return { interviewsTaken, candidatesAdded, offersClosed };
}

// Ensure today's checklist tasks exist for the owner (idempotent). Creates one
// HrDailyTask per active checklist item that doesn't already have one today.
async function ensureChecklistTasks(ownerId) {
  if (!ownerId) return;
  const today = todayYmd();
  const items = await HrChecklistItem.findAll({
    where: { active: true, [Op.or]: [{ ownerId: null }, { ownerId }] },
    order: [['order', 'ASC'], ['id', 'ASC']],
  });
  if (!items.length) return;
  const existing = await HrDailyTask.findAll({ where: { ownerId, date: today, source: 'checklist' } });
  const haveItemIds = new Set(existing.map((t) => t.checklistItemId));
  for (const it of items) {
    if (haveItemIds.has(it.id)) continue;
    await HrDailyTask.create({ ownerId, date: today, title: it.label, details: it.description || '', source: 'checklist', checklistItemId: it.id, status: 'open', priority: 'normal' });
  }
}

// ---- GET /console — the full daily console for the owner -------------------
router.get('/console', requireHrAccess, async (req, res, next) => {
  try {
    const owner = await resolveOwner(req);
    if (!owner) return res.json({ empty: true, note: 'No HR Manager is configured yet. Add an HR user (or set an HR Manager) to use the daily console.', owner: null, date: todayYmd(), snapshot: { workforce: {}, recruitment: {}, contribution: {}, leaveRequests: [], newJoiners: [], probation: [], notice: [] }, tasks: [], report: null, submitted: false });
    await ensureChecklistTasks(owner.id);
    const today = todayYmd();
    const [snapshot, contribution, tasks, report] = await Promise.all([
      collectSnapshot(owner.branch),
      collectContribution(owner.id),
      HrDailyTask.findAll({ where: { ownerId: owner.id, date: today }, order: [['status', 'ASC'], ['priority', 'DESC'], ['id', 'ASC']] }),
      HrDailyReport.findOne({ where: { ownerId: owner.id, date: today } }),
    ]);
    snapshot.contribution = contribution;
    res.json({
      owner: { id: owner.id, name: owner.name, branch: owner.branch, designation: owner.designation || '' },
      date: today, dateLabel: fmtYmd(today),
      snapshot,
      tasks: tasks.map((t) => t.toJSON()),
      report: report ? report.toJSON() : null,
      submitted: !!(report && report.status === 'submitted'),
    });
  } catch (e) { next(e); }
});

// ---- Tasks -----------------------------------------------------------------
// Add a task (self or, if admin, assign to an HR user).
router.post('/tasks', requireHrAccess, async (req, res, next) => {
  try {
    const b = req.body || {};
    const title = String(b.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Task title is required.' });
    const isAdmin = !!req.isHrAdmin;
    let ownerId, source = 'self', assignedById = null, assignedByName = '', assignerType = '';
    if (b.assignToId && isAdmin) {
      ownerId = Number(b.assignToId); source = 'assigned';
      assignedById = (req.hrActor && req.hrActor.id) || null; assignedByName = (req.hrActor && req.hrActor.name) || 'Admin';
      assignerType = req.hrActor && req.hrActor.kind === 'admin' ? 'crm' : 'hr';
    } else {
      const owner = await resolveOwner(req);
      if (!owner) return res.status(400).json({ error: 'No HR user resolved.' });
      ownerId = owner.id;
    }
    const row = await HrDailyTask.create({
      ownerId, date: b.date || todayYmd(), title,
      details: String(b.details || '').slice(0, 4000),
      priority: ['low', 'normal', 'high'].includes(b.priority) ? b.priority : 'normal',
      source, assignedById, assignedByName, assignerType,
      createdById: (req.hrActor && req.hrActor.id) || null,
    });
    res.status(201).json(row.toJSON());
  } catch (e) { next(e); }
});

// Toggle / update a task (mark done, edit).
router.patch('/tasks/:id', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrDailyTask.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Task not found.' });
    const b = req.body || {};
    if (b.status && ['open', 'done'].includes(b.status)) { row.status = b.status; row.doneAt = b.status === 'done' ? new Date() : null; }
    if (typeof b.title === 'string' && b.title.trim()) row.title = b.title.trim();
    if (typeof b.details === 'string') row.details = b.details.slice(0, 4000);
    if (b.priority && ['low', 'normal', 'high'].includes(b.priority)) row.priority = b.priority;
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

router.delete('/tasks/:id', requireHrAccess, async (req, res, next) => {
  try {
    const row = await HrDailyTask.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Task not found.' });
    // Checklist-sourced tasks can't be deleted (they recur); only ad-hoc/assigned.
    if (row.source === 'checklist') return res.status(400).json({ error: 'Checklist items can’t be deleted here — edit the checklist in Admin.' });
    await row.destroy();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- Checklist config (admin) ---------------------------------------------
router.get('/checklist', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const rows = await HrChecklistItem.findAll({ order: [['order', 'ASC'], ['id', 'ASC']] });
    res.json(rows.map((r) => r.toJSON()));
  } catch (e) { next(e); }
});

router.post('/checklist', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    const label = String(b.label || '').trim();
    if (!label) return res.status(400).json({ error: 'Checklist item label is required.' });
    const max = await HrChecklistItem.max('order');
    const row = await HrChecklistItem.create({ label, description: String(b.description || '').slice(0, 500), order: (Number.isFinite(max) ? max : 0) + 1, ownerId: b.ownerId || null });
    res.status(201).json(row.toJSON());
  } catch (e) { next(e); }
});

router.patch('/checklist/:id', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const row = await HrChecklistItem.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Item not found.' });
    const b = req.body || {};
    if (typeof b.label === 'string' && b.label.trim()) row.label = b.label.trim();
    if (typeof b.description === 'string') row.description = b.description.slice(0, 500);
    if (typeof b.active === 'boolean') row.active = b.active;
    if (Number.isFinite(b.order)) row.order = b.order;
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

router.delete('/checklist/:id', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const row = await HrChecklistItem.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Item not found.' });
    await row.destroy();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Seed a sensible default checklist (the HR Manager's Top 10) if none exist.
router.post('/checklist/seed-defaults', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const count = await HrChecklistItem.count();
    if (count > 0) return res.json({ ok: true, seeded: 0, note: 'Checklist already has items.' });
    const defaults = [
      ['Floor visit', 'Morning walk of the office floor — attendance, activity, immediate concerns.'],
      ['Office cleanliness & workplace check', 'Workstations, common areas, meeting rooms, pantry; log any maintenance issues.'],
      ['10:20 AM HR standup', 'Daily HR team standup — priorities, recruitment, joiners, issues.'],
      ['Attendance & leave review', 'Review late-coming, absences, and pending leave requests.'],
      ['Recruitment monitoring + personal contribution', 'Pipeline, interviews, offers; take interviews / support critical roles.'],
      ['New joinee progress check', 'Check first-week / first-month joiners with their managers.'],
      ['Probation & notice-period review', 'Probation ending soon + notice-period handover status.'],
      ['Employee / manager issues & follow-ups', 'Grievances, manager coordination, pending HR actions.'],
      ['Hardware / IT coordination', 'New-joiner systems, access, pending IT requirements.'],
      ['5:00 PM Director standup + dashboard', 'Director review; then update the daily HR dashboard.'],
    ];
    let order = 1;
    for (const [label, description] of defaults) { await HrChecklistItem.create({ label, description, order: order++, active: true }); }
    res.json({ ok: true, seeded: defaults.length });
  } catch (e) { next(e); }
});

// ---- End-of-day report -----------------------------------------------------
// Submit today's report: freezes the snapshot + checklist + tasks + notes,
// stores it, and emails admin. Idempotent per owner+date (re-submit updates).
router.post('/report/submit', requireHrAccess, async (req, res, next) => {
  try {
    const owner = await resolveOwner(req);
    if (!owner) return res.status(400).json({ error: 'No HR user resolved.' });
    const today = todayYmd();
    await ensureChecklistTasks(owner.id);
    const [snapshot, contribution, tasks] = await Promise.all([
      collectSnapshot(owner.branch), collectContribution(owner.id),
      HrDailyTask.findAll({ where: { ownerId: owner.id, date: today }, order: [['id', 'ASC']] }),
    ]);
    snapshot.contribution = contribution;
    const checklist = tasks.filter((t) => t.source === 'checklist').map((t) => ({ label: t.title, done: t.status === 'done' }));
    const taskList = tasks.filter((t) => t.source !== 'checklist').map((t) => ({ title: t.title, status: t.status, source: t.source, priority: t.priority, assignedByName: t.assignedByName }));
    const notes = (req.body && req.body.notes) || {};
    const cleanNotes = {};
    for (const k of ['grievances', 'probationNotes', 'noticeNotes', 'managerCoordination', 'directorDecisions', 'tomorrowPriorities', 'other']) {
      if (typeof notes[k] === 'string') cleanNotes[k] = notes[k].slice(0, 5000);
    }
    const [row] = await HrDailyReport.findOrCreate({
      where: { ownerId: owner.id, date: today },
      defaults: { ownerId: owner.id, ownerName: owner.name, date: today },
    });
    row.ownerName = owner.name;
    row.snapshot = snapshot; row.changed('snapshot', true);
    row.checklist = checklist; row.changed('checklist', true);
    row.tasks = taskList; row.changed('tasks', true);
    row.notes = cleanNotes; row.changed('notes', true);
    row.status = 'submitted'; row.submittedAt = new Date();
    await row.save();

    // Email admin (best-effort) + in-app notification.
    let emailed = false;
    try { emailed = await emailReportToAdmin(row, owner); } catch (e) { console.error('[hr-daily] report email failed:', e.message); }
    if (emailed) { row.emailedAt = new Date(); await row.save(); }

    res.json({ ok: true, report: row.toJSON(), emailed });
  } catch (e) { next(e); }
});

// Fetch a report (today by default, or ?date=YYYY-MM-DD). Admins can pass ownerId.
router.get('/report', requireHrAccess, async (req, res, next) => {
  try {
    const owner = await resolveOwner(req);
    if (!owner) return res.status(400).json({ error: 'No HR user resolved.' });
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : todayYmd();
    const row = await HrDailyReport.findOne({ where: { ownerId: owner.id, date } });
    res.json({ report: row ? row.toJSON() : null });
  } catch (e) { next(e); }
});

// Admin: list recent submitted reports (all HR managers).
router.get('/reports', requireHrAccess, requireHrAdmin, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const rows = await HrDailyReport.findAll({ where: { status: 'submitted' }, order: [['date', 'DESC'], ['submittedAt', 'DESC']], limit });
    res.json(rows.map((r) => r.toJSON()));
  } catch (e) { next(e); }
});

// ---- Report email ----------------------------------------------------------
async function emailReportToAdmin(report, owner) {
  const gmail = require('../services/gmail');
  const s = await Settings.findOne({ where: { singleton: 'settings' } });
  if (!s || !gmail.isConfigured(s)) return false;
  // Send from the HR mailbox; to the admin(s).
  const getKey = (k) => (s.getKey ? s.getKey(k) : null);
  const list = Array.isArray(s.hrMailboxes) ? s.hrMailboxes : [];
  const def = list.find((m) => m.id === 'default') || list[0];
  const mailbox = (def && def.email) || '';
  const token = getKey('hrMailboxToken');
  if (!mailbox || !token) return false;
  const admins = await User.findAll({ where: { role: 'admin', active: true } });
  const to = admins.map((a) => a.email).filter(Boolean);
  if (!to.length) return false;
  const html = renderReportEmail(report, owner);
  await gmail.sendMessage(s, token, mailbox, { from: `"Qtonix HR" <${mailbox}>`, to, subject: `HR Daily Report — ${owner.name} — ${fmtYmd(report.date)}`, bodyHtml: html });
  return true;
}

function renderReportEmail(report, owner) {
  const snap = report.snapshot || {};
  const w = snap.workforce || {}; const r = snap.recruitment || {}; const con = snap.contribution || {};
  const NAVY = '#0A0E28', MUTED = '#6B7A99', GREEN = '#0F9D58', LINE = '#E2E9F8';
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const stat = (label, val) => `<td style="padding:10px 14px;border:1px solid ${LINE};"><div style="font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:.5px;">${esc(label)}</div><div style="font-size:20px;font-weight:800;color:${NAVY};">${esc(val)}</div></td>`;
  const section = (title, inner) => `<tr><td style="padding:18px 0 6px;"><div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:${MUTED};">${esc(title)}</div></td></tr><tr><td>${inner}</td></tr>`;
  const listRows = (arr, cols) => {
    if (!arr || !arr.length) return `<div style="font-size:13px;color:${MUTED};padding:6px 0;">None.</div>`;
    const head = cols.map((c) => `<th style="text-align:left;font-size:11px;color:${MUTED};text-transform:uppercase;padding:6px 10px;border-bottom:1px solid ${LINE};">${esc(c.h)}</th>`).join('');
    const body = arr.map((it) => `<tr>${cols.map((c) => `<td style="font-size:13px;color:${NAVY};padding:7px 10px;border-bottom:1px solid #EEF1F8;">${esc(c.get(it))}</td>`).join('')}</tr>`).join('');
    return `<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:8px;border-collapse:separate;overflow:hidden;"><tr>${head}</tr>${body}</table>`;
  };
  const checklist = (report.checklist || []);
  const doneCount = checklist.filter((c) => c.done).length;
  const checklistHtml = checklist.length
    ? checklist.map((c) => `<div style="font-size:13px;color:${NAVY};padding:4px 0;">${c.done ? '✅' : '⬜'} ${esc(c.label)}</div>`).join('')
    : `<div style="font-size:13px;color:${MUTED};">No checklist configured.</div>`;
  const tasks = (report.tasks || []);
  const tasksHtml = tasks.length
    ? tasks.map((t) => `<div style="font-size:13px;color:${NAVY};padding:4px 0;">${t.status === 'done' ? '✅' : '⬜'} ${esc(t.title)}${t.source === 'assigned' ? ` <span style="color:${MUTED};font-size:11px;">(assigned by ${esc(t.assignedByName || 'admin')})</span>` : ''}</div>`).join('')
    : `<div style="font-size:13px;color:${MUTED};">No ad-hoc tasks today.</div>`;
  const notes = report.notes || {};
  const noteBlock = (label, val) => val ? `<div style="margin-bottom:10px;"><div style="font-size:12px;font-weight:700;color:${MUTED};">${esc(label)}</div><div style="font-size:13px;color:${NAVY};white-space:pre-wrap;">${esc(val)}</div></div>` : '';
  const anyNotes = ['grievances', 'probationNotes', 'noticeNotes', 'managerCoordination', 'directorDecisions', 'tomorrowPriorities', 'other'].some((k) => notes[k]);

  return `<!DOCTYPE html><html><body style="margin:0;background:#F4F7FE;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7FE;padding:24px 0;"><tr><td align="center">
  <table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;max-width:640px;">
    <tr><td style="background:linear-gradient(90deg,#0A0E28,#141A3A);padding:26px 28px;">
      <div style="font-size:12px;font-weight:700;letter-spacing:1px;color:#8CA0C6;text-transform:uppercase;">HR Daily Report</div>
      <div style="font-size:22px;font-weight:800;color:#fff;margin-top:4px;">${esc(owner.name)} · ${esc(fmtYmd(report.date))}</div>
      <div style="font-size:13px;color:#B9C5DE;margin-top:2px;">${esc(owner.branch || '')} · Checklist ${doneCount}/${checklist.length} complete</div>
    </td></tr>
    <tr><td style="padding:20px 28px;">
      <table width="100%" cellpadding="0" cellspacing="0"><tbody>
        ${section('Workforce', `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>${stat('Total', w.total || 0)}${stat('Present', w.present || 0)}${stat('Absent', w.absent || 0)}${stat('On leave', w.onLeave || 0)}</tr><tr>${stat('Late', w.late || 0)}${stat('Half day', w.halfDay || 0)}${stat('Not marked', w.notMarked || 0)}<td style="border:1px solid ${LINE};"></td></tr></table>`)}
        ${section('Leave requests (pending)', listRows(snap.leaveRequests, [{ h: 'Employee', get: (x) => x.employee }, { h: 'Type', get: (x) => x.type }, { h: 'Date', get: (x) => fmtYmd(x.date) }, { h: 'Reason', get: (x) => x.reason }]))}
        ${section('Recruitment', `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>${stat('Open roles', r.openJobs || 0)}${stat('Shortlisted', r.shortlisted || 0)}${stat('Offers out', r.offersReleased || 0)}${stat('Offers accepted', r.offersAccepted || 0)}</tr><tr>${stat('Interviews today', r.interviewsScheduledToday || 0)}${stat('Interviews done', r.interviewsDoneToday || 0)}<td style="border:1px solid ${LINE};" colspan="2"></td></tr></table>`)}
        ${section('HR Manager’s recruitment contribution', `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>${stat('Interviews taken', con.interviewsTaken || 0)}${stat('Candidates added', con.candidatesAdded || 0)}${stat('Offers closed', con.offersClosed || 0)}<td style="border:1px solid ${LINE};"></td></tr></table>`)}
        ${section('New joiners (first month)', listRows(snap.newJoiners, [{ h: 'Name', get: (x) => x.name }, { h: 'Joined', get: (x) => fmtYmd(x.joiningDate) }, { h: 'Window', get: (x) => x.window === 'first_week' ? 'First week' : 'First month' }, { h: 'Onboarding', get: (x) => x.onboarding }]))}
        ${section('Probation ending soon', listRows(snap.probation, [{ h: 'Name', get: (x) => x.name }, { h: 'Ends', get: (x) => fmtYmd(x.endDate) }, { h: 'Days left', get: (x) => x.daysLeft < 0 ? `${-x.daysLeft} overdue` : x.daysLeft }, { h: 'Status', get: (x) => x.status }]))}
        ${section('Notice period', listRows(snap.notice, [{ h: 'Name', get: (x) => x.name }, { h: 'Last day', get: (x) => fmtYmd(x.lastWorkingDay) }, { h: 'Days left', get: (x) => x.daysLeft == null ? '—' : x.daysLeft }]))}
        ${section(`Daily checklist (${doneCount}/${checklist.length})`, checklistHtml)}
        ${section('Tasks', tasksHtml)}
        ${anyNotes ? section('HR Manager’s notes', `${noteBlock('Employee issues / grievances', notes.grievances)}${noteBlock('Probation notes', notes.probationNotes)}${noteBlock('Notice-period notes', notes.noticeNotes)}${noteBlock('Manager coordination', notes.managerCoordination)}${noteBlock('Decisions required from Director', notes.directorDecisions)}${noteBlock('Tomorrow’s priorities', notes.tomorrowPriorities)}${noteBlock('Other', notes.other)}`) : ''}
      </tbody></table>
    </td></tr>
    <tr><td style="padding:16px 28px;border-top:1px solid ${LINE};">
      <div style="font-size:12px;color:${MUTED};">Submitted by ${esc(owner.name)} on ${esc(new Date(report.submittedAt || Date.now()).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }))} IST · Qtonix HRMS</div>
    </td></tr>
  </table></td></tr></table></body></html>`;
}

module.exports = router;
module.exports.collectSnapshot = collectSnapshot;
module.exports.renderReportEmail = renderReportEmail;

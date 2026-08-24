// Attendance module (Core HR → Attendance).
// - Month calendar with auto-disabled weekend/holiday dates (per branch).
// - Daily entry page: mark every active employee Present / Absent(leave) /
//   Half Day / LOP, grouped branch → department.
// - Late detection uses each employee's shift start + a GLOBAL grace value from
//   settings (editable). Late→half-day penalty is a counter only (no day marked).
// - Leave/Half-day deducts from the chosen leave-type balance now; if no balance
//   remains it is forced to LOP (no negative balances).
// All routes are scope-enforced: admins & all-branches managers see every branch;
// a branch-scoped manager only their own.

const express = require('express');
const { Op } = require('sequelize');
const router = express.Router();
const { HrUser, HrShift, HrAttendance, HrHoliday, HrLeave, Settings } = require('../models');
const { requireHrAccess, canManageBranch } = require('../middleware/hrAuth');

const BRANCHES = ['Bhubaneswar', 'Kolkata'];
const DEFAULT_LEAVE_ALLOCATION = { casual: 12, medical: 12, privilege: 12, wfh: 24 };
const LEAVE_TYPES = ['casual', 'medical', 'privilege', 'wfh'];

// ---- policy (grace + late thresholds) pulled from editable settings ----
async function getPolicy() {
  const s = await Settings.findOne({ where: { singleton: 'settings' } });
  const p = (s && s.hrPolicy) || {};
  const lateRule = { graceMinutes: 30, consecutiveForHalfDay: 3, monthlyForHalfDay: 6, shiftHours: 9, ...(p.lateRule || {}) };
  const weekOff = { byBranch: {}, default: { type: 'all_sundays' }, ...(p.weekOff || {}) };
  return { lateRule, weekOff };
}

// ---- date helpers ----
const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
function nthWeekdayOfMonth(year, month /*1-12*/, date) {
  // returns which occurrence (1st,2nd..) of its weekday `date` is within the month
  return Math.floor((date - 1) / 7) + 1;
}

// Is `dateStr` (YYYY-MM-DD) a weekend-off for `branch`?
function isWeekendOff(dateStr, branch) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  if (dow === 0) return true; // all Sundays off everywhere
  if (dow === 6) {
    // Saturday rules differ by branch
    if (String(branch).toLowerCase() === 'kolkata') return true; // all Saturdays
    // Bhubaneswar: 2nd & 4th Saturday
    const nth = nthWeekdayOfMonth(y, m, d);
    if (nth === 2 || nth === 4) return true;
  }
  return false;
}

// Branches in scope for this request.
function scopedBranches(req, requested) {
  if (req.isHrAdmin || req.hrManagerAll) {
    if (requested && BRANCHES.some((b) => b.toLowerCase() === requested.toLowerCase())) return [requested];
    return BRANCHES;
  }
  // branch-scoped manager → only their branch
  const own = req.hrManagerScope && req.hrManagerScope !== 'all' ? req.hrManagerScope : req.hrBranch;
  return own ? [own] : [];
}

function toMin(t) { if (!t) return null; const [h, m] = String(t).split(':').map(Number); return h * 60 + m; }

// GET /calendar?month=YYYY-MM&branch=  → per-day flags for the month grid
router.get('/calendar', requireHrAccess, async (req, res, next) => {
  try {
    if (!(req.isHrAdmin || req.isHrManager)) return res.status(403).json({ error: 'Only an admin or HR manager can view attendance.' });
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7);
    const [y, m] = month.split('-').map(Number);
    const branches = scopedBranches(req, req.query.branch);
    if (!branches.length) return res.status(403).json({ error: 'No branch in your scope.' });
    // For a single-branch view we compute per-branch disabling; for the combined
    // (all) view a date is "working" if it is a working day for ANY in-scope branch.
    const daysInMonthPre = new Date(y, m, 0).getDate();
    const holidays = await HrHoliday.findAll({ where: { date: { [Op.between]: [`${month}-01`, `${month}-${pad(daysInMonthPre)}`] } } });
    const holByDate = {};
    holidays.forEach((h) => { const ds = String(h.date).slice(0, 10); (holByDate[ds] = holByDate[ds] || []).push(h.branch || ''); });

    const daysInMonth = new Date(y, m, 0).getDate();
    const activeEmp = await HrUser.findAll({ where: { active: true, branch: { [Op.in]: branches } } });
    const marked = await HrAttendance.findAll({ where: { date: { [Op.like]: `${month}-%` }, employeeId: { [Op.in]: activeEmp.map((e) => e.id) } } });
    const markedByDate = {};
    marked.forEach((a) => { markedByDate[a.date] = (markedByDate[a.date] || 0) + 1; });

    const days = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = ymd(y, m, d);
      // weekend off if off for ALL in-scope branches (so a working day in any branch stays open)
      const weekendOffAll = branches.every((b) => isWeekendOff(ds, b));
      // holiday if a holiday applies to all in-scope branches (branch '' = all branches)
      const hols = holByDate[ds] || [];
      const holidayAll = hols.length > 0 && branches.every((b) => hols.some((hb) => !hb || hb.toLowerCase() === b.toLowerCase()));
      const disabled = weekendOffAll || holidayAll;
      const totalActive = activeEmp.filter((e) => branches.some((b) => b.toLowerCase() === (e.branch || '').toLowerCase())).length;
      days.push({
        date: ds, disabled,
        reason: weekendOffAll ? 'week_off' : (holidayAll ? 'holiday' : ''),
        holidayName: holidayAll ? (holidays.find((h) => String(h.date).slice(0, 10) === ds) || {}).name || '' : '',
        marked: markedByDate[ds] || 0, totalActive,
      });
    }
    res.json({ month, branches, days });
  } catch (e) { next(e); }
});

// GET /day/:date?branch= → employees grouped branch→dept with their marks
router.get('/day/:date', requireHrAccess, async (req, res, next) => {
  try {
    if (!(req.isHrAdmin || req.isHrManager)) return res.status(403).json({ error: 'Only an admin or HR manager can view attendance.' });
    const date = req.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Bad date.' });
    const branches = scopedBranches(req, req.query.branch);
    if (!branches.length) return res.status(403).json({ error: 'No branch in your scope.' });

    const emps = await HrUser.findAll({ where: { active: true, branch: { [Op.in]: branches } }, order: [['branch', 'ASC'], ['department', 'ASC'], ['name', 'ASC']] });
    const att = await HrAttendance.findAll({ where: { date, employeeId: { [Op.in]: emps.map((e) => e.id) } } });
    const attByEmp = {}; att.forEach((a) => { attByEmp[a.employeeId] = a; });
    const shifts = await HrShift.findAll();
    const shiftById = {}; shifts.forEach((s) => { shiftById[s.id] = s; });

    // group branch → department
    const groups = {};
    for (const e of emps) {
      const br = e.branch || 'Unassigned';
      const dept = e.department || 'Unassigned';
      groups[br] = groups[br] || {};
      groups[br][dept] = groups[br][dept] || [];
      const a = attByEmp[e.id];
      const sh = e.shiftId ? shiftById[e.shiftId] : null;
      groups[br][dept].push({
        id: e.id, name: e.name, employeeId: e.employeeId, designation: e.designation,
        shiftName: sh ? sh.name : '', shiftStart: sh ? sh.startTime : '',
        status: a ? a.status : '', loginTime: a ? a.loginTime : '', logoutTime: a ? a.logoutTime : '',
        late: a ? a.late : false, leaveType: a && a.note && a.note.startsWith('leave:') ? a.note.slice(6) : '',
      });
    }
    res.json({ date, branches, groups });
  } catch (e) { next(e); }
});

// PUT /day/:date  → bulk upsert marks. Body: { entries: [{employeeId, status, loginTime, logoutTime, leaveType}] }
// status: present | absent_leave | half_day | lop
router.put('/day/:date', requireHrAccess, async (req, res, next) => {
  try {
    if (!(req.isHrAdmin || req.isHrManager)) return res.status(403).json({ error: 'Only an admin or HR manager can mark attendance.' });
    const date = req.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Bad date.' });
    const { lateRule } = await getPolicy();
    const entries = Array.isArray(req.body.entries) ? req.body.entries : [];
    const shifts = await HrShift.findAll(); const shiftById = {}; shifts.forEach((s) => { shiftById[s.id] = s; });

    const results = [];
    for (const en of entries) {
      const emp = await HrUser.findByPk(en.employeeId);
      if (!emp) continue;
      if (!canManageBranch(req, emp.branch)) { results.push({ employeeId: en.employeeId, error: 'out_of_scope' }); continue; }

      let status = en.status; // present | absent_leave | half_day | lop
      let leaveType = (en.leaveType || '').toLowerCase();
      let paidHalf = true, forcedLop = false;

      // Leave balance handling for leave-based statuses.
      if (status === 'absent_leave' || status === 'half_day') {
        if (!LEAVE_TYPES.includes(leaveType)) { results.push({ employeeId: emp.id, error: 'leave_type_required' }); continue; }
        const need = status === 'half_day' ? 0.5 : 1;
        const alloc = { ...DEFAULT_LEAVE_ALLOCATION, ...((emp.profile && emp.profile.leaveAllocation) || {}) };
        const used = await HrLeave.findAll({ where: { employeeId: emp.id, type: leaveType, status: 'approved', paid: true } });
        const usedUnits = used.reduce((sum, l) => sum + (l.duration === 'half' ? 0.5 : 1), 0);
        const remaining = (Number(alloc[leaveType]) || 0) - usedUnits;
        if (remaining >= need) {
          // deduct: record a paid leave row
          await HrLeave.destroy({ where: { employeeId: emp.id, date } }); // replace any prior leave for the day
          await HrLeave.create({ employeeId: emp.id, type: leaveType, date, duration: status === 'half_day' ? 'half' : 'full', paid: true, status: 'approved', appliedById: req.hrActor && req.hrActor.id, reason: 'Attendance entry' });
          paidHalf = true;
        } else {
          // no balance → force LOP
          forcedLop = true; paidHalf = false;
          await HrLeave.destroy({ where: { employeeId: emp.id, date } });
          if (status === 'half_day') {
            // half day still worked, other half unpaid — keep half_day but mark unpaid
            await HrLeave.create({ employeeId: emp.id, type: leaveType, date, duration: 'half', paid: false, status: 'approved', appliedById: req.hrActor && req.hrActor.id, reason: 'LOP (no balance)' });
          } else {
            status = 'lop'; // full-day leave with no balance becomes LOP
          }
        }
      } else {
        // not a leave status → clear any leave row for the day
        await HrLeave.destroy({ where: { employeeId: emp.id, date } });
      }

      // Late detection for present/half_day with a login time.
      let late = false;
      const sh = emp.shiftId ? shiftById[emp.shiftId] : null;
      const shiftStart = sh && sh.startTime ? sh.startTime : null;
      if ((status === 'present' || status === 'half_day') && en.loginTime && shiftStart) {
        const grace = Number(lateRule.graceMinutes) || 30;
        late = toMin(en.loginTime) > (toMin(shiftStart) + grace);
      }

      // Map to stored status vocabulary on HrAttendance.
      // present | half_day | absent_leave(→'leave') | lop(→'absent')
      const storeStatus = status === 'absent_leave' ? 'leave' : (status === 'lop' ? 'absent' : status);
      const note = (status === 'absent_leave' || status === 'half_day') && leaveType ? `leave:${leaveType}` : (forcedLop ? 'lop' : null);

      const [row] = await HrAttendance.findOrCreate({ where: { employeeId: emp.id, date }, defaults: { status: storeStatus } });
      row.status = storeStatus;
      row.loginTime = en.loginTime || null;
      row.logoutTime = en.logoutTime || null;
      row.late = late;
      row.note = note;
      row.markedById = req.hrActor && req.hrActor.id;
      row.source = 'manual';
      await row.save();
      results.push({ employeeId: emp.id, status, storedStatus: storeStatus, late, forcedLop });
    }
    res.json({ ok: true, date, results });
  } catch (e) { next(e); }
});

// GET /day/:date/summary → 4 boxes (present total + per branch %, absent)
router.get('/day/:date/summary', requireHrAccess, async (req, res, next) => {
  try {
    if (!(req.isHrAdmin || req.isHrManager)) return res.status(403).json({ error: 'Only an admin or HR manager can view attendance.' });
    const date = req.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Bad date.' });
    const branches = scopedBranches(req, req.query.branch);
    if (!branches.length) return res.status(403).json({ error: 'No branch in your scope.' });

    const emps = await HrUser.findAll({ where: { active: true, branch: { [Op.in]: branches } } });
    const att = await HrAttendance.findAll({ where: { date, employeeId: { [Op.in]: emps.map((e) => e.id) } } });
    const attByEmp = {}; att.forEach((a) => { attByEmp[a.employeeId] = a; });

    // present units: present=1, half_day=0.5. absent = leave(full) + lop/absent.
    const perBranch = {};
    BRANCHES.forEach((b) => { perBranch[b] = { total: 0, present: 0, absent: 0 }; });
    let total = 0, present = 0, absent = 0;
    for (const e of emps) {
      const br = BRANCHES.find((b) => b.toLowerCase() === (e.branch || '').toLowerCase());
      if (!br) continue;
      perBranch[br].total += 1; total += 1;
      const a = attByEmp[e.id];
      let presentUnits = 0, absentFlag = 0;
      if (a) {
        if (a.status === 'present') presentUnits = 1;
        else if (a.status === 'half_day') presentUnits = 0.5;
        else if (a.status === 'leave' || a.status === 'absent') absentFlag = 1;
      }
      present += presentUnits; perBranch[br].present += presentUnits;
      absent += absentFlag; perBranch[br].absent += absentFlag;
    }
    const pct = (n, d) => d > 0 ? Math.round((n / d) * 100) : 0;
    res.json({
      date,
      present: { count: present, total, pct: pct(present, total) },
      byBranch: BRANCHES.map((b) => ({ branch: b, count: perBranch[b].present, total: perBranch[b].total, pct: pct(perBranch[b].present, perBranch[b].total) })),
      absent: { count: absent, total },
    });
  } catch (e) { next(e); }
});

module.exports = router;

// ===========================================================================
// TEAM DAY-END REPORTS
// Assembles, per day, what each of a senior's direct reports did: attendance,
// their tasks with statuses, time-per-task (from status-change history), and
// their end-of-day note. Also formats the payload for Claude's review.
// ===========================================================================
const { Op, HrUser, Task, TaskActivity, TaskComment, HrAttendance, HrDayNote, HrShift } = require('../models');

const IST_OFFSET = 330 * 60000;
function istDateStr(d = new Date()) { return new Date(new Date(d).getTime() + IST_OFFSET).toISOString().slice(0, 10); }
function fmtDur(ms) {
  if (!ms || ms < 0) return null;
  const m = Math.round(ms / 60000);
  const h = Math.floor(m / 60); const mm = m % 60;
  if (h > 0) return `${h}h ${mm}m`;
  return `${mm}m`;
}
// Minutes between two "HH:MM" strings (logout − login), or null.
function hoursBetween(login, logout) {
  if (!login || !logout) return null;
  const [lh, lm] = login.split(':').map(Number); const [oh, om] = logout.split(':').map(Number);
  const mins = (oh * 60 + om) - (lh * 60 + lm);
  return mins > 0 ? mins : null;
}

// Direct reports of a senior (one level down, active, real users).
async function directReports(seniorId) {
  return HrUser.findAll({ where: { reportsToId: seniorId, active: true, chatOnly: { [Op.not]: true } }, order: [['name', 'ASC']] });
}

// The senior who should receive an employee's day-end report. Normally their
// direct manager (reportsToId). If they have none, walk UP is impossible, so we
// return null and the employee rolls up to Admin's department view instead.
// (The reverse — a manager's reports — is directReports above.)
async function seniorOf(emp) {
  if (!emp || !emp.reportsToId) return null;
  const mgr = await HrUser.findByPk(emp.reportsToId);
  return mgr && mgr.active ? mgr : null;
}

// Everyone in an employee's team for a senior, following the chain DOWN so that
// reports of reports with no direct manager still surface. We include:
//   - direct reports, and
//   - any active employee whose nearest active manager up the chain is this senior.
async function teamOf(seniorId) {
  const all = await HrUser.findAll({ where: { active: true, chatOnly: { [Op.not]: true } } });
  const byId = Object.fromEntries(all.map((u) => [u.id, u]));
  const out = [];
  for (const u of all) {
    if (u.id === seniorId) continue;
    // Walk up from u to the first active manager.
    let cur = u; let hops = 0; const seen = new Set([u.id]);
    while (cur && cur.reportsToId && hops < 8) {
      if (seen.has(cur.reportsToId)) break;
      seen.add(cur.reportsToId);
      const mgr = byId[cur.reportsToId];
      if (!mgr) break;
      if (mgr.id === seniorId) { out.push(u); break; }
      cur = mgr; hops += 1;
    }
  }
  // De-dup and sort by name.
  const uniq = Array.from(new Map(out.map((u) => [u.id, u])).values());
  uniq.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return uniq;
}

// An employee's effective end-of-day time (HH:MM, IST) from their shift, or a
// default. Used by the scheduler to know when their day is "done".
async function employeeShiftEnd(emp) {
  if (emp && emp.shiftId) {
    const shift = await HrShift.findByPk(emp.shiftId);
    if (shift && shift.endTime) return shift.endTime; // "18:00"
  }
  return null;
}

// Has this employee's working day ended for the given date? True if they've
// logged out, OR their shift end-time has passed (IST now), OR they're absent.
async function employeeDayEnded(emp, date) {
  const att = await HrAttendance.findOne({ where: { employeeId: emp.id, date } });
  if (att && ['absent', 'leave'].includes(att.status)) return true;   // nothing more coming
  if (att && att.logoutTime) return true;                             // logged out
  const end = await employeeShiftEnd(emp);
  if (end) {
    const now = istNow();
    const [h, m] = end.split(':').map(Number);
    const endMin = h * 60 + m;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    // Handles same-day shifts; midnight-crossing shifts fall through to false
    // until the next tick after their end time.
    if (nowMin >= endMin) return true;
  }
  return false;
}
function istNow() { return new Date(Date.now() + IST_OFFSET); }

// Compute per-task time from the TaskActivity trail for a given task, using the
// in_progress → completed spans. Falls back to startedAt/completedAt or workMs.
function computeTaskTime(task, acts) {
  // Prefer the persisted accumulator when present.
  if (task.workMs && task.workMs > 0) return { ms: task.workMs, source: 'tracked' };
  // Reconstruct from activity: pair each 'in progress' with the next 'completed'.
  const stages = acts
    .filter((a) => a.taskId === task.id && (a.kind === 'stage' || a.kind === 'completed'))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  let total = 0; let openAt = null;
  for (const a of stages) {
    const isStart = /in progress/i.test(a.detail || '');
    const isDone = a.kind === 'completed' || /completed/i.test(a.detail || '');
    const isReset = /not started/i.test(a.detail || '');
    if (isStart) openAt = new Date(a.createdAt);
    else if (isDone && openAt) { total += new Date(a.createdAt) - openAt; openAt = null; }
    else if (isReset) openAt = null;
  }
  if (total > 0) return { ms: total, source: 'reconstructed' };
  if (task.startedAt && task.completedAt) return { ms: new Date(task.completedAt) - new Date(task.startedAt), source: 'span' };
  return { ms: 0, source: 'none' };
}

// Historical baseline: this employee's median completion time on prior tasks
// (for Claude to judge "fast/slow" relative to their own past pace).
async function employeeBaseline(empId, beforeDate, cache) {
  const done = cache
    ? (cache.allTasks.filter((t) => t.assigneeId === empId && t.stage === 'completed')).sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0)).slice(0, 40)
    : await Task.findAll({ where: { assigneeId: empId, stage: 'completed', parentTaskId: null }, order: [['completedAt', 'DESC']], limit: 40 });
  const times = done
    .filter((t) => (t.completedAt ? istDateStr(t.completedAt) < beforeDate : false))
    .map((t) => (t.workMs && t.workMs > 0 ? t.workMs : (t.startedAt && t.completedAt ? new Date(t.completedAt) - new Date(t.startedAt) : 0)))
    .filter((ms) => ms > 0)
    .sort((a, b) => a - b);
  if (!times.length) return null;
  const mid = Math.floor(times.length / 2);
  const median = times.length % 2 ? times[mid] : (times[mid - 1] + times[mid]) / 2;
  return { medianMs: median, samples: times.length };
}

// Build one employee's slice for a date: attendance + tasks + note.
// Preload everything a whole report day needs in a few bulk queries, so we don't
// re-scan the tasks table once per employee (the main cause of slow reports).
async function loadDayCache(empIds, date) {
  const allTasks = await Task.findAll({ where: { parentTaskId: null } });
  // Index tasks by assignee for O(1) per-employee lookup.
  const tasksByEmp = {};
  for (const t of allTasks) {
    const owners = new Set([t.assigneeId, ...(Array.isArray(t.assigneeIds) ? t.assigneeIds : [])].filter(Boolean));
    for (const oid of owners) { if (!tasksByEmp[oid]) tasksByEmp[oid] = []; tasksByEmp[oid].push(t); }
  }
  const [atts, notes] = await Promise.all([
    HrAttendance.findAll({ where: { employeeId: { [Op.in]: empIds }, date } }),
    HrDayNote.findAll({ where: { employeeId: { [Op.in]: empIds }, date } }),
  ]);
  const attByEmp = Object.fromEntries(atts.map((a) => [a.employeeId, a]));
  const noteByEmp = Object.fromEntries(notes.map((n) => [n.employeeId, n.note]));
  return { allTasks, tasksByEmp, attByEmp, noteByEmp };
}

async function buildEmployeeDay(emp, date, opts = {}) {
  const cache = opts.cache || null;
  const att = cache ? (cache.attByEmp[emp.id] || null) : await HrAttendance.findOne({ where: { employeeId: emp.id, date } });
  const present = att ? !['absent', 'leave'].includes(att.status) : false;
  const mins = att ? hoursBetween(att.loginTime, att.logoutTime) : null;

  // Tasks the employee is assigned to that were active/updated on this date:
  // completed today OR currently open (any non-completed).
  const mine = cache ? (cache.tasksByEmp[emp.id] || []) : (await Task.findAll({ where: { parentTaskId: null } })).filter((t) => t.assigneeId === emp.id || (Array.isArray(t.assigneeIds) && t.assigneeIds.includes(emp.id)));
  const dayTasks = mine.filter((t) => {
    if (t.stage === 'completed') { const comp = t.completedAt ? istDateStr(t.completedAt) : null; return comp === date; }
    return true;
  });

  const taskIds = dayTasks.map((t) => t.id);
  const [acts, comments] = taskIds.length
    ? await Promise.all([
        TaskActivity.findAll({ where: { taskId: { [Op.in]: taskIds } } }),
        TaskComment.findAll({ where: { taskId: { [Op.in]: taskIds } }, order: [['createdAt', 'ASC']] }),
      ])
    : [[], []];

  const tasks = dayTasks.map((t) => {
    const time = computeTaskTime(t, acts);
    const notes = comments.filter((c) => c.taskId === t.id).map((c) => ({ by: c.authorName, body: c.body, at: c.createdAt }));
    return {
      id: t.id, title: t.title, priority: t.priority, stage: t.stage,
      timeMs: time.ms, timeLabel: fmtDur(time.ms), timeSource: time.source,
      dueDate: t.dueDate, overdue: t.dueDate ? String(t.dueDate) < date && t.stage !== 'completed' : false,
      seniorFlag: t.seniorFlag || null, seniorFlagNote: t.seniorFlagNote || null,
      notes,
    };
  });

  const note = cache ? (cache.noteByEmp[emp.id] || '') : ((await HrDayNote.findOne({ where: { employeeId: emp.id, date } }))?.note || '');
  // Baseline is only needed when Claude will actually review (i.e. not for the
  // fast list assembly). Skip it unless requested to save a query per employee.
  const baseline = opts.withBaseline === false ? null : await employeeBaseline(emp.id, date, cache);

  const doneCount = tasks.filter((t) => t.stage === 'completed').length;
  const inProg = tasks.filter((t) => t.stage === 'in_progress').length;
  const notStarted = tasks.filter((t) => t.stage === 'not_started').length;
  const highOpen = tasks.filter((t) => t.stage !== 'completed' && ['urgent', 'high'].includes(t.priority)).length;
  const overdue = tasks.filter((t) => t.overdue).length;

  return {
    employee: { id: emp.id, name: emp.name, designation: emp.designation || '', department: emp.department || '', avatar: emp.avatar || '' },
    attendance: {
      present, status: att ? att.status : 'absent',
      loginTime: att ? att.loginTime : null, logoutTime: att ? att.logoutTime : null,
      hoursLabel: mins ? fmtDur(mins * 60000) : null, late: att ? !!att.late : false,
    },
    counts: { done: doneCount, inProgress: inProg, notStarted, highOpen, overdue, total: tasks.length },
    tasks, note: note || '', baseline,
  };
}

// Assemble a full day for a senior: every team member's slice + roll-up.
// Uses the chain-aware team (includes reports-of-reports whose nearest active
// manager is this senior), so nobody is missed when middle managers are absent.
async function buildTeamDay(seniorId, date, opts = {}) {
  const reports = opts.roster || await teamOf(seniorId);
  const roster = opts.employeeId ? reports.filter((e) => e.id === opts.employeeId) : reports;
  const cache = opts.cache || await loadDayCache(roster.map((e) => e.id), date);
  const employees = [];
  for (const emp of roster) {
    employees.push(await buildEmployeeDay(emp, date, { ...opts, cache }));
  }
  const present = employees.filter((e) => e.attendance.present).length;
  const absent = employees.length - present;
  const totalDone = employees.reduce((s, e) => s + e.counts.done, 0);
  const totalPlanned = employees.reduce((s, e) => s + e.counts.total, 0);
  return { date, present, absent, totalDone, totalPlanned, employees };
}

// Admin view: every active employee grouped by department, for one date.
async function buildAdminDay(date, opts = {}) {
  const all = await HrUser.findAll({ where: { active: true, chatOnly: { [Op.not]: true } }, order: [['department', 'ASC'], ['name', 'ASC']] });
  const roster = all.filter((emp) => (!opts.department || (emp.department || 'Unassigned') === opts.department) && (!opts.employeeId || emp.id === opts.employeeId));
  const cache = opts.cache || await loadDayCache(roster.map((e) => e.id), date);
  const groups = {};
  for (const emp of roster) {
    const dept = emp.department || 'Unassigned';
    groups[dept] = groups[dept] || [];
    groups[dept].push(await buildEmployeeDay(emp, date, { ...opts, cache }));
  }
  const departments = Object.keys(groups).sort().map((dept) => {
    const employees = groups[dept];
    const present = employees.filter((e) => e.attendance.present).length;
    return { department: dept, present, absent: employees.length - present, totalDone: employees.reduce((s, e) => s + e.counts.done, 0), employees };
  });
  return { date, departments };
}

// A stable fingerprint of a day's task states, so we know when to re-run Claude.
function dayFingerprint(day) {
  const parts = [];
  for (const e of day.employees) {
    for (const t of e.tasks) parts.push(`${t.id}:${t.stage}:${t.timeMs}`);
    parts.push(`n${e.employee.id}:${(e.note || '').length}`);
  }
  const s = parts.sort().join('|');
  let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return String(h);
}

// Lightweight present/absent + done counts for a roster on a date, WITHOUT the
// heavy per-task assembly. Used by the dates list (which spans many days).
async function dayCounts(roster, date, cache) {
  const c = cache || await loadDayCache(roster.map((e) => e.id), date);
  let present = 0, done = 0, total = 0;
  for (const emp of roster) {
    const att = c.attByEmp[emp.id];
    if (att && !['absent', 'leave'].includes(att.status)) present++;
    const mine = c.tasksByEmp[emp.id] || [];
    for (const t of mine) {
      if (t.stage === 'completed') { if (t.completedAt && istDateStr(t.completedAt) === date) { done++; total++; } }
      else total++;
    }
  }
  return { present, absent: roster.length - present, totalDone: done, totalPlanned: total };
}

module.exports = { istDateStr, fmtDur, directReports, teamOf, seniorOf, employeeShiftEnd, employeeDayEnded, loadDayCache, dayCounts, buildEmployeeDay, buildTeamDay, buildAdminDay, dayFingerprint };

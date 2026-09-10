// ===========================================================================
// TEAM DAY-END REPORTS
// Assembles, per day, what each of a senior's direct reports did: attendance,
// their tasks with statuses, time-per-task (from status-change history), and
// their end-of-day note. Also formats the payload for Claude's review.
// ===========================================================================
const { Op, HrUser, Task, TaskActivity, TaskComment, HrAttendance, HrDayNote } = require('../models');

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
async function employeeBaseline(empId, beforeDate) {
  const done = await Task.findAll({
    where: { assigneeId: empId, stage: 'completed', parentTaskId: null },
    order: [['completedAt', 'DESC']], limit: 40,
  });
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
async function buildEmployeeDay(emp, date, opts = {}) {
  const att = await HrAttendance.findOne({ where: { employeeId: emp.id, date } });
  const present = att ? !['absent', 'leave'].includes(att.status) : false;
  const mins = att ? hoursBetween(att.loginTime, att.logoutTime) : null;

  // Tasks the employee is assigned to that were active/updated on this date:
  // completed today OR currently open (any non-completed) OR started today.
  const all = await Task.findAll({ where: { parentTaskId: null } });
  const mine = all.filter((t) => t.assigneeId === emp.id || (Array.isArray(t.assigneeIds) && t.assigneeIds.includes(emp.id)));
  const dayTasks = mine.filter((t) => {
    const comp = t.completedAt ? istDateStr(t.completedAt) : null;
    const started = t.startedAt ? istDateStr(t.startedAt) : null;
    if (t.stage === 'completed') return comp === date;              // completed that day
    return true;                                                    // still-open tasks always relevant
  });

  const taskIds = dayTasks.map((t) => t.id);
  const acts = taskIds.length ? await TaskActivity.findAll({ where: { taskId: { [Op.in]: taskIds } } }) : [];
  const comments = taskIds.length ? await TaskComment.findAll({ where: { taskId: { [Op.in]: taskIds } }, order: [['createdAt', 'ASC']] }) : [];

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

  const note = await HrDayNote.findOne({ where: { employeeId: emp.id, date } });
  const baseline = await employeeBaseline(emp.id, date);

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
    tasks, note: note ? note.note : '', baseline,
  };
}

// Assemble a full day for a senior: every direct report's slice + roll-up.
async function buildTeamDay(seniorId, date, opts = {}) {
  const reports = await directReports(seniorId);
  const employees = [];
  for (const emp of reports) {
    if (opts.employeeId && emp.id !== opts.employeeId) continue;
    employees.push(await buildEmployeeDay(emp, date, opts));
  }
  const present = employees.filter((e) => e.attendance.present).length;
  const absent = employees.length - present;
  const totalDone = employees.reduce((s, e) => s + e.counts.done, 0);
  const totalPlanned = employees.reduce((s, e) => s + e.counts.total, 0);
  return { date, present, absent, totalDone, totalPlanned, employees };
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

module.exports = { istDateStr, fmtDur, directReports, buildEmployeeDay, buildTeamDay, dayFingerprint };

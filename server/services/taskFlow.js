/**
 * Daily Task Flow engine — resolves each active flow's target to real employees,
 * checks each item's cadence for "due today", and creates the tasks on the right
 * boards. Idempotent via TaskFlowRun (flowId:itemId:empId:date). Also labels a
 * previous day's still-incomplete flow task so today's board shows what's carried
 * over.
 */

function istNow() { return new Date(Date.now() + 330 * 60000); }
function isoDay(d) { return d.toISOString().slice(0, 10); }

// Is this item due on `date` (a JS Date in IST)?
function isDue(item, date) {
  const cadence = item.cadence || 'daily';
  if (cadence === 'daily') return true;
  if (cadence === 'weekly') { const wd = date.getDay(); return Array.isArray(item.weekdays) && item.weekdays.includes(wd); }
  if (cadence === 'monthly') {
    const dom = item.dayOfMonth;
    const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    if (dom === 'last') return date.getDate() === last;
    const target = Math.min(Number(dom) || 1, last); // clamp e.g. 31 -> Feb 28/29
    return date.getDate() === target;
  }
  return false;
}

// Which occurrence of this weekday within the month (1st Sat, 2nd Sat, ...).
function nthWeekdayOfMonth(dateStr) { const d = new Date(dateStr + 'T00:00:00'); return Math.floor((d.getDate() - 1) / 7) + 1; }

// Decide, for one employee, whether a WEEKLY/MONTHLY item should be created
// today — including roll-forward: if its scheduled day fell on a non-working day
// (weekend/holiday/leave) for this employee, it rolls to the first working day
// at/after it. Returns { create: bool, scheduledDate } where scheduledDate is the
// original due date (used so we don't re-roll and to label correctly).
async function weeklyMonthlyDueForEmployee(models, emp, item, today, todayStr, cache) {
  // How far back could a scheduled day roll? Up to ~10 days is plenty.
  for (let back = 0; back <= 10; back++) {
    const d = new Date(today); d.setDate(d.getDate() - back);
    const ds = isoDay(d);
    if (!isDue(item, d)) continue; // not the scheduled day
    // Found the scheduled occurrence at `ds` (back days ago). Now: is TODAY the
    // first working day at/after that scheduled day for this employee?
    let firstWorking = null;
    for (let fwd = 0; fwd <= 12; fwd++) {
      const wd = new Date(d); wd.setDate(wd.getDate() + fwd);
      const wds = isoDay(wd);
      // eslint-disable-next-line no-await-in-loop
      if (await isWorkingDayFor(models, emp, wds, cache)) { firstWorking = wds; break; }
    }
    if (firstWorking === todayStr) return { create: true, scheduledDate: ds };
    // If the nearest scheduled occurrence's first-working-day isn't today, stop
    // (an earlier occurrence would already have been handled on its own day).
    return { create: false, scheduledDate: ds };
  }
  return { create: false, scheduledDate: null };
}

// Branch weekend rules — mirrors the attendance system:
//  - All branches: every Sunday off.
//  - Kolkata: every Saturday off.
//  - Bhubaneswar: 2nd & 4th Saturday off.
function branchWeekendOff(dateStr, branch) {
  const d = new Date(dateStr + 'T00:00:00');
  const dow = d.getDay();
  if (dow === 0) return true;
  const b = String(branch || '').toLowerCase();
  if (dow === 6) {
    if (b === 'kolkata') return true;
    if (b === 'bhubaneswar') { const nth = nthWeekdayOfMonth(dateStr); return nth === 2 || nth === 4; }
  }
  return false;
}

// Is `dateStr` a working day for this employee? Considers branch weekend rules,
// branch holidays, and whether the employee is on approved leave that day.
async function isWorkingDayFor(models, emp, dateStr, cache) {
  // Weekend (branch-specific).
  if (branchWeekendOff(dateStr, emp.branch)) return false;
  // Holiday for the branch (branch '' = company-wide).
  const holSet = cache.holidays;
  if (holSet && (holSet.has(`${dateStr}|`) || holSet.has(`${dateStr}|${String(emp.branch || '').toLowerCase()}`))) return false;
  // Approved leave that day (full or half — any leave means the recurring task is skipped).
  try {
    const lv = await models.HrLeave.findOne({ where: { employeeId: emp.id, date: dateStr, status: { [models.Op.in]: ['approved', 'pending'] } } });
    if (lv) return false;
  } catch {}
  return true;
}

// Preload the month's holidays into a Set for fast lookup.
async function loadHolidaySet(models, dateStr) {
  const set = new Set();
  try {
    const month = dateStr.slice(0, 7);
    const hols = await models.HrHoliday.findAll();
    for (const h of hols) { const hd = String(h.date).slice(0, 10); if (hd.slice(0, 7) === month) set.add(`${hd}|${String(h.branch || '').toLowerCase()}`); }
  } catch {}
  return set;
}

// Resolve a flow's target to a list of active HrUser rows.
async function resolveEmployees(models, flow) {
  const { HrUser, ChatTeamMember } = models;
  const vals = Array.isArray(flow.targetValues) ? flow.targetValues : [];
  if (!vals.length) return [];
  if (flow.targetType === 'employee' || flow.targetType === 'group') {
    const ids = vals.map(Number).filter(Boolean);
    return HrUser.findAll({ where: { id: { [models.Op.in]: ids }, active: true } });
  }
  if (flow.targetType === 'designation') {
    return HrUser.findAll({ where: { active: true, designation: { [models.Op.in]: vals } } });
  }
  if (flow.targetType === 'team') {
    // Team membership: prefer ChatTeamMember; fall back to HrUser.department == team.
    let ids = [];
    try {
      if (ChatTeamMember && models.ChatTeam) {
        const teams = await models.ChatTeam.findAll({ where: { name: { [models.Op.in]: vals } } });
        const tIds = teams.map((t) => t.id);
        if (tIds.length) { const mems = await ChatTeamMember.findAll({ where: { teamId: { [models.Op.in]: tIds } } }); ids = mems.map((m) => m.userId); }
      }
    } catch {}
    const where = { active: true };
    if (ids.length) return HrUser.findAll({ where: { active: true, id: { [models.Op.in]: [...new Set(ids)] } } });
    // fallback: department name match
    return HrUser.findAll({ where: { active: true, department: { [models.Op.in]: vals } } });
  }
  return [];
}

// Create one board task (+ its subtasks) for an employee from a flow item.
// Subtasks are child Task rows (parentTaskId), exactly like the workspace.
async function createTaskForItem(models, flow, item, emp, dateStr) {
  const { Task } = models;
  const prio = (p) => (['urgent', 'high', 'medium', 'low'].includes(p) ? p : 'medium');
  const parent = await Task.create({
    boardOwnerId: emp.id,
    bucket: 'today',
    title: String(item.title || 'Task').slice(0, 280),
    description: item.description || '',
    assigneeId: emp.id,
    assigneeIds: [emp.id],
    priority: prio(item.priority),
    stage: 'not_started',
    dueDate: dateStr,
    assignedById: flow.createdById || null,
    origAssignedById: flow.createdById || null,
    origAssignedByName: flow.createdByName || 'Task Flow',
    autoFlow: true,
    flowId: flow.id,
    flowItemId: String(item.id || ''),
  });
  // Subtasks → child rows under the parent (same board, same day, parent bucket).
  const subs = Array.isArray(item.subtasks) ? item.subtasks.filter((s) => s && String(s.title || '').trim()) : [];
  for (const s of subs) {
    await Task.create({
      boardOwnerId: emp.id,
      bucket: parent.bucket,
      parentTaskId: parent.id,
      title: String(s.title).slice(0, 280),
      description: '',
      assigneeId: emp.id,
      assigneeIds: [emp.id],
      priority: prio(s.priority),
      stage: 'not_started',
      dueDate: dateStr,
      assignedById: flow.createdById || null,
      origAssignedById: flow.createdById || null,
      origAssignedByName: flow.createdByName || 'Task Flow',
      autoFlow: true,
      flowId: flow.id,
      flowItemId: String(item.id || ''),
    });
  }
  return parent;
}

// Prefix a previous day's still-open flow task so it's visibly "carried over".
async function labelCarriedOver(models, flow, item, emp, todayStr) {
  const { Task, TaskFlowRun } = models;
  try {
    // Find prior runs for this item+emp that produced a task still incomplete.
    const priorRuns = await TaskFlowRun.findAll({ where: { flowId: flow.id, itemId: String(item.id || ''), employeeId: emp.id, date: { [models.Op.lt]: todayStr } }, order: [['date', 'DESC']], limit: 5 });
    for (const run of priorRuns) {
      if (!run.taskId) continue;
      const t = await Task.findByPk(run.taskId);
      if (!t) continue;
      if (['completed'].includes(t.stage)) continue;
      if (/^⚠ \[Pending from /.test(t.title)) continue; // already labelled
      const nice = new Date(run.date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      t.title = `⚠ [Pending from ${nice}] ${t.title}`.slice(0, 300);
      await t.save();
    }
  } catch {}
}

// The main run: process all active flows for `date` (defaults to IST today).
async function runFlows(models, opts = {}) {
  const { TaskFlow, TaskFlowRun } = models;
  const date = opts.date ? new Date(opts.date + 'T00:00:00') : istNow();
  const dateStr = isoDay(date);
  const flows = await TaskFlow.findAll({ where: { active: true } });
  const cache = { holidays: await loadHolidaySet(models, dateStr) };
  let created = 0, skippedNonWorking = 0;
  for (const flow of flows) {
    const items = Array.isArray(flow.items) ? flow.items : [];
    if (!items.length) continue;
    const emps = await resolveEmployees(models, flow);
    for (const emp of emps) {
      const workingToday = await isWorkingDayFor(models, emp, dateStr, cache);
      for (const item of items) {
        const cadence = item.cadence || 'daily';
        let create = false;
        if (cadence === 'daily') {
          // Daily: create only on working days; no roll-forward (missed days ignored).
          create = workingToday;
          if (!create) { skippedNonWorking++; continue; }
        } else {
          // Weekly/monthly are mandatory: create on the scheduled day, or roll to
          // the first working day after if the scheduled day was off/holiday/leave.
          if (!workingToday) continue; // can't post on a non-working day either
          const r = await weeklyMonthlyDueForEmployee(models, emp, item, date, dateStr, cache);
          create = r.create;
        }
        if (!create) continue;
        const runKey = `${flow.id}:${item.id}:${emp.id}:${dateStr}`;
        const exists = await TaskFlowRun.findOne({ where: { runKey } });
        if (exists) continue;
        await labelCarriedOver(models, flow, item, emp, dateStr);
        const task = await createTaskForItem(models, flow, item, emp, dateStr);
        await TaskFlowRun.create({ runKey, flowId: flow.id, itemId: String(item.id || ''), employeeId: emp.id, date: dateStr, taskId: task.id });
        created++;
        try { await require('./chatTask').postTaskAlert(emp.id, { kindTag: 'task_assigned', taskId: task.id, body: `🔁 New recurring task: ${item.title}` }); } catch {}
      }
    }
  }
  return { created, skippedNonWorking, date: dateStr };
}

let timer = null; let lastRunDay = null; let running = false;
const POST_HOUR = 6; // 6 AM IST
async function tick(models) {
  if (running) return; running = true;
  try {
    const now = istNow(); const day = isoDay(now);
    if (now.getHours() >= POST_HOUR && lastRunDay !== day) { await runFlows(models); lastRunDay = day; }
  } catch (e) { console.error('[task-flow] tick failed:', e.message); }
  running = false;
}
function start(models) {
  if (timer) return;
  timer = setInterval(() => tick(models), 30 * 60000);
  setTimeout(() => { tick(models).catch(() => {}); }, 25000); // catch-up shortly after boot
  console.log('[task-flow] scheduler started (posts ~' + POST_HOUR + ':00 IST)');
}

module.exports = { start, tick, runFlows, isDue, resolveEmployees };

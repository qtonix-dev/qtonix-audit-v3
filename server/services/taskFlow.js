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
  let created = 0;
  for (const flow of flows) {
    const items = Array.isArray(flow.items) ? flow.items : [];
    const dueItems = items.filter((it) => isDue(it, date));
    if (!dueItems.length) continue;
    const emps = await resolveEmployees(models, flow);
    for (const emp of emps) {
      for (const item of dueItems) {
        const runKey = `${flow.id}:${item.id}:${emp.id}:${dateStr}`;
        const exists = await TaskFlowRun.findOne({ where: { runKey } });
        if (exists) continue;
        // Label yesterday's leftover first (so the new one is clean).
        await labelCarriedOver(models, flow, item, emp, dateStr);
        const task = await createTaskForItem(models, flow, item, emp, dateStr);
        await TaskFlowRun.create({ runKey, flowId: flow.id, itemId: String(item.id || ''), employeeId: emp.id, date: dateStr, taskId: task.id });
        created++;
        // Notify the assignee (best-effort).
        try { await require('./chatTask').postTaskAlert(emp.id, { kindTag: 'task_assigned', taskId: task.id, body: `🔁 New recurring task: ${item.title}` }); } catch {}
      }
    }
  }
  return { created, date: dateStr };
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

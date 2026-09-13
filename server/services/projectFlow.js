/**
 * PROJECT FLOW ENGINE
 * Turns a flow template into a project's steps, spawns HRMS tasks stage-by-stage,
 * advances on completion/approval, and generates recurring monthly cycles.
 *
 * Tasks are created in the existing HRMS task system (server/models Task) so they
 * appear on boards, notify via Buzz #task, and roll into the Daily Report.
 */
const { Op, Project, ProjectMember, ProjectTemplate, ProjectStep, ProjectCycle, Task, HrUser, HrDepartment } = require('../models');

function istToday() { return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10); }
function addDays(dateStr, n) { const d = new Date((dateStr || istToday()) + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

// Find the Team Lead (or any senior) of a department to receive a stage's tasks.
async function departmentLead(department) {
  if (!department) return null;
  const all = await HrUser.findAll({ where: { active: true, department } });
  // Prefer an explicit lead/manager type, else the first senior.
  const lead = all.find((u) => /lead|manager|head|senior|tl/i.test(String(u.designation || '') + ' ' + String(u.type || '')));
  return lead || all[0] || null;
}

// Create the HRMS task for a project step, assigned to the department lead.
async function spawnTaskForStep(project, step) {
  const lead = await departmentLead(step.department);
  const assigneeId = lead ? lead.id : (project.projectManagerId || null);
  const title = `[${project.customerName}] ${step.name}`;
  const desc = `Project step for ${project.customerName} (${project.projectType}).` + (step.needsClientApproval ? ' Requires client approval when done.' : '');
  const task = await Task.create({
    boardOwnerId: assigneeId, assigneeId, assigneeIds: assigneeId ? [assigneeId] : [],
    assignedById: project.projectManagerId || project.createdById || null,
    assignedByName: project.projectManagerName || '',
    title, description: desc, stage: 'not_started', priority: 'high',
    bucket: 'today', dueDate: step.dueDate || null,
  });
  step.taskId = task.id;
  step.status = 'in_task';
  await step.save();
  // Notify the assignee via Buzz #task.
  try { if (assigneeId) await require('./chatTask').postTaskAlert(assigneeId, { kindTag: 'task_assigned', taskId: task.id, body: `Project task assigned: "${title}"` }); } catch {}
  return task;
}

// Instantiate a template's steps onto a project (all stages), then activate stage 1.
async function instantiateFlow(project, template) {
  const stages = (template && template.stages) || [];
  let order = 0;
  const startDate = project.startDate || istToday();
  let runningDate = startDate;
  const created = [];
  for (let si = 0; si < stages.length; si++) {
    const stage = stages[si];
    for (const s of (stage.steps || [])) {
      runningDate = addDays(runningDate, Number(s.deadlineDays) || 3);
      const step = await ProjectStep.create({
        projectId: project.id, stageIndex: si + 1, stageName: stage.name || `Stage ${si + 1}`,
        name: s.name || 'Step', department: s.department || '', orderIndex: order++,
        deadlineDays: Number(s.deadlineDays) || 3, dueDate: runningDate,
        needsClientApproval: !!s.needsClientApproval, isRecurringMonthly: !!s.isRecurringMonthly,
        isOptional: !!s.isOptional, status: si === 0 ? 'active' : 'locked',
      });
      created.push(step);
    }
  }
  // Spawn tasks for stage 1's (non-optional) steps.
  await activateStage(project, 1);
  return created;
}

// Activate a stage: spawn tasks for its steps (skip optional-unskipped until PM acts).
async function activateStage(project, stageIndex) {
  const steps = await ProjectStep.findAll({ where: { projectId: project.id, stageIndex, skipped: false }, order: [['orderIndex', 'ASC']] });
  for (const step of steps) {
    if (step.taskId || step.isOptional) { if (step.status === 'locked') { step.status = 'active'; await step.save(); } continue; }
    step.status = 'active'; await step.save();
    await spawnTaskForStep(project, step);
  }
  project.currentStage = stageIndex; await project.save();
}

// Called when a step's linked task is completed. Moves the step to awaiting
// approval (if it needs client approval) or done, then checks stage completion.
async function onTaskCompleted(taskId) {
  const step = await ProjectStep.findOne({ where: { taskId } });
  if (!step) return;
  if (step.needsClientApproval) { step.status = 'awaiting_approval'; await step.save(); }
  else { step.status = 'done'; step.completedAt = new Date(); await step.save(); await maybeAdvanceStage(step.projectId, step.stageIndex); }
}

// PM marks a client-approval step approved or changes-requested.
async function resolveApproval(stepId, approved, note, ctx) {
  const step = await ProjectStep.findByPk(stepId);
  if (!step) return { error: 'Step not found' };
  if (approved) {
    step.status = 'approved'; step.completedAt = new Date(); step.approvalNote = note || null; await step.save();
    await maybeAdvanceStage(step.projectId, step.stageIndex);
    return { ok: true, status: 'approved' };
  }
  // Changes requested → push the linked task back to changes_requested.
  step.status = 'changes_requested'; step.approvalNote = note || null; await step.save();
  if (step.taskId) { try { const t = await Task.findByPk(step.taskId); if (t) { t.stage = 'changes_requested'; if (!t.startedAt) t.startedAt = new Date(); t.workSegStart = new Date(); await t.save(); } } catch {} }
  return { ok: true, status: 'changes_requested' };
}

// If every non-skipped step in a stage is done/approved, activate the next stage.
async function maybeAdvanceStage(projectId, stageIndex) {
  const steps = await ProjectStep.findAll({ where: { projectId, stageIndex, skipped: false } });
  const allDone = steps.every((s) => ['done', 'approved'].includes(s.status));
  if (!allDone) return;
  const next = await ProjectStep.findOne({ where: { projectId, stageIndex: stageIndex + 1 } });
  const project = await Project.findByPk(projectId);
  if (next) { await activateStage(project, stageIndex + 1); }
  else if (project && !project.recurring) { project.status = 'completed'; await project.save(); }
}

// Skip an optional step (PM decision).
async function skipStep(stepId) {
  const step = await ProjectStep.findByPk(stepId);
  if (!step || !step.isOptional) return { error: 'Only optional steps can be skipped.' };
  step.skipped = true; step.status = 'done'; await step.save();
  await maybeAdvanceStage(step.projectId, step.stageIndex);
  return { ok: true };
}

// ---- Recurring monthly cycles -------------------------------------------------
// Start a new cycle: create a cycle row + spawn the recurring steps' tasks.
async function startCycle(project, template) {
  const last = await ProjectCycle.findOne({ where: { projectId: project.id }, order: [['cycleNumber', 'DESC']] });
  const num = (last ? last.cycleNumber : 0) + 1;
  const cp = project.campaignParams || {};
  const cycle = await ProjectCycle.create({
    projectId: project.id, cycleNumber: num, cycleStart: istToday(),
    targets: { backlinks: cp.backlinksPerMonth || 0, articles: cp.articlesPerMonth || 0, posts: cp.postsPerMonth || 0, reports: cp.reportsPerMonth || 0, calls: cp.callsPerMonth || 0 },
  });
  // Spawn recurring-monthly steps as fresh tasks for this cycle.
  const tmpl = template || (project.templateId ? await ProjectTemplate.findByPk(project.templateId) : null);
  const recurringDefs = [];
  for (const stage of ((tmpl && tmpl.stages) || [])) for (const s of (stage.steps || [])) if (s.isRecurringMonthly) recurringDefs.push({ ...s, stageName: stage.name });
  let order = 1000 + num * 100;
  for (const s of recurringDefs) {
    const step = await ProjectStep.create({
      projectId: project.id, stageIndex: 99, stageName: `Cycle ${num}`, name: `${s.name} (Cycle ${num})`,
      department: s.department || '', orderIndex: order++, deadlineDays: s.deadlineDays || 30,
      dueDate: addDays(istToday(), s.deadlineDays || 30), needsClientApproval: !!s.needsClientApproval,
      isRecurringMonthly: true, status: 'active', cycleId: cycle.id,
    });
    await spawnTaskForStep(project, step);
  }
  return cycle;
}

module.exports = {
  istToday, addDays, departmentLead, spawnTaskForStep, instantiateFlow, activateStage,
  onTaskCompleted, resolveApproval, maybeAdvanceStage, skipStep, startCycle,
};

// ===========================================================================
// Task boards — Asana-style per-employee task management.
// The board is the person (boardOwnerId). Sections hold tasks; a task with a
// parentTaskId is a subtask (1 level). Assignment is gated by canAssign().
// Mounted at /api/hr/tasks (HR-authenticated; admin-gated in the UI for now).
// ===========================================================================
const express = require('express');
const router = express.Router();
const {
  Op, HrUser, HrNotification, TaskSection, Task, TaskComment, TaskAttachment, TaskActivity,
} = require('../models');
const { requireHrAccess } = require('../middleware/hrAuth');
const perm = require('../services/taskPermissions');

const PRIORITIES = ['urgent', 'high', 'medium', 'low'];
const STAGES = ['not_started', 'in_progress', 'completed'];

// The acting HrUser row (null for a pure CRM admin) + context flags.
function actorCtx(req) {
  return { isAdmin: req.hrActor && req.hrActor.kind === 'admin', isHr: !!req.isHrAdmin };
}
async function loadRoster() {
  return HrUser.findAll({ where: { active: true }, attributes: ['id', 'name', 'type', 'department', 'branch', 'reportsToId', 'isHrManager', 'avatar', 'designation', 'active'] });
}

async function logActivity(taskId, req, kind, detail) {
  try { await TaskActivity.create({ taskId, actorId: req.hrActor.id, actorName: req.hrActor.name, kind, detail }); } catch {}
}

// ---- Assignee picker: who may I assign to? --------------------------------
router.get('/assignable', requireHrAccess, async (req, res, next) => {
  try {
    const roster = await loadRoster();
    const ctx = actorCtx(req);
    const actor = req.hrUser || null;
    const allowed = roster.filter((u) => perm.canAssign(actor, u, ctx));
    const q = String(req.query.q || '').trim().toLowerCase();
    const filtered = q ? allowed.filter((u) => u.name.toLowerCase().includes(q) || (u.designation || '').toLowerCase().includes(q)) : allowed;
    res.json(filtered.map((u) => ({ id: u.id, name: u.name, designation: u.designation || '', department: u.department || '', avatar: u.avatar || null, type: u.type })));
  } catch (e) { next(e); }
});

// ---- Board fetch: sections + tasks (+ subtasks) for one owner -------------
async function buildBoard(req, ownerId) {
  const owner = await HrUser.findByPk(ownerId);
  if (!owner) return { error: 404 };
  let allowed = req.isHrAdmin || (req.hrUser && req.hrUser.id === ownerId);
  if (!allowed) allowed = perm.canAssign(req.hrUser || null, owner, actorCtx(req));
  if (!allowed) return { error: 403 };

  const [sections, tasks] = await Promise.all([
    TaskSection.findAll({ where: { boardOwnerId: ownerId }, order: [['order', 'ASC'], ['id', 'ASC']] }),
    Task.findAll({ where: { boardOwnerId: ownerId }, order: [['order', 'ASC'], ['id', 'ASC']] }),
  ]);
  const ids = [...new Set(tasks.map((t) => t.assigneeId).filter(Boolean))];
  const people = ids.length ? await HrUser.findAll({ where: { id: ids }, attributes: ['id', 'name', 'avatar', 'designation'] }) : [];
  const pById = Object.fromEntries(people.map((p) => [p.id, p]));
  const subtaskCount = {};
  tasks.forEach((t) => { if (t.parentTaskId) subtaskCount[t.parentTaskId] = (subtaskCount[t.parentTaskId] || 0) + 1; });
  const decorate = (t) => ({ ...t.toJSON(), assignee: t.assigneeId && pById[t.assigneeId] ? { id: pById[t.assigneeId].id, name: pById[t.assigneeId].name, avatar: pById[t.assigneeId].avatar } : null, subtaskCount: subtaskCount[t.id] || 0 });
  return {
    owner: { id: owner.id, name: owner.name, avatar: owner.avatar || null, designation: owner.designation || '' },
    sections: sections.map((s) => s.toJSON()),
    tasks: tasks.filter((t) => !t.parentTaskId).map(decorate),
    subtasks: tasks.filter((t) => t.parentTaskId).map(decorate),
    canManage: req.isHrAdmin || (req.hrUser && req.hrUser.id === ownerId),
  };
}

router.get('/board/:ownerId', requireHrAccess, async (req, res, next) => {
  try {
    const out = await buildBoard(req, Number(req.params.ownerId));
    if (out.error === 404) return res.status(404).json({ error: 'Board owner not found.' });
    if (out.error === 403) return res.status(403).json({ error: 'You can’t view this board.' });
    res.json(out);
  } catch (e) { next(e); }
});

// My board shortcut.
router.get('/my-board', requireHrAccess, async (req, res, next) => {
  try {
    if (req.hrUser) { const out = await buildBoard(req, req.hrUser.id); return res.json(out); }
    // CRM admin has no HrUser board — return the roster so the UI can pick one.
    const roster = await loadRoster();
    res.json({ adminNoBoard: true, people: roster.map((u) => ({ id: u.id, name: u.name, avatar: u.avatar, designation: u.designation })) });
  } catch (e) { next(e); }
});

// ---- Sections -------------------------------------------------------------
router.post('/sections', requireHrAccess, async (req, res, next) => {
  try {
    const b = req.body || {};
    const ownerId = Number(b.boardOwnerId);
    const owner = await HrUser.findByPk(ownerId);
    if (!owner) return res.status(404).json({ error: 'Board owner not found.' });
    const mayManage = req.isHrAdmin || (req.hrUser && req.hrUser.id === ownerId) || perm.canAssign(req.hrUser || null, owner, actorCtx(req));
    if (!mayManage) return res.status(403).json({ error: 'Not allowed on this board.' });
    if (!String(b.name || '').trim()) return res.status(400).json({ error: 'Section name is required.' });
    const max = await TaskSection.max('order', { where: { boardOwnerId: ownerId } });
    const row = await TaskSection.create({ boardOwnerId: ownerId, name: b.name.trim().slice(0, 160), order: (Number.isFinite(max) ? max : 0) + 1, createdById: req.hrActor.id });
    res.status(201).json(row.toJSON());
  } catch (e) { next(e); }
});
router.patch('/sections/:id', requireHrAccess, async (req, res, next) => {
  try {
    const row = await TaskSection.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Section not found.' });
    const b = req.body || {};
    if (typeof b.name === 'string' && b.name.trim()) row.name = b.name.trim().slice(0, 160);
    if (Number.isFinite(b.order)) row.order = b.order;
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});
router.delete('/sections/:id', requireHrAccess, async (req, res, next) => {
  try {
    const row = await TaskSection.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Section not found.' });
    // Move its tasks to "no section" rather than delete them.
    await Task.update({ sectionId: null }, { where: { sectionId: row.id } });
    await row.destroy();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- Tasks + subtasks -----------------------------------------------------
async function notifyAssignee(assigneeId, assignerName, title, ownerId) {
  if (!assigneeId) return;
  try { await HrNotification.create({ userId: assigneeId, actorKind: 'hr', type: 'task_assigned', text: `${assignerName} assigned you a task: “${String(title).slice(0, 80)}”`, read: false }); } catch {}
}

router.post('/', requireHrAccess, async (req, res, next) => {
  try {
    const b = req.body || {};
    const title = String(b.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Task title is required.' });

    // Parent (for subtasks): 1 level only.
    let parent = null;
    if (b.parentTaskId) {
      parent = await Task.findByPk(b.parentTaskId);
      if (!parent) return res.status(404).json({ error: 'Parent task not found.' });
      if (parent.parentTaskId) return res.status(400).json({ error: 'Subtasks can’t have their own subtasks.' });
    }

    // Assignee → determines the board the task lands on. Default: self (or the
    // parent's board for a subtask). Validate against canAssign.
    const roster = await loadRoster();
    const ctx = actorCtx(req);
    const actor = req.hrUser || null;
    let assigneeId = b.assigneeId ? Number(b.assigneeId) : (parent ? parent.assigneeId : (actor ? actor.id : null));
    if (assigneeId) {
      const target = roster.find((u) => u.id === assigneeId);
      if (!target) return res.status(404).json({ error: 'Assignee not found.' });
      if (!perm.canAssign(actor, target, ctx)) return res.status(403).json({ error: 'You can’t assign tasks to this person.' });
    }
    const boardOwnerId = parent ? parent.boardOwnerId : (assigneeId || (actor ? actor.id : null));
    if (!boardOwnerId) return res.status(400).json({ error: 'No board resolved (admins must pick an assignee).' });

    const isAssignedToOther = assigneeId && actor && assigneeId !== actor.id;
    const max = await Task.max('order', { where: { boardOwnerId, sectionId: b.sectionId || null, parentTaskId: parent ? parent.id : null } });
    const row = await Task.create({
      boardOwnerId,
      sectionId: parent ? null : (b.sectionId || null),
      parentTaskId: parent ? parent.id : null,
      title: title.slice(0, 300),
      description: String(b.description || '').slice(0, 20000),
      assigneeId: assigneeId || null,
      priority: PRIORITIES.includes(b.priority) ? b.priority : 'medium',
      stage: STAGES.includes(b.stage) ? b.stage : 'not_started',
      dueDate: b.dueDate || null,
      order: (Number.isFinite(max) ? max : 0) + 1,
      createdById: req.hrActor.id, createdByName: req.hrActor.name, createdByKind: req.hrActor.kind,
      assignedById: isAssignedToOther ? req.hrActor.id : null,
      assignedByName: isAssignedToOther ? req.hrActor.name : '',
    });
    await logActivity(row.id, req, 'created', 'created this task');
    if (isAssignedToOther) await notifyAssignee(assigneeId, req.hrActor.name, title, boardOwnerId);
    res.status(201).json(row.toJSON());
  } catch (e) { next(e); }
});

router.patch('/:id', requireHrAccess, async (req, res, next) => {
  try {
    const row = await Task.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Task not found.' });
    const b = req.body || {};
    const actor = req.hrUser || null;
    const ctx = actorCtx(req);

    if (typeof b.title === 'string' && b.title.trim()) row.title = b.title.trim().slice(0, 300);
    if (typeof b.description === 'string') row.description = b.description.slice(0, 20000);
    if (b.priority && PRIORITIES.includes(b.priority) && b.priority !== row.priority) { row.priority = b.priority; await logActivity(row.id, req, 'priority', `set priority to ${b.priority}`); }
    if (b.dueDate !== undefined) { row.dueDate = b.dueDate || null; await logActivity(row.id, req, 'due', b.dueDate ? `set due date ${b.dueDate}` : 'cleared due date'); }
    if (b.sectionId !== undefined) row.sectionId = b.sectionId || null;
    if (Number.isFinite(b.order)) row.order = b.order;
    if (b.stage && STAGES.includes(b.stage) && b.stage !== row.stage) {
      row.stage = b.stage;
      row.completedAt = b.stage === 'completed' ? new Date() : null;
      await logActivity(row.id, req, b.stage === 'completed' ? 'completed' : 'stage', b.stage === 'completed' ? 'completed this task' : `moved to ${b.stage.replace('_', ' ')}`);
    }
    if (b.assigneeId !== undefined) {
      const newId = b.assigneeId ? Number(b.assigneeId) : null;
      if (newId) {
        const roster = await loadRoster();
        const target = roster.find((u) => u.id === newId);
        if (!target) return res.status(404).json({ error: 'Assignee not found.' });
        if (!perm.canAssign(actor, target, ctx)) return res.status(403).json({ error: 'You can’t assign tasks to this person.' });
        if (newId !== row.assigneeId) {
          row.assigneeId = newId;
          row.assignedById = actor && newId !== actor.id ? req.hrActor.id : null;
          row.assignedByName = actor && newId !== actor.id ? req.hrActor.name : '';
          await logActivity(row.id, req, 'assigned', 'reassigned this task');
          if (actor && newId !== actor.id) await notifyAssignee(newId, req.hrActor.name, row.title, row.boardOwnerId);
        }
      } else { row.assigneeId = null; }
    }
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

router.delete('/:id', requireHrAccess, async (req, res, next) => {
  try {
    const row = await Task.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Task not found.' });
    await Task.destroy({ where: { parentTaskId: row.id } }); // remove subtasks
    await TaskComment.destroy({ where: { taskId: row.id } });
    await TaskAttachment.destroy({ where: { taskId: row.id } });
    await TaskActivity.destroy({ where: { taskId: row.id } });
    await row.destroy();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Subtasks + detail for one task.
router.get('/:id/detail', requireHrAccess, async (req, res, next) => {
  try {
    const row = await Task.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Task not found.' });
    const [subtasks, comments, attachments, activity] = await Promise.all([
      Task.findAll({ where: { parentTaskId: row.id }, order: [['order', 'ASC'], ['id', 'ASC']] }),
      TaskComment.findAll({ where: { taskId: row.id }, order: [['createdAt', 'ASC']] }),
      TaskAttachment.findAll({ where: { taskId: row.id }, order: [['id', 'ASC']] }),
      TaskActivity.findAll({ where: { taskId: row.id }, order: [['createdAt', 'DESC']], limit: 50 }),
    ]);
    const ids = [...new Set([row.assigneeId, ...subtasks.map((s) => s.assigneeId)].filter(Boolean))];
    const people = ids.length ? await HrUser.findAll({ where: { id: ids }, attributes: ['id', 'name', 'avatar'] }) : [];
    const pById = Object.fromEntries(people.map((p) => [p.id, p]));
    const dec = (t) => ({ ...t.toJSON(), assignee: t.assigneeId && pById[t.assigneeId] ? { id: pById[t.assigneeId].id, name: pById[t.assigneeId].name, avatar: pById[t.assigneeId].avatar } : null });
    res.json({ task: dec(row), subtasks: subtasks.map(dec), comments: comments.map((c) => c.toJSON()), attachments: attachments.map((a) => a.toJSON()), activity: activity.map((a) => a.toJSON()) });
  } catch (e) { next(e); }
});

// ---- Comments (notes) -----------------------------------------------------
router.post('/:id/comments', requireHrAccess, async (req, res, next) => {
  try {
    const row = await Task.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Task not found.' });
    const body = String((req.body && req.body.body) || '').trim();
    if (!body) return res.status(400).json({ error: 'Note can’t be empty.' });
    const c = await TaskComment.create({ taskId: row.id, authorId: req.hrActor.id, authorName: req.hrActor.name, body: body.slice(0, 10000) });
    res.status(201).json(c.toJSON());
  } catch (e) { next(e); }
});

// ---- Attachments (ImageKit URLs recorded here) ----------------------------
router.post('/:id/attachments', requireHrAccess, async (req, res, next) => {
  try {
    const row = await Task.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Task not found.' });
    const b = req.body || {};
    if (!b.url) return res.status(400).json({ error: 'Attachment URL required.' });
    const a = await TaskAttachment.create({ taskId: row.id, url: String(b.url).slice(0, 600), name: String(b.name || '').slice(0, 300), mime: String(b.mime || '').slice(0, 120), size: Number(b.size) || 0, uploadedById: req.hrActor.id });
    res.status(201).json(a.toJSON());
  } catch (e) { next(e); }
});
router.delete('/attachments/:id', requireHrAccess, async (req, res, next) => {
  try { const a = await TaskAttachment.findByPk(req.params.id); if (!a) return res.status(404).json({ error: 'Not found.' }); await a.destroy(); res.json({ ok: true }); } catch (e) { next(e); }
});

// ---- "Assigned by me" — tasks I pushed onto other people's boards ---------
router.get('/assigned-by-me', requireHrAccess, async (req, res, next) => {
  try {
    if (!req.hrActor) return res.json({ tasks: [] });
    const rows = await Task.findAll({ where: { assignedById: req.hrActor.id }, order: [['createdAt', 'DESC']], limit: 200 });
    const ids = [...new Set(rows.map((t) => t.assigneeId).filter(Boolean))];
    const people = ids.length ? await HrUser.findAll({ where: { id: ids }, attributes: ['id', 'name', 'avatar'] }) : [];
    const pById = Object.fromEntries(people.map((p) => [p.id, p]));
    res.json({ tasks: rows.map((t) => ({ ...t.toJSON(), assignee: t.assigneeId && pById[t.assigneeId] ? { id: pById[t.assigneeId].id, name: pById[t.assigneeId].name, avatar: pById[t.assigneeId].avatar } : null })) });
  } catch (e) { next(e); }
});

module.exports = router;

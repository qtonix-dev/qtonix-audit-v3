// ===========================================================================
// Task boards — Asana-style per-employee task management API.
// The board IS the person (boardOwnerId). Sections hold tasks; a task with
// parentTaskId is a subtask (1 level). Assignment is governed by canAssign().
//
// Access for now: admin-only (mounted behind requireHrAdmin at the router level
// via the ADMIN_ONLY flag below). Once tested we open it to all employees by
// relaxing the guard — the per-user permission logic already supports that.
// ===========================================================================
const express = require('express');
const router = express.Router();
const {
  Op, HrUser, User, Task, TaskSection, TaskComment, TaskAttachment, TaskActivity, HrNotification,
} = require('../models');
const { requireHrAccess, requireHrAdmin } = require('../middleware/hrAuth');
const { canAssign } = require('../services/taskPermissions');

// While in admin-only pilot, every route requires HR-admin. requireHrAccess
// populates req.isHrAdmin / req.hrActor; requireHrAdmin then enforces admin. To
// open boards to all HR users later, swap `guard` to just [requireHrAccess].
const ADMIN_ONLY = true;
const guard = ADMIN_ONLY ? [requireHrAccess, requireHrAdmin] : [requireHrAccess];

// Resolve the acting person as an HrUser-like object for permission checks.
// CRM admins have no HrUser row → represented with { kind:'admin', isAdmin }.
async function actingContext(req) {
  const isAdmin = !!req.isHrAdmin || (req.hrActor && req.hrActor.kind === 'admin');
  let actorUser = null;
  if (req.hrUser) actorUser = req.hrUser;                       // real HR staff
  else if (req.hrActor && req.hrActor.kind === 'hr') actorUser = await HrUser.findByPk(req.hrActor.id);
  return { isAdmin, isHr: isAdmin || (req.hrActor && (req.hrActor.kind === 'hr')), actorUser, actorId: req.hrActor && req.hrActor.id, actorName: (req.hrActor && req.hrActor.name) || 'Admin', actorKind: (req.hrActor && req.hrActor.kind) || 'admin' };
}

async function logActivity(taskId, ctx, kind, detail) {
  try { await TaskActivity.create({ taskId, actorId: ctx.actorId || null, actorName: ctx.actorName, kind, detail }); } catch { /* non-fatal */ }
}

async function notifyAssignee(assigneeId, ctx, task) {
  if (!assigneeId || assigneeId === ctx.actorId) return; // don't notify self
  try {
    await HrNotification.create({
      userId: assigneeId, actorKind: 'hr', type: 'task_assigned',
      text: `${ctx.actorName} assigned you a task: “${String(task.title).slice(0, 120)}”`,
    });
  } catch { /* non-fatal */ }
}

// A light roster used for the assignee picker + validating assignment.
async function roster() {
  return HrUser.findAll({ where: { active: true }, attributes: ['id', 'name', 'type', 'department', 'branch', 'reportsToId', 'isHrManager', 'avatar', 'designation', 'active'], order: [['name', 'ASC']] });
}

// ---- my-board: the caller's default board, or (admin) a people picker ------
// Admins have no HrUser board of their own, so they get { adminNoBoard, people }
// to choose whose board to open. HR staff get their own board directly.
router.get('/my-board', guard, async (req, res, next) => {
  try {
    const ctx = await actingContext(req);
    if (ctx.actorUser) {
      return res.json(await buildBoard(ctx.actorUser.id, ctx));
    }
    // CRM admin — no personal board; return the people picker.
    const people = await roster();
    res.json({ adminNoBoard: true, people: people.map((u) => ({ id: u.id, name: u.name, designation: u.designation || '', department: u.department || '', branch: u.branch || '', avatar: u.avatar || null, type: u.type })) });
  } catch (e) { next(e); }
});

// Shared board builder (used by /my-board and /board/:ownerId).
async function buildBoard(ownerId, ctx) {
  const owner = await HrUser.findByPk(ownerId);
  if (!owner) return { error: 'Board owner not found.' };
  const [sections, tasks, people] = await Promise.all([
    TaskSection.findAll({ where: { boardOwnerId: ownerId }, order: [['order', 'ASC'], ['id', 'ASC']] }),
    Task.findAll({ where: { boardOwnerId: ownerId }, order: [['order', 'ASC'], ['id', 'ASC']] }),
    roster(),
  ]);
  const pById = Object.fromEntries(people.map((u) => [u.id, u]));
  const decorate = (t) => { const a = pById[t.assigneeId]; const o = t.toJSON(); o.assignee = a ? { id: a.id, name: a.name, avatar: a.avatar || null } : null; return o; };
  const top = tasks.filter((t) => !t.parentTaskId).map(decorate);
  const subs = tasks.filter((t) => t.parentTaskId).map(decorate);
  const subsByParent = {};
  for (const s of subs) { (subsByParent[s.parentTaskId] = subsByParent[s.parentTaskId] || []).push(s); }
  top.forEach((t) => { t.subtasks = subsByParent[t._id] || []; t.subtaskCount = t.subtasks.length; t.subtaskDone = t.subtasks.filter((x) => x.stage === 'completed').length; });
  return {
    owner: { id: owner.id, name: owner.name, designation: owner.designation || '', department: owner.department || '', branch: owner.branch || '', avatar: owner.avatar || null },
    sections: sections.map((s) => s.toJSON()),
    tasks: top,
    canManage: true, // admin pilot — always manageable; later gated per role
  };
}

// ---- Who can I assign to? (scoped picker) ---------------------------------
router.get('/assignable', guard, async (req, res, next) => {
  try {
    const ctx = await actingContext(req);
    const people = await roster();
    const allowed = people.filter((u) => canAssign(ctx.actorUser, u, ctx));
    const q = String(req.query.q || '').trim().toLowerCase();
    const filtered = q ? allowed.filter((u) => u.name.toLowerCase().includes(q) || (u.designation || '').toLowerCase().includes(q)) : allowed;
    res.json(filtered.map((u) => ({ id: u.id, name: u.name, designation: u.designation || '', department: u.department || '', branch: u.branch || '', avatar: u.avatar || null, type: u.type })));
  } catch (e) { next(e); }
});

// ---- Board list (people who have boards) — admin picks whose board to view -
router.get('/boards', guard, async (req, res, next) => {
  try {
    const people = await roster();
    // Count open tasks per board owner for a quick overview.
    const counts = await Task.findAll({ attributes: ['boardOwnerId', [require('../models').sequelize.fn('COUNT', require('../models').sequelize.col('id')), 'n']], where: { parentTaskId: null }, group: ['boardOwnerId'], raw: true });
    const countBy = Object.fromEntries(counts.map((c) => [c.boardOwnerId, Number(c.n)]));
    res.json(people.map((u) => ({ id: u.id, name: u.name, designation: u.designation || '', department: u.department || '', branch: u.branch || '', avatar: u.avatar || null, type: u.type, taskCount: countBy[u.id] || 0 })));
  } catch (e) { next(e); }
});

// ---- Full board for one owner: sections + tasks + subtasks ----------------
router.get('/board/:ownerId', guard, async (req, res, next) => {
  try {
    const ctx = await actingContext(req);
    const out = await buildBoard(Number(req.params.ownerId), ctx);
    if (out.error) return res.status(404).json(out);
    res.json(out);
  } catch (e) { next(e); }
});

// ---- Sections -------------------------------------------------------------
// Body-based create (frontend posts { boardOwnerId, name }).
router.post('/sections', guard, async (req, res, next) => {
  try {
    const ctx = await actingContext(req);
    const b = req.body || {};
    const ownerId = Number(b.boardOwnerId);
    const name = String(b.name || '').trim();
    if (!ownerId || !name) return res.status(400).json({ error: 'Board and section name are required.' });
    const max = await TaskSection.max('order', { where: { boardOwnerId: ownerId } });
    const row = await TaskSection.create({ boardOwnerId: ownerId, name, order: (Number.isFinite(max) ? max : 0) + 1, createdById: ctx.actorId || null });
    res.status(201).json(row.toJSON());
  } catch (e) { next(e); }
});

router.post('/board/:ownerId/sections', guard, async (req, res, next) => {
  try {
    const ownerId = Number(req.params.ownerId);
    const ctx = await actingContext(req);
    const name = String((req.body && req.body.name) || '').trim();
    if (!name) return res.status(400).json({ error: 'Section name is required.' });
    const max = await TaskSection.max('order', { where: { boardOwnerId: ownerId } });
    const row = await TaskSection.create({ boardOwnerId: ownerId, name, order: (Number.isFinite(max) ? max : 0) + 1, createdById: ctx.actorId || null });
    res.status(201).json(row.toJSON());
  } catch (e) { next(e); }
});

router.patch('/sections/:id', guard, async (req, res, next) => {
  try {
    const row = await TaskSection.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Section not found.' });
    const b = req.body || {};
    if (typeof b.name === 'string' && b.name.trim()) row.name = b.name.trim();
    if (Number.isFinite(b.order)) row.order = b.order;
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

router.delete('/sections/:id', guard, async (req, res, next) => {
  try {
    const row = await TaskSection.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Section not found.' });
    // Move its tasks to "no section" rather than deleting them.
    await Task.update({ sectionId: null }, { where: { sectionId: row.id } });
    await row.destroy();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- Tasks & subtasks -----------------------------------------------------
// Create a task on someone's board. Assignment defaults the board owner to the
// assignee (task lives on the assignee's board), unless an explicit boardOwnerId
// is given (e.g. adding to your own board with a different assignee is blocked —
// board owner and assignee are kept in sync for clarity).
router.post('/tasks', guard, async (req, res, next) => {
  try {
    const ctx = await actingContext(req);
    const b = req.body || {};
    const title = String(b.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Task title is required.' });

    // Resolve assignee (defaults to self when omitted).
    let assigneeId = b.assigneeId ? Number(b.assigneeId) : (ctx.actorUser ? ctx.actorUser.id : null);
    if (!assigneeId) return res.status(400).json({ error: 'An assignee is required.' });

    // Permission: may the actor assign to this person?
    const people = await roster();
    const target = people.find((u) => u.id === assigneeId);
    if (!target) return res.status(404).json({ error: 'Assignee not found.' });
    if (!canAssign(ctx.actorUser, target, ctx)) return res.status(403).json({ error: 'You can’t assign a task to this person.' });

    // Subtask validation (1 level deep).
    let parentTaskId = b.parentTaskId ? Number(b.parentTaskId) : null;
    let boardOwnerId = assigneeId;
    let sectionId = b.sectionId ? Number(b.sectionId) : null;
    if (parentTaskId) {
      const parent = await Task.findByPk(parentTaskId);
      if (!parent) return res.status(404).json({ error: 'Parent task not found.' });
      if (parent.parentTaskId) return res.status(400).json({ error: 'Subtasks can’t have their own subtasks.' });
      boardOwnerId = parent.boardOwnerId;   // subtask lives on parent's board
      sectionId = parent.sectionId;
    }

    const max = await Task.max('order', { where: { boardOwnerId, sectionId: sectionId || null, parentTaskId: parentTaskId || null } });
    const isAssignedByOther = assigneeId !== ctx.actorId;
    const row = await Task.create({
      boardOwnerId, sectionId, parentTaskId, title,
      description: String(b.description || '').slice(0, 20000),
      assigneeId,
      priority: ['urgent', 'high', 'medium', 'low'].includes(b.priority) ? b.priority : 'medium',
      stage: ['not_started', 'in_progress', 'completed'].includes(b.stage) ? b.stage : 'not_started',
      dueDate: b.dueDate || null,
      order: (Number.isFinite(max) ? max : 0) + 1,
      createdById: ctx.actorId || null, createdByName: ctx.actorName, createdByKind: ctx.actorKind,
      assignedById: isAssignedByOther ? (ctx.actorId || null) : null,
      assignedByName: isAssignedByOther ? ctx.actorName : '',
    });
    await logActivity(row.id, ctx, 'created', parentTaskId ? 'created subtask' : 'created task');
    if (isAssignedByOther) await notifyAssignee(assigneeId, ctx, row);
    res.status(201).json(row.toJSON());
  } catch (e) { next(e); }
});

router.patch('/tasks/:id', guard, async (req, res, next) => {
  try {
    const ctx = await actingContext(req);
    const row = await Task.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Task not found.' });
    const b = req.body || {};

    if (typeof b.title === 'string' && b.title.trim()) row.title = b.title.trim();
    if (typeof b.description === 'string') row.description = b.description.slice(0, 20000);
    if (b.priority && ['urgent', 'high', 'medium', 'low'].includes(b.priority) && b.priority !== row.priority) { row.priority = b.priority; await logActivity(row.id, ctx, 'priority', `priority → ${b.priority}`); }
    if (b.dueDate !== undefined) row.dueDate = b.dueDate || null;
    if (b.sectionId !== undefined) row.sectionId = b.sectionId ? Number(b.sectionId) : null;
    if (Number.isFinite(b.order)) row.order = b.order;

    if (b.stage && ['not_started', 'in_progress', 'completed'].includes(b.stage) && b.stage !== row.stage) {
      row.stage = b.stage;
      row.completedAt = b.stage === 'completed' ? new Date() : null;
      await logActivity(row.id, ctx, b.stage === 'completed' ? 'completed' : 'stage', `moved to ${b.stage.replace('_', ' ')}`);
    }

    // Reassignment — re-check permission against the new assignee.
    if (b.assigneeId !== undefined && Number(b.assigneeId) !== row.assigneeId) {
      const newId = Number(b.assigneeId);
      const people = await roster();
      const target = people.find((u) => u.id === newId);
      if (!target) return res.status(404).json({ error: 'Assignee not found.' });
      if (!canAssign(ctx.actorUser, target, ctx)) return res.status(403).json({ error: 'You can’t assign a task to this person.' });
      row.assigneeId = newId;
      // Top-level task follows its assignee's board; subtasks stay on parent board.
      if (!row.parentTaskId) row.boardOwnerId = newId;
      row.assignedById = ctx.actorId || null; row.assignedByName = ctx.actorName;
      await logActivity(row.id, ctx, 'assigned', `assigned to ${target.name}`);
      await notifyAssignee(newId, ctx, row);
    }
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

router.delete('/tasks/:id', guard, async (req, res, next) => {
  try {
    const row = await Task.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Task not found.' });
    // Delete subtasks, comments, attachments, activity with the task.
    await Task.destroy({ where: { parentTaskId: row.id } });
    await TaskComment.destroy({ where: { taskId: row.id } });
    await TaskAttachment.destroy({ where: { taskId: row.id } });
    await TaskActivity.destroy({ where: { taskId: row.id } });
    await row.destroy();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- Task detail in drawer shape: { task, subtasks, comments, ... } -------
router.get('/tasks/:id/detail', guard, async (req, res, next) => {
  try {
    const row = await Task.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Task not found.' });
    const [subtasks, comments, attachments, activity, people] = await Promise.all([
      Task.findAll({ where: { parentTaskId: row.id }, order: [['order', 'ASC'], ['id', 'ASC']] }),
      TaskComment.findAll({ where: { taskId: row.id }, order: [['createdAt', 'ASC']] }),
      TaskAttachment.findAll({ where: { taskId: row.id }, order: [['createdAt', 'ASC']] }),
      TaskActivity.findAll({ where: { taskId: row.id }, order: [['createdAt', 'DESC']], limit: 50 }),
      roster(),
    ]);
    const pById = Object.fromEntries(people.map((u) => [u.id, u]));
    const dec = (t) => { const a = pById[t.assigneeId]; const o = t.toJSON(); o.assignee = a ? { id: a.id, name: a.name, avatar: a.avatar || null } : null; return o; };
    res.json({
      task: dec(row),
      subtasks: subtasks.map(dec),
      comments: comments.map((c) => c.toJSON()),
      attachments: attachments.map((a) => a.toJSON()),
      activity: activity.map((a) => a.toJSON()),
    });
  } catch (e) { next(e); }
});

// ---- Task detail (drawer): task + subtasks + comments + attachments + log --
router.get('/tasks/:id', guard, async (req, res, next) => {
  try {
    const row = await Task.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Task not found.' });
    const [subtasks, comments, attachments, activity, people] = await Promise.all([
      Task.findAll({ where: { parentTaskId: row.id }, order: [['order', 'ASC'], ['id', 'ASC']] }),
      TaskComment.findAll({ where: { taskId: row.id }, order: [['createdAt', 'ASC']] }),
      TaskAttachment.findAll({ where: { taskId: row.id }, order: [['createdAt', 'ASC']] }),
      TaskActivity.findAll({ where: { taskId: row.id }, order: [['createdAt', 'DESC']], limit: 50 }),
      roster(),
    ]);
    const pById = Object.fromEntries(people.map((u) => [u.id, u]));
    const dec = (t) => { const a = pById[t.assigneeId]; const o = t.toJSON(); o.assignee = a ? { id: a.id, name: a.name, avatar: a.avatar || null } : null; return o; };
    const out = dec(row);
    out.subtasks = subtasks.map(dec);
    out.comments = comments.map((c) => c.toJSON());
    out.attachments = attachments.map((a) => a.toJSON());
    out.activity = activity.map((a) => a.toJSON());
    res.json(out);
  } catch (e) { next(e); }
});

// ---- Comments (notes thread) ----------------------------------------------
router.post('/tasks/:id/comments', guard, async (req, res, next) => {
  try {
    const ctx = await actingContext(req);
    const row = await Task.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Task not found.' });
    const body = String((req.body && req.body.body) || '').trim();
    if (!body) return res.status(400).json({ error: 'Note can’t be empty.' });
    const c = await TaskComment.create({ taskId: row.id, authorId: ctx.actorId || null, authorName: ctx.actorName, body: body.slice(0, 5000) });
    res.status(201).json(c.toJSON());
  } catch (e) { next(e); }
});

// ---- Attachments (ImageKit URL saved after client upload) -----------------
router.post('/tasks/:id/attachments', guard, async (req, res, next) => {
  try {
    const ctx = await actingContext(req);
    const row = await Task.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Task not found.' });
    const b = req.body || {};
    if (!b.url) return res.status(400).json({ error: 'Attachment URL is required.' });
    const a = await TaskAttachment.create({ taskId: row.id, url: String(b.url).slice(0, 600), name: String(b.name || '').slice(0, 300), mime: String(b.mime || '').slice(0, 120), size: Number(b.size) || 0, uploadedById: ctx.actorId || null });
    res.status(201).json(a.toJSON());
  } catch (e) { next(e); }
});

router.delete('/attachments/:id', guard, async (req, res, next) => {
  try {
    const a = await TaskAttachment.findByPk(req.params.id);
    if (!a) return res.status(404).json({ error: 'Attachment not found.' });
    await a.destroy();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- "Assigned by me" — track what I delegated to others ------------------
router.get('/assigned-by-me', guard, async (req, res, next) => {
  try {
    const ctx = await actingContext(req);
    if (!ctx.actorId) return res.json({ tasks: [] });
    const rows = await Task.findAll({ where: { assignedById: ctx.actorId, assigneeId: { [Op.ne]: ctx.actorId } }, order: [['createdAt', 'DESC']], limit: 200 });
    const people = await roster();
    const pById = Object.fromEntries(people.map((u) => [u.id, u]));
    res.json({ tasks: rows.map((t) => { const a = pById[t.assigneeId]; const o = t.toJSON(); o.assignee = a ? { id: a.id, name: a.name, avatar: a.avatar || null } : null; return o; }) });
  } catch (e) { next(e); }
});

module.exports = router;

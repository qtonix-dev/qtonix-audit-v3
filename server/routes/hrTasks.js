// ===========================================================================
// Task boards — Asana "My Tasks"-style, two-way per-person board.
//
// Your board is ONE workspace showing both directions:
//   • tasks assigned to you        (yours to do)
//   • tasks you assigned to others (yours to track — status is live)
//   • your own personal tasks
// A task appears on BOTH the assignee's and the assigner's boards; when the
// assignee moves its stage, the assigner sees it update in real time.
//
// Five FIXED scheduling sections (buckets), no custom sections:
//   recently_assigned · today · tomorrow · next_week · later
// Newly assigned tasks land in 'recently_assigned'; the assignee drags them to
// a day bucket by their own priority. Bucket (scheduling) and Stage (progress)
// are independent — both show on the row.
//
// Access: admin-only pilot (ADMIN_ONLY). Per-user permission logic already
// supports all employees — flip the flag + guard to open it up.
// ===========================================================================
const express = require('express');
const router = express.Router();
const {
  Op, sequelize, HrUser, Task, TaskComment, TaskAttachment, TaskActivity, HrNotification,
} = require('../models');
const { requireHrAccess, requireHrAdmin } = require('../middleware/hrAuth');
const { canAssign } = require('../services/taskPermissions');

const ADMIN_ONLY = true;
const guard = ADMIN_ONLY ? [requireHrAccess, requireHrAdmin] : [requireHrAccess];

const BUCKETS = ['recently_assigned', 'today', 'tomorrow', 'next_week', 'later'];
const BUCKET_LABELS = { recently_assigned: 'Recently Assigned', today: 'Do Today', tomorrow: 'Do Tomorrow', next_week: 'Do Next Week', later: 'Do Later' };

async function actingContext(req) {
  const isAdmin = !!req.isHrAdmin || (req.hrActor && req.hrActor.kind === 'admin');
  let actorUser = null;
  if (req.hrUser) actorUser = req.hrUser;
  else if (req.hrActor && req.hrActor.kind === 'hr') actorUser = await HrUser.findByPk(req.hrActor.id);
  return {
    isAdmin,
    isHr: isAdmin || (req.hrActor && req.hrActor.kind === 'hr'),
    actorUser,
    actorId: req.hrActor && req.hrActor.id,
    actorName: (req.hrActor && req.hrActor.name) || 'Admin',
    actorKind: (req.hrActor && req.hrActor.kind) || 'admin',
  };
}

async function logActivity(taskId, ctx, kind, detail) {
  try { await TaskActivity.create({ taskId, actorId: ctx.actorId || null, actorName: ctx.actorName, kind, detail }); } catch { /* non-fatal */ }
}

async function notifyAssignee(assigneeId, ctx, task) {
  if (!assigneeId || assigneeId === ctx.actorId) return;
  try {
    await HrNotification.create({
      userId: assigneeId, actorKind: 'hr', type: 'task_assigned',
      text: ctx.actorName + ' assigned you a task: \u201C' + String(task.title).slice(0, 120) + '\u201D',
    });
  } catch { /* non-fatal */ }
}

async function roster() {
  return HrUser.findAll({ where: { active: true }, attributes: ['id', 'name', 'type', 'department', 'branch', 'reportsToId', 'isHrManager', 'avatar', 'designation', 'active'], order: [['name', 'ASC']] });
}

function decorateWith(pById) {
  return (t) => {
    const a = pById[t.assigneeId];
    const b = pById[t.assignedById];
    const o = t.toJSON();
    o.assignee = a ? { id: a.id, name: a.name, avatar: a.avatar || null } : null;
    o.assigner = b ? { id: b.id, name: b.name, avatar: b.avatar || null } : (t.assignedByName ? { id: t.assignedById, name: t.assignedByName, avatar: null } : null);
    return o;
  };
}

// The two-way board: tasks where I'm the assignee OR the assigner.
async function buildBoard(viewerId, ctx) {
  const viewer = await HrUser.findByPk(viewerId);
  if (!viewer) return { error: 'Person not found.' };

  const tasks = await Task.findAll({
    where: { parentTaskId: null, [Op.or]: [{ assigneeId: viewerId }, { assignedById: viewerId }] },
    order: [['order', 'ASC'], ['id', 'ASC']],
  });
  const ids = tasks.map((t) => t.id);
  const subCounts = ids.length ? await Task.findAll({ attributes: ['parentTaskId', 'stage', [sequelize.fn('COUNT', sequelize.col('id')), 'n']], where: { parentTaskId: { [Op.in]: ids } }, group: ['parentTaskId', 'stage'], raw: true }) : [];
  const subBy = {};
  for (const r of subCounts) { const g = subBy[r.parentTaskId] || { total: 0, done: 0 }; g.total += Number(r.n); if (r.stage === 'completed') g.done += Number(r.n); subBy[r.parentTaskId] = g; }

  const people = await roster();
  const pById = Object.fromEntries(people.map((u) => [u.id, u]));
  const decorate = decorateWith(pById);

  const mine = [];
  const tracking = [];
  for (const t of tasks) {
    const o = decorate(t);
    const g = subBy[t.id]; o.subtaskCount = g ? g.total : 0; o.subtaskDone = g ? g.done : 0;
    if (t.assigneeId === viewerId) { o.relation = 'mine'; mine.push(o); }
    else if (t.assignedById === viewerId) { o.relation = 'tracking'; tracking.push(o); }
  }
  const buckets = BUCKETS.map((key) => ({ key, label: BUCKET_LABELS[key], tasks: mine.filter((t) => (t.bucket || 'recently_assigned') === key) }));

  return {
    viewer: { id: viewer.id, name: viewer.name, designation: viewer.designation || '', department: viewer.department || '', branch: viewer.branch || '', avatar: viewer.avatar || null },
    buckets, tracking, canManage: true,
  };
}

router.get('/my-board', guard, async (req, res, next) => {
  try {
    const ctx = await actingContext(req);
    if (ctx.actorUser) return res.json(await buildBoard(ctx.actorUser.id, ctx));
    const people = await roster();
    res.json({ adminNoBoard: true, people: people.map((u) => ({ id: u.id, name: u.name, designation: u.designation || '', department: u.department || '', branch: u.branch || '', avatar: u.avatar || null, type: u.type })) });
  } catch (e) { next(e); }
});

router.get('/board/:viewerId', guard, async (req, res, next) => {
  try {
    const ctx = await actingContext(req);
    const out = await buildBoard(Number(req.params.viewerId), ctx);
    if (out.error) return res.status(404).json(out);
    res.json(out);
  } catch (e) { next(e); }
});

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

router.get('/boards', guard, async (req, res, next) => {
  try {
    const people = await roster();
    const counts = await Task.findAll({ attributes: ['assigneeId', [sequelize.fn('COUNT', sequelize.col('id')), 'n']], where: { parentTaskId: null, stage: { [Op.ne]: 'completed' } }, group: ['assigneeId'], raw: true });
    const countBy = Object.fromEntries(counts.map((c) => [c.assigneeId, Number(c.n)]));
    res.json(people.map((u) => ({ id: u.id, name: u.name, designation: u.designation || '', department: u.department || '', branch: u.branch || '', avatar: u.avatar || null, type: u.type, taskCount: countBy[u.id] || 0 })));
  } catch (e) { next(e); }
});

router.post('/tasks', guard, async (req, res, next) => {
  try {
    const ctx = await actingContext(req);
    const b = req.body || {};
    const title = String(b.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Task title is required.' });

    let assigneeId = b.assigneeId ? Number(b.assigneeId) : (ctx.actorUser ? ctx.actorUser.id : null);
    if (!assigneeId) return res.status(400).json({ error: 'An assignee is required.' });

    const people = await roster();
    const target = people.find((u) => u.id === assigneeId);
    if (!target) return res.status(404).json({ error: 'Assignee not found.' });
    if (!canAssign(ctx.actorUser, target, ctx)) return res.status(403).json({ error: 'You can\u2019t assign a task to this person.' });

    let parentTaskId = b.parentTaskId ? Number(b.parentTaskId) : null;
    let boardOwnerId = assigneeId;
    let bucket = BUCKETS.includes(b.bucket) ? b.bucket : 'recently_assigned';
    if (parentTaskId) {
      const parent = await Task.findByPk(parentTaskId);
      if (!parent) return res.status(404).json({ error: 'Parent task not found.' });
      if (parent.parentTaskId) return res.status(400).json({ error: 'Subtasks can\u2019t have their own subtasks.' });
      boardOwnerId = parent.boardOwnerId;
      bucket = parent.bucket;
    }
    const isAssignedByOther = assigneeId !== ctx.actorId;
    // Honor an explicitly provided bucket (e.g. adding a task directly under a
    // section). Only when no bucket is given does an assigned-to-someone-else
    // task default into 'recently_assigned'.
    if (isAssignedByOther && !parentTaskId && !BUCKETS.includes(b.bucket)) bucket = 'recently_assigned';

    const max = await Task.max('order', { where: { assigneeId, bucket, parentTaskId: parentTaskId || null } });
    const row = await Task.create({
      boardOwnerId, bucket, parentTaskId, title,
      description: String(b.description || '').slice(0, 20000),
      assigneeId,
      priority: ['urgent', 'high', 'medium', 'low'].includes(b.priority) ? b.priority : 'medium',
      stage: ['not_started', 'in_progress', 'completed'].includes(b.stage) ? b.stage : 'not_started',
      dueDate: b.dueDate || null,
      order: (Number.isFinite(max) ? max : 0) + 1,
      createdById: ctx.actorId || null, createdByName: ctx.actorName, createdByKind: ctx.actorKind,
      assignedById: ctx.actorId || null, assignedByName: ctx.actorName,
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
    if (b.priority && ['urgent', 'high', 'medium', 'low'].includes(b.priority) && b.priority !== row.priority) { row.priority = b.priority; await logActivity(row.id, ctx, 'priority', 'priority \u2192 ' + b.priority); }
    if (b.dueDate !== undefined) row.dueDate = b.dueDate || null;
    if (Number.isFinite(b.order)) row.order = b.order;

    if (b.bucket && BUCKETS.includes(b.bucket) && b.bucket !== row.bucket) {
      row.bucket = b.bucket;
      await logActivity(row.id, ctx, 'section', 'moved to ' + BUCKET_LABELS[b.bucket]);
    }

    if (b.stage && ['not_started', 'in_progress', 'completed'].includes(b.stage) && b.stage !== row.stage) {
      row.stage = b.stage;
      row.completedAt = b.stage === 'completed' ? new Date() : null;
      await logActivity(row.id, ctx, b.stage === 'completed' ? 'completed' : 'stage', 'moved to ' + b.stage.replace('_', ' '));
    }

    if (b.assigneeId !== undefined && Number(b.assigneeId) !== row.assigneeId) {
      const newId = Number(b.assigneeId);
      const people = await roster();
      const target = people.find((u) => u.id === newId);
      if (!target) return res.status(404).json({ error: 'Assignee not found.' });
      if (!canAssign(ctx.actorUser, target, ctx)) return res.status(403).json({ error: 'You can\u2019t assign a task to this person.' });
      row.assigneeId = newId;
      if (!row.parentTaskId) { row.boardOwnerId = newId; row.bucket = 'recently_assigned'; }
      row.assignedById = ctx.actorId || null; row.assignedByName = ctx.actorName;
      await logActivity(row.id, ctx, 'assigned', 'assigned to ' + target.name);
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
    await Task.destroy({ where: { parentTaskId: row.id } });
    await TaskComment.destroy({ where: { taskId: row.id } });
    await TaskAttachment.destroy({ where: { taskId: row.id } });
    await TaskActivity.destroy({ where: { taskId: row.id } });
    await row.destroy();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

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
    const dec = decorateWith(pById);
    res.json({ task: dec(row), subtasks: subtasks.map(dec), comments: comments.map((c) => c.toJSON()), attachments: attachments.map((a) => a.toJSON()), activity: activity.map((a) => a.toJSON()) });
  } catch (e) { next(e); }
});

router.get('/tasks/:id', guard, async (req, res, next) => {
  try {
    const row = await Task.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Task not found.' });
    const people = await roster();
    const pById = Object.fromEntries(people.map((u) => [u.id, u]));
    res.json(decorateWith(pById)(row));
  } catch (e) { next(e); }
});

router.post('/tasks/:id/comments', guard, async (req, res, next) => {
  try {
    const ctx = await actingContext(req);
    const row = await Task.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Task not found.' });
    const body = String((req.body && req.body.body) || '').trim();
    if (!body) return res.status(400).json({ error: 'Note can\u2019t be empty.' });
    const c = await TaskComment.create({ taskId: row.id, authorId: ctx.actorId || null, authorName: ctx.actorName, body: body.slice(0, 5000) });
    res.status(201).json(c.toJSON());
  } catch (e) { next(e); }
});

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

module.exports = router;
module.exports.BUCKETS = BUCKETS;
module.exports.BUCKET_LABELS = BUCKET_LABELS;

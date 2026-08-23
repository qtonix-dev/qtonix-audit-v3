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
  Op, sequelize, HrUser, User, Task, TaskComment, TaskAttachment, TaskActivity, HrNotification,
} = require('../models');
const { requireHrAccess, requireHrAdmin } = require('../middleware/hrAuth');
const { canAssign } = require('../services/taskPermissions');

// Open to all HR users (and admins). Every person lands on their own board;
// per-user permission logic (canAssign, creator/admin delete) governs actions.
const ADMIN_ONLY = false;
const guard = ADMIN_ONLY ? [requireHrAccess, requireHrAdmin] : [requireHrAccess];

const BUCKETS = ['recently_assigned', 'today', 'tomorrow', 'next_week', 'later'];
const BUCKET_LABELS = { recently_assigned: 'Recently Assigned', today: 'Do Today', tomorrow: 'Do Tomorrow', next_week: 'Do Next Week', later: 'Do Later' };

async function actingContext(req) {
  const isAdmin = !!req.isHrAdmin || (req.hrActor && req.hrActor.kind === 'admin');
  let actorUser = null;
  if (req.hrUser) actorUser = req.hrUser;
  else if (req.hrActor && req.hrActor.kind === 'hr') actorUser = await HrUser.findByPk(req.hrActor.id);
  // The board identity. HR staff use their HrUser id (positive). A CRM admin has
  // no HrUser row, so they get a negative board id (-userId) that can never
  // collide with an HrUser id — this lets the admin own a real board + be an
  // assignee/assigner in the same integer columns.
  const rawId = req.hrActor && req.hrActor.id;
  const boardId = actorUser ? actorUser.id : (rawId ? -Math.abs(rawId) : null);
  return {
    isAdmin,
    isHr: isAdmin || (req.hrActor && req.hrActor.kind === 'hr'),
    actorUser,
    actorId: req.hrActor && req.hrActor.id,
    boardId,
    actorName: (req.hrActor && req.hrActor.name) || 'Admin',
    actorKind: (req.hrActor && req.hrActor.kind) || 'admin',
  };
}

// Resolve a display person for any board id (positive = HrUser, negative = admin).
async function personForBoardId(boardId, pById) {
  if (boardId == null) return null;
  if (boardId > 0) { const u = pById ? pById[boardId] : await HrUser.findByPk(boardId); return u ? { id: u.id, name: u.name, avatar: u.avatar || null, designation: u.designation || '' } : null; }
  const admin = await User.findByPk(Math.abs(boardId));
  return admin ? { id: boardId, name: admin.name, avatar: null, designation: 'Admin', isAdmin: true } : { id: boardId, name: 'Admin', avatar: null, designation: 'Admin', isAdmin: true };
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

function decorateWith(pById, adminById) {
  const resolve = (id, fallbackName) => {
    if (id == null) return null;
    if (id > 0) { const u = pById[id]; return u ? { id: u.id, name: u.name, avatar: u.avatar || null } : (fallbackName ? { id, name: fallbackName, avatar: null } : null); }
    const ad = adminById && adminById[id]; return { id, name: (ad && ad.name) || fallbackName || 'Admin', avatar: null, isAdmin: true };
  };
  return (t) => {
    const o = t.toJSON();
    o.assignee = resolve(t.assigneeId);
    o.assigner = resolve(t.assignedById, t.assignedByName);
    return o;
  };
}

// Build a small map of admin display names for any negative ids referenced.
async function adminMapFor(tasks, extraIds = []) {
  const negIds = new Set();
  for (const t of tasks) { if (t.assigneeId < 0) negIds.add(t.assigneeId); if (t.assignedById < 0) negIds.add(t.assignedById); }
  for (const id of extraIds) if (id != null && id < 0) negIds.add(id);
  const map = {};
  for (const nid of negIds) {
    const admin = await User.findByPk(Math.abs(nid));
    map[nid] = { id: nid, name: admin ? admin.name : 'Admin' };
  }
  return map;
}

// The two-way board: tasks where I'm the assignee OR the assigner. `viewerId`
// is a board id (positive HrUser, or negative admin).
async function buildBoard(viewerId, ctx) {
  let viewer;
  if (viewerId > 0) {
    const u = await HrUser.findByPk(viewerId);
    if (!u) return { error: 'Person not found.' };
    viewer = { id: u.id, name: u.name, designation: u.designation || '', department: u.department || '', branch: u.branch || '', avatar: u.avatar || null };
  } else {
    const admin = await User.findByPk(Math.abs(viewerId));
    viewer = { id: viewerId, name: admin ? admin.name : 'Admin', designation: 'Admin', department: '', branch: '', avatar: null, isAdmin: true };
  }

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
  const adminById = await adminMapFor(tasks, [viewerId]);
  const decorate = decorateWith(pById, adminById);

  // Pull the subtasks for the visible top-level tasks so the list can expand
  // them inline (fully editable), without a second round-trip per task.
  const subsAll = ids.length ? await Task.findAll({ where: { parentTaskId: { [Op.in]: ids } }, order: [['order', 'ASC'], ['id', 'ASC']] }) : [];
  const subsByParent = {};
  for (const s of subsAll) { (subsByParent[s.parentTaskId] = subsByParent[s.parentTaskId] || []).push(decorate(s)); }

  const mine = [];
  const tracking = [];
  const completed = [];
  for (const t of tasks) {
    const o = decorate(t);
    const g = subBy[t.id]; o.subtaskCount = g ? g.total : 0; o.subtaskDone = g ? g.done : 0;
    o.subtasks = subsByParent[t.id] || [];
    if (t.assigneeId === viewerId) {
      o.relation = 'mine';
      if (t.stage === 'completed') completed.push(o); else mine.push(o);
    } else if (t.assignedById === viewerId) {
      o.relation = 'tracking';
      // Completed delegated tasks move into the Completed section too, so
      // "Completed" holds everything finished — whether you did it or assigned it.
      if (t.stage === 'completed') completed.push(o); else tracking.push(o);
    }
  }
  const buckets = BUCKETS.map((key) => ({ key, label: BUCKET_LABELS[key], tasks: mine.filter((t) => (t.bucket || 'recently_assigned') === key) }));

  return { viewer, buckets, tracking, completed, canManage: true };
}

router.get('/my-board', guard, async (req, res, next) => {
  try {
    const ctx = await actingContext(req);
    // Everyone — including admin (negative boardId) — lands on their own board.
    return res.json(await buildBoard(ctx.boardId, ctx));
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
    const list = filtered.map((u) => ({ id: u.id, name: u.name, designation: u.designation || '', department: u.department || '', branch: u.branch || '', avatar: u.avatar || null, type: u.type }));
    // Admins have no HrUser row — add a "Me" entry (their negative board id) so
    // they can assign tasks to their own board.
    if (ctx.isAdmin && ctx.boardId < 0) {
      const me = { id: ctx.boardId, name: ctx.actorName + ' (me)', designation: 'Admin', department: '', branch: '', avatar: null, type: 'admin' };
      if (!q || me.name.toLowerCase().includes(q)) list.unshift(me);
    }
    res.json(list);
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

    // Default assignee = the actor's own board (admin uses negative boardId).
    let assigneeId = b.assigneeId ? Number(b.assigneeId) : ctx.boardId;
    if (!assigneeId) return res.status(400).json({ error: 'An assignee is required.' });

    // Validate the assignee. A negative id means an admin board (only the acting
    // admin may target their own board). A positive id is an HrUser, checked
    // against the hierarchy permission.
    const people = await roster();
    let targetName = '';
    if (assigneeId < 0) {
      if (!ctx.isAdmin || assigneeId !== ctx.boardId) return res.status(403).json({ error: 'You can’t assign a task to that board.' });
      targetName = ctx.actorName;
    } else {
      const target = people.find((u) => u.id === assigneeId);
      if (!target) return res.status(404).json({ error: 'Assignee not found.' });
      if (!canAssign(ctx.actorUser, target, ctx)) return res.status(403).json({ error: 'You can\u2019t assign a task to this person.' });
      targetName = target.name;
    }

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
    const isAssignedByOther = assigneeId !== ctx.boardId;
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
      assignedById: ctx.boardId || null, assignedByName: ctx.actorName,
    });
    await logActivity(row.id, ctx, 'created', parentTaskId ? 'created subtask' : 'created task');
    if (isAssignedByOther && assigneeId > 0) await notifyAssignee(assigneeId, ctx, row);
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
      let newName = '';
      if (newId < 0) {
        if (!ctx.isAdmin || newId !== ctx.boardId) return res.status(403).json({ error: 'You can’t assign a task to that board.' });
        newName = ctx.actorName;
      } else {
        const people = await roster();
        const target = people.find((u) => u.id === newId);
        if (!target) return res.status(404).json({ error: 'Assignee not found.' });
        if (!canAssign(ctx.actorUser, target, ctx)) return res.status(403).json({ error: 'You can\u2019t assign a task to this person.' });
        newName = target.name;
      }
      row.assigneeId = newId;
      if (!row.parentTaskId) { row.boardOwnerId = newId; row.bucket = 'recently_assigned'; }
      row.assignedById = ctx.boardId || null; row.assignedByName = ctx.actorName;
      await logActivity(row.id, ctx, 'assigned', 'assigned to ' + newName);
      if (newId > 0) await notifyAssignee(newId, ctx, row);
    }
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

router.delete('/tasks/:id', guard, async (req, res, next) => {
  try {
    const ctx = await actingContext(req);
    const row = await Task.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Task not found.' });
    // Only the task's creator or an admin may delete it.
    const isCreator = row.createdById != null && ctx.actorId != null && Number(row.createdById) === Number(ctx.actorId);
    if (!ctx.isAdmin && !isCreator) return res.status(403).json({ error: 'Only the task creator or an admin can delete this task.' });

    // Gather this task + all its subtasks, then remove their comments,
    // attachments, and activity, then the tasks themselves.
    const subs = await Task.findAll({ where: { parentTaskId: row.id }, attributes: ['id'] });
    const allIds = [row.id, ...subs.map((s) => s.id)];
    await TaskComment.destroy({ where: { taskId: { [Op.in]: allIds } } });
    await TaskAttachment.destroy({ where: { taskId: { [Op.in]: allIds } } });
    await TaskActivity.destroy({ where: { taskId: { [Op.in]: allIds } } });
    await Task.destroy({ where: { id: { [Op.in]: allIds } } });
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
    const adminById = await adminMapFor([row, ...subtasks]);
    const dec = decorateWith(pById, adminById);
    const ctx = await actingContext(req);
    const canDelete = !!ctx.isAdmin || (row.createdById != null && ctx.actorId != null && Number(row.createdById) === Number(ctx.actorId));
    res.json({ task: dec(row), subtasks: subtasks.map(dec), comments: comments.map((c) => c.toJSON()), attachments: attachments.map((a) => a.toJSON()), activity: activity.map((a) => a.toJSON()), canDelete });
  } catch (e) { next(e); }
});

router.get('/tasks/:id', guard, async (req, res, next) => {
  try {
    const row = await Task.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Task not found.' });
    const people = await roster();
    const pById = Object.fromEntries(people.map((u) => [u.id, u]));
    const adminById = await adminMapFor([row]);
    res.json(decorateWith(pById, adminById)(row));
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

// Upload a file to ImageKit then attach it (base64 body). Sensible defaults:
// common docs/images/pdf/zip, 10 MB cap, executables blocked.
const ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf', 'text/plain', 'text/csv',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip', 'application/x-zip-compressed',
]);
const BLOCKED_EXT = /\.(exe|bat|cmd|sh|msi|com|scr|js|jar|app|dll|deb|apk)$/i;
const MAX_BYTES = 10 * 1024 * 1024;

router.post('/tasks/:id/upload', guard, async (req, res, next) => {
  try {
    const ctx = await actingContext(req);
    const row = await Task.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Task not found.' });
    const b = req.body || {};
    const name = String(b.name || 'attachment').slice(0, 300);
    const mime = String(b.mime || '').slice(0, 120);
    const base64 = String(b.base64 || '');
    if (!base64) return res.status(400).json({ error: 'No file data.' });
    if (BLOCKED_EXT.test(name)) return res.status(400).json({ error: 'That file type isn’t allowed.' });
    if (mime && !ALLOWED_MIME.has(mime)) return res.status(400).json({ error: 'That file type isn’t supported.' });
    // Rough byte size from base64 length.
    const approxBytes = Math.floor((base64.length - (base64.indexOf(',') + 1)) * 3 / 4);
    if (approxBytes > MAX_BYTES) return res.status(400).json({ error: 'File is larger than the 10 MB limit.' });

    const imagekit = require('../services/imagekit');
    let up;
    try { up = await imagekit.uploadFile({ base64, fileName: name, folder: '/tasks/' + row.id }); }
    catch (e) { return res.status(400).json({ error: e.message || 'Upload failed.' }); }
    const a = await TaskAttachment.create({ taskId: row.id, url: up.url, name: up.name || name, mime, size: up.size || approxBytes, uploadedById: ctx.actorId || null });
    await logActivity(row.id, ctx, 'created', 'attached ' + (up.name || name));
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

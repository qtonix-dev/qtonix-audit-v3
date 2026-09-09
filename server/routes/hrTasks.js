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
const { canAssign, canViewBoard, viewableBoardIds } = require('../services/taskPermissions');

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
  // If an admin also has a matching HR profile (same email), act AS that Hr
  // profile so they don't appear twice (once as "(me)" admin board, once as
  // their HrUser). This unifies their identity across the task system.
  if (!actorUser && isAdmin && req.adminUser && req.adminUser.email) {
    try { const hr = await HrUser.findOne({ where: { email: req.adminUser.email, active: true, chatOnly: { [require('sequelize').Op.not]: true } } }); if (hr) actorUser = hr; } catch {}
  }
  const rawId = req.hrActor && req.hrActor.id;
  const boardId = actorUser ? actorUser.id : (rawId ? -Math.abs(rawId) : null);
  const HR_ROLE_TYPES = new Set(['hr', 'recruiter']);
  const isHr = isAdmin || !!(actorUser && (HR_ROLE_TYPES.has(actorUser.type) || actorUser.isHrManager));
  return {
    isAdmin,
    isHr,
    actorUser,
    actorId: req.hrActor && req.hrActor.id,
    boardId,
    actorName: (actorUser && actorUser.name) || (req.hrActor && req.hrActor.name) || 'Admin',
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
      meta: { taskId: task.id },
    });
  } catch { /* non-fatal */ }
  // Drop a card into the assignee's private #task chat (with a link to the task).
  try { if (assigneeId > 0) await require('../services/chatTask').postTaskAlert(assigneeId, { kindTag: 'task_assigned', taskId: task.id, body: `${ctx.actorName} assigned you a task: "${String(task.title).slice(0, 120)}"` }); } catch { /* non-fatal */ }
}

async function roster() {
  return HrUser.findAll({ where: { active: true }, attributes: ['id', 'name', 'type', 'department', 'branch', 'reportsToId', 'isHrManager', 'avatar', 'designation', 'active'], order: [['name', 'ASC']] });
}

// Reconcile a top-level task's assignee group to EXACTLY `desiredIds`.
// - The main `row` is never destroyed (keeps comments/activity/chain).
// - The main row's assigneeId is the "primary"; additional assignees each get a
//   linked copy on their own board sharing row.assigneeGroupId.
// - Adds create copies + notify; removes delete the extra copies; if the primary
//   is removed, another member is promoted into the main row (its copy deleted).
// Returns { ok, error } — validation failures are returned, not thrown.
async function reconcileAssignees(row, desiredIds, ctx) {
  const want = [...new Set((desiredIds || []).map(Number).filter((x) => x > 0 || x < 0))];
  if (!want.length) return { ok: false, error: 'A task needs at least one assignee.' };

  const people = await roster();
  const byId = Object.fromEntries(people.map((u) => [u.id, u]));
  // Validate each desired assignee (permission), except the actor's own board.
  for (const id of want) {
    if (id === ctx.boardId) continue;
    const target = byId[id];
    if (id > 0 && (!target || !canAssign(ctx.actorUser, target, ctx, people))) return { ok: false, error: 'You can’t assign a task to one of the selected people.' };
  }

  // SUBTASKS: multiple assignees are stored inline on the subtask row itself
  // (no board copies — a subtask lives under its parent, not on a board). The
  // primary assigneeId is the first in the list; the rest live in assigneeIds.
  if (row.parentTaskId) {
    const prev = new Set([row.assigneeId, ...((Array.isArray(row.assigneeIds) ? row.assigneeIds : []))].filter(Boolean));
    row.assigneeId = want[0];
    row.assigneeIds = want;
    row.changed('assigneeIds', true);
    await row.save();
    // Notify only the NEWLY added people.
    try { for (const id of want) { if (id > 0 && id !== ctx.boardId && !prev.has(id)) await notifyAssignee(id, ctx, row); } } catch {}
    return { ok: true };
  }

  const groupId = row.assigneeGroupId || (want.length > 1 ? `ag${row.id}` : null);
  const groupTasks = row.assigneeGroupId ? await Task.findAll({ where: { assigneeGroupId: row.assigneeGroupId } }) : [row];
  // Current membership: primary (main row) + each copy's assignee.
  const copies = groupTasks.filter((g) => g.id !== row.id);
  const currentIds = new Set([row.assigneeId, ...copies.map((c) => c.assigneeId)].filter(Boolean));
  const wantSet = new Set(want);

  // 1) Remove members no longer wanted.
  for (const id of [...currentIds]) {
    if (wantSet.has(id)) continue;
    if (id === row.assigneeId) {
      // Removing the primary: promote a remaining wanted member into the main row.
      const promoteId = want.find((w) => currentIds.has(w) && w !== id) || want[0];
      const promoteCopy = copies.find((c) => c.assigneeId === promoteId);
      row.assigneeId = promoteId; row.boardOwnerId = promoteId; row.bucket = 'recently_assigned';
      if (promoteCopy) await promoteCopy.destroy();
    } else {
      const copy = copies.find((c) => c.assigneeId === id);
      if (copy) await copy.destroy();
    }
    await logActivity(row.id, ctx, 'assigned', `removed ${(byId[id] && byId[id].name) || 'an assignee'}`);
  }

  // Re-read membership after removals.
  const afterRemove = new Set([row.assigneeId, ...(row.assigneeGroupId ? (await Task.findAll({ where: { assigneeGroupId: row.assigneeGroupId } })).map((c) => c.assigneeId) : [])].filter(Boolean));

  // 2) Add newly wanted members as copies on their boards.
  const toAdd = want.filter((id) => !afterRemove.has(id) && id > 0);
  if (toAdd.length && !row.assigneeGroupId) { row.assigneeGroupId = groupId || `ag${row.id}`; await row.save(); }
  for (const id of toAdd) {
    const emax = await Task.max('order', { where: { assigneeId: id, bucket: 'recently_assigned', parentTaskId: null } });
    const copy = await Task.create({
      boardOwnerId: id, bucket: row.bucket || 'recently_assigned', parentTaskId: null, title: row.title,
      description: row.description || '', assigneeId: id, assigneeGroupId: row.assigneeGroupId,
      // Inherit the main task's stage so a shared task keeps its status (a
      // completed task stays completed for everyone; it's the SAME task shared).
      priority: row.priority, stage: row.stage || 'not_started', completedAt: row.stage === 'completed' ? (row.completedAt || new Date()) : null,
      dueDate: row.dueDate || null,
      order: (Number.isFinite(emax) ? emax : 0) + 1,
      createdById: ctx.actorId || null, createdByName: ctx.actorName, createdByKind: ctx.actorKind,
      assignedById: ctx.boardId || null, assignedByName: ctx.actorName,
      origAssignedById: row.origAssignedById || ctx.boardId || null, origAssignedByName: row.origAssignedByName || ctx.actorName,
    });
    await logActivity(copy.id, ctx, 'created', 'created task');
    await notifyAssignee(id, ctx, copy);
    await logActivity(row.id, ctx, 'assigned', `added ${(byId[id] && byId[id].name) || 'an assignee'}`);
  }

  // Count the full group INCLUDING the main row. Only clear the group if a
  // single member remains (main row alone).
  let memberCount = 1;
  if (row.assigneeGroupId) { const grp = await Task.findAll({ where: { assigneeGroupId: row.assigneeGroupId }, attributes: ['id', 'assigneeId'] }); const ids = new Set([row.assigneeId, ...grp.map((g) => g.assigneeId)].filter(Boolean)); memberCount = ids.size; }
  if (memberCount <= 1) row.assigneeGroupId = null;

  // Track the original assigner so it stays in their "assigned by me".
  if (!row.origAssignedById && ctx.boardId && row.assigneeId !== ctx.boardId) { row.origAssignedById = ctx.boardId; row.origAssignedByName = ctx.actorName; }
  row.assignedById = row.origAssignedById || row.assignedById || (row.assigneeId !== ctx.boardId ? ctx.boardId : null);
  row.assignedByName = row.origAssignedByName || row.assignedByName || ctx.actorName;
  await row.save();
  return { ok: true };
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
    // Resolve all assignees (subtasks store extras in assigneeIds).
    const ids = new Set([t.assigneeId].filter(Boolean));
    if (Array.isArray(t.assigneeIds)) t.assigneeIds.forEach((id) => { if (id) ids.add(id); });
    const seen = new Set();
    o.assignees = [...ids].map((id) => resolve(id)).filter((a) => { if (!a) return false; const k = String(a.name || '').toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
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
    where: { parentTaskId: null, [Op.or]: [{ assigneeId: viewerId }, { assignedById: viewerId }, { origAssignedById: viewerId }] },
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

  // Batch-resolve multi-assignee groups so each task can show all its assignees.
  const groupIds = [...new Set(tasks.map((t) => t.assigneeGroupId).filter(Boolean))];
  const groupMembers = {}; // groupId -> [assigneeId,...]
  if (groupIds.length) {
    const grp = await Task.findAll({ where: { assigneeGroupId: { [Op.in]: groupIds } }, attributes: ['assigneeGroupId', 'assigneeId'] });
    for (const g of grp) { if (!g.assigneeId) continue; (groupMembers[g.assigneeGroupId] = groupMembers[g.assigneeGroupId] || new Set()).add(g.assigneeId); }
  }
  // Collapse duplicate identities by name (e.g. an admin "Sandeep" on a negative
  // board + an HrUser "Sandeep") so a person never shows twice.
  const dedupeByName = (arr) => {
    const seen = new Set(); const out = [];
    for (const a of arr) { if (!a) continue; const key = String(a.name || '').trim().toLowerCase(); if (seen.has(key)) continue; seen.add(key); out.push(a); }
    return out;
  };
  const assigneesFor = (t) => {
    const ids = new Set([t.assigneeId].filter(Boolean));
    // Subtasks store their extra assignees inline in assigneeIds.
    if (Array.isArray(t.assigneeIds)) t.assigneeIds.forEach((id) => { if (id) ids.add(id); });
    if (t.assigneeGroupId && groupMembers[t.assigneeGroupId]) groupMembers[t.assigneeGroupId].forEach((id) => ids.add(id));
    const list = [...ids].map((id) => { const u = pById[id]; return u ? { id: u.id, name: u.name, avatar: u.avatar || null } : (adminById[id] ? { id, name: adminById[id].name, avatar: null, isAdmin: true } : null); }).filter(Boolean);
    return dedupeByName(list);
  };

  const mine = [];
  const tracking = [];
  const completed = [];
  // Group tasks by their assignee-group so multi-assignee copies are treated as
  // ONE logical task. For each group we pick a single representative row and the
  // merged list of assignees.
  const groups = new Map(); // groupKey -> { rep, assigneeIds:Set, tasks:[] }
  const singles = [];
  for (const t of tasks) {
    if (t.assigneeGroupId) {
      const g = groups.get(t.assigneeGroupId) || { tasks: [], assigneeIds: new Set() };
      g.tasks.push(t); if (t.assigneeId) g.assigneeIds.add(t.assigneeId);
      groups.set(t.assigneeGroupId, g);
    } else singles.push(t);
  }

  const classify = (t, allAssignees) => {
    const o = decorate(t);
    o.assignees = allAssignees || assigneesFor(t);
    const sc = subBy[t.id]; o.subtaskCount = sc ? sc.total : 0; o.subtaskDone = sc ? sc.done : 0;
    o.subtasks = subsByParent[t.id] || [];
    const iAmAssigner = t.assignedById === viewerId || t.origAssignedById === viewerId;
    const iAmAssignee = t.assigneeId === viewerId;
    // Rule: if I ASSIGNED this task → it lives in "Assigned by me" (tracking),
    // shown once, even if I'm also one of the assignees. Otherwise, if it was
    // assigned TO me by someone else → it's on my own board.
    if (iAmAssigner) {
      o.relation = 'tracking';
      (t.stage === 'completed' ? completed : tracking).push(o);
    } else if (iAmAssignee) {
      o.relation = 'mine';
      (t.stage === 'completed' ? completed : mine).push(o);
    }
  };

  // Singles: classify directly.
  for (const t of singles) classify(t);

  // Groups: one representative row with all assignees merged.
  for (const [, g] of groups) {
    const people2 = await HrUser.findAll({ where: { id: { [Op.in]: [...g.assigneeIds].filter((x) => x > 0).length ? [...g.assigneeIds].filter((x) => x > 0) : [0] } }, attributes: ['id', 'name', 'avatar'] });
    const pMap = Object.fromEntries(people2.map((u) => [u.id, u]));
    const allAssignees = dedupeByName([...g.assigneeIds].map((id) => { const u = pMap[id]; return u ? { id: u.id, name: u.name, avatar: u.avatar || null } : (adminById[id] ? { id, name: adminById[id].name, avatar: null, isAdmin: true } : null); }).filter(Boolean));
    // Representative: the copy I assigned (my origAssignedById) OR the one I'm the
    // assignee of, whichever makes it appear in the right section. Prefer the
    // assigner-view so a task I delegated shows once under "Assigned by me".
    const iAssignedThis = g.tasks.some((t) => t.assignedById === viewerId || t.origAssignedById === viewerId);
    let rep;
    if (iAssignedThis) rep = g.tasks.find((t) => t.assignedById === viewerId || t.origAssignedById === viewerId) || g.tasks[0];
    else rep = g.tasks.find((t) => t.assigneeId === viewerId) || g.tasks[0];
    classify(rep, allAssignees);
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
    const targetId = Number(req.params.viewerId);
    // Authorize: own board always; otherwise only if the hierarchy permits it.
    if (targetId !== ctx.boardId) {
      const people = await roster();
      const target = people.find((u) => u.id === targetId);
      // Negative id = an admin's own board; only that admin may open it.
      if (targetId < 0) { if (targetId !== ctx.boardId) return res.status(403).json({ error: 'You can’t view this board.' }); }
      else if (!target || !canViewBoard(ctx.actorUser, target, people, ctx)) {
        return res.status(403).json({ error: 'You can’t view this board.' });
      }
    }
    const out = await buildBoard(targetId, ctx);
    if (out.error) return res.status(404).json(out);
    res.json(out);
  } catch (e) { next(e); }
});

router.get('/assignable', guard, async (req, res, next) => {
  try {
    const ctx = await actingContext(req);
    const people = await roster();
    const { isOwnPerson, isTopLeadOfDept } = require('../services/taskPermissions');
    let allowed = people.filter((u) => canAssign(ctx.actorUser, u, ctx, people));

    // Collapse cross-department reach to each department's TOP lead only: hide
    // TLs/sub-leads under a Project Manager for OTHER departments. Own team stays
    // fully visible. Admin/HR see everyone unchanged.
    const actor = ctx.actorUser;
    if (actor && !ctx.isAdmin && !ctx.isHr) {
      allowed = allowed.filter((u) => {
        if (isOwnPerson(actor, u, people)) return true;   // own team → keep all
        // cross-department: keep only the department's top lead
        return isTopLeadOfDept(u, people);
      });
    }

    const q = String(req.query.q || '').trim().toLowerCase();
    const filtered = q ? allowed.filter((u) => u.name.toLowerCase().includes(q) || (u.designation || '').toLowerCase().includes(q)) : allowed;

    // Order: own team first (alphabetical), then cross-department seniors
    // (alphabetical). Cross-department entries carry a deptLabel so the assigner
    // sees which department they're reaching into.
    const own = []; const cross = [];
    for (const u of filtered) {
      const entry = { id: u.id, name: u.name, designation: u.designation || '', department: u.department || '', branch: u.branch || '', avatar: u.avatar || null, type: u.type, own: actor ? isOwnPerson(actor, u, people) : true };
      (entry.own ? own : cross).push(entry);
    }
    const byName = (a, b) => a.name.localeCompare(b.name);
    own.sort(byName); cross.sort(byName);
    cross.forEach((e) => { e.deptLabel = e.department || 'Other'; });
    const list = [...own, ...cross];

    // Admins have no HrUser row, so add a "Me" entry (their negative board id)
    // so they can assign to their own board — BUT only if there isn't already an
    // HrUser with the same name (which would make it a confusing duplicate).
    if (ctx.isAdmin && ctx.boardId < 0) {
      const sameName = people.some((u) => u.name.trim().toLowerCase() === String(ctx.actorName).trim().toLowerCase());
      if (!sameName) {
        const me = { id: ctx.boardId, name: ctx.actorName + ' (me)', designation: 'Admin', department: '', branch: '', avatar: null, type: 'admin', own: true };
        if (!q || me.name.toLowerCase().includes(q)) list.unshift(me);
      }
    }
    res.json(list);
  } catch (e) { next(e); }
});

router.get('/boards', guard, async (req, res, next) => {
  try {
    const ctx = await actingContext(req);
    const people = await roster();
    // Only list boards this actor is allowed to view (own + downline; everyone
    // for HR/admin). This is what feeds the top "view another board" switcher.
    const viewable = people.filter((u) => canViewBoard(ctx.actorUser, u, people, ctx));
    const counts = await Task.findAll({ attributes: ['assigneeId', [sequelize.fn('COUNT', sequelize.col('id')), 'n']], where: { parentTaskId: null, stage: { [Op.ne]: 'completed' } }, group: ['assigneeId'], raw: true });
    const countBy = Object.fromEntries(counts.map((c) => [c.assigneeId, Number(c.n)]));
    res.json(viewable.map((u) => ({ id: u.id, name: u.name, designation: u.designation || '', department: u.department || '', branch: u.branch || '', avatar: u.avatar || null, type: u.type, taskCount: countBy[u.id] || 0 })));
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
      if (!canAssign(ctx.actorUser, target, ctx, people)) return res.status(403).json({ error: 'You can\u2019t assign a task to this person.' });
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
    // Multiple assignees: accept assigneeIds[] (primary is the first / assigneeId).
    let extraIds = Array.isArray(b.assigneeIds) ? b.assigneeIds.map(Number).filter((x) => x > 0 && x !== assigneeId) : [];
    extraIds = [...new Set(extraIds)];
    const row = await Task.create({
      boardOwnerId, bucket, parentTaskId, title,
      description: String(b.description || '').slice(0, 20000),
      assigneeId,
      assigneeIds: [assigneeId, ...extraIds].filter((x) => x > 0),
      priority: ['urgent', 'high', 'medium', 'low'].includes(b.priority) ? b.priority : 'medium',
      stage: ['not_started', 'in_progress', 'completed'].includes(b.stage) ? b.stage : 'not_started',
      dueDate: b.dueDate || null,
      order: (Number.isFinite(max) ? max : 0) + 1,
      createdById: ctx.actorId || null, createdByName: ctx.actorName, createdByKind: ctx.actorKind,
      assignedById: isAssignedByOther ? (ctx.boardId || null) : null, assignedByName: isAssignedByOther ? ctx.actorName : '',
      origAssignedById: isAssignedByOther ? (ctx.boardId || null) : null, origAssignedByName: isAssignedByOther ? ctx.actorName : '',
    });
    await logActivity(row.id, ctx, 'created', parentTaskId ? 'created subtask' : 'created task');
    if (isAssignedByOther && assigneeId > 0) await notifyAssignee(assigneeId, ctx, row);
    // Extra assignees: create a linked copy on each of their boards + notify.
    if (extraIds.length && !parentTaskId) {
      for (const aid of extraIds) {
        const target = people.find((u) => u.id === aid);
        if (!target || !canAssign(ctx.actorUser, target, ctx, people)) continue;
        const emax = await Task.max('order', { where: { assigneeId: aid, bucket: 'recently_assigned', parentTaskId: null } });
        const copy = await Task.create({
          boardOwnerId: aid, bucket: 'recently_assigned', parentTaskId: null, title,
          description: String(b.description || '').slice(0, 20000), assigneeId: aid,
          assigneeIds: [assigneeId, ...extraIds], assigneeGroupId: `ag${row.id}`,
          priority: row.priority, stage: 'not_started', dueDate: b.dueDate || null,
          order: (Number.isFinite(emax) ? emax : 0) + 1,
          createdById: ctx.actorId || null, createdByName: ctx.actorName, createdByKind: ctx.actorKind,
          assignedById: ctx.boardId || null, assignedByName: ctx.actorName,
          origAssignedById: ctx.boardId || null, origAssignedByName: ctx.actorName,
        });
        await logActivity(copy.id, ctx, 'created', 'created task');
        await notifyAssignee(aid, ctx, copy);
      }
      row.assigneeGroupId = `ag${row.id}`; await row.save();
    }
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
      // Notify the assignee in their #task chat (unless they made the change).
      try { if (row.assigneeId > 0 && row.assigneeId !== ctx.actorId) await require('../services/chatTask').postTaskAlert(row.assigneeId, { kindTag: 'task_status', taskId: row.id, body: `"${String(row.title).slice(0, 100)}" moved to ${b.stage.replace('_', ' ')}` }); } catch {}
    }

    // ---- Assignee changes (all routed through one consistent group reconcile) ----
    // Compute the DESIRED full list of assignees, then reconcile.
    let desired = null;
    if (Array.isArray(b.assigneeIds)) {
      desired = b.assigneeIds.map(Number).filter(Boolean);
    } else if (b.toggleAssignee !== undefined) {
      const pid = Number(b.toggleAssignee);
      let current;
      if (row.parentTaskId) {
        // Subtask: current assignees are stored inline.
        current = new Set([row.assigneeId, ...((Array.isArray(row.assigneeIds) ? row.assigneeIds : []))].filter(Boolean));
      } else {
        current = new Set([row.assigneeId, ...(row.assigneeGroupId ? (await Task.findAll({ where: { assigneeGroupId: row.assigneeGroupId }, attributes: ['assigneeId'] })).map((g) => g.assigneeId) : [])].filter(Boolean));
      }
      if (current.has(pid)) current.delete(pid); else current.add(pid);
      desired = [...current];
    } else if (b.assigneeId !== undefined) {
      // Single reassign = replace the whole group with just this person.
      const newId = Number(b.assigneeId);
      if (newId < 0 && (!ctx.isAdmin || newId !== ctx.boardId)) return res.status(403).json({ error: 'You can’t assign a task to that board.' });
      const prevAssigneeId = row.assigneeId;
      const prevName = (await roster()).find((u) => u.id === prevAssigneeId);
      // Record the pass-on chain when it changes hands.
      if (newId !== row.assigneeId) {
        try {
          const chain = Array.isArray(row.reassignChain) ? [...row.reassignChain] : [];
          const target = (await roster()).find((u) => u.id === newId);
          chain.push({ byId: ctx.boardId || ctx.actorId, byName: ctx.actorName, fromId: prevAssigneeId, fromName: prevName ? prevName.name : '', toId: newId, toName: target ? target.name : '', at: new Date().toISOString() });
          row.reassignChain = chain; row.changed('reassignChain', true);
        } catch {}
        // Reassigning a completed task makes it fresh work for the new person.
        if (row.stage === 'completed') { row.stage = 'not_started'; row.completedAt = null; }
      }
      desired = [newId];
    }
    if (desired) {
      const result = await reconcileAssignees(row, desired, ctx);
      if (!result.ok) return res.status(result.error && /at least one/.test(result.error) ? 400 : 403).json({ error: result.error });
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

    // Gather this task + all its subtasks + any multi-assignee GROUP copies,
    // then remove their comments, attachments, activity, chat cards and
    // notifications, then the tasks themselves.
    const subs = await Task.findAll({ where: { parentTaskId: row.id }, attributes: ['id'] });
    let groupCopies = [];
    if (row.assigneeGroupId) groupCopies = await Task.findAll({ where: { assigneeGroupId: row.assigneeGroupId }, attributes: ['id'] });
    const allIds = [...new Set([row.id, ...subs.map((s) => s.id), ...groupCopies.map((g) => g.id)])];
    await TaskComment.destroy({ where: { taskId: { [Op.in]: allIds } } });
    // Remove attached files from ImageKit before dropping the DB rows.
    const attachs = await TaskAttachment.findAll({ where: { taskId: { [Op.in]: allIds } } });
    if (attachs.length) {
      const ik = require('../services/imagekit');
      for (const at of attachs) { if (at.fileId) { try { await ik.deleteFile(at.fileId); } catch {} } }
    }
    await TaskAttachment.destroy({ where: { taskId: { [Op.in]: allIds } } });
    await TaskActivity.destroy({ where: { taskId: { [Op.in]: allIds } } });
    // Remove the linked #task chat cards (assignment/status alerts) so a deleted
    // task leaves no dangling "task deleted" cards in anyone's chat.
    try { const { ChatMessage } = require('../models'); if (ChatMessage) await ChatMessage.destroy({ where: { taskId: { [Op.in]: allIds } } }); } catch {}
    // Remove any task notifications that pointed at these tasks.
    try {
      const { HrNotification } = require('../models');
      if (HrNotification) {
        const notifs = await HrNotification.findAll({ where: { type: { [Op.in]: ['task_assigned', 'task_mention'] } } });
        const toDrop = notifs.filter((n) => n.meta && allIds.includes(Number(n.meta.taskId))).map((n) => n.id);
        if (toDrop.length) await HrNotification.destroy({ where: { id: { [Op.in]: toDrop } } });
      }
    } catch {}
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
    // Resolve the full assignee group (all people this task is assigned to).
    let assignees = [];
    try {
      const ids = new Set([row.assigneeId].filter(Boolean));
      if (row.assigneeGroupId) { const grp = await Task.findAll({ where: { assigneeGroupId: row.assigneeGroupId }, attributes: ['assigneeId'] }); grp.forEach((g) => { if (g.assigneeId) ids.add(g.assigneeId); }); }
      assignees = [...ids].map((id) => { const u = pById[id]; return u ? { id: u.id, name: u.name, avatar: u.avatar || null } : (adminById[id] ? { id, name: adminById[id].name, avatar: null, isAdmin: true } : null); }).filter(Boolean);
      // Collapse duplicate identities by name.
      const _seen = new Set(); assignees = assignees.filter((a) => { const k = String(a.name || '').trim().toLowerCase(); if (_seen.has(k)) return false; _seen.add(k); return true; });
    } catch {}
    const taskOut = dec(row); taskOut.assignees = assignees;
    res.json({ task: taskOut, subtasks: subtasks.map(dec), comments: comments.map((c) => c.toJSON()), attachments: attachments.map((a) => a.toJSON()), activity: activity.map((a) => a.toJSON()), canDelete });
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
    // @mentions in the note: notify tagged people + drop a card in their #task chat.
    try {
      const names = [...body.matchAll(/@([A-Za-z][A-Za-z .'-]{1,60})/g)].map((m) => m[1].trim());
      if (names.length) {
        const all = await HrUser.findAll({ where: { active: true }, attributes: ['id', 'name'] });
        const notified = new Set();
        for (const nm of names) {
          const cand = all.filter((u) => nm.toLowerCase().startsWith(u.name.toLowerCase()) || u.name.toLowerCase().startsWith(nm.toLowerCase()));
          const best = cand.sort((a, b2) => b2.name.length - a.name.length)[0];
          if (best && !notified.has(best.id) && best.id !== ctx.actorId) {
            notified.add(best.id);
            try { await HrNotification.create({ userId: best.id, actorKind: 'hr', type: 'task_mention', text: `\uD83D\uDCAC ${ctx.actorName} mentioned you in a task note: "${String(row.title).slice(0, 60)}"` }); } catch {}
            try { await require('../services/chatTask').postTaskAlert(best.id, { kindTag: 'task_status', taskId: row.id, body: `${ctx.actorName} mentioned you: "${body.slice(0, 100)}"` }); } catch {}
          }
        }
      }
    } catch {}
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
    const a = await TaskAttachment.create({ taskId: row.id, url: up.url, fileId: up.fileId || null, name: up.name || name, mime, size: up.size || approxBytes, uploadedById: ctx.actorId || null });
    await logActivity(row.id, ctx, 'created', 'attached ' + (up.name || name));
    res.status(201).json(a.toJSON());
  } catch (e) { next(e); }
});

router.delete('/attachments/:id', guard, async (req, res, next) => {
  try {
    const a = await TaskAttachment.findByPk(req.params.id);
    if (!a) return res.status(404).json({ error: 'Attachment not found.' });
    if (a.fileId) { try { await require('../services/imagekit').deleteFile(a.fileId); } catch {} }
    await a.destroy();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.BUCKETS = BUCKETS;
module.exports.BUCKET_LABELS = BUCKET_LABELS;

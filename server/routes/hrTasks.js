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
  Op, sequelize, HrUser, User, Task, TaskComment, TaskAttachment, TaskActivity, HrNotification, HrDayNote, HrTeamReview,
} = require('../models');
const { requireHrAccess, requireHrAdmin } = require('../middleware/hrAuth');
const { canAssign, canViewBoard, viewableBoardIds } = require('../services/taskPermissions');
const teamReport = require('../services/teamReport');
const teamReviewAi = require('../services/teamReviewAi');

// Open to all HR users (and admins). Every person lands on their own board;
// per-user permission logic (canAssign, creator/admin delete) governs actions.
const ADMIN_ONLY = false;
const guard = ADMIN_ONLY ? [requireHrAccess, requireHrAdmin] : [requireHrAccess];

const BUCKETS = ['recently_assigned', 'today', 'tomorrow', 'later'];
const BUCKET_LABELS = { recently_assigned: 'Recently Assigned', today: 'Do Today', tomorrow: 'Do Tomorrow', later: 'Do Later' };
// The task workflow statuses (kanban columns), in order.
const STAGES = ['not_started', 'in_progress', 'pending_review', 'changes_requested', 'pending_approval', 'completed', 'on_hold'];
const STAGE_LABEL = {
  not_started: 'Not Started', in_progress: 'In Progress', pending_review: 'Pending Review',
  changes_requested: 'Changes Requested', pending_approval: 'Pending Approval', completed: 'Completed', on_hold: 'On Hold',
};
// Statuses during which the work timer should be RUNNING (actively worked on).
const TIMER_ACTIVE_STAGES = ['in_progress', 'changes_requested'];

async function actingContext(req) {
  const isAdmin = !!req.isHrAdmin || (req.hrActor && req.hrActor.kind === 'admin');
  let actorUser = null;
  if (req.hrUser) actorUser = req.hrUser;
  else if (req.hrActor && req.hrActor.kind === 'hr') actorUser = await HrUser.findByPk(req.hrActor.id);
  // If an admin also has a matching HR profile, act AS that HR profile so they
  // have ONE unified board (not a separate negative-id admin board + an HR board).
  // Match by email first, then fall back to an exact name match — because the
  // admin account and their HR profile often have different email addresses.
  if (!actorUser && isAdmin) {
    try {
      const { Op } = require('sequelize');
      let hr = null;
      if (req.adminUser && req.adminUser.email) hr = await HrUser.findOne({ where: { email: req.adminUser.email, active: true, chatOnly: { [Op.not]: true } } });
      if (!hr) {
        const nm = (req.adminUser && req.adminUser.name) || (req.hrActor && req.hrActor.name);
        if (nm) {
          const matches = await HrUser.findAll({ where: { active: true, chatOnly: { [Op.not]: true } } });
          hr = matches.find((u) => String(u.name || '').trim().toLowerCase() === String(nm).trim().toLowerCase()) || null;
        }
      }
      if (hr) actorUser = hr;
    } catch {}
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
    adminUserId: (req.adminUser && req.adminUser.id) || (isAdmin && req.hrActor && req.hrActor.id) || null,
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
// SHARED-TASK model: a task is a SINGLE row. Multiple assignees all share that
// one row (via assigneeIds), so status/priority/bucket/completion are the same
// for everyone automatically — no per-person copies. This applies to both top-
// level tasks and subtasks.
async function reconcileAssignees(row, desiredIds, ctx) {
  const want = [...new Set((desiredIds || []).map(Number).filter((x) => x > 0 || x < 0))];
  if (!want.length) return { ok: false, error: 'A task needs at least one assignee.' };

  const people = await roster();
  const byId = Object.fromEntries(people.map((u) => [u.id, u]));

  // Current assignees on the task.
  const current = new Set([row.assigneeId, ...((Array.isArray(row.assigneeIds) ? row.assigneeIds : []))].filter(Boolean));
  const wantSet = new Set(want);
  const toAdd = want.filter((id) => !current.has(id));

  // Only validate NEWLY-added people against the permission rules — never re-check
  // people already on the task (that could reject the whole edit and silently
  // drop assignees). The actor's own board is always allowed.
  for (const id of toAdd) {
    if (id === ctx.boardId) continue;
    const target = byId[id];
    if (id > 0 && (!target || !canAssign(ctx.actorUser, target, ctx, people))) {
      return { ok: false, error: `You can’t assign this task to ${(target && target.name) || 'that person'}.` };
    }
  }

  // Set the shared assignee list. Primary = first in the list (kept stable when
  // possible so the existing owner stays primary).
  const primary = want.includes(row.assigneeId) ? row.assigneeId : want[0];
  const ordered = [primary, ...want.filter((id) => id !== primary)];
  row.assigneeId = primary;
  row.assigneeIds = ordered;
  row.changed('assigneeIds', true);
  // Keep boardOwnerId = primary for legacy single-owner queries/compat.
  if (!row.parentTaskId) row.boardOwnerId = primary;

  // Preserve the original assigner so the task stays in their "assigned by me".
  if (!row.origAssignedById && ctx.boardId && !current.has(ctx.boardId)) { row.origAssignedById = ctx.boardId; row.origAssignedByName = ctx.actorName; }
  row.assignedById = row.origAssignedById || row.assignedById || (primary !== ctx.boardId ? ctx.boardId : null);
  row.assignedByName = row.origAssignedByName || row.assignedByName || ctx.actorName;
  // Group id no longer needed in the shared model, but keep for any legacy rows.
  row.assigneeGroupId = null;
  await row.save();

  // Log + notify only the newly added people.
  for (const id of toAdd) {
    if (id > 0 && id !== ctx.boardId) { try { await notifyAssignee(id, ctx, row); } catch {} await logActivity(row.id, ctx, 'assigned', `added ${(byId[id] && byId[id].name) || 'an assignee'}`); }
  }
  // Log removed people.
  for (const id of current) { if (!wantSet.has(id)) await logActivity(row.id, ctx, 'assigned', `removed ${(byId[id] && byId[id].name) || 'an assignee'}`); }
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

  // Build the set of ALL ids that represent this viewer, so a task assigned to
  // any of their identities shows up. This fixes the case where someone is added
  // as a co-assignee under one identity (e.g. an HrUser record) but their board
  // resolves to another (admin dual-identity, same-name/email duplicate HrUser,
  // or a legacy CRM-user id). Matches by id, and by same email / same name.
  const myIds = new Set([viewerId].filter((x) => x != null));
  try {
    const { Op } = require('sequelize');
    let selfHr = viewerId > 0 ? await HrUser.findByPk(viewerId) : null;
    const nm = (selfHr && selfHr.name) || (viewer && viewer.name);
    const em = (selfHr && selfHr.email) || (ctx.actorUser && ctx.actorUser.email) || null;
    const dups = await HrUser.findAll({ where: { active: true } });
    for (const u of dups) {
      const sameName = nm && String(u.name || '').trim().toLowerCase() === String(nm).trim().toLowerCase();
      const sameEmail = em && u.email && String(u.email).trim().toLowerCase() === String(em).trim().toLowerCase();
      if (sameName || sameEmail) myIds.add(u.id);
    }
    // Include the linked admin/CRM user id (positive) so legacy rows match too.
    if (ctx.actorId) myIds.add(ctx.actorId);
    if (ctx.adminUserId) myIds.add(ctx.adminUserId);
  } catch {}
  const isMe = (id) => id != null && myIds.has(id);
  const anyMine = (arr) => Array.isArray(arr) && arr.some((id) => myIds.has(id));

  // A viewer sees a top-level task if they are: the (primary) assignee, a
  // co-assignee (in assigneeIds), or the assigner. assigneeIds is JSON so we
  // fetch the candidate set and filter membership in JS (portable across DBs).
  const dbTasks = await Task.findAll({
    where: { parentTaskId: null, [Op.or]: [{ assigneeId: { [Op.in]: [...myIds] } }, { assignedById: { [Op.in]: [...myIds] } }, { origAssignedById: { [Op.in]: [...myIds] } }] },
    order: [['order', 'ASC'], ['id', 'ASC']],
  });
  // Fetch top-level tasks that HAVE a multi-assignee list, to catch shared tasks
  // where the viewer is a co-assignee but not the primary/assigner.
  const seenIds = new Set(dbTasks.map((t) => t.id));
  const sharedCand = await Task.findAll({ where: { parentTaskId: null, assigneeIds: { [Op.ne]: null } }, order: [['order', 'ASC'], ['id', 'ASC']] });
  for (const t of sharedCand) {
    if (seenIds.has(t.id)) continue;
    if (anyMine(t.assigneeIds)) { dbTasks.push(t); seenIds.add(t.id); }
  }
  const tasks = dbTasks;
  // Also surface SUBTASKS the viewer is (co-)assigned to whose PARENT they don't
  // already have on their board — so a subtask co-assignee still sees their work.
  const parentIdSet = new Set(tasks.map((t) => t.id));
  const allSubs = await Task.findAll({ where: { parentTaskId: { [Op.ne]: null } } });
  const myOrphanSubs = allSubs.filter((s) => {
    if (parentIdSet.has(s.parentTaskId)) return false; // parent already shown → subtask nests under it
    return isMe(s.assigneeId) || anyMine(s.assigneeIds);
  });
  // Pull parent titles for labelling.
  const parentIds = [...new Set(myOrphanSubs.map((s) => s.parentTaskId))];
  const parents = parentIds.length ? await Task.findAll({ where: { id: { [Op.in]: parentIds } }, attributes: ['id', 'title'] }) : [];
  const parentTitleById = Object.fromEntries(parents.map((p) => [p.id, p.title]));
  // Treat these orphan subtasks like top-level tasks on this board.
  myOrphanSubs.forEach((s) => { s._parentTitle = parentTitleById[s.parentTaskId] || ''; });
  tasks.push(...myOrphanSubs);
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
  const classify = (t) => {
    const o = decorate(t);
    if (t._parentTitle) { o.parentTitle = t._parentTitle; o.isSubtaskOnBoard = true; }
    o.assignees = assigneesFor(t);
    const sc = subBy[t.id]; o.subtaskCount = sc ? sc.total : 0; o.subtaskDone = sc ? sc.done : 0;
    o.subtasks = subsByParent[t.id] || [];
    const iAmAssigner = isMe(t.assignedById) || isMe(t.origAssignedById);
    const iAmAssignee = isMe(t.assigneeId) || anyMine(t.assigneeIds);
    // If I'm an ASSIGNEE (or co-assignee), the shared task is on MY board — even
    // if I also assigned it (I share responsibility). Only if I purely assigned
    // it to others (not myself) does it live in "Assigned by me" (tracking).
    if (iAmAssignee) {
      o.relation = 'mine';
      (t.stage === 'completed' ? completed : mine).push(o);
    } else if (iAmAssigner) {
      o.relation = 'tracking';
      (t.stage === 'completed' ? completed : tracking).push(o);
    }
  };
  for (const t of tasks) classify(t);
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

// Compact task summary for the dashboard nudge + logout summary.
router.get('/my-summary', guard, async (req, res, next) => {
  try {
    const ctx = await actingContext(req);
    const viewerId = ctx.boardId;
    // Match all of the viewer's identities (same as the board) so co-assigned
    // tasks added under a different identity still count.
    const myIds = new Set([viewerId, ctx.actorId, ctx.adminUserId].filter((x) => x != null));
    try {
      const selfHr = viewerId > 0 ? await HrUser.findByPk(viewerId) : null;
      const nm = (selfHr && selfHr.name) || ctx.actorName;
      const em = (selfHr && selfHr.email) || (ctx.actorUser && ctx.actorUser.email) || null;
      const dups = await HrUser.findAll({ where: { active: true } });
      for (const u of dups) { if ((nm && String(u.name || '').trim().toLowerCase() === String(nm).trim().toLowerCase()) || (em && u.email && String(u.email).trim().toLowerCase() === String(em).trim().toLowerCase())) myIds.add(u.id); }
    } catch {}
    const ist = new Date(Date.now() + 330 * 60000);
    const today = ist.toISOString().slice(0, 10);
    // All my (co-)assigned top-level tasks.
    const dbTasks = await Task.findAll({ where: { parentTaskId: null } });
    const mine = dbTasks.filter((t) => myIds.has(t.assigneeId) || (Array.isArray(t.assigneeIds) && t.assigneeIds.some((id) => myIds.has(id))));
    let dueToday = 0, highPriority = 0, pending = 0, overdue = 0, completedToday = 0, totalToday = 0;
    for (const t of mine) {
      if (t.stage === 'completed') {
        const cd = t.completedAt ? new Date(new Date(t.completedAt).getTime() + 330 * 60000).toISOString().slice(0, 10) : '';
        if (cd === today) { completedToday++; totalToday++; }
        continue;
      }
      pending++;
      if (['urgent', 'high'].includes(t.priority)) highPriority++;
      const due = t.dueDate ? String(t.dueDate).slice(0, 10) : (t.bucket === 'today' ? today : '');
      if (due && due === today) { dueToday++; totalToday++; }
      if (due && due < today) overdue++;
    }
    // Progress = tasks completed today out of everything that was on today's plate.
    const pct = totalToday > 0 ? Math.round((completedToday / totalToday) * 100) : (pending === 0 ? 100 : 0);
    res.json({ dueToday, highPriority, pending, overdue, completedToday, totalToday, pct });
  } catch (e) { next(e); }
});

// ===========================================================================
// TEAM DAY-END REPORTS
// ===========================================================================

// Resolve the acting HrUser id for report scoping (admins act on their linked
// HrUser; if none, admins see everyone via a sentinel).
async function reportActor(req) {
  const ctx = await actingContext(req);
  const isAdmin = req.hrActor && req.hrActor.kind === 'admin';
  return { id: ctx.boardId, name: ctx.actorName, isAdmin };
}

// List the dates that have any activity for this senior's team (or, for an
// admin, the whole org), newest first, with present/absent counts + AI verdict.
router.get('/team-report/dates', guard, async (req, res, next) => {
  try {
    const actor = await reportActor(req);
    const days = Math.min(60, Number(req.query.days) || 21);
    const today = teamReport.istDateStr();
    const out = [];
    // Resolve the roster ONCE (admins: whole org; others: their team).
    let roster;
    if (actor.isAdmin) {
      const { HrUser } = require('../models');
      roster = await HrUser.findAll({ where: { active: true, chatOnly: { [Op.not]: true } } });
    } else {
      roster = await teamReport.teamOf(actor.id);
    }
    const empIds = roster.map((e) => e.id);
    // Preload cached verdicts for the whole window in one query.
    const seniorKey = actor.isAdmin ? 0 : actor.id;
    const cachedRows = await HrTeamReview.findAll({ where: { seniorId: seniorKey } });
    const verdictByDate = Object.fromEntries(cachedRows.map((r) => [r.date, r.dayVerdict]));
    for (let i = 0; i < days; i++) {
      const d = new Date(new Date(today + 'T00:00:00Z').getTime() - i * 86400000).toISOString().slice(0, 10);
      // Lightweight counts only (no per-task assembly, no AI).
      const cache = await teamReport.loadDayCache(empIds, d);
      const counts = await teamReport.dayCounts(roster, d, cache);
      if (counts.present + counts.absent === 0 || !roster.length) { if (i === 0) out.push({ date: d, present: 0, absent: 0, empty: !roster.length }); continue; }
      // "empty" day (nobody marked + no tasks) — only surface today so the list isn't blank.
      const anyActivity = counts.present > 0 || counts.totalPlanned > 0 || Object.values(cache.attByEmp).length > 0;
      if (!anyActivity && i !== 0) continue;
      out.push({ date: d, present: counts.present, absent: counts.absent, totalDone: counts.totalDone, totalPlanned: counts.totalPlanned, verdict: verdictByDate[d] || null, departments: actor.isAdmin ? new Set(roster.map((e) => e.department || 'Unassigned')).size : undefined });
    }
    const hasTeam = actor.isAdmin ? true : (roster && roster.length > 0);
    res.json({ dates: out, hasTeam, isAdmin: actor.isAdmin });
  } catch (e) { next(e); }
});

// Full detail for one date. ?employee=<id> filters to a single report.
// ?department=<name> filters admin view. Runs (or reuses cached) Claude review.
router.get('/team-report/:date', guard, async (req, res, next) => {
  try {
    const actor = await reportActor(req);
    const date = String(req.params.date).slice(0, 10);
    const employeeId = req.query.employee ? Number(req.query.employee) : null;

    // ----- ADMIN: department-grouped org-wide view -----
    if (actor.isAdmin) {
      const adminDay = await teamReport.buildAdminDay(date, { employeeId, department: req.query.department || null });
      // One shared AI review for the whole org day (cached under a sentinel id 0).
      const flat = { date, employees: adminDay.departments.flatMap((g) => g.employees), totalDone: adminDay.departments.reduce((s, g) => s + g.totalDone, 0), totalPlanned: adminDay.departments.reduce((s, g) => s + g.employees.reduce((a, e) => a + e.counts.total, 0), 0) };
      let review = null;
      if (flat.employees.length) {
        const fp = teamReport.dayFingerprint(flat);
        let cached = await HrTeamReview.findOne({ where: { seniorId: 0, date } });
        if (!cached || cached.fingerprint !== fp || req.query.refresh) {
          const r = await teamReviewAi.reviewTeamDay(flat);
          await HrTeamReview.upsert({ seniorId: 0, date, dayVerdict: r.dayVerdict, daySummary: r.daySummary, perEmployee: r.perEmployee, perTask: r.perTask, fingerprint: fp });
          cached = await HrTeamReview.findOne({ where: { seniorId: 0, date } });
        }
        review = cached ? { dayVerdict: cached.dayVerdict, daySummary: cached.daySummary, perEmployee: cached.perEmployee || {}, perTask: cached.perTask || {} } : null;
      }
      if (review) {
        for (const g of adminDay.departments) for (const e of g.employees) {
          const ev = review.perEmployee[e.employee.id] || review.perEmployee[String(e.employee.id)] || {};
          e.aiVerdict = ev.verdict || null; e.aiSummary = ev.summary || '';
          for (const t of e.tasks) { const tv = review.perTask[t.id] || review.perTask[String(t.id)] || {}; t.aiPace = tv.pace || null; t.aiReason = tv.reason || ''; }
        }
      }
      return res.json({ date, admin: true, departments: adminDay.departments, dayVerdict: review ? review.dayVerdict : null, daySummary: review ? review.daySummary : '' });
    }

    // ----- SENIOR: their team -----
    const todayStr = teamReport.istDateStr();
    // Fast path: for a PAST day we have a stored snapshot, serve it directly
    // (no live re-assembly, no AI call) unless a refresh is forced.
    if (date < todayStr && !employeeId && !req.query.refresh) {
      const snap = await HrTeamReview.findOne({ where: { seniorId: actor.id, date } });
      if (snap && snap.snapshot) {
        return res.json({ ...snap.snapshot, dayVerdict: snap.dayVerdict, daySummary: snap.daySummary, cached: true });
      }
    }
    const day = await teamReport.buildTeamDay(actor.id, date, employeeId ? { employeeId } : {});
    let review = null;
    if (day.employees.length) {
      const fp = teamReport.dayFingerprint(await teamReport.buildTeamDay(actor.id, date, {}));
      let cached = await HrTeamReview.findOne({ where: { seniorId: actor.id, date } });
      if (!cached || cached.fingerprint !== fp || req.query.refresh) {
        const full = await teamReport.buildTeamDay(actor.id, date, {});
        const r = await teamReviewAi.reviewTeamDay(full);
        await HrTeamReview.upsert({ seniorId: actor.id, date, dayVerdict: r.dayVerdict, daySummary: r.daySummary, perEmployee: r.perEmployee, perTask: r.perTask, fingerprint: fp });
        cached = await HrTeamReview.findOne({ where: { seniorId: actor.id, date } });
      }
      review = cached ? { dayVerdict: cached.dayVerdict, daySummary: cached.daySummary, perEmployee: cached.perEmployee || {}, perTask: cached.perTask || {} } : null;
    }
    if (review) {
      for (const e of day.employees) {
        const ev = review.perEmployee[e.employee.id] || review.perEmployee[String(e.employee.id)] || {};
        e.aiVerdict = ev.verdict || null; e.aiSummary = ev.summary || '';
        for (const t of e.tasks) { const tv = review.perTask[t.id] || review.perTask[String(t.id)] || {}; t.aiPace = tv.pace || null; t.aiReason = tv.reason || ''; }
      }
    }
    const out = { ...day, dayVerdict: review ? review.dayVerdict : null, daySummary: review ? review.daySummary : '' };
    // Persist a snapshot for past days so subsequent loads are instant.
    if (date < todayStr && !employeeId) { try { await HrTeamReview.update({ snapshot: out }, { where: { seniorId: actor.id, date } }); } catch {} }
    res.json(out);
  } catch (e) { next(e); }
});

// ADMIN: export a date's org-wide report to Excel (.xlsx). Admin-only.
router.get('/team-report/:date/export', guard, async (req, res, next) => {
  try {
    const actor = await reportActor(req);
    if (!actor.isAdmin) return res.status(403).json({ error: 'Only an admin can export reports.' });
    const date = String(req.params.date).slice(0, 10);
    const adminDay = await teamReport.buildAdminDay(date, { department: req.query.department || null });
    const cached = await HrTeamReview.findOne({ where: { seniorId: 0, date } });
    const perTask = (cached && cached.perTask) || {};

    const XLSX = require('xlsx');
    const rows = [];
    for (const g of adminDay.departments) {
      for (const e of g.employees) {
        const a = e.attendance;
        if (!e.tasks.length) {
          rows.push({ Date: date, Department: g.department, Employee: e.employee.name, Designation: e.employee.designation || '', Attendance: a.present ? 'Present' : 'Absent', Login: a.loginTime || '', Logout: a.logoutTime || '', Hours: a.hoursLabel || '', Task: '(no tasks)', Status: '', 'Time Taken': '', 'AI Pace': '', Note: e.note || '' });
          continue;
        }
        for (const t of e.tasks) {
          const pace = (perTask[t.id] || perTask[String(t.id)] || {}).pace || '';
          rows.push({ Date: date, Department: g.department, Employee: e.employee.name, Designation: e.employee.designation || '', Attendance: a.present ? 'Present' : 'Absent', Login: a.loginTime || '', Logout: a.logoutTime || '', Hours: a.hoursLabel || '', Task: t.title, Status: STAGE_LABEL[t.stage] || t.stage, 'Time Taken': t.timeLabel || '', 'AI Pace': pace, Note: e.note || '' });
        }
      }
    }
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Date: date, Note: 'No data for this date' }]);
    ws['!cols'] = [{ wch: 11 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 10 }, { wch: 7 }, { wch: 7 }, { wch: 8 }, { wch: 34 }, { wch: 13 }, { wch: 11 }, { wch: 9 }, { wch: 40 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Day-End Report');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="team-report-${date}.xlsx"`);
    res.send(buf);
  } catch (e) { next(e); }
});

// Employee's own report (self only, soft framing, includes their logout note,
// hides senior flags). date defaults to today.
router.get('/my-report/:date?', guard, async (req, res, next) => {
  try {
    const ctx = await actingContext(req);
    const date = req.params.date ? String(req.params.date).slice(0, 10) : teamReport.istDateStr();
    const emp = await HrUser.findByPk(ctx.boardId);
    if (!emp) return res.json({ date, self: true, tasks: [] });
    const slice = await teamReport.buildEmployeeDay(emp, date, {});
    // Strip senior-only signals from the self view.
    slice.tasks = slice.tasks.map((t) => { const { seniorFlag, seniorFlagNote, ...rest } = t; return rest; });
    // A gentle, self-directed insight (uses cached team review if the senior's
    // ran, else a light heuristic line — never harsh, never comparative).
    let aiSummary = '';
    try {
      if (emp.reportsToId) {
        const cached = await HrTeamReview.findOne({ where: { seniorId: emp.reportsToId, date } });
        if (cached && cached.perEmployee) { const ev = cached.perEmployee[emp.id] || cached.perEmployee[String(emp.id)]; if (ev && ev.summary) aiSummary = ev.summary; }
      }
    } catch {}
    if (!aiSummary) {
      const done = slice.counts.done, total = slice.counts.total;
      if (total === 0) aiSummary = 'No tasks logged yet today — add a few to track your progress.';
      else if (done === total) aiSummary = `You cleared all ${total} of today's tasks. Excellent momentum — keep it going! 💪`;
      else if (done > 0) aiSummary = `Nice progress — ${done} of ${total} done. A steady finish tomorrow will clear the rest.`;
      else aiSummary = 'A fresh set of tasks today — pick one and get the ball rolling. You\u2019ve got this!';
    }
    res.json({ date, self: true, ...slice, aiSummary });
  } catch (e) { next(e); }
});

// Senior marks a task Completed / Not Done from the report. "Not Done" sets the
// senior-only need_update flag, records a note, posts it to the task, and
// notifies the employee. "Completed" clears any flag.
router.post('/:id/senior-review', guard, async (req, res, next) => {
  try {
    const ctx = await actingContext(req);
    const row = await Task.findByPk(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Task not found' });
    const verdict = String(req.body.verdict || '').toLowerCase(); // 'completed' | 'not_done'
    const note = String(req.body.note || '').trim();

    if (verdict === 'not_done') {
      // "Not Done" now moves the task to the real "Changes Requested" status
      // (visible to the employee) rather than a hidden flag. Timer runs there.
      const now = new Date();
      const wasActive = TIMER_ACTIVE_STAGES.includes(row.stage);
      // changes_requested is an active-timer stage: open a segment if none.
      if (!wasActive) { if (!row.startedAt) row.startedAt = now; row.workSegStart = now; }
      row.stage = 'changes_requested';
      row.completedAt = null;
      row.seniorFlagNote = note || null;
      row.seniorFlagById = ctx.actorId || null;
      row.seniorFlagByName = ctx.actorName;
      row.seniorFlagAt = now;
      await row.save();
      if (note) { try { await TaskComment.create({ taskId: row.id, authorId: ctx.actorId || null, authorName: ctx.actorName, body: `🔎 Changes requested: ${note}` }); } catch {} }
      // Notify the assignee(s) so the rework actually happens.
      const targets = new Set([row.assigneeId, ...(Array.isArray(row.assigneeIds) ? row.assigneeIds : [])].filter((x) => x > 0));
      for (const uid of targets) {
        try { await HrNotification.create({ userId: uid, actorKind: 'hr', type: 'task_need_update', text: `🔁 ${ctx.actorName} requested changes on "${String(row.title).slice(0, 60)}"`, meta: { taskId: row.id } }); } catch {}
        try { await require('../services/chatTask').postTaskAlert(uid, { kindTag: 'task_need_update', taskId: row.id, body: `${ctx.actorName} requested changes on "${String(row.title).slice(0, 80)}"${note ? `: ${note}` : ''}` }); } catch {}
      }
      await logActivity(row.id, ctx, 'review', 'moved to Changes Requested');
    } else if (verdict === 'completed') {
      // Confirm completion — bank any open timer segment and mark done.
      const now = new Date();
      if (TIMER_ACTIVE_STAGES.includes(row.stage) && row.workSegStart) { row.workMs = (row.workMs || 0) + Math.max(0, now - new Date(row.workSegStart)); row.workSegStart = null; }
      row.stage = 'completed'; row.completedAt = now; row.seniorFlagNote = null; await row.save();
      await logActivity(row.id, ctx, 'review', 'confirmed completed');
    } else {
      return res.status(400).json({ error: 'verdict must be "completed" or "not_done"' });
    }
    res.json({ ok: true, stage: row.stage });
  } catch (e) { next(e); }
});

// Save the employee's end-of-day accomplishment note (from the logout popup).
router.post('/day-note', guard, async (req, res, next) => {
  try {
    const ctx = await actingContext(req);
    const date = req.body.date ? String(req.body.date).slice(0, 10) : teamReport.istDateStr();
    const note = String(req.body.note || '').trim().slice(0, 1000);
    await HrDayNote.upsert({ employeeId: ctx.boardId, date, note });
    res.json({ ok: true });
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
    // Exclude the actor's OWN board id — the frontend adds a dedicated "My board"
    // entry, so listing it here again would show two boards for the same person.
    const actorNm = String(ctx.actorName || '').trim().toLowerCase();
    const viewable = people.filter((u) => u.id !== ctx.boardId && String(u.name || '').trim().toLowerCase() !== actorNm && canViewBoard(ctx.actorUser, u, people, ctx));
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
      stage: STAGES.includes(b.stage) ? b.stage : 'not_started',
      dueDate: b.dueDate || null,
      order: (Number.isFinite(max) ? max : 0) + 1,
      createdById: ctx.actorId || null, createdByName: ctx.actorName, createdByKind: ctx.actorKind,
      assignedById: isAssignedByOther ? (ctx.boardId || null) : null, assignedByName: isAssignedByOther ? ctx.actorName : '',
      origAssignedById: isAssignedByOther ? (ctx.boardId || null) : null, origAssignedByName: isAssignedByOther ? ctx.actorName : '',
    });
    await logActivity(row.id, ctx, 'created', parentTaskId ? 'created subtask' : 'created task');
    if (isAssignedByOther && assigneeId > 0) await notifyAssignee(assigneeId, ctx, row);
    // Extra assignees: SHARED model — store all on the one row (no copies) and
    // notify each. The single row appears on every assignee's board.
    if (extraIds.length && !parentTaskId) {
      const validExtra = [];
      for (const aid of extraIds) {
        const target = people.find((u) => u.id === aid);
        if (!target || !canAssign(ctx.actorUser, target, ctx, people)) continue;
        validExtra.push(aid);
      }
      if (validExtra.length) {
        row.assigneeIds = [assigneeId, ...validExtra]; row.changed('assigneeIds', true); await row.save();
        for (const aid of validExtra) { await notifyAssignee(aid, ctx, row); await logActivity(row.id, ctx, 'assigned', 'added an assignee'); }
      }
    } else if (assigneeId > 0) {
      // Single assignee — still record the assigneeIds list for consistency.
      row.assigneeIds = [assigneeId]; row.changed('assigneeIds', true); await row.save();
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

    if (b.stage && STAGES.includes(b.stage) && b.stage !== row.stage) {
      const prevStage = row.stage;
      const now = new Date();
      const wasActive = TIMER_ACTIVE_STAGES.includes(prevStage);
      const willActive = TIMER_ACTIVE_STAGES.includes(b.stage);
      // Timer: accumulate the open segment whenever leaving an active state,
      // and open a fresh segment whenever entering one. This makes the timer
      // run during In Progress / Changes Requested, and pause during Pending
      // Review / Pending Approval / On Hold (and stop at Completed).
      if (willActive && !row.startedAt) row.startedAt = now;
      if (wasActive && !willActive) {
        // Leaving active work → bank the elapsed segment.
        if (row.workSegStart) { row.workMs = (row.workMs || 0) + Math.max(0, now - new Date(row.workSegStart)); }
        row.workSegStart = null;
      } else if (!wasActive && willActive) {
        // Entering active work → start a new segment.
        row.workSegStart = now;
      }
      row.stage = b.stage;
      row.completedAt = b.stage === 'completed' ? now : (b.stage === prevStage ? row.completedAt : null);
      await logActivity(row.id, ctx, b.stage === 'completed' ? 'completed' : 'stage', 'moved to ' + STAGE_LABEL[b.stage]);
      // Notify the assignee in their #task chat (unless they made the change).
      try { if (row.assigneeId > 0 && row.assigneeId !== ctx.actorId) await require('../services/chatTask').postTaskAlert(row.assigneeId, { kindTag: 'task_status', taskId: row.id, body: `"${String(row.title).slice(0, 100)}" moved to ${STAGE_LABEL[b.stage]}` }); } catch {}
    }

    // ---- Assignee changes (all routed through one consistent group reconcile) ----
    // Compute the DESIRED full list of assignees, then reconcile.
    let desired = null;
    if (Array.isArray(b.assigneeIds)) {
      desired = b.assigneeIds.map(Number).filter(Boolean);
    } else if (b.toggleAssignee !== undefined) {
      const pid = Number(b.toggleAssignee);
      // SHARED model: current assignees live in assigneeIds for BOTH top-level
      // tasks and subtasks. (The old assigneeGroupId copy-model is gone; reading
      // it here made removing a co-assignee impossible — the list looked like it
      // held only the primary, so removing the primary emptied it and errored.)
      const current = new Set([row.assigneeId, ...((Array.isArray(row.assigneeIds) ? row.assigneeIds : []))].filter(Boolean));
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

    // Gather this task + all its subtasks, then remove their comments,
    // attachments, activity, chat cards and notifications, then the tasks.
    // NOTE: we deliberately do NOT cascade by the legacy assigneeGroupId. In the
    // shared-task model there are no per-assignee copies; a task is one row. Old
    // data may still carry an assigneeGroupId, and cascading on it caused
    // deleting one (often a blank leftover copy) to also delete the real task
    // that happened to share the group id. Each row now deletes independently.
    const subs = await Task.findAll({ where: { parentTaskId: row.id }, attributes: ['id'] });
    const allIds = [...new Set([row.id, ...subs.map((s) => s.id)])];
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
    // SHARED model: read from assigneeIds (not the legacy assigneeGroupId copies).
    let assignees = [];
    try {
      const ids = new Set([row.assigneeId].filter(Boolean));
      if (Array.isArray(row.assigneeIds)) row.assigneeIds.forEach((id) => { if (id) ids.add(id); });
      assignees = [...ids].map((id) => { const u = pById[id]; return u ? { id: u.id, name: u.name, avatar: u.avatar || null } : (adminById[id] ? { id, name: adminById[id].name, avatar: null, isAdmin: true } : null); }).filter(Boolean);
      // Collapse duplicate identities by name.
      const _seen = new Set(); assignees = assignees.filter((a) => { const k = String(a.name || '').trim().toLowerCase(); if (_seen.has(k)) return false; _seen.add(k); return true; });
    } catch {}
    const taskOut = dec(row); taskOut.assignees = assignees;
    res.json({ task: taskOut, subtasks: subtasks.map(dec), comments: comments.map((c) => c.toJSON()), attachments: attachments.map((a) => a.toJSON()), activity: activity.map((a) => a.toJSON()), canDelete, myActorId: ctx.actorId || null, isAdmin: !!ctx.isAdmin });
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

// Edit a task note. Only the note's author may edit it. The senior "needs
// update" review notes (prefixed with the review marker) are not editable here.
router.patch('/tasks/:taskId/comments/:commentId', guard, async (req, res, next) => {
  try {
    const ctx = await actingContext(req);
    const c = await TaskComment.findByPk(req.params.commentId);
    if (!c || String(c.taskId) !== String(req.params.taskId)) return res.status(404).json({ error: 'Note not found.' });
    const isAuthor = c.authorId && ctx.actorId && c.authorId === ctx.actorId;
    if (!isAuthor) return res.status(403).json({ error: 'You can only edit your own notes.' });
    const body = String((req.body && req.body.body) || '').trim();
    if (!body) return res.status(400).json({ error: 'Note can\u2019t be empty.' });
    c.body = body.slice(0, 5000);
    c.changed('updatedAt', true); // touch so the edited time reflects
    await c.save();
    res.json(c.toJSON());
  } catch (e) { next(e); }
});

// Delete a task note. The author may delete their own; an admin may delete any.
router.delete('/tasks/:taskId/comments/:commentId', guard, async (req, res, next) => {
  try {
    const ctx = await actingContext(req);
    const c = await TaskComment.findByPk(req.params.commentId);
    if (!c || String(c.taskId) !== String(req.params.taskId)) return res.status(404).json({ error: 'Note not found.' });
    const isAuthor = c.authorId && ctx.actorId && c.authorId === ctx.actorId;
    if (!isAuthor && !ctx.isAdmin) return res.status(403).json({ error: 'You can only delete your own notes.' });
    await c.destroy();
    res.json({ ok: true });
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
module.exports.STAGES = STAGES;
module.exports.STAGE_LABEL = STAGE_LABEL;
module.exports.TIMER_ACTIVE_STAGES = TIMER_ACTIVE_STAGES;
// Pause the work timer on any actively-timed tasks for a set of users (called
// when an employee logs out or their shift ends, so idle/after-hours time is
// not counted). Banks the open segment into workMs and clears workSegStart;
// the timer re-opens automatically when they next move the task within an
// active stage, or we can reopen on next login. Idempotent.
module.exports.pauseTimersForUsers = async function pauseTimersForUsers(userIds) {
  if (!userIds || !userIds.length) return 0;
  const { Task, Op } = require('../models');
  const rows = await Task.findAll({ where: { stage: { [Op.in]: TIMER_ACTIVE_STAGES }, workSegStart: { [Op.ne]: null } } });
  const now = new Date();
  let n = 0;
  for (const row of rows) {
    const owners = new Set([row.assigneeId, ...(Array.isArray(row.assigneeIds) ? row.assigneeIds : [])].filter(Boolean));
    if (![...owners].some((id) => userIds.includes(id))) continue;
    row.workMs = (row.workMs || 0) + Math.max(0, now - new Date(row.workSegStart));
    row.workSegStart = null;
    // Remember it was paused mid-work so we can resume on next login.
    row.timerPausedWhileActive = true;
    await row.save();
    n += 1;
  }
  return n;
};
// Resume timers for a user who logged back in on tasks still in an active stage
// that we auto-paused. Reopens a fresh segment.
module.exports.resumeTimersForUser = async function resumeTimersForUser(userId) {
  if (!userId) return 0;
  const { Task, Op } = require('../models');
  const rows = await Task.findAll({ where: { stage: { [Op.in]: TIMER_ACTIVE_STAGES }, timerPausedWhileActive: true, workSegStart: null } });
  const now = new Date();
  let n = 0;
  for (const row of rows) {
    const owners = new Set([row.assigneeId, ...(Array.isArray(row.assigneeIds) ? row.assigneeIds : [])].filter(Boolean));
    if (!owners.has(userId)) continue;
    row.workSegStart = now; row.timerPausedWhileActive = false; await row.save(); n += 1;
  }
  return n;
};

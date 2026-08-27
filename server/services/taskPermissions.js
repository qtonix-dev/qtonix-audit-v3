// ===========================================================================
// Task-assignment permissions — the single source of truth for "who can assign
// a task to whom" in the per-employee task boards.
//
// Roles (HrUser.type): hr, recruiter, manager, tl, senior, junior, trainee,
// intern, employee. Plus CRM admins (User.role === 'admin') acting in HR, and
// the branch-scoped HrUser.isHrManager flag.
//
// "Team" is derived from the reporting line (HrUser.reportsToId). There is no
// separate team field:
//   • your manager      = your reportsToId  (or reportsToAdminId for a CRM admin)
//   • your team-mates   = everyone sharing your reportsToId (＋ your manager)
//   • a lead's team     = everyone whose reportsToId points to the lead
//
// The rules (agreed with the client):
//   • Admin  → everyone
//   • HR     → everyone            (type 'hr' or 'recruiter', or isHrManager)
//   • Lead   → own team (down) ＋ own manager (up) ＋ other-dept leads ＋ HR
//              ('manager' | 'tl' | 'senior')
//   • Member → self ＋ own team-mates (same reportsToId)     (everyone else)
//
// Cross-department reach stops at the *lead* — you may assign to another
// department's manager/TL directly, not to their individual reports.
// ===========================================================================

const LEAD_TYPES = new Set(['manager', 'tl', 'senior']);
const HR_TYPES = new Set(['hr', 'recruiter']);

// Is this actor an all-powerful assigner (CRM admin or HR)?
function isAdminActor(actor) {
  // actor: { kind:'admin'|'hr', id, type?, isHrManager?, isHrAdmin? }
  return !!(actor && (actor.kind === 'admin' || actor.isHrAdmin));
}
function isHrActor(actor) {
  if (!actor) return false;
  if (isAdminActor(actor)) return true;
  if (actor.isHrManager) return true;
  return HR_TYPES.has(actor.type);
}
function isLead(u) { return !!u && LEAD_TYPES.has(u.type); }

// Same team = same manager (shared reportsToId), or one is the other's manager.
function sameTeam(a, b) {
  if (!a || !b) return false;
  if (a.id === b.id) return true;
  // share a manager
  if (a.reportsToId && b.reportsToId && a.reportsToId === b.reportsToId) return true;
  // a reports to b, or b reports to a
  if (a.reportsToId && a.reportsToId === b.id) return true;
  if (b.reportsToId && b.reportsToId === a.id) return true;
  return false;
}

// Core decision. `actorUser` is the acting HrUser row (or null for a pure CRM
// admin). `targetUser` is the HrUser the task would be assigned to.
//
// Visibility / assign rules (the assignee dropdown shows exactly this set):
//   • Admin / HR-manager / HR  → everyone
//   • Lead (manager|tl|senior)  → their whole downline (people under them, at any
//                                 depth) ＋ every other lead (seniors who have
//                                 reports or head a department) ＋ their own
//                                 reporting chain upward ＋ self
//   • Member (everyone else)    → everyone in their OWN DEPARTMENT (same branch)
//                                 ＋ their reporting chain upward ＋ self
//
// `roster` (all active HrUsers) is needed to walk the hierarchy; callers that
// don't pass it fall back to the direct-relationship checks only.
function canAssign(actorUser, targetUser, ctx = {}, roster = null) {
  if (!targetUser || !targetUser.active) return false;

  // Admins and HR (role, not merely HR-side login) can assign to everyone.
  if (ctx.isAdmin || ctx.isHr) return true;
  if (!actorUser) return false;
  if (isHrActor(actorUser)) return true;

  // Self is always allowed.
  if (actorUser.id === targetUser.id) return true;

  const byId = roster ? new Map(roster.map((u) => [u.id, u])) : null;
  // Walk the actor's reporting chain upward — they can always reach their own
  // managers (reporting authority), including a lead's manager.
  const inMyReportingChain = (tid) => {
    if (!byId) return actorUser.reportsToId === tid; // shallow fallback
    let cur = actorUser; const seen = new Set();
    while (cur && cur.reportsToId && !seen.has(cur.id)) { seen.add(cur.id); if (cur.reportsToId === tid) return true; cur = byId.get(cur.reportsToId); }
    return false;
  };

  if (isLead(actorUser)) {
    // Downline: target is under the actor at any depth.
    if (byId && isDownline(actorUser, targetUser, roster)) return true;
    if (targetUser.reportsToId === actorUser.id) return true; // direct report
    // Reporting chain upward.
    if (inMyReportingChain(targetUser.id)) return true;
    // Any other lead (has reports, or heads a department) — seniors who lead.
    if (isLead(targetUser)) return true;
    return false;
  }

  // Member: everyone in their own department (same branch) ＋ reporting chain.
  const sameDept = (actorUser.department || '') && (targetUser.department || '') &&
    (actorUser.department || '').toLowerCase() === (targetUser.department || '').toLowerCase() &&
    (actorUser.branch || '').toLowerCase() === (targetUser.branch || '').toLowerCase();
  if (sameDept) return true;
  if (inMyReportingChain(targetUser.id)) return true;
  return false;
}

// Build the list of HrUser ids an actor may assign to, from a roster of all
// active HrUsers. Used to scope the assignee picker + validate the API.
function assignableIds(actorUser, roster, ctx = {}) {
  return roster.filter((u) => canAssign(actorUser, u, ctx, roster)).map((u) => u.id);
}

// Whether an actor may VIEW another person's task board (the top switcher +
// GET /board/:id). Rules mirror the org chart:
//   • Admin / HR            → every board
//   • Lead (manager/tl/sr)  → own board ＋ anyone in their downline (their direct
//                             reports, and transitively those reports' reports)
//   • Member                → only their own board
// Viewing is intentionally NARROWER than assigning: a member can assign to a
// team-mate but must not browse that team-mate's whole board.
function isDownline(actorUser, targetUser, roster) {
  if (!actorUser || !targetUser) return false;
  const byId = new Map(roster.map((u) => [u.id, u]));
  let cur = targetUser;
  const seen = new Set();
  while (cur && cur.reportsToId && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.reportsToId === actorUser.id) return true;
    cur = byId.get(cur.reportsToId);
  }
  return false;
}
function canViewBoard(actorUser, targetUser, roster, ctx = {}) {
  if (!targetUser) return false;
  // Only admins may view someone else's task board. Everyone else (including
  // HR and leads) sees only their own board — viewing another person's whole
  // board is an admin-only capability.
  if (ctx.isAdmin) return true;
  if (!actorUser) return false;
  return actorUser.id === targetUser.id;
}
function viewableBoardIds(actorUser, roster, ctx = {}) {
  return roster.filter((u) => canViewBoard(actorUser, u, roster, ctx)).map((u) => u.id);
}

module.exports = { canAssign, assignableIds, canViewBoard, viewableBoardIds, isDownline, sameTeam, isLead, isHrActor, isAdminActor, LEAD_TYPES, HR_TYPES };

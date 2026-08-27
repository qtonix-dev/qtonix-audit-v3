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
// admin). `targetUser` is the HrUser the task would be assigned to. `ctx.isAdmin`
// / `ctx.isHr` let the caller pass through CRM-admin / HR-access context that
// isn't on the HrUser row itself.
//
// Returns true if the actor may assign a task to the target.
function canAssign(actorUser, targetUser, ctx = {}) {
  if (!targetUser || !targetUser.active) return false;

  // Admins and HR can assign to everyone.
  if (ctx.isAdmin || ctx.isHr) return true;
  if (!actorUser) return false; // no HrUser identity and not admin/HR → nothing
  if (isHrActor(actorUser)) return true;
  if (isAdminActor(actorUser)) return true;

  // Self is always allowed.
  if (actorUser.id === targetUser.id) return true;

  // Leads: own team (down) ＋ own manager (up) ＋ other-department leads ＋ HR.
  if (isLead(actorUser)) {
    // down: target reports to me
    if (targetUser.reportsToId && targetUser.reportsToId === actorUser.id) return true;
    // same team (shared manager)
    if (sameTeam(actorUser, targetUser)) return true;
    // up: my own manager
    if (actorUser.reportsToId && actorUser.reportsToId === targetUser.id) return true;
    // sideways: any other-department lead
    if (isLead(targetUser) && (targetUser.department || '') !== (actorUser.department || '')) return true;
    // HR is reachable by leads
    if (HR_TYPES.has(targetUser.type) || targetUser.isHrManager) return true;
    return false;
  }

  // Regular members: self ＋ own team-mates only.
  return sameTeam(actorUser, targetUser);
}

// Build the list of HrUser ids an actor may assign to, from a roster of all
// active HrUsers. Used to scope the assignee picker + validate the API.
function assignableIds(actorUser, roster, ctx = {}) {
  return roster.filter((u) => canAssign(actorUser, u, ctx)).map((u) => u.id);
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
  if (ctx.isAdmin || ctx.isHr) return true;
  if (!actorUser) return false;
  if (actorUser.id === targetUser.id) return true;   // own board
  if (isLead(actorUser)) return isDownline(actorUser, targetUser, roster);
  return false;                                       // members: self only
}
function viewableBoardIds(actorUser, roster, ctx = {}) {
  return roster.filter((u) => canViewBoard(actorUser, u, roster, ctx)).map((u) => u.id);
}

module.exports = { canAssign, assignableIds, canViewBoard, viewableBoardIds, isDownline, sameTeam, isLead, isHrActor, isAdminActor, LEAD_TYPES, HR_TYPES };

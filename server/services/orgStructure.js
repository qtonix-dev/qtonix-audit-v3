/**
 * Org structure helpers.
 *
 * The company is organised as Branch (team) → Shift → Manager → Agents.
 * A branch+shift group does not always have a manager assigned; when it
 * doesn't, the ADMIN is the direct in-charge of that group. Admins themselves
 * sit outside the branch/shift structure entirely (they have no team or shift
 * of their own), so they never appear as a member of a group — only as its
 * fallback owner.
 *
 * These helpers are the single source of truth for that rule so the org chart,
 * the review tab and the dashboard all agree on who is responsible for whom.
 */

const TEAMS = ['Bhubaneswar', 'Kolkata'];
const SHIFTS = ['Morning', 'Night'];

/**
 * Build the full group list with their manager (or admin fallback).
 * @param {Array} users - plain user objects (id, name, role, team, shift, managerId)
 * @returns {Array} [{ team, shift, manager|null, adminLed:boolean, agents:[] }]
 */
function buildGroups(users) {
  const active = users.filter((u) => u.active !== false);
  const managers = active.filter((u) => u.role === 'manager');
  const agents = active.filter((u) => u.role === 'agent');

  // Include any team/shift that actually has people, plus the standard ones.
  const teams = Array.from(new Set([...TEAMS, ...active.filter((u) => u.role !== 'admin').map((u) => u.team)])).filter(Boolean);

  const groups = [];
  for (const team of teams) {
    for (const shift of SHIFTS) {
      const manager = managers.find((m) => m.team === team && m.shift === shift) || null;
      const members = agents.filter((a) => a.team === team && a.shift === shift);
      // Skip empty groups that have neither a manager nor any agents.
      if (!manager && members.length === 0) continue;
      groups.push({
        team,
        shift,
        manager,
        adminLed: !manager, // admin is the direct in-charge when no manager
        agents: members,
      });
    }
  }
  return groups;
}

/**
 * Who is responsible for reviewing this agent?
 * Returns the manager's id, or null when the admin is in charge.
 */
function reviewerFor(agent, users) {
  const groups = buildGroups(users);
  const g = groups.find((x) => x.team === agent.team && x.shift === agent.shift);
  return g && g.manager ? g.manager.id : null;
}

/**
 * Can this user run reviews for the given team+shift?
 * Admins can review any group. Managers only their own groups. When a group is
 * admin-led, only the admin can review it.
 */
function canReviewGroup(user, team, shift, users) {
  if (user.role === 'admin') return true;
  if (user.role !== 'manager') return false;
  const groups = buildGroups(users);
  const g = groups.find((x) => x.team === team && x.shift === shift);
  return !!(g && g.manager && g.manager.id === user.id);
}

/** Groups this user is responsible for (for the review tab). */
function groupsForUser(user, users) {
  const groups = buildGroups(users);
  if (user.role === 'admin') return groups;
  if (user.role === 'manager') return groups.filter((g) => g.manager && g.manager.id === user.id);
  return [];
}

module.exports = { TEAMS, SHIFTS, buildGroups, reviewerFor, canReviewGroup, groupsForUser };

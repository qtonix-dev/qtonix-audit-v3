/**
 * RBAC — module-level access control.
 * Permissions are ADDITIVE: a person keeps everything their role already grants,
 * and an admin can grant EXTRA read/edit/delete on any module on top of that.
 * Admins always have full access. Grants can never remove role access.
 */

// The modules an admin can grant access to (id → label). Kept in sync with the
// HRMS nav. 'admin' is intentionally excluded — only real admins get it.
const MODULES = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'tasks', label: 'Workspace (Tasks & Chat)' },
  { id: 'recognition', label: 'Recognition' },
  { id: 'interview', label: 'Interview' },
  { id: 'email', label: 'Email' },
  { id: 'recruitment', label: 'Recruitment' },
  { id: 'corehr_attendance', label: 'Attendance' },
  { id: 'corehr_leave', label: 'Leave' },
  { id: 'corehr_payroll', label: 'Payroll' },
  { id: 'corehr_expenses', label: 'Expenses' },
  { id: 'corehr_stock', label: 'Stock Management' },
  { id: 'corehr_onboarding', label: 'Onboarding' },
  { id: 'employees', label: 'Employee Directory' },
  { id: 'survey', label: 'Survey' },
];
const MODULE_IDS = new Set(MODULES.map((m) => m.id));
const ACTIONS = ['read', 'edit', 'delete'];

// Sanitize an incoming permissions map to known modules/actions only.
function sanitize(perms) {
  const out = {};
  if (!perms || typeof perms !== 'object') return out;
  for (const [mod, acts] of Object.entries(perms)) {
    if (!MODULE_IDS.has(mod) || !acts || typeof acts !== 'object') continue;
    const clean = {};
    for (const a of ACTIONS) if (acts[a] === true) clean[a] = true;
    if (Object.keys(clean).length) out[mod] = clean;
  }
  return out;
}

// Does the request principal have `action` on `moduleId`?
// Admins: always yes. Otherwise: role-derived base access OR an explicit grant.
function can(req, moduleId, action = 'read') {
  if (req.isHrAdmin || req.adminUser) return true;                 // admin = full
  // Explicit grant on the HR user's permissions map.
  const perms = (req.hrUser && req.hrUser.permissions) || {};
  const m = perms[moduleId];
  if (m && m[action] === true) return true;
  // (Role-based base access is enforced by each route's existing checks; this
  // function only adds the granular layer, so a "no" here means "fall back to
  // whatever the route's own role check decides".)
  return false;
}

// Express middleware factory: require `action` on `moduleId`, but let existing
// role checks still pass first. Use as an ADDITIONAL gate where you want to open
// a route to granted non-role users.
function requireModule(moduleId, action = 'read') {
  return (req, res, next) => {
    if (can(req, moduleId, action)) return next();
    return res.status(403).json({ error: 'You don’t have access to this. Ask an admin to grant it.' });
  };
}

// Merge a user's explicit grants into a flat view for the client (what they can
// see/do), so the frontend can show/hide nav + buttons.
function effectiveFor(hrUser, isAdmin) {
  if (isAdmin) { const all = {}; for (const m of MODULES) all[m.id] = { read: true, edit: true, delete: true }; return all; }
  return sanitize(hrUser && hrUser.permissions);
}

module.exports = { MODULES, MODULE_IDS, ACTIONS, sanitize, can, requireModule, effectiveFor };

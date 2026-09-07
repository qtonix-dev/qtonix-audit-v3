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
function can(req, moduleId, action = 'read') {
  if (req.isHrAdmin || req.adminUser) return true;                 // admin = full
  const perms = (req.hrUser && req.hrUser.permissions) || {};
  const g = perms[moduleId];
  if (g && g[action] === true) return true;                        // explicit grant
  const isHrDept = req.hrUser && /^(hr|human resource|human resources)$/i.test(String(req.hrUser.department || '').trim());
  const base = roleBaseAccess({ isAdmin: false, isHrManager: !!req.isHrManager, type: req.hrUser && req.hrUser.type, isHrDept });
  if (base[moduleId] && base[moduleId][action] === true) return true; // role base
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

// Role-derived DEFAULT access per module (LOCKED — cannot be removed by admin,
// only added to). Determined from the HR user's role/type + manager/HR flags.
// Returns a map { moduleId: { read, edit, delete } } of the base access.
function roleBaseAccess(ctx) {
  // ctx: { isAdmin, isHrManager, type, isHrDept }
  const rw = { read: true, edit: true, delete: false };
  const r = { read: true };
  const rwd = { read: true, edit: true, delete: true };
  const base = {};
  if (ctx.isAdmin) { for (const m of MODULES) base[m.id] = { ...rwd }; return base; }
  // Everyone: Dashboard + Workspace (tasks/chat).
  base.dashboard = { ...r };
  base.tasks = { ...r };
  const isHrStaff = ['hr', 'recruiter'].includes(ctx.type) || ctx.isHrDept;
  if (isHrStaff) {
    base.recruitment = { ...rw };
    base.interview = { ...rw };
    base.corehr_leave = { ...rw };
    base.email = { ...rw };
  }
  if (ctx.isHrManager) {
    // HR Managers get all Core HR modules.
    for (const id of ['corehr_attendance', 'corehr_leave', 'corehr_payroll', 'corehr_expenses', 'corehr_stock', 'corehr_onboarding', 'employees']) base[id] = { ...rw };
    base.recruitment = { ...rw };
    base.interview = { ...rw };
    base.survey = { ...rw };
    base.recognition = { ...rw };
  }
  return base;
}

// Merge role base + explicit grants → the employee's effective access.
function mergeAccess(base, grants) {
  const out = {};
  const keys = new Set([...Object.keys(base || {}), ...Object.keys(grants || {})]);
  for (const k of keys) {
    const b = (base && base[k]) || {}; const g = (grants && grants[k]) || {};
    const m = {};
    for (const a of ACTIONS) if (b[a] || g[a]) m[a] = true;
    if (Object.keys(m).length) out[k] = m;
  }
  return out;
}

module.exports = { MODULES, MODULE_IDS, ACTIONS, sanitize, can, requireModule, effectiveFor, roleBaseAccess, mergeAccess };

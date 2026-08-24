const jwt = require('jsonwebtoken');
const { HrUser, User } = require('../models');

const SECRET = () => process.env.JWT_SECRET || 'change-me-in-production';

// Sign a token for an HR staff member. The `portal: 'hr'` claim marks it as an
// HR-portal token so it can never be used against the CRM API, and vice-versa.
function signHr(hrUser) {
  return jwt.sign(
    { id: hrUser.id, name: hrUser.name, portal: 'hr', hrType: hrUser.type },
    SECRET(),
    { expiresIn: '12h' }
  );
}

/**
 * Guards every /api/hr/* route. Access is granted to:
 *   - an HR staff member (token with portal:'hr'), or
 *   - a CRM admin (normal CRM token with role:'admin').
 * CRM agents/managers/lead-managers are refused. This is the single chokepoint
 * that keeps the HR module separate from Site Analysis.
 */
async function requireHrAccess(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : (req.query && req.query.token) || null;
  if (!token) return res.status(401).json({ error: 'Sign in to continue.' });

  let payload;
  try { payload = jwt.verify(token, SECRET()); }
  catch { return res.status(401).json({ error: 'Your session expired. Sign in again.' }); }

  // HR staff token.
  if (payload.portal === 'hr') {
    const hr = await HrUser.findByPk(payload.id);
    if (!hr || !hr.active) return res.status(401).json({ error: 'This account is no longer active.' });
    req.hrUser = hr;
    req.hrActor = { kind: 'hr', id: hr.id, name: hr.name, type: hr.type };
    req.hrType = hr.type;
    req.isHrAdmin = false; // HR staff are never HR-portal admins
    // Branch scope for HR-manager privileges. Prefer the explicit hrManagerScope
    // field; fall back to legacy isHrManager/type==='manager' (scoped to own
    // branch) so existing managers keep working until re-saved.
    let scope = (hr.hrManagerScope || '').trim();
    if (!scope && (hr.isHrManager || hr.type === 'manager')) scope = hr.branch || '';
    req.hrManagerScope = scope;                     // '' | 'all' | '<branch>'
    req.isHrManager = !!scope;                      // any scope = manager
    req.hrManagerAll = scope.toLowerCase() === 'all';
    req.hrBranch = hr.branch || '';
    return next();
  }

  // Otherwise it must be a CRM admin.
  const user = await User.findByPk(payload.id, { attributes: { exclude: ['passwordHash'] } });
  if (!user || !user.active) return res.status(401).json({ error: 'This account is no longer active.' });
  if (user.role !== 'admin') {
    return res.status(403).json({ error: 'The HR portal is only available to HR staff and admins.' });
  }
  req.adminUser = user;
  req.hrActor = { kind: 'admin', id: user.id, name: user.name };
  req.isHrAdmin = true; // only the shared admin can manage HR users/branches
  req.isHrManager = false;
  req.hrManagerScope = '';
  req.hrManagerAll = false;
  req.hrBranch = '';
  next();
}

// Guards HR admin-only routes (managing HR users and branches).
function requireHrAdmin(req, res, next) {
  if (!req.isHrAdmin) return res.status(403).json({ error: 'Admin access required.' });
  next();
}

// Admin OR HR Manager. Use for branch-scoped management (employees, job posts,
// applicant assignment, announcements). Route handlers still enforce that an HR
// Manager acts only within their own branch.
function requireHrManager(req, res, next) {
  if (req.isHrAdmin || req.isHrManager) return next();
  return res.status(403).json({ error: 'Only an admin or HR manager can do this.' });
}

// True when the actor may manage records for the given branch: admins anywhere;
// an "all"-scope HR Manager anywhere; a branch-scoped HR Manager only within
// their scoped branch. Others never.
function canManageBranch(req, branch) {
  if (req.isHrAdmin) return true;
  if (req.isHrManager) {
    if (req.hrManagerAll) return true;                 // all-branches manager
    const scope = req.hrManagerScope || req.hrBranch;  // scoped branch
    return !branch || !scope || String(branch).toLowerCase() === String(scope).toLowerCase();
  }
  return false;
}

// Guards recruiting-management routes (scheduling interviews, assigning
// panelists, managing offers). Admins and HR/recruiting roles qualify; plain
// employees (who may still be interview panelists) do not.
const SCHEDULER_TYPES = ['hr', 'recruiter', 'manager', 'tl'];
function requireScheduler(req, res, next) {
  if (req.isHrAdmin) return next();
  if (req.hrType && SCHEDULER_TYPES.includes(req.hrType)) return next();
  return res.status(403).json({ error: 'Only HR, recruiters and admins can manage this.' });
}

// Whether the actor may see internal-only content (salary/approval, internal
// notes): admins + HR/recruiter/manager/TL. Pure interview panelists cannot.
function canViewInternal(req) {
  return !!req.isHrAdmin || (req.hrType && SCHEDULER_TYPES.includes(req.hrType));
}

module.exports = { signHr, requireHrAccess, requireHrAdmin, requireScheduler, requireHrManager, canViewInternal, canManageBranch };

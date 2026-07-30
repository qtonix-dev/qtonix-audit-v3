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
    req.isHrAdmin = false; // HR staff are never HR-portal admins
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
  next();
}

// Guards HR admin-only routes (managing HR users and branches).
function requireHrAdmin(req, res, next) {
  if (!req.isHrAdmin) return res.status(403).json({ error: 'Admin access required.' });
  next();
}

module.exports = { signHr, requireHrAccess, requireHrAdmin };

const jwt = require('jsonwebtoken');
const { User } = require('../models');

const SECRET = () => process.env.JWT_SECRET || 'change-me-in-production';

function sign(user) {
  return jwt.sign(
    { id: user.id, role: user.role, name: user.name },
    SECRET(),
    { expiresIn: '12h' }
  );
}

/** Verifies the token AND re-checks the user is still active on every request:
 *  a deactivated agent must lose access immediately, not in 12 hours. */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sign in to continue.' });
  try {
    const payload = jwt.verify(token, SECRET());
    const user = await User.findByPk(payload.id, { attributes: { exclude: ['passwordHash'] } });
    if (!user || !user.active) return res.status(401).json({ error: 'This account is no longer active.' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Your session expired. Sign in again.' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

module.exports = { sign, requireAuth, requireAdmin };

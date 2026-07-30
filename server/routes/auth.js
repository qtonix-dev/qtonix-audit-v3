const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { User, AuditLog } = require('../models');
const { sign, requireAuth } = require('../middleware/auth');

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Enter your email and password.' });

  const user = await User.findOne({ where: { email: String(email).toLowerCase().trim() } });
  // Same message either way: never reveal which accounts exist.
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  if (!user.active) return res.status(403).json({ error: 'This account has been deactivated.' });

  user.lastLogin = new Date();
  await user.save();
  await AuditLog.create({ userId: user.id, userName: user.name, action: 'login', ip: req.ip });

  res.json({
    token: sign(user),
    user: {
      id: user.id, name: user.name, email: user.email, role: user.role,
      phone: user.phone, designation: user.designation, reportsRun: user.reportsRun,
      avatar: user.avatar || null, birthday: user.birthday || null,
      workAnniversary: user.workAnniversary || null, gmailConnected: !!user.gmailRefreshToken,
    },
  });
});

/**
 * GET /api/auth/me — full current-user record for the header/profile.
 * req.user is the slim JWT payload; re-read the row for avatar/birthday/etc.
 */
router.get('/me', requireAuth, async (req, res) => {
  const u = await User.findByPk(req.user.id);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  res.json({ user: {
    id: u.id, name: u.name, email: u.email, role: u.role, phone: u.phone,
    designation: u.designation, reportsRun: u.reportsRun, avatar: u.avatar || null,
    birthday: u.birthday || null, workAnniversary: u.workAnniversary || null,
    gmailConnected: !!u.gmailRefreshToken,
  } });
});

/**
 * PUT /api/auth/me/profile — self-service profile update: avatar, birthday, and
 * password. Any authenticated user may edit their own.
 */
router.put('/me/profile', requireAuth, async (req, res, next) => {
  try {
    const u = await User.findByPk(req.user.id);
    if (!u) return res.status(404).json({ error: 'User not found.' });
    const { avatar, birthday, password } = req.body || {};
    if (avatar !== undefined) u.avatar = avatar || null;
    if (birthday !== undefined) u.birthday = birthday || null;
    if (password) {
      if (String(password).length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
      u.passwordHash = await bcrypt.hash(password, 12);
    }
    await u.save();
    res.json({ id: u.id, name: u.name, avatar: u.avatar || null, birthday: u.birthday || null });
  } catch (e) { next(e); }
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }
  const user = await User.findByPk(req.user.id);
  if (!(await bcrypt.compare(currentPassword || '', user.passwordHash))) {
    return res.status(401).json({ error: 'Your current password is incorrect.' });
  }
  user.passwordHash = await bcrypt.hash(newPassword, 12);
  await user.save();
  res.json({ ok: true });
});

module.exports = router;

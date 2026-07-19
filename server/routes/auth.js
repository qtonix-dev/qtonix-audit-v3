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
    },
  });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

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

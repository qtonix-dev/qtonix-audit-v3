/**
 * One-time admin reset. Unlike seed.js, this ALWAYS sets the admin's password
 * to the current ADMIN_PASSWORD env var — creating the account if it's missing,
 * or updating it if it already exists. Safe to run repeatedly.
 *
 * Run on Railway with:  npm run reset-admin
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { initDb, User, sequelize } = require('./models');

(async () => {
  await initDb();
  console.log(`DB ready (${sequelize.getDialect()}).`);

  const email = (process.env.ADMIN_EMAIL || 'admin@qtonix.com').toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.error('ADMIN_PASSWORD is not set. Add it in Railway Variables, then redeploy.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await User.findOne({ where: { email } });

  if (existing) {
    existing.passwordHash = passwordHash;
    existing.role = 'admin';
    await existing.save();
    console.log('Admin password RESET for:', email);
  } else {
    await User.create({
      name: process.env.ADMIN_NAME || 'Adam G',
      email,
      passwordHash,
      role: 'admin',
      phone: process.env.ADMIN_PHONE || '+91-8249016547',
      designation: 'Project Manager',
    });
    console.log('Admin CREATED:', email);
  }
  console.log('You can now log in with ADMIN_EMAIL / ADMIN_PASSWORD.');
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });

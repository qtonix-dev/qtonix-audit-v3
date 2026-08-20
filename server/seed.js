/** First-run setup: creates tables, settings, and the initial admin. */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { initDb, User, sequelize } = require('./models');

(async () => {
  await initDb();
  console.log(`Database ready (${sequelize.getDialect()}). Tables created.`);

  const email = (process.env.ADMIN_EMAIL || 'adam@qtonix.com').toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.error('Set ADMIN_PASSWORD in .env before seeding.');
    process.exit(1);
  }

  const existing = await User.findOne({ where: { email } });
  if (existing) {
    console.log('Admin already exists:', email);
    process.exit(0);
  }
  // Don't recreate the default admin if the system already has another active
  // admin (e.g. ownership was handed over and the old default was deleted).
  const activeAdmins = await User.count({ where: { role: 'admin', active: true } });
  if (activeAdmins > 0) {
    console.log(`An active admin already exists — not creating the default ${email}.`);
    process.exit(0);
  }

  await User.create({
    name: process.env.ADMIN_NAME || 'Sandeep',
    email,
    passwordHash: await bcrypt.hash(password, 12),
    role: 'admin',
    phone: process.env.ADMIN_PHONE || '',
    designation: 'Administrator',
  });

  console.log('Admin created:', email);
  console.log('Sign in, then add your API keys in Admin -> Settings.');
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });

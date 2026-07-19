/** First-run setup: creates tables, settings, and the initial admin. */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { initDb, User, sequelize } = require('./models');

(async () => {
  await initDb();
  console.log(`Database ready (${sequelize.getDialect()}). Tables created.`);

  const email = (process.env.ADMIN_EMAIL || 'admin@qtonix.com').toLowerCase();
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

  await User.create({
    name: process.env.ADMIN_NAME || 'Adam G',
    email,
    passwordHash: await bcrypt.hash(password, 12),
    role: 'admin',
    phone: process.env.ADMIN_PHONE || '+91-8249016547',
    designation: 'Project Manager',
  });

  console.log('Admin created:', email);
  console.log('Sign in, then add your API keys in Admin -> Settings.');
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });

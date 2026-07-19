require('dotenv').config();

const express = require('express');
const { initDb, sequelize, User } = require('./models');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

const auth = require('./routes/auth');
const reports = require('./routes/reports');
const admin = require('./routes/admin');
const demo = require('./routes/demo');

const app = express();

// Railway (and most hosts) put a reverse proxy in front of the app. Trusting it
// lets express-rate-limit read the real client IP from X-Forwarded-For instead
// of erroring. '1' = trust the first proxy hop.
app.set('trust proxy', 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: process.env.CLIENT_ORIGIN || true, credentials: true }));
app.use(express.json({ limit: '2mb' }));

// Login is the brute-force surface. Everything else is behind a token.
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Too many attempts. Try again in 15 minutes.' } }));
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 120 }));

app.use('/uploads', express.static(path.join(__dirname, '../storage/uploads')));
app.use('/api/auth', auth);
app.use('/api/reports', reports);
app.use('/api/admin', admin);
app.use('/api/demo', demo);

// Public demo page. Only reachable when DEMO_MODE=true; the API routes behind
// it enforce that independently, so serving the HTML is harmless either way.
app.get('/demo', (req, res) => {
  if (process.env.DEMO_MODE !== 'true') return res.status(404).send('Not found.');
  res.sendFile(path.join(__dirname, 'public/demo.html'));
});

app.get('/api/health', async (req, res) => {
  let db = false;
  try { await sequelize.authenticate(); db = true; } catch { db = false; }
  res.json({ ok: true, db, dialect: sequelize.getDialect(), time: new Date() });
});

// -- Optionally serve the built React frontend from the same server.
// If client/dist exists (you ran `npm run build` in client/), the whole app is
// reachable from this one Node process — handy for a single-host Railway deploy.
// On a split deploy (frontend on Vercel), this block is simply inert.
const clientDist = path.join(__dirname, '../client/dist');
if (require('fs').existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^\/(?!api|uploads|demo).*/, (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use((err, req, res, next) => {
  console.error('[api]', err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

const PORT = process.env.PORT || 4000;

initDb()
  .then(async () => {
    console.log(`Database connected (${sequelize.getDialect()})`);

    // -- Boot-time admin safety net. Never throws (so it can't cause a 502).
    // Ensures the admin account exists. If RESET_ADMIN=true, it also overwrites
    // the admin password with the current ADMIN_PASSWORD — set that variable,
    // deploy once, log in, then remove RESET_ADMIN.
    try {
      const bcrypt = require('bcryptjs');
      const email = (process.env.ADMIN_EMAIL || 'admin@qtonix.com').toLowerCase().trim();
      const password = process.env.ADMIN_PASSWORD;
      if (password) {
        const existing = await User.findOne({ where: { email } });
        if (!existing) {
          await User.create({
            name: process.env.ADMIN_NAME || 'Adam G',
            email,
            passwordHash: await bcrypt.hash(password, 12),
            role: 'admin',
            phone: process.env.ADMIN_PHONE || '+91-8249016547',
            designation: 'Project Manager',
          });
          console.log('[admin] created:', email);
        } else if (String(process.env.RESET_ADMIN).toLowerCase() === 'true') {
          existing.passwordHash = await bcrypt.hash(password, 12);
          existing.role = 'admin';
          existing.active = true;
          await existing.save();
          console.log('[admin] password RESET for:', email, '(remove RESET_ADMIN now)');
        } else {
          console.log('[admin] exists:', email, '(set RESET_ADMIN=true to reset password)');
        }
      }
    } catch (e) {
      console.error('[admin] boot check skipped:', e.message);
    }

    app.listen(PORT, () => {
      console.log(`API listening on :${PORT}`);
      if (process.env.DEMO_MODE === 'true') console.log(`Demo page: http://localhost:${PORT}/demo`);
    });
  })
  .catch((e) => {
    console.error('Database connection failed:', e.message);
    process.exit(1);
  });

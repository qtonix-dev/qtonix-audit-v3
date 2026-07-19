require('dotenv').config();

const express = require('express');
const { initDb, sequelize } = require('./models');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

const auth = require('./routes/auth');
const reports = require('./routes/reports');
const admin = require('./routes/admin');
const demo = require('./routes/demo');

const app = express();

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
  .then(() => {
    console.log(`Database connected (${sequelize.getDialect()})`);
    app.listen(PORT, () => {
      console.log(`API listening on :${PORT}`);
      if (process.env.DEMO_MODE === 'true') console.log(`Demo page: http://localhost:${PORT}/demo`);
    });
  })
  .catch((e) => {
    console.error('Database connection failed:', e.message);
    process.exit(1);
  });

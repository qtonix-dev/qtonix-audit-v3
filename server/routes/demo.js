/**
 * PUBLIC DEMO ROUTE — no authentication.
 *
 * Purpose: let you (and only you, initially) verify the whole pipeline end to
 * end without creating accounts.
 *
 * This is genuinely dangerous if left open, because every run spends real SE
 * Ranking credits and real Claude tokens. So it is locked down hard:
 *
 *   1. OFF unless DEMO_MODE=true in .env
 *   2. Optional shared passcode (DEMO_PASSCODE) — set it before sharing a link
 *   3. Hard global cap per rolling 24h (DEMO_DAILY_CAP, default 15)
 *   4. Per-IP cap of 3 per hour
 *   5. Domain cache honoured, so repeat runs of the same site are free
 *   6. Every run is tagged demo:true and attributed to a synthetic agent
 *
 * Turn DEMO_MODE off the moment you have finished checking it.
 */

const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const { Report, Settings, User, Op } = require('../models');
const { normaliseUrl } = require('../services/crawler');
const { enqueueReport } = require('../queue');

const SERVICES = ['SEO', 'SMO', 'AI SEO', 'GEO', 'AEO', 'Local SEO'];

const demoEnabled = () => process.env.DEMO_MODE === 'true';

/** Gate everything behind the env flag. */
router.use((req, res, next) => {
  if (!demoEnabled()) {
    return res.status(404).json({ error: 'Demo mode is off.' });
  }
  next();
});

/** Per-IP throttle. Cheap first line of defence. */
const ipLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: 'Demo limit reached for your connection. Try again in an hour.' },
  standardHeaders: true,
});

/** Synthetic agent so demo reports have a valid author without a real account. */
async function demoAgent() {
  let u = await User.findOne({ where: { email: 'demo@qtonix.local' } });
  if (!u) {
    u = await User.create({
      name: process.env.DEMO_AGENT_NAME || 'Adam G',
      email: 'demo@qtonix.local',
      passwordHash: 'x', // never used: this account cannot log in
      role: 'agent',
      active: false,
      phone: process.env.DEMO_AGENT_PHONE || '+91-8249016547',
      designation: 'Project Manager',
    });
  }
  return u;
}

router.get('/config', async (req, res) => {
  const s = await Settings.findOne({ where: { singleton: 'settings' } });
  res.json({
    enabled: true,
    passcodeRequired: !!process.env.DEMO_PASSCODE,
    services: SERVICES,
    keysReady: !!(s && s.getKey('seranking') && s.getKey('anthropic')),
    dailyCap: Number(process.env.DEMO_DAILY_CAP || 15),
    usedToday: await Report.count({ where: { isDemo: true, createdAt: { [Op.gte]: new Date(Date.now() - 864e5) } } }),
  });
});

router.post('/run', ipLimit, async (req, res, next) => {
  try {
    const { website, businessName, customerName, services, country, location, passcode } = req.body || {};

    if (process.env.DEMO_PASSCODE && passcode !== process.env.DEMO_PASSCODE) {
      return res.status(401).json({ error: 'That passcode is not correct.' });
    }

    // Global cap: the real protection. Credits are money.
    const cap = Number(process.env.DEMO_DAILY_CAP || 15);
    const used = await Report.count({ where: { isDemo: true, createdAt: { [Op.gte]: new Date(Date.now() - 864e5) } } });
    if (used >= cap) {
      return res.status(429).json({ error: `The demo has run its ${cap} reports for today. It resets on a rolling 24-hour window.` });
    }

    if (!website || !businessName || !customerName) {
      return res.status(400).json({ error: 'Website, business name and customer name are all required.' });
    }
    const chosen = Array.isArray(services) && services.length ? services.filter((s) => SERVICES.includes(s)) : ['SEO'];

    let domain;
    try {
      domain = normaliseUrl(website).hostname.replace(/^www\./, '');
    } catch {
      return res.status(400).json({ error: 'That website address is not valid.' });
    }

    const settings = await Settings.findOne({ where: { singleton: 'settings' } });
    if (!settings || !settings.getKey('seranking') || !settings.getKey('anthropic')) {
      return res.status(400).json({ error: 'API keys are not configured yet. Add them in Admin → Settings first.' });
    }

    // Honour the cache: repeat demos of the same domain cost nothing.
    const cutoff = new Date(Date.now() - (settings.cacheDays || 7) * 864e5);
    const cached = await Report.findOne({
      where: { domain, status: 'complete', createdAt: { [Op.gte]: cutoff } },
      order: [['createdAt', 'DESC']],
    });
    if (cached) {
      return res.json({ reportId: cached.id, cached: true, message: `Already analysed ${domain} recently — showing that report (no credits spent).` });
    }

    const agent = await demoAgent();
    const report = await Report.create({
      agentId: agent.id,
      agentName: agent.name,
      agentPhone: agent.phone,
      agentEmail: settings.email,
      agentDesignation: agent.designation,
      website, domain, businessName, customerName,
      services: chosen,
      country: country || settings.defaultCountry,
      location,
      status: 'queued',
      isDemo: true,
    });

    await enqueueReport(report.id);
    res.status(201).json({ reportId: report.id, status: 'queued' });
  } catch (e) {
    next(e);
  }
});

/** Public status — demo reports only. Never exposes other clients' work. */
router.get('/status/:id', async (req, res) => {
  const r = await Report.findByPk(req.params.id, {
    attributes: ['status', 'progress', 'currentStep', 'error', 'isDemo', 'scores', 'businessName'],
  });
  if (!r || !r.isDemo) return res.status(404).json({ error: 'Not found.' });
  res.json({
    status: r.status, progress: r.progress, step: r.currentStep,
    error: r.error, scores: r.scores, businessName: r.businessName,
  });
});

router.get('/view/:id', async (req, res) => {
  const r = await Report.findByPk(req.params.id);
  if (!r || !r.isDemo) return res.status(404).send('Not found.');
  if (!r.htmlPath || !fs.existsSync(r.htmlPath)) return res.status(404).send('Not ready yet.');
  res.sendFile(require('path').resolve(r.htmlPath));
});

router.get('/download/:id', async (req, res) => {
  const r = await Report.findByPk(req.params.id);
  if (!r || !r.isDemo) return res.status(404).json({ error: 'Not found.' });
  if (!r.pdfPath || !fs.existsSync(r.pdfPath)) return res.status(404).json({ error: 'The PDF is not ready yet.' });
  res.download(r.pdfPath, `${r.businessName.replace(/[^a-z0-9]/gi, '-')}-Site-Analysis.pdf`);
});

module.exports = router;

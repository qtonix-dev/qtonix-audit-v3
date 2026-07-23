/**
 * DEMO APP API  (/api/demo-app/:token/*)
 * --------------------------------------
 * Serves a complete, fabricated copy of the product so agents can be trained
 * on the real interface without touching live data.
 *
 * Safety model — three independent guarantees:
 *   1. ACCESS   the link only works while an admin has demo mode switched on,
 *               and only with the exact random token. Regenerating the token
 *               instantly dead-links anything already shared.
 *   2. ISOLATION every response is generated in memory by services/demoData.
 *               This router never queries the Lead/Report tables, so there is
 *               no code path by which a demo visitor reaches a real record.
 *   3. READ-ONLY writes are accepted and echoed back so buttons feel alive,
 *               but nothing is persisted. Refreshing resets the sandbox.
 *
 * No authentication is required by design (a trainee has no account yet), which
 * is exactly why the data must be fake rather than filtered.
 */

const router = require('express').Router({ mergeParams: true });
const rateLimit = require('express-rate-limit');
const { Settings } = require('../models');
const demoData = require('../services/demoData');

/** Modest throttle — the link may be shared in a group chat. */
const limiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
router.use(limiter);

/**
 * Gate: demo mode on AND token matches. Anything else is a flat 404 so the
 * endpoint is indistinguishable from a nonexistent URL.
 */
router.use(async (req, res, next) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const token = req.params.token || '';
    if (!s || !s.demoAppEnabled || !s.demoAppToken || token !== s.demoAppToken) {
      return res.status(404).json({ error: 'Not found.' });
    }
    req.demoSettings = s;
    next();
  } catch (e) { next(e); }
});

/** The synthetic identity a demo visitor is "logged in" as. */
const DEMO_USER = {
  _id: 'demo_user_admin', id: 9999, name: 'Demo Manager', role: 'manager',
  email: 'demo@example.com', team: 'Bhubaneswar', shift: 'Morning',
  active: true, targetUsd: 12000, demo: true,
};

const paginate = (items, req) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const perPage = Math.min(100, Math.max(1, parseInt(req.query.perPage, 10) || 20));
  const total = items.length;
  return {
    items: items.slice((page - 1) * perPage, page * perPage),
    total, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)),
  };
};

// --- identity ---------------------------------------------------------------
router.get('/me', (req, res) => res.json({ user: DEMO_USER, demo: true }));

// --- branding ---------------------------------------------------------------
router.get('/settings/public', (req, res) => {
  const s = req.demoSettings;
  res.json({
    companyName: s.companyName, companyShort: s.companyShort, logoPath: s.logoPath,
    colors: s.colors, fontFamily: s.fontFamily, demo: true,
  });
});

// --- reports ----------------------------------------------------------------
router.get('/reports', (req, res) => {
  let items = demoData.reports();
  const q = (req.query.q || '').toLowerCase();
  if (q) items = items.filter((r) => (r.businessName + r.domain).toLowerCase().includes(q));
  res.json(paginate(items, req));
});

router.get('/reports/:id', (req, res) => {
  const r = demoData.reports().find((x) => x._id === req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found.' });
  res.json(r);
});

// --- leads ------------------------------------------------------------------
router.get('/leads', (req, res) => {
  let items = demoData.leads().filter((l) => l.status !== 'converted');
  const q = (req.query.q || '').toLowerCase();
  if (q) items = items.filter((l) => (l.firstName + l.lastName + l.website).toLowerCase().includes(q));
  if (req.query.status) items = items.filter((l) => l.status === req.query.status);
  res.json(paginate(items, req));
});

router.get('/leads/converted', (req, res) => {
  const items = demoData.leads().filter((l) => l.status === 'converted');
  res.json(paginate(items, req));
});

router.get('/leads/deals/board', (req, res) => {
  const deals = [];
  for (const l of demoData.leads()) {
    for (const d of (l.deals || [])) {
      deals.push({ ...d, leadId: l._id, leadName: `${l.firstName} ${l.lastName}`, ownerName: l.ownerName });
    }
  }
  // Give the board some open deals too, otherwise every card sits in one column.
  const stages = ['qualification', 'needs_analysis', 'proposal', 'negotiation'];
  demoData.leads().filter((l) => l.status !== 'converted').slice(0, 10).forEach((l, i) => {
    deals.push({
      id: `demo_open_${i}`, leadId: l._id, leadName: `${l.firstName} ${l.lastName}`,
      ownerName: l.ownerName, name: `${l.lastName} — proposal`, stage: stages[i % stages.length],
      currency: 'USD', amount: 900 + i * 350, installments: [], expectedClose: '',
    });
  });
  res.json({ deals });
});

// --- config / staff ---------------------------------------------------------
// NOTE: these literal paths MUST be declared before '/leads/:id' below, or
// Express matches the wildcard first and treats "config"/"dashboard" as a lead
// id, returning 404.
router.get('/leads/config', (req, res) => res.json({ config: req.demoSettings.crmConfig, demo: true }));

/** Money figures derived from the same fabricated deals, so totals reconcile. */
function moneyRollup() {
  let booked = 0, collected = 0;
  for (const l of demoData.leads()) {
    for (const d of (l.deals || [])) {
      if (d.stage !== 'closed_won') continue;
      booked += Number(d.amount || 0);
      for (const it of (d.installments || [])) if (it.paid) collected += Number(it.amount || 0);
    }
  }
  return { booked: Math.round(booked), collected: Math.round(collected), due: Math.round(booked - collected) };
}

router.get('/leads/dashboard', (req, res) => {
  const m = moneyRollup();
  const board = demoData.users().filter((u) => u.role === 'agent').map((u, i) => ({
    id: u.id, name: u.name, team: u.team, shift: u.shift,
    newSales: 4 - (i % 3), crossSales: 2 + (i % 2),
    collectedUsd: Math.round(m.collected / 5) + i * 400, targetUsd: u.targetUsd,
  })).sort((a, b) => b.collectedUsd - a.collectedUsd);

  res.json({
    demo: true,
    totals: { ...m, leads: demoData.leads().length, converted: demoData.leads().filter((l) => l.status === 'converted').length },
    leaderboard: board,
    trend: [
      { month: 'Feb', usd: 8200 }, { month: 'Mar', usd: 9600 }, { month: 'Apr', usd: 11400 },
      { month: 'May', usd: 10250 }, { month: 'Jun', usd: 13100 }, { month: 'Jul', usd: m.collected },
    ],
  });
});

// Wildcard last, so it only catches genuine lead ids.
router.get('/leads/:id', (req, res) => {
  const l = demoData.leads().find((x) => x._id === req.params.id);
  if (!l) return res.status(404).json({ error: 'Not found.' });
  res.json(l);
});

router.get('/admin/users', (req, res) => res.json({ items: demoData.users(), total: demoData.users().length }));

// --- analytics --------------------------------------------------------------

router.get('/analytics', (req, res) => res.json({ demo: true, ...moneyRollup(), leaderboard: [] }));
router.get('/reviews', (req, res) => res.json({ items: [], total: 0, demo: true }));

/**
 * Writes: acknowledged, never stored. Returning the payload keeps optimistic UI
 * happy so the trainee sees buttons respond, while a refresh restores the
 * pristine sandbox.
 */
router.all(/.*/, (req, res) => {
  if (req.method === 'GET') return res.status(404).json({ error: 'Not available in demo.' });
  res.json({ ok: true, demo: true, note: 'Demo mode — changes are not saved.', ...(req.body || {}) });
});

module.exports = router;

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

/**
 * The synthetic identity a demo visitor is "logged in" as.
 *
 * The role is switchable (?role=agent|manager|admin) so one link can show the
 * product from any seat: an agent sees only their own leads and the agent
 * leaderboard, a manager sees their team, an admin sees everything. Trainers
 * hand agents the ?role=agent link so what they're shown matches what they'll
 * actually get on day one.
 */
const DEMO_USERS = {
  agent: {
    _id: 'demo_user_agent', id: 9001, name: 'Priya Demo', role: 'agent',
    email: 'priya@demo.example.com', team: 'Bhubaneswar', shift: 'Morning',
    active: true, targetUsd: 6000, demo: true,
  },
  manager: {
    _id: 'demo_user_manager', id: 9010, name: 'Karan Demo', role: 'manager',
    email: 'karan@demo.example.com', team: 'Bhubaneswar', shift: 'Morning',
    active: true, targetUsd: 12000, demo: true,
  },
  admin: {
    _id: 'demo_user_admin', id: 9999, name: 'Demo Admin', role: 'admin',
    email: 'admin@demo.example.com', team: 'Bhubaneswar', shift: 'Morning',
    active: true, targetUsd: 12000, demo: true,
  },
};
const demoUser = (req) => DEMO_USERS[String(req.query.role || '').toLowerCase()] || DEMO_USERS.manager;

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
router.get('/me', (req, res) => res.json({ user: demoUser(req), demo: true }));

// --- branding ---------------------------------------------------------------
router.get('/settings/public', (req, res) => {
  const s = req.demoSettings;
  res.json({
    companyName: s.companyName, companyShort: s.companyShort, logoPath: s.logoPath,
    colors: s.colors, fontFamily: s.fontFamily, demo: true,
  });
});

/**
 * Restrict the fabricated book to what the current seat would really see:
 * an agent only their own leads, a manager their team's, an admin everything.
 * Without this an agent demo would show the whole company and misrepresent
 * what they'll get on their first day.
 */
function scoped(req, list) {
  const u = demoUser(req);
  if (u.role === 'admin') return list;
  if (u.role === 'manager') return list.filter((l) => l.ownerTeam === u.team);
  return list.filter((l) => l.ownerId === u.id);
}

// --- reports ----------------------------------------------------------------
router.get('/reports', (req, res) => {
  const u = demoUser(req);
  let items = demoData.reports();
  if (u.role === 'agent') items = items.filter((r) => r.agentId === u.id);
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
  let items = scoped(req, demoData.leads()).filter((l) => l.status !== 'converted');
  const q = (req.query.q || '').toLowerCase();
  if (q) items = items.filter((l) => (l.firstName + l.lastName + l.website).toLowerCase().includes(q));
  if (req.query.status) items = items.filter((l) => l.status === req.query.status);
  res.json(paginate(items, req));
});

router.get('/leads/converted', (req, res) => {
  const items = scoped(req, demoData.leads()).filter((l) => l.status === 'converted');
  res.json({ ...paginate(items, req), period: String(req.query.period || 'all') });
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
router.get('/leads/config', (req, res) => res.json({
  config: req.demoSettings.crmConfig,
  // The screens build owner/assignee dropdowns from this list.
  owners: demoData.users(),
  demo: true,
}));

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
  const viewer = demoUser(req);
  const m = moneyRollup();
  const staff = demoData.users();
  const agents = staff.filter((u) => u.role === 'agent');

  // IMPORTANT: this must mirror the REAL /leads/dashboard response shape
  // exactly. The Dashboard and Analytics screens read data.metrics.*, data.me
  // and data.lists directly, so a missing key crashes them to a blank page.
  const leaderboard = agents.map((u, i) => {
    const salesUsd = Math.round(m.collected / Math.max(1, agents.length)) + i * 350;
    const salesTarget = u.targetUsd || 6000;
    return {
      ownerId: u.id, name: u.name, avatar: null, role: 'agent',
      salesUsd, newSalesUsd: Math.round(salesUsd * 0.6), crossSalesUsd: Math.round(salesUsd * 0.4),
      conversions: 2 + (i % 3), leads: 8 + i, transfersToday: 2 + (i % 4),
      leadsGeneratedMonth: 12 + i, leadsGeneratedToday: 1 + (i % 3),
      pipelineUsd: 3000 + i * 800,
      salesTarget, pct: Math.min(100, Math.round((salesUsd / salesTarget) * 100)),
      remaining: Math.max(0, salesTarget - salesUsd),
      hitTarget: salesUsd >= salesTarget, transferDailyTarget: 5,
    };
  }).sort((a, b) => b.salesUsd - a.salesUsd);

  const leads = demoData.leads();
  const converted = leads.filter((l) => l.status === 'converted');
  const pendingList = [];
  for (const l of converted) {
    for (const d of (l.deals || [])) {
      for (const it of (d.installments || [])) {
        if (!it.paid) {
          pendingList.push({
            leadId: l._id, dealId: d.id, instId: it.id,
            client: `${l.firstName} ${l.lastName}`, dealName: d.name,
            currency: d.currency, amount: Number(it.amount || 0),
            dueDate: it.dueDate || '', seq: it.seq, ownerName: l.ownerName,
            overdue: !!(it.dueDate && it.dueDate < new Date().toISOString().slice(0, 10)),
          });
        }
      }
    }
  }
  pendingList.sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));

  const companyTarget = agents.reduce((s, u) => s + (u.targetUsd || 0), 0);
  const top = leaderboard[0] || null;
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const today = new Date().getDate();

  const myRow = leaderboard.find((r) => r.ownerId === viewer.id) || leaderboard[0] || null;

  res.json({
    demo: true,
    role: viewer.role,
    metrics: {
      totalLeads: leads.length,
      generatedToday: 3, assignedToday: 2, untouched: 4,
      salesThisMonthUsd: m.collected,
      convertedThisMonth: converted.length,
      pipelineUsd: 18400,
      awaitingUsd: m.due,
      newSalesUsd: Math.round(m.collected * 0.62), crossSalesUsd: Math.round(m.collected * 0.38),
      newSalesCount: 7, crossSalesCount: 5,
      companyTarget,
      companyPct: companyTarget > 0 ? Math.round((m.collected / companyTarget) * 100) : null,
      scopeTarget: companyTarget, scopeAchieved: m.collected,
      scopePct: companyTarget > 0 ? Math.round((m.collected / companyTarget) * 100) : null,
      scopeRemaining: Math.max(0, companyTarget - m.collected),
      generatedTarget: 5,
      leadsGeneratedMonth: 64, leadsAssignedMonth: 58,
      leadsPresalesMonth: 31, leadsColdMonth: 33,
    },
    lists: {
      generatedToday: leads.slice(0, 3).map((l) => ({ _id: l._id, name: `${l.firstName} ${l.lastName}`, ownerName: l.ownerName, website: l.website })),
      assignedToday: leads.slice(3, 5).map((l) => ({ _id: l._id, name: `${l.firstName} ${l.lastName}`, ownerName: l.ownerName, website: l.website })),
      untouched: leads.slice(5, 9).map((l) => ({ _id: l._id, name: `${l.firstName} ${l.lastName}`, ownerName: l.ownerName, website: l.website })),
    },
    me: {
      salesUsd: myRow ? myRow.salesUsd : 0, salesTarget: viewer.targetUsd || 6000,
      pct: myRow ? Math.min(100, Math.round((myRow.salesUsd / (viewer.targetUsd || 6000)) * 100)) : 0,
      remaining: myRow ? Math.max(0, (viewer.targetUsd || 6000) - myRow.salesUsd) : (viewer.targetUsd || 6000),
      transfersToday: 3, transferDailyTarget: 5,
      newSalesUsd: myRow ? myRow.newSalesUsd : 0, crossSalesUsd: myRow ? myRow.crossSalesUsd : 0,
      pipelineUsd: 6200, leadsGeneratedMonth: 18, leadsGeneratedToday: 2, leadGenTarget: 30,
    },
    leaderboard,
    transferBoard: leaderboard.map((o) => ({
      ownerId: o.ownerId, name: o.name, avatar: null, transfersToday: o.transfersToday,
      dailyTarget: o.transferDailyTarget, pct: Math.min(100, Math.round((o.transfersToday / 5) * 100)),
      remaining: Math.max(0, 5 - o.transfersToday),
    })),
    trend: [
      { month: 'Feb', usd: 8200 }, { month: 'Mar', usd: 9600 }, { month: 'Apr', usd: 11400 },
      { month: 'May', usd: 10250 }, { month: 'Jun', usd: 13100 }, { month: 'Jul', usd: m.collected },
    ],
    shiftBoard: [
      { team: 'Bhubaneswar', shift: 'Morning', salesUsd: Math.round(m.collected * 0.4), pipelineUsd: 7200 },
      { team: 'Kolkata', shift: 'Night', salesUsd: Math.round(m.collected * 0.35), pipelineUsd: 6100 },
      { team: 'Bhubaneswar', shift: 'Night', salesUsd: Math.round(m.collected * 0.25), pipelineUsd: 5100 },
    ],
    topShift: { team: 'Bhubaneswar', shift: 'Morning', salesUsd: Math.round(m.collected * 0.4) },
    topPerformer: top, topPerformerTied: false,
    awaiting: pendingList.slice(0, 50),
    leadDaily: Array.from({ length: daysInMonth }, (_, i) => ({
      day: i + 1, total: i < today ? 1 + ((i * 3) % 5) : 0,
      presales: i < today ? ((i * 2) % 3) : 0, cold: i < today ? (i % 3) : 0,
    })),
    leadMonthly: [
      { month: 'Feb', year: 2026, total: 48, presales: 22, cold: 26 },
      { month: 'Mar', year: 2026, total: 55, presales: 26, cold: 29 },
      { month: 'Apr', year: 2026, total: 61, presales: 30, cold: 31 },
      { month: 'May', year: 2026, total: 57, presales: 27, cold: 30 },
      { month: 'Jun', year: 2026, total: 66, presales: 33, cold: 33 },
      { month: 'Jul', year: 2026, total: 64, presales: 31, cold: 33 },
    ],
  });
});

// Endpoints the shell polls or loads on navigation. Without these the demo
// throws on boot and renders a blank page.
router.get('/leads/reminders/count', (req, res) => res.json({ due: 3, items: [] }));
router.get('/reviews/history/:agentId', (req, res) => res.json({ items: [], demo: true }));

// Reviews. Must mirror the real shape ({ period, groups, agents, canReviewAll })
// — the screen reads data.agents and data.groups directly.
router.get('/reviews', (req, res) => {
  const staff = demoData.users();
  const agents = staff.filter((u) => u.role === 'agent');
  const managers = staff.filter((u) => u.role === 'manager');
  const period = String(req.query.period || new Date().toISOString().slice(0, 7));
  res.json({
    demo: true,
    period,
    groups: managers.map((mgr) => ({
      team: mgr.team, shift: mgr.shift, adminLed: false,
      manager: { id: mgr.id, name: mgr.name },
      agentCount: agents.filter((a) => a.team === mgr.team).length,
    })),
    agents: agents.map((a, i) => ({
      agentId: a.id, agentName: a.name, name: a.name, avatar: null,
      team: a.team, shift: a.shift,
      managerId: (managers.find((m) => m.team === a.team) || {}).id || null,
      salesUsd: 2200 + i * 450, salesTarget: a.targetUsd || 6000,
      pct: Math.min(100, Math.round(((2200 + i * 450) / (a.targetUsd || 6000)) * 100)),
      band: i === 0 ? 'top' : i < 3 ? 'ok' : 'attention',
      conversions: 3 + (i % 3), leadsGeneratedMonth: 14 + i,
      review: i % 2 === 0 ? {
        id: 1000 + i, agentId: a.id, period, band: 'ok',
        feedback: 'Demo review — steady month, good call quality.',
        actionPlan: 'Focus on follow-up speed for warm leads.',
        reviewerName: (managers[0] || {}).name || 'Demo Manager',
        metOn: new Date().toISOString().slice(0, 10),
      } : null,
    })),
    canReviewAll: false,
  });
});
router.get('/admin/settings', (req, res) => {
  const s = req.demoSettings;
  res.json({
    companyName: s.companyName, companyShort: s.companyShort, website: s.website,
    email: s.email, phone: s.phone, address: s.address, logoPath: s.logoPath,
    colors: s.colors, fontFamily: s.fontFamily, pricing: s.pricing,
    crmConfig: s.crmConfig, reportValidDays: s.reportValidDays,
    dailyReportLimit: s.dailyReportLimit, cacheDays: s.cacheDays,
    defaultCountry: s.defaultCountry, apiKeys: {}, demo: true,
  });
});

// Wildcard last, so it only catches genuine lead ids.
// NOTE: the detail screen reads res.lead and res.reports — returning the lead
// object bare leaves the page stuck on "Loading…".
router.get('/leads/:id', (req, res) => {
  const l = demoData.leads().find((x) => x._id === req.params.id);
  if (!l) return res.status(404).json({ error: 'Not found.' });
  const reports = demoData.reports().filter((r) => r.leadId === l._id);
  res.json({ lead: l, reports });
});

// The real endpoint responds with a bare array (the client does setUsers(res)),
// so wrapping it in {items} would break every screen that reads it.
router.get('/admin/users', (req, res) => res.json(demoData.users()));

// --- analytics --------------------------------------------------------------

router.get('/analytics', (req, res) => res.json({ demo: true, ...moneyRollup(), leaderboard: [] }));

/**
 * Writes: acknowledged, never stored.
 *
 * The real lead mutation endpoints (notes, activities, deals, installments)
 * all respond with the FULL updated lead, and the screens feed that straight
 * back into state. So a bare {ok:true} would blank the page the moment a
 * trainee added a note. We therefore echo the matching demo lead — the click
 * feels alive, the UI stays coherent, and a refresh restores the sandbox.
 */
router.all(/.*/, (req, res) => {
  if (req.method === 'GET') return res.status(404).json({ error: 'Not available in demo.' });

  const m = req.path.match(/^\/leads\/(demo_lead_\d+)/);
  if (m) {
    const lead = demoData.leads().find((l) => l._id === m[1]);
    if (lead) {
      // Surface the note/deal the trainee just typed so the action visibly
      // registers, even though nothing is persisted.
      const b = req.body || {};
      if (b.text && /\/notes/.test(req.path)) {
        lead.notes = [...(lead.notes || []), {
          id: `n_demo_${Date.now()}`, text: String(b.text).slice(0, 2000),
          author: 'Demo Manager', time: new Date().toISOString(),
        }];
      }
      return res.json(lead);
    }
  }
  res.json({ ok: true, demo: true, note: 'Demo mode — changes are not saved.', ...(req.body || {}) });
});

module.exports = router;

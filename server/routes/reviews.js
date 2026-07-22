/**
 * Employee review API.
 *
 * Managers run a monthly 1-to-1 with each agent in their branch+shift group.
 * Where a group has no manager, the admin is the direct in-charge and does it
 * instead (see services/orgStructure.js).
 *
 * The classification into top / ok / attention is computed from the same
 * collected-sales figures the dashboard uses, so nobody has to argue about the
 * numbers — the conversation is about what to do next.
 */
const express = require('express');
const { User, Lead, Review, Settings, AuditLog } = require('../models');
const { requireAuth } = require('../middleware/auth');
const { buildGroups, groupsForUser, canReviewGroup } = require('../services/orgStructure');

const router = express.Router();

/** 'YYYY-MM' for a date (defaults to now). */
function periodKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Score every agent in the given groups for the requested month.
 * Returns rows with collected sales, target, attainment and a band.
 */
async function scoreAgents(groups, period) {
  const settings = await Settings.findOne({ where: { singleton: 'settings' } });
  const fx = (settings && settings.crmConfig && settings.crmConfig.fxRates) || { USD: 1 };
  const toUsd = (amt, cur) => { const r = fx[cur] || 1; return r ? Number(amt || 0) / r : Number(amt || 0); };

  const [y, mo] = period.split('-').map(Number);
  const start = new Date(y, mo - 1, 1);
  const end = new Date(y, mo, 1);
  const daysElapsed = (() => {
    const now = new Date();
    if (now < start) return 0;
    if (now >= end) return Math.round((end - start) / 86400000);
    return Math.max(1, Math.round((now - start) / 86400000));
  })();

  const agentIds = groups.flatMap((g) => g.agents.map((a) => a.id));
  if (agentIds.length === 0) return [];

  const leads = await Lead.findAll({ where: { ownerId: agentIds } });

  const stats = {};
  for (const g of groups) {
    for (const a of g.agents) {
      const t = a.targets || {};
      stats[a.id] = {
        agentId: a.id,
        name: a.name,
        avatar: a.avatar || null,
        jobType: a.jobType || 'bde',
        team: g.team,
        shift: g.shift,
        managerName: g.manager ? g.manager.name : null,
        adminLed: g.adminLed,
        salesUsd: 0,
        leadsGenerated: 0,
        conversions: 0,
        callsDone: 0,
        pipelineUsd: 0,
        salesTarget: (t.sales && t.sales.enabled) ? Number(t.sales.monthly || 0) : 0,
        leadGenTarget: (t.leadGen && t.leadGen.enabled) ? Number(t.leadGen.monthly || 0) : 0,
        transferDaily: (t.transfer && t.transfer.enabled) ? Number(t.transfer.daily || 0) : 0,
      };
    }
  }

  for (const l of leads) {
    const s = stats[l.ownerId];
    if (!s) continue;
    const created = l.createdAt ? new Date(l.createdAt) : null;
    if (created && created >= start && created < end) s.leadsGenerated++;
    if (l.status === 'converted' && l.convertedAt) {
      const c = new Date(l.convertedAt);
      if (c >= start && c < end) s.conversions++;
    }
    for (const d of (l.deals || [])) {
      if (d.stage !== 'closed_won' && d.stage !== 'closed_lost') s.pipelineUsd += toUsd(d.amount, d.currency);
      if (d.stage !== 'closed_won') continue;
      for (const it of (d.installments || [])) {
        if (it.paid && it.paidDate) {
          const pd = new Date(it.paidDate);
          if (pd >= start && pd < end) s.salesUsd += toUsd(it.amount, d.currency);
        }
      }
    }
    for (const a of (l.activities || [])) {
      if (a.kind === 'call' && a.status === 'done') {
        const t = a.date ? new Date(a.date) : null;
        if (t && t >= start && t < end) s.callsDone++;
      }
    }
  }

  const rows = Object.values(stats).map((s) => {
    const pct = s.salesTarget > 0 ? Math.round((s.salesUsd / s.salesTarget) * 100) : null;
    const leadPct = s.leadGenTarget > 0 ? Math.round((s.leadsGenerated / s.leadGenTarget) * 100) : null;
    // Expected progress at this point in the month — judging someone on a
    // month-end target halfway through would be unfair.
    const daysInMonth = Math.round((end - start) / 86400000);
    const expectedPct = Math.round((daysElapsed / daysInMonth) * 100);
    // Daily transfers: compare against the pro-rata expectation.
    const transferExpected = s.transferDaily > 0 ? s.transferDaily * daysElapsed : 0;
    const transferPct = transferExpected > 0 ? Math.round((s.callsDone / transferExpected) * 100) : null;

    // Band: judge on whichever targets the agent actually has.
    const signals = [pct, leadPct, transferPct].filter((v) => v !== null);
    const worst = signals.length ? Math.min(...signals) : null;
    let band = 'ok';
    if (worst === null) band = 'unrated';
    else if (worst >= Math.max(100, expectedPct)) band = 'top';
    else if (worst < Math.max(50, expectedPct * 0.6)) band = 'attention';

    return {
      ...s,
      salesUsd: Math.round(s.salesUsd),
      pipelineUsd: Math.round(s.pipelineUsd),
      pct, leadPct, transferPct, expectedPct, band,
    };
  });

  // Highest collected sales wins; pipeline breaks a tie.
  rows.sort((a, b) => (b.salesUsd - a.salesUsd) || (b.pipelineUsd - a.pipelineUsd));
  if (rows.length && rows[0].salesUsd > 0) rows[0].band = 'top';
  return rows;
}

/**
 * GET /api/reviews?period=YYYY-MM
 * Returns the reviewable agents grouped by band, plus any reviews already
 * recorded for the period.
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'manager') {
      return res.status(403).json({ error: 'Only managers and admins can view reviews.' });
    }
    const period = String(req.query.period || periodKey());
    const users = (await User.findAll({ attributes: { exclude: ['passwordHash'] } })).map((u) => u.toJSON());
    const groups = groupsForUser(req.user, users);

    const rows = await scoreAgents(groups, period);
    const existing = await Review.findAll({ where: { period } });
    const byAgent = {};
    existing.forEach((r) => { byAgent[r.agentId] = r.toJSON(); });

    res.json({
      period,
      groups: groups.map((g) => ({
        team: g.team, shift: g.shift, adminLed: g.adminLed,
        manager: g.manager ? { id: g.manager.id, name: g.manager.name } : null,
        agentCount: g.agents.length,
      })),
      agents: rows.map((r) => ({ ...r, review: byAgent[r.agentId] || null })),
      // Admin sees the whole company's coverage; a manager only their groups.
      canReviewAll: req.user.role === 'admin',
    });
  } catch (e) { next(e); }
});

/**
 * POST /api/reviews — record (or update) a 1-to-1 for an agent this period.
 */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'manager') {
      return res.status(403).json({ error: 'Only managers and admins can record reviews.' });
    }
    const b = req.body || {};
    const agentId = Number(b.agentId);
    if (!agentId) return res.status(400).json({ error: 'agentId is required.' });
    const period = String(b.period || periodKey());

    const users = (await User.findAll({ attributes: { exclude: ['passwordHash'] } })).map((u) => u.toJSON());
    const agent = users.find((u) => u.id === agentId);
    if (!agent) return res.status(404).json({ error: 'Agent not found.' });
    if (!canReviewGroup(req.user, agent.team, agent.shift, users)) {
      return res.status(403).json({ error: "You aren't the in-charge for this agent's group." });
    }

    const [row] = await Review.findOrCreate({
      where: { agentId, period },
      defaults: { agentId, agentName: agent.name, reviewerId: req.user.id, reviewerName: req.user.name, period },
    });
    row.agentName = agent.name;
    row.reviewerId = req.user.id;
    row.reviewerName = req.user.name;
    if (b.band !== undefined) row.band = String(b.band).slice(0, 20);
    if (b.snapshot !== undefined && b.snapshot && typeof b.snapshot === 'object') { row.snapshot = b.snapshot; row.changed('snapshot', true); }
    if (b.feedback !== undefined) row.feedback = String(b.feedback).slice(0, 8000);
    if (b.actionPlan !== undefined) row.actionPlan = String(b.actionPlan).slice(0, 8000);
    if (b.metOn !== undefined) row.metOn = b.metOn || null;
    if (b.needsHr !== undefined) row.needsHr = !!b.needsHr;
    await row.save();

    await AuditLog.create({
      userId: req.user.id, userName: req.user.name, action: 'review.save',
      target: `${agent.name} (${period})`, ip: req.ip,
    });
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

/** GET /api/reviews/history/:agentId — every review recorded for one agent. */
router.get('/history/:agentId', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'manager') {
      return res.status(403).json({ error: 'Not permitted.' });
    }
    const rows = await Review.findAll({
      where: { agentId: Number(req.params.agentId) },
      order: [['period', 'DESC']],
      limit: 24,
    });
    res.json({ items: rows.map((r) => r.toJSON()) });
  } catch (e) { next(e); }
});

module.exports = router;

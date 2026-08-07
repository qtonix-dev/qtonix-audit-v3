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
const { Op } = require('sequelize');
const { User, Lead, Review, Settings, AuditLog, MonthlyTarget } = require('../models');
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
/**
 * Convert a deal amount to USD using the admin-maintained FX table. Shared by
 * the scoring pass and the drill-down endpoints so every figure in the review
 * screen is computed the same way.
 */
async function fxConverter() {
  const settings = await Settings.findOne({ where: { singleton: 'settings' } });
  const fx = (settings && settings.crmConfig && settings.crmConfig.fxRates) || { USD: 1 };
  return (amt, cur) => { const r = fx[cur] || 1; return r ? Number(amt || 0) / r : Number(amt || 0); };
}

async function scoreAgents(groups, period) {
  const toUsd = await fxConverter();

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
        // Recurring cycles beyond the first don't count toward the agent's sale.
        if (it.recurring && Number(it.seq || 0) > 1) continue;
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

  // Admin-entered Monthly Target rows always win when present: the admin has
  // explicitly recorded the numbers for this month, so they override the live
  // figures (for both target and achieved). Without a saved row, live CRM sales
  // are used. This covers past months (before go-live) AND deliberate overrides.
  const storedRows = await MonthlyTarget.findAll({ where: { period, userId: Object.keys(stats).map(Number).concat(-1) } });
  const storedByUser = {};
  storedRows.forEach((r) => { storedByUser[r.userId] = r.toJSON(); });
  for (const s of Object.values(stats)) {
    const rec = storedByUser[s.agentId];
    if (rec) {
      if (rec.targetUsd > 0) s.salesTarget = rec.targetUsd;         // saved target overrides config
      s.salesUsd = rec.achievedUsd;                                  // saved achieved always wins
      s.achievedFromHistory = true;
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
    // Daily lead generation, judged pro-rata like transfers. This is the signal
    // that explains a sales miss: someone who isn't feeding the top of the
    // funnel today will miss target next month too.
    const leadDailyTarget = s.leadGenTarget > 0 ? s.leadGenTarget / daysInMonth : 0;
    const leadDailyExpected = leadDailyTarget * daysElapsed;
    const leadDailyPct = leadDailyExpected > 0 ? Math.round((s.leadsGenerated / leadDailyExpected) * 100) : null;

    /**
     * Bands, in priority order:
     *
     *   danger    — nothing collected all month. Sitting at zero is a different
     *               problem from underperforming, so it gets its own bucket
     *               rather than being buried among "needs attention".
     *   attention — missed the monthly sales target OR the daily lead-gen pace.
     *   top       — hit every target they have (the single highest seller is
     *               promoted below).
     *   on-track  — everything else: at or near target.
     */
    const signals = [pct, leadPct, transferPct].filter((v) => v !== null);
    const worst = signals.length ? Math.min(...signals) : null;

    // Pro-rata expectation: at month end this is the full target, mid-month it
    // is the share of it that should be done by now.
    const salesBar = Math.max(50, expectedPct * 0.85);
    const missedSales = pct !== null && pct < salesBar;
    const missedLeadPace = leadDailyPct !== null && leadDailyPct < 85;

    let band;
    if (worst === null) band = 'unrated';
    else if (s.salesUsd <= 0 && s.salesTarget > 0) band = 'danger';
    else if (missedSales || missedLeadPace) band = 'attention';
    else if (worst >= Math.max(100, expectedPct)) band = 'top';
    else band = 'ok';

    // Why this agent was flagged — shown to the manager so the 1-to-1 starts
    // from a fact rather than a colour.
    const reasons = [];
    if (s.salesUsd <= 0 && s.salesTarget > 0) reasons.push('No sales collected this month');
    else if (missedSales) reasons.push(`Sales at ${pct}% of target (${expectedPct}% of the month gone)`);
    if (missedLeadPace) reasons.push(`Lead generation behind pace (${s.leadsGenerated} of ~${Math.round(leadDailyExpected)} expected by now)`);
    if (transferPct !== null && transferPct < 85) reasons.push(`Transfers behind pace (${transferPct}%)`);

    return {
      ...s,
      salesUsd: Math.round(s.salesUsd),
      pipelineUsd: Math.round(s.pipelineUsd),
      pct, leadPct, transferPct, expectedPct, band,
      leadDailyPct, leadDailyExpected: Math.round(leadDailyExpected), reasons,
    };
  });

  // Top performer is the one who achieved the highest PERCENTAGE of their sales
  // target — not the biggest raw number — so someone who hit 100% of their goal
  // ranks above someone who booked the same money but only reached 50% of a
  // bigger target. Agents with no target set (pct null) fall back to raw sales.
  // Ties break on collected sales, then pipeline.
  const rank = (x) => (x.pct !== null && x.salesTarget > 0) ? x.pct : -1;
  rows.sort((a, b) => (rank(b) - rank(a)) || (b.salesUsd - a.salesUsd) || (b.pipelineUsd - a.pipelineUsd));
  if (rows.length && rows[0].salesUsd > 0) rows[0].band = 'top';
  return rows;
}

/**
 * Score each manager on the aggregate performance of the team they lead — the
 * sum of their agents' sales, lead generation, conversions and targets — so an
 * admin can review managers the same way managers review agents. Groups without
 * a manager (admin-led) are skipped: there's no manager to review.
 */
async function scoreManagers(groups, period) {
  const toUsd = await fxConverter();
  const [y, mo] = period.split('-').map(Number);
  const start = new Date(y, mo - 1, 1);
  const end = new Date(y, mo, 1);
  const daysInMonth = Math.round((end - start) / 86400000);
  const now = new Date();
  const daysElapsed = now < start ? 0 : (now >= end ? daysInMonth : Math.max(1, Math.round((now - start) / 86400000)));

  // Roll groups up by manager (a manager may lead more than one team/shift).
  const byManager = {};
  for (const g of groups) {
    if (!g.manager) continue;
    const m = byManager[g.manager.id] || (byManager[g.manager.id] = {
      managerId: g.manager.id, name: g.manager.name, avatar: g.manager.avatar || null,
      teams: [], agentIds: [], agentsTarget: 0, managerTarget: 0,
    });
    m.teams.push(`${g.team}·${g.shift}`);
    // The manager's own target is the increment added on top of their agents'
    // combined target to form the team target.
    const mt = g.manager.targets || {};
    if (mt.sales && mt.sales.enabled) m.managerTarget = Number(mt.sales.monthly || 0);
    for (const a of g.agents) {
      m.agentIds.push(a.id);
      const t = a.targets || {};
      if (t.sales && t.sales.enabled) m.agentsTarget += Number(t.sales.monthly || 0);
    }
  }

  // Departed (archived) agents are excluded from the live org structure, but
  // for a historical month they were on the team, so their stored figures must
  // roll into the manager's team total. Pull archived agents linked to any of
  // these managers and attach them.
  const archivedAgents = await User.findAll({
    where: { role: 'agent', archived: true, managerId: Object.keys(byManager).map(Number).concat(-1) },
    attributes: ['id', 'managerId'],
  });
  for (const a of archivedAgents) {
    const m = byManager[a.managerId];
    if (m && !m.agentIds.includes(a.id)) m.agentIds.push(a.id);
  }

  const allAgentIds = Object.values(byManager).flatMap((m) => m.agentIds);
  // Also fetch the managers' own leads so their personal sales count toward the
  // team achieved (team achieved = agents' + manager's own).
  const mgrOwnIds = Object.values(byManager).map((m) => m.managerId);
  const ownerLookupIds = Array.from(new Set([...allAgentIds, ...mgrOwnIds]));
  const leads = ownerLookupIds.length ? await Lead.findAll({ where: { ownerId: ownerLookupIds } }) : [];
  const ownerToManager = {};
  for (const m of Object.values(byManager)) { for (const id of m.agentIds) ownerToManager[id] = m.managerId; ownerToManager[m.managerId] = m.managerId; }

  for (const m of Object.values(byManager)) { m.salesUsd = 0; m.leadsGenerated = 0; m.conversions = 0; m.pipelineUsd = 0; m.liveByUser = {}; }
  for (const l of leads) {
    const mid = ownerToManager[l.ownerId];
    const m = mid && byManager[mid];
    if (!m) continue;
    const created = l.createdAt ? new Date(l.createdAt) : null;
    if (created && created >= start && created < end) m.leadsGenerated++;
    if (l.status === 'converted' && l.convertedAt) { const c = new Date(l.convertedAt); if (c >= start && c < end) m.conversions++; }
    for (const d of (l.deals || [])) {
      if (d.stage !== 'closed_won' && d.stage !== 'closed_lost') m.pipelineUsd += toUsd(d.amount, d.currency);
      if (d.stage !== 'closed_won') continue;
      for (const it of (d.installments || [])) {
        if (it.recurring && Number(it.seq || 0) > 1) continue;
        if (it.paid && it.paidDate) { const pd = new Date(it.paidDate); if (pd >= start && pd < end) {
          const amt = toUsd(it.amount, d.currency);
          m.salesUsd += amt;
          // Track live sales per owner so admin overrides can be applied per user.
          m.liveByUser[l.ownerId] = (m.liveByUser[l.ownerId] || 0) + amt;
        } }
      }
    }
  }

  // Historical fallback. Load every stored target row for the managers and all
  // their agents this period. The team target is the agents' combined target
  // plus the manager's own increment; a stored value overrides the configured
  // one. Team achieved falls back to the summed stored achieved only when the
  // live figure is zero (a past month with no data here).
  const mgrIds = Object.values(byManager).map((m) => m.managerId);
  const everyoneIds = mgrIds.concat(Object.values(byManager).flatMap((m) => m.agentIds)).concat(-1);
  const storedRows = await MonthlyTarget.findAll({ where: { period, userId: everyoneIds } });
  const storedByUser = {};
  storedRows.forEach((r) => { storedByUser[r.userId] = r.toJSON(); });

  for (const m of Object.values(byManager)) {
    // TEAM TARGET = agents' targets + manager's own increment. A saved row's
    // target overrides the configured value, per user.
    let agentsTarget = 0; let anyStoredTarget = false;
    for (const aid of m.agentIds) {
      const rec = storedByUser[aid];
      if (rec && rec.targetUsd > 0) { anyStoredTarget = true; agentsTarget += rec.targetUsd; }
      else if (rec) { anyStoredTarget = true; /* saved row with 0 target */ }
    }
    const agentsTargetFinal = anyStoredTarget ? agentsTarget : m.agentsTarget;
    const mgrRec = storedByUser[m.managerId];
    const managerTargetFinal = (mgrRec && mgrRec.targetUsd > 0) ? mgrRec.targetUsd : m.managerTarget;
    m.salesTarget = agentsTargetFinal + managerTargetFinal;

    // TEAM ACHIEVED = per-user: admin-saved achieved wins, else live CRM sales.
    let teamAchieved = 0;
    for (const aid of m.agentIds) {
      const rec = storedByUser[aid];
      teamAchieved += rec ? (rec.achievedUsd || 0) : (m.liveByUser[aid] || 0);
    }
    // Manager's own achieved: saved row wins, else the manager's own live sales.
    const mgrLiveOwn = m.liveByUser[m.managerId] || 0;
    teamAchieved += mgrRec ? (mgrRec.achievedUsd || 0) : mgrLiveOwn;
    m.salesUsd = teamAchieved;
    m.achievedFromHistory = !!(mgrRec || m.agentIds.some((aid) => storedByUser[aid]));
  }

  const rows = Object.values(byManager).map((m) => {
    const pct = m.salesTarget > 0 ? Math.round((m.salesUsd / m.salesTarget) * 100) : null;
    const expectedPct = daysInMonth > 0 ? Math.round((daysElapsed / daysInMonth) * 100) : 0;
    let band = 'steady';
    if (m.salesUsd <= 0) band = 'danger';
    else if (pct != null && pct >= 100) band = 'exceeding';
    else if (pct != null && expectedPct > 0 && pct < expectedPct - 20) band = 'behind';
    return {
      managerId: m.managerId, name: m.name, avatar: m.avatar,
      teams: m.teams, agentCount: m.agentIds.length,
      salesUsd: Math.round(m.salesUsd), salesTarget: Math.round(m.salesTarget),
      pct, expectedPct, leadsGenerated: m.leadsGenerated, conversions: m.conversions,
      pipelineUsd: Math.round(m.pipelineUsd), band,
    };
  });
  // Managers also ranked by % of their team target achieved (raw sales breaks
  // ties), consistent with how agents are ranked.
  const rankM = (x) => (x.pct !== null && x.salesTarget > 0) ? x.pct : -1;
  rows.sort((a, b) => (rankM(b) - rankM(a)) || (b.salesUsd - a.salesUsd) || (b.pipelineUsd - a.pipelineUsd));
  return rows;
}

/**
 * GET /api/reviews?period=YYYY-MM
 * Returns the reviewable agents grouped by band, plus any reviews already
 * recorded for the period.
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'manager' && req.user.role !== 'leadmanager') {
      return res.status(403).json({ error: 'Only managers and admins can view reviews.' });
    }
    const period = String(req.query.period || periodKey());
    const division = String(req.query.division || 'all'); // 'sales' | 'presales' | 'all'
    const users = (await User.findAll({ attributes: { exclude: ['passwordHash'] } })).map((u) => u.toJSON());
    const groups = groupsForUser(req.user, users);

    let rows = await scoreAgents(groups, period);
    // Admin can split the agent view into Sales (BDE) vs Pre-Sales by jobType.
    if (division === 'sales' || division === 'presales') {
      const wantType = division === 'presales' ? 'presales' : 'bde';
      const typeById = new Map(users.map((u) => [u.id, u.jobType]));
      rows = rows.filter((r) => {
        const jt = typeById.get(r.agentId);
        // Sales view includes anyone not explicitly pre-sales; Pre-Sales view is
        // strictly pre-sales agents.
        return division === 'presales' ? jt === 'presales' : jt !== 'presales';
      });
    }
    const existing = await Review.findAll({ where: { period, kind: { [Op.or]: ['agent', null] } } });
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
    if (req.user.role !== 'admin' && req.user.role !== 'manager' && req.user.role !== 'leadmanager') {
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

/**
 * GET /api/reviews/managers?period=YYYY-MM — managers scored on their team's
 * aggregate performance, with any review already recorded. Admin only.
 */
router.get('/managers', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only an admin can review managers.' });
    }
    const period = String(req.query.period || periodKey());
    const users = (await User.findAll({ attributes: { exclude: ['passwordHash'] } })).map((u) => u.toJSON());
    const groups = buildGroups(users);
    const rows = await scoreManagers(groups, period);

    // Manager reviews reuse the Review table, keyed by the manager's user id in
    // agentId, tagged kind='manager' so they don't collide with agent reviews.
    const existing = await Review.findAll({ where: { period, kind: 'manager' } });
    const byManager = {};
    existing.forEach((r) => { byManager[r.agentId] = r.toJSON(); });

    res.json({
      period,
      managers: rows.map((r) => ({ ...r, review: byManager[r.managerId] || null })),
    });
  } catch (e) { next(e); }
});

/** POST /api/reviews/managers — record/update a manager's team-performance review. */
router.post('/managers', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only an admin can review managers.' });
    }
    const b = req.body || {};
    const managerId = Number(b.managerId);
    if (!managerId) return res.status(400).json({ error: 'managerId is required.' });
    const period = String(b.period || periodKey());
    const manager = await User.findByPk(managerId);
    if (!manager || manager.role !== 'manager') return res.status(404).json({ error: 'Manager not found.' });

    const [row] = await Review.findOrCreate({
      where: { agentId: managerId, period, kind: 'manager' },
      defaults: { agentId: managerId, agentName: manager.name, reviewerId: req.user.id, reviewerName: req.user.name, period, kind: 'manager' },
    });
    row.agentName = manager.name;
    row.reviewerId = req.user.id;
    row.reviewerName = req.user.name;
    row.kind = 'manager';
    if (b.band !== undefined) row.band = String(b.band).slice(0, 20);
    if (b.snapshot !== undefined && b.snapshot && typeof b.snapshot === 'object') { row.snapshot = b.snapshot; row.changed('snapshot', true); }
    if (b.feedback !== undefined) row.feedback = String(b.feedback).slice(0, 8000);
    if (b.actionPlan !== undefined) row.actionPlan = String(b.actionPlan).slice(0, 8000);
    if (b.metOn !== undefined) row.metOn = b.metOn || null;
    if (b.needsHr !== undefined) row.needsHr = !!b.needsHr;
    await row.save();

    await AuditLog.create({
      userId: req.user.id, userName: req.user.name, action: 'review.manager.save',
      target: `${manager.name} (${period})`, ip: req.ip,
    });
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

/**
 * GET /api/reviews/incentives?period=YYYY-MM — per-person incentive amounts in
 * INR for the month. ADMIN ONLY (not managers or lead managers).
 *
 * Agents: eligible at ≥ eligibility% of target; base% of achieved (capped at
 * target) + over% of the amount over target. Managers: over% of the team's
 * over-achievement (team target = agents' targets + manager's own). A manager
 * with no team falls back to the agent structure on their own numbers.
 */
router.get('/incentives', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only an admin can view incentives.' });
    }
    const period = String(req.query.period || periodKey());
    const users = (await User.findAll({ attributes: { exclude: ['passwordHash'] } })).map((u) => u.toJSON());
    const groups = buildGroups(users);
    const agentRows = await scoreAgents(groups, period);
    const managerRows = await scoreManagers(groups, period);

    // Incentive rules from settings (with safe fallbacks).
    const settings = await Settings.findOne();
    const inc = (settings && settings.crmConfig && settings.crmConfig.incentives) || {};
    const eligibilityPct = Number(inc.eligibilityPct != null ? inc.eligibilityPct : 90);
    const agentBasePct = Number(inc.agentBasePct != null ? inc.agentBasePct : 1.5);
    const agentOverPct = Number(inc.agentOverPct != null ? inc.agentOverPct : 5);
    const managerOverPct = Number(inc.managerOverPct != null ? inc.managerOverPct : 5);
    const usdToInr = Number(inc.usdToInr != null ? inc.usdToInr : 83);

    // Agent formula → { base, over, total } in USD.
    const agentIncentive = (achieved, target) => {
      if (!target || target <= 0) return { base: 0, over: 0, total: 0, eligible: false };
      const eligible = achieved >= (eligibilityPct / 100) * target;
      if (!eligible) return { base: 0, over: 0, total: 0, eligible: false };
      const base = (agentBasePct / 100) * Math.min(achieved, target);
      const over = achieved > target ? (agentOverPct / 100) * (achieved - target) : 0;
      return { base, over, total: base + over, eligible: true };
    };

    const toInr = (usd) => Math.round(usd * usdToInr);
    const items = [];

    // Which managers actually have team members (agentCount > 0)?
    const mgrById = new Map(managerRows.map((m) => [m.managerId, m]));

    // Agents.
    for (const a of agentRows) {
      const calc = agentIncentive(a.salesUsd, a.salesTarget);
      items.push({
        userId: a.agentId, name: a.name, role: 'agent', avatar: a.avatar || null,
        targetUsd: Math.round(a.salesTarget), achievedUsd: Math.round(a.salesUsd),
        pct: a.pct, eligible: calc.eligible,
        baseUsd: Math.round(calc.base), overUsd: Math.round(calc.over), totalUsd: Math.round(calc.total),
        baseInr: toInr(calc.base), overInr: toInr(calc.over), totalInr: toInr(calc.total),
        basis: 'agent',
      });
    }

    // Managers.
    for (const m of managerRows) {
      let calc; let basis;
      if (m.agentCount > 0) {
        // Team-based: over% of team over-achievement (no base component).
        const over = m.salesUsd > m.salesTarget ? (managerOverPct / 100) * (m.salesUsd - m.salesTarget) : 0;
        calc = { base: 0, over, total: over, eligible: over > 0 };
        basis = 'manager-team';
      } else {
        // No team → agent structure on their own numbers.
        calc = agentIncentive(m.salesUsd, m.salesTarget);
        basis = 'manager-solo';
      }
      items.push({
        userId: m.managerId, name: m.name, role: 'manager', avatar: m.avatar || null,
        targetUsd: Math.round(m.salesTarget), achievedUsd: Math.round(m.salesUsd),
        pct: m.pct, agentCount: m.agentCount, eligible: calc.eligible,
        baseUsd: Math.round(calc.base), overUsd: Math.round(calc.over), totalUsd: Math.round(calc.total),
        baseInr: toInr(calc.base), overInr: toInr(calc.over), totalInr: toInr(calc.total),
        basis,
      });
    }

    // Sort: managers first, then agents, each by incentive desc.
    items.sort((a, b) => (a.role === b.role ? b.totalInr - a.totalInr : a.role === 'manager' ? -1 : 1));

    res.json({
      period,
      rules: { eligibilityPct, agentBasePct, agentOverPct, managerOverPct, usdToInr },
      totalInr: items.reduce((s, i) => s + i.totalInr, 0),
      items,
    });
  } catch (e) { next(e); }
});

/** GET /api/reviews/history/:agentId — every review recorded for one agent. */
router.get('/history/:agentId', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'manager' && req.user.role !== 'leadmanager') {
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

/**
 * GET /api/reviews/sales-history/:agentId — the last 6 months of collected
 * sales for one agent, so a manager can see whether a weak month is a blip or
 * a trend before starting the 1-to-1.
 */
router.get('/sales-history/:agentId', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'manager' && req.user.role !== 'leadmanager') {
      return res.status(403).json({ error: 'Not permitted.' });
    }
    const agentId = Number(req.params.agentId);
    const months = Math.min(12, Math.max(3, Number(req.query.months) || 6));
    const agent = await User.findByPk(agentId);
    if (!agent) return res.status(404).json({ error: 'Not found.' });

    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
    const leads = await Lead.findAll({ where: { ownerId: agentId } });
    const toUsd = await fxConverter();

    // Bucket every collected installment into the month it was paid.
    const buckets = {};
    for (let i = 0; i < months; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1);
      buckets[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`] = {
        period: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleString('en-GB', { month: 'short' }),
        year: d.getFullYear(), salesUsd: 0, newSalesUsd: 0, crossSalesUsd: 0,
        deals: 0, conversions: 0,
      };
    }

    for (const l of leads) {
      if (l.convertedAt) {
        const c = new Date(l.convertedAt);
        const k = `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}`;
        if (buckets[k]) buckets[k].conversions++;
      }
      const won = (l.deals || []).filter((d) => d.stage === 'closed_won')
        .sort((a, b) => new Date(a.wonAt || 0) - new Date(b.wonAt || 0));
      let counted = false;
      won.forEach((d, di) => {
        const insts = (d.installments || []).slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));
        for (const it of insts) {
          if (!it.paid || !it.paidDate) continue;
          const pd = new Date(it.paidDate);
          const k = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, '0')}`;
          if (!buckets[k]) continue;
          const usd = toUsd(it.amount, d.currency);
          buckets[k].salesUsd += usd;
          // Same rule as the dashboard: first collected installment of the
          // lead's first won deal is a new sale, everything after is cross.
          const isNew = di === 0 && !counted;
          if (isNew) { buckets[k].newSalesUsd += usd; counted = true; }
          else buckets[k].crossSalesUsd += usd;
          buckets[k].deals++;
        }
      });
    }

    const series = Object.values(buckets).map((b) => ({
      ...b,
      salesUsd: Math.round(b.salesUsd),
      newSalesUsd: Math.round(b.newSalesUsd),
      crossSalesUsd: Math.round(b.crossSalesUsd),
    }));

    // Overlay any manually-entered monthly figures (Admin → Monthly Targets).
    // These are the source of truth for historical months (e.g. migrated Zoho
    // data), so when an entry exists for a period we use its achieved amount as
    // the sales figure and expose its target. Computed installments are used
    // only where no manual entry exists.
    const periods = series.map((s) => s.period);
    const stored = await MonthlyTarget.findAll({ where: { userId: agentId, period: periods } });
    const byPeriod = {};
    stored.forEach((r) => { byPeriod[r.period] = r; });
    series.forEach((s) => {
      const rec = byPeriod[s.period];
      if (rec) {
        s.targetUsd = Math.round(Number(rec.targetUsd || 0));
        // If an achieved amount was entered, it takes precedence over the
        // computed installment sum for that month.
        if (Number(rec.achievedUsd || 0) > 0 || s.salesUsd === 0) {
          s.salesUsd = Math.round(Number(rec.achievedUsd || 0));
        }
      }
    });

    const total = series.reduce((s, b) => s + b.salesUsd, 0);
    const best = series.reduce((m, b) => (b.salesUsd > (m ? m.salesUsd : -1) ? b : m), null);

    const t = agent.targets || {};
    res.json({
      agentId, agentName: agent.name,
      salesTarget: (t.sales && t.sales.enabled) ? Number(t.sales.monthly || 0) : 0,
      series,
      total: Math.round(total),
      average: Math.round(total / series.length),
      best,
    });
  } catch (e) { next(e); }
});

/**
 * GET /api/reviews/lead-daily/:agentId?period=YYYY-MM — day-by-day lead
 * generation and transfers for one month. Any month can be requested so a
 * manager can compare against a previous one.
 */
router.get('/lead-daily/:agentId', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'manager' && req.user.role !== 'leadmanager') {
      return res.status(403).json({ error: 'Not permitted.' });
    }
    const agentId = Number(req.params.agentId);
    const agent = await User.findByPk(agentId);
    if (!agent) return res.status(404).json({ error: 'Not found.' });

    const period = /^\d{4}-\d{2}$/.test(String(req.query.period || '')) ? String(req.query.period) : periodKey();
    const [y, mo] = period.split('-').map(Number);
    const start = new Date(y, mo - 1, 1);
    const end = new Date(y, mo, 1);
    const daysInMonth = new Date(y, mo, 0).getDate();

    const leads = await Lead.findAll({ where: { ownerId: agentId } });
    const days = Array.from({ length: daysInMonth }, (_, i) => ({
      day: i + 1, leads: 0, presales: 0, cold: 0, transfers: 0, conversions: 0,
    }));

    for (const l of leads) {
      const c = l.createdAt ? new Date(l.createdAt) : null;
      if (c && c >= start && c < end) {
        const row = days[c.getDate() - 1];
        row.leads++;
        if (String(l.leadSource || '').toLowerCase().includes('pre')) row.presales++;
        else row.cold++;
      }
      if (l.convertedAt) {
        const cv = new Date(l.convertedAt);
        if (cv >= start && cv < end) days[cv.getDate() - 1].conversions++;
      }
      for (const a of (l.activities || [])) {
        if (a.kind !== 'call' || a.status !== 'done' || !a.date) continue;
        const d = new Date(a.date);
        if (d >= start && d < end) days[d.getDate() - 1].transfers++;
      }
    }

    const t = agent.targets || {};
    const monthlyTarget = (t.leadGen && t.leadGen.enabled) ? Number(t.leadGen.monthly || 0) : 0;
    const totalLeads = days.reduce((s, d) => s + d.leads, 0);
    res.json({
      agentId, agentName: agent.name, period, daysInMonth,
      days,
      monthlyTarget,
      dailyTarget: monthlyTarget > 0 ? Math.round((monthlyTarget / daysInMonth) * 10) / 10 : 0,
      transferDailyTarget: (t.transfer && t.transfer.enabled) ? Number(t.transfer.daily || 0) : 0,
      totals: {
        leads: totalLeads,
        presales: days.reduce((s, d) => s + d.presales, 0),
        cold: days.reduce((s, d) => s + d.cold, 0),
        transfers: days.reduce((s, d) => s + d.transfers, 0),
        conversions: days.reduce((s, d) => s + d.conversions, 0),
      },
      // Days with nothing logged at all — the most actionable signal.
      blankDays: days.filter((d) => d.leads === 0 && d.transfers === 0).length,
    });
  } catch (e) { next(e); }
});

module.exports = router;

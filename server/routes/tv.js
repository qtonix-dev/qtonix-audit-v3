/**
 * Motivator TV — public board data.
 *
 * A TV browser can't authenticate, so this route is deliberately unauthenticated
 * and instead gated by a long random token held in Settings. An admin can
 * regenerate the token to instantly revoke a leaked link.
 *
 * The payload is company-wide and read-only. Admin-owned leads are excluded
 * throughout, matching the dashboard rule (admins run demo/test data).
 */
const express = require('express');
const { User, Lead, Settings } = require('../models');
const { buildGroups } = require('../services/orgStructure');

const router = express.Router();

/** Constant-time-ish token compare, to avoid leaking length via early exit. */
function tokenMatches(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * GET /api/tv/:token — everything the board needs, in one call.
 * The client polls this every couple of minutes; slides render from the cache.
 */
router.get('/:token', async (req, res, next) => {
  try {
    const settings = await Settings.findOne({ where: { singleton: 'settings' } });
    if (!settings || !settings.tvEnabled || !settings.tvToken) {
      return res.status(404).json({ error: 'Board not available.' });
    }
    if (!tokenMatches(String(req.params.token || ''), String(settings.tvToken))) {
      return res.status(404).json({ error: 'Board not available.' });
    }

    const fx = (settings.crmConfig && settings.crmConfig.fxRates) || { USD: 1 };
    const toUsd = (amt, cur) => { const r = fx[cur] || 1; return r ? Number(amt || 0) / r : Number(amt || 0); };

    const users = (await User.findAll({ attributes: { exclude: ['passwordHash'] } })).map((u) => u.toJSON());
    const roleById = {};
    users.forEach((u) => { roleById[u.id] = u.role; });
    const isAdminOwned = (id) => roleById[id] === 'admin';

    const leads = await Lead.findAll();

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // ---- Per-agent tallies -------------------------------------------------
    const stats = {};
    const ensure = (u) => (stats[u.id] = stats[u.id] || {
      id: u.id, name: u.name, avatar: u.avatar || null,
      team: u.team, shift: u.shift, jobType: u.jobType || 'bde',
      salesUsd: 0, pipelineUsd: 0, leadsGenerated: 0, conversions: 0,
      salesTarget: (u.targets && u.targets.sales && u.targets.sales.enabled) ? Number(u.targets.sales.monthly || 0) : 0,
      leadGenTarget: (u.targets && u.targets.leadGen && u.targets.leadGen.enabled) ? Number(u.targets.leadGen.monthly || 0) : 0,
    });
    users.filter((u) => u.role === 'agent' && u.active !== false).forEach(ensure);

    let companySales = 0, companyPipeline = 0;
    let leadsPresales = 0, leadsCold = 0, leadsTotal = 0;
    const byGroup = {}; // `${team}·${shift}` → { salesUsd, pipelineUsd, leads, target }

    for (const l of leads) {
      if (isAdminOwned(l.ownerId)) continue;
      const s = stats[l.ownerId];
      const gk = `${l.ownerTeam}·${l.ownerShift}`;
      byGroup[gk] = byGroup[gk] || { team: l.ownerTeam, shift: l.ownerShift, salesUsd: 0, pipelineUsd: 0, leads: 0, target: 0, agents: 0 };

      const created = l.createdAt ? new Date(l.createdAt) : null;
      if (created && created >= startOfMonth) {
        leadsTotal++;
        byGroup[gk].leads++;
        if (s) s.leadsGenerated++;
        const src = `${l.leadSource || ''} ${l.generatedBy || ''}`;
        if (/pre[\s-]?sales/i.test(src)) leadsPresales++;
        else if (/cold[\s-]?call/i.test(src)) leadsCold++;
      }
      if (l.status === 'converted' && l.convertedAt && new Date(l.convertedAt) >= startOfMonth && s) s.conversions++;

      for (const d of (l.deals || [])) {
        if (d.stage !== 'closed_won' && d.stage !== 'closed_lost') {
          const v = toUsd(d.amount, d.currency);
          companyPipeline += v;
          byGroup[gk].pipelineUsd += v;
          if (s) s.pipelineUsd += v;
          continue;
        }
        if (d.stage !== 'closed_won') continue;
        for (const it of (d.installments || [])) {
          if (!it.paid || !it.paidDate) continue;
          const pd = new Date(it.paidDate);
          if (pd < startOfMonth) continue;
          const v = toUsd(it.amount, d.currency);
          companySales += v;
          byGroup[gk].salesUsd += v;
          if (s) s.salesUsd += v;
        }
      }
    }

    // ---- Targets -----------------------------------------------------------
    const agentsArr = Object.values(stats);
    agentsArr.forEach((a) => {
      const gk = `${a.team}·${a.shift}`;
      if (byGroup[gk]) { byGroup[gk].target += a.salesTarget; byGroup[gk].agents++; }
    });

    // Company target = sum of managers' effective team targets, else agents'.
    const agentTargetByMgr = {};
    users.forEach((u) => {
      if (u.role === 'agent' && u.managerId && u.targets && u.targets.sales && u.targets.sales.enabled) {
        agentTargetByMgr[u.managerId] = (agentTargetByMgr[u.managerId] || 0) + Number(u.targets.sales.monthly || 0);
      }
    });
    let companyTarget = 0;
    users.forEach((u) => {
      if (u.role === 'manager') {
        const t = u.targets && u.targets.team;
        companyTarget += (t && t.override) ? Number(t.monthly || 0) : (agentTargetByMgr[u.id] || 0);
      }
    });
    if (companyTarget === 0) companyTarget = agentsArr.reduce((s, a) => s + a.salesTarget, 0);

    // ---- Shape the slide data ---------------------------------------------
    const withPct = (a) => ({
      ...a,
      salesUsd: Math.round(a.salesUsd),
      pipelineUsd: Math.round(a.pipelineUsd),
      pct: a.salesTarget > 0 ? Math.round((a.salesUsd / a.salesTarget) * 100) : null,
      remaining: a.salesTarget > 0 ? Math.max(0, Math.round(a.salesTarget - a.salesUsd)) : 0,
    });
    const ranked = agentsArr.map(withPct);

    const bySales = ranked.filter((a) => a.salesUsd > 0).sort((x, y) => y.salesUsd - x.salesUsd);
    const byLeads = ranked.filter((a) => a.leadsGenerated > 0).sort((x, y) => y.leadsGenerated - x.leadsGenerated);
    const byPipeline = ranked.filter((a) => a.pipelineUsd > 0).sort((x, y) => y.pipelineUsd - x.pipelineUsd);
    const withTarget = ranked.filter((a) => a.salesTarget > 0);
    const achieved = withTarget.filter((a) => a.pct >= 100).sort((x, y) => y.pct - x.pct);
    // "Nearly there" — 50%+ but not yet at target, closest first.
    const nearTarget = withTarget.filter((a) => a.pct >= 50 && a.pct < 100).sort((x, y) => x.remaining - y.remaining);

    const groups = Object.values(byGroup).map((g) => ({
      ...g,
      salesUsd: Math.round(g.salesUsd),
      pipelineUsd: Math.round(g.pipelineUsd),
      pct: g.target > 0 ? Math.round((g.salesUsd / g.target) * 100) : null,
    }));
    const teamBoard = groups.slice().sort((a, b) => b.salesUsd - a.salesUsd);

    // Branches roll up their shifts.
    const branchMap = {};
    groups.forEach((g) => {
      branchMap[g.team] = branchMap[g.team] || { team: g.team, salesUsd: 0, target: 0, shifts: [] };
      branchMap[g.team].salesUsd += g.salesUsd;
      branchMap[g.team].target += g.target;
      branchMap[g.team].shifts.push(g);
    });
    const branches = Object.values(branchMap).map((b) => ({
      ...b,
      pct: b.target > 0 ? Math.round((b.salesUsd / b.target) * 100) : null,
      shifts: b.shifts.sort((x, y) => y.salesUsd - x.salesUsd),
    })).sort((a, b) => b.salesUsd - a.salesUsd);

    const companyPct = companyTarget > 0 ? Math.round((companySales / companyTarget) * 100) : null;

    res.json({
      company: {
        name: settings.companyName || 'Qtonix',
        salesUsd: Math.round(companySales),
        target: Math.round(companyTarget),
        pct: companyPct,
        remaining: Math.max(0, Math.round(companyTarget - companySales)),
        pipelineUsd: Math.round(companyPipeline),
      },
      leads: { total: leadsTotal, presales: leadsPresales, cold: leadsCold, other: Math.max(0, leadsTotal - leadsPresales - leadsCold) },
      branches,
      teamBoard,
      bySales, byLeads, byPipeline,
      nearTarget, achieved,
      top3: bySales.slice(0, 3),
      announcements: Array.isArray(settings.tvAnnouncements) ? settings.tvAnnouncements.filter(Boolean) : [],
      // Month end in IST — the countdown reference.
      monthEndIso: new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0) - (5 * 60 + 30) * 60000).toISOString(),
      generatedAt: new Date().toISOString(),
    });
  } catch (e) { next(e); }
});

module.exports = router;

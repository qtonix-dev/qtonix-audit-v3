const router = require('express').Router();
const { Lead, User, Report, Settings, AuditLog, Op } = require('../models');
const { requireAuth } = require('../middleware/auth');

// ---------------------------------------------------------------------------
// Visibility model:
//   - agent   → only leads they own (ownerId === self)
//   - manager → own leads + every lead whose owner team+shift matches one of
//               the manager's assigned scopes
//   - admin   → everything
// Returns a Sequelize `where` clause fragment for the current user.
// ---------------------------------------------------------------------------
async function visibilityWhere(user) {
  if (user.role === 'admin') return {};
  if (user.role === 'manager') {
    const scopes = Array.isArray(user.managerScopes) ? user.managerScopes : [];
    const scopeOr = scopes
      .filter((s) => s && s.team && s.shift)
      .map((s) => ({ ownerTeam: s.team, ownerShift: s.shift }));
    // own leads OR any lead within a managed team+shift group
    return scopeOr.length ? { [Op.or]: [{ ownerId: user.id }, ...scopeOr] } : { ownerId: user.id };
  }
  return { ownerId: user.id };
}

// Can this user see/edit this specific lead?
async function canAccessLead(user, lead) {
  if (user.role === 'admin') return true;
  if (lead.ownerId === user.id) return true;
  if (user.role === 'manager') {
    const scopes = Array.isArray(user.managerScopes) ? user.managerScopes : [];
    return scopes.some((s) => s && s.team === lead.ownerTeam && s.shift === lead.ownerShift);
  }
  return false;
}

// Normalise a website into a bare domain, for report<->lead matching.
function toDomain(website) {
  if (!website) return '';
  try {
    const u = new URL(website.startsWith('http') ? website : `https://${website}`);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return String(website).replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
  }
}

function pushTimeline(lead, type, text, author) {
  const tl = Array.isArray(lead.timeline) ? lead.timeline : [];
  tl.push({ type, text, time: new Date().toISOString(), author });
  lead.timeline = tl;
  lead.changed('timeline', true);
  lead.lastActivityAt = new Date();
}

// Build an installment schedule for a deal. `count` installments split the
// total amount; the first is due on `startDate` (the win date), each subsequent
// one +1 month. Amounts distribute evenly with any rounding remainder on the
// last. Dates and amounts are overridable later by admin/manager.
function buildInstallments(total, count, startDate) {
  const n = Math.max(1, Math.min(36, Number(count) || 1));
  const start = startDate ? new Date(startDate) : new Date();
  const per = Math.floor((Number(total) || 0) / n);
  const out = [];
  let allocated = 0;
  for (let i = 0; i < n; i++) {
    const due = new Date(start);
    due.setMonth(due.getMonth() + i);
    const amt = i === n - 1 ? (Number(total) || 0) - allocated : per;
    allocated += amt;
    out.push({
      id: `inst_${Date.now()}_${i}`,
      seq: i + 1,
      amount: amt,
      dueDate: due.toISOString().slice(0, 10),
      paid: false,
      paidDate: null,
    });
  }
  return out;
}


/** GET /api/leads — list leads visible to the current user (with search/filter). */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const where = await visibilityWhere(req.user);
    const { q, status, source, ownerId, country, untouched } = req.query;
    if (status) where.status = status;
    else where.status = { [Op.ne]: 'converted' }; // converted leads live on their own page
    if (source) where.leadSource = source;
    if (ownerId) where.ownerId = ownerId;
    if (country) where.country = country;
    // "untouched": no activity for 3+ days (stale) — used by the dashboard box.
    if (untouched) {
      const days = untouched === '7' ? 7 : 3;
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      where.lastActivityAt = { [Op.lt]: cutoff };
    }
    if (q) {
      const like = { [Op.like]: `%${q}%` };
      where[Op.and] = [
        ...(where[Op.and] || []),
        { [Op.or]: [{ firstName: like }, { lastName: like }, { email: like }, { website: like }, { domain: like }] },
      ];
    }
    const leads = await Lead.findAll({ where, order: [['lastActivityAt', 'DESC'], ['createdAt', 'DESC']], limit: 500 });
    res.json({ items: leads.map((l) => l.toJSON()) });
  } catch (e) { next(e); }
});

/** GET /api/leads/config — the editable dropdown lists + assignable owners. */
router.get('/config', requireAuth, async (req, res, next) => {
  try {
    const settings = await Settings.findOne({ where: { singleton: 'settings' } });
    const cfg = (settings && settings.crmConfig) || {};
    // Owners the current user can assign to: admins/managers can assign to their
    // visible agents; agents can only own their own leads.
    let owners = [];
    if (req.user.role === 'admin') {
      owners = await User.findAll({ where: { active: true }, attributes: ['id', 'name', 'role', 'team', 'shift'] });
    } else if (req.user.role === 'manager') {
      const scopes = Array.isArray(req.user.managerScopes) ? req.user.managerScopes : [];
      const or = scopes.map((s) => ({ team: s.team, shift: s.shift }));
      owners = await User.findAll({
        where: { active: true, [Op.or]: [{ id: req.user.id }, ...(or.length ? or : [])] },
        attributes: ['id', 'name', 'role', 'team', 'shift'],
      });
    } else {
      owners = [{ id: req.user.id, name: req.user.name, role: 'agent' }];
    }
    // generatedBy = configured extras (e.g. "Presales") + the same owner list.
    res.json({ config: cfg, owners: owners.map((o) => (o.toJSON ? o.toJSON() : o)) });
  } catch (e) { next(e); }
});

/** POST /api/leads/bulk — create many leads at once (CSV/Excel import).
    Body: { rows: [ {firstName, lastName, website, email, ...}, ... ] }.
    Each row is validated lightly; rows without a first name are skipped and
    reported. Owner defaults to the importing user unless they're admin/manager
    and supply a valid ownerId per row. */
router.post('/bulk', requireAuth, async (req, res, next) => {
  try {
    const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: 'No rows to import.' });
    if (rows.length > 2000) return res.status(400).json({ error: 'Please import at most 2000 rows at a time.' });

    let created = 0;
    const skipped = [];
    for (let i = 0; i < rows.length; i++) {
      const b = rows[i] || {};
      if (!b.firstName || !String(b.firstName).trim()) { skipped.push({ row: i + 1, reason: 'missing first name' }); continue; }
      const owner = await resolveOwner(req.user, b.ownerId);
      try {
        await Lead.create({
          ownerId: owner.id, ownerName: owner.name,
          ownerTeam: owner.team || 'Bhubaneswar', ownerShift: owner.shift || 'Morning',
          firstName: String(b.firstName).slice(0, 120),
          lastName: String(b.lastName || '').slice(0, 120),
          website: String(b.website || '').slice(0, 255),
          domain: toDomain(b.website),
          email: String(b.email || '').slice(0, 180),
          secondaryEmail: String(b.secondaryEmail || '').slice(0, 180),
          mobile: String(b.mobile || '').slice(0, 40),
          phone: String(b.phone || '').slice(0, 40),
          leadSource: String(b.leadSource || '').slice(0, 60),
          generatedBy: String(b.generatedBy || '').slice(0, 120),
          status: String(b.status || 'new').slice(0, 40),
          servicesInterested: Array.isArray(b.servicesInterested) ? b.servicesInterested.slice(0, 30)
            : (b.servicesInterested ? String(b.servicesInterested).split(/[;|]/).map((x) => x.trim()).filter(Boolean) : []),
          tags: Array.isArray(b.tags) ? b.tags.slice(0, 30)
            : (b.tags ? String(b.tags).split(/[;|]/).map((x) => x.trim()).filter(Boolean) : ['New Lead']),
          country: String(b.country || '').slice(0, 80),
          city: String(b.city || '').slice(0, 120),
          timezone: String(b.timezone || '').slice(0, 80),
          additionalInfo: String(b.additionalInfo || '').slice(0, 10000),
          lastActivityAt: new Date(),
          timeline: [{ type: 'created', text: 'Lead imported', time: new Date().toISOString(), author: req.user.name }],
        });
        created++;
      } catch (e) { skipped.push({ row: i + 1, reason: e.message }); }
    }
    await AuditLog.create({ userId: req.user.id, userName: req.user.name, action: 'lead.bulk_import', target: `${created} leads`, ip: req.ip });
    res.status(201).json({ created, skipped });
  } catch (e) { next(e); }
});

/** GET /api/leads/converted — leads with status 'converted'. Managers and
    admins only. Manager sees conversions within their scope; admin sees all.
    Declared before /:id so "converted" isn't captured as an id. */
// ---------------------------------------------------------------------------
// GET /api/leads/dashboard — metrics + leaderboard for the current user's
// visibility scope. Sales are summed from Closed Won deals converted to USD via
// admin-maintained FX rates, within the current calendar month.
// ---------------------------------------------------------------------------
router.get('/dashboard', requireAuth, async (req, res, next) => {
  try {
    const { User, Settings } = require('../models');
    const settings = await Settings.findOne({ where: { singleton: 'settings' } });
    const fx = (settings && settings.crmConfig && settings.crmConfig.fxRates) || { USD: 1 };
    const toUsd = (amount, currency) => { const rate = fx[currency] || 1; return rate ? Number(amount || 0) / rate : Number(amount || 0); };

    const where = await visibilityWhere(req.user);
    const leads = await Lead.findAll({ where });

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const in3d = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    // Load users up-front so we know each lead owner's role while tallying.
    // Admin-owned sales are deliberately kept out of company totals and out of
    // the leaderboard that agents/managers see (admins run demo/test data);
    // they're only surfaced back to admins themselves.
    const owners = await User.findAll({ attributes: ['id', 'name', 'role', 'jobType', 'targets', 'managerId', 'avatar'] });
    const roleById = {};
    owners.forEach((u) => { roleById[u.id] = u.role; });
    const viewerIsAdmin = req.user.role === 'admin';
    const isAdminOwned = (ownerId) => roleById[ownerId] === 'admin';

    let totalLeads = 0, generatedToday = 0, assignedToday = 0, untouched = 0;
    let salesThisMonthUsd = 0, convertedThisMonth = 0;
    let awaitingUsd = 0; // won deals whose installments aren't collected yet
    let pipelineUsd = 0; // open (not won/lost) deal value in USD, motivational
    let newSalesUsd = 0, crossSalesUsd = 0, newSalesCount = 0, crossSalesCount = 0;
    const byOwner = {};
    const ensure = (id, name) => (byOwner[id] = byOwner[id] || { ownerId: id, name, salesUsd: 0, newSalesUsd: 0, crossSalesUsd: 0, conversions: 0, leads: 0, transfersToday: 0, leadsGeneratedMonth: 0, leadsGeneratedToday: 0 });
    const genTodayList = [], assignedTodayList = [], untouchedList = [];

    // Per shift/branch tally (by closed-won collected USD this month).
    const byShift = {}; // key `${team}·${shift}`

    for (const l of leads) {
      const created = l.createdAt ? new Date(l.createdAt) : null;
      ensure(l.ownerId, l.ownerName);
      byOwner[l.ownerId].leads++;

      // Lead generation: created this month / today, credited to the owner.
      if (created && created >= startOfMonth) byOwner[l.ownerId].leadsGeneratedMonth++;

      const isConverted = l.status === 'converted';
      if (!isConverted) {
        totalLeads++;
        const last = l.lastActivityAt ? new Date(l.lastActivityAt) : null;
        if (last && last < in3d) { untouched++; if (untouchedList.length < 8) untouchedList.push(leadBrief(l)); }
      }

      // "Generated today" = created today. "Assigned today" = handed to a
      // different owner today (assignedAt moved after creation). Keeping them
      // distinct so the admin view can label each with its own icon.
      const createdToday = created && created >= startOfDay;
      const assignedAt = l.assignedAt ? new Date(l.assignedAt) : created;
      const reassignedToday = assignedAt && assignedAt >= startOfDay && created && (assignedAt - created > 60 * 1000);

      if (createdToday) {
        generatedToday++;
        byOwner[l.ownerId].leadsGeneratedToday++;
        if (genTodayList.length < 12) genTodayList.push({ ...leadBrief(l), kind: 'generated' });
      }
      if (reassignedToday) {
        assignedToday++;
        if (assignedTodayList.length < 12) assignedTodayList.push({ ...leadBrief(l), kind: 'assigned' });
      }

      if (isConverted && l.convertedAt && new Date(l.convertedAt) >= startOfMonth) { convertedThisMonth++; byOwner[l.ownerId].conversions++; }

      // Sales = installments actually collected (paid) this month. First paid
      // installment of a lead's first deal = new sale; everything else = cross.
      const wonDeals = (l.deals || []).filter((d) => d.stage === 'closed_won');
      // Open pipeline = deals not yet won or lost (motivational "in progress").
      for (const d of (l.deals || [])) {
        if (d.stage !== 'closed_won' && d.stage !== 'closed_lost') {
          const v = toUsd(d.amount, d.currency);
          pipelineUsd += v;
          byOwner[l.ownerId].pipelineUsd = (byOwner[l.ownerId].pipelineUsd || 0) + v;
        }
      }
      // Order deals by wonAt/createdAt so "first deal" is stable.
      wonDeals.sort((a, b) => new Date(a.wonAt || a.createdAt || 0) - new Date(b.wonAt || b.createdAt || 0));
      let leadHasCountedNew = false;
      wonDeals.forEach((d, di) => {
        const insts = (d.installments || []).slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));
        const adminOwned = isAdminOwned(l.ownerId);
        insts.forEach((it) => {
          if (!it.paid || !it.paidDate) { if (!adminOwned) awaitingUsd += toUsd(it.amount, d.currency); return; }
          const pd = new Date(it.paidDate);
          const usd = toUsd(it.amount, d.currency);
          // classify new vs cross: the very first paid installment of the first
          // deal is a new sale; all others are cross sales.
          const isNew = di === 0 && it.seq === 1 && !leadHasCountedNew;
          if (isNew) leadHasCountedNew = true;
          if (pd >= startOfMonth) {
            // Per-owner tally always happens (drives the admin-only leaderboard
            // row); company-wide figures skip admin-owned deals.
            byOwner[l.ownerId].salesUsd += usd;
            if (isNew) byOwner[l.ownerId].newSalesUsd += usd;
            else byOwner[l.ownerId].crossSalesUsd += usd;
            if (!adminOwned) {
              salesThisMonthUsd += usd;
              if (isNew) { newSalesUsd += usd; newSalesCount++; }
              else { crossSalesUsd += usd; crossSalesCount++; }
              const key = `${l.ownerTeam}·${l.ownerShift}`;
              byShift[key] = byShift[key] || { team: l.ownerTeam, shift: l.ownerShift, salesUsd: 0 };
              byShift[key].salesUsd += usd;
            }
          }
        });
      });

      for (const a of (l.activities || [])) {
        if (a.kind === 'call' && a.status === 'done') {
          const t = a.date ? new Date(a.date) : (a.createdAt ? new Date(a.createdAt) : null);
          if (t && t >= startOfDay) byOwner[l.ownerId].transfersToday++;
        }
      }
    }

    const targetsById = {}, avatarById = {}, nameById = {};
    owners.forEach((u) => { targetsById[u.id] = u.targets || {}; avatarById[u.id] = u.avatar || null; nameById[u.id] = u.name; });

    const inScope = (u) => {
      if (req.user.role === 'admin') return true;
      if (req.user.role === 'manager') return u.managerId === req.user.id || u.id === req.user.id;
      return u.id === req.user.id;
    };
    owners.forEach((u) => {
      if (u.role === 'agent' && u.targets && u.targets.sales && u.targets.sales.enabled && inScope(u)) ensure(u.id, u.name);
    });

    const leaderboard = Object.values(byOwner).map((o) => {
      const tg = targetsById[o.ownerId] || {};
      const salesTarget = (tg.sales && tg.sales.enabled) ? Number(tg.sales.monthly || 0) : 0;
      const transferTg = (tg.transfer && tg.transfer.enabled) ? tg.transfer : null;
      const pct = salesTarget > 0 ? Math.min(100, Math.round((o.salesUsd / salesTarget) * 100)) : null;
      const remaining = salesTarget > 0 ? Math.max(0, salesTarget - o.salesUsd) : 0;
      return {
        ...o, avatar: avatarById[o.ownerId] || null,
        role: roleById[o.ownerId] || 'agent',
        salesTarget, pct, remaining, hitTarget: salesTarget > 0 && o.salesUsd >= salesTarget,
        transferDailyTarget: transferTg ? Number(transferTg.daily || 0) : 0,
      };
    })
      // Managers and agents never see admin rows (admins run demo/test data).
      .filter((o) => viewerIsAdmin || o.role !== 'admin')
      .sort((a, b) => b.salesUsd - a.salesUsd);

    const transferBoard = leaderboard
      .filter((o) => o.transferDailyTarget > 0 || o.transfersToday > 0)
      .map((o) => ({ ownerId: o.ownerId, name: o.name, avatar: o.avatar, transfersToday: o.transfersToday, dailyTarget: o.transferDailyTarget, pct: o.transferDailyTarget > 0 ? Math.min(100, Math.round((o.transfersToday / o.transferDailyTarget) * 100)) : null, remaining: o.transferDailyTarget > 0 ? Math.max(0, o.transferDailyTarget - o.transfersToday) : 0 }))
      .sort((a, b) => b.transfersToday - a.transfersToday);

    // Company target = sum of managers' effective team targets.
    const agentSalesByMgr = {};
    owners.forEach((u) => { if (u.role === 'agent' && u.managerId && u.targets && u.targets.sales && u.targets.sales.enabled) agentSalesByMgr[u.managerId] = (agentSalesByMgr[u.managerId] || 0) + Number(u.targets.sales.monthly || 0); });
    let companyTarget = 0;
    owners.forEach((u) => { if (u.role === 'manager') { const t = u.targets && u.targets.team; companyTarget += (t && t.override) ? Number(t.monthly || 0) : (agentSalesByMgr[u.id] || 0); } });
    if (companyTarget === 0) owners.forEach((u) => { if (u.role === 'agent' && u.targets && u.targets.sales && u.targets.sales.enabled) companyTarget += Number(u.targets.sales.monthly || 0); });

    // 6-month trend (collected USD by paid date) within scope.
    const trend = [];
    for (let i = 5; i >= 0; i--) {
      const mStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      let sum = 0;
      for (const l of leads) {
        for (const d of (l.deals || [])) {
          if (d.stage !== 'closed_won') continue;
          for (const it of (d.installments || [])) {
            if (it.paid && it.paidDate) { const pd = new Date(it.paidDate); if (pd >= mStart && pd < mEnd) sum += toUsd(it.amount, d.currency); }
          }
        }
      }
      trend.push({ month: mStart.toLocaleString('en-US', { month: 'short' }), year: mStart.getFullYear(), salesUsd: Math.round(sum), pct: companyTarget > 0 ? Math.round((sum / companyTarget) * 100) : null });
    }

    // Top shift/branch this month.
    const shiftBoard = Object.values(byShift).map((s) => ({ ...s, salesUsd: Math.round(s.salesUsd) })).sort((a, b) => b.salesUsd - a.salesUsd);
    const topShift = shiftBoard[0] || null;

    const meRow = leaderboard.find((o) => o.ownerId === req.user.id) || null;

    res.json({
      role: req.user.role,
      metrics: {
        totalLeads, generatedToday, assignedToday, untouched,
        salesThisMonthUsd: Math.round(salesThisMonthUsd), convertedThisMonth,
        pipelineUsd: Math.round(pipelineUsd),
        awaitingUsd: Math.round(awaitingUsd),
        newSalesUsd: Math.round(newSalesUsd), crossSalesUsd: Math.round(crossSalesUsd),
        newSalesCount, crossSalesCount,
        companyTarget: Math.round(companyTarget),
        companyPct: companyTarget > 0 ? Math.round((salesThisMonthUsd / companyTarget) * 100) : null,
        generatedTarget: targetForToday(targetsById[req.user.id], 'transfer'),
      },
      lists: { generatedToday: genTodayList, assignedToday: assignedTodayList, untouched: untouchedList },
      me: meRow ? {
        salesUsd: meRow.salesUsd, salesTarget: meRow.salesTarget, pct: meRow.pct, remaining: meRow.remaining,
        transfersToday: meRow.transfersToday, transferDailyTarget: meRow.transferDailyTarget,
        newSalesUsd: meRow.newSalesUsd, crossSalesUsd: meRow.crossSalesUsd,
        pipelineUsd: Math.round(meRow.pipelineUsd || 0),
        leadsGeneratedMonth: meRow.leadsGeneratedMonth || 0,
        leadsGeneratedToday: meRow.leadsGeneratedToday || 0,
        leadGenTarget: ((targetsById[req.user.id] || {}).leadGen && (targetsById[req.user.id] || {}).leadGen.enabled)
          ? Number((targetsById[req.user.id] || {}).leadGen.monthly || 0) : 0,
      } : null,
      leaderboard, transferBoard, trend, shiftBoard, topShift,
    });
  } catch (e) { next(e); }
});

// Small helper: a compact lead descriptor for dashboard mini-tables.
function leadBrief(l) {
  return { _id: l.id, name: `${l.firstName || ''} ${l.lastName || ''}`.trim() || '(no name)', website: l.website || '', ownerName: l.ownerName, status: l.status, lastActivityAt: l.lastActivityAt };
}
function targetForToday(targets, kind) {
  if (!targets) return 0;
  if (kind === 'transfer' && targets.transfer && targets.transfer.enabled) return Number(targets.transfer.daily || 0);
  return 0;
}

router.get('/converted', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'manager') {
      return res.status(403).json({ error: 'Only managers and admins can view converted leads.' });
    }
    const where = await visibilityWhere(req.user);
    where.status = 'converted';
    const leads = await Lead.findAll({ where, order: [['convertedAt', 'DESC'], ['updatedAt', 'DESC']], limit: 1000 });
    res.json({ items: leads.map((l) => l.toJSON()) });
  } catch (e) { next(e); }
});

/** GET /api/leads/deals/board — every deal across the leads visible to the
    user, flattened with its parent lead info, for the kanban pipeline board.
    Declared before /:id so "deals" isn't captured as an id. */
router.get('/deals/board', requireAuth, async (req, res, next) => {
  try {
    const where = await visibilityWhere(req.user);
    const leads = await Lead.findAll({ where, attributes: ['id', 'firstName', 'lastName', 'ownerName', 'deals'] });
    const deals = [];
    for (const l of leads) {
      for (const d of (l.deals || [])) {
        deals.push({
          ...d,
          leadId: l.id,
          leadName: `${l.firstName || ''} ${l.lastName || ''}`.trim() || '(no name)',
          ownerName: l.ownerName,
        });
      }
    }
    res.json({ deals });
  } catch (e) { next(e); }
});

/** GET /api/leads/reminders/count — open tasks/calls due today or overdue,
    across the leads visible to the user. Powers the in-app reminder badge.
    Declared before /:id so "reminders" isn't captured as an id. */
router.get('/reminders/count', requireAuth, async (req, res, next) => {
  try {
    const where = await visibilityWhere(req.user);
    const leads = await Lead.findAll({ where, attributes: ['id', 'activities'] });
    const now = new Date();
    const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    let due = 0;
    const items = [];
    for (const l of leads) {
      for (const a of (l.activities || [])) {
        if (a.status === 'done') continue;
        const d = a.kind === 'task' ? a.dueDate : (a.date ? `${a.date}T${a.time || '00:00'}` : '');
        if (!d) continue;
        const dd = new Date(d);
        if (dd <= endToday) { due++; items.push({ leadId: l.id, kind: a.kind, title: a.title, when: d, overdue: dd < now }); }
      }
    }
    res.json({ due, items: items.slice(0, 20) });
  } catch (e) { next(e); }
});

/** GET /api/leads/:id — single lead (must be visible to the user). */
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const lead = await Lead.findByPk(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });
    if (!(await canAccessLead(req.user, lead))) return res.status(403).json({ error: 'You do not have access to this lead.' });
    const reports = await Report.findAll({ where: { leadId: lead.id }, order: [['createdAt', 'DESC']] });
    res.json({ lead: lead.toJSON(), reports: reports.map((r) => r.toJSON()) });
  } catch (e) { next(e); }
});

// Resolve owner fields (validate the chosen owner is assignable by this user).
async function resolveOwner(user, ownerId) {
  let owner;
  if (ownerId && (user.role === 'admin' || user.role === 'manager')) {
    owner = await User.findByPk(ownerId);
  }
  if (!owner) owner = await User.findByPk(user.id); // default to self
  return owner;
}

/** POST /api/leads — create a single lead. */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.firstName || !String(b.firstName).trim()) return res.status(400).json({ error: 'First name is required.' });
    const owner = await resolveOwner(req.user, b.ownerId);

    const lead = await Lead.create({
      ownerId: owner.id,
      ownerName: owner.name,
      ownerTeam: owner.team || 'Bhubaneswar',
      ownerShift: owner.shift || 'Morning',
      firstName: String(b.firstName).slice(0, 120),
      lastName: String(b.lastName || '').slice(0, 120),
      website: String(b.website || '').slice(0, 255),
      domain: toDomain(b.website),
      email: String(b.email || '').slice(0, 180),
      secondaryEmail: String(b.secondaryEmail || '').slice(0, 180),
      mobile: String(b.mobile || '').slice(0, 40),
      phone: String(b.phone || '').slice(0, 40),
      leadSource: String(b.leadSource || '').slice(0, 60),
      generatedBy: String(b.generatedBy || '').slice(0, 120),
      status: String(b.status || 'new').slice(0, 40),
      servicesInterested: Array.isArray(b.servicesInterested) ? b.servicesInterested.slice(0, 30) : [],
      tags: Array.isArray(b.tags) && b.tags.length ? b.tags.slice(0, 30) : ['New Lead'],
      country: String(b.country || '').slice(0, 80),
      city: String(b.city || '').slice(0, 120),
      timezone: String(b.timezone || '').slice(0, 80),
      additionalInfo: String(b.additionalInfo || '').slice(0, 10000),
      lastActivityAt: new Date(),
      assignedAt: new Date(),
      timeline: [{ type: 'created', text: 'Lead created', time: new Date().toISOString(), author: req.user.name }],
    });
    await AuditLog.create({ userId: req.user.id, userName: req.user.name, action: 'lead.create', target: lead.website || lead.email, ip: req.ip });
    res.status(201).json(lead.toJSON());
  } catch (e) { next(e); }
});

/** PATCH /api/leads/:id — edit fields (agents/managers/admin can edit). */
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const lead = await Lead.findByPk(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });
    if (!(await canAccessLead(req.user, lead))) return res.status(403).json({ error: 'You do not have access to this lead.' });
    const b = req.body || {};
    const author = req.user.name;

    // Owner reassignment (admin/manager only)
    if (b.ownerId && b.ownerId !== lead.ownerId && (req.user.role === 'admin' || req.user.role === 'manager')) {
      const owner = await resolveOwner(req.user, b.ownerId);
      lead.ownerId = owner.id; lead.ownerName = owner.name;
      lead.ownerTeam = owner.team || lead.ownerTeam; lead.ownerShift = owner.shift || lead.ownerShift;
      pushTimeline(lead, 'owner', `Owner changed to ${owner.name}`, author);
      lead.assignedAt = new Date();
    }
    if (b.status !== undefined && b.status !== lead.status) {
      pushTimeline(lead, 'status', `Status changed to "${b.status}"`, author);
      lead.status = String(b.status).slice(0, 40);
    }
    const simple = ['firstName', 'lastName', 'email', 'secondaryEmail', 'mobile', 'phone', 'leadSource', 'generatedBy', 'country', 'city', 'timezone', 'additionalInfo'];
    for (const f of simple) if (b[f] !== undefined) lead[f] = String(b[f]).slice(0, 10000);
    if (b.website !== undefined) { lead.website = String(b.website).slice(0, 255); lead.domain = toDomain(b.website); }
    if (b.servicesInterested !== undefined) { lead.servicesInterested = Array.isArray(b.servicesInterested) ? b.servicesInterested.slice(0, 30) : []; lead.changed('servicesInterested', true); }
    if (b.tags !== undefined) { lead.tags = Array.isArray(b.tags) ? b.tags.slice(0, 30) : []; lead.changed('tags', true); }

    lead.lastActivityAt = new Date();
    await lead.save();
    res.json(lead.toJSON());
  } catch (e) { next(e); }
});

/** DELETE /api/leads/:id — ADMIN ONLY. Managers/agents cannot delete. */
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only an admin can delete leads.' });
    const lead = await Lead.findByPk(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });
    // Detach any reports that pointed at this lead so nothing dangles.
    try {
      const { Report } = require('../models');
      const linked = await Report.findAll({ where: { leadId: lead.id } });
      for (const r of linked) { r.leadId = null; await r.save(); }
    } catch { /* best effort */ }
    await lead.destroy();
    await AuditLog.create({ userId: req.user.id, userName: req.user.name, action: 'lead.delete', target: lead.website || lead.email, ip: req.ip });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// NOTES — simple timestamped notes on a lead.
// ---------------------------------------------------------------------------
router.post('/:id/notes', requireAuth, async (req, res, next) => {
  try {
    const lead = await Lead.findByPk(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });
    if (!(await canAccessLead(req.user, lead))) return res.status(403).json({ error: 'No access to this lead.' });
    const text = String((req.body && req.body.text) || '').trim();
    if (!text) return res.status(400).json({ error: 'Note text is required.' });
    const notes = Array.isArray(lead.notes) ? lead.notes : [];
    const note = { id: `n_${Date.now()}`, text: text.slice(0, 5000), time: new Date().toISOString(), author: req.user.name };
    notes.push(note);
    lead.notes = notes; lead.changed('notes', true);
    pushTimeline(lead, 'note', 'Note added', req.user.name);
    await lead.save();
    res.json(lead.toJSON());
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// ACTIVITIES — tasks and calls. Each activity:
//   { id, kind:'task'|'call', mode:'scheduled'|'done', title/agenda, date, time,
//     timezone, description, priority (task), reminder{on,at} (call/scheduled),
//     dueDate (task), status:'open'|'done', createdBy, createdAt }
// ---------------------------------------------------------------------------
router.post('/:id/activities', requireAuth, async (req, res, next) => {
  try {
    const lead = await Lead.findByPk(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });
    if (!(await canAccessLead(req.user, lead))) return res.status(403).json({ error: 'No access to this lead.' });
    const b = req.body || {};
    const kind = b.kind === 'call' ? 'call' : 'task';
    const list = Array.isArray(lead.activities) ? lead.activities : [];

    const act = {
      id: `a_${Date.now()}`,
      kind,
      mode: b.mode === 'done' ? 'done' : 'scheduled',
      status: b.mode === 'done' ? 'done' : 'open',
      createdBy: req.user.name,
      createdAt: new Date().toISOString(),
    };
    if (kind === 'call') {
      act.agenda = String(b.agenda || '').slice(0, 500);
      act.date = b.date || '';
      act.time = b.time || '';
      act.timezone = String(b.timezone || '').slice(0, 80);
      act.reminder = b.reminder && b.reminder.on ? { on: true, at: b.reminder.at || `${b.date}T${b.time || '09:00'}` } : { on: false };
      if (b.mode === 'done' && b.durationMin != null) act.durationMin = Number(b.durationMin) || 0;
      act.title = act.agenda || 'Call';
    } else {
      act.title = String(b.title || '').slice(0, 200) || 'Task';
      act.dueDate = b.dueDate || '';
      act.description = String(b.description || '').slice(0, 2000);
      act.priority = String(b.priority || 'Medium').slice(0, 20);
    }
    list.push(act);
    lead.activities = list; lead.changed('activities', true);
    pushTimeline(lead, kind, `${kind === 'call' ? 'Call' : 'Task'} ${act.mode === 'done' ? 'logged' : 'scheduled'}: ${act.title}`, req.user.name);
    await lead.save();
    res.json(lead.toJSON());
  } catch (e) { next(e); }
});

// Mark an activity done / reopen, or edit basic fields.
router.patch('/:id/activities/:actId', requireAuth, async (req, res, next) => {
  try {
    const lead = await Lead.findByPk(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });
    if (!(await canAccessLead(req.user, lead))) return res.status(403).json({ error: 'No access to this lead.' });
    const list = Array.isArray(lead.activities) ? lead.activities : [];
    const act = list.find((a) => a.id === req.params.actId);
    if (!act) return res.status(404).json({ error: 'Activity not found.' });
    const b = req.body || {};
    if (b.status === 'done' || b.status === 'open') {
      act.status = b.status;
      act.mode = b.status === 'done' ? 'done' : act.mode;
      if (b.status === 'done') pushTimeline(lead, act.kind, `${act.kind === 'call' ? 'Call' : 'Task'} completed: ${act.title}`, req.user.name);
    }
    lead.activities = list; lead.changed('activities', true);
    await lead.save();
    res.json(lead.toJSON());
  } catch (e) { next(e); }
});

// Delete an activity — admin only (per delete policy).
router.delete('/:id/activities/:actId', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only an admin can delete.' });
    const lead = await Lead.findByPk(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });
    lead.activities = (Array.isArray(lead.activities) ? lead.activities : []).filter((a) => a.id !== req.params.actId);
    lead.changed('activities', true);
    await lead.save();
    res.json(lead.toJSON());
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// DEALS — multiple deals per lead, each with a sales stage (kanban-ready).
// ---------------------------------------------------------------------------
router.post('/:id/deals', requireAuth, async (req, res, next) => {
  try {
    const lead = await Lead.findByPk(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });
    if (!(await canAccessLead(req.user, lead))) return res.status(403).json({ error: 'No access to this lead.' });
    const b = req.body || {};
    if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'Deal name is required.' });
    const list = Array.isArray(lead.deals) ? lead.deals : [];

    // New vs Cross sale: if the lead already has any closed-won deal (i.e. it's
    // already a won client), this new deal is a cross-sale; otherwise it's a
    // new sale. (Installment-level attribution is resolved when each is paid.)
    const alreadyWon = list.some((d) => d.stage === 'closed_won') || lead.status === 'converted';
    const saleType = alreadyWon ? 'cross' : 'new';

    const amount = Number(b.amount) || 0;
    const stage = String(b.stage || 'qualification').slice(0, 40);
    const winDate = stage === 'closed_won' ? new Date() : null;

    // Payment plan. structure = 'full' | 'installments'. When installments,
    // build the schedule (overridable client rows can also be passed directly).
    const paymentStructure = b.paymentStructure === 'installments' ? 'installments' : 'full';
    let installments = [];
    if (paymentStructure === 'installments') {
      if (Array.isArray(b.installments) && b.installments.length) {
        installments = b.installments.map((it, i) => ({
          id: it.id || `inst_${Date.now()}_${i}`, seq: i + 1,
          amount: Number(it.amount) || 0,
          dueDate: it.dueDate || '', paid: !!it.paid, paidDate: it.paidDate || null,
        }));
      } else {
        installments = buildInstallments(amount, b.installmentCount || 1, winDate || b.expectedClose || new Date());
      }
    } else {
      // Full payment = a single installment equal to the amount, due at win.
      installments = [{ id: `inst_${Date.now()}_0`, seq: 1, amount, dueDate: (winDate ? winDate.toISOString().slice(0, 10) : (b.expectedClose || '')), paid: false, paidDate: null }];
    }

    const deal = {
      id: `d_${Date.now()}`,
      name: String(b.name).slice(0, 200),
      stage,
      currency: String(b.currency || 'USD').slice(0, 8),
      amount,
      expectedClose: b.expectedClose || '',
      service: String(b.service || '').slice(0, 120),
      remark: String(b.remark || '').slice(0, 2000),
      saleType,
      planType: String(b.planType || 'one-time').slice(0, 40), // one-time | 3-month | 6-month | 12-month | custom
      planDuration: String(b.planDuration || '').slice(0, 40),
      paymentStructure,
      installments,
      wonAt: winDate ? winDate.toISOString() : null,
      createdBy: req.user.name,
      createdAt: new Date().toISOString(),
    };
    list.push(deal);
    lead.deals = list; lead.changed('deals', true);
    pushTimeline(lead, 'deal', `Deal added: ${deal.name} (${deal.currency} ${deal.amount}, ${saleType === 'new' ? 'new sale' : 'cross-sale'})`, req.user.name);
    if (deal.stage === 'closed_won' && lead.status !== 'converted') {
      lead.status = 'converted';
      lead.convertedAt = new Date();
      pushTimeline(lead, 'status', 'Lead converted (deal closed won)', req.user.name);
    }
    await lead.save();
    res.json(lead.toJSON());
  } catch (e) { next(e); }
});

router.patch('/:id/deals/:dealId', requireAuth, async (req, res, next) => {
  try {
    const lead = await Lead.findByPk(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });
    if (!(await canAccessLead(req.user, lead))) return res.status(403).json({ error: 'No access to this lead.' });
    const list = Array.isArray(lead.deals) ? lead.deals : [];
    const deal = list.find((d) => d.id === req.params.dealId);
    if (!deal) return res.status(404).json({ error: 'Deal not found.' });
    const b = req.body || {};
    const before = deal.stage;
    for (const f of ['name', 'stage', 'currency', 'expectedClose', 'service', 'remark', 'planType', 'planDuration']) if (b[f] !== undefined) deal[f] = String(b[f]).slice(0, 2000);
    if (b.amount !== undefined) deal.amount = Number(b.amount) || 0;

    // Replace installment schedule if provided (edits to amounts/dates/paid).
    if (Array.isArray(b.installments)) {
      deal.installments = b.installments.map((it, i) => ({
        id: it.id || `inst_${Date.now()}_${i}`, seq: i + 1,
        amount: Number(it.amount) || 0,
        dueDate: it.dueDate || '', paid: !!it.paid,
        paidDate: it.paid ? (it.paidDate || new Date().toISOString().slice(0, 10)) : null,
      }));
      deal.paymentStructure = deal.installments.length > 1 ? 'installments' : (deal.paymentStructure || 'full');
    }

    if (b.stage && b.stage !== before) {
      pushTimeline(lead, 'deal', `Deal "${deal.name}" moved to ${deal.stage}`, req.user.name);
      if (b.stage === 'closed_won') {
        // Stamp win date; seed installment due-dates from it if not already set.
        deal.wonAt = deal.wonAt || new Date().toISOString();
        // Guarantee a payment schedule exists so the money can be collected.
        if (!Array.isArray(deal.installments) || deal.installments.length === 0) {
          deal.installments = buildInstallments(deal.amount, 1, deal.wonAt);
          deal.paymentStructure = deal.paymentStructure || 'full';
        }
        if (Array.isArray(deal.installments) && deal.installments.length && !deal.installments[0].dueDate) {
          const seeded = buildInstallments(deal.amount, deal.installments.length, deal.wonAt);
          deal.installments = deal.installments.map((it, i) => ({ ...it, dueDate: it.dueDate || seeded[i].dueDate, amount: it.amount || seeded[i].amount }));
        }
        if (lead.status !== 'converted') {
          lead.status = 'converted';
          lead.convertedAt = new Date();
          pushTimeline(lead, 'status', 'Lead converted (deal closed won)', req.user.name);
        }
      }
    }
    lead.deals = list; lead.changed('deals', true);
    await lead.save();
    res.json(lead.toJSON());
  } catch (e) { next(e); }
});

// Mark a single installment paid/unpaid (or override its date/amount). The
// paid date is what the dashboard counts as collected sales.
router.patch('/:id/deals/:dealId/installments/:instId', requireAuth, async (req, res, next) => {
  try {
    const lead = await Lead.findByPk(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });
    if (!(await canAccessLead(req.user, lead))) return res.status(403).json({ error: 'No access to this lead.' });
    const list = Array.isArray(lead.deals) ? lead.deals : [];
    const deal = list.find((d) => d.id === req.params.dealId);
    if (!deal) return res.status(404).json({ error: 'Deal not found.' });
    // Legacy deals (created before payment schedules existed) may have no
    // installments. Backfill a single full-payment installment so the money can
    // still be marked collected.
    if (!Array.isArray(deal.installments) || deal.installments.length === 0) {
      deal.installments = [{
        id: `inst_${Date.now()}_0`, seq: 1, amount: Number(deal.amount) || 0,
        dueDate: (deal.wonAt ? String(deal.wonAt).slice(0, 10) : (deal.expectedClose || new Date().toISOString().slice(0, 10))),
        paid: false, paidDate: null,
      }];
      deal.paymentStructure = deal.paymentStructure || 'full';
    }
    const inst = (deal.installments || []).find((it) => it.id === req.params.instId);
    if (!inst) return res.status(404).json({ error: 'Installment not found.' });
    const b = req.body || {};
    if (b.paid !== undefined) {
      inst.paid = !!b.paid;
      inst.paidDate = b.paid ? (b.paidDate || new Date().toISOString().slice(0, 10)) : null;
      if (b.paid) pushTimeline(lead, 'deal', `Installment ${inst.seq} of "${deal.name}" marked paid (${deal.currency} ${inst.amount})`, req.user.name);
    }
    if (b.dueDate !== undefined) inst.dueDate = b.dueDate;
    if (b.amount !== undefined) inst.amount = Number(b.amount) || 0;
    lead.deals = list; lead.changed('deals', true);
    await lead.save();
    res.json(lead.toJSON());
  } catch (e) { next(e); }
});

router.delete('/:id/deals/:dealId', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only an admin can delete.' });
    const lead = await Lead.findByPk(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });
    lead.deals = (Array.isArray(lead.deals) ? lead.deals : []).filter((d) => d.id !== req.params.dealId);
    lead.changed('deals', true);
    await lead.save();
    res.json(lead.toJSON());
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.helpers = { toDomain, visibilityWhere, canAccessLead };

const router = require('express').Router();
const { Lead, User, Report, Settings, AuditLog, Op } = require('../models');
const { requireAuth } = require('../middleware/auth');
const { generateBrief, isStale, CACHE_DAYS } = require('../services/businessBrief');

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
  // A lead manager assigns work across the whole floor, so they need to see
  // every lead — but they never own one, so this is read/coordinate access
  // rather than a book of their own.
  if (user.role === 'leadmanager') return {};
  if (user.role === 'manager') {
    const scopes = Array.isArray(user.managerScopes) ? user.managerScopes : [];
    const scopeOr = scopes
      .filter((s) => s && s.team && s.shift)
      .map((s) => ({ ownerTeam: s.team, ownerShift: s.shift }));
    // Agents whose team+shift this manager oversees. A prospect transferred out
    // of the team still shows to the originating agent's manager, so we match on
    // the generator's id as well as current ownership.
    const scopedAgentIds = await User.findAll({
      where: scopeOr.length ? { [Op.or]: scopeOr.map((s) => ({ team: s.ownerTeam, shift: s.ownerShift })) } : { id: -1 },
      attributes: ['id'],
    }).then((rows) => rows.map((r) => r.id)).catch(() => []);
    return {
      [Op.or]: [
        { ownerId: user.id },
        { generatedById: user.id },
        ...scopeOr,
        // leads this manager's own agents generated, wherever they now live
        ...(scopedAgentIds.length ? [{ generatedById: { [Op.in]: scopedAgentIds } }] : []),
      ],
    };
  }
  // An agent sees leads they own, plus any prospect they generated and then
  // transferred to someone else (they stay in the loop on their own leads).
  return { [Op.or]: [{ ownerId: user.id }, { generatedById: user.id }] };
}

// Can this user see/edit this specific lead?
async function canAccessLead(user, lead) {
  if (user.role === 'admin') return true;
  if (user.role === 'leadmanager') return true; // coordinates across all leads
  if (lead.ownerId === user.id) return true;
  // The agent who generated a prospect keeps access after transferring it.
  if (lead.generatedById && lead.generatedById === user.id) return true;
  if (user.role === 'manager') {
    const scopes = Array.isArray(user.managerScopes) ? user.managerScopes : [];
    if (scopes.some((s) => s && s.team === lead.ownerTeam && s.shift === lead.ownerShift)) return true;
    // A lead one of this manager's agents generated stays visible after being
    // transferred out of the team.
    if (lead.generatedById) {
      const gen = await User.findByPk(lead.generatedById).catch(() => null);
      if (gen && scopes.some((s) => s && s.team === gen.team && s.shift === gen.shift)) return true;
    }
    return false;
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

/**
 * Append an entry to the lead's activity timeline.
 *
 * `meta` carries structured extras the UI needs — the note body, the linked
 * activity id, its due time — so the timeline can show what actually happened
 * ("Note: chased about the proposal") rather than a generic "Note added", and
 * can flag a scheduled call that was never completed.
 */
/**
 * True if the lead has at least one scheduled call or task that is still open
 * and dated in the future. Such a lead is being handled as agreed (the customer
 * asked to be contacted later), so it should be exempt from the "untouched 3+
 * days" flag until that date arrives.
 */
function hasPendingFutureActivity(lead) {
  const now = Date.now();
  for (const a of (lead.activities || [])) {
    if (a.status === 'done') continue;
    const at = a.kind === 'call'
      ? (a.date ? `${a.date}T${a.time || '09:00'}` : '')
      : (a.dueDate ? `${a.dueDate}T17:00` : '');
    if (!at) continue;
    const t = new Date(at).getTime();
    if (!Number.isNaN(t) && t > now) return true;
  }
  return false;
}

function pushTimeline(lead, type, text, author, meta) {
  const tl = Array.isArray(lead.timeline) ? lead.timeline : [];
  tl.push({ type, text, time: new Date().toISOString(), author, ...(meta || {}) });
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


/**
 * Months between billings for each recurring interval.
 */
const RECURRING_MONTHS = { monthly: 1, quarterly: 3, 'half-yearly': 6, yearly: 12 };

/**
 * Build the next `count` billing cycles for a recurring deal. Unlike
 * installments — which split one total between them — every recurring cycle
 * charges the FULL amount, because the customer is being billed again rather
 * than paying off a single sale.
 *
 * We generate a rolling window (3 by default) rather than an infinite schedule:
 * a recurring contract has no natural end, and the admin only needs to see what
 * is coming up in order to mark it collected.
 */
function buildRecurringCycles(amount, interval, startDate, count = 3, existingCount = 0) {
  const step = RECURRING_MONTHS[interval] || 1;
  const start = startDate ? new Date(startDate) : new Date();
  const out = [];
  const stamp = Date.now();
  for (let i = 0; i < count; i++) {
    const due = new Date(start);
    due.setMonth(due.getMonth() + step * (existingCount + i));
    out.push({
      id: `inst_${stamp}_r${existingCount + i}`,
      seq: existingCount + i + 1,
      amount: Number(amount) || 0,
      dueDate: due.toISOString().slice(0, 10),
      paid: false,
      paidDate: null,
      recurring: true,
    });
  }
  return out;
}


/** GET /api/leads — list leads visible to the current user (with search/filter). */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const where = await visibilityWhere(req.user);
    const { q, status, source, ownerId, country, untouched, stage } = req.query;
    // Converted leads live on their own page, which only managers and admins
    // can open. An agent must never see them here either — otherwise picking
    // "converted" in the status filter would be a way around that.
    if (req.user.role === 'agent') {
      where.status = (status && status !== 'converted') ? status : { [Op.ne]: 'converted' };
    } else if (status) {
      where.status = status;
    } else {
      where.status = { [Op.ne]: 'converted' };
    }
    // The funnel splits in two: "prospects" are call-back-generated leads not
    // yet worked; "leads" is everything past that stage. The Prospects tab asks
    // for stage=prospect; the main Leads list asks for stage=lead (or nothing,
    // in which case callbacks are still excluded so they don't leak in). An
    // explicit status filter overrides the split.
    if (!status) {
      if (stage === 'prospect') {
        where.status = 'callback';
      } else if (stage === 'lead') {
        where.status = { [Op.notIn]: ['converted', 'callback'] };
      } else {
        where.status = { [Op.notIn]: ['converted', 'callback'] };
      }
    }
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
    // Pagination: `page` (1-based) and `perPage` (10/20/50/100). Returns the
    // slice plus totals so the client can render page controls.
    const perPage = Math.min(100, Math.max(1, Number(req.query.perPage) || 20));
    const page = Math.max(1, Number(req.query.page) || 1);

    // The "untouched" view needs the same exemption as the dashboard: a lead
    // with a scheduled future activity isn't really untouched. Activities are
    // JSON so this can't be a SQL filter — fetch the stale set and remove the
    // exempt ones in memory before paginating. The untouched set is small, so
    // this stays cheap.
    if (untouched) {
      const all = await Lead.findAll({ where, order: [['lastActivityAt', 'DESC'], ['createdAt', 'DESC']] });
      const filtered = all.filter((l) => !hasPendingFutureActivity(l));
      const total = filtered.length;
      const start = (page - 1) * perPage;
      return res.json({
        items: filtered.slice(start, start + perPage).map((l) => l.toJSON()),
        total, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)),
      });
    }

    const { count, rows } = await Lead.findAndCountAll({
      where,
      order: [['lastActivityAt', 'DESC'], ['createdAt', 'DESC']],
      limit: perPage,
      offset: (page - 1) * perPage,
    });
    res.json({
      items: rows.map((l) => l.toJSON()),
      total: count,
      page,
      perPage,
      pages: Math.max(1, Math.ceil(count / perPage)),
    });
  } catch (e) { next(e); }
});

/**
 * GET /api/leads/recent-wins — sales collected in the last hour, newest first,
 * for the celebration banner. Everyone sees the same company-wide feed so a win
 * is visible to the whole floor. Admin-owned deals are excluded for non-admins
 * (usually test data).
 */
router.get('/recent-wins', requireAuth, async (req, res, next) => {
  try {
    const users = await User.findAll({ attributes: ['id', 'name', 'role', 'avatar'] });
    const roleById = {}; const userById = {};
    for (const u of users) { roleById[u.id] = u.role; userById[u.id] = u; }
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const fx = (s && s.crmConfig && s.crmConfig.fxRates) || { USD: 1 };
    const toUsd = (amt, cur) => { const r = fx[cur] || 1; return r ? Number(amt || 0) / r : Number(amt || 0); };

    const cutoff = Date.now() - 60 * 60 * 1000;
    const viewerIsAdmin = req.user.role === 'admin';
    const leads = await Lead.findAll({ where: { status: 'converted' }, limit: 2000 });
    const wins = [];
    for (const l of leads) {
      if (!viewerIsAdmin && roleById[l.ownerId] === 'admin') continue;
      for (const d of (l.deals || [])) {
        if (d.stage !== 'closed_won') continue;
        for (const it of (d.installments || [])) {
          if (!it.paid || !it.paidDate) continue;
          // paidDate is date-only; wonAt gives the hour precision the banner needs.
          const when = it.paidAt ? new Date(it.paidAt).getTime()
            : (d.wonAt ? new Date(d.wonAt).getTime() : new Date(it.paidDate).getTime());
          if (when < cutoff) continue;
          const owner = userById[l.ownerId];
          wins.push({
            id: `${l.id}_${d.id}_${it.id}`,
            ownerId: l.ownerId, ownerName: l.ownerName || (owner && owner.name) || 'Someone',
            avatar: owner && owner.avatar ? owner.avatar : null,
            amountUsd: Math.round(toUsd(it.amount, d.currency)),
            currency: d.currency, amount: Number(it.amount || 0),
            dealName: d.name, at: new Date(when).toISOString(),
          });
        }
      }
    }
    wins.sort((a, b) => new Date(b.at) - new Date(a.at));
    res.json({ wins: wins.slice(0, 10), latest: wins[0] || null });
  } catch (e) { next(e); }
});

/**
 * GET /api/leads/lm-dashboard — the lead manager's home screen.
 *
 * A lead manager coordinates rather than sells, so their dashboard is about
 * throughput: what they keyed in and assigned, what drafts have come back, and
 * how the pre-sales team (names, not logins) is performing. Everything here is
 * scoped to leads THEY entered, except the team-performance blocks, which count
 * every pre-sales lead by its "generated by" attribution.
 */
router.get('/lm-dashboard', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'leadmanager' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Lead managers only.' });
    }
    const settings = await Settings.findOne({ where: { singleton: 'settings' } });
    const team = (settings && settings.crmConfig && settings.crmConfig.presalesTeam) || [];

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Everything this lead manager keyed in. Admin sees all entered leads so
    // the screen is reviewable.
    const enteredWhere = req.user.role === 'admin' ? { enteredById: { [Op.ne]: null } } : { enteredById: req.user.id };
    const entered = await Lead.findAll({ where: enteredWhere, order: [['createdAt', 'DESC']], limit: 1000 });

    const isToday = (d) => d && new Date(d) >= startOfDay;
    const isThisMonth = (d) => d && new Date(d) >= startOfMonth;

    // Blocks 1-2: assignment throughput. A lead counts as "assigned" once it
    // has an owner and an assignment timestamp.
    const assignedToday = entered.filter((l) => l.ownerId && isToday(l.assignedAt || l.createdAt)).length;
    const assignedMonth = entered.filter((l) => l.ownerId && isThisMonth(l.assignedAt || l.createdAt)).length;

    // Block 3: the five most recently added.
    const recentLeads = entered.slice(0, 5).map((l) => ({
      _id: l.id, name: `${l.firstName || ''} ${l.lastName || ''}`.trim(),
      website: l.website, ownerName: l.ownerName, source: l.leadSource,
      createdAt: l.createdAt, generatedBy: l.generatedBy,
    }));

    // Block 4: drafts handed back by owners, newest first.
    const withDraft = entered.filter((l) => l.firstDraftAt)
      .sort((a, b) => new Date(b.firstDraftAt) - new Date(a.firstDraftAt));
    const recentDrafts = withDraft.slice(0, 5).map((l) => ({
      _id: l.id, name: `${l.firstName || ''} ${l.lastName || ''}`.trim(),
      ownerName: l.ownerName, firstDraftAt: l.firstDraftAt,
      preview: String(l.firstDraft || '').slice(0, 140),
    }));

    // Block 5: leads assigned to date, grouped by the agent/manager owning them.
    const byOwner = {};
    for (const l of entered) {
      if (!l.ownerId) continue;
      byOwner[l.ownerId] = byOwner[l.ownerId] || { ownerId: l.ownerId, ownerName: l.ownerName, total: 0, thisMonth: 0, today: 0 };
      byOwner[l.ownerId].total++;
      const when = l.assignedAt || l.createdAt;
      if (isThisMonth(when)) byOwner[l.ownerId].thisMonth++;
      if (isToday(when)) byOwner[l.ownerId].today++;
    }
    const assignmentTable = Object.values(byOwner).sort((a, b) => b.thisMonth - a.thisMonth);

    // Blocks 6-8: pre-sales team performance. Attribution is by the "generated
    // by" name, so this counts EVERY pre-sales lead, not only ones this manager
    // entered — the team's output is the team's output.
    const presalesLeads = await Lead.findAll({
      where: { leadSource: { [Op.like]: '%re-%ales%' } },
      attributes: ['generatedBy', 'createdAt'], limit: 5000,
    });
    const norm = (s) => String(s || '').trim();
    const teamStats = {};
    for (const name of team) teamStats[name] = { name, today: 0, month: 0, total: 0 };
    for (const l of presalesLeads) {
      const g = norm(l.generatedBy);
      if (!g || !(g in teamStats)) continue; // only attribute to configured members
      teamStats[g].total++;
      if (isThisMonth(l.createdAt)) teamStats[g].month++;
      if (isToday(l.createdAt)) teamStats[g].today++;
    }
    const teamPerformance = Object.values(teamStats).sort((a, b) => b.month - a.month);
    const teamToday = teamPerformance.reduce((s, m) => s + m.today, 0);
    const teamLeaderboard = teamPerformance.filter((m) => m.month > 0).slice(0, 10);

    // Block 7: daily lead-gen trend for the current month (team totals).
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const trend = Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1, leads: 0 }));
    for (const l of presalesLeads) {
      const g = norm(l.generatedBy);
      if (!g || !(g in teamStats)) continue;
      const d = new Date(l.createdAt);
      if (d >= startOfMonth && d.getMonth() === now.getMonth()) trend[d.getDate() - 1].leads++;
    }

    res.json({
      role: req.user.role,
      metrics: {
        assignedToday, assignedMonth,
        totalEntered: entered.length,
        draftsReceived: withDraft.length,
        teamToday,
        teamMonth: teamPerformance.reduce((s, m) => s + m.month, 0),
      },
      recentLeads,
      recentDrafts,
      assignmentTable,
      teamPerformance,
      teamLeaderboard,
      trend,
      teamConfigured: team.length,
    });
  } catch (e) { next(e); }
});

/** GET /api/leads/drafts-received — full list behind the dashboard's "view all". */
/**
 * GET /api/leads/email-drafts — the Lead Manager portal's Email Drafts view.
 *
 * Returns two lists (first-reply and reminder submissions) plus summary counts
 * for the boxes above the tabs: received this month, received today, and
 * completed (read/acknowledged) for each stage.
 *
 * Admin sees every submission; a lead manager sees the ones on leads they
 * entered.
 */
router.get('/email-drafts', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'leadmanager' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Lead managers only.' });
    }
    const scope = req.user.role === 'admin' ? {} : { enteredById: req.user.id };

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const isToday = (d) => d && new Date(d) >= startOfDay;
    const isThisMonth = (d) => d && new Date(d) >= startOfMonth;

    const firstRows = await Lead.findAll({ where: { ...scope, firstDraftAt: { [Op.ne]: null } }, order: [['firstDraftAt', 'DESC']], limit: 500 });
    const remRows = await Lead.findAll({ where: { ...scope, reminderDraftAt: { [Op.ne]: null } }, order: [['reminderDraftAt', 'DESC']], limit: 500 });

    const firstReplies = firstRows.map((l) => ({
      _id: l.id, name: `${l.firstName || ''} ${l.lastName || ''}`.trim(),
      ownerName: l.ownerName, website: l.website,
      subject: l.firstDraftSubject || '', body: l.firstDraft || '',
      submittedAt: l.firstDraftAt, read: !!l.firstDraftRead, readAt: l.firstDraftReadAt,
    }));
    const reminders = remRows.map((l) => ({
      _id: l.id, name: `${l.firstName || ''} ${l.lastName || ''}`.trim(),
      ownerName: l.ownerName, website: l.website,
      subject: l.reminderSubject || '', body: l.reminderDraft || '',
      submittedAt: l.reminderDraftAt, received: !!l.reminderReceived, receivedAt: l.reminderReceivedAt,
    }));

    res.json({
      firstReplies, reminders,
      summary: {
        firstMonth: firstRows.filter((l) => isThisMonth(l.firstDraftAt)).length,
        firstToday: firstRows.filter((l) => isToday(l.firstDraftAt)).length,
        firstCompleted: firstRows.filter((l) => l.firstDraftRead).length,
        reminderMonth: remRows.filter((l) => isThisMonth(l.reminderDraftAt)).length,
        reminderToday: remRows.filter((l) => isToday(l.reminderDraftAt)).length,
        reminderCompleted: remRows.filter((l) => l.reminderReceived).length,
      },
    });
  } catch (e) { next(e); }
});

/** GET /api/leads/drafts-received — legacy list kept for the LM dashboard's "view all". */
router.get('/drafts-received', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'leadmanager' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Lead managers only.' });
    }
    const where = req.user.role === 'admin'
      ? { firstDraftAt: { [Op.ne]: null } }
      : { enteredById: req.user.id, firstDraftAt: { [Op.ne]: null } };
    const rows = await Lead.findAll({ where, order: [['firstDraftAt', 'DESC']], limit: 500 });
    res.json({
      items: rows.map((l) => ({
        _id: l.id, name: `${l.firstName || ''} ${l.lastName || ''}`.trim(),
        ownerName: l.ownerName, website: l.website,
        firstDraftAt: l.firstDraftAt, firstDraft: l.firstDraft,
        firstReplyDoneAt: l.firstReplyDoneAt,
      })),
    });
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
    if (req.user.role === 'admin' || req.user.role === 'leadmanager') {
      // A lead manager assigns every lead they key in to someone else, so they
      // need the whole active roster just like an admin does.
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
    // Importing a sheet creates records in bulk and is easy to get wrong, so
    // it stays with admins and lead managers — the two roles whose job is
    // getting leads into the system. Sellers work the leads they are given.
    if (req.user.role !== 'admin' && req.user.role !== 'leadmanager') {
      return res.status(403).json({ error: 'Only an admin or lead manager can import leads.' });
    }
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
    // Admin-owned deals are normally kept out of company totals and the
    // leaderboard, because admins run test and demo data that would otherwise
    // distort what agents and managers see. An admin looking at their own
    // dashboard, however, wants the truth with nothing hidden — so for an admin
    // viewer nothing is excluded at all.
    const isAdminOwned = (ownerId) => !viewerIsAdmin && roleById[ownerId] === 'admin';

    let totalLeads = 0, generatedToday = 0, assignedToday = 0, untouched = 0;
    let salesThisMonthUsd = 0, convertedThisMonth = 0;
    let awaitingUsd = 0; // won deals whose installments aren't collected yet
    let pipelineUsd = 0; // open (not won/lost) deal value in USD, motivational
    let newSalesUsd = 0, crossSalesUsd = 0, newSalesCount = 0, crossSalesCount = 0;
    // Parallel tally that always excludes admin-owned deals. An admin viewer
    // sees both: the company figure (everything, including their own test and
    // house accounts) and the team figure (what agents and managers actually
    // brought in) — so the two can be told apart at a glance.
    let teamSalesUsd = 0, teamNewSalesUsd = 0, teamCrossSalesUsd = 0;
    let teamNewCount = 0, teamCrossCount = 0, teamAwaitingUsd = 0;
    const byOwner = {};
    const ensure = (id, name) => (byOwner[id] = byOwner[id] || { ownerId: id, name, salesUsd: 0, newSalesUsd: 0, crossSalesUsd: 0, conversions: 0, leads: 0, transfersToday: 0, leadsGeneratedMonth: 0, leadsGeneratedToday: 0 });
    const genTodayList = [], assignedTodayList = [], untouchedList = [];
    const awaitingList = [];

    // Lead-generation analytics. We split by leadSource so the dashboard can
    // show pre-sales vs cold-calling contribution, and bucket by day (current
    // month) and by month (last 6) for the trend charts.
    const isPresales = (s) => /pre[\s-]?sales/i.test(String(s || ''));
    const isColdCall = (s) => /cold[\s-]?call/i.test(String(s || ''));
    let leadsGeneratedMonthTotal = 0, leadsPresalesMonth = 0, leadsColdMonth = 0;
    let leadsAssignedMonthTotal = 0;
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const leadDaily = Array.from({ length: daysInMonth }, (_, i) => ({
      day: i + 1, total: 0, presales: 0, cold: 0,
    }));
    const leadMonthly = [];
    for (let i = 5; i >= 0; i--) {
      const ms = new Date(now.getFullYear(), now.getMonth() - i, 1);
      leadMonthly.push({
        month: ms.toLocaleString('en-US', { month: 'short' }), year: ms.getFullYear(),
        start: ms, end: new Date(now.getFullYear(), now.getMonth() - i + 1, 1),
        total: 0, presales: 0, cold: 0,
      });
    }

    // Per shift/branch tally (by closed-won collected USD this month).
    const byShift = {}; // key `${team}·${shift}`

    for (const l of leads) {
      const created = l.createdAt ? new Date(l.createdAt) : null;
      ensure(l.ownerId, l.ownerName);
      byOwner[l.ownerId].leads++;

      // Lead generation: created this month / today, credited to the owner.
      if (created && created >= startOfMonth) byOwner[l.ownerId].leadsGeneratedMonth++;

      const pres = isPresales(l.leadSource) || isPresales(l.generatedBy);
      const cold = isColdCall(l.leadSource) || isColdCall(l.generatedBy);

      if (created && created >= startOfMonth) {
        leadsGeneratedMonthTotal++;
        if (pres) leadsPresalesMonth++;
        if (cold) leadsColdMonth++;
        const dIdx = created.getDate() - 1;
        if (leadDaily[dIdx]) {
          leadDaily[dIdx].total++;
          if (pres) leadDaily[dIdx].presales++;
          if (cold) leadDaily[dIdx].cold++;
        }
      }
      if (created) {
        for (const b of leadMonthly) {
          if (created >= b.start && created < b.end) {
            b.total++;
            if (pres) b.presales++;
            if (cold) b.cold++;
            break;
          }
        }
      }

      const isConverted = l.status === 'converted';
      const isProspect = l.status === 'callback';
      // Call-back prospects aren't worked leads yet, so they don't count toward
      // the lead total and are never flagged untouched — the 3-day rule doesn't
      // apply until they're transferred.
      if (!isConverted && !isProspect) {
        totalLeads++;
        const last = l.lastActivityAt ? new Date(l.lastActivityAt) : null;
        // A lead with a scheduled future call/task is being handled as agreed —
        // e.g. the customer asked for a call in 15 days — so it must NOT show as
        // untouched even though nothing's happened in the last 3 days. Only flag
        // it when there's no pending future activity to wait on.
        if (last && last < in3d && !hasPendingFutureActivity(l)) {
          untouched++;
          if (untouchedList.length < 8) untouchedList.push(leadBrief(l));
        }
      }

      // "Generated today" = created today. "Assigned today" = handed to a
      // different owner today (assignedAt moved after creation). Keeping them
      // distinct so the admin view can label each with its own icon.
      const createdToday = created && created >= startOfDay;
      const assignedAt = l.assignedAt ? new Date(l.assignedAt) : created;
      const reassignedToday = assignedAt && assignedAt >= startOfDay && created && (assignedAt - created > 60 * 1000);
      if (assignedAt && assignedAt >= startOfMonth && created && (assignedAt - created > 60 * 1000)) leadsAssignedMonthTotal++;

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
          const sk = `${l.ownerTeam}·${l.ownerShift}`;
          byShift[sk] = byShift[sk] || { team: l.ownerTeam, shift: l.ownerShift, salesUsd: 0, pipelineUsd: 0 };
          byShift[sk].pipelineUsd += v;
        }
      }
      // Order deals by wonAt/createdAt so "first deal" is stable.
      wonDeals.sort((a, b) => new Date(a.wonAt || a.createdAt || 0) - new Date(b.wonAt || b.createdAt || 0));
      let leadHasCountedNew = false;
      wonDeals.forEach((d, di) => {
        const insts = (d.installments || []).slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));
        const adminOwned = isAdminOwned(l.ownerId);
        // True regardless of who is viewing — drives the team-only split.
        const ownerIsAdmin = roleById[l.ownerId] === 'admin';
        insts.forEach((it) => {
          if (!it.paid || !it.paidDate) {
            if (!ownerIsAdmin) teamAwaitingUsd += toUsd(it.amount, d.currency);
            if (!adminOwned) {
              awaitingUsd += toUsd(it.amount, d.currency);
              // Keep a followup list of who owes what, soonest due first.
              awaitingList.push({
                leadId: l.id, dealId: d.id, instId: it.id,
                client: `${l.firstName || ''} ${l.lastName || ''}`.trim() || '(no name)',
                dealName: d.name, currency: d.currency, amount: Number(it.amount || 0),
                dueDate: it.dueDate || '', seq: it.seq, ownerName: l.ownerName,
                overdue: !!(it.dueDate && it.dueDate < new Date().toISOString().slice(0, 10)),
              });
            }
            return;
          }
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
            // Team-only split: what agents and managers brought in, never
            // admin-owned deals, whoever is looking.
            if (!ownerIsAdmin) {
              teamSalesUsd += usd;
              if (isNew) { teamNewSalesUsd += usd; teamNewCount++; }
              else { teamCrossSalesUsd += usd; teamCrossCount++; }
            }
            if (!adminOwned) {
              salesThisMonthUsd += usd;
              if (isNew) { newSalesUsd += usd; newSalesCount++; }
              else { crossSalesUsd += usd; crossSalesCount++; }
              const key = `${l.ownerTeam}·${l.ownerShift}`;
              byShift[key] = byShift[key] || { team: l.ownerTeam, shift: l.ownerShift, salesUsd: 0, pipelineUsd: 0 };
              byShift[key].salesUsd += usd;
            }
          }
        });
      });

      // "Call transfers today" now means prospect→lead transfers this owner
      // performed today (F1), not completed calls. Credit the person who did
      // the transfer, which may differ from the current owner — so ensure they
      // have a row even if they own no leads themselves.
      if (l.transferredAt && l.transferredById) {
        const t = new Date(l.transferredAt);
        if (t >= startOfDay) {
          const rec = ensure(l.transferredById, l.transferredByName || 'Unknown');
          rec.transfersToday++;
          rec.transferList = rec.transferList || [];
          if (rec.transferList.length < 10) {
            rec.transferList.push({
              leadId: l.id, leadName: `${l.firstName || ''} ${l.lastName || ''}`.trim(),
              toName: l.ownerName, at: l.transferredAt,
            });
          }
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
      // Seed every in-scope active user (agents AND managers), so the whole
      // team appears on the leaderboard even at zero sales. Admins are seeded
      // too but filtered out for non-admin viewers further down.
      if (u.active !== false && inScope(u)) ensure(u.id, u.name);
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
      // The ranking is an AGENT board for agents and managers: managers and
      // admins are excluded from the competitive list, though the viewer always
      // sees their own row so they can track themselves. An admin viewer sees
      // everyone, unfiltered.
      .filter((o) => viewerIsAdmin || o.role === 'agent' || o.ownerId === req.user.id)
      .sort((a, b) => b.salesUsd - a.salesUsd);

    const transferBoard = leaderboard
      .filter((o) => o.transferDailyTarget > 0 || o.transfersToday > 0)
      .map((o) => ({ ownerId: o.ownerId, name: o.name, avatar: o.avatar, transfersToday: o.transfersToday, dailyTarget: o.transferDailyTarget, pct: o.transferDailyTarget > 0 ? Math.min(100, Math.round((o.transfersToday / o.transferDailyTarget) * 100)) : null, remaining: o.transferDailyTarget > 0 ? Math.max(0, o.transferDailyTarget - o.transfersToday) : 0, transfers: o.transferList || [] }))
      .sort((a, b) => b.transfersToday - a.transfersToday);

    // Company target = sum of managers' effective team targets.
    const agentSalesByMgr = {};
    owners.forEach((u) => { if (u.role === 'agent' && u.managerId && u.targets && u.targets.sales && u.targets.sales.enabled) agentSalesByMgr[u.managerId] = (agentSalesByMgr[u.managerId] || 0) + Number(u.targets.sales.monthly || 0); });
    let companyTarget = 0;
    owners.forEach((u) => { if (u.role === 'manager') { const t = u.targets && u.targets.team; companyTarget += (t && t.override) ? Number(t.monthly || 0) : (agentSalesByMgr[u.id] || 0); } });
    if (companyTarget === 0) owners.forEach((u) => { if (u.role === 'agent' && u.targets && u.targets.sales && u.targets.sales.enabled) companyTarget += Number(u.targets.sales.monthly || 0); });

    // The target that applies to THIS viewer's dashboard:
    //  - admin   → whole company
    //  - manager → their team's effective target (override or auto-sum)
    //  - agent   → their own monthly sales target
    let scopeTarget = 0;
    if (req.user.role === 'admin') {
      scopeTarget = companyTarget;
    } else if (req.user.role === 'manager') {
      const meUser = owners.find((u) => u.id === req.user.id);
      const t = meUser && meUser.targets && meUser.targets.team;
      scopeTarget = (t && t.override) ? Number(t.monthly || 0) : (agentSalesByMgr[req.user.id] || 0);
    } else {
      const t = (targetsById[req.user.id] || {}).sales;
      scopeTarget = (t && t.enabled) ? Number(t.monthly || 0) : 0;
    }
    // Achieved against that target. For a manager this is their whole team's
    // collected sales (which already includes any cross-sales they closed
    // themselves on converted clients, since those leads are in their scope).
    const scopeAchieved = salesThisMonthUsd;

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
    const shiftBoard = Object.values(byShift).map((s) => ({ ...s, salesUsd: Math.round(s.salesUsd) }))
      .sort((a, b) => (b.salesUsd - a.salesUsd) || ((b.pipelineUsd || 0) - (a.pipelineUsd || 0)));
    const topShift = shiftBoard[0] || null;

    // Top performer of the month = highest collected sales; ties broken by who
    // has the larger open pipeline. Managers/admins are excluded from this
    // award since it's an agent recognition.
    const performerPool = leaderboard.filter((o) => o.role === 'agent');
    const topPerformer = performerPool.length
      ? performerPool.slice().sort((a, b) => (b.salesUsd - a.salesUsd) || ((b.pipelineUsd || 0) - (a.pipelineUsd || 0)))[0]
      : null;
    // Flag whether the win came down to the pipeline tie-break, so the UI can
    // explain it rather than looking arbitrary.
    const topPerformerTied = !!(topPerformer && performerPool.filter((o) => o.salesUsd === topPerformer.salesUsd).length > 1);

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
        // Role-aware target for the row-1 box.
        scopeTarget: Math.round(scopeTarget),
        scopeAchieved: Math.round(scopeAchieved),
        scopePct: scopeTarget > 0 ? Math.round((scopeAchieved / scopeTarget) * 100) : null,
        scopeRemaining: scopeTarget > 0 ? Math.max(0, Math.round(scopeTarget - scopeAchieved)) : 0,
        generatedTarget: targetForToday(targetsById[req.user.id], 'transfer'),
        // Team-wide lead generation (within the viewer's visibility scope).
        leadsGeneratedMonth: leadsGeneratedMonthTotal,
        leadsAssignedMonth: leadsAssignedMonthTotal,
        leadsPresalesMonth: leadsPresalesMonth,
        leadsColdMonth: leadsColdMonth,
        // Admin-only breakdown. `salesThisMonthUsd` above is everything the
        // viewer can see; these are the same figures counting only deals owned
        // by agents and managers, so an admin can separate real team
        // performance from their own house/test accounts. Null for non-admins,
        // who never see admin-owned money in the first place.
        teamSalesUsd: viewerIsAdmin ? Math.round(teamSalesUsd) : null,
        teamNewSalesUsd: viewerIsAdmin ? Math.round(teamNewSalesUsd) : null,
        teamCrossSalesUsd: viewerIsAdmin ? Math.round(teamCrossSalesUsd) : null,
        teamNewSalesCount: viewerIsAdmin ? teamNewCount : null,
        teamCrossSalesCount: viewerIsAdmin ? teamCrossCount : null,
        teamAwaitingUsd: viewerIsAdmin ? Math.round(teamAwaitingUsd) : null,
        adminSalesUsd: viewerIsAdmin ? Math.round(salesThisMonthUsd - teamSalesUsd) : null,
        teamCompanyPct: viewerIsAdmin && companyTarget > 0 ? Math.round((teamSalesUsd / companyTarget) * 100) : null,
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
      topPerformer, topPerformerTied,
      awaiting: awaitingList.sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate))).slice(0, 50),
      leadDaily,
      leadMonthly: leadMonthly.map((b) => ({ month: b.month, year: b.year, total: b.total, presales: b.presales, cold: b.cold })),
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

    // Period filter: thisMonth | lastMonth | last3 | thisYear | all
    const period = String(req.query.period || 'all');
    const now = new Date();
    let from = null, to = null;
    if (period === 'thisMonth') {
      from = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (period === 'lastMonth') {
      from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      to = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (period === 'last3') {
      from = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    } else if (period === 'thisYear') {
      from = new Date(now.getFullYear(), 0, 1);
    }
    if (from) {
      where.convertedAt = to ? { [Op.gte]: from, [Op.lt]: to } : { [Op.gte]: from };
    }

    const perPage = Math.min(100, Math.max(1, Number(req.query.perPage) || 20));
    const page = Math.max(1, Number(req.query.page) || 1);
    const { count, rows } = await Lead.findAndCountAll({
      where,
      order: [['convertedAt', 'DESC'], ['updatedAt', 'DESC']],
      limit: perPage,
      offset: (page - 1) * perPage,
    });
    res.json({
      items: rows.map((l) => l.toJSON()),
      total: count, page, perPage,
      pages: Math.max(1, Math.ceil(count / perPage)),
      period,
    });
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

/**
 * GET /api/leads/missed-activities — scheduled calls and tasks that blew past
 * their agreed time by more than an hour without being completed.
 *
 * Managers and admins use this to see who is repeatedly missing commitments;
 * an agent sees only their own, so it doubles as a personal catch-up list.
 * Declared before '/:id' so "missed-activities" isn't read as a lead id.
 */
router.get('/missed-activities', requireAuth, async (req, res, next) => {
  try {
    const where = await visibilityWhere(req.user);
    const leads = await Lead.findAll({ where });
    const now = Date.now();
    const GRACE = 60 * 60 * 1000; // one hour past the agreed time
    const items = [];
    const byOwner = {};

    for (const l of leads) {
      // Call-back prospects are pre-rules: no missed-activity flagging until
      // they become a lead via transfer.
      if (l.status === 'callback') continue;
      for (const a of (l.activities || [])) {
        const dueAt = a.kind === 'call'
          ? (a.date ? `${a.date}T${a.time || '09:00'}` : '')
          : (a.dueDate ? `${a.dueDate}T17:00` : '');
        if (!dueAt) continue;
        const due = new Date(dueAt).getTime();
        if (Number.isNaN(due)) continue;

        // Missed = still open past the grace period, or completed late.
        const stillOpen = a.status !== 'done' && now > due + GRACE;
        const doneLate = a.status === 'done' && a.completedLate;
        if (!stillOpen && !doneLate) continue;

        items.push({
          leadId: l.id, leadName: `${l.firstName || ''} ${l.lastName || ''}`.trim(),
          ownerId: l.ownerId, ownerName: l.ownerName,
          activityId: a.id, kind: a.kind, title: a.title,
          dueAt, hoursLate: Math.max(0, Math.round((now - due) / 3600000)),
          status: a.status, resolved: a.status === 'done',
        });
        byOwner[l.ownerId] = byOwner[l.ownerId] || { ownerId: l.ownerId, ownerName: l.ownerName, missed: 0, stillOpen: 0 };
        byOwner[l.ownerId].missed++;
        if (stillOpen) byOwner[l.ownerId].stillOpen++;
      }
    }

    items.sort((a, b) => new Date(b.dueAt) - new Date(a.dueAt));
    res.json({
      total: items.length,
      stillOpen: items.filter((i) => !i.resolved).length,
      items: items.slice(0, 100),
      byOwner: Object.values(byOwner).sort((a, b) => b.missed - a.missed),
    });
  } catch (e) { next(e); }
});

/**
 * GET  /api/leads/:id/brief          — cached AI brief (generates on first ask)
 * POST /api/leads/:id/brief/refresh  — force a fresh crawl and analysis
 *
 * The brief is stored on the lead so repeat visits are instant and free; a
 * prospect's homepage rarely changes between two calls.
 */
async function buildBrief(req, res, next, { force }) {
  try {
    const lead = await Lead.findByPk(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });
    if (!(await canAccessLead(req.user, lead))) return res.status(403).json({ error: 'No access to this lead.' });

    const cached = lead.aiBrief;
    if (cached && !force) {
      return res.json({ brief: cached, cached: true, stale: isStale(cached), cacheDays: CACHE_DAYS });
    }

    if (!lead.website) return res.status(400).json({ error: 'This lead has no website to analyse.' });

    const settings = await Settings.findOne({ where: { singleton: 'settings' } });
    const apiKey = settings && settings.getKey && settings.getKey('anthropic');
    if (!apiKey) {
      return res.status(503).json({ error: 'No Claude API key configured. An admin can add one in Admin → API keys.' });
    }

    const brief = await generateBrief(apiKey, {
      website: lead.website,
      businessName: `${lead.firstName || ''} ${lead.lastName || ''}`.trim(),
      // Optional: the speed section is skipped rather than failing if absent.
      pageSpeedKey: settings.getKey && settings.getKey('pagespeed'),
    });
    lead.aiBrief = brief;
    lead.changed('aiBrief', true);
    await lead.save();
    res.json({ brief, cached: false, stale: false, cacheDays: CACHE_DAYS });
  } catch (e) {
    // Crawl and model failures are expected in normal use (dead sites, bad
    // URLs, rate limits) — report them plainly rather than as a 500.
    if (/Could not read|no readable content|no website|Claude API/i.test(e.message)) {
      return res.status(422).json({ error: e.message });
    }
    next(e);
  }
}

router.get('/:id/brief', requireAuth, (req, res, next) => buildBrief(req, res, next, { force: false }));
router.post('/:id/brief/refresh', requireAuth, (req, res, next) => buildBrief(req, res, next, { force: true }));

/**
 * GET /api/leads/export — CSV of leads.
 *
 * Admins get everything they can see; a lead manager gets only the leads they
 * keyed in, which is the scope they were granted. Sellers get nothing: taking
 * the book off the platform isn't part of their job.
 * Declared before '/:id' so "export" isn't read as a lead id.
 */
router.get('/export', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'leadmanager') {
      return res.status(403).json({ error: 'Only an admin or lead manager can export leads.' });
    }
    const where = await visibilityWhere(req.user);
    if (req.user.role === 'leadmanager') where.enteredById = req.user.id;

    const rows = await Lead.findAll({ where, order: [['createdAt', 'DESC']], limit: 10000 });
    const cols = ['id', 'firstName', 'lastName', 'email', 'mobile', 'phone', 'website',
      'country', 'city', 'status', 'leadSource', 'generatedBy', 'ownerName',
      'enteredByName', 'createdAt', 'assignedAt', 'convertedAt'];
    // Escape per RFC 4180, and blunt the spreadsheet formula-injection trick
    // where a cell starting with = or + is executed on open.
    const esc = (v) => {
      let s = v === null || v === undefined ? '' : String(v);
      if (/^[=+\-@]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const csv = [cols.join(',')]
      .concat(rows.map((r) => cols.map((c) => esc(r[c])).join(',')))
      .join('\r\n');

    await AuditLog.create({
      userId: req.user.id, userName: req.user.name, action: 'lead.export',
      target: `${rows.length} leads`, ip: req.ip,
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('\uFEFF' + csv); // BOM so Excel reads UTF-8 correctly
  } catch (e) { next(e); }
});

/**
 * PATCH /api/leads/:id/first-reply — the owner's first-response decision.
 *
 * A pre-sales enquiry has to be answered within 24 hours of being assigned.
 * The owner either writes back themselves or hands a draft to the lead manager
 * to send on their behalf; this records which, and stops the clock.
 */
router.patch('/:id/first-reply', requireAuth, async (req, res, next) => {
  try {
    const lead = await Lead.findByPk(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });
    if (!(await canAccessLead(req.user, lead))) return res.status(403).json({ error: 'No access to this lead.' });

    const b = req.body || {};
    if (b.mode !== undefined) {
      const mode = ['self', 'leadmanager'].includes(String(b.mode)) ? String(b.mode) : '';
      if (mode && mode !== lead.firstReplyMode) {
        lead.firstReplyMode = mode;
        pushTimeline(lead, 'note',
          mode === 'self'
            ? 'Owner will send the first reply themselves'
            : 'Owner asked the lead manager to send the first reply',
          req.user.name);
      }
    }

    // Handing over the draft is what satisfies the 24-hour rule when the lead
    // manager is sending; marking it sent does the same when the owner replies.
    if (b.draft !== undefined) {
      const draft = String(b.draft || '').slice(0, 20000);
      if (!draft.trim()) return res.status(400).json({ error: 'The draft is empty.' });
      lead.firstDraft = draft;
      lead.firstDraftSubject = String(b.subject || '').slice(0, 300);
      lead.firstDraftAt = new Date();
      // Submitting a draft stops the 24-hour clock (the owner has done their
      // part) but does NOT close the item — the lead manager still has to read
      // it and send the actual email. draftRead marks that final step.
      lead.firstDraftRead = false;
      lead.firstDraftReadAt = null;
      if (!lead.firstReplyMode) lead.firstReplyMode = 'leadmanager';
      pushTimeline(lead, 'note', `First-reply draft submitted to the lead manager${lead.firstDraftSubject ? ` — "${lead.firstDraftSubject}"` : ''}: ${draft.slice(0, 400)}`, req.user.name, { body: draft });
    }

    // The lead manager (or admin) reads the draft and marks it actioned — this
    // is what actually closes a delegated first reply.
    if (b.draftRead) {
      if (!['leadmanager', 'admin'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Only a lead manager can mark a draft as read.' });
      }
      lead.firstDraftRead = true;
      lead.firstDraftReadAt = new Date();
      lead.firstReplyDoneAt = lead.firstReplyDoneAt || new Date();
      pushTimeline(lead, 'note', 'Lead manager read the draft and sent the first reply', req.user.name);
    }

    if (b.sent) {
      lead.firstReplyDoneAt = lead.firstReplyDoneAt || new Date();
      if (!lead.firstReplyMode) lead.firstReplyMode = 'self';
      pushTimeline(lead, 'note', 'First reply sent to the client', req.user.name);
    }

    // Any of these counts as the owner responding, so a pending nudge is done.
    if (b.draft !== undefined || b.sent || b.draftRead) {
      lead.reminderRequestedAt = null;
      lead.reminderRequestedBy = '';
      lead.reminderNote = '';
    }

    await lead.save();
    res.json(lead.toJSON());
  } catch (e) { next(e); }
});

/**
 * PATCH /api/leads/:id/reminder-draft — the agent submits a reminder email
 * (subject + body) for the lead manager to send, or the lead manager marks a
 * submitted reminder as received. Mirrors the first-reply draft flow: the agent
 * always writes it, the lead manager only acknowledges.
 */
router.patch('/:id/reminder-draft', requireAuth, async (req, res, next) => {
  try {
    const lead = await Lead.findByPk(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });
    if (!(await canAccessLead(req.user, lead))) return res.status(403).json({ error: 'No access to this lead.' });
    const b = req.body || {};

    if (b.draft !== undefined) {
      const draft = String(b.draft || '').slice(0, 20000);
      if (!draft.trim()) return res.status(400).json({ error: 'The reminder draft is empty.' });
      lead.reminderDraft = draft;
      lead.reminderSubject = String(b.subject || '').slice(0, 300);
      lead.reminderDraftAt = new Date();
      lead.reminderReceived = false;
      lead.reminderReceivedAt = null;
      pushTimeline(lead, 'note', `Reminder draft submitted to the lead manager${lead.reminderSubject ? ` — "${lead.reminderSubject}"` : ''}: ${draft.slice(0, 400)}`, req.user.name, { body: draft });
      await lead.save();
      return res.json(lead.toJSON());
    }

    if (b.received) {
      if (!['leadmanager', 'admin'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Only a lead manager can mark a reminder received.' });
      }
      if (!lead.reminderDraft) return res.status(400).json({ error: 'No reminder draft to receive.' });
      lead.reminderReceived = true;
      lead.reminderReceivedAt = new Date();
      pushTimeline(lead, 'note', 'Lead manager received the reminder draft and sent it', req.user.name);
      await lead.save();
      return res.json(lead.toJSON());
    }

    res.status(400).json({ error: 'Nothing to do.' });
  } catch (e) { next(e); }
});

/**
 * POST /api/leads/:id/request-reminder — lead manager nudges the owner for the
 * first-reply draft. Surfaces on the owner's dashboard and in the lead list.
 */
router.post('/:id/request-reminder', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'leadmanager' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only a lead manager or admin can request a draft.' });
    }
    const lead = await Lead.findByPk(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });

    lead.reminderRequestedAt = new Date();
    lead.reminderRequestedBy = req.user.name;
    lead.reminderNote = String((req.body || {}).note || '').slice(0, 500);
    pushTimeline(lead, 'note',
      `Draft requested by ${req.user.name}${lead.reminderNote ? `: ${lead.reminderNote}` : ''}`,
      req.user.name);
    await lead.save();
    res.json(lead.toJSON());
  } catch (e) { next(e); }
});

/**
 * GET /api/leads/awaiting-draft — pre-sales leads whose first reply is still
 * outstanding, with the ones past 24 hours flagged.
 *
 * Owners see their own (it drives their dashboard nudge); lead managers and
 * admins see everyone's, which is how they know who to chase.
 */
router.get('/awaiting-draft', requireAuth, async (req, res, next) => {
  try {
    const where = await visibilityWhere(req.user);
    if (!['admin', 'leadmanager'].includes(req.user.role)) where.ownerId = req.user.id;
    const leads = await Lead.findAll({ where, limit: 500, order: [['assignedAt', 'DESC']] });

    const DEADLINE = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const items = [];
    for (const l of leads) {
      // Call-back prospects sit before the rules-apply stage, so the 24-hour
      // clock doesn't run until they're transferred into a real lead.
      if (l.status === 'callback') continue;
      // The rule applies to pre-sales enquiries only.
      if (!/pre-?sales/i.test(String(l.leadSource || ''))) continue;
      if (l.firstReplyDoneAt) continue;
      // Leads that predate this feature have no assignment stamp; fall back to
      // when they were created so nothing silently escapes the rule.
      const from = l.assignedAt || l.createdAt;
      if (!from) continue;
      const age = now - new Date(from).getTime();
      items.push({
        leadId: l.id, leadName: `${l.firstName || ''} ${l.lastName || ''}`.trim(),
        website: l.website, ownerId: l.ownerId, ownerName: l.ownerName,
        assignedAt: from, hoursWaiting: Math.floor(age / 3600000),
        overdue: age > DEADLINE,
        mode: l.firstReplyMode || '',
        reminderRequestedAt: l.reminderRequestedAt, reminderRequestedBy: l.reminderRequestedBy,
      });
    }
    items.sort((a, b) => b.hoursWaiting - a.hoursWaiting);
    res.json({
      total: items.length,
      overdue: items.filter((i) => i.overdue).length,
      items,
    });
  } catch (e) { next(e); }
});

/**
 * POST /api/leads/:id/transfer — promote a call-back prospect into a worked
 * lead by handing it to an agent or manager.
 *
 * Only valid on a lead still in the 'callback' stage. The agent who generated
 * it keeps visibility (via generatedById), the receiver becomes the owner, and
 * the 24-hour / untouched clocks start from this moment because the lead only
 * now enters the rules-apply part of the funnel.
 */
router.post('/:id/transfer', requireAuth, async (req, res, next) => {
  try {
    const lead = await Lead.findByPk(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });
    if (!(await canAccessLead(req.user, lead))) return res.status(403).json({ error: 'No access to this lead.' });
    if (lead.status !== 'callback') {
      return res.status(400).json({ error: 'Only a call-back prospect can be transferred.' });
    }
    const toId = Number((req.body || {}).toId);
    const target = toId ? await User.findByPk(toId) : null;
    if (!target || !target.active) return res.status(400).json({ error: 'Choose an agent or manager to transfer to.' });
    if (!['agent', 'manager'].includes(target.role)) {
      return res.status(400).json({ error: 'Prospects can only be transferred to an agent or manager.' });
    }

    // Preserve who generated it, if not already recorded (older prospects).
    if (!lead.generatedById) lead.generatedById = lead.ownerId;

    const now = new Date();
    lead.ownerId = target.id;
    lead.ownerName = target.name;
    lead.ownerTeam = target.team || null;
    lead.ownerShift = target.shift || null;
    lead.status = 'new'; // now a real lead at the top of the worked funnel
    lead.transferredAt = now;
    lead.transferredById = req.user.id;
    lead.transferredByName = req.user.name;
    lead.transferredToId = target.id;
    // The rules clocks start now — this is the moment it becomes a lead.
    lead.assignedAt = now;
    lead.lastActivityAt = now;

    pushTimeline(lead, 'owner',
      `Prospect transferred to ${target.name} by ${req.user.name} — now a lead`,
      req.user.name, { transfer: true });
    await lead.save();
    await AuditLog.create({ userId: req.user.id, userName: req.user.name, action: 'lead.transfer', target: `lead ${lead.id} → ${target.name}`, ip: req.ip }).catch(() => {});
    res.json(lead.toJSON());
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
/**
 * Who ends up owning a new lead.
 *
 * Admins, managers and lead managers can hand a lead to someone else — that is
 * the lead manager's whole job, since they key leads in for other people to
 * work and never own anything themselves. Everyone else creates leads for
 * themselves, so the owner is simply the creator.
 */
async function resolveOwner(user, ownerId) {
  let owner;
  if (ownerId && ['admin', 'manager', 'leadmanager'].includes(user.role)) {
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

    /**
     * Back-dating, for migrating historical leads out of Zoho. Restricted to
     * the roles that do imports, capped at two years, and never in the future —
     * a mistyped date would otherwise corrupt every trend chart and monthly
     * count that reads createdAt.
     */
    let backDate = null;
    if (b.createdAt && ['admin', 'leadmanager'].includes(req.user.role)) {
      const d = new Date(b.createdAt);
      const twoYearsAgo = new Date(); twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
      if (!Number.isNaN(d.getTime()) && d <= new Date() && d >= twoYearsAgo) backDate = d;
    }

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
      generatedFromEmail: String(b.generatedFromEmail || '').slice(0, 180),
      status: String(b.status || 'new').slice(0, 40),
      // Agreed call-back time, when creating a call-back-stage lead.
      callbackAt: (b.status === 'callback' && b.callbackAt) ? new Date(b.callbackAt) : null,
      servicesInterested: Array.isArray(b.servicesInterested) ? b.servicesInterested.slice(0, 30) : [],
      tags: Array.isArray(b.tags) && b.tags.length ? b.tags.slice(0, 30) : ['New Lead'],
      country: String(b.country || '').slice(0, 80),
      city: String(b.city || '').slice(0, 120),
      timezone: String(b.timezone || '').slice(0, 80),
      additionalInfo: String(b.additionalInfo || '').slice(0, 10000),
      lastActivityAt: backDate || new Date(),
      // Track who generated a call-back prospect so they keep visibility after
      // any later transfer. Only meaningful when the creator is the owner.
      generatedById: (b.status === 'callback' && owner.id === req.user.id) ? req.user.id : null,
      // The 24-hour first-reply clock runs from assignment. For a back-dated
      // import that is the historical date, so migrated leads aren't all
      // flagged overdue the moment they land.
      assignedAt: backDate || new Date(),
      ...(backDate ? { createdAt: backDate } : {}),
      // Who keyed it in, as distinct from who owns it.
      enteredById: req.user.id,
      enteredByName: req.user.name,
      timeline: [{
        type: 'created',
        text: backDate ? `Lead created (back-dated to ${backDate.toISOString().slice(0, 10)})` : 'Lead created',
        time: (backDate || new Date()).toISOString(),
        author: req.user.name,
      }],
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
    pushTimeline(lead, 'note', text.slice(0, 5000), req.user.name, { noteId: note.id, body: text.slice(0, 5000) });
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
    // Carry the activity id and its agreed time so the timeline can later show
    // this row in red if the call/task was never completed.
    const dueAt = kind === 'call'
      ? (act.date ? `${act.date}T${act.time || '09:00'}` : '')
      : (act.dueDate ? `${act.dueDate}T17:00` : '');
    pushTimeline(
      lead, kind,
      `${kind === 'call' ? 'Call' : 'Task'} ${act.mode === 'done' ? 'logged' : 'scheduled'}: ${act.title}`,
      req.user.name,
      { activityId: act.id, dueAt, scheduled: act.mode !== 'done', body: kind === 'call' ? act.agenda : act.description },
    );
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
      if (b.status === 'done') {
        act.completedAt = new Date().toISOString();
        // Was it finished within the hour-long grace period after the agreed
        // time? Stored on the activity so the miss survives even if the row is
        // later edited, and so managers can count repeat offences.
        const dueAt = act.kind === 'call'
          ? (act.date ? `${act.date}T${act.time || '09:00'}` : '')
          : (act.dueDate ? `${act.dueDate}T17:00` : '');
        if (dueAt) {
          const grace = new Date(new Date(dueAt).getTime() + 60 * 60 * 1000);
          act.completedLate = new Date() > grace;
        }
        pushTimeline(
          lead, act.kind,
          `${act.kind === 'call' ? 'Call' : 'Task'} completed: ${act.title}`,
          req.user.name,
          { activityId: act.id, resolves: act.id, late: !!act.completedLate },
        );
      }
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

    // Payment plan. planType = 'one-time' | 'recurring' | 'installments'.
    // structure = 'full' | 'installments'. A recurring deal bills the full
    // amount every cycle, so we seed the next few billing dates instead of
    // splitting one total.
    const planType = ['one-time', 'recurring', 'installments'].includes(String(b.planType))
      ? String(b.planType) : 'one-time';
    const recurringInterval = RECURRING_MONTHS[b.recurringInterval] ? String(b.recurringInterval) : 'monthly';
    const paymentStructure = b.paymentStructure === 'installments' ? 'installments' : 'full';
    let installments = [];
    if (planType === 'recurring') {
      installments = buildRecurringCycles(amount, recurringInterval, winDate || b.expectedClose || new Date(), 3, 0);
    } else if (paymentStructure === 'installments') {
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
      planType, // one-time | recurring | installments
      recurringInterval: planType === 'recurring' ? recurringInterval : null,
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
    // Only an admin confirms money in the door. A manager runs the deal and
    // chases the client — they can move a due date and record that they sent
    // the invoice — but the payment itself is an admin action, so the two
    // responsibilities stay separate.
    if (b.paid !== undefined && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only an admin can mark a payment as received.' });
    }
    // Which gateway the money arrived through. Recorded per payment because a
    // client may pay one installment by card and the next by bank transfer.
    const GATEWAYS = ['PayPal', 'Stripe', 'Wire Transfer'];
    if (b.gateway !== undefined) {
      inst.gateway = GATEWAYS.includes(String(b.gateway)) ? String(b.gateway) : '';
    }
    // Reference from the payment provider, so finance can reconcile later.
    if (b.transactionId !== undefined) {
      inst.transactionId = String(b.transactionId || '').slice(0, 120);
    }
    // Managers mark an installment as invoiced; that is their half of the
    // handover, and it tells the admin the money is now expected.
    if (b.invoiceSent !== undefined) {
      inst.invoiceSent = !!b.invoiceSent;
      inst.invoiceSentAt = b.invoiceSent ? new Date().toISOString() : null;
      inst.invoiceSentBy = b.invoiceSent ? req.user.name : null;
      if (b.invoiceSent) {
        pushTimeline(lead, 'deal', `Invoice sent for installment ${inst.seq} of "${deal.name}" (${deal.currency} ${inst.amount})`, req.user.name);
      }
    }
    if (b.paid !== undefined) {
      inst.paid = !!b.paid;
      inst.paidDate = b.paid ? (b.paidDate || new Date().toISOString().slice(0, 10)) : null;
      if (!b.paid) inst.gateway = '';
      if (b.paid) {
        pushTimeline(lead, 'deal', `Installment ${inst.seq} of "${deal.name}" marked paid (${deal.currency} ${inst.amount}${inst.gateway ? ' via ' + inst.gateway : ''}${inst.transactionId ? ' · ref ' + inst.transactionId : ''})`, req.user.name);
      }
    }
    if (b.dueDate !== undefined) {
      // Rescheduling a payment is a commercial decision worth recording — it
      // is often the trace of a client asking for more time.
      const was = inst.dueDate;
      inst.dueDate = b.dueDate;
      if (was !== b.dueDate) {
        pushTimeline(
          lead, 'deal',
          `Installment ${inst.seq} of "${deal.name}" rescheduled${was ? ` from ${was}` : ''} to ${b.dueDate || 'no date'}`,
          req.user.name,
        );
      }
    }
    if (b.amount !== undefined) inst.amount = Number(b.amount) || 0;

    // A recurring contract has no end date, so top the schedule back up to
    // three upcoming cycles whenever one is collected. Without this the client
    // would run out of billing dates after the initial three.
    if (deal.planType === 'recurring' && inst.paid) {
      const unpaid = (deal.installments || []).filter((it) => !it.paid).length;
      if (unpaid < 3) {
        const sorted = (deal.installments || []).slice()
          .sort((a, b2) => String(a.dueDate || '').localeCompare(String(b2.dueDate || '')));
        const last = sorted[sorted.length - 1];
        const step = RECURRING_MONTHS[deal.recurringInterval || 'monthly'] || 1;
        const anchor = last && last.dueDate ? new Date(last.dueDate) : new Date();
        const need = 3 - unpaid;
        const extra = [];
        for (let i = 0; i < need; i++) {
          const due = new Date(anchor);
          due.setMonth(due.getMonth() + step * (i + 1));
          extra.push({
            id: `inst_${Date.now()}_x${i}`,
            seq: deal.installments.length + i + 1,
            amount: Number(deal.amount) || 0,
            dueDate: due.toISOString().slice(0, 10),
            paid: false, paidDate: null, recurring: true,
          });
        }
        deal.installments = [...deal.installments, ...extra];
      }
    }

    // Money in the door means the deal is won. As soon as ANY installment is
    // collected we promote the deal to Closed Won, so the pipeline reflects
    // reality and the converted-clients page counts the booked/outstanding
    // amounts (its money maths only looks at won deals).
    if (inst.paid && deal.stage !== 'closed_won' && deal.stage !== 'closed_lost') {
      deal.stage = 'closed_won';
      deal.wonAt = deal.wonAt || new Date();
      // Seed any missing due dates from the win date so the remaining
      // installments have a chase schedule.
      if (Array.isArray(deal.installments) && deal.installments.length && !deal.installments[0].dueDate) {
        const seeded = buildInstallments(deal.amount, deal.installments.length, deal.wonAt);
        deal.installments = deal.installments.map((it, i) => ({
          ...it, dueDate: it.dueDate || seeded[i].dueDate, amount: it.amount || seeded[i].amount,
        }));
      }
      pushTimeline(lead, 'deal', `Deal "${deal.name}" moved to Closed Won (payment received)`, req.user.name);
      if (lead.status !== 'converted') {
        lead.status = 'converted';
        lead.convertedAt = lead.convertedAt || new Date();
        pushTimeline(lead, 'status', 'Converted to client (payment received)', req.user.name);
      }
    }

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
    // A lead is only "converted" because it had a won deal. If none remain,
    // send it back to the active lead list so it isn't stranded on the
    // converted-clients page with nothing behind it.
    const stillWon = lead.deals.some((d) => d.stage === 'closed_won');
    if (!stillWon && lead.status === 'converted') {
      lead.status = 'contacted';
      lead.convertedAt = null;
      pushTimeline(lead, 'status', 'Returned to active leads (no won deals remain)', req.user.name);
    }
    await lead.save();
    res.json(lead.toJSON());
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.helpers = { toDomain, visibilityWhere, canAccessLead };

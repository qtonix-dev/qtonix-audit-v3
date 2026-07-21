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

/** GET /api/leads — list leads visible to the current user (with search/filter). */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const where = await visibilityWhere(req.user);
    const { q, status, source, ownerId, country } = req.query;
    if (status) where.status = status;
    if (source) where.leadSource = source;
    if (ownerId) where.ownerId = ownerId;
    if (country) where.country = country;
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
    const deal = {
      id: `d_${Date.now()}`,
      name: String(b.name).slice(0, 200),
      stage: String(b.stage || 'qualification').slice(0, 40),
      currency: String(b.currency || 'USD').slice(0, 8),
      amount: Number(b.amount) || 0,
      expectedClose: b.expectedClose || '',
      service: String(b.service || '').slice(0, 120),
      remark: String(b.remark || '').slice(0, 2000),
      createdBy: req.user.name,
      createdAt: new Date().toISOString(),
    };
    list.push(deal);
    lead.deals = list; lead.changed('deals', true);
    pushTimeline(lead, 'deal', `Deal added: ${deal.name} (${deal.currency} ${deal.amount})`, req.user.name);
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
    for (const f of ['name', 'stage', 'currency', 'expectedClose', 'service', 'remark']) if (b[f] !== undefined) deal[f] = String(b[f]).slice(0, 2000);
    if (b.amount !== undefined) deal.amount = Number(b.amount) || 0;
    if (b.stage && b.stage !== before) pushTimeline(lead, 'deal', `Deal "${deal.name}" moved to ${deal.stage}`, req.user.name);
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

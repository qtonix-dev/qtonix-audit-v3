const express = require('express');
const router = express.Router();
const { Op, Project, ProjectMember, ProjectTemplate, ProjectStep, ProjectCycle, ProjectDeliverable, ProjectCredential, ProjectPlan, Lead, HrUser, Task, TaskActivity } = require('../models');
const { requireHrAccess, requireHrAdmin } = require('../middleware/hrAuth');
const flow = require('../services/projectFlow');

// Resolve the acting HR user id + admin flag.
async function actor(req) {
  const isAdmin = !!req.isHrAdmin;
  let hrUser = null;
  if (req.hrActor && req.hrActor.kind !== 'admin') hrUser = await HrUser.findByPk(req.hrActor.id);
  else if (req.adminUser) hrUser = await HrUser.findOne({ where: { email: req.adminUser.email } });
  const id = hrUser ? hrUser.id : (req.hrActor && req.hrActor.id) || null;
  const name = (hrUser && hrUser.name) || (req.adminUser && req.adminUser.name) || (req.hrActor && req.hrActor.name) || 'User';
  return { id, name, isAdmin, hrUser };
}

// My membership on a project (null if not a member). Admins get an implicit
// all-permissions membership.
async function myMembership(projectId, act) {
  if (act.isAdmin) return { admin: true, editFlow: true, approveClientSteps: true, approveDeliverables: true, uploadDeliverables: true, viewContact: true, viewCredentials: ['*'], manageMembers: true, role: 'admin' };
  return ProjectMember.findOne({ where: { projectId, userId: act.id } });
}

// Mask a project's contact fields unless the viewer is authorized.
function maskProject(p, canSeeContact) {
  const o = p.toJSON ? p.toJSON() : p;
  if (!canSeeContact) { o.contactName = null; o.email = null; o.phone = null; o._contactMasked = true; }
  return o;
}

const guard = requireHrAccess;

// Won deals available to convert into a project — leads with a closed_won deal
// that don't already have a project.
router.get('/won-leads', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const leads = await Lead.findAll({ order: [['updatedAt', 'DESC']], limit: 500 });
    const out = [];
    for (const l of leads) {
      if (l.projectId) continue;
      const deals = Array.isArray(l.deals) ? l.deals : [];
      const won = deals.find((d) => d.stage === 'closed_won');
      if (!won) continue;
      out.push({ id: l.id, customerName: `${l.firstName || ''} ${l.lastName || ''}`.trim() || l.website, website: l.website, email: l.email, dealValue: won.value || won.amount || null });
    }
    res.json({ leads: out });
  } catch (e) { next(e); }
});

// ---- Service Plans (admin presets) -------------------------------------------
router.get('/plans', guard, async (req, res, next) => {
  try { res.json({ plans: await ProjectPlan.findAll({ where: { active: true }, order: [['service', 'ASC'], ['name', 'ASC']] }) }); } catch (e) { next(e); }
});
router.post('/plans', guard, requireHrAdmin, async (req, res, next) => {
  try { const b = req.body || {}; const p = await ProjectPlan.create({ service: b.service || 'seo', name: String(b.name || 'Plan').slice(0, 120), params: b.params || {} }); res.status(201).json(p.toJSON()); } catch (e) { next(e); }
});
router.put('/plans/:id', guard, requireHrAdmin, async (req, res, next) => {
  try { const p = await ProjectPlan.findByPk(req.params.id); if (!p) return res.status(404).json({ error: 'Plan not found.' }); const b = req.body || {}; if (b.name !== undefined) p.name = String(b.name).slice(0, 120); if (b.service !== undefined) p.service = b.service; if (b.params !== undefined) { p.params = b.params; p.changed('params', true); } await p.save(); res.json(p.toJSON()); } catch (e) { next(e); }
});
router.delete('/plans/:id', guard, requireHrAdmin, async (req, res, next) => {
  try { const p = await ProjectPlan.findByPk(req.params.id); if (p) await p.destroy(); res.json({ ok: true }); } catch (e) { next(e); }
});


router.get('/templates', guard, async (req, res, next) => {
  try { res.json({ templates: await ProjectTemplate.findAll({ order: [['projectType', 'ASC'], ['name', 'ASC']] }) }); } catch (e) { next(e); }
});
router.post('/templates', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    const act = await actor(req);
    const t = await ProjectTemplate.create({ name: String(b.name || 'Template').slice(0, 120), projectType: b.projectType || 'seo', recurring: !!b.recurring, stages: Array.isArray(b.stages) ? b.stages : [], isDefault: !!b.isDefault, createdById: act.id });
    res.status(201).json(t.toJSON());
  } catch (e) { next(e); }
});
router.put('/templates/:id', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const t = await ProjectTemplate.findByPk(req.params.id); if (!t) return res.status(404).json({ error: 'Template not found.' });
    const b = req.body || {};
    if (b.name !== undefined) t.name = String(b.name).slice(0, 120);
    if (b.projectType !== undefined) t.projectType = b.projectType;
    if (b.recurring !== undefined) t.recurring = !!b.recurring;
    if (Array.isArray(b.stages)) { t.stages = b.stages; t.changed('stages', true); }
    await t.save(); res.json(t.toJSON());
  } catch (e) { next(e); }
});
router.delete('/templates/:id', guard, requireHrAdmin, async (req, res, next) => {
  try { const t = await ProjectTemplate.findByPk(req.params.id); if (t) await t.destroy(); res.json({ ok: true }); } catch (e) { next(e); }
});

// ---- Projects list (admin only for now) --------------------------------------
router.get('/', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const act = await actor(req);
    const projects = await Project.findAll({ order: [['createdAt', 'DESC']] });
    // Compute health + attach member avatars.
    const today = flow.istToday();
    const out = [];
    for (const p of projects) {
      const steps = await ProjectStep.findAll({ where: { projectId: p.id, skipped: false } });
      const openOverdue = steps.some((s) => !['done', 'approved'].includes(s.status) && s.dueDate && s.dueDate < today);
      const dueSoon = steps.some((s) => !['done', 'approved'].includes(s.status) && s.dueDate && s.dueDate >= today && s.dueDate <= flow.addDays(today, 2));
      let health = 'on_track';
      if (p.status === 'paused' || p.status === 'cancelled') health = p.status;
      else if (openOverdue) health = 'behind';
      else if (dueSoon) health = 'at_risk';
      const members = await ProjectMember.findAll({ where: { projectId: p.id }, attributes: ['userId', 'name', 'department'] });
      const canSee = act.isAdmin || p.projectManagerId === act.id || members.some((m) => m.userId === act.id);
      const stageName = (steps.find((s) => s.status === 'active' || s.status === 'awaiting_approval') || {}).stageName || '';
      out.push({ ...maskProject(p, false), health, stageName, memberCount: members.length, members: members.slice(0, 5).map((m) => ({ name: m.name, department: m.department })) });
    }
    res.json({ projects: out });
  } catch (e) { next(e); }
});

// ---- Create project from a won deal / lead -----------------------------------
router.post('/', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const act = await actor(req);
    const b = req.body || {};
    // Copy customer snapshot from the lead if provided.
    let snap = {};
    if (b.leadId) {
      const lead = await Lead.findByPk(b.leadId);
      if (lead) snap = { customerName: `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || lead.website, contactName: `${lead.firstName || ''} ${lead.lastName || ''}`.trim(), website: lead.website, email: lead.email, phone: lead.mobile || lead.phone, country: lead.country, city: lead.city, timezone: lead.timezone };
    }
    const template = b.templateId ? await ProjectTemplate.findByPk(b.templateId) : null;
    const project = await Project.create({
      leadId: b.leadId || null,
      customerName: b.customerName || snap.customerName || 'Customer',
      contactName: b.contactName || snap.contactName || '', website: b.website || snap.website || '',
      email: b.email || snap.email || '', phone: b.phone || snap.phone || '',
      country: snap.country || '', city: snap.city || '', timezone: snap.timezone || '',
      projectType: b.projectType || 'seo', subType: b.subType || '', cmsPlatform: b.cmsPlatform || '',
      servicesTaken: Array.isArray(b.servicesTaken) ? b.servicesTaken : [],
      requirements: String(b.requirements || '').slice(0, 8000),
      campaignParams: b.campaignParams || {},
      startDate: b.startDate || flow.istToday(), expectedEndDate: b.expectedEndDate || null,
      projectManagerId: b.projectManagerId || null, projectManagerName: b.projectManagerName || '',
      status: 'active', templateId: template ? template.id : null,
      recurring: template ? !!template.recurring : !!b.recurring,
      createdById: act.id,
    });
    // Add PM as a member with full permissions.
    if (b.projectManagerId) {
      const pm = await HrUser.findByPk(b.projectManagerId);
      await ProjectMember.create({ projectId: project.id, userId: b.projectManagerId, name: pm ? pm.name : (b.projectManagerName || 'PM'), department: pm ? pm.department : '', role: 'pm', editFlow: true, approveClientSteps: true, approveDeliverables: true, uploadDeliverables: true, viewContact: true, viewCredentials: ['*'], manageMembers: false });
    }
    // Add chosen team members.
    for (const m of (Array.isArray(b.members) ? b.members : [])) {
      const u = await HrUser.findByPk(m.userId); if (!u) continue;
      await ProjectMember.create({ projectId: project.id, userId: u.id, name: u.name, department: m.department || u.department || '', role: m.role || 'lead', editFlow: !!m.editFlow, approveClientSteps: !!m.approveClientSteps, approveDeliverables: m.approveDeliverables !== false, uploadDeliverables: m.uploadDeliverables !== false, viewContact: !!m.viewContact, viewCredentials: m.viewCredentials || [u.department], manageMembers: false });
    }
    // Instantiate the flow (spawns stage-1 tasks).
    if (template) await flow.instantiateFlow(project, template);
    // Mark the lead converted / linked (best-effort).
    if (b.leadId) { try { const lead = await Lead.findByPk(b.leadId); if (lead) { lead.projectId = project.id; await lead.save().catch(() => {}); } } catch {} }
    res.status(201).json(project.toJSON());
  } catch (e) { next(e); }
});

// ---- Project detail (admin only for now) -------------------------------------
router.get('/:id', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const act = await actor(req);
    const p = await Project.findByPk(req.params.id); if (!p) return res.status(404).json({ error: 'Project not found.' });
    const mem = await myMembership(p.id, act);
    const members = await ProjectMember.findAll({ where: { projectId: p.id } });
    const steps = await ProjectStep.findAll({ where: { projectId: p.id }, order: [['stageIndex', 'ASC'], ['orderIndex', 'ASC']] });
    const cycles = await ProjectCycle.findAll({ where: { projectId: p.id }, order: [['cycleNumber', 'DESC']] });
    const canSeeContact = !!(mem && (mem.admin || mem.viewContact)) || p.projectManagerId === act.id;
    res.json({ project: maskProject(p, canSeeContact), members, steps, cycles, myPerms: mem || {}, canSeeContact });
  } catch (e) { next(e); }
});

// Update project (status pause/cancel, params, dates) — admin or PM.
router.put('/:id', guard, async (req, res, next) => {
  try {
    const act = await actor(req);
    const p = await Project.findByPk(req.params.id); if (!p) return res.status(404).json({ error: 'Project not found.' });
    if (!act.isAdmin && p.projectManagerId !== act.id) return res.status(403).json({ error: 'Only admin or the PM can edit.' });
    const b = req.body || {};
    if (b.status && ['setup', 'active', 'paused', 'cancelled', 'completed'].includes(b.status)) p.status = b.status;
    if (b.campaignParams) { p.campaignParams = b.campaignParams; p.changed('campaignParams', true); }
    if (b.requirements !== undefined) p.requirements = String(b.requirements).slice(0, 8000);
    if (b.expectedEndDate !== undefined) p.expectedEndDate = b.expectedEndDate || null;
    if (act.isAdmin && b.projectManagerId !== undefined) { p.projectManagerId = b.projectManagerId; const pm = b.projectManagerId ? await HrUser.findByPk(b.projectManagerId) : null; p.projectManagerName = pm ? pm.name : ''; }
    await p.save();
    res.json(p.toJSON());
  } catch (e) { next(e); }
});

// ---- Members & permissions (admin) -------------------------------------------
router.put('/:id/members/:userId/perms', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const m = await ProjectMember.findOne({ where: { projectId: req.params.id, userId: req.params.userId } });
    if (!m) return res.status(404).json({ error: 'Member not found.' });
    const b = req.body || {};
    for (const k of ['editFlow', 'approveClientSteps', 'approveDeliverables', 'uploadDeliverables', 'viewContact', 'manageMembers']) if (b[k] !== undefined) m[k] = !!b[k];
    if (b.viewCredentials !== undefined) { m.viewCredentials = b.viewCredentials; m.changed('viewCredentials', true); }
    if (b.role !== undefined) m.role = b.role;
    await m.save(); res.json(m.toJSON());
  } catch (e) { next(e); }
});
router.post('/:id/members', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const b = req.body || {}; const u = await HrUser.findByPk(b.userId); if (!u) return res.status(400).json({ error: 'User not found.' });
    const [m] = await ProjectMember.findOrCreate({ where: { projectId: req.params.id, userId: u.id }, defaults: { projectId: req.params.id, userId: u.id, name: u.name, department: b.department || u.department || '', role: b.role || 'member', viewCredentials: [u.department] } });
    res.status(201).json(m.toJSON());
  } catch (e) { next(e); }
});
router.delete('/:id/members/:userId', guard, requireHrAdmin, async (req, res, next) => {
  try { await ProjectMember.destroy({ where: { projectId: req.params.id, userId: req.params.userId } }); res.json({ ok: true }); } catch (e) { next(e); }
});

// ---- Flow: approvals + skip --------------------------------------------------
router.post('/:id/steps/:stepId/approve', guard, async (req, res, next) => {
  try {
    const act = await actor(req); const mem = await myMembership(req.params.id, act);
    if (!(mem && (mem.admin || mem.approveClientSteps))) return res.status(403).json({ error: 'You can\u2019t approve client steps.' });
    const r = await flow.resolveApproval(Number(req.params.stepId), req.body.approved !== false, req.body.note, act);
    res.json(r);
  } catch (e) { next(e); }
});
router.post('/:id/steps/:stepId/skip', guard, async (req, res, next) => {
  try {
    const act = await actor(req); const mem = await myMembership(req.params.id, act);
    if (!(mem && (mem.admin || mem.editFlow))) return res.status(403).json({ error: 'You can\u2019t edit the flow.' });
    res.json(await flow.skipStep(Number(req.params.stepId)));
  } catch (e) { next(e); }
});

// ---- Deliverables ------------------------------------------------------------
router.get('/:id/deliverables', guard, async (req, res, next) => {
  try {
    const where = { projectId: req.params.id };
    if (req.query.cycleId) where.cycleId = Number(req.query.cycleId);
    if (req.query.type) where.type = req.query.type;
    res.json({ deliverables: await ProjectDeliverable.findAll({ where, order: [['createdAt', 'DESC']] }) });
  } catch (e) { next(e); }
});
router.post('/:id/deliverables', guard, async (req, res, next) => {
  try {
    const act = await actor(req); const mem = await myMembership(req.params.id, act);
    if (!(mem && (mem.admin || mem.uploadDeliverables))) return res.status(403).json({ error: 'You can\u2019t upload deliverables.' });
    const b = req.body || {};
    const d = await ProjectDeliverable.create({ projectId: req.params.id, cycleId: b.cycleId || null, type: b.type || 'file', department: b.department || (act.hrUser && act.hrUser.department) || '', title: String(b.title || '').slice(0, 240), url: String(b.url || '').slice(0, 600), platform: b.platform || '', meta: b.meta || {}, submittedById: act.id, submittedByName: act.name });
    res.status(201).json(d.toJSON());
  } catch (e) { next(e); }
});
router.post('/:id/deliverables/:did/approve', guard, async (req, res, next) => {
  try {
    const act = await actor(req); const mem = await myMembership(req.params.id, act);
    if (!(mem && (mem.admin || mem.approveDeliverables))) return res.status(403).json({ error: 'You can\u2019t approve deliverables.' });
    const d = await ProjectDeliverable.findByPk(req.params.did); if (!d) return res.status(404).json({ error: 'Not found.' });
    d.approvalStatus = req.body.approved === false ? 'rejected' : 'approved'; d.approvedById = act.id; await d.save();
    res.json(d.toJSON());
  } catch (e) { next(e); }
});

// ---- Cycles ------------------------------------------------------------------
router.put('/:id/cycles/:cid', guard, async (req, res, next) => {
  try {
    const act = await actor(req); const mem = await myMembership(req.params.id, act);
    if (!(mem && (mem.admin || mem.role === 'pm'))) return res.status(403).json({ error: 'Only admin or PM.' });
    const c = await ProjectCycle.findByPk(req.params.cid); if (!c) return res.status(404).json({ error: 'Cycle not found.' });
    if (req.body.invoicePaid !== undefined) c.invoicePaid = !!req.body.invoicePaid;
    await c.save(); res.json(c.toJSON());
  } catch (e) { next(e); }
});

// ---- Credentials (department-scoped, encrypted) ------------------------------
function canSeeCred(mem, department) {
  if (!mem) return false; if (mem.admin) return true;
  const list = mem.viewCredentials || [];
  return list.includes('*') || list.includes(department);
}
router.get('/:id/credentials', guard, async (req, res, next) => {
  try {
    const act = await actor(req); const mem = await myMembership(req.params.id, act);
    if (!mem) return res.status(403).json({ error: 'Not a member.' });
    const creds = await ProjectCredential.findAll({ where: { projectId: req.params.id } });
    // Only return metadata; secrets require an explicit reveal call (audited).
    const out = creds.filter((c) => canSeeCred(mem, c.department)).map((c) => ({ id: c.id, label: c.label, department: c.department, username: c.username, url: c.url, note: c.note, hasSecret: !!c.secretEnc }));
    res.json({ credentials: out });
  } catch (e) { next(e); }
});
router.post('/:id/credentials', guard, async (req, res, next) => {
  try {
    const act = await actor(req); const mem = await myMembership(req.params.id, act);
    if (!(mem && (mem.admin || mem.role === 'pm' || canSeeCred(mem, req.body.department)))) return res.status(403).json({ error: 'Not allowed.' });
    const b = req.body || {};
    const c = await ProjectCredential.create({ projectId: req.params.id, label: String(b.label || '').slice(0, 120), department: b.department || '', username: String(b.username || '').slice(0, 240), secretEnc: b.secret || null, url: String(b.url || '').slice(0, 400), note: String(b.note || '').slice(0, 2000), createdById: act.id });
    res.status(201).json({ id: c.id, label: c.label, department: c.department });
  } catch (e) { next(e); }
});
// Reveal the secret (audited).
router.get('/:id/credentials/:cid/reveal', guard, async (req, res, next) => {
  try {
    const act = await actor(req); const mem = await myMembership(req.params.id, act);
    const c = await ProjectCredential.findByPk(req.params.cid); if (!c || String(c.projectId) !== String(req.params.id)) return res.status(404).json({ error: 'Not found.' });
    if (!canSeeCred(mem, c.department)) return res.status(403).json({ error: 'You can\u2019t view this credential.' });
    const log = Array.isArray(c.viewLog) ? c.viewLog : [];
    log.push({ userId: act.id, name: act.name, at: new Date().toISOString() });
    c.viewLog = log.slice(-50); c.changed('viewLog', true); await c.save();
    res.json({ id: c.id, label: c.label, username: c.username, secret: c.getSecret(), url: c.url });
  } catch (e) { next(e); }
});
router.delete('/:id/credentials/:cid', guard, async (req, res, next) => {
  try {
    const act = await actor(req); const mem = await myMembership(req.params.id, act);
    if (!(mem && (mem.admin || mem.role === 'pm'))) return res.status(403).json({ error: 'Only admin or PM.' });
    await ProjectCredential.destroy({ where: { id: req.params.cid, projectId: req.params.id } }); res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- Timeline (aggregated) ---------------------------------------------------
router.get('/:id/timeline', guard, async (req, res, next) => {
  try {
    const p = await Project.findByPk(req.params.id); if (!p) return res.status(404).json({ error: 'Not found.' });
    const steps = await ProjectStep.findAll({ where: { projectId: p.id } });
    const taskIds = steps.map((s) => s.taskId).filter(Boolean);
    const acts = taskIds.length ? await TaskActivity.findAll({ where: { taskId: { [Op.in]: taskIds } }, order: [['createdAt', 'DESC']], limit: 100 }) : [];
    const events = acts.map((a) => ({ type: 'task', kind: a.kind, text: a.detail, by: a.actorName, at: a.createdAt }));
    // Step approvals + cycle starts.
    for (const s of steps) { if (s.status === 'approved' || s.status === 'changes_requested') events.push({ type: 'approval', text: `${s.name} — ${s.status.replace('_', ' ')}`, at: s.updatedAt }); }
    events.sort((a, b) => new Date(b.at) - new Date(a.at));
    res.json({ events: events.slice(0, 80) });
  } catch (e) { next(e); }
});

module.exports = router;

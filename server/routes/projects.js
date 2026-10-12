const express = require('express');
const router = express.Router();
const { Op, Project, ProjectMember, ProjectTemplate, ProjectStep, ProjectCycle, ProjectDeliverable, ProjectCredential, ProjectPlan, Lead, HrUser, Task, TaskActivity } = require('../models');
const { requireHrAccess, requireHrAdmin } = require('../middleware/hrAuth');
const flow = require('../services/projectFlow');
const path = require('path');

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
    const t = await ProjectTemplate.create({ name: String(b.name || 'Template').slice(0, 120), projectType: b.projectType || (Array.isArray(b.services) && b.services[0]) || 'seo', services: Array.isArray(b.services) ? b.services : [], recurring: !!b.recurring, stages: Array.isArray(b.stages) ? b.stages : [], isDefault: !!b.isDefault, createdById: act.id });
    res.status(201).json(t.toJSON());
  } catch (e) { next(e); }
});
router.put('/templates/:id', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const t = await ProjectTemplate.findByPk(req.params.id); if (!t) return res.status(404).json({ error: 'Template not found.' });
    const b = req.body || {};
    if (b.name !== undefined) t.name = String(b.name).slice(0, 120);
    if (b.projectType !== undefined) t.projectType = b.projectType;
    if (Array.isArray(b.services)) { t.services = b.services; t.changed('services', true); }
    if (b.recurring !== undefined) t.recurring = !!b.recurring;
    if (Array.isArray(b.stages)) { t.stages = b.stages; t.changed('stages', true); }
    await t.save(); res.json(t.toJSON());
  } catch (e) { next(e); }
});
router.delete('/templates/:id', guard, requireHrAdmin, async (req, res, next) => {
  try { const t = await ProjectTemplate.findByPk(req.params.id); if (t) await t.destroy(); res.json({ ok: true }); } catch (e) { next(e); }
});

// Day-by-day preview of a template's flow — same engine the real project uses,
// so Admin can sanity-check the schedule (parallel teams, weekend roll-forward)
// before a project is created. Accepts the (possibly unsaved) stages in the body.
router.post('/templates/preview', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    const stages = Array.isArray(b.stages) ? b.stages : [];
    const branch = String(b.branch || 'bhubaneswar');
    const startDate = b.startDate || flow.rollToWorkingDay(flow.istToday(), branch, await flow.loadHolidaySet());
    const holSet = await flow.loadHolidaySet();
    const start = flow.rollToWorkingDay(startDate, branch, holSet);
    const sched = flow.computeSchedule(stages, start, branch, holSet);
    res.json({ startDate: start, branch, schedule: sched });
  } catch (e) { next(e); }
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
  // "preseo" and "preseo-diag" are reserved sub-paths (the Pre-SEO report
  // routes), not project ids — let those routes handle them. A real project id
  // is always numeric, so anything non-numeric falls through safely.
  if (/^preseo/i.test(String(req.params.id))) return next();
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

// ========================= PRE-SEO ANALYSIS REPORT =========================
// Run Report (inside a project) → pick "Pre-SEO Analysis Report" → enter URL →
// auto-capture + Claude analysis → upload remaining tool screenshots → review →
// generate branded PDF.
const multer = require('multer');
const fsp = require('fs');
const PRESEO_UPLOAD_DIR = path.join(__dirname, '../../storage/uploads');
fsp.mkdirSync(PRESEO_UPLOAD_DIR, { recursive: true });
const shotUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, PRESEO_UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `preseo-up-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${path.extname(file.originalname).toLowerCase() || '.png'}`),
  }),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (req, file, cb) => (/\.(png|jpe?g|webp)$/i.test(file.originalname) && /^image\//.test(file.mimetype)) ? cb(null, true) : cb(new Error('Image files only')),
});

const { PreSeoReport } = require('../models');
const preSeoRunner = require('../services/preSeoRunner');
const brandGuideRunner = require('../services/brandGuidelineRunner');

// Create a Pre-SEO report run and start crawl + capture + analysis in background.
router.post('/:id/preseo', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const act = await actor(req);
    const project = req.params.id !== 'none' ? await Project.findByPk(req.params.id) : null;
    const b = req.body || {};
    const website = String(b.website || (project && project.website) || '').trim();
    if (!website || website.length < 4) return res.status(400).json({ error: 'A website URL is required.' });
    let domain = '';
    try { domain = flow.istToday && new URL(website.startsWith('http') ? website : 'https://' + website).hostname.replace(/^www\./, ''); } catch { domain = website.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]; }
    const services = Array.isArray(b.services) ? b.services.filter(Boolean).slice(0, 6)
      : (typeof b.services === 'string' && b.services ? b.services.split(/[,+]/).map((s) => s.trim()).filter(Boolean) : []);
    const report = await PreSeoReport.create({
      projectId: project ? project.id : null, kind: String(b.reportType || 'pre_seo'), website: website.startsWith('http') ? website : 'https://' + website,
      domain, businessName: b.businessName || (project && project.customerName) || domain,
      createdById: act.id, createdByName: act.name || 'Qtonix', status: 'capturing', progress: 5,
      // runOptions persists across re-runs (data gets overwritten by analysis).
      runOptions: {
        services,
        sitemapUrl: (b.sitemapUrl && String(b.sitemapUrl).trim()) || '',
        noSitemap: !!b.noSitemap,
        accessMode: ['share', 'coordinate', 'unsure'].includes(b.accessMode) ? b.accessMode : 'unsure',
      },
      // legacy seed (still read as a fallback by older runner paths)
      data: { _services: services },
    });
    // fire-and-forget
    preSeoRunner.run(report.id).catch((e) => console.error('[preseo] run error:', e.message));
    res.status(201).json({ id: report.id, status: report.status });
  } catch (e) { next(e); }
});

// Poll status + current data.
router.get('/preseo/:rid', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const r = await PreSeoReport.findByPk(req.params.rid);
    if (!r) return res.status(404).json({ error: 'Report not found.' });
    res.json({ id: r.id, status: r.status, progress: r.progress, currentStep: r.currentStep, error: r.error, domain: r.domain, businessName: r.businessName, website: r.website, shots: r.shots || {}, data: r.data || null });
  } catch (e) { next(e); }
});

// List a project's reports (both Pre-SEO and Brand Guideline, with kind + live progress).
router.get('/:id/preseo', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const rows = await PreSeoReport.findAll({ where: { projectId: req.params.id }, order: [['id', 'DESC']], attributes: ['id', 'kind', 'status', 'progress', 'currentStep', 'domain', 'businessName', 'createdAt', 'completedAt'] });
    res.json({ reports: rows.map((r) => ({ id: r.id, kind: r.kind || 'pre_seo', status: r.status, progress: r.progress, currentStep: r.currentStep || '', domain: r.domain, businessName: r.businessName, createdAt: r.createdAt, completedAt: r.completedAt })) });
  } catch (e) { next(e); }
});

// Global list of ALL Pre-SEO reports (the Reports list page). Mirrors the CRM
// reports list: health score, business, agent, status, run date, share state.
router.get('/preseo', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const q = String((req.query && req.query.q) || '').trim().toLowerCase();
    // IMPORTANT: sort ONLY over small scalar columns. Selecting the big JSON
    // columns (crawl/data/shots, often megabytes each) and then ORDER BY on them
    // overflows MySQL's sort buffer ("Out of sort memory"). So the sorted query
    // excludes those blobs; we load the two we need (data, shots) in a second,
    // UN-sorted query keyed by id.
    // Both report types live in this table; the UI shows a Type column and,
    // while a report is building, its live progress under Status.
    const SCALAR = ['id', 'projectId', 'kind', 'domain', 'businessName', 'status', 'progress', 'currentStep', 'createdByName', 'createdAt', 'completedAt', 'publicEnabled', 'publicSlug'];
    const rows = await PreSeoReport.findAll({ attributes: SCALAR, order: [['id', 'DESC']], limit: 500 });
    const ids = rows.map((r) => r.id);
    // Second pass: just id + the two JSON columns we summarise, no ORDER BY.
    const blobMap = {};
    if (ids.length) {
      const blobs = await PreSeoReport.findAll({ attributes: ['id', 'data', 'shots'], where: { id: ids } });
      for (const b of blobs) blobMap[b.id] = b;
    }
    const items = rows.map((r) => {
      const b = blobMap[r.id] || {};
      const hs = b.data && b.data.report && b.data.report.healthScore;
      const svc = (b.data && b.data.report && b.data.report.services) || [];
      return {
        id: r.id, projectId: r.projectId, kind: r.kind || 'pre_seo', domain: r.domain, businessName: r.businessName,
        status: r.status, progress: r.progress, currentStep: r.currentStep || '',
        score: hs && typeof hs.value === 'number' ? hs.value : null,
        services: Array.isArray(svc) ? svc : [], agentName: r.createdByName || '',
        createdAt: r.createdAt, completedAt: r.completedAt,
        shared: !!r.publicEnabled, publicSlug: r.publicSlug || null,
        shotCount: Object.values((b.shots) || {}).filter((s) => s && s.source === 'upload').length,
      };
    }).filter((it) => !q || (it.businessName || '').toLowerCase().includes(q) || (it.domain || '').toLowerCase().includes(q));
    res.json({ items });
  } catch (e) { next(e); }
});

// Diagnostics: confirm the table is reachable and show what's stored. Visit
// /api/hr/projects/preseo-diag?token=... when the list looks empty.
router.get('/preseo-diag', guard, requireHrAdmin, async (req, res) => {
  const out = { ok: true, version: global.__APP_VERSION__ || null };
  try {
    out.count = await PreSeoReport.count();
    const rows = await PreSeoReport.findAll({ order: [['createdAt', 'DESC']], limit: 5, attributes: ['id', 'domain', 'businessName', 'status', 'createdAt', 'pdfUrl', 'htmlUrl'] });
    out.recent = rows.map((r) => ({ id: r.id, domain: r.domain, business: r.businessName, status: r.status, createdAt: r.createdAt, hasPdfUrl: !!r.pdfUrl, hasHtmlUrl: !!r.htmlUrl }));
    // which columns does the live table actually have?
    try { const qi = PreSeoReport.sequelize.getQueryInterface(); const desc = await qi.describeTable('pre_seo_reports'); out.columns = Object.keys(desc); } catch (e) { out.columnsError = e.message; }
  } catch (e) { out.ok = false; out.error = e.message; }
  res.json(out);
});

// Delete a Pre-SEO report (admin). Also removes its ImageKit files (PDF, HTML,
// and every stored screenshot) so nothing is orphaned.
router.delete('/preseo/:rid', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const r = await PreSeoReport.findByPk(req.params.rid);
    if (!r) return res.status(404).json({ error: 'Report not found.' });
    try {
      const ik = require('../services/imagekit');
      if (r.pdfFileId) ik.deleteFile(r.pdfFileId).catch(() => {});
      if (r.htmlFileId) ik.deleteFile(r.htmlFileId).catch(() => {});
      for (const s of Object.values(r.shots || {})) {
        if (s && s.fileId) ik.deleteFile(s.fileId).catch(() => {});
        else if (s && s.url && /imagekit/i.test(s.url)) { const fid = ik.fileIdFromUrl && ik.fileIdFromUrl(s.url); if (fid) ik.deleteFile(fid).catch(() => {}); }
      }
    } catch {}
    await r.destroy();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- Public share link (same trackable /r/ pattern as CRM reports) ---------
const publicUrl = require('../services/publicUrl');
function preseoSlug(name) {
  return String(name || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 40) || 'report';
}
// Create / return the public link.
router.post('/preseo/:rid/share', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const r = await PreSeoReport.findByPk(req.params.rid);
    if (!r) return res.status(404).json({ error: 'Report not found.' });
    if (!r.publicSlug) {
      let slug = preseoSlug(r.businessName || r.domain);
      const exists = await PreSeoReport.findOne({ where: { publicSlug: slug } });
      if (exists && exists.id !== r.id) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
      r.publicSlug = slug;
    }
    r.publicEnabled = true; await r.save();
    const base = await publicUrl.baseFor('reports', req);
    res.json({ slug: r.publicSlug, url: `${base}/pr/${r.publicSlug}`, enabled: true });
  } catch (e) { next(e); }
});
router.post('/preseo/:rid/share/disable', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const r = await PreSeoReport.findByPk(req.params.rid);
    if (!r) return res.status(404).json({ error: 'Report not found.' });
    r.publicEnabled = false; await r.save();
    res.json({ enabled: false });
  } catch (e) { next(e); }
});
// Current link + view/download tracking log.
router.get('/preseo/:rid/share', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const r = await PreSeoReport.findByPk(req.params.rid);
    if (!r) return res.status(404).json({ error: 'Report not found.' });
    const base = await publicUrl.baseFor('reports', req);
    const views = Array.isArray(r.publicViews) ? r.publicViews : [];
    res.json({
      slug: r.publicSlug, enabled: !!r.publicEnabled,
      url: r.publicSlug ? `${base}/pr/${r.publicSlug}` : null,
      views,
      viewCount: views.filter((v) => v.type === 'view').length,
      downloadCount: views.filter((v) => v.type === 'download').length,
      lastViewedAt: views.length ? views[views.length - 1].at : null,
    });
  } catch (e) { next(e); }
});

// Upload a screenshot into a named slot (slot = section number e.g. "2.1" or a key).
router.post('/preseo/:rid/shot', guard, requireHrAdmin, shotUpload.single('shot'), async (req, res, next) => {
  try {
    const r = await PreSeoReport.findByPk(req.params.rid);
    if (!r) return res.status(404).json({ error: 'Report not found.' });
    const slot = String((req.body && req.body.slot) || '').trim();
    if (!slot || !req.file) return res.status(400).json({ error: 'slot and image required.' });
    // Promote the just-written local file to ImageKit when configured.
    const { promoteLocal } = require('../services/preSeoStore');
    const stored = await promoteLocal(`/uploads/${req.file.filename}`, `preseo-${r.id}-${slot}-${req.file.filename}`);
    const shots = { ...(r.shots || {}) };
    shots[slot] = { source: 'upload', url: stored.url, fileId: stored.fileId || null, label: req.body.label || '', note: req.body.note || '' };
    r.shots = shots; r.changed('shots', true); await r.save();
    res.json({ ok: true, slot, url: shots[slot].url });
  } catch (e) { next(e); }
});

// Save edited report data (the review step).
router.put('/preseo/:rid', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const r = await PreSeoReport.findByPk(req.params.rid);
    if (!r) return res.status(404).json({ error: 'Report not found.' });
    if (req.body && req.body.data) { r.data = req.body.data; r.changed('data', true); await r.save(); }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Re-run the audit: fresh crawl + analysis, KEEPING every screenshot already
// uploaded (run() merges uploads over auto-captures). Run options (sitemap,
// access mode) are preserved via runOptions.
router.post('/preseo/:rid/rerun', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const r = await PreSeoReport.findByPk(req.params.rid);
    if (!r) return res.status(404).json({ error: 'Report not found.' });
    // Keep uploaded shots; drop the auto-captured ones so they regenerate fresh.
    const keptShots = {};
    for (const [k, v] of Object.entries(r.shots || {})) if (v && v.source === 'upload') keptShots[k] = v;
    r.shots = keptShots; r.changed('shots', true);
    r.status = 'capturing'; r.progress = 5; r.currentStep = 'Re-running the audit'; r.error = null;
    await r.save();
    preSeoRunner.run(r.id).catch((e) => console.error('[preseo] rerun error:', e.message));
    res.json({ ok: true, status: 'capturing' });
  } catch (e) { next(e); }
});

// Generate the PDF from the current data.
// Pre-download AI verification: catch mistakes (wrong address, dirty NAP, etc.)
// and return per-field checks for the user to resolve in a popup.
router.post('/preseo/:rid/verify', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const r = await PreSeoReport.findByPk(req.params.rid);
    if (!r) return res.status(404).json({ error: 'Report not found.' });
    const result = await preSeoRunner.verify(r.id);
    res.json(result);
  } catch (e) { next(e); }
});

// Apply the user's resolutions from the verification popup to the stored data.
router.post('/preseo/:rid/apply-verification', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const r = await PreSeoReport.findByPk(req.params.rid);
    if (!r) return res.status(404).json({ error: 'Report not found.' });
    const out = await preSeoRunner.applyVerification(r.id, (req.body && req.body.resolutions) || {});
    res.json(out);
  } catch (e) { next(e); }
});

router.post('/preseo/:rid/generate', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const r = await PreSeoReport.findByPk(req.params.rid);
    if (!r) return res.status(404).json({ error: 'Report not found.' });
    await preSeoRunner.generate(r.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Download / view the generated PDF.
const fsSync = require('fs');
router.get('/preseo/:rid/download', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const r = await PreSeoReport.findByPk(req.params.rid);
    if (!r) return res.status(404).json({ error: 'Report not found.' });
    // Prefer the durable ImageKit copy; fall back to local disk if still there.
    if (r.pdfPath && fsSync.existsSync(r.pdfPath)) return res.download(r.pdfPath, `${(r.businessName || r.domain || 'report').replace(/[^\w-]/g, '_')}-Pre-SEO-Audit.pdf`);
    if (r.pdfUrl) return res.redirect(302, r.pdfUrl);
    return res.status(404).json({ error: 'PDF not ready.' });
  } catch (e) { next(e); }
});
router.get('/preseo/:rid/view', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const r = await PreSeoReport.findByPk(req.params.rid);
    if (!r) return res.status(404).json({ error: 'Report not found.' });
    res.set('Cache-Control', 'no-store');
    if (r.htmlPath && fsSync.existsSync(r.htmlPath)) return res.sendFile(path.resolve(r.htmlPath));
    if (r.htmlUrl) return res.redirect(302, r.htmlUrl);
    return res.status(404).json({ error: 'Not ready.' });
  } catch (e) { next(e); }
});

// ===========================================================================
// BRAND GUIDELINE reports — share the PreSeoReport table (kind='brand_guideline')
// so they reuse the same status/sharing/ImageKit plumbing. Routes are a parallel
// set under /brandguide so the two report types never collide.
// ===========================================================================
const BG_KIND = 'brand_guideline';

// Create + start a brand guideline for a website.
router.post('/:id/brandguide', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const act = await actor(req);
    const project = req.params.id !== 'none' ? await Project.findByPk(req.params.id) : null;
    const b = req.body || {};
    const website = String(b.website || (project && project.website) || '').trim();
    if (!website || website.length < 4) return res.status(400).json({ error: 'A website URL is required.' });
    let domain = '';
    try { domain = new URL(website.startsWith('http') ? website : 'https://' + website).hostname.replace(/^www\./, ''); } catch { domain = website.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]; }
    const arr = (v) => Array.isArray(v) ? v.filter(Boolean) : (typeof v === 'string' && v ? v.split(/[,;]/).map((s) => s.trim()).filter(Boolean) : []);
    const report = await PreSeoReport.create({
      projectId: project ? project.id : null, kind: BG_KIND,
      website: website.startsWith('http') ? website : 'https://' + website,
      domain, businessName: b.businessName || (project && project.customerName) || domain,
      createdById: act.id, createdByName: act.name || 'Qtonix', status: 'capturing', progress: 5,
      runOptions: {
        industry: String(b.industry || '').slice(0, 300),
        audiences: arr(b.audiences).slice(0, 6),
        postsPerMonth: Math.max(1, Math.min(60, Number(b.postsPerMonth) || 10)),
        platforms: arr(b.platforms).slice(0, 8),
        cadence: String(b.cadence || '').slice(0, 300),
        peakSeason: String(b.peakSeason || '').slice(0, 200),
        tone: String(b.tone || '').slice(0, 200),
        logoUrl: String(b.logoUrl || '').slice(0, 500),
        fontOverride: String(b.fontOverride || '').slice(0, 60),
        colorOverrides: Array.isArray(b.colorOverrides) ? b.colorOverrides.slice(0, 8) : null,
        contactEmail: String(b.contactEmail || act.email || 'adam@qtonix.com').slice(0, 120),
      },
      data: {},
    });
    brandGuideRunner.run(report.id).catch((e) => console.error('[brandguide] run error:', e.message));
    res.status(201).json({ id: report.id, status: report.status });
  } catch (e) { next(e); }
});

// Upload a logo image for a guideline (stored on ImageKit, saved to runOptions).
// Supports a `variant` field: full (primary) | reverse | one | icon. The
// primary ("full") also sets logoUrl/logo for backward compatibility and for
// every place that still uses the single logo.
const LOGO_VARIANTS = { full: 'logoFull', reverse: 'logoReverse', one: 'logoOne', icon: 'logoIcon' };
router.post('/brandguide/:rid/logo', guard, requireHrAdmin, shotUpload.single('logo'), async (req, res, next) => {
  try {
    const r = await PreSeoReport.findByPk(req.params.rid);
    if (!r || r.kind !== BG_KIND) return res.status(404).json({ error: 'Guideline not found.' });
    if (!req.file) return res.status(400).json({ error: 'Image required.' });
    const variant = String(req.body.variant || 'full').toLowerCase();
    const key = LOGO_VARIANTS[variant] || 'logoFull';
    const { promoteLocal } = require('../services/preSeoStore');
    const stored = await promoteLocal(`/uploads/${req.file.filename}`, `brandguide-${r.id}-logo-${variant}-${req.file.filename}`);
    const ro = { ...(r.runOptions || {}), [key]: stored.url };
    // The primary logo also drives the single logoUrl used elsewhere.
    if (variant === 'full') ro.logoUrl = stored.url;
    // If no primary set yet, the first uploaded variant becomes the default logo.
    if (!ro.logoUrl) ro.logoUrl = stored.url;
    r.runOptions = ro; r.changed('runOptions', true);
    // Reflect in the live data immediately so the preview updates without a re-run.
    if (r.data && r.data.report) {
      const d = JSON.parse(JSON.stringify(r.data));
      d.logos = d.logos || {};
      d.logos[variant] = stored.url;
      if (variant === 'full' || !d.logo) d.logo = stored.url;
      r.data = d; r.changed('data', true);
    }
    await r.save();
    res.json({ ok: true, url: stored.url, variant });
  } catch (e) { next(e); }
});

// Upload a COVER / hero photo for a guideline (used on the cover + thank-you page).
router.post('/brandguide/:rid/cover', guard, requireHrAdmin, shotUpload.single('cover'), async (req, res, next) => {
  try {
    const r = await PreSeoReport.findByPk(req.params.rid);
    if (!r || r.kind !== BG_KIND) return res.status(404).json({ error: 'Guideline not found.' });
    if (!req.file) return res.status(400).json({ error: 'Image required.' });
    const { promoteLocal } = require('../services/preSeoStore');
    const stored = await promoteLocal(`/uploads/${req.file.filename}`, `brandguide-${r.id}-cover-${req.file.filename}`);
    const ro = { ...(r.runOptions || {}), coverImageUrl: stored.url };
    r.runOptions = ro; r.changed('runOptions', true);
    if (r.data && r.data.report) { const d = JSON.parse(JSON.stringify(r.data)); d.cover = d.cover || {}; d.cover.heroImage = stored.url; d.images = d.images || {}; d.images.hero = stored.url; r.data = d; r.changed('data', true); }
    await r.save();
    res.json({ ok: true, url: stored.url });
  } catch (e) { next(e); }
});

// Add an extra IMAGE to a guideline's photo pool (on top of the ones pulled
// from the site). `kind`: 'lifestyle' (general gallery/cover pool) or 'product'
// (product page). Appended into data.images so it's used on the next render and
// shown immediately in the review panel. Also remembered in runOptions so a
// re-run keeps the user's uploads.
router.post('/brandguide/:rid/image', guard, requireHrAdmin, shotUpload.single('image'), async (req, res, next) => {
  try {
    const r = await PreSeoReport.findByPk(req.params.rid);
    if (!r || r.kind !== BG_KIND) return res.status(404).json({ error: 'Guideline not found.' });
    if (!req.file) return res.status(400).json({ error: 'Image required.' });
    const kind = String(req.body.kind || 'lifestyle').toLowerCase() === 'product' ? 'product' : 'lifestyle';
    const { promoteLocal } = require('../services/preSeoStore');
    const stored = await promoteLocal(`/uploads/${req.file.filename}`, `brandguide-${r.id}-img-${kind}-${req.file.filename}`);
    const item = { url: stored.url, alt: String(req.body.alt || '').slice(0, 140), kind, uploaded: true };
    // Persist the upload list on runOptions (survives a re-run).
    const ro = { ...(r.runOptions || {}) };
    ro.extraImages = Array.isArray(ro.extraImages) ? ro.extraImages : [];
    ro.extraImages.push(item);
    r.runOptions = ro; r.changed('runOptions', true);
    // Reflect in the live data immediately so the preview/render picks it up.
    if (r.data) {
      const d = JSON.parse(JSON.stringify(r.data));
      d.images = d.images || {};
      d.images.all = Array.isArray(d.images.all) ? d.images.all : [];
      d.images.lifestyle = Array.isArray(d.images.lifestyle) ? d.images.lifestyle : [];
      d.images.product = Array.isArray(d.images.product) ? d.images.product : [];
      d.images.all.push(item);
      if (kind === 'product') d.images.product.push(item); else d.images.lifestyle.push(item);
      r.data = d; r.changed('data', true);
    }
    await r.save();
    res.json({ ok: true, url: stored.url, kind, item });
  } catch (e) { next(e); }
});

// Remove a previously-uploaded extra image by URL (only user uploads, not
// site-pulled ones).
router.post('/brandguide/:rid/image/remove', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const r = await PreSeoReport.findByPk(req.params.rid);
    if (!r || r.kind !== BG_KIND) return res.status(404).json({ error: 'Guideline not found.' });
    const url = String((req.body && req.body.url) || '');
    if (!url) return res.status(400).json({ error: 'url required.' });
    const ro = { ...(r.runOptions || {}) };
    ro.extraImages = (Array.isArray(ro.extraImages) ? ro.extraImages : []).filter((i) => i.url !== url);
    r.runOptions = ro; r.changed('runOptions', true);
    if (r.data && r.data.images) {
      const d = JSON.parse(JSON.stringify(r.data));
      const strip = (arr) => (Array.isArray(arr) ? arr.filter((i) => !(i && i.uploaded && i.url === url)) : arr);
      d.images.all = strip(d.images.all);
      d.images.lifestyle = strip(d.images.lifestyle);
      d.images.product = strip(d.images.product);
      r.data = d; r.changed('data', true);
    }
    await r.save();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Poll one guideline.
router.get('/brandguide/:rid', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const r = await PreSeoReport.findByPk(req.params.rid);
    if (!r || r.kind !== BG_KIND) return res.status(404).json({ error: 'Guideline not found.' });
    res.json({ id: r.id, status: r.status, progress: r.progress, currentStep: r.currentStep, error: r.error, domain: r.domain, businessName: r.businessName, website: r.website, data: r.data || null, runOptions: r.runOptions || {} });
  } catch (e) { next(e); }
});

// List a project's guidelines.
router.get('/:id/brandguide', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const rows = await PreSeoReport.findAll({ where: { projectId: req.params.id, kind: BG_KIND }, order: [['id', 'DESC']], attributes: ['id', 'status', 'progress', 'domain', 'businessName', 'createdAt', 'completedAt'] });
    res.json({ reports: rows });
  } catch (e) { next(e); }
});

// Global list of all guidelines (scalar columns only — avoids the JSON sort-memory issue).
router.get('/brandguide', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const rows = await PreSeoReport.findAll({
      where: { kind: BG_KIND },
      attributes: ['id', 'projectId', 'domain', 'businessName', 'status', 'progress', 'createdByName', 'createdAt', 'completedAt', 'publicEnabled', 'publicSlug'],
      order: [['id', 'DESC']], limit: 500,
    });
    res.json({ items: rows.map((r) => ({ id: r.id, projectId: r.projectId, domain: r.domain, businessName: r.businessName, status: r.status, agentName: r.createdByName, createdAt: r.createdAt, completedAt: r.completedAt, shared: !!r.publicEnabled })) });
  } catch (e) { next(e); }
});

// Save edits to a guideline's data before/after generate.
router.put('/brandguide/:rid', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const r = await PreSeoReport.findByPk(req.params.rid);
    if (!r || r.kind !== BG_KIND) return res.status(404).json({ error: 'Guideline not found.' });
    if (req.body && req.body.data) { r.data = req.body.data; r.changed('data', true); await r.save(); }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Pre-download AI verification (brand name / tagline consistency).
router.post('/brandguide/:rid/verify', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const r = await PreSeoReport.findByPk(req.params.rid);
    if (!r || r.kind !== BG_KIND) return res.status(404).json({ error: 'Guideline not found.' });
    res.json(await brandGuideRunner.verify(r.id));
  } catch (e) { next(e); }
});
router.post('/brandguide/:rid/apply-verification', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const r = await PreSeoReport.findByPk(req.params.rid);
    if (!r || r.kind !== BG_KIND) return res.status(404).json({ error: 'Guideline not found.' });
    res.json(await brandGuideRunner.applyVerification(r.id, (req.body && req.body.resolutions) || {}));
  } catch (e) { next(e); }
});

// Generate (render) the PDF.
router.post('/brandguide/:rid/generate', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const r = await PreSeoReport.findByPk(req.params.rid);
    if (!r || r.kind !== BG_KIND) return res.status(404).json({ error: 'Guideline not found.' });
    await brandGuideRunner.generate(r.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Re-run: fresh crawl + AI, keeping the run options.
router.post('/brandguide/:rid/rerun', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const r = await PreSeoReport.findByPk(req.params.rid);
    if (!r || r.kind !== BG_KIND) return res.status(404).json({ error: 'Guideline not found.' });
    r.status = 'capturing'; r.progress = 5; r.currentStep = 'Re-running'; r.error = null; await r.save();
    brandGuideRunner.run(r.id).catch((e) => console.error('[brandguide] rerun error:', e.message));
    res.json({ ok: true, status: 'capturing' });
  } catch (e) { next(e); }
});

// Delete.
router.delete('/brandguide/:rid', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const r = await PreSeoReport.findByPk(req.params.rid);
    if (!r || r.kind !== BG_KIND) return res.status(404).json({ error: 'Guideline not found.' });
    try { const ik = require('../services/imagekit'); if (r.pdfFileId) ik.deleteFile(r.pdfFileId).catch(() => {}); if (r.htmlFileId) ik.deleteFile(r.htmlFileId).catch(() => {}); } catch {}
    await r.destroy();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Download / view.
router.get('/brandguide/:rid/download', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const r = await PreSeoReport.findByPk(req.params.rid);
    if (!r || r.kind !== BG_KIND) return res.status(404).json({ error: 'Guideline not found.' });
    if (r.pdfPath && fsSync.existsSync(r.pdfPath)) return res.download(r.pdfPath, `${(r.businessName || r.domain || 'brand').replace(/[^\w-]/g, '_')}-Brand-Guidelines.pdf`);
    if (r.pdfUrl) return res.redirect(302, r.pdfUrl);
    return res.status(404).json({ error: 'PDF not ready.' });
  } catch (e) { next(e); }
});
router.get('/brandguide/:rid/view', guard, requireHrAdmin, async (req, res, next) => {
  try {
    const r = await PreSeoReport.findByPk(req.params.rid);
    if (!r || r.kind !== BG_KIND) return res.status(404).json({ error: 'Guideline not found.' });
    res.set('Cache-Control', 'no-store');
    if (r.htmlPath && fsSync.existsSync(r.htmlPath)) return res.sendFile(path.resolve(r.htmlPath));
    if (r.htmlUrl) return res.redirect(302, r.htmlUrl);
    return res.status(404).json({ error: 'Not ready.' });
  } catch (e) { next(e); }
});

module.exports = router;

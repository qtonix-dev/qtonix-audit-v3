const express = require('express');
const { StickyNote, User, HrUser, Op } = require('../models');

// This router is mounted twice: once for CRM (surface 'crm', CRM auth) and once
// for HRMS (surface 'hrms', HR auth). The mounting code injects req.noteCtx =
// { surface, meId, role, name, isAdmin, isManager, reportIds }.
function makeRouter() {
  const router = express.Router();

  const sanitize = (html) => {
    // Keep only the formatting tags our editor produces; strip scripts/handlers.
    let s = String(html || '');
    s = s.replace(/<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
    s = s.replace(/ on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    s = s.replace(/(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, '');
    return s.slice(0, 100000);
  };
  const pub = (n) => { const o = n.toJSON ? n.toJSON() : n; return o; };

  // Who can this viewer see? own always; manager → own + reports; admin → all.
  async function visibleWhere(ctx, { archived = false } = {}) {
    const base = { surface: ctx.surface, archived };
    if (ctx.isAdmin) return base; // all
    if (ctx.isManager && ctx.reportIds && ctx.reportIds.length) return { ...base, ownerId: { [Op.in]: [ctx.meId, ...ctx.reportIds] } };
    return { ...base, ownerId: ctx.meId };
  }

  // Look up the department for a set of owner ids (HRMS uses HrUser, CRM uses User).
  async function deptMap(ctx, ids) {
    const out = {};
    if (!ids.length) return out;
    try {
      if (ctx.surface === 'hrms') {
        const us = await HrUser.findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id', 'department'] });
        us.forEach((u) => { out[u.id] = u.department || ''; });
      } else {
        const us = await User.findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id'] });
        us.forEach((u) => { out[u.id] = ''; }); // CRM has no department concept here
      }
    } catch { /* best-effort */ }
    return out;
  }

  // LIST (non-archived). Recently edited first.
  router.get('/', async (req, res, next) => {
    try {
      const ctx = req.noteCtx;
      const where = await visibleWhere(ctx);
      let rows = await StickyNote.findAll({ where, order: [['pinned', 'DESC'], ['updatedAt', 'DESC']] });
      const q = req.query.q ? String(req.query.q).toLowerCase() : '';
      if (q) rows = rows.filter((r) => `${r.title} ${String(r.body).replace(/<[^>]*>/g, ' ')} ${r.ownerName || ''}`.toLowerCase().includes(q));
      // Admin-only department filter (HRMS): map each owner to a department and
      // keep only notes whose owner is in the chosen department.
      const dept = req.query.department ? String(req.query.department) : '';
      let dmap = {};
      if (ctx.isAdmin && ctx.surface === 'hrms') dmap = await deptMap(ctx, [...new Set(rows.map((r) => r.ownerId))]);
      if (dept && ctx.isAdmin && ctx.surface === 'hrms') rows = rows.filter((r) => (dmap[r.ownerId] || '') === dept);
      const owner = req.query.owner ? Number(req.query.owner) : null;
      if (owner) rows = rows.filter((r) => r.ownerId === owner);
      // Hide edit count from plain agents (their own view).
      const showEdits = ctx.isAdmin || ctx.isManager;
      res.json({
        notes: rows.map((r) => { const o = pub(r); if (!showEdits) delete o.editCount; return o; }),
        canSeeTeam: ctx.isAdmin || ctx.isManager,
        isAdmin: ctx.isAdmin, isManager: ctx.isManager, meId: ctx.meId, showEdits,
        owners: (ctx.isAdmin || ctx.isManager) ? await ownerList(ctx, dept) : [],
        departments: (ctx.isAdmin && ctx.surface === 'hrms') ? await departmentList(ctx) : [],
      });
    } catch (e) { next(e); }
  });

  // Departments that actually have notes (HRMS admin), with note counts.
  async function departmentList(ctx) {
    const where = await visibleWhere(ctx);
    const rows = await StickyNote.findAll({ where, attributes: ['ownerId'] });
    const ids = [...new Set(rows.map((r) => r.ownerId))];
    const dmap = await deptMap(ctx, ids);
    const counts = {};
    for (const r of rows) { const d = dmap[r.ownerId] || ''; if (!d) continue; counts[d] = (counts[d] || 0) + 1; }
    return Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
  }

  async function ownerList(ctx, dept = '') {
    // For the owner chips: distinct owners the viewer can see, with note counts.
    // When a department is chosen (HRMS admin), restrict owners to that department.
    const where = await visibleWhere(ctx);
    const rows = await StickyNote.findAll({ where, attributes: ['ownerId', 'ownerName'] });
    let dmap = {};
    if (dept && ctx.isAdmin && ctx.surface === 'hrms') dmap = await deptMap(ctx, [...new Set(rows.map((r) => r.ownerId))]);
    const map = {};
    for (const r of rows) {
      if (dept && ctx.isAdmin && ctx.surface === 'hrms' && (dmap[r.ownerId] || '') !== dept) continue;
      const k = r.ownerId; map[k] = map[k] || { id: r.ownerId, name: r.ownerName || `#${r.ownerId}`, count: 0 }; map[k].count++;
    }
    return Object.values(map).sort((a, b) => (a.id === ctx.meId ? -1 : b.id === ctx.meId ? 1 : a.name.localeCompare(b.name)));
  }

  // CREATE
  router.post('/', async (req, res, next) => {
    try {
      const ctx = req.noteCtx; const b = req.body || {};
      const n = await StickyNote.create({
        surface: ctx.surface, ownerId: ctx.meId, ownerName: ctx.name,
        title: String(b.title || '').slice(0, 200), body: sanitize(b.body || ''),
        color: b.color || 'yellow', fontSize: ['small', 'medium', 'large'].includes(b.fontSize) ? b.fontSize : 'medium',
        editCount: 0,
      });
      res.json({ note: pub(n) });
    } catch (e) { next(e); }
  });

  // UPDATE (auto-save). Only the OWNER can edit content. Managers/admin are read-only
  // on others' notes (but the owner themselves edits normally).
  router.put('/:id', async (req, res, next) => {
    try {
      const ctx = req.noteCtx; const b = req.body || {};
      const n = await StickyNote.findByPk(Number(req.params.id));
      if (!n || n.surface !== ctx.surface || n.archived) return res.status(404).json({ error: 'Not found.' });
      const isOwner = n.ownerId === ctx.meId;
      if (!isOwner) return res.status(403).json({ error: 'Read-only — you can view but not edit this note.' });
      const before = { title: n.title, body: n.body, color: n.color, fontSize: n.fontSize };
      if (b.title !== undefined) n.title = String(b.title).slice(0, 200);
      if (b.body !== undefined) n.body = sanitize(b.body);
      if (b.color !== undefined) n.color = String(b.color).slice(0, 20);
      if (b.fontSize !== undefined && ['small', 'medium', 'large'].includes(b.fontSize)) n.fontSize = b.fontSize;
      if (b.pinned !== undefined) n.pinned = !!b.pinned;
      // Count an edit SESSION (content changed) — throttled: only bump if the last
      // edit was more than 3 minutes ago, so rapid auto-saves count once.
      const contentChanged = before.title !== n.title || before.body !== n.body;
      if (contentChanged) {
        const now = Date.now();
        const gap = n.lastEditAt ? now - new Date(n.lastEditAt).getTime() : Infinity;
        if (gap > 3 * 60 * 1000) n.editCount = (n.editCount || 0) + 1;
        n.lastEditAt = new Date();
      }
      await n.save();
      res.json({ note: pub(n) });
    } catch (e) { next(e); }
  });

  // DELETE → archive (soft). Owner can archive their own; admin can archive any.
  router.delete('/:id', async (req, res, next) => {
    try {
      const ctx = req.noteCtx;
      const n = await StickyNote.findByPk(Number(req.params.id));
      if (!n || n.surface !== ctx.surface) return res.status(404).json({ error: 'Not found.' });
      if (n.ownerId !== ctx.meId && !ctx.isAdmin) return res.status(403).json({ error: 'You can only delete your own notes.' });
      n.archived = true; n.archivedAt = new Date(); await n.save();
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // ARCHIVE list — ADMIN ONLY (all surfaces' deleted notes for this surface).
  router.get('/archive/list', async (req, res, next) => {
    try {
      const ctx = req.noteCtx;
      if (!ctx.isAdmin) return res.status(403).json({ error: 'Admin only.' });
      const rows = await StickyNote.findAll({ where: { surface: ctx.surface, archived: true }, order: [['archivedAt', 'DESC']] });
      res.json({ notes: rows.map(pub) });
    } catch (e) { next(e); }
  });

  // RESTORE — ADMIN ONLY. Returns the note to its original owner.
  router.post('/archive/:id/restore', async (req, res, next) => {
    try {
      const ctx = req.noteCtx;
      if (!ctx.isAdmin) return res.status(403).json({ error: 'Admin only.' });
      const n = await StickyNote.findByPk(Number(req.params.id));
      if (!n || n.surface !== ctx.surface) return res.status(404).json({ error: 'Not found.' });
      n.archived = false; n.archivedAt = null; await n.save();
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // PERMANENT DELETE — ADMIN ONLY.
  router.delete('/archive/:id', async (req, res, next) => {
    try {
      const ctx = req.noteCtx;
      if (!ctx.isAdmin) return res.status(403).json({ error: 'Admin only.' });
      const n = await StickyNote.findByPk(Number(req.params.id));
      if (n && n.surface === ctx.surface) await n.destroy();
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  return router;
}

module.exports = { makeRouter };

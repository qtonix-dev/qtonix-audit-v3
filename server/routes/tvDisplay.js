/**
 * Company TV Display (Phase 1) — richer than the legacy motivator board.
 *   GET /api/tv-display/feed/:token/:kind   → slide data (kind = company|sales), public via token
 *   GET /api/tv-display/config               → admin read (requireHrManager)
 *   PUT /api/tv-display/config               → admin save + ensure token
 */
const express = require('express');
const router = express.Router();
const { Settings } = require('../models');
const { buildPayload } = require('../services/tvData');
const { requireHrAccess, requireHrManager } = require('../middleware/hrAuth');

// Cache so a wall of TVs polling doesn't hammer the DB.
const cache = { company: { at: 0, data: null }, sales: { at: 0, data: null } };
const TTL = 20000;

// ---- Public feed (token in URL, no login) -----------------------------------
router.get('/feed/:token/:kind', async (req, res, next) => {
  try {
    const kind = req.params.kind === 'sales' ? 'sales' : 'company';
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    if (!s || !s.tvDisplayToken || req.params.token !== s.tvDisplayToken) return res.status(403).json({ error: 'Invalid display link.' });
    const c = cache[kind];
    if (c.data && Date.now() - c.at < TTL) return res.json(c.data);
    const data = await buildPayload(kind);
    c.data = data; c.at = Date.now();
    res.json(data);
  } catch (e) { next(e); }
});

// ---- Admin: read config + the shareable links -------------------------------
router.get('/config', requireHrAccess, requireHrManager, async (req, res, next) => {
  try {
    let s = await Settings.findOne({ where: { singleton: 'settings' } });
    if (!s) s = await Settings.create({ singleton: 'settings' });
    if (!s.tvDisplayToken) { s.tvDisplayToken = require('crypto').randomBytes(20).toString('hex'); await s.save(); }
    res.json({ config: s.tvDisplayConfig || {}, token: s.tvDisplayToken });
  } catch (e) { next(e); }
});

// ---- Admin: save config (+ optional token regenerate) -----------------------
router.put('/config', requireHrAccess, requireHrManager, async (req, res, next) => {
  try {
    let s = await Settings.findOne({ where: { singleton: 'settings' } });
    if (!s) s = await Settings.create({ singleton: 'settings' });
    const b = req.body || {};
    if (b.regenerate) s.tvDisplayToken = require('crypto').randomBytes(20).toString('hex');
    else if (!s.tvDisplayToken) s.tvDisplayToken = require('crypto').randomBytes(20).toString('hex');
    if (b.config) {
      const cur = s.tvDisplayConfig || {};
      s.tvDisplayConfig = {
        welcomeMessage: String(b.config.welcomeMessage ?? cur.welcomeMessage ?? '').slice(0, 200),
        rotateSeconds: Math.max(5, Math.min(60, Number(b.config.rotateSeconds ?? cur.rotateSeconds ?? 10))),
        theme: String(b.config.theme ?? cur.theme ?? 'midnight').slice(0, 20),
        slides: { ...(cur.slides || {}), ...(b.config.slides || {}) },
      };
      s.changed('tvDisplayConfig', true);
    }
    await s.save();
    // Invalidate cache so changes show quickly.
    cache.company.at = 0; cache.sales.at = 0;
    res.json({ config: s.tvDisplayConfig, token: s.tvDisplayToken });
  } catch (e) { next(e); }
});

// ===== Phase 3 interactive =====
const { TvPoll, TvCheer } = require('../models');

// Employee: current poll (to vote from the app).
router.get('/poll', requireHrAccess, async (req, res, next) => {
  try { const p = await TvPoll.findOne({ where: { active: true }, order: [['createdAt', 'DESC']] });
    if (!p) return res.json({ poll: null });
    const me = req.hrUser ? req.hrUser.id : (req.adminUser ? req.adminUser.id : null);
    res.json({ poll: { id: p.id, question: p.question, options: (p.options || []).map((o) => ({ id: o.id, label: o.label })), voted: (p.voters || []).includes(me) } });
  } catch (e) { next(e); }
});
// Employee: vote.
router.post('/poll/:id/vote', requireHrAccess, async (req, res, next) => {
  try {
    const p = await TvPoll.findByPk(Number(req.params.id));
    if (!p || !p.active) return res.status(404).json({ error: 'No active poll.' });
    const me = req.hrUser ? req.hrUser.id : (req.adminUser ? req.adminUser.id : null);
    if ((p.voters || []).includes(me)) return res.status(400).json({ error: 'You already voted.' });
    const optId = String((req.body || {}).optionId || '');
    const opts = (p.options || []).map((o) => o.id === optId ? { ...o, votes: (o.votes || 0) + 1 } : o);
    p.options = opts; p.voters = [...(p.voters || []), me]; p.changed('options', true); p.changed('voters', true); await p.save();
    cache.company.at = 0; cache.sales.at = 0;
    res.json({ ok: true });
  } catch (e) { next(e); }
});
// Employee: send a cheer to the TV.
router.post('/cheer', requireHrAccess, async (req, res, next) => {
  try {
    const b = req.body || {};
    const msg = String(b.message || '').slice(0, 160).trim();
    if (!msg) return res.status(400).json({ error: 'Write a cheer.' });
    const name = (req.hrUser && req.hrUser.name) || (req.adminUser && req.adminUser.name) || 'Someone';
    await TvCheer.create({ fromId: req.hrUser ? req.hrUser.id : null, fromName: name, emoji: String(b.emoji || '🎉').slice(0, 8), message: msg, toName: String(b.toName || '').slice(0, 120) });
    cache.company.at = 0; cache.sales.at = 0;
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Admin: create/replace the active poll.
router.post('/admin/poll', requireHrAccess, requireHrManager, async (req, res, next) => {
  try {
    const b = req.body || {};
    const question = String(b.question || '').slice(0, 200).trim();
    const options = Array.isArray(b.options) ? b.options.filter(Boolean).slice(0, 4).map((label, i) => ({ id: `o${i}`, label: String(label).slice(0, 60), votes: 0 })) : [];
    if (!question || options.length < 2) return res.status(400).json({ error: 'Need a question and at least 2 options.' });
    await TvPoll.update({ active: false }, { where: { active: true } });
    const p = await TvPoll.create({ question, options, active: true, voters: [] });
    cache.company.at = 0; cache.sales.at = 0;
    res.json({ poll: p.toJSON() });
  } catch (e) { next(e); }
});
// Admin: end the active poll.
router.post('/admin/poll/end', requireHrAccess, requireHrManager, async (req, res, next) => {
  try { await TvPoll.update({ active: false }, { where: { active: true } }); cache.company.at = 0; cache.sales.at = 0; res.json({ ok: true }); } catch (e) { next(e); }
});

module.exports = router;
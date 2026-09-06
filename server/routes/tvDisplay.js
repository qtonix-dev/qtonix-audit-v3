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

module.exports = router;

/**
 * STANDALONE AI BRIEFS
 * --------------------
 * The AI Brief page lets an agent look up any domain before a cold call —
 * independent of leads. Briefs are stored and cached by domain to save API
 * cost: once a domain has been briefed, anyone who looks it up again gets the
 * stored copy rather than a fresh (paid) run.
 *
 * Visibility: a brief is seen by the agent who ran it, that agent's manager,
 * and admins. Managers see everything their team ran; admins see everything.
 * The domain cache is global for CONTENT (never re-run a known domain), but the
 * LISTING respects visibility — each person who looks a domain up gets their
 * own row, so it shows in their history without exposing other people's runs.
 */

const express = require('express');
const { BusinessBrief, User, Settings, Op } = require('../models');
const { requireAuth } = require('../middleware/auth');
const { generateBrief } = require('../services/businessBrief');
const { normaliseUrl } = require('../services/crawler');

const router = express.Router();

/** Reduce a URL or hostname to a bare comparable domain (no scheme/www/path). */
function domainOf(input) {
  let s = String(input || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '');
  s = s.split('/')[0].split('?')[0].split('#')[0];
  return s;
}

/** The team+shift ids a manager oversees, for team visibility. */
function managerScopes(user) {
  return (Array.isArray(user.managerScopes) ? user.managerScopes : [])
    .filter((s) => s && s.team && s.shift);
}

/**
 * WHERE clause limiting briefs to what this user may see.
 *  - admin: everything
 *  - manager: their own, plus any run by an agent in a team+shift they manage
 *  - agent / leadmanager: only their own
 */
function visibilityWhere(user) {
  if (user.role === 'admin') return {};
  if (user.role === 'manager') {
    const scopes = managerScopes(user);
    const or = [{ agentId: user.id }];
    for (const s of scopes) or.push({ agentTeam: s.team, agentShift: s.shift });
    return { [Op.or]: or };
  }
  return { agentId: user.id };
}

/** Can this user view one specific brief row? */
function canView(user, row) {
  if (user.role === 'admin') return true;
  if (row.agentId === user.id) return true;
  if (user.role === 'manager') {
    return managerScopes(user).some((s) => s.team === row.agentTeam && s.shift === row.agentShift);
  }
  return false;
}

/**
 * POST /api/briefs — run (or reuse) a brief for a domain.
 * Body: { website, customerName, phone }
 *
 * If a brief already exists for the domain, a new row is created for this user
 * that shares the stored content (no API call). Otherwise the brief is
 * generated once and stored.
 */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const b = req.body || {};
    const website = String(b.website || '').trim();
    if (!website) return res.status(400).json({ error: 'Enter a website or domain.' });
    const domain = domainOf(website);
    if (!domain || !domain.includes('.')) return res.status(400).json({ error: 'That doesn’t look like a valid domain.' });

    const customerName = String(b.customerName || '').trim().slice(0, 190);
    const phone = String(b.phone || '').trim().slice(0, 60);
    if (!customerName) return res.status(400).json({ error: 'Enter the customer name.' });
    if (!phone) return res.status(400).json({ error: 'Enter the phone number.' });

    const me = await User.findByPk(req.user.id);

    // Cache hit: any existing brief for this domain, whoever ran it. We reuse
    // the content globally (that's the cost saving) but record a fresh row for
    // this user so it lands in their own history.
    const existing = await BusinessBrief.findOne({
      where: { domain, brief: { [Op.ne]: null } },
      order: [['createdAt', 'DESC']],
    });

    if (existing && existing.brief) {
      const row = await BusinessBrief.create({
        domain, website, customerName, phone,
        agentId: me.id, agentName: me.name, agentTeam: me.team, agentShift: me.shift,
        brief: existing.brief, cached: true, sharedFromId: existing.id,
      });
      return res.json({ brief: row.toJSON(), cached: true });
    }

    // No cache — generate once. This is the only path that spends API credit.
    const settings = await Settings.findOne({ where: { singleton: 'settings' } });
    const apiKey = settings && settings.getKey && settings.getKey('anthropic');
    if (!apiKey) return res.status(503).json({ error: 'No Claude API key configured. An admin can add one in Admin → API keys.' });
    const pageSpeedKey = settings.getKey && settings.getKey('pagespeed');

    let brief;
    try {
      brief = await generateBrief(apiKey, { website, businessName: customerName, pageSpeedKey });
    } catch (e) {
      if (/Could not read|no readable content|no website|Claude API/i.test(e.message)) {
        return res.status(422).json({ error: e.message });
      }
      throw e;
    }

    const row = await BusinessBrief.create({
      domain, website, customerName, phone,
      agentId: me.id, agentName: me.name, agentTeam: me.team, agentShift: me.shift,
      brief, cached: false, sharedFromId: null,
    });
    res.json({ brief: row.toJSON(), cached: false });
  } catch (e) { next(e); }
});

/** GET /api/briefs — listing, scoped to what the user may see, newest first. */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const rows = await BusinessBrief.findAll({
      where: visibilityWhere(req.user),
      order: [['createdAt', 'DESC']],
      limit: 500,
    });
    // Listing is lightweight — omit the full brief payload here.
    res.json({
      items: rows.map((r) => ({
        _id: r.id, domain: r.domain, website: r.website,
        customerName: r.customerName, phone: r.phone,
        agentId: r.agentId, agentName: r.agentName,
        cached: r.cached, createdAt: r.createdAt,
      })),
    });
  } catch (e) { next(e); }
});

/** GET /api/briefs/:id — one stored brief, if the user may see it. */
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const row = await BusinessBrief.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Brief not found.' });
    if (!canView(req.user, row)) return res.status(403).json({ error: 'You don’t have access to this brief.' });
    res.json({ brief: row.toJSON() });
  } catch (e) { next(e); }
});

/** DELETE /api/briefs/:id — admin only. */
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only an admin can delete briefs.' });
    const row = await BusinessBrief.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Brief not found.' });
    await row.destroy();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;

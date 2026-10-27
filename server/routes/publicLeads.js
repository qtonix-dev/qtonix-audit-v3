// ---------------------------------------------------------------------------
// Public lead intake — Ranknovo (and any custom site) → QHub CRM.
//
// A secret-guarded public endpoint (same pattern as the CallHippo webhook) that
// turns an inbound website submission into a CRM Lead. Used by Ranknovo for its
// three submission types: a contact/lead form, a chat request, and an analysis
// report request. Each becomes a Lead owned by the ADMIN, tagged by type and
// sourced as "Ranknovo", deduped by website domain so repeat submissions update
// the existing lead instead of creating duplicates.
//
//   GET  /api/public-leads/config            (admin)  → the webhook URL + secret
//   POST /api/public-leads/ranknovo/:secret  (public) → create/update a lead
//
// Expected JSON body (all optional except name or email):
//   { type: 'lead'|'chat'|'report',          // which Ranknovo form
//     name | firstName,lastName,
//     email, phone | mobile,
//     website | domain,                       // their site (for report requests)
//     service | services,                     // what they're interested in
//     message | additionalInfo,               // free text / chat message
//     country, city, source }                 // optional extras
// ---------------------------------------------------------------------------
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { Lead, User, Settings, encrypt, Op } = require('../models');

// --- helpers (self-contained; mirror leads.js normalisation) ----------------
function toDomain(website) {
  if (!website) return '';
  let s = String(website).trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0];
  s = s.replace(/^[^@]*@/, '').replace(/:\d+$/, '').replace(/^www\./, '');
  return s.trim();
}
async function findDuplicateByDomain(website) {
  const dom = toDomain(website);
  if (!dom) return null;
  const like = `%${dom}%`;
  const candidates = await Lead.findAll({
    where: { [Op.or]: [{ domain: dom }, { domain: { [Op.like]: like } }, { website: { [Op.like]: like } }] },
    order: [['createdAt', 'ASC']], limit: 50,
  });
  for (const c of candidates) if (toDomain(c.website) === dom || toDomain(c.domain) === dom) return c;
  return null;
}
function pushTimeline(lead, type, text, author, meta) {
  const tl = Array.isArray(lead.timeline) ? lead.timeline : [];
  tl.push({ type, text, time: new Date().toISOString(), author, ...(meta || {}) });
  lead.timeline = tl; lead.changed('timeline', true); lead.lastActivityAt = new Date();
}

// Resolve (and cache on Settings) the intake secret so the URL is stable.
async function getIntakeSecret(s) {
  let secret = s.getKey && s.getKey('ranknovoIntakeSecret');
  if (!secret) {
    secret = crypto.randomBytes(18).toString('hex');
    s.apiKeys = { ...s.apiKeys, ranknovoIntakeSecret: encrypt(secret) };
    s.changed('apiKeys', true);
    await s.save();
  }
  return secret;
}

// Labels + source for each Ranknovo submission type.
const TYPE_META = {
  lead:   { tag: 'Website Lead',      label: 'contact form',          source: 'Ranknovo' },
  chat:   { tag: 'Chat Request',      label: 'chat request',          source: 'Ranknovo (Chat)' },
  report: { tag: 'Report Request',    label: 'analysis report request', source: 'Ranknovo (Report)' },
};

// --- Admin: expose the webhook URL + secret ---------------------------------
router.get('/config', async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only.' });
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const secret = await getIntakeSecret(s);
    const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    res.json({ webhookUrl: `${base}/api/public-leads/ranknovo/${secret}` });
  } catch (e) { next(e); }
});

// --- Public: receive a Ranknovo submission → create/update a Lead -----------
router.post('/ranknovo/:secret', express.json({ limit: '256kb' }), async (req, res) => {
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const secret = await getIntakeSecret(s);
    // Constant-time compare so the secret can't be probed by timing.
    const given = String(req.params.secret || '');
    if (given.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
      return res.status(404).json({ error: 'Not found.' });
    }

    const b = req.body || {};
    const type = ['lead', 'chat', 'report'].includes(String(b.type)) ? String(b.type) : 'lead';
    const meta = TYPE_META[type];

    // Name: accept "name" or firstName/lastName.
    let firstName = String(b.firstName || '').trim();
    let lastName = String(b.lastName || '').trim();
    if (!firstName && b.name) { const parts = String(b.name).trim().split(/\s+/); firstName = parts.shift() || ''; lastName = parts.join(' '); }
    const email = String(b.email || '').trim().slice(0, 180);
    const phone = String(b.phone || b.mobile || '').trim().slice(0, 40);
    const website = String(b.website || b.domain || '').trim();

    // Need at least a name or an email or a phone to be a usable lead.
    if (!firstName && !email && !phone) {
      return res.status(400).json({ error: 'Provide at least a name, email, or phone.' });
    }

    const services = Array.isArray(b.services) ? b.services
      : (b.service ? [String(b.service)] : (b.services ? String(b.services).split(/[;,|]/).map((x) => x.trim()).filter(Boolean) : []));
    const message = String(b.message || b.additionalInfo || '').slice(0, 10000);

    // Owner = the admin (Adam), so every Ranknovo lead lands in one place.
    const admin = await User.findOne({ where: { role: 'admin', active: true }, order: [['id', 'ASC']] });
    if (!admin) return res.status(500).json({ error: 'No admin user to assign the lead to.' });

    // Dedup by website domain — a repeat submission updates the existing lead.
    const existing = website ? await findDuplicateByDomain(website) : null;
    if (existing) {
      if (!existing.email && email) existing.email = email;
      if (!existing.phone && phone) existing.phone = phone;
      if (!existing.mobile && phone) existing.mobile = phone;
      const tags = Array.isArray(existing.tags) ? existing.tags : [];
      if (!tags.includes(meta.tag)) { existing.tags = [...tags, meta.tag]; existing.changed('tags', true); }
      pushTimeline(existing, 'note', `New ${meta.label} from Ranknovo${message ? `: ${message}` : ''}`, 'Ranknovo');
      await existing.save();
      return res.json({ ok: true, deduped: true, leadId: existing.id });
    }

    const lead = await Lead.create({
      ownerId: admin.id, ownerName: admin.name,
      ownerTeam: admin.team || 'Bhubaneswar', ownerShift: admin.shift || 'Morning',
      firstName: (firstName || 'Website').slice(0, 120),
      lastName: lastName.slice(0, 120),
      website: toDomain(website),
      domain: toDomain(website),
      email, phone, mobile: phone,
      leadSource: meta.source.slice(0, 60),
      generatedBy: 'Ranknovo',
      status: 'new',
      servicesInterested: services.slice(0, 30),
      tags: [meta.tag],
      country: String(b.country || '').slice(0, 80),
      city: String(b.city || '').slice(0, 120),
      additionalInfo: message,
      generatedAt: new Date(),
      lastActivityAt: new Date(),
      timeline: [{ type: 'note', text: `Lead created from Ranknovo ${meta.label}${message ? `: ${message}` : ''}`, time: new Date().toISOString(), author: 'Ranknovo' }],
    });

    res.json({ ok: true, leadId: lead.id });
  } catch (e) {
    // Never hard-fail the website's form — log and return a soft error.
    console.error('[public-leads/ranknovo]', e.message);
    res.status(200).json({ ok: false, error: 'Could not record the lead.' });
  }
});

module.exports = router;

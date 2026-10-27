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
//     country, city, source,                  // optional extras
//     businessName,                            // (report) name for the report
//     // --- chat only: if the visitor books a call, any of these schedule a
//     //     "Call" task on the lead ---
//     callDate, callTime, timezone,            // preferred date/time (+ tz)
//     callAt | scheduledAt | preferredTime,    // or a single ISO timestamp
//     scheduleCall:true, callSlot | when }     // or a free-text slot
//
// Response: always JSON with a `status` ('success' | 'declined') and a
// visitor-ready `message`. Success also carries leadId, and reportId / callId
// when those were created. Declines carry a `reason`.
// ---------------------------------------------------------------------------
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { Lead, User, Settings, Report, encrypt, Op } = require('../models');

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

// For a REPORT request: create a Report record for the website (owned by the
// admin, linked to the lead) and queue it, so the analysis is ready/attached
// when sales follows up. Skips if there's no website or if the same domain was
// already reported in the last 7 days (don't waste SE Ranking credits). Soft:
// any failure here never breaks the lead creation.
async function maybeQueueReport({ lead, website, admin, businessName, services }) {
  try {
    const dom = toDomain(website);
    if (!dom) return null;
    // 7-day cache: reuse a recent report for this domain instead of re-running.
    const cacheCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recent = await Report.findOne({ where: { domain: dom, createdAt: { [Op.gte]: cacheCutoff } }, order: [['createdAt', 'DESC']] });
    if (recent) { if (lead) { recent.leadId = lead.id; await recent.save().catch(() => {}); } return recent.id; }

    const report = await Report.create({
      agentId: admin.id, agentName: admin.name, agentPhone: admin.phone || '',
      agentEmail: admin.email || '', agentDesignation: admin.designation || '',
      website: website, domain: dom,
      businessName: businessName || dom,
      customerName: lead ? `${lead.firstName} ${lead.lastName}`.trim() : '',
      customerEmail: lead ? lead.email : '',
      customerPhone: lead ? lead.phone : '',
      services: Array.isArray(services) ? services : [],
      status: 'queued',
      leadId: lead ? lead.id : null,
    });
    try { const { enqueueReport } = require('../queue'); await enqueueReport(report.id); } catch (e) { console.error('[public-leads] enqueue failed:', e.message); }
    return report.id;
  } catch (e) {
    console.error('[public-leads] maybeQueueReport failed:', e.message);
    return null;
  }
}

// When the chatbot (Novi) books a call, the body carries the preferred time.
// Create a scheduled "Call" activity on the lead — the exact shape the CRM's
// own POST /leads/:id/activities writes, so it shows up in the lead's Calls &
// Tasks list and in the timeline (and turns red if never completed). Accepts a
// date+time, or a single ISO timestamp (callAt / scheduledAt / preferredTime),
// or a free-text slot. Soft: never breaks lead creation.
function parseCallWhen(b) {
  // Prefer explicit date/time; else an ISO/stamp; else free text.
  let date = String(b.callDate || b.date || '').trim();
  let time = String(b.callTime || b.time || '').trim();
  const stamp = String(b.callAt || b.scheduledAt || b.preferredTime || b.callbackAt || '').trim();
  if ((!date || !time) && stamp) {
    const d = new Date(stamp);
    if (!isNaN(d.getTime())) {
      // Keep it in the stamp's own wall-clock (don't shift by server TZ).
      const iso = d.toISOString();
      date = date || iso.slice(0, 10);
      time = time || iso.slice(11, 16);
    }
  }
  const freeText = String(b.callSlot || b.when || '').trim();
  return { date, time, freeText, hasAny: !!(date || time || stamp || freeText) };
}
function isCallRequested(b) {
  if (b.scheduleCall === true || b.callRequested === true || String(b.callback || '') === 'true') return true;
  return parseCallWhen(b).hasAny;
}
function maybeScheduleCall({ lead, b, timezone }) {
  try {
    const when = parseCallWhen(b);
    const list = Array.isArray(lead.activities) ? lead.activities : [];
    const agenda = String(b.callAgenda || b.message || b.additionalInfo || 'Callback requested via Ranknovo chat').slice(0, 500);
    const act = {
      id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      kind: 'call',
      mode: 'scheduled',
      status: 'open',
      agenda,
      title: agenda || 'Call',
      date: when.date || '',
      time: when.time || '',
      timezone: String(timezone || b.timezone || '').slice(0, 80),
      reminder: (when.date) ? { on: true, at: `${when.date}T${when.time || '09:00'}` } : { on: false },
      // When there's only a free-text slot (e.g. "tomorrow afternoon"), keep it
      // visible on the activity so the agent knows the ask.
      ...(when.freeText && !when.date ? { slotText: when.freeText } : {}),
      createdBy: 'Ranknovo (Novi)',
      createdAt: new Date().toISOString(),
    };
    list.push(act);
    lead.activities = list; lead.changed('activities', true);
    const dueAt = act.date ? `${act.date}T${act.time || '09:00'}` : '';
    pushTimeline(
      lead, 'call',
      `Call scheduled from Ranknovo chat${when.date ? `: ${when.date}${when.time ? ' ' + when.time : ''}` : (when.freeText ? `: ${when.freeText}` : '')}`,
      'Ranknovo (Novi)',
      { activityId: act.id, dueAt, scheduled: true, body: agenda },
    );
    return act;
  } catch (e) {
    console.error('[public-leads] maybeScheduleCall failed:', e.message);
    return null;
  }
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
      return res.status(404).json({ status: 'declined', ok: false, error: 'Not found.' });
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
      return res.status(400).json({ status: 'declined', ok: false, reason: 'missing_contact', message: 'Please share a name, email, or phone so we can follow up.' });
    }

    const wantsCall = type === 'chat' && isCallRequested(b);

    const services = Array.isArray(b.services) ? b.services
      : (b.service ? [String(b.service)] : (b.services ? String(b.services).split(/[;,|]/).map((x) => x.trim()).filter(Boolean) : []));
    const message = String(b.message || b.additionalInfo || '').slice(0, 10000);

    // Owner = the admin (Adam), so every Ranknovo lead lands in one place.
    const admin = await User.findOne({ where: { role: 'admin', active: true }, order: [['id', 'ASC']] });
    if (!admin) return res.status(500).json({ status: 'declined', ok: false, reason: 'no_owner', message: 'Could not record the request right now. Please try again shortly.' });

    // Dedup by website domain — a repeat submission updates the existing lead.
    const existing = website ? await findDuplicateByDomain(website) : null;
    if (existing) {
      if (!existing.email && email) existing.email = email;
      if (!existing.phone && phone) existing.phone = phone;
      if (!existing.mobile && phone) existing.mobile = phone;
      const tags = Array.isArray(existing.tags) ? existing.tags : [];
      if (!tags.includes(meta.tag)) { existing.tags = [...tags, meta.tag]; existing.changed('tags', true); }
      pushTimeline(existing, 'note', `New ${meta.label} from Ranknovo${message ? `: ${message}` : ''}`, 'Ranknovo');
      let reportId = null;
      if (type === 'report') {
        reportId = await maybeQueueReport({ lead: existing, website, admin, businessName: b.businessName, services });
        if (reportId) pushTimeline(existing, 'note', 'Analysis report auto-queued for this website (Ranknovo report request).', 'Ranknovo');
      }
      let callId = null;
      if (wantsCall) { const a = maybeScheduleCall({ lead: existing, b, timezone: b.timezone }); callId = a && a.id; }
      await existing.save();
      return res.json(buildSuccess({ type, leadId: existing.id, reportId, callId, deduped: true }));
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

    let reportId = null;
    let callId = null;
    let dirty = false;
    if (type === 'report') {
      reportId = await maybeQueueReport({ lead, website, admin, businessName: b.businessName, services });
      if (reportId) { pushTimeline(lead, 'note', 'Analysis report auto-queued for this website (Ranknovo report request).', 'Ranknovo'); dirty = true; }
    }
    if (wantsCall) { const a = maybeScheduleCall({ lead, b, timezone: b.timezone }); if (a) { callId = a.id; dirty = true; } }
    if (dirty) await lead.save();

    res.json(buildSuccess({ type, leadId: lead.id, reportId, callId, deduped: false }));
  } catch (e) {
    // Never hard-fail the website's form — log and return a soft decline.
    console.error('[public-leads/ranknovo]', e.message);
    res.status(200).json({ status: 'declined', ok: false, reason: 'server_error', message: 'Could not record the request right now. Please try again shortly.' });
  }
});

// Build the public success response. `status` + `message` are what Novi shows
// the visitor; the ids let the site deep-link or confirm. Message is tailored
// to what actually happened (report queued / call booked / just logged).
function buildSuccess({ type, leadId, reportId, callId, deduped }) {
  let message;
  if (callId && reportId) message = "You're all set — our team will call you at the time you picked, and your analysis report is on its way.";
  else if (callId) message = "Thanks! Your call is booked — our team will reach out at the time you picked.";
  else if (reportId) message = "Thanks! We've received your request and your analysis report is being prepared.";
  else if (type === 'chat') message = "Thanks for reaching out — our team will get back to you shortly.";
  else message = "Thanks! We've received your details and our team will be in touch soon.";
  return { status: 'success', ok: true, type, leadId, reportId: reportId || null, callId: callId || null, deduped: !!deduped, message };
}

module.exports = router;

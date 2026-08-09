const express = require('express');
const router = express.Router();
const { CallLog, Lead, User, Settings, Op } = require('../models');
const { requireAuth } = require('../middleware/auth');

// ---------------------------------------------------------------------------
// CallHippo integration — Phase 1: inbound webhook that logs every call onto the
// matching lead's timeline, crediting the agent by their CallHippo email.
//
// The webhook is public (CallHippo can't authenticate), so it's guarded by a
// secret path token that must equal Settings.callHippoWebhookSecret. The URL to
// paste into CallHippo looks like:
//     https://<host>/api/callhippo/webhook/<secret>
// ---------------------------------------------------------------------------

// Normalise a phone number to its last 10 significant digits, so "+91 97247
// 06XXX", "097247…", and "97247…" all match the same lead regardless of how the
// country code / spacing was stored.
function normNumber(n) {
  const digits = String(n || '').replace(/\D/g, '');
  return digits.slice(-10);
}

// Map CallHippo's status text + callType to our simple direction/status.
function readDirection(body) {
  const t = String(body.callType || body.smsType || '').toLowerCase();
  if (t.includes('incoming')) return 'incoming';
  if (t.includes('outgoing')) return 'outgoing';
  return 'unknown';
}

async function findLeadByNumber(customerNorm) {
  if (!customerNorm) return null;
  // Stored numbers may contain spaces/dashes anywhere (e.g. "+91 97247 06123"),
  // so a digit-substring LIKE against the raw text can miss. We use the last 4
  // digits as a cheap DB prefilter (they're almost always contiguous) to keep
  // the candidate set small, then match precisely on normalised digits in JS.
  const tail4 = customerNorm.slice(-4);
  if (!tail4) return null;
  const leads = await Lead.findAll({
    where: {
      [Op.or]: [
        { phone: { [Op.like]: `%${tail4}%` } },
        { mobile: { [Op.like]: `%${tail4}%` } },
      ],
    },
    limit: 200,
  });
  let match = leads.find((l) => normNumber(l.phone) === customerNorm || normNumber(l.mobile) === customerNorm);
  if (match) return match;
  // Fallback: last 9 digits (handles the odd leading-digit/country-code variance).
  const c9 = customerNorm.slice(-9);
  return leads.find((l) => normNumber(l.phone).slice(-9) === c9 || normNumber(l.mobile).slice(-9) === c9) || null;
}

/**
 * POST /api/callhippo/webhook/:secret — receives call activity from CallHippo.
 * Idempotent on callSid. Always 200s (so CallHippo doesn't retry-storm), but
 * only records when the secret matches.
 */
router.post('/webhook/:secret', express.json({ limit: '256kb' }), async (req, res) => {
  try {
    const settings = await Settings.findOne({ where: { singleton: 'settings' } });
    const secret = settings && settings.getKey ? settings.getKey('callHippoWebhookSecret') : null;
    // Fall back to a plain (non-encrypted) field if that's how it was stored.
    const expected = secret || (settings && settings.callHippoWebhookSecret) || null;
    if (!expected || req.params.secret !== expected) {
      return res.status(200).json({ ok: false }); // don't leak which part failed
    }

    const body = req.body || {};
    // We only handle call activity in phase 1 (SMS intentionally ignored).
    const activity = String(body.type || body.activityType || 'call').toLowerCase();
    if (activity !== 'call') return res.status(200).json({ ok: true, skipped: 'non-call' });

    const direction = readDirection(body);
    // The customer's number is the far end: `to` for outgoing, `from` for incoming.
    const rawCustomer = direction === 'outgoing' ? (body.toNumber || body.to) : (body.fromNumber || body.from);
    const customerNorm = normNumber(rawCustomer);
    const agentEmail = String(body.email || body.agentEmail || '').toLowerCase() || null;

    // Resolve the lead + agent.
    const lead = await findLeadByNumber(customerNorm);
    let agent = null;
    if (agentEmail) {
      agent = await User.findOne({ where: { [Op.or]: [{ email: agentEmail }, { callHippoEmail: agentEmail }] } });
    }

    const callSid = body.callSid || null;
    const durationSeconds = Number(body.durationSeconds || body.totalCallDuration || 0) || 0;
    const startTime = body.startTime || body.time || body.dateTime || null;
    const recordingUrl = body.recordingUrl || null;
    const status = body.status || '';

    // Idempotent upsert by callSid (fall back to a synthetic key when absent).
    let logRow = null;
    if (callSid) logRow = await CallLog.findOne({ where: { callSid } });
    const payload = {
      callSid, direction, status,
      fromNumber: body.fromNumber || body.from || null,
      toNumber: body.toNumber || body.to || null,
      customerNumber: rawCustomer || null,
      agentEmail, agentId: agent ? agent.id : null,
      leadId: lead ? lead.id : null,
      durationSeconds,
      startTime: startTime ? new Date(startTime) : null,
      recordingUrl, countryName: body.countryName || null,
      raw: body,
    };
    if (logRow) { await logRow.update(payload); }
    else { logRow = await CallLog.create(payload); }

    // Write / refresh a timeline entry on the lead (idempotent by callSid).
    if (lead) {
      const timeline = Array.isArray(lead.timeline) ? lead.timeline : [];
      const mins = Math.floor(durationSeconds / 60);
      const secs = durationSeconds % 60;
      const durText = durationSeconds > 0 ? `${mins}m ${secs}s` : null;
      const who = agent ? agent.name : (body.callerName || 'Someone');
      const dirText = direction === 'incoming' ? 'Incoming call from' : 'Call to';
      const label = direction === 'incoming'
        ? `📞 ${dirText} lead${status ? ` — ${status}` : ''}${durText ? ` (${durText})` : ''}`
        : `📞 ${who} called lead${status ? ` — ${status}` : ''}${durText ? ` (${durText})` : ''}`;

      const entry = {
        type: 'call',
        source: 'callhippo',
        callSid,
        direction,
        text: label,
        recordingUrl: recordingUrl || undefined,
        author: agent ? agent.name : (agentEmail || 'CallHippo'),
        time: startTime ? new Date(startTime).toISOString() : new Date().toISOString(),
      };
      // Replace any existing entry for this callSid (status can change across
      // events), else append.
      const idx = callSid ? timeline.findIndex((e) => e.source === 'callhippo' && e.callSid === callSid) : -1;
      if (idx >= 0) timeline[idx] = entry; else timeline.push(entry);
      lead.timeline = timeline;
      lead.changed('timeline', true);
      // Bump last activity so the leads list reflects the call.
      if (lead.lastActivityAt !== undefined) lead.lastActivityAt = new Date();
      await lead.save();
    }

    res.status(200).json({ ok: true, matchedLead: !!lead, matchedAgent: !!agent });
  } catch (e) {
    // Never fail the webhook hard — log and 200 so CallHippo doesn't retry-storm.
    console.error('[callhippo webhook]', e.message);
    res.status(200).json({ ok: false });
  }
});

/** GET /api/callhippo/logs?leadId= — recent call logs (admin/manager view). */
router.get('/logs', requireAuth, async (req, res, next) => {
  try {
    const where = {};
    if (req.query.leadId) where.leadId = Number(req.query.leadId);
    const logs = await CallLog.findAll({ where, order: [['createdAt', 'DESC']], limit: 200 });
    res.json(logs);
  } catch (e) { next(e); }
});

module.exports = router;

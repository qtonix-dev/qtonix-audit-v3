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

    // If this is a completed call credited to an agent on a known lead, flag it
    // so the agent gets prompted to add a remark (unless one already exists).
    const isCompleted = /complete|answered|success/i.test(String(status));
    if (isCompleted && agent && lead && !logRow.remark) {
      await logRow.update({ needsRemark: true });
    }

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

/**
 * GET /api/callhippo/numbers — the "from" numbers an agent can call out on.
 * Merges numbers fetched live from CallHippo (using the stored API token) with
 * any numbers added manually in CRM Fields. Live fetch is best-effort; the
 * manual list always works even if the API call fails or the token is unset.
 */
router.get('/numbers', requireAuth, async (req, res, next) => {
  try {
    const settings = await Settings.findOne({ where: { singleton: 'settings' } });
    const token = settings && settings.getKey ? settings.getKey('callHippoToken') : null;
    const rawManual = (settings && settings.crmConfig && settings.crmConfig.callHippoNumbers) || [];
    const manual = rawManual
      .map((n) => ({ label: n.label || n.country || n.value || '', number: n.value || n.number || '', source: 'manual' }))
      .filter((n) => n.number);

    let live = [];
    let liveError = null;
    if (token) {
      // Try the documented number-list endpoints; shapes vary, so dig defensively.
      const endpoints = ['https://web.callhippo.com/v1/number/list', 'https://web.callhippo.com/v1/numbers', 'https://web.callhippo.com/v1/user/numbers'];
      for (const url of endpoints) {
        try {
          const r = await fetch(url, { headers: { apitoken: token, accept: 'application/json' } });
          if (!r.ok) { liveError = `HTTP ${r.status}`; continue; }
          const data = await r.json();
          const arr = Array.isArray(data) ? data : (data.data || data.numbers || data.result || []);
          if (Array.isArray(arr) && arr.length) {
            live = arr.map((x) => ({
              label: x.name || x.label || x.numberName || x.country || x.friendlyName || x.number || x.phoneNumber || '',
              number: x.number || x.phoneNumber || x.phone || x.did || '',
              source: 'callhippo',
            })).filter((n) => n.number);
            liveError = null;
            break;
          }
        } catch (e) { liveError = e.message; }
      }
    }

    // Merge, de-duplicating by number (live wins on label).
    const byNumber = {};
    for (const n of [...manual, ...live]) {
      const key = String(n.number).replace(/\D/g, '');
      byNumber[key] = { ...(byNumber[key] || {}), ...n, number: n.number };
    }
    res.json({ numbers: Object.values(byNumber), liveError, hasToken: !!token, savedManualCount: rawManual.length, manualWithNumber: manual.length });
  } catch (e) { next(e); }
});

/**
 * POST /api/callhippo/import-contacts — push CRM leads to CallHippo as contacts
 * so inbound calls show the lead's name in the agent's dialer. Best-effort:
 * tries the documented contact endpoint; reports how many succeeded/failed.
 * Body: { leadIds?:[] } — omit to import all leads with a phone number.
 */
router.post('/import-contacts', requireAuth, async (req, res, next) => {
  try {
    const settings = await Settings.findOne({ where: { singleton: 'settings' } });
    const token = settings && settings.getKey ? settings.getKey('callHippoToken') : null;
    if (!token) return res.status(400).json({ error: 'No CallHippo API token configured.' });

    const { leadIds } = req.body || {};
    const where = {};
    if (Array.isArray(leadIds) && leadIds.length) where.id = { [Op.in]: leadIds };
    const leads = await Lead.findAll({ where, limit: 2000 });
    const withNumber = leads.filter((l) => l.phone || l.mobile);
    if (withNumber.length === 0) return res.json({ ok: true, imported: 0, failed: 0, total: 0, note: 'No leads with a phone number.' });

    const endpoints = ['https://web.callhippo.com/v1/contact/add', 'https://web.callhippo.com/v1/contact/create', 'https://web.callhippo.com/v1/contacts'];
    let imported = 0, failed = 0, lastErr = null;
    for (const lead of withNumber) {
      const name = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || lead.website || 'Lead';
      const number = String(lead.mobile || lead.phone).replace(/[^\d+]/g, '');
      const payload = { name, firstName: lead.firstName || name, lastName: lead.lastName || '', number, phoneNumber: number, email: lead.email || undefined, company: lead.website || undefined };
      let done = false;
      for (const url of endpoints) {
        try {
          const r = await fetch(url, { method: 'POST', headers: { apitoken: token, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(payload) });
          if (r.ok) { done = true; break; }
          lastErr = `HTTP ${r.status}`;
        } catch (e) { lastErr = e.message; }
      }
      if (done) imported++; else failed++;
    }
    res.json({ ok: imported > 0, imported, failed, total: withNumber.length, error: imported === 0 ? (lastErr || 'Contact import not available on this account.') : undefined });
  } catch (e) { next(e); }
});

/**
 * POST /api/callhippo/call — Option B (server-initiated dial) when CallHippo has
 * enabled the telephony API for the account. Attempts the documented call
 * endpoint(s); returns { ok, callId } on success or { ok:false, needsExtension }
 * so the client can fall back to the Chrome-extension path (Option A).
 */
router.post('/call', requireAuth, async (req, res, next) => {
  try {
    const { toNumber, fromNumber } = req.body || {};
    if (!toNumber) return res.status(400).json({ error: 'toNumber is required.' });
    const settings = await Settings.findOne({ where: { singleton: 'settings' } });
    const token = settings && settings.getKey ? settings.getKey('callHippoToken') : null;
    if (!token) return res.json({ ok: false, needsExtension: true, reason: 'No API token configured.' });

    // Include the agent's CallHippo email so CallHippo rings the right agent.
    const me = await User.findByPk(req.user.id);
    const agentEmail = (me && (me.callHippoEmail || me.email)) || undefined;

    const endpoints = ['https://web.callhippo.com/v1/call', 'https://web.callhippo.com/v1/call/create', 'https://web.callhippo.com/v1/dialer/call'];
    const payload = { to: toNumber, toNumber, from: fromNumber || undefined, fromNumber: fromNumber || undefined, email: agentEmail };
    let lastErr = null;
    for (const url of endpoints) {
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { apitoken: token, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(payload),
        });
        const txt = await r.text();
        if (r.ok) {
          let data = {}; try { data = JSON.parse(txt); } catch { /* non-JSON ok */ }
          return res.json({ ok: true, callId: data.callSid || data.callId || data.id || null, raw: data });
        }
        lastErr = `HTTP ${r.status}`;
        // 404/501 → this endpoint isn't enabled; try the next.
      } catch (e) { lastErr = e.message; }
    }
    // Server dial not available on this account → tell client to use extension.
    res.json({ ok: false, needsExtension: true, reason: lastErr || 'Telephony API not enabled.' });
  } catch (e) { next(e); }
});

/**
 * GET /api/callhippo/pending-remarks — completed calls credited to the current
 * agent that still need a remark. The client polls this and pops a remark form.
 */
router.get('/pending-remarks', requireAuth, async (req, res, next) => {
  try {
    const rows = await CallLog.findAll({
      where: { agentId: req.user.id, needsRemark: true },
      order: [['createdAt', 'DESC']], limit: 5,
    });
    const out = [];
    for (const r of rows) {
      let leadName = '';
      if (r.leadId) { const l = await Lead.findByPk(r.leadId); leadName = l ? (`${l.firstName || ''} ${l.lastName || ''}`.trim() || l.website || '') : ''; }
      out.push({ id: r.id, leadId: r.leadId, leadName, direction: r.direction, customerNumber: r.customerNumber, durationSeconds: r.durationSeconds, recordingUrl: r.recordingUrl, at: r.startTime || r.createdAt });
    }
    res.json(out);
  } catch (e) { next(e); }
});

/**
 * POST /api/callhippo/logs/:id/remark — the agent submits a remark for a
 * completed call. Saves it on the call log, appends a note to the lead timeline,
 * and adds a "Call Completed" activity (kind:call, mode:done) on the lead.
 */
router.post('/logs/:id/remark', requireAuth, async (req, res, next) => {
  try {
    const log = await CallLog.findByPk(req.params.id);
    if (!log) return res.status(404).json({ error: 'Call not found.' });
    if (log.agentId && log.agentId !== req.user.id && !['admin', 'manager'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Not your call.' });
    }
    const remark = String((req.body && req.body.remark) || '').trim();
    await log.update({ remark, needsRemark: false });

    if (log.leadId) {
      const lead = await Lead.findByPk(log.leadId);
      if (lead) {
        const me = await User.findByPk(req.user.id);
        const mins = Math.floor((log.durationSeconds || 0) / 60);
        const secs = (log.durationSeconds || 0) % 60;
        const durText = log.durationSeconds > 0 ? `${mins}m ${secs}s` : '';

        // Timeline note with the remark.
        const timeline = Array.isArray(lead.timeline) ? lead.timeline : [];
        timeline.push({
          type: 'call', source: 'callhippo-remark',
          text: `Call completed${durText ? ` (${durText})` : ''}${remark ? ` — ${remark}` : ''}`,
          author: me ? me.name : 'Agent', time: new Date().toISOString(),
        });
        lead.timeline = timeline; lead.changed('timeline', true);

        // "Call Completed" activity (done call).
        const activities = Array.isArray(lead.activities) ? lead.activities : [];
        activities.push({
          id: `call_${log.id}_${Date.now()}`,
          kind: 'call', mode: 'done', status: 'done',
          agenda: remark || 'Call completed',
          title: 'Call Completed',
          durationMin: Math.round((log.durationSeconds || 0) / 60),
          date: new Date().toISOString().slice(0, 10),
          time: new Date().toTimeString().slice(0, 5),
          source: 'callhippo',
        });
        lead.activities = activities; lead.changed('activities', true);
        if (lead.lastActivityAt !== undefined) lead.lastActivityAt = new Date();
        await lead.save();
      }
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;

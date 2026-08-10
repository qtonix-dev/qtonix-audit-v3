const express = require('express');
const router = express.Router();
const { CallLog, Lead, User, Settings, Op } = require('../models');
const { requireAuth } = require('../middleware/auth');

// CallHippo's API expects the header `apiToken` (capital T). Some endpoints also
// accept an `authToken` (a per-session JWT). We send both when available. We
// also send a couple of header-case variants to be tolerant of their gateway.
function chHeaders(token, authToken, json) {
  const h = { accept: 'application/json', apiToken: token, apitoken: token };
  if (authToken) { h.authToken = authToken; h.authtoken = authToken; }
  if (json) h['content-type'] = 'application/json';
  return h;
}

// Fetch the CallHippo user list (each user has _id, email, extensionNumber, and
// a `numbers` array of their assigned DIDs with country labels). Returns [] on
// failure. Used for the from-number picker and the user-sync action.
async function fetchCallHippoUsers(token, authToken) {
  try {
    const r = await fetch('https://web.callhippo.com/v1/user/list', { headers: chHeaders(token, authToken) });
    if (!r.ok) return { users: [], error: `HTTP ${r.status}` };
    const data = await r.json().catch(() => ({}));
    const arr = Array.isArray(data) ? data : (data.data || []);
    return { users: Array.isArray(arr) ? arr : [], error: (data && data.success === false) ? 'auth' : null };
  } catch (e) { return { users: [], error: e.message }; }
}

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
  // so a digit-substring LIKE against the raw text can miss when the tail digits
  // are split by a space. We build several LIKE fragments (last 4, and the last
  // 4 with a space between the split points) as a prefilter, then match precisely
  // on normalised digits in JS. If the prefilter finds nothing we fall back to a
  // bounded full scan, which is fine for typical CRM sizes.
  const tail4 = customerNorm.slice(-4);
  const likeFrags = new Set([tail4, customerNorm.slice(-3), customerNorm.slice(-2)]);
  const or = [];
  for (const f of likeFrags) {
    if (!f) continue;
    or.push({ phone: { [Op.like]: `%${f}%` } });
    or.push({ mobile: { [Op.like]: `%${f}%` } });
  }
  let leads = or.length ? await Lead.findAll({ where: { [Op.or]: or }, limit: 400 }) : [];
  const precise = (l) => normNumber(l.phone) === customerNorm || normNumber(l.mobile) === customerNorm;
  let match = leads.find(precise);
  if (match) return match;
  // Broaden: bounded full scan over leads that have any number (handles awkward
  // spacing the LIKE prefilter can't express).
  if (leads.length < 400) {
    const all = await Lead.findAll({ where: { [Op.or]: [{ phone: { [Op.ne]: '' } }, { mobile: { [Op.ne]: '' } }] }, limit: 2000, attributes: ['id', 'phone', 'mobile'] });
    match = all.find(precise);
    if (match) return await Lead.findByPk(match.id);
    // Last resort: last-9 digit compare (country-code variance).
    const c9 = customerNorm.slice(-9);
    const m9 = all.find((l) => normNumber(l.phone).slice(-9) === c9 || normNumber(l.mobile).slice(-9) === c9);
    if (m9) return await Lead.findByPk(m9.id);
  }
  return null;
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

    // Log every webhook to the audit trail so we can SEE exactly what CallHippo
    // sends (status wording, field names, whether agent/lead matched). This makes
    // "nothing happened" diagnosable from the Log page instead of invisible.
    try {
      const { AuditLog } = require('../models');
      if (AuditLog) await AuditLog.create({
        userId: agent ? agent.id : null, userName: agent ? agent.name : (agentEmail || 'CallHippo'),
        action: 'callhippo.webhook', target: `${direction} ${status || ''}`.trim(),
        userEmail: agentEmail || null, severity: 'info',
        ip: `lead:${lead ? lead.id : 'none'} agent:${agent ? 'yes' : 'no'} dur:${durationSeconds}s sid:${callSid || 'none'}`,
      });
    } catch { /* audit is best-effort */ }

    // Flag for a remark on a COMPLETED call that we matched to a lead. We relax
    // the earlier rule (which also required an agent match) so a missed agent
    // mapping no longer silently swallows the prompt — if we know the agent we
    // target them, otherwise the prompt still exists on the call log. We also
    // broaden the "completed" wording and treat any call with real talk-time as
    // completed, since CallHippo's status text varies.
    const statusStr = String(status).toLowerCase();
    const isCompleted = /complete|answered|success|connected|call ?ended|finished/.test(statusStr) || durationSeconds > 0;
    if (isCompleted && lead && !logRow.remark) {
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
    const authToken = settings && settings.getKey ? settings.getKey('callHippoAuthToken') : null;
    const rawManual = (settings && settings.crmConfig && settings.crmConfig.callHippoNumbers) || [];
    const manual = rawManual
      .map((n) => ({ label: n.label || n.country || n.value || '', number: n.value || n.number || '', source: 'manual' }))
      .filter((n) => n.number);

    let live = [];
    let liveError = null;
    if (token) {
      // Pull the CallHippo user list and pick the numbers belonging to THIS agent
      // (matched by their CallHippo email / stored agentId). Falls back to all
      // users' numbers if we can't identify the agent.
      const me = await User.findByPk(req.user.id);
      const myEmail = String((me && (me.callHippoEmail || me.email)) || '').toLowerCase();
      const myAgentId = me && me.callHippoAgentId;
      const { users, error } = await fetchCallHippoUsers(token, authToken);
      liveError = error;
      if (users.length) {
        const mine = users.find((u) => String(u._id) === String(myAgentId))
          || users.find((u) => String(u.email || '').toLowerCase() === myEmail);
        const pool = mine ? [mine] : users; // agent's own numbers, else everyone's
        const seen = new Set();
        for (const u of pool) {
          for (const n of (u.numbers || [])) {
            const num = n.phoneNumber || n.number || '';
            if (!num || seen.has(num)) continue;
            seen.add(num);
            live.push({ label: n.country || n.contactName || 'CallHippo', number: num, source: 'callhippo' });
          }
        }
        if (!mine && myEmail) liveError = 'agent-not-found'; // couldn't match this agent; showing all numbers
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
    const authToken = settings && settings.getKey ? settings.getKey('callHippoAuthToken') : null;
    if (!token) return res.status(400).json({ error: 'No CallHippo API token configured.' });

    const { leadIds } = req.body || {};
    const where = {};
    if (Array.isArray(leadIds) && leadIds.length) where.id = { [Op.in]: leadIds };
    const leads = await Lead.findAll({ where, limit: 2000 });
    const withNumber = leads.filter((l) => l.phone || l.mobile);
    if (withNumber.length === 0) return res.json({ ok: true, imported: 0, failed: 0, total: 0, note: 'No leads with a phone number.' });

    // The documented, working endpoint + payload shape (per CallHippo API docs):
    //   POST /v1/contact/add  { number, firstName, lastName, email }
    const url = 'https://web.callhippo.com/v1/contact/add';
    let imported = 0, failed = 0, lastErr = null;
    for (const lead of withNumber) {
      const number = String(lead.mobile || lead.phone).replace(/[^\d+]/g, '');
      const firstName = lead.firstName || (lead.website || 'Lead');
      const payload = { number, firstName, lastName: lead.lastName || '', email: lead.email || '' };
      try {
        const r = await fetch(url, { method: 'POST', headers: chHeaders(token, authToken, true), body: JSON.stringify(payload) });
        const data = await r.json().catch(() => ({}));
        if (r.ok && data && data.success !== false) imported++;
        else { failed++; lastErr = (data && data.error && data.error.message) || `HTTP ${r.status}`; }
      } catch (e) { failed++; lastErr = e.message; }
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
    const authToken = settings && settings.getKey ? settings.getKey('callHippoAuthToken') : null;
    if (!token) return res.json({ ok: false, needsExtension: true, reason: 'No API token configured.' });

    const me = await User.findByPk(req.user.id);
    // CallHippo's /v1/call takes { toNumber, fromNumber, agentId }. We store the
    // agent's CallHippo email; the numeric agentId (if the admin saved it) rings
    // that specific agent. Fall back to email if no agentId is set.
    const agentEmail = (me && (me.callHippoEmail || me.email)) || undefined;
    const agentId = me && me.callHippoAgentId ? me.callHippoAgentId : undefined;

    const payload = { toNumber, fromNumber: fromNumber || undefined, agentId, email: agentEmail };
    try {
      const r = await fetch('https://web.callhippo.com/v1/call', {
        method: 'POST', headers: chHeaders(token, authToken, true), body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data && data.success !== false) {
        return res.json({ ok: true, callId: (data.data && (data.data.callSid || data.data._id)) || data.callId || null, raw: data });
      }
      // CallHippo reached but refused (e.g. "agent unavailable"): surface the
      // real message so the agent knows to be logged into CallHippo/online.
      const reason = (data && data.error && data.error.message) || `HTTP ${r.status}`;
      return res.json({ ok: false, needsExtension: true, reason });
    } catch (e) {
      return res.json({ ok: false, needsExtension: true, reason: e.message });
    }
  } catch (e) { next(e); }
});

/**
 * GET /api/callhippo/pending-remarks — completed calls credited to the current
 * agent that still need a remark. The client polls this and pops a remark form.
 */
router.get('/pending-remarks', requireAuth, async (req, res, next) => {
  try {
    // Calls needing a remark that are either credited to this agent, or sit on a
    // lead this agent owns (covers the case where the agent email didn't map).
    const ownLeads = await Lead.findAll({ where: { ownerId: req.user.id }, attributes: ['id'] });
    const ownLeadIds = ownLeads.map((l) => l.id);
    const rows = await CallLog.findAll({
      where: {
        needsRemark: true,
        [Op.or]: [
          { agentId: req.user.id },
          ...(ownLeadIds.length ? [{ agentId: null, leadId: { [Op.in]: ownLeadIds } }] : []),
        ],
      },
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

/**
 * POST /api/callhippo/sync-users — pull CallHippo's user list and auto-map each
 * to a QHub user by email, storing their CallHippo _id (agentId), extension, and
 * callHippoEmail. Admin only. Makes dialing + call-crediting reliable without
 * hand-entering CallHippo emails per user.
 */
router.post('/sync-users', requireAuth, async (req, res, next) => {
  try {
    if (!['admin', 'manager'].includes(req.user.role)) return res.status(403).json({ error: 'Admins only.' });
    const settings = await Settings.findOne({ where: { singleton: 'settings' } });
    const token = settings && settings.getKey ? settings.getKey('callHippoToken') : null;
    const authToken = settings && settings.getKey ? settings.getKey('callHippoAuthToken') : null;
    if (!token) return res.status(400).json({ error: 'No CallHippo API token configured.' });

    const { users, error } = await fetchCallHippoUsers(token, authToken);
    if (!users.length) return res.status(400).json({ error: error === 'auth' ? 'CallHippo rejected the token (check API token / auth token).' : (error || 'No users returned from CallHippo.') });

    let matched = 0; const unmatched = [];
    for (const chu of users) {
      const email = String(chu.email || '').toLowerCase();
      if (!email) continue;
      // Match a QHub user by primary email or existing callHippoEmail.
      const u = await User.findOne({ where: { [Op.or]: [{ email }, { callHippoEmail: email }] } });
      if (u) {
        u.callHippoEmail = email;
        u.callHippoAgentId = String(chu._id || '') || u.callHippoAgentId;
        u.callHippoExtension = chu.extensionNumber != null ? String(chu.extensionNumber) : u.callHippoExtension;
        await u.save();
        matched++;
      } else {
        unmatched.push({ name: chu.fullName || `${chu.firstName || ''} ${chu.lastName || ''}`.trim(), email });
      }
    }
    res.json({ ok: true, total: users.length, matched, unmatched });
  } catch (e) { next(e); }
});

// Poll CallHippo's activity feed for recently completed calls and record them
// (timeline + remark flag), as a robust alternative to the webhook. Deduped by
// callSid against existing CallLog rows. Runs from a timer (see startPolling)
// and can be triggered on-demand for testing.
async function pollActivityFeed() {
  try {
    const settings = await Settings.findOne({ where: { singleton: 'settings' } });
    if (!settings) return { skipped: 'no-settings' };
    const token = settings.getKey ? settings.getKey('callHippoToken') : null;
    const authToken = settings.getKey ? settings.getKey('callHippoAuthToken') : null;
    if (!token) return { skipped: 'no-token' };

    const fmt = (d) => `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    const now = new Date();
    const start = new Date(now.getTime() - 24 * 60 * 60 * 1000); // last 24h window
    const bodyReq = { skip: '0', limit: '50', startDate: fmt(start), endDate: fmt(new Date(now.getTime() + 24 * 60 * 60 * 1000)), crmUniqueId: '', callSid: '' };
    const r = await fetch('https://web.callhippo.com/v1/activityfeed', { method: 'POST', headers: chHeaders(token, authToken, true), body: JSON.stringify(bodyReq) });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    const data = await r.json().catch(() => ({}));
    const logs = (data && data.data && (data.data.callLogs || data.data.logs)) || [];
    if (!Array.isArray(logs) || !logs.length) return { processed: 0 };

    let processed = 0;
    for (const cl of logs) {
      const callSid = cl.callSid || cl.callId || cl._id || null;
      if (!callSid) continue;
      const existing = await CallLog.findOne({ where: { callSid } });
      if (existing) continue; // already recorded (webhook or prior poll)
      await recordCallFromFeed(cl);
      processed++;
    }
    return { processed };
  } catch (e) { return { error: e.message }; }
}

// Turn one activity-feed entry into a CallLog + timeline entry + remark flag,
// reusing the same matching logic as the webhook.
async function recordCallFromFeed(cl) {
  const dirRaw = String(cl.callType || cl.direction || '').toLowerCase();
  const direction = dirRaw.includes('out') ? 'outgoing' : (dirRaw.includes('in') ? 'incoming' : 'outgoing');
  const rawCustomer = direction === 'outgoing' ? (cl.to || cl.toNumber || cl.destination) : (cl.from || cl.fromNumber || cl.callerId);
  const customerNorm = normNumber(rawCustomer);
  const agentEmail = String(cl.agentEmail || cl.email || (cl.agent && cl.agent.email) || '').toLowerCase() || null;
  const lead = await findLeadByNumber(customerNorm);
  let agent = null;
  if (agentEmail) agent = await User.findOne({ where: { [Op.or]: [{ email: agentEmail }, { callHippoEmail: agentEmail }] } });
  const durationSeconds = Number(cl.duration || cl.callDuration || cl.totalCallDuration || 0) || 0;
  const status = cl.status || cl.callStatus || '';

  const logRow = await CallLog.create({
    callSid: cl.callSid || cl.callId || cl._id, direction, status,
    fromNumber: cl.from || cl.fromNumber || null, toNumber: cl.to || cl.toNumber || null,
    customerNumber: rawCustomer || null, agentEmail, agentId: agent ? agent.id : null,
    leadId: lead ? lead.id : null, durationSeconds,
    startTime: cl.startTime || cl.callTime || cl.date ? new Date(cl.startTime || cl.callTime || cl.date) : new Date(),
    recordingUrl: cl.recordingUrl || cl.recording || null, countryName: cl.country || null, raw: cl,
  });

  const statusStr = String(status).toLowerCase();
  const isCompleted = /complete|answered|success|connected|ended|finished/.test(statusStr) || durationSeconds > 0;
  if (isCompleted && lead) await logRow.update({ needsRemark: true });

  if (lead) {
    const timeline = Array.isArray(lead.timeline) ? lead.timeline : [];
    const mins = Math.floor(durationSeconds / 60); const secs = durationSeconds % 60;
    const durText = durationSeconds > 0 ? `${mins}m ${secs}s` : null;
    const who = agent ? agent.name : 'Someone';
    const label = direction === 'incoming'
      ? `📞 Incoming call from lead${status ? ` — ${status}` : ''}${durText ? ` (${durText})` : ''}`
      : `📞 ${who} called lead${status ? ` — ${status}` : ''}${durText ? ` (${durText})` : ''}`;
    const idx = timeline.findIndex((e) => e.source === 'callhippo' && e.callSid === logRow.callSid);
    const entry = { type: 'call', source: 'callhippo', callSid: logRow.callSid, direction, text: label, recordingUrl: logRow.recordingUrl || undefined, author: agent ? agent.name : (agentEmail || 'CallHippo'), time: logRow.startTime.toISOString() };
    if (idx >= 0) timeline[idx] = entry; else timeline.push(entry);
    lead.timeline = timeline; lead.changed('timeline', true);
    if (lead.lastActivityAt !== undefined) lead.lastActivityAt = new Date();
    await lead.save();
  }
}

/** POST /api/callhippo/poll-now — admin: trigger an activity-feed poll on demand
 *  (for testing). Returns how many new calls were recorded. */
router.post('/poll-now', requireAuth, async (req, res, next) => {
  try {
    if (!['admin', 'manager'].includes(req.user.role)) return res.status(403).json({ error: 'Admins only.' });
    const result = await pollActivityFeed();
    res.json(result);
  } catch (e) { next(e); }
});

// Background poller: every 2 minutes, pull the activity feed so completed calls
// are recorded even if the webhook never arrives.
let _pollTimer = null;
function startPolling() {
  if (_pollTimer) return;
  _pollTimer = setInterval(() => { pollActivityFeed().catch(() => {}); }, 2 * 60 * 1000);
}
startPolling();

module.exports = router;

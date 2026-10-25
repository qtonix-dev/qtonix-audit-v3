// ---------------------------------------------------------------------------
// Data Cleanup routes (admin only; mounted under /api/data-cleanup).
//
//   POST /check         upload ONE OR MANY WHOIS .xlsx/.csv files → validate
//                       every row's phone across all files, combine into one
//                       table, flag duplicates across the whole set, reconcile
//                       against the PhoneCheck cache (numbers seen before), and
//                       return the rows + per-row flags + a summary. PERSISTS
//                       each new number's rule verdict to the cache.
//   POST /export/xlsx   given the checked rows, return a cleaned .xlsx with the
//                       flagged rows removed (one combined file). Adds a
//                       "Removed" sheet listing what was dropped and why.
//
// COST CONTROL: the paid line-type/live-status API (added later, behind a
// toggle) is only ever called for numbers that (1) passed the free rules and
// (2) are NOT already in the PhoneCheck cache. The cache means a number is
// checked by the API at most once, ever — repeat uploads reuse the stored
// verdict and spend zero credits. Duplicates within/across the upload are
// collapsed before any API call too.
//
// Phone validation rules live in services/dataCleanup.js (NANP / toll-free /
// length / country / fake). Duplicate detection is cross-row and lives here.
// ---------------------------------------------------------------------------
const express = require('express');
const router = express.Router();
const { validatePhone, REASON_LABELS, pickColumnsFull, softSignals, HARD_REASONS } = require('../services/dataCleanup');
const { PhoneCheck, Op, Settings } = require('../models');
const numverify = require('../services/numverify');

const b64ToBuffer = (s) => Buffer.from(String(s || '').replace(/^data:[^;]+;base64,/, ''), 'base64');

// Read an uploaded workbook (xlsx or csv) into { headers:[...], rows:[[...]] }.
function readSheet(base64) {
  const XLSX = require('xlsx');
  const buf = b64ToBuffer(base64);
  // cellDates:true + raw:false keep dates as readable strings, not Excel serials.
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '', raw: false, dateNF: 'yyyy-mm-dd' });
  if (!aoa.length) return { headers: [], rows: [] };
  const headers = (aoa[0] || []).map((h) => String(h == null ? '' : h));
  const rows = aoa.slice(1).map((r) => headers.map((_, i) => (r[i] == null ? '' : r[i])));
  return { headers, rows };
}

// --- Validate uploaded sheet(s) (does NOT persist) --------------------------
// Body: { files:[{ name, base64 }] }  (legacy single { base64, fileName } still
// accepted). Combines all files; uses the FIRST file's header as the canonical
// column order; flags cross-file duplicate phone numbers.
router.post('/check', async (req, res, next) => {
  try {
    let files = Array.isArray(req.body && req.body.files) ? req.body.files : null;
    if (!files && req.body && req.body.base64) files = [{ name: req.body.fileName || 'data.xlsx', base64: req.body.base64 }];
    files = (files || []).filter((f) => f && f.base64);
    if (!files.length) return res.status(400).json({ error: 'No files provided.' });

    // Which soft signals should HARD-exclude (vs just flag)? Sent by the client.
    const softExclude = new Set(Array.isArray(req.body && req.body.softExclude) ? req.body.softExclude : []);

    let headers = null; let phoneCol = -1; let countryCol = -1; let nameCol = -1; let stateCol = -1; let emailCol = -1;
    const combined = []; // { cells, srcFile }
    const perFile = [];

    for (const f of files) {
      const { headers: h, rows } = readSheet(f.base64);
      if (!h.length) { perFile.push({ name: f.name, rows: 0, error: 'empty' }); continue; }
      const col = pickColumnsFull(h);
      if (col.phone < 0) { perFile.push({ name: f.name, rows: 0, error: 'no phone column' }); continue; }
      // Use the first valid file's header as canonical. Later files are mapped
      // onto it by matching header names (tolerant), so mixed exports still line up.
      if (!headers) { headers = h; phoneCol = col.phone; countryCol = col.country; nameCol = col.name; stateCol = col.state; emailCol = col.email; }
      const norm = (x) => String(x || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const canonNorm = headers.map(norm);
      const map = h.map((hh) => canonNorm.indexOf(norm(hh))); // thisFileCol -> canonicalCol
      for (const r of rows) {
        const cells = headers.map(() => '');
        r.forEach((val, i) => { const dest = map[i]; if (dest >= 0) cells[dest] = val; });
        combined.push({ cells, srcFile: f.name });
      }
      perFile.push({ name: f.name, rows: rows.length, error: null });
    }

    if (!headers) return res.status(400).json({ error: 'Could not find a phone column in any file (expected "registrant_phone" or a column containing "phone").' });

    const summary = { total: 0, valid: 0, flagged: 0, toll_free: 0, short_9_digit: 0, wrong_length: 0, not_us_canada: 0, fake: 0, duplicate: 0, seen_before: 0, area_state_mismatch: 0, fake_name: 0, disposable_email: 0, api_cached: 0, api_to_check: 0, files: files.length };
    const seenInBatch = new Map(); // normalized -> first row index kept in THIS upload

    // First pass: rules + soft signals + in-batch dedupe. Reasons are split into
    // `reasons` (hard — exclude by default) and `softReasons` (advisory — only
    // exclude when the admin turns that signal on via softExclude).
    const out = combined.map((rec, i) => {
      const phone = rec.cells[phoneCol];
      const country = countryCol >= 0 ? rec.cells[countryCol] : '';
      const v = validatePhone(phone, country);
      const reasons = [...v.reasons];
      if (v.normalized) {
        if (seenInBatch.has(v.normalized)) reasons.push('duplicate');
        else seenInBatch.set(v.normalized, i);
      }
      // Signals from the extra columns. fake_name and disposable_email are
      // ALWAYS hard exclusions (junk registrant → junk phone). area_state_mismatch
      // is advisory: it only excludes when the admin turns it on via softExclude.
      const soft = softSignals({
        normalized: v.normalized,
        state: stateCol >= 0 ? rec.cells[stateCol] : '',
        name: nameCol >= 0 ? rec.cells[nameCol] : '',
        email: emailCol >= 0 ? rec.cells[emailCol] : '',
      });
      const ALWAYS_HARD = new Set(['fake_name', 'disposable_email']);
      soft.forEach((sr) => {
        if (ALWAYS_HARD.has(sr) || softExclude.has(sr)) reasons.push(sr);
      });
      const softReasons = soft.filter((sr) => !reasons.includes(sr));
      return {
        index: i, cells: rec.cells, srcFile: rec.srcFile,
        phone: String(phone == null ? '' : phone), country: String(country == null ? '' : country),
        reasons, softReasons, normalized: v.normalized,
        seenBefore: false, apiChecked: false, lineType: null, carrier: null, liveStatus: null,
      };
    });

    // Second pass: reconcile the unique valid numbers against the cache. This is
    // where cross-upload dedupe and "don't re-spend API credits" happen.
    const uniqueNormals = [...new Set(out.filter((r) => r.normalized).map((r) => r.normalized))];
    const cacheByPhone = new Map();
    try {
      if (uniqueNormals.length) {
        const found = await PhoneCheck.findAll({ where: { phone: { [Op.in]: uniqueNormals } } });
        found.forEach((pc) => cacheByPhone.set(pc.phone, pc));
      }
    } catch (e) { /* cache is best-effort; a DB hiccup must not break the check */ }

    // A stable id for THIS upload (sent by the client). Re-running the same
    // upload to toggle a filter reuses it, so just-inserted numbers are not
    // reported as "seen before".
    const sessionId = String((req.body && req.body.sessionId) || '').slice(0, 40) || null;

    const toPersist = []; // new numbers to insert into the cache
    for (const r of out) {
      if (!r.normalized) continue;
      const cached = cacheByPhone.get(r.normalized);
      if (cached) {
        // Only "seen before" if it was first inserted by a DIFFERENT upload
        // session (a genuinely earlier batch) — not this same upload re-run.
        const fromPriorUpload = !sessionId || !cached.firstSessionId || cached.firstSessionId !== sessionId;
        if (fromPriorUpload) {
          r.seenBefore = true;
          // Exclude so we never call the same person twice across batches.
          if (!r.reasons.includes('duplicate')) r.reasons.push('seen_before');
        }
        // Carry any stored API verdict so the UI can show it without a new call.
        if (cached.apiChecked) {
          r.apiChecked = true; r.lineType = cached.lineType; r.carrier = cached.carrier; r.liveStatus = cached.liveStatus;
        }
      } else if (seenInBatch.get(r.normalized) === r.index) {
        // First time we've ever seen this number — queue it for the cache with
        // its rule verdict (API fields stay null until a deep check is run).
        toPersist.push({ phone: r.normalized, rulesOk: r.reasons.length === 0, ruleReasons: r.reasons, firstSeenFile: r.srcFile || null, firstSessionId: sessionId, seenCount: 1 });
      }
    }

    // Persist new numbers (rule verdicts). Best-effort, ignore-duplicates.
    try { if (toPersist.length) await PhoneCheck.bulkCreate(toPersist, { ignoreDuplicates: true }); } catch (e) { /* non-fatal */ }
    // Bump seenCount for numbers already in the cache (analytics only).
    try {
      const repeats = [...cacheByPhone.keys()];
      if (repeats.length) await PhoneCheck.increment('seenCount', { by: 1, where: { phone: { [Op.in]: repeats } } });
    } catch (e) { /* non-fatal */ }

    // Finalise reasons/ok + summary. `ok` reflects only HARD reasons; soft
    // signals are shown as advisory badges and counted, but don't exclude.
    for (const r of out) {
      r.ok = r.reasons.length === 0;
      r.reasonLabels = r.reasons.map((x) => REASON_LABELS[x] || x);
      r.softReasonLabels = (r.softReasons || []).map((x) => REASON_LABELS[x] || x);
    }
    summary.total = out.length;
    for (const r of out) {
      if (r.ok) summary.valid += 1;
      else { summary.flagged += 1; r.reasons.forEach((x) => { if (summary[x] != null) summary[x] += 1; }); }
      // Count soft signals separately (a valid row can still carry advisory ones).
      (r.softReasons || []).forEach((x) => { if (summary[x] != null) summary[x] += 1; });
    }
    // API accounting: among the rows that passed rules and are the first
    // occurrence of their number in this batch, how many already have a cached
    // API verdict vs. would need a (paid) call.
    const firstValid = out.filter((r) => r.ok && r.normalized && seenInBatch.get(r.normalized) === r.index);
    summary.api_cached = firstValid.filter((r) => r.apiChecked).length;
    summary.api_to_check = firstValid.filter((r) => !r.apiChecked).length;

    res.json({ ok: true, headers, phoneCol, countryCol, rows: out, summary, perFile, multi: files.length > 1 });
  } catch (e) { next(e); }
});

// --- Export a cleaned workbook (flagged rows removed) -----------------------
// Body: { headers, rows, fileName, includeLineTypes? }
// Keeps ok===true rows. If includeLineTypes is given (e.g. ['mobile','unknown'])
// AND a deep check was run, a kept row is also filtered by its line type — so
// the admin picks exactly which line types go into the dialer file at download.
// 'unknown' covers rows with no line_type (not deep-checked, or NumVerify blank).
router.post('/export/xlsx', async (req, res, next) => {
  try {
    const XLSX = require('xlsx');
    const headers = Array.isArray(req.body && req.body.headers) ? req.body.headers : [];
    const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
    const srcName = String((req.body && req.body.fileName) || 'whois-data').replace(/\.(xlsx|xls|csv)$/i, '');
    const includeLineTypes = Array.isArray(req.body && req.body.includeLineTypes) ? req.body.includeLineTypes : null;
    if (!headers.length) return res.status(400).json({ error: 'Nothing to export.' });

    const multi = rows.some((r) => r && r.srcFile) && new Set(rows.map((r) => r && r.srcFile)).size > 1;
    const lineTypeOf = (r) => (r && r.lineType ? String(r.lineType).toLowerCase() : 'unknown');
    const passesLineType = (r) => !includeLineTypes || includeLineTypes.includes(lineTypeOf(r));

    const kept = rows.filter((r) => r && r.ok && passesLineType(r));
    // Removed = structurally excluded OR excluded by the line-type chooser.
    const removed = rows.filter((r) => r && (!r.ok || !passesLineType(r)));

    const wb = XLSX.utils.book_new();
    const withLT = rows.some((r) => r && r.lineType); // was a deep check run?

    // Sheet 1: Cleaned — header + kept rows (+ Source file / Line type columns).
    const cleanHead = [...headers, ...(multi ? ['Source file'] : []), ...(withLT ? ['Line type', 'Carrier'] : [])];
    const cleanAoa = [cleanHead, ...kept.map((r) => {
      const cells = (r.cells || []).map((c) => (c == null ? '' : c));
      return [...cells, ...(multi ? [r.srcFile || ''] : []), ...(withLT ? [r.lineType || '', r.carrier || ''] : [])];
    })];
    const wsClean = XLSX.utils.aoa_to_sheet(cleanAoa);
    wsClean['!cols'] = cleanHead.map((h) => ({ wch: Math.min(28, Math.max(10, String(h).length + 2)) }));
    XLSX.utils.book_append_sheet(wb, wsClean, 'Cleaned');

    // Sheet 2: Removed — dropped rows + Source file / Line type + Reason.
    const remHead = [...headers, ...(multi ? ['Source file'] : []), ...(withLT ? ['Line type', 'Carrier'] : []), 'Removed reason'];
    const removedAoa = [remHead, ...removed.map((r) => {
      const cells = (r.cells || []).map((c) => (c == null ? '' : c));
      // Reason = the hard reasons, or (if only a line-type filter dropped it) the line-type exclusion.
      let reason = (r.reasonLabels || []).join('; ');
      if (!reason && includeLineTypes) reason = `Line type not selected (${lineTypeOf(r)})`;
      return [...cells, ...(multi ? [r.srcFile || ''] : []), ...(withLT ? [r.lineType || '', r.carrier || ''] : []), reason];
    })];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(removedAoa), 'Removed');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.json({ ok: true, base64: buf.toString('base64'), fileName: `${srcName}-cleaned.xlsx`, kept: kept.length, removed: removed.length });
  } catch (e) { next(e); }
});

// --- Is the NumVerify deep check available? (key present?) ------------------
async function getNumverifyKey() {
  // Prefer the admin-stored key; fall back to an env var for simple Railway setup.
  try { const s = await Settings.findOne(); const k = s && s.getKey && s.getKey('numverify'); if (k) return k; } catch (e) { /* ignore */ }
  return process.env.NUMVERIFY_API_KEY || null;
}

router.get('/config', async (req, res, next) => {
  try {
    const key = await getNumverifyKey();
    res.json({ deepCheck: { provider: 'numverify', available: !!key } });
  } catch (e) { next(e); }
});

// --- Deep check (NumVerify line type) ---------------------------------------
// Body: { rows:[{ normalized, ... }] }  (the rows from /check)
// Only numbers that (a) passed the free rules, (b) are the first occurrence in
// the batch, and (c) have NO cached API verdict are looked up — so credits are
// spent at most once per unique number, ever. Results are written to the cache
// and returned keyed by normalized number for the client to merge into rows.
router.post('/deep-check', async (req, res, next) => {
  try {
    const key = await getNumverifyKey();
    if (!key) return res.status(400).json({ error: 'NumVerify is not configured. Add the access key in Settings (apiKeys.numverify) or the NUMVERIFY_API_KEY env var.' });
    // Free NumVerify plans are http-only; honour an explicit https flag/env.
    const useHttps = String(process.env.NUMVERIFY_HTTPS || '').toLowerCase() !== 'false';

    const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
    // Candidate numbers: rule-OK (not flagged) + has a normalized value.
    const candidates = [...new Set(rows.filter((r) => r && r.ok && r.normalized).map((r) => r.normalized))];
    if (!candidates.length) return res.json({ ok: true, results: {}, checked: 0, fromCache: 0, called: 0 });

    // Split into already-cached (free) vs needs-a-call.
    const cached = new Map();
    try {
      const found = await PhoneCheck.findAll({ where: { phone: { [Op.in]: candidates }, apiChecked: true } });
      found.forEach((pc) => cached.set(pc.phone, pc));
    } catch (e) { /* ignore cache read errors */ }

    const toCall = candidates.filter((p) => !cached.has(p));
    const results = {};
    for (const p of candidates) {
      if (cached.has(p)) { const c = cached.get(p); results[p] = { lineType: c.lineType, carrier: c.carrier, liveStatus: c.liveStatus, source: 'cache' }; }
    }

    // Look up the rest with small concurrency (NumVerify is one-number-per-call).
    let called = 0; let errors = 0;
    const CONCURRENCY = 5;
    for (let i = 0; i < toCall.length; i += CONCURRENCY) {
      const slice = toCall.slice(i, i + CONCURRENCY);
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(slice.map(async (p) => {
        const r = await numverify.lookup(p, { accessKey: key, countryCode: 'US', useHttps });
        if (!r.ok) { errors += 1; results[p] = { error: r.error, source: 'error' }; return; }
        called += 1;
        const dialable = numverify.lineTypeIsDialable(r.lineType);
        const verdict = { lineType: r.lineType, carrier: r.carrier, liveStatus: null, dialable, source: 'api' };
        results[p] = verdict;
        // Persist to cache (upsert on the unique phone).
        try {
          await PhoneCheck.update(
            { apiChecked: true, lineType: r.lineType || null, carrier: r.carrier || null, apiProvider: 'numverify', apiRaw: r.raw, lastCheckedAt: new Date() },
            { where: { phone: p } }
          );
        } catch (e) { /* non-fatal */ }
      }));
    }

    res.json({ ok: true, results, checked: candidates.length, fromCache: cached.size, called, errors });
  } catch (e) { next(e); }
});

module.exports = router;

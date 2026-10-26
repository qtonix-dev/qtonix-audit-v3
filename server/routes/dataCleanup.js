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
const { PhoneCheck, CleanupBatch, CleanupNumber, Op, Settings, cleanupSequelize } = require('../models');
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
    // When the client uploads files ONE AT A TIME (for a progress bar), it passes
    // the numbers already seen in earlier files of the SAME upload here, so a
    // number repeated across files is still flagged as a duplicate. Pre-seed the
    // in-batch set with them (index -1 = "seen in an earlier file this upload").
    const priorNormals = Array.isArray(req.body && req.body.priorNormals) ? req.body.priorNormals : [];
    for (const p of priorNormals) { if (p && !seenInBatch.has(p)) seenInBatch.set(p, -1); }

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

    // Record the batch NOW (on process), so it appears in History immediately —
    // even if the user never downloads. `append` mode (file-by-file upload) adds
    // this file's rows to the running batch; otherwise it replaces.
    const append = !!(req.body && req.body.append);
    const fileNames = files.map((f) => f.name);
    const batchId = await recordBatch({ sessionId, user: req.user, headers, rows: out, fileNames, append });

    // The normalized numbers in THIS file, so a file-by-file client can carry
    // them forward (priorNormals) to flag cross-file duplicates.
    const newNormals = [...new Set(out.filter((r) => r.normalized).map((r) => r.normalized))];

    res.json({ ok: true, headers, phoneCol, countryCol, rows: out, summary, perFile, multi: files.length > 1, batchId, newNormals });
  } catch (e) { next(e); }
});

// Build the cleaned workbook. IMPORTANT: it writes ONLY the original sheet
// columns (plus a Source file column for multi-file, and a Removed reason on the
// Removed sheet). No NumVerify / line-type / carrier columns — the dialer wants
// the data exactly as uploaded. A deep check still filters WHICH rows are kept
// (via each row's ok + line type), it just never adds columns to the file.
function buildCleanedWorkbook({ headers, kept, removed, multi }) {
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();

  const cleanHead = multi ? [...headers, 'Source file'] : headers;
  const cleanAoa = [cleanHead, ...kept.map((r) => {
    const cells = (r.cells || []).map((c) => (c == null ? '' : c));
    return multi ? [...cells, r.srcFile || ''] : cells;
  })];
  const wsClean = XLSX.utils.aoa_to_sheet(cleanAoa);
  wsClean['!cols'] = cleanHead.map((h) => ({ wch: Math.min(28, Math.max(10, String(h).length + 2)) }));
  XLSX.utils.book_append_sheet(wb, wsClean, 'Cleaned');

  const remHead = [...(multi ? [...headers, 'Source file'] : headers), 'Removed reason'];
  const removedAoa = [remHead, ...removed.map((r) => {
    const cells = (r.cells || []).map((c) => (c == null ? '' : c));
    const reason = (r.reasonLabels || []).join('; ') || (r.reason || '');
    return multi ? [...cells, r.srcFile || '', reason] : [...cells, reason];
  })];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(removedAoa), 'Removed');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// Dominant country label from the kept+removed rows (for the batch record).
function dominantCountry(rows, headers) {
  const ci = headers.findIndex((h) => /country/i.test(String(h)));
  if (ci < 0) return '';
  const counts = {};
  rows.forEach((r) => { const v = String((r.cells || [])[ci] || '').trim(); if (v) counts[v] = (counts[v] || 0) + 1; });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : '';
}

// Record (or update) a batch for this upload. Keyed by sessionId so re-checking
// the same upload (filter toggles, deep check, download) UPDATES one row rather
// than creating many. Called on /check so history appears as soon as a file is
// processed — not only on download. Returns the batch id (or null on failure).
async function recordBatch({ sessionId, user, headers, rows, fileNames, includeLineTypes, append = false }) {
  try {
    const lineTypeOf = (r) => (r && r.lineType ? String(r.lineType).toLowerCase() : 'unknown');
    const passesLT = (r) => !includeLineTypes || includeLineTypes.includes(lineTypeOf(r));
    const deepRan = rows.some((r) => r && r.lineType);
    const kept = rows.filter((r) => r && r.ok && passesLT(r));
    const removed = rows.filter((r) => r && (!r.ok || !passesLT(r)));

    // Upsert the SUMMARY row by sessionId. In append mode (file-by-file upload)
    // we ADD this file's counts to the existing row; otherwise we set them.
    let batch = sessionId ? await CleanupBatch.findOne({ where: { sessionId } }) : null;
    const base = {
      sessionId: sessionId || null,
      userId: (user && user.id) || null,
      userName: (user && user.name) || 'Unknown',
      fileNames: fileNames || [],
      country: dominantCountry(rows, headers),
      headers,
    };
    const mobileThis = deepRan ? kept.filter((r) => lineTypeOf(r) === 'mobile').length : null;
    if (batch && append) {
      await batch.update({
        ...base,
        fileNames: [...new Set([...(batch.fileNames || []), ...(fileNames || [])])],
        country: batch.country || base.country,
        totalRows: (batch.totalRows || 0) + rows.length,
        cleanCount: (batch.cleanCount || 0) + kept.length,
        excludedCount: (batch.excludedCount || 0) + removed.length,
        mobileCount: mobileThis == null ? batch.mobileCount : (batch.mobileCount || 0) + mobileThis,
      });
    } else if (batch) {
      await batch.update({ ...base, totalRows: rows.length, cleanCount: kept.length, excludedCount: removed.length, mobileCount: mobileThis });
      await CleanupNumber.destroy({ where: { batchId: batch.id } });
    } else {
      batch = await CleanupBatch.create({ ...base, totalRows: rows.length, cleanCount: kept.length, excludedCount: removed.length, mobileCount: mobileThis });
    }

    const toNumRow = (r, excluded) => ({
      batchId: batch.id,
      phone: String(r.phone == null ? '' : r.phone).slice(0, 20),
      cells: r.cells || [],
      srcFile: r.srcFile || null,
      lineType: r.lineType || null,
      carrier: r.carrier || null,
      excluded,
      reason: excluded ? ((r.reasonLabels || []).join('; ') || r.reason || '').slice(0, 255) : null,
    });
    const all = [...kept.map((r) => toNumRow(r, false)), ...removed.map((r) => toNumRow(r, true))];
    const CHUNK = 1000;
    for (let i = 0; i < all.length; i += CHUNK) {
      // eslint-disable-next-line no-await-in-loop
      await CleanupNumber.bulkCreate(all.slice(i, i + CHUNK));
    }
    return batch.id;
  } catch (e) {
    console.error('[data-cleanup] recordBatch failed:', e.message);
    return null;
  }
}

// --- Export a cleaned workbook (flagged rows removed) + RECORD the batch -----
// Body: { headers, rows, fileName, includeLineTypes?, fileNames? }
// Keeps ok===true rows; if includeLineTypes is given (after a deep check) a kept
// row is also filtered by its line type. On a successful download we persist a
// CleanupBatch audit row (who/when/file/country/counts + the committed rows) so
// the exact same file can be re-downloaded from History.
router.post('/export/xlsx', async (req, res, next) => {
  try {
    const headers = Array.isArray(req.body && req.body.headers) ? req.body.headers : [];
    const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
    const srcName = String((req.body && req.body.fileName) || 'whois-data').replace(/\.(xlsx|xls|csv)$/i, '');
    const includeLineTypes = Array.isArray(req.body && req.body.includeLineTypes) ? req.body.includeLineTypes : null;
    const fileNames = Array.isArray(req.body && req.body.fileNames) ? req.body.fileNames : [srcName];
    const sessionId = String((req.body && req.body.sessionId) || '').slice(0, 40) || null;
    if (!headers.length) return res.status(400).json({ error: 'Nothing to export.' });

    const multi = rows.some((r) => r && r.srcFile) && new Set(rows.map((r) => r && r.srcFile)).size > 1;
    const lineTypeOf = (r) => (r && r.lineType ? String(r.lineType).toLowerCase() : 'unknown');
    const passesLineType = (r) => !includeLineTypes || includeLineTypes.includes(lineTypeOf(r));

    const kept = rows.filter((r) => r && r.ok && passesLineType(r));
    const removed = rows.filter((r) => r && (!r.ok || !passesLineType(r))).map((r) => {
      if (!(r.reasonLabels || []).length && includeLineTypes && !passesLineType(r)) {
        return { ...r, reason: `Line type not selected (${lineTypeOf(r)})` };
      }
      return r;
    });

    const buf = buildCleanedWorkbook({ headers, kept, removed, multi });

    // Update the batch to reflect the DOWNLOADED (line-type-filtered) result, so
    // History shows exactly what was downloaded. Upserted by sessionId.
    await recordBatch({ sessionId, user: req.user, headers, rows, fileNames, includeLineTypes });

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
    // Live-check the cleanup DB so the UI can show a clear connection status.
    let db = { separate: cleanupSequelize !== require('../models').sequelize, connected: false, name: process.env.CLEANUP_DB_NAME || null, error: null };
    try { await cleanupSequelize.authenticate(); db.connected = true; } catch (e) { db.error = e.message; }
    res.json({ deepCheck: { provider: 'numverify', available: !!key }, isAdmin: !!(req.user && req.user.role === 'admin'), db });
  } catch (e) { next(e); }
});

// Explicit DB health-check endpoint (admin) — returns the live status + table row counts.
router.get('/db-status', async (req, res, next) => {
  try {
    const out = { separate: cleanupSequelize !== require('../models').sequelize, name: process.env.CLEANUP_DB_NAME || '(main DB)', host: process.env.CLEANUP_DB_HOST || process.env.DB_HOST || null, connected: false, tables: {}, error: null };
    try {
      await cleanupSequelize.authenticate();
      out.connected = true;
      out.tables.phone_checks = await PhoneCheck.count();
      out.tables.cleanup_batches = await CleanupBatch.count();
      out.tables.cleanup_numbers = await CleanupNumber.count();
    } catch (e) { out.error = e.message; }
    res.json(out);
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

// --- Reset the phone-check cache (admin only) -------------------------------
// Clears the dedupe/line-type cache so numbers stop showing as "duplicate from a
// previous upload". Does NOT touch the batch history. Useful once, to start
// fresh (e.g. after the history feature was added). Admin-only for safety.
router.post('/reset-cache', async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Only an admin can reset the cache.' });
    const n = await PhoneCheck.destroy({ where: {}, truncate: false });
    res.json({ ok: true, cleared: n });
  } catch (e) { next(e); }
});

// --- History: list batches (summary only — tiny & fast) + top-box totals ----
router.get('/batches', async (req, res, next) => {
  try {
    const q = String((req.query && req.query.q) || '').trim();
    const page = Math.max(0, parseInt((req.query && req.query.page) || '0', 10) || 0);
    const PAGE = 50;
    const where = {};
    if (q) where[Op.or] = [{ userName: { [Op.like]: `%${q}%` } }];
    // Summary rows only — never loads the number lists, so this is light.
    const { rows, count } = await CleanupBatch.findAndCountAll({
      where, order: [['createdAt', 'DESC']], limit: PAGE, offset: page * PAGE,
      attributes: ['id', 'createdAt', 'userName', 'fileNames', 'country', 'totalRows', 'cleanCount', 'mobileCount', 'excludedCount'],
    });
    let list = rows.map((b) => b.toJSON());
    // File-name search (fileNames is JSON, filter in JS for the current page set
    // after the userName SQL filter; good enough and still light).
    if (q) list = list.filter((b) => (b.userName || '').toLowerCase().includes(q.toLowerCase()) || (b.fileNames || []).join(' ').toLowerCase().includes(q.toLowerCase()));
    // Totals via SQL aggregate (cheap) across ALL batches, not just this page.
    const agg = await CleanupBatch.findOne({
      attributes: [
        [cleanupSequelize.fn('COUNT', cleanupSequelize.col('id')), 'batches'],
        [cleanupSequelize.fn('SUM', cleanupSequelize.col('totalRows')), 'checked'],
        [cleanupSequelize.fn('SUM', cleanupSequelize.col('cleanCount')), 'clean'],
        [cleanupSequelize.fn('SUM', cleanupSequelize.col('excludedCount')), 'excluded'],
      ], raw: true,
    });
    const totals = {
      batches: Number(agg.batches || 0), checked: Number(agg.checked || 0),
      clean: Number(agg.clean || 0), excluded: Number(agg.excluded || 0),
    };
    res.json({ ok: true, batches: list, totals, page, pageSize: PAGE, totalBatches: count });
  } catch (e) { next(e); }
});

// --- History: one batch's numbers, PAGINATED + SQL-filtered -----------------
// Query: ?filter=all|clean|mobile|excluded & ?page=N & ?q=phone
router.get('/batches/:id', async (req, res, next) => {
  try {
    const b = await CleanupBatch.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: 'Batch not found.' });
    const o = b.toJSON();
    const filter = String((req.query && req.query.filter) || 'all');
    const q = String((req.query && req.query.q) || '').trim();
    const page = Math.max(0, parseInt((req.query && req.query.page) || '0', 10) || 0);
    const PAGE = 100;
    const where = { batchId: o.id };
    if (filter === 'clean') where.excluded = false;
    else if (filter === 'excluded') where.excluded = true;
    else if (filter === 'mobile') { where.excluded = false; where.lineType = 'mobile'; }
    if (q) where.phone = { [Op.like]: `%${q.replace(/\D/g, '')}%` };
    const { rows, count } = await CleanupNumber.findAndCountAll({
      where, order: [['excluded', 'ASC'], ['id', 'ASC']], limit: PAGE, offset: page * PAGE,
    });
    res.json({
      ok: true,
      batch: {
        id: o.id, createdAt: o.createdAt, userName: o.userName, fileNames: o.fileNames || [], country: o.country || '',
        headers: o.headers || [], totalRows: o.totalRows, cleanCount: o.cleanCount, mobileCount: o.mobileCount, excludedCount: o.excludedCount,
      },
      rows: rows.map((r) => { const x = r.toJSON(); return { phone: x.phone, cells: x.cells, srcFile: x.srcFile, lineType: x.lineType, carrier: x.carrier, excluded: x.excluded, reason: x.reason, reasonLabels: x.reason ? x.reason.split('; ') : [] }; }),
      page, pageSize: PAGE, totalRows: count,
    });
  } catch (e) { next(e); }
});

// --- History: re-download a batch's cleaned file (streamed from DB rows) -----
router.get('/batches/:id/download', async (req, res, next) => {
  try {
    const b = await CleanupBatch.findByPk(req.params.id);
    if (!b) return res.status(404).send('Batch not found.');
    const o = b.toJSON();
    const multi = (o.fileNames || []).length > 1;
    // Pull kept + removed rows in pages to keep memory flat on large batches.
    const fetchAll = async (excluded) => {
      const out = []; const PAGE = 2000; let off = 0;
      for (;;) {
        // eslint-disable-next-line no-await-in-loop
        const rows = await CleanupNumber.findAll({ where: { batchId: o.id, excluded }, order: [['id', 'ASC']], limit: PAGE, offset: off });
        rows.forEach((r) => { const x = r.toJSON(); out.push({ cells: x.cells, srcFile: x.srcFile, reasonLabels: x.reason ? x.reason.split('; ') : [] }); });
        if (rows.length < PAGE) break; off += PAGE;
      }
      return out;
    };
    const kept = await fetchAll(false);
    const removed = await fetchAll(true);
    const buf = buildCleanedWorkbook({ headers: o.headers || [], kept, removed, multi });
    const name = `${String((o.fileNames || ['whois'])[0]).replace(/\.(xlsx|xls|csv)$/i, '')}-cleaned.xlsx`;
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="${name}"`);
    res.send(buf);
  } catch (e) { next(e); }
});

// Retention: delete per-number detail older than 6 months. The summary batch
// rows and the dedupe cache (phone_checks) are KEPT — only the heavy
// cleanup_numbers detail is pruned, so History stays small and fast.
async function pruneOldNumbers() {
  try {
    const cutoff = new Date(Date.now() - 183 * 24 * 60 * 60 * 1000); // ~6 months
    const n = await CleanupNumber.destroy({ where: { createdAt: { [Op.lt]: cutoff } } });
    if (n) console.log(`[data-cleanup] pruned ${n} number rows older than 6 months`);
  } catch (e) { console.error('[data-cleanup] prune failed (non-fatal):', e.message); }
}

module.exports = router;
module.exports.pruneOldNumbers = pruneOldNumbers;

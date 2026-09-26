const express = require('express');
const router = express.Router();
const { TicketBooking, Settings, Op } = require('../models');
const parser = require('../services/ticketParser');
const ticketPdf = require('../services/ticketPdf');
const imagekit = require('../services/imagekit');

// Admin-only guard (CRM admin). requireAuth + admin role are applied at mount.
function actor(req) { return { id: req.user && req.user.id, name: (req.user && req.user.name) || 'Admin' }; }

// Normalize a tour name so the same physical tour groups together regardless of
// how each source (Viator, GYG, …) words it. Colosseum + Roman Forum + Palatine
// bookings all map to one canonical tour so they can share a ticket.
function normalizeTour(name) {
  const n = String(name || '').toLowerCase();
  // All Colosseum / Roman Forum / Palatine / Ancient Rome variants are the same
  // physical entry, however each source words it — group them as one tour.
  if (n.includes('colosseum') || n.includes('colosseo') || n.includes('palatine') || n.includes('roman forum') || n.includes('ancient rome')) return 'Colosseum, Roman Forum & Palatine Hill';
  return String(name || '').trim() || 'Unassigned tour';
}

async function aiKeys() {
  try { const s = await Settings.findOne({ where: { singleton: 'settings' } }); return { anthropic: s && s.getKey ? s.getKey('anthropic') : null, openai: s && s.getKey ? s.getKey('openai') : null }; } catch { return {}; }
}

// Parse pasted text into review rows (does NOT save).
router.post('/parse', async (req, res, next) => {
  try {
    const text = String((req.body && req.body.text) || '');
    if (!text.trim()) return res.json({ rows: [] });
    const rows = await parser.parseBookings(text, await aiKeys());
    res.json({ rows });
  } catch (e) { next(e); }
});

// Save one or many reviewed bookings.
router.post('/save', async (req, res, next) => {
  try {
    const items = Array.isArray(req.body && req.body.bookings) ? req.body.bookings : [];
    if (!items.length) return res.status(400).json({ error: 'No bookings to save.' });
    const a = actor(req);
    const saved = [];
    const skipped = []; // references that already exist in the DB (duplicate booking numbers)

    // Pre-load existing references for the batch so we can skip duplicates. Compared
    // case-insensitively and trimmed, so "BR-123 " and "br-123" count as the same.
    const norm = (r) => String(r || '').trim().toLowerCase();
    const batchRefs = items.map((b) => norm(b.reference)).filter(Boolean);
    const existingRows = batchRefs.length
      ? await TicketBooking.findAll({ attributes: ['reference'], where: { reference: { [Op.in]: items.map((b) => String(b.reference || '').trim()).filter(Boolean) } } })
      : [];
    const existingRefs = new Set(existingRows.map((r) => norm(r.reference)));
    const seenInBatch = new Set(); // also guard against the same ref appearing twice in one paste

    for (const b of items) {
      const ref = norm(b.reference);
      if (ref && (existingRefs.has(ref) || seenInBatch.has(ref))) {
        skipped.push({ reference: String(b.reference || '').trim(), leadTraveler: b.leadTraveler || null, reason: existingRefs.has(ref) ? 'already_exists' : 'duplicate_in_paste' });
        continue;
      }
      if (ref) seenInBatch.add(ref);
      const travelers = (Array.isArray(b.travelers) ? b.travelers : []).map((t, i) => ({ sn: i + 1, type: t.type || 'Adult', index: i + 1, firstName: t.firstName || '', lastName: t.lastName || '', dob: t.dob || '' }));
      const adults = travelers.filter((t) => t.type === 'Adult').length || Number(b.adults) || 0;
      const children = travelers.filter((t) => t.type === 'Child').length || Number(b.children) || 0;
      const infants = travelers.filter((t) => t.type === 'Infant').length || Number(b.infants) || 0;
      const bookedTime = b.bookedTime || null;
      const productName = b.productName || parser.productName(b.bookingType === 'last_minute' ? 'last_minute' : 'regular', bookedTime || '');
      const row = await TicketBooking.create({
        source: b.source || 'other', bookingType: b.bookingType === 'last_minute' ? 'last_minute' : 'regular',
        reference: String(b.reference || '').slice(0, 80), bookingDate: b.bookingDate || null,
        travelDate: b.travelDate || null, travelDateLabel: b.travelDateLabel || null,
        customerTime: b.customerTime || null, bookedTime, tourName: b.tourName || null,
        productName, productCode: b.productCode || null, tourGrade: b.tourGrade || null, tourGradeCode: b.tourGradeCode || null,
        leadTraveler: b.leadTraveler || (travelers[0] ? `${travelers[0].firstName} ${travelers[0].lastName}`.trim() : null),
        adults, children, infants, pax: adults + children + infants || travelers.length,
        phone: b.phone || null, email: b.email || null, language: b.language || null,
        travelers, status: 'new', createdById: a.id, createdByName: a.name,
      });
      saved.push(row.toJSON());
    }
    res.json({ ok: true, saved, skipped });
  } catch (e) { next(e); }
});

// List with filters.
router.get('/list', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.source) where.source = String(req.query.source);
    if (req.query.type) where.bookingType = String(req.query.type);
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.date) where.travelDate = String(req.query.date);
    let rows = await TicketBooking.findAll({ where, order: [['travelDate', 'ASC'], ['bookedTime', 'ASC'], ['id', 'DESC']] });
    const q = req.query.q ? String(req.query.q).toLowerCase() : '';
    if (q) rows = rows.filter((r) => `${r.reference} ${r.leadTraveler || ''} ${(r.travelers || []).map((t) => t.firstName + ' ' + t.lastName).join(' ')}`.toLowerCase().includes(q));
    res.json({ bookings: rows.map((r) => r.toJSON()) });
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try { const row = await TicketBooking.findByPk(Number(req.params.id)); if (!row) return res.status(404).json({ error: 'Not found.' }); res.json(row.toJSON()); } catch (e) { next(e); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const row = await TicketBooking.findByPk(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Not found.' });
    const b = req.body || {};
    const fields = ['bookedTime', 'travelDate', 'travelDateLabel', 'leadTraveler', 'phone', 'email', 'language', 'tourName', 'productCode', 'bookingType', 'source'];
    fields.forEach((f) => { if (b[f] !== undefined) row[f] = b[f]; });
    if (b.travelers !== undefined) { row.travelers = (b.travelers || []).map((t, i) => ({ sn: i + 1, type: t.type || 'Adult', index: i + 1, firstName: t.firstName || '', lastName: t.lastName || '', dob: t.dob || '', ticketCode: t.ticketCode, ticketTime: t.ticketTime, ocoNumber: t.ocoNumber, pdfPage: t.pdfPage, match: t.match })); row.changed('travelers', true); const tr = row.travelers; row.adults = tr.filter((t) => t.type === 'Adult').length; row.children = tr.filter((t) => t.type === 'Child').length; row.infants = tr.filter((t) => t.type === 'Infant').length; row.pax = tr.length; }
    if (b.bookedTime !== undefined) row.productName = parser.productName(row.bookingType, b.bookedTime || '');
    await row.save();
    res.json(row.toJSON());
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const row = await TicketBooking.findByPk(Number(req.params.id));
    if (!row) return res.json({ ok: true });
    // Delete the attached ticket PDF(s) from ImageKit before removing the row.
    const fileIds = new Set();
    if (row.pdfFileId) fileIds.add(row.pdfFileId);
    (row.travelers || []).forEach((t) => { if (t.pdfFileId) fileIds.add(t.pdfFileId); });
    for (const fid of fileIds) { try { await imagekit.deleteFile(fid); } catch { /* best-effort */ } }
    await row.destroy();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Tickets-to-book plan: bookings with status 'new', grouped tour -> date|time,
// packed into 8-pax tickets (never splitting a booking). Date filter via ?date.
router.get('/plan/tobook', async (req, res, next) => {
  try {
    const where = { status: 'new' };
    if (req.query.date) where.travelDate = String(req.query.date);
    const rows = (await TicketBooking.findAll({ where, order: [['travelDate', 'ASC'], ['bookedTime', 'ASC']] })).map((r) => r.toJSON());
    // group tour -> date|time. Normalize the tour name so the SAME physical tour
    // from different sources (Viator vs GYG name it differently) groups together
    // and can be merged onto one ticket.
    const tours = {};
    for (const b of rows) {
      const tour = normalizeTour(b.tourName);
      const key = `${b.travelDate || '—'}|${b.bookedTime || '—'}`;
      (tours[tour] = tours[tour] || {})[key] = (tours[tour][key] || []);
      tours[tour][key].push(b);
    }
    // pack each slot
    const pack = (list, cap = 8) => { const sorted = [...list].sort((a, b) => b.pax - a.pax); const bins = []; for (const bk of sorted) { const bin = bins.find((x) => x.pax + bk.pax <= cap); if (bin) { bin.items.push(bk); bin.pax += bk.pax; } else bins.push({ items: [bk], pax: bk.pax }); } return bins; };
    const out = Object.entries(tours).map(([tour, slots]) => {
      const slotList = Object.entries(slots).map(([key, list]) => { const [date, time] = key.split('|'); const bins = pack(list); return { date, time, bookings: list, tickets: bins.map((bn) => ({ pax: bn.pax, items: bn.items })), ticketCount: bins.length, pax: list.reduce((s, x) => s + x.pax, 0) }; }).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
      return { tour, slots: slotList, ticketCount: slotList.reduce((s, x) => s + x.ticketCount, 0), pax: slotList.reduce((s, x) => s + x.pax, 0) };
    });
    const grandTickets = out.reduce((s, t) => s + t.ticketCount, 0);
    const grandPax = out.reduce((s, t) => s + t.pax, 0);

    // Cross-date merge candidates: when a specific date is in view, also fetch
    // still-New bookings within the forward window (VIP: +2 days, Regular: +3
    // days) so a lone booking can be merged with an upcoming same-type one. Any
    // time on those days qualifies. Grouped by normalized tour.
    let mergeCandidates = {};
    if (req.query.date) {
      const base = String(req.query.date);
      const addDays = (n) => { const d = new Date(base + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
      const maxDate = addDays(3); // widest window (Regular +3)
      const future = (await TicketBooking.findAll({ where: { status: 'new', travelDate: { [Op.gt]: base, [Op.lte]: maxDate } }, order: [['travelDate', 'ASC'], ['bookedTime', 'ASC']] })).map((r) => r.toJSON());
      for (const b of future) { const tour = normalizeTour(b.tourName); (mergeCandidates[tour] = mergeCandidates[tour] || []).push({ id: b.id, reference: b.reference, leadTraveler: b.leadTraveler, travelDate: b.travelDate, bookedTime: b.bookedTime, pax: b.pax, bookingType: b.bookingType, adults: b.adults, children: b.children, travelers: b.travelers }); }
    }
    res.json({ tours: out, grandTickets, grandPax, pendingCount: rows.length, mergeCandidates, baseDate: req.query.date || null });
  } catch (e) { next(e); }
});

// Upload the official ticket PDF for a booking, read it, match travelers, and
// mark ticketed. PDF is stored in ImageKit under an ISOLATED folder.
router.post('/:id/upload-pdf', async (req, res, next) => {
  try {
    const row = await TicketBooking.findByPk(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Not found.' });
    const base64 = (req.body && req.body.base64) || '';
    if (!base64) return res.status(400).json({ error: 'No PDF provided.' });
    const buffer = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ''), 'base64');

    // Read + match BEFORE storing, so a bad PDF doesn't upload.
    const extracted = await ticketPdf.extractTickets(buffer);
    const { travelers, oco, hasMismatch } = ticketPdf.matchToBooking(row.toJSON(), extracted);

    // Re-upload: remember the OLD file(s) so we can clean them up after linking
    // the new one — but only if no OTHER booking still references the same file.
    const oldFileIds = new Set();
    if (row.pdfFileId) oldFileIds.add(row.pdfFileId);
    (row.travelers || []).forEach((t) => { if (t.pdfFileId) oldFileIds.add(t.pdfFileId); });

    // Store the new PDF in the ISOLATED TicketBooking folder.
    let pdfUrl = row.pdfUrl, pdfFileId = row.pdfFileId;
    try {
      const up = await imagekit.uploadFile({ base64: buffer.toString('base64'), fileName: `${oco || 'ticket'}-${row.reference}.pdf`, folder: `TicketBooking/${row.travelDate || 'undated'}` });
      pdfUrl = up.url; pdfFileId = up.fileId;
    } catch (e) { /* imagekit optional — matching still applies */ }
    // Point every matched traveler at the NEW file (replaces old per-traveler links).
    const newTravelers = travelers.map((t) => (t.ticketCode ? { ...t, pdfUrl, pdfFileId } : t));

    row.travelers = newTravelers; row.changed('travelers', true);
    row.ocoNumber = oco; row.pdfUrl = pdfUrl; row.pdfFileId = pdfFileId;
    row.status = 'ticketed'; row.hasMismatch = hasMismatch;
    // Capture which email the ticket was booked from + the date it was booked, so a
    // copy can be retrieved later. Free-text email; date defaults to today if omitted.
    if (req.body && req.body.bookedByEmail !== undefined) row.bookedByEmail = String(req.body.bookedByEmail || '').trim() || null;
    if (req.body && req.body.bookedOnDate !== undefined) row.bookedOnDate = String(req.body.bookedOnDate || '').trim() || null;
    if (!row.bookedOnDate) row.bookedOnDate = new Date().toISOString().slice(0, 10);
    await row.save();

    // Delete each OLD file — but ONLY if no other booking still references it
    // (guard against losing a shared OCO file), and never the new file.
    for (const fid of oldFileIds) {
      if (!fid || fid === pdfFileId) continue;
      try {
        const others = await TicketBooking.count({ where: { id: { [Op.ne]: row.id }, [Op.or]: [{ pdfFileId: fid }] } });
        // also check per-traveler references in other bookings
        let refByTraveler = 0;
        if (others === 0) { const all = await TicketBooking.findAll({ where: { id: { [Op.ne]: row.id } }, attributes: ['travelers'] }); refByTraveler = all.filter((b) => (b.travelers || []).some((t) => t.pdfFileId === fid)).length; }
        if (others === 0 && refByTraveler === 0) { try { await imagekit.deleteFile(fid); } catch {} }
      } catch {}
    }
    res.json({ ok: true, booking: row.toJSON(), matched: travelers.length, oco, hasMismatch });
  } catch (e) { next(e); }
});

// Upload a PDF for a GROUP of bookings (from the tickets-to-book plan).
router.post('/upload-group', async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(Number) : [];
    const base64 = (req.body && req.body.base64) || '';
    if (!ids.length || !base64) return res.status(400).json({ error: 'Missing bookings or PDF.' });
    const buffer = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    const extracted = await ticketPdf.extractTickets(buffer);
    // store once
    let pdfUrl = null, pdfFileId = null;
    try { const first = await TicketBooking.findByPk(ids[0]); const up = await imagekit.uploadFile({ base64: buffer.toString('base64'), fileName: `${extracted.oco || 'group'}.pdf`, folder: `TicketBooking/${(first && first.travelDate) || 'undated'}` }); pdfUrl = up.url; pdfFileId = up.fileId; } catch {}
    const bookedByEmail = (req.body && req.body.bookedByEmail !== undefined) ? (String(req.body.bookedByEmail || '').trim() || null) : undefined;
    const bookedOnDate = (req.body && String(req.body.bookedOnDate || '').trim()) || new Date().toISOString().slice(0, 10);
    const results = [];
    for (const id of ids) {
      const row = await TicketBooking.findByPk(id); if (!row) continue;
      const { travelers, oco, hasMismatch } = ticketPdf.matchToBooking(row.toJSON(), extracted);
      row.travelers = travelers; row.changed('travelers', true);
      row.ocoNumber = oco; row.pdfUrl = pdfUrl; row.pdfFileId = pdfFileId; row.status = 'ticketed'; row.hasMismatch = hasMismatch;
      if (bookedByEmail !== undefined) row.bookedByEmail = bookedByEmail;
      row.bookedOnDate = bookedOnDate;
      await row.save();
      results.push({ id, hasMismatch });
    }
    res.json({ ok: true, oco: extracted.oco, results });
  } catch (e) { next(e); }
});

// Reporting: how many bookings were TICKETED, grouped by the date the ticket was
// actually booked (bookedOnDate), plus how many travellers on each date.
// Optional ?from=YYYY-MM-DD&to=YYYY-MM-DD to bound the range.
router.get('/report/booked', async (req, res, next) => {
  try {
    const where = { status: 'ticketed' };
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    if (from && to) where.bookedOnDate = { [Op.gte]: from, [Op.lte]: to };
    else if (from) where.bookedOnDate = { [Op.gte]: from };
    else if (to) where.bookedOnDate = { [Op.lte]: to };
    const rows = await TicketBooking.findAll({ where, order: [['bookedOnDate', 'DESC']] });
    const byDate = {};
    let grandBookings = 0, grandTravellers = 0;
    for (const r of rows) {
      const d = r.bookedOnDate || 'undated';
      const trav = (Array.isArray(r.travelers) ? r.travelers.length : 0) || r.pax || 0;
      if (!byDate[d]) byDate[d] = { date: d, bookings: 0, travellers: 0, viator: 0, gyg: 0, regular: 0, vip: 0, items: [] };
      byDate[d].bookings += 1;
      byDate[d].travellers += trav;
      if (r.source === 'viator') byDate[d].viator += 1;
      if (r.source === 'gyg') byDate[d].gyg += 1;
      if (r.bookingType === 'last_minute') byDate[d].vip += 1; else byDate[d].regular += 1;
      byDate[d].items.push({ id: r.id, reference: r.reference, leadTraveler: r.leadTraveler, travellers: trav, source: r.source, bookingType: r.bookingType, travelDate: r.travelDate, ocoNumber: r.ocoNumber, bookedByEmail: r.bookedByEmail });
      grandBookings += 1; grandTravellers += trav;
    }
    const days = Object.values(byDate).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    res.json({ days, grandBookings, grandTravellers });
  } catch (e) { next(e); }
});

// One-time migration: correct Booked time + Product to the CUSTOMER time, and
// re-evaluate ticket matches with the new tolerance. Idempotent.
router.post('/migrate/times', async (req, res, next) => {
  try {
    const minus15 = (t) => { const m = String(t || '').match(/(\d{1,2}):(\d{2})/); if (!m) return t; let tot = (parseInt(m[1], 10) * 60 + parseInt(m[2], 10) - 15 + 1440) % 1440; return `${String(Math.floor(tot / 60)).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`; };
    const rows = await TicketBooking.findAll();
    let fixed = 0;
    for (const row of rows) {
      // Determine the customer time. If we captured it, use it. Otherwise the old
      // bookedTime was customer+15, so derive customer = bookedTime − 15.
      const customer = row.customerTime || minus15(row.bookedTime);
      if (!customer) continue;
      const newBooked = customer;
      const newProduct = parser.productName(row.bookingType, customer);
      // Re-evaluate each traveler's match against the customer time.
      let travelers = row.travelers || [];
      travelers = travelers.map((t) => t.ticketTime ? { ...t, match: ticketPdf.matchVerdict(customer, row.travelDate, t.ticketTime, null) } : t);
      const hasMismatch = travelers.some((t) => t.ticketCode && t.match && t.match !== 'ok');
      const changed = row.bookedTime !== newBooked || row.productName !== newProduct || row.customerTime !== customer;
      if (changed || true) {
        row.customerTime = customer; row.bookedTime = newBooked; row.productName = newProduct;
        row.travelers = travelers; row.changed('travelers', true); row.hasMismatch = hasMismatch;
        await row.save(); fixed++;
      }
    }
    res.json({ ok: true, fixed, total: rows.length });
  } catch (e) { next(e); }
});

// Download a single merged PDF containing ONLY this booking's traveler pages.
async function downloadPdf(req, res, next) {
  try {
    const row = await TicketBooking.findByPk(Number(req.params.id));
    if (!row) return res.status(404).send('Not found');
    let travelers = (row.travelers || []).filter((t) => t.pdfPage);
    if (!travelers.length) return res.status(400).send('No tickets uploaded for this booking yet.');
    // Optional single-traveler download: ?page=N (that traveler's page only).
    const onePage = req.query.page ? Number(req.query.page) : null;
    let fileName = `tickets-${row.reference}.pdf`;
    if (onePage) {
      const t = travelers.find((x) => Number(x.pdfPage) === onePage);
      if (t) { travelers = [t]; fileName = `ticket-${(t.firstName || '') + '-' + (t.lastName || '')}.pdf`.replace(/\s+/g, '-'); }
    }
    const { PDFDocument } = require('pdf-lib');
    const bySource = {};
    travelers.forEach((t) => { const url = t.pdfUrl || row.pdfUrl; if (!url) return; (bySource[url] = bySource[url] || []).push(t.pdfPage); });
    const out = await PDFDocument.create();
    for (const [url, pages] of Object.entries(bySource)) {
      try {
        const resp = await fetch(url); const buf = Buffer.from(await resp.arrayBuffer());
        const src = await PDFDocument.load(buf);
        const uniq = [...new Set(pages)].sort((a, b) => a - b).filter((p) => p >= 1 && p <= src.getPageCount());
        const copied = await out.copyPages(src, uniq.map((p) => p - 1));
        copied.forEach((pg) => out.addPage(pg));
      } catch {}
    }
    if (out.getPageCount() === 0) return res.status(400).send('Could not assemble the ticket pages.');
    const bytes = await out.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(Buffer.from(bytes));
  } catch (e) { next(e); }
}
router.get('/:id/tickets.pdf', downloadPdf);

// ---- Public shareable link (read-only whole module) ----
async function shareSettings() { const s = await Settings.findOne({ where: { singleton: 'settings' } }); return s; }
// GET current share status (admin).
router.get('/share/status', async (req, res, next) => {
  try { const s = await shareSettings(); const tok = s && s.ticketShareToken; res.json({ enabled: !!tok, token: tok || null }); } catch (e) { next(e); }
});
// Enable / regenerate the public link (admin).
router.post('/share/enable', async (req, res, next) => {
  try {
    const s = await shareSettings(); if (!s) return res.status(500).json({ error: 'Settings missing.' });
    const token = require('crypto').randomBytes(18).toString('hex');
    s.ticketShareToken = token; await s.save();
    res.json({ ok: true, token });
  } catch (e) { next(e); }
});
// Disable the public link (admin).
router.post('/share/disable', async (req, res, next) => {
  try { const s = await shareSettings(); if (s) { s.ticketShareToken = null; await s.save(); } res.json({ ok: true }); } catch (e) { next(e); }
});

// Bulk read many ticket PDFs, extract every ticket, and auto-match to pending
// bookings. Does NOT save — returns matched + needs-review for confirmation.
// Stores the uploaded PDFs (isolated folder) and returns their refs so the
// subsequent link step can attach the right PDF to each booking.
router.post('/bulk/read', async (req, res, next) => {
  try {
    const files = Array.isArray(req.body && req.body.files) ? req.body.files : []; // [{ name, base64 }]
    if (!files.length) return res.status(400).json({ error: 'No PDFs provided.' });
    // Pending bookings (optionally scoped by date).
    const where = { status: { [Op.in]: ['new', 'ticketed'] } };
    const bookings = (await TicketBooking.findAll({ where })).map((r) => r.toJSON());
    // Read each PDF; keep a per-page provenance (which stored PDF + page).
    const stored = []; const allTickets = [];
    for (const f of files) {
      const buffer = Buffer.from(String(f.base64 || '').replace(/^data:[^;]+;base64,/, ''), 'base64');
      const ex = await ticketPdf.extractTickets(buffer);
      let url = null, fileId = null;
      try { const up = await imagekit.uploadFile({ base64: buffer.toString('base64'), fileName: `${ex.oco || f.name || 'ticket'}.pdf`, folder: `TicketBooking/bulk` }); url = up.url; fileId = up.fileId; } catch {}
      const fileRef = { name: f.name || (ex.oco + '.pdf'), oco: ex.oco, url, fileId };
      stored.push(fileRef);
      ex.tickets.forEach((tk) => allTickets.push({ ...tk, oco: ex.oco, pdfUrl: url, pdfFileId: fileId, fileName: fileRef.name }));
    }
    const { matched, review } = ticketPdf.bulkMatch(allTickets, bookings);
    // Enrich matched with booking summary for display.
    const bById = Object.fromEntries(bookings.map((b) => [b.id, b]));
    const matchedOut = matched.map((m) => { const b = bById[m.bookingId]; const t = b && b.travelers[m.travelerIndex]; return { ticket: m.ticket, bookingId: m.bookingId, reference: b && b.reference, travelerIndex: m.travelerIndex, travelerName: t ? `${t.firstName} ${t.lastName}` : '', travelerLabel: t ? `${t.type}-${m.travelerIndex + 1}` : '' }; });
    const reviewOut = review.map((r) => ({ ticket: r.ticket, reason: r.reason, candidates: (r.candidates || []).map((id) => ({ id, reference: bById[id] && bById[id].reference, lead: bById[id] && bById[id].leadTraveler })) }));
    res.json({ matched: matchedOut, review: reviewOut, files: stored, bookings: bookings.map((b) => ({ id: b.id, reference: b.reference, leadTraveler: b.leadTraveler, travelDate: b.travelDate, bookedTime: b.bookedTime, travelers: b.travelers.map((t) => `${t.firstName} ${t.lastName}`) })) });
  } catch (e) { next(e); }
});

// Apply the confirmed links: [{ bookingId, travelerIndex, ticket:{code,time,dateIso,page,oco,pdfUrl,pdfFileId} }].
// Groups by booking, writes each traveler's ticket info, marks ticketed, flags mismatches.
router.post('/bulk/link', async (req, res, next) => {
  try {
    const links = Array.isArray(req.body && req.body.links) ? req.body.links : [];
    if (!links.length) return res.status(400).json({ error: 'Nothing to link.' });
    const bookedByEmail = (req.body && req.body.bookedByEmail !== undefined) ? (String(req.body.bookedByEmail || '').trim() || null) : undefined;
    const bookedOnDate = (req.body && String(req.body.bookedOnDate || '').trim()) || new Date().toISOString().slice(0, 10);
    const byBooking = {};
    for (const l of links) { (byBooking[l.bookingId] = byBooking[l.bookingId] || []).push(l); }
    const results = [];
    for (const [bid, ls] of Object.entries(byBooking)) {
      const row = await TicketBooking.findByPk(Number(bid)); if (!row) continue;
      const travelers = (row.travelers || []).map((t) => ({ ...t }));
      let anyPdfUrl = row.pdfUrl, anyPdfFileId = row.pdfFileId, oco = row.ocoNumber;
      for (const l of ls) {
        const ti = l.travelerIndex; const tk = l.ticket || {};
        if (ti == null || !travelers[ti]) continue;
        const match = ticketPdf.matchVerdict(row.bookedTime, row.travelDate, tk.time, tk.dateIso);
        travelers[ti] = { ...travelers[ti], ticketCode: tk.code || null, ticketTime: tk.time || null, ocoNumber: tk.oco || null, pdfPage: tk.page || null, pdfUrl: tk.pdfUrl || null, match };
        oco = tk.oco || oco; anyPdfUrl = tk.pdfUrl || anyPdfUrl; anyPdfFileId = tk.pdfFileId || anyPdfFileId;
      }
      // Any traveler still without a ticket => missing.
      travelers.forEach((t) => { if (!t.ticketCode && !t.match) t.match = 'missing'; });
      const hasMismatch = travelers.some((t) => t.match && t.match !== 'ok');
      row.travelers = travelers; row.changed('travelers', true);
      row.ocoNumber = oco; row.pdfUrl = anyPdfUrl; row.pdfFileId = anyPdfFileId;
      row.status = 'ticketed'; row.hasMismatch = hasMismatch;
      if (bookedByEmail !== undefined) row.bookedByEmail = bookedByEmail;
      row.bookedOnDate = bookedOnDate;
      await row.save();
      results.push({ bookingId: Number(bid), hasMismatch });
    }
    res.json({ ok: true, results });
  } catch (e) { next(e); }
});

module.exports = router;

// ---- PUBLIC read-only router (token-gated, no login) ----
const pub = express.Router();
async function checkShareToken(req, res, next) {
  try {
    const token = req.query.token || req.headers['x-ticket-share'];
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const good = s && s.ticketShareToken;
    if (!good || token !== good) return res.status(403).json({ error: 'This shared link is invalid or has been turned off.' });
    next();
  } catch (e) { next(e); }
}
pub.use(checkShareToken);
// Read-only list.
pub.get('/list', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.date) where.travelDate = String(req.query.date);
    let rows = await TicketBooking.findAll({ where, order: [['travelDate', 'ASC'], ['bookedTime', 'ASC'], ['id', 'DESC']] });
    const q = req.query.q ? String(req.query.q).toLowerCase() : '';
    if (q) rows = rows.filter((r) => `${r.reference} ${r.leadTraveler || ''} ${(r.travelers || []).map((t) => t.firstName + ' ' + t.lastName).join(' ')}`.toLowerCase().includes(q));
    res.json({ bookings: rows.map((r) => r.toJSON()), readOnly: true });
  } catch (e) { next(e); }
});
// Read-only tickets-to-book plan (reuses the same packing logic inline).
pub.get('/plan/tobook', async (req, res, next) => {
  try {
    const where = { status: 'new' };
    if (req.query.date) where.travelDate = String(req.query.date);
    const rows = (await TicketBooking.findAll({ where, order: [['travelDate', 'ASC'], ['bookedTime', 'ASC']] })).map((r) => r.toJSON());
    const tours = {};
    for (const b of rows) { const tour = normalizeTour(b.tourName); const key = `${b.travelDate || '—'}|${b.bookedTime || '—'}`; (tours[tour] = tours[tour] || {})[key] = (tours[tour][key] || []); tours[tour][key].push(b); }
    const pack = (list, cap = 8) => { const sorted = [...list].sort((a, b) => b.pax - a.pax); const bins = []; for (const bk of sorted) { const bin = bins.find((x) => x.pax + bk.pax <= cap); if (bin) { bin.items.push(bk); bin.pax += bk.pax; } else bins.push({ items: [bk], pax: bk.pax }); } return bins; };
    const out = Object.entries(tours).map(([tour, slots]) => { const slotList = Object.entries(slots).map(([key, list]) => { const [date, time] = key.split('|'); const bins = pack(list); return { date, time, bookings: list, tickets: bins.map((bn) => ({ pax: bn.pax, items: bn.items })), ticketCount: bins.length, pax: list.reduce((s, x) => s + x.pax, 0) }; }).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)); return { tour, slots: slotList, ticketCount: slotList.reduce((s, x) => s + x.ticketCount, 0), pax: slotList.reduce((s, x) => s + x.pax, 0) }; });
    res.json({ tours: out, grandTickets: out.reduce((s, t) => s + t.ticketCount, 0), grandPax: out.reduce((s, t) => s + t.pax, 0), pendingCount: rows.length });
  } catch (e) { next(e); }
});
// Read-only download of a booking's ticket pages (whole booking or ?page=N).
pub.get('/:id/tickets.pdf', (req, res, next) => downloadPdf(req, res, next));
module.exports.pub = pub;
module.exports.downloadPdf = downloadPdf;

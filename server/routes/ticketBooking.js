const express = require('express');
const router = express.Router();
const { TicketBooking, Settings, Op } = require('../models');
const parser = require('../services/ticketParser');
const ticketPdf = require('../services/ticketPdf');
const imagekit = require('../services/imagekit');

// Admin-only guard (CRM admin). requireAuth + admin role are applied at mount.
function actor(req) { return { id: req.user && req.user.id, name: (req.user && req.user.name) || 'Admin' }; }

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
    for (const b of items) {
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
    res.json({ ok: true, saved });
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
  try { const row = await TicketBooking.findByPk(Number(req.params.id)); if (row) await row.destroy(); res.json({ ok: true }); } catch (e) { next(e); }
});

// Tickets-to-book plan: bookings with status 'new', grouped tour -> date|time,
// packed into 8-pax tickets (never splitting a booking). Date filter via ?date.
router.get('/plan/tobook', async (req, res, next) => {
  try {
    const where = { status: 'new' };
    if (req.query.date) where.travelDate = String(req.query.date);
    const rows = (await TicketBooking.findAll({ where, order: [['travelDate', 'ASC'], ['bookedTime', 'ASC']] })).map((r) => r.toJSON());
    // group tour -> date|time
    const tours = {};
    for (const b of rows) {
      const tour = b.tourName || 'Unassigned tour';
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
    res.json({ tours: out, grandTickets, grandPax, pendingCount: rows.length });
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

    // Store the PDF in the ISOLATED TicketBooking folder (separate from CRM/HRMS).
    let pdfUrl = row.pdfUrl, pdfFileId = row.pdfFileId;
    try {
      const up = await imagekit.uploadFile({ base64: buffer.toString('base64'), fileName: `${oco || 'ticket'}-${row.reference}.pdf`, folder: `TicketBooking/${row.travelDate || 'undated'}` });
      pdfUrl = up.url; pdfFileId = up.fileId;
    } catch (e) { /* imagekit optional — matching still applies */ }

    row.travelers = travelers; row.changed('travelers', true);
    row.ocoNumber = oco; row.pdfUrl = pdfUrl; row.pdfFileId = pdfFileId;
    row.status = 'ticketed'; row.hasMismatch = hasMismatch;
    await row.save();
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
    const results = [];
    for (const id of ids) {
      const row = await TicketBooking.findByPk(id); if (!row) continue;
      const { travelers, oco, hasMismatch } = ticketPdf.matchToBooking(row.toJSON(), extracted);
      row.travelers = travelers; row.changed('travelers', true);
      row.ocoNumber = oco; row.pdfUrl = pdfUrl; row.pdfFileId = pdfFileId; row.status = 'ticketed'; row.hasMismatch = hasMismatch;
      await row.save();
      results.push({ id, hasMismatch });
    }
    res.json({ ok: true, oco: extracted.oco, results });
  } catch (e) { next(e); }
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
        let match = 'ok';
        if (tk.time && row.bookedTime && tk.time !== row.bookedTime) match = 'time';
        else if (tk.dateIso && row.travelDate && tk.dateIso !== row.travelDate) match = 'date';
        travelers[ti] = { ...travelers[ti], ticketCode: tk.code || null, ticketTime: tk.time || null, ocoNumber: tk.oco || null, pdfPage: tk.page || null, pdfUrl: tk.pdfUrl || null, match };
        oco = tk.oco || oco; anyPdfUrl = tk.pdfUrl || anyPdfUrl; anyPdfFileId = tk.pdfFileId || anyPdfFileId;
      }
      // Any traveler still without a ticket => missing.
      travelers.forEach((t) => { if (!t.ticketCode && !t.match) t.match = 'missing'; });
      const hasMismatch = travelers.some((t) => t.match && t.match !== 'ok');
      row.travelers = travelers; row.changed('travelers', true);
      row.ocoNumber = oco; row.pdfUrl = anyPdfUrl; row.pdfFileId = anyPdfFileId;
      row.status = 'ticketed'; row.hasMismatch = hasMismatch;
      await row.save();
      results.push({ bookingId: Number(bid), hasMismatch });
    }
    res.json({ ok: true, results });
  } catch (e) { next(e); }
});

module.exports = router;

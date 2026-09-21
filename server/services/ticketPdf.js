/**
 * Reads an official Colosseum e-ticket PDF (like OCO4837969.pdf). Each page is
 * one traveler's ticket. Extracts per page: traveler name, ticket code, date,
 * time, and the shared OCO booking number. Then matches each ticket to a saved
 * booking's travelers by name and flags date/time/name/missing mismatches.
 */
const { PDFDocument } = require('pdf-lib');

function to24h(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{1,2})[:.](\d{2})/);
  if (!m) return null;
  return `${String(parseInt(m[1], 10)).padStart(2, '0')}:${m[2]}`;
}
function isoFromDMY(s) { // "22/09/2026" -> "2026-09-22"
  const m = String(s).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// Extract per-page ticket info from the PDF's text (pdf-parse gives text per page
// via the render; here we parse the whole text and split by the page markers).
async function extractTickets(buffer) {
  let pages = []; let allText = '';
  try {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    const data = await parser.getText();
    allText = data.text || '';
    pages = Array.isArray(data.pages) ? data.pages.map((p) => (typeof p === 'string' ? p : (p && p.text) || '')) : allText.split(/Pagina\s+\d+\/\d+/i);
  } catch { pages = []; }

  const oco = (allText.match(/Prenotazione\s+n\.\s*(OCO\d+)/i) || [])[1] || (allText.match(/(OCO\d{4,})/) || [])[1] || null;

  const tickets = [];
  pages.forEach((chunk, i) => {
    if (!/BIGLIETTO ELETTRONICO/i.test(chunk)) return;
    const code = (chunk.match(/\b(SPCO[A-Z0-9]{8,})\b/) || [])[1] || null;
    const dt = chunk.match(/(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{1,2}[:.]\d{2})/);
    const dateIso = dt ? isoFromDMY(dt[1]) : null;
    const time = dt ? to24h(dt[2]) : null;
    // Name sits on the line right after "BIGLIETTO ELETTRONICO".
    let name = '';
    const nm = chunk.match(/BIGLIETTO ELETTRONICO\s*\n\s*([^\n]+)/);
    if (nm) { const cand = nm[1].trim(); if (/^[A-Za-zÀ-ÿ'’.\- ]+$/.test(cand) && cand.split(/\s+/).length >= 2) name = cand; }
    if (!name) {
      const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
      for (const l of lines) { if (/^[A-Za-zÀ-ÿ'’.-]+\s+[A-Za-zÀ-ÿ'’.-]+$/.test(l) && !/COLOSSEO|ROMA|BIGLIETTO|VALID|GRATUITO|PASS/i.test(l)) { name = l; break; } }
    }
    if (code || name) tickets.push({ page: i + 1, code, name, dateIso, time });
  });
  return { oco, tickets };
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

// Match tickets to a booking's travelers by name; annotate each traveler with
// the matched ticket + a match verdict. Returns { travelers, oco, hasMismatch }.
function matchToBooking(booking, extracted) {
  const tickets = [...(extracted.tickets || [])];
  const oco = extracted.oco || null;
  const usedTicket = new Set();
  const travelers = (booking.travelers || []).map((t) => {
    const full = norm(`${t.firstName}${t.lastName}`);
    // find a ticket whose name matches this traveler (first+last in any order)
    let ti = tickets.findIndex((tk, i) => {
      if (usedTicket.has(i)) return false;
      const tn = norm(tk.name);
      return tn && (tn === full || tn === norm(`${t.lastName}${t.firstName}`));
    });
    if (ti < 0) {
      // loose: last name + first initial
      ti = tickets.findIndex((tk, i) => { if (usedTicket.has(i)) return false; const tn = norm(tk.name); return tn && tn.includes(norm(t.lastName)) && tn.includes(norm(t.firstName).slice(0, 3)); });
    }
    if (ti < 0) return { ...t, ticketCode: null, ticketTime: null, ocoNumber: oco, pdfPage: null, match: 'missing' };
    const tk = tickets[ti]; usedTicket.add(ti);
    let match = 'ok';
    if (tk.time && booking.bookedTime && tk.time !== booking.bookedTime) match = 'time';
    else if (tk.dateIso && booking.travelDate && tk.dateIso !== booking.travelDate) match = 'date';
    return { ...t, ticketCode: tk.code || null, ticketTime: tk.time || null, ocoNumber: oco, pdfPage: tk.page, match };
  });
  const hasMismatch = travelers.some((t) => t.match !== 'ok');
  return { travelers, oco, hasMismatch };
}

// Bulk match: given all tickets (from many PDFs) and all candidate bookings,
// assign each ticket to a booking+traveler by name + date + time. Returns
// { matched:[{ticket, bookingId, travelerIndex}], review:[{ticket, reason, candidates:[bookingId]}] }.
function bulkMatch(allTickets, bookings) {
  const matched = []; const review = [];
  // Build an index of unticketed traveler slots per booking.
  const slots = []; // { bookingId, travelerIndex, first, last, full, date, time }
  for (const b of bookings) {
    (b.travelers || []).forEach((t, idx) => {
      slots.push({ bookingId: b.id, travelerIndex: idx, full: norm(`${t.firstName}${t.lastName}`), rev: norm(`${t.lastName}${t.firstName}`), lastN: norm(t.lastName), firstN: norm(t.firstName), date: b.travelDate, time: b.bookedTime, taken: false });
    });
  }
  for (const tk of allTickets) {
    const tn = norm(tk.name);
    if (!tn) { review.push({ ticket: tk, reason: 'Could not read the name on this ticket.', candidates: [] }); continue; }
    // exact name matches (first+last, ignoring order), optionally constrained by date+time
    let cands = slots.filter((s) => !s.taken && (s.full === tn || s.rev === tn));
    if (!cands.length) cands = slots.filter((s) => !s.taken && s.lastN && tn.includes(s.lastN) && tn.includes(s.firstN.slice(0, 3)));
    // Prefer those whose date+time also match the ticket.
    const withDT = cands.filter((s) => (!tk.dateIso || !s.date || s.date === tk.dateIso) && (!tk.time || !s.time || s.time === tk.time));
    const pool = withDT.length ? withDT : cands;
    if (pool.length === 1) { pool[0].taken = true; matched.push({ ticket: tk, bookingId: pool[0].bookingId, travelerIndex: pool[0].travelerIndex, dtMatch: withDT.length > 0 }); }
    else if (pool.length === 0) { review.push({ ticket: tk, reason: 'No booking found for this traveler.', candidates: [] }); }
    else { review.push({ ticket: tk, reason: `${pool.length} bookings match this name/time.`, candidates: [...new Set(pool.map((s) => s.bookingId))] }); }
  }
  return { matched, review };
}

module.exports = { extractTickets, matchToBooking, bulkMatch };

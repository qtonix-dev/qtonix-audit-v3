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
// Read a PDF's text with whatever pdf-parse API is installed. pdf-parse has
// shipped two incompatible shapes: 2.x exports a { PDFParse } class used as
// `new PDFParse({data}).getText()`, while 1.x exports a single callable used as
// `pdfParse(buffer)`. A caret range (^2.4.5) or a moved `latest` dist-tag can
// swap one for the other on a fresh deploy with no code change — which silently
// broke extraction. We now support BOTH and return { text, pages }. The error is
// no longer swallowed: it propagates so the caller can report "couldn't read N
// PDFs" instead of a mysterious zero-match.
async function readPdfText(buffer) {
  const mod = require('pdf-parse');
  // 2.x: class API
  if (mod && typeof mod.PDFParse === 'function') {
    const data = await new mod.PDFParse({ data: buffer }).getText();
    const text = data.text || '';
    const pages = Array.isArray(data.pages)
      ? data.pages.map((p) => (typeof p === 'string' ? p : (p && p.text) || ''))
      : null;
    return { text, pages };
  }
  // 1.x: callable API (module itself, or a .default export)
  const fn = typeof mod === 'function' ? mod : (typeof mod.default === 'function' ? mod.default : null);
  if (fn) {
    const data = await fn(buffer);
    return { text: (data && data.text) || '', pages: null }; // 1.x gives no per-page split
  }
  throw new Error('pdf-parse: unrecognised module shape (neither 2.x PDFParse class nor 1.x callable).');
}

async function extractTickets(buffer) {
  let pages = []; let allText = ''; let parseError = null;
  try {
    const out = await readPdfText(buffer);
    allText = out.text || '';
    // Prefer the library's own page split; otherwise split on the page marker,
    // which the ticket PDF prints as either "Page 1/2" (English) or "Pagina 1/1"
    // (Italian), or the "-- N of M --" separators the reader inserts.
    pages = (out.pages && out.pages.length)
      ? out.pages
      : allText.split(/Pag(?:in)?a\s+\d+\/\d+|--\s*\d+\s+of\s+\d+\s*--/i);
  } catch (e) {
    pages = [];
    parseError = (e && e.message) || 'PDF parse failed';
  }

  const oco = (allText.match(/Prenotazione\s+n\.\s*(OCO\d+)/i) || [])[1] || (allText.match(/(OCO\d{4,})/) || [])[1] || null;

  // A line that is clearly NOT a traveller name (headers, labels, metadata).
  const NON_NAME = /ELECTRONIC|BIGLIETTO|ELETTRONICO|COLOSSEO|FORO|ROMANO|PALATINO|ROMA\s*PASS|VALID|GRATUITO|\bPASS\b|Sigillo|Gruppo|Acquisto|Email|Activity Booking|MiDA|Free|Roma Pass|Page|Pagina|^OCO\d|€|@/i;
  const looksLikeName = (s) => {
    const cand = String(s || '').trim();
    if (!cand || cand.length > 60) return false;
    if (NON_NAME.test(cand)) return false;
    // 2–4 words, letters/accents/'.- only (handles "Rosangela cunha", "Carlos Cunha").
    const words = cand.split(/\s+/);
    if (words.length < 2 || words.length > 4) return false;
    return /^[A-Za-zÀ-ÿ'’.\- ]+$/.test(cand);
  };

  const tickets = [];
  pages.forEach((chunk, i) => {
    // Accept both the English ("ELECTRONIC TICKET") and Italian
    // ("BIGLIETTO ELETTRONICO") ticket pages.
    if (!/ELECTRONIC TICKET|BIGLIETTO ELETTRONICO/i.test(chunk)) return;
    // Ticket code: the Colosseo "Sigillo: SPCO…" value, else a bare SPCO code.
    const code = (chunk.match(/Sigillo:\s*(SPCO[A-Z0-9]+)/i) || [])[1]
      || (chunk.match(/\b(SPCO[A-Z0-9]{8,})\b/) || [])[1] || null;
    const dt = chunk.match(/(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{1,2}[:.]\d{2})/);
    const dateIso = dt ? isoFromDMY(dt[1]) : null;
    const time = dt ? to24h(dt[2]) : null;
    let name = '';
    // Primary anchor (English format): the name is the line right after the
    // "date - time" line, e.g.  "24/10/2026 - 14:15\nFree (Roma Pass)…\nRosangela cunha".
    // We scan the lines after the date line and take the first name-looking one,
    // skipping the price line in between.
    const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
    const dtIdx = lines.findIndex((l) => /\d{2}\/\d{2}\/\d{4}\s*-\s*\d{1,2}[:.]\d{2}/.test(l));
    if (dtIdx >= 0) {
      for (let k = dtIdx + 1; k < lines.length; k++) { if (looksLikeName(lines[k])) { name = lines[k]; break; } }
    }
    // Fallback (Italian format): name on the line right after the header.
    if (!name) {
      const nm = chunk.match(/BIGLIETTO ELETTRONICO\s*\n\s*([^\n]+)/);
      if (nm && looksLikeName(nm[1])) name = nm[1].trim();
    }
    // Last resort: first name-looking line anywhere on the page.
    if (!name) { for (const l of lines) { if (looksLikeName(l)) { name = l; break; } } }
    if (code || name) tickets.push({ page: i + 1, code, name, dateIso, time });
  });
  // rawTextLen + parseError let the caller tell apart the three failure modes:
  //  - parseError set            → the PDF library failed (dependency/env issue)
  //  - rawTextLen 0, no error    → image-only/scanned PDF with no text layer
  //  - text present, 0 tickets   → a format we don't recognise (selectors stale)
  return { oco, tickets, parseError, rawTextLen: allText.length };
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const timeToMin = (t) => { if (!t) return null; const m = String(t).match(/(\d{1,2}):(\d{2})/); return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null; };

// Verdict for a matched ticket vs the booking's CUSTOMER time (bookedTime column
// now holds the customer time). A ticket entry time is fine if it's at or after
// the customer time and within +45 min (covers the +15 default and moderate
// rush). Earlier, or more than +45, is a time mismatch. Date must also match.
// Returns 'ok' | 'time' | 'date'.
function matchVerdict(customerTime, travelDate, ticketTime, ticketDate) {
  if (ticketDate && travelDate && ticketDate !== travelDate) return 'date';
  const c = timeToMin(customerTime); const t = timeToMin(ticketTime);
  if (c == null || t == null) return 'ok';
  const diff = t - c;
  if (diff < 0 || diff > 45) return 'time';
  return 'ok';
}
// Tokenize a name into lowercased word tokens (accent-insensitive).
const tokens = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);

// Robust name match that tolerates DROPPED MIDDLE NAMES and word-order swaps
// (common on official tickets, e.g. booking "Paula Andrea Robayo Sanchez" vs
// ticket "Paula Robayo Sanchez"). Returns a score: 1 exact-set, 0.9 subset with
// first+last present, 0.7 last name + first initial, 0 no match.
function nameScore(bookingName, ticketName) {
  const B = new Set(tokens(bookingName));
  const T = tokens(ticketName);
  if (!T.length || !B.size) return 0;
  const Bt = tokens(bookingName);
  // Every ticket token appears in the booking name (ticket is a subset — i.e.
  // ticket dropped some middle tokens). Requires ticket's first & last present.
  const allInBooking = T.every((t) => B.has(t));
  const firstOk = Bt[0] && T.includes(Bt[0]);
  const lastOk = Bt.length > 1 && T.includes(Bt[Bt.length - 1]);
  if (allInBooking && firstOk && lastOk) return T.length === Bt.length ? 1 : 0.9;
  // Reverse: booking is a subset of ticket (booking dropped middle names).
  const allInTicket = Bt.every((t) => T.includes(t));
  if (allInTicket && firstOk && lastOk) return 0.9;
  // Loose: last name present + first initial.
  const lastName = Bt[Bt.length - 1];
  const firstInit = (Bt[0] || '').slice(0, 3);
  if (lastName && T.includes(lastName) && T.some((t) => t.startsWith(firstInit))) return 0.7;
  return 0;
}

// Match tickets to a booking's travelers by name; annotate each traveler with
// the matched ticket + a match verdict. Returns { travelers, oco, hasMismatch }.
function matchToBooking(booking, extracted) {
  const tickets = [...(extracted.tickets || [])];
  const oco = extracted.oco || null;
  const usedTicket = new Set();
  const travelers = (booking.travelers || []).map((t) => {
    const bookingName = `${t.firstName} ${t.lastName}`;
    // Pick the best-scoring unused ticket.
    let ti = -1, best = 0;
    tickets.forEach((tk, i) => { if (usedTicket.has(i)) return; const sc = nameScore(bookingName, tk.name); if (sc > best) { best = sc; ti = i; } });
    if (ti < 0 || best < 0.7) return { ...t, ticketCode: null, ticketTime: null, ocoNumber: oco, pdfPage: null, match: 'missing' };
    const tk = tickets[ti]; usedTicket.add(ti);
    // bookedTime column now holds the customer time.
    const match = matchVerdict(booking.bookedTime, booking.travelDate, tk.time, tk.dateIso);
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
  const slots = []; // { bookingId, travelerIndex, name, date, time }
  for (const b of bookings) {
    (b.travelers || []).forEach((t, idx) => {
      // skip travelers already ticketed (have a ticketCode)
      if (t.ticketCode) return;
      slots.push({ bookingId: b.id, travelerIndex: idx, name: `${t.firstName} ${t.lastName}`, date: b.travelDate, time: b.bookedTime, taken: false });
    });
  }
  for (const tk of allTickets) {
    if (!tokens(tk.name).length) { review.push({ ticket: tk, reason: 'Could not read the name on this ticket.', candidates: [] }); continue; }
    // Score every slot; keep those above threshold.
    const scored = slots.filter((s) => !s.taken).map((s) => ({ s, sc: nameScore(s.name, tk.name) })).filter((x) => x.sc >= 0.7);
    let cands = scored.map((x) => x.s);
    // Prefer those whose date+time also match the ticket. Date must be equal;
    // time uses the same tolerance as matchVerdict — the ticket's ENTRY time is
    // normally at or shortly after the customer's booked slot (Colosseo gives a
    // +15 timed entry), so we accept 0..+45 min rather than an exact string
    // match. Without this, a standard +15 ticket would miss its booking whenever
    // the name alone is ambiguous.
    const withDT = cands.filter((s) => {
      const dateOk = !tk.dateIso || !s.date || s.date === tk.dateIso;
      if (!tk.time || !s.time) return dateOk;
      const diff = timeToMin(tk.time) - timeToMin(s.time);
      const timeOk = diff != null && diff >= 0 && diff <= 45;
      return dateOk && timeOk;
    });
    const pool = withDT.length ? withDT : cands;
    if (pool.length === 1) { pool[0].taken = true; matched.push({ ticket: tk, bookingId: pool[0].bookingId, travelerIndex: pool[0].travelerIndex, dtMatch: withDT.length > 0 }); }
    else if (pool.length === 0) { review.push({ ticket: tk, reason: 'No booking found for this traveler.', candidates: [] }); }
    else { review.push({ ticket: tk, reason: `${pool.length} bookings match this name/time.`, candidates: [...new Set(pool.map((s) => s.bookingId))] }); }
  }
  return { matched, review };
}

module.exports = { extractTickets, matchToBooking, bulkMatch, matchVerdict };

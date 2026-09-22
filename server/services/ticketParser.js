/**
 * Parses pasted Viator / GetYourGuide booking confirmations into structured
 * bookings. Uses AI (OpenAI-preferred) when a key is available, with a
 * deterministic regex fallback for the known formats so it always works.
 *
 * Returns an array of parsed booking objects.
 */

const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

function to24h(timeStr) {
  if (!timeStr) return null;
  let s = String(timeStr).trim().toUpperCase();
  const m = s.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/);
  if (!m) return null;
  let h = parseInt(m[1], 10); const min = m[2]; const ap = m[3];
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${min}`;
}
function plus15(t24) {
  if (!t24) return null;
  const [h, m] = t24.split(':').map(Number);
  let total = h * 60 + m + 15;
  total = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
function normDate(str) {
  if (!str) return { iso: null, label: null };
  // "Wed, Sep 23, 2026" | "Sep 22, 2026" | "Sep 22, 2026 9:30 AM"
  const m = String(str).match(/([A-Za-z]{3})\w*\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) { const mm = MONTHS[m[1].toLowerCase().slice(0, 3)]; if (mm) { const iso = `${m[3]}-${mm}-${String(m[2]).padStart(2, '0')}`; const label = new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }); return { iso, label }; } }
  return { iso: null, label: String(str).trim() };
}
// Product name uses the CUSTOMER time (what the customer booked for).
function productName(bookingType, customerTime) {
  const t = customerTime || '';
  return bookingType === 'last_minute' ? `VIP ${t}`.trim() : `TICKET & AUDIOGUIDED TOUR ${t}`.trim();
}
// Source is decided by the booking reference prefix: BR… = Viator, GYG… = GYG.
function sourceFromRef(ref) {
  const r = String(ref || '').toUpperCase();
  if (r.startsWith('BR')) return 'viator';
  if (r.startsWith('GYG')) return 'gyg';
  return null;
}
function splitName(full) {
  // Strip trailing age annotations like "(17)" or "(0-17)".
  const cleaned = String(full || '').replace(/\s*\([^)]*\)\s*$/,'').trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] || '', lastName: '' };
  if (parts.length === 2) return { firstName: parts[0], lastName: parts[1] };
  if (parts.length === 3) return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
  // 4+ tokens (common Latin: 2 given + 2 surnames) → split down the middle.
  const half = Math.floor(parts.length / 2);
  return { firstName: parts.slice(0, half).join(' '), lastName: parts.slice(half).join(' ') };
}

// Regex fallback — handles Viator (regular/last-minute) and GYG blocks.
function regexParse(text) {
  const blocks = splitBlocks(text);
  return blocks.map(parseOneBlock).filter(Boolean);
}

// Split a paste into individual booking blocks by their reference lines.
function splitBlocks(text) {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const blocks = []; let cur = [];
  const isStart = (l) => /^Booking Reference:/i.test(l) || /^Booking:\s*[A-Z0-9]/i.test(l);
  for (const l of lines) {
    if (isStart(l) && cur.length) { blocks.push(cur.join('\n')); cur = [l]; }
    else cur.push(l);
  }
  if (cur.length) blocks.push(cur.join('\n'));
  return blocks.filter((b) => /Booking Reference:|Booking:/i.test(b));
}

function parseOneBlock(block) {
  const isGyg = /^Booking:\s*[A-Z0-9]/im.test(block) && !/Booking Reference:/i.test(block);
  return isGyg ? parseGyg(block) : parseViator(block);
}

function parseViator(block) {
  const g = (re) => { const m = block.match(re); return m ? m[1].trim() : ''; };
  const reference = g(/Booking Reference:\s*(.+)/i);
  if (!reference) return null;
  const tourName = g(/Tour Name:\s*(.+)/i);
  const travelRaw = g(/Travel Date:\s*(.+)/i);
  const lead = g(/Lead Traveler Name:\s*(.+)/i);
  const namesRaw = g(/Traveler Names:\s*(.+)/i);
  const travelersRaw = g(/Travelers:\s*(.+)/i);
  const productCode = g(/Product Code:\s*(.+)/i);
  const tourGrade = g(/Tour Grade:\s*(.+)/i);
  const tourGradeCode = g(/Tour Grade Code:\s*(.+)/i);
  const bookingType = /LATE BOOKING|LAST MINUTE|VIP/i.test(tourGrade) ? 'last_minute' : 'regular';
  // pax counts from "2 Adults" / "2 Adults, 1 Child"
  let adults = 0, children = 0, infants = 0;
  (travelersRaw.match(/(\d+)\s*Adult/i) || []).forEach && (adults = parseInt((travelersRaw.match(/(\d+)\s*Adult/i) || [])[1] || 0, 10));
  children = parseInt((travelersRaw.match(/(\d+)\s*Child/i) || [])[1] || 0, 10);
  infants = parseInt((travelersRaw.match(/(\d+)\s*Infant/i) || [])[1] || 0, 10);
  const names = namesRaw ? namesRaw.split(',').map((s) => s.trim()).filter(Boolean) : (lead ? [lead] : []);
  // Time from the tour grade — accept HH:MM (24h) or H:MM AM/PM.
  const customerTime = to24h((tourGrade.match(/(\d{1,2}:\d{2}\s*[AP]M)/i) || tourGrade.match(/(\d{1,2}:\d{2})/) || [])[1]);
  const bookedTime = customerTime;                 // shown "Booked" = customer time
  const suggestedTicketTime = plus15(customerTime); // default entry time (customer +15)
  const d = normDate(travelRaw);
  const travelers = names.map((n, i) => { const { firstName, lastName } = splitName(n); return { sn: i + 1, type: i < adults ? 'Adult' : (i < adults + children ? 'Child' : 'Infant'), index: i + 1, firstName, lastName, dob: '' }; });
  if (!travelers.length && (adults + children + infants) > 0) { for (let i = 0; i < adults + children + infants; i++) travelers.push({ sn: i + 1, type: i < adults ? 'Adult' : 'Child', index: i + 1, firstName: i === 0 ? splitName(lead).firstName : '', lastName: i === 0 ? splitName(lead).lastName : '', dob: '' }); }
  return {
    source: sourceFromRef(reference) || 'viator', bookingType, reference, tourName, travelDate: d.iso, travelDateLabel: d.label,
    leadTraveler: lead, adults, children, infants, pax: adults + children + infants || travelers.length,
    productCode, tourGrade, tourGradeCode, customerTime, bookedTime, suggestedTicketTime, productName: productName(bookingType, customerTime),
    travelers,
  };
}

function parseGyg(block) {
  const reference = (block.match(/Booking:\s*([A-Z0-9]+)/i) || [])[1] || '';
  if (!reference) return null;
  const lines = block.split('\n').map((l) => l.trim());
  // Tour name = the line after "Booking: XXX" that isn't a label.
  const tourName = (block.match(/Booking:\s*[A-Z0-9]+\s*\n(.+)/i) || [])[1] || '';
  const bookingType = /Last Minute|VIP/i.test(block) ? 'last_minute' : 'regular';
  // date/time "Sep 22, 2026 9:30 AM"
  const dtMatch = block.match(/([A-Za-z]{3}\.?\s+\d{1,2},?\s+\d{4})\s+(\d{1,2}:\d{2}\s*[AP]M)/i);
  const d = normDate(dtMatch ? dtMatch[1] : '');
  const customerTime = to24h(dtMatch ? dtMatch[2] : '');
  const bookedTime = customerTime;
  const suggestedTicketTime = plus15(customerTime);
  // lead traveler: the line after "Lead traveler"
  let lead = '';
  const li = lines.findIndex((l) => /^Lead traveler/i.test(l));
  if (li >= 0) lead = lines[li + 1] || '';
  // participants
  const adults = parseInt((block.match(/(\d+)\s*Adults?/i) || [])[1] || 0, 10);
  const children = parseInt((block.match(/(\d+)\s*Child/i) || [])[1] || 0, 10);
  // traveler info: "Traveler 1: First Name: X Last Name: Y Date of Birth: ..."
  const travelers = [];
  const travRe = /Traveler\s+\d+:\s*First Name:\s*(.+?)\s+Last Name:\s*(.+?)(?:\s+Date of Birth:\s*([\d-]+))?(?=\s+Traveler\s+\d+:|$)/gi;
  let tm; let idx = 0;
  while ((tm = travRe.exec(block.replace(/\n/g, ' '))) !== null) {
    idx++;
    const dob = tm[3] || '';
    // adult vs child by DOB (<18 = child)
    let type = idx <= adults ? 'Adult' : 'Child';
    if (dob) { const age = (Date.now() - new Date(dob).getTime()) / (365.25 * 864e5); type = age < 18 ? 'Child' : 'Adult'; }
    travelers.push({ sn: idx, type, index: idx, firstName: tm[1].trim(), lastName: tm[2].trim(), dob });
  }
  const language = (block.match(/Audio guide:\s*(.+)/i) || [])[1] || (block.match(/Languages?\s*\n\s*(.+)/i) || [])[1] || '';
  const phone = (block.match(/(\+\d[\d\s]{7,})/) || [])[1] || '';
  const email = (block.match(/([\w.+-]+@[\w.-]+\.\w+)/) || [])[1] || '';
  return {
    source: sourceFromRef(reference) || 'gyg', bookingType, reference, tourName: tourName.trim(), travelDate: d.iso, travelDateLabel: d.label,
    leadTraveler: lead, adults: adults || travelers.filter((t) => t.type === 'Adult').length, children: children || travelers.filter((t) => t.type === 'Child').length, infants: 0,
    pax: (adults + children) || travelers.length, customerTime, bookedTime, suggestedTicketTime, productName: productName(bookingType, customerTime),
    phone: phone.trim(), email, language: (language || '').trim(), travelers,
  };
}

// Public: parse via AI if available, else regex. Always returns normalized rows.
async function parseBookings(text, keys) {
  let rows = [];
  if (keys && (keys.openai || keys.anthropic)) {
    try {
      const system = 'You extract travel ticket bookings from pasted Viator or GetYourGuide confirmation text. There may be MULTIPLE bookings. Return ONLY a JSON array; each item: {"source":"viator|gyg|direct|other","bookingType":"regular|last_minute","reference":"","tourName":"","travelDateLabel":"e.g. Mon, Sep 21, 2026","customerTime":"HH:MM 24h","leadTraveler":"","adults":n,"children":n,"infants":n,"phone":"","email":"","language":"","travelers":[{"type":"Adult|Child|Infant","firstName":"","lastName":"","dob":"YYYY-MM-DD or empty"}]}. bookingType is last_minute if the text says LATE BOOKING / LAST MINUTE / VIP, else regular. Use DOB to decide Child (<18) vs Adult when present. Do not invent data.';
      const out = await require('./aiVisibility').callAI({ anthropicKey: keys.anthropic, openaiKey: keys.openai, preferOpenai: true, system, messages: [{ role: 'user', content: String(text).slice(0, 12000) }], maxTokens: 3000 });
      const m = String(out || '').match(/\[[\s\S]*\]/);
      const arr = m ? JSON.parse(m[0]) : null;
      if (Array.isArray(arr) && arr.length) rows = arr.map(normalizeAiRow);
    } catch { rows = []; }
  }
  if (!rows.length) rows = regexParse(text);
  return rows.filter((r) => r && r.reference);
}

function normalizeAiRow(r) {
  const bookingType = r.bookingType === 'last_minute' ? 'last_minute' : 'regular';
  const customerTime = to24h(r.customerTime) || r.customerTime || null;
  const bookedTime = customerTime;
  const suggestedTicketTime = plus15(customerTime);
  const d = r.travelDateLabel ? normDate(r.travelDateLabel) : { iso: r.travelDate || null, label: r.travelDateLabel || null };
  const adults = Number(r.adults) || 0, children = Number(r.children) || 0, infants = Number(r.infants) || 0;
  const travelers = (Array.isArray(r.travelers) ? r.travelers : []).map((t, i) => { const { firstName, lastName } = t.lastName ? { firstName: t.firstName || '', lastName: String(t.lastName).replace(/\s*\([^)]*\)\s*$/, '') } : splitName(`${t.firstName || ''}`); return { sn: i + 1, type: t.type || 'Adult', index: i + 1, firstName: firstName || t.firstName || '', lastName, dob: t.dob || '' }; });
  return {
    source: sourceFromRef(r.reference) || (['viator', 'gyg', 'direct', 'other'].includes(r.source) ? r.source : 'other'),
    bookingType, reference: r.reference, tourName: r.tourName || '', travelDate: d.iso, travelDateLabel: d.label,
    leadTraveler: r.leadTraveler || (travelers[0] ? `${travelers[0].firstName} ${travelers[0].lastName}`.trim() : ''),
    adults, children, infants, pax: (adults + children + infants) || travelers.length,
    phone: r.phone || '', email: r.email || '', language: r.language || '',
    customerTime, bookedTime, suggestedTicketTime, productName: productName(bookingType, customerTime), travelers,
  };
}

module.exports = { parseBookings, productName, plus15, to24h };

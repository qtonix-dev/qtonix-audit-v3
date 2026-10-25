// ---------------------------------------------------------------------------
// Data Cleanup — validate WHOIS registrant phone numbers for a US/Canada list.
//
// WHOIS exports for newly registered domains carry a lot of junk phone numbers:
// 9-digit numbers (a digit dropped), toll-free numbers, and numbers that are
// not US/Canada at all. This flags each row so the UI can highlight the bad
// ones in red and the admin can download a cleaned file with them removed.
//
// Validation is DETERMINISTIC (North American Numbering Plan rules), not AI:
// the rules are strict digit/area-code checks, and running an LLM over hundreds
// of rows would be slower, costlier, and less reliable than the NANP spec.
// ---------------------------------------------------------------------------

// Toll-free area codes (NANP SMS/800 service). These are never a real
// registrant's direct line, so we exclude them.
const TOLL_FREE = new Set(['800', '833', '844', '855', '866', '877', '888',
  // Reserved/also-toll-free in the 8YY range.
  '822', '880', '881', '882', '883', '884', '885', '886', '887', '889']);

// Country labels (case-insensitive) that count as NANP US/Canada for this list.
const US_CA = new Set(['united states', 'usa', 'us', 'u.s.', 'u.s.a.', 'america',
  'canada', 'ca', 'can']);

// Keep only digits.
function digits(s) { return String(s == null ? '' : s).replace(/\D+/g, ''); }

// Normalise a raw phone to its 10-digit NANP national number, or null.
// Accepts an optional leading country code '1'. 10 digits → as is; 11 digits
// starting with 1 → drop the 1. Anything else → null (wrong length).
function toNanp10(raw) {
  let d = digits(raw);
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  if (d.length !== 10) return null;
  return d;
}

// NANP area code (NPA) and exchange (NXX) validity: the first digit of each
// must be 2–9 (N), and 'N11' service codes (211..911) are not area codes.
function nanpValid(ten) {
  if (!/^\d{10}$/.test(ten)) return false;
  const npa = ten.slice(0, 3);
  const nxx = ten.slice(3, 6);
  if (!/^[2-9]/.test(npa)) return false;         // area code can't start 0/1
  if (!/^[2-9]/.test(nxx)) return false;         // exchange can't start 0/1
  if (npa[1] === '1' && npa[2] === '1') return false; // N11 (e.g. 911) not an NPA
  return true;
}

// Obvious fake / placeholder numbers people type into WHOIS. These dial but
// never connect, so they tank dialer connectivity. We detect them by shape on
// the 10-digit national number:
//  - all one digit (0000000000, 9999999999)
//  - a strictly ascending or descending run (1234567890, 0123456789)
//  - a repeated short block (5037000000 → 503 + 7 zeros; 1231231231)
//  - known test/placeholder numbers (555-0100..0199 range, 1234567890)
function looksFake(ten) {
  if (!/^\d{10}$/.test(ten)) return false;
  if (/^(\d)\1{9}$/.test(ten)) return true;                 // all same digit
  if (ten === '1234567890' || ten === '0123456789') return true;
  if (ten === '9876543210') return true;
  // Trailing run of 5+ identical digits (e.g. 5037000000, 4155550000).
  if (/(\d)\1{5,}$/.test(ten)) return true;
  // 555-01xx directory-assistance / fictional range (NXX 555, line 0100-0199).
  if (ten.slice(3, 6) === '555' && ten.slice(6, 8) === '01') return true;
  return false;
}

// Validate one row's phone. Returns:
//   { ok, reasons:[...], normalized, digitsLen }
// reasons ⊂ { 'toll_free','short_9_digit','wrong_length','not_us_canada','fake' }.
// ('duplicate' is added later, across rows, by the route — not here.)
function validatePhone(rawPhone, countryRaw) {
  const reasons = [];
  const raw = String(rawPhone == null ? '' : rawPhone).trim();
  const d = digits(raw);

  // Country check first (independent of the number itself). Blank country is
  // not treated as a failure on its own — the number rules decide.
  const country = String(countryRaw == null ? '' : countryRaw).trim().toLowerCase();
  const countryKnownNonNA = country && !US_CA.has(country);
  if (countryKnownNonNA) reasons.push('not_us_canada');

  if (!d) { reasons.push('wrong_length'); return { ok: false, reasons, normalized: null, digitsLen: 0 }; }

  // Length: a dropped digit gives 9 (the common WHOIS defect); call that out
  // specifically. Any other non-10 (and non-11-with-1) length is 'wrong_length'.
  const ten = toNanp10(d);
  if (!ten) {
    if (d.length === 9) reasons.push('short_9_digit');
    else reasons.push('wrong_length');
    return { ok: false, reasons, normalized: null, digitsLen: d.length };
  }

  const npa = ten.slice(0, 3);
  if (TOLL_FREE.has(npa)) reasons.push('toll_free');
  // A structurally invalid NANP number isn't a real US/Canada line.
  if (!nanpValid(ten) && !reasons.includes('not_us_canada')) reasons.push('not_us_canada');
  // Placeholder / fake numbers that will never connect.
  if (looksFake(ten)) reasons.push('fake');

  return { ok: reasons.length === 0, reasons, normalized: ten, digitsLen: d.length };
}

const REASON_LABELS = {
  toll_free: 'Toll-free number',
  short_9_digit: '9-digit number (missing a digit)',
  wrong_length: 'Not a valid 10-digit number',
  not_us_canada: 'Not a USA/Canada number',
  fake: 'Fake / placeholder number',
  duplicate: 'Duplicate number',
  seen_before: 'Duplicate number',
  // Soft signals (flag by default, don't hard-exclude unless the admin opts in).
  area_state_mismatch: 'Area code doesn’t match the state',
  fake_name: 'Suspicious registrant name',
  disposable_email: 'Disposable / hidden-identity email',
};

// Reasons that HARD-exclude a number by default (structural junk). The soft
// signals above are advisory and only exclude when the admin turns them on.
const HARD_REASONS = new Set(['toll_free', 'short_9_digit', 'wrong_length', 'not_us_canada', 'fake', 'duplicate', 'seen_before']);

const { NPA_STATE, DISPOSABLE_EMAIL, normState } = require('./npaState');

// Does the number's area code match the registrant's state? Returns:
//   true  = matches, false = clearly mismatched, null = can't tell (unknown NPA
//   or blank state) — null never flags.
function areaMatchesState(ten, stateRaw) {
  if (!/^\d{10}$/.test(ten)) return null;
  const st = normState(stateRaw);
  if (!st) return null;
  const npaSt = NPA_STATE[parseInt(ten.slice(0, 3), 10)];
  if (!npaSt) return null;        // non-geographic / unknown NPA — don't judge
  return npaSt === st;
}

// A registrant name that looks fake/placeholder.
function nameLooksFake(nameRaw) {
  const n = String(nameRaw || '').trim();
  if (!n) return false;           // blank name handled elsewhere, not "fake"
  const low = n.toLowerCase();
  if (/^(test|asdf|qwerty|abc|xyz|na|n\/a|none|null|unknown|admin|user|aaa+)\b/.test(low)) return true;
  if (/^[a-z]{1,2}$/i.test(n)) return true;                 // 1–2 letters
  if (/^\d+$/.test(n.replace(/\s/g, ''))) return true;      // all digits
  if (/(.)\1{3,}/i.test(n.replace(/\s/g, ''))) return true; // 4+ repeated chars (aaaa)
  // A single "word" with no vowels and 4+ chars (e.g. "xkcdd") → gibberish.
  const words = n.split(/\s+/);
  if (words.length === 1 && n.length >= 4 && !/[aeiou]/i.test(n)) return true;
  return false;
}

// Disposable / hidden-identity email (Apple Private Relay counts as hidden).
function emailIsDisposable(emailRaw) {
  const e = String(emailRaw || '').trim().toLowerCase();
  const dom = e.includes('@') ? e.split('@').pop() : '';
  if (!dom) return false;
  if (dom === 'privaterelay.appleid.com') return true;      // hidden identity
  return DISPOSABLE_EMAIL.has(dom);
}

// Apply the three soft signals to an already-validated phone result, given the
// registrant's state/name/email. Mutates nothing; returns extra reason codes.
function softSignals({ normalized, state, name, email }) {
  const extra = [];
  if (normalized) {
    const m = areaMatchesState(normalized, state);
    if (m === false) extra.push('area_state_mismatch');
  }
  if (nameLooksFake(name)) extra.push('fake_name');
  if (emailIsDisposable(email)) extra.push('disposable_email');
  return extra;
}

// Pick the phone + country columns from a header row, tolerating variations.
function pickColumns(headers) {
  const norm = (h) => String(h || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const idx = { phone: -1, country: -1 };
  headers.forEach((h, i) => {
    const n = norm(h);
    if (idx.phone < 0 && (n === 'registrant_phone' || n.includes('phone') || n.includes('mobile') || n === 'tel')) idx.phone = i;
    if (idx.country < 0 && (n === 'registrant_country' || n === 'country')) idx.country = i;
  });
  return idx;
}

// Extend column picker to also find name / state / email columns.
function pickColumnsFull(headers) {
  const base = pickColumns(headers);
  const norm = (h) => String(h || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const idx = { ...base, name: -1, state: -1, email: -1 };
  headers.forEach((h, i) => {
    const n = norm(h);
    if (idx.name < 0 && (n === 'registrant_name' || n === 'name' || n.includes('registrant_name'))) idx.name = i;
    if (idx.state < 0 && (n === 'registrant_state' || n === 'state' || n === 'region')) idx.state = i;
    if (idx.email < 0 && (n === 'registrant_email' || n === 'email')) idx.email = i;
  });
  return idx;
}

module.exports = {
  validatePhone, looksFake, REASON_LABELS, HARD_REASONS, pickColumns, pickColumnsFull,
  softSignals, areaMatchesState, nameLooksFake, emailIsDisposable,
  toNanp10, nanpValid, digits, TOLL_FREE, US_CA,
};

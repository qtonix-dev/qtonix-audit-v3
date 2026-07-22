/**
 * Timezone helpers.
 *
 * Lead timezones are stored as display strings like "GMT-5 (EST)" or
 * "GMT+5:30 (IST)". Our staff are all in India, so IST (GMT+5:30) is the fixed
 * reference for the office-side view of any scheduled call.
 *
 * Everything here works on plain UTC offsets in minutes. That deliberately
 * ignores daylight saving — the stored strings are fixed offsets, so treating
 * them literally is the honest behaviour. Anything smarter would need a real
 * tz database and an IANA zone name per lead.
 */

export const IST_OFFSET_MIN = 5 * 60 + 30; // GMT+5:30
export const IST_LABEL = 'IST (GMT+5:30)';

/**
 * Parse "GMT-5 (EST)" / "GMT+5:30" / "GMT+0" into offset minutes from UTC.
 * Returns null when the string can't be understood.
 */
export function parseOffsetMinutes(tz) {
  if (!tz) return null;
  const m = String(tz).match(/GMT\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?/i);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const hours = parseInt(m[2], 10) || 0;
  const mins = m[3] ? parseInt(m[3], 10) : 0;
  return sign * (hours * 60 + mins);
}

/** Short label for a timezone string, e.g. "EST" from "GMT-5 (EST)". */
export function tzShortLabel(tz) {
  if (!tz) return '';
  const m = String(tz).match(/\(([^)]+)\)/);
  return m ? m[1] : String(tz).trim();
}

/**
 * Current wall-clock time in the given timezone.
 * @returns {{ time:string, date:string, hour:number, offsetMin:number }|null}
 */
export function nowInZone(tz) {
  const off = parseOffsetMinutes(tz);
  if (off === null) return null;
  const utcMs = Date.now() + new Date().getTimezoneOffset() * 60000;
  const d = new Date(utcMs + off * 60000);
  return {
    time: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    date: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
    hour: d.getHours(),
    offsetMin: off,
  };
}

/**
 * Is it a sensible hour to call? Used to warn agents before they dial.
 * Business hours are treated as 08:00–20:00 local.
 */
export function callWindow(hour) {
  if (hour == null) return null;
  if (hour >= 8 && hour < 20) return { ok: true, label: 'Good time to call' };
  if (hour >= 20 && hour < 23) return { ok: false, label: 'Late evening — avoid calling' };
  return { ok: false, label: 'Night hours — do not call' };
}

/**
 * Convert a local date+time in the lead's zone into the equivalent IST time.
 * @param {string} date - "YYYY-MM-DD"
 * @param {string} time - "HH:MM"
 * @param {string} leadTz - the lead's timezone string
 * @returns {{ date:string, time:string, dayShift:string }|null}
 */
export function toIST(date, time, leadTz) {
  const off = parseOffsetMinutes(leadTz);
  if (off === null || !date || !time) return null;
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  if ([y, mo, d, h, mi].some((n) => Number.isNaN(n))) return null;

  // Interpret the entered wall-clock time as being in the lead's zone, convert
  // to UTC, then re-express in IST.
  const utcMs = Date.UTC(y, mo - 1, d, h, mi) - off * 60000;
  const ist = new Date(utcMs + IST_OFFSET_MIN * 60000);

  // Flag when the IST equivalent lands on a different calendar day.
  const sameDay = ist.getUTCDate() === d && ist.getUTCMonth() === mo - 1;
  const dayShift = sameDay ? '' : (utcMs + IST_OFFSET_MIN * 60000 > Date.UTC(y, mo - 1, d, 23, 59) ? ' (next day)' : ' (previous day)');

  return {
    date: `${String(ist.getUTCDate()).padStart(2, '0')} ${ist.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`,
    time: `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`,
    dayShift,
  };
}

/** Days between today and an ISO date string; negative means overdue. */
export function daysUntil(isoDate) {
  if (!isoDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(isoDate);
  if (Number.isNaN(target.getTime())) return null;
  target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

/** Human phrasing for a due date: "in 5 days", "today", "3 days overdue". */
export function dueLabel(isoDate) {
  const n = daysUntil(isoDate);
  if (n === null) return '';
  if (n === 0) return 'due today';
  if (n === 1) return 'due tomorrow';
  if (n > 1) return `in ${n} days`;
  if (n === -1) return '1 day overdue';
  return `${Math.abs(n)} days overdue`;
}

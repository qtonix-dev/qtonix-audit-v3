/**
 * Shift-aware time boundaries for sales attribution.
 *
 * The night shift ends at 6 AM, so a business "day" (and therefore "month")
 * runs until 6 AM the next calendar day. A sale timestamped 5:59 AM on the 1st
 * belongs to the PREVIOUS day/month; a sale at 6:01 AM starts the new one.
 *
 * Implementation: shift any instant back by `cutoffHour` hours, then read its
 * calendar day/month normally. Everything works in IST (the office timezone),
 * so we also offset for the +5:30 zone when deriving the wall-clock date.
 *
 * All the sales/dashboard/target/trend logic funnels through here so the rule
 * is applied consistently in one place.
 */

const IST_OFFSET_MS = 330 * 60000; // +5:30

// Read the configured cutoff hour (default 6). Callers pass the Settings row (or
// its salesConfig) so we don't hit the DB on every call in a tight loop.
function cutoffHour(settingsOrConfig) {
  const cfg = settingsOrConfig && (settingsOrConfig.salesConfig || settingsOrConfig);
  const h = cfg && Number(cfg.shiftCutoffHour);
  return Number.isFinite(h) && h >= 0 && h < 24 ? h : 6;
}

// The "business instant" for a real instant: shift back by the cutoff so the
// pre-cutoff early-morning window maps onto the previous day. Returns a Date
// whose calendar Y/M/D (in IST) is the business day the instant belongs to.
function businessInstant(ms, hour) {
  // Convert to IST wall clock, subtract the cutoff, keep as an IST-wall Date.
  return new Date(ms + IST_OFFSET_MS - hour * 3600000);
}

// Business day key 'YYYY-MM-DD' for an instant (ms epoch).
function businessDayKey(ms, hour) {
  const d = businessInstant(ms, hour);
  return d.toISOString().slice(0, 10);
}
// Business month key 'YYYY-MM'.
function businessMonthKey(ms, hour) {
  return businessDayKey(ms, hour).slice(0, 7);
}

// Given "now" (ms) and the cutoff, return the UTC-epoch boundaries of the
// CURRENT business day / month as real instants you can compare timestamps to.
//   startOfBusinessDay  = cutoffHour:00 IST on the current business day's date
//   startOfBusinessMonth= cutoffHour:00 IST on the 1st of the business month
// These are returned as epoch ms (UTC) so `saleMs >= startOfBusinessMonthMs`
// works directly against stored ISO timestamps.
function boundaries(nowMs, hour) {
  const bi = businessInstant(nowMs, hour);              // IST-wall, shifted
  const y = bi.getUTCFullYear(), m = bi.getUTCMonth(), day = bi.getUTCDate();
  // Reconstruct the real UTC instant of "cutoffHour:00 IST on that date".
  const startDayIstWallMs = Date.UTC(y, m, day, hour, 0, 0);      // wall time as if UTC
  const startMonthIstWallMs = Date.UTC(y, m, 1, hour, 0, 0);
  return {
    // subtract the IST offset to get the true UTC instant
    startOfDayMs: startDayIstWallMs - IST_OFFSET_MS,
    startOfMonthMs: startMonthIstWallMs - IST_OFFSET_MS,
    year: y, month: m,
    monthKey: `${y}-${String(m + 1).padStart(2, '0')}`,
  };
}

// Boundaries for the business month that is `offset` months before the current
// one (offset 0 = current). Used by the 6-month trend and targets.
function monthBoundaries(nowMs, hour, offset) {
  const bi = businessInstant(nowMs, hour);
  const y = bi.getUTCFullYear(), m = bi.getUTCMonth();
  const startWall = Date.UTC(y, m - offset, 1, hour, 0, 0);
  const endWall = Date.UTC(y, m - offset + 1, 1, hour, 0, 0);
  const s = new Date(startWall - IST_OFFSET_MS);
  return {
    startMs: startWall - IST_OFFSET_MS,
    endMs: endWall - IST_OFFSET_MS,
    year: s.getUTCFullYear(),
    month: s.getUTCMonth(),
    monthKey: `${s.getUTCFullYear()}-${String(s.getUTCMonth() + 1).padStart(2, '0')}`,
    label: s.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
  };
}

// Resolve a sale's timestamp (ms) from an installment: prefer the precise
// paidAt, fall back to paidDate (date-only → treated as noon so it lands
// squarely inside its own day regardless of cutoff).
function saleMs(inst, deal) {
  if (inst && inst.paidAt) { const t = new Date(inst.paidAt).getTime(); if (!Number.isNaN(t)) return t; }
  if (deal && deal.wonAt) { const t = new Date(deal.wonAt).getTime(); if (!Number.isNaN(t)) return t; }
  if (inst && inst.paidDate) { const t = new Date(`${inst.paidDate}T12:00:00`).getTime(); if (!Number.isNaN(t)) return t; }
  return 0;
}

module.exports = { cutoffHour, businessInstant, businessDayKey, businessMonthKey, boundaries, monthBoundaries, saleMs, IST_OFFSET_MS };

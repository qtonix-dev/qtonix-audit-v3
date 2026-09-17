/**
 * Biometric attendance parsing + HRMS comparison.
 *
 * Device .dat format (ESSL): tab-separated, one punch per line —
 *   <userId>\t<YYYY-MM-DD HH:MM:SS>\t<state>\t...
 * Converted .xlsx: a "Raw Log" sheet with columns User ID / Date / Time / Timestamp,
 * or any sheet whose first two columns are a user id and a timestamp.
 *
 * Everything is grouped into: { [deviceId]: { [YYYY-MM-DD]: ["HH:MM:SS", ...] } }
 */

const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
function monToIso(dd, mon, yyyy) { const m = MONTHS[String(mon).toLowerCase().slice(0, 3)]; if (!m) return null; return `${yyyy}-${m}-${String(dd).padStart(2, '0')}`; }

// Parse a raw .dat buffer/string → grouped punches.
function parseDat(text) {
  const byDev = {};
  let min = null, max = null, count = 0;
  const lines = String(text).split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = line.split('\t').map((c) => c.trim());
    if (cols.length < 2) continue;
    const dev = cols[0];
    const ts = cols[1]; // "YYYY-MM-DD HH:MM:SS"
    const m = ts.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
    if (!dev || !m) continue;
    const date = m[1], time = m[2];
    (byDev[dev] = byDev[dev] || {});
    (byDev[dev][date] = byDev[dev][date] || []).push(time);
    if (!min || date < min) min = date;
    if (!max || date > max) max = date;
    count++;
  }
  return finalize(byDev, min, max, count);
}

// Parse an .xlsx (via SheetJS workbook already read) → grouped punches.
// Accepts the workbook's first sheet that looks like a raw punch log.
function parseWorkbook(XLSX, workbook) {
  const byDev = {};
  let min = null, max = null, count = 0;
  // Prefer a sheet literally named Raw Log; else scan every sheet.
  const names = workbook.SheetNames;
  const ordered = [...names.filter((n) => /raw/i.test(n)), ...names.filter((n) => !/raw/i.test(n))];
  for (const name of ordered) {
    const ws = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
    let took = 0;
    for (const r of rows) {
      if (!r || r.length < 2) continue;
      const dev = String(r[0] == null ? '' : r[0]).trim();
      if (!dev || /user\s*id/i.test(dev)) continue;
      // Find a date + time anywhere in the row (supports ISO and DD-Mon-YYYY).
      let date = null, time = null;
      for (const cell of r) {
        const s = String(cell == null ? '' : cell).trim();
        if (!s) continue;
        // ISO datetime
        let m = s.match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
        if (m) { date = m[1]; time = m[2]; break; }
        // DD-Mon-YYYY [HH:MM:SS]
        m = s.match(/(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})(?:[ T](\d{2}:\d{2}:\d{2}))?/);
        if (m) { const iso = monToIso(m[1], m[2], m[3]); if (iso) { date = iso; if (m[4]) time = m[4]; } continue; }
        // bare time / bare ISO date
        const t = s.match(/^(\d{2}:\d{2}:\d{2})$/); if (t && !time) { time = t[1]; continue; }
        const d = s.match(/^(\d{4}-\d{2}-\d{2})$/); if (d && !date) { date = d[1]; continue; }
      }
      if (!dev || !date || !time) continue;
      (byDev[dev] = byDev[dev] || {});
      (byDev[dev][date] = byDev[dev][date] || []).push(time);
      if (!min || date < min) min = date;
      if (!max || date > max) max = date;
      count++; took++;
    }
    if (took > 0) break; // first sheet that yielded punches wins
  }
  return finalize(byDev, min, max, count);
}

function finalize(byDev, min, max, count) {
  // Sort each day's times ascending.
  for (const dev of Object.keys(byDev)) for (const d of Object.keys(byDev[dev])) byDev[dev][d].sort();
  return { data: byDev, minDate: min, maxDate: max, punchCount: count, deviceIdCount: Object.keys(byDev).length };
}

// --- time helpers ---
const toMin = (hms) => { if (!hms) return null; const [h, m] = String(hms).split(':').map(Number); return h * 60 + (m || 0); };
const fmtHM = (mins) => mins == null ? '—' : `${Math.floor(Math.abs(mins) / 60)}h ${String(Math.round(Math.abs(mins) % 60)).padStart(2, '0')}m`;
const hhmm = (hms) => hms ? String(hms).slice(0, 5) : null;

// Gross shift minutes (end - start, crossing midnight aware). No break subtraction.
function shiftGrossMinutes(shift) {
  if (!shift || !shift.startTime || !shift.endTime) return null;
  let s = toMin(shift.startTime), e = toMin(shift.endTime);
  if (e <= s) e += 1440;
  return e - s;
}

/**
 * Build the per-employee comparison for a date range.
 * emps: [{ id, name, deviceId, department, shift, wfhDates:Set, hrmsByDate:{date:{login,logout,status}} }]
 * punches: { [deviceId]: { [date]: [times] } }
 * Returns { rows, unmatchedDeviceIds, dates }
 */
function buildComparison({ emps, punches, from, to, gapMin = 15, workdayCheck }) {
  const inRange = (d) => (!from || d >= from) && (!to || d <= to);
  // All dates in range that appear in either source.
  const dateSet = new Set();
  for (const dev of Object.keys(punches)) for (const d of Object.keys(punches[dev])) if (inRange(d)) dateSet.add(d);
  const usedDevs = new Set(emps.map((e) => e.deviceId).filter(Boolean));
  const unmatchedDeviceIds = Object.keys(punches).filter((dev) => !usedDevs.has(dev));

  const rows = emps.map((e) => {
    const shiftMin = shiftGrossMinutes(e.shift) || 8 * 60; // fall back to 8h if no shift
    const bio = (e.deviceId && punches[e.deviceId]) || {};
    // Union of dates for this employee (bio + hrms) within range.
    const days = new Set();
    for (const d of Object.keys(bio)) if (inRange(d)) days.add(d);
    for (const d of Object.keys(e.hrmsByDate || {})) if (inRange(d)) days.add(d);
    const dayRows = [];
    let totalWorked = 0, totalTarget = 0, presentDays = 0, missingOut = 0, gaps = 0, reviewFlags = 0;
    for (const d of [...days].sort()) {
      const isWfh = e.wfhDates && e.wfhDates.has(d);
      const times = bio[d] || [];
      const bioIn = times.length ? times[0] : null;
      const bioOut = times.length > 1 ? times[times.length - 1] : null;
      const hrms = (e.hrmsByDate && e.hrmsByDate[d]) || null;
      const hrmsIn = hrms && hrms.login ? hrms.login : null;
      const hrmsOut = hrms && hrms.logout ? hrms.logout : null;
      // Skip pure non-working HRMS states (holiday/week_off/leave) from deficit.
      const nonWorking = hrms && ['holiday', 'week_off', 'leave'].includes(hrms.status);

      // Worked minutes from each source.
      const bioWorked = (bioIn && bioOut) ? (toMin(bioOut) - toMin(bioIn)) : null;
      const hrmsWorked = (hrmsIn && hrmsOut) ? (toMin(hrmsOut) - toMin(hrmsIn)) : null;

      let worked = null, source = null, highlight = false;
      if (isWfh) { worked = hrmsWorked; source = 'hrms-wfh'; }
      else if (bioWorked != null && hrmsWorked != null) {
        // higher of the two, highlighted when they differ meaningfully.
        worked = Math.max(bioWorked, hrmsWorked); source = bioWorked >= hrmsWorked ? 'bio' : 'hrms';
        if (Math.abs(bioWorked - hrmsWorked) >= gapMin) highlight = true;
      } else if (bioWorked != null) { worked = bioWorked; source = 'bio-only'; highlight = !!hrms === false; }
      else if (hrmsWorked != null) { worked = hrmsWorked; source = 'hrms-only'; }

      // Flags.
      const flags = [];
      if (!isWfh && bioIn && !bioOut) { flags.push('missing_out'); missingOut++; reviewFlags++; }
      if (bioIn && hrmsIn && Math.abs(toMin(bioIn) - toMin(hrmsIn)) >= gapMin) { flags.push('in_gap'); gaps++; }
      if (bioOut && hrmsOut && Math.abs(toMin(bioOut) - toMin(hrmsOut)) >= gapMin) { flags.push('out_gap'); gaps++; }
      if (!isWfh && times.length && !hrms) flags.push('no_hrms');
      if (!isWfh && !times.length && hrms && !nonWorking) flags.push('no_biometric');
      if (highlight) reviewFlags++;

      if (!nonWorking && (worked != null || times.length || (hrms && hrms.status === 'present'))) {
        presentDays++;
        totalTarget += shiftMin;
        totalWorked += (worked || 0);
      }
      dayRows.push({
        date: d, wfh: !!isWfh, status: hrms ? hrms.status : (times.length ? 'present' : null),
        bioIn: hhmm(bioIn), bioOut: hhmm(bioOut), hrmsIn: hhmm(hrmsIn), hrmsOut: hhmm(hrmsOut),
        punches: times.length, worked, workedLabel: worked == null ? '—' : (worked / 60).toFixed(2) + 'h',
        source, highlight, target: shiftMin, deficit: (worked == null ? null : worked - shiftMin), flags,
      });
    }
    const deficit = totalWorked - totalTarget;
    return {
      employeeId: e.id, name: e.name, deviceId: e.deviceId || null, department: e.department || '',
      matched: !!e.deviceId, shiftLabel: e.shift ? `${e.shift.startTime}–${e.shift.endTime}` : 'no shift', shiftMin,
      presentDays, totalWorkedMin: totalWorked, totalTargetMin: totalTarget, deficitMin: deficit,
      totalWorkedLabel: fmtHM(totalWorked), totalTargetLabel: fmtHM(totalTarget),
      deficitLabel: (deficit < 0 ? '-' : '+') + fmtHM(deficit), inDeficit: deficit < -1,
      avgHours: presentDays ? (totalWorked / presentDays / 60).toFixed(2) : '0',
      missingOut, gaps, needsReview: reviewFlags, days: dayRows,
    };
  });
  return { rows, unmatchedDeviceIds, dates: [...dateSet].sort() };
}

module.exports = { parseDat, parseWorkbook, buildComparison, shiftGrossMinutes, fmtHM };

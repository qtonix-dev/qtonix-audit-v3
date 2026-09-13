/**
 * WORKING DAYS — resolves whether a given date is an OFF day (week-off or
 * holiday) for a branch, using the HR Policy weekOff rules + HrHoliday table.
 * Used by the Team/Daily reports so weekends & holidays show "Off" and are not
 * analyzed.
 *
 * weekOff rule types (from HR Policy):
 *   all_sundays   → Sundays off (default)
 *   sat_sun       → all Saturdays + Sundays off   (Kolkata)
 *   alt_sat_sun   → 2nd & 4th Saturday + Sundays   (Bhubaneswar)
 *   custom        → { days: [0..6] }
 */
const { Settings, HrHoliday } = require('../models');

const DEFAULT_RULE = { type: 'all_sundays' };

function ruleForBranch(policy, branch) {
  const byBranch = (policy.weekOff && policy.weekOff.byBranch) || {};
  // Match branch case-insensitively.
  if (branch) { for (const k of Object.keys(byBranch)) if (String(k).toLowerCase() === String(branch).toLowerCase()) return byBranch[k]; }
  return (policy.weekOff && policy.weekOff.default) || DEFAULT_RULE;
}

function isWeekOff(rule, dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const dow = d.getDay();                 // 0 Sun … 6 Sat
  const nthWeek = Math.ceil(d.getDate() / 7);
  const t = (rule && rule.type) || 'all_sundays';
  if (t === 'all_sundays') return dow === 0;
  if (t === 'sat_sun') return dow === 0 || dow === 6;
  if (t === 'alt_sat_sun') return dow === 0 || (dow === 6 && (nthWeek === 2 || nthWeek === 4));
  if (t === 'custom' && Array.isArray(rule.days)) return rule.days.includes(dow);
  return dow === 0;
}

// Load the policy + holidays once, return a reusable checker.
async function loadContext() {
  let policy = { weekOff: { byBranch: {}, default: DEFAULT_RULE } };
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const p = (s && s.hrPolicy) || {};
    policy = { weekOff: { byBranch: (p.weekOff && p.weekOff.byBranch) || {}, default: (p.weekOff && p.weekOff.default) || DEFAULT_RULE } };
  } catch {}
  let holidays = [];
  try { holidays = await HrHoliday.findAll(); } catch {}
  const holidayOn = (branch, dateStr) => holidays.find((h) => String(h.date) === dateStr && (!h.branch || String(h.branch).toLowerCase() === String(branch || '').toLowerCase()));
  return {
    // Returns { off, kind, name } — kind: 'weekoff' | 'holiday' | null.
    offInfo(branch, dateStr) {
      const hol = holidayOn(branch, dateStr);
      if (hol) return { off: true, kind: 'holiday', name: hol.name };
      if (isWeekOff(ruleForBranch(policy, branch), dateStr)) return { off: true, kind: 'weekoff', name: 'Week off' };
      return { off: false, kind: null, name: '' };
    },
    // Is the date off for EVERY branch in the roster? (whole-team off)
    allOff(branches, dateStr) {
      const uniq = [...new Set((branches || []).map((b) => b || ''))];
      if (!uniq.length) return this.offInfo('', dateStr).off ? this.offInfo('', dateStr) : { off: false };
      const infos = uniq.map((b) => this.offInfo(b, dateStr));
      if (infos.every((i) => i.off)) {
        // If all holiday, show holiday; else week off.
        const hol = infos.find((i) => i.kind === 'holiday');
        return hol || infos[0];
      }
      return { off: false, kind: null, name: '' };
    },
    policy, holidays,
  };
}

module.exports = { loadContext, isWeekOff, ruleForBranch };

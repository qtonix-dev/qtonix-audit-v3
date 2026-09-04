/**
 * Automatic milestone badges.
 *
 * A daily job that scans each active employee's attendance/leave history and
 * awards milestone badges the moment they're earned:
 *   • Tenure without leave — 30 / 60 / 100 working days with no approved leave.
 *   • Punctuality streaks   — 30 / 60 / 100 attended days on time (not late).
 *
 * Each badge is awarded once (idempotent — keyed by badgeId on the card), added
 * to the employee's profile.performanceCards with auto:true, and fires the same
 * team + HR/admin notification a manual appreciation does. Re-running the job
 * never double-awards.
 */
const HR_STAFF_TYPES = ['hr', 'recruiter'];
const INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours (badges don't need to be instant)
let timer = null;
let running = false;

// Badge definitions. `test(streaks)` returns true when the milestone is met.
const NO_LEAVE = [
  { id: 'auto_noleave_30', name: '30 Days No Leave', icon: '📅', color: '#16A34A', need: 30 },
  { id: 'auto_noleave_60', name: '60 Days No Leave', icon: '📆', color: '#0F9D58', need: 60 },
  { id: 'auto_noleave_100', name: '100 Days No Leave', icon: '🗓️', color: '#15803D', need: 100 },
];
const PUNCTUAL = [
  { id: 'auto_ontime_30', name: 'On-time 30 Days', icon: '⏰', color: '#7C3AED', need: 30 },
  { id: 'auto_ontime_60', name: 'On-time 60 Days', icon: '⏱️', color: '#6D28D9', need: 60 },
  { id: 'auto_ontime_100', name: 'On-time 100 Days', icon: '🎯', color: '#5B21B6', need: 100 },
];

function istToday() { return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10); }

/**
 * Compute the two streaks for one employee from their attendance + leave.
 *  - noLeaveStreak: consecutive WORKING days (present/half_day) up to today with
 *    no approved leave in between. Any approved leave day resets it.
 *  - onTimeStreak:  consecutive ATTENDED days (present/half_day with a login) up
 *    to the most recent attended day, where `late` was false. A late day resets.
 * We count total qualifying days (not calendar days) which matches how people
 * describe these milestones ("100 days worked without leave").
 */
function computeStreaks(attRows, leaveRows) {
  // Map date → attendance, and a set of approved-leave dates.
  const att = {};
  for (const a of attRows) att[a.date] = a;
  const leaveDays = new Set(leaveRows.filter((l) => l.status === 'approved').map((l) => l.date));

  // Ordered list of all dates we have signal for, newest first.
  const dates = [...new Set([...Object.keys(att), ...leaveDays])].sort().reverse();

  // No-leave streak: walk newest→oldest over WORKING days; stop at first leave.
  let noLeave = 0;
  for (const d of dates) {
    if (leaveDays.has(d)) break;                 // took leave → streak ends
    const a = att[d];
    if (!a) continue;                             // no record (weekend/holiday) → skip, don't break
    if (['present', 'half_day', 'wfh'].includes(a.status)) noLeave += 1;
    else if (a.status === 'absent') break;        // absence also ends a "no leave" streak
    // holiday / week_off → skip (neither counts nor breaks)
  }

  // On-time streak: walk newest→oldest over ATTENDED days; stop at first late.
  let onTime = 0;
  for (const d of dates) {
    const a = att[d];
    if (!a) continue;
    if (!['present', 'half_day', 'wfh'].includes(a.status)) continue; // only attended days matter
    if (!a.loginTime) continue;                   // no login recorded → skip
    if (a.late) break;                            // a late day ends the streak
    onTime += 1;
  }

  return { noLeave, onTime };
}

// Award a badge to an employee (idempotent). Returns the card if newly awarded.
async function awardBadge(models, emp, def, dateStr) {
  const profile = emp.profile || {};
  const cards = profile.performanceCards || [];
  if (cards.some((c) => c.badgeId === def.id)) return null; // already earned
  const card = {
    id: `perf${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
    kind: 'praise', title: def.name, note: '',
    date: dateStr, by: 'System', byRole: 'Automatic', byId: null,
    badgeId: def.id, badge: { id: def.id, name: def.name, icon: def.icon, color: def.color },
    auto: true, createdAt: new Date().toISOString(),
  };
  profile.performanceCards = [...cards, card];
  emp.profile = profile; emp.changed('profile', true);
  await emp.save();
  return card;
}

// Notify the employee's team (same department) + HR & admins about the badge.
async function notifyBadge(models, emp, def) {
  const { HrUser, HrNotification, User } = models;
  const msg = `🏅 ${emp.name} earned the “${def.name}” badge ${def.icon}!`;
  try {
    const dept = String(emp.department || '').trim().toLowerCase();
    const team = await HrUser.findAll({ where: { active: true } });
    const recipients = new Set();
    for (const u of team) {
      if (u.id === emp.id) continue;
      const sameDept = dept && String(u.department || '').trim().toLowerCase() === dept;
      const isHr = HR_STAFF_TYPES.includes(u.type) || u.isHrManager;
      if (sameDept || isHr) recipients.add(u.id);
    }
    for (const uid of recipients) { try { await HrNotification.create({ userId: uid, actorKind: 'hr', type: 'info', text: msg }); } catch {} }
    try { await HrNotification.create({ userId: emp.id, actorKind: 'hr', type: 'info', text: `🏅 You earned the “${def.name}” badge ${def.icon}! Keep it up!` }); } catch {}
    try { const admins = await User.findAll({ where: { role: 'admin', active: true } }); for (const a of admins) { await HrNotification.create({ userId: a.id, actorKind: 'admin', type: 'info', text: msg }); } } catch {}
  } catch {}
}

async function tick(models) {
  if (running) return; running = true;
  try {
    const { HrUser, HrAttendance, HrLeave } = models;
    const today = istToday();
    // Go-live date — attendance milestones only count days on/after this, so
    // turning Rewards on doesn't instantly award "100 days" for pre-go-live
    // attendance. Before Rewards is ever on, liveSince is null and we skip.
    const cfgRow = await models.Settings.findOne({ where: { singleton: 'settings' } });
    const liveSince = (cfgRow && cfgRow.rewardConfig && cfgRow.rewardConfig.liveSince) || null;
    const emps = await HrUser.findAll({ where: { active: true, chatOnly: { [require('sequelize').Op.not]: true } } });
    let awarded = 0;
    for (const emp of emps) {
      if (liveSince) {
        const [attRows, leaveRows] = await Promise.all([
          HrAttendance.findAll({ where: { employeeId: emp.id, date: { [require('sequelize').Op.gte]: liveSince } } }),
          HrLeave.findAll({ where: { employeeId: emp.id, date: { [require('sequelize').Op.gte]: liveSince } } }),
        ]);
        if (attRows.length) {
          const { noLeave, onTime } = computeStreaks(attRows, leaveRows);
          for (const def of NO_LEAVE) { if (noLeave >= def.need) { const c = await awardBadge(models, emp, def, today); if (c) { awarded++; await notifyBadge(models, emp, def); } } }
          for (const def of PUNCTUAL) { if (onTime >= def.need) { const c = await awardBadge(models, emp, def, today); if (c) { awarded++; await notifyBadge(models, emp, def); } } }
        }
      }
      // Reward Points auto-rewards (idempotent via dedupeKey): birthday, joining, anniversary.
      try { awarded += await autoRewardPoints(models, emp, today); } catch (e) { /* per-employee, keep going */ }
    }
    // Expire old points once per run.
    try { const R = require('../services/rewards'); const exp = await R.expirePoints(models); if (exp) console.log(`[badges-job] expired ${exp} points`); } catch (e) { console.error('[badges-job] expiry failed:', e.message); }
    if (awarded) console.log(`[badges-job] processed ${awarded} auto-award(s)`);
  } catch (e) { console.error('[badges-job] tick failed:', e.message); }
  finally { running = false; }
}

// Anniversary point tiers (years → rule key). Only exact-year matches award.
const ANNIV_YEARS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20];
function annivRuleForYears(years) {
  // exact tiers up to 10, then 15, then 20; 11-14 use 10's rate, 16-19 use 15's.
  if (ANNIV_YEARS.includes(years)) return `auto_anniversary_${years}`;
  if (years > 10 && years < 15) return 'auto_anniversary_10';
  if (years > 15 && years < 20) return 'auto_anniversary_15';
  if (years > 20) return 'auto_anniversary_20';
  return null;
}

// Award the automatic point rewards an employee qualifies for TODAY.
async function autoRewardPoints(models, emp, today) {
  const R = require('../services/rewards');
  const { RewardRule, Settings } = models;
  let n = 0;
  const yr = today.slice(0, 4);
  const mmdd = today.slice(5); // MM-DD

  // Go-live date: auto-rewards only count events on or after this. Before Rewards
  // was ever switched on there's no liveSince and rewardsLive is false, so award()
  // no-ops anyway — but the guard makes the intent explicit and stops the FIRST
  // day's run from back-crediting joining/anniversary milestones already passed.
  const s = await Settings.findOne({ where: { singleton: 'settings' } });
  const liveSince = (s && s.rewardConfig && s.rewardConfig.liveSince) || null;
  if (!liveSince || today < liveSince) return 0; // nothing before go-live

  // Birthday — once per calendar year, on the day (never retroactive).
  if (emp.birthday) {
    const bday = String(emp.birthday).slice(5); // MM-DD
    if (bday === mmdd) {
      const rule = await RewardRule.findOne({ where: { key: 'auto_birthday', active: true } });
      if (rule && rule.points > 0) {
        const res = await R.award(models, emp.id, { points: rule.points, category: 'automatic', ruleKey: 'auto_birthday', title: 'Birthday reward', byName: 'System', byRole: 'Automatic', source: 'auto', dedupeKey: `birthday:${emp.id}:${yr}` });
        if (res.ok) n++;
      }
    }
  }

  // Joining reward — once, after completing 30 days — but ONLY if that 30-day
  // mark falls on or after go-live. Someone who joined long before Rewards went
  // live already passed day 30 in the past, so they don't get a back-dated bonus.
  if (emp.joiningDate) {
    const jd = new Date(String(emp.joiningDate).slice(0, 10) + 'T00:00:00Z');
    const day30 = new Date(jd.getTime() + 30 * 86400000).toISOString().slice(0, 10);
    const days = Math.floor((new Date(today + 'T00:00:00Z') - jd) / 86400000);
    if (days >= 30 && day30 >= liveSince) {
      const rule = await RewardRule.findOne({ where: { key: 'auto_joining', active: true } });
      if (rule && rule.points > 0) {
        const res = await R.award(models, emp.id, { points: rule.points, category: 'automatic', ruleKey: 'auto_joining', title: 'Joining reward', byName: 'System', byRole: 'Automatic', source: 'auto', dedupeKey: `joining:${emp.id}` });
        if (res.ok) n++;
      }
    }

    // Work anniversary — on the joining month-day each year (only today's, so
    // never retroactive; the liveSince guard above already blocks pre-go-live days).
    const jMmdd = String(emp.joiningDate).slice(5);
    if (jMmdd === mmdd) {
      const years = Number(yr) - jd.getUTCFullYear();
      const key = years >= 1 ? annivRuleForYears(years) : null;
      if (key) {
        const rule = await RewardRule.findOne({ where: { key, active: true } });
        if (rule && rule.points > 0) {
          const res = await R.award(models, emp.id, { points: rule.points, category: 'anniversary', ruleKey: key, title: `${years}-Year Work Anniversary`, byName: 'System', byRole: 'Automatic', source: 'auto', dedupeKey: `anniversary:${emp.id}:${yr}` });
          if (res.ok) n++;
        }
      }
    }
  }
  return n;
}

function start(models) {
  if (timer) return;
  setTimeout(() => tick(models), 60 * 1000); // first run a minute after boot
  timer = setInterval(() => tick(models), INTERVAL_MS);
  console.log('[badges-job] started');
}

module.exports = { start, tick, computeStreaks, NO_LEAVE, PUNCTUAL };

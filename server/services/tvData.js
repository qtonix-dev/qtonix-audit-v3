/**
 * TV Display data service (Phase 1).
 * Assembles slide payloads for /tv/company and /tv/sales from existing data:
 * HR profiles (birthdays/anniversaries/joinees/photos), rewards (recognition,
 * top performers), and sales (race, counter, goal). Read-only, cache-friendly.
 */
const { Op, HrUser, RewardLedger, RewardWallet, Lead, User, Settings, HrAttendance } = require('../models');

const IST_OFFSET = 330 * 60000;
function istNow() { return new Date(Date.now() + IST_OFFSET); }
function pfp(u) { return u ? { name: u.name, photo: u.avatar || '', designation: u.designation || '', department: u.department || '' } : null; }
function mmdd(d) { if (!d) return ''; const s = String(d); return s.slice(5, 10); } // from YYYY-MM-DD

// ---- Celebrations: birthdays / anniversaries / new joinees (today) ----------
async function celebrations() {
  const now = istNow();
  const todayMMDD = `${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  const users = await HrUser.findAll({ where: { active: true, chatOnly: { [Op.not]: true } }, attributes: ['id', 'name', 'avatar', 'designation', 'department', 'birthday', 'joiningDate'] });
  const birthdays = [], anniversaries = [], newJoinees = [];
  const y = now.getUTCFullYear();
  for (const u of users) {
    if (u.birthday && mmdd(u.birthday) === todayMMDD) birthdays.push(pfp(u));
    if (u.joiningDate) {
      const jm = mmdd(u.joiningDate);
      const jy = Number(String(u.joiningDate).slice(0, 4));
      if (jm === todayMMDD && jy < y) anniversaries.push({ ...pfp(u), years: y - jy });
      // New joinee = joined within the last 14 days.
      const jd = new Date(String(u.joiningDate) + 'T00:00:00Z').getTime();
      if (Date.now() - jd < 14 * 86400000 && Date.now() - jd >= 0) newJoinees.push(pfp(u));
    }
  }
  return { birthdays, anniversaries, newJoinees };
}

// ---- Recognition of the moment (most recent award) --------------------------
async function recentRecognition() {
  const row = await RewardLedger.findOne({
    where: { points: { [Op.gt]: 0 }, category: { [Op.in]: ['badge', 'award', 'appreciation', 'performance', 'recognition'] } },
    order: [['createdAt', 'DESC']],
  });
  if (!row) return null;
  const u = await HrUser.findByPk(row.employeeId, { attributes: ['name', 'avatar', 'designation', 'department'] });
  if (!u) return null;
  return { ...pfp(u), title: row.title || 'Recognized', points: row.points, by: row.byName || '', reason: row.reason || '' };
}

// ---- Top performers by reward points (this month) ---------------------------
async function topPerformers(n = 5) {
  const now = istNow();
  const startMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - IST_OFFSET);
  const rows = await RewardLedger.findAll({ where: { points: { [Op.gt]: 0 }, createdAt: { [Op.gte]: startMonth } } });
  const agg = {};
  for (const r of rows) agg[r.employeeId] = (agg[r.employeeId] || 0) + r.points;
  const ids = Object.keys(agg).map(Number);
  if (!ids.length) return [];
  const users = await HrUser.findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id', 'name', 'avatar', 'designation', 'department'] });
  const byId = {}; users.forEach((u) => { byId[u.id] = u; });
  return ids.map((id) => ({ ...pfp(byId[id]), points: agg[id] })).filter((x) => x.name).sort((a, b) => b.points - a.points).slice(0, n);
}

// ---- Daily quote (AI, cached per day; no "AI" shown on the display) ---------
async function dailyQuote(models) {
  const s = await Settings.findOne({ where: { singleton: 'settings' } });
  const today = istNow().toISOString().slice(0, 10);
  if (s && s.tvQuoteCache && s.tvQuoteCache.date === today && s.tvQuoteCache.text) return s.tvQuoteCache.text;
  let text = 'Success is the sum of small efforts, repeated day in and day out.';
  try {
    const key = s && s.getKey ? s.getKey('anthropic') : null;
    if (key) {
      const { callClaude } = require('./aiVisibility');
      const out = await callClaude(key, { system: 'You write one short, original motivational quote for a workplace TV display. Return ONLY the quote text, no author, no quotes marks, under 20 words.', maxTokens: 80, messages: [{ role: 'user', content: 'Give today\'s motivational line for our team.' }] });
      if (out && String(out).trim()) text = String(out).trim().replace(/^["']|["']$/g, '');
    }
  } catch {}
  try { if (s) { s.tvQuoteCache = { date: today, text }; s.changed('tvQuoteCache', true); await s.save(); } } catch {}
  return text;
}

// ---- Sales race / counter / goal (sales URL only) ---------------------------
async function salesData() {
  // Reuse the sales period logic already in the codebase.
  const SP = require('./salesPeriod');
  const b = SP.boundaries(Date.now(), 6);
  const leads = await Lead.findAll({ where: { status: 'converted' } });
  const users = await User.findAll({ attributes: ['id', 'name', 'avatar', 'role', 'targets', 'active', 'archived'] });
  const byId = {}; users.forEach((u) => { byId[u.id] = u; });
  // Sum this-month collected per owner + today's total.
  const monthByOwner = {}; let todayTotal = 0, dealsToday = 0; const clientsToday = new Set();
  const startToday = b.startOfDayMs;
  for (const lead of leads) {
    for (const d of (lead.deals || [])) {
      for (const it of (d.installments || [])) {
        if (!it.paid) continue;
        const ms = SP.saleMs(it, d);
        if (ms >= b.startOfMonthMs) monthByOwner[lead.ownerId] = (monthByOwner[lead.ownerId] || 0) + (Number(it.amount) || 0);
        if (ms >= startToday) { todayTotal += Number(it.amount) || 0; dealsToday++; clientsToday.add(lead.id); }
      }
    }
  }
  // Racers = non-admin owners with a monthly target.
  const racers = [];
  for (const [ownerId, collected] of Object.entries(monthByOwner)) {
    const u = byId[ownerId]; if (!u || u.role === 'admin' || u.archived) continue;
    const target = (u.targets && (u.targets.monthly || u.targets.month)) || 0;
    const pct = target > 0 ? Math.min(100, Math.round((collected / target) * 100)) : 0;
    racers.push({ name: u.name, photo: u.avatar || '', collected: Math.round(collected), target: Math.round(target), pct });
  }
  racers.sort((a, b2) => b2.collected - a.collected);
  const companyTarget = racers.reduce((s, r) => s + (r.target || 0), 0);
  const companyCollected = racers.reduce((s, r) => s + (r.collected || 0), 0);
  // Pace projection: at current daily rate, where will the month land?
  const me = monthEnd();
  const daysElapsed = Math.max(1, me.dayOfMonth);
  const projected = Math.round((companyCollected / daysElapsed) * me.daysInMonth);
  const projectedPct = companyTarget > 0 ? Math.round((projected / companyTarget) * 100) : 0;
  return {
    racers: racers.slice(0, 6),
    counter: { collected: Math.round(todayTotal), deals: dealsToday, clients: clientsToday.size },
    goal: { collected: Math.round(companyCollected), target: Math.round(companyTarget), pct: companyTarget > 0 ? Math.min(100, Math.round((companyCollected / companyTarget) * 100)) : 0 },
    pace: { projected, projectedPct, daysLeft: me.daysLeft, remaining: Math.max(0, companyTarget - companyCollected) },
  };
}

// ============================================================================
// ===== PHASE 2: gamification data ===========================================
// ============================================================================

// XP levels from lifetime points. Level N needs N*500 cumulative (simple ramp).
const REWARD_CLUBS = [
  { min: 25000, name: 'Legend', icon: '👑', color: '#B45309' },
  { min: 10000, name: '10K Club', icon: '💎', color: '#0891B2' },
  { min: 5000, name: '5K Club', icon: '🥇', color: '#CA8A04' },
  { min: 1000, name: '1K Club', icon: '🥉', color: '#7C3AED' },
];
function levelFor(lifetime) {
  // Level up every 500 XP; cap display at a friendly number.
  const level = Math.max(1, Math.floor((lifetime || 0) / 500) + 1);
  const inLevel = (lifetime || 0) % 500;
  return { level, xpInLevel: inLevel, xpToNext: 500 - inLevel, pct: Math.round((inLevel / 500) * 100) };
}
function clubFor(lifetime) { return REWARD_CLUBS.find((c) => (lifetime || 0) >= c.min) || null; }
function nextClub(lifetime) {
  const sorted = [...REWARD_CLUBS].sort((a, b) => a.min - b.min);
  return sorted.find((c) => (lifetime || 0) < c.min) || null;
}

// Featured employee "of the hour" — rotates deterministically by hour so
// everyone gets screen time. Includes their level + club progress.
async function featuredEmployee() {
  const wallets = await RewardWallet.findAll();
  if (!wallets.length) return null;
  const ids = wallets.map((w) => w.employeeId);
  const users = await HrUser.findAll({ where: { id: { [Op.in]: ids }, active: true, chatOnly: { [Op.not]: true } }, attributes: ['id', 'name', 'avatar', 'designation', 'department'] });
  if (!users.length) return null;
  const wById = {}; wallets.forEach((w) => { wById[w.employeeId] = w; });
  const hourSeed = Math.floor(Date.now() / 3600000);
  const u = users[hourSeed % users.length];
  const life = (wById[u.id] || {}).lifetimeEarned || 0;
  const lv = levelFor(life); const club = clubFor(life); const nx = nextClub(life);
  return { ...pfp(u), lifetime: life, level: lv.level, xpInLevel: lv.xpInLevel, xpToNext: lv.xpToNext, levelPct: lv.pct, club, nextClub: nx ? { ...nx, remaining: nx.min - life } : null };
}

// Reward-club standings — who's closest to their next club.
async function clubStandings(n = 4) {
  const wallets = await RewardWallet.findAll();
  const ids = wallets.map((w) => w.employeeId);
  if (!ids.length) return [];
  const users = await HrUser.findAll({ where: { id: { [Op.in]: ids }, active: true, chatOnly: { [Op.not]: true } }, attributes: ['id', 'name', 'avatar'] });
  const byId = {}; users.forEach((u) => { byId[u.id] = u; });
  const out = [];
  for (const w of wallets) {
    const u = byId[w.employeeId]; if (!u) continue;
    const nx = nextClub(w.lifetimeEarned || 0); if (!nx) continue;
    out.push({ ...pfp(u), lifetime: w.lifetimeEarned || 0, next: nx.name, nextIcon: nx.icon, remaining: nx.min - (w.lifetimeEarned || 0) });
  }
  return out.sort((a, b) => a.remaining - b.remaining).slice(0, n);
}

// Newly unlocked badges (recent badge awards this week).
async function recentBadges(n = 5) {
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  const rows = await RewardLedger.findAll({ where: { points: { [Op.gt]: 0 }, category: 'badge', createdAt: { [Op.gte]: weekAgo } }, order: [['createdAt', 'DESC']], limit: 20 });
  const ids = [...new Set(rows.map((r) => r.employeeId))];
  const users = await HrUser.findAll({ where: { id: { [Op.in]: ids.length ? ids : [0] } }, attributes: ['id', 'name', 'avatar'] });
  const byId = {}; users.forEach((u) => { byId[u.id] = u; });
  return rows.filter((r) => byId[r.employeeId]).slice(0, n).map((r) => ({ ...pfp(byId[r.employeeId]), badge: r.title || 'Badge', points: r.points }));
}

// Rising star / most improved — biggest jump in points this month vs last.
async function risingStar() {
  const now = istNow();
  const startThis = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - IST_OFFSET);
  const startLast = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1) - IST_OFFSET);
  const rows = await RewardLedger.findAll({ where: { points: { [Op.gt]: 0 }, createdAt: { [Op.gte]: startLast } } });
  const thisM = {}, lastM = {};
  for (const r of rows) {
    const t = new Date(r.createdAt).getTime();
    if (t >= startThis.getTime()) thisM[r.employeeId] = (thisM[r.employeeId] || 0) + r.points;
    else lastM[r.employeeId] = (lastM[r.employeeId] || 0) + r.points;
  }
  let best = null;
  for (const id of Object.keys(thisM)) {
    const gain = (thisM[id] || 0) - (lastM[id] || 0);
    if (gain > 0 && (!best || gain > best.gain)) best = { id: Number(id), gain, now: thisM[id] };
  }
  if (!best) return null;
  const u = await HrUser.findByPk(best.id, { attributes: ['name', 'avatar', 'designation'] });
  if (!u) return null;
  return { ...pfp(u), gain: best.gain, points: best.now };
}

// Early birds today — first to log in (attendance loginTime).
async function earlyBirds(n = 3) {
  const today = istNow().toISOString().slice(0, 10);
  const rows = await HrAttendance.findAll({ where: { date: today, status: 'present', loginTime: { [Op.ne]: null } } });
  const withTime = rows.filter((r) => r.loginTime).sort((a, b) => a.loginTime.localeCompare(b.loginTime)).slice(0, n);
  const ids = withTime.map((r) => r.employeeId);
  const users = await HrUser.findAll({ where: { id: { [Op.in]: ids.length ? ids : [0] } }, attributes: ['id', 'name', 'avatar'] });
  const byId = {}; users.forEach((u) => { byId[u.id] = u; });
  return withTime.filter((r) => byId[r.employeeId]).map((r) => ({ ...pfp(byId[r.employeeId]), time: r.loginTime }));
}

// On-time streaks — consecutive present + not-late days (recent window).
async function streaks(n = 3) {
  const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const rows = await HrAttendance.findAll({ where: { date: { [Op.gte]: since } }, order: [['date', 'DESC']] });
  const byEmp = {};
  for (const r of rows) { (byEmp[r.employeeId] = byEmp[r.employeeId] || []).push(r); }
  const out = [];
  for (const [empId, list] of Object.entries(byEmp)) {
    // list is date-desc; count leading present & !late.
    let streak = 0;
    for (const r of list) { if (r.status === 'present' && !r.late) streak++; else if (r.status === 'week_off' || r.status === 'holiday') continue; else break; }
    if (streak >= 3) out.push({ empId: Number(empId), streak });
  }
  out.sort((a, b) => b.streak - a.streak);
  const top = out.slice(0, n);
  const users = await HrUser.findAll({ where: { id: { [Op.in]: top.map((x) => x.empId).length ? top.map((x) => x.empId) : [0] } }, attributes: ['id', 'name', 'avatar'] });
  const byId = {}; users.forEach((u) => { byId[u.id] = u; });
  return top.filter((x) => byId[x.empId]).map((x) => ({ ...pfp(byId[x.empId]), streak: x.streak }));
}

// Month-end countdown + company pace projection (sales).
function monthEnd() {
  const now = istNow();
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const dayOfMonth = now.getUTCDate();
  return { daysLeft: daysInMonth - dayOfMonth, dayOfMonth, daysInMonth };
}

async function buildPayload(kind /* 'company' | 'sales' */) {
  const s = await Settings.findOne({ where: { singleton: 'settings' } });
  const cfg = (s && s.tvDisplayConfig) || {};
  const [cel, rec, top, quote, featured, clubs, badges, rising, birds, strk] = await Promise.all([
    celebrations(), recentRecognition(), topPerformers(5), dailyQuote(),
    featuredEmployee(), clubStandings(4), recentBadges(5), risingStar(), earlyBirds(3), streaks(3),
  ]);
  const hour = istNow().getUTCHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const payload = {
    now: Date.now(),
    theme: cfg.theme || 'midnight',
    rotateSeconds: cfg.rotateSeconds || 10,
    slides: cfg.slides || {},
    welcome: { greeting, message: cfg.welcomeMessage || '' },
    quote,
    celebrations: cel,
    recognition: rec,
    performers: top,
    // Phase 2:
    featured, clubs, badges, rising, earlyBirds: birds, streaks: strk,
    monthEnd: monthEnd(),
    daynight: hour >= 7 && hour < 18 ? 'day' : 'night',
  };
  if (kind === 'sales') {
    try { payload.sales = await salesData(); } catch { payload.sales = null; }
  }
  return payload;
}

module.exports = { buildPayload };

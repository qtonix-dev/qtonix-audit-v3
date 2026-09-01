/**
 * Reward engine — the ONE place points move.
 *
 * Every award / redeem / expire / reversal writes an immutable ledger row AND
 * updates the cached wallet inside a single DB transaction, so the two can
 * never drift. Automatic awards pass a `dedupeKey` so re-running a job never
 * double-credits (the unique key makes the second insert fail, which we treat
 * as "already awarded").
 *
 * Nothing here hardcodes point values — callers resolve points from RewardRule
 * (see pointsForRule / pointsForBadge) and pass the number in.
 */

// Points → rupees ratio lives in Settings (default 2 points = ₹1).
async function pointRatio(models) {
  try {
    const s = await models.Settings.findOne({ where: { singleton: 'settings' } });
    const r = s && s.rewardConfig && Number(s.rewardConfig.pointsPerRupee);
    return r && r > 0 ? r : 2;
  } catch { return 2; }
}
async function rupeeValue(models, points) { const r = await pointRatio(models); return Math.round((points / r) * 100) / 100; }

// Default point-expiry window (months) — configurable in Settings.rewardConfig.
async function expiryMonths(models) {
  try { const s = await models.Settings.findOne({ where: { singleton: 'settings' } }); const m = s && s.rewardConfig && Number(s.rewardConfig.expiryMonths); return m && m > 0 ? m : 24; } catch { return 24; }
}
function addMonths(dateStr, months) { const d = new Date(dateStr + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + months); return d.toISOString().slice(0, 10); }
function istToday() { return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10); }

// Master switch: are Reward Points live yet? Defaults OFF so no points are
// awarded until an admin reviews the rule values and turns the system on.
async function rewardsLive(models) {
  try { const s = await models.Settings.findOne({ where: { singleton: 'settings' } }); return !!(s && s.rewardConfig && s.rewardConfig.rewardsLive); } catch { return false; }
}

// Fetch-or-create a wallet row for an employee (inside a txn when given).
async function getWallet(models, employeeId, t) {
  const { RewardWallet } = models;
  let w = await RewardWallet.findOne({ where: { employeeId }, transaction: t });
  if (!w) w = await RewardWallet.create({ employeeId }, { transaction: t });
  return w;
}

/**
 * Award points (positive) to an employee. Atomic: ledger row + wallet update.
 * Returns { ok, ledger } or { ok:false, duplicate:true } if the dedupeKey was
 * already used. Never throws on a duplicate — that's the idempotency guarantee.
 *
 * entry: { points, kind='earn', category, ruleKey, badgeId, title, reason,
 *          byName, byRole, byId, approvedByName, source, refId, dedupeKey }
 */
async function award(models, employeeId, entry) {
  const { sequelize, RewardLedger } = models;
  const points = Math.round(Number(entry.points) || 0);
  if (points <= 0) return { ok: false, error: 'Award points must be positive.' };
  // Master switch — if Rewards aren't live yet, silently no-op (no ledger, no
  // wallet change) so nothing accrues until the admin turns the system on.
  if (!(await rewardsLive(models))) return { ok: false, notLive: true };
  const today = istToday();
  const months = await expiryMonths(models);
  try {
    return await sequelize.transaction(async (t) => {
      const ledger = await RewardLedger.create({
        employeeId, points, kind: entry.kind || 'earn',
        category: entry.category || '', ruleKey: entry.ruleKey || '', badgeId: entry.badgeId || '',
        title: entry.title || '', reason: entry.reason || '',
        byName: entry.byName || 'System', byRole: entry.byRole || '', byId: entry.byId || null,
        approvedByName: entry.approvedByName || '', source: entry.source || '', refId: entry.refId || '',
        dedupeKey: entry.dedupeKey || null,
        expiresOn: addMonths(today, months),
      }, { transaction: t });
      const w = await getWallet(models, employeeId, t);
      w.balance += points; w.lifetimeEarned += points;
      await w.save({ transaction: t });
      return { ok: true, ledger };
    });
  } catch (e) {
    // Unique-constraint on dedupeKey → already awarded. That's success-idempotent.
    if (String(e.name || '').includes('Unique') || /unique/i.test(String(e.message))) return { ok: false, duplicate: true };
    throw e;
  }
}

/**
 * Reverse a previous award (never delete). Creates a negative ledger row that
 * references the original and adjusts the wallet. Guards against reversing more
 * than the current balance would allow only when the balance is insufficient.
 */
async function reverse(models, ledgerId, { reason, byName, byRole, byId }) {
  const { sequelize, RewardLedger } = models;
  return await sequelize.transaction(async (t) => {
    const orig = await RewardLedger.findByPk(ledgerId, { transaction: t });
    if (!orig) return { ok: false, error: 'Original transaction not found.' };
    if (orig.points <= 0) return { ok: false, error: 'Only positive awards can be reversed.' };
    // Prevent double reversal.
    const already = await RewardLedger.findOne({ where: { reversalOf: ledgerId }, transaction: t });
    if (already) return { ok: false, error: 'This transaction was already reversed.' };
    const led = await RewardLedger.create({
      employeeId: orig.employeeId, points: -orig.points, kind: 'reversal',
      category: orig.category, ruleKey: orig.ruleKey, badgeId: orig.badgeId,
      title: `Reversal — ${orig.title || orig.category}`, reason: reason || '',
      byName: byName || 'HR', byRole: byRole || '', byId: byId || null,
      source: 'admin', reversalOf: ledgerId,
    }, { transaction: t });
    const w = await getWallet(models, orig.employeeId, t);
    w.balance -= orig.points;
    await w.save({ transaction: t });
    return { ok: true, ledger: led };
  });
}

// Resolve a rule's point value (0 if missing/inactive). Ranged rules use the
// minimum unless an explicit amount within [points, pointsMax] is passed.
async function pointsForRule(models, ruleKey, amount) {
  const { RewardRule } = models;
  const rule = await RewardRule.findOne({ where: { key: ruleKey, active: true } });
  if (!rule) return { points: 0, rule: null };
  let pts = rule.points;
  if (amount != null && rule.pointsMax) { const a = Math.round(Number(amount)); if (a >= rule.points && a <= rule.pointsMax) pts = a; }
  return { points: pts, rule };
}
// A badge's points come from its rule keyed `badge_<badgeId>`.
async function pointsForBadge(models, badgeId) { return pointsForRule(models, `badge_${badgeId}`); }

// Wallet snapshot for an employee (creates an empty one if none yet).
async function walletFor(models, employeeId) {
  const w = await getWallet(models, employeeId, null);
  const value = await rupeeValue(models, w.balance);
  return { balance: w.balance, reserved: w.reserved, lifetimeEarned: w.lifetimeEarned, lifetimeRedeemed: w.lifetimeRedeemed, lifetimeExpired: w.lifetimeExpired, rupeeValue: value };
}

// ===== Monthly budgets =====
const ROLE_BUDGET_KEY = { tl: 'tl', manager: 'pm', senior: 'tl' };
async function monthlyLimitFor(models, giver) {
  const { RewardBudget, Settings } = models;
  if (!giver) return 0;
  const override = await RewardBudget.findOne({ where: { giverId: giver.id } });
  if (override) return override.monthlyLimit;
  const s = await Settings.findOne({ where: { singleton: 'settings' } });
  const budgets = (s && s.rewardConfig && s.rewardConfig.budgets) || {};
  if (giver.isHrAdmin || giver.type === 'admin') return budgets.senior_mgmt || 10000;
  if (giver.isHrManager || ['hr', 'recruiter'].includes(giver.type)) return budgets.hr || 5000;
  const key = ROLE_BUDGET_KEY[giver.type] || 'tl';
  return budgets[key] || 0;
}

async function spentThisMonth(models, giverId) {
  const { RewardLedger } = models;
  const now = Date.now();
  let startMs;
  try { const SP = require('./salesPeriod'); startMs = SP.boundaries(now, 6).startOfMonthMs; }
  catch { const d = new Date(); startMs = new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }
  const rows = await RewardLedger.findAll({ where: { byId: giverId, source: 'recognition' } });
  return rows.filter((r) => r.points > 0 && new Date(r.createdAt).getTime() >= startMs).reduce((a, r) => a + r.points, 0);
}

async function budgetCheck(models, giver, points) {
  if (!giver) return { ok: true };
  const exempt = giver.isHrAdmin || giver.isHrManager || ['hr', 'recruiter'].includes(giver.type) || giver.type === 'admin';
  if (exempt) return { ok: true, exempt: true };
  const limit = await monthlyLimitFor(models, giver);
  if (!limit) return { ok: false, limit: 0, spent: 0, remaining: 0, reason: 'no_budget' };
  const spent = await spentThisMonth(models, giver.id);
  const remaining = limit - spent;
  return { ok: points <= remaining, limit, spent, remaining };
}

function approvalTier(points) {
  if (points <= 500) return 'manager';
  if (points <= 2500) return 'hod_hr';
  return 'senior_mgmt';
}
function needsApproval(giver, points, rule) {
  if (giver && (giver.isHrAdmin || giver.isHrManager || ['hr', 'recruiter'].includes(giver.type) || giver.type === 'admin')) return false;
  if (rule && rule.requiresApproval) return true;
  return points > 500;
}

// ===== Redemption engine =====
// Reserve points for a pending redemption: moves `cost` from spendable balance
// into `reserved` and writes a -cost 'reserve' ledger row, atomically. Fails if
// the balance is insufficient (prevents double-spend across pending requests).
async function reserve(models, employeeId, cost, meta) {
  const { sequelize, RewardLedger } = models;
  const pts = Math.round(Number(cost) || 0);
  if (pts <= 0) return { ok: false, error: 'Invalid cost.' };
  return await sequelize.transaction(async (t) => {
    const w = await getWallet(models, employeeId, t);
    if (w.balance < pts) return { ok: false, error: 'Not enough points.' };
    const led = await RewardLedger.create({ employeeId, points: -pts, kind: 'reserve', category: 'store', title: meta.title || 'Redemption reserved', reason: meta.reason || '', source: 'store', refId: meta.refId || '' }, { transaction: t });
    w.balance -= pts; w.reserved += pts;
    await w.save({ transaction: t });
    return { ok: true, ledger: led };
  });
}
// Fulfil a reserved redemption: reserved → redeemed (lifetime), no balance
// change (already moved out on reserve). The reserve ledger row stays as the
// spend record; we just flip the wallet's reserved/redeemed counters.
async function fulfilReserved(models, employeeId, cost) {
  const { sequelize } = models;
  const pts = Math.round(Number(cost) || 0);
  return await sequelize.transaction(async (t) => {
    const w = await getWallet(models, employeeId, t);
    w.reserved = Math.max(0, w.reserved - pts); w.lifetimeRedeemed += pts;
    await w.save({ transaction: t });
    return { ok: true };
  });
}
// Refund a reserved redemption (rejected/cancelled): reserved → balance, and a
// +cost 'refund' ledger row so the ledger nets to zero for this redemption.
async function refundReserved(models, employeeId, cost, meta) {
  const { sequelize, RewardLedger } = models;
  const pts = Math.round(Number(cost) || 0);
  return await sequelize.transaction(async (t) => {
    const w = await getWallet(models, employeeId, t);
    w.reserved = Math.max(0, w.reserved - pts); w.balance += pts;
    await w.save({ transaction: t });
    await RewardLedger.create({ employeeId, points: pts, kind: 'refund', category: 'store', title: meta.title || 'Redemption refunded', reason: meta.reason || '', source: 'store', refId: meta.refId || '' }, { transaction: t });
    return { ok: true };
  });
}

// Expire old unspent points. For each employee, sum earns whose expiresOn has
// passed and that haven't been marked expired, capped at their current balance,
// and write a single 'expire' ledger row. Idempotent-ish: marks the source
// earns expired so they're not counted twice.
async function expirePoints(models) {
  const { RewardLedger } = models;
  const today = istToday();
  const due = await RewardLedger.findAll({ where: { points: { [require('sequelize').Op.gt]: 0 }, expired: false, expiresOn: { [require('sequelize').Op.ne]: null, [require('sequelize').Op.lte]: today } } });
  const byEmp = {}; for (const r of due) { (byEmp[r.employeeId] = byEmp[r.employeeId] || []).push(r); }
  let total = 0;
  for (const [empId, rows] of Object.entries(byEmp)) {
    const w = await getWallet(models, Number(empId), null);
    let expireAmt = rows.reduce((a, r) => a + r.points, 0);
    expireAmt = Math.min(expireAmt, w.balance); // never expire more than they hold
    for (const r of rows) { r.expired = true; await r.save(); }
    if (expireAmt > 0) {
      const { sequelize } = models;
      await sequelize.transaction(async (t) => {
        const ww = await getWallet(models, Number(empId), t);
        ww.balance = Math.max(0, ww.balance - expireAmt); ww.lifetimeExpired += expireAmt;
        await ww.save({ transaction: t });
        await RewardLedger.create({ employeeId: Number(empId), points: -expireAmt, kind: 'expire', category: 'expiry', title: 'Points expired', source: 'auto' }, { transaction: t });
      });
      total += expireAmt;
    }
  }
  return total;
}

// Peer-to-peer transfer: move `points` from `fromId`'s spendable balance to
// `toId`, atomically. Two ledger rows (−from, +to). Fails if from is short.
async function transfer(models, fromId, toId, points, meta) {
  const { sequelize, RewardLedger } = models;
  const pts = Math.round(Number(points) || 0);
  if (pts <= 0) return { ok: false, error: 'Invalid amount.' };
  if (fromId === toId) return { ok: false, error: 'Cannot transfer to yourself.' };
  if (!(await rewardsLive(models))) return { ok: false, notLive: true };
  return await sequelize.transaction(async (t) => {
    const wf = await getWallet(models, fromId, t);
    if (wf.balance < pts) return { ok: false, error: 'Not enough points to give.' };
    // Deduct from giver.
    await RewardLedger.create({ employeeId: fromId, points: -pts, kind: 'redeem', category: 'helping', ruleKey: meta.ruleKey || 'helping_transfer', title: meta.fromTitle || 'Helping Hand given', reason: meta.reason || '', byName: meta.fromName || '', source: 'helping', refId: meta.refId || '' }, { transaction: t });
    wf.balance -= pts; wf.lifetimeRedeemed += pts; await wf.save({ transaction: t });
    // Credit recipient.
    const led = await RewardLedger.create({ employeeId: toId, points: pts, kind: 'earn', category: 'helping', ruleKey: meta.ruleKey || 'helping_transfer', title: meta.toTitle || 'Helping Hand received', reason: meta.reason || '', byName: meta.fromName || '', byRole: 'Peer', source: 'helping', refId: meta.refId || '', expiresOn: addMonths(istToday(), await expiryMonths(models)) }, { transaction: t });
    const wt = await getWallet(models, toId, t);
    wt.balance += pts; wt.lifetimeEarned += pts; await wt.save({ transaction: t });
    return { ok: true, ledger: led };
  });
}

module.exports = { award, reverse, pointsForRule, pointsForBadge, walletFor, getWallet, pointRatio, rupeeValue, expiryMonths, addMonths, istToday, rewardsLive, monthlyLimitFor, spentThisMonth, budgetCheck, approvalTier, needsApproval, reserve, fulfilReserved, refundReserved, expirePoints, transfer };

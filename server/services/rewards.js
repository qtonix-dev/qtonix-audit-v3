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

module.exports = { award, reverse, pointsForRule, pointsForBadge, walletFor, getWallet, pointRatio, rupeeValue, expiryMonths, addMonths, istToday };

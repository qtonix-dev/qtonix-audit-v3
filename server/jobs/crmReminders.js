/**
 * Sales-CRM automated email dispatcher. Runs on a timer and sends, from the
 * admin mailbox (adam@qtonix.com):
 *   1. Task/Call reminders — ~15 min before a scheduled activity, to the agent
 *      who owns the lead.
 *   2. Monthly sales-target congratulations — once, when an agent reaches 100%.
 *   3. Team-target congratulations — once, when a manager's team reaches 100%.
 *   4. Encouragement nudges — on the 15th and 25th (IST) for agents below target
 *      (but not those already >90%), stating days left and the gap.
 *
 * All sends are de-duplicated via the CrmEmailLog table (unique dedupeKey), so a
 * given email is never sent twice. If the admin mailbox isn't connected, the job
 * logs and skips without crashing.
 */
const gmail = require('../services/gmail');
const tpl = require('../services/crmEmailTemplate');

const INTERVAL_MS = Number(process.env.CRM_REMINDER_MS || 5 * 60 * 1000); // every 5 min
const REMIND_BEFORE_MIN = 15;   // send the activity reminder this many minutes before
const REMIND_WINDOW_MIN = 6;    // fire if the activity is 15..(15-window) minutes away
let timer = null;
let running = false;

// ---- helpers ---------------------------------------------------------------

// IST is a fixed UTC+5:30 (no DST). Parse an IST wall-clock date/time to a UTC
// Date. Returns null if unparseable.
function istToUtc(dateStr, timeStr) {
  if (!dateStr) return null;
  const t = (timeStr && /^\d{1,2}:\d{2}/.test(timeStr)) ? timeStr.slice(0, 5) : '09:00';
  const iso = `${dateStr}T${t}:00+05:30`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function istNowParts() {
  // Current time in IST as { y, m, d, day-of-month, daysInMonth }.
  const now = new Date();
  const ist = new Date(now.getTime() + (5 * 60 + 30) * 60000);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth(); // 0-based
  const dom = ist.getUTCDate();
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return { y, m, dom, daysInMonth, periodKey: `${y}-${String(m + 1).padStart(2, '0')}` };
}

function money(n) { return `$${Number(n || 0).toLocaleString()}`; }

const CRM_MAIL_DEFAULTS = { reminders: 'sales@qtonix.com', congrats: 'adam@qtonix.com' };

// Build the pool of connected admin mailboxes (primary + extras) that the job
// can send from. Each entry: { email, token, name }.
async function connectedMailboxes(models) {
  const { User, Mailbox, Op } = models;
  const admins = await User.findAll({ where: { role: 'admin', active: true, gmailRefreshToken: { [Op.ne]: null } } });
  const out = [];
  for (const a of admins) {
    if (a.gmailConnectedEmail && a.gmailRefreshToken) {
      out.push({ email: String(a.gmailConnectedEmail).toLowerCase(), token: a.getGmailRefreshToken(), name: a.name });
    }
    const extras = await Mailbox.findAll({ where: { userId: a.id, active: true } });
    for (const m of extras) {
      if (m.email && m.refreshToken) {
        out.push({ email: String(m.email).toLowerCase(), token: m.getRefreshToken(), name: a.name });
      }
    }
  }
  return out;
}

// Resolve the sender mailbox for a category ('reminders' | 'congrats') from the
// admin's routing config, falling back to the configured default, then to any
// connected admin mailbox. Returns { email, token, name } or null.
function pickSender(pool, wantedEmail, fallbackEmail) {
  if (!pool.length) return null;
  const byEmail = (e) => pool.find((m) => m.email === String(e || '').toLowerCase());
  return byEmail(wantedEmail) || byEmail(fallbackEmail) || pool[0];
}

async function resolveSenders(models, s) {
  const pool = await connectedMailboxes(models);
  if (!pool.length) return null;
  const routing = { ...CRM_MAIL_DEFAULTS, ...((s && s.crmConfig && s.crmConfig.mailRouting) || {}) };
  return {
    reminders: pickSender(pool, routing.reminders, CRM_MAIL_DEFAULTS.reminders),
    congrats: pickSender(pool, routing.congrats, CRM_MAIL_DEFAULTS.congrats),
    pool,
  };
}

// Send once, guarded by a dedupe key. Returns true if it sent (or was already
// sent), false on hard failure.
async function sendOnce(models, s, sender, { dedupeKey, type, userId, to, cc, subject, bodyHtml }) {
  const { CrmEmailLog } = models;
  if (!to) return false;
  // Already sent?
  const existing = await CrmEmailLog.findOne({ where: { dedupeKey } });
  if (existing) return true;
  // Reserve the key first (unique index prevents a duplicate from a concurrent
  // tick); if creation races, treat as already-sent.
  let logRow;
  try {
    logRow = await CrmEmailLog.create({ dedupeKey, type, userId: userId || null, toEmail: to, status: 'pending' });
  } catch (e) {
    return true; // unique violation → another tick already handling it
  }
  try {
    const fromName = sender.name || 'Qtonix';
    await gmail.sendMessage(s, sender.token, sender.email, {
      from: `${JSON.stringify(fromName)} <${sender.email}>`,
      to, cc: cc && cc.length ? cc : undefined, subject, bodyHtml,
    });
    logRow.status = 'sent'; logRow.sentAt = new Date(); await logRow.save();
    return true;
  } catch (e) {
    logRow.status = 'failed'; logRow.error = String(e.message || e).slice(0, 500); await logRow.save();
    console.error(`[crm-mail] send failed (${type}):`, e.message);
    return false;
  }
}

// Reminder emails: neutral sales-team signature (sent from sales@qtonix.com).
const reminderSig = (sender) => ({ name: 'Qtonix Sales Team', title: 'Qtonix', email: (sender && sender.email) || 'sales@qtonix.com' });
// Congratulations emails: signed by the Founder/CEO (sent from adam@qtonix.com).
const congratsSig = (sender) => ({ name: 'Sandeep Kumar Swain', title: 'Founder / CEO · Qtonix', email: (sender && sender.email) || 'adam@qtonix.com' });

// ---- 1) Activity reminders (15 min before) ---------------------------------
async function runActivityReminders(models, s, sender) {
  const { Lead, User } = models;
  const now = Date.now();
  const leads = await Lead.findAll({ attributes: ['id', 'firstName', 'lastName', 'ownerId', 'ownerName', 'activities'] });
  const userCache = {};
  const getUser = async (id) => { if (!id) return null; if (userCache[id] !== undefined) return userCache[id]; const u = await User.findByPk(id); userCache[id] = u || null; return userCache[id]; };

  for (const l of leads) {
    const acts = Array.isArray(l.activities) ? l.activities : [];
    for (const a of acts) {
      if (!a || a.mode === 'done' || a.status === 'done') continue;
      const when = a.kind === 'call' ? istToUtc(a.date, a.time) : istToUtc(a.dueDate, '17:00');
      if (!when) continue;
      const minsUntil = (when.getTime() - now) / 60000;
      // Fire when the activity is between (15 - window) and 15 minutes away.
      if (minsUntil > REMIND_BEFORE_MIN || minsUntil < REMIND_BEFORE_MIN - REMIND_WINDOW_MIN) continue;
      const agent = await getUser(l.ownerId);
      if (!agent || !agent.email) continue;
      // CC the agent's manager so they have visibility.
      const cc = [];
      if (agent.managerId) { const mgr = await getUser(agent.managerId); if (mgr && mgr.email) cc.push(mgr.email); }
      const leadName = `${l.firstName || ''} ${l.lastName || ''}`.trim() || '(no name)';
      const whenText = when.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) + ' IST';
      const bodyHtml = tpl.activityReminder({
        agentName: agent.name, kind: a.kind, title: a.title || (a.kind === 'call' ? a.agenda : 'Task'),
        leadName, whenText, minutesLeft: Math.max(1, Math.round(minsUntil)),
        details: a.kind === 'call' ? a.agenda : a.description, signature: reminderSig(sender),
      });
      await sendOnce(models, s, sender, {
        dedupeKey: `reminder:${a.id}`, type: 'reminder', userId: agent.id, to: agent.email,
        cc: cc.filter((e) => e.toLowerCase() !== agent.email.toLowerCase()),
        subject: `Reminder: ${a.kind === 'call' ? 'Call' : 'Task'} "${a.title || (a.kind === 'call' ? a.agenda : 'Task')}" for ${leadName} in ~15 min`,
        bodyHtml,
      });
    }
  }
}

// ---- compute per-agent target/achievement for the current month ------------
async function computeAgentStats(models) {
  const { User, Lead, Settings, MonthlyTarget, Op } = models;
  const { y, m, periodKey } = istNowParts();
  const startOfMonth = new Date(Date.UTC(y, m, 1) - (5 * 60 + 30) * 60000); // IST month start in UTC
  const s = await Settings.findOne({ where: { singleton: 'settings' } });
  const fx = (s && s.crmConfig && s.crmConfig.fxRates) || { USD: 1 };
  const toUsd = (amt, cur) => { const r = fx[cur] || 1; return r ? Number(amt || 0) / r : Number(amt || 0); };

  const agents = await User.findAll({ where: { role: { [Op.in]: ['agent', 'manager'] }, active: true, archived: false } });
  const byId = {};
  agents.forEach((a) => {
    const t = a.targets || {};
    byId[a.id] = {
      id: a.id, name: a.name, email: a.email, role: a.role, managerId: a.managerId,
      team: a.team || '', shift: a.shift || '',
      targetUsd: (t.sales && t.sales.enabled) ? Number(t.sales.monthly || 0) : 0,
      teamTargetUsd: (t.team && t.team.enabled) ? Number(t.team.monthly || 0) : 0,
      achievedUsd: 0,
    };
  });
  const agentIds = agents.map((a) => a.id);
  if (agentIds.length) {
    const leads = await Lead.findAll({ where: { ownerId: { [Op.in]: agentIds } }, attributes: ['ownerId', 'deals'] });
    for (const l of leads) {
      const rec = byId[l.ownerId];
      if (!rec) continue;
      for (const d of (l.deals || [])) {
        if (d.stage !== 'closed_won') continue;
        for (const it of (d.installments || [])) {
          if (it.recurring && Number(it.seq || 0) > 1) continue;
          if (it.paid && it.paidDate) {
            const pd = new Date(it.paidDate);
            if (pd >= startOfMonth) rec.achievedUsd += toUsd(it.amount, d.currency);
          }
        }
      }
    }
  }
  // Admin-saved MonthlyTarget overrides.
  const stored = await MonthlyTarget.findAll({ where: { period: periodKey, userId: { [Op.in]: agentIds.concat(-1) } } });
  stored.forEach((r) => { const rec = byId[r.userId]; if (!rec) return; if (r.targetUsd > 0) rec.targetUsd = r.targetUsd; rec.achievedUsd = r.achievedUsd || 0; });

  // Team achievement per manager = sum of achieved of agents reporting to them.
  Object.values(byId).forEach((rec) => {
    if (rec.role === 'manager') {
      rec.teamAchievedUsd = Object.values(byId)
        .filter((x) => x.managerId === rec.id)
        .reduce((sum, x) => sum + x.achievedUsd, 0);
    }
  });
  return { byId, periodKey };
}

// ---- 2 & 3) Target-hit congratulations -------------------------------------
async function runTargetCongrats(models, s, sender) {
  const { byId, periodKey } = await computeAgentStats(models);
  const ADMIN_CC = 'adam@qtonix.com'; // always CC the founder's address on congrats
  const sig = congratsSig(sender);
  for (const rec of Object.values(byId)) {
    if (!rec.email) continue;
    // Agent sales target hit.
    if (rec.targetUsd > 0 && rec.achievedUsd >= rec.targetUsd) {
      // CC their manager + always CC adam@qtonix.com.
      const cc = new Set([ADMIN_CC]);
      if (rec.managerId && byId[rec.managerId] && byId[rec.managerId].email) cc.add(byId[rec.managerId].email.toLowerCase());
      cc.delete(rec.email.toLowerCase());
      const bodyHtml = tpl.targetHit({ agentName: rec.name, achievedUsd: Math.round(rec.achievedUsd), targetUsd: Math.round(rec.targetUsd), signature: sig });
      await sendOnce(models, s, sender, {
        dedupeKey: `target_hit:${rec.id}:${periodKey}`, type: 'target_hit', userId: rec.id, to: rec.email,
        cc: Array.from(cc),
        subject: `🎉 Congratulations ${String(rec.name).split(' ')[0]} — you hit your monthly target!`, bodyHtml,
      });
    }
    // Manager team target hit.
    if (rec.role === 'manager' && rec.teamTargetUsd > 0 && (rec.teamAchievedUsd || 0) >= rec.teamTargetUsd) {
      const cc = new Set([ADMIN_CC]);
      cc.delete(rec.email.toLowerCase());
      const bodyHtml = tpl.teamTargetHit({ managerName: rec.name, achievedUsd: Math.round(rec.teamAchievedUsd || 0), targetUsd: Math.round(rec.teamTargetUsd), signature: sig });
      await sendOnce(models, s, sender, {
        dedupeKey: `team_target_hit:${rec.id}:${periodKey}`, type: 'team_target_hit', userId: rec.id, to: rec.email,
        cc: Array.from(cc),
        subject: `🏆 Congratulations ${String(rec.name).split(' ')[0]} — your team hit its target!`, bodyHtml,
      });
    }
  }
}

// ---- 4) Encouragement nudges (15th & 25th IST) -----------------------------
async function runEncouragement(models, s, sender, nowParts) {
  const { dom, daysInMonth, m, y, periodKey } = nowParts || istNowParts();
  let phase = null;
  if (dom === 15) phase = 'mid';
  else if (dom === 25) phase = 'late';
  if (!phase) return; // only fires on the 15th and 25th

  const daysLeft = daysInMonth - dom + 1; // include today
  const { byId } = await computeAgentStats(models);
  for (const rec of Object.values(byId)) {
    if (!rec.email || rec.role !== 'agent') continue;
    if (rec.targetUsd <= 0) continue; // no target set → nothing to nudge toward
    const pct = (rec.achievedUsd / rec.targetUsd) * 100;
    if (pct >= 90) continue; // already very close / hit → skip (don't nudge)
    const bodyHtml = tpl.encouragement({
      agentName: rec.name, achievedUsd: Math.round(rec.achievedUsd), targetUsd: Math.round(rec.targetUsd),
      daysLeft, phase, signature: congratsSig(sender),
    });
    await sendOnce(models, s, sender, {
      dedupeKey: `push_${phase}:${rec.id}:${periodKey}`, type: 'push', userId: rec.id, to: rec.email,
      subject: phase === 'late'
        ? `⏳ ${daysLeft} days left — let's finish the month strong, ${String(rec.name).split(' ')[0]}!`
        : `Keep pushing, ${String(rec.name).split(' ')[0]} — you're ${Math.round(pct)}% to target`,
      bodyHtml,
    });
  }
}

// ---- tick ------------------------------------------------------------------
async function tick(models) {
  if (running) return;
  running = true;
  try {
    const { Settings } = models;
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    if (!s) return;
    const senders = await resolveSenders(models, s);
    if (!senders) { /* no admin mailbox connected — skip quietly */ return; }
    // Reminders from the configured "reminders" mailbox (default sales@qtonix.com);
    // congratulations + encouragement from the "congrats" mailbox (default adam@).
    await runActivityReminders(models, s, senders.reminders);
    await runTargetCongrats(models, s, senders.congrats);
    await runEncouragement(models, s, senders.congrats);
  } catch (e) {
    console.error('[crm-mail] tick failed:', e.message);
  } finally {
    running = false;
  }
}

function start(models) {
  if (timer) return;
  // Run shortly after boot, then on the interval.
  setTimeout(() => tick(models), 20000);
  timer = setInterval(() => tick(models), INTERVAL_MS);
  console.log(`[crm-mail] started (every ${Math.round(INTERVAL_MS / 60000)} min)`);
}

module.exports = { start, tick, computeAgentStats, istToUtc, istNowParts, runActivityReminders, runTargetCongrats, runEncouragement, resolveSenders, connectedMailboxes };

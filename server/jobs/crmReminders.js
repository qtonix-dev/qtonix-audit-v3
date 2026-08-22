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
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

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
async function sendOnce(models, s, sender, { dedupeKey, type, userId, to, cc, subject, bodyHtml, fromName, replyTo }) {
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
    const displayName = fromName || sender.name || 'Qtonix';
    await gmail.sendMessage(s, sender.token, sender.email, {
      from: `${JSON.stringify(displayName)} <${sender.email}>`,
      replyTo: replyTo || undefined,
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

// ---- compute per-agent target/achievement for a month (default: current) ----
// opts.period = 'YYYY-MM' to compute a specific month (used by the monthly
// summary); when omitted, uses the current IST month.
async function computeAgentStats(models, opts = {}) {
  const { User, Lead, Settings, MonthlyTarget, Op } = models;
  let y, m, periodKey;
  if (opts.period && /^\d{4}-\d{2}$/.test(opts.period)) {
    periodKey = opts.period; y = Number(opts.period.slice(0, 4)); m = Number(opts.period.slice(5, 7)) - 1;
  } else {
    ({ y, m, periodKey } = istNowParts());
  }
  const startOfMonth = new Date(Date.UTC(y, m, 1) - (5 * 60 + 30) * 60000); // IST month start in UTC
  const endOfMonth = new Date(Date.UTC(y, m + 1, 1) - (5 * 60 + 30) * 60000); // exclusive
  const s = await Settings.findOne({ where: { singleton: 'settings' } });
  const fx = (s && s.crmConfig && s.crmConfig.fxRates) || { USD: 1 };
  const toUsd = (amt, cur) => { const r = fx[cur] || 1; return r ? Number(amt || 0) / r : Number(amt || 0); };

  const agents = await User.findAll({ where: { role: { [Op.in]: ['agent', 'manager'] }, active: true, archived: false } });
  const byId = {};
  agents.forEach((a) => {
    const t = a.targets || {};
    byId[a.id] = {
      id: a.id, name: a.name, email: a.email, role: a.role, managerId: a.managerId,
      team: a.team || '', shift: a.shift || '', avatar: a.avatar || null,
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
            if (pd >= startOfMonth && pd < endOfMonth) rec.achievedUsd += toUsd(it.amount, d.currency);
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
  const ADMIN_CC = 'adam@qtonix.com';
  for (const rec of Object.values(byId)) {
    if (!rec.email || rec.role !== 'agent') continue;
    if (rec.targetUsd <= 0) continue; // no target set → nothing to nudge toward
    const pct = (rec.achievedUsd / rec.targetUsd) * 100;
    if (pct >= 90) continue; // already very close / hit → skip (don't nudge)
    // Send from the agent's manager (signed by them), CC adam@qtonix.com. If the
    // agent has no manager, send from adam@ signed by the Founder/CEO.
    const mgr = (rec.managerId && byId[rec.managerId]) ? byId[rec.managerId] : null;
    let fromName, replyTo, sig;
    if (mgr && mgr.email) {
      fromName = mgr.name;
      replyTo = mgr.email;
      sig = { name: mgr.name, title: 'Sales Manager \u00b7 Qtonix', email: mgr.email };
    } else {
      fromName = 'Sandeep Kumar Swain';
      replyTo = undefined;
      sig = congratsSig(sender);
    }
    const cc = new Set([ADMIN_CC]);
    if (mgr && mgr.email) cc.add(mgr.email.toLowerCase());
    cc.delete(rec.email.toLowerCase());
    const bodyHtml = tpl.encouragement({
      agentName: rec.name, achievedUsd: Math.round(rec.achievedUsd), targetUsd: Math.round(rec.targetUsd),
      daysLeft, phase, signature: sig,
    });
    await sendOnce(models, s, sender, {
      dedupeKey: `push_${phase}:${rec.id}:${periodKey}`, type: 'push', userId: rec.id, to: rec.email,
      cc: Array.from(cc), fromName, replyTo,
      subject: phase === 'late'
        ? `⏳ ${daysLeft} days left — let's finish the month strong, ${String(rec.name).split(' ')[0]}!`
        : `Keep pushing, ${String(rec.name).split(' ')[0]} — you're ${Math.round(pct)}% to target`,
      bodyHtml,
    });
  }
}

// ---- 7) Monthly team summary (1st of the month, for last month) ------------
function prevPeriodKey(nowParts) {
  const { y, m } = nowParts || istNowParts();
  const d = new Date(Date.UTC(y, m - 1, 1)); // previous month
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function monthLabelOf(periodKey) {
  const [y, m] = periodKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// Compute incentives for a period, mirroring the reviews/incentives rules.
function computeIncentives(byId, incRules) {
  const eligibilityPct = Number(incRules.eligibilityPct != null ? incRules.eligibilityPct : 90);
  const agentBasePct = Number(incRules.agentBasePct != null ? incRules.agentBasePct : 1.5);
  const agentOverPct = Number(incRules.agentOverPct != null ? incRules.agentOverPct : 5);
  const managerOverPct = Number(incRules.managerOverPct != null ? incRules.managerOverPct : 5);
  const usdToInr = Number(incRules.usdToInr != null ? incRules.usdToInr : 83);
  const agentInc = (ach, tgt) => {
    if (!tgt || tgt <= 0) return 0;
    if (ach < (eligibilityPct / 100) * tgt) return 0;
    const base = (agentBasePct / 100) * Math.min(ach, tgt);
    const over = ach > tgt ? (agentOverPct / 100) * (ach - tgt) : 0;
    return base + over;
  };
  const earners = [];
  for (const rec of Object.values(byId)) {
    let usd = 0;
    if (rec.role === 'manager') {
      const hasTeam = Object.values(byId).some((x) => x.managerId === rec.id);
      if (hasTeam) {
        const teamAch = rec.teamAchievedUsd || 0; const teamTgt = rec.teamTargetUsd || 0;
        usd = teamAch > teamTgt ? (managerOverPct / 100) * (teamAch - teamTgt) : 0;
      } else usd = agentInc(rec.achievedUsd, rec.targetUsd);
    } else usd = agentInc(rec.achievedUsd, rec.targetUsd);
    if (usd > 0) earners.push({ name: rec.name, role: rec.role, inr: Math.round(usd * usdToInr) });
  }
  earners.sort((a, b) => b.inr - a.inr);
  return earners;
}

// Draft the summary narrative via OpenAI (falls back to a templated body).
async function draftSummaryBody(models, s, ctx) {
  const key = s && s.getKey ? s.getKey('openai') : null;
  const fallback = () => {
    const { teamPct, tone, monthLabel, topName } = ctx;
    const top = esc(topName || 'our top performer');
    if (tone === 'achieved') return `<p style="margin:0 0 14px;">Team, what a month. ${esc(monthLabel)} closed with the <strong>Sales team hitting ${teamPct}% of target</strong> — a result we can all be genuinely proud of.</p><p style="margin:0 0 14px;">Behind that number are dozens of tough conversations you didn't give up on, follow-ups you chased, and deals you refused to let slip. That's not luck; that's discipline, hustle, and heart from every one of you.</p><p style="margin:0 0 14px;">A special mention to <strong>${top}</strong>, who led the board this month — an outstanding performance. Our top three and everyone who earned an incentive are listed below.</p><p style="margin:0;">Let's carry this momentum straight into next month. 🚀</p>`;
    if (tone === 'close') return `<p style="margin:0 0 14px;">Team, ${esc(monthLabel)} was a strong month — we closed at <strong>${teamPct}% of target</strong>. We didn't quite cross the line, but let's be clear: this was a genuinely good effort, and we were close.</p><p style="margin:0 0 14px;">Every deal you worked and every relationship you built moved us forward — and the gap left is small enough that a focused push next month closes it completely.</p><p style="margin:0 0 14px;"><strong>${top}</strong> led the way and showed exactly what's possible. Let's rally around that standard.</p><p style="margin:0;">A little more, together, and we're there. Let's go! 💪</p>`;
    if (tone === 'focus') return `<p style="margin:0 0 14px;">Team, ${esc(monthLabel)} came in at <strong>${teamPct}% of target</strong>. I want to be honest — that's below where we planned to be — but also fair: there was real effort this month, and the foundation is there to build on.</p><p style="margin:0 0 14px;">What we need now is sharper focus: prioritising our warmest leads, staying on top of follow-ups, and backing each other when a deal gets hard. Small, consistent improvements from all of us add up fast.</p><p style="margin:0 0 14px;"><strong>${top}</strong> proved what a strong month looks like. Let's learn from that and lift the whole team.</p><p style="margin:0;">Let's make next month a real step change. I'm confident in you. 💪</p>`;
    return `<p style="margin:0 0 14px;">Team, I'm going to be straight with you, because you deserve honesty: ${esc(monthLabel)} closed at <strong>${teamPct}% of target</strong> — well below where we need to be.</p><p style="margin:0 0 14px;">I want you to understand why this matters beyond the number. Hitting our targets is what funds the company's growth — the tools you use, the salaries we pay, the opportunities we can create, and the future every one of us is building here. When we fall this far short, all of that gets harder. This isn't about blame; it's about being clear-eyed so we can fix it together.</p><p style="margin:0 0 14px;">And I do believe we can. <strong>${top}</strong> proved this month that strong results are still possible right now. Let's regroup, get disciplined about our pipeline, and support one another the way this team knows how to.</p><p style="margin:0;">This is a reset, not a verdict. Let's come back strong next month — I'm with you every step. 💪</p>`;
  };
  if (!key) return fallback();
  try {
    const { callOpenAI } = require('../services/summaryRewrite');
    const system = `You are the Founder/CEO of Qtonix, a digital marketing agency, writing a short monthly performance email to your sales team. Write warm, sincere, motivating prose in exactly 4 HTML paragraphs (<p> tags with inline margins: the first three "margin:0 0 14px;", the last "margin:0;").
Structure the opening as TWO short paragraphs rather than one long block, so it's easy to read and doesn't get skimmed:
- Paragraph 1 (2-3 sentences): open with the headline result — the team's % of target — and set the emotional tone.
- Paragraph 2 (2-3 sentences): expand on what that means and why it matters, making the message land.
- Paragraph 3: praise the highest performer by name and point to the top-3 / incentive earners below.
- Paragraph 4 (short): a rallying closing line.
Rules by performance tone:
- "achieved" (>=100%): celebrate the team genuinely and specifically.
- "close" (70-99%): affirm it was a good effort, acknowledge the near-miss, stay upbeat — a focused push gets there.
- "focus" (50-69%): honest that it's below plan but fair about the effort; rally the team to tighten focus. Encouraging, not negative.
- "low" (<50%): be honest that results are well below where they need to be, and explain that hitting targets is what funds the company's growth, tools, salaries, and everyone's future here — but KEEP IT ENCOURAGING and supportive, never harsh or threatening. Frame it as an honest reset and a comeback, "a reset, not a verdict".
Mention the team % of target, praise the highest performer by name, and note that top-3 and incentive earners are listed below (do NOT list them yourself — tables follow). Do not invent numbers beyond what's provided. Output ONLY the 4 HTML paragraphs, no preamble, no markdown fences.`;
    const user = JSON.stringify({ month: ctx.monthLabel, teamPct: ctx.teamPct, tone: ctx.tone, highestPerformer: ctx.topName, topThree: ctx.topThree, incentiveEarnerCount: ctx.earnerCount });
    const out = await callOpenAI(key, { system, user, maxTokens: 900 });
    const cleaned = String(out || '').replace(/```html/gi, '').replace(/```/g, '').trim();
    if (cleaned && /<p/i.test(cleaned)) return cleaned;
    return fallback();
  } catch (e) { console.error('[crm-mail] summary AI draft failed:', e.message); return fallback(); }
}

async function runMonthlySummary(models, s, sender, nowParts) {
  const parts = nowParts || istNowParts();
  if (parts.dom !== 1) return; // only on the 1st of the month
  const period = prevPeriodKey(parts);
  const monthLabel = monthLabelOf(period);
  const { byId } = await computeAgentStats(models, { period });
  const people = Object.values(byId);
  if (!people.length) return;

  // Team totals (agents + managers' own targets count once via agents; use the
  // sum of individual sales vs sum of individual targets as the team figure).
  const agents = people.filter((p) => p.role === 'agent');
  const teamAchieved = agents.reduce((sum, a) => sum + a.achievedUsd, 0);
  const teamTarget = agents.reduce((sum, a) => sum + a.targetUsd, 0);
  const teamPct = teamTarget > 0 ? Math.round((teamAchieved / teamTarget) * 100) : 0;
  // Tone tiers: >=100 achieved (green) · 70-99 close (blue) · 50-69 focus
  // (orange) · <50 low (red, honest but encouraging).
  let tone = 'close';
  if (teamPct >= 100) tone = 'achieved';
  else if (teamPct >= 70) tone = 'close';
  else if (teamPct >= 50) tone = 'focus';
  else tone = 'low';

  // Rankings by % of target (agents only for "highest % of sale").
  const ranked = agents.filter((a) => a.targetUsd > 0)
    .map((a) => ({ ...a, pct: Math.round((a.achievedUsd / a.targetUsd) * 100) }))
    .sort((x, y) => y.pct - x.pct);
  const topThree = ranked.slice(0, 3).map((a) => ({ name: a.name, avatar: a.avatar || null, pct: a.pct, amount: `$${Math.round(a.achievedUsd).toLocaleString()}` }));
  const topName = topThree.length ? topThree[0].name : null;

  // Incentive earners for the month — show each earner's achieved amount + % of
  // target next to their name (not the incentive figure itself).
  const incRules = (s && s.crmConfig && s.crmConfig.incentives) || {};
  const earnerNames = new Set(computeIncentives(byId, incRules).map((e) => e.name));
  const earners = Object.values(byId)
    .filter((r) => earnerNames.has(r.name))
    .map((r) => {
      const isMgrTeam = r.role === 'manager' && Object.values(byId).some((x) => x.managerId === r.id);
      const ach = isMgrTeam ? (r.teamAchievedUsd || 0) : r.achievedUsd;
      const tgt = isMgrTeam ? (r.teamTargetUsd || 0) : r.targetUsd;
      const pct = tgt > 0 ? Math.round((ach / tgt) * 100) : null;
      return { name: r.name, role: r.role, amount: `$${Math.round(ach).toLocaleString()}`, pct, _ach: ach };
    })
    .sort((a, b) => b._ach - a._ach);

  const bodyHtml = await draftSummaryBody(models, s, {
    monthLabel, teamPct, tone, topName, topThree, earnerCount: earners.length,
  });

  const sig = congratsSig(sender);
  // Send to every active agent + manager, individually (no CC).
  for (const rec of people) {
    if (!rec.email) continue;
    const html = tpl.monthlySummary({
      recipientName: rec.name, monthLabel, teamPct, tone, bodyHtml,
      topPerformers: topThree, incentiveEarners: earners, signature: sig,
    });
    await sendOnce(models, s, sender, {
      dedupeKey: `summary:${rec.id}:${period}`, type: 'summary', userId: rec.id, to: rec.email,
      subject: tone === 'achieved'
        ? `🏆 ${monthLabel} team summary — we hit ${teamPct}% of target!`
        : `${monthLabel} team summary — where we landed & what's next`,
      bodyHtml: html,
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
    await runMonthlySummary(models, s, senders.congrats);
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

module.exports = { start, tick, computeAgentStats, istToUtc, istNowParts, runActivityReminders, runTargetCongrats, runEncouragement, runMonthlySummary, resolveSenders, connectedMailboxes, prevPeriodKey };

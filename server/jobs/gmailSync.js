/**
 * Background Gmail sync. Every few minutes, for each user who has connected
 * their mailbox, we pull recent messages that match any of their leads (by the
 * lead's email address or email domain) and upsert them into lead_emails.
 *
 * Kept deliberately simple: one pass fetches each connected user's recent
 * inbox+sent and matches locally, so we make a bounded number of Gmail calls
 * per user regardless of how many leads they own.
 */
const gmail = require('../services/gmail');

const INTERVAL_MS = Number(process.env.GMAIL_SYNC_MS || 4 * 60 * 1000); // 4 min
let timer = null;
let running = false;

async function syncOnce(models) {
  const { User, Lead, LeadEmail, Settings } = models;
  const s = await Settings.findOne({ where: { singleton: 'settings' } });
  if (!s || !gmail.isConfigured(s)) return { skipped: 'not configured' };

  const users = await User.findAll({ where: { active: true } });
  const connected = users.filter((u) => u.gmailRefreshToken);
  if (connected.length === 0) return { skipped: 'no connected users' };

  // Build a lookup of lead email + domain → leadId for fast local matching.
  const leads = await Lead.findAll({ attributes: ['id', 'email', 'domain'] });
  const byEmail = new Map();
  const byDomain = new Map();
  leads.forEach((l) => {
    if (l.email) byEmail.set(String(l.email).toLowerCase(), l.id);
    const d = (l.domain || '').replace(/^www\./, '').toLowerCase();
    if (d && !byDomain.has(d)) byDomain.set(d, l.id);
  });

  let inserted = 0;
  for (const u of connected) {
    try {
      // Pull recent inbox + sent; match each against known leads.
      const msgs = await gmail.searchMessages(s, u.getGmailRefreshToken(), u.gmailConnectedEmail, 'in:inbox OR in:sent newer_than:14d', 40);
      for (const m of msgs) {
        const counterparty = m.direction === 'outbound'
          ? gmail.parseAddress(m.toEmail).email
          : m.fromEmail;
        if (!counterparty) continue;
        const domain = counterparty.split('@')[1] || '';
        const leadId = byEmail.get(counterparty) || byDomain.get(domain);
        if (!leadId) continue;
        const [row, created] = await LeadEmail.findOrCreate({
          where: { userId: u.id, gmailMessageId: m.gmailMessageId },
          defaults: { ...m, leadId, userId: u.id },
        });
        if (created) {
          inserted++;
          // Note inbound arrivals on the lead timeline (once, from the owner's
          // mailbox or whoever synced it first).
          if (m.direction === 'inbound') {
            try {
              const lead = await Lead.findByPk(leadId);
              if (lead) {
                const tl = Array.isArray(lead.timeline) ? lead.timeline : [];
                tl.push({ type: 'email', text: `Email received from ${m.fromName || m.fromEmail}: "${m.subject || '(no subject)'}"`, time: (m.sentAt || new Date()).toISOString ? (m.sentAt || new Date()).toISOString() : new Date().toISOString(), author: m.fromName || m.fromEmail, direction: 'inbound' });
                lead.timeline = tl; lead.changed('timeline', true); lead.lastActivityAt = new Date();
                await lead.save();
              }
            } catch (e) { /* best-effort */ }
          }
        }
      }
    } catch (e) {
      console.error(`[gmail-sync] user ${u.id} failed:`, e.message);
    }
  }
  return { connected: connected.length, inserted };
}

function start(models) {
  if (timer) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try { const r = await syncOnce(models); if (r && r.inserted) console.log('[gmail-sync]', JSON.stringify(r)); }
    catch (e) { console.error('[gmail-sync] pass failed:', e.message); }
    finally { running = false; }
  };
  // First pass after a short delay so boot isn't blocked, then on an interval.
  setTimeout(tick, 20000);
  timer = setInterval(tick, INTERVAL_MS);
  console.log(`[gmail-sync] scheduled every ${Math.round(INTERVAL_MS / 60000)} min`);
}

module.exports = { start, syncOnce };

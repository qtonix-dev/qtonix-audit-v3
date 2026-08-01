/**
 * Flags tracked emails that haven't been opened within 24 hours so the agent
 * can send a follow-up. Posts a one-time note on the lead's timeline and marks
 * the row notified. The dashboard reads unopened rows directly (see the
 * /gmail/unopened endpoint), so this job only handles the timeline nudge.
 */
let timer = null;
let running = false;
const INTERVAL_MS = 60 * 60 * 1000; // hourly

async function flagUnopened(models) {
  const { EmailOpen, Lead, Op } = models;
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await EmailOpen.findAll({
    where: {
      firstOpenAt: null,           // never opened
      unopenedNotifiedAt: null,    // not yet nudged
      sentAt: { [Op.lte]: cutoff },
    },
    limit: 200,
  });
  let flagged = 0;
  for (const row of rows) {
    try {
      if (row.leadId) {
        const lead = await Lead.findByPk(row.leadId);
        if (lead) {
          const tl = Array.isArray(lead.timeline) ? lead.timeline : [];
          tl.push({
            type: 'email', direction: 'unopened',
            text: `⚠️ Email not opened after 24h: "${row.subject || '(no subject)'}" — consider a follow-up.`,
            time: new Date().toISOString(), author: 'System',
          });
          lead.timeline = tl; lead.changed('timeline', true);
          await lead.save();
        }
      }
      row.unopenedNotifiedAt = new Date();
      await row.save();
      flagged++;
    } catch (e) { /* best-effort per row */ }
  }
  return { flagged };
}

function start(models) {
  if (timer) return;
  const tick = async () => {
    if (running) return; running = true;
    try { const r = await flagUnopened(models); if (r.flagged) console.log('[unopened-email]', JSON.stringify(r)); }
    catch (e) { console.error('[unopened-email] pass failed:', e.message); }
    finally { running = false; }
  };
  setTimeout(tick, 30000);
  timer = setInterval(tick, INTERVAL_MS);
  console.log('[unopened-email] checker every 60m');
}

module.exports = { start, flagUnopened };

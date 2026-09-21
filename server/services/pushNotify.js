/**
 * Web Push (Option C) — sends OS notifications to a user's subscribed browsers
 * even when Qtonix isn't open in any tab. Uses VAPID keys from env. No-ops
 * gracefully if the keys aren't configured.
 */
const crypto = require('crypto');
let webpush = null;
let configured = false;

function init() {
  if (webpush) return configured;
  try {
    webpush = require('web-push');
    const pub = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT || 'mailto:hr@qtonix.com';
    if (pub && priv) { webpush.setVapidDetails(subject, pub, priv); configured = true; }
  } catch { configured = false; }
  return configured;
}

function isConfigured() { return init(); }
function publicKey() { return process.env.VAPID_PUBLIC_KEY || null; }
function hashEndpoint(endpoint) { return crypto.createHash('sha256').update(String(endpoint)).digest('hex'); }

// Send a push payload to every subscription of a user. Deletes dead subs (404/410).
async function sendToUser(models, userId, payload) {
  if (!init()) return { sent: 0 };
  const { PushSubscription } = models;
  const subs = await PushSubscription.findAll({ where: { userId } });
  if (!subs.length) return { sent: 0 };
  const data = JSON.stringify(payload);
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, data, { TTL: 3600 });
      sent++;
      s.lastUsedAt = new Date(); await s.save();
    } catch (e) {
      const code = e && e.statusCode;
      if (code === 404 || code === 410) { try { await s.destroy(); } catch {} } // gone → clean up
    }
  }
  return { sent };
}

module.exports = { isConfigured, publicKey, hashEndpoint, sendToUser };

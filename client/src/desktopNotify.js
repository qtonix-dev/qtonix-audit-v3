// Desktop notifications for Buzz chat + task assignments (Option A: Web
// Notifications API + sound + title flash). Works while a Qtonix tab is open
// anywhere (even backgrounded / behind other apps). A later Web Push upgrade
// will cover the tab-fully-closed case.

const LS_ENABLED = 'qtx_desktop_notify';       // user toggle: '1' | '0'
const LS_SEEN = 'qtx_notify_seen';             // last notified message id (per tab session)

export function notifyEnabled() { return localStorage.getItem(LS_ENABLED) === '1'; }
export function setNotifyEnabled(on) { localStorage.setItem(LS_ENABLED, on ? '1' : '0'); }
export function notifyPermission() { return (typeof Notification !== 'undefined') ? Notification.permission : 'unsupported'; }

// Ask the browser for permission. Returns the resulting permission string.
export async function requestNotifyPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  try { const p = await Notification.requestPermission(); return p; } catch { return 'denied'; }
}

// A short, pleasant "ding" via the Web Audio API (no asset needed).
let audioCtx = null;
export function playDing() {
  try {
    if (!notifyEnabled()) return;
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtx; const now = ctx.currentTime;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(880, now); o.frequency.exponentialRampToValueAtTime(1320, now + 0.08);
    g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.12, now + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    o.connect(g); g.connect(ctx.destination); o.start(now); o.stop(now + 0.36);
  } catch {}
}

// Flash the tab title so a backgrounded tab shows the unread count.
let titleTimer = null; let baseTitle = null;
export function flashTitle(count) {
  if (baseTitle == null) baseTitle = document.title.replace(/^\(\d+\)\s*/, '');
  if (!count) { if (titleTimer) { clearInterval(titleTimer); titleTimer = null; } document.title = baseTitle; return; }
  const withCount = `(${count}) ${baseTitle}`;
  if (document.hasFocus()) { document.title = withCount; return; }
  if (titleTimer) return;
  let on = true;
  titleTimer = setInterval(() => { document.title = on ? `💬 New message · ${baseTitle}` : withCount; on = !on; }, 1200);
}
export function clearTitleFlash() { if (titleTimer) { clearInterval(titleTimer); titleTimer = null; } if (baseTitle != null) document.title = baseTitle; }

// Show one OS desktop notification. `onClick` focuses the tab + opens the thread.
export function showDesktopNotification({ title, body, tag, icon, onClick }) {
  if (!notifyEnabled()) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  // Only fire when the tab is NOT focused (if focused, the in-app UI already shows it).
  if (document.hasFocus()) return;
  try {
    const n = new Notification(title, { body: (body || '').slice(0, 180), tag: tag || undefined, icon: icon || '/brand/favicon-192.png', renotify: false, silent: true });
    n.onclick = () => { try { window.focus(); } catch {} if (onClick) onClick(); n.close(); };
    setTimeout(() => { try { n.close(); } catch {} }, 8000);
  } catch {}
}

// De-dupe: has this message id already been notified in this tab session?
const notified = new Set(JSON.parse(sessionStorage.getItem(LS_SEEN) || '[]'));
export function alreadyNotified(id) { return notified.has(id); }
export function markNotified(id) { notified.add(id); try { sessionStorage.setItem(LS_SEEN, JSON.stringify([...notified].slice(-300))); } catch {} }

// ---- Web Push (Option C): notifications even when no Qtonix tab is open ----
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64); const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Register the service worker + create a push subscription. `api` is the hrApi
// helper (path-relative). Returns true if push is active. Safe to call repeatedly.
export async function enableWebPush(api) {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    const cfg = await api('/chat/push/key');
    if (!cfg.configured || !cfg.publicKey) return false;
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(cfg.publicKey) });
    await api('/chat/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON ? sub.toJSON() : sub }) });
    return true;
  } catch { return false; }
}

// Remove the push subscription (user turned alerts off).
export async function disableWebPush(api) {
  try {
    if (!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    if (!reg) return;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { try { await api('/chat/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }); } catch {} try { await sub.unsubscribe(); } catch {} }
  } catch {}
}

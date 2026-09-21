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

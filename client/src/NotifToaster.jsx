import React, { useState, useEffect, useRef } from 'react';

// A single short, quiet "pop" using the Web Audio API — no asset needed.
let _audioCtx = null;
function playPop() {
  try {
    _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _audioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sine'; o.frequency.setValueAtTime(660, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.08);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    o.start(); o.stop(ctx.currentTime + 0.24);
  } catch {}
}

const initials = (n) => (n || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const avColor = (n) => { const c = ['#6d28d9', '#0891b2', '#16a34a', '#ea580c', '#db2777', '#2563eb', '#7c3aed']; let h = 0; for (const ch of (n || '')) h = (h * 31 + ch.charCodeAt(0)) | 0; return c[Math.abs(h) % c.length]; };
const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const AUTO_MS = 6000;
const MAX_VISIBLE = 4;

const TASK_STYLE = {
  task_assigned: { accent: '#2563EB', icon: '📋', label: 'New task assigned' },
  task_coassigned: { accent: '#0D9488', icon: '🤝', label: 'Added as co-assignee' },
  task_need_update: { accent: '#DC2626', icon: '🔁', label: 'Changes requested' },
  task_mention: { accent: '#7C3AED', icon: '💬', label: 'Mentioned in a task' },
};

/**
 * Global notification toaster. Polls a feed for new chat messages + task
 * notifications and shows clickable toasts, bottom-right, on any page.
 *
 * Props:
 *  - fetchFeed(afterMsg, afterNotif) → Promise<{ messages, notifs, lastMsgId, lastNotifId, primed }>
 *  - activeConversationId: the conversation the user is currently viewing (skip its messages)
 *  - openTaskDrawerId: task id currently open in a drawer (skip its notifs)
 *  - onOpenMessage(conversationId): navigate to that chat
 *  - onOpenTask(taskId): open that task
 *  - enabled: master on/off
 */
export default function NotifToaster({ fetchFeed, activeConversationId, openTaskDrawerId, onOpenMessage, onOpenTask, enabled = true }) {
  const [toasts, setToasts] = useState([]);
  const cursor = useRef({ msg: 0, notif: 0, primed: false });
  const activeRef = useRef(activeConversationId);
  const drawerRef = useRef(openTaskDrawerId);
  useEffect(() => { activeRef.current = activeConversationId; }, [activeConversationId]);
  useEffect(() => { drawerRef.current = openTaskDrawerId; }, [openTaskDrawerId]);

  const push = (t) => {
    setToasts((cur) => {
      const next = [{ ...t, _key: `${t.kind}-${t.id}-${Date.now()}` }, ...cur].slice(0, 12);
      return next;
    });
    playPop();
  };
  const dismiss = (key) => setToasts((cur) => cur.filter((x) => x._key !== key));

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const tick = async () => {
      try {
        const first = !cursor.current.primed;
        const r = await fetchFeed(cursor.current.msg, cursor.current.notif, first);
        if (!alive || !r) return;
        // Prime on first response so we don't replay history.
        if (first || r.primed) {
          cursor.current = { msg: r.lastMsgId || 0, notif: r.lastNotifId || 0, primed: true };
          return;
        }
        cursor.current = { msg: r.lastMsgId || cursor.current.msg, notif: r.lastNotifId || cursor.current.notif, primed: true };
        // Messages (skip the one you're actively viewing).
        for (const m of (r.messages || []).slice().reverse()) {
          if (activeRef.current && Number(activeRef.current) === Number(m.conversationId)) continue;
          const isDm = m.convKind === 'dm';
          const label = isDm ? `Message · ${m.senderName || 'Someone'}` : `${m.convTitle ? '#' + m.convTitle : 'Group'} · ${m.senderName || 'Someone'}`;
          push({ kind: 'msg', id: m.id, accent: isDm ? '#FF6A00' : '#7C3AED', avatar: m.senderName, label, title: stripHtml(m.body).slice(0, 140) || '(attachment)', conversationId: m.conversationId, at: m.createdAt });
        }
        // Task notifications (skip if that task drawer is open).
        for (const n of (r.notifs || []).slice().reverse()) {
          const taskId = n.meta && (n.meta.taskId || n.meta.id);
          if (taskId && drawerRef.current && Number(drawerRef.current) === Number(taskId)) continue;
          const st = TASK_STYLE[n.type] || TASK_STYLE.task_assigned;
          push({ kind: 'task', id: n.id, accent: st.accent, icon: st.icon, label: st.label, title: stripHtml(n.text).slice(0, 140), taskId, at: n.createdAt });
        }
      } catch {}
    };
    tick();
    const iv = setInterval(tick, 8000);
    return () => { alive = false; clearInterval(iv); };
  }, [enabled, fetchFeed]);

  if (!toasts.length) return null;
  const visible = toasts.slice(0, MAX_VISIBLE);
  const overflow = toasts.length - visible.length;

  return (
    <div style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 2147483000, display: 'flex', flexDirection: 'column', gap: 10, width: 360, maxWidth: 'calc(100vw - 40px)', pointerEvents: 'none' }}>
      {overflow > 0 && <div style={{ pointerEvents: 'auto', textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#94a3b8', background: '#fff', borderRadius: 20, padding: '3px 10px', alignSelf: 'flex-end', boxShadow: '0 6px 18px rgba(2,6,23,.12)' }}>+{overflow} more</div>}
      {visible.map((t) => <ToastCard key={t._key} t={t} onClose={() => dismiss(t._key)} onClick={() => { dismiss(t._key); if (t.kind === 'msg') onOpenMessage && onOpenMessage(t.conversationId); else if (t.taskId) onOpenTask && onOpenTask(t.taskId); }} />)}
    </div>
  );
}

function ToastCard({ t, onClose, onClick }) {
  const [paused, setPaused] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const startedRef = useRef(Date.now());
  const remainRef = useRef(AUTO_MS);
  useEffect(() => {
    if (paused) { remainRef.current = Math.max(0, remainRef.current - (Date.now() - startedRef.current)); return; }
    startedRef.current = Date.now();
    const to = setTimeout(() => { setLeaving(true); setTimeout(onClose, 220); }, remainRef.current);
    return () => clearTimeout(to);
  }, [paused]);
  const timeLabel = (() => { try { const d = new Date(t.at); const s = Math.round((Date.now() - d) / 1000); if (s < 15) return 'now'; if (s < 60) return `${s}s ago`; const m = Math.round(s / 60); return `${m}m ago`; } catch { return 'now'; } })();
  return (
    <div
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onClick={onClick}
      style={{ pointerEvents: 'auto', background: '#fff', borderRadius: 16, boxShadow: '0 18px 45px rgba(2,6,23,.25)', overflow: 'hidden', display: 'flex', alignItems: 'stretch', cursor: 'pointer', border: '1px solid rgba(226,232,240,.7)', position: 'relative', transform: leaving ? 'translateX(30px)' : 'none', opacity: leaving ? 0 : 1, transition: 'transform .22s ease, opacity .22s ease', animation: leaving ? 'none' : 'ntSlideIn .32s cubic-bezier(.2,.9,.3,1.15)' }}
    >
      <style>{`@keyframes ntSlideIn{from{transform:translateX(34px);opacity:0}to{transform:none;opacity:1}} @keyframes ntBar{from{width:100%}to{width:0%}}`}</style>
      <div style={{ width: 5, flexShrink: 0, background: t.accent }} />
      <div style={{ width: 46, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {t.kind === 'msg'
          ? <span style={{ width: 34, height: 34, borderRadius: '50%', background: avColor(t.avatar), color: '#fff', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initials(t.avatar)}</span>
          : <span style={{ fontSize: 20 }}>{t.icon}</span>}
      </div>
      <div style={{ flex: 1, padding: '11px 30px 12px 2px', minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', color: t.accent, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.label}</div>
        <div style={{ fontSize: t.kind === 'msg' ? 13.5 : 14, fontWeight: t.kind === 'msg' ? 600 : 800, color: '#0A0E28', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{t.title}</div>
        <div style={{ fontSize: 10.5, color: '#cbd5e1', marginTop: 4 }}>{timeLabel}</div>
      </div>
      <button onClick={(e) => { e.stopPropagation(); setLeaving(true); setTimeout(onClose, 200); }} style={{ position: 'absolute', top: 8, right: 8, width: 20, height: 20, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1', fontSize: 14, background: '#f8fafc', border: 'none', cursor: 'pointer' }}>×</button>
      <div style={{ position: 'absolute', left: 0, bottom: 0, height: 3, background: t.accent, borderRadius: 3, width: '100%', animation: `ntBar ${AUTO_MS}ms linear forwards`, animationPlayState: paused ? 'paused' : 'running' }} />
    </div>
  );
}

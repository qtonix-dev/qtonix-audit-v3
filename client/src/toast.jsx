// Global themed toast — replaces raw browser alert() with an on-brand message.
// Usage: import { toast } from './toast'; toast('Saved!'); toast(err.message);
// Auto-detects error vs success from the text, or pass a type explicitly.
import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';

let pushFn = null;
let idc = 1;

function guessType(msg) {
  const s = String(msg || '').toLowerCase();
  if (/fail|error|can.?t|cannot|not allowed|invalid|required|denied|no access|wrong|unable|must|already|couldn|don.?t have|not found|empty|too (big|large)|permission/.test(s)) return 'error';
  if (/success|saved|done|added|updated|created|sent|approved|redeemed|requested|removed|deleted|reset|marked|granted/.test(s)) return 'success';
  return 'info';
}

const STYLES = {
  error: { bg: '#FEF2F2', border: '#FECACA', bar: '#DC2626', icon: '⚠️', title: 'Something went wrong' },
  success: { bg: '#F0FDF4', border: '#BBF7D0', bar: '#16A34A', icon: '✓', title: 'Success' },
  info: { bg: '#FFF7ED', border: '#FED7AA', bar: '#FF6A00', icon: 'ℹ️', title: 'Notice' },
};

function ToastHost() {
  const [items, setItems] = useState([]);
  const push = useCallback((message, type) => {
    const id = idc++;
    const t = type || guessType(message);
    setItems((prev) => [...prev, { id, message: String(message || ''), type: t }]);
    setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), 4200);
  }, []);
  useEffect(() => { pushFn = push; return () => { pushFn = null; }; }, [push]);
  return (
    <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 100000, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 'min(92vw, 380px)', pointerEvents: 'none' }}>
      {items.map((t) => {
        const s = STYLES[t.type] || STYLES.info;
        return (
          <div key={t.id} onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
            style={{ pointerEvents: 'auto', cursor: 'pointer', background: s.bg, border: `1px solid ${s.border}`, borderLeft: `4px solid ${s.bar}`, borderRadius: 14, boxShadow: '0 10px 30px rgba(2,6,23,.12)', padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'flex-start', fontFamily: 'Plus Jakarta Sans, system-ui, sans-serif', animation: 'qtx-toast-in .22s ease-out' }}>
            <span style={{ fontSize: 16, lineHeight: '20px', color: s.bar }}>{s.icon}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: '#0A0E28', marginBottom: 2 }}>{s.title}</div>
              <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.4, wordBreak: 'break-word' }}>{t.message}</div>
            </div>
          </div>
        );
      })}
      <style>{`@keyframes qtx-toast-in{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:translateX(0)}}`}</style>
    </div>
  );
}

let mounted = false;
function ensureMounted() {
  if (mounted || typeof document === 'undefined') return;
  mounted = true;
  const el = document.createElement('div');
  el.id = 'qtx-toast-root';
  document.body.appendChild(el);
  createRoot(el).render(<ToastHost />);
}

// The drop-in replacement for alert(). Signature-compatible (message[, type]).
export function toast(message, type) {
  ensureMounted();
  // pushFn may not be ready on the very first call; retry on next tick.
  if (pushFn) pushFn(message, type);
  else setTimeout(() => pushFn && pushFn(message, type), 30);
}

export default toast;

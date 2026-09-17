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

// ===== Themed confirm / prompt dialogs (replace browser confirm()/prompt()) ==
let dialogPushFn = null;

function DialogHost() {
  const [dlg, setDlg] = useState(null); // { kind, title, message, confirmText, cancelText, danger, defaultValue, placeholder, resolve }
  const [val, setVal] = useState('');
  useEffect(() => { dialogPushFn = (d) => { setVal(d.defaultValue || ''); setDlg(d); }; return () => { dialogPushFn = null; }; }, []);
  if (!dlg) return null;
  const close = (result) => { dlg.resolve(result); setDlg(null); };
  const isPrompt = dlg.kind === 'prompt';
  const accent = dlg.danger ? '#DC2626' : '#FF6A00';
  return (
    <div onClick={() => close(isPrompt ? null : false)}
      style={{ position: 'fixed', inset: 0, zIndex: 2147483600, background: 'rgba(10,14,40,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: 'Plus Jakarta Sans, system-ui, sans-serif', animation: 'qtx-dlg-fade .15s ease-out' }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 18, width: '100%', maxWidth: 400, boxShadow: '0 30px 70px rgba(2,6,23,.35)', overflow: 'hidden', animation: 'qtx-dlg-pop .2s cubic-bezier(.2,.9,.3,1.15)' }}>
        <div style={{ padding: '22px 22px 6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: dlg.message ? 8 : 0 }}>
            <span style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, background: dlg.danger ? '#FEF2F2' : '#FFF7ED' }}>{dlg.danger ? '🗑️' : (isPrompt ? '✏️' : '❓')}</span>
            <div style={{ fontSize: 16.5, fontWeight: 800, color: '#0A0E28', lineHeight: 1.25 }}>{dlg.title}</div>
          </div>
          {dlg.message && <div style={{ fontSize: 13.5, color: '#64748b', lineHeight: 1.5, paddingLeft: 49 }}>{dlg.message}</div>}
          {isPrompt && (
            <div style={{ marginTop: 14 }}>
              <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} placeholder={dlg.placeholder || ''}
                onKeyDown={(e) => { if (e.key === 'Enter') close(val); if (e.key === 'Escape') close(null); }}
                style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', fontSize: 14, outline: 'none' }} />
            </div>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '16px 22px 20px' }}>
          <button onClick={() => close(isPrompt ? null : false)}
            style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>{dlg.cancelText || 'Cancel'}</button>
          <button autoFocus={!isPrompt} onClick={() => close(isPrompt ? val : true)}
            style={{ background: dlg.danger ? '#DC2626' : 'linear-gradient(90deg,#FF6A00,#FF4500)', color: '#fff', border: 'none', borderRadius: 10, padding: '9px 18px', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>{dlg.confirmText || (dlg.danger ? 'Delete' : (isPrompt ? 'Save' : 'Confirm'))}</button>
        </div>
      </div>
      <style>{`@keyframes qtx-dlg-fade{from{opacity:0}to{opacity:1}}@keyframes qtx-dlg-pop{from{opacity:0;transform:scale(.96) translateY(8px)}to{opacity:1;transform:none}}`}</style>
    </div>
  );
}

let dialogMounted = false;
function ensureDialogMounted() {
  if (dialogMounted || typeof document === 'undefined') return;
  dialogMounted = true;
  const el = document.createElement('div'); el.id = 'qtx-dialog-root';
  document.body.appendChild(el);
  createRoot(el).render(<DialogHost />);
}

// Themed replacement for window.confirm(). Returns a Promise<boolean>.
// opts: { title, message, confirmText, cancelText, danger }
export function confirmDialog(opts) {
  ensureDialogMounted();
  const o = typeof opts === 'string' ? { title: opts } : (opts || {});
  return new Promise((resolve) => {
    const fire = () => dialogPushFn({ kind: 'confirm', title: o.title || 'Are you sure?', message: o.message || '', confirmText: o.confirmText, cancelText: o.cancelText, danger: !!o.danger, resolve });
    if (dialogPushFn) fire(); else setTimeout(fire, 40);
  });
}

// Themed replacement for window.prompt(). Returns Promise<string|null>.
export function promptDialog(opts) {
  ensureDialogMounted();
  const o = typeof opts === 'string' ? { title: opts } : (opts || {});
  return new Promise((resolve) => {
    const fire = () => dialogPushFn({ kind: 'prompt', title: o.title || 'Enter a value', message: o.message || '', confirmText: o.confirmText || 'Save', cancelText: o.cancelText, defaultValue: o.defaultValue || '', placeholder: o.placeholder || '', resolve });
    if (dialogPushFn) fire(); else setTimeout(fire, 40);
  });
}

export default toast;

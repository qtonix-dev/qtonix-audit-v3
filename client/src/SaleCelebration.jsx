import React, { useState, useEffect, useRef } from 'react';
import { api } from './App.jsx';

// ---------------------------------------------------------------------------
// Full-screen "just closed a deal" celebration. Polls for sale wins the current
// user hasn't seen, then plays each one for 10 seconds (click anywhere to skip
// to the next). Rotating white rays radiate from behind the agent's photo.
//
// Shown on every page for every logged-in user (agents, managers, admins).
// Catch-up is per-user and unbounded in time — a user logging in later still
// sees wins they missed, once each.
// ---------------------------------------------------------------------------

const DISPLAY_MS = 10000;
const POLL_MS = 20000;

function initials(name) {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}
const usd = (n) => `$${Number(n || 0).toLocaleString()}`;

export default function SaleCelebration() {
  const [queue, setQueue] = useState([]); // unseen celebrations to play
  const [current, setCurrent] = useState(null);
  const timerRef = useRef(null);
  const seenRef = useRef(new Set()); // ids already queued this session (dedupe)

  // Poll the server for unseen celebrations and append new ones to the queue.
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await api('/leads/pending-celebrations');
        if (!alive) return;
        const fresh = (r.celebrations || []).filter((c) => !seenRef.current.has(c.id));
        if (fresh.length) {
          fresh.forEach((c) => seenRef.current.add(c.id));
          setQueue((q) => [...q, ...fresh]);
        }
      } catch { /* ignore — try again next poll */ }
    };
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Pull the next item off the queue when nothing is showing.
  useEffect(() => {
    if (current || queue.length === 0) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    setCurrent(next);
  }, [queue, current]);

  // While one is showing, mark it seen and auto-advance after 10s.
  useEffect(() => {
    if (!current) return;
    api('/leads/celebrations/seen', { method: 'POST', body: JSON.stringify({ ids: [current.id] }) }).catch(() => {});
    timerRef.current = setTimeout(() => setCurrent(null), DISPLAY_MS);
    return () => clearTimeout(timerRef.current);
  }, [current]);

  if (!current) return null;

  // Click anywhere dismisses immediately and advances to the next (so people
  // aren't blocked from working when several fire at once).
  const dismiss = () => { clearTimeout(timerRef.current); setCurrent(null); };

  return (
    <div onClick={dismiss}
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center cursor-pointer select-none"
      style={{ background: 'radial-gradient(circle at center, #0B1533 0%, #050A1F 70%)', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <style>{`
        @keyframes qtx-ray-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes qtx-cele-in { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }
        @keyframes qtx-pop-in { 0% { opacity: 0; transform: translateY(14px); } 100% { opacity: 1; transform: translateY(0); } }
      `}</style>

      <div className="relative flex items-center justify-center" style={{ animation: 'qtx-cele-in 0.5s ease-out' }}>
        {/* Rotating white rays behind the photo */}
        <div className="absolute rounded-full" style={{
          width: '46vw', height: '46vw', maxWidth: 640, maxHeight: 640,
          animation: 'qtx-ray-spin 12s linear infinite',
          background: 'repeating-conic-gradient(from 0deg, rgba(255,255,255,0.16) 0deg 6deg, rgba(255,255,255,0) 6deg 14deg)',
          maskImage: 'radial-gradient(circle, transparent 26%, black 30%, black 70%, transparent 74%)',
          WebkitMaskImage: 'radial-gradient(circle, transparent 26%, black 30%, black 70%, transparent 74%)',
        }} />
        {/* Soft glow ring */}
        <div className="absolute rounded-full" style={{
          width: '20vw', height: '20vw', maxWidth: 260, maxHeight: 260,
          boxShadow: '0 0 80px 20px rgba(255,106,0,0.35)',
        }} />
        {/* Agent photo / initials */}
        <div className="relative rounded-full overflow-hidden border-4 border-white shadow-2xl flex items-center justify-center bg-gradient-to-br from-[#FF6A00] to-[#FF4500]"
          style={{ width: '18vw', height: '18vw', maxWidth: 230, maxHeight: 230, minWidth: 140, minHeight: 140 }}>
          {current.avatar
            ? <img src={current.avatar} alt={current.ownerName} className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            : <span className="text-white font-extrabold" style={{ fontSize: '5vw' }}>{initials(current.ownerName)}</span>}
        </div>
      </div>

      <div className="text-center mt-10 px-6" style={{ animation: 'qtx-pop-in 0.6s ease-out 0.2s both' }}>
        <div className="text-white font-extrabold leading-tight" style={{ fontSize: 'clamp(28px, 5vw, 64px)' }}>
          {current.ownerName}
        </div>
        <div className="text-white/80 font-semibold mt-2" style={{ fontSize: 'clamp(16px, 2.4vw, 34px)' }}>
          just closed a deal worth <span className="text-[#FF8A3D] font-extrabold">{usd(current.amountUsd)}</span>
        </div>
      </div>

      <div className="absolute bottom-8 text-white/30 text-xs font-semibold uppercase tracking-widest">
        Tap anywhere to dismiss
      </div>
    </div>
  );
}

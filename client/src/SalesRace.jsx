import React, { useState, useEffect, useRef } from 'react';
import { api } from './App.jsx';

// ---------------------------------------------------------------------------
// Full-screen "Daily Sales" style race. Each active agent is a car; its
// distance along the track = sales achieved as a % of monthly target. 0% sits
// on the start line, 100% reaches the finish line, >100% parks past the finish.
//
// On open we play a one-shot cinematic: the grid of cars is stacked behind the
// start line and the camera pans forward; when the start line reaches the
// screen the cars launch to their live positions. It does not loop — close and
// reopen to replay. While open we poll so a fresh sale nudges a car forward.
// ---------------------------------------------------------------------------

const LANE_H = 92;      // px per lane
const VISIBLE_LANES = 6; // how many cars fill the screen at the start line
const POLL_MS = 30000;

const CAR_COLORS = ['#FF4500', '#7C3AED', '#2563EB', '#0891B2', '#DB2777', '#E5484D', '#16A34A', '#F59E0B'];
const usd = (n) => `$${Number(n || 0).toLocaleString()}`;
const initials = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

// A small stylised F1-style car (original art), tinted per lane.
function Car({ color }) {
  return (
    <svg viewBox="0 0 120 50" width="108" height="45" style={{ filter: 'drop-shadow(0 3px 4px rgba(0,0,0,0.35))' }}>
      {/* rear wing */}
      <rect x="2" y="12" width="10" height="26" rx="2" fill={color} />
      {/* body */}
      <path d="M12 22 L40 20 L74 14 L96 18 L112 24 L112 28 L96 32 L74 36 L40 30 L12 28 Z" fill={color} />
      <path d="M60 19 L84 16 L98 20 L98 22 L74 24 Z" fill="rgba(255,255,255,0.25)" />
      {/* cockpit */}
      <ellipse cx="70" cy="22" rx="9" ry="6" fill="#0B1533" />
      {/* nose cone */}
      <path d="M112 24 L120 25 L112 28 Z" fill={color} />
      {/* front wing */}
      <rect x="104" y="12" width="6" height="26" rx="2" fill={color} />
      {/* tyres */}
      <circle cx="36" cy="38" r="9" fill="#111" /><circle cx="36" cy="38" r="3.5" fill="#444" />
      <circle cx="92" cy="38" r="9" fill="#111" /><circle cx="92" cy="38" r="3.5" fill="#444" />
      <circle cx="36" cy="12" r="8" fill="#111" /><circle cx="36" cy="12" r="3" fill="#444" />
      <circle cx="92" cy="12" r="8" fill="#111" /><circle cx="92" cy="12" r="3" fill="#444" />
    </svg>
  );
}

function RankBadge({ rank }) {
  const label = rank === 1 ? '1ST' : rank === 2 ? '2ND' : rank === 3 ? '3RD' : `${rank}TH`;
  const bg = rank === 1 ? '#FF6A00' : rank === 2 ? '#7C3AED' : rank === 3 ? '#0891B2' : '#64748B';
  return <span className="text-[10px] font-extrabold text-white px-1.5 py-0.5 rounded" style={{ background: bg }}>{label}</span>;
}

export default function SalesRace({ onClose }) {
  const [racers, setRacers] = useState(null);
  const [err, setErr] = useState('');
  const [launched, setLaunched] = useState(false); // cars moved to their positions?
  const [panDone, setPanDone] = useState(false);
  const scrollRef = useRef(null);

  // Load once, then poll live while open.
  useEffect(() => {
    let alive = true;
    const load = () => api('/leads/sales-race')
      .then((r) => { if (alive) { setRacers(r.racers || []); setErr(''); } })
      .catch((e) => { if (alive && !racers) setErr(e.message); });
    load();
    const t = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line
  }, []);

  // Cinematic intro: pan from the back of the grid to the start line, then launch.
  useEffect(() => {
    if (!racers || racers.length === 0) return;
    const el = scrollRef.current;
    // Start scrolled to the back of the grid (bottom), pan up to the start line.
    if (el) el.scrollTop = el.scrollHeight;
    const panMs = Math.min(4200, 1200 + racers.length * 220);
    // Smooth-scroll to the top (start line) over panMs.
    const startTop = el ? el.scrollTop : 0;
    const t0 = performance.now();
    let raf;
    const step = (now) => {
      const p = Math.min(1, (now - t0) / panMs);
      const ease = 1 - Math.pow(1 - p, 3);
      if (el) el.scrollTop = startTop * (1 - ease);
      if (p < 1) { raf = requestAnimationFrame(step); }
      else { setPanDone(true); setTimeout(() => setLaunched(true), 400); }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [racers && racers.length]);

  const replay = () => { setLaunched(false); setPanDone(false);
    const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight;
    setTimeout(() => { setPanDone(true); setTimeout(() => setLaunched(true), 400); }, 50);
    // re-run pan
    requestAnimationFrame(() => {
      const e2 = scrollRef.current; if (!e2) return;
      const startTop = e2.scrollHeight; e2.scrollTop = startTop; const t0 = performance.now(); const panMs = 2600;
      const step = (now) => { const p = Math.min(1, (now - t0) / panMs); const ease = 1 - Math.pow(1 - p, 3); e2.scrollTop = startTop * (1 - ease); if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  };

  // Track geometry: the lane runs from the start line (left) to the finish
  // (right). A car at pct% sits pct/100 of the way; >100% parks just past finish.
  const TRACK_LEFT = 210;   // px reserved for the name/photo label
  const posPct = (r) => {
    if (!launched) return 0;
    if (r.pct == null) return 0;
    return Math.max(0, Math.min(112, r.pct)); // cap a bit past finish for >100%
  };

  return (
    <div className="fixed inset-0 z-[9998] flex flex-col" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      {/* Header strip */}
      <div className="shrink-0 px-8 py-5 flex items-center justify-between" style={{ background: 'linear-gradient(90deg,#7CB518,#5C8A00)' }}>
        <div>
          <div className="text-white font-black tracking-tight leading-none" style={{ fontSize: 'clamp(28px,4vw,52px)', textShadow: '0 2px 0 rgba(0,0,0,0.15)' }}>
            DAILY <span style={{ color: '#EAF7C9' }}>SALES</span>
          </div>
          <div className="text-white/90 font-bold uppercase tracking-widest mt-1" style={{ fontSize: 'clamp(10px,1.1vw,15px)' }}>
            Who can make the most sales this month?
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-block text-[#3A5200] bg-[#DCEBAF] font-extrabold uppercase tracking-wider rounded-lg px-4 py-2 text-xs">Live standings</span>
          <button onClick={replay} className="text-white/90 hover:text-white font-bold text-sm rounded-lg px-3 py-2 bg-black/10">↻ Replay</button>
          <button onClick={onClose} className="text-white hover:text-white font-bold text-sm rounded-lg px-4 py-2 bg-black/20">✕ Close</button>
        </div>
      </div>

      {/* Track area */}
      <div ref={scrollRef} className="flex-1 overflow-hidden relative" style={{ background: 'linear-gradient(180deg,#4C1D95 0%,#3B1470 100%)' }}>
        {err ? (
          <div className="h-full flex items-center justify-center text-white/70">{err}</div>
        ) : !racers ? (
          <div className="h-full flex items-center justify-center text-white/70">Warming up the grid…</div>
        ) : racers.length === 0 ? (
          <div className="h-full flex items-center justify-center text-white/70">No agents to race yet.</div>
        ) : (
          <div className="relative" style={{ minHeight: '100%', padding: '24px 0' }}>
            {/* Finish line (right side) */}
            <div className="absolute top-0 bottom-0" style={{ right: '5%', width: 26,
              backgroundImage: 'repeating-conic-gradient(#fff 0% 25%, #111 0% 50%)', backgroundSize: '13px 13px', opacity: 0.9 }} />
            <div className="absolute top-2 font-black text-white/80 tracking-widest" style={{ right: 'calc(5% + 34px)', writingMode: 'vertical-rl', fontSize: 14 }}>FINISH</div>

            {/* Lanes */}
            {racers.map((r, i) => {
              const color = CAR_COLORS[i % CAR_COLORS.length];
              return (
                <div key={r.id} className="relative flex items-center" style={{ height: LANE_H }}>
                  {/* lane divider */}
                  <div className="absolute left-0 right-0 border-b border-white/10" style={{ bottom: 0 }} />

                  {/* name + photo label */}
                  <div className="absolute z-10 flex items-center gap-2 bg-white rounded-full pl-1 pr-3 py-1 shadow-lg" style={{ left: 12 }}>
                    <div className="w-9 h-9 rounded-full overflow-hidden border border-slate-200 flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ background: 'linear-gradient(135deg,#FF6A00,#FF4500)' }}>
                      {r.avatar ? <img src={r.avatar} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : initials(r.name)}
                    </div>
                    <div className="leading-tight">
                      <div className="flex items-center gap-1.5"><RankBadge rank={r.rank} /></div>
                      <div className="text-[13px] font-extrabold text-[#050A1F] -mt-0.5">{r.name}</div>
                    </div>
                  </div>

                  {/* the car — positioned along the track by % */}
                  <div className="absolute" style={{
                    left: `calc(${TRACK_LEFT}px + ${posPct(r)}/112 * (95% - ${TRACK_LEFT}px))`,
                    transition: 'left 2.6s cubic-bezier(0.22,1,0.36,1)',
                    top: '50%', transform: 'translateY(-50%)',
                  }}>
                    <div className="relative">
                      <Car color={color} />
                      <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-extrabold text-white">
                        {r.hasTarget ? `${r.pct ?? 0}%` : 'no target'} · <span className="text-[#FFD27A]">{usd(r.achievedUsd)}</span>
                      </div>
                    </div>
                  </div>

                  {/* start line marker (left) */}
                  <div className="absolute top-0 bottom-0" style={{ left: TRACK_LEFT, width: 4, background: 'rgba(255,255,255,0.55)' }} />
                </div>
              );
            })}
            <div className="absolute font-black text-white/70 tracking-widest" style={{ left: TRACK_LEFT + 8, top: 2, fontSize: 12 }}>START</div>
          </div>
        )}
      </div>

      {/* Footer note */}
      <div className="shrink-0 px-8 py-2.5 text-center text-white/50 text-[11px] bg-[#2B0F55]">
        Cars advance with each agent's sales vs their monthly target · updates live
      </div>
    </div>
  );
}

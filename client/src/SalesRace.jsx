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

const LANE_H = 104;      // px per lane
const VISIBLE_LANES = 6; // how many cars fill the screen at the start line
const POLL_MS = 30000;

const CAR_COLORS = ['#FF4500', '#7C3AED', '#2563EB', '#0891B2', '#DB2777', '#E5484D', '#16A34A', '#F59E0B'];
const usd = (n) => `$${Number(n || 0).toLocaleString()}`;
const initials = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

// A GT-style racing car in side profile (original art — no branding), tinted
// per lane. Faces right (toward the finish). Wheels spin while `moving`.
function Car({ color, moving }) {
  const uid = color.replace('#', '');
  const wheel = (cx) => (
    <g>
      {/* tyre */}
      <circle cx={cx} cy="92" r="26" fill="#111" />
      <circle cx={cx} cy="92" r="26" fill="none" stroke="#000" strokeWidth="3" />
      {/* rim + split spokes, spinning while moving */}
      <g style={moving ? { animation: 'qtx-wheel 0.4s linear infinite', transformOrigin: `${cx}px 92px` } : undefined}>
        <circle cx={cx} cy="92" r="15" fill="#c9ced6" />
        <circle cx={cx} cy="92" r="15" fill="none" stroke="#9aa0aa" strokeWidth="1.5" />
        {Array.from({ length: 10 }).map((_, k) => (
          <rect key={k} x={cx - 1} y="79" width="2" height="13" fill="#7b818b" transform={`rotate(${k * 36} ${cx} 92)`} />
        ))}
        <circle cx={cx} cy="92" r="4.5" fill="#4b5059" />
      </g>
    </g>
  );
  return (
    <svg viewBox="0 0 300 130" width="168" height="73" style={{ filter: 'drop-shadow(0 6px 6px rgba(0,0,0,0.35))', overflow: 'visible' }}>
      <defs>
        <linearGradient id={`body-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="22%" stopColor="#fff" stopOpacity="0.18" />
          <stop offset="48%" stopColor={color} stopOpacity="1" />
          <stop offset="100%" stopColor={color} stopOpacity="1" />
        </linearGradient>
        <linearGradient id={`glass-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5b6577" />
          <stop offset="100%" stopColor="#20283a" />
        </linearGradient>
      </defs>

      {/* ground shadow */}
      <ellipse cx="150" cy="118" rx="140" ry="8" fill="rgba(0,0,0,0.18)" />

      {/* rear wing (back / left) */}
      <path d="M2 40 L52 40 L52 47 L8 47 Z" fill={color} />
      <path d="M2 40 L52 40 L50 44 L4 44 Z" fill="rgba(0,0,0,0.25)" />
      <rect x="10" y="44" width="6" height="26" rx="2" fill={color} />
      <rect x="40" y="46" width="6" height="24" rx="2" fill={color} />

      {/* lower side skirt / splitter */}
      <path d="M28 96 L280 96 L272 104 L40 104 Z" fill="rgba(0,0,0,0.5)" />

      {/* main body — long low GT profile, nose tapering to the right */}
      <path d="M10 84
               C 14 74, 26 70, 46 69
               L 70 68
               C 84 60, 96 52, 116 47
               C 140 41, 176 40, 206 45
               C 236 50, 262 60, 286 74
               C 292 78, 292 86, 284 89
               C 250 92, 60 92, 30 92
               C 16 92, 8 90, 10 84 Z"
            fill={`url(#body-${uid})`} stroke="rgba(0,0,0,0.28)" strokeWidth="1.5" />

      {/* cabin / greenhouse — raked windscreen like the references */}
      <path d="M96 50
               C 112 42, 132 38, 156 39
               C 176 40, 196 44, 210 52
               C 196 55, 180 56, 156 56
               C 132 56, 112 55, 96 50 Z"
            fill={`url(#glass-${uid})`} stroke="rgba(0,0,0,0.35)" strokeWidth="1" />
      {/* A-pillar + door line */}
      <path d="M150 40 L150 56" stroke="rgba(0,0,0,0.25)" strokeWidth="1.5" />
      {/* window glare */}
      <path d="M104 49 C 120 43, 140 41, 158 42 L 170 45 C 146 46, 122 48, 104 49 Z" fill="rgba(255,255,255,0.22)" />

      {/* side livery stripe in a lighter tint */}
      <path d="M40 80 L276 80 L276 86 L40 86 Z" fill="rgba(255,255,255,0.55)" />
      <path d="M40 86 L276 86 L276 89 L40 89 Z" fill="rgba(0,0,0,0.18)" />

      {/* door racing number */}
      <circle cx="150" cy="72" r="12" fill="#fff" opacity="0.95" />
      <text x="150" y="77" textAnchor="middle" fontSize="15" fontWeight="900" fill={color}>1</text>

      {/* headlight (front/right) + taillight (rear/left) */}
      <path d="M278 70 L288 73 L286 78 L276 76 Z" fill="rgba(255,255,255,0.85)" />
      <rect x="20" y="72" width="7" height="5" rx="1" fill="#ffd27a" opacity="0.9" />

      {/* wheel arches (dark cutouts) */}
      <path d="M46 92 a26 26 0 0 1 52 0 Z" fill="rgba(0,0,0,0.35)" />
      <path d="M202 92 a26 26 0 0 1 52 0 Z" fill="rgba(0,0,0,0.35)" />

      {wheel(72)}
      {wheel(228)}
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
      <style>{`
        @keyframes qtx-smoke {
          0% { opacity: 0.6; transform: translateY(-50%) scale(0.5); }
          100% { opacity: 0; transform: translateY(-50%) translateX(-40px) scale(1.9); }
        }
        @keyframes qtx-wheel { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes qtx-bob {
          0%,100% { transform: translateY(0) rotate(-0.4deg); }
          50% { transform: translateY(-2px) rotate(0.4deg); }
        }
        @keyframes qtx-idle {
          0%,100% { transform: translateY(0); }
          50% { transform: translateY(-1px); }
        }
      `}</style>
      {/* Header strip */}
      <div className="shrink-0 px-8 py-5 flex items-center justify-between" style={{ background: 'linear-gradient(90deg,#7CB518,#5C8A00)' }}>
        <div>
          <div className="text-white font-black tracking-tight leading-none" style={{ fontSize: 'clamp(24px,3.4vw,46px)', textShadow: '0 2px 0 rgba(0,0,0,0.15)' }}>
            MONTHLY <span style={{ color: '#EAF7C9' }}>SALES LEADERBOARD</span>
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
              const moving = launched && (r.pct || 0) > 0;
              const moved = launched && (r.pct || 0) > 0; // has left the start line
              return (
                <div key={r.id} className="relative flex items-center" style={{ height: LANE_H }}>
                  {/* lane divider */}
                  <div className="absolute left-0 right-0 border-b border-white/10" style={{ bottom: 0 }} />

                  {/* start line marker (left) */}
                  <div className="absolute top-0 bottom-0" style={{ left: TRACK_LEFT, width: 4, background: 'rgba(255,255,255,0.55)' }} />

                  {/* Car + label move together. At 0% the car sits BEFORE the
                      start line; as % rises it advances toward the finish. */}
                  <div className="absolute z-10" style={{
                    left: `calc(${TRACK_LEFT}px + ${posPct(r)}/112 * (95% - ${TRACK_LEFT}px))`,
                    transition: 'left 5.5s cubic-bezier(0.33,0.02,0.30,1)',
                    top: '50%', transform: 'translateY(-50%)',
                  }}>
                    <div className="flex items-center gap-2" style={{ transform: 'translateX(-100%)', paddingRight: 6 }}>
                      {/* tyre-burn smoke — denser trail while moving */}
                      {moving && (
                        <div className="absolute" style={{ right: -6, top: '58%' }}>
                          {[0, 1, 2, 3, 4, 5].map((k) => (
                            <span key={k} className="absolute rounded-full" style={{
                              width: 18 + k * 7, height: 18 + k * 7,
                              background: 'radial-gradient(circle, rgba(210,210,210,0.6), rgba(190,190,190,0))',
                              right: k * 16, top: -(9 + k * 4),
                              animation: `qtx-smoke 1.2s ease-out ${k * 0.12}s infinite`,
                            }} />
                          ))}
                        </div>
                      )}

                      {/* Agent card — travels with the car. Photo on the left;
                          on the right: rank (once moved), name, then % + amount.
                          A roomy card so nothing feels cramped. */}
                      <div className="flex items-center gap-3 bg-white rounded-2xl pl-2 pr-4 py-2 shadow-lg shrink-0" style={{ minWidth: 190 }}>
                        <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-slate-100 flex items-center justify-center text-white text-sm font-bold shrink-0" style={{ background: 'linear-gradient(135deg,#FF6A00,#FF4500)' }}>
                          {r.avatar ? <img src={r.avatar} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : initials(r.name)}
                        </div>
                        <div className="leading-tight min-w-0">
                          {moved && <div className="mb-0.5"><RankBadge rank={r.rank} /></div>}
                          <div className="text-[14px] font-extrabold text-[#050A1F] truncate">{r.name}</div>
                          <div className="text-[12px] font-bold mt-0.5">
                            {r.hasTarget
                              ? <><span style={{ color }}>{r.pct ?? 0}%</span> <span className="text-slate-400">·</span> <span className="text-slate-600">{usd(r.achievedUsd)}</span></>
                              : <span className="text-slate-400">no target · {usd(r.achievedUsd)}</span>}
                          </div>
                        </div>
                      </div>

                      {/* the car itself — gentle idle/drive bob */}
                      <div className="relative shrink-0" style={{ animation: moving ? 'qtx-bob 0.5s ease-in-out infinite' : (launched ? 'qtx-idle 2.4s ease-in-out infinite' : undefined) }}>
                        <Car color={color} moving={moving} />
                      </div>
                    </div>
                  </div>
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

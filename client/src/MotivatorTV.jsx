import React, { useState, useEffect, useRef } from 'react';
import { API_BASE } from './config.js';

/**
 * Motivator TV — a full-screen, auto-rotating sales board for an office TV.
 *
 * Runs unauthenticated behind a long token in the URL. Designed to be readable
 * from across a room: oversized type, high contrast, one idea per slide.
 */

const usd = (n) => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const initials = (name) => (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

// Set once when the board data loads; used as the avatar fallback when a person
// has no photo (per the requirement to show the company logo in that case).
let TV_COMPANY_LOGO = '';

const C = {
  navy: '#22303F',
  navyDark: '#1B2733',
  panel: '#F1F2F4',
  blue: '#2F6FAF',
  blueLink: '#2E7CC4',
  green: '#4CAF50',
  orange: '#E8562A',
};

function Avatar({ name, src, size = 96, rank, logo }) {
  const img = src || logo || TV_COMPANY_LOGO;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {img ? (
        <img src={img} alt={name} className="rounded-full object-cover w-full h-full"
          style={{ border: `4px solid ${C.orange}`, background: '#fff' }} />
      ) : (
        <div className="rounded-full w-full h-full flex items-center justify-center font-bold text-white"
          style={{ background: '#9AA6B2', border: `4px solid ${C.orange}`, fontSize: size * 0.34 }}>
          {initials(name)}
        </div>
      )}
      {rank != null && (
        <div className="absolute left-1/2 -translate-x-1/2 rounded-full text-white font-bold flex items-center justify-center"
          style={{ bottom: -8, width: size * 0.3, height: size * 0.3, background: C.orange, fontSize: size * 0.16 }}>
          {rank}
        </div>
      )}
    </div>
  );
}

/** Countdown to the end of the month, in IST. */
function Countdown({ monthEndIso }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const end = new Date(monthEndIso);
  const diff = Math.max(0, end - new Date());
  const days = Math.floor(diff / 86400000);
  const hrs = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  const Cell = ({ v, l }) => (
    <div className="text-center px-1.5">
      <div className="text-white font-bold leading-none" style={{ fontSize: '2.1vw' }}>{String(v).padStart(2, '0')}</div>
      <div className="text-white/80 font-semibold" style={{ fontSize: '0.62vw', letterSpacing: '0.06em' }}>{l}</div>
    </div>
  );
  return (
    <div className="h-full flex flex-col items-center justify-center px-6" style={{ background: C.green }}>
      <div className="text-white/90 font-semibold mb-1" style={{ fontSize: '0.72vw', letterSpacing: '0.14em' }}>TIME REMAINING</div>
      <div className="flex items-end">
        <Cell v={days} l="DAYS" /><span className="text-white font-bold pb-3" style={{ fontSize: '1.4vw' }}>:</span>
        <Cell v={hrs} l="HRS" /><span className="text-white font-bold pb-3" style={{ fontSize: '1.4vw' }}>:</span>
        <Cell v={mins} l="MINS" /><span className="text-white font-bold pb-3" style={{ fontSize: '1.4vw' }}>:</span>
        <Cell v={secs} l="SECS" />
      </div>
    </div>
  );
}

/** Two-column ranked list of people, as in the reference boards. */
function PeopleGrid({ rows, valueOf, subOf }) {
  const shown = (rows || []).slice(0, 6);
  const Person = ({ r, rank }) => (
    <div className="flex items-center gap-5">
      <Avatar name={r.name} src={r.avatar} size={92} rank={rank} />
      <div className="min-w-0">
        <div className="font-semibold truncate" style={{ color: C.blueLink, fontSize: '1.25vw', letterSpacing: '0.02em' }}>
          {r.name.toUpperCase()}
        </div>
        <div className="font-bold text-slate-800 leading-tight" style={{ fontSize: '2.6vw' }}>{valueOf(r)}</div>
        {subOf && <div className="text-slate-500" style={{ fontSize: '0.85vw' }}>{subOf(r)}</div>}
      </div>
    </div>
  );

  // Minimal data reads best centered rather than stretched across two columns.
  if (shown.length === 0) {
    return <div className="h-full flex items-center justify-center text-slate-400" style={{ fontSize: '1.6vw' }}>No data yet</div>;
  }
  if (shown.length === 1) {
    return <div className="h-full flex items-center justify-center px-14">{<Person r={shown[0]} rank={1} />}</div>;
  }
  if (shown.length === 2) {
    // One centered row, both side by side.
    return (
      <div className="h-full flex items-center justify-center gap-24 px-14">
        {shown.map((r, i) => <Person key={r.id} r={r} rank={i + 1} />)}
      </div>
    );
  }
  if (shown.length <= 4) {
    // A single centered column keeps rows aligned and avoids an empty gap.
    return (
      <div className="h-full flex flex-col items-center justify-center gap-10 px-14">
        {shown.map((r, i) => <Person key={r.id} r={r} rank={i + 1} />)}
      </div>
    );
  }
  // 5–6 people: two balanced columns.
  const left = shown.filter((_, i) => i % 2 === 0);
  const right = shown.filter((_, i) => i % 2 === 1);
  const Col = ({ items, offset }) => (
    <div className="flex-1 flex flex-col justify-around gap-6">
      {items.map((r, i) => <Person key={r.id} r={r} rank={offset + i * 2 + 1} />)}
    </div>
  );
  return (
    <div className="flex gap-10 h-full px-14 py-8 items-center">
      <Col items={left} offset={0} />
      <Col items={right} offset={1} />
    </div>
  );
}

/** Horizontal progress bar used on the target slides. */
function Bar({ pct, height = 22 }) {
  const p = Math.max(0, Math.min(100, pct || 0));
  return (
    <div className="w-full rounded-full overflow-hidden" style={{ background: '#D8DCE1', height }}>
      <div className="h-full rounded-full transition-all"
        style={{ width: `${Math.max(2, p)}%`, background: p >= 100 ? C.green : `linear-gradient(90deg,#FF8A3D,${C.orange})` }} />
    </div>
  );
}

/** Encouraging line that changes with how the month is going. */
function remarkFor(pct) {
  if (pct == null) return 'Set your targets to start tracking the month.';
  if (pct >= 100) return '🎉 Target smashed! Outstanding work, team — every deal counted.';
  if (pct >= 85) return '🔥 So close! One final push and the month is ours.';
  if (pct >= 60) return '💪 Strong momentum — keep the calls coming and we’ll get there.';
  if (pct >= 40) return '📈 Halfway there. Steady effort now makes all the difference.';
  if (pct > 0) return '🚀 We’re on the board. Every conversation moves the number.';
  return '☀️ Fresh month, clean slate. The first win is waiting for someone.';
}

// Full-screen sale celebration for the TV wall — same look as the in-app popup
// (rotating white rays behind the agent's photo), sized big for a display. No
// click-to-dismiss; it holds for its 2-minute turn.
function TvCelebration({ win, logo }) {
  const initials = (win.ownerName || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return (
    <div className="w-screen h-screen flex flex-col items-center justify-center overflow-hidden"
      style={{ background: 'radial-gradient(circle at center, #0B1533 0%, #050A1F 72%)', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <style>{`
        @keyframes tv-ray-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes tv-cele-in { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
      `}</style>
      <div className="relative flex items-center justify-center" style={{ animation: 'tv-cele-in 0.6s ease-out' }}>
        <div className="absolute rounded-full" style={{
          width: '58vh', height: '58vh',
          animation: 'tv-ray-spin 12s linear infinite',
          background: 'repeating-conic-gradient(from 0deg, rgba(255,255,255,0.18) 0deg 5deg, rgba(255,255,255,0) 5deg 13deg)',
          maskImage: 'radial-gradient(circle, transparent 27%, black 31%, black 70%, transparent 74%)',
          WebkitMaskImage: 'radial-gradient(circle, transparent 27%, black 31%, black 70%, transparent 74%)',
        }} />
        <div className="absolute rounded-full" style={{ width: '26vh', height: '26vh', boxShadow: '0 0 100px 24px rgba(255,106,0,0.4)' }} />
        <div className="relative rounded-full overflow-hidden border-4 border-white shadow-2xl flex items-center justify-center bg-gradient-to-br from-[#FF6A00] to-[#FF4500]"
          style={{ width: '24vh', height: '24vh' }}>
          {win.avatar
            ? <img src={win.avatar} alt={win.ownerName} className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            : <span className="text-white font-extrabold" style={{ fontSize: '7vh' }}>{initials}</span>}
        </div>
      </div>
      <div className="text-center mt-12 px-10">
        <div className="text-white font-extrabold leading-tight" style={{ fontSize: '6vh' }}>{win.ownerName}</div>
        <div className="text-white/80 font-semibold mt-3" style={{ fontSize: '3.2vh' }}>
          just closed a deal worth <span className="text-[#FF8A3D] font-extrabold">${Number(win.amountUsd || 0).toLocaleString()}</span>
        </div>
      </div>
      {logo ? <img src={logo} alt="" className="absolute bottom-8 object-contain" style={{ maxHeight: '6vh' }} /> : null}
    </div>
  );
}

export default function MotivatorTV() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [idx, setIdx] = useState(0);
  const [celebration, setCelebration] = useState(null); // current takeover win
  const celebQueue = useRef([]);
  const seenWins = useRef(new Set());
  const token = useRef((typeof window !== 'undefined' ? window.location.pathname.split('/tv/')[1] : '') || '');

  // Poll for fresh figures; the loop keeps running off the last good payload.
  // Poll fairly often so a new sale's celebration fires promptly.
  useEffect(() => {
    let alive = true;
    let first = true;
    const fetchData = () => {
      fetch(`${API_BASE}/api/tv/${token.current}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Board not available'))))
        .then((d) => {
          if (!alive) return;
          setData(d); setErr(''); TV_COMPANY_LOGO = (d && d.company && d.company.logo) || '';
          // Queue any newly-seen wins for the celebration takeover. On the very
          // first load we just record existing wins as seen (don't replay history).
          for (const w of (d.recentWins || [])) {
            if (seenWins.current.has(w.id)) continue;
            seenWins.current.add(w.id);
            if (!first) celebQueue.current.push(w);
          }
          first = false;
        })
        .catch((e) => { if (alive && !data) setErr(e.message); });
    };
    fetchData();
    const t = setInterval(fetchData, 30000);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line
  }, []);

  // Play queued celebrations one at a time, 2 minutes each.
  useEffect(() => {
    if (celebration) return;
    const tick = setInterval(() => {
      if (!celebration && celebQueue.current.length) {
        const next = celebQueue.current.shift();
        setCelebration(next);
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [celebration]);

  useEffect(() => {
    if (!celebration) return;
    const t = setTimeout(() => setCelebration(null), 120000); // 2 minutes
    return () => clearTimeout(t);
  }, [celebration]);

  // Build the slide list, skipping any with nothing to show.
  const slides = React.useMemo(() => {
    if (!data) return [];
    const co = data.company;
    const s = [];
    s.push({ id: 'welcome', title: '', dwell: 10 });
    s.push({ id: 'company', title: 'COMPANY TARGET', dwell: 14 });
    if ((data.branches || []).length) s.push({ id: 'branches', title: 'BRANCH PERFORMANCE', dwell: 8 + (data.branches.length * 4) });
    if (data.leads && data.leads.total > 0) s.push({ id: 'leadmix', title: 'LEADS GENERATED', dwell: 13 });
    if ((data.byLeads || []).length) s.push({ id: 'topleads', title: 'MOST LEADS GENERATED', dwell: 10 + Math.min(6, data.byLeads.length) * 2 });
    if ((data.salesVsTarget || []).length) s.push({ id: 'sales', title: 'SALES vs TARGET', dwell: 10 + Math.min(8, data.salesVsTarget.length) * 2 });
    if ((data.byPipeline || []).length) s.push({ id: 'pipeline', title: 'DEALS IN PIPELINE', dwell: 10 + Math.min(6, data.byPipeline.length) * 2 });
    if ((data.nearTarget || []).length) s.push({ id: 'near', title: 'ALMOST THERE', dwell: 10 + Math.min(6, data.nearTarget.length) * 2 });
    if ((data.achieved || []).length) s.push({ id: 'achieved', title: 'TARGET ACHIEVED — RUNNING FOR INCENTIVES', dwell: 10 + Math.min(6, data.achieved.length) * 2 });
    if ((data.top3 || []).length) s.push({ id: 'top3', title: 'TOP 3 THIS MONTH', dwell: 15 });
    return s;
  }, [data]);

  // Advance the loop, giving denser slides more time on screen.
  useEffect(() => {
    if (slides.length === 0) return undefined;
    const dwell = (slides[idx % slides.length] || {}).dwell || 12;
    const t = setTimeout(() => setIdx((n) => (n + 1) % slides.length), dwell * 1000);
    return () => clearTimeout(t);
  }, [idx, slides]);

  if (err) {
    return (
      <div className="w-screen h-screen flex items-center justify-center" style={{ background: C.navyDark }}>
        <div className="text-white/70 text-2xl">{err}</div>
      </div>
    );
  }
  if (!data || slides.length === 0) {
    return (
      <div className="w-screen h-screen flex items-center justify-center" style={{ background: C.navyDark }}>
        <div className="text-white/60 text-2xl">Loading board…</div>
      </div>
    );
  }

  const slide = slides[idx % slides.length];
  const co = data.company;
  const ann = data.announcements || [];

  const Body = () => {
    switch (slide.id) {
      case 'welcome':
        return (
          <div className="h-full flex flex-col items-center justify-center text-center px-16">
            <div className="text-slate-400 font-semibold" style={{ fontSize: '1.1vw', letterSpacing: '0.3em' }}>WELCOME TO</div>
            <div className="font-bold text-slate-800 mt-3" style={{ fontSize: '5vw', lineHeight: 1 }}>{co.name}</div>
            <div className="font-semibold mt-4" style={{ color: C.orange, fontSize: '2vw' }}>Sales Motivator</div>
            <div className="text-slate-500 mt-8" style={{ fontSize: '1.3vw' }}>
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
          </div>
        );

      case 'company':
        return (
          <div className="h-full flex flex-col items-center justify-center px-20">
            <div className="flex items-end gap-4">
              <span className="font-bold text-slate-800" style={{ fontSize: '6vw', lineHeight: 1 }}>{usd(co.salesUsd)}</span>
              <span className="text-slate-400 font-semibold pb-3" style={{ fontSize: '2.4vw' }}>/ {usd(co.target)}</span>
            </div>
            <div className="font-bold mt-2" style={{ color: co.pct >= 100 ? C.green : C.orange, fontSize: '3vw' }}>
              {co.pct != null ? `${co.pct}%` : '—'}
            </div>
            <div className="w-3/4 mt-6"><Bar pct={co.pct} height={26} /></div>
            <div className="text-slate-600 mt-8 text-center font-semibold" style={{ fontSize: '1.6vw' }}>{remarkFor(co.pct)}</div>
            {co.remaining > 0 && (
              <div className="text-slate-400 mt-3" style={{ fontSize: '1.2vw' }}>{usd(co.remaining)} to go</div>
            )}
          </div>
        );

      case 'branches':
        return (
          <div className="h-full flex flex-col justify-center px-16 gap-8">
            {data.branches.map((b) => (
              <div key={b.team}>
                <div className="flex items-baseline justify-between mb-2">
                  <span className="font-bold text-slate-800" style={{ fontSize: '2.2vw' }}>{b.team}</span>
                  <span className="font-bold" style={{ color: b.pct >= 100 ? C.green : C.orange, fontSize: '1.8vw' }}>
                    {usd(b.salesUsd)} <span className="text-slate-400 font-semibold">/ {usd(b.target)}</span>
                    {b.pct != null && <span className="ml-3">{b.pct}%</span>}
                  </span>
                </div>
                <Bar pct={b.pct} />
                <div className="flex gap-8 mt-3">
                  {b.shifts.map((sh) => (
                    <div key={sh.shift} className="flex items-center gap-3">
                      <span className="text-slate-500 font-semibold" style={{ fontSize: '1vw' }}>
                        {sh.shift === 'Morning' ? '🌅' : '🌙'} {sh.shift}
                      </span>
                      <span className="font-bold text-slate-700" style={{ fontSize: '1.1vw' }}>{usd(sh.salesUsd)}</span>
                      {sh.pct != null && <span className="text-slate-400" style={{ fontSize: '0.95vw' }}>({sh.pct}%)</span>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );

      case 'leadmix': {
        const l = data.leads;
        const Box = ({ label, value, color, icon }) => (
          <div className="flex-1 rounded-2xl bg-white flex flex-col items-center justify-center py-10" style={{ border: `3px solid ${color}` }}>
            <div style={{ fontSize: '2.6vw' }}>{icon}</div>
            <div className="font-bold text-slate-800 mt-2" style={{ fontSize: '5vw', lineHeight: 1 }}>{value}</div>
            <div className="font-semibold mt-2" style={{ color, fontSize: '1.3vw' }}>{label}</div>
          </div>
        );
        return (
          <div className="h-full flex flex-col justify-center px-16">
            <div className="flex gap-8">
              <Box label="PRE-SALES" value={l.presales} color="#7C3AED" icon="🎧" />
              <Box label="COLD CALLING" value={l.cold} color={C.orange} icon="📞" />
            </div>
            <div className="text-center text-slate-500 mt-8 font-semibold" style={{ fontSize: '1.4vw' }}>
              {l.total} leads generated this month
            </div>
          </div>
        );
      }

      case 'topleads':
        return <PeopleGrid rows={data.byLeads} valueOf={(r) => r.leadsGenerated}
          subOf={(r) => (r.leadGenTarget > 0 ? `of ${r.leadGenTarget} target` : 'leads this month')} />;

      case 'sales':
        return <PeopleGrid rows={data.salesVsTarget} valueOf={(r) => usd(r.salesUsd)}
          subOf={(r) => (r.salesTarget > 0 ? `of ${usd(r.salesTarget)} · ${r.pct || 0}%` : 'collected this month')} />;

      case 'pipeline':
        return <PeopleGrid rows={data.byPipeline} valueOf={(r) => usd(r.pipelineUsd)} subOf={() => 'in open deals'} />;

      case 'near':
        return <PeopleGrid rows={data.nearTarget} valueOf={(r) => `${r.pct}%`}
          subOf={(r) => `${usd(r.remaining)} to target`} />;

      case 'achieved':
        return <PeopleGrid rows={data.achieved} valueOf={(r) => `${r.pct}%`}
          subOf={(r) => `${usd(r.salesUsd)} collected 🏆`} />;

      case 'top3': {
        const podium = [data.top3[1], data.top3[0], data.top3[2]].filter(Boolean);
        const heights = { 0: '58%', 1: '78%', 2: '46%' };
        return (
          <div className="h-full flex items-end justify-center gap-10 px-20 pb-14">
            {podium.map((p, i) => {
              const realRank = p === data.top3[0] ? 1 : p === data.top3[1] ? 2 : 3;
              return (
                <div key={p.id} className="flex flex-col items-center justify-end" style={{ height: heights[i] }}>
                  <Avatar name={p.name} src={p.avatar} size={realRank === 1 ? 130 : 100} rank={realRank} />
                  <div className="font-semibold mt-4 text-center" style={{ color: C.blueLink, fontSize: '1.2vw' }}>
                    {p.name.toUpperCase()}
                  </div>
                  <div className="font-bold text-slate-800" style={{ fontSize: realRank === 1 ? '2.8vw' : '2.2vw' }}>{usd(p.salesUsd)}</div>
                  <div style={{ fontSize: '2vw' }}>{realRank === 1 ? '🥇' : realRank === 2 ? '🥈' : '🥉'}</div>
                </div>
              );
            })}
          </div>
        );
      }

      default:
        return null;
    }
  };

  // A live sale takes over the whole board for 2 minutes.
  if (celebration) {
    return <TvCelebration win={celebration} logo={(data && data.company && data.company.logo) || ''} />;
  }

  return (
    <div className="w-screen h-screen flex flex-col overflow-hidden" style={{ background: C.navyDark, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      {/* Header: brand · title · countdown */}
      <div className="flex shrink-0" style={{ height: '11vh' }}>
        <div className="flex items-center px-8" style={{ background: C.navy, width: '18%' }}>
          {co.logo ? (
            <img src={co.logo} alt={co.name || 'Company'} className="object-contain" style={{ maxHeight: '7vh', maxWidth: '100%' }} />
          ) : (
            <span className="text-white font-extrabold" style={{ fontSize: '1.4vw', letterSpacing: '0.04em' }}>
              {(co.name || 'QTONIX').toUpperCase()}
            </span>
          )}
        </div>
        <div className="flex-1 flex items-center justify-center" style={{ background: C.navy }}>
          <span className="text-white font-bold" style={{ fontSize: '2.2vw', letterSpacing: '0.04em' }}>{slide.title}</span>
        </div>
        <div style={{ width: '22%' }}><Countdown monthEndIso={data.monthEndIso} /></div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden" style={{ background: C.panel }}>
        <Body />
      </div>

      {/* Footer: announcements ticker + slide progress */}
      <div className="flex shrink-0 items-center" style={{ height: '9vh', background: C.navy }}>
        <div className="flex-1 overflow-hidden px-8">
          {ann.length > 0 ? (
            <div className="whitespace-nowrap text-white/90 font-semibold tv-ticker" style={{ fontSize: '1.2vw' }}>
              {ann.map((a, i) => <span key={i} className="mr-16">📢 {a}</span>)}
              {ann.map((a, i) => <span key={`d${i}`} className="mr-16">📢 {a}</span>)}
            </div>
          ) : (
            <span className="text-white/40" style={{ fontSize: '1.1vw' }}>Keep pushing — every call counts.</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 px-8">
          {slides.map((s, i) => (
            <span key={s.id} className="rounded-full transition-all"
              style={{
                width: i === idx % slides.length ? '2vw' : '0.6vw',
                height: '0.6vw',
                background: i === idx % slides.length ? C.orange : 'rgba(255,255,255,0.25)',
              }} />
          ))}
        </div>
      </div>
    </div>
  );
}

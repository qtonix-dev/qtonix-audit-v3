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

const C = {
  navy: '#22303F',
  navyDark: '#1B2733',
  panel: '#F1F2F4',
  blue: '#2F6FAF',
  blueLink: '#2E7CC4',
  green: '#4CAF50',
  orange: '#E8562A',
};

function Avatar({ name, src, size = 96, rank }) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {src ? (
        <img src={src} alt={name} className="rounded-full object-cover w-full h-full"
          style={{ border: `4px solid ${C.orange}` }} />
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
  const shown = rows.slice(0, 6);
  const left = shown.filter((_, i) => i % 2 === 0);
  const right = shown.filter((_, i) => i % 2 === 1);
  const Col = ({ items, offset }) => (
    <div className="flex-1 flex flex-col justify-around">
      {items.map((r, i) => {
        const rank = offset + i * 2 + 1;
        return (
          <div key={r.id} className="flex items-center gap-5">
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
      })}
    </div>
  );
  return (
    <div className="flex gap-10 h-full px-14 py-8">
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

export default function MotivatorTV() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [idx, setIdx] = useState(0);
  const token = useRef((typeof window !== 'undefined' ? window.location.pathname.split('/tv/')[1] : '') || '');

  // Poll for fresh figures; the loop keeps running off the last good payload.
  useEffect(() => {
    let alive = true;
    const fetchData = () => {
      fetch(`${API_BASE}/api/tv/${token.current}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Board not available'))))
        .then((d) => { if (alive) { setData(d); setErr(''); } })
        .catch((e) => { if (alive && !data) setErr(e.message); });
    };
    fetchData();
    const t = setInterval(fetchData, 120000);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line
  }, []);

  // Build the slide list, skipping any with nothing to show.
  const slides = React.useMemo(() => {
    if (!data) return [];
    const co = data.company;
    const s = [];
    s.push({ id: 'welcome', title: '', dwell: 10 });
    s.push({ id: 'company', title: 'COMPANY TARGET', dwell: 14 });
    if ((data.branches || []).length) s.push({ id: 'branches', title: 'BRANCH PERFORMANCE', dwell: 8 + (data.branches.length * 4) });
    if ((data.teamBoard || []).length > 1) s.push({ id: 'teams', title: 'TEAM LEADERBOARD', dwell: 8 + (data.teamBoard.length * 3) });
    if (data.leads && data.leads.total > 0) s.push({ id: 'leadmix', title: 'LEADS GENERATED', dwell: 13 });
    if ((data.byLeads || []).length) s.push({ id: 'topleads', title: 'MOST LEADS GENERATED', dwell: 10 + Math.min(6, data.byLeads.length) * 2 });
    if ((data.bySales || []).length) s.push({ id: 'sales', title: 'SALES vs TARGET', dwell: 10 + Math.min(6, data.bySales.length) * 2 });
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

      case 'teams':
        return (
          <div className="h-full flex flex-col justify-center px-20 gap-5">
            {data.teamBoard.slice(0, 6).map((t, i) => (
              <div key={`${t.team}-${t.shift}`} className="flex items-center gap-6">
                <div className="rounded-full text-white font-bold flex items-center justify-center shrink-0"
                  style={{ width: '3.4vw', height: '3.4vw', background: i === 0 ? C.orange : '#9AA6B2', fontSize: '1.5vw' }}>
                  {i + 1}
                </div>
                <div className="flex-1">
                  <div className="flex items-baseline justify-between">
                    <span className="font-bold text-slate-800" style={{ fontSize: '1.8vw' }}>{t.team} · {t.shift}</span>
                    <span className="font-bold text-slate-800" style={{ fontSize: '1.8vw' }}>{usd(t.salesUsd)}</span>
                  </div>
                  <Bar pct={t.pct} height={16} />
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
        return <PeopleGrid rows={data.bySales} valueOf={(r) => usd(r.salesUsd)}
          subOf={(r) => (r.salesTarget > 0 ? `of ${usd(r.salesTarget)} · ${r.pct}%` : 'collected this month')} />;

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

  return (
    <div className="w-screen h-screen flex flex-col overflow-hidden" style={{ background: C.navyDark, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      {/* Header: brand · title · countdown */}
      <div className="flex shrink-0" style={{ height: '11vh' }}>
        <div className="flex items-center px-8" style={{ background: C.navy, width: '18%' }}>
          <span className="text-white/70 font-semibold" style={{ fontSize: '0.85vw', letterSpacing: '0.16em' }}>
            {(co.name || 'QTONIX').toUpperCase()} TV
          </span>
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

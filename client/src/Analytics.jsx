import React, { useState, useEffect } from 'react';
import { api } from './App.jsx';

const usd = (n) => `$${Number(n || 0).toLocaleString()}`;
const compact = (n) => {
  const v = Number(n || 0);
  if (v >= 1000000) return `$${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `$${Math.round(v / 1000)}K`;
  return `$${v}`;
};
const initials = (name) => (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

function Avatar({ name, src, size = 32 }) {
  if (src) return <img src={src} alt={name} className="rounded-full object-cover border-2 border-white shadow-sm" style={{ width: size, height: size }} />;
  return (
    <div className="rounded-full bg-slate-200 text-slate-500 font-bold flex items-center justify-center border-2 border-white shadow-sm shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.36 }}>{initials(name)}</div>
  );
}

// Widget shell — the calm white card the reference design is built from.
function Widget({ title, children, className = '', action }) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-200/70 p-6 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-slate-700">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

// Oversized single figure, as in the reference "Total target" cards.
function BigNumber({ title, value, sub, tone }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/70 p-6 flex flex-col justify-between">
      <h3 className="text-base font-semibold text-slate-700">{title}</h3>
      <div>
        <div className="text-4xl xl:text-5xl font-bold tracking-tight mt-4" style={{ color: tone || '#334155' }}>{value}</div>
        {sub && <div className="text-xs text-slate-400 mt-2">{sub}</div>}
      </div>
    </div>
  );
}

// Donut for the pipeline breakdown, with a legend beside it.
function Donut({ slices }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return <div className="text-slate-300 text-sm py-10 text-center">No open pipeline.</div>;
  const R = 62, C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex items-center gap-6 flex-wrap">
      <svg viewBox="0 0 160 160" style={{ width: 160, height: 160 }}>
        <g transform="translate(80,80) rotate(-90)">
          {slices.map((s, i) => {
            const frac = s.value / total;
            const dash = `${frac * C} ${C - frac * C}`;
            const el = (
              <circle key={i} r={R} fill="none" stroke={s.color} strokeWidth="28"
                strokeDasharray={dash} strokeDashoffset={-offset} />
            );
            offset += frac * C;
            return el;
          })}
        </g>
        <text x="80" y="76" textAnchor="middle" fontSize="11" fill="#94a3b8">Total</text>
        <text x="80" y="94" textAnchor="middle" fontSize="16" fontWeight="700" fill="#334155">{compact(total)}</text>
      </svg>
      <div className="space-y-2.5">
        {slices.map((s) => (
          <div key={s.label} className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
            <span className="text-sm text-slate-600">{s.label}: <span className="font-semibold text-slate-700">{usd(s.value)}</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Plain monthly bars (the "Forecasted by month" widget).
function MonthBars({ data, color = '#7DC5E8', valueKey = 'salesUsd' }) {
  if (!data || data.length === 0) return null;
  const W = 440, H = 180, padL = 44, padB = 24;
  const max = Math.max(1, ...data.map((d) => d[valueKey]));
  const step = (W - padL - 10) / data.length;
  const bw = Math.min(46, step * 0.55);
  const y = (v) => H - padB - (v / max) * (H - padB - 14);
  const ticks = [0, 0.5, 1].map((t) => Math.round(max * t));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 380 }}>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={padL} x2={W - 10} y1={y(t)} y2={y(t)} stroke="#eef2f6" strokeWidth="1" />
          <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="10" fill="#94a3b8">{compact(t)}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const x = padL + i * step + (step - bw) / 2;
        const v = d[valueKey];
        return (
          <g key={i}>
            <rect x={x} y={y(v)} width={bw} height={Math.max(0, H - padB - y(v))} rx="3" fill={color} />
            <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="#94a3b8">{d.month}</text>
          </g>
        );
      })}
    </svg>
  );
}

// Stacked activity bars per rep, with avatars underneath.
function ActivityByRep({ rows }) {
  if (!rows || rows.length === 0) return <div className="text-slate-300 text-sm py-10 text-center">No activity yet.</div>;
  const W = 440, H = 190, padL = 40, padB = 42;
  const max = Math.max(1, ...rows.map((r) => r.total));
  const step = (W - padL - 10) / rows.length;
  const bw = Math.min(34, step * 0.5);
  const y = (v) => H - padB - (v / max) * (H - padB - 12);
  const series = [
    { key: 'calls', color: '#2E9A94' },
    { key: 'leads', color: '#4C9FE8' },
    { key: 'deals', color: '#A9E0DC' },
  ];
  const ticks = [0, 0.5, 1].map((t) => Math.round(max * t));
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 380 }}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - 10} y1={y(t)} y2={y(t)} stroke="#eef2f6" strokeWidth="1" />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="10" fill="#94a3b8">{t}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x = padL + i * step + (step - bw) / 2;
          let acc = 0;
          return (
            <g key={i}>
              {series.map((s) => {
                const v = r[s.key] || 0;
                if (v <= 0) return null;
                const top = y(acc + v);
                const h = Math.max(0, y(acc) - y(acc + v));
                acc += v;
                return <rect key={s.key} x={x} y={top} width={bw} height={h} fill={s.color} />;
              })}
            </g>
          );
        })}
      </svg>
      <div className="flex justify-around -mt-8 mb-2 px-6">
        {rows.map((r) => <Avatar key={r.ownerId} name={r.name} src={r.avatar} size={30} />)}
      </div>
      <div className="flex items-center justify-center gap-4 mt-3">
        {[{ l: 'Calls', c: '#2E9A94' }, { l: 'Leads', c: '#4C9FE8' }, { l: 'Deals', c: '#A9E0DC' }].map((x) => (
          <span key={x.l} className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <span className="w-2 h-2 rounded-full" style={{ background: x.c }} />{x.l}
          </span>
        ))}
      </div>
    </div>
  );
}

// Target vs actual pairs per rep, avatars underneath.
function QuotaByRep({ rows }) {
  if (!rows || rows.length === 0) return <div className="text-slate-300 text-sm py-10 text-center">No quota data yet.</div>;
  const W = 440, H = 190, padL = 46, padB = 42;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.salesTarget, r.salesUsd)));
  const step = (W - padL - 10) / rows.length;
  const bw = Math.min(20, step * 0.28);
  const y = (v) => H - padB - (v / max) * (H - padB - 12);
  const ticks = [0, 0.5, 1].map((t) => Math.round(max * t));
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 380 }}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - 10} y1={y(t)} y2={y(t)} stroke="#eef2f6" strokeWidth="1" />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="10" fill="#94a3b8">{compact(t)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const cx = padL + i * step + step / 2;
          return (
            <g key={i}>
              <rect x={cx - bw - 3} y={y(r.salesTarget)} width={bw} height={Math.max(0, H - padB - y(r.salesTarget))} rx="3" fill="#2E9A94" />
              <rect x={cx + 3} y={y(r.salesUsd)} width={bw} height={Math.max(0, H - padB - y(r.salesUsd))} rx="3" fill="#7FCFC9" />
            </g>
          );
        })}
      </svg>
      <div className="flex justify-around -mt-8 mb-2 px-4">
        {rows.map((r) => <Avatar key={r.ownerId} name={r.name} src={r.avatar} size={30} />)}
      </div>
      <div className="flex items-center justify-center gap-4 mt-3">
        {[{ l: 'Target', c: '#2E9A94' }, { l: 'Achieved', c: '#7FCFC9' }].map((x) => (
          <span key={x.l} className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <span className="w-2 h-2 rounded-full" style={{ background: x.c }} />{x.l}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Analytics({ user }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('/leads/dashboard').then(setData).catch((e) => setErr(e.message)); }, []);

  if (err) return <div className="text-red-500 text-sm">{err}</div>;
  if (!data) return <div className="text-slate-400 text-sm py-12 text-center">Loading analytics…</div>;

  const m = data.metrics;
  const board = (data.leaderboard || []).filter((b) => b.role === 'agent');
  const top5 = board.slice(0, 5);
  const quota = board.filter((b) => b.salesTarget > 0).slice(0, 5);

  // Pipeline split by stage value, derived from the deal board.
  const slices = [
    { label: 'Collected', value: m.salesThisMonthUsd, color: '#2563EB' },
    { label: 'Awaiting collection', value: m.awaitingUsd, color: '#FBD34D' },
    { label: 'Open pipeline', value: m.pipelineUsd, color: '#BFDBFE' },
  ].filter((s) => s.value > 0);

  const activity = top5.map((b) => ({
    ownerId: b.ownerId, name: b.name, avatar: b.avatar,
    calls: b.transfersToday || 0,
    leads: b.leads || 0,
    deals: b.conversions || 0,
    total: (b.transfersToday || 0) + (b.leads || 0) + (b.conversions || 0),
  }));

  return (
    <div className="bg-slate-50 -m-6 p-6 min-h-screen">
      {/* Header bar in the reference's calm style */}
      <div className="bg-white rounded-2xl border border-slate-200/70 px-6 py-5 mb-5">
        <h1 className="text-3xl font-semibold text-slate-800 tracking-tight">Sales analytics</h1>
        <div className="flex items-center gap-4 mt-2 text-sm text-slate-400">
          <span>{user.role === 'admin' ? 'Company-wide' : user.role === 'manager' ? 'Your team' : 'Your performance'}</span>
          <span className="text-slate-200">|</span>
          <span>{new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })}</span>
        </div>
      </div>

      {/* Row 1 — headline figures + activity */}
      <div className="grid lg:grid-cols-3 gap-5 mb-5">
        <BigNumber title="Total target" value={usd(m.scopeTarget || m.companyTarget)} sub="Monthly sales target" />
        <BigNumber title="Total actual to date" value={usd(m.scopeAchieved || m.salesThisMonthUsd)}
          sub={m.scopePct != null ? `${m.scopePct}% of target achieved` : 'Collected this month'}
          tone={m.scopePct >= 100 ? '#16A34A' : undefined} />
        <Widget title="Sales activity by rep">
          <ActivityByRep rows={activity} />
        </Widget>
      </div>

      {/* Row 2 — trend, pipeline split, quota attainment */}
      <div className="grid lg:grid-cols-3 gap-5 mb-5">
        <Widget title="Collected by month">
          <MonthBars data={data.trend || []} />
        </Widget>
        <Widget title="Pipeline breakdown">
          <Donut slices={slices} />
        </Widget>
        <Widget title="Quota attainment to date">
          <QuotaByRep rows={quota} />
        </Widget>
      </div>

      {/* Row 3 — lead generation mix */}
      <div className="grid lg:grid-cols-3 gap-5">
        <Widget title="Leads by month">
          <MonthBars data={data.leadMonthly || []} valueKey="total" color="#9BD4CF" />
        </Widget>
        <Widget title="Lead source mix">
          <Donut slices={[
            { label: 'Pre-sales', value: m.leadsPresalesMonth, color: '#7C3AED' },
            { label: 'Cold calling', value: m.leadsColdMonth, color: '#FF8A3D' },
            { label: 'Other', value: Math.max(0, m.leadsGeneratedMonth - m.leadsPresalesMonth - m.leadsColdMonth), color: '#CBD5E1' },
          ].filter((s) => s.value > 0)} />
        </Widget>
        <Widget title="This month at a glance">
          <div className="space-y-3">
            {[
              { k: 'New sales', v: usd(m.newSalesUsd), s: `${m.newSalesCount} first-time` },
              { k: 'Cross sales', v: usd(m.crossSalesUsd), s: `${m.crossSalesCount} repeat` },
              { k: 'Converted clients', v: m.convertedThisMonth, s: 'this month' },
              { k: 'Leads generated', v: m.leadsGeneratedMonth, s: `${m.generatedToday} today` },
              { k: 'Untouched 3+ days', v: m.untouched, s: 'need follow-up' },
            ].map((x) => (
              <div key={x.k} className="flex items-center justify-between border-b border-slate-50 pb-2 last:border-0">
                <div>
                  <div className="text-sm text-slate-600">{x.k}</div>
                  <div className="text-[11px] text-slate-400">{x.s}</div>
                </div>
                <div className="text-lg font-semibold text-slate-700">{x.v}</div>
              </div>
            ))}
          </div>
        </Widget>
      </div>
    </div>
  );
}

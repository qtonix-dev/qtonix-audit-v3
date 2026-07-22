import React, { useState, useEffect } from 'react';
import { api } from './App.jsx';

const usd = (n) => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const compact = (n) => {
  const v = Number(n || 0);
  if (v >= 1000000) return `$${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `$${Math.round(v / 1000)}K`;
  return `$${Math.round(v)}`;
};
const initials = (name) => (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

function Avatar({ name, src, size = 28 }) {
  if (src) return <img src={src} alt={name} className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />;
  return (
    <div className="rounded-full bg-slate-200 text-slate-500 font-bold flex items-center justify-center shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.36 }}>{initials(name)}</div>
  );
}

/** Calm white card. Everything inside must stay within it — no negative margins. */
function Widget({ title, subtitle, children, className = '' }) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-200/70 p-5 flex flex-col ${className}`}>
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        {subtitle && <div className="text-[11px] text-slate-400 mt-0.5">{subtitle}</div>}
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function BigNumber({ title, value, sub, tone, pct }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/70 p-5 flex flex-col">
      <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      <div className="flex-1 flex flex-col justify-center py-3">
        <div className="font-bold tracking-tight leading-none break-words"
          style={{ color: tone || '#334155', fontSize: 'clamp(1.75rem, 3.2vw, 2.75rem)' }}>{value}</div>
        {pct != null && (
          <div className="mt-3">
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, pct))}%`, background: pct >= 100 ? '#16A34A' : '#4C9FE8' }} />
            </div>
          </div>
        )}
        {sub && <div className="text-xs text-slate-400 mt-2">{sub}</div>}
      </div>
    </div>
  );
}

/**
 * Horizontal ranked bars. Used instead of vertical SVG bars for per-person data
 * — it scales to any card width and never overflows, which the earlier version
 * did badly in a three-column grid.
 */
function RankedBars({ rows, valueOf, labelOf, color = '#4C9FE8', showAvatar = true, empty = 'No data yet.' }) {
  if (!rows || rows.length === 0) return <div className="text-slate-300 text-sm py-8 text-center">{empty}</div>;
  const max = Math.max(1, ...rows.map((r) => Number(valueOf(r)) || 0));
  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const v = Number(valueOf(r)) || 0;
        return (
          <div key={r.ownerId || r.id || r.name} className="flex items-center gap-2.5 min-w-0">
            {showAvatar && <Avatar name={r.name} src={r.avatar} size={28} />}
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-xs font-medium text-slate-600 truncate">{r.name}</span>
                <span className="text-xs font-semibold text-slate-700 shrink-0">{labelOf ? labelOf(r) : v}</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.max(2, (v / max) * 100)}%`, background: color }} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Target vs achieved, as paired bars per person. */
function QuotaRows({ rows }) {
  if (!rows || rows.length === 0) return <div className="text-slate-300 text-sm py-8 text-center">No quota data yet.</div>;
  return (
    <div className="space-y-3.5">
      {rows.map((r) => {
        const pct = r.salesTarget > 0 ? Math.min(100, Math.round((r.salesUsd / r.salesTarget) * 100)) : 0;
        const hit = pct >= 100;
        return (
          <div key={r.ownerId} className="flex items-center gap-2.5 min-w-0">
            <Avatar name={r.name} src={r.avatar} size={28} />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-xs font-medium text-slate-600 truncate">{r.name}</span>
                <span className="text-xs shrink-0">
                  <span className="font-semibold text-slate-700">{compact(r.salesUsd)}</span>
                  <span className="text-slate-300"> / {compact(r.salesTarget)}</span>
                  <span className={`ml-1.5 font-semibold ${hit ? 'text-green-600' : 'text-slate-400'}`}>{pct}%</span>
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.max(2, pct)}%`, background: hit ? '#2E9A94' : '#7FCFC9' }} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Donut with the legend stacked beneath, so it fits a narrow card. */
function Donut({ slices, centreLabel = 'Total', centreValue }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return <div className="text-slate-300 text-sm py-8 text-center">Nothing to show yet.</div>;
  const R = 54, SW = 22, C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 140 140" className="w-full" style={{ maxWidth: 150 }}>
        <g transform="translate(70,70) rotate(-90)">
          {slices.map((s, i) => {
            const frac = s.value / total;
            const el = (
              <circle key={i} r={R} fill="none" stroke={s.color} strokeWidth={SW}
                strokeDasharray={`${frac * C} ${C - frac * C}`} strokeDashoffset={-offset} />
            );
            offset += frac * C;
            return el;
          })}
        </g>
        <text x="70" y="66" textAnchor="middle" fontSize="9" fill="#94a3b8">{centreLabel}</text>
        <text x="70" y="82" textAnchor="middle" fontSize="14" fontWeight="700" fill="#334155">
          {centreValue != null ? centreValue : compact(total)}
        </text>
      </svg>
      <div className="w-full space-y-1.5 mt-4">
        {slices.map((s) => (
          <div key={s.label} className="flex items-center justify-between gap-2 min-w-0">
            <span className="flex items-center gap-2 min-w-0">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
              <span className="text-xs text-slate-600 truncate">{s.label}</span>
            </span>
            <span className="text-xs font-semibold text-slate-700 shrink-0">{s.money ? usd(s.value) : s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Monthly bars, sized by viewBox only so it always fits its card. */
function MonthBars({ data, valueKey = 'salesUsd', color = '#7DC5E8', money = true }) {
  if (!data || data.length === 0) return <div className="text-slate-300 text-sm py-8 text-center">No history yet.</div>;
  const W = 300, H = 150, padL = 34, padB = 22;
  const max = Math.max(1, ...data.map((d) => Number(d[valueKey]) || 0));
  const step = (W - padL - 6) / data.length;
  const bw = Math.min(28, step * 0.55);
  const y = (v) => H - padB - (v / max) * (H - padB - 12);
  const fmt = (v) => (money ? compact(v) : Math.round(v));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
      {[0, 0.5, 1].map((t) => {
        const v = max * t;
        return (
          <g key={t}>
            <line x1={padL} x2={W - 6} y1={y(v)} y2={y(v)} stroke="#eef2f6" strokeWidth="1" />
            <text x={padL - 5} y={y(v) + 3} textAnchor="end" fontSize="7.5" fill="#94a3b8">{fmt(v)}</text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const x = padL + i * step + (step - bw) / 2;
        const v = Number(d[valueKey]) || 0;
        return (
          <g key={i}>
            <rect x={x} y={y(v)} width={bw} height={Math.max(0, H - padB - y(v))} rx="2.5" fill={color} />
            <text x={x + bw / 2} y={H - 7} textAnchor="middle" fontSize="8" fill="#94a3b8">{d.month}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function Analytics({ user, mode = 'analytics', onModeChange }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('/leads/dashboard').then(setData).catch((e) => setErr(e.message)); }, []);

  if (err) return <div className="text-red-500 text-sm">{err}</div>;
  if (!data) return <div className="text-slate-400 text-sm py-12 text-center">Loading analytics…</div>;

  const m = data.metrics;
  const agents = (data.leaderboard || []).filter((b) => b.role === 'agent');
  const target = m.scopeTarget || m.companyTarget || 0;
  const achieved = m.scopeAchieved != null ? m.scopeAchieved : m.salesThisMonthUsd;
  const pct = target > 0 ? Math.round((achieved / target) * 100) : null;

  const activity = agents.filter((a) => (a.leads || 0) + (a.conversions || 0) > 0).slice(0, 6);
  const quota = agents.filter((a) => a.salesTarget > 0).slice(0, 6);
  const sellers = agents.filter((a) => a.salesUsd > 0).slice(0, 6);

  const moneySlices = [
    { label: 'Collected', value: m.salesThisMonthUsd, color: '#2563EB', money: true },
    { label: 'Awaiting collection', value: m.awaitingUsd, color: '#FBBF24', money: true },
    { label: 'Open pipeline', value: m.pipelineUsd, color: '#BFDBFE', money: true },
  ].filter((s) => s.value > 0);

  const leadSlices = [
    { label: 'Pre-sales', value: m.leadsPresalesMonth, color: '#7C3AED' },
    { label: 'Cold calling', value: m.leadsColdMonth, color: '#FF8A3D' },
    { label: 'Other', value: Math.max(0, m.leadsGeneratedMonth - m.leadsPresalesMonth - m.leadsColdMonth), color: '#CBD5E1' },
  ].filter((s) => s.value > 0);

  return (
    <div>
      {/* Header, matching the overview so switching views feels seamless. */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800 tracking-tight">Sales analytics</h1>
          <div className="text-sm text-slate-400 mt-0.5">
            {user.role === 'admin' ? 'Company-wide' : user.role === 'manager' ? 'Your team' : 'Your performance'}
            <span className="mx-2 text-slate-200">|</span>
            {new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })}
          </div>
        </div>
        {onModeChange && (
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 shrink-0">
            {[['overview', 'Overview'], ['analytics', 'Analytics']].map(([id, label]) => (
              <button key={id} onClick={() => onModeChange(id)}
                className={`px-4 py-1.5 rounded-md text-xs font-bold transition ${mode === id ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500 hover:text-slate-700'}`}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Row 1 — headline figures */}
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <BigNumber title="Total target" value={usd(target)} sub="Monthly sales target" />
        <BigNumber title="Total actual to date" value={usd(achieved)} pct={pct}
          sub={pct != null ? `${pct}% of target achieved` : 'Collected this month'}
          tone={pct >= 100 ? '#16A34A' : undefined} />
        <BigNumber title="Open pipeline" value={usd(m.pipelineUsd)} sub="Deals not yet won" tone="#4C9FE8" />
        <BigNumber title="Awaiting collection" value={usd(m.awaitingUsd)} sub="Won, not yet paid" tone="#D97706" />
      </div>

      {/* Row 2 — money split, quota, sellers */}
      <div className="grid lg:grid-cols-3 gap-4 mb-4">
        <Widget title="Where the money sits" subtitle="Collected, owed and in play">
          <Donut slices={moneySlices} centreLabel="Total" centreValue={compact(moneySlices.reduce((s, x) => s + x.value, 0))} />
        </Widget>
        <Widget title="Quota attainment" subtitle="Collected against monthly target">
          <QuotaRows rows={quota} />
        </Widget>
        <Widget title="Top sellers" subtitle="Collected this month">
          <RankedBars rows={sellers} valueOf={(r) => r.salesUsd} labelOf={(r) => usd(r.salesUsd)} color="#2E9A94"
            empty="No sales collected yet." />
        </Widget>
      </div>

      {/* Row 3 — trends */}
      <div className="grid lg:grid-cols-3 gap-4 mb-4">
        <Widget title="Collected by month" subtitle="Last 6 months">
          <MonthBars data={data.trend || []} valueKey="salesUsd" />
        </Widget>
        <Widget title="Leads by month" subtitle="Last 6 months">
          <MonthBars data={data.leadMonthly || []} valueKey="total" color="#9BD4CF" money={false} />
        </Widget>
        <Widget title="Lead source mix" subtitle="This month">
          <Donut slices={leadSlices} centreLabel="Leads" centreValue={m.leadsGeneratedMonth} />
        </Widget>
      </div>

      {/* Row 4 — activity and summary */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Widget title="Lead activity by rep" subtitle="Leads owned this month">
          <RankedBars rows={activity} valueOf={(r) => r.leads}
            labelOf={(r) => `${r.leads} leads · ${r.conversions} converted`} color="#4C9FE8"
            empty="No lead activity yet." />
        </Widget>
        <Widget title="This month at a glance">
          <div className="space-y-2.5">
            {[
              { k: 'New sales', v: usd(m.newSalesUsd), s: `${m.newSalesCount} first-time` },
              { k: 'Cross sales', v: usd(m.crossSalesUsd), s: `${m.crossSalesCount} repeat` },
              { k: 'Converted clients', v: m.convertedThisMonth, s: 'this month' },
              { k: 'Leads generated', v: m.leadsGeneratedMonth, s: `${m.generatedToday} today` },
              { k: 'Untouched 3+ days', v: m.untouched, s: 'need follow-up' },
            ].map((x) => (
              <div key={x.k} className="flex items-center justify-between gap-3 border-b border-slate-50 pb-2 last:border-0 last:pb-0">
                <div className="min-w-0">
                  <div className="text-sm text-slate-600 truncate">{x.k}</div>
                  <div className="text-[11px] text-slate-400">{x.s}</div>
                </div>
                <div className="text-base font-semibold text-slate-700 shrink-0">{x.v}</div>
              </div>
            ))}
          </div>
        </Widget>
      </div>
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { api } from './App.jsx';

const usd = (n) => `$${Number(n || 0).toLocaleString()}`;

// A single metric card.
function Stat({ label, value, sub, accent, onClick, cta }) {
  return (
    <div className={`rounded-2xl border p-5 ${onClick ? 'cursor-pointer hover:shadow-md transition' : ''}`}
      style={{ borderColor: accent ? accent + '33' : '#e2e8f0', background: accent ? accent + '0a' : '#fff' }}
      onClick={onClick}>
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-3xl font-extrabold mt-1" style={{ color: accent || '#050A1F' }}>{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
      {cta && <div className="text-xs font-bold mt-2" style={{ color: accent || '#2563EB' }}>{cta} →</div>}
    </div>
  );
}

// Rank medal.
const medal = (i) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`);

export default function Dashboard({ user, onViewUntouched, onGoLeads }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api('/leads/dashboard').then(setData).catch((e) => setErr(e.message));
  }, []);

  if (err) return <div className="text-red-500 text-sm">{err}</div>;
  if (!data) return <div className="text-slate-400 text-sm py-12 text-center">Loading dashboard…</div>;

  const m = data.metrics;
  const board = data.leaderboard || [];
  const withTarget = board.filter((b) => b.salesTarget > 0);
  const topSeller = board.find((b) => b.salesUsd > 0);
  const firstToTarget = withTarget.find((b) => b.hitTarget);
  const maxSales = Math.max(1, ...board.map((b) => b.salesUsd));

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  })();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-[#050A1F]">{greeting}, {user.name.split(' ')[0]} 👋</h1>
        <div className="text-sm text-slate-400">Here's how {user.role === 'admin' ? 'the team is' : "you're"} doing this month.</div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <Stat label="Total leads" value={m.totalLeads} accent="#2563EB" onClick={onGoLeads} cta="View leads" />
        <Stat label="Generated today" value={m.generatedToday} accent="#7C3AED" />
        <Stat label="Assigned today" value={m.assignedToday} accent="#0891B2" />
        <Stat label="Sales this month" value={usd(m.salesThisMonthUsd)} sub={`${m.convertedThisMonth} converted`} accent="#16A34A" />
        <Stat label="Converted" value={m.convertedThisMonth} accent="#059669" />
        <Stat label="Untouched 3d+" value={m.untouched} accent="#DC2626" onClick={() => onViewUntouched(3)} cta="View all" />
      </div>

      {/* Highlights */}
      {(topSeller || firstToTarget) && (
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          {topSeller && (
            <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-5">
              <div className="text-[11px] font-bold uppercase tracking-wide text-amber-600">🏆 Top seller this month</div>
              <div className="text-xl font-extrabold text-[#050A1F] mt-1">{topSeller.name}</div>
              <div className="text-sm text-slate-500">{usd(topSeller.salesUsd)} in closed-won sales</div>
            </div>
          )}
          {firstToTarget ? (
            <div className="rounded-2xl border border-green-200 bg-gradient-to-br from-green-50 to-emerald-50 p-5">
              <div className="text-[11px] font-bold uppercase tracking-wide text-green-600">🎯 First to hit target</div>
              <div className="text-xl font-extrabold text-[#050A1F] mt-1">{firstToTarget.name}</div>
              <div className="text-sm text-slate-500">Reached {usd(firstToTarget.salesTarget)} — eligible for incentives</div>
            </div>
          ) : withTarget.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">🎯 Race to target</div>
              <div className="text-sm text-slate-500 mt-2">No one has hit their monthly target yet. {withTarget[0] && `${withTarget[0].name} is closest at ${withTarget[0].pct}%.`}</div>
            </div>
          )}
        </div>
      )}

      {/* Leaderboard */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-extrabold text-[#050A1F]">Leaderboard</h2>
          <span className="text-xs text-slate-400">This month · closed-won sales (USD)</span>
        </div>
        {board.length === 0 ? (
          <div className="text-slate-300 text-sm py-8 text-center">No sales data yet this month.</div>
        ) : (
          <div className="space-y-2">
            {board.map((b, i) => (
              <div key={b.ownerId} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50">
                <div className="w-8 text-center text-lg font-extrabold text-slate-400">{medal(i)}</div>
                <div className="w-40 shrink-0">
                  <div className="font-bold text-sm text-[#050A1F] truncate">{b.name}</div>
                  <div className="text-[11px] text-slate-400">{b.conversions} conv · {b.leads} leads</div>
                </div>
                <div className="flex-1">
                  <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(3, Math.round((b.salesUsd / maxSales) * 100))}%`, background: b.hitTarget ? '#16A34A' : 'linear-gradient(90deg,#FF6A00,#FF4500)' }} />
                  </div>
                </div>
                <div className="w-28 text-right">
                  <div className="font-extrabold text-sm text-[#050A1F]">{usd(b.salesUsd)}</div>
                  {b.salesTarget > 0 && (
                    <div className={`text-[11px] font-bold ${b.hitTarget ? 'text-green-600' : 'text-slate-400'}`}>
                      {b.hitTarget ? '✓ target hit' : `${b.pct}% · ${usd(b.remaining)} to go`}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

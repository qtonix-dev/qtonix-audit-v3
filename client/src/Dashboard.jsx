import React, { useState, useEffect } from 'react';
import { api } from './App.jsx';

const usd = (n) => `$${Number(n || 0).toLocaleString()}`;
const medal = (i) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`);

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

function TargetProgress({ title, achieved, target, pct, remaining, unit }) {
  if (!target) return null;
  const u = unit || '$';
  const fmt = u === '$' ? usd : (n) => `${n}`;
  const near = pct >= 70 && pct < 100;
  const done = pct >= 100;
  return (
    <div className={`rounded-2xl border p-5 ${done ? 'border-green-200 bg-green-50' : near ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-end justify-between mb-2">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{title}</div>
          <div className="text-2xl font-extrabold text-[#050A1F] mt-0.5">{fmt(achieved)} <span className="text-slate-300">/</span> {fmt(target)}</div>
        </div>
        <div className={`text-2xl font-extrabold ${done ? 'text-green-600' : near ? 'text-amber-600' : 'text-[#FF4500]'}`}>{pct}%</div>
      </div>
      <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(2, Math.min(100, pct))}%`, background: done ? '#16A34A' : near ? '#F59E0B' : 'linear-gradient(90deg,#FF6A00,#FF4500)' }} />
      </div>
      {done ? (
        <div className="text-sm font-bold text-green-700 mt-2">🎉 Target achieved — eligible for incentives!</div>
      ) : near ? (
        <div className="text-sm font-bold text-amber-700 mt-2">🔥 Almost there! {fmt(remaining)} more to achieve your {u === '$' ? 'monthly goal' : 'goal'}.</div>
      ) : (
        <div className="text-xs text-slate-400 mt-2">{fmt(remaining)} to go to reach your target.</div>
      )}
    </div>
  );
}

function TrendChart({ trend }) {
  if (!trend || trend.length === 0) return null;
  const W = 520, H = 160, pad = 28;
  const max = Math.max(1, ...trend.map((t) => t.salesUsd));
  const bw = (W - pad * 2) / trend.length;
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H + 30}`} className="w-full" style={{ minWidth: 480 }}>
        {[0, 0.5, 1].map((g) => (
          <line key={g} x1={pad} x2={W - pad} y1={pad + (H - pad) * (1 - g)} y2={pad + (H - pad) * (1 - g)} stroke="#e2e8f0" strokeWidth="1" />
        ))}
        {trend.map((t, i) => {
          const h = ((t.salesUsd / max) * (H - pad));
          const x = pad + i * bw + bw * 0.2;
          const y = H - h;
          return (
            <g key={i}>
              <rect x={x} y={y} width={bw * 0.6} height={h} rx="4" fill="url(#g)" />
              <text x={x + bw * 0.3} y={y - 5} textAnchor="middle" fontSize="9" fontWeight="bold" fill="#050A1F">{t.salesUsd >= 1000 ? `$${Math.round(t.salesUsd / 1000)}k` : `$${t.salesUsd}`}</text>
              <text x={x + bw * 0.3} y={H + 14} textAnchor="middle" fontSize="9" fill="#94a3b8">{t.month}</text>
              {t.pct != null && <text x={x + bw * 0.3} y={H + 25} textAnchor="middle" fontSize="8" fontWeight="bold" fill="#16A34A">{t.pct}%</text>}
            </g>
          );
        })}
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FF6A00" />
            <stop offset="100%" stopColor="#FF4500" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

export default function Dashboard({ user, onViewUntouched, onGoLeads }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('/leads/dashboard').then(setData).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="text-red-500 text-sm">{err}</div>;
  if (!data) return <div className="text-slate-400 text-sm py-12 text-center">Loading dashboard…</div>;

  const m = data.metrics;
  const board = data.leaderboard || [];
  const transferBoard = data.transferBoard || [];
  const me = data.me;
  const isAdmin = user.role === 'admin';
  const isManager = user.role === 'manager';
  const withTarget = board.filter((b) => b.salesTarget > 0);
  const topSeller = board.find((b) => b.salesUsd > 0);
  const firstToTarget = withTarget.find((b) => b.hitTarget);
  const maxSales = Math.max(1, ...board.map((b) => b.salesUsd));
  const greeting = (() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; })();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-[#050A1F]">{greeting}, {user.name.split(' ')[0]} 👋</h1>
        <div className="text-sm text-slate-400">{isAdmin ? 'Company-wide performance this month.' : isManager ? "Your team's performance this month." : 'Your performance this month.'}</div>
      </div>

      {me && (me.salesTarget > 0 || me.transferDailyTarget > 0) && (
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          {me.salesTarget > 0 && <TargetProgress title="Your monthly sales" achieved={me.salesUsd} target={me.salesTarget} pct={me.pct} remaining={me.remaining} />}
          {me.transferDailyTarget > 0 && <TargetProgress title="Your transfers today" achieved={me.transfersToday} target={me.transferDailyTarget} pct={me.transferDailyTarget ? Math.min(100, Math.round((me.transfersToday / me.transferDailyTarget) * 100)) : 0} remaining={Math.max(0, me.transferDailyTarget - me.transfersToday)} unit="#" />}
        </div>
      )}

      {isAdmin && m.companyTarget > 0 && (
        <div className="mb-6">
          <TargetProgress title="Company monthly target" achieved={m.salesThisMonthUsd} target={m.companyTarget} pct={m.companyPct} remaining={Math.max(0, m.companyTarget - m.salesThisMonthUsd)} />
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <Stat label="Total leads" value={m.totalLeads} accent="#2563EB" onClick={onGoLeads} cta="View leads" />
        <Stat label="Generated today" value={m.generatedToday} accent="#7C3AED" />
        <Stat label="Assigned today" value={m.assignedToday} accent="#0891B2" />
        <Stat label="Sales this month" value={usd(m.salesThisMonthUsd)} sub={`${m.convertedThisMonth} converted`} accent="#16A34A" />
        <Stat label="Converted" value={m.convertedThisMonth} accent="#059669" />
        <Stat label="Untouched 3d+" value={m.untouched} accent="#DC2626" onClick={() => onViewUntouched(3)} cta="View all" />
      </div>

      {(isAdmin || isManager) && data.trend && (
        <div className="bg-white rounded-2xl border border-slate-100 p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-extrabold text-[#050A1F]">Sales trend</h2>
            <span className="text-xs text-slate-400">Last 6 months · USD {m.companyTarget > 0 ? '· % of target' : ''}</span>
          </div>
          <TrendChart trend={data.trend} />
        </div>
      )}

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
              <div className="text-sm text-slate-500 mt-2">No one has hit target yet. {withTarget[0] && `${withTarget[0].name} leads at ${withTarget[0].pct}% — ${usd(withTarget[0].remaining)} to go.`}</div>
            </div>
          )}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-100 p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-extrabold text-[#050A1F]">Sales leaderboard</h2>
          <span className="text-xs text-slate-400">This month · closed-won (USD)</span>
        </div>
        {board.length === 0 ? (
          <div className="text-slate-300 text-sm py-8 text-center">No sales data yet this month.</div>
        ) : (
          <div className="space-y-2">
            {board.map((b, i) => (
              <div key={b.ownerId} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50">
                <div className="w-8 text-center text-lg font-extrabold text-slate-400">{medal(i)}</div>
                <div className="w-40 shrink-0">
                  <div className="font-bold text-sm text-[#050A1F] truncate">{b.name}{b.ownerId === user.id ? ' (you)' : ''}</div>
                  <div className="text-[11px] text-slate-400">{b.conversions} conv · {b.leads} leads</div>
                </div>
                <div className="flex-1">
                  <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(3, Math.round((b.salesUsd / maxSales) * 100))}%`, background: b.hitTarget ? '#16A34A' : 'linear-gradient(90deg,#FF6A00,#FF4500)' }} />
                  </div>
                </div>
                <div className="w-32 text-right">
                  <div className="font-extrabold text-sm text-[#050A1F]">{usd(b.salesUsd)}{b.salesTarget > 0 && <span className="text-slate-300 font-normal"> / {usd(b.salesTarget)}</span>}</div>
                  {b.salesTarget > 0 && <div className={`text-[11px] font-bold ${b.hitTarget ? 'text-green-600' : 'text-slate-400'}`}>{b.hitTarget ? '✓ target hit' : `${b.pct}% · ${usd(b.remaining)} left`}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {transferBoard.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-extrabold text-[#050A1F]">Call transfers today</h2>
            <span className="text-xs text-slate-400">Pre-sales · daily target</span>
          </div>
          <div className="space-y-2">
            {transferBoard.map((b, i) => (
              <div key={b.ownerId} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50">
                <div className="w-8 text-center text-lg font-extrabold text-slate-400">{medal(i)}</div>
                <div className="w-40 shrink-0 font-bold text-sm text-[#050A1F] truncate">{b.name}{b.ownerId === user.id ? ' (you)' : ''}</div>
                <div className="flex-1">
                  <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${b.pct != null ? Math.max(3, b.pct) : 3}%`, background: (b.pct || 0) >= 100 ? '#16A34A' : 'linear-gradient(90deg,#2563EB,#7C3AED)' }} />
                  </div>
                </div>
                <div className="w-28 text-right">
                  <div className="font-extrabold text-sm text-[#050A1F]">{b.transfersToday}{b.dailyTarget > 0 && <span className="text-slate-300 font-normal"> / {b.dailyTarget}</span>}</div>
                  {b.dailyTarget > 0 && <div className={`text-[11px] font-bold ${b.pct >= 100 ? 'text-green-600' : 'text-slate-400'}`}>{b.pct >= 100 ? '✓ done' : `${b.remaining} to go`}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

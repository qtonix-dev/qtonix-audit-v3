import React, { useState, useEffect } from 'react';
import { api } from './App.jsx';

const usd = (n) => `$${Number(n || 0).toLocaleString()}`;
const medal = (i) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`);
const initials = (name) => (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

function Avatar({ name, src, size = 28 }) {
  if (src) return <img src={src} alt={name} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  return (
    <div className="rounded-full bg-slate-200 text-slate-500 font-bold flex items-center justify-center" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials(name)}
    </div>
  );
}

// Metric card in achieved/target (%) format with a $0 motivational message.
function GoalStat({ label, achieved, target, unit, accent, onClick, cta, motivational, pipelineNote, awaitingNote, remainingLabel }) {
  const u = unit || '$';
  const fmt = u === '$' ? usd : (n) => `${n}`;
  const has = target > 0;
  const pct = has ? Math.min(100, Math.round((achieved / target) * 100)) : null;
  const remaining = has ? Math.max(0, target - achieved) : 0;
  const near = has && pct >= 70 && pct < 100;
  const done = has && pct >= 100;
  const zero = achieved === 0;
  return (
    <div className={`rounded-2xl border p-4 ${onClick ? 'cursor-pointer hover:shadow-md transition' : ''}`}
      style={{ borderColor: accent + '33', background: accent + '0a' }} onClick={onClick}>
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-2xl font-extrabold mt-1" style={{ color: accent }}>
        {fmt(achieved)}{has && <span className="text-slate-300 text-lg"> / {fmt(target)}</span>}
        {has && <span className="text-sm font-bold text-slate-400 ml-1.5">({pct}%)</span>}
      </div>
      {has && (
        <>
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden mt-2">
            <div className="h-full rounded-full" style={{ width: `${Math.max(3, pct)}%`, background: done ? '#16A34A' : near ? '#F59E0B' : accent }} />
          </div>
          <div className={`text-[11px] font-bold mt-1.5 ${done ? 'text-green-600' : near ? 'text-amber-600' : 'text-slate-500'}`}>
            {done ? '🎉 Target achieved!' : zero ? (motivational || 'Let’s get the first one today! 💪')
              : remainingLabel ? `${fmt(remaining)} to achieve your target`
              : near ? `🔥 ${fmt(remaining)} more to go!` : `${fmt(remaining)} to go`}
          </div>
        </>
      )}
      {!has && <div className="text-[11px] text-slate-400 mt-1.5">No target set</div>}
      {awaitingNote && <div className="text-[11px] font-semibold text-amber-600 mt-1">⏳ {awaitingNote} won — counts once collected</div>}
      {pipelineNote && <div className="text-[11px] font-semibold text-indigo-500 mt-1">💼 {pipelineNote} in pipeline</div>}
      {cta && <div className="text-xs font-bold mt-2" style={{ color: accent }}>{cta} →</div>}
    </div>
  );
}

function PlainStat({ label, value, sub, accent, onClick, cta }) {
  return (
    <div className={`rounded-2xl border p-4 ${onClick ? 'cursor-pointer hover:shadow-md transition' : ''}`}
      style={{ borderColor: accent + '33', background: accent + '0a' }} onClick={onClick}>
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-2xl font-extrabold mt-1" style={{ color: accent }}>{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
      {cta && <div className="text-xs font-bold mt-2" style={{ color: accent }}>{cta} →</div>}
    </div>
  );
}

// Mini lead table for the today/untouched boxes.
function LeadMiniList({ title, count, target, items, accent, onOpenLead, onSeeAll, seeAllLabel, breakdown, showOwner }) {
  return (
    <div className="rounded-2xl border p-5" style={{ borderColor: accent + '33', background: '#fff' }}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{title}</div>
          <div className="text-2xl font-extrabold" style={{ color: accent }}>
            {count}{target > 0 && <span className="text-slate-300 text-lg"> / {target}</span>}
            {target > 0 && count < target && <span className="text-xs font-bold text-slate-400 ml-2">{target - count} more to go</span>}
          </div>
          {breakdown && (
            <div className="flex items-center gap-3 mt-1">
              {breakdown.map((b) => (
                <span key={b.label} className="text-[11px] font-bold" style={{ color: b.color }}>
                  {b.icon} {b.value} {b.label}
                </span>
              ))}
            </div>
          )}
        </div>
        <button onClick={onSeeAll} className="text-xs font-bold" style={{ color: accent }}>{seeAllLabel || 'See all'} →</button>
      </div>
      {items.length === 0 ? (
        <div className="text-slate-300 text-sm py-6 text-center">Nothing here yet.</div>
      ) : (
        <div className="divide-y divide-slate-50 overflow-auto" style={{ minHeight: 250, maxHeight: 250 }}>
          {items.map((l) => (
            <div key={`${l.kind || 'x'}-${l._id}`} onClick={() => onOpenLead(l._id)} className="flex items-center justify-between py-2 cursor-pointer hover:bg-slate-50 -mx-2 px-2 rounded gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {l.kind && <span title={l.kind === 'generated' ? 'Generated today' : 'Assigned today'} className="text-xs shrink-0">{l.kind === 'generated' ? '✨' : '📥'}</span>}
                <div className="min-w-0">
                  <div className="font-semibold text-sm text-[#050A1F] truncate">{l.name}</div>
                  <div className="text-[11px] text-slate-400 truncate">
                    {showOwner && l.ownerName ? <span className="font-semibold text-slate-500">{l.ownerName}</span> : null}
                    {showOwner && l.ownerName && l.website ? ' · ' : ''}
                    {l.website || (!showOwner ? l.ownerName : '')}
                  </div>
                </div>
              </div>
              <span className="text-slate-300 text-xs shrink-0">→</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Daily lead volume for the current month (line + area).
function LeadDailyChart({ daily }) {
  if (!daily || daily.length === 0) return null;
  const W = 560, H = 140, padL = 28, padB = 18;
  const max = Math.max(1, ...daily.map((d) => d.total));
  const stepX = (W - padL - 8) / Math.max(1, daily.length - 1);
  const x = (i) => padL + i * stepX;
  const y = (v) => H - padB - (v / max) * (H - padB - 10);
  const line = daily.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d.total).toFixed(1)}`).join(' ');
  const area = `${line} L${x(daily.length - 1).toFixed(1)},${H - padB} L${x(0).toFixed(1)},${H - padB} Z`;
  const today = new Date().getDate();
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 420 }}>
      {[0, 0.5, 1].map((g) => (
        <line key={g} x1={padL} x2={W - 8} y1={y(max * g)} y2={y(max * g)} stroke="#e2e8f0" strokeWidth="1" />
      ))}
      <text x={4} y={y(max) + 4} fontSize="8" fill="#94a3b8">{max}</text>
      <text x={4} y={y(0) + 4} fontSize="8" fill="#94a3b8">0</text>
      <path d={area} fill="url(#leadArea)" opacity="0.35" />
      <path d={line} fill="none" stroke="#0891B2" strokeWidth="2" strokeLinejoin="round" />
      {daily.map((d, i) => (d.day === today ? <circle key={i} cx={x(i)} cy={y(d.total)} r="3.5" fill="#0891B2" /> : null))}
      {daily.map((d, i) => (d.day % 5 === 0 || d.day === 1 ? (
        <text key={`t${i}`} x={x(i)} y={H - 4} textAnchor="middle" fontSize="8" fill="#94a3b8">{d.day}</text>
      ) : null))}
      <defs>
        <linearGradient id="leadArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0891B2" /><stop offset="100%" stopColor="#0891B2" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// 6-month grouped bars: total / cold calling / pre-sales.
function LeadMonthlyChart({ monthly }) {
  if (!monthly || monthly.length === 0) return null;
  const W = 560, H = 150, padL = 26, padB = 26;
  const max = Math.max(1, ...monthly.map((m) => m.total));
  const groupW = (W - padL - 8) / monthly.length;
  const barW = Math.min(14, (groupW - 12) / 3);
  const y = (v) => H - padB - (v / max) * (H - padB - 12);
  const series = [
    { key: 'total', color: '#0891B2', label: 'Total' },
    { key: 'cold', color: '#FF6A00', label: 'Cold calling' },
    { key: 'presales', color: '#7C3AED', label: 'Pre-sales' },
  ];
  return (
    <div>
      <div className="flex items-center gap-3 mb-1 flex-wrap">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1 text-[10px] font-bold text-slate-500">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />{s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 420 }}>
        {[0, 0.5, 1].map((g) => (
          <line key={g} x1={padL} x2={W - 8} y1={y(max * g)} y2={y(max * g)} stroke="#e2e8f0" strokeWidth="1" />
        ))}
        <text x={4} y={y(max) + 4} fontSize="8" fill="#94a3b8">{max}</text>
        {monthly.map((m, i) => {
          const gx = padL + i * groupW + 6;
          return (
            <g key={i}>
              {series.map((s, si) => {
                const v = m[s.key] || 0;
                const bx = gx + si * (barW + 3);
                const bh = Math.max(0, H - padB - y(v));
                return (
                  <g key={s.key}>
                    <rect x={bx} y={y(v)} width={barW} height={bh} rx="2.5" fill={s.color} />
                    {v > 0 && <text x={bx + barW / 2} y={y(v) - 3} textAnchor="middle" fontSize="7.5" fontWeight="bold" fill="#050A1F">{v}</text>}
                  </g>
                );
              })}
              <text x={gx + (barW * 3 + 6) / 2} y={H - 8} textAnchor="middle" fontSize="9" fill="#94a3b8">{m.month}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function TrendChart({ trend }) {
  if (!trend || trend.length === 0) return null;
  const W = 520, H = 150, pad = 26;
  const max = Math.max(1, ...trend.map((t) => t.salesUsd));
  const bw = (W - pad * 2) / trend.length;
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H + 28}`} className="w-full" style={{ minWidth: 420 }}>
        {[0, 0.5, 1].map((g) => <line key={g} x1={pad} x2={W - pad} y1={pad + (H - pad) * (1 - g)} y2={pad + (H - pad) * (1 - g)} stroke="#e2e8f0" strokeWidth="1" />)}
        {trend.map((t, i) => {
          const h = (t.salesUsd / max) * (H - pad);
          const x = pad + i * bw + bw * 0.2;
          const y = H - h;
          return (
            <g key={i}>
              <rect x={x} y={y} width={bw * 0.6} height={h} rx="4" fill="url(#g)" />
              <text x={x + bw * 0.3} y={y - 4} textAnchor="middle" fontSize="9" fontWeight="bold" fill="#050A1F">{t.salesUsd >= 1000 ? `$${(t.salesUsd / 1000).toFixed(t.salesUsd >= 10000 ? 0 : 1)}k` : `$${t.salesUsd}`}</text>
              <text x={x + bw * 0.3} y={H + 12} textAnchor="middle" fontSize="9" fill="#94a3b8">{t.month}</text>
              {t.pct != null && <text x={x + bw * 0.3} y={H + 23} textAnchor="middle" fontSize="8" fontWeight="bold" fill="#16A34A">{t.pct}%</text>}
            </g>
          );
        })}
        <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FF6A00" /><stop offset="100%" stopColor="#FF4500" /></linearGradient></defs>
      </svg>
    </div>
  );
}

function Leaderboard({ board, user, maxSales }) {
  return (
    <div className="space-y-2">
      {board.map((b, i) => (
        <div key={b.ownerId} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50">
          <div className="w-7 text-center text-base font-extrabold text-slate-400">{medal(i)}</div>
          <Avatar name={b.name} src={b.avatar} size={30} />
          <div className="w-28 shrink-0">
            <div className="font-bold text-sm text-[#050A1F] truncate">{b.name}{b.ownerId === user.id ? ' (you)' : ''}</div>
            <div className="text-[10px] text-slate-400">{b.conversions} conv</div>
          </div>
          <div className="flex-1">
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${Math.max(3, Math.round((b.salesUsd / maxSales) * 100))}%`, background: b.hitTarget ? '#16A34A' : 'linear-gradient(90deg,#FF6A00,#FF4500)' }} />
            </div>
          </div>
          <div className="w-24 text-right">
            <div className="font-extrabold text-xs text-[#050A1F]">{usd(b.salesUsd)}</div>
            {b.salesTarget > 0 && <div className={`text-[10px] font-bold ${b.hitTarget ? 'text-green-600' : 'text-slate-400'}`}>{b.hitTarget ? '✓ hit' : `${b.pct}%`}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard({ user, onViewUntouched, onGoLeads, onViewConverted, onViewToday, mode = 'overview', onModeChange }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [showAwaiting, setShowAwaiting] = useState(false);
  useEffect(() => { api('/leads/dashboard').then(setData).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="text-red-500 text-sm">{err}</div>;
  if (!data) return <div className="text-slate-400 text-sm py-12 text-center">Loading dashboard…</div>;

  const m = data.metrics;
  const board = data.leaderboard || [];
  const transferBoard = data.transferBoard || [];
  const lists = data.lists || {};
  const me = data.me;
  const isAdmin = user.role === 'admin';
  const isManager = user.role === 'manager';
  const maxSales = Math.max(1, ...board.map((b) => b.salesUsd));
  const awaiting = data.awaiting || [];
  const topPerformer = data.topPerformer || null;
  const shiftBoard = data.shiftBoard || [];
  // Was the top team decided by the pipeline tie-break?
  const shiftTied = shiftBoard.length > 1 && shiftBoard[0].salesUsd === shiftBoard[1].salesUsd;
  const topSeller = board.find((b) => b.salesUsd > 0);
  const withTarget = board.filter((b) => b.salesTarget > 0);
  const firstToTarget = withTarget.find((b) => b.hitTarget);
  const greeting = (() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; })();

  return (
    <div className="space-y-5">
      {/* Greeting, with the view switcher on the right. Managers and admins can
          flip between the operational overview and the analytics view; agents
          only ever see the overview, so the switcher is hidden for them. */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold text-[#050A1F]">{greeting}, {user.name.split(' ')[0]} 👋</h1>
          <div className="text-sm text-slate-400">{isAdmin ? 'Company-wide performance this month.' : isManager ? "Your team's performance this month." : 'Your performance this month.'}</div>
        </div>
        {(isAdmin || isManager) && onModeChange && (
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

      {/* ROW 1 — Sales vs target + Converted, 50/50 */}
      <div className="grid md:grid-cols-2 gap-4">
        <GoalStat
          label={isAdmin ? 'Sales this month · company target' : isManager ? 'Sales this month · team target' : 'Sales this month · your target'}
          achieved={m.scopeAchieved} target={m.scopeTarget} accent="#16A34A"
          motivational="No sales collected yet — the first one is waiting! 🚀"
          remainingLabel
          pipelineNote={m.pipelineUsd > 0 ? usd(m.pipelineUsd) : null} />
        <PlainStat label="Converted this month" value={m.convertedThisMonth}
          sub={m.newSalesCount + m.crossSalesCount > 0 ? `${m.newSalesCount} new · ${m.crossSalesCount} cross sales` : 'No sales collected yet'}
          accent="#059669" onClick={onViewConverted} cta="View converted clients" />
      </div>

      {/* ROW 2 — Lead generation + sales split + collections */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {me && me.leadGenTarget > 0 ? (
          <GoalStat label="Leads generated" achieved={me.leadsGeneratedMonth} target={me.leadGenTarget} unit="#"
            accent="#0891B2" motivational="Add your first lead of the month! 🎯" remainingLabel />
        ) : (
          <PlainStat label="Leads generated" value={m.leadsGeneratedMonth} sub={`${m.generatedToday} today · ${m.leadsAssignedMonth} assigned`} accent="#0891B2" />
        )}
        <PlainStat label="New sales" value={usd(m.newSalesUsd)} sub={`${m.newSalesCount} first-time`} accent="#2563EB" />
        <PlainStat label="Cross sales" value={usd(m.crossSalesUsd)} sub={`${m.crossSalesCount} repeat/upsell`} accent="#7C3AED" />
        <PlainStat label="Awaiting collection" value={usd(m.awaitingUsd)}
          sub={awaiting.length ? `${awaiting.length} payment${awaiting.length === 1 ? '' : 's'} pending` : 'Nothing outstanding'}
          accent="#DC2626"
          onClick={(isAdmin || isManager) && awaiting.length ? () => setShowAwaiting(true) : undefined}
          cta={(isAdmin || isManager) && awaiting.length ? 'Follow up' : undefined} />
      </div>

      {/* ROW 3 — Today's leads + untouched, 50/50, sized for 5 rows */}
      <div className="grid md:grid-cols-2 gap-4">
        <LeadMiniList
          title="Today's leads"
          count={m.generatedToday + m.assignedToday}
          breakdown={[
            { icon: '✨', label: 'generated', value: m.generatedToday, color: '#7C3AED' },
            { icon: '📥', label: 'assigned', value: m.assignedToday, color: '#0891B2' },
          ]}
          items={[...(lists.generatedToday || []), ...(lists.assignedToday || [])]}
          showOwner={isAdmin || isManager}
          accent="#7C3AED" onOpenLead={(id) => onViewToday(id)} onSeeAll={onGoLeads} seeAllLabel="All leads" />
        <LeadMiniList title="Untouched 3+ days" count={m.untouched} items={lists.untouched || []}
          showOwner={isAdmin || isManager}
          accent="#DC2626" onOpenLead={(id) => onViewToday(id)} onSeeAll={() => onViewUntouched(3)} seeAllLabel="View all untouched" />
      </div>

      {/* ROW 4 — Top performer + top team */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-amber-600">🏆 Top performer of the month</div>
          {topPerformer && topPerformer.salesUsd > 0 ? (
            <>
              <div className="flex items-center gap-3 mt-2">
                <Avatar name={topPerformer.name} src={topPerformer.avatar} size={40} />
                <div>
                  <div className="text-xl font-extrabold text-[#050A1F]">{topPerformer.name}</div>
                  <div className="text-sm text-slate-500">{usd(topPerformer.salesUsd)} collected{topPerformer.salesTarget > 0 ? ` · ${topPerformer.pct}% of target` : ''}</div>
                </div>
              </div>
              {data.topPerformerTied && (
                <div className="text-[11px] text-amber-700 mt-2">Tied on sales — led on pipeline ({usd(topPerformer.pipelineUsd || 0)}).</div>
              )}
            </>
          ) : <div className="text-sm text-slate-400 mt-2">No sales collected yet this month.</div>}
        </div>
        <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-blue-50 p-5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-indigo-600">🏅 Top performing team</div>
          {data.topShift && data.topShift.salesUsd > 0 ? (
            <>
              <div className="text-xl font-extrabold text-[#050A1F] mt-2">{data.topShift.team} · {data.topShift.shift}</div>
              <div className="text-sm text-slate-500">{usd(data.topShift.salesUsd)} in collected sales</div>
              {shiftTied && <div className="text-[11px] text-indigo-700 mt-2">Tied on sales — led on pipeline ({usd(data.topShift.pipelineUsd || 0)}).</div>}
            </>
          ) : <div className="text-sm text-slate-400 mt-2">No team sales yet this month.</div>}
        </div>
      </div>

      {/* ROW 5 — Sales trend + leaderboard, 50/50 */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-extrabold text-[#050A1F]">Sales trend</h2>
            <span className="text-xs text-slate-400">{isAdmin ? 'Company' : isManager ? 'Your team' : 'You'} · 6 months</span>
          </div>
          <TrendChart trend={data.trend} />
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-extrabold text-[#050A1F]">Sales leaderboard</h2>
            <span className="text-xs text-slate-400">Collected · USD</span>
          </div>
          {board.length === 0 ? <div className="text-slate-300 text-sm py-8 text-center">No agents yet.</div> : <Leaderboard board={board} user={user} maxSales={maxSales} />}
        </div>
      </div>

      {/* ROW 6 — Lead trends: daily this month + 6-month grouped */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-extrabold text-[#050A1F]">Leads this month</h2>
            <span className="text-xs text-slate-400">Day by day</span>
          </div>
          <LeadDailyChart daily={data.leadDaily} />
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-extrabold text-[#050A1F]">Lead trend</h2>
            <span className="text-xs text-slate-400">Last 6 months</span>
          </div>
          <LeadMonthlyChart monthly={data.leadMonthly} />
        </div>
      </div>

      {/* Personal transfer goal (pre-sales only) */}
      {me && me.transferDailyTarget > 0 && (
        <GoalStat label="Your call transfers today" achieved={me.transfersToday} target={me.transferDailyTarget} unit="#"
          accent="#2563EB" motivational="Make your first transfer count! ☎️" />
      )}

      {/* ROW 9 — Transfer leaderboard */}
      {transferBoard.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-extrabold text-[#050A1F]">Call transfers today</h2>
            <span className="text-xs text-slate-400">Pre-sales · daily target</span>
          </div>
          <div className="space-y-2">
            {transferBoard.map((b, i) => (
              <div key={b.ownerId} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50">
                <div className="w-7 text-center text-base font-extrabold text-slate-400">{medal(i)}</div>
                <Avatar name={b.name} src={b.avatar} size={28} />
                <div className="w-32 shrink-0 font-bold text-sm text-[#050A1F] truncate">{b.name}{b.ownerId === user.id ? ' (you)' : ''}</div>
                <div className="flex-1"><div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${b.pct != null ? Math.max(3, b.pct) : 3}%`, background: (b.pct || 0) >= 100 ? '#16A34A' : 'linear-gradient(90deg,#2563EB,#7C3AED)' }} /></div></div>
                <div className="w-24 text-right"><div className="font-extrabold text-xs text-[#050A1F]">{b.transfersToday}{b.dailyTarget > 0 && <span className="text-slate-300 font-normal"> / {b.dailyTarget}</span>}</div>{b.dailyTarget > 0 && <div className={`text-[10px] font-bold ${b.pct >= 100 ? 'text-green-600' : 'text-slate-400'}`}>{b.pct >= 100 ? '✓ done' : `${b.remaining} to go`}</div>}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Awaiting-collection followup list (managers & admins) */}
      {showAwaiting && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowAwaiting(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-2xl max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-extrabold text-[#050A1F]">Payments awaiting collection</h3>
                <div className="text-xs text-slate-400">{awaiting.length} pending · {usd(m.awaitingUsd)} total</div>
              </div>
              <button onClick={() => setShowAwaiting(false)} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400 font-bold">
                  <th className="text-left px-3 py-2">Client</th>
                  <th className="text-left px-3 py-2">Deal</th>
                  <th className="text-left px-3 py-2">Amount</th>
                  <th className="text-left px-3 py-2">Due</th>
                  <th className="text-left px-3 py-2">Owner</th>
                </tr>
              </thead>
              <tbody>
                {awaiting.map((a) => (
                  <tr key={`${a.dealId}-${a.instId}`} onClick={() => { setShowAwaiting(false); onViewToday(a.leadId); }}
                    className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer">
                    <td className="px-3 py-2 font-bold text-[#050A1F]">{a.client}</td>
                    <td className="px-3 py-2 text-slate-500">{a.dealName} <span className="text-slate-300">#{a.seq}</span></td>
                    <td className="px-3 py-2 font-semibold">{a.currency} {a.amount.toLocaleString()}</td>
                    <td className={`px-3 py-2 text-xs ${a.overdue ? 'text-red-500 font-bold' : 'text-slate-400'}`}>{a.dueDate || '—'}{a.overdue ? ' · overdue' : ''}</td>
                    <td className="px-3 py-2 text-slate-500 text-xs">{a.ownerName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

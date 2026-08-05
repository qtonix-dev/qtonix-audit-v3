import React, { useState, useEffect } from 'react';
import { api, DashboardGmailNotice } from './App.jsx';

// Human-readable "how long ago" for email awaiting-reply ages.
function fmtAge(ms) {
  const h = Math.floor(ms / 3600000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60000))}m`;
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
import { Pagination } from './Leads.jsx';

const usd = (n) => `$${Number(n || 0).toLocaleString()}`;
const medal = (i) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`);
const initials = (name) => (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

// Small empty-state line used inside the email activity tabs.
function Empty({ text }) {
  return <div className="text-[11px] text-slate-400 text-center py-6">{text}</div>;
}

// Turn draft HTML (often messy Word markup) into readable plain text for
// previews so tags like <p class="MsoNormal"> never show through.
function stripHtmlText(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function Avatar({ name, src, size = 28, logo }) {
  if (src) return <img src={src} alt={name} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  if (logo) return <img src={logo} alt={name} className="rounded-full object-cover bg-white border border-slate-100" style={{ width: size, height: size }} />;
  return (
    <div className="rounded-full bg-slate-200 text-slate-500 font-bold flex items-center justify-center" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials(name)}
    </div>
  );
}

// Metric card in achieved/target (%) format with a $0 motivational message.
function GoalStat({ label, achieved, target, unit, accent, onClick, cta, motivational, pipelineNote, awaitingNote, remainingLabel, splitNote }) {
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
      {/* Admin-only: separates what the team brought in from admin-owned deals,
          so house/test accounts don't get mistaken for team performance. */}
      {splitNote && (
        <div className="mt-2 pt-2 border-t border-slate-200/70 grid grid-cols-2 gap-2">
          <div>
            <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Agents &amp; managers</div>
            <div className="text-sm font-extrabold text-[#050A1F]">{splitNote.team}</div>
          </div>
          <div>
            <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Admin-owned</div>
            <div className="text-sm font-extrabold text-slate-400">{splitNote.admin}</div>
          </div>
        </div>
      )}
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

// Sales funnel overview: an inverted-funnel visual of deals by stage. Each band
// shows the stage, its total amount, and the achieved count with a % of all
// deals. The top row shows intake = leads assigned + generated this month.
function SalesFunnel({ funnel }) {
  const usd = (n) => `$${Math.round(n || 0).toLocaleString()}`;
  const stages = (funnel && funnel.stages) || [];
  const maxCount = Math.max(1, ...stages.map((s) => s.count));
  return (
    <div>
      {/* Top of funnel: intake */}
      <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 mb-3">
        <div className="text-xs font-bold text-[#050A1F]">Top of funnel · intake</div>
        <div className="text-xs font-bold text-slate-500">
          {funnel.leadsAssignedMonth} assigned + {funnel.leadsGeneratedMonth} generated =
          <span className="text-[#FF4500]"> {funnel.topOfFunnel}</span>
        </div>
      </div>

      {stages.length === 0 ? (
        <div className="text-slate-300 text-sm py-6 text-center">No deals yet.</div>
      ) : (
        <div className="space-y-1.5">
          {stages.map((s, i) => {
            // Funnel taper: each band a bit narrower than the one above.
            const width = 100 - i * (55 / Math.max(1, stages.length));
            return (
              <div key={s.id} className="flex items-center gap-3">
                <div className="flex-1 flex justify-center">
                  <div className="rounded-lg py-2 px-3 text-center transition-all"
                    style={{ width: `${Math.max(38, width)}%`, background: `${s.color || '#2563EB'}`, color: '#fff' }}>
                    <div className="text-[11px] font-bold leading-tight truncate">{s.label}</div>
                    <div className="text-[10px] opacity-90">{usd(s.amountUsd)}</div>
                  </div>
                </div>
                <div className="w-24 text-right shrink-0">
                  <div className="text-sm font-extrabold text-[#050A1F] leading-tight">{s.count} <span className="text-[10px] font-bold text-slate-400">({s.pct}%)</span></div>
                </div>
              </div>
            );
          })}
        </div>
      )}
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
  const roleLabel = (r) => r === 'manager' ? 'Manager' : r === 'admin' ? 'Owner' : null;
  return (
    <div className="space-y-2">
      {board.map((b, i) => {
        const rl = roleLabel(b.role);
        return (
          <div key={b.ownerId} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50">
            <div className="w-7 text-center text-base font-extrabold text-slate-400">{medal(i)}</div>
            <Avatar name={b.name} src={b.avatar} logo={user && user.companyLogo} size={30} />
            <div className="w-28 shrink-0">
              <div className="font-bold text-sm text-[#050A1F] truncate">{b.name}{b.ownerId === user.id ? ' (you)' : ''}</div>
              <div className="text-[10px] text-slate-400">
                {typeof b.conversions === 'number' ? `${b.conversions} conv` : ''}
                {rl ? <span className="ml-1 rounded px-1 py-0.5 bg-slate-100 text-slate-500 font-bold">{rl}</span> : ''}
              </div>
            </div>
            <div className="flex-1">
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.max(3, Math.round((b.salesUsd / maxSales) * 100))}%`, background: b.hitTarget ? '#16A34A' : 'linear-gradient(90deg,#FF6A00,#FF4500)' }} />
              </div>
            </div>
            <div className="w-24 text-right">
              <div className="font-extrabold text-xs text-[#050A1F]">{usd(b.salesUsd)}</div>
              {b.salesTarget > 0 && b.pct != null && <div className={`text-[10px] font-bold ${b.hitTarget ? 'text-green-600' : 'text-slate-400'}`}>{b.hitTarget ? '✓ hit' : `${b.pct}%`}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Dashboard(props) {
  // Lead managers coordinate leads rather than sell, so they get an entirely
  // different home screen. Split at the top level (not inside one component)
  // so neither dashboard's hooks run for the other role.
  if (props.user.role === 'leadmanager') return <LeadManagerDashboard user={props.user} onViewToday={props.onViewToday} />;
  return <SalesDashboard {...props} />;
}

function SalesDashboard({ user, onViewUntouched, onGoLeads, onViewConverted, onViewToday, mode = 'overview', onModeChange }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [showAwaiting, setShowAwaiting] = useState(false);
  useEffect(() => { api('/leads/dashboard').then(setData).catch((e) => setErr(e.message)); }, []);
  // Commitments that blew past their agreed time. Managers and admins see the
  // whole team's; an agent sees only their own.
  const [missed, setMissed] = useState(null);
  const [missedModal, setMissedModal] = useState(null); // { ownerId } | null
  const [celebrations, setCelebrations] = useState([]);
  // Refresh celebrations on load, on window focus, and hourly, so date-specific
  // cards (birthday/anniversary) clear at the day boundary without a reload.
  useEffect(() => {
    const loadCel = () => api('/leads/celebrations').then((d) => setCelebrations(d.items || [])).catch(() => {});
    loadCel();
    const iv = setInterval(loadCel, 60 * 60 * 1000); // hourly
    const onFocus = () => loadCel();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(iv); window.removeEventListener('focus', onFocus); };
  }, []);
  useEffect(() => { api('/leads/missed-activities').then(setMissed).catch(() => {}); }, []);
  const [emailReplies, setEmailReplies] = useState(null); // { awaiting, missed }
  const [unopened, setUnopened] = useState(null); // { items }
  const [openedRecently, setOpenedRecently] = useState(null); // { items } — opened in last 24h
  const [emailTab, setEmailTab] = useState('new'); // new | notopen | open
  // Load the three email-activity feeds, and refresh them periodically (and on
  // window focus) so items past their 24-hour window drop off on their own.
  useEffect(() => {
    const loadEmailFeeds = () => {
      api('/gmail/awaiting-reply').then(setEmailReplies).catch(() => setEmailReplies(null));
      api('/gmail/unopened').then(setUnopened).catch(() => setUnopened(null));
      api('/gmail/opened-recently').then(setOpenedRecently).catch(() => setOpenedRecently(null));
    };
    loadEmailFeeds();
    const iv = setInterval(loadEmailFeeds, 10 * 60 * 1000); // every 10 min
    const onFocus = () => loadEmailFeeds();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(iv); window.removeEventListener('focus', onFocus); };
  }, []);
  // Pre-sales leads still waiting on their first reply. For an owner this is a
  // to-do; for a lead manager or admin it's who to chase.
  // Leads where a Lead Manager has asked the owner for a first-reply draft.
  const [draftRequests, setDraftRequests] = useState(null);
  useEffect(() => { api('/leads/awaiting-draft').then(setDraftRequests).catch(() => {}); }, []);
  // Recent sales, for the celebration banner. Polled so a win lights up other
  // people's dashboards without a refresh.
  const [wins, setWins] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => api('/leads/recent-wins').then((r) => { if (alive) setWins(r); }).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  if (err) return <div className="text-red-500 text-sm">{err}</div>;
  if (!data) return <div className="text-slate-400 text-sm py-12 text-center">Loading dashboard…</div>;

  const m = data.metrics;
  // Agents and managers see the whole company's agents (for competition);
  // the backend provides companyLeaderboard for that. Admins keep the scoped
  // board (which for them is already everyone).
  const board = (data.companyLeaderboard && data.companyLeaderboard.length ? data.companyLeaderboard : data.leaderboard) || [];
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
      {/* Prompt to connect email until the user has done so. */}
      <DashboardGmailNotice />

      {/* Celebration slider — rotates the latest sales win and today's
          birthdays / work + wedding anniversaries, 10s per slide. */}
      <CelebrationSlider wins={wins} celebrations={celebrations} user={user} />

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

      {/* Celebrations are now shown in the CelebrationSlider above. */}


      {/* ROW 1 — Sales vs target + Converted, 50/50 */}
      <div className="grid md:grid-cols-2 gap-4">
        <GoalStat
          label={isAdmin ? 'Sales this month · company target' : isManager ? 'Sales this month · team target' : 'Sales this month · your target'}
          achieved={m.scopeAchieved} target={m.scopeTarget} accent="#16A34A"
          motivational="No sales collected yet — the first one is waiting! 🚀"
          remainingLabel
          splitNote={isAdmin && m.teamSalesUsd != null ? { team: usd(m.teamSalesUsd), admin: usd(m.adminSalesUsd || 0) } : null}
          pipelineNote={m.pipelineUsd > 0 ? usd(m.pipelineUsd) : null} />
        <PlainStat label="Converted this month" value={m.convertedThisMonth}
          sub={m.newSalesCount + m.crossSalesCount > 0 ? `${m.newSalesCount} new · ${m.crossSalesCount} cross sales` : 'No sales collected yet'}
          accent="#059669" onClick={isAdmin || isManager ? onViewConverted : undefined} cta={isAdmin || isManager ? 'View converted clients' : undefined} />
      </div>

      {/* Missed commitments — scheduled calls and tasks that went past their
          agreed time without being completed. Surfaced prominently because a
          missed call is a lead going cold. */}
      {missed && missed.stillOpen > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-red-700">
                ⚠️ Missed commitments · {missed.stillOpen}
              </div>
              <div className="text-[11px] text-red-600">
                Scheduled calls and tasks more than an hour past their agreed time, still not completed.
              </div>
            </div>
            {(isAdmin || isManager) && missed.byOwner.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {missed.byOwner.slice(0, 5).map((o) => (
                  <button key={o.ownerId} onClick={() => setMissedModal({ ownerId: o.ownerId })}
                    className="rounded-md bg-white border border-red-200 px-2 py-1 text-[10px] font-bold text-red-700 hover:bg-red-100 transition-colors">
                    {o.ownerName} · {o.missed}
                  </button>
                ))}
                <button onClick={() => setMissedModal({ ownerId: null })}
                  className="rounded-md bg-red-600 text-white px-2.5 py-1 text-[10px] font-bold hover:bg-red-700 transition-colors">View all →</button>
              </div>
            )}
          </div>
          <div className="space-y-1 max-h-40 overflow-auto">
            {missed.items.filter((i) => !i.resolved).slice(0, 8).map((i) => (
              <div key={i.activityId}
                className="flex items-center gap-2 bg-white rounded-lg px-3 py-1.5 text-[11px] hover:bg-red-50 transition-colors group">
                <span className="cursor-pointer" onClick={() => onViewToday && onViewToday(i.leadId)}>{i.kind === 'call' ? '📞' : i.kind === 'draft' ? '✍️' : '✅'}</span>
                <span className="font-bold text-[#050A1F] truncate max-w-[160px] cursor-pointer" onClick={() => onViewToday && onViewToday(i.leadId)}>{i.leadName}</span>
                <span className="text-slate-500 truncate flex-1 cursor-pointer" onClick={() => onViewToday && onViewToday(i.leadId)}>{i.title}</span>
                {(isAdmin || isManager) && <span className="text-slate-400 shrink-0">{i.ownerName}</span>}
                <span className="font-bold text-red-600 shrink-0">{i.hoursLate}h late</span>
                {user.role === 'admin' && (
                  <button title="Clear from missed commitments" onClick={async (e) => { e.stopPropagation(); try { await api(`/leads/missed-activities/${i.leadId}/dismiss`, { method: 'POST', body: JSON.stringify({ activityId: i.activityId }) }); setMissed((prev) => prev ? { ...prev, items: prev.items.filter((x) => x.activityId !== i.activityId), stillOpen: Math.max(0, prev.stillOpen - 1) } : prev); } catch { /* */ } }}
                    className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-slate-400 hover:bg-red-100 hover:text-red-600">×</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Unified email notifications: New (inbound awaiting reply, incl. >24h
          missed), Not opened (sent, unopened after 24h), Opened (opened in the
          last 24h). Each tab shows a live count; data rolls off on its own
          window so stale items disappear automatically. */}
      {(() => {
        const newItems = emailReplies ? [...(emailReplies.missed || []), ...(emailReplies.awaiting || [])] : [];
        const notOpenItems = (unopened && unopened.items) || [];
        const openItems = (openedRecently && openedRecently.items) || [];
        const anythingAtAll = newItems.length + notOpenItems.length + openItems.length > 0;
        if (!anythingAtAll) return null;
        const tabs = [
          { id: 'new', label: 'New email', count: newItems.length, color: '#2563EB', bg: 'bg-blue-50', border: 'border-blue-200', dot: '#2563EB' },
          { id: 'notopen', label: 'Not opened', count: notOpenItems.length, color: '#D97706', bg: 'bg-amber-50', border: 'border-amber-200', dot: '#D97706' },
          { id: 'open', label: 'Opened', count: openItems.length, color: '#16A34A', bg: 'bg-green-50', border: 'border-green-200', dot: '#16A34A' },
        ];
        const active = tabs.find((t) => t.id === emailTab) || tabs[0];
        return (
          <div className={`rounded-2xl border ${active.border} bg-white p-4`}>
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mr-1">✉️ Email activity</span>
              {tabs.map((t) => {
                const on = t.id === emailTab;
                return (
                  <button key={t.id} onClick={() => setEmailTab(t.id)}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold transition ${on ? 'text-white' : 'text-slate-500 hover:bg-slate-100'}`}
                    style={on ? { background: t.color } : {}}>
                    {t.label}
                    <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-extrabold px-1"
                      style={on ? { background: 'rgba(255,255,255,0.25)', color: '#fff' } : { background: t.dot, color: '#fff' }}>
                      {t.count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="space-y-1 max-h-52 overflow-auto">
              {emailTab === 'new' && (newItems.length === 0
                ? <Empty text="No new emails awaiting a reply." />
                : newItems.slice(0, 12).map((i) => {
                    const overdue = (emailReplies.missed || []).some((x) => x.emailId === i.emailId);
                    return (
                      <div key={i.emailId} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-1.5 text-[11px] hover:bg-blue-50 group">
                        <span className="cursor-pointer" onClick={() => onViewToday && onViewToday(i.leadId)}>{overdue ? '⚠️' : '✉️'}</span>
                        <span className="font-bold text-[#050A1F] truncate max-w-[150px] cursor-pointer" onClick={() => onViewToday && onViewToday(i.leadId)}>{i.leadName}</span>
                        <span className="text-slate-500 truncate flex-1 cursor-pointer" onClick={() => onViewToday && onViewToday(i.leadId)}>{i.fromName || i.fromEmail ? `${i.fromName || i.fromEmail}: ` : ''}{i.subject || i.snippet}</span>
                        {i.ownerName && <span className="shrink-0 text-[10px] bg-slate-100 text-slate-500 rounded-full px-2 py-0.5">{i.ownerName}</span>}
                        <span className={`font-bold shrink-0 ${overdue ? 'text-red-600' : 'text-blue-600'}`}>{fmtAge(i.ageMs)}</span>
                        {user.role === 'admin' && overdue && (
                          <button title="Dismiss" onClick={async (e) => { e.stopPropagation(); try { await api(`/gmail/awaiting-reply/${i.emailId}/dismiss`, { method: 'POST' }); setEmailReplies((prev) => prev ? { ...prev, missed: prev.missed.filter((x) => x.emailId !== i.emailId) } : prev); } catch { /* */ } }}
                            className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-slate-400 hover:bg-red-100 hover:text-red-600">×</button>
                        )}
                      </div>
                    );
                  }))}

              {emailTab === 'notopen' && (notOpenItems.length === 0
                ? <Empty text="Every sent email has been opened. 🎉" />
                : notOpenItems.slice(0, 12).map((i) => (
                    <div key={i.id} onClick={() => i.leadId && onViewToday && onViewToday(i.leadId)} className={`flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-1.5 text-[11px] ${i.leadId ? 'cursor-pointer hover:bg-amber-50' : ''}`}>
                      <span>📭</span>
                      <span className="font-bold text-[#050A1F] truncate max-w-[150px]">{i.leadName || i.toEmail}</span>
                      <span className="text-slate-500 truncate flex-1">{i.subject || '(no subject)'}</span>
                      {i.ownerName && <span className="shrink-0 text-[10px] bg-slate-100 text-slate-500 rounded-full px-2 py-0.5">{i.ownerName}</span>}
                      <span className="font-bold text-amber-600 shrink-0">{fmtAge(i.ageMs)}</span>
                    </div>
                  )))}

              {emailTab === 'open' && (openItems.length === 0
                ? <Empty text="No opens in the last 24 hours yet." />
                : openItems.slice(0, 12).map((i) => (
                    <div key={i.id} onClick={() => i.leadId && onViewToday && onViewToday(i.leadId)} className={`flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-1.5 text-[11px] ${i.leadId ? 'cursor-pointer hover:bg-green-50' : ''}`}>
                      <span>{i.clicked ? '🔗' : '📖'}</span>
                      <span className="font-bold text-[#050A1F] truncate max-w-[150px]">{i.leadName || i.toEmail}</span>
                      <span className="text-slate-500 truncate flex-1">{i.subject || '(no subject)'}{i.opens > 1 ? ` · ${i.opens}×` : ''}{i.clicked ? ' · clicked' : ''}</span>
                      {i.ownerName && <span className="shrink-0 text-[10px] bg-slate-100 text-slate-500 rounded-full px-2 py-0.5">{i.ownerName}</span>}
                      <span className="font-bold text-green-600 shrink-0">{fmtAge(i.ageMs)}</span>
                    </div>
                  )))}
            </div>
          </div>
        );
      })()}

      {missedModal && (
        <MissedCommitmentsModal
          items={(missed && missed.items) || []}
          byOwner={(missed && missed.byOwner) || []}
          initialOwnerId={missedModal.ownerId}
          isAdmin={user.role === 'admin'}
          onDismiss={async (i) => { try { await api(`/leads/missed-activities/${i.leadId}/dismiss`, { method: 'POST', body: JSON.stringify({ activityId: i.activityId }) }); setMissed((prev) => prev ? { ...prev, items: prev.items.filter((x) => x.activityId !== i.activityId), stillOpen: Math.max(0, prev.stillOpen - 1) } : prev); } catch { /* */ } }}
          onOpenLead={(leadId) => { setMissedModal(null); onViewToday && onViewToday(leadId); }}
          onClose={() => setMissedModal(null)}
        />
      )}

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
          items={lists.recentlyAdded || [...(lists.generatedToday || []), ...(lists.assignedToday || [])]}
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
                <Avatar name={topPerformer.name} src={topPerformer.avatar} logo={user && user.companyLogo} size={40} />
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
              <div className="flex items-center gap-3 mt-2">
                {/* Manager photo on the LEFT (mirrors the top-performer card). */}
                {data.topShift.manager && (
                  <Avatar name={data.topShift.manager.name} src={data.topShift.manager.avatar} logo={user && user.companyLogo} size={40} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-xl font-extrabold text-[#050A1F]">{data.topShift.team}{data.topShift.shift ? ` · ${data.topShift.shift}` : ''}</div>
                  <div className="text-sm text-slate-500">
                    {data.topShift.manager ? <span className="font-semibold text-indigo-700">{data.topShift.manager.name}</span> : ''}
                    {data.topShift.manager ? ' · ' : ''}{usd(data.topShift.salesUsd)} in collected sales
                  </div>
                </div>
                {/* No manager → show team members' photos on the RIGHT. */}
                {!data.topShift.manager && data.topShift.members && data.topShift.members.length > 0 && (
                  <div className="flex -space-x-2 shrink-0">
                    {data.topShift.members.map((mb) => (
                      <div key={mb.id} title={mb.name} className="ring-2 ring-white rounded-full">
                        <Avatar name={mb.name} src={mb.avatar} logo={user && user.companyLogo} size={32} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {shiftTied && <div className="text-[11px] text-indigo-700 mt-2">Tied on sales — led on pipeline ({usd(data.topShift.pipelineUsd || 0)}).</div>}
            </>
          ) : <div className="text-sm text-slate-400 mt-2">No team sales yet this month.</div>}
        </div>
      </div>

      {/* ROW 5 — Left: Sales trend + Sales funnel. Right: leaderboard (full height). */}
      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-extrabold text-[#050A1F]">Sales trend</h2>
              <span className="text-xs text-slate-400">{isAdmin ? 'Company' : isManager ? 'Your team' : 'You'} · 6 months</span>
            </div>
            <TrendChart trend={data.trend} />
          </div>
          {data.funnel && (
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-extrabold text-[#050A1F]">Sales funnel overview</h2>
                <span className="text-xs text-slate-400">Deals by stage</span>
              </div>
              <SalesFunnel funnel={data.funnel} />
            </div>
          )}
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
            <span className="text-xs text-slate-400">Prospects promoted to leads today</span>
          </div>
          <div className="space-y-2">
            {transferBoard.map((b, i) => (
              <div key={b.ownerId} className="p-2 rounded-lg hover:bg-slate-50">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 text-center text-base font-extrabold text-slate-400">{medal(i)}</div>
                  <Avatar name={b.name} src={b.avatar} logo={user && user.companyLogo} size={28} />
                  <div className="w-32 shrink-0 font-bold text-sm text-[#050A1F] truncate">{b.name}{b.ownerId === user.id ? ' (you)' : ''}</div>
                  <div className="flex-1"><div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${b.pct != null ? Math.max(3, b.pct) : 3}%`, background: (b.pct || 0) >= 100 ? '#16A34A' : 'linear-gradient(90deg,#2563EB,#7C3AED)' }} /></div></div>
                  <div className="w-24 text-right"><div className="font-extrabold text-xs text-[#050A1F]">{b.transfersToday}{b.dailyTarget > 0 && <span className="text-slate-300 font-normal"> / {b.dailyTarget}</span>}</div>{b.dailyTarget > 0 && <div className={`text-[10px] font-bold ${b.pct >= 100 ? 'text-green-600' : 'text-slate-400'}`}>{b.pct >= 100 ? '✓ done' : `${b.remaining} to go`}</div>}</div>
                </div>
                {/* Which prospects this person transferred today, and to whom. */}
                {(b.transfers || []).length > 0 && (
                  <div className="ml-9 mt-1.5 flex flex-wrap gap-1.5">
                    {b.transfers.map((t) => (
                      <span key={t.leadId} className="text-[10px] rounded-md bg-purple-50 text-purple-700 px-1.5 py-0.5 font-semibold">
                        {t.leadName} → {t.toName}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Admin's own leads + pre-sales team performance — placed after the call
          transfer board. Admin-owned leads are kept out of the leaderboard and
          company math; shown here for manual reconciliation. */}
      {isAdmin && data.adminOwnLeads && (
        <div className="bg-white rounded-2xl border border-slate-200/70 p-5">
          <div className="text-sm font-bold text-[#050A1F] mb-3">My Leads</div>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Total owned</div>
              <div className="text-2xl font-extrabold mt-1 text-[#050A1F]">{data.adminOwnLeads.total}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Assigned today</div>
              <div className="text-2xl font-extrabold mt-1 text-[#FF6A00]">{data.adminOwnLeads.assignedToday}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Assigned this month</div>
              <div className="text-2xl font-extrabold mt-1 text-[#050A1F]">{data.adminOwnLeads.assignedMonth}</div>
            </div>
          </div>
          <div className="text-[11px] text-slate-400 mt-2">These leads are excluded from the sales leaderboard and company targets.</div>
        </div>
      )}

      {isAdmin && data.presalesTeam && data.presalesTeam.members.length > 0 && (
        <PresalesTeamBlocks pt={data.presalesTeam} />
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

// ---------------------------------------------------------------------------
// LEAD MANAGER DASHBOARD
// A coordination screen: what was entered and assigned, drafts coming back,
// and how the pre-sales team (names, not logins) is performing.
// ---------------------------------------------------------------------------
function LeadManagerDashboard({ user, onViewToday }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [showDrafts, setShowDrafts] = useState(false);
  useEffect(() => { api('/leads/lm-dashboard').then(setData).catch((e) => setErr(e.message)); }, []);

  if (err) return <div className="text-red-500 text-sm">{err}</div>;
  if (!data) return <div className="text-slate-400 text-sm py-12 text-center">Loading dashboard…</div>;

  const m = data.metrics;
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
  const fmtTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const maxTrend = Math.max(1, ...data.trend.map((t) => t.leads));
  const maxMonth = Math.max(1, ...data.teamLeaderboard.map((t) => t.month));

  const Stat = ({ label, value, sub, accent }) => (
    <div className="bg-white rounded-2xl border border-slate-200/70 p-5">
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-3xl font-extrabold mt-1" style={{ color: accent || '#050A1F' }}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );

  return (
    <div className="space-y-5">
      <DashboardGmailNotice />
      <div>
        <h1 className="text-2xl font-extrabold text-[#050A1F]">Welcome, {user.name.split(' ')[0]}</h1>
        <div className="text-sm text-slate-400">Lead intake and pre-sales team performance.</div>
      </div>

      {/* Blocks 1, 2 + throughput */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Leads assigned today" value={m.assignedToday} accent="#FF6A00" />
        <Stat label="Assigned this month" value={m.assignedMonth} />
        <Stat label="Team leads today" value={m.teamToday} sub={`${m.teamMonth} this month`} accent="#16A34A" />
        <Stat label="Drafts received" value={m.draftsReceived} sub="from lead owners" accent="#2563EB" />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Block 3: today's / recent leads */}
        <div className="bg-white rounded-2xl border border-slate-200/70 p-5">
          <div className="text-sm font-bold text-[#050A1F] mb-3">Recently added leads</div>
          {data.recentLeads.length === 0 ? (
            <div className="text-slate-300 text-sm py-6 text-center">No leads entered yet.</div>
          ) : (
            <div className="divide-y divide-slate-50">
              {data.recentLeads.map((l) => (
                <div key={l._id} onClick={() => onViewToday && onViewToday(l._id)}
                  className="flex items-center justify-between py-2 cursor-pointer hover:bg-slate-50 -mx-2 px-2 rounded">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-[#050A1F] truncate">{l.name}</div>
                    <div className="text-[11px] text-slate-400 truncate">
                      {l.source || '—'}{l.generatedBy ? ` · ${l.generatedBy}` : ''}{l.ownerName ? ` → ${l.ownerName}` : ''}
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-400 shrink-0">{fmtDate(l.createdAt)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Block 4: 1st drafts received */}
        <div className="bg-white rounded-2xl border border-slate-200/70 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-bold text-[#050A1F]">1st drafts received</div>
            {data.recentDrafts.length > 0 && (
              <button onClick={() => setShowDrafts(true)} className="text-[11px] font-bold text-[#FF4500] hover:underline">View all</button>
            )}
          </div>
          {data.recentDrafts.length === 0 ? (
            <div className="text-slate-300 text-sm py-6 text-center">No drafts submitted yet.</div>
          ) : (
            <div className="divide-y divide-slate-50">
              {data.recentDrafts.map((l) => (
                <div key={l._id} onClick={() => onViewToday && onViewToday(l._id)}
                  className="py-2 cursor-pointer hover:bg-slate-50 -mx-2 px-2 rounded">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-bold text-[#050A1F] truncate">{l.name}</div>
                    <div className="text-[11px] text-slate-400 shrink-0">{fmtTime(l.firstDraftAt)}</div>
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">{l.preview}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Block 7: daily lead-gen trend */}
      <div className="bg-white rounded-2xl border border-slate-200/70 p-5">
        <div className="text-sm font-bold text-[#050A1F] mb-3">Lead trends · this month</div>
        {m.teamMonth === 0 ? (
          <div className="text-slate-300 text-sm py-8 text-center">No pre-sales leads generated yet this month.</div>
        ) : (
          <svg viewBox={`0 0 ${Math.max(620, data.trend.length * 20)} 180`} className="w-full" style={{ height: 180 }}>
            <line x1="0" x2={data.trend.length * 20} y1="150" y2="150" stroke="#E2E8F0" />
            {data.trend.map((t, i) => {
              const x = i * 20 + 4;
              const h = (t.leads / maxTrend) * 130;
              return (
                <g key={t.day}>
                  <rect x={x} y={150 - h} width="12" height={Math.max(0, h)} rx="2" fill="#FF6A00" />
                  {t.leads > 0 && <text x={x + 6} y={150 - h - 4} fontSize="9" textAnchor="middle" fill="#334155" fontWeight="bold">{t.leads}</text>}
                  {t.day % 5 === 0 && <text x={x + 6} y="166" fontSize="9" textAnchor="middle" fill="#94A3B8">{t.day}</text>}
                </g>
              );
            })}
          </svg>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Block 5: leads assigned per owner, today and this month. */}
        <div className="bg-white rounded-2xl border border-slate-200/70 p-5">
          <div className="text-sm font-bold text-[#050A1F] mb-3">Leads assigned</div>
          {data.assignmentTable.length === 0 ? (
            <div className="text-slate-300 text-sm py-6 text-center">Nothing assigned yet.</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase text-slate-400 border-b border-slate-100">
                  <th className="text-left py-2">Owner</th>
                  <th className="text-right py-2">Today</th>
                  <th className="text-right py-2">This month</th>
                </tr>
              </thead>
              <tbody>
                {data.assignmentTable.map((o) => (
                  <tr key={o.ownerId} className="border-b border-slate-50">
                    <td className="py-2 font-bold text-slate-600">{o.ownerName}</td>
                    <td className="py-2 text-right text-slate-500">{o.today || 0}</td>
                    <td className="py-2 text-right font-bold text-[#050A1F]">{o.thisMonth}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Blocks 6 + 8: team performance and leaderboard */}
        <div className="bg-white rounded-2xl border border-slate-200/70 p-5">
          <div className="flex items-baseline justify-between mb-3">
            <div className="text-sm font-bold text-[#050A1F]">Pre-sales team · this month</div>
            {m.teamMonthlyTarget > 0 && (
              <div className="text-xs font-bold">
                <span className="text-[#FF4500]">{m.teamMonth}</span>
                <span className="text-slate-300"> / {m.teamMonthlyTarget}</span>
                <span className="text-slate-400 font-normal"> achieved</span>
              </div>
            )}
          </div>
          {/* Team-wide progress bar toward the summed monthly target. */}
          {m.teamMonthlyTarget > 0 && (
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden mb-4">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.round((m.teamMonth / m.teamMonthlyTarget) * 100))}%`, background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }} />
            </div>
          )}
          {data.teamConfigured === 0 ? (
            <div className="text-slate-300 text-sm py-6 text-center">
              No pre-sales team members configured. An admin can add them under CRM fields.
            </div>
          ) : data.teamLeaderboard.length === 0 ? (
            <div className="text-slate-300 text-sm py-6 text-center">No leads generated by the team yet this month.</div>
          ) : (
            <div className="space-y-2">
              {data.teamLeaderboard.map((t, i) => (
                <div key={t.name} className="flex items-center gap-3">
                  <span className={`w-5 text-center text-xs font-extrabold ${i === 0 ? 'text-[#FF4500]' : 'text-slate-300'}`}>{i + 1}</span>
                  <span className="text-sm font-bold text-slate-600 w-32 truncate">{t.name}</span>
                  <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(t.month / maxMonth) * 100}%`, background: i === 0 ? '#FF6A00' : '#94A3B8' }} />
                  </div>
                  <span className="text-xs font-bold text-[#050A1F] w-16 text-right">{t.month} <span className="text-slate-300 font-normal">/ {t.today} today</span></span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Full per-member performance: today, this month, all-time, and their
          share of the month's team total. Gives the lead manager the detail
          behind the leaderboard bars. */}
      {data.teamConfigured > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200/70 p-5">
          <div className="text-sm font-bold text-[#050A1F] mb-3">Team member breakdown</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase text-slate-400 border-b border-slate-100">
                <th className="text-left py-2">Member</th>
                <th className="text-right py-2">Today</th>
                <th className="text-right py-2">This month</th>
                <th className="text-right py-2">Monthly target</th>
                <th className="text-right py-2">% achieved</th>
                <th className="text-right py-2">All time</th>
                <th className="text-right py-2">Share</th>
              </tr>
            </thead>
            <tbody>
              {data.teamPerformance.map((t) => {
                const share = m.teamMonth > 0 ? Math.round((t.month / m.teamMonth) * 100) : 0;
                // % of this member's own monthly target reached.
                const pct = t.monthlyTarget > 0 ? Math.round((t.month / t.monthlyTarget) * 100) : null;
                return (
                  <tr key={t.name} className="border-b border-slate-50">
                    <td className="py-2 font-bold text-slate-600">{t.name}</td>
                    <td className="py-2 text-right text-slate-500">{t.today}</td>
                    <td className="py-2 text-right font-bold text-[#050A1F]">{t.month}</td>
                    <td className="py-2 text-right text-slate-500">{t.monthlyTarget > 0 ? t.monthlyTarget : <span className="text-slate-300">—</span>}</td>
                    <td className="py-2 text-right">
                      {pct != null
                        ? <span className={`font-bold ${pct >= 100 ? 'text-green-600' : pct >= 50 ? 'text-amber-600' : 'text-slate-500'}`}>{pct}%</span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="py-2 text-right text-slate-400">{t.total}</td>
                    <td className="py-2 text-right">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-10 h-1.5 rounded-full bg-slate-100 overflow-hidden inline-block">
                          <span className="h-full block rounded-full" style={{ width: `${share}%`, background: '#FF6A00' }} />
                        </span>
                        <span className="text-slate-500 w-8 text-right">{share}%</span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showDrafts && <DraftsReceivedModal onClose={() => setShowDrafts(false)} onOpen={onViewToday} />}
    </div>
  );
}

// Pre-sales team blocks for the admin dashboard: the "Lead Assigned" achieved/
// target summary, plus the per-member breakdown table with monthly target and
// % achieved. Fed by the dashboard's presalesTeam payload.
function PresalesTeamBlocks({ pt }) {
  const members = pt.members || [];
  const maxMonth = Math.max(1, ...members.map((t) => t.month));
  const teamPct = pt.teamMonthlyTarget > 0 ? Math.min(100, Math.round((pt.teamMonth / pt.teamMonthlyTarget) * 100)) : 0;
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200/70 p-5">
        <div className="flex items-baseline justify-between mb-3">
          <div className="text-sm font-bold text-[#050A1F]">Lead Assigned · Pre-sales team · this month</div>
          {pt.teamMonthlyTarget > 0 && (
            <div className="text-xs font-bold">
              <span className="text-[#FF4500]">{pt.teamMonth}</span>
              <span className="text-slate-300"> / {pt.teamMonthlyTarget}</span>
              <span className="text-slate-400 font-normal"> achieved</span>
            </div>
          )}
        </div>
        {pt.teamMonthlyTarget > 0 && (
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden mb-4">
            <div className="h-full rounded-full" style={{ width: `${teamPct}%`, background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }} />
          </div>
        )}
        {members.filter((t) => t.month > 0).length === 0 ? (
          <div className="text-slate-300 text-sm py-6 text-center">No leads generated by the team yet this month.</div>
        ) : (
          <div className="space-y-2">
            {members.filter((t) => t.month > 0).map((t, i) => (
              <div key={t.name} className="flex items-center gap-3">
                <span className={`w-5 text-center text-xs font-extrabold ${i === 0 ? 'text-[#FF4500]' : 'text-slate-300'}`}>{i + 1}</span>
                <span className="text-sm font-bold text-slate-600 w-32 truncate">{t.name}</span>
                <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${(t.month / maxMonth) * 100}%`, background: i === 0 ? '#FF6A00' : '#94A3B8' }} />
                </div>
                <span className="text-xs font-bold text-[#050A1F] w-16 text-right">{t.month} <span className="text-slate-300 font-normal">/ {t.today} today</span></span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/70 p-5">
        <div className="text-sm font-bold text-[#050A1F] mb-3">Pre-sales Team member breakdown</div>
        <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase text-slate-400 border-b border-slate-100">
              <th className="text-left py-2">Member</th>
              <th className="text-right py-2">Today</th>
              <th className="text-right py-2">This month</th>
              <th className="text-right py-2">Monthly target</th>
              <th className="text-right py-2">% achieved</th>
              <th className="text-right py-2">All time</th>
              <th className="text-right py-2">Share</th>
            </tr>
          </thead>
          <tbody>
            {members.map((t) => {
              const share = pt.teamMonth > 0 ? Math.round((t.month / pt.teamMonth) * 100) : 0;
              const pct = t.monthlyTarget > 0 ? Math.round((t.month / t.monthlyTarget) * 100) : null;
              return (
                <tr key={t.name} className="border-b border-slate-50">
                  <td className="py-2 font-bold text-slate-600">{t.name}</td>
                  <td className="py-2 text-right text-slate-500">{t.today}</td>
                  <td className="py-2 text-right font-bold text-[#050A1F]">{t.month}</td>
                  <td className="py-2 text-right text-slate-500">{t.monthlyTarget > 0 ? t.monthlyTarget : <span className="text-slate-300">—</span>}</td>
                  <td className="py-2 text-right">
                    {pct != null
                      ? <span className={`font-bold ${pct >= 100 ? 'text-green-600' : pct >= 50 ? 'text-amber-600' : 'text-slate-500'}`}>{pct}%</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="py-2 text-right text-slate-400">{t.total}</td>
                  <td className="py-2 text-right">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-10 h-1.5 rounded-full bg-slate-100 overflow-hidden inline-block">
                        <span className="h-full block rounded-full" style={{ width: `${share}%`, background: '#FF6A00' }} />
                      </span>
                      <span className="text-slate-500 w-8 text-right">{share}%</span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

// The full drafts-received list behind the dashboard's "view all".
function DraftsReceivedModal({ onClose, onOpen }) {
  const [data, setData] = useState(null);
  useEffect(() => { api('/leads/drafts-received').then(setData).catch(() => setData({ items: [] })); }, []);
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
          <div className="text-base font-extrabold text-[#050A1F]">All drafts received</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        <div className="px-6 py-4">
          {!data ? <div className="text-slate-400 text-sm py-8 text-center">Loading…</div>
            : data.items.length === 0 ? <div className="text-slate-300 text-sm py-8 text-center">No drafts received yet.</div>
            : (
              <div className="space-y-3">
                {data.items.map((l) => (
                  <div key={l._id} className="rounded-lg border border-slate-100 p-3 cursor-pointer hover:border-orange-200"
                    onClick={() => { onClose(); onOpen && onOpen(l._id); }}>
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-bold text-[#050A1F]">{l.name}</div>
                      <div className="text-[11px] text-slate-400">
                        {l.firstReplyDoneAt ? '✓ replied' : 'awaiting send'} · {new Date(l.firstDraftAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-400 mb-1">Owner: {l.ownerName}</div>
                    <div className="text-[12px] text-slate-600 line-clamp-3">{stripHtmlText(l.firstDraft)}</div>
                  </div>
                ))}
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SALES CELEBRATION
// A congratulatory banner for the most recent sale, with a compact "recent
// wins" strip beneath so a sale from 40 minutes ago is still visible to
// someone who just logged in. The banner naturally rotates as newer wins
// arrive (the parent re-polls every minute).
// ---------------------------------------------------------------------------
// A rotating banner that cycles through celebratory "slides" — the latest sales
// win plus today's birthdays / work anniversaries / wedding anniversaries — one
// at a time, auto-advancing every 10 seconds. Consolidates what used to be two
// stacked banners into a single slider.
function CelebrationSlider({ wins, celebrations, user }) {
  const slides = [];
  if (wins && wins.latest) slides.push({ kind: 'sale', key: `sale-${wins.latest.id}`, data: wins });
  (celebrations || []).forEach((c, i) => slides.push({ kind: 'celebration', key: `${c.id}-${c.type}-${i}`, data: c }));

  const [idx, setIdx] = useState(0);
  // Auto-advance every 10s. Reset to a valid index if the slide set shrinks.
  useEffect(() => {
    if (slides.length <= 1) return;
    const t = setInterval(() => setIdx((n) => (n + 1) % slides.length), 10000);
    return () => clearInterval(t);
  }, [slides.length]);
  useEffect(() => { if (idx >= slides.length) setIdx(0); }, [slides.length, idx]);

  if (slides.length === 0) return null;
  const current = slides[Math.min(idx, slides.length - 1)];

  return (
    <div className="relative">
      {current.kind === 'sale'
        ? <SalesCelebration latest={current.data.latest} others={current.data.wins} />
        : <CelebrationCard c={current.data} user={user} />}

      {/* Dots + manual nav, only when there's more than one slide. */}
      {slides.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 mt-2">
          {slides.map((s, i) => (
            <button key={s.key} onClick={() => setIdx(i)} aria-label={`Slide ${i + 1}`}
              className={`h-1.5 rounded-full transition-all ${i === idx ? 'w-5 bg-[#FF6A00]' : 'w-1.5 bg-slate-300 hover:bg-slate-400'}`} />
          ))}
        </div>
      )}
    </div>
  );
}

// A single celebration slide (birthday / work anniversary / wedding anniversary).
function CelebrationCard({ c, user }) {
  const msg = c.type === 'birthday' ? '🎂 Happy Birthday'
    : c.type === 'work' ? `🏆 Happy ${c.yearsLabel ? `${c.yearsLabel} ` : ''}Work Anniversary`
    : '💍 Happy Anniversary';
  const sub = c.type === 'birthday' ? 'Wishing you a wonderful day!'
    : c.type === 'work' ? `Thank you for ${c.years ? `${c.years} year${c.years === 1 ? '' : 's'} of ` : ''}being with us!`
    : 'Congratulations on your special day!';
  return (
    <div className="rounded-2xl overflow-hidden shadow-sm border border-pink-200">
      <div className="px-5 py-4 flex items-center gap-4" style={{ background: 'linear-gradient(90deg,#FDF2F8,#FFF7ED)' }}>
        <div className="text-4xl animate-bounce" style={{ animationDuration: '1.5s' }}>{c.type === 'birthday' ? '🎂' : c.type === 'work' ? '🏆' : '💍'}</div>
        <Avatar name={c.name} src={c.avatar} logo={user && user.companyLogo} size={56} />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-extrabold text-[#050A1F]">{msg}, {(c.name || '').split(' ')[0]}!</div>
          <div className="text-[11px] text-pink-600 font-semibold">{c.name} · {sub}</div>
        </div>
      </div>
    </div>
  );
}

function SalesCelebration({ latest, others }) {
  const usd = (n) => `$${Number(n || 0).toLocaleString()}`;
  const first = (latest.ownerName || 'Someone').split(' ')[0];
  const ago = (iso) => {
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins === 1) return '1 min ago';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs === 1) return '1 hour ago';
    if (hrs < 24) return `${hrs} hours ago`;
    const days = Math.round(hrs / 24);
    return days === 1 ? 'yesterday' : `${days} days ago`;
  };
  const initials = (name) => (name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const older = (others || []).filter((w) => w.id !== latest.id).slice(0, 4);

  return (
    <div className="rounded-2xl overflow-hidden shadow-sm border border-orange-200">
      <div className="px-5 py-4 flex items-center gap-4" style={{ background: 'linear-gradient(90deg,#FFF7ED,#FFEDD5)' }}>
        <div className="text-4xl animate-bounce" style={{ animationDuration: '1.5s' }}>🎉</div>
        {latest.avatar ? (
          <img src={latest.avatar} alt={latest.ownerName} className="w-16 h-16 rounded-full object-cover border-2 border-white shadow" />
        ) : (
          <div className="w-16 h-16 rounded-full flex items-center justify-center text-white text-lg font-extrabold shadow border-2 border-white"
            style={{ background: 'linear-gradient(135deg,#FF6A00,#FF4500)' }}>{initials(latest.ownerName)}</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-extrabold text-[#050A1F]">
            Congratulations {first} on the sale of {usd(latest.amountUsd)}! 🚀
          </div>
          <div className="text-[11px] text-slate-500 truncate">
            {latest.customerFirstName || 'a client'}{latest.service ? ` · ${latest.service}` : ''}{latest.currency !== 'USD' ? ` · ${latest.currency} ${Number(latest.amount).toLocaleString()}` : ''} · {ago(latest.at)}
          </div>
        </div>
      </div>
      {older.length > 0 && (
        <div className="bg-white px-5 py-2.5 flex items-center gap-4 overflow-x-auto">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 shrink-0">Also today</span>
          {older.map((w) => (
            <span key={w.id} className="flex items-center gap-1.5 text-[11px] text-slate-500 shrink-0">
              {w.avatar ? (
                <img src={w.avatar} alt="" className="w-6 h-6 rounded-full object-cover border border-slate-200" />
              ) : (
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-bold" style={{ background: 'linear-gradient(135deg,#FF6A00,#FF4500)' }}>{initials(w.ownerName)}</span>
              )}
              <span><b className="text-slate-700">{(w.ownerName || '').split(' ')[0]}</b> {usd(w.amountUsd)} · {ago(w.at)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EMAIL DRAFTS (Lead Manager portal)
// Two tabs — 1st Reply and Reminder — each a table of submissions, with
// summary boxes above showing received-this-month, today, and completed.
// ---------------------------------------------------------------------------
export function EmailDraftsPage({ user, onOpenLead }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('first');
  const [open, setOpen] = useState(null); // expanded submission
  const [err, setErr] = useState('');
  const [leadPopup, setLeadPopup] = useState(null);
  // Filters + pagination (shared across both tabs; reset page on change).
  const [q, setQ] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const load = () => api('/leads/email-drafts').then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  useEffect(() => { setPage(1); }, [q, agentFilter, fromDate, toDate, perPage, tab]);

  const act = async (id, path, payload) => {
    try { await api(`/leads/${id}/${path}`, { method: 'PATCH', body: JSON.stringify(payload) }); load(); }
    catch (e) { alert(e.message); }
  };

  if (err) return <div className="text-red-500 text-sm">{err}</div>;
  if (!data) return <div className="text-slate-400 text-sm py-12 text-center">Loading…</div>;

  const s = data.summary;
  const fmt = (d) => d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  const fmtDay = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const allRows = tab === 'first' ? data.firstReplies : data.reminders;

  // Distinct owners (agents) for the agent filter.
  const agents = Array.from(new Set(allRows.map((r) => r.ownerName).filter(Boolean))).sort();

  // Apply filters.
  let rows = allRows;
  const term = q.trim().toLowerCase();
  if (term) rows = rows.filter((r) => `${r.name} ${r.ownerName} ${r.subject} ${r.email} ${r.generatedFromEmail}`.toLowerCase().includes(term));
  if (agentFilter) rows = rows.filter((r) => r.ownerName === agentFilter);
  if (fromDate) { const f = new Date(fromDate); rows = rows.filter((r) => new Date(r.submittedAt) >= f); }
  if (toDate) { const t = new Date(toDate); t.setHours(23, 59, 59, 999); rows = rows.filter((r) => new Date(r.submittedAt) <= t); }

  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const pageRows = rows.slice((page - 1) * perPage, page * perPage);

  const Box = ({ label, value, accent }) => (
    <div className="bg-white rounded-2xl border border-slate-200/70 p-4">
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-2xl font-extrabold mt-1" style={{ color: accent || '#050A1F' }}>{value}</div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-[#050A1F]">Email Drafts</h1>
        <div className="text-sm text-slate-400">First replies and reminders submitted by agents for you to send.</div>
      </div>

      {/* Summary boxes */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Box label="1st replies · month" value={s.firstMonth} accent="#FF6A00" />
        <Box label="1st replies · today" value={s.firstToday} />
        <Box label="1st completed" value={s.firstCompleted} accent="#16A34A" />
        <Box label="Reminders · month" value={s.reminderMonth} accent="#FF6A00" />
        <Box label="Reminders · today" value={s.reminderToday} />
        <Box label="Reminders completed" value={s.reminderCompleted} accent="#16A34A" />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {[['first', `1st Reply (${data.firstReplies.length})`], ['reminder', `Reminder (${data.reminders.length})`]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-1.5 rounded-md text-xs font-bold ${tab === id ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>{label}</button>
        ))}
      </div>

      {/* Filters — present on both tabs */}
      <div className="flex items-end gap-2 flex-wrap">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search lead, subject, email…"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-orange-400" />
        <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)}
          className="rounded-lg border border-slate-300 px-2.5 py-2 text-sm">
          <option value="">All agents</option>
          {agents.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <div className="flex items-center gap-1">
          <div className="flex flex-col">
            <label className="text-[9px] font-bold uppercase text-slate-400">From</label>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
          </div>
          <div className="flex flex-col">
            <label className="text-[9px] font-bold uppercase text-slate-400">To</label>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
          </div>
        </div>
        {(q || agentFilter || fromDate || toDate) && (
          <button onClick={() => { setQ(''); setAgentFilter(''); setFromDate(''); setToDate(''); }}
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-500 hover:border-slate-300">Clear</button>
        )}
        <div className="text-xs text-slate-400 ml-auto self-center">{rows.length} shown</div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/70 p-5">
        {rows.length === 0 ? (
          <div className="text-slate-300 text-sm py-8 text-center">{allRows.length === 0 ? `No ${tab === 'first' ? 'first replies' : 'reminders'} submitted yet.` : 'No rows match these filters.'}</div>
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase text-slate-400 border-b border-slate-100">
                  <th className="text-left py-2 px-2">Lead</th>
                  <th className="text-left py-2 px-2">Owner</th>
                  <th className="text-left py-2 px-2">Generated from</th>
                  <th className="text-left py-2 px-2">Lead email</th>
                  <th className="text-left py-2 px-2">Lead added</th>
                  <th className="text-left py-2 px-2">Subject</th>
                  <th className="text-left py-2 px-2">Submitted</th>
                  <th className="text-left py-2 px-2">Status</th>
                  <th className="text-right py-2 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => {
                  const done = tab === 'first' ? r.read : r.received;
                  return (
                    <React.Fragment key={r._id}>
                      <tr className="border-b border-slate-50 hover:bg-orange-50/40">
                        <td className="py-2 px-2">
                          <button onClick={() => setLeadPopup(r)} className="font-bold text-[#FF4500] hover:underline text-left">{r.name || '(no name)'}</button>
                        </td>
                        <td className="py-2 px-2 text-slate-500">{r.ownerName}</td>
                        <td className="py-2 px-2 text-slate-500 max-w-[150px] truncate" title={r.generatedFromEmail}>{r.generatedFromEmail || <span className="text-slate-300">—</span>}</td>
                        <td className="py-2 px-2 text-slate-500 max-w-[150px] truncate" title={r.email}>{r.email || <span className="text-slate-300">—</span>}</td>
                        <td className="py-2 px-2 text-slate-500 whitespace-nowrap">{fmtDay(r.leadCreatedAt)}</td>
                        <td className="py-2 px-2 text-slate-600 max-w-[180px] truncate cursor-pointer" onClick={() => setOpen(open === r._id ? null : r._id)}>{r.subject || <span className="text-slate-300">(no subject)</span>}</td>
                        <td className="py-2 px-2 text-slate-500 whitespace-nowrap">{fmt(r.submittedAt)}</td>
                        <td className="py-2 px-2">
                          {done
                            ? <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-green-100 text-green-700">{tab === 'first' ? 'Read' : 'Received'}</span>
                            : <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-700">Awaiting</span>}
                        </td>
                        <td className="py-2 px-2 text-right whitespace-nowrap">
                          <button onClick={() => setOpen(open === r._id ? null : r._id)} className="text-[11px] font-bold text-slate-500 hover:underline mr-3">{open === r._id ? 'Hide' : 'View'}</button>
                          {!done && (
                            <button onClick={(e) => { e.stopPropagation(); tab === 'first' ? act(r._id, 'first-reply', { draftRead: true }) : act(r._id, 'reminder-draft', { received: true }); }}
                              className="rounded-md px-2.5 py-1 text-[11px] font-bold text-white" style={{ background: 'linear-gradient(90deg,#2563EB,#1D4ED8)' }}>
                              Mark {tab === 'first' ? 'read' : 'received'}
                            </button>
                          )}
                        </td>
                      </tr>
                      {open === r._id && (
                        <tr className="bg-slate-50/60">
                          <td colSpan={9} className="px-4 py-3">
                            {r.subject && <div className="text-[13px] font-bold text-slate-700 mb-1">Subject: {r.subject}</div>}
                            <div className="text-[13px] text-slate-600" dangerouslySetInnerHTML={{ __html: r.body }} />
                            {done && <div className="text-[11px] text-green-600 font-semibold mt-2">Completed {fmt(tab === 'first' ? r.readAt : r.receivedAt)}</div>}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3">
            <Pagination page={page} pages={pages} total={rows.length} perPage={perPage}
              onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} label="drafts" />
          </div>
          </>
        )}
      </div>

      {leadPopup && (
        <LeadPeekModal row={leadPopup} onClose={() => setLeadPopup(null)}
          onMore={() => { const id = leadPopup._id; setLeadPopup(null); onOpenLead && onOpenLead(id); }} />
      )}
    </div>
  );
}

/** Small popup showing key lead details, with a button to open the full page. */
function LeadPeekModal({ row, onClose, onMore }) {
  const fmtDay = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const Item = ({ k, v }) => (
    <div className="flex justify-between gap-3 py-1 border-b border-slate-50 last:border-0">
      <span className="text-slate-400 text-xs">{k}</span>
      <span className="text-slate-700 text-xs font-medium text-right break-all">{v || <span className="text-slate-300">—</span>}</span>
    </div>
  );
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="text-base font-extrabold text-[#050A1F] mb-3">{row.name || '(no name)'}</div>
        <div className="space-y-0.5">
          <Item k="Owner" v={row.ownerName} />
          <Item k="Website" v={row.website} />
          <Item k="Lead email" v={row.email} />
          <Item k="Generated from" v={row.generatedFromEmail} />
          <Item k="Lead added" v={fmtDay(row.leadCreatedAt)} />
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onMore} className="flex-1 rounded-lg px-4 py-2.5 text-sm font-bold text-white" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>More details</button>
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-500">Close</button>
        </div>
      </div>
    </div>
  );
}

// Full missed-commitments list in a themed popup: filter by agent/manager,
// paginated. Reads the already-loaded items (calls, tasks, unsubmitted drafts).
function MissedCommitmentsModal({ items, byOwner, initialOwnerId, isAdmin, onDismiss, onOpenLead, onClose }) {
  const [ownerId, setOwnerId] = React.useState(initialOwnerId || '');
  const [page, setPage] = React.useState(1);
  const perPage = 10;
  const open = (items || []).filter((i) => !i.resolved);
  const filtered = ownerId ? open.filter((i) => String(i.ownerId) === String(ownerId)) : open;
  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const pageItems = filtered.slice((page - 1) * perPage, page * perPage);
  React.useEffect(() => { setPage(1); }, [ownerId]);
  const kindIcon = (k) => (k === 'call' ? '📞' : k === 'draft' ? '✍️' : '✅');

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[90] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[85vh]" onClick={(e) => e.stopPropagation()} style={{ fontFamily: "'Plus Jakarta Sans',system-ui,sans-serif" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <div className="text-base font-extrabold text-[#050A1F]">⚠️ Missed commitments</div>
            <div className="text-[11px] text-slate-400">{filtered.length} open · scheduled calls, tasks and unsubmitted drafts past due</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2 flex-shrink-0">
          <span className="text-xs font-semibold text-slate-500">Filter by owner</span>
          <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600">
            <option value="">All owners</option>
            {byOwner.map((o) => <option key={o.ownerId} value={o.ownerId}>{o.ownerName} ({o.missed})</option>)}
          </select>
        </div>

        <div className="px-5 py-3 overflow-y-auto flex-1">
          {pageItems.length === 0 && <div className="text-slate-400 text-sm py-10 text-center">Nothing here.</div>}
          <div className="space-y-1.5">
            {pageItems.map((i) => (
              <div key={i.activityId} className="flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-2 text-xs hover:bg-red-50/40 group">
                <span className="cursor-pointer" onClick={() => onOpenLead(i.leadId)}>{kindIcon(i.kind)}</span>
                <span className="font-bold text-[#050A1F] truncate max-w-[150px] cursor-pointer" onClick={() => onOpenLead(i.leadId)}>{i.leadName}</span>
                <span className="text-slate-500 truncate flex-1 cursor-pointer" onClick={() => onOpenLead(i.leadId)}>{i.title}</span>
                <span className="shrink-0 text-[10px] bg-slate-100 text-slate-500 rounded-full px-2 py-0.5">{i.ownerName}</span>
                <span className="font-bold text-red-600 shrink-0">{i.hoursLate}h late</span>
                {isAdmin && (
                  <button title="Clear" onClick={() => onDismiss(i)}
                    className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-slate-400 hover:bg-red-100 hover:text-red-600">×</button>
                )}
              </div>
            ))}
          </div>
        </div>

        {pages > 1 && (
          <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between flex-shrink-0">
            <span className="text-[11px] text-slate-400">Page {page} of {pages}</span>
            <div className="flex gap-1.5">
              <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 disabled:opacity-40">Prev</button>
              <button disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

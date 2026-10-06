import React, { useState, useEffect } from 'react';
import { toast } from './toast';
import { api, DashboardGmailNotice } from './App.jsx';

// Human-readable "how long ago" for email awaiting-reply ages.
function fmtAge(ms) {
  const h = Math.floor(ms / 3600000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60000))}m`;
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
import { Pagination } from './Leads.jsx';
import { showCelebration } from './SaleCelebration.jsx';
import SalesRace from './SalesRace.jsx';
import { CrmSurveyGate } from './CrmSurvey.jsx';

const usd = (n) => `$${Number(n || 0).toLocaleString()}`;
const medal = (i) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`);
const initials = (name) => (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

// Stable per-agent colour: the same name always maps to the same [bg, fg] pair,
// so an agent is recognisable by colour across avatars and name chips. (Kept in
// sync with the palette in Leads.jsx.)
const AGENT_PALETTE = [
  ['#f3e8ff', '#7e22ce'], ['#fce7f3', '#9d174d'], ['#ccfbf1', '#115e59'],
  ['#e0e7ff', '#3730a3'], ['#fef3c7', '#92400e'], ['#dbeafe', '#1e40af'],
  ['#dcfce7', '#166534'], ['#ffedd5', '#9a3412'], ['#cffafe', '#155e75'],
  ['#fae8ff', '#86198f'],
];
function agentColor(name) {
  const s = String(name || '?');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AGENT_PALETTE[h % AGENT_PALETTE.length];
}

const DB_FONT = "'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif";
// Small uppercase section label that groups the dashboard into readable blocks.
function SectionLabel({ children, right }) {
  return (
    <div className="flex items-center justify-between gap-3 mt-2 mb-1">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.07em] text-slate-500">{children}</h2>
      {right}
    </div>
  );
}
// Card header: bold title + muted subtitle, used across the dashboard cards.
function CardHead({ title, sub, right }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-3">
      <div>
        <div className="text-[15px] font-bold text-slate-900">{title}</div>
        {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

// Small empty-state line used inside the email activity tabs.
function Empty({ text }) {
  return <div className="text-[11px] text-slate-400 text-center py-6">{text}</div>;
}

// Highlighted agent-name chip, coloured by the agent so each person is
// recognisable at a glance (same colour as their avatar).
function AgentChip({ name }) {
  if (!name) return null;
  const [bg, fg] = agentColor(name);
  return <span className="inline-flex items-center gap-1 text-[10px] font-bold rounded-full px-1.5 py-0.5 align-middle whitespace-nowrap" style={{ background: bg, color: fg }}>
    <span className="w-1.5 h-1.5 rounded-full" style={{ background: fg }} />{name}
  </span>;
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
  const [broken, setBroken] = useState(false);
  // Show the person's photo when we have a usable one; otherwise fall back to
  // their initials. We intentionally DO NOT fall back to the company logo — a
  // person without a photo should show initials, not the brand mark.
  if (src && !broken) {
    return <img src={src} alt={name} onError={() => setBroken(true)} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  }
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
    <div className={`relative overflow-hidden bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5 ${onClick ? 'cursor-pointer hover:shadow-md transition' : ''}`} onClick={onClick}>
      <div className="absolute top-0 right-0 w-24 h-24 rounded-bl-full pointer-events-none" style={{ background: accent + '0d' }}></div>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: accent }}>{label}</span>
      </div>
      <div className="text-3xl font-extrabold tracking-tight mt-2" style={{ color: accent }}>
        {fmt(achieved)}{has && <span className="text-slate-300 text-lg font-semibold"> / {fmt(target)}</span>}
        {has && <span className="text-sm font-bold text-slate-400 ml-1.5">({pct}%)</span>}
      </div>
      {has && (
        <>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden mt-2.5">
            <div className="h-full rounded-full" style={{ width: `${Math.max(3, pct)}%`, background: done ? '#16A34A' : near ? '#F59E0B' : accent }} />
          </div>
          <div className={`text-[11px] font-semibold mt-2 ${done ? 'text-emerald-600' : near ? 'text-amber-600' : 'text-slate-500'}`}>
            {done ? '🎉 Target achieved!' : zero ? (motivational || 'Let’s get the first one today! 💪')
              : remainingLabel ? `${fmt(remaining)} to achieve your target`
              : near ? `🔥 ${fmt(remaining)} more to go!` : `${fmt(remaining)} to go`}
          </div>
        </>
      )}
      {!has && <div className="text-[11px] text-slate-400 mt-2">No target set</div>}
      {splitNote && (
        <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-2 gap-2">
          <div>
            <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Agents &amp; managers</div>
            <div className="text-sm font-extrabold text-slate-900">{splitNote.team}</div>
          </div>
          <div>
            <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Admin-owned</div>
            <div className="text-sm font-extrabold text-slate-400">{splitNote.admin}</div>
            <div className="text-[8px] text-slate-300 font-semibold">not counted in target</div>
          </div>
        </div>
      )}
      {awaitingNote && <div className="text-[11px] font-semibold text-amber-600 mt-1.5">⏳ {awaitingNote} won — counts once collected</div>}
      {pipelineNote && <div className="text-[11px] font-semibold text-indigo-500 mt-1">💼 {pipelineNote} in pipeline</div>}
      {cta && <div className="text-xs font-bold mt-2.5" style={{ color: accent }}>{cta} →</div>}
    </div>
  );
}

function PlainStat({ label, value, sub, accent, onClick, cta }) {
  return (
    <div className={`relative overflow-hidden bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5 ${onClick ? 'cursor-pointer hover:shadow-md transition' : ''}`} onClick={onClick}>
      <div className="absolute top-0 right-0 w-24 h-24 rounded-bl-full pointer-events-none" style={{ background: accent + '0d' }}></div>
      <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: accent }}>{label}</span>
      <div className="text-3xl font-extrabold tracking-tight mt-2" style={{ color: accent }}>{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-2">{sub}</div>}
      {cta && <div className="text-xs font-bold mt-2.5" style={{ color: accent }}>{cta} →</div>}
    </div>
  );
}

// Compact "how long ago" label for a timestamp.
function agoLabel(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}

function isTodayIso(iso) {
  if (!iso) return false;
  const d = new Date(iso); const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

// Revamped intake card (Today's leads / Untouched 3+ days). Clean header with a
// big count + small caption and a pill "see all" button; rows are card-style
// with a colour-coded agent avatar, lead name, website, a source badge
// (Generated/Assigned) and the time/age on the right.
function LeadMiniList({ title, count, target, items, accent, onOpenLead, onSeeAll, seeAllLabel, breakdown, showOwner, showAge, emptyHint, ownerTabs }) {
  const [ownerFilter, setOwnerFilter] = useState(null); // ownerId | null = all
  const shownItems = ownerFilter == null ? items : items.filter((l) => l.ownerId === ownerFilter);
  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5 flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{title}</div>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-[26px] leading-none font-extrabold" style={{ color: accent }}>{count}</span>
            {target > 0 && <span className="text-slate-300 text-base font-bold">/ {target}</span>}
            {target > 0 && count < target && <span className="text-[11px] font-bold text-slate-400">{target - count} to go</span>}
          </div>
          {breakdown && (
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {breakdown.map((b) => (
                <span key={b.label} className="inline-flex items-center gap-1 text-[10px] font-bold rounded-full px-2 py-0.5" style={{ background: b.color + '14', color: b.color }}>
                  {b.icon} {b.value} {b.label}
                </span>
              ))}
            </div>
          )}
        </div>
        <button onClick={onSeeAll} className="shrink-0 text-[11px] font-bold rounded-full px-3 py-1.5 transition" style={{ background: accent + '14', color: accent }}>{seeAllLabel || 'See all'} →</button>
      </div>

      {/* Per-agent filter tabs (each agent coloured; shows their untouched count). */}
      {ownerTabs && ownerTabs.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
          <button onClick={() => setOwnerFilter(null)}
            className={`rounded-full px-2.5 py-1 text-[10px] font-bold transition ${ownerFilter == null ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>All</button>
          {ownerTabs.slice(0, 8).map((o) => {
            const [bg, fg] = agentColor(o.ownerName);
            const on = ownerFilter === o.ownerId;
            return (
              <button key={o.ownerId} onClick={() => setOwnerFilter(on ? null : o.ownerId)}
                className="rounded-full px-2.5 py-1 text-[10px] font-bold transition inline-flex items-center gap-1.5"
                style={on ? { background: fg, color: '#fff' } : { background: bg, color: fg }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: on ? '#fff' : fg }} />
                {o.ownerName} · {o.count}
              </button>
            );
          })}
        </div>
      )}

      {emptyHint && <div className="text-[11px] text-amber-600 bg-amber-50 rounded-lg px-2.5 py-1.5 mb-2">{emptyHint}</div>}

      {shownItems.length === 0 ? (
        <div className="flex items-center justify-center text-slate-300 text-sm py-8" style={{ height: 290 }}>Nothing here yet.</div>
      ) : (
        // Fixed window sized to ~5 rows; the rest scroll vertically inside. Only
        // the most recent 15 are rendered here — "View all" opens the full list.
        <div className="flex flex-col gap-1 overflow-y-auto overflow-x-hidden nice-scroll" style={{ height: 290 }}>
          {shownItems.slice(0, 15).map((l) => {
            const today = isTodayIso(l.at);
            const [avBg, avFg] = agentColor(l.ownerName || l.name);
            const isGen = l.kind === 'generated';
            return (
            <div key={`${l.kind || 'x'}-${l._id}`} onClick={() => onOpenLead(l._id)}
              className="flex items-center gap-3 rounded-xl px-2.5 py-2 cursor-pointer hover:bg-slate-50 transition-colors">
              {/* Colour-coded agent avatar */}
              <div className="w-9 h-9 rounded-[11px] flex items-center justify-center font-bold text-[13px] shrink-0" style={{ background: avBg, color: avFg }}>{initials(l.name)}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-bold text-[13px] text-slate-900 truncate">{l.name}</span>
                  {l.kind && (
                    <span className="shrink-0 text-[9px] font-extrabold uppercase tracking-wide rounded px-1.5 py-0.5" style={isGen ? { background: '#f5f3ff', color: '#7c3aed' } : { background: '#ecfeff', color: '#0e7490' }}>
                      {isGen ? '✨ Generated' : '📥 Assigned'}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-400 truncate flex items-center gap-1.5 mt-0.5">
                  {showOwner && l.ownerName ? <AgentChip name={l.ownerName} /> : null}
                  {l.website ? <span className="truncate">{l.website}</span> : (!showOwner && l.ownerName ? <span className="truncate">{l.ownerName}</span> : null)}
                </div>
              </div>
              {/* Time / age */}
              <div className="flex items-center gap-2.5 shrink-0 pl-1">
                {(showAge && l.at) && (
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-md whitespace-nowrap ${today ? 'bg-green-50 text-green-600' : 'bg-slate-100 text-slate-400'}`}>
                    {today ? 'today' : agoLabel(l.at)}
                  </span>
                )}
                <span className="text-slate-300 text-sm">→</span>
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Daily lead volume for the current month — STACKED BARS in one indigo family
// (pre-sales / cold-calling / transferred), with a hover tooltip. One hue keeps
// it calm; three shades separate the sources.
function LeadDailyChart({ daily }) {
  const [hover, setHover] = useState(null); // index of hovered day
  if (!daily || daily.length === 0) return null;
  const W = 560, H = 150, padL = 26, padB = 20, padT = 10;
  // Darkest → lightest, matching the lead-trend line colours.
  const series = [
    { key: 'presales', color: '#4338CA', label: 'Pre-sales' },
    { key: 'cold', color: '#818CF8', label: 'Cold-calling' },
    { key: 'transferred', color: '#C7D2FE', label: 'Transferred' },
  ];
  const stackTotal = (d) => series.reduce((s, ser) => s + (d[ser.key] || 0), 0);
  const max = Math.max(1, ...daily.map(stackTotal));
  const slot = (W - padL - 8) / daily.length;
  const barW = Math.max(2, Math.min(12, slot - 2));
  const y = (v) => H - padB - (v / max) * (H - padB - padT);
  const today = new Date().getDate();
  return (
    <div className="relative">
      <div className="flex items-center gap-3 mb-1 flex-wrap">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1 text-[10px] font-bold text-slate-500">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />{s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ display: 'block' }} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((g) => (
          <line key={g} x1={padL} x2={W - 8} y1={y(max * g)} y2={y(max * g)} stroke="#eef2f7" strokeWidth="1" />
        ))}
        <text x={4} y={y(max) + 4} fontSize="8" fill="#94a3b8">{max}</text>
        <text x={4} y={y(0) + 4} fontSize="8" fill="#94a3b8">0</text>
        {daily.map((d, i) => {
          const cx = padL + i * slot + slot / 2;
          const bx = cx - barW / 2;
          let yCursor = H - padB;
          const isToday = d.day === today;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} style={{ cursor: 'pointer' }}>
              {/* hover hit area */}
              <rect x={cx - slot / 2} y={0} width={slot} height={H - padB} fill="transparent" />
              {series.map((s, si) => {
                const v = d[s.key] || 0;
                if (v <= 0) return null;
                const h = (v / max) * (H - padB - padT);
                yCursor -= h;
                return <rect key={s.key} x={bx} y={yCursor} width={barW} height={h}
                  rx={si === 0 ? 2.5 : 0} fill={s.color} opacity={hover != null && hover !== i ? 0.5 : 1} />;
              })}
              {(d.day % 5 === 0 || d.day === 1) && <text x={cx} y={H - 6} textAnchor="middle" fontSize="8" fill={isToday ? '#4338CA' : '#94a3b8'} fontWeight={isToday ? 'bold' : 'normal'}>{d.day}</text>}
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <div className="absolute pointer-events-none z-20" style={{ left: `${((padL + hover * slot + slot / 2) / W) * 100}%`, top: 24, transform: 'translate(-50%, 0)' }}>
          <div className="rounded-lg bg-[#0A0E28] text-white px-2.5 py-1.5 shadow-lg whitespace-nowrap">
            <div className="text-[10px] font-bold text-slate-300">Day {daily[hover].day} · {stackTotal(daily[hover])} total</div>
            {series.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5 text-[11px] font-semibold">
                <span className="w-2 h-2 rounded-sm" style={{ background: s.color }} />{s.label}: <b>{daily[hover][s.key] || 0}</b>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// 6-month lead trend: three LINES (pre-sales / cold-calling / transferred) in a
// single indigo hue (dark → light), with a hover tooltip showing that month's
// values. One colour family keeps it calm; line weight + dot pick out the hovered
// month.
// 6-month lead trend — STACKED BARS (pre-sales / cold-calling / transferred) in
// one indigo family, matching the "Leads this month" chart, with a tooltip.
function LeadMonthlyChart({ monthly }) {
  const [hover, setHover] = useState(null); // index of hovered month
  if (!monthly || monthly.length === 0) return null;
  const W = 540, H = 160, padL = 26, padB = 26, padT = 12;
  // Indigo family, darkest → lightest (same hue as Leads-this-month).
  const series = [
    { key: 'presales', color: '#4338CA', label: 'Pre-sales' },
    { key: 'cold', color: '#818CF8', label: 'Cold-calling' },
    { key: 'transferred', color: '#C7D2FE', label: 'Transferred' },
  ];
  const stackTotal = (m) => series.reduce((s, ser) => s + (m[ser.key] || 0), 0);
  const max = Math.max(1, ...monthly.map(stackTotal));
  const slot = (W - padL - 10) / monthly.length;
  const barW = Math.min(34, slot - 14);
  const y = (v) => H - padB - (v / max) * (H - padB - padT);
  return (
    <div className="relative">
      <div className="flex items-center gap-3 mb-1 flex-wrap">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1 text-[10px] font-bold text-slate-500">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />{s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ display: 'block' }} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((g) => (
          <line key={g} x1={padL} x2={W - 10} y1={y(max * g)} y2={y(max * g)} stroke="#eef2f7" strokeWidth="1" />
        ))}
        <text x={4} y={y(max) + 4} fontSize="8" fill="#94a3b8">{max}</text>
        <text x={4} y={y(0) + 4} fontSize="8" fill="#94a3b8">0</text>
        {monthly.map((m, i) => {
          const cx = padL + i * slot + slot / 2;
          const bx = cx - barW / 2;
          const total = stackTotal(m);
          let yCursor = H - padB;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} style={{ cursor: 'pointer' }}>
              <rect x={cx - slot / 2} y={0} width={slot} height={H - padB} fill="transparent" />
              {series.map((s, si) => {
                const v = m[s.key] || 0;
                if (v <= 0) return null;
                const h = (v / max) * (H - padB - padT);
                yCursor -= h;
                return <rect key={s.key} x={bx} y={yCursor} width={barW} height={h}
                  rx={si === 0 ? 3 : 0} fill={s.color} opacity={hover != null && hover !== i ? 0.5 : 1} />;
              })}
              {total > 0 && <text x={cx} y={y(total) - 4} textAnchor="middle" fontSize="8.5" fontWeight="bold" fill="#050A1F">{total}</text>}
              <text x={cx} y={H - 8} textAnchor="middle" fontSize="9" fill="#94a3b8">{m.month}</text>
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <div className="absolute pointer-events-none z-20" style={{ left: `${((padL + hover * slot + slot / 2) / W) * 100}%`, top: 24, transform: 'translate(-50%, 0)' }}>
          <div className="rounded-lg bg-[#0A0E28] text-white px-2.5 py-1.5 shadow-lg whitespace-nowrap">
            <div className="text-[10px] font-bold text-slate-300">{monthly[hover].month} {monthly[hover].year || ''} · {stackTotal(monthly[hover])} total</div>
            {series.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5 text-[11px] font-semibold">
                <span className="w-2 h-2 rounded-sm" style={{ background: s.color }} />{s.label}: <b>{monthly[hover][s.key] || 0}</b>
              </div>
            ))}
          </div>
        </div>
      )}
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
  const [hover, setHover] = useState(null); // { x, y, label, color, amount, month }
  if (!trend || trend.length === 0) return null;
  const W = 520, H = 150, pad = 26;
  // Google-blue family. Team fresh is the deepest blue, cross a lighter blue;
  // admin-owned segments use progressively lighter blue tints so the whole
  // chart stays one hue while still telling fresh / cross / admin apart.
  const TEAM_NEW = '#1A73E8', TEAM_CROSS = '#5B9BF5';
  const ADMIN_COLORS = ['#A8C7F9', '#C6DAFC', '#8AB4F8', '#D2E3FC', '#669DF6'];
  // Collect the distinct admin names across the trend (stable order).
  const adminNames = [];
  trend.forEach((t) => (t.adminSegments || []).forEach((a) => { if (!adminNames.includes(a.name)) adminNames.push(a.name); }));
  const adminColor = {};
  adminNames.forEach((n, i) => { adminColor[n] = ADMIN_COLORS[i % ADMIN_COLORS.length]; });
  // Stacked total per month (fallback to salesUsd if segments are absent).
  const stackTotal = (t) => {
    const segSum = (t.teamNewUsd || 0) + (t.teamCrossUsd || 0) + (t.adminSegments || []).reduce((s, a) => s + (a.amount || 0), 0);
    return segSum > 0 ? segSum : (t.salesUsd || 0);
  };
  const max = Math.max(1, ...trend.map(stackTotal));
  const bw = (W - pad * 2) / trend.length;
  const compact = (v) => v >= 1000 ? `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `$${Math.round(v)}`;
  const usdFull = (v) => `$${Math.round(v).toLocaleString('en-US')}`;
  return (
    <div className="relative">
      <div>
        <svg viewBox={`0 0 ${W} ${H + 28}`} className="w-full" style={{ display: 'block' }} onMouseLeave={() => setHover(null)}>
          {[0, 0.5, 1].map((g) => <line key={g} x1={pad} x2={W - pad} y1={pad + (H - pad) * (1 - g)} y2={pad + (H - pad) * (1 - g)} stroke="#e2e8f0" strokeWidth="1" />)}
          {trend.map((t, i) => {
            const total = stackTotal(t);
            const x = pad + i * bw + bw * 0.2;
            const fullH = (total / max) * (H - pad);
            // Build the stack: team new, team cross, then each admin. Each seg
            // carries a label + amount for the hover tooltip.
            const segs = [
              { v: t.teamNewUsd || 0, c: TEAM_NEW, label: 'Team fresh sales' },
              { v: t.teamCrossUsd || 0, c: TEAM_CROSS, label: 'Team cross sales' },
              ...(t.adminSegments || []).map((a) => ({ v: a.amount || 0, c: adminColor[a.name], label: `Admin — ${a.name}` })),
            ].filter((s) => s.v > 0);
            let yCursor = H; // bottom baseline
            const rects = segs.map((s, si) => {
              const h = (s.v / max) * (H - pad);
              yCursor -= h;
              const segY = yCursor;
              const isHot = hover && hover.month === t.month && hover.label === s.label;
              return (
                <rect key={si} x={x} y={segY} width={bw * 0.6} height={h} fill={s.c}
                  rx={si === segs.length - 1 ? 3 : 0}
                  opacity={hover && !isHot ? 0.55 : 1}
                  style={{ cursor: 'pointer', transition: 'opacity .12s' }}
                  onMouseEnter={() => setHover({ xPct: ((x + bw * 0.3) / W) * 100, yPct: (segY + h / 2) / (H + 28) * 100, label: s.label, color: s.c, amount: s.v, month: `${t.month} ${t.year}` })}
                />
              );
            });
            return (
              <g key={i}>
                {rects}
                <text x={x + bw * 0.3} y={(H - fullH) - 4} textAnchor="middle" fontSize="9" fontWeight="bold" fill="#050A1F">{compact(total)}</text>
                <text x={x + bw * 0.3} y={H + 12} textAnchor="middle" fontSize="9" fill="#94a3b8">{t.month}</text>
                {t.pct != null && <text x={x + bw * 0.3} y={H + 23} textAnchor="middle" fontSize="8" fontWeight="bold" fill="#16A34A">{t.pct}%</text>}
              </g>
            );
          })}
        </svg>
        {hover && (
          <div className="absolute pointer-events-none z-20" style={{ left: `${hover.xPct}%`, top: `${hover.yPct}%`, transform: 'translate(-50%, -115%)' }}>
            <div className="rounded-lg bg-[#0A0E28] text-white px-2.5 py-1.5 shadow-lg whitespace-nowrap">
              <div className="flex items-center gap-1.5 text-[10px] font-bold"><span className="w-2 h-2 rounded-sm" style={{ background: hover.color }} />{hover.label}</div>
              <div className="text-[13px] font-extrabold">{usdFull(hover.amount)}</div>
              <div className="text-[9px] text-slate-300">{hover.month}</div>
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 px-1">
        <LegendDot color={TEAM_NEW} label="Team fresh" />
        <LegendDot color={TEAM_CROSS} label="Team cross" />
        {adminNames.map((n) => <LegendDot key={n} color={adminColor[n]} label={`Admin — ${n}`} />)}
      </div>
    </div>
  );
}
function LegendDot({ color, label }) {
  return <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-slate-500"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />{label}</span>;
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

// Non-dismissable modal reminding a manager to review last month's agents.
// Stays until every agent under them has a saved review for last month.
function ManagerReviewReminder({ info, onGoReviews, onLater }) {
  const monthLabel = (() => {
    try { const [y, m] = info.period.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); } catch { return 'last month'; }
  })();
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl" style={{ fontFamily: "'Plus Jakarta Sans',system-ui,sans-serif" }}>
        <div className="text-2xl mb-1">📋</div>
        <div className="text-lg font-bold text-slate-900">Time to review your team</div>
        <p className="text-sm text-slate-500 mt-1">
          It's review time for <b>{monthLabel}</b>. Please complete a review for each of your agents.
        </p>
        <div className="mt-3 rounded-xl bg-slate-50 border border-slate-100 p-3">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">
            {info.reviewedCount}/{info.totalAgents} done · {info.pending.length} remaining
          </div>
          <div className="flex flex-wrap gap-1.5">
            {info.pending.map((a) => (
              <span key={a.id} className="rounded-full bg-white border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600">{a.name}</span>
            ))}
          </div>
        </div>
        <button onClick={onGoReviews}
          className="w-full mt-4 rounded-lg px-4 py-2.5 text-sm font-bold text-white"
          style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>
          Start reviewing →
        </button>
        <button onClick={onLater}
          className="w-full mt-2 rounded-lg px-4 py-2 text-sm font-bold text-slate-500 hover:bg-slate-100">
          Later
        </button>
        <p className="text-[11px] text-slate-400 text-center mt-2">We'll remind you again until all {monthLabel} reviews are done.</p>
      </div>
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

// ---------------------------------------------------------------------------
// v604 redesign — presentation helpers for the new dashboard layout.
// ---------------------------------------------------------------------------
const deltaStr = (n, { pct = false, unit = '' } = {}) => {
  if (n == null) return null;
  const arrow = n > 0 ? '▲' : n < 0 ? '▼' : '•';
  const cls = n > 0 ? 'text-green-600' : n < 0 ? 'text-red-500' : 'text-slate-400';
  const val = pct ? `${Math.abs(n)}%` : `${Math.abs(n)}${unit}`;
  return <span className={`font-semibold ${cls}`}>{arrow} {val}</span>;
};

// Dark hero band with month-over-month headline figures.
function DashHero({ greeting, name, scopeLabel, deltas }) {
  const d = deltas || {};
  const cmp = !!d.compareLastMonth; // before the 15th this is false → "this month so far"
  const soFar = <span className="text-slate-400">this month so far</span>;
  return (
    <div className="relative overflow-hidden rounded-3xl p-6 sm:p-7 text-white"
      style={{ background: 'radial-gradient(900px 300px at 85% -40%, #fb923c55, transparent), linear-gradient(120deg,#0b1020,#111a33)' }}>
      <div className="absolute -right-16 -top-16 w-56 h-56 rounded-full" style={{ background: '#f9731622' }} />
      <div className="relative">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{greeting}, {name} 👋</h1>
        <div className="text-slate-300 text-sm mt-1">{scopeLabel}</div>
        <div className="flex flex-wrap gap-x-12 gap-y-5 mt-6">
          <div className="min-w-[108px]">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Collected</div>
            <div className="text-2xl font-extrabold mt-0.5">{usd(d.collectedThisMonthUsd || 0)}</div>
            <div className="text-[11px] mt-0.5">{cmp ? <>{deltaStr(d.collectedDeltaPct, { pct: true }) || <span className="text-slate-400">—</span>} <span className="text-slate-400">vs last mo</span></> : soFar}</div>
          </div>
          <div className="min-w-[108px]">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Target</div>
            <div className="text-2xl font-extrabold mt-0.5">{d.targetUsd ? usd(d.targetUsd) : '—'}</div>
            <div className="text-[11px] mt-0.5 text-slate-300">{d.targetPct != null ? `${d.targetPct}% achieved` : 'No target set'}</div>
          </div>
          <div className="min-w-[88px]">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Converted</div>
            <div className="text-2xl font-extrabold mt-0.5">{d.convertedThisMonth || 0}</div>
            <div className="text-[11px] mt-0.5">{cmp ? <>{deltaStr(d.convertedDelta) || <span className="text-slate-400">—</span>} <span className="text-slate-400">vs last mo</span></> : soFar}</div>
          </div>
          <div className="min-w-[88px]">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Leads</div>
            <div className="text-2xl font-extrabold mt-0.5">{d.leadsThisMonth || 0}</div>
            <div className="text-[11px] mt-0.5">{cmp ? <>{deltaStr(d.leadsDeltaPct, { pct: true }) || <span className="text-slate-400">—</span>} <span className="text-slate-400">vs last mo</span></> : soFar}</div>
          </div>
          <div className="min-w-[88px]">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Pipeline</div>
            <div className="text-2xl font-extrabold mt-0.5">{usd(d.pipelineUsd || 0)}</div>
            <div className="text-[11px] mt-0.5 text-slate-400">open deals</div>
          </div>
          {/* Admin-owned sales — admin viewer only. Kept OUT of team/company
              target; shown here and in the sales trend so the admin can see
              their own closed business this month. */}
          {d.adminSalesUsd != null && (
            <div className="min-w-[108px] pl-6 border-l border-white/15">
              <div className="text-[10px] font-bold uppercase tracking-wide text-indigo-300">Admin-owned sales</div>
              <div className="text-2xl font-extrabold mt-0.5">{usd(d.adminSalesUsd || 0)}</div>
              <div className="text-[11px] mt-0.5 text-slate-400">your own · this month</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// KPI box with corner wash, icon chip, big number, optional progress bar.
function KpiBox({ icon, iconBg, iconColor, label, value, foot, footColor, pct, barColor }) {
  return (
    <div className="relative overflow-hidden bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4">
      <span className="absolute right-3.5 top-3.5 w-8 h-8 rounded-[10px] flex items-center justify-center text-base" style={{ background: iconBg, color: iconColor }}>{icon}</span>
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-[25px] leading-none font-extrabold tracking-tight text-slate-900 mt-2">{value}</div>
      {pct != null && (
        <div className="h-[7px] rounded-full bg-slate-100 overflow-hidden mt-2.5">
          <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, pct))}%`, background: barColor || '#16a34a' }} />
        </div>
      )}
      {foot && <div className="text-[11.5px] font-semibold mt-1.5" style={{ color: footColor || '#94a3b8' }}>{foot}</div>}
    </div>
  );
}

// Today's-pulse tile: quiet slate background so it doesn't fight the KPI row.
function PulseTile({ icon, iconColor, value, label, delta }) {
  return (
    <div className="flex items-center gap-3 rounded-[13px] border border-slate-200/70 p-3" style={{ background: 'linear-gradient(135deg,#f8fafc,#f1f5f9)' }}>
      <span className="w-9 h-9 rounded-[11px] bg-white flex items-center justify-center text-[17px] shrink-0" style={{ boxShadow: `0 1px 3px ${iconColor}22`, color: iconColor }}>{icon}</span>
      <div className="min-w-0">
        <div className="text-xl font-extrabold text-slate-900 leading-none">{value}</div>
        <div className="text-[10.5px] text-slate-400 font-semibold mt-0.5">{label}</div>
        {delta != null && <div className="text-[10px] font-bold mt-0.5">{deltaStr(delta)}</div>}
      </div>
    </div>
  );
}

// One Recognition card.
function RecognitionBox({ emoji, kicker, kColor, borderColor, bg, avBg, avColor, name, sub, src, logo }) {
  if (!name) return null;
  return (
    <div className="relative overflow-hidden rounded-2xl p-4 border" style={{ borderColor, background: bg }}>
      <div className="text-[10px] font-extrabold uppercase tracking-wide" style={{ color: kColor }}>{emoji} {kicker}</div>
      <div className="flex items-center gap-3 mt-2.5">
        {src !== undefined
          ? <Avatar name={name} src={src} logo={logo} size={40} />
          : <div className="w-10 h-10 rounded-[13px] flex items-center justify-center font-bold text-[15px]" style={{ background: avBg, color: avColor }}>{initials(name)}</div>}
        <div className="min-w-0">
          <div className="text-base font-extrabold text-slate-900 truncate">{name}</div>
          <div className="text-[11px] text-slate-500 truncate">{sub}</div>
        </div>
      </div>
    </div>
  );
}

function SalesDashboard({ user, onViewUntouched, onGoLeads, onViewConverted, onViewToday, onGoReviews, mode = 'overview', onModeChange }) {
  const [data, setData] = useState(null);
  const [showRace, setShowRace] = useState(false);
  // Non-dismissable last-month review reminder for managers (from the 5th).
  const [reviewDue, setReviewDue] = useState(null);
  useEffect(() => {
    if (user.role !== 'manager') return;
    api('/reviews/pending-last-month').then((r) => { if (r && r.due) setReviewDue(r); else setReviewDue(null); }).catch(() => {});
  }, [user.role]);
  const [err, setErr] = useState('');
  const [showAwaiting, setShowAwaiting] = useState(false);
  useEffect(() => { api('/leads/dashboard').then(setData).catch((e) => setErr(e.message)); }, []);
  // Commitments that blew past their agreed time. Managers and admins see the
  // whole team's; an agent sees only their own.
  const [missed, setMissed] = useState(null);
  const [missedModal, setMissedModal] = useState(null); // { ownerId } | null
  const [missedFilter, setMissedFilter] = useState(null); // ownerId filter for the inline list | null = all
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
  // v604 redesign payloads (all role-scoped by the backend).
  const pulse = data.pulse || {};
  const deltas = data.deltas || {};
  const rates = data.rates || {};
  const recognition = data.recognition || {};
  const nudges = data.dealsNeedingNudge || [];
  const scopeLabel = isAdmin ? 'Company-wide performance this month.' : isManager ? "Your team's performance this month." : 'Your performance this month.';

  return (
    <div className="space-y-6" style={{ fontFamily: DB_FONT }}>
      {/* Full-screen sales race (gamified leaderboard). */}
      {showRace && <SalesRace onClose={() => setShowRace(false)} />}

      {/* Non-dismissable last-month agent-review reminder (managers, from 5th). */}
      {reviewDue && <ManagerReviewReminder info={reviewDue} onGoReviews={onGoReviews} onLater={() => setReviewDue(null)} />}

      {/* Prompt to connect email until the user has done so. */}
      <DashboardGmailNotice />

      {/* Pending team survey (popup + banner). Admins manage surveys and are
          never prompted to answer them. */}
      {!isAdmin && <CrmSurveyGate />}

      {/* Celebration slider — rotates the latest sales win and today's
          birthdays / work + wedding anniversaries, 10s per slide. */}
      <CelebrationSlider wins={wins} celebrations={celebrations} user={user} />

      {/* HERO — dark band with month-over-month deltas + view switcher. */}
      <div className="relative">
        <DashHero greeting={greeting} name={user.name.split(' ')[0]} scopeLabel={scopeLabel} deltas={deltas} />
        {(isAdmin || isManager) && onModeChange && (
          <div className="absolute right-5 top-5 inline-flex items-center gap-1 bg-white/10 border border-white/20 rounded-2xl p-1.5 backdrop-blur-sm">
            {[['overview', 'Overview'], ['analytics', 'Analytics']].map(([id, label]) => (
              <button key={id} onClick={() => onModeChange(id)}
                className={`px-4 py-1.5 rounded-xl text-sm font-medium transition ${mode === id ? 'bg-white text-slate-900 font-semibold' : 'text-slate-200 hover:text-white'}`}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* KPI GRID — Sales vs target · Converted · Conversion rate · Collection rate */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiBox icon="💰" iconBg="#f0fdf4" iconColor="#16a34a"
          label={isAdmin ? 'Sales · company target' : isManager ? 'Sales · team target' : 'Sales · your target'}
          value={usd(m.scopeAchieved)}
          pct={m.scopePct != null ? m.scopePct : 0}
          barColor="#16a34a"
          foot={m.scopeTarget > 0 ? `${usd(m.scopeRemaining)} to go · ${m.scopePct}%` : 'No target set'}
          footColor={m.scopeTarget > 0 ? '#c2410c' : '#94a3b8'} />
        <KpiBox icon="✓" iconBg="#ecfdf5" iconColor="#059669"
          label="Converted this month" value={m.convertedThisMonth}
          foot={m.newSalesCount + m.crossSalesCount > 0 ? `${m.newSalesCount} new · ${m.crossSalesCount} cross-sell` : 'No sales collected yet'} />
        <KpiBox icon="🎯" iconBg="#eff6ff" iconColor="#2563eb"
          label="Conversion rate" value={rates.conversionRate != null ? `${rates.conversionRate}%` : '—'}
          pct={rates.conversionRate != null ? rates.conversionRate : 0} barColor="#2563eb"
          foot={<>{deltaStr(rates.conversionDeltaPts, { unit: 'pts' })} {rates.conversionDenom ? <span className="text-slate-400">· {rates.conversionNum} of {rates.conversionDenom}</span> : null}</>} />
        <KpiBox icon="🏦" iconBg="#f0fdf4" iconColor="#16a34a"
          label="Collection rate" value={rates.collectionRate != null ? `${rates.collectionRate}%` : '—'}
          pct={rates.collectionRate != null ? rates.collectionRate : 0} barColor="#16a34a"
          foot={`${usd(rates.collectedUsd || 0)} collected · ${usd(rates.awaitingUsd || 0)} awaiting`} />
      </div>

      {/* TODAY — pulse + what needs action, in ONE section. */}
      <SectionLabel right={<span className="text-[11px] text-slate-400">pulse &amp; what needs action</span>}>Today</SectionLabel>
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 sm:p-5 space-y-4">
        {/* Pulse row — quiet tiles so the KPI boxes above stay dominant. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <PulseTile icon="📞" iconColor="#2563eb" value={(pulse.calls && pulse.calls.today) || 0} label="Calls made" delta={pulse.calls && pulse.calls.delta} />
          <PulseTile icon="✉️" iconColor="#c2410c" value={(pulse.emails && pulse.emails.today) || 0} label="Emails sent" delta={pulse.emails && pulse.emails.delta} />
          <PulseTile icon="📥" iconColor="#16a34a" value={(pulse.newLeads && pulse.newLeads.today) || 0} label="New leads" delta={pulse.newLeads && pulse.newLeads.delta} />
          <PulseTile icon="🔀" iconColor="#7c3aed" value={(pulse.transfers && pulse.transfers.today) || 0} label="Call transfers" delta={pulse.transfers && pulse.transfers.delta} />
        </div>
        {/* Attention row: Missed commitments + Email activity, side by side. */}
        <div className="grid md:grid-cols-2 gap-4 items-start">
        {/* Missed commitments — scheduled calls and tasks that went past their
          agreed time without being completed. Surfaced prominently because a
          missed call is a lead going cold. */}
      {missed && missed.stillOpen > 0 ? (
        <div className="rounded-xl border border-slate-200/70 bg-white p-4">
          {/* Header: title on the left; overdue count + View all grouped on the
              right with clear spacing so they never overlap. */}
          <div className="flex items-start justify-between gap-3 mb-2.5">
            <div className="min-w-0">
              <div className="text-[14px] font-bold text-slate-900">⚠️ Missed commitments</div>
              <div className="text-[11px] text-slate-400">Calls &amp; tasks past their agreed time</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[11px] font-bold rounded-full px-2.5 py-0.5 bg-red-50 text-red-700 ring-1 ring-red-200 whitespace-nowrap">{missed.stillOpen} overdue</span>
              {(isAdmin || isManager) && (
                <button onClick={() => setMissedModal({ ownerId: null })}
                  className="text-[11px] font-bold text-orange-700 bg-orange-50 ring-1 ring-orange-200 rounded-full px-2.5 py-0.5 hover:bg-orange-100 whitespace-nowrap">View all →</button>
              )}
            </div>
          </div>
          {/* Per-owner filter tabs (its own row, so nothing crowds the header). */}
          {(isAdmin || isManager) && missed.byOwner.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
              <button onClick={() => setMissedFilter(null)}
                className={`rounded-full px-2.5 py-1 text-[10px] font-bold transition ${missedFilter == null ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>All</button>
              {missed.byOwner.filter((o) => (o.stillOpen || 0) > 0).slice(0, 6).map((o) => (
                <button key={o.ownerId} onClick={() => setMissedFilter(o.ownerId)}
                  className={`rounded-full px-2.5 py-1 text-[10px] font-bold transition ${missedFilter === o.ownerId ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  {o.ownerName} · {o.stillOpen}
                </button>
              ))}
            </div>
          )}
          <div className="space-y-1.5 max-h-60 overflow-y-auto overflow-x-hidden nice-scroll">
            {missed.items
              .filter((i) => !i.resolved)
              .filter((i) => missedFilter == null || i.ownerId === missedFilter)
              .slice(0, 50).map((i) => (
              <div key={i.activityId} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50 transition-colors">
                <div className="w-8 h-8 rounded-[10px] flex items-center justify-center font-bold text-[12px] shrink-0" style={{ background: agentColor(i.ownerName || i.leadName)[0], color: agentColor(i.ownerName || i.leadName)[1] }}>{initials(i.leadName)}</div>
                <div className="min-w-0 flex-1 cursor-pointer" onClick={() => onViewToday && onViewToday(i.leadId)}>
                  <div className="text-[13px] font-bold text-slate-900 truncate">{i.kind === 'call' ? 'Call' : i.kind === 'draft' ? 'Draft' : 'Task'} · {i.leadName}</div>
                  <div className="text-[11px] text-slate-400 truncate flex items-center gap-1.5">
                    <span className="truncate">{i.title ? i.title : (i.kind === 'call' ? 'Scheduled call' : 'Task')}</span>
                    {(isAdmin || isManager) && i.ownerName && <AgentChip name={i.ownerName} />}
                  </div>
                </div>
                {/* Overdue time is its own always-visible chip (never hidden). */}
                <span className="shrink-0 text-[11px] font-extrabold text-red-600 bg-red-50 rounded-md px-2 py-1 whitespace-nowrap">{i.hoursLate}h late</span>
                <button onClick={() => onViewToday && onViewToday(i.leadId)}
                  className="shrink-0 rounded-lg bg-slate-900 text-white px-3 py-1.5 text-[11px] font-bold hover:bg-slate-700 transition">Open</button>
                {user.role === 'admin' && (
                  <button title="Clear from missed commitments" onClick={async (e) => { e.stopPropagation(); try { await api(`/leads/missed-activities/${i.leadId}/dismiss`, { method: 'POST', body: JSON.stringify({ activityId: i.activityId }) }); setMissed((prev) => prev ? { ...prev, items: prev.items.filter((x) => x.activityId !== i.activityId), stillOpen: Math.max(0, prev.stillOpen - 1) } : prev); } catch { /* */ } }}
                    className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-slate-300 hover:bg-red-100 hover:text-red-600">×</button>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-4 flex flex-col items-center justify-center text-center min-h-[120px]">
          <div className="text-2xl mb-1">✅</div>
          <div className="text-sm font-bold text-slate-600">No missed commitments</div>
          <div className="text-[11px] text-slate-400 mt-0.5">All scheduled calls and tasks are on track.</div>
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
        if (!anythingAtAll) return (
          <div className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-4 flex flex-col items-center justify-center text-center min-h-[120px]">
            <div className="text-2xl mb-1">✉️</div>
            <div className="text-sm font-bold text-slate-600">Email activity</div>
            <div className="text-[11px] text-slate-400 mt-0.5">No new, unopened or recently-opened emails.</div>
          </div>
        );
        const tabs = [
          { id: 'new', label: 'New email', count: newItems.length, color: '#2563EB', bg: 'bg-blue-50', border: 'border-blue-200', dot: '#2563EB' },
          { id: 'notopen', label: 'Not opened', count: notOpenItems.length, color: '#D97706', bg: 'bg-amber-50', border: 'border-amber-200', dot: '#D97706' },
          { id: 'open', label: 'Opened', count: openItems.length, color: '#16A34A', bg: 'bg-green-50', border: 'border-green-200', dot: '#16A34A' },
        ];
        const active = tabs.find((t) => t.id === emailTab) || tabs[0];
        return (
          <div className="rounded-xl border border-slate-200/70 bg-white p-4">
            {/* Heading + description — matches Missed commitments exactly. */}
            <div className="mb-2.5">
              <div className="text-[14px] font-bold text-slate-900">✉️ Email activity</div>
              <div className="text-[11px] text-slate-400">Replies, opens &amp; follow-ups</div>
            </div>
            {/* Tabs on their own row below the heading. */}
            <div className="flex items-center gap-1.5 mb-2.5 flex-wrap">
              {tabs.map((t) => {
                const on = t.id === emailTab;
                return (
                  <button key={t.id} onClick={() => setEmailTab(t.id)}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold transition ${on ? 'text-white' : 'text-slate-500 bg-slate-100 hover:bg-slate-200'}`}
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

            <div className="space-y-1.5 max-h-60 overflow-y-auto overflow-x-hidden nice-scroll">
              {emailTab === 'new' && (newItems.length === 0
                ? <Empty text="No new emails awaiting a reply." />
                : newItems.slice(0, 12).map((i) => {
                    const overdue = (emailReplies.missed || []).some((x) => x.emailId === i.emailId);
                    const who = i.leadName || i.fromName || i.fromEmail || 'Unknown';
                    return (
                      <div key={i.emailId} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50 transition-colors cursor-pointer" onClick={() => onViewToday && onViewToday(i.leadId, { tab: 'email', compose: true })}>
                        <div className="w-8 h-8 rounded-[10px] flex items-center justify-center font-bold text-[12px] shrink-0" style={{ background: agentColor(i.ownerName || who)[0], color: agentColor(i.ownerName || who)[1] }}>{initials(who)}</div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-bold text-slate-900 truncate">{who}</div>
                          <div className="text-[11px] text-slate-400 truncate flex items-center gap-1.5">
                            <span className="truncate">{i.subject || i.snippet || '(no subject)'}</span>
                            {(isAdmin || isManager) && i.ownerName && <AgentChip name={i.ownerName} />}
                          </div>
                        </div>
                        <span className={`shrink-0 text-[11px] font-extrabold rounded-md px-2 py-1 whitespace-nowrap ${overdue ? 'text-red-600 bg-red-50' : 'text-blue-600 bg-blue-50'}`}>{fmtAge(i.ageMs)}</span>
                        {user.role === 'admin' && overdue && (
                          <button title="Dismiss" onClick={async (e) => { e.stopPropagation(); try { await api(`/gmail/awaiting-reply/${i.emailId}/dismiss`, { method: 'POST' }); setEmailReplies((prev) => prev ? { ...prev, missed: prev.missed.filter((x) => x.emailId !== i.emailId) } : prev); } catch { /* */ } }}
                            className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-slate-300 hover:bg-red-100 hover:text-red-600">×</button>
                        )}
                      </div>
                    );
                  }))}

              {emailTab === 'notopen' && (notOpenItems.length === 0
                ? <Empty text="Every sent email has been opened. 🎉" />
                : notOpenItems.slice(0, 12).map((i) => {
                    const who = i.leadName || i.toEmail || 'Unknown';
                    return (
                    <div key={i.id} onClick={() => i.leadId && onViewToday && onViewToday(i.leadId, { tab: 'email', compose: true })} className={`flex items-center gap-3 rounded-lg px-2 py-2 transition-colors ${i.leadId ? 'cursor-pointer hover:bg-slate-50' : ''}`}>
                      <div className="w-8 h-8 rounded-[10px] flex items-center justify-center font-bold text-[12px] shrink-0" style={{ background: agentColor(i.ownerName || who)[0], color: agentColor(i.ownerName || who)[1] }}>{initials(who)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-bold text-slate-900 truncate">{who}</div>
                        <div className="text-[11px] text-slate-400 truncate flex items-center gap-1.5">
                          <span className="truncate">{i.subject || '(no subject)'}</span>
                          {(isAdmin || isManager) && i.ownerName && <AgentChip name={i.ownerName} />}
                        </div>
                      </div>
                      <span className="shrink-0 text-[11px] font-extrabold text-amber-600 bg-amber-50 rounded-md px-2 py-1 whitespace-nowrap">{fmtAge(i.ageMs)}</span>
                    </div>
                    );
                  }))}

              {emailTab === 'open' && (openItems.length === 0
                ? <Empty text="No opens in the last 24 hours yet." />
                : openItems.slice(0, 12).map((i) => {
                    const who = i.leadName || i.toEmail || 'Unknown';
                    return (
                    <div key={i.id} onClick={() => i.leadId && onViewToday && onViewToday(i.leadId, { tab: 'email', compose: true })} className={`flex items-center gap-3 rounded-lg px-2 py-2 transition-colors ${i.leadId ? 'cursor-pointer hover:bg-slate-50' : ''}`}>
                      <div className="w-8 h-8 rounded-[10px] flex items-center justify-center font-bold text-[12px] shrink-0" style={{ background: agentColor(i.ownerName || who)[0], color: agentColor(i.ownerName || who)[1] }}>{initials(who)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-bold text-slate-900 truncate">{who}</div>
                        <div className="text-[11px] text-slate-400 truncate flex items-center gap-1.5">
                          <span className="truncate">{i.subject || '(no subject)'}{i.opens > 1 ? ` · ${i.opens}×` : ''}{i.clicked ? ' · clicked' : ''}</span>
                          {(isAdmin || isManager) && i.ownerName && <AgentChip name={i.ownerName} />}
                        </div>
                      </div>
                      <span className="shrink-0 text-[11px] font-extrabold text-green-600 bg-green-50 rounded-md px-2 py-1 whitespace-nowrap">{fmtAge(i.ageMs)}</span>
                    </div>
                    );
                  }))}
            </div>
          </div>
        );
      })()}
        </div>{/* end attention grid */}
      </div>{/* end combined Today card */}

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

      {/* INTAKE — today's leads + untouched 3+ days. Each card's list is a fixed
          ~5-row window that scrolls vertically, so the cards never grow with the
          data and both stay the same height (items-start = natural height). */}
      <SectionLabel>Intake</SectionLabel>
      <div className="grid md:grid-cols-2 gap-4 items-start">
        {(() => {
          const todayItems = [...(lists.generatedToday || []), ...(lists.assignedToday || [])];
          const hasToday = todayItems.length > 0;
          // Show today's leads when there are any; otherwise fall back to the
          // most recently added leads, clearly tagged with how long ago.
          const items = hasToday ? todayItems : (lists.recentlyAdded || []);
          return (
            <LeadMiniList
              title="Today's leads"
              count={m.generatedToday + m.assignedToday}
              breakdown={[
                { icon: '✨', label: 'generated', value: m.generatedToday, color: '#7C3AED' },
                { icon: '📥', label: 'assigned', value: m.assignedToday, color: '#0891B2' },
              ]}
              items={items}
              showAge={!hasToday}
              emptyHint={!hasToday ? 'No leads assigned or generated today — showing the most recent.' : null}
              showOwner={isAdmin || isManager}
              accent="#7C3AED" onOpenLead={(id) => onViewToday(id)} onSeeAll={onGoLeads} seeAllLabel="All leads" />
          );
        })()}
        <LeadMiniList title="Untouched 3+ days" count={m.untouched} items={lists.untouched || []}
          showOwner={isAdmin || isManager}
          ownerTabs={(isAdmin || isManager) ? (data.untouchedByOwner || []) : null}
          accent="#DC2626" onOpenLead={(id) => onViewToday(id)} onSeeAll={() => onViewUntouched(3)} seeAllLabel="View all untouched" />
      </div>

      <SectionLabel>Recognition</SectionLabel>
      {/* ROW 4 — Top performer + top team + most conversions + most transferred */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
        {/* Most conversions — the new conversions done this month (count). When
            there are none, show the same muted empty state as the sibling boxes
            so the four cards read consistently. */}
        {(m.convertedThisMonth || 0) > 0 ? (
          <div className="relative overflow-hidden rounded-2xl p-5 border" style={{ borderColor: '#bbf7d0', background: 'linear-gradient(135deg,#f0fdf4,#ecfdf5)' }}>
            <div className="text-[11px] font-extrabold uppercase tracking-wide" style={{ color: '#15803d' }}>🎯 Most conversions</div>
            <div className="flex items-center gap-3 mt-2">
              <div className="w-10 h-10 rounded-[13px] flex items-center justify-center text-[18px]" style={{ background: '#ccfbf1', color: '#115e59' }}>✓</div>
              <div className="min-w-0">
                <div className="text-2xl font-extrabold text-slate-900 leading-none">{m.convertedThisMonth}</div>
                <div className="text-[11px] text-slate-500 mt-1">new conversion{m.convertedThisMonth === 1 ? '' : 's'} this month</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-green-100 bg-green-50/40 p-5">
            <div className="text-[11px] font-extrabold uppercase tracking-wide text-green-700">🎯 Most conversions</div>
            <div className="text-sm text-slate-400 mt-2">No conversions yet this month.</div>
          </div>
        )}
        {/* Most transferred this month */}
        {recognition.mostTransferred ? (
          <RecognitionBox emoji="🔀" kicker="Most transferred" kColor="#7c3aed"
            borderColor="#ddd6fe" bg="linear-gradient(135deg,#f5f3ff,#faf5ff)"
            name={recognition.mostTransferred.name} src={recognition.mostTransferred.avatar} logo={user && user.companyLogo}
            sub={`${recognition.mostTransferred.count} call-back${recognition.mostTransferred.count === 1 ? '' : 's'} transferred`} />
        ) : (
          <div className="rounded-2xl border border-violet-100 bg-violet-50/40 p-5 flex items-center"><div className="text-[11px] font-extrabold uppercase tracking-wide text-violet-700">🔀 Most transferred<div className="text-xs font-normal text-slate-400 mt-2 normal-case">No transfers yet this month.</div></div></div>
        )}
      </div>

      <SectionLabel>Performance</SectionLabel>
      {/* ROW 5 — Left: Sales trend + Sales funnel. Right: leaderboard (full height). */}
      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[15px] font-bold text-slate-900">Sales trend</h2>
              <span className="text-xs text-slate-400">{isAdmin ? 'Company' : isManager ? 'Your team' : 'You'} · 6 months</span>
            </div>
            <TrendChart trend={data.trend} />
          </div>
          {/* Deals needing a nudge — EVERY open deal, newest-unchanged last, with
              how long it's sat unchanged (deal edit or lead activity). */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h2 className="text-[15px] font-bold text-slate-900">🎯 Deals needing a nudge</h2>
                <div className="text-xs text-slate-400 mt-0.5">Open deals · how long each has been unchanged</div>
              </div>
              {nudges.length > 0 && <span className="shrink-0 text-[11px] font-bold rounded-full px-2.5 py-0.5 bg-orange-50 text-orange-700 ring-1 ring-orange-200">{nudges.length} open</span>}
            </div>
            {nudges.length === 0 ? (
              <div className="text-slate-300 text-sm py-6 text-center">No open deals right now. 🎉</div>
            ) : (
              <div className="space-y-1.5 max-h-72 overflow-y-auto overflow-x-hidden nice-scroll">
                {nudges.map((d) => {
                  // Colour the age chip by how stale: >14d red, >7d amber, else slate.
                  const days = d.unchangedDays;
                  const chip = days == null ? { bg: '#f1f5f9', fg: '#64748b', txt: '—' }
                    : days > 14 ? { bg: '#fef2f2', fg: '#b91c1c', txt: `${days}d` }
                    : days > 7 ? { bg: '#fffbeb', fg: '#b45309', txt: `${days}d` }
                    : { bg: '#f1f5f9', fg: '#475569', txt: `${days}d` };
                  return (
                    <div key={`${d.leadId}_${d.dealName}`} onClick={() => onViewToday && onViewToday(d.leadId)}
                      className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50 cursor-pointer">
                      <div className="w-8 h-8 rounded-[10px] flex items-center justify-center font-bold text-[12px] shrink-0 bg-slate-100 text-slate-600">{initials(d.client)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-bold text-slate-900 truncate">{d.client}{d.amountUsd > 0 ? ` · ${usd(d.amountUsd)}` : ''}</div>
                        <div className="text-[11px] text-slate-400 truncate">
                          {d.dealName ? `${d.dealName} · ` : ''}{d.stageLabel || d.stage}{(isAdmin || isManager) && d.ownerName ? ` · ${d.ownerName}` : ''}
                        </div>
                      </div>
                      <span className="shrink-0 text-[11px] font-extrabold rounded-md px-2 py-1 whitespace-nowrap" style={{ background: chip.bg, color: chip.fg }} title="Unchanged for">
                        {chip.txt === '—' ? '—' : `${chip.txt} idle`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[15px] font-bold text-slate-900">Sales leaderboard</h2>
            <button onClick={() => setShowRace(true)} title="Open the full-screen sales race"
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-white shadow-sm active:scale-95 transition" style={{ background: 'linear-gradient(to right,#f97316,#f59e0b)' }}>🏁 Race view</button>
          </div>
          {board.length === 0 ? <div className="text-slate-300 text-sm py-8 text-center">No agents yet.</div> : <Leaderboard board={board} user={user} maxSales={maxSales} />}
        </div>
      </div>

      {/* LEAD GENERATION — Leads this month (stacked bars) + Lead trend (stacked
          bars), split by pre-sales / cold-calling / transferred. */}
      <SectionLabel right={<span className="text-[11px] text-slate-400">by source</span>}>Lead generation</SectionLabel>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[15px] font-bold text-slate-900">Leads this month</h2>
            <span className="text-xs text-slate-400">Daily · by source</span>
          </div>
          <LeadDailyChart daily={data.leadDaily} />
        </div>
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[15px] font-bold text-slate-900">Lead trend</h2>
            <span className="text-xs text-slate-400">Last 6 months · by source</span>
          </div>
          <LeadMonthlyChart monthly={data.leadMonthly} />
        </div>
      </div>

      {/* PRE-SALES TEAM — admin only, new data + final2 table layout. */}
      {isAdmin && data.presalesTeam && data.presalesTeam.members.length > 0 && (
        <>
          <SectionLabel right={<span className="text-[11px] text-slate-400">admin only</span>}>Pre-sales team</SectionLabel>
          <PresalesTeamBlocks pt={data.presalesTeam} />
        </>
      )}

      {/* Awaiting-collection followup list (managers & admins) */}
      {showAwaiting && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowAwaiting(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-2xl max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Payments awaiting collection</h3>
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
    <div className="relative overflow-hidden bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
      <div className="absolute top-0 right-0 w-24 h-24 rounded-bl-full pointer-events-none" style={{ background: (accent || '#64748b') + '0d' }}></div>
      <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: accent || '#64748b' }}>{label}</div>
      <div className="text-3xl font-extrabold tracking-tight mt-2" style={{ color: accent || '#0f172a' }}>{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-2">{sub}</div>}
    </div>
  );

  return (
    <div className="space-y-6" style={{ fontFamily: DB_FONT }}>
      <DashboardGmailNotice />
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">Welcome, {user.name.split(' ')[0]}</h1>
        <div className="text-sm text-slate-500 mt-1">Lead intake and pre-sales team performance.</div>
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
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
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
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
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
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
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
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
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
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
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
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
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
  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
      <div className="p-5 pb-3">
        <div className="text-[15px] font-bold text-slate-900">Member breakdown <span className="text-[11px] font-semibold text-slate-400">· ranked by leads this month</span></div>
        <div className="text-[11px] text-slate-400 mt-0.5">Quality = leads this month not Not-interested / Cold / Released. Converted = became clients.</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr style={{ background: '#0b1020' }}>
              <th className="text-left text-[10px] font-bold uppercase tracking-wide text-slate-300 px-3 py-2.5">Rank &amp; member</th>
              <th className="text-right text-[10px] font-bold uppercase tracking-wide text-slate-300 px-3 py-2.5">Today</th>
              <th className="text-right text-[10px] font-bold uppercase tracking-wide text-slate-300 px-3 py-2.5">Month</th>
              <th className="text-right text-[10px] font-bold uppercase tracking-wide text-slate-300 px-3 py-2.5">Quality</th>
              <th className="text-right text-[10px] font-bold uppercase tracking-wide text-slate-300 px-3 py-2.5">Converted</th>
              <th className="text-right text-[10px] font-bold uppercase tracking-wide text-slate-300 px-3 py-2.5">Transferred</th>
              <th className="text-right text-[10px] font-bold uppercase tracking-wide text-slate-300 px-3 py-2.5">Target</th>
              <th className="text-right text-[10px] font-bold uppercase tracking-wide text-slate-300 px-3 py-2.5">% achieved</th>
              <th className="text-right text-[10px] font-bold uppercase tracking-wide text-slate-300 px-3 py-2.5">Share</th>
            </tr>
          </thead>
          <tbody>
            {members.map((t, i) => {
              const share = pt.teamMonth > 0 ? Math.round((t.month / pt.teamMonth) * 100) : 0;
              const pct = t.monthlyTarget > 0 ? Math.round((t.month / t.monthlyTarget) * 100) : null;
              const leading = i === 0 && t.month > 0;
              const medalIcon = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
              return (
                <tr key={t.name} className="border-t border-slate-100" style={leading ? { background: 'linear-gradient(90deg,#fff7ed,#fff)' } : {}}>
                  <td className="px-3 py-2.5 text-left">
                    <span className={`font-bold ${leading ? 'text-orange-700' : 'text-slate-600'}`}>{medalIcon} {t.name}</span>
                    {leading && <span className="ml-1.5 text-[9px] font-extrabold text-orange-700 bg-orange-100 rounded px-1.5 py-0.5">LEADING</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-500">{t.today}</td>
                  <td className="px-3 py-2.5 text-right font-extrabold text-slate-900">{t.month}</td>
                  <td className="px-3 py-2.5 text-right font-bold text-sky-600">{t.qualityMonth || 0}</td>
                  <td className="px-3 py-2.5 text-right font-bold text-green-600">{t.convertedMonth || 0}</td>
                  <td className="px-3 py-2.5 text-right font-bold text-violet-600">{t.transferredMonth || 0}</td>
                  <td className="px-3 py-2.5 text-right text-slate-500">{t.monthlyTarget > 0 ? t.monthlyTarget : <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-2.5 text-right">
                    {pct != null
                      ? <span className={`font-bold ${pct >= 100 ? 'text-green-600' : pct >= 50 ? 'text-amber-600' : 'text-slate-500'}`}>{pct}%</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-11 h-[7px] rounded-full bg-slate-100 overflow-hidden inline-block">
                        <span className="h-full block rounded-full" style={{ width: `${share}%`, background: leading ? '#FF6A00' : '#94A3B8' }} />
                      </span>
                      <span className="text-slate-500 w-8 text-right">{share}%</span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 font-extrabold" style={{ background: '#f8fafc' }}>
              <td className="px-3 py-2.5 text-left text-slate-600">Team total</td>
              <td className="px-3 py-2.5 text-right text-slate-500">{pt.teamToday || 0}</td>
              <td className="px-3 py-2.5 text-right text-slate-900">{pt.teamMonth || 0}</td>
              <td className="px-3 py-2.5 text-right text-sky-600">{pt.teamQualityMonth || 0}</td>
              <td className="px-3 py-2.5 text-right text-green-600">{pt.teamConvertedMonth || 0}</td>
              <td className="px-3 py-2.5 text-right text-violet-600">{pt.teamTransferredMonth || 0}</td>
              <td className="px-3 py-2.5 text-right text-slate-500">{pt.teamMonthlyTarget > 0 ? pt.teamMonthlyTarget : <span className="text-slate-300">—</span>}</td>
              <td className="px-3 py-2.5 text-right text-slate-500">{pt.teamMonthlyTarget > 0 ? `${Math.round((pt.teamMonth / pt.teamMonthlyTarget) * 100)}%` : '—'}</td>
              <td className="px-3 py-2.5"></td>
            </tr>
          </tfoot>
        </table>
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
          <div className="text-[15px] font-bold text-slate-900">All drafts received</div>
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
      <div onClick={() => {
          // Play a celebration for every sale in the last 48h, one after
          // another (newest first). Falls back to just the latest if the full
          // list isn't available.
          const all = (others && others.length ? others : [latest])
            .map((w) => ({ id: w.id, ownerName: w.ownerName, avatar: w.avatar, amountUsd: w.amountUsd }));
          showCelebration(all);
        }}
        title={(others && others.length > 1) ? `Click to celebrate all ${others.length} recent sales 🎉` : 'Click to celebrate 🎉'}
        className="px-5 py-4 flex items-center gap-4 cursor-pointer hover:brightness-[0.98] transition" style={{ background: 'linear-gradient(90deg,#FFF7ED,#FFEDD5)' }}>
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
    catch (e) { toast(e.message); }
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
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4">
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

      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
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
                            {Array.isArray(r.attachments) && r.attachments.length > 0 && (
                              <div className="mt-3">
                                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Attachments from the agent</div>
                                <div className="space-y-1">
                                  {r.attachments.map((a, i) => (
                                    <a key={i} href={a.url} target="_blank" rel="noreferrer" download
                                      className="flex items-center gap-2 rounded-lg bg-white border border-slate-200 px-2.5 py-1.5 text-xs text-blue-600 hover:bg-blue-50 max-w-md">
                                      <span>📎</span>
                                      <span className="truncate flex-1">{a.name}</span>
                                      <span className="text-slate-400 font-bold">Download</span>
                                    </a>
                                  ))}
                                </div>
                              </div>
                            )}
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
        <div className="text-[15px] font-bold text-slate-900 mb-3">{row.name || '(no name)'}</div>
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
            <div className="text-[15px] font-bold text-slate-900">⚠️ Missed commitments</div>
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

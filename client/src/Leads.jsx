import React, { useState, useEffect, useRef } from 'react';
import { api } from './App.jsx';
import { API_BASE } from './config.js';
import { COUNTRY_NAMES, COUNTRY_TIMEZONES, formatPhone, dialFor } from './countries.js';
import { nowInZone, callWindow, toIST, tzShortLabel, dueLabel, daysLeftLabel, daysUntil, IST_LABEL } from './timezone.js';


/**
 * Inline SVG line icons. Defined as plain components (rather than built by a
 * factory) so they're trivially debuggable and evaluate lazily at render time.
 * They inherit text colour, so the same icon works on light and dark buttons.
 */
// Return the signature/quoted-chain "tail" of a reply body so an AI re-draft
// replaces only the new-message portion above it (keeps context + signature).
function extractQuotedTail(html) {
  if (!html) return '';
  const markers = [
    html.indexOf('<div style="border-left:2px solid'),
    html.indexOf('---------- Forwarded message'),
    html.search(/<table[^>]*(?:signature|Segoe UI)/i),
  ].filter((i) => i >= 0);
  if (markers.length === 0) return '';
  const at = Math.min(...markers);
  const pre = html.slice(Math.max(0, at - 12), at);
  const spacer = pre.match(/(<br\s*\/?>\s*)+$/i);
  return html.slice(spacer ? at - spacer[0].length : at);
}

function IconBase({ size = 15, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

export const Icon = {
  Note: (p) => <IconBase {...p}><path d="M4 4.5A1.5 1.5 0 0 1 5.5 3h9L20 8.5v11A1.5 1.5 0 0 1 18.5 21h-13A1.5 1.5 0 0 1 4 19.5z" /><path d="M14 3v6h6" /><path d="M8 13h8M8 17h5" /></IconBase>,
  Check: (p) => <IconBase {...p}><rect x="3.5" y="3.5" width="17" height="17" rx="3.5" /><path d="M8.5 12l2.5 2.5 4.5-5" /></IconBase>,
  Phone: (p) => <IconBase {...p}><path d="M6.5 3.5h3l1.5 4-2 1.5a12 12 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5z" /></IconBase>,
  Money: (p) => <IconBase {...p}><circle cx="12" cy="12" r="8.5" /><path d="M14.5 9.5A2.5 2.5 0 0 0 12 8c-1.4 0-2.5.8-2.5 2s1.1 1.8 2.5 2 2.5.6 2.5 2-1.1 2-2.5 2a2.5 2.5 0 0 1-2.5-1.5" /><path d="M12 6.5v11" /></IconBase>,
  Pencil: (p) => <IconBase {...p}><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" /><path d="M15 6l3 3" /></IconBase>,
  Trash: (p) => <IconBase {...p}><path d="M4 7h16" /><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" /><path d="M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7" /><path d="M10 11v6M14 11v6" /></IconBase>,
  Upload: (p) => <IconBase {...p}><path d="M12 16V4" /><path d="m7.5 8.5 4.5-4.5 4.5 4.5" /><path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" /></IconBase>,
  Search: (p) => <IconBase {...p}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></IconBase>,
  Plus: (p) => <IconBase {...p}><path d="M12 5v14M5 12h14" /></IconBase>,
  Minus: (p) => <IconBase {...p}><path d="M5 12h14" /></IconBase>,
  Sparkle: (p) => <IconBase {...p}><path d="M12 3.5 13.8 9 19.5 10.8 13.8 12.6 12 18 10.2 12.6 4.5 10.8 10.2 9z" /><path d="M18.5 15.5l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7z" /></IconBase>,
  Eye: (p) => <IconBase {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></IconBase>,
  Download: (p) => <IconBase {...p}><path d="M12 4v12" /><path d="m7.5 11.5 4.5 4.5 4.5-4.5" /><path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17" /></IconBase>,
  Refresh: (p) => <IconBase {...p}><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 4v4h-4" /></IconBase>,
  Clock: (p) => <IconBase {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 1.8" /></IconBase>,
  Mail: (p) => <IconBase {...p}><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m3.5 7 8.5 6 8.5-6" /></IconBase>,
  Globe: (p) => <IconBase {...p}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.4 2.5 14.6 0 17M12 3.5c-2.5 2.4-2.5 14.6 0 17" /></IconBase>,
  Pin: (p) => <IconBase {...p}><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></IconBase>,
  Calendar: (p) => <IconBase {...p}><rect x="3.5" y="5" width="17" height="16" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></IconBase>,
};

/** Compact icon+label button used across the lead detail header. */
export function ActionBtn({ onClick, label, icon, tone = 'default' }) {
  const base = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition';
  const tones = {
    default: 'border border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50',
    danger: 'border border-red-200 text-red-500 hover:bg-red-50',
  };
  return (
    <button onClick={onClick} className={`${base} ${tones[tone]}`}>
      {icon}{label}
    </button>
  );
}

// Live clock showing the lead's local time, so agents don't dial at 3am.
function LeadLocalClock({ timezone }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000); // refresh every 30s
    return () => clearInterval(t);
  }, []);
  const z = nowInZone(timezone);
  if (!z) return null;
  const w = callWindow(z.hour);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${w.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}
      title={`${w.label} · ${timezone}`}>
      <Icon.Clock size={13} /> {z.time} {tzShortLabel(timezone)}
      <span className="font-normal opacity-70">{w.ok ? '· ok to call' : '· do not call'}</span>
    </span>
  );
}

// Multi-select with type-to-filter (same UX as country, but multiple values).
export function MultiSelectCombobox({ options, values, onChange, placeholder, className }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const sel = values || [];
  const matches = (q ? options.filter((o) => o.toLowerCase().includes(q.toLowerCase())) : options);
  const toggle = (o) => onChange(sel.includes(o) ? sel.filter((x) => x !== o) : [...sel, o]);
  return (
    <div className="relative">
      <div className={`${className} min-h-[38px] flex flex-wrap gap-1 items-center cursor-text`} onClick={() => setOpen(true)}>
        {sel.map((s) => (
          <span key={s} className="inline-flex items-center gap-1 rounded-full bg-[#2563EB] text-white px-2 py-0.5 text-[11px] font-bold">
            {s}<button type="button" onClick={(e) => { e.stopPropagation(); toggle(s); }} className="hover:text-slate-200">✕</button>
          </span>
        ))}
        <input className="flex-1 min-w-[80px] outline-none text-sm bg-transparent" value={q} placeholder={sel.length ? '' : (placeholder || 'Type to search…')}
          onFocus={() => setOpen(true)} onChange={(e) => setQ(e.target.value)}
          onBlur={() => setTimeout(() => setOpen(false), 150)} />
      </div>
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-56 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {matches.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">No match</div>}
          {matches.map((o) => (
            <button key={o} type="button" onMouseDown={(e) => { e.preventDefault(); toggle(o); }}
              className={`flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 ${sel.includes(o) ? 'font-bold text-[#2563EB]' : 'text-slate-700'}`}>
              <span className={`h-3.5 w-3.5 rounded border flex items-center justify-center text-[9px] ${sel.includes(o) ? 'bg-[#2563EB] border-[#2563EB] text-white' : 'border-slate-300'}`}>{sel.includes(o) ? '✓' : ''}</span>
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Timezone field that adapts to the selected country: single-zone countries
// show a read-only auto-filled value; multi-zone countries show a dropdown;
// unknown countries fall back to free text.
export function TimezoneField({ country, value, onChange, className }) {
  const zones = COUNTRY_TIMEZONES[country] || null;
  if (zones && zones.length === 1) {
    return <input className={className} value={value || zones[0]} readOnly />;
  }
  if (zones && zones.length > 1) {
    return (
      <select className={className} value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">— Select zone —</option>
        {zones.map((z) => <option key={z} value={z}>{z}</option>)}
      </select>
    );
  }
  return <input className={className} value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder="e.g. GMT+5:30" />;
}


// Phone input whose country code + digit grouping follow the selected country.
// The dial code prefix is shown as a fixed chip; the user types only the local
// number and it's formatted live. Stores the full "+<code> <number>" string.
export function PhoneField({ value, country, onChange, className, placeholder }) {
  const dial = dialFor(country);
  // Strip the code+plus for the editable portion.
  const local = String(value || '').replace(/^\+\d+\s*/, '');
  const reformat = (raw) => onChange(formatPhone(raw, country));
  return (
    <div className="flex">
      <span className="inline-flex items-center rounded-l-lg border border-r-0 border-slate-300 bg-slate-50 px-2.5 text-sm font-bold text-slate-500 whitespace-nowrap">+{dial}</span>
      <input
        className={`${className} rounded-l-none`}
        value={local}
        placeholder={placeholder || 'number'}
        onChange={(e) => reformat(e.target.value)}
        onBlur={(e) => reformat(e.target.value)}
      />
    </div>
  );
}

export function CountryCombobox({ value, onChange, className }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [rect, setRect] = useState(null);
  const inputRef = React.useRef(null);
  const matches = (q ? COUNTRY_NAMES.filter((c) => c.toLowerCase().includes(q.toLowerCase())) : COUNTRY_NAMES).slice(0, 80);

  const openList = () => {
    if (inputRef.current) setRect(inputRef.current.getBoundingClientRect());
    setOpen(true); setQ('');
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        className={className}
        value={open ? q : (value || '')}
        placeholder="Type to search countries…"
        onFocus={openList}
        onChange={(e) => setQ(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {/* Fixed positioning so the list is never clipped by a scrolling modal. */}
      {open && rect && (
        <div className="fixed z-[60] max-h-56 overflow-auto rounded-lg border border-slate-200 bg-white shadow-xl"
          style={{ top: rect.bottom + 4, left: rect.left, width: rect.width }}>
          {matches.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">No match</div>}
          {matches.map((c) => (
            <button key={c} type="button" onMouseDown={() => { onChange(c); setOpen(false); }}
              className={`block w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 ${value === c ? 'font-bold text-[#FF4500]' : 'text-slate-700'}`}>{c}</button>
          ))}
        </div>
      )}
    </div>
  );
}


/**
 * Website input that stores only the naked domain. A fixed "https://" prefix is
 * shown to the left; whatever the user types or pastes (with protocol, www,
 * path, trailing slash) is stripped to the bare domain. When the field loses
 * focus it checks the server for an existing lead on that domain and reports a
 * duplicate immediately, before the form is even submitted.
 */
function stripToDomain(input) {
  if (!input) return '';
  let s = String(input).trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, '');      // protocol
  s = s.split(/[/?#]/)[0];                 // path/query/hash
  s = s.replace(/^[^@]*@/, '').replace(/:\d+$/, '').replace(/^www\./, ''); // auth/port/www
  return s.trim();
}

export function WebsiteField({ value, onChange, onDuplicate, className }) {
  const [checking, setChecking] = useState(false);
  const check = async (dom) => {
    if (!dom) { onDuplicate && onDuplicate(null); return; }
    setChecking(true);
    try {
      const r = await api(`/leads/check-domain?website=${encodeURIComponent(dom)}`);
      onDuplicate && onDuplicate(r.duplicate || null);
    } catch { /* ignore check failures — the create call still guards */ }
    setChecking(false);
  };
  return (
    <div className="flex items-stretch rounded-lg border border-slate-300 focus-within:ring-2 focus-within:ring-orange-400 overflow-hidden">
      <span className="flex items-center px-2.5 text-xs font-bold text-slate-400 bg-slate-50 border-r border-slate-200 select-none">https://</span>
      <input
        className={`flex-1 px-3 py-2 text-sm focus:outline-none ${className || ''}`}
        value={value || ''}
        placeholder="qtonix.com"
        onChange={(e) => { onChange(stripToDomain(e.target.value)); onDuplicate && onDuplicate(null); }}
        onPaste={(e) => { e.preventDefault(); onChange(stripToDomain((e.clipboardData || window.clipboardData).getData('text'))); onDuplicate && onDuplicate(null); }}
        onBlur={(e) => check(stripToDomain(e.target.value))}
      />
      {checking && <span className="flex items-center px-2 text-[10px] text-slate-400">checking…</span>}
    </div>
  );
}


/**
 * Generic filterable combobox over a list of string options — same behaviour as
 * CountryCombobox (type to filter, fixed-position dropdown that isn't clipped by
 * a scrolling modal) but for any list, e.g. the pre-sales email addresses.
 */
export function FilterCombobox({ value, onChange, options, placeholder, className }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [rect, setRect] = useState(null);
  const inputRef = React.useRef(null);
  const list = Array.isArray(options) ? options : [];
  const matches = (q ? list.filter((c) => c.toLowerCase().includes(q.toLowerCase())) : list).slice(0, 80);

  const openList = () => {
    if (inputRef.current) setRect(inputRef.current.getBoundingClientRect());
    setOpen(true); setQ('');
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        className={className}
        value={open ? q : (value || '')}
        placeholder={placeholder || 'Type to search…'}
        onFocus={openList}
        onChange={(e) => setQ(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && rect && (
        <div className="fixed z-[60] max-h-56 overflow-auto rounded-lg border border-slate-200 bg-white shadow-xl"
          style={{ top: rect.bottom + 4, left: rect.left, width: rect.width }}>
          {matches.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">No match</div>}
          {matches.map((c) => (
            <button key={c} type="button" onMouseDown={() => { onChange(c); setOpen(false); }}
              className={`block w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 ${value === c ? 'font-bold text-[#FF4500]' : 'text-slate-700'}`}>{c}</button>
          ))}
        </div>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Leads CRM — Phase 1: list (role-filtered by the API), single-lead create
// form, and the lead detail page shell (30/70 split with Basic Info, Tags,
// Description, Other Info, Last Modified on the left). Tabs on the right are
// scaffolded here and filled in Phase 2/3.
// ---------------------------------------------------------------------------

const fmtDate = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

// Relative countdown for a scheduled call-back, e.g. "2 days left", "tomorrow",
// "in 3h", "overdue". Kept human and short for the list.
function callbackCountdown(at) {
  if (!at) return '';
  const ms = new Date(at).getTime() - Date.now();
  const mins = Math.round(ms / 60000);
  if (mins < 0) {
    const past = Math.abs(mins);
    if (past < 60) return 'overdue';
    if (past < 1440) return 'overdue';
    return `${Math.round(past / 1440)}d overdue`;
  }
  if (mins < 60) return `in ${mins}m`;
  if (mins < 1440) return `in ${Math.round(mins / 60)}h`;
  const days = Math.round(mins / 1440);
  if (days === 1) return 'tomorrow';
  return `${days} days left`;
}
function callbackTone(at) {
  if (!at) return 'text-slate-400';
  const ms = new Date(at).getTime() - Date.now();
  if (ms < 0) return 'text-red-500 font-semibold';
  if (ms < 24 * 3600000) return 'text-amber-600 font-semibold';
  return 'text-slate-600';
}
// Display names in Title Case ("aa"/"AA" -> "Aa") without mutating stored data.
// Splits on spaces and hyphens so "mary-jane o'neil" -> "Mary-Jane O'neil".
export function titleCase(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/([^\s-]+)/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}
const fullName = (l) => {
  const n = `${titleCase(l.firstName)} ${titleCase(l.lastName)}`.trim();
  return n || '(no name)';
};

// Days since a lead was last touched, and a staleness bucket for badges.
function staleness(l) {
  const t = l.lastActivityAt || l.updatedAt;
  if (!t) return null;
  const days = Math.floor((Date.now() - new Date(t).getTime()) / (24 * 60 * 60 * 1000));
  if (days >= 7) return { days, level: 'red', label: `${days}d untouched` };
  if (days >= 3) return { days, level: 'amber', label: `${days}d untouched` };
  return null;
}

function statusMeta(config, id) {
  const s = (config.leadStatuses || []).find((x) => x.id === id);
  return s || { id, label: id, color: '#64748B' };
}

// ---- Lead list -------------------------------------------------------------
// Shared pager: page buttons plus a per-page selector (10/20/50/100).
export function Pagination({ page, pages, total, perPage, onPage, onPerPage, label = 'items' }) {
  if (!total) return null;
  const from = (page - 1) * perPage + 1;
  const to = Math.min(total, page * perPage);
  // Show a compact window of page numbers around the current page.
  const nums = [];
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  for (let i = start; i <= Math.min(pages, start + 4); i++) nums.push(i);
  return (
    <div className="flex items-center justify-between gap-3 mt-4 flex-wrap">
      <div className="text-xs text-slate-400">Showing {from}–{to} of {total} {label}</div>
      <div className="flex items-center gap-2">
        {pages > 1 && (
          <div className="flex items-center gap-1">
            <button onClick={() => onPage(Math.max(1, page - 1))} disabled={page === 1}
              className="rounded-md border border-slate-200 px-2 py-1 text-xs font-bold text-slate-500 disabled:opacity-40 hover:border-slate-300">‹</button>
            {start > 1 && <span className="text-xs text-slate-300 px-1">…</span>}
            {nums.map((n) => (
              <button key={n} onClick={() => onPage(n)}
                className={`rounded-md px-2.5 py-1 text-xs font-bold ${n === page ? 'bg-[#050A1F] text-white' : 'border border-slate-200 text-slate-500 hover:border-slate-300'}`}>{n}</button>
            ))}
            {start + 4 < pages && <span className="text-xs text-slate-300 px-1">…</span>}
            <button onClick={() => onPage(Math.min(pages, page + 1))} disabled={page === pages}
              className="rounded-md border border-slate-200 px-2 py-1 text-xs font-bold text-slate-500 disabled:opacity-40 hover:border-slate-300">›</button>
          </div>
        )}
        <select value={perPage} onChange={(e) => onPerPage(Number(e.target.value))}
          className="rounded-md border border-slate-200 px-2 py-1 text-xs font-bold text-slate-500">
          {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
        </select>
      </div>
    </div>
  );
}

// Lightweight rich-text editor (contentEditable + execCommand). Avoids pulling
// in a heavy dependency; stores HTML. Toolbar covers the formatting sales notes
// actually need: bold/italic/underline, lists, and clearing formatting.
/**
 * Gmail-style rich text editor for the email composer. A format menu (aA) holds
 * font/size/style/color/alignment/list/quote actions; the row also exposes AI
 * draft (placeholder), attachment, hyperlink and signature actions via props.
 */
export function MailEditor({ value, onChange, placeholder, minHeight = 200, maxHeight, onAttach, onAiDraft, onInsertSignature, extraTools }) {
  const ref = React.useRef(null);
  const [focused, setFocused] = useState(false);
  const [showFormat, setShowFormat] = useState(false);
  const [showColor, setShowColor] = useState(null); // 'fore' | 'back' | null

  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== (value || '')) ref.current.innerHTML = value || '';
  }, [value]);

  const exec = (cmd, arg) => {
    ref.current && ref.current.focus();
    document.execCommand(cmd, false, arg || null);
    if (ref.current) onChange(ref.current.innerHTML);
  };
  const link = () => { const url = prompt('Link URL'); if (url) exec('createLink', url); };
  const isEmpty = !value || value === '<br>' || value === '<div><br></div>';

  const FONTS = ['Sans Serif', 'Serif', 'Fixed Width', 'Plus Jakarta Sans', 'Arial', 'Georgia'];
  const SIZES = [['Small', '2'], ['Normal', '3'], ['Large', '5'], ['Huge', '7']];
  const COLORS = ['#000000', '#434343', '#666666', '#FF4500', '#FF6A00', '#E53935', '#1A73E8', '#43A047', '#8E24AA', '#00897B', '#FDD835', '#FFFFFF'];

  const TBtn = ({ onClick, title, children, active }) => (
    <button type="button" title={title} onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={`w-8 h-8 flex items-center justify-center rounded text-slate-600 hover:bg-slate-200 ${active ? 'bg-slate-200' : ''}`}>{children}</button>
  );

  return (
    <div className={`rounded-lg border ${focused ? 'border-orange-400 ring-2 ring-orange-100' : 'border-slate-300'}`}>
      {/* Editing surface first (Gmail puts the toolbar at the bottom) */}
      <div className="relative">
        {isEmpty && !focused && placeholder && <div className="absolute top-2 left-3 text-sm text-slate-300 pointer-events-none">{placeholder}</div>}
        <div ref={ref} contentEditable suppressContentEditableWarning
          onInput={() => onChange(ref.current.innerHTML)}
          onBlur={() => { setFocused(false); onChange(ref.current.innerHTML); }}
          onFocus={() => setFocused(true)}
          className="px-3 py-2 text-sm outline-none overflow-auto rich-text" style={{ minHeight, ...(maxHeight ? { maxHeight } : {}) }} />
      </div>

      {/* Toolbar */}
      <div className="relative flex items-center gap-0.5 border-t border-slate-200 px-1.5 py-1 bg-slate-50 rounded-b-lg flex-wrap">
        {/* Format menu (aA) */}
        <TBtn title="Formatting options" onClick={() => setShowFormat((v) => !v)} active={showFormat}>
          <span className="text-xs font-bold">A<span className="text-[9px]">a</span></span>
        </TBtn>
        {onAiDraft && <TBtn title="AI draft (coming soon)" onClick={onAiDraft}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15l-1.9-4.1L5.5 9l4.6-1.4z" /><path d="M18 15l.8 2 2 .8-2 .8L18 21l-.8-2-2-.8 2-.8z" /></svg>
        </TBtn>}
        <TBtn title="Attach file" onClick={() => onAttach && onAttach()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 12l-9 9a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8" /></svg>
        </TBtn>
        <TBtn title="Insert link" onClick={link}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></svg>
        </TBtn>
        {onInsertSignature && <TBtn title="Insert signature" onClick={onInsertSignature}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 17c3 0 3-6 6-6s2 4 5 4 4-5 7-5" /><path d="M3 21h18" /></svg>
        </TBtn>}
        {extraTools}

        {/* Format popover */}
        {showFormat && (
          <div className="absolute bottom-10 left-0 bg-white rounded-lg border border-slate-200 shadow-lg p-2 z-50 flex items-center gap-1 flex-wrap w-[420px]">
            <select onMouseDown={(e) => e.stopPropagation()} onChange={(e) => exec('fontName', e.target.value)} className="text-xs border border-slate-200 rounded px-1.5 py-1">
              {FONTS.map((f) => <option key={f} value={f === 'Sans Serif' ? 'sans-serif' : f === 'Serif' ? 'serif' : f === 'Fixed Width' ? 'monospace' : f}>{f}</option>)}
            </select>
            <select onMouseDown={(e) => e.stopPropagation()} onChange={(e) => exec('fontSize', e.target.value)} className="text-xs border border-slate-200 rounded px-1.5 py-1">
              {SIZES.map(([l, v]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <span className="w-px h-5 bg-slate-200 mx-0.5" />
            <TBtn title="Bold" onClick={() => exec('bold')}><b className="text-sm">B</b></TBtn>
            <TBtn title="Italic" onClick={() => exec('italic')}><i className="text-sm">I</i></TBtn>
            <TBtn title="Underline" onClick={() => exec('underline')}><u className="text-sm">U</u></TBtn>
            <TBtn title="Strikethrough" onClick={() => exec('strikeThrough')}><span className="text-sm line-through">S</span></TBtn>
            <span className="w-px h-5 bg-slate-200 mx-0.5" />
            <TBtn title="Text color" onClick={() => setShowColor(showColor === 'fore' ? null : 'fore')}><span className="text-sm font-bold" style={{ borderBottom: '3px solid #FF4500' }}>A</span></TBtn>
            <TBtn title="Highlight color" onClick={() => setShowColor(showColor === 'back' ? null : 'back')}><span className="text-sm font-bold px-0.5" style={{ background: '#FDD835' }}>A</span></TBtn>
            <span className="w-px h-5 bg-slate-200 mx-0.5" />
            <TBtn title="Align left" onClick={() => exec('justifyLeft')}><svg width="15" height="15" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" fill="none"><path d="M4 6h16M4 12h10M4 18h13" /></svg></TBtn>
            <TBtn title="Align center" onClick={() => exec('justifyCenter')}><svg width="15" height="15" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" fill="none"><path d="M4 6h16M7 12h10M6 18h12" /></svg></TBtn>
            <TBtn title="Align right" onClick={() => exec('justifyRight')}><svg width="15" height="15" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" fill="none"><path d="M4 6h16M10 12h10M7 18h13" /></svg></TBtn>
            <span className="w-px h-5 bg-slate-200 mx-0.5" />
            <TBtn title="Bulleted list" onClick={() => exec('insertUnorderedList')}><svg width="15" height="15" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" fill="none"><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /><path d="M8 6h12M8 12h12M8 18h12" /></svg></TBtn>
            <TBtn title="Numbered list" onClick={() => exec('insertOrderedList')}><svg width="15" height="15" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" fill="none"><path d="M9 6h11M9 12h11M9 18h11M4 5v3M4 11h1.5L4 13h1.5M4 17h1.5v3H4" /></svg></TBtn>
            <TBtn title="Quote" onClick={() => exec('formatBlock', 'blockquote')}><svg width="15" height="15" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" fill="none"><path d="M6 17h3l2-4V7H5v6h3zM14 17h3l2-4V7h-6v6h3z" /></svg></TBtn>

            {showColor && (
              <div className="w-full mt-1 pt-1 border-t border-slate-100 flex flex-wrap gap-1">
                {COLORS.map((c) => (
                  <button key={c} onMouseDown={(e) => { e.preventDefault(); exec(showColor === 'fore' ? 'foreColor' : 'hiliteColor', c); setShowColor(null); }}
                    className="w-5 h-5 rounded border border-slate-200" style={{ background: c }} title={c} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function RichText({ value, onChange, placeholder, minHeight = 120 }) {
  const ref = React.useRef(null);
  const [focused, setFocused] = useState(false);

  // Only write into the DOM when the incoming value genuinely differs, so we
  // don't clobber the caret position while the user is typing.
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== (value || '')) {
      ref.current.innerHTML = value || '';
    }
  }, [value]);

  const exec = (cmd, arg) => {
    document.execCommand(cmd, false, arg || null);
    if (ref.current) onChange(ref.current.innerHTML);
    if (ref.current) ref.current.focus();
  };
  const Btn = ({ cmd, arg, children, title }) => (
    <button type="button" title={title} onMouseDown={(e) => { e.preventDefault(); exec(cmd, arg); }}
      className="w-7 h-7 rounded text-xs font-bold text-slate-600 hover:bg-slate-200">{children}</button>
  );
  const isEmpty = !value || value === '<br>' || value === '<div><br></div>';

  return (
    <div className={`rounded-lg border ${focused ? 'border-orange-400 ring-2 ring-orange-100' : 'border-slate-300'}`}>
      <div className="flex items-center gap-0.5 border-b border-slate-200 px-1.5 py-1 bg-slate-50 rounded-t-lg">
        <Btn cmd="bold" title="Bold"><b>B</b></Btn>
        <Btn cmd="italic" title="Italic"><i>I</i></Btn>
        <Btn cmd="underline" title="Underline"><u>U</u></Btn>
        <span className="w-px h-4 bg-slate-200 mx-1" />
        <Btn cmd="insertUnorderedList" title="Bullet list">• —</Btn>
        <Btn cmd="insertOrderedList" title="Numbered list">1.</Btn>
        <span className="w-px h-4 bg-slate-200 mx-1" />
        <Btn cmd="removeFormat" title="Clear formatting">✕</Btn>
      </div>
      <div className="relative">
        {isEmpty && !focused && placeholder && (
          <div className="absolute top-2 left-3 text-sm text-slate-300 pointer-events-none">{placeholder}</div>
        )}
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          onInput={() => onChange(ref.current.innerHTML)}
          onBlur={() => { setFocused(false); onChange(ref.current.innerHTML); }}
          onFocus={() => setFocused(true)}
          className="px-3 py-2 text-sm outline-none overflow-auto rich-text"
          style={{ minHeight }}
        />
      </div>
    </div>
  );
}

/**
 * First-reply state for a pre-sales lead: '' (not applicable or done),
 * 'pending' (inside the 24-hour window) or 'overdue' (past it).
 */
function draftState(l) {
  if (!/pre-?sales/i.test(String(l.leadSource || ''))) return '';
  if (l.firstReplyDoneAt) return '';
  // Back-dated leads are historical imports and are exempt from the 24-hour
  // first-reply rule, so they never show a "Draft due"/overdue badge.
  if (l.backDated) return '';
  const from = l.assignedAt || l.createdAt;
  if (!from) return '';
  const hours = (Date.now() - new Date(from).getTime()) / 3600000;
  return hours >= 24 ? 'overdue' : 'pending';
}

export function LeadsList({ user, onOpen, onNew, untouchedFilter, onClearUntouched, stage }) {
  const isProspect = stage === 'prospect';
  const [items, setItems] = useState([]);
  const [countryList, setCountryList] = useState([]);
  // Sort mode for the Call Backs list: by the scheduled callback time (default)
  // or by the date the callback was added.
  const [callbackSort, setCallbackSort] = useState('callbackTime');
  const [config, setConfig] = useState({ leadStatuses: [], leadSources: [] });
  const [owners, setOwners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  const [dateRange, setDateRange] = useState('all');
  const [dateField, setDateField] = useState('created');
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [transferFor, setTransferFor] = useState(null); // lead awaiting transfer

  // Streams the CSV from the server rather than building it here, so the row
  // scoping (a lead manager only gets what they entered) can't be sidestepped.
  const exportCsv = async () => {
    setExporting(true);
    try {
      const token = localStorage.getItem('qtx_token');
      const res = await fetch(`${API_BASE}/api/leads/export`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Export failed.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { alert(e.message); }
    setExporting(false);
  };
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [pageInfo, setPageInfo] = useState({ total: 0, pages: 1 });

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (statusFilter) params.set('status', statusFilter);
      if (ownerFilter) params.set('ownerId', ownerFilter);
      if (countryFilter) params.set('country', countryFilter);
      if (dateRange && dateRange !== 'all') { params.set('dateRange', dateRange); params.set('dateField', dateField); }
      if (untouchedFilter) params.set('untouched', String(untouchedFilter));
      // Prospects list asks for the callback stage; the main list asks for
      // everything past it. The server excludes callbacks from the plain list
      // regardless, but being explicit keeps the two views clean.
      params.set('stage', isProspect ? 'prospect' : 'lead');
      params.set('page', String(page));
      params.set('perPage', String(perPage));
      const [res, cfg] = await Promise.all([
        api(`/leads${params.toString() ? '?' + params.toString() : ''}`),
        api('/leads/config'),
      ]);
      setItems(res.items || []);
      setPageInfo({ total: res.total || 0, pages: res.pages || 1 });
      if (Array.isArray(res.countries)) setCountryList(res.countries);
      setConfig(cfg.config || {});
      setOwners(cfg.owners || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [untouchedFilter, page, perPage, dateRange, dateField]);
  // Any filter change should send the user back to the first page.
  useEffect(() => { setPage(1); /* eslint-disable-next-line */ }, [statusFilter, ownerFilter, countryFilter, untouchedFilter, dateRange, dateField]);

  // Call Backs are ordered by the scheduled callback time by default, or by the
  // date the callback was added when the user flips the toggle. Other lists keep
  // the server order.
  const displayItems = React.useMemo(() => {
    if (!isProspect) return items;
    const arr = [...items];
    if (callbackSort === 'addedDate') {
      arr.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } else {
      // By callback time: soonest upcoming first; nulls (no time set) last.
      arr.sort((a, b) => {
        const ta = a.callbackAt ? new Date(a.callbackAt).getTime() : Infinity;
        const tb = b.callbackAt ? new Date(b.callbackAt).getTime() : Infinity;
        return ta - tb;
      });
    }
    return arr;
  }, [items, isProspect, callbackSort]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold text-[#050A1F]">{isProspect ? 'Call Backs' : 'Leads'}</h1>
          {isProspect && (
            <div className="text-sm text-slate-400 mt-0.5">
              Call-backs scheduled during cold calling. Transfer one to an agent or manager to promote it to a lead.
            </div>
          )}
          {untouchedFilter && (
            <div className="mt-1 inline-flex items-center gap-2 rounded-full bg-red-50 text-red-600 px-3 py-1 text-xs font-bold">
              Showing leads untouched for {untouchedFilter}+ days
              <button onClick={onClearUntouched} className="hover:text-red-800">✕ clear</button>
            </div>
          )}
          <div className="text-sm text-slate-400">{items.length} total{user.role !== 'admin' ? ' · your visibility' : ''}</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Compact date filter: range dropdown + a small Created/Activity
              toggle. flex-wrap keeps the bar from breaking on narrow screens. */}
          <div className="inline-flex items-center rounded-lg border border-slate-300 overflow-hidden">
            <select value={dateRange} onChange={(e) => setDateRange(e.target.value)} className="px-2.5 py-2 text-sm border-0 focus:outline-none bg-white">
              <option value="all">Any date</option>
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="7d">Last 7 days</option>
              <option value="month">This month</option>
              <option value="lastmonth">Last month</option>
            </select>
            {dateRange !== 'all' && (
              <div className="inline-flex items-center bg-slate-100 text-[10px] font-bold border-l border-slate-200">
                <button onClick={() => setDateField('created')} className={`px-2 py-2 ${dateField === 'created' ? 'bg-white text-[#050A1F]' : 'text-slate-400'}`} title="Filter by created date">Created</button>
                <button onClick={() => setDateField('activity')} className={`px-2 py-2 ${dateField === 'activity' ? 'bg-white text-[#050A1F]' : 'text-slate-400'}`} title="Filter by last activity">Activity</button>
              </div>
            )}
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()}
            placeholder="Search name, email, website…"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm w-60 focus:outline-none focus:ring-2 focus:ring-orange-400" />
          {/* Call-back sort toggle: scheduled time vs added date. */}
          {isProspect && (
            <div className="inline-flex items-center rounded-lg bg-slate-100 p-0.5 text-xs font-bold">
              <button onClick={() => setCallbackSort('callbackTime')}
                className={`px-2.5 py-1.5 rounded-md ${callbackSort === 'callbackTime' ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>By callback time</button>
              <button onClick={() => setCallbackSort('addedDate')}
                className={`px-2.5 py-1.5 rounded-md ${callbackSort === 'addedDate' ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>By added date</button>
            </div>
          )}
          {/* Call-backs are all one status, so a status filter is pointless. */}
          {!isProspect && (
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); }}
              className="rounded-lg border border-slate-300 px-2.5 py-2 text-sm">
              <option value="">All statuses</option>
              {(config.leadStatuses || [])
                // Converted has its own dedicated page — never a filter here, for
                // anyone. Callback is its own tab too.
                .filter((s) => s.id !== 'converted' && s.id !== 'callback')
                .map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          )}
          {/* Agents only ever see their own leads, so an owner filter would
              offer a single pointless choice. */}
          {user.role !== 'agent' && (
            <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}
              className="rounded-lg border border-slate-300 px-2.5 py-2 text-sm">
              <option value="">All owners</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          <div className="w-[170px] flex items-center gap-1">
            <FilterCombobox
              value={countryFilter}
              onChange={(v) => setCountryFilter(v)}
              options={countryList}
              placeholder="All countries"
              className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
            {countryFilter && (
              <button onClick={() => setCountryFilter('')} title="Clear country"
                className="text-slate-400 hover:text-red-500 px-1 text-sm">✕</button>
            )}
          </div>
          <button onClick={load} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-600">Filter</button>
          {/* Getting leads in and out of the system belongs to admins and lead
              managers. Sellers work the leads they're given. On the Call Backs
              list, only admins get import/export. */}
          {((isProspect && user.role === 'admin') || (!isProspect && (user.role === 'admin' || user.role === 'leadmanager'))) && (
            <>
              <button onClick={() => setImporting(true)} title="Import leads from CSV"
                className="rounded-lg border border-slate-200 w-9 h-9 flex items-center justify-center text-slate-500 hover:border-slate-300 hover:bg-slate-50"><Icon.Upload size={16} /></button>
              <button onClick={exportCsv} disabled={exporting}
                title={user.role === 'leadmanager' ? 'Download the leads you entered' : 'Download leads as CSV'}
                className="rounded-lg border border-slate-200 w-9 h-9 flex items-center justify-center text-slate-500 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"><Icon.Download size={16} /></button>
            </>
          )}
          <button onClick={onNew} className="rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>+ {isProspect ? 'New call back' : 'New lead'}</button>
        </div>
      </div>

      {loading ? (
        <div className="text-slate-400 text-sm py-12 text-center">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-slate-400 text-sm py-16 text-center bg-white rounded-2xl border border-slate-100">
          <div className="text-4xl mb-2">📇</div>
          No leads yet. Click “New lead” to add one.
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50/80 text-[10px] uppercase tracking-wider text-slate-400 font-bold border-b border-slate-100">
                <th className="text-left px-4 py-3">Lead</th>
                <th className="text-left px-4 py-3">Contact</th>
                {!isProspect && <th className="text-left px-4 py-3">Source</th>}
                {!isProspect && <th className="text-left px-4 py-3">Status</th>}
                {!isProspect && <th className="text-left px-4 py-3">Deals</th>}
                <th className="text-left px-4 py-3">Owner</th>
                {isProspect && <th className="text-left px-4 py-3">Call back due</th>}
                {isProspect && <th className="text-left px-4 py-3">Added</th>}
                <th className="text-left px-4 py-3">Last activity</th>
                {isProspect && <th className="px-4 py-3 text-right">Action</th>}
                {user.role === 'leadmanager' && !isProspect && <th className="px-4 py-3 text-right">Draft</th>}
                {user.role === 'admin' && <th className="px-4 py-3"></th>}
              </tr>
            </thead>
            <tbody>
              {displayItems.map((l) => {
                const sm = statusMeta(config, l.status);
                const stale = staleness(l);
                const deals = l.deals || [];
                const openDeals = deals.filter((d) => d.stage !== 'closed_won' && d.stage !== 'closed_lost');
                const wonDeals = deals.filter((d) => d.stage === 'closed_won');
                return (
                  <tr key={l._id} onClick={() => onOpen(l)} className="border-t border-slate-50 hover:bg-orange-50/30 cursor-pointer transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: sm.color + '1a', color: sm.color }}>
                          {(fullName(l)[0] || '?').toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="font-bold text-[#050A1F] flex items-center gap-1.5">
                            <span className="truncate">{fullName(l)}</span>
                            {openDeals.length > 0 && <span title={`${openDeals.length} open deal(s)`} className="text-[10px]">💰</span>}
                            {stale && <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${stale.level === 'red' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'}`}>⏱{stale.days}d</span>}
                            {/* Pre-sales first-reply state, so the list shows
                                who is waiting on what without opening a lead. */}
                            {draftState(l) === 'overdue' && (
                              <span title="First reply is more than 24 hours overdue"
                                className="rounded-full px-1.5 py-0.5 text-[9px] font-bold bg-red-100 text-red-600">DRAFT OVERDUE</span>
                            )}
                            {draftState(l) === 'pending' && (
                              <span title="First reply still outstanding"
                                className="rounded-full px-1.5 py-0.5 text-[9px] font-bold bg-amber-100 text-amber-700">DRAFT DUE</span>
                            )}
                            {l.reminderRequestedAt && !l.firstReplyDoneAt && (
                              <span title={`Draft requested by ${l.reminderRequestedBy}`}
                                className="rounded-full px-1.5 py-0.5 text-[9px] font-bold bg-purple-100 text-purple-700">REMINDED</span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 truncate">{l.website || '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      <div className="text-xs truncate max-w-[180px]">{l.email || '—'}</div>
                      <div className="text-[11px] text-slate-400">{l.mobile || l.phone || ''}</div>
                    </td>
                    {!isProspect && <td className="px-4 py-3 text-slate-500 text-xs">{l.leadSource || '—'}</td>}
                    {!isProspect && <td className="px-4 py-3"><span className="rounded-full px-2.5 py-1 text-[10px] font-bold text-white" style={{ background: sm.color }}>{sm.label}</span></td>}
                    {!isProspect && (
                    <td className="px-4 py-3">
                      {deals.length === 0 ? <span className="text-slate-300 text-xs">—</span> : (
                        <div className="flex items-center gap-1.5">
                          {openDeals.length > 0 && <span className="rounded-md bg-blue-50 text-blue-600 px-1.5 py-0.5 text-[10px] font-bold">{openDeals.length} open</span>}
                          {wonDeals.length > 0 && <span className="rounded-md bg-green-50 text-green-600 px-1.5 py-0.5 text-[10px] font-bold">{wonDeals.length} won</span>}
                        </div>
                      )}
                    </td>
                    )}
                    <td className="px-4 py-3 text-slate-500 text-xs">{l.ownerName}</td>
                    {isProspect && (
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        {l.callbackAt ? (
                          <span className={`${callbackTone(l.callbackAt)} whitespace-nowrap`}>
                            {fmtDate(l.callbackAt)} · {callbackCountdown(l.callbackAt)}
                          </span>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                    )}
                    {isProspect && (
                      <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(l.createdAt)}</td>
                    )}
                    <td className={`px-4 py-3 text-xs ${stale ? (stale.level === 'red' ? 'text-red-500 font-semibold' : 'text-amber-600') : 'text-slate-400'}`}>{fmtDate(l.lastActivityAt)}</td>
                    {/* Transfer promotes a prospect to a worked lead. Only the
                        owner, a manager over them, or admin can transfer. */}
                    {isProspect && (
                      <td className="px-4 py-3 text-right">
                        <button title="Transfer this prospect to an agent or manager"
                          onClick={(e) => { e.stopPropagation(); setTransferFor(l); }}
                          className="rounded-lg px-3 py-1.5 text-[11px] font-bold text-white whitespace-nowrap"
                          style={{ background: 'linear-gradient(90deg,#8B5CF6,#7C3AED)' }}>
                          → Transfer
                        </button>
                      </td>
                    )}
                    {/* Lead managers chase the first-reply draft from here. */}
                    {user.role === 'leadmanager' && !isProspect && (
                      <td className="px-4 py-3 text-right">
                        {draftState(l) && !l.reminderRequestedAt && (
                          <button title="Ask the owner for the first-reply draft"
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                await api(`/leads/${l._id}/request-reminder`, { method: 'POST', body: JSON.stringify({}) });
                                load();
                              } catch (err) { alert(err.message); }
                            }}
                            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:border-orange-300 hover:text-[#FF4500] whitespace-nowrap">
                            Request draft
                          </button>
                        )}
                        {l.reminderRequestedAt && !l.firstReplyDoneAt && (
                          <span className="text-[10px] font-bold text-purple-600">Requested</span>
                        )}
                      </td>
                    )}
                    {user.role === 'admin' && (
                      <td className="px-4 py-3 text-right">
                        <button title="Delete lead" onClick={async (e) => {
                          e.stopPropagation();
                          if (!confirm(`Permanently delete ${fullName(l)}?\n\nThis removes the lead and all its notes, activities and deals. This cannot be undone.`)) return;
                          try { await api(`/leads/${l._id}`, { method: 'DELETE' }); load(); } catch (err) { alert(err.message); }
                        }} className="text-slate-300 hover:text-red-500"><Icon.Trash size={15} /></button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!loading && items.length > 0 && (
        <Pagination page={page} pages={pageInfo.pages} total={pageInfo.total} perPage={perPage}
          onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} label="leads" />
      )}
      {importing && <CsvImportModal onClose={() => setImporting(false)} onDone={() => { setImporting(false); load(); }} />}
      {transferFor && (
        <TransferModal lead={transferFor} owners={owners} user={user}
          onClose={() => setTransferFor(null)}
          onDone={() => { setTransferFor(null); load(); }} />
      )}
    </div>
  );
}

/**
 * Transfer a call-back prospect to an agent or manager, which promotes it to a
 * worked lead. The receiver becomes the owner; the person transferring keeps
 * visibility because they generated it.
 */
function TransferModal({ lead, owners, user, onClose, onDone }) {
  const [toId, setToId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Only agents and managers can receive a prospect.
  const targets = (owners || []).filter((o) => ['agent', 'manager'].includes(o.role) && o.id !== user.id);

  const go = async () => {
    if (!toId) { setErr('Choose who to transfer to.'); return; }
    setBusy(true); setErr('');
    try {
      await api(`/leads/${lead._id}/transfer`, { method: 'POST', body: JSON.stringify({ toId: Number(toId) }) });
      onDone();
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="text-base font-extrabold text-[#050A1F]">Transfer prospect</div>
        <div className="text-sm text-slate-500 mt-1">
          {fullName(lead)} will become a worked lead owned by whoever you choose. You’ll still see it, since you generated it.
        </div>
        <div className="mt-4">
          <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Transfer to</label>
          <select value={toId} onChange={(e) => setToId(e.target.value)}
            className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400">
            <option value="">— Select agent or manager —</option>
            {targets.map((o) => <option key={o.id} value={o.id}>{o.name}{o.role === 'manager' ? ' (manager)' : ''}</option>)}
          </select>
        </div>
        {err && <div className="text-xs text-red-600 mt-2">{err}</div>}
        <button disabled={busy || !toId} onClick={go}
          className="w-full mt-4 rounded-lg px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"
          style={{ background: 'linear-gradient(90deg,#8B5CF6,#7C3AED)' }}>
          {busy ? 'Transferring…' : 'Transfer & make it a lead'}
        </button>
        <button onClick={onClose} className="w-full mt-2 rounded-lg px-4 py-2 text-xs font-bold text-slate-400 hover:text-slate-600">Cancel</button>
      </div>
    </div>
  );
}

// ---- CSV import ------------------------------------------------------------
// Minimal client-side CSV parser (handles quoted fields and commas) so we don't
// add a dependency. Maps header names to lead fields, posts to /leads/bulk.
function parseCsv(text) {
  const rows = [];
  let field = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inQ) {
      if (c === '"' && n === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const CSV_FIELDS = ['firstName', 'lastName', 'website', 'email', 'secondaryEmail', 'mobile', 'phone', 'leadSource', 'generatedBy', 'status', 'servicesInterested', 'tags', 'country', 'city', 'timezone', 'additionalInfo'];
// Accept friendly header aliases too.
const HEADER_ALIASES = {
  'first name': 'firstName', 'last name': 'lastName', 'secondary email': 'secondaryEmail',
  'lead source': 'leadSource', 'generated by': 'generatedBy', 'services': 'servicesInterested',
  'services interested': 'servicesInterested', 'additional info': 'additionalInfo', 'time zone': 'timezone',
};

function CsvImportModal({ onClose, onDone }) {
  const [rows, setRows] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const onFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseCsv(String(reader.result));
        if (parsed.length < 2) { setError('The file needs a header row and at least one data row.'); return; }
        const hdr = parsed[0].map((h) => {
          const key = h.trim().toLowerCase();
          return HEADER_ALIASES[key] || CSV_FIELDS.find((f) => f.toLowerCase() === key) || h.trim();
        });
        setHeaders(hdr);
        const data = parsed.slice(1).map((r) => {
          const obj = {};
          hdr.forEach((h, i) => { if (CSV_FIELDS.includes(h)) obj[h] = (r[i] || '').trim(); });
          return obj;
        }).filter((o) => o.firstName);
        setRows(data); setError('');
      } catch (err) { setError('Could not parse the file. Make sure it is a valid CSV.'); }
    };
    reader.readAsText(file);
  };

  const doImport = async () => {
    setBusy(true); setError('');
    try {
      const res = await api('/leads/bulk', { method: 'POST', body: JSON.stringify({ rows }) });
      setResult(res);
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-lg max-h-[88vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-[#050A1F] mb-2">Import leads from CSV</h3>
        {!result ? (
          <>
            <p className="text-xs text-slate-500 mb-4">
              First row must be headers. Recognised columns: {CSV_FIELDS.join(', ')}. For multiple services or tags in one cell, separate with <code className="bg-slate-100 px-1 rounded">;</code>. Only <b>firstName</b> is required.
            </p>
            <input type="file" accept=".csv,text/csv" onChange={onFile}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-[#050A1F] file:px-4 file:py-2 file:text-white file:font-bold file:text-xs" />
            {error && <div className="mt-3 rounded-lg bg-red-50 text-red-600 text-sm px-3 py-2">{error}</div>}
            {rows && (
              <div className="mt-4">
                <div className="text-xs font-bold text-slate-500 mb-2">{rows.length} leads ready to import. Preview (first 5):</div>
                <div className="border border-slate-100 rounded-lg overflow-auto max-h-48">
                  <table className="w-full text-[11px]">
                    <thead><tr className="bg-slate-50 text-slate-400">{headers.filter((h) => CSV_FIELDS.includes(h)).slice(0, 5).map((h) => <th key={h} className="text-left px-2 py-1">{h}</th>)}</tr></thead>
                    <tbody>
                      {rows.slice(0, 5).map((r, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          {headers.filter((h) => CSV_FIELDS.includes(h)).slice(0, 5).map((h) => <td key={h} className="px-2 py-1 text-slate-600 truncate max-w-[100px]">{r[h]}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
              <button onClick={doImport} disabled={busy || !rows || rows.length === 0} className="rounded-lg px-6 py-2 text-sm font-bold text-white disabled:opacity-40" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>{busy ? 'Importing…' : `Import ${rows ? rows.length : ''} leads`}</button>
            </div>
          </>
        ) : (
          <div>
            <div className="rounded-lg bg-green-50 text-green-700 text-sm px-4 py-3 mb-3">✓ Imported {result.created} lead{result.created === 1 ? '' : 's'}.</div>
            {result.skipped && result.skipped.length > 0 && (
              <div className="text-xs text-slate-500">
                <div className="font-bold mb-1">{result.skipped.length} row(s) skipped:</div>
                <ul className="list-disc pl-5 max-h-32 overflow-auto">
                  {result.skipped.slice(0, 20).map((s, i) => <li key={i}>Row {s.row}: {s.reason}</li>)}
                </ul>
              </div>
            )}
            <div className="flex justify-end mt-4">
              <button onClick={onDone} className="rounded-lg bg-[#050A1F] px-6 py-2 text-sm font-bold text-white">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- New lead form ---------------------------------------------------------
export function NewLead({ user, onCreated, onCancel, isCallback, onOpenLead }) {
  const [config, setConfig] = useState({});
  const [owners, setOwners] = useState([]);
  const [f, setF] = useState(() => {
    // Agents start a lead as a fresh call-back from cold calling in the US —
    // the overwhelmingly common case for them, so pre-filling saves clicks.
    // "United States" is the exact value stored in countries.js, so the
    // combobox and timezone resolver both recognise it (a raw "us" would show
    // as unmatched text and break the phone/timezone lookups).
    const agentDefaults = user.role === 'agent'
      ? { country: 'United States', leadSource: 'Cold Calling', status: 'callback' }
      : { country: '', leadSource: '', status: 'new' };
    // A call-back always starts with the same defaults whoever creates it: US,
    // cold calling, generated by the person adding it, and the call-back stage.
    const callbackDefaults = isCallback
      ? { country: 'United States', leadSource: 'Cold Calling', generatedBy: user.name || '', status: 'callback' }
      : {};
    return {
      ownerId: user.id, firstName: '', lastName: '', website: '', email: '', secondaryEmail: '',
      mobile: '', phone: '', generatedBy: '', generatedFromEmail: '',
      servicesInterested: [], tags: [], city: '', timezone: '', additionalInfo: '',
      callbackAt: '',
      ...agentDefaults,
      ...callbackDefaults,
    };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dupe, setDupe] = useState(null); // duplicate-website info from the server
  const errorRef = React.useRef(null);

  useEffect(() => {
    api('/leads/config').then((r) => {
      const list = r.owners || [];
      setConfig(r.config || {});
      setOwners(list);
      // The creator owns the lead by default (agents always; admins and managers
      // can own too, so pre-select them). They can change it if the dropdown is
      // available. Lead managers can't own, so they must actively pick someone.
      setF((s) => {
        const me = list.find((o) => o.id === user.id);
        if (me && ['agent', 'admin', 'manager'].includes(user.role)) return { ...s, ownerId: me.id };
        return { ...s, ownerId: null };
      });
    }).catch(() => {});
  }, []);

  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const toggleArr = (k, v) => setF((s) => ({ ...s, [k]: s[k].includes(v) ? s[k].filter((x) => x !== v) : [...s[k], v] }));

  const submit = async () => {
    if (!f.firstName.trim()) { setError('First name is required.'); return; }
    if (canAssign && !f.ownerId) { setError('Please select the lead owner.'); return; }
    if (dupe) { setError(`This website already belongs to a lead owned by ${dupe.ownerName}.`); return; }
    setBusy(true); setError('');
    try {
      // Lead managers back-date via entryDate; the server maps it onto
      // createdAt (and assignedAt) after validating it's within range.
      const payload = { ...f };
      if (f.entryDate && ['leadmanager', 'admin'].includes(user.role)) {
        payload.createdAt = new Date(`${f.entryDate}T09:00:00`).toISOString();
      }
      delete payload.entryDate;
      const lead = await api('/leads', { method: 'POST', body: JSON.stringify(payload) });
      onCreated(lead);
    } catch (e) {
      setError(e.message);
      // A duplicate-website rejection carries the existing lead so we can link.
      if (e.data && e.data.duplicate) setDupe(e.data.duplicate);
      // The banner sits at the top of a long form, so bring it into view —
      // otherwise the user clicks Save at the bottom and never sees the error.
      setTimeout(() => {
        if (errorRef.current) errorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
    }
    setBusy(false);
  };

  // Admins, managers and lead managers assign leads to other people. Lead
  // managers in particular never own a lead, so they must pick an owner.
  const canAssign = ['admin', 'manager', 'leadmanager'].includes(user.role);
  const inp = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400';
  const lab = 'block text-[11px] font-bold text-slate-500 mb-1';

  return (
    <div className="max-w-3xl">
      <button onClick={onCancel} className="text-xs font-bold text-slate-400 hover:text-slate-600 mb-3">← Back to {isCallback ? 'call backs' : 'leads'}</button>
      <h1 className="text-2xl font-extrabold text-[#050A1F] mb-6">{isCallback ? 'Add call back' : 'New lead'}</h1>
      <div ref={errorRef}>
      {error && !dupe && <div className="mb-4 rounded-lg bg-red-50 text-red-600 text-sm px-4 py-2">{error}</div>}
      {dupe && (
        <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-3">
          <div className="font-bold">Duplicate lead</div>
          <div className="mt-0.5">
            {error}{' '}
            {dupe.visible && dupe._id ? (
              <button type="button" onClick={() => onOpenLead && onOpenLead(dupe._id)}
                className="font-bold text-[#FF4500] hover:underline">
                Open the existing lead →
              </button>
            ) : null}
          </div>
        </div>
      )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-5">
        {/* The generated date — when the lead was created in the real world.
            For historical imports (e.g. from Zoho) this is a past date; the lead
            still enters the system today, so the untouched clock runs from now,
            not this date. Lead managers and admins only; never for call-backs. */}
        {!isCallback && ['leadmanager', 'admin'].includes(user.role) && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-4">
            <label className="block text-[11px] font-bold text-amber-700 uppercase tracking-wide mb-1">Lead generated date</label>
            <div className="flex items-center gap-3 flex-wrap">
              <input type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={f.entryDate || ''}
                onChange={(e) => set('entryDate', e.target.value)}
                className="rounded-lg border border-amber-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400" />
              <span className="text-[11px] text-amber-700">
                {f.entryDate
                  ? `Recorded as generated on ${new Date(f.entryDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}. The 24-hour first-reply rule won’t apply to it.`
                  : 'Leave blank for today. Set a past date when importing older leads from Zoho.'}
              </span>
            </div>
          </div>
        )}

        {/* When creating a call-back, capture the agreed call-back time. It's
            shown in the Call Backs list with a countdown so the agent knows
            what's due next. */}
        {isCallback && (
          <div className="rounded-xl bg-violet-50 border border-violet-200 p-4">
            <label className="block text-[11px] font-bold text-violet-700 uppercase tracking-wide mb-1">Call back on</label>
            <input type="datetime-local"
              value={f.callbackAt || ''}
              onChange={(e) => set('callbackAt', e.target.value)}
              className="rounded-lg border border-violet-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-400" />
            <div className="text-[11px] text-violet-700 mt-1">
              {f.callbackAt
                ? `Scheduled for ${new Date(f.callbackAt).toLocaleString('en-GB', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}.`
                : 'When did the prospect ask to be called back?'}
            </div>
          </div>
        )}

        {/* Owner + country up top: country drives phone codes and timezone, so
            it belongs before the contact fields are filled in. */}
        <div className={`grid ${canAssign ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
          {canAssign && (
            <div>
              <label className={lab}>Lead owner</label>
              <select className={inp} value={f.ownerId || ''} onChange={(e) => set('ownerId', e.target.value ? Number(e.target.value) : null)}>
                <option value="" disabled>Select the lead owner…</option>
                {owners.map((o) => <option key={o.id} value={o.id}>{o.name}{o.role !== 'agent' ? ` (${o.role})` : ''}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className={lab}>Country</label>
            <CountryCombobox className={inp} value={f.country} onChange={(v) => { const z = COUNTRY_TIMEZONES[v]; set('country', v); if (z && z.length === 1) set('timezone', z[0]); else set('timezone', ''); if (f.mobile) set('mobile', formatPhone(f.mobile, v)); if (f.phone) set('phone', formatPhone(f.phone, v)); }} />
          </div>
        </div>

        <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wide border-b border-slate-100 pb-1">Contact information</div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className={lab}>First name *</label><input className={inp} value={f.firstName} onChange={(e) => set('firstName', e.target.value)} /></div>
          <div><label className={lab}>Last name</label><input className={inp} value={f.lastName} onChange={(e) => set('lastName', e.target.value)} /></div>
          <div><label className={lab}>Website</label>
            <WebsiteField value={f.website}
              onChange={(v) => set('website', v)}
              onDuplicate={(d) => setDupe(d)} />
            {dupe && (
              <div className="mt-1 text-xs text-amber-700">
                Already a lead owned by <span className="font-bold">{dupe.ownerName}</span>.{' '}
                {dupe.visible && dupe._id && (
                  <button type="button" onClick={() => onOpenLead && onOpenLead(dupe._id)} className="font-bold text-[#FF4500] hover:underline">Open it →</button>
                )}
              </div>
            )}
          </div>
          <div><label className={lab}>Email</label><input className={inp} value={f.email} onChange={(e) => set('email', e.target.value)} /></div>
          <div><label className={lab}>Secondary email</label><input className={inp} value={f.secondaryEmail} onChange={(e) => set('secondaryEmail', e.target.value)} /></div>
          <div><label className={lab}>Mobile</label><PhoneField className={inp} value={f.mobile} country={f.country} onChange={(v) => set('mobile', v)} /></div>
          <div><label className={lab}>Phone</label><PhoneField className={inp} value={f.phone} country={f.country} onChange={(v) => set('phone', v)} /></div>
        </div>

        <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wide border-b border-slate-100 pb-1">Classification</div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={lab}>Lead source</label>
            <select className={inp} value={f.leadSource} onChange={(e) => set('leadSource', e.target.value)}>
              <option value="">— Select —</option>
              {(config.leadSources || []).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className={lab}>Generated by</label>
            <select className={inp} value={f.generatedBy} onChange={(e) => set('generatedBy', e.target.value)}>
              <option value="">— Select —</option>
              {/* Pre-sales leads are attributed to the pre-sales team members
                  (names only, no logins); every other source is attributed to
                  a real user who could own the lead. */}
              {/pre-?sales/i.test(f.leadSource) ? (
                (config.presalesTeam || []).length
                  ? config.presalesTeam.map((n) => {
                      // Members may be plain strings (legacy) or { name, ... }.
                      const nm = typeof n === 'string' ? n : n.name;
                      return <option key={nm} value={nm}>{nm}</option>;
                    })
                  : <option value="" disabled>No pre-sales team members configured</option>
              ) : (
                owners.map((o) => <option key={o.id} value={o.name}>{o.name}</option>)
              )}
            </select>
          </div>
          {/* Which pre-sales inbox this lead came from. Only relevant for
              pre-sales leads, and only lead managers and admins may see or set
              it. Filterable, like the country field. */}
          {/pre-?sales/i.test(f.leadSource) && ['leadmanager', 'admin'].includes(user.role) && (
            <div>
              <label className={lab}>Generated from email</label>
              <FilterCombobox className={inp} value={f.generatedFromEmail}
                onChange={(v) => set('generatedFromEmail', v)}
                options={config.presalesEmails || []}
                placeholder={(config.presalesEmails || []).length ? 'Search pre-sales emails…' : 'No pre-sales emails configured'} />
            </div>
          )}
          <div>
            <label className={lab}>Lead status</label>
            <select className={inp} value={f.status} onChange={(e) => set('status', e.target.value)}>
              {(config.leadStatuses || []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className={lab}>Services interested in</label>
          <MultiSelectCombobox className={inp} options={config.servicesInterested || []} values={f.servicesInterested}
            onChange={(v) => set('servicesInterested', v)} placeholder="Type to search services…" />
        </div>

        <div>
          <label className={lab}>Tags</label>
          <div className="flex flex-wrap gap-1.5">
            {(config.tags || []).map((t) => (
              <button key={t} type="button" onClick={() => toggleArr('tags', t)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-bold border ${f.tags.includes(t) ? 'bg-[#FF6A00] text-white border-transparent' : 'text-slate-500 border-slate-200 hover:border-slate-400'}`}>{t}</button>
            ))}
          </div>
        </div>

        <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wide border-b border-slate-100 pb-1">Location</div>
        <div className="grid grid-cols-3 gap-4">
          <div><label className={lab}>City</label><input className={inp} value={f.city} onChange={(e) => set('city', e.target.value)} /></div>
          <div><label className={lab}>Time zone</label><TimezoneField className={inp} country={f.country} value={f.timezone} onChange={(v) => set('timezone', v)} /></div>
        </div>

        <div>
          <label className={lab}>Additional information</label>
          <RichText value={f.additionalInfo} onChange={(v) => set('additionalInfo', v)} placeholder="Anything useful about this lead…" minHeight={110} />
        </div>

        <div className="flex flex-col items-end gap-2 pt-2">
          {(error || dupe) && (
            <div className={`w-full rounded-lg px-4 py-2.5 text-sm ${dupe ? 'bg-amber-50 border border-amber-200 text-amber-800' : 'bg-red-50 text-red-600'}`}>
              <span className="font-bold">{dupe ? 'Duplicate lead: ' : ''}</span>{error}{' '}
              {dupe && dupe.visible && dupe._id ? (
                <button type="button" onClick={() => onOpenLead && onOpenLead(dupe._id)}
                  className="font-bold text-[#FF4500] hover:underline">Open the existing lead →</button>
              ) : null}
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
            <button onClick={submit} disabled={busy} className="rounded-lg px-6 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>{busy ? 'Saving…' : isCallback ? 'Create call back' : 'Create lead'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Lead detail (shell; tabs filled in later phases) ----------------------
export function LeadDetail({ user, leadId, onBack, initialTab, isProspect }) {
  const [lead, setLead] = useState(null);
  const [config, setConfig] = useState({});
  const [tab, setTab] = useState(initialTab || 'timeline');
  const [emailUnread, setEmailUnread] = useState(0);
  const [editSection, setEditSection] = useState(null); // 'all' | 'basic' | 'tags' | 'description' | 'other'
  const [draft, setDraft] = useState(null);
  const [quickModal, setQuickModal] = useState(null); // 'note' | 'task' | 'call' | 'deal'
  const [showBrief, setShowBrief] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [owners, setOwners] = useState([]);
  const [loadError, setLoadError] = useState('');

  const load = async () => {
    setLoadError('');
    // Load the lead and the config independently. The lead is what the page
    // needs to render; a config hiccup shouldn't leave the whole page stuck on
    // "Loading…" forever (the previous Promise.all did exactly that — if either
    // call failed, `lead` stayed null with no error shown).
    try {
      const res = await api(`/leads/${leadId}`);
      setLead(res.lead || res);
    } catch (e) {
      console.error(e);
      setLoadError(e.message || 'Could not load this lead.');
    }
    try {
      const cfg = await api('/leads/config');
      setConfig(cfg.config || {}); setOwners(cfg.owners || []);
    } catch (e) { console.error(e); /* config is non-critical */ }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [leadId]);
  useEffect(() => {
    if (!leadId) return;
    api(`/gmail/lead/${leadId}/unread`).then((d) => setEmailUnread(d.unread || 0)).catch(() => setEmailUnread(0));
  }, [leadId, tab]);

  if (loadError) return (
    <div className="text-center py-12">
      <div className="text-sm text-red-500 mb-3">{loadError}</div>
      <div className="flex gap-2 justify-center">
        <button onClick={load} className="rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>Retry</button>
        <button onClick={onBack} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Back to list</button>
      </div>
    </div>
  );
  if (!lead) return <div className="text-slate-400 text-sm py-12 text-center">Loading…</div>;

  // A prospect has no deals/reports tabs; if we're pointed at one, show the
  // timeline instead. Computed (not setState-in-render) to avoid a render loop.
  const isCallback = lead.status === 'callback';
  const effTab = (isCallback && (tab === 'deals' || tab === 'reports')) ? 'timeline' : tab;

  const sm = statusMeta(config, lead.status);
  const openEdit = (section) => { setDraft({ ...lead }); setEditSection(section); };
  const saveEdit = async () => {
    try {
      const updated = await api(`/leads/${leadId}`, { method: 'PATCH', body: JSON.stringify(draft) });
      setLead(updated); setEditSection(null);
    } catch (e) { alert(e.message); }
  };

  // NB: named RowIcon, not Icon — a local `Icon` would shadow the imported SVG
  // icon set used by the header buttons and blank the whole page.
  const RowIcon = ({ children }) => <span className="inline-block w-4 text-slate-400 mr-2">{children}</span>;
  const SectionHead = ({ title, section }) => (
    <div className="flex items-center justify-between mb-3">
      <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">{title}</div>
      <button onClick={() => openEdit(section)} title={`Edit ${title}`} className="text-slate-300 hover:text-[#FF4500] text-xs">✏️</button>
    </div>
  );

  return (
    <div>
      {/* Top row: back on the left, the lead's local time on the right — keeps
          the action buttons below on a single line. */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <button onClick={onBack} className="text-xs font-bold text-slate-400 hover:text-slate-600">← Back to {isCallback ? 'call backs' : 'leads'}</button>
        <div className="flex items-center gap-2">
          {lead.timezone && <LeadLocalClock timezone={lead.timezone} />}
          {/* On a prospect, the primary action is promoting it to a lead. */}
          {isCallback && (
            <button onClick={() => setShowTransfer(true)}
              className="rounded-lg px-2.5 py-1.5 text-xs font-bold text-white inline-flex items-center gap-1.5"
              style={{ background: 'linear-gradient(90deg,#8B5CF6,#7C3AED)' }}>
              → <span className="hidden sm:inline">Transfer to lead</span>
            </button>
          )}
          {/* Reads the prospect's site and briefs the agent before they dial. */}
          <button onClick={() => setShowBrief(true)} disabled={!lead.website}
            title={lead.website ? 'AI business brief — what they do, what to pitch' : 'No website on this lead'}
            className="rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1.5 text-xs font-bold text-[#FF4500] inline-flex items-center gap-1.5 hover:bg-orange-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            <Icon.Sparkle size={14} /> <span className="hidden sm:inline">Brief</span>
          </button>
        </div>
      </div>
      {showBrief && <AiBriefModal lead={lead} onClose={() => setShowBrief(false)} />}
      {showTransfer && (
        <TransferModal lead={lead} owners={owners} user={user}
          onClose={() => setShowTransfer(false)}
          onDone={() => { setShowTransfer(false); onBack(); }} />
      )}

      {/* Pre-sales first-reply obligation, shown before anything else because
          it is time-bound. */}
      <FirstReplyPanel lead={lead} user={user} onChange={setLead} />

      {/* Header: avatar + name + status/tags, owner/last-activity, quick actions */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5 mb-6 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-4 min-w-0">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-extrabold shrink-0" style={{ background: sm.color + '1a', color: sm.color }}>
              {(fullName(lead)[0] || '?').toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-extrabold text-[#050A1F]">{fullName(lead)}</h1>
                <button onClick={() => openEdit('status')} title="Click to change status"
                  className="rounded-full px-3 py-1 text-[11px] font-bold text-white hover:opacity-90 cursor-pointer" style={{ background: sm.color }}>{sm.label} ▾</button>
                {(lead.tags || []).map((t) => (
                  <button key={t} onClick={() => openEdit('tags')} title="Click to edit tags"
                    className="rounded-full bg-orange-50 text-[#FF4500] px-2.5 py-0.5 text-[11px] font-bold hover:bg-orange-100 cursor-pointer">{t}</button>
                ))}
                <button onClick={() => openEdit('tags')} title="Add or edit tags"
                  className="rounded-full border border-dashed border-slate-300 text-slate-400 px-2 py-0.5 text-[11px] font-bold hover:border-slate-400 hover:text-slate-600">+ tag</button>
              </div>
              <div className="text-sm text-slate-400 mt-1.5">
                {lead.website && <><a href={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-blue-500 hover:underline">{lead.website.replace(/^https?:\/\//, '')}</a><span className="mx-2">·</span></>}
                Owner: <span className="font-semibold text-slate-600">{lead.ownerName}</span>
                <span className="mx-2">·</span>Last activity {fmtDate(lead.lastActivityAt)}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <ActionBtn onClick={() => setQuickModal('note')} label="Note" icon={<Icon.Note />} />
            <ActionBtn onClick={() => setQuickModal('task')} label="Task" icon={<Icon.Check />} />
            <ActionBtn onClick={() => setQuickModal('call')} label="Call" icon={<Icon.Phone />} />
            <ActionBtn onClick={() => setQuickModal('deal')} label="Deal" icon={<Icon.Money />} />
            <button onClick={() => openEdit('all')}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-white"
              style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>
              <Icon.Pencil /> Edit
            </button>
            {user.role === 'admin' && (
              <button title="Delete lead" onClick={async () => {
                if (!confirm(`Permanently delete ${fullName(lead)}?\n\nThis removes the lead and all of its notes, activities and deals from the database. This cannot be undone.`)) return;
                try { await api(`/leads/${leadId}`, { method: 'DELETE' }); onBack(); } catch (e) { alert(e.message); }
              }} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-500 hover:bg-red-50">
                <Icon.Trash /> Delete
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6" style={{ gridTemplateColumns: '30% 1fr' }}>
        {/* LEFT 30% — each section independently editable */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <SectionHead title="Basic info" section="basic" />
            <div className="space-y-2 text-sm text-slate-700">
              <div className="flex items-center gap-2"><span className="text-slate-400"><Icon.Mail size={14} /></span>{lead.email || <span className="text-slate-300">—</span>}</div>
              <div className="flex items-center gap-2"><span className="text-slate-400"><Icon.Phone size={14} /></span>{lead.mobile || <span className="text-slate-300">—</span>}</div>
              <div className="flex items-center gap-2"><span className="text-slate-400"><Icon.Phone size={14} /></span>{lead.phone || <span className="text-slate-300">—</span>}</div>
              <div className="flex items-center gap-2">
                <span className="text-slate-400"><Icon.Globe size={14} /></span>
                {lead.website ? (
                  <a href={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`}
                    target="_blank" rel="noreferrer" title={lead.website}
                    className="text-blue-500 hover:underline truncate inline-block max-w-[190px] align-bottom">
                    {lead.website.replace(/^https?:\/\//, '')}
                  </a>
                ) : <span className="text-slate-300">—</span>}
              </div>
              <div className="flex items-center gap-2"><span className="text-slate-400"><Icon.Pin size={14} /></span>{[lead.city, lead.country].filter(Boolean).join(', ') || <span className="text-slate-300">—</span>}</div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <SectionHead title="Tags" section="tags" />
            <div className="flex flex-wrap gap-1.5">
              {(lead.tags || []).length ? lead.tags.map((t) => <span key={t} className="rounded-full bg-orange-50 text-[#FF4500] px-2.5 py-0.5 text-[11px] font-bold">{t}</span>) : <span className="text-slate-300 text-sm">No tags</span>}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <SectionHead title="Description" section="description" />
            {lead.additionalInfo
              ? <div className="text-sm text-slate-600 rich-text" dangerouslySetInnerHTML={{ __html: lead.additionalInfo }} />
              : <div className="text-sm text-slate-300">No description</div>}
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <SectionHead title="Other info" section="other" />
            <div className="space-y-2 text-sm">
              <Row k="Secondary email" v={lead.secondaryEmail} />
              {/* "Generated by" names the pre-sales person on non-pre-sales
                  leads. On a Pre-Sales lead the source already says pre-sales,
                  so the extra line is redundant — hide it. */}
              {!/pre-?sales/i.test(String(lead.leadSource || '')) && <Row k="Generated by" v={lead.generatedBy} />}
              {/* When the lead entered the CRM. If it was back-dated at entry,
                  createdAt already holds that chosen date. */}
              {/* Show the real-world generated date. The created (entry) date is
                  kept internally for the untouched clock but not shown — for a
                  normal add they're identical, and for a back-dated lead the
                  generated date is the meaningful one to display. */}
              <Row k="Lead generated" v={(lead.generatedAt || lead.createdAt) ? fmtDate(lead.generatedAt || lead.createdAt) : null} />
              <Row k="Lead status" v={sm.label} />
              {/* Services are edited far too often to be buried in the modal —
                  surface them as clickable chips with an inline add button. */}
              <div className="flex items-start justify-between gap-2 py-1">
                <span className="text-slate-400 shrink-0">Service interested in</span>
                <div className="flex flex-wrap gap-1 justify-end">
                  {(lead.servicesInterested || []).map((sv) => (
                    <button key={sv} onClick={() => openEdit('services')}
                      className="rounded-full bg-teal-50 text-teal-700 px-2 py-0.5 text-[11px] font-bold hover:bg-teal-100">{sv}</button>
                  ))}
                  <button onClick={() => openEdit('services')}
                    className="rounded-full border border-dashed border-slate-300 text-slate-400 px-2 py-0.5 text-[11px] font-bold hover:border-slate-400 hover:text-slate-600">
                    {(lead.servicesInterested || []).length ? '+ edit' : '+ add service'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="text-[11px] text-slate-400 px-1">Last modified {fmtDate(lead.updatedAt)}</div>
        </div>

        {/* RIGHT 70% */}
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          <div className="flex border-b border-slate-100">
            {/* A call-back prospect isn't a worked lead yet, so it has no deals
                or reports — those tabs appear only once it's a real lead. */}
            {['timeline', 'email', 'notes', 'activity', 'deals', 'reports']
              .filter((t) => !(lead.status === 'callback' && (t === 'deals' || t === 'reports')))
              .map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`relative px-5 py-3 text-xs font-bold capitalize transition ${effTab === t ? 'text-[#FF4500] border-b-2 border-[#FF4500]' : 'text-slate-400 hover:text-slate-600'}`}>{t === 'email' ? 'Email' : t}
                {t === 'email' && emailUnread > 0 && <span className="ml-1.5 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-[#FF4500] text-white text-[9px] font-bold align-middle">{emailUnread}</span>}
              </button>
            ))}
          </div>
          <div className="p-5 min-h-[300px]">
            {effTab === 'timeline' && <Timeline lead={lead} />}
            {effTab === 'notes' && <NotesTab lead={lead} onChange={setLead} />}
            {effTab === 'activity' && <ActivityTab lead={lead} config={config} user={user} onChange={setLead} />}
            {effTab === 'deals' && !isCallback && <DealsTab lead={lead} config={config} user={user} onChange={setLead} />}
            {effTab === 'reports' && !isCallback && <ReportsTab lead={lead} onChange={setLead} />}
            {effTab === 'email' && <EmailTab lead={lead} user={user} onChange={setLead} />}
          </div>
        </div>
      </div>

      {/* Section / full edit modal */}
      {editSection && draft && (
        <EditLeadModal user={user} config={config} draft={draft} setDraft={setDraft} section={editSection} onSave={saveEdit} onClose={() => setEditSection(null)} />
      )}

      {/* Quick-action modals */}
      {quickModal === 'note' && <QuickNoteModal lead={lead} onClose={() => setQuickModal(null)} onSaved={(u) => { setLead(u); setQuickModal(null); setTab('notes'); }} />}
      {(quickModal === 'task' || quickModal === 'call') && <ActivityModal kind={quickModal} lead={lead} config={config} onClose={() => setQuickModal(null)} onSaved={(u) => { setLead(u); setQuickModal(null); setTab('activity'); }} />}
      {quickModal === 'deal' && <DealModal lead={lead} config={config} onClose={() => setQuickModal(null)} onSaved={(u) => { setLead(u); setQuickModal(null); setTab('deals'); }} />}
    </div>
  );
}

function QuickNoteModal({ lead, onClose, onSaved }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!plainText(text)) return;
    setBusy(true);
    try { const u = await api(`/leads/${lead._id}/notes`, { method: 'POST', body: JSON.stringify({ text }) }); onSaved(u); }
    catch (e) { alert(e.message); } setBusy(false);
  };
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-[#050A1F] mb-4">📝 Add note</h3>
        <textarea rows={4} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a note…"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={save} disabled={busy || !text.trim()} className="rounded-lg px-6 py-2 text-sm font-bold text-white disabled:opacity-40" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>{busy ? 'Saving…' : 'Save note'}</button>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-400">{k}</span>
      <span className="text-slate-700 font-medium text-right">{v || <span className="text-slate-300">—</span>}</span>
    </div>
  );
}

/**
 * First-reply workflow. A pre-sales enquiry has to be answered within 24 hours
 * of assignment — the owner either writes back themselves or hands a draft to
 * the lead manager. Shown only on pre-sales leads, and only until it's done.
 */
/**
 * Email draft tab — the pre-sales first-reply and reminder workflow in one
 * place. The agent (lead owner) writes drafts with a subject and body; the lead
 * manager only acknowledges (reads the first reply, receives the reminder).
 */
// The live Gmail thread for a lead: messages synced from the current user's
// connected mailbox (matched by the lead's email/domain), with read + reply +
// compose. Distinct from the pre-sales "Email draft" workflow.
// Merged Email tab: switches between the Gmail-style inbox (default), the
// pre-sales draft workflow, and a templates view (coming soon).
function EmailTab({ lead, user, onChange }) {
  const isPresales = /pre-?sales/i.test(String(lead.leadSource || ''));
  const [view, setView] = useState('inbox');
  const tabs = [['inbox', 'Email'], ...(isPresales ? [['draft', 'PCF Draft']] : [])];
  return (
    <div>
      <div className="flex items-center gap-1 mb-4 bg-slate-100 rounded-lg p-1 w-fit">
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => setView(id)} className={`px-4 py-1.5 rounded-md text-xs font-bold transition ${view === id ? 'bg-white text-[#FF4500] shadow-sm' : 'text-slate-500'}`}>{label}</button>
        ))}
      </div>
      {view === 'inbox' && <EmailInboxTab lead={lead} user={user} />}
      {view === 'draft' && <EmailDraftTab lead={lead} user={user} onChange={onChange} />}
    </div>
  );
}

// Reschedule a pending scheduled email to a new time (lead email tab).
function LeadRescheduleModal({ row, onClose, onSaved }) {
  const toLocalInput = (iso) => { try { const d = new Date(iso); const off = d.getTimezoneOffset(); return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16); } catch { return ''; } };
  const [when, setWhen] = useState(toLocalInput(row.sendAt));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
      await api(`/gmail/scheduled/${row.id}`, { method: 'PATCH', body: JSON.stringify({ sendAt: new Date(when).toISOString(), timezone: tz }) });
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[95] p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl" style={{ fontFamily: "'Plus Jakarta Sans',system-ui,sans-serif" }}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-base font-extrabold text-[#050A1F]">Reschedule email</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        <div className="text-xs text-slate-500 mb-3 truncate">{row.subject || '(no subject)'} · To: {row.to}</div>
        {err && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{err}</div>}
        <label className="block text-[11px] font-bold text-slate-500 mb-1">New send time</label>
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={busy || !when} className="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>{busy ? 'Saving…' : 'Reschedule'}</button>
        </div>
      </div>
    </div>
  );
}

function EmailInboxTab({ lead, user }) {
  const [data, setData] = useState(null); // { connected, email, fromOptions, unread, emails }
  const [err, setErr] = useState('');
  const [openThread, setOpenThread] = useState(null); // { threadId, subject }
  const [composer, setComposer] = useState(null); // { mode, to, cc, bcc, subject, body, threadId, inReplyTo, fromUserId }

  const load = () => api(`/gmail/lead/${lead._id || lead.id}`).then(setData).catch((e) => setErr(e.message));
  const [scheduled, setScheduled] = useState([]);
  const [reschedule, setReschedule] = useState(null);
  const loadScheduled = () => api(`/gmail/lead/${lead._id || lead.id}/scheduled`).then((r) => setScheduled(Array.isArray(r) ? r : [])).catch(() => {});
  useEffect(() => { load(); loadScheduled(); }, [lead._id, lead.id]);

  if (!data) return <div className="text-slate-400 text-sm py-8 text-center">{err || 'Loading…'}</div>;
  if (!data.connected) {
    return (
      <div className="text-center py-10">
        <div className="text-sm font-bold text-[#050A1F] mb-1">Connect your email to see this thread</div>
        <p className="text-xs text-slate-500 mb-4">Link your Google Workspace mailbox from the profile menu (top-right → Edit Profile). Then emails to and from this lead show up here.</p>
      </div>
    );
  }

  // Group emails into threads for the list (one row per thread, newest first).
  const threads = [];
  const seen = new Map();
  for (const e of data.emails) {
    const key = e.threadId || `single:${e._id}`;
    if (!seen.has(key)) { const t = { key, threadId: e.threadId, messages: [] }; seen.set(key, t); threads.push(t); }
    seen.get(key).messages.push(e);
  }
  threads.forEach((t) => t.messages.sort((a, b) => new Date(a.sentAt) - new Date(b.sentAt)));
  threads.sort((a, b) => new Date(b.messages[b.messages.length - 1].sentAt) - new Date(a.messages[a.messages.length - 1].sentAt));

  const startCompose = () => setComposer({ mode: 'new', to: lead.email ? [lead.email] : [], cc: [], bcc: [], subject: '', body: '', from: data.fromOptions[0]?.value });

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 bg-slate-50/50">
        <div className="flex items-center gap-3">
          <button onClick={load} title="Refresh" className="p-1.5 rounded hover:bg-slate-100 text-slate-500"><Icon.Globe size={16} /></button>
          <span className="text-xs text-slate-400">{data.email}{data.unread ? ` · ${data.unread} unread` : ''}</span>
        </div>
        <button onClick={startCompose} className="rounded-full px-4 py-1.5 text-xs font-bold text-white" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>Compose</button>
      </div>

      {err && <div className="mx-4 mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{err}</div>}

      {/* Scheduled emails for this lead — cancel or reschedule before they send. */}
      {scheduled.length > 0 && (
        <div className="mx-4 mt-3 rounded-xl border border-orange-200 bg-orange-50/50 overflow-hidden">
          <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-[#FF4500] border-b border-orange-100">🕐 Scheduled ({scheduled.length})</div>
          {scheduled.map((r) => (
            <div key={r.id} className="flex items-center gap-2 px-3 py-2 text-xs border-b border-orange-100/60 last:border-0">
              <span className="flex-1 min-w-0 truncate font-semibold text-[#050A1F]">{r.subject || '(no subject)'}</span>
              <span className="text-[11px] text-slate-500 shrink-0">To: {r.to}</span>
              <span className="text-[11px] font-bold text-[#FF4500] shrink-0">{(() => { try { return new Date(r.sendAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return r.sendAt; } })()}</span>
              <button onClick={() => setReschedule(r)} className="rounded border border-slate-300 px-2 py-0.5 text-[10px] font-bold text-slate-600 hover:bg-white shrink-0">Reschedule</button>
              <button onClick={async () => { try { await api(`/gmail/scheduled/${r.id}/cancel`, { method: 'POST' }); loadScheduled(); } catch (e) { alert(e.message); } }} className="rounded border border-red-200 px-2 py-0.5 text-[10px] font-bold text-red-600 hover:bg-white shrink-0">Cancel</button>
            </div>
          ))}
        </div>
      )}

      {/* Gmail-style list */}
      <div className="divide-y divide-slate-100">
        {threads.length === 0 && <div className="text-slate-400 text-sm text-center py-10">No emails found for this lead yet. New messages sync every few minutes.</div>}
        {threads.map((t) => {
          const last = t.messages[t.messages.length - 1];
          const hasUnread = t.messages.some((m) => m.direction === 'inbound' && !m.isRead);
          const anyStar = t.messages.some((m) => m.starred);
          const names = [...new Set(t.messages.map((m) => m.direction === 'outbound' ? 'me' : (m.fromName || m.fromEmail).split(' ')[0]))].join(', ');
          const attachCount = (last.attachments || []).length;
          return (
            <div key={t.key} onClick={() => setOpenThread({ threadId: t.threadId, subject: last.subject, key: t.key })}
              className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:shadow-[inset_0_0_0_9999px_rgba(0,0,0,0.015)] ${hasUnread ? 'bg-white' : 'bg-slate-50/40'}`}>
              <button onClick={(e) => { e.stopPropagation(); toggleStar(last._id, load); }} className="text-slate-300 hover:text-amber-400" title="Star">
                <svg width="17" height="17" viewBox="0 0 24 24" fill={anyStar ? '#FBBF24' : 'none'} stroke={anyStar ? '#FBBF24' : 'currentColor'} strokeWidth="1.6"><path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.8 5.9 20.4l1.4-6.8L2.2 9l6.9-.7z" /></svg>
              </button>
              <span className={`w-40 flex-shrink-0 text-sm truncate ${hasUnread ? 'font-bold text-[#050A1F]' : 'text-slate-600'}`}>
                {names}{t.messages.length > 1 && <span className="text-slate-400 font-normal"> {t.messages.length}</span>}
              </span>
              <span className="flex-1 min-w-0 text-sm truncate">
                <span className={hasUnread ? 'font-bold text-[#050A1F]' : 'text-slate-700'}>{last.subject || '(no subject)'}</span>
                <span className="text-slate-400"> — {last.snippet}</span>
                {attachCount > 0 && <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-slate-400 align-middle"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12l-9 9a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8" /></svg>{attachCount}</span>}
              </span>
              <span className={`flex-shrink-0 text-[11px] ${hasUnread ? 'font-bold text-[#050A1F]' : 'text-slate-400'}`}>{gmailDate(last.sentAt)}</span>
            </div>
          );
        })}
      </div>

      {openThread && <ThreadPopup lead={lead} thread={openThread} fromOptions={data.fromOptions} defaultSignature={data.defaultSignature} onClose={() => { setOpenThread(null); load(); }} onReload={load} />}
      {composer && <Composer lead={lead} initial={composer} fromOptions={data.fromOptions} defaultSignature={data.defaultSignature} onClose={() => setComposer(null)} onSent={() => { setComposer(null); load(); loadScheduled(); }} />}
      {reschedule && <LeadRescheduleModal row={reschedule} onClose={() => setReschedule(null)} onSaved={() => { setReschedule(null); loadScheduled(); }} />}
    </div>
  );
}

// Short Gmail-style date: time if today, "MMM D" otherwise.
function gmailDate(d) {
  const dt = new Date(d); const now = new Date();
  const sameDay = dt.toDateString() === now.toDateString();
  if (sameDay) return dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h} hour${h > 1 ? 's' : ''} ago`;
  const days = Math.floor(h / 24); return `${days} day${days > 1 ? 's' : ''} ago`;
}
async function toggleStar(id, reload) { try { await api(`/gmail/email/${id}/star`, { method: 'POST' }); reload && reload(); } catch { /* noop */ } }

// The thread popup (Image 1): subject header + message chain + reply actions.
function ThreadPopup({ lead, thread, fromOptions, defaultSignature, onClose, onReload }) {
  const [messages, setMessages] = useState(null);
  const [err, setErr] = useState('');
  const [composer, setComposer] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [showTo, setShowTo] = useState({}); // messageId -> show full to/from line

  const load = () => {
    if (!thread.threadId) { setMessages([]); return; }
    api(`/gmail/thread/${thread.threadId}`).then((d) => {
      const msgs = d.messages || [];
      setMessages(msgs);
      const exp = {}; msgs.forEach((m, i) => { exp[m._id || m.gmailMessageId || i] = i === msgs.length - 1; });
      setExpanded(exp);
      msgs.filter((m) => m.direction === 'inbound' && !m.isRead && m._id).forEach((m) => api(`/gmail/email/${m._id}/read`, { method: 'POST' }).catch(() => {}));
    }).catch((e) => setErr(e.message));
  };
  useEffect(() => { load(); }, [thread.threadId]);

  const keyOf = (m, i) => m._id || m.gmailMessageId || i;
  const toggle = (k) => setExpanded((e) => ({ ...e, [k]: !e[k] }));

  // Build a Gmail-style quoted block of the message being replied to / forwarded.
  const quoteBlock = (msg) => {
    const when = new Date(msg.sentAt).toLocaleString([], { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const who = `${msg.fromName || ''} &lt;${msg.fromEmail || ''}&gt;`.trim();
    const inner = msg.bodyHtml || `<div style="white-space:pre-wrap">${(msg.bodyText || msg.snippet || '')}</div>`;
    return `<br><br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">On ${when}, ${who} wrote:</div>` +
      `<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex;color:#555">${inner}</blockquote></div>`;
  };

  const replyTo = (msg, mode) => {
    const recipients = mode === 'replyall'
      ? [...new Set([msg.fromEmail, ...(msg.toEmail || '').split(',').map((x) => x.trim())].filter(Boolean))]
      : [msg.direction === 'inbound' ? msg.fromEmail : (msg.toEmail || lead.email)];
    setComposer({
      mode, to: recipients.filter(Boolean),
      cc: mode === 'replyall' ? (msg.ccEmail || '').split(',').map((x) => x.trim()).filter(Boolean) : [], bcc: [],
      subject: /^re:/i.test(msg.subject || '') ? msg.subject : `Re: ${msg.subject || ''}`,
      // Include the quoted chain so context isn't lost (was sending fresh before).
      body: quoteBlock(msg), threadId: thread.threadId, inReplyTo: msg.rfcMessageId || undefined,
      from: fromOptions[0]?.value,
    });
  };
  const forward = (msg) => setComposer({
    mode: 'forward', to: [], cc: [], bcc: [],
    subject: /^fwd:/i.test(msg.subject || '') ? msg.subject : `Fwd: ${msg.subject || ''}`,
    body: `<br><br>---------- Forwarded message ----------<br>From: ${msg.fromName || msg.fromEmail}<br>Date: ${new Date(msg.sentAt).toLocaleString()}<br>Subject: ${msg.subject || ''}<br>To: ${msg.toEmail || ''}<br><br>${msg.bodyHtml || msg.snippet || ''}`,
    threadId: thread.threadId, from: fromOptions[0]?.value,
  });

  const latest = messages && messages.length ? messages[messages.length - 1] : null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-[70] p-4 overflow-y-auto">
      <div className="bg-white rounded-xl w-full max-w-4xl my-6 flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        {/* Subject header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <h2 className="text-xl font-normal text-[#202124] pr-4 break-words">{thread.subject || '(no subject)'} <span className="inline-block align-middle ml-1 text-[10px] font-bold bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">Inbox</span></h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none flex-shrink-0">×</button>
        </div>

        {/* Scrollable message list */}
        <div className="px-6 py-4 overflow-y-auto flex-1">
          {err && <div className="mb-3 text-xs text-red-600">{err}</div>}
          {!messages && <div className="text-slate-400 text-sm py-6 text-center">Loading…</div>}
          {messages && messages.length === 0 && <div className="text-slate-400 text-sm py-6 text-center">Couldn’t load the full thread.</div>}
          {messages && messages.map((m, i) => {
            const k = keyOf(m, i);
            const isOpen = !!expanded[k];
            return (
              <div key={k} className={`py-3 ${i > 0 ? 'border-t border-slate-100' : ''}`}>
                {/* Header row: avatar | name+to | right meta */}
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0" style={{ background: m.direction === 'outbound' ? '#FF6A0022' : '#6366F122', color: m.direction === 'outbound' ? '#FF4500' : '#4F46E5' }}>
                    {(m.fromName || m.fromEmail || '?').trim()[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => toggle(k)}>
                    <div className="flex items-start justify-between gap-3">
                      {/* Left: name on top, "to me ▾" below */}
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-[#202124] truncate">{m.fromName || m.fromEmail}</div>
                        {isOpen ? (
                          <button onClick={(e) => { e.stopPropagation(); setShowTo((s) => ({ ...s, [k]: !s[k] })); }} className="text-xs text-slate-400 flex items-center gap-1 hover:text-slate-600">
                            {m.direction === 'outbound' ? 'from me' : 'to me'}
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
                          </button>
                        ) : (
                          <div className="text-xs text-slate-400 truncate">{m.snippet}</div>
                        )}
                        {isOpen && showTo[k] && (
                          <div className="mt-1 text-[11px] text-slate-500 bg-slate-50 rounded-lg px-2.5 py-1.5 inline-block">
                            <div><span className="text-slate-400">from:</span> {m.fromName ? `${m.fromName} <${m.fromEmail}>` : m.fromEmail}</div>
                            <div><span className="text-slate-400">to:</span> {m.toEmail || '—'}</div>
                            {m.ccEmail && <div><span className="text-slate-400">cc:</span> {m.ccEmail}</div>}
                            <div><span className="text-slate-400">date:</span> {new Date(m.sentAt).toLocaleString()}</div>
                          </div>
                        )}
                      </div>
                      {/* Right: date/time, star, reply */}
                      <div className="flex items-center gap-2.5 text-slate-400 flex-shrink-0 pt-0.5">
                        <span className="text-xs whitespace-nowrap">{new Date(m.sentAt).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric' })}, {new Date(m.sentAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} <span className="text-slate-300">({timeAgo(m.sentAt)})</span></span>
                        {m._id && <button onClick={(e) => { e.stopPropagation(); toggleStar(m._id, load); }} title="Star" className="hover:text-amber-400"><svg width="16" height="16" viewBox="0 0 24 24" fill={m.starred ? '#FBBF24' : 'none'} stroke={m.starred ? '#FBBF24' : 'currentColor'} strokeWidth="1.6"><path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.8 5.9 20.4l1.4-6.8L2.2 9l6.9-.7z" /></svg></button>}
                        <button onClick={(e) => { e.stopPropagation(); replyTo(m, 'reply'); }} title="Reply" className="hover:text-slate-600"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 17l-5-5 5-5M4 12h11a5 5 0 0 1 5 5v1" /></svg></button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Body (indented, wrapped, clamped when collapsed) */}
                <div className={`pl-13 mt-2 ${isOpen ? '' : 'hidden'}`} style={{ paddingLeft: '3.25rem' }}>
                  <div className="text-sm text-slate-700 prose prose-sm max-w-none break-words overflow-x-auto pr-2" dangerouslySetInnerHTML={{ __html: m.bodyHtml || `<div style="white-space:pre-wrap">${(m.bodyText || m.snippet || '').replace(/</g, '&lt;')}</div>` }} />
                  {(m.attachments || []).length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-3">
                      {m.attachments.map((a, ai) => {
                        const href = a.url || (a.attachmentId ? `${API_BASE}/api/gmail/email/${m._id}/attachment/${a.attachmentId}` : undefined);
                        const isImg = /^image\//i.test(a.mimeType || '') || /\.(png|jpe?g|gif|webp|svg)$/i.test(a.filename || '');
                        if (isImg && a.url) {
                          return (
                            <a key={ai} href={href} target="_blank" rel="noreferrer" className="block">
                              <img src={a.url} alt={a.filename} className="max-h-40 rounded-lg border border-slate-200 object-cover" />
                            </a>
                          );
                        }
                        return (
                          <a key={ai} href={href} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1.5 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
                            {a.filename}
                          </a>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Sticky action bar */}
        {latest && (
          <div className="flex gap-2 px-6 py-3 border-t border-slate-100 flex-shrink-0 bg-white rounded-b-xl">
            <button onClick={() => replyTo(latest, 'reply')} className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 17l-5-5 5-5M4 12h11a5 5 0 0 1 5 5v1" /></svg> Reply
            </button>
            <button onClick={() => replyTo(latest, 'replyall')} className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M7 17l-5-5 5-5M12 17l-5-5 5-5M9 12h9a4 4 0 0 1 4 4v1" /></svg> Reply all
            </button>
            <button onClick={() => forward(latest)} className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M15 17l5-5-5-5M20 12H9a5 5 0 0 0-5 5v1" /></svg> Forward
            </button>
          </div>
        )}
      </div>

      {composer && <Composer lead={lead} initial={composer} fromOptions={fromOptions} defaultSignature={defaultSignature} onClose={() => setComposer(null)} onSent={() => { setComposer(null); load(); onReload && onReload(); }} />}
    </div>
  );
}

function Composer({ lead, initial, fromOptions, onClose, onSent, defaultSignature }) {
  const [from, setFrom] = useState(initial.from || fromOptions[0]?.value || `user:${fromOptions[0]?.userId}`);
  const [to, setTo] = useState(initial.to || []);
  const [cc, setCc] = useState(initial.cc || []);
  const [bcc, setBcc] = useState(initial.bcc || []);
  const [showCc, setShowCc] = useState((initial.cc || []).length > 0);
  const [showBcc, setShowBcc] = useState((initial.bcc || []).length > 0);
  const [subject, setSubject] = useState(initial.subject || '');
  // On reply/forward, initial.body is the quoted chain; place the default
  // signature above it (below the new message area), Gmail-style.
  const isReplyOrForward = ['reply', 'replyall', 'forward'].includes(initial.mode);
  const [body, setBody] = useState(() => {
    const sig = (initial.from && fromOptions.find((o) => o.value === initial.from)?.signature) || defaultSignature || '';
    if (isReplyOrForward && sig) return `<br><br>${sig}<br>${initial.body || ''}`;
    return initial.body || '';
  });
  const [attachments, setAttachments] = useState([]);
  const [reports, setReports] = useState([]);
  const [showReports, setShowReports] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [schedDate, setSchedDate] = useState('');
  const [schedTime, setSchedTime] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const [showAi, setShowAi] = useState(false);

  // Customer timezone only; fall back to IST when the lead has none.
  const hasCustomerTz = !!lead.timezone;
  const tz = lead.timezone || 'Asia/Kolkata';

  const currentFrom = fromOptions.find((o) => o.value === from) || fromOptions[0];
  const sigFor = () => (currentFrom && currentFrom.signature) || defaultSignature || '';

  useEffect(() => { api(`/gmail/lead/${lead._id || lead.id}/reports`).then(setReports).catch(() => {}); }, []);
  useEffect(() => { api('/gmail/templates').then(setTemplates).catch(() => {}); }, []);
  const applyTemplate = async (tpl) => {
    setShowTemplates(false);
    try {
      const res = await api(`/gmail/templates/${tpl._id}/apply`, { method: 'POST', body: JSON.stringify({ leadId: lead._id || lead.id }) });
      if (res.subject) setSubject(res.subject);
      if (res.body) setBody((b) => (b ? `${b}<br>${res.body}` : res.body));
    } catch (e) { setErr(e.message); }
  };

  const fileInput = useRef(null);
  const onFile = (e) => {
    const files = Array.from(e.target.files || []);
    files.forEach((f) => {
      const reader = new FileReader();
      reader.onload = () => setAttachments((a) => [...a, { filename: f.name, mimeType: f.type || 'application/octet-stream', contentBase64: String(reader.result).split(',')[1] }]);
      reader.readAsDataURL(f);
    });
    e.target.value = '';
  };
  const attachReport = (r) => { setAttachments((a) => [...a, { reportId: r._id || r.id, filename: `${r.businessName || 'report'}.pdf` }]); setShowReports(false); };
  const removeAtt = (i) => setAttachments((a) => a.filter((_, idx) => idx !== i));
  const insertSignature = () => { const sig = sigFor(); if (sig) setBody((b) => `${b || ''}<br><br>${sig}`); };

  const doSend = async (scheduled) => {
    setErr('');
    if (to.length === 0) return setErr('Add at least one recipient.');
    if (!subject.trim()) return setErr('Add a subject.');
    let sendAt;
    if (scheduled) {
      if (!schedDate || !schedTime) return setErr('Pick a date and time to schedule.');
      sendAt = new Date(`${schedDate}T${schedTime}:00`).toISOString();
    }
    setSending(true);
    try {
      await api(`/gmail/lead/${lead._id || lead.id}/send`, { method: 'POST', body: JSON.stringify({
        from, to, cc: cc.join(', '), bcc: bcc.join(', '), subject, body,
        threadId: initial.threadId, inReplyTo: initial.inReplyTo, attachments,
        ...(scheduled ? { sendAt, timezone: tz } : {}),
      }) });
      onSent();
    } catch (e) { setErr(e.message); setSending(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-[80] p-4 overflow-y-auto">
      <div className="bg-white rounded-xl w-full max-w-3xl shadow-2xl my-6 flex flex-col max-h-[88vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#050A1F] text-white rounded-t-xl flex-shrink-0">
          <span className="text-sm font-semibold">{initial.mode === 'forward' ? 'Forward message' : initial.mode === 'replyall' ? 'Reply all' : initial.mode === 'reply' ? 'Reply' : 'New message'}</span>
          <button onClick={onClose} className="text-slate-300 hover:text-white text-lg leading-none">×</button>
        </div>

        <div className="px-5 pt-3 space-y-2 overflow-y-auto flex-1 min-h-0">
          {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{err}</div>}

          {fromOptions.length > 0 && (
            <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
              <span className="text-xs text-slate-400 w-12">From</span>
              <select value={from} onChange={(e) => setFrom(e.target.value)} className="flex-1 text-sm text-slate-700 outline-none bg-transparent">
                {fromOptions.map((o) => <option key={o.value} value={o.value}>{o.name} &lt;{o.email}&gt;{o.self && o.value.startsWith('user') ? ' (you)' : ''}</option>)}
              </select>
            </div>
          )}

          <div className="flex items-start gap-2 border-b border-slate-100 pb-2">
            <span className="text-xs text-slate-400 w-12 pt-1.5">To</span>
            <div className="flex-1"><ChipInput value={to} onChange={setTo} placeholder="Recipients" /></div>
            <div className="flex gap-2 pt-1.5 text-xs font-semibold text-slate-400">
              {!showCc && <button onClick={() => setShowCc(true)} className="hover:text-slate-600">Cc</button>}
              {!showBcc && <button onClick={() => setShowBcc(true)} className="hover:text-slate-600">Bcc</button>}
            </div>
          </div>
          {showCc && <div className="flex items-start gap-2 border-b border-slate-100 pb-2"><span className="text-xs text-slate-400 w-12 pt-1.5">Cc</span><div className="flex-1"><ChipInput value={cc} onChange={setCc} placeholder="Cc" /></div></div>}
          {showBcc && <div className="flex items-start gap-2 border-b border-slate-100 pb-2"><span className="text-xs text-slate-400 w-12 pt-1.5">Bcc</span><div className="flex-1"><ChipInput value={bcc} onChange={setBcc} placeholder="Bcc" /></div></div>}

          <div className="border-b border-slate-100 pb-2">
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="w-full text-sm text-slate-700 outline-none" />
          </div>

          <div className="py-1">
            <MailEditor value={body} onChange={setBody} placeholder="Write your message…" minHeight={200} maxHeight={340}
              onAttach={() => fileInput.current?.click()}
              onAiDraft={() => setShowAi(true)}
              onInsertSignature={insertSignature} />
          </div>

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 pb-2">
              {attachments.map((a, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-600">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
                  {a.filename}{a.reportId ? ' (CRM report)' : ''}
                  <button onClick={() => removeAtt(i)} className="text-slate-400 hover:text-red-500 ml-1">×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Bottom toolbar */}
        <div className="flex items-center gap-2 px-5 py-3 relative flex-shrink-0 border-t border-slate-100 bg-white rounded-b-xl">
          <div className="flex">
            <button onClick={() => doSend(false)} disabled={sending} className="rounded-l-full px-6 py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: '#1A73E8' }}>{sending ? 'Sending…' : 'Send'}</button>
            <button onClick={() => setShowSchedule((v) => !v)} disabled={sending} className="rounded-r-full px-2 py-2.5 text-white border-l border-white/20" style={{ background: '#1A73E8' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
            </button>
          </div>
          <button onClick={() => fileInput.current?.click()} title="Attach file" className="p-2 rounded-full hover:bg-slate-100 text-slate-500">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 12l-9 9a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8" /></svg>
          </button>
          <input ref={fileInput} type="file" multiple className="hidden" onChange={onFile} />
          <div className="relative">
            <button onClick={() => setShowReports((v) => !v)} title="Attach CRM report" className="p-2 rounded-full hover:bg-slate-100 text-slate-500 flex items-center gap-1">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M9 13h6M9 17h6" /></svg>
              <span className="text-[10px] font-bold">CRM</span>
            </button>
            {showReports && (
              <div className="absolute bottom-11 left-0 w-64 bg-white rounded-xl border border-slate-200 shadow-lg py-1.5 z-50">
                <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase">Attach a report</div>
                {reports.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">No reports for this lead.</div>}
                {reports.map((r) => (
                  <button key={r._id || r.id} onClick={() => attachReport(r)} className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50">
                    <div className="font-semibold text-[#050A1F] truncate">{r.businessName || 'Report'}</div>
                    <div className="text-[10px] text-slate-400">{new Date(r.createdAt).toLocaleDateString()}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative">
            <button onClick={() => setShowTemplates((v) => !v)} title="Use a template" className="p-2 rounded-full hover:bg-slate-100 text-slate-500 flex items-center gap-1">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>
              <span className="text-[10px] font-bold">Tpl</span>
            </button>
            {showTemplates && (
              <div className="absolute bottom-11 left-0 w-64 max-h-64 overflow-auto bg-white rounded-xl border border-slate-200 shadow-lg py-1.5 z-50">
                <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase">Insert a template</div>
                {templates.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">No templates yet. Create them in your profile menu → Templates.</div>}
                {templates.map((t) => (
                  <button key={t._id} onClick={() => applyTemplate(t)} className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50">
                    <div className="font-semibold text-[#050A1F] truncate flex items-center gap-1.5">{t.name}{t.isGlobal && <span className="text-[8px] bg-blue-100 text-blue-700 rounded px-1 py-0.5">GLOBAL</span>}</div>
                    {t.subject && <div className="text-[10px] text-slate-400 truncate">{t.subject}</div>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {showSchedule && (
            <div className="absolute bottom-14 left-4 w-80 bg-white rounded-xl border border-slate-200 shadow-xl p-4 z-50">
              <div className="text-sm font-bold text-[#050A1F] mb-1">Schedule send</div>
              <div className="text-[11px] text-slate-400 mb-2">
                {hasCustomerTz ? <>Customer time zone: <span className="font-semibold text-slate-600">{tzLabel(tz)}</span></> : <>No customer time zone on file — using <span className="font-semibold text-slate-600">IST</span>.</>}
              </div>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div><label className="block text-[10px] font-bold text-slate-400 mb-1">Date</label><input type="date" value={schedDate} onChange={(e) => setSchedDate(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" /></div>
                <div><label className="block text-[10px] font-bold text-slate-400 mb-1">Time ({tzShortLabel(tz)})</label><input type="time" value={schedTime} onChange={(e) => setSchedTime(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" /></div>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowSchedule(false)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">Cancel</button>
                <button onClick={() => doSend(true)} disabled={sending} className="rounded-lg px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50" style={{ background: '#1A73E8' }}>Schedule send</button>
              </div>
            </div>
          )}

          <div className="flex-1" />
          <span className="text-[10px] text-slate-400">{hasCustomerTz ? tzLabel(tz) : 'IST'}</span>
          <button onClick={onClose} title="Discard" className="p-2 rounded-full hover:bg-slate-100 text-slate-400">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7" /></svg>
          </button>
        </div>
      </div>

      {showAi && <AiDraftModal lead={lead} onClose={() => setShowAi(false)} onDraft={({ subject: sj, body: bd }) => { if (sj) setSubject(sj); if (bd) setBody((prev) => { const tail = extractQuotedTail(prev); return tail ? `${bd}${tail}` : bd; }); setShowAi(false); }} />}
    </div>
  );
}

// AI draft assistant. CRM-styled popup with modes; sends the lead's full
// context (details, AI brief, email history) to OpenAI and fills subject+body.
function AiDraftModal({ lead, onClose, onDraft }) {
  const [mode, setMode] = useState('technical');
  const [prompt, setPrompt] = useState('');
  const [meetingDate, setMeetingDate] = useState('');
  const [meetingTime, setMeetingTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const MODES = [
    { id: 'technical', label: '1st technical email', desc: 'Detailed, brief-backed intro that builds confidence and asks for a meeting time.', icon: '🔬' },
    { id: 'followup', label: 'Follow-up reminder', desc: 'References their last email and nudges for an update with attention-grabbing points.', icon: '🔁' },
    { id: 'newreminder', label: 'New reminder', desc: 'Write a reminder from your own instruction.', icon: '⏰', needsPrompt: true },
    { id: 'voicemail', label: 'Voicemail follow-up', desc: `“I tried calling you${lead.phone ? ` on ${lead.phone}` : ''} but reached voicemail…”`, icon: '📞' },
    { id: 'meeting', label: 'Ask for a meeting', desc: 'Propose a specific date and time to meet.', icon: '📅', needsMeeting: true },
    { id: 'custom', label: 'Custom', desc: 'Write anything — give the AI your own prompt.', icon: '✍️', needsPrompt: true },
  ];
  const active = MODES.find((m) => m.id === mode);

  const generate = async () => {
    setErr(''); setBusy(true);
    try {
      const payload = { leadId: lead._id || lead.id, mode, prompt };
      if (mode === 'meeting') { payload.meetingDate = meetingDate; payload.meetingTime = meetingTime; payload.timezone = lead.timezone || 'Asia/Kolkata'; }
      const res = await api('/gmail/ai-draft', { method: 'POST', body: JSON.stringify(payload) });
      onDraft({ subject: res.subject, body: res.body });
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-[90] p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-xl my-8 shadow-2xl" onClick={(e) => e.stopPropagation()} style={{ fontFamily: "'Plus Jakarta Sans',system-ui,sans-serif" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 rounded-t-2xl" style={{ background: 'linear-gradient(90deg,#050A1F,#0b1533)' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#FF6A00,#FF4500)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8"><path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15l-1.9-4.1L5.5 9l4.6-1.4z" /><path d="M18 15l.8 2 2 .8-2 .8L18 21l-.8-2-2-.8 2-.8z" /></svg>
            </div>
            <div>
              <div className="text-sm font-extrabold text-white">AI email assistant</div>
              <div className="text-[11px] text-slate-400">Drafts using this lead’s details, AI brief & history</div>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="p-5">
          {err && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{err}</div>}

          {/* Mode grid */}
          <div className="grid grid-cols-2 gap-2 mb-4">
            {MODES.map((m) => (
              <button key={m.id} onClick={() => setMode(m.id)}
                className={`text-left rounded-xl border p-3 transition ${mode === m.id ? 'border-[#FF4500] bg-orange-50/50 ring-1 ring-[#FF4500]/30' : 'border-slate-200 hover:border-slate-300'}`}>
                <div className="flex items-center gap-2 mb-0.5"><span>{m.icon}</span><span className="text-xs font-bold text-[#050A1F]">{m.label}</span></div>
                <div className="text-[10px] text-slate-500 leading-snug">{m.desc}</div>
              </button>
            ))}
          </div>

          {/* Mode-specific inputs */}
          {active?.needsPrompt && (
            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Your instruction</label>
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} placeholder={mode === 'custom' ? 'e.g. Thank them for the call and summarise next steps…' : 'e.g. Remind them the proposal expires Friday…'} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
          )}
          {active?.needsMeeting && (
            <div className="mb-4 grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-semibold text-slate-600 mb-1.5">Meeting date</label><input type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-semibold text-slate-600 mb-1.5">Time ({tzShortLabel(lead.timezone || 'Asia/Kolkata')})</label><input type="time" value={meetingTime} onChange={(e) => setMeetingTime(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></div>
            </div>
          )}

          {/* Context chips */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            <span className="text-[10px] bg-slate-100 text-slate-500 rounded-full px-2 py-0.5">✓ Lead details</span>
            <span className="text-[10px] bg-slate-100 text-slate-500 rounded-full px-2 py-0.5">✓ AI brief (if available)</span>
            <span className="text-[10px] bg-slate-100 text-slate-500 rounded-full px-2 py-0.5">✓ Email history</span>
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
            <button onClick={generate} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50 inline-flex items-center gap-2" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>
              {busy ? 'Drafting…' : 'Generate draft'}
            </button>
          </div>
          <div className="text-[10px] text-slate-400 mt-2 text-center">The draft fills the subject and body — review it before sending.</div>
        </div>
      </div>
    </div>
  );
}

function ChipInput({ value, onChange, placeholder }) {
  const [text, setText] = useState('');
  const commit = () => { const t = text.trim().replace(/,$/, ''); if (t) { onChange([...value, t]); setText(''); } };
  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {value.map((v, i) => (
        <span key={i} className="inline-flex items-center gap-1 bg-orange-50 text-[#050A1F] rounded-full px-2.5 py-1 text-xs font-semibold">
          {v}<button onClick={() => onChange(value.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-red-500">×</button>
        </span>
      ))}
      <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); } if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1)); }} onBlur={commit} placeholder={value.length === 0 ? placeholder : ''} className="flex-1 min-w-[120px] text-sm outline-none py-1" />
    </div>
  );
}

const TZ_CHOICES = ['Asia/Kolkata', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Dubai', 'Asia/Singapore', 'Australia/Sydney'];
function tzLabel(tz) {
  const map = { 'Asia/Kolkata': 'IST (India)', 'America/New_York': 'ET (New York)', 'America/Chicago': 'CT (Chicago)', 'America/Denver': 'MT (Denver)', 'America/Los_Angeles': 'PT (Los Angeles)', 'Europe/London': 'GMT/BST (London)', 'Europe/Berlin': 'CET (Berlin)', 'Asia/Dubai': 'GST (Dubai)', 'Asia/Singapore': 'SGT (Singapore)', 'Australia/Sydney': 'AEST (Sydney)' };
  return map[tz] || tz;
}

function EmailDraftTab({ lead, user, onChange }) {
  const isOwner = lead.ownerId === user.id;
  const isLM = ['leadmanager', 'admin'].includes(user.role);
  // The owner writes drafts; an admin can act on their behalf. (Lead managers
  // only acknowledge — they never draft.)
  const canDraft = isOwner || user.role === 'admin';
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null); // { kind: 'first'|'reminder', edit?: {...} }

  const save = async (path, payload) => {
    setBusy(true);
    try { const u = await api(`/leads/${lead._id}/${path}`, { method: 'PATCH', body: JSON.stringify(payload) }); onChange(u); }
    catch (e) { alert(e.message); }
    setBusy(false);
  };

  // A submitted draft stays editable by its author for a short window (2 hours),
  // as long as the lead manager hasn't already read/received it.
  const EDIT_WINDOW_MS = 2 * 60 * 60 * 1000;
  const withinEditWindow = (at) => at && (Date.now() - new Date(at).getTime()) < EDIT_WINDOW_MS;
  const canEditFirst = canDraft && lead.firstDraft && !lead.firstDraftRead && !lead.firstReplyDoneAt && withinEditWindow(lead.firstDraftAt);
  const canEditReminder = canDraft && lead.reminderDraft && !lead.reminderReceived && withinEditWindow(lead.reminderDraftAt);

  return (
    <div className="space-y-6">
      {/* FIRST REPLY */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-extrabold text-[#050A1F]">First reply</div>
          {canDraft && !lead.firstReplyDoneAt && !lead.firstDraft && (
            <div className="flex gap-2">
              <button disabled={busy} onClick={() => save('first-reply', { mode: 'self', sent: true })}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-slate-300">
                I replied myself
              </button>
              <button onClick={() => setModal({ kind: 'first' })}
                className="rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>
                + Add first reply
              </button>
            </div>
          )}
          {canEditFirst && (
            <button onClick={() => setModal({ kind: 'first', edit: { subject: lead.firstDraftSubject, body: lead.firstDraft } })}
              className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-bold text-[#FF4500] hover:bg-orange-100">
              Edit draft
            </button>
          )}
        </div>

        {lead.firstReplyDoneAt ? (
          <DraftRecord subject={lead.firstDraftSubject} body={lead.firstDraft}
            doneLabel={`Handled ${lead.firstReplyMode === 'self' ? 'by the owner' : 'via the lead manager'}`} doneAt={lead.firstReplyDoneAt} />
        ) : lead.firstDraft ? (
          <SubmittedDraft subject={lead.firstDraftSubject} body={lead.firstDraft} at={lead.firstDraftAt}
            canAck={isLM} ackLabel="Mark as read & sent" busy={busy}
            editHint={canEditFirst ? 'You can still edit this for a short while.' : null}
            onAck={() => save('first-reply', { draftRead: true })} />
        ) : (
          <div className="text-xs text-slate-400">
            {canDraft ? 'No first reply yet. Reply yourself, or add a draft for the lead manager to send.' : 'Waiting on the owner to action the first reply.'}
          </div>
        )}
      </div>

      {/* REMINDER */}
      <div className="pt-4 border-t border-slate-100">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-extrabold text-[#050A1F]">Reminder</div>
          {canDraft && !lead.reminderDraft && (
            <button onClick={() => setModal({ kind: 'reminder' })}
              className="rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>
              + Add reminder
            </button>
          )}
          {canEditReminder && (
            <button onClick={() => setModal({ kind: 'reminder', edit: { subject: lead.reminderSubject, body: lead.reminderDraft } })}
              className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-bold text-[#FF4500] hover:bg-orange-100">
              Edit draft
            </button>
          )}
        </div>

        {lead.reminderReceived ? (
          <DraftRecord subject={lead.reminderSubject} body={lead.reminderDraft} doneLabel="Received & sent" doneAt={lead.reminderReceivedAt} />
        ) : lead.reminderDraft ? (
          <SubmittedDraft subject={lead.reminderSubject} body={lead.reminderDraft} at={lead.reminderDraftAt}
            canAck={isLM} ackLabel="Mark as received & sent" busy={busy}
            editHint={canEditReminder ? 'You can still edit this for a short while.' : null}
            onAck={() => save('reminder-draft', { received: true })} />
        ) : (
          <div className="text-xs text-slate-400">{canDraft ? 'No reminder yet. Add one for the lead manager to send on your behalf.' : 'No reminder submitted yet.'}</div>
        )}
      </div>

      {modal && (
        <DraftModal
          title={modal.kind === 'first' ? 'First reply' : 'Reminder'}
          busy={busy}
          initial={modal.edit || null}
          onClose={() => setModal(null)}
          onSubmit={async (subject, body) => {
            await save(modal.kind === 'first' ? 'first-reply' : 'reminder-draft', { draft: body, subject });
            setModal(null);
          }} />
      )}
    </div>
  );
}

/** A submitted-but-unacknowledged draft, with the LM's acknowledge button. */
function SubmittedDraft({ subject, body, at, canAck, ackLabel, onAck, busy, editHint }) {
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-3">
      <div className="text-xs font-bold text-blue-800 mb-1">📥 Draft submitted · {fmtDate(at)}</div>
      {subject && <div className="text-[13px] font-bold text-slate-700">Subject: {subject}</div>}
      <div className="text-[13px] text-slate-700 mt-1" dangerouslySetInnerHTML={{ __html: body }} />
      {editHint && <div className="text-[11px] text-orange-600 mt-1">{editHint}</div>}
      {canAck ? (
        <button disabled={busy} onClick={onAck}
          className="mt-2 rounded-lg px-3 py-2 text-xs font-bold text-white" style={{ background: 'linear-gradient(90deg,#2563EB,#1D4ED8)' }}>
          {ackLabel}
        </button>
      ) : <div className="text-[11px] text-blue-600 mt-1">Waiting on the lead manager to send it.</div>}
    </div>
  );
}

/** A completed draft record. */
function DraftRecord({ subject, body, doneLabel, doneAt }) {
  return (
    <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2.5">
      <div className="text-xs font-bold text-green-800">✓ {doneLabel} · {fmtDate(doneAt)}</div>
      {subject && <div className="text-[13px] font-bold text-slate-700 mt-1">Subject: {subject}</div>}
      {body && <div className="text-[13px] text-slate-700 mt-0.5" dangerouslySetInnerHTML={{ __html: body }} />}
    </div>
  );
}

/** Popup for composing a draft: subject line + rich-text body. */
function DraftModal({ title, onClose, onSubmit, busy, initial }) {
  const [subject, setSubject] = useState(initial ? (initial.subject || '') : '');
  const [body, setBody] = useState(initial ? (initial.body || '') : '');
  const bodyText = plainText(body);
  const isEdit = !!initial;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="text-base font-extrabold text-[#050A1F] mb-1">{isEdit ? `Edit ${title.toLowerCase()} draft` : `${title} draft`}</div>
        <div className="text-xs text-slate-400 mb-4">Write the email — the lead manager will send it on your behalf.</div>
        <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Subject line</label>
        <input className="w-full mt-1 mb-3 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
          value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject line" />
        <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Email body</label>
        <div className="mt-1">
          <RichText value={body} onChange={setBody} placeholder="Write the email…" minHeight={160} />
        </div>
        <div className="flex gap-2 mt-4">
          <button disabled={busy || !bodyText.trim()} onClick={() => onSubmit(subject, body)}
            className="flex-1 rounded-lg px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"
            style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>
            {busy ? 'Submitting…' : isEdit ? 'Update draft' : 'Submit to lead manager'}
          </button>
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-500">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function FirstReplyPanel({ lead, user, onChange }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const isPresales = /pre-?sales/i.test(String(lead.leadSource || ''));
  if (!isPresales) return null;
  // Back-dated leads are historical imports — the first-reply workflow doesn't
  // apply, so no banner and no clock.
  if (lead.backDated) return null;

  const isOwner = lead.ownerId === user.id;
  const from = lead.assignedAt || lead.createdAt;
  const hours = from ? Math.floor((Date.now() - new Date(from).getTime()) / 3600000) : 0;
  const overdue = !lead.firstReplyDoneAt && hours >= 24;

  const save = async (payload) => {
    setBusy(true);
    try {
      onChange(await api(`/leads/${lead._id}/first-reply`, { method: 'PATCH', body: JSON.stringify(payload) }));
      setDraft('');
    } catch (e) { alert(e.message); }
    setBusy(false);
  };

  // Done: leave a compact record rather than a call to action.
  if (lead.firstReplyDoneAt) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-2.5 mb-4 flex items-center gap-2 flex-wrap">
        <Icon.Check size={14} />
        <span className="text-xs font-bold text-green-800">
          First reply handled {lead.firstReplyMode === 'self' ? 'by the owner' : 'via the lead manager'}
        </span>
        <span className="text-[11px] text-green-600">· {fmtDate(lead.firstReplyDoneAt)}</span>
        {lead.firstDraft && (
          <details className="w-full mt-1">
            <summary className="text-[11px] font-bold text-green-700 cursor-pointer">View the draft that was submitted</summary>
            <div className="mt-1.5 rounded-lg bg-white border border-green-100 p-2.5 text-[13px] text-slate-600 whitespace-pre-wrap">{lead.firstDraft}</div>
          </details>
        )}
      </div>
    );
  }

  // Draft submitted by the owner, but the lead manager hasn't actioned it yet.
  // This is the lead manager's queue: read the draft, send the email, mark read.
  if (lead.firstDraft && !lead.firstReplyDoneAt) {
    const canRead = ['leadmanager', 'admin'].includes(user.role);
    return (
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-blue-800">📥 First-reply draft submitted by {lead.ownerName || 'the owner'}</span>
          <span className="text-[11px] text-blue-600">· {fmtDate(lead.firstDraftAt)}</span>
          {!canRead && <span className="text-[11px] text-blue-500">· waiting on the lead manager to send it</span>}
        </div>
        <div className="mt-2 rounded-lg bg-white border border-blue-100 p-3 text-[14px] text-slate-700 whitespace-pre-wrap">{lead.firstDraft}</div>
        {canRead && (
          <button type="button" disabled={busy} onClick={() => save({ draftRead: true })}
            className="w-full mt-2 rounded-lg px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(90deg,#2563EB,#1D4ED8)' }}>
            {busy ? 'Saving…' : 'Mark as read & first reply sent'}
          </button>
        )}
      </div>
    );
  }

  // Still outstanding: show a compact, dismissible notification. The actual
  // draft entry now lives in the Email Draft tab, so this is just a nudge.
  if (dismissed) return null;
  return (
    <div className={`rounded-xl border px-4 py-2.5 mb-4 flex items-center justify-between gap-3 flex-wrap ${overdue ? 'border-red-300 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-xs font-bold ${overdue ? 'text-red-800' : 'text-amber-800'}`}>
          {overdue ? '⚠️ First reply is overdue' : 'First reply needed'}
        </span>
        <span className={`text-[11px] ${overdue ? 'text-red-600' : 'text-amber-700'}`}>
          {overdue
            ? `Assigned ${hours} hours ago — past the 24-hour rule.`
            : `Assigned ${hours} hour${hours === 1 ? '' : 's'} ago · ${Math.max(0, 24 - hours)}h left.`}
        </span>
        <span className="text-[11px] text-slate-500">Use the <b>Email draft</b> tab to respond.</span>
        {lead.reminderRequestedAt && (
          <span className="rounded-md bg-white border border-red-200 px-2 py-1 text-[10px] font-bold text-red-600">
            Draft requested by {lead.reminderRequestedBy}
          </span>
        )}
      </div>
      <button type="button" onClick={() => setDismissed(true)} title="Dismiss for now"
        className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-white/60 text-sm font-bold">✕</button>
    </div>
  );
}

/** Traffic-light colour for a 0-100 score, matching the audit report palette. */
const scoreColor = (n) => (n >= 80 ? '#16A34A' : n >= 50 ? '#F59E0B' : '#DC2626');

/**
 * AI business brief — what this prospect sells, how they're positioned, and
 * what to pitch. Cached server-side; a refresh is offered once it's a week old.
 */
function AiBriefModal({ lead, onClose }) {
  const [state, setState] = useState({ loading: true });
  const [refreshing, setRefreshing] = useState(false);

  const load = async (force) => {
    force ? setRefreshing(true) : setState({ loading: true });
    try {
      const r = force
        ? await api(`/leads/${lead._id}/brief/refresh`, { method: 'POST' })
        : await api(`/leads/${lead._id}/brief`);
      setState({ loading: false, ...r });
    } catch (e) {
      setState({ loading: false, error: e.message });
    }
    setRefreshing(false);
  };
  useEffect(() => { load(false); /* eslint-disable-next-line */ }, [lead._id]);

  const b = state.brief;
  const PRIORITY = { high: 'bg-green-100 text-green-700', medium: 'bg-amber-100 text-amber-700', low: 'bg-slate-100 text-slate-500' };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-base font-extrabold text-[#050A1F] flex items-center gap-2">
              <Icon.Sparkle size={16} /> Business brief
            </div>
            <div className="text-xs text-slate-400">{lead.website || 'No website on file'}</div>
          </div>
          <div className="flex items-center gap-2">
            {b && (
              <button onClick={() => load(true)} disabled={refreshing}
                title={state.stale ? 'This brief is over a week old' : 'Re-analyse the website now'}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50 ${
                  state.stale ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}>
                <Icon.Refresh size={13} /> {refreshing ? 'Analysing…' : 'Refresh'}
              </button>
            )}
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
          </div>
        </div>

        <div className="px-6 py-5">
          {state.loading && (
            <div className="text-center py-16">
              <div className="text-sm font-bold text-slate-500">Reading the website…</div>
              <div className="text-xs text-slate-400 mt-1">This takes a few seconds the first time.</div>
            </div>
          )}

          {state.error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{state.error}</div>
          )}

          {b && (
            <div className="space-y-5">
              {state.stale && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] font-semibold text-amber-700">
                  This brief is more than {state.cacheDays} days old. Refresh if the site may have changed.
                </div>
              )}

              <div>
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">What they do</div>
                <p className="text-slate-700 leading-relaxed" style={{ fontSize: '15px' }}>{b.summary}</p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {b.industry && <span className="rounded px-2 py-0.5 text-[11px] font-bold bg-slate-100 text-slate-600">{b.industry}</span>}
                  {b.targetArea && <span className="rounded px-2 py-0.5 text-[11px] font-bold bg-blue-50 text-blue-600">📍 {b.targetArea}</span>}
                </div>
              </div>

              {/* AI-search readiness and raw speed — the two numbers an agent is
                  most often asked to justify on a call. */}
              <div className="grid sm:grid-cols-3 gap-3">
                {b.aiSeoScore != null && (
                  <div className="rounded-xl border border-slate-200 p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">AI SEO score</div>
                    <div className="flex items-baseline gap-1 mt-0.5">
                      <span className="text-3xl font-extrabold" style={{ color: scoreColor(b.aiSeoScore * 10) }}>{b.aiSeoScore}</span>
                      <span className="text-sm font-bold text-slate-300">/ 10</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden mt-1.5">
                      <div className="h-full rounded-full" style={{ width: `${b.aiSeoScore * 10}%`, background: scoreColor(b.aiSeoScore * 10) }} />
                    </div>
                  </div>
                )}
                {['mobile', 'desktop'].map((k) => {
                  const s = b.speed && b.speed[k];
                  return (
                    <div key={k} className="rounded-xl border border-slate-200 p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{k} speed</div>
                      {s ? (
                        <>
                          <div className="flex items-baseline gap-1 mt-0.5">
                            <span className="text-3xl font-extrabold" style={{ color: scoreColor(s.performance) }}>{s.performance}</span>
                            <span className="text-sm font-bold text-slate-300">/ 100</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden mt-1.5">
                            <div className="h-full rounded-full" style={{ width: `${Math.max(2, s.performance)}%`, background: scoreColor(s.performance) }} />
                          </div>
                          <div className="text-[10px] text-slate-400 mt-1">SEO {s.seo} · A11y {s.accessibility}</div>
                        </>
                      ) : (
                        <div className="text-xs text-slate-300 mt-2">Not available</div>
                      )}
                    </div>
                  );
                })}
              </div>

              {b.aiSeoReason && (
                <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Why that AI SEO score</div>
                  <p className="text-slate-600" style={{ fontSize: '14px' }}>{b.aiSeoReason}</p>
                  {(b.aiSeoBreakdown || []).length > 0 && (
                    <div className="mt-2 space-y-1">
                      {b.aiSeoBreakdown.map((f, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-[11px] font-bold text-slate-500 w-36 shrink-0 truncate" title={f.factor}>{f.factor}</span>
                          <div className="h-1.5 rounded-full bg-slate-200 flex-1 overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${f.score * 10}%`, background: scoreColor(f.score * 10) }} />
                          </div>
                          <span className="text-[11px] font-bold text-slate-400 w-8 text-right">{f.score}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Code-verified checks, kept visually distinct from AI opinion. */}
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Site checks</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    ['NAP complete', b.checks.nap.complete, b.checks.nap.complete ? 'Name, address, phone all present' : 'Missing address or phone'],
                    ['Social links', b.checks.social.count > 0, b.checks.social.count ? Object.keys(b.checks.social.links).join(', ') : 'None found'],
                    ['Blog', b.checks.hasBlog, b.checks.hasBlog ? 'Publishing content' : 'No blog found'],
                    ['HTTPS', b.checks.hasSsl, b.checks.hasSsl ? 'Secure' : 'Not secure'],
                  ].map(([label, good, hint]) => (
                    <div key={label} className={`rounded-lg border p-2.5 ${good ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                      <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
                      <div className={`text-xs font-extrabold ${good ? 'text-green-700' : 'text-red-700'}`}>{good ? 'Yes' : 'No'}</div>
                      <div className="text-[10px] text-slate-400 truncate" title={hint}>{hint}</div>
                    </div>
                  ))}
                </div>
                {(b.checks.nap.phone || b.checks.nap.address) && (
                  <div className="text-[11px] text-slate-500 mt-2">
                    {b.checks.nap.phone && <>☎ {b.checks.nap.phone} </>}
                    {b.checks.nap.address && <>· {b.checks.nap.address}</>}
                  </div>
                )}
              </div>

              {b.offerings.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Products &amp; services</div>
                  <div className="flex flex-wrap gap-1.5">
                    {b.offerings.map((o, i) => <span key={i} className="rounded-md bg-slate-100 px-2 py-1 text-[12px] font-semibold text-slate-600">{o}</span>)}
                  </div>
                </div>
              )}

              {(b.targetAudience || b.marketPosition) && (
                <div className="grid sm:grid-cols-2 gap-3">
                  {b.targetAudience && (
                    <div className="rounded-lg bg-slate-50 p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Their customers</div>
                      <p className="text-slate-600" style={{ fontSize: '14px' }}>{b.targetAudience}</p>
                    </div>
                  )}
                  {b.marketPosition && (
                    <div className="rounded-lg bg-slate-50 p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Market position</div>
                      <p className="text-slate-600" style={{ fontSize: '14px' }}>{b.marketPosition}</p>
                    </div>
                  )}
                </div>
              )}

              {b.keywords.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Keywords their customers search</div>
                  <div className="flex flex-wrap gap-1.5">
                    {b.keywords.map((k, i) => <span key={i} className="rounded-md bg-orange-50 px-2 py-1 text-[12px] font-semibold text-[#FF4500]">{k}</span>)}
                  </div>
                </div>
              )}

              {b.painPoints.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Pain points to raise on the call</div>
                  <div className="space-y-2">
                    {b.painPoints.map((p, i) => (
                      <div key={i} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                        <div className="font-bold text-amber-900" style={{ fontSize: '14px' }}>{p.issue}</div>
                        <div className="text-amber-800 mt-0.5" style={{ fontSize: '13px' }}>{p.why}</div>
                        {p.mention && <div className="text-amber-700 mt-1 italic" style={{ fontSize: '13px' }}>“{p.mention}”</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {b.servicesToPitch.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">What to pitch</div>
                  <div className="space-y-1.5">
                    {b.servicesToPitch.map((s, i) => (
                      <div key={i} className="flex items-start gap-2 rounded-lg border border-slate-100 p-2.5">
                        <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase shrink-0 ${PRIORITY[s.priority] || PRIORITY.low}`}>{s.priority || 'low'}</span>
                        <div className="min-w-0">
                          <div className="font-bold text-[#050A1F]" style={{ fontSize: '14px' }}>{s.service}</div>
                          <div className="text-slate-500" style={{ fontSize: '13px' }}>{s.why}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {b.conversationStarters.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Opening lines</div>
                  <div className="space-y-1.5">
                    {b.conversationStarters.map((c, i) => (
                      <div key={i} className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-blue-800 italic" style={{ fontSize: '13px' }}>“{c}”</div>
                    ))}
                  </div>
                </div>
              )}

              <div className="text-[10px] text-slate-400 pt-2 border-t border-slate-100">
                Generated {fmtDate(b.generatedAt)} · AI-assisted from the homepage. Verify anything you plan to quote.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Timeline({ lead }) {
  const raw = Array.isArray(lead.timeline) ? lead.timeline : [];
  if (!raw.length) return <div className="text-slate-300 text-sm py-16 text-center">No activity yet.</div>;
  const icons = { created: '✨', status: '🏷️', owner: '👤', note: '📝', task: '✅', call: '📞', deal: '💰', report: '📄', email: '✉️' };

  // An activity counts as missed once it is more than an hour past the agreed
  // time and still isn't done. We check the live activity list rather than the
  // timeline entry, so completing a call clears the flag immediately.
  const acts = Array.isArray(lead.activities) ? lead.activities : [];
  const GRACE = 60 * 60 * 1000;
  const now = Date.now();
  const missState = (e) => {
    // An entry is a candidate for the red "missed" highlight if it references a
    // scheduled activity. We tolerate older entries that lack the `scheduled`
    // flag by falling back to the linked activity's own mode.
    if (!e.activityId) return null;
    const a = acts.find((x) => x.id === e.activityId);
    if (!a) return null;
    if (a.mode === 'done' && a.status === 'done' && !a.completedLate) return null;
    const dueAt = a.kind === 'call'
      ? (a.date ? `${a.date}T${a.time || '09:00'}` : '')
      : (a.dueDate ? `${a.dueDate}T17:00` : '');
    if (!dueAt) return null;
    const due = new Date(dueAt).getTime();
    if (Number.isNaN(due)) return null;
    if (a.status === 'done') return a.completedLate ? { late: true } : null;
    if (now > due + GRACE) return { overdue: true, hours: Math.round((now - due) / 3600000) };
    return null;
  };

  const tl = [...raw].reverse();
  return (
    <div className="space-y-2">
      {tl.map((e, i) => {
        const miss = missState(e);
        const isNote = e.type === 'note';
        return (
          <div key={i}
            className={`flex gap-3 rounded-lg px-3 py-2 ${
              miss ? 'bg-red-50 border border-red-200' : 'border border-transparent'
            }`}>
            <div className="text-lg leading-none mt-0.5">{e.type === 'email' && e.direction === 'open' ? '📖' : e.type === 'email' && e.direction === 'unopened' ? '📭' : (icons[e.type] || '•')}</div>
            <div className="min-w-0 flex-1">
              {/* Notes show what was actually written, not a generic label. */}
              <div className={`text-sm whitespace-pre-wrap break-words ${miss ? 'text-red-800' : 'text-slate-700'}`}>
                {isNote && <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mr-1.5">Note</span>}
                {e.text}
              </div>
              {/* Call agenda or task description, when the entry carries one. */}
              {!isNote && e.body && plainText(e.body) && (
                <div className="text-[11px] text-slate-500 mt-0.5 whitespace-pre-wrap">{plainText(e.body)}</div>
              )}
              <div className={`text-[11px] mt-0.5 ${miss ? 'text-red-600 font-semibold' : 'text-slate-400'}`}>
                {e.author || '—'} · {fmtDate(e.time)}
                {miss && miss.overdue && ` · MISSED — ${miss.hours}h past the agreed time, still not completed`}
                {miss && miss.late && ' · completed late'}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Strip tags to check whether rich-text content is actually empty.
const plainText = (html) => String(html || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

// ---- Notes tab -------------------------------------------------------------
function NotesTab({ lead, onChange }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const notes = Array.isArray(lead.notes) ? [...lead.notes].reverse() : [];
  const add = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const updated = await api(`/leads/${lead._id}/notes`, { method: 'POST', body: JSON.stringify({ text }) });
      onChange(updated); setText('');
    } catch (e) { alert(e.message); }
    setBusy(false);
  };
  return (
    <div>
      <div className="mb-4">
        <RichText value={text} onChange={setText} placeholder="Add a note…" minHeight={90} />
        <div className="flex justify-end mt-2">
          <button onClick={add} disabled={busy || !plainText(text)} className="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-40" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>Add note</button>
        </div>
      </div>
      {notes.length === 0 ? <div className="text-slate-300 text-sm py-12 text-center">No notes yet.</div> : (
        <div className="space-y-2">
          {notes.map((n) => (
            <div key={n.id} className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
              <div className="text-sm text-slate-700 rich-text" dangerouslySetInnerHTML={{ __html: n.text || '' }} />
              <div className="text-[10px] text-slate-400 mt-1">{n.author} · {fmtDate(n.time)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Activity tab (tasks + calls) -----------------------------------------
function ActivityTab({ lead, config, user, onChange }) {
  const [modal, setModal] = useState(null); // 'task' | 'call' | null
  const [editAct, setEditAct] = useState(null); // activity being edited
  const [delAct, setDelAct] = useState(null); // activity pending delete confirm
  const acts = Array.isArray(lead.activities) ? [...lead.activities] : [];
  // Sort: open first (by due/scheduled date asc), then done.
  const dueVal = (a) => a.kind === 'task' ? a.dueDate : (a.date ? `${a.date}T${a.time || '00:00'}` : '');
  const open = acts.filter((a) => a.status !== 'done').sort((x, y) => (dueVal(x) || '').localeCompare(dueVal(y) || ''));
  const done = acts.filter((a) => a.status === 'done');

  const toggle = async (act) => {
    try {
      const updated = await api(`/leads/${lead._id}/activities/${act.id}`, { method: 'PATCH', body: JSON.stringify({ status: act.status === 'done' ? 'open' : 'done' }) });
      onChange(updated);
    } catch (e) { alert(e.message); }
  };

  // A user may edit/delete an activity they created; an admin may manage any.
  const canManage = (a) => user.role === 'admin' || (a.createdBy && a.createdBy === user.name);
  const doDelete = async () => {
    if (!delAct) return;
    try {
      const updated = await api(`/leads/${lead._id}/activities/${delAct.id}`, { method: 'DELETE' });
      onChange(updated); setDelAct(null);
    } catch (e) { alert(e.message); setDelAct(null); }
  };

  const overdue = (a) => {
    const d = dueVal(a);
    return a.status !== 'done' && d && new Date(d) < new Date();
  };
  const dueToday = (a) => {
    const d = dueVal(a);
    if (!d || a.status === 'done') return false;
    const dd = new Date(d), now = new Date();
    return dd.toDateString() === now.toDateString();
  };

  const Card = ({ a }) => (
    <div className={`rounded-lg border px-3 py-2.5 flex items-start gap-3 ${overdue(a) ? 'border-red-200 bg-red-50' : dueToday(a) ? 'border-amber-200 bg-amber-50' : 'border-slate-100 bg-white'}`}>
      <button onClick={() => toggle(a)} title={a.status === 'done' ? 'Reopen' : 'Mark done'}
        className={`mt-0.5 h-4 w-4 rounded border shrink-0 flex items-center justify-center leading-none ${a.status === 'done' ? 'bg-green-500 border-green-500 text-white' : 'border-slate-300 bg-white hover:border-green-400'}`}>
        {a.status === 'done' && (
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {/* Kind icon lives here; the checkbox is the ONLY tick, so a completed
              task no longer shows two of them. */}
          <span className="text-sm">{a.kind === 'call' ? '📞' : '📋'}</span>
          <span className={`text-sm font-semibold ${a.status === 'done' ? 'line-through text-slate-400' : 'text-slate-700'}`}>{a.title}</span>
          {a.kind === 'task' && a.priority && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${a.priority === 'Urgent' ? 'bg-red-100 text-red-600' : a.priority === 'High' ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-500'}`}>{a.priority}</span>}
          {a.status === 'done' && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-700">DONE</span>}
          {a.status !== 'done' && overdue(a) && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-600">OVERDUE</span>}
          {a.status !== 'done' && dueToday(a) && !overdue(a) && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">TODAY</span>}
        </div>
        {a.kind === 'task' && a.description && <div className="text-xs text-slate-500 mt-1">{a.description}</div>}
        <div className="text-[10px] text-slate-400 mt-1">
          {a.kind === 'call'
            ? <>
                {a.mode === 'done' ? 'Logged' : 'Scheduled'}
                {a.date ? ` · ${a.date}${a.time ? ' ' + a.time : ''}` : ''}
                {a.timezone ? ` ${tzShortLabel(a.timezone)}` : ''}
                {/* Show the IST equivalent so the team knows their own time. */}
                {(() => {
                  const ist = a.date && a.time && a.timezone ? toIST(a.date, a.time, a.timezone) : null;
                  return ist ? <span className="font-semibold text-slate-500"> · {ist.time} IST{ist.dayShift}</span> : null;
                })()}
                {a.durationMin ? ` · ${a.durationMin} min` : ''}
                {a.reminder && a.reminder.on ? ' · 🔔 reminder' : ''}
              </>
            : <>{a.dueDate ? `Due ${a.dueDate}` : 'No due date'}</>}
          <span className="ml-1">· {a.createdBy}</span>
        </div>
      </div>
      {canManage(a) && (
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setEditAct(a)} title="Edit"
            className="w-6 h-6 flex items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button onClick={() => setDelAct(a)} title="Delete"
            className="w-6 h-6 flex items-center justify-center rounded-md text-slate-400 hover:bg-red-100 hover:text-red-600">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <button onClick={() => setModal('task')} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-slate-400">✅ Add task</button>
        <button onClick={() => setModal('call')} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-slate-400">📞 Add call</button>
      </div>

      {acts.length === 0 ? <div className="text-slate-300 text-sm py-12 text-center">No tasks or calls yet.</div> : (
        <div className="space-y-4">
          {open.length > 0 && <div className="space-y-2">{open.map((a) => <Card key={a.id} a={a} />)}</div>}
          {done.length > 0 && <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2 mt-4">Completed</div>
            <div className="space-y-2">{done.map((a) => <Card key={a.id} a={a} />)}</div>
          </div>}
        </div>
      )}

      {modal && <ActivityModal kind={modal} lead={lead} config={config} onClose={() => setModal(null)} onSaved={(u) => { onChange(u); setModal(null); }} />}
      {editAct && <ActivityModal kind={editAct.kind} edit={editAct} lead={lead} config={config} onClose={() => setEditAct(null)} onSaved={(u) => { onChange(u); setEditAct(null); }} />}
      {delAct && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[80] p-4" onClick={() => setDelAct(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="1.8"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>
              </div>
              <div>
                <div className="text-base font-extrabold text-[#050A1F]">Delete this {delAct.kind === 'call' ? 'call' : 'task'}?</div>
                <div className="text-xs text-slate-500">This can't be undone.</div>
              </div>
            </div>
            <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 mb-4 text-xs font-bold text-[#050A1F] truncate">{delAct.title}</div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDelAct(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={doDelete} className="rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ background: '#DC2626' }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ActivityModal({ kind, lead, config, onClose, onSaved, edit }) {
  const isCall = kind === 'call';
  const [f, setF] = useState({
    mode: edit ? (edit.mode === 'done' ? 'done' : 'scheduled') : 'scheduled',
    agenda: edit?.agenda || '', title: edit?.title || '', date: edit?.date || '', time: edit?.time || '',
    timezone: edit?.timezone || lead.timezone || '',
    description: edit?.description || '', priority: edit?.priority || 'Medium', dueDate: edit?.dueDate || '',
    reminderOn: edit?.reminder?.on || false, durationMin: edit?.durationMin || '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const inp = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400';
  const lab = 'block text-[11px] font-bold text-slate-500 mb-1';

  const save = async () => {
    setBusy(true);
    try {
      const body = isCall
        ? { kind: 'call', mode: f.mode, agenda: f.agenda, date: f.date, time: f.time, timezone: f.timezone, durationMin: f.mode === 'done' ? Number(f.durationMin) || 0 : undefined, reminder: { on: f.mode === 'scheduled' && f.reminderOn, at: `${f.date}T${f.time || '09:00'}` } }
        : { kind: 'task', mode: f.mode, title: f.title, dueDate: f.dueDate, description: f.description, priority: f.priority };
      // Editing an existing activity → PATCH; otherwise create → POST.
      const updated = edit
        ? await api(`/leads/${lead._id}/activities/${edit.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : await api(`/leads/${lead._id}/activities`, { method: 'POST', body: JSON.stringify(body) });
      onSaved(updated);
    } catch (e) { alert(e.message); }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-[#050A1F] mb-4">{edit ? (isCall ? '📞 Edit call' : '✅ Edit task') : (isCall ? '📞 Add call' : '✅ Add task')}</h3>

        <div className="flex gap-2 mb-4">
          {['scheduled', 'done'].map((m) => (
            <button key={m} onClick={() => set('mode', m)} className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-bold border capitalize ${f.mode === m ? 'bg-[#050A1F] text-white border-transparent' : 'text-slate-500 border-slate-200'}`}>{m}</button>
          ))}
        </div>

        {isCall ? (
          <div className="space-y-3">
            <div><label className={lab}>Call agenda</label><input className={inp} value={f.agenda} onChange={(e) => set('agenda', e.target.value)} placeholder="What's the call about?" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lab}>Date{lead.timezone ? ' (customer local)' : ''}</label><input type="date" className={inp} value={f.date} onChange={(e) => set('date', e.target.value)} /></div>
              <div><label className={lab}>Time{lead.timezone ? ` (${tzShortLabel(lead.timezone)})` : ''}</label><input type="time" className={inp} value={f.time} onChange={(e) => set('time', e.target.value)} /></div>
            </div>
            {/* The agent enters the CUSTOMER's local time; we show the IST
                equivalent underneath so they know when to actually be at their
                desk. Timezone comes from the lead — never re-entered. */}
            {lead.timezone && (
              <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 -mt-1">
                <div className="text-[11px] text-slate-400">🌐 Customer time zone: <span className="font-semibold text-slate-500">{lead.timezone}</span></div>
                {(() => {
                  const ist = toIST(f.date, f.time, lead.timezone);
                  if (!ist) return <div className="text-[11px] text-slate-300 mt-0.5">Pick a date and time to see the IST equivalent.</div>;
                  return (
                    <div className="text-sm font-bold text-[#050A1F] mt-1">
                      ⏰ Your time: {ist.time} IST
                      <span className="font-normal text-slate-400 text-[11px] ml-1.5">{ist.date}{ist.dayShift}</span>
                    </div>
                  );
                })()}
              </div>
            )}
            {f.mode === 'done' && (
              <div><label className={lab}>How long did the call last? (minutes)</label><input type="number" min="0" className={inp} value={f.durationMin} onChange={(e) => set('durationMin', e.target.value)} placeholder="e.g. 15" /></div>
            )}
            {f.mode === 'scheduled' && (
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={f.reminderOn} onChange={(e) => set('reminderOn', e.target.checked)} /> 🔔 Remind me (in-app)
              </label>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div><label className={lab}>Task name</label><input className={inp} value={f.title} onChange={(e) => set('title', e.target.value)} /></div>
            <div><label className={lab}>Due date</label><input type="date" className={inp} value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} /></div>
            <div><label className={lab}>Description</label><textarea rows={2} className={inp} value={f.description} onChange={(e) => set('description', e.target.value)} /></div>
            <div>
              <label className={lab}>Priority</label>
              <select className={inp} value={f.priority} onChange={(e) => set('priority', e.target.value)}>
                {(config.taskPriorities || ['Low', 'Medium', 'High', 'Urgent']).map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg px-6 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

function EditLeadModal({ user, config, draft, setDraft, section = 'all', onSave, onClose }) {
  const set = (k, v) => setDraft((s) => ({ ...s, [k]: v }));
  const toggleArr = (k, v) => setDraft((s) => ({ ...s, [k]: (s[k] || []).includes(v) ? s[k].filter((x) => x !== v) : [...(s[k] || []), v] }));
  const inp = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400';
  const lab = 'block text-[11px] font-bold text-slate-500 mb-1';
  const show = (s) => section === 'all' || section === s;
  const titles = { all: 'Edit lead', basic: 'Edit basic info', tags: 'Edit tags', description: 'Edit description', other: 'Edit other info', status: 'Change lead status', services: 'Services interested in' };

  // Admins and lead managers can reassign the owner. Load the assignable list
  // (agents and managers only — the config endpoint already excludes lead
  // managers and admins).
  const canReassign = ['admin', 'leadmanager', 'manager'].includes(user.role);
  const [owners, setOwners] = useState([]);
  useEffect(() => {
    if (!canReassign) return;
    api('/leads/config').then((r) => setOwners(r.owners || [])).catch(() => {});
  }, [canReassign]);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-2xl max-h-[88vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-[#050A1F] mb-4">{titles[section] || 'Edit lead'}</h3>

        {show('services') && (
          <div className="mb-4">
            <label className={lab}>Services interested in</label>
            <MultiSelectCombobox className={inp} options={config.servicesInterested || []} values={draft.servicesInterested || []}
              onChange={(v) => set('servicesInterested', v)} placeholder="Type to search services…" />
          </div>
        )}

        {show('status') && (
          <div className="mb-4">
            <label className={lab}>Lead status</label>
            <div className="flex flex-wrap gap-1.5">
              {(config.leadStatuses || []).map((s) => (
                <button key={s.id} type="button" onClick={() => set('status', s.id)}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-bold border ${draft.status === s.id ? 'text-white border-transparent' : 'text-slate-500 border-slate-200'}`}
                  style={draft.status === s.id ? { background: s.color } : {}}>{s.label}</button>
              ))}
            </div>
          </div>
        )}

        {show('basic') && (
          <div className="grid grid-cols-2 gap-4 mb-4">
            {section === 'all' && <div><label className={lab}>First name</label><input className={inp} value={draft.firstName || ''} onChange={(e) => set('firstName', e.target.value)} /></div>}
            {section === 'all' && <div><label className={lab}>Last name</label><input className={inp} value={draft.lastName || ''} onChange={(e) => set('lastName', e.target.value)} /></div>}
            <div><label className={lab}>Email</label><input className={inp} value={draft.email || ''} onChange={(e) => set('email', e.target.value)} /></div>
            <div><label className={lab}>Mobile</label><PhoneField className={inp} value={draft.mobile || ''} country={draft.country} onChange={(v) => set('mobile', v)} /></div>
            <div><label className={lab}>Phone</label><PhoneField className={inp} value={draft.phone || ''} country={draft.country} onChange={(v) => set('phone', v)} /></div>
            <div><label className={lab}>Country</label><CountryCombobox className={inp} value={draft.country || ''} onChange={(v) => { const z = COUNTRY_TIMEZONES[v]; set('country', v); if (z && z.length === 1) set('timezone', z[0]); if (draft.mobile) set('mobile', formatPhone(draft.mobile, v)); if (draft.phone) set('phone', formatPhone(draft.phone, v)); }} /></div>
            <div><label className={lab}>City</label><input className={inp} value={draft.city || ''} onChange={(e) => set('city', e.target.value)} /></div>
            <div><label className={lab}>Time zone</label><TimezoneField className={inp} country={draft.country} value={draft.timezone} onChange={(v) => set('timezone', v)} /></div>
          </div>
        )}

        {show('tags') && (
          <div className="mb-4">
            <label className={lab}>Tags</label>
            <div className="flex flex-wrap gap-1.5">
              {/* Union of configured tags and any tags already on the lead — so
                  legacy tags no longer in the config can still be de-selected. */}
              {Array.from(new Set([...(config.tags || []), ...(draft.tags || [])])).map((t) => {
                const on = (draft.tags || []).includes(t);
                const legacy = !(config.tags || []).includes(t);
                return (
                  <button key={t} type="button" onClick={() => toggleArr('tags', t)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold border ${on ? 'bg-[#FF6A00] text-white border-transparent' : 'text-slate-500 border-slate-200'}`}>
                    {t}{legacy && on ? ' ✕' : ''}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {show('description') && (
          <div className="mb-4">
            <label className={lab}>Description</label>
            <RichText value={draft.additionalInfo || ''} onChange={(v) => set('additionalInfo', v)} placeholder="Anything useful about this lead…" minHeight={130} />
          </div>
        )}

        {show('other') && (
          <div className="grid grid-cols-2 gap-4 mb-4">
            {canReassign && (
              <div className="col-span-2">
                <label className={lab}>Lead owner</label>
                <select className={inp} value={draft.ownerId || ''} onChange={(e) => set('ownerId', e.target.value ? Number(e.target.value) : draft.ownerId)}>
                  {/* Current owner shown even if not in the assignable list (e.g.
                      an inactive user), so the value always resolves. */}
                  {!owners.some((o) => o.id === draft.ownerId) && draft.ownerId && (
                    <option value={draft.ownerId}>{draft.ownerName || 'Current owner'}</option>
                  )}
                  {owners.map((o) => <option key={o.id} value={o.id}>{o.name}{o.role !== 'agent' ? ` (${o.role})` : ''}</option>)}
                </select>
              </div>
            )}
            <div><label className={lab}>Website</label><WebsiteField value={draft.website || ''} onChange={(v) => set('website', v)} /></div>
            <div><label className={lab}>Secondary email</label><input className={inp} value={draft.secondaryEmail || ''} onChange={(e) => set('secondaryEmail', e.target.value)} /></div>
            {!(/pre-?sales/i.test(String(draft.leadSource || '')) && ['manager', 'agent'].includes(user.role)) && (
              <div>
                <label className={lab}>Generated by</label>
                <input className={inp} value={draft.generatedBy || ''} onChange={(e) => set('generatedBy', e.target.value)} />
              </div>
            )}
            <div>
              <label className={lab}>Lead source</label>
              <select className={inp} value={draft.leadSource || ''} onChange={(e) => set('leadSource', e.target.value)}>
                <option value="">— Select —</option>
                {(config.leadSources || []).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={lab}>Lead status</label>
              <select className={inp} value={draft.status || 'new'} onChange={(e) => set('status', e.target.value)}>
                {(config.leadStatuses || []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className={lab}>Services interested in</label>
              <MultiSelectCombobox className={inp} options={config.servicesInterested || []} values={draft.servicesInterested || []}
                onChange={(v) => set('servicesInterested', v)} placeholder="Type to search services…" />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={onSave} className="rounded-lg bg-[#050A1F] px-6 py-2 text-sm font-bold text-white">Save changes</button>
        </div>
      </div>
    </div>
  );
}

// ---- Deals tab -------------------------------------------------------------
function DealsTab({ lead, config, user, onChange }) {
  const [modal, setModal] = useState(null); // null | 'new' | deal object
  const [busyInst, setBusyInst] = useState(null);
  const deals = Array.isArray(lead.deals) ? lead.deals : [];
  const stageMeta = (id) => (config.dealStages || []).find((s) => s.id === id) || { id, label: id, color: '#64748B' };

  // Mark an installment paid/unpaid straight from the list — no need to open
  // the deal. This is what feeds collected sales on the dashboard.
  const isAdmin = user && user.role === 'admin';
  // Which installment is awaiting gateway + reference before being confirmed.
  const [payFor, setPayFor] = useState(null); // { deal, inst }
  const [payGateway, setPayGateway] = useState('');
  const [payRef, setPayRef] = useState('');

  const togglePaid = async (deal, inst, e) => {
    e.stopPropagation();
    // Un-marking needs no extra detail; marking paid collects gateway + ref.
    if (!inst.paid) {
      setPayGateway(''); setPayRef('');
      setPayFor({ deal, inst });
      return;
    }
    setBusyInst(inst.id);
    try {
      const u = await api(`/leads/${lead._id}/deals/${deal.id}/installments/${inst.id}`, {
        method: 'PATCH', body: JSON.stringify({ paid: false }),
      });
      onChange(u);
    } catch (err) { alert(err.message); }
    setBusyInst(null);
  };

  const confirmPaid = async () => {
    const { deal, inst } = payFor;
    setBusyInst(inst.id);
    try {
      const u = await api(`/leads/${lead._id}/deals/${deal.id}/installments/${inst.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ paid: true, gateway: payGateway, ...(payRef ? { transactionId: payRef } : {}) }),
      });
      onChange(u);
      setPayFor(null); setPayGateway(''); setPayRef('');
    } catch (err) { alert(err.message); }
    setBusyInst(null);
  };

  // A manager's half of the handover: the invoice has gone to the client, and
  // an admin will confirm the money when it lands.
  const markInvoiceSent = async (deal, inst) => {
    setBusyInst(inst.id);
    try {
      const u = await api(`/leads/${lead._id}/deals/${deal.id}/installments/${inst.id}`, {
        method: 'PATCH', body: JSON.stringify({ invoiceSent: true }),
      });
      onChange(u);
    } catch (err) { alert(err.message); }
    setBusyInst(null);
  };

  // Move an instalment's due date (customer wants to pay early or needs time).
  const changeDue = async (deal, inst, dueDate, e) => {
    if (e) e.stopPropagation();
    setBusyInst(inst.id);
    try {
      const u = await api(`/leads/${lead._id}/deals/${deal.id}/installments/${inst.id}`, {
        method: 'PATCH', body: JSON.stringify({ dueDate }),
      });
      onChange(u);
    } catch (err) { alert(err.message); }
    setBusyInst(null);
  };

  // Admin-only hard delete of a deal (for cleaning up bad/legacy records).
  const removeDeal = async (deal, e) => {
    e.stopPropagation();
    if (!confirm(`Delete the deal "${deal.name}"?\n\nThis removes it and its payment schedule permanently. This cannot be undone.`)) return;
    try {
      const u = await api(`/leads/${lead._id}/deals/${deal.id}`, { method: 'DELETE' });
      onChange(u);
    } catch (err) { alert(err.message); }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div className="text-sm text-slate-500">{deals.length} deal{deals.length === 1 ? '' : 's'}</div>
        <button onClick={() => setModal('new')} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-white" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}><Icon.Plus size={14} /> Add deal</button>
      </div>
      {deals.length === 0 ? <div className="text-slate-300 text-sm py-12 text-center">No deals yet.</div> : (
        <div className="space-y-3">
          {deals.map((d) => {
            const sm = stageMeta(d.stage);
            const insts = d.installments || [];
            const paidAmt = insts.filter((i) => i.paid).reduce((s, i) => s + Number(i.amount || 0), 0);
            const dueAmt = Number(d.amount || 0) - paidAmt;
            const isWon = d.stage === 'closed_won';
            return (
              <div key={d.id} className="rounded-xl border border-slate-100 hover:border-slate-200 overflow-hidden">
                <div onClick={() => setModal(d)} className="px-4 py-3 cursor-pointer">
                  <div className="flex items-center justify-between">
                    <div className="font-bold text-sm text-[#050A1F]">{d.name}</div>
                    <div className="flex items-center gap-2">
                      <div className="font-extrabold text-sm text-[#050A1F]">{d.currency} {Number(d.amount).toLocaleString()}</div>
                      {user && user.role === 'admin' && (
                        <button onClick={(e) => removeDeal(d, e)} title="Delete this deal"
                          className="text-slate-300 hover:text-red-500 px-1"><Icon.Trash size={15} /></button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className="rounded-full px-2.5 py-0.5 text-[10px] font-bold text-white" style={{ background: sm.color }}>{sm.label}</span>
                    {d.saleType === 'cross' && <span className="rounded px-1.5 py-0.5 text-[9px] font-bold bg-purple-100 text-purple-600">CROSS-SALE</span>}
                    {d.planType && d.planType !== 'one-time' && <span className="rounded px-1.5 py-0.5 text-[9px] font-bold bg-slate-100 text-slate-500">{d.planType}</span>}
                    {d.service && <span className="text-[11px] text-slate-500">{d.service}</span>}
                    {d.expectedClose && <span className="text-[11px] text-slate-400">· close {d.expectedClose}</span>}
                  </div>
                  {d.remark && <div className="text-xs text-slate-500 mt-1.5">{d.remark}</div>}
                </div>

                {/* Payment schedule. Shown for ANY deal that has one — not just
                    won deals — so an agent can plan and adjust instalments while
                    the deal is still in negotiation. */}
                {insts.length > 0 && (
                  <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-3">
                    <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                        Payment schedule · {insts.filter((i) => i.paid).length}/{insts.length} paid
                      </span>
                      <span className="text-[11px] font-bold">
                        <span className="text-green-600">{d.currency} {paidAmt.toLocaleString()} collected</span>
                        {dueAmt > 0 && <span className="text-amber-600"> · {d.currency} {dueAmt.toLocaleString()} outstanding</span>}
                      </span>
                    </div>

                    {/* Collection progress */}
                    <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden mb-3">
                      <div className="h-full rounded-full bg-green-500"
                        style={{ width: `${Math.max(2, Math.round((paidAmt / Math.max(1, Number(d.amount) || 1)) * 100))}%` }} />
                    </div>

                    <div className="space-y-1.5">
                      {insts.map((it) => {
                        const overdue = !it.paid && it.dueDate && it.dueDate < new Date().toISOString().slice(0, 10);
                        return (
                          <div key={it.id}
                            className={`flex items-center gap-2 text-xs rounded-lg px-2 py-1.5 ${it.paid ? 'bg-green-50' : overdue ? 'bg-red-50' : 'bg-white'}`}>
                            <span className={`font-bold w-6 shrink-0 ${it.paid ? 'text-green-600' : 'text-slate-400'}`}>#{it.seq}</span>
                            <span className="font-semibold text-slate-700 w-24 shrink-0">{d.currency} {Number(it.amount || 0).toLocaleString()}</span>

                            {/* Due date stays editable until the money is in. */}
                            {it.paid ? (
                              <span className="flex-1 text-green-700 font-semibold truncate">
                                ✓ paid {it.paidDate || ''}
                                {it.gateway && <span className="text-green-600 font-normal"> · {it.gateway}</span>}
                                {it.transactionId && <span className="text-slate-400 font-normal"> · {it.transactionId}</span>}
                              </span>
                            ) : (
                              <span className="flex-1 flex items-center gap-2 min-w-0">
                                <input type="date" value={it.dueDate || ''} disabled={busyInst === it.id}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => changeDue(d, it, e.target.value, e)}
                                  className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600 bg-white" />
                                {it.dueDate && (
                                  <span className={`text-[10px] font-bold ${overdue ? 'text-red-500' : 'text-slate-400'}`}>
                                    {daysLeftLabel(it.dueDate)}
                                  </span>
                                )}
                                {it.invoiceSent && (
                                  <span className="text-[10px] font-bold text-blue-600 shrink-0">· invoiced</span>
                                )}
                              </span>
                            )}

                            {/* Only an admin confirms money received. A manager
                                records that the invoice went out instead. */}
                            {isAdmin ? (
                              <button onClick={(e) => togglePaid(d, it, e)} disabled={busyInst === it.id}
                                className={`rounded px-2 py-1 text-[10px] font-bold shrink-0 disabled:opacity-50 ${it.paid ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-[#050A1F] text-white hover:opacity-90'}`}>
                                {busyInst === it.id ? '…' : it.paid ? 'Paid' : 'Mark paid'}
                              </button>
                            ) : it.paid ? (
                              <span className="rounded px-2 py-1 text-[10px] font-bold bg-green-100 text-green-700 shrink-0">Paid</span>
                            ) : it.invoiceSent ? (
                              <span className="rounded px-2 py-1 text-[10px] font-bold bg-blue-100 text-blue-700 shrink-0">Invoice sent</span>
                            ) : (
                              <button onClick={(e) => { e.stopPropagation(); markInvoiceSent(d, it); }} disabled={busyInst === it.id}
                                title="Record that you've sent the invoice. An admin confirms the payment."
                                className="rounded px-2 py-1 text-[10px] font-bold shrink-0 bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 disabled:opacity-50">
                                {busyInst === it.id ? '…' : 'Invoice sent'}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {!isWon && (
                      <div className="text-[10px] text-slate-400 mt-2">
                        Payments only count towards sales once the deal is Closed Won and the instalment is marked paid.
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {modal && <DealModal lead={lead} config={config} deal={modal === 'new' ? null : modal} onClose={() => setModal(null)} onSaved={(u) => { onChange(u); setModal(null); }} />}

      {/* Gateway + reference, captured whenever an admin confirms a payment. */}
      {payFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setPayFor(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="text-base font-extrabold text-[#050A1F]">Record payment</div>
            <div className="text-sm text-slate-500 mt-1">
              {payFor.deal.currency} {Number(payFor.inst.amount || 0).toLocaleString()} · installment {payFor.inst.seq} of {payFor.deal.name}
            </div>

            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mt-4 mb-2">
              Where did the payment come in?
            </div>
            <div className="grid grid-cols-3 gap-2">
              {['PayPal', 'Stripe', 'Wire Transfer'].map((g) => (
                <button key={g} type="button" onClick={() => setPayGateway(g)}
                  className={`rounded-lg border px-2 py-2 text-[11px] font-bold transition-colors ${
                    payGateway === g ? 'border-orange-400 bg-orange-50 text-[#FF4500]' : 'border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}>{g}</button>
              ))}
            </div>

            <div className="mt-3">
              <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Transaction ID</label>
              <input value={payRef} onChange={(e) => setPayRef(e.target.value)}
                placeholder="Reference from PayPal / Stripe / bank"
                className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
              <div className="text-[10px] text-slate-400 mt-1">Kept against the payment so finance can reconcile it later.</div>
            </div>

            <button type="button" disabled={!payGateway || busyInst === payFor.inst.id} onClick={confirmPaid}
              className="w-full mt-4 rounded-lg px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"
              style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>
              {busyInst === payFor.inst.id ? 'Saving…' : 'Confirm payment received'}
            </button>
            <button type="button" onClick={() => setPayFor(null)}
              className="w-full mt-2 rounded-lg px-4 py-2 text-xs font-bold text-slate-400 hover:text-slate-600">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function DealModal({ lead, config, deal, onClose, onSaved }) {
  // Auto deal name = "Customer Name + website" for new deals.
  const autoName = `${fullName(lead)}${lead.website ? ' · ' + lead.website.replace(/^https?:\/\//, '') : ''}`;
  const [f, setF] = useState(deal || {
    name: autoName,
    stage: (config.dealStages && config.dealStages[0] && config.dealStages[0].id) || 'qualification',
    currency: (config.dealCurrencies && config.dealCurrencies[0]) || 'USD',
    amount: '', expectedClose: '', service: '', remark: '',
    planType: 'one-time', paymentStructure: 'full', installmentCount: 2,
    recurringInterval: 'monthly',
    installments: [],
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const inp = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400';
  const lab = 'block text-[11px] font-bold text-slate-500 mb-1';

  // Preview installment rows (client-side) so the agent sees the split. If the
  // deal already has a saved schedule, edit those rows directly.
  const existing = Array.isArray(f.installments) && f.installments.length ? f.installments : null;
  const previewInstallments = () => {
    const n = Math.max(1, Math.min(24, Number(f.installmentCount) || 1));
    const total = Number(f.amount) || 0;
    const per = Math.floor(total / n);
    const start = f.expectedClose ? new Date(f.expectedClose) : new Date();
    const rows = [];
    let alloc = 0;
    for (let i = 0; i < n; i++) {
      const due = new Date(start); due.setMonth(due.getMonth() + i);
      const amt = i === n - 1 ? total - alloc : per; alloc += amt;
      rows.push({ id: `inst_new_${i}`, seq: i + 1, amount: amt, dueDate: due.toISOString().slice(0, 10), paid: false, paidDate: null });
    }
    return rows;
  };
  const rows = existing || (f.paymentStructure === 'installments' ? previewInstallments() : []);
  const setRow = (i, k, v) => {
    const next = rows.map((r, ri) => (ri === i ? { ...r, [k]: v } : r));
    setF((s) => ({ ...s, installments: next }));
  };

  const save = async () => {
    if (!String(f.name).trim()) { alert('Deal name is required.'); return; }
    setBusy(true);
    try {
      const payload = { ...f };
      if (f.paymentStructure === 'installments') payload.installments = rows;
      const u = deal
        ? await api(`/leads/${lead._id}/deals/${deal.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await api(`/leads/${lead._id}/deals`, { method: 'POST', body: JSON.stringify(payload) });
      onSaved(u);
    } catch (e) { alert(e.message); }
    setBusy(false);
  };

  const markPaid = async (inst) => {
    if (!deal) { alert('Save the deal first, then mark installments paid.'); return; }
    try {
      const u = await api(`/leads/${lead._id}/deals/${deal.id}/installments/${inst.id}`, { method: 'PATCH', body: JSON.stringify({ paid: !inst.paid }) });
      const d = (u.deals || []).find((x) => x.id === deal.id);
      if (d) setF((s) => ({ ...s, installments: d.installments }));
      onSaved(u);
    } catch (e) { alert(e.message); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-[#050A1F] mb-4">{deal ? 'Edit deal' : '💰 Add deal'}</h3>
        <div className="space-y-3">
          <div><label className={lab}>Deal name</label><input className={inp} value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
          <div>
            <label className={lab}>Interested service</label>
            <select className={inp} value={f.service} onChange={(e) => set('service', e.target.value)}>
              <option value="">— Select —</option>
              {(config.servicesInterested || []).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lab}>Stage</label>
              <select className={inp} value={f.stage} onChange={(e) => set('stage', e.target.value)}>
                {(config.dealStages || []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className={lab}>Currency</label>
              <select className={inp} value={f.currency} onChange={(e) => set('currency', e.target.value)}>
                {(config.dealCurrencies || ['USD']).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lab}>Total amount</label><input type="number" className={inp} value={f.amount} onChange={(e) => set('amount', e.target.value)} /></div>
            <div><label className={lab}>Expected / actual closing date</label><input type="date" className={inp} value={f.expectedClose} onChange={(e) => set('expectedClose', e.target.value)} /></div>
          </div>

          {/* Plan type drives everything below it. */}
          <div>
            <label className={lab}>Plan type</label>
            <div className="flex gap-2">
              {[['one-time', 'One time'], ['recurring', 'Recurring'], ['installments', 'Installments']].map(([id, label]) => (
                <button key={id} type="button"
                  onClick={() => {
                    set('planType', id);
                    // Keep paymentStructure consistent with the plan so the
                    // backend still receives the shape it expects.
                    if (id === 'installments') set('paymentStructure', 'installments');
                    else if (id === 'recurring') set('paymentStructure', 'full');
                    else set('paymentStructure', 'full');
                  }}
                  className={`flex-1 rounded-lg border px-3 py-2 text-xs font-bold ${
                    (f.planType || 'one-time') === id ? 'border-orange-400 bg-orange-50 text-[#FF4500]' : 'border-slate-200 text-slate-500'
                  }`}>{label}</button>
              ))}
            </div>
          </div>

          {/* One time — the customer can still choose to split it. */}
          {(f.planType || 'one-time') === 'one-time' && (
            <div>
              <label className={lab}>How is the customer paying?</label>
              <div className="flex gap-2">
                <button type="button" onClick={() => set('paymentStructure', 'full')}
                  className={`flex-1 rounded-lg border px-3 py-2 text-xs font-bold ${f.paymentStructure === 'full' ? 'border-orange-400 bg-orange-50 text-[#FF4500]' : 'border-slate-200 text-slate-500'}`}>Full payment</button>
                <button type="button" onClick={() => set('paymentStructure', 'installments')}
                  className={`flex-1 rounded-lg border px-3 py-2 text-xs font-bold ${f.paymentStructure === 'installments' ? 'border-orange-400 bg-orange-50 text-[#FF4500]' : 'border-slate-200 text-slate-500'}`}>In installments</button>
              </div>
            </div>
          )}

          {/* Recurring — always paid in full each cycle; pick the cycle. */}
          {f.planType === 'recurring' && (
            <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
              <label className={lab}>Billing frequency</label>
              <select className={inp} value={f.recurringInterval || 'monthly'}
                onChange={(e) => set('recurringInterval', e.target.value)}>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly (3 months)</option>
                <option value="half-yearly">Every 6 months</option>
                <option value="yearly">Yearly</option>
              </select>
              <div className="text-[10px] text-slate-400 mt-2">
                The amount above is charged in full every cycle. Upcoming billing dates appear on the
                client's row in Converted clients, where you can mark each one collected.
              </div>
            </div>
          )}

          {(f.planType === 'installments' || (f.planType === 'one-time' && f.paymentStructure === 'installments')) && (
            <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
              {!existing && (
                <div className="flex items-center gap-2 mb-2">
                  <label className="text-[11px] font-bold text-slate-500">Number of installments</label>
                  <input type="number" min="1" max="24" className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm" value={f.installmentCount} onChange={(e) => set('installmentCount', e.target.value)} />
                </div>
              )}
              <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">Schedule (dates & amounts editable)</div>
              <div className="space-y-1.5">
                {rows.map((r, i) => (
                  <div key={r.id} className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-slate-400 w-5">#{r.seq}</span>
                    <input type="number" className="w-24 rounded border border-slate-200 px-2 py-1 text-xs" value={r.amount} onChange={(e) => setRow(i, 'amount', Number(e.target.value) || 0)} />
                    <input type="date" className="flex-1 rounded border border-slate-200 px-2 py-1 text-xs" value={r.dueDate} onChange={(e) => setRow(i, 'dueDate', e.target.value)} />
                    {deal ? (
                      <button type="button" onClick={() => markPaid(r)} className={`rounded px-2 py-1 text-[10px] font-bold ${r.paid ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-500'}`}>{r.paid ? '✓ Paid' : 'Mark paid'}</button>
                    ) : <span className="text-[10px] text-slate-300 w-14 text-center">—</span>}
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-slate-400 mt-2">First installment is due on the closing date; the rest are spaced monthly. Adjust any date if the customer pays early or late.</div>
            </div>
          )}

          <div><label className={lab}>Remark</label><textarea rows={2} className={inp} value={f.remark} onChange={(e) => set('remark', e.target.value)} /></div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg px-6 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>{busy ? 'Saving…' : 'Save deal'}</button>
        </div>
      </div>
    </div>
  );
}

// ---- Reports tab -----------------------------------------------------------
// Pre-run popup for generating a report from a lead. Collects the details the
// report needs that aren't already firm on the lead — business name, services,
// target market and (optional) location — pre-filled from the lead where known.
const REPORT_SERVICES = ['SEO', 'SMO', 'AI SEO', 'GEO', 'AEO', 'Local SEO'];
const REPORT_MARKETS = [
  { code: 'us', name: 'United States' }, { code: 'gb', name: 'United Kingdom' },
  { code: 'ca', name: 'Canada' }, { code: 'au', name: 'Australia' }, { code: 'in', name: 'India' },
  { code: 'ae', name: 'United Arab Emirates' }, { code: 'sg', name: 'Singapore' },
  { code: 'my', name: 'Malaysia' }, { code: 'de', name: 'Germany' }, { code: 'fr', name: 'France' },
  { code: 'nz', name: 'New Zealand' }, { code: 'za', name: 'South Africa' },
];

function RunReportModal({ lead, onClose, onQueued }) {
  const fullName = `${titleCase(lead.firstName)} ${titleCase(lead.lastName)}`.trim();
  const [f, setF] = useState({
    businessName: lead.company || lead.businessName || '',
    services: (Array.isArray(lead.servicesInterested) && lead.servicesInterested.filter((s) => REPORT_SERVICES.includes(s)).length)
      ? lead.servicesInterested.filter((s) => REPORT_SERVICES.includes(s)) : ['SEO'],
    country: 'us',
    location: lead.city || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lab = 'block text-xs font-semibold text-slate-600 mb-1.5';
  const inp = 'w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400';

  const toggleService = (s) => setF((p) => ({
    ...p, services: p.services.includes(s) ? p.services.filter((x) => x !== s) : [...p.services, s],
  }));

  const submit = async () => {
    if (!lead.website) { setError('This lead has no website, so a report can’t be generated.'); return; }
    if (!f.businessName.trim()) { setError('Enter the business name.'); return; }
    if (f.services.length === 0) { setError('Select at least one service.'); return; }
    setBusy(true); setError('');
    try {
      const r = await api('/reports', {
        method: 'POST',
        body: JSON.stringify({
          website: lead.website,
          businessName: f.businessName.trim(),
          customerName: fullName || f.businessName.trim(),
          services: f.services,
          country: f.country,
          location: f.location || undefined,
          leadId: lead._id,
        }),
      });
      onQueued(r.reportId);
    } catch (e) {
      setError(e.message || 'Could not start the report.');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-lg max-h-[88vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-extrabold text-[#050A1F] mb-1">Run report</h3>
        <p className="text-xs text-slate-400 mb-4">For <span className="font-bold text-slate-500">{lead.website || '—'}</span>{fullName ? ` · ${fullName}` : ''}</p>

        {error && <div className="mb-3 rounded-lg bg-red-50 text-red-600 text-sm px-3 py-2">{error}</div>}

        <div className="space-y-4">
          <div>
            <label className={lab}>Business name</label>
            <input className={inp} value={f.businessName} onChange={(e) => setF({ ...f, businessName: e.target.value })} placeholder="Acme Corp" />
          </div>
          <div>
            <label className={lab}>Services</label>
            <div className="flex flex-wrap gap-2">
              {REPORT_SERVICES.map((s) => (
                <button key={s} type="button" onClick={() => toggleService(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${f.services.includes(s) ? 'bg-orange-50 border-orange-300 text-[#FF4500]' : 'border-slate-200 text-slate-500'}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={lab}>Target market</label>
              <select className={inp} value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>
                {REPORT_MARKETS.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lab}>Location <span className="font-normal text-slate-400">(optional)</span></label>
              <input className={inp} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="Kuala Lumpur" />
            </div>
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={submit} disabled={busy} className="flex-1 rounded-lg px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>{busy ? 'Starting…' : 'Generate report'}</button>
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-500">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function ReportsTab({ lead, onChange }) {
  const [reports, setReports] = useState(null);
  const [showRun, setShowRun] = useState(false);
  useEffect(() => {
    let alive = true;
    api(`/leads/${lead._id}`)
      .then((r) => { if (alive) setReports(r.reports || []); })
      .catch(() => { if (alive) setReports([]); });
    return () => { alive = false; };
  }, [lead._id]);
  const openReport = (r) => window.open(`${API_BASE}/api/reports/${r._id}/view?token=${localStorage.getItem('qtx_token')}`, '_blank');
  const download = (r) => window.open(`${API_BASE}/api/reports/${r._id}/download?token=${localStorage.getItem('qtx_token')}`, '_blank');
  const [refreshing, setRefreshing] = useState(false);
  if (reports === null) return <div className="text-slate-400 text-sm py-12 text-center">Loading…</div>;
  // A lead keeps only its latest report, so if one exists we offer Refresh
  // (re-run using fresh Claude/Google data, reusing SE Ranking) rather than a
  // brand-new run.
  const existing = reports[0] || null;
  const refresh = async () => {
    if (!existing) return;
    if (!confirm('Refresh this report with fresh AI and Google data? SE Ranking data is reused, so no SE Ranking credits are spent.')) return;
    setRefreshing(true);
    try {
      await api(`/reports/${existing._id}/refresh`, { method: 'POST' });
      window.location.href = `/?reportId=${existing._id}`;
    } catch (e) { alert(e.message); setRefreshing(false); }
  };
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div className="text-sm text-slate-500">{reports.length ? '1 report' : 'No report yet'}</div>
        {existing ? (
          <button onClick={refresh} disabled={refreshing} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>{refreshing ? 'Refreshing…' : '↻ Refresh report'}</button>
        ) : (
          <button onClick={() => setShowRun(true)} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>▶ Run report</button>
        )}
      </div>
      {showRun && <RunReportModal lead={lead} onClose={() => setShowRun(false)} onQueued={(id) => { setShowRun(false); window.location.href = `/?reportId=${id}`; }} />}
      {reports.length === 0 ? (
        <div className="text-slate-300 text-sm py-12 text-center">No reports linked to this lead yet.<br />Use “Run report” to generate one for this lead.</div>
      ) : (
        <div className="space-y-2">
          {reports.map((r) => (
            <div key={r._id} className="rounded-lg border border-slate-100 px-4 py-3 flex items-center justify-between">
              <div>
                <div className="font-bold text-sm text-[#050A1F]">{r.businessName || r.domain}</div>
                <div className="text-[11px] text-slate-400">{r.status} · {fmtDate(r.createdAt)} · score {r.scores && r.scores.overall != null ? r.scores.overall : '—'}</div>
              </div>
              {r.status === 'complete' && (
                <div className="flex gap-2">
                  <button onClick={() => openReport(r)} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-bold text-slate-600">👁️ View</button>
                  <button onClick={() => download(r)} className="rounded-md px-2.5 py-1 text-xs font-bold text-white" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>⬇️ PDF</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Top-level Leads view controller — switches between list / new / detail.
export default function Leads({ user, initialView, initialUntouched, initialLeadId, initialConvertedMonth }) {
  const [view, setView] = useState(initialView || 'list'); // list | pipeline | converted | new | detail
  const [activeId, setActiveId] = useState(() => {
    if (initialLeadId) return initialLeadId;
    try { return new URLSearchParams(window.location.search).get('leadId') || null; } catch { return null; }
  });
  const [untouched, setUntouched] = useState(initialUntouched || null);
  const [detailTab, setDetailTab] = useState(null);
  // `tab` lets callers deep-link straight to a section (e.g. the Deals tab when
  // a deal is clicked from the pipeline or converted-clients page).
  const openDetail = (id, tab) => {
    setActiveId(id); setDetailTab(tab || null); setView('detail');
    try { const p = new URLSearchParams(window.location.search); p.set('leadId', id); window.history.replaceState(null, '', `${window.location.pathname}?${p.toString()}`); } catch { /* */ }
  };
  // If we landed with a leadId in the URL (a refresh on a detail page), open it.
  const [bootedDetail, setBootedDetail] = useState(false);
  useEffect(() => {
    if (bootedDetail) return; setBootedDetail(true);
    try { const lid = new URLSearchParams(window.location.search).get('leadId'); if (lid && view !== 'detail') { setActiveId(lid); setView('detail'); } } catch { /* */ }
    // eslint-disable-next-line
  }, []);
  const clearLeadIdParam = () => { try { const p = new URLSearchParams(window.location.search); p.delete('leadId'); const qs = p.toString(); window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`); } catch { /* */ } };
  const isManagerOrAdmin = user.role === 'admin' || user.role === 'manager';
  return (
    <div>
      {(view === 'list' || view === 'pipeline' || view === 'converted') && user.role !== 'leadmanager' && (
        <div className="flex items-center gap-1 mb-5 bg-slate-100 rounded-lg p-1 w-fit">
          <button onClick={() => setView('list')} className={`px-4 py-1.5 rounded-md text-xs font-bold ${view === 'list' ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>📋 List</button>
          <button onClick={() => setView('pipeline')} className={`px-4 py-1.5 rounded-md text-xs font-bold ${view === 'pipeline' ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>📊 Deals pipeline</button>
          {isManagerOrAdmin && <button onClick={() => setView('converted')} className={`px-4 py-1.5 rounded-md text-xs font-bold ${view === 'converted' ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>✅ Converted</button>}
        </div>
      )}
      {/* Lead managers coordinate intake only — the pipeline and converted views
          are outside their remit, so a stray deep link falls back to the list. */}
      {view === 'list' && <LeadsList user={user} untouchedFilter={untouched} onClearUntouched={() => setUntouched(null)} onOpen={(l) => openDetail(l._id)} onNew={() => setView('new')} />}
      {/* Prospects: the call-back-generated stage. Same list machinery, but
          scoped to callbacks and with the Transfer action enabled. */}
      {view === 'prospects' && <LeadsList user={user} stage="prospect" onOpen={(l) => openDetail(l._id)} onNew={() => setView('new')} />}
      {view === 'pipeline' && user.role !== 'leadmanager' && <DealsPipeline user={user} onOpenLead={openDetail} />}
      {view === 'converted' && isManagerOrAdmin && <ConvertedLeads user={user} onOpen={openDetail} thisMonthOnly={initialConvertedMonth} />}
      {view === 'new' && <NewLead user={user} isCallback={initialView === 'prospects'} onCreated={(l) => openDetail(l._id)} onOpenLead={(id) => openDetail(id)} onCancel={() => setView(initialView === 'prospects' ? 'prospects' : 'list')} />}
      {view === 'detail' && activeId && <LeadDetail user={user} leadId={activeId} initialTab={detailTab} isProspect={initialView === 'prospects'} onBack={() => { clearLeadIdParam(); setView(initialView === 'converted' ? 'converted' : initialView === 'prospects' ? 'prospects' : 'list'); }} />}
    </div>
  );
}

// ---- Converted leads (managers/admins only) --------------------------------
function ConvertedLeads({ user, onOpen, thisMonthOnly }) {
  const [items, setItems] = useState([]);
  const [config, setConfig] = useState({});
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(thisMonthOnly ? 'thisMonth' : 'all');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [pageInfo, setPageInfo] = useState({ total: 0, pages: 1 });
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(null);
  // Cards, table, or both. Remembered per user, since it's a lasting
  // preference rather than something to re-pick on every visit.
  const [viewMode, setViewMode] = useState(() => {
    try { return localStorage.getItem('qtx_converted_view') || 'both'; } catch { return 'both'; }
  });
  const pickView = (v) => {
    setViewMode(v);
    try { localStorage.setItem('qtx_converted_view', v); } catch { /* private browsing */ }
  };
  // Which client rows are expanded in the table to show their pending payments.
  const [expanded, setExpanded] = useState({});
  const toggleRow = (id) => setExpanded((e) => ({ ...e, [id]: !e[id] }));

  // Change an installment's due date without leaving the table.
  const reschedule = async (lead, deal, inst, dueDate) => {
    setBusy(inst.id);
    try {
      const u = await api(`/leads/${lead._id}/deals/${deal.id}/installments/${inst.id}`, {
        method: 'PATCH', body: JSON.stringify({ dueDate }),
      });
      setItems((list) => list.map((x) => (x._id === u._id ? u : x)));
    } catch (e) { alert(e.message); }
    setBusy(null);
  };

  // Which installment is awaiting a gateway choice before it can be collected.
  const [payFor, setPayFor] = useState(null); // { lead, deal, inst }
  const [payGateway, setPayGateway] = useState('');
  const [payRef, setPayRef] = useState('');

  // Only an admin confirms money received; a manager records that the invoice
  // has gone out, which is their half of the handover.
  const isAdmin = user && user.role === 'admin';

  const markInvoiced = async (lead, deal, inst) => {
    setBusy(inst.id);
    try {
      const u = await api(`/leads/${lead._id}/deals/${deal.id}/installments/${inst.id}`, {
        method: 'PATCH', body: JSON.stringify({ invoiceSent: true }),
      });
      setItems((list) => list.map((x) => (x._id === u._id ? u : x)));
    } catch (e) { alert(e.message); }
    setBusy(null);
  };

  // Mark the next outstanding installment as received, straight from the card.
  const collect = async (lead, deal, inst, gateway, transactionId) => {
    setBusy(inst.id);
    try {
      const u = await api(`/leads/${lead._id}/deals/${deal.id}/installments/${inst.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ paid: true, ...(gateway ? { gateway } : {}), ...(transactionId ? { transactionId } : {}) }),
      });
      setItems((list) => list.map((x) => (x._id === u._id ? u : x)));
      setPayFor(null); setPayGateway(''); setPayRef('');
    } catch (e) { alert(e.message); }
    setBusy(null);
  };
  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ period, page: String(page), perPage: String(perPage) });
    Promise.all([api(`/leads/converted?${params}`), api('/leads/config')])
      .then(([r, cfg]) => {
        setItems(r.items || []);
        setPageInfo({ total: r.total || 0, pages: r.pages || 1 });
        setConfig(cfg.config || {});
      })
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [period, page, perPage]);
  useEffect(() => { setPage(1); /* eslint-disable-next-line */ }, [period]);

  const inThisMonth = (l) => {
    if (!l.convertedAt) return false;
    const d = new Date(l.convertedAt), n = new Date();
    return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
  };
  const fx = config.fxRates || { USD: 1 };
  const toUsd = (amt, cur) => { const r = fx[cur] || 1; return r ? Number(amt || 0) / r : Number(amt || 0); };

  // Per-client money summary across won deals: total booked, collected, due.
  const summarize = (l) => {
    const hasPayment = (d) => (d.installments || []).some((it) => it.paid);
    const won = (l.deals || []).filter((d) => d.stage === 'closed_won' || (d.stage !== 'closed_lost' && hasPayment(d)));
    const open = (l.deals || []).filter((d) => d.stage !== 'closed_won' && d.stage !== 'closed_lost' && !hasPayment(d));
    let booked = 0, collected = 0, instTotal = 0, instPaid = 0, nextDue = null;
    // `pending` = money genuinely owed now: unpaid installments of a PART-PAYMENT
    // (one-time) deal. `recurringUpcoming` = future cycles of a recurring
    // contract — these are NOT a debt, so they show as upcoming payments inside
    // the converted box, never in "Awaiting collection".
    const pending = [];
    const recurringUpcoming = [];
    for (const d of won) {
      const isRecurring = d.planType === 'recurring';
      // One-off sale books its whole value up front. A recurring contract books
      // only what has actually been collected (future cycles aren't owed).
      if (!isRecurring) booked += toUsd(d.amount, d.currency);
      for (const it of (d.installments || [])) {
        instTotal++;
        if (it.paid) {
          instPaid++;
          collected += toUsd(it.amount, d.currency);
          if (isRecurring) booked += toUsd(it.amount, d.currency);
        } else if (isRecurring) {
          // Future recurring cycle — show as an upcoming payment, not as owed.
          recurringUpcoming.push({ deal: d, inst: it });
        } else {
          // Unpaid part-payment installment — genuinely awaiting collection.
          pending.push({ deal: d, inst: it, recurring: false });
          if (it.dueDate && (!nextDue || it.dueDate < nextDue)) nextDue = it.dueDate;
        }
      }
    }
    pending.sort((a, b) => String(a.inst.dueDate || '9999').localeCompare(String(b.inst.dueDate || '9999')));
    recurringUpcoming.sort((a, b) => String(a.inst.dueDate || '9999').localeCompare(String(b.inst.dueDate || '9999')));
    return {
      won, open, booked: Math.round(booked), collected: Math.round(collected),
      due: Math.round(booked - collected), instTotal, instPaid, nextDue,
      pending, nextInst: pending[0] || null, recurringUpcoming,
    };
  };

  const filtered = items
    .filter((l) => (q ? (fullName(l) + ' ' + (l.website || '') + ' ' + (l.ownerName || '')).toLowerCase().includes(q.toLowerCase()) : true));

  // Converted-with-an-open-deal show as cards; converted with no open deal go
  // into a compact table below (server flags each row with `openDeal`).
  const hasOpen = (l) => (typeof l.openDeal === 'boolean') ? l.openDeal : (l.deals || []).some((d) => d && d.stage !== 'closed_won' && d.stage !== 'closed_lost');
  const openDealLeads = filtered.filter(hasOpen);
  const noOpenDealLeads = filtered.filter((l) => !hasOpen(l));

  // Page totals.
  const totals = filtered.reduce((acc, l) => {
    const s = summarize(l);
    acc.booked += s.booked; acc.collected += s.collected; acc.due += s.due;
    return acc;
  }, { booked: 0, collected: 0, due: 0 });

  if (loading) return <div className="text-slate-400 text-sm py-12 text-center">Loading…</div>;

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold text-[#050A1F]">Converted clients</h1>
          <div className="text-sm text-slate-400">{pageInfo.total} client{pageInfo.total === 1 ? '' : 's'}{user.role === 'manager' ? ' in your team' : ''}</div>
        </div>
        <div className="flex items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients…"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-orange-400" />
          <select value={period} onChange={(e) => setPeriod(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600">
            <option value="thisMonth">This month</option>
            <option value="lastMonth">Last month</option>
            <option value="last3">Last 3 months</option>
            <option value="thisYear">This year</option>
            <option value="all">All time</option>
          </select>

          {/* Cards read well for a handful of clients; the table scans faster
              once the list grows. Let people pick, and remember the choice. */}
          <div className="flex rounded-lg border border-slate-300 overflow-hidden">
            {[['cards', 'Boxes'], ['table', 'Table'], ['both', 'Both']].map(([id, label]) => (
              <button key={id} type="button" onClick={() => pickView(id)}
                className={`px-3 py-2 text-xs font-bold transition-colors ${
                  viewMode === id ? 'bg-[#050A1F] text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
                }`}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Money summary */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Total booked</div>
            <div className="text-xl font-extrabold text-[#050A1F] mt-0.5">${totals.booked.toLocaleString()}</div>
          </div>
          <div className="rounded-xl border border-green-200 bg-green-50 p-4">
            <div className="text-[10px] font-bold uppercase tracking-wide text-green-600">Collected</div>
            <div className="text-xl font-extrabold text-green-700 mt-0.5">${totals.collected.toLocaleString()}</div>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="text-[10px] font-bold uppercase tracking-wide text-amber-600">Outstanding</div>
            <div className="text-xl font-extrabold text-amber-700 mt-0.5">${totals.due.toLocaleString()}</div>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="text-slate-400 text-sm py-16 text-center bg-white rounded-2xl border border-slate-100">
          <div className="text-4xl mb-2">🎉</div>
          No converted clients for this period. A lead converts when one of its deals is marked Closed Won.
        </div>
      ) : viewMode === 'table' ? null : (
        <>
        {openDealLeads.length > 0 && (
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Active — open deal or payment pending · {openDealLeads.length}</div>
        )}
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {openDealLeads.map((l) => {
            const s = summarize(l);
            const pct = s.booked > 0 ? Math.round((s.collected / s.booked) * 100) : 0;
            const fullyPaid = s.due <= 0 && s.booked > 0;
            return (
              <div key={l._id} onClick={() => onOpen(l._id, 'deals')}
                className="bg-white rounded-2xl border border-slate-100 p-5 cursor-pointer hover:shadow-md hover:border-green-200 transition shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-xl bg-green-50 text-green-600 flex items-center justify-center text-base font-extrabold shrink-0">
                    {(fullName(l)[0] || '?').toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-[#050A1F] truncate">{fullName(l)}</div>
                    <div className="text-[11px] text-slate-400 truncate">{l.website ? l.website.replace(/^https?:\/\//, '') : '—'}</div>
                  </div>
                  <span className="rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[9px] font-bold shrink-0">CLIENT</span>
                </div>

                {/* Collected vs booked */}
                <div className="mt-4">
                  <div className="flex items-end justify-between mb-1">
                    <div className="text-lg font-extrabold text-[#050A1F]">${s.collected.toLocaleString()}<span className="text-slate-300 text-sm"> / ${s.booked.toLocaleString()}</span></div>
                    <div className={`text-xs font-bold ${fullyPaid ? 'text-green-600' : 'text-amber-600'}`}>{pct}%</div>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(3, pct)}%`, background: fullyPaid ? '#16A34A' : 'linear-gradient(90deg,#FF6A00,#FF4500)' }} />
                  </div>
                  <div className="flex items-center justify-between mt-1.5 text-[11px]">
                    {s.instTotal > 1
                      ? <span className="text-slate-400">💵 {s.instPaid}/{s.instTotal} installments paid</span>
                      : <span className="text-slate-400">{fullyPaid ? 'Paid in full' : 'Payment pending'}</span>}
                    {s.due > 0 && <span className="font-bold text-amber-600">${s.due.toLocaleString()} due</span>}
                  </div>
                  {/* Every outstanding payment: amount, due date, a plain-English
                      countdown, and its own Mark-paid button — so the 2nd or 3rd
                      instalment can be collected without opening the lead. */}
                  {s.pending.length > 0 && (
                    <div className="mt-3">
                      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">
                        Awaiting collection · {s.pending.length}
                      </div>
                      <div className="space-y-1.5">
                        {s.pending.slice(0, 4).map(({ deal, inst }) => {
                          const n = daysUntil(inst.dueDate);
                          const overdue = n != null && n < 0;
                          const soon = n != null && n >= 0 && n <= 7;
                          return (
                            <div key={inst.id}
                              className={`rounded-lg px-2.5 py-2 ${overdue ? 'bg-red-50 border border-red-100' : soon ? 'bg-amber-50 border border-amber-100' : 'bg-slate-50 border border-slate-100'}`}>
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-sm font-extrabold text-slate-800">
                                    {deal.currency} {Number(inst.amount || 0).toLocaleString()}
                                    <span className="text-[10px] font-bold text-slate-400 ml-1.5">instalment {inst.seq}</span>
                                  </div>
                                  <div className={`text-[11px] font-semibold mt-0.5 flex items-center gap-1 ${overdue ? 'text-red-600' : soon ? 'text-amber-700' : 'text-slate-500'}`}>
                                    <Icon.Calendar size={12} />
                                    {inst.dueDate || 'no due date'}
                                    {inst.dueDate && <span className="font-bold">({daysLeftLabel(inst.dueDate)})</span>}
                                  </div>
                                </div>
                                <button onClick={(e) => { e.stopPropagation(); setPayFor({ lead: l, deal, inst }); }}
                                  disabled={busy === inst.id}
                                  className="rounded-md bg-[#050A1F] text-white px-3 py-1.5 text-[10px] font-bold hover:opacity-90 disabled:opacity-50 shrink-0">
                                  {busy === inst.id ? 'Saving…' : 'Mark paid'}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {s.pending.length > 4 && (
                        <div className="text-[10px] text-slate-400 mt-1.5">
                          +{s.pending.length - 4} more — open the client to see all
                        </div>
                      )}
                    </div>
                  )}

                  {/* Upcoming recurring payments — future cycles of a recurring
                      contract. Shown here (not in Awaiting collection) since they
                      aren't a debt owed; the 1st sale is what counts for credit. */}
                  {s.recurringUpcoming.length > 0 && (
                    <div className="mt-3">
                      <div className="text-[10px] font-bold uppercase tracking-wide text-indigo-400 mb-1.5">
                        🔁 Upcoming recurring · {s.recurringUpcoming.length}
                      </div>
                      <div className="space-y-1.5">
                        {s.recurringUpcoming.slice(0, 3).map(({ deal, inst }) => (
                          <div key={inst.id} className="rounded-lg px-2.5 py-2 bg-indigo-50/50 border border-indigo-100">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-sm font-extrabold text-slate-800">
                                  {deal.currency} {Number(inst.amount || 0).toLocaleString()}
                                  <span className="text-[10px] font-bold text-indigo-400 ml-1.5">cycle {inst.seq}</span>
                                </div>
                                <div className="text-[11px] font-semibold mt-0.5 flex items-center gap-1 text-slate-500">
                                  <Icon.Calendar size={12} />
                                  {inst.dueDate || 'no date'}
                                  {inst.dueDate && <span className="font-bold">({daysLeftLabel(inst.dueDate)})</span>}
                                </div>
                              </div>
                              <button onClick={(e) => { e.stopPropagation(); setPayFor({ lead: l, deal, inst }); }}
                                disabled={busy === inst.id}
                                className="rounded-md bg-indigo-500 text-white px-3 py-1.5 text-[10px] font-bold hover:opacity-90 disabled:opacity-50 shrink-0">
                                {busy === inst.id ? 'Saving…' : 'Record'}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                      {s.recurringUpcoming.length > 3 && (
                        <div className="text-[10px] text-slate-400 mt-1.5">+{s.recurringUpcoming.length - 3} more cycles</div>
                      )}
                    </div>
                  )}
                </div>

                {/* Deal counts + cross-sell prompt */}
                <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                  <span className="rounded-md bg-green-50 text-green-600 px-1.5 py-0.5 text-[10px] font-bold">{s.won.length} won</span>
                  {s.open.length > 0 && <span className="rounded-md bg-blue-50 text-blue-600 px-1.5 py-0.5 text-[10px] font-bold">{s.open.length} open</span>}
                  <span className="text-[10px] text-slate-400 ml-auto">{fmtDate(l.convertedAt)}</span>
                </div>

                {s.open.length === 0 && (
                  <div className="mt-3 rounded-lg bg-purple-50 border border-purple-100 px-2.5 py-2 text-[11px] font-bold text-purple-600">
                    ✨ Cross-sell opportunity — no open deal right now
                  </div>
                )}
                <div className="text-[11px] text-slate-400 mt-2">Owner: <span className="font-semibold text-slate-500">{l.ownerName}</span></div>
              </div>
            );
          })}
        </div>

        {/* Converted clients with no open deal — shown as a compact table, not
            cards, since there's no active deal to work. */}
        {noOpenDealLeads.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Completed — service done, ready for cross-sell · {noOpenDealLeads.length}</div>
            <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] text-slate-400 uppercase border-b border-slate-100">
                  <th className="px-4 py-2.5">Client</th><th className="px-4 py-2.5">Website</th><th className="px-4 py-2.5">Collected</th><th className="px-4 py-2.5">Owner</th><th className="px-4 py-2.5">Converted</th><th className="px-4 py-2.5"></th>
                </tr></thead>
                <tbody>
                  {noOpenDealLeads.map((l) => {
                    const s = summarize(l);
                    return (
                      <tr key={l._id} onClick={() => onOpen(l._id, 'deals')} className="border-b border-slate-50 hover:bg-slate-50/60 cursor-pointer">
                        <td className="px-4 py-2.5 font-bold text-[#050A1F]">{fullName(l)}</td>
                        <td className="px-4 py-2.5 text-slate-500">{l.website ? l.website.replace(/^https?:\/\//, '') : '—'}</td>
                        <td className="px-4 py-2.5 text-slate-600">${s.collected.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-slate-500">{l.ownerName}</td>
                        <td className="px-4 py-2.5 text-slate-400 text-xs">{fmtDate(l.convertedAt)}</td>
                        <td className="px-4 py-2.5 text-right"><span className="rounded-md bg-purple-50 text-purple-600 px-2 py-0.5 text-[10px] font-bold whitespace-nowrap">✨ Cross-sell</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
        </>
      )}

      {/* Full client table — easier to scan than cards once the list grows. */}
      {filtered.length > 0 && viewMode !== 'cards' && (
        <div className={viewMode === 'table' ? '' : 'mt-6'}>
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">All converted clients</div>
          <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50/80 text-[10px] uppercase tracking-wider text-slate-400 font-bold border-b border-slate-100">
                  <th className="w-9 px-2 py-3"></th>
                  <th className="text-left px-4 py-3">Client</th>
                  <th className="text-left px-4 py-3">Website</th>
                  <th className="text-left px-4 py-3">Owner</th>
                  <th className="text-left px-4 py-3">Collected / booked</th>
                  <th className="text-left px-4 py-3">Outstanding</th>
                  <th className="text-left px-4 py-3">Deals</th>
                  <th className="text-left px-4 py-3">Converted</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => {
                  const s = summarize(l);
                  const pct = s.booked > 0 ? Math.round((s.collected / s.booked) * 100) : 0;
                  const isOpen = !!expanded[l._id];
                  return (
                    <React.Fragment key={`row-${l._id}`}>
                    <tr onClick={() => onOpen(l._id, 'deals')}
                      className="border-t border-slate-50 hover:bg-green-50/30 cursor-pointer transition-colors">
                      {/* Expander — opens the pending payments panel in place. */}
                      <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                        {s.pending.length > 0 ? (
                          <button
                            onClick={() => toggleRow(l._id)}
                            title={isOpen ? 'Hide pending payments' : `Show ${s.pending.length} pending payment${s.pending.length === 1 ? '' : 's'}`}
                            className={`w-6 h-6 rounded-md border flex items-center justify-center transition-colors ${
                              isOpen ? 'border-orange-300 bg-orange-50 text-[#FF4500]' : 'border-slate-200 text-slate-400 hover:border-slate-300 hover:bg-slate-50'
                            }`}>
                            {isOpen ? <Icon.Minus size={13} /> : <Icon.Plus size={13} />}
                          </button>
                        ) : (
                          <span className="w-6 h-6 flex items-center justify-center text-green-500" title="Paid in full"><Icon.Check size={13} /></span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-green-50 text-green-600 flex items-center justify-center text-xs font-bold shrink-0">
                            {(fullName(l)[0] || '?').toUpperCase()}
                          </div>
                          <span className="font-bold text-[#050A1F]">{fullName(l)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{l.website ? l.website.replace(/^https?:\/\//, '') : '—'}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{l.ownerName}</td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-[#050A1F] text-xs">${s.collected.toLocaleString()} <span className="text-slate-300">/ ${s.booked.toLocaleString()}</span></div>
                        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden mt-1 w-24">
                          <div className="h-full rounded-full" style={{ width: `${Math.max(3, pct)}%`, background: s.due <= 0 ? '#16A34A' : 'linear-gradient(90deg,#FF6A00,#FF4500)' }} />
                        </div>
                      </td>
                      <td className={`px-4 py-3 text-xs font-bold ${s.due > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                        {s.due > 0 ? `$${s.due.toLocaleString()}` : 'Paid in full'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="rounded-md bg-green-50 text-green-600 px-1.5 py-0.5 text-[10px] font-bold">{s.won.length} won</span>
                          {s.open.length > 0 && <span className="rounded-md bg-blue-50 text-blue-600 px-1.5 py-0.5 text-[10px] font-bold">{s.open.length} open</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{fmtDate(l.convertedAt)}</td>
                    </tr>

                    {/* Pending payments, editable in place — no need to open the
                        lead just to move a date or record a payment. */}
                    {isOpen && s.pending.length > 0 && (
                      <tr className="bg-amber-50/30">
                        <td colSpan={8} className="px-4 py-3">
                          <div className="text-[10px] font-bold uppercase tracking-wide text-amber-600 mb-2">
                            Upcoming &amp; pending payments · {s.pending.length}
                          </div>
                          <div className="space-y-1.5">
                            {s.pending.map(({ deal: d, inst: it, recurring }) => {
                              const overdue = it.dueDate && it.dueDate < new Date().toISOString().slice(0, 10);
                              return (
                                <div key={it.id}
                                  className="flex items-center gap-3 flex-wrap bg-white rounded-lg border border-slate-100 px-3 py-2">
                                  <span className="text-[10px] font-bold text-slate-400 w-16 shrink-0">
                                    {recurring ? 'Cycle' : '#'}{it.seq}
                                  </span>
                                  <span className="text-xs font-bold text-[#050A1F] w-28 shrink-0">
                                    {d.currency} {Number(it.amount || 0).toLocaleString()}
                                  </span>
                                  <span className="text-[11px] text-slate-400 truncate max-w-[180px]" title={d.name}>
                                    {d.name}
                                    {recurring && <span className="ml-1 rounded bg-blue-50 text-blue-600 px-1 py-0.5 text-[9px] font-bold">
                                      {({ monthly: 'Monthly', quarterly: 'Quarterly', 'half-yearly': '6-monthly', yearly: 'Yearly' })[d.recurringInterval] || 'Recurring'}
                                    </span>}
                                  </span>
                                  <label className="flex items-center gap-1.5 ml-auto">
                                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Due</span>
                                    <input
                                      type="date"
                                      value={it.dueDate || ''}
                                      disabled={busy === it.id}
                                      onChange={(e) => reschedule(l, d, it, e.target.value)}
                                      className={`rounded-md border px-2 py-1 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-orange-400 ${
                                        overdue ? 'border-red-200 text-red-600 bg-red-50' : 'border-slate-200 text-slate-600'
                                      }`} />
                                  </label>
                                  {isAdmin ? (
                                    <button
                                      onClick={() => { setPayGateway(''); setPayRef(''); setPayFor({ lead: l, deal: d, inst: it }); }}
                                      disabled={busy === it.id}
                                      className="rounded-md px-3 py-1.5 text-[11px] font-bold text-white inline-flex items-center gap-1 disabled:opacity-50 shrink-0"
                                      style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>
                                      <Icon.Money size={12} /> {busy === it.id ? 'Saving…' : 'Mark paid'}
                                    </button>
                                  ) : it.invoiceSent ? (
                                    <span className="rounded-md border border-green-200 bg-green-50 px-3 py-1.5 text-[11px] font-bold text-green-700 inline-flex items-center gap-1 shrink-0">
                                      <Icon.Check size={12} /> Invoice sent
                                    </span>
                                  ) : (
                                    <button
                                      onClick={() => markInvoiced(l, d, it)}
                                      disabled={busy === it.id}
                                      title="Record that you've sent the invoice. An admin confirms the payment itself."
                                      className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-[11px] font-bold text-blue-700 inline-flex items-center gap-1 disabled:opacity-50 shrink-0 hover:bg-blue-100">
                                      {busy === it.id ? 'Saving…' : 'Invoice sent'}
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pages={pageInfo.pages} total={pageInfo.total} perPage={perPage}
            onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} label="clients" />
        </div>
      )}

      {/* Which gateway did the money arrive through? Asked at the moment of
          collection, because the same client may pay by card one cycle and by
          bank transfer the next. */}
      {payFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => setPayFor(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="text-base font-extrabold text-[#050A1F]">Record payment</div>
            <div className="text-sm text-slate-500 mt-1">
              {payFor.deal.currency} {Number(payFor.inst.amount || 0).toLocaleString()} · {payFor.deal.name}
            </div>

            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mt-4 mb-2">
              Where did the payment come in?
            </div>
            <div className="grid grid-cols-3 gap-2">
              {['PayPal', 'Stripe', 'Wire Transfer'].map((g) => (
                <button key={g}
                  onClick={() => setPayGateway(g)}
                  className={`rounded-lg border px-2 py-2 text-[11px] font-bold transition-colors ${
                    payGateway === g ? 'border-orange-400 bg-orange-50 text-[#FF4500]' : 'border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}>
                  {g}
                </button>
              ))}
            </div>

            <div className="mt-3">
              <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Transaction ID</label>
              <input value={payRef} onChange={(e) => setPayRef(e.target.value)}
                placeholder="Reference from PayPal / Stripe / bank"
                className="w-full mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
              <div className="text-[10px] text-slate-400 mt-1">Kept against the payment so finance can reconcile it later.</div>
            </div>

            <button
              disabled={!payGateway || busy === payFor.inst.id}
              onClick={() => collect(payFor.lead, payFor.deal, payFor.inst, payGateway, payRef)}
              className="w-full mt-4 rounded-lg px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"
              style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>
              {busy === payFor.inst.id ? 'Saving…' : 'Confirm payment received'}
            </button>
            <button onClick={() => setPayFor(null)}
              className="w-full mt-2 rounded-lg px-4 py-2 text-xs font-bold text-slate-400 hover:text-slate-600">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Deals pipeline (kanban with drag-and-drop) ----------------------------
function DealsPipeline({ user, onOpenLead }) {
  const [deals, setDeals] = useState([]);
  const [config, setConfig] = useState({ dealStages: [] });
  const [loading, setLoading] = useState(true);
  const [dragId, setDragId] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [board, cfg] = await Promise.all([api('/leads/deals/board'), api('/leads/config')]);
      setDeals(board.deals || []);
      setConfig(cfg.config || {});
    } catch (e) { console.error(e); }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const stages = config.dealStages || [];
  const fmtMoney = (d) => `${d.currency || ''} ${Number(d.amount || 0).toLocaleString()}`;

  const moveDeal = async (deal, toStage) => {
    if (deal.stage === toStage) return;
    // optimistic update
    setDeals((ds) => ds.map((d) => (d.id === deal.id ? { ...d, stage: toStage } : d)));
    try {
      await api(`/leads/${deal.leadId}/deals/${deal.id}`, { method: 'PATCH', body: JSON.stringify({ stage: toStage }) });
    } catch (e) { alert(e.message); load(); }
  };

  const stageTotal = (sid) => deals.filter((d) => d.stage === sid).reduce((sum, d) => sum + Number(d.amount || 0), 0);
  const paidInfo = (d) => {
    const insts = d.installments || [];
    if (insts.length <= 1) return null;
    const paid = insts.filter((i) => i.paid).length;
    return { paid, total: insts.length, pct: Math.round((paid / insts.length) * 100) };
  };

  if (loading) return <div className="text-slate-400 text-sm py-12 text-center">Loading pipeline…</div>;

  // Soft pastel header tint per column, derived from the stage colour.
  const softBg = (hex) => `${hex}14`;

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-extrabold text-[#050A1F]">Deals pipeline</h1>
        <div className="text-sm text-slate-400">{deals.length} deals · drag a card to move it between stages</div>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {stages.map((s) => {
          const col = deals.filter((d) => d.stage === s.id);
          return (
            <div key={s.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { const d = deals.find((x) => x.id === dragId); if (d) moveDeal(d, s.id); setDragId(null); }}
              className="shrink-0 w-72 rounded-3xl p-3"
              style={{ background: softBg(s.color) }}>
              {/* Column header — pill dot, label, count, and stage total */}
              <div className="flex items-center justify-between px-2 pt-1 pb-3">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                  <span className="text-sm font-extrabold text-[#050A1F]">{s.label}</span>
                  <span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-white/70" style={{ color: s.color }}>{col.length}</span>
                </div>
                <span className="text-[11px] font-bold text-slate-500">{col.length ? col[0].currency || '' : ''} {stageTotal(s.id).toLocaleString()}</span>
              </div>

              <div className="space-y-3 min-h-[160px]">
                {col.map((d) => {
                  const pinfo = paidInfo(d);
                  const pct = pinfo ? pinfo.pct : (d.stage === 'closed_won' ? 100 : 0);
                  // Priority label + tint mirrors the reference "Medium/High/Low"
                  // chip; we derive it from saleType/plan without changing data.
                  const prio = d.saleType === 'cross' ? { label: 'Cross-sell', bg: '#F3E8FF', fg: '#9333EA' }
                    : d.planType && d.planType !== 'one-time' ? { label: 'Recurring', bg: '#FFF4E5', fg: '#C2410C' }
                    : { label: 'New', bg: '#E7F6EF', fg: '#0F9D58' };
                  return (
                    <div key={d.id} draggable
                      onDragStart={() => setDragId(d.id)}
                      onClick={() => onOpenLead(d.leadId, 'deals')}
                      className="bg-white rounded-2xl border border-slate-100 p-4 cursor-grab active:cursor-grabbing hover:shadow-lg hover:-translate-y-0.5 transition-all">
                      {/* Priority chip */}
                      <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-md mb-2" style={{ background: prio.bg, color: prio.fg }}>{prio.label}</span>

                      {/* Title = deal / client name */}
                      <div className="font-extrabold text-sm text-[#050A1F] leading-snug">{d.name}</div>
                      {d.leadName && <div className="text-[11px] text-slate-400 mt-0.5 truncate">{d.leadName}{d.service ? ` · ${d.service}` : ''}</div>}

                      {/* Amount */}
                      <div className="text-lg font-extrabold text-[#050A1F] mt-2">{fmtMoney(d)}</div>

                      {/* Progress bar (installments collected, or stage completion) */}
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 mb-1">
                          <span>Progress</span>
                          <span>{pct}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(3, Math.min(100, pct))}%`, background: s.color }} />
                        </div>
                      </div>

                      {/* Footer meta: avatar initial, paid chip, expected close */}
                      <div className="flex items-center justify-between mt-3">
                        <div className="flex items-center gap-1.5">
                          <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold flex items-center justify-center">
                            {(d.ownerName || d.leadName || '?').trim()[0]?.toUpperCase()}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] font-semibold text-slate-400">
                          {pinfo && <span className="inline-flex items-center gap-1 text-green-600">💵 {pinfo.paid}/{pinfo.total}</span>}
                          {d.expectedClose && <span className="inline-flex items-center gap-1">📅 {d.expectedClose}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {col.length === 0 && <div className="text-[11px] text-slate-300 text-center py-10 border-2 border-dashed border-slate-200 rounded-2xl">Drop deals here</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

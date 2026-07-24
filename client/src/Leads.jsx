import React, { useState, useEffect } from 'react';
import { api } from './App.jsx';
import { API_BASE } from './config.js';
import { COUNTRY_NAMES, COUNTRY_TIMEZONES, formatPhone, dialFor } from './countries.js';
import { nowInZone, callWindow, toIST, tzShortLabel, dueLabel, daysLeftLabel, daysUntil, IST_LABEL } from './timezone.js';


/**
 * Inline SVG line icons. Defined as plain components (rather than built by a
 * factory) so they're trivially debuggable and evaluate lazily at render time.
 * They inherit text colour, so the same icon works on light and dark buttons.
 */
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


// ---------------------------------------------------------------------------
// Leads CRM — Phase 1: list (role-filtered by the API), single-lead create
// form, and the lead detail page shell (30/70 split with Basic Info, Tags,
// Description, Other Info, Last Modified on the left). Tabs on the right are
// scaffolded here and filled in Phase 2/3.
// ---------------------------------------------------------------------------

const fmtDate = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const fullName = (l) => `${l.firstName || ''} ${l.lastName || ''}`.trim() || '(no name)';

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

export function LeadsList({ user, onOpen, onNew, untouchedFilter, onClearUntouched }) {
  const [items, setItems] = useState([]);
  const [config, setConfig] = useState({ leadStatuses: [], leadSources: [] });
  const [owners, setOwners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  const [importing, setImporting] = useState(false);
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
      if (untouchedFilter) params.set('untouched', String(untouchedFilter));
      params.set('page', String(page));
      params.set('perPage', String(perPage));
      const [res, cfg] = await Promise.all([
        api(`/leads${params.toString() ? '?' + params.toString() : ''}`),
        api('/leads/config'),
      ]);
      setItems(res.items || []);
      setPageInfo({ total: res.total || 0, pages: res.pages || 1 });
      setConfig(cfg.config || {});
      setOwners(cfg.owners || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [untouchedFilter, page, perPage]);
  // Any filter change should send the user back to the first page.
  useEffect(() => { setPage(1); /* eslint-disable-next-line */ }, [statusFilter, ownerFilter, countryFilter, untouchedFilter]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold text-[#050A1F]">Leads</h1>
          {untouchedFilter && (
            <div className="mt-1 inline-flex items-center gap-2 rounded-full bg-red-50 text-red-600 px-3 py-1 text-xs font-bold">
              Showing leads untouched for {untouchedFilter}+ days
              <button onClick={onClearUntouched} className="hover:text-red-800">✕ clear</button>
            </div>
          )}
          <div className="text-sm text-slate-400">{items.length} total{user.role !== 'admin' ? ' · your visibility' : ''}</div>
        </div>
        <div className="flex items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()}
            placeholder="Search name, email, website…"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm w-60 focus:outline-none focus:ring-2 focus:ring-orange-400" />
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); }}
            className="rounded-lg border border-slate-300 px-2.5 py-2 text-sm">
            <option value="">All statuses</option>
            {(config.leadStatuses || []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-2.5 py-2 text-sm">
            <option value="">All owners</option>
            {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <select value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-2.5 py-2 text-sm max-w-[140px]">
            <option value="">All countries</option>
            {Array.from(new Set(items.map((l) => l.country).filter(Boolean))).sort().map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={load} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-600">Filter</button>
          {user.role === 'admin' && (
            <button onClick={() => setImporting(true)} title="Import leads from CSV"
              className="rounded-lg border border-slate-200 w-9 h-9 flex items-center justify-center text-slate-500 hover:border-slate-300 hover:bg-slate-50"><Icon.Upload size={16} /></button>
          )}
          <button onClick={onNew} className="rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>+ New lead</button>
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
                <th className="text-left px-4 py-3">Source</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Deals</th>
                <th className="text-left px-4 py-3">Owner</th>
                <th className="text-left px-4 py-3">Last activity</th>
                {user.role === 'admin' && <th className="px-4 py-3"></th>}
              </tr>
            </thead>
            <tbody>
              {items.map((l) => {
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
                          </div>
                          <div className="text-[11px] text-slate-400 truncate">{l.website || '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      <div className="text-xs truncate max-w-[180px]">{l.email || '—'}</div>
                      <div className="text-[11px] text-slate-400">{l.mobile || l.phone || ''}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{l.leadSource || '—'}</td>
                    <td className="px-4 py-3"><span className="rounded-full px-2.5 py-1 text-[10px] font-bold text-white" style={{ background: sm.color }}>{sm.label}</span></td>
                    <td className="px-4 py-3">
                      {deals.length === 0 ? <span className="text-slate-300 text-xs">—</span> : (
                        <div className="flex items-center gap-1.5">
                          {openDeals.length > 0 && <span className="rounded-md bg-blue-50 text-blue-600 px-1.5 py-0.5 text-[10px] font-bold">{openDeals.length} open</span>}
                          {wonDeals.length > 0 && <span className="rounded-md bg-green-50 text-green-600 px-1.5 py-0.5 text-[10px] font-bold">{wonDeals.length} won</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{l.ownerName}</td>
                    <td className={`px-4 py-3 text-xs ${stale ? (stale.level === 'red' ? 'text-red-500 font-semibold' : 'text-amber-600') : 'text-slate-400'}`}>{fmtDate(l.lastActivityAt)}</td>
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
export function NewLead({ user, onCreated, onCancel }) {
  const [config, setConfig] = useState({});
  const [owners, setOwners] = useState([]);
  const [f, setF] = useState({
    ownerId: user.id, firstName: '', lastName: '', website: '', email: '', secondaryEmail: '',
    mobile: '', phone: '', leadSource: '', generatedBy: '', status: 'new',
    servicesInterested: [], tags: [], country: '', city: '', timezone: '', additionalInfo: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/leads/config').then((r) => { setConfig(r.config || {}); setOwners(r.owners || []); }).catch(() => {});
  }, []);

  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const toggleArr = (k, v) => setF((s) => ({ ...s, [k]: s[k].includes(v) ? s[k].filter((x) => x !== v) : [...s[k], v] }));

  const submit = async () => {
    if (!f.firstName.trim()) { setError('First name is required.'); return; }
    setBusy(true); setError('');
    try {
      const lead = await api('/leads', { method: 'POST', body: JSON.stringify(f) });
      onCreated(lead);
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const canAssign = user.role === 'admin' || user.role === 'manager';
  const inp = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400';
  const lab = 'block text-[11px] font-bold text-slate-500 mb-1';

  return (
    <div className="max-w-3xl">
      <button onClick={onCancel} className="text-xs font-bold text-slate-400 hover:text-slate-600 mb-3">← Back to leads</button>
      <h1 className="text-2xl font-extrabold text-[#050A1F] mb-6">New lead</h1>
      {error && <div className="mb-4 rounded-lg bg-red-50 text-red-600 text-sm px-4 py-2">{error}</div>}

      <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-5">
        {/* Owner + country up top: country drives phone codes and timezone, so
            it belongs before the contact fields are filled in. */}
        <div className={`grid ${canAssign ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
          {canAssign && (
            <div>
              <label className={lab}>Lead owner</label>
              <select className={inp} value={f.ownerId} onChange={(e) => set('ownerId', Number(e.target.value))}>
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
          <div><label className={lab}>Website</label><input className={inp} value={f.website} onChange={(e) => set('website', e.target.value)} placeholder="https://…" /></div>
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
              {owners.map((o) => <option key={o.id} value={o.name}>{o.name}</option>)}
            </select>
          </div>
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

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={submit} disabled={busy} className="rounded-lg px-6 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>{busy ? 'Saving…' : 'Create lead'}</button>
        </div>
      </div>
    </div>
  );
}

// ---- Lead detail (shell; tabs filled in later phases) ----------------------
export function LeadDetail({ user, leadId, onBack, initialTab }) {
  const [lead, setLead] = useState(null);
  const [config, setConfig] = useState({});
  const [tab, setTab] = useState(initialTab || 'timeline');
  const [editSection, setEditSection] = useState(null); // 'all' | 'basic' | 'tags' | 'description' | 'other'
  const [draft, setDraft] = useState(null);
  const [quickModal, setQuickModal] = useState(null); // 'note' | 'task' | 'call' | 'deal'
  const [showBrief, setShowBrief] = useState(false);

  const load = async () => {
    try {
      const [res, cfg] = await Promise.all([api(`/leads/${leadId}`), api('/leads/config')]);
      setLead(res.lead); setConfig(cfg.config || {});
    } catch (e) { console.error(e); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [leadId]);

  if (!lead) return <div className="text-slate-400 text-sm py-12 text-center">Loading…</div>;

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
        <button onClick={onBack} className="text-xs font-bold text-slate-400 hover:text-slate-600">← Back to leads</button>
        <div className="flex items-center gap-2">
          {lead.timezone && <LeadLocalClock timezone={lead.timezone} />}
          {/* Reads the prospect's site and briefs the agent before they dial. */}
          <button onClick={() => setShowBrief(true)} disabled={!lead.website}
            title={lead.website ? 'AI business brief — what they do, what to pitch' : 'No website on this lead'}
            className="rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1.5 text-xs font-bold text-[#FF4500] inline-flex items-center gap-1.5 hover:bg-orange-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            <Icon.Sparkle size={14} /> <span className="hidden sm:inline">Brief</span>
          </button>
        </div>
      </div>
      {showBrief && <AiBriefModal lead={lead} onClose={() => setShowBrief(false)} />}

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
              <Row k="Website" v={lead.website} />
              <Row k="Secondary email" v={lead.secondaryEmail} />
              <Row k="Generated by" v={lead.generatedBy} />
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
            {['timeline', 'notes', 'activity', 'deals', 'reports'].map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-5 py-3 text-xs font-bold capitalize transition ${tab === t ? 'text-[#FF4500] border-b-2 border-[#FF4500]' : 'text-slate-400 hover:text-slate-600'}`}>{t}</button>
            ))}
          </div>
          <div className="p-5 min-h-[300px]">
            {tab === 'timeline' && <Timeline lead={lead} />}
            {tab === 'notes' && <NotesTab lead={lead} onChange={setLead} />}
            {tab === 'activity' && <ActivityTab lead={lead} config={config} user={user} onChange={setLead} />}
            {tab === 'deals' && <DealsTab lead={lead} config={config} user={user} onChange={setLead} />}
            {tab === 'reports' && <ReportsTab lead={lead} onChange={setLead} />}
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
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">What they do</div>
                <p className="text-sm text-slate-700">{b.summary}</p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {b.industry && <span className="rounded px-2 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-600">{b.industry}</span>}
                  {b.targetArea && <span className="rounded px-2 py-0.5 text-[10px] font-bold bg-blue-50 text-blue-600">📍 {b.targetArea}</span>}
                </div>
              </div>

              {/* Code-verified checks, kept visually distinct from AI opinion. */}
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">Site checks</div>
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
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Products &amp; services</div>
                  <div className="flex flex-wrap gap-1.5">
                    {b.offerings.map((o, i) => <span key={i} className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">{o}</span>)}
                  </div>
                </div>
              )}

              {(b.targetAudience || b.marketPosition) && (
                <div className="grid sm:grid-cols-2 gap-3">
                  {b.targetAudience && (
                    <div className="rounded-lg bg-slate-50 p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Their customers</div>
                      <p className="text-[11px] text-slate-600">{b.targetAudience}</p>
                    </div>
                  )}
                  {b.marketPosition && (
                    <div className="rounded-lg bg-slate-50 p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Market position</div>
                      <p className="text-[11px] text-slate-600">{b.marketPosition}</p>
                    </div>
                  )}
                </div>
              )}

              {b.keywords.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Keywords their customers search</div>
                  <div className="flex flex-wrap gap-1.5">
                    {b.keywords.map((k, i) => <span key={i} className="rounded-md bg-orange-50 px-2 py-1 text-[11px] font-semibold text-[#FF4500]">{k}</span>)}
                  </div>
                </div>
              )}

              {b.painPoints.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">Pain points to raise on the call</div>
                  <div className="space-y-2">
                    {b.painPoints.map((p, i) => (
                      <div key={i} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                        <div className="text-xs font-bold text-amber-900">{p.issue}</div>
                        <div className="text-[11px] text-amber-800 mt-0.5">{p.why}</div>
                        {p.mention && <div className="text-[11px] text-amber-700 mt-1 italic">“{p.mention}”</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {b.servicesToPitch.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">What to pitch</div>
                  <div className="space-y-1.5">
                    {b.servicesToPitch.map((s, i) => (
                      <div key={i} className="flex items-start gap-2 rounded-lg border border-slate-100 p-2.5">
                        <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase shrink-0 ${PRIORITY[s.priority] || PRIORITY.low}`}>{s.priority || 'low'}</span>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-[#050A1F]">{s.service}</div>
                          <div className="text-[11px] text-slate-500">{s.why}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {b.conversationStarters.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Opening lines</div>
                  <div className="space-y-1.5">
                    {b.conversationStarters.map((c, i) => (
                      <div key={i} className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-[11px] text-blue-800 italic">“{c}”</div>
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
  const icons = { created: '✨', status: '🏷️', owner: '👤', note: '📝', task: '✅', call: '📞', deal: '💰', report: '📄' };

  // An activity counts as missed once it is more than an hour past the agreed
  // time and still isn't done. We check the live activity list rather than the
  // timeline entry, so completing a call clears the flag immediately.
  const acts = Array.isArray(lead.activities) ? lead.activities : [];
  const GRACE = 60 * 60 * 1000;
  const now = Date.now();
  const missState = (e) => {
    if (!e.activityId || !e.scheduled) return null;
    const a = acts.find((x) => x.id === e.activityId);
    if (!a) return null;
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
            <div className="text-lg leading-none mt-0.5">{icons[e.type] || '•'}</div>
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
        className={`mt-0.5 h-4 w-4 rounded border shrink-0 ${a.status === 'done' ? 'bg-green-500 border-green-500 text-white' : 'border-slate-300'}`}>
        {a.status === 'done' ? '✓' : ''}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm">{a.kind === 'call' ? '📞' : '✅'}</span>
          <span className={`text-sm font-semibold ${a.status === 'done' ? 'line-through text-slate-400' : 'text-slate-700'}`}>{a.title}</span>
          {a.kind === 'task' && a.priority && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${a.priority === 'Urgent' ? 'bg-red-100 text-red-600' : a.priority === 'High' ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-500'}`}>{a.priority}</span>}
          {overdue(a) && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-600">OVERDUE</span>}
          {dueToday(a) && !overdue(a) && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">TODAY</span>}
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
    </div>
  );
}

function ActivityModal({ kind, lead, config, onClose, onSaved }) {
  const isCall = kind === 'call';
  const [f, setF] = useState({
    mode: 'scheduled', agenda: '', title: '', date: '', time: '',
    timezone: lead.timezone || '',
    description: '', priority: 'Medium', dueDate: '', reminderOn: false, durationMin: '',
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
      const updated = await api(`/leads/${lead._id}/activities`, { method: 'POST', body: JSON.stringify(body) });
      onSaved(updated);
    } catch (e) { alert(e.message); }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-[#050A1F] mb-4">{isCall ? '📞 Add call' : '✅ Add task'}</h3>

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
            <div><label className={lab}>Website</label><input className={inp} value={draft.website || ''} onChange={(e) => set('website', e.target.value)} /></div>
            <div><label className={lab}>Secondary email</label><input className={inp} value={draft.secondaryEmail || ''} onChange={(e) => set('secondaryEmail', e.target.value)} /></div>
            <div>
              <label className={lab}>Generated by</label>
              <input className={inp} value={draft.generatedBy || ''} onChange={(e) => set('generatedBy', e.target.value)} />
            </div>
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
  const togglePaid = async (deal, inst, e) => {
    e.stopPropagation();
    setBusyInst(inst.id);
    try {
      const u = await api(`/leads/${lead._id}/deals/${deal.id}/installments/${inst.id}`, {
        method: 'PATCH', body: JSON.stringify({ paid: !inst.paid }),
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
                              <span className="flex-1 text-green-700 font-semibold">✓ paid {it.paidDate || ''}</span>
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
                              </span>
                            )}

                            <button onClick={(e) => togglePaid(d, it, e)} disabled={busyInst === it.id}
                              className={`rounded px-2 py-1 text-[10px] font-bold shrink-0 disabled:opacity-50 ${it.paid ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-[#050A1F] text-white hover:opacity-90'}`}>
                              {busyInst === it.id ? '…' : it.paid ? 'Paid' : 'Mark paid'}
                            </button>
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
              <label className={lab}>Plan type</label>
              <select className={inp} value={f.planType} onChange={(e) => set('planType', e.target.value)}>
                <option value="one-time">One-time (project)</option>
                <option value="3-month">3-month plan</option>
                <option value="6-month">6-month plan</option>
                <option value="12-month">12-month plan</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div>
              <label className={lab}>Stage</label>
              <select className={inp} value={f.stage} onChange={(e) => set('stage', e.target.value)}>
                {(config.dealStages || []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lab}>Currency</label>
              <select className={inp} value={f.currency} onChange={(e) => set('currency', e.target.value)}>
                {(config.dealCurrencies || ['USD']).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div><label className={lab}>Total amount</label><input type="number" className={inp} value={f.amount} onChange={(e) => set('amount', e.target.value)} /></div>
          </div>
          <div><label className={lab}>Expected / actual closing date</label><input type="date" className={inp} value={f.expectedClose} onChange={(e) => set('expectedClose', e.target.value)} /></div>

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
function ReportsTab({ lead, onChange }) {
  const [reports, setReports] = useState(null);
  useEffect(() => {
    api(`/leads/${lead._id}`).then((r) => setReports(r.reports || [])).catch(() => setReports([]));
  }, [lead._id]);
  const openReport = (r) => window.open(`${API_BASE}/api/reports/${r._id}/view?token=${localStorage.getItem('qtx_token')}`, '_blank');
  const download = (r) => window.open(`${API_BASE}/api/reports/${r._id}/download?token=${localStorage.getItem('qtx_token')}`, '_blank');
  if (reports === null) return <div className="text-slate-400 text-sm py-12 text-center">Loading…</div>;
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div className="text-sm text-slate-500">{reports.length} report{reports.length === 1 ? '' : 's'} linked</div>
        <a href={`/?leadRun=${lead._id}`} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>▶ Run report</a>
      </div>
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
  const [activeId, setActiveId] = useState(initialLeadId || null);
  const [untouched, setUntouched] = useState(initialUntouched || null);
  const [detailTab, setDetailTab] = useState(null);
  // `tab` lets callers deep-link straight to a section (e.g. the Deals tab when
  // a deal is clicked from the pipeline or converted-clients page).
  const openDetail = (id, tab) => { setActiveId(id); setDetailTab(tab || null); setView('detail'); };
  const isManagerOrAdmin = user.role === 'admin' || user.role === 'manager';
  return (
    <div>
      {(view === 'list' || view === 'pipeline' || view === 'converted') && (
        <div className="flex items-center gap-1 mb-5 bg-slate-100 rounded-lg p-1 w-fit">
          <button onClick={() => setView('list')} className={`px-4 py-1.5 rounded-md text-xs font-bold ${view === 'list' ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>📋 List</button>
          <button onClick={() => setView('pipeline')} className={`px-4 py-1.5 rounded-md text-xs font-bold ${view === 'pipeline' ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>📊 Deals pipeline</button>
          {isManagerOrAdmin && <button onClick={() => setView('converted')} className={`px-4 py-1.5 rounded-md text-xs font-bold ${view === 'converted' ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>✅ Converted</button>}
        </div>
      )}
      {view === 'list' && <LeadsList user={user} untouchedFilter={untouched} onClearUntouched={() => setUntouched(null)} onOpen={(l) => openDetail(l._id)} onNew={() => setView('new')} />}
      {view === 'pipeline' && <DealsPipeline user={user} onOpenLead={openDetail} />}
      {view === 'converted' && <ConvertedLeads user={user} onOpen={openDetail} thisMonthOnly={initialConvertedMonth} />}
      {view === 'new' && <NewLead user={user} onCreated={(l) => openDetail(l._id)} onCancel={() => setView('list')} />}
      {view === 'detail' && activeId && <LeadDetail user={user} leadId={activeId} initialTab={detailTab} onBack={() => setView(initialView === 'converted' ? 'converted' : 'list')} />}
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

  // Mark the next outstanding installment as received, straight from the card.
  const collect = async (lead, deal, inst, gateway) => {
    setBusy(inst.id);
    try {
      const u = await api(`/leads/${lead._id}/deals/${deal.id}/installments/${inst.id}`, {
        method: 'PATCH', body: JSON.stringify({ paid: true, ...(gateway ? { gateway } : {}) }),
      });
      setItems((list) => list.map((x) => (x._id === u._id ? u : x)));
      setPayFor(null);
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
    // A deal counts towards the money figures once it is Closed Won *or* once
    // any installment has actually been collected. Marking a payment now
    // auto-promotes the deal to Closed Won, but older deals (and anything an
    // admin drags back to an open stage) would otherwise vanish from the
    // totals and make Outstanding read a misleading zero.
    const hasPayment = (d) => (d.installments || []).some((it) => it.paid);
    const won = (l.deals || []).filter((d) => d.stage === 'closed_won' || (d.stage !== 'closed_lost' && hasPayment(d)));
    const open = (l.deals || []).filter((d) => d.stage !== 'closed_won' && d.stage !== 'closed_lost' && !hasPayment(d));
    let booked = 0, collected = 0, instTotal = 0, instPaid = 0, nextDue = null;
    const pending = [];
    for (const d of won) {
      const isRecurring = d.planType === 'recurring';
      // A one-off sale books its whole value up front, so outstanding = booked
      // minus collected. A recurring contract has no total — future cycles are
      // not a debt the client owes — so it books only what has actually been
      // billed and collected, and its upcoming dates show as reminders rather
      // than as money outstanding.
      if (!isRecurring) booked += toUsd(d.amount, d.currency);
      for (const it of (d.installments || [])) {
        instTotal++;
        if (it.paid) {
          instPaid++;
          collected += toUsd(it.amount, d.currency);
          if (isRecurring) booked += toUsd(it.amount, d.currency);
        } else {
          pending.push({ deal: d, inst: it, recurring: isRecurring });
          if (it.dueDate && (!nextDue || it.dueDate < nextDue)) nextDue = it.dueDate;
        }
      }
    }
    // Soonest due first, undated last, so the most urgent chase is at the top.
    pending.sort((a, b) => String(a.inst.dueDate || '9999').localeCompare(String(b.inst.dueDate || '9999')));
    return {
      won, open, booked: Math.round(booked), collected: Math.round(collected),
      due: Math.round(booked - collected), instTotal, instPaid, nextDue,
      pending, nextInst: pending[0] || null,
    };
  };

  const filtered = items
    .filter((l) => (q ? (fullName(l) + ' ' + (l.website || '') + ' ' + (l.ownerName || '')).toLowerCase().includes(q.toLowerCase()) : true));

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
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((l) => {
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
                        Outstanding payments · {s.pending.length}
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
                                <button onClick={(e) => { e.stopPropagation(); collect(l, deal, inst); }}
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
      )}

      {/* Full client table — easier to scan than cards once the list grows. */}
      {filtered.length > 0 && (
        <div className="mt-6">
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
                                  <button
                                    onClick={() => setPayFor({ lead: l, deal: d, inst: it })}
                                    disabled={busy === it.id}
                                    className="rounded-md px-3 py-1.5 text-[11px] font-bold text-white inline-flex items-center gap-1 disabled:opacity-50 shrink-0"
                                    style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>
                                    <Icon.Money size={12} /> {busy === it.id ? 'Saving…' : 'Mark paid'}
                                  </button>
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
            <div className="space-y-2">
              {['PayPal', 'Stripe', 'Wire Transfer'].map((g) => (
                <button key={g}
                  disabled={busy === payFor.inst.id}
                  onClick={() => collect(payFor.lead, payFor.deal, payFor.inst, g)}
                  className="w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 hover:border-orange-300 hover:bg-orange-50 hover:text-[#FF4500] transition-colors disabled:opacity-50">
                  {g}
                </button>
              ))}
            </div>
            <button onClick={() => setPayFor(null)}
              className="w-full mt-3 rounded-lg px-4 py-2 text-xs font-bold text-slate-400 hover:text-slate-600">
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
    return `${paid}/${insts.length} paid`;
  };

  if (loading) return <div className="text-slate-400 text-sm py-12 text-center">Loading pipeline…</div>;

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-extrabold text-[#050A1F]">Deals pipeline</h1>
        <div className="text-sm text-slate-400">{deals.length} deals · drag a card to move it between stages</div>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {stages.map((s) => {
          const col = deals.filter((d) => d.stage === s.id);
          return (
            <div key={s.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { const d = deals.find((x) => x.id === dragId); if (d) moveDeal(d, s.id); setDragId(null); }}
              className="shrink-0 w-64 bg-slate-50/70 rounded-2xl border border-slate-100">
              <div className="px-3 py-2.5 rounded-t-2xl flex items-center justify-between" style={{ background: s.color + '12' }}>
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                  <span className="text-xs font-bold text-[#050A1F]">{s.label}</span>
                </div>
                <span className="text-[10px] font-bold rounded-full px-2 py-0.5" style={{ background: s.color + '22', color: s.color }}>{col.length}</span>
              </div>
              <div className="px-3 py-1.5 text-[11px] font-bold text-slate-500 border-b border-slate-100">{col.length ? col[0].currency || '' : ''} {stageTotal(s.id).toLocaleString()}</div>
              <div className="p-2 space-y-2 min-h-[140px]">
                {col.map((d) => {
                  const pinfo = paidInfo(d);
                  return (
                    <div key={d.id} draggable
                      onDragStart={() => setDragId(d.id)}
                      onClick={() => onOpenLead(d.leadId, 'deals')}
                      className="bg-white rounded-xl border border-slate-200 p-3 cursor-grab active:cursor-grabbing hover:shadow-md hover:border-orange-200 transition">
                      <div className="flex items-start justify-between gap-1">
                        <div className="font-bold text-xs text-[#050A1F] truncate">{d.name}</div>
                        {d.saleType === 'cross' && <span className="text-[8px] font-bold bg-purple-100 text-purple-600 px-1 rounded shrink-0">CROSS</span>}
                      </div>
                      <div className="text-sm font-extrabold text-[#050A1F] mt-1">{fmtMoney(d)}</div>
                      <div className="text-[10px] text-slate-400 mt-1 truncate">{d.leadName}{d.service ? ` · ${d.service}` : ''}</div>
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        {d.planType && d.planType !== 'one-time' && <span className="text-[9px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{d.planType}</span>}
                        {pinfo && <span className="text-[9px] font-bold bg-green-50 text-green-600 px-1.5 py-0.5 rounded">💵 {pinfo}</span>}
                        {d.expectedClose && <span className="text-[9px] text-slate-400">📅 {d.expectedClose}</span>}
                      </div>
                    </div>
                  );
                })}
                {col.length === 0 && <div className="text-[11px] text-slate-300 text-center py-8">Drop deals here</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

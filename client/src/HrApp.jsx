import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { API_BASE } from './config.js';
import { AddUserModal, ImageKitSection, ProfilePage, EmployeeDirectory, Field as SharedField, Avatar, ROLE_LABELS, ROLE_OPTIONS, ROLE_LEVEL, Icon, titleCase, uploadToImageKit } from './HrParts.jsx';
import HrExpenses from './HrExpenses.jsx';
import { Pagination, MailEditor } from './Leads.jsx';
import HrJobBuilder from './HrJobBuilder.jsx';
import { AppSwitcher } from './AppSwitcher.jsx';
import AllEmailPage from './AllEmailPage.jsx';
import HrCandidateView from './HrCandidateView.jsx';
import HrSurveyAdmin, { HrSurveyGate } from './HrSurvey.jsx';
import LeaveConsole from './HrLeaveConsole.jsx';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';

const inp = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400';

// HR portal — deliberately self-contained and separate from the Site Analysis
// app. It talks only to /api/hr/* and stores its own token, so nothing here can
// affect the CRM module.

const HR_TOKEN_KEY = 'qtx_hr_token';

export const hrApi = async (path, opts = {}) => {
  const token = localStorage.getItem(HR_TOKEN_KEY);
  const res = await fetch(`${API_BASE}/api/hr${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const err = new Error(data.error || 'Something went wrong.'); err.status = res.status; throw err; }
  return data;
};

// Like hrApi, but returns raw response text (used for HTML email previews).
export const hrApiRaw = async (path, opts = {}) => {
  const token = localStorage.getItem(HR_TOKEN_KEY);
  const res = await fetch(`${API_BASE}/api/hr${path}`, {
    ...opts,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error('Could not load preview.');
  return text;
};

const ORANGE = 'linear-gradient(90deg,#FF6A00,#FF4500)';
// URL base for the HR app. On the HRMS domain (people.qtonix.com) the app is
// mounted at the clean root, so there's no prefix and URLs are /dashboard. On
// any other host it lives under /hr, so URLs are /hr/dashboard.
const HR_BASE = (typeof window !== 'undefined' && window.__SURFACE__ === 'hrms') ? '' : '/hr';

// Normalise a phone number to a consistent format. A bare 10-digit Indian mobile
// gets a +91 prefix; numbers that already carry a country code are kept. Returns
// the input unchanged if it doesn't look like a standard number.
export function normalizePhone(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  if (s.startsWith('+')) { const d = s.slice(1).replace(/\D/g, ''); return d ? `+${d}` : ''; }
  const digits = s.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+91${digits}`;           // bare Indian mobile
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`; // 91XXXXXXXXXX
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`; // leading 0
  return `+${digits}`;
}

// Pretty phone for display: +91 9812-345-678 for a normalised Indian number,
// otherwise a light grouping of the digits. Never throws on odd input.
export function formatPhone(raw) {
  if (!raw) return '—';
  const norm = normalizePhone(raw);
  const m = norm.match(/^\+91(\d{10})$/);
  if (m) { const d = m[1]; return `+91 ${d.slice(0, 4)}-${d.slice(4, 7)}-${d.slice(7)}`; }
  return norm || String(raw);
}

// Shorten a long job title so the candidate table stays within its column.
// Keeps the meaningful head of the title and trims trailing qualifiers.
export function shortTitle(title) {
  if (!title) return '—';
  let t = String(title).trim();
  // Drop common bracketed/after-dash qualifiers e.g. "(Remote)", " - Bhubaneswar".
  t = t.replace(/\s*[\(\[].*?[\)\]]\s*/g, ' ').replace(/\s*[-–—|].*$/, '').trim();
  if (t.length > 22) t = t.slice(0, 21).trimEnd() + '…';
  return t || '—';
}
const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF6A00] focus:border-transparent';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// --- Login ------------------------------------------------------------------

function HrLogin({ onSignIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(''); setBusy(true);
    try {
      const data = await hrApi('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      localStorage.setItem(HR_TOKEN_KEY, data.token);
      onSignIn(data.user);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#050A1F] px-4" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-3xl font-extrabold text-white tracking-tight">Qtonix<span className="text-[#FF6A00]">.</span></div>
          <p className="text-slate-400 text-sm mt-2">HR &amp; Recruitment</p>
        </div>
        <div className="bg-white rounded-2xl p-7 shadow-2xl">
          <h1 className="text-xl font-bold text-[#050A1F] mb-1">HR Portal sign in</h1>
          <p className="text-sm text-slate-500 mb-6">For HR staff and administrators.</p>
          {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">{error}</div>}
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()}
            className={inputCls + ' mb-4'} placeholder="you@qtonix.com" />
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()}
            className={inputCls + ' mb-6'} placeholder="••••••••" />
          <button onClick={submit} disabled={busy || !email || !password}
            className="w-full rounded-lg py-2.5 text-sm font-bold text-white disabled:opacity-40 transition" style={{ background: ORANGE }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
        <div className="text-center mt-5">
          <a href="/go/crm" className="text-xs font-bold text-slate-400 hover:text-[#FF6A00] transition">← Site Analysis Portal</a>
        </div>
      </div>
    </div>
  );
}

// --- Dashboard --------------------------------------------------------------

const MISSED_ICON = { feedback: '📝', call: '📞', task: '✅', schedule: '📅', selfschedule: '🔗' };
// Compact age like "3h", "2d 4h".
function fmtAgeH(ms) {
  const h = Math.floor(ms / 3600000);
  if (h < 1) return '<1h';
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24); const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}


// Post a company announcement (admins + permitted HR).
function AnnouncementModal({ onClose, onSaved }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [audience, setAudience] = useState('all');
  const [branches, setBranches] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { hrApi('/branches').then((r) => setBranches(Array.isArray(r) ? r : (r.branches || []))).catch(() => {}); }, []);
  const save = async () => {
    if (!title.trim()) return setErr('A title is required.');
    setSaving(true); setErr('');
    try { await hrApi('/announcements', { method: 'POST', body: JSON.stringify({ title, body, pinned, audience }) }); onSaved(); }
    catch (e) { setErr(e.message); setSaving(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="text-lg font-extrabold text-[#050A1F]">📢 Post announcement</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        <div className="p-6 space-y-3">
          {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{err}</div>}
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className={inputCls} />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="Write your announcement…" className={inputCls} />
          <div>
            <div className="text-xs font-bold text-slate-500 mb-1">Audience</div>
            <select value={audience} onChange={(e) => setAudience(e.target.value)} className={inputCls}>
              <option value="all">All employees</option>
              {branches.map((b) => <option key={b._id || b.name} value={b.name}>{b.name} employees</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pin to top</label>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={save} disabled={saving} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: '#050A1F' }}>{saving ? 'Posting…' : 'Post to notice board'}</button>
        </div>
      </div>
    </div>
  );
}

// ===== HR Manager — Daily Console =========================================
// A mostly-automated daily workspace: an auto-collected snapshot (attendance,
// recruitment, new joiners, probation, notice), an auto-appearing checklist,
// self/assigned tasks, manual notes, and a one-click end-of-day report emailed
// to admin. Auto data is READ-ONLY — she reviews numbers, not types them.
// ===== Task boards (Asana-style) — admin-gated for now ====================
const PRIO = { urgent: { label: 'Urgent', cls: 'bg-red-100 text-red-700' }, high: { label: 'High', cls: 'bg-orange-100 text-orange-700' }, medium: { label: 'Medium', cls: 'bg-blue-100 text-blue-700' }, low: { label: 'Low', cls: 'bg-slate-100 text-slate-600' } };
const STAGE = { not_started: { label: 'Not started', cls: 'bg-slate-100 text-slate-600' }, in_progress: { label: 'In progress', cls: 'bg-amber-100 text-amber-700' }, completed: { label: 'Completed', cls: 'bg-green-100 text-green-700' } };
// Solid-fill cell colors (monday.com style) for the Priority + Status columns.
const PRIO_FILL = { urgent: '#EF4444', high: '#F97316', medium: '#3B82F6', low: '#94A3B8' };
const STAGE_FILL = { not_started: '#94A3B8', in_progress: '#F59E0B', completed: '#22C55E' };
// Strip TipTap/HTML to a short plain-text preview for the task list cell.
function plainPreview(html) {
  if (!html) return '';
  let s = String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')          // drop tags
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
  return s;
}

function TAvatar({ person, size = 24 }) {
  if (!person) return <div className="rounded-full bg-slate-200" style={{ width: size, height: size }} />;
  const initials = (person.name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return person.avatar
    ? <img src={person.avatar} alt={person.name} className="rounded-full object-cover" style={{ width: size, height: size }} />
    : <div className="rounded-full bg-orange-100 text-orange-600 flex items-center justify-center font-bold" style={{ width: size, height: size, fontSize: size * 0.4 }}>{initials}</div>;
}

// Searchable assignee picker (scoped by backend to who the actor may assign to).
function AssigneePicker({ value, onChange, allowClear, compact }) {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState([]);
  const [q, setQ] = useState('');
  const btnRef = useRef(null);
  const [pos, setPos] = useState(null); // fixed-position coords so the dropdown escapes overflow-hidden cells
  useEffect(() => { if (open) hrApi(`/tasks/assignable?q=${encodeURIComponent(q)}`).then(setPeople).catch(() => setPeople([])); }, [open, q]);
  // Position the popover under the button using viewport coords (fixed), so it
  // isn't clipped by the grid cell's overflow. Recomputed on open + scroll.
  useEffect(() => {
    if (!open) return;
    const place = () => { const r = btnRef.current && btnRef.current.getBoundingClientRect(); if (r) setPos({ top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 268) }); };
    place();
    window.addEventListener('scroll', place, true); window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open]);
  return (
    <div className="relative w-full min-w-0">
      <button ref={btnRef} onClick={() => setOpen((o) => !o)} className={compact ? 'flex items-center gap-1.5 text-xs hover:bg-slate-100 rounded px-1 py-0.5 w-full min-w-0' : 'flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50 w-full min-w-0'}>
        {value ? <><TAvatar person={value} size={20} /><span className="text-xs text-slate-600 truncate min-w-0">{titleCase(value.name)}</span></> : <span className="text-slate-400 truncate">Assign…</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[59]" onClick={() => setOpen(false)} />
          <div className="fixed z-[60] w-64 bg-white rounded-xl shadow-xl border border-slate-200 p-2" style={{ top: pos ? pos.top : 0, left: pos ? pos.left : 0 }}>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…" className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs mb-1 focus:outline-none focus:ring-2 focus:ring-orange-300" />
            <div className="max-h-56 overflow-auto">
              {allowClear && <button onClick={() => { onChange(null); setOpen(false); }} className="w-full text-left px-2 py-1.5 text-xs text-slate-400 hover:bg-slate-50 rounded-lg">Unassigned</button>}
              {people.map((p, i) => {
                const prev = people[i - 1];
                const showOwnHdr = i === 0 && p.own;
                const showCrossHdr = !p.own && (i === 0 || (prev && prev.own));
                return (
                  <React.Fragment key={p.id}>
                    {showOwnHdr && <div className="px-2 pt-1 pb-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-300">My team</div>}
                    {showCrossHdr && <div className="px-2 pt-2 pb-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-300 border-t border-slate-100 mt-1">Other departments</div>}
                    <button onClick={() => { onChange(p); setOpen(false); setQ(''); }} className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded-lg text-left">
                      <TAvatar person={p} size={24} />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-[#050A1F] truncate">{titleCase(p.name)}{!p.own && p.deptLabel && <span className="text-slate-400 font-normal"> · {p.deptLabel}</span>}</div>
                        <div className="text-[10px] text-slate-400 truncate">{p.designation || p.department}</div>
                      </div>
                    </button>
                  </React.Fragment>
                );
              })}
              {people.length === 0 && <div className="text-xs text-slate-400 px-2 py-3 text-center">No people found.</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Pill({ map, value }) { const m = map[value] || { label: value, cls: 'bg-slate-100 text-slate-600' }; return <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${m.cls}`}>{m.label}</span>; }

// Asana "My Tasks"-style two-way board: five fixed buckets + a tracking list.
// Drag tasks between buckets (native HTML5 DnD). Bucket = scheduling; Stage =
// progress (independent). Admin picks whose board to view.
const BUCKETS = [
  { key: 'recently_assigned', label: 'Recently Assigned' },
  { key: 'today', label: 'Do Today' },
  { key: 'tomorrow', label: 'Do Tomorrow' },
  { key: 'next_week', label: 'Do Next Week' },
  { key: 'later', label: 'Do Later' },
];

// ===== Recognition page =====
// A visible home for giving appreciation / reviews / cards. Shows the people the
// current user can recognize (their reports, or everyone for HR/admin), plus a
// recent-recognition feed.
const REC_PERF = { praise: { label: 'Appreciation', icon: '🌟', bg: '#DCFCE7', fg: '#15803D' }, review: { label: 'Review', icon: '📝', bg: '#EFF6FF', fg: '#2563EB' }, yellow: { label: 'Yellow card', icon: '🟨', bg: '#FEF9C3', fg: '#CA8A04' }, red: { label: 'Red card', icon: '🟥', bg: '#FEE2E2', fg: '#DC2626' } };

// The employee's own recognition: 4 stat boxes + a paginated list of everything
// they've received. Closes on the × button or a click outside.
function MyRecognitionModal({ data, onClose }) {
  const [page, setPage] = useState(1);
  const perPage = 6;
  const cards = (data && data.cards) || [];
  const counts = (data && data.counts) || { praise: 0, review: 0, yellow: 0, red: 0 };
  const pages = Math.max(1, Math.ceil(cards.length / perPage));
  const rows = cards.slice((page - 1) * perPage, page * perPage);
  const fmt = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return d; } };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-[130] p-4 overflow-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-xl shadow-2xl my-6 flex flex-col max-h-[88vh]" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="text-lg font-extrabold text-[#050A1F]">🏅 My Recognition</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">×</button>
        </div>
        <div className="p-6 overflow-auto">
          <div className="grid grid-cols-4 gap-2.5 mb-5">
            {[['praise', 'Appreciations'], ['review', 'Reviews'], ['yellow', 'Yellow'], ['red', 'Red']].map(([k, label]) => (
              <div key={k} className="rounded-xl border p-3 text-center" style={{ background: REC_PERF[k].bg, borderColor: REC_PERF[k].fg + '33' }}>
                <div className="text-2xl font-extrabold" style={{ color: REC_PERF[k].fg }}>{counts[k] || 0}</div>
                <div className="text-[9px] font-bold uppercase tracking-wide" style={{ color: REC_PERF[k].fg }}>{label}</div>
              </div>
            ))}
          </div>
          {cards.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">No recognition yet. Your appreciations, reviews and badges will appear here.</div>
          ) : (
            <div className="space-y-1">
              {rows.map((c) => {
                const meta = REC_PERF[c.kind] || REC_PERF.review;
                const icon = c.badge ? c.badge.icon : meta.icon;
                return (
                  <div key={c.id} className="flex items-start gap-3 py-3 border-t border-slate-50 first:border-0">
                    <span className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-base" style={{ background: c.badge ? (c.badge.color + '22') : meta.bg }}>{icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-[#050A1F]">{c.title || meta.label}</span>
                        <span className="text-[9px] font-extrabold rounded-full px-2 py-0.5" style={{ background: meta.bg, color: meta.fg }}>{meta.label.toUpperCase()}</span>
                        {c.auto && <span className="text-[9px] font-extrabold rounded px-1.5 py-0.5" style={{ background: '#EDE9FE', color: '#7C3AED' }}>AUTO</span>}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">{c.auto ? 'Automatic' : `by ${c.by || 'HR'}`}{c.byRole ? ` (${c.byRole})` : ''} · {fmt(c.date)}</div>
                      {c.note && <div className="text-[13px] text-slate-500 mt-1 whitespace-pre-wrap">{c.note}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {pages > 1 && (
          <div className="px-6 py-3.5 border-t border-slate-100 flex items-center justify-between">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="rounded-lg border border-slate-300 px-3 py-1.5 text-[13px] font-bold text-slate-600 disabled:opacity-40">‹ Prev</button>
            <span className="text-[12px] text-slate-400">Page {page} of {pages} · {cards.length} items</span>
            <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page === pages} className="rounded-lg border border-slate-300 px-3 py-1.5 text-[13px] font-bold text-slate-600 disabled:opacity-40">Next ›</button>
          </div>
        )}
      </div>
    </div>
  );
}

const REC_BADGE_FALLBACK = { icon: '🌟', color: '#EA580C' };

// ===== My Rewards — the employee's reward wallet, points & history =====
function MyRewardsPage({ user, embedded }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('wallet');
  useEffect(() => { hrApi('/me/rewards').then(setData).catch(() => setData({ wallet: {}, ledger: [] })); }, []);
  if (!data) return <div className={embedded ? 'text-slate-400 text-sm py-8' : 'max-w-4xl mx-auto px-4 py-8 text-slate-400 text-sm'}>Loading…</div>;
  const w = data.wallet || {};
  const fmt = (d) => { try { return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } };
  const catIcon = { badge: '🏅', automatic: '🎁', anniversary: '🎊', attendance: '📅', appreciation: '❤️', helping: '❤️', innovation: '💡', performance: '🎯' };
  return (
    <div className={embedded ? '' : 'max-w-4xl mx-auto px-4 py-6'}>
      {!embedded && <div className="text-xl font-extrabold text-[#050A1F] flex items-center gap-2 mb-4">⭐ My Rewards</div>}
      <div className="flex gap-1 border-b border-slate-200 mb-5">
        {[['wallet', 'Wallet'], ['helping', '🤝 Helping Hand'], ['ideas', '💡 Ideas'], ['leaderboards', '🏆 Leaderboards']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className="px-3.5 py-1.5 text-[12px] font-extrabold border-b-2 -mb-px" style={{ borderColor: tab === id ? '#FF6A00' : 'transparent', color: tab === id ? '#050A1F' : '#94A3B8' }}>{label}</button>
        ))}
      </div>
      {tab === 'helping' && <HelpingHandView />}
      {tab === 'ideas' && <MyIdeasView />}
      {tab === 'leaderboards' && <LeaderboardsView onOpenEmployee={() => {}} />}
      {tab === 'wallet' && <></>}
      {tab === 'wallet' && <>
      <div className="grid md:grid-cols-3 gap-4 mb-5">
        <div className="rounded-2xl p-5 text-white relative overflow-hidden" style={{ background: 'linear-gradient(120deg,#0A0E28,#0435AC)' }}>
          <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: '#9fb4dd' }}>Reward Wallet</div>
          <div className="text-4xl font-extrabold mt-1 leading-none">{(w.balance || 0).toLocaleString('en-IN')}</div>
          <div className="text-sm font-bold mt-2" style={{ color: '#ffd9b8' }}>💰 ₹{(w.rupeeValue || 0).toLocaleString('en-IN')} reward value</div>
          {w.reserved > 0 && <div className="text-[11px] mt-1" style={{ color: '#9fb4dd' }}>{w.reserved} reserved for pending redemptions</div>}
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <div className="text-2xl font-extrabold text-green-600">{((data.thisYear || {}).earned || 0).toLocaleString('en-IN')}</div>
          <div className="text-[11px] text-slate-400 font-bold uppercase mt-0.5">Earned this year</div>
          <div className="text-[11px] text-slate-400 mt-2">Lifetime earned: {(w.lifetimeEarned || 0).toLocaleString('en-IN')}</div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <div className="text-2xl font-extrabold text-blue-600">{(w.lifetimeRedeemed || 0).toLocaleString('en-IN')}</div>
          <div className="text-[11px] text-slate-400 font-bold uppercase mt-0.5">Redeemed</div>
          <div className="text-[11px] text-slate-400 mt-2">Expired: {(w.lifetimeExpired || 0).toLocaleString('en-IN')}</div>
        </div>
      </div>
      {data.expiringSoon > 0 && (
        <div className="rounded-xl px-4 py-3 mb-5 text-sm font-semibold" style={{ background: '#FFF7ED', border: '1px solid #FED7AA', color: '#9a3412' }}>⚠️ {data.expiringSoon.toLocaleString('en-IN')} points expire in the next 90 days.</div>
      )}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="text-sm font-extrabold text-[#050A1F] mb-3">📒 Point Ledger</div>
        {(data.ledger || []).length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">No reward points yet. Earn points through recognition, badges and milestones!</div>
        ) : (
          <div className="space-y-1">
            {(data.ledger || []).map((l) => (
              <div key={l.id} className="flex items-center gap-3 py-2.5 border-t border-slate-50 first:border-0">
                <span className="w-9 h-9 rounded-lg flex items-center justify-center text-base shrink-0" style={{ background: l.points > 0 ? '#DCFCE7' : '#FEE2E2' }}>{catIcon[l.category] || (l.points > 0 ? '➕' : '➖')}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold text-[#0A0E28]">{l.title || l.category || 'Reward'}</div>
                  <div className="text-[11px] text-slate-400">{fmt(l.date)}{l.by && l.by !== 'System' ? ` · by ${l.by}${l.byRole ? ` (${l.byRole})` : ''}` : (l.kind === 'reversal' ? ' · Reversal' : ' · Automatic')}</div>
                </div>
                <span className={`font-extrabold text-sm shrink-0 ${l.points > 0 ? 'text-green-600' : 'text-red-600'}`}>{l.points > 0 ? '+' : ''}{l.points.toLocaleString('en-IN')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      </>}
    </div>
  );
}

// Employee: nominate a colleague for a Helping Hand + see given/received.
function HelpingHandView() {
  const [data, setData] = useState(null);
  const [team, setTeam] = useState([]);
  const [show, setShow] = useState(false);
  const [benef, setBenef] = useState(null);
  const [reason, setReason] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => hrApi('/helping/mine').then(setData).catch(() => setData({ given: [], received: [] }));
  useEffect(() => { load(); hrApi('/helping/colleagues').then((r) => setTeam(r.colleagues || [])).catch(() => {}); }, []);
  const submit = async () => { if (!benef || !reason.trim()) return; setBusy(true); try { await hrApi('/helping/nominate', { method: 'POST', body: JSON.stringify({ beneficiaryId: benef.id, reason: reason.trim() }) }); setShow(false); setBenef(null); setReason(''); load(); } catch (e) { alert(e.message); } setBusy(false); };
  if (!data) return <div className="text-slate-400 text-sm py-6">Loading…</div>;
  const shown = team.filter((m) => !q || (m.name || '').toLowerCase().includes(q.toLowerCase()));
  const statusPill = (s) => s === 'approved' ? { background: '#DCFCE7', color: '#15803D' } : s === 'rejected' ? { background: '#FEE2E2', color: '#DC2626' } : { background: '#FEF9C3', color: '#CA8A04' };
  return (
    <div>
      <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-4 flex items-center justify-between gap-3 flex-wrap">
        <div><div className="text-[15px] font-extrabold text-[#050A1F]">🤝 Helping Hand</div><div className="text-[13px] text-slate-500 mt-0.5">Nominate a colleague who helped you. HR reviews it, and if approved they earn points.</div></div>
        <button onClick={() => setShow(true)} className="rounded-xl px-4 py-2 text-sm font-extrabold text-white shrink-0" style={{ background: ORANGE }}>+ Nominate a colleague</button>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-sm font-extrabold mb-2">Nominations I've given</div>
          {(data.given || []).length === 0 ? <div className="text-[13px] text-slate-400 py-3">None yet.</div> : (data.given || []).map((r) => (
            <div key={r.id} className="flex items-center gap-2 py-1.5 text-[13px]"><span className="font-bold">{r.beneficiaryName}</span><span className="text-[10px] font-extrabold rounded-full px-2 py-0.5 ml-auto" style={statusPill(r.status)}>{r.status}</span></div>
          ))}
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-sm font-extrabold mb-2">Recognition I've received {data.approvedCount > 0 && <span className="text-[11px] text-slate-400">({data.approvedCount} approved)</span>}</div>
          {(data.received || []).length === 0 ? <div className="text-[13px] text-slate-400 py-3">None yet.</div> : (data.received || []).map((r) => (
            <div key={r.id} className="flex items-center gap-2 py-1.5 text-[13px]"><span className="text-slate-500">from {r.nominatorName}</span><span className="text-[10px] font-extrabold rounded-full px-2 py-0.5 ml-auto" style={statusPill(r.status)}>{r.status}{r.points ? ` +${r.points}` : ''}</span></div>
          ))}
        </div>
      </div>
      {show && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-[130] p-4 overflow-auto" onClick={() => setShow(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl my-6" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between"><div className="text-lg font-extrabold">Nominate a colleague</div><button onClick={() => setShow(false)} className="text-slate-400 text-2xl leading-none">×</button></div>
            <div className="p-6 space-y-3">
              <div className="border border-slate-300 rounded-lg overflow-hidden">
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search colleague…" className="w-full px-3 py-2 text-sm border-b border-slate-100 focus:outline-none" />
                <div className="max-h-44 overflow-auto">
                  {shown.slice(0, 50).map((m) => (
                    <button key={m.id} onClick={() => { setBenef(m); setQ(m.name); }} className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-orange-50 ${benef && benef.id === m.id ? 'bg-orange-50' : ''}`}><Avatar name={m.name} size={26} /><span className="text-sm font-bold">{m.name}</span>{benef && benef.id === m.id && <span className="ml-auto text-orange-500">✓</span>}</button>
                  ))}
                </div>
              </div>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="How did they help you?" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={() => setShow(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
              <button onClick={submit} disabled={busy || !benef || !reason.trim()} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? '…' : 'Submit nomination'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Employee: submit + track innovation ideas.
function MyIdeasView() {
  const [ideas, setIdeas] = useState(null);
  const [show, setShow] = useState(false);
  const [f, setF] = useState({ title: '', problem: '', solution: '', benefit: '', estimatedSavings: '', timeSaving: '' });
  const [busy, setBusy] = useState(false);
  const load = () => hrApi('/innovation/mine').then((r) => setIdeas(r.ideas || [])).catch(() => setIdeas([]));
  useEffect(() => { load(); }, []);
  const submit = async () => { if (!f.title.trim()) return; setBusy(true); try { await hrApi('/innovation', { method: 'POST', body: JSON.stringify(f) }); setShow(false); setF({ title: '', problem: '', solution: '', benefit: '', estimatedSavings: '', timeSaving: '' }); load(); } catch (e) { alert(e.message); } setBusy(false); };
  if (!ideas) return <div className="text-slate-400 text-sm py-6">Loading…</div>;
  const STAGE = { submitted: ['Submitted', '#94A3B8', '#F1F5F9'], under_review: ['Under review', '#CA8A04', '#FEF9C3'], approved: ['Approved', '#2563EB', '#EFF6FF'], implemented: ['Implemented', '#0891B2', '#CFFAFE'], rewarded: ['Rewarded', '#15803D', '#DCFCE7'], rejected: ['Rejected', '#DC2626', '#FEE2E2'] };
  const inp = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
  return (
    <div>
      <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-4 flex items-center justify-between gap-3 flex-wrap">
        <div><div className="text-[15px] font-extrabold text-[#050A1F]">💡 Idea & Innovation Center</div><div className="text-[13px] text-slate-500 mt-0.5">Have an idea to improve something? Submit it — approved ideas earn reward points by impact.</div></div>
        <button onClick={() => setShow(true)} className="rounded-xl px-4 py-2 text-sm font-extrabold text-white shrink-0" style={{ background: ORANGE }}>+ Submit an idea</button>
      </div>
      {ideas.length === 0 ? <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">No ideas yet. Share your first one!</div> : (
        <div className="space-y-2">
          {ideas.map((i) => { const st = STAGE[i.status] || STAGE.submitted; return (
            <div key={i.id} className="bg-white border border-slate-200 rounded-xl p-3.5 flex items-center gap-3">
              <span className="w-9 h-9 rounded-lg flex items-center justify-center text-base shrink-0" style={{ background: '#EDE9FE' }}>💡</span>
              <div className="flex-1 min-w-0"><div className="text-[13px] font-bold text-[#050A1F]">{i.title}</div><div className="text-[11px] text-slate-400">{i.points ? `Rewarded +${i.points} pts` : 'In review'}</div></div>
              <span className="text-[10px] font-extrabold rounded-full px-2.5 py-1" style={{ background: st[2], color: st[0] === 'Rewarded' ? '#15803D' : st[1] }}>{st[0]}</span>
            </div>
          ); })}
        </div>
      )}
      {show && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-[130] p-4 overflow-auto" onClick={() => setShow(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl my-6" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between"><div className="text-lg font-extrabold">Submit an idea</div><button onClick={() => setShow(false)} className="text-slate-400 text-2xl leading-none">×</button></div>
            <div className="p-6 space-y-3">
              <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Idea title *" className={inp} />
              <textarea value={f.problem} onChange={(e) => setF({ ...f, problem: e.target.value })} rows={2} placeholder="What problem does it solve?" className={inp} />
              <textarea value={f.solution} onChange={(e) => setF({ ...f, solution: e.target.value })} rows={2} placeholder="Proposed solution" className={inp} />
              <textarea value={f.benefit} onChange={(e) => setF({ ...f, benefit: e.target.value })} rows={2} placeholder="Expected benefit" className={inp} />
              <div className="grid grid-cols-2 gap-3">
                <input value={f.estimatedSavings} onChange={(e) => setF({ ...f, estimatedSavings: e.target.value })} placeholder="Est. savings (optional)" className={inp} />
                <input value={f.timeSaving} onChange={(e) => setF({ ...f, timeSaving: e.target.value })} placeholder="Time saving (optional)" className={inp} />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={() => setShow(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
              <button onClick={submit} disabled={busy || !f.title.trim()} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? '…' : 'Submit'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Achievement leaderboards (never shows bottom performers; no balances).
function LeaderboardsView() {
  const [data, setData] = useState(null);
  useEffect(() => { hrApi('/rewards/leaderboards').then(setData).catch(() => setData({})); }, []);
  if (!data) return <div className="text-slate-400 text-sm py-6">Loading…</div>;
  const boards = [
    ['🏆 Recognition Leaders', data.recognitionLeaders, 'recognitions'],
    ['💡 Innovation Leaders', data.innovationLeaders, 'pts'],
    ['🎯 Achievement Leaders', data.achievementLeaders, 'pts'],
    ['🤝 Helping Champions', data.helpingChampions, 'pts'],
    ['🌟 Overall Stars', data.overallStars, 'pts'],
  ];
  const medal = ['🥇', '🥈', '🥉'];
  return (
    <div className="grid md:grid-cols-2 gap-4">
      {boards.map(([title, rows, unit]) => (
        <div key={title} className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-sm font-extrabold text-[#050A1F] mb-2">{title}</div>
          {(!rows || rows.length === 0) ? <div className="text-[13px] text-slate-400 py-3">No entries yet.</div> : (
            <div className="space-y-1">
              {rows.slice(0, 8).map((r, i) => (
                <div key={r.id} className="flex items-center gap-2 py-1.5 text-[13px] border-t border-slate-50 first:border-0">
                  <span className="w-6 text-center">{medal[i] || (i + 1)}</span>
                  <Avatar name={r.name} size={26} />
                  <span className="font-bold truncate">{r.name}</span>
                  <span className="text-[11px] text-slate-400 truncate">{r.department}</span>
                  <span className="ml-auto font-extrabold" style={{ color: '#0435AC' }}>{r.value.toLocaleString('en-IN')}<span className="text-[10px] text-slate-400 font-normal ml-0.5">{unit}</span></span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ===== Rewards Admin — rule points, master switch, and overview KPIs =====
function RewardsAdmin() {
  const [data, setData] = useState(null);
  const [ov, setOv] = useState(null);
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState('');
  const [sub, setSub] = useState('rules'); // rules | budgets | approvals
  const load = () => { hrApi('/rewards/rules').then(setData).catch(() => {}); hrApi('/rewards/overview').then(setOv).catch(() => {}); };
  useEffect(() => { load(); }, []);
  if (!data) return <div className="text-slate-400 text-sm py-8">Loading…</div>;
  const cfg = data.config || {};
  const live = !!cfg.rewardsLive;
  const saveRule = async (rule, patch) => { setBusy('r' + rule.id); try { await hrApi(`/rewards/rules/${rule.id}`, { method: 'PUT', body: JSON.stringify(patch) }); await load(); setEdits((e) => { const n = { ...e }; delete n[rule.id]; return n; }); } catch (e) { alert(e.message); } setBusy(''); };
  const toggleLive = async () => { if (!live && !window.confirm('Turn Rewards ON? From now, recognition and milestones will start awarding points to employees. Make sure the point values below are correct first.')) return; setBusy('live'); try { const r = await hrApi('/rewards/config', { method: 'PUT', body: JSON.stringify({ rewardsLive: !live }) }); setData((d) => ({ ...d, config: r.config })); } catch (e) { alert(e.message); } setBusy(''); };
  const cats = {}; (data.rules || []).forEach((r) => { (cats[r.category] = cats[r.category] || []).push(r); });
  const catLabel = { badge: '🏅 Badges', appreciation: '❤️ Appreciation', automatic: '🎁 Automatic', anniversary: '🎊 Anniversary', attendance: '📅 Attendance' };
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border p-5 flex items-center justify-between gap-4 flex-wrap" style={{ background: live ? '#F0FDF4' : '#FFF7ED', borderColor: live ? '#BBF7D0' : '#FED7AA' }}>
        <div>
          <div className="text-[15px] font-extrabold" style={{ color: live ? '#15803D' : '#9a3412' }}>{live ? '✅ Rewards are LIVE' : '⏸ Rewards are paused'}</div>
          <div className="text-[12px] mt-0.5" style={{ color: live ? '#166534' : '#9a3412' }}>{live ? 'Recognition and milestones are awarding points to employees.' : 'No points are being awarded yet. Review the point values below, then turn Rewards on.'}</div>
        </div>
        <button onClick={toggleLive} disabled={busy === 'live'} className="rounded-xl px-5 py-2.5 text-sm font-extrabold text-white disabled:opacity-50" style={{ background: live ? '#DC2626' : 'linear-gradient(90deg,#16A34A,#15803D)' }}>{busy === 'live' ? '…' : (live ? 'Pause Rewards' : 'Turn Rewards ON')}</button>
      </div>
      {ov && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white border border-slate-200 rounded-xl p-3"><div className="text-xl font-extrabold text-green-600">{(ov.issued || 0).toLocaleString('en-IN')}</div><div className="text-[10px] font-bold uppercase text-slate-400">Points issued</div></div>
          <div className="bg-white border border-slate-200 rounded-xl p-3"><div className="text-xl font-extrabold text-blue-600">{(ov.redeemed || 0).toLocaleString('en-IN')}</div><div className="text-[10px] font-bold uppercase text-slate-400">Redeemed</div></div>
          <div className="bg-white border border-slate-200 rounded-xl p-3"><div className="text-xl font-extrabold text-orange-600">{(ov.outstanding || 0).toLocaleString('en-IN')}</div><div className="text-[10px] font-bold uppercase text-slate-400">Outstanding</div></div>
          <div className="rounded-xl p-3 text-white" style={{ background: 'linear-gradient(120deg,#7C2D12,#B45309)' }}><div className="text-xl font-extrabold">₹{(ov.liabilityRupees || 0).toLocaleString('en-IN')}</div><div className="text-[10px] font-bold uppercase" style={{ color: '#ffe4d3' }}>Reward liability</div></div>
        </div>
      )}
      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {[['rules', 'Point values'], ['budgets', 'Budgets'], ['approvals', 'Approvals'], ['helping', 'Helping Hand'], ['innovation', 'Innovation']].map(([id, label]) => (
          <button key={id} onClick={() => setSub(id)} className="px-3.5 py-1.5 text-[12px] font-extrabold border-b-2 -mb-px" style={{ borderColor: sub === id ? '#FF6A00' : 'transparent', color: sub === id ? '#050A1F' : '#94A3B8' }}>{label}</button>
        ))}
      </div>
      {sub === 'budgets' && <RewardBudgets />}
      {sub === 'approvals' && <RewardApprovals />}
      {sub === 'helping' && <HelpingQueue />}
      {sub === 'innovation' && <InnovationQueue />}
      {sub === 'rules' && <>
      <div className="text-[12px] text-slate-500">Conversion: <b>{cfg.pointsPerRupee || 2} points = ₹1</b> · Points expire after <b>{cfg.expiryMonths || 24} months</b>. Edit a badge's points below — the value applies the next time it's awarded.</div>
      {Object.entries(cats).map(([cat, rules]) => (
        <div key={cat} className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="text-sm font-extrabold text-[#050A1F] mb-2">{catLabel[cat] || cat}</div>
          <div className="grid sm:grid-cols-2 gap-2">
            {rules.map((r) => {
              const pending = edits[r.id] !== undefined;
              const val = pending ? edits[r.id] : r.points;
              return (
                <div key={r.id} className="flex items-center gap-2.5 rounded-lg border border-slate-100 px-3 py-2">
                  {r.icon && <span className="text-lg shrink-0">{r.icon}</span>}
                  <div className="min-w-0 flex-1"><div className="text-[13px] font-bold truncate">{r.name}</div><div className="text-[10px] text-slate-400 truncate">{r.pointsMax ? `${r.points}–${r.pointsMax} pts` : r.frequency}{r.requiresApproval ? ' · needs approval' : ''}</div></div>
                  <input type="number" value={val} onChange={(e) => setEdits((x) => ({ ...x, [r.id]: e.target.value }))} className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-[13px] text-right" />
                  <span className="text-[11px] text-slate-400">pts</span>
                  {pending
                    ? <button onClick={() => saveRule(r, { points: Number(val) })} disabled={busy === 'r' + r.id} className="text-[11px] font-bold rounded-lg px-2.5 py-1 text-white shrink-0" style={{ background: ORANGE }}>{busy === 'r' + r.id ? '…' : 'Save'}</button>
                    : <button onClick={() => saveRule(r, { active: !r.active })} className="text-[11px] font-bold rounded-lg px-2 py-1 shrink-0" style={r.active ? { background: '#DCFCE7', color: '#15803D' } : { background: '#F1F5F9', color: '#94A3B8' }}>{r.active ? 'On' : 'Off'}</button>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      </>}
    </div>
  );
}

// Admin: per-senior monthly budget manager. Role default shown; override editable.
function RewardBudgets() {
  const [data, setData] = useState(null);
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState('');
  const [q, setQ] = useState('');
  const load = () => hrApi('/rewards/budgets').then(setData).catch(() => {});
  useEffect(() => { load(); }, []);
  if (!data) return <div className="text-slate-400 text-sm py-6">Loading…</div>;
  const save = async (id, limit) => { setBusy('b' + id); try { await hrApi(`/rewards/budgets/${id}`, { method: 'PUT', body: JSON.stringify(limit === '' ? { clear: true } : { limit: Number(limit) }) }); await load(); setEdits((e) => { const n = { ...e }; delete n[id]; return n; }); } catch (e) { alert(e.message); } setBusy(''); };
  const rows = (data.seniors || []).filter((s) => !q || s.name.toLowerCase().includes(q.toLowerCase()) || (s.department || '').toLowerCase().includes(q.toLowerCase()));
  const rd = data.roleDefaults || {};
  return (
    <div>
      <div className="text-[12px] text-slate-500 mb-2">Role defaults — TL {(rd.tl || 0).toLocaleString('en-IN')} · PM {(rd.pm || 0).toLocaleString('en-IN')} · HOD {(rd.hod || 0).toLocaleString('en-IN')} · HR {(rd.hr || 0).toLocaleString('en-IN')}/month. Set a number below to override an individual senior; clear it to fall back to the role default.</div>
      <div className="mb-2"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search seniors…" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm w-52" /></div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-[13px]">
          <thead><tr className="text-[10px] font-extrabold uppercase text-slate-400 bg-slate-50"><th className="text-left px-4 py-2.5">Senior</th><th className="text-left px-4 py-2.5">Role</th><th className="text-left px-4 py-2.5">Spent</th><th className="text-left px-4 py-2.5">Monthly limit</th></tr></thead>
          <tbody>
            {rows.map((s) => {
              const pending = edits[s.id] !== undefined;
              const val = pending ? edits[s.id] : (s.override != null ? s.override : '');
              return (
                <tr key={s.id} className="border-t border-slate-50">
                  <td className="px-4 py-2.5"><div className="font-bold text-[#0A0E28]">{s.name}</div><div className="text-[11px] text-slate-400">{[s.department, s.branch].filter(Boolean).join(' · ')}</div></td>
                  <td className="px-4 py-2.5 text-slate-500">{s.type === 'manager' ? 'Manager' : s.type === 'tl' ? 'Team Lead' : 'Senior'}</td>
                  <td className="px-4 py-2.5 text-slate-500">{s.spent.toLocaleString('en-IN')} / {s.limit.toLocaleString('en-IN')}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <input type="number" value={val} placeholder={`default ${s.limit}`} onChange={(e) => setEdits((x) => ({ ...x, [s.id]: e.target.value }))} className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-[13px]" />
                      {pending && <button onClick={() => save(s.id, val)} disabled={busy === 'b' + s.id} className="text-[11px] font-bold rounded-lg px-2.5 py-1 text-white" style={{ background: ORANGE }}>{busy === 'b' + s.id ? '…' : 'Save'}</button>}
                      {!pending && s.override != null && <span className="text-[10px] font-bold text-orange-600">override</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Admin: approve/reject pending high-value awards.
function RewardApprovals() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  const load = () => hrApi('/rewards/approvals').then(setData).catch(() => {});
  useEffect(() => { load(); }, []);
  if (!data) return <div className="text-slate-400 text-sm py-6">Loading…</div>;
  const decide = async (id, approve) => { setBusy(id); try { await hrApi(`/rewards/approvals/${id}/decide`, { method: 'POST', body: JSON.stringify({ approve }) }); await load(); } catch (e) { alert(e.message); } setBusy(''); };
  const rows = data.approvals || [];
  const tierLabel = { manager: 'Manager', hod_hr: 'HOD + HR', senior_mgmt: 'Senior Mgmt' };
  return (
    <div>
      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">No pending approvals. High-value awards (over 500 points) appear here for sign-off.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((a) => (
            <div key={a.id} className="bg-white border border-slate-200 rounded-xl p-3.5 flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold text-[#050A1F]">{a.title} <span className="font-extrabold" style={{ color: '#0435AC' }}>+{a.points.toLocaleString('en-IN')}</span></div>
                <div className="text-[11px] text-slate-400">For <b>{a.employeeName}</b> ({[a.department, a.branch].filter(Boolean).join(' · ')}) · by {a.byName}{a.byRole ? ` (${a.byRole})` : ''} · needs {tierLabel[a.requiredLevel] || a.requiredLevel}</div>
                {a.reason && <div className="text-[12px] text-slate-500 mt-1">"{a.reason}"</div>}
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => decide(a.id, false)} disabled={busy === a.id} className="text-[12px] font-bold rounded-lg px-3 py-1.5 border border-slate-300 text-slate-600">Reject</button>
                <button onClick={() => decide(a.id, true)} disabled={busy === a.id} className="text-[12px] font-bold rounded-lg px-3 py-1.5 text-white" style={{ background: 'linear-gradient(90deg,#16A34A,#15803D)' }}>{busy === a.id ? '…' : 'Approve'}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Admin: helping-hand nomination queue.
function HelpingQueue() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  const load = () => hrApi('/helping/queue').then(setData).catch(() => {});
  useEffect(() => { load(); }, []);
  if (!data) return <div className="text-slate-400 text-sm py-6">Loading…</div>;
  const decide = async (id, approve) => { setBusy(id); try { await hrApi(`/helping/${id}/decide`, { method: 'POST', body: JSON.stringify({ approve }) }); await load(); } catch (e) { alert(e.message); } setBusy(''); };
  const rows = data.recommendations || [];
  return (
    <div>
      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">No pending helping-hand nominations. When an employee nominates a colleague, it appears here for approval.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="bg-white border border-slate-200 rounded-xl p-3.5 flex items-center gap-3 flex-wrap">
              <span className="w-9 h-9 rounded-lg flex items-center justify-center text-base shrink-0" style={{ background: '#FCE7F3' }}>❤️</span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold text-[#050A1F]">{r.beneficiaryName} <span className="text-slate-400 font-normal">nominated by {r.nominatorName}</span></div>
                <div className="text-[11px] text-slate-400">{[r.department, r.branch].filter(Boolean).join(' · ')}</div>
                {r.reason && <div className="text-[12px] text-slate-500 mt-1">"{r.reason}"</div>}
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => decide(r.id, false)} disabled={busy === r.id} className="text-[12px] font-bold rounded-lg px-3 py-1.5 border border-slate-300 text-slate-600">Reject</button>
                <button onClick={() => decide(r.id, true)} disabled={busy === r.id} className="text-[12px] font-bold rounded-lg px-3 py-1.5 text-white" style={{ background: 'linear-gradient(90deg,#16A34A,#15803D)' }}>{busy === r.id ? '…' : 'Approve'}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Admin: innovation idea pipeline.
function InnovationQueue() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);
  const load = () => hrApi('/innovation/all').then(setData).catch(() => {});
  useEffect(() => { load(); }, []);
  if (!data) return <div className="text-slate-400 text-sm py-6">Loading…</div>;
  const STAGE = { submitted: ['Submitted', '#94A3B8', '#F1F5F9'], under_review: ['Under review', '#CA8A04', '#FEF9C3'], approved: ['Approved', '#2563EB', '#EFF6FF'], implemented: ['Implemented', '#0891B2', '#CFFAFE'], rewarded: ['Rewarded', '#15803D', '#DCFCE7'], rejected: ['Rejected', '#DC2626', '#FEE2E2'] };
  const ideas = data.ideas || [];
  return (
    <div>
      {ideas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">No ideas submitted yet.</div>
      ) : (
        <div className="space-y-2">
          {ideas.map((i) => { const st = STAGE[i.status] || STAGE.submitted; return (
            <div key={i.id} className="bg-white border border-slate-200 rounded-xl p-3.5">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="w-9 h-9 rounded-lg flex items-center justify-center text-base shrink-0" style={{ background: '#EDE9FE' }}>💡</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold text-[#050A1F]">{i.title}</div>
                  <div className="text-[11px] text-slate-400">by {i.authorName} · {[i.department, i.branch].filter(Boolean).join(' · ')}{i.points ? ` · +${i.points} pts` : ''}</div>
                </div>
                <span className="text-[10px] font-extrabold rounded-full px-2.5 py-1" style={{ background: st[2], color: st[0] === 'Rewarded' ? '#15803D' : st[1] }}>{st[0]}</span>
                <button onClick={() => setOpen(open === i.id ? null : i.id)} className="text-[11px] font-bold text-orange-600">{open === i.id ? 'Close' : 'Manage'}</button>
              </div>
              {open === i.id && <InnovationManage idea={i} onDone={() => { setOpen(null); load(); }} />}
            </div>
          ); })}
        </div>
      )}
    </div>
  );
}

function InnovationManage({ idea, onDone }) {
  const [status, setStatus] = useState(idea.status);
  const [impact, setImpact] = useState(idea.impact || '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const IMPACT_PTS = { small: 250, moderate: 500, significant: 1000, major: 2500, exceptional: 5000 };
  const save = async () => { setBusy(true); try { await hrApi(`/innovation/${idea.id}/status`, { method: 'POST', body: JSON.stringify({ status, impact: impact || undefined, reviewNote: note }) }); onDone(); } catch (e) { alert(e.message); setBusy(false); } };
  return (
    <div className="mt-3 pt-3 border-t border-slate-100 space-y-2.5">
      {idea.problem && <div className="text-[12px]"><b className="text-slate-600">Problem:</b> <span className="text-slate-500">{idea.problem}</span></div>}
      {idea.solution && <div className="text-[12px]"><b className="text-slate-600">Solution:</b> <span className="text-slate-500">{idea.solution}</span></div>}
      {idea.benefit && <div className="text-[12px]"><b className="text-slate-600">Benefit:</b> <span className="text-slate-500">{idea.benefit}</span></div>}
      <div className="flex flex-wrap items-center gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-[13px]">
          {['submitted', 'under_review', 'approved', 'implemented', 'rewarded', 'rejected'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        {status === 'rewarded' && (
          <select value={impact} onChange={(e) => setImpact(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-[13px]">
            <option value="">Impact…</option>
            {Object.entries(IMPACT_PTS).map(([k, v]) => <option key={k} value={k}>{k} (+{v})</option>)}
          </select>
        )}
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-[13px] flex-1 min-w-[120px]" />
        <button onClick={save} disabled={busy || (status === 'rewarded' && !impact)} className="text-[12px] font-bold rounded-lg px-3.5 py-1.5 text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? '…' : 'Update'}</button>
      </div>
      {status === 'rewarded' && !impact && <div className="text-[11px] text-amber-600">Pick an impact level to award points.</div>}
    </div>
  );
}

function RecognitionPage({ user, onOpenEmployee }) {
  const canSeeAll = !!(user && (user.isAdmin || user.hrManagerAll || user.hrManagerScope || user.isHrManager));
  const canManageRewards = !!(user && (user.isAdmin || user.hrManagerAll || user.isHrManager));
  const [tab, setTab] = useState('give');
  const [data, setData] = useState(null);
  const [give, setGive] = useState(false);
  const load = () => hrApi('/recognition/team').then(setData).catch(() => setData({ team: [], recent: [] }));
  useEffect(() => { load(); }, []);
  const fmt = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); } catch { return d; } };
  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="mb-4">
        <div className="text-xl font-extrabold text-[#050A1F] flex items-center gap-2">🏅 Recognition</div>
        <div className="text-sm text-slate-500">{canSeeAll ? 'Appreciate your team, or review all recognition across the company.' : 'Recognize the people on your team.'}</div>
      </div>
      {canSeeAll && (
        <div className="flex gap-1 border-b border-slate-200 mb-5">
          {[['give', 'Give recognition'], ['all', 'All recognition'], ['rewards', 'My Rewards'], ...(canManageRewards ? [['admin', 'Rewards Admin']] : [])].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} className="px-4 py-2 text-[13px] font-extrabold border-b-2 -mb-px transition" style={{ borderColor: tab === id ? '#FF6A00' : 'transparent', color: tab === id ? '#050A1F' : '#94A3B8' }}>{label}</button>
          ))}
        </div>
      )}
      {(!canSeeAll || tab === 'give') && (
        <div>
          <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-5 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="text-[15px] font-extrabold text-[#050A1F]">Give recognition</div>
              <div className="text-[13px] text-slate-500 mt-0.5">Pick a team member, add a badge or note, and celebrate their work.</div>
            </div>
            <button onClick={() => setGive(true)} className="rounded-xl px-5 py-2.5 text-sm font-extrabold text-white shrink-0" style={{ background: ORANGE }}>+ Give recognition</button>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="text-sm font-extrabold text-[#050A1F] mb-3">✨ Recent recognition</div>
            {(!data || (data.recent || []).length === 0) ? (
              <div className="text-sm text-slate-400 py-6 text-center">No recognition yet. Give the first one! 🎉</div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
                {(data.recent || []).map((r, i) => {
                  const bd = r.badge || REC_BADGE_FALLBACK;
                  return (
                    <div key={i} className="flex items-start gap-2.5">
                      <span className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-base" style={{ background: (bd.color || '#EA580C') + '18' }}>{bd.icon}</span>
                      <div className="min-w-0">
                        <div className="text-[13px] text-[#0A0E28]"><button onClick={() => onOpenEmployee(r.employeeId)} className="font-bold hover:text-orange-600">{r.employeeName}</button>{r.badge ? <> earned <span className="font-bold">{r.badge.name}</span></> : ' was appreciated'}</div>
                        <div className="text-[10px] text-slate-400">{r.auto ? 'Auto' : `by ${r.by}`}{r.byRole ? ` (${r.byRole})` : ''} · {fmt(r.date)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
      {canSeeAll && tab === 'all' && <AllRecognition onOpenEmployee={onOpenEmployee} />}
      {canSeeAll && tab === 'rewards' && <MyRewardsPage user={user} embedded />}
      {canManageRewards && tab === 'admin' && <RewardsAdmin />}
      {give && <GiveRecognitionPicker onClose={() => setGive(false)} onSaved={() => { setGive(false); load(); }} />}
    </div>
  );
}

// The company-wide recognition log (admins / HR managers). Filters + pagination;
// branch-scoped managers are locked to their branch.
function AllRecognition({ onOpenEmployee }) {
  const [data, setData] = useState(null);
  const [f, setF] = useState({ type: '', branch: '', department: '', givenBy: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const load = () => {
    const qs = new URLSearchParams(); Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v); }); qs.set('page', page);
    hrApi(`/recognition/all?${qs.toString()}`).then(setData).catch(() => setData({ rows: [], filters: {}, pages: 1 }));
  };
  useEffect(() => { load(); }, [f, page]);
  useEffect(() => { setPage(1); }, [f]);
  const fmt = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return d; } };
  const filt = (data && data.filters) || { branches: [], departments: [], givers: [] };
  const sel = 'border border-slate-300 rounded-lg px-2.5 py-1.5 text-[13px]';
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const [autoBusy, setAutoBusy] = useState(false);
  const runAuto = async () => { setAutoBusy(true); try { await hrApi('/badges/run-auto', { method: 'POST', body: '{}' }); await load(); alert('Milestone badges updated.'); } catch (e) { alert(e.message); } setAutoBusy(false); };
  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="text-[12px] text-slate-400">Every appreciation, review and conduct flag given across {data && data.scopedBranch ? 'your branch' : 'the company'}. Auto badges (attendance milestones) are awarded automatically.</div>
        <button onClick={runAuto} disabled={autoBusy} className="text-[12px] font-bold rounded-lg px-3 py-1.5 disabled:opacity-50" style={{ background: '#EDE9FE', color: '#7C3AED' }}>{autoBusy ? 'Checking…' : '⚡ Run milestone check'}</button>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl p-3 mb-3 flex flex-wrap gap-2 items-center">
        <select className={sel} value={f.type} onChange={(e) => set('type', e.target.value)}><option value="">All types</option><option value="praise">Appreciation</option><option value="review">Review</option><option value="yellow">Yellow card</option><option value="red">Red card</option></select>
        {data && data.scopedBranch ? (
          <span className="text-[12px] font-bold text-slate-500 rounded-lg bg-slate-100 px-2.5 py-1.5">🏢 {data.scopedBranch}</span>
        ) : (
          <select className={sel} value={f.branch} onChange={(e) => set('branch', e.target.value)}><option value="">All branches</option>{(filt.branches || []).map((b) => <option key={b} value={b}>{b}</option>)}</select>
        )}
        <select className={sel} value={f.department} onChange={(e) => set('department', e.target.value)}><option value="">All departments</option>{(filt.departments || []).map((d) => <option key={d} value={d}>{d}</option>)}</select>
        <select className={sel} value={f.givenBy} onChange={(e) => set('givenBy', e.target.value)}><option value="">Given by anyone</option>{(filt.givers || []).map((g) => <option key={g} value={g}>{g}</option>)}</select>
        <input type="date" className={sel + ' ml-auto'} value={f.from} onChange={(e) => set('from', e.target.value)} />
        <span className="text-slate-400 text-sm">→</span>
        <input type="date" className={sel} value={f.to} onChange={(e) => set('to', e.target.value)} />
      </div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-[13px]">
          <thead><tr className="text-[10px] font-extrabold uppercase tracking-wide text-slate-400 bg-slate-50">
            <th className="text-left px-4 py-2.5">Recognition</th><th className="text-left px-4 py-2.5">Employee</th><th className="text-left px-4 py-2.5">Given by</th><th className="text-left px-4 py-2.5">Date</th>
          </tr></thead>
          <tbody>
            {(!data || (data.rows || []).length === 0) ? (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-400">No recognition matches these filters.</td></tr>
            ) : (data.rows || []).map((r) => {
              const meta = REC_PERF[r.kind] || REC_PERF.review;
              const icon = r.badge ? r.badge.icon : meta.icon;
              return (
                <tr key={r.id} className="border-t border-slate-50">
                  <td className="px-4 py-2.5"><div className="flex items-center gap-2.5"><span className="w-8 h-8 rounded-lg flex items-center justify-center text-base shrink-0" style={{ background: r.badge ? (r.badge.color + '22') : meta.bg }}>{icon}</span><div><div className="text-[12px] font-extrabold text-[#050A1F]">{r.title || meta.label}</div><span className="text-[9px] font-extrabold rounded-full px-2 py-0.5" style={{ background: meta.bg, color: meta.fg }}>{meta.label.toUpperCase()}</span></div></div></td>
                  <td className="px-4 py-2.5"><button onClick={() => onOpenEmployee(r.employeeId)} className="text-[13px] font-bold text-[#0A0E28] hover:text-orange-600">{r.employeeName}</button><div className="text-[11px] text-slate-400">{[r.department, r.branch].filter(Boolean).join(' · ')}</div></td>
                  <td className="px-4 py-2.5"><div className="text-[12px] font-semibold">{r.by}</div><div className="text-[10px] text-slate-400">{r.byRole}</div></td>
                  <td className="px-4 py-2.5 text-[12px] text-slate-600">{fmt(r.date)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {data && data.pages > 1 && (
        <div className="flex items-center justify-between mt-3">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="rounded-lg border border-slate-300 px-3 py-1.5 text-[12px] font-bold text-slate-600 disabled:opacity-40">‹ Prev</button>
          <span className="text-[12px] text-slate-400">Page {data.page} of {data.pages} · {data.total} records</span>
          <button onClick={() => setPage((p) => Math.min(data.pages, p + 1))} disabled={page === data.pages} className="rounded-lg border border-slate-300 px-3 py-1.5 text-[12px] font-bold text-slate-600 disabled:opacity-40">Next ›</button>
        </div>
      )}
    </div>
  );
}

// Give-recognition popup: pick an employee (your reports only, searchable), see
// their counts + recent-3 for context, then give a badge/appreciation/review or
// a yellow/red card. Posts to /employees/:id/performance.
function GiveRecognitionPicker({ onClose, onSaved }) {
  const PERF = { praise: { label: 'Appreciation', icon: '🌟', bg: '#DCFCE7', border: '#BBF7D0' }, review: { label: 'Review', icon: '📝', bg: '#EFF6FF', border: '#BFDBFE' }, yellow: { label: 'Yellow card', icon: '🟨', bg: '#FEF9C3', border: '#FDE68A' }, red: { label: 'Red card', icon: '🟥', bg: '#FEE2E2', border: '#FECACA' } };
  const [team, setTeam] = useState([]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [emp, setEmp] = useState(null);
  const [summary, setSummary] = useState(null);
  const [kind, setKind] = useState('praise');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [badgeId, setBadgeId] = useState('');
  const [announce, setAnnounce] = useState(false);
  const [badges, setBadges] = useState([]);
  const [budget, setBudget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { hrApi('/recognition/team').then((r) => setTeam(r.team || [])).catch(() => {}); hrApi('/badges/catalog').then((r) => setBadges(r.badges || [])).catch(() => {}); hrApi('/rewards/my-budget').then(setBudget).catch(() => {}); }, []);
  const pick = async (m) => { setEmp(m); setOpen(false); setQ(''); setSummary(null); try { setSummary(await hrApi(`/employees/${m.id}/recognition-summary`)); } catch {} };
  const submit = async () => {
    if (!emp) { setErr('Select an employee first.'); return; }
    if (!title.trim() && !note.trim() && !(kind === 'praise' && badgeId)) { setErr('Add a badge, title, or note.'); return; }
    setBusy(true); setErr('');
    try {
      const r = await hrApi(`/employees/${emp.id}/performance`, { method: 'POST', body: JSON.stringify({ kind, title: title.trim(), note: note.trim(), date, badgeId: kind === 'praise' ? badgeId : undefined, announce: kind === 'praise' ? announce : false }) });
      if (r.pendingApproval) alert(`Sent for approval — this ${r.pointsPending}-point award needs HR/senior sign-off before the points are credited.`);
      onSaved();
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  const ic = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
  const shown = team.filter((m) => !q || m.name.toLowerCase().includes(q.toLowerCase()) || (m.department || '').toLowerCase().includes(q.toLowerCase()));
  const REC = { praise: ['#15803D', '#DCFCE7', 'Praise'], review: ['#2563EB', '#EFF6FF', 'Reviews'], yellow: ['#CA8A04', '#FEF9C3', 'Yellow'], red: ['#DC2626', '#FEE2E2', 'Red'] };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-[130] p-4 overflow-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl my-6 flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between"><div className="text-lg font-extrabold text-[#050A1F]">Give recognition</div><button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">×</button></div>
        <div className="p-6 space-y-4 overflow-auto">
          {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{err}</div>}
          {/* Employee picker — an inline searchable list (not an absolute
              dropdown, which was getting clipped by the modal's scroll area). */}
          <div>
            <div className="text-xs font-bold text-slate-500 mb-1.5">Employee <span className="font-normal text-slate-400">(your team only)</span></div>
            {emp && !open ? (
              <button onClick={() => setOpen(true)} className="w-full flex items-center gap-3 border border-slate-300 rounded-lg px-3 py-2 text-left">
                <Avatar name={emp.name} src={emp.avatar} size={32} />
                <div className="min-w-0"><div className="text-sm font-bold truncate">{emp.name}</div><div className="text-[11px] text-slate-400 truncate">{[emp.designation, emp.department].filter(Boolean).join(' · ')}</div></div>
                <span className="ml-auto text-[11px] font-bold text-orange-600">Change</span>
              </button>
            ) : (
              <div className="border border-slate-300 rounded-lg overflow-hidden">
                <div className="p-2 border-b border-slate-100">
                  <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your team by name…" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300" />
                </div>
                <div className="max-h-52 overflow-auto">
                  {shown.length === 0 ? (
                    <div className="px-3 py-5 text-sm text-slate-400 text-center">{team.length === 0 ? 'No one reports to you yet.' : 'No match — try another name.'}</div>
                  ) : shown.map((m) => (
                    <button key={m.id} onClick={() => pick(m)} className={`w-full flex items-center gap-2.5 px-3 py-2 hover:bg-orange-50 text-left ${emp && emp.id === m.id ? 'bg-orange-50' : ''}`}>
                      <Avatar name={m.name} src={m.avatar} size={28} />
                      <div className="min-w-0 flex-1"><div className="text-sm font-bold truncate">{m.name}</div><div className="text-[11px] text-slate-400 truncate">{[m.designation, m.department].filter(Boolean).join(' · ')}{m.badges ? ` · 🏅 ${m.badges}` : ''}</div></div>
                      {emp && emp.id === m.id && <span className="text-orange-500 text-sm shrink-0">✓</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {/* Budget banner (seniors only — HR/admin are exempt). */}
          {emp && budget && !budget.exempt && (
            <div className="rounded-lg px-3 py-2 text-[12px] font-semibold" style={budget.remaining > 0 ? { background: '#EFF6FF', color: '#2563EB' } : { background: '#FEE2E2', color: '#DC2626' }}>
              💳 Monthly budget: {budget.remaining.toLocaleString('en-IN')} of {budget.limit.toLocaleString('en-IN')} points left
            </div>
          )}
          {/* Selected employee context */}
          {emp && summary && (
            <>
              <div className="grid grid-cols-4 gap-2">
                {Object.entries(REC).map(([k, [fg, bg, label]]) => (
                  <div key={k} className="rounded-lg border p-2 text-center" style={{ background: bg, borderColor: fg + '33' }}><div className="text-lg font-extrabold" style={{ color: fg }}>{(summary.counts || {})[k] || 0}</div><div className="text-[9px] font-bold uppercase" style={{ color: fg }}>{label}</div></div>
                ))}
              </div>
              {(summary.recent || []).length > 0 && (
                <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                  <div className="text-[11px] font-extrabold uppercase text-slate-400 mb-2">Recent recognition</div>
                  {(summary.recent || []).map((r, i) => { const m = PERF[r.kind] || PERF.review; const icon = r.badge ? r.badge.icon : m.icon; const fmtd = (() => { try { return new Date(r.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); } catch { return r.date; } })(); return (
                    <div key={i} className="flex items-center gap-2 py-1.5">
                      <span className="w-6 h-6 rounded-md flex items-center justify-center text-[13px] shrink-0" style={{ background: r.badge ? (r.badge.color + '22') : m.bg }}>{icon}</span>
                      <span className="text-[12px] font-bold truncate">{r.title || m.label}</span>
                      <span className="text-[10px] text-slate-400 ml-auto text-right shrink-0">by {r.by}{r.byRole ? ` (${r.byRole})` : ''} · {fmtd}</span>
                    </div>
                  ); })}
                </div>
              )}
            </>
          )}
          {/* Recognition form (once an employee is chosen) */}
          {emp && (
            <>
              <div>
                <div className="text-xs font-bold text-slate-500 mb-2">Type</div>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(PERF).map(([k, m]) => (<button key={k} onClick={() => setKind(k)} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold ${kind === k ? 'ring-2 ring-orange-300' : ''}`} style={{ background: m.bg, borderColor: m.border, color: '#334155' }}><span>{m.icon}</span>{m.label}</button>))}
                </div>
              </div>
              {kind === 'praise' && (
                <div>
                  <div className="text-xs font-bold text-slate-500 mb-2">Pick a badge <span className="font-normal text-slate-400">(optional)</span></div>
                  <div className="grid grid-cols-4 gap-2">
                    {badges.map((b) => (<button key={b.id} onClick={() => setBadgeId(badgeId === b.id ? '' : b.id)} title={b.desc} className={`rounded-xl border p-2.5 text-center ${badgeId === b.id ? 'ring-2 ring-orange-400' : ''}`} style={{ background: b.color + '14', borderColor: b.color + '44' }}><div className="text-xl leading-none">{b.icon}</div><div className="text-[9px] font-extrabold mt-1" style={{ color: '#334155' }}>{b.name}</div>{b.points > 0 && <div className="text-[9px] font-bold mt-0.5" style={{ color: '#0435AC' }}>+{b.pointsMax ? `${b.points}–${b.pointsMax}` : b.points}</div>}</button>))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-xs font-bold text-slate-500 mb-1">{kind === 'praise' ? 'Title (optional)' : 'Title'}</div><input className={ic} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'praise' ? 'e.g. Great client save' : 'Short summary'} /></div>
                <div><div className="text-xs font-bold text-slate-500 mb-1">Date</div><input type="date" className={ic} value={date} onChange={(e) => setDate(e.target.value)} /></div>
              </div>
              <div><div className="text-xs font-bold text-slate-500 mb-1">Details</div><textarea className={ic} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === 'praise' ? 'What did they do well?' : 'What happened / feedback…'} /></div>
              {kind === 'praise' && <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer"><input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} className="w-4 h-4 accent-orange-500" />📣 Announce to the whole branch</label>}
            </>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={submit} disabled={busy || !emp} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : (kind === 'praise' ? 'Give appreciation 🎉' : 'Add note')}</button>
        </div>
      </div>
    </div>
  );
}

function HrTasksView({ user, isAdmin }) {
  const [board, setBoard] = useState(null);
  const [people, setPeople] = useState([]);         // for the top switcher (admin/HR)
  const [myBoardId, setMyBoardId] = useState(null); // the viewer's own board id
  const [viewerId, setViewerId] = useState(null);
  const [view, setView] = useState('list'); // list | board
  const [err, setErr] = useState('');
  const [openTask, setOpenTask] = useState(null);
  const [addingIn, setAddingIn] = useState(null);   // bucket key being added to
  const [newTitle, setNewTitle] = useState('');
  const [dragId, setDragId] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [collapsed, setCollapsed] = useState({});
  const [expandedTasks, setExpandedTasks] = useState({}); // inline subtask expand
  const [showCompleted, setShowCompleted] = useState(false);
  const [filter, setFilter] = useState('all');      // all | mine | overdue | high
  const [sort, setSort] = useState('manual');       // manual | due | priority

  const loadBoard = (id) => hrApi(`/tasks/board/${id}`).then((d) => { setBoard(d); setViewerId(id); }).catch((e) => setErr(e.message));
  useEffect(() => {
    // Everyone lands on their OWN board first.
    hrApi('/tasks/my-board').then((d) => { setBoard(d); setViewerId(d.viewer.id); setMyBoardId(d.viewer.id); }).catch((e) => setErr(e.message));
    // Load the people list for the top switcher (admin/HR can view others).
    hrApi('/tasks/boards').then(setPeople).catch(() => {});
  }, []);
  const refresh = () => { if (viewerId != null) loadBoard(viewerId); };

  const addTask = async (bucket) => {
    if (!newTitle.trim() || viewerId == null) return;
    try { await hrApi('/tasks/tasks', { method: 'POST', body: JSON.stringify({ title: newTitle.trim(), assigneeId: viewerId, bucket }) }); setNewTitle(''); setAddingIn(null); refresh(); } catch (e) { setErr(e.message); }
  };
  const patchTask = async (id, patch) => { try { await hrApi(`/tasks/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }); refresh(); } catch (e) { setErr(e.message); } };
  const delTask = async (id) => { try { await hrApi(`/tasks/tasks/${id}`, { method: 'DELETE' }); refresh(); } catch (e) { setErr(e.message); } };
  const moveToBucket = async (id, bucket) => { setDragId(null); setDragOver(null); await patchTask(id, { bucket }); };

  if (err) return <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">{err}</div>;

  if (!board) return <div className="text-slate-400 text-sm py-10 text-center">Loading board…</div>;

  const viewingOwn = viewerId === myBoardId;

  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const isOverdue = (t) => t.dueDate && String(t.dueDate).slice(0, 10) < today && t.stage !== 'completed';
  const applyFilter = (list) => list.filter((t) => filter === 'all' ? true : filter === 'mine' ? t.relation === 'mine' : filter === 'overdue' ? isOverdue(t) : filter === 'high' ? (t.priority === 'high' || t.priority === 'urgent') : true);
  const applySort = (list) => {
    if (sort === 'manual') return list;
    const copy = [...list];
    if (sort === 'due') copy.sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
    if (sort === 'priority') { const rank = { urgent: 0, high: 1, medium: 2, low: 3 }; copy.sort((a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9)); }
    return copy;
  };
  const prep = (list) => applySort(applyFilter(list));

  // Section accent colors (Asana-style light tints).
  const SECTION_COLORS = {
    recently_assigned: { bar: '#F97316', head: '#FFF7ED', text: '#C2410C' },
    today: { bar: '#EF4444', head: '#FEF2F2', text: '#B91C1C' },
    tomorrow: { bar: '#F59E0B', head: '#FFFBEB', text: '#B45309' },
    next_week: { bar: '#3B82F6', head: '#EFF6FF', text: '#1D4ED8' },
    later: { bar: '#64748B', head: '#F8FAFC', text: '#475569' },
  };
  const COL = 'grid items-center gap-0';
  // Column template: expander | check | task name | assignee | deadline | priority | status | (del)
  const GRID_COLS = '28px 28px minmax(0,1fr) 150px 120px 130px 140px 40px';

  const fmtDate = (d) => d ? new Date(String(d).slice(0, 10) + 'T00:00:00+05:30').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';

  // One editable cell row in the Excel-style grid.
  const GridRow = ({ t, tracking, isSub }) => {
    const overdue = isOverdue(t);
    const hasSubs = !isSub && t.subtaskCount > 0;
    const expanded = !!expandedTasks[t._id];
    return (
      <>
        <div
          draggable={!tracking && !isSub}
          onDragStart={() => !tracking && !isSub && setDragId(t._id)}
          onDragEnd={() => { setDragId(null); setDragOver(null); }}
          className={`${COL} border-b border-slate-200 hover:bg-slate-50/80 ${dragId === t._id ? 'opacity-40' : ''} ${isSub ? 'bg-slate-50/40' : 'bg-white'}`}
          style={{ gridTemplateColumns: GRID_COLS }}
        >
          {/* expander */}
          <div className="flex items-center justify-center h-9 border-r border-slate-100">
            {hasSubs ? <button onClick={() => setExpandedTasks((e) => ({ ...e, [t._id]: !e[t._id] }))} className={`text-slate-400 text-[10px] transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</button>
              : (!tracking && !isSub) ? <span className="text-slate-200 cursor-grab text-xs" title="Drag">⠿</span> : null}
          </div>
          {/* checkbox */}
          <div className="flex items-center justify-center h-9 border-r border-slate-100">
            <button onClick={() => patchTask(t._id, { stage: t.stage === 'completed' ? 'not_started' : 'completed' })} className={`w-4 h-4 rounded-full border-2 ${t.stage === 'completed' ? 'bg-green-500 border-green-500' : 'border-slate-300 hover:border-green-400'}`} />
          </div>
          {/* task name + description preview (click → drawer) */}
          <div className={`px-3 py-1 min-h-9 flex flex-col justify-center border-r border-slate-100 overflow-hidden ${isSub ? 'pl-10' : ''}`}>
            <div className="flex items-center min-w-0">
              {isSub && <span className="text-slate-300 mr-1.5 text-xs shrink-0" title="subtask">↳</span>}
              <button onClick={() => setOpenTask(t)} className={`text-sm font-bold truncate text-left hover:underline ${t.stage === 'completed' ? 'text-slate-400 line-through' : 'text-[#050A1F]'}`}>{t.title}</button>
              {hasSubs && <span className="ml-2 text-[10px] text-slate-400 shrink-0">{t.subtaskDone}/{t.subtaskCount}</span>}
              {tracking && t.assignee && <span className="ml-2 text-[10px] text-purple-500 shrink-0">→ {titleCase(t.assignee.name)}</span>}
            </div>
            {(() => { const d = plainPreview(t.description); return d ? <div className="text-[11px] text-slate-400 truncate leading-tight">{d}</div> : null; })()}
          </div>
          {/* assignee (inline picker) */}
          <div className="px-2 h-9 flex items-center border-r border-slate-100 min-w-0 overflow-hidden">
            {tracking ? <span className="flex items-center gap-1.5 text-xs text-slate-600 truncate min-w-0"><TAvatar person={t.assignee} size={20} /> <span className="truncate">{t.assignee && titleCase(t.assignee.name)}</span></span>
              : <AssigneePicker value={t.assignee} onChange={(p) => patchTask(t._id, { assigneeId: p ? p.id : null })} allowClear compact />}
          </div>
          {/* deadline (inline date) */}
          <div className="px-2 h-9 flex items-center border-r border-slate-100">
            {tracking ? <span className={`text-xs ${overdue ? 'text-red-500 font-bold' : 'text-slate-500'}`}>{fmtDate(t.dueDate) || '—'}</span>
              : <input type="date" value={t.dueDate ? String(t.dueDate).slice(0, 10) : ''} onChange={(e) => patchTask(t._id, { dueDate: e.target.value || null })} className={`text-xs bg-transparent focus:outline-none w-full ${overdue ? 'text-red-500 font-bold' : 'text-slate-500'}`} />}
          </div>
          {/* priority — solid-fill cell (monday.com style) */}
          <div className="h-9 flex items-center border-r border-slate-100" style={{ background: PRIO_FILL[t.priority] || '#94A3B8' }}>
            {tracking ? <span className="w-full text-center text-[11px] font-bold text-white">{PRIO[t.priority] ? PRIO[t.priority].label : t.priority}</span>
              : <select value={t.priority} onChange={(e) => patchTask(t._id, { priority: e.target.value })} className="w-full h-full text-center text-[11px] font-bold text-white bg-transparent border-0 focus:outline-none cursor-pointer appearance-none px-2">{Object.keys(PRIO).map((k) => <option key={k} value={k} className="text-slate-700 bg-white">{PRIO[k].label}</option>)}</select>}
          </div>
          {/* status — solid-fill cell (monday.com style) */}
          <div className="h-9 flex items-center border-r border-slate-100" style={{ background: STAGE_FILL[t.stage] || '#94A3B8' }}>
            {tracking ? <span className="w-full text-center text-[11px] font-bold text-white">{STAGE[t.stage] ? STAGE[t.stage].label : t.stage}</span>
              : <select value={t.stage} onChange={(e) => patchTask(t._id, { stage: e.target.value })} className="w-full h-full text-center text-[11px] font-bold text-white bg-transparent border-0 focus:outline-none cursor-pointer appearance-none px-2">{Object.keys(STAGE).map((k) => <option key={k} value={k} className="text-slate-700 bg-white">{STAGE[k].label}</option>)}</select>}
          </div>
          {/* view → open drawer */}
          <div className="flex items-center justify-center h-9">
            <button onClick={() => setOpenTask(t)} className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-[#050A1F] hover:bg-slate-100" title="View task"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></button>
          </div>
        </div>
        {/* inline subtasks */}
        {expanded && (t.subtasks || []).map((s) => <GridRow key={s._id} t={s} isSub />)}
      </>
    );
  };

  // Column header row.
  const HeaderRow = () => (
    <div className={`${COL} bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wide text-[#050A1F]`} style={{ gridTemplateColumns: GRID_COLS }}>
      <div className="h-8 border-r border-slate-100" />
      <div className="h-8 border-r border-slate-100" />
      <div className="px-3 h-8 flex items-center justify-center border-r border-slate-100">Task name</div>
      <div className="px-2 h-8 flex items-center justify-center border-r border-slate-100">Assignee</div>
      <div className="px-2 h-8 flex items-center justify-center border-r border-slate-100">Deadline</div>
      <div className="px-2 h-8 flex items-center justify-center border-r border-slate-100">Priority</div>
      <div className="px-2 h-8 flex items-center justify-center border-r border-slate-100">Status</div>
      <div className="h-8" />
    </div>
  );

  const bucketByKey = Object.fromEntries((board.buckets || []).map((b) => [b.key, b]));

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <TAvatar person={board.viewer} size={36} />
          <div>
            <h1 className="text-xl font-extrabold text-[#050A1F]">{viewingOwn ? 'My tasks' : `${board.viewer.name}’s tasks`}</h1>
            {isAdmin && (
              <select value={viewerId} onChange={(e) => loadBoard(Number(e.target.value))} className="mt-0.5 text-[11px] text-slate-500 bg-transparent border border-slate-200 rounded-md px-1.5 py-0.5 focus:outline-none">
                {myBoardId != null && <option value={myBoardId}>My board</option>}
                {people.filter((p) => p.id !== myBoardId).map((p) => <option key={p.id} value={p.id}>{titleCase(p.name)}{p.taskCount ? ` (${p.taskCount})` : ''}</option>)}
              </select>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-600"><option value="all">Filter: All</option><option value="mine">Mine to do</option><option value="overdue">Overdue</option><option value="high">High/Urgent</option></select>
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-600"><option value="manual">Sort: Manual</option><option value="due">Due date</option><option value="priority">Priority</option></select>
          <div className="inline-flex bg-slate-100 rounded-lg p-0.5">
            {['list', 'board'].map((v) => <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 text-xs font-bold rounded-md capitalize ${view === v ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>{v}</button>)}
          </div>
        </div>
      </div>

      {view === 'list' ? (
        <div className="space-y-4">
          {BUCKETS.map(({ key, label }) => {
            const bk = bucketByKey[key] || { tasks: [] };
            const rows = prep(bk.tasks);
            const isOpen = !collapsed[key];
            const c = SECTION_COLORS[key];
            return (
              <div key={key}
                onDragOver={(e) => { if (dragId) { e.preventDefault(); setDragOver(key); } }}
                onDragLeave={() => setDragOver((d) => d === key ? null : d)}
                onDrop={(e) => { e.preventDefault(); if (dragId) moveToBucket(dragId, key); }}
                className={`rounded-xl border overflow-hidden transition ${dragOver === key ? 'border-orange-400 ring-2 ring-orange-200' : 'border-slate-200'}`}
                style={{ borderLeft: `4px solid ${c.bar}` }}
              >
                <button onClick={() => setCollapsed((cc) => ({ ...cc, [key]: !cc[key] }))} className="w-full flex items-center gap-2 px-4 py-2.5 text-left" style={{ background: c.head }}>
                  <span className={`text-xs transition-transform ${isOpen ? 'rotate-90' : ''}`} style={{ color: c.text }}>▶</span>
                  <span className="text-sm font-extrabold" style={{ color: c.text }}>{label}</span>
                  <span className="text-xs font-bold rounded-full px-2 py-0.5" style={{ background: c.bar, color: '#fff' }}>{bk.tasks.length}</span>
                  {key === 'recently_assigned' && bk.tasks.length > 0 && <span className="text-[10px] font-bold ml-1" style={{ color: c.text }}>NEW</span>}
                </button>
                {isOpen && (
                  <div>
                    {rows.length > 0 && <HeaderRow />}
                    {rows.map((t) => <GridRow key={t._id} t={t} />)}
                    {addingIn === key
                      ? <div className="flex items-center gap-2 px-4 py-2 border-t border-slate-200 bg-white"><input autoFocus value={newTitle} onChange={(e) => setNewTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTask(key)} onBlur={() => { if (!newTitle.trim()) setAddingIn(null); }} placeholder="Task name…" className="flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300" /><button onClick={() => addTask(key)} className="text-xs font-bold text-white rounded-lg px-3 py-1.5" style={{ background: ORANGE }}>Add</button></div>
                      : <button onClick={() => { setAddingIn(key); setNewTitle(''); }} className="w-full text-left px-4 py-2 text-xs text-slate-400 hover:text-slate-600 hover:bg-slate-50 border-t border-slate-200 bg-white">+ Add task</button>}
                  </div>
                )}
              </div>
            );
          })}

          {/* Assigned by me */}
          <div className="rounded-xl border-2 border-purple-200 bg-purple-50/50 overflow-hidden mt-6">
            <div className="px-4 py-3 flex items-center gap-2 border-b border-purple-100">
              <span className="w-6 h-6 rounded-lg bg-purple-500 text-white flex items-center justify-center text-xs font-bold">↗</span>
              <span className="text-sm font-extrabold text-purple-700">{viewingOwn ? 'Assigned by me' : `Assigned by ${board.viewer.name}`}</span>
              <span className="text-xs font-bold text-white bg-purple-500 rounded-full px-2 py-0.5">{(board.tracking || []).length}</span>
              <span className="text-[11px] text-purple-400 ml-auto">live status · for standups</span>
            </div>
            {(board.tracking || []).length === 0
              ? <div className="px-4 py-4 text-xs text-slate-400 bg-white">Tasks {viewingOwn ? 'you assign' : 'assigned'} to others appear here to track progress without opening their board.</div>
              : <div className="bg-white"><HeaderRow />{prep(board.tracking).map((t) => <GridRow key={t._id} t={t} tracking />)}</div>}
          </div>

          {/* Completed (minimized by default) */}
          <div className="rounded-xl border border-green-200 bg-green-50/40 overflow-hidden">
            <button onClick={() => setShowCompleted((s) => !s)} className="w-full px-4 py-3 flex items-center gap-2 text-left">
              <span className={`text-green-600 text-xs transition-transform ${showCompleted ? 'rotate-90' : ''}`}>▶</span>
              <span className="w-6 h-6 rounded-lg bg-green-500 text-white flex items-center justify-center text-xs font-bold">✓</span>
              <span className="text-sm font-extrabold text-green-700">Completed</span>
              <span className="text-xs font-bold text-white bg-green-500 rounded-full px-2 py-0.5">{(board.completed || []).length}</span>
              <span className="text-[11px] text-green-500 ml-auto">{showCompleted ? 'click to minimize' : 'click to expand'}</span>
            </button>
            {showCompleted && (
              (board.completed || []).length === 0
                ? <div className="px-4 py-4 text-xs text-slate-400 bg-white">No completed tasks yet.</div>
                : <div className="bg-white"><HeaderRow />{prep(board.completed).map((t) => <GridRow key={t._id} t={t} />)}</div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {['not_started', 'in_progress', 'completed'].map((st) => {
            const all = [...(board.buckets || []).flatMap((b) => b.tasks), ...(board.completed || [])];
            return (
              <div key={st} onDragOver={(e) => { if (dragId) { e.preventDefault(); setDragOver('stage:' + st); } }} onDrop={(e) => { e.preventDefault(); if (dragId) { patchTask(dragId, { stage: st }); setDragId(null); setDragOver(null); } }} className={`rounded-xl p-2 transition ${dragOver === 'stage:' + st ? 'bg-orange-50 ring-2 ring-orange-200' : 'bg-slate-50'}`}>
                <div className="px-2 py-1 mb-1"><Pill map={STAGE} value={st} /></div>
                <div className="space-y-2">
                  {prep(all.filter((t) => t.stage === st)).map((t) => (
                    <div key={t._id} draggable onDragStart={() => setDragId(t._id)} onDragEnd={() => { setDragId(null); setDragOver(null); }} onClick={() => setOpenTask(t)} className="bg-white rounded-lg border border-slate-200 p-3 cursor-pointer hover:shadow-sm">
                      <div className="text-sm font-semibold text-[#050A1F] mb-2">{t.title}</div>
                      <div className="flex items-center justify-between"><Pill map={PRIO} value={t.priority} /><TAvatar person={t.assignee} size={22} /></div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {openTask && <TaskDetailDrawer taskId={openTask._id} onClose={() => setOpenTask(null)} onChange={refresh} />}
    </div>
  );
}

// Right-side detail drawer: fields, subtasks, attachments, notes, activity.
// Rich-text editor (TipTap) for task/subtask descriptions. Emits sanitized-ish
// HTML on blur. A compact toolbar covers the Asana basics.
function RichText({ value, onSave, placeholder }) {
  const lastSaved = useRef(value || '');
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [2, 3] } }), Link.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } })],
    content: value || '',
    editorProps: { attributes: { class: 'prose prose-sm max-w-none focus:outline-none min-h-[70px] px-3 py-2' } },
  });
  useEffect(() => { if (editor && value !== editor.getHTML()) { editor.commands.setContent(value || '', false); lastSaved.current = value || ''; } /* eslint-disable-next-line */ }, [editor]);
  if (!editor) return null;
  const Btn = ({ on, active, children, title }) => (
    <button type="button" title={title} onMouseDown={(e) => { e.preventDefault(); on(); }} className={`w-7 h-7 rounded text-xs font-bold flex items-center justify-center ${active ? 'bg-slate-200 text-[#050A1F]' : 'text-slate-500 hover:bg-slate-100'}`}>{children}</button>
  );
  const setLink = () => { const prev = editor.getAttributes('link').href; const url = window.prompt('Link URL', prev || 'https://'); if (url === null) return; if (url === '') { editor.chain().focus().unsetLink().run(); return; } editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run(); };
  return (
    <div className="rounded-lg border border-slate-200 focus-within:ring-2 focus-within:ring-orange-300">
      <div className="flex items-center gap-0.5 border-b border-slate-100 px-1.5 py-1 flex-wrap">
        <Btn title="Bold" on={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')}>B</Btn>
        <Btn title="Italic" on={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')}><span className="italic">I</span></Btn>
        <Btn title="Strikethrough" on={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')}><span className="line-through">S</span></Btn>
        <span className="w-px h-4 bg-slate-200 mx-1" />
        <Btn title="Heading" on={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })}>H</Btn>
        <Btn title="Bullet list" on={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')}>•</Btn>
        <Btn title="Numbered list" on={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')}>1.</Btn>
        <Btn title="Code" on={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')}>{'</>'}</Btn>
        <Btn title="Link" on={setLink} active={editor.isActive('link')}>🔗</Btn>
      </div>
      <div onBlur={() => { const html = editor.getHTML(); if (onSave && html !== lastSaved.current) { lastSaved.current = html; onSave(html); } }}>
        <EditorContent editor={editor} />
        {editor.isEmpty && placeholder && <div className="px-3 -mt-[60px] text-sm text-slate-400 pointer-events-none">{placeholder}</div>}
      </div>
    </div>
  );
}

// Read-only render of stored description HTML.
function RichView({ html }) {
  if (!html || html === '<p></p>') return <div className="text-sm text-slate-400">No description.</div>;
  return <div className="prose prose-sm max-w-none text-slate-700" dangerouslySetInnerHTML={{ __html: html }} />;
}

// Upload a file to a task via the server (validates + pushes to ImageKit).
async function uploadTaskFile(taskId, file, onDone, onErr) {
  const MAX = 10 * 1024 * 1024;
  if (file.size > MAX) { onErr && onErr('File is larger than the 10 MB limit.'); return; }
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const base64 = String(reader.result);
      await hrApi(`/tasks/tasks/${taskId}/upload`, { method: 'POST', body: JSON.stringify({ name: file.name, mime: file.type, base64 }) });
      onDone && onDone();
    } catch (e) { onErr && onErr(e.message); }
  };
  reader.onerror = () => onErr && onErr('Could not read the file.');
  reader.readAsDataURL(file);
}

function TaskDetailDrawer({ taskId, onClose, onChange, isSubtask, parentTitle }) {
  const [data, setData] = useState(null);
  const [note, setNote] = useState('');
  const [newSub, setNewSub] = useState('');
  const [subOpen, setSubOpen] = useState(null);   // open a subtask in its own drawer
  const [uploading, setUploading] = useState(false);
  const [upErr, setUpErr] = useState('');
  const fileRef = useRef(null);
  const load = () => hrApi(`/tasks/tasks/${taskId}/detail`).then(setData).catch(() => {});
  useEffect(() => { load(); }, [taskId]);
  const patch = async (p) => { await hrApi(`/tasks/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(p) }); load(); onChange && onChange(); };
  const addNote = async () => { if (!note.trim()) return; await hrApi(`/tasks/tasks/${taskId}/comments`, { method: 'POST', body: JSON.stringify({ body: note.trim() }) }); setNote(''); load(); };
  const addSub = async () => { if (!newSub.trim()) return; await hrApi('/tasks/tasks', { method: 'POST', body: JSON.stringify({ title: newSub.trim(), parentTaskId: taskId, assigneeId: data && data.task && data.task.assignee ? data.task.assignee.id : undefined }) }); setNewSub(''); load(); onChange && onChange(); };
  const toggleSub = async (s) => { await hrApi(`/tasks/tasks/${s._id}`, { method: 'PATCH', body: JSON.stringify({ stage: s.stage === 'completed' ? 'not_started' : 'completed' }) }); load(); };
  const onPickFile = (e) => { const f = e.target.files && e.target.files[0]; if (!f) return; setUpErr(''); setUploading(true); uploadTaskFile(taskId, f, () => { setUploading(false); load(); }, (m) => { setUploading(false); setUpErr(m); }); e.target.value = ''; };
  const delAttach = async (id) => { await hrApi(`/tasks/attachments/${id}`, { method: 'DELETE' }); load(); };

  if (!data) return null;
  const t = data.task;
  return (
    <div className="fixed inset-0 z-[120] flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative bg-white w-full h-full shadow-2xl overflow-auto" style={{ maxWidth: '806px' }} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-3 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            {isSubtask && <button onClick={onClose} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-100" title="Back to task">← Back to task</button>}
            <button onClick={() => patch({ stage: t.stage === 'completed' ? 'not_started' : 'completed' })} className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-bold ${t.stage === 'completed' ? 'bg-green-50 border-green-200 text-green-700' : 'border-slate-200 text-slate-600'}`}>✓ {t.stage === 'completed' ? 'Completed' : 'Mark complete'}</button>
          </div>
          <div className="flex items-center gap-1">
            {data.canDelete && <button onClick={async () => { if (confirm('Delete this task' + ((data.subtasks && data.subtasks.length) ? ' and its subtasks' : '') + '? This cannot be undone.')) { try { await hrApi(`/tasks/tasks/${taskId}`, { method: 'DELETE' }); onChange && onChange(); onClose(); } catch (e) { alert(e.message); } } }} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-red-50 hover:text-red-500" title="Delete task"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg></button>}
            <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-slate-100 text-slate-400" title="Close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
          </div>
        </div>
        <div className="p-5">
          {isSubtask && <div className="text-[11px] text-slate-400 mb-2">Subtask{parentTitle ? <> of <span className="font-semibold text-slate-500">{parentTitle}</span></> : ''}</div>}
          <input defaultValue={t.title} onBlur={(e) => e.target.value.trim() && e.target.value !== t.title && patch({ title: e.target.value.trim() })} className="w-full text-xl font-extrabold text-[#050A1F] mb-4 focus:outline-none" />
          <div className="space-y-3 mb-5">
            <TField label="Assignee"><AssigneePicker value={t.assignee} onChange={(p) => patch({ assigneeId: p ? p.id : null })} allowClear /></TField>
            <TField label="Due date"><input type="date" defaultValue={t.dueDate ? String(t.dueDate).slice(0, 10) : ''} onChange={(e) => patch({ dueDate: e.target.value || null })} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs" /></TField>
            <TField label="Priority"><select value={t.priority} onChange={(e) => patch({ priority: e.target.value })} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs">{Object.keys(PRIO).map((k) => <option key={k} value={k}>{PRIO[k].label}</option>)}</select></TField>
            <TField label="Stage"><select value={t.stage} onChange={(e) => patch({ stage: e.target.value })} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs">{Object.keys(STAGE).map((k) => <option key={k} value={k}>{STAGE[k].label}</option>)}</select></TField>
            {!t.parentTaskId && <TField label="Section"><select value={t.bucket || 'recently_assigned'} onChange={(e) => patch({ bucket: e.target.value })} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs"><option value="recently_assigned">Recently Assigned</option><option value="today">Do Today</option><option value="tomorrow">Do Tomorrow</option><option value="next_week">Do Next Week</option><option value="later">Do Later</option></select></TField>}
          </div>

          <div className="mb-5">
            <div className="text-xs font-bold text-slate-500 mb-1">Description</div>
            <RichText value={t.description} placeholder="What is this task about?" onSave={(html) => html !== t.description && patch({ description: html })} />
          </div>

          <div className="mb-5">
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs font-bold text-slate-500">Attachments</div>
              <button onClick={() => fileRef.current && fileRef.current.click()} disabled={uploading} className="text-[11px] font-bold text-orange-500 disabled:opacity-50">{uploading ? 'Uploading…' : '+ Attach file'}</button>
              <input ref={fileRef} type="file" className="hidden" onChange={onPickFile} />
            </div>
            {upErr && <div className="text-[11px] text-red-500 mb-1">{upErr}</div>}
            {data.attachments.length === 0
              ? <div className="text-xs text-slate-400">No files attached.</div>
              : <div className="space-y-1">{data.attachments.map((a) => (
                  <div key={a._id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5">
                    <a href={a.url} target="_blank" rel="noreferrer" className="text-xs text-blue-500 hover:underline truncate flex-1">📎 {a.name || a.url}</a>
                    {a.size ? <span className="text-[10px] text-slate-400">{(a.size / 1024).toFixed(0)} KB</span> : null}
                    <button onClick={() => delAttach(a._id)} className="text-slate-300 hover:text-red-500 text-xs">✕</button>
                  </div>
                ))}</div>}
          </div>

          {!t.parentTaskId && (
            <div className="mb-5">
              <div className="text-xs font-bold text-slate-500 mb-1">Subtasks {data.subtasks.length > 0 && <span className="text-slate-400 font-normal">· {data.subtasks.filter((s) => s.stage === 'completed').length}/{data.subtasks.length}</span>}</div>
              <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
                {data.subtasks.map((s) => (
                  <div key={s._id} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer" onClick={() => setSubOpen(s._id)}>
                    <button onClick={(e) => { e.stopPropagation(); toggleSub(s); }} className={`w-4 h-4 rounded-full border-2 shrink-0 ${s.stage === 'completed' ? 'bg-green-500 border-green-500' : 'border-slate-300 hover:border-green-400'}`} />
                    <span className={`text-sm flex-1 truncate ${s.stage === 'completed' ? 'text-slate-400 line-through' : 'text-[#050A1F]'}`}>{s.title}</span>
                    {s.dueDate && <span className="text-[10px] text-slate-400">{new Date(String(s.dueDate).slice(0, 10) + 'T00:00:00+05:30').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>}
                    <TAvatar person={s.assignee} size={20} />
                    <span className="text-slate-300 text-xs">›</span>
                  </div>
                ))}
                <div className="flex items-center gap-2 px-3 py-2"><input value={newSub} onChange={(e) => setNewSub(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSub()} placeholder="+ Add subtask" className="flex-1 text-sm focus:outline-none bg-transparent" /></div>
              </div>
            </div>
          )}

          <div className="mb-3">
            <div className="text-xs font-bold text-slate-500 mb-1">Notes</div>
            <div className="space-y-2 mb-2">
              {data.comments.map((c) => (
                <div key={c._id} className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="text-[11px] font-bold text-[#050A1F]">{c.authorName} <span className="text-slate-400 font-normal">{new Date(c.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span></div>
                  <div className="text-sm text-slate-700 whitespace-pre-wrap">{c.body}</div>
                </div>
              ))}
            </div>
            <div className="flex items-stretch gap-2"><input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNote()} placeholder="Add a note…" className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300" /><button onClick={addNote} className="shrink-0 rounded-lg px-3 text-xs font-bold text-white" style={{ background: ORANGE }}>Post</button></div>
          </div>

          {data.activity.length > 0 && (
            <div className="mt-4 pt-3 border-t border-slate-100"><div className="text-[11px] font-bold text-slate-400 uppercase mb-1">Activity</div>{data.activity.map((a) => <div key={a._id} className="text-[11px] text-slate-400">{a.actorName} {a.detail} · {new Date(a.createdAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</div>)}</div>
          )}
        </div>
      </div>
      {subOpen && <TaskDetailDrawer taskId={subOpen} isSubtask parentTitle={t.title} onClose={() => setSubOpen(null)} onChange={() => { load(); onChange && onChange(); }} />}
    </div>
  );
}
function TField({ label, children }) { return <div className="flex items-center gap-3"><div className="text-xs font-bold text-slate-500 w-20 shrink-0">{label}</div>{children}</div>; }

// Placeholder for Core HR modules not yet built. Real modules (Attendance,
// Leave, Payroll, Expenses, Stock Management, Onboarding) land in later phases.
function CoreHrPlaceholder({ title }) {
  return (
    <div className="max-w-2xl mx-auto text-center py-20">
      <div className="w-14 h-14 rounded-2xl bg-orange-50 text-[#FF6A00] flex items-center justify-center mx-auto mb-4">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
      </div>
      <h1 className="text-2xl font-extrabold text-[#050A1F] mb-2">{title}</h1>
      <p className="text-sm text-slate-400">This Core HR module is coming soon.</p>
    </div>
  );
}

// ===== Attendance module (Core HR → Attendance) =====
const ATT_STATUS = {
  present: { label: 'Present', fill: '#22C55E' },
  absent_leave: { label: 'Absent', fill: '#EF4444' },
  half_day: { label: 'Half Day', fill: '#F59E0B' },
  wfh: { label: 'WFH', fill: '#8B5CF6' },
  lop: { label: 'LOP', fill: '#64748B' },
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function AttendanceModule({ user, isAdmin, onOpenEmployee }) {
  const canAll = isAdmin || user.hrManagerAll || (user.hrManagerScope === 'all');
  const scopedBranch = !canAll ? (user.hrManagerScope && user.hrManagerScope !== 'all' ? user.hrManagerScope : user.branch) : '';
  const [branch, setBranch] = useState(canAll ? '' : scopedBranch); // '' = all (combined)
  const now = new Date(Date.now() + 330 * 60000);
  const [month, setMonth] = useState(now.toISOString().slice(0, 7));
  const [cal, setCal] = useState(null);
  const [openDate, setOpenDate] = useState(null);
  const [err, setErr] = useState('');

  const loadCal = () => {
    const q = new URLSearchParams({ month }); if (branch) q.set('branch', branch);
    hrApi(`/attendance/calendar?${q}`).then(setCal).catch((e) => setErr(e.message));
  };
  useEffect(() => { setCal(null); loadCal(); /* eslint-disable-next-line */ }, [month, branch]);

  if (openDate) return <AttendanceDay date={openDate} branch={branch} onBack={() => { setOpenDate(null); loadCal(); }} onOpenEmployee={onOpenEmployee} />;

  const [y, m] = month.split('-').map(Number);
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const shiftMonth = (delta) => { const dt = new Date(Date.UTC(y, m - 1 + delta, 1)); setMonth(dt.toISOString().slice(0, 7)); };
  const dayByDate = {}; (cal?.days || []).forEach((d) => { dayByDate[d.date] = d; });

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-[#050A1F]">Attendance</h1>
          <p className="text-sm text-slate-400">Pick a working day to mark attendance. Weekends & holidays are disabled.</p>
        </div>
        <div className="flex items-center gap-2">
          {canAll && (
            <select value={branch} onChange={(e) => setBranch(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600">
              <option value="">All branches</option>
              <option value="Bhubaneswar">Bhubaneswar</option>
              <option value="Kolkata">Kolkata</option>
            </select>
          )}
          {!canAll && <span className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-xs font-bold text-blue-700">{scopedBranch} branch</span>}
        </div>
      </div>

      {err && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">{err}</div>}

      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => shiftMonth(-1)} className="w-9 h-9 rounded-lg border border-slate-200 hover:bg-slate-50 flex items-center justify-center text-slate-500"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg></button>
          <div className="text-lg font-extrabold text-[#050A1F]">{MONTHS[m - 1]} {y}</div>
          <button onClick={() => shiftMonth(1)} className="w-9 h-9 rounded-lg border border-slate-200 hover:bg-slate-50 flex items-center justify-center text-slate-500"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></button>
        </div>
        {!cal ? <div className="py-16 text-center text-slate-400 text-sm">Loading…</div> : (
          <>
            <div className="grid grid-cols-7 gap-1.5 mb-1.5">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="text-center text-[11px] font-bold text-slate-400 uppercase py-1">{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} />)}
              {(cal.days || []).map((d) => {
                const dayNum = Number(d.date.slice(-2));
                const todayStr = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
                const isToday = d.date === todayStr;
                const hasData = !d.disabled && d.total > 0 && d.marked > 0;
                // Color band by present rate (present ÷ total).
                let cellStyle = { background: '#fff', borderColor: '#e2e8f0' };
                if (d.holiday) cellStyle = { background: '#EFF6FF', borderColor: '#93C5FD' };
                else if (d.weekendOff) cellStyle = { background: '#E2E8F0', borderColor: '#CBD5E1' };
                else if (hasData && d.presentPct >= 90) cellStyle = { background: '#F0FDF4', borderColor: '#16A34A' };
                else if (hasData && d.presentPct < 60) cellStyle = { background: '#FEF2F2', borderColor: '#DC2626' };
                if (isToday) cellStyle.borderColor = '#2563EB';
                return (
                  <button key={d.date} disabled={d.disabled}
                    onClick={() => !d.disabled && setOpenDate(d.date)}
                    className={`aspect-square rounded-xl p-2 flex flex-col items-start justify-between text-left transition ${d.disabled ? 'cursor-not-allowed' : 'hover:shadow-md'}`}
                    style={{ ...cellStyle, borderWidth: isToday ? '2px' : '1px', borderStyle: 'solid' }}>
                    <span className={`text-sm font-bold ${d.holiday ? 'text-blue-700' : d.weekendOff ? 'text-slate-500' : 'text-[#050A1F]'}`}>{dayNum}</span>
                    {d.holiday ? (
                      <span className="text-[12px] font-extrabold text-blue-600 leading-tight">{d.holidayName || 'Holiday'}</span>
                    ) : d.weekendOff ? (
                      <span className="text-[10px] font-bold uppercase text-slate-500">Week Off</span>
                    ) : (
                      <span className={`text-base font-extrabold ${d.presentPct >= 90 && hasData ? 'text-green-700' : d.presentPct < 60 && hasData ? 'text-red-600' : d.marked > 0 ? 'text-slate-700' : 'text-slate-300'}`}>{d.present ?? 0}/{d.total}</span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-4 mt-4 text-[11px] text-slate-400 flex-wrap">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded inline-block" style={{ background: '#F0FDF4', border: '1px solid #16A34A' }} /> ≥90% present</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded inline-block" style={{ background: '#FEF2F2', border: '1px solid #DC2626' }} /> &lt;60% present</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded inline-block" style={{ background: '#E2E8F0' }} /> Week off</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded inline-block" style={{ background: '#EFF6FF', border: '1px solid #93C5FD' }} /> Holiday</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded inline-block border-2 border-blue-600" /> Today</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Daily entry page: employees grouped branch → dept, 5 status buttons each.
// Small avatar circle shown on an attendance record that HR manually corrected.
// Hover to see who edited it, when, and the original clock times. Falls back to
// the HR person's initials when no photo is set.
function EditedByBadge({ edit }) {
  if (!edit) return null;
  const initials = String(edit.byName || 'HR').split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase();
  const when = (() => { try { return new Date(edit.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } })();
  const orig = [edit.originalLogin ? `in ${edit.originalLogin}` : null, edit.originalLogout ? `out ${edit.originalLogout}` : null].filter(Boolean).join(' · ');
  const title = `Time corrected by ${edit.byName || 'HR'}${when ? ' on ' + when : ''}${orig ? ` — original: ${orig}` : ' — no original clock time'}`;
  return (
    <span className="inline-flex items-center gap-1" title={title}>
      <span className="text-[10px] text-amber-600 font-bold">edited</span>
      {edit.byAvatar
        ? <img src={edit.byAvatar} alt={edit.byName || 'HR'} className="w-5 h-5 rounded-full object-cover border border-amber-200" />
        : <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-[9px] font-extrabold flex items-center justify-center border border-amber-200">{initials}</span>}
    </span>
  );
}

function AttendanceDay({ date, branch, onBack, onOpenEmployee }) {
  const [data, setData] = useState(null);
  const [summary, setSummary] = useState(null);
  const [marks, setMarks] = useState({}); // empId → {status, loginTime, logoutTime, leaveType}
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState(null); // null | present | absent_leave | half_day | wfh | lop | late

  const load = () => {
    const q = new URLSearchParams(); if (branch) q.set('branch', branch);
    hrApi(`/attendance/day/${date}?${q}`).then((d) => {
      setData(d);
      const init = {};
      Object.values(d.groups || {}).forEach((depts) => Object.values(depts).forEach((emps) => emps.forEach((e) => {
        if (e.status) {
          const uiStatus = e.status === 'leave' ? 'absent_leave' : (e.status === 'absent' ? 'lop' : e.status);
          init[e.id] = { status: uiStatus, loginTime: e.loginTime || '', logoutTime: e.logoutTime || '', leaveType: e.leaveType || '', late: !!e.late, timeEdited: e.timeEdited || null, source: e.source || null };
        }
      })));
      setMarks(init);
    }).catch((e) => setErr(e.message));
    loadSummary();
  };
  const loadSummary = () => { const q = new URLSearchParams(); if (branch) q.set('branch', branch); hrApi(`/attendance/day/${date}/summary?${q}`).then(setSummary).catch(() => {}); };
  useEffect(load, [date, branch]);

  const setMark = (id, patch) => setMarks((m) => ({ ...m, [id]: { ...(m[id] || {}), ...patch } }));
  // Toggle behaviour: clicking the active status again clears it (status + times +
  // leave type) locally AND marks it for deletion on the server on next save.
  const [cleared, setCleared] = useState({}); // empId → true (to delete on save)
  const [absentFor, setAbsentFor] = useState(null); // employee whose Absent popup is open
  const openAbsent = (e) => setAbsentFor(e);
  const pick = (id, status) => {
    const cur = marks[id] && marks[id].status;
    if (cur === status) {
      setMarks((m) => { const n = { ...m }; delete n[id]; return n; });
      setCleared((c) => ({ ...c, [id]: true }));
      return;
    }
    setCleared((c) => { const n = { ...c }; delete n[id]; return n; }); // re-selected → not cleared
    if (status === 'half_day' || status === 'absent_leave') setMark(id, { status, leaveType: marks[id]?.leaveType || 'casual', late: false });
    else setMark(id, { status, late: false });
  };

  // Client-side late hint: login later than shift start + grace.
  const toMin = (t) => { if (!t) return null; const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
  const isLate = (e, mk) => {
    if (!mk || (mk.status !== 'present' && mk.status !== 'half_day')) return false;
    if (!e.shiftStart || !mk.loginTime) return mk.late || false;
    const g = (data && data.graceMinutes) || 30;
    return toMin(mk.loginTime) > toMin(e.shiftStart) + g;
  };

  const save = async () => {
    setErr(''); setMsg(''); setSaving(true);
    const entries = Object.entries(marks).filter(([, v]) => v && v.status).map(([id, v]) => ({ employeeId: Number(id), status: v.status, loginTime: v.loginTime || null, logoutTime: v.logoutTime || null, leaveType: v.leaveType || '', approvedBy: v.approvedBy || '', notes: v.notes || '', duration: v.duration || '' }));
    // Toggled-off employees → tell the server to delete their record for this day.
    Object.keys(cleared).forEach((id) => { if (!marks[id]) entries.push({ employeeId: Number(id), clear: true }); });
    try {
      const r = await hrApi(`/attendance/day/${date}`, { method: 'PUT', body: JSON.stringify({ entries }) });
      const lopForced = (r.results || []).filter((x) => x.forcedLop).length;
      const wfhBlocked = (r.results || []).filter((x) => x.error && /wfh yearly/i.test(x.error)).length;
      const errs = (r.results || []).filter((x) => x.error && !/cleared/i.test(x.error));
      const saved = entries.filter((e) => !e.clear).length;
      setMsg(`Saved ${saved} entries${lopForced ? ` · ${lopForced} forced to LOP (no balance)` : ''}${wfhBlocked ? ` · ${wfhBlocked} WFH blocked (yearly limit)` : ''}.`);
      setCleared({});
      load();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  };

  // Does an employee match the active search + box filter?
  const matches = (e) => {
    if (search && !(`${e.name} ${e.employeeId || ''} ${e.designation || ''}`.toLowerCase().includes(search.toLowerCase()))) return false;
    if (filter) {
      const mk = marks[e.id];
      if (filter === 'late') return isLate(e, mk);
      if (!mk) return false;
      return mk.status === filter;
    }
    return true;
  };

  const prettyDate = new Date(date + 'T00:00:00+05:30').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="max-w-5xl mx-auto">
      <button onClick={onBack} className="text-sm text-slate-500 hover:text-[#050A1F] font-semibold mb-3 flex items-center gap-1"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg> Back to calendar</button>
      <h1 className="text-2xl font-extrabold text-[#050A1F] mb-1">{prettyDate}</h1>
      <p className="text-sm text-slate-400 mb-4">Mark attendance for each employee. Present needs login & logout time (can be left blank and filled later).</p>

      {/* Summary boxes — click to filter the list */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <SummaryBox label="Present" value={`${summary.present.count}/${summary.present.total}`} sub={`${summary.present.pct}%`} color="#22C55E" active={filter === 'present'} onClick={() => setFilter(filter === 'present' ? null : 'present')} />
          {summary.byBranch.map((b) => b.weekOff
            ? <SummaryBox key={b.branch} label={`Present · ${b.branch}`} value="Week Off" sub={b.holiday ? 'holiday' : 'weekly off'} color="#94A3B8" />
            : <SummaryBox key={b.branch} label={`Present · ${b.branch}`} value={`${b.count}/${b.total}`} sub={`${b.pct}%`} color="#3B82F6" />)}
          <SummaryBox label="Absent" value={`${summary.absent.count}`} sub="leave + LOP" color="#EF4444" active={filter === 'absent_leave'} onClick={() => setFilter(filter === 'absent_leave' ? null : 'absent_leave')} />
          <SummaryBox label="Late entry" value={`${summary.late ? summary.late.count : 0}`} sub="today" color="#F59E0B" active={filter === 'late'} onClick={() => setFilter(filter === 'late' ? null : 'late')} />
        </div>
      )}

      {/* Search + active filter chip */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.3-4.3" strokeLinecap="round" /></svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee by name or ID…" className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300" />
        </div>
        {filter && <button onClick={() => setFilter(null)} className="rounded-lg bg-slate-100 hover:bg-slate-200 px-3 py-2 text-xs font-bold text-slate-600 flex items-center gap-1">Filter: {filter === 'absent_leave' ? 'Absent' : filter === 'late' ? 'Late' : ATT_STATUS[filter]?.label || filter} ✕</button>}
      </div>


      {err && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">{err}</div>}
      {msg && <div className="mb-3 rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700">{msg}</div>}

      {!data ? <div className="py-16 text-center text-slate-400">Loading…</div> : (
        <div className="space-y-6">
          {Object.entries(data.groups || {}).map(([br, depts]) => (
            <div key={br}>
              <div className="text-sm font-extrabold text-[#050A1F] mb-2 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[#FF6A00]" /> {br}</div>
              {Object.entries(depts).map(([dept, emps]) => (
                <div key={dept} className="mb-3">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5 pl-4">{dept}</div>
                  <div className="space-y-1.5">
                    {emps.filter(matches).map((e) => {
                      const mk = marks[e.id] || {};
                      const late = isLate(e, mk);
                      const isPresent = mk.status === 'present';
                      const isAbsentish = mk.status === 'absent_leave' || mk.status === 'half_day' || mk.status === 'lop' || mk.status === 'wfh';
                      // Human label for the current absent-type selection.
                      const absentLabel = mk.status === 'lop' ? 'LOP'
                        : mk.status === 'wfh' ? 'WFH'
                        : mk.status === 'half_day' ? `Half day${mk.leaveType ? ` · ${mk.leaveType}` : ''}`
                        : mk.status === 'absent_leave' ? `Leave${mk.leaveType ? ` · ${mk.leaveType}` : ''}` : 'Absent';
                      return (
                        <div key={e.id} className="bg-white rounded-xl border border-slate-200 px-4 py-2.5 flex items-center gap-3 flex-wrap">
                          <div className="min-w-[160px] flex-1">
                            <div className="text-sm font-bold text-[#050A1F] flex items-center gap-2">{e.name}
                              {late && <span className="text-[9px] font-bold uppercase bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">Late</span>}
                            </div>
                            <div className="text-[11px] text-slate-400">{e.employeeId || '—'}{e.shiftName ? ` · ${e.shiftName} (${e.shiftStart})` : ''}</div>
                          </div>
                          {/* Two buttons: Present (toggle) + Absent (opens popup). */}
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => pick(e.id, 'present')}
                              className={`px-3.5 py-1.5 rounded-lg text-[12px] font-bold border transition ${isPresent ? 'text-white border-transparent' : 'text-slate-500 border-slate-200 hover:bg-slate-50'}`}
                              style={isPresent ? { background: '#22C55E' } : {}}>Present</button>
                            <button onClick={() => openAbsent(e)}
                              className={`px-3.5 py-1.5 rounded-lg text-[12px] font-bold border transition ${isAbsentish ? 'text-white border-transparent' : 'text-slate-500 border-slate-200 hover:bg-slate-50'}`}
                              style={isAbsentish ? { background: mk.status === 'wfh' ? '#8B5CF6' : mk.status === 'lop' ? '#64748B' : mk.status === 'half_day' ? '#F59E0B' : '#EF4444' } : {}}>
                              {isAbsentish ? absentLabel : 'Absent'}
                            </button>
                          </div>
                          {/* login/logout times for present, wfh, half day */}
                          {(isPresent || mk.status === 'wfh' || mk.status === 'half_day') && (
                            <div className="flex items-center gap-1.5">
                              <input type="time" value={mk.loginTime || ''} onChange={(ev) => setMark(e.id, { loginTime: ev.target.value })} className="rounded-lg border border-slate-200 px-2 py-1 text-xs" title={mk.status === 'half_day' ? 'Login' : 'Login'} />
                              <span className="text-slate-300">–</span>
                              <input type="time" value={mk.logoutTime || ''} onChange={(ev) => setMark(e.id, { logoutTime: ev.target.value })} className="rounded-lg border border-slate-200 px-2 py-1 text-xs" title="Logout" />
                            </div>
                          )}
                          {mk.approvedBy && <span className="text-[10px] text-slate-400">✓ {mk.approvedBy}</span>}
                          {mk.timeEdited && <EditedByBadge edit={mk.timeEdited} />}
                          {/* → open employee profile */}
                          <button onClick={() => onOpenEmployee && onOpenEmployee(e.id)} className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-[#050A1F] hover:bg-slate-100" title="Open employee profile"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ))}
          <div className="sticky bottom-4 flex justify-end">
            <button onClick={save} disabled={saving} className="rounded-xl px-6 py-3 text-sm font-bold text-white shadow-lg disabled:opacity-60" style={{ background: ORANGE }}>{saving ? 'Saving…' : 'Save attendance'}</button>
          </div>
        </div>
      )}
      {absentFor && <AbsentModal emp={absentFor} mark={marks[absentFor.id] || {}} date={date} onClose={() => setAbsentFor(null)} onSave={(patch) => { setMark(absentFor.id, patch); setCleared((c) => { const n = { ...c }; delete n[absentFor.id]; return n; }); setAbsentFor(null); }} onClear={() => { setMarks((m) => { const n = { ...m }; delete n[absentFor.id]; return n; }); setCleared((c) => ({ ...c, [absentFor.id]: true })); setAbsentFor(null); }} />}
    </div>
  );
}

// Absent popup: choose Leave / LOP / WFH. Leave adds day-type, leave type,
// approver and notes; WFH adds approver + times; LOP is a single choice.
function AbsentModal({ emp, mark, date, onClose, onSave, onClear }) {
  const initKind = mark.status === 'lop' ? 'lop' : mark.status === 'wfh' ? 'wfh' : (mark.status === 'half_day' || mark.status === 'absent_leave') ? 'leave' : '';
  const [kind, setKind] = useState(initKind);
  const [duration, setDuration] = useState(mark.status === 'half_day' ? 'half' : 'full');
  const [leaveType, setLeaveType] = useState(mark.leaveType || 'casual');
  const [approvedBy, setApprovedBy] = useState(mark.approvedBy || '');
  const [notes, setNotes] = useState(mark.notes || '');
  const [loginTime, setLoginTime] = useState(mark.loginTime || '');
  const [logoutTime, setLogoutTime] = useState(mark.logoutTime || '');
  const [approvers, setApprovers] = useState([]);
  const [search, setSearch] = useState('');
  const [showList, setShowList] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { hrApi(`/attendance/approvers/${emp.id}`).then((r) => setApprovers(r.approvers || [])).catch(() => setApprovers([])); }, [emp.id]);

  const filtered = approvers.filter((a) => !search || `${a.name} ${a.designation} ${a.role}`.toLowerCase().includes(search.toLowerCase()));
  const needsApprover = kind === 'leave' || kind === 'wfh';

  const save = () => {
    setErr('');
    if (!kind) { setErr('Please choose a status.'); return; }
    if (kind === 'leave') {
      if (!leaveType) { setErr('Select a leave type.'); return; }
      if (!approvedBy) { setErr('Select who approved this leave.'); return; }
      onSave({ status: duration === 'half' ? 'half_day' : 'absent_leave', duration, leaveType, approvedBy, notes,
        loginTime: duration === 'half' ? loginTime : '', logoutTime: duration === 'half' ? logoutTime : '' });
    } else if (kind === 'lop') {
      onSave({ status: 'lop', leaveType: '', approvedBy: '', notes });
    } else if (kind === 'wfh') {
      if (!approvedBy) { setErr('Select who approved this WFH.'); return; }
      onSave({ status: 'wfh', approvedBy, notes, loginTime, logoutTime });
    }
  };

  const Pill = ({ v, label, color }) => (
    <button onClick={() => { setKind(v); setErr(''); }} className={`flex-1 rounded-xl border px-3 py-3 text-sm font-bold transition ${kind === v ? 'text-white border-transparent' : 'text-slate-600 border-slate-200 hover:bg-slate-50'}`} style={kind === v ? { background: color } : {}}>{label}</button>
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div><div className="text-base font-extrabold text-[#050A1F]">Mark absent — {titleCase(emp.name)}</div><div className="text-[11px] text-slate-400">{date}</div></div>
          <button onClick={onClose} className="text-slate-400 text-xl leading-none">×</button>
        </div>
        <div className="p-6 space-y-4">
          {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{err}</div>}
          <div className="flex gap-2">
            <Pill v="leave" label="Leave" color="#EF4444" />
            <Pill v="lop" label="LOP" color="#64748B" />
            <Pill v="wfh" label="Work from home" color="#8B5CF6" />
          </div>

          {kind === 'leave' && (
            <div className="space-y-3">
              <div>
                <div className="text-[12px] font-bold text-slate-600 mb-1">Duration</div>
                <div className="flex gap-2">
                  <button onClick={() => setDuration('full')} className={`flex-1 rounded-lg border px-3 py-2 text-sm font-bold ${duration === 'full' ? 'border-red-300 bg-red-50 text-red-600' : 'border-slate-200 text-slate-500'}`}>Full day</button>
                  <button onClick={() => setDuration('half')} className={`flex-1 rounded-lg border px-3 py-2 text-sm font-bold ${duration === 'half' ? 'border-amber-300 bg-amber-50 text-amber-600' : 'border-slate-200 text-slate-500'}`}>Half day</button>
                </div>
              </div>
              <div>
                <div className="text-[12px] font-bold text-slate-600 mb-1">Leave type</div>
                <select value={leaveType} onChange={(e) => setLeaveType(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  <option value="casual">Casual</option>
                  <option value="medical">Medical</option>
                  <option value="privilege">Privilege</option>
                </select>
              </div>
              {duration === 'half' && (
                <div className="flex items-center gap-2">
                  <input type="time" value={loginTime} onChange={(e) => setLoginTime(e.target.value)} className="flex-1 rounded-lg border border-slate-300 px-2 py-2 text-sm" title="Login" />
                  <span className="text-slate-300">–</span>
                  <input type="time" value={logoutTime} onChange={(e) => setLogoutTime(e.target.value)} className="flex-1 rounded-lg border border-slate-300 px-2 py-2 text-sm" title="Logout" />
                </div>
              )}
            </div>
          )}

          {kind === 'wfh' && (
            <div className="flex items-center gap-2">
              <input type="time" value={loginTime} onChange={(e) => setLoginTime(e.target.value)} className="flex-1 rounded-lg border border-slate-300 px-2 py-2 text-sm" title="Login" />
              <span className="text-slate-300">–</span>
              <input type="time" value={logoutTime} onChange={(e) => setLogoutTime(e.target.value)} className="flex-1 rounded-lg border border-slate-300 px-2 py-2 text-sm" title="Logout" />
            </div>
          )}

          {/* Approved by — searchable dropdown (leave + WFH). */}
          {needsApprover && (
            <div>
              <div className="text-[12px] font-bold text-slate-600 mb-1">Approved by</div>
              <div className="relative">
                <input value={approvedBy || search} onChange={(e) => { setSearch(e.target.value); setApprovedBy(''); setShowList(true); }} onFocus={() => setShowList(true)}
                  placeholder="Search senior / HR manager…" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                {showList && filtered.length > 0 && !approvedBy && (
                  <div className="absolute z-10 mt-1 w-full max-h-48 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                    {filtered.map((a) => (
                      <button key={a.id} onClick={() => { setApprovedBy(a.name); setSearch(''); setShowList(false); }} className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-50 last:border-0">
                        <div className="text-sm font-semibold text-[#050A1F]">{a.name}</div>
                        <div className="text-[11px] text-slate-400">{a.role}{a.designation ? ` · ${a.designation}` : ''}{a.branch ? ` · ${a.branch}` : ''}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {approvedBy && <div className="text-[11px] text-green-600 font-semibold mt-1">✓ {approvedBy} <button onClick={() => { setApprovedBy(''); setSearch(''); }} className="text-slate-400 ml-1">change</button></div>}
            </div>
          )}

          {kind && (
            <div>
              <div className="text-[12px] font-bold text-slate-600 mb-1">Notes {kind === 'lop' ? '' : '(optional)'}</div>
              <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Any note…" />
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-between gap-2">
          <button onClick={onClear} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-500">Clear</button>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
            <button onClick={save} className="rounded-lg px-5 py-2 text-sm font-bold text-white" style={{ background: ORANGE }}>Apply</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryBox({ label, value, sub, color, active, onClick }) {
  return (
    <button onClick={onClick} disabled={!onClick} className={`text-left bg-white rounded-xl border p-4 transition ${onClick ? 'hover:shadow-md cursor-pointer' : 'cursor-default'} ${active ? 'ring-2' : ''}`} style={{ borderTop: `3px solid ${color}`, ...(active ? { '--tw-ring-color': color, borderColor: color } : {}) }}>
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-2xl font-extrabold text-[#050A1F] mt-1">{value}</div>
      <div className="text-xs font-bold" style={{ color }}>{sub}</div>
    </button>
  );
}

// Per-type icon tile for a Review item, so each kind is differentiable at a
// glance. Returns a 34px rounded tile with a soft tint + line icon.
function ReviewIcon({ kind }) {
  const map = {
    late_check:     ['#FEF3C7', '#D97706', <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>],
    late_check_hr:  ['#EDE9FE', '#7C3AED', <><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" /></>],
    leave:          ['#FFEDD5', '#EA580C', <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>],
    expense_approval:['#DBEAFE', '#2563EB', <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>],
    interview_attendance:['#E0F2FE', '#0284C7', <><rect x="2" y="4" width="16" height="16" rx="2" /><path d="m22 8-4 4 4 4V8z" /></>],
    interview_feedback:['#E0E7FF', '#4F46E5', <><path d="M20 6 9 17l-5-5" /></>],
    onboarding_task:['#DCFCE7', '#15803D', <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M9 12l2 2 4-4" /></>],
    join_confirm:['#FEF3C7', '#B45309', <><path d="M20 6 9 17l-5-5" /><circle cx="12" cy="12" r="10" /></>],
  };
  const [bg, stroke, path] = map[kind] || ['#F1F5F9', '#64748b', <circle cx="12" cy="12" r="9" />];
  return (
    <div className="shrink-0 rounded-[9px] flex items-center justify-center" style={{ width: 34, height: 34, background: bg }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{path}</svg>
    </div>
  );
}

// Minimal dashboard for non-HR employees: a greeting, HR announcements, and any
// upcoming interviews where they sit on the panel. (HR/Admin see HrDashboard.)
// A review-tab card asking HR to confirm whether a candidate joined on their
// joining day. Joined → they'll be turned into an employee; Didn't join → moved
// to the Blacklist (a reason is required).
function JoinConfirmReview({ it, onConfirm, NAME, SUBT }) {
  const [mode, setMode] = useState(''); // '' | 'no'
  const [reason, setReason] = useState('');
  const fmt = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); } catch { return d; } };
  return (
    <div className="flex gap-2.5 py-3 border-t border-slate-100 mt-2">
      <ReviewIcon kind="join_confirm" />
      <div className="min-w-0 flex-1">
        <div className={NAME}>Did they join? <span className="text-slate-500">· {titleCase(it.candidateName || '')}</span></div>
        <div className={`${SUBT} mb-1.5`}>{it.role ? `${it.role} · ` : ''}Joining date was {fmt(it.joiningDate)}. Please confirm.</div>
        {mode !== 'no' ? (
          <div className="flex gap-2">
            <button onClick={() => onConfirm(it.candidateId, true)} className="text-[11px] font-bold rounded-lg px-3 py-1.5 text-white" style={{ background: '#16A34A' }}>✓ Joined</button>
            <button onClick={() => setMode('no')} className="text-[11px] font-bold rounded-lg px-3 py-1.5 border border-red-200 text-red-600 hover:bg-red-50">✗ Didn't join</button>
          </div>
        ) : (
          <div className="space-y-2">
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for not joining (required) — candidate will be blacklisted" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-[12px]" />
            <div className="flex gap-2">
              <button onClick={() => reason.trim() && onConfirm(it.candidateId, false, reason.trim())} disabled={!reason.trim()} className="text-[11px] font-bold rounded-lg px-3 py-1.5 text-white disabled:opacity-50" style={{ background: '#EF4444' }}>Confirm & blacklist</button>
              <button onClick={() => { setMode(''); setReason(''); }} className="text-[11px] text-slate-400">Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EmployeeDashboard({ user, onOpenCandidate, onNav }) {
  const [clock, setClock] = useState(null);
  const [myRec, setMyRec] = useState(null);      // the viewer's own recognition
  const [myRecOpen, setMyRecOpen] = useState(false);
  const [leave, setLeave] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [whos, setWhos] = useState(null);
  const [cel, setCel] = useState(null);
  const [celTab, setCelTab] = useState('birthdays');
  const [ann, setAnn] = useState([]);
  const [interviews, setInterviews] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [dailyQuote, setDailyQuote] = useState(null);
  const [now, setNow] = useState(new Date());
  const [busy, setBusy] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const [decideItem, setDecideItem] = useState(null); // leave review item open in the decision popup
  const [lateItem, setLateItem] = useState(null);     // senior late-check popup
  const [lateHrItem, setLateHrItem] = useState(null); // HR follow-up popup
  const [orgOpen, setOrgOpen] = useState(false);      // organization chart modal
  const [claims, setClaims] = useState([]);
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimHistOpen, setClaimHistOpen] = useState(false);

  const loadClock = () => hrApi('/me/clock').then(setClock).catch(() => {});
  const loadLeave = () => hrApi('/me/leave').then(setLeave).catch(() => {});
  const loadReviews = () => hrApi('/me/reviews').then((r) => setReviews(r.reviews || [])).catch(() => {});
  const loadClaims = () => hrApi('/me/claims').then((r) => setClaims(r.claims || [])).catch(() => {});
  const loadInterviews = () => hrApi('/my-interviews').then((r) => {
    const jobs = (r && r.jobs) || []; const flat = [];
    jobs.forEach((j) => (j.candidates || []).forEach((c) => flat.push({ ...c, jobTitle: j.jobTitle })));
    const t = Date.now(); flat.sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
    setInterviews(flat.filter((c) => c.at && new Date(c.at).getTime() >= t - 3600000));
  }).catch(() => {});
  useEffect(() => {
    loadClock(); loadLeave(); loadReviews(); loadInterviews();
    hrApi('/me/whos-in').then(setWhos).catch(() => {});
    hrApi('/me/celebrations').then(setCel).catch(() => {});
    hrApi('/announcements').then((r) => setAnn(Array.isArray(r) ? r : (r.announcements || []))).catch(() => {});
    hrApi('/holidays').then((r) => setHolidays(Array.isArray(r) ? r : (r.holidays || []))).catch(() => {});
    hrApi('/me/quote-of-the-day').then(setDailyQuote).catch(() => {});
    hrApi('/me/claims').then((r) => setClaims(r.claims || [])).catch(() => {});
    hrApi('/me/recognition').then(setMyRec).catch(() => {});
  }, []);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  const hour = new Date(Date.now() + 330 * 60000).getUTCHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = titleCase(String(user.name || '').split(' ')[0] || 'there');
  const pad = (n) => String(n).padStart(2, '0');
  const t12 = (hhmm) => { if (!hhmm) return ''; let [h, m] = hhmm.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${pad(h)}:${pad(m)} ${ap}`; };
  const clockAction = async (action) => { setBusy(true); try { await hrApi('/me/clock', { method: 'POST', body: JSON.stringify({ action }) }); await loadClock(); } catch (e) { alert(e.message); } finally { setBusy(false); } };

  const quote = dailyQuote ? dailyQuote.quote : 'The great thing in this world is not so much where you stand, as in what direction you are moving.';
  const quoteAuthor = dailyQuote ? dailyQuote.author : 'Oliver Wendell Holmes';
  const st = clock ? clock.state : 'out';
  const breakMin = clock ? (clock.breakMin || 0) : 0;

  // upcoming holidays (branch-aware, sorted, future)
  const todayStr = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const upcoming = (holidays || []).filter((h) => String(h.date) >= todayStr && (!h.branch || h.branch === user.branch)).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const nextHol = upcoming[0];
  const fmtHol = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); } catch { return d; } };
  const fmtShort = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); } catch { return d; } };
  const fmtDT = (iso) => { try { return new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return iso; } };
  const fmtDay = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return d; } };
  const weekday = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long' }); } catch { return ''; } };

  const decide = async (id, approve, note) => { try { await hrApi(`/me/leave/${id}/decide`, { method: 'POST', body: JSON.stringify({ approve, note: note || '' }) }); setDecideItem(null); loadReviews(); loadLeave(); } catch (e) { alert(e.message); } };
  const markAttendance = async (candidateId, interviewId, attended) => { try { await hrApi(`/me/interview/${candidateId}/${interviewId}/attendance`, { method: 'POST', body: JSON.stringify({ attended }) }); loadReviews(); } catch (e) { alert(e.message); } };
  const decideExpense = async (expenseId, decision) => { try { await hrApi(`/expenses/${expenseId}/decide`, { method: 'POST', body: JSON.stringify({ decision, reason: '' }) }); loadReviews(); } catch (e) { alert(e.message); } };
  const markOnbTaskDone = async (taskId) => { try { await hrApi(`/onboarding-task/${taskId}/done`, { method: 'POST', body: '{}' }); loadReviews(); } catch (e) { alert(e.message); } };
  const confirmJoin = async (candidateId, joined, reason) => { try { await hrApi(`/candidates/${candidateId}/join-confirm`, { method: 'POST', body: JSON.stringify({ joined, reason: reason || '' }) }); loadReviews(); } catch (e) { alert(e.message); } };
  const saveLateCheck = async (date, updates) => { try { await hrApi(`/me/late-check/${date}`, { method: 'POST', body: JSON.stringify({ updates }) }); setLateItem(null); loadReviews(); } catch (e) { alert(e.message); } };
  const saveLateCheckHr = async (date, updates) => { try { await hrApi(`/late-check/${date}/hr`, { method: 'POST', body: JSON.stringify({ updates }) }); setLateHrItem(null); loadReviews(); } catch (e) { alert(e.message); } };

  const ORNG = 'linear-gradient(90deg,#FF6A00,#FF4500)';
  // Uniform typography for the dashboard cards: a prominent box title, a black
  // light-weight item name, and muted sub-detail.
  const CARD = 'bg-white rounded-2xl border border-slate-200 p-5';
  const TITLE = 'text-[15px] font-extrabold text-[#050A1F] mb-4 flex items-center gap-2.5 tracking-tight';
  const DOT = 'w-3.5 h-3.5 rounded-[5px] inline-block shrink-0';
  const NAME = 'text-[13.5px] font-medium text-[#0A0E28]';   // item / person name
  const SUBT = 'text-[11px] text-slate-400';                  // sub-detail
  const TSUB = 'font-medium normal-case tracking-normal text-[11px] text-slate-400'; // inline title suffix
  const ringColor = { casual: '#22C55E', medical: '#0EA5E9', privilege: '#F59E0B', wfh: '#8B5CF6' };
  const celRows = cel ? (celTab === 'birthdays' ? cel.birthdays : celTab === 'anniversaries' ? cel.anniversaries : cel.joinees) : [];
  const initials = (n) => String(n || '').split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="max-w-6xl mx-auto">
      {/* greeting hero */}
      <div className="rounded-2xl p-8 mb-4 relative overflow-hidden" style={{ background: 'linear-gradient(120deg,#050A1F,#0A0E28 60%,#111a3f)' }}>
        <div className="absolute rounded-full" style={{ width: 120, height: 120, background: ORNG, opacity: .85, right: 40, top: -44, filter: 'blur(1px)' }} />
        <div className="relative">
          <h1 className="text-3xl font-extrabold text-white mb-3">{greeting}, {firstName}!</h1>
          <div className="flex items-end justify-between gap-4">
            <p className="text-slate-300 max-w-2xl text-sm leading-relaxed">{quote}<span className="block mt-1.5 text-slate-400 font-bold">— {quoteAuthor}</span></p>
            <button onClick={() => setOrgOpen(true)} className="shrink-0 flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/15 px-3 py-2 text-xs font-bold text-white transition-colors">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="8.5" y="14" width="7" height="7" rx="1" /><path d="M6.5 10v2.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10 M12 13.5V14" /></svg>
              Organization chart
            </button>
          </div>
        </div>
      </div>

      {/* ANNOUNCEMENTS — directly under the greeting, only when present */}
      {ann.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-4">
          <h3 className={TITLE}><span className={DOT} style={{ background: ORNG }} />Announcements</h3>
          <div className="grid md:grid-cols-2 gap-x-6 gap-y-3.5">
            {ann.slice(0, 4).map((a, i) => (
              <div key={a.id || i} className="border-l-[3px] pl-3" style={{ borderColor: '#FF6A00' }}>
                <div className={NAME}>{a.title || 'Announcement'}</div>
                {a.body && <div className="text-[12px] text-slate-500 mt-0.5 leading-relaxed line-clamp-2">{String(a.body).replace(/<[^>]+>/g, ' ').trim()}</div>}
                <div className="text-[11px] text-slate-400 mt-1">{a.authorName ? `${a.authorName} · ` : ''}{a.createdAt ? fmtDT(a.createdAt) : ''}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-4 items-start">
        {/* LEFT — Web login + Leave balance */}
        <div className="flex flex-col gap-4">
          {/* WEB LOGIN */}
          <div className="rounded-2xl p-5 text-white" style={{ background: ORNG }}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold uppercase tracking-wide">Web login</span>
              <button onClick={() => setCalOpen(true)} className="text-xs font-extrabold rounded-lg px-2.5 py-1" style={{ background: 'rgba(255,255,255,.18)' }}>View all ›</button>
            </div>
            <div className="text-4xl font-extrabold tracking-wide mt-2" style={{ fontVariantNumeric: 'tabular-nums' }}>{pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}</div>
            <div className="text-xs mt-1" style={{ color: '#ffe4d3' }}>{now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}</div>
            {st === 'leave' ? (
              <div className="mt-4 rounded-xl py-3 text-center font-extrabold" style={{ background: 'rgba(255,255,255,.15)' }}>On approved leave today</div>
            ) : st === 'out' ? (
              <>
                <div className="mt-4"><button disabled={busy} onClick={() => clockAction('in')} className="w-full rounded-xl py-2.5 font-extrabold text-sm bg-white disabled:opacity-60" style={{ color: '#FF4500' }}>Web Clock-In</button></div>
                <div className="mt-3.5 pt-3 text-xs border-t" style={{ borderColor: 'rgba(255,255,255,.22)' }}>You haven’t clocked in yet today.</div>
              </>
            ) : st === 'in' ? (
              <>
                <div className="mt-4 flex gap-2.5">
                  <button disabled={busy} onClick={() => clockAction('break')} className="flex-1 rounded-xl py-2.5 font-extrabold text-sm text-white disabled:opacity-60" style={{ background: 'rgba(255,255,255,.18)' }}>Take Break</button>
                  <button disabled={busy} onClick={() => clockAction('out')} className="flex-1 rounded-xl py-2.5 font-extrabold text-sm text-white disabled:opacity-60" style={{ background: '#050A1F' }}>Logout</button>
                </div>
                <div className="mt-3.5 pt-3 text-xs border-t" style={{ borderColor: 'rgba(255,255,255,.22)' }}>In at <b>{t12(clock.loginTime)}</b>{breakMin ? <> · Break <b>{Math.floor(breakMin / 60)}h {pad(breakMin % 60)}m</b></> : null}</div>
              </>
            ) : st === 'break' ? (
              <>
                <div className="mt-4 flex gap-2.5">
                  <button disabled={busy} onClick={() => clockAction('break_end')} className="flex-1 rounded-xl py-2.5 font-extrabold text-sm bg-white disabled:opacity-60" style={{ color: '#FF4500' }}>Finish Break</button>
                  <button disabled={busy} onClick={() => clockAction('out')} className="flex-1 rounded-xl py-2.5 font-extrabold text-sm text-white disabled:opacity-60" style={{ background: '#050A1F' }}>Logout</button>
                </div>
                <div className="mt-3.5 pt-3 text-xs border-t" style={{ borderColor: 'rgba(255,255,255,.22)' }}>On break since <b>{t12(clock.breakOpen)}</b> · In at <b>{t12(clock.loginTime)}</b></div>
              </>
            ) : (
              <>
                <div className="mt-4"><button onClick={() => setCalOpen(true)} className="w-full rounded-xl py-2.5 font-extrabold text-sm text-white" style={{ background: 'rgba(255,255,255,.18)' }}>View attendance</button></div>
                <div className="mt-3.5 pt-3 text-xs border-t" style={{ borderColor: 'rgba(255,255,255,.22)' }}>In <b>{t12(clock.loginTime)}</b> · Out <b>{t12(clock.logoutTime)}</b>{breakMin ? <> · Break <b>{Math.floor(breakMin / 60)}h {pad(breakMin % 60)}m</b></> : null}</div>
              </>
            )}
          </div>

          {/* MY BADGES & RECOGNITION — the viewer's own recognition. */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[13px] font-extrabold text-[#050A1F] flex items-center gap-1.5">🏅 My Badges &amp; Recognition</h3>
              <button onClick={() => setMyRecOpen(true)} className="text-[11px] font-extrabold rounded-lg px-2.5 py-1" style={{ background: '#FFF1E6', color: '#EA580C' }}>View all ›</button>
            </div>
            {(!myRec || (myRec.badges || []).length === 0) ? (
              <div className="text-[12px] text-slate-400 py-2">No badges yet — keep up the great work! 🌟</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {(myRec.badges || []).slice(0, 8).map((b, i) => (
                  <div key={i} className="text-center" style={{ width: 52 }} title={`${b.name}${b.by ? ` · ${b.by}` : ''}`}>
                    <div className="w-11 h-11 mx-auto rounded-xl border flex items-center justify-center text-xl" style={{ background: (b.color || '#EA580C') + '14', borderColor: (b.color || '#EA580C') + '44' }}>{b.icon}</div>
                    <div className="text-[8px] font-bold text-slate-500 mt-1 leading-tight truncate">{b.name}</div>
                  </div>
                ))}
                {(myRec.badges || []).length > 8 && <div className="self-center text-[11px] text-slate-400">+{(myRec.badges || []).length - 8}</div>}
              </div>
            )}
          </div>

          {/* LEAVE BALANCE */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 className={TITLE}><span className={DOT} style={{ background: '#22C55E' }} />Leave balance</h3>
            <div className="flex gap-3.5 flex-wrap">
              {['casual', 'medical', 'privilege'].map((k) => {
                const bal = leave ? (leave.balance[k] ?? 0) : 0; const alloc = leave ? (leave.allocation[k] ?? 0) : 0;
                return (
                  <div key={k} className="text-center" style={{ width: 74 }}>
                    <div className="rounded-full flex flex-col items-center justify-center mx-auto mb-1.5" style={{ width: 64, height: 64, border: `6px solid ${ringColor[k]}` }}>
                      <span className="text-[17px] font-extrabold text-[#050A1F] leading-none">{bal}</span><span className="text-[9px] text-slate-400 font-semibold mt-0.5">of {alloc}</span>
                    </div>
                    <div className="text-[11px] font-semibold text-slate-500 capitalize">{k}</div>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2.5 mt-4">
              <button onClick={() => setApplyOpen(true)} className="rounded-xl px-4 py-2.5 text-[13px] font-extrabold text-white" style={{ background: ORNG }}>+ Apply Leave</button>
              <button onClick={() => setHistOpen(true)} className="rounded-xl px-4 py-2.5 text-[13px] font-extrabold text-slate-700 bg-slate-100">Leave History</button>
            </div>
          </div>

          {/* EXPENSE CLAIMS */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 className={TITLE}><span className={DOT} style={{ background: '#0EA5E9' }} />Expense claims</h3>
            {claims.length === 0 ? (
              <div className="text-sm text-slate-400">No claims yet. Raise one to get a work expense reimbursed.</div>
            ) : (
              <div className="flex gap-3.5 flex-wrap">
                {(() => {
                  const inProgress = claims.filter((c) => ['submitted', 'hr_approved', 'approved', 'queued_for_payroll'].includes(c.status)).length;
                  const paid = claims.filter((c) => c.status === 'paid').length;
                  const stat = [['In progress', inProgress, '#0EA5E9'], ['Paid', paid, '#22C55E'], ['Total', claims.length, '#8B5CF6']];
                  return stat.map(([label, n, color]) => (
                    <div key={label} className="text-center" style={{ width: 74 }}>
                      <div className="rounded-full flex flex-col items-center justify-center mx-auto mb-1.5" style={{ width: 64, height: 64, border: `6px solid ${color}` }}>
                        <span className="text-[17px] font-extrabold text-[#050A1F] leading-none">{n}</span>
                      </div>
                      <div className="text-[11px] font-semibold text-slate-500">{label}</div>
                    </div>
                  ));
                })()}
              </div>
            )}
            <div className="flex gap-2.5 mt-4">
              <button onClick={() => setClaimOpen(true)} className="rounded-xl px-4 py-2.5 text-[13px] font-extrabold text-white" style={{ background: ORNG }}>+ New Claim</button>
              <button onClick={() => setClaimHistOpen(true)} className="rounded-xl px-4 py-2.5 text-[13px] font-extrabold text-slate-700 bg-slate-100">Claim History</button>
            </div>
          </div>

          {/* CELEBRATIONS */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 className={TITLE}><span className={DOT} style={{ background: '#8B5CF6' }} />Celebrations <span className={TSUB}>· company-wide</span></h3>
            <div className="flex gap-1.5 mb-3">
              {[['birthdays', 'Birthdays'], ['anniversaries', 'Anniversaries'], ['joinees', 'New joinees']].map(([k, lbl]) => (
                <button key={k} onClick={() => setCelTab(k)} className={`text-[11px] font-extrabold px-2.5 py-1.5 rounded-lg ${celTab === k ? 'text-white' : 'text-slate-500 bg-slate-100'}`} style={celTab === k ? { background: '#050A1F' } : {}}>{lbl}</button>
              ))}
            </div>
            {celRows.length === 0 ? <div className="text-sm text-slate-400 py-1">Nothing coming up.</div> : celRows.slice(0, 6).map((r, i) => (
              <div key={i} className="flex items-center gap-2.5 py-2 border-t border-slate-50">
                <div className="w-8 h-8 rounded-full text-xs font-bold flex items-center justify-center" style={{ background: '#ede9fe', color: '#6d28d9' }}>{initials(r.name)}</div>
                <div><div className={NAME}>{r.name}</div><div className="text-[11px] text-slate-400">{r.sub}</div></div>
                <span className="ml-auto text-[11px] font-bold" style={{ color: '#FF4500' }}>{r.when}</span>
              </div>
            ))}
          </div>
        </div>

        {/* MIDDLE — Review + Interviews */}
        <div className="flex flex-col gap-4">
          {/* REVIEW */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 className={TITLE}><span className={DOT} style={{ background: ORNG }} />Review</h3>
            {reviews.length === 0 ? <div className="text-sm text-slate-400 py-2">Nothing to review right now. You’re all caught up.</div> : (
              <>
                <div className="flex items-end gap-2.5"><div className="text-4xl font-extrabold leading-none" style={{ color: '#FF4500' }}>{reviews.length}</div><span className="rounded-full text-[11px] font-bold px-2.5 py-0.5" style={{ background: '#FEF2F2', color: '#DC2626' }}>Things to review</span></div>
                <div className="max-h-80 overflow-y-auto -mr-1 pr-1">
                {reviews.map((it) => {
                  if (it.kind === 'leave') return (
                    <div key={it.groupKey || it.id} className="flex gap-2.5 py-3 border-t border-slate-100 mt-2">
                      <ReviewIcon kind="leave" />
                      <div className="min-w-0 flex-1">
                        <div className={NAME}>Leave <span className="text-slate-500">· {titleCase(it.who)}</span></div>
                        <div className={`${SUBT} mb-1.5 capitalize`}>{it.type}{it.duration === 'half' ? ' · half day' : it.days > 1 ? ` · ${it.days} days` : ' · full day'}</div>
                        <button onClick={() => setDecideItem(it)} className="text-[11px] font-bold rounded-lg px-3 py-1.5 text-white" style={{ background: ORNG }}>Take Decision</button>
                      </div>
                    </div>
                  );
                  if (it.kind === 'interview_attendance') return (
                    <div key={it.id} className="flex gap-2.5 py-3 border-t border-slate-100 mt-2">
                      <ReviewIcon kind="interview_attendance" />
                      <div className="min-w-0 flex-1">
                        <div className={NAME}>Interview <span className="text-slate-500">· did {titleCase(it.who)} attend?</span></div>
                        <div className={`${SUBT} mb-1.5`}>{it.roundLabel ? `${it.roundLabel} · ` : ''}{fmtDT(it.at)}</div>
                        <div className="flex gap-1.5">
                          <button onClick={() => markAttendance(it.candidateId, it.interviewId, true)} className="text-[11px] font-bold rounded-md px-2.5 py-1" style={{ background: '#DCFCE7', color: '#15803D' }}>Attended</button>
                          <button onClick={() => markAttendance(it.candidateId, it.interviewId, false)} className="text-[11px] font-bold rounded-md px-2.5 py-1" style={{ background: '#FEE2E2', color: '#B91C1C' }}>No-show</button>
                        </div>
                      </div>
                    </div>
                  );
                  if (it.kind === 'expense_approval') return (
                    <div key={it.id} className="flex gap-2.5 py-3 border-t border-slate-100 mt-2">
                      <ReviewIcon kind="expense_approval" />
                      <div className="min-w-0 flex-1">
                        <div className={NAME}>Expense <span className="text-slate-500">· {titleCase(it.who)}</span></div>
                        <div className={`${SUBT} mb-1.5`}>₹{Number(it.amount).toLocaleString('en-IN')}{it.category ? ` · ${it.category}` : ''}{it.branch ? ` · ${it.branch}` : ''} → {it.payeeName}{it.invoiceUrl ? <> · <a href={it.invoiceUrl} target="_blank" rel="noreferrer" className="text-sky-600 font-semibold">invoice</a></> : ''}</div>
                        <div className="flex gap-1.5">
                          <button onClick={() => decideExpense(it.expenseId, 'approve')} className="text-[11px] font-bold rounded-md px-2.5 py-1" style={{ background: '#DCFCE7', color: '#15803D' }}>Approve</button>
                          <button onClick={() => decideExpense(it.expenseId, 'reject')} className="text-[11px] font-bold rounded-md px-2.5 py-1" style={{ background: '#FEE2E2', color: '#B91C1C' }}>Reject</button>
                        </div>
                      </div>
                    </div>
                  );
                  if (it.kind === 'late_check') return (
                    <div key={it.id} className="flex gap-2.5 py-3 border-t border-slate-100 mt-2">
                      <ReviewIcon kind="late_check" />
                      <div className="min-w-0 flex-1">
                        <div className={NAME}>Attendance check</div>
                        <div className={`${SUBT} mb-1.5`}>{it.count} team member{it.count === 1 ? '' : 's'} not logged in · past shift grace</div>
                        <button onClick={() => setLateItem(it)} className="text-[11px] font-bold rounded-lg px-3 py-1.5 text-white" style={{ background: '#F59E0B' }}>Review attendance ›</button>
                      </div>
                    </div>
                  );
                  if (it.kind === 'late_check_hr') return (
                    <div key={it.id} className="flex gap-2.5 py-3 border-t border-slate-100 mt-2">
                      <ReviewIcon kind="late_check_hr" />
                      <div className="min-w-0 flex-1">
                        <div className={NAME}>Late follow-up</div>
                        <div className={`${SUBT} mb-1.5`}>{it.count} update{it.count === 1 ? '' : 's'} from team leads · call the “not picking” ones</div>
                        <button onClick={() => setLateHrItem(it)} className="text-[11px] font-bold rounded-lg px-3 py-1.5 text-white" style={{ background: '#4338CA' }}>Review & update ›</button>
                      </div>
                    </div>
                  );
                  if (it.kind === 'join_confirm') return <JoinConfirmReview key={it.id} it={it} onConfirm={confirmJoin} NAME={NAME} SUBT={SUBT} />;
                  if (it.kind === 'onboarding_task') return (
                    <div key={it.id} className="flex gap-2.5 py-3 border-t border-slate-100 mt-2">
                      <ReviewIcon kind="onboarding_task" />
                      <div className="min-w-0 flex-1">
                        <div className={NAME}>New joiner setup <span className="text-slate-500">· {titleCase(it.candidateName || '')}</span></div>
                        <div className={`${SUBT} mb-1.5`}>{it.title}{it.sub ? ` · ${it.sub}` : ''}</div>
                        <button onClick={() => markOnbTaskDone(it.taskId)} className="text-[11px] font-bold rounded-lg px-3 py-1.5 text-white" style={{ background: '#16A34A' }}>Mark done ✓</button>
                      </div>
                    </div>
                  );
                  // interview_feedback
                  return (
                    <div key={it.id} className="flex gap-2.5 py-3 border-t border-slate-100 mt-2">
                      <ReviewIcon kind="interview_feedback" />
                      <div className="min-w-0 flex-1">
                        <div className={NAME}>Feedback <span className="text-slate-500">· {titleCase(it.who)}</span></div>
                        <div className={`${SUBT} mb-1.5`}>{it.roundLabel ? `${it.roundLabel} · ` : ''}awaiting your feedback</div>
                        <button onClick={() => onOpenCandidate && onOpenCandidate(it.candidateId, 'feedback')} className="text-[11px] font-bold rounded-lg px-3 py-1.5" style={{ background: '#dbeafe', color: '#1d4ed8' }}>Submit feedback ›</button>
                      </div>
                    </div>
                  );
                })}
                </div>
              </>
            )}
          </div>

          {/* INTERVIEWS */}
          {interviews.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h3 className={TITLE}><span className={DOT} style={{ background: '#050A1F' }} />Your upcoming interviews</h3>
              <div className="flex flex-col gap-2.5">
                {interviews.slice(0, 5).map((iv, i) => (
                  <div key={i} className="border border-slate-100 rounded-xl px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <button onClick={() => onOpenCandidate && onOpenCandidate(iv.candidateId)} className={`${NAME} hover:text-[#FF4500] text-left`}>{titleCase(iv.name)}</button>
                      {iv.roundLabel ? <span className="text-[10px] font-bold rounded px-1.5 py-0.5" style={{ background: '#dbeafe', color: '#1d4ed8' }}>{iv.roundLabel}</span> : null}
                    </div>
                    <div className="text-[11px] text-slate-400">{iv.jobTitle}</div>
                    <div className="text-[12px] font-semibold text-slate-600 mt-0.5">{fmtDT(iv.at)}{iv.mode ? ` · ${iv.mode}` : ''}</div>
                    <div className="flex items-center gap-3 mt-2">
                      {iv.meetLink && <a href={iv.meetLink} target="_blank" rel="noreferrer" className="text-[11px] font-bold rounded-lg px-3 py-1.5 text-white" style={{ background: '#0F9D58' }}>Join interview</a>}
                      <button onClick={() => onOpenCandidate && onOpenCandidate(iv.candidateId)} className="text-[11px] font-bold" style={{ color: '#1d4ed8' }}>View candidate ›</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT — Who's in + Holidays */}
        <div className="flex flex-col gap-4">
          {/* WHO IS IN */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 className={TITLE}><span className={DOT} style={{ background: '#0EA5E9' }} />Who is in <span className={TSUB}>· today</span></h3>
            <div className="flex gap-2 mb-3">
              {[['not_in', 'Not in', '#EF4444'], ['late', 'Late', '#F59E0B'], ['in', 'On time', '#16A34A'], ['leave', 'Leave', '#64748b']].map(([k, lbl, c]) => (
                <div key={k} className="flex-1 text-center rounded-lg py-2 border border-slate-100"><span className="block text-lg font-extrabold" style={{ color: c }}>{whos ? (whos.counts[k] || 0) : 0}</span><span className="text-[11px] font-semibold text-slate-500">{lbl}</span></div>
              ))}
            </div>
            {whos && whos.people.length === 0 && <div className="text-sm text-slate-400 py-2">No team members to show.</div>}
            <div className="max-h-72 overflow-y-auto -mr-1 pr-1">
              {(() => {
                const ppl = (whos && whos.people) || [];
                const hasGroups = ppl.some((p) => p.group === 'others') && ppl.some((p) => p.group === 'team');
                let lastGroup = null;
                return ppl.map((p) => {
                  const showHeader = hasGroups && p.group !== lastGroup;
                  lastGroup = p.group;
                  return (
                    <div key={p.id}>
                      {showHeader && <div className="text-[10px] font-extrabold uppercase tracking-wide text-slate-400 mt-2 mb-1 pt-1">{p.group === 'team' ? 'Your team' : 'All employees'}</div>}
                      <div className="flex items-center gap-2.5 py-1.5 border-t border-slate-50">
                        <div className="w-8 h-8 rounded-full bg-[#e2e9f8] text-slate-700 text-xs font-bold flex items-center justify-center">{initials(p.name)}</div>
                        <div className="min-w-0"><div className={`${NAME} truncate`}>{titleCase(p.name)}</div><div className="text-[11px] text-slate-400 truncate">{p.department}{p.reportsToMe ? ' · reports to you' : ''}</div></div>
                        <span className="ml-auto shrink-0 text-[10px] font-extrabold rounded px-1.5 py-0.5" style={p.status === 'late' ? { background: '#FEF3C7', color: '#B45309' } : p.status === 'leave' ? { background: '#EDE9FE', color: '#6D28D9' } : p.status === 'in' ? { background: '#DCFCE7', color: '#15803D' } : { background: '#F1F5F9', color: '#64748b' }}>
                          {p.status === 'late' ? `LATE ${t12(p.at)}` : p.status === 'leave' ? 'LEAVE' : p.status === 'in' ? `IN ${t12(p.at)}` : 'NOT IN'}
                        </span>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>

          {/* HOLIDAYS */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 className={TITLE}><span className={DOT} style={{ background: '#F59E0B' }} />Upcoming holidays</h3>
            {!nextHol ? <div className="text-sm text-slate-400">No upcoming holidays.</div> : (
              <>
                <div className="flex items-center gap-3 rounded-xl p-3 mb-1.5" style={{ background: '#FFF7ED', border: '1px solid #FFEDD5' }}>
                  <span className="text-3xl leading-none">{nextHol.emoji || '📅'}</span>
                  <div>
                    <div className="text-[15px] font-semibold text-[#0A0E28] leading-tight">{nextHol.name}</div>
                    <div className="font-bold text-[13px]" style={{ color: '#FF4500' }}>{fmtHol(nextHol.date)}</div>
                  </div>
                </div>
                <div>{upcoming.slice(1, 5).map((h, i) => (
                  <div key={i} className="flex items-center gap-2.5 py-2 border-t border-slate-100 text-[13px]">
                    <span className="text-lg leading-none">{h.emoji || '📅'}</span>
                    <span className="flex-1 text-[#0A0E28]">{h.name}</span>
                    <span className="text-slate-400 font-semibold">{fmtShort(h.date)}</span>
                  </div>
                ))}</div>
              </>
            )}
          </div>
        </div>
      </div>

      {applyOpen && <ApplyLeaveModal approverName={leave ? leave.approverName : ''} approverChain={leave ? leave.approverChain : []} onClose={() => setApplyOpen(false)} onDone={() => { setApplyOpen(false); loadLeave(); }} />}
      {histOpen && <LeaveHistoryModal leaves={leave ? leave.leaves : []} onClose={() => setHistOpen(false)} />}
      {calOpen && <MyAttendanceCalendar onClose={() => setCalOpen(false)} />}
      {decideItem && <LeaveDecisionModal item={decideItem} onClose={() => setDecideItem(null)} onDecide={(approve, note) => decide(decideItem.id, approve, note)} />}
      {lateItem && <LateCheckModal item={lateItem} onClose={() => setLateItem(null)} onSave={(updates) => saveLateCheck(lateItem.date, updates)} />}
      {lateHrItem && <LateCheckHrModal item={lateHrItem} onClose={() => setLateHrItem(null)} onSave={(updates) => saveLateCheckHr(lateHrItem.date, updates)} />}
      {orgOpen && <EmployeeOrgChartModal onClose={() => setOrgOpen(false)} />}
      {myRecOpen && <MyRecognitionModal data={myRec} onClose={() => setMyRecOpen(false)} />}
      {claimOpen && <EmployeeClaimModal onClose={() => setClaimOpen(false)} onSaved={() => { setClaimOpen(false); loadClaims(); }} />}
      {claimHistOpen && <ClaimHistoryModal claims={claims} onClose={() => setClaimHistOpen(false)} onNew={() => { setClaimHistOpen(false); setClaimOpen(true); }} />}
    </div>
  );
}

// Minimal dashboard for non-HR employees end.

// Leave decision popup — opened from the Review box. Shows the employee, the
// leave breakdown (half/full/multi with per-day weekday), the last leave they
// took, a notes box, and Approve / Decline.
// ===== Employee expense claims =============================================
const CLAIM_PAY_TYPES = [['ta', 'TA (Travel Allowance)'], ['da', 'DA (Daily Allowance)'], ['other', 'Other expenses'], ['advance', 'Advance']];
function claimStatusLabel(s) {
  return ({ submitted: 'Awaiting HR review', hr_approved: 'Awaiting admin approval', approved: 'Approved · awaiting settlement', queued_for_payroll: 'Added to next salary', paid: 'Paid', rejected: 'Rejected' })[s] || s;
}
function claimStatusShort(s) {
  return ({ submitted: 'HR REVIEW', hr_approved: 'ADMIN', approved: 'APPROVED', queued_for_payroll: 'IN SALARY', paid: 'PAID', rejected: 'REJECTED' })[s] || String(s).toUpperCase();
}
function claimStatusStyle(s) {
  const m = { submitted: ['#FEF3C7', '#B45309'], hr_approved: ['#E0E7FF', '#4338CA'], approved: ['#DBEAFE', '#1D4ED8'], queued_for_payroll: ['#EDE9FE', '#6D28D9'], paid: ['#DCFCE7', '#15803D'], rejected: ['#FEE2E2', '#B91C1C'] }[s] || ['#F1F5F9', '#475569'];
  return { background: m[0], color: m[1] };
}

// Employee raises a reimbursement claim (uploads invoice, AI auto-fills, HR then
// reviews and admin approves). Reuses the invoice upload + AI parse we built.
function EmployeeClaimModal({ onClose, onSaved }) {
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const [f, setF] = useState({ title: '', employeePayType: '', expenseDate: today, description: '' });
  // Uploaded invoice files [{ url, name }]. Line items [{ particular, amount, date }].
  const [attachments, setAttachments] = useState([]);
  const [rows, setRows] = useState([]); // editable table
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const readAsDataURL = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('Could not read file.')); r.readAsDataURL(file); });

  // Handle one or more files: upload each, run AI, and add a row per particular
  // (or a single row if the invoice has one item).
  const pickFiles = async (e) => {
    const files = Array.from(e.target.files || []); if (!files.length) return;
    e.target.value = ''; // allow re-selecting the same file
    setReading(true); setErr(''); setNote('');
    let added = 0, filesDone = 0;
    for (const file of files) {
      let dataUrl = ''; try { dataUrl = await readAsDataURL(file); } catch {}
      // Upload for attachment.
      let url = '', name = file.name;
      try { const safe = (f.title || 'claim').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24); const up = await uploadToImageKit(file, `/qtonix-hr/claims/${safe}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, file.name); url = up.url; }
      catch (er) { setErr(`Upload failed for ${file.name}. ${er.message || ''}`); continue; }
      let fileDate = '';
      // AI extract.
      if (dataUrl) {
        try {
          const r = await hrApi('/expenses/parse-invoice', { method: 'POST', body: JSON.stringify({ base64: dataUrl, fileName: file.name }) });
          if (r && r.ok && r.fields) {
            const fld = r.fields;
            fileDate = /^\d{4}-\d{2}-\d{2}$/.test(fld.invoiceDate || '') ? fld.invoiceDate : '';
            const items = Array.isArray(fld.lineItems) ? fld.lineItems.filter((li) => li && (li.particular || Number(li.amount) > 0)) : [];
            if (items.length >= 1) {
              items.forEach((li) => { setRows((arr) => [...arr, { particular: li.particular || '', amount: li.amount ? String(li.amount) : '', date: fileDate || today, file: name }]); added++; });
            } else {
              // Single amount, no itemization → one row from the invoice total.
              setRows((arr) => [...arr, { particular: fld.description || fld.vendorName || file.name, amount: fld.amount ? String(fld.amount) : '', date: fileDate || today, file: name }]); added++;
            }
            if (!f.title && (fld.description || fld.vendorName)) set('title', fld.description || fld.vendorName);
          } else {
            setRows((arr) => [...arr, { particular: file.name, amount: '', date: today, file: name }]); added++;
          }
        } catch { setRows((arr) => [...arr, { particular: file.name, amount: '', date: today, file: name }]); added++; }
      }
      setAttachments((arr) => [...arr, { url, name, date: fileDate }]);
      filesDone++;
    }
    setReading(false);
    setNote(`Read ${filesDone} file${filesDone === 1 ? '' : 's'} → ${added} item${added === 1 ? '' : 's'}. Review below.`);
  };

  const save = async () => {
    if (!f.title.trim()) { setErr('What is this claim for?'); return; }
    if (!f.employeePayType) { setErr('Choose the claim type.'); return; }
    if (f.employeePayType === 'other' && !f.description.trim()) { setErr('Please add details for an "Other expenses" claim.'); return; }
    const cleanItems = rows.map((r) => ({ particular: r.particular.trim(), amount: Number(r.amount) || 0, date: r.date })).filter((r) => r.particular || r.amount > 0);
    if (!(cleanItems.reduce((s, r) => s + r.amount, 0) > 0)) { setErr('Add at least one item with a cost (upload an invoice or enter manually).'); return; }
    setBusy(true); setErr('');
    try {
      await hrApi('/me/claims', { method: 'POST', body: JSON.stringify({
        title: f.title, employeePayType: f.employeePayType, expenseDate: f.expenseDate, description: f.description,
        lineItems: cleanItems, attachments,
      }) });
      onSaved();
    } catch (er) { setErr(er.message); } finally { setBusy(false); }
  };
  const inpCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300';
  return (
    <div className="fixed inset-0 bg-black/50 z-[140] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-xl p-6 max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><div className="text-lg font-extrabold text-[#050A1F]">New expense claim</div><button onClick={onClose} className="text-slate-400 text-2xl leading-none">×</button></div>
        {err && <div className="rounded-lg bg-red-50 border border-red-200 text-red-600 text-xs px-3 py-2 mb-3">{err}</div>}

        <div className="rounded-xl border-2 border-dashed border-indigo-200 bg-indigo-50/40 p-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-500 text-white flex items-center justify-center text-lg shrink-0">✨</div>
            <div className="flex-1 min-w-0"><div className="text-sm font-bold text-[#050A1F]">Upload invoices to auto-fill</div><div className="text-[11px] text-slate-500">Add one or more bills — we read the date, item and amount from each into the table below.</div></div>
            <label className={`inline-block rounded-lg px-3 py-2 text-xs font-bold cursor-pointer text-white shrink-0 ${reading ? 'opacity-60 pointer-events-none' : ''}`} style={{ background: 'linear-gradient(90deg,#6366F1,#4338CA)' }}>
              {reading ? 'Reading…' : 'Upload files'}
              <input type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={pickFiles} disabled={reading} />
            </label>
          </div>
          {(attachments.length > 0 || note) && <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">{attachments.map((a, i) => <span key={i} className="text-green-600 font-bold">✓ {a.name}</span>)}{note && <span className="text-indigo-600 font-semibold">{note}</span>}</div>}
        </div>

        {/* Itemized table (auto-summed) */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1.5"><label className="text-xs font-bold text-slate-500">Items claimed</label><span className="text-[11px] text-slate-400">Total auto-adds below</span></div>
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400 font-bold"><th className="text-left px-2 py-2">Date</th><th className="text-left px-2 py-2">Particular</th><th className="text-right px-2 py-2 w-24">Amount</th><th className="w-7" /></tr></thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-4 text-center text-[12px] text-slate-400">Upload an invoice above, or add a row manually.</td></tr>
                ) : rows.map((r, idx) => (
                  <tr key={idx} className="border-t border-slate-100">
                    <td className="px-1 py-1"><input type="date" value={r.date || ''} onChange={(e) => setRows((a) => a.map((x, i) => i === idx ? { ...x, date: e.target.value } : x))} className="w-full border-0 focus:ring-0 text-[12px] px-1 py-1" /></td>
                    <td className="px-1 py-1"><input value={r.particular} onChange={(e) => setRows((a) => a.map((x, i) => i === idx ? { ...x, particular: e.target.value } : x))} className="w-full border-0 focus:ring-0 text-[13px] px-1 py-1" placeholder="Item" /></td>
                    <td className="px-1 py-1"><input type="number" value={r.amount} onChange={(e) => setRows((a) => a.map((x, i) => i === idx ? { ...x, amount: e.target.value } : x))} className="w-full border-0 focus:ring-0 text-[13px] px-1 py-1 text-right" placeholder="0" /></td>
                    <td className="px-1 text-center"><button type="button" onClick={() => setRows((a) => a.filter((_, i) => i !== idx))} className="text-slate-300 hover:text-red-500 text-lg leading-none">×</button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50/50">
                  <td className="px-2 py-2" colSpan={2}><button type="button" onClick={() => setRows((a) => [...a, { particular: '', amount: '', date: today }])} className="text-[12px] font-bold text-slate-500 hover:text-[#FF4500]">+ Add item</button></td>
                  <td className="px-2 py-2 text-right font-extrabold text-[#050A1F]">₹{total.toLocaleString('en-IN')}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div style={{ gridColumn: '1 / -1' }}><label className="text-xs font-bold text-slate-500">What is this claim for?</label><input value={f.title} onChange={(e) => set('title', e.target.value)} className={inpCls} placeholder="e.g. Client visit expenses" /></div>
          <div><label className="text-xs font-bold text-slate-500">Claim type</label><select value={f.employeePayType} onChange={(e) => set('employeePayType', e.target.value)} className={inpCls}><option value="">Select type…</option>{CLAIM_PAY_TYPES.map(([id, lbl]) => <option key={id} value={id}>{lbl}</option>)}</select></div>
          <div><label className="text-xs font-bold text-slate-500">Claim date</label><input type="date" value={f.expenseDate} onChange={(e) => set('expenseDate', e.target.value)} className={inpCls} /></div>
          <div style={{ gridColumn: '1 / -1' }}><label className="text-xs font-bold text-slate-500">Details {f.employeePayType === 'other' && <span className="text-amber-600">(required)</span>}</label><textarea rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} className={inpCls} placeholder="Add any notes to help HR review your claim" /></div>
        </div>
        <div className="mt-2 text-[11px] text-slate-400">Your claim goes to HR for review, then to admin for approval. HR may adjust the reimbursable amount.</div>
        <div className="flex justify-end gap-2 mt-5"><button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button><button onClick={save} disabled={busy || reading} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Submitting…' : `Submit claim · ₹${total.toLocaleString('en-IN')}`}</button></div>
      </div>
    </div>
  );
}

// Employee's full claim history — all past and current claims with date, amount,
// status and HR notes.
function ClaimHistoryModal({ claims, onClose, onNew }) {
  const rows = [...(claims || [])].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const fmt = (d) => { if (!d) return '—'; try { return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return '—'; } };
  const payTypeLbl = (t) => ({ ta: 'TA', da: 'DA', other: 'Other', advance: 'Advance', incentive: 'Incentive' })[t] || (t || '');
  return (
    <div className="fixed inset-0 bg-black/50 z-[140] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="text-lg font-extrabold text-[#050A1F]">Claim history</div>
          <div className="flex items-center gap-2">
            <button onClick={onNew} className="rounded-lg px-3 py-1.5 text-xs font-extrabold text-white" style={{ background: ORANGE }}>+ New Claim</button>
            <button onClick={onClose} className="text-slate-400 text-2xl leading-none ml-1">×</button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {rows.length === 0 ? (
            <div className="text-center text-slate-400 text-sm py-16">No claims yet. Raise your first claim to get a work expense reimbursed.</div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {rows.map((c) => {
                const st = claimStatusStyle(c.status); const reduced = c.approvedAmount != null && Number(c.approvedAmount) < Number(c.claimedAmount);
                return (
                  <div key={c._id} className="rounded-xl border border-slate-100 p-3.5">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold text-[#050A1F] truncate">{c.title}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">{fmt(c.createdAt)} · {payTypeLbl(c.employeePayType)}{c.invoiceUrl ? ' · 📎 invoice' : ''}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-extrabold text-[#050A1F]">₹{Number(c.approvedAmount ?? c.claimedAmount ?? c.amount ?? 0).toLocaleString('en-IN')}</div>
                        {reduced && <div className="text-[10px] text-slate-400">of ₹{Number(c.claimedAmount).toLocaleString('en-IN')} claimed</div>}
                      </div>
                      <span className="text-[10px] font-extrabold rounded px-1.5 py-1 shrink-0" style={st}>{claimStatusShort(c.status)}</span>
                    </div>
                    {(c.hrReviewNotes || c.rejectionReason) && (
                      <div className="mt-2 text-[11px] text-slate-500 bg-slate-50 rounded-lg px-2.5 py-1.5"><b className="text-slate-600">{c.status === 'rejected' ? 'Reason: ' : 'HR note: '}</b>{c.hrReviewNotes || c.rejectionReason}</div>
                    )}
                    <div className="mt-1.5 text-[11px] font-semibold" style={{ color: st.color }}>{claimStatusLabel(c.status)}{c.settlementMethod ? ` · ${({ cheque: 'by cheque', cash: 'in cash', salary: 'in next salary' })[c.settlementMethod] || ''}` : ''}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmployeeOrgChartModal({ onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [collapsed, setCollapsed] = useState({});
  const toggle = (k) => setCollapsed((c) => ({ ...c, [k]: !c[k] }));
  useEffect(() => { hrApi('/me/org-chart').then(setData).catch((e) => setErr(e.message)); }, []);

  // Measured connector geometry between the leadership row and the department
  // pills. We measure each pill's centre-x (relative to a wrapper) so the
  // horizontal bar starts/ends exactly at the first/last pill centre and each
  // drop line lands dead-centre — regardless of how wide each department's
  // subtree is. Recomputed on data load, collapse/expand, and resize.
  const connWrapRef = useRef(null);
  const trunkRef = useRef(null);
  const pillRefs = useRef({});
  const [geo, setGeo] = useState(null); // { barLeft, barRight, trunkX, drops:[x], top }
  useLayoutEffect(() => {
    const measure = () => {
      const wrap = connWrapRef.current;
      if (!wrap || !data) { setGeo(null); return; }
      const base = wrap.getBoundingClientRect();
      const names = (data.departments || []).map((d) => d.name);
      const xs = names.map((n) => {
        const el = pillRefs.current[n];
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return r.left - base.left + r.width / 2;
      }).filter((x) => x != null);
      if (xs.length < 2) { setGeo(null); return; }
      let trunkX = (Math.min(...xs) + Math.max(...xs)) / 2;
      if (trunkRef.current) {
        const tr = trunkRef.current.getBoundingClientRect();
        trunkX = tr.left - base.left + tr.width / 2;
      }
      setGeo({ barLeft: Math.min(...xs), barRight: Math.max(...xs), drops: xs, trunkX });
    };
    measure();
    window.addEventListener('resize', measure);
    const t = setTimeout(measure, 60); // after fonts/layout settle
    return () => { window.removeEventListener('resize', measure); clearTimeout(t); };
  }, [data, collapsed]);

  const ringFor = (type) => {
    if (type === 'director' || type === 'admin') return '#0A1F44';
    if (type === 'manager') return '#1CA0E8';
    if (type === 'tl') return '#7C3AED';
    if (type === 'hr' || type === 'recruiter') return '#0EA5E9';
    if (type === 'senior') return '#F59E0B';
    return '#A4C639';
  };
  const PhoneIcon = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -1, marginRight: 5, flexShrink: 0 }}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" /></svg>;
  const MailIcon = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -1, marginRight: 5, flexShrink: 0 }}><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 6L2 7" /></svg>;

  const PersonCard = ({ p }) => (
    <div className="inline-flex items-center gap-3 bg-white border border-slate-200 rounded-xl" style={{ padding: '13px 15px', boxShadow: '0 2px 6px rgba(10,20,60,.07)', width: 268, margin: '0 18px', textAlign: 'left' }}>
      <div className="shrink-0 rounded-full overflow-hidden flex items-center justify-center text-white font-bold" style={{ width: 46, height: 46, fontSize: 18, background: ringFor(p.type) }}>
        {p.avatar ? <img src={p.avatar} alt="" className="w-full h-full object-cover" /> : (p.name || '?')[0]}
      </div>
      <div className="min-w-0 overflow-hidden">
        <div className="text-[13px] font-bold text-[#0A0E28] truncate">{titleCase(p.name)}{p.branchIncharge && <span className="ml-1.5 text-[9px] font-bold text-[#FF4500]">IN-CHARGE</span>}</div>
        <div className="text-[11px] font-semibold text-[#FF6A00] truncate" style={{ marginBottom: p.masked ? 0 : 3 }}>{p.designation || ROLE_LABELS[p.type] || p.type}</div>
        {!p.masked && <>
          <div className="text-[11px] text-slate-500 truncate flex items-center"><PhoneIcon />{p.phone || '—'}</div>
          <div className="text-[11px] text-slate-500 truncate flex items-center"><MailIcon />{p.email || '—'}</div>
        </>}
      </div>
    </div>
  );
  const VConn = ({ h = 16 }) => <div style={{ width: 1, height: h, background: '#cbd5e1', margin: '0 auto' }} />;
  const Toggle = ({ k }) => (
    <div className="flex flex-col items-center">
      <div style={{ width: 1, height: 14, background: '#cbd5e1' }} />
      <button onClick={() => toggle(k)} className="rounded-full border border-slate-300 bg-white text-slate-500 flex items-center justify-center hover:bg-slate-50 leading-none" style={{ width: 18, height: 18, fontSize: 12 }}>{collapsed[k] ? '+' : '−'}</button>
    </div>
  );
  // Build a department's reporting tree from reportsToId. Someone is a top-level
  // branch when they don't report to another person shown in the same department
  // (e.g. they report to the Director) — so 2 team leads under a manager become 2
  // branches, and a senior who reports to the Director sits beside them.
  const buildDeptTree = (people) => {
    const idSet = new Set(people.map((u) => u._id));
    const nodeById = {};
    people.forEach((u) => { nodeById[u._id] = { p: u, children: [] }; });
    const roots = [];
    people.forEach((u) => {
      if (u.reportsToId && idSet.has(u.reportsToId) && u.reportsToId !== u._id) nodeById[u.reportsToId].children.push(nodeById[u._id]);
      else roots.push(nodeById[u._id]);
    });
    const sortKids = (n) => { n.children.sort((a, b) => (ROLE_LEVEL[a.p.type] ?? 9) - (ROLE_LEVEL[b.p.type] ?? 9) || (a.p.name || '').localeCompare(b.p.name || '')); n.children.forEach(sortKids); };
    roots.sort((a, b) => (ROLE_LEVEL[a.p.type] ?? 9) - (ROLE_LEVEL[b.p.type] ?? 9) || (a.p.name || '').localeCompare(b.p.name || ''));
    roots.forEach(sortKids);
    return roots;
  };
  // A subtree node. The person sits on top; below them a minimize/maximize
  // toggle, and their reports stack in a SINGLE vertical column (each connected
  // by a short vertical line). Only the department's senior row is side-by-side.
  const TreeNode = ({ node, keyPath }) => {
    const kids = node.children; const nk = `node:${keyPath}`;
    const isCollapsed = collapsed[nk];
    return (
      <div className="inline-flex flex-col items-center align-top" style={{ verticalAlign: 'top' }}>
        <PersonCard p={node.p} />
        {kids.length > 0 && (
          <>
            {/* Minimize / maximize the reports under this senior. */}
            <div style={{ width: 1, height: 12, background: '#cbd5e1' }} />
            <button onClick={() => toggle(nk)} className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-500 hover:bg-slate-50 leading-none">
              <span style={{ fontSize: 12, lineHeight: 1 }}>{isCollapsed ? '+' : '−'}</span>{isCollapsed ? `Show ${kids.length}` : 'Hide'}
            </button>
            {!isCollapsed && (
              <div className="flex flex-col items-center">
                {kids.map((c) => (
                  <div key={c.p._id} className="flex flex-col items-center">
                    <div style={{ width: 1, height: 14, background: '#cbd5e1' }} />
                    <TreeNode node={c} keyPath={`${keyPath}/${c.p._id}`} />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[140] flex flex-col" onClick={onClose}>
      <div className="bg-white w-full h-full flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div>
            <div className="text-lg font-extrabold text-[#050A1F]">Organization chart</div>
            {data && !data.fullAccess && <div className="text-[11px] text-slate-400">Your team is shown in full. Other departments show their lead only.</div>}
          </div>
          <button onClick={onClose} className="text-slate-400 text-2xl leading-none">×</button>
        </div>
        <div className="flex-1 overflow-auto p-8">
          {err ? <div className="text-center text-red-500 text-sm py-20">{err}</div>
            : !data ? <div className="text-center text-slate-400 text-sm py-20">Loading chart…</div>
              : (
                <div className="min-w-max mx-auto flex flex-col items-center">
                  {/* Leadership row: director/admin cards joined by a bar (when >1).
                      Director cards are fixed-width so a CSS bar is exact here. A
                      hidden marker centres the trunk that the SVG layer draws. */}
                  {data.admins.length > 0 && (() => {
                    const nAdmin = data.admins.length;
                    return (
                      <div className="inline-flex flex-col items-center">
                        <div className="relative">
                          {nAdmin > 1 && <div style={{ position: 'absolute', bottom: 0, left: 152, right: 152, height: 1, background: '#cbd5e1' }} />}
                          <div className="flex items-start justify-center">
                            {data.admins.map((a) => (
                              <div key={`a${a._id}`} className="flex flex-col items-center">
                                <PersonCard p={a} />
                                {nAdmin > 1 && <div style={{ width: 1, height: 14, background: '#cbd5e1' }} />}
                              </div>
                            ))}
                          </div>
                        </div>
                        {/* Trunk marker (its centre-x is measured for the SVG). */}
                        {data.departments.length > 0 && <div ref={trunkRef} style={{ width: 1, height: 0 }} />}
                      </div>
                    );
                  })()}
                  {/* Measured connector layer: an SVG whose horizontal bar runs from
                      the first pill centre to the last, a trunk up to the directors,
                      and a vertical drop into each pill. Pixel-measured so it never
                      overshoots and never breaks, whatever the subtree widths. */}
                  {data.admins.length > 0 && data.departments.length > 0 && (
                    <div ref={connWrapRef} className="relative" style={{ width: '100%', height: 34 }}>
                      {geo && (
                        <svg width="100%" height="34" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
                          {/* trunk from directors down to the bar */}
                          <line x1={geo.trunkX} y1={0} x2={geo.trunkX} y2={17} stroke="#cbd5e1" strokeWidth="1" shapeRendering="crispEdges" />
                          {/* horizontal bar, first→last pill centre */}
                          {data.departments.length > 1 && <line x1={geo.barLeft} y1={17} x2={geo.barRight} y2={17} stroke="#cbd5e1" strokeWidth="1" shapeRendering="crispEdges" />}
                          {/* drop into each pill */}
                          {geo.drops.map((x, i) => <line key={i} x1={x} y1={17} x2={x} y2={34} stroke="#cbd5e1" strokeWidth="1" shapeRendering="crispEdges" />)}
                        </svg>
                      )}
                    </div>
                  )}
                  {/* Department row: each department shrink-wraps to its pill so the
                      pill centre is the column centre; each senior's employees stack
                      in a column below. */}
                  <div className="flex items-start justify-center">
                    {data.departments.map((d) => {
                      const roots = buildDeptTree(d.people || []);
                      const multi = roots.length > 1;
                      return (
                        <div key={d.name} className="inline-flex flex-col items-center align-top" style={{ verticalAlign: 'top', padding: '0 22px' }}>
                          <div ref={(el) => { pillRefs.current[d.name] = el; }} className="inline-block text-white font-extrabold uppercase" style={{ background: d.mine ? '#0A1F44' : '#334155', fontSize: 12, letterSpacing: '.06em', padding: '9px 20px', borderRadius: 8 }}>
                            {d.name}{d.mine && <span className="ml-2 text-[9px] font-bold text-[#FF8A3D]">YOUR TEAM</span>}
                          </div>
                          {roots.length > 0 && (
                            <>
                              {/* Drop from the dept pill into the senior row. */}
                              <div style={{ width: 1, height: 18, background: '#cbd5e1' }} />
                              <div className="relative">
                                {/* Bar spanning the seniors (only when >1), inset to
                                    the outermost card centres (268 + 18px margins). */}
                                {multi && <div style={{ position: 'absolute', top: 0, left: 152, right: 152, height: 1, background: '#cbd5e1' }} />}
                                <div className="flex items-start justify-center">
                                  {roots.map((r) => (
                                    <div key={r.p._id} className="flex flex-col items-center">
                                      {multi && <div style={{ width: 1, height: 16, background: '#cbd5e1' }} />}
                                      <TreeNode node={r} keyPath={`${d.name}/${r.p._id}`} />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
        </div>
      </div>
    </div>
  );
}


// Senior's daily late-check popup: for each team member not logged in, set
// coming / not coming / not picking + optional notes.
function LateCheckModal({ item, onClose, onSave }) {
  const [rows, setRows] = useState(() => (item.people || []).map((p) => ({ ...p, status: p.status === 'pending' ? '' : p.status, notes: p.notes || '' })));
  const [busy, setBusy] = useState(false);
  const OPTS = [['coming', 'Coming', '#0F9D58'], ['not_coming', 'Not coming', '#EF4444'], ['not_picking', 'Not picking call', '#F59E0B']];
  const setRow = (idx, patch) => setRows((a) => a.map((r, i) => i === idx ? { ...r, ...patch } : r));
  const save = async () => {
    const updates = rows.filter((r) => r.status).map((r) => ({ id: r.id, status: r.status, notes: r.notes }));
    if (!updates.length) { alert('Set a status for at least one person.'); return; }
    setBusy(true); try { await onSave(updates); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl flex flex-col" style={{ maxHeight: '88vh' }} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div><div className="text-lg font-extrabold text-[#050A1F]">Attendance check</div><div className="text-[11px] text-slate-400">Team members not logged in after shift start + grace</div></div>
          <button onClick={onClose} className="text-slate-400 text-xl leading-none">×</button>
        </div>
        <div className="p-5 overflow-auto space-y-3">
          {rows.map((r, idx) => (
            <div key={r.id} className="rounded-xl border border-slate-100 p-3.5">
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-9 h-9 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center text-sm font-extrabold overflow-hidden shrink-0">{r.avatar ? <img src={r.avatar} alt="" className="w-full h-full object-cover" /> : (r.name || '?')[0]?.toUpperCase()}</div>
                <div className="min-w-0 flex-1">
                  <div className="font-extrabold text-[#050A1F] text-[14px] truncate">{titleCase(r.name)}</div>
                  <div className="text-[11px] text-slate-400">{r.phone ? <a href={`tel:${r.phone}`} className="text-sky-600 font-bold">{r.phone}</a> : 'No phone on file'}{r.shiftStart ? ` · shift ${r.shiftStart}` : ''}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {OPTS.map(([val, lbl, col]) => (
                  <button key={val} onClick={() => setRow(idx, { status: val })} className="text-[11px] font-extrabold rounded-md px-2.5 py-1 border" style={r.status === val ? { background: col, color: '#fff', borderColor: col } : { color: col, borderColor: '#e2e8f0' }}>{lbl}</button>
                ))}
              </div>
              <input value={r.notes} onChange={(e) => setRow(idx, { notes: e.target.value })} placeholder="Notes (optional)" className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-[13px]" />
            </div>
          ))}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : 'Save & notify HR'}</button>
        </div>
      </div>
    </div>
  );
}

// HR follow-up popup: review each lead's status + notes, and record the final
// outcome (especially for "not picking" — HR calls and updates).
function LateCheckHrModal({ item, onClose, onSave }) {
  const [rows, setRows] = useState(() => (item.people || []).map((p) => ({ ...p, hrStatus: p.hrStatus === 'pending' ? '' : p.hrStatus, hrNotes: p.hrNotes || '' })));
  const [busy, setBusy] = useState(false);
  const OPTS = [['coming', 'Coming', '#0F9D58'], ['not_coming', 'Not coming', '#EF4444'], ['resolved', 'Resolved', '#4338CA']];
  const seniorLabel = (s) => ({ coming: 'Coming', not_coming: 'Not coming', not_picking: 'Not picking call' }[s] || s);
  const seniorColor = (s) => ({ coming: '#0F9D58', not_coming: '#EF4444', not_picking: '#F59E0B' }[s] || '#64748b');
  const setRow = (idx, patch) => setRows((a) => a.map((r, i) => i === idx ? { ...r, ...patch } : r));
  const save = async () => {
    const updates = rows.filter((r) => r.hrStatus).map((r) => ({ id: r.id, status: r.hrStatus, notes: r.hrNotes }));
    if (!updates.length) { alert('Set a status for at least one person.'); return; }
    setBusy(true); try { await onSave(updates); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl flex flex-col" style={{ maxHeight: '88vh' }} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div><div className="text-lg font-extrabold text-[#050A1F]">Late follow-up</div><div className="text-[11px] text-slate-400">Team-lead updates for today — call the “not picking” ones</div></div>
          <button onClick={onClose} className="text-slate-400 text-xl leading-none">×</button>
        </div>
        <div className="p-5 overflow-auto space-y-3">
          {rows.map((r, idx) => (
            <div key={r.id} className="rounded-xl border border-slate-100 p-3.5">
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-9 h-9 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center text-sm font-extrabold overflow-hidden shrink-0">{r.avatar ? <img src={r.avatar} alt="" className="w-full h-full object-cover" /> : (r.name || '?')[0]?.toUpperCase()}</div>
                <div className="min-w-0 flex-1">
                  <div className="font-extrabold text-[#050A1F] text-[14px] truncate">{titleCase(r.name)}</div>
                  <div className="text-[11px] text-slate-400">{r.phone ? <a href={`tel:${r.phone}`} className="text-sky-600 font-bold">{r.phone}</a> : 'No phone on file'}{r.branch ? ` · ${r.branch}` : ''}</div>
                </div>
                <span className="text-[10px] font-extrabold rounded px-2 py-0.5 shrink-0" style={{ background: '#f8fafc', color: seniorColor(r.seniorStatus) }}>{seniorLabel(r.seniorStatus)}</span>
              </div>
              {(r.seniorNotes || r.seniorName) && <div className="text-[11px] text-slate-500 mb-2 bg-slate-50 rounded-lg px-2.5 py-1.5"><b>{r.seniorName || 'Lead'}:</b> {r.seniorNotes || '—'}</div>}
              <div className="flex flex-wrap gap-1.5 mb-2">
                {OPTS.map(([val, lbl, col]) => (
                  <button key={val} onClick={() => setRow(idx, { hrStatus: val })} className="text-[11px] font-extrabold rounded-md px-2.5 py-1 border" style={r.hrStatus === val ? { background: col, color: '#fff', borderColor: col } : { color: col, borderColor: '#e2e8f0' }}>{lbl}</button>
                ))}
              </div>
              <input value={r.hrNotes} onChange={(e) => setRow(idx, { hrNotes: e.target.value })} placeholder="HR notes (e.g. spoke to them, on the way)" className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-[13px]" />
            </div>
          ))}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : 'Update records'}</button>
        </div>
      </div>
    </div>
  );
}

function LeaveDecisionModal({ item, onClose, onDecide }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const fmtDay = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return d; } };
  const weekday = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long' }); } catch { return ''; } };
  const dates = item.dates && item.dates.length ? item.dates : [item.date];
  const durLabel = item.duration === 'half' ? 'Half day' : dates.length > 1 ? `Multiple days · ${dates.length} days` : 'Full day';
  const go = async (approve) => { setBusy(true); try { await onDecide(approve, note); } finally { setBusy(false); } };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="text-lg font-extrabold text-[#050A1F]">Take decision</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Employee</div>
            <div className="text-[15px] font-extrabold text-[#050A1F]">{titleCase(item.who)}</div>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-100 p-3.5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[11px] font-extrabold rounded px-2 py-0.5 capitalize" style={{ background: '#EEF3FF', color: '#1d4ed8' }}>{item.type}</span>
              <span className="text-[12px] font-extrabold text-[#050A1F]">{durLabel}</span>
            </div>
            {dates.length > 1 ? (
              <div className="space-y-1">
                {dates.map((d, i) => (
                  <div key={d} className="text-[13px] text-slate-700"><span className="font-bold">Day {i + 1}</span> — {fmtDay(d)} <span className="text-slate-400">({weekday(d)})</span></div>
                ))}
              </div>
            ) : (
              <div className="text-[13px] text-slate-700">{fmtDay(dates[0])} <span className="text-slate-400">({weekday(dates[0])})</span>{item.duration === 'half' ? ' · half day' : ''}</div>
            )}
            {item.reason && <div className="text-[12px] text-slate-500 mt-2 pt-2 border-t border-slate-200/70">Reason: {item.reason}</div>}
          </div>
          <div className="rounded-xl border border-slate-100 p-3.5">
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Last leave taken</div>
            {item.lastLeave ? (
              <div className="text-[13px] text-slate-700">
                {item.lastLeave.from === item.lastLeave.to ? fmtDay(item.lastLeave.from) : `${fmtDay(item.lastLeave.from)} – ${fmtDay(item.lastLeave.to)}`}
                <span className="text-slate-400"> · {item.lastLeave.days} day{item.lastLeave.days === 1 ? '' : 's'} · {item.lastLeave.daysAgo} day{item.lastLeave.daysAgo === 1 ? '' : 's'} ago</span>
              </div>
            ) : <div className="text-[13px] text-slate-400">No previous leave on record.</div>}
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Notes <span className="normal-case font-semibold text-slate-300">(optional)</span></div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Add a note for the employee…" className={inputCls} />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button disabled={busy} onClick={() => go(false)} className="rounded-lg px-4 py-2 text-sm font-extrabold disabled:opacity-50" style={{ background: '#FEE2E2', color: '#B91C1C' }}>Decline</button>
          <button disabled={busy} onClick={() => go(true)} className="rounded-lg px-5 py-2 text-sm font-extrabold text-white disabled:opacity-50" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>{busy ? 'Saving…' : 'Approve'}</button>
        </div>
      </div>
    </div>
  );
}

// Apply for leave (self-service). Creates a pending request routed to the
// employee's approver.
function ApplyLeaveModal({ approverName, approverChain, onClose, onDone }) {
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const [type, setType] = useState('casual');
  const [duration, setDuration] = useState('full');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [halfDate, setHalfDate] = useState(today);
  const [reason, setReason] = useState('');
  const [documentUrl, setDocumentUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Keep To in step when From moves past it.
  const onFrom = (v) => { setFrom(v); if (to < v) setTo(v); };
  const dayCount = (() => { if (duration === 'half') return 0.5; const a = new Date(from + 'T00:00:00'), b = new Date(to + 'T00:00:00'); return Math.max(1, Math.round((b - a) / 86400000) + 1); })();
  const uploadMedical = async (file) => {
    if (!file) return; setUploading(true); setErr('');
    try { const { url } = await uploadToImageKit(file, `/qtonix-hr/leave/self/${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, file.name); setDocumentUrl(url); }
    catch (e) { setErr('Upload failed: ' + e.message); } finally { setUploading(false); }
  };
  const submit = async () => {
    setErr('');
    if (duration === 'full' && to < from) { setErr('The end date can’t be before the start date.'); return; }
    // Employees must attach a medical certificate for medical leave.
    if (type === 'medical' && !documentUrl) { setErr('Please upload your medical certificate to apply for medical leave.'); return; }
    const body = duration === 'half'
      ? { type, duration: 'half', date: halfDate, reason, documentUrl }
      : { type, duration: 'full', from, to, reason, documentUrl };
    setBusy(true);
    try { await hrApi('/me/leave', { method: 'POST', body: JSON.stringify(body) }); onDone(); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between"><div className="text-base font-extrabold text-[#050A1F]">Apply for leave</div><button onClick={onClose} className="text-slate-400 text-xl leading-none">×</button></div>
        <div className="p-6 space-y-4">
          {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{err}</div>}
          <div><div className="text-[12px] font-bold text-slate-600 mb-1">Leave type</div>
            <select value={type} onChange={(e) => setType(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="casual">Casual</option><option value="medical">Medical</option><option value="privilege">Privilege</option><option value="wfh">Work from home</option>
            </select>
          </div>
          <div><div className="text-[12px] font-bold text-slate-600 mb-1">Duration</div>
            <div className="flex gap-2">
              <button onClick={() => setDuration('full')} className={`flex-1 rounded-lg border px-3 py-2 text-sm font-bold ${duration === 'full' ? 'border-red-300 bg-red-50 text-red-600' : 'border-slate-200 text-slate-500'}`}>Full day</button>
              <button onClick={() => setDuration('half')} className={`flex-1 rounded-lg border px-3 py-2 text-sm font-bold ${duration === 'half' ? 'border-amber-300 bg-amber-50 text-amber-600' : 'border-slate-200 text-slate-500'}`}>Half day</button>
            </div>
          </div>
          {duration === 'full' ? (
            <div className="flex gap-2">
              <div className="flex-1"><div className="text-[12px] font-bold text-slate-600 mb-1">From</div><input type="date" value={from} min={today} onChange={(e) => onFrom(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></div>
              <div className="flex-1"><div className="text-[12px] font-bold text-slate-600 mb-1">To</div><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></div>
            </div>
          ) : (
            <div><div className="text-[12px] font-bold text-slate-600 mb-1">Date</div><input type="date" value={halfDate} min={today} onChange={(e) => setHalfDate(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></div>
          )}
          <div><div className="text-[12px] font-bold text-slate-600 mb-1">Reason</div><textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Add a short reason…" /></div>
          {type === 'medical' && (
            <div>
              <div className="text-[12px] font-bold text-slate-600 mb-1">Medical certificate <span className="text-red-500">*</span></div>
              {documentUrl ? (
                <div className="flex items-center gap-2"><a href={documentUrl} target="_blank" rel="noreferrer" className="text-xs font-bold text-blue-500">View uploaded ↗</a><button onClick={() => setDocumentUrl('')} className="text-xs text-slate-400">Remove</button></div>
              ) : (
                <label className="inline-block rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold cursor-pointer hover:bg-slate-50">{uploading ? 'Uploading…' : 'Upload certificate'}<input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files[0] && uploadMedical(e.target.files[0])} /></label>
              )}
              <div className="text-[11px] text-slate-400 mt-1">Required for medical leave.</div>
            </div>
          )}
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-slate-500">Applying for <b className="text-slate-700">{dayCount === 0.5 ? 'half a day' : `${dayCount} day${dayCount > 1 ? 's' : ''}`}</b></span>
          </div>
          {(Array.isArray(approverChain) && approverChain.length > 0) ? (
            <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Goes to your approver{approverChain.length > 1 ? 's' : ''}</div>
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px]">
                {approverChain.map((a, i) => (
                  <span key={a.id} className="flex items-center gap-1.5">
                    {i > 0 && <span className="text-slate-300">→</span>}
                    <b className="text-slate-700">{titleCase(a.name)}</b>
                    {i === 0 && <span className="text-[10px] text-slate-400">(immediate senior)</span>}
                    {a.designation ? <span className="text-[10px] text-slate-400">· {a.designation}</span> : null}
                  </span>
                ))}
              </div>
            </div>
          ) : approverName ? (
            <div className="text-[12px] text-slate-400">Approver: <b className="text-slate-600">{titleCase(approverName)}</b></div>
          ) : null}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={submit} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>{busy ? 'Submitting…' : 'Submit request'}</button>
        </div>
      </div>
    </div>
  );
}

// Leave history — every leave the employee has applied, with status.
function LeaveHistoryModal({ leaves, onClose }) {
  const stCls = { pending: { background: '#FEF3C7', color: '#B45309' }, approved: { background: '#DCFCE7', color: '#15803D' }, rejected: { background: '#FEE2E2', color: '#B91C1C' } };
  const fmt = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return d; } };
  const fmtApplied = (iso) => { try { return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); } catch { return ''; } };
  // Group multi-day requests (shared groupId) into a single history row.
  const groups = [];
  const byKey = {};
  (leaves || []).forEach((l) => {
    const key = l.groupId || `s${l.id}`;
    if (!byKey[key]) { byKey[key] = { key, rows: [] }; groups.push(byKey[key]); }
    byKey[key].rows.push(l);
  });
  const items = groups.map((g) => {
    const rows = g.rows.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const first = rows[0];
    return {
      id: g.key, type: first.type, duration: first.duration, status: first.status,
      approver: first.approverName || first.approvedBy || '—', createdAt: first.createdAt,
      from: rows[0].date, to: rows[rows.length - 1].date, days: rows.length,
    };
  }).sort((a, b) => String(b.from).localeCompare(String(a.from)));
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col" style={{ maxHeight: '82vh' }} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0"><div className="text-base font-extrabold text-[#050A1F]">Leave history</div><button onClick={onClose} className="text-slate-400 text-xl leading-none">×</button></div>
        <div className="p-6 overflow-auto">
          {items.length === 0 ? <div className="text-sm text-slate-400 py-6 text-center">You haven’t applied for any leave yet.</div> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left">{['Applied', 'Type', 'Dates', 'Duration', 'Approver', 'Status'].map((h) => <th key={h} className="text-[11px] font-extrabold uppercase text-slate-400 pb-2 px-2 border-b border-slate-100">{h}</th>)}</tr></thead>
              <tbody>
                {items.map((l) => (
                  <tr key={l.id} className="border-b border-slate-50">
                    <td className="px-2 py-2.5 text-slate-500">{fmtApplied(l.createdAt)}</td>
                    <td className="px-2 py-2.5 capitalize font-semibold text-[#050A1F]">{l.type}</td>
                    <td className="px-2 py-2.5 text-slate-600">{l.days > 1 ? `${fmt(l.from)} – ${fmt(l.to)}` : fmt(l.from)}</td>
                    <td className="px-2 py-2.5 text-slate-600">{l.duration === 'half' ? 'Half day' : (l.days > 1 ? `${l.days} days` : 'Full day')}</td>
                    <td className="px-2 py-2.5 text-slate-600">{l.approver}</td>
                    <td className="px-2 py-2.5"><span className="text-[10px] font-extrabold rounded-md px-2 py-0.5 capitalize" style={stCls[l.status] || stCls.pending}>{l.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// The signed-in employee's own attendance calendar (month grid, color-coded).
function MyAttendanceCalendar({ onClose }) {
  const [month, setMonth] = useState(new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7));
  const [data, setData] = useState(null);
  useEffect(() => { hrApi(`/me/attendance-calendar?month=${month}`).then(setData).catch(() => setData({ days: {} })); }, [month]);
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1).getDay();
  const dim = new Date(y, m, 0).getDate();
  const cls = {
    present: { background: '#ECFDF3', borderColor: '#A7F3D0', mk: '#15803D', label: 'P' },
    late: { background: '#FFFBEB', borderColor: '#FDE68A', mk: '#B45309', label: 'Late' },
    absent: { background: '#FEF2F2', borderColor: '#FECACA', mk: '#B91C1C', label: 'A' },
    leave: { background: '#F5F3FF', borderColor: '#DDD6FE', mk: '#6D28D9', label: 'Leave' },
    holiday: { background: '#EFF6FF', borderColor: '#BFDBFE', mk: '#1d4ed8', label: 'Holiday' },
    weekoff: { background: '#F1F5F9', borderColor: '#E2E8F0', mk: '#64748b', label: 'Off' },
    none: { background: '#fff', borderColor: '#eef2f9', mk: '#cbd5e1', label: '' },
  };
  const shift = (d) => { const nd = new Date(y, m - 1 + d, 1); setMonth(`${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}`); };
  const monthLabel = new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="text-base font-extrabold text-[#050A1F]">My attendance</div>
          <div className="flex items-center gap-2">
            <button onClick={() => shift(-1)} className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-500">‹</button>
            <span className="text-sm font-bold text-slate-600 w-36 text-center">{monthLabel}</span>
            <button onClick={() => shift(1)} className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-500">›</button>
            <button onClick={onClose} className="text-slate-400 text-xl leading-none ml-2">×</button>
          </div>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-7 gap-1.5 mb-1.5">{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i} className="text-[10px] font-extrabold text-slate-400 text-center uppercase">{d}</div>)}</div>
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: first }).map((_, i) => <div key={`e${i}`} />)}
            {Array.from({ length: dim }).map((_, i) => {
              const d = i + 1; const ds = `${month}-${String(d).padStart(2, '0')}`;
              const info = data && data.days ? data.days[ds] : null; const stt = info ? info.status : 'none'; const c = cls[stt] || cls.none;
              return (
                <div key={d} className="rounded-lg border p-1.5 relative" style={{ aspectRatio: '1', background: c.background, borderColor: c.borderColor }} title={info && info.timeEdited ? `Time corrected by ${info.timeEdited.byName || 'HR'}` : (info && info.login ? `In ${info.login}${info.logout ? ` · Out ${info.logout}` : ''}` : (info && info.holiday) || '')}>
                  <div className="text-[11px] font-bold text-slate-700">{d}</div>
                  {c.label && <div className="absolute bottom-1 left-1.5 text-[9px] font-extrabold" style={{ color: c.mk }}>{c.label}</div>}
                  {info && info.timeEdited && (info.timeEdited.byAvatar
                    ? <img src={info.timeEdited.byAvatar} alt="edited" className="absolute top-1 right-1 w-4 h-4 rounded-full object-cover border border-amber-300" title={`Corrected by ${info.timeEdited.byName || 'HR'}`} />
                    : <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-amber-100 text-amber-700 text-[7px] font-extrabold flex items-center justify-center border border-amber-300">{String(info.timeEdited.byName || 'HR').split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase()}</span>)}
                </div>
              );
            })}
          </div>
          <div className="flex gap-3.5 flex-wrap mt-4 text-[11px] font-bold text-slate-600">
            {[['Present', '#A7F3D0'], ['Late', '#FDE68A'], ['Absent', '#FECACA'], ['Leave', '#DDD6FE'], ['Holiday', '#BFDBFE'], ['Week off', '#E2E8F0']].map(([l, c]) => (
              <span key={l} className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: c }} />{l}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Auto-sliding celebration banner on the HR dashboard — birthdays, work
// anniversaries and new joinees for today. Mirrors the Sales CRM slider:
// advances every 10s with dot navigation.
// Fetches today's celebrations once and renders the shared slider (used above
// the dashboard tabs so it appears a single time for both dashboards).
function DashboardCelebrations() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const load = () => hrApi('/celebrations').then((r) => setItems(r.items || [])).catch(() => {});
    load();
    const iv = setInterval(load, 60 * 60 * 1000); // hourly, clears at day boundary
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(iv); window.removeEventListener('focus', onFocus); };
  }, []);
  if (!items.length) return null;
  return <div className="mb-4"><HrCelebrationSlider items={items} /></div>;
}

function HrCelebrationSlider({ items }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (!items || items.length <= 1) return;
    const t = setInterval(() => setIdx((n) => (n + 1) % items.length), 10000);
    return () => clearInterval(t);
  }, [items && items.length]);
  useEffect(() => { if (items && idx >= items.length) setIdx(0); }, [items, idx]);
  if (!items || items.length === 0) return null;
  const c = items[Math.min(idx, items.length - 1)];
  const first = String(c.name || '').split(' ')[0];
  const initials = String(c.name || '?').split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase();
  const cfg = c.type === 'birthday'
    ? { emoji: '🎂', msg: `Happy Birthday, ${first}!`, sub: `${c.name} · Wishing you a wonderful day!`, grad: 'linear-gradient(90deg,#FDF2F8,#FFF7ED)', border: '#FBCFE8', accent: '#DB2777' }
    : c.type === 'work'
    ? { emoji: '🏆', msg: `Happy ${c.yearsLabel || ''} Work Anniversary, ${first}!`, sub: `${c.name} · Thank you for ${c.years ? `${c.years} year${c.years === 1 ? '' : 's'} of ` : ''}being with us!`, grad: 'linear-gradient(90deg,#FFF7ED,#FEF3C7)', border: '#FDE68A', accent: '#B45309' }
    : c.type === 'joinee'
    ? { emoji: '👋', msg: `Welcome, ${first}!`, sub: `${c.name}${c.designation ? ` · ${c.designation}` : ''} just joined the team`, grad: 'linear-gradient(90deg,#EFF6FF,#F0FDFA)', border: '#BFDBFE', accent: '#1D4ED8' }
    : { emoji: '💍', msg: `Happy Anniversary, ${first}!`, sub: `${c.name} · Congratulations on your special day!`, grad: 'linear-gradient(90deg,#FDF2F8,#FFF7ED)', border: '#FBCFE8', accent: '#DB2777' };
  return (
    <div>
      <div className="rounded-2xl overflow-hidden shadow-sm border" style={{ borderColor: cfg.border }}>
        <div className="px-5 py-4 flex items-center gap-4" style={{ background: cfg.grad }}>
          <div className="text-4xl" style={{ animation: 'bounce 1.5s infinite' }}>{cfg.emoji}</div>
          {c.avatar
            ? <img src={c.avatar} alt={c.name} className="w-14 h-14 rounded-full object-cover border-2 border-white shadow" />
            : <div className="w-14 h-14 rounded-full flex items-center justify-center text-white font-extrabold text-lg shadow" style={{ background: cfg.accent }}>{initials}</div>}
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-extrabold text-[#050A1F]">{cfg.msg}</div>
            <div className="text-[12px] font-semibold" style={{ color: cfg.accent }}>{cfg.sub}</div>
          </div>
        </div>
      </div>
      {items.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 mt-2">
          {items.map((s, i) => (
            <button key={`${s.id}-${s.type}-${i}`} onClick={() => setIdx(i)} aria-label={`Slide ${i + 1}`}
              className={`h-1.5 rounded-full transition-all ${i === idx ? 'w-5' : 'w-1.5 bg-slate-300 hover:bg-slate-400'}`} style={i === idx ? { background: '#FF6A00' } : {}} />
          ))}
        </div>
      )}
    </div>
  );
}

function HrDashboard({ user, isAdmin, onOpenCandidate, onNav }) {
  const [data, setData] = useState(null);
  const [stats, setStats] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [targets, setTargets] = useState([]);
  const [missed, setMissed] = useState(null);
  const [pendingOffers, setPendingOffers] = useState([]);
  const [missedModal, setMissedModal] = useState(null); // { ownerId } | null
  const [mail, setMail] = useState(null);
  const [mailTab, setMailTab] = useState('new');
  const [announcements, setAnnouncements] = useState([]);
  const [annCanPost, setAnnCanPost] = useState(false);
  const [showAnnModal, setShowAnnModal] = useState(false);
  const [board, setBoard] = useState(null);
  const [recentCands, setRecentCands] = useState(null);
  useEffect(() => {
    // Live-updating stats: fetch on mount, then poll and refresh on window focus
    // so the targets race and counters reflect newly-added candidates promptly.
    const loadLive = () => {
      hrApi('/dashboard').then(setData).catch(() => setData({ metrics: {} }));
      hrApi('/dashboard-stats').then(setStats).catch(() => {});
      hrApi('/targets-progress').then((r) => setTargets(r.rows || [])).catch(() => {});
      hrApi('/leaderboard').then(setBoard).catch(() => {});
      hrApi('/pending-offers').then((r) => setPendingOffers(r.items || [])).catch(() => {});
      hrApi('/recent-candidates').then(setRecentCands).catch(() => {});
    };
    loadLive();
    hrApi('/job-posts').then(setJobs).catch(() => {});
    hrApi('/source-analytics').then((r) => setAnalytics(r.sources || [])).catch(() => {});
    hrApi('/missed-commitments').then(setMissed).catch(() => {});
    hrApi('/unread-mail').then(setMail).catch(() => {});
    loadAnnouncements();
    const iv = setInterval(loadLive, 30000);
    const onFocus = () => loadLive();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(iv); window.removeEventListener('focus', onFocus); };
  }, []);
  const loadAnnouncements = () => hrApi('/announcements').then((r) => { setAnnouncements(r.announcements || []); setAnnCanPost(!!r.canPost); }).catch(() => {});
  const m = (data && data.metrics) || {};
  const stageLabels = {}; jobs.forEach((j) => (j.stages || []).forEach((s) => { stageLabels[s.id] = s.label; }));
  const byStage = (stats && stats.byStage) || {};
  const stageRows = Object.entries(byStage).map(([id, n]) => ({ id, label: stageLabels[id] || id, n })).sort((a, b) => b.n - a.n);
  const SRC = { manual: 'Manual', linkedin: 'LinkedIn', naukri: 'Naukri', indeed: 'Indeed', referral: 'Referral', careers_page: 'Careers', public_form: 'Careers' };
  const cards = [
    ['Open positions', stats ? `${stats.activeJobs ?? stats.openJobs}/${stats.totalJobs ?? '—'}` : (m.openJobs || '—'), '#2563EB', 'M20 7h-4V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z', { tab: 'jobs', jobScope: 'mine' }],
    ['Total applications', stats ? stats.totalApplications : '—', '#0EA5E9', 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8', { tab: 'candidates', candScope: 'all' }],
    ['Active candidates', stats ? stats.totalActive : m.candidates, '#FF6A00', 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', { tab: 'candidates', candScope: 'all' }],
    ['Applications this week', stats ? stats.applicationsThisWeek : '—', '#8b5cf6', 'M22 11.08V12a10 10 0 1 1-5.93-9.14 M22 4L12 14.01l-3-3', { tab: 'candidates', candScope: 'all', weekOnly: true }],
    ['Avg time-to-hire', stats && stats.avgTimeToHire != null ? `${stats.avgTimeToHire}d` : '—', '#16A34A', 'M12 8v4l3 3 M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', null],
  ];
  const softTint = (hex) => `${hex}0F`;
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold text-[#050A1F]">{greeting()}, {titleCase(user.name)}!</h1>
          <p className="text-slate-500 text-sm mt-1">Here's your recruitment overview.</p>
        </div>
        {annCanPost && <button onClick={() => setShowAnnModal(true)} className="rounded-lg px-3 py-2 text-xs font-bold text-white inline-flex items-center gap-1.5" style={{ background: '#050A1F' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 11l18-5v12L3 14v-3zM11.6 16.8a3 3 0 1 1-5.8-1.6" /></svg> Post announcement
        </button>}
      </div>

      {/* Announcements / notice board */}
      {announcements.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-amber-700 mb-2">📢 Announcements</div>
          <div className="space-y-2">
            {announcements.slice(0, 4).map((a) => (
              <div key={a._id} className="bg-white rounded-lg border border-amber-100 px-3 py-2 group">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-bold text-[#050A1F] flex items-center gap-1.5">{a.pinned && <span title="Pinned">📌</span>}{a.title}{a.audience && a.audience !== 'all' && <span className="text-[9px] font-bold rounded px-1.5 py-0.5 bg-blue-100 text-blue-600">{a.audience}</span>}</div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-slate-400">{a.authorName} · {new Date(a.createdAt).toLocaleDateString()}</span>
                    {annCanPost && <button title="Remove" onClick={async () => { if (!window.confirm('Remove this announcement?')) return; try { await hrApi(`/announcements/${a._id}`, { method: 'DELETE' }); loadAnnouncements(); } catch (e) { alert(e.message); } }} className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 text-xs">✕</button>}
                  </div>
                </div>
                {a.body && <div className="text-xs text-slate-500 mt-0.5 whitespace-pre-wrap">{a.body}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Offers pending completion — candidates marked for hire before the offer
          process was finished. */}
      {pendingOffers.length > 0 && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
          <div className="mb-2">
            <div className="text-[11px] font-bold uppercase tracking-wide text-sky-700">📝 Offers to complete · {pendingOffers.length}</div>
            <div className="text-[11px] text-sky-600">These candidates were marked for hire — finish the offer process to confirm the hire.</div>
          </div>
          <div className="space-y-1 max-h-40 overflow-auto">
            {pendingOffers.slice(0, 10).map((p) => (
              <button key={p.candidateId} onClick={() => onOpenCandidate && onOpenCandidate(p.candidateId, 'offer')}
                className="w-full flex items-center gap-2 bg-white rounded-lg px-3 py-2 text-[11px] hover:bg-sky-100/50 transition-colors text-left">
                <span className="shrink-0">📝</span>
                <span className="font-bold text-[#050A1F] truncate shrink-0 max-w-[130px]">{p.candidateName}</span>
                <span className="text-slate-400 truncate flex-1 min-w-0">· {p.reason}</span>
                {isAdmin && <span className="text-slate-400 shrink-0 hidden sm:inline">{p.recruiterName}</span>}
                <span className="text-sky-600 font-bold shrink-0">Complete →</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Recently added & recently submitted candidates. */}
      {recentCands && ((recentCands.added || []).length > 0 || (recentCands.submitted || []).length > 0) && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-2">🆕 Recently added candidates</div>
            <div className="space-y-1">
              {(recentCands.added || []).length === 0 ? <div className="text-xs text-slate-400 px-1 py-2">No candidates yet.</div> :
                recentCands.added.map((c) => (
                  <button key={c._id} onClick={() => onOpenCandidate && onOpenCandidate(c._id)} className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] hover:bg-slate-50 transition-colors text-left">
                    <span className="font-bold text-[#050A1F] truncate max-w-[130px] shrink-0">{titleCase(c.name)}</span>
                    <span className="text-slate-400 truncate flex-1 min-w-0">· {c.jobTitle || '—'}</span>
                    <span className="text-slate-300 shrink-0">{timeAgo(c.createdAt)}</span>
                  </button>
                ))}
            </div>
          </div>
          <div className="rounded-2xl border border-orange-200 bg-orange-50/40 p-4">
            <div className="text-[11px] font-bold uppercase tracking-wide text-orange-600 mb-2">📥 Recently submitted (careers form)</div>
            <div className="space-y-1">
              {(recentCands.submitted || []).length === 0 ? <div className="text-xs text-slate-400 px-1 py-2">No form submissions yet.</div> :
                recentCands.submitted.map((c) => (
                  <button key={c._id} onClick={() => onOpenCandidate && onOpenCandidate(c._id)} className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] hover:bg-orange-100/40 transition-colors text-left">
                    <span className="font-bold text-[#050A1F] truncate max-w-[120px] shrink-0">{titleCase(c.name)}</span>
                    <span className="text-slate-400 truncate flex-1 min-w-0">· {c.jobTitle || '—'}</span>
                    {c.recruiterName ? <span className="text-orange-500 shrink-0 hidden sm:inline max-w-[80px] truncate">→ {c.recruiterName.split(' ')[0]}</span> : <span className="text-slate-300 shrink-0 hidden sm:inline">unassigned</span>}
                    <span className="text-slate-300 shrink-0">{timeAgo(c.createdAt)}</span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
      {missed && missed.stillOpen > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-red-700">⚠️ Missed commitments · {missed.stillOpen}</div>
              <div className="text-[11px] text-red-600">Interview feedback, calls, tasks and scheduling more than an hour past their agreed time.</div>
            </div>
            {isAdmin && missed.byOwner.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {missed.byOwner.slice(0, 5).map((o) => (
                  <button key={o.ownerId || 'un'} onClick={() => setMissedModal({ ownerId: o.ownerId, ownerName: o.ownerName })}
                    className="rounded-md bg-white border border-red-200 px-2 py-1 text-[10px] font-bold text-red-700 hover:bg-red-100 transition-colors">{o.ownerName} · {o.missed}</button>
                ))}
                <button onClick={() => setMissedModal({ ownerId: null })} className="rounded-md bg-red-600 text-white px-2.5 py-1 text-[10px] font-bold hover:bg-red-700 transition-colors">View all →</button>
              </div>
            )}
          </div>
          <div className="space-y-1 max-h-40 overflow-auto">
            {missed.items.slice(0, 8).map((i) => (
              <div key={i.activityId} className="flex items-center gap-2 bg-white rounded-lg px-3 py-1.5 text-[11px] hover:bg-red-50 transition-colors group">
                <span className="cursor-pointer" onClick={() => onOpenCandidate && onOpenCandidate(i.candidateId)}>{MISSED_ICON[i.kind] || '✅'}</span>
                <span className="font-bold text-[#050A1F] truncate max-w-[150px] cursor-pointer" onClick={() => onOpenCandidate && onOpenCandidate(i.candidateId)}>{i.candidateName}</span>
                <span className="text-slate-500 truncate flex-1 cursor-pointer" onClick={() => onOpenCandidate && onOpenCandidate(i.candidateId)}>{i.title}</span>
                {isAdmin && <span className="text-slate-400 shrink-0">{i.ownerName}</span>}
                <span className="font-bold text-red-600 shrink-0">{i.hoursLate}h late</span>
                {isAdmin && (
                  <button title="Clear from missed commitments" onClick={async (e) => { e.stopPropagation(); try { await hrApi(`/missed-commitments/${i.candidateId}/dismiss`, { method: 'POST', body: JSON.stringify({ activityId: i.activityId }) }); setMissed((prev) => prev ? { ...prev, items: prev.items.filter((x) => x.activityId !== i.activityId), stillOpen: Math.max(0, prev.stillOpen - 1) } : prev); } catch {} }}
                    className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-slate-400 hover:bg-red-100 hover:text-red-600">×</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Accent stat cards, CRM-style */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {cards.map(([label, val, color, icon, navTarget]) => {
          const clickable = navTarget && onNav;
          return (
            <div key={label} onClick={() => clickable && onNav(navTarget)}
              className={`rounded-2xl border p-5 relative overflow-hidden ${clickable ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`} style={{ borderColor: color + '33', background: '#fff' }}>
              <div className="absolute top-4 right-4 w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: softTint(color) }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{icon.split(' M').map((seg, i) => <path key={i} d={(i ? 'M' : '') + seg} />)}</svg>
              </div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
              <div className="text-3xl font-extrabold mt-1" style={{ color }}>{val ?? '—'}</div>
              {clickable && <div className="text-[10px] font-semibold text-slate-300 mt-1">View →</div>}
            </div>
          );
        })}
      </div>

      {/* HR target progress (daily scheduling + monthly hiring) */}
      {targets.length > 0 && (() => {
        // Rank by monthly-hire achievement (primary target), then daily.
        const scored = targets.map((t) => ({
          ...t,
          monthlyPct: t.monthlyTarget > 0 ? Math.round((t.monthlyDone / t.monthlyTarget) * 100) : null,
          dailyPct: t.dailyTarget > 0 ? Math.round((t.dailyDone / t.dailyTarget) * 100) : null,
        })).sort((a, b) => (b.monthlyPct ?? -1) - (a.monthlyPct ?? -1) || (b.monthlyDone - a.monthlyDone) || (b.dailyDone - a.dailyDone));
        const leader = scored[0];
        const medal = (i) => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
        return (
        <div className="rounded-2xl border border-slate-100 bg-white p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="font-extrabold text-[#050A1F] flex items-center gap-2">🎯 HR targets race</div>
            {leader && <div className="text-xs text-slate-500">Leading: <b className="text-[#050A1F]">{leader.name}</b>{leader.monthlyPct != null ? ` · ${leader.monthlyPct}% of monthly hires` : ''}</div>}
          </div>
          <div className="space-y-2.5">
            {scored.map((t, i) => {
              const hitMonthly = t.monthlyTarget > 0 && t.monthlyDone >= t.monthlyTarget;
              const hitDaily = t.dailyTarget > 0 && t.dailyDone >= t.dailyTarget;
              const barPct = t.monthlyPct != null ? Math.min(100, Math.max(4, t.monthlyPct)) : (t.dailyPct != null ? Math.min(100, Math.max(4, t.dailyPct)) : 4);
              return (
                <div key={t.id} className={`flex items-center gap-3 rounded-xl p-2.5 ${i === 0 ? 'bg-amber-50/60 border border-amber-100' : 'hover:bg-slate-50'}`}>
                  <div className="w-7 text-center text-lg shrink-0">{medal(i)}</div>
                  <span className="w-9 h-9 rounded-full bg-slate-100 overflow-hidden flex items-center justify-center text-xs font-bold text-slate-500 shrink-0">
                    {t.avatar ? <img src={t.avatar} alt="" className="w-full h-full object-cover" /> : (t.name || '?')[0]}
                  </span>
                  <div className="w-32 shrink-0 min-w-0">
                    <div className="text-sm font-bold text-[#050A1F] truncate">{t.name}</div>
                    <div className="text-[10px] text-slate-400">
                      {t.dailyTarget > 0 && <span className={hitDaily ? 'text-blue-600 font-bold' : ''}>{t.dailyDone}/{t.dailyTarget} today</span>}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${barPct}%`, background: hitMonthly ? '#16A34A' : ORANGE }} />
                    </div>
                  </div>
                  <div className="w-24 text-right shrink-0">
                    <div className="font-extrabold text-xs text-[#050A1F]">{t.monthlyTarget > 0 ? `${t.monthlyDone}/${t.monthlyTarget}` : '—'} <span className="font-semibold text-slate-400">hired</span></div>
                    {t.monthlyPct != null && <div className={`text-[10px] font-bold ${hitMonthly ? 'text-green-600' : 'text-slate-400'}`}>{hitMonthly ? '✓ target hit' : `${t.monthlyPct}%`}</div>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-[10px] text-slate-400 mt-3">Ranked by monthly hiring target · today's interviews shown per HR.</div>
        </div>
        );
      })()}

      <div className="grid md:grid-cols-2 gap-4">
        {/* Candidates per stage (funnel) */}
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <div className="font-extrabold text-[#050A1F] mb-3">Pipeline funnel</div>
          {stageRows.length === 0 ? <div className="text-sm text-slate-400">No active candidates.</div> : (
            <div className="space-y-2.5">
              {stageRows.map((s) => {
                const max = Math.max(...stageRows.map((x) => x.n), 1);
                return (
                  <div key={s.id} className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-slate-600 w-32 truncate">{s.label}</span>
                    <div className="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(s.n / max) * 100}%`, background: ORANGE }} /></div>
                    <span className="text-xs font-bold text-slate-500 w-6 text-right">{s.n}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Source analytics */}
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <div className="font-extrabold text-[#050A1F] mb-3">Source analytics <span className="text-xs font-semibold text-slate-400">(hire rate)</span></div>
          {!analytics || analytics.length === 0 ? <div className="text-sm text-slate-400">No candidate data yet.</div> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[10px] uppercase tracking-wide text-slate-400"><th className="pb-2">Source</th><th className="pb-2 text-right">Total</th><th className="pb-2 text-right">Hired</th><th className="pb-2 text-right">Hire rate</th></tr></thead>
              <tbody>
                {analytics.map((s) => (
                  <tr key={s.source} className="border-t border-slate-50">
                    <td className="py-1.5 font-semibold text-slate-700">{SRC[s.source] || s.source}</td>
                    <td className="py-1.5 text-right text-slate-500">{s.total}</td>
                    <td className="py-1.5 text-right text-slate-500">{s.hired}</td>
                    <td className="py-1.5 text-right"><span className={`font-bold ${s.hireRate >= 20 ? 'text-green-600' : s.hireRate > 0 ? 'text-amber-600' : 'text-slate-400'}`}>{s.hireRate}%</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Unread email (shared recruitment inbox) — HR & admin only. Placed after the funnel/analytics. */}
      {mail && (() => {
        const newItems = [...((mail.missed) || []), ...((mail.awaiting) || [])];
        if (newItems.length === 0) return null;
        const overdueCount = (mail.missed || []).length;
        const dismiss = async (emailId) => { try { await hrApi(`/unread-mail/${encodeURIComponent(emailId)}/dismiss`, { method: 'POST' }); setMail((prev) => prev ? { ...prev, awaiting: (prev.awaiting || []).filter((x) => x.emailId !== emailId), missed: (prev.missed || []).filter((x) => x.emailId !== emailId) } : prev); } catch (e) { alert(e.message); } };
        return (
          <div className="rounded-2xl border border-blue-200 bg-white p-4">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mr-1">✉️ Unread email</span>
              <span className="rounded-full bg-blue-600 text-white px-2 py-0.5 text-[10px] font-extrabold">{newItems.length} awaiting reply</span>
              {overdueCount > 0 && <span className="rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-[10px] font-extrabold">{overdueCount} over 24h</span>}
            </div>
            <div className="space-y-1 max-h-52 overflow-auto">
              {newItems.slice(0, 12).map((i) => {
                const overdue = i.ageMs >= 24 * 3600000;
                return (
                  <div key={i.emailId} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-1.5 text-[11px] hover:bg-blue-50 group">
                    <span className="cursor-pointer" onClick={() => i.candidateId && onOpenCandidate && onOpenCandidate(i.candidateId)}>{overdue ? '⚠️' : '✉️'}</span>
                    <span className="font-bold text-[#050A1F] truncate max-w-[150px] cursor-pointer" onClick={() => i.candidateId && onOpenCandidate && onOpenCandidate(i.candidateId)}>{i.candidateName}</span>
                    <span className="text-slate-500 truncate flex-1 cursor-pointer" onClick={() => i.candidateId && onOpenCandidate && onOpenCandidate(i.candidateId)}>{i.fromName || i.fromEmail ? `${i.fromName || i.fromEmail}: ` : ''}{i.subject || i.snippet}</span>
                    {isAdmin && <span className="shrink-0 text-[10px] bg-slate-100 text-slate-500 rounded-full px-2 py-0.5">{i.ownerName}</span>}
                    <span className={`font-bold shrink-0 ${overdue ? 'text-red-600' : 'text-blue-600'}`}>{fmtAgeH(i.ageMs)}</span>
                    {isAdmin && <button title="Dismiss" onClick={(e) => { e.stopPropagation(); dismiss(i.emailId); }} className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-slate-300 hover:bg-red-100 hover:text-red-600">×</button>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* HR leaderboard — simple table (matches the CRM pre-sales team style) */}
      {board && board.rows && board.rows.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200/70 p-5">
          <div className="flex items-baseline justify-between mb-3">
            <div className="text-sm font-bold text-[#050A1F]">🏆 HR Leaderboard · this month</div>
            <div className="text-[11px] text-slate-400">Joined = accepted &amp; on Hired stage</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase text-slate-400 border-b border-slate-100">
                  <th className="text-left py-2 w-8">#</th>
                  <th className="text-left py-2">HR name</th>
                  <th className="text-right py-2">Candidates added</th>
                  <th className="text-right py-2">Interviews scheduled</th>
                  <th className="text-right py-2">Joined</th>
                  <th className="text-right py-2">Daily target</th>
                  <th className="text-right py-2">Monthly target</th>
                </tr>
              </thead>
              <tbody>
                {board.rows.map((r) => {
                  const t = r.targetInfo || {};
                  const dailyCls = t.dailyMet == null ? 'text-slate-300' : t.dailyMet ? 'text-green-600' : 'text-slate-500';
                  const joinCls = t.monthlyJoinMet == null ? 'text-slate-300' : t.monthlyJoinMet ? 'text-green-600' : 'text-slate-500';
                  return (
                    <tr key={r.id} className="border-b border-slate-50">
                      <td className="py-2"><span className={`text-xs font-extrabold ${r.rank === 1 ? 'text-[#FF4500]' : 'text-slate-300'}`}>{r.rank}</span></td>
                      <td className="py-2">
                        <span className="font-bold text-slate-600">{titleCase(r.name)}</span>
                        {r.rank === 1 && <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wide text-[#FF4500]">Leading</span>}
                      </td>
                      <td className="py-2 text-right"><span className="font-bold text-[#2563EB]">{r.added.month}</span> <span className="text-slate-300 font-normal">/ {r.added.today} today</span></td>
                      <td className="py-2 text-right"><span className="font-bold text-[#FF6A00]">{r.interviews.month}</span> <span className="text-slate-300 font-normal">/ {r.interviews.today} today</span></td>
                      <td className="py-2 text-right font-bold text-[#16A34A]">{r.joined.month}</td>
                      <td className={`py-2 text-right font-bold ${dailyCls}`}>{r.interviews.today}<span className="font-normal text-slate-300"> / {t.dailyInterviews || '—'}</span></td>
                      <td className={`py-2 text-right font-bold ${joinCls}`}>{r.joined.month}<span className="font-normal text-slate-300"> / {t.monthlyJoin || '—'}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showAnnModal && <AnnouncementModal onClose={() => setShowAnnModal(false)} onSaved={() => { setShowAnnModal(false); loadAnnouncements(); }} />}

      {missedModal && missed && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-[120] p-4 overflow-y-auto" onClick={() => setMissedModal(null)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl my-8" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="text-lg font-extrabold text-[#050A1F]">Missed commitments{missedModal.ownerId != null ? ` — ${missedModal.ownerName || ''}` : ' — everyone'}</div>
              <button onClick={() => setMissedModal(null)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
            </div>
            <div className="p-4 max-h-[60vh] overflow-auto space-y-1">
              {missed.items.filter((i) => missedModal.ownerId == null || i.ownerId === missedModal.ownerId).map((i) => (
                <div key={i.activityId} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2 text-[11px]">
                  <span className="cursor-pointer" onClick={() => { setMissedModal(null); onOpenCandidate && onOpenCandidate(i.candidateId); }}>{MISSED_ICON[i.kind] || '✅'}</span>
                  <span className="font-bold text-[#050A1F] truncate max-w-[150px]">{i.candidateName}</span>
                  <span className="text-slate-500 truncate flex-1">{i.title}</span>
                  <span className="text-slate-400 shrink-0">{i.ownerName}</span>
                  <span className="font-bold text-red-600 shrink-0">{i.hoursLate}h late</span>
                  <button title="Clear" onClick={async () => { try { await hrApi(`/missed-commitments/${i.candidateId}/dismiss`, { method: 'POST', body: JSON.stringify({ activityId: i.activityId }) }); setMissed((prev) => prev ? { ...prev, items: prev.items.filter((x) => x.activityId !== i.activityId), stillOpen: Math.max(0, prev.stillOpen - 1) } : prev); } catch {} }}
                    className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-slate-400 hover:bg-red-100 hover:text-red-600">×</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Compact target indicator for the leaderboard: label + value/target with a
// green tick when met, muted when no target is set.
function TargetChip({ label, value, target }) {
  const has = target && target > 0;
  const met = has && value >= target;
  return (
    <div className={`flex items-center justify-between rounded-md px-1.5 py-0.5 text-[9px] font-bold ${met ? 'bg-green-50 text-green-600' : has ? 'bg-slate-50 text-slate-500' : 'bg-slate-50 text-slate-300'}`}>
      <span>{label}</span>
      <span>{value}/{has ? target : '—'}{met ? ' ✓' : ''}</span>
    </div>
  );
}

function TargetBar({ label, done, target, color }) {
  const pct = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;
  const hit = done >= target && target > 0;
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 mb-0.5">
        <span className="truncate">{label}</span>
        <span style={{ color: hit ? '#16A34A' : color }}>{done}/{target}{hit ? ' ✓' : ''}</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} /></div>
    </div>
  );
}

// --- Recruitment -----------------------------------------------------------

function HrRecruitment({ isAdmin, me, intent, hrView = true }) {
  const rNav = useNavigate();
  const rLoc = useLocation();
  // Regular employees (interview panelists) see ONLY the candidate list — no Job
  // Post, no Pipeline. HR staff/admin see the full set.
  const RTABS = hrView ? ['jobs', 'candidates', 'pipeline'] : ['candidates'];
  // Tab segment sits after ".../recruitment/". Parse it relative to HR_BASE so
  // it works whether the URL is /recruitment/jobs or /hr/recruitment/jobs.
  const recruitBase = `${HR_BASE}/recruitment`;
  const urlTab = (() => { const rest = rLoc.pathname.startsWith(recruitBase) ? rLoc.pathname.slice(recruitBase.length).replace(/^\//, '') : ''; const seg = (rest.split('/')[0] || '').toLowerCase(); return RTABS.includes(seg) ? seg : null; })();
  const [tab, setTabRaw] = useState(urlTab || (hrView && intent && intent.tab ? intent.tab : (hrView ? 'jobs' : 'candidates')));
  const setTab = (t) => { setTabRaw(t); const target = `${recruitBase}/${t}`; if (rLoc.pathname !== target) rNav(target); };
  useEffect(() => { if (urlTab && urlTab !== tab) setTabRaw(urlTab); }, [urlTab]);
  // Ensure the URL reflects the initial tab (e.g. arriving via an intent).
  useEffect(() => { if (!urlTab) { const target = `${recruitBase}/${tab}`; if (rLoc.pathname !== target) rNav(target, { replace: true }); } }, []);
  // When a candidate/detail view is open inside a sub-tab, hide the tab row.
  const [detailOpen, setDetailOpen] = useState(false);
  useEffect(() => { setDetailOpen(false); }, [tab]);
  const [mode, setMode] = useState('list'); // list | choose | build
  const [builderSeed, setBuilderSeed] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [branches, setBranches] = useState([]);
  const [err, setErr] = useState('');
  const [candFilterJob, setCandFilterJob] = useState(null); // preset job filter when arriving from a job's applicant link
  const [candSourceFilter, setCandSourceFilter] = useState(''); // preset source filter (applied vs added)
  // Scope hints carried in from the dashboard cards (e.g. show all candidates,
  // or only this week's applications).
  const [candScope, setCandScope] = useState(intent && intent.candScope ? intent.candScope : null); // 'all' | 'mine' | null
  // Candidate List view: scope (My/All) plus which list (active/hired/rejected).
  const [candView, setCandView] = useState(intent && intent.candView ? intent.candView : null); // legacy, unused
  const [candList, setCandList] = useState(intent && intent.candList ? intent.candList : 'active'); // 'active' | 'hired' | 'rejected'
  const [candWeekOnly, setCandWeekOnly] = useState(!!(intent && intent.weekOnly));
  const [jobScope, setJobScope] = useState(intent && intent.jobScope ? intent.jobScope : null); // 'mine' | 'all' | null
  const tabs = hrView ? [['jobs', 'Job Post'], ['candidates', 'Candidate List'], ['pipeline', 'Pipeline']] : [['candidates', 'Candidate List']];

  const loadJobs = () => hrApi('/job-posts').then(setJobs).catch(() => {});
  useEffect(() => {
    loadJobs();
    hrApi('/departments').then(setDepartments).catch(() => {});
    hrApi('/branches').then(setBranches).catch(() => {});
  }, []);

  const startBuilder = (seed) => { setBuilderSeed(seed || null); setMode('build'); };
  const viewApplicants = (jobId, source) => { setCandFilterJob(jobId); setCandSourceFilter(source || ''); setTab('candidates'); };

  if (mode === 'build') {
    return <HrJobBuilder departments={departments} branches={branches} existing={builderSeed}
      onCancel={() => { setMode('list'); loadJobs(); }}
      onDone={() => { setMode('list'); loadJobs(); }} />;
  }

  return (
    <div>
      {!detailOpen && (
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-2xl font-extrabold text-[#050A1F]">Recruitment</h1>
          {tab === 'jobs' && <button onClick={() => startBuilder(null)} className="rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ background: ORANGE }}>+ Post a Job</button>}
        </div>
      )}
      {err && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm px-3 py-2">{err}</div>}
      {!detailOpen && (
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <div className="inline-flex items-center gap-1 bg-slate-100 rounded-lg p-1">
          {tabs.map(([id, label]) => (
            <button key={id} onClick={() => { setTab(id); if (id !== 'candidates') setCandFilterJob(null); }}
              className={`px-4 py-1.5 rounded-md text-xs font-bold ${tab === id ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>{label}</button>
          ))}
        </div>
        {/* Scope toggle sits on the right of the same row, contextual to the tab. */}
        {tab === 'jobs' && (
          <div className="inline-flex items-center gap-1 bg-slate-100 rounded-lg p-1">
            <button onClick={() => setJobScope('all')} className={`px-3 py-1.5 rounded-md text-xs font-bold ${(jobScope || (isAdmin ? 'all' : 'mine')) === 'all' ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>All jobs</button>
            <button onClick={() => setJobScope('mine')} className={`px-3 py-1.5 rounded-md text-xs font-bold ${(jobScope || (isAdmin ? 'all' : 'mine')) === 'mine' ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>My jobs</button>
          </div>
        )}
        {tab === 'candidates' && (() => {
          const scope = candScope || (isAdmin ? 'all' : 'mine');
          const list = candList || 'active';
          const Btn = (active, onClick, label) => <button onClick={onClick} className={`px-3 py-1.5 rounded-md text-xs font-bold ${active ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>{label}</button>;
          return (
            <div className="flex items-center gap-2 flex-wrap">
              <div className="inline-flex items-center gap-1 bg-slate-100 rounded-lg p-1">
                {Btn(scope === 'mine', () => setCandScope('mine'), 'My candidates')}
                {Btn(scope === 'all', () => setCandScope('all'), 'All candidates')}
              </div>
              <div className="inline-flex items-center gap-1 bg-slate-100 rounded-lg p-1">
                {Btn(list === 'active', () => setCandList('active'), 'Active')}
                {Btn(list === 'hired', () => setCandList('hired'), 'Hired')}
                {Btn(list === 'rejected', () => setCandList('rejected'), 'Rejected')}
                {Btn(list === 'blacklist', () => setCandList('blacklist'), 'Blacklist')}
              </div>
            </div>
          );
        })()}
        {tab === 'pipeline' && (
          <div className="inline-flex items-center gap-1 bg-slate-100 rounded-lg p-1">
            <button onClick={() => setCandScope('mine')} className={`px-3 py-1.5 rounded-md text-xs font-bold ${(candScope || (isAdmin ? 'all' : 'mine')) === 'mine' ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>My candidates</button>
            <button onClick={() => setCandScope('all')} className={`px-3 py-1.5 rounded-md text-xs font-bold ${(candScope || (isAdmin ? 'all' : 'mine')) === 'all' ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>All candidates</button>
          </div>
        )}
      </div>
      )}
      {tab === 'jobs' && <JobList jobs={jobs} isAdmin={isAdmin} me={me} onEdit={(j) => startBuilder(j)} reload={loadJobs} onViewApplicants={viewApplicants} scope={jobScope || (isAdmin ? 'all' : 'mine')} />}
      {tab === "candidates" && <CandidateList jobs={jobs} isAdmin={isAdmin} me={me} initialJobFilter={candFilterJob} initialSource={candSourceFilter} scope={candScope || (isAdmin ? 'all' : 'mine')} listMode={candList || 'active'} weekOnly={candWeekOnly} openCandidateId={intent && intent.openCandidateId} openCandidateTab={intent && intent.openCandidateTab} onDetailOpen={setDetailOpen} />}
      {tab === 'pipeline' && <RecruitPipeline jobs={jobs} scope={candScope || (isAdmin ? 'all' : 'mine')} onDetailOpen={setDetailOpen} />}
    </div>
  );
}

// Read a File as a base64 data URL for server-side extraction/upload.
export function fileToBase64(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}

function JobList({ jobs, isAdmin, me, onEdit, reload, onViewApplicants, scope: scopeProp }) {
  const [addFor, setAddFor] = useState(null); // job to add a candidate to
  const [shareFor, setShareFor] = useState(null); // job to share
  const [assignFor, setAssignFor] = useState(null); // job to assign HR to
  const scope = scopeProp || (isAdmin ? 'all' : 'mine'); // controlled from the tab row
  const myId = me && (me._id || me.id);
  const isMgr = !!(me && me.isHrManager);
  // Restrictive: only assigned HR (or admin / branch HR-manager) can add candidates.
  const canAddTo = (j) => {
    if (isAdmin) return true;
    const assigned = (Array.isArray(j.assignedHrIds) ? j.assignedHrIds : []).map(Number);
    if (assigned.includes(Number(myId))) return true;
    if (isMgr && (!j.branch || !me.branch || j.branch === me.branch)) return true;
    return false;
  };
  const close = async (j) => { if (!window.confirm('Close this job? Its public form will stop accepting applications.')) return; await hrApi(`/job-posts/${j._id}/close`, { method: 'POST' }); reload(); };
  const pause = async (j) => { await hrApi(`/job-posts/${j._id}/pause`, { method: 'POST' }); reload(); };
  const del = async (j) => { if (!window.confirm('Delete this job post?')) return; try { await hrApi(`/job-posts/${j._id}`, { method: 'DELETE' }); reload(); } catch (e) { alert(e.message); } };
  const statusPill = (s) => {
    if (s === 'published') return { label: 'Live', cls: 'bg-green-100 text-green-700' };
    if (s === 'paused') return { label: 'Paused', cls: 'bg-amber-100 text-amber-700' };
    if (s === 'closed') return { label: 'Closed', cls: 'bg-slate-200 text-slate-500' };
    return { label: 'Draft', cls: 'bg-slate-100 text-slate-500' };
  };
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null;
  const mineOf = (j) => (Array.isArray(j.assignedHrIds) ? j.assignedHrIds : []).map(Number).includes(Number(myId));
  const shown = scope === 'mine' ? jobs.filter(mineOf) : jobs;
  if (!jobs.length) return <div className="bg-white rounded-2xl border border-slate-200/70 p-12 text-center text-slate-400 text-sm">No job posts yet. Click “Post a Job” to create one.</div>;
  return (
    <div className="space-y-3">
      {shown.length === 0 && <div className="bg-white rounded-2xl border border-slate-200/70 p-8 text-center text-slate-400 text-sm">No jobs assigned to you yet.</div>}
      {shown.map((j) => {
        const sp = statusPill(j.status);
        const live = j.status === 'published' || j.status === 'paused';
        const published = fmtDate(j.publishedAt);
        const assigned = j.assignedHr || [];
        return (
        <div key={j._id} className="bg-white rounded-2xl border border-slate-200/70 p-4 flex items-center justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="text-base font-extrabold text-[#050A1F]">{j.title}</div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${sp.cls}`}>{sp.label}</span>
            </div>
            <div className="text-xs text-slate-500 mt-0.5">{(j.locations || []).join(' · ') || '—'} · {j.department || 'No dept'} · {j.openings || 1} opening(s)</div>
            <div className="flex items-center gap-3 text-xs text-slate-400 mt-1 flex-wrap">
              {published && <span>Published {published}</span>}
              <span className="text-slate-500">
                <button onClick={() => onViewApplicants(j._id, 'public_form')} className="font-bold text-orange-600 hover:text-orange-700 hover:underline">{(j.appliedCount || 0)} applied</button>
                <span className="text-slate-300"> · </span>
                <button onClick={() => onViewApplicants(j._id, 'manual')} className="font-bold text-blue-600 hover:text-blue-700 hover:underline">{(j.addedCount || 0)} added</button>
              </span>
              {/* Assigned HR */}
              {assigned.length > 0 ? (
                <span className="flex items-center gap-1.5">
                  <span className="text-slate-400">·</span>
                  <span className="flex -space-x-2">
                    {assigned.slice(0, 4).map((h) => (
                      <span key={h.id} title={h.name} className="w-5 h-5 rounded-full bg-slate-200 border border-white overflow-hidden flex items-center justify-center text-[9px] font-bold text-slate-600">
                        {h.avatar ? <img src={h.avatar} alt="" className="w-full h-full object-cover" /> : (h.name || '?')[0]}
                      </span>
                    ))}
                  </span>
                  <span className="text-slate-500 font-semibold">{assigned.map((h) => h.name.split(' ')[0]).slice(0, 3).join(', ')}{assigned.length > 3 ? ` +${assigned.length - 3}` : ''}</span>
                </span>
              ) : <span className="text-slate-300 italic">Unassigned</span>}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {(isAdmin || isMgr) && <JobIconBtn onClick={() => setAssignFor(j)} icon="users" label="Assign HR" />}
            {live && canAddTo(j) && <JobIconBtn primary onClick={() => setAddFor(j)} icon="user-plus" label="Add candidate" />}
            {j.status === 'published' && <JobIconBtn onClick={() => setShareFor(j)} icon="link" label="Share / embed" />}
            {(isAdmin || isMgr) && <JobIconBtn onClick={() => onEdit(j)} icon="edit" label="Edit job post" />}
            {(isAdmin || isMgr) && live && <JobIconBtn onClick={() => pause(j)} icon={j.status === 'paused' ? 'play' : 'pause'} label={j.status === 'paused' ? 'Resume job' : 'Pause job'} />}
            {(isAdmin || isMgr) && j.status !== 'closed' && <JobIconBtn onClick={() => close(j)} icon="close" label="Close job" />}
            {isAdmin && <JobIconBtn danger onClick={() => del(j)} icon="trash" label="Delete job post" />}
          </div>
        </div>
        );
      })}
      {addFor && <AddCandidateModal job={addFor} onClose={() => setAddFor(null)} onSaved={() => { setAddFor(null); reload(); }} />}
      {shareFor && <ShareJobModal job={shareFor} onClose={() => setShareFor(null)} isAdmin={isAdmin} />}
      {assignFor && <AssignHrModal job={assignFor} onClose={() => setAssignFor(null)} onSaved={() => { setAssignFor(null); reload(); }} />}
    </div>
  );
}

// Assign one or more HR/recruiters to a job post.
function AssignHrModal({ job, onClose, onSaved }) {
  const [emps, setEmps] = useState([]);
  const [sel, setSel] = useState((job.assignedHrIds || []).map(Number));
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  useEffect(() => { hrApi('/employees?hrDept=1').then((rows) => setEmps(rows || [])).catch(() => {}); }, []);
  const toggle = (id) => setSel((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  const save = async () => { setBusy(true); try { await hrApi(`/job-posts/${job._id}/assigned-hr`, { method: 'PUT', body: JSON.stringify({ assignedHrIds: sel }) }); onSaved(); } catch (e) { alert(e.message); setBusy(false); } };
  const filtered = emps.filter((e) => !q || e.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div><div className="text-lg font-extrabold text-[#050A1F]">Assign HR</div><div className="text-xs text-slate-400">{job.title}</div></div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        <div className="p-4">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search HR / recruiters…" className={inputCls + ' mb-3'} />
          <div className="max-h-72 overflow-auto space-y-1">
            {filtered.length === 0 && <div className="text-sm text-slate-400 py-4 text-center">No HR staff found.</div>}
            {filtered.map((e) => (
              <label key={e._id} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-slate-50 cursor-pointer">
                <input type="checkbox" checked={sel.includes(e._id)} onChange={() => toggle(e._id)} />
                <Avatar name={e.name} src={e.avatar} size={28} />
                <div className="min-w-0"><div className="text-sm font-bold text-[#050A1F] truncate">{e.name}</div><div className="text-[11px] text-slate-400">{ROLE_LABELS[e.type] || e.type}{e.department ? ` · ${e.department}` : ''}</div></div>
              </label>
            ))}
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
          <span className="text-xs text-slate-400">{sel.length} selected</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
            <button onClick={save} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Small icon button with a tooltip, matching the CRM's action-button style.
function JobIconBtn({ icon, label, onClick, primary, danger }) {
  const paths = {
    'user-plus': 'M15 14c-2.7 0-8 1.3-8 4v2h10m-2-14a4 4 0 11-8 0 4 4 0 018 0M19 8v6M22 11h-6',
    link: 'M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1',
    edit: 'M11 4H4v16h16v-7M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4z',
    pause: 'M10 4H6v16h4zM18 4h-4v16h4z',
    play: 'M8 5v14l11-7z',
    close: 'M18 6L6 18M6 6l12 12',
    trash: 'M3 6h18M8 6V4h8v2m-9 0v14h10V6',
    users: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
  };
  const base = 'inline-flex items-center justify-center w-8 h-8 rounded-lg border transition';
  const cls = primary ? 'bg-orange-500 border-orange-500 text-white hover:bg-orange-600'
    : danger ? 'border-red-200 text-red-500 hover:bg-red-50'
    : 'border-slate-300 text-slate-500 hover:bg-slate-50';
  return (
    <button onClick={onClick} title={label} aria-label={label} className={`${base} ${cls}`}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={paths[icon]} /></svg>
    </button>
  );
}

// Share modal: full listing-page URL and form-only embed URL, both absolute.
// Form URL and embed code are admin-only; HR staff just get the listing link.
function ShareJobModal({ job, onClose, isAdmin }) {
  const [base, setBase] = useState('');
  const [slug, setSlug] = useState(job.slug || '');
  useEffect(() => {
    // The public links live on the careers domain (career.qtonix.com), not the
    // HRMS domain the admin is viewing from. Fetch it, and make sure the job has
    // a clean slug for a pretty URL.
    hrApi('/settings').then((r) => setBase((r.careersDomain || window.location.origin).replace(/\/$/, ''))).catch(() => setBase(window.location.origin));
    if (!job.slug) { hrApi(`/jobs/${job.id}/slug`).then((r) => setSlug(r.slug || job.publicToken)).catch(() => setSlug(job.publicToken)); }
  }, [job.id]);
  const idPart = slug || job.slug || job.publicToken;
  const listingUrl = base ? `${base}/jobs/${idPart}` : '';
  const embedUrl = base ? `${base}/careers/${job.publicToken}/embed` : '';
  const iframe = `<iframe src="${embedUrl}" width="100%" height="900" frameborder="0"></iframe>`;
  const [copied, setCopied] = useState('');
  const copy = (text, which) => { navigator.clipboard?.writeText(text); setCopied(which); setTimeout(() => setCopied(''), 1500); };
  const Field = ({ title, note, value, which }) => (
    <div className="mb-4">
      <div className="text-sm font-bold text-[#050A1F]">{title}</div>
      <div className="text-xs text-slate-500 mb-1.5">{note}</div>
      <div className="flex gap-2">
        <input readOnly value={value} className="flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-600" onFocus={(e) => e.target.select()} />
        <button onClick={() => copy(value, which)} className="rounded-lg px-3 py-2 text-xs font-bold text-white shrink-0" style={{ background: ORANGE }}>{copied === which ? 'Copied!' : 'Copy'}</button>
      </div>
    </div>
  );
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[120] p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="text-lg font-extrabold text-[#050A1F]">Share “{job.title}”</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
        </div>
        <Field title="Listing page URL" note="Public page with the full job post and the application form on the right." value={listingUrl} which="listing" />
        {isAdmin && <Field title="Form URL" note="The application form on its own." value={embedUrl} which="form" />}
        {isAdmin && <Field title="Embed code" note="Paste this into your website to embed the form." value={iframe} which="iframe" />}
      </div>
    </div>
  );
}
// Total years of experience, derived from the candidate's work history if
// present, else from the "experience" answer, else blank.
function totalExperience(c) {
  const a = c.answers || {};
  const work = a.work || [];
  if (work.length) {
    let months = 0;
    for (const w of work) {
      const s = parseYearMonth(w.start); const e = w.current ? new Date() : parseYearMonth(w.end);
      if (s && e) months += Math.max(0, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()));
    }
    if (months > 0) { const y = Math.floor(months / 12); const m = months % 12; return `${y}y${m ? ` ${m}m` : ''}`; }
  }
  if (a.experience) return String(a.experience);
  return '—';
}
function parseYearMonth(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/(\d{1,2})[\/\-](\d{4})/); if (m) return new Date(Number(m[2]), Number(m[1]) - 1, 1);
  m = s.match(/(\d{4})[\/\-](\d{1,2})/); if (m) return new Date(Number(m[1]), Number(m[2]) - 1, 1);
  m = s.match(/(\d{4})/); if (m) return new Date(Number(m[1]), 0, 1);
  const d = new Date(s); return isNaN(d) ? null : d;
}
function timeAgo(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000); if (mins < 1) return 'just now'; if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60); if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24); if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// AI-generated summary of why candidates were rejected (top reasons + fixes).
function RejectionSummary({ count, filters }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const run = async () => {
    setBusy(true); setMsg('');
    try {
      const r = await hrApi('/candidates/rejection-summary', { method: 'POST', body: JSON.stringify({ jobPostId: filters.job || undefined, department: filters.dept || undefined, hrId: filters.hr || undefined, monthOnly: !!filters.monthOnly }) });
      if (r.summary) setData(r.summary); else setMsg(r.message || 'No summary available.');
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="mb-4 rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-extrabold text-[#050A1F]">✨ AI rejection analysis</div>
          <div className="text-xs text-slate-500">Clusters the rejection reasons across {count} candidate{count === 1 ? '' : 's'} (current filters) and suggests improvements.</div>
        </div>
        <button onClick={run} disabled={busy || count === 0} className="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50 shrink-0" style={{ background: '#050A1F' }}>{busy ? 'Analysing…' : (data ? 'Regenerate' : 'Generate summary')}</button>
      </div>
      {msg && <div className="mt-3 text-sm text-slate-500">{msg}</div>}
      {data && (
        <div className="mt-4 space-y-4">
          {data.overview && <div className="rounded-xl bg-white border border-slate-100 p-4 text-sm text-slate-700">{data.overview}</div>}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-xl bg-white border border-slate-100 p-4">
              <div className="text-xs font-extrabold uppercase tracking-wide text-slate-400 mb-2">Top 5 reasons</div>
              <ol className="space-y-2">
                {(data.topReasons || []).slice(0, 5).map((r, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <span className="font-extrabold text-red-500 shrink-0">{i + 1}.</span>
                    <span><b className="text-[#050A1F]">{r.reason}</b>{r.count ? <span className="text-slate-400"> · {r.count}</span> : ''}{r.detail && <div className="text-xs text-slate-500 mt-0.5">{r.detail}</div>}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="rounded-xl bg-white border border-slate-100 p-4">
              <div className="text-xs font-extrabold uppercase tracking-wide text-slate-400 mb-2">Suggestions to improve</div>
              <ul className="space-y-1.5">
                {(data.suggestions || []).map((s, i) => <li key={i} className="text-sm text-slate-600 flex gap-2"><span className="text-green-500">✔</span>{s}</li>)}
              </ul>
            </div>
          </div>
          {(data.byPosition || []).length > 0 && (
            <div className="rounded-xl bg-white border border-slate-100 p-4">
              <div className="text-xs font-extrabold uppercase tracking-wide text-slate-400 mb-2">By position</div>
              <div className="space-y-1">
                {data.byPosition.map((p, i) => (
                  <div key={i} className="flex items-center justify-between text-sm border-b border-slate-50 py-1 last:border-0">
                    <span className="font-semibold text-slate-700">{p.position}</span>
                    <span className="text-slate-400 text-xs">{p.count ? `${p.count} · ` : ''}{p.topReason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CandidateList({ jobs, isAdmin, me, initialJobFilter, initialSource, scope, listMode, weekOnly, openCandidateId, openCandidateTab, onDetailOpen }) {
  const [cands, setCands] = useState([]);
  const [viewId, setViewId] = useState(null);
  const [viewTab, setViewTab] = useState(null);
  useEffect(() => { if (onDetailOpen) onDetailOpen(!!viewId); }, [viewId]);
  const [notesFor, setNotesFor] = useState(null);
  const [sel, setSel] = useState([]); // selected candidate ids for bulk actions
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [bulkModal, setBulkModal] = useState(null); // 'move' | 'reject' | 'assign'
  const [q, setQ] = useState('');
  const [jobFilter, setJobFilter] = useState(initialJobFilter || '');
  const [stageFilter, setStageFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState(initialSource || '');
  const [tagFilter, setTagFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [hrFilter, setHrFilter] = useState('');
  const [monthOnly, setMonthOnly] = useState(false); // "This month" for hired/rejected views
  const [rejReason, setRejReason] = useState(null); // candidate whose rejection reason is shown
  const [hiredOfferFor, setHiredOfferFor] = useState(null); // candidate whose hired offer is being set
  const [notJoinedFor, setNotJoinedFor] = useState(null); // hired candidate who didn't join
  const [manageHireFor, setManageHireFor] = useState(null); // hired candidate whose hire is being managed
  const [onbFor, setOnbFor] = useState(null); // hired candidate whose onboarding panel is open
  const [hrList, setHrList] = useState([]); // HR-department staff for the HR filter
  useEffect(() => { hrApi('/employees?hrDept=1').then((r) => setHrList(r || [])).catch(() => {}); }, []);
  const [weekFilter, setWeekFilter] = useState(!!weekOnly); // only applications added this week
  const curView = listMode || 'active';
  const isHiredView = listMode === 'hired';
  const isRejectedView = listMode === 'rejected';
  const isBlacklistView = listMode === 'blacklist';
  const myId = me && (me._id || me.id);
  const mineOnly = (scope || (isAdmin ? 'all' : 'mine')) === 'mine';
  const isMineCand = (c) => myId && (Number(c.recruiterId) === Number(myId) || (me && me.name && c.recruiterName === me.name));
  const isThisWeek = (c) => { if (!c.createdAt) return false; const d = new Date(c.createdAt); const now = new Date(); const start = new Date(now); const day = (now.getDay() + 6) % 7; start.setDate(now.getDate() - day); start.setHours(0, 0, 0, 0); return d >= start; };
  const isThisMonth = (c) => { const iso = c.rejectedAt || c.updatedAt || c.createdAt; if (!iso) return false; const d = new Date(iso); const now = new Date(); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth(); };
  // Keyword search runs server-side; the view decides which server list to pull.
  const [loading, setLoading] = useState(false);
  const load = (kw) => {
    const params = new URLSearchParams();
    if (kw && kw.trim()) params.set('q', kw.trim());
    if (isHiredView) params.set('hired', 'only');
    if (isRejectedView) params.set('rejected', 'only');
    if (isBlacklistView) params.set('blacklist', 'only');
    const qs = params.toString() ? `?${params.toString()}` : '';
    setLoading(true);
    return hrApi(`/candidates${qs}`).then(setCands).catch(() => {}).finally(() => setLoading(false));
  };
  // Clear the current rows the moment the view changes so the previous list
  // (e.g. Active) never flashes under a different tab (e.g. Hired) while the new
  // data loads.
  useEffect(() => { setCands([]); load(); }, [curView]);
  useEffect(() => { const t = setTimeout(() => load(q), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { if (initialJobFilter) setJobFilter(initialJobFilter); }, [initialJobFilter]);
  useEffect(() => { setSourceFilter(initialSource || ''); }, [initialSource]);
  const job = (id) => jobs.find((j) => j._id === id) || {};
  // Map every stage id → {label,color} across ALL jobs, plus the built-in
  // defaults, so a candidate whose own job no longer lists the stage (deleted /
  // reassigned) still resolves to a proper name instead of a raw "st_..." id.
  const globalStageMap = (() => {
    const m = {
      applied: { label: 'Applied', color: '#2563EB' },
      screening: { label: 'Screening', color: '#0891B2' },
      interview: { label: 'Interview', color: '#F5A524' },
      hired: { label: 'Hired', color: '#16A34A' },
      onboarded: { label: 'Onboarded', color: '#16A34A' },
      rejected: { label: 'Rejected', color: '#DC2626' },
    };
    jobs.forEach((j) => (j.stages || []).forEach((s) => { if (s && s.id) m[s.id] = { label: s.label, color: s.color || '#64748B' }; }));
    return m;
  })();
  const prettifyStageId = (id) => {
    const raw = String(id || '').trim();
    if (!raw) return 'In review';
    // A raw custom-stage id like "st_1787050931044" has no human label — show a
    // neutral fallback rather than the internal id.
    if (/^st_\d+/i.test(raw) || /^stage[_-]?\d+/i.test(raw)) return 'In review';
    return raw.replace(/[_-]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
  };
  const stageLabel = (c) => {
    if (c.blacklisted) return { label: 'Blacklisted', color: '#111827' };
    if (c.rejected) return { label: 'Rejected', color: '#DC2626' };
    if (c.cold) return { label: 'Cold', color: '#0891B2' };
    const own = ((job(c.jobPostId).stages) || []).find((s) => s.id === c.stage);
    if (own) return { label: own.label, color: own.color || '#64748B' };
    const g = globalStageMap[c.stage];
    if (g) return g;
    return { label: prettifyStageId(c.stage), color: '#64748B' };
  };

  useEffect(() => { if (openCandidateId) { setViewId(openCandidateId); setViewTab(openCandidateTab || null); } }, [openCandidateId, openCandidateTab]);
  if (viewId) return <HrCandidateView candidateId={viewId} isAdmin={isAdmin} initialTab={viewTab} onBack={() => { setViewId(null); setViewTab(null); load(q); }} onDeleted={() => { setViewId(null); setViewTab(null); load(q); }} />;

  // All stages across jobs, de-duplicated, for the stage filter.
  const allStages = []; const seen = new Set();
  jobs.forEach((j) => (j.stages || []).forEach((s) => { if (!seen.has(s.id)) { seen.add(s.id); allStages.push(s); } }));
  const allTags = Array.from(new Set(cands.flatMap((c) => c.tags || []))).sort();

  const filtered = cands.filter((c) => {
    if (mineOnly && !isMineCand(c)) return false;
    if (weekFilter && !isThisWeek(c)) return false;
    if (monthOnly && !isThisMonth(c)) return false;
    if (jobFilter && c.jobPostId !== Number(jobFilter)) return false;
    if (stageFilter && (stageFilter === 'rejected' ? !c.rejected : c.stage !== stageFilter)) return false;
    if (sourceFilter) {
      // Public applications may be stored as 'public_form' or the legacy
      // 'careers_page' — treat them the same. 'manual' means anything not public.
      const publicSources = new Set(['public_form', 'careers_page']);
      const isPublic = publicSources.has(c.source);
      if (sourceFilter === 'public_form' && !isPublic) return false;
      if (sourceFilter === 'manual' && isPublic) return false;
      if (sourceFilter !== 'public_form' && sourceFilter !== 'manual' && c.source !== sourceFilter) return false;
    }
    if (tagFilter && !(c.tags || []).includes(tagFilter)) return false;
    if (deptFilter && (job(c.jobPostId).department || '') !== deptFilter) return false;
    if (hrFilter && String(c.recruiterId || '') !== String(hrFilter)) return false;
    return true;
  });

  // In the Hired view, order by soonest upcoming joining date first; hired
  // candidates without a joining date go to the end.
  if (isHiredView) {
    const jkey = (c) => {
      const v = c.offer && c.offer.joiningDate; if (!v) return '';
      const s = String(v); let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
      m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
      if (m) { let a = Number(m[1]), b = Number(m[2]); const y = m[3]; let d, mo; if (a > 12) { d = a; mo = b; } else if (b > 12) { mo = a; d = b; } else { d = a; mo = b; } return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
      const dd = new Date(s); return isNaN(dd.getTime()) ? '' : dd.toISOString().slice(0, 10);
    };
    filtered.sort((a, b) => { const ax = jkey(a), bx = jkey(b); if (ax && bx) return ax.localeCompare(bx); if (ax) return -1; if (bx) return 1; return 0; });
  }

  // Client-side pagination (mirrors the CRM lead list).
  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const curPage = Math.min(page, pages);
  const paged = filtered.slice((curPage - 1) * perPage, curPage * perPage);

  const toggleSel = (id) => setSel((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  const allShownSelected = paged.length > 0 && paged.every((c) => sel.includes(c._id));
  const toggleAll = () => setSel(allShownSelected ? sel.filter((id) => !paged.some((c) => c._id === id)) : Array.from(new Set([...sel, ...paged.map((c) => c._id)])));
  const delCandidate = async (id) => { if (!window.confirm('Delete this candidate permanently?')) return; try { await hrApi(`/candidates/${id}`, { method: 'DELETE' }); setSel((s) => s.filter((x) => x !== id)); load(q); } catch (e) { alert(e.message); } };

  const F = 'rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white';
  return (
    <div>
      {/* AI summary of rejections */}
      {isRejectedView && <RejectionSummary count={filtered.length} filters={{ dept: deptFilter, job: jobFilter, hr: hrFilter, monthOnly }} />}

      {/* Filters */}
      <div className={`flex items-center gap-2 mb-4 ${(isHiredView || isRejectedView) ? 'flex-nowrap overflow-x-auto pb-1' : 'flex-wrap'}`}>
        {!isHiredView && !isRejectedView && <button onClick={() => setWeekFilter((v) => !v)} className={`px-3 py-1.5 rounded-lg text-xs font-bold border shrink-0 ${weekFilter ? 'border-orange-400 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-500'}`}>This week</button>}
        {(isHiredView || isRejectedView) && <button onClick={() => setMonthOnly((v) => !v)} className={`px-3 py-1.5 rounded-lg text-xs font-bold border shrink-0 ${monthOnly ? 'border-orange-400 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-500'}`}>This month</button>}
        <input className={F + ((isHiredView || isRejectedView) ? ' shrink min-w-[140px]' : ' flex-1 min-w-[200px]')} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, skills…" />
        <select className={F + ' shrink-0'} value={jobFilter} onChange={(e) => setJobFilter(e.target.value)}>
          <option value="">All positions</option>
          {jobs.map((j) => <option key={j._id} value={j._id}>{j.title}</option>)}
        </select>
        {(isHiredView || isRejectedView) && (
          <select className={F + ' shrink-0'} value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
            <option value="">All departments</option>
            {Array.from(new Set(jobs.map((j) => j.department).filter(Boolean))).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        {!isHiredView && !isRejectedView && (
          <select className={F + ' shrink-0'} value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
            <option value="">All stages</option>
            {allStages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            {!allStages.some((s) => String(s.id).toLowerCase() === 'rejected') && <option value="rejected">Rejected</option>}
          </select>
        )}
        <select className={F + ' shrink-0'} value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
          <option value="">All sources</option>
          <option value="manual">Manual</option>
          <option value="public_form">Application form</option>
        </select>
        {(isHiredView || isRejectedView) && (
          <select className={F + ' shrink-0'} value={hrFilter} onChange={(e) => setHrFilter(e.target.value)}>
            <option value="">All HR</option>
            {hrList.map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
          </select>
        )}
        {allTags.length > 0 && !isHiredView && !isRejectedView && (
          <select className={F + ' shrink-0'} value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
            <option value="">All tags</option>
            {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        {(q || jobFilter || stageFilter || sourceFilter || tagFilter || deptFilter || hrFilter || monthOnly) && <button onClick={() => { setQ(''); setJobFilter(''); setStageFilter(''); setSourceFilter(''); setTagFilter(''); setDeptFilter(''); setHrFilter(''); setMonthOnly(false); }} className="text-xs font-bold text-slate-400 hover:text-slate-600 shrink-0">Clear</button>}
      </div>

      {/* Bulk action bar */}
      {sel.length > 0 && (
        <div className="flex items-center gap-2 mb-3 rounded-xl bg-[#050A1F] text-white px-4 py-2.5">
          <span className="text-sm font-bold">{sel.length} selected</span>
          <div className="flex-1" />
          <button onClick={() => setBulkModal('move')} className="rounded-lg bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs font-bold">Move stage</button>
          {(isAdmin || (me && me.isHrManager)) && <button onClick={() => setBulkModal('assign')} className="rounded-lg bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs font-bold">Assign recruiter</button>}
          <button onClick={() => setBulkModal('reject')} className="rounded-lg bg-red-500/80 hover:bg-red-500 px-3 py-1.5 text-xs font-bold">Reject</button>
          <button onClick={() => setSel([])} className="rounded-lg px-3 py-1.5 text-xs font-bold text-slate-300 hover:text-white">Clear</button>
        </div>
      )}

      {!filtered.length ? (
        <div className="bg-white rounded-2xl border border-slate-200/70 p-12 text-center text-slate-400 text-sm">{cands.length ? 'No candidates match these filters.' : 'No candidates yet.'}</div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-[10px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <th className="px-2.5 py-2.5"><input type="checkbox" checked={allShownSelected} onChange={toggleAll} /></th>
                <th className="px-2.5 py-2.5">Candidate</th><th className="px-2.5 py-2.5">Phone</th><th className="px-2.5 py-2.5">Position</th>
                <th className="px-2.5 py-2.5">Exp</th><th className="px-2.5 py-2.5">Match</th><th className="px-2.5 py-2.5">Status</th>
                {isHiredView && <th className="px-2.5 py-2.5">Hired at</th>}
                {isHiredView && <th className="px-2.5 py-2.5">Joining</th>}
                <th className="px-2.5 py-2.5">Recruiter</th><th className="px-2.5 py-2.5">Updated</th><th className="px-2.5 py-2.5 text-right">Actions</th>
              </tr></thead>
              <tbody>
                {loading && cands.length === 0 && (
                  <tr><td colSpan={isHiredView ? 11 : 9} className="px-4 py-10 text-center text-sm text-slate-400">Loading…</td></tr>
                )}
                {!loading && paged.length === 0 && (
                  <tr><td colSpan={isHiredView ? 11 : 9} className="px-4 py-10 text-center text-sm text-slate-400">{isHiredView ? 'No hired candidates yet.' : 'No candidates found.'}</td></tr>
                )}
                {paged.map((c) => {
                  const a = c.answers || {}; const st = stageLabel(c);
                  return (
                    <tr key={c._id} className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="px-2.5 py-2"><input type="checkbox" checked={sel.includes(c._id)} onChange={() => toggleSel(c._id)} /></td>
                      <td className="px-2.5 py-2">
                        <button onClick={() => setViewId(c._id)} className="text-left">
                          <div className="font-semibold text-slate-700 hover:text-orange-600 whitespace-nowrap">{titleCase(c.name)}</div>
                        </button>
                        {(c.rating > 0 || (c.tags || []).length > 0) && (
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {c.rating > 0 && <span className="text-amber-400 text-[10px]">{'★'.repeat(c.rating)}<span className="text-slate-200">{'★'.repeat(5 - c.rating)}</span></span>}
                            {(c.tags || []).slice(0, 2).map((t) => <span key={t} className="rounded-full bg-slate-100 text-slate-500 px-1.5 py-0.5 text-[9px] font-semibold">{t}</span>)}
                          </div>
                        )}
                      </td>
                      <td className="px-2.5 py-2 text-slate-500 whitespace-nowrap">{formatPhone(c.phone)}</td>
                      <td className="px-2.5 py-2 text-slate-500 whitespace-nowrap" title={job(c.jobPostId).title || ''}>{shortTitle(job(c.jobPostId).title)}</td>
                      <td className="px-2.5 py-2 text-slate-500 whitespace-nowrap">{totalExperience(c)}</td>
                      <td className="px-2.5 py-2"><ResumeMatchBadge match={c.resumeMatch} /></td>
                      <td className="px-2.5 py-2"><span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap" style={{ background: st.color + '18', color: st.color }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: st.color }} />{st.label}</span></td>
                      {isHiredView && <td className="px-2.5 py-2 whitespace-nowrap">{(c.offer && (c.offer.acceptedAmount || c.offer.finalCtc)) ? <span className="font-bold text-green-700">{c.offer.acceptedAmount || c.offer.finalCtc}</span> : <button onClick={() => setHiredOfferFor(c)} className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-bold text-slate-500 hover:bg-slate-50">+ Set offer</button>}</td>}
                      {isHiredView && <td className="px-2.5 py-2 whitespace-nowrap">
                        {c.offer && c.offer.notJoined
                          ? <span className="inline-flex items-center gap-1 rounded-full bg-red-50 text-red-600 px-2 py-0.5 text-[11px] font-bold" title={c.offer.notJoinedReason || ''}>✗ Did not join</span>
                          : <span className="text-slate-600">{(c.offer && c.offer.joiningDate) ? new Date(c.offer.joiningDate).toLocaleDateString() : '—'}</span>}
                      </td>}
                      <td className="px-2.5 py-2 text-slate-500 whitespace-nowrap">{titleCase((c.recruiterName || '—').split(' ')[0])}</td>
                      <td className="px-2.5 py-2 text-slate-400 text-[11px] whitespace-nowrap">{timeAgo(c.updatedAt)}</td>
                      <td className="px-2.5 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <CandIconBtn icon="eye" label="View candidate" onClick={() => setViewId(c._id)} />
                          {isRejectedView && <CandIconBtn icon="info" label="Rejection reason" onClick={() => setRejReason(c)} />}
                          {isHiredView
                            ? <><CandIconBtn icon="edit" label="Manage hire (salary, joining, joined status)" onClick={() => setManageHireFor(c)} /></>
                            : <CandIconBtn icon="note" label="Add note" onClick={() => setNotesFor(c._id)} />}
                          {isAdmin && <CandIconBtn icon="trash" label="Delete candidate" onClick={() => delCandidate(c._id)} />}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 pb-3">
            <Pagination page={curPage} pages={pages} total={filtered.length} perPage={perPage} onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} label="candidates" />
          </div>
        </div>
      )}
      {notesFor && <QuickNoteModal candidateId={notesFor} onClose={() => setNotesFor(null)} onSaved={() => { setNotesFor(null); load(q); }} />}
      {rejReason && <RejReasonModal candidate={rejReason} jobTitle={job(rejReason.jobPostId).title} onClose={() => setRejReason(null)} onSaved={() => { setRejReason(null); load(q); }} />}
      {hiredOfferFor && <HiredOfferModal candidate={hiredOfferFor} onClose={() => setHiredOfferFor(null)} onSaved={() => { setHiredOfferFor(null); load(q); }} />}
      {notJoinedFor && <NotJoinedModal candidate={notJoinedFor} onClose={() => setNotJoinedFor(null)} onSaved={() => { setNotJoinedFor(null); load(q); }} />}
      {manageHireFor && <ManageHireModal candidate={manageHireFor} onClose={() => setManageHireFor(null)} onSaved={() => { setManageHireFor(null); load(q); }} />}
      {bulkModal && <BulkActionModal action={bulkModal} ids={sel} jobs={jobs} stages={allStages} onClose={() => setBulkModal(null)} onDone={() => { setBulkModal(null); setSel([]); load(q); }} />}
    </div>
  );
}

// Shows a candidate's rejection reason; if none was recorded, lets HR enter one.
function RejReasonModal({ candidate, jobTitle, onClose, onSaved }) {
  const [editing, setEditing] = useState(!candidate.rejectionReason);
  const [reason, setReason] = useState(candidate.rejectionReason || '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!reason.trim()) return;
    setBusy(true);
    try { await hrApi(`/candidates/${candidate._id}/reject`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) }); onSaved(); }
    catch (e) { alert(e.message); setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[120] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between"><div className="text-lg font-extrabold text-[#050A1F]">Rejection reason</div><button onClick={onClose} className="text-slate-400 text-xl leading-none">×</button></div>
        <div className="p-6">
          <div className="text-sm font-bold text-[#050A1F] mb-1">{titleCase(candidate.name)}</div>
          <div className="text-xs text-slate-400 mb-3">{jobTitle || '—'}{candidate.rejectedAt ? ` · ${new Date(candidate.rejectedAt).toLocaleDateString()}` : ''}</div>
          {editing ? (
            <textarea autoFocus rows={4} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Enter the reason this candidate was rejected…" />
          ) : (
            <div className="rounded-lg bg-red-50 border border-red-100 p-3 text-sm text-slate-700 whitespace-pre-wrap">{candidate.rejectionReason}</div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          {editing ? (
            <>
              <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
              <button onClick={save} disabled={busy || !reason.trim()} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : 'Save reason'}</button>
            </>
          ) : (
            <button onClick={() => setEditing(true)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Edit reason</button>
          )}
        </div>
      </div>
    </div>
  );
}

// Lets HR record the salary details for an already-hired candidate whose offer
// was never logged (candidate ask, what we offered, remark). Stored on the offer.
// Manage a hired candidate: edit accepted salary, joining date, and whether
// they joined or didn't. Replaces the standalone "Didn't join" button.
function ManageHireModal({ candidate, onClose, onSaved }) {
  const o = candidate.offer || {};
  const [salary, setSalary] = useState(o.acceptedAmount || o.finalCtc || '');
  // Normalise whatever is stored (ISO, DD/MM/YYYY, timestamp) into yyyy-mm-dd so
  // the date input can actually display and edit it. A raw "2/9/2026" would
  // otherwise leave the field blank and un-editable.
  const toIso = (v) => {
    if (!v) return '';
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (m) { let a = Number(m[1]), b = Number(m[2]); const y = m[3]; let d, mo; if (a > 12) { d = a; mo = b; } else if (b > 12) { mo = a; d = b; } else { d = a; mo = b; } return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
    const dd = new Date(s); if (!isNaN(dd.getTime())) return dd.toISOString().slice(0, 10); return '';
  };
  const origDate = toIso(o.joiningDate);
  const [joiningDate, setJoiningDate] = useState(origDate);
  const [joiningTime, setJoiningTime] = useState(o.joiningTime || '09:30');
  // Joined status is only decided on/after the joining day. Toggleable: clicking
  // an active choice clears it back to "not decided" (fixes the old bug).
  const [joined, setJoined] = useState(o.notJoined === true ? 'no' : (o.joinedConfirmed ? 'yes' : ''));
  const [reason, setReason] = useState(o.notJoinedReason || '');
  const [changeReason, setChangeReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // IST "today" (yyyy-mm-dd) to decide whether the joining day has arrived.
  const istToday = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const joiningDayArrived = joiningDate && joiningDate <= istToday;
  const dateChanged = origDate && joiningDate && joiningDate !== origDate;
  const toggleJoined = (v) => { setJoined((cur) => (cur === v ? '' : v)); setErr(''); };

  const cleared = origDate && !joiningDate; // date existed and HR removed it
  const save = async () => {
    if (!joiningDate && !cleared) { setErr('Please set a joining date (or use “Clear joining date” to remove it).'); return; }
    if (dateChanged && !changeReason.trim()) { setErr('You changed the joining date — please add a reason (e.g. candidate requested to postpone).'); return; }
    if (joined === 'no' && !reason.trim()) { setErr('Please enter a reason for not joining.'); return; }
    setBusy(true); setErr('');
    try {
      await hrApi(`/candidates/${candidate._id}/offer`, { method: 'POST', body: JSON.stringify({
        op: 'manage_hire',
        acceptedAmount: salary.trim(),
        joiningDate: joiningDate || '',
        joiningTime: joiningDate ? (joiningTime || '') : '',
        joinedConfirmed: joined === 'yes',
        notJoined: joined === 'no',
        notJoinedReason: joined === 'no' ? reason.trim() : '',
        changeReason: dateChanged ? changeReason.trim() : (cleared ? 'Joining date removed' : ''),
      }) });
      onSaved();
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[120] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between"><div className="text-lg font-extrabold text-[#050A1F]">Manage hire — {titleCase(candidate.name)}</div><button onClick={onClose} className="text-slate-400 text-xl leading-none">×</button></div>
        <div className="p-6 space-y-3">
          {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{err}</div>}
          <div><div className="text-[12px] font-bold text-slate-600 mb-1">Accepted salary</div><input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="e.g. 8L" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><div className="text-[12px] font-bold text-slate-600 mb-1">Joining date</div><input type="date" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} /></div>
            <div><div className="text-[12px] font-bold text-slate-600 mb-1">Joining time</div><input type="time" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={joiningTime} onChange={(e) => setJoiningTime(e.target.value)} disabled={!joiningDate} /></div>
          </div>
          {joiningDate && <button onClick={() => { setJoiningDate(''); setJoiningTime('09:30'); setJoined(''); }} className="text-[11px] font-bold text-red-500 hover:text-red-600">Clear joining date</button>}
          {cleared && <div className="text-[11px] text-amber-600">The joining date will be removed. You can set a fresh date now, or save to clear it and re-add later.</div>}
          {!origDate && <div className="text-[11px] text-slate-400">Setting the joining date starts the onboarding process — the candidate gets their document page and welcome email 7 days before joining.</div>}
          {dateChanged && (
            <div>
              <div className="text-[12px] font-bold text-slate-600 mb-1">Reason for changing the joining date <span className="text-red-500">*</span></div>
              <textarea rows={2} className="w-full rounded-lg border border-amber-300 bg-amber-50/40 px-3 py-2 text-sm" value={changeReason} onChange={(e) => setChangeReason(e.target.value)} placeholder="e.g. candidate requested to postpone by a week" />
              <div className="text-[11px] text-amber-600 mt-1">Changing the date re-schedules all onboarding reminders.</div>
            </div>
          )}
          {joiningDayArrived ? (
            <div>
              <div className="text-[12px] font-bold text-slate-600 mb-1">Joining status <span className="text-slate-400 font-normal">— it's the joining day</span></div>
              <div className="flex gap-2">
                <button onClick={() => toggleJoined('yes')} className={`flex-1 rounded-lg border px-3 py-2 text-sm font-bold ${joined === 'yes' ? 'border-green-400 bg-green-50 text-green-700' : 'border-slate-200 text-slate-500'}`}>✓ Joined</button>
                <button onClick={() => toggleJoined('no')} className={`flex-1 rounded-lg border px-3 py-2 text-sm font-bold ${joined === 'no' ? 'border-red-400 bg-red-50 text-red-600' : 'border-slate-200 text-slate-500'}`}>✗ Didn't join</button>
              </div>
              {joined ? <button onClick={() => setJoined('')} className="text-[11px] text-slate-400 mt-1.5 hover:text-slate-600">Clear selection</button> : <div className="text-[11px] text-slate-400 mt-1.5">Tap a choice — tap again to clear.</div>}
            </div>
          ) : (
            <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-[12px] text-slate-500">Joined / didn't-join can be confirmed on the joining day{joiningDate ? ` (${new Date(joiningDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })})` : ''}.</div>
          )}
          {joined === 'no' && <div>
            <div className="text-[12px] font-bold text-slate-600 mb-1">Reason</div>
            <textarea rows={2} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. accepted another offer, no-show…" />
            <div className="text-[11px] text-amber-600 mt-1.5 font-semibold">This candidate will be moved to the Blacklist.</div>
          </div>}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// The HR onboarding panel for a hired candidate: their submitted documents +
// the phased HR checklist, the public onboarding link, and the action to create
// the employee record in HRMS once documents are in.
// Core HR → Onboarding: a central list of every candidate currently in
// onboarding, each opening the full onboarding panel.
function OnboardingListPage({ isAdmin, onOpenCandidate }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [openFor, setOpenFor] = useState(null);
  const [diag, setDiag] = useState(null);
  const [showDiag, setShowDiag] = useState(false);
  const load = () => hrApi('/onboarding').then((r) => setRows(r.candidates || [])).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const runDiag = () => { setShowDiag(true); hrApi('/onboarding/debug').then(setDiag).catch((e) => setErr(e.message)); };

  const daysTo = (d) => { try { const ist = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10); return Math.round((new Date(d + 'T00:00:00') - new Date(ist + 'T00:00:00')) / 86400000); } catch { return null; } };
  const fmt = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return d; } };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-2.5 mb-1">
        <span className="w-3.5 h-3.5 rounded-[5px]" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }} />
        <h1 className="text-[22px] font-extrabold text-[#050A1F]">Onboarding</h1>
      </div>
      <p className="text-[13px] text-slate-400 mb-5">Candidates who are hired and going through onboarding. Open one to manage their documents and checklist.</p>
      {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 mb-3">{err}</div>}
      {rows === null ? <div className="text-slate-400 text-sm py-16 text-center">Loading…</div> : rows.length === 0 ? (
        <div className="text-center py-20">
          <div className="w-14 h-14 rounded-2xl bg-orange-50 text-[#FF6A00] flex items-center justify-center mx-auto mb-4"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg></div>
          <div className="text-[15px] font-bold text-[#050A1F] mb-1">No one is onboarding right now</div>
          <div className="text-[13px] text-slate-400 mb-4">When you set a joining date for a hired candidate (Recruitment → Hired → Manage hire), they’ll appear here.</div>
          {!showDiag && <button onClick={runDiag} className="text-[12px] font-bold text-slate-500 underline">Why don’t I see my hired candidates?</button>}
          {showDiag && (
            <div className="mt-4 text-left max-w-3xl mx-auto">
              {!diag ? <div className="text-slate-400 text-sm text-center">Checking…</div> : (
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-4 py-2 bg-slate-50 text-[12px] text-slate-500">Server date (IST today): <b>{diag.istToday}</b> · {diag.total} candidate(s) checked · {diag.shown} would show</div>
                  <table className="w-full text-[12px]">
                    <thead><tr className="text-left text-slate-400 border-b border-slate-100"><th className="px-3 py-2">Candidate</th><th className="px-3 py-2">Joining date (stored)</th><th className="px-3 py-2">Parsed</th><th className="px-3 py-2">Why not shown</th></tr></thead>
                    <tbody>
                      {diag.candidates.map((c) => (
                        <tr key={c.id} className={`border-b border-slate-50 ${c.wouldShow ? 'bg-green-50/40' : ''}`}>
                          <td className="px-3 py-2 font-semibold text-slate-700">{titleCase(c.name)}<div className="text-[10px] text-slate-400 font-normal">stage: {c.stage || '—'} · offer: {c.offerStatus || '—'}</div></td>
                          <td className="px-3 py-2 text-slate-600">{c.rawJoiningDate || <span className="text-red-500">none</span>}</td>
                          <td className="px-3 py-2 text-slate-600">{c.parsedJoiningDate || '—'}</td>
                          <td className="px-3 py-2">{c.wouldShow ? <span className="text-green-600 font-bold">✓ shows</span> : <span className="text-amber-600">{c.reason}</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] font-extrabold uppercase tracking-wide text-slate-400 border-b border-slate-100">
              <th className="text-left px-4 py-3">Candidate</th>
              <th className="text-left px-3 py-3">Joining</th>
              <th className="text-left px-3 py-3">Documents</th>
              <th className="text-left px-3 py-3">HR checklist</th>
              <th className="text-left px-3 py-3">Status</th>
              <th className="px-3 py-3"></th>
            </tr></thead>
            <tbody>
              {rows.map((c) => {
                const dt = daysTo(c.joiningDate);
                const dueSoon = dt !== null && dt <= 2;
                return (
                  <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[#0A0E28]">{titleCase(c.name)}</div>
                      <div className="text-[11px] text-slate-400">{c.role}{c.department ? ` · ${c.department}` : ''}</div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="text-[13px] text-[#0A0E28]">{fmt(c.joiningDate)}</div>
                      <div className={`text-[11px] font-bold ${dueSoon ? 'text-orange-600' : 'text-slate-400'}`}>{dt === null ? '' : dt < 0 ? `${-dt}d ago` : dt === 0 ? 'Today' : `in ${dt}d`}{c.joiningTime ? ` · ${c.joiningTime}` : ''}</div>
                    </td>
                    <td className="px-3 py-3">
                      {c.docsStatus === 'submitted'
                        ? <span className="text-[11px] font-bold rounded-full px-2.5 py-0.5" style={{ background: '#DCFCE7', color: '#15803D' }}>Submitted</span>
                        : <span className="text-[11px] font-bold rounded-full px-2.5 py-0.5" style={{ background: '#FEF3C7', color: '#B45309' }}>Pending</span>}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${c.tasksTotal ? Math.round(c.tasksDone / c.tasksTotal * 100) : 0}%`, background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }} /></div>
                        <span className="text-[11px] font-bold text-slate-500">{c.tasksDone}/{c.tasksTotal}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {c.joined ? <span className="text-[11px] font-bold text-green-600">Joined</span>
                        : c.converted ? <span className="text-[11px] font-bold text-indigo-600">Employee created</span>
                        : <span className="text-[11px] font-bold text-slate-400">In progress</span>}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button onClick={() => setOpenFor({ _id: c.id, name: c.name })} className="text-[12px] font-bold rounded-lg px-3 py-1.5 text-white" style={{ background: '#0A1F44' }}>Open</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {openFor && <OnboardingPanelModal candidate={openFor} isAdmin={isAdmin} onClose={() => setOpenFor(null)} onChanged={load} onOpenCandidate={onOpenCandidate} />}
    </div>
  );
}

function OnboardingPanelModal({ candidate, isAdmin, onClose, onChanged, onOpenCandidate }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const load = () => hrApi(`/candidates/${candidate._id}/onboarding`).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line

  const onb = data && data.onboarding;
  const docs = (onb && onb.docs) || {};
  const submitted = onb && onb.status === 'submitted';
  const created = data && data.convertedEmployeeId;

  const [editDate, setEditDate] = useState(false);
  const [njDate, setNjDate] = useState('');
  const [njTime, setNjTime] = useState('');
  const [njReason, setNjReason] = useState('');
  const offer = (data && data.offer) || {};
  // Normalise whatever is stored into yyyy-mm-dd for the date input.
  const isoJoining = (() => {
    const v = offer.joiningDate; if (!v) return '';
    const s = String(v); let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (m) { let a = Number(m[1]), b = Number(m[2]); const y = m[3]; let d, mo; if (a > 12) { d = a; mo = b; } else if (b > 12) { mo = a; d = b; } else { d = a; mo = b; } return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
    const dd = new Date(s); if (!isNaN(dd.getTime())) return dd.toISOString().slice(0, 10); return '';
  })();
  const openDateEditor = () => { setNjDate(isoJoining); setNjTime(offer.joiningTime || '09:30'); setNjReason(''); setEditDate(true); };
  const saveJoiningDate = async () => {
    if (!njDate) { setErr('Please pick a joining date.'); return; }
    setBusy('date'); setErr('');
    try {
      await hrApi(`/candidates/${candidate._id}/offer`, { method: 'POST', body: JSON.stringify({ op: 'manage_hire', joiningDate: njDate, joiningTime: njTime, changeReason: njReason || 'Joining date corrected from onboarding panel' }) });
      setEditDate(false); await load(); onChanged && onChanged();
    } catch (e) { setErr(e.message); }
    setBusy('');
  };

  // Joined / Not-joined — available any time from the drawer.
  const [njMode, setNjMode] = useState(''); // '' | 'no'
  const [njNotes, setNjNotes] = useState('');
  const confirmJoined = async (joined) => {
    if (!joined && !njNotes.trim()) { setErr('Please add a note explaining why they didn’t join.'); return; }
    setBusy('join'); setErr('');
    try {
      await hrApi(`/candidates/${candidate._id}/join-confirm`, { method: 'POST', body: JSON.stringify({ joined, reason: joined ? '' : njNotes.trim() }) });
      onChanged && onChanged();
      onClose(); // candidate leaves the onboarding list (joined→employee / not→blacklist)
    } catch (e) { setErr(e.message); setBusy(''); }
  };

  const copyLink = () => { if (data && data.onboardingUrl) { navigator.clipboard.writeText(data.onboardingUrl); setBusy('copied'); setTimeout(() => setBusy(''), 1500); } };
  const markPhysical = async (on, extra) => {
    setBusy('physical'); setErr('');
    try { await hrApi(`/candidates/${candidate._id}/onboarding/docs-physical`, { method: 'POST', body: JSON.stringify({ on, ...(extra || {}) }) }); await load(); onChanged && onChanged(); setShowPhysForm(false); }
    catch (e) { setErr(e.message); }
    setBusy('');
  };
  const [showPhysForm, setShowPhysForm] = useState(false);
  const [physDate, setPhysDate] = useState(new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10));
  const [physBy, setPhysBy] = useState('');
  const [replyFor, setReplyFor] = useState(''); // queryId being replied to
  const [replyText, setReplyText] = useState('');
  const sendReply = async (queryId) => {
    if (!replyText.trim()) { setErr('Please type a reply.'); return; }
    setBusy('reply'); setErr('');
    try { await hrApi(`/candidates/${candidate._id}/onboarding/query/${queryId}/reply`, { method: 'POST', body: JSON.stringify({ reply: replyText.trim() }) }); setReplyFor(''); setReplyText(''); await load(); }
    catch (e) { setErr(e.message); }
    setBusy('');
  };
  const sendWelcome = async () => {
    setBusy('welcome'); setErr('');
    try { await hrApi(`/candidates/${candidate._id}/onboarding/send-welcome`, { method: 'POST', body: '{}' }); await load(); onChanged && onChanged(); }
    catch (e) { setErr(e.message); }
    setBusy('');
  };

  const docList = onb ? [
    ['Photo', docs.photo], ['PAN card', docs.panCard], ['Aadhaar card', docs.aadhaarCard],
    ['Address proof', docs.addressProof], ['Degree certificate', docs.degreeCertificate],
    ...(Array.isArray(docs.marksheets) ? docs.marksheets.map((m, i) => [`Marksheet ${i + 1}`, m]) : []),
    ...((onb.prevCompanies || []).flatMap((c) => [
      ...(c.expLetters || []).map((u, i) => [`${c.name || 'Company'} — letter ${i + 1}`, u]),
      ...(c.salarySlips || []).map((u, i) => [`${c.name || 'Company'} — salary slip ${i + 1}`, u]),
    ])),
  ] : [];

  const PHASES = [
    ['prepare', 'Prepare', '2 days before'],
    ['setup', 'Set up', '1 day before'],
    ['joinday', 'Joining day', 'confirm & welcome'],
    ['induction', 'Induction', 'day one'],
  ];

  return (
    <div className="fixed inset-0 bg-black/40 z-[120] flex justify-end" onClick={onClose}>
      <div className="bg-white w-full max-w-3xl h-full shadow-2xl flex flex-col animate-[slideInRight_.22s_ease-out]" onClick={(e) => e.stopPropagation()} style={{ animationName: 'slideInRight' }}>
        <style>{`@keyframes slideInRight{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="min-w-0">
            <div className="text-lg font-extrabold text-[#050A1F]">Onboarding — {titleCase(candidate.name)}</div>
            {data && (
              <div className="text-[12px] text-slate-400 flex items-center gap-1.5 flex-wrap">
                <span>{data.role}</span>
                {isoJoining ? <span>· Joining {new Date(isoJoining + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}{offer.joiningTime ? ` · ${offer.joiningTime}` : ''}</span> : <span className="text-amber-600">· No joining date set</span>}
                <button onClick={openDateEditor} className="text-[11px] font-bold text-indigo-500 hover:text-indigo-600 underline">{isoJoining ? 'Edit' : 'Set date'}</button>
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 text-xl leading-none">×</button>
        </div>
        {editDate && (
          <div className="px-6 py-3 bg-indigo-50/60 border-b border-indigo-100 shrink-0">
            <div className="text-[12px] font-bold text-[#050A1F] mb-2">Set / correct joining date</div>
            <div className="flex items-end gap-2 flex-wrap">
              <div><div className="text-[11px] text-slate-500 mb-1">Date</div><input type="date" value={njDate} onChange={(e) => setNjDate(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-[13px]" /></div>
              <div><div className="text-[11px] text-slate-500 mb-1">Time</div><input type="time" value={njTime} onChange={(e) => setNjTime(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-[13px]" /></div>
              <input value={njReason} onChange={(e) => setNjReason(e.target.value)} placeholder="Reason (optional)" className="flex-1 min-w-[140px] rounded-lg border border-slate-300 px-2.5 py-1.5 text-[13px]" />
              <button onClick={saveJoiningDate} disabled={busy === 'date'} className="rounded-lg px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50" style={{ background: '#4338CA' }}>{busy === 'date' ? 'Saving…' : 'Save'}</button>
              <button onClick={() => setEditDate(false)} className="text-[12px] text-slate-400">Cancel</button>
            </div>
            <div className="text-[11px] text-slate-400 mt-1.5">Saving stores the date in a clean format so onboarding starts correctly. A future date puts this candidate on the onboarding list.</div>
          </div>
        )}
        <div className="p-6 overflow-y-auto space-y-4">
          {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{err}</div>}
          {!data ? <div className="text-slate-400 text-sm py-6 text-center">Loading…</div> : (
            <>
              {/* Candidate details */}
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[15px] font-extrabold text-[#050A1F]">{titleCase(data.candidate.name)}</div>
                    <div className="text-[12px] text-slate-400">{data.role}{data.department ? ` · ${data.department}` : ''}</div>
                  </div>
                  {onOpenCandidate && <button onClick={() => onOpenCandidate(candidate._id)} className="text-[11px] font-bold rounded-lg border border-slate-300 px-2.5 py-1.5 text-slate-600 hover:bg-slate-50 shrink-0">Candidate page →</button>}
                </div>
                <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 mt-3 text-[12px]">
                  {[['Email', data.candidate.email], ['Phone', data.candidate.phone], ['Accepted salary', offer.acceptedAmount || offer.finalCtc], ['Joining date', isoJoining ? new Date(isoJoining + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) + (offer.joiningTime ? ` · ${offer.joiningTime}` : '') : 'Not set'], ['Assigned HR', data.hr ? data.hr.name : '—']].map(([k, v]) => (
                    <div key={k} className="flex gap-2 min-w-0"><span className="text-slate-400 shrink-0">{k}:</span><span className="text-[#0A0E28] font-medium truncate">{v || '—'}</span></div>
                  ))}
                </div>
                {/* Joined / Not joined */}
                <div className="mt-4 pt-3 border-t border-slate-100">
                  {njMode !== 'no' ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[12px] font-bold text-slate-600 mr-1">Confirm joining:</span>
                      <button onClick={() => confirmJoined(true)} disabled={busy === 'join'} className="text-[12px] font-bold rounded-lg px-3 py-1.5 text-white disabled:opacity-50" style={{ background: '#16A34A' }}>✓ Joined</button>
                      <button onClick={() => { setNjMode('no'); setErr(''); }} className="text-[12px] font-bold rounded-lg px-3 py-1.5 border border-red-200 text-red-600 hover:bg-red-50">✗ Didn't join</button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="text-[12px] font-bold text-slate-600">Why didn't they join? <span className="text-red-500">*</span></div>
                      <textarea rows={2} value={njNotes} onChange={(e) => setNjNotes(e.target.value)} placeholder="Add a note — the candidate will be moved to the Blacklist." className="w-full rounded-lg border border-slate-300 px-3 py-2 text-[13px]" />
                      <div className="flex gap-2">
                        <button onClick={() => confirmJoined(false)} disabled={busy === 'join' || !njNotes.trim()} className="text-[12px] font-bold rounded-lg px-3 py-1.5 text-white disabled:opacity-50" style={{ background: '#EF4444' }}>{busy === 'join' ? 'Saving…' : 'Confirm & blacklist'}</button>
                        <button onClick={() => { setNjMode(''); setNjNotes(''); }} className="text-[12px] text-slate-400">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {/* HR contact + link */}
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-center gap-3 flex-wrap">
                  {data.hr ? <div className="text-[13px]"><span className="text-slate-400">HR contact:</span> <span className="font-bold text-[#050A1F]">{data.hr.name}</span>{data.hr.phone ? <span className="text-slate-500"> · {data.hr.phone}</span> : ''}</div> : <div className="text-[13px] text-slate-400">No HR contact assigned to this job.</div>}
                </div>
                {onb.docsPhysical ? (
                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    <span className="text-[12px] font-bold rounded-lg px-2.5 py-1.5" style={{ background: '#EEF2FF', color: '#4338CA' }}>📄 Documents verified in person</span>
                    <span className="text-[11px] text-slate-400">{onb.verifiedByName ? `By ${onb.verifiedByName}` : ''}{onb.physicalCollectedDate ? ` · collected ${new Date(onb.physicalCollectedDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}. No onboarding link or welcome email is sent.</span>
                    <button onClick={() => markPhysical(false)} disabled={busy === 'physical'} className="ml-auto text-[11px] text-slate-400 hover:text-slate-600 underline">Undo</button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      <input readOnly value={data.onboardingUrl} className="flex-1 min-w-[220px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-500" />
                      <button onClick={copyLink} className="rounded-lg border border-slate-300 px-3 py-2 text-[12px] font-bold text-slate-600">{busy === 'copied' ? 'Copied!' : 'Copy link'}</button>
                      <button onClick={sendWelcome} disabled={busy === 'welcome'} className="rounded-lg px-3 py-2 text-[12px] font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy === 'welcome' ? 'Sending…' : (onb.welcomeEmailSentAt ? 'Resend welcome' : 'Send welcome email')}</button>
                    </div>
                    {(() => {
                      const ls = data.linkStatus || {};
                      const fmtD = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return d; } };
                      if (ls.submitted || submitted) {
                        return <div className="text-[11px] text-green-700 mt-2">✓ The candidate has already submitted their documents — the link is no longer needed.</div>;
                      }
                      if (ls.expired) {
                        return (
                          <div className="text-[11px] mt-2 rounded-lg px-3 py-2" style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}>
                            <span className="font-bold text-red-600">⚠ This link has expired.</span>
                            <span className="text-red-500"> The candidate can no longer open it. </span>
                            <button onClick={async () => { setBusy('react'); setErr(''); try { await hrApi(`/candidates/${candidate._id}/onboarding/reactivate`, { method: 'POST', body: '{}' }); await load(); } catch (e) { setErr(e.message); } setBusy(''); }} disabled={busy === 'react'} className="font-bold text-indigo-600 hover:text-indigo-700 underline disabled:opacity-50">{busy === 'react' ? 'reactivating…' : 'Reactivate the link →'}</button>
                          </div>
                        );
                      }
                      return (
                        <div className="text-[11px] text-slate-400 mt-2">
                          {ls.reactivatedUntil
                            ? <>✓ Link active — reactivated until {fmtD(ls.reactivatedUntil)}.</>
                            : ls.expiryDate
                              ? <>✓ Link active — expires {fmtD(ls.expiryDate)} (the day before joining).</>
                              : <>The link expires the day before joining.</>}
                        </div>
                      );
                    })()}
                    {onb.welcomeEmailSentAt && onb.welcomeEmailSentAt !== 'physical' && <div className="text-[11px] text-slate-400 mt-2">Welcome email sent {new Date(onb.welcomeEmailSentAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.</div>}
                    {!submitted && !showPhysForm && <div className="mt-2"><button onClick={() => { setShowPhysForm(true); setPhysBy((data.hrStaff && data.hrStaff[0] && data.hrStaff[0].id) || ''); }} disabled={busy === 'physical'} className="text-[11px] font-bold rounded-lg border border-indigo-200 text-indigo-600 px-3 py-1.5 hover:bg-indigo-50">Documents collected in person? Mark verified →</button><div className="text-[11px] text-slate-400 mt-1">Use this when the candidate hands over documents physically — no link or welcome email is sent, but the checklist and other emails continue.</div></div>}
                    {!submitted && showPhysForm && (
                      <div className="mt-2 rounded-xl p-3" style={{ background: '#EEF2FF', border: '1px solid #c7d2fe' }}>
                        <div className="text-[12px] font-bold text-indigo-800 mb-2">Documents collected in person</div>
                        <div className="flex items-end gap-2 flex-wrap">
                          <div><div className="text-[11px] text-indigo-700 font-semibold mb-1">Date collected</div><input type="date" value={physDate} onChange={(e) => setPhysDate(e.target.value)} className="rounded-lg border border-indigo-300 px-2.5 py-1.5 text-[13px] bg-white" /></div>
                          <div><div className="text-[11px] text-indigo-700 font-semibold mb-1">Verified by</div>
                            <select value={physBy} onChange={(e) => setPhysBy(e.target.value)} className="rounded-lg border border-indigo-300 px-2.5 py-1.5 text-[13px] bg-white">
                              <option value="">Select…</option>
                              {(data.hrStaff || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                            </select>
                          </div>
                          <button onClick={() => { if (!physBy) { setErr('Please select who verified the documents.'); return; } markPhysical(true, { date: physDate, verifiedById: physBy }); }} disabled={busy === 'physical'} className="text-[12px] font-bold rounded-lg px-3 py-1.5 text-white disabled:opacity-50" style={{ background: '#4338CA' }}>{busy === 'physical' ? 'Saving…' : 'Mark verified'}</button>
                          <button onClick={() => setShowPhysForm(false)} className="text-[12px] font-bold rounded-lg border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-50">Cancel</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Candidate documents */}
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[15px] font-extrabold text-[#050A1F] flex items-center gap-2"><span className="w-3 h-3 rounded" style={{ background: '#0EA5E9' }} />Candidate documents</div>
                  {onb.docsPhysical ? <span className="text-[11px] font-bold rounded-full px-2.5 py-0.5" style={{ background: '#EEF2FF', color: '#4338CA' }}>Verified in person</span> : submitted ? <span className="text-[11px] font-bold rounded-full px-2.5 py-0.5" style={{ background: '#DCFCE7', color: '#15803D' }}>Submitted {onb.submittedAt ? new Date(onb.submittedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}</span> : <span className="text-[11px] font-bold rounded-full px-2.5 py-0.5" style={{ background: '#FEF3C7', color: '#B45309' }}>Awaiting submission</span>}
                </div>
                {onb.docsPhysical && docList.filter(([, u]) => u && u.url).length === 0 ? (
                  <div className="text-[13px] text-slate-500 py-2 flex items-center gap-2"><span className="w-5 h-5 rounded-md flex items-center justify-center text-[11px] font-bold shrink-0" style={{ background: '#EEF2FF', color: '#4338CA' }}>✓</span>Documents were collected and verified in person{onb.verifiedByName ? ` by ${onb.verifiedByName}` : ''}. You can proceed with creating the employee.</div>
                ) : !submitted ? <div className="text-[13px] text-slate-400 py-2">The candidate hasn’t submitted their documents yet. They can upload via the link above, or you can verify documents in person.</div> : (
                  <>
                    <div className="grid sm:grid-cols-2 gap-x-6">
                      {docList.filter(([, u]) => u && u.url).map(([label, u]) => (
                        <div key={label} className="flex items-center gap-2 py-1.5 border-t border-slate-50 text-[13px]">
                          <span className="w-5 h-5 rounded-md flex items-center justify-center text-[11px] font-bold shrink-0" style={{ background: '#DCFCE7', color: '#15803D' }}>✓</span>
                          <span className="text-[#0A0E28]">{label}</span>
                          <a href={u.url} target="_blank" rel="noreferrer" className="ml-auto text-[12px] font-bold" style={{ color: '#0435AC' }}>View</a>
                        </div>
                      ))}
                    </div>
                    {onb.fields && <details className="mt-3"><summary className="text-[12px] font-bold text-slate-500 cursor-pointer">View submitted details</summary>
                      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 mt-2 text-[12px]">
                        {[['Name', onb.fields.name], ['Email', onb.fields.email], ['Phone', onb.fields.phone], ["Father's name", onb.fields.fatherName], ['DOB', onb.fields.dob], ['Blood group', onb.fields.bloodGroup], ['Marital status', onb.fields.maritalStatus], ['Anniversary', onb.fields.anniversary], ['PAN', onb.fields.pan], ['Aadhaar', onb.fields.aadhaar], ['Qualification', onb.fields.qualification === 'Other' ? onb.fields.qualificationOther : onb.fields.qualification], ['Present address', onb.fields.presentAddress], ['Permanent address', onb.fields.permanentAddress]].filter(([, v]) => v).map(([k, v]) => (
                          <div key={k} className="flex gap-2"><span className="text-slate-400">{k}:</span><span className="text-[#0A0E28] font-medium">{v}</span></div>
                        ))}
                      </div>
                    </details>}
                  </>
                )}
                {/* Create employee — available once docs are submitted online or verified in person. */}
                {(submitted || onb.docsComplete) && (created ? (
                  <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 mt-3">
                    <span className="text-[13px] font-bold text-[#166534]">✓ Employee record created</span>
                    <span className="text-[12px] text-slate-400">This candidate is now an employee in HRMS.</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 rounded-xl px-4 py-3 mt-3" style={{ background: '#F0FDF4', border: '1px solid #BBF7D0' }}>
                    <div><div className="text-[13px] font-bold" style={{ color: '#166534' }}>{onb.docsPhysical ? 'Documents verified' : 'All documents received'}</div><div className="text-[12px]" style={{ color: '#3f9668' }}>Move details & documents into HRMS and create the employee record.</div></div>
                    <button onClick={() => setShowCreate(true)} className="ml-auto text-white rounded-lg px-4 py-2 text-[13px] font-extrabold" style={{ background: 'linear-gradient(90deg,#16A34A,#15803D)' }}>Create employee →</button>
                  </div>
                ))}
              </div>

              {/* Candidate questions — click an open one to answer via popup. */}
              {(() => {
                const qs = data.queries || [];
                const newCount = qs.filter((q) => !q.reply).length;
                return (
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[15px] font-extrabold text-[#050A1F] flex items-center gap-2"><span className="w-3 h-3 rounded" style={{ background: '#7C3AED' }} />Candidate questions</div>
                      {newCount > 0 && <span className="text-[11px] font-bold rounded-full px-2.5 py-0.5" style={{ background: '#FEF3C7', color: '#B45309' }}>{newCount} new</span>}
                    </div>
                    <div className="text-[12px] text-slate-400 mb-3">Click a question to answer it. Answered questions show the reply below.</div>
                    {qs.length === 0 ? <div className="text-[13px] text-slate-400 py-1">No questions yet.</div> : (
                      <div className="space-y-2">
                        {qs.slice().reverse().map((q) => q.reply ? (
                          <div key={q.id} className="rounded-lg border border-slate-200 p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="text-[13px] font-semibold text-[#0A0E28]">{q.message}</div>
                              <span className="text-[10px] font-bold rounded-full px-2 py-0.5 shrink-0" style={{ background: '#DCFCE7', color: '#15803D' }}>Answered</span>
                            </div>
                            <div className="text-[10px] text-slate-400 mt-1">{q.at ? new Date(q.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}{q.repliedByName ? ` · replied by ${q.repliedByName}` : ''}</div>
                            <div className="mt-2 rounded-lg px-3 py-2 text-[12px]" style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', color: '#166534' }}><div className="text-[10px] font-bold uppercase mb-0.5" style={{ color: '#16A34A' }}>Your reply</div>{q.reply}</div>
                          </div>
                        ) : (
                          <button key={q.id} onClick={() => { setReplyFor(q.id); setReplyText(''); setErr(''); }} className="w-full text-left rounded-lg border border-slate-200 p-3 hover:bg-indigo-50/40 hover:border-indigo-200 transition flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-[13px] font-semibold text-[#0A0E28]">{q.message}</div>
                              <div className="text-[10px] text-slate-400 mt-1">{q.at ? new Date(q.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-[10px] font-bold rounded-full px-2 py-0.5" style={{ background: '#FEF3C7', color: '#B45309' }}>New</span>
                              <span className="text-slate-400 text-lg leading-none">›</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* HR checklist — interactive with per-task automations. */}
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[15px] font-extrabold text-[#050A1F] flex items-center gap-2"><span className="w-3 h-3 rounded" style={{ background: '#FF6A00' }} />HR onboarding checklist</div>
                  {(() => { const all = (onb.hrTasks || []).filter((t) => !t.salesOnly || data.isSales); const done = all.filter((t) => t.done).length; return <span className="text-[12px] font-extrabold" style={{ color: '#0435AC' }}>{done} / {all.length} done</span>; })()}
                </div>
                {PHASES.map(([pid, plabel, pwhen]) => {
                  const items = (onb.hrTasks || []).filter((t) => t.phase === pid && (!t.salesOnly || data.isSales));
                  if (!items.length) return null;
                  return (
                    <div key={pid} className="mt-3">
                      <div className="text-[11px] font-extrabold uppercase tracking-wide text-[#0A0E28]">{plabel} <span className="text-slate-400 font-semibold normal-case">· {pwhen}</span></div>
                      {items.map((t) => (
                        <OnbTaskRow key={t.id} task={t} candidateId={candidate._id} created={!!created} onChanged={(nt) => { setData((d) => ({ ...d, onboarding: { ...d.onboarding, hrTasks: d.onboarding.hrTasks.map((x) => x.id === nt.id ? nt : x) } })); onChanged && onChanged(); }} onCreateEmployee={() => setShowCreate(true)} />
                      ))}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
        {showCreate && data && <CreateEmployeeFromCandidate data={data} candidateId={candidate._id} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); onChanged && onChanged(); }} />}
        {replyFor && (() => {
          const q = (data.queries || []).find((x) => x.id === replyFor);
          if (!q) return null;
          return (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[150] p-4" onClick={() => { setReplyFor(''); setReplyText(''); }}>
              <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                  <div className="text-base font-extrabold text-[#050A1F]">Answer candidate question</div>
                  <button onClick={() => { setReplyFor(''); setReplyText(''); }} className="text-slate-400 text-xl leading-none">×</button>
                </div>
                <div className="p-5">
                  {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 mb-3">{err}</div>}
                  <div className="rounded-lg p-3 text-[13px] text-slate-700" style={{ background: '#F8FAFC', border: '1px solid #e2e8f0' }}>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Question from {titleCase(data.candidate.name).split(' ')[0]} · {q.at ? new Date(q.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}</div>
                    {q.message}
                  </div>
                  <textarea rows={4} value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Type your reply… the candidate will get an email with their question and your answer." className="w-full mt-3 rounded-lg border border-slate-300 px-3 py-2 text-[13px]" />
                </div>
                <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-2">
                  <button onClick={() => { setReplyFor(''); setReplyText(''); }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
                  <button onClick={() => sendReply(q.id)} disabled={busy === 'reply' || !replyText.trim()} className="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: '#4338CA' }}>{busy === 'reply' ? 'Sending…' : 'Send reply & email candidate'}</button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// Small form to create an employee (HrUser) from a submitted onboarding
// candidate — HR fills the org-specific fields (Employee ID, branch, reporting).
function CreateEmployeeFromCandidate({ data, candidateId, onClose, onCreated }) {
  const f = (data.onboarding && data.onboarding.fields) || {};
  const [form, setForm] = useState({
    email: f.email || (data.candidate && data.candidate.email) || '',
    password: '', employeeId: '', type: 'junior',
    designation: data.role || '', department: data.department || '', branch: '',
    reportsToId: '', shiftId: '',
  });
  const [opts, setOpts] = useState({ branches: [], shifts: [], managers: [] });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    Promise.all([
      hrApi('/branches').catch(() => []),
      hrApi('/shifts').catch(() => ({ shifts: [] })),
      hrApi('/users').catch(() => ({ users: [] })),
    ]).then(([branches, shifts, users]) => {
      const list = (users.users || users || []).filter((u) => u.active);
      setOpts({ branches: branches || [], shifts: (shifts.shifts || shifts || []), managers: list });
    });
  }, []);
  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));
  const submit = async () => {
    if (!form.email || !form.password || !form.type) { setErr('Email, password and role are required.'); return; }
    setBusy(true); setErr('');
    try { const r = await hrApi(`/candidates/${candidateId}/onboarding/create-employee`, { method: 'POST', body: JSON.stringify(form) }); onCreated(r); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  const ROLE_OPTS = [['junior', 'Junior'], ['senior', 'Senior'], ['tl', 'Team Lead'], ['manager', 'Manager'], ['hr', 'HR'], ['recruiter', 'Recruiter'], ['employee', 'Employee'], ['intern', 'Intern'], ['trainee', 'Trainee']];
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[130] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between"><div className="text-lg font-extrabold text-[#050A1F]">Create employee in HRMS</div><button onClick={onClose} className="text-slate-400 text-xl leading-none">×</button></div>
        <div className="p-6 space-y-3">
          {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{err}</div>}
          <div className="text-[12px] text-slate-400">Details and documents are carried over from onboarding. Enter the organisation-specific fields below.</div>
          <div className="grid grid-cols-2 gap-3">
            <LCE label="Employee ID"><input className={inpCE} value={form.employeeId} onChange={(e) => set('employeeId', e.target.value)} placeholder="e.g. QTX-041" /></LCE>
            <LCE label="Role / type *"><select className={inpCE} value={form.type} onChange={(e) => set('type', e.target.value)}>{ROLE_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></LCE>
            <LCE label="Login email *"><input className={inpCE} value={form.email} onChange={(e) => set('email', e.target.value)} /></LCE>
            <LCE label="Temp password *"><input className={inpCE} value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="set a starter password" /></LCE>
            <LCE label="Designation"><input className={inpCE} value={form.designation} onChange={(e) => set('designation', e.target.value)} /></LCE>
            <LCE label="Department"><input className={inpCE} value={form.department} onChange={(e) => set('department', e.target.value)} /></LCE>
            <LCE label="Branch"><select className={inpCE} value={form.branch} onChange={(e) => set('branch', e.target.value)}><option value="">Select</option>{opts.branches.map((b) => <option key={b.id || b.name} value={b.name}>{b.name}</option>)}</select></LCE>
            <LCE label="Shift"><select className={inpCE} value={form.shiftId} onChange={(e) => set('shiftId', e.target.value)}><option value="">Select</option>{opts.shifts.map((s) => <option key={s.id || s._id} value={s.id || s._id}>{s.name}</option>)}</select></LCE>
            <LCE label="Reporting Manager / TL"><select className={inpCE} value={form.reportsToId} onChange={(e) => set('reportsToId', e.target.value)}><option value="">Select</option>{opts.managers.map((m) => <option key={m.id} value={m.id}>{titleCase(m.name)}{m.designation ? ` · ${m.designation}` : ''}</option>)}</select></LCE>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={submit} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: 'linear-gradient(90deg,#16A34A,#15803D)' }}>{busy ? 'Creating…' : 'Create employee'}</button>
        </div>
      </div>
    </div>
  );
}
const inpCE = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
function LCE({ label, children }) { return <div><div className="text-[12px] font-bold text-slate-600 mb-1">{label}</div>{children}</div>; }

// A single interactive HR checklist row, with the per-task automation controls:
// route-to-IT, vendor delivery date, activate-HRMS (create employee), and the
// welcome-meeting time picker.
function OnbTaskRow({ task, candidateId, created, onChanged, onCreateEmployee }) {
  const [busy, setBusy] = useState(false);
  const [showDate, setShowDate] = useState(false);
  const [showMeet, setShowMeet] = useState(false);
  const [dateVal, setDateVal] = useState((task.meta && task.meta.deliveryDate) || '');
  const [meetTime, setMeetTime] = useState((task.meta && task.meta.meetingTime) || '10:00');
  const [meetDate, setMeetDate] = useState((task.meta && task.meta.meetingDate) || '');

  const call = async (body) => { setBusy(true); try { const r = await hrApi(`/candidates/${candidateId}/onboarding/task/${task.id}`, { method: 'POST', body: JSON.stringify(body) }); onChanged(r.task); } catch (e) { alert(e.message); } setBusy(false); };
  const toggle = () => { if (task.createsEmployee && !task.done && !created) { onCreateEmployee(); return; } call({ done: !task.done }); };
  const [showKpi, setShowKpi] = useState(false);

  const isWelcomeEmail = task.id === 'welcome_email';
  const isKpi = task.id === 'kpi_kra';

  const routed = task.meta && task.meta.routedTo;
  const isNotifySeniors = task.id === 'notify_seniors';
  const seniorMeta = task.meta || {};
  const fmtSentAt = (iso) => { try { return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
  return (
    <div className="py-1.5 border-t border-slate-50">
      <div className="flex items-center gap-2.5 text-[13px]">
        <button onClick={toggle} disabled={busy} className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center ${task.done ? 'bg-green-500 border-green-500' : 'border-slate-300'}`}>{task.done && <span className="text-white text-[10px] font-bold leading-none">✓</span>}</button>
        <span className={task.done ? 'text-slate-400 line-through' : 'text-[#0A0E28]'}>{task.label}</span>
        {task.auto && <span className="text-[9px] font-extrabold rounded px-1.5 py-0.5" style={{ background: '#EDE9FE', color: '#7C3AED' }}>AUTO</span>}
        {/* Sent / pending badge for the auto senior-notice task. */}
        {isNotifySeniors && task.done && <span className="text-[9px] font-extrabold rounded px-1.5 py-0.5" style={{ background: '#DCFCE7', color: '#15803D' }}>SENT</span>}
        {isNotifySeniors && !task.done && <button onClick={() => call({ action: 'notify_seniors' })} disabled={busy} className="ml-auto text-[11px] font-bold rounded-lg px-2.5 py-1 text-white disabled:opacity-50" style={{ background: '#7C3AED' }}>{busy ? 'Sending…' : 'Send now ›'}</button>}
        {/* per-task action buttons */}
        {!task.done && task.route && !routed && <button onClick={() => call({ action: 'route_it' })} disabled={busy} className="ml-auto text-[11px] font-bold rounded-lg px-2.5 py-1 text-white" style={{ background: '#0EA5E9' }}>Send to IT ›</button>}
        {!task.done && task.wantsDate && !showDate && <button onClick={() => setShowDate(true)} className="ml-auto text-[11px] font-bold rounded-lg px-2.5 py-1 text-white" style={{ background: '#F59E0B' }}>Set delivery date ›</button>}
        {!task.done && task.createsEmployee && !created && <button onClick={onCreateEmployee} className="ml-auto text-[11px] font-bold rounded-lg px-2.5 py-1 text-white" style={{ background: '#16A34A' }}>Create employee ›</button>}
        {!task.done && task.meeting && !showMeet && <button onClick={() => setShowMeet(true)} className="ml-auto text-[11px] font-bold rounded-lg px-2.5 py-1 text-white" style={{ background: '#7C3AED' }}>Schedule ›</button>}
        {!task.done && isWelcomeEmail && <button onClick={() => call({ action: 'welcome_aboard' })} disabled={busy} className="ml-auto text-[11px] font-bold rounded-lg px-2.5 py-1 text-white" style={{ background: '#0F9D58' }}>Send welcome ›</button>}
        {!task.done && isKpi && <button onClick={() => setShowKpi(true)} className="ml-auto text-[11px] font-bold rounded-lg px-2.5 py-1 text-white" style={{ background: '#4338CA' }}>Draft with AI ›</button>}
      </div>
      {/* Senior-notice sent details: when + who it went to. */}
      {isNotifySeniors && !task.done && <div className="ml-6 mt-1 text-[11px] text-slate-400">Sends automatically 2 days before joining — or click “Send now” to notify them today.</div>}
      {isNotifySeniors && task.done && (
        <div className="ml-6 mt-1 text-[11px] text-green-700">
          ✓ Emailed {seniorMeta.sentAt ? `on ${fmtSentAt(seniorMeta.sentAt)}` : (task.doneAt ? `on ${fmtSentAt(task.doneAt)}` : '')}
          {Array.isArray(seniorMeta.recipients) && seniorMeta.recipients.length > 0 && (
            <span className="text-slate-500"> · to {seniorMeta.recipients.map((r) => r.name).join(', ')}</span>
          )}
        </div>
      )}
      {routed && <div className="ml-6 mt-1 text-[11px] text-sky-600 font-semibold">✓ Sent to {routed} — they’ll mark it done from their dashboard.</div>}
      {task.meta && task.meta.deliveryDate && task.done && <div className="ml-6 mt-1 text-[11px] text-slate-400">ID card expected by {new Date(task.meta.deliveryDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}.</div>}
      {task.meta && task.meta.meetingTime && task.done && <div className="ml-6 mt-1 text-[11px] text-slate-400">Announcement posted · {task.meta.meetingDate ? new Date(task.meta.meetingDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''} {task.meta.meetingTime} · Conference Room.</div>}
      {showDate && !task.done && (
        <div className="ml-6 mt-2 flex items-center gap-2">
          <input type="date" value={dateVal} onChange={(e) => setDateVal(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-[12px]" />
          <button onClick={() => call({ action: 'vendor_date', deliveryDate: dateVal })} disabled={busy || !dateVal} className="text-[11px] font-bold rounded-lg px-3 py-1.5 text-white disabled:opacity-50" style={{ background: '#F59E0B' }}>Save</button>
          <button onClick={() => setShowDate(false)} className="text-[11px] text-slate-400">Cancel</button>
        </div>
      )}
      {showMeet && !task.done && (
        <div className="ml-6 mt-2 flex items-center gap-2 flex-wrap">
          <input type="date" value={meetDate} onChange={(e) => setMeetDate(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-[12px]" />
          <input type="time" value={meetTime} onChange={(e) => setMeetTime(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-[12px]" />
          <span className="text-[11px] text-slate-500">· Conference Room</span>
          <button onClick={() => call({ action: 'welcome_meeting', time: meetTime, date: meetDate })} disabled={busy} className="text-[11px] font-bold rounded-lg px-3 py-1.5 text-white" style={{ background: '#7C3AED' }}>Post announcement</button>
          <button onClick={() => setShowMeet(false)} className="text-[11px] text-slate-400">Cancel</button>
        </div>
      )}
      {showKpi && <KpiKraModal candidateId={candidateId} onClose={() => setShowKpi(false)} onSent={() => { setShowKpi(false); call({ done: true }); }} />}
    </div>
  );
}

// Draft KPI/KRA via OpenAI, let HR/admin review & edit, then send.
function KpiKraModal({ candidateId, onClose, onSent }) {
  const [stage, setStage] = useState('notes'); // 'notes' | 'draft'
  const [notes, setNotes] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const notesEmpty = !notes || !notes.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

  const generate = async () => {
    if (notesEmpty) { setErr('Please enter the KRA & KPI details first — the AI uses these along with the job description.'); return; }
    setBusy('gen'); setErr('');
    try {
      const r = await hrApi(`/candidates/${candidateId}/onboarding/kpi-draft`, { method: 'POST', body: JSON.stringify({ notes }) });
      setBody(r.body || ''); setStage('draft');
    } catch (e) { setErr(e.message); }
    setBusy('');
  };
  const regenerate = async () => {
    setBusy('gen'); setErr('');
    try { const r = await hrApi(`/candidates/${candidateId}/onboarding/kpi-draft`, { method: 'POST', body: JSON.stringify({ notes }) }); setBody(r.body || ''); }
    catch (e) { setErr(e.message); }
    setBusy('');
  };
  const send = async () => {
    if (!body || !body.replace(/<[^>]*>/g, '').trim()) { setErr('Nothing to send yet.'); return; }
    setBusy('send'); setErr('');
    try { await hrApi(`/candidates/${candidateId}/onboarding/kpi-send`, { method: 'POST', body: JSON.stringify({ body }) }); onSent(); }
    catch (e) { setErr(e.message); setBusy(''); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[140] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div>
            <div className="text-lg font-extrabold text-[#050A1F]">KPI & KRA email</div>
            <div className="text-[12px] text-slate-400">{stage === 'notes' ? 'Step 1 of 2 — enter the KRA & KPI details' : 'Step 2 of 2 — review & edit the AI draft'}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 text-xl leading-none">×</button>
        </div>
        <div className="p-6 overflow-y-auto space-y-3">
          {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{err}</div>}

          {stage === 'notes' ? (
            <>
              <div className="text-[13px] text-slate-500">Enter the key result areas and performance indicators for this role. The AI will refine and structure them into a polished email using these notes and the job description.</div>
              <MailEditor value={notes} onChange={setNotes} minHeight={220} placeholder={'e.g.\n• Own the frontend delivery for the CRM module\n• Ship assigned features within sprint timelines\n• Maintain code quality and review standards\n\nKPIs:\n• 90%+ sprint commitments met\n• < 2 post-release defects per feature'} />
              <div className="text-[11px] text-slate-400">Tip: a few bullet points for KRAs and a few for KPIs is enough — the AI will expand and format them.</div>
            </>
          ) : (
            <>
              <div className="text-[13px] text-slate-500">Here’s the AI-formatted draft. Edit anything you like — it’ll be sent to the joiner inside the branded Qtonix email template.</div>
              <MailEditor value={body} onChange={setBody} minHeight={260} placeholder="The AI draft will appear here…" />
            </>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-between gap-2">
          {stage === 'notes' ? (
            <>
              <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
              <button onClick={generate} disabled={busy === 'gen' || notesEmpty} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: '#4338CA' }}>{busy === 'gen' ? 'Generating…' : 'Generate with AI →'}</button>
            </>
          ) : (
            <>
              <div className="flex gap-2">
                <button onClick={() => { setStage('notes'); setErr(''); }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">‹ Back to notes</button>
                <button onClick={regenerate} disabled={busy === 'gen'} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600 disabled:opacity-50">{busy === 'gen' ? 'Re-generating…' : '↻ Re-generate'}</button>
              </div>
              <div className="flex gap-2">
                <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
                <button onClick={send} disabled={busy === 'send'} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: '#16A34A' }}>{busy === 'send' ? 'Sending…' : 'Send to employee'}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Marks a hired candidate as having failed to join on the joining date.
function NotJoinedModal({ candidate, onClose, onSaved }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const jd = candidate.offer && candidate.offer.joiningDate;
  const save = async () => {
    setBusy(true);
    try { await hrApi(`/candidates/${candidate._id}/offer`, { method: 'POST', body: JSON.stringify({ op: 'mark_not_joined', reason: reason.trim() }) }); onSaved(); }
    catch (e) { alert(e.message); setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[120] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between"><div className="text-lg font-extrabold text-[#050A1F]">Candidate didn’t join</div><button onClick={onClose} className="text-slate-400 text-xl leading-none">×</button></div>
        <div className="p-6 space-y-3">
          <div className="text-sm text-slate-500">Mark <b className="text-[#050A1F]">{titleCase(candidate.name)}</b> as not joined{jd ? ` (joining date was ${new Date(jd).toLocaleDateString()})` : ''}. They’ll stay in the Hired list flagged as “Did not join”.</div>
          <div><div className="text-[12px] font-bold text-slate-600 mb-1">Reason (optional)</div><textarea rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. accepted another offer, no-show…" /></div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: '#DC2626' }}>{busy ? 'Saving…' : 'Mark not joined'}</button>
        </div>
      </div>
    </div>
  );
}

function HiredOfferModal({ candidate, onClose, onSaved }) {
  const [ask, setAsk] = useState((candidate.offer && candidate.offer.declinedSummary && candidate.offer.declinedSummary.candidateAsk) || (candidate.answers && candidate.answers.expectedCtc) || '');
  const [offered, setOffered] = useState((candidate.offer && (candidate.offer.acceptedAmount || candidate.offer.finalCtc)) || '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const inp2 = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
  const save = async () => {
    if (!offered.trim()) return alert('Enter what we offered.');
    setBusy(true);
    try { await hrApi(`/candidates/${candidate._id}/offer`, { method: 'POST', body: JSON.stringify({ op: 'set_hired_offer', candidateAsk: ask.trim(), offered: offered.trim(), note: note.trim() }) }); onSaved(); }
    catch (e) { alert(e.message); setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[120] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between"><div className="text-lg font-extrabold text-[#050A1F]">Set hired offer</div><button onClick={onClose} className="text-slate-400 text-xl leading-none">×</button></div>
        <div className="p-6 space-y-3">
          <div className="text-sm font-bold text-[#050A1F]">{titleCase(candidate.name)}</div>
          <div className="grid grid-cols-2 gap-3">
            <div><div className="text-[12px] font-bold text-slate-600 mb-1">Candidate ask</div><input className={inp2} value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="e.g. 10L" /></div>
            <div><div className="text-[12px] font-bold text-slate-600 mb-1">What we offered</div><input className={inp2} value={offered} onChange={(e) => setOffered(e.target.value)} placeholder="e.g. 8L" /></div>
          </div>
          <div><div className="text-[12px] font-bold text-slate-600 mb-1">Remark</div><textarea rows={3} className={inp2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Any note about this offer…" /></div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: '#16A34A' }}>{busy ? 'Saving…' : 'Save offer'}</button>
        </div>
      </div>
    </div>
  );
}

// Resume Match badge with the exact colour treatments Adam specified.
export function ResumeMatchBadge({ match, size = 'sm' }) {
  const level = match && match.level ? match.level : 'not_available';
  const styles = {
    high: { bg: '#DCFCE7', fg: '#15803D', label: 'High' },
    medium: { bg: '#FEF9C3', fg: '#A16207', label: 'Medium' },
    low: { bg: '#FEE2E2', fg: '#B91C1C', label: 'Low' },
    not_available: { bg: '#F1F5F9', fg: '#64748B', label: 'Not available' },
  };
  const s = styles[level] || styles.not_available;
  const pad = size === 'lg' ? 'px-3 py-1 text-xs' : 'px-2 py-0.5 text-[11px]';
  const hasScore = match && typeof match.score === 'number' && level !== 'not_available';
  return (
    <span className={`inline-flex items-center rounded-full font-bold ${pad}`} style={{ background: s.bg, color: s.fg }} title={match && match.reason ? match.reason : (level === 'not_available' ? 'No resume or profile data to score.' : `${s.label} match`)}>
      {hasScore ? match.score : s.label}
    </span>
  );
}

function CandIconBtn({ icon, label, onClick }) {
  const paths = {
    eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z',
    // A speech-bubble note icon (distinct from the edit/pencil used elsewhere).
    note: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
    trash: 'M3 6h18M8 6V4h8v2m-9 0v14h10V6M10 11v6M14 11v6',
    // Info-circle for the rejection reason (matches the info style used elsewhere).
    info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 8h.01M11 12h1v4h1',
    edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
    clipboard: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 12h6M9 16h4',
  };
  const extra = icon === 'eye' ? <circle cx="12" cy="12" r="3" /> : null;
  const danger = icon === 'trash';
  return (
    <button onClick={onClick} title={label} aria-label={label} className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border transition ${danger ? 'border-red-200 text-red-400 hover:bg-red-50 hover:text-red-500' : 'border-slate-300 text-slate-500 hover:bg-slate-50'}`}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={paths[icon]} />{extra}</svg>
    </button>
  );
}

// Bulk action modal: move stage, assign recruiter, or reject (with reason).
function BulkActionModal({ action, ids, jobs, stages, onClose, onDone }) {
  const [stage, setStage] = useState('');
  const [recruiterId, setRecruiterId] = useState('');
  const [reason, setReason] = useState('');
  const [reasons, setReasons] = useState([]);
  const [addingReason, setAddingReason] = useState(false);
  const [newReason, setNewReason] = useState('');
  const addReason = async () => {
    const v = newReason.trim(); if (!v) return;
    try { const r = await hrApi('/rejection-reasons', { method: 'POST', body: JSON.stringify({ reason: v }) }); setReasons(r.reasons || []); setReason(v); setNewReason(''); setAddingReason(false); } catch (e) { alert(e.message); }
  };
  const [emps, setEmps] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (action === 'reject') hrApi('/rejection-reasons').then((r) => setReasons(r.reasons || [])).catch(() => {});
    if (action === 'assign') hrApi('/employees?hrDept=1').then((r) => setEmps(r || [])).catch(() => {});
  }, [action]);
  const run = async () => {
    setBusy(true);
    try {
      const body = { ids, action };
      if (action === 'move') body.stage = stage;
      if (action === 'assign') body.recruiterId = Number(recruiterId);
      if (action === 'reject') body.reason = reason;
      await hrApi('/candidates/bulk', { method: 'POST', body: JSON.stringify(body) });
      onDone();
    } catch (e) { alert(e.message); setBusy(false); }
  };
  const disabled = (action === 'move' && !stage) || (action === 'assign' && !recruiterId) || (action === 'reject' && !reason);
  const inp2 = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
  const title = action === 'move' ? 'Move to stage' : action === 'assign' ? 'Assign recruiter' : 'Reject candidates';
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[120] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100"><div className="text-lg font-extrabold text-[#050A1F]">{title}</div><div className="text-xs text-slate-400">{ids.length} candidate(s)</div></div>
        <div className="p-6">
          {action === 'move' && (
            <select className={inp2} value={stage} onChange={(e) => setStage(e.target.value)}>
              <option value="">Choose a stage…</option>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          )}
          {action === 'assign' && (
            <select className={inp2} value={recruiterId} onChange={(e) => setRecruiterId(e.target.value)}>
              <option value="">Choose a recruiter…</option>
              {emps.map((e) => <option key={e._id} value={e._id}>{e.name}{e.department ? ` · ${e.department}` : ''}</option>)}
            </select>
          )}
          {action === 'reject' && (
            <div>
              <select className={inp2} value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="">Choose a reason…</option>
                {reasons.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              {addingReason ? (
                <div className="flex gap-2 mt-2">
                  <input className={inp2} value={newReason} onChange={(e) => setNewReason(e.target.value)} placeholder="New reason…" onKeyDown={(e) => { if (e.key === 'Enter') addReason(); }} />
                  <button onClick={addReason} className="rounded-lg px-3 py-2 text-xs font-bold text-white shrink-0" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>Add</button>
                </div>
              ) : <button onClick={() => setAddingReason(true)} className="text-xs font-bold text-orange-600 mt-2">+ Add a new reason</button>}
              <div className="text-[11px] text-slate-400 mt-1">A reason is required before rejecting.</div>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={run} disabled={busy || disabled} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: action === 'reject' ? '#DC2626' : 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>{busy ? 'Working…' : 'Apply'}</button>
        </div>
      </div>
    </div>
  );
}

// Quick "add note" modal (posts a comment).
function QuickNoteModal({ candidateId, onClose, onSaved }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => { if (!text.trim()) return; setBusy(true); try { await hrApi(`/candidates/${candidateId}/comments`, { method: 'POST', body: JSON.stringify({ text: text.trim() }) }); onSaved(); } catch { setBusy(false); } };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[120] p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="text-lg font-extrabold text-[#050A1F] mb-3">Add note</div>
        <textarea className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a note about this candidate…" autoFocus />
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : 'Save note'}</button>
        </div>
      </div>
    </div>
  );
}

// Lightweight edit for the key candidate fields.
function EditCandidateModal({ candidateId, jobs, onClose, onSaved }) {
  const [c, setC] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { hrApi(`/candidates/${candidateId}`).then(setC).catch(() => {}); }, [candidateId]);
  if (!c) return null;
  const a = c.answers || {};
  const setA = (k, v) => setC((s) => ({ ...s, answers: { ...(s.answers || {}), [k]: v } }));
  const save = async () => {
    setBusy(true);
    try {
      await hrApi(`/candidates/${candidateId}`, { method: 'PATCH', body: JSON.stringify({ name: c.name, email: c.email, phone: normalizePhone(c.phone), jobPostId: c.jobPostId, answers: c.answers }) });
      onSaved();
    } catch { setBusy(false); }
  };
  const F = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[120] p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-2xl max-h-[88vh] overflow-auto">
        <div className="text-lg font-extrabold text-[#050A1F] mb-4">Edit candidate</div>
        <div className="grid grid-cols-2 gap-3">
          <div><CandL>Name</CandL><input className={F} value={c.name || ''} onChange={(e) => setC({ ...c, name: e.target.value })} /></div>
          <div><CandL>Phone</CandL><input className={F} value={c.phone || ''} onChange={(e) => setC({ ...c, phone: e.target.value })} /></div>
          <div><CandL>Email</CandL><input className={F} value={c.email || ''} onChange={(e) => setC({ ...c, email: e.target.value })} /></div>
          <div><CandL>Position</CandL><select className={F} value={c.jobPostId || ''} onChange={(e) => setC({ ...c, jobPostId: Number(e.target.value) })}><option value="">—</option>{jobs.map((j) => <option key={j._id} value={j._id}>{j.title}</option>)}</select></div>
          <div><CandL>Current Salary</CandL><input className={F} value={a.currentCtc || ''} onChange={(e) => setA('currentCtc', e.target.value)} /></div>
          <div><CandL>Expected Salary</CandL><input className={F} value={a.expectedCtc || ''} onChange={(e) => setA('expectedCtc', e.target.value)} /></div>
          <div><CandL>Notice Period (days)</CandL><input className={F} value={a.noticePeriod || ''} onChange={(e) => setA('noticePeriod', e.target.value)} /></div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
function L({ children }) { return <div className="text-[11px] font-bold text-slate-500 mb-1">{children}</div>; }

// Resume/file upload to ImageKit (HRMS/<Job>/Resumes), with a link fallback.
function ResumeUpload({ jobPostId, value, onChange, kind = 'resume' }) {
  const [status, setStatus] = useState('');
  const ref = React.useRef(null);
  const doUpload = async (file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setStatus('File too large (max 5MB).'); return; }
    setStatus('Uploading…');
    try {
      const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
      const out = await hrApi('/candidates/upload', { method: 'POST', body: JSON.stringify({ base64: b64, fileName: file.name, kind, jobPostId }) });
      onChange(out.url); setStatus(`✅ ${file.name}`);
    } catch (e) { setStatus(e.message || 'Upload failed. Paste a link below instead.'); }
  };
  return (
    <div>
      <div onClick={() => ref.current?.click()}
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); doUpload(e.dataTransfer.files?.[0]); }}
        className="border border-dashed border-slate-300 rounded-lg px-4 py-4 text-center text-sm text-slate-500 cursor-pointer hover:border-orange-400">
        {value ? <span className="text-green-600 font-semibold">✅ Uploaded — click to replace</span> : <>Drop file here or click to upload<div className="text-xs text-slate-400">Only .doc, .docx, .pdf, image · max 5MB</div></>}
        <input ref={ref} type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" className="hidden" onChange={(e) => doUpload(e.target.files?.[0])} />
      </div>
      {status && <div className="text-xs text-slate-500 mt-1">{status}</div>}
      <input className={inp + ' mt-2'} value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder="…or paste a resume link" />
    </div>
  );
}

// Add-candidate modal: choose Upload resume (AI autofill) or Add manually,
// then a full accordion form. Screening questions come from the job post.
const CAND_EMPTY = {
  firstName: '', lastName: '', phone: '', email: '', currentCtc: '', expectedCtc: '', noticePeriod: '',
  resumeUrl: '', isFresher: false, work: [{ company: '', title: '', start: '', end: '', current: false }],
  portfolio: '', skills: [], education: [{ type: '', course: '', specialization: '', institute: '', start: '', end: '' }],
  address: '', country: '', state: '', city: '', dob: '', gender: '', maritalStatus: '',
  linkedin: '', github: '', facebook: '', instagram: '', twitter: '', profileUrl: '',
  answers: {},
};

// Module-level so they keep a stable identity across renders — defining these
// inside AddCandidateModal remounted every input on each keystroke (focus loss).
function CandL({ children, req }) { return <p className="text-[12px] font-bold text-slate-600 mb-1">{children}{req && <span className="text-red-500">*</span>}</p>; }
function CandSection({ id, title, open, setOpen, children }) {
  return (
    <div className="border border-slate-200 rounded-xl mb-3 overflow-hidden">
      <button onClick={() => setOpen((o) => ({ ...o, [id]: !o[id] }))} className="w-full flex items-center justify-between px-4 py-3 bg-slate-50">
        <span className="font-bold text-[#050A1F] capitalize">{title}</span>
        <span className="text-slate-400">{open[id] ? '▲' : '▼'}</span>
      </button>
      {open[id] && <div className="p-4">{children}</div>}
    </div>
  );
}

function AddCandidateModal({ job, onClose, onSaved }) {
  const [c, setC] = useState(CAND_EMPTY);
  const [open, setOpen] = useState({ basic: true, work: false, edu: false, addl: false, screen: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [prog, setProg] = useState(null); // {pct,label} during resume autofill
  const [dups, setDups] = useState([]); // existing candidates with same email/phone
  const [resumeText, setResumeText] = useState('');
  const [source, setSource] = useState('manual');
  const autofillRef = React.useRef(null);
  const set = (patch) => setC((s) => ({ ...s, ...patch }));

  // Warn if a candidate with the same email/phone already exists.
  const checkDup = async () => {
    if (!c.email && !c.phone) return;
    try {
      const params = new URLSearchParams();
      if (c.email) params.set('email', c.email);
      if (c.phone) params.set('phone', c.phone);
      const r = await hrApi(`/candidates/check-duplicate?${params.toString()}`);
      setDups(r.duplicates || []);
    } catch { /* non-fatal */ }
  };

  // Upload a resume and let AI autofill the form (server extracts text).
  const autofillFromResume = async (file) => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { setErr('File too large (max 8MB).'); return; }
    setErr(''); setProg({ pct: 15, label: 'Reading file…' });
    try {
      const base64 = await fileToBase64(file);
      setProg({ pct: 40, label: 'Extracting text…' });
      let done = 40;
      const timer = setInterval(() => { done = Math.min(90, done + 6); setProg({ pct: done, label: 'AI is reading the resume…' }); }, 250);
      let p;
      try { p = await hrApi('/candidates/ai/parse-resume', { method: 'POST', body: JSON.stringify({ base64, fileName: file.name }) }); }
      finally { clearInterval(timer); }
      setProg({ pct: 100, label: 'Done' });
      if (p._text) setResumeText(p._text);
      // Also upload the same file as the candidate's resume so it doesn't have
      // to be uploaded a second time. Best-effort — parsing already succeeded.
      let uploadedUrl = '';
      try {
        const up = await hrApi('/candidates/upload', { method: 'POST', body: JSON.stringify({ base64, fileName: file.name, kind: 'resume', jobPostId: job._id }) });
        uploadedUrl = up.url || '';
      } catch {}
      setC((s) => ({
        ...s,
        resumeUrl: uploadedUrl || s.resumeUrl,
        firstName: p.firstName || s.firstName, lastName: p.lastName || s.lastName,
        email: p.email || s.email, phone: p.phone || s.phone,
        currentCtc: p.currentCtc || s.currentCtc, expectedCtc: p.expectedCtc || s.expectedCtc,
        noticePeriod: p.noticePeriod || s.noticePeriod,
        address: p.address || s.address, country: p.country || s.country, state: p.state || s.state, city: p.city || s.city,
        dob: p.dob || s.dob, gender: (p.gender || '').toUpperCase() || s.gender, maritalStatus: (p.maritalStatus || '').toUpperCase() || s.maritalStatus,
        linkedin: p.linkedin || s.linkedin, github: p.github || s.github, portfolio: p.portfolio || s.portfolio,
        twitter: p.twitter || s.twitter, facebook: p.facebook || s.facebook, instagram: p.instagram || s.instagram,
        skills: (p.skills && p.skills.length) ? p.skills : s.skills,
        work: (p.workExperience && p.workExperience.length) ? p.workExperience.map((w) => ({ company: w.company || '', title: w.title || '', start: w.start || '', end: w.end || '', current: !!w.current })) : s.work,
        education: (p.education && p.education.length) ? p.education.map((e) => ({ type: e.type || '', course: e.course || '', specialization: e.specialization || '', institute: e.institute || '', start: e.start || '', end: e.end || '' })) : s.education,
      }));
      setOpen({ basic: true, work: true, edu: true, addl: true, screen: true });
      setTimeout(() => setProg(null), 700);
    } catch (e) { setErr(e.message); setProg(null); }
  };

  const save = async () => {
    if (!c.firstName.trim() || !c.email.trim()) { setErr('First name and email are required.'); setOpen((o) => ({ ...o, basic: true })); return; }
    setBusy(true); setErr('');
    try {
      await hrApi('/candidates', { method: 'POST', body: JSON.stringify({
        firstName: c.firstName, lastName: c.lastName, email: c.email, phone: normalizePhone(c.phone),
        jobPostId: job._id, resumeUrl: c.resumeUrl, currentLocation: c.city || c.address, resumeText, source,
        answers: {
          ...c.answers,
          currentCtc: c.currentCtc, expectedCtc: c.expectedCtc, noticePeriod: c.noticePeriod,
          isFresher: c.isFresher, work: c.work, portfolio: c.portfolio, skills: c.skills,
          education: c.education, address: c.address, country: c.country, state: c.state, city: c.city,
          dob: c.dob, gender: c.gender, maritalStatus: c.maritalStatus,
          linkedin: c.linkedin, github: c.github, facebook: c.facebook, instagram: c.instagram, twitter: c.twitter, profileUrl: c.profileUrl,
        },
      }) });
      onSaved();
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[120] p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="text-lg font-extrabold text-[#050A1F]">Add Candidate {job ? `to ${job.title}` : ''}</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
        </div>

        <>
            <div className="p-6 overflow-auto flex-1">
              {err && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm px-3 py-2">{err}</div>}
              {dups.length > 0 && (
                <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm px-3 py-2">
                  <b>Possible duplicate:</b> a candidate with this email/phone already exists — {dups.map((d) => d.name).join(', ')}. You can still add them, but check first.
                </div>
              )}

              {/* Autofill from resume */}
              <div className="rounded-xl border border-dashed border-orange-300 bg-orange-50/50 p-4 mb-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-extrabold text-[#050A1F]">Upload a resume to autofill</div>
                    <div className="text-xs text-slate-500">PDF or Word. AI reads it and fills the fields below — you can edit anything.</div>
                  </div>
                  <button onClick={() => !prog && autofillRef.current?.click()} disabled={!!prog} className="rounded-lg px-4 py-2 text-sm font-bold text-white shrink-0 disabled:opacity-60" style={{ background: ORANGE }}>
                    {prog ? 'Reading…' : '📄 Upload & autofill'}
                  </button>
                  <input ref={autofillRef} type="file" accept=".pdf,.doc,.docx,.txt" className="hidden" onChange={(e) => autofillFromResume(e.target.files?.[0])} />
                </div>
                {prog && (
                  <div className="mt-3">
                    <div className="h-2 rounded-full bg-slate-200 overflow-hidden"><div className="h-full rounded-full transition-all duration-300" style={{ width: `${Math.max(5, Math.min(100, prog.pct))}%`, background: ORANGE }} /></div>
                    <div className="text-[11px] text-slate-500 mt-1">{prog.label} {prog.pct >= 100 ? '✓' : `${Math.round(prog.pct)}%`}</div>
                  </div>
                )}
                {!prog && c.resumeUrl && (
                  <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-green-700">
                    <span>✓</span><span>Resume attached.</span>
                    <a href={c.resumeUrl} target="_blank" rel="noreferrer" className="text-orange-600 underline">View</a>
                  </div>
                )}
              </div>

              <CandSection id="basic" title="Basic Information" open={open} setOpen={setOpen}>
                <div className="grid grid-cols-2 gap-4">
                  <div><CandL req>First Name</CandL><input className={inp} value={c.firstName} onChange={(e) => set({ firstName: e.target.value })} /></div>
                  <div><CandL req>Last Name</CandL><input className={inp} value={c.lastName} onChange={(e) => set({ lastName: e.target.value })} /></div>
                  <div><CandL>Contact Number</CandL><input className={inp} value={c.phone} onChange={(e) => set({ phone: e.target.value })} onBlur={(e) => { const norm = normalizePhone(e.target.value); if (norm !== c.phone) set({ phone: norm }); checkDup(); }} placeholder="+91…" /></div>
                  <div><CandL req>Email Address</CandL><input className={inp} value={c.email} onChange={(e) => set({ email: e.target.value })} onBlur={checkDup} /></div>
                  <div><CandL>Current Salary (Monthly)</CandL><input className={inp} value={c.currentCtc} onChange={(e) => set({ currentCtc: e.target.value })} placeholder="Ex: 35,000" /></div>
                  <div><CandL>Expected Salary (Monthly)</CandL><input className={inp} value={c.expectedCtc} onChange={(e) => set({ expectedCtc: e.target.value })} placeholder="Ex: 55,000" /></div>
                  <div><CandL>Notice Period (days)</CandL><input className={inp} type="number" value={c.noticePeriod} onChange={(e) => set({ noticePeriod: e.target.value })} /></div>
                  <div><CandL>Source</CandL>
                    <select className={inp} value={source} onChange={(e) => setSource(e.target.value)}>
                      <option value="manual">Manual</option>
                      <option value="linkedin">LinkedIn</option>
                      <option value="naukri">Naukri</option>
                      <option value="indeed">Indeed</option>
                      <option value="referral">Referral</option>
                    </select>
                  </div>
                  <div className="col-span-2"><CandL>Resume</CandL>
                    <ResumeUpload jobPostId={job._id} value={c.resumeUrl} onChange={(url) => set({ resumeUrl: url })} />
                  </div>
                </div>
              </CandSection>

              <CandSection id="work" title="Work Information" open={open} setOpen={setOpen}>
                <label className="flex items-center gap-2 text-sm text-slate-600 mb-3"><input type="checkbox" checked={c.isFresher} onChange={(e) => set({ isFresher: e.target.checked })} /> I am a recent graduate</label>
                {!c.isFresher && (c.work || []).map((w, i) => (
                  <div key={i} className="grid grid-cols-3 gap-3 mb-3 pb-3 border-b border-slate-100 last:border-0">
                    <div><CandL>Company Name</CandL><input className={inp} value={w.company} onChange={(e) => set({ work: c.work.map((x, idx) => idx === i ? { ...x, company: e.target.value } : x) })} /></div>
                    <div><CandL>Job Title</CandL><input className={inp} value={w.title} onChange={(e) => set({ work: c.work.map((x, idx) => idx === i ? { ...x, title: e.target.value } : x) })} /></div>
                    <div className="flex gap-2 items-end">
                      <div className="flex-1"><CandL>From</CandL><input className={inp} value={w.start} onChange={(e) => set({ work: c.work.map((x, idx) => idx === i ? { ...x, start: e.target.value } : x) })} placeholder="MM/YYYY" /></div>
                      <div className="flex-1"><CandL>To</CandL><input className={inp} value={w.end} disabled={w.current} onChange={(e) => set({ work: c.work.map((x, idx) => idx === i ? { ...x, end: e.target.value } : x) })} placeholder="MM/YYYY" /></div>
                    </div>
                    <label className="col-span-3 flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" checked={w.current} onChange={(e) => set({ work: c.work.map((x, idx) => idx === i ? { ...x, current: e.target.checked } : x) })} /> I currently work here</label>
                  </div>
                ))}
                {!c.isFresher && <button onClick={() => set({ work: [...c.work, { company: '', title: '', start: '', end: '', current: false }] })} className="text-xs font-bold text-orange-600">+ Add Work Experience</button>}
                <div className="mt-3"><CandL>Work Link / Online Portfolio</CandL><input className={inp} value={c.portfolio} onChange={(e) => set({ portfolio: e.target.value })} /></div>
                <div className="mt-3"><CandL>Skills</CandL>
                  <div className="flex flex-wrap gap-1.5 mb-2">{(c.skills || []).map((s, i) => <span key={i} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold">{s}<button onClick={() => set({ skills: c.skills.filter((_, idx) => idx !== i) })} className="text-slate-400 hover:text-red-500">×</button></span>)}</div>
                  <input className={inp} placeholder="Type a skill, press Enter" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const v = e.target.value.trim(); if (v && !c.skills.includes(v)) set({ skills: [...c.skills, v] }); e.target.value = ''; } }} />
                </div>
              </CandSection>

              <CandSection id="edu" title="Educational Information" open={open} setOpen={setOpen}>
                {(c.education || []).map((ed, i) => (
                  <div key={i} className="grid grid-cols-3 gap-3 mb-3 pb-3 border-b border-slate-100 last:border-0">
                    <div><CandL>Type</CandL><input className={inp} value={ed.type} onChange={(e) => set({ education: c.education.map((x, idx) => idx === i ? { ...x, type: e.target.value } : x) })} placeholder="Bachelor's…" /></div>
                    <div><CandL>Course</CandL><input className={inp} value={ed.course} onChange={(e) => set({ education: c.education.map((x, idx) => idx === i ? { ...x, course: e.target.value } : x) })} /></div>
                    <div><CandL>Specialization</CandL><input className={inp} value={ed.specialization} onChange={(e) => set({ education: c.education.map((x, idx) => idx === i ? { ...x, specialization: e.target.value } : x) })} /></div>
                    <div className="col-span-2"><CandL>Institute Name</CandL><input className={inp} value={ed.institute} onChange={(e) => set({ education: c.education.map((x, idx) => idx === i ? { ...x, institute: e.target.value } : x) })} /></div>
                    <div className="flex gap-2 items-end">
                      <div className="flex-1"><CandL>From</CandL><input className={inp} value={ed.start} onChange={(e) => set({ education: c.education.map((x, idx) => idx === i ? { ...x, start: e.target.value } : x) })} /></div>
                      <div className="flex-1"><CandL>To</CandL><input className={inp} value={ed.end} onChange={(e) => set({ education: c.education.map((x, idx) => idx === i ? { ...x, end: e.target.value } : x) })} /></div>
                    </div>
                  </div>
                ))}
                <button onClick={() => set({ education: [...c.education, { type: '', course: '', specialization: '', institute: '', start: '', end: '' }] })} className="text-xs font-bold text-orange-600">+ Add Educational Details</button>
              </CandSection>

              <CandSection id="addl" title="Additional Information" open={open} setOpen={setOpen}>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2"><CandL>Address</CandL><input className={inp} value={c.address} onChange={(e) => set({ address: e.target.value })} /></div>
                  <div><CandL>Country</CandL><input className={inp} value={c.country} onChange={(e) => set({ country: e.target.value })} /></div>
                  <div><CandL>State</CandL><input className={inp} value={c.state} onChange={(e) => set({ state: e.target.value })} /></div>
                  <div><CandL>City</CandL><input className={inp} value={c.city} onChange={(e) => set({ city: e.target.value })} /></div>
                  <div><CandL>Date Of Birth</CandL><input className={inp} value={c.dob} onChange={(e) => set({ dob: e.target.value })} placeholder="DD/MM/YYYY" /></div>
                  <div><CandL>Gender</CandL>
                    <div className="flex gap-3 mt-1">{['MALE', 'FEMALE', 'OTHER'].map((g) => <label key={g} className="flex items-center gap-1 text-sm"><input type="radio" name="gender" checked={c.gender === g} onChange={() => set({ gender: g })} /> {g === 'OTHER' ? 'Prefer not to say' : g[0] + g.slice(1).toLowerCase()}</label>)}</div>
                  </div>
                  <div><CandL>Marital Status</CandL>
                    <div className="flex gap-3 mt-1">{['MARRIED', 'SINGLE', 'OTHER'].map((g) => <label key={g} className="flex items-center gap-1 text-sm"><input type="radio" name="marital" checked={c.maritalStatus === g} onChange={() => set({ maritalStatus: g })} /> {g === 'OTHER' ? 'Prefer not to say' : g[0] + g.slice(1).toLowerCase()}</label>)}</div>
                  </div>
                  <div><CandL>LinkedIn</CandL><input className={inp} value={c.linkedin} onChange={(e) => set({ linkedin: e.target.value })} /></div>
                  <div><CandL>GitHub</CandL><input className={inp} value={c.github} onChange={(e) => set({ github: e.target.value })} /></div>
                  <div><CandL>Facebook</CandL><input className={inp} value={c.facebook} onChange={(e) => set({ facebook: e.target.value })} /></div>
                  <div><CandL>Instagram</CandL><input className={inp} value={c.instagram} onChange={(e) => set({ instagram: e.target.value })} /></div>
                  <div><CandL>Twitter</CandL><input className={inp} value={c.twitter} onChange={(e) => set({ twitter: e.target.value })} /></div>
                  <div><CandL>Profile Link</CandL><input className={inp} value={c.profileUrl} onChange={(e) => set({ profileUrl: e.target.value })} /></div>
                </div>
              </CandSection>

              {(job.questions || []).length > 0 && (
                <CandSection id="screen" title="Screening Questions" open={open} setOpen={setOpen}>
                  {(job.questions || []).map((q) => (
                    <div key={q.id} className="mb-3">
                      <CandL req={q.mandatory}>{q.question}</CandL>
                      {q.type === 'multi' ? <textarea className={inp} rows={3} value={c.answers[q.id] || ''} onChange={(e) => set({ answers: { ...c.answers, [q.id]: e.target.value } })} />
                        : q.type === 'yesno' ? <select className={inp} value={c.answers[q.id] || ''} onChange={(e) => set({ answers: { ...c.answers, [q.id]: e.target.value } })}><option value="">— Select —</option><option>Yes</option><option>No</option></select>
                        : q.type === 'multiple' ? <select className={inp} value={c.answers[q.id] || ''} onChange={(e) => set({ answers: { ...c.answers, [q.id]: e.target.value } })}><option value="">— Select —</option>{(q.options || []).map((o) => <option key={o}>{o}</option>)}</select>
                        : <input className={inp} value={c.answers[q.id] || ''} onChange={(e) => set({ answers: { ...c.answers, [q.id]: e.target.value } })} />}
                    </div>
                  ))}
                </CandSection>
              )}
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={onClose} className="rounded-lg border border-slate-300 px-5 py-2 text-sm font-bold text-slate-600">Cancel</button>
              <button onClick={save} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : 'Add Candidate'}</button>
            </div>
          </>
      </div>
    </div>
  );
}

// Lightweight reason capture when a candidate is dragged/moved to a rejected
// stage from the pipeline. Posts the reason to the stage endpoint.
function StageRejectModal({ candidate, onClose, onDone }) {
  const REASONS = ['Skills mismatch', 'Insufficient experience', 'Salary expectations too high', 'Location / relocation', 'Notice period too long', 'Failed interview', 'Position filled', 'Other'];
  const [reason, setReason] = useState('');
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const finalReason = reason === 'Other' ? custom.trim() : reason;
  const submit = async () => {
    if (!finalReason) return;
    setBusy(true);
    try { await hrApi(`/candidates/${candidate._id}/stage`, { method: 'PATCH', body: JSON.stringify({ stage: 'rejected', reason: finalReason }) }); onDone(); }
    catch (e) { alert(e.message); setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between"><div className="text-lg font-extrabold text-[#050A1F]">Reason for rejection</div><button onClick={onClose} className="text-slate-400 text-xl leading-none">×</button></div>
        <div className="p-6 space-y-3">
          <div className="text-sm text-slate-500">Why is <b className="text-[#050A1F]">{titleCase(candidate.name)}</b> being rejected?</div>
          <select className={inp} value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">— select a reason —</option>
            {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          {reason === 'Other' && <textarea className={inp} rows={3} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Describe the reason…" />}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={submit} disabled={busy || !finalReason} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: '#DC2626' }}>{busy ? 'Rejecting…' : 'Confirm rejection'}</button>
        </div>
      </div>
    </div>
  );
}

function RecruitPipeline({ jobs, scope, onDetailOpen }) {
  const published = jobs.filter((j) => j.status === 'published' || j.status === 'paused');
  const [jobId, setJobId] = useState(published[0]?._id || null);
  const [cands, setCands] = useState([]);
  const [viewId, setViewId] = useState(null);
  useEffect(() => { if (onDetailOpen) onDetailOpen(!!viewId); }, [viewId]);
  const [dragId, setDragId] = useState(null);
  const [moveFor, setMoveFor] = useState(null); // candidate to move via popup
  const [me, setMe] = useState(null);
  const [stageSearch, setStageSearch] = useState({}); // { [stageId]: query } for stages with many cards
  const load = () => { if (jobId) hrApi(`/candidates?jobPostId=${jobId}`).then(setCands).catch(() => {}); };
  useEffect(() => { load(); }, [jobId]);
  useEffect(() => { hrApi('/profile-me').then(setMe).catch(() => {}); }, []);
  const job = jobs.find((j) => j._id === jobId);
  const stages = (job && job.stages) || [];
  const myId = me && (me._id || me.id);
  const isMine = (c) => myId && (c.recruiterId === myId || (me.name && c.recruiterName === me.name));
  // Scope ('mine' | 'all') is controlled from the recruitment tab row.
  const mine = scope === 'mine';
  const visible = mine ? cands.filter(isMine) : cands;
  const [rejectFor, setRejectFor] = useState(null); // candidate being rejected via stage move
  const move = async (c, stage) => {
    if (c.stage === stage) return;
    setCands((cs) => cs.map((x) => x._id === c._id ? { ...x, stage } : x));
    try {
      const updated = await hrApi(`/candidates/${c._id}/stage`, { method: 'PATCH', body: JSON.stringify({ stage }) });
      if (updated && updated.needsReason) {
        // Moving to a rejected stage — open the reason popup instead.
        setCands((cs) => cs.map((x) => x._id === c._id ? { ...x, stage: c.stage } : x));
        setRejectFor(c);
      } else if (updated && updated.offerIncomplete) {
        setCands((cs) => cs.map((x) => x._id === c._id ? { ...x, stage: updated.stage } : x));
        setViewId(c._id);
      } else if (updated && updated.stage) {
        setCands((cs) => cs.map((x) => x._id === c._id ? { ...x, stage: updated.stage } : x));
      }
    } catch (e) { alert(e.message); load(); }
  };
  if (!published.length) return <div className="bg-white rounded-2xl border border-slate-200/70 p-12 text-center text-slate-400 text-sm">Publish a job to see its pipeline.</div>;
  if (viewId) return <HrCandidateView candidateId={viewId} onBack={() => { setViewId(null); load(); }} />;
  const softBg = (hex) => `${hex}14`;
  const RC = { high: '#15803D', medium: '#A16207', low: '#B91C1C', not_available: '#94A3B8' };
  const RBG = { high: '#DCFCE7', medium: '#FEF9C3', low: '#FEE2E2', not_available: '#F1F5F9' };
  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <select className={inp + ' max-w-xs'} value={jobId || ''} onChange={(e) => setJobId(Number(e.target.value))}>
            {published.map((j) => <option key={j._id} value={j._id}>{j.title}</option>)}
          </select>
        </div>
        <div className="text-sm text-slate-400">{visible.length} candidates · drag or use ⇄ to move</div>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {stages.map((s) => {
          const colAll = visible.filter((c) => c.stage === s.id && !c.rejected);
          const sq = (stageSearch[s.id] || '').trim().toLowerCase();
          const col = sq ? colAll.filter((c) => `${c.name || ''} ${c.email || ''} ${c.phone || ''}`.toLowerCase().includes(sq)) : colAll;
          return (
            <div key={s.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { const d = cands.find((x) => x._id === dragId); if (d) move(d, s.id); setDragId(null); }}
              className="shrink-0 w-72 rounded-3xl p-3" style={{ background: softBg(s.color) }}>
              <div className="flex items-center justify-between px-2 pt-1 pb-3">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                  <span className="text-sm font-extrabold text-[#050A1F]">{s.label}</span>
                  <span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-white/70" style={{ color: s.color }}>{colAll.length}</span>
                </div>
              </div>
              {/* Search within a busy stage (more than 4 candidates). */}
              {colAll.length > 4 && (
                <div className="px-1 pb-2">
                  <input value={stageSearch[s.id] || ''} onChange={(e) => setStageSearch((m) => ({ ...m, [s.id]: e.target.value }))}
                    placeholder={`Search ${s.label.toLowerCase()}…`}
                    className="w-full rounded-lg border border-slate-200 bg-white/80 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-300" />
                </div>
              )}
              <div className="space-y-3 min-h-[160px] max-h-[calc(100vh-300px)] overflow-y-auto pr-1">
                {col.length === 0 && sq && <div className="text-[11px] text-slate-400 px-2 py-3 text-center">No matches in this stage.</div>}
                {col.map((c) => {
                  const a = c.answers || {};
                  const rm = c.resumeMatch || {};
                  const score = typeof rm.score === 'number' ? rm.score : null;
                  const rlevel = rm.level || 'not_available';
                  const rating = Number(c.rating) || 0;
                  return (
                    <div key={c._id} draggable
                      onDragStart={() => setDragId(c._id)}
                      className="group bg-white rounded-2xl border border-slate-100 p-4 cursor-grab active:cursor-grabbing hover:shadow-lg hover:-translate-y-0.5 transition-all relative">
                      <button onClick={(e) => { e.stopPropagation(); setMoveFor(c); }} title="Move to stage" className="absolute top-2 right-2 w-7 h-7 rounded-lg bg-slate-50 border border-slate-200 text-slate-500 hover:bg-orange-50 hover:text-orange-600 flex items-center justify-center opacity-0 group-hover:opacity-100 transition z-10">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3L4 7l4 4" /><path d="M4 7h16" /><path d="M16 21l4-4-4-4" /><path d="M20 17H4" /></svg>
                      </button>
                      <div onClick={() => setViewId(c._id)}>
                        {/* Top row: name + AI score badge on the right */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 pr-1">
                            <div className="font-extrabold text-sm text-[#050A1F] leading-snug truncate">{c.name}{c.cold && <span className="ml-1.5 align-middle rounded-full bg-cyan-100 text-cyan-700 px-1.5 py-0.5 text-[9px] font-bold">❄️ Cold</span>}</div>
                            {c.email && <div className="text-[11px] text-slate-400 mt-0.5 truncate">{c.email}</div>}
                          </div>
                          {score != null && (
                            <div className="shrink-0 text-center rounded-lg px-2 py-1 mt-0.5" style={{ background: RBG[rlevel], color: RC[rlevel] }} title={`AI match: ${rlevel}`}>
                              <div className="text-[13px] font-extrabold leading-none">{score}</div>
                              <div className="text-[8px] font-bold uppercase tracking-wide leading-none mt-0.5">AI</div>
                            </div>
                          )}
                        </div>
                        {/* Rating stars */}
                        <div className="flex items-center gap-0.5 mt-2">
                          {[1, 2, 3, 4, 5].map((n) => (
                            <svg key={n} width="13" height="13" viewBox="0 0 24 24" fill={n <= rating ? '#F59E0B' : 'none'} stroke={n <= rating ? '#F59E0B' : '#CBD5E1'} strokeWidth="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" /></svg>
                          ))}
                          {rating === 0 && <span className="text-[10px] text-slate-300 ml-1">Not rated</span>}
                        </div>
                        <div className="flex items-center gap-2 mt-2 text-[11px] text-slate-500">
                          {totalExperience(c) !== '—' && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-semibold">{totalExperience(c)}</span>}
                          {a.currentCtc && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-semibold">{a.currentCtc}</span>}
                        </div>
                        {/* Assigned HR */}
                        <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-50">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold flex items-center justify-center shrink-0">{(c.recruiterName || c.name || '?').trim()[0]?.toUpperCase()}</span>
                            <span className="text-[10px] text-slate-500 font-semibold truncate">{c.recruiterName || 'Unassigned'}</span>
                          </div>
                          <span className="text-[10px] text-slate-400 shrink-0">{timeAgo(c.updatedAt)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {moveFor && <MoveStageModal candidate={moveFor} stages={stages} onClose={() => setMoveFor(null)} onMoved={(stage) => { move(moveFor, stage); setMoveFor(null); }} />}
      {rejectFor && <StageRejectModal candidate={rejectFor} onClose={() => setRejectFor(null)} onDone={() => { setRejectFor(null); load(); }} />}
    </div>
  );
}

// Single-click stage move — a popup that lists all stages (handy when there are
// many stages and dragging across columns is fiddly).
function MoveStageModal({ candidate, stages, onClose, onMoved }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[120] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100">
          <div className="text-base font-extrabold text-[#050A1F]">Move candidate</div>
          <div className="text-xs text-slate-400">{candidate.name} — pick a stage</div>
        </div>
        <div className="p-3 max-h-80 overflow-auto">
          {stages.map((s) => (
            <button key={s.id} onClick={() => onMoved(s.id)} disabled={s.id === candidate.stage}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left mb-1 ${s.id === candidate.stage ? 'bg-slate-50 cursor-default' : 'hover:bg-slate-50'}`}>
              <span className="w-3 h-3 rounded-full shrink-0" style={{ background: s.color }} />
              <span className="text-sm font-semibold text-slate-700 flex-1">{s.label}</span>
              {s.id === candidate.stage && <span className="text-[10px] font-bold text-slate-400">Current</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Interview hub: a calendar (month) + list toggle of all interviews the viewer
// is allowed to see (role-scoped by the backend), plus availability confirmations.
function MyInterviews() {
  const [view, setView] = useState('calendar'); // calendar | list
  const [interviews, setInterviews] = useState(null);
  const [reqs, setReqs] = useState([]);
  const [viewId, setViewId] = useState(null);
  const [monthCursor, setMonthCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [dayModal, setDayModal] = useState(null); // {dateKey, items}
  const [partModal, setPartModal] = useState(null); // interview whose participants are shown
  const [viewAction, setViewAction] = useState(null); // initial action for the candidate view
  const load = () => {
    hrApi('/all-interviews').then((r) => setInterviews(r.interviews || [])).catch(() => setInterviews([]));
    hrApi('/my-schedule-requests').then((r) => setReqs(r.requests || [])).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  const confirmSlots = async (candidateId, slotIds) => { try { await hrApi(`/candidates/${candidateId}/self-schedule/confirm`, { method: 'POST', body: JSON.stringify({ slotIds }) }); load(); } catch (e) { alert(e.message); } };
  // Jump to the candidate's Feedback tab and mark the interview completed.
  const completeFromPopup = (iv) => { setPartModal(null); setViewAction({ type: 'completeInterview', interviewId: iv.interviewId || iv.id }); setViewId(iv.candidateId); };
  if (viewId) return <HrCandidateView candidateId={viewId} initialTab={viewAction ? 'feedback' : undefined} initialAction={viewAction} onBack={() => { setViewId(null); setViewAction(null); load(); }} />;
  if (!interviews) return <div className="text-slate-400 text-sm">Loading…</div>;

  const dateKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const byDay = {};
  interviews.forEach((iv) => { if (!iv.at) return; const k = dateKey(iv.at); (byDay[k] = byDay[k] || []).push(iv); });

  // Month grid cells (leading blanks + days).
  const year = monthCursor.getFullYear(), month = monthCursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const todayKey = dateKey(new Date());
  const monthLabel = monthCursor.toLocaleString([], { month: 'long', year: 'numeric' });

  const upcoming = interviews.filter((iv) => new Date(iv.at) >= new Date(new Date().toDateString())).sort((a, b) => new Date(a.at) - new Date(b.at));

  return (
    <div>
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <h1 className="text-2xl font-extrabold text-[#050A1F]">Interviews</h1>
        <div className="inline-flex items-center gap-1 bg-slate-100 rounded-lg p-1">
          <button onClick={() => setView('calendar')} className={`px-4 py-1.5 rounded-md text-xs font-bold ${view === 'calendar' ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>Calendar</button>
          <button onClick={() => setView('list')} className={`px-4 py-1.5 rounded-md text-xs font-bold ${view === 'list' ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>List</button>
        </div>
      </div>
      <p className="text-sm text-slate-500 mb-6">All scheduled interviews you have access to. Open a candidate to submit feedback.</p>

      {reqs.length > 0 && (
        <div className="mb-6">
          <div className="text-sm font-extrabold text-[#050A1F] mb-2">⏳ Confirm your availability</div>
          <div className="space-y-3">{reqs.map((r) => <ConfirmAvailabilityCard key={r.candidateId} req={r} onConfirm={(ids) => confirmSlots(r.candidateId, ids)} />)}</div>
        </div>
      )}

      {view === 'calendar' ? (
        <div className="bg-white rounded-2xl border border-slate-200/70 p-4">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => setMonthCursor(new Date(year, month - 1, 1))} className="w-8 h-8 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">‹</button>
            <div className="text-sm font-extrabold text-[#050A1F]">{monthLabel}</div>
            <div className="flex items-center gap-2">
              <button onClick={() => { const d = new Date(); setMonthCursor(new Date(d.getFullYear(), d.getMonth(), 1)); }} className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-bold text-slate-500 hover:bg-slate-50">Today</button>
              <button onClick={() => setMonthCursor(new Date(year, month + 1, 1))} className="w-8 h-8 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">›</button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1 mb-1">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="text-center text-[10px] font-bold uppercase tracking-wide text-slate-400 py-1">{d}</div>)}</div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((d, i) => {
              if (d === null) return <div key={`b${i}`} className="min-h-[84px]" />;
              const k = dateKey(new Date(year, month, d));
              const items = byDay[k] || [];
              const isToday = k === todayKey;
              return (
                <div key={k} className={`min-h-[84px] rounded-lg border p-1.5 ${isToday ? 'border-orange-300 bg-orange-50/40' : 'border-slate-100'}`}>
                  <div className={`text-[11px] font-bold mb-1 ${isToday ? 'text-orange-600' : 'text-slate-400'}`}>{d}</div>
                  <div className="space-y-1">
                    {items.slice(0, 3).map((iv) => (
                      <button key={iv.interviewId} onClick={() => setPartModal(iv)} title={`${iv.candidateName} · ${new Date(iv.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                        className="w-full text-left rounded px-1.5 py-1 text-[10px] font-semibold text-white truncate" style={{ background: ORANGE }}>
                        {new Date(iv.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} {iv.candidateName}
                      </button>
                    ))}
                    {items.length > 3 && <button onClick={() => setDayModal({ dateKey: k, items })} className="w-full text-left text-[10px] font-bold text-slate-400 px-1">+{items.length - 3} more</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        upcoming.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200/70 p-12 text-center text-slate-400 text-sm">No upcoming interviews.</div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden divide-y divide-slate-50">
            {upcoming.map((iv) => (
              <div key={iv.interviewId} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50/60 gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-700">{iv.candidateName} <span className="text-xs font-normal text-slate-400">· {iv.jobTitle}</span></div>
                  <div className="text-xs text-slate-400">{iv.roundLabel || 'Interview'} · {new Date(iv.at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                  <div className="flex items-center gap-4 mt-1.5 flex-wrap">
                    {/* Who scheduled it — circle photo + HR name */}
                    {iv.scheduledBy && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-300">Scheduled by</span>
                        <Avatar name={iv.scheduledBy} src={iv.scheduledByAvatar} size={20} />
                        <span className="text-[11px] font-semibold text-slate-500">{titleCase(iv.scheduledBy)}</span>
                      </div>
                    )}
                    {/* Attendees — first name + circle photo (or initials) */}
                    {(iv.panelists || []).length > 0 && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-300">Attendees</span>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {iv.panelists.map((p) => (
                            <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-slate-50 border border-slate-100 pl-0.5 pr-2 py-0.5">
                              <Avatar name={p.name} src={p.avatar} size={18} />
                              <span className="text-[11px] font-semibold text-slate-500">{titleCase(String(p.name || '').split(' ')[0])}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => setPartModal(iv)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">Participants</button>
                  {iv.meetLink && <a href={iv.meetLink} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">Join Meet</a>}
                  <button onClick={() => setViewId(iv.candidateId)} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: ORANGE }}>Open</button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {dayModal && <DayInterviewsModal day={dayModal} onClose={() => setDayModal(null)} onPick={(iv) => { setDayModal(null); setPartModal(iv); }} />}
      {partModal && <InterviewParticipantsModal iv={partModal} onClose={() => setPartModal(null)} onOpen={(cid) => { setPartModal(null); setViewId(cid); }} onComplete={completeFromPopup} />}
    </div>
  );
}

function DayInterviewsModal({ day, onClose, onPick }) {
  const label = new Date(day.dateKey).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between"><div className="text-lg font-extrabold text-[#050A1F]">{label}</div><button onClick={onClose} className="text-slate-400 text-xl leading-none">×</button></div>
        <div className="p-4 max-h-[60vh] overflow-auto divide-y divide-slate-50">
          {day.items.sort((a, b) => new Date(a.at) - new Date(b.at)).map((iv) => (
            <button key={iv.interviewId} onClick={() => onPick(iv)} className="w-full text-left flex items-center justify-between px-2 py-2.5 hover:bg-slate-50 rounded-lg">
              <div><div className="font-semibold text-slate-700 text-sm">{iv.candidateName}</div><div className="text-xs text-slate-400">{iv.roundLabel || 'Interview'} · {new Date(iv.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div></div>
              <span className="text-[10px] font-bold text-orange-600">Details →</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function InterviewParticipantsModal({ iv, onClose, onOpen, onComplete }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div><div className="text-lg font-extrabold text-[#050A1F]">{iv.roundLabel || 'Interview'}</div><div className="text-xs text-slate-400 mt-0.5">{iv.candidateName} · {iv.jobTitle}</div></div>
          <button onClick={onClose} className="text-slate-400 text-xl leading-none">×</button>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-2 text-sm text-slate-600"><span className="font-bold">When:</span> {new Date(iv.at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
          {iv.scheduledBy && <div className="flex items-center gap-2 text-sm text-slate-600"><span className="font-bold">Scheduled by:</span> {iv.scheduledBy}</div>}
          <div>
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Participants</div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-2">
                <span className="w-7 h-7 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center text-xs font-bold">{(iv.candidateName || '?')[0]}</span>
                <div className="min-w-0"><div className="text-sm font-semibold text-slate-700 truncate">{iv.candidateName}</div><div className="text-[11px] text-slate-400 truncate">Candidate{iv.candidateEmail ? ` · ${iv.candidateEmail}` : ''}</div></div>
              </div>
              {(iv.panelists || []).map((p) => (
                <div key={p.id} className="flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-2">
                  <span className="w-7 h-7 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-xs font-bold">{(p.name || '?')[0]}</span>
                  <div className="min-w-0"><div className="text-sm font-semibold text-slate-700 truncate">{p.name}</div><div className="text-[11px] text-slate-400 truncate">Interviewer{p.email ? ` · ${p.email}` : ''}</div></div>
                </div>
              ))}
              {!(iv.panelists || []).length && <div className="text-xs text-slate-400 px-1">No panelists assigned.</div>}
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex flex-wrap justify-between items-center gap-2">
          <button onClick={() => onOpen(iv.candidateId)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Open candidate</button>
          <div className="flex gap-2">
            <button onClick={() => onComplete && onComplete(iv)} className="rounded-lg border border-green-300 text-green-700 px-4 py-2 text-sm font-bold hover:bg-green-50">✓ Interview completed</button>
            {iv.meetLink
              ? <a href={iv.meetLink} target="_blank" rel="noreferrer" className="rounded-lg px-5 py-2 text-sm font-bold text-white" style={{ background: ORANGE }}>Join Google Meet</a>
              : <span className="rounded-lg px-5 py-2 text-sm font-bold text-slate-400 bg-slate-100">No Meet link</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfirmAvailabilityCard({ req, onConfirm }) {
  const [picked, setPicked] = useState(req.slots.filter((s) => s.confirmed).map((s) => s.id));
  const toggle = (id) => setPicked((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  return (
    <div className="bg-white rounded-2xl border border-slate-200/70 p-4">
      <div className="font-semibold text-slate-700 mb-1">{req.candidateName} <span className="text-xs text-slate-400 font-normal">· {req.roundLabel}</span></div>
      <div className="text-xs text-slate-400 mb-2">Tick the times you're available. The candidate only sees confirmed slots.</div>
      <div className="flex flex-wrap gap-2 mb-3">
        {req.slots.map((s) => (
          <button key={s.id} onClick={() => toggle(s.id)} className={`rounded-lg px-3 py-1.5 text-xs font-bold border ${picked.includes(s.id) ? 'bg-green-600 text-white border-transparent' : 'text-slate-600 border-slate-200'}`}>
            {new Date(s.at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </button>
        ))}
      </div>
      <button onClick={() => onConfirm(picked)} className="rounded-lg px-4 py-1.5 text-xs font-bold text-white" style={{ background: ORANGE }}>Confirm availability</button>
    </div>
  );
}

// Email templates & signature live behind the user menu.
function EmailTemplatesPage() {
  const [templates, setTemplates] = useState([]);
  const [editing, setEditing] = useState(null); // template being edited/created
  const load = () => hrApi('/email-templates').then((r) => setTemplates(r.templates || [])).catch(() => {});
  useEffect(() => { load(); }, []);
  const del = async (id) => { if (!window.confirm('Delete this template?')) return; await hrApi(`/email-templates/${id}`, { method: 'DELETE' }); load(); };
  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-extrabold text-[#050A1F]">Email Templates</h1>
        <button onClick={() => setEditing({ name: '', subject: '', body: '' })} className="rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ background: ORANGE }}>+ New template</button>
      </div>
      <p className="text-sm text-slate-500 mb-6">Reusable recruitment emails. Use placeholders like <code className="bg-slate-100 px-1 rounded">{'{{candidate_name}}'}</code> and <code className="bg-slate-100 px-1 rounded">{'{{role}}'}</code> — they're filled in when you use the template in the candidate mail composer.</p>
      {templates.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/70 p-8 text-center text-slate-400 text-sm">No templates yet.</div>
      ) : (
        <div className="space-y-2">
          {templates.map((t) => (
            <div key={t.id} className="bg-white rounded-xl border border-slate-200/70 p-4 flex items-center justify-between">
              <div className="min-w-0">
                <div className="font-bold text-slate-700">{t.name}</div>
                <div className="text-xs text-slate-400 truncate">{t.subject}</div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => setEditing(t)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">Edit</button>
                <button onClick={() => del(t.id)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-500">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && <TemplateEditor tpl={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function TemplateEditor({ tpl, onClose, onSaved }) {
  const [name, setName] = useState(tpl.name || '');
  const [subject, setSubject] = useState(tpl.subject || '');
  const [body, setBody] = useState(tpl.body || '');
  const [busy, setBusy] = useState(false);
  const [vars, setVars] = useState([]);
  const [showVars, setShowVars] = useState(false);
  const [showSubjVars, setShowSubjVars] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  useEffect(() => { hrApi('/template-variables').then(setVars).catch(() => setVars([])); }, []);
  const save = async () => {
    if (!name.trim()) { alert('Give the template a name.'); return; }
    setBusy(true);
    try { await hrApi('/email-templates', { method: 'POST', body: JSON.stringify({ id: tpl.id, name, subject, body }) }); onSaved(); }
    catch (e) { alert(e.message); setBusy(false); }
  };
  const insertVar = (key) => { setBody((b) => `${b || ''} {{${key}}}`); setShowVars(false); };
  const insertSubjectVar = (key) => { setSubject((s) => `${s || ''}{{${key}}}`); setShowSubjVars(false); };
  const runAi = async () => {
    if (!aiPrompt.trim()) return;
    setAiBusy(true);
    try {
      const r = await hrApi('/templates/ai-draft', { method: 'POST', body: JSON.stringify({ prompt: aiPrompt.trim() }) });
      if (r.subject) setSubject(r.subject);
      if (r.body) setBody(r.body);
      setShowAi(false); setAiPrompt('');
    } catch (e) { alert(e.message); } finally { setAiBusy(false); }
  };
  const inp2 = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
  const VarMenu = ({ onPick }) => (
    <div className="absolute right-0 mt-1 w-60 max-h-64 overflow-auto bg-white rounded-xl border border-slate-200 shadow-lg py-1.5 z-50">
      <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase">Candidate fields</div>
      {vars.map((v) => (
        <button key={v.key} onClick={() => onPick(v.key)} className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 flex justify-between gap-2">
          <span>{v.label}</span><span className="text-slate-300">{`{{${v.key}}}`}</span>
        </button>
      ))}
    </div>
  );
  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-[120] p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="text-lg font-extrabold text-[#050A1F]">{tpl.id ? 'Edit template' : 'New template'}</div>
          <button onClick={() => setShowAi((v) => !v)} className="rounded-lg px-3 py-1.5 text-xs font-bold border border-purple-200 text-purple-600 hover:bg-purple-50">✨ Write with AI</button>
        </div>
        <div className="p-6 space-y-3">
          {showAi && (
            <div className="rounded-xl border border-purple-200 bg-purple-50/50 p-3">
              <div className="text-xs font-bold text-purple-700 mb-1.5">Describe the email — AI drafts it, then you can drop in placeholders.</div>
              <textarea className={inp2} rows={2} value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder="e.g. Invite the candidate to a first-round technical interview and ask for their availability." />
              <div className="flex justify-end gap-2 mt-2">
                <button onClick={() => setShowAi(false)} className="text-xs font-bold text-slate-400">Cancel</button>
                <button onClick={runAi} disabled={aiBusy} className="rounded-lg px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50" style={{ background: 'linear-gradient(90deg,#8b5cf6,#6d28d9)' }}>{aiBusy ? 'Drafting…' : 'Generate draft'}</button>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div><div className="text-[11px] font-bold text-slate-500 mb-1">Name</div><input className={inp2} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Interview invite" /></div>
            <div>
              <div className="text-[11px] font-bold text-slate-500 mb-1">Subject</div>
              <div className="relative">
                <input className={inp2 + ' pr-8'} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Interview for {{role}}" />
                <button type="button" onClick={() => setShowSubjVars((v) => !v)} title="Insert placeholder" className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded text-orange-500 hover:bg-orange-50">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M4 12h16M4 17h10" /></svg>
                </button>
                {showSubjVars && <VarMenu onPick={insertSubjectVar} />}
              </div>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[11px] font-bold text-slate-500">Body</div>
              <div className="relative">
                <button onClick={() => setShowVars((v) => !v)} className="text-[11px] font-bold text-orange-600 flex items-center gap-1">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M4 12h16M4 17h10" /></svg>
                  Insert placeholder
                </button>
                {showVars && <VarMenu onPick={insertVar} />}
              </div>
            </div>
            <MailEditor value={body} onChange={setBody} minHeight={220} placeholder="Write your template… use Insert placeholder for dynamic fields" />
            <div className="text-[10px] text-slate-400 mt-1.5">Placeholders like <code>{'{{first_name}}'}</code> and <code>{'{{role}}'}</code> are filled with the candidate's real data when you send.</div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : 'Save template'}</button>
        </div>
      </div>
    </div>
  );
}

// Named signature templates — same UX as the Sales CRM: a gallery of 3 built-in
// templates you can start from, plus your own saved signatures.
function EmailSignaturePage() {
  const [sigs, setSigs] = useState([]);
  const [editing, setEditing] = useState(null);
  const [gallery, setGallery] = useState([]);
  const [showGallery, setShowGallery] = useState(false);
  const load = () => hrApi('/signatures').then((r) => setSigs(r.signatures || [])).catch(() => {});
  useEffect(() => { load(); hrApi('/signature-templates').then(setGallery).catch(() => setGallery([])); }, []);
  const del = async (id) => { if (!window.confirm('Delete this signature?')) return; await hrApi(`/signatures/${id}`, { method: 'DELETE' }); load(); };
  const makeDefault = async (s) => { await hrApi('/signatures', { method: 'POST', body: JSON.stringify({ id: s.id, name: s.name, body: s.body, isDefault: true }) }); load(); };
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-extrabold text-[#050A1F] mb-1">Email Signatures</h1>
      <p className="text-sm text-slate-500 mb-5">Named signatures you can insert into recruitment emails. Your default is appended when you use a template.</p>

      <div className="rounded-2xl border border-slate-200 p-4 bg-white">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-bold text-[#050A1F]">Signatures</div>
          <div className="flex gap-2">
            <button onClick={() => setShowGallery((v) => !v)} className="rounded-lg px-3 py-1.5 text-xs font-bold border border-slate-300 text-slate-600 hover:bg-slate-50">✨ Start from a template</button>
            <button onClick={() => { setShowGallery(false); setEditing({ name: '', body: '' }); }} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: '#050A1F' }}>+ New signature</button>
          </div>
        </div>

        {showGallery && (
          <div className="mb-4 grid grid-cols-1 gap-2">
            {gallery.length === 0 && <div className="text-xs text-slate-400">Loading templates…</div>}
            {gallery.map((t) => (
              <div key={t.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-xs font-bold text-[#050A1F]">{t.name}</div>
                    <div className="text-[10px] text-slate-400">{t.description}</div>
                  </div>
                  <button onClick={() => { setShowGallery(false); setEditing({ name: t.name, body: t.html }); }} className="rounded-lg px-3 py-1.5 text-[11px] font-bold text-white flex-shrink-0" style={{ background: ORANGE }}>Use &amp; customise</button>
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-2 overflow-auto" dangerouslySetInnerHTML={{ __html: t.html }} />
              </div>
            ))}
          </div>
        )}

        {sigs.length === 0 && !showGallery ? (
          <div className="text-xs text-slate-400 py-4 text-center">No signatures yet. Create one from scratch, or start from a template above.</div>
        ) : (
          <div className="space-y-2">
            {sigs.map((s) => (
              <div key={s.id} className="rounded-lg border border-slate-200 px-3 py-2.5 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-[#050A1F] flex items-center gap-2">{s.name} {s.isDefault && <span className="text-[9px] bg-orange-100 text-[#FF4500] rounded px-1.5 py-0.5">DEFAULT</span>}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5 truncate max-w-md" dangerouslySetInnerHTML={{ __html: s.body }} />
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  {!s.isDefault && <button onClick={() => makeDefault(s)} className="text-[11px] font-bold text-slate-500">Make default</button>}
                  <button onClick={() => setEditing({ ...s })} className="text-[11px] font-bold text-blue-500">Edit</button>
                  <button onClick={() => del(s.id)} className="text-[11px] font-bold text-red-500">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {editing && <SignatureEditor sig={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function SignatureEditor({ sig, onClose, onSaved }) {
  const [name, setName] = useState(sig.name || '');
  const [body, setBody] = useState(sig.body || '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim()) { alert('Give the signature a name.'); return; }
    setBusy(true);
    try { await hrApi('/signatures', { method: 'POST', body: JSON.stringify({ id: sig.id, name, body }) }); onSaved(); }
    catch (e) { alert(e.message); setBusy(false); }
  };
  const inp2 = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-[120] p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 text-lg font-extrabold text-[#050A1F]">{sig.id ? 'Edit signature' : 'New signature'}</div>
        <div className="p-6 space-y-3">
          <div><div className="text-[11px] font-bold text-slate-500 mb-1">Name</div><input className={inp2} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Formal" /></div>
          <div>
            <div className="text-[11px] font-bold text-slate-500 mb-1">Signature</div>
            <MailEditor value={body} onChange={setBody} minHeight={160} placeholder="Design your signature, or start from a template." />
            <div className="text-[10px] text-slate-400 mt-1.5">Tip: start from a template in the gallery, then tweak the text, colours, or links here.</div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// My Profile — self-service (avatar, phone, birthday, marital status, password).
// A 1:1 crop dialog for HRMS profile photos. Drag/zoom the image inside a square
// frame; on confirm it renders the visible square to a canvas and returns a PNG.
// Mirrors the Sales CRM cropper so both apps behave the same.
function HrImageCropModal({ file, onCancel, onCropped }) {
  const [src, setSrc] = useState('');
  const [nat, setNat] = useState(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);
  const BOX = 260;
  useEffect(() => {
    const r = new FileReader();
    r.onload = () => setSrc(String(r.result));
    r.onerror = () => onCancel();
    r.readAsDataURL(file);
  }, [file]);
  const baseFit = nat ? Math.max(BOX / nat.w, BOX / nat.h) : 1;
  const dispScale = baseFit * scale;
  const dw = nat ? nat.w * dispScale : BOX;
  const dh = nat ? nat.h * dispScale : BOX;
  const pt = (e) => (e.touches && e.touches[0]) ? e.touches[0] : e;
  const onDown = (e) => { const p = pt(e); dragRef.current = { x: p.clientX - offset.x, y: p.clientY - offset.y }; };
  const onMove = (e) => { if (!dragRef.current) return; const p = pt(e); setOffset({ x: p.clientX - dragRef.current.x, y: p.clientY - dragRef.current.y }); };
  const onUp = () => { dragRef.current = null; };
  const confirm = () => {
    if (!nat) { onCancel(); return; }
    const out = 512;
    const canvas = document.createElement('canvas');
    canvas.width = out; canvas.height = out;
    const ctx = canvas.getContext('2d');
    const left = (BOX - dw) / 2 + offset.x;
    const top = (BOX - dh) / 2 + offset.y;
    const sx = (-left) / dispScale;
    const sy = (-top) / dispScale;
    const sSize = BOX / dispScale;
    const im = new Image();
    im.onload = () => {
      ctx.save();
      ctx.beginPath();
      ctx.arc(out / 2, out / 2, out / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      try { ctx.drawImage(im, sx, sy, sSize, sSize, 0, 0, out, out); } catch { /* */ }
      ctx.restore();
      canvas.toBlob((blob) => {
        if (!blob) { onCancel(); return; }
        onCropped(new File([blob], 'avatar.png', { type: 'image/png' }));
      }, 'image/png', 0.92);
    };
    im.onerror = () => onCancel();
    im.src = src;
  };
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[150] p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-extrabold text-[#050A1F] mb-1">Crop your photo</h3>
        <p className="text-xs text-slate-500 mb-4">Drag to reposition, use the slider to zoom.</p>
        <div className="flex justify-center mb-4">
          <div className="relative overflow-hidden rounded-full bg-slate-100 select-none"
            style={{ width: BOX, height: BOX, touchAction: 'none', cursor: dragRef.current ? 'grabbing' : 'grab' }}
            onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
            onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}>
            {src && (
              // eslint-disable-next-line jsx-a11y/alt-text
              <img src={src} draggable={false}
                onLoad={(e) => setNat({ w: e.target.naturalWidth, h: e.target.naturalHeight })}
                style={{ position: 'absolute', width: dw, height: dh, left: (BOX - dw) / 2 + offset.x, top: (BOX - dh) / 2 + offset.y, maxWidth: 'none', pointerEvents: 'none' }} />
            )}
            <div className="absolute inset-0 rounded-full ring-2 ring-white/80 pointer-events-none" />
          </div>
        </div>
        <input type="range" min="1" max="3" step="0.01" value={scale} onChange={(e) => setScale(Number(e.target.value))} className="w-full mb-4" />
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={confirm} disabled={!nat} className="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>Crop &amp; upload</button>
        </div>
      </div>
    </div>
  );
}

function MyProfilePage({ user, onUpdated }) {
  const [p, setP] = useState(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cropFile, setCropFile] = useState(null); // non-square image awaiting crop
  const [avatarBusy, setAvatarBusy] = useState(false);
  const avatarRef = useRef(null);
  const load = () => hrApi('/profile-me').then(setP).catch(() => {});
  useEffect(() => { load(); }, []);
  const set = (patch) => setP((s) => ({ ...s, ...patch }));
  if (!p) return <div className="text-slate-400 text-sm">Loading…</div>;
  if (p.isAdmin) return <div className="max-w-2xl"><h1 className="text-2xl font-extrabold text-[#050A1F] mb-2">My Profile</h1><div className="bg-white rounded-2xl border border-slate-200/70 p-8 text-center text-slate-400 text-sm">Admins manage their profile in the Sales CRM.</div></div>;

  // Upload a (already square/cropped) file to ImageKit and persist immediately.
  const persistAvatar = async (file) => {
    setAvatarBusy(true);
    try { const base64 = await fileToBase64(file); const r = await hrApi('/profile-me/avatar', { method: 'POST', body: JSON.stringify({ base64, fileName: file.name }) }); set({ avatar: r.url }); onUpdated && onUpdated(); }
    catch (e) { alert(e.message); } finally { setAvatarBusy(false); }
  };
  // Pick → if the image isn't square, open the crop dialog; a square image
  // uploads directly. Matches the Sales CRM behavior.
  const pickAvatar = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert('Image too large (max 5MB).'); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (img.naturalWidth === img.naturalHeight) persistAvatar(file); // already square
      else setCropFile(file); // needs cropping
    };
    img.onerror = () => { URL.revokeObjectURL(url); persistAvatar(file); };
    img.src = url;
  };
  const onCropped = async (cropped) => { setCropFile(null); await persistAvatar(cropped); };
  const removeAvatar = async () => {
    if (!p.avatar) return;
    if (!window.confirm('Remove your profile photo?')) return;
    setAvatarBusy(true);
    try { await hrApi('/profile-me/avatar', { method: 'DELETE' }); set({ avatar: '' }); onUpdated && onUpdated(); }
    catch (e) { alert(e.message); } finally { setAvatarBusy(false); }
  };
  const save = async () => {
    setBusy(true); setSaved(false);
    try { await hrApi('/profile-me', { method: 'PUT', body: JSON.stringify({ phone: p.phone, avatar: p.avatar, birthday: p.birthday, maritalStatus: p.maritalStatus, anniversary: p.anniversary }) }); setSaved(true); onUpdated && onUpdated(); }
    catch (e) { alert(e.message); } finally { setBusy(false); }
  };
  const L = 'text-[11px] font-bold text-slate-500 mb-1';
  const inp2 = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-extrabold text-[#050A1F] mb-6">My Profile</h1>
      <div className="bg-white rounded-2xl border border-slate-200/70 p-6 space-y-5">
        {/* Avatar */}
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center text-2xl font-extrabold overflow-hidden">
            {p.avatar ? <img src={p.avatar} alt="" className="w-full h-full object-cover" /> : (p.name || '?')[0]?.toUpperCase()}
          </div>
          <div>
            <div className="font-bold text-slate-700">{p.name}</div>
            <div className="text-xs text-slate-400 mb-2">{p.email}{p.designation ? ` · ${p.designation}` : ''}</div>
            <div className="flex items-center gap-2">
              <button onClick={() => avatarRef.current?.click()} disabled={avatarBusy} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 disabled:opacity-50">{avatarBusy ? 'Uploading…' : (p.avatar ? 'Change photo' : 'Upload photo')}</button>
              {p.avatar && <button onClick={removeAvatar} disabled={avatarBusy} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-500 disabled:opacity-50">Remove</button>}
              <input ref={avatarRef} type="file" accept="image/*" className="hidden" onChange={pickAvatar} />
            </div>
          </div>
        </div>
        {cropFile && <HrImageCropModal file={cropFile} onCancel={() => setCropFile(null)} onCropped={onCropped} />}

        <div className="grid grid-cols-2 gap-4">
          <div><div className={L}>Phone number</div><input className={inp2} value={p.phone || ''} onChange={(e) => set({ phone: e.target.value })} /></div>
          <div><div className={L}>Birthday</div><input type="date" className={inp2} value={p.birthday || ''} onChange={(e) => set({ birthday: e.target.value })} /></div>
          <div>
            <div className={L}>Marital status</div>
            <select className={inp2} value={p.maritalStatus || ''} onChange={(e) => set({ maritalStatus: e.target.value, ...(e.target.value !== 'married' ? { anniversary: '' } : {}) })}>
              <option value="">Prefer not to say</option>
              <option value="single">Unmarried</option>
              <option value="married">Married</option>
            </select>
          </div>
          {p.maritalStatus === 'married' && <div><div className={L}>Anniversary date</div><input type="date" className={inp2} value={p.anniversary || ''} onChange={(e) => set({ anniversary: e.target.value })} /></div>}
        </div>

        <div className="flex items-center gap-3">
          <button onClick={save} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : 'Save profile'}</button>
          {saved && <span className="text-sm text-green-600 font-semibold">Saved ✓</span>}
        </div>
      </div>

      <ChangePasswordCard />
    </div>
  );
}

function ChangePasswordCard() {
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const inp2 = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
  const save = async () => {
    setMsg(''); if (nw.length < 8) { setMsg('New password must be at least 8 characters.'); return; }
    setBusy(true);
    try { await hrApi('/profile-me/password', { method: 'POST', body: JSON.stringify({ currentPassword: cur, newPassword: nw }) }); setMsg('Password changed ✓'); setCur(''); setNw(''); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200/70 p-6 mt-4">
      <div className="text-lg font-extrabold text-[#050A1F] mb-3">Reset password</div>
      <div className="grid grid-cols-2 gap-4">
        <div><div className="text-[11px] font-bold text-slate-500 mb-1">Current password</div><input type="password" className={inp2} value={cur} onChange={(e) => setCur(e.target.value)} /></div>
        <div><div className="text-[11px] font-bold text-slate-500 mb-1">New password</div><input type="password" className={inp2} value={nw} onChange={(e) => setNw(e.target.value)} /></div>
      </div>
      <div className="flex items-center gap-3 mt-4">
        <button onClick={save} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : 'Change password'}</button>
        {msg && <span className={`text-sm font-semibold ${msg.includes('✓') ? 'text-green-600' : 'text-red-500'}`}>{msg}</span>}
      </div>
    </div>
  );
}

// Admin user management — mirrors the CRM's user table (deactivate, reset pw).
function HrUserManagement() {
  const [users, setUsers] = useState([]);
  const [resetFor, setResetFor] = useState(null);
  const load = () => hrApi('/employees').then(setUsers).catch(() => {});
  useEffect(() => { load(); }, []);
  const toggleActive = async (u) => { if (!window.confirm(`${u.active ? 'Deactivate' : 'Reactivate'} ${u.name}?`)) return; await hrApi(`/users/${u._id}/active`, { method: 'POST', body: JSON.stringify({ active: !u.active }) }); load(); };
  return (
    <div>
      <h1 className="text-2xl font-extrabold text-[#050A1F] mb-1">Users</h1>
      <p className="text-sm text-slate-500 mb-6">Manage employee accounts — reset passwords or deactivate access. Deactivated users can't log in but their records are preserved.</p>
      <div className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
            <th className="px-4 py-3">Name</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Role</th>
            <th className="px-4 py-3">Department</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th>
          </tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u._id} className="border-b border-slate-50 hover:bg-slate-50/60">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-full bg-slate-100 text-slate-500 text-[11px] font-bold flex items-center justify-center overflow-hidden">{u.avatar ? <img src={u.avatar} alt="" className="w-full h-full object-cover" /> : (u.name || '?')[0]?.toUpperCase()}</span>
                    <span className="font-semibold text-slate-700">{u.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-500">{u.email}</td>
                <td className="px-4 py-3 text-slate-500 capitalize">{u.type}</td>
                <td className="px-4 py-3 text-slate-500">{u.department || '—'}</td>
                <td className="px-4 py-3">{u.active ? <span className="rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[10px] font-bold">Active</span> : <span className="rounded-full bg-slate-200 text-slate-500 px-2 py-0.5 text-[10px] font-bold">Deactivated</span>}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => setResetFor(u)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">Reset password</button>
                    <button onClick={() => toggleActive(u)} className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${u.active ? 'border-red-200 text-red-500' : 'border-green-200 text-green-600'}`}>{u.active ? 'Deactivate' : 'Reactivate'}</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {resetFor && <ResetPasswordModal user={resetFor} onClose={() => setResetFor(null)} onDone={() => setResetFor(null)} />}
    </div>
  );
}

function ResetPasswordModal({ user, onClose, onDone }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (pw.length < 8) { alert('Password must be at least 8 characters.'); return; }
    setBusy(true);
    try { await hrApi(`/users/${user._id}/reset-password`, { method: 'POST', body: JSON.stringify({ newPassword: pw }) }); alert('Password reset.'); onDone(); }
    catch (e) { alert(e.message); setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[120] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 text-lg font-extrabold text-[#050A1F]">Reset password</div>
        <div className="p-6">
          <div className="text-sm text-slate-500 mb-2">Set a new password for <b>{user.name}</b>.</div>
          <input type="text" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (min 8 chars)" />
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : 'Reset'}</button>
        </div>
      </div>
    </div>
  );
}
function RecruitmentMailbox({ isAdmin, setErr }) {
  const [data, setData] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const load = () => hrApi('/mailboxes').then(setData).catch((e) => setErr && setErr(e.message));
  useEffect(() => { load(); }, []);
  const runTest = async () => {
    setTesting(true); setTestResult(null);
    try { const r = await hrApi('/mailbox/selftest', { method: 'POST', body: JSON.stringify({}) }); setTestResult(r); }
    catch (e) { setTestResult({ error: e.message }); }
    finally { setTesting(false); }
  };
  const connect = async () => {
    try {
      const { url } = await hrApi('/mailboxes/connect');
      const w = window.open(url, 'hrmail', 'width=520,height=640');
      const onMsg = (e) => { if (e.data && e.data.gmail) { window.removeEventListener('message', onMsg); setTimeout(load, 800); try { w && w.close(); } catch {} } };
      window.addEventListener('message', onMsg);
      // Fallback: poll in case the popup can't postMessage back.
      const poll = setInterval(() => { if (w && w.closed) { clearInterval(poll); setTimeout(load, 500); } }, 1200);
    } catch (e) { setErr ? setErr(e.message) : alert(e.message); }
  };
  const disconnect = async (mb) => {
    if (!window.confirm(`Unlink ${mb.email}? Recruiters will no longer be able to use this inbox.`)) return;
    try { await hrApi(`/mailboxes/${mb.id}/disconnect`, { method: 'POST' }); load(); } catch (e) { setErr ? setErr(e.message) : alert(e.message); }
  };
  if (!data) return <Empty>Loading…</Empty>;
  const boxes = data.mailboxes || [];
  return (
    <div className="max-w-2xl">
      <div className="rounded-2xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-1">
          <div className="text-base font-extrabold text-[#050A1F]">Recruitment mailboxes</div>
          {isAdmin && data.configured && (
            <button onClick={connect} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white inline-flex items-center gap-1.5" style={{ background: ORANGE }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg> Add mailbox
            </button>
          )}
        </div>
        <p className="text-sm text-slate-500 mb-4">Shared inboxes (e.g. career@qtonix.com) that every recruiter reads and sends from. Add more to run multiple hiring addresses through one platform.</p>

        {!data.configured && <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm px-3 py-2 mb-3">Google credentials aren't set up yet. Add them in CRM Admin → API keys first.</div>}

        {boxes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center">
            <div className="text-sm text-slate-500 mb-2">No recruitment mailbox linked yet.</div>
            {isAdmin ? (
              <button onClick={connect} disabled={!data.configured} className="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>Connect a mailbox</button>
            ) : <div className="text-xs text-slate-400">Ask an admin to link the shared recruitment mailbox.</div>}
          </div>
        ) : (
          <div className="space-y-2">
            {boxes.map((mb) => (
              <div key={mb.id} className="flex items-center justify-between rounded-lg bg-green-50 border border-green-200 px-4 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-green-700 flex items-center gap-2">✓ {mb.email}{mb.isDefault && <span className="text-[9px] bg-white text-green-600 border border-green-200 rounded px-1.5 py-0.5">PRIMARY</span>}</div>
                  <div className="text-xs text-slate-500">{mb.label}{mb.connectedAt ? ` · linked ${new Date(mb.connectedAt).toLocaleDateString()}` : ''}</div>
                </div>
                {isAdmin && <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={runTest} disabled={testing} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-white disabled:opacity-50">{testing ? 'Testing…' : 'Test mailbox'}</button>
                  <button onClick={() => disconnect(mb)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-500">Disconnect</button>
                </div>}
              </div>
            ))}
            {testResult && (
              <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
                {testResult.error ? (
                  <div className="text-red-600">Test failed: {testResult.error}</div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="font-bold text-[#050A1F]">Test results for {testResult.email}</div>
                    <div className={testResult.send && testResult.send.ok ? 'text-green-700' : 'text-red-600'}>
                      {testResult.send && testResult.send.ok ? `✓ Email sending works — a test email was sent to ${testResult.send.to}. Check that inbox.` : `✗ Email send failed: ${testResult.send && testResult.send.error}`}
                    </div>
                    <div className={testResult.calendar && testResult.calendar.ok ? 'text-green-700' : 'text-red-600'}>
                      {testResult.calendar && testResult.calendar.ok ? `✓ Calendar works${testResult.calendar.meetLink ? ' (Meet link created)' : ''} — a temporary test event was created and removed.` : `✗ Calendar failed: ${testResult.calendar && testResult.calendar.error}`}
                    </div>
                    {testResult.send && testResult.send.ok && testResult.calendar && testResult.calendar.ok && <div className="text-xs text-slate-500 pt-1">Both work. If interview invites still aren't arriving, check the candidate's spam folder.</div>}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
function Empty({ children }) { return <div className="text-center text-slate-400 text-sm py-10">{children}</div>; }

// --- Admin: HR users + branches ---------------------------------------------

function IconBtn({ title, onClick, children, danger }) {
  return <button title={title} onClick={onClick} className={`p-1.5 rounded-lg transition ${danger ? 'text-slate-300 hover:text-red-500 hover:bg-red-50' : 'text-slate-400 hover:text-[#050A1F] hover:bg-slate-100'}`}>{children}</button>;
}

// API tab — ImageKit config + Claude/OpenAI usage tracking.
// Send one of each designed recruitment email to a chosen address, to verify
// formatting in a real inbox.
function TestEmailCard() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const send = async () => {
    setBusy(true); setErr(''); setResult(null);
    try { const r = await hrApi('/settings/test-emails', { method: 'POST', body: JSON.stringify({ email: email.trim() }) }); setResult(r); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200/70 p-5">
      <div className="text-xs text-slate-500 mb-3 max-w-lg">Send a copy of every recruitment email design (interview invite, panel, reschedule, application thank-you, new-application notice, shortlisted, assessment task, and rejection) to an address of your choice — each prefixed with <span className="font-mono text-[11px]">[TEST]</span> — so you can check they render correctly.</div>
      <div className="flex gap-2 max-w-md">
        <input className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !busy && email.trim() && send()} />
        <button onClick={send} disabled={busy || !email.trim()} className="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50 shrink-0" style={{ background: ORANGE }}>{busy ? 'Sending…' : 'Send test emails'}</button>
      </div>
      {err && <div className="mt-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm px-3 py-2">{err}</div>}
      {result && (
        <div className="mt-3 rounded-lg bg-green-50 border border-green-100 px-3 py-2.5 text-sm">
          <div className="font-bold text-green-700">✓ Sent {result.count} test email{result.count === 1 ? '' : 's'} to {result.to}</div>
          {result.failed && result.failed.length > 0 && <div className="text-amber-600 text-xs mt-1">Couldn't send: {result.failed.join(', ')}</div>}
          <div className="text-xs text-slate-500 mt-1">Check the inbox (and spam folder) — they may take a moment to arrive.</div>
        </div>
      )}
    </div>
  );
}

// Settings tab — auto-scoring toggle + recruitment mailbox + API (usage + ImageKit).
// Admin editor for the default onboarding checklist (seeds each new employee).
function OnboardingTemplateEditor() {
  const [tasks, setTasks] = useState(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { hrApi('/onboarding-template').then((r) => setTasks(r.tasks || [])).catch(() => setTasks([])); }, []);
  const save = async (next) => { setSaved(false); try { await hrApi('/onboarding-template', { method: 'PUT', body: JSON.stringify({ tasks: next }) }); setTasks(next); setSaved(true); } catch (e) { alert(e.message); } };
  if (!tasks) return <div className="text-slate-400 text-sm">Loading…</div>;
  return (
    <div className="bg-white rounded-2xl border border-slate-200/70 p-5">
      <div className="text-xs text-slate-500 mb-3">These tasks are copied onto each new employee's onboarding checklist. Editing this list doesn't change checklists already created.</div>
      <div className="space-y-2 mb-3">
        {tasks.map((t, i) => (
          <div key={i} className="flex items-center gap-2">
            <input className={inputCls} value={t} onChange={(e) => { const n = tasks.slice(); n[i] = e.target.value; setTasks(n); }} onBlur={() => save(tasks)} />
            <button onClick={() => save(tasks.filter((_, idx) => idx !== i))} className="text-slate-300 hover:text-red-500 shrink-0"><Icon.Trash size={16} /></button>
          </div>
        ))}
        {tasks.length === 0 && <div className="text-sm text-slate-400">No tasks yet.</div>}
      </div>
      <button onClick={() => setTasks([...tasks, ''])} className="text-xs font-bold text-[#FF4500]">+ Add task</button>
      {saved && <span className="text-sm text-green-600 font-semibold ml-3">Saved ✓</span>}
    </div>
  );
}

// ===== Survey admin: create surveys + view results & sentiment analysis =====
const SURVEY_TEMPLATES = [
  { id: 'employee_mood', name: 'Employee Mood', available: true, desc: 'A quick pulse on how the team is feeling, with adaptive follow-ups.' },
  { id: 'employee_satisfaction', name: 'Employee Satisfaction', available: false, desc: 'Coming soon.' },
  { id: 'work_culture', name: 'Work Culture', available: false, desc: 'Coming soon.' },
];
const SCALE_COLORS = ['#DC2626', '#F97316', '#CDDC39', '#84CC16', '#16A34A']; // 1..5

function PhoneNormalizeCard() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const run = async () => {
    if (!window.confirm('Format all existing candidate phone numbers to +91 mobile format? This updates stored records.')) return;
    setBusy(true); setErr(''); setResult(null);
    try { const r = await hrApi('/candidates/normalize-phones', { method: 'POST' }); setResult(r); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200/70 p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="font-bold text-[#050A1F]">Format existing phone numbers</div>
          <div className="text-xs text-slate-500 mt-1 max-w-md">One-time cleanup: converts saved candidate numbers to the standard <span className="font-mono">+91 9812-345-678</span> format. New candidates are already saved in this format.</div>
        </div>
        <button onClick={run} disabled={busy} className="rounded-lg px-4 py-2 text-xs font-bold text-white disabled:opacity-50 shrink-0" style={{ background: ORANGE }}>{busy ? 'Formatting…' : 'Format now'}</button>
      </div>
      {result && <div className="text-sm text-green-600 font-semibold mt-3">Done ✓ — {result.updated} of {result.total} updated.</div>}
      {err && <div className="text-sm text-red-600 mt-3">{err}</div>}
    </div>
  );
}

// HR Admin → Daily checklist: configure the HR Manager's recurring daily checks.
function HrEmailsTab({ onOpenCandidate }) {
  const [data, setData] = useState(null);
  const [preview, setPreview] = useState(null);
  const [activity, setActivity] = useState(null);
  useEffect(() => { hrApi('/email-catalog').then(setData).catch(() => setData({ emails: [], mailbox: '', connected: false })); }, []);
  const fmtDate = (d) => { if (!d) return '—'; try { return new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return '—'; } };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-bold text-sm mb-1 text-[#050A1F]">Automated emails</h3>
        <p className="text-xs text-slate-500 mb-4">Every automated email the system sends — recruitment emails (from the linked recruitment mailbox) and employee celebration emails (birthday, work anniversary, welcome), which are founder-signed and sent automatically from adam@qtonix.com. Preview a sample or view recent send activity.</p>

        {data && !data.connected && (
          <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs px-3 py-2">The recruitment mailbox isn’t linked yet. Link it under <b>Settings → Recruitment mailbox</b> so these emails can send.</div>
        )}

        {!data ? <div className="text-slate-400 text-sm py-10 text-center">Loading…</div> : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-left">
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">Email</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">Sent to</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">Sent from</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">Last activity</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.emails.map((e) => (
                  <tr key={e.id} className="border-b border-slate-100 last:border-0 align-top">
                    <td className="px-4 py-3">
                      <div className="font-bold text-[#050A1F]">{e.name}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5 max-w-xs leading-snug">{e.description}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 max-w-[180px]">{e.sentTo}</td>
                    <td className="px-4 py-3">
                      <div className="text-xs"><span className="font-mono text-slate-600">{e.sentFrom}</span><div className="text-[10px] text-slate-400">{e.auto ? 'Auto · Founder' : 'Recruitment mailbox'}</div></div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                      {e.lastSentAt ? fmtDate(e.lastSentAt) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <button onClick={() => setPreview({ id: e.id, name: e.name })} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">Preview</button>
                        <button onClick={() => setActivity({ id: e.id, name: e.name })} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">Activity</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {preview && <HrEmailPreviewModal id={preview.id} name={preview.name} onClose={() => setPreview(null)} />}
      {activity && <HrEmailActivityModal id={activity.id} name={activity.name} fmtDate={fmtDate} onOpenCandidate={onOpenCandidate} onClose={() => setActivity(null)} />}
    </div>
  );
}

// Popup: renders the sample HR email HTML in an iframe.
function HrEmailPreviewModal({ id, name, onClose }) {
  const [html, setHtml] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    hrApiRaw(`/email-catalog/${id}/preview`).then((t) => { if (alive) setHtml(t); }).catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [id]);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[120] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col" style={{ height: '92vh' }} onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div><div className="text-sm font-extrabold text-[#050A1F]">Preview — {name}</div><div className="text-[11px] text-slate-400">Sample email with placeholder data</div></div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400">✕</button>
        </div>
        <div className="flex-1 overflow-auto bg-slate-100 p-4">
          {err ? <div className="text-red-500 text-sm p-6 text-center">{err}</div>
            : <iframe title="preview" srcDoc={html} className="w-full h-full bg-white rounded-lg border border-slate-200" />}
        </div>
      </div>
    </div>
  );
}

// Popup: recent send activity as a paginated table.
function HrEmailActivityModal({ id, name, fmtDate, onOpenCandidate, onClose }) {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const perPage = 15;
  useEffect(() => {
    let alive = true;
    setLoading(true);
    hrApi(`/email-catalog/${id}/activity?page=${page}&pageSize=${perPage}`)
      .then((d) => { if (alive) { setData(d); setLoading(false); } })
      .catch(() => { if (alive) { setData({ activity: [], note: 'Could not load activity.', total: 0, totalPages: 1 }); setLoading(false); } });
    return () => { alive = false; };
  }, [id, page]);
  const rows = (data && data.activity) || [];
  const total = (data && data.total) || 0;
  const totalPages = (data && data.totalPages) || 1;
  const openCand = (a) => { if (a.candidateId && onOpenCandidate) { onClose(); onOpenCandidate(a.candidateId); } };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[120] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl flex flex-col" style={{ height: '86vh' }} onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div><div className="text-sm font-extrabold text-[#050A1F]">Activity — {name}</div><div className="text-[11px] text-slate-400">{total > 0 ? `${total} email${total === 1 ? '' : 's'} sent` : 'Sent emails'}</div></div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400">✕</button>
        </div>
        <div className="flex-1 overflow-auto p-5">
          {loading ? <div className="text-slate-400 text-sm py-16 text-center">Loading…</div>
            : rows.length === 0 ? <div className="text-slate-400 text-sm py-16 text-center">{(data && data.note) || 'No sends recorded yet.'}</div>
              : (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-left">
                        <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">Recipient</th>
                        <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">Date</th>
                        <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">Time</th>
                        <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((a, i) => {
                        const dt = a.sentAt ? new Date(a.sentAt) : null;
                        const dstr = dt ? dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
                        const tstr = dt ? dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—';
                        return (
                          <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                            <td className="px-4 py-3 whitespace-nowrap">
                              {a.candidateId
                                ? <button onClick={() => openCand(a)} className="font-semibold text-[#0435AC] hover:underline">{a.toName || a.toEmail || 'View candidate'}</button>
                                : <span className="font-semibold text-[#050A1F]">{a.toName || a.toEmail || '—'}</span>}
                              {a.toName && a.toEmail ? <div className="text-[11px] text-slate-400">{a.toEmail}</div> : null}
                            </td>
                            <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{dstr}</td>
                            <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{tstr}</td>
                            <td className="px-4 py-3 text-right whitespace-nowrap"><span className="rounded-full bg-green-50 text-green-700 px-2 py-0.5 text-[11px] font-bold">✓ Sent</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
        </div>
        {totalPages > 1 && (
          <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between shrink-0">
            <div className="text-xs text-slate-400">Page {page} of {totalPages}</div>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40">Previous</button>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Inline editable office address for a branch (feeds the pre-joining reporting
// email). Saves on blur when changed.
function BranchAddress({ branch, onSaved }) {
  const [val, setVal] = useState(branch.address || '');
  const [saved, setSaved] = useState(false);
  const save = async () => {
    if ((val || '') === (branch.address || '')) return;
    try { await hrApi(`/branches/${branch._id}`, { method: 'PUT', body: JSON.stringify({ address: val }) }); setSaved(true); setTimeout(() => setSaved(false), 1500); onSaved && onSaved(); } catch {}
  };
  return (
    <div className="mt-2">
      <textarea rows={2} value={val} onChange={(e) => setVal(e.target.value)} onBlur={save} placeholder="Office address (used in the pre-joining email)" className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] text-slate-600 resize-none" />
      {saved && <div className="text-[10px] text-green-600 font-bold mt-0.5">Saved</div>}
    </div>
  );
}

function HrSettingsTab({ isAdmin, setErr }) {
  const [s, setS] = useState(null);
  const [saved, setSaved] = useState(false);
  const [usage, setUsage] = useState(null);
  useEffect(() => {
    hrApi('/settings').then(setS).catch(() => {});
    hrApi('/api-usage').then((r) => setUsage(r.usage || {})).catch(() => setUsage({}));
  }, []);
  const toggle = async (v) => { setSaved(false); try { const r = await hrApi('/settings', { method: 'PUT', body: JSON.stringify({ autoScore: v }) }); setS((x) => ({ ...x, autoScore: r.autoScore })); setSaved(true); } catch (e) { alert(e.message); } };
  const providers = [['anthropic', 'Claude (Anthropic)'], ['openai', 'OpenAI (email drafts)']];
  if (!s) return <div className="text-slate-400 text-sm">Loading…</div>;
  return (
    <div className="space-y-8">
      {/* Auto-scoring */}
      <div className="max-w-2xl">
        <div className="text-sm font-bold text-[#050A1F] mb-3">Recruitment</div>
        <div className="bg-white rounded-2xl border border-slate-200/70 p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-bold text-[#050A1F]">Auto-score resume match</div>
              <div className="text-xs text-slate-500 mt-1 max-w-md">When on, Claude scores each candidate's resume match automatically on add, on application, and when feedback is submitted. Turn off to save API credits — you can still score manually from each candidate.</div>
            </div>
            <button onClick={() => toggle(!s.autoScore)} className={`relative w-12 h-6 rounded-full transition shrink-0 ${s.autoScore ? 'bg-green-500' : 'bg-slate-300'}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition ${s.autoScore ? 'translate-x-6' : ''}`} />
            </button>
          </div>
          {saved && <div className="text-sm text-green-600 font-semibold mt-3">Saved ✓</div>}
        </div>
      </div>

      {/* Data maintenance */}
      {isAdmin && (
        <div className="max-w-2xl">
          <div className="text-sm font-bold text-[#050A1F] mb-3">Data maintenance</div>
          <PhoneNormalizeCard />
        </div>
      )}

      {/* Recruitment mailbox */}
      <div>
        <div className="text-sm font-bold text-[#050A1F] mb-3">Recruitment mailbox</div>
        <RecruitmentMailbox isAdmin={isAdmin} setErr={setErr} />
      </div>

      {/* Test recruitment emails */}
      {isAdmin && (
        <div className="max-w-2xl">
          <div className="text-sm font-bold text-[#050A1F] mb-3">Test recruitment emails</div>
          <TestEmailCard />
        </div>
      )}

      {/* Onboarding checklist template */}
      <div className="max-w-2xl">
        <div className="text-sm font-bold text-[#050A1F] mb-3">Onboarding checklist template</div>
        <OnboardingTemplateEditor />
      </div>

      {/* API */}
      <div>
        <div className="text-sm font-bold text-[#050A1F] mb-3">API</div>
        <div className="grid grid-cols-2 gap-4 max-w-2xl">
          {providers.map(([id, label]) => (
            <div key={id} className="bg-white rounded-2xl border border-slate-200/70 p-5">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
              <div className="text-3xl font-extrabold mt-1 text-[#050A1F]">{usage ? (usage[id] || 0) : '—'}</div>
              <div className="text-[11px] text-slate-400 mt-1">total API calls</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-2 mb-4">API keys are managed in the Sales CRM admin (shared across the product). Resume-match scoring uses Claude; email drafts use OpenAI.</p>
        <div className="text-xs font-bold text-slate-500 mb-2">ImageKit (image hosting)</div>
        <ImageKitSection />
      </div>
    </div>
  );
}

// Error Report tab — admin view of bug reports & feedback raised from the
// fixed side button across the HRMS. Filter by status; mark seen/resolved.
function ErrorReportTab({ setErr }) {
  const [data, setData] = useState({ items: [], counts: { new: 0, seen: 0, resolved: 0 } });
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const load = () => {
    setLoading(true);
    hrApi(`/feedback${filter ? `?status=${filter}` : ''}`).then((r) => setData(r || { items: [], counts: {} })).catch((e) => setErr && setErr(e.message)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);
  const setStatus = async (id, status) => {
    try { await hrApi(`/feedback/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); load(); }
    catch (e) { setErr && setErr(e.message); }
  };
  const fmt = (d) => { try { return new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return d; } };
  const kindBadge = (k) => k === 'bug' ? { t: '🐞 Bug', c: '#DC2626', bg: '#FEF2F2' } : k === 'suggestion' ? { t: '💡 Suggestion', c: '#B45309', bg: '#FEF3C7' } : { t: '💬 Other', c: '#0369A1', bg: '#E0F2FE' };
  const statusBadge = (s) => s === 'resolved' ? { t: 'Resolved', c: '#15803D', bg: '#DCFCE7' } : s === 'seen' ? { t: 'Seen', c: '#6D28D9', bg: '#EDE9FE' } : { t: 'New', c: '#B45309', bg: '#FEF3C7' };
  const c = data.counts || {};
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-extrabold text-[#050A1F]">Error Report &amp; Feedback</h3>
          <div className="text-xs text-slate-400">Bugs and feedback raised by users from anywhere in the HRMS.</div>
        </div>
        <div className="flex gap-1.5 bg-slate-100 p-1 rounded-xl">
          {[['', 'All'], ['new', `New${c.new ? ` · ${c.new}` : ''}`], ['seen', 'Seen'], ['resolved', 'Resolved']].map(([id, lbl]) => (
            <button key={id} onClick={() => setFilter(id)} className={`px-3 py-1.5 rounded-lg text-[12px] font-extrabold ${filter === id ? 'bg-white text-[#050A1F] shadow-sm' : 'text-slate-500'}`}>{lbl}</button>
          ))}
        </div>
      </div>
      {loading ? <div className="text-sm text-slate-400 py-8 text-center">Loading…</div>
        : data.items.length === 0 ? <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-400">No reports{filter ? ` with status "${filter}"` : ' yet'}. 🎉</div>
        : (
          <div className="space-y-3">
            {data.items.map((f) => {
              const kb = kindBadge(f.kind); const sb = statusBadge(f.status);
              return (
                <div key={f._id} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-[10px] font-extrabold rounded px-1.5 py-0.5" style={{ background: kb.bg, color: kb.c }}>{kb.t}</span>
                        <span className="text-[10px] font-extrabold rounded px-1.5 py-0.5" style={{ background: sb.bg, color: sb.c }}>{sb.t}</span>
                        <span className="text-[11px] text-slate-400">{fmt(f.createdAt)}</span>
                      </div>
                      <div className="text-sm text-slate-700 whitespace-pre-wrap">{f.message}</div>
                      <div className="text-[11px] text-slate-400 mt-1.5">
                        {titleCase(f.reporterName || 'Someone')}{f.reporterEmail ? ` · ${f.reporterEmail}` : ''}{f.pageUrl ? ` · on ${f.pageUrl}` : ''}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      {f.status !== 'seen' && f.status !== 'resolved' && <button onClick={() => setStatus(f._id, 'seen')} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">Mark seen</button>}
                      {f.status !== 'resolved' && <button onClick={() => setStatus(f._id, 'resolved')} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: '#0F9D58' }}>Resolve</button>}
                      {f.status === 'resolved' && <button onClick={() => setStatus(f._id, 'new')} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">Reopen</button>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}

// Logs tab — full activity audit across all users, filterable by user.
function HrLogsTab() {
  const [data, setData] = useState(null);
  const [userFilter, setUserFilter] = useState('');
  const [category, setCategory] = useState('');
  const load = () => {
    const qs = new URLSearchParams();
    if (userFilter) qs.set('userName', userFilter);
    if (category) qs.set('category', category);
    hrApi('/logs' + (qs.toString() ? `?${qs}` : '')).then(setData).catch(() => setData({ logs: [], users: [] }));
  };
  useEffect(() => { load(); }, [userFilter, category]);
  const logs = (data && data.logs) || [];
  const users = (data && data.users) || [];
  // Friendly labels + colour by action family.
  const family = (a) => a.startsWith('hr.login') || a === 'login' ? 'auth-in' : a.startsWith('hr.logout') || a === 'logout' ? 'auth-out' : a.includes('delete') ? 'danger' : a.includes('create') || a.includes('publish') ? 'create' : 'default';
  const famClass = { 'auth-in': 'bg-green-50 text-green-600', 'auth-out': 'bg-slate-100 text-slate-500', danger: 'bg-red-50 text-red-600', create: 'bg-blue-50 text-blue-600', default: 'bg-slate-100 text-slate-600' };
  const pretty = (a) => a.replace(/^hr\./, '').replace(/\./g, ' · ').replace(/_/g, ' ');
  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="text-sm font-bold text-[#050A1F]">Activity logs</div>
        <div className="flex items-center gap-2">
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600">
            <option value="">All events</option>
            <option value="auth">Login / logout</option>
            <option value="hr">HR actions</option>
          </select>
          <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 max-w-[200px]">
            <option value="">All users</option>
            {users.map((u) => <option key={`${u.userId}-${u.userName}`} value={u.userName}>{u.userName}</option>)}
          </select>
        </div>
      </div>
      {!data ? <div className="text-slate-400 text-sm">Loading…</div> : logs.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/70 p-8 text-center text-slate-400 text-sm">No activity logged{userFilter ? ` for ${userFilter}` : ''} yet.</div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
              <th className="px-4 py-3">When</th><th className="px-4 py-3">User</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Details</th><th className="px-4 py-3">IP</th>
            </tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                  <td className="px-4 py-2.5 text-slate-400 text-xs whitespace-nowrap">{new Date(l.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-slate-700 font-semibold">{l.userName || '—'}</td>
                  <td className="px-4 py-2.5"><span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${famClass[family(l.action)]}`}>{pretty(l.action)}</span></td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs">{l.target || '—'}</td>
                  <td className="px-4 py-2.5 text-slate-300 text-[11px]">{l.ip || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="text-[11px] text-slate-400 mt-2">Showing the most recent {logs.length} events. Includes logins, logouts, and every recruitment action.</div>
    </div>
  );
}

// Careers page branding + public link.
function HrCareersTab() {
  const [c, setC] = useState(null);
  const [careersDomain, setCareersDomain] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sub, setSub] = useState('branding'); // 'branding' | 'seo'
  const logoRef = useRef(null);
  useEffect(() => { hrApi('/settings').then((r) => { setC(r.careers || {}); setCareersDomain(r.careersDomain || window.location.origin); }).catch(() => {}); }, []);
  if (!c) return <div className="text-slate-400 text-sm">Loading…</div>;
  // The public careers page lives at the careers domain root (career.qtonix.com),
  // not the current admin origin (people.qtonix.com).
  const base = (careersDomain || window.location.origin).replace(/\/$/, '');
  const publicUrl = `${base}/`;
  const save = async () => { setBusy(true); setSaved(false); try { const r = await hrApi('/settings', { method: 'PUT', body: JSON.stringify({ careers: { title: c.title, description: c.description, logo: c.logo } }) }); setC(r.careers); setSaved(true); } catch (e) { alert(e.message); } finally { setBusy(false); } };
  const uploadLogo = async (file) => { if (!file) return; try { const base64 = await fileToBase64(file); const r = await hrApi('/profile-me/avatar', { method: 'POST', body: JSON.stringify({ base64, fileName: file.name }) }); setC((x) => ({ ...x, logo: r.url })); } catch (e) { alert(e.message); } };
  const L = 'text-[11px] font-bold text-slate-500 mb-1';
  const inp2 = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
  return (
    <div className="max-w-2xl">
      <div className="text-sm font-bold text-[#050A1F] mb-1">Public careers page</div>
      <p className="text-xs text-slate-500 mb-4">One public page listing all your published roles. Share the link anywhere.</p>
      {publicUrl && (
        <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 mb-4 flex items-center gap-2">
          <input readOnly className={inp2 + ' text-xs'} value={publicUrl} onClick={(e) => e.target.select()} />
          <a href={publicUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-600 shrink-0">Open</a>
          <button onClick={() => navigator.clipboard?.writeText(publicUrl)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-600 shrink-0">Copy</button>
        </div>
      )}
      <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 mb-4">
        <div className="text-[11px] font-bold text-slate-500 mb-2">SEO discovery files (for Google &amp; AI crawlers)</div>
        {[['Sitemap', `${base}/sitemap.xml`], ['llms.txt', `${base}/llms.txt`], ['robots.txt', `${base}/robots.txt`]].map(([label, url]) => (
          <div key={label} className="flex items-center gap-2 mb-1.5 last:mb-0">
            <span className="text-[11px] font-bold text-slate-600 w-16 shrink-0">{label}</span>
            <input readOnly className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs bg-white" value={url} onClick={(e) => e.target.select()} />
            <a href={url} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-600 shrink-0">Open</a>
            <button onClick={() => navigator.clipboard?.writeText(url)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-600 shrink-0">Copy</button>
          </div>
        ))}
        <div className="text-[10px] text-slate-400 mt-2">Submit the sitemap to Google Search Console. These update automatically as you publish or close jobs.</div>
      </div>
      <div className="flex gap-1 mb-4 border-b border-slate-200">
        {[['branding', 'Branding'], ['seo', 'SEO & job listings']].map(([id, label]) => (
          <button key={id} onClick={() => setSub(id)} className="px-4 py-2 text-xs font-bold border-b-2 transition -mb-px" style={{ borderColor: sub === id ? '#FF6A00' : 'transparent', color: sub === id ? '#050A1F' : '#94A3B8' }}>{label}</button>
        ))}
      </div>
      {sub === 'branding' && (
        <div className="bg-white rounded-2xl border border-slate-200/70 p-5 space-y-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-xl bg-slate-100 flex items-center justify-center overflow-hidden">{c.logo ? <img src={c.logo} alt="" className="w-full h-full object-contain" /> : <span className="text-slate-300 text-xs">Logo</span>}</div>
            <div>
              <button onClick={() => logoRef.current?.click()} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">Upload logo</button>
              <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={(e) => uploadLogo(e.target.files?.[0])} />
            </div>
          </div>
          <div><div className={L}>Page title</div><input className={inp2} value={c.title || ''} onChange={(e) => setC({ ...c, title: e.target.value })} placeholder="Careers at Qtonix" /></div>
          <div><div className={L}>Description</div><textarea rows={4} className={inp2} value={c.description || ''} onChange={(e) => setC({ ...c, description: e.target.value })} placeholder="Tell candidates about your company and culture…" /></div>
          <div className="flex items-center gap-3">
            <button onClick={save} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : 'Save'}</button>
            {saved && <span className="text-sm text-green-600 font-semibold">Saved ✓{!c.token ? ' — link generated' : ''}</span>}
          </div>
        </div>
      )}
      {sub === 'seo' && <HrCareersSeo />}
    </div>
  );
}

// SEO admin: careers-page meta + per-job page title/description, with AI
// generation (OpenAI) and a live Google-style preview.
function HrCareersSeo() {
  const [data, setData] = useState(null);
  const [cs, setCs] = useState({ title: '', description: '', image: '' });
  const [busy, setBusy] = useState('');
  const [savedFlash, setSavedFlash] = useState('');
  const load = () => hrApi('/seo/jobs').then((r) => { setData(r); setCs(r.careersSeo || { title: '', description: '' }); }).catch((e) => alert(e.message));
  useEffect(() => { load(); }, []);
  if (!data) return <div className="text-slate-400 text-sm">Loading…</div>;
  const flash = (id) => { setSavedFlash(id); setTimeout(() => setSavedFlash(''), 1800); };
  const inp = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-[13px]';
  const lbl = 'text-[11px] font-bold text-slate-500';
  const counter = (v, max) => { const n = (v || '').length; const over = n > max; return <span className={`text-[11px] font-semibold ${over ? 'text-red-500' : n > max * 0.9 ? 'text-orange-500' : 'text-slate-400'}`}>{n} / {max}</span>; };
  const host = (() => { try { return new URL(window.location.origin).host; } catch { return 'qtonix.com'; } })();

  const saveCareers = async () => { setBusy('careers'); try { const r = await hrApi('/seo/careers', { method: 'PUT', body: JSON.stringify(cs) }); setCs(r); flash('careers'); } catch (e) { alert(e.message); } finally { setBusy(''); } };
  const genCareers = async () => { setBusy('careers-ai'); try { const r = await hrApi('/seo/careers/generate', { method: 'POST', body: '{}' }); setCs((x) => ({ ...x, title: r.title, description: r.description, keywords: r.keywords || x.keywords })); if (!r.ai) alert('No OpenAI key set — used a smart template. Add a key in Settings for AI-written copy.'); } catch (e) { alert(e.message); } finally { setBusy(''); } };

  const setJob = (id, patch) => setData((d) => ({ ...d, jobs: d.jobs.map((j) => j.id === id ? { ...j, ...patch } : j) }));
  const saveJob = async (job) => { setBusy('job-' + job.id); try { await hrApi(`/seo/jobs/${job.id}`, { method: 'PUT', body: JSON.stringify({ seoTitle: job.seoTitle, seoDescription: job.seoDescription, seoKeywords: job.seoKeywords || [] }) }); flash('job-' + job.id); } catch (e) { alert(e.message); } finally { setBusy(''); } };
  const genJob = async (job) => { setBusy('jobai-' + job.id); try { const r = await hrApi(`/seo/jobs/${job.id}/generate`, { method: 'POST', body: '{}' }); setJob(job.id, { seoTitle: r.title, seoDescription: r.description, seoKeywords: r.keywords || job.seoKeywords }); if (!r.ai) alert('No OpenAI key set — used a smart template. Add a key in Settings for AI-written copy.'); } catch (e) { alert(e.message); } finally { setBusy(''); } };
  const genAll = async () => { if (!confirm('Generate SEO titles & descriptions for all published jobs? This overwrites existing SEO copy.')) return; setBusy('all'); try { const r = await hrApi('/seo/jobs/generate-all', { method: 'POST', body: '{}' }); await load(); alert(`Generated SEO for ${r.count} job${r.count === 1 ? '' : 's'}${r.ai ? '' : ' (template — add an OpenAI key for AI copy)'}.`); } catch (e) { alert(e.message); } finally { setBusy(''); } };

  const published = data.jobs.filter((j) => j.status === 'published');
  return (
    <div className="space-y-4">
      {/* Careers page SEO */}
      <div className="bg-white rounded-2xl border border-slate-200/70 p-5">
        <div className="text-[13px] font-extrabold text-[#050A1F] flex items-center gap-2 mb-0.5"><span className="w-2.5 h-2.5 rounded" style={{ background: '#0EA5E9' }} />Careers page SEO</div>
        <div className="text-[11px] text-slate-400 mb-3">Applies to the main careers page that lists all roles.</div>
        <div className="mb-3">
          <div className="flex justify-between"><span className={lbl}>Meta title</span>{counter(cs.title, 60)}</div>
          <input className={inp} value={cs.title || ''} onChange={(e) => setCs({ ...cs, title: e.target.value })} placeholder="Careers at Qtonix — Open Jobs & Roles" />
        </div>
        <div className="mb-3">
          <div className="flex justify-between"><span className={lbl}>Meta description</span>{counter(cs.description, 160)}</div>
          <textarea rows={2} className={inp} value={cs.description || ''} onChange={(e) => setCs({ ...cs, description: e.target.value })} placeholder="Explore open roles at Qtonix across engineering, sales and design…" />
        </div>
        {(cs.keywords && cs.keywords.length > 0) && (
          <div className="mb-3">
            <div className={lbl + ' mb-1'}>Target keywords</div>
            <div className="flex flex-wrap gap-1.5">{cs.keywords.map((k, i) => (<span key={i} className="text-[11px] font-semibold rounded-full px-2.5 py-1" style={{ background: '#EEF2FF', color: '#4338CA' }}>{k}</span>))}</div>
          </div>
        )}
        <div className={lbl + ' mb-1'}>Google preview</div>
        <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 mb-3">
          <div className="text-[12px]" style={{ color: '#0F9D58' }}>{host} › careers</div>
          <div className="text-[16px] leading-tight" style={{ color: '#1a0dab' }}>{cs.title || 'Careers at Qtonix'}</div>
          <div className="text-[12px]" style={{ color: '#4d5156' }}>{cs.description || 'Explore open roles and join our team at Qtonix.'}</div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={saveCareers} disabled={busy === 'careers'} className="rounded-lg px-4 py-2 text-[13px] font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy === 'careers' ? 'Saving…' : 'Save careers SEO'}</button>
          <button onClick={genCareers} disabled={busy === 'careers-ai'} className="rounded-lg px-3 py-2 text-[12px] font-bold disabled:opacity-50 inline-flex items-center gap-1.5" style={{ background: '#EDE9FE', color: '#7C3AED' }}>{busy === 'careers-ai' ? 'Writing…' : '✨ Generate with AI'}</button>
          {savedFlash === 'careers' && <span className="text-[13px] text-green-600 font-semibold">Saved ✓</span>}
        </div>
      </div>

      {/* Per-job SEO */}
      <div className="bg-white rounded-2xl border border-slate-200/70 p-5">
        <div className="flex items-center justify-between mb-0.5">
          <div className="text-[13px] font-extrabold text-[#050A1F] flex items-center gap-2"><span className="w-2.5 h-2.5 rounded" style={{ background: '#FF6A00' }} />Job post SEO</div>
          <span className="text-[11px] text-slate-400 font-semibold">{published.length} published role{published.length === 1 ? '' : 's'}</span>
        </div>
        <div className="text-[11px] text-slate-400 mb-3">Each job's own page title & meta description. Edit inline, or let AI write optimized copy.</div>
        <div className="flex items-center justify-between rounded-lg px-3.5 py-2.5 mb-3" style={{ background: 'linear-gradient(90deg,#EDE9FE,#F5F3FF)', border: '1px solid #ddd6fe' }}>
          <div className="text-[12px] font-bold" style={{ color: '#5b21b6' }}>✨ Optimize all job page titles & descriptions for search</div>
          <button onClick={genAll} disabled={busy === 'all'} className="rounded-lg px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50" style={{ background: '#7C3AED' }}>{busy === 'all' ? 'Generating…' : 'Generate all with AI'}</button>
        </div>
        {published.length === 0 ? <div className="text-[13px] text-slate-400 py-2">No published jobs yet. Publish a role to manage its SEO.</div> : (
          <div className="space-y-2.5">
            {published.map((job) => {
              const hasSeo = !!(job.seoTitle || job.seoDescription);
              const slug = job.token ? `/jobs/${job.token}` : '';
              return (
                <div key={job.id} className="rounded-xl border border-slate-200 p-3.5">
                  <div className="flex items-start justify-between gap-2 mb-2.5">
                    <div>
                      <div className="text-[14px] font-extrabold text-[#050A1F]">{job.title}</div>
                      <div className="text-[11px] text-slate-400">{[job.department, (job.locations || [])[0], slug].filter(Boolean).join(' · ')}</div>
                    </div>
                    <span className="text-[10px] font-bold rounded-full px-2 py-0.5 shrink-0" style={hasSeo ? { background: '#DCFCE7', color: '#15803D' } : { background: '#FEF3C7', color: '#B45309' }}>{hasSeo ? 'SEO set' : 'Using defaults'}</span>
                  </div>
                  <div className="mb-2.5">
                    <div className="flex justify-between"><span className={lbl}>Page title</span>{job.seoTitle ? counter(job.seoTitle, 60) : <span className="text-[11px] font-semibold text-orange-500">Empty — falls back to job title</span>}</div>
                    <div className="flex gap-2">
                      <input className={inp} value={job.seoTitle || ''} onChange={(e) => setJob(job.id, { seoTitle: e.target.value })} placeholder={`${job.title} in ${(job.locations || [])[0] || 'City'} | Qtonix Careers`} />
                      <button onClick={() => genJob(job)} disabled={busy === 'jobai-' + job.id} className="rounded-lg px-2.5 text-[11px] font-bold shrink-0 disabled:opacity-50" style={{ background: '#EDE9FE', color: '#7C3AED' }}>{busy === 'jobai-' + job.id ? '…' : '✨ AI'}</button>
                    </div>
                  </div>
                  <div className="mb-2.5">
                    <div className="flex justify-between"><span className={lbl}>Meta description</span>{counter(job.seoDescription, 160)}</div>
                    <textarea rows={2} className={inp} value={job.seoDescription || ''} onChange={(e) => setJob(job.id, { seoDescription: e.target.value })} placeholder="Add a description, or generate one with AI…" />
                  </div>
                  {(job.seoKeywords && job.seoKeywords.length > 0) && (
                    <div className="mb-2.5">
                      <div className={lbl + ' mb-1'}>Target keywords</div>
                      <div className="flex flex-wrap gap-1.5">{job.seoKeywords.map((k, i) => (<span key={i} className="text-[11px] font-semibold rounded-full px-2.5 py-1" style={{ background: '#EEF2FF', color: '#4338CA' }}>{k}</span>))}</div>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <button onClick={() => saveJob(job)} disabled={busy === 'job-' + job.id} className="rounded-lg px-3.5 py-1.5 text-[12px] font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy === 'job-' + job.id ? 'Saving…' : 'Save'}</button>
                    {job.token && <a href={`${window.location.origin}${slug}`} target="_blank" rel="noreferrer" className="text-[12px] font-bold text-slate-500">Preview →</a>}
                    {savedFlash === 'job-' + job.id && <span className="text-[12px] text-green-600 font-semibold">Saved ✓</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function HrAdmin({ user, onOpenCandidate }) {
  const [tab, setTab] = useState('org');
  const [users, setUsers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [reporting, setReporting] = useState({ hr: [], admins: [] });
  const [orgChartOpen, setOrgChartOpen] = useState(false);
  const [imagekitReady, setImagekitReady] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [profileId, setProfileId] = useState(null);

  const load = () => {
    hrApi('/users').then(setUsers).catch(() => {});
    hrApi('/branches').then(setBranches).catch(() => {});
    hrApi('/departments').then(setDepartments).catch(() => {});
    hrApi('/shifts').then(setShifts).catch(() => {});
    hrApi('/holidays').then(setHolidays).catch(() => {});
    hrApi('/reporting-options').then(setReporting).catch(() => {});
    hrApi('/imagekit').then((c) => setImagekitReady(c.configured)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const reportingOptions = [
    ...reporting.hr.map((h) => ({ value: `hr:${h.id}`, label: `${h.name}${h.designation ? ` · ${h.designation}` : ''} (${ROLE_LABELS[h.type] || 'HR'})` })),
    ...reporting.admins.map((a) => ({ value: `admin:${a.id}`, label: `${a.name} (Admin)` })),
  ];
  const splitReports = (val) => {
    if (!val) return { reportsToId: null, reportsToAdminId: null };
    const [kind, id] = val.split(':');
    return kind === 'admin' ? { reportsToId: null, reportsToAdminId: Number(id) } : { reportsToId: Number(id), reportsToAdminId: null };
  };
  const joinReports = (row) => row.reportsToAdminId ? `admin:${row.reportsToAdminId}` : (row.reportsToId ? `hr:${row.reportsToId}` : '');
  const nameById = (row) => {
    if (row.reportsToAdminId) { const a = reporting.admins.find((x) => x.id === row.reportsToAdminId); return a ? `${a.name} (Admin)` : 'Admin'; }
    if (row.reportsToId) { const h = reporting.hr.find((x) => x.id === row.reportsToId); return h ? h.name : '—'; }
    return '—';
  };

  const saveEdit = async () => {
    setErr('');
    if (edit.newPassword && edit.newPassword.length < 8) return setErr('Password must be at least 8 characters.');
    if (!edit.shiftId) return setErr('Please assign a shift.');
    try {
      const body = {
        name: edit.name, phone: edit.phone, designation: edit.designation, type: edit.type,
        employeeId: edit.employeeId, branch: edit.branch, department: edit.department, joiningDate: edit.joiningDate,
        shiftId: edit.shiftId || null, branchIncharge: edit.branchIncharge, targets: edit.targets, hrManagerScope: edit.hrManagerScope || '', ...splitReports(edit.reportsTo),
        probationEndDate: edit.probationEndDate || null, probationStatus: edit.probationStatus || '',
        exitStatus: edit.exitStatus || '', lastWorkingDay: edit.lastWorkingDay || null,
      };
      if (edit.newPassword) body.password = edit.newPassword;
      await hrApi(`/users/${edit._id}`, { method: 'PUT', body: JSON.stringify(body) });
      setEdit(null); load(); setMsg(`Updated ${edit.name}`);
    } catch (e) { setErr(e.message); }
  };
  const toggle = async (u) => { try { await hrApi(`/users/${u._id}`, { method: 'PUT', body: JSON.stringify({ active: !u.active }) }); load(); } catch (e) { setErr(e.message); } };

  // Branch / department / shift / holiday helpers
  const [newBranch, setNewBranch] = useState('');
  const [newDept, setNewDept] = useState('');
  const addBranch = async () => { if (!newBranch.trim()) return; try { await hrApi('/branches', { method: 'POST', body: JSON.stringify({ name: newBranch.trim() }) }); setNewBranch(''); load(); } catch (e) { setErr(e.message); } };
  const editBranch = async (b) => { const name = prompt('Rename branch', b.name); if (name && name.trim() && name !== b.name) { try { await hrApi(`/branches/${b._id}`, { method: 'PUT', body: JSON.stringify({ name: name.trim() }) }); load(); } catch (e) { setErr(e.message); } } };
  const delBranch = async (b) => { if (!confirm(`Delete branch "${b.name}"?`)) return; try { await hrApi(`/branches/${b._id}`, { method: 'DELETE' }); load(); } catch (e) { setErr(e.message); } };
  const addDept = async () => { if (!newDept.trim()) return; try { await hrApi('/departments', { method: 'POST', body: JSON.stringify({ name: newDept.trim() }) }); setNewDept(''); load(); } catch (e) { setErr(e.message); } };
  const editDept = async (d) => { const name = prompt('Rename department', d.name); if (name && name.trim() && name !== d.name) { try { await hrApi(`/departments/${d._id}`, { method: 'PUT', body: JSON.stringify({ name: name.trim() }) }); load(); } catch (e) { setErr(e.message); } } };
  const delDept = async (d) => { if (!confirm(`Delete department "${d.name}"?`)) return; try { await hrApi(`/departments/${d._id}`, { method: 'DELETE' }); load(); } catch (e) { setErr(e.message); } };

  if (profileId) return (<div><button onClick={() => { setProfileId(null); load(); }} className="text-xs font-bold text-slate-400 mb-3">← Back to admin</button><ProfilePage me={user} targetId={profileId} /></div>);

  const TABS = [['org', 'Organization'], ['careers', 'Career Page'], ['shifts', 'Shifts'], ['holidays', 'Holiday'], ['emails', 'Email'], ['settings', 'Settings'], ['errors', 'Error Report'], ['logs', 'Log']];

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-extrabold text-[#050A1F] mb-4">HR Admin</h1>
      {err && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">{err}</div>}
      {msg && <div className="mb-4 rounded-lg bg-green-50 border border-green-200 px-3 py-2.5 text-sm text-green-700">{msg}</div>}

      <div className="flex gap-1 mb-5 border-b border-slate-200 flex-wrap">
        {TABS.map(([id, l]) => (
          <button key={id} onClick={() => setTab(id)} className="px-4 py-2 text-xs font-bold border-b-2 transition" style={{ borderColor: tab === id ? '#FF6A00' : 'transparent', color: tab === id ? '#050A1F' : '#94A3B8' }}>{l}</button>
        ))}
      </div>

      {/* USERS TAB */}
      {tab === 'users' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm text-slate-500">{users.filter((u) => u.active).length} active · {users.length} total</p>
            <button onClick={() => setShowAdd(true)} className="rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ background: ORANGE }}>+ Add user</button>
          </div>

          {edit && (
            <div className="bg-white rounded-xl border-2 p-5 mb-5" style={{ borderColor: '#2563EB' }}>
              <h3 className="font-bold text-sm mb-4 text-[#050A1F]">Edit {edit.name}</h3>
              <div className="grid grid-cols-2 gap-4">
                <SharedField label="Name"><input className={inputCls} value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></SharedField>
                <SharedField label="Employee ID"><input className={inputCls} value={edit.employeeId || ''} onChange={(e) => setEdit({ ...edit, employeeId: e.target.value })} /></SharedField>
                <SharedField label="Phone"><input className={inputCls} value={edit.phone || ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></SharedField>
                <SharedField label="Designation"><input className={inputCls} value={edit.designation || ''} onChange={(e) => setEdit({ ...edit, designation: e.target.value })} /></SharedField>
                <SharedField label="Role"><select className={inputCls} value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })}>{ROLE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></SharedField>
                <SharedField label="Branch"><select className={inputCls} value={edit.branch || ''} onChange={(e) => setEdit({ ...edit, branch: e.target.value })}>{branches.map((b) => <option key={b._id} value={b.name}>{b.name}</option>)}</select></SharedField>
                <SharedField label="Department"><select className={inputCls} value={edit.department || ''} onChange={(e) => setEdit({ ...edit, department: e.target.value })}><option value="">— select —</option>{departments.map((d) => <option key={d._id} value={d.name}>{d.name}</option>)}</select></SharedField>
                <SharedField label="Joining date"><input type="date" className={inputCls} value={edit.joiningDate || ''} onChange={(e) => setEdit({ ...edit, joiningDate: e.target.value })} /></SharedField>
                <SharedField label="Shift *"><select className={inputCls} value={edit.shiftId || ''} onChange={(e) => setEdit({ ...edit, shiftId: e.target.value })}><option value="">— select shift —</option>{shifts.map((sh) => <option key={sh._id} value={sh._id}>{sh.name}</option>)}</select></SharedField>
                <SharedField label="Reports to"><select className={inputCls} value={edit.reportsTo || ''} onChange={(e) => setEdit({ ...edit, reportsTo: e.target.value })}><option value="">— none —</option>{reportingOptions.filter((o) => o.value !== `hr:${edit._id}`).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></SharedField>
                <div className="flex items-center gap-2 pt-6"><input type="checkbox" id="inc-edit" checked={!!edit.branchIncharge} onChange={(e) => setEdit({ ...edit, branchIncharge: e.target.checked })} /><label htmlFor="inc-edit" className="text-sm font-semibold text-slate-600">Branch in-charge</label></div>
                <SharedField label="HR Manager access">
                  {(() => {
                    const scope = edit.hrManagerScope || '';
                    const isMgr = !!scope;
                    const isAll = scope === 'all';
                    const ownBranch = edit.branch || '';
                    return (
                      <div className="space-y-2 pt-1">
                        <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
                          <input type="checkbox" checked={isMgr} onChange={(e) => setEdit({ ...edit, hrManagerScope: e.target.checked ? (ownBranch || 'all') : '', isHrManager: e.target.checked })} />
                          HR Manager
                        </label>
                        {isMgr && (
                          <div className="ml-6 space-y-1.5">
                            <label className="flex items-center gap-2 text-sm text-slate-600">
                              <input type="radio" name="hrmgr-scope-edit" checked={isAll} onChange={() => setEdit({ ...edit, hrManagerScope: 'all', isHrManager: true })} />
                              All branches <span className="text-xs text-slate-400">— manage everyone across all branches</span>
                            </label>
                            <label className="flex items-center gap-2 text-sm text-slate-600">
                              <input type="radio" name="hrmgr-scope-edit" checked={!isAll} onChange={() => setEdit({ ...edit, hrManagerScope: ownBranch || 'all', isHrManager: true })} />
                              Own branch {ownBranch ? `(${ownBranch})` : ''} <span className="text-xs text-slate-400">— manage only their branch</span>
                            </label>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </SharedField>
                <SharedField label="New password" hint="Leave blank to keep current"><input type="text" className={inputCls} value={edit.newPassword || ''} onChange={(e) => setEdit({ ...edit, newPassword: e.target.value })} /></SharedField>
              </div>
              {/^(hr|human resource|human resources)$/i.test((edit.department || '').trim()) && (
                <div className="mt-4 rounded-xl bg-slate-50 p-4"><div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">HR targets</div><div className="grid grid-cols-2 gap-4">
                  <SharedField label="Daily scheduling target"><input type="number" min="0" className={inputCls} value={edit.targets?.dailyInterviews ?? 0} onChange={(e) => setEdit({ ...edit, targets: { ...edit.targets, dailyInterviews: e.target.value } })} /></SharedField>
                  <SharedField label="Monthly hiring target"><input type="number" min="0" className={inputCls} value={edit.targets?.monthlyOnboarding ?? 0} onChange={(e) => setEdit({ ...edit, targets: { ...edit.targets, monthlyOnboarding: e.target.value } })} /></SharedField>
                </div></div>
              )}
              <div className="mt-4 rounded-xl bg-slate-50 p-4"><div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Probation &amp; exit <span className="text-slate-400 normal-case font-normal">(powers the HR Manager’s daily probation / notice tracking)</span></div>
                <div className="grid grid-cols-2 gap-4">
                  <SharedField label="Probation end date"><input type="date" className={inputCls} value={edit.probationEndDate ? String(edit.probationEndDate).slice(0, 10) : ''} onChange={(e) => setEdit({ ...edit, probationEndDate: e.target.value })} /></SharedField>
                  <SharedField label="Probation status"><select className={inputCls} value={edit.probationStatus || ''} onChange={(e) => setEdit({ ...edit, probationStatus: e.target.value })}><option value="">— not set —</option><option value="on_probation">On probation</option><option value="confirmed">Confirmed</option><option value="extended">Extended</option></select></SharedField>
                  <SharedField label="Exit status"><select className={inputCls} value={edit.exitStatus || ''} onChange={(e) => setEdit({ ...edit, exitStatus: e.target.value })}><option value="">— active —</option><option value="notice">On notice</option><option value="exited">Exited</option></select></SharedField>
                  <SharedField label="Last working day"><input type="date" className={inputCls} value={edit.lastWorkingDay ? String(edit.lastWorkingDay).slice(0, 10) : ''} onChange={(e) => setEdit({ ...edit, lastWorkingDay: e.target.value })} /></SharedField>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-4"><button onClick={() => setEdit(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button><button onClick={saveEdit} className="rounded-lg px-5 py-2.5 text-sm font-bold text-white" style={{ background: '#050A1F' }}>Save changes</button></div>
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr className="text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                <th className="px-4 py-3">Name</th><th className="px-4 py-3">Emp ID</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Dept</th><th className="px-4 py-3">Branch</th><th className="px-4 py-3">Reports to</th><th className="px-4 py-3">Profile</th><th className="px-4 py-3"></th>
              </tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u._id} className={`border-t border-slate-100 ${u.active ? '' : 'opacity-50'}`}>
                    <td className="px-4 py-3"><div className="flex items-center gap-2"><Avatar name={u.name} src={u.avatar} size={28} /><span className="font-bold text-[#050A1F]">{u.name}{u.branchIncharge && <span className="ml-1.5 text-[9px] font-bold text-[#FF4500]">IN-CHARGE</span>}</span></div></td>
                    <td className="px-4 py-3 text-slate-500">{u.employeeId || '—'}</td>
                    <td className="px-4 py-3"><span className="text-[10px] font-bold rounded px-1.5 py-0.5 bg-slate-100 text-slate-600">{ROLE_LABELS[u.type] || u.type}</span></td>
                    <td className="px-4 py-3 text-slate-500">{u.department || '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{u.branch}</td>
                    <td className="px-4 py-3 text-slate-500">{nameById(u)}</td>
                    <td className="px-4 py-3"><div className="flex items-center gap-1.5"><div className="w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full" style={{ width: `${u.completion || 0}%`, background: (u.completion||0) >= 100 ? '#059669' : (u.completion||0) >= 50 ? '#FF6A00' : '#EF4444' }} /></div><span className="text-[11px] font-bold text-slate-500">{u.completion || 0}%</span></div></td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <IconBtn title="Open details" onClick={() => setProfileId(u._id)}><Icon.Globe size={15} /></IconBtn>
                      <IconBtn title="Edit" onClick={() => setEdit({ ...u, reportsTo: joinReports(u), shiftId: u.shiftId || '', newPassword: '' })}><Icon.Pencil size={15} /></IconBtn>
                      <button onClick={() => toggle(u)} className="text-xs font-bold text-slate-400 ml-1">{u.active ? 'Off' : 'On'}</button>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400 text-sm">No HR users yet. Click “Add user”.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ORG CHART TAB */}
      {/* ORGANIZATION TAB (org chart + branches & departments) */}
      {tab === 'org' && (
        <div className="space-y-6">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-bold text-[#050A1F]">Organization chart</div>
              <button onClick={() => setOrgChartOpen(true)} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: ORANGE }}>
                <Icon.Globe size={14} /> View chart
              </button>
            </div>
            <HrOrgChart users={users} reporting={reporting} />
          </div>
          <div>
            <div className="text-sm font-bold text-[#050A1F] mb-3">Branches &amp; departments</div>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <div className="text-sm font-bold text-[#050A1F] mb-3">Branches</div>
                <div className="space-y-2.5 mb-3">
                  {branches.map((b) => (
                    <div key={b._id} className="border border-slate-100 rounded-lg p-2.5 group">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-semibold text-slate-600">{b.name}</span>
                        <span className="flex items-center opacity-0 group-hover:opacity-100 transition"><IconBtn title="Rename" onClick={() => editBranch(b)}><Icon.Pencil size={14} /></IconBtn><IconBtn title="Delete" danger onClick={() => delBranch(b)}><Icon.Trash size={14} /></IconBtn></span>
                      </div>
                      <BranchAddress branch={b} onSaved={load} />
                    </div>
                  ))}
                </div>
                <div className="flex gap-2"><input className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="New branch" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addBranch()} /><button onClick={addBranch} className="rounded-lg px-3 py-2 text-xs font-bold text-white" style={{ background: ORANGE }}>Add</button></div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <div className="text-sm font-bold text-[#050A1F] mb-3">Departments</div>
                <div className="space-y-1.5 mb-3">
                  {departments.map((d) => (
                    <div key={d._id} className="flex items-center justify-between text-sm group">
                      <span className="font-semibold text-slate-600">{d.name}</span>
                      <span className="flex items-center opacity-0 group-hover:opacity-100 transition"><IconBtn title="Edit" onClick={() => editDept(d)}><Icon.Pencil size={14} /></IconBtn><IconBtn title="Delete" danger onClick={() => delDept(d)}><Icon.Trash size={14} /></IconBtn></span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2"><input className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="New department" value={newDept} onChange={(e) => setNewDept(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addDept()} /><button onClick={addDept} className="rounded-lg px-3 py-2 text-xs font-bold text-white" style={{ background: ORANGE }}>Add</button></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SHIFTS TAB */}
      {tab === 'shifts' && <ShiftsManager shifts={shifts} reload={load} setErr={setErr} />}

      {/* HOLIDAYS TAB */}
      {tab === 'holidays' && <div className="space-y-8"><HolidaysManager holidays={holidays} branches={branches} reload={load} setErr={setErr} /><LeavePolicyManager branches={branches} isAdmin={!!user.isAdmin} setErr={setErr} /></div>}

      {/* SETTINGS TAB (auto-score + recruitment mailbox + API) */}
      {tab === 'emails' && <HrEmailsTab onOpenCandidate={onOpenCandidate} />}
      {tab === 'settings' && <HrSettingsTab isAdmin={!!user.isAdmin} setErr={setErr} />}
      {tab === 'errors' && <ErrorReportTab setErr={setErr} />}
      {tab === 'logs' && <HrLogsTab />}
      {tab === 'careers' && <HrCareersTab />}

      {showAdd && <AddUserModal branches={branches} departments={departments} reportingOptions={reportingOptions} shifts={shifts} imagekitReady={imagekitReady} onClose={() => setShowAdd(false)} onCreated={(n) => { setMsg(`User created: ${n}`); load(); }} />}
      {orgChartOpen && <HrOrgChartModal users={users} reporting={reporting} onClose={() => setOrgChartOpen(false)} />}
    </div>
  );
}

// Shifts manager (add/edit/delete with break window).
function ShiftsManager({ shifts, reload, setErr }) {
  const blank = { name: '', startTime: '09:00', endTime: '18:00', breaks: [], maxBreakMinutes: 60, graceMinutes: 20 };
  const [f, setF] = useState(blank);
  const [editing, setEditing] = useState(null);
  const set = (o) => setF((s) => ({ ...s, ...o }));
  const hhmm = (t) => { if (!t) return null; const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
  const crosses = (() => { const s = hhmm(f.startTime), e = hhmm(f.endTime); return s != null && e != null && e <= s; })();
  const breakTotal = (f.breaks || []).reduce((a, b) => { const s = hhmm(b.start), e = hhmm(b.end); return (s != null && e != null && e > s) ? a + (e - s) : a; }, 0);
  const overCap = breakTotal > (f.maxBreakMinutes || 60);
  const addBreak = () => set({ breaks: [...(f.breaks || []), { start: '', end: '' }] });
  const setBreak = (i, k, v) => set({ breaks: (f.breaks || []).map((b, j) => j === i ? { ...b, [k]: v } : b) });
  const delBreak = (i) => set({ breaks: (f.breaks || []).filter((_, j) => j !== i) });
  const submit = async () => {
    if (!f.name.trim()) { setErr('Shift name is required.'); return; }
    if (overCap) { setErr(`Total break time ${breakTotal} min exceeds the ${f.maxBreakMinutes || 60} min limit.`); return; }
    const payload = { ...f, breaks: (f.breaks || []).filter((b) => b.start && b.end) };
    try {
      if (editing) await hrApi(`/shifts/${editing}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await hrApi('/shifts', { method: 'POST', body: JSON.stringify(payload) });
      setF(blank); setEditing(null); reload();
    } catch (e) { setErr(e.message); }
  };
  const del = async (s) => { if (!confirm(`Delete shift "${s.name}"?`)) return; try { await hrApi(`/shifts/${s._id}`, { method: 'DELETE' }); reload(); } catch (e) { setErr(e.message); } };
  const startEdit = (s) => { setEditing(s._id); setF({ name: s.name, startTime: s.startTime || '', endTime: s.endTime || '', breaks: (Array.isArray(s.breaks) && s.breaks.length) ? s.breaks : (s.breakStart ? [{ start: s.breakStart, end: s.breakEnd }] : []), maxBreakMinutes: s.maxBreakMinutes || 60, graceMinutes: s.graceMinutes ?? 20 }); };
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="text-sm font-bold text-[#050A1F] mb-3">Shifts</div>
        <div className="space-y-2">
          {shifts.map((s) => {
            const bl = (Array.isArray(s.breaks) && s.breaks.length) ? s.breaks : (s.breakStart ? [{ start: s.breakStart, end: s.breakEnd }] : []);
            const bt = bl.reduce((a, b) => { const x = hhmm(b.start), y = hhmm(b.end); return (x != null && y != null && y > x) ? a + (y - x) : a; }, 0);
            return (
              <div key={s._id} className="flex items-center justify-between border border-slate-100 rounded-lg px-3 py-2 group">
                <div>
                  <div className="text-sm font-bold text-[#050A1F] flex items-center gap-2">{s.name}{s.crossesMidnight && <span className="text-[9px] font-extrabold rounded px-1.5 py-0.5" style={{ background: '#1E293B', color: '#fff' }}>🌙 NIGHT</span>}</div>
                  <div className="text-[11px] text-slate-400">{s.startTime}–{s.endTime}{s.crossesMidnight ? ' (next day)' : ''}{bl.length ? ` · ${bl.length} break${bl.length > 1 ? 's' : ''} (${bt} min)` : ''}</div>
                </div>
                <span className="flex items-center opacity-0 group-hover:opacity-100 transition"><IconBtn title="Edit" onClick={() => startEdit(s)}><Icon.Pencil size={14} /></IconBtn><IconBtn title="Delete" danger onClick={() => del(s)}><Icon.Trash size={14} /></IconBtn></span>
              </div>
            );
          })}
          {shifts.length === 0 && <div className="text-slate-400 text-sm py-4 text-center">No shifts yet.</div>}
        </div>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="text-sm font-bold text-[#050A1F] mb-3">{editing ? 'Edit shift' : 'Add shift'}</div>
        <div className="space-y-3">
          <SharedField label="Shift name"><input className={inputCls} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Morning, Night (7 PM–5 AM)" /></SharedField>
          <div className="grid grid-cols-2 gap-3">
            <SharedField label="Start time"><input type="time" className={inputCls} value={f.startTime} onChange={(e) => set({ startTime: e.target.value })} /></SharedField>
            <SharedField label="End time"><input type="time" className={inputCls} value={f.endTime} onChange={(e) => set({ endTime: e.target.value })} /></SharedField>
          </div>
          {crosses && <div className="text-[11px] font-bold rounded-lg px-3 py-2" style={{ background: '#1E293B', color: '#fff' }}>🌙 Night shift — ends the next day. Attendance stays on one day across midnight (no re-login).</div>}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-bold text-slate-500">Breaks <span className="font-normal text-slate-400">(total ≤ {f.maxBreakMinutes || 60} min)</span></span>
              <button onClick={addBreak} className="text-[11px] font-bold text-orange-600">+ Add break</button>
            </div>
            {(f.breaks || []).length === 0 && <div className="text-[12px] text-slate-400 py-1">No breaks. Click "Add break" to add one or more.</div>}
            {(f.breaks || []).map((b, i) => (
              <div key={i} className="flex items-center gap-2 mb-1.5">
                <input type="time" className={inputCls + ' flex-1'} value={b.start} onChange={(e) => setBreak(i, 'start', e.target.value)} />
                <span className="text-slate-400">–</span>
                <input type="time" className={inputCls + ' flex-1'} value={b.end} onChange={(e) => setBreak(i, 'end', e.target.value)} />
                <button onClick={() => delBreak(i)} className="text-slate-300 hover:text-red-500"><Icon.Trash size={14} /></button>
              </div>
            ))}
            <div className={`text-[11px] font-bold mt-1 ${overCap ? 'text-red-600' : 'text-slate-400'}`}>Total break: {breakTotal} / {f.maxBreakMinutes || 60} min{overCap ? ' — over the limit!' : ''}</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <SharedField label="Max break (min)"><input type="number" className={inputCls} value={f.maxBreakMinutes} onChange={(e) => set({ maxBreakMinutes: Number(e.target.value) })} /></SharedField>
            <SharedField label="Grace (min)"><input type="number" className={inputCls} value={f.graceMinutes} onChange={(e) => set({ graceMinutes: Number(e.target.value) })} /></SharedField>
          </div>
          <div className="flex justify-end gap-2">
            {editing && <button onClick={() => { setEditing(null); setF(blank); }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>}
            <button onClick={submit} disabled={overCap} className="rounded-lg px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{editing ? 'Save' : 'Add shift'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Holidays manager (per-branch; '' = all branches).
function HolidaysManager({ holidays, branches, reload, setErr }) {
  const [f, setF] = useState({ name: '', date: '', branch: '' });
  const set = (o) => setF((s) => ({ ...s, ...o }));
  const submit = async () => {
    if (!f.name.trim() || !f.date) { setErr('Holiday name and date are required.'); return; }
    try { await hrApi('/holidays', { method: 'POST', body: JSON.stringify(f) }); setF({ name: '', date: '', branch: '' }); reload(); } catch (e) { setErr(e.message); }
  };
  const del = async (h) => { if (!confirm(`Delete "${h.name}"?`)) return; try { await hrApi(`/holidays/${h._id}`, { method: 'DELETE' }); reload(); } catch (e) { setErr(e.message); } };
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="text-sm font-bold text-[#050A1F] mb-3">Holiday list</div>
        <div className="space-y-2">
          {holidays.map((h) => (
            <div key={h._id} className="flex items-center justify-between border border-slate-100 rounded-lg px-3 py-2 group">
              <div><div className="text-sm font-bold text-[#050A1F]">{h.name}</div><div className="text-[11px] text-slate-400">{h.date} · {h.branch || 'All branches'}</div></div>
              <span className="opacity-0 group-hover:opacity-100 transition"><IconBtn title="Delete" danger onClick={() => del(h)}><Icon.Trash size={14} /></IconBtn></span>
            </div>
          ))}
          {holidays.length === 0 && <div className="text-slate-400 text-sm py-4 text-center">No holidays yet.</div>}
        </div>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="text-sm font-bold text-[#050A1F] mb-3">Add holiday</div>
        <div className="space-y-3">
          <SharedField label="Holiday name"><input className={inputCls} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Diwali" /></SharedField>
          <SharedField label="Date"><input type="date" className={inputCls} value={f.date} onChange={(e) => set({ date: e.target.value })} /></SharedField>
          <SharedField label="Applies to"><select className={inputCls} value={f.branch} onChange={(e) => set({ branch: e.target.value })}><option value="">All branches</option>{branches.map((b) => <option key={b._id} value={b.name}>{b.name}</option>)}</select></SharedField>
          <div className="flex justify-end"><button onClick={submit} className="rounded-lg px-5 py-2.5 text-sm font-bold text-white" style={{ background: ORANGE }}>Add holiday</button></div>
        </div>
      </div>
    </div>
  );
}

// Admin editor for leave categories, leave rules, week-off rules and late-entry
// rules. Saved into Settings.hrPolicy and enforced server-side.
const WEEKOFF_OPTIONS = [['all_sundays', 'All Sundays'], ['sat_sun', 'All Saturdays & Sundays'], ['alt_sat_sun', '2nd & 4th Sat + all Sun'], ['custom', 'Custom days']];
const WEEKDAYS = [['0', 'Sun'], ['1', 'Mon'], ['2', 'Tue'], ['3', 'Wed'], ['4', 'Thu'], ['5', 'Fri'], ['6', 'Sat']];
function LeavePolicyManager({ branches, isAdmin, setErr }) {
  const [pol, setPol] = useState(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { hrApi('/policy').then((r) => setPol(r.policy)).catch(() => {}); }, []);
  if (!pol) return null;
  const save = async () => {
    setBusy(true); setSaved(false); setErr('');
    try { const r = await hrApi('/policy', { method: 'PUT', body: JSON.stringify(pol) }); setPol(r.policy); setSaved(true); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const setCat = (i, obj) => setPol((p) => ({ ...p, categories: p.categories.map((c, idx) => idx === i ? { ...c, ...obj } : c) }));
  const setCatAlloc = (i, k, v) => setPol((p) => ({ ...p, categories: p.categories.map((c, idx) => idx === i ? { ...c, allocation: { ...c.allocation, [k]: Number(v) || 0 } } : c) }));
  const addCat = () => setPol((p) => ({ ...p, categories: [...p.categories, { id: `cat${Date.now()}`, name: 'New category', allocation: { casual: 12, medical: 12, privilege: 12, wfh: 24 } }] }));
  const delCat = (i) => setPol((p) => ({ ...p, categories: p.categories.filter((_, idx) => idx !== i) }));
  const setLate = (k, v) => setPol((p) => ({ ...p, lateRule: { ...p.lateRule, [k]: Number(v) || 0 } }));
  const setWO = (branch, obj) => setPol((p) => ({ ...p, weekOff: { ...p.weekOff, [branch === '__default' ? 'default' : 'byBranch']: branch === '__default' ? { ...p.weekOff.default, ...obj } : { ...p.weekOff.byBranch, [branch]: { ...(p.weekOff.byBranch[branch] || {}), ...obj } } } }));
  const woFor = (branch) => branch === '__default' ? (pol.weekOff.default || { type: 'all_sundays' }) : (pol.weekOff.byBranch[branch] || { type: '' });

  if (!isAdmin) return null;
  return (
    <div className="space-y-6">
      <div className="text-lg font-extrabold text-[#050A1F]">Leave & attendance policy</div>

      {/* Categories */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-3"><div className="text-sm font-bold text-[#050A1F]">Leave categories</div><button onClick={addCat} className="text-xs font-bold text-[#FF4500]">+ Add category</button></div>
        <div className="text-xs text-slate-400 mb-3">Group employees and assign allocations here, then pick the category on each employee's Leave tab.</div>
        <div className="space-y-3">
          {pol.categories.map((c, i) => (
            <div key={c.id} className="border border-slate-100 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <input className={inputCls + ' max-w-xs'} value={c.name} onChange={(e) => setCat(i, { name: e.target.value })} />
                <span className="text-[11px] text-slate-400">id: {c.id}</span>
                {c.id !== 'default' && <button onClick={() => delCat(i)} className="ml-auto text-slate-300 hover:text-red-500"><Icon.Trash size={15} /></button>}
              </div>
              <div className="grid grid-cols-4 gap-3">
                {[['casual', 'Casual (CL)'], ['medical', 'Medical (ML)'], ['privilege', 'Privilege (PL)'], ['wfh', 'WFH']].map(([k, l]) => (
                  <SharedField key={k} label={l}><input type="number" className={inputCls} value={c.allocation?.[k] ?? 0} onChange={(e) => setCatAlloc(i, k, e.target.value)} /></SharedField>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Leave rules */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="text-sm font-bold text-[#050A1F] mb-3">Leave rules</div>
        <div className="space-y-3 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={!!pol.leaveRules.casual?.sandwichBlock} onChange={(e) => setPol((p) => ({ ...p, leaveRules: { ...p.leaveRules, casual: { ...p.leaveRules.casual, sandwichBlock: e.target.checked } } }))} /> Block <b>casual leave</b> immediately before/after a week-off or holiday (Fri/Mon etc.)</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={!!pol.leaveRules.medical?.requireDocument} onChange={(e) => setPol((p) => ({ ...p, leaveRules: { ...p.leaveRules, medical: { ...p.leaveRules.medical, requireDocument: e.target.checked } } }))} /> Require a <b>medical document</b> for medical leave</label>
          <div className="flex items-center gap-2"><span>Privilege leave must be applied</span><input type="number" className={inputCls + ' w-20'} value={pol.leaveRules.privilege?.noticeDays ?? 7} onChange={(e) => setPol((p) => ({ ...p, leaveRules: { ...p.leaveRules, privilege: { ...p.leaveRules.privilege, noticeDays: Number(e.target.value) || 0 } } }))} /><span>days in advance</span></div>
        </div>
      </div>

      {/* Late entry rules */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="text-sm font-bold text-[#050A1F] mb-3">Late-entry rules</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SharedField label="Grace (minutes)"><input type="number" className={inputCls} value={pol.lateRule.graceMinutes} onChange={(e) => setLate('graceMinutes', e.target.value)} /></SharedField>
          <SharedField label="Consecutive late = half day"><input type="number" className={inputCls} value={pol.lateRule.consecutiveForHalfDay} onChange={(e) => setLate('consecutiveForHalfDay', e.target.value)} /></SharedField>
          <SharedField label="Monthly late = half day"><input type="number" className={inputCls} value={pol.lateRule.monthlyForHalfDay} onChange={(e) => setLate('monthlyForHalfDay', e.target.value)} /></SharedField>
          <SharedField label="Shift hours / day"><input type="number" className={inputCls} value={pol.lateRule.shiftHours} onChange={(e) => setLate('shiftHours', e.target.value)} /></SharedField>
        </div>
        <div className="text-xs text-slate-400 mt-2">Deficit hours (short of the shift length) are deducted from salary: perDay = monthlyCTC/30, perHour = perDay/shiftHours, deduction = perHour × deficit hours.</div>
      </div>

      {/* Week-off rules */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="text-sm font-bold text-[#050A1F] mb-3">Week-off rules</div>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-slate-600 w-40">Default (all branches)</span>
            <select className={inputCls + ' max-w-xs'} value={woFor('__default').type} onChange={(e) => setWO('__default', { type: e.target.value })}>{WEEKOFF_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </div>
          {branches.map((b) => {
            const wo = woFor(b.name);
            return (
              <div key={b._id} className="flex items-center gap-3">
                <span className="text-sm font-semibold text-slate-600 w-40">{b.name}</span>
                <select className={inputCls + ' max-w-xs'} value={wo.type || ''} onChange={(e) => setWO(b.name, { type: e.target.value })}>
                  <option value="">Use default</option>
                  {WEEKOFF_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                {wo.type === 'custom' && (
                  <div className="flex gap-1">{WEEKDAYS.map(([v, l]) => { const on = (wo.days || []).includes(Number(v)); return <button key={v} onClick={() => setWO(b.name, { days: on ? (wo.days || []).filter((x) => x !== Number(v)) : [...(wo.days || []), Number(v)] })} className={`px-2 py-1 rounded text-[11px] font-bold ${on ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-400'}`}>{l}</button>; })}</div>
                )}
              </div>
            );
          })}
          <div className="text-xs text-slate-400">Bhubaneswar: 2nd & 4th Sat + all Sun. Kolkata: all Sat & Sun.</div>
        </div>
      </div>

      <div className="flex items-center gap-3 justify-end">
        {saved && <span className="text-sm text-green-600 font-semibold">Saved ✓</span>}
        <button onClick={save} disabled={busy} className="rounded-lg px-6 py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : 'Save policy'}</button>
      </div>
    </div>
  );
}

// Hierarchical organization chart: Admin (Management) at top, then each person
// nested under whoever they report to. Falls back to role-level grouping for
// anyone without an explicit manager.
function HrOrgChart({ users, reporting }) {
  const active = users.filter((u) => u.active);
  const byId = {};
  active.forEach((u) => { byId[u._id] = { ...u, children: [] }; });

  const roots = [];        // people reporting to an admin (or nobody)
  const adminBuckets = {}; // adminId -> [nodes]
  active.forEach((u) => {
    const node = byId[u._id];
    if (u.reportsToId && byId[u.reportsToId]) {
      byId[u.reportsToId].children.push(node);
    } else if (u.reportsToAdminId) {
      (adminBuckets[u.reportsToAdminId] = adminBuckets[u.reportsToAdminId] || []).push(node);
    } else {
      roots.push(node);
    }
  });

  // Sort children by seniority so the ladder reads top-down.
  const sortKids = (n) => { n.children.sort((a, b) => (ROLE_LEVEL[a.type] ?? 9) - (ROLE_LEVEL[b.type] ?? 9)); n.children.forEach(sortKids); };
  Object.values(byId).forEach((n) => { if (!n._sorted) { n.children.sort((a, b) => (ROLE_LEVEL[a.type] ?? 9) - (ROLE_LEVEL[b.type] ?? 9)); } });
  roots.forEach(sortKids);
  Object.values(adminBuckets).forEach((arr) => arr.forEach(sortKids));

  const Node = ({ n, depth }) => (
    <div className="ml-0">
      <div className="flex items-center gap-2 py-1.5" style={{ paddingLeft: depth * 22 }}>
        {depth > 0 && <span className="text-slate-300 text-xs">└</span>}
        <Avatar name={n.name} src={n.avatar} size={30} />
        <div>
          <div className="text-sm font-bold text-[#050A1F]">{n.name} {n.branchIncharge && <span className="text-[9px] font-bold text-[#FF4500]">IN-CHARGE</span>}</div>
          <div className="text-[11px] text-slate-400">{ROLE_LABELS[n.type] || n.type}{n.department ? ` · ${n.department}` : ''}{n.branch ? ` · ${n.branch}` : ''}</div>
        </div>
      </div>
      {n.children.map((c) => <Node key={c._id} n={c} depth={depth + 1} />)}
    </div>
  );

  const admins = reporting.admins || [];
  // Any employees bucketed under an admin who is no longer in the list (removed
  // from HR / deleted in CRM) would otherwise vanish — surface them as orphaned.
  const adminIdSet = new Set(admins.map((a) => a.id));
  const orphanedReports = Object.entries(adminBuckets)
    .filter(([adminId]) => !adminIdSet.has(Number(adminId)) && !adminIdSet.has(adminId))
    .flatMap(([, arr]) => arr);
  const allRoots = [...roots, ...orphanedReports];
  return (
    <div className="space-y-4">
      {admins.map((a) => (
        <div key={a.id} className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-[#050A1F] text-white flex items-center justify-center text-xs font-bold">{a.name[0]}</div>
            <div><div className="text-sm font-extrabold text-[#050A1F]">{a.name}</div><div className="text-[11px] text-slate-400 uppercase tracking-wide font-bold">Management · Admin</div></div>
          </div>
          <div className="border-t border-slate-100 pt-2">
            {(adminBuckets[a.id] || []).map((n) => <Node key={n._id} n={n} depth={1} />)}
            {(!adminBuckets[a.id] || adminBuckets[a.id].length === 0) && <div className="text-slate-400 text-xs py-2 pl-6">No direct reports.</div>}
          </div>
        </div>
      ))}
      {allRoots.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="text-[11px] text-slate-400 uppercase tracking-wide font-bold mb-2">Unassigned (no reporting manager)</div>
          {allRoots.map((n) => <Node key={n._id} n={n} depth={0} />)}
        </div>
      )}
      {active.length === 0 && <div className="text-slate-400 text-sm text-center py-8">No active employees to chart yet.</div>}
    </div>
  );
}

// Full-screen visual organization chart — a top-down tree of cards with a
// colored header band per level (navy = management, blue = second level,
// green = the rest), avatar + role in the band and name/phone/email below,
// connector lines, and collapse/expand toggles. Built from the reporting graph.
// Full-screen organization directory — white background, grouped as: admins
// (management) on top, then each department, and within a department ordered by
// hierarchy (Manager -> Team Lead -> Senior -> Junior -> the rest). Each person
// is a white card: circular photo on the left, name/designation/phone/email on
// the right.
// Full-screen organization chart — tree format (top-down with connector lines
// and collapse toggles), white cards. Admins (management) sit at the top; under
// them the departments branch out; within each department, people are ordered by
// hierarchy (Manager -> Team Lead -> Senior -> Junior -> the rest) in a vertical
// chain. Each card: circular photo left, name/designation/phone/email right.
function HrOrgChartModal({ users, reporting, onClose }) {
  const active = (users || []).filter((u) => u.active);
  const admins = (reporting.admins || []);
  const [collapsed, setCollapsed] = useState({});
  const toggle = (k) => setCollapsed((c) => ({ ...c, [k]: !c[k] }));

  // Measured management→department connectors (see EmployeeOrgChartModal). Pixel
  // measurement keeps the bar exact regardless of subtree widths.
  const connWrapRef = useRef(null);
  const trunkRef = useRef(null);
  const pillRefs = useRef({});
  const [geo, setGeo] = useState(null);
  const deptSig = active.map((u) => u.department).join('|') + '::' + Object.keys(collapsed).filter((k) => collapsed[k]).join(',');
  useLayoutEffect(() => {
    const measure = () => {
      const wrap = connWrapRef.current;
      if (!wrap) { setGeo(null); return; }
      const base = wrap.getBoundingClientRect();
      const xs = Object.values(pillRefs.current).filter(Boolean).map((el) => {
        const r = el.getBoundingClientRect();
        return r.left - base.left + r.width / 2;
      });
      if (xs.length < 1) { setGeo(null); return; }
      let trunkX = (Math.min(...xs) + Math.max(...xs)) / 2;
      if (trunkRef.current) { const tr = trunkRef.current.getBoundingClientRect(); trunkX = tr.left - base.left + tr.width / 2; }
      setGeo({ barLeft: Math.min(...xs), barRight: Math.max(...xs), drops: xs, trunkX });
    };
    measure();
    window.addEventListener('resize', measure);
    const t = setTimeout(measure, 60);
    return () => { window.removeEventListener('resize', measure); clearTimeout(t); };
  }, [deptSig]);

  const ringFor = (type) => {
    if (type === 'director' || type === 'admin') return '#0A1F44';
    if (type === 'manager') return '#1CA0E8';
    if (type === 'tl') return '#7C3AED';
    if (type === 'hr' || type === 'recruiter') return '#0EA5E9';
    return '#A4C639';
  };
  const PhoneIcon = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -1, marginRight: 5, flexShrink: 0 }}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" /></svg>;
  const MailIcon = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -1, marginRight: 5, flexShrink: 0 }}><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 6L2 7" /></svg>;

  // A person card. 20px left/right margin so adjacent columns never touch.
  const PersonCard = ({ p, w = 270 }) => (
    <div className="inline-flex items-center gap-3 bg-white border border-slate-200 rounded-xl" style={{ padding: '13px 15px', boxShadow: '0 2px 6px rgba(10,20,60,.07)', width: w, margin: '0 20px', textAlign: 'left' }}>
      <div className="shrink-0 rounded-full overflow-hidden flex items-center justify-center text-white font-bold" style={{ width: 48, height: 48, fontSize: 19, background: ringFor(p.type) }}>
        {p.avatar ? <img src={p.avatar} alt="" className="w-full h-full object-cover" /> : (p.name || '?')[0]}
      </div>
      <div className="min-w-0 overflow-hidden">
        <div className="text-[13px] font-bold text-[#0A0E28] truncate">{titleCase(p.name)}{p.branchIncharge && <span className="ml-1.5 text-[9px] font-bold text-[#FF4500]">IN-CHARGE</span>}</div>
        <div className="text-[11px] font-semibold text-[#FF6A00] truncate" style={{ marginBottom: 3 }}>{p.designation || ROLE_LABELS[p.type] || p.type}</div>
        <div className="text-[11px] text-slate-500 truncate flex items-center"><PhoneIcon />{p.phone || '—'}</div>
        <div className="text-[11px] text-slate-500 truncate flex items-center"><MailIcon />{p.email || '—'}</div>
      </div>
    </div>
  );

  // Vertical connector segment.
  const VConn = ({ h = 18 }) => <div style={{ width: 1, height: h, background: '#cbd5e1', margin: '0 auto' }} />;
  // Collapse toggle under a node.
  const Toggle = ({ k }) => (
    <div className="flex flex-col items-center">
      <div style={{ width: 1, height: 14, background: '#cbd5e1' }} />
      <button onClick={() => toggle(k)} className="rounded-full border border-slate-300 bg-white text-slate-500 flex items-center justify-center hover:bg-slate-50 leading-none" style={{ width: 18, height: 18, fontSize: 12 }}>{collapsed[k] ? '+' : '−'}</button>
    </div>
  );

  // Group employees by department.
  const byDept = {};
  active.forEach((u) => { const d = (u.department && String(u.department).trim()) || 'Unassigned'; (byDept[d] = byDept[d] || []).push(u); });
  const deptNames = Object.keys(byDept).sort((a, b) => (a === 'Unassigned') - (b === 'Unassigned') || a.localeCompare(b));

  // Build the reporting tree for a department from reportsToId. A person is a
  // top-level branch of the department when they don't report to someone else in
  // the SAME department (e.g. they report to the Director, or to a lead in
  // another dept, or to nobody). Children hang under their manager, so 2 team
  // leads under a manager render as 2 branches, and a senior who reports to the
  // Director sits as their own branch beside them.
  const buildDeptTree = (people) => {
    const idSet = new Set(people.map((u) => u._id));
    const nodeById = {};
    people.forEach((u) => { nodeById[u._id] = { p: u, children: [] }; });
    const roots = [];
    people.forEach((u) => {
      const parentInDept = u.reportsToId && idSet.has(u.reportsToId) && u.reportsToId !== u._id;
      if (parentInDept) nodeById[u.reportsToId].children.push(nodeById[u._id]);
      else roots.push(nodeById[u._id]);
    });
    // Sort siblings by role level then name, top-down.
    const sortKids = (n) => {
      n.children.sort((a, b) => (ROLE_LEVEL[a.p.type] ?? 9) - (ROLE_LEVEL[b.p.type] ?? 9) || (a.p.name || '').localeCompare(b.p.name || ''));
      n.children.forEach(sortKids);
    };
    roots.sort((a, b) => (ROLE_LEVEL[a.p.type] ?? 9) - (ROLE_LEVEL[b.p.type] ?? 9) || (a.p.name || '').localeCompare(b.p.name || ''));
    roots.forEach(sortKids);
    return roots;
  };

  // A subtree node. The person on top; below, a minimize/maximize toggle and
  // their reports stacked in a SINGLE vertical column. Only the department's
  // senior/lead row is laid out side-by-side.
  const TreeNode = ({ node, keyPath }) => {
    const kids = node.children;
    const nk = `node:${keyPath}`;
    const isCollapsed = collapsed[nk];
    return (
      <div className="inline-flex flex-col items-center align-top" style={{ verticalAlign: 'top' }}>
        <PersonCard p={node.p} />
        {kids.length > 0 && (
          <>
            <div style={{ width: 1, height: 12, background: '#cbd5e1' }} />
            <button onClick={() => toggle(nk)} className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-500 hover:bg-slate-50 leading-none">
              <span style={{ fontSize: 12, lineHeight: 1 }}>{isCollapsed ? '+' : '−'}</span>{isCollapsed ? `Show ${kids.length}` : 'Hide'}
            </button>
            {!isCollapsed && (
              <div className="flex flex-col items-center">
                {kids.map((c) => (
                  <div key={c.p._id} className="flex flex-col items-center">
                    <div style={{ width: 1, height: 14, background: '#cbd5e1' }} />
                    <TreeNode node={c} keyPath={`${keyPath}/${c.p._id}`} />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  // A department block: navy pill header, a clean connector down to the senior
  // row, then each senior's reports stacked in a column below them.
  const DeptColumn = ({ name }) => {
    const people = byDept[name] || [];
    const roots = buildDeptTree(people);
    const multi = roots.length > 1;
    return (
      <div className="inline-flex flex-col items-center align-top" style={{ verticalAlign: 'top' }}>
        <div ref={(el) => { pillRefs.current[name] = el; }} className="inline-block text-white font-extrabold uppercase" style={{ background: '#0A1F44', fontSize: 12, letterSpacing: '.06em', padding: '9px 20px', borderRadius: 8 }}>{name}</div>
        {roots.length > 0 && (
          <>
            <div style={{ width: 1, height: 18, background: '#cbd5e1' }} />
            <div className="relative">
              {/* Bar inset to the outermost card centers (card 270 + 20px margins
                  → center at 155px) so it never overhangs the seniors. */}
              {multi && <div style={{ position: 'absolute', top: 0, left: 155, right: 155, height: 1, background: '#cbd5e1' }} />}
              <div className="flex items-start justify-center">
                {roots.map((r) => (
                  <div key={r.p._id} className="flex flex-col items-center">
                    {multi && <div style={{ width: 1, height: 16, background: '#cbd5e1' }} />}
                    <TreeNode node={r} keyPath={`${name}/${r.p._id}`} />
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  const hasAny = admins.length > 0 || active.length > 0;
  // The top management node — use the first admin as the tree root; if there are
  // several admins, show them side by side as co-roots above the departments.
  return (
    <div className="fixed inset-0 bg-black/50 z-[140] flex flex-col" onClick={onClose}>
      <div className="bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between shrink-0" onClick={(e) => e.stopPropagation()}>
        <div className="text-sm font-extrabold text-[#050A1F]">Organization chart</div>
        <div className="flex items-center gap-2">
          <button onClick={() => setCollapsed({})} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">Expand all</button>
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: ORANGE }}>Close</button>
        </div>
      </div>
      <div className="flex-1 overflow-auto bg-white p-10" onClick={(e) => e.stopPropagation()}>
        {!hasAny ? <div className="text-slate-400 text-sm text-center py-20">No active employees to chart yet.</div> : (
          <div className="min-w-max mx-auto flex flex-col items-center">
            {/* Management row (admins), joined by a bar when >1. A trunk marker
                centres the SVG trunk; the collapse-all toggle sits on it. */}
            {admins.length > 0 && (
              <div className="inline-flex flex-col items-center">
                <div className="relative">
                  {admins.length > 1 && <div style={{ position: 'absolute', bottom: 0, left: 155, right: 155, height: 1, background: '#cbd5e1' }} />}
                  <div className="flex items-start justify-center">
                    {admins.map((a) => (
                      <div key={`admin:${a.id}`} className="flex flex-col items-center">
                        <PersonCard p={{ name: a.name, designation: 'Director · Admin', type: 'director', avatar: a.avatar, phone: a.phone, email: a.email }} w={280} />
                        {admins.length > 1 && <div style={{ width: 1, height: 14, background: '#cbd5e1' }} />}
                      </div>
                    ))}
                  </div>
                </div>
                {deptNames.length > 0 && (
                  <div className="flex flex-col items-center" ref={trunkRef}>
                    <Toggle k="__depts__" />
                  </div>
                )}
              </div>
            )}
            {/* Measured connector layer + department row. */}
            {deptNames.length > 0 && !collapsed['__depts__'] && (
              <>
                {admins.length > 0 && (
                  <div ref={connWrapRef} className="relative" style={{ width: '100%', height: 30 }}>
                    {geo && (
                      <svg width="100%" height="30" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
                        <line x1={geo.trunkX} y1={0} x2={geo.trunkX} y2={15} stroke="#cbd5e1" strokeWidth="1" shapeRendering="crispEdges" />
                        {deptNames.length > 1 && <line x1={geo.barLeft} y1={15} x2={geo.barRight} y2={15} stroke="#cbd5e1" strokeWidth="1" shapeRendering="crispEdges" />}
                        {geo.drops.map((x, i) => <line key={i} x1={x} y1={15} x2={x} y2={30} stroke="#cbd5e1" strokeWidth="1" shapeRendering="crispEdges" />)}
                      </svg>
                    )}
                  </div>
                )}
                <div className="flex items-start justify-center">
                  {deptNames.map((d) => (
                    <div key={d} className="inline-flex flex-col items-center align-top" style={{ verticalAlign: 'top', padding: '0 22px' }}>
                      <DeptColumn name={d} />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


// Fixed left-edge "Report a bug / feedback" button, available on every HRMS
// page for any signed-in user. Opens a small form that posts to /feedback;
// submissions appear in Admin → Settings → Error Report.
function FeedbackWidget({ page, userName }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('bug');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');
  // Human-readable page label for the report (the SPA path alone is not useful).
  const PAGE_LABELS = { dashboard: 'Dashboard', tasks: 'Task Manager', recruitment: 'Recruitment', attendance: 'Attendance', leave: 'Leave', employees: 'Employees', payroll: 'Payroll', admin: 'Admin / Settings', survey: 'Surveys', onboarding: 'Onboarding' };
  const pageLabel = PAGE_LABELS[page] || page || 'HRMS';
  const submit = async () => {
    if (!message.trim()) { setErr('Please describe the issue.'); return; }
    setBusy(true); setErr('');
    try {
      const path = (typeof window !== 'undefined' ? window.location.pathname + window.location.search : '');
      await hrApi('/feedback', { method: 'POST', body: JSON.stringify({
        kind, message: message.trim(),
        pageUrl: `${pageLabel}${path ? ` (${path})` : ''}`,
        userAgent: (typeof navigator !== 'undefined' ? navigator.userAgent : ''),
      }) });
      setDone(true); setMessage('');
      setTimeout(() => { setOpen(false); setDone(false); }, 1600);
    } catch (e) { setErr(e.message || 'Could not send. Try again.'); }
    finally { setBusy(false); }
  };
  return (
    <>
      {/* Fixed tab on the left edge */}
      <button onClick={() => { setOpen(true); setDone(false); setErr(''); }}
        title="Report a bug or share feedback"
        className="fixed right-0 top-1/2 z-[90] flex items-center gap-1.5 rounded-l-xl px-2 py-3 text-white text-[11px] font-extrabold shadow-lg hover:pr-3 transition-all"
        style={{ background: 'linear-gradient(180deg,#FF6A00,#FF4500)', writingMode: 'vertical-rl', transform: 'translateY(-50%)' }}>
        <span>🐞 Report a bug</span>
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[140] p-4" onClick={() => !busy && setOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="text-lg font-extrabold text-[#050A1F]">Report a bug / feedback</div>
              <button onClick={() => !busy && setOpen(false)} className="text-slate-400 text-xl leading-none">×</button>
            </div>
            {done ? (
              <div className="p-8 text-center">
                <div className="text-4xl mb-2">✅</div>
                <div className="font-extrabold text-[#050A1F]">Thanks — sent to the team.</div>
                <div className="text-sm text-slate-400 mt-1">We'll take a look. You can close this.</div>
              </div>
            ) : (
              <div className="p-6 space-y-4">
                <div className="text-xs text-slate-500">Found something broken or have a suggestion? Tell us — this goes straight to the admin's Error Report.</div>
                <div>
                  <div className="text-xs font-bold text-slate-500 mb-1.5">Type</div>
                  <div className="grid grid-cols-3 gap-2">
                    {[['bug', '🐞 Bug'], ['suggestion', '💡 Suggestion'], ['other', '💬 Other']].map(([k, lbl]) => (
                      <button key={k} onClick={() => setKind(k)} className={`rounded-lg border px-2 py-2 text-xs font-bold ${kind === k ? 'border-orange-400 bg-orange-50 text-[#FF4500]' : 'border-slate-200 text-slate-600'}`}>{lbl}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-500 mb-1.5">What happened?</div>
                  <textarea autoFocus rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Describe the bug or feedback. Include what you clicked and what you expected."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                  <div className="text-[10px] text-slate-400 mt-1">Reporting from <b className="text-slate-500">{pageLabel}</b>{userName ? <> as <b className="text-slate-500">{titleCase(userName)}</b></> : null} — we'll include this automatically.</div>
                </div>
                {err && <div className="rounded-lg bg-red-50 border border-red-200 text-red-600 text-xs px-3 py-2">{err}</div>}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setOpen(false)} disabled={busy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
                  <button onClick={submit} disabled={busy || !message.trim()} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Sending…' : 'Send report'}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default function HrApp() {
  const navigate = useNavigate();
  const location = useLocation();
  // Derive the current view from the URL path (/hr/<view>) so refresh and deep
  // links keep the user on the same page. Falls back to dashboard.
  const VALID_VIEWS = ['dashboard', 'recognition', 'rewards', 'tasks', 'recruitment', 'interview', 'email', 'employees', 'survey', 'profile', 'templates', 'signature', 'admin',
    'corehr_attendance', 'corehr_leave', 'corehr_payroll', 'corehr_expenses', 'corehr_stock', 'corehr_onboarding'];
  // Clean-URL slugs for the Core HR sub-pages: the internal view id keeps its
  // underscore (used all over the component tree), but the URL uses a tidy
  // hyphenated path, e.g. corehr_attendance <-> core-hr/attendance.
  const viewToSlug = (v) => v.startsWith('corehr_') ? `core-hr/${v.slice('corehr_'.length)}` : v;
  const slugToView = (path) => {
    // Strip the base prefix — '/hr' off the HRMS-domain-less builds, or '' when
    // the HR app is mounted at the clean root on people.qtonix.com.
    let clean = path;
    if (HR_BASE) clean = clean.replace(new RegExp('^' + HR_BASE + '\\/?'), '');
    else clean = clean.replace(/^\//, '');
    clean = clean.replace(/\/+$/, '').toLowerCase();
    if (clean.startsWith('core-hr/')) { const id = 'corehr_' + clean.slice('core-hr/'.length).split('/')[0]; return VALID_VIEWS.includes(id) ? id : 'dashboard'; }
    const seg = clean.split('/')[0] || '';
    return VALID_VIEWS.includes(seg) ? seg : 'dashboard';
  };
  const pathView = slugToView(location.pathname);
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [view, setViewRaw] = useState(pathView);
  const [profileTarget, setProfileTarget] = useState(null);
  const [navKey, setNavKey] = useState(0); // bump to force a fresh sub-view on nav
  const [mobileNav, setMobileNav] = useState(false);
  const [recruitIntent, setRecruitIntent] = useState(null); // {tab, candScope, weekOnly, jobScope}
  const [dashView, setDashView] = useState('hr'); // HR/Admin can flip to 'emp' to preview the employee dashboard
  // setView writes a clean URL under the base: /dashboard on the HRMS domain, or
  // /hr/dashboard elsewhere. Core HR as <base>/core-hr/<sub>.
  const setView = (v) => { setViewRaw(v); const target = `${HR_BASE}/${viewToSlug(v)}`; if (location.pathname !== target) navigate(target); };
  useEffect(() => { if (pathView !== view) setViewRaw(pathView); }, [pathView]);
  // Redirect legacy underscore Core-HR URLs to the clean slug.
  useEffect(() => {
    let seg = location.pathname;
    if (HR_BASE) seg = seg.replace(new RegExp('^' + HR_BASE + '\\/?'), ''); else seg = seg.replace(/^\//, '');
    seg = (seg.split('/')[0] || '');
    if (seg.startsWith('corehr_')) {
      const clean = `${HR_BASE}/${viewToSlug(seg)}`;
      if (location.pathname !== clean) navigate(clean, { replace: true });
    }
  }, [location.pathname]);
  const goRecruit = (intent) => { setRecruitIntent(intent || null); setView('recruitment'); setProfileTarget(null); setNavKey((k) => k + 1); };

  // Restore session.
  useEffect(() => {
    const token = localStorage.getItem(HR_TOKEN_KEY);
    if (!token) { setChecking(false); return; }
    hrApi('/me').then((u) => setUser(u)).catch(() => localStorage.removeItem(HR_TOKEN_KEY)).finally(() => setChecking(false));
  }, []);

  const refreshUser = () => hrApi('/me').then(setUser).catch(() => {});
  const logout = () => { hrApi('/auth/logout', { method: 'POST' }).catch(() => {}).finally(() => { localStorage.removeItem(HR_TOKEN_KEY); setUser(null); window.location.href = `${HR_BASE}/login`; }); };

  // For plain employees, whether they sit on any interview panel (drives whether
  // the Recruitment tab — candidate-list only — is shown at all).
  const [hasPanel, setHasPanel] = useState(false);
  useEffect(() => {
    if (!user) return;
    const dept = /^(hr|human resource|human resources)$/i.test(String(user.department || '').trim());
    const hrLike = user.isAdmin || ['hr', 'recruiter'].includes(user.type) || dept || user.isHrManager || user.hrManagerScope;
    if (hrLike) { setHasPanel(false); return; }
    hrApi('/my-interviews').then((r) => {
      const jobs = (r && r.jobs) || [];
      setHasPanel(jobs.some((j) => (j.candidates || []).length > 0));
    }).catch(() => setHasPanel(false));
  }, [user && user.id]);

  if (checking) return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-400 text-sm">Loading…</div>;
  if (!user) return <HrLogin onSignIn={(u) => { setUser(u); hrApi('/me').then(setUser).catch(() => {}); }} />;

  const isAdmin = !!user.isAdmin;
  // True HR = the HR department, or the hr/recruiter roles. Generic "manager"/"tl"
  // job types are NOT HR (e.g. a sales team lead) and must not get HR surfaces.
  const isHrDept = /^(hr|human resource|human resources)$/i.test(String(user.department || '').trim());
  const isHrStaff = isAdmin || ['hr', 'recruiter'].includes(user.type) || isHrDept;
  // Core HR is for HR Managers (any scope) + admins. An HR Manager is someone
  // explicitly flagged/scoped as one — not any generic "manager" job type.
  const isHrManager = isAdmin || !!user.isHrManager || !!user.hrManagerScope;
  // Schedulers (may schedule interviews) — hr/recruiter roles + admins. Used for
  // the Email box only; does NOT by itself grant the HR dashboard or Recruitment.
  const isScheduler = isAdmin || ['hr', 'recruiter'].includes(user.type) || isHrDept;
  // Only HR-department staff (and admins) may create/manage job posts.
  const canPostJobs = isAdmin || isHrDept || ['hr', 'recruiter'].includes(user.type);
  const nav = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'tasks', label: 'Task' },
    ...((isAdmin || isHrStaff || isHrManager || user.hasReports) ? [{ id: 'recognition', label: 'Recognition' }] : []),
    ...(!(isAdmin || isHrStaff || isHrManager) ? [{ id: 'rewards', label: 'My Rewards' }] : []),
    { id: 'interview', label: 'Interview' },
    ...(isScheduler ? [{ id: 'email', label: 'Email' }] : []),
    ...((isHrStaff || hasPanel) ? [{ id: 'recruitment', label: 'Recruitment' }] : []),
    ...(isHrManager ? [{ id: 'corehr', label: 'Core HR', children: [
      { id: 'corehr_attendance', label: 'Attendance' },
      { id: 'corehr_leave', label: 'Leave' },
      { id: 'corehr_payroll', label: 'Payroll' },
      { id: 'corehr_expenses', label: 'Expenses' },
      { id: 'corehr_stock', label: 'Stock Management' },
      { id: 'corehr_onboarding', label: 'Onboarding' },
      { id: 'employees', label: 'Employee' },
    ] }] : []),
    ...((isAdmin || user.hrManagerAll || user.hrManagerScope === 'all') ? [{ id: 'survey', label: 'Survey' }] : []),
    ...(isAdmin ? [{ id: 'admin', label: 'Admin' }] : []),
  ];
  const effectiveView = view;

  return (
    <div className="min-h-screen bg-slate-50" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <header className="bg-[#050A1F] text-white">
        <div className="max-w-6xl mx-auto px-4 flex items-center justify-between h-14 gap-2">
          <div className="flex items-center gap-3 md:gap-6 min-w-0">
            <div className="flex items-center gap-3 shrink-0">
              <div className="text-lg font-extrabold tracking-tight">Qtonix<span className="text-[#FF6A00]">.</span></div>
              <AppSwitcher current="hr" />
            </div>
            {/* Desktop nav */}
            <nav className="hidden md:flex gap-0.5">
              {nav.map((n) => n.children ? (
                <div key={n.id} className="relative group">
                  <button className={`rounded-lg px-3 py-2 text-xs font-bold transition-colors flex items-center gap-1 ${n.children.some((c) => c.id === effectiveView) ? 'text-[#FF6A00]' : 'text-slate-400 hover:text-white'}`}>
                    {n.label}
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                  <div className="absolute left-0 top-full pt-1 hidden group-hover:block z-50">
                    <div className="bg-white rounded-xl shadow-xl border border-slate-200 py-1 min-w-[180px]">
                      {n.children.map((c) => (
                        <button key={c.id} onClick={() => { setView(c.id); setProfileTarget(null); setRecruitIntent(null); setNavKey((k) => k + 1); }}
                          className={`w-full text-left px-4 py-2 text-xs font-semibold transition-colors ${effectiveView === c.id ? 'text-[#FF6A00] bg-orange-50' : 'text-slate-600 hover:bg-slate-50'}`}>
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <button key={n.id} onClick={() => { setView(n.id); setProfileTarget(null); setRecruitIntent(null); setNavKey((k) => k + 1); }}
                  className={`rounded-lg px-3 py-2 text-xs font-bold transition-colors ${effectiveView === n.id ? 'text-[#FF6A00]' : 'text-slate-400 hover:text-white'}`}>
                  {n.label}
                </button>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <NotificationBell onOpenCandidate={(id) => { setView('recruitment'); setNavKey((k) => k + 1); }} />
            <UserMenu user={user} onNavigate={(v) => { setView(v); setProfileTarget(null); setNavKey((k) => k + 1); }} onLogout={logout} isAdmin={isAdmin} />
            {/* Mobile menu toggle */}
            <button onClick={() => setMobileNav((v) => !v)} className="md:hidden rounded-lg p-2 text-slate-300 hover:text-white hover:bg-white/10" aria-label="Menu">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d={mobileNav ? 'M6 6l12 12M6 18L18 6' : 'M4 7h16M4 12h16M4 17h16'} strokeLinecap="round" /></svg>
            </button>
          </div>
        </div>
        {/* Mobile nav drawer */}
        {mobileNav && (
          <nav className="md:hidden border-t border-white/10 px-2 py-2 flex flex-col gap-0.5">
            {nav.map((n) => n.children ? (
              <div key={n.id}>
                <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">{n.label}</div>
                {n.children.map((c) => (
                  <button key={c.id} onClick={() => { setView(c.id); setProfileTarget(null); setRecruitIntent(null); setNavKey((k) => k + 1); setMobileNav(false); }}
                    className={`w-full text-left rounded-lg pl-6 pr-3 py-2.5 text-sm font-bold transition-colors ${effectiveView === c.id ? 'bg-white/10 text-[#FF6A00]' : 'text-slate-300 hover:text-white hover:bg-white/5'}`}>
                    {c.label}
                  </button>
                ))}
              </div>
            ) : (
              <button key={n.id} onClick={() => { setView(n.id); setProfileTarget(null); setRecruitIntent(null); setNavKey((k) => k + 1); setMobileNav(false); }}
                className={`text-left rounded-lg px-3 py-2.5 text-sm font-bold transition-colors ${effectiveView === n.id ? 'bg-white/10 text-[#FF6A00]' : 'text-slate-300 hover:text-white hover:bg-white/5'}`}>
                {n.label}
              </button>
            ))}
          </nav>
        )}
      </header>
      {!isAdmin && <div className="max-w-6xl mx-auto px-4 pt-4"><HrSurveyGate /></div>}
      <main className="max-w-6xl mx-auto px-4 py-8" key={`${effectiveView}-${navKey}`}>
        {effectiveView === 'dashboard' && (isHrStaff || isHrManager || isAdmin ? (
          <div>
            <DashboardCelebrations />
            <div className="flex justify-end mb-4">
              <div className="inline-flex bg-white border border-slate-200 rounded-xl p-1">
                <button onClick={() => setDashView('hr')} className={`px-4 py-2 rounded-lg text-[13px] font-extrabold ${dashView === 'hr' ? 'text-white' : 'text-slate-500'}`} style={dashView === 'hr' ? { background: 'linear-gradient(90deg,#FF6A00,#FF4500)' } : {}}>HR Dashboard</button>
                <button onClick={() => setDashView('emp')} className={`px-4 py-2 rounded-lg text-[13px] font-extrabold ${dashView === 'emp' ? 'text-white' : 'text-slate-500'}`} style={dashView === 'emp' ? { background: 'linear-gradient(90deg,#FF6A00,#FF4500)' } : {}}>Employee Dashboard</button>
              </div>
            </div>
            {dashView === 'hr'
              ? <HrDashboard user={user} isAdmin={isAdmin} onOpenCandidate={(id, candTab) => goRecruit({ tab: 'candidates', openCandidateId: id, openCandidateTab: candTab })} onNav={goRecruit} />
              : <EmployeeDashboard user={user} onNav={setView} onOpenCandidate={(id, tab) => goRecruit({ tab: 'candidates', openCandidateId: id, openCandidateTab: tab })} />}
          </div>
        ) : <div><DashboardCelebrations /><EmployeeDashboard user={user} onNav={setView} onOpenCandidate={(id, tab) => goRecruit({ tab: 'candidates', openCandidateId: id, openCandidateTab: tab })} /></div>)}
        {effectiveView === 'recognition' && <RecognitionPage user={user} onOpenEmployee={(id) => { setProfileTarget(id); setView('employees'); setNavKey((k) => k + 1); }} />}
        {effectiveView === 'rewards' && <MyRewardsPage user={user} />}
        {effectiveView === 'tasks' && <HrTasksView user={user} isAdmin={isAdmin} />}
        {effectiveView === 'corehr_attendance' && <AttendanceModule user={user} isAdmin={isAdmin} onOpenEmployee={(id) => { setProfileTarget(id); setView('employees'); setNavKey((k) => k + 1); }} />}
        {effectiveView === 'corehr_leave' && <LeaveConsole user={user} isAdmin={isAdmin} onOpenEmployee={(id) => { setProfileTarget(id); setView('employees'); setNavKey((k) => k + 1); }} />}
        {effectiveView === 'corehr_payroll' && <CoreHrPlaceholder title="Payroll" />}
        {effectiveView === 'corehr_expenses' && <HrExpenses user={user} isAdmin={isAdmin} />}
        {effectiveView === 'corehr_stock' && <CoreHrPlaceholder title="Stock Management" />}
        {effectiveView === 'corehr_onboarding' && <OnboardingListPage isAdmin={isAdmin} onOpenCandidate={(id) => goRecruit({ tab: 'candidates', openCandidateId: id })} />}
        {effectiveView === 'recruitment' && <HrRecruitment isAdmin={isAdmin} me={user} intent={recruitIntent} hrView={isHrStaff} />}
        {effectiveView === 'interview' && <MyInterviews />}
        {effectiveView === 'email' && isScheduler && (
          <AllEmailPage user={user} apiFn={hrApi} base="" features={{ scheduled: false, templates: false, ai: true, leadLinks: false }} />
        )}
        {effectiveView === 'employees' && (
          profileTarget
            ? <div><button onClick={() => setProfileTarget(null)} className="text-xs font-bold text-slate-400 mb-3">← Back to employees</button><ProfilePage me={user} targetId={profileTarget} /></div>
            : <EmployeeDirectory isAdmin={isAdmin} me={user} onOpenProfile={(id) => setProfileTarget(id)} />
        )}
        {effectiveView === 'profile' && <MyProfilePage user={user} onUpdated={refreshUser} />}
        {effectiveView === 'templates' && <EmailTemplatesPage />}
        {effectiveView === 'signature' && <EmailSignaturePage />}
        {effectiveView === 'admin' && isAdmin && <HrAdmin user={user} onOpenCandidate={(id) => goRecruit({ tab: 'candidates', openCandidateId: id })} />}
        {effectiveView === 'survey' && (isAdmin || user.hrManagerAll || user.hrManagerScope === 'all') && <HrSurveyAdmin isAdmin={isAdmin} />}
      </main>
      <FeedbackWidget page={effectiveView} userName={user && user.name} />
    </div>
  );
}

// In-app notifications bell (mentions, new applications, interview reminders).
function NotificationBell({ onOpenCandidate }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const load = () => hrApi('/notifications').then((r) => { setItems(r.notifications || []); setUnread(r.unread || 0); }).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
  const markAll = async () => { try { await hrApi('/notifications/read', { method: 'POST', body: JSON.stringify({}) }); setUnread(0); setItems((xs) => xs.map((x) => ({ ...x, read: true }))); } catch {} };
  const removeOne = async (id) => { setItems((xs) => xs.filter((x) => x._id !== id)); setUnread((u) => Math.max(0, u - 1)); try { await hrApi(`/notifications/${id}`, { method: 'DELETE' }); } catch {} };
  const clearAll = async () => { setItems([]); setUnread(0); try { await hrApi('/notifications/clear', { method: 'POST', body: JSON.stringify({}) }); } catch {} };
  const icon = (t) => t === 'mention' ? '💬' : t === 'application' ? '📥' : t === 'interview' ? '📅' : t === 'offer' ? '📄' : '🔔';
  return (
    <div className="relative">
      <button onClick={() => { setOpen((v) => !v); if (!open && unread) markAll(); }} className="relative w-9 h-9 rounded-lg hover:bg-white/10 flex items-center justify-center text-slate-300" title="Notifications">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
        {unread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[#FF4500] text-white text-[10px] font-bold flex items-center justify-center">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-2xl border border-slate-100 z-50 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <span className="font-extrabold text-[#050A1F] text-sm">Notifications</span>
              {items.length > 0 && <button onClick={clearAll} className="text-[11px] font-bold text-orange-600">Clear all</button>}
            </div>
            <div className="max-h-96 overflow-auto">
              {items.length === 0 ? <div className="px-4 py-8 text-center text-slate-400 text-sm">You're all caught up.</div> : items.map((n) => (
                <div key={n._id} className={`group w-full px-4 py-3 border-b border-slate-50 hover:bg-slate-50 flex gap-3 items-start ${n.read ? '' : 'bg-orange-50/40'}`}>
                  <button onClick={() => { setOpen(false); if (n.candidateId && onOpenCandidate) onOpenCandidate(n.candidateId); }} className="flex gap-3 text-left min-w-0 flex-1">
                    <span className="text-lg leading-none">{icon(n.type)}</span>
                    <div className="min-w-0">
                      <div className="text-sm text-slate-700">{n.text}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">{timeAgo(n.createdAt)}</div>
                    </div>
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); removeOne(n._id); }} title="Dismiss" className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-slate-300 hover:bg-red-100 hover:text-red-600 opacity-0 group-hover:opacity-100">×</button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Top-right user dropdown: My Profile, Email Template, Email Signature, Logout.
function UserMenu({ user, onNavigate, onLogout, isAdmin }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);
  const item = (label, action) => <button onClick={() => { setOpen(false); action(); }} className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">{label}</button>;
  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-400">
        <span className="w-6 h-6 rounded-full bg-[#FF6A00] text-white flex items-center justify-center text-[11px]">{(user.name || '?')[0]?.toUpperCase()}</span>
        {titleCase(user.name)} <span className="text-slate-500">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-52 bg-white rounded-xl shadow-xl border border-slate-100 py-1 z-50">
          {item('My Profile', () => onNavigate('profile'))}
          {item('Email Template', () => onNavigate('templates'))}
          {item('Email Signature', () => onNavigate('signature'))}
          <div className="border-t border-slate-100 my-1" />
          <button onClick={() => { setOpen(false); onLogout(); }} className="w-full text-left px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50">Logout</button>
        </div>
      )}
    </div>
  );
}

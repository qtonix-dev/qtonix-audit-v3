import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { API_BASE } from './config.js';
import { AddUserModal, ImageKitSection, ProfilePage, EmployeeDirectory, Field as SharedField, Avatar, ROLE_LABELS, ROLE_OPTIONS, ROLE_LEVEL, Icon, titleCase } from './HrParts.jsx';
import { Pagination, MailEditor } from './Leads.jsx';
import HrJobBuilder from './HrJobBuilder.jsx';
import { AppSwitcher } from './AppSwitcher.jsx';
import AllEmailPage from './AllEmailPage.jsx';
import HrCandidateView from './HrCandidateView.jsx';
import HrSurveyAdmin, { HrSurveyGate } from './HrSurvey.jsx';

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
          <a href="/" className="text-xs font-bold text-slate-400 hover:text-[#FF6A00] transition">← Site Analysis Portal</a>
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

// Rotating birthday / work-anniversary banner (mirrors the CRM CelebrationSlider).
function HrCelebrations({ celebrations, user }) {
  const [idx, setIdx] = useState(0);
  const slides = celebrations || [];
  useEffect(() => { if (slides.length <= 1) return; const t = setInterval(() => setIdx((n) => (n + 1) % slides.length), 10000); return () => clearInterval(t); }, [slides.length]);
  useEffect(() => { if (idx >= slides.length) setIdx(0); }, [slides.length, idx]);
  if (slides.length === 0) return null;
  const c = slides[Math.min(idx, slides.length - 1)];
  const msg = c.type === 'birthday' ? '🎂 Happy Birthday' : c.type === 'work' ? `🏆 Happy ${c.yearsLabel ? `${c.yearsLabel} ` : ''}Work Anniversary` : '💍 Happy Anniversary';
  const sub = c.type === 'birthday' ? 'Wishing you a wonderful day!' : c.type === 'work' ? `Thank you for ${c.years ? `${c.years} year${c.years === 1 ? '' : 's'} of ` : ''}being with us!` : 'Congratulations on your special day!';
  return (
    <div className="relative">
      <div className="rounded-2xl overflow-hidden shadow-sm border border-pink-200">
        <div className="px-5 py-4 flex items-center gap-4" style={{ background: 'linear-gradient(90deg,#FDF2F8,#FFF7ED)' }}>
          <div className="text-4xl animate-bounce" style={{ animationDuration: '1.5s' }}>{c.type === 'birthday' ? '🎂' : c.type === 'work' ? '🏆' : '💍'}</div>
          <Avatar name={c.name} src={c.avatar} size={56} />
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-extrabold text-[#050A1F]">{msg}, {(c.name || '').split(' ')[0]}!</div>
            <div className="text-[11px] text-pink-600 font-semibold">{c.name} · {sub}</div>
          </div>
        </div>
      </div>
      {slides.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 mt-2">
          {slides.map((s, i) => <button key={`${s.id}-${s.type}-${i}`} onClick={() => setIdx(i)} className={`h-1.5 rounded-full transition-all ${i === idx ? 'w-5 bg-[#FF6A00]' : 'w-1.5 bg-slate-300 hover:bg-slate-400'}`} />)}
        </div>
      )}
    </div>
  );
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

function TAvatar({ person, size = 24 }) {
  if (!person) return <div className="rounded-full bg-slate-200" style={{ width: size, height: size }} />;
  const initials = (person.name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return person.avatar
    ? <img src={person.avatar} alt={person.name} className="rounded-full object-cover" style={{ width: size, height: size }} />
    : <div className="rounded-full bg-orange-100 text-orange-600 flex items-center justify-center font-bold" style={{ width: size, height: size, fontSize: size * 0.4 }}>{initials}</div>;
}

// Searchable assignee picker (scoped by backend to who the actor may assign to).
function AssigneePicker({ value, onChange, allowClear }) {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState([]);
  const [q, setQ] = useState('');
  useEffect(() => { if (open) hrApi(`/tasks/assignable?q=${encodeURIComponent(q)}`).then(setPeople).catch(() => setPeople([])); }, [open, q]);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50">
        {value ? <><TAvatar person={value} size={20} /><span className="font-semibold text-[#050A1F]">{value.name}</span></> : <span className="text-slate-400">Assign…</span>}
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-64 bg-white rounded-xl shadow-xl border border-slate-200 p-2">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…" className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs mb-1 focus:outline-none focus:ring-2 focus:ring-orange-300" />
          <div className="max-h-56 overflow-auto">
            {allowClear && <button onClick={() => { onChange(null); setOpen(false); }} className="w-full text-left px-2 py-1.5 text-xs text-slate-400 hover:bg-slate-50 rounded-lg">Unassigned</button>}
            {people.map((p) => (
              <button key={p.id} onClick={() => { onChange(p); setOpen(false); setQ(''); }} className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded-lg text-left">
                <TAvatar person={p} size={24} />
                <div className="min-w-0"><div className="text-xs font-semibold text-[#050A1F] truncate">{p.name}</div><div className="text-[10px] text-slate-400 truncate">{p.designation || p.department}</div></div>
              </button>
            ))}
            {people.length === 0 && <div className="text-xs text-slate-400 px-2 py-3 text-center">No people found.</div>}
          </div>
        </div>
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

function HrTasksView({ user, isAdmin }) {
  const [board, setBoard] = useState(null);
  const [pickPeople, setPickPeople] = useState(null);
  const [viewerId, setViewerId] = useState(null);
  const [view, setView] = useState('list'); // list | board
  const [err, setErr] = useState('');
  const [openTask, setOpenTask] = useState(null);
  const [addingIn, setAddingIn] = useState(null);   // bucket key being added to
  const [newTitle, setNewTitle] = useState('');
  const [dragId, setDragId] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [collapsed, setCollapsed] = useState({});
  const [filter, setFilter] = useState('all');      // all | mine | overdue | high
  const [sort, setSort] = useState('manual');       // manual | due | priority

  const loadBoard = (id) => hrApi(`/tasks/board/${id}`).then((d) => { setBoard(d); setViewerId(id); setPickPeople(null); }).catch((e) => setErr(e.message));
  useEffect(() => {
    hrApi('/tasks/my-board').then((d) => {
      if (d.adminNoBoard) setPickPeople(d.people);
      else { setBoard(d); setViewerId(d.viewer.id); }
    }).catch((e) => setErr(e.message));
  }, []);
  const refresh = () => { if (viewerId) loadBoard(viewerId); };

  const addTask = async (bucket) => {
    if (!newTitle.trim() || !viewerId) return;
    try { await hrApi('/tasks/tasks', { method: 'POST', body: JSON.stringify({ title: newTitle.trim(), assigneeId: viewerId, bucket }) }); setNewTitle(''); setAddingIn(null); refresh(); } catch (e) { setErr(e.message); }
  };
  const patchTask = async (id, patch) => { try { await hrApi(`/tasks/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }); refresh(); } catch (e) { setErr(e.message); } };
  const moveToBucket = async (id, bucket) => { setDragId(null); setDragOver(null); await patchTask(id, { bucket }); };

  if (err) return <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">{err}</div>;

  if (pickPeople) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-extrabold text-[#050A1F] mb-1">Task boards</h1>
        <p className="text-xs text-slate-400 mb-4">Pick whose board to open. Assign tasks to anyone from their board; you’ll track what you assign right here.</p>
        <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
          {pickPeople.map((p) => (
            <button key={p.id} onClick={() => loadBoard(p.id)} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 text-left">
              <TAvatar person={p} size={32} />
              <div className="flex-1"><div className="text-sm font-semibold text-[#050A1F]">{p.name}</div><div className="text-[11px] text-slate-400">{p.designation || p.department}</div></div>
              <span className="text-slate-300">›</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (!board) return <div className="text-slate-400 text-sm py-10 text-center">Loading board…</div>;

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

  const TaskRow = ({ t, tracking }) => (
    <div
      draggable={!tracking}
      onDragStart={() => setDragId(t._id)}
      onDragEnd={() => { setDragId(null); setDragOver(null); }}
      onClick={() => setOpenTask(t)}
      className={`group flex items-center gap-3 px-4 py-2 border-b border-slate-100 last:border-0 cursor-pointer hover:bg-slate-50 ${dragId === t._id ? 'opacity-40' : ''}`}
    >
      {!tracking && <span className="text-slate-300 group-hover:text-slate-400 cursor-grab select-none shrink-0" title="Drag to a section">⠿</span>}
      <button onClick={(e) => { e.stopPropagation(); patchTask(t._id, { stage: t.stage === 'completed' ? 'not_started' : 'completed' }); }} className={`w-4 h-4 rounded-full border-2 shrink-0 ${t.stage === 'completed' ? 'bg-green-500 border-green-500' : 'border-slate-300 hover:border-green-400'}`} />
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-semibold truncate ${t.stage === 'completed' ? 'text-slate-400 line-through' : 'text-[#050A1F]'}`}>{t.title}</div>
        <div className="flex items-center gap-2">
          {t.subtaskCount > 0 && <span className="text-[10px] text-slate-400">▸ {t.subtaskDone}/{t.subtaskCount}</span>}
          {tracking && t.assignee && <span className="text-[10px] text-purple-500 font-semibold">tracking · {t.assignee.name}</span>}
          {!tracking && t.assigner && t.assigner.name && t.relation === 'mine' && t.assignedById && <span className="text-[10px] text-blue-500">by {t.assigner.name}</span>}
        </div>
      </div>
      <div className="shrink-0"><TAvatar person={t.assignee} size={22} /></div>
      <div className={`shrink-0 w-16 text-[11px] text-right ${isOverdue(t) ? 'text-red-500 font-bold' : 'text-slate-500'}`}>{t.dueDate ? new Date(String(t.dueDate).slice(0, 10) + 'T00:00:00+05:30').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}</div>
      <div className="shrink-0 hidden sm:block"><Pill map={PRIO} value={t.priority} /></div>
      <div className="shrink-0"><Pill map={STAGE} value={t.stage} /></div>
    </div>
  );

  const bucketByKey = Object.fromEntries((board.buckets || []).map((b) => [b.key, b]));

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <TAvatar person={board.viewer} size={36} />
          <div>
            <h1 className="text-xl font-extrabold text-[#050A1F]">{board.viewer.name}’s tasks</h1>
            {isAdmin && <button onClick={() => hrApi('/tasks/my-board').then((d) => d.adminNoBoard && setPickPeople(d.people))} className="text-[11px] text-orange-500 font-semibold">Switch board</button>}
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
            return (
              <div key={key}
                onDragOver={(e) => { if (dragId) { e.preventDefault(); setDragOver(key); } }}
                onDragLeave={() => setDragOver((d) => d === key ? null : d)}
                onDrop={(e) => { e.preventDefault(); if (dragId) moveToBucket(dragId, key); }}
                className={`rounded-xl border bg-white transition ${dragOver === key ? 'border-orange-400 ring-2 ring-orange-200' : 'border-slate-200'}`}
              >
                <button onClick={() => setCollapsed((c) => ({ ...c, [key]: !c[key] }))} className="w-full flex items-center gap-2 px-4 py-2.5 text-left">
                  <span className={`text-slate-400 text-xs transition-transform ${isOpen ? 'rotate-90' : ''}`}>▸</span>
                  <span className="text-sm font-extrabold text-[#050A1F]">{label}</span>
                  <span className="text-xs text-slate-400 font-normal">· {bk.tasks.length}</span>
                  {key === 'recently_assigned' && bk.tasks.length > 0 && <span className="text-[10px] text-orange-500 font-bold ml-1">NEW</span>}
                </button>
                {isOpen && (
                  <div>
                    {rows.map((t) => <TaskRow key={t._id} t={t} />)}
                    {addingIn === key
                      ? <div className="flex items-center gap-2 px-4 py-2 border-t border-slate-100"><input autoFocus value={newTitle} onChange={(e) => setNewTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTask(key)} onBlur={() => { if (!newTitle.trim()) setAddingIn(null); }} placeholder="Task name…" className="flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300" /><button onClick={() => addTask(key)} className="text-xs font-bold text-white rounded-lg px-3 py-1.5" style={{ background: ORANGE }}>Add</button></div>
                      : <button onClick={() => { setAddingIn(key); setNewTitle(''); }} className="w-full text-left px-4 py-2 text-xs text-slate-400 hover:text-slate-600 hover:bg-slate-50 border-t border-slate-100">+ Add task</button>}
                  </div>
                )}
              </div>
            );
          })}

          {(board.tracking || []).length > 0 && (
            <div className="rounded-xl border border-purple-200 bg-purple-50/40 mt-6">
              <div className="px-4 py-2.5 flex items-center gap-2"><span className="text-sm font-extrabold text-purple-700">Assigned by me</span><span className="text-xs text-purple-400">· {board.tracking.length} · live status</span></div>
              <div className="bg-white rounded-b-xl">{prep(board.tracking).map((t) => <TaskRow key={t._id} t={t} tracking />)}</div>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {['not_started', 'in_progress', 'completed'].map((st) => {
            const all = [...(board.buckets || []).flatMap((b) => b.tasks), ...(board.tracking || [])];
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
function TaskDetailDrawer({ taskId, onClose, onChange }) {
  const [data, setData] = useState(null);
  const [note, setNote] = useState('');
  const [newSub, setNewSub] = useState('');
  const load = () => hrApi(`/tasks/tasks/${taskId}/detail`).then(setData).catch(() => {});
  useEffect(() => { load(); }, [taskId]);
  const patch = async (p) => { await hrApi(`/tasks/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(p) }); load(); onChange && onChange(); };
  const addNote = async () => { if (!note.trim()) return; await hrApi(`/tasks/tasks/${taskId}/comments`, { method: 'POST', body: JSON.stringify({ body: note.trim() }) }); setNote(''); load(); };
  const addSub = async () => { if (!newSub.trim()) return; await hrApi('/tasks/tasks', { method: 'POST', body: JSON.stringify({ title: newSub.trim(), parentTaskId: taskId, assigneeId: data && data.task && data.task.assignee ? data.task.assignee.id : undefined }) }); setNewSub(''); load(); onChange && onChange(); };
  const toggleSub = async (s) => { await hrApi(`/tasks/tasks/${s._id}`, { method: 'PATCH', body: JSON.stringify({ stage: s.stage === 'completed' ? 'not_started' : 'completed' }) }); load(); };

  if (!data) return null;
  const t = data.task;
  return (
    <div className="fixed inset-0 z-[120] flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative bg-white w-full max-w-lg h-full shadow-2xl overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-3 flex items-center justify-between">
          <button onClick={() => patch({ stage: t.stage === 'completed' ? 'not_started' : 'completed' })} className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-bold ${t.stage === 'completed' ? 'bg-green-50 border-green-200 text-green-700' : 'border-slate-200 text-slate-600'}`}>✓ {t.stage === 'completed' ? 'Completed' : 'Mark complete'}</button>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-400">✕</button>
        </div>
        <div className="p-5">
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
            <textarea defaultValue={t.description} onBlur={(e) => e.target.value !== t.description && patch({ description: e.target.value })} rows={3} placeholder="Add details…" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300" />
          </div>

          {!t.parentTaskId && (
            <div className="mb-5">
              <div className="text-xs font-bold text-slate-500 mb-1">Subtasks</div>
              <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
                {data.subtasks.map((s) => (
                  <div key={s._id} className="flex items-center gap-2 px-3 py-2">
                    <button onClick={() => toggleSub(s)} className={`w-4 h-4 rounded-full border-2 shrink-0 ${s.stage === 'completed' ? 'bg-green-500 border-green-500' : 'border-slate-300'}`} />
                    <span className={`text-sm flex-1 ${s.stage === 'completed' ? 'text-slate-400 line-through' : 'text-[#050A1F]'}`}>{s.title}</span>
                    <TAvatar person={s.assignee} size={20} />
                  </div>
                ))}
                <div className="flex items-center gap-2 px-3 py-2"><input value={newSub} onChange={(e) => setNewSub(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSub()} placeholder="+ Add subtask" className="flex-1 text-sm focus:outline-none" /></div>
              </div>
            </div>
          )}

          {data.attachments.length > 0 && (
            <div className="mb-5"><div className="text-xs font-bold text-slate-500 mb-1">Attachments</div>{data.attachments.map((a) => <a key={a._id} href={a.url} target="_blank" rel="noreferrer" className="block text-xs text-blue-500 hover:underline truncate">📎 {a.name || a.url}</a>)}</div>
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
    </div>
  );
}
function TField({ label, children }) { return <div className="flex items-center gap-3"><div className="text-xs font-bold text-slate-500 w-20 shrink-0">{label}</div>{children}</div>; }

function HrDailyConsole({ user, isAdmin }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [notes, setNotes] = useState({});
  const [newTask, setNewTask] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [flash, setFlash] = useState('');

  const load = () => hrApi('/daily/console').then((d) => { setData(d); setNotes((n) => (d.report && d.report.notes) ? d.report.notes : n); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const toggleTask = async (t) => {
    const status = t.status === 'done' ? 'open' : 'done';
    setData((d) => ({ ...d, tasks: d.tasks.map((x) => x._id === t._id ? { ...x, status } : x) }));
    try { await hrApi(`/daily/tasks/${t._id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); } catch { load(); }
  };
  const addTask = async () => {
    const title = newTask.trim(); if (!title) return;
    setNewTask('');
    try { await hrApi('/daily/tasks', { method: 'POST', body: JSON.stringify({ title }) }); load(); } catch (e) { setErr(e.message); }
  };
  const delTask = async (t) => {
    try { await hrApi(`/daily/tasks/${t._id}`, { method: 'DELETE' }); load(); } catch (e) { setErr(e.message); }
  };
  const submit = async () => {
    setSubmitting(true); setFlash('');
    try {
      const r = await hrApi('/daily/report/submit', { method: 'POST', body: JSON.stringify({ notes }) });
      setFlash(r.emailed ? 'Report submitted and emailed to admin ✓' : 'Report submitted ✓ (email skipped — recruitment mailbox not linked)');
      load();
    } catch (e) { setErr(e.message); } finally { setSubmitting(false); }
  };

  if (err) return <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">{err}</div>;
  if (data && data.empty) return <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">{data.note}</div>;
  if (!data) return <div className="text-slate-400 text-sm py-10 text-center">Loading your daily console…</div>;

  const s = data.snapshot || {};
  const w = s.workforce || {}; const r = s.recruitment || {}; const con = s.contribution || {};
  const checklistTasks = (data.tasks || []).filter((t) => t.source === 'checklist');
  const adhocTasks = (data.tasks || []).filter((t) => t.source !== 'checklist');
  const doneChecklist = checklistTasks.filter((t) => t.status === 'done').length;

  const Stat = ({ label, value, tone }) => (
    <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-3">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-2xl font-extrabold mt-0.5 ${tone || 'text-[#050A1F]'}`}>{value}</div>
    </div>
  );
  const Section = ({ title, right, children }) => (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-extrabold text-[#050A1F]">{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
  const NoteBox = ({ k, label, placeholder }) => (
    <div>
      <div className="text-xs font-bold text-slate-500 mb-1">{label}</div>
      <textarea value={notes[k] || ''} onChange={(e) => setNotes({ ...notes, [k]: e.target.value })} placeholder={placeholder} rows={2}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 resize-y" />
    </div>
  );
  const miniTable = (rows, cols, empty) => rows && rows.length ? (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead><tr className="bg-slate-50 border-b border-slate-200 text-left">{cols.map((c) => <th key={c.h} className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">{c.h}</th>)}</tr></thead>
        <tbody>{rows.map((it, i) => <tr key={i} className="border-b border-slate-100 last:border-0">{cols.map((c) => <td key={c.h} className="px-3 py-2 text-slate-700">{c.get(it)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  ) : <div className="text-xs text-slate-400 py-2">{empty}</div>;

  const fmtD = (ymd) => { if (!ymd) return '—'; try { return new Date(ymd + 'T00:00:00+05:30').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); } catch { return ymd; } };

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <h1 className="text-2xl font-extrabold text-[#050A1F]">Daily Console</h1>
        <div className="text-sm text-slate-500">{data.owner.name} · {data.owner.branch} · {data.dateLabel}</div>
      </div>
      <p className="text-xs text-slate-400 mb-5">Everything below the checklist is collected automatically from the HRMS. Review it, tick your checklist, add notes, then submit your end-of-day report.</p>

      {flash && <div className="mb-4 rounded-lg bg-green-50 border border-green-200 px-3 py-2.5 text-sm text-green-700 font-semibold">{flash}</div>}
      {data.submitted && !flash && <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2.5 text-sm text-blue-700">Today’s report was already submitted. Re-submitting will update it.</div>}

      {/* AUTO — Workforce */}
      <Section title="Workforce (auto)">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          <Stat label="Total" value={w.total || 0} />
          <Stat label="Present" value={w.present || 0} tone="text-green-600" />
          <Stat label="Absent" value={w.absent || 0} tone="text-red-500" />
          <Stat label="On leave" value={w.onLeave || 0} />
          <Stat label="Late" value={w.late || 0} tone="text-amber-500" />
          <Stat label="Half day" value={w.halfDay || 0} />
          <Stat label="Not marked" value={w.notMarked || 0} tone="text-slate-400" />
        </div>
      </Section>

      {/* AUTO — Leave requests */}
      <Section title="Pending leave requests (auto)">
        {miniTable(s.leaveRequests, [
          { h: 'Employee', get: (x) => x.employee }, { h: 'Type', get: (x) => x.type },
          { h: 'Date', get: (x) => fmtD(x.date) }, { h: 'Reason', get: (x) => x.reason || '—' },
        ], 'No pending leave requests.')}
      </Section>

      {/* AUTO — Recruitment */}
      <Section title="Recruitment (auto)">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-2">
          <Stat label="Open roles" value={r.openJobs || 0} />
          <Stat label="Shortlisted" value={r.shortlisted || 0} />
          <Stat label="Offers out" value={r.offersReleased || 0} />
          <Stat label="Accepted" value={r.offersAccepted || 0} tone="text-green-600" />
          <Stat label="Interviews today" value={r.interviewsScheduledToday || 0} />
          <Stat label="…done" value={r.interviewsDoneToday || 0} />
        </div>
        {(r.upcomingJoinings || []).length > 0 && (
          <div className="text-xs text-slate-500">Upcoming joinings: {r.upcomingJoinings.map((j) => `${j.name} (${fmtD(j.joiningDate)})`).join(' · ')}</div>
        )}
      </Section>

      {/* AUTO — HR Manager contribution */}
      <Section title="Your recruitment contribution today (auto)">
        <div className="grid grid-cols-3 gap-2 max-w-md">
          <Stat label="Interviews taken" value={con.interviewsTaken || 0} />
          <Stat label="Candidates added" value={con.candidatesAdded || 0} />
          <Stat label="Offers closed" value={con.offersClosed || 0} />
        </div>
      </Section>

      {/* AUTO — People to watch */}
      <div className="grid md:grid-cols-3 gap-4 mb-6">
        <div>
          <div className="text-sm font-extrabold text-[#050A1F] mb-2">New joiners (auto)</div>
          {miniTable(s.newJoiners, [
            { h: 'Name', get: (x) => x.name }, { h: 'Joined', get: (x) => fmtD(x.joiningDate) },
            { h: 'Onboard', get: (x) => x.onboarding },
          ], 'None this month.')}
        </div>
        <div>
          <div className="text-sm font-extrabold text-[#050A1F] mb-2">Probation ending (auto)</div>
          {miniTable(s.probation, [
            { h: 'Name', get: (x) => x.name }, { h: 'Ends', get: (x) => fmtD(x.endDate) },
            { h: 'Left', get: (x) => x.daysLeft < 0 ? <span className="text-red-500 font-bold">{-x.daysLeft}d over</span> : `${x.daysLeft}d` },
          ], 'None ending soon.')}
        </div>
        <div>
          <div className="text-sm font-extrabold text-[#050A1F] mb-2">Notice period (auto)</div>
          {miniTable(s.notice, [
            { h: 'Name', get: (x) => x.name }, { h: 'Last day', get: (x) => fmtD(x.lastWorkingDay) },
            { h: 'Left', get: (x) => x.daysLeft == null ? '—' : `${x.daysLeft}d` },
          ], 'None on notice.')}
        </div>
      </div>

      {/* Daily checklist */}
      <Section title={`Daily checklist (${doneChecklist}/${checklistTasks.length})`}>
        {checklistTasks.length === 0
          ? <div className="text-xs text-slate-400">No checklist configured. An admin can set it up in Admin → Daily checklist.</div>
          : (
            <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
              {checklistTasks.map((t) => (
                <label key={t._id} className="flex items-start gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-50">
                  <input type="checkbox" checked={t.status === 'done'} onChange={() => toggleTask(t)} className="mt-0.5 w-4 h-4 accent-green-500" />
                  <div className="min-w-0">
                    <div className={`text-sm font-semibold ${t.status === 'done' ? 'text-slate-400 line-through' : 'text-[#050A1F]'}`}>{t.title}</div>
                    {t.details && <div className="text-[11px] text-slate-400">{t.details}</div>}
                  </div>
                </label>
              ))}
            </div>
          )}
      </Section>

      {/* Tasks */}
      <Section title="Tasks">
        <div className="flex items-stretch gap-2 mb-2">
          <input value={newTask} onChange={(e) => setNewTask(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTask()} placeholder="Add a task for today…" className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300" />
          <button onClick={addTask} className="shrink-0 rounded-lg px-4 text-sm font-bold text-white whitespace-nowrap" style={{ background: ORANGE }}>+ Add</button>
        </div>
        {adhocTasks.length === 0
          ? <div className="text-xs text-slate-400">No tasks yet. Add one above — or an admin can assign you one.</div>
          : (
            <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
              {adhocTasks.map((t) => (
                <div key={t._id} className="flex items-start gap-3 px-4 py-2.5 hover:bg-slate-50">
                  <input type="checkbox" checked={t.status === 'done'} onChange={() => toggleTask(t)} className="mt-0.5 w-4 h-4 accent-green-500" />
                  <div className="min-w-0 flex-1">
                    <div className={`text-sm font-semibold ${t.status === 'done' ? 'text-slate-400 line-through' : 'text-[#050A1F]'}`}>{t.title}</div>
                    {t.source === 'assigned' && <div className="text-[11px] text-blue-500 font-semibold">Assigned by {t.assignedByName || 'admin'}</div>}
                    {t.details && <div className="text-[11px] text-slate-400">{t.details}</div>}
                  </div>
                  {t.priority === 'high' && <span className="text-[10px] font-bold text-red-500 shrink-0">HIGH</span>}
                  {t.source !== 'assigned' && <button onClick={() => delTask(t)} className="shrink-0 text-slate-300 hover:text-red-500 text-sm" title="Delete">✕</button>}
                </div>
              ))}
            </div>
          )}
      </Section>

      {/* Manual notes */}
      <Section title="Notes (manual — judgment items)">
        <div className="grid md:grid-cols-2 gap-3">
          <NoteBox k="grievances" label="Employee issues / grievances" placeholder="Concerns raised, actions taken…" />
          <NoteBox k="managerCoordination" label="Manager coordination" placeholder="Hiring needs, performance, conflicts…" />
          <NoteBox k="probationNotes" label="Probation feedback" placeholder="Confirmation / extension recommendations…" />
          <NoteBox k="noticeNotes" label="Notice-period / handover" placeholder="Handover status, replacement…" />
          <NoteBox k="directorDecisions" label="Decisions required from Director" placeholder="What needs a management call…" />
          <NoteBox k="tomorrowPriorities" label="Tomorrow’s top priorities" placeholder="Top 3 for tomorrow…" />
        </div>
      </Section>

      {/* Submit */}
      <div className="sticky bottom-0 bg-slate-50 pt-3 pb-1 -mx-4 px-4 border-t border-slate-200 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-slate-500">Submitting compiles the auto data + checklist + tasks + notes into a report and emails it to admin.</div>
        <button onClick={submit} disabled={submitting} className="shrink-0 rounded-lg px-5 py-2.5 text-sm font-bold text-white whitespace-nowrap disabled:opacity-50" style={{ background: ORANGE }}>
          {submitting ? 'Submitting…' : data.submitted ? 'Re-submit report' : 'Submit end-of-day report'}
        </button>
      </div>
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
  const [celebrations, setCelebrations] = useState([]);
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
    hrApi('/celebrations').then((r) => setCelebrations(r.items || [])).catch(() => {});
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
    ['Open positions', stats ? stats.openJobs : m.openJobs, '#2563EB', 'M20 7h-4V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z', { tab: 'jobs', jobScope: 'mine' }],
    ['Active candidates', stats ? stats.totalActive : m.candidates, '#FF6A00', 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', { tab: 'candidates', candScope: 'all' }],
    ['Applications this week', stats ? stats.applicationsThisWeek : '—', '#8b5cf6', 'M22 11.08V12a10 10 0 1 1-5.93-9.14 M22 4L12 14.01l-3-3', { tab: 'candidates', candScope: 'all', weekOnly: true }],
    ['Avg time-to-hire', stats && stats.avgTimeToHire != null ? `${stats.avgTimeToHire}d` : '—', '#16A34A', 'M12 8v4l3 3 M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', null],
  ];
  const softTint = (hex) => `${hex}0F`;
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold text-[#050A1F]">{greeting()}, {user.name}!</h1>
          <p className="text-slate-500 text-sm mt-1">Here's your recruitment overview.</p>
        </div>
        {annCanPost && <button onClick={() => setShowAnnModal(true)} className="rounded-lg px-3 py-2 text-xs font-bold text-white inline-flex items-center gap-1.5" style={{ background: '#050A1F' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 11l18-5v12L3 14v-3zM11.6 16.8a3 3 0 1 1-5.8-1.6" /></svg> Post announcement
        </button>}
      </div>

      {/* Celebrations — birthdays & work anniversaries (CRM-style slider) */}
      <HrCelebrations celebrations={celebrations} user={user} />

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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
                        <span className="font-bold text-slate-600">{r.name}</span>
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

function HrRecruitment({ isAdmin, me, intent }) {
  const rNav = useNavigate();
  const rLoc = useLocation();
  const RTABS = ['jobs', 'candidates', 'pipeline'];
  const urlTab = (() => { const seg = (rLoc.pathname.split('/')[3] || '').toLowerCase(); return RTABS.includes(seg) ? seg : null; })();
  const [tab, setTabRaw] = useState(urlTab || (intent && intent.tab ? intent.tab : 'jobs'));
  const setTab = (t) => { setTabRaw(t); const target = `/hr/recruitment/${t}`; if (rLoc.pathname !== target) rNav(target); };
  useEffect(() => { if (urlTab && urlTab !== tab) setTabRaw(urlTab); }, [urlTab]);
  // Ensure the URL reflects the initial tab (e.g. arriving via an intent).
  useEffect(() => { if (!urlTab) { const target = `/hr/recruitment/${tab}`; if (rLoc.pathname !== target) rNav(target, { replace: true }); } }, []);
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
  const tabs = [['jobs', 'Job Post'], ['candidates', 'Candidate List'], ['pipeline', 'Pipeline']];

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
  const origin = window.location.origin;
  const listingUrl = `${origin}/careers/${job.publicToken}`;
  const embedUrl = `${origin}/careers/${job.publicToken}/embed`;
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
  const [hrList, setHrList] = useState([]); // HR-department staff for the HR filter
  useEffect(() => { hrApi('/employees?hrDept=1').then((r) => setHrList(r || [])).catch(() => {}); }, []);
  const [weekFilter, setWeekFilter] = useState(!!weekOnly); // only applications added this week
  const curView = listMode || 'active';
  const isHiredView = listMode === 'hired';
  const isRejectedView = listMode === 'rejected';
  const myId = me && (me._id || me.id);
  const mineOnly = (scope || (isAdmin ? 'all' : 'mine')) === 'mine';
  const isMineCand = (c) => myId && (Number(c.recruiterId) === Number(myId) || (me && me.name && c.recruiterName === me.name));
  const isThisWeek = (c) => { if (!c.createdAt) return false; const d = new Date(c.createdAt); const now = new Date(); const start = new Date(now); const day = (now.getDay() + 6) % 7; start.setDate(now.getDate() - day); start.setHours(0, 0, 0, 0); return d >= start; };
  const isThisMonth = (c) => { const iso = c.rejectedAt || c.updatedAt || c.createdAt; if (!iso) return false; const d = new Date(iso); const now = new Date(); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth(); };
  // Keyword search runs server-side; the view decides which server list to pull.
  const load = (kw) => {
    const params = new URLSearchParams();
    if (kw && kw.trim()) params.set('q', kw.trim());
    if (isHiredView) params.set('hired', 'only');
    if (isRejectedView) params.set('rejected', 'only');
    const qs = params.toString() ? `?${params.toString()}` : '';
    return hrApi(`/candidates${qs}`).then(setCands).catch(() => {});
  };
  useEffect(() => { load(); }, [curView]);
  useEffect(() => { const t = setTimeout(() => load(q), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { if (initialJobFilter) setJobFilter(initialJobFilter); }, [initialJobFilter]);
  useEffect(() => { setSourceFilter(initialSource || ''); }, [initialSource]);
  const job = (id) => jobs.find((j) => j._id === id) || {};
  const stageLabel = (c) => {
    if (c.rejected) return { label: 'Rejected', color: '#DC2626' };
    const st = ((job(c.jobPostId).stages) || []).find((s) => s.id === c.stage);
    return { label: st ? st.label : c.stage, color: st ? st.color : '#64748B' };
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
                            ? <CandIconBtn icon="edit" label="Manage hire (salary, joining, joined status)" onClick={() => setManageHireFor(c)} />
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
  const [joiningDate, setJoiningDate] = useState(o.joiningDate ? String(o.joiningDate).slice(0, 10) : '');
  const [joined, setJoined] = useState(o.notJoined ? 'no' : 'yes');
  const [reason, setReason] = useState(o.notJoinedReason || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    setBusy(true); setErr('');
    try {
      await hrApi(`/candidates/${candidate._id}/offer`, { method: 'POST', body: JSON.stringify({
        op: 'manage_hire',
        acceptedAmount: salary.trim(),
        joiningDate: joiningDate || '',
        notJoined: joined === 'no',
        notJoinedReason: joined === 'no' ? reason.trim() : '',
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
          <div><div className="text-[12px] font-bold text-slate-600 mb-1">Joining date</div><input type="date" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} /></div>
          <div>
            <div className="text-[12px] font-bold text-slate-600 mb-1">Joining status</div>
            <div className="flex gap-2">
              <button onClick={() => setJoined('yes')} className={`flex-1 rounded-lg border px-3 py-2 text-sm font-bold ${joined === 'yes' ? 'border-green-400 bg-green-50 text-green-700' : 'border-slate-200 text-slate-500'}`}>✓ Joined</button>
              <button onClick={() => setJoined('no')} className={`flex-1 rounded-lg border px-3 py-2 text-sm font-bold ${joined === 'no' ? 'border-red-400 bg-red-50 text-red-600' : 'border-slate-200 text-slate-500'}`}>✗ Didn't join</button>
            </div>
          </div>
          {joined === 'no' && <div><div className="text-[12px] font-bold text-slate-600 mb-1">Reason (optional)</div><textarea rows={2} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. accepted another offer, no-show…" /></div>}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : 'Save'}</button>
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
              <div key={iv.interviewId} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50/60">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-700">{iv.candidateName} <span className="text-xs font-normal text-slate-400">· {iv.jobTitle}</span></div>
                  <div className="text-xs text-slate-400">{iv.roundLabel || 'Interview'} · {new Date(iv.at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}{iv.panelists.length ? ` · ${iv.panelists.length} panelist${iv.panelists.length === 1 ? '' : 's'}` : ''}</div>
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
function MyProfilePage({ user, onUpdated }) {
  const [p, setP] = useState(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const avatarRef = useRef(null);
  const load = () => hrApi('/profile-me').then(setP).catch(() => {});
  useEffect(() => { load(); }, []);
  const set = (patch) => setP((s) => ({ ...s, ...patch }));
  if (!p) return <div className="text-slate-400 text-sm">Loading…</div>;
  if (p.isAdmin) return <div className="max-w-2xl"><h1 className="text-2xl font-extrabold text-[#050A1F] mb-2">My Profile</h1><div className="bg-white rounded-2xl border border-slate-200/70 p-8 text-center text-slate-400 text-sm">Admins manage their profile in the Sales CRM.</div></div>;

  const uploadAvatar = async (file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert('Image too large (max 5MB).'); return; }
    try { const base64 = await fileToBase64(file); const r = await hrApi('/profile-me/avatar', { method: 'POST', body: JSON.stringify({ base64, fileName: file.name }) }); set({ avatar: r.url }); onUpdated && onUpdated(); } catch (e) { alert(e.message); }
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
            <button onClick={() => avatarRef.current?.click()} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">Upload photo</button>
            <input ref={avatarRef} type="file" accept="image/*" className="hidden" onChange={(e) => uploadAvatar(e.target.files?.[0])} />
          </div>
        </div>

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
function HrChecklistAdmin() {
  const [items, setItems] = useState(null);
  const [label, setLabel] = useState('');
  const [desc, setDesc] = useState('');
  const [err, setErr] = useState('');
  const load = () => hrApi('/daily/checklist').then(setItems).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const add = async () => {
    if (!label.trim()) return;
    try { await hrApi('/daily/checklist', { method: 'POST', body: JSON.stringify({ label: label.trim(), description: desc.trim() }) }); setLabel(''); setDesc(''); load(); }
    catch (e) { setErr(e.message); }
  };
  const toggle = async (it) => { try { await hrApi(`/daily/checklist/${it._id}`, { method: 'PATCH', body: JSON.stringify({ active: !it.active }) }); load(); } catch (e) { setErr(e.message); } };
  const del = async (it) => { if (!confirm('Delete this checklist item?')) return; try { await hrApi(`/daily/checklist/${it._id}`, { method: 'DELETE' }); load(); } catch (e) { setErr(e.message); } };
  const seed = async () => { try { const r = await hrApi('/daily/checklist/seed-defaults', { method: 'POST' }); load(); if (!r.seeded) setErr('Checklist already has items — nothing seeded.'); } catch (e) { setErr(e.message); } };

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div>
          <h3 className="font-bold text-sm text-[#050A1F]">HR Manager daily checklist</h3>
          <p className="text-xs text-slate-500">These items auto-appear on the HR Manager’s Daily Console every working day.</p>
        </div>
        {items && items.length === 0 && <button onClick={seed} className="rounded-lg px-3 py-2 text-xs font-bold text-white whitespace-nowrap" style={{ background: ORANGE }}>Seed default Top 10</button>}
      </div>
      {err && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{err}</div>}

      <div className="rounded-xl border border-slate-200 bg-white p-4 mb-4">
        <div className="grid gap-2">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Checklist item (e.g. Floor visit)" className={inputCls} />
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Short description (optional)" className={inputCls} />
          <div><button onClick={add} className="rounded-lg px-4 py-2 text-sm font-bold text-white whitespace-nowrap" style={{ background: ORANGE }}>+ Add item</button></div>
        </div>
      </div>

      {!items ? <div className="text-slate-400 text-sm py-8 text-center">Loading…</div>
        : items.length === 0 ? <div className="text-slate-400 text-sm py-8 text-center">No checklist items yet.</div>
          : (
            <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
              {items.map((it) => (
                <div key={it._id} className="flex items-start gap-3 px-4 py-3">
                  <button onClick={() => toggle(it)} title={it.active ? 'Active' : 'Inactive'} className={`mt-0.5 w-9 h-5 rounded-full shrink-0 transition ${it.active ? 'bg-green-500' : 'bg-slate-300'}`}>
                    <span className={`block w-4 h-4 bg-white rounded-full transition ${it.active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className={`text-sm font-semibold ${it.active ? 'text-[#050A1F]' : 'text-slate-400'}`}>{it.label}</div>
                    {it.description && <div className="text-[11px] text-slate-400">{it.description}</div>}
                  </div>
                  <button onClick={() => del(it)} className="shrink-0 text-slate-300 hover:text-red-500 text-sm" title="Delete">✕</button>
                </div>
              ))}
            </div>
          )}
    </div>
  );
}

// HR Admin → Daily reports: submitted end-of-day reports from HR Managers.
function HrDailyReportsAdmin() {
  const [reports, setReports] = useState(null);
  const [open, setOpen] = useState(null);
  useEffect(() => { hrApi('/daily/reports').then(setReports).catch(() => setReports([])); }, []);
  const fmt = (d) => { if (!d) return '—'; try { return new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return '—'; } };
  const fmtDate = (ymd) => { try { return new Date(ymd + 'T00:00:00+05:30').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ymd; } };

  return (
    <div className="max-w-4xl">
      <h3 className="font-bold text-sm text-[#050A1F] mb-1">Daily HR reports</h3>
      <p className="text-xs text-slate-500 mb-4">End-of-day reports submitted by HR Managers. Also delivered to your inbox.</p>
      {!reports ? <div className="text-slate-400 text-sm py-8 text-center">Loading…</div>
        : reports.length === 0 ? <div className="text-slate-400 text-sm py-8 text-center">No reports submitted yet.</div>
          : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead><tr className="bg-slate-50 border-b border-slate-200 text-left">
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">Date</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">HR Manager</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">Checklist</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">Submitted</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400 text-right">View</th>
                </tr></thead>
                <tbody>
                  {reports.map((rp) => {
                    const done = (rp.checklist || []).filter((c) => c.done).length;
                    return (
                      <tr key={rp._id} className="border-b border-slate-100 last:border-0">
                        <td className="px-4 py-3 font-semibold text-[#050A1F] whitespace-nowrap">{fmtDate(rp.date)}</td>
                        <td className="px-4 py-3 text-slate-700">{rp.ownerName}</td>
                        <td className="px-4 py-3 text-slate-600">{done}/{(rp.checklist || []).length}</td>
                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmt(rp.submittedAt)}{rp.emailedAt ? ' · emailed' : ''}</td>
                        <td className="px-4 py-3 text-right"><button onClick={() => setOpen(rp)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">View</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      {open && <HrReportViewModal report={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function HrReportViewModal({ report, onClose }) {
  const s = report.snapshot || {}; const w = s.workforce || {}; const r = s.recruitment || {}; const con = s.contribution || {};
  const notes = report.notes || {};
  const fmtDate = (ymd) => { if (!ymd) return '—'; try { return new Date(ymd + 'T00:00:00+05:30').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); } catch { return ymd; } };
  const Row = ({ label, value }) => <div className="flex justify-between py-1 text-sm"><span className="text-slate-500">{label}</span><span className="font-bold text-[#050A1F]">{value}</span></div>;
  const noteBlocks = [['grievances', 'Grievances'], ['managerCoordination', 'Manager coordination'], ['probationNotes', 'Probation'], ['noticeNotes', 'Notice / handover'], ['directorDecisions', 'Decisions for Director'], ['tomorrowPriorities', 'Tomorrow’s priorities'], ['other', 'Other']].filter(([k]) => notes[k]);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[120] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col" style={{ maxHeight: '90vh' }} onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div><div className="text-sm font-extrabold text-[#050A1F]">{report.ownerName} — {fmtDate(report.date)}</div><div className="text-[11px] text-slate-400">HR daily report</div></div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400">✕</button>
        </div>
        <div className="flex-1 overflow-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="text-[11px] font-bold uppercase text-slate-400 mb-1">Workforce</div>
              <Row label="Total" value={w.total || 0} /><Row label="Present" value={w.present || 0} /><Row label="Absent" value={w.absent || 0} /><Row label="On leave" value={w.onLeave || 0} /><Row label="Late" value={w.late || 0} />
            </div>
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="text-[11px] font-bold uppercase text-slate-400 mb-1">Recruitment</div>
              <Row label="Open roles" value={r.openJobs || 0} /><Row label="Shortlisted" value={r.shortlisted || 0} /><Row label="Offers out" value={r.offersReleased || 0} /><Row label="Accepted" value={r.offersAccepted || 0} /><Row label="Interviews (done)" value={`${r.interviewsScheduledToday || 0} (${r.interviewsDoneToday || 0})`} />
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 p-3">
            <div className="text-[11px] font-bold uppercase text-slate-400 mb-1">HR Manager contribution</div>
            <div className="flex gap-6 text-sm"><span>Interviews taken: <b>{con.interviewsTaken || 0}</b></span><span>Added: <b>{con.candidatesAdded || 0}</b></span><span>Offers closed: <b>{con.offersClosed || 0}</b></span></div>
          </div>
          {(s.probation || []).length > 0 && <div className="text-sm"><b>Probation ending:</b> {s.probation.map((p) => `${p.name} (${p.daysLeft < 0 ? -p.daysLeft + 'd over' : p.daysLeft + 'd'})`).join(' · ')}</div>}
          {(s.notice || []).length > 0 && <div className="text-sm"><b>Notice period:</b> {s.notice.map((n) => `${n.name}${n.daysLeft != null ? ` (${n.daysLeft}d)` : ''}`).join(' · ')}</div>}
          <div>
            <div className="text-[11px] font-bold uppercase text-slate-400 mb-1">Checklist ({(report.checklist || []).filter((c) => c.done).length}/{(report.checklist || []).length})</div>
            {(report.checklist || []).map((c, i) => <div key={i} className="text-sm text-slate-700">{c.done ? '✅' : '⬜'} {c.label}</div>)}
          </div>
          {(report.tasks || []).length > 0 && (
            <div><div className="text-[11px] font-bold uppercase text-slate-400 mb-1">Tasks</div>{report.tasks.map((t, i) => <div key={i} className="text-sm text-slate-700">{t.status === 'done' ? '✅' : '⬜'} {t.title}{t.source === 'assigned' ? ` (assigned by ${t.assignedByName})` : ''}</div>)}</div>
          )}
          {noteBlocks.length > 0 && (
            <div className="space-y-2">{noteBlocks.map(([k, label]) => <div key={k}><div className="text-[11px] font-bold uppercase text-slate-400">{label}</div><div className="text-sm text-slate-700 whitespace-pre-wrap">{notes[k]}</div></div>)}</div>
          )}
        </div>
      </div>
    </div>
  );
}

// HR Admin → Emails: one table of every recruitment email (name, description,
// who it's sent to, which mailbox it sends from, last activity), with Preview and
// Activity popups. Mirrors the Sales-CRM Emails tab. All HR emails send from the
// linked recruitment mailbox, so the "Sent from" column is read-only.
function HrEmailsTab() {
  const [data, setData] = useState(null);
  const [preview, setPreview] = useState(null);
  const [activity, setActivity] = useState(null);
  useEffect(() => { hrApi('/email-catalog').then(setData).catch(() => setData({ emails: [], mailbox: '', connected: false })); }, []);
  const fmtDate = (d) => { if (!d) return '—'; try { return new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return '—'; } };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-bold text-sm mb-1 text-[#050A1F]">Recruitment emails</h3>
        <p className="text-xs text-slate-500 mb-4">Every automated email the recruitment system sends. Preview a sample or view recent send activity. All emails send from the linked recruitment mailbox.</p>

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
                      <div className="text-xs"><span className="font-mono text-slate-600">{e.sentFrom}</span><div className="text-[10px] text-slate-400">Recruitment mailbox</div></div>
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
      {activity && <HrEmailActivityModal id={activity.id} name={activity.name} fmtDate={fmtDate} onClose={() => setActivity(null)} />}
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
function HrEmailActivityModal({ id, name, fmtDate, onClose }) {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const perPage = 10;
  useEffect(() => { hrApi(`/email-catalog/${id}/activity`).then(setData).catch(() => setData({ activity: [], note: 'Could not load activity.' })); }, [id]);
  const rows = (data && data.activity) || [];
  const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
  const pageRows = rows.slice((page - 1) * perPage, page * perPage);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[120] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl flex flex-col" style={{ height: '86vh' }} onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div><div className="text-sm font-extrabold text-[#050A1F]">Activity — {name}</div><div className="text-[11px] text-slate-400">{rows.length > 0 ? `${rows.length} recent send${rows.length === 1 ? '' : 's'}` : 'Recent sends'}</div></div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400">✕</button>
        </div>
        <div className="flex-1 overflow-auto p-5">
          {!data ? <div className="text-slate-400 text-sm py-16 text-center">Loading…</div>
            : rows.length === 0 ? <div className="text-slate-400 text-sm py-16 text-center">{data.note || 'No sends recorded yet.'}</div>
              : (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-left">
                        <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">Recipient</th>
                        <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">Email</th>
                        <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">Date &amp; time</th>
                        <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((a, i) => (
                        <tr key={i} className="border-b border-slate-100 last:border-0">
                          <td className="px-4 py-3 font-semibold text-[#050A1F] whitespace-nowrap">{a.toName || '—'}</td>
                          <td className="px-4 py-3 text-slate-600">{a.toEmail}</td>
                          <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmtDate(a.sentAt)}</td>
                          <td className="px-4 py-3 text-right whitespace-nowrap"><span className="rounded-full bg-green-50 text-green-700 px-2 py-0.5 text-[11px] font-bold">✓ Sent</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
        </div>
        {rows.length > perPage && (
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
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const logoRef = useRef(null);
  useEffect(() => { hrApi('/settings').then((r) => setC(r.careers || {})).catch(() => {}); }, []);
  if (!c) return <div className="text-slate-400 text-sm">Loading…</div>;
  const publicUrl = c.token ? `${window.location.origin}/jobs/${c.token}` : '';
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
    </div>
  );
}

function HrAdmin({ user }) {
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
    try {
      const body = {
        name: edit.name, phone: edit.phone, designation: edit.designation, type: edit.type,
        employeeId: edit.employeeId, branch: edit.branch, department: edit.department, joiningDate: edit.joiningDate,
        shiftId: edit.shiftId || null, branchIncharge: edit.branchIncharge, targets: edit.targets, ...splitReports(edit.reportsTo),
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

  const TABS = [['org', 'Organization'], ['shifts', 'Shifts'], ['holidays', 'Holidays'], ['careers', 'Careers Page'], ['emails', 'Emails'], ['daily', 'Daily checklist'], ['reports', 'Daily reports'], ['settings', 'Settings'], ['logs', 'Logs']];

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
                <SharedField label="Shift"><select className={inputCls} value={edit.shiftId || ''} onChange={(e) => setEdit({ ...edit, shiftId: e.target.value })}><option value="">— none —</option>{shifts.map((sh) => <option key={sh._id} value={sh._id}>{sh.name}</option>)}</select></SharedField>
                <SharedField label="Reports to"><select className={inputCls} value={edit.reportsTo || ''} onChange={(e) => setEdit({ ...edit, reportsTo: e.target.value })}><option value="">— none —</option>{reportingOptions.filter((o) => o.value !== `hr:${edit._id}`).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></SharedField>
                <div className="flex items-center gap-2 pt-6"><input type="checkbox" id="inc-edit" checked={!!edit.branchIncharge} onChange={(e) => setEdit({ ...edit, branchIncharge: e.target.checked })} /><label htmlFor="inc-edit" className="text-sm font-semibold text-slate-600">Branch in-charge</label></div>
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
                <div className="space-y-1.5 mb-3">
                  {branches.map((b) => (
                    <div key={b._id} className="flex items-center justify-between text-sm group">
                      <span className="font-semibold text-slate-600">{b.name}</span>
                      <span className="flex items-center opacity-0 group-hover:opacity-100 transition"><IconBtn title="Edit" onClick={() => editBranch(b)}><Icon.Pencil size={14} /></IconBtn><IconBtn title="Delete" danger onClick={() => delBranch(b)}><Icon.Trash size={14} /></IconBtn></span>
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
      {tab === 'emails' && <HrEmailsTab />}
      {tab === 'daily' && <HrChecklistAdmin />}
      {tab === 'reports' && <HrDailyReportsAdmin />}
      {tab === 'settings' && <HrSettingsTab isAdmin={!!user.isAdmin} setErr={setErr} />}
      {tab === 'logs' && <HrLogsTab />}
      {tab === 'careers' && <HrCareersTab />}

      {showAdd && <AddUserModal branches={branches} departments={departments} reportingOptions={reportingOptions} shifts={shifts} imagekitReady={imagekitReady} onClose={() => setShowAdd(false)} onCreated={(n) => { setMsg(`User created: ${n}`); load(); }} />}
      {orgChartOpen && <HrOrgChartModal users={users} reporting={reporting} onClose={() => setOrgChartOpen(false)} />}
    </div>
  );
}

// Shifts manager (add/edit/delete with break window).
function ShiftsManager({ shifts, reload, setErr }) {
  const blank = { name: '', startTime: '09:00', endTime: '18:00', breakStart: '13:00', breakEnd: '13:45' };
  const [f, setF] = useState(blank);
  const [editing, setEditing] = useState(null);
  const set = (o) => setF((s) => ({ ...s, ...o }));
  const submit = async () => {
    if (!f.name.trim()) { setErr('Shift name is required.'); return; }
    try {
      if (editing) await hrApi(`/shifts/${editing}`, { method: 'PUT', body: JSON.stringify(f) });
      else await hrApi('/shifts', { method: 'POST', body: JSON.stringify(f) });
      setF(blank); setEditing(null); reload();
    } catch (e) { setErr(e.message); }
  };
  const del = async (s) => { if (!confirm(`Delete shift "${s.name}"?`)) return; try { await hrApi(`/shifts/${s._id}`, { method: 'DELETE' }); reload(); } catch (e) { setErr(e.message); } };
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="text-sm font-bold text-[#050A1F] mb-3">Shifts</div>
        <div className="space-y-2">
          {shifts.map((s) => (
            <div key={s._id} className="flex items-center justify-between border border-slate-100 rounded-lg px-3 py-2 group">
              <div><div className="text-sm font-bold text-[#050A1F]">{s.name}</div><div className="text-[11px] text-slate-400">{s.startTime}–{s.endTime}{s.breakStart ? ` · break ${s.breakStart}–${s.breakEnd}` : ''}</div></div>
              <span className="flex items-center opacity-0 group-hover:opacity-100 transition"><IconBtn title="Edit" onClick={() => { setEditing(s._id); setF({ name: s.name, startTime: s.startTime, endTime: s.endTime, breakStart: s.breakStart, breakEnd: s.breakEnd }); }}><Icon.Pencil size={14} /></IconBtn><IconBtn title="Delete" danger onClick={() => del(s)}><Icon.Trash size={14} /></IconBtn></span>
            </div>
          ))}
          {shifts.length === 0 && <div className="text-slate-400 text-sm py-4 text-center">No shifts yet.</div>}
        </div>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="text-sm font-bold text-[#050A1F] mb-3">{editing ? 'Edit shift' : 'Add shift'}</div>
        <div className="space-y-3">
          <SharedField label="Shift name"><input className={inputCls} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Morning, Night" /></SharedField>
          <div className="grid grid-cols-2 gap-3">
            <SharedField label="Start time"><input type="time" className={inputCls} value={f.startTime} onChange={(e) => set({ startTime: e.target.value })} /></SharedField>
            <SharedField label="End time"><input type="time" className={inputCls} value={f.endTime} onChange={(e) => set({ endTime: e.target.value })} /></SharedField>
            <SharedField label="Break start"><input type="time" className={inputCls} value={f.breakStart} onChange={(e) => set({ breakStart: e.target.value })} /></SharedField>
            <SharedField label="Break end"><input type="time" className={inputCls} value={f.breakEnd} onChange={(e) => set({ breakEnd: e.target.value })} /></SharedField>
          </div>
          <div className="flex justify-end gap-2">
            {editing && <button onClick={() => { setEditing(null); setF(blank); }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>}
            <button onClick={submit} className="rounded-lg px-5 py-2.5 text-sm font-bold text-white" style={{ background: ORANGE }}>{editing ? 'Save' : 'Add shift'}</button>
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
        <div className="text-[13px] font-bold text-[#0A0E28] truncate">{p.name}{p.branchIncharge && <span className="ml-1.5 text-[9px] font-bold text-[#FF4500]">IN-CHARGE</span>}</div>
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
      <button onClick={() => toggle(k)} className="rounded-full border border-slate-300 bg-white text-slate-500 flex items-center justify-center hover:bg-slate-50 leading-none" style={{ width: 18, height: 18, fontSize: 12 }}>{collapsed[k] ? '+' : '\u2212'}</button>
    </div>
  );

  // Group employees by department, ordered by role level within each.
  const byDept = {};
  active.forEach((u) => { const d = (u.department && String(u.department).trim()) || 'Unassigned'; (byDept[d] = byDept[d] || []).push(u); });
  const deptNames = Object.keys(byDept).sort((a, b) => (a === 'Unassigned') - (b === 'Unassigned') || a.localeCompare(b));
  deptNames.forEach((d) => byDept[d].sort((a, b) => (ROLE_LEVEL[a.type] ?? 9) - (ROLE_LEVEL[b.type] ?? 9) || (a.name || '').localeCompare(b.name || '')));

  // A department column: navy pill + toggle + vertical chain of people.
  const DeptColumn = ({ name }) => {
    const people = byDept[name] || [];
    const dk = `dept:${name}`;
    return (
      <div className="inline-flex flex-col items-center align-top" style={{ verticalAlign: 'top' }}>
        <div className="inline-block text-white font-extrabold uppercase" style={{ background: '#0A1F44', fontSize: 12, letterSpacing: '.06em', padding: '9px 20px', borderRadius: 8 }}>{name}</div>
        {people.length > 0 && <Toggle k={dk} />}
        {!collapsed[dk] && people.length > 0 && (
          <div style={{ marginTop: 16 }}>
            {people.map((u, i) => (
              <div key={u._id} className="flex flex-col items-center">
                <PersonCard p={u} />
                {i < people.length - 1 && <VConn />}
              </div>
            ))}
          </div>
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
            {/* Management row (admins) */}
            {admins.length > 0 && (
              <div className="flex items-start justify-center gap-8">
                {admins.map((a) => <PersonCard key={`admin:${a.id}`} p={{ name: a.name, designation: 'Director \u00B7 Admin', type: 'director', avatar: a.avatar, phone: a.phone, email: a.email }} w={280} />)}
              </div>
            )}
            {/* Toggle + horizontal branch into departments */}
            {deptNames.length > 0 && (
              <>
                <Toggle k="__depts__" />
                {!collapsed['__depts__'] && (
                  <div style={{ paddingTop: 14 }} className="relative">
                    {deptNames.length > 1 && <div style={{ position: 'absolute', top: 0, left: '10%', right: '10%', height: 1, background: '#cbd5e1' }} />}
                    <div className="flex items-start justify-center">
                      {deptNames.map((d) => (
                        <div key={d} className="relative flex flex-col items-center">
                          <div style={{ position: 'absolute', top: -14, width: 1, height: 14, background: '#cbd5e1' }} />
                          <DeptColumn name={d} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


export default function HrApp() {
  const navigate = useNavigate();
  const location = useLocation();
  // Derive the current view from the URL path (/hr/<view>) so refresh and deep
  // links keep the user on the same page. Falls back to dashboard.
  const VALID_VIEWS = ['dashboard', 'recruitment', 'interview', 'email', 'employees', 'survey', 'profile', 'templates', 'signature', 'admin'];
  const pathView = (() => {
    const seg = (location.pathname.replace(/^\/hr\/?/, '').split('/')[0] || '').toLowerCase();
    return VALID_VIEWS.includes(seg) ? seg : 'dashboard';
  })();
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [view, setViewRaw] = useState(pathView);
  const [profileTarget, setProfileTarget] = useState(null);
  const [navKey, setNavKey] = useState(0); // bump to force a fresh sub-view on nav
  const [mobileNav, setMobileNav] = useState(false);
  const [recruitIntent, setRecruitIntent] = useState(null); // {tab, candScope, weekOnly, jobScope}
  // setView also writes a clean URL (/hr/<view>).
  const setView = (v) => { setViewRaw(v); const target = `/hr/${v}`; if (location.pathname !== target) navigate(target); };
  // Keep view in sync when the user navigates back/forward.
  useEffect(() => { if (pathView !== view) setViewRaw(pathView); }, [pathView]);
  const goRecruit = (intent) => { setRecruitIntent(intent || null); setView('recruitment'); setProfileTarget(null); setNavKey((k) => k + 1); };

  // Restore session.
  useEffect(() => {
    const token = localStorage.getItem(HR_TOKEN_KEY);
    if (!token) { setChecking(false); return; }
    hrApi('/me').then((u) => setUser(u)).catch(() => localStorage.removeItem(HR_TOKEN_KEY)).finally(() => setChecking(false));
  }, []);

  const refreshUser = () => hrApi('/me').then(setUser).catch(() => {});
  const logout = () => { hrApi('/auth/logout', { method: 'POST' }).catch(() => {}).finally(() => { localStorage.removeItem(HR_TOKEN_KEY); setUser(null); window.location.href = '/hr/login'; }); };

  if (checking) return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-400 text-sm">Loading…</div>;
  if (!user) return <HrLogin onSignIn={(u) => setUser(u)} />;

  const isAdmin = !!user.isAdmin;
  // Schedulers (hr/recruiter/manager/tl) + admins get the full dashboard and
  // the unread-mail box; pure interview panelists / plain employees do not.
  const SCHEDULER_TYPES = ['hr', 'recruiter', 'manager', 'tl'];
  const isScheduler = isAdmin || (user.type && SCHEDULER_TYPES.includes(user.type));
  // The HR Manager daily console is for HR Managers (flag or manager type) + admins.
  const isHrManager = isAdmin || !!user.isHrManager || user.type === 'manager';
  const nav = [
    ...(isScheduler ? [{ id: 'dashboard', label: 'Dashboard' }] : []),
    ...(isHrManager ? [{ id: 'daily', label: 'Daily' }] : []),
    ...(isAdmin ? [{ id: 'tasks', label: 'Task' }] : []),
    { id: 'recruitment', label: 'Recruitment' },
    { id: 'interview', label: 'Interview' },
    ...(isScheduler ? [{ id: 'email', label: 'Email' }] : []),
    { id: 'employees', label: 'Employee' },
    ...(isAdmin ? [{ id: 'survey', label: 'Survey' }] : []),
    ...(isAdmin ? [{ id: 'admin', label: 'Admin' }] : []),
  ];
  // Land non-schedulers on their interviews rather than an empty dashboard.
  const effectiveView = (view === 'dashboard' && !isScheduler) ? 'interview' : view;

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
              {nav.map((n) => (
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
            {nav.map((n) => (
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
        {effectiveView === 'dashboard' && <HrDashboard user={user} isAdmin={isAdmin} onOpenCandidate={(id, candTab) => goRecruit({ tab: 'candidates', openCandidateId: id, openCandidateTab: candTab })} onNav={goRecruit} />}
        {effectiveView === 'daily' && <HrDailyConsole user={user} isAdmin={isAdmin} />}
        {effectiveView === 'tasks' && <HrTasksView user={user} isAdmin={isAdmin} />}
        {effectiveView === 'recruitment' && <HrRecruitment isAdmin={isAdmin} me={user} intent={recruitIntent} />}
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
        {effectiveView === 'admin' && isAdmin && <HrAdmin user={user} />}
        {effectiveView === 'survey' && isAdmin && <HrSurveyAdmin />}
      </main>
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
        {user.name} <span className="text-slate-500">▾</span>
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

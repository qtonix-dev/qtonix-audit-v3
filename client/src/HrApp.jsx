import React, { useState, useEffect, useRef } from 'react';
import { API_BASE } from './config.js';
import { AddUserModal, ImageKitSection, ProfilePage, EmployeeDirectory, Field as SharedField, Avatar, ROLE_LABELS, ROLE_OPTIONS, ROLE_LEVEL, Icon } from './HrParts.jsx';
import { Pagination, MailEditor } from './Leads.jsx';
import HrJobBuilder from './HrJobBuilder.jsx';
import { AppSwitcher } from './AppSwitcher.jsx';
import AllEmailPage from './AllEmailPage.jsx';
import HrCandidateView from './HrCandidateView.jsx';

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

const ORANGE = 'linear-gradient(90deg,#FF6A00,#FF4500)';
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

function HrDashboard({ user, isAdmin, onOpenCandidate }) {
  const [data, setData] = useState(null);
  const [stats, setStats] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [targets, setTargets] = useState([]);
  const [missed, setMissed] = useState(null);
  const [missedModal, setMissedModal] = useState(null); // { ownerId } | null
  const [mail, setMail] = useState(null);
  const [mailTab, setMailTab] = useState('new');
  const [celebrations, setCelebrations] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [annCanPost, setAnnCanPost] = useState(false);
  const [showAnnModal, setShowAnnModal] = useState(false);
  const [board, setBoard] = useState(null);
  useEffect(() => {
    hrApi('/dashboard').then(setData).catch(() => setData({ metrics: {} }));
    hrApi('/dashboard-stats').then(setStats).catch(() => {});
    hrApi('/job-posts').then(setJobs).catch(() => {});
    hrApi('/source-analytics').then((r) => setAnalytics(r.sources || [])).catch(() => {});
    hrApi('/targets-progress').then((r) => setTargets(r.rows || [])).catch(() => {});
    hrApi('/missed-commitments').then(setMissed).catch(() => {});
    hrApi('/unread-mail').then(setMail).catch(() => {});
    hrApi('/celebrations').then((r) => setCelebrations(r.items || [])).catch(() => {});
    hrApi('/leaderboard').then(setBoard).catch(() => {});
    loadAnnouncements();
  }, []);
  const loadAnnouncements = () => hrApi('/announcements').then((r) => { setAnnouncements(r.announcements || []); setAnnCanPost(!!r.canPost); }).catch(() => {});
  const m = (data && data.metrics) || {};
  const stageLabels = {}; jobs.forEach((j) => (j.stages || []).forEach((s) => { stageLabels[s.id] = s.label; }));
  const byStage = (stats && stats.byStage) || {};
  const stageRows = Object.entries(byStage).map(([id, n]) => ({ id, label: stageLabels[id] || id, n })).sort((a, b) => b.n - a.n);
  const SRC = { manual: 'Manual', linkedin: 'LinkedIn', naukri: 'Naukri', indeed: 'Indeed', referral: 'Referral', careers_page: 'Careers', public_form: 'Careers' };
  const cards = [
    ['Open positions', stats ? stats.openJobs : m.openJobs, '#2563EB', 'M20 7h-4V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z'],
    ['Active candidates', stats ? stats.totalActive : m.candidates, '#FF6A00', 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
    ['Applications this week', stats ? stats.applicationsThisWeek : '—', '#8b5cf6', 'M22 11.08V12a10 10 0 1 1-5.93-9.14 M22 4L12 14.01l-3-3'],
    ['Avg time-to-hire', stats && stats.avgTimeToHire != null ? `${stats.avgTimeToHire}d` : '—', '#16A34A', 'M12 8v4l3 3 M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z'],
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

      {/* Missed commitments — feedback, calls, scheduling that slipped past time. */}
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
        {cards.map(([label, val, color, icon]) => (
          <div key={label} className="rounded-2xl border p-5 relative overflow-hidden" style={{ borderColor: color + '33', background: '#fff' }}>
            <div className="absolute top-4 right-4 w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: softTint(color) }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{icon.split(' M').map((seg, i) => <path key={i} d={(i ? 'M' : '') + seg} />)}</svg>
            </div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
            <div className="text-3xl font-extrabold mt-1" style={{ color }}>{val ?? '—'}</div>
          </div>
        ))}
      </div>

      {/* HR target progress (daily scheduling + monthly hiring) */}
      {targets.length > 0 && (
        <div className="rounded-2xl border border-slate-100 bg-white p-5">
          <div className="font-extrabold text-[#050A1F] mb-4">HR targets</div>
          <div className="grid md:grid-cols-2 gap-x-8 gap-y-4">
            {targets.map((t) => (
              <div key={t.id} className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-full bg-slate-100 overflow-hidden flex items-center justify-center text-xs font-bold text-slate-500 shrink-0">
                  {t.avatar ? <img src={t.avatar} alt="" className="w-full h-full object-cover" /> : (t.name || '?')[0]}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-[#050A1F] truncate">{t.name}</div>
                  <div className="grid grid-cols-2 gap-3 mt-1.5">
                    {t.dailyTarget > 0 && <TargetBar label="Today's interviews" done={t.dailyDone} target={t.dailyTarget} color="#2563EB" />}
                    {t.monthlyTarget > 0 && <TargetBar label="Hired this month" done={t.monthlyDone} target={t.monthlyTarget} color="#16A34A" />}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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

      {/* HR leaderboard — candidates added (scheduled) & joined, today + month */}
      {board && board.rows && board.rows.length > 0 && (
        <div className="rounded-2xl border border-slate-100 bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="font-extrabold text-[#050A1F]">🏆 HR leaderboard</div>
            {board.leader && <div className="text-xs text-slate-500">Leading: <b className="text-[#050A1F]">{board.leader.name}</b></div>}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                <th className="pb-2">#</th><th className="pb-2">HR</th>
                <th className="pb-2 text-center" colSpan={2}>Candidates added</th>
                <th className="pb-2 text-center" colSpan={2}>Joined</th>
              </tr>
              <tr className="text-left text-[9px] uppercase tracking-wide text-slate-300">
                <th></th><th></th><th className="pb-1 text-center">Today</th><th className="pb-1 text-center">Month</th><th className="pb-1 text-center">Today</th><th className="pb-1 text-center">Month</th>
              </tr>
            </thead>
            <tbody>
              {board.rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-50">
                  <td className="py-2 w-8"><span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-extrabold ${r.rank === 1 ? 'bg-amber-100 text-amber-700' : r.rank === 2 ? 'bg-slate-200 text-slate-600' : r.rank === 3 ? 'bg-orange-100 text-orange-700' : 'text-slate-400'}`}>{r.rank}</span></td>
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-full bg-slate-100 overflow-hidden flex items-center justify-center text-[10px] font-bold text-slate-500 shrink-0">{r.avatar ? <img src={r.avatar} alt="" className="w-full h-full object-cover" /> : (r.name || '?')[0]}</span>
                      <span className="font-bold text-[#050A1F] truncate">{r.name}</span>
                    </div>
                  </td>
                  <td className="py-2 text-center font-semibold text-slate-500">{r.scheduledToday}</td>
                  <td className="py-2 text-center font-extrabold text-[#2563EB]">{r.scheduledMonth}</td>
                  <td className="py-2 text-center font-semibold text-slate-500">{r.joinedToday}</td>
                  <td className="py-2 text-center font-extrabold text-[#16A34A]">{r.joinedMonth}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-[10px] text-slate-400 mt-2">Candidates added = interviews scheduled. Joined = candidates who accepted an offer, credited to the recruiter.</div>
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

function HrRecruitment({ isAdmin, me }) {
  const [tab, setTab] = useState('jobs');
  const [mode, setMode] = useState('list'); // list | choose | build
  const [builderSeed, setBuilderSeed] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [branches, setBranches] = useState([]);
  const [err, setErr] = useState('');
  const [candFilterJob, setCandFilterJob] = useState(null); // preset job filter when arriving from a job's applicant link
  const tabs = [['jobs', 'Job Post'], ['candidates', 'Candidate List'], ['pipeline', 'Pipeline']];

  const loadJobs = () => hrApi('/job-posts').then(setJobs).catch(() => {});
  useEffect(() => {
    loadJobs();
    hrApi('/departments').then(setDepartments).catch(() => {});
    hrApi('/branches').then(setBranches).catch(() => {});
  }, []);

  const startBuilder = (seed) => { setBuilderSeed(seed || null); setMode('build'); };
  const viewApplicants = (jobId) => { setCandFilterJob(jobId); setTab('candidates'); };

  if (mode === 'build') {
    return <HrJobBuilder departments={departments} branches={branches} existing={builderSeed}
      onCancel={() => { setMode('list'); loadJobs(); }}
      onDone={() => { setMode('list'); loadJobs(); }} />;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-extrabold text-[#050A1F]">Recruitment</h1>
        {tab === 'jobs' && (isAdmin || (me && me.isHrManager)) && <button onClick={() => startBuilder(null)} className="rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ background: ORANGE }}>+ Post a Job</button>}
      </div>
      {err && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm px-3 py-2">{err}</div>}
      <div className="inline-flex items-center gap-1 bg-slate-100 rounded-lg p-1 mb-6">
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => { setTab(id); if (id !== 'candidates') setCandFilterJob(null); }}
            className={`px-4 py-1.5 rounded-md text-xs font-bold ${tab === id ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>{label}</button>
        ))}
      </div>
      {tab === 'jobs' && <JobList jobs={jobs} isAdmin={isAdmin} me={me} onEdit={(j) => startBuilder(j)} reload={loadJobs} onViewApplicants={viewApplicants} />}
      {tab === "candidates" && <CandidateList jobs={jobs} isAdmin={isAdmin} me={me} initialJobFilter={candFilterJob} />}
      {tab === 'pipeline' && <RecruitPipeline jobs={jobs} />}
    </div>
  );
}

// Read a File as a base64 data URL for server-side extraction/upload.
export function fileToBase64(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}

function JobList({ jobs, isAdmin, me, onEdit, reload, onViewApplicants }) {
  const [addFor, setAddFor] = useState(null); // job to add a candidate to
  const [shareFor, setShareFor] = useState(null); // job to share
  const [assignFor, setAssignFor] = useState(null); // job to assign HR to
  const [scope, setScope] = useState('all'); // all | mine
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
      <div className="inline-flex items-center gap-1 bg-slate-100 rounded-lg p-1 mb-1">
        <button onClick={() => setScope('all')} className={`px-3 py-1 rounded-md text-xs font-bold ${scope === 'all' ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>All jobs</button>
        <button onClick={() => setScope('mine')} className={`px-3 py-1 rounded-md text-xs font-bold ${scope === 'mine' ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>My jobs</button>
      </div>
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
              <button onClick={() => onViewApplicants(j._id)} className="font-bold text-orange-600 hover:text-orange-700 hover:underline">
                {j.applicantCount || 0} candidate{(j.applicantCount || 0) === 1 ? '' : 's'} applied
              </button>
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
      {shareFor && <ShareJobModal job={shareFor} onClose={() => setShareFor(null)} />}
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
  useEffect(() => { hrApi('/employees').then((rows) => setEmps(rows.filter((e) => ['hr', 'recruiter', 'manager', 'tl'].includes(e.type) && e.active !== false))).catch(() => {}); }, []);
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
function ShareJobModal({ job, onClose }) {
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
        <Field title="Form URL" note="The application form on its own." value={embedUrl} which="form" />
        <Field title="Embed code" note="Paste this into your website to embed the form." value={iframe} which="iframe" />
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

function CandidateList({ jobs, isAdmin, me, initialJobFilter }) {
  const [cands, setCands] = useState([]);
  const [viewId, setViewId] = useState(null);
  const [notesFor, setNotesFor] = useState(null);
  const [sel, setSel] = useState([]); // selected candidate ids for bulk actions
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [bulkModal, setBulkModal] = useState(null); // 'move' | 'reject' | 'assign'
  const [q, setQ] = useState('');
  const [jobFilter, setJobFilter] = useState(initialJobFilter || '');
  const [stageFilter, setStageFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  // Keyword search runs server-side (covers resume text); other filters are local.
  const load = (kw) => {
    const qs = kw && kw.trim() ? `?q=${encodeURIComponent(kw.trim())}` : '';
    return hrApi(`/candidates${qs}`).then(setCands).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { const t = setTimeout(() => load(q), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { if (initialJobFilter) setJobFilter(initialJobFilter); }, [initialJobFilter]);
  const job = (id) => jobs.find((j) => j._id === id) || {};
  const stageLabel = (c) => {
    if (c.rejected) return { label: 'Rejected', color: '#DC2626' };
    const st = ((job(c.jobPostId).stages) || []).find((s) => s.id === c.stage);
    return { label: st ? st.label : c.stage, color: st ? st.color : '#64748B' };
  };

  if (viewId) return <HrCandidateView candidateId={viewId} isAdmin={isAdmin} onBack={() => { setViewId(null); load(q); }} onDeleted={() => { setViewId(null); load(q); }} />;

  // All stages across jobs, de-duplicated, for the stage filter.
  const allStages = []; const seen = new Set();
  jobs.forEach((j) => (j.stages || []).forEach((s) => { if (!seen.has(s.id)) { seen.add(s.id); allStages.push(s); } }));
  const allTags = Array.from(new Set(cands.flatMap((c) => c.tags || []))).sort();

  const filtered = cands.filter((c) => {
    if (jobFilter && c.jobPostId !== Number(jobFilter)) return false;
    if (stageFilter && (stageFilter === 'rejected' ? !c.rejected : c.stage !== stageFilter)) return false;
    if (sourceFilter && c.source !== sourceFilter) return false;
    if (tagFilter && !(c.tags || []).includes(tagFilter)) return false;
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
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input className={F + ' flex-1 min-w-[200px]'} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, skills or resume…" />
        <select className={F} value={jobFilter} onChange={(e) => setJobFilter(e.target.value)}>
          <option value="">All positions</option>
          {jobs.map((j) => <option key={j._id} value={j._id}>{j.title}</option>)}
        </select>
        <select className={F} value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
          <option value="">All stages</option>
          {allStages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          <option value="rejected">Rejected</option>
        </select>
        <select className={F} value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
          <option value="">All sources</option>
          <option value="manual">Manual</option>
          <option value="public_form">Application form</option>
        </select>
        {allTags.length > 0 && (
          <select className={F} value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
            <option value="">All tags</option>
            {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        {(q || jobFilter || stageFilter || sourceFilter || tagFilter) && <button onClick={() => { setQ(''); setJobFilter(''); setStageFilter(''); setSourceFilter(''); setTagFilter(''); }} className="text-xs font-bold text-slate-400 hover:text-slate-600">Clear</button>}
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
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <th className="px-4 py-3"><input type="checkbox" checked={allShownSelected} onChange={toggleAll} /></th>
                <th className="px-4 py-3">Candidate</th><th className="px-4 py-3">Phone</th><th className="px-4 py-3">Position</th>
                <th className="px-4 py-3">Experience</th><th className="px-4 py-3">Current Salary</th><th className="px-4 py-3">Resume Match</th><th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Recruiter</th><th className="px-4 py-3">Last update</th><th className="px-4 py-3 text-right">Actions</th>
              </tr></thead>
              <tbody>
                {paged.map((c) => {
                  const a = c.answers || {}; const st = stageLabel(c);
                  return (
                    <tr key={c._id} className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="px-4 py-3"><input type="checkbox" checked={sel.includes(c._id)} onChange={() => toggleSel(c._id)} /></td>
                      <td className="px-4 py-3">
                        <button onClick={() => setViewId(c._id)} className="text-left">
                          <div className="font-semibold text-slate-700 hover:text-orange-600">{c.name}</div>
                          <div className="text-xs text-slate-400">{c.email}</div>
                        </button>
                        {(c.rating > 0 || (c.tags || []).length > 0) && (
                          <div className="flex items-center gap-1.5 mt-1">
                            {c.rating > 0 && <span className="text-amber-400 text-xs">{'★'.repeat(c.rating)}<span className="text-slate-200">{'★'.repeat(5 - c.rating)}</span></span>}
                            {(c.tags || []).slice(0, 3).map((t) => <span key={t} className="rounded-full bg-slate-100 text-slate-500 px-1.5 py-0.5 text-[10px] font-semibold">{t}</span>)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{c.phone || '—'}</td>
                      <td className="px-4 py-3 text-slate-500">{job(c.jobPostId).title || '—'}</td>
                      <td className="px-4 py-3 text-slate-500">{totalExperience(c)}</td>
                      <td className="px-4 py-3 text-slate-500">{a.currentCtc || '—'}</td>
                      <td className="px-4 py-3"><ResumeMatchBadge match={c.resumeMatch} /></td>
                      <td className="px-4 py-3"><span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: st.color + '18', color: st.color }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: st.color }} />{st.label}</span></td>
                      <td className="px-4 py-3 text-slate-500">{c.recruiterName || '—'}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{timeAgo(c.updatedAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <CandIconBtn icon="eye" label="View candidate" onClick={() => setViewId(c._id)} />
                          <CandIconBtn icon="note" label="Add note" onClick={() => setNotesFor(c._id)} />
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
      {bulkModal && <BulkActionModal action={bulkModal} ids={sel} jobs={jobs} stages={allStages} onClose={() => setBulkModal(null)} onDone={() => { setBulkModal(null); setSel([]); load(q); }} />}
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
  return (
    <span className={`inline-flex items-center rounded-full font-bold ${pad}`} style={{ background: s.bg, color: s.fg }} title={match && match.reason ? match.reason : (level === 'not_available' ? 'No resume or profile data to score.' : '')}>
      {s.label}{match && typeof match.score === 'number' && level !== 'not_available' ? ` · ${match.score}` : ''}
    </span>
  );
}

function CandIconBtn({ icon, label, onClick }) {
  const paths = {
    eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z',
    // A speech-bubble note icon (distinct from the edit/pencil used elsewhere).
    note: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
    trash: 'M3 6h18M8 6V4h8v2m-9 0v14h10V6M10 11v6M14 11v6',
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
    if (action === 'assign') hrApi('/employees').then((r) => setEmps(r.filter((e) => e.active))).catch(() => {});
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
      await hrApi(`/candidates/${candidateId}`, { method: 'PATCH', body: JSON.stringify({ name: c.name, email: c.email, phone: c.phone, jobPostId: c.jobPostId, answers: c.answers }) });
      onSaved();
    } catch { setBusy(false); }
  };
  const F = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[120] p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-2xl max-h-[88vh] overflow-auto">
        <div className="text-lg font-extrabold text-[#050A1F] mb-4">Edit candidate</div>
        <div className="grid grid-cols-2 gap-3">
          <div><L>Name</L><input className={F} value={c.name || ''} onChange={(e) => setC({ ...c, name: e.target.value })} /></div>
          <div><L>Phone</L><input className={F} value={c.phone || ''} onChange={(e) => setC({ ...c, phone: e.target.value })} /></div>
          <div><L>Email</L><input className={F} value={c.email || ''} onChange={(e) => setC({ ...c, email: e.target.value })} /></div>
          <div><L>Position</L><select className={F} value={c.jobPostId || ''} onChange={(e) => setC({ ...c, jobPostId: Number(e.target.value) })}><option value="">—</option>{jobs.map((j) => <option key={j._id} value={j._id}>{j.title}</option>)}</select></div>
          <div><L>Current Salary</L><input className={F} value={a.currentCtc || ''} onChange={(e) => setA('currentCtc', e.target.value)} /></div>
          <div><L>Expected Salary</L><input className={F} value={a.expectedCtc || ''} onChange={(e) => setA('expectedCtc', e.target.value)} /></div>
          <div><L>Notice Period (days)</L><input className={F} value={a.noticePeriod || ''} onChange={(e) => setA('noticePeriod', e.target.value)} /></div>
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
      setC((s) => ({
        ...s,
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
        firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone,
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

  const Section = ({ id, title, children }) => (
    <div className="border border-slate-200 rounded-xl mb-3 overflow-hidden">
      <button onClick={() => setOpen((o) => ({ ...o, [id]: !o[id] }))} className="w-full flex items-center justify-between px-4 py-3 bg-slate-50">
        <span className="font-bold text-[#050A1F] capitalize">{title}</span>
        <span className="text-slate-400">{open[id] ? '▲' : '▼'}</span>
      </button>
      {open[id] && <div className="p-4">{children}</div>}
    </div>
  );
  const L = ({ children, req }) => <p className="text-[12px] font-bold text-slate-600 mb-1">{children}{req && <span className="text-red-500">*</span>}</p>;

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
              </div>

              <Section id="basic" title="Basic Information">
                <div className="grid grid-cols-2 gap-4">
                  <div><L req>First Name</L><input className={inp} value={c.firstName} onChange={(e) => set({ firstName: e.target.value })} /></div>
                  <div><L req>Last Name</L><input className={inp} value={c.lastName} onChange={(e) => set({ lastName: e.target.value })} /></div>
                  <div><L>Contact Number</L><input className={inp} value={c.phone} onChange={(e) => set({ phone: e.target.value })} onBlur={checkDup} placeholder="+91…" /></div>
                  <div><L req>Email Address</L><input className={inp} value={c.email} onChange={(e) => set({ email: e.target.value })} onBlur={checkDup} /></div>
                  <div><L>Current CTC (Annual)</L><input className={inp} value={c.currentCtc} onChange={(e) => set({ currentCtc: e.target.value })} placeholder="Ex: 4,50,000" /></div>
                  <div><L>Expected CTC (Annual)</L><input className={inp} value={c.expectedCtc} onChange={(e) => set({ expectedCtc: e.target.value })} placeholder="Ex: 8,50,000" /></div>
                  <div><L>Notice Period (days)</L><input className={inp} type="number" value={c.noticePeriod} onChange={(e) => set({ noticePeriod: e.target.value })} /></div>
                  <div><L>Source</L>
                    <select className={inp} value={source} onChange={(e) => setSource(e.target.value)}>
                      <option value="manual">Manual</option>
                      <option value="linkedin">LinkedIn</option>
                      <option value="naukri">Naukri</option>
                      <option value="indeed">Indeed</option>
                      <option value="referral">Referral</option>
                    </select>
                  </div>
                  <div className="col-span-2"><L>Resume</L>
                    <ResumeUpload jobPostId={job._id} value={c.resumeUrl} onChange={(url) => set({ resumeUrl: url })} />
                  </div>
                </div>
              </Section>

              <Section id="work" title="Work Information">
                <label className="flex items-center gap-2 text-sm text-slate-600 mb-3"><input type="checkbox" checked={c.isFresher} onChange={(e) => set({ isFresher: e.target.checked })} /> I am a recent graduate</label>
                {!c.isFresher && (c.work || []).map((w, i) => (
                  <div key={i} className="grid grid-cols-3 gap-3 mb-3 pb-3 border-b border-slate-100 last:border-0">
                    <div><L>Company Name</L><input className={inp} value={w.company} onChange={(e) => set({ work: c.work.map((x, idx) => idx === i ? { ...x, company: e.target.value } : x) })} /></div>
                    <div><L>Job Title</L><input className={inp} value={w.title} onChange={(e) => set({ work: c.work.map((x, idx) => idx === i ? { ...x, title: e.target.value } : x) })} /></div>
                    <div className="flex gap-2 items-end">
                      <div className="flex-1"><L>From</L><input className={inp} value={w.start} onChange={(e) => set({ work: c.work.map((x, idx) => idx === i ? { ...x, start: e.target.value } : x) })} placeholder="MM/YYYY" /></div>
                      <div className="flex-1"><L>To</L><input className={inp} value={w.end} disabled={w.current} onChange={(e) => set({ work: c.work.map((x, idx) => idx === i ? { ...x, end: e.target.value } : x) })} placeholder="MM/YYYY" /></div>
                    </div>
                    <label className="col-span-3 flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" checked={w.current} onChange={(e) => set({ work: c.work.map((x, idx) => idx === i ? { ...x, current: e.target.checked } : x) })} /> I currently work here</label>
                  </div>
                ))}
                {!c.isFresher && <button onClick={() => set({ work: [...c.work, { company: '', title: '', start: '', end: '', current: false }] })} className="text-xs font-bold text-orange-600">+ Add Work Experience</button>}
                <div className="mt-3"><L>Work Link / Online Portfolio</L><input className={inp} value={c.portfolio} onChange={(e) => set({ portfolio: e.target.value })} /></div>
                <div className="mt-3"><L>Skills</L>
                  <div className="flex flex-wrap gap-1.5 mb-2">{(c.skills || []).map((s, i) => <span key={i} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold">{s}<button onClick={() => set({ skills: c.skills.filter((_, idx) => idx !== i) })} className="text-slate-400 hover:text-red-500">×</button></span>)}</div>
                  <input className={inp} placeholder="Type a skill, press Enter" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const v = e.target.value.trim(); if (v && !c.skills.includes(v)) set({ skills: [...c.skills, v] }); e.target.value = ''; } }} />
                </div>
              </Section>

              <Section id="edu" title="Educational Information">
                {(c.education || []).map((ed, i) => (
                  <div key={i} className="grid grid-cols-3 gap-3 mb-3 pb-3 border-b border-slate-100 last:border-0">
                    <div><L>Type</L><input className={inp} value={ed.type} onChange={(e) => set({ education: c.education.map((x, idx) => idx === i ? { ...x, type: e.target.value } : x) })} placeholder="Bachelor's…" /></div>
                    <div><L>Course</L><input className={inp} value={ed.course} onChange={(e) => set({ education: c.education.map((x, idx) => idx === i ? { ...x, course: e.target.value } : x) })} /></div>
                    <div><L>Specialization</L><input className={inp} value={ed.specialization} onChange={(e) => set({ education: c.education.map((x, idx) => idx === i ? { ...x, specialization: e.target.value } : x) })} /></div>
                    <div className="col-span-2"><L>Institute Name</L><input className={inp} value={ed.institute} onChange={(e) => set({ education: c.education.map((x, idx) => idx === i ? { ...x, institute: e.target.value } : x) })} /></div>
                    <div className="flex gap-2 items-end">
                      <div className="flex-1"><L>From</L><input className={inp} value={ed.start} onChange={(e) => set({ education: c.education.map((x, idx) => idx === i ? { ...x, start: e.target.value } : x) })} /></div>
                      <div className="flex-1"><L>To</L><input className={inp} value={ed.end} onChange={(e) => set({ education: c.education.map((x, idx) => idx === i ? { ...x, end: e.target.value } : x) })} /></div>
                    </div>
                  </div>
                ))}
                <button onClick={() => set({ education: [...c.education, { type: '', course: '', specialization: '', institute: '', start: '', end: '' }] })} className="text-xs font-bold text-orange-600">+ Add Educational Details</button>
              </Section>

              <Section id="addl" title="Additional Information">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2"><L>Address</L><input className={inp} value={c.address} onChange={(e) => set({ address: e.target.value })} /></div>
                  <div><L>Country</L><input className={inp} value={c.country} onChange={(e) => set({ country: e.target.value })} /></div>
                  <div><L>State</L><input className={inp} value={c.state} onChange={(e) => set({ state: e.target.value })} /></div>
                  <div><L>City</L><input className={inp} value={c.city} onChange={(e) => set({ city: e.target.value })} /></div>
                  <div><L>Date Of Birth</L><input className={inp} value={c.dob} onChange={(e) => set({ dob: e.target.value })} placeholder="DD/MM/YYYY" /></div>
                  <div><L>Gender</L>
                    <div className="flex gap-3 mt-1">{['MALE', 'FEMALE', 'OTHER'].map((g) => <label key={g} className="flex items-center gap-1 text-sm"><input type="radio" name="gender" checked={c.gender === g} onChange={() => set({ gender: g })} /> {g === 'OTHER' ? 'Prefer not to say' : g[0] + g.slice(1).toLowerCase()}</label>)}</div>
                  </div>
                  <div><L>Marital Status</L>
                    <div className="flex gap-3 mt-1">{['MARRIED', 'SINGLE', 'OTHER'].map((g) => <label key={g} className="flex items-center gap-1 text-sm"><input type="radio" name="marital" checked={c.maritalStatus === g} onChange={() => set({ maritalStatus: g })} /> {g === 'OTHER' ? 'Prefer not to say' : g[0] + g.slice(1).toLowerCase()}</label>)}</div>
                  </div>
                  <div><L>LinkedIn</L><input className={inp} value={c.linkedin} onChange={(e) => set({ linkedin: e.target.value })} /></div>
                  <div><L>GitHub</L><input className={inp} value={c.github} onChange={(e) => set({ github: e.target.value })} /></div>
                  <div><L>Facebook</L><input className={inp} value={c.facebook} onChange={(e) => set({ facebook: e.target.value })} /></div>
                  <div><L>Instagram</L><input className={inp} value={c.instagram} onChange={(e) => set({ instagram: e.target.value })} /></div>
                  <div><L>Twitter</L><input className={inp} value={c.twitter} onChange={(e) => set({ twitter: e.target.value })} /></div>
                  <div><L>Profile Link</L><input className={inp} value={c.profileUrl} onChange={(e) => set({ profileUrl: e.target.value })} /></div>
                </div>
              </Section>

              {(job.questions || []).length > 0 && (
                <Section id="screen" title="Screening Questions">
                  {(job.questions || []).map((q) => (
                    <div key={q.id} className="mb-3">
                      <L req={q.mandatory}>{q.question}</L>
                      {q.type === 'multi' ? <textarea className={inp} rows={3} value={c.answers[q.id] || ''} onChange={(e) => set({ answers: { ...c.answers, [q.id]: e.target.value } })} />
                        : q.type === 'yesno' ? <select className={inp} value={c.answers[q.id] || ''} onChange={(e) => set({ answers: { ...c.answers, [q.id]: e.target.value } })}><option value="">— Select —</option><option>Yes</option><option>No</option></select>
                        : q.type === 'multiple' ? <select className={inp} value={c.answers[q.id] || ''} onChange={(e) => set({ answers: { ...c.answers, [q.id]: e.target.value } })}><option value="">— Select —</option>{(q.options || []).map((o) => <option key={o}>{o}</option>)}</select>
                        : <input className={inp} value={c.answers[q.id] || ''} onChange={(e) => set({ answers: { ...c.answers, [q.id]: e.target.value } })} />}
                    </div>
                  ))}
                </Section>
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

function RecruitPipeline({ jobs }) {
  const published = jobs.filter((j) => j.status === 'published' || j.status === 'paused');
  const [jobId, setJobId] = useState(published[0]?._id || null);
  const [cands, setCands] = useState([]);
  const [viewId, setViewId] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [moveFor, setMoveFor] = useState(null); // candidate to move via popup
  const [mine, setMine] = useState(false);
  const [me, setMe] = useState(null);
  const load = () => { if (jobId) hrApi(`/candidates?jobPostId=${jobId}`).then(setCands).catch(() => {}); };
  useEffect(() => { load(); }, [jobId]);
  useEffect(() => { hrApi('/profile-me').then(setMe).catch(() => {}); }, []);
  const job = jobs.find((j) => j._id === jobId);
  const stages = (job && job.stages) || [];
  const myId = me && (me._id || me.id);
  const isMine = (c) => myId && (c.recruiterId === myId || (me.name && c.recruiterName === me.name));
  const visible = mine ? cands.filter(isMine) : cands;
  const move = async (c, stage) => {
    if (c.stage === stage) return;
    setCands((cs) => cs.map((x) => x._id === c._id ? { ...x, stage } : x));
    try { await hrApi(`/candidates/${c._id}/stage`, { method: 'PATCH', body: JSON.stringify({ stage }) }); } catch (e) { alert(e.message); load(); }
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
          <div className="inline-flex bg-slate-100 rounded-xl p-1">
            <button onClick={() => setMine(false)} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition ${!mine ? 'bg-white text-[#050A1F] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>All candidates</button>
            <button onClick={() => setMine(true)} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition ${mine ? 'bg-white text-[#050A1F] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>My candidates</button>
          </div>
        </div>
        <div className="text-sm text-slate-400">{visible.length} candidates · drag or use ⇄ to move</div>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {stages.map((s) => {
          const col = visible.filter((c) => c.stage === s.id && !c.rejected);
          return (
            <div key={s.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { const d = cands.find((x) => x._id === dragId); if (d) move(d, s.id); setDragId(null); }}
              className="shrink-0 w-72 rounded-3xl p-3" style={{ background: softBg(s.color) }}>
              <div className="flex items-center justify-between px-2 pt-1 pb-3">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                  <span className="text-sm font-extrabold text-[#050A1F]">{s.label}</span>
                  <span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-white/70" style={{ color: s.color }}>{col.length}</span>
                </div>
              </div>
              <div className="space-y-3 min-h-[160px] max-h-[calc(100vh-300px)] overflow-y-auto pr-1">
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
                            <div className="font-extrabold text-sm text-[#050A1F] leading-snug truncate">{c.name}</div>
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

// Panelist view: interviews assigned to me, grouped by job, with a way to open
// the candidate and submit feedback.
function MyInterviews() {
  const [data, setData] = useState(null);
  const [viewId, setViewId] = useState(null);
  const [reqs, setReqs] = useState([]);
  const load = () => { hrApi('/my-interviews').then(setData).catch(() => setData({ jobs: [] })); hrApi('/my-schedule-requests').then((r) => setReqs(r.requests || [])).catch(() => {}); };
  useEffect(() => { load(); }, []);
  const confirmSlots = async (candidateId, slotIds) => { try { await hrApi(`/candidates/${candidateId}/self-schedule/confirm`, { method: 'POST', body: JSON.stringify({ slotIds }) }); load(); } catch (e) { alert(e.message); } };
  if (viewId) return <HrCandidateView candidateId={viewId} onBack={() => { setViewId(null); load(); }} />;
  if (!data) return <div className="text-slate-400 text-sm">Loading…</div>;
  const jobs = data.jobs || [];
  return (
    <div>
      <h1 className="text-2xl font-extrabold text-[#050A1F] mb-1">My Interviews</h1>
      <p className="text-sm text-slate-500 mb-6">Candidates you've been assigned to interview. Open a candidate to submit your feedback.</p>

      {reqs.length > 0 && (
        <div className="mb-6">
          <div className="text-sm font-extrabold text-[#050A1F] mb-2">⏳ Confirm your availability</div>
          <div className="space-y-3">
            {reqs.map((r) => <ConfirmAvailabilityCard key={r.candidateId} req={r} onConfirm={(ids) => confirmSlots(r.candidateId, ids)} />)}
          </div>
        </div>
      )}

      {jobs.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/70 p-12 text-center text-slate-400 text-sm">You have no interview assignments right now.</div>
      ) : jobs.map((j) => (
        <div key={j.jobId || 'none'} className="mb-6">
          <div className="text-sm font-extrabold text-[#050A1F] mb-2">{j.jobTitle}</div>
          <div className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden divide-y divide-slate-50">
            {j.candidates.map((c) => (
              <div key={c.interviewId} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50/60">
                <div>
                  <div className="font-semibold text-slate-700">{c.name}</div>
                  <div className="text-xs text-slate-400">{c.roundLabel || 'Interview'} · {c.at ? new Date(c.at).toLocaleString() : 'TBD'}{c.meetLink ? ' · Google Meet' : ''}</div>
                </div>
                <div className="flex items-center gap-2">
                  {c.meetLink && <a href={c.meetLink} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">Join Meet</a>}
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${c.submitted ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{c.submitted ? 'Feedback submitted' : 'Feedback pending'}</span>
                  <button onClick={() => setViewId(c.candidateId)} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: ORANGE }}>{c.submitted ? 'View' : 'Give feedback'}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
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
  const load = () => hrApi('/mailboxes').then(setData).catch((e) => setErr && setErr(e.message));
  useEffect(() => { load(); }, []);
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
                {isAdmin && <button onClick={() => disconnect(mb)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-500 shrink-0">Disconnect</button>}
              </div>
            ))}
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

function SurveyAdmin({ setErr }) {
  const [tab, setTab] = useState('create'); // create | results
  const [surveys, setSurveys] = useState([]);
  const load = () => hrApi('/surveys').then((r) => setSurveys(r.surveys || [])).catch(() => {});
  useEffect(() => { load(); }, []);
  return (
    <div>
      <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 mb-5 w-max">
        <button onClick={() => setTab('create')} className={`px-4 py-1.5 rounded-md text-xs font-bold ${tab === 'create' ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>Create Survey</button>
        <button onClick={() => setTab('results')} className={`px-4 py-1.5 rounded-md text-xs font-bold ${tab === 'results' ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>Comments &amp; Sentiment Analysis</button>
      </div>
      {tab === 'create' && <SurveyCreate surveys={surveys} reload={load} setErr={setErr} />}
      {tab === 'results' && <SurveyResults surveys={surveys} />}
    </div>
  );
}

function SurveyCreate({ surveys, reload, setErr }) {
  const [template, setTemplate] = useState('employee_mood');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [frequency, setFrequency] = useState('one_time');
  const [questions, setQuestions] = useState([{ id: 'q1', text: 'Our workplace is free from distraction', type: 'scale5', comment: true, options: [] }]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const Q_TYPES = [['scale5', 'Rating scale (1–5)'], ['single_choice', 'Multiple choice (pick one)'], ['multi_choice', 'Multiple choice (pick many)'], ['short_answer', 'Short answer']];
  const addQ = () => setQuestions((qs) => [...qs, { id: `q${Date.now()}`, text: '', type: 'scale5', comment: false, options: [] }]);
  const patchQ = (i, patch) => setQuestions((qs) => qs.map((q, idx) => idx === i ? { ...q, ...patch } : q));
  const delQ = (i) => setQuestions((qs) => qs.filter((_, idx) => idx !== i));
  const setOpt = (qi, oi, val) => setQuestions((qs) => qs.map((q, idx) => idx === qi ? { ...q, options: q.options.map((o, j) => j === oi ? val : o) } : q));
  const addOpt = (qi) => setQuestions((qs) => qs.map((q, idx) => idx === qi ? { ...q, options: [...(q.options || []), ''] } : q));
  const delOpt = (qi, oi) => setQuestions((qs) => qs.map((q, idx) => idx === qi ? { ...q, options: q.options.filter((_, j) => j !== oi) } : q));

  const validQuestions = () => questions.filter((q) => {
    if (!q.text.trim()) return false;
    if ((q.type === 'single_choice' || q.type === 'multi_choice') && (q.options || []).filter((o) => o.trim()).length < 2) return false;
    return true;
  });

  const launch = async () => {
    setMsg('');
    if (!name.trim()) { setErr && setErr('Survey name is required.'); return; }
    const qs = validQuestions();
    if (!qs.length) { setErr && setErr('Add at least one complete question (choice questions need 2+ options).'); return; }
    setBusy(true);
    try {
      await hrApi('/surveys', { method: 'POST', body: JSON.stringify({ name, description, template, frequency, questions: qs }) });
      setName(''); setDescription(''); setFrequency('one_time'); setQuestions([{ id: 'q1', text: 'Our workplace is free from distraction', type: 'scale5', comment: true, options: [] }]);
      setMsg('Survey launched — employees will be prompted to respond.'); reload();
    } catch (e) { setErr && setErr(e.message); } finally { setBusy(false); }
  };
  const closeSurvey = async (s) => { if (!window.confirm(`Close "${s.name}"? It will stop accepting responses.`)) return; try { await hrApi(`/surveys/${s._id}`, { method: 'PUT', body: JSON.stringify({ status: 'closed' }) }); reload(); } catch (e) { alert(e.message); } };
  const del = async (s) => { if (!window.confirm(`Delete "${s.name}"?`)) return; try { await hrApi(`/surveys/${s._id}`, { method: 'DELETE' }); reload(); } catch (e) { alert(e.message); } };

  const isChoice = (t) => t === 'single_choice' || t === 'multi_choice';

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div>
        {msg && <div className="mb-4 rounded-lg bg-green-50 border border-green-200 px-3 py-2.5 text-sm text-green-700">{msg}</div>}
        <div className="text-sm font-bold text-[#050A1F] mb-2">Select a template</div>
        <div className="space-y-2 mb-5">
          {SURVEY_TEMPLATES.map((t) => (
            <button key={t.id} disabled={!t.available} onClick={() => t.available && setTemplate(t.id)}
              className={`w-full text-left rounded-xl border p-3 transition ${template === t.id && t.available ? 'border-orange-400 bg-orange-50' : 'border-slate-200'} ${!t.available ? 'opacity-60 cursor-not-allowed' : 'hover:border-slate-300'}`}>
              <div className="flex items-center justify-between">
                <span className="font-bold text-[#050A1F] text-sm">{t.name}</span>
                {!t.available && <span className="text-[10px] font-bold rounded-full bg-slate-200 text-slate-500 px-2 py-0.5">Coming Soon</span>}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">{t.desc}</div>
            </button>
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/70 p-5 space-y-3">
          <div><div className="text-xs font-bold text-slate-500 mb-1">Survey name</div><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. August Mood Check" /></div>
          <div><div className="text-xs font-bold text-slate-500 mb-1">Survey description</div><textarea className={inputCls} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A short note shown to employees." /></div>
          <div><div className="text-xs font-bold text-slate-500 mb-1">Frequency</div>
            <div className="flex gap-2">
              {[['one_time', 'One-time'], ['weekly', 'Weekly'], ['monthly', 'Monthly']].map(([v, l]) => (
                <button key={v} onClick={() => setFrequency(v)} className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${frequency === v ? 'border-orange-400 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-500'}`}>{l}</button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-bold text-slate-500 mb-2">Questions</div>
            <div className="space-y-3">
              {questions.map((q, i) => (
                <div key={q.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start gap-2">
                    <span className="text-slate-300 text-sm pt-2.5 font-bold">{i + 1}.</span>
                    <div className="flex-1 space-y-2">
                      <textarea className={inputCls} rows={1} value={q.text} onChange={(e) => patchQ(i, { text: e.target.value })} placeholder="Question text" />
                      <div className="flex items-center gap-2 flex-wrap">
                        <select className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600" value={q.type} onChange={(e) => patchQ(i, { type: e.target.value, options: isChoice(e.target.value) && !(q.options || []).length ? ['', ''] : q.options })}>
                          {Q_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500"><input type="checkbox" checked={!!q.comment} onChange={(e) => patchQ(i, { comment: e.target.checked })} /> Ask for a comment/note</label>
                        {q.type === 'scale5' && <span className="text-[10px] text-slate-400">Low scores (≤3) trigger AI follow-ups</span>}
                      </div>

                      {isChoice(q.type) && (
                        <div className="rounded-lg bg-slate-50 border border-slate-100 p-2.5">
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">Options</div>
                          <div className="space-y-1.5">
                            {(q.options || []).map((o, oi) => (
                              <div key={oi} className="flex items-center gap-2">
                                <span className="text-slate-300 text-xs">{q.type === 'multi_choice' ? '☐' : '○'}</span>
                                <input className={inputCls + ' py-1.5'} value={o} onChange={(e) => setOpt(i, oi, e.target.value)} placeholder={`Option ${oi + 1}`} />
                                <button onClick={() => delOpt(i, oi)} className="text-slate-300 hover:text-red-500"><Icon.Trash size={14} /></button>
                              </div>
                            ))}
                          </div>
                          <button onClick={() => addOpt(i)} className="text-[11px] font-bold text-[#FF4500] mt-1.5">+ Add option</button>
                        </div>
                      )}
                    </div>
                    {questions.length > 1 && <button onClick={() => delQ(i)} className="text-slate-300 hover:text-red-500 pt-2"><Icon.Trash size={16} /></button>}
                  </div>
                </div>
              ))}
            </div>
            <button onClick={addQ} className="text-xs font-bold text-[#FF4500] mt-3">+ Add question</button>
          </div>
          <div className="pt-1"><button onClick={launch} disabled={busy} className="rounded-lg px-6 py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Launching…' : 'Launch Survey'}</button></div>
        </div>
      </div>

      {/* Live surveys */}
      <div>
        <div className="text-sm font-bold text-[#050A1F] mb-2">Active &amp; recent surveys</div>
        {surveys.length === 0 ? <div className="bg-white rounded-2xl border border-slate-200/70 p-8 text-center text-slate-400 text-sm">No surveys yet.</div> : (
          <div className="space-y-2">
            {surveys.map((s) => (
              <div key={s._id} className="bg-white rounded-xl border border-slate-200/70 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-bold text-[#050A1F] text-sm">{s.name}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{s.frequency.replace('_', '-')} · {(s.questions || []).length} question{(s.questions || []).length === 1 ? '' : 's'} · {s.status === 'active' ? <span className="text-green-600 font-bold">Active</span> : <span className="text-slate-400">Closed</span>} · {s.responseCount || 0} responses this period</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {s.status === 'active' && <button onClick={() => closeSurvey(s)} className="text-xs font-bold text-slate-500 border border-slate-200 rounded-lg px-2.5 py-1.5">Close</button>}
                    <button onClick={() => del(s)} className="text-slate-300 hover:text-red-500"><Icon.Trash size={16} /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SentimentCircle({ label, pct, color }) {
  const r = 34, c = 2 * Math.PI * r, off = c - (pct / 100) * c;
  return (
    <div className="bg-white rounded-2xl border border-slate-200/70 p-5 flex flex-col items-center">
      <svg width="90" height="90" viewBox="0 0 90 90" className="mb-2">
        <circle cx="45" cy="45" r={r} fill="none" stroke="#F1F5F9" strokeWidth="9" />
        <circle cx="45" cy="45" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 45 45)" />
        <text x="45" y="50" textAnchor="middle" className="font-extrabold" style={{ fontSize: 20, fill: '#050A1F' }}>{pct}%</text>
      </svg>
      <div className="text-sm font-bold text-[#050A1F]">{label}</div>
    </div>
  );
}

function SurveyResults({ surveys }) {
  const [surveyId, setSurveyId] = useState('');
  const [periods, setPeriods] = useState([]);
  const [period, setPeriod] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  useEffect(() => { if (!surveyId && surveys.length) setSurveyId(String(surveys[0]._id)); }, [surveys]);
  useEffect(() => { if (!surveyId) return; hrApi(`/surveys/${surveyId}/periods`).then((r) => { setPeriods(r.periods || []); setPeriod((r.periods && r.periods[0]) || ''); }).catch(() => {}); }, [surveyId]);
  const loadResults = () => { if (!surveyId) return; setBusy(true); hrApi(`/surveys/${surveyId}/results${period ? `?period=${encodeURIComponent(period)}` : ''}`).then(setData).catch(() => {}).finally(() => setBusy(false)); };
  useEffect(() => { loadResults(); }, [surveyId, period]);
  const analyze = async () => { setAnalyzing(true); try { await hrApi(`/surveys/${surveyId}/analyze`, { method: 'POST', body: JSON.stringify({ period }) }); loadResults(); } catch (e) { alert(e.message); } finally { setAnalyzing(false); } };

  if (!surveys.length) return <div className="bg-white rounded-2xl border border-slate-200/70 p-8 text-center text-slate-400 text-sm">Create a survey first.</div>;
  return (
    <div>
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <select value={surveyId} onChange={(e) => setSurveyId(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">
          {surveys.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
        </select>
        {periods.length > 0 && <select value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">
          {periods.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>}
        <button onClick={analyze} disabled={analyzing || !data || data.total === 0} className="ml-auto rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: '#050A1F' }}>{analyzing ? 'Analysing…' : '✨ Analyse with AI'}</button>
      </div>

      {busy ? <div className="text-slate-400 text-sm">Loading…</div> : !data ? null : data.total === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/70 p-8 text-center text-slate-400 text-sm">No responses yet for this period.</div>
      ) : (
        <div className="space-y-6">
          <div className="text-xs text-slate-400">{data.total} response{data.total === 1 ? '' : 's'} · {data.analysed} analysed{data.analysedAt ? ` · last analysed ${new Date(data.analysedAt).toLocaleString()}` : ''}</div>
          {data.analysed === 0 && <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-sm text-amber-700">Click “Analyse with AI” to decode sentiment and surface themes from the responses.</div>}

          {/* Sentiment circles */}
          <div className="grid grid-cols-3 gap-4">
            <SentimentCircle label="Positive Sentiment" pct={data.sentiment.positive} color="#16A34A" />
            <SentimentCircle label="Neutral Sentiment" pct={data.sentiment.neutral} color="#F59E0B" />
            <SentimentCircle label="Negative Sentiment" pct={data.sentiment.negative} color="#DC2626" />
          </div>

          {(data.summary || data.good.length || data.improve.length) && (
            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-white rounded-2xl border border-green-100 p-5">
                <div className="text-sm font-extrabold text-green-700 mb-2">Top 3 good points</div>
                <ul className="space-y-1.5">{(data.good.length ? data.good : ['—']).map((g, i) => <li key={i} className="text-sm text-slate-600 flex gap-2"><span className="text-green-500">✔</span>{g}</li>)}</ul>
              </div>
              <div className="bg-white rounded-2xl border border-amber-100 p-5">
                <div className="text-sm font-extrabold text-amber-700 mb-2">Top 3 to improve</div>
                <ul className="space-y-1.5">{(data.improve.length ? data.improve : ['—']).map((g, i) => <li key={i} className="text-sm text-slate-600 flex gap-2"><span className="text-amber-500">▲</span>{g}</li>)}</ul>
              </div>
            </div>
          )}
          {data.summary && <div className="bg-white rounded-2xl border border-slate-200/70 p-5 text-sm text-slate-600"><b className="text-[#050A1F]">Overall mood:</b> {data.summary}</div>}

          {/* Breakdowns */}
          <SentimentBreakdown title="By department" rows={data.byDepartment} />
          <SentimentBreakdown title="By branch" rows={data.byBranch} />
        </div>
      )}
    </div>
  );
}

function SentimentBreakdown({ title, rows }) {
  if (!rows || !rows.length) return null;
  return (
    <div className="bg-white rounded-2xl border border-slate-200/70 p-5">
      <div className="text-sm font-extrabold text-[#050A1F] mb-3">{title}</div>
      <div className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-3">
            <div className="w-32 truncate text-sm font-semibold text-slate-600">{r.key}</div>
            <div className="flex-1 h-4 rounded-full overflow-hidden flex bg-slate-100">
              <div style={{ width: `${r.positive}%`, background: '#16A34A' }} title={`Positive ${r.positive}%`} />
              <div style={{ width: `${r.neutral}%`, background: '#F59E0B' }} title={`Neutral ${r.neutral}%`} />
              <div style={{ width: `${r.negative}%`, background: '#DC2626' }} title={`Negative ${r.negative}%`} />
            </div>
            <div className="text-xs text-slate-400 w-24 text-right">{r.count} resp · {r.avgScore != null ? `${r.avgScore}/5` : '—'}</div>
          </div>
        ))}
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

      {/* Recruitment mailbox */}
      <div>
        <div className="text-sm font-bold text-[#050A1F] mb-3">Recruitment mailbox</div>
        <RecruitmentMailbox isAdmin={isAdmin} setErr={setErr} />
      </div>

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

  const TABS = [['org', 'Organization'], ['shifts', 'Shifts'], ['holidays', 'Holidays'], ['careers', 'Careers Page'], ['surveys', 'Survey'], ['settings', 'Settings'], ['logs', 'Logs']];

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
            <div className="text-sm font-bold text-[#050A1F] mb-3">Organization chart</div>
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
      {tab === 'holidays' && <HolidaysManager holidays={holidays} branches={branches} reload={load} setErr={setErr} />}

      {/* SETTINGS TAB (auto-score + recruitment mailbox + API) */}
      {tab === 'surveys' && <SurveyAdmin setErr={setErr} />}
      {tab === 'settings' && <HrSettingsTab isAdmin={!!user.isAdmin} setErr={setErr} />}
      {tab === 'logs' && <HrLogsTab />}
      {tab === 'careers' && <HrCareersTab />}

      {showAdd && <AddUserModal branches={branches} departments={departments} reportingOptions={reportingOptions} shifts={shifts} imagekitReady={imagekitReady} onClose={() => setShowAdd(false)} onCreated={(n) => { setMsg(`User created: ${n}`); load(); }} />}
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
      {roots.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="text-[11px] text-slate-400 uppercase tracking-wide font-bold mb-2">Unassigned (no reporting manager)</div>
          {roots.map((n) => <Node key={n._id} n={n} depth={0} />)}
        </div>
      )}
      {active.length === 0 && <div className="text-slate-400 text-sm text-center py-8">No active employees to chart yet.</div>}
    </div>
  );
}

// Employee-facing survey prompt: a popup on load; if dismissed, a persistent
// top banner until completed. Fills the pending survey via SurveyTakeModal.
function SurveyGate() {
  const [pending, setPending] = useState([]);
  const [openIdx, setOpenIdx] = useState(-1);
  const [popupShown, setPopupShown] = useState(false);
  useEffect(() => { hrApi('/surveys/pending').then((r) => { setPending(r.pending || []); if ((r.pending || []).length && !popupShown) { setOpenIdx(0); setPopupShown(true); } }).catch(() => {}); }, []);
  const current = openIdx >= 0 ? pending[openIdx] : null;
  const done = (id) => { setPending((ps) => ps.filter((p) => p._id !== id)); setOpenIdx(-1); };
  if (!pending.length) return null;
  return (
    <>
      {openIdx < 0 && (
        <div className="bg-gradient-to-r from-[#FF6A00] to-[#FF4500] text-white">
          <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
            <div className="text-sm font-semibold flex items-center gap-2">📝 You have {pending.length} pending survey{pending.length === 1 ? '' : 's'} to complete.</div>
            <button onClick={() => setOpenIdx(0)} className="rounded-lg bg-white/20 hover:bg-white/30 px-3 py-1.5 text-xs font-bold">Complete now</button>
          </div>
        </div>
      )}
      {current && <SurveyTakeModal survey={current} onClose={() => setOpenIdx(-1)} onDone={() => done(current._id)} />}
    </>
  );
}

function SurveyTakeModal({ survey, onClose, onDone }) {
  const [answers, setAnswers] = useState({}); // qid -> {score|choice|choices|text, comment}
  const [phase, setPhase] = useState('main'); // main | followups | done
  const [followupQs, setFollowupQs] = useState([]);
  const [followupA, setFollowupA] = useState({}); // fid -> 'Yes'|'No'
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const patch = (qid, p) => setAnswers((a) => ({ ...a, [qid]: { ...(a[qid] || {}), ...p } }));
  const toggleChoice = (qid, opt) => setAnswers((a) => { const cur = (a[qid] && a[qid].choices) || []; const next = cur.includes(opt) ? cur.filter((c) => c !== opt) : [...cur, opt]; return { ...a, [qid]: { ...(a[qid] || {}), choices: next } }; });

  const isAnswered = (q) => {
    const a = answers[q.id] || {};
    if (q.type === 'scale5') return !!a.score;
    if (q.type === 'single_choice') return a.choice != null && a.choice !== '';
    if (q.type === 'multi_choice') return Array.isArray(a.choices) && a.choices.length > 0;
    if (q.type === 'short_answer') return !!(a.text && a.text.trim());
    return true;
  };
  const allAnswered = (survey.questions || []).every(isAnswered);
  const anyLow = (survey.questions || []).some((q) => q.type === 'scale5' && (answers[q.id] || {}).score && answers[q.id].score <= 3);

  const proceed = async () => {
    setErr('');
    if (!allAnswered) { setErr('Please answer every question.'); return; }
    // After all questions, if any 1–5 answer is low, fetch adaptive follow-ups.
    if (anyLow && phase === 'main') {
      setBusy(true);
      try {
        const r = await hrApi(`/surveys/${survey._id}/followups`, { method: 'POST', body: JSON.stringify({ answers }) });
        if (r.questions && r.questions.length) { setFollowupQs(r.questions); setPhase('followups'); setBusy(false); return; }
      } catch {}
      setBusy(false);
    }
    submit();
  };

  const submit = async () => {
    setBusy(true); setErr('');
    const followups = followupQs.map((q) => ({ question: q.text, answer: followupA[q.id] || 'No answer' }));
    try {
      const r = await hrApi(`/surveys/${survey._id}/respond`, { method: 'POST', body: JSON.stringify({ answers, followups }) });
      setSuccessMsg(r.message || 'Thank you for your feedback!'); setPhase('done');
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  const renderQuestion = (q, i) => {
    const a = answers[q.id] || {};
    return (
      <div key={q.id} className="mb-5">
        <div className="text-sm font-bold text-[#050A1F] mb-2">{i + 1}. {q.text}</div>

        {q.type === 'scale5' && (
          <>
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => patch(q.id, { score: n })}
                  className={`w-11 h-11 rounded-lg font-extrabold text-white transition ${a.score === n ? 'ring-2 ring-offset-2 ring-slate-400 scale-105' : 'opacity-80 hover:opacity-100'}`}
                  style={{ background: SCALE_COLORS[n - 1] }}>{n}</button>
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 mt-1 px-1"><span>Strongly Disagree</span><span>Strongly Agree</span></div>
          </>
        )}

        {q.type === 'single_choice' && (
          <div className="space-y-1.5">
            {(q.options || []).map((opt) => (
              <button key={opt} onClick={() => patch(q.id, { choice: opt })}
                className={`w-full text-left flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm ${a.choice === opt ? 'border-[#FF6A00] bg-orange-50 text-orange-700 font-bold' : 'border-slate-200 text-slate-600'}`}>
                <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${a.choice === opt ? 'border-[#FF6A00]' : 'border-slate-300'}`}>{a.choice === opt && <span className="w-2 h-2 rounded-full bg-[#FF6A00]" />}</span>{opt}
              </button>
            ))}
          </div>
        )}

        {q.type === 'multi_choice' && (
          <div className="space-y-1.5">
            {(q.options || []).map((opt) => { const on = ((a.choices) || []).includes(opt); return (
              <button key={opt} onClick={() => toggleChoice(q.id, opt)}
                className={`w-full text-left flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm ${on ? 'border-[#FF6A00] bg-orange-50 text-orange-700 font-bold' : 'border-slate-200 text-slate-600'}`}>
                <span className={`w-4 h-4 rounded border-2 flex items-center justify-center ${on ? 'border-[#FF6A00] bg-[#FF6A00]' : 'border-slate-300'}`}>{on && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4"><path d="M20 6L9 17l-5-5" /></svg>}</span>{opt}
              </button>
            ); })}
          </div>
        )}

        {q.type === 'short_answer' && (
          <textarea className={inputCls} rows={2} placeholder="Your answer" value={a.text || ''} onChange={(e) => patch(q.id, { text: e.target.value })} />
        )}

        {q.comment && q.type !== 'short_answer' && (
          <textarea className={inputCls + ' mt-2'} rows={2} placeholder="Write your comment (optional)" value={a.comment || ''} onChange={(e) => patch(q.id, { comment: e.target.value })} />
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[140] p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div>
            <div className="text-lg font-extrabold text-[#050A1F]">{survey.name}</div>
            {survey.description && phase !== 'done' && <div className="text-xs text-slate-400 mt-0.5">{survey.description}</div>}
          </div>
          {phase !== 'done' && <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>}
        </div>

        <div className="p-6 overflow-y-auto">
          {err && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{err}</div>}

          {phase === 'main' && (survey.questions || []).map((q, i) => renderQuestion(q, i))}

          {phase === 'followups' && (
            <div>
              <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-blue-700 mb-4">Thanks for your honesty. A couple of quick yes/no questions to help us understand better.</div>
              {followupQs.map((q) => (
                <div key={q.id} className="mb-4">
                  <div className="text-sm font-bold text-[#050A1F] mb-2">{q.text}</div>
                  <div className="flex gap-2">
                    {['Yes', 'No'].map((opt) => (
                      <button key={opt} onClick={() => setFollowupA((a) => ({ ...a, [q.id]: opt }))}
                        className={`px-5 py-2 rounded-lg text-sm font-bold border ${followupA[q.id] === opt ? 'border-[#FF6A00] bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-500'}`}>{opt}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {phase === 'done' && (
            <div className="text-center py-6">
              <div className="text-4xl mb-3">💬</div>
              <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{successMsg}</div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2 shrink-0">
          {phase === 'main' && <button onClick={proceed} disabled={busy} className="rounded-lg px-6 py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Please wait…' : 'Submit response'}</button>}
          {phase === 'followups' && <button onClick={submit} disabled={busy} className="rounded-lg px-6 py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Submitting…' : 'Submit response'}</button>}
          {phase === 'done' && <button onClick={onDone} className="rounded-lg px-6 py-2.5 text-sm font-bold text-white" style={{ background: '#050A1F' }}>Close</button>}
        </div>
      </div>
    </div>
  );
}

export default function HrApp() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [view, setView] = useState('dashboard');
  const [profileTarget, setProfileTarget] = useState(null);
  const [navKey, setNavKey] = useState(0); // bump to force a fresh sub-view on nav

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
  const nav = [
    ...(isScheduler ? [{ id: 'dashboard', label: 'Dashboard' }] : []),
    { id: 'recruitment', label: 'Recruitment' },
    { id: 'interview', label: 'Interview' },
    ...(isScheduler ? [{ id: 'email', label: 'Email' }] : []),
    { id: 'employees', label: 'Employee' },
    ...(isAdmin ? [{ id: 'admin', label: 'Admin' }] : []),
  ];
  // Land non-schedulers on their interviews rather than an empty dashboard.
  const effectiveView = (view === 'dashboard' && !isScheduler) ? 'interview' : view;

  return (
    <div className="min-h-screen bg-slate-50" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <header className="bg-[#050A1F] text-white">
        <div className="max-w-6xl mx-auto px-4 flex items-center justify-between h-14">
          <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="text-lg font-extrabold tracking-tight">Qtonix<span className="text-[#FF6A00]">.</span></div>
            <AppSwitcher current="hr" />
          </div>
            <nav className="flex gap-0.5">
              {nav.map((n) => (
                <button key={n.id} onClick={() => { setView(n.id); setProfileTarget(null); setNavKey((k) => k + 1); }}
                  className={`rounded-lg px-3 py-2 text-xs font-bold transition-colors ${effectiveView === n.id ? 'text-[#FF6A00]' : 'text-slate-400 hover:text-white'}`}>
                  {n.label}
                </button>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell onOpenCandidate={(id) => { setView('recruitment'); setNavKey((k) => k + 1); }} />
            <UserMenu user={user} onNavigate={(v) => { setView(v); setProfileTarget(null); setNavKey((k) => k + 1); }} onLogout={logout} isAdmin={isAdmin} />
          </div>
        </div>
      </header>
      {!isAdmin && <SurveyGate />}
      <main className="max-w-6xl mx-auto px-4 py-8" key={`${effectiveView}-${navKey}`}>
        {effectiveView === 'dashboard' && <HrDashboard user={user} isAdmin={isAdmin} onOpenCandidate={(id) => { setView('recruitment'); setNavKey((k) => k + 1); }} />}
        {effectiveView === 'recruitment' && <HrRecruitment isAdmin={isAdmin} me={user} />}
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
              {items.length > 0 && <button onClick={markAll} className="text-[11px] font-bold text-orange-600">Mark all read</button>}
            </div>
            <div className="max-h-96 overflow-auto">
              {items.length === 0 ? <div className="px-4 py-8 text-center text-slate-400 text-sm">You're all caught up.</div> : items.map((n) => (
                <button key={n._id} onClick={() => { setOpen(false); if (n.candidateId && onOpenCandidate) onOpenCandidate(n.candidateId); }}
                  className={`w-full text-left px-4 py-3 border-b border-slate-50 hover:bg-slate-50 flex gap-3 ${n.read ? '' : 'bg-orange-50/40'}`}>
                  <span className="text-lg leading-none">{icon(n.type)}</span>
                  <div className="min-w-0">
                    <div className="text-sm text-slate-700">{n.text}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{timeAgo(n.createdAt)}</div>
                  </div>
                </button>
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

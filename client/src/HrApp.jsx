import React, { useState, useEffect } from 'react';
import { API_BASE } from './config.js';
import { AddUserModal, ImageKitSection, ProfilePage, EmployeeDirectory, Field as SharedField, Avatar, ROLE_LABELS, ROLE_OPTIONS, ROLE_LEVEL, Icon } from './HrParts.jsx';
import HrJobBuilder from './HrJobBuilder.jsx';
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

function HrDashboard({ user }) {
  const [data, setData] = useState(null);
  useEffect(() => { hrApi('/dashboard').then(setData).catch(() => setData({ metrics: {} })); }, []);
  const m = (data && data.metrics) || {};
  return (
    <div>
      <h1 className="text-2xl font-extrabold text-[#050A1F]">{greeting()}, {user.name}!</h1>
      <p className="text-slate-500 text-sm mt-1 mb-6">Here's your HR overview.</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[['HR staff', m.staff], ['Open jobs', m.openJobs], ['Candidates', m.candidates], ['Onboarded', m.onboarded]].map(([label, val]) => (
          <div key={label} className="bg-white rounded-2xl border border-slate-200/70 p-5">
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
            <div className="text-3xl font-extrabold mt-1 text-[#050A1F]">{val ?? '—'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Recruitment -----------------------------------------------------------

function HrRecruitment({ isAdmin }) {
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
        {tab === 'jobs' && <button onClick={() => startBuilder(null)} className="rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ background: ORANGE }}>+ Post a Job</button>}
      </div>
      {err && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm px-3 py-2">{err}</div>}
      <div className="inline-flex items-center gap-1 bg-slate-100 rounded-lg p-1 mb-6">
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => { setTab(id); if (id !== 'candidates') setCandFilterJob(null); }}
            className={`px-4 py-1.5 rounded-md text-xs font-bold ${tab === id ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>{label}</button>
        ))}
      </div>
      {tab === 'jobs' && <JobList jobs={jobs} isAdmin={isAdmin} onEdit={(j) => startBuilder(j)} reload={loadJobs} onViewApplicants={viewApplicants} />}
      {tab === 'candidates' && <CandidateList jobs={jobs} initialJobFilter={candFilterJob} />}
      {tab === 'pipeline' && <RecruitPipeline jobs={jobs} />}
    </div>
  );
}

// Read a File as a base64 data URL for server-side extraction/upload.
export function fileToBase64(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}

function JobList({ jobs, isAdmin, onEdit, reload, onViewApplicants }) {
  const [addFor, setAddFor] = useState(null); // job to add a candidate to
  const [shareFor, setShareFor] = useState(null); // job to share
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
  if (!jobs.length) return <div className="bg-white rounded-2xl border border-slate-200/70 p-12 text-center text-slate-400 text-sm">No job posts yet. Click “Post a Job” to create one.</div>;
  return (
    <div className="space-y-3">
      {jobs.map((j) => {
        const sp = statusPill(j.status);
        const live = j.status === 'published' || j.status === 'paused';
        const published = fmtDate(j.publishedAt);
        return (
        <div key={j._id} className="bg-white rounded-2xl border border-slate-200/70 p-4 flex items-center justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="text-base font-extrabold text-[#050A1F]">{j.title}</div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${sp.cls}`}>{sp.label}</span>
            </div>
            <div className="text-xs text-slate-500 mt-0.5">{(j.locations || []).join(' · ') || '—'} · {j.department || 'No dept'} · {j.openings || 1} opening(s)</div>
            <div className="flex items-center gap-3 text-xs text-slate-400 mt-1">
              {published && <span>Published {published}</span>}
              <button onClick={() => onViewApplicants(j._id)} className="font-bold text-orange-600 hover:text-orange-700 hover:underline">
                {j.applicantCount || 0} candidate{(j.applicantCount || 0) === 1 ? '' : 's'} applied
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {live && <JobIconBtn primary onClick={() => setAddFor(j)} icon="user-plus" label="Add candidate" />}
            {j.status === 'published' && <JobIconBtn onClick={() => setShareFor(j)} icon="link" label="Share / embed" />}
            <JobIconBtn onClick={() => onEdit(j)} icon="edit" label="Edit job post" />
            {live && <JobIconBtn onClick={() => pause(j)} icon={j.status === 'paused' ? 'play' : 'pause'} label={j.status === 'paused' ? 'Resume job' : 'Pause job'} />}
            {j.status !== 'closed' && <JobIconBtn onClick={() => close(j)} icon="close" label="Close job" />}
            {isAdmin && <JobIconBtn danger onClick={() => del(j)} icon="trash" label="Delete job post" />}
          </div>
        </div>
        );
      })}
      {addFor && <AddCandidateModal job={addFor} onClose={() => setAddFor(null)} onSaved={() => { setAddFor(null); reload(); }} />}
      {shareFor && <ShareJobModal job={shareFor} onClose={() => setShareFor(null)} />}
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

function CandidateList({ jobs, initialJobFilter }) {
  const [cands, setCands] = useState([]);
  const [viewId, setViewId] = useState(null);
  const [notesFor, setNotesFor] = useState(null);
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

  if (viewId) return <HrCandidateView candidateId={viewId} onBack={() => { setViewId(null); load(q); }} />;

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

      {!filtered.length ? (
        <div className="bg-white rounded-2xl border border-slate-200/70 p-12 text-center text-slate-400 text-sm">{cands.length ? 'No candidates match these filters.' : 'No candidates yet.'}</div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <th className="px-4 py-3">Candidate</th><th className="px-4 py-3">Phone</th><th className="px-4 py-3">Position</th>
                <th className="px-4 py-3">Experience</th><th className="px-4 py-3">Current Salary</th><th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Recruiter</th><th className="px-4 py-3">Last update</th><th className="px-4 py-3 text-right">Actions</th>
              </tr></thead>
              <tbody>
                {filtered.map((c) => {
                  const a = c.answers || {}; const st = stageLabel(c);
                  return (
                    <tr key={c._id} className="border-b border-slate-50 hover:bg-slate-50/60">
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
                      <td className="px-4 py-3"><span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: st.color + '18', color: st.color }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: st.color }} />{st.label}</span></td>
                      <td className="px-4 py-3 text-slate-500">{c.recruiterName || '—'}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{timeAgo(c.updatedAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <CandIconBtn icon="eye" label="View candidate" onClick={() => setViewId(c._id)} />
                          <CandIconBtn icon="note" label="Add note" onClick={() => setNotesFor(c._id)} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {notesFor && <QuickNoteModal candidateId={notesFor} onClose={() => setNotesFor(null)} onSaved={() => { setNotesFor(null); load(); }} />}
    </div>
  );
}

function CandIconBtn({ icon, label, onClick }) {
  const paths = {
    eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z',
    // A speech-bubble note icon (distinct from the edit/pencil used elsewhere).
    note: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  };
  const extra = icon === 'eye' ? <circle cx="12" cy="12" r="3" /> : null;
  return (
    <button onClick={onClick} title={label} aria-label={label} className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50 transition">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={paths[icon]} />{extra}</svg>
    </button>
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
        jobPostId: job._id, resumeUrl: c.resumeUrl, currentLocation: c.city || c.address, resumeText,
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
  const load = () => { if (jobId) hrApi(`/candidates?jobPostId=${jobId}`).then(setCands).catch(() => {}); };
  useEffect(() => { load(); }, [jobId]);
  const job = jobs.find((j) => j._id === jobId);
  const stages = (job && job.stages) || [];
  const move = async (c, stage) => {
    if (c.stage === stage) return;
    setCands((cs) => cs.map((x) => x._id === c._id ? { ...x, stage } : x));
    try { await hrApi(`/candidates/${c._id}/stage`, { method: 'PATCH', body: JSON.stringify({ stage }) }); } catch (e) { alert(e.message); load(); }
  };
  if (!published.length) return <div className="bg-white rounded-2xl border border-slate-200/70 p-12 text-center text-slate-400 text-sm">Publish a job to see its pipeline.</div>;
  if (viewId) return <HrCandidateView candidateId={viewId} onBack={() => { setViewId(null); load(); }} />;
  const softBg = (hex) => `${hex}14`;
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <select className={inp + ' max-w-xs'} value={jobId || ''} onChange={(e) => setJobId(Number(e.target.value))}>
          {published.map((j) => <option key={j._id} value={j._id}>{j.title}</option>)}
        </select>
        <div className="text-sm text-slate-400">{cands.length} candidates · drag a card to move it between stages</div>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {stages.map((s) => {
          const col = cands.filter((c) => c.stage === s.id && !c.rejected);
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
              <div className="space-y-3 min-h-[160px]">
                {col.map((c) => {
                  const a = c.answers || {};
                  return (
                    <div key={c._id} draggable
                      onDragStart={() => setDragId(c._id)}
                      onClick={() => setViewId(c._id)}
                      className="bg-white rounded-2xl border border-slate-100 p-4 cursor-grab active:cursor-grabbing hover:shadow-lg hover:-translate-y-0.5 transition-all">
                      <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-md mb-2" style={{ background: c.source === 'public_form' ? '#E7F6EF' : '#EEF2FF', color: c.source === 'public_form' ? '#0F9D58' : '#4F46E5' }}>{c.source === 'public_form' ? 'Applied' : 'Sourced'}</span>
                      <div className="font-extrabold text-sm text-[#050A1F] leading-snug">{c.name}</div>
                      {c.email && <div className="text-[11px] text-slate-400 mt-0.5 truncate">{c.email}</div>}
                      <div className="flex items-center gap-2 mt-2 text-[11px] text-slate-500">
                        {totalExperience(c) !== '—' && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-semibold">{totalExperience(c)}</span>}
                        {a.currentCtc && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-semibold">{a.currentCtc}</span>}
                      </div>
                      <div className="flex items-center justify-between mt-3">
                        <div className="flex items-center gap-1.5">
                          <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold flex items-center justify-center">{(c.recruiterName || c.name || '?').trim()[0]?.toUpperCase()}</span>
                          <span className="text-[10px] text-slate-400">{c.recruiterName || ''}</span>
                        </div>
                        <span className="text-[10px] text-slate-400">{timeAgo(c.updatedAt)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Panelist view: interviews assigned to me, grouped by job, with a way to open
// the candidate and submit feedback.
function MyInterviews() {
  const [data, setData] = useState(null);
  const [viewId, setViewId] = useState(null);
  const load = () => hrApi('/my-interviews').then(setData).catch(() => setData({ jobs: [] }));
  useEffect(() => { load(); }, []);
  if (viewId) return <HrCandidateView candidateId={viewId} onBack={() => { setViewId(null); load(); }} />;
  if (!data) return <div className="text-slate-400 text-sm">Loading…</div>;
  const jobs = data.jobs || [];
  return (
    <div>
      <h1 className="text-2xl font-extrabold text-[#050A1F] mb-1">My Interviews</h1>
      <p className="text-sm text-slate-500 mb-6">Candidates you've been assigned to interview. Open a candidate to submit your feedback.</p>
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

// Email templates & signature live behind the user menu. Full management ships
// in the next phase; these give the menu real destinations now.
function EmailTemplatesPage() {
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-extrabold text-[#050A1F] mb-1">Email Templates</h1>
      <p className="text-sm text-slate-500 mb-6">Reusable recruitment email templates (offer, rejection, interview invite) will be managed here.</p>
      <div className="bg-white rounded-2xl border border-slate-200/70 p-8 text-center text-slate-400 text-sm">Template management is coming in the next update.</div>
    </div>
  );
}
function EmailSignaturePage() {
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-extrabold text-[#050A1F] mb-1">Email Signature</h1>
      <p className="text-sm text-slate-500 mb-6">Your personal signature appended to recruitment emails will be managed here.</p>
      <div className="bg-white rounded-2xl border border-slate-200/70 p-8 text-center text-slate-400 text-sm">Signature management is coming in the next update.</div>
    </div>
  );
}
function RecruitmentMailbox({ isAdmin, setErr }) {
  const [status, setStatus] = useState(null);
  const load = () => hrApi('/mailbox/status').then(setStatus).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const connect = async () => {
    try {
      const { url } = await hrApi('/mailbox/connect');
      const w = window.open(url, 'hrmail', 'width=520,height=640');
      const onMsg = (e) => { if (e.data && e.data.gmail) { window.removeEventListener('message', onMsg); setTimeout(load, 800); try { w && w.close(); } catch {} } };
      window.addEventListener('message', onMsg);
    } catch (e) { setErr(e.message); }
  };
  const disconnect = async () => { if (!window.confirm('Unlink the recruitment mailbox? Recruiters will no longer be able to email candidates until it is reconnected.')) return; try { await hrApi('/mailbox/disconnect', { method: 'POST' }); load(); } catch (e) { setErr(e.message); } };
  if (!status) return <Empty>Loading…</Empty>;
  return (
    <div className="max-w-xl">
      <div className="rounded-2xl border border-slate-200 p-6">
        <div className="text-base font-extrabold text-[#050A1F] mb-1">Recruitment mailbox</div>
        <p className="text-sm text-slate-500 mb-4">One shared inbox (e.g. career@qtonix.com) that every recruiter sends from and reads. Candidates always correspond with this single address.</p>
        {status.connected ? (
          <div className="flex items-center justify-between rounded-lg bg-green-50 border border-green-200 px-4 py-3">
            <div><div className="text-sm font-bold text-green-700">✓ Connected</div><div className="text-xs text-slate-500">{status.email}</div></div>
            {isAdmin && <button onClick={disconnect} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-500">Disconnect</button>}
          </div>
        ) : (
          <div>
            {!status.configured && <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm px-3 py-2 mb-3">Google credentials aren't set up yet. Add them in CRM Admin → API keys first.</div>}
            {isAdmin ? (
              <button onClick={connect} disabled={!status.configured} className="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>Connect recruitment mailbox</button>
            ) : (
              <div className="text-sm text-slate-500">Not connected. Ask an admin to link the shared recruitment mailbox.</div>
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

function HrAdmin({ user }) {
  const [tab, setTab] = useState('users');
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

  const TABS = [['users', 'Users'], ['org', 'Organization Chart'], ['branches', 'Branches & Departments'], ['shifts', 'Shifts'], ['holidays', 'Holidays'], ['mailbox', 'Recruitment Mailbox'], ['imagekit', 'ImageKit']];

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
              {edit.type === 'recruiter' && (
                <div className="mt-4 rounded-xl bg-slate-50 p-4"><div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Recruiter targets</div><div className="grid grid-cols-2 gap-4">
                  <SharedField label="Daily interview schedule"><input type="number" className={inputCls} value={edit.targets?.dailyInterviews ?? 0} onChange={(e) => setEdit({ ...edit, targets: { ...edit.targets, dailyInterviews: e.target.value } })} /></SharedField>
                  <SharedField label="Monthly closing / onboarding"><input type="number" className={inputCls} value={edit.targets?.monthlyOnboarding ?? 0} onChange={(e) => setEdit({ ...edit, targets: { ...edit.targets, monthlyOnboarding: e.target.value } })} /></SharedField>
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
      {tab === 'org' && <HrOrgChart users={users} reporting={reporting} />}

      {/* BRANCHES & DEPARTMENTS TAB */}
      {tab === 'branches' && (
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
      )}

      {/* SHIFTS TAB */}
      {tab === 'shifts' && <ShiftsManager shifts={shifts} reload={load} setErr={setErr} />}

      {/* HOLIDAYS TAB */}
      {tab === 'holidays' && <HolidaysManager holidays={holidays} branches={branches} reload={load} setErr={setErr} />}

      {/* IMAGEKIT TAB */}
      {tab === 'mailbox' && <RecruitmentMailbox isAdmin={!!user.isAdmin} setErr={setErr} />}
      {tab === 'imagekit' && <ImageKitSection />}

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

export default function HrApp() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [view, setView] = useState('dashboard');
  const [profileTarget, setProfileTarget] = useState(null);

  // Restore session.
  useEffect(() => {
    const token = localStorage.getItem(HR_TOKEN_KEY);
    if (!token) { setChecking(false); return; }
    hrApi('/me').then((u) => setUser(u)).catch(() => localStorage.removeItem(HR_TOKEN_KEY)).finally(() => setChecking(false));
  }, []);

  const logout = () => { localStorage.removeItem(HR_TOKEN_KEY); setUser(null); window.location.href = '/hr/login'; };

  if (checking) return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-400 text-sm">Loading…</div>;
  if (!user) return <HrLogin onSignIn={(u) => setUser(u)} />;

  const isAdmin = !!user.isAdmin;
  const nav = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'recruitment', label: 'Recruitment' },
    { id: 'interview', label: 'Interview' },
    { id: 'employees', label: 'Employee' },
    ...(isAdmin ? [{ id: 'admin', label: 'Admin' }] : []),
  ];

  return (
    <div className="min-h-screen bg-slate-50" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <header className="bg-[#050A1F] text-white">
        <div className="max-w-6xl mx-auto px-4 flex items-center justify-between h-14">
          <div className="flex items-center gap-6">
            <div className="text-lg font-extrabold tracking-tight">Qtonix<span className="text-[#FF6A00]">.</span> <span className="text-slate-400 font-bold text-sm">HR</span></div>
            <nav className="flex gap-0.5">
              {nav.map((n) => (
                <button key={n.id} onClick={() => { setView(n.id); setProfileTarget(null); }}
                  className={`rounded-lg px-3 py-2 text-xs font-bold transition-colors ${view === n.id ? 'text-[#FF6A00]' : 'text-slate-400 hover:text-white'}`}>
                  {n.label}
                </button>
              ))}
            </nav>
          </div>
          <UserMenu user={user} onNavigate={(v) => { setView(v); setProfileTarget(null); }} onLogout={logout} isAdmin={isAdmin} />
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-8">
        {view === 'dashboard' && <HrDashboard user={user} />}
        {view === 'recruitment' && <HrRecruitment isAdmin={isAdmin} />}
        {view === 'interview' && <MyInterviews />}
        {view === 'employees' && (
          profileTarget
            ? <div><button onClick={() => setProfileTarget(null)} className="text-xs font-bold text-slate-400 mb-3">← Back to employees</button><ProfilePage me={user} targetId={profileTarget} /></div>
            : <EmployeeDirectory isAdmin={isAdmin} onOpenProfile={(id) => setProfileTarget(id)} />
        )}
        {view === 'profile' && <ProfilePage me={user} />}
        {view === 'templates' && <EmailTemplatesPage />}
        {view === 'signature' && <EmailSignaturePage />}
        {view === 'admin' && isAdmin && <HrAdmin user={user} />}
      </main>
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
          {!isAdmin && item('My Profile', () => onNavigate('profile'))}
          {item('Email Template', () => onNavigate('templates'))}
          {item('Email Signature', () => onNavigate('signature'))}
          <div className="border-t border-slate-100 my-1" />
          <button onClick={() => { setOpen(false); onLogout(); }} className="w-full text-left px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50">Logout</button>
        </div>
      )}
    </div>
  );
}

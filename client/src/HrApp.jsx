import React, { useState, useEffect } from 'react';
import { API_BASE } from './config.js';

// HR portal — deliberately self-contained and separate from the Site Analysis
// app. It talks only to /api/hr/* and stores its own token, so nothing here can
// affect the CRM module.

const HR_TOKEN_KEY = 'qtx_hr_token';

const hrApi = async (path, opts = {}) => {
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

// --- Recruitment (4-tab scaffold) -------------------------------------------

function HrRecruitment() {
  const [tab, setTab] = useState('jobs');
  const tabs = [['jobs', 'Job Post'], ['candidates', 'Candidate List'], ['pipeline', 'Pipeline'], ['onboarded', 'Onboarded']];
  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-extrabold text-[#050A1F]">Recruitment</h1>
        {tab === 'jobs' && <button className="rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ background: ORANGE }}>+ Post a Job</button>}
        {tab === 'candidates' && <button className="rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ background: ORANGE }}>+ Add Candidate</button>}
      </div>
      <div className="inline-flex items-center gap-1 bg-slate-100 rounded-lg p-1 mb-6">
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-1.5 rounded-md text-xs font-bold ${tab === id ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>{label}</button>
        ))}
      </div>
      <div className="bg-white rounded-2xl border border-slate-200/70 p-12 text-center text-slate-400 text-sm">
        {tabs.find(([id]) => id === tab)[1]} — coming in the next version.
      </div>
    </div>
  );
}

// --- Admin: HR users + branches ---------------------------------------------

function HrAdmin({ user }) {
  const blank = { name: '', email: '', password: '', phone: '+91 ', designation: '', type: 'employee', branch: 'Bhubaneswar', branchIncharge: false, reportsTo: '', targets: { dailyInterviews: 0, monthlyOnboarding: 0 } };
  const [uview, setUview] = useState('list');
  const [users, setUsers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [reporting, setReporting] = useState({ hr: [], admins: [] });
  const [f, setF] = useState(blank);
  const [show, setShow] = useState(false);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [newBranch, setNewBranch] = useState('');

  const load = () => {
    hrApi('/users').then(setUsers).catch(() => {});
    hrApi('/branches').then(setBranches).catch(() => {});
    hrApi('/reporting-options').then(setReporting).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  // "Reports to" combines HR staff and admins into one dropdown; the value is
  // prefixed so we know which id space it belongs to.
  const reportingOptions = [
    ...reporting.hr.map((h) => ({ value: `hr:${h.id}`, label: `${h.name}${h.designation ? ` · ${h.designation}` : ''} (HR)` })),
    ...reporting.admins.map((a) => ({ value: `admin:${a.id}`, label: `${a.name} (Admin)` })),
  ];
  const splitReports = (val) => {
    if (!val) return { reportsToId: null, reportsToAdminId: null };
    const [kind, id] = val.split(':');
    return kind === 'admin' ? { reportsToId: null, reportsToAdminId: Number(id) } : { reportsToId: Number(id), reportsToAdminId: null };
  };
  const joinReports = (row) => row.reportsToAdminId ? `admin:${row.reportsToAdminId}` : (row.reportsToId ? `hr:${row.reportsToId}` : '');

  const create = async () => {
    setErr('');
    if (!f.name.trim() || !f.email.trim() || !f.password) return setErr('Name, email and password are all required.');
    if (f.password.length < 8) return setErr('Password must be at least 8 characters.');
    try {
      await hrApi('/users', { method: 'POST', body: JSON.stringify({ ...f, ...splitReports(f.reportsTo) }) });
      setF(blank); setShow(false); load(); setMsg(`User created: ${f.name}`);
    } catch (e) { setErr(e.message); }
  };

  const save = async () => {
    setErr('');
    if (edit.newPassword && edit.newPassword.length < 8) return setErr('Password must be at least 8 characters.');
    try {
      const body = {
        name: edit.name, phone: edit.phone, designation: edit.designation, type: edit.type,
        branch: edit.branch, branchIncharge: edit.branchIncharge, targets: edit.targets,
        ...splitReports(edit.reportsTo),
      };
      if (edit.newPassword) body.password = edit.newPassword;
      await hrApi(`/users/${edit._id}`, { method: 'PUT', body: JSON.stringify(body) });
      setEdit(null); load(); setMsg(`Updated ${edit.name}`);
    } catch (e) { setErr(e.message); }
  };

  const toggle = async (u) => {
    try { await hrApi(`/users/${u._id}`, { method: 'PUT', body: JSON.stringify({ active: !u.active }) }); load(); }
    catch (e) { setErr(e.message); }
  };

  const addBranch = async () => {
    if (!newBranch.trim()) return;
    try { await hrApi('/branches', { method: 'POST', body: JSON.stringify({ name: newBranch.trim() }) }); setNewBranch(''); load(); }
    catch (e) { setErr(e.message); }
  };

  const typeLabel = (t) => ({ hr: 'HR', recruiter: 'HR Recruiter', employee: 'Employee' }[t] || t);
  const nameById = (row) => {
    if (row.reportsToAdminId) { const a = reporting.admins.find((x) => x.id === row.reportsToAdminId); return a ? `${a.name} (Admin)` : 'Admin'; }
    if (row.reportsToId) { const h = reporting.hr.find((x) => x.id === row.reportsToId); return h ? h.name : '—'; }
    return '—';
  };

  const Fields = ({ state, set }) => (
    <div className="grid grid-cols-2 gap-4">
      <Field label="Name *"><input className={inputCls} value={state.name || ''} onChange={(e) => set({ name: e.target.value })} /></Field>
      {state._id ? <Field label="Email"><input className={inputCls + ' bg-slate-50'} value={state.email || ''} disabled /></Field>
        : <Field label="Email *"><input className={inputCls} value={state.email || ''} onChange={(e) => set({ email: e.target.value })} placeholder="name@qtonix.com" /></Field>}
      <Field label={state._id ? 'New password' : 'Password *'} hint={state._id ? 'Leave blank to keep current' : 'At least 8 characters'}>
        <input type={state._id ? 'text' : 'password'} className={inputCls} value={state._id ? (state.newPassword || '') : (state.password || '')}
          onChange={(e) => set(state._id ? { newPassword: e.target.value } : { password: e.target.value })} placeholder={state._id ? 'New password…' : ''} />
      </Field>
      <Field label="Phone"><input className={inputCls} value={state.phone || ''} onChange={(e) => set({ phone: e.target.value })} placeholder="+91 " /></Field>
      <Field label="Designation"><input className={inputCls} value={state.designation || ''} onChange={(e) => set({ designation: e.target.value })} placeholder="e.g. HR Manager" /></Field>
      <Field label="Role"><select className={inputCls} value={state.type} onChange={(e) => set({ type: e.target.value })}>
        <option value="hr">HR</option><option value="recruiter">HR Recruiter</option><option value="employee">Employee</option>
      </select></Field>
      <Field label="Branch"><select className={inputCls} value={state.branch} onChange={(e) => set({ branch: e.target.value })}>
        {branches.map((b) => <option key={b._id} value={b.name}>{b.name}</option>)}
      </select></Field>
      <Field label="Reports to"><select className={inputCls} value={state.reportsTo || ''} onChange={(e) => set({ reportsTo: e.target.value })}>
        <option value="">— none —</option>
        {reportingOptions.filter((o) => o.value !== `hr:${state._id}`).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select></Field>
      <div className="col-span-2 flex items-center gap-2">
        <input type="checkbox" checked={!!state.branchIncharge} onChange={(e) => set({ branchIncharge: e.target.checked })} id={`inc-${state._id || 'new'}`} />
        <label htmlFor={`inc-${state._id || 'new'}`} className="text-sm font-semibold text-slate-600">Make branch in-charge</label>
      </div>
      {state.type === 'recruiter' && (
        <div className="col-span-2 rounded-xl bg-slate-50 p-4">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Recruiter targets</div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Daily interview schedule"><input type="number" className={inputCls} value={state.targets?.dailyInterviews ?? 0} onChange={(e) => set({ targets: { ...state.targets, dailyInterviews: e.target.value } })} /></Field>
            <Field label="Monthly closing / onboarding"><input type="number" className={inputCls} value={state.targets?.monthlyOnboarding ?? 0} onChange={(e) => set({ targets: { ...state.targets, monthlyOnboarding: e.target.value } })} /></Field>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-extrabold text-[#050A1F] mb-4">HR Admin</h1>
      {err && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">{err}</div>}
      {msg && <div className="mb-4 rounded-lg bg-green-50 border border-green-200 px-3 py-2.5 text-sm text-green-700">{msg}</div>}

      {/* Branches */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
        <div className="text-sm font-bold text-[#050A1F] mb-3">Branches</div>
        <div className="flex flex-wrap gap-2 mb-3">
          {branches.map((b) => <span key={b._id} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{b.name}</span>)}
        </div>
        <div className="flex gap-2">
          <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="New branch name" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addBranch()} />
          <button onClick={addBranch} className="rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ background: ORANGE }}>Add branch</button>
        </div>
      </div>

      {/* Users */}
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-slate-500">{users.filter((u) => u.active).length} active · {users.length} total</p>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
            <button onClick={() => setUview('list')} className={`px-3 py-1 rounded-md text-xs font-bold ${uview === 'list' ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>List</button>
            <button onClick={() => setUview('org')} className={`px-3 py-1 rounded-md text-xs font-bold ${uview === 'org' ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>Org chart</button>
          </div>
          <button onClick={() => { setShow(!show); setErr(''); }} className="rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ background: ORANGE }}>{show ? 'Cancel' : '+ Add user'}</button>
        </div>
      </div>

      {show && (
        <div className="bg-white rounded-xl border-2 p-5 mb-5" style={{ borderColor: '#FF6A00' }}>
          <h3 className="font-bold text-sm mb-4 text-[#050A1F]">New user</h3>
          <Fields state={f} set={(p) => setF({ ...f, ...p })} />
          <div className="flex justify-end mt-4"><button onClick={create} className="rounded-lg px-5 py-2.5 text-sm font-bold text-white" style={{ background: '#050A1F' }}>Create user</button></div>
        </div>
      )}

      {edit && (
        <div className="bg-white rounded-xl border-2 p-5 mb-5" style={{ borderColor: '#2563EB' }}>
          <h3 className="font-bold text-sm mb-4 text-[#050A1F]">Edit {edit.name}</h3>
          <Fields state={edit} set={(p) => setEdit({ ...edit, ...p })} />
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setEdit(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
            <button onClick={save} className="rounded-lg px-5 py-2.5 text-sm font-bold text-white" style={{ background: '#050A1F' }}>Save changes</button>
          </div>
        </div>
      )}

      {uview === 'org' ? (
        <HrOrgChart users={users} reporting={reporting} />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr className="text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              <th className="px-4 py-3">Name</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Designation</th><th className="px-4 py-3">Branch</th><th className="px-4 py-3">Reports to</th><th className="px-4 py-3"></th>
            </tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u._id} className={`border-t border-slate-100 ${u.active ? '' : 'opacity-50'}`}>
                  <td className="px-4 py-3 font-bold text-[#050A1F]">{u.name}{u.branchIncharge && <span className="ml-1.5 text-[9px] font-bold text-[#FF4500]">IN-CHARGE</span>}</td>
                  <td className="px-4 py-3 text-slate-500">{u.email}</td>
                  <td className="px-4 py-3"><span className="text-[10px] font-bold rounded px-1.5 py-0.5 bg-slate-100 text-slate-600">{typeLabel(u.type)}</span></td>
                  <td className="px-4 py-3 text-slate-500">{u.designation || '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{u.branch}</td>
                  <td className="px-4 py-3 text-slate-500">{nameById(u)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setEdit({ ...u, reportsTo: joinReports(u), newPassword: '' })} className="text-xs font-bold text-blue-500 mr-3">Edit</button>
                    <button onClick={() => toggle(u)} className="text-xs font-bold text-slate-400">{u.active ? 'Deactivate' : 'Reactivate'}</button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-sm">No HR users yet. Click “Add user”.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Simple reports-to org chart (grouped by their reporting authority).
function HrOrgChart({ users, reporting }) {
  const label = (row) => {
    if (row.reportsToAdminId) { const a = reporting.admins.find((x) => x.id === row.reportsToAdminId); return a ? `${a.name} (Admin)` : 'Admin'; }
    if (row.reportsToId) { const h = users.find((x) => x._id === row.reportsToId); return h ? h.name : 'HR'; }
    return 'Unassigned';
  };
  const groups = {};
  users.filter((u) => u.active).forEach((u) => { const k = label(u); (groups[k] = groups[k] || []).push(u); });
  return (
    <div className="grid md:grid-cols-2 gap-4">
      {Object.entries(groups).map(([mgr, members]) => (
        <div key={mgr} className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-sm font-bold text-[#050A1F] mb-2">Reports to: {mgr}</div>
          <div className="space-y-1.5">
            {members.map((m) => (
              <div key={m._id} className="flex items-center justify-between text-sm">
                <span className="font-semibold text-slate-600">{m.name}</span>
                <span className="text-[11px] text-slate-400">{({ hr: 'HR', recruiter: 'Recruiter', employee: 'Employee' }[m.type])} · {m.branch}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {Object.keys(groups).length === 0 && <div className="text-slate-400 text-sm py-8 text-center col-span-2">No active HR users yet.</div>}
    </div>
  );
}

function Field({ label, hint, children }) {
  return <div><label className="block text-xs font-semibold text-slate-600 mb-1.5">{label}</label>{children}{hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}</div>;
}

// --- Shell ------------------------------------------------------------------

export default function HrApp() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [view, setView] = useState('dashboard');

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
                <button key={n.id} onClick={() => setView(n.id)}
                  className={`rounded-lg px-3 py-2 text-xs font-bold transition-colors ${view === n.id ? 'text-[#FF6A00]' : 'text-slate-400 hover:text-white'}`}>
                  {n.label}
                </button>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">{user.name}</span>
            <button onClick={logout} className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-bold text-slate-300 hover:text-white hover:border-slate-400">Logout</button>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-8">
        {view === 'dashboard' && <HrDashboard user={user} />}
        {view === 'recruitment' && <HrRecruitment />}
        {view === 'admin' && isAdmin && <HrAdmin user={user} />}
      </main>
    </div>
  );
}

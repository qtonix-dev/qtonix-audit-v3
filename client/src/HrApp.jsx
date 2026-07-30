import React, { useState, useEffect } from 'react';
import { API_BASE } from './config.js';
import { AddUserModal, ImageKitSection, ProfilePage, EmployeeDirectory, Field as SharedField, Avatar, ROLE_LABELS, ROLE_OPTIONS } from './HrParts.jsx';

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
  const [uview, setUview] = useState('list');
  const [users, setUsers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [reporting, setReporting] = useState({ hr: [], admins: [] });
  const [imagekitReady, setImagekitReady] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [newDept, setNewDept] = useState('');
  const [profileId, setProfileId] = useState(null);

  const load = () => {
    hrApi('/users').then(setUsers).catch(() => {});
    hrApi('/branches').then(setBranches).catch(() => {});
    hrApi('/departments').then(setDepartments).catch(() => {});
    hrApi('/reporting-options').then(setReporting).catch(() => {});
    hrApi('/imagekit').then((c) => setImagekitReady(c.configured)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

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
  const nameById = (row) => {
    if (row.reportsToAdminId) { const a = reporting.admins.find((x) => x.id === row.reportsToAdminId); return a ? `${a.name} (Admin)` : 'Admin'; }
    if (row.reportsToId) { const h = reporting.hr.find((x) => x.id === row.reportsToId); return h ? h.name : '—'; }
    return '—';
  };

  const save = async () => {
    setErr('');
    if (edit.newPassword && edit.newPassword.length < 8) return setErr('Password must be at least 8 characters.');
    try {
      const body = {
        name: edit.name, phone: edit.phone, designation: edit.designation, type: edit.type,
        employeeId: edit.employeeId, branch: edit.branch, department: edit.department, joiningDate: edit.joiningDate,
        branchIncharge: edit.branchIncharge, targets: edit.targets, ...splitReports(edit.reportsTo),
      };
      if (edit.newPassword) body.password = edit.newPassword;
      await hrApi(`/users/${edit._id}`, { method: 'PUT', body: JSON.stringify(body) });
      setEdit(null); load(); setMsg(`Updated ${edit.name}`);
    } catch (e) { setErr(e.message); }
  };
  const toggle = async (u) => { try { await hrApi(`/users/${u._id}`, { method: 'PUT', body: JSON.stringify({ active: !u.active }) }); load(); } catch (e) { setErr(e.message); } };

  const addBranch = async () => { if (!newBranch.trim()) return; try { await hrApi('/branches', { method: 'POST', body: JSON.stringify({ name: newBranch.trim() }) }); setNewBranch(''); load(); } catch (e) { setErr(e.message); } };
  const editBranch = async (b) => { const name = prompt('Rename branch', b.name); if (name && name.trim() && name !== b.name) { try { await hrApi(`/branches/${b._id}`, { method: 'PUT', body: JSON.stringify({ name: name.trim() }) }); load(); } catch (e) { setErr(e.message); } } };
  const delBranch = async (b) => { if (!confirm(`Delete branch "${b.name}"?`)) return; try { await hrApi(`/branches/${b._id}`, { method: 'DELETE' }); load(); } catch (e) { setErr(e.message); } };
  const addDept = async () => { if (!newDept.trim()) return; try { await hrApi('/departments', { method: 'POST', body: JSON.stringify({ name: newDept.trim() }) }); setNewDept(''); load(); } catch (e) { setErr(e.message); } };
  const editDept = async (d) => { const name = prompt('Rename department', d.name); if (name && name.trim() && name !== d.name) { try { await hrApi(`/departments/${d._id}`, { method: 'PUT', body: JSON.stringify({ name: name.trim() }) }); load(); } catch (e) { setErr(e.message); } } };
  const delDept = async (d) => { if (!confirm(`Delete department "${d.name}"?`)) return; try { await hrApi(`/departments/${d._id}`, { method: 'DELETE' }); load(); } catch (e) { setErr(e.message); } };

  if (profileId) return (<div><button onClick={() => { setProfileId(null); load(); }} className="text-xs font-bold text-slate-400 mb-3">← Back to admin</button><ProfilePage me={user} targetId={profileId} /></div>);

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-extrabold text-[#050A1F] mb-4">HR Admin</h1>
      {err && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">{err}</div>}
      {msg && <div className="mb-4 rounded-lg bg-green-50 border border-green-200 px-3 py-2.5 text-sm text-green-700">{msg}</div>}

      <ImageKitSection />

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="text-sm font-bold text-[#050A1F] mb-3">Branches</div>
          <div className="space-y-1.5 mb-3">
            {branches.map((b) => (
              <div key={b._id} className="flex items-center justify-between text-sm">
                <span className="font-semibold text-slate-600">{b.name}</span>
                <span className="whitespace-nowrap"><button onClick={() => editBranch(b)} className="text-xs font-bold text-blue-500 mr-2">Edit</button><button onClick={() => delBranch(b)} className="text-xs font-bold text-red-400">Delete</button></span>
              </div>
            ))}
          </div>
          <div className="flex gap-2"><input className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="New branch" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addBranch()} /><button onClick={addBranch} className="rounded-lg px-3 py-2 text-xs font-bold text-white" style={{ background: ORANGE }}>Add</button></div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="text-sm font-bold text-[#050A1F] mb-3">Departments</div>
          <div className="space-y-1.5 mb-3">
            {departments.map((d) => (
              <div key={d._id} className="flex items-center justify-between text-sm">
                <span className="font-semibold text-slate-600">{d.name}</span>
                <span className="whitespace-nowrap"><button onClick={() => editDept(d)} className="text-xs font-bold text-blue-500 mr-2">Edit</button><button onClick={() => delDept(d)} className="text-xs font-bold text-red-400">Delete</button></span>
              </div>
            ))}
          </div>
          <div className="flex gap-2"><input className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="New department" value={newDept} onChange={(e) => setNewDept(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addDept()} /><button onClick={addDept} className="rounded-lg px-3 py-2 text-xs font-bold text-white" style={{ background: ORANGE }}>Add</button></div>
        </div>
      </div>

      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-slate-500">{users.filter((u) => u.active).length} active · {users.length} total</p>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
            <button onClick={() => setUview('list')} className={`px-3 py-1 rounded-md text-xs font-bold ${uview === 'list' ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>List</button>
            <button onClick={() => setUview('org')} className={`px-3 py-1 rounded-md text-xs font-bold ${uview === 'org' ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>Org chart</button>
          </div>
          <button onClick={() => setShowAdd(true)} className="rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ background: ORANGE }}>+ Add user</button>
        </div>
      </div>

      {showAdd && <AddUserModal branches={branches} departments={departments} reportingOptions={reportingOptions} imagekitReady={imagekitReady} onClose={() => setShowAdd(false)} onCreated={(n) => { setMsg(`User created: ${n}`); load(); }} />}

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
          <div className="flex justify-end gap-2 mt-4"><button onClick={() => setEdit(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button><button onClick={save} className="rounded-lg px-5 py-2.5 text-sm font-bold text-white" style={{ background: '#050A1F' }}>Save changes</button></div>
        </div>
      )}

      {uview === 'org' ? <HrOrgChart users={users} reporting={reporting} /> : (
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
                    <button onClick={() => setProfileId(u._id)} className="text-xs font-bold text-slate-500 mr-3">Profile</button>
                    <button onClick={() => setEdit({ ...u, reportsTo: joinReports(u), newPassword: '' })} className="text-xs font-bold text-blue-500 mr-3">Edit</button>
                    <button onClick={() => toggle(u)} className="text-xs font-bold text-slate-400">{u.active ? 'Off' : 'On'}</button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400 text-sm">No HR users yet. Click “Add user”.</td></tr>}
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

// --- Shell ------------------------------------------------------------------

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
    { id: 'employees', label: 'Employee' },
    ...(!isAdmin ? [{ id: 'profile', label: 'My Profile' }] : []),
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
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">{user.name}</span>
            <button onClick={logout} className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-bold text-slate-300 hover:text-white hover:border-slate-400">Logout</button>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-8">
        {view === 'dashboard' && <HrDashboard user={user} />}
        {view === 'recruitment' && <HrRecruitment />}
        {view === 'employees' && (
          profileTarget
            ? <div><button onClick={() => setProfileTarget(null)} className="text-xs font-bold text-slate-400 mb-3">← Back to employees</button><ProfilePage me={user} targetId={profileTarget} /></div>
            : <EmployeeDirectory isAdmin={isAdmin} onOpenProfile={(id) => setProfileTarget(id)} />
        )}
        {view === 'profile' && !isAdmin && <ProfilePage me={user} />}
        {view === 'admin' && isAdmin && <HrAdmin user={user} />}
      </main>
    </div>
  );
}

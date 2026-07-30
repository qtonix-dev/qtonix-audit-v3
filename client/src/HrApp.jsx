import React, { useState, useEffect } from 'react';
import { API_BASE } from './config.js';
import { AddUserModal, ImageKitSection, ProfilePage, EmployeeDirectory, Field as SharedField, Avatar, ROLE_LABELS, ROLE_OPTIONS, ROLE_LEVEL, Icon } from './HrParts.jsx';

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

  const TABS = [['users', 'Users'], ['org', 'Organization Chart'], ['branches', 'Branches & Departments'], ['shifts', 'Shifts'], ['holidays', 'Holidays'], ['imagekit', 'ImageKit']];

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

import React, { useState, useEffect } from 'react';
import { API_BASE } from './config.js';

// Same icon set used across the Site Analysis platform, redrawn here so the HR
// portal doesn't pull in the CRM module.
const IconBase = ({ size = 16, children, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>{children}</svg>
);
export const Icon = {
  Pencil: (p) => <IconBase {...p}><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" /><path d="M15 6l3 3" /></IconBase>,
  Trash: (p) => <IconBase {...p}><path d="M4 7h16" /><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" /><path d="M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7" /><path d="M10 11v6M14 11v6" /></IconBase>,
  Globe: (p) => <IconBase {...p}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.4 2.5 14.6 0 17M12 3.5c-2.5 2.4-2.5 14.6 0 17" /></IconBase>,
};

// Shared HR helpers/components used by HrApp. Kept here so the main shell file
// stays readable. Everything talks only to /api/hr/*.

const HR_TOKEN_KEY = 'qtx_hr_token';
export const ORANGE = 'linear-gradient(90deg,#FF6A00,#FF4500)';
export const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF6A00] focus:border-transparent';

export const hrApi = async (path, opts = {}) => {
  const token = localStorage.getItem(HR_TOKEN_KEY);
  const res = await fetch(`${API_BASE}/api/hr${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const err = new Error(data.error || 'Something went wrong.'); err.status = res.status; throw err; }
  return data;
};

export async function uploadToImageKit(file, folder, fileName) {
  const auth = await hrApi('/imagekit/auth');
  const form = new FormData();
  form.append('file', file);
  form.append('fileName', fileName || file.name);
  form.append('folder', folder);
  form.append('publicKey', auth.publicKey);
  form.append('signature', auth.signature);
  form.append('expire', auth.expire);
  form.append('token', auth.token);
  form.append('useUniqueFileName', 'true');
  const res = await fetch('https://upload.imagekit.io/api/v1/files/upload', { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Upload failed.');
  return { url: data.url, fileId: data.fileId };
}

export const ROLE_LABELS = { hr: 'HR', recruiter: 'HR Recruiter', manager: 'Manager', tl: 'Team Lead', senior: 'Senior Executive', junior: 'Junior Executive', trainee: 'Trainee', intern: 'Intern', employee: 'Employee' };
export const ROLE_OPTIONS = [['hr', 'HR'], ['recruiter', 'HR Recruiter'], ['manager', 'Manager'], ['tl', 'Team Lead'], ['senior', 'Senior Executive'], ['junior', 'Junior Executive'], ['trainee', 'Trainee'], ['intern', 'Intern'], ['employee', 'Employee']];
// Seniority order for the org chart (lower index = higher in the hierarchy).
export const ROLE_LEVEL = { manager: 0, tl: 1, senior: 2, junior: 3, trainee: 4, intern: 5, employee: 3, hr: 1, recruiter: 2 };

export function Field({ label, hint, children }) {
  return <div><label className="block text-xs font-semibold text-slate-600 mb-1.5">{label}</label>{children}{hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}</div>;
}

export function Avatar({ name, src, size = 48 }) {
  const initial = (name || '?').trim()[0]?.toUpperCase() || '?';
  if (src) return <img src={src} alt={name} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  return <div className="rounded-full bg-orange-50 text-[#FF4500] flex items-center justify-center font-bold" style={{ width: size, height: size }}>{initial}</div>;
}

// ---------------------------------------------------------------------------
// Create-user popup (modal), mirroring the CRM "Add lead" popup pattern.
// ---------------------------------------------------------------------------
export function AddUserModal({ presetType, branches, departments, reportingOptions, shifts = [], imagekitReady, onClose, onCreated }) {
  const blank = {
    name: '', employeeId: '', email: '', password: '', phone: '+91 ', designation: '',
    type: presetType || 'employee', branch: branches[0]?.name || 'Bhubaneswar', department: '', joiningDate: '',
    reportsTo: '', branchIncharge: false, avatar: '', shiftId: '', targets: { dailyInterviews: 0, monthlyOnboarding: 0 },
  };
  const [f, setF] = useState(blank);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const set = (p) => setF((s) => ({ ...s, ...p }));

  const splitReports = (val) => {
    if (!val) return { reportsToId: null, reportsToAdminId: null };
    const [kind, id] = val.split(':');
    return kind === 'admin' ? { reportsToId: null, reportsToAdminId: Number(id) } : { reportsToId: Number(id), reportsToAdminId: null };
  };

  const pickPhoto = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!imagekitReady) { setErr('Connect ImageKit first (Admin → ImageKit) to upload photos.'); return; }
    setUploading(true); setErr('');
    try {
      const idPart = f.employeeId ? f.employeeId.replace(/[^A-Za-z0-9]+/g, '') : 'new';
      const safe = (f.name || 'user').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const { url } = await uploadToImageKit(file, `/qtonix-hr/employees/${idPart}-${safe}/avatar`, 'avatar');
      set({ avatar: url });
    } catch (e2) { setErr(e2.message); } finally { setUploading(false); }
  };

  const submit = async () => {
    setErr('');
    if (!f.name.trim() || !f.email.trim() || !f.password) return setErr('Name, email and password are all required.');
    if (f.password.length < 8) return setErr('Password must be at least 8 characters.');
    setBusy(true);
    try {
      await hrApi('/users', { method: 'POST', body: JSON.stringify({ ...f, ...splitReports(f.reportsTo) }) });
      onCreated(f.name); onClose();
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-2xl my-8" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-extrabold text-[#050A1F] mb-1">{presetType === 'employee' ? 'Add employee' : 'Add user'}</h3>
        <p className="text-xs text-slate-400 mb-4">Enter the essentials to create the account. The rest of the profile is completed by the user after they sign in.</p>
        {err && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">{err}</div>}

        <div className="flex items-center gap-4 mb-4">
          <Avatar name={f.name} src={f.avatar} size={64} />
          <div>
            <label className={`inline-block rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold cursor-pointer hover:bg-slate-50 ${uploading ? 'opacity-50' : ''}`}>
              {uploading ? 'Uploading…' : 'Upload photo'}
              <input type="file" accept="image/*" className="hidden" onChange={pickPhoto} disabled={uploading} />
            </label>
            {!imagekitReady && <div className="text-[10px] text-amber-600 mt-1">ImageKit not connected — photo upload disabled.</div>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Name *"><input className={inputCls} value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Employee ID"><input className={inputCls} value={f.employeeId} onChange={(e) => set({ employeeId: e.target.value })} placeholder="EMP001" /></Field>
          <Field label="Email *"><input className={inputCls} value={f.email} onChange={(e) => set({ email: e.target.value })} placeholder="name@qtonix.com" /></Field>
          <Field label="Password *" hint="At least 8 characters"><input type="password" className={inputCls} value={f.password} onChange={(e) => set({ password: e.target.value })} /></Field>
          <Field label="Phone"><input className={inputCls} value={f.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
          <Field label="Designation"><input className={inputCls} value={f.designation} onChange={(e) => set({ designation: e.target.value })} placeholder="e.g. HR Manager" /></Field>
          <Field label="Role"><select className={inputCls} value={f.type} onChange={(e) => set({ type: e.target.value })}>
            {ROLE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></Field>
          <Field label="Branch"><select className={inputCls} value={f.branch} onChange={(e) => set({ branch: e.target.value })}>
            {branches.map((b) => <option key={b._id} value={b.name}>{b.name}</option>)}
          </select></Field>
          <Field label="Department"><select className={inputCls} value={f.department} onChange={(e) => set({ department: e.target.value })}>
            <option value="">— select —</option>
            {departments.map((d) => <option key={d._id} value={d.name}>{d.name}</option>)}
          </select></Field>
          <Field label="Joining date"><input type="date" className={inputCls} value={f.joiningDate} onChange={(e) => set({ joiningDate: e.target.value })} /></Field>
          <Field label="Reports to"><select className={inputCls} value={f.reportsTo} onChange={(e) => set({ reportsTo: e.target.value })}>
            <option value="">— none —</option>
            {reportingOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select></Field>
          <Field label="Shift"><select className={inputCls} value={f.shiftId} onChange={(e) => set({ shiftId: e.target.value })}>
            <option value="">— none —</option>
            {shifts.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
          </select></Field>
          <div className="flex items-center gap-2 pt-6">
            <input type="checkbox" id="inc-new" checked={f.branchIncharge} onChange={(e) => set({ branchIncharge: e.target.checked })} />
            <label htmlFor="inc-new" className="text-sm font-semibold text-slate-600">Make branch in-charge</label>
          </div>
        </div>

        {f.type === 'recruiter' && (
          <div className="mt-4 rounded-xl bg-slate-50 p-4">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Recruiter targets</div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Daily interview schedule"><input type="number" className={inputCls} value={f.targets.dailyInterviews} onChange={(e) => set({ targets: { ...f.targets, dailyInterviews: e.target.value } })} /></Field>
              <Field label="Monthly closing / onboarding"><input type="number" className={inputCls} value={f.targets.monthlyOnboarding} onChange={(e) => set({ targets: { ...f.targets, monthlyOnboarding: e.target.value } })} /></Field>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={submit} disabled={busy} className="rounded-lg px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: '#050A1F' }}>{busy ? 'Creating…' : 'Create user'}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ImageKit connection section (admin).
// ---------------------------------------------------------------------------
export function ImageKitSection() {
  const [cfg, setCfg] = useState({ publicKey: '', urlEndpoint: '', hasPrivateKey: false, configured: false });
  const [privateKey, setPrivateKey] = useState('');
  const [status, setStatus] = useState(null); // { ok, message }
  const [busy, setBusy] = useState(false);

  const load = () => hrApi('/imagekit').then(setCfg).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async () => {
    setBusy(true); setStatus(null);
    try {
      const body = { publicKey: cfg.publicKey, urlEndpoint: cfg.urlEndpoint };
      if (privateKey.trim()) body.privateKey = privateKey.trim();
      const res = await hrApi('/imagekit', { method: 'PUT', body: JSON.stringify(body) });
      setStatus(res); setPrivateKey(''); load();
    } catch (e) { setStatus({ ok: false, message: e.message }); } finally { setBusy(false); }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-bold text-[#050A1F]">ImageKit — file &amp; image storage</div>
        <span className={`text-[11px] font-bold rounded-full px-2.5 py-1 ${cfg.configured ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{cfg.configured ? 'Connected' : 'Not connected'}</span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Public key"><input className={inputCls} value={cfg.publicKey} onChange={(e) => setCfg({ ...cfg, publicKey: e.target.value })} placeholder="public_xxxxxxxx" /></Field>
        <Field label="URL endpoint"><input className={inputCls} value={cfg.urlEndpoint} onChange={(e) => setCfg({ ...cfg, urlEndpoint: e.target.value })} placeholder="https://ik.imagekit.io/your_id" /></Field>
        <Field label="Private key" hint={cfg.hasPrivateKey ? 'A key is saved — leave blank to keep it.' : 'Required.'}><input type="password" className={inputCls} value={privateKey} onChange={(e) => setPrivateKey(e.target.value)} placeholder={cfg.hasPrivateKey ? '••••••••' : 'private_xxxxxxxx'} /></Field>
      </div>
      {status && <div className={`mt-3 rounded-lg px-3 py-2.5 text-sm ${status.ok ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>{status.message}</div>}
      <div className="flex justify-end mt-4"><button onClick={save} disabled={busy} className="rounded-lg px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : 'Save & test connection'}</button></div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Self-service profile page — the big form the employee completes. Also usable
// by an admin to view/edit anyone's profile (pass targetId).
// ---------------------------------------------------------------------------
const DOC_TYPES = ['PAN Card', 'Aadhaar Card', 'Voter ID Card', 'Driving License', 'Utility Bill'];

export function ProfilePage({ me, targetId }) {
  const id = targetId || me._id || me.id;
  const [row, setRow] = useState(null);
  const [p, setP] = useState({});
  const [avatar, setAvatar] = useState('');
  const [tab, setTab] = useState('timeline');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [ikReady, setIkReady] = useState(false);
  const [noteText, setNoteText] = useState('');

  const canEditLocked = !!(row && row.canEditLocked); // HR/Admin viewing
  const isSelf = !targetId;

  const reload = () => hrApi(`/profile/${id}`).then((r) => { setRow(r); setP(r.profile || {}); setAvatar(r.avatar || ''); }).catch((e) => setErr(e.message));
  useEffect(() => {
    reload();
    hrApi('/imagekit').then((c) => setIkReady(c.configured)).catch(() => {});
  }, [id]);

  const patch = (section, obj) => setP((s) => ({ ...s, [section]: { ...(s[section] || {}), ...obj } }));

  const folder = () => {
    const idPart = row?.employeeId ? String(row.employeeId).replace(/[^A-Za-z0-9]+/g, '') : `id${id}`;
    const safe = (row?.name || 'user').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return `/qtonix-hr/employees/${idPart}-${safe}`;
  };
  const uploadDoc = async (file, onDone) => {
    if (!ikReady) { setErr('ImageKit is not connected — ask an admin to set it up.'); return; }
    setErr('');
    try { const { url } = await uploadToImageKit(file, `${folder()}/documents`, file.name); onDone(url); }
    catch (e) { setErr(e.message); }
  };
  const uploadAvatar = async (e) => {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    if (!ikReady) { setErr('ImageKit is not connected.'); return; }
    try { const { url } = await uploadToImageKit(file, `${folder()}/avatar`, 'avatar'); setAvatar(url); }
    catch (e2) { setErr(e2.message); }
  };

  const addDoc = () => setP((s) => ({ ...s, documents: [...(s.documents || []), { type: 'PAN Card', number: '', url: '' }] }));
  const setDoc = (i, obj) => setP((s) => ({ ...s, documents: (s.documents || []).map((d, idx) => idx === i ? { ...d, ...obj } : d) }));
  const delDoc = (i) => setP((s) => ({ ...s, documents: (s.documents || []).filter((_, idx) => idx !== i) }));
  const addExp = () => patch('employment', { fresher: false, records: [...((p.employment && p.employment.records) || []), { employer: '', from: '', to: '', designation: '', salary: '' }] });
  const setExp = (i, obj) => patch('employment', { records: ((p.employment && p.employment.records) || []).map((r, idx) => idx === i ? { ...r, ...obj } : r) });
  const delExp = (i) => patch('employment', { records: ((p.employment && p.employment.records) || []).filter((_, idx) => idx !== i) });

  const save = async () => {
    setSaving(true); setMsg(''); setErr('');
    try { const r = await hrApi(`/profile/${id}`, { method: 'PUT', body: JSON.stringify({ profile: p, avatar }) }); setRow(r); setP(r.profile || {}); setMsg(`Saved — ${r.completion}% complete.`); }
    catch (e) { setErr(e.message); } finally { setSaving(false); }
  };
  const addNote = async () => {
    if (!noteText.trim()) return;
    try { await hrApi(`/profile/${id}/timeline`, { method: 'POST', body: JSON.stringify({ text: noteText.trim() }) }); setNoteText(''); reload(); }
    catch (e) { setErr(e.message); }
  };

  if (!row) return <div className="text-slate-400 text-sm py-12 text-center">{err || 'Loading…'}</div>;

  const roleLabel = ROLE_LABELS[row.type] || row.type;
  const reportsToName = row.reportsToAdminId ? '(Admin)' : (row.reportsToId ? `HR #${row.reportsToId}` : '—');
  const TABS = [['timeline', 'Timeline'], ['personal', 'Personal Information'], ['payroll', 'Payroll & Compensation'], ['education', 'Professional & Education'], ['employment', 'Previous Employment']];

  // A read-only identity field for the header card.
  const IdField = ({ label, value }) => (
    <div><div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{label}</div><div className="text-sm font-semibold text-[#050A1F] mt-0.5">{value || '—'}</div></div>
  );

  return (
    <div className="max-w-5xl">
      {err && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">{err}</div>}
      {msg && <div className="mb-4 rounded-lg bg-green-50 border border-green-200 px-3 py-2.5 text-sm text-green-700">{msg}</div>}

      {/* LEFT/RIGHT split like the lead detail page: identity card + tabbed body */}
      <div className="grid md:grid-cols-[300px_1fr] gap-5">
        {/* Identity card (view-only for everyone; edited via Admin → Users) */}
        <div className="bg-white rounded-2xl border border-slate-100 p-5 h-fit">
          <div className="flex flex-col items-center text-center mb-4">
            <Avatar name={row.name} src={avatar} size={84} />
            {(canEditLocked || isSelf) && (
              <label className="mt-2 text-[11px] font-bold text-[#FF4500] cursor-pointer">Change photo<input type="file" accept="image/*" className="hidden" onChange={uploadAvatar} /></label>
            )}
            <div className="mt-2 text-lg font-extrabold text-[#050A1F]">{row.name}</div>
            <div className="text-xs text-slate-400">{row.designation || roleLabel}</div>
            <div className="mt-2 flex items-center gap-1.5">
              <div className="w-24 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full" style={{ width: `${row.completion || 0}%`, background: (row.completion||0)>=100?'#059669':(row.completion||0)>=50?'#FF6A00':'#EF4444' }} /></div>
              <span className="text-[11px] font-bold text-slate-500">{row.completion || 0}%</span>
            </div>
          </div>
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <IdField label="Employee ID" value={row.employeeId} />
            <IdField label="Official email" value={row.email} />
            <IdField label="Role" value={roleLabel} />
            <IdField label="Branch" value={row.branch} />
            <IdField label="Department" value={row.department} />
            <IdField label="Joining date" value={row.joiningDate} />
            <IdField label="Reporting to" value={reportsToName} />
            <IdField label="Shift" value={row.shift ? `${row.shift.name}${row.shift.startTime ? ` · ${row.shift.startTime}–${row.shift.endTime}` : ''}` : '—'} />
          </div>
          {isSelf && <p className="text-[10px] text-slate-400 mt-4 leading-relaxed">These details are managed by HR. Contact your HR team for corrections.</p>}
        </div>

        {/* Tabbed body */}
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          <div className="flex border-b border-slate-100 flex-wrap">
            {TABS.map(([t, l]) => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-3 text-xs font-bold transition ${tab === t ? 'text-[#FF4500] border-b-2 border-[#FF4500]' : 'text-slate-400 hover:text-slate-600'}`}>{l}</button>
            ))}
          </div>
          <div className="p-5 min-h-[320px]">
            {/* TIMELINE */}
            {tab === 'timeline' && (
              <div>
                {canEditLocked && (
                  <div className="flex gap-2 mb-4">
                    <input className={inputCls} placeholder="Add a note to this record…" value={noteText} onChange={(e) => setNoteText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNote()} />
                    <button onClick={addNote} className="rounded-lg px-4 py-2 text-xs font-bold text-white whitespace-nowrap" style={{ background: '#050A1F' }}>Add note</button>
                  </div>
                )}
                <div className="space-y-3">
                  {(row.timeline || []).map((ev, i) => (
                    <div key={i} className="flex gap-3">
                      <div className="text-lg">{ev.kind === 'created' ? '✨' : ev.kind === 'note' ? '📝' : '•'}</div>
                      <div className="flex-1 border-b border-slate-50 pb-3">
                        <div className="text-sm text-[#050A1F]">{ev.text}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">{new Date(ev.at).toLocaleString()} {ev.by ? `· ${ev.by}` : ''}</div>
                      </div>
                    </div>
                  ))}
                  {(!row.timeline || row.timeline.length === 0) && <div className="text-slate-400 text-sm text-center py-8">No timeline entries yet.</div>}
                </div>
              </div>
            )}

            {/* PERSONAL + DOCUMENTS (employee-editable) */}
            {tab === 'personal' && (
              <div className="space-y-6">
                <div>
                  <div className="text-sm font-extrabold text-[#050A1F] mb-3">Personal details</div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2"><Field label="Home address"><textarea className={inputCls} rows={2} value={p.personal?.homeAddress ?? ''} onChange={(e) => patch('personal', { homeAddress: e.target.value })} /></Field></div>
                    <Field label="Personal email"><input className={inputCls} value={p.personal?.personalEmail ?? ''} onChange={(e) => patch('personal', { personalEmail: e.target.value })} /></Field>
                    <Field label="Date of birth"><input type="date" className={inputCls} value={p.personal?.dob ?? ''} onChange={(e) => patch('personal', { dob: e.target.value })} /></Field>
                    <Field label="Marital status"><select className={inputCls} value={p.personal?.maritalStatus ?? ''} onChange={(e) => patch('personal', { maritalStatus: e.target.value })}><option value="">— select —</option><option>Single</option><option>Married</option></select></Field>
                    {p.personal?.maritalStatus === 'Married' && <Field label="Anniversary date"><input type="date" className={inputCls} value={p.personal?.anniversary ?? ''} onChange={(e) => patch('personal', { anniversary: e.target.value })} /></Field>}
                  </div>
                </div>
                <div>
                  <div className="text-sm font-extrabold text-[#050A1F] mb-3">Bank details</div>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Bank name"><input className={inputCls} value={p.bank?.bankName ?? ''} onChange={(e) => patch('bank', { bankName: e.target.value })} /></Field>
                    <Field label="Account number"><input className={inputCls} value={p.bank?.accountNumber ?? ''} onChange={(e) => patch('bank', { accountNumber: e.target.value })} /></Field>
                    <Field label="IFSC code"><input className={inputCls} value={p.bank?.ifsc ?? ''} onChange={(e) => patch('bank', { ifsc: e.target.value })} /></Field>
                    <Field label="Account type"><select className={inputCls} value={p.bank?.accountType ?? ''} onChange={(e) => patch('bank', { accountType: e.target.value })}><option value="">— select —</option><option>Saving</option><option>Office Salary Account</option></select></Field>
                  </div>
                </div>
                <div>
                  <div className="text-sm font-extrabold text-[#050A1F] mb-3">Documents</div>
                  <div className="space-y-3">
                    {(p.documents || []).map((d, i) => (
                      <div key={i} className="grid grid-cols-12 gap-2 items-end border border-slate-100 rounded-lg p-3">
                        <div className="col-span-4"><Field label="Type"><select className={inputCls} value={d.type} onChange={(e) => setDoc(i, { type: e.target.value })}>{DOC_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field></div>
                        <div className="col-span-4"><Field label="Number"><input className={inputCls} value={d.number} onChange={(e) => setDoc(i, { number: e.target.value })} /></Field></div>
                        <div className="col-span-3">{d.url ? <a href={d.url} target="_blank" rel="noreferrer" className="text-xs font-bold text-blue-500">View file ↗</a> : <label className="inline-block rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold cursor-pointer hover:bg-slate-50">Upload<input type="file" className="hidden" onChange={(e) => e.target.files[0] && uploadDoc(e.target.files[0], (url) => setDoc(i, { url }))} /></label>}</div>
                        <div className="col-span-1 text-right"><button onClick={() => delDoc(i)} className="text-slate-300 hover:text-red-500"><Icon.Trash size={15} /></button></div>
                      </div>
                    ))}
                    <button onClick={addDoc} className="text-xs font-bold text-[#FF4500]">+ Add document</button>
                  </div>
                </div>
                <div className="flex justify-end"><button onClick={save} disabled={saving} className="rounded-lg px-6 py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{saving ? 'Saving…' : 'Save changes'}</button></div>
              </div>
            )}

            {/* PAYROLL & COMPENSATION (locked: HR/Admin edit; employee view-only) */}
            {tab === 'payroll' && (
              <div>
                {!canEditLocked && <div className="mb-4 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5 text-xs text-slate-500">This section is maintained by HR. You have view-only access.</div>}
                <div className="text-sm font-extrabold text-[#050A1F] mb-3">Salary components</div>
                <div className="grid grid-cols-3 gap-4 mb-6">
                  {['basic', 'hra', 'ta', 'da', 'other', 'pf', 'esi'].map((k) => (
                    <Field key={k} label={k.toUpperCase()}>{canEditLocked ? <input type="number" className={inputCls} value={p.payroll?.[k] ?? ''} onChange={(e) => patch('payroll', { [k]: e.target.value })} /> : <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm font-semibold text-[#050A1F]">{p.payroll?.[k] ?? '—'}</div>}</Field>
                  ))}
                </div>
                <div className="text-sm font-extrabold text-[#050A1F] mb-3">Performance history</div>
                <div className="grid grid-cols-1 gap-4">
                  {[['promotions', 'Promotion history'], ['reviews', 'Performance review'], ['disciplinary', 'Disciplinary notices / warnings']].map(([k, l]) => (
                    <Field key={k} label={l}>{canEditLocked ? <textarea className={inputCls} rows={2} value={p.performance?.[k] ?? ''} onChange={(e) => patch('performance', { [k]: e.target.value })} /> : <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-700 whitespace-pre-wrap min-h-[42px]">{p.performance?.[k] || '—'}</div>}</Field>
                  ))}
                </div>
                {canEditLocked && <div className="flex justify-end mt-6"><button onClick={save} disabled={saving} className="rounded-lg px-6 py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{saving ? 'Saving…' : 'Save changes'}</button></div>}
              </div>
            )}

            {/* EDUCATION (employee-editable) */}
            {tab === 'education' && (
              <div>
                <div className="text-sm font-extrabold text-[#050A1F] mb-3">Education records</div>
                {[['tenth', '10th'], ['twelfth', '+2'], ['graduation', 'Graduation']].map(([key, label]) => (
                  <div key={key} className="mb-4">
                    <div className="text-xs font-bold text-slate-500 mb-2">{label}</div>
                    <div className="grid grid-cols-2 gap-3">
                      {key === 'graduation' && <Field label="Course name"><input className={inputCls} value={p.education?.[key]?.courseName ?? ''} onChange={(e) => patch('education', { [key]: { ...(p.education?.[key] || {}), courseName: e.target.value } })} /></Field>}
                      <Field label="Institution"><input className={inputCls} value={p.education?.[key]?.institution ?? ''} onChange={(e) => patch('education', { [key]: { ...(p.education?.[key] || {}), institution: e.target.value } })} /></Field>
                      <Field label="Year of passing"><input className={inputCls} value={p.education?.[key]?.year ?? ''} onChange={(e) => patch('education', { [key]: { ...(p.education?.[key] || {}), year: e.target.value } })} /></Field>
                      <Field label="% achieved"><input className={inputCls} value={p.education?.[key]?.percent ?? ''} onChange={(e) => patch('education', { [key]: { ...(p.education?.[key] || {}), percent: e.target.value } })} /></Field>
                      <div className="flex items-end">{p.education?.[key]?.url ? <a href={p.education[key].url} target="_blank" rel="noreferrer" className="text-xs font-bold text-blue-500 pb-2">View ↗</a> : <label className="inline-block rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold cursor-pointer hover:bg-slate-50">Upload<input type="file" className="hidden" onChange={(e) => e.target.files[0] && uploadDoc(e.target.files[0], (url) => patch('education', { [key]: { ...(p.education?.[key] || {}), url } }))} /></label>}</div>
                    </div>
                  </div>
                ))}
                <div className="flex justify-end"><button onClick={save} disabled={saving} className="rounded-lg px-6 py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{saving ? 'Saving…' : 'Save changes'}</button></div>
              </div>
            )}

            {/* PREVIOUS EMPLOYMENT (employee-editable) */}
            {tab === 'employment' && (
              <div>
                <label className="flex items-center gap-2 mb-3 text-sm font-semibold text-slate-600"><input type="checkbox" checked={!!p.employment?.fresher} onChange={(e) => patch('employment', { fresher: e.target.checked, records: e.target.checked ? [] : (p.employment?.records || []) })} /> Fresher (no prior experience)</label>
                {!p.employment?.fresher && (
                  <div className="space-y-3">
                    {((p.employment && p.employment.records) || []).map((r, i) => (
                      <div key={i} className="grid grid-cols-12 gap-2 items-end border border-slate-100 rounded-lg p-3">
                        <div className="col-span-3"><Field label="Employer"><input className={inputCls} value={r.employer} onChange={(e) => setExp(i, { employer: e.target.value })} /></Field></div>
                        <div className="col-span-2"><Field label="From"><input className={inputCls} placeholder="MM/YYYY" value={r.from} onChange={(e) => setExp(i, { from: e.target.value })} /></Field></div>
                        <div className="col-span-2"><Field label="To"><input className={inputCls} placeholder="MM/YYYY" value={r.to} onChange={(e) => setExp(i, { to: e.target.value })} /></Field></div>
                        <div className="col-span-2"><Field label="Designation"><input className={inputCls} value={r.designation} onChange={(e) => setExp(i, { designation: e.target.value })} /></Field></div>
                        <div className="col-span-2"><Field label="Salary"><input className={inputCls} value={r.salary} onChange={(e) => setExp(i, { salary: e.target.value })} /></Field></div>
                        <div className="col-span-1 text-right"><button onClick={() => delExp(i)} className="text-slate-300 hover:text-red-500"><Icon.Trash size={15} /></button></div>
                      </div>
                    ))}
                    <button onClick={addExp} className="text-xs font-bold text-[#FF4500]">+ Add experience</button>
                  </div>
                )}
                <div className="flex justify-end mt-4"><button onClick={save} disabled={saving} className="rounded-lg px-6 py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{saving ? 'Saving…' : 'Save changes'}</button></div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function EmployeeDirectory({ isAdmin, onOpenProfile }) {
  const [rows, setRows] = useState([]);
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState('');
  const [branches, setBranches] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [reporting, setReporting] = useState({ hr: [], admins: [] });
  const [shifts, setShifts] = useState([]);
  const [imagekitReady, setImagekitReady] = useState(false);
  const load = () => hrApi('/employees').then(setRows).catch(() => {});
  useEffect(() => {
    load();
    if (isAdmin) {
      hrApi('/branches').then(setBranches).catch(() => {});
      hrApi('/departments').then(setDepartments).catch(() => {});
      hrApi('/reporting-options').then(setReporting).catch(() => {});
      hrApi('/shifts').then(setShifts).catch(() => {});
      hrApi('/imagekit').then((c) => setImagekitReady(c.configured)).catch(() => {});
    }
  }, [isAdmin]);
  const reportingOptions = [
    ...reporting.hr.map((h) => ({ value: `hr:${h.id}`, label: `${h.name}${h.designation ? ` · ${h.designation}` : ''} (HR)` })),
    ...reporting.admins.map((a) => ({ value: `admin:${a.id}`, label: `${a.name} (Admin)` })),
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-extrabold text-[#050A1F]">Employees</h1>
        {isAdmin && <button onClick={() => setShow(true)} className="rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ background: ORANGE }}>+ Add employee</button>}
      </div>
      {msg && <div className="mb-4 rounded-lg bg-green-50 border border-green-200 px-3 py-2.5 text-sm text-green-700">{msg}</div>}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr className="text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            <th className="px-4 py-3">Name</th><th className="px-4 py-3">Emp ID</th><th className="px-4 py-3">Role</th>
            <th className="px-4 py-3">Department</th><th className="px-4 py-3">Branch</th><th className="px-4 py-3">Profile</th><th className="px-4 py-3"></th>
          </tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u._id} className={`border-t border-slate-100 ${u.active ? '' : 'opacity-50'}`}>
                <td className="px-4 py-3"><div className="flex items-center gap-2"><Avatar name={u.name} src={u.avatar} size={30} /><span className="font-bold text-[#050A1F]">{u.name}</span></div></td>
                <td className="px-4 py-3 text-slate-500">{u.employeeId || '—'}</td>
                <td className="px-4 py-3"><span className="text-[10px] font-bold rounded px-1.5 py-0.5 bg-slate-100 text-slate-600">{ROLE_LABELS[u.type] || u.type}</span></td>
                <td className="px-4 py-3 text-slate-500">{u.department || '—'}</td>
                <td className="px-4 py-3 text-slate-500">{u.branch}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full" style={{ width: `${u.completion}%`, background: u.completion >= 100 ? '#059669' : u.completion >= 50 ? '#FF6A00' : '#EF4444' }} /></div>
                    <span className="text-[11px] font-bold text-slate-500">{u.completion}%</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right">{isAdmin && <button onClick={() => onOpenProfile(u._id)} className="text-xs font-bold text-blue-500">View profile</button>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-sm">No employees yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {show && <AddUserModal branches={branches} departments={departments} reportingOptions={reportingOptions} shifts={shifts} imagekitReady={imagekitReady} onClose={() => setShow(false)} onCreated={(n) => { setMsg(`Employee added: ${n}`); load(); }} />}
    </div>
  );
}

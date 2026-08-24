import React, { useState, useEffect } from 'react';
import { API_BASE } from './config.js';

// Same icon set used across the Site Analysis platform, redrawn here so the HR
// portal doesn't pull in the CRM module.
const IconBase = ({ size = 16, children, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>{children}</svg>
);
export const Icon = {
  Pencil: (p) => <IconBase {...p}><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" /><path d="M15 6l3 3" /></IconBase>,
  Edit: (p) => <IconBase {...p}><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" /><path d="M15 6l3 3" /></IconBase>,
  Trash: (p) => <IconBase {...p}><path d="M4 7h16" /><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" /><path d="M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7" /><path d="M10 11v6M14 11v6" /></IconBase>,
  Globe: (p) => <IconBase {...p}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.4 2.5 14.6 0 17M12 3.5c-2.5 2.4-2.5 14.6 0 17" /></IconBase>,
  Plus: (p) => <IconBase {...p}><path d="M12 5v14M5 12h14" /></IconBase>,
  Doc: (p) => <IconBase {...p}><path d="M6 2h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" /><path d="M14 2v6h6" /></IconBase>,
};

// A read-only two-column info grid for "view" mode. Empty values show a dash.
export function InfoGrid({ items }) {
  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-4">
      {items.map(([label, value], i) => (
        <div key={i} className={label === 'Home address' ? 'col-span-2' : ''}>
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
          <div className="text-sm font-semibold text-[#050A1F] mt-0.5 whitespace-pre-wrap">{value || <span className="text-slate-300">—</span>}</div>
        </div>
      ))}
    </div>
  );
}

// Format a date as "12 Aug 1998"; returns '' for empty input.
export function fmtLong(d) {
  if (!d) return '';
  const x = new Date(d); if (isNaN(x)) return String(d);
  return x.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

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

export const ROLE_LABELS = { hr: 'HR', recruiter: 'HR Recruiter', manager: 'Manager', tl: 'Team Lead', senior: 'Senior Executive', junior: 'Junior Executive', trainee: 'Trainee', intern: 'Intern', employee: 'Employee', director: 'Director' };

// Normalise a person's name to Title Case (first letter of each word capital,
// rest lowercase) so ALL-CAPS or lowercase entries display uniformly. Leaves
// short all-caps tokens that look like initials (e.g. "JK") alone-ish by still
// title-casing; keeps intra-word punctuation like O'Brien / Jean-Paul.
export function titleCase(name) {
  if (!name) return '';
  return String(name).toLowerCase().replace(/([a-z\u00C0-\u024F])([a-z\u00C0-\u024F]*)/g, (m, a, b) => a.toUpperCase() + b);
}
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
export function AddUserModal({ presetType, branches, departments, reportingOptions, shifts = [], imagekitReady, isAdmin, lockBranch, onClose, onCreated }) {
  const blank = {
    name: '', employeeId: '', email: '', password: '', phone: '+91 ', designation: '',
    type: presetType || 'employee', branch: lockBranch || branches[0]?.name || 'Bhubaneswar', department: '', joiningDate: '',
    reportsTo: '', branchIncharge: false, avatar: '', shiftId: '', targets: { dailyInterviews: 0, monthlyOnboarding: 0 },
    isHrManager: false, hrManagerScope: '', canPostAnnouncements: false,
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
    if (!f.shiftId) return setErr('Please assign a shift.');
    setBusy(true);
    try {
      await hrApi('/users', { method: 'POST', body: JSON.stringify({ ...f, ...splitReports(f.reportsTo) }) });
      onCreated(f.name); onClose();
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-y-auto">
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
          <Field label="Branch"><select className={inputCls} value={f.branch} onChange={(e) => set({ branch: e.target.value })} disabled={!!lockBranch}>
            {branches.map((b) => <option key={b._id} value={b.name}>{b.name}</option>)}
          </select>{lockBranch && <div className="text-[10px] text-slate-400 mt-1">Locked to your branch.</div>}</Field>
          <Field label="Department"><select className={inputCls} value={f.department} onChange={(e) => set({ department: e.target.value })}>
            <option value="">— select —</option>
            {departments.map((d) => <option key={d._id} value={d.name}>{d.name}</option>)}
          </select></Field>
          <Field label="Joining date"><input type="date" className={inputCls} value={f.joiningDate} onChange={(e) => set({ joiningDate: e.target.value })} /></Field>
          <Field label="Reports to"><select className={inputCls} value={f.reportsTo} onChange={(e) => set({ reportsTo: e.target.value })}>
            <option value="">— none —</option>
            {reportingOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select></Field>
          <Field label="Shift *"><select className={inputCls} value={f.shiftId} onChange={(e) => set({ shiftId: e.target.value })}>
            <option value="">— select shift —</option>
            {shifts.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
          </select></Field>
          <div className="flex items-center gap-2 pt-6">
            <input type="checkbox" id="inc-new" checked={f.branchIncharge} onChange={(e) => set({ branchIncharge: e.target.checked })} />
            <label htmlFor="inc-new" className="text-sm font-semibold text-slate-600">Make branch in-charge</label>
          </div>
        </div>

        {/^(hr|human resource|human resources)$/i.test((f.department || '').trim()) && (
          <div className="mt-4 rounded-xl bg-slate-50 p-4">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">HR targets</div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Daily scheduling target"><input type="number" min="0" className={inputCls} value={f.targets.dailyInterviews} onChange={(e) => set({ targets: { ...f.targets, dailyInterviews: e.target.value } })} /></Field>
              <Field label="Monthly hiring target"><input type="number" min="0" className={inputCls} value={f.targets.monthlyOnboarding} onChange={(e) => set({ targets: { ...f.targets, monthlyOnboarding: e.target.value } })} /></Field>
            </div>
          </div>
        )}

        {isAdmin && (
          <div className="mt-4 space-y-2">
            <div className="rounded-lg bg-orange-50 border border-orange-100 px-3 py-2.5">
              <label className="text-sm text-slate-600 block mb-1"><b>HR Manager access</b> — scope of management privileges</label>
              <select className={inputCls} value={f.hrManagerScope || ''} onChange={(e) => set({ hrManagerScope: e.target.value, isHrManager: !!e.target.value })}>
                <option value="">Not a manager</option>
                <option value="all">All branches (full HR management)</option>
                <option value="Bhubaneswar">Bhubaneswar only</option>
                <option value="Kolkata">Kolkata only</option>
              </select>
              <div className="text-[11px] text-slate-400 mt-1">Managers can manage employees, attendance & leave for their scope. No access to admin settings.</div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={f.canPostAnnouncements} onChange={(e) => set({ canPostAnnouncements: e.target.checked })} /> Can post announcements to the notice board</label>
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
const HIRING_DOC_TYPES = ['Offer letter', 'Appointment letter', 'ID proof', 'Address proof', 'Education certificate', 'Experience letter', 'Relieving letter', 'Salary slip', 'Bank details', 'Photograph', 'Other'];
// Types HR collects at onboarding, uploaded one by one into the employee's
// ImageKit folder. "Other" lets HR type a custom document name.
const ONBOARD_DOC_TYPES = ['Aadhar Card', 'Voter ID Card', 'Offer Letter', 'Experience Letter', 'Education Certificates', 'Other'];

// Performance card kinds — praise/review are positive/neutral notes; yellow and
// red are conduct flags (minor / major).
const PERF_KINDS = {
  praise: { label: 'Appreciation', icon: '🌟', bg: '#DCFCE7', border: '#BBF7D0' },
  review: { label: 'Review', icon: '📝', bg: '#EFF6FF', border: '#BFDBFE' },
  yellow: { label: 'Yellow card', icon: '🟨', bg: '#FEF9C3', border: '#FDE68A' },
  red: { label: 'Red card', icon: '🟥', bg: '#FEE2E2', border: '#FECACA' },
};

// Icons for the user-detail tabs (stroke SVG paths), matching candidate detail.
const PROFILE_TAB_ICONS = {
  timeline: 'M12 8v4l3 3 M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z',
  personal: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  payroll: 'M12 1v22 M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  education: 'M22 10L12 5 2 10l10 5 10-5z M6 12v5c0 1 2 3 6 3s6-2 6-3v-5',
  employment: 'M20 7h-4V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z',
  onboarding: 'M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
};
function ProfileTabIcon({ name }) {
  const d = PROFILE_TAB_ICONS[name]; if (!d) return null;
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d.split(' M').map((seg, i) => <path key={i} d={(i ? 'M' : '') + seg} />)}</svg>;
}

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
  const [resetOpen, setResetOpen] = useState(false);
  const [editMode, setEditMode] = useState(false); // legacy (kept for other tabs)
  const [editSec, setEditSec] = useState(null); // 'personal' | 'bank' | 'documents' — which heading is being edited
  const [payModal, setPayModal] = useState(null); // {reason} when adding a salary record
  const [perfModal, setPerfModal] = useState(null); // {kind} when adding a performance card

  const canEditLocked = !!(row && row.canEditLocked); // HR/Admin viewing
  const canEditPayroll = !!(row && row.canEditPayroll); // Admin or HR Manager only
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

  // Payroll history: each entry records the CTC at a point in time with a reason
  // (Joining / Increment / Appraisal / Promotion / Revision). Kept newest-first.
  const payHistory = () => (p.payrollHistory || []).slice().sort((a, b) => (b.effectiveDate || '').localeCompare(a.effectiveDate || ''));
  const addPayEntry = (entry) => setP((s) => ({ ...s, payrollHistory: [...(s.payrollHistory || []), entry] }));
  const delPayEntry = (id) => setP((s) => ({ ...s, payrollHistory: (s.payrollHistory || []).filter((x) => x.id !== id) }));
  // Performance cards: dated notes with a kind — praise, review, yellow (minor
  // issue) or red (major issue).
  const perfCards = () => (p.performanceCards || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const addPerfCard = (card) => setP((s) => ({ ...s, performanceCards: [...(s.performanceCards || []), card] }));
  const delPerfCard = (id) => setP((s) => ({ ...s, performanceCards: (s.performanceCards || []).filter((x) => x.id !== id) }));

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
  const TABS = [['timeline', 'Timeline'], ['personal', 'Personal Information'], ['payroll', 'Payroll & Compensation'], ['education', 'Professional & Education'], ['documents', 'Documents'], ['attendance', 'Attendance'], ['leave', 'Leave'], ['onboarding', 'Onboarding']];

  // A read-only identity field for the header meta rows.
  const initials = (row.name || '?').split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase();
  const comp = row.completion || 0;
  const compColor = comp >= 100 ? '#059669' : comp >= 50 ? '#FF6A00' : '#EF4444';
  // Tenure (how long with the company) from the joining date.
  const tenure = (() => {
    if (!row.joiningDate) return null;
    const j = new Date(row.joiningDate); const n = new Date();
    let months = (n.getFullYear() - j.getFullYear()) * 12 + (n.getMonth() - j.getMonth());
    if (n.getDate() < j.getDate()) months -= 1;
    if (months < 0) return null;
    const y = Math.floor(months / 12); const m = months % 12;
    if (y === 0 && m === 0) return 'New this month';
    return [y ? `${y} yr${y === 1 ? '' : 's'}` : '', m ? `${m} mo${m === 1 ? '' : 's'}` : ''].filter(Boolean).join(' ');
  })();
  const fmtDM = (d) => { if (!d) return null; const x = new Date(d); return x.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); };

  return (
    <div>
      {err && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">{err}</div>}
      {msg && <div className="mb-4 rounded-lg bg-green-50 border border-green-200 px-3 py-2.5 text-sm text-green-700">{msg}</div>}

      <div className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden">
        {/* Header banner (matches candidate detail page) */}
        <div className="p-6 border-b border-slate-100" style={{ background: 'linear-gradient(180deg,#fafbff,#fff)' }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-4">
              <div className="relative shrink-0">
                <div className="w-16 h-16 rounded-xl bg-orange-100 text-orange-700 flex items-center justify-center text-xl font-extrabold overflow-hidden">
                  {avatar ? <img src={avatar} alt="" className="w-full h-full object-cover" /> : initials}
                </div>
                {(canEditLocked || isSelf) && (
                  <label className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-[#050A1F] text-white flex items-center justify-center cursor-pointer text-[10px] border-2 border-white" title="Change photo">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
                    <input type="file" accept="image/*" className="hidden" onChange={uploadAvatar} />
                  </label>
                )}
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="text-xl font-extrabold text-[#050A1F]">{row.name}</div>
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-600">{roleLabel}</span>
                  {row.active === false && <span className="rounded-full bg-red-100 text-red-600 px-2 py-0.5 text-[10px] font-bold">Inactive</span>}
                </div>
                {/* Quick-glance chips: tenure + birthday */}
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  {tenure && <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 text-blue-700 px-2.5 py-1 text-[11px] font-bold">🗓️ {tenure} with company</span>}
                  {row.birthday && <span className="inline-flex items-center gap-1 rounded-full bg-pink-50 text-pink-600 px-2.5 py-1 text-[11px] font-bold">🎂 {fmtDM(row.birthday)}</span>}
                  {row.maritalStatus === 'married' && row.anniversary && <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 text-purple-600 px-2.5 py-1 text-[11px] font-bold">💍 {fmtDM(row.anniversary)}</span>}
                </div>
                <div className="mt-2 text-sm text-slate-500 space-y-0.5">
                  {row.email && <div>✉️ {row.email}</div>}
                  <div className="flex flex-wrap gap-x-4">
                    {row.branch && <span>📍 {row.branch}</span>}
                    {row.department && <span>🏢 {row.department}</span>}
                    {row.employeeId && <span>🆔 {row.employeeId}</span>}
                  </div>
                  <div className="flex flex-wrap gap-x-4 text-xs text-slate-400 pt-1">
                    {row.joiningDate && <span>Joined: <b className="text-slate-600">{row.joiningDate}</b></span>}
                    <span>Reports to: <b className="text-slate-600">{reportsToName}</b></span>
                    {row.shift && <span>Shift: <b className="text-slate-600">{row.shift.name}</b></span>}
                  </div>
                  <div className="flex items-center gap-2 pt-2">
                    <div className="w-28 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full" style={{ width: `${comp}%`, background: compColor }} /></div>
                    <span className="text-[11px] font-bold" style={{ color: compColor }}>{comp}% profile complete</span>
                  </div>
                </div>
              </div>
            </div>
            {canEditLocked && !isSelf && (
              <button onClick={() => setResetOpen(true)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 inline-flex items-center gap-1.5 shrink-0">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg> Reset password
              </button>
            )}
          </div>
          {isSelf && <p className="text-[11px] text-slate-400 mt-3">These details are managed by HR. Contact your HR team for corrections.</p>}
        </div>

        {/* Tabs (icons, matching candidate detail) */}
        <div className="flex gap-0.5 px-3 border-b border-slate-100 overflow-x-auto">
          {TABS.map(([t, l]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-[13px] font-bold whitespace-nowrap border-b-2 -mb-px transition ${tab === t ? 'border-orange-500 text-orange-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
              <ProfileTabIcon name={t} />
              <span>{l}</span>
            </button>
          ))}
        </div>
        <div className="p-6 min-h-[340px]">
          <div>
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

            {/* PERSONAL / BANK / DOCUMENTS — each heading edits independently */}
            {tab === 'personal' && (() => {
              const mayEdit = isSelf || canEditLocked;
              const saveSec = async () => { await save(); setEditSec(null); };
              const SectionHead = ({ id, title }) => (
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-extrabold text-[#050A1F]">{title}</div>
                  {mayEdit && (editSec === id
                    ? <div className="flex gap-2"><button onClick={() => { setEditSec(null); reload(); }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">Cancel</button><button onClick={saveSec} disabled={saving} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{saving ? 'Saving…' : 'Save'}</button></div>
                    : <button onClick={() => setEditSec(id)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 inline-flex items-center gap-1.5"><Icon.Edit size={13} /> Edit</button>)}
                </div>
              );
              return (
                <div className="space-y-8">
                  {/* Personal details */}
                  <div>
                    <SectionHead id="personal" title="Personal details" />
                    {editSec === 'personal' ? (
                      <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-2"><Field label="Home address"><textarea className={inputCls} rows={2} value={p.personal?.homeAddress ?? ''} onChange={(e) => patch('personal', { homeAddress: e.target.value })} /></Field></div>
                        <Field label="Personal email"><input className={inputCls} value={p.personal?.personalEmail ?? ''} onChange={(e) => patch('personal', { personalEmail: e.target.value })} /></Field>
                        <Field label="Date of birth"><input type="date" className={inputCls} value={p.personal?.dob ?? ''} onChange={(e) => patch('personal', { dob: e.target.value })} /></Field>
                        <Field label="Marital status"><select className={inputCls} value={p.personal?.maritalStatus ?? ''} onChange={(e) => patch('personal', { maritalStatus: e.target.value })}><option value="">— select —</option><option>Single</option><option>Married</option></select></Field>
                        {p.personal?.maritalStatus === 'Married' && <Field label="Anniversary date"><input type="date" className={inputCls} value={p.personal?.anniversary ?? ''} onChange={(e) => patch('personal', { anniversary: e.target.value })} /></Field>}
                      </div>
                    ) : (
                      <InfoGrid items={[
                        ['Home address', p.personal?.homeAddress],
                        ['Personal email', p.personal?.personalEmail],
                        ['Date of birth', fmtLong(p.personal?.dob)],
                        ['Marital status', p.personal?.maritalStatus],
                        ...(p.personal?.maritalStatus === 'Married' ? [['Anniversary', fmtLong(p.personal?.anniversary)]] : []),
                      ]} />
                    )}
                  </div>

                  {/* Bank details */}
                  <div>
                    <SectionHead id="bank" title="Bank details" />
                    {editSec === 'bank' ? (
                      <div className="grid grid-cols-2 gap-4">
                        <Field label="Bank name"><input className={inputCls} value={p.bank?.bankName ?? ''} onChange={(e) => patch('bank', { bankName: e.target.value })} /></Field>
                        <Field label="Account number"><input className={inputCls} value={p.bank?.accountNumber ?? ''} onChange={(e) => patch('bank', { accountNumber: e.target.value })} /></Field>
                        <Field label="IFSC code"><input className={inputCls} value={p.bank?.ifsc ?? ''} onChange={(e) => patch('bank', { ifsc: e.target.value })} /></Field>
                        <Field label="Account type"><select className={inputCls} value={p.bank?.accountType ?? ''} onChange={(e) => patch('bank', { accountType: e.target.value })}><option value="">— select —</option><option>Saving</option><option>Office Salary Account</option></select></Field>
                      </div>
                    ) : (
                      <InfoGrid items={[
                        ['Bank name', p.bank?.bankName],
                        ['Account number', p.bank?.accountNumber],
                        ['IFSC code', p.bank?.ifsc],
                        ['Account type', p.bank?.accountType],
                      ]} />
                    )}
                  </div>

                  {/* Documents — HR uploads onboarding documents one by one */}
                  <div>
                    <SectionHead id="documents" title="Documents" />
                    {editSec === 'documents' ? (
                      <div className="space-y-3">
                        {(p.documents || []).map((d, i) => (
                          <div key={i} className="grid grid-cols-12 gap-2 items-end border border-slate-100 rounded-lg p-3">
                            <div className="col-span-4"><Field label="Type"><select className={inputCls} value={ONBOARD_DOC_TYPES.includes(d.type) ? d.type : 'Other'} onChange={(e) => setDoc(i, { type: e.target.value, customType: e.target.value === 'Other' ? (d.customType || '') : '' })}>{ONBOARD_DOC_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field></div>
                            {(d.type === 'Other' || !ONBOARD_DOC_TYPES.includes(d.type)) && <div className="col-span-4"><Field label="Document name"><input className={inputCls} value={d.customType ?? ''} onChange={(e) => setDoc(i, { customType: e.target.value })} placeholder="e.g. PAN Card" /></Field></div>}
                            <div className={`${(d.type === 'Other' || !ONBOARD_DOC_TYPES.includes(d.type)) ? 'col-span-3' : 'col-span-7'}`}>{d.url ? <a href={d.url} target="_blank" rel="noreferrer" className="text-xs font-bold text-blue-500">View file ↗</a> : <label className="inline-block rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold cursor-pointer hover:bg-slate-50">Upload<input type="file" className="hidden" onChange={(e) => e.target.files[0] && uploadDoc(e.target.files[0], (url) => setDoc(i, { url }))} /></label>}</div>
                            <div className="col-span-1 text-right"><button onClick={() => delDoc(i)} className="text-slate-300 hover:text-red-500"><Icon.Trash size={15} /></button></div>
                          </div>
                        ))}
                        <button onClick={() => setP((s) => ({ ...s, documents: [...(s.documents || []), { type: 'Aadhar Card', customType: '', url: '' }] }))} className="text-xs font-bold text-[#FF4500]">+ Add document</button>
                      </div>
                    ) : (
                      (p.documents || []).length === 0 ? <div className="text-sm text-slate-400">No documents added.</div> : (
                        <div className="grid grid-cols-2 gap-2">
                          {(p.documents || []).map((d, i) => (
                            <div key={i} className="flex items-center justify-between border border-slate-100 rounded-lg px-3 py-2.5">
                              <div className="min-w-0 flex items-center gap-2"><span className="text-slate-400"><Icon.Doc size={16} /></span><div className="text-sm font-semibold text-slate-700 truncate">{d.type === 'Other' ? (d.customType || 'Other') : d.type}</div></div>
                              {d.url && <a href={d.url} target="_blank" rel="noreferrer" className="text-xs font-bold text-blue-500 shrink-0">View ↗</a>}
                            </div>
                          ))}
                        </div>
                      )
                    )}
                  </div>
                </div>
              );
            })()}

            {/* PAYROLL & COMPENSATION + PERFORMANCE (Admin / HR Manager edit) */}
            {tab === 'payroll' && (
              <div className="space-y-8">
                {!canEditPayroll && <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5 text-xs text-slate-500">This section is maintained by HR. You have view-only access.</div>}

                {/* Salary history */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="text-sm font-extrabold text-[#050A1F]">Salary history</div>
                      <div className="text-xs text-slate-400">Joining package, then each increment / appraisal over time.</div>
                    </div>
                    {canEditPayroll && <button onClick={() => setPayModal({ reason: (p.payrollHistory || []).length ? 'Increment' : 'Joining' })} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white inline-flex items-center gap-1.5" style={{ background: ORANGE }}><Icon.Plus size={13} /> Add salary record</button>}
                  </div>
                  {payHistory().length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">No salary records yet.{canEditPayroll && ' Add the joining package to start.'}</div>
                  ) : (
                    <div className="relative pl-6">
                      <div className="absolute left-1.5 top-1 bottom-1 w-px bg-slate-200" />
                      {payHistory().map((e, i) => (
                        <div key={e.id} className="relative mb-4">
                          <span className="absolute -left-[18px] top-1.5 w-3 h-3 rounded-full border-2 border-white" style={{ background: i === 0 ? '#16A34A' : '#FF6A00' }} />
                          <div className="bg-white rounded-xl border border-slate-100 p-4 flex items-center justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-lg font-extrabold text-[#050A1F]">₹{Number(e.ctc || 0).toLocaleString('en-IN')}</span>
                                <span className="text-[10px] font-bold rounded-full px-2 py-0.5" style={{ background: (e.reason === 'Joining' ? '#DCFCE7' : '#FFF7ED'), color: (e.reason === 'Joining' ? '#16A34A' : '#C2410C') }}>{e.reason}</span>
                              </div>
                              <div className="text-xs text-slate-400 mt-0.5">Effective {fmtLong(e.effectiveDate)}{e.note ? ` · ${e.note}` : ''}</div>
                            </div>
                            {canEditPayroll && <button onClick={() => delPayEntry(e.id)} className="text-slate-300 hover:text-red-500 shrink-0"><Icon.Trash size={15} /></button>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {canEditPayroll && payHistory().length > 0 && <div className="flex justify-end mt-2"><button onClick={save} disabled={saving} className="rounded-lg px-5 py-2 text-xs font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{saving ? 'Saving…' : 'Save changes'}</button></div>}
                </div>

                {/* Performance history */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="text-sm font-extrabold text-[#050A1F]">Performance history</div>
                      <div className="text-xs text-slate-400">Reviews and conduct notes. Yellow = minor issue, Red = major issue.</div>
                    </div>
                    {canEditPayroll && <button onClick={() => setPerfModal({ kind: 'praise' })} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white inline-flex items-center gap-1.5" style={{ background: ORANGE }}><Icon.Plus size={13} /> Add review</button>}
                  </div>
                  {(() => {
                    const yellow = (p.performanceCards || []).filter((c) => c.kind === 'yellow').length;
                    const red = (p.performanceCards || []).filter((c) => c.kind === 'red').length;
                    return (yellow || red) ? (
                      <div className="flex gap-2 mb-3">
                        {yellow > 0 && <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs font-bold text-amber-700"><span className="w-3 h-4 rounded-sm bg-amber-400" /> {yellow} yellow card{yellow === 1 ? '' : 's'}</span>}
                        {red > 0 && <span className="inline-flex items-center gap-1.5 rounded-lg bg-red-50 border border-red-200 px-3 py-1.5 text-xs font-bold text-red-700"><span className="w-3 h-4 rounded-sm bg-red-500" /> {red} red card{red === 1 ? '' : 's'}</span>}
                      </div>
                    ) : null;
                  })()}
                  {perfCards().length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">No performance notes yet.</div>
                  ) : (
                    <div className="space-y-2">
                      {perfCards().map((c) => {
                        const meta = PERF_KINDS[c.kind] || PERF_KINDS.review;
                        return (
                          <div key={c.id} className="bg-white rounded-xl border p-3 flex items-start gap-3" style={{ borderColor: meta.border }}>
                            <span className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-base" style={{ background: meta.bg }}>{meta.icon}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-bold text-[#050A1F]">{meta.label}</span>
                                {c.title && <span className="text-sm text-slate-600">· {c.title}</span>}
                                <span className="text-[11px] text-slate-400">{fmtLong(c.date)}{c.by ? ` · ${c.by}` : ''}</span>
                              </div>
                              {c.note && <div className="text-sm text-slate-500 mt-1 whitespace-pre-wrap">{c.note}</div>}
                            </div>
                            {canEditPayroll && <button onClick={() => delPerfCard(c.id)} className="text-slate-300 hover:text-red-500 shrink-0"><Icon.Trash size={15} /></button>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {canEditPayroll && perfCards().length > 0 && <div className="flex justify-end mt-2"><button onClick={save} disabled={saving} className="rounded-lg px-5 py-2 text-xs font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{saving ? 'Saving…' : 'Save changes'}</button></div>}
                </div>
              </div>
            )}

            {/* EDUCATION (employee-editable) */}
            {tab === 'education' && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-extrabold text-[#050A1F]">Professional & education</div>
                  <button onClick={() => setP((s) => ({ ...s, eduRecords: [...(s.eduRecords || []), { id: `edu${Date.now()}`, level: 'Graduation', course: '', institution: '', year: '', percent: '', url: '' }] }))} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white inline-flex items-center gap-1.5" style={{ background: ORANGE }}><Icon.Plus size={13} /> Add qualification</button>
                </div>
                {(p.eduRecords || []).length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">No qualifications added yet.</div>
                ) : (
                  <div className="space-y-3">
                    {(p.eduRecords || []).map((r, i) => {
                      const setEdu = (obj) => setP((s) => ({ ...s, eduRecords: (s.eduRecords || []).map((x, idx) => idx === i ? { ...x, ...obj } : x) }));
                      const delEdu = () => setP((s) => ({ ...s, eduRecords: (s.eduRecords || []).filter((_, idx) => idx !== i) }));
                      return (
                        <div key={r.id || i} className="border border-slate-100 rounded-xl p-4">
                          <div className="grid grid-cols-12 gap-3 items-end">
                            <div className="col-span-3"><Field label="Level"><select className={inputCls} value={r.level} onChange={(e) => setEdu({ level: e.target.value })}>{['10th', '+2 / Diploma', 'Graduation', 'Post-graduation', 'Certification', 'Other'].map((l) => <option key={l}>{l}</option>)}</select></Field></div>
                            <div className="col-span-4"><Field label="Course / stream"><input className={inputCls} value={r.course || ''} onChange={(e) => setEdu({ course: e.target.value })} /></Field></div>
                            <div className="col-span-5"><Field label="Institution / board"><input className={inputCls} value={r.institution || ''} onChange={(e) => setEdu({ institution: e.target.value })} /></Field></div>
                            <div className="col-span-3"><Field label="Year"><input className={inputCls} value={r.year || ''} onChange={(e) => setEdu({ year: e.target.value })} /></Field></div>
                            <div className="col-span-3"><Field label="% / CGPA"><input className={inputCls} value={r.percent || ''} onChange={(e) => setEdu({ percent: e.target.value })} /></Field></div>
                            <div className="col-span-4 flex items-end gap-2">{r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="text-xs font-bold text-blue-500 pb-2.5">View certificate ↗</a> : <label className="inline-block rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold cursor-pointer hover:bg-slate-50">Upload certificate<input type="file" className="hidden" onChange={(e) => e.target.files[0] && uploadDoc(e.target.files[0], (url) => setEdu({ url }))} /></label>}</div>
                            <div className="col-span-2 flex items-end justify-end"><button onClick={delEdu} className="text-slate-300 hover:text-red-500 pb-2.5"><Icon.Trash size={16} /></button></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="flex justify-end mt-4"><button onClick={save} disabled={saving} className="rounded-lg px-6 py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{saving ? 'Saving…' : 'Save changes'}</button></div>
              </div>
            )}

            {/* DOCUMENTS (hiring documents uploaded at joining) */}
            {tab === 'documents' && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="text-sm font-extrabold text-[#050A1F]">Hiring documents</div>
                  <button onClick={() => setP((s) => ({ ...s, hiringDocs: [...(s.hiringDocs || []), { id: `doc${Date.now()}`, name: '', type: 'Offer letter', url: '' }] }))} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white inline-flex items-center gap-1.5" style={{ background: ORANGE }}><Icon.Plus size={13} /> Add document</button>
                </div>
                <div className="text-xs text-slate-400 mb-4">Upload all documents collected during hiring — offer letter, ID proofs, certificates, past experience letters, etc.</div>
                {(p.hiringDocs || []).length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">No documents uploaded yet.</div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {(p.hiringDocs || []).map((d, i) => {
                      const setD = (obj) => setP((s) => ({ ...s, hiringDocs: (s.hiringDocs || []).map((x, idx) => idx === i ? { ...x, ...obj } : x) }));
                      const delD = () => setP((s) => ({ ...s, hiringDocs: (s.hiringDocs || []).filter((_, idx) => idx !== i) }));
                      return (
                        <div key={d.id || i} className="border border-slate-100 rounded-xl p-3">
                          <div className="flex items-start gap-3">
                            <span className="shrink-0 w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400"><Icon.Doc size={18} /></span>
                            <div className="flex-1 min-w-0 space-y-2">
                              <select className={inputCls + ' py-1.5'} value={d.type} onChange={(e) => setD({ type: e.target.value })}>{HIRING_DOC_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
                              <input className={inputCls + ' py-1.5'} value={d.name || ''} onChange={(e) => setD({ name: e.target.value })} placeholder="Label (optional)" />
                              <div className="flex items-center gap-2">
                                {d.url ? <a href={d.url} target="_blank" rel="noreferrer" className="text-xs font-bold text-blue-500">View ↗</a> : <label className="inline-block rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold cursor-pointer hover:bg-slate-50">Upload file<input type="file" className="hidden" onChange={(e) => e.target.files[0] && uploadDoc(e.target.files[0], (url) => setD({ url }))} /></label>}
                                <button onClick={delD} className="text-slate-300 hover:text-red-500 ml-auto"><Icon.Trash size={15} /></button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="flex justify-end mt-4"><button onClick={save} disabled={saving} className="rounded-lg px-6 py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{saving ? 'Saving…' : 'Save changes'}</button></div>
              </div>
            )}

            {/* ATTENDANCE */}
            {tab === 'attendance' && <AttendanceTab employeeId={id} canManage={canEditPayroll} />}

            {/* LEAVE */}
            {tab === 'leave' && <LeaveTab employeeId={id} canManage={canEditPayroll} />}

            {/* ONBOARDING CHECKLIST */}
            {tab === 'onboarding' && <OnboardingChecklist employeeId={id} canEdit={canEditLocked} />}
          </div>
        </div>
      </div>
      {resetOpen && <ResetPasswordModal user={{ _id: id, name: row.name }} onClose={() => setResetOpen(false)} onDone={() => { setResetOpen(false); setMsg('Password reset.'); }} />}
      {payModal && <SalaryRecordModal initial={payModal} onClose={() => setPayModal(null)} onSave={async (entry) => { addPayEntry(entry); setPayModal(null); setTimeout(save, 0); }} />}
      {perfModal && <PerformanceCardModal by={me?.name} onClose={() => setPerfModal(null)} onSave={async (card) => { addPerfCard(card); setPerfModal(null); setTimeout(save, 0); }} />}
    </div>
  );
}

// Modal: add a salary record (joining package or a later increment/appraisal).
function SalaryRecordModal({ initial, onClose, onSave }) {
  const [ctc, setCtc] = useState('');
  const [reason, setReason] = useState(initial.reason || 'Increment');
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const REASONS = ['Joining', 'Increment', 'Appraisal', 'Promotion', 'Revision'];
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between"><div className="text-lg font-extrabold text-[#050A1F]">Add salary record</div><button onClick={onClose} className="text-slate-400 text-xl leading-none">×</button></div>
        <div className="p-6 space-y-4">
          <Field label="Annual CTC (₹)"><input type="number" className={inputCls} value={ctc} onChange={(e) => setCtc(e.target.value)} placeholder="e.g. 600000" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Reason"><select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map((r) => <option key={r}>{r}</option>)}</select></Field>
            <Field label="Effective date"><input type="date" className={inputCls} value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} /></Field>
          </div>
          <Field label="Note (optional)"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Annual appraisal 2026" /></Field>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={() => { if (!ctc) return; onSave({ id: `pay${Date.now()}`, ctc: Number(ctc), reason, effectiveDate, note }); }} disabled={!ctc} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>Add record</button>
        </div>
      </div>
    </div>
  );
}

// Modal: add a performance card — appreciation, review, or yellow/red conduct flag.
function PerformanceCardModal({ by, onClose, onSave }) {
  const [kind, setKind] = useState('praise');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between"><div className="text-lg font-extrabold text-[#050A1F]">Add performance note</div><button onClick={onClose} className="text-slate-400 text-xl leading-none">×</button></div>
        <div className="p-6 space-y-4">
          <div>
            <div className="text-xs font-bold text-slate-500 mb-2">Type</div>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(PERF_KINDS).map(([k, m]) => (
                <button key={k} onClick={() => setKind(k)} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold ${kind === k ? 'ring-2 ring-orange-300' : ''}`} style={{ background: m.bg, borderColor: m.border, color: '#334155' }}><span>{m.icon}</span>{m.label}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Title"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short summary" /></Field>
            <Field label="Date"><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          </div>
          <Field label="Details"><textarea className={inputCls} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened / feedback…" /></Field>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={() => { if (!title.trim() && !note.trim()) return; onSave({ id: `perf${Date.now()}`, kind, title: title.trim(), note: note.trim(), date, by: by || '' }); }} className="rounded-lg px-5 py-2 text-sm font-bold text-white" style={{ background: ORANGE }}>Add note</button>
        </div>
      </div>
    </div>
  );
}

// ---- Attendance tab: month grid, mark each day, late by login/logout ----
const ATT_STATUS = {
  present: { label: 'Present', short: 'P', bg: '#DCFCE7', fg: '#16A34A' },
  absent: { label: 'Absent', short: 'A', bg: '#FEE2E2', fg: '#DC2626' },
  half_day: { label: 'Half day', short: 'H', bg: '#FEF9C3', fg: '#CA8A04' },
  leave: { label: 'Leave', short: 'L', bg: '#E0E7FF', fg: '#4F46E5' },
  holiday: { label: 'Holiday', short: 'Ho', bg: '#F1F5F9', fg: '#64748B' },
  week_off: { label: 'Week off', short: 'W', bg: '#F1F5F9', fg: '#94A3B8' },
};
function AttendanceTab({ employeeId, canManage }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState(null);
  const [dayModal, setDayModal] = useState(null);
  const load = () => hrApi(`/employees/${employeeId}/attendance?month=${month}`).then(setData).catch(() => setData({ days: [] }));
  useEffect(() => { load(); }, [month, employeeId]);
  if (!data) return <div className="text-slate-400 text-sm">Loading…</div>;
  const byDate = {}; (data.days || []).forEach((d) => { byDate[d.date] = d; });
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const firstDow = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Monday-first
  const cells = []; for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const monthLabel = new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
  const dkey = (d) => `${month}-${String(d).padStart(2, '0')}`;
  const counts = (data.days || []).reduce((a, d) => { a[d.status] = (a[d.status] || 0) + 1; return a; }, {});
  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button onClick={() => { const d = new Date(y, m - 2, 1); setMonth(d.toISOString().slice(0, 7)); }} className="w-8 h-8 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">‹</button>
          <div className="text-sm font-extrabold text-[#050A1F] w-40 text-center">{monthLabel}</div>
          <button onClick={() => { const d = new Date(y, m, 1); setMonth(d.toISOString().slice(0, 7)); }} className="w-8 h-8 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">›</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(ATT_STATUS).map(([k, s]) => counts[k] ? <span key={k} className="text-[11px] font-bold rounded-full px-2 py-0.5" style={{ background: s.bg, color: s.fg }}>{s.label}: {counts[k]}</span> : null)}
        </div>
      </div>
      {!canManage && <div className="mb-3 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-500">View only — attendance is maintained by HR.</div>}
      <div className="grid grid-cols-7 gap-1 mb-1">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="text-center text-[10px] font-bold uppercase tracking-wide text-slate-400 py-1">{d}</div>)}</div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (d === null) return <div key={`b${i}`} className="min-h-[64px]" />;
          const rec = byDate[dkey(d)];
          const st = rec ? (ATT_STATUS[rec.status] || ATT_STATUS.present) : null;
          return (
            <button key={d} onClick={() => canManage && setDayModal({ date: dkey(d), rec: rec || { date: dkey(d), status: 'present' } })}
              className={`min-h-[64px] rounded-lg border p-1.5 text-left ${canManage ? 'hover:border-orange-300' : ''} border-slate-100`} style={st ? { background: st.bg } : {}}>
              <div className="text-[11px] font-bold" style={{ color: st ? st.fg : '#94A3B8' }}>{d}</div>
              {rec && <div className="text-[10px] font-bold mt-0.5" style={{ color: st.fg }}>{st.label}</div>}
              {rec && rec.late && <div className="text-[9px] font-bold text-red-500">Late</div>}
              {rec && rec.loginTime && <div className="text-[9px] text-slate-400">{rec.loginTime}{rec.logoutTime ? `–${rec.logoutTime}` : ''}</div>}
            </button>
          );
        })}
      </div>
      {dayModal && <AttendanceDayModal employeeId={employeeId} day={dayModal} onClose={() => setDayModal(null)} onSaved={() => { setDayModal(null); load(); }} />}
    </div>
  );
}

function AttendanceDayModal({ employeeId, day, onClose, onSaved }) {
  const [status, setStatus] = useState(day.rec.status || 'present');
  const [loginTime, setLoginTime] = useState(day.rec.loginTime || '');
  const [logoutTime, setLogoutTime] = useState(day.rec.logoutTime || '');
  const [note, setNote] = useState(day.rec.note || '');
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { await hrApi(`/employees/${employeeId}/attendance/${day.date}`, { method: 'PUT', body: JSON.stringify({ status, loginTime, logoutTime, note }) }); onSaved(); } catch (e) { alert(e.message); setBusy(false); } };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between"><div className="text-lg font-extrabold text-[#050A1F]">{fmtLong(day.date)}</div><button onClick={onClose} className="text-slate-400 text-xl leading-none">×</button></div>
        <div className="p-6 space-y-4">
          <div>
            <div className="text-xs font-bold text-slate-500 mb-2">Status</div>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(ATT_STATUS).map(([k, s]) => <button key={k} onClick={() => setStatus(k)} className={`rounded-lg px-2 py-2 text-xs font-bold border ${status === k ? 'ring-2 ring-orange-300' : ''}`} style={{ background: s.bg, color: s.fg, borderColor: 'transparent' }}>{s.label}</button>)}
            </div>
          </div>
          {(status === 'present' || status === 'half_day') && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Login time"><input type="time" className={inputCls} value={loginTime} onChange={(e) => setLoginTime(e.target.value)} /></Field>
              <Field label="Logout time"><input type="time" className={inputCls} value={logoutTime} onChange={(e) => setLogoutTime(e.target.value)} /></Field>
            </div>
          )}
          <Field label="Note (optional)"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// ---- Leave tab: allocation, balances, records; probation/notice → unpaid ----
const LEAVE_TYPES = [['casual', 'Casual leave'], ['medical', 'Medical leave'], ['privilege', 'Privilege leave'], ['wfh', 'Work from home']];
function LeaveTab({ employeeId, canManage }) {
  const [data, setData] = useState(null);
  const [addModal, setAddModal] = useState(false);
  const [allocModal, setAllocModal] = useState(false);
  const load = () => hrApi(`/employees/${employeeId}/leave`).then(setData).catch(() => setData({ leaves: [] }));
  useEffect(() => { load(); }, [employeeId]);
  if (!data) return <div className="text-slate-400 text-sm">Loading…</div>;
  const del = async (id) => { if (!window.confirm('Remove this leave record?')) return; try { await hrApi(`/employees/${employeeId}/leave/${id}`, { method: 'DELETE' }); load(); } catch (e) { alert(e.message); } };
  const setCategory = async (categoryId) => { try { await hrApi(`/employees/${employeeId}/leave-category`, { method: 'PUT', body: JSON.stringify({ categoryId, clearOverride: true }) }); load(); } catch (e) { alert(e.message); } };
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="text-sm font-extrabold text-[#050A1F]">Leave balances</div>
          {(data.categories || []).length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Category</span>
              <select disabled={!canManage} value={data.leaveCategory || 'default'} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-bold disabled:opacity-60">
                {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
        </div>
        {canManage && <div className="flex gap-2"><button onClick={() => setAllocModal(true)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">Override allocation</button><button onClick={() => setAddModal(true)} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white inline-flex items-center gap-1.5" style={{ background: ORANGE }}><Icon.Plus size={13} /> Record leave</button></div>}
      </div>
      <div className="grid grid-cols-4 gap-3">
        {LEAVE_TYPES.map(([k, label]) => {
          const alloc = data.allocation[k] || 0; const used = data.usedPaid[k] || 0; const bal = data.balance[k] ?? (alloc - used);
          return (
            <div key={k} className="rounded-2xl border border-slate-200/70 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
              <div className="text-2xl font-extrabold text-[#050A1F] mt-1">{k === 'wfh' ? used : bal}<span className="text-sm font-bold text-slate-300"> / {alloc}</span></div>
              <div className="text-[11px] text-slate-400 mt-0.5">{k === 'wfh' ? `${used} used` : `${used} used · ${bal} left`}</div>
            </div>
          );
        })}
      </div>

      {canManage && <AttendanceDeductionCard employeeId={employeeId} />}

      <div>
        <div className="text-sm font-extrabold text-[#050A1F] mb-3">Leave records</div>
        {(data.leaves || []).length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">No leave taken yet.</div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden divide-y divide-slate-50">
            {data.leaves.map((l) => {
              const label = (LEAVE_TYPES.find(([k]) => k === l.type) || [null, l.type])[1];
              return (
                <div key={l._id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="font-semibold text-slate-700 w-36">{label}</span>
                  <span className="text-slate-500">{fmtLong(l.date)}</span>
                  <span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-slate-100 text-slate-500">{l.duration === 'half' ? 'Half day' : 'Full day'}</span>
                  <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${l.paid ? 'bg-green-100 text-green-600' : 'bg-amber-100 text-amber-700'}`}>{l.paid ? 'Paid' : 'Unpaid'}</span>
                  {l.reason && <span className="text-slate-400 truncate flex-1">{l.reason}</span>}
                  {canManage && <button onClick={() => del(l._id)} className="text-slate-300 hover:text-red-500 ml-auto shrink-0"><Icon.Trash size={15} /></button>}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {addModal && <LeaveAddModal employeeId={employeeId} onClose={() => setAddModal(false)} onSaved={() => { setAddModal(false); load(); }} />}
      {allocModal && <LeaveAllocModal employeeId={employeeId} current={data.allocation} onClose={() => setAllocModal(false)} onSaved={() => { setAllocModal(false); load(); }} />}
    </div>
  );
}

function LeaveAddModal({ employeeId, onClose, onSaved }) {
  const [type, setType] = useState('casual');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [duration, setDuration] = useState('full');
  const [reason, setReason] = useState('');
  const [documentUrl, setDocumentUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [elig, setElig] = useState(null);
  const [busy, setBusy] = useState(false);
  const [blockErr, setBlockErr] = useState('');
  useEffect(() => { hrApi(`/employees/${employeeId}/leave-eligibility?date=${date}`).then(setElig).catch(() => setElig(null)); }, [date, employeeId]);
  const doSave = async (force) => {
    setBusy(true); setBlockErr('');
    try { const r = await hrApi(`/employees/${employeeId}/leave`, { method: 'POST', body: JSON.stringify({ type, date, duration, reason, paid: true, documentUrl, force }) }); if (r.forcedUnpaid) alert(`Recorded as UNPAID — paid leave isn't allowed during ${r.forcedReason === 'probation' ? 'probation (first 3 months)' : 'the notice period'}.`); onSaved(); }
    catch (e) {
      // Policy blocks come back with a message; offer an override.
      if (e.status === 400 && /week-off|advance|medical/i.test(e.message)) { setBlockErr(e.message); setBusy(false); }
      else { alert(e.message); setBusy(false); }
    }
  };
  const uploadMedical = async (file) => {
    if (!file) return; setUploading(true);
    try { const { url } = await uploadToImageKit(file, `/qtonix-hr/employees/id${employeeId}/medical`, file.name); setDocumentUrl(url); }
    catch (e) { alert('Upload failed: ' + e.message); } finally { setUploading(false); }
  };
  const unpaidWarn = elig && !elig.paidAllowed && type !== 'wfh';
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between"><div className="text-lg font-extrabold text-[#050A1F]">Record leave</div><button onClick={onClose} className="text-slate-400 text-xl leading-none">×</button></div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type"><select className={inputCls} value={type} onChange={(e) => { setType(e.target.value); setBlockErr(''); }}>{LEAVE_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Date"><input type="date" className={inputCls} value={date} onChange={(e) => { setDate(e.target.value); setBlockErr(''); }} /></Field>
          </div>
          {type !== 'wfh' && (
            <div>
              <div className="text-xs font-bold text-slate-500 mb-2">Duration</div>
              <div className="flex gap-2">{[['full', 'Full day'], ['half', 'Half day']].map(([k, l]) => <button key={k} onClick={() => setDuration(k)} className={`flex-1 rounded-lg border px-3 py-2 text-sm font-bold ${duration === k ? 'border-orange-400 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-500'}`}>{l}</button>)}</div>
            </div>
          )}
          {type === 'medical' && (
            <Field label="Medical document">
              {documentUrl ? <div className="flex items-center gap-2"><a href={documentUrl} target="_blank" rel="noreferrer" className="text-xs font-bold text-blue-500">View uploaded ↗</a><button onClick={() => setDocumentUrl('')} className="text-xs text-slate-400">Remove</button></div>
                : <label className="inline-block rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold cursor-pointer hover:bg-slate-50">{uploading ? 'Uploading…' : 'Upload certificate'}<input type="file" className="hidden" onChange={(e) => e.target.files[0] && uploadMedical(e.target.files[0])} /></label>}
            </Field>
          )}
          <Field label="Reason"><textarea className={inputCls} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          {unpaidWarn && <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">Paid leave isn't allowed during {elig.reason === 'probation' ? 'probation (first 3 months)' : 'the notice period'}. This will be saved as <b>unpaid</b>.</div>}
          {blockErr && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{blockErr}</div>}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          {blockErr
            ? <button onClick={() => doSave(true)} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: '#DC2626' }}>{busy ? 'Saving…' : 'Override & record'}</button>
            : <button onClick={() => doSave(false)} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : 'Record leave'}</button>}
        </div>
      </div>
    </div>
  );
}

// Monthly attendance deduction summary — late days, deficit hours, salary impact.
function AttendanceDeductionCard({ employeeId }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [d, setD] = useState(null);
  useEffect(() => { hrApi(`/employees/${employeeId}/attendance-summary?month=${month}`).then(setD).catch(() => setD(null)); }, [month, employeeId]);
  const monthLabel = (() => { const [y, m] = month.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' }); })();
  return (
    <div className="rounded-2xl border border-slate-200/70 p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-extrabold text-[#050A1F]">Attendance & salary impact</div>
        <input type="month" className="rounded-lg border border-slate-300 px-2 py-1 text-xs" value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>
      {!d ? <div className="text-slate-400 text-sm">Loading…</div> : (
        <div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <Stat label="Late days" value={d.lateDays} />
            <Stat label="Max consecutive" value={d.maxConsecutiveLate} />
            <Stat label="Half-day penalties" value={d.penaltyHalfDays} />
            <Stat label="Deficit hours" value={d.deficitHours} />
          </div>
          <div className="rounded-xl bg-slate-50 p-4 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-slate-500">Per-day salary</span><span className="font-bold">₹{d.perDaySalary.toLocaleString('en-IN')}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Per-hour</span><span className="font-bold">₹{d.perHour.toLocaleString('en-IN')}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Deficit deduction ({d.deficitHours}h)</span><span className="font-bold text-red-600">−₹{d.deficitDeduction.toLocaleString('en-IN')}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Half-day deduction ({d.penaltyHalfDays})</span><span className="font-bold text-red-600">−₹{d.halfDayDeduction.toLocaleString('en-IN')}</span></div>
            <div className="flex justify-between border-t border-slate-200 pt-1 mt-1"><span className="font-bold text-[#050A1F]">Total deduction — {monthLabel}</span><span className="font-extrabold text-red-600">−₹{d.totalDeduction.toLocaleString('en-IN')}</span></div>
          </div>
          {d.monthlyCtc === 0 && <div className="text-[11px] text-amber-600 mt-2">Add a salary record in Payroll to calculate the deduction amount.</div>}
        </div>
      )}
    </div>
  );
}
function Stat({ label, value }) {
  return <div className="rounded-xl border border-slate-100 p-3"><div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</div><div className="text-xl font-extrabold text-[#050A1F] mt-0.5">{value}</div></div>;
}

function LeaveAllocModal({ employeeId, current, onClose, onSaved }) {
  const [alloc, setAlloc] = useState({ casual: current.casual ?? 12, medical: current.medical ?? 12, privilege: current.privilege ?? 12, wfh: current.wfh ?? 24 });
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { await hrApi(`/employees/${employeeId}/leave-allocation`, { method: 'PUT', body: JSON.stringify(alloc) }); onSaved(); } catch (e) { alert(e.message); setBusy(false); } };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between"><div className="text-lg font-extrabold text-[#050A1F]">Leave allocation</div><button onClick={onClose} className="text-slate-400 text-xl leading-none">×</button></div>
        <div className="p-6 grid grid-cols-2 gap-4">
          {LEAVE_TYPES.map(([k, l]) => <Field key={k} label={`${l} (per year)`}><input type="number" className={inputCls} value={alloc[k]} onChange={(e) => setAlloc((a) => ({ ...a, [k]: Number(e.target.value) || 0 }))} /></Field>)}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : 'Save allocation'}</button>
        </div>
      </div>
    </div>
  );
}

// Per-employee onboarding checklist (seeds from the admin template on first view).
function OnboardingChecklist({ employeeId, canEdit }) {
  const [data, setData] = useState(null);
  const [newTask, setNewTask] = useState('');
  const load = () => hrApi(`/employees/${employeeId}/onboarding`).then(setData).catch(() => setData({ tasks: [], percent: 0 }));
  useEffect(() => { load(); }, [employeeId]);
  const toggle = async (t) => { try { await hrApi(`/employees/${employeeId}/onboarding/${t._id}`, { method: 'PATCH', body: JSON.stringify({ done: !t.done }) }); load(); } catch (e) { alert(e.message); } };
  const add = async () => { if (!newTask.trim()) return; try { await hrApi(`/employees/${employeeId}/onboarding`, { method: 'POST', body: JSON.stringify({ task: newTask }) }); setNewTask(''); load(); } catch (e) { alert(e.message); } };
  const del = async (t) => { try { await hrApi(`/employees/${employeeId}/onboarding/${t._id}`, { method: 'DELETE' }); load(); } catch (e) { alert(e.message); } };
  if (!data) return <div className="text-slate-400 text-sm">Loading…</div>;
  const tasks = data.tasks || [];
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="text-sm font-bold text-[#050A1F]">Onboarding progress</div>
        <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden max-w-xs"><div className="h-full" style={{ width: `${data.percent}%`, background: data.percent >= 100 ? '#059669' : '#FF6A00' }} /></div>
        <span className="text-xs font-bold" style={{ color: data.percent >= 100 ? '#059669' : '#FF6A00' }}>{data.done}/{data.total} · {data.percent}%</span>
      </div>
      {tasks.length === 0 ? <div className="text-sm text-slate-400 mb-3">No onboarding tasks. {canEdit ? 'Add the first below, or set a default template in Admin → Settings.' : ''}</div> : (
        <div className="space-y-1.5 mb-4">
          {tasks.map((t) => (
            <div key={t._id} className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2 group">
              <button onClick={() => canEdit && toggle(t)} disabled={!canEdit} className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${t.done ? 'bg-green-500 border-green-500 text-white' : 'border-slate-300'}`}>
                {t.done && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>}
              </button>
              <span className={`text-sm flex-1 ${t.done ? 'line-through text-slate-400' : 'text-slate-700'}`}>{t.task}</span>
              {t.done && t.doneAt && <span className="text-[10px] text-slate-400">{new Date(t.doneAt).toLocaleDateString()}</span>}
              {canEdit && <button onClick={() => del(t)} className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500"><Icon.Trash size={14} /></button>}
            </div>
          ))}
        </div>
      )}
      {canEdit && (
        <div className="flex gap-2 max-w-md">
          <input className={inputCls} placeholder="Add a task…" value={newTask} onChange={(e) => setNewTask(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button onClick={add} className="rounded-lg px-4 py-2 text-xs font-bold text-white whitespace-nowrap" style={{ background: '#050A1F' }}>Add task</button>
        </div>
      )}
    </div>
  );
}

export function EmployeeDirectory({ isAdmin, me, onOpenProfile }) {
  const isHrManager = !!(me && me.isHrManager);
  const canManage = isAdmin || isHrManager;
  const myBranch = me && me.branch;
  const [rows, setRows] = useState([]);
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editingDirector, setEditingDirector] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [msg, setMsg] = useState('');
  const [branches, setBranches] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [reporting, setReporting] = useState({ hr: [], admins: [] });
  const [shifts, setShifts] = useState([]);
  const [imagekitReady, setImagekitReady] = useState(false);
  // Filters
  const [q, setQ] = useState('');
  const [fDept, setFDept] = useState('');
  const [fBranch, setFBranch] = useState('');
  const [fRole, setFRole] = useState('');
  const [fStatus, setFStatus] = useState('active');
  const load = () => hrApi('/employees').then(setRows).catch(() => {});
  // The directory list is trimmed; fetch the full record so the edit form shows
  // every field (phone, reporting line, targets, etc.).
  const openEdit = async (u) => {
    try { const full = await hrApi(`/users/${u._id}`); setEditing(full); }
    catch { setEditing(u); }
  };
  const removeDirector = async (u) => {
    if (!window.confirm(`Remove ${u.name} from the HR employee list? This does not affect their CRM login.`)) return;
    try { await hrApi(`/directors/${String(u._id).replace('admin:', '')}`, { method: 'DELETE' }); setMsg('Director removed from HR list.'); load(); }
    catch (e) { setMsg(e.message); }
  };
  useEffect(() => {
    load();
    if (canManage) {
      hrApi('/branches').then(setBranches).catch(() => {});
      hrApi('/departments').then(setDepartments).catch(() => {});
      hrApi('/reporting-options').then(setReporting).catch(() => {});
      hrApi('/shifts').then(setShifts).catch(() => {});
      hrApi('/imagekit').then((c) => setImagekitReady(c.configured)).catch(() => {});
    }
  }, [canManage]);
  const reportingOptions = [
    ...reporting.hr.map((h) => ({ value: `hr:${h.id}`, label: `${h.name}${h.designation ? ` · ${h.designation}` : ''} (HR)` })),
    ...reporting.admins.map((a) => ({ value: `admin:${a.id}`, label: `${a.name} (Admin)` })),
  ];

  const filtered = rows.filter((u) => {
    if (fStatus === 'active' && u.active === false) return false;
    if (fStatus === 'inactive' && u.active !== false) return false;
    if (fDept && u.department !== fDept) return false;
    if (fBranch && u.branch !== fBranch) return false;
    if (fRole && u.type !== fRole) return false;
    if (q) { const s = q.toLowerCase(); if (!(`${u.name} ${u.email || ''} ${u.employeeId || ''}`.toLowerCase().includes(s))) return false; }
    return true;
  });

  const del = async (u) => {
    if (!window.confirm(`Delete ${u.name}? This removes their employee & login record permanently.`)) return;
    try { await hrApi(`/users/${u._id}`, { method: 'DELETE' }); setMsg(`Deleted ${u.name}.`); load(); } catch (e) { alert(e.message); }
  };
  const toggleActive = async (u) => {
    try { await hrApi(`/users/${u._id}`, { method: 'PUT', body: JSON.stringify({ active: !(u.active !== false) }) }); load(); } catch (e) { alert(e.message); }
  };

  const IconBtn = ({ title, onClick, color, children }) => (
    <button title={title} onClick={onClick} className={`w-7 h-7 inline-flex items-center justify-center rounded-lg hover:bg-slate-100 ${color || 'text-slate-400 hover:text-slate-600'}`}>{children}</button>
  );

  const deptOptions = [...new Set(rows.map((u) => u.department).filter(Boolean))];
  const branchOptions = [...new Set(rows.map((u) => u.branch).filter(Boolean))];
  const roleOptions = [...new Set(rows.map((u) => u.type).filter(Boolean))];

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-extrabold text-[#050A1F]">Employees</h1>
        {canManage && <button onClick={() => setShow(true)} className="rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ background: ORANGE }}>+ Add employee</button>}
      </div>
      {isHrManager && !isAdmin && <div className="mb-4 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-blue-700">You have the privilege to manage employees in the <b>{myBranch}</b> branch.</div>}
      {msg && <div className="mb-4 rounded-lg bg-green-50 border border-green-200 px-3 py-2.5 text-sm text-green-700">{msg}</div>}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, ID…" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm w-56" />
        <select value={fDept} onChange={(e) => setFDept(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600"><option value="">All departments</option>{deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}</select>
        <select value={fBranch} onChange={(e) => setFBranch(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600"><option value="">All branches</option>{branchOptions.map((b) => <option key={b} value={b}>{b}</option>)}</select>
        <select value={fRole} onChange={(e) => setFRole(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600"><option value="">All roles</option>{roleOptions.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}</select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600"><option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All statuses</option></select>
        <span className="text-xs text-slate-400 ml-auto">{filtered.length} of {rows.length}</span>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr className="text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            <th className="px-4 py-3">Name</th><th className="px-4 py-3">Emp ID</th><th className="px-4 py-3">Role</th>
            <th className="px-4 py-3">Department</th><th className="px-4 py-3">Branch</th><th className="px-4 py-3">Profile</th><th className="px-4 py-3 text-right">Actions</th>
          </tr></thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u._id} className={`border-t border-slate-100 ${u.active === false ? 'opacity-60' : ''}`}>
                <td className="px-4 py-3"><button onClick={() => isAdmin && onOpenProfile(u._id)} className="flex items-center gap-2 text-left"><Avatar name={u.name} src={u.avatar} size={30} /><span className="font-bold text-[#050A1F] hover:text-[#FF4500]">{titleCase(u.name)}</span>{u.active === false && <span className="text-[9px] bg-red-100 text-red-600 rounded px-1.5 py-0.5 font-bold">Inactive</span>}</button></td>
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
                <td className="px-4 py-3">
                  {u.isDirector ? (
                    isAdmin ? (
                      <div className="flex items-center justify-end gap-0.5">
                        <IconBtn title="Edit director details" onClick={() => setEditingDirector(u)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" /></svg></IconBtn>
                        <IconBtn title="Remove from HR list" onClick={() => removeDirector(u)} color="text-slate-400 hover:text-red-600"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M6 7l1 13a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 17 20l1-13" /></svg></IconBtn>
                      </div>
                    ) : <div className="text-right text-[10px] text-slate-300">Director</div>
                  ) : canManage && (isAdmin || u.branch === myBranch) ? (
                    <div className="flex items-center justify-end gap-0.5">
                      <IconBtn title="View profile" onClick={() => onOpenProfile(u._id)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg></IconBtn>
                      <IconBtn title="Edit" onClick={() => openEdit(u)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" /></svg></IconBtn>
                      <IconBtn title="Reset password" onClick={() => setResetting(u)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg></IconBtn>
                      <IconBtn title={u.active === false ? 'Reactivate' : 'Deactivate'} onClick={() => toggleActive(u)} color={u.active === false ? 'text-green-500 hover:text-green-600' : 'text-amber-500 hover:text-amber-600'}>
                        {u.active === false
                          ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="M22 4L12 14.01l-3-3" /></svg>
                          : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M8 12h8" /></svg>}
                      </IconBtn>
                      <IconBtn title="Delete" onClick={() => del(u)} color="text-slate-400 hover:text-red-600"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M6 7l1 13a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 17 20l1-13" /></svg></IconBtn>
                    </div>
                  ) : (canManage ? <div className="text-right text-[10px] text-slate-300">Other branch</div> : null)}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-sm">No employees match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
      {show && <AddUserModal branches={branches} departments={departments} reportingOptions={reportingOptions} shifts={shifts} imagekitReady={imagekitReady} isAdmin={isAdmin} lockBranch={!isAdmin && isHrManager ? myBranch : ''} onClose={() => setShow(false)} onCreated={(n) => { setMsg(`Employee added: ${n}`); load(); }} />}
      {editing && <EditEmployeeModal user={editing} branches={branches} departments={departments} reportingOptions={reportingOptions} shifts={shifts} isAdmin={isAdmin} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setMsg('Employee updated.'); load(); }} />}
      {resetting && <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} onDone={() => { setResetting(null); setMsg('Password reset.'); }} />}
      {editingDirector && <DirectorEditModal director={editingDirector} onClose={() => setEditingDirector(null)} onSaved={() => { setEditingDirector(null); setMsg('Director details updated.'); load(); }} />}
    </div>
  );
}

// Reset an employee's password (admin).
export function ResetPasswordModal({ user, onClose, onDone }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const gen = () => { const s = Math.random().toString(36).slice(2, 10) + 'A1!'; setPw(s); setPw2(s); };
  const submit = async () => {
    if (pw.length < 8) return setErr('Password must be at least 8 characters.');
    if (pw !== pw2) return setErr('Passwords don’t match.');
    setBusy(true); setErr('');
    try { await hrApi(`/users/${user._id}/reset-password`, { method: 'POST', body: JSON.stringify({ password: pw }) }); onDone(); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="text-lg font-extrabold text-[#050A1F]">Reset password</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        <div className="p-6 space-y-3">
          <div className="text-sm text-slate-500">Set a new password for <b className="text-[#050A1F]">{user.name}</b>.</div>
          {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{err}</div>}
          <input type="text" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password" className={inputCls} />
          <input type="text" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Confirm password" className={inputCls} />
          <button onClick={gen} className="text-xs font-bold text-[#FF4500]">Generate strong password</button>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={submit} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : 'Reset password'}</button>
        </div>
      </div>
    </div>
  );
}

// Edit core employee fields (admin). Reuses the same field set as add.
// Limited editor for a Director (CRM admin) surfaced in the employee list.
// Only Name / Employee ID / Email — their CRM login is never touched.
export function DirectorEditModal({ director, onClose, onSaved }) {
  const userId = String(director._id).replace('admin:', '');
  const [f, setF] = useState({ name: director.name || '', employeeId: director.employeeId || '', email: director.email || '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    if (!f.name.trim()) return setErr('Name is required.');
    setBusy(true); setErr('');
    try { await hrApi(`/directors/${userId}`, { method: 'PUT', body: JSON.stringify(f) }); onSaved(); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130] p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div><div className="text-lg font-extrabold text-[#050A1F]">Edit director</div><div className="text-xs text-slate-400">Their HRMS details only — CRM login is unaffected.</div></div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        <div className="p-6 space-y-3">
          {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{err}</div>}
          <label className="block text-xs font-bold text-slate-500">Name<input className={inputCls} value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Correct display name" /></label>
          <label className="block text-xs font-bold text-slate-500">Employee ID<input className={inputCls} value={f.employeeId} onChange={(e) => set('employeeId', e.target.value)} placeholder="e.g. QTX-D001" /></label>
          <label className="block text-xs font-bold text-slate-500">Email<input className={inputCls} value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="Contact / interview-invite email" /></label>
          <div className="text-[11px] text-slate-400">This email is used for interview-panel calendar invites.</div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

export function EditEmployeeModal({ user, branches, departments, reportingOptions, shifts, isAdmin, onClose, onSaved }) {
  const [f, setF] = useState({
    name: user.name || '', employeeId: user.employeeId || '', phone: user.phone || '', designation: user.designation || '',
    type: user.type || 'employee', branch: user.branch || '', department: user.department || '',
    joiningDate: user.joiningDate || '', birthday: user.birthday || '', maritalStatus: user.maritalStatus || '', anniversary: user.anniversary || '',
    reportsTo: user.reportsToId ? `hr:${user.reportsToId}` : (user.reportsToAdminId ? `admin:${user.reportsToAdminId}` : ''),
    shiftId: user.shiftId || '', canPostAnnouncements: !!user.canPostAnnouncements, isHrManager: !!user.isHrManager, active: user.active !== false,
    dailyInterviews: (user.targets && user.targets.dailyInterviews) || 0, monthlyOnboarding: (user.targets && user.targets.monthlyOnboarding) || 0,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const isHrRole = ['hr', 'recruiter', 'manager', 'tl'].includes(f.type);
  const save = async () => {
    if (!f.name.trim()) return setErr('Name is required.');
    setBusy(true); setErr('');
    const [kind, id] = (f.reportsTo || '').split(':');
    try {
      await hrApi(`/users/${user._id}`, { method: 'PUT', body: JSON.stringify({
        name: f.name, employeeId: f.employeeId, phone: f.phone, designation: f.designation, type: f.type,
        branch: f.branch, department: f.department, joiningDate: f.joiningDate || null, birthday: f.birthday || null,
        maritalStatus: f.maritalStatus || null, anniversary: f.anniversary || null,
        reportsToId: kind === 'hr' ? Number(id) : null, reportsToAdminId: kind === 'admin' ? Number(id) : null,
        shiftId: f.shiftId || null, canPostAnnouncements: f.canPostAnnouncements, isHrManager: f.isHrManager, active: f.active,
        targets: isHrRole ? { dailyInterviews: Number(f.dailyInterviews) || 0, monthlyOnboarding: Number(f.monthlyOnboarding) || 0 } : undefined,
      }) });
      onSaved();
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-[130] p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="text-lg font-extrabold text-[#050A1F]">Edit employee</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        <div className="p-6 grid grid-cols-2 gap-3">
          {err && <div className="col-span-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{err}</div>}
          <label className="text-xs font-bold text-slate-500">Name<input className={inputCls} value={f.name} onChange={(e) => set('name', e.target.value)} /></label>
          <label className="text-xs font-bold text-slate-500">Employee ID<input className={inputCls} value={f.employeeId} onChange={(e) => set('employeeId', e.target.value)} /></label>
          <label className="text-xs font-bold text-slate-500">Phone<input className={inputCls} value={f.phone} onChange={(e) => set('phone', e.target.value)} /></label>
          <label className="text-xs font-bold text-slate-500">Designation<input className={inputCls} value={f.designation} onChange={(e) => set('designation', e.target.value)} /></label>
          <label className="text-xs font-bold text-slate-500">Role<select className={inputCls} value={f.type} onChange={(e) => set('type', e.target.value)}>{ROLE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="text-xs font-bold text-slate-500">Department<select className={inputCls} value={f.department} onChange={(e) => set('department', e.target.value)}><option value="">—</option>{departments.map((d) => <option key={d._id} value={d.name}>{d.name}</option>)}</select></label>
          <label className="text-xs font-bold text-slate-500">Branch<select className={inputCls} value={f.branch} onChange={(e) => set('branch', e.target.value)}><option value="">—</option>{branches.map((b) => <option key={b._id} value={b.name}>{b.name}</option>)}</select></label>
          <label className="text-xs font-bold text-slate-500">Reports to<select className={inputCls} value={f.reportsTo} onChange={(e) => set('reportsTo', e.target.value)}><option value="">—</option>{reportingOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
          <label className="text-xs font-bold text-slate-500">Shift<select className={inputCls} value={f.shiftId} onChange={(e) => set('shiftId', e.target.value)}><option value="">—</option>{shifts.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</select></label>
          <label className="text-xs font-bold text-slate-500">Joining date<input type="date" className={inputCls} value={f.joiningDate || ''} onChange={(e) => set('joiningDate', e.target.value)} /></label>
          <label className="text-xs font-bold text-slate-500">Birthday<input type="date" className={inputCls} value={f.birthday || ''} onChange={(e) => set('birthday', e.target.value)} /></label>
          <label className="text-xs font-bold text-slate-500">Marital status<select className={inputCls} value={f.maritalStatus || ''} onChange={(e) => set('maritalStatus', e.target.value)}><option value="">—</option><option value="single">Single</option><option value="married">Married</option></select></label>
          {f.maritalStatus === 'married' && <label className="text-xs font-bold text-slate-500">Anniversary<input type="date" className={inputCls} value={f.anniversary || ''} onChange={(e) => set('anniversary', e.target.value)} /></label>}
          {isAdmin && isHrRole && <label className="text-xs font-bold text-slate-500">Daily interview target<input type="number" className={inputCls} value={f.dailyInterviews} onChange={(e) => set('dailyInterviews', e.target.value)} /></label>}
          {isAdmin && isHrRole && <label className="text-xs font-bold text-slate-500">Monthly hiring target<input type="number" className={inputCls} value={f.monthlyOnboarding} onChange={(e) => set('monthlyOnboarding', e.target.value)} /></label>}
          {isAdmin && <label className="col-span-2 flex items-center gap-2 text-sm text-slate-600 mt-1 rounded-lg bg-orange-50 border border-orange-100 px-3 py-2"><input type="checkbox" checked={f.isHrManager} onChange={(e) => set('isHrManager', e.target.checked)} /> <span><b>HR Manager</b> — can manage employees, jobs, candidates & announcements for their branch ({f.branch || 'their branch'})</span></label>}
          {isAdmin && <label className="col-span-2 flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={f.canPostAnnouncements} onChange={(e) => set('canPostAnnouncements', e.target.checked)} /> Can post announcements to the notice board</label>}
          <label className="col-span-2 flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} /> Active</label>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </div>
  );
}

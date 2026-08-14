import React, { useState, useEffect, useRef } from 'react';
import { API_BASE } from './config.js';
import { hrApi, fileToBase64 } from './HrApp.jsx';
import { RichText } from './Leads.jsx';

const ORANGE = 'linear-gradient(90deg,#FF6A00,#FF4500)';
const inp = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400';
const lab = 'block text-[12px] font-bold text-slate-600 mb-1.5';

// Animated progress bar for uploads/parsing.
export function ProgressBar({ pct, label }) {
  return (
    <div>
      <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${Math.max(5, Math.min(100, pct))}%`, background: ORANGE }} />
      </div>
      {label && <div className="text-[11px] text-slate-500 mt-1">{label} {pct >= 100 ? '✓' : `${Math.round(pct)}%`}</div>}
    </div>
  );
}

// POST a base64 payload to an hrApi endpoint, animating a fake progress ramp
// while we wait (real byte-progress isn't available through fetch on JSON).
export async function hrApiUpload(path, body, onProgress) {
  let p = 0;
  const timer = setInterval(() => { p = Math.min(0.9, p + 0.08); onProgress && onProgress(p); }, 250);
  try { return await hrApi(path, { method: 'POST', body: JSON.stringify(body) }); }
  finally { clearInterval(timer); onProgress && onProgress(1); }
}

const STEPS = [
  { id: 'about', label: 'About Job' },
  { id: 'form', label: 'Application Form' },
  { id: 'flow', label: 'Hiring Flow' },
  { id: 'finish', label: 'Finishing Up' },
];

const EMPTY = {
  title: '', department: '', workMode: 'in_office', locations: [],
  description: '', skills: [],
  salaryPeriod: 'monthly', salaryMin: '', salaryMax: '', salaryCurrency: 'INR', hideSalary: false,
  experienceType: 'experienced', expMin: '', expMax: '',
  employmentType: 'full_time', employmentLevel: 'entry',
  education: '', openings: 1,
  formFields: {}, questions: [], stages: [],
};

const DEFAULT_FORM_FIELDS = {
  photo: 'off', currentLocation: 'mandatory',
  resume: 'mandatory', workExperience: 'optional', educationDetails: 'optional',
  noticePeriod: 'optional', ctc: 'optional', portfolio: 'off', gender: 'off',
};
const DEFAULT_STAGES = [
  { id: 'sourced', label: 'Sourced', color: '#94A3B8' },
  { id: 'applied', label: 'Applied', color: '#2563EB' },
  { id: 'contacted', label: 'Contacted', color: '#7C3AED' },
  { id: 'interview', label: 'Interview', color: '#F5A524' },
  { id: 'offered', label: 'Offered', color: '#0EA5E9' },
  { id: 'hired', label: 'Hired', color: '#16A34A' },
  { id: 'rejected', label: 'Rejected', color: '#DC2626' },
];

const EDU_OPTIONS = ['Any', 'High School', 'Diploma', "Bachelor's Degree", "Master's Degree", 'PhD'];
const EMP_TYPES = [['full_time', 'Full-time'], ['part_time', 'Part-time'], ['internship', 'Internship'], ['freelance', 'Freelance']];
const EMP_LEVELS = [['entry', 'Entry Level'], ['associate', 'Associate'], ['mid_senior', 'Mid-Senior'], ['senior', 'Senior'], ['tl', 'Team Lead'], ['manager', 'Manager']];

export default function HrJobBuilder({ departments, branches, onDone, onCancel, existing }) {
  const [step, setStep] = useState(0);
  const [job, setJob] = useState(() => ({ ...EMPTY, formFields: { ...DEFAULT_FORM_FIELDS }, stages: DEFAULT_STAGES, ...(existing || {}) }));
  const [jobId, setJobId] = useState(existing ? existing.id : null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const set = (patch) => setJob((j) => ({ ...j, ...patch }));

  // Persist the draft (create on first save, update after).
  const save = async () => {
    const payload = { ...job, salaryMin: job.salaryMin || null, salaryMax: job.salaryMax || null, expMin: job.expMin || null, expMax: job.expMax || null };
    if (jobId) { await hrApi(`/job-posts/${jobId}`, { method: 'PUT', body: JSON.stringify(payload) }); return jobId; }
    const row = await hrApi('/job-posts', { method: 'POST', body: JSON.stringify(payload) });
    setJobId(row._id); return row._id;
  };

  const next = async () => {
    setErr('');
    if (step === 0 && !job.title.trim()) { setErr('Job title is required.'); return; }
    setBusy(true);
    try { await save(); setStep((s) => Math.min(s + 1, STEPS.length - 1)); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const publish = async () => {
    setBusy(true); setErr('');
    try { const id = await save(); await hrApi(`/job-posts/${id}/publish`, { method: 'POST' }); onDone && onDone(); }
    catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <button onClick={onCancel} className="text-xs font-bold text-slate-400 hover:text-slate-600">← Go back</button>
          <h2 className="text-lg font-extrabold text-[#050A1F]">{job.title || 'New Job'}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          {step === 0
            ? <button onClick={() => { if (!job.title.trim()) { setErr('Job title is required.'); return; } setPreview(true); }} className="rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ background: ORANGE }}>Preview &amp; Proceed</button>
            : step < STEPS.length - 1
              ? <button onClick={next} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : 'Save & Next'}</button>
              : <button onClick={publish} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Publishing…' : 'Publish Job'}</button>}
        </div>
      </div>

      <div className="flex">
        {/* Step nav */}
        <div className="w-56 border-r border-slate-100 p-3 shrink-0">
          {STEPS.map((s, i) => (
            <button key={s.id} onClick={() => i < step && setStep(i)}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-bold mb-1 transition ${i === step ? 'bg-orange-50 text-orange-700' : i < step ? 'text-slate-600 hover:bg-slate-50' : 'text-slate-300 cursor-default'}`}>
              {i + 1}. {s.label}
            </button>
          ))}
        </div>

        <div className="flex-1 p-6 min-w-0">
          {err && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm px-3 py-2">{err}</div>}
          {step === 0 && <AboutStep job={job} set={set} departments={departments} branches={branches} setErr={setErr} />}
          {step === 1 && <FormStep job={job} set={set} />}
          {step === 2 && <FlowStep job={job} set={set} />}
          {step === 3 && <FinishStep job={job} jobId={jobId} />}
        </div>
      </div>

      {preview && <PreviewModal job={job} onCancel={() => setPreview(false)} onProceed={async () => { setPreview(false); await next(); }} />}
    </div>
  );
}

// ---------------- Step 1: About Job ----------------
function AboutStep({ job, set, departments, branches, setErr }) {
  const [skillInput, setSkillInput] = useState('');
  const [aiBusy, setAiBusy] = useState('');
  const [locInput, setLocInput] = useState('');
  const [jdProg, setJdProg] = useState(null); // {pct, label} while reading a JD
  const [missing, setMissing] = useState([]);
  const jdRef = React.useRef(null);

  const uploadJD = async (file) => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { setErr('File too large (max 8MB).'); return; }
    setErr(''); setMissing([]);
    setJdProg({ pct: 15, label: 'Reading file…' });
    try {
      const base64 = await fileToBase64(file);
      setJdProg({ pct: 45, label: 'Extracting text…' });
      // Small delay so the bar is visible for tiny files.
      const parsed = await hrApiUpload('/job-posts/ai/parse-jd', { base64, fileName: file.name }, (p) => setJdProg({ pct: 45 + Math.round(p * 0.5), label: 'AI is reading your JD…' }));
      setJdProg({ pct: 100, label: 'Done' });
      set({
        title: parsed.title || job.title, department: parsed.department || job.department,
        workMode: parsed.workMode || job.workMode, description: parsed.description || job.description,
        skills: (parsed.skills && parsed.skills.length) ? parsed.skills.map((s) => ({ name: s.name || s, primary: !!s.primary })) : job.skills,
        salaryMin: parsed.salaryMin || job.salaryMin, salaryMax: parsed.salaryMax || job.salaryMax,
        salaryPeriod: parsed.salaryPeriod || job.salaryPeriod, salaryCurrency: parsed.salaryCurrency || job.salaryCurrency,
        experienceType: parsed.experienceType || job.experienceType, expMin: parsed.expMin || job.expMin, expMax: parsed.expMax || job.expMax,
        employmentType: parsed.employmentType || job.employmentType, employmentLevel: parsed.employmentLevel || job.employmentLevel,
        education: parsed.education || job.education, openings: parsed.openings || job.openings,
      });
      setMissing(Array.isArray(parsed.missing) ? parsed.missing : []);
      setTimeout(() => setJdProg(null), 600);
    } catch (e) { setErr(e.message); setJdProg(null); }
  };

  const rewriteJD = async () => {
    setAiBusy('jd'); setErr('');
    try {
      const r = await hrApi('/job-posts/ai/rewrite-jd', { method: 'POST', body: JSON.stringify({ title: job.title, department: job.department, workMode: job.workMode, description: job.description }) });
      set({ description: r.description });
    } catch (e) { setErr(e.message); } finally { setAiBusy(''); }
  };
  const suggestSkills = async () => {
    setAiBusy('skills'); setErr('');
    try {
      const r = await hrApi('/job-posts/ai/suggest-skills', { method: 'POST', body: JSON.stringify({ title: job.title, description: job.description }) });
      // Merge, avoiding duplicates (case-insensitive).
      const have = new Set((job.skills || []).map((s) => s.name.toLowerCase()));
      const merged = [...(job.skills || [])];
      (r.skills || []).forEach((s) => { if (!have.has(s.name.toLowerCase())) merged.push(s); });
      set({ skills: merged });
    } catch (e) { setErr(e.message); } finally { setAiBusy(''); }
  };
  const addSkill = (name) => {
    const n = name.trim(); if (!n) return;
    if ((job.skills || []).some((s) => s.name.toLowerCase() === n.toLowerCase())) { setSkillInput(''); return; }
    set({ skills: [...(job.skills || []), { name: n, primary: false }] }); setSkillInput('');
  };
  const togglePrimary = (i) => set({ skills: job.skills.map((s, idx) => idx === i ? { ...s, primary: !s.primary } : s) });
  const removeSkill = (i) => set({ skills: job.skills.filter((_, idx) => idx !== i) });
  const addLoc = (v) => { const n = v.trim(); if (!n || (job.locations || []).includes(n)) { setLocInput(''); return; } set({ locations: [...(job.locations || []), n] }); setLocInput(''); };

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Upload JD to autofill */}
      <div className="rounded-xl border border-dashed border-orange-300 bg-orange-50/50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-extrabold text-[#050A1F]">Have a JD already? Upload it to autofill</div>
            <div className="text-xs text-slate-500">PDF or Word. AI reads it and fills the fields below — you can edit anything.</div>
          </div>
          <button onClick={() => !jdProg && jdRef.current?.click()} disabled={!!jdProg} className="rounded-lg px-4 py-2 text-sm font-bold text-white shrink-0 disabled:opacity-60" style={{ background: ORANGE }}>
            {jdProg ? 'Reading…' : '📄 Upload JD'}
          </button>
          <input ref={jdRef} type="file" accept=".pdf,.doc,.docx,.txt" className="hidden" onChange={(e) => uploadJD(e.target.files?.[0])} />
        </div>
        {jdProg && <div className="mt-3"><ProgressBar pct={jdProg.pct} label={jdProg.label} /></div>}
        {missing.length > 0 && (
          <div className="mt-3 text-xs text-amber-700 bg-amber-100 rounded-lg px-3 py-2">
            <b>AI couldn't find:</b> {missing.join(', ')}. Please fill these in below.
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 p-5">
        <div className="text-sm font-extrabold text-[#050A1F] mb-4 flex items-center gap-2"><span className="w-1.5 h-4 rounded-full" style={{ background: ORANGE }} />Basic details</div>
        <div className="space-y-4">
          <div>
            <label className={lab}>Job title *</label>
            <input className={inp} value={job.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. React Developer" maxLength={160} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={lab}>Department</label>
              <select className={inp} value={job.department} onChange={(e) => set({ department: e.target.value })}>
                <option value="">— Select —</option>
                {(departments || []).map((d) => <option key={d._id || d.name} value={d.name}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lab}>This role is</label>
              <div className="inline-flex bg-slate-100 rounded-lg p-1 w-full">
                {[['in_office', 'In-Office'], ['hybrid', 'Hybrid'], ['remote', 'Remote']].map(([v, l]) => (
                  <button key={v} onClick={() => set({ workMode: v })}
                    className={`flex-1 px-3 py-1.5 rounded-md text-xs font-bold ${job.workMode === v ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>{l}</button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <label className={lab}>Location(s) <span className="font-normal text-slate-400">— select from your branches</span></label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {(job.locations || []).map((l, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-full bg-orange-50 text-orange-700 px-2.5 py-1 text-xs font-semibold">
                  {l}<button onClick={() => set({ locations: job.locations.filter((_, idx) => idx !== i) })} className="text-orange-400 hover:text-red-500">×</button>
                </span>
              ))}
            </div>
            {(branches || []).length > 0 ? (
              <select className={inp} value="" onChange={(e) => { if (e.target.value) addLoc(e.target.value); }}>
                <option value="">+ Add a branch location…</option>
                {(branches || []).filter((b) => !(job.locations || []).includes(b.name)).map((b) => <option key={b._id || b.name} value={b.name}>{b.name}</option>)}
              </select>
            ) : (
              <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">No branches set up yet. Add branches in Admin → Settings to use them as job locations.</div>
            )}
          </div>
        </div>
      </div>

      {/* Job description with AI rewrite */}
      <div className="rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-extrabold text-[#050A1F] flex items-center gap-2"><span className="w-1.5 h-4 rounded-full" style={{ background: ORANGE }} />Job description</div>
          <button onClick={rewriteJD} disabled={aiBusy === 'jd'} className="inline-flex items-center gap-1 rounded-lg bg-orange-50 px-2.5 py-1 text-xs font-bold text-orange-600 hover:bg-orange-100 disabled:opacity-50">
            {aiBusy === 'jd' ? '✨ Rewriting…' : '✨ Rewrite with AI'}
          </button>
        </div>
        <p className="text-[11px] text-slate-400 mb-2">Summary of the role, what success looks like, and how it fits the organisation — plus Responsibilities and Qualifications. Use AI to format it properly.</p>
        <RichText value={job.description} onChange={(v) => set({ description: v })} placeholder="Describe the role…" minHeight={200} />
      </div>

      {/* Skills */}
      <div className="rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-extrabold text-[#050A1F] flex items-center gap-2"><span className="w-1.5 h-4 rounded-full" style={{ background: ORANGE }} />Skills required <span className="font-normal text-slate-400 text-xs">(★ = primary)</span></div>
          <button onClick={suggestSkills} disabled={aiBusy === 'skills'} className="inline-flex items-center gap-1 rounded-lg bg-orange-50 px-2.5 py-1 text-xs font-bold text-orange-600 hover:bg-orange-100 disabled:opacity-50">
            {aiBusy === 'skills' ? '✨ Suggesting…' : '✨ Suggest with AI'}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {(job.skills || []).map((s, i) => (
            <span key={i} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold border ${s.primary ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-slate-50 border-slate-200 text-slate-700'}`}>
              <button onClick={() => togglePrimary(i)} title="Mark as primary" className={s.primary ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'}>★</button>
              {s.name}
              <button onClick={() => removeSkill(i)} className="text-slate-400 hover:text-red-500">×</button>
            </span>
          ))}
        </div>
        <input className={inp} value={skillInput} onChange={(e) => setSkillInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSkill(skillInput); } }}
          placeholder="Type a skill and press Enter" />
      </div>

      {/* Employment details */}
      <div className="rounded-xl border border-slate-200 p-5">
        <div className="text-sm font-extrabold text-[#050A1F] mb-4 flex items-center gap-2"><span className="w-1.5 h-4 rounded-full" style={{ background: ORANGE }} />Employment details</div>
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <label className={lab + ' mb-0'}>Salary range</label>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 cursor-pointer">
                <input type="checkbox" checked={job.hideSalary} onChange={(e) => set({ hideSalary: e.target.checked })} />
                Hide from candidates
              </label>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-3 items-start">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Pay period</div>
                <div className="inline-flex bg-slate-100 rounded-lg p-1">
                  {[['hourly', 'Hourly'], ['monthly', 'Monthly'], ['annual', 'Annual']].map(([v, l]) => (
                    <button key={v} onClick={() => set({ salaryPeriod: v })} className={`px-3 py-1.5 rounded-md text-xs font-bold transition ${job.salaryPeriod === v ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>{l}</button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Amount</div>
                <div className="flex items-stretch">
                  <select className="rounded-l-lg border border-r-0 border-slate-300 bg-slate-50 px-2 text-sm font-bold text-slate-600 focus:outline-none" value={job.salaryCurrency} onChange={(e) => set({ salaryCurrency: e.target.value })}>
                    {['INR', 'USD', 'GBP', 'EUR', 'AED', 'SGD'].map((c) => <option key={c}>{c}</option>)}
                  </select>
                  <input className="w-full border-y border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" type="number" value={job.salaryMin} onChange={(e) => set({ salaryMin: e.target.value })} placeholder="Minimum" />
                  <span className="flex items-center px-2 border-y border-slate-300 bg-slate-50 text-slate-400 text-sm">–</span>
                  <input className="w-full rounded-r-lg border border-l-0 border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" type="number" value={job.salaryMax} onChange={(e) => set({ salaryMax: e.target.value })} placeholder="Maximum" />
                </div>
                {(job.salaryMin || job.salaryMax) && !job.hideSalary && (
                  <div className="text-[11px] text-slate-400 mt-1">Shown to candidates as: <b>{job.salaryCurrency} {Number(job.salaryMin || 0).toLocaleString()} – {Number(job.salaryMax || 0).toLocaleString()}</b> / {job.salaryPeriod}</div>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={lab}>Work experience</label>
              <div className="inline-flex bg-slate-100 rounded-lg p-1 mb-2 w-full">
                {[['freshers', 'Freshers'], ['intern', 'Intern'], ['experienced', 'Experienced']].map(([v, l]) => (
                  <button key={v} onClick={() => set({ experienceType: v })} className={`flex-1 px-2 py-1.5 rounded-md text-xs font-bold ${job.experienceType === v ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>{l}</button>
                ))}
              </div>
              {job.experienceType === 'experienced' && (
                <div className="flex items-center gap-2">
                  <input className={inp} type="number" value={job.expMin} onChange={(e) => set({ expMin: e.target.value })} placeholder="Min yrs" />
                  <span className="text-slate-400">–</span>
                  <input className={inp} type="number" value={job.expMax} onChange={(e) => set({ expMax: e.target.value })} placeholder="Max yrs" />
                </div>
              )}
            </div>
            <div>
              <label className={lab}>Employment type</label>
              <select className={inp + ' mb-3'} value={job.employmentType} onChange={(e) => set({ employmentType: e.target.value })}>
                {EMP_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <label className={lab}>Employment level</label>
              <select className={inp} value={job.employmentLevel} onChange={(e) => set({ employmentLevel: e.target.value })}>
                {EMP_LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Optional */}
      <div className="rounded-xl border border-slate-200 p-5">
        <div className="text-sm font-extrabold text-[#050A1F] mb-4 flex items-center gap-2"><span className="w-1.5 h-4 rounded-full" style={{ background: ORANGE }} />Optional details</div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={lab}>Education</label>
            <select className={inp} value={job.education} onChange={(e) => set({ education: e.target.value })}>
              <option value="">— Select —</option>
              {EDU_OPTIONS.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
          <div>
            <label className={lab}>Number of openings</label>
            <input className={inp} type="number" min="1" value={job.openings} onChange={(e) => set({ openings: e.target.value })} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------- Step 2: Application Form ----------------
const PERSONAL_FIELDS = [['photo', 'Photo', ['optional', 'off']], ['currentLocation', 'Current Location', ['mandatory', 'optional', 'off']]];
const PRO_FIELDS = [
  ['resume', 'Resume', ['mandatory']],
  ['workExperience', 'Work Experience', ['mandatory', 'optional', 'off']],
  ['educationDetails', 'Education Details', ['mandatory', 'optional', 'off']],
  ['noticePeriod', 'Notice Period', ['mandatory', 'optional', 'off']],
  ['ctc', 'CTC', ['mandatory', 'optional', 'off']],
  ['portfolio', 'Work link / Portfolio', ['mandatory', 'optional', 'off']],
  ['gender', 'Gender', ['mandatory', 'optional', 'off']],
];
const OPT_LABEL = { mandatory: 'Mandatory', optional: 'Optional', off: 'Off' };
const OPT_COLOR = { mandatory: 'bg-indigo-600 text-white', optional: 'bg-orange-500 text-white', off: 'bg-slate-600 text-white' };

function FieldRow({ label, options, value, onChange }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0">
      <div className="text-sm font-semibold text-slate-700">{label}</div>
      <div className="flex gap-1.5">
        {options.map((o) => (
          <button key={o} onClick={() => onChange(o)}
            className={`px-3 py-1.5 rounded-md text-xs font-bold transition ${value === o ? OPT_COLOR[o] : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>{OPT_LABEL[o]}</button>
        ))}
      </div>
    </div>
  );
}

function FormStep({ job, set }) {
  const ff = job.formFields || {};
  const setField = (k, v) => set({ formFields: { ...ff, [k]: v } });
  const [qDraft, setQDraft] = useState(null);

  const addQuestion = (q) => set({ questions: [...(job.questions || []), { ...q, id: `q_${Date.now()}` }] });
  const updateQuestion = (id, q) => set({ questions: job.questions.map((x) => x.id === id ? { ...x, ...q } : x) });
  const removeQuestion = (id) => set({ questions: job.questions.filter((x) => x.id !== id) });

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <div className="text-base font-extrabold text-[#050A1F] mb-2">For Personal Information</div>
        <div className="rounded-xl border border-slate-200 px-4">
          {PERSONAL_FIELDS.map(([k, l, opts]) => <FieldRow key={k} label={l} options={opts} value={ff[k] || opts[opts.length - 1]} onChange={(v) => setField(k, v)} />)}
        </div>
      </div>
      <div>
        <div className="text-base font-extrabold text-[#050A1F] mb-2">For Professional Information</div>
        <div className="rounded-xl border border-slate-200 px-4">
          {PRO_FIELDS.map(([k, l, opts]) => <FieldRow key={k} label={l} options={opts} value={k === 'resume' ? 'mandatory' : (ff[k] || opts[opts.length - 1])} onChange={(v) => setField(k, v)} />)}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-base font-extrabold text-[#050A1F]">Screening Questions</div>
          <button onClick={() => setQDraft({ type: 'single', question: '', mandatory: false, options: [] })} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: ORANGE }}>+ Add Question</button>
        </div>
        {(job.questions || []).length === 0 && <div className="text-center text-slate-400 text-sm py-6 rounded-xl border border-dashed border-slate-200">No questions added yet.</div>}
        <div className="space-y-2">
          {(job.questions || []).map((q) => (
            <div key={q.id} className="flex items-start justify-between rounded-xl border border-slate-200 p-3">
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{QTYPES.find((t) => t[0] === q.type)?.[1] || q.type}{q.mandatory ? ' · Required' : ''}</div>
                <div className="text-sm font-semibold text-slate-700">{q.question || '(no question text)'}</div>
                {q.type === 'multiple' && <div className="text-xs text-slate-400 mt-0.5">{(q.options || []).join(', ')}</div>}
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => setQDraft(q)} className="text-slate-400 hover:text-slate-600" title="Edit">✎</button>
                <button onClick={() => removeQuestion(q.id)} className="text-slate-400 hover:text-red-500" title="Delete">🗑</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {qDraft && <QuestionModal draft={qDraft} onCancel={() => setQDraft(null)}
        onSave={(q) => { if (q.id) updateQuestion(q.id, q); else addQuestion(q); setQDraft(null); }} />}
    </div>
  );
}

const QTYPES = [['single', 'Single Line'], ['multi', 'Multi Line'], ['multiple', 'Multiple Choice'], ['yesno', 'Yes / No'], ['file', 'File Upload']];

function QuestionModal({ draft, onCancel, onSave }) {
  const [q, setQ] = useState({ options: [], ...draft });
  const [optInput, setOptInput] = useState('');
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[120] p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-2xl">
        <div className="text-lg font-extrabold text-[#050A1F] mb-4">{draft.id ? 'Edit' : 'Add'} Question</div>
        <label className={lab}>Answer type</label>
        <select className={inp + ' mb-3'} value={q.type} onChange={(e) => setQ({ ...q, type: e.target.value })}>
          {QTYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <label className={lab}>Question</label>
        <textarea className={inp + ' mb-3'} rows={2} value={q.question} onChange={(e) => setQ({ ...q, question: e.target.value })} placeholder="e.g. Can you tell us about yourself?" />
        {q.type === 'multiple' && (
          <div className="mb-3">
            <label className={lab}>Options</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {(q.options || []).map((o, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold">{o}<button onClick={() => setQ({ ...q, options: q.options.filter((_, idx) => idx !== i) })} className="text-slate-400 hover:text-red-500">×</button></span>
              ))}
            </div>
            <input className={inp} value={optInput} onChange={(e) => setOptInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const v = optInput.trim(); if (v) { setQ({ ...q, options: [...(q.options || []), v] }); setOptInput(''); } } }}
              placeholder="Type an option, press Enter" />
          </div>
        )}
        <label className="flex items-center gap-2 text-sm text-slate-600 mb-4">
          <input type="checkbox" checked={q.mandatory} onChange={(e) => setQ({ ...q, mandatory: e.target.checked })} /> Mandatory
        </label>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={() => { if (!q.question.trim()) return; onSave(q); }} className="rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ background: ORANGE }}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ---------------- Step 3: Hiring Flow ----------------
function FlowStep({ job, set }) {
  const stages = job.stages && job.stages.length ? job.stages : DEFAULT_STAGES;
  const [label, setLabel] = useState('');
  const update = (i, patch) => set({ stages: stages.map((s, idx) => idx === i ? { ...s, ...patch } : s) });
  const remove = (i) => set({ stages: stages.filter((_, idx) => idx !== i) });
  const add = () => { const l = label.trim(); if (!l) return; set({ stages: [...stages, { id: `st_${Date.now()}`, label: l, color: '#64748B' }] }); setLabel(''); };
  const move = (i, dir) => { const j = i + dir; if (j < 0 || j >= stages.length) return; const copy = [...stages]; [copy[i], copy[j]] = [copy[j], copy[i]]; set({ stages: copy }); };

  return (
    <div className="max-w-2xl">
      <div className="text-base font-extrabold text-[#050A1F] mb-1">Hiring Flow</div>
      <p className="text-sm text-slate-500 mb-4">These are the stages candidates move through for this job. Reorder, rename, recolour or remove them — each job post can have its own flow.</p>
      <div className="space-y-2 mb-4">
        {stages.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2 rounded-xl border border-slate-200 p-2.5">
            <div className="flex flex-col">
              <button onClick={() => move(i, -1)} disabled={i === 0} className="text-slate-300 hover:text-slate-600 disabled:opacity-30 text-xs leading-none">▲</button>
              <button onClick={() => move(i, 1)} disabled={i === stages.length - 1} className="text-slate-300 hover:text-slate-600 disabled:opacity-30 text-xs leading-none">▼</button>
            </div>
            <input type="color" value={s.color} onChange={(e) => update(i, { color: e.target.value })} className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent" />
            <input className={inp + ' flex-1'} value={s.label} onChange={(e) => update(i, { label: e.target.value })} />
            <button onClick={() => remove(i)} className="text-slate-400 hover:text-red-500 px-2" title="Remove">🗑</button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input className={inp} value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} placeholder="Add a stage…" />
        <button onClick={add} className="rounded-lg px-4 py-2 text-sm font-bold text-white shrink-0" style={{ background: ORANGE }}>Add</button>
      </div>
    </div>
  );
}

// ---------------- Step 4: Finishing Up ----------------
function FinishStep({ job, jobId }) {
  const embedUrl = `${API_BASE}/careers/${'{token appears after publishing}'}`;
  return (
    <div className="max-w-2xl">
      <div className="text-base font-extrabold text-[#050A1F] mb-1">Finishing Up</div>
      <p className="text-sm text-slate-500 mb-4">Review the summary, then publish. Once published, you'll get a public application-form link you can embed on your website via iframe.</p>
      <div className="rounded-xl border border-slate-200 p-4 space-y-2 text-sm">
        <Row k="Title" v={job.title} />
        <Row k="Department" v={job.department || '—'} />
        <Row k="Work mode" v={{ in_office: 'In-Office', hybrid: 'Hybrid', remote: 'Remote' }[job.workMode]} />
        <Row k="Locations" v={(job.locations || []).join(', ') || '—'} />
        <Row k="Skills" v={(job.skills || []).map((s) => s.name + (s.primary ? ' ★' : '')).join(', ') || '—'} />
        <Row k="Salary" v={job.hideSalary ? 'Hidden' : `${job.salaryCurrency} ${job.salaryMin || '?'}–${job.salaryMax || '?'} / ${job.salaryPeriod}`} />
        <Row k="Openings" v={job.openings} />
        <Row k="Hiring stages" v={(job.stages || []).map((s) => s.label).join(' → ')} />
      </div>
      <div className="mt-4 rounded-xl bg-slate-50 border border-slate-200 p-4">
        <div className="text-xs font-bold text-slate-500 mb-1">After publishing, embed the form with:</div>
        <code className="block text-[11px] text-slate-600 break-all">&lt;iframe src="{API_BASE}/careers/&lt;token&gt;/embed" width="100%" height="900" frameborder="0"&gt;&lt;/iframe&gt;</code>
      </div>
    </div>
  );
}
function Row({ k, v }) { return <div className="flex gap-3"><div className="w-32 shrink-0 font-bold text-slate-400">{k}</div><div className="text-slate-700">{v}</div></div>; }

// ---------------- Preview modal (after step 1) ----------------
// Styled after a public careers detail page (jobs.pyjamahr.com), in brand colours.
function PreviewModal({ job, onCancel, onProceed }) {
  const expLabel = job.experienceType === 'freshers' ? 'Fresher' : job.experienceType === 'intern' ? 'Intern' : `${job.expMin || 0} – ${job.expMax || 0} years`;
  const empType = { full_time: 'Full-time', part_time: 'Part-time', internship: 'Internship', freelance: 'Freelance' }[job.employmentType] || '';
  const empLevel = { entry: 'Entry Level', associate: 'Associate', mid_senior: 'Mid-Senior', senior: 'Senior', tl: 'Team Lead', manager: 'Manager' }[job.employmentLevel] || '';
  const mode = { in_office: 'In-Office', hybrid: 'Hybrid', remote: 'Remote' }[job.workMode];
  const salary = job.hideSalary ? null : (job.salaryMin || job.salaryMax
    ? `${job.salaryCurrency} ${Number(job.salaryMin || 0).toLocaleString()} – ${Number(job.salaryMax || 0).toLocaleString()} / ${job.salaryPeriod}` : null);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[120] p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl max-h-[88vh] flex flex-col overflow-hidden">
        {/* Branded header band */}
        <div className="px-8 py-6 text-white" style={{ background: 'linear-gradient(120deg,#050A1F,#0B1533)' }}>
          <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#FF8A3D' }}>{job.department || 'Careers'}</div>
          <div className="text-2xl font-extrabold mt-1">{job.title}</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[13px] text-slate-200">
            {(job.locations || []).length > 0 && <span>📍 {(job.locations || []).join(' · ')}</span>}
            <span>💼 {mode}</span>
            <span>⏳ {expLabel}</span>
            {empType && <span>🕒 {empType}</span>}
          </div>
        </div>

        <div className="p-8 overflow-auto">
          <div className="flex flex-wrap gap-2 mb-5">
            {empLevel && <Pill>{empLevel}</Pill>}
            {job.education && <Pill>{job.education}</Pill>}
            {salary && <Pill accent>{salary}</Pill>}
            {job.openings > 1 && <Pill>{job.openings} openings</Pill>}
          </div>

          {(job.skills || []).length > 0 && (
            <>
              <SectionTitle>Skills</SectionTitle>
              <div className="flex flex-wrap gap-1.5 mb-5">
                {job.skills.map((s, i) => (
                  <span key={i} className={`rounded-full px-3 py-1 text-xs font-semibold ${s.primary ? 'text-white' : 'bg-slate-100 text-slate-600'}`} style={s.primary ? { background: 'linear-gradient(90deg,#FF6A00,#FF4500)' } : undefined}>{s.primary ? '★ ' : ''}{s.name}</span>
                ))}
              </div>
            </>
          )}

          <SectionTitle>Job description</SectionTitle>
          <div className="prose prose-sm max-w-none text-slate-700 prose-headings:text-[#050A1F] prose-headings:font-extrabold" dangerouslySetInnerHTML={{ __html: job.description || '<p class="text-slate-400">No description yet.</p>' }} />
        </div>

        <div className="px-8 py-4 border-t border-slate-100 flex justify-end gap-2 bg-slate-50">
          <button onClick={onCancel} className="rounded-lg border border-slate-300 px-6 py-2.5 text-sm font-bold text-slate-600 bg-white">Cancel</button>
          <button onClick={onProceed} className="rounded-lg px-6 py-2.5 text-sm font-bold text-white" style={{ background: ORANGE }}>Proceed</button>
        </div>
      </div>
    </div>
  );
}
function Pill({ children, accent }) { return <span className={`rounded-lg px-3 py-1.5 text-xs font-bold ${accent ? 'bg-orange-50 text-orange-700' : 'bg-slate-100 text-slate-600'}`}>{children}</span>; }
function SectionTitle({ children }) { return <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">{children}</div>; }

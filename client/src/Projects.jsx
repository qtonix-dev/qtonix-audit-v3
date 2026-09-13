import React, { useState, useEffect } from 'react';
import { hrApi } from './HrApp.jsx';
import { toast } from './toast';

const ORANGE = 'linear-gradient(135deg,#FF6A00,#FF4500)';
const TYPE_STYLE = {
  website: { bg: '#F0FDF4', color: '#16A34A', label: 'Website' },
  seo: { bg: '#EFF6FF', color: '#2563EB', label: 'SEO' },
  seo_social: { bg: '#EFF6FF', color: '#2563EB', label: 'SEO + Social' },
  seo_social_ads: { bg: '#FEF2F2', color: '#DC2626', label: 'SEO+Social+Ads' },
  custom: { bg: '#F5F3FF', color: '#7C3AED', label: 'Custom' },
};
const HEALTH = {
  on_track: { color: '#16a34a', label: 'On track' },
  at_risk: { color: '#d97706', label: 'At risk' },
  behind: { color: '#dc2626', label: 'Behind' },
  paused: { color: '#64748b', label: 'Paused' },
  cancelled: { color: '#94a3b8', label: 'Cancelled' },
};
const STATUS_PILL = {
  setup: { bg: '#F8FAFC', color: '#64748b', label: 'Setup' },
  active: { bg: '#FFF7ED', color: '#EA580C', label: 'Active' },
  paused: { bg: '#F1F5F9', color: '#64748b', label: 'Paused' },
  cancelled: { bg: '#FEF2F2', color: '#dc2626', label: 'Cancelled' },
  completed: { bg: '#F0FDF4', color: '#16a34a', label: 'Completed' },
};
const initials = (n) => (n || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const avColor = (n) => { const c = ['#6d28d9', '#0891b2', '#16a34a', '#ea580c', '#db2777', '#2563eb', '#7c3aed']; let h = 0; for (const ch of (n || '')) h = (h * 31 + ch.charCodeAt(0)) | 0; return c[Math.abs(h) % c.length]; };
const fmtDate = (d) => d ? new Date(d + 'T00:00:00+05:30').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function ProjectsView({ user }) {
  const [projects, setProjects] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [q, setQ] = useState('');
  const load = () => hrApi('/projects').then((r) => setProjects(r.projects || [])).catch(() => setProjects([]));
  useEffect(() => { load(); }, []);

  if (openId) return <ProjectDetail id={openId} onBack={() => { setOpenId(null); load(); }} />;
  if (!projects) return <div className="p-10 text-center text-slate-400 text-sm">Loading projects…</div>;

  const shown = projects.filter((p) => (!filterStatus || p.status === filterStatus) && (!filterType || p.projectType === filterType) && (!q || (p.customerName || '').toLowerCase().includes(q.toLowerCase()) || (p.website || '').toLowerCase().includes(q.toLowerCase())));
  const activeCount = projects.filter((p) => p.status === 'active').length;

  return (
    <div className="pb-8">
      <div className="flex items-center justify-between mb-4">
        <div><h1 className="text-2xl font-extrabold text-[#050A1F]">Projects</h1><div className="text-[13px] text-slate-400">{activeCount} active · {projects.length} total</div></div>
        <button onClick={() => setShowCreate(true)} className="text-white font-bold px-4 py-2.5 rounded-xl text-sm" style={{ background: ORANGE }}>+ Create Project</button>
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl p-3 flex items-center gap-2.5 mb-4 flex-wrap">
        <span className="text-[13px] font-bold text-[#050A1F]">Filter</span>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-[12.5px] text-slate-600 bg-white"><option value="">Status: All</option>{Object.keys(STATUS_PILL).map((s) => <option key={s} value={s}>{STATUS_PILL[s].label}</option>)}</select>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-[12.5px] text-slate-600 bg-white"><option value="">Type: All</option>{Object.keys(TYPE_STYLE).map((t) => <option key={t} value={t}>{TYPE_STYLE[t].label}</option>)}</select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer…" className="border border-slate-200 rounded-lg px-3 py-1.5 text-[12.5px] text-slate-600 flex-1 min-w-[160px]" />
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <table className="w-full border-collapse">
          <thead className="bg-slate-50/70"><tr className="text-left text-[11px] font-extrabold text-slate-400 uppercase">
            <th className="px-4 py-2.5">Customer</th><th className="px-3 py-2.5">Type</th><th className="px-3 py-2.5">PM</th><th className="px-3 py-2.5">Team</th><th className="px-3 py-2.5">Stage</th><th className="px-3 py-2.5">Start</th><th className="px-3 py-2.5">Health</th>
          </tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400 text-sm">No projects yet. Create one from a won deal.</td></tr>}
            {shown.map((p) => {
              const ts = TYPE_STYLE[p.projectType] || TYPE_STYLE.custom; const h = HEALTH[p.health] || HEALTH.on_track;
              return (
                <tr key={p.id} onClick={() => setOpenId(p.id)} className="border-t border-slate-100 hover:bg-slate-50/60 cursor-pointer">
                  <td className="px-4 py-3"><div className="font-bold text-[#050A1F] text-[13.5px]">{p.customerName}</div><div className="text-[11px] text-slate-400">{p.website}</div></td>
                  <td className="px-3 py-3"><span className="inline-flex px-2.5 py-1 rounded-full text-[11px] font-extrabold" style={{ background: ts.bg, color: ts.color }}>{ts.label}</span></td>
                  <td className="px-3 py-3 text-[13px] text-slate-600">{p.projectManagerName || '—'}</td>
                  <td className="px-3 py-3"><div className="flex">{(p.members || []).slice(0, 4).map((m, i) => <span key={i} title={m.name} className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-extrabold border-2 border-white" style={{ background: avColor(m.name), marginLeft: i ? -6 : 0 }}>{initials(m.name)}</span>)}{p.memberCount > 4 && <span className="w-6 h-6 rounded-full flex items-center justify-center text-slate-500 text-[9px] font-extrabold border-2 border-white bg-slate-200" style={{ marginLeft: -6 }}>+{p.memberCount - 4}</span>}</div></td>
                  <td className="px-3 py-3"><span className="inline-flex px-2.5 py-1 rounded-full text-[11px] font-bold" style={{ background: '#FFF7ED', color: '#EA580C' }}>{p.stageName || STATUS_PILL[p.status]?.label || '—'}</span></td>
                  <td className="px-3 py-3 text-[12.5px] text-slate-500">{fmtDate(p.startDate)}</td>
                  <td className="px-3 py-3"><span className="inline-flex items-center gap-1.5 text-[12px] font-bold" style={{ color: h.color }}><span className="w-2 h-2 rounded-full" style={{ background: h.color }} />{h.label}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {showCreate && <CreateProjectModal onClose={() => setShowCreate(false)} onCreated={(id) => { setShowCreate(false); load(); setOpenId(id); }} />}
    </div>
  );
}

// ===================== CREATE PROJECT MODAL =====================
function CreateProjectModal({ onClose, onCreated }) {
  const [leads, setLeads] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [people, setPeople] = useState([]);
  const [f, setF] = useState({ leadId: '', projectType: 'seo', subType: 'new', cmsPlatform: 'wordpress', templateId: '', startDate: new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10), projectManagerId: '', servicesTaken: ['seo'], requirements: '', campaignParams: { keywords: '', backlinksPerMonth: '', articlesPerMonth: '', platforms: '', postsPerMonth: '', callsPerMonth: '' }, members: [] });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    hrApi('/projects/templates').then((r) => setTemplates(r.templates || [])).catch(() => {});
    hrApi('/employees').then((r) => setPeople(Array.isArray(r) ? r : (r.people || r.users || []))).catch(() => {});
    hrApi('/projects/won-leads').then((r) => setLeads(r.leads || [])).catch(() => setLeads([]));
  }, []);
  const isWebsite = f.projectType === 'website';
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const setCp = (k, v) => setF((s) => ({ ...s, campaignParams: { ...s.campaignParams, [k]: v } }));
  const create = async () => {
    if (!f.projectManagerId) { toast('Please select a Project Manager'); return; }
    setBusy(true);
    try {
      const lead = leads.find((l) => String(l.id) === String(f.leadId));
      const body = { ...f, customerName: lead ? lead.customerName : undefined };
      const r = await hrApi('/projects', { method: 'POST', body: JSON.stringify(body) });
      toast('Project created 🎉'); onCreated(r.id);
    } catch (e) { toast(e.message || 'Could not create project'); }
    setBusy(false);
  };
  const pmOptions = people;
  const relevantTemplates = templates.filter((t) => t.projectType === f.projectType);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5" style={{ background: 'linear-gradient(135deg,#0A0E28,#1e293b)' }}>
          <div className="text-white text-[17px] font-extrabold">Create Project</div>
          <div className="text-slate-400 text-[12px] mt-0.5">From a won deal — customer details copy over</div>
        </div>
        <div className="p-6 max-h-[560px] overflow-auto">
          <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Won Deal / Customer</label>
          <select value={f.leadId} onChange={(e) => set('leadId', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] mb-3">
            <option value="">Select a won deal…</option>
            {leads.map((l) => <option key={l.id} value={l.id}>{l.customerName} — {l.website}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Project Type</label>
              <select value={f.projectType} onChange={(e) => { set('projectType', e.target.value); set('templateId', ''); }} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] mb-3">
                <option value="website">Website Design & Development</option><option value="seo">SEO</option><option value="seo_social">SEO + Social</option><option value="seo_social_ads">SEO + Social + Ads</option>
              </select></div>
            <div><label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Flow Template</label>
              <select value={f.templateId} onChange={(e) => set('templateId', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] mb-3">
                <option value="">None (blank)</option>{relevantTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select></div>
          </div>
          {isWebsite && (
            <div className="rounded-lg border border-green-200 bg-green-50/50 p-3 mb-3">
              <div className="text-[11px] font-extrabold text-green-700 uppercase mb-2">🌐 Website Details</div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Sub-type</label><select value={f.subType} onChange={(e) => set('subType', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px]"><option value="new">New Website</option><option value="redesign">Redesign</option><option value="ecommerce">eCommerce</option><option value="landing">Landing Page</option><option value="webapp">Web App</option></select></div>
                <div><label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">CMS Platform</label><select value={f.cmsPlatform} onChange={(e) => set('cmsPlatform', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px]"><option value="wordpress">WordPress</option><option value="shopify">Shopify</option><option value="webflow">Webflow</option><option value="custom">Custom / Headless</option><option value="wix">Wix</option><option value="drupal">Drupal</option></select></div>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Start Date</label><input type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] mb-3" /></div>
            <div><label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Project Manager</label><select value={f.projectManagerId} onChange={(e) => { set('projectManagerId', e.target.value); const p = people.find((x) => String(x.id) === e.target.value); set('projectManagerName', p ? p.name : ''); }} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] mb-3"><option value="">Select…</option>{pmOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          </div>
          {!isWebsite && (
            <>
              <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Campaign Parameters</label>
              <div className="grid grid-cols-3 gap-2 mb-3">
                {[['keywords', 'Keywords'], ['backlinksPerMonth', 'Backlinks/mo'], ['articlesPerMonth', 'Articles/mo'], ['platforms', 'Platforms'], ['postsPerMonth', 'Posts/mo'], ['callsPerMonth', 'Calls/mo']].map(([k, lbl]) => (
                  <div key={k}><div className="text-[10px] text-slate-400 mb-0.5">{lbl}</div><input value={f.campaignParams[k]} onChange={(e) => setCp(k, e.target.value)} className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-[13px]" /></div>
                ))}
              </div>
            </>
          )}
          <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">Project Requirements <span className="normal-case text-slate-300 font-normal">· shared by customer</span></label>
          <textarea value={f.requirements} onChange={(e) => set('requirements', e.target.value)} rows={3} placeholder="Requirements, scope, brand notes, go-live target…" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] mb-2" />
          <div className="text-[11px] text-slate-400">Team members & permissions can be set on the project after creation.</div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-[13px] font-bold text-slate-500 bg-slate-100">Cancel</button>
          <button onClick={create} disabled={busy} className="px-5 py-2 rounded-lg text-[13px] font-extrabold text-white" style={{ background: ORANGE, opacity: busy ? 0.6 : 1 }}>Create Project →</button>
        </div>
      </div>
    </div>
  );
}

// ===================== PROJECT DETAIL =====================
function ProjectDetail({ id, onBack }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('timeline');
  const load = () => hrApi(`/projects/${id}`).then(setData).catch((e) => { toast(e.message); onBack(); });
  useEffect(() => { load(); }, [id]);
  if (!data) return <div className="p-10 text-center text-slate-400 text-sm">Loading project…</div>;
  const p = data.project; const canSeeContact = data.canSeeContact;
  const ts = TYPE_STYLE[p.projectType] || TYPE_STYLE.custom;
  const pmMember = (data.members || []).find((m) => m.role === 'pm');
  const teamMembers = (data.members || []).filter((m) => m.role !== 'pm');
  const nextReport = (data.steps || []).filter((s) => !['done', 'approved'].includes(s.status) && s.dueDate).sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))[0];

  const Mask = ({ show, value, icon }) => show ? <span className="text-[14px] text-[#050A1F] font-semibold">{value || '—'}</span> : <span className="inline-flex items-center gap-1.5 bg-slate-100 text-slate-400 rounded-md px-2 py-0.5 text-[12px] font-semibold">🔒 {icon}</span>;

  return (
    <div className="pb-8">
      <div className="flex items-center gap-2 mb-4 text-[13px]"><button onClick={onBack} className="text-slate-400 hover:text-slate-600 font-semibold">← Projects</button><span className="text-slate-300">/</span><span className="font-bold text-[#050A1F]">{p.customerName}</span></div>
      <div className="grid lg:grid-cols-[340px_1fr] gap-4 items-start">
        {/* LEFT */}
        <div className="space-y-4">
          {/* Customer (masked) */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-lg font-extrabold" style={{ background: avColor(p.customerName) }}>{initials(p.customerName)}</div>
              <div><div className="text-[16px] font-extrabold text-[#050A1F]">{p.customerName}</div><a href={p.website ? `https://${p.website.replace(/^https?:\/\//, '')}` : '#'} target="_blank" rel="noreferrer" className="text-[12px] text-blue-600">{p.website}</a></div>
            </div>
            <span className="inline-flex px-2.5 py-1 rounded-full text-[11px] font-extrabold mb-3" style={{ background: (STATUS_PILL[p.status] || {}).bg, color: (STATUS_PILL[p.status] || {}).color }}>● {(STATUS_PILL[p.status] || {}).label}{p.currentStage ? ` · Stage ${p.currentStage}` : ''}</span>
            <div className="text-[11px] font-bold text-slate-400 uppercase mb-1">Contact Name</div><div className="mb-2"><Mask show={canSeeContact} value={p.contactName} icon="Hidden" /></div>
            <div className="text-[11px] font-bold text-slate-400 uppercase mb-1">Email</div><div className="mb-2"><Mask show={canSeeContact} value={p.email} icon="•••••" /></div>
            <div className="text-[11px] font-bold text-slate-400 uppercase mb-1">Phone</div><div><Mask show={canSeeContact} value={p.phone} icon="+•• ••••" /></div>
            {!canSeeContact && <div className="text-[11px] text-slate-300 mt-2">Only authorized members can view contact details.</div>}
          </div>
          {/* PM & Team */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <div className="text-[13px] font-extrabold text-[#050A1F] mb-3">👥 Project Manager & Team</div>
            <div className="text-[11px] font-bold text-slate-400 uppercase mb-1">Project Manager</div>
            <div className="flex items-center gap-2 mb-3"><span className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-extrabold" style={{ background: avColor(p.projectManagerName) }}>{initials(p.projectManagerName)}</span><div><div className="text-[13px] font-bold text-[#050A1F]">{p.projectManagerName || '—'}</div><div className="text-[11px] text-slate-400">Project Manager</div></div></div>
            <div className="text-[11px] font-bold text-slate-400 uppercase mb-1">Team Members</div>
            <div className="flex flex-col gap-2">
              {teamMembers.length === 0 && <div className="text-[12px] text-slate-400">No team members yet.</div>}
              {teamMembers.map((m) => <div key={m.id} className="flex items-center gap-2"><span className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-extrabold" style={{ background: avColor(m.name) }}>{initials(m.name)}</span><div><div className="text-[13px] font-semibold text-[#050A1F]">{m.name}</div><div className="text-[11px] text-slate-400">{m.department}{m.role === 'lead' ? ' · Lead' : ''}</div></div></div>)}
            </div>
          </div>
          {/* Dates & reporting */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <div className="text-[13px] font-extrabold text-[#050A1F] mb-3">📅 Dates & Reporting</div>
            <div className="text-[11px] font-bold text-slate-400 uppercase mb-1">Project Start Date</div><div className="text-[14px] font-semibold text-[#050A1F] mb-2.5">{fmtDate(p.startDate)}</div>
            <div className="text-[11px] font-bold text-slate-400 uppercase mb-1">Expected End</div><div className="text-[14px] font-semibold text-[#050A1F] mb-2.5">{p.recurring ? 'Recurring (monthly)' : fmtDate(p.expectedEndDate)}</div>
            <div className="text-[11px] font-bold text-slate-400 uppercase mb-1">Next Report / Step Due</div>
            {nextReport ? <span className="inline-flex px-2.5 py-1 rounded-full text-[11px] font-bold" style={{ background: '#FEF2F2', color: '#dc2626' }}>⚠ {fmtDate(nextReport.dueDate)} · {nextReport.name}</span> : <span className="text-[13px] text-slate-400">—</span>}
          </div>
        </div>
        {/* RIGHT: tabs */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="flex gap-1 px-3 pt-2 border-b border-slate-100 overflow-x-auto">
            {[['timeline', 'Timeline'], ['requirements', 'Requirements'], ['notes', 'Notes'], ['reports', 'Reports'], ['flow', 'Flow'], ['members', 'Members'], ['credentials', '🔒 Credentials']].map(([k, lbl]) => (
              <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 text-[13px] font-bold whitespace-nowrap ${tab === k ? 'text-[#FF6A00] border-b-2 border-[#FF6A00]' : 'text-slate-400'}`}>{lbl}</button>
            ))}
          </div>
          <div className="p-5">
            {tab === 'timeline' && <TimelineTab id={id} />}
            {tab === 'requirements' && <RequirementsTab p={p} onSaved={load} />}
            {tab === 'notes' && <div className="text-[13px] text-slate-400 py-8 text-center">Notes — coming in the next update.</div>}
            {tab === 'reports' && <ReportsTab id={id} data={data} onReload={load} />}
            {tab === 'flow' && <FlowTab id={id} steps={data.steps} perms={data.myPerms} onReload={load} />}
            {tab === 'members' && <MembersTab id={id} data={data} onReload={load} />}
            {tab === 'credentials' && <CredentialsTab id={id} data={data} onReload={load} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function TimelineTab({ id }) {
  const [events, setEvents] = useState(null);
  useEffect(() => { hrApi(`/projects/${id}/timeline`).then((r) => setEvents(r.events || [])).catch(() => setEvents([])); }, [id]);
  if (!events) return <div className="text-slate-400 text-sm py-6 text-center">Loading…</div>;
  if (!events.length) return <div className="text-slate-400 text-sm py-8 text-center">No activity yet.</div>;
  const icon = (e) => e.type === 'approval' ? '⏳' : (e.kind === 'completed' ? '✅' : e.kind === 'created' ? '🆕' : '🔄');
  return <div>{events.map((e, i) => <div key={i} className="flex gap-3 py-2.5 border-b border-slate-50 last:border-0"><div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm bg-slate-50">{icon(e)}</div><div><div className="text-[13px] text-[#050A1F]">{e.by ? <b>{e.by} </b> : ''}{e.text}</div><div className="text-[11px] text-slate-400">{new Date(e.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</div></div></div>)}</div>;
}

function RequirementsTab({ p, onSaved }) {
  const cp = p.campaignParams || {};
  return (
    <div className="space-y-4">
      {(p.servicesTaken || []).length > 0 && (
        <div><div className="text-[13px] font-extrabold text-[#050A1F] mb-2">Workstreams</div><div className="flex gap-2 flex-wrap">{(p.servicesTaken || []).map((s) => <span key={s} className="px-3 py-1.5 rounded-lg text-[12px] font-bold" style={{ background: '#EFF6FF', color: '#2563EB' }}>{s.toUpperCase()}</span>)}</div></div>
      )}
      {Object.keys(cp).length > 0 && (
        <div><div className="text-[13px] font-extrabold text-[#050A1F] mb-2">Campaign Parameters</div><div className="grid grid-cols-2 gap-x-8 gap-y-0">{Object.entries(cp).filter(([, v]) => v !== '' && v != null).map(([k, v]) => <div key={k} className="flex justify-between py-2 border-b border-slate-50 text-[13px]"><span className="text-slate-500 capitalize">{k.replace(/([A-Z])/g, ' $1')}</span><b className="text-[#050A1F]">{String(v)}</b></div>)}</div></div>
      )}
      {p.projectType === 'website' && (p.subType || p.cmsPlatform) && (
        <div><div className="text-[13px] font-extrabold text-[#050A1F] mb-2">Website</div><div className="text-[13px] text-slate-600">Sub-type: <b className="capitalize">{p.subType}</b> · CMS: <b className="capitalize">{p.cmsPlatform}</b></div></div>
      )}
      <div><div className="text-[13px] font-extrabold text-[#050A1F] mb-2">Requirements shared by customer</div><div className="text-[13px] text-slate-600 leading-relaxed whitespace-pre-wrap">{p.requirements || <span className="text-slate-400">No requirements recorded.</span>}</div></div>
    </div>
  );
}

function FlowTab({ id, steps, perms, onReload }) {
  const [note, setNote] = useState({});
  const stages = {};
  (steps || []).forEach((s) => { (stages[s.stageIndex] = stages[s.stageIndex] || { name: s.stageName, steps: [] }).steps.push(s); });
  const STATUS = { locked: { c: '#94a3b8', bg: '#f1f5f9', ic: '🔒' }, active: { c: '#2563eb', bg: '#eff6ff', ic: '▶' }, in_task: { c: '#ea580c', bg: '#fff7ed', ic: '⏳' }, awaiting_approval: { c: '#7c3aed', bg: '#f5f3ff', ic: '⏳' }, changes_requested: { c: '#dc2626', bg: '#fef2f2', ic: '🔁' }, approved: { c: '#16a34a', bg: '#f0fdf4', ic: '✓' }, done: { c: '#16a34a', bg: '#f0fdf4', ic: '✓' } };
  const canApprove = perms && (perms.admin || perms.approveClientSteps);
  const canEdit = perms && (perms.admin || perms.editFlow);
  const approve = async (s, ok) => { try { await hrApi(`/projects/${id}/steps/${s.id}/approve`, { method: 'POST', body: JSON.stringify({ approved: ok, note: note[s.id] || '' }) }); toast(ok ? 'Approved' : 'Changes requested'); onReload(); } catch (e) { toast(e.message); } };
  const skip = async (s) => { try { await hrApi(`/projects/${id}/steps/${s.id}/skip`, { method: 'POST', body: '{}' }); onReload(); } catch (e) { toast(e.message); } };
  return (
    <div className="space-y-3">
      {Object.keys(stages).sort((a, b) => a - b).map((si) => {
        const st = stages[si]; const done = st.steps.every((s) => ['done', 'approved'].includes(s.status));
        return (
          <div key={si} className="rounded-xl border p-3" style={{ borderColor: done ? '#e2e8f0' : '#FED7AA' }}>
            <div className="text-[12px] font-extrabold uppercase mb-2" style={{ color: done ? '#16a34a' : '#EA580C' }}>{done ? '✓' : '●'} {st.name}</div>
            {st.steps.map((s) => { const stt = STATUS[s.status] || STATUS.locked; return (
              <div key={s.id} className="flex items-start gap-3 py-2 border-t border-slate-50 first:border-0">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0" style={{ background: stt.bg, color: stt.c }}>{stt.ic}</span>
                <div className="flex-1">
                  <div className="text-[13px] font-semibold text-[#050A1F]">{s.name}{s.needsClientApproval && <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#f5f3ff', color: '#7c3aed' }}>client approval</span>}{s.isOptional && <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#fef3c7', color: '#b45309' }}>optional</span>}</div>
                  <div className="text-[11px] text-slate-400">{s.department || '—'}{s.dueDate ? ` · due ${fmtDate(s.dueDate)}` : ''}</div>
                  {s.status === 'awaiting_approval' && canApprove && (
                    <div className="mt-2 flex items-center gap-2">
                      <input value={note[s.id] || ''} onChange={(e) => setNote((n) => ({ ...n, [s.id]: e.target.value }))} placeholder="Note (for changes)…" className="border border-slate-200 rounded-lg px-2.5 py-1 text-[12px] flex-1" />
                      <button onClick={() => approve(s, true)} className="text-[11px] font-bold text-white rounded-lg px-3 py-1.5" style={{ background: '#16a34a' }}>✓ Approved</button>
                      <button onClick={() => approve(s, false)} className="text-[11px] font-bold text-red-600 rounded-lg px-3 py-1.5 border border-red-200">Changes</button>
                    </div>
                  )}
                  {s.status === 'changes_requested' && <div className="text-[11px] text-red-500 mt-1">Changes requested{s.approvalNote ? `: ${s.approvalNote}` : ''}</div>}
                </div>
                {s.isOptional && !['done', 'approved'].includes(s.status) && canEdit && <button onClick={() => skip(s)} className="text-[11px] text-slate-400 hover:text-slate-600">Skip</button>}
              </div>
            ); })}
          </div>
        );
      })}
      {(!steps || steps.length === 0) && <div className="text-slate-400 text-sm py-8 text-center">No flow — create the project with a template to generate steps.</div>}
    </div>
  );
}

function ReportsTab({ id, data, onReload }) {
  const [dels, setDels] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const cycle = (data.cycles || [])[0];
  const load = () => hrApi(`/projects/${id}/deliverables`).then((r) => setDels(r.deliverables || [])).catch(() => setDels([]));
  useEffect(() => { load(); }, [id]);
  const canApprove = data.myPerms && (data.myPerms.admin || data.myPerms.approveDeliverables);
  const canUpload = data.myPerms && (data.myPerms.admin || data.myPerms.uploadDeliverables);
  const approve = async (d, ok) => { try { await hrApi(`/projects/${id}/deliverables/${d.id}/approve`, { method: 'POST', body: JSON.stringify({ approved: ok }) }); load(); } catch (e) { toast(e.message); } };
  if (!dels) return <div className="text-slate-400 text-sm py-6 text-center">Loading…</div>;
  return (
    <div>
      {cycle && (
        <div className="rounded-xl bg-slate-50 p-3 mb-4">
          <div className="flex items-center gap-2 mb-2"><b className="text-[13px] text-[#050A1F]">Cycle {cycle.cycleNumber}</b><span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: cycle.invoicePaid ? '#F0FDF4' : '#FEF2F2', color: cycle.invoicePaid ? '#16a34a' : '#dc2626' }}>{cycle.invoicePaid ? '☑ Invoice paid' : '☐ Invoice unpaid'}</span></div>
          <div className="grid grid-cols-3 gap-3 text-[12px]">
            {Object.entries(cycle.targets || {}).filter(([, v]) => v).map(([k, target]) => { const got = dels.filter((d) => d.cycleId === cycle.id && (k === 'backlinks' ? d.type === 'backlink' : k === 'posts' ? d.type === 'social_post' : d.type === k.replace(/s$/, ''))).length; return <div key={k}><div className="text-slate-500 capitalize mb-1">{k} <b>{got}/{target}</b></div><div className="h-1.5 rounded bg-slate-200 overflow-hidden"><div className="h-full rounded" style={{ width: `${Math.min(100, (got / target) * 100)}%`, background: '#16a34a' }} /></div></div>; })}
          </div>
        </div>
      )}
      <div className="flex items-center justify-between mb-2"><b className="text-[13px] text-[#050A1F]">Deliverables</b>{canUpload && <button onClick={() => setShowAdd(true)} className="text-[12px] font-bold text-white rounded-lg px-3 py-1.5" style={{ background: '#FF6A00' }}>+ Add</button>}</div>
      {dels.length === 0 && <div className="text-slate-400 text-sm py-6 text-center">No deliverables yet.</div>}
      {dels.length > 0 && (
        <table className="w-full text-[12.5px]"><thead><tr className="text-left text-[10.5px] font-extrabold text-slate-400 uppercase"><th className="py-2">Item</th><th className="py-2">Type</th><th className="py-2">By</th><th className="py-2">Approval</th></tr></thead>
          <tbody>{dels.map((d) => <tr key={d.id} className="border-t border-slate-50"><td className="py-2"><a href={d.url} target="_blank" rel="noreferrer" className="text-blue-600">{d.title || d.url}</a>{d.platform && <span className="text-slate-400"> · {d.platform}</span>}</td><td className="py-2 capitalize">{d.type.replace('_', ' ')}</td><td className="py-2">{d.submittedByName}</td><td className="py-2">{d.approvalStatus === 'approved' ? <span className="text-green-600 font-bold">Approved</span> : d.approvalStatus === 'rejected' ? <span className="text-red-600 font-bold">Rejected</span> : canApprove ? <span className="flex gap-1"><button onClick={() => approve(d, true)} className="text-[11px] font-bold text-green-600">✓</button><button onClick={() => approve(d, false)} className="text-[11px] font-bold text-red-500">✕</button></span> : <span className="text-orange-500 font-bold">Pending</span>}</td></tr>)}</tbody>
        </table>
      )}
      {showAdd && <AddDeliverableModal id={id} cycleId={cycle && cycle.id} onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); load(); }} />}
    </div>
  );
}

function AddDeliverableModal({ id, cycleId, onClose, onAdded }) {
  const [f, setF] = useState({ type: 'backlink', title: '', url: '', platform: '' });
  const add = async () => { try { await hrApi(`/projects/${id}/deliverables`, { method: 'POST', body: JSON.stringify({ ...f, cycleId }) }); toast('Added'); onAdded(); } catch (e) { toast(e.message); } };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[210] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-sm p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="text-[15px] font-extrabold text-[#050A1F] mb-3">Add Deliverable</div>
        <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] mb-2"><option value="backlink">Backlink</option><option value="social_post">Social Post</option><option value="report">Report</option><option value="content">Content</option><option value="file">File / Link</option></select>
        <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Title / description" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] mb-2" />
        <input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="URL / link" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] mb-2" />
        {f.type === 'social_post' && <input value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })} placeholder="Platform (Instagram, LinkedIn…)" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] mb-2" />}
        <div className="flex justify-end gap-2 mt-2"><button onClick={onClose} className="px-3 py-1.5 rounded-lg text-[12px] font-bold text-slate-500 bg-slate-100">Cancel</button><button onClick={add} className="px-4 py-1.5 rounded-lg text-[12px] font-extrabold text-white" style={{ background: '#FF6A00' }}>Add</button></div>
      </div>
    </div>
  );
}

function MembersTab({ id, data, onReload }) {
  const isAdmin = data.myPerms && data.myPerms.admin;
  const PERMS = [['editFlow', 'Edit Flow'], ['approveClientSteps', 'Approve Client'], ['approveDeliverables', 'Approve Deliverables'], ['uploadDeliverables', 'Upload'], ['viewContact', 'View Contact'], ['manageMembers', 'Manage']];
  const toggle = async (m, k) => { if (!isAdmin) return; try { await hrApi(`/projects/${id}/members/${m.userId}/perms`, { method: 'PUT', body: JSON.stringify({ [k]: !m[k] }) }); onReload(); } catch (e) { toast(e.message); } };
  return (
    <div>
      <div className="text-[13px] font-extrabold text-[#050A1F] mb-1">Member Permissions</div>
      <div className="text-[12px] text-slate-400 mb-3">Admin & PM have full access. Tap a cell to toggle.</div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]"><thead><tr className="text-slate-400 text-[10px] font-extrabold uppercase"><th className="text-left py-2 pr-3">Member</th>{PERMS.map(([, l]) => <th key={l} className="py-2 px-1.5 text-center">{l}</th>)}</tr></thead>
          <tbody>{(data.members || []).map((m) => <tr key={m.id} className="border-t border-slate-50"><td className="py-2.5 pr-3"><div className="flex items-center gap-2"><span className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-extrabold" style={{ background: avColor(m.name) }}>{initials(m.name)}</span><div><div className="font-bold text-[#050A1F] text-[12.5px]">{m.name}</div><div className="text-[10px] text-slate-400">{m.department}{m.role === 'pm' ? ' · PM' : ''}</div></div></div></td>
            {PERMS.map(([k]) => <td key={k} className="py-2.5 px-1.5 text-center"><button onClick={() => toggle(m, k)} disabled={!isAdmin || m.role === 'pm'} className="w-5 h-5 rounded" style={{ background: (m[k] || m.role === 'pm') ? '#16a34a' : '#f1f5f9', border: (m[k] || m.role === 'pm') ? 'none' : '1px solid #e2e8f0', color: '#fff', fontSize: 11 }}>{(m[k] || m.role === 'pm') ? '✓' : ''}</button></td>)}
          </tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function CredentialsTab({ id, data, onReload }) {
  const [creds, setCreds] = useState(null);
  const [reveal, setReveal] = useState({});
  const [showAdd, setShowAdd] = useState(false);
  const load = () => hrApi(`/projects/${id}/credentials`).then((r) => setCreds(r.credentials || [])).catch(() => setCreds([]));
  useEffect(() => { load(); }, [id]);
  const doReveal = async (c) => { try { const r = await hrApi(`/projects/${id}/credentials/${c.id}/reveal`); setReveal((s) => ({ ...s, [c.id]: r })); } catch (e) { toast(e.message); } };
  if (!creds) return <div className="text-slate-400 text-sm py-6 text-center">Loading…</div>;
  return (
    <div>
      <div className="flex items-center justify-between mb-3"><div><b className="text-[13px] text-[#050A1F]">🔒 Credentials Vault</b><div className="text-[11px] text-slate-400">Encrypted · department-scoped · views are logged</div></div><button onClick={() => setShowAdd(true)} className="text-[12px] font-bold text-white rounded-lg px-3 py-1.5" style={{ background: '#FF6A00' }}>+ Add</button></div>
      {creds.length === 0 && <div className="text-slate-400 text-sm py-6 text-center">No credentials stored, or none for your team.</div>}
      <div className="space-y-2">{creds.map((c) => <div key={c.id} className="rounded-xl border border-slate-200 p-3">
        <div className="flex items-center justify-between"><div><b className="text-[13px] text-[#050A1F]">{c.label}</b> <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#eff6ff', color: '#2563eb' }}>{c.department}</span></div>{c.hasSecret && !reveal[c.id] && <button onClick={() => doReveal(c)} className="text-[12px] font-bold text-orange-600">👁 Reveal</button>}</div>
        <div className="text-[12px] text-slate-500 mt-1">User: {c.username || '—'}{c.url && <> · <a href={c.url} target="_blank" rel="noreferrer" className="text-blue-600">{c.url}</a></>}</div>
        {reveal[c.id] && <div className="mt-2 rounded-lg bg-slate-50 p-2 text-[12px] font-mono text-[#050A1F]">Password: <b>{reveal[c.id].secret}</b></div>}
        {c.note && <div className="text-[11px] text-slate-400 mt-1">{c.note}</div>}
      </div>)}</div>
      {showAdd && <AddCredModal id={id} onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); load(); }} />}
    </div>
  );
}

function AddCredModal({ id, onClose, onAdded }) {
  const [f, setF] = useState({ label: '', department: '', username: '', secret: '', url: '', note: '' });
  const add = async () => { try { await hrApi(`/projects/${id}/credentials`, { method: 'POST', body: JSON.stringify(f) }); toast('Saved'); onAdded(); } catch (e) { toast(e.message); } };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[210] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-sm p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="text-[15px] font-extrabold text-[#050A1F] mb-3">Add Credential</div>
        <input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Label (cPanel, WP Admin, GSC…)" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] mb-2" />
        <input value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} placeholder="Department (SEO, Development, Social…)" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] mb-2" />
        <input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} placeholder="Username" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] mb-2" />
        <input value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} placeholder="Password / token (encrypted)" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] mb-2" />
        <input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="URL (optional)" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] mb-2" />
        <div className="flex justify-end gap-2 mt-2"><button onClick={onClose} className="px-3 py-1.5 rounded-lg text-[12px] font-bold text-slate-500 bg-slate-100">Cancel</button><button onClick={add} className="px-4 py-1.5 rounded-lg text-[12px] font-extrabold text-white" style={{ background: '#FF6A00' }}>Save</button></div>
      </div>
    </div>
  );
}

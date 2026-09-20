import React, { useState, useEffect } from 'react';
import { hrApi } from './HrApp.jsx';
import { toast, confirmDialog } from './toast';
import { Icon, titleCase } from './HrParts.jsx';

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

// The selectable services and their per-service parameter fields. A field only
// shows when its service is selected.
const SERVICES = [
  { id: 'website_design', label: 'Website Design' },
  { id: 'web_development', label: 'Web Development' },
  { id: 'seo', label: 'SEO' },
  { id: 'ai_seo', label: 'AI SEO' },
  { id: 'local_seo', label: 'Local SEO' },
  { id: 'social_media', label: 'Social Media' },
  { id: 'paid_ads', label: 'Paid Ads' },
  { id: 'video', label: 'Video' },
  { id: 'other', label: 'Other' },
];
const SOCIAL_PLATFORMS = ['Facebook', 'Instagram', 'LinkedIn', 'Reddit', 'TikTok', 'YouTube'];
const WEB_TYPES = ['New Website', 'Website Redesign', 'Custom'];
const CMS_OPTIONS = ['WordPress', 'WordPress + WooCommerce', 'Shopify', 'Payload', 'Other'];
const CMS_BUILDER = { 'WordPress': ['Elementor', 'Custom'], 'WordPress + WooCommerce': ['Elementor', 'Custom'] };
const TECH_STACK = ['Laravel', 'React JS', 'Node.js', 'Next.js', 'Vue', 'Other'];

// Searchable single-select dropdown.
function SearchSelect({ value, onChange, options, placeholder, render }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const sel = options.find((o) => String(o.value) === String(value));
  const filtered = options.filter((o) => !q || (o.label || '').toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-left flex items-center justify-between">
        <span className={sel ? 'text-[#050A1F]' : 'text-slate-400'}>{sel ? (render ? render(sel) : sel.label) : (placeholder || 'Select…')}</span><span className="text-slate-400">▾</span>
      </button>
      {open && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-64 overflow-auto">
          <div className="p-2 sticky top-0 bg-white border-b border-slate-100"><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12.5px]" /></div>
          {filtered.length === 0 && <div className="px-3 py-3 text-[12px] text-slate-400">No matches</div>}
          {filtered.map((o) => <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false); setQ(''); }} className="w-full text-left px-3 py-2 text-[13px] hover:bg-slate-50">{render ? render(o) : o.label}</button>)}
        </div>
      )}
    </div>
  );
}

// Free-text tag input (type + Enter to add).
function TagInput({ tags, onChange, placeholder }) {
  const [v, setV] = useState('');
  const add = () => { const t = v.trim(); if (t && !tags.includes(t)) onChange([...tags, t]); setV(''); };
  return (
    <div className="border border-slate-200 rounded-lg px-2 py-1.5 flex flex-wrap gap-1.5 items-center">
      {tags.map((t) => <span key={t} className="inline-flex items-center gap-1 bg-slate-100 rounded-md px-2 py-0.5 text-[12px] text-slate-700">{t}<button type="button" onClick={() => onChange(tags.filter((x) => x !== t))} className="text-slate-400 hover:text-red-500">×</button></span>)}
      <input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} onBlur={add} placeholder={placeholder || 'Type & Enter…'} className="flex-1 min-w-[100px] text-[13px] outline-none py-0.5" />
    </div>
  );
}

const FLbl = ({ children }) => <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">{children}</label>;
const FInp = (props) => <input {...props} className={"w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] " + (props.className || '')} />;

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
  const [plans, setPlans] = useState([]);
  const [f, setF] = useState({
    leadId: '', templateId: '', startDate: new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10),
    projectManagerId: '', projectManagerName: '', services: [], requirements: '',
    // per-service params:
    website: { projectType: 'New Website', platform: 'CMS', cms: 'WordPress', cmsBuilder: 'Elementor', techStack: [] },
    seo: { plan: '', keywords: '', backlinksPerMonth: '', articlesPerMonth: '', blogsPerMonth: '', targetLocations: [], targetKeywords: [], competitors: [], salesRemark: '' },
    local_seo: { locations: '', postsPerMonth: '' },
    social_media: { platforms: [], postsPerMonth: '' },
    paid_ads: { targetLocations: [], shoppingAds: 'No', dailyBudget: '' },
    video: { count: '' },
  });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    hrApi('/projects/templates').then((r) => setTemplates(r.templates || [])).catch(() => {});
    hrApi('/employees').then((r) => setPeople(Array.isArray(r) ? r : (r.people || r.users || []))).catch(() => {});
    hrApi('/projects/won-leads').then((r) => setLeads(r.leads || [])).catch(() => setLeads([]));
    hrApi('/projects/plans').then((r) => setPlans(r.plans || [])).catch(() => {});
  }, []);
  const has = (s) => f.services.includes(s);
  const toggleService = (s) => setF((st) => ({ ...st, services: st.services.includes(s) ? st.services.filter((x) => x !== s) : [...st.services, s] }));
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const setSvc = (svc, k, v) => setF((s) => ({ ...s, [svc]: { ...s[svc], [k]: v } }));
  const applyPlan = (planId) => { const pl = plans.find((p) => String(p.id) === String(planId)); if (pl) { const sp = (pl.params && pl.params.seo) || pl.params || {}; setF((s) => ({ ...s, seo: { ...s.seo, plan: pl.name, keywords: sp.keywords ?? s.seo.keywords, backlinksPerMonth: sp.backlinksPerMonth ?? s.seo.backlinksPerMonth, articlesPerMonth: sp.articlesPerMonth ?? s.seo.articlesPerMonth, blogsPerMonth: sp.blogsPerMonth ?? s.seo.blogsPerMonth } })); } else setSvc('seo', 'plan', ''); };
  const seoPlans = plans.filter((p) => (p.params && p.params.services ? p.params.services.includes('seo') : p.service === 'seo'));

  const create = async () => {
    if (!f.projectManagerId) { toast('Please select a Project Manager'); return; }
    if (!f.services.length) { toast('Please select at least one service'); return; }
    setBusy(true);
    try {
      const lead = leads.find((l) => String(l.id) === String(f.leadId));
      // Determine a coarse projectType for template/health logic.
      const isWeb = has('website_design') || has('web_development');
      const projectType = isWeb ? 'website' : (has('social_media') && has('paid_ads')) ? 'seo_social_ads' : has('social_media') ? 'seo_social' : 'seo';
      const recurring = has('seo') || has('ai_seo') || has('local_seo') || has('social_media') || has('paid_ads');
      // Build service-grouped campaignParams (only selected services).
      const params = {};
      for (const s of f.services) if (f[s]) params[s] = f[s];
      const body = {
        leadId: f.leadId || undefined, customerName: lead ? lead.customerName : undefined,
        projectType, subType: isWeb ? f.website.projectType : '', cmsPlatform: isWeb ? (f.website.platform === 'CMS' ? f.website.cms : 'Custom') : '',
        servicesTaken: f.services, requirements: f.requirements, campaignParams: params,
        startDate: f.startDate, projectManagerId: f.projectManagerId, projectManagerName: f.projectManagerName,
        templateId: f.templateId || undefined, recurring,
      };
      const r = await hrApi('/projects', { method: 'POST', body: JSON.stringify(body) });
      toast('Project created 🎉'); onCreated(r.id);
    } catch (e) { toast(e.message || 'Could not create project'); }
    setBusy(false);
  };

  const num = (svc, k, lbl) => <div><div className="text-[10px] text-slate-400 mb-0.5">{lbl}</div><FInp value={f[svc][k]} onChange={(e) => setSvc(svc, k, e.target.value)} /></div>;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5" style={{ background: 'linear-gradient(135deg,#0A0E28,#1e293b)' }}>
          <div className="text-white text-[17px] font-extrabold">Create Project</div>
          <div className="text-slate-400 text-[12px] mt-0.5">From a won deal — customer details copy over</div>
        </div>
        <div className="p-6 max-h-[600px] overflow-auto">
          <FLbl>Won Deal / Customer</FLbl>
          <div className="mb-3"><SearchSelect value={f.leadId} onChange={(v) => set('leadId', v)} placeholder="Search & select a won deal…" options={leads.map((l) => ({ value: l.id, label: `${l.customerName} — ${l.website}` }))} /></div>

          {/* SERVICES multi-select */}
          <FLbl>Services Taken <span className="normal-case text-slate-300 font-normal">· select all that apply</span></FLbl>
          <div className="flex flex-wrap gap-2 mb-4">
            {SERVICES.map((s) => <button key={s.id} type="button" onClick={() => toggleService(s.id)} className={`px-3 py-1.5 rounded-lg text-[12.5px] font-bold border transition ${has(s.id) ? 'text-white border-transparent' : 'text-slate-500 border-slate-200 bg-white'}`} style={has(s.id) ? { background: ORANGE } : {}}>{has(s.id) ? '✓ ' : ''}{s.label}</button>)}
          </div>

          {/* Per-service conditional blocks */}
          {(has('website_design') || has('web_development')) && (
            <div className="rounded-lg border border-green-200 bg-green-50/40 p-3 mb-3">
              <div className="text-[11px] font-extrabold text-green-700 uppercase mb-2">🌐 Website</div>
              <div className="grid grid-cols-2 gap-3 mb-2">
                <div><FLbl>Project Type</FLbl><select value={f.website.projectType} onChange={(e) => setSvc('website', 'projectType', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px]">{WEB_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
                <div><FLbl>Platform</FLbl><select value={f.website.platform} onChange={(e) => setSvc('website', 'platform', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px]"><option>CMS</option><option>Custom</option></select></div>
              </div>
              {f.website.platform === 'CMS' && (
                <div className="grid grid-cols-2 gap-3">
                  <div><FLbl>CMS</FLbl><select value={f.website.cms} onChange={(e) => setSvc('website', 'cms', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px]">{CMS_OPTIONS.map((c) => <option key={c}>{c}</option>)}</select></div>
                  {CMS_BUILDER[f.website.cms] && <div><FLbl>Builder</FLbl><select value={f.website.cmsBuilder} onChange={(e) => setSvc('website', 'cmsBuilder', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px]">{CMS_BUILDER[f.website.cms].map((b) => <option key={b}>{b}</option>)}</select></div>}
                </div>
              )}
              {f.website.platform === 'Custom' && (
                <div><FLbl>Tech Stack</FLbl><div className="flex flex-wrap gap-2">{TECH_STACK.map((t) => <button key={t} type="button" onClick={() => setSvc('website', 'techStack', f.website.techStack.includes(t) ? f.website.techStack.filter((x) => x !== t) : [...f.website.techStack, t])} className={`px-2.5 py-1 rounded-lg text-[12px] font-semibold border ${f.website.techStack.includes(t) ? 'bg-slate-800 text-white border-transparent' : 'border-slate-200 text-slate-500'}`}>{t}</button>)}</div></div>
              )}
            </div>
          )}

          {has('seo') && (
            <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-3 mb-3">
              <div className="text-[11px] font-extrabold text-blue-700 uppercase mb-2">🔍 SEO</div>
              <div className="mb-2"><FLbl>Plan {seoPlans.length === 0 && <span className="normal-case text-slate-300 font-normal">· none yet (Admin → Project Flow)</span>}</FLbl>
                <select value={f.seo.plan} onChange={(e) => applyPlan(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px]"><option value="">Custom (enter below)</option>{seoPlans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              </div>
              <div className="grid grid-cols-4 gap-2 mb-2">{num('seo', 'keywords', 'Keywords')}{num('seo', 'backlinksPerMonth', 'Backlinks/mo')}{num('seo', 'articlesPerMonth', 'Articles/mo')}{num('seo', 'blogsPerMonth', 'Blogs/mo')}</div>
              <div className="mb-2"><FLbl>Target Country / Location</FLbl><TagInput tags={f.seo.targetLocations} onChange={(t) => setSvc('seo', 'targetLocations', t)} placeholder="Add a country/location…" /></div>
              <div className="mb-2"><FLbl>Targeted Keywords</FLbl><TagInput tags={f.seo.targetKeywords} onChange={(t) => setSvc('seo', 'targetKeywords', t)} placeholder="Add a keyword…" /></div>
              <div className="mb-2"><FLbl>Competitors</FLbl><TagInput tags={f.seo.competitors} onChange={(t) => setSvc('seo', 'competitors', t)} placeholder="Add a competitor…" /></div>
              <div><FLbl>Remark from Sales Team</FLbl><textarea value={f.seo.salesRemark} onChange={(e) => setSvc('seo', 'salesRemark', e.target.value)} rows={2} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px]" /></div>
            </div>
          )}

          {has('local_seo') && (
            <div className="rounded-lg border border-teal-200 bg-teal-50/40 p-3 mb-3">
              <div className="text-[11px] font-extrabold text-teal-700 uppercase mb-2">📍 Local SEO</div>
              <div className="grid grid-cols-2 gap-3">{num('local_seo', 'locations', 'How many locations')}{num('local_seo', 'postsPerMonth', 'Posts / month')}</div>
            </div>
          )}

          {has('social_media') && (
            <div className="rounded-lg border border-pink-200 bg-pink-50/40 p-3 mb-3">
              <div className="text-[11px] font-extrabold text-pink-700 uppercase mb-2">📱 Social Media</div>
              <FLbl>Platforms</FLbl>
              <div className="flex flex-wrap gap-2 mb-2">{SOCIAL_PLATFORMS.map((pl) => <button key={pl} type="button" onClick={() => setSvc('social_media', 'platforms', f.social_media.platforms.includes(pl) ? f.social_media.platforms.filter((x) => x !== pl) : [...f.social_media.platforms, pl])} className={`px-2.5 py-1 rounded-lg text-[12px] font-semibold border ${f.social_media.platforms.includes(pl) ? 'bg-pink-600 text-white border-transparent' : 'border-slate-200 text-slate-500'}`}>{pl}</button>)}</div>
              <div className="w-40">{num('social_media', 'postsPerMonth', 'Posts / month')}</div>
            </div>
          )}

          {has('paid_ads') && (
            <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 mb-3">
              <div className="text-[11px] font-extrabold text-violet-700 uppercase mb-2">🎯 Paid Ads</div>
              <div className="mb-2"><FLbl>Target Locations</FLbl><TagInput tags={f.paid_ads.targetLocations} onChange={(t) => setSvc('paid_ads', 'targetLocations', t)} placeholder="Add a location…" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><FLbl>Shopping Ads</FLbl><select value={f.paid_ads.shoppingAds} onChange={(e) => setSvc('paid_ads', 'shoppingAds', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px]"><option>No</option><option>Yes</option></select></div>
                {num('paid_ads', 'dailyBudget', 'Daily Budget')}
              </div>
            </div>
          )}

          {has('video') && (
            <div className="rounded-lg border border-slate-200 bg-slate-50/40 p-3 mb-3">
              <div className="text-[11px] font-extrabold text-slate-600 uppercase mb-2">🎬 Video</div>
              <div className="w-40">{num('video', 'count', 'Number of videos')}</div>
            </div>
          )}

          {/* start / PM / template */}
          <div className="grid grid-cols-3 gap-3 mt-1">
            <div><FLbl>Start Date</FLbl><FInp type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} /></div>
            <div><FLbl>Project Manager</FLbl><SearchSelect value={f.projectManagerId} onChange={(v) => { set('projectManagerId', v); const p = people.find((x) => String(x.id) === String(v)); set('projectManagerName', p ? p.name : ''); }} placeholder="Select PM…" options={people.map((p) => ({ value: p.id, label: p.name }))} /></div>
            <div><FLbl>Flow Template</FLbl><select value={f.templateId} onChange={(e) => set('templateId', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px]"><option value="">None</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
          </div>

          {/* Requirements — constant */}
          <div className="mt-3"><FLbl>Project Requirements <span className="normal-case text-slate-300 font-normal">· shared by customer</span></FLbl>
            <textarea value={f.requirements} onChange={(e) => set('requirements', e.target.value)} rows={3} placeholder="Requirements, scope, brand notes, go-live target…" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px]" /></div>
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

// ===================== ADMIN: DAILY TASK FLOW =====================
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function TaskFlowAdmin() {
  const [flows, setFlows] = useState(null);
  const [editing, setEditing] = useState(null);
  const [running, setRunning] = useState(false);
  const load = () => hrApi('/tasks/task-flows').then((r) => setFlows(r.flows || [])).catch(() => setFlows([]));
  useEffect(() => { load(); }, []);
  const toggle = async (f) => { try { await hrApi(`/tasks/task-flows/${f.id}`, { method: 'PUT', body: JSON.stringify({ active: !f.active }) }); load(); } catch (e) { toast(e.message); } };
  const runNow = async () => { setRunning(true); try { const r = await hrApi('/tasks/task-flows/run', { method: 'POST', body: '{}' }); toast(`Created ${r.created} task(s) for today ✓`); } catch (e) { toast(e.message); } setRunning(false); };
  if (editing) return <TaskFlowEditor flow={editing.id ? editing : null} onBack={() => { setEditing(null); load(); }} />;
  if (!flows) return <div className="text-slate-400 text-sm py-6">Loading…</div>;
  const targetLabel = (f) => ({ employee: 'Employees', designation: 'Designation', team: 'Team', group: 'Group' }[f.targetType] || f.targetType);
  const targetTag = (f) => ({ designation: { bg: '#ede9fe', c: '#6d28d9' }, team: { bg: '#dbeafe', c: '#1d4ed8' }, employee: { bg: '#dcfce7', c: '#15803d' }, group: { bg: '#fef3c7', c: '#b45309' } }[f.targetType] || { bg: '#f1f5f9', c: '#64748b' });
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div><div className="text-[15px] font-extrabold text-[#050A1F]">Daily Task Flow</div><div className="text-[12.5px] text-slate-400">Auto-assign recurring tasks (daily / weekly / monthly) to people, designations, teams or groups.</div></div>
        <div className="flex gap-2">
          <button onClick={runNow} disabled={running} className="rounded-lg px-3 py-2 text-[12.5px] font-bold text-slate-600 border border-slate-200">{running ? 'Running…' : '▶ Run now'}</button>
          <button onClick={() => setEditing({})} className="rounded-lg px-4 py-2 text-[13px] font-bold text-white" style={{ background: ORANGE }}>+ New task flow</button>
        </div>
      </div>
      <div className="mt-4 space-y-2.5">
        {flows.length === 0 && <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-[13px] text-slate-400">No task flows yet. Create one to auto-assign recurring tasks.</div>}
        {flows.map((f) => { const tg = targetTag(f); const tasks = (f.items || []).length; return (
          <div key={f.id} className="bg-white border border-slate-200 rounded-2xl p-4 flex gap-3.5 items-center">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center text-[21px] shrink-0" style={{ background: '#fff7ed' }}>🔁</div>
            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-extrabold text-[#050A1F]">{f.name}</div>
              <div className="text-[12px] text-slate-500 mt-0.5 flex gap-2 items-center flex-wrap">
                <span className="text-[10px] font-bold rounded-full px-2 py-0.5" style={{ background: tg.bg, color: tg.c }}>{targetLabel(f)}: {(f.targetValues || []).join(', ')}</span>
                <span className="text-slate-400">· {tasks} task{tasks !== 1 ? 's' : ''}{f.peopleCount != null ? ` · ${f.peopleCount} people` : ''}</span>
              </div>
            </div>
            <button onClick={() => setEditing(f)} className="text-[12px] font-bold text-slate-600 border border-slate-200 rounded-lg px-3 py-1.5">Edit</button>
            <button onClick={() => toggle(f)} title={f.active ? 'Active' : 'Paused'} className="w-10 h-6 rounded-full relative transition shrink-0" style={{ background: f.active ? '#22c55e' : '#cbd5e1' }}><span className="absolute top-1 w-4 h-4 rounded-full bg-white transition-all" style={{ left: f.active ? '20px' : '4px' }} /></button>
          </div>
        ); })}
      </div>
    </div>
  );
}

function TaskFlowEditor({ flow, onBack }) {
  const [name, setName] = useState(flow ? flow.name : '');
  const [targetType, setTargetType] = useState(flow ? flow.targetType : 'employee');
  const [targetValues, setTargetValues] = useState(flow ? (flow.targetValues || []) : []);
  const [items, setItems] = useState(flow ? (flow.items || []) : [{ id: `it${Date.now()}`, title: '', priority: 'medium', cadence: 'daily', weekdays: [], dayOfMonth: 1 }]);
  const [busy, setBusy] = useState(false);
  const [empSearch, setEmpSearch] = useState('');
  const [dir, setDir] = useState({ employees: [], designations: [], teams: [] });
  useEffect(() => {
    hrApi('/users?scope=directory').then((r) => {
      const emps = (r.employees || r.users || r || []).filter((u) => u.active !== false);
      setDir({ employees: emps, designations: [...new Set(emps.map((e) => e.designation).filter(Boolean))].sort(), teams: [...new Set(emps.map((e) => e.department).filter(Boolean))].sort() });
    }).catch(() => {});
    hrApi('/chat/teams').then((r) => { const ts = (r.teams || []).map((t) => t.name); if (ts.length) setDir((d) => ({ ...d, teams: [...new Set([...(d.teams || []), ...ts])].sort() })); }).catch(() => {});
  }, []);
  const setItem = (i, obj) => setItems((s) => s.map((x, idx) => idx === i ? { ...x, ...obj } : x));
  const addItem = () => setItems((s) => [...s, { id: `it${Date.now()}`, title: '', priority: 'medium', cadence: 'daily', weekdays: [], dayOfMonth: 1 }]);
  const delItem = (i) => setItems((s) => s.filter((_, idx) => idx !== i));
  const toggleWeekday = (i, wd) => setItem(i, { weekdays: (items[i].weekdays || []).includes(wd) ? items[i].weekdays.filter((x) => x !== wd) : [...(items[i].weekdays || []), wd] });
  const save = async () => {
    if (!name.trim()) { toast('Give the flow a name.'); return; }
    if (!targetValues.length) { toast('Pick at least one target.'); return; }
    if (!items.some((it) => it.title.trim())) { toast('Add at least one task.'); return; }
    setBusy(true);
    const body = JSON.stringify({ name, targetType, targetValues, items: items.filter((it) => it.title.trim()) });
    try { if (flow && flow.id) await hrApi(`/tasks/task-flows/${flow.id}`, { method: 'PUT', body }); else await hrApi('/tasks/task-flows', { method: 'POST', body }); toast('Task flow saved ✓'); onBack(); }
    catch (e) { toast(e.message); setBusy(false); }
  };
  const del = async () => { if (!(await confirmDialog({ title: 'Delete this flow?', message: 'It will stop creating tasks. Existing tasks stay.', danger: true, confirmText: 'Delete' }))) return; try { await hrApi(`/tasks/tasks/task-flows/${flow.id}`, { method: 'DELETE' }); onBack(); } catch (e) { toast(e.message); } };
  const TT = [['employee', 'Employees'], ['designation', 'Designation'], ['team', 'Team'], ['group', 'Group']];
  const multiEmp = targetType === 'employee' || targetType === 'group';
  const opts = targetType === 'designation' ? dir.designations : targetType === 'team' ? dir.teams : [];

  return (
    <div className="max-w-3xl">
      <button onClick={onBack} className="text-[13px] font-bold text-slate-500 mb-4">← Back to task flows</button>
      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <label className="text-[10.5px] font-bold text-slate-500 uppercase block mb-1.5">Flow name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. SEO Executive — Daily Ops" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] mb-4" />

        <label className="text-[10.5px] font-bold text-slate-500 uppercase block mb-1.5">Assign to</label>
        {/* One target type per flow: once a selection exists, other tabs are disabled until you clear it. */}
        <div className="flex gap-1.5 mb-2">{TT.map(([v, l]) => { const locked = targetValues.length > 0 && targetType !== v; return (
          <button key={v} disabled={locked} onClick={() => { if (locked) return; setTargetType(v); setTargetValues([]); setEmpSearch(''); }} className={`flex-1 rounded-lg py-2 text-[12px] font-bold border ${targetType === v ? 'text-white border-transparent' : locked ? 'text-slate-300 border-slate-100 bg-slate-50 cursor-not-allowed' : 'text-slate-500 border-slate-200 bg-white'}`} style={targetType === v ? { background: '#050A1F' } : {}}>{l}</button>
        ); })}</div>
        {targetValues.length > 0 && <div className="text-[10.5px] text-slate-400 mb-2">Uncheck / clear the selection to switch to a different target type.</div>}
        {multiEmp ? (
          <div>
            {/* selected chips */}
            {targetValues.length > 0 && <div className="flex flex-wrap gap-1.5 mb-2">{targetValues.map((eid) => { const e = dir.employees.find((x) => x.id === eid); return <span key={eid} className="inline-flex items-center gap-1 text-[11.5px] font-semibold bg-slate-100 text-slate-700 rounded-full pl-2.5 pr-1.5 py-1">{e ? titleCase(e.name) : eid}<button onClick={() => setTargetValues((s) => s.filter((x) => x !== eid))} className="text-slate-400 hover:text-red-500 text-[13px] leading-none">×</button></span>; })}</div>}
            <div className="relative mb-1.5"><span className="absolute left-2.5 top-2 text-slate-400 text-[13px]">🔍</span><input value={empSearch} onChange={(e) => setEmpSearch(e.target.value)} placeholder="Search people…" className="w-full border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-[13px]" /></div>
            <div className="border border-slate-200 rounded-lg p-2 max-h-44 overflow-auto">
              {dir.employees.filter((e) => !empSearch || `${e.name} ${e.designation || ''} ${e.department || ''}`.toLowerCase().includes(empSearch.toLowerCase())).map((e) => <label key={e.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 text-[13px] cursor-pointer"><input type="checkbox" checked={targetValues.includes(e.id)} onChange={() => setTargetValues((s) => s.includes(e.id) ? s.filter((x) => x !== e.id) : [...s, e.id])} /><span className="font-semibold text-slate-700">{titleCase(e.name)}</span><span className="text-slate-400 text-[11px]">{[e.designation, e.department].filter(Boolean).join(' · ')}</span></label>)}
              {dir.employees.length === 0 && <div className="text-[12px] text-slate-400 px-2 py-2">Loading employees…</div>}
            </div>
          </div>
        ) : (
          <SearchSelect value={targetValues[0] || ''} onChange={(v) => setTargetValues(v ? [v] : [])} options={opts.map((o) => ({ value: o, label: o }))} placeholder={`Search ${targetType}…`} />
        )}
        {targetType === 'designation' && <div className="text-[11px] text-slate-400 mt-1.5">Applies to everyone with this designation — including future hires.</div>}
        {targetType === 'team' && <div className="text-[11px] text-slate-400 mt-1.5">Applies to all current members of this team.</div>}

        <div className="text-[11px] font-extrabold text-slate-400 uppercase mt-6 mb-2.5">Tasks in this flow</div>
        <div className="space-y-2.5">
          {items.map((it, i) => {
            const subs = it.subtasks || [];
            const setSub = (k, obj) => setItem(i, { subtasks: subs.map((x, idx) => idx === k ? { ...x, ...obj } : x) });
            const addSub = () => setItem(i, { subtasks: [...subs, { id: `sub${Date.now()}`, title: '', priority: 'medium' }] });
            const delSub = (k) => setItem(i, { subtasks: subs.filter((_, idx) => idx !== k) });
            const hasDesc = it.description != null && (it._showDesc || it.description);
            return (
            <div key={it.id || i} className="border border-slate-200 rounded-xl p-3.5">
              <div className="flex gap-2 items-center">
                <input value={it.title} onChange={(e) => setItem(i, { title: e.target.value })} placeholder="Task title" className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-[13px] font-semibold" />
                <select value={it.priority} onChange={(e) => setItem(i, { priority: e.target.value })} className="border border-slate-200 rounded-lg px-2 py-2 text-[12px] w-24">{['urgent', 'high', 'medium', 'low'].map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}</select>
                <button onClick={() => delItem(i)} className="text-slate-300 hover:text-red-500 px-1"><Icon.Trash size={16} /></button>
              </div>
              {/* Optional description — only shows when opened */}
              {hasDesc ? (
                <textarea value={it.description || ''} onChange={(e) => setItem(i, { description: e.target.value })} placeholder="Task description…" rows={2} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[12.5px] mt-2" />
              ) : (
                <button onClick={() => setItem(i, { _showDesc: true, description: it.description || '' })} className="text-[11.5px] font-bold text-slate-400 hover:text-slate-600 mt-2">+ Add description</button>
              )}
              <div className="flex gap-2 items-center mt-2.5 flex-wrap">
                <span className="text-[11px] font-bold text-slate-400">Repeats:</span>
                {['daily', 'weekly', 'monthly'].map((c) => <button key={c} onClick={() => setItem(i, { cadence: c })} className={`rounded-lg px-3 py-1.5 text-[11.5px] font-bold border ${it.cadence === c ? 'border-orange-400 text-orange-700' : 'border-slate-200 text-slate-500'}`} style={it.cadence === c ? { background: '#fff7ed' } : {}}>{titleCase(c)}</button>)}
                {it.cadence === 'weekly' && <div className="flex gap-1 ml-1">{WEEKDAYS.map((d, wd) => <button key={wd} onClick={() => toggleWeekday(i, wd)} className={`w-7 h-7 rounded-lg text-[11px] font-bold border ${(it.weekdays || []).includes(wd) ? 'text-white border-transparent' : 'text-slate-400 border-slate-200'}`} style={(it.weekdays || []).includes(wd) ? { background: ORANGE } : {}}>{d}</button>)}</div>}
                {it.cadence === 'monthly' && <select value={it.dayOfMonth} onChange={(e) => setItem(i, { dayOfMonth: e.target.value === 'last' ? 'last' : Number(e.target.value) })} className="border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] ml-1">{Array.from({ length: 31 }, (_, k) => k + 1).map((d) => <option key={d} value={d}>On the {d}{['th', 'st', 'nd', 'rd'][(d % 10 > 3 || (d >= 11 && d <= 13)) ? 0 : d % 10]}</option>)}<option value="last">Last day</option></select>}
              </div>
              {/* Subtasks — child rows, like the workspace */}
              {subs.length > 0 && (
                <div className="mt-3 pl-3 border-l-2 border-slate-100 space-y-1.5">
                  {subs.map((s, k) => (
                    <div key={s.id || k} className="flex gap-2 items-center">
                      <span className="text-slate-300 text-[13px]">↳</span>
                      <input value={s.title} onChange={(e) => setSub(k, { title: e.target.value })} placeholder="Subtask title" className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12.5px]" />
                      <select value={s.priority} onChange={(e) => setSub(k, { priority: e.target.value })} className="border border-slate-200 rounded-lg px-2 py-1.5 text-[11.5px] w-20">{['urgent', 'high', 'medium', 'low'].map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}</select>
                      <button onClick={() => delSub(k)} className="text-slate-300 hover:text-red-500 px-0.5"><Icon.Trash size={14} /></button>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={addSub} className="text-[11.5px] font-bold text-slate-400 hover:text-orange-600 mt-2.5 ml-1">+ Add subtask</button>
            </div>
          ); })}
        </div>
        <button onClick={addItem} className="w-full mt-2.5 rounded-lg border border-dashed border-orange-300 text-orange-600 font-bold text-[12.5px] py-2.5">+ Add task</button>

        <div className="flex items-center gap-2 mt-5 pt-4 border-t border-slate-100">
          <div className="text-[11.5px] text-slate-400 flex-1">Tasks auto-post each morning to assignees’ boards.</div>
          {flow && flow.id && <button onClick={del} className="rounded-lg px-4 py-2 text-[13px] font-bold text-red-500 border border-red-100">Delete</button>}
          <button onClick={save} disabled={busy} className="rounded-lg px-6 py-2 text-[13px] font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : 'Save flow'}</button>
        </div>
      </div>
    </div>
  );
}

// ===================== ADMIN: PROJECT FLOW (Templates + Plans) =====================
export function ProjectFlowAdmin() {
  const [tab, setTab] = useState('templates');
  return (
    <div>
      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab('templates')} className={`px-4 py-2 rounded-lg text-[13px] font-bold ${tab === 'templates' ? 'text-white' : 'text-slate-500 bg-slate-100'}`} style={tab === 'templates' ? { background: ORANGE } : {}}>Flow Templates</button>
        <button onClick={() => setTab('plans')} className={`px-4 py-2 rounded-lg text-[13px] font-bold ${tab === 'plans' ? 'text-white' : 'text-slate-500 bg-slate-100'}`} style={tab === 'plans' ? { background: ORANGE } : {}}>Service Plans</button>
        <button onClick={() => setTab('taskflow')} className={`px-4 py-2 rounded-lg text-[13px] font-bold ${tab === 'taskflow' ? 'text-white' : 'text-slate-500 bg-slate-100'}`} style={tab === 'taskflow' ? { background: ORANGE } : {}}>Daily Task Flow</button>
      </div>
      {tab === 'templates' ? <FlowTemplatesAdmin /> : tab === 'plans' ? <PlansAdmin /> : <TaskFlowAdmin />}
    </div>
  );
}

const DEPARTMENTS = ['PM', 'Design', 'Development', 'SEO', 'Content', 'Social Media', 'Performance Marketing', 'Support'];

function FlowTemplatesAdmin() {
  const [templates, setTemplates] = useState(null);
  const [editing, setEditing] = useState(null);
  const load = () => hrApi('/projects/templates').then((r) => setTemplates(r.templates || [])).catch(() => setTemplates([]));
  useEffect(() => { load(); }, []);
  if (editing) return <TemplateEditor tmpl={editing} onBack={() => { setEditing(null); load(); }} />;
  if (!templates) return <div className="text-slate-400 text-sm py-6">Loading…</div>;
  const blank = { name: '', services: [], projectType: 'seo', recurring: true, stages: [] };
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-[13px] text-slate-400">Define the stages & steps for each project type. Projects get an editable copy.</div>
        <button onClick={() => setEditing(blank)} className="text-white font-bold px-3.5 py-2 rounded-lg text-[13px]" style={{ background: ORANGE }}>+ New Template</button>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        {templates.map((t) => (
          <div key={t.id} onClick={() => setEditing(t)} className="bg-white border border-slate-200 rounded-xl p-4 cursor-pointer hover:shadow-md">
            <div className="flex items-center justify-between mb-1"><div className="font-extrabold text-[#050A1F]">{t.name || 'Untitled template'}</div>{t.recurring && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-50 text-orange-600">Recurring</span>}</div>
            <div className="flex gap-1 flex-wrap mb-1.5">{((t.services && t.services.length) ? t.services : [t.projectType]).map((s) => { const sv = TEMPLATE_SERVICES.find((x) => x.id === s); return <span key={s} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{sv ? `${sv.icon} ${sv.label}` : s}</span>; })}</div>
            <div className="text-[12px] text-slate-400">{(t.stages || []).length} stages · {(t.stages || []).reduce((n, s) => n + (s.steps || []).length, 0)} steps</div>
          </div>
        ))}
        {templates.length === 0 && <div className="text-slate-400 text-sm py-6">No templates yet.</div>}
      </div>
    </div>
  );
}

const TEMPLATE_SERVICES = [
  { id: 'website_design', label: 'Website Design', icon: '🎨' },
  { id: 'web_development', label: 'Web Development', icon: '💻' },
  { id: 'seo', label: 'SEO', icon: '🔍' },
  { id: 'local_seo', label: 'Local SEO', icon: '📍' },
  { id: 'ai_seo', label: 'AI SEO', icon: '🤖' },
  { id: 'smo', label: 'SMO', icon: '📱' },
  { id: 'paid_ads', label: 'Paid Ads', icon: '🎯' },
  { id: 'video', label: 'Video', icon: '🎬' },
  { id: 'other', label: 'Other', icon: '✨' },
];
const DEPT_COLOR = { PM: '#4F46E5', Design: '#7C3AED', Development: '#EA580C', SEO: '#2563EB', Content: '#16A34A', 'Social Media': '#DB2777', 'Performance Marketing': '#0891B2', Support: '#64748B' };

function TemplateEditor({ tmpl, onBack }) {
  const init = JSON.parse(JSON.stringify(tmpl));
  if (!init.services) init.services = init.projectType ? [init.projectType] : [];
  const [t, setT] = useState(init);
  const [busy, setBusy] = useState(false);
  const upd = (k, v) => setT((s) => ({ ...s, [k]: v }));
  const toggleSvc = (id) => setT((s) => ({ ...s, services: (s.services || []).includes(id) ? s.services.filter((x) => x !== id) : [...(s.services || []), id] }));
  const addStage = () => setT((s) => ({ ...s, stages: [...(s.stages || []), { name: `Stage ${(s.stages || []).length + 1}`, steps: [] }] }));
  const updStage = (i, k, v) => setT((s) => { const st = [...s.stages]; st[i] = { ...st[i], [k]: v }; return { ...s, stages: st }; });
  const delStage = (i) => setT((s) => ({ ...s, stages: s.stages.filter((_, x) => x !== i) }));
  const addStep = (si) => setT((s) => { const st = [...s.stages]; st[si] = { ...st[si], steps: [...(st[si].steps || []), { name: '', department: 'PM', deadlineDays: 3, needsClientApproval: false, isRecurringMonthly: false, isOptional: false }] }; return { ...s, stages: st }; });
  const updStep = (si, pi, k, v) => setT((s) => { const st = [...s.stages]; const steps = [...st[si].steps]; steps[pi] = { ...steps[pi], [k]: v }; st[si] = { ...st[si], steps }; return { ...s, stages: st }; });
  const delStep = (si, pi) => setT((s) => { const st = [...s.stages]; st[si] = { ...st[si], steps: st[si].steps.filter((_, x) => x !== pi) }; return { ...s, stages: st }; });
  const save = async () => {
    if (!t.name.trim()) { toast('Give the template a name'); return; }
    if (!(t.services || []).length) { toast('Select at least one service'); return; }
    setBusy(true);
    const body = { ...t, projectType: t.services[0] };
    try { if (t.id) await hrApi(`/projects/templates/${t.id}`, { method: 'PUT', body: JSON.stringify(body) }); else await hrApi('/projects/templates', { method: 'POST', body: JSON.stringify(body) }); toast(t.id ? 'Template updated ✓' : 'Template created 🎉'); onBack(); } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const del = async () => { if (t.id && await confirmDialog({ title: 'Delete this template?', danger: true })) { await hrApi(`/projects/templates/${t.id}`, { method: 'DELETE' }); onBack(); } };
  const stepCount = (t.stages || []).reduce((n, s) => n + (s.steps || []).length, 0);

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 mb-4"><button onClick={onBack} className="text-slate-400 text-[13px] font-semibold hover:text-slate-600">← Back to templates</button></div>

      {/* Header card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-4">
        <div className="text-[12px] font-bold text-slate-500 mb-1.5">TEMPLATE NAME</div>
        <input value={t.name} onChange={(e) => upd('name', e.target.value)} placeholder="e.g. SEO + Social — Standard" className="w-full border border-slate-200 rounded-xl px-4 py-3 text-[15px] font-semibold mb-4 focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-300" />
        <div className="text-[12px] font-bold text-slate-500 mb-2">APPLIES TO SERVICES <span className="normal-case text-slate-300 font-normal">· select all that apply</span></div>
        <div className="flex flex-wrap gap-2 mb-4">
          {TEMPLATE_SERVICES.map((s) => { const on = (t.services || []).includes(s.id); return <button key={s.id} type="button" onClick={() => toggleSvc(s.id)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12.5px] font-bold border-2 transition" style={{ borderColor: on ? '#FF6A00' : '#e2e8f0', background: on ? '#FFF7ED' : '#fff', color: on ? '#EA580C' : '#64748b' }}><span>{s.icon}</span>{s.label}{on && ' ✓'}</button>; })}
        </div>
        <label className="flex items-center gap-2 text-[13px] font-semibold text-slate-600 cursor-pointer"><input type="checkbox" checked={t.recurring} onChange={(e) => upd('recurring', e.target.checked)} className="w-4 h-4 accent-orange-500" /> Recurring monthly service <span className="text-[11px] text-slate-400 font-normal">(spins up new tasks each month)</span></label>
      </div>

      {/* Stages */}
      <div className="flex items-center justify-between mb-2 px-1"><div className="text-[13px] font-extrabold text-[#050A1F]">Stages & Steps</div><div className="text-[12px] text-slate-400">{(t.stages || []).length} stages · {stepCount} steps</div></div>
      {(t.stages || []).map((stage, si) => (
        <div key={si} className="bg-white border border-slate-200 rounded-2xl overflow-hidden mb-3">
          <div className="flex items-center gap-2 px-4 py-3 bg-slate-50 border-b border-slate-100">
            <span className="w-6 h-6 rounded-full bg-slate-800 text-white text-[11px] font-extrabold flex items-center justify-center shrink-0">{si + 1}</span>
            <input value={stage.name} onChange={(e) => updStage(si, 'name', e.target.value)} placeholder="Stage name" className="bg-transparent text-[14px] font-extrabold text-[#050A1F] flex-1 focus:outline-none" />
            <button onClick={() => delStage(si)} title="Delete stage" className="text-slate-300 hover:text-red-500 text-[16px]">🗑</button>
          </div>
          <div className="p-3 space-y-2">
            {(stage.steps || []).map((step, pi) => (
              <div key={pi} className="border border-slate-100 rounded-xl p-3 bg-slate-50/40">
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="text-slate-300 text-[13px] shrink-0">{pi + 1}.</span>
                  <input value={step.name} onChange={(e) => updStep(si, pi, 'name', e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-[13px] flex-1 bg-white" placeholder="What needs to be done?" />
                  <button onClick={() => delStep(si, pi)} title="Remove step" className="text-slate-300 hover:text-red-500 text-[15px] shrink-0">✕</button>
                </div>
                <div className="flex items-center gap-2 flex-wrap pl-6">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-400 font-semibold">Team</span>
                    <select value={step.department} onChange={(e) => updStep(si, pi, 'department', e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] font-semibold bg-white" style={{ color: DEPT_COLOR[step.department] || '#334155' }}>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</select>
                  </div>
                  <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-2 py-1">
                    <span className="text-[11px] text-slate-400 font-semibold">Due +</span>
                    <input type="number" value={step.deadlineDays} onChange={(e) => updStep(si, pi, 'deadlineDays', Number(e.target.value))} className="w-10 text-[12.5px] font-bold text-center focus:outline-none" />
                    <span className="text-[11px] text-slate-400">days</span>
                  </div>
                  <button type="button" onClick={() => updStep(si, pi, 'needsClientApproval', !step.needsClientApproval)} className="px-2.5 py-1.5 rounded-lg text-[11.5px] font-bold border-2 transition" style={{ borderColor: step.needsClientApproval ? '#7C3AED' : '#e2e8f0', background: step.needsClientApproval ? '#F5F3FF' : '#fff', color: step.needsClientApproval ? '#7C3AED' : '#94a3b8' }}>{step.needsClientApproval ? '✓ ' : ''}Client approval</button>
                  <button type="button" onClick={() => updStep(si, pi, 'isRecurringMonthly', !step.isRecurringMonthly)} className="px-2.5 py-1.5 rounded-lg text-[11.5px] font-bold border-2 transition" style={{ borderColor: step.isRecurringMonthly ? '#EA580C' : '#e2e8f0', background: step.isRecurringMonthly ? '#FFF7ED' : '#fff', color: step.isRecurringMonthly ? '#EA580C' : '#94a3b8' }}>{step.isRecurringMonthly ? '✓ ' : ''}Monthly</button>
                  <button type="button" onClick={() => updStep(si, pi, 'isOptional', !step.isOptional)} className="px-2.5 py-1.5 rounded-lg text-[11.5px] font-bold border-2 transition" style={{ borderColor: step.isOptional ? '#B45309' : '#e2e8f0', background: step.isOptional ? '#FEF3C7' : '#fff', color: step.isOptional ? '#B45309' : '#94a3b8' }}>{step.isOptional ? '✓ ' : ''}Optional</button>
                </div>
              </div>
            ))}
            <button onClick={() => addStep(si)} className="w-full text-[12.5px] font-bold text-slate-400 hover:text-orange-600 border border-dashed border-slate-200 rounded-xl py-2 transition">+ Add step</button>
          </div>
        </div>
      ))}
      <button onClick={addStage} className="text-[13px] font-bold text-slate-500 hover:text-orange-600 border-2 border-dashed border-slate-300 rounded-2xl px-4 py-3 w-full mb-4 transition">+ Add stage</button>

      <div className="flex justify-between items-center sticky bottom-0 bg-slate-50/80 backdrop-blur py-2 -mx-1 px-1 rounded-lg">
        <button onClick={del} className="text-[13px] font-bold text-red-500">{t.id ? '🗑 Delete template' : ''}</button>
        <div className="flex gap-2"><button onClick={onBack} className="px-4 py-2.5 rounded-xl text-[13px] font-bold text-slate-500 bg-slate-100">Cancel</button><button onClick={save} disabled={busy} className="px-6 py-2.5 rounded-xl text-[13px] font-extrabold text-white" style={{ background: ORANGE, opacity: busy ? 0.6 : 1 }}>{t.id ? 'Save Changes' : 'Create Template'}</button></div>
      </div>
    </div>
  );
}

function PlansAdmin() {
  const [plans, setPlans] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const load = () => hrApi('/projects/plans').then((r) => setPlans(r.plans || [])).catch(() => setPlans([]));
  useEffect(() => { load(); }, []);
  const del = async (p) => { if (await confirmDialog({ title: 'Delete plan?', danger: true })) { await hrApi(`/projects/plans/${p.id}`, { method: 'DELETE' }); load(); } };
  if (!plans) return <div className="text-slate-400 text-sm py-6">Loading…</div>;
  return (
    <div>
      <div className="flex items-center justify-between mb-3"><div className="text-[13px] text-slate-400">Preset plans fill campaign numbers when creating a project (or enter custom).</div><button onClick={() => setShowAdd(true)} className="text-white font-bold px-3.5 py-2 rounded-lg text-[13px]" style={{ background: ORANGE }}>+ New Plan</button></div>
      <div className="grid md:grid-cols-2 gap-3">
        {plans.map((p) => {
          const svcList = (p.params && p.params.services) || [p.service];
          const SVC_LBL = { seo: 'SEO', local_seo: 'Local SEO', ai_seo: 'AI SEO', smo: 'SMO', social_media: 'Social' };
          return (
            <div key={p.id} className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-1"><div className="font-extrabold text-[#050A1F]">{p.name}</div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setEditing(p)} title="Edit" className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-orange-600">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                  </button>
                  <button onClick={() => del(p)} title="Delete" className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:bg-red-50 hover:text-red-600">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                  </button>
                </div>
              </div>
              <div className="flex gap-1.5 flex-wrap mb-2">{svcList.map((s) => <span key={s} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">{SVC_LBL[s] || s}</span>)}{p.params && p.params.callsPerMonth ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{p.params.callsPerMonth} calls/mo</span> : null}</div>
              <div className="flex flex-wrap gap-1.5">
                {svcList.map((s) => { const sp = (p.params && p.params[s]) || {}; return Object.entries(sp).filter(([k, v]) => v !== '' && v != null && !Array.isArray(v)).map(([k, v]) => <span key={s + k} className="text-[11px] bg-slate-100 rounded px-2 py-0.5 text-slate-600">{k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}: <b>{String(v)}</b></span>); })}
                {svcList.map((s) => { const sp = (p.params && p.params[s]) || {}; return (sp.platforms && sp.platforms.length) ? <span key={s + 'pf'} className="text-[11px] bg-pink-50 rounded px-2 py-0.5 text-pink-600">{sp.platforms.join(', ')}</span> : null; })}
              </div>
            </div>
          );
        })}
        {plans.length === 0 && <div className="text-slate-400 text-sm py-6">No plans yet.</div>}
      </div>
      {showAdd && <PlanModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />}
      {editing && <PlanModal plan={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

// Module-level plan field helpers (defined OUTSIDE components so inputs keep
// focus across re-renders — a component defined inside another remounts on every
// keystroke and steals focus).
function PNumField({ label, value, onChange, ring = 'orange' }) {
  return (
    <div>
      <div className="text-[12px] font-semibold text-slate-600 mb-1">{label}</div>
      <input value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))} placeholder="0" className={`w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[15px] font-bold text-[#050A1F] text-center focus:outline-none focus:ring-2 focus:ring-${ring}-200 focus:border-${ring}-300`} />
    </div>
  );
}
function PSeg({ value, opts, unit, accent, onChange }) {
  return (
    <div className="inline-flex bg-slate-100 rounded-xl p-0.5">
      {opts.map((o) => { const on = String(value) === String(o); return <button key={o} type="button" onClick={() => onChange(String(o))} className={`px-3.5 py-1.5 rounded-[10px] text-[12.5px] font-bold transition ${on ? 'bg-white shadow-sm' : 'text-slate-400'}`} style={on ? { color: accent } : {}}>{o}{unit || ''}</button>; })}
    </div>
  );
}
function PRow({ label, children }) { return <div className="flex items-center justify-between py-1.5"><span className="text-[12.5px] font-semibold text-slate-500">{label}</span>{children}</div>; }

function PlanModal({ plan, onClose, onSaved }) {
  const PLAN_SERVICES = [
    { id: 'seo', label: 'SEO', icon: '🔍', desc: 'Keywords, backlinks & content', color: '#2563EB', bg: '#EFF6FF', bd: '#BFDBFE' },
    { id: 'local_seo', label: 'Local SEO', icon: '📍', desc: 'Google Business posts', color: '#0D9488', bg: '#F0FDFA', bd: '#99F6E4' },
    { id: 'ai_seo', label: 'AI SEO', icon: '🤖', desc: 'AI-driven optimization', color: '#7C3AED', bg: '#F5F3FF', bd: '#DDD6FE' },
    { id: 'smo', label: 'SMO', icon: '📱', desc: 'Social media management', color: '#DB2777', bg: '#FDF2F8', bd: '#FBCFE8' },
  ];
  const SMO_PLATFORMS = [['Facebook', '📘'], ['Instagram', '📷'], ['LinkedIn', '💼'], ['YouTube', '▶️'], ['TikTok', '🎵'], ['Reddit', '👽'], ['Pinterest', '📌']];
  const pp = (plan && plan.params) || {};
  const [f, setF] = useState({
    name: (plan && plan.name) || '', services: pp.services || [], callsPerMonth: pp.callsPerMonth || '',
    seo: { keywords: '', backlinksPerMonth: '', articlesPerMonth: '', blogsPerMonth: '', rankReportDays: '10', analyticsReportDays: '30', ...(pp.seo || {}) },
    local_seo: { postsPerMonth: '', ...(pp.local_seo || {}) },
    ai_seo: { reportDays: '15', ...(pp.ai_seo || {}) },
    smo: { platformCount: '3', platforms: [], postsPerMonth: '', reportDays: '15', ...(pp.smo || {}) },
  });
  const [busy, setBusy] = useState(false);
  const has = (s) => f.services.includes(s);
  const toggle = (s) => setF((st) => ({ ...st, services: st.services.includes(s) ? st.services.filter((x) => x !== s) : [...st.services, s] }));
  const setSvc = (svc, k, v) => setF((s) => ({ ...s, [svc]: { ...s[svc], [k]: v } }));
  const save = async () => {
    if (!f.name.trim()) { toast('Please give the plan a name'); return; }
    if (!f.services.length) { toast('Select at least one service'); return; }
    setBusy(true);
    const params = { services: f.services, callsPerMonth: f.callsPerMonth };
    for (const s of f.services) params[s] = f[s];
    try {
      if (plan && plan.id) await hrApi(`/projects/plans/${plan.id}`, { method: 'PUT', body: JSON.stringify({ service: f.services[0], name: f.name, params }) });
      else await hrApi('/projects/plans', { method: 'POST', body: JSON.stringify({ service: f.services[0], name: f.name, params }) });
      toast(plan && plan.id ? 'Plan updated ✓' : 'Plan saved 🎉'); onSaved();
    } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const numField = (svc, k, label) => <PNumField label={label} value={f[svc][k]} onChange={(v) => setSvc(svc, k, v)} />;
  const seg = (svc, k, opts, unit, accent) => <PSeg value={f[svc][k]} opts={opts} unit={unit} accent={accent} onChange={(v) => setSvc(svc, k, v)} />;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[210] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5" style={{ background: 'linear-gradient(135deg,#0A0E28,#1e293b)' }}>
          <div className="text-white text-[17px] font-extrabold">{plan && plan.id ? 'Edit Service Plan' : 'Create a Service Plan'}</div>
          <div className="text-slate-400 text-[12px] mt-0.5">Presets that auto-fill campaign numbers when creating a project</div>
        </div>
        <div className="p-6 max-h-[600px] overflow-auto">
          <div className="mb-5">
            <div className="text-[12px] font-bold text-slate-500 mb-1.5">PLAN NAME</div>
            <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Basic, Standard, Premium" className="w-full border border-slate-200 rounded-xl px-4 py-3 text-[15px] font-semibold focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-300" />
          </div>

          <div className="text-[12px] font-bold text-slate-500 mb-2">SELECT SERVICES</div>
          <div className="grid grid-cols-2 gap-2.5 mb-5">
            {PLAN_SERVICES.map((s) => { const on = has(s.id); return (
              <button key={s.id} type="button" onClick={() => toggle(s.id)} className="flex items-center gap-3 rounded-xl border-2 p-3 text-left transition" style={{ borderColor: on ? s.color : '#e2e8f0', background: on ? s.bg : '#fff' }}>
                <span className="w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0" style={{ background: on ? '#fff' : '#f8fafc' }}>{s.icon}</span>
                <div className="flex-1 min-w-0"><div className="text-[13.5px] font-extrabold text-[#050A1F]">{s.label}</div><div className="text-[11px] text-slate-400 truncate">{s.desc}</div></div>
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] shrink-0" style={{ background: on ? s.color : '#e2e8f0', color: '#fff' }}>{on ? '✓' : ''}</span>
              </button>
            ); })}
          </div>

          {f.services.length === 0 && <div className="text-center text-[13px] text-slate-400 py-6 border border-dashed border-slate-200 rounded-xl mb-5">Select one or more services above to configure their plan details.</div>}

          {has('seo') && (
            <div className="rounded-xl border p-4 mb-3" style={{ borderColor: '#BFDBFE' }}>
              <div className="flex items-center gap-2 mb-3"><span className="text-base">🔍</span><span className="text-[13.5px] font-extrabold text-[#050A1F]">SEO</span></div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                {numField('seo','keywords','Keywords')}{numField('seo','backlinksPerMonth','Backlinks/mo')}{numField('seo','articlesPerMonth','Articles/mo')}{numField('seo','blogsPerMonth','Blogs/mo')}
              </div>
              <div className="border-t border-slate-100 pt-2">
                <PRow label="Rank Report">{seg('seo','rankReportDays',[10, 15],' days','#2563EB')}</PRow>
                <PRow label="Analytics Report">{seg('seo','analyticsReportDays',[30],' days','#2563EB')}</PRow>
              </div>
            </div>
          )}

          {has('local_seo') && (
            <div className="rounded-xl border p-4 mb-3" style={{ borderColor: '#99F6E4' }}>
              <div className="flex items-center gap-2 mb-3"><span className="text-base">📍</span><span className="text-[13.5px] font-extrabold text-[#050A1F]">Local SEO</span></div>
              <div className="w-40">{numField('local_seo','postsPerMonth','Posts / month')}</div>
            </div>
          )}

          {has('ai_seo') && (
            <div className="rounded-xl border p-4 mb-3" style={{ borderColor: '#DDD6FE' }}>
              <div className="flex items-center gap-2 mb-3"><span className="text-base">🤖</span><span className="text-[13.5px] font-extrabold text-[#050A1F]">AI SEO</span></div>
              <PRow label="Reporting">{seg('ai_seo','reportDays',[15, 30],' days','#7C3AED')}</PRow>
            </div>
          )}

          {has('smo') && (() => {
            const limit = Number(f.smo.platformCount) || 0;
            const chosen = f.smo.platforms.length;
            const setCount = (n) => setF((s) => ({ ...s, smo: { ...s.smo, platformCount: String(n), platforms: s.smo.platforms.slice(0, Number(n)) } }));
            const togglePlat = (pl) => {
              const on = f.smo.platforms.includes(pl);
              if (on) return setSvc('smo', 'platforms', f.smo.platforms.filter((x) => x !== pl));
              if (chosen >= limit) { toast(`This plan allows ${limit} platform${limit > 1 ? 's' : ''}. Deselect one first, or increase the count.`); return; }
              setSvc('smo', 'platforms', [...f.smo.platforms, pl]);
            };
            return (
              <div className="rounded-xl border p-4 mb-3" style={{ borderColor: '#FBCFE8' }}>
                <div className="flex items-center gap-2 mb-3"><span className="text-base">📱</span><span className="text-[13.5px] font-extrabold text-[#050A1F]">SMO</span></div>
                <PRow label="Number of Platforms"><div className="inline-flex bg-slate-100 rounded-xl p-0.5">{[1, 3, 5].map((o) => { const on = String(f.smo.platformCount) === String(o); return <button key={o} type="button" onClick={() => setCount(o)} className={`px-3.5 py-1.5 rounded-[10px] text-[12.5px] font-bold transition ${on ? 'bg-white shadow-sm' : 'text-slate-400'}`} style={on ? { color: '#DB2777' } : {}}>{o}</button>; })}</div></PRow>
                <div className="py-1.5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[12.5px] font-semibold text-slate-500">Select Platforms</span>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: chosen === limit ? '#F0FDF4' : '#FDF2F8', color: chosen === limit ? '#16a34a' : '#DB2777' }}>{chosen} / {limit} selected</span>
                  </div>
                  <div className="flex gap-2 flex-wrap">{SMO_PLATFORMS.map(([pl, ic]) => { const on = f.smo.platforms.includes(pl); const disabled = !on && chosen >= limit; return <button key={pl} type="button" onClick={() => togglePlat(pl)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12.5px] font-semibold border-2 transition" style={{ borderColor: on ? '#DB2777' : '#e2e8f0', background: on ? '#FDF2F8' : '#fff', color: on ? '#DB2777' : (disabled ? '#cbd5e1' : '#64748b'), opacity: disabled ? 0.55 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}><span>{ic}</span>{pl}{on && ' ✓'}</button>; })}</div>
                </div>
                <div className="w-44 py-1.5"><div className="text-[12.5px] font-semibold text-slate-500 mb-1">Posts / month</div><input value={f.smo.postsPerMonth} onChange={(e) => setSvc('smo', 'postsPerMonth', e.target.value.replace(/[^0-9]/g, ''))} placeholder="0" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[15px] font-bold text-[#050A1F] text-center focus:outline-none focus:ring-2 focus:ring-pink-200 focus:border-pink-300" /></div>
                <div className="border-t border-slate-100 pt-2"><PRow label="Reporting">{seg('smo','reportDays',[15, 30],' days','#DB2777')}</PRow></div>
              </div>
            );
          })()}

          {f.services.length > 0 && (
            <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 mt-1">
              <span className="text-[12.5px] font-semibold text-slate-500">📞 Calls / month</span>
              <input value={f.callsPerMonth} onChange={(e) => setF({ ...f, callsPerMonth: e.target.value.replace(/[^0-9]/g, '') })} placeholder="0" className="w-20 border border-slate-200 rounded-xl px-3 py-2 text-[15px] font-bold text-[#050A1F] text-center focus:outline-none focus:ring-2 focus:ring-orange-200" />
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
          <div className="text-[12px] text-slate-400">{f.services.length ? `${f.services.length} service${f.services.length > 1 ? 's' : ''} selected` : ''}</div>
          <div className="flex gap-2"><button onClick={onClose} className="px-4 py-2.5 rounded-xl text-[13px] font-bold text-slate-500 bg-slate-100">Cancel</button><button onClick={save} disabled={busy} className="px-6 py-2.5 rounded-xl text-[13px] font-extrabold text-white" style={{ background: ORANGE, opacity: busy ? 0.6 : 1 }}>Save Plan</button></div>
        </div>
      </div>
    </div>
  );
}

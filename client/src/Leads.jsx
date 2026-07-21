import React, { useState, useEffect } from 'react';
import { api } from './App.jsx';
import { API_BASE } from './config.js';
import { COUNTRY_NAMES } from './countries.js';

// Filterable country picker — type to filter, click to select.
export function CountryCombobox({ value, onChange, className }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const matches = (q ? COUNTRY_NAMES.filter((c) => c.toLowerCase().includes(q.toLowerCase())) : COUNTRY_NAMES).slice(0, 60);
  return (
    <div className="relative">
      <input
        className={className}
        value={open ? q : (value || '')}
        placeholder="Type to search countries…"
        onFocus={() => { setOpen(true); setQ(''); }}
        onChange={(e) => setQ(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-56 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {matches.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">No match</div>}
          {matches.map((c) => (
            <button key={c} type="button" onMouseDown={() => { onChange(c); setOpen(false); }}
              className={`block w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 ${value === c ? 'font-bold text-[#FF4500]' : 'text-slate-700'}`}>{c}</button>
          ))}
        </div>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Leads CRM — Phase 1: list (role-filtered by the API), single-lead create
// form, and the lead detail page shell (30/70 split with Basic Info, Tags,
// Description, Other Info, Last Modified on the left). Tabs on the right are
// scaffolded here and filled in Phase 2/3.
// ---------------------------------------------------------------------------

const fmtDate = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const fullName = (l) => `${l.firstName || ''} ${l.lastName || ''}`.trim() || '(no name)';

function statusMeta(config, id) {
  const s = (config.leadStatuses || []).find((x) => x.id === id);
  return s || { id, label: id, color: '#64748B' };
}

// ---- Lead list -------------------------------------------------------------
export function LeadsList({ user, onOpen, onNew }) {
  const [items, setItems] = useState([]);
  const [config, setConfig] = useState({ leadStatuses: [], leadSources: [] });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (statusFilter) params.set('status', statusFilter);
      const [res, cfg] = await Promise.all([
        api(`/leads${params.toString() ? '?' + params.toString() : ''}`),
        api('/leads/config'),
      ]);
      setItems(res.items || []);
      setConfig(cfg.config || {});
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold text-[#050A1F]">Leads</h1>
          <div className="text-sm text-slate-400">{items.length} total{user.role !== 'admin' ? ' · your visibility' : ''}</div>
        </div>
        <div className="flex items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()}
            placeholder="Search name, email, website…"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm w-60 focus:outline-none focus:ring-2 focus:ring-orange-400" />
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); }}
            className="rounded-lg border border-slate-300 px-2.5 py-2 text-sm">
            <option value="">All statuses</option>
            {(config.leadStatuses || []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <button onClick={load} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-600">Filter</button>
          <button onClick={onNew} className="rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>+ New lead</button>
        </div>
      </div>

      {loading ? (
        <div className="text-slate-400 text-sm py-12 text-center">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-slate-400 text-sm py-12 text-center bg-white rounded-2xl border border-slate-100">No leads yet. Click “New lead” to add one.</div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400 font-bold">
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Website</th>
                <th className="text-left px-4 py-3">Source</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Owner</th>
                <th className="text-left px-4 py-3">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {items.map((l) => {
                const sm = statusMeta(config, l.status);
                return (
                  <tr key={l._id} onClick={() => onOpen(l)} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer">
                    <td className="px-4 py-3 font-bold text-[#050A1F]">{fullName(l)}</td>
                    <td className="px-4 py-3 text-slate-500">{l.website || '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{l.leadSource || '—'}</td>
                    <td className="px-4 py-3"><span className="rounded-full px-2.5 py-0.5 text-[10px] font-bold text-white" style={{ background: sm.color }}>{sm.label}</span></td>
                    <td className="px-4 py-3 text-slate-500">{l.ownerName}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{fmtDate(l.lastActivityAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- New lead form ---------------------------------------------------------
export function NewLead({ user, onCreated, onCancel }) {
  const [config, setConfig] = useState({});
  const [owners, setOwners] = useState([]);
  const [f, setF] = useState({
    ownerId: user.id, firstName: '', lastName: '', website: '', email: '', secondaryEmail: '',
    mobile: '', phone: '', leadSource: '', generatedBy: '', status: 'new',
    servicesInterested: [], tags: [], country: '', city: '', timezone: '', additionalInfo: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/leads/config').then((r) => { setConfig(r.config || {}); setOwners(r.owners || []); }).catch(() => {});
  }, []);

  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const toggleArr = (k, v) => setF((s) => ({ ...s, [k]: s[k].includes(v) ? s[k].filter((x) => x !== v) : [...s[k], v] }));

  const submit = async () => {
    if (!f.firstName.trim()) { setError('First name is required.'); return; }
    setBusy(true); setError('');
    try {
      const lead = await api('/leads', { method: 'POST', body: JSON.stringify(f) });
      onCreated(lead);
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const canAssign = user.role === 'admin' || user.role === 'manager';
  const inp = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400';
  const lab = 'block text-[11px] font-bold text-slate-500 mb-1';

  return (
    <div className="max-w-3xl">
      <button onClick={onCancel} className="text-xs font-bold text-slate-400 hover:text-slate-600 mb-3">← Back to leads</button>
      <h1 className="text-2xl font-extrabold text-[#050A1F] mb-6">New lead</h1>
      {error && <div className="mb-4 rounded-lg bg-red-50 text-red-600 text-sm px-4 py-2">{error}</div>}

      <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-5">
        {canAssign && (
          <div>
            <label className={lab}>Lead owner</label>
            <select className={inp} value={f.ownerId} onChange={(e) => set('ownerId', Number(e.target.value))}>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.name}{o.role !== 'agent' ? ` (${o.role})` : ''}</option>)}
            </select>
          </div>
        )}

        <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wide border-b border-slate-100 pb-1">Contact information</div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className={lab}>First name *</label><input className={inp} value={f.firstName} onChange={(e) => set('firstName', e.target.value)} /></div>
          <div><label className={lab}>Last name</label><input className={inp} value={f.lastName} onChange={(e) => set('lastName', e.target.value)} /></div>
          <div><label className={lab}>Website</label><input className={inp} value={f.website} onChange={(e) => set('website', e.target.value)} placeholder="https://…" /></div>
          <div><label className={lab}>Email</label><input className={inp} value={f.email} onChange={(e) => set('email', e.target.value)} /></div>
          <div><label className={lab}>Secondary email</label><input className={inp} value={f.secondaryEmail} onChange={(e) => set('secondaryEmail', e.target.value)} /></div>
          <div><label className={lab}>Mobile</label><input className={inp} value={f.mobile} onChange={(e) => set('mobile', e.target.value)} /></div>
          <div><label className={lab}>Phone</label><input className={inp} value={f.phone} onChange={(e) => set('phone', e.target.value)} /></div>
        </div>

        <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wide border-b border-slate-100 pb-1">Classification</div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={lab}>Lead source</label>
            <select className={inp} value={f.leadSource} onChange={(e) => set('leadSource', e.target.value)}>
              <option value="">— Select —</option>
              {(config.leadSources || []).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className={lab}>Generated by</label>
            <select className={inp} value={f.generatedBy} onChange={(e) => set('generatedBy', e.target.value)}>
              <option value="">— Select —</option>
              {owners.map((o) => <option key={o.id} value={o.name}>{o.name}</option>)}
            </select>
          </div>
          <div>
            <label className={lab}>Lead status</label>
            <select className={inp} value={f.status} onChange={(e) => set('status', e.target.value)}>
              {(config.leadStatuses || []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className={lab}>Services interested in</label>
          <div className="flex flex-wrap gap-1.5">
            {(config.servicesInterested || []).map((s) => (
              <button key={s} type="button" onClick={() => toggleArr('servicesInterested', s)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-bold border ${f.servicesInterested.includes(s) ? 'bg-[#2563EB] text-white border-transparent' : 'text-slate-500 border-slate-200 hover:border-slate-400'}`}>{s}</button>
            ))}
          </div>
        </div>

        <div>
          <label className={lab}>Tags</label>
          <div className="flex flex-wrap gap-1.5">
            {(config.tags || []).map((t) => (
              <button key={t} type="button" onClick={() => toggleArr('tags', t)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-bold border ${f.tags.includes(t) ? 'bg-[#FF6A00] text-white border-transparent' : 'text-slate-500 border-slate-200 hover:border-slate-400'}`}>{t}</button>
            ))}
          </div>
        </div>

        <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wide border-b border-slate-100 pb-1">Location</div>
        <div className="grid grid-cols-3 gap-4">
          <div><label className={lab}>Country</label><CountryCombobox className={inp} value={f.country} onChange={(v) => set('country', v)} /></div>
          <div><label className={lab}>City</label><input className={inp} value={f.city} onChange={(e) => set('city', e.target.value)} /></div>
          <div><label className={lab}>Time zone</label><input className={inp} value={f.timezone} onChange={(e) => set('timezone', e.target.value)} placeholder="e.g. GMT+5:30" /></div>
        </div>

        <div>
          <label className={lab}>Additional information</label>
          <textarea rows={3} className={inp} value={f.additionalInfo} onChange={(e) => set('additionalInfo', e.target.value)} />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={submit} disabled={busy} className="rounded-lg px-6 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>{busy ? 'Saving…' : 'Create lead'}</button>
        </div>
      </div>
    </div>
  );
}

// ---- Lead detail (shell; tabs filled in later phases) ----------------------
export function LeadDetail({ user, leadId, onBack }) {
  const [lead, setLead] = useState(null);
  const [config, setConfig] = useState({});
  const [tab, setTab] = useState('timeline');
  const [editSection, setEditSection] = useState(null); // 'all' | 'basic' | 'tags' | 'description' | 'other'
  const [draft, setDraft] = useState(null);
  const [quickModal, setQuickModal] = useState(null); // 'note' | 'task' | 'call' | 'deal'

  const load = async () => {
    try {
      const [res, cfg] = await Promise.all([api(`/leads/${leadId}`), api('/leads/config')]);
      setLead(res.lead); setConfig(cfg.config || {});
    } catch (e) { console.error(e); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [leadId]);

  if (!lead) return <div className="text-slate-400 text-sm py-12 text-center">Loading…</div>;

  const sm = statusMeta(config, lead.status);
  const openEdit = (section) => { setDraft({ ...lead }); setEditSection(section); };
  const saveEdit = async () => {
    try {
      const updated = await api(`/leads/${leadId}`, { method: 'PATCH', body: JSON.stringify(draft) });
      setLead(updated); setEditSection(null);
    } catch (e) { alert(e.message); }
  };

  const Icon = ({ children }) => <span className="inline-block w-4 text-slate-400 mr-2">{children}</span>;
  const SectionHead = ({ title, section }) => (
    <div className="flex items-center justify-between mb-3">
      <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">{title}</div>
      <button onClick={() => openEdit(section)} title={`Edit ${title}`} className="text-slate-300 hover:text-[#FF4500] text-xs">✏️</button>
    </div>
  );

  return (
    <div>
      <button onClick={onBack} className="text-xs font-bold text-slate-400 hover:text-slate-600 mb-3">← Back to leads</button>

      {/* Header: name + tags inline, owner/last-activity, quick actions */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-extrabold text-[#050A1F]">{fullName(lead)}</h1>
            <span className="rounded-full px-3 py-1 text-[11px] font-bold text-white" style={{ background: sm.color }}>{sm.label}</span>
            {(lead.tags || []).map((t) => <span key={t} className="rounded-full bg-orange-50 text-[#FF4500] px-2.5 py-0.5 text-[11px] font-bold">{t}</span>)}
          </div>
          <div className="text-sm text-slate-400 mt-1.5">
            Owner: <span className="font-semibold text-slate-600">{lead.ownerName}</span>
            <span className="mx-2">·</span>Last activity {fmtDate(lead.lastActivityAt)}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setQuickModal('note')} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:border-slate-400">📝 Add note</button>
          <button onClick={() => setQuickModal('task')} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:border-slate-400">✅ Add task</button>
          <button onClick={() => setQuickModal('call')} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:border-slate-400">📞 Add call</button>
          <button onClick={() => setQuickModal('deal')} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:border-slate-400">💰 Add deal</button>
          <button onClick={() => openEdit('all')} className="rounded-md px-3 py-1.5 text-xs font-bold text-white" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>✏️ Edit lead</button>
        </div>
      </div>

      <div className="grid gap-6" style={{ gridTemplateColumns: '30% 1fr' }}>
        {/* LEFT 30% — each section independently editable */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <SectionHead title="Basic info" section="basic" />
            <div className="space-y-2 text-sm text-slate-700">
              <div><Icon>✉️</Icon>{lead.email || <span className="text-slate-300">—</span>}</div>
              <div><Icon>📱</Icon>{lead.mobile || <span className="text-slate-300">—</span>}</div>
              <div><Icon>☎️</Icon>{lead.phone || <span className="text-slate-300">—</span>}</div>
              <div><Icon>📍</Icon>{[lead.city, lead.country].filter(Boolean).join(', ') || <span className="text-slate-300">—</span>}</div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <SectionHead title="Tags" section="tags" />
            <div className="flex flex-wrap gap-1.5">
              {(lead.tags || []).length ? lead.tags.map((t) => <span key={t} className="rounded-full bg-orange-50 text-[#FF4500] px-2.5 py-0.5 text-[11px] font-bold">{t}</span>) : <span className="text-slate-300 text-sm">No tags</span>}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <SectionHead title="Description" section="description" />
            <div className="text-sm text-slate-600 whitespace-pre-wrap">{lead.additionalInfo || <span className="text-slate-300">No description</span>}</div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <SectionHead title="Other info" section="other" />
            <div className="space-y-2 text-sm">
              <Row k="Website" v={lead.website} />
              <Row k="Secondary email" v={lead.secondaryEmail} />
              <Row k="Generated by" v={lead.generatedBy} />
              <Row k="Lead status" v={sm.label} />
              <Row k="Service interested in" v={(lead.servicesInterested || []).join(', ')} />
            </div>
          </div>

          <div className="text-[11px] text-slate-400 px-1">Last modified {fmtDate(lead.updatedAt)}</div>
        </div>

        {/* RIGHT 70% */}
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          <div className="flex border-b border-slate-100">
            {['timeline', 'notes', 'activity', 'deals', 'reports'].map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-5 py-3 text-xs font-bold capitalize transition ${tab === t ? 'text-[#FF4500] border-b-2 border-[#FF4500]' : 'text-slate-400 hover:text-slate-600'}`}>{t}</button>
            ))}
          </div>
          <div className="p-5 min-h-[300px]">
            {tab === 'timeline' && <Timeline lead={lead} />}
            {tab === 'notes' && <NotesTab lead={lead} onChange={setLead} />}
            {tab === 'activity' && <ActivityTab lead={lead} config={config} user={user} onChange={setLead} />}
            {tab === 'deals' && <DealsTab lead={lead} config={config} onChange={setLead} />}
            {tab === 'reports' && <ReportsTab lead={lead} onChange={setLead} />}
          </div>
        </div>
      </div>

      {/* Section / full edit modal */}
      {editSection && draft && (
        <EditLeadModal user={user} config={config} draft={draft} setDraft={setDraft} section={editSection} onSave={saveEdit} onClose={() => setEditSection(null)} />
      )}

      {/* Quick-action modals */}
      {quickModal === 'note' && <QuickNoteModal lead={lead} onClose={() => setQuickModal(null)} onSaved={(u) => { setLead(u); setQuickModal(null); setTab('notes'); }} />}
      {(quickModal === 'task' || quickModal === 'call') && <ActivityModal kind={quickModal} lead={lead} config={config} onClose={() => setQuickModal(null)} onSaved={(u) => { setLead(u); setQuickModal(null); setTab('activity'); }} />}
      {quickModal === 'deal' && <DealModal lead={lead} config={config} onClose={() => setQuickModal(null)} onSaved={(u) => { setLead(u); setQuickModal(null); setTab('deals'); }} />}
    </div>
  );
}

function QuickNoteModal({ lead, onClose, onSaved }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try { const u = await api(`/leads/${lead._id}/notes`, { method: 'POST', body: JSON.stringify({ text }) }); onSaved(u); }
    catch (e) { alert(e.message); } setBusy(false);
  };
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-[#050A1F] mb-4">📝 Add note</h3>
        <textarea rows={4} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a note…"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={save} disabled={busy || !text.trim()} className="rounded-lg px-6 py-2 text-sm font-bold text-white disabled:opacity-40" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>{busy ? 'Saving…' : 'Save note'}</button>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-400">{k}</span>
      <span className="text-slate-700 font-medium text-right">{v || <span className="text-slate-300">—</span>}</span>
    </div>
  );
}

function Timeline({ lead }) {
  const tl = Array.isArray(lead.timeline) ? [...lead.timeline].reverse() : [];
  if (!tl.length) return <div className="text-slate-300 text-sm py-16 text-center">No activity yet.</div>;
  const icons = { created: '✨', status: '🏷️', owner: '👤', note: '📝', task: '✅', call: '📞', deal: '💰', report: '📄' };
  return (
    <div className="space-y-3">
      {tl.map((e, i) => (
        <div key={i} className="flex gap-3">
          <div className="text-lg leading-none mt-0.5">{icons[e.type] || '•'}</div>
          <div>
            <div className="text-sm text-slate-700">{e.text}</div>
            <div className="text-[11px] text-slate-400">{e.author || '—'} · {fmtDate(e.time)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Notes tab -------------------------------------------------------------
function NotesTab({ lead, onChange }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const notes = Array.isArray(lead.notes) ? [...lead.notes].reverse() : [];
  const add = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const updated = await api(`/leads/${lead._id}/notes`, { method: 'POST', body: JSON.stringify({ text }) });
      onChange(updated); setText('');
    } catch (e) { alert(e.message); }
    setBusy(false);
  };
  return (
    <div>
      <div className="flex gap-2 mb-4">
        <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note…"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
        <button onClick={add} disabled={busy || !text.trim()} className="rounded-lg px-4 py-2 text-sm font-bold text-white self-start disabled:opacity-40" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>Add</button>
      </div>
      {notes.length === 0 ? <div className="text-slate-300 text-sm py-12 text-center">No notes yet.</div> : (
        <div className="space-y-2">
          {notes.map((n) => (
            <div key={n.id} className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
              <div className="text-sm text-slate-700 whitespace-pre-wrap">{n.text}</div>
              <div className="text-[10px] text-slate-400 mt-1">{n.author} · {fmtDate(n.time)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Activity tab (tasks + calls) -----------------------------------------
function ActivityTab({ lead, config, user, onChange }) {
  const [modal, setModal] = useState(null); // 'task' | 'call' | null
  const acts = Array.isArray(lead.activities) ? [...lead.activities] : [];
  // Sort: open first (by due/scheduled date asc), then done.
  const dueVal = (a) => a.kind === 'task' ? a.dueDate : (a.date ? `${a.date}T${a.time || '00:00'}` : '');
  const open = acts.filter((a) => a.status !== 'done').sort((x, y) => (dueVal(x) || '').localeCompare(dueVal(y) || ''));
  const done = acts.filter((a) => a.status === 'done');

  const toggle = async (act) => {
    try {
      const updated = await api(`/leads/${lead._id}/activities/${act.id}`, { method: 'PATCH', body: JSON.stringify({ status: act.status === 'done' ? 'open' : 'done' }) });
      onChange(updated);
    } catch (e) { alert(e.message); }
  };

  const overdue = (a) => {
    const d = dueVal(a);
    return a.status !== 'done' && d && new Date(d) < new Date();
  };
  const dueToday = (a) => {
    const d = dueVal(a);
    if (!d || a.status === 'done') return false;
    const dd = new Date(d), now = new Date();
    return dd.toDateString() === now.toDateString();
  };

  const Card = ({ a }) => (
    <div className={`rounded-lg border px-3 py-2.5 flex items-start gap-3 ${overdue(a) ? 'border-red-200 bg-red-50' : dueToday(a) ? 'border-amber-200 bg-amber-50' : 'border-slate-100 bg-white'}`}>
      <button onClick={() => toggle(a)} title={a.status === 'done' ? 'Reopen' : 'Mark done'}
        className={`mt-0.5 h-4 w-4 rounded border shrink-0 ${a.status === 'done' ? 'bg-green-500 border-green-500 text-white' : 'border-slate-300'}`}>
        {a.status === 'done' ? '✓' : ''}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm">{a.kind === 'call' ? '📞' : '✅'}</span>
          <span className={`text-sm font-semibold ${a.status === 'done' ? 'line-through text-slate-400' : 'text-slate-700'}`}>{a.title}</span>
          {a.kind === 'task' && a.priority && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${a.priority === 'Urgent' ? 'bg-red-100 text-red-600' : a.priority === 'High' ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-500'}`}>{a.priority}</span>}
          {overdue(a) && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-600">OVERDUE</span>}
          {dueToday(a) && !overdue(a) && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">TODAY</span>}
        </div>
        {a.kind === 'task' && a.description && <div className="text-xs text-slate-500 mt-1">{a.description}</div>}
        <div className="text-[10px] text-slate-400 mt-1">
          {a.kind === 'call'
            ? <>{a.mode === 'done' ? 'Logged' : 'Scheduled'}{a.date ? ` · ${a.date}${a.time ? ' ' + a.time : ''}` : ''}{a.timezone ? ` (${a.timezone})` : ''}{a.durationMin ? ` · ${a.durationMin} min` : ''}{a.reminder && a.reminder.on ? ' · 🔔 reminder' : ''}</>
            : <>{a.dueDate ? `Due ${a.dueDate}` : 'No due date'}</>}
          <span className="ml-1">· {a.createdBy}</span>
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <button onClick={() => setModal('task')} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-slate-400">✅ Add task</button>
        <button onClick={() => setModal('call')} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-slate-400">📞 Add call</button>
      </div>

      {acts.length === 0 ? <div className="text-slate-300 text-sm py-12 text-center">No tasks or calls yet.</div> : (
        <div className="space-y-4">
          {open.length > 0 && <div className="space-y-2">{open.map((a) => <Card key={a.id} a={a} />)}</div>}
          {done.length > 0 && <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2 mt-4">Completed</div>
            <div className="space-y-2">{done.map((a) => <Card key={a.id} a={a} />)}</div>
          </div>}
        </div>
      )}

      {modal && <ActivityModal kind={modal} lead={lead} config={config} onClose={() => setModal(null)} onSaved={(u) => { onChange(u); setModal(null); }} />}
    </div>
  );
}

function ActivityModal({ kind, lead, config, onClose, onSaved }) {
  const isCall = kind === 'call';
  const [f, setF] = useState({
    mode: 'scheduled', agenda: '', title: '', date: '', time: '', timezone: '',
    description: '', priority: 'Medium', dueDate: '', reminderOn: false, durationMin: '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const inp = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400';
  const lab = 'block text-[11px] font-bold text-slate-500 mb-1';

  const save = async () => {
    setBusy(true);
    try {
      const body = isCall
        ? { kind: 'call', mode: f.mode, agenda: f.agenda, date: f.date, time: f.time, timezone: f.timezone, durationMin: f.mode === 'done' ? Number(f.durationMin) || 0 : undefined, reminder: { on: f.mode === 'scheduled' && f.reminderOn, at: `${f.date}T${f.time || '09:00'}` } }
        : { kind: 'task', mode: f.mode, title: f.title, dueDate: f.dueDate, description: f.description, priority: f.priority };
      const updated = await api(`/leads/${lead._id}/activities`, { method: 'POST', body: JSON.stringify(body) });
      onSaved(updated);
    } catch (e) { alert(e.message); }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-[#050A1F] mb-4">{isCall ? '📞 Add call' : '✅ Add task'}</h3>

        <div className="flex gap-2 mb-4">
          {['scheduled', 'done'].map((m) => (
            <button key={m} onClick={() => set('mode', m)} className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-bold border capitalize ${f.mode === m ? 'bg-[#050A1F] text-white border-transparent' : 'text-slate-500 border-slate-200'}`}>{m}</button>
          ))}
        </div>

        {isCall ? (
          <div className="space-y-3">
            <div><label className={lab}>Call agenda</label><input className={inp} value={f.agenda} onChange={(e) => set('agenda', e.target.value)} placeholder="What's the call about?" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lab}>Date</label><input type="date" className={inp} value={f.date} onChange={(e) => set('date', e.target.value)} /></div>
              <div><label className={lab}>Time</label><input type="time" className={inp} value={f.time} onChange={(e) => set('time', e.target.value)} /></div>
            </div>
            <div><label className={lab}>Time zone</label><input className={inp} value={f.timezone} onChange={(e) => set('timezone', e.target.value)} placeholder="e.g. GMT+5:30" /></div>
            {f.mode === 'done' && (
              <div><label className={lab}>How long did the call last? (minutes)</label><input type="number" min="0" className={inp} value={f.durationMin} onChange={(e) => set('durationMin', e.target.value)} placeholder="e.g. 15" /></div>
            )}
            {f.mode === 'scheduled' && (
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={f.reminderOn} onChange={(e) => set('reminderOn', e.target.checked)} /> 🔔 Remind me (in-app)
              </label>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div><label className={lab}>Task name</label><input className={inp} value={f.title} onChange={(e) => set('title', e.target.value)} /></div>
            <div><label className={lab}>Due date</label><input type="date" className={inp} value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} /></div>
            <div><label className={lab}>Description</label><textarea rows={2} className={inp} value={f.description} onChange={(e) => set('description', e.target.value)} /></div>
            <div>
              <label className={lab}>Priority</label>
              <select className={inp} value={f.priority} onChange={(e) => set('priority', e.target.value)}>
                {(config.taskPriorities || ['Low', 'Medium', 'High', 'Urgent']).map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg px-6 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

function EditLeadModal({ user, config, draft, setDraft, section = 'all', onSave, onClose }) {
  const set = (k, v) => setDraft((s) => ({ ...s, [k]: v }));
  const toggleArr = (k, v) => setDraft((s) => ({ ...s, [k]: (s[k] || []).includes(v) ? s[k].filter((x) => x !== v) : [...(s[k] || []), v] }));
  const inp = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400';
  const lab = 'block text-[11px] font-bold text-slate-500 mb-1';
  const show = (s) => section === 'all' || section === s;
  const titles = { all: 'Edit lead', basic: 'Edit basic info', tags: 'Edit tags', description: 'Edit description', other: 'Edit other info' };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-2xl max-h-[88vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-[#050A1F] mb-4">{titles[section] || 'Edit lead'}</h3>

        {show('basic') && (
          <div className="grid grid-cols-2 gap-4 mb-4">
            {section === 'all' && <div><label className={lab}>First name</label><input className={inp} value={draft.firstName || ''} onChange={(e) => set('firstName', e.target.value)} /></div>}
            {section === 'all' && <div><label className={lab}>Last name</label><input className={inp} value={draft.lastName || ''} onChange={(e) => set('lastName', e.target.value)} /></div>}
            <div><label className={lab}>Email</label><input className={inp} value={draft.email || ''} onChange={(e) => set('email', e.target.value)} /></div>
            <div><label className={lab}>Mobile</label><input className={inp} value={draft.mobile || ''} onChange={(e) => set('mobile', e.target.value)} /></div>
            <div><label className={lab}>Phone</label><input className={inp} value={draft.phone || ''} onChange={(e) => set('phone', e.target.value)} /></div>
            <div><label className={lab}>Country</label><input className={inp} value={draft.country || ''} onChange={(e) => set('country', e.target.value)} /></div>
            <div><label className={lab}>City</label><input className={inp} value={draft.city || ''} onChange={(e) => set('city', e.target.value)} /></div>
            <div><label className={lab}>Time zone</label><input className={inp} value={draft.timezone || ''} onChange={(e) => set('timezone', e.target.value)} /></div>
          </div>
        )}

        {show('tags') && (
          <div className="mb-4">
            <label className={lab}>Tags</label>
            <div className="flex flex-wrap gap-1.5">
              {(config.tags || []).map((t) => (
                <button key={t} type="button" onClick={() => toggleArr('tags', t)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-bold border ${(draft.tags || []).includes(t) ? 'bg-[#FF6A00] text-white border-transparent' : 'text-slate-500 border-slate-200'}`}>{t}</button>
              ))}
            </div>
          </div>
        )}

        {show('description') && (
          <div className="mb-4">
            <label className={lab}>Description</label>
            <textarea rows={4} className={inp} value={draft.additionalInfo || ''} onChange={(e) => set('additionalInfo', e.target.value)} />
          </div>
        )}

        {show('other') && (
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div><label className={lab}>Website</label><input className={inp} value={draft.website || ''} onChange={(e) => set('website', e.target.value)} /></div>
            <div><label className={lab}>Secondary email</label><input className={inp} value={draft.secondaryEmail || ''} onChange={(e) => set('secondaryEmail', e.target.value)} /></div>
            <div>
              <label className={lab}>Generated by</label>
              <input className={inp} value={draft.generatedBy || ''} onChange={(e) => set('generatedBy', e.target.value)} />
            </div>
            <div>
              <label className={lab}>Lead source</label>
              <select className={inp} value={draft.leadSource || ''} onChange={(e) => set('leadSource', e.target.value)}>
                <option value="">— Select —</option>
                {(config.leadSources || []).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={lab}>Lead status</label>
              <select className={inp} value={draft.status || 'new'} onChange={(e) => set('status', e.target.value)}>
                {(config.leadStatuses || []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className={lab}>Services interested in</label>
              <div className="flex flex-wrap gap-1.5">
                {(config.servicesInterested || []).map((s) => (
                  <button key={s} type="button" onClick={() => toggleArr('servicesInterested', s)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold border ${(draft.servicesInterested || []).includes(s) ? 'bg-[#2563EB] text-white border-transparent' : 'text-slate-500 border-slate-200'}`}>{s}</button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={onSave} className="rounded-lg bg-[#050A1F] px-6 py-2 text-sm font-bold text-white">Save changes</button>
        </div>
      </div>
    </div>
  );
}

// ---- Deals tab -------------------------------------------------------------
function DealsTab({ lead, config, onChange }) {
  const [modal, setModal] = useState(null); // null | 'new' | deal object
  const deals = Array.isArray(lead.deals) ? lead.deals : [];
  const stageMeta = (id) => (config.dealStages || []).find((s) => s.id === id) || { id, label: id, color: '#64748B' };
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div className="text-sm text-slate-500">{deals.length} deal{deals.length === 1 ? '' : 's'}</div>
        <button onClick={() => setModal('new')} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>💰 Add deal</button>
      </div>
      {deals.length === 0 ? <div className="text-slate-300 text-sm py-12 text-center">No deals yet.</div> : (
        <div className="space-y-2">
          {deals.map((d) => {
            const sm = stageMeta(d.stage);
            return (
              <div key={d.id} onClick={() => setModal(d)} className="rounded-lg border border-slate-100 hover:border-slate-300 px-4 py-3 cursor-pointer">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-sm text-[#050A1F]">{d.name}</div>
                  <div className="font-extrabold text-sm text-[#050A1F]">{d.currency} {Number(d.amount).toLocaleString()}</div>
                </div>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className="rounded-full px-2.5 py-0.5 text-[10px] font-bold text-white" style={{ background: sm.color }}>{sm.label}</span>
                  {d.service && <span className="text-[11px] text-slate-500">{d.service}</span>}
                  {d.expectedClose && <span className="text-[11px] text-slate-400">· close {d.expectedClose}</span>}
                </div>
                {d.remark && <div className="text-xs text-slate-500 mt-1.5">{d.remark}</div>}
              </div>
            );
          })}
        </div>
      )}
      {modal && <DealModal lead={lead} config={config} deal={modal === 'new' ? null : modal} onClose={() => setModal(null)} onSaved={(u) => { onChange(u); setModal(null); }} />}
    </div>
  );
}

function DealModal({ lead, config, deal, onClose, onSaved }) {
  const [f, setF] = useState(deal || { name: '', stage: (config.dealStages && config.dealStages[0] && config.dealStages[0].id) || 'qualification', currency: (config.dealCurrencies && config.dealCurrencies[0]) || 'USD', amount: '', expectedClose: '', service: '', remark: '' });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const inp = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400';
  const lab = 'block text-[11px] font-bold text-slate-500 mb-1';
  const save = async () => {
    if (!f.name.trim()) { alert('Deal name is required.'); return; }
    setBusy(true);
    try {
      const u = deal
        ? await api(`/leads/${lead._id}/deals/${deal.id}`, { method: 'PATCH', body: JSON.stringify(f) })
        : await api(`/leads/${lead._id}/deals`, { method: 'POST', body: JSON.stringify(f) });
      onSaved(u);
    } catch (e) { alert(e.message); }
    setBusy(false);
  };
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-md max-h-[88vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-[#050A1F] mb-4">{deal ? 'Edit deal' : '💰 Add deal'}</h3>
        <div className="space-y-3">
          <div><label className={lab}>Deal name</label><input className={inp} value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
          <div>
            <label className={lab}>Interested service</label>
            <select className={inp} value={f.service} onChange={(e) => set('service', e.target.value)}>
              <option value="">— Select —</option>
              {(config.servicesInterested || []).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className={lab}>Stage</label>
            <select className={inp} value={f.stage} onChange={(e) => set('stage', e.target.value)}>
              {(config.dealStages || []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lab}>Currency</label>
              <select className={inp} value={f.currency} onChange={(e) => set('currency', e.target.value)}>
                {(config.dealCurrencies || ['USD']).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div><label className={lab}>Amount</label><input type="number" className={inp} value={f.amount} onChange={(e) => set('amount', e.target.value)} /></div>
          </div>
          <div><label className={lab}>Expected closing date</label><input type="date" className={inp} value={f.expectedClose} onChange={(e) => set('expectedClose', e.target.value)} /></div>
          <div><label className={lab}>Remark</label><textarea rows={2} className={inp} value={f.remark} onChange={(e) => set('remark', e.target.value)} /></div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg px-6 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>{busy ? 'Saving…' : 'Save deal'}</button>
        </div>
      </div>
    </div>
  );
}

// ---- Reports tab -----------------------------------------------------------
function ReportsTab({ lead, onChange }) {
  const [reports, setReports] = useState(null);
  useEffect(() => {
    api(`/leads/${lead._id}`).then((r) => setReports(r.reports || [])).catch(() => setReports([]));
  }, [lead._id]);
  const openReport = (r) => window.open(`${API_BASE}/api/reports/${r._id}/view?token=${localStorage.getItem('qtx_token')}`, '_blank');
  const download = (r) => window.open(`${API_BASE}/api/reports/${r._id}/download?token=${localStorage.getItem('qtx_token')}`, '_blank');
  if (reports === null) return <div className="text-slate-400 text-sm py-12 text-center">Loading…</div>;
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div className="text-sm text-slate-500">{reports.length} report{reports.length === 1 ? '' : 's'} linked</div>
        <a href={`/?leadRun=${lead._id}`} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>▶ Run report</a>
      </div>
      {reports.length === 0 ? (
        <div className="text-slate-300 text-sm py-12 text-center">No reports linked to this lead yet.<br />Use “Run report” to generate one for this lead.</div>
      ) : (
        <div className="space-y-2">
          {reports.map((r) => (
            <div key={r._id} className="rounded-lg border border-slate-100 px-4 py-3 flex items-center justify-between">
              <div>
                <div className="font-bold text-sm text-[#050A1F]">{r.businessName || r.domain}</div>
                <div className="text-[11px] text-slate-400">{r.status} · {fmtDate(r.createdAt)} · score {r.scores && r.scores.overall != null ? r.scores.overall : '—'}</div>
              </div>
              {r.status === 'complete' && (
                <div className="flex gap-2">
                  <button onClick={() => openReport(r)} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-bold text-slate-600">👁️ View</button>
                  <button onClick={() => download(r)} className="rounded-md px-2.5 py-1 text-xs font-bold text-white" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>⬇️ PDF</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Top-level Leads view controller — switches between list / new / detail.
export default function Leads({ user }) {
  const [view, setView] = useState('list'); // list | new | detail
  const [activeId, setActiveId] = useState(null);
  return (
    <div>
      {view === 'list' && <LeadsList user={user} onOpen={(l) => { setActiveId(l._id); setView('detail'); }} onNew={() => setView('new')} />}
      {view === 'new' && <NewLead user={user} onCreated={(l) => { setActiveId(l._id); setView('detail'); }} onCancel={() => setView('list')} />}
      {view === 'detail' && activeId && <LeadDetail user={user} leadId={activeId} onBack={() => setView('list')} />}
    </div>
  );
}

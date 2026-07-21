import React, { useState, useEffect } from 'react';
import { API_BASE } from './config.js';

/**
 * Qtonix Site Analysis — admin panel.
 * Tabs: Pricing · Branding · API keys · Users · Limits, plus a persisted
 * Activity log. Matches the sandbox design; wired to the live API.
 */

// ---- brand palette (mirrors the sandbox C object) ----
const C = { navy: '#050A1F', orange: '#FF6A00', orangeDeep: '#FF4500', blue: '#2563EB' };

const api = async (path, opts = {}) => {
  const token = localStorage.getItem('qtx_token');
  const res = await fetch(API_BASE + '/api' + path, {
    ...opts,
    headers: {
      ...(opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
};

// ---- UI atoms (mirror the sandbox) ----
const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent';
const input = inputCls;
const Btn = ({ children, onClick, variant = 'primary', disabled, className = '', size = 'md', title }) => {
  const sz = size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-5 py-2.5 text-sm';
  const base = `rounded-lg font-bold transition disabled:opacity-40 ${sz} ${className}`;
  if (variant === 'primary') return <button title={title} onClick={onClick} disabled={disabled} className={base + ' text-white'} style={{ background: `linear-gradient(90deg,${C.orange},${C.orangeDeep})` }}>{children}</button>;
  if (variant === 'dark') return <button title={title} onClick={onClick} disabled={disabled} className={base + ' text-white'} style={{ background: C.navy }}>{children}</button>;
  return <button title={title} onClick={onClick} disabled={disabled} className={base + ' border border-slate-300 text-slate-600 hover:border-slate-400 bg-white'}>{children}</button>;
};
const Field = ({ label, hint, children }) => (
  <div><label className="block text-xs font-semibold text-slate-600 mb-1.5">{label}</label>{children}{hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}</div>
);
const Note = ({ tone = 'info', children }) => {
  const t = { info: 'bg-blue-50 border-blue-200 text-blue-800', warn: 'bg-amber-50 border-amber-200 text-amber-900', bad: 'bg-red-50 border-red-200 text-red-700', good: 'bg-green-50 border-green-200 text-green-700' }[tone];
  return <div className={`rounded-lg border px-4 py-3 text-sm ${t}`}>{children}</div>;
};
const dt = (d) => new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const DEFAULT_PRICING = {
  enabled: true, currency: 'USD', symbol: '$',
  intro: 'Three ways to work together — all month-to-month, no lock-in.',
  note: 'About paid backlinks. Some high-authority backlinks carry a direct placement cost paid to the publisher.',
  guaranteeTitle: 'The risk is ours, not yours.',
  guaranteeBody: "If we don't increase your targeted traffic and enquiries within 90 days, we refund every dollar you've paid.",
  packages: [
    { name: 'STARTER', price: '399', period: '/mo', oldPrice: '', recommended: false, badge: '', blurb: 'Getting started on a budget.', features: ['Keyword & competitor research', '2 SEO blogs / month', 'Monthly report'], starFeatures: [] },
    { name: 'GROWTH', price: '549', period: '/mo', oldPrice: '799', recommended: true, badge: 'RECOMMENDED', blurb: 'Best value — builds the pages that capture high-intent searches.', features: ['Everything in Starter, plus:', '3–4 SEO blogs / month', '2 landing pages / month'], starFeatures: ['90-day money-back guarantee'] },
    { name: 'PREMIUM', price: '1,199', period: '/mo', oldPrice: '', recommended: false, badge: '', blurb: 'Maximum speed — includes link cleanup.', features: ['Everything in Growth, plus:', '8+ SEO blogs / month', 'Backlink audit & disavow'], starFeatures: ['90-day money-back guarantee'] },
  ],
};

// ---------------------------------------------------------------------------
// Pricing editor
// ---------------------------------------------------------------------------
function PricingEditor({ settings, setSettings, say }) {
  const p = settings.pricing || DEFAULT_PRICING;
  const upd = (patch) => setSettings({ ...settings, pricing: { ...p, ...patch } });
  const updPkg = (i, patch) => { const pk = [...p.packages]; pk[i] = { ...pk[i], ...patch }; upd({ packages: pk }); };
  const setRec = (i) => upd({ packages: p.packages.map((x, j) => ({ ...x, recommended: j === i, badge: j === i ? (x.badge || 'RECOMMENDED') : '' })) });
  const addPkg = () => { upd({ packages: [...p.packages, { name: 'NEW PLAN', price: '0', period: '/mo', oldPrice: '', recommended: false, badge: '', blurb: '', features: ['Feature one'], starFeatures: [] }] }); say && say('Package added', 'good'); };
  const delPkg = (i) => { if (p.packages.length <= 1) return say && say('Keep at least one package.', 'bad'); upd({ packages: p.packages.filter((_, j) => j !== i) }); say && say('Package deleted', 'warn'); };
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= p.packages.length) return; const pk = [...p.packages]; [pk[i], pk[j]] = [pk[j], pk[i]]; upd({ packages: pk }); };
  const editLine = (i, k, idx, v) => { const a = [...(p.packages[i][k] || [])]; a[idx] = v; updPkg(i, { [k]: a }); };
  const addLine = (i, k) => updPkg(i, { [k]: [...(p.packages[i][k] || []), k === 'starFeatures' ? 'New guarantee' : 'New feature'] });
  const delLine = (i, k, idx) => updPkg(i, { [k]: p.packages[i][k].filter((_, j) => j !== idx) });

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-sm" style={{ color: C.navy }}>Pricing page</h3>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            <input type="checkbox" checked={p.enabled} onChange={(e) => upd({ enabled: e.target.checked })} className="w-4 h-4 accent-orange-500" />Include in reports
          </label>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Currency code"><input className={inputCls} value={p.currency || ''} onChange={(e) => upd({ currency: e.target.value })} /></Field>
          <Field label="Symbol" hint="₹, $, £, €"><input className={inputCls} value={p.symbol || ''} onChange={(e) => upd({ symbol: e.target.value })} /></Field>
        </div>
        <div className="mt-4"><Field label="Intro line"><textarea rows={2} className={inputCls} value={p.intro || ''} onChange={(e) => upd({ intro: e.target.value })} /></Field></div>
      </div>
      {(p.packages || []).map((pk, i) => (
        <div key={i} className="bg-white rounded-xl p-5" style={{ border: pk.recommended ? `2px solid ${C.blue}` : '1px solid #E2E8F0' }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <input className="font-extrabold text-sm tracking-wider border-0 border-b border-dashed border-slate-300 focus:outline-none focus:border-orange-400 py-0.5" style={{ color: C.navy, width: 150 }} value={pk.name} onChange={(e) => updPkg(i, { name: e.target.value })} />
              {pk.recommended && <span className="rounded-full px-2 py-0.5 text-[9px] font-extrabold" style={{ background: C.orange, color: C.navy }}>{pk.badge || 'RECOMMENDED'}</span>}
            </div>
            <div className="flex gap-1.5">
              <Btn size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0}>↑</Btn>
              <Btn size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === p.packages.length - 1}>↓</Btn>
              {!pk.recommended && <Btn size="sm" variant="ghost" onClick={() => setRec(i)}>Make recommended</Btn>}
              <Btn size="sm" variant="ghost" onClick={() => delPkg(i)}>Delete</Btn>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <Field label="Price"><input className={inputCls} value={pk.price} onChange={(e) => updPkg(i, { price: e.target.value })} /></Field>
            <Field label="Period"><input className={inputCls} value={pk.period} onChange={(e) => updPkg(i, { period: e.target.value })} /></Field>
            <Field label="Was (strikethrough)" hint="Blank = hidden"><input className={inputCls} value={pk.oldPrice} onChange={(e) => updPkg(i, { oldPrice: e.target.value })} /></Field>
            <Field label="Badge text"><input className={inputCls} value={pk.badge} onChange={(e) => updPkg(i, { badge: e.target.value })} disabled={!pk.recommended} /></Field>
          </div>
          <div className="mt-3"><Field label="Blurb"><textarea rows={2} className={inputCls} value={pk.blurb} onChange={(e) => updPkg(i, { blurb: e.target.value })} /></Field></div>
          <div className="grid grid-cols-2 gap-4 mt-4">
            {[['features', 'Features (✓)'], ['starFeatures', 'Star features (★)']].map(([k, lbl]) => (
              <div key={k}>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-xs font-semibold text-slate-600">{lbl}</label>
                  <button onClick={() => addLine(i, k)} className="text-[11px] font-bold" style={{ color: C.blue }}>+ Add</button>
                </div>
                {(pk[k] || []).map((f, j) => (
                  <div key={j} className="flex gap-1.5 mb-1.5">
                    <input className={inputCls + ' text-xs'} value={f} onChange={(e) => editLine(i, k, j, e.target.value)} />
                    <button onClick={() => delLine(i, k, j)} className="text-slate-300 hover:text-red-500 px-1 text-lg leading-none">×</button>
                  </div>
                ))}
                {!(pk[k] || []).length && <p className="text-[11px] text-slate-400">None.</p>}
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="flex gap-2">
        <Btn variant="ghost" onClick={addPkg}>+ Add package</Btn>
        <Btn variant="ghost" onClick={() => { upd(JSON.parse(JSON.stringify(DEFAULT_PRICING))); say && say('Pricing reset to defaults', 'warn'); }}>Reset to defaults</Btn>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <h3 className="font-bold text-sm" style={{ color: C.navy }}>Guarantee &amp; notes</h3>
        <Field label="Guarantee title" hint="Blank hides the whole band"><input className={inputCls} value={p.guaranteeTitle || ''} onChange={(e) => upd({ guaranteeTitle: e.target.value })} /></Field>
        <Field label="Guarantee body"><textarea rows={2} className={inputCls} value={p.guaranteeBody || ''} onChange={(e) => upd({ guaranteeBody: e.target.value })} /></Field>
        <Field label="Note box"><textarea rows={3} className={inputCls} value={p.note || ''} onChange={(e) => upd({ note: e.target.value })} /></Field>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Branding (logo + favicon upload + colours)
// ---------------------------------------------------------------------------
function Branding({ settings, setSettings, say, reload }) {
  const upload = async (file, kind, maxKb) => {
    if (!file) return;
    if (file.size > maxKb * 1024) return say && say(`That file is ${Math.round(file.size / 1024)}KB — the limit is ${maxKb}KB.`, 'bad');
    const fd = new FormData();
    fd.append(kind, file);
    try {
      const r = await api(`/admin/settings/${kind}`, { method: 'POST', body: fd });
      setSettings({ ...settings, [`${kind}Path`]: r[`${kind}Path`] });
      say && say(`${kind} uploaded`, 'good');
      reload && reload();
    } catch (e) { say && say(e.message, 'bad'); }
  };
  const src = (path) => (path && path.startsWith('/') ? API_BASE + path : path);

  return (
    <div className="max-w-2xl space-y-5">

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="font-bold text-sm mb-4" style={{ color: C.navy }}>Logo</h3>
        <div className="flex items-center gap-5 p-4 rounded-lg" style={{ background: C.navy }}>
          <div className="w-36 h-14 rounded flex items-center justify-center bg-white/5 shrink-0">
            {settings.logoPath ? <img src={src(settings.logoPath)} alt="Logo" style={{ maxHeight: 40, maxWidth: 130, objectFit: 'contain' }} /> : <span className="text-lg font-extrabold text-white">Qtonix<span style={{ color: C.orange }}>.</span></span>}
          </div>
          <div>
            <label className="inline-block rounded-md bg-white/10 px-3 py-1.5 text-xs font-bold text-white cursor-pointer hover:bg-white/20">
              {settings.logoPath ? 'Replace logo' : 'Upload logo'}
              <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden" onChange={(e) => upload(e.target.files[0], 'logo', 3072)} />
            </label>
            <p className="text-[10px] text-slate-400 mt-1.5">PNG, JPG, SVG or WEBP · max 3MB · a light/transparent logo works best on navy</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="font-bold text-sm mb-4" style={{ color: C.navy }}>Favicon</h3>
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 rounded border border-slate-200 flex items-center justify-center bg-slate-50 shrink-0">
            {settings.faviconPath ? <img src={src(settings.faviconPath)} alt="Favicon" style={{ maxHeight: 32, maxWidth: 32, objectFit: 'contain' }} /> : <span className="text-[9px] text-slate-400">None</span>}
          </div>
          <div>
            <label className="inline-block rounded-md border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 cursor-pointer hover:border-slate-400">
              {settings.faviconPath ? 'Replace favicon' : 'Upload favicon'}
              <input type="file" accept="image/png,image/x-icon,image/svg+xml" className="hidden" onChange={(e) => upload(e.target.files[0], 'favicon', 512)} />
            </label>
            <p className="text-[10px] text-slate-400 mt-1.5">ICO, PNG or SVG · 32×32 or 64×64 · max 512KB</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="font-bold text-sm mb-4" style={{ color: C.navy }}>Report colours</h3>
        <div className="grid grid-cols-4 gap-3">
          {[['navy', 'Navy'], ['orange', 'Orange'], ['orangeDeep', 'Orange deep'], ['blue', 'Blue']].map(([k, l]) => (
            <div key={k}>
              <div className="flex gap-2">
                <input type="color" value={(settings.colors || {})[k] || '#000000'} onChange={(e) => setSettings({ ...settings, colors: { ...settings.colors, [k]: e.target.value } })} className="h-9 w-9 rounded border border-slate-300 cursor-pointer" />
                <input className={inputCls + ' font-mono text-xs'} value={(settings.colors || {})[k] || ''} onChange={(e) => setSettings({ ...settings, colors: { ...settings.colors, [k]: e.target.value } })} />
              </div>
              <p className="text-[10px] text-slate-400 mt-1">{l}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 grid grid-cols-2 gap-4">
        <Field label="Company name"><input className={inputCls} value={settings.companyName || ''} onChange={(e) => setSettings({ ...settings, companyName: e.target.value })} /></Field>
        <Field label="Short name" hint="Used in the report footer"><input className={inputCls} value={settings.companyShort || ''} onChange={(e) => setSettings({ ...settings, companyShort: e.target.value })} /></Field>
        <Field label="Website"><input className={inputCls} value={settings.website || ''} onChange={(e) => setSettings({ ...settings, website: e.target.value })} /></Field>
        <Field label="Phone"><input className={inputCls} value={settings.phone || ''} onChange={(e) => setSettings({ ...settings, phone: e.target.value })} /></Field>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------
function ApiKeys({ settings, setSettings, say }) {
  const [tests, setTests] = useState({});
  const RULES = {
    seranking: { label: 'SE Ranking', required: true, hint: 'Rankings, backlinks, competitors, AI Overview data' },
    anthropic: { label: 'Claude (Anthropic)', required: true, hint: 'AI visibility test, cover tagline, executive summary' },
    pagespeed: { label: 'Google PageSpeed', required: false, hint: 'Free, 25k/day. Real-visitor Core Web Vitals' },
    googlePlaces: { label: 'Google Places', required: false, hint: 'Local SEO section — GBP reviews, ratings, NAP' },
  };
  const isSet = (id) => settings.apiKeys && settings.apiKeys[id] && !String(settings.apiKeys[id]).startsWith('••');
  const hasMask = (id) => settings.apiKeys && String(settings.apiKeys[id] || '').startsWith('••');

  const test = async (id) => {
    const key = (settings.apiKeys[id] || '').trim();
    setTests((t) => ({ ...t, [id]: { testing: true } }));
    try {
      const r = await api('/admin/settings/test-key', { method: 'POST', body: JSON.stringify({ service: id === 'pagespeed' ? 'pagespeed' : id, key: hasMask(id) ? '' : key }) });
      setTests((t) => ({ ...t, [id]: { ok: true, msg: r.detail || 'Key is valid.' } }));
      say && say(`${RULES[id].label}: valid`, 'good');
    } catch (e) {
      setTests((t) => ({ ...t, [id]: { ok: false, msg: e.message } }));
      say && say(`${RULES[id].label}: ${e.message}`, 'bad');
    }
  };

  return (
    <div className="max-w-2xl space-y-4">
      {Object.entries(RULES).map(([id, r]) => {
        const t = tests[id];
        return (
          <div key={id} className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <label className="text-xs font-semibold text-slate-600">{r.label}</label>
              {isSet(id) || hasMask(id)
                ? <span className="rounded bg-green-50 text-green-600 px-1.5 py-0.5 text-[8px] font-bold">CONFIGURED</span>
                : r.required && <span className="rounded bg-red-50 text-red-600 px-1.5 py-0.5 text-[8px] font-bold">REQUIRED</span>}
            </div>
            <div className="flex gap-2">
              <input type="password" className={inputCls} value={settings.apiKeys[id] || ''} placeholder="Paste key…" onChange={(e) => { setSettings({ ...settings, apiKeys: { ...settings.apiKeys, [id]: e.target.value } }); setTests((x) => ({ ...x, [id]: null })); }} />
              <Btn size="sm" variant="ghost" onClick={() => test(id)} disabled={t && t.testing}>{t && t.testing ? 'Testing…' : 'Test'}</Btn>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">{r.hint}</p>
            {t && !t.testing && <div className={`mt-2 text-[11px] font-medium ${t.ok ? 'text-green-600' : 'text-red-600'}`}>{t.ok ? '✓ ' : '✗ '}{t.msg}</div>}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Users — with team / shift / aliases
// ---------------------------------------------------------------------------
const TEAMS = ['Bhubaneswar', 'Kolkata'];
const SHIFTS = ['Morning', 'Night'];

// Job type + reporting manager + targets — shared by create and edit forms.
// `state` is the form object (f or edit); `patch` applies a partial update.
function TargetsAndReporting({ state, patch, managers }) {
  const role = state.role;
  const t = state.targets || { transfer: { enabled: false, daily: 0, monthly: 0 }, sales: { enabled: false, monthly: 0 }, team: { enabled: false, monthly: 0 } };
  const setT = (next) => patch({ targets: { ...t, ...next } });
  const numCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';

  if (role === 'admin') return null;

  return (
    <div className="col-span-2 rounded-lg bg-slate-50 border border-slate-100 p-4 space-y-4">
      {role === 'agent' && (
        <div className="grid grid-cols-2 gap-4">
          <Field label="Job type">
            <select className={inputCls} value={state.jobType || 'bde'} onChange={(e) => patch({ jobType: e.target.value })}>
              <option value="bde">Business Development Executive</option>
              <option value="presales">Pre-Sales Executive</option>
            </select>
          </Field>
          <Field label="Reports to (manager)">
            <select className={inputCls} value={state.managerId || ''} onChange={(e) => patch({ managerId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">— Select manager —</option>
              {managers.map((m) => <option key={m.id || m._id} value={m.id || m._id}>{m.name}</option>)}
            </select>
          </Field>
        </div>
      )}

      {/* Manager team target */}
      {role === 'manager' && (
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={!!t.team.enabled} onChange={(e) => setT({ team: { ...t.team, enabled: e.target.checked } })} />
          <span className="font-bold text-slate-700">Monthly team sales target (USD)</span>
          {t.team.enabled && <input type="number" min="0" className="w-40 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" value={t.team.monthly || ''} onChange={(e) => setT({ team: { ...t.team, monthly: Number(e.target.value) || 0 } })} />}
        </label>
      )}

      {/* Agent targets: Transfer and/or Sales */}
      {role === 'agent' && (
        <div className="space-y-3">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Targets (all in USD)</div>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
              <input type="checkbox" checked={!!t.transfer.enabled} onChange={(e) => setT({ transfer: { ...t.transfer, enabled: e.target.checked } })} /> Transfer
            </label>
            <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
              <input type="checkbox" checked={!!t.sales.enabled} onChange={(e) => setT({ sales: { ...t.sales, enabled: e.target.checked } })} /> Sales
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {t.transfer.enabled && (
              <Field label="Daily transfers">
                <input type="number" min="0" className={numCls} value={t.transfer.daily || ''} onChange={(e) => setT({ transfer: { ...t.transfer, daily: Number(e.target.value) || 0 } })} placeholder="e.g. 3" />
              </Field>
            )}
            {t.transfer.enabled && (
              <Field label="Monthly transfers">
                <input type="number" min="0" className={numCls} value={t.transfer.monthly || ''} onChange={(e) => setT({ transfer: { ...t.transfer, monthly: Number(e.target.value) || 0 } })} />
              </Field>
            )}
            {t.sales.enabled && (
              <Field label="Monthly sales (USD)">
                <input type="number" min="0" className={numCls} value={t.sales.monthly || ''} onChange={(e) => setT({ sales: { ...t.sales, monthly: Number(e.target.value) || 0 } })} />
              </Field>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Org chart: Branch(Team) → Shift → Manager → Agents. Drag an agent card onto
// a manager to reassign them (inherits that manager's team+shift).
function OrgChart({ users, onReassign }) {
  const [dragUser, setDragUser] = useState(null);
  const managers = users.filter((u) => u.role === 'manager' && u.active !== false);
  const admins = users.filter((u) => u.role === 'admin');
  const agents = users.filter((u) => u.role === 'agent' && u.active !== false);
  const teams = Array.from(new Set(managers.map((m) => m.team))).sort();
  const shifts = ['Morning', 'Night'];
  const agentsFor = (mgr) => agents.filter((a) => (a.managerId === (mgr.id || mgr._id)));
  const unassigned = agents.filter((a) => !a.managerId || !managers.some((m) => (m.id || m._id) === a.managerId));

  const jobBadge = (a) => a.jobType === 'presales'
    ? <span className="text-[8px] font-bold bg-purple-100 text-purple-600 px-1 rounded">PRE-SALES</span>
    : <span className="text-[8px] font-bold bg-blue-100 text-blue-600 px-1 rounded">BDE</span>;

  const AgentCard = ({ a }) => (
    <div draggable onDragStart={() => setDragUser(a)} onDragEnd={() => setDragUser(null)}
      className="bg-white rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs cursor-grab active:cursor-grabbing flex items-center justify-between gap-2">
      <span className="font-semibold text-slate-700 truncate">{a.name}</span>
      {jobBadge(a)}
    </div>
  );

  return (
    <div className="bg-slate-50 rounded-2xl border border-slate-100 p-5">
      <p className="text-xs text-slate-400 mb-4">Drag an agent card onto a manager to move them. They inherit that manager's branch and shift.</p>

      {/* Admin tier */}
      <div className="flex justify-center mb-2">
        <div className="rounded-lg bg-[#050A1F] text-white px-4 py-1.5 text-xs font-bold">
          {admins.map((a) => a.name).join(', ') || 'Admin'} · Admin
        </div>
      </div>
      <div className="h-4 w-px bg-slate-300 mx-auto mb-2" />

      <div className="space-y-6">
        {teams.map((team) => (
          <div key={team} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-sm font-extrabold text-[#050A1F] mb-3">🏢 {team}</div>
            <div className="grid grid-cols-2 gap-4">
              {shifts.map((shift) => {
                const shiftMgrs = managers.filter((m) => m.team === team && m.shift === shift);
                return (
                  <div key={shift} className="rounded-lg bg-slate-50 border border-slate-100 p-3">
                    <div className="text-[11px] font-bold text-slate-400 uppercase mb-2">{shift === 'Morning' ? '🌅' : '🌙'} {shift} shift</div>
                    {shiftMgrs.length === 0 && <div className="text-[11px] text-slate-300 italic">No manager assigned</div>}
                    <div className="space-y-3">
                      {shiftMgrs.map((mgr) => (
                        <div key={mgr.id || mgr._id}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => { if (dragUser) { onReassign(dragUser.id || dragUser._id, mgr); setDragUser(null); } }}
                          className="rounded-lg border-2 border-dashed border-slate-200 p-2">
                          <div className="rounded-md bg-[#2563EB] text-white px-2.5 py-1 text-xs font-bold mb-2">{mgr.name} · Manager</div>
                          <div className="space-y-1.5 pl-2">
                            {agentsFor(mgr).map((a) => <AgentCard key={a.id || a._id} a={a} />)}
                            {agentsFor(mgr).length === 0 && <div className="text-[10px] text-slate-300 italic px-1">Drop agents here</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {unassigned.length > 0 && (
        <div className="mt-6 rounded-xl border-2 border-dashed border-amber-200 bg-amber-50 p-4">
          <div className="text-xs font-bold text-amber-700 mb-2">⚠️ Unassigned agents (drag onto a manager)</div>
          <div className="grid grid-cols-3 gap-2">
            {unassigned.map((a) => <AgentCard key={a.id || a._id} a={a} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function Users({ me, say }) {
  const blank = { name: '', email: '', password: '', role: 'agent', jobType: 'bde', managerId: null, phone: '', designation: 'Sales Executive', team: 'Bhubaneswar', shift: 'Morning', aliases: '', targets: { transfer: { enabled: false, daily: 0, monthly: 0 }, sales: { enabled: false, monthly: 0 }, team: { enabled: false, monthly: 0 } } };
  const [users, setUsers] = useState([]);
  const [f, setF] = useState(blank);
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(null);
  const [uview, setUview] = useState('list');

  // Reassign an agent to a manager (and inherit that manager's team+shift so
  // the org chart and lead visibility stay consistent). Used by drag-and-drop.
  const reassign = async (userId, manager) => {
    try {
      await api(`/admin/users/${userId}`, { method: 'PUT', body: JSON.stringify({ managerId: manager.id || manager._id, team: manager.team, shift: manager.shift }) });
      load();
    } catch (e) { setErr(e.message); }
  };

  const managers = users.filter((u) => u.role === 'manager' && u.active !== false);

  const load = () => api('/admin/users').then(setUsers).catch(() => {});
  useEffect(() => { load(); }, []);

  const create = async () => {
    setErr('');
    if (!f.name.trim() || !f.email.trim() || !f.password) return setErr('Name, email and password are all required.');
    if (f.password.length < 8) return setErr('Password must be at least 8 characters.');
    try {
      await api('/admin/users', { method: 'POST', body: JSON.stringify({ ...f, aliases: f.aliases.split(',').map((a) => a.trim()).filter(Boolean) }) });
      setF(blank); setShow(false); load(); say && say(`User created: ${f.name}`, 'good');
    } catch (e) { setErr(e.message); }
  };

  const save = async () => {
    setErr('');
    if (edit.newPassword && edit.newPassword.length < 8) return setErr('Password must be at least 8 characters.');
    try {
      const body = { name: edit.name, role: edit.role, jobType: edit.jobType, managerId: edit.managerId, targets: edit.targets, phone: edit.phone, designation: edit.designation, team: edit.team, shift: edit.shift, managerScopes: edit.managerScopes || [], aliases: Array.isArray(edit.aliases) ? edit.aliases : String(edit.aliases || '').split(',').map((a) => a.trim()).filter(Boolean) };
      if (edit.newPassword) body.password = edit.newPassword;
      await api(`/admin/users/${edit._id}`, { method: 'PUT', body: JSON.stringify(body) });
      setEdit(null); load(); say && say(`Updated ${edit.name}`, 'good');
    } catch (e) { setErr(e.message); }
  };

  const toggle = async (u) => {
    if (u._id === me.id || u._id === me._id) return say && say('You cannot deactivate your own account.', 'bad');
    try { await api(`/admin/users/${u._id}`, { method: 'PUT', body: JSON.stringify({ active: !u.active }) }); load(); say && say(`${u.name} ${u.active ? 'deactivated' : 'reactivated'}`, 'warn'); }
    catch (e) { say && say(e.message, 'bad'); }
  };

  return (
    <div className="max-w-5xl">
      {err && <div className="mb-4"><Note tone="bad">{err}</Note></div>}
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-slate-500">{users.filter((u) => u.active).length} active · {users.length} total</p>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
            <button onClick={() => setUview('list')} className={`px-3 py-1 rounded-md text-xs font-bold ${uview === 'list' ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>List</button>
            <button onClick={() => setUview('org')} className={`px-3 py-1 rounded-md text-xs font-bold ${uview === 'org' ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>Org chart</button>
          </div>
          <Btn onClick={() => { setShow(!show); setErr(''); }}>{show ? 'Cancel' : '+ Add user'}</Btn>
        </div>
      </div>

      {uview === 'org' && <OrgChart users={users} onReassign={reassign} />}

      {show && (
        <div className="bg-white rounded-xl border-2 p-5 mb-5" style={{ borderColor: C.orange }}>
          <h3 className="font-bold text-sm mb-4" style={{ color: C.navy }}>New user</h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name *"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Nancy" /></Field>
            <Field label="Email *"><input className={inputCls} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="nancy@qtonix.com" /></Field>
            <Field label="Password *" hint="At least 8 characters"><input type="password" className={inputCls} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
            <Field label="Phone" hint="Appears on their report covers"><input className={inputCls} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+91-…" /></Field>
            <Field label="Designation"><input className={inputCls} value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} /></Field>
            <Field label="Role"><select className={inputCls} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="agent">Sales agent</option><option value="manager">Manager</option><option value="admin">Admin</option></select></Field>
            <Field label="Team"><select className={inputCls} value={f.team} onChange={(e) => setF({ ...f, team: e.target.value })}>{TEAMS.map((t) => <option key={t}>{t}</option>)}</select></Field>
            <Field label="Shift"><select className={inputCls} value={f.shift} onChange={(e) => setF({ ...f, shift: e.target.value })}>{SHIFTS.map((s) => <option key={s}>{s}</option>)}</select></Field>
            <div className="col-span-2"><Field label="Alias names" hint="Pseudonyms used with clients — comma-separated (e.g. Nina, Nicky)"><input className={inputCls} value={f.aliases} onChange={(e) => setF({ ...f, aliases: e.target.value })} placeholder="Nina, Nicky" /></Field></div>
            <TargetsAndReporting state={f} patch={(p) => setF({ ...f, ...p })} managers={managers} />
          </div>
          <div className="flex justify-end mt-4"><Btn variant="dark" onClick={create}>Create user</Btn></div>
        </div>
      )}

      {edit && (
        <div className="bg-white rounded-xl border-2 p-5 mb-5" style={{ borderColor: C.blue }}>
          <h3 className="font-bold text-sm mb-4" style={{ color: C.navy }}>Edit {edit.name}</h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name"><input className={inputCls} value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Phone"><input className={inputCls} value={edit.phone || ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label="Designation"><input className={inputCls} value={edit.designation || ''} onChange={(e) => setEdit({ ...edit, designation: e.target.value })} /></Field>
            <Field label="Role"><select className={inputCls} value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })} disabled={edit._id === me.id || edit._id === me._id}><option value="agent">Sales agent</option><option value="manager">Manager</option><option value="admin">Admin</option></select></Field>
            <Field label="Team"><select className={inputCls} value={edit.team || 'Bhubaneswar'} onChange={(e) => setEdit({ ...edit, team: e.target.value })}>{TEAMS.map((t) => <option key={t}>{t}</option>)}</select></Field>
            <Field label="Shift"><select className={inputCls} value={edit.shift || 'Morning'} onChange={(e) => setEdit({ ...edit, shift: e.target.value })}>{SHIFTS.map((s) => <option key={s}>{s}</option>)}</select></Field>
            {edit.role === 'manager' && (
              <div className="col-span-2">
                <Field label="Manages (team + shift)" hint="Leads owned by agents in these groups become visible to this manager">
                  <div className="flex flex-wrap gap-2 mt-1">
                    {TEAMS.flatMap((t) => SHIFTS.map((s) => {
                      const scopes = Array.isArray(edit.managerScopes) ? edit.managerScopes : [];
                      const on = scopes.some((x) => x.team === t && x.shift === s);
                      return (
                        <button key={`${t}-${s}`} type="button"
                          onClick={() => setEdit({ ...edit, managerScopes: on ? scopes.filter((x) => !(x.team === t && x.shift === s)) : [...scopes, { team: t, shift: s }] })}
                          className={`rounded-full px-3 py-1 text-[11px] font-bold border ${on ? 'bg-[#2563EB] text-white border-transparent' : 'text-slate-500 border-slate-200 hover:border-slate-400'}`}>
                          {t} · {s}
                        </button>
                      );
                    }))}
                  </div>
                </Field>
              </div>
            )}
            <div className="col-span-2"><Field label="Alias names" hint="Comma-separated"><input className={inputCls} value={Array.isArray(edit.aliases) ? edit.aliases.join(', ') : (edit.aliases || '')} onChange={(e) => setEdit({ ...edit, aliases: e.target.value })} /></Field></div>
            <TargetsAndReporting state={edit} patch={(p) => setEdit({ ...edit, ...p })} managers={managers.filter((m) => (m.id || m._id) !== (edit.id || edit._id))} />
            <Field label="New password" hint="Leave blank to keep the current one"><input type="text" className={inputCls} value={edit.newPassword || ''} onChange={(e) => setEdit({ ...edit, newPassword: e.target.value })} placeholder="New password…" /></Field>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Btn variant="ghost" onClick={() => setEdit(null)}>Cancel</Btn>
            <Btn variant="dark" onClick={save}>Save changes</Btn>
          </div>
        </div>
      )}

      {uview === 'list' && <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr className="text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            <th className="px-4 py-3">Name</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Role</th>
            <th className="px-4 py-3">Team / Shift</th><th className="px-4 py-3">Reports</th><th className="px-4 py-3"></th>
          </tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u._id} className={`border-t border-slate-100 ${!u.active ? 'opacity-40' : ''}`}>
                <td className="px-4 py-3">
                  <div className="font-semibold" style={{ color: C.navy }}>{u.name} {(u._id === me.id || u._id === me._id) && <span className="text-[9px] font-bold text-slate-400">(you)</span>}</div>
                  <div className="text-[11px] text-slate-400">{u.designation}{u.phone ? ' · ' + u.phone : ''}{u.aliases && u.aliases.length ? ' · aka ' + u.aliases.join(', ') : ''}</div>
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">{u.email}</td>
                <td className="px-4 py-3"><span className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase" style={u.role === 'admin' ? { background: '#FFF4EC', color: C.orangeDeep } : { background: '#F1F5F9', color: '#64748B' }}>{u.role}</span></td>
                <td className="px-4 py-3 text-[11px] text-slate-500">{u.team || '—'}<br /><span className="text-slate-400">{u.shift || ''}</span></td>
                <td className="px-4 py-3 text-xs font-semibold">{u.reportsRun}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex gap-1.5 justify-end">
                    <Btn size="sm" variant="ghost" onClick={() => { setEdit({ ...u, newPassword: '' }); setErr(''); }}>Edit</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => toggle(u)}>{u.active ? 'Deactivate' : 'Reactivate'}</Btn>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
      <p className="text-[11px] text-slate-400 mt-3">Deactivating is a soft delete — their reports are preserved and keep working.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// CRM Fields — admin manages all the dropdown lists used across the Leads UI.
// Simple string lists (sources, services, tags) and labelled+coloured lists
// (statuses, deal stages). Saves the whole crmConfig back to settings.
// ---------------------------------------------------------------------------
function CrmFields({ say }) {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api('/admin/settings').then((s) => setCfg(s.crmConfig || {})).catch((e) => say(e.message, 'bad'));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api('/admin/settings', { method: 'PUT', body: JSON.stringify({ crmConfig: cfg }) });
      say('CRM fields saved.');
    } catch (e) { say(e.message, 'bad'); }
    setSaving(false);
  };

  if (!cfg) return <div className="text-sm text-slate-400">Loading…</div>;

  const setList = (key, list) => setCfg({ ...cfg, [key]: list });

  return (
    <div className="space-y-8">
      <p className="text-sm text-slate-500">Manage the dropdown options used across the Leads module. Changes apply everywhere leads are created or edited.</p>

      <StringListEditor title="Lead sources" items={cfg.leadSources || []} onChange={(l) => setList('leadSources', l)} />
      <StringListEditor title="Services interested (multi-select in leads)" items={cfg.servicesInterested || []} onChange={(l) => setList('servicesInterested', l)} />
      <StringListEditor title="Lead tags" hint="First one is the default on new leads" items={cfg.tags || []} onChange={(l) => setList('tags', l)} />
      <StringListEditor title="Deal currencies" items={cfg.dealCurrencies || []} onChange={(l) => setList('dealCurrencies', l)} />
      <StringListEditor title="Task priorities" items={cfg.taskPriorities || []} onChange={(l) => setList('taskPriorities', l)} />

      <LabelListEditor title="Lead statuses" items={cfg.leadStatuses || []} onChange={(l) => setList('leadStatuses', l)} />
      <LabelListEditor title="Deal stages" items={cfg.dealStages || []} onChange={(l) => setList('dealStages', l)} />

      <FxRatesEditor rates={cfg.fxRates || { USD: 1 }} currencies={cfg.dealCurrencies || ['USD']} onChange={(r) => setList('fxRates', r)} />

      <div className="flex justify-end sticky bottom-4">
        <button onClick={save} disabled={saving} className="rounded-lg px-6 py-2.5 text-sm font-bold text-white shadow-lg disabled:opacity-50" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>{saving ? 'Saving…' : 'Save CRM fields'}</button>
      </div>
    </div>
  );
}

// Editor for a simple list of strings.
function StringListEditor({ title, hint, items, onChange }) {
  const [val, setVal] = useState('');
  const add = () => { const v = val.trim(); if (!v || items.includes(v)) return; onChange([...items, v]); setVal(''); };
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5">
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-sm font-bold text-[#050A1F]">{title}</div>
        {hint && <div className="text-[11px] text-slate-400">{hint}</div>}
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        {items.map((it, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
            {it}
            <button onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-500">✕</button>
          </span>
        ))}
        {items.length === 0 && <span className="text-xs text-slate-300 italic">No options yet.</span>}
      </div>
      <div className="flex gap-2">
        <input value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Add an option…"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
        <button onClick={add} className="rounded-lg bg-[#050A1F] px-4 py-2 text-sm font-bold text-white">Add</button>
      </div>
    </div>
  );
}

// FX rates: units of each currency per 1 USD. Deal amounts / rate = USD.
function FxRatesEditor({ rates, currencies, onChange }) {
  const set = (cur, val) => onChange({ ...rates, [cur]: Number(val) || 0 });
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5">
      <div className="text-sm font-bold text-[#050A1F] mb-1">Currency conversion rates</div>
      <p className="text-[11px] text-slate-400 mb-3">Units of each currency per <b>1 USD</b>. Deals in other currencies are divided by their rate to get USD for targets and the leaderboard. USD is always 1.</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {currencies.map((cur) => (
          <div key={cur} className="flex items-center gap-2">
            <span className="w-12 text-sm font-bold text-slate-600">{cur}</span>
            <input type="number" step="0.0001" min="0" disabled={cur === 'USD'}
              value={cur === 'USD' ? 1 : (rates[cur] ?? '')}
              onChange={(e) => set(cur, e.target.value)}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:bg-slate-50 disabled:text-slate-400" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Editor for a list of { id, label, color } — statuses and deal stages.
function LabelListEditor({ title, items, onChange }) {
  const [label, setLabel] = useState('');
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const add = () => {
    const l = label.trim(); if (!l) return;
    const id = slug(l); if (items.some((x) => x.id === id)) return;
    onChange([...items, { id, label: l, color: '#64748B' }]); setLabel('');
  };
  const update = (i, patch) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5">
      <div className="text-sm font-bold text-[#050A1F] mb-3">{title}</div>
      <div className="space-y-2 mb-3">
        {items.map((it, i) => (
          <div key={it.id} className="flex items-center gap-2">
            <input type="color" value={it.color || '#64748B'} onChange={(e) => update(i, { color: e.target.value })} className="h-8 w-10 rounded border border-slate-200 cursor-pointer" />
            <input value={it.label} onChange={(e) => update(i, { label: e.target.value })} className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
            <span className="text-[10px] text-slate-400 font-mono w-24 truncate">{it.id}</span>
            <button onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-500 text-sm">✕</button>
          </div>
        ))}
        {items.length === 0 && <span className="text-xs text-slate-300 italic">No options yet.</span>}
      </div>
      <div className="flex gap-2">
        <input value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Add an option…"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
        <button onClick={add} className="rounded-lg bg-[#050A1F] px-4 py-2 text-sm font-bold text-white">Add</button>
      </div>
    </div>
  );
}

function Limits({ settings, setSettings }) {
  return (
    <div className="max-w-2xl bg-white rounded-xl border border-slate-200 p-5">
      <h3 className="font-bold text-sm mb-1" style={{ color: C.navy }}>Report behaviour &amp; limits</h3>
      <p className="text-xs text-slate-500 mb-5">These control credit burn. Change them deliberately.</p>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Reports per agent per day" hint="Stops a runaway credit bill"><input type="number" min="1" max="200" className={inputCls} value={settings.dailyReportLimit || 20} onChange={(e) => setSettings({ ...settings, dailyReportLimit: Number(e.target.value) })} /></Field>
        <Field label="Cache the same domain for (days)" hint="Re-running a domain inside this window is free"><input type="number" min="0" max="90" className={inputCls} value={settings.cacheDays || 7} onChange={(e) => setSettings({ ...settings, cacheDays: Number(e.target.value) })} /></Field>
        <Field label="Report valid for (days)" hint="Printed on the cover"><input type="number" min="1" max="90" className={inputCls} value={settings.reportValidDays || 14} onChange={(e) => setSettings({ ...settings, reportValidDays: Number(e.target.value) })} /></Field>
        <Field label="Default market" hint="Two-letter code, e.g. us, uk, in, my"><input className={inputCls} value={settings.defaultCountry || 'us'} onChange={(e) => setSettings({ ...settings, defaultCountry: e.target.value.toLowerCase() })} /></Field>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity log (persisted, from MySQL)
// ---------------------------------------------------------------------------
function ActivityLog() {
  const [logs, setLogs] = useState([]);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (open) api('/admin/logs').then(setLogs).catch(() => {}); }, [open]);
  return (
    <details className="bg-white rounded-xl border border-slate-200 mt-6" onToggle={(e) => setOpen(e.target.open)}>
      <summary className="px-4 py-2.5 text-xs font-bold cursor-pointer select-none" style={{ color: C.navy }}>Activity log <span className="text-slate-400 font-normal">(latest 100)</span></summary>
      <div className="px-4 pb-4 max-h-96 overflow-auto">
        {!logs.length && <p className="text-xs text-slate-400 py-2">No activity recorded yet.</p>}
        {logs.map((l) => (
          <div key={l.id} className="flex items-start gap-3 py-1.5 border-t border-slate-50 text-xs">
            <span className="text-slate-400 shrink-0 w-32">{dt(l.createdAt)}</span>
            <span className="font-semibold text-slate-600 shrink-0">{l.userName || '—'}</span>
            <span className="text-slate-500">{l.action}{l.target ? ` · ${l.target}` : ''}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Admin shell
// ---------------------------------------------------------------------------
export default function Admin() {
  const [tab, setTab] = useState('pricing');
  const [settings, setSettings] = useState(null);
  const [me, setMe] = useState({});
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = () => api('/admin/settings').then(setSettings).catch((e) => setMsg({ bad: true, text: e.message }));
  useEffect(() => { load(); api('/auth/me').then((r) => setMe(r.user || r)).catch(() => {}); }, []);

  const say = (text, tone) => setMsg({ text, bad: tone === 'bad' });

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const saved = await api('/admin/settings', { method: 'PUT', body: JSON.stringify(settings) });
      setSettings(saved);
      setMsg({ text: 'Settings saved.' });
    } catch (e) { setMsg({ bad: true, text: e.message }); }
    finally { setSaving(false); }
  };

  if (!settings) return <div className="p-8 text-sm text-slate-400">Loading admin…</div>;

  const tabs = [['pricing', 'Pricing'], ['branding', 'Branding'], ['keys', 'API keys'], ['users', 'Users'], ['crm', 'CRM Fields'], ['limits', 'Limits']];
  // Save applies to tabs backed by the settings object (not Users, which saves inline).
  const showSave = tab !== 'users' && tab !== 'crm';

  return (
    <div className="min-h-screen bg-slate-50" style={{ fontFamily: "'Plus Jakarta Sans',system-ui,sans-serif" }}>
      <header style={{ background: C.navy }}>
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="text-lg font-extrabold text-white tracking-tight">Qtonix<span style={{ color: C.orange }}>.</span> <span className="ml-2 text-[10px] font-bold text-slate-400 tracking-[2px]">ADMIN</span></div>
          <a href="/" className="text-xs font-bold text-slate-400 hover:text-white">← Back to app</a>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-7">
        <h1 className="text-2xl font-extrabold tracking-tight mb-4" style={{ color: C.navy }}>Admin</h1>

        {msg && <div className={`mb-4 rounded-lg px-4 py-3 text-sm ${msg.bad ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-green-50 border border-green-200 text-green-700'}`}>{msg.text}</div>}

        <div className="flex gap-1 mb-5 border-b border-slate-200 flex-wrap items-center justify-between">
          <div className="flex gap-1 flex-wrap">
            {tabs.map(([id, l]) => (
              <button key={id} onClick={() => setTab(id)} className="px-4 py-2 text-xs font-bold border-b-2 transition" style={{ borderColor: tab === id ? C.orange : 'transparent', color: tab === id ? C.navy : '#94A3B8' }}>{l}</button>
            ))}
          </div>
          {showSave && <Btn onClick={save} disabled={saving} size="sm">{saving ? 'Saving…' : 'Save changes'}</Btn>}
        </div>

        {tab === 'pricing' && <PricingEditor settings={settings} setSettings={setSettings} say={say} />}
        {tab === 'branding' && <Branding settings={settings} setSettings={setSettings} say={say} reload={load} />}
        {tab === 'keys' && <ApiKeys settings={settings} setSettings={setSettings} say={say} />}
        {tab === 'users' && <Users me={me} say={say} />}
        {tab === 'crm' && <CrmFields say={say} />}
        {tab === 'limits' && <Limits settings={settings} setSettings={setSettings} />}

        <ActivityLog />
      </main>
    </div>
  );
}

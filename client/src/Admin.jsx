import React, { useState, useEffect } from 'react';
import { API_BASE } from './config.js';
import { formatPhone } from './countries.js';

/**
 * Qtonix Site Analysis — admin panel.
 * Tabs: Pricing · Branding · API keys · Users · Limits, plus a persisted
 * Activity log. Matches the sandbox design; wired to the live API.
 */

// ---- brand palette (mirrors the sandbox C object) ----
const C = { navy: '#050A1F', orange: '#FF6A00', orangeDeep: '#FF4500', blue: '#2563EB' };

// Upload an avatar to ImageKit (via server-issued auth) and return its URL.
// Falls back to a downscaled base64 data URL if ImageKit isn't connected, so
// avatars keep working before the keys are entered.
async function uploadAvatar(file, userName) {
  let ik = null;
  try { ik = await api('/admin/imagekit'); } catch { ik = null; }
  if (ik && ik.configured) {
    const auth = await api('/admin/imagekit/auth');
    const safe = (userName || 'user').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const form = new FormData();
    form.append('file', file);
    form.append('fileName', `${safe}.jpg`);
    form.append('folder', '/qtonix-crm/avatars');
    form.append('publicKey', auth.publicKey);
    form.append('signature', auth.signature);
    form.append('expire', auth.expire);
    form.append('token', auth.token);
    form.append('useUniqueFileName', 'true');
    const res = await fetch('https://upload.imagekit.io/api/v1/files/upload', { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Upload failed.');
    return data.url;
  }
  return fileToAvatar(file); // No ImageKit yet — keep the old base64 path.
}

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

// Read an image file and downscale to a small square JPEG data URL (so avatars
// stay tiny in the DB). Returns a base64 data URL string.
function fileToAvatar(file, size = 128) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        // Cover-crop to a centered square.
        const min = Math.min(img.width, img.height);
        const sx = (img.width - min) / 2, sy = (img.height - min) / 2;
        ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Small avatar preview with initials fallback.
function AvatarPreview({ name, src, size = 56 }) {
  const initials = (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  if (src) return <img src={src} alt={name} className="rounded-full object-cover border border-slate-200" style={{ width: size, height: size }} />;
  return <div className="rounded-full bg-slate-200 text-slate-500 font-bold flex items-center justify-center" style={{ width: size, height: size, fontSize: size * 0.36 }}>{initials}</div>;
}

// India-locked phone input for staff (all agents/managers are in India). Shows
// a fixed +91 chip and formats as 9812-345-678.
function IndiaPhone({ value, onChange }) {
  const local = String(value || '').replace(/^\+91\s*/, '');
  return (
    <div className="flex">
      <span className="inline-flex items-center rounded-l-lg border border-r-0 border-slate-300 bg-slate-50 px-2.5 text-sm font-bold text-slate-500">+91</span>
      <input className={inputCls + ' rounded-l-none'} value={local} placeholder="9812-345-678"
        onChange={(e) => onChange(formatPhone(e.target.value, 'India'))} onBlur={(e) => onChange(formatPhone(e.target.value, 'India'))} />
    </div>
  );
}
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
// Demo / training mode
// ---------------------------------------------------------------------------
function DemoModeSettings({ say }) {
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api('/admin/demo-app').then(setCfg).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async (patch) => {
    setBusy(true);
    try {
      const r = await api('/admin/demo-app', { method: 'PUT', body: JSON.stringify(patch) });
      setCfg(r);
      say && say('Demo mode updated', 'good');
    } catch (e) { say && say(e.message, 'bad'); }
    setBusy(false);
  };

  if (!cfg) return <div className="text-slate-400 text-sm py-8">Loading…</div>;

  const url = cfg.token ? `${window.location.origin}/demo-app/${cfg.token}` : null;
  const since = cfg.startedAt ? new Date(cfg.startedAt).toLocaleString('en-GB') : null;

  return (
    <div className="max-w-3xl space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-bold" style={{ color: C.navy }}>Demo / training mode</div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Creates a temporary link to a full copy of the app filled with sample clients, deals and
              reports. Perfect for walking new agents through the product — they can click anything
              without touching real data.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm font-bold text-slate-600 shrink-0">
            <input type="checkbox" checked={!!cfg.enabled} disabled={busy}
              onChange={(e) => save({ enabled: e.target.checked })} />
            {cfg.enabled ? 'Enabled' : 'Disabled'}
          </label>
        </div>

        {cfg.enabled && url && (
          <div className="mt-4 rounded-lg bg-slate-50 border border-slate-100 p-3">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">
              Training URLs — one per seat
            </div>
            <p className="text-[11px] text-slate-400 mb-2">
              Give agents the agent link so the demo matches what they'll actually see on day one.
              The manager and admin links show the wider views.
            </p>
            {[
              ['agent', 'Agent', 'Own leads and the agent leaderboard'],
              ['manager', 'Manager', "Their team's leads and figures"],
              ['admin', 'Admin', 'Everything, company-wide'],
              ['leadmanager', 'Lead Manager', 'Lead intake dashboard and pre-sales team performance'],
            ].map(([role, label, hint]) => {
              const roleUrl = `${url}?role=${role}`;
              return (
                <div key={role} className="mb-2 last:mb-0">
                  <div className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-[11px] font-bold text-slate-600">{label}</span>
                    <input readOnly value={roleUrl} className={inputCls + ' font-mono text-[11px]'} onFocus={(e) => e.target.select()} />
                    <Btn size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(roleUrl); say && say(`${label} URL copied`, 'good'); }}>Copy</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => window.open(roleUrl, '_blank')}>Open</Btn>
                  </div>
                  <div className="text-[10px] text-slate-400 ml-[4.5rem] mt-0.5">{hint}</div>
                </div>
              );
            })}
            {since && <div className="text-[10px] text-slate-400 mt-2">Live since {since}</div>}
            <Note tone="warn">
              Anyone with a link can open the demo without logging in. It only ever shows made-up
              data — never a real client — but switch it off when the training session is over.
            </Note>
            <div className="mt-2">
              <Btn size="sm" variant="ghost" disabled={busy}
                onClick={() => { if (confirm('Regenerate the URL? All current links will stop working immediately.')) save({ regenerate: true }); }}>
                ↻ Regenerate URLs
              </Btn>
            </div>
          </div>
        )}

        <div className="mt-4 grid grid-cols-3 gap-3 text-[11px]">
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="font-bold text-slate-600 mb-0.5">Sample data</div>
            <div className="text-slate-400">30 leads, 12 clients with part-paid plans, 12 reports, 7 staff.</div>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="font-bold text-slate-600 mb-0.5">Nothing is saved</div>
            <div className="text-slate-400">Edits are accepted so buttons work, then discarded on refresh.</div>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="font-bold text-slate-600 mb-0.5">Separate from live</div>
            <div className="text-slate-400">Your real leads, reports and figures are never loaded here.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Motivator TV settings
// ---------------------------------------------------------------------------
// Historical monthly targets + achieved. The admin picks a month, then a
// manager (which loads that manager and their agents) or an individual agent,
// and edits each person's target and achieved for that month. Reviews use these
// stored figures for months the live data can't cover.
function monthChoices(count = 12) {
  const out = [];
  const d = new Date();
  for (let i = 0; i < count; i++) {
    const dt = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    out.push({ key, label: dt.toLocaleString('en-US', { month: 'long', year: 'numeric' }) });
  }
  return out;
}

// Status band from % of target achieved. Distinct treatments so on-target and
// over-target read differently, and zero stands out as needing attention.
function targetStatus(target, achieved) {
  const t = Number(target) || 0;
  const a = Number(achieved) || 0;
  if (a <= 0) return { label: 'Needs attention', cls: 'bg-slate-200 text-slate-600', pct: 0 };
  if (t <= 0) return { label: 'No target set', cls: 'bg-slate-100 text-slate-400', pct: null };
  const pct = Math.round((a / t) * 100);
  if (pct >= 100) return { label: `Exceeded · ${pct}%`, cls: 'bg-emerald-100 text-emerald-700', pct };
  if (pct >= 70) return { label: `On track · ${pct}%`, cls: 'bg-green-100 text-green-700', pct };
  if (pct >= 50) return { label: `Behind · ${pct}%`, cls: 'bg-amber-100 text-amber-700', pct };
  return { label: `At risk · ${pct}%`, cls: 'bg-red-100 text-red-700', pct };
}

function MonthlyTargets({ say }) {
  const months = monthChoices(12);
  const [period, setPeriod] = useState(months[1] ? months[1].key : months[0].key);
  const [managerId, setManagerId] = useState('');
  const [managers, setManagers] = useState([]);
  const [available, setAvailable] = useState([]);   // agents/managers for the current scope
  const [selectedIds, setSelectedIds] = useState([]); // chosen agent ids
  const [rowData, setRowData] = useState({});         // userId -> {targetUsd, achievedUsd, hasRecord}
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newAgent, setNewAgent] = useState({ name: '', managerId: '' });

  useEffect(() => {
    api('/admin/users').then((us) => setManagers(us.filter((u) => u.role === 'manager'))).catch(() => {});
  }, []);

  // Load the roster for the chosen month/manager. This gives us the selectable
  // agents (and their stored target/achieved for the month).
  const loadRoster = () => {
    setLoading(true);
    const qs = `period=${period}${managerId ? `&managerId=${managerId}` : ''}`;
    api(`/admin/monthly-targets?${qs}`)
      .then((r) => {
        const list = r.rows || [];
        setAvailable(list);
        const data = {};
        list.forEach((x) => { data[x.userId] = { targetUsd: x.targetUsd, achievedUsd: x.achievedUsd, hasRecord: x.hasRecord }; });
        setRowData((prev) => ({ ...data, ...prev })); // keep any unsaved edits
        // Pre-select anyone who already has a stored record for the month, plus
        // the manager row when a manager is selected (for the team increment).
        setSelectedIds((prev) => {
          const auto = list.filter((x) => x.hasRecord || (managerId && String(x.userId) === String(managerId))).map((x) => x.userId);
          return Array.from(new Set([...prev.filter((id) => list.some((x) => x.userId === id)), ...auto]));
        });
      })
      .catch((e) => say(e.message, true))
      .finally(() => setLoading(false));
  };
  useEffect(() => { setSelectedIds([]); setRowData({}); loadRoster(); /* eslint-disable-next-line */ }, [period, managerId]);

  const setField = (userId, patch) => setRowData((d) => ({ ...d, [userId]: { ...(d[userId] || {}), ...patch } }));
  const toggle = (id) => setSelectedIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const selectedRows = available.filter((a) => selectedIds.includes(a.userId));

  const saveRow = async (row) => {
    const d = rowData[row.userId] || {};
    setSavingId(row.userId);
    try {
      await api('/admin/monthly-targets', {
        method: 'POST',
        body: JSON.stringify({ userId: row.userId, period, targetUsd: Number(d.targetUsd) || 0, achievedUsd: Number(d.achievedUsd) || 0 }),
      });
      setField(row.userId, { hasRecord: true });
      say(`Saved ${row.name} for ${period}.`);
    } catch (e) { say(e.message, true); }
    setSavingId(null);
  };

  const saveAll = async () => {
    for (const row of selectedRows) await saveRow(row);
    say('All selected rows saved.');
  };

  const addPastAgent = async () => {
    if (!newAgent.name.trim()) { say('Enter the agent’s name.', true); return; }
    try {
      const created = await api('/admin/archived-agents', {
        method: 'POST',
        body: JSON.stringify({ name: newAgent.name.trim(), managerId: newAgent.managerId || managerId || undefined }),
      });
      setShowAdd(false); setNewAgent({ name: '', managerId: '' });
      say(`Added past agent ${created.name}.`);
      loadRoster();
      setSelectedIds((s) => [...s, created.id]);
    } catch (e) { say(e.message, true); }
  };

  const inp = 'w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400';

  return (
    <div>
      <h2 className="text-lg font-extrabold mb-1" style={{ color: C.navy }}>Monthly targets & achieved</h2>
      <p className="text-sm text-slate-500 mb-4">
        Record historical targets and the amount achieved for past months, so reviews aren't blank for people who joined
        (or left) before this system went live. Reviews use live sales when available and fall back to these figures otherwise.
      </p>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Month</label>
          <select value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Manager</label>
          <select value={managerId} onChange={(e) => setManagerId(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">All agents</option>
            {managers.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.team}/{m.shift}</option>)}
          </select>
        </div>
        <Btn onClick={() => setShowAdd(true)} size="sm" variant="ghost">+ Add past agent</Btn>
      </div>

      {/* Agent multi-select */}
      <div className="mb-4">
        <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">
          Select agents {managerId ? 'under this manager' : ''} to enter data for
        </label>
        {loading ? (
          <div className="text-slate-400 text-sm py-3">Loading…</div>
        ) : available.length === 0 ? (
          <div className="text-slate-400 text-sm py-3">No agents found for this selection.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {available.map((a) => (
              <button key={a.userId} type="button" onClick={() => toggle(a.userId)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
                  selectedIds.includes(a.userId) ? 'bg-orange-50 border-orange-300 text-[#FF4500]' : 'border-slate-200 text-slate-500 hover:border-slate-300'
                }`}>
                {a.name}
                {a.role === 'manager' && <span className="ml-1 text-[9px] text-purple-500">(mgr)</span>}
                {a.archived && <span className="ml-1 text-[9px] text-slate-400">(departed)</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedRows.length > 0 && (
        <>
          <div className="flex justify-end mb-2"><Btn onClick={saveAll} size="sm">Save all</Btn></div>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase text-slate-400 bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-2.5">Name</th>
                  <th className="text-left px-4 py-2.5">Role</th>
                  <th className="text-left px-4 py-2.5">Team</th>
                  <th className="text-right px-4 py-2.5">Target (USD)</th>
                  <th className="text-right px-4 py-2.5">Achieved (USD)</th>
                  <th className="text-center px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {selectedRows.map((r) => {
                  const d = rowData[r.userId] || {};
                  const st = targetStatus(d.targetUsd, d.achievedUsd);
                  return (
                    <tr key={r.userId} className="border-b border-slate-100">
                      <td className="px-4 py-2.5 font-bold text-[#050A1F]">
                        {r.name}{r.archived && <span className="ml-1.5 text-[9px] font-bold text-slate-400">DEPARTED</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] font-bold rounded px-1.5 py-0.5 ${r.role === 'manager' ? 'bg-purple-50 text-purple-700' : 'bg-slate-100 text-slate-500'}`}>
                          {r.role === 'manager' ? 'Manager' : 'Agent'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs">{r.team || '—'} / {r.shift || '—'}</td>
                      <td className="px-4 py-2.5 text-right">
                        <input type="number" className={inp} value={d.targetUsd ?? ''}
                          onChange={(e) => setField(r.userId, { targetUsd: e.target.value })} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <input type="number" className={inp} value={d.achievedUsd ?? ''}
                          onChange={(e) => setField(r.userId, { achievedUsd: e.target.value })} />
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`inline-block rounded-full px-2.5 py-1 text-[10px] font-bold ${st.cls}`}>{st.label}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Btn onClick={() => saveRow(r)} size="sm" disabled={savingId === r.userId}>{savingId === r.userId ? '…' : (d.hasRecord ? 'Update' : 'Save')}</Btn>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {managerId && (
            <p className="text-[11px] text-slate-400 mt-2">
              In reviews, this manager's team target for {period} = the agents' targets above + the manager's own target row;
              team achieved = the agents' achieved (departed agents included).
            </p>
          )}
        </>
      )}

      {/* Add past agent modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowAdd(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-extrabold text-[#050A1F] mb-1">Add a past (departed) agent</h3>
            <p className="text-xs text-slate-400 mb-4">Creates a records-only entry for someone who has left. They can't log in and won't appear on any live screen — only here, so you can record their history.</p>
            <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Agent name</label>
            <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm mb-3" value={newAgent.name}
              onChange={(e) => setNewAgent({ ...newAgent, name: e.target.value })} placeholder="e.g. Ramesh Kumar" />
            <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Manager they worked under (optional)</label>
            <select className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm mb-4"
              value={newAgent.managerId || managerId} onChange={(e) => setNewAgent({ ...newAgent, managerId: e.target.value })}>
              <option value="">— none —</option>
              {managers.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.team}/{m.shift}</option>)}
            </select>
            <div className="flex gap-2">
              <Btn onClick={addPastAgent} size="sm">Add agent</Btn>
              <button onClick={() => setShowAdd(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-500">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MotivatorTvSettings({ say }) {
  const [cfg, setCfg] = useState(null);
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api('/admin/tv').then((r) => { setCfg(r); setItems(r.announcements || []); }).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async (patch) => {
    setBusy(true);
    try {
      const r = await api('/admin/tv', { method: 'PUT', body: JSON.stringify(patch) });
      setCfg(r); setItems(r.announcements || []);
      say && say('Motivator TV updated', 'good');
    } catch (e) { say && say(e.message, 'bad'); }
    setBusy(false);
  };

  if (!cfg) return <div className="text-slate-400 text-sm py-8">Loading…</div>;

  const url = cfg.token ? `${window.location.origin}/tv/${cfg.token}` : null;

  return (
    <div className="max-w-3xl space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-bold" style={{ color: C.navy }}>Motivator TV board</div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              A full-screen sales board for an office TV. It rotates through targets, leaderboards and
              team standings, with a live countdown to month end.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm font-bold text-slate-600 shrink-0">
            <input type="checkbox" checked={!!cfg.enabled} disabled={busy}
              onChange={(e) => save({ enabled: e.target.checked })} />
            {cfg.enabled ? 'Enabled' : 'Disabled'}
          </label>
        </div>

        {cfg.enabled && url && (
          <div className="mt-4 rounded-lg bg-slate-50 border border-slate-100 p-3">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Public board URL</div>
            <div className="flex items-center gap-2">
              <input readOnly value={url} className={inputCls + ' font-mono text-xs'} onFocus={(e) => e.target.select()} />
              <Btn size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(url); say && say('URL copied', 'good'); }}>Copy</Btn>
              <Btn size="sm" variant="ghost" onClick={() => window.open(url, '_blank')}>Open</Btn>
            </div>
            <Note tone="warn">
              This link needs no login — anyone who has it can see your sales figures. Share it only with
              the office TV, and regenerate it if it ever leaks.
            </Note>
            <div className="mt-2">
              <Btn size="sm" variant="ghost" disabled={busy}
                onClick={() => { if (confirm('Regenerate the URL? The current link will stop working immediately.')) save({ regenerate: true }); }}>
                ↻ Regenerate URL
              </Btn>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="text-sm font-bold mb-1" style={{ color: C.navy }}>Announcements</div>
        <p className="text-[11px] text-slate-400 mb-3">Scrolls along the bottom of the board. Keep each line short.</p>
        <div className="flex gap-2 mb-3">
          <input className={inputCls} value={draft} onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. Team lunch this Friday — great work everyone!"
            onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) { save({ announcements: [...items, draft.trim()] }); setDraft(''); } }} />
          <Btn size="sm" onClick={() => { if (draft.trim()) { save({ announcements: [...items, draft.trim()] }); setDraft(''); } }}>Add</Btn>
        </div>
        {items.length === 0 ? (
          <div className="text-[11px] text-slate-300 italic">No announcements yet.</div>
        ) : (
          <div className="space-y-1.5">
            {items.map((a, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                <span className="flex-1 text-sm text-slate-600">📢 {a}</span>
                <button onClick={() => save({ announcements: items.filter((_, j) => j !== i) })}
                  className="text-slate-300 hover:text-red-500 text-sm">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------
function ApiKeys({ settings, setSettings, say }) {
  const [tests, setTests] = useState({});
  const [credits, setCredits] = useState(null);
  useEffect(() => { api('/admin/seranking-credits').then(setCredits).catch(() => setCredits(null)); }, []);
  const RULES = {
    seranking: { label: 'SE Ranking', required: true, hint: 'Rankings, backlinks, competitors, AI Overview data' },
    anthropic: { label: 'Claude (Anthropic)', required: true, hint: 'AI visibility test, cover tagline, executive summary' },
    openai: { label: 'OpenAI', required: false, hint: 'AI draft generator in the email composer (gpt-4o-mini)' },
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
            {id === 'seranking' && credits && (
              <div className="mt-2 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                {credits.error ? (
                  <div className="text-[11px] text-amber-600">Couldn’t read balance: {credits.error}</div>
                ) : (
                  <div className="flex items-center gap-4 flex-wrap">
                    <div>
                      <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Credits left</div>
                      <div className="text-base font-extrabold text-[#050A1F]">{credits.remaining != null ? Number(credits.remaining).toLocaleString() : '—'}</div>
                    </div>
                    <div>
                      <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Used this month</div>
                      <div className="text-base font-extrabold text-[#FF4500]">{Number(credits.usedMonth || 0).toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Used all time</div>
                      <div className="text-base font-extrabold text-slate-500">{Number(credits.usedTotal || 0).toLocaleString()}</div>
                    </div>
                  </div>
                )}
              </div>
            )}
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
function TargetsAndReporting({ state, patch, managers, allUsers = [] }) {
  const role = state.role;
  const t = state.targets || { transfer: { enabled: false, daily: 0, monthly: 0 }, sales: { enabled: false, monthly: 0 }, team: { enabled: false, monthly: 0 }, leadGen: { enabled: false, monthly: 0 } };
  const setT = (next) => patch({ targets: { ...t, ...next } });
  const numCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';

  if (role === 'admin') return null;

  // For a manager: the agents currently reporting to them and their targets.
  const myId = state.id || state._id;
  const teamAgents = role === 'manager' && myId
    ? allUsers.filter((u) => u.role === 'agent' && u.active !== false && u.managerId === myId)
    : [];
  const teamSum = teamAgents.reduce((s, a) => s + Number((a.targets && a.targets.sales && a.targets.sales.monthly) || 0), 0);

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

      {/* Manager team target — auto-summed from team members' monthly sales
          targets, with a manual override. */}
      {role === 'manager' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-700 text-sm">Monthly team sales target (USD)</span>
            <span className="text-[11px] text-slate-400">Auto-sum of team: <b className="text-slate-600">${teamSum.toLocaleString()}</b></span>
          </div>
          {teamAgents.length > 0 ? (
            <div className="rounded-lg border border-slate-100 overflow-hidden">
              <table className="w-full text-xs">
                <thead><tr className="bg-slate-100 text-slate-400 text-left"><th className="px-3 py-1.5">Agent</th><th className="px-3 py-1.5">Type</th><th className="px-3 py-1.5">Daily transfers</th><th className="px-3 py-1.5">Monthly sales (USD)</th></tr></thead>
                <tbody>
                  {teamAgents.map((a) => (
                    <tr key={a.id || a._id} className="border-t border-slate-100">
                      <td className="px-3 py-1.5 font-semibold text-slate-700">{a.name}</td>
                      <td className="px-3 py-1.5 text-slate-500">{a.jobType === 'presales' ? 'Pre-Sales' : 'BDE'}</td>
                      <td className="px-3 py-1.5 text-slate-500">{(a.targets && a.targets.transfer && a.targets.transfer.enabled) ? a.targets.transfer.daily : '—'}</td>
                      <td className="px-3 py-1.5 text-slate-500">${Number((a.targets && a.targets.sales && a.targets.sales.monthly) || 0).toLocaleString()}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-200 bg-slate-50 font-bold">
                    <td className="px-3 py-1.5" colSpan={3}>Team total</td>
                    <td className="px-3 py-1.5">${teamSum.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : <div className="text-[11px] text-slate-300 italic">No agents report to this manager yet.</div>}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!t.team.override} onChange={(e) => setT({ team: { ...t.team, enabled: true, override: e.target.checked, monthly: e.target.checked ? (t.team.monthly || teamSum) : teamSum } })} />
            <span className="text-slate-600">Manually override the team target</span>
            <input type="number" min="0" disabled={!t.team.override}
              className="w-40 rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:bg-slate-50 disabled:text-slate-400"
              value={t.team.override ? (t.team.monthly || '') : teamSum}
              onChange={(e) => setT({ team: { ...t.team, enabled: true, monthly: Number(e.target.value) || 0 } })} />
          </label>
          <p className="text-[11px] text-slate-400">Without an override, the team target auto-updates as agents join, leave, or change their sales targets.</p>
        </div>
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
            <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
              <input type="checkbox" checked={!!(t.leadGen && t.leadGen.enabled)} onChange={(e) => setT({ leadGen: { ...(t.leadGen || {}), enabled: e.target.checked } })} /> Lead generation
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
            {t.leadGen && t.leadGen.enabled && (
              <Field label="Monthly leads to generate">
                <input type="number" min="0" className={numCls} value={t.leadGen.monthly || ''} onChange={(e) => setT({ leadGen: { ...t.leadGen, monthly: Number(e.target.value) || 0 } })} placeholder="e.g. 40" />
              </Field>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Org chart: role tiers (Admin → Managers → Agents) shown at the top, then a
// per-branch / per-shift breakdown. Agents drag onto a manager to reassign;
// managers drag onto a branch+shift to move. Uses dataTransfer for reliable
// HTML5 drag-and-drop.
function OrgChart({ users, onReassign, onMoveManager }) {
  const [drag, setDrag] = useState(null); // { kind:'agent'|'manager', user }
  const active = (u) => u.active !== false;
  const admins = users.filter((u) => u.role === 'admin' && active(u));
  const managers = users.filter((u) => u.role === 'manager' && active(u));
  const agents = users.filter((u) => u.role === 'agent' && active(u));
  const teams = Array.from(new Set([...managers.map((m) => m.team), 'Bhubaneswar', 'Kolkata'])).filter(Boolean);
  const shifts = ['Morning', 'Night'];
  const idOf = (u) => u.id || u._id;
  const agentsFor = (mgr) => agents.filter((a) => a.managerId === idOf(mgr));
  const unassigned = agents.filter((a) => !a.managerId || !managers.some((m) => idOf(m) === a.managerId));

  const JobBadge = ({ a }) => a.jobType === 'presales'
    ? <span className="text-[8px] font-bold bg-purple-100 text-purple-600 px-1 rounded">PRE-SALES</span>
    : <span className="text-[8px] font-bold bg-blue-100 text-blue-600 px-1 rounded">BDE</span>;

  const AgentCard = ({ a }) => (
    <div draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(idOf(a))); setDrag({ kind: 'agent', user: a }); }}
      onDragEnd={() => setDrag(null)}
      className="bg-white rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs cursor-grab active:cursor-grabbing flex items-center justify-between gap-2 shadow-sm">
      <span className="font-semibold text-slate-700 truncate">{a.name}</span>
      <JobBadge a={a} />
    </div>
  );

  const ManagerChip = ({ m }) => (
    <div draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(idOf(m))); setDrag({ kind: 'manager', user: m }); }}
      onDragEnd={() => setDrag(null)}
      className="rounded-md bg-[#2563EB] text-white px-2.5 py-1 text-xs font-bold cursor-grab active:cursor-grabbing inline-block">
      {m.name}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Role tiers overview */}
      <div className="bg-slate-50 rounded-2xl border border-slate-100 p-5">
        <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-3">Roles</div>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="w-20 text-xs font-bold text-slate-500 shrink-0">Admin</span>
            <div className="flex flex-wrap gap-2">{admins.map((a) => <span key={idOf(a)} className="rounded-md bg-[#050A1F] text-white px-3 py-1 text-xs font-bold">{a.name}</span>)}</div>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-20 text-xs font-bold text-slate-500 shrink-0">Managers</span>
            <div className="flex flex-wrap gap-2">{managers.map((m) => <span key={idOf(m)} className="rounded-md bg-[#2563EB] text-white px-3 py-1 text-xs font-bold">{m.name}</span>)}{managers.length === 0 && <span className="text-xs text-slate-300 italic">None</span>}</div>
          </div>
          <div className="flex items-start gap-3">
            <span className="w-20 text-xs font-bold text-slate-500 shrink-0 pt-1">Agents</span>
            <div className="flex flex-wrap gap-2">{agents.map((a) => <span key={idOf(a)} className="rounded-md bg-white border border-slate-200 text-slate-600 px-3 py-1 text-xs font-semibold">{a.name}</span>)}{agents.length === 0 && <span className="text-xs text-slate-300 italic">None</span>}</div>
          </div>
        </div>
      </div>

      {/* Branch → Shift → Manager → Agents */}
      <div className="bg-slate-50 rounded-2xl border border-slate-100 p-5">
        <p className="text-xs text-slate-400 mb-4">Drag an <b>agent</b> onto a manager to reassign them. Drag a <b>manager</b> onto a branch+shift header to move their team there.</p>
        <div className="space-y-6">
          {teams.map((team) => (
            <div key={team} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-sm font-extrabold text-[#050A1F] mb-3">🏢 {team}</div>
              <div className="grid grid-cols-2 gap-4">
                {shifts.map((shift) => {
                  const shiftMgrs = managers.filter((m) => m.team === team && m.shift === shift);
                  return (
                    <div key={shift}
                      onDragOver={(e) => { if (drag && drag.kind === 'manager') e.preventDefault(); }}
                      onDrop={(e) => { e.preventDefault(); if (drag && drag.kind === 'manager') { onMoveManager(idOf(drag.user), team, shift); setDrag(null); } }}
                      className={`rounded-lg border p-3 ${drag && drag.kind === 'manager' ? 'border-blue-300 border-dashed bg-blue-50/40' : 'border-slate-100 bg-slate-50'}`}>
                      <div className="text-[11px] font-bold text-slate-400 uppercase mb-2">{shift === 'Morning' ? '🌅' : '🌙'} {shift} shift</div>
                      {/* No manager for this group → the admin is the direct
                          in-charge, and agents still need somewhere to land. */}
                      {shiftMgrs.length === 0 && (() => {
                        const orphans = agents.filter((a) => a.team === team && a.shift === shift);
                        return (
                          <div
                            onDragOver={(e) => { if (drag && drag.kind === 'agent') e.preventDefault(); }}
                            onDrop={(e) => {
                              e.preventDefault();
                              if (drag && drag.kind === 'agent') { onReassign(idOf(drag.user), { id: null, team, shift }); setDrag(null); }
                            }}
                            className={`rounded-lg border-2 border-dashed p-2 ${drag && drag.kind === 'agent' ? 'border-blue-300 bg-blue-50/40' : 'border-amber-200 bg-amber-50/40'}`}>
                            <div className="rounded-md bg-[#050A1F] text-white px-2.5 py-1 text-xs font-bold inline-block">
                              {admins.map((a) => a.name).join(', ') || 'Admin'} · direct in-charge
                            </div>
                            <div className="text-[10px] text-amber-700 mt-1">No manager assigned — admin oversees this group.</div>
                            <div className="space-y-1.5 pl-2 mt-2">
                              {orphans.map((a) => <AgentCard key={idOf(a)} a={a} />)}
                              {orphans.length === 0 && <div className="text-[10px] text-slate-300 italic px-1">Drop agents here</div>}
                            </div>
                          </div>
                        );
                      })()}
                      <div className="space-y-3">
                        {shiftMgrs.map((mgr) => (
                          <div key={idOf(mgr)}
                            onDragOver={(e) => { if (drag && drag.kind === 'agent') e.preventDefault(); }}
                            onDrop={(e) => { e.preventDefault(); if (drag && drag.kind === 'agent') { onReassign(idOf(drag.user), mgr); setDrag(null); } }}
                            className={`rounded-lg border-2 border-dashed p-2 ${drag && drag.kind === 'agent' ? 'border-blue-300 bg-blue-50/40' : 'border-slate-200'}`}>
                            <ManagerChip m={mgr} />
                            <div className="space-y-1.5 pl-2 mt-2">
                              {agentsFor(mgr).map((a) => <AgentCard key={idOf(a)} a={a} />)}
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
            <div className="text-xs font-bold text-amber-700 mb-2">⚠️ Unassigned agents — drag onto a manager</div>
            <div className="grid grid-cols-3 gap-2">{unassigned.map((a) => <AgentCard key={idOf(a)} a={a} />)}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function Users({ me, say }) {
  const blank = { name: '', email: '', password: '', role: 'agent', jobType: 'bde', managerId: null, phone: '+91 ', designation: 'Sales Executive', birthday: '', workAnniversary: '', team: 'Bhubaneswar', shift: 'Morning', aliases: '', targets: { transfer: { enabled: false, daily: 0, monthly: 0 }, sales: { enabled: false, monthly: 0 }, team: { enabled: false, monthly: 0 }, leadGen: { enabled: false, monthly: 0 } } };
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
      // manager.id may be null when dropping into an admin-led group (a
      // branch+shift with no manager) — the agent then reports to the admin.
      const mid = manager.id || manager._id || null;
      await api(`/admin/users/${userId}`, { method: 'PUT', body: JSON.stringify({ managerId: mid, team: manager.team, shift: manager.shift }) });
      load();
    } catch (e) { setErr(e.message); }
  };

  // Move a manager (and their whole scope) to a different branch+shift.
  const moveManager = async (managerId, team, shift) => {
    try {
      await api(`/admin/users/${managerId}`, { method: 'PUT', body: JSON.stringify({ team, shift, managerScopes: [{ team, shift }] }) });
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
      const body = { name: edit.name, role: edit.role, jobType: edit.jobType, managerId: edit.managerId, targets: edit.targets, avatar: edit.avatar, phone: edit.phone, designation: edit.designation, birthday: edit.birthday || null, workAnniversary: edit.workAnniversary || null, team: edit.team, shift: edit.shift, managerScopes: edit.managerScopes || [], aliases: Array.isArray(edit.aliases) ? edit.aliases : String(edit.aliases || '').split(',').map((a) => a.trim()).filter(Boolean) };
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

      {uview === 'org' && <OrgChart users={users} onReassign={reassign} onMoveManager={moveManager} />}

      {show && (
        <div className="bg-white rounded-xl border-2 p-5 mb-5" style={{ borderColor: C.orange }}>
          <h3 className="font-bold text-sm mb-4" style={{ color: C.navy }}>New user</h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name *"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Nancy" /></Field>
            <Field label="Email *"><input className={inputCls} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="nancy@qtonix.com" /></Field>
            <Field label="Password *" hint="At least 8 characters"><input type="password" className={inputCls} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
            <Field label="Phone" hint="Appears on their report covers"><IndiaPhone value={f.phone} onChange={(v) => setF({ ...f, phone: v })} /></Field>
            <Field label="Designation"><input className={inputCls} value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} /></Field>
            <Field label="Role"><select className={inputCls} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="agent">Sales agent</option><option value="manager">Manager</option><option value="leadmanager">Lead manager</option><option value="admin">Admin</option></select></Field>
            <Field label="Birthday"><input type="date" className={inputCls} value={f.birthday || ''} onChange={(e) => setF({ ...f, birthday: e.target.value })} /></Field>
            <Field label="Work anniversary"><input type="date" className={inputCls} value={f.workAnniversary || ''} onChange={(e) => setF({ ...f, workAnniversary: e.target.value })} /></Field>
            {/* A lead manager coordinates intake only — no team, shift, alias,
                designation or targets apply to them. */}
            {f.role !== 'leadmanager' && (
              <>
                <Field label="Team"><select className={inputCls} value={f.team} onChange={(e) => setF({ ...f, team: e.target.value })}>{TEAMS.map((t) => <option key={t}>{t}</option>)}</select></Field>
                <Field label="Shift"><select className={inputCls} value={f.shift} onChange={(e) => setF({ ...f, shift: e.target.value })}>{SHIFTS.map((s) => <option key={s}>{s}</option>)}</select></Field>
                <div className="col-span-2"><Field label="Alias names" hint="Pseudonyms used with clients — comma-separated (e.g. Nina, Nicky)"><input className={inputCls} value={f.aliases} onChange={(e) => setF({ ...f, aliases: e.target.value })} placeholder="Nina, Nicky" /></Field></div>
                <TargetsAndReporting state={f} patch={(p) => setF({ ...f, ...p })} managers={managers} allUsers={users} />
              </>
            )}
          </div>
          <div className="flex justify-end mt-4"><Btn variant="dark" onClick={create}>Create user</Btn></div>
        </div>
      )}

      {edit && (
        <div className="bg-white rounded-xl border-2 p-5 mb-5" style={{ borderColor: C.blue }}>
          <h3 className="font-bold text-sm mb-4" style={{ color: C.navy }}>Edit {edit.name}</h3>
          <div className="flex items-center gap-4 mb-4">
            <AvatarPreview name={edit.name} src={edit.avatar} size={56} />
            <div>
              <label className="inline-block rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 cursor-pointer hover:bg-slate-50">
                Upload photo
                <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                  const file = e.target.files && e.target.files[0];
                  if (!file) return;
                  try { const url = await uploadAvatar(file, edit.name); setEdit({ ...edit, avatar: url }); } catch (err) { setErr(err.message || 'Could not upload that image.'); }
                }} />
              </label>
              {edit.avatar && <button onClick={() => setEdit({ ...edit, avatar: null })} className="ml-2 text-xs font-bold text-red-500">Remove</button>}
              <div className="text-[10px] text-slate-400 mt-1">Shown on the sales leaderboard. Square photos look best.</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name"><input className={inputCls} value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Phone"><IndiaPhone value={edit.phone || ''} onChange={(v) => setEdit({ ...edit, phone: v })} /></Field>
            <Field label="Designation"><input className={inputCls} value={edit.designation || ''} onChange={(e) => setEdit({ ...edit, designation: e.target.value })} /></Field>
            <Field label="Role"><select className={inputCls} value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })} disabled={edit._id === me.id || edit._id === me._id}><option value="agent">Sales agent</option><option value="manager">Manager</option><option value="leadmanager">Lead manager</option><option value="admin">Admin</option></select></Field>
            <Field label="Birthday"><input type="date" className={inputCls} value={(edit.birthday || '').slice(0, 10)} onChange={(e) => setEdit({ ...edit, birthday: e.target.value })} /></Field>
            <Field label="Work anniversary"><input type="date" className={inputCls} value={(edit.workAnniversary || '').slice(0, 10)} onChange={(e) => setEdit({ ...edit, workAnniversary: e.target.value })} /></Field>
            {edit.role !== 'leadmanager' && (
              <>
                <Field label="Team"><select className={inputCls} value={edit.team || 'Bhubaneswar'} onChange={(e) => setEdit({ ...edit, team: e.target.value })}>{TEAMS.map((t) => <option key={t}>{t}</option>)}</select></Field>
                <Field label="Shift"><select className={inputCls} value={edit.shift || 'Morning'} onChange={(e) => setEdit({ ...edit, shift: e.target.value })}>{SHIFTS.map((s) => <option key={s}>{s}</option>)}</select></Field>
              </>
            )}
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
            {edit.role !== 'leadmanager' && (
              <>
                <div className="col-span-2"><Field label="Alias names" hint="Comma-separated"><input className={inputCls} value={Array.isArray(edit.aliases) ? edit.aliases.join(', ') : (edit.aliases || '')} onChange={(e) => setEdit({ ...edit, aliases: e.target.value })} /></Field></div>
                <TargetsAndReporting state={edit} patch={(p) => setEdit({ ...edit, ...p })} managers={managers.filter((m) => (m.id || m._id) !== (edit.id || edit._id))} allUsers={users} />
              </>
            )}
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
            <th className="px-4 py-3">Team / Shift</th><th className="px-4 py-3">Reports</th><th className="px-4 py-3">Email</th><th className="px-4 py-3"></th>
          </tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u._id} className={`border-t border-slate-100 ${!u.active ? 'opacity-40' : ''}`}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <AvatarPreview name={u.name} src={u.avatar} size={36} />
                    <div>
                      <div className="font-semibold" style={{ color: C.navy }}>{u.name} {(u._id === me.id || u._id === me._id) && <span className="text-[9px] font-bold text-slate-400">(you)</span>}</div>
                      <div className="text-[11px] text-slate-400">{u.designation}{u.phone ? ' · ' + u.phone : ''}{u.aliases && u.aliases.length ? ' · aka ' + u.aliases.join(', ') : ''}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">{u.email}</td>
                <td className="px-4 py-3"><span className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase" style={u.role === 'admin' ? { background: '#FFF4EC', color: C.orangeDeep } : { background: '#F1F5F9', color: '#64748B' }}>{u.role}</span></td>
                <td className="px-4 py-3 text-[11px] text-slate-500">{u.team || '—'}<br /><span className="text-slate-400">{u.shift || ''}</span></td>
                <td className="px-4 py-3 text-xs font-semibold">{u.reportsRun}</td>
                <td className="px-4 py-3">
                  {u.gmailConnected
                    ? <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase bg-green-100 text-green-700" title={u.gmailConnectedEmail || ''}>● Connected</span>
                    : <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase bg-slate-100 text-slate-400">○ Not connected</span>}
                </td>
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
      <PresalesTeamEditor
        items={cfg.presalesTeam || []} onChange={(l) => setList('presalesTeam', l)} />
      <StringListEditor title="Pre-sales email addresses"
        hint="Source inboxes a pre-sales lead can arrive from. Selectable as 'Generated from email' when adding a Pre-Sales lead. Visible only to lead managers and admins."
        items={cfg.presalesEmails || []} onChange={(l) => setList('presalesEmails', l)} />
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

// Pre-sales team members with an optional monthly lead-generation target. Data
// is stored as objects { name, monthlyTarget }, but older configs stored plain
// strings, so normalise both on read.
function PresalesTeamEditor({ items, onChange }) {
  const rows = (items || []).map((it) => (typeof it === 'string' ? { name: it, monthlyTarget: 0 } : { name: it.name || '', monthlyTarget: Number(it.monthlyTarget) || 0 }));
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');

  const add = () => {
    const v = name.trim();
    if (!v || rows.some((r) => r.name.toLowerCase() === v.toLowerCase())) return;
    onChange([...rows, { name: v, monthlyTarget: Number(target) || 0 }]);
    setName(''); setTarget('');
  };
  const setTargetFor = (i, val) => onChange(rows.map((r, j) => j === i ? { ...r, monthlyTarget: Number(val) || 0 } : r));
  const remove = (i) => onChange(rows.filter((_, j) => j !== i));

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5">
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-sm font-bold text-[#050A1F]">Pre-sales team members</div>
        <div className="text-[11px] text-slate-400">Name shows under “Generated by” for pre-sales leads. Monthly target drives the LM dashboard.</div>
      </div>
      <div className="space-y-2 mb-3">
        {rows.length === 0 && <span className="text-xs text-slate-300 italic">No team members yet.</span>}
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="flex-1 text-sm font-semibold text-slate-700">{r.name}</span>
            <label className="text-[11px] text-slate-400">Monthly target</label>
            <input type="number" min="0" value={r.monthlyTarget || ''} placeholder="0"
              onChange={(e) => setTargetFor(i, e.target.value)}
              className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
            <button onClick={() => remove(i)} className="text-slate-400 hover:text-red-500 px-1">✕</button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Team member name…"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
        <input type="number" min="0" value={target} onChange={(e) => setTarget(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Target"
          className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
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

// ImageKit connection panel — same keys the HR portal uses. Agent avatars in
// Site Analysis upload here instead of being stored as base64 in MySQL.
function ImageKitPanel({ say }) {
  const [cfg, setCfg] = useState({ publicKey: '', urlEndpoint: '', hasPrivateKey: false, configured: false });
  const [privateKey, setPrivateKey] = useState('');
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api('/admin/imagekit').then(setCfg).catch(() => {});
  useEffect(() => { load(); }, []);
  const save = async () => {
    setBusy(true); setStatus(null);
    try {
      const body = { publicKey: cfg.publicKey, urlEndpoint: cfg.urlEndpoint };
      if (privateKey.trim()) body.privateKey = privateKey.trim();
      const res = await api('/admin/imagekit', { method: 'PUT', body: JSON.stringify(body) });
      setStatus(res); setPrivateKey(''); load();
    } catch (e) { setStatus({ ok: false, message: e.message }); } finally { setBusy(false); }
  };
  return (
    <div className="max-w-2xl bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-bold text-sm" style={{ color: C.navy }}>ImageKit — image storage</h3>
        <span className={`text-[11px] font-bold rounded-full px-2.5 py-1 ${cfg.configured ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{cfg.configured ? 'Connected' : 'Not connected'}</span>
      </div>
      <p className="text-xs text-slate-500 mb-5">Agent profile photos upload here (folder <code>/qtonix-crm/avatars</code>) instead of being stored in the database. Shared with the HR portal.</p>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Public key"><input className={inputCls} value={cfg.publicKey} onChange={(e) => setCfg({ ...cfg, publicKey: e.target.value })} placeholder="public_xxxxxxxx" /></Field>
        <Field label="URL endpoint"><input className={inputCls} value={cfg.urlEndpoint} onChange={(e) => setCfg({ ...cfg, urlEndpoint: e.target.value })} placeholder="https://ik.imagekit.io/your_id" /></Field>
        <Field label="Private key"><input type="password" className={inputCls} value={privateKey} onChange={(e) => setPrivateKey(e.target.value)} placeholder={cfg.hasPrivateKey ? '••••••••' : 'private_xxxxxxxx'} /></Field>
      </div>
      {status && <div className={`mt-3 rounded-lg px-3 py-2.5 text-sm ${status.ok ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>{status.message}</div>}
      <div className="flex justify-end mt-4"><Btn onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save & test connection'}</Btn></div>
    </div>
  );
}

// Gmail (email) integration panel. Admin enters the OAuth app credentials once;
// each user then connects their own mailbox from the Users portal.
function EmailPanel({ say }) {
  const [cfg, setCfg] = useState({ configured: false, clientId: '', hasSecret: false, redirectUri: '' });
  const [secret, setSecret] = useState('');
  const [clientId, setClientId] = useState('');
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api('/gmail/config').then((c) => { setCfg(c); setClientId(c.clientId || ''); }).catch(() => {});
  useEffect(() => { load(); }, []);
  const save = async () => {
    setBusy(true); setStatus(null);
    try {
      const body = { clientId };
      if (secret.trim()) body.clientSecret = secret.trim();
      const res = await api('/gmail/config', { method: 'PUT', body: JSON.stringify(body) });
      setStatus(res); setSecret(''); load();
    } catch (e) { setStatus({ ok: false, message: e.message }); } finally { setBusy(false); }
  };
  return (
    <div className="max-w-2xl bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-bold text-sm" style={{ color: C.navy }}>Email — Gmail / Google Workspace</h3>
        <span className={`text-[11px] font-bold rounded-full px-2.5 py-1 ${cfg.configured ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{cfg.configured ? 'Configured' : 'Not configured'}</span>
      </div>
      <p className="text-xs text-slate-500 mb-4">Connect your Google Workspace so agents can read and reply to lead emails from the lead page. Set this up once; each person then connects their own mailbox.</p>

      <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 mb-4 text-xs text-slate-600 leading-relaxed">
        <div className="font-bold text-slate-700 mb-1">One-time setup (Workspace admin):</div>
        <ol className="list-decimal ml-4 space-y-0.5">
          <li>In Google Cloud Console, create a project and enable the <b>Gmail API</b>.</li>
          <li>Create an <b>OAuth 2.0 Client ID</b> (type: Web application).</li>
          <li>Add this <b>Authorized redirect URI</b>:</li>
        </ol>
        <div className="mt-2 flex items-center gap-2">
          <code className="flex-1 bg-white border border-slate-200 rounded px-2 py-1 text-[11px] break-all">{cfg.redirectUri || '—'}</code>
          <button onClick={() => { navigator.clipboard?.writeText(cfg.redirectUri); say && say('Redirect URI copied.'); }} className="text-[11px] font-bold text-blue-500 whitespace-nowrap">Copy</button>
        </div>
        {cfg.redirectUri && !cfg.baseUrlOk && (
          <div className="mt-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[11px] text-red-700">
            The server’s public URL isn’t set, so this redirect URI has no domain and Google will reject sign-in. Set the <code>APP_URL</code> environment variable to your public HTTPS address (e.g. <code>https://yourapp.up.railway.app</code>) and redeploy.
          </div>
        )}
        <div className="mt-2">Then paste the Client ID and Secret below.</div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <Field label="OAuth Client ID"><input className={inputCls} value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="xxxx.apps.googleusercontent.com" /></Field>
        <Field label="OAuth Client Secret"><input type="password" className={inputCls} value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={cfg.hasSecret ? '••••••••' : 'GOCSPX-…'} /></Field>
      </div>
      {status && <div className={`mt-3 rounded-lg px-3 py-2.5 text-sm ${status.ok ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>{status.message}</div>}
      <div className="flex justify-end mt-4"><Btn onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save credentials'}</Btn></div>

      <AdminMailboxes say={say} />
    </div>
  );
}

// Admin-only: link and manage additional mailboxes (accounts@, louis@, etc).
function AdminMailboxes({ say }) {
  const [data, setData] = useState(null);
  const [label, setLabel] = useState('');
  const load = () => api('/gmail/mailboxes').then(setData).catch(() => {});
  useEffect(() => {
    load();
    const onMsg = (e) => { if (e.data && e.data.gmail) load(); };
    window.addEventListener('message', onMsg); return () => window.removeEventListener('message', onMsg);
  }, []);
  const link = async () => {
    if (!label.trim()) return;
    try { const { url } = await api(`/gmail/connect?extra=1&label=${encodeURIComponent(label.trim())}`); window.open(url, 'gmail_oauth', 'width=520,height=640'); setLabel(''); }
    catch (e) { say && say(e.message); }
  };
  const remove = async (id) => { if (!confirm('Unlink this mailbox?')) return; try { await api(`/gmail/mailboxes/${id}`, { method: 'DELETE' }); load(); } catch { /* */ } };
  if (!data || !data.isAdmin) return null;
  const extras = (data.mailboxes || []).filter((m) => m.kind === 'extra');
  return (
    <div className="mt-6 border-t border-slate-100 pt-5">
      <div className="text-sm font-bold text-[#050A1F] mb-1">Additional mailboxes</div>
      <div className="text-xs text-slate-500 mb-3">Link shared inboxes like accounts@ or a colleague’s mailbox. Each shows up as a “From” option when composing.</div>
      <div className="space-y-2 mb-3">
        {extras.length === 0 && <div className="text-xs text-slate-400">No additional mailboxes linked yet.</div>}
        {extras.map((m) => (
          <div key={m._id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
            <div className="text-xs"><span className="font-bold text-[#050A1F]">{m.label}</span> <span className="text-slate-400">· {m.email}</span> {m.connected ? <span className="text-green-600 font-bold ml-1">● connected</span> : <span className="text-slate-300 ml-1">○</span>}</div>
            <button onClick={() => remove(m._id)} className="text-[11px] font-bold text-red-500">Remove</button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. Accounts)" className={inputCls} />
        <Btn onClick={link}>+ Link mailbox</Btn>
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

  const tabs = [['pricing', 'Pricing'], ['branding', 'Branding'], ['keys', 'API keys'], ['imagekit', 'ImageKit'], ['email', 'Email (Gmail)'], ['users', 'Users'], ['crm', 'CRM Fields'], ['targets', 'Monthly Targets'], ['tv', 'Motivator TV'], ['demo', 'Demo mode'], ['limits', 'Limits']];
  // Save applies to tabs backed by the settings object (not Users/CRM/TV, which save inline).
  const showSave = tab !== 'users' && tab !== 'crm' && tab !== 'tv' && tab !== 'imagekit' && tab !== 'email';

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
        {tab === 'imagekit' && <ImageKitPanel say={say} />}
        {tab === 'email' && <EmailPanel say={say} />}
        {tab === 'users' && <Users me={me} say={say} />}
        {tab === 'crm' && <CrmFields say={say} />}
        {tab === 'targets' && <MonthlyTargets say={say} />}
        {tab === 'tv' && <MotivatorTvSettings say={say} />}
        {tab === 'demo' && <DemoModeSettings say={say} />}
        {tab === 'limits' && <Limits settings={settings} setSettings={setSettings} />}

        <ActivityLog />
      </main>
    </div>
  );
}

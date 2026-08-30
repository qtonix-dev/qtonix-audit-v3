import React, { useState, useEffect } from 'react';
import { API_BASE } from './config.js';
import CrmSurveyAdmin from './CrmSurvey.jsx';
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

// Like `api`, but returns the raw response text (used for HTML email previews).
const apiRaw = async (path, opts = {}) => {
  const token = localStorage.getItem('qtx_token');
  const res = await fetch(API_BASE + '/api' + path, {
    ...opts,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error('Could not load preview.');
  return text;
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
  const [broken, setBroken] = useState(false);
  const initials = (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  if (src && !broken) return <img src={src} alt={name} onError={() => setBroken(true)} className="rounded-full object-cover border border-slate-200" style={{ width: size, height: size }} />;
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
// Report settings groups report Pricing and Report limits under a sub-nav.
function ReportSettings({ settings, setSettings, say, reload }) {
  const [sub, setSub] = useState('branding');
  return (
    <div>
      <div className="inline-flex items-center gap-1 bg-slate-100 rounded-lg p-1 mb-5">
        <button onClick={() => setSub('branding')}
          className={`px-4 py-1.5 rounded-md text-xs font-bold ${sub === 'branding' ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>Branding</button>
        <button onClick={() => setSub('pricing')}
          className={`px-4 py-1.5 rounded-md text-xs font-bold ${sub === 'pricing' ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>Pricing</button>
        <button onClick={() => setSub('limits')}
          className={`px-4 py-1.5 rounded-md text-xs font-bold ${sub === 'limits' ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>Report limits</button>
      </div>
      {sub === 'branding' ? <Branding settings={settings} setSettings={setSettings} say={say} reload={reload} />
        : sub === 'pricing' ? <PricingEditor settings={settings} setSettings={setSettings} say={say} />
        : <Limits settings={settings} setSettings={setSettings} />}
    </div>
  );
}

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
  // Logo/favicon are uploaded to ImageKit (persistent cloud storage) and the
  // full URL is saved on the settings record. This is essential on Railway,
  // whose local disk is wiped on every restart/redeploy — files saved to
  // ./storage/uploads vanish after a day, which is why the logo kept
  // disappearing. ImageKit URLs survive restarts.
  const upload = async (file, kind, maxKb) => {
    if (!file) return;
    if (file.size > maxKb * 1024) return say && say(`That file is ${Math.round(file.size / 1024)}KB — the limit is ${maxKb}KB.`, 'bad');
    try {
      // Prefer ImageKit; fall back to the legacy server-disk upload only if
      // ImageKit isn't configured (with a clear warning that it won't persist).
      let ik = null;
      try { ik = await api('/admin/imagekit'); } catch { ik = null; }
      if (ik && ik.configured) {
        const auth = await api('/admin/imagekit/auth');
        const form = new FormData();
        form.append('file', file);
        form.append('fileName', `${kind}-${Date.now()}`);
        form.append('folder', '/qtonix-crm/branding');
        form.append('publicKey', auth.publicKey);
        form.append('signature', auth.signature);
        form.append('expire', auth.expire);
        form.append('token', auth.token);
        form.append('useUniqueFileName', 'true');
        const res = await fetch('https://upload.imagekit.io/api/v1/files/upload', { method: 'POST', body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || 'Upload failed.');
        // Save the ImageKit URL onto settings (persists across restarts).
        await api('/admin/settings/branding-url', { method: 'POST', body: JSON.stringify({ kind, url: data.url }) });
        setSettings({ ...settings, [`${kind}Path`]: data.url });
        say && say(`${kind} uploaded`, 'good');
        reload && reload();
        return;
      }
      // No ImageKit → legacy disk upload (works, but WON'T survive a redeploy).
      const fd = new FormData();
      fd.append(kind, file);
      const r = await api(`/admin/settings/${kind}`, { method: 'POST', body: fd });
      setSettings({ ...settings, [`${kind}Path`]: r[`${kind}Path`] });
      say && say(`${kind} uploaded — but connect ImageKit (API keys tab) so it isn't lost on the next server restart.`, 'bad');
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

      {/* Company social links — universal, auto-pulled into every agent/manager
          email signature. */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="text-sm font-bold text-[#050A1F] mb-1">Social media links</div>
        <div className="text-xs text-slate-400 mb-4">Used in email signatures for everyone. Agents add their own Calendly link separately in their profile.</div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="LinkedIn"><input className={inputCls} placeholder="https://linkedin.com/company/…" value={(settings.socialLinks && settings.socialLinks.linkedin) || ''} onChange={(e) => setSettings({ ...settings, socialLinks: { ...(settings.socialLinks || {}), linkedin: e.target.value } })} /></Field>
          <Field label="Facebook"><input className={inputCls} placeholder="https://facebook.com/…" value={(settings.socialLinks && settings.socialLinks.facebook) || ''} onChange={(e) => setSettings({ ...settings, socialLinks: { ...(settings.socialLinks || {}), facebook: e.target.value } })} /></Field>
          <Field label="Instagram"><input className={inputCls} placeholder="https://instagram.com/…" value={(settings.socialLinks && settings.socialLinks.instagram) || ''} onChange={(e) => setSettings({ ...settings, socialLinks: { ...(settings.socialLinks || {}), instagram: e.target.value } })} /></Field>
          <Field label="Website (social)" hint="Shown in signatures; can match the site above"><input className={inputCls} placeholder="https://www.qtonix.com" value={(settings.socialLinks && settings.socialLinks.website) || ''} onChange={(e) => setSettings({ ...settings, socialLinks: { ...(settings.socialLinks || {}), website: e.target.value } })} /></Field>
        </div>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Demo / training mode
// ---------------------------------------------------------------------------
function DomainsSettings({ say }) {
  const SURFACES = [
    { key: 'careers', label: 'Careers, Jobs, Task & Onboarding', example: 'career.qtonix.com', desc: 'All public candidate-facing pages: the careers listing, individual job posts, assessment task uploads, and onboarding.' },
    { key: 'hrms', label: 'HRMS (HR portal)', example: 'people.qtonix.com', desc: 'The internal HR portal your team logs into.' },
    { key: 'crm', label: 'Sales CRM', example: 'crmnest.com', desc: 'The Sales CRM app.' },
    { key: 'reports', label: 'Analysis Reports', example: 'reports.qtonix.com', desc: 'Public shareable Site-Analysis report links.' },
  ];
  const [domains, setDomains] = useState(null);
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState({}); // { key: {status, result} }

  const load = () => api('/admin/domains').then((r) => setDomains(r.domains)).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async () => {
    setBusy(true);
    try { const r = await api('/admin/domains', { method: 'PUT', body: JSON.stringify({ domains }) }); setDomains(r.domains); say && say('Domains saved', 'good'); }
    catch (e) { say && say(e.message, 'bad'); }
    setBusy(false);
  };
  const check = async (key) => {
    setChecks((c) => ({ ...c, [key]: { status: 'checking' } }));
    try { const r = await api('/admin/domains/check', { method: 'POST', body: JSON.stringify({ domain: domains[key] }) }); setChecks((c) => ({ ...c, [key]: { status: 'done', result: r } })); }
    catch (e) { setChecks((c) => ({ ...c, [key]: { status: 'done', result: { ok: false, message: e.message } } })); }
  };

  if (!domains) return <div className="text-slate-400 text-sm py-8">Loading…</div>;
  const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';

  const hostOf = (v) => { try { return new URL(/^https?:/.test(v) ? v : 'https://' + v).host; } catch { return v; } };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="text-sm font-bold" style={{ color: C.navy }}>Custom domains</div>
        <p className="text-[11px] text-slate-400 mt-0.5">Point each part of the product at your own domain. Once set, every link the app generates — share links, emails, SEO tags, QR codes — uses these automatically. Leave blank to keep using the current address.</p>
      </div>

      {SURFACES.map((sfc) => {
        const chk = checks[sfc.key];
        const r = chk && chk.result;
        return (
          <div key={sfc.key} className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="text-sm font-bold" style={{ color: C.navy }}>{sfc.label}</div>
            <p className="text-[11px] text-slate-400 mt-0.5 mb-2.5">{sfc.desc}</p>
            <div className="flex gap-2 items-center">
              <input className={inputCls} value={domains[sfc.key] || ''} onChange={(e) => setDomains({ ...domains, [sfc.key]: e.target.value })} placeholder={sfc.example} />
              <button onClick={() => check(sfc.key)} disabled={!domains[sfc.key] || (chk && chk.status === 'checking')} className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-600 disabled:opacity-40">{chk && chk.status === 'checking' ? 'Checking…' : 'Check'}</button>
            </div>
            {r && (
              <div className={`mt-2 rounded-lg px-3 py-2 text-[12px] flex items-start gap-2 ${r.ok ? 'bg-green-50 border border-green-200 text-green-700' : r.reachable ? 'bg-amber-50 border border-amber-200 text-amber-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                <span>{r.ok ? '✓' : r.reachable ? '⚠' : '✕'}</span>
                <span>{r.message}{r.version ? ` (v${r.version})` : ''}</span>
              </div>
            )}
            {domains[sfc.key] && (
              <div className="mt-2 text-[11px] text-slate-500">
                DNS: add a <span className="font-mono font-bold">CNAME</span> for <span className="font-mono font-bold">{hostOf(domains[sfc.key])}</span> → your Railway target, and add this domain in Railway → Settings → Networking.
              </div>
            )}
          </div>
        );
      })}

      <div className="flex justify-end">
        <Btn onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save domains'}</Btn>
      </div>

      <div className="bg-slate-50 rounded-xl border border-slate-200 p-5">
        <div className="text-sm font-bold mb-2" style={{ color: C.navy }}>How to connect a domain (one-time setup)</div>
        <ol className="text-[12px] text-slate-600 space-y-1.5 list-decimal pl-5">
          <li>In <b>Railway → your service → Settings → Networking → Custom Domain</b>, add the domain (e.g. <span className="font-mono">career.qtonix.com</span>). Railway shows you a <b>CNAME target</b> (like <span className="font-mono">xxxx.up.railway.app</span>).</li>
          <li>In your <b>DNS provider</b> (where qtonix.com is managed), add a <b>CNAME</b> record: host = the subdomain (<span className="font-mono">career</span>), value = the Railway target. For a root domain like <span className="font-mono">crmnest.com</span>, use your provider's ALIAS/ANAME (or an A record to Railway's IP if they require it).</li>
          <li>Wait for DNS to propagate (usually minutes, up to ~an hour). Railway auto-issues an SSL certificate once it sees the record.</li>
          <li>Enter the domain in the field above, click <b>Check</b> — green means it's pointing here and serving over HTTPS.</li>
          <li>Click <b>Save domains</b>. Done — the app now uses it everywhere.</li>
        </ol>
      </div>
    </div>
  );
}

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

// Wraps the monthly targets table + the incentive settings under one tab with
// a Targets / Incentive sub-nav.
function TargetsAndIncentive({ say, settings, setSettings }) {
  const [sub, setSub] = useState('targets');
  return (
    <div>
      <div className="inline-flex items-center gap-1 bg-slate-100 rounded-lg p-1 mb-5">
        <button onClick={() => setSub('targets')}
          className={`px-4 py-1.5 rounded-md text-xs font-bold ${sub === 'targets' ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>Targets</button>
        <button onClick={() => setSub('incentive')}
          className={`px-4 py-1.5 rounded-md text-xs font-bold ${sub === 'incentive' ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>💰 Incentive</button>
      </div>
      {sub === 'targets' ? <MonthlyTargets say={say} /> : <IncentiveSettings say={say} />}
    </div>
  );
}

// Incentive settings — the rule percentages + USD→INR rate, saved into crmConfig.
function IncentiveSettings({ say }) {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { api('/admin/settings').then((s) => setCfg(s.crmConfig || {})).catch((e) => say(e.message, true)); }, []);
  if (!cfg) return <div className="text-slate-400 text-sm py-8">Loading…</div>;
  const inc = { eligibilityPct: 90, agentBasePct: 1.5, agentOverPct: 5, managerOverPct: 5, usdToInr: 83, ...(cfg.incentives || {}) };
  const set = (k, v) => setCfg({ ...cfg, incentives: { ...inc, [k]: Number(v) || 0 } });
  const save = async () => {
    setSaving(true);
    try { await api('/admin/settings', { method: 'PUT', body: JSON.stringify({ crmConfig: cfg }) }); say('Incentive settings saved.'); }
    catch (e) { say(e.message, true); }
    setSaving(false);
  };
  const numCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
  const th = { achieved: 100, close: 70, focus: 50, ...(cfg.summaryThresholds || {}) };
  const setTh = (k, v) => setCfg({ ...cfg, summaryThresholds: { ...th, [k]: Number(v) || 0 } });
  return (
    <div>
      <h2 className="text-lg font-extrabold mb-1" style={{ color: C.navy }}>Incentive settings</h2>
      <p className="text-sm text-slate-500 mb-4">These rules drive the Incentives table under Team review (admin-only). Incentives are computed in USD, then converted to INR with the rate below.</p>
      <div className="bg-white rounded-2xl border border-slate-100 p-5 max-w-2xl">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Field label="Eligibility threshold %" hint="Agent qualifies at ≥ this % of target">
            <input type="number" min="0" step="0.1" className={numCls} value={inc.eligibilityPct} onChange={(e) => set('eligibilityPct', e.target.value)} />
          </Field>
          <Field label="Agent base %" hint="% of achieved (capped at target)">
            <input type="number" min="0" step="0.1" className={numCls} value={inc.agentBasePct} onChange={(e) => set('agentBasePct', e.target.value)} />
          </Field>
          <Field label="Agent over-achievement %" hint="% of amount above target">
            <input type="number" min="0" step="0.1" className={numCls} value={inc.agentOverPct} onChange={(e) => set('agentOverPct', e.target.value)} />
          </Field>
          <Field label="Manager over-achievement %" hint="% of team amount above team target">
            <input type="number" min="0" step="0.1" className={numCls} value={inc.managerOverPct} onChange={(e) => set('managerOverPct', e.target.value)} />
          </Field>
          <Field label="USD → INR rate" hint="e.g. 83 means $1 = ₹83">
            <input type="number" min="0" step="0.01" className={numCls} value={inc.usdToInr} onChange={(e) => set('usdToInr', e.target.value)} />
          </Field>
        </div>
        <div className="mt-5 rounded-xl bg-slate-50 border border-slate-100 p-4 text-xs text-slate-500 leading-relaxed">
          <b className="text-slate-600">How it's calculated</b><br />
          <b>Agent</b> (own target vs achieved): eligible if achieved ≥ {inc.eligibilityPct}% of target. Incentive 1 = {inc.agentBasePct}% of achieved (capped at target). Incentive 2 = {inc.agentOverPct}% of the amount over target.<br />
          <b>Manager</b> (team target vs team achieved): {inc.managerOverPct}% of the team's over-achievement. Team target = agents' targets + manager's own. A manager with no team falls under the agent rules.
        </div>
        <div className="flex justify-end mt-4">
          <Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save incentive settings'}</Btn>
        </div>
      </div>

      <h2 className="text-lg font-extrabold mt-8 mb-1" style={{ color: C.navy }}>Monthly summary email tiers</h2>
      <p className="text-sm text-slate-500 mb-4">The monthly team-summary email's tone depends on the team's % of target (team sales only — admin sales are never counted). Set the cut-offs that decide which message goes out.</p>
      <div className="bg-white rounded-2xl border border-slate-100 p-5 max-w-2xl">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Achieved ≥ %" hint="Celebratory “we hit target” email">
            <input type="number" min="0" step="1" className={numCls} value={th.achieved} onChange={(e) => setTh('achieved', e.target.value)} />
          </Field>
          <Field label="Close ≥ %" hint="Upbeat near-miss email">
            <input type="number" min="0" step="1" className={numCls} value={th.close} onChange={(e) => setTh('close', e.target.value)} />
          </Field>
          <Field label="Focus ≥ %" hint="Focused-push email; below this → honest but encouraging">
            <input type="number" min="0" step="1" className={numCls} value={th.focus} onChange={(e) => setTh('focus', e.target.value)} />
          </Field>
        </div>
        <div className="mt-5 rounded-xl bg-slate-50 border border-slate-100 p-4 text-xs text-slate-500 leading-relaxed">
          <b className="text-slate-600">Which email is sent</b><br />
          Team reaches <b>≥ {th.achieved}%</b> → <span className="font-semibold" style={{ color: '#0F9D58' }}>Achieved</span> (celebratory).<br />
          <b>{th.close}%–{th.achieved - 1}%</b> → <span className="font-semibold" style={{ color: '#0EA5E9' }}>Close</span> (near miss, upbeat).<br />
          <b>{th.focus}%–{th.close - 1}%</b> → <span className="font-semibold" style={{ color: '#F59E0B' }}>Focus</span> (a focused push gets there).<br />
          Below <b>{th.focus}%</b> → <span className="font-semibold" style={{ color: '#EF4444' }}>Low</span> (honest but encouraging).
        </div>
        <div className="flex justify-end mt-4">
          <Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save summary tiers'}</Btn>
        </div>
      </div>
    </div>
  );
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
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
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
  const [usage, setUsage] = useState(null); // self-tracked calls (anthropic/openai)
  const [ikUsage, setIkUsage] = useState(null);
  const [seDiag, setSeDiag] = useState(null);
  const [seDiagDomain, setSeDiagDomain] = useState('');
  const runSeDiag = async () => {
    setSeDiag({ loading: true });
    try {
      const q = seDiagDomain ? `?domain=${encodeURIComponent(seDiagDomain)}` : '';
      const r = await api(`/admin/seranking-diagnose${q}`);
      setSeDiag(r);
    } catch (e) { setSeDiag({ error: e.message }); }
  };
  useEffect(() => { api('/admin/seranking-credits').then(setCredits).catch(() => setCredits(null)); }, []);
  useEffect(() => { api('/admin/api-usage').then((r) => setUsage(r.usage || {})).catch(() => setUsage({})); }, []);
  useEffect(() => { api('/admin/imagekit-usage').then(setIkUsage).catch(() => setIkUsage(null)); }, []);
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

  const [sub, setSub] = useState('api');
  const SubBtn = ({ id, label }) => (
    <button onClick={() => setSub(id)} className={`px-4 py-1.5 rounded-md text-xs font-bold ${sub === id ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>{label}</button>
  );

  return (
    <div>
      <div className="inline-flex items-center gap-1 bg-slate-100 rounded-lg p-1 mb-5">
        <SubBtn id="api" label="API" />
        <SubBtn id="callhippo" label="CallHippo" />
        <SubBtn id="gmail" label="Gmail" />
      </div>

      {sub === 'gmail' && <EmailPanel say={say} />}

      {sub === 'callhippo' && (
        <div className="max-w-2xl">
          <div className="text-sm font-bold text-[#050A1F] mb-2">CallHippo (calls)</div>
          <CallHippoPanel settings={settings} setSettings={setSettings} say={say} />
        </div>
      )}

      {sub === 'api' && (
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
            <div className="flex items-stretch gap-2">
              <input type="password" className={inputCls} value={settings.apiKeys[id] || ''} placeholder="Paste key…" onChange={(e) => { setSettings({ ...settings, apiKeys: { ...settings.apiKeys, [id]: e.target.value } }); setTests((x) => ({ ...x, [id]: null })); }} />
              <Btn size="sm" variant="ghost" onClick={() => test(id)} disabled={t && t.testing} className="shrink-0">{t && t.testing ? 'Testing…' : 'Test'}</Btn>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">{r.hint}</p>
            {id === 'seranking' && credits && (
              <div className="mt-2 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
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
                {credits.remaining == null && (
                  <div className="text-[10px] text-slate-400 mt-1.5">Live balance unavailable from SE Ranking{credits.error ? ` (${credits.error})` : ''} — "used" figures are tracked from reports you've run.</div>
                )}
                <div className="mt-2 pt-2 border-t border-slate-200">
                  <div className="flex items-center gap-2">
                    <input className={inputCls + ' text-xs'} placeholder="Domain to test (e.g. example.com)" value={seDiagDomain} onChange={(e) => setSeDiagDomain(e.target.value)} />
                    <Btn size="sm" variant="ghost" onClick={runSeDiag} disabled={seDiag && seDiag.loading}>{seDiag && seDiag.loading ? 'Checking…' : 'Diagnose'}</Btn>
                  </div>
                  {seDiag && !seDiag.loading && (
                    <div className="mt-2 space-y-1">
                      {seDiag.error && <div className="text-xs text-red-500">{seDiag.error}</div>}
                      {seDiag.steps && Object.entries(seDiag.steps).map(([k, v]) => (
                        <div key={k} className="text-[11px] flex items-start gap-2">
                          <span className={v.ok ? 'text-green-600 font-bold' : 'text-red-500 font-bold'}>{v.ok ? '✓' : '✗'}</span>
                          <div className="flex-1 min-w-0">
                            <span className="font-bold text-slate-600">{k}</span>
                            {v.ok
                              ? <span className="text-slate-400"> · {v.ms}ms · <code className="break-all">{v.sample}</code></span>
                              : <span className="text-red-500"> · {v.status ? `HTTP ${v.status} · ` : ''}{v.error}{v.body ? ` · ${v.body}` : ''}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            {(id === 'anthropic' || id === 'openai') && usage && (
              <div className="mt-2 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                <div className="flex items-center gap-4 flex-wrap">
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Calls this month</div>
                    <div className="text-base font-extrabold text-[#FF4500]">{Number((usage[id] && usage[id].month) || 0).toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Calls all time</div>
                    <div className="text-base font-extrabold text-slate-500">{Number((usage[id] && usage[id].total) || 0).toLocaleString()}</div>
                  </div>
                </div>
                <div className="text-[10px] text-slate-400 mt-1.5">{RULES[id].label} doesn't expose a billable balance — this counts calls the CRM made. Check your provider console for spend.</div>
              </div>
            )}
            {t && !t.testing && <div className={`mt-2 text-[11px] font-medium ${t.ok ? 'text-green-600' : 'text-red-600'}`}>{t.ok ? '✓ ' : '✗ '}{t.msg}</div>}
          </div>
        );
      })}

      {/* ImageKit lives here too, so all external services are on one page. */}
      <div className="pt-2 border-t border-slate-200">
        <div className="text-sm font-bold text-[#050A1F] mb-2">ImageKit (image hosting)</div>
        <ImageKitPanel say={say} usage={ikUsage} />
      </div>
    </div>
      )}
    </div>
  );
}

// CallHippo integration panel: stores the API token (encrypted, saved with the
// main Save button via settings.apiKeys) and shows the webhook URL to paste into
// CallHippo's Integrations → REST API → Webhook → Calling Activity.
function CallHippoPanel({ settings, setSettings, say }) {
  const [cfg, setCfg] = useState(null);
  const [copied, setCopied] = useState(false);
  const [test, setTest] = useState(null);
  const [numbers, setNumbers] = useState(null);
  const [imp, setImp] = useState(null);
  const [sync, setSync] = useState(null);
  const [poll, setPoll] = useState(null);
  useEffect(() => { api('/admin/callhippo').then(setCfg).catch(() => setCfg(null)); }, []);
  const tokenVal = (settings.apiKeys && settings.apiKeys.callHippoToken) || '';
  const copy = () => {
    if (!cfg || !cfg.webhookUrl) return;
    navigator.clipboard.writeText(cfg.webhookUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  };
  const testToken = async () => {
    setTest({ testing: true });
    try {
      const r = await api('/admin/settings/test-key', { method: 'POST', body: JSON.stringify({ service: 'callHippoToken', key: tokenVal }) });
      setTest({ ok: !!r.ok, msg: r.ok ? (r.detail || 'Token is valid.') : (r.error || 'Failed') });
    } catch (e) { setTest({ ok: false, msg: e.message }); }
  };
  const verifyNumbers = async () => {
    setNumbers({ loading: true });
    try {
      const r = await api('/callhippo/numbers');
      setNumbers({ list: r.numbers || [], liveError: r.liveError, hasToken: r.hasToken, savedManualCount: r.savedManualCount, manualWithNumber: r.manualWithNumber });
    } catch (e) { setNumbers({ error: e.message }); }
  };
  const importContacts = async () => {
    setImp({ loading: true });
    try {
      const r = await api('/callhippo/import-contacts', { method: 'POST', body: JSON.stringify({}) });
      setImp({ imported: r.imported || 0, failed: r.failed || 0, total: r.total || 0, error: r.error });
    } catch (e) { setImp({ error: e.message }); }
  };
  const syncUsers = async () => {
    setSync({ loading: true });
    try {
      const r = await api('/callhippo/sync-users', { method: 'POST', body: JSON.stringify({}) });
      setSync({ matched: r.matched || 0, total: r.total || 0, unmatched: r.unmatched || [] });
    } catch (e) { setSync({ error: e.message }); }
  };
  const pollNow = async () => {
    setPoll({ loading: true });
    try {
      const r = await api('/callhippo/poll-now', { method: 'POST', body: JSON.stringify({}) });
      setPoll({ processed: r.processed, skipped: r.skipped, error: r.error });
    } catch (e) { setPoll({ error: e.message }); }
  };
  return (
    <div className="max-w-2xl bg-white rounded-xl border border-slate-200 p-5">
      <p className="text-xs text-slate-500 mb-4">Logs every inbound and outbound call onto the matching lead's timeline. Paste the webhook URL below into CallHippo → Integrations → REST API → Webhook, enable <b>Calling Activity</b>, and save. Set each agent's CallHippo email on their user profile so calls are credited correctly.</p>

      <Field label="CallHippo API token" hint="Stored encrypted. Regenerate in CallHippo if it's ever exposed.">
        <input className={inputCls} type="password" value={tokenVal}
          onChange={(e) => setSettings({ ...settings, apiKeys: { ...(settings.apiKeys || {}), callHippoToken: e.target.value } })}
          placeholder="Paste API token" />
      </Field>
      <Field label="CallHippo auth token (optional)" hint="Some CallHippo API calls (dial, contact add) also need a session authToken. Paste it here if dialing/import fails without it.">
        <input className={inputCls} type="password" value={(settings.apiKeys && settings.apiKeys.callHippoAuthToken) || ''}
          onChange={(e) => setSettings({ ...settings, apiKeys: { ...(settings.apiKeys || {}), callHippoAuthToken: e.target.value } })}
          placeholder="Paste auth token (optional)" />
      </Field>
      <div className="flex items-center gap-2 mt-2">
        <Btn size="sm" className="shrink-0 whitespace-nowrap" onClick={testToken} disabled={!tokenVal || (test && test.testing)}>{test && test.testing ? 'Testing…' : 'Test token'}</Btn>
        {test && !test.testing && <span className={`text-[11px] font-medium ${test.ok ? 'text-green-600' : 'text-red-600'}`}>{test.ok ? '✓ ' : '✗ '}{test.msg}</span>}
      </div>

      <div className="mt-4">
        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Webhook URL (paste into CallHippo)</div>
        <div className="flex items-stretch gap-2">
          <input readOnly className={`${inputCls} font-mono text-xs bg-slate-50`} value={cfg ? cfg.webhookUrl : 'Loading…'} onFocus={(e) => e.target.select()} />
          <Btn onClick={copy} disabled={!cfg} className="shrink-0">{copied ? 'Copied' : 'Copy'}</Btn>
        </div>
        {cfg && <div className="text-[11px] text-slate-400 mt-1.5">Token status: {cfg.hasToken ? '✓ saved' : 'not saved yet'} · SMS is intentionally not logged.</div>}
      </div>

      {/* Verify the numbers agents will see (live from CallHippo + manual list). */}
      <div className="mt-4 pt-4 border-t border-slate-100">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Outbound numbers</div>
          <Btn size="sm" className="shrink-0 whitespace-nowrap" onClick={verifyNumbers} disabled={numbers && numbers.loading}>{numbers && numbers.loading ? 'Checking…' : 'Verify numbers'}</Btn>
        </div>
        {numbers && !numbers.loading && (
          <div className="mt-2 text-xs">
            {numbers.error ? <span className="text-red-500">{numbers.error}</span> : (
              <>
                {(numbers.list || []).length === 0
                  ? (
                    <span className="text-amber-600">
                      {numbers.savedManualCount === 0
                        ? 'No numbers saved yet. Add them under CRM Fields → CallHippo numbers, then click "Save CRM fields".'
                        : numbers.manualWithNumber === 0
                          ? `You have ${numbers.savedManualCount} saved entr${numbers.savedManualCount === 1 ? 'y' : 'ies'} but none has a phone number filled in. Re-enter them in the new CallHippo numbers editor (the old format didn't store the number) and Save.`
                          : 'No numbers found. Add them under CRM Fields → CallHippo numbers, and/or ensure the token has telephony access.'}
                    </span>
                  )
                  : (
                    <div className="rounded-lg bg-slate-50 border border-slate-100 p-2 space-y-1">
                      {numbers.list.map((n, i) => (
                        <div key={i} className="flex items-center justify-between">
                          <span className="text-slate-600">{n.label ? `${n.label} — ` : ''}<span className="font-mono">{n.number}</span></span>
                          <span className="text-[10px] text-slate-400">{n.source === 'callhippo' ? 'live' : 'manual'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                {numbers.liveError && <div className="text-[11px] text-slate-400 mt-1">Live fetch note: {numbers.liveError} (manual numbers still work).</div>}
              </>
            )}
          </div>
        )}
      </div>

      {/* Import CRM leads into CallHippo as contacts, so inbound calls show the
          lead's name in the agent's dialer. */}
      <div className="mt-4 pt-4 border-t border-slate-100">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Contacts</div>
            <div className="text-[11px] text-slate-400">Push leads (with a phone number) to CallHippo so inbound calls show the lead name.</div>
          </div>
          <Btn size="sm" className="shrink-0 whitespace-nowrap" onClick={importContacts} disabled={imp && imp.loading}>{imp && imp.loading ? 'Importing…' : 'Import leads'}</Btn>
        </div>
        {imp && !imp.loading && (
          <div className={`mt-2 text-xs ${imp.error ? 'text-red-500' : 'text-green-600'}`}>
            {imp.error ? imp.error : `Imported ${imp.imported} of ${imp.total} lead(s)${imp.failed ? `, ${imp.failed} failed` : ''}.`}
          </div>
        )}
      </div>

      {/* Sync CallHippo users → auto-map to QHub users (email → agentId + ext). */}
      <div className="mt-4 pt-4 border-t border-slate-100">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Agent mapping</div>
            <div className="text-[11px] text-slate-400">Match CallHippo users to QHub users by email, storing their CallHippo ID + extension so calls credit correctly.</div>
          </div>
          <Btn size="sm" className="shrink-0 whitespace-nowrap" onClick={syncUsers} disabled={sync && sync.loading}>{sync && sync.loading ? 'Syncing…' : 'Sync CallHippo users'}</Btn>
        </div>
        {sync && !sync.loading && (
          <div className={`mt-2 text-xs ${sync.error ? 'text-red-500' : 'text-green-600'}`}>
            {sync.error ? sync.error : `Matched ${sync.matched} of ${sync.total} CallHippo user(s).`}
            {sync.unmatched && sync.unmatched.length > 0 && (
              <div className="text-amber-600 mt-1">No QHub match for: {sync.unmatched.map((u) => u.email).join(', ')}</div>
            )}
          </div>
        )}
      </div>

      {/* Poll the activity feed on demand (also runs every 2 min automatically). */}
      <div className="mt-4 pt-4 border-t border-slate-100">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Call sync</div>
            <div className="text-[11px] text-slate-400">Completed calls are pulled from CallHippo's activity feed every 2 minutes (backup for the webhook). Poll now to test.</div>
          </div>
          <Btn size="sm" className="shrink-0 whitespace-nowrap" onClick={pollNow} disabled={poll && poll.loading}>{poll && poll.loading ? 'Polling…' : 'Poll now'}</Btn>
        </div>
        {poll && !poll.loading && (
          <div className={`mt-2 text-xs ${poll.error ? 'text-red-500' : 'text-green-600'}`}>
            {poll.error ? `Error: ${poll.error}` : poll.skipped ? `Skipped (${poll.skipped}).` : `Recorded ${poll.processed || 0} new call(s).`}
          </div>
        )}
      </div>
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
  const agentsSum = teamAgents.reduce((s, a) => s + Number((a.targets && a.targets.sales && a.targets.sales.monthly) || 0), 0);
  // The team target = agents' monthly sales targets + the manager's OWN monthly
  // sales target. The manager's own figure lives on this form's live state (t),
  // so the sum updates immediately as it's typed.
  const managerOwn = Number((t.sales && t.sales.monthly) || 0);
  const teamSum = agentsSum + managerOwn;

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
                  <tr className="border-t border-slate-100 bg-orange-50/40">
                    <td className="px-3 py-1.5 font-semibold text-slate-700">{state.name || 'This manager'} <span className="text-[10px] text-orange-500 font-bold">(own)</span></td>
                    <td className="px-3 py-1.5 text-slate-500">Manager</td>
                    <td className="px-3 py-1.5 text-slate-500">—</td>
                    <td className="px-3 py-1.5 text-slate-500">${managerOwn.toLocaleString()}</td>
                  </tr>
                  <tr className="border-t border-slate-200 bg-slate-50 font-bold">
                    <td className="px-3 py-1.5" colSpan={3}>Team total (agents + manager)</td>
                    <td className="px-3 py-1.5">${teamSum.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-100 overflow-hidden">
              <table className="w-full text-xs">
                <tbody>
                  <tr className="bg-orange-50/40">
                    <td className="px-3 py-1.5 font-semibold text-slate-700">{state.name || 'This manager'} <span className="text-[10px] text-orange-500 font-bold">(own)</span></td>
                    <td className="px-3 py-1.5 text-slate-500 text-right">${managerOwn.toLocaleString()}</td>
                  </tr>
                  <tr className="border-t border-slate-200 bg-slate-50 font-bold">
                    <td className="px-3 py-1.5">Team total</td>
                    <td className="px-3 py-1.5 text-right">${teamSum.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
              <div className="text-[11px] text-slate-300 italic px-3 py-1.5">No agents report to this manager yet — the team target is just the manager's own target.</div>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!t.team.override} onChange={(e) => setT({ team: { ...t.team, enabled: true, override: e.target.checked, monthly: e.target.checked ? (t.team.monthly || teamSum) : teamSum } })} />
            <span className="text-slate-600">Manually override the team target</span>
            <input type="number" min="0" disabled={!t.team.override}
              className="w-40 rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:bg-slate-50 disabled:text-slate-400"
              value={t.team.override ? (t.team.monthly || '') : teamSum}
              onChange={(e) => setT({ team: { ...t.team, enabled: true, monthly: Number(e.target.value) || 0 } })} />
          </label>
          <p className="text-[11px] text-slate-400">Without an override, the team target auto-updates as agents join, leave, or change their sales targets.</p>

          {/* Manager's OWN monthly sales target — added to the team target
              (team target = agents' targets + this). When the team target isn't
              manually overridden, editing this immediately re-sums the team. */}
          <div className="pt-2 border-t border-slate-100">
            <Field label="Manager's own monthly sales target (USD)" hint="Added to the team monthly sales target">
              <input type="number" min="0" className={numCls} value={t.sales.monthly || ''} onChange={(e) => {
                const own = Number(e.target.value) || 0;
                const nextSales = { ...t.sales, enabled: true, monthly: own };
                // Keep the (non-overridden) team target in sync = agents + own.
                const nextTeam = t.team.override ? t.team : { ...t.team, enabled: true, monthly: agentsSum + own };
                setT({ sales: nextSales, team: nextTeam });
              }} placeholder="e.g. 2000" />
            </Field>
          </div>
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
  const blank = { name: '', email: '', password: '', role: 'agent', jobType: 'bde', managerId: null, phone: '+91 ', designation: 'Sales Executive', birthday: '', joiningDate: '', maritalStatus: '', anniversary: '', canViewConverted: false, team: 'Bhubaneswar', shift: 'Morning', aliases: '', targets: { transfer: { enabled: false, daily: 0, monthly: 0 }, sales: { enabled: false, monthly: 0 }, team: { enabled: false, monthly: 0 }, leadGen: { enabled: false, monthly: 0 } } };
  const [users, setUsers] = useState([]);
  const [f, setF] = useState(blank);
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(null);
  const [deleting, setDeleting] = useState(null);
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
      await api('/admin/users', { method: 'POST', body: JSON.stringify({ ...f, callHippoEmail: f.callHippoEmail || null, aliases: f.aliases.split(',').map((a) => a.trim()).filter(Boolean) }) });
      setF(blank); setShow(false); load(); say && say(`User created: ${f.name}`, 'good');
    } catch (e) { setErr(e.message); }
  };

  const save = async () => {
    setErr('');
    if (edit.newPassword && edit.newPassword.length < 8) return setErr('Password must be at least 8 characters.');
    try {
      const body = { name: edit.name, email: edit.email, role: edit.role, jobType: edit.jobType, managerId: edit.managerId, targets: edit.targets, avatar: edit.avatar, phone: edit.phone, designation: edit.designation, birthday: edit.birthday || null, joiningDate: edit.joiningDate || null, maritalStatus: edit.maritalStatus || null, anniversary: edit.anniversary || null, canViewConverted: !!edit.canViewConverted, team: edit.team, shift: edit.shift, managerScopes: edit.managerScopes || [], callHippoEmail: edit.callHippoEmail || null, aliases: Array.isArray(edit.aliases) ? edit.aliases : String(edit.aliases || '').split(',').map((a) => a.trim()).filter(Boolean) };
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
            <Field label="Joining date" hint="Drives the work-anniversary celebration"><input type="date" className={inputCls} value={f.joiningDate || ''} onChange={(e) => setF({ ...f, joiningDate: e.target.value })} /></Field>
            <Field label="Marital status">
              <select className={inputCls} value={f.maritalStatus || ''} onChange={(e) => setF({ ...f, maritalStatus: e.target.value, anniversary: e.target.value === 'married' ? f.anniversary : '' })}>
                <option value="">Not specified</option>
                <option value="single">Single</option>
                <option value="married">Married</option>
              </select>
            </Field>
            {f.maritalStatus === 'married' && (
              <Field label="Marriage anniversary"><input type="date" className={inputCls} value={f.anniversary || ''} onChange={(e) => setF({ ...f, anniversary: e.target.value })} /></Field>
            )}
            {(f.role === 'agent' || f.role === 'manager') && (
              <div className="col-span-2">
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input type="checkbox" checked={!!f.canViewConverted} onChange={(e) => setF({ ...f, canViewConverted: e.target.checked })} />
                  Can view Converted clients (their own only)
                </label>
              </div>
            )}
            {/* A lead manager coordinates intake only — no team, shift, alias,
                designation or targets apply to them. */}
            {f.role !== 'leadmanager' && (
              <>
                <Field label="Team"><select className={inputCls} value={f.team} onChange={(e) => setF({ ...f, team: e.target.value })}>{TEAMS.map((t) => <option key={t}>{t}</option>)}</select></Field>
                <Field label="Shift"><select className={inputCls} value={f.shift} onChange={(e) => setF({ ...f, shift: e.target.value })}>{SHIFTS.map((s) => <option key={s}>{s}</option>)}</select></Field>
                <div className="col-span-2"><Field label="Alias names" hint="Pseudonyms used with clients — comma-separated (e.g. Nina, Nicky)"><input className={inputCls} value={f.aliases} onChange={(e) => setF({ ...f, aliases: e.target.value })} placeholder="Nina, Nicky" /></Field></div>
                <div className="col-span-2"><Field label="CallHippo email" hint="Their CallHippo login email — used to credit calls to this agent (leave blank if same as login email)"><input className={inputCls} value={f.callHippoEmail || ''} onChange={(e) => setF({ ...f, callHippoEmail: e.target.value })} placeholder="agent@company.com" /></Field></div>
                <TargetsAndReporting state={f} patch={(p) => setF({ ...f, ...p })} managers={managers} allUsers={users} />
              </>
            )}
          </div>
          <div className="flex justify-end mt-4"><Btn variant="dark" onClick={create}>Create user</Btn></div>
        </div>
      )}

      {edit && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-[80] p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border-2 p-5 my-8 w-full max-w-2xl shadow-2xl" style={{ borderColor: C.blue }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-sm" style={{ color: C.navy }}>Edit {edit.name}</h3>
            <button onClick={() => setEdit(null)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
          </div>
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
            <Field label="Login email" hint="The address this user signs in with"><input className={inputCls} value={edit.email || ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} placeholder="user@qtonix.com" /></Field>
            <Field label="Phone"><IndiaPhone value={edit.phone || ''} onChange={(v) => setEdit({ ...edit, phone: v })} /></Field>
            <Field label="Designation"><input className={inputCls} value={edit.designation || ''} onChange={(e) => setEdit({ ...edit, designation: e.target.value })} /></Field>
            <Field label="Role"><select className={inputCls} value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })} disabled={edit._id === me.id || edit._id === me._id}><option value="agent">Sales agent</option><option value="manager">Manager</option><option value="leadmanager">Lead manager</option><option value="admin">Admin</option></select></Field>
            <Field label="Birthday"><input type="date" className={inputCls} value={(edit.birthday || '').slice(0, 10)} onChange={(e) => setEdit({ ...edit, birthday: e.target.value })} /></Field>
            <Field label="Joining date" hint="Drives the work-anniversary celebration"><input type="date" className={inputCls} value={(edit.joiningDate || '').slice(0, 10)} onChange={(e) => setEdit({ ...edit, joiningDate: e.target.value })} /></Field>
            <Field label="Marital status">
              <select className={inputCls} value={edit.maritalStatus || ''} onChange={(e) => setEdit({ ...edit, maritalStatus: e.target.value, anniversary: e.target.value === 'married' ? edit.anniversary : '' })}>
                <option value="">Not specified</option>
                <option value="single">Single</option>
                <option value="married">Married</option>
              </select>
            </Field>
            {edit.maritalStatus === 'married' && (
              <Field label="Marriage anniversary"><input type="date" className={inputCls} value={(edit.anniversary || '').slice(0, 10)} onChange={(e) => setEdit({ ...edit, anniversary: e.target.value })} /></Field>
            )}
            {edit.role !== 'leadmanager' && (
              <>
                <Field label="Team"><select className={inputCls} value={edit.team || 'Bhubaneswar'} onChange={(e) => setEdit({ ...edit, team: e.target.value })}>{TEAMS.map((t) => <option key={t}>{t}</option>)}</select></Field>
                <Field label="Shift"><select className={inputCls} value={edit.shift || 'Morning'} onChange={(e) => setEdit({ ...edit, shift: e.target.value })}>{SHIFTS.map((s) => <option key={s}>{s}</option>)}</select></Field>
              </>
            )}
            {(edit.role === 'agent' || edit.role === 'manager') && (
              <div className="col-span-2">
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input type="checkbox" checked={!!edit.canViewConverted} onChange={(e) => setEdit({ ...edit, canViewConverted: e.target.checked })} />
                  Can view Converted clients (their own only)
                </label>
              </div>
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
                <div className="col-span-2"><Field label="CallHippo email" hint="Their CallHippo login email — used to credit calls to this agent"><input className={inputCls} value={edit.callHippoEmail || ''} onChange={(e) => setEdit({ ...edit, callHippoEmail: e.target.value })} placeholder="agent@company.com" /></Field></div>
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
        </div>
      )}

      {deleting && <DeleteUserModal user={deleting} users={users} onClose={() => setDeleting(null)} onDone={(msg) => { setDeleting(null); load(); say && say(msg, 'good'); }} />}

      {uview === 'list' && <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr className="text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            <th className="px-4 py-3">User</th>
            <th className="px-4 py-3">Contact</th>
            <th className="px-4 py-3">Team</th>
            <th className="px-4 py-3 text-center">Email</th>
            <th className="px-4 py-3 text-right"></th>
          </tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u._id} className={`border-t border-slate-100 ${!u.active ? 'opacity-40' : ''}`}>
                {/* Photo + name & designation (with sudo/alias name) */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <AvatarPreview name={u.name} src={u.avatar} size={38} />
                    <div>
                      <div className="font-semibold" style={{ color: C.navy }}>
                        {u.name}
                        {u.aliases && u.aliases.length ? <span className="text-[11px] font-normal text-slate-400"> · aka {u.aliases.join(', ')}</span> : ''}
                        {(u._id === me.id || u._id === me._id) && <span className="ml-1 text-[9px] font-bold text-slate-400">(you)</span>}
                      </div>
                      <div className="text-[11px] text-slate-400">{u.designation || (u.role === 'admin' ? 'Administrator' : u.role === 'manager' ? 'Manager' : 'Agent')}</div>
                    </div>
                  </div>
                </td>
                {/* Email & phone */}
                <td className="px-4 py-3 text-xs text-slate-500">
                  <div>{u.email}</div>
                  {u.phone && <div className="text-slate-400">{u.phone}</div>}
                </td>
                {/* Team */}
                <td className="px-4 py-3 text-[11px] text-slate-500">{u.team || '—'}{u.shift ? <><br /><span className="text-slate-400">{u.shift}</span></> : null}</td>
                {/* Email connection: green dot if connected, gray if not */}
                <td className="px-4 py-3 text-center">
                  <span title={u.gmailConnected ? (u.gmailConnectedEmail || 'Connected') : 'Not connected'}
                    className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: u.gmailConnected ? '#22C55E' : '#CBD5E1' }} />
                </td>
                {/* Edit + Deactivate icons */}
                <td className="px-4 py-3 text-right">
                  <div className="flex gap-1 justify-end">
                    <button title="Edit" onClick={() => { setEdit({ ...u, newPassword: '' }); setErr(''); }}
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                    </button>
                    <button title={u.active ? 'Deactivate' : 'Reactivate'} onClick={() => toggle(u)}
                      className={`w-8 h-8 flex items-center justify-center rounded-lg ${u.active ? 'text-slate-400 hover:bg-red-100 hover:text-red-600' : 'text-green-500 hover:bg-green-100'}`}>
                      {u.active
                        ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.36 6.64A9 9 0 1 1 5.64 6.64M12 2v10"/></svg>
                        : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>}
                    </button>
                    <button title="Delete" onClick={() => setDeleting(u)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-red-100 hover:text-red-600">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M6 7l1 13a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 17 20l1-13"/></svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
      <p className="text-[11px] text-slate-400 mt-3">Deactivating is a soft delete — their reports are preserved and keep working. Deleting removes the account permanently; you'll be asked to reassign their leads and reports first.</p>
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

      <CallHippoNumbersEditor
        items={cfg.callHippoNumbers || []} onChange={(l) => setList('callHippoNumbers', l)} />

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

// Incentive rules: percentages + USD→INR rate used to compute agent/manager
// incentives on the (admin-only) Team review Incentives table.
function IncentivesEditor({ value, onChange }) {
  const v = { eligibilityPct: 90, agentBasePct: 1.5, agentOverPct: 5, managerOverPct: 5, usdToInr: 83, ...value };
  const set = (k, val) => onChange({ ...v, [k]: Number(val) || 0 });
  const numCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5">
      <div className="text-sm font-bold text-[#050A1F] mb-1">Incentive rules</div>
      <p className="text-[11px] text-slate-400 mb-3">Drives the Incentives table under Team review (admin-only). Amounts are computed in USD, then converted to INR with the rate below.</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Field label="Eligibility threshold %" hint="Agent qualifies at ≥ this % of target">
          <input type="number" min="0" step="0.1" className={numCls} value={v.eligibilityPct} onChange={(e) => set('eligibilityPct', e.target.value)} />
        </Field>
        <Field label="Agent base %" hint="% of achieved (capped at target)">
          <input type="number" min="0" step="0.1" className={numCls} value={v.agentBasePct} onChange={(e) => set('agentBasePct', e.target.value)} />
        </Field>
        <Field label="Agent over-achievement %" hint="% of amount above target">
          <input type="number" min="0" step="0.1" className={numCls} value={v.agentOverPct} onChange={(e) => set('agentOverPct', e.target.value)} />
        </Field>
        <Field label="Manager over-achievement %" hint="% of team amount above team target">
          <input type="number" min="0" step="0.1" className={numCls} value={v.managerOverPct} onChange={(e) => set('managerOverPct', e.target.value)} />
        </Field>
        <Field label="USD → INR rate" hint="e.g. 83 means $1 = ₹83">
          <input type="number" min="0" step="0.01" className={numCls} value={v.usdToInr} onChange={(e) => set('usdToInr', e.target.value)} />
        </Field>
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
// Dedicated editor for CallHippo "from" numbers: each has a country, a label,
// and the phone number WITH country code. Includes a "verify" that checks each
// number is in a sane international format (so a missing country code is caught
// before it's used to place a call).
function CallHippoNumbersEditor({ items, onChange }) {
  const COUNTRIES = [
    { code: 'US', name: 'USA', dial: '+1' },
    { code: 'GB', name: 'UK', dial: '+44' },
    { code: 'CA', name: 'CA', dial: '+1' },
    { code: 'AU', name: 'AU', dial: '+61' },
    { code: 'IN', name: 'India', dial: '+91' },
    { code: 'OT', name: 'Other', dial: '' },
  ];
  const [country, setCountry] = useState('US');
  const [label, setLabel] = useState('');
  const [number, setNumber] = useState('');

  const add = () => {
    const c = COUNTRIES.find((x) => x.code === country);
    let num = number.trim();
    if (!num) return;
    // If they didn't type a +, prefix the country's dial code.
    if (!num.startsWith('+') && c && c.dial) num = `${c.dial}${num.replace(/^0+/, '')}`;
    onChange([...items, { id: `n_${Date.now()}`, country: c ? c.name : country, label: label.trim() || (c ? c.name : ''), value: num }]);
    setLabel(''); setNumber('');
  };
  const update = (i, patch) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const remove = (i) => onChange(items.filter((_, j) => j !== i));

  // A number "looks valid" if it starts with + and has 8–15 digits (E.164).
  const isValid = (v) => /^\+\d{8,15}$/.test(String(v || '').replace(/[\s()-]/g, ''));

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5">
      <div className="text-sm font-bold text-[#050A1F] mb-1">CallHippo numbers (manual)</div>
      <p className="text-xs text-slate-500 mb-3">Your CallHippo outbound numbers per country. Enter each WITH its country code (e.g. +1 for USA, +44 for UK). These appear in the agent's "call from" picker alongside any numbers fetched live from CallHippo.</p>

      <div className="space-y-2 mb-3">
        {items.map((it, i) => {
          const valid = isValid(it.value);
          return (
            <div key={it.id || i} className="flex items-center gap-2">
              <input value={it.country || ''} onChange={(e) => update(i, { country: e.target.value })} placeholder="Country" className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
              <input value={it.label || ''} onChange={(e) => update(i, { label: e.target.value })} placeholder="Label" className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
              <input value={it.value || ''} onChange={(e) => update(i, { value: e.target.value })} placeholder="+1..." className={`w-40 rounded-lg border px-2 py-1.5 text-sm font-mono ${valid ? 'border-slate-300' : 'border-red-300 bg-red-50'}`} />
              <span title={valid ? 'Looks valid' : 'Missing country code or invalid'} className={`text-sm ${valid ? 'text-green-500' : 'text-red-500'}`}>{valid ? '✓' : '⚠'}</span>
              <button onClick={() => remove(i)} className="text-slate-400 hover:text-red-500 text-sm">✕</button>
            </div>
          );
        })}
        {items.length === 0 && <span className="text-xs text-slate-300 italic">No numbers yet.</span>}
      </div>

      <div className="flex gap-2 items-center flex-wrap">
        <select value={country} onChange={(e) => setCountry(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-2 text-sm">
          {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}{c.dial ? ` (${c.dial})` : ''}</option>)}
        </select>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <input value={number} onChange={(e) => setNumber(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Number e.g. +1 555 123 4567"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" />
        <button onClick={add} className="rounded-lg bg-[#050A1F] px-4 py-2 text-sm font-bold text-white">Add</button>
      </div>
      <p className="text-[11px] text-slate-400 mt-2">⚠ marks a number that's missing a country code or isn't a valid international format — fix it before calling. Remember to click <b>Save CRM fields</b> below.</p>
    </div>
  );
}

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
function ImageKitPanel({ say, usage }) {
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
  // Pull the bandwidth figure out of ImageKit's usage payload (bytes → readable).
  const fmtBytes = (n) => {
    const b = Number(n || 0);
    if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`;
    if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
    if (b >= 1e3) return `${(b / 1e3).toFixed(0)} KB`;
    return `${b} B`;
  };
  const u = usage && usage.data;
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

      {/* Usage this month (bandwidth is the free-tier limiter). */}
      {usage && usage.configured && (
        <div className="mt-4 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
          <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400 mb-1">Usage this month{usage.period ? ` · ${usage.period}` : ''}</div>
          {usage.error ? (
            <div className="text-[11px] text-slate-400">Couldn't read usage ({usage.error}).</div>
          ) : u ? (
            <div className="flex items-center gap-5 flex-wrap">
              <div><div className="text-[9px] text-slate-400 font-bold uppercase">Bandwidth</div><div className="text-sm font-extrabold text-[#FF4500]">{fmtBytes(u.bandwidthBytes ?? u.bandwidth)}</div></div>
              <div><div className="text-[9px] text-slate-400 font-bold uppercase">Storage</div><div className="text-sm font-extrabold text-slate-600">{fmtBytes(u.mediaLibraryStorageBytes ?? u.storage)}</div></div>
              {(u.requests != null || u.extensionUnitsUsed != null) && <div><div className="text-[9px] text-slate-400 font-bold uppercase">Requests</div><div className="text-sm font-extrabold text-slate-600">{Number(u.requests ?? u.extensionUnitsUsed ?? 0).toLocaleString()}</div></div>}
            </div>
          ) : (
            <div className="text-[11px] text-slate-400">Usage data unavailable.</div>
          )}
          <div className="text-[10px] text-slate-400 mt-1.5">Free tier is limited mainly by monthly bandwidth.</div>
        </div>
      )}

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
        <div className="mt-2 flex items-stretch gap-2">
          <code className="flex-1 bg-white border border-slate-200 rounded px-2 py-1.5 text-[11px] break-all flex items-center">{cfg.redirectUri || '—'}</code>
          <button onClick={() => { navigator.clipboard?.writeText(cfg.redirectUri); say && say('Redirect URI copied.'); }} className="shrink-0 rounded-lg border border-slate-200 px-3 text-[11px] font-bold text-blue-500 hover:bg-blue-50 whitespace-nowrap">Copy</button>
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

// Admin → Emails: one place for every automated Sales-CRM email. A table listing
// each email (name, description, who it's sent to, which mailbox it's sent from
// — editable), with Preview and Activity popups. Below the table sits the Gmail
// connection + mailbox setup that these emails send through.
function EmailsTab({ settings, setSettings, say }) {
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState('');
  const [preview, setPreview] = useState(null);   // { id, name }
  const [activity, setActivity] = useState(null); // { id, name }
  const load = () => api('/gmail/crm-email-catalog').then(setData).catch(() => setData({ emails: [], available: [] }));
  useEffect(() => { load(); }, []);

  const setSender = async (row, email) => {
    setSaving(row.id);
    try {
      // reminders category → 'reminders' key; congrats category → 'congrats' key.
      const key = row.category === 'reminders' ? 'reminders' : 'congrats';
      const r = await api('/gmail/crm-mail-routing', { method: 'PATCH', body: JSON.stringify({ [key]: email }) });
      setData((d) => ({ ...d, emails: d.emails.map((e) => (e.category === row.category ? { ...e, sentFrom: r.routing[key] } : e)) }));
      say && say('Sender updated.');
    } catch (e) { say && say(e.message, 'bad'); } finally { setSaving(''); }
  };

  const fmtDate = (d) => { if (!d) return '—'; try { return new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return '—'; } };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-bold text-sm mb-1" style={{ color: C.navy }}>Automated emails</h3>
        <p className="text-xs text-slate-500 mb-4">Every automated email the Sales CRM sends. Choose which connected mailbox each one is sent from, preview a sample, or view recent send activity.</p>

        {!data ? <div className="text-slate-400 text-sm py-10 text-center">Loading…</div> : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-left">
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">Email</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">Sent to</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">Sent from</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">Last activity</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.emails.map((e) => (
                  <tr key={e.id} className="border-b border-slate-100 last:border-0 align-top">
                    <td className="px-4 py-3">
                      <div className="font-bold text-[#050A1F]">{e.name}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5 max-w-xs leading-snug">{e.description}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 max-w-[180px]">{e.sentTo}</td>
                    <td className="px-4 py-3">
                      {e.editableSender ? (
                        <select value={(data.available || []).some((a) => a.email === e.sentFrom) ? e.sentFrom : ''}
                          onChange={(ev) => setSender(e, ev.target.value)} disabled={saving === e.id}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-300" style={{ minWidth: 190 }}>
                          <option value="">{e.sentFrom ? `${e.sentFrom} (not linked)` : 'Select…'}</option>
                          {(data.available || []).map((a) => <option key={a.email} value={a.email}>{a.email}</option>)}
                        </select>
                      ) : (
                        <div className="text-xs"><span className="font-mono text-slate-600">{e.sentFrom}</span><div className="text-[10px] text-slate-400">HR mailbox</div></div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                      {e.lastSentAt ? fmtDate(e.lastSentAt) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <button onClick={() => setPreview({ id: e.id, name: e.name })} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">Preview</button>
                        <button onClick={() => setActivity({ id: e.id, name: e.name })} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">Activity</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {preview && <EmailPreviewModal id={preview.id} name={preview.name} onClose={() => setPreview(null)} />}
      {activity && <EmailActivityModal id={activity.id} name={activity.name} fmtDate={fmtDate} onClose={() => setActivity(null)} />}
    </div>
  );
}

// Popup: renders the sample email HTML in an iframe (isolated styles).
function EmailPreviewModal({ id, name, onClose }) {
  const [html, setHtml] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    apiRaw(`/gmail/crm-email-catalog/${id}/preview`).then((t) => { if (alive) setHtml(t); }).catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [id]);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[120] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col" style={{ height: '92vh' }} onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div><div className="text-sm font-extrabold text-[#050A1F]">Preview — {name}</div><div className="text-[11px] text-slate-400">Sample email with placeholder data</div></div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400">✕</button>
        </div>
        <div className="flex-1 overflow-auto bg-slate-100 p-4">
          {err ? <div className="text-red-500 text-sm p-6 text-center">{err}</div>
            : <iframe title="preview" srcDoc={html} className="w-full h-full bg-white rounded-lg border border-slate-200" />}
        </div>
      </div>
    </div>
  );
}

// Popup: recent send activity as a paginated table (CRM table styling).
function EmailActivityModal({ id, name, fmtDate, onClose }) {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const perPage = 10;
  useEffect(() => { api(`/gmail/crm-email-catalog/${id}/activity`).then(setData).catch(() => setData({ activity: [], note: 'Could not load activity.' })); }, [id]);
  const rows = (data && data.activity) || [];
  const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
  const pageRows = rows.slice((page - 1) * perPage, page * perPage);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[120] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl flex flex-col" style={{ height: '86vh' }} onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div><div className="text-sm font-extrabold text-[#050A1F]">Activity — {name}</div><div className="text-[11px] text-slate-400">{rows.length > 0 ? `${rows.length} recent send${rows.length === 1 ? '' : 's'}` : 'Recent sends'}</div></div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400">✕</button>
        </div>
        <div className="flex-1 overflow-auto p-5">
          {!data ? <div className="text-slate-400 text-sm py-16 text-center">Loading…</div>
            : rows.length === 0 ? <div className="text-slate-400 text-sm py-16 text-center">{data.note || 'No sends recorded yet.'}</div>
              : (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-left">
                        <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">Recipient</th>
                        <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">Email</th>
                        <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">Date &amp; time</th>
                        <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((a, i) => (
                        <tr key={i} className="border-b border-slate-100 last:border-0">
                          <td className="px-4 py-3 font-semibold text-[#050A1F] whitespace-nowrap">{a.toName || '—'}</td>
                          <td className="px-4 py-3 text-slate-600">{a.toEmail}</td>
                          <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmtDate(a.sentAt)}</td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            {a.status === 'sent'
                              ? <span className="rounded-full bg-green-50 text-green-700 px-2 py-0.5 text-[11px] font-bold">✓ Sent</span>
                              : <span className="rounded-full bg-red-50 text-red-600 px-2 py-0.5 text-[11px] font-bold" title={a.error || ''}>✗ Failed</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
        </div>
        {rows.length > perPage && (
          <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between shrink-0">
            <div className="text-xs text-slate-400">Page {page} of {totalPages}</div>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40">Previous</button>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>
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
      <div className="flex items-stretch gap-2">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. Sales)" className={inputCls} />
        <Btn size="sm" className="shrink-0 whitespace-nowrap" onClick={link}>+ Link mailbox</Btn>
      </div>

      <CrmMailRouting say={say} mailboxes={data.mailboxes || []} />
      <AdminHrMailbox say={say} />
    </div>
  );
}

// Admin-only: link the recruitment / HR mailbox (career@qtonix.com) directly
// from CRM Admin. Used for recruitment + survey-launch notification emails.
function AdminHrMailbox({ say }) {
  const [data, setData] = useState(null);
  const load = () => api('/gmail/hr-mailbox').then(setData).catch(() => {});
  useEffect(() => {
    load();
    const onMsg = (e) => { if (e.data && e.data.gmail) setTimeout(load, 800); };
    window.addEventListener('message', onMsg); return () => window.removeEventListener('message', onMsg);
  }, []);
  const connect = async () => {
    try { const { url } = await api('/gmail/hr-mailbox/connect?label=Recruitment'); const w = window.open(url, 'hrmail_oauth', 'width=520,height=640'); const poll = setInterval(() => { if (w && w.closed) { clearInterval(poll); setTimeout(load, 500); } }, 1200); }
    catch (e) { say && say(e.message); }
  };
  if (!data) return null;
  const boxes = data.mailboxes || [];
  return (
    <div className="mt-6 border-t border-slate-100 pt-5">
      <div className="text-sm font-bold text-[#050A1F] mb-1">HR / recruitment mailbox</div>
      <div className="text-xs text-slate-500 mb-3">The shared HR inbox (e.g. career@qtonix.com) used for recruitment emails and <strong>survey-launch notifications</strong> to the team.</div>
      {!data.configured && <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs px-3 py-2 mb-3">Google credentials aren’t set up yet. Add them in API keys first.</div>}
      <div className="space-y-2 mb-3">
        {boxes.length === 0 && <div className="text-xs text-slate-400">No HR mailbox linked yet.</div>}
        {boxes.map((m) => (
          <div key={m.id} className="flex items-center justify-between rounded-lg bg-green-50 border border-green-200 px-3 py-2">
            <div className="text-xs"><span className="font-bold text-green-700">✓ {m.email}</span>{m.connectedAt ? <span className="text-slate-400"> · linked {new Date(m.connectedAt).toLocaleDateString()}</span> : ''}</div>
          </div>
        ))}
      </div>
      <Btn size="sm" className="shrink-0 whitespace-nowrap" onClick={connect} disabled={!data.configured}>+ Link HR mailbox</Btn>
    </div>
  );
}

// Admin-only: choose which mailbox each type of automated Sales-CRM email is
// sent from (task/call reminders vs target congratulations).
function CrmMailRouting({ say, mailboxes }) {
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState(false);
  const load = () => api('/gmail/crm-mail-routing').then(setData).catch(() => {});
  useEffect(() => { load(); }, [mailboxes.length]);
  if (!data) return null;
  // Connected emails available to send from.
  const options = (data.available || []).map((m) => m.email);
  const setRoute = async (key, email) => {
    setSaving(true);
    try { const r = await api('/gmail/crm-mail-routing', { method: 'PATCH', body: JSON.stringify({ [key]: email }) }); setData((d) => ({ ...d, routing: r.routing })); say && say('Saved.'); }
    catch (e) { say && say(e.message); } finally { setSaving(false); }
  };
  const Row = ({ label, hint, k }) => {
    const cur = data.routing[k] || '';
    const connected = options.includes(cur);
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-xs font-bold text-[#050A1F]">{label}</div>
          <div className="text-[11px] text-slate-400">{hint}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <select value={connected ? cur : ''} onChange={(e) => setRoute(k, e.target.value)} disabled={saving} className={inputCls + ' text-xs py-1.5'} style={{ minWidth: 200 }}>
            <option value="">{cur ? `${cur} (not connected)` : 'Select a mailbox…'}</option>
            {options.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
          {!connected && cur && <span className="text-[10px] font-bold text-amber-600" title="This mailbox isn't connected yet — link it above.">⚠ not linked</span>}
        </div>
      </div>
    );
  };
  return (
    <div className="mt-6 border-t border-slate-100 pt-5">
      <div className="text-sm font-bold text-[#050A1F] mb-1">Automated email senders</div>
      <div className="text-xs text-slate-500 mb-3">Choose which connected mailbox each type of automated Sales-CRM email is sent from. Link the mailbox above first (e.g. Sales → sales@qtonix.com), then select it here.</div>
      <div className="space-y-2">
        <Row label="Task & Call reminders" hint="Sent to the agent 15 min before a scheduled task/call · manager CC'd" k="reminders" />
        <Row label="Target congratulations" hint="Agent & team target wins + encouragement nudges · signed by the Founder/CEO · adam@qtonix.com always CC'd" k="congrats" />
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
function DeleteUserModal({ user, users, onClose, onDone }) {
  const [impact, setImpact] = useState(null);
  const [reassignTo, setReassignTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { api(`/admin/users/${user._id}/impact`).then(setImpact).catch(() => setImpact({ leads: 0, reports: 0, directReports: 0 })); }, [user._id]);
  const needsReassign = impact && (impact.leads > 0 || impact.reports > 0);
  const options = (users || []).filter((u) => u._id !== user._id && u.active);
  const del = async () => {
    if (needsReassign && !reassignTo) { setErr('Choose who should receive their leads and reports.'); return; }
    setBusy(true); setErr('');
    try {
      const r = await api(`/admin/users/${user._id}`, { method: 'DELETE', body: JSON.stringify({ reassignTo: reassignTo ? Number(reassignTo) : null }) });
      const moved = r.reassigned && (r.reassigned.leads || r.reassigned.reports);
      onDone(`${user.name} deleted${moved ? ` — ${r.reassigned.leads} leads & ${r.reassigned.reports} reports reassigned` : ''}`);
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100">
          <div className="text-lg font-extrabold text-red-600">Delete {user.name}?</div>
          <div className="text-xs text-slate-400 mt-0.5">This permanently removes the account. It can't be undone.</div>
        </div>
        <div className="p-6 space-y-3">
          {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{err}</div>}
          {!impact ? <div className="text-sm text-slate-400">Checking what they own…</div> : (
            <>
              {needsReassign ? (
                <>
                  <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2.5 text-sm text-amber-800">
                    {user.name} owns <b>{impact.leads}</b> lead{impact.leads === 1 ? '' : 's'} and <b>{impact.reports}</b> report{impact.reports === 1 ? '' : 's'}. Reassign them to another user before deleting.
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-500 mb-1">Reassign leads &amp; reports to</div>
                    <select className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}>
                      <option value="">Select a user…</option>
                      {options.map((u) => <option key={u._id} value={u._id}>{u.name} ({u.role}{u.team ? ` · ${u.team}` : ''})</option>)}
                    </select>
                  </div>
                </>
              ) : (
                <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5 text-sm text-slate-600">This user owns no leads or reports, so nothing needs reassigning.</div>
              )}
              {impact.directReports > 0 && <div className="text-[11px] text-slate-400">{impact.directReports} user{impact.directReports === 1 ? '' : 's'} report to them — their reporting line will be cleared.</div>}
            </>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={del} disabled={busy || !impact} className="rounded-lg px-5 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50">{busy ? 'Deleting…' : 'Delete user'}</button>
        </div>
      </div>
    </div>
  );
}

function ActivityLog() {
  const [logs, setLogs] = useState(null);
  const [redOnly, setRedOnly] = useState(false);
  const [source, setSource] = useState('crm'); // crm | hrms | all
  const [page, setPage] = useState(1);
  const PER = 50;
  const load = () => api('/admin/logs?limit=1000').then(setLogs).catch(() => setLogs([]));
  useEffect(() => { load(); }, []);

  // HR-portal activity is namespaced with an `hr.` action prefix; everything
  // else is Sales-CRM activity.
  const isHr = (l) => String(l.action || '').startsWith('hr.');
  const isRed = (l) => l.action === 'copy.flagged' || l.severity === 'alert';
  const allRows = (logs || []).filter((l) => {
    if (source === 'crm' && isHr(l)) return false;
    if (source === 'hrms' && !isHr(l)) return false;
    if (redOnly && !isRed(l)) return false;
    return true;
  });
  const pages = Math.max(1, Math.ceil(allRows.length / PER));
  const curPage = Math.min(page, pages);
  const rows = allRows.slice((curPage - 1) * PER, curPage * PER);
  useEffect(() => { setPage(1); }, [redOnly, source]);

  const counts = { crm: (logs || []).filter((l) => !isHr(l)).length, hrms: (logs || []).filter(isHr).length };

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-extrabold" style={{ color: C.navy }}>Activity log</h2>
          <p className="text-sm text-slate-500">All admin and security activity. Excessive copying (3+ copies within 30 seconds) is flagged in red with the user's IP.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs font-bold text-slate-500 cursor-pointer">
            <input type="checkbox" checked={redOnly} onChange={(e) => setRedOnly(e.target.checked)} /> Flagged only
          </label>
          <Btn onClick={load} size="sm" variant="ghost">Refresh</Btn>
        </div>
      </div>

      {/* Separate CRM vs HRMS activity. */}
      <div className="inline-flex items-center gap-1 bg-slate-100 rounded-lg p-1 mb-4">
        {[['crm', 'Sales CRM'], ['hrms', 'HRMS'], ['all', 'All']].map(([id, label]) => (
          <button key={id} onClick={() => setSource(id)} className={`px-4 py-1.5 rounded-md text-xs font-bold ${source === id ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>
            {label}{id !== 'all' && counts[id] != null ? ` (${counts[id]})` : ''}
          </button>
        ))}
      </div>

      {logs === null ? (
        <div className="text-slate-400 text-sm py-8">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-slate-400 text-sm py-8">No {source === 'hrms' ? 'HRMS' : source === 'crm' ? 'Sales CRM' : ''} activity recorded{redOnly ? ' matching this filter' : ''} yet.</div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50/80 text-[10px] uppercase tracking-wider text-slate-400 font-bold border-b border-slate-100">
                <th className="text-left px-4 py-2.5">When</th>
                <th className="text-left px-4 py-2.5">User</th>
                <th className="text-left px-4 py-2.5">Action</th>
                <th className="text-left px-4 py-2.5">Details</th>
                <th className="text-left px-4 py-2.5">IP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => {
                const red = isRed(l);
                return (
                  <tr key={l.id} className={`border-t border-slate-50 ${red ? 'bg-red-50/70' : ''}`}>
                    <td className={`px-4 py-2.5 text-xs whitespace-nowrap ${red ? 'text-red-500' : 'text-slate-400'}`}>{dt(l.createdAt)}</td>
                    <td className="px-4 py-2.5">
                      <div className={`font-bold ${red ? 'text-red-700' : 'text-slate-600'}`}>{l.userName || '—'}</div>
                      {(red && (l.userRole || l.userEmail)) && <div className="text-[10px] text-red-400">{[l.userRole, l.userEmail].filter(Boolean).join(' · ')}</div>}
                    </td>
                    <td className="px-4 py-2.5">
                      {red
                        ? <span className="rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-[10px] font-bold">⚠ {l.action}</span>
                        : <span className="text-slate-500 text-xs">{l.action}</span>}
                    </td>
                    <td className={`px-4 py-2.5 text-xs ${red ? 'text-red-600' : 'text-slate-500'}`}>{l.target || '—'}</td>
                    <td className={`px-4 py-2.5 text-xs font-mono ${red ? 'text-red-600' : 'text-slate-400'}`}>{l.ip || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {pages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-xs text-slate-500">
              <span>Showing {(curPage - 1) * PER + 1}–{Math.min(curPage * PER, allRows.length)} of {allRows.length}</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(1)} disabled={curPage === 1} className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40">«</button>
                <button onClick={() => setPage(curPage - 1)} disabled={curPage === 1} className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40">Prev</button>
                <span className="px-2 font-bold">Page {curPage} / {pages}</span>
                <button onClick={() => setPage(curPage + 1)} disabled={curPage === pages} className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40">Next</button>
                <button onClick={() => setPage(pages)} disabled={curPage === pages} className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40">»</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin shell
// ---------------------------------------------------------------------------
export default function Admin() {
  const [tab, setTab] = useState('users');
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

  const tabs = [['users', 'Users'], ['report', 'Report settings'], ['domains', 'Domains'], ['keys', 'API keys'], ['emails', 'Emails'], ['crm', 'CRM Fields'], ['targets', 'Targets & Incentive'], ['survey', 'Survey'], ['tv', 'Motivator TV'], ['demo', 'Demo mode'], ['log', 'Log']];
  // Save applies to tabs backed by the settings object (not Users/CRM/TV, which save inline).
  const showSave = tab !== 'users' && tab !== 'crm' && tab !== 'tv' && tab !== 'log' && tab !== 'targets' && tab !== 'survey' && tab !== 'emails' && tab !== 'domains';

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

        {tab === 'report' && <ReportSettings settings={settings} setSettings={setSettings} say={say} reload={load} />}
        {tab === 'domains' && <DomainsSettings say={say} />}
        {tab === 'keys' && <ApiKeys settings={settings} setSettings={setSettings} say={say} />}
        {tab === 'emails' && <EmailsTab settings={settings} setSettings={setSettings} say={say} />}
        {tab === 'users' && <Users me={me} say={say} />}
        {tab === 'crm' && <CrmFields say={say} />}
        {tab === 'targets' && <TargetsAndIncentive say={say} settings={settings} setSettings={setSettings} />}
        {tab === 'survey' && <CrmSurveyAdmin />}
        {tab === 'tv' && <MotivatorTvSettings say={say} />}
        {tab === 'demo' && <DemoModeSettings say={say} />}
        {tab === 'log' && <ActivityLog />}
      </main>
    </div>
  );
}

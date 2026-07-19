import React, { useState, useEffect } from 'react';
import { API_BASE } from './config.js';

/**
 * Qtonix Site Analysis — admin panel.
 * Settings (logo + API keys + branding), Users, Dashboard, Activity log.
 */

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

const Field = ({ label, hint, children }) => (
  <div>
    <label className="block text-xs font-semibold text-slate-600 mb-1.5">{label}</label>
    {children}
    {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
  </div>
);

const input =
  'w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF6A00] focus:border-transparent';

// ---------------------------------------------------------------------------

function SettingsPanel() {
  const [s, setS] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [keyTests, setKeyTests] = useState({});

  useEffect(() => { api('/admin/settings').then(setS).catch((e) => setMsg({ bad: true, text: e.message })); }, []);

  if (!s) return <div className="text-sm text-slate-400">Loading settings…</div>;

  const set = (k, v) => setS((x) => ({ ...x, [k]: v }));
  const setColor = (k, v) => setS((x) => ({ ...x, colors: { ...x.colors, [k]: v } }));
  const setKey = (k, v) => setS((x) => ({ ...x, apiKeys: { ...x.apiKeys, [k]: v } }));

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const saved = await api('/admin/settings', { method: 'PUT', body: JSON.stringify(s) });
      setS(saved);
      setMsg({ text: 'Settings saved.' });
    } catch (e) {
      setMsg({ bad: true, text: e.message });
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('logo', file);
    try {
      const r = await api('/admin/settings/logo', { method: 'POST', body: fd });
      setS((x) => ({ ...x, logoPath: r.logoPath }));
      setMsg({ text: 'Logo uploaded.' });
    } catch (e) {
      setMsg({ bad: true, text: e.message });
    }
  };

  const testKey = async (service) => {
    setKeyTests((t) => ({ ...t, [service]: { testing: true } }));
    try {
      const r = await api('/admin/settings/test-key', {
        method: 'POST',
        body: JSON.stringify({ service, key: s.apiKeys[service] }),
      });
      setKeyTests((t) => ({ ...t, [service]: r }));
    } catch (e) {
      setKeyTests((t) => ({ ...t, [service]: { ok: false, error: e.message } }));
    }
  };

  const KeyRow = ({ id, label, hint, required }) => {
    const test = keyTests[id];
    return (
      <div className="border border-slate-200 rounded-lg p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1.5">
              <label className="text-xs font-semibold text-slate-600">{label}</label>
              {s.apiKeys[id]
                ? <span className="rounded bg-green-50 text-green-600 px-1.5 py-0.5 text-[9px] font-bold">CONFIGURED</span>
                : required && <span className="rounded bg-red-50 text-red-600 px-1.5 py-0.5 text-[9px] font-bold">REQUIRED</span>}
            </div>
            <input
              type="password" value={s.apiKeys[id] || ''}
              onChange={(e) => setKey(id, e.target.value)}
              placeholder={s.apiKeys[id] ? '' : 'Paste key…'}
              className={input}
            />
            <p className="text-xs text-slate-400 mt-1">{hint}</p>
          </div>
          <button
            onClick={() => testKey(id)}
            className="mt-6 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-slate-400 shrink-0"
          >
            {test && test.testing ? 'Testing…' : 'Test'}
          </button>
        </div>
        {test && !test.testing && (
          <div className={`mt-2 text-xs font-medium ${test.ok ? 'text-green-600' : 'text-red-600'}`}>
            {test.ok ? '✓ Key works' : `✗ ${test.error}`}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-3xl space-y-6">
      {msg && (
        <div className={`rounded-lg px-4 py-3 text-sm ${msg.bad ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-green-50 border border-green-200 text-green-700'}`}>
          {msg.text}
        </div>
      )}

      {/* --- Branding --- */}
      <section className="bg-white rounded-2xl border border-slate-200 p-6">
        <h2 className="font-bold text-[#050A1F] mb-1">Branding</h2>
        <p className="text-xs text-slate-500 mb-5">This is what appears on every report cover.</p>

        <div className="flex items-center gap-5 mb-5 p-4 rounded-lg bg-[#050A1F]">
          <div className="w-32 h-14 rounded flex items-center justify-center bg-white/5">
            {s.logoPath
              ? <img src={(s.logoPath && s.logoPath.startsWith("/") ? API_BASE : "") + s.logoPath} alt="Logo" className="max-h-10 max-w-28 object-contain" />
              : <span className="text-lg font-extrabold text-white">Qtonix<span className="text-[#FF6A00]">.</span></span>}
          </div>
          <div>
            <label className="inline-block rounded-md bg-white/10 px-3 py-1.5 text-xs font-bold text-white cursor-pointer hover:bg-white/20">
              {s.logoPath ? 'Replace logo' : 'Upload logo'}
              <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden"
                onChange={(e) => uploadLogo(e.target.files[0])} />
            </label>
            <p className="text-[10px] text-slate-400 mt-1.5">
              PNG, JPG, SVG or WEBP · max 3MB · a light/transparent logo works best on the navy cover
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <Field label="Company name"><input className={input} value={s.companyName} onChange={(e) => set('companyName', e.target.value)} /></Field>
          <Field label="Short name" hint="Used in the report footer"><input className={input} value={s.companyShort} onChange={(e) => set('companyShort', e.target.value)} /></Field>
          <Field label="Website"><input className={input} value={s.website} onChange={(e) => set('website', e.target.value)} /></Field>
          <Field label="Email"><input className={input} value={s.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="Phone"><input className={input} value={s.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        </div>

        <Field label="Report colours">
          <div className="grid grid-cols-4 gap-3">
            {[
              ['navy', 'Navy'], ['orange', 'Orange'], ['orangeDeep', 'Orange deep'], ['blue', 'Blue'],
            ].map(([k, label]) => (
              <div key={k}>
                <div className="flex items-center gap-2">
                  <input type="color" value={s.colors[k]} onChange={(e) => setColor(k, e.target.value)}
                    className="h-9 w-9 rounded border border-slate-300 cursor-pointer" />
                  <input value={s.colors[k]} onChange={(e) => setColor(k, e.target.value)}
                    className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-mono" />
                </div>
                <p className="text-[10px] text-slate-400 mt-1">{label}</p>
              </div>
            ))}
          </div>
        </Field>
      </section>

      {/* --- API keys --- */}
      <section className="bg-white rounded-2xl border border-slate-200 p-6">
        <h2 className="font-bold text-[#050A1F] mb-1">API keys</h2>
        <p className="text-xs text-slate-500 mb-5">
          Encrypted before storage. Test each key here — a bad key should fail now, not halfway through a client's report.
        </p>
        <div className="space-y-3">
          <KeyRow id="seranking" label="SE Ranking" required
            hint="Rankings, backlinks, competitors, AI Overview data. Data API + Project API share one key." />
          <KeyRow id="anthropic" label="Claude (Anthropic)" required
            hint="Powers the AI visibility test, cover tagline, and executive summary." />
          <KeyRow id="pagespeed" label="Google PageSpeed Insights"
            hint="Free, 25k/day. Without a key you still get results, but rate-limited." />
          <KeyRow id="googlePlaces" label="Google Places"
            hint="Only needed for the Local SEO section (GBP reviews, ratings)." />
        </div>
      </section>

      {/* --- Behaviour --- */}
      <section className="bg-white rounded-2xl border border-slate-200 p-6">
        <h2 className="font-bold text-[#050A1F] mb-1">Report behaviour</h2>
        <p className="text-xs text-slate-500 mb-5">These control credit burn. Change them deliberately.</p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Reports per agent per day" hint="Stops a runaway credit bill">
            <input type="number" min="1" max="200" className={input} value={s.dailyReportLimit}
              onChange={(e) => set('dailyReportLimit', Number(e.target.value))} />
          </Field>
          <Field label="Cache the same domain for (days)" hint="Re-running a domain inside this window is free">
            <input type="number" min="0" max="90" className={input} value={s.cacheDays}
              onChange={(e) => set('cacheDays', Number(e.target.value))} />
          </Field>
          <Field label="Report valid for (days)" hint="Printed on the cover — creates a decay clock">
            <input type="number" min="1" max="90" className={input} value={s.reportValidDays}
              onChange={(e) => set('reportValidDays', Number(e.target.value))} />
          </Field>
          <Field label="Default market" hint="Two-letter code, e.g. us, uk, in, my">
            <input className={input} value={s.defaultCountry} onChange={(e) => set('defaultCountry', e.target.value.toLowerCase())} />
          </Field>
        </div>
      </section>

      <div className="flex justify-end">
        <button onClick={save} disabled={saving}
          className="rounded-lg px-6 py-2.5 text-sm font-bold text-white disabled:opacity-40"
          style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Users() {
  const [users, setUsers] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'agent', phone: '', designation: 'Sales Executive' });
  const [msg, setMsg] = useState(null);

  const load = () => api('/admin/users').then(setUsers).catch(() => {});
  useEffect(() => { load(); }, []);

  const create = async () => {
    setMsg(null);
    try {
      await api('/admin/users', { method: 'POST', body: JSON.stringify(form) });
      setShowNew(false);
      setForm({ name: '', email: '', password: '', role: 'agent', phone: '', designation: 'Sales Executive' });
      load();
      setMsg({ text: 'User created.' });
    } catch (e) { setMsg({ bad: true, text: e.message }); }
  };

  const toggle = async (u) => {
    try { await api(`/admin/users/${u._id}`, { method: 'PUT', body: JSON.stringify({ active: !u.active }) }); load(); }
    catch (e) { setMsg({ bad: true, text: e.message }); }
  };

  return (
    <div className="max-w-4xl">
      {msg && (
        <div className={`mb-4 rounded-lg px-4 py-3 text-sm ${msg.bad ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-green-50 border border-green-200 text-green-700'}`}>
          {msg.text}
        </div>
      )}

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-extrabold text-[#050A1F] tracking-tight">Users</h1>
          <p className="text-sm text-slate-500 mt-0.5">{users.filter((u) => u.active).length} active</p>
        </div>
        <button onClick={() => setShowNew(!showNew)}
          className="rounded-lg px-4 py-2 text-sm font-bold text-white"
          style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>
          {showNew ? 'Cancel' : 'Add user'}
        </button>
      </div>

      {showNew && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-5">
          <h3 className="font-bold text-[#050A1F] mb-4">New user</h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name *"><input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Email *"><input className={input} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Password *" hint="At least 8 characters"><input type="password" className={input} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
            <Field label="Phone" hint="Appears on their report covers"><input className={input} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Designation"><input className={input} value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} /></Field>
            <Field label="Role">
              <select className={input} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="agent">Sales agent</option>
                <option value="admin">Admin</option>
              </select>
            </Field>
          </div>
          <div className="flex justify-end mt-4">
            <button onClick={create} disabled={!form.name || !form.email || !form.password}
              className="rounded-lg bg-[#050A1F] px-5 py-2 text-sm font-bold text-white disabled:opacity-40">
              Create user
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="text-left text-xs font-bold text-slate-500 uppercase">
              <th className="px-4 py-3">Name</th><th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th><th className="px-4 py-3">Reports</th>
              <th className="px-4 py-3">Last login</th><th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u._id} className={`border-t border-slate-100 ${!u.active ? 'opacity-40' : ''}`}>
                <td className="px-4 py-3">
                  <div className="font-semibold text-[#050A1F]">{u.name}</div>
                  <div className="text-xs text-slate-400">{u.designation}</div>
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">{u.email}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                    u.role === 'admin' ? 'bg-orange-100 text-[#FF4500]' : 'bg-slate-100 text-slate-600'
                  }`}>{u.role}</span>
                </td>
                <td className="px-4 py-3 text-xs font-semibold">{u.reportsRun}</td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {u.lastLogin ? new Date(u.lastLogin).toLocaleDateString('en-GB') : 'Never'}
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => toggle(u)}
                    className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-bold text-slate-600">
                    {u.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Dashboard() {
  const [stats, setStats] = useState(null);
  useEffect(() => { api('/admin/stats').then(setStats).catch(() => {}); }, []);
  if (!stats) return <div className="text-sm text-slate-400">Loading…</div>;

  const cards = [
    { label: 'Reports run', value: stats.reports.total, tone: 'text-[#050A1F]' },
    { label: 'Last 30 days', value: stats.reports.last30, tone: 'text-[#FF6A00]' },
    { label: 'In progress', value: stats.reports.running, tone: 'text-blue-600' },
    { label: 'Failed', value: stats.reports.failed, tone: stats.reports.failed ? 'text-red-600' : 'text-slate-300' },
  ];

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-extrabold text-[#050A1F] tracking-tight mb-5">Dashboard</h1>

      <div className="grid grid-cols-4 gap-4 mb-6">
        {cards.map((c) => (
          <div key={c.label} className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className={`text-3xl font-extrabold ${c.tone}`}>{c.value}</div>
            <div className="text-xs text-slate-500 mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h3 className="font-bold text-[#050A1F] text-sm mb-3">Reports by agent</h3>
          {!stats.byAgent.length && <p className="text-xs text-slate-400">No reports yet.</p>}
          {stats.byAgent.map((a) => (
            <div key={a._id} className="flex justify-between py-1.5 border-b border-slate-50 last:border-0">
              <span className="text-xs text-slate-600">{a._id || '—'}</span>
              <span className="text-xs font-bold text-[#050A1F]">{a.count}</span>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h3 className="font-bold text-[#050A1F] text-sm mb-3">SE Ranking credits</h3>
          <div className="text-2xl font-extrabold text-[#FF6A00]">
            {stats.creditsUsed ? stats.creditsUsed.toLocaleString() : 0}
          </div>
          <p className="text-xs text-slate-400 mt-1">Used across all reports</p>
          {stats.seRankingAccount && (
            <pre className="mt-3 text-[10px] bg-slate-50 rounded p-2 overflow-auto max-h-24 text-slate-500">
              {JSON.stringify(stats.seRankingAccount, null, 1)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function Admin() {
  const [tab, setTab] = useState('dashboard');
  const tabs = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'settings', label: 'Settings' },
    { id: 'users', label: 'Users' },
  ];

  return (
    <div className="min-h-screen bg-slate-50" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <header className="bg-[#050A1F] border-b border-white/10">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="text-lg font-extrabold text-white tracking-tight">
              Qtonix<span className="text-[#FF6A00]">.</span>
              <span className="ml-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Admin</span>
            </div>
            <nav className="flex gap-1">
              {tabs.map((t) => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-bold transition ${
                    tab === t.id ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'
                  }`}>
                  {t.label}
                </button>
              ))}
            </nav>
          </div>
          <a href="/" className="text-xs font-bold text-slate-400 hover:text-white">Back to portal</a>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'settings' && <SettingsPanel />}
        {tab === 'users' && <Users />}
      </main>
    </div>
  );
}

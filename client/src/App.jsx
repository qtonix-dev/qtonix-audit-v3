import React, { useState, useEffect, useRef } from 'react';
import { API_BASE } from './config.js';

/**
 * Qtonix Site Analysis — agent portal.
 * Single-file default export, no external deps beyond React + Tailwind.
 *
 * Brand: navy #050A1F, orange #FF6A00 -> #FF4500, blue #2563EB, Plus Jakarta Sans.
 */

const SERVICES = ['SEO', 'SMO', 'AI SEO', 'GEO', 'AEO', 'Local SEO'];

const COUNTRIES = [
  { code: 'us', name: 'United States' }, { code: 'uk', name: 'United Kingdom' },
  { code: 'in', name: 'India' }, { code: 'au', name: 'Australia' },
  { code: 'ca', name: 'Canada' }, { code: 'my', name: 'Malaysia' },
  { code: 'sg', name: 'Singapore' }, { code: 'ae', name: 'United Arab Emirates' },
  { code: 'de', name: 'Germany' }, { code: 'nz', name: 'New Zealand' },
  { code: 'ie', name: 'Ireland' }, { code: 'za', name: 'South Africa' },
  { code: 'fr', name: 'France' }, { code: 'es', name: 'Spain' },
  { code: 'it', name: 'Italy' }, { code: 'nl', name: 'Netherlands' },
  { code: 'be', name: 'Belgium' }, { code: 'ch', name: 'Switzerland' },
  { code: 'at', name: 'Austria' }, { code: 'se', name: 'Sweden' },
  { code: 'no', name: 'Norway' }, { code: 'dk', name: 'Denmark' },
  { code: 'fi', name: 'Finland' }, { code: 'pt', name: 'Portugal' },
  { code: 'pl', name: 'Poland' }, { code: 'br', name: 'Brazil' },
  { code: 'mx', name: 'Mexico' }, { code: 'ar', name: 'Argentina' },
  { code: 'jp', name: 'Japan' }, { code: 'kr', name: 'South Korea' },
  { code: 'id', name: 'Indonesia' }, { code: 'ph', name: 'Philippines' },
  { code: 'th', name: 'Thailand' }, { code: 'vn', name: 'Vietnam' },
  { code: 'sa', name: 'Saudi Arabia' }, { code: 'qa', name: 'Qatar' },
];

const api = async (path, opts = {}) => {
  const token = localStorage.getItem('qtx_token');
  const res = await fetch(API_BASE + '/api' + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
};

// ---------------------------------------------------------------------------

function Login({ onSignIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      const data = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      localStorage.setItem('qtx_token', data.token);
      onSignIn(data.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#050A1F] px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-3xl font-extrabold text-white tracking-tight">
            Qtonix<span className="text-[#FF6A00]">.</span>
          </div>
          <p className="text-slate-400 text-sm mt-2">Site Analysis Portal</p>
        </div>

        <div className="bg-white rounded-2xl p-7 shadow-2xl">
          <h1 className="text-xl font-bold text-[#050A1F] mb-1">Sign in</h1>
          <p className="text-sm text-slate-500 mb-6">Run a free site analysis for a prospect.</p>

          {error && (
            <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">
              {error}
            </div>
          )}

          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Email</label>
          <input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-[#FF6A00] focus:border-transparent"
            placeholder="you@qtonix.com"
          />

          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Password</label>
          <input
            type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm mb-6 focus:outline-none focus:ring-2 focus:ring-[#FF6A00] focus:border-transparent"
            placeholder="••••••••"
          />

          <button
            onClick={submit} disabled={busy || !email || !password}
            className="w-full rounded-lg py-2.5 text-sm font-bold text-white disabled:opacity-40 transition"
            style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function NewReport({ user, onQueued }) {
  const [form, setForm] = useState({
    website: '', businessName: '', customerName: '',
    services: ['SEO'], country: 'us', location: '',
  });
  const [error, setError] = useState('');
  const [cachePrompt, setCachePrompt] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const toggleService = (s) =>
    setForm((f) => ({
      ...f,
      services: f.services.includes(s) ? f.services.filter((x) => x !== s) : [...f.services, s],
    }));

  const submit = async (force = false) => {
    setError('');
    setCachePrompt(null);
    setBusy(true);
    try {
      const data = await api('/reports', {
        method: 'POST',
        body: JSON.stringify({ ...form, force }),
      });
      if (data.cached) {
        setCachePrompt(data);
        setBusy(false);
        return;
      }
      onQueued(data.reportId);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const valid = form.website && form.businessName && form.customerName && form.services.length;

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-extrabold text-[#050A1F] tracking-tight">Run a site analysis</h1>
      <p className="text-sm text-slate-500 mt-1 mb-6">
        Takes about two minutes. You'll get a branded PDF ready to send.
      </p>

      {error && (
        <div className="mb-5 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {cachePrompt && (
        <div className="mb-5 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
          <p className="text-sm text-amber-900">{cachePrompt.message}</p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => onQueued(cachePrompt.reportId)}
              className="rounded-md bg-[#050A1F] px-3 py-1.5 text-xs font-bold text-white"
            >
              Open existing report
            </button>
            <button
              onClick={() => submit(true)}
              className="rounded-md border border-amber-400 px-3 py-1.5 text-xs font-bold text-amber-900"
            >
              Run fresh (uses credits)
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Website *</label>
          <input
            value={form.website} onChange={(e) => set('website', e.target.value)}
            placeholder="zuenascrubs.com"
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF6A00]"
          />
          <p className="text-xs text-slate-400 mt-1">No need for https:// — we'll sort it out.</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Business name *</label>
            <input
              value={form.businessName} onChange={(e) => set('businessName', e.target.value)}
              placeholder="Zuena"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF6A00]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Customer name *</label>
            <input
              value={form.customerName} onChange={(e) => set('customerName', e.target.value)}
              placeholder="Linda"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF6A00]"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-2">
            Services this customer might want *
          </label>
          <div className="flex flex-wrap gap-2">
            {SERVICES.map((s) => {
              const on = form.services.includes(s);
              return (
                <button
                  key={s} onClick={() => toggleService(s)} type="button"
                  className={`rounded-full px-4 py-1.5 text-xs font-bold border transition ${
                    on ? 'text-[#050A1F] border-transparent' : 'text-slate-500 border-slate-300 hover:border-slate-400'
                  }`}
                  style={on ? { background: 'linear-gradient(90deg,#FF6A00,#FF4500)' } : {}}
                >
                  {s}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-slate-400 mt-2">
            These shape the report's roadmap. AI visibility is always tested — it's our strongest hook.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Target market</label>
            <select
              value={form.country} onChange={(e) => set('country', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF6A00]"
            >
              {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">
              Location <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              value={form.location} onChange={(e) => set('location', e.target.value)}
              placeholder="Kuala Lumpur"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF6A00]"
            />
          </div>
        </div>

        <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
          <p className="text-xs text-slate-400">
            Running as <span className="font-semibold text-slate-600">{user.name}</span>
          </p>
          <button
            onClick={() => submit(false)} disabled={!valid || busy}
            className="rounded-lg px-6 py-2.5 text-sm font-bold text-white disabled:opacity-40 transition"
            style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}
          >
            {busy ? 'Starting…' : 'Generate report'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Progress({ reportId, onDone, onBack }) {
  const [state, setState] = useState({ status: 'queued', progress: 0, step: 'Starting…' });
  const esRef = useRef(null);

  useEffect(() => {
    // SSE can't send an Authorization header, so poll instead. Simpler, and the
    // payload is tiny.
    let stop = false;
    const poll = async () => {
      if (stop) return;
      try {
        const r = await api(`/reports/${reportId}`);
        setState({ status: r.status, progress: r.progress, step: r.currentStep, error: r.error });
        if (r.status === 'complete') return onDone(r);
        if (r.status === 'failed') return;
      } catch { /* keep polling through transient errors */ }
      setTimeout(poll, 2000);
    };
    poll();
    return () => { stop = true; if (esRef.current) esRef.current.close(); };
  }, [reportId]);

  if (state.status === 'failed') {
    return (
      <div className="max-w-lg">
        <div className="bg-white rounded-2xl border border-red-200 p-7 text-center">
          <div className="text-4xl mb-3">⚠️</div>
          <h2 className="text-lg font-bold text-[#050A1F]">That report didn't finish</h2>
          <p className="text-sm text-slate-500 mt-2">{state.error}</p>
          <div className="flex gap-2 justify-center mt-5">
            <button
              onClick={async () => { await api(`/reports/${reportId}/retry`, { method: 'POST' }); window.location.reload(); }}
              className="rounded-lg bg-[#050A1F] px-4 py-2 text-xs font-bold text-white"
            >
              Try again
            </button>
            <button onClick={onBack} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-600">
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg">
      <div className="bg-white rounded-2xl border border-slate-200 p-7">
        <h2 className="text-lg font-bold text-[#050A1F]">Building the report</h2>
        <p className="text-sm text-slate-500 mt-1 mb-6">
          We're crawling the site, pulling live search data, and testing how AI assistants see them.
        </p>

        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${state.progress}%`, background: 'linear-gradient(90deg,#2563EB,#FF6A00)' }}
          />
        </div>

        <div className="flex justify-between mt-3">
          <span className="text-xs font-semibold text-slate-600">{state.step}</span>
          <span className="text-xs font-bold text-[#FF6A00]">{state.progress}%</span>
        </div>

        <p className="text-xs text-slate-400 mt-6 text-center">
          This usually takes 1–3 minutes. You can leave this page — it'll be in your reports list.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const StatusPill = ({ status }) => {
  const map = {
    complete: 'bg-green-100 text-green-700',
    running: 'bg-blue-100 text-blue-700',
    queued: 'bg-slate-100 text-slate-600',
    failed: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${map[status]}`}>
      {status}
    </span>
  );
};

function ReportList({ isAdmin, onOpen }) {
  const [data, setData] = useState({ items: [], total: 0, pages: 1 });
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setData(await api(`/reports?page=${page}&limit=15${q ? `&q=${encodeURIComponent(q)}` : ''}`));
    } catch { /* surfaced by empty state */ }
    setLoading(false);
  };

  useEffect(() => { load(); }, [page]);
  useEffect(() => { const t = setTimeout(() => { setPage(1); load(); }, 350); return () => clearTimeout(t); }, [q]);

  const download = async (id, name) => {
    const token = localStorage.getItem('qtx_token');
    const res = await fetch(`${API_BASE}/api/reports/${id}/download`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return alert('That PDF isn\'t ready yet.');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/[^a-z0-9]/gi, '-')}-Site-Analysis.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-extrabold text-[#050A1F] tracking-tight">
            {isAdmin ? 'All reports' : 'Your reports'}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">{data.total} total</p>
        </div>
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search business or domain…"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-[#FF6A00]"
        />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="text-left text-xs font-bold text-slate-500 uppercase">
              <th className="px-4 py-3">Business</th>
              <th className="px-4 py-3">Website</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">Services</th>
              {isAdmin && <th className="px-4 py-3">Agent</th>}
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400 text-sm">Loading…</td></tr>
            )}
            {!loading && !data.items.length && (
              <tr><td colSpan={8} className="px-4 py-12 text-center">
                <p className="text-slate-500 text-sm font-medium">No reports yet</p>
                <p className="text-slate-400 text-xs mt-1">Run your first analysis to see it here.</p>
              </td></tr>
            )}
            {data.items.map((r) => (
              <tr key={r._id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="font-semibold text-[#050A1F]">{r.businessName}</div>
                  <div className="text-xs text-slate-400">{r.customerName}</div>
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs">{r.domain}</td>
                <td className="px-4 py-3">
                  {r.scores && r.scores.overall != null ? (
                    <span className={`font-extrabold ${
                      r.scores.overall >= 65 ? 'text-green-600' : r.scores.overall >= 45 ? 'text-amber-500' : 'text-red-600'
                    }`}>{r.scores.overall}</span>
                  ) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {r.services.slice(0, 2).map((s) => (
                      <span key={s} className="rounded bg-orange-50 text-[#FF4500] px-1.5 py-0.5 text-[10px] font-bold">{s}</span>
                    ))}
                    {r.services.length > 2 && <span className="text-[10px] text-slate-400">+{r.services.length - 2}</span>}
                  </div>
                </td>
                {isAdmin && <td className="px-4 py-3 text-xs text-slate-500">{r.agentName}</td>}
                <td className="px-4 py-3"><StatusPill status={r.status} /></td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {new Date(r.createdAt).toLocaleDateString('en-GB')}
                </td>
                <td className="px-4 py-3 text-right">
                  {r.status === 'complete' && (
                    <div className="flex gap-1.5 justify-end">
                      <button onClick={() => onOpen(r)} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-bold text-slate-600 hover:border-slate-400">
                        View
                      </button>
                      <button onClick={() => download(r._id, r.businessName)}
                        className="rounded-md px-2.5 py-1 text-xs font-bold text-white"
                        style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>
                        PDF
                      </button>
                    </div>
                  )}
                  {r.status === 'failed' && (
                    <button onClick={async () => { await api(`/reports/${r._id}/retry`, { method: 'POST' }); load(); }}
                      className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-bold text-red-600">
                      Retry
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.pages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 disabled:opacity-30">
            Previous
          </button>
          <span className="px-3 py-1.5 text-xs text-slate-500">Page {page} of {data.pages}</span>
          <button disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 disabled:opacity-30">
            Next
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('new');
  const [activeReport, setActiveReport] = useState(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('qtx_token');
    if (!token) return setBooting(false);
    api('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => localStorage.removeItem('qtx_token'))
      .finally(() => setBooting(false));
  }, []);

  if (booting) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-400 text-sm">Loading…</div>;
  }
  if (!user) return <Login onSignIn={setUser} />;

  const signOut = () => { localStorage.removeItem('qtx_token'); setUser(null); };
  const isAdmin = user.role === 'admin';

  const nav = [
    { id: 'new', label: 'New report' },
    { id: 'list', label: isAdmin ? 'All reports' : 'My reports' },
  ];

  return (
    <div className="min-h-screen bg-slate-50" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <header className="bg-[#050A1F] border-b border-white/10">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="text-lg font-extrabold text-white tracking-tight">
              Qtonix<span className="text-[#FF6A00]">.</span>
            </div>
            <nav className="flex gap-1">
              {nav.map((n) => (
                <button key={n.id}
                  onClick={() => { setView(n.id); setActiveReport(null); }}
                  className={`rounded-md px-3 py-1.5 text-xs font-bold transition ${
                    view === n.id ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'
                  }`}>
                  {n.label}
                </button>
              ))}
              {isAdmin && (
                <a href="/admin" className="rounded-md px-3 py-1.5 text-xs font-bold text-slate-400 hover:text-white">
                  Admin
                </a>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-xs font-semibold text-white">{user.name}</div>
              <div className="text-[10px] text-slate-400">{user.designation}</div>
            </div>
            <button onClick={signOut} className="text-xs font-bold text-slate-400 hover:text-white">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {view === 'new' && !activeReport && (
          <NewReport user={user} onQueued={(id) => { setActiveReport({ _id: id }); setView('progress'); }} />
        )}
        {view === 'progress' && activeReport && (
          <Progress
            reportId={activeReport._id}
            onDone={() => setView('list')}
            onBack={() => { setActiveReport(null); setView('new'); }}
          />
        )}
        {view === 'list' && (
          <ReportList isAdmin={isAdmin} onOpen={(r) => window.open(`${API_BASE}/api/reports/${r._id}/view`, '_blank')} />
        )}
      </main>
    </div>
  );
}

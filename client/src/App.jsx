import React, { useState, useEffect, useRef } from 'react';
import { API_BASE } from './config.js';
import Leads from './Leads.jsx';

/**
 * Qtonix Site Analysis — agent portal.
 * Single-file default export, no external deps beyond React + Tailwind.
 *
 * Brand: navy #050A1F, orange #FF6A00 -> #FF4500, blue #2563EB, Plus Jakarta Sans.
 */

const SERVICES = ['SEO', 'SMO', 'AI SEO', 'GEO', 'AEO', 'Local SEO'];

// CRM pipeline stages and request tags (mirror the sandbox).
const STAGES = [
  { id: 'new', label: 'New lead', color: '#64748B' },
  { id: 'hot', label: 'Hot', color: '#EA580C' },
  { id: 'cold', label: 'Cold', color: '#0891B2' },
  { id: 'ni', label: 'Not interested', color: '#94A3B8' },
  { id: 'contacted', label: 'Contacted', color: '#2563EB' },
  { id: 'interested', label: 'Interested', color: '#0891B2' },
  { id: 'proposal', label: 'Proposal sent', color: '#F59E0B' },
  { id: 'negotiation', label: 'Negotiating', color: '#FF6A00' },
  { id: 'won', label: 'Won', color: '#16A34A' },
  { id: 'lost', label: 'Lost', color: '#DC2626' },
];
const REQUESTS = ['Wants pricing', 'Wants a call', 'Needs approval', 'Comparing agencies', 'Budget constrained', 'Wants case studies', 'Ready to start', 'Follow up later'];
const crmInput = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400';

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

export const api = async (path, opts = {}) => {
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
    customerPhone: '', customerEmail: '', customerCountry: '', customerCompany: '',
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

  const valid = form.website && form.businessName && form.customerName && form.services.length
    && form.customerPhone && form.customerEmail;

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

        <div className="pt-4 border-t border-slate-100">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-sm font-bold text-[#050A1F]">Customer details</h3>
            <span className="rounded bg-red-50 text-red-600 px-1.5 py-0.5 text-[9px] font-bold">REQUIRED</span>
          </div>
          <p className="text-xs text-slate-400 mb-3">Capture the lead's contact details before running the report. Phone and email are required.</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Customer phone *</label>
              <input value={form.customerPhone} onChange={(e) => set('customerPhone', e.target.value)} placeholder="+91-…"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF6A00]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Customer email *</label>
              <input value={form.customerEmail} onChange={(e) => set('customerEmail', e.target.value)} placeholder="name@company.com"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF6A00]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Customer country</label>
              <input value={form.customerCountry} onChange={(e) => set('customerCountry', e.target.value)} placeholder="Malaysia"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF6A00]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Customer company</label>
              <input value={form.customerCompany} onChange={(e) => set('customerCompany', e.target.value)} placeholder="Company Ltd."
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF6A00]" />
            </div>
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
  const [q, setQ] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('q') || ''; }
    catch { return ''; }
  });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [customerModal, setCustomerModal] = useState(null);
  const [leadModal, setLeadModal] = useState(null);
  const [remarkModal, setRemarkModal] = useState(null);
  const [leadEditing, setLeadEditing] = useState(false);

  const saveCrm = async (id, patch) => {
    try {
      const updated = await api(`/reports/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      setData((d) => ({ ...d, items: d.items.map((r) => (r._id === id ? { ...r, ...updated } : r)) }));
      if (leadModal && leadModal._id === id) setLeadModal((l) => ({ ...l, ...updated }));
      return updated;
    } catch (e) { alert(e.message); }
  };

  const addRemark = async (id, text) => {
    if (!text.trim()) return;
    try {
      const updated = await api(`/reports/${id}/remark`, { method: 'POST', body: JSON.stringify({ text }) });
      setData((d) => ({ ...d, items: d.items.map((r) => (r._id === id ? { ...r, ...updated } : r)) }));
      if (leadModal && leadModal._id === id) setLeadModal((l) => ({ ...l, ...updated }));
    } catch (e) { alert(e.message); }
  };

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

      {loading && <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-400 text-sm">Loading…</div>}
      {!loading && !data.items.length && (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <p className="text-slate-500 text-sm font-medium">No reports yet</p>
          <p className="text-slate-400 text-xs mt-1">Run your first analysis to see it here.</p>
        </div>
      )}

      <div className="space-y-3">
        {data.items.map((r) => {
          const st = STAGES.find((s) => s.id === r.stage) || STAGES[0];
          return (
            <div key={r._id} className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-4">
                <div className="text-center shrink-0">
                  <div className="text-2xl font-extrabold leading-none" style={{ color: r.scores && r.scores.overall >= 65 ? '#16A34A' : r.scores && r.scores.overall >= 45 ? '#E58A24' : '#E5484D' }}>{r.scores && r.scores.overall != null ? r.scores.overall : '—'}</div>
                  <div className="text-[8px] text-slate-400 font-bold tracking-wider mt-0.5">SCORE</div>
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-sm text-[#050A1F] truncate">{r.businessName} <span className="text-slate-400 font-normal">— {r.customerName}</span></div>
                  <div className="text-xs text-slate-500 mt-0.5">{r.domain}</div>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className="text-[10px] text-slate-400">{new Date(r.createdAt).toLocaleDateString('en-GB')}</span>
                    {isAdmin && <span className="text-[10px] text-slate-400">· {r.agentName}</span>}
                    <StatusPill status={r.status} />
                    {(r.services || []).map((s) => <span key={s} className="rounded px-1.5 py-0.5 text-[9px] font-bold bg-orange-50 text-[#FF4500]">{s}</span>)}
                  </div>
                </div>
              </div>

              {/* Action bar — its own full-width row so buttons never wrap to a 2nd line */}
              <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1">
                <select value={r.stage || 'new'} onChange={(e) => saveCrm(r._id, { stage: e.target.value })}
                  className="rounded-full px-3 py-1.5 text-[10px] font-extrabold border-0 cursor-pointer text-white shrink-0" style={{ background: st.color }}>
                  {STAGES.map((s) => <option key={s.id} value={s.id} style={{ background: '#fff', color: '#000' }}>{s.label}</option>)}
                </select>
                <button onClick={() => setLeadModal(r)} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:border-slate-400 inline-flex items-center gap-1 shrink-0">
                  <span aria-hidden>👤</span> View lead
                </button>
                <button onClick={() => setRemarkModal({ report: r, text: '' })} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:border-slate-400 inline-flex items-center gap-1 shrink-0">
                  <span aria-hidden>📝</span> Add remark
                </button>
                {r.status === 'complete' && (
                  <>
                    <button onClick={() => onOpen(r)} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:border-slate-400 inline-flex items-center gap-1 shrink-0">
                      <span aria-hidden>👁️</span> View report
                    </button>
                    <button onClick={() => download(r._id, r.businessName)} className="rounded-md px-2.5 py-1.5 text-xs font-bold text-white inline-flex items-center gap-1 shrink-0" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>
                      <span aria-hidden>⬇️</span> Download PDF
                    </button>
                  </>
                )}
                {r.status === 'failed' && (
                  <button onClick={async () => { await api(`/reports/${r._id}/retry`, { method: 'POST' }); load(); }} className="rounded-md border border-red-300 px-2.5 py-1.5 text-xs font-bold text-red-600 inline-flex items-center gap-1 shrink-0">
                    <span aria-hidden>🔄</span> Retry
                  </button>
                )}
              </div>

              {/* Latest activity — newest remark / stage change / request change */}
              <div className="mt-3 pt-3 border-t border-slate-100 flex items-start gap-2">
                <div className="text-[10px] font-bold text-slate-500 shrink-0 mt-0.5">Latest activity:</div>
                <div className="flex-1 min-w-0">
                  {(() => {
                    const acts = Array.isArray(r.activity) ? r.activity : [];
                    const last = acts[acts.length - 1];
                    if (last) {
                      const icon = last.type === 'stage' ? '🏷️' : last.type === 'request' ? '💬' : '📝';
                      return <div className="text-xs text-slate-600"><span>{icon} {last.text}</span><span className="text-[10px] text-slate-400 ml-2">— {last.author} · {new Date(last.time).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}{acts.length > 1 ? ` · ${acts.length} events` : ''}</span></div>;
                    }
                    const hist = Array.isArray(r.remarks) ? r.remarks : [];
                    const lr = hist[hist.length - 1];
                    if (lr) return <div className="text-xs text-slate-600">📝 {lr.text}<span className="text-[10px] text-slate-400 ml-2">— {lr.author}</span></div>;
                    if (r.remark) return <div className="text-xs text-slate-600">{r.remark}</div>;
                    return <div className="text-xs text-slate-400 italic">No activity yet — change the status or add a remark.</div>;
                  })()}
                </div>
                {r.tags && r.tags[0] && <span className="rounded-full bg-blue-50 text-blue-600 px-2 py-0.5 text-[9px] font-bold shrink-0">{r.tags[0]}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {customerModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setCustomerModal(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-[#050A1F] text-lg mb-1">Customer details</h3>
            <p className="text-xs text-slate-400 mb-4">{customerModal.businessName}</p>
            <div className="space-y-3">
              <div><label className="block text-xs font-semibold text-slate-600 mb-1.5">Customer name</label><input className={crmInput} value={customerModal.customerName || ''} onChange={(e) => setCustomerModal({ ...customerModal, customerName: e.target.value })} /></div>
              <div><label className="block text-xs font-semibold text-slate-600 mb-1.5">Phone</label><input className={crmInput} value={customerModal.customerPhone || ''} onChange={(e) => setCustomerModal({ ...customerModal, customerPhone: e.target.value })} /></div>
              <div><label className="block text-xs font-semibold text-slate-600 mb-1.5">Email</label><input className={crmInput} value={customerModal.customerEmail || ''} onChange={(e) => setCustomerModal({ ...customerModal, customerEmail: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-semibold text-slate-600 mb-1.5">Country</label><input className={crmInput} value={customerModal.customerCountry || ''} onChange={(e) => setCustomerModal({ ...customerModal, customerCountry: e.target.value })} /></div>
                <div><label className="block text-xs font-semibold text-slate-600 mb-1.5">Company</label><input className={crmInput} value={customerModal.customerCompany || ''} onChange={(e) => setCustomerModal({ ...customerModal, customerCompany: e.target.value })} /></div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setCustomerModal(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
              <button onClick={async () => { await saveCrm(customerModal._id, { customerName: customerModal.customerName, customerPhone: customerModal.customerPhone, customerEmail: customerModal.customerEmail, customerCountry: customerModal.customerCountry, customerCompany: customerModal.customerCompany }); setCustomerModal(null); }} className="rounded-lg bg-[#050A1F] px-5 py-2 text-sm font-bold text-white">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ADD REMARK popup */}
      {remarkModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setRemarkModal(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-[#050A1F] text-lg mb-1">Add remark</h3>
            <p className="text-xs text-slate-400 mb-4">{remarkModal.report.businessName} — {remarkModal.report.customerName}</p>
            <textarea rows={4} autoFocus value={remarkModal.text} placeholder="Call notes, next step, objection…"
              onChange={(e) => setRemarkModal({ ...remarkModal, text: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
            <p className="text-[11px] text-slate-400 mt-1">Saved with a timestamp. Previous remarks are kept — view them under "View lead".</p>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setRemarkModal(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
              <button onClick={async () => { await addRemark(remarkModal.report._id, remarkModal.text); setRemarkModal(null); }} disabled={!remarkModal.text.trim()} className="rounded-lg bg-[#050A1F] px-5 py-2 text-sm font-bold text-white disabled:opacity-40">Save remark</button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW LEAD popup — all details, edit, remark history */}
      {leadModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => { setLeadModal(null); setLeadEditing(false); }}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-bold text-[#050A1F] text-lg">{leadModal.businessName}</h3>
                <p className="text-xs text-slate-400">{leadModal.domain}</p>
              </div>
              <button onClick={() => setLeadEditing((v) => !v)} className="rounded-md border border-slate-300 px-3 py-1 text-xs font-bold text-slate-600 hover:border-slate-400">{leadEditing ? 'Done editing' : '✏️ Edit'}</button>
            </div>

            {/* Details */}
            <div className="grid grid-cols-2 gap-3 mb-5">
              {[['customerName', 'Customer name'], ['customerPhone', 'Phone'], ['customerEmail', 'Email'], ['customerCountry', 'Country'], ['customerCompany', 'Company']].map(([k, l]) => (
                <div key={k}>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">{l}</div>
                  {leadEditing
                    ? <input className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={leadModal[k] || ''} onChange={(e) => setLeadModal({ ...leadModal, [k]: e.target.value })} />
                    : <div className="text-sm text-slate-700">{leadModal[k] || <span className="text-slate-300">—</span>}</div>}
                </div>
              ))}
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">What they asked for</div>
                <select className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  value={(leadModal.tags && leadModal.tags[0]) || ''}
                  onChange={(e) => { const tags = e.target.value ? [e.target.value] : []; setLeadModal({ ...leadModal, tags }); saveCrm(leadModal._id, { tags }); }}>
                  <option value="">— Select —</option>{REQUESTS.map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
            </div>

            {leadEditing && (
              <div className="flex justify-end mb-5">
                <button onClick={async () => { await saveCrm(leadModal._id, { customerName: leadModal.customerName, customerPhone: leadModal.customerPhone, customerEmail: leadModal.customerEmail, customerCountry: leadModal.customerCountry, customerCompany: leadModal.customerCompany, tags: leadModal.tags || [] }); setLeadEditing(false); }} className="rounded-lg bg-[#050A1F] px-5 py-2 text-sm font-bold text-white">Save details</button>
              </div>
            )}

            {/* Activity timeline — remarks + status + request changes, newest first */}
            <div className="border-t border-slate-100 pt-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold text-[#050A1F]">Activity timeline</h4>
                <button onClick={() => setRemarkModal({ report: leadModal, text: '' })} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-bold text-slate-600 hover:border-slate-400">📝 Add remark</button>
              </div>
              {(() => {
                let acts = Array.isArray(leadModal.activity) ? [...leadModal.activity] : [];
                // Back-compat: if no unified activity yet, fall back to remarks/legacy remark.
                if (!acts.length) {
                  const hist = Array.isArray(leadModal.remarks) ? leadModal.remarks : [];
                  acts = hist.map((rm) => ({ ...rm, type: 'remark' }));
                  if (leadModal.remark && !acts.length) acts.push({ type: 'remark', text: leadModal.remark, time: leadModal.createdAt, author: leadModal.agentName || '' });
                }
                if (!acts.length) return <p className="text-xs text-slate-400 italic">No activity yet.</p>;
                const meta = { stage: { icon: '🏷️', label: 'Status' }, request: { icon: '💬', label: 'Request' }, remark: { icon: '📝', label: 'Remark' } };
                return <div className="space-y-2 max-h-64 overflow-auto">
                  {acts.slice().reverse().map((a, i) => {
                    const m = meta[a.type] || meta.remark;
                    return (
                      <div key={i} className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                        <div className="text-sm text-slate-700"><span className="mr-1">{m.icon}</span>{a.text}</div>
                        <div className="text-[10px] text-slate-400 mt-1">{m.label} · {a.author || '—'} · {new Date(a.time).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                      </div>
                    );
                  })}
                </div>;
              })()}
            </div>

            <div className="flex justify-end mt-5">
              <button onClick={() => { setLeadModal(null); setLeadEditing(false); }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Close</button>
            </div>
          </div>
        </div>
      )}

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
  const [view, setView] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('q') ? 'list' : 'new'; }
    catch { return 'new'; }
  });
  const [activeReport, setActiveReport] = useState(null);
  const [booting, setBooting] = useState(true);
  const [dueCount, setDueCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    const poll = () => api('/leads/reminders/count').then((d) => alive && setDueCount(d.due || 0)).catch(() => {});
    poll();
    const t = setInterval(poll, 60000); // refresh every minute
    return () => { alive = false; clearInterval(t); };
  }, [user]);

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
    { id: 'leads', label: 'Leads' },
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
                  className={`relative rounded-md px-3 py-1.5 text-xs font-bold transition ${
                    view === n.id ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'
                  }`}>
                  {n.label}
                  {n.id === 'leads' && dueCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[#FF4500] text-white text-[9px] font-bold flex items-center justify-center">{dueCount}</span>
                  )}
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
        {view === 'leads' && <Leads user={user} />}
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
          <ReportList isAdmin={isAdmin} onOpen={(r) => { setActiveReport(r); setView('report'); }} />
        )}
        {view === 'report' && activeReport && (
          <div>
            <div className="flex justify-between items-start mb-4 flex-wrap gap-3">
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight text-[#050A1F]">{activeReport.businessName} — Site Analysis</h1>
                <p className="text-sm text-slate-500 mt-0.5">
                  Score {activeReport.scores && activeReport.scores.overall != null ? activeReport.scores.overall : '—'}/100
                  {' · '}{activeReport.issueCounts ? activeReport.issueCounts.total : (activeReport.data && activeReport.data.issueCounts ? activeReport.data.issueCounts.total : '—')} issues
                  {activeReport.creditsUsed != null ? ` · ${activeReport.creditsUsed.toLocaleString()} credits` : ''}
                  {' · '}{new Date(activeReport.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setActiveReport(null); setView('list'); }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600 hover:border-slate-400">Back to reports</button>
                <button onClick={async () => {
                  const token = localStorage.getItem('qtx_token');
                  const res = await fetch(`${API_BASE}/api/reports/${activeReport._id}/download`, { headers: { Authorization: `Bearer ${token}` } });
                  if (!res.ok) return alert("That PDF isn't ready yet.");
                  const blob = await res.blob(); const url = URL.createObjectURL(blob);
                  const a = document.createElement('a'); a.href = url; a.download = `${activeReport.businessName.replace(/[^a-z0-9]/gi, '-')}-Site-Analysis.pdf`; a.click(); URL.revokeObjectURL(url);
                }} className="rounded-lg px-5 py-2 text-sm font-bold text-white" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>↓ Download PDF</button>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white" style={{ height: '80vh' }}>
              <iframe title="report" src={`${API_BASE}/api/reports/${activeReport._id}/view?token=${encodeURIComponent(localStorage.getItem('qtx_token') || '')}`} className="w-full h-full border-0" />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

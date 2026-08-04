import React, { useState, useEffect, useRef } from 'react';
import { API_BASE } from './config.js';
import { APP_BUILD } from './version.js';
import Leads from './Leads.jsx';
import { CountryCombobox, PhoneField, Pagination, Icon, MailEditor } from './Leads.jsx';
import { formatPhone } from './countries.js';
import Dashboard, { EmailDraftsPage } from './Dashboard.jsx';
import Analytics from './Analytics.jsx';
import Reviews from './Reviews.jsx';
import MotivatorTV from './MotivatorTV.jsx';
import AiBriefPage from './AiBriefPage.jsx';
import AllEmailPage from './AllEmailPage.jsx';

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

/**
 * Training mode. When the app is opened at /demo-app/<token> every component
 * keeps calling api('/leads') exactly as before, but the request is rewritten
 * to /api/demo-app/<token>/leads and answered with fabricated data. Because the
 * redirect happens here — the single choke point every screen already uses — no
 * individual component needs to know it is running in a demo.
 */
export const DEMO_TOKEN = (() => {
  const m = typeof window !== 'undefined' && window.location.pathname.match(/^\/demo-app\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
})();
export const IS_DEMO = !!DEMO_TOKEN;
// Which seat the demo is being shown from: ?role=agent|manager|admin.
export const DEMO_ROLE = (() => {
  if (typeof window === 'undefined') return 'manager';
  const r = new URLSearchParams(window.location.search).get('role');
  return ['agent', 'manager', 'admin', 'leadmanager'].includes(r) ? r : 'manager';
})();

export const api = async (path, opts = {}) => {
  const token = localStorage.getItem('qtx_token');
  if (DEMO_TOKEN) {
    const [base, qs] = path.split('?');
    const params = new URLSearchParams(qs || '');
    params.set('role', DEMO_ROLE); // keeps server-side scoping in step with the UI
    const res = await fetch(`${API_BASE}/api/demo-app/${DEMO_TOKEN}${base}?${params.toString()}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Not available in the demo.');
    return data;
  }
  const res = await fetch(API_BASE + '/api' + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong.');
    err.data = data; // keep structured fields (e.g. duplicate lead info)
    err.status = res.status;
    throw err;
  }
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
          <p className="text-slate-400 text-sm mt-2">QHub CRM &amp; Lead Management</p>
        </div>

        <div className="bg-white rounded-2xl p-7 shadow-2xl">
          <h1 className="text-xl font-bold text-[#050A1F] mb-1">Sign in</h1>
          <p className="text-sm text-slate-500 mb-6">Your all-in-one workspace for leads, deals, and sales.</p>

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

        {/* Separate entrance to the HR portal (HR staff + admins). */}
        <div className="text-center mt-5">
          <a href="/hr/login" className="text-xs font-bold text-slate-400 hover:text-[#FF6A00] transition">HR Portal →</a>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function NewReport({ user, initialLeadId, onQueued, onBack }) {
  const [form, setForm] = useState({
    website: '', businessName: '', customerName: '',
    services: ['SEO'], country: 'us', location: '',
    customerPhone: '', customerEmail: '', customerCountry: '',
    leadId: null,
  });
  const [sourceMode, setSourceMode] = useState('new'); // 'new' | 'lead'
  const [leads, setLeads] = useState([]);
  const [leadPick, setLeadPick] = useState('');
  const [error, setError] = useState('');
  const [cachePrompt, setCachePrompt] = useState(null);
  const [conflictPrompt, setConflictPrompt] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // If arriving from a lead's "Run report" button, switch to lead mode and
  // pre-fill from that lead immediately.
  useEffect(() => {
    if (initialLeadId) {
      setSourceMode('lead');
      pickLead(initialLeadId);
    }
    // eslint-disable-next-line
  }, [initialLeadId]);

  // Load the user's leads when they switch to "From an existing lead".
  useEffect(() => {
    if (sourceMode === 'lead' && leads.length === 0) {
      api('/leads').then((r) => setLeads(r.items || [])).catch(() => {});
    }
  }, [sourceMode]);

  // When a lead is picked, auto-fill the form from its data.
  const pickLead = async (id) => {
    setLeadPick(id);
    if (!id) { set('leadId', null); return; }
    try {
      const { lead } = await api(`/leads/${id}`);
      const name = `${lead.firstName || ''} ${lead.lastName || ''}`.trim();
      setForm((f) => ({
        ...f,
        leadId: lead._id,
        website: lead.website || f.website,
        businessName: lead.firstName ? (name || lead.website) : f.businessName,
        customerName: name || f.customerName,
        customerPhone: lead.mobile || lead.phone || f.customerPhone,
        customerEmail: lead.email || f.customerEmail,
        customerCountry: lead.country || f.customerCountry,
      }));
    } catch (e) { setError(e.message); }
  };

  const toggleService = (s) =>
    setForm((f) => ({
      ...f,
      services: f.services.includes(s) ? f.services.filter((x) => x !== s) : [...f.services, s],
    }));

  const submit = async (force = false, confirmDuplicate = false) => {
    setError('');
    setCachePrompt(null);
    setBusy(true);
    try {
      const data = await api('/reports', {
        method: 'POST',
        body: JSON.stringify({ ...form, force, confirmDuplicate }),
      });
      if (data.cached) {
        setCachePrompt(data);
        setBusy(false);
        return;
      }
      // A lead with this website already belongs to another agent — ask before
      // creating a duplicate lead under the current agent.
      if (data.ownerConflict && !confirmDuplicate) {
        setConflictPrompt({ reportId: data.reportId, owner: data.ownerConflict.existingOwner });
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
      {onBack && <button onClick={onBack} className="text-sm font-bold text-slate-500 hover:text-slate-700 mb-3">← Back to reports</button>}
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

      {conflictPrompt && (
        <div className="mb-5 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
          <p className="text-sm text-blue-900">
            A lead for this website already belongs to <b>{conflictPrompt.owner}</b>. Your report has been generated, but it isn't linked to a lead yet.
          </p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => onQueued(conflictPrompt.reportId)}
              className="rounded-md bg-[#050A1F] px-3 py-1.5 text-xs font-bold text-white"
            >
              Continue without a duplicate
            </button>
            <button
              onClick={() => { setConflictPrompt(null); submit(false, true); }}
              className="rounded-md border border-blue-400 px-3 py-1.5 text-xs font-bold text-blue-900"
            >
              Create a duplicate lead for me
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
        {/* Source: brand-new report, or pull details from an existing lead */}
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Report for</label>
          <div className="flex gap-2">
            <button type="button" onClick={() => { setSourceMode('new'); setLeadPick(''); set('leadId', null); }}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-bold border ${sourceMode === 'new' ? 'bg-[#050A1F] text-white border-transparent' : 'text-slate-500 border-slate-200'}`}>New</button>
            <button type="button" onClick={() => setSourceMode('lead')}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-bold border ${sourceMode === 'lead' ? 'bg-[#050A1F] text-white border-transparent' : 'text-slate-500 border-slate-200'}`}>From an existing lead</button>
          </div>
          {sourceMode === 'lead' && (
            <div className="mt-3">
              <select value={leadPick} onChange={(e) => pickLead(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF6A00]">
                <option value="">— Select a lead —</option>
                {leads.map((l) => <option key={l._id} value={l._id}>{`${l.firstName || ''} ${l.lastName || ''}`.trim()}{l.website ? ` · ${l.website}` : ''}</option>)}
              </select>
              {form.leadId && <p className="text-xs text-green-600 mt-1">✓ Details filled from the lead. This report will link back to it.</p>}
            </div>
          )}
        </div>

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
              <PhoneField value={form.customerPhone} country={form.customerCountry} onChange={(v) => set('customerPhone', v)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF6A00]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Customer email *</label>
              <input value={form.customerEmail} onChange={(e) => set('customerEmail', e.target.value)} placeholder="name@company.com"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF6A00]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Customer country</label>
              <CountryCombobox value={form.customerCountry} onChange={(v) => { set('customerCountry', v); if (form.customerPhone) set('customerPhone', formatPhone(form.customerPhone, v)); }}
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

// Attach an existing, unlinked report to a lead. Searches leads by name/website
// and links the chosen one via PATCH /reports/:id/link.
function LinkToLeadModal({ report, onClose, onLinked }) {
  const [q, setQ] = useState(report.businessName || report.domain || '');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  const search = async () => {
    setSearching(true); setError('');
    try {
      const r = await api(`/leads/search?q=${encodeURIComponent(q)}`);
      setResults(r.leads || []);
    } catch (e) { setError(e.message); }
    setSearching(false);
  };
  useEffect(() => { search(); /* eslint-disable-next-line */ }, []);

  const link = async (lead) => {
    setBusyId(lead._id); setError('');
    try {
      await api(`/reports/${report._id}/link`, { method: 'PATCH', body: JSON.stringify({ leadId: lead._id }) });
      onLinked(lead);
    } catch (e) { setError(e.message); setBusyId(null); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-lg max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-extrabold text-[#050A1F] mb-1">Link report to a lead</h3>
        <p className="text-xs text-slate-400 mb-4">{report.businessName || report.domain}</p>
        {error && <div className="mb-3 rounded-lg bg-red-50 text-red-600 text-sm px-3 py-2">{error}</div>}
        <div className="flex gap-2 mb-4">
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="Search lead by name or website…"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
          <button onClick={search} className="rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>Search</button>
        </div>
        {searching ? (
          <div className="text-slate-400 text-sm py-6 text-center">Searching…</div>
        ) : results.length === 0 ? (
          <div className="text-slate-400 text-sm py-6 text-center">No matching leads.</div>
        ) : (
          <div className="space-y-2">
            {results.map((l) => (
              <div key={l._id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                <div className="min-w-0">
                  <div className="font-bold text-sm text-[#050A1F] truncate">{l.name}</div>
                  <div className="text-[11px] text-slate-400 truncate">{l.website || '—'} · {l.ownerName || 'unassigned'}</div>
                </div>
                <button onClick={() => link(l)} disabled={busyId === l._id}
                  className="rounded-md px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40 shrink-0" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>
                  {busyId === l._id ? 'Linking…' : 'Link'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ReportList({ isAdmin, onOpen, onNewReport }) {
  const [data, setData] = useState({ items: [], total: 0, pages: 1 });
  const [q, setQ] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('q') || ''; }
    catch { return ''; }
  });
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [loading, setLoading] = useState(true);
  const [linkReport, setLinkReport] = useState(null); // report being linked to a lead from the list

  const load = async () => {
    setLoading(true);
    try {
      setData(await api(`/reports?page=${page}&limit=${perPage}${q ? `&q=${encodeURIComponent(q)}` : ''}`));
    } catch { /* surfaced by empty state */ }
    setLoading(false);
  };

  useEffect(() => { load(); }, [page, perPage]);
  useEffect(() => { const t = setTimeout(() => { setPage(1); load(); }, 350); return () => clearTimeout(t); }, [q]);

  const download = async (id, name) => {
    if (IS_DEMO) {
      alert('Sample reports have no PDF behind them. In the live app this downloads the finished branded report.');
      return;
    }
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
        <div className="flex items-center gap-2">
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search business or domain…"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-[#FF6A00]"
          />
          <button onClick={onNewReport} className="rounded-lg px-4 py-2 text-sm font-bold text-white whitespace-nowrap" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>▶ Run new report</button>
        </div>
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
                    {r.leadId ? <span className="text-[10px] text-slate-400">· Linked to a lead</span>
                      : <span className="text-[10px] font-bold text-amber-600 bg-amber-50 rounded px-1.5 py-0.5">⚠ Not linked to a lead</span>}
                  </div>
                </div>

                {/* Actions sit on the same row, pushed right, so the card stays
                    one compact line instead of growing an extra button row. */}
                <div className="flex items-center gap-1.5 ml-auto shrink-0">
                  {r.status === 'complete' && (
                    <>
                      <button onClick={() => onOpen(r)} title="View report"
                        className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:border-slate-300 hover:bg-slate-50 inline-flex items-center gap-1.5">
                        <Icon.Eye size={14} /> <span className="hidden sm:inline">View</span>
                      </button>
                      <button onClick={() => download(r._id, r.businessName)} title="Download PDF"
                        className="rounded-lg px-2.5 py-1.5 text-xs font-bold text-white inline-flex items-center gap-1.5"
                        style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>
                        <Icon.Download size={14} /> <span className="hidden sm:inline">PDF</span>
                      </button>
                    </>
                  )}
                  {r.status === 'failed' && (
                    <button onClick={async () => { await api(`/reports/${r._id}/retry`, { method: 'POST' }); load(); }} title="Retry this report"
                      className="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 inline-flex items-center gap-1.5">
                      <Icon.Refresh size={14} /> <span className="hidden sm:inline">Retry</span>
                    </button>
                  )}
                  {!r.leadId && r.status === 'complete' && (
                    <button onClick={() => setLinkReport(r)} title="Link this report to a lead"
                      className="rounded-lg border border-amber-300 px-2.5 py-1.5 text-xs font-bold text-amber-600 hover:bg-amber-50 inline-flex items-center gap-1.5">
                      🔗 <span className="hidden sm:inline">Link</span>
                    </button>
                  )}
                  {isAdmin && (
                    <button onClick={async () => {
                      if (!confirm(`Permanently delete the report for ${r.businessName}?\n\nThis cannot be undone.`)) return;
                      try { await api(`/reports/${r._id}`, { method: 'DELETE' }); load(); } catch (e) { alert(e.message); }
                    }} title="Delete report"
                      className="rounded-lg border border-slate-200 w-8 h-8 flex items-center justify-center text-slate-400 hover:text-red-500 hover:border-red-200 hover:bg-red-50 transition-colors">
                      <Icon.Trash size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>


      <Pagination page={page} pages={data.pages || 1} total={data.total || 0} perPage={perPage}
        onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} label="reports" />

      {linkReport && (
        <LinkToLeadModal
          report={linkReport}
          onClose={() => setLinkReport(null)}
          onLinked={() => { setLinkReport(null); load(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

// Nav bar icons — simple inline strokes so they inherit currentColor and match
// the dark navbar. Keyed by the `icon` field on each nav item.
function NavIcon({ name, className = 'w-4 h-4' }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" {...p} /><rect x="14" y="3" width="7" height="7" rx="1" {...p} /><rect x="3" y="14" width="7" height="7" rx="1" {...p} /><rect x="14" y="14" width="7" height="7" rx="1" {...p} /></>,
    phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" {...p} />,
    users: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" {...p} /><circle cx="9" cy="7" r="4" {...p} /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" {...p} /></>,
    sparkles: <><path d="M12 3l1.9 4.8L18.7 9.7l-4.8 1.9L12 16.4l-1.9-4.8L5.3 9.7l4.8-1.9L12 3z" {...p} /><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" {...p} /></>,
    chart: <><line x1="18" y1="20" x2="18" y2="10" {...p} /><line x1="12" y1="20" x2="12" y2="4" {...p} /><line x1="6" y1="20" x2="6" y2="14" {...p} /></>,
    star: <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01L12 2z" {...p} />,
    mail: <><rect x="2" y="4" width="20" height="16" rx="2" {...p} /><path d="M22 7l-10 6L2 7" {...p} /></>,
  };
  return <svg viewBox="0 0 24 24" className={className} aria-hidden="true">{paths[name] || null}</svg>;
}

// A compact Gmail connect control shown in the header. Lets each user link
// their own Google Workspace mailbox (per-user OAuth) so lead emails show up on
// the lead page. Opens Google consent in a popup and listens for completion.
// Shared Gmail connection state + actions, used by the profile modal and the
// dashboard notice. Listens for the OAuth popup's completion message.
function useGmail() {
  const [status, setStatus] = useState(null); // { connected, email }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = () => api('/gmail/status').then(setStatus).catch(() => setStatus({ connected: false }));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const onMsg = (e) => { if (e.data && e.data.gmail) load(); };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  const connect = async () => {
    setBusy(true); setErr('');
    try { const { url } = await api('/gmail/connect'); window.open(url, 'gmail_oauth', 'width=520,height=640'); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const disconnect = async () => {
    if (!confirm('Disconnect your Gmail? Lead emails will stop syncing.')) return;
    try { await api('/gmail/disconnect', { method: 'POST' }); load(); } catch (e) { setErr(e.message); }
  };
  return { status, busy, err, connect, disconnect, reload: load };
}

// The circular avatar + name/designation + dropdown in the header.
function UserMenu({ user, onEditProfile, onEmailSettings, onTemplates, onSignOut }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  const initial = (user.name || '?').trim()[0]?.toUpperCase() || '?';
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2.5 rounded-full pl-1 pr-3 py-1 hover:bg-white/5 transition">
        {user.avatar
          ? <img src={user.avatar} alt={user.name} className="w-9 h-9 rounded-full object-cover" />
          : user.companyLogo
            ? <img src={user.companyLogo} alt={user.name} className="w-9 h-9 rounded-full object-cover bg-white border border-white/10" />
            : <span className="w-9 h-9 rounded-full bg-[#FF6A00]/20 text-[#FF6A00] flex items-center justify-center text-sm font-bold">{initial}</span>}
        <span className="text-right leading-tight">
          <span className="block text-xs font-semibold text-white">{user.name}</span>
          <span className="block text-[10px] text-slate-400">{user.designation}</span>
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-52 bg-white rounded-xl border border-slate-200 shadow-lg py-1.5 z-50">
          <button onClick={() => { setOpen(false); onEditProfile(); }} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-[#050A1F] hover:bg-slate-50 text-left">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" /><path d="M15 6l3 3" /></svg>
            Edit Profile
          </button>
          <button onClick={() => { setOpen(false); onEmailSettings(); }} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-[#050A1F] hover:bg-slate-50 text-left">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>
            Email settings
          </button>
          <button onClick={() => { setOpen(false); onTemplates(); }} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-[#050A1F] hover:bg-slate-50 text-left">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>
            Templates
          </button>
          <button onClick={() => { setOpen(false); onSignOut(); }} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-50 text-left border-t border-slate-100 mt-1 pt-2.5">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></svg>
            Logout
          </button>
        </div>
      )}
    </div>
  );
}

// The self-service Edit Profile modal: picture, password, DOB, marital status.
// A 1:1 crop dialog. The user drags/zooms the image inside a square frame; on
// confirm it renders the visible square to a canvas and returns a JPEG File.
function ImageCropModal({ file, onCancel, onCropped }) {
  const [src, setSrc] = useState('');
  const [nat, setNat] = useState(null); // { w, h }
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);
  const BOX = 260; // on-screen circular crop frame

  useEffect(() => {
    const r = new FileReader();
    r.onload = () => setSrc(String(r.result));
    r.onerror = () => onCancel();
    r.readAsDataURL(file);
  }, [file]);

  // "cover" base scale so the image always fills the circle at scale=1.
  const baseFit = nat ? Math.max(BOX / nat.w, BOX / nat.h) : 1;
  const dispScale = baseFit * scale;               // natural px → screen px
  const dw = nat ? nat.w * dispScale : BOX;
  const dh = nat ? nat.h * dispScale : BOX;

  const pt = (e) => (e.touches && e.touches[0]) ? e.touches[0] : e;
  const onDown = (e) => { const p = pt(e); dragRef.current = { x: p.clientX - offset.x, y: p.clientY - offset.y }; };
  const onMove = (e) => { if (!dragRef.current) return; const p = pt(e); setOffset({ x: p.clientX - dragRef.current.x, y: p.clientY - dragRef.current.y }); };
  const onUp = () => { dragRef.current = null; };

  const confirm = () => {
    if (!nat) { onCancel(); return; }
    const out = 512;
    const canvas = document.createElement('canvas');
    canvas.width = out; canvas.height = out;
    const ctx = canvas.getContext('2d');
    const left = (BOX - dw) / 2 + offset.x;
    const top = (BOX - dh) / 2 + offset.y;
    const sx = (-left) / dispScale;
    const sy = (-top) / dispScale;
    const sSize = BOX / dispScale;
    const im = new Image();
    im.onload = () => {
      // Clip to a circle so the saved avatar is round (transparent corners).
      ctx.save();
      ctx.beginPath();
      ctx.arc(out / 2, out / 2, out / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      try { ctx.drawImage(im, sx, sy, sSize, sSize, 0, 0, out, out); } catch { /* */ }
      ctx.restore();
      canvas.toBlob((blob) => {
        if (!blob) { onCancel(); return; }
        onCropped(new File([blob], 'avatar.png', { type: 'image/png' }));
      }, 'image/png', 0.92);
    };
    im.onerror = () => onCancel();
    im.src = src;
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[120] p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl" style={{ fontFamily: "'Plus Jakarta Sans',system-ui,sans-serif" }}>
        <h3 className="text-base font-extrabold text-[#050A1F] mb-1">Crop your photo</h3>
        <p className="text-xs text-slate-500 mb-4">Drag to reposition, use the slider to zoom.</p>
        <div className="flex justify-center mb-4">
          <div className="relative overflow-hidden rounded-full bg-slate-100 select-none"
            style={{ width: BOX, height: BOX, touchAction: 'none', cursor: dragRef.current ? 'grabbing' : 'grab' }}
            onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
            onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}>
            {src && (
              // eslint-disable-next-line jsx-a11y/alt-text
              <img src={src} draggable={false}
                onLoad={(e) => setNat({ w: e.target.naturalWidth, h: e.target.naturalHeight })}
                style={{
                  position: 'absolute',
                  width: dw, height: dh,
                  left: (BOX - dw) / 2 + offset.x,
                  top: (BOX - dh) / 2 + offset.y,
                  maxWidth: 'none', pointerEvents: 'none',
                }} />
            )}
            <div className="absolute inset-0 rounded-full ring-2 ring-white/80 pointer-events-none" />
          </div>
        </div>
        <input type="range" min="1" max="3" step="0.01" value={scale} onChange={(e) => setScale(Number(e.target.value))} className="w-full mb-4" />
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={confirm} disabled={!nat} className="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>Crop &amp; upload</button>
        </div>
      </div>
    </div>
  );
}

function EditProfileModal({ user, onClose, onSaved }) {
  const [avatar, setAvatar] = useState(user.avatar || '');
  const [birthday, setBirthday] = useState(user.birthday || '');
  const [maritalStatus, setMaritalStatus] = useState(user.maritalStatus || '');
  const [anniversary, setAnniversary] = useState(user.anniversary || '');
  const [calendly, setCalendly] = useState(user.calendly || '');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [cropFile, setCropFile] = useState(null); // file awaiting crop

  // Pick → open the 1:1 crop dialog (don't upload the raw file).
  const pickPhoto = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setErr('');
    setCropFile(file);
  };

  // After cropping: upload to ImageKit with a buffering state, then persist the
  // new avatar immediately (and refresh the app-wide user) so it shows at once.
  const onCropped = async (cropped) => {
    setCropFile(null);
    setUploading(true); setErr(''); setMsg('');
    try {
      const url = await uploadCrmAvatar(cropped, user.name);
      setAvatar(url);
      // Persist right away so the picture updates everywhere without a separate
      // Save click.
      const res = await api('/auth/me/profile', { method: 'PUT', body: JSON.stringify({ avatar: url }) });
      onSaved && onSaved(res);
      setMsg('Profile picture updated.');
    } catch (e2) {
      setErr(e2.message || 'Could not upload that image.');
    } finally { setUploading(false); }
  };
  const save = async () => {
    setErr(''); setMsg('');
    if (pw && pw.length < 8) return setErr('New password must be at least 8 characters.');
    if (pw && pw !== pw2) return setErr('The two passwords don’t match.');
    setBusy(true);
    try {
      const body = { avatar, birthday: birthday || null, maritalStatus: maritalStatus || null, anniversary: maritalStatus === 'married' ? (anniversary || null) : null, calendly: calendly || '' };
      if (pw) body.password = pw;
      const res = await api('/auth/me/profile', { method: 'PUT', body: JSON.stringify(body) });
      onSaved && onSaved(res);
      setMsg('Profile saved.'); setPw(''); setPw2('');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const initial = (user.name || '?').trim()[0]?.toUpperCase() || '?';
  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-[60] p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl p-6 w-full max-w-lg my-8" onClick={(e) => e.stopPropagation()} style={{ fontFamily: "'Plus Jakarta Sans',system-ui,sans-serif" }}>
        <h3 className="text-lg font-extrabold text-[#050A1F] mb-4">Edit Profile</h3>
        {err && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">{err}</div>}
        {msg && <div className="mb-3 rounded-lg bg-green-50 border border-green-200 px-3 py-2.5 text-sm text-green-700">{msg}</div>}

        <div className="flex items-center gap-4 mb-5">
          <div className="relative">
            {avatar ? <img src={avatar} alt="" className="w-16 h-16 rounded-full object-cover" /> : <span className="w-16 h-16 rounded-full bg-orange-50 text-[#FF4500] flex items-center justify-center text-xl font-bold">{initial}</span>}
            {uploading && (
              <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
                <svg className="animate-spin" width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#fff" strokeOpacity="0.3" strokeWidth="3"/><path d="M21 12a9 9 0 0 0-9-9" stroke="#fff" strokeWidth="3" strokeLinecap="round"/></svg>
              </div>
            )}
          </div>
          <label className={`inline-block rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold cursor-pointer hover:bg-slate-50 ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
            {uploading ? 'Uploading…' : 'Upload picture'}
            <input type="file" accept="image/*" className="hidden" onChange={pickPhoto} disabled={uploading} />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Date of birth</label>
              <input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Marital status</label>
              <select value={maritalStatus} onChange={(e) => setMaritalStatus(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm">
                <option value="">Prefer not to say</option>
                <option value="single">Single</option>
                <option value="married">Married</option>
              </select>
            </div>
          </div>
          {maritalStatus === 'married' && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Anniversary date</label>
              <input type="date" value={anniversary} onChange={(e) => setAnniversary(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Calendly link <span className="font-normal text-slate-400">· added to your email signature</span></label>
            <input type="url" value={calendly} onChange={(e) => setCalendly(e.target.value)} placeholder="https://calendly.com/your-name" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">New password</label>
              <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Leave blank to keep" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Confirm password</label>
              <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Close</button>
          <button onClick={save} disabled={busy} className="rounded-lg px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: '#050A1F' }}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
      {cropFile && <ImageCropModal file={cropFile} onCancel={() => setCropFile(null)} onCropped={onCropped} />}
    </div>
  );
}

// Email management inside Edit Profile: primary mailbox connect/disconnect, a
// default signature, and (admins) additional labelled mailboxes each with their
// own signature override.
// Email settings modal: connect your mailbox, admins add extra named mailboxes,
// a connected-emails table, and a signature library (assign to all/specific,
// raw HTML paste with live preview).
function EmailSettingsModal({ user, onClose }) {
  const gmail = useGmail();
  const [data, setData] = useState(null); // { isAdmin, mailboxes }
  const [newName, setNewName] = useState('');
  const [sigs, setSigs] = useState([]);
  const [editing, setEditing] = useState(null); // signature being edited/created
  const [sigTemplates, setSigTemplates] = useState([]);
  const [showGallery, setShowGallery] = useState(false);
  const [msg, setMsg] = useState('');

  const loadMailboxes = () => api('/gmail/mailboxes').then(setData).catch(() => {});
  const loadSigs = () => api('/gmail/signatures').then(setSigs).catch(() => {});
  useEffect(() => { loadMailboxes(); loadSigs(); api('/gmail/signature-templates').then(setSigTemplates).catch(() => {}); }, []);
  useEffect(() => {
    const onMsg = (e) => { if (e.data && e.data.gmail) { loadMailboxes(); gmail.reload && gmail.reload(); } };
    window.addEventListener('message', onMsg); return () => window.removeEventListener('message', onMsg);
  }, []);

  const mailboxes = (data?.mailboxes) || [];
  const linkExtra = async () => {
    if (!newName.trim()) return setMsg('Enter a name for the mailbox first.');
    try { const { url } = await api(`/gmail/connect?extra=1&label=${encodeURIComponent(newName.trim())}`); window.open(url, 'gmail_oauth', 'width=520,height=640'); setNewName(''); }
    catch (e) { setMsg(e.message); }
  };
  const disconnectPrimary = async () => { await gmail.disconnect(); loadMailboxes(); };
  const removeExtra = async (id) => { if (!confirm('Disconnect this mailbox?')) return; try { await api(`/gmail/mailboxes/${id}`, { method: 'DELETE' }); loadMailboxes(); } catch { /* */ } };

  const blankSig = () => ({ name: '', bodyHtml: '', scope: 'all', mailboxRef: '', isDefault: false });
  const saveSig = async () => {
    try {
      if (editing._id) await api(`/gmail/signatures/${editing._id}`, { method: 'PUT', body: JSON.stringify(editing) });
      else await api('/gmail/signatures', { method: 'POST', body: JSON.stringify(editing) });
      setEditing(null); loadSigs();
    } catch (e) { setMsg(e.message); }
  };
  const delSig = async (id) => { if (!confirm('Delete this signature?')) return; try { await api(`/gmail/signatures/${id}`, { method: 'DELETE' }); loadSigs(); } catch { /* */ } };

  const mailboxOptions = [{ value: 'all', label: 'All mailboxes' }, ...mailboxes.map((m) => ({ value: m.kind === 'primary' ? `user:${user.id}` : String(m._id), label: `${m.label || m.email} (${m.email})` }))];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-[60] p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-2xl my-8" onClick={(e) => e.stopPropagation()} style={{ fontFamily: "'Plus Jakarta Sans',system-ui,sans-serif" }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-extrabold text-[#050A1F]">Email settings</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        {msg && <div className="mb-3 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600">{msg}</div>}

        {/* Your mailbox */}
        <div className="rounded-xl border border-slate-200 p-4 mb-4">
          <div className="text-sm font-bold text-[#050A1F] mb-2">Your mailbox</div>
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-500">{gmail.status?.connected ? <>Connected as <span className="font-semibold text-slate-700">{gmail.status.email}</span></> : 'Connect your Google Workspace mailbox to read & reply to lead emails.'}</div>
            {gmail.status?.connected
              ? <button onClick={disconnectPrimary} className="rounded-lg border border-red-200 text-red-600 px-3 py-1.5 text-xs font-bold hover:bg-red-50">Disconnect</button>
              : <button onClick={gmail.connect} disabled={gmail.busy} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>{gmail.busy ? 'Opening…' : 'Connect Gmail'}</button>}
          </div>
          {gmail.err && <div className="mt-2 text-[11px] text-red-500">{gmail.err}</div>}
        </div>

        {/* Admin: add new email + connected table */}
        {data?.isAdmin && (
          <div className="rounded-xl border border-slate-200 p-4 mb-4">
            <div className="text-sm font-bold text-[#050A1F] mb-2">Add new email</div>
            <div className="flex gap-2 mb-3">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name (e.g. Accounts)" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <button onClick={linkExtra} className="rounded-lg px-4 py-2 text-xs font-bold text-white whitespace-nowrap" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>Connect</button>
            </div>
            <div className="text-[10px] text-slate-400 mb-3">Enter a name, then Connect — you’ll pick the Google account in the popup. The email address comes from the Google sign-in.</div>

            <div className="text-xs font-semibold text-slate-600 mb-2">Connected mailboxes</div>
            <table className="w-full text-xs">
              <thead><tr className="text-left text-slate-400 border-b border-slate-100"><th className="py-1.5">Name</th><th>Email</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {mailboxes.map((m) => (
                  <tr key={m._id} className="border-b border-slate-50">
                    <td className="py-2 font-semibold text-[#050A1F]">{m.label || (m.kind === 'primary' ? 'Me' : '—')}</td>
                    <td className="text-slate-600">{m.email}</td>
                    <td>{m.connected ? <span className="text-green-600 font-bold">● Connected</span> : <span className="text-slate-300">○</span>}</td>
                    <td className="text-right">{m.kind === 'extra' ? <button onClick={() => removeExtra(m._id)} className="text-red-500 font-bold">Disconnect</button> : <span className="text-slate-300">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Signature library */}
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-bold text-[#050A1F]">Signatures</div>
            <div className="flex gap-2">
              <button onClick={() => { setShowGallery((v) => !v); }} className="rounded-lg px-3 py-1.5 text-xs font-bold border border-slate-300 text-slate-600 hover:bg-slate-50">✨ Start from a template</button>
              <button onClick={() => { setShowGallery(false); setEditing(blankSig()); }} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: '#050A1F' }}>+ New signature</button>
            </div>
          </div>

          {/* Template gallery: pick a ready-made design, then customise it. */}
          {showGallery && (
            <div className="mb-3 grid grid-cols-1 gap-2">
              {sigTemplates.map((t) => (
                <div key={t.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="text-xs font-bold text-[#050A1F]">{t.name}</div>
                      <div className="text-[10px] text-slate-400">{t.description}</div>
                    </div>
                    <button onClick={() => { setShowGallery(false); setEditing({ ...blankSig(), name: t.name, bodyHtml: t.html }); }} className="rounded-lg px-3 py-1.5 text-[11px] font-bold text-white flex-shrink-0" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>Use &amp; customise</button>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-2 overflow-auto" dangerouslySetInnerHTML={{ __html: t.html }} />
                </div>
              ))}
              {sigTemplates.length === 0 && <div className="text-xs text-slate-400">Loading templates…</div>}
            </div>
          )}

          {sigs.length === 0 && !editing && !showGallery && <div className="text-xs text-slate-400">No signatures yet. Create one from scratch, or start from a template above.</div>}
          <div className="space-y-2">
            {sigs.map((sg) => (
              <div key={sg._id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-[#050A1F]">{sg.name} {sg.isDefault && <span className="text-[9px] bg-orange-100 text-[#FF4500] rounded px-1.5 py-0.5 ml-1">DEFAULT</span>}</div>
                  <div className="text-[10px] text-slate-400">{sg.scope === 'all' ? 'All mailboxes' : `Specific: ${mailboxOptions.find((o) => o.value === sg.mailboxRef)?.label || sg.mailboxRef}`}</div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => setEditing({ ...sg })} className="text-[11px] font-bold text-blue-500">Edit</button>
                  <button onClick={() => delSig(sg._id)} className="text-[11px] font-bold text-red-500">Delete</button>
                </div>
              </div>
            ))}
          </div>

          {editing && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <div className="grid grid-cols-2 gap-2 mb-2">
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Signature name" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                <select value={editing.scope === 'all' ? 'all' : (editing.mailboxRef || 'all')} onChange={(e) => { const v = e.target.value; setEditing({ ...editing, scope: v === 'all' ? 'all' : 'mailbox', mailboxRef: v === 'all' ? '' : v }); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  {mailboxOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-600 mb-2"><input type="checkbox" checked={!!editing.isDefault} onChange={(e) => setEditing({ ...editing, isDefault: e.target.checked })} /> Make this my default signature</label>
              <label className="block text-[10px] font-bold text-slate-400 mb-1">Signature</label>
              <PasteHtmlEditor value={editing.bodyHtml} onChange={(html) => setEditing({ ...editing, bodyHtml: html })} minHeight={150} />
              <div className="text-[10px] text-slate-400 mt-1.5">Paste directly from your Gmail signature — the layout, colours, and images are preserved.</div>
              <div className="flex justify-end gap-2 mt-3">
                <button onClick={() => setEditing(null)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">Cancel</button>
                <button onClick={saveSig} className="rounded-lg px-4 py-1.5 text-xs font-bold text-white" style={{ background: '#050A1F' }}>Save signature</button>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end mt-5">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Close</button>
        </div>
      </div>
    </div>
  );
}

// Global template library. Each user manages their own; admins can mark a
// template global (visible to everyone). Body uses the paste-preserving editor.
function TemplatesModal({ user, onClose }) {
  const [list, setList] = useState([]);
  const [editing, setEditing] = useState(null);
  const [msg, setMsg] = useState('');
  const [vars, setVars] = useState([]);
  const [showVars, setShowVars] = useState(false);
  const isAdmin = user.role === 'admin';

  const load = () => api('/gmail/templates').then(setList).catch(() => {});
  useEffect(() => { load(); api('/gmail/template-variables').then(setVars).catch(() => {}); }, []);

  // Insert a {{var}} token at the end of the body (the editor appends it).
  const insertVar = (key) => { setEditing((e) => ({ ...e, bodyHtml: `${e.bodyHtml || ''} {{${key}}}` })); setShowVars(false); };

  const blank = () => ({ name: '', subject: '', bodyHtml: '', isGlobal: false });
  const save = async () => {
    try {
      if (editing._id) await api(`/gmail/templates/${editing._id}`, { method: 'PUT', body: JSON.stringify(editing) });
      else await api('/gmail/templates', { method: 'POST', body: JSON.stringify(editing) });
      setEditing(null); load();
    } catch (e) { setMsg(e.message); }
  };
  const del = async (id) => { if (!confirm('Delete this template?')) return; try { await api(`/gmail/templates/${id}`, { method: 'DELETE' }); load(); } catch (e) { setMsg(e.message); } };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-[60] p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-2xl my-8" onClick={(e) => e.stopPropagation()} style={{ fontFamily: "'Plus Jakarta Sans',system-ui,sans-serif" }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-extrabold text-[#050A1F]">Email templates</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        {msg && <div className="mb-3 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600">{msg}</div>}

        {!editing && (
          <>
            <div className="flex justify-end mb-3">
              <button onClick={() => setEditing(blank())} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: '#050A1F' }}>+ New template</button>
            </div>
            <div className="space-y-2">
              {list.length === 0 && <div className="text-xs text-slate-400 text-center py-6">No templates yet. Create one to reuse across all leads.</div>}
              {list.map((t) => (
                <div key={t._id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-[#050A1F] flex items-center gap-2">{t.name}
                      {t.isGlobal && <span className="text-[9px] bg-blue-100 text-blue-700 rounded px-1.5 py-0.5">GLOBAL</span>}
                      {isAdmin && !t.mine && <span className="text-[9px] bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">other user</span>}
                    </div>
                    {t.subject && <div className="text-[11px] text-slate-400 truncate">Subject: {t.subject}</div>}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    {(t.mine || isAdmin) && <button onClick={() => setEditing({ ...t })} className="text-[11px] font-bold text-blue-500">Edit</button>}
                    {(t.mine || isAdmin) && <button onClick={() => del(t._id)} className="text-[11px] font-bold text-red-500">Delete</button>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {editing && (
          <div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Template name" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <input value={editing.subject || ''} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} placeholder="Subject (optional)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            {isAdmin && <label className="flex items-center gap-2 text-xs text-slate-600 mb-2"><input type="checkbox" checked={!!editing.isGlobal} onChange={(e) => setEditing({ ...editing, isGlobal: e.target.checked })} /> Make this a global template (visible to everyone)</label>}
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-slate-600">Body</label>
              <div className="relative">
                <button onClick={() => setShowVars((v) => !v)} className="text-[11px] font-bold text-blue-500 flex items-center gap-1">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M4 12h16M4 17h10" /></svg>
                  Insert variable
                </button>
                {showVars && (
                  <div className="absolute right-0 mt-1 w-56 max-h-64 overflow-auto bg-white rounded-xl border border-slate-200 shadow-lg py-1.5 z-50">
                    <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase">Lead</div>
                    {vars.filter((v) => v.key.startsWith('lead.')).map((v) => (
                      <button key={v.key} onClick={() => insertVar(v.key)} className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50">{v.label} <span className="text-slate-300">{`{{${v.key}}}`}</span></button>
                    ))}
                    <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase border-t border-slate-100 mt-1">Brief (if available)</div>
                    {vars.filter((v) => v.key.startsWith('brief.')).map((v) => (
                      <button key={v.key} onClick={() => insertVar(v.key)} className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50">{v.label} <span className="text-slate-300">{`{{${v.key}}}`}</span></button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <MailEditor value={editing.bodyHtml} onChange={(html) => setEditing({ ...editing, bodyHtml: html })} minHeight={200} placeholder="Write your template… use Insert variable for dynamic fields" />
            <div className="text-[10px] text-slate-400 mt-1.5">Variables like <code>{'{{lead.firstName}}'}</code> are replaced with the lead’s real data when the template is used.</div>
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setEditing(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
              <button onClick={save} className="rounded-lg px-5 py-2 text-sm font-bold text-white" style={{ background: '#050A1F' }}>Save template</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// A contentEditable that preserves pasted HTML/CSS/layout (e.g. a signature or
// template copied from Gmail keeps its formatting, not just plain text).
function PasteHtmlEditor({ value, onChange, minHeight = 160 }) {
  const ref = useRef(null);
  const [showSource, setShowSource] = useState(false);
  useEffect(() => { if (ref.current && ref.current.innerHTML !== (value || '')) ref.current.innerHTML = value || ''; }, [value, showSource]);
  return (
    <div className="rounded-lg border border-slate-300">
      <div className="flex items-center justify-between border-b border-slate-200 px-2 py-1 bg-slate-50 rounded-t-lg">
        <span className="text-[10px] font-bold text-slate-400 uppercase">{showSource ? 'HTML source' : 'Paste from Gmail — formatting is kept'}</span>
        <button onClick={() => setShowSource((v) => !v)} className="text-[11px] font-bold text-blue-500">{showSource ? 'Visual' : '</> HTML'}</button>
      </div>
      {showSource ? (
        <textarea value={value || ''} onChange={(e) => onChange(e.target.value)} style={{ minHeight }} className="w-full px-3 py-2 text-xs font-mono outline-none rounded-b-lg" />
      ) : (
        <div ref={ref} contentEditable suppressContentEditableWarning
          onInput={() => onChange(ref.current.innerHTML)}
          onBlur={() => onChange(ref.current.innerHTML)}
          className="px-3 py-2 text-sm outline-none overflow-auto rich-text" style={{ minHeight }} />
      )}
      <div className="border-t border-slate-100 px-3 py-1.5 flex items-center justify-between">
        <span className="text-[10px] text-slate-400">Tip: open your Gmail signature, select all, copy, and paste here.</span>
        <div className="text-[10px] text-slate-400">Live preview below</div>
      </div>
      <div className="px-3 py-2 bg-slate-50/50 border-t border-slate-100 rounded-b-lg max-h-32 overflow-auto" dangerouslySetInnerHTML={{ __html: value || '<span style="color:#cbd5e1;font-size:12px">Preview…</span>' }} />
    </div>
  );
}

export function DashboardGmailNotice({ onOpenProfile }) {
  const { status, connect, busy } = useGmail();
  if (!status || status.connected) return null;
  return (
    <div className="mb-5 rounded-xl border border-[#FF6A00]/30 bg-orange-50/60 px-4 py-3 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FF4500" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>
        <div>
          <div className="text-sm font-bold text-[#050A1F]">Connect your email</div>
          <div className="text-xs text-slate-500">Link your Google Workspace mailbox to read and reply to lead emails right from the lead page.</div>
        </div>
      </div>
      <button onClick={connect} disabled={busy} className="rounded-lg px-4 py-2 text-xs font-bold text-white disabled:opacity-50 whitespace-nowrap" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>{busy ? 'Opening…' : 'Connect email'}</button>
    </div>
  );
}

// Upload a CRM avatar to ImageKit (falls back to base64 if not configured).
// Uses the self-service /auth/imagekit endpoints so any user (not just admins)
// can upload their own photo.
async function uploadCrmAvatar(file, userName) {
  let ik = null;
  try { ik = await api('/auth/imagekit'); } catch { ik = null; }
  if (ik && ik.configured) {
    const auth = await api('/auth/imagekit/auth');
    const safe = (userName || 'user').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const form = new FormData();
    form.append('file', file); form.append('fileName', `${safe}.png`); form.append('folder', '/qtonix-crm/avatars');
    form.append('publicKey', auth.publicKey); form.append('signature', auth.signature);
    form.append('expire', auth.expire); form.append('token', auth.token); form.append('useUniqueFileName', 'true');
    const res = await fetch('https://upload.imagekit.io/api/v1/files/upload', { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Upload failed.');
    return data.url;
  }
  // base64 fallback (downscaled)
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { const img = new Image(); img.onload = () => {
      const c = document.createElement('canvas'); c.width = 128; c.height = 128; const ctx = c.getContext('2d');
      const min = Math.min(img.width, img.height); const sx = (img.width - min) / 2, sy = (img.height - min) / 2;
      ctx.drawImage(img, sx, sy, min, min, 0, 0, 128, 128); resolve(c.toDataURL('image/jpeg', 0.82));
    }; img.onerror = reject; img.src = reader.result; };
    reader.onerror = reject; reader.readAsDataURL(file);
  });
}

export default function App() {
  // The Motivator TV board runs at /tv/<token>. It's a public, unauthenticated
  // screen for an office TV, so it short-circuits the whole app shell — no
  // login, no chrome, just the board.
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/tv/')) {
    return <MotivatorTV />;
  }

  const [user, setUser] = useState(null);
  const [showProfile, setShowProfile] = useState(false);
  const [emailMenuOpen, setEmailMenuOpen] = useState(false);
  const [showEmailSettings, setShowEmailSettings] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [view, setView] = useState(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      if (p.get('leadRun')) return 'new';
      if (p.get('reportId')) return 'progress';
      // A persisted view (survives refresh). Fall back to legacy params, then
      // the dashboard.
      if (p.get('view')) return p.get('view');
      if (p.get('q')) return 'list';
      return 'dashboard';
    } catch { return 'dashboard'; }
  });
  const [leadRunId] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('leadRun') || null; }
    catch { return null; }
  });
  const [queuedReportId, setQueuedReportId] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('reportId') || null; }
    catch { return null; }
  });
  const [linkReport, setLinkReport] = useState(null); // report being linked to a lead
  const [activeReport, setActiveReport] = useState(null);
  const [booting, setBooting] = useState(true);
  const [dueCount, setDueCount] = useState(0);
  const [leadsEntry, setLeadsEntry] = useState({ view: 'list' });
  // Which dashboard view is showing: the operational overview or analytics.
  const [dashMode, setDashMode] = useState('overview');
  // Bumped whenever a report should be re-fetched (e.g. after a re-run) so the
  // iframe can't serve a stale cached render.
  const [viewNonce, setViewNonce] = useState(() => Date.now());

  useEffect(() => {
    if (!user) return;
    let alive = true;
    const poll = () => api('/leads/reminders/count').then((d) => alive && setDueCount(d.due || 0)).catch(() => {});
    poll();
    const t = setInterval(poll, 60000); // refresh every minute
    return () => { alive = false; clearInterval(t); };
  }, [user]);

  // Keep the current top-level view in the URL so a page refresh returns the
  // user to where they were rather than bouncing to the dashboard.
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      // Don't fight the special report/lead-run flows that own the URL.
      if (p.get('leadRun') || p.get('reportId')) return;
      if (view && view !== 'dashboard') p.set('view', view); else p.delete('view');
      const qs = p.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    } catch { /* history API not available */ }
  }, [view]);

  useEffect(() => {
    // Training link: no account needed, so sign in as the synthetic demo user.
    if (IS_DEMO) {
      api('/me')
        .then((d) => setUser(d.user))
        .catch(() => setUser(null))
        .finally(() => setBooting(false));
      return;
    }
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
  // An expired or revoked training link should say so plainly — showing a login
  // form to a trainee who was never given an account is just confusing.
  if (!user && IS_DEMO) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
        <div className="bg-white rounded-2xl border border-slate-200 p-8 max-w-sm text-center">
          <div className="text-lg font-extrabold text-[#050A1F]">Demo link not active</div>
          <p className="text-sm text-slate-500 mt-2">
            This training link has been turned off or replaced. Ask your administrator for a current one.
          </p>
        </div>
      </div>
    );
  }
  if (!user) return <Login onSignIn={setUser} />;

  const signOut = () => { localStorage.removeItem('qtx_token'); setUser(null); };
  const isAdmin = user.role === 'admin';

  const isManagerOrAdmin = user && (user.role === 'admin' || user.role === 'manager');
  const isLeadManager = user && user.role === 'leadmanager';
  // Per-role navigation:
  // - Admin: All Email + Email Drafts live under an "Email" dropdown (keeps the
  //   crowded admin bar tidy).
  // - Manager / Agent: All Email stays a top-level item; no dropdown.
  // - Lead Manager: no All Email, no AI Brief, no Call Backs; gets Reviews
  //   (scoped to her pre-sales team) and Email Drafts.
  const nav = [
    { id: 'dashboard', label: 'Dashboard', icon: 'grid' },
    // Call Backs — cold-calling prospects. Hidden for lead managers.
    ...(!isLeadManager ? [{ id: 'prospects', label: 'Call Backs', icon: 'phone' }] : []),
    { id: 'leads', label: 'Leads', icon: 'users' },
    // AI Brief — hidden for lead managers.
    ...(!isLeadManager ? [{ id: 'aibrief', label: 'AI Brief', icon: 'sparkles' }] : []),
    // Agents run reports only from inside a lead's detail page.
    ...(user.role !== 'agent' ? [{ id: 'list', label: 'Reports', icon: 'chart' }] : []),
    // Reviews — managers, admins, and now lead managers (her pre-sales team).
    ...((isManagerOrAdmin || isLeadManager) ? [{ id: 'reviews', label: 'Reviews', icon: 'star' }] : []),
    // Email area:
    ...(user.role === 'admin'
      ? [{ id: 'email', label: 'Email', icon: 'mail', children: [
          { id: 'allemail', label: 'All Email', icon: 'mail' },
          { id: 'emaildrafts', label: 'Email Drafts', icon: 'mail' },
        ] }]
      : []),
    // Manager / agent keep All Email as a top-level item (no dropdown).
    ...((user.role === 'manager' || user.role === 'agent') ? [{ id: 'allemail', label: 'All Email', icon: 'mail' }] : []),
    // Lead manager keeps Email Drafts (top-level, no All Email).
    ...(isLeadManager ? [{ id: 'emaildrafts', label: 'Email Drafts', icon: 'mail' }] : []),
  ];

  return (
    <div className="min-h-screen bg-slate-50" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      {/* Unmissable reminder that none of this is real, so a training figure is
          never mistaken for a live client number. */}
      {IS_DEMO && (
        <div className="text-white text-[11px] font-bold py-1.5 px-4 flex items-center justify-center gap-3 flex-wrap"
          style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>
          <span>DEMO / TRAINING MODE — sample data only. Nothing you change here is saved.</span>
          <span className="flex items-center gap-1">
            <span className="opacity-80">Viewing as</span>
            {['agent', 'manager', 'admin', 'leadmanager'].map((r) => (
              <button key={r}
                onClick={() => { window.location.search = `?role=${r}`; }}
                className={`rounded px-2 py-0.5 transition-colors ${
                  DEMO_ROLE === r ? 'bg-white text-[#FF4500]' : 'bg-white/20 hover:bg-white/30'
                }`}>{r === 'leadmanager' ? 'Lead Mgr' : r.charAt(0).toUpperCase() + r.slice(1)}</button>
            ))}
          </span>
        </div>
      )}
      <header className="bg-[#050A1F] border-b border-white/10">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="text-lg font-extrabold text-white tracking-tight">
              Qtonix<span className="text-[#FF6A00]">.</span>
              <span className="ml-1.5 text-[9px] font-bold text-white/30 align-super" title="App build version">{APP_BUILD}</span>
            </div>
            <nav className="flex gap-0.5">
              {nav.map((n) => {
                // Dropdown parent (e.g. Email → All Email / Email Drafts).
                if (n.children) {
                  const childActive = n.children.some((c) => c.id === view);
                  return (
                    <div key={n.id} className="relative"
                      onMouseEnter={() => setEmailMenuOpen(true)} onMouseLeave={() => setEmailMenuOpen(false)}>
                      <button
                        onClick={() => setEmailMenuOpen((v) => !v)}
                        className={`relative flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-colors ${childActive ? 'text-[#FF6A00]' : 'text-slate-400 hover:text-white'}`}>
                        <NavIcon name={n.icon} className="w-4 h-4" />
                        <span>{n.label}</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M6 9l6 6 6-6" /></svg>
                        {childActive && <span className="absolute left-3 right-3 -bottom-[7px] h-[2px] rounded-full" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }} />}
                      </button>
                      {emailMenuOpen && (
                        <div className="absolute left-0 top-full pt-1 z-50">
                          <div className="w-48 bg-[#0A1230] border border-white/10 rounded-xl shadow-2xl py-1.5">
                            {n.children.map((c) => (
                              <button key={c.id}
                                onClick={() => { setView(c.id); setActiveReport(null); setEmailMenuOpen(false); }}
                                className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-bold text-left transition-colors ${view === c.id ? 'text-[#FF6A00] bg-white/5' : 'text-slate-300 hover:text-white hover:bg-white/5'}`}>
                                <NavIcon name={c.icon} className="w-4 h-4" />
                                <span>{c.label}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                }
                const active = view === n.id;
                // Call Backs carries the due-count badge; everything else is plain.
                const badge = n.id === 'leads' ? dueCount : 0;
                return (
                  <button key={n.id}
                    onClick={() => {
                      // Leaving a lead-detail page: drop the ?leadId= param so
                      // the destination view doesn't re-open the lead detail.
                      try { const p = new URLSearchParams(window.location.search); if (p.get('leadId')) { p.delete('leadId'); const qs = p.toString(); window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`); } } catch { /* */ }
                      if (n.id === 'leads') setLeadsEntry({ view: 'list', nonce: Date.now() });
                      setView(n.id);
                      setActiveReport(null);
                    }}
                    className={`relative flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
                      active ? 'text-[#FF6A00]' : 'text-slate-400 hover:text-white'
                    }`}>
                    <NavIcon name={n.icon} className="w-4 h-4" />
                    <span>{n.label}</span>
                    {badge > 0 && (
                      <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#FF4500] text-white text-[10px] font-bold flex items-center justify-center">{badge}</span>
                    )}
                    {/* Active underline, matching the reference nav. */}
                    {active && (
                      <span className="absolute left-3 right-3 -bottom-[7px] h-[2px] rounded-full" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }} />
                    )}
                  </button>
                );
              })}
              {isAdmin && (
                <a href="/admin" className="flex items-center rounded-lg px-3 py-2 text-xs font-bold text-slate-400 hover:text-white">
                  Admin
                </a>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <UserMenu user={user} onEditProfile={() => setShowProfile(true)} onEmailSettings={() => setShowEmailSettings(true)} onTemplates={() => setShowTemplates(true)} onSignOut={signOut} />
          </div>
        </div>
      </header>

      {showProfile && <EditProfileModal user={user} onClose={() => setShowProfile(false)} onSaved={(u) => setUser((prev) => ({ ...prev, ...u }))} />}
      {showEmailSettings && <EmailSettingsModal user={user} onClose={() => setShowEmailSettings(false)} />}
      {showTemplates && <TemplatesModal user={user} onClose={() => setShowTemplates(false)} />}

      <main className="max-w-6xl mx-auto px-6 py-8">
        {view === 'dashboard' && dashMode === 'analytics' && isManagerOrAdmin && (
          <Analytics user={user} mode={dashMode} onModeChange={setDashMode} />
        )}
        {view === 'dashboard' && !(dashMode === 'analytics' && isManagerOrAdmin) && <Dashboard user={user}
          mode={dashMode} onModeChange={setDashMode}
          onGoLeads={() => { setLeadsEntry({ view: 'list' }); setView('leads'); }}
          onViewUntouched={(days) => { setLeadsEntry({ view: 'list', untouched: days }); setView('leads'); }}
          onViewConverted={() => { setLeadsEntry({ view: 'converted', convertedMonth: true }); setView('leads'); }}
          onViewToday={(leadId) => { setLeadsEntry({ view: 'detail', leadId }); setView('leads'); }} />}
        {view === 'reviews' && (isManagerOrAdmin || isLeadManager) && <Reviews user={user} />}
        {view === 'leads' && <Leads key={JSON.stringify(leadsEntry)} user={user} initialView={leadsEntry.view} initialUntouched={leadsEntry.untouched} initialLeadId={leadsEntry.leadId} initialConvertedMonth={leadsEntry.convertedMonth} />}
        {/* Prospects reuses Leads but opens on the call-back-generated list and
            hides the deal/report machinery. A fresh key resets internal state
            when switching between the two. */}
        {view === 'prospects' && <Leads key="prospects" user={user} initialView="prospects" />}
        {view === 'aibrief' && <AiBriefPage user={user} />}
        {view === 'allemail' && <AllEmailPage user={user} />}
        {view === 'emaildrafts' && (user.role === 'leadmanager' || user.role === 'admin') && (
          <EmailDraftsPage user={user}
            onOpenLead={(leadId) => { setLeadsEntry({ view: 'detail', leadId }); setView('leads'); }} />
        )}
        {view === 'new' && !activeReport && (
          <NewReport user={user} initialLeadId={leadRunId} onQueued={(id) => { setActiveReport({ _id: id }); setView('progress'); }} onBack={() => setView('list')} />
        )}
        {view === 'progress' && (activeReport || queuedReportId) && (
          <Progress
            reportId={activeReport ? activeReport._id : queuedReportId}
            onDone={() => { setViewNonce(Date.now()); setQueuedReportId(null); setView('list'); }}
            onBack={() => { setActiveReport(null); setQueuedReportId(null); setView('new'); }}
          />
        )}
        {view === 'list' && (
          <ReportList isAdmin={isAdmin} onOpen={(r) => { setActiveReport(r); setViewNonce(Date.now()); setView('report'); }} onNewReport={() => { setActiveReport(null); setView('new'); }} />
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
                {!activeReport.leadId && !IS_DEMO && (
                  <button onClick={() => setLinkReport(activeReport)} className="rounded-lg border border-orange-300 px-4 py-2 text-sm font-bold text-[#FF4500] hover:bg-orange-50">🔗 Link to lead</button>
                )}
                <button onClick={async () => {
                  if (!confirm('Re-run this analysis with fresh data? This uses API credits and replaces the current results.')) return;
                  try {
                    await api(`/reports/${activeReport._id}/retry`, { method: 'POST' });
                    setViewNonce(Date.now());
                    setView('progress');
                  } catch (e) { alert(e.message); }
                }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600 hover:border-slate-400">↻ Re-run report</button>
                {isAdmin && (
                  <button onClick={async () => {
                    if (!confirm(`Permanently delete this report for ${activeReport.businessName}?\n\nThis removes it from the database along with its PDF. This cannot be undone.`)) return;
                    try {
                      await api(`/reports/${activeReport._id}`, { method: 'DELETE' });
                      setActiveReport(null); setView('list');
                    } catch (e) { alert(e.message); }
                  }} className="rounded-lg border border-red-200 px-4 py-2 text-sm font-bold text-red-500 hover:bg-red-50">🗑 Delete</button>
                )}
                <button onClick={async () => {
                  if (IS_DEMO) {
                    alert('Sample reports have no PDF behind them. In the live app this downloads the finished branded report.');
                    return;
                  }
                  const token = localStorage.getItem('qtx_token');
                  const res = await fetch(`${API_BASE}/api/reports/${activeReport._id}/download`, { headers: { Authorization: `Bearer ${token}` } });
                  if (!res.ok) return alert("That PDF isn't ready yet.");
                  const blob = await res.blob(); const url = URL.createObjectURL(blob);
                  const a = document.createElement('a'); a.href = url; a.download = `${activeReport.businessName.replace(/[^a-z0-9]/gi, '-')}-Site-Analysis.pdf`; a.click(); URL.revokeObjectURL(url);
                }} className="rounded-lg px-5 py-2 text-sm font-bold text-white" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>↓ Download PDF</button>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white" style={{ height: '80vh' }}>
              {IS_DEMO ? (
                <div className="w-full h-full flex items-center justify-center p-8 text-center">
                  <div className="max-w-sm">
                    <div className="text-sm font-bold text-[#050A1F]">Report preview isn't available in the demo</div>
                    <p className="text-xs text-slate-500 mt-2">
                      The sample reports listed here aren't real audits, so there's no PDF behind them.
                      In the live app this panel shows the full branded report, ready to send to the client.
                    </p>
                  </div>
                </div>
              ) : (
                <iframe key={viewNonce} title="report" src={`${API_BASE}/api/reports/${activeReport._id}/view?token=${encodeURIComponent(localStorage.getItem('qtx_token') || '')}&v=${viewNonce}`} className="w-full h-full border-0" />
              )}
            </div>
          </div>
        )}

        {linkReport && (
          <LinkToLeadModal
            report={linkReport}
            onClose={() => setLinkReport(null)}
            onLinked={(lead) => { setActiveReport({ ...linkReport, leadId: lead._id }); setLinkReport(null); }}
          />
        )}
      </main>
    </div>
  );
}

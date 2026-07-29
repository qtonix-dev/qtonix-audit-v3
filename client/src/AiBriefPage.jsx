import React, { useState, useEffect, useMemo } from 'react';
import { api } from './App.jsx';
import { PhoneField, Pagination } from './Leads.jsx';

// A phone stored as only a dial code (e.g. "+1") with no digits shows as a dash.
function phoneOrDash(phone) {
  const s = String(phone || '').trim();
  if (!s) return '—';
  const rest = s.replace(/^\+\d{1,3}/, '').replace(/\D/g, '');
  return rest ? s : '—';
}

/**
 * Standalone AI Brief page. An agent enters a domain, customer name and phone,
 * and gets a quick pre-call brief. Runs are stored and cached by domain, so a
 * domain already looked up returns instantly (and doesn't spend API credit).
 *
 * The brief shown here is deliberately reduced versus the lead-detail version —
 * agents want the essentials fast, in a fixed order: what to pitch, opening
 * lines, what they do, speed, site checks, keywords, pain points.
 */
export default function AiBriefPage({ user }) {
  const [form, setForm] = useState({ website: '', customerName: '', phone: '' });
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState(null); // the brief row currently shown
  const [list, setList] = useState(null);
  // Listing filters + pagination.
  const [q, setQ] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const loadList = () => api('/briefs').then((r) => setList(r.items || [])).catch(() => setList([]));
  useEffect(() => { loadList(); }, []);

  const run = async () => {
    if (!form.website.trim()) { setError('Enter a website or domain.'); return; }
    if (!form.customerName.trim()) { setError('Enter the customer name.'); return; }
    // A phone that's only a dial code (e.g. "+1") with no digits counts as empty.
    const hasNumber = /\d/.test(String(form.phone || '').replace(/^\+\d{1,3}/, ''));
    const cleanPhone = hasNumber ? form.phone : '';
    setRunning(true); setError('');
    try {
      const r = await api('/briefs', { method: 'POST', body: JSON.stringify({ ...form, phone: cleanPhone }) });
      setActive(r.brief);
      setForm({ website: '', customerName: '', phone: '' });
      loadList();
    } catch (e) { setError(e.message); }
    setRunning(false);
  };

  const view = async (id) => {
    setError('');
    try { const r = await api(`/briefs/${id}`); setActive(r.brief); }
    catch (e) { setError(e.message); }
  };

  const del = async (id, e) => {
    e.stopPropagation();
    if (!confirm('Delete this brief?')) return;
    try { await api(`/briefs/${id}`, { method: 'DELETE' }); if (active && active._id === id) setActive(null); loadList(); }
    catch (err) { alert(err.message); }
  };

  const inp = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400';
  const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  // Distinct agents present in the list, for the agent filter.
  const agents = useMemo(() => {
    const seen = new Map();
    (list || []).forEach((r) => { if (r.agentName && !seen.has(r.agentName)) seen.set(r.agentName, r.agentName); });
    return Array.from(seen.values()).sort();
  }, [list]);

  // Apply search + agent + date-range filters.
  const filtered = useMemo(() => {
    let rows = list || [];
    const term = q.trim().toLowerCase();
    if (term) rows = rows.filter((r) => `${r.domain} ${r.customerName} ${r.phone} ${r.agentName}`.toLowerCase().includes(term));
    if (agentFilter) rows = rows.filter((r) => r.agentName === agentFilter);
    if (fromDate) { const f = new Date(fromDate); rows = rows.filter((r) => new Date(r.createdAt) >= f); }
    if (toDate) { const t = new Date(toDate); t.setHours(23, 59, 59, 999); rows = rows.filter((r) => new Date(r.createdAt) <= t); }
    return rows;
  }, [list, q, agentFilter, fromDate, toDate]);

  useEffect(() => { setPage(1); }, [q, agentFilter, fromDate, toDate, perPage]);
  const pageRows = filtered.slice((page - 1) * perPage, page * perPage);
  const pages = Math.max(1, Math.ceil(filtered.length / perPage));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-[#050A1F]">AI Brief</h1>
        <div className="text-sm text-slate-400">Look up any business before a cold call — what they do, what to pitch, and how to open.</div>
      </div>

      {/* Run form */}
      <div className="bg-white rounded-2xl border border-slate-200/70 p-5">
        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Website / domain</label>
            <input className={`${inp} mt-1`} value={form.website} placeholder="example.com"
              onChange={(e) => setForm({ ...form, website: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && run()} />
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Customer name</label>
            <input className={`${inp} mt-1`} value={form.customerName} placeholder="Business or contact"
              onChange={(e) => setForm({ ...form, customerName: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && run()} />
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Phone</label>
            <div className="mt-1">
              <PhoneField value={form.phone} country="United States"
                onChange={(v) => setForm({ ...form, phone: v })}
                className={inp} placeholder="number" />
            </div>
          </div>
        </div>
        {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
        <button onClick={run} disabled={running}
          className="mt-3 rounded-lg px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>
          {running ? 'Reading the website…' : 'Run brief'}
        </button>
        <div className="text-[11px] text-slate-400 mt-2">
          If this domain has been looked up before, you’ll get the saved brief instantly.
        </div>
      </div>

      {/* Active brief shown in a popup */}
      {active && <BriefModal brief={active} onClose={() => setActive(null)} />}

      {/* Listing */}
      <div className="bg-white rounded-2xl border border-slate-200/70 p-5">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <div className="text-sm font-bold text-[#050A1F]">Brief history {list ? `(${filtered.length})` : ''}</div>
        </div>

        {/* Search + agent + date-range filters */}
        <div className="flex items-end gap-2 flex-wrap mb-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search domain, customer, phone…"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-orange-400" />
          <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-2.5 py-2 text-sm">
            <option value="">All agents</option>
            {agents.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <div className="flex items-center gap-1">
            <div className="flex flex-col">
              <label className="text-[9px] font-bold uppercase text-slate-400">From</label>
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
            </div>
            <div className="flex flex-col">
              <label className="text-[9px] font-bold uppercase text-slate-400">To</label>
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
            </div>
          </div>
          {(q || agentFilter || fromDate || toDate) && (
            <button onClick={() => { setQ(''); setAgentFilter(''); setFromDate(''); setToDate(''); }}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-500 hover:border-slate-300">Clear</button>
          )}
        </div>

        {!list ? (
          <div className="text-slate-400 text-sm py-6 text-center">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-slate-300 text-sm py-6 text-center">{(list.length === 0) ? 'No briefs yet. Run one above.' : 'No briefs match these filters.'}</div>
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase text-slate-400 border-b border-slate-100">
                  <th className="text-left py-2 px-2">Date</th>
                  <th className="text-left py-2 px-2">Domain</th>
                  <th className="text-left py-2 px-2">Customer</th>
                  <th className="text-left py-2 px-2">Phone</th>
                  <th className="text-left py-2 px-2">Agent</th>
                  <th className="text-right py-2 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r._id} onClick={() => view(r._id)}
                    className="border-b border-slate-50 cursor-pointer hover:bg-orange-50/40">
                    <td className="py-2 px-2 text-slate-500 whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                    <td className="py-2 px-2 font-bold text-[#050A1F]">{r.domain}{r.cached && <span className="ml-1 text-[9px] font-bold text-slate-400">cached</span>}</td>
                    <td className="py-2 px-2 text-slate-600">{r.customerName}</td>
                    <td className="py-2 px-2 text-slate-500">{phoneOrDash(r.phone)}</td>
                    <td className="py-2 px-2 text-slate-500">{r.agentName}</td>
                    <td className="py-2 px-2 text-right whitespace-nowrap">
                      <button onClick={(e) => { e.stopPropagation(); view(r._id); }} className="text-[11px] font-bold text-[#FF4500] hover:underline">View</button>
                      {user.role === 'admin' && (
                        <button onClick={(e) => del(r._id, e)} className="ml-3 text-[11px] font-bold text-red-500 hover:underline">Delete</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3">
            <Pagination page={page} pages={pages} total={filtered.length} perPage={perPage}
              onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} label="briefs" />
          </div>
          </>
        )}
      </div>
    </div>
  );
}

/** The brief shown in a popup. */
function BriefModal({ brief, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl">
          <div className="text-base font-extrabold text-[#050A1F]">Business brief</div>
          <button onClick={onClose} className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 text-sm font-bold">✕</button>
        </div>
        <div className="p-6">
          <BriefView brief={brief} />
        </div>
      </div>
    </div>
  );
}

/**
 * Reduced brief view for the standalone page. Order is fixed for speed of
 * reading on a call: AI score, what to pitch, opening lines, what they do,
 * speed, site checks, keywords, pain points, and what to share with the
 * customer.
 */
function BriefView({ brief }) {
  const b = brief.brief || brief; // row wraps the brief under .brief
  const PRIORITY = { high: 'bg-green-100 text-green-700', medium: 'bg-amber-100 text-amber-700', low: 'bg-slate-100 text-slate-500' };
  const speed = b.speed || {};
  // Speed is fetched with a timeout; when it isn't in yet we show a buffering
  // state so the agent knows it's still loading rather than missing.
  const speedPending = !speed.mobile && !speed.desktop;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-base font-extrabold text-[#050A1F]">{brief.customerName || b.industry || 'Brief'}</div>
          <div className="text-xs text-slate-400">{brief.website || b.website}</div>
        </div>
        {/* AI score */}
        {b.aiSeoScore != null && (
          <div className="text-center shrink-0">
            <div className="text-3xl font-extrabold leading-none"
              style={{ color: b.aiSeoScore >= 7 ? '#16A34A' : b.aiSeoScore >= 4 ? '#D97706' : '#DC2626' }}>
              {b.aiSeoScore}<span className="text-sm text-slate-300">/10</span>
            </div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mt-0.5">AI Score</div>
          </div>
        )}
      </div>
      {b.aiSeoReason && <div className="text-[12px] text-slate-500 -mt-3">{b.aiSeoReason}</div>}

      {/* 1. What to pitch */}
      {(b.servicesToPitch || []).length > 0 && (
        <Section title="What to pitch">
          <div className="space-y-1.5">
            {b.servicesToPitch.map((s, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg border border-slate-100 p-2.5">
                <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase shrink-0 ${PRIORITY[s.priority] || PRIORITY.low}`}>{s.priority || 'low'}</span>
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-[#050A1F]">{s.service}</div>
                  <div className="text-[12px] text-slate-500">{s.why}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 2. Opening lines */}
      {(b.conversationStarters || []).length > 0 && (
        <Section title="Opening lines">
          <div className="space-y-1.5">
            {b.conversationStarters.map((c, i) => (
              <div key={i} className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-[13px] text-blue-900">{c}</div>
            ))}
          </div>
        </Section>
      )}

      {/* 3. What they do */}
      {b.summary && (
        <Section title="What they do">
          <p className="text-[14px] leading-relaxed text-slate-700">{b.summary}</p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {b.industry && <span className="rounded px-2 py-1 text-[11px] font-bold bg-slate-100 text-slate-600">{b.industry}</span>}
            {b.targetArea && <span className="rounded px-2 py-1 text-[11px] font-bold bg-blue-50 text-blue-600">📍 {b.targetArea}</span>}
          </div>
        </Section>
      )}

      {/* 4. Mobile & desktop speed — buffering until PageSpeed returns */}
      <Section title="Site speed">
        {speedPending ? (
          <div className="grid grid-cols-2 gap-3">
            {['📱 Mobile', '🖥️ Desktop'].map((label) => (
              <div key={label} className="rounded-xl border border-slate-200 p-3">
                <div className="text-[11px] font-bold text-slate-500 mb-1">{label}</div>
                <div className="flex items-center gap-2 text-[11px] text-slate-400">
                  <span className="inline-block w-3 h-3 rounded-full border-2 border-slate-300 border-t-transparent animate-spin" />
                  Loading speed…
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {[['📱 Mobile', speed.mobile], ['🖥️ Desktop', speed.desktop]].map(([label, s]) => (
              <div key={label} className="rounded-xl border border-slate-200 p-3">
                <div className="text-[11px] font-bold text-slate-500 mb-1">{label}</div>
                {s ? (
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-2xl font-extrabold leading-none"
                      style={{ color: s.performance >= 90 ? '#16A34A' : s.performance >= 50 ? '#D97706' : '#DC2626' }}>
                      {s.performance != null ? s.performance : '—'}
                    </span>
                    <span className="text-[11px] text-slate-400">performance</span>
                  </div>
                ) : <div className="text-[11px] text-slate-400 py-1">Not available</div>}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 5. Site checks */}
      {b.checks && (
        <Section title="Site checks">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              ['NAP', b.checks.nap && b.checks.nap.complete],
              ['Social', b.checks.social && b.checks.social.count > 0],
              ['Blog', b.checks.hasBlog],
              ['HTTPS', b.checks.hasSsl],
            ].map(([label, good]) => (
              <div key={label} className={`rounded-lg border p-2.5 ${good ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
                <div className={`text-xs font-extrabold ${good ? 'text-green-700' : 'text-red-700'}`}>{good ? 'Yes' : 'No'}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 6. Keywords */}
      {(b.keywords || []).length > 0 && (
        <Section title="Keywords their customers search">
          <div className="flex flex-wrap gap-1.5">
            {b.keywords.map((k, i) => <span key={i} className="rounded-md bg-orange-50 px-2 py-1 text-[11px] font-semibold text-[#FF4500]">{k}</span>)}
          </div>
        </Section>
      )}

      {/* 7. Pain points */}
      {(b.painPoints || []).length > 0 && (
        <Section title="Pain points to raise on the call">
          <div className="space-y-2">
            {b.painPoints.map((p, i) => (
              <div key={i} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="text-[13px] font-bold text-amber-900">{p.issue}</div>
                <div className="text-[12px] text-amber-800 mt-0.5">{p.why}</div>
                {p.mention && <div className="text-[12px] text-amber-700 mt-1 italic">“{p.mention}”</div>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 8. What to share with the customer */}
      {(b.shareWithCustomer || []).length > 0 && (
        <Section title="Useful to share with the customer">
          <div className="space-y-2">
            {b.shareWithCustomer.map((s, i) => (
              <div key={i} className="rounded-lg border border-green-200 bg-green-50 p-3">
                <div className="text-[13px] font-bold text-green-900">{s.point}</div>
                {s.detail && <div className="text-[12px] text-green-800 mt-0.5">{s.detail}</div>}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">{title}</div>
      {children}
    </div>
  );
}

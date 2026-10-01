import React, { useState, useEffect, useMemo } from 'react';
import { toast, confirmDialog, promptDialog } from './toast';
import { api } from './App.jsx';
import { PhoneField, Pagination, CountryCombobox } from './Leads.jsx';

const BRIEF_FONT = "'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif";
// Favicon via Google's service, with a graceful fallback to a letter tile.
function faviconUrl(domain) {
  const d = String(domain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  return d ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64` : '';
}
function Favicon({ domain, name }) {
  const [failed, setFailed] = useState(false);
  const url = faviconUrl(domain);
  const letter = (String(name || domain || '?').trim()[0] || '?').toUpperCase();
  if (!url || failed) {
    return <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 border border-black/5 bg-slate-100 text-slate-600">{letter}</div>;
  }
  return (
    <div className="w-9 h-9 rounded-xl shrink-0 border border-slate-200 bg-white flex items-center justify-center overflow-hidden">
      <img src={url} alt="" width="20" height="20" onError={() => setFailed(true)} />
    </div>
  );
}

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
  // The contact's country drives the phone dial code. Default to India (the
  // team's base) rather than the US, so agents aren't stuck on +1.
  const [country, setCountry] = useState('India');
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
    // Phone validation: strip the dial code, then require a real number. A
    // single stray digit like "1" (the bug agents hit) is rejected — a valid
    // phone number is at least 7 digits.
    const digits = String(form.phone || '').replace(/^\+\d{1,3}/, '').replace(/\D/g, '');
    if (!digits) { setError('Enter a phone number.'); return; }
    if (digits.length < 7) { setError('Enter a valid phone number (at least 7 digits).'); return; }
    const cleanPhone = form.phone;
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
    if (!(await confirmDialog({ title: 'Delete this brief?' }))) return;
    try { await api(`/briefs/${id}`, { method: 'DELETE' }); if (active && active._id === id) setActive(null); loadList(); }
    catch (err) { toast(err.message); }
  };

  const inp = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400';
  const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  // Distinct agents present in the list, for the agent filter — only agents who
  // have actually run a brief appear here.
  const agents = useMemo(() => {
    const seen = new Map();
    (list || []).forEach((r) => { if (r.agentName && !seen.has(r.agentName)) seen.set(r.agentName, r.agentName); });
    return Array.from(seen.values()).sort();
  }, [list]);

  // KPI counts: total, today, this month.
  const stats = useMemo(() => {
    const rows = list || [];
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    let today = 0, month = 0;
    rows.forEach((r) => {
      const d = new Date(r.createdAt);
      if (d >= startToday) today++;
      if (d >= startMonth) month++;
    });
    return { total: rows.length, today, month };
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
    <div className="space-y-6" style={{ fontFamily: BRIEF_FONT }}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">AI Brief</h1>
            {list && <span className="bg-slate-200/70 text-slate-700 font-bold text-xs px-2.5 py-1 rounded-full">{stats.total} run</span>}
          </div>
          <p className="text-slate-500 text-sm mt-1">Look up any business before a cold call — what they do, what to pitch, and how to open.</p>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-slate-500/5 rounded-bl-full pointer-events-none"></div>
          <div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wider text-slate-400">Total briefs</span><span className="p-2 bg-slate-100 rounded-xl text-slate-600 text-sm">▦</span></div>
          <div className="text-3xl font-extrabold text-slate-900 tracking-tight mt-2">{stats.total}</div>
          <p className="text-xs text-slate-400 mt-2">All-time lookups</p>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-orange-500/5 rounded-bl-full pointer-events-none"></div>
          <div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wider text-orange-600">Today</span><span className="p-2 bg-orange-50 rounded-xl text-orange-600 text-sm">☀️</span></div>
          <div className="text-3xl font-extrabold text-orange-700 tracking-tight mt-2">{stats.today}</div>
          <p className="text-xs text-slate-400 mt-2">Briefs run today</p>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-bl-full pointer-events-none"></div>
          <div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wider text-blue-600">This month</span><span className="p-2 bg-blue-50 rounded-xl text-blue-600 text-sm">▲</span></div>
          <div className="text-3xl font-extrabold text-blue-700 tracking-tight mt-2">{stats.month}</div>
          <p className="text-xs text-slate-400 mt-2">Briefs this month</p>
        </div>
      </div>

      {/* Run form */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-4">
            <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Website / domain</label>
            <input className={`${inp} mt-1`} value={form.website} placeholder="example.com"
              onChange={(e) => setForm({ ...form, website: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && run()} />
          </div>
          <div className="md:col-span-3">
            <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Customer name</label>
            <input className={`${inp} mt-1`} value={form.customerName} placeholder="Business or contact"
              onChange={(e) => setForm({ ...form, customerName: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && run()} />
          </div>
          <div className="md:col-span-2">
            <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Country</label>
            <div className="mt-1">
              <CountryCombobox value={country} onChange={setCountry} className={inp} />
            </div>
          </div>
          <div className="md:col-span-3">
            <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Phone</label>
            <div className="mt-1">
              <PhoneField value={form.phone} country={country}
                onChange={(v) => setForm({ ...form, phone: v })}
                className={inp} placeholder="number" />
            </div>
          </div>
        </div>
        {error && (
          <div className="text-xs text-red-600 mt-2.5 flex items-center gap-1.5">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
            {error}
          </div>
        )}
        <button onClick={run} disabled={running}
          className="mt-3 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50 shadow-sm active:scale-95 transition"
          style={{ background: 'linear-gradient(to right,#f97316,#f59e0b)' }}>
          {running ? 'Reading the website…' : '▶ Run AI brief'}
        </button>
        <div className="text-[11px] text-slate-400 mt-2">
          Pick the contact's country first — the dial code fills in automatically. If this domain has been looked up before, you'll get the saved brief instantly.
        </div>
      </div>

      {/* Active brief shown in a popup */}
      {active && <BriefModal brief={active} onClose={() => setActive(null)} />}

      {/* Listing */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <div className="text-[15px] font-bold text-slate-900">Brief history {list ? <span className="text-slate-400 font-medium">({filtered.length})</span> : ''}</div>
          {/* Search + agent + date-range filters */}
          <div className="flex items-end gap-2 flex-wrap">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
              </span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search briefs…"
                className="bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500" />
            </div>
            <div className="relative">
              <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)}
                className="appearance-none bg-slate-50 border border-slate-200 text-slate-700 text-sm font-medium rounded-xl py-2 pl-3 pr-8 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 cursor-pointer">
                <option value="">All agents</option>
                {agents.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg></span>
            </div>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} title="From"
              className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500" />
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} title="To"
              className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500" />
            {(q || agentFilter || fromDate || toDate) && (
              <button onClick={() => { setQ(''); setAgentFilter(''); setFromDate(''); setToDate(''); }}
                className="rounded-xl bg-slate-100 hover:bg-slate-200 px-3 py-2 text-xs font-semibold text-slate-600">Clear</button>
            )}
          </div>
        </div>

        {!list ? (
          <div className="text-slate-400 text-sm py-10 text-center">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-slate-400 text-sm py-12 text-center">{(list.length === 0) ? 'No briefs yet. Run one above.' : 'No briefs match these filters.'}</div>
        ) : (
          <>
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Business</th>
                  <th className="py-3 px-4">Contact</th>
                  <th className="py-3 px-4">Agent</th>
                  <th className="py-3 px-4">Run</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {pageRows.map((r) => (
                  <tr key={r._id} onClick={() => view(r._id)} className="hover:bg-slate-50/80 transition-colors cursor-pointer group">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <Favicon domain={r.domain} name={r.customerName || r.domain} />
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900 text-sm group-hover:text-orange-600 transition-colors truncate">{r.customerName || r.domain}{r.cached && <span className="ml-1.5 text-[9px] font-bold text-slate-400 uppercase">cached</span>}</div>
                          <div className="text-xs text-slate-400 truncate">{r.domain}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4"><div className="text-[13px] text-slate-600">{r.customerName || '—'}</div><div className="text-xs text-slate-400">{phoneOrDash(r.phone)}</div></td>
                    <td className="py-3 px-4 text-[13px] text-slate-600">{r.agentName}</td>
                    <td className="py-3 px-4 text-xs text-slate-500 whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <button onClick={(e) => { e.stopPropagation(); view(r._id); }} className="rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] font-bold text-slate-600 hover:border-orange-300 hover:text-orange-600">View</button>
                      {user.role === 'admin' && (
                        <button onClick={(e) => del(r._id, e)} className="ml-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-[12px] font-bold text-red-600 hover:bg-red-50">Delete</button>
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

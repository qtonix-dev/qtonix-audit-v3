import React, { useState, useEffect, useMemo } from 'react';
import { hrApi } from './HrApp.jsx';
import { titleCase, Avatar } from './HrParts.jsx';

const ORANGE = 'linear-gradient(90deg,#FF6A00,#FF4500)';
const TYPES = [
  { id: 'casual', label: 'Casual', color: '#22C55E' },
  { id: 'medical', label: 'Medical', color: '#0EA5E9' },
  { id: 'privilege', label: 'Privilege', color: '#F59E0B' },
  { id: 'wfh', label: 'WFH', color: '#8B5CF6' },
];
const STATUS_META = {
  applied: { label: 'Applied', color: '#0369A1', bg: '#E0F2FE' },
  pending: { label: 'Pending for approval', color: '#B45309', bg: '#FEF3C7' },
  approved: { label: 'Approved', color: '#15803D', bg: '#DCFCE7' },
  declined: { label: 'Declined', color: '#DC2626', bg: '#FEF2F2' },
};

function fmtDay(d) { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return d; } }
function fmtDayShort(d) { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); } catch { return d; } }
function fmtWhen(iso) { try { return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } }

export default function LeaveConsole({ user, isAdmin, onOpenEmployee }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [declineFor, setDeclineFor] = useState(null); // request being declined (note capture)
  const [declineNote, setDeclineNote] = useState('');
  const [expanded, setExpanded] = useState({}); // employee id → leave history open

  const load = () => {
    setLoading(true);
    hrApi('/leave/overview').then((r) => { setData(r); setErr(''); }).catch((e) => setErr(e.message)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const employees = (data && data.employees) || [];
  const requests = (data && data.requests) || [];
  const counts = (data && data.counts) || { pendingApprovals: 0, onLeaveToday: 0, onLeaveWeek: 0, employees: 0 };
  const onLeaveToday = (data && data.onLeaveToday) || [];

  const branches = useMemo(() => [...new Set(employees.map((e) => e.branch).filter(Boolean))].sort(), [employees]);
  const depts = useMemo(() => [...new Set(employees.map((e) => e.department).filter(Boolean))].sort(), [employees]);

  const filteredRequests = requests.filter((r) => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (branchFilter && r.branch !== branchFilter) return false;
    if (deptFilter && r.department !== deptFilter) return false;
    if (q && !(`${r.employeeName} ${r.reason}`.toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  });

  const filteredEmployees = employees.filter((e) => {
    if (branchFilter && e.branch !== branchFilter) return false;
    if (deptFilter && e.department !== deptFilter) return false;
    if (q && !e.name.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  // Group employees by branch → department for the balances section.
  const grouped = useMemo(() => {
    const g = {};
    filteredEmployees.forEach((e) => {
      const b = e.branch || 'No branch'; const d = e.department || 'No department';
      ((g[b] || (g[b] = {}))[d] || (g[b][d] = [])).push(e);
    });
    return g;
  }, [filteredEmployees]);

  const markSeen = async (r) => {
    if (r.status !== 'applied') return;
    const key = r.groupId ? `g:${r.groupId}` : String(r.ids[0]);
    try { await hrApi(`/leave/${key}/seen`, { method: 'POST', body: JSON.stringify({}) }); load(); } catch {}
  };
  const decide = async (r, decision) => {
    const key = r.groupId ? `g:${r.groupId}` : String(r.ids[0]);
    setBusyId(r.ids.join(',')); setErr('');
    try {
      await hrApi(`/leave/${key}/decide`, { method: 'POST', body: JSON.stringify({ decision, note: declineNote || '' }) });
      setDeclineFor(null); setDeclineNote(''); load();
    } catch (e) { setErr(e.message); } finally { setBusyId(null); }
  };

  const exportCsv = () => {
    const rows = [['Employee', 'Branch', 'Department', 'Type', 'From', 'To', 'Days', 'Reason', 'Status', 'Approved/Declined by', 'Decided at']];
    filteredRequests.forEach((r) => rows.push([r.employeeName, r.branch, r.department, r.type, r.from, r.to, r.days, (r.reason || '').replace(/[\n\r,]/g, ' '), STATUS_META[r.status].label, r.decidedByName || '', r.decidedAt ? fmtWhen(r.decidedAt) : '']));
    const csv = rows.map((row) => row.map((c) => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `leave-requests-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  };

  const Chip = ({ t, used, total }) => {
    const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
    const left = Math.max(0, total - used);
    return (
      <div className="rounded-lg border border-slate-100 px-2.5 py-1.5 bg-white min-w-[92px]">
        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wide" style={{ color: t.color }}>{t.label}<span className="text-slate-400">{left}/{total}</span></div>
        <div className="h-1.5 rounded-full bg-slate-100 mt-1 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: t.color }} /></div>
      </div>
    );
  };

  if (loading) return <div className="text-center text-slate-400 py-20 text-sm">Loading leave console…</div>;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-end justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-[#050A1F]">Leave</h1>
          <p className="text-sm text-slate-400">Review requests and track every employee's leave credit.</p>
        </div>
        <button onClick={exportCsv} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">⬇ Export CSV</button>
      </div>

      {err && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm px-3 py-2">{err}</div>}

      {/* Summary strip */}
      <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
        {[
          { label: 'Pending approvals', value: counts.pendingApprovals, color: '#F59E0B', bg: '#FFFBEB' },
          { label: 'On leave today', value: counts.onLeaveToday, color: '#0EA5E9', bg: '#F0F9FF' },
          { label: 'On leave this week', value: counts.onLeaveWeek, color: '#8B5CF6', bg: '#F5F3FF' },
          { label: 'Employees', value: counts.employees, color: '#0F9D58', bg: '#F0FDF4' },
        ].map((c) => (
          <div key={c.label} className="rounded-2xl border border-slate-100 p-4 shadow-sm" style={{ background: c.bg }}>
            <div className="text-3xl font-extrabold" style={{ color: c.color }}>{c.value}</div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      {/* On leave today */}
      {onLeaveToday.length > 0 && (
        <div className="mb-6 rounded-2xl border border-sky-100 bg-sky-50/40 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-sky-600 mb-2">On leave today · {onLeaveToday.length}</div>
          <div className="flex flex-wrap gap-2">
            {onLeaveToday.map((p, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 rounded-full bg-white border border-sky-100 px-2.5 py-1 text-xs font-bold text-slate-600">
                {titleCase(p.name || 'Employee')}<span className="text-[10px] font-bold uppercase" style={{ color: (TYPES.find((t) => t.id === p.type) || {}).color }}>{p.type}{p.duration === 'half' ? ' ½' : ''}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search employee or reason…" className="rounded-lg border border-slate-300 px-3 py-2 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-orange-300" />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-2 text-sm">
          <option value="">All statuses</option>
          <option value="applied">Applied</option>
          <option value="pending">Pending for approval</option>
          <option value="approved">Approved</option>
          <option value="declined">Declined</option>
        </select>
        <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-2 text-sm">
          <option value="">All branches</option>
          {branches.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-2 text-sm">
          <option value="">All departments</option>
          {depts.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {/* Recent leave requests */}
      <div className="mb-8">
        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Recent leave requests · {filteredRequests.length}</div>
        {filteredRequests.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-400">No leave requests match these filters.</div>
        ) : (
          <div className="space-y-2.5">
            {filteredRequests.map((r) => {
              const sm = STATUS_META[r.status]; const tp = TYPES.find((t) => t.id === r.type) || TYPES[0];
              const key = r.ids.join(',');
              return (
                <div key={key} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm" onMouseEnter={() => markSeen(r)}>
                  <div className="flex items-start gap-3">
                    <Avatar name={r.employeeName} src={r.avatar} size={38} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={() => onOpenEmployee && onOpenEmployee(r.employeeId)} className="font-extrabold text-[#050A1F] hover:text-[#FF4500]">{titleCase(r.employeeName)}</button>
                        <span className="text-[10px] font-extrabold rounded px-1.5 py-0.5 uppercase" style={{ background: tp.color + '18', color: tp.color }}>{tp.label}</span>
                        <span className="text-[10px] font-extrabold rounded px-1.5 py-0.5" style={{ background: sm.bg, color: sm.color }}>{sm.label}</span>
                        {r.duration === 'half' && <span className="text-[10px] font-bold text-slate-400">Half day</span>}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        {r.from === r.to ? fmtDay(r.from) : `${fmtDayShort(r.from)} — ${fmtDay(r.to)}`} · <b>{r.days}</b> day{r.days === 1 ? '' : 's'}
                        <span className="text-slate-400"> · {r.branch}{r.department ? ` · ${r.department}` : ''}</span>
                      </div>
                      {r.reason && <div className="text-sm text-slate-600 mt-1.5">“{r.reason}”</div>}
                      <div className="text-[11px] text-slate-400 mt-1.5">
                        Applied {r.appliedAt ? fmtWhen(r.appliedAt) : ''}
                        {r.status === 'approved' && r.decidedByName && <> · <span className="text-green-600 font-bold">Approved by {titleCase(r.decidedByName)}</span>{r.decidedAt ? ` on ${fmtWhen(r.decidedAt)}` : ''}</>}
                        {r.status === 'declined' && r.decidedByName && <> · <span className="text-red-500 font-bold">Declined by {titleCase(r.decidedByName)}</span>{r.decidedAt ? ` on ${fmtWhen(r.decidedAt)}` : ''}</>}
                        {(r.status === 'applied' || r.status === 'pending') && r.approverName && <> · Awaiting {titleCase(r.approverName)}</>}
                      </div>
                    </div>
                    {(r.status === 'applied' || r.status === 'pending') && r.canDecide && (
                      <div className="flex flex-col gap-1.5 shrink-0">
                        <button disabled={busyId === key} onClick={() => decide(r, 'approve')} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50" style={{ background: '#0F9D58' }}>Approve</button>
                        <button disabled={busyId === key} onClick={() => { setDeclineFor(r); setDeclineNote(''); }} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-500">Decline</button>
                      </div>
                    )}
                  </div>
                  {declineFor && declineFor.ids.join(',') === key && (
                    <div className="mt-3 pt-3 border-t border-slate-100">
                      <div className="text-xs font-bold text-slate-500 mb-1">Reason for declining (optional)</div>
                      <textarea rows={2} value={declineNote} onChange={(e) => setDeclineNote(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Shared with the employee." />
                      <div className="flex justify-end gap-2 mt-2">
                        <button onClick={() => setDeclineFor(null)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">Cancel</button>
                        <button disabled={busyId === key} onClick={() => decide(r, 'decline')} className="rounded-lg px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50" style={{ background: '#DC2626' }}>Confirm decline</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Employees & leave credit, grouped by branch → department */}
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Employees &amp; leave credit · {filteredEmployees.length}</div>
        {Object.keys(grouped).sort().map((branch) => (
          <div key={branch} className="mb-5">
            <div className="text-sm font-extrabold text-[#050A1F] mb-2 flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{ background: '#FF6A00' }} />{branch}</div>
            {Object.keys(grouped[branch]).sort().map((dept) => (
              <div key={dept} className="mb-3">
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5 ml-1">{dept}</div>
                <div className="space-y-2">
                  {grouped[branch][dept].map((e) => (
                    <div key={e.id} className="bg-white rounded-2xl border border-slate-200 p-3 shadow-sm">
                      <div className="flex items-center gap-3 flex-wrap">
                        <Avatar name={e.name} src={e.avatar} size={34} />
                        <div className="min-w-0" style={{ flex: '1 1 160px' }}>
                          <button onClick={() => onOpenEmployee && onOpenEmployee(e.id)} className="font-bold text-[#050A1F] hover:text-[#FF4500] text-left">{titleCase(e.name)}</button>
                          <div className="text-[11px] text-slate-400">{e.designation || e.department}</div>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          {TYPES.map((t) => <Chip key={t.id} t={t} used={e.used[t.id] || 0} total={e.allocation[t.id] || 0} />)}
                        </div>
                        <button onClick={() => setExpanded((x) => ({ ...x, [e.id]: !x[e.id] }))}
                          className="text-[11px] font-bold text-slate-400 hover:text-slate-600 ml-auto flex items-center gap-1">
                          {expanded[e.id] ? 'Hide history' : 'View history'}
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded[e.id] ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}><polyline points="6 9 12 15 18 9" /></svg>
                        </button>
                      </div>
                      {expanded[e.id] && (
                        <div className="mt-3 pt-3 border-t border-slate-100">
                          {(e.history || []).length === 0 ? (
                            <div className="text-xs text-slate-400 py-2">No leave records yet.</div>
                          ) : (
                            <div className="space-y-1.5">
                              {e.history.map((h, i) => {
                                const tp = TYPES.find((t) => t.id === h.type) || TYPES[0]; const sm = STATUS_META[h.status];
                                return (
                                  <div key={i} className="flex items-center gap-2 flex-wrap text-xs py-1.5 border-b border-slate-50 last:border-0">
                                    <span className="font-bold uppercase text-[10px] rounded px-1.5 py-0.5" style={{ background: tp.color + '18', color: tp.color }}>{tp.label}</span>
                                    <span className="text-slate-600 font-semibold">{h.from === h.to ? fmtDay(h.from) : `${fmtDayShort(h.from)} — ${fmtDay(h.to)}`}</span>
                                    <span className="text-slate-400">· {h.days} day{h.days === 1 ? '' : 's'}{h.duration === 'half' ? ' (half)' : ''}</span>
                                    {h.reason && <span className="text-slate-400 truncate max-w-[220px]">· “{h.reason}”</span>}
                                    <span className="ml-auto text-[10px] font-extrabold rounded px-1.5 py-0.5" style={{ background: sm.bg, color: sm.color }}>{sm.label}</span>
                                    {h.status === 'approved' && h.decidedByName && <span className="text-[10px] text-green-600 font-bold w-full pl-1">Approved by {titleCase(h.decidedByName)}{h.decidedAt ? ` · ${fmtWhen(h.decidedAt)}` : ''}</span>}
                                    {h.status === 'declined' && h.decidedByName && <span className="text-[10px] text-red-500 font-bold w-full pl-1">Declined by {titleCase(h.decidedByName)}{h.decidedAt ? ` · ${fmtWhen(h.decidedAt)}` : ''}</span>}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

import React, { useState, useEffect, useMemo } from 'react';
import { hrApi } from './HrApp.jsx';
import { titleCase, uploadToImageKit } from './HrParts.jsx';

const ORANGE = 'linear-gradient(90deg,#FF6A00,#FF4500)';
const BRANCHES = ['Bhubaneswar', 'Kolkata'];
const STATUS_META = {
  submitted: { label: 'Submitted', color: '#B45309', bg: '#FEF3C7' },
  approved: { label: 'Approved', color: '#0369A1', bg: '#E0F2FE' },
  paid: { label: 'Paid', color: '#15803D', bg: '#DCFCE7' },
  rejected: { label: 'Rejected', color: '#DC2626', bg: '#FEF2F2' },
};
const METHODS = [['cash', 'Cash'], ['bank', 'Bank Transfer'], ['upi', 'UPI'], ['cheque', 'Cheque']];
const BANKS = [['kotak', 'Kotak'], ['indian', 'Indian'], ['indian_cc', 'Indian CC']];
// Employee payment types. HR sees all five; employee self-claims exclude Incentive.
const EMP_PAY_TYPES = [['ta', 'TA (Travel Allowance)'], ['da', 'DA (Daily Allowance)'], ['other', 'Other expenses'], ['advance', 'Advance'], ['incentive', 'Incentive']];
const EMP_PAY_TYPES_CLAIM = EMP_PAY_TYPES.filter(([id]) => id !== 'incentive');
const empPayTypeLabel = (t) => (EMP_PAY_TYPES.find((x) => x[0] === t) || [null, ''])[1];
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const fmtDate = (d) => { if (!d) return '—'; try { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return d; } };
const fmtWhen = (iso) => { if (!iso) return '—'; try { return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const methodLabel = (m) => (METHODS.find((x) => x[0] === m) || [null, ''])[1];
const bankLabel = (b) => (BANKS.find((x) => x[0] === b) || [null, ''])[1];
const modeSummary = (m) => {
  if (!m) return '';
  if (m.type === 'bank') return `Bank Transfer · ${m.bankName || ''} ${m.accountNumber ? '· ' + m.accountNumber : ''}`.trim();
  if (m.type === 'upi') return `UPI · ${m.upiId || ''}`;
  if (m.type === 'cheque') return 'Cheque';
  return 'Cash';
};

function StatusBadge({ s }) { const m = STATUS_META[s] || STATUS_META.submitted; return <span className="text-[10px] font-extrabold rounded px-1.5 py-0.5" style={{ background: m.bg, color: m.color }}>{m.label}</span>; }
function BranchBadge({ b }) { return <span className="text-[10px] font-extrabold rounded px-1.5 py-0.5" style={{ background: '#EEF2FF', color: '#4338CA' }}>{b || '—'}</span>; }
function PayeeIcon({ type, name }) {
  const init = (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const vendor = type === 'vendor';
  return <span className="flex items-center justify-center text-[10px] font-extrabold shrink-0" style={{ width: 24, height: 24, borderRadius: vendor ? 999 : 7, background: vendor ? '#FDE9D7' : '#E2E9F8', color: vendor ? '#C2410C' : '#334155' }}>{init}</span>;
}

export default function HrExpenses({ user, isAdmin }) {
  const [tab, setTab] = useState('expenses');
  const [data, setData] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [didLoad, setDidLoad] = useState(false);
  const [err, setErr] = useState('');
  const [q, setQ] = useState(''); const [statusF, setStatusF] = useState(''); const [branchF, setBranchF] = useState(''); const [catF, setCatF] = useState('');
  const [monthF, setMonthF] = useState(() => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7));
  const [page, setPage] = useState(1); const PER = 10;
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [payFor, setPayFor] = useState(null);
  const [rejectFor, setRejectFor] = useState(null);
  const [detail, setDetail] = useState(null);
  const [vendorEdit, setVendorEdit] = useState(null);
  const [vendorHistory, setVendorHistory] = useState(null);
  const [catOpen, setCatOpen] = useState(false);
  const [monthlyOpen, setMonthlyOpen] = useState(false);
  const [claims, setClaims] = useState(null);
  const [reviewFor, setReviewFor] = useState(null);   // claim being HR-reviewed
  const [settleFor, setSettleFor] = useState(null);   // approved claim being settled
  const [approveFor, setApproveFor] = useState(null); // expense being approved (with pay-due date)

  const loadClaims = () => hrApi('/claims').then((r) => setClaims(r)).catch(() => {});
  const load = () => {
    Promise.all([
      hrApi('/expenses').then((r) => setData(r)).catch((e) => setErr(e.message)),
      hrApi('/vendors').then((r) => setVendors(r.vendors || [])).catch(() => {}),
      hrApi('/expense-categories').then((r) => setCats(r.categories || [])).catch(() => {}),
      hrApi('/employees').then((r) => setEmployees(Array.isArray(r) ? r : (r.employees || []))).catch(() => {}),
      hrApi('/claims').then((r) => setClaims(r)).catch(() => {}),
    ]).finally(() => { setLoading(false); setDidLoad(true); });
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { setPage(1); }, [q, statusF, branchF, catF, monthF, tab]);

  const expenses = (data && data.expenses) || [];
  const counts = (data && data.counts) || { pending: 0, approved: 0, paid: 0, rejected: 0 };

  const filtered = expenses.filter((e) => {
    if (statusF && e.status !== statusF) return false;
    if (branchF && e.branch !== branchF) return false;
    if (catF && e.category !== catF) return false;
    if (monthF && (e.expenseDate || '').slice(0, 7) !== monthF) return false;
    if (q && !(`${e.title} ${e.payeeName || ''} ${e.category || ''}`.toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  });
  const pages = Math.max(1, Math.ceil(filtered.length / PER));
  const pageRows = filtered.slice((page - 1) * PER, page * PER);

  const decide = async (e, decision, reason, payDueDate) => {
    try { await hrApi(`/expenses/${e._id}/decide`, { method: 'POST', body: JSON.stringify({ decision, reason: reason || '', payDueDate: payDueDate || '' }) }); setRejectFor(null); setApproveFor(null); load(); }
    catch (er) { setErr(er.message); }
  };
  const decideClaim = async (c, decision) => {
    try { await hrApi(`/expenses/${c._id}/decide`, { method: 'POST', body: JSON.stringify({ decision, reason: '' }) }); load(); }
    catch (er) { setErr(er.message); }
  };

  const rollup = useMemo(() => {
    const monthRows = expenses.filter((e) => (e.expenseDate || '').slice(0, 7) === monthF);
    const byCat = {}; const byBranch = {}; let total = 0;
    monthRows.forEach((e) => {
      total += Number(e.amount || 0);
      byCat[e.category || 'Uncategorised'] = (byCat[e.category || 'Uncategorised'] || 0) + Number(e.amount || 0);
      byBranch[e.branch || '—'] = (byBranch[e.branch || '—'] || 0) + Number(e.amount || 0);
    });
    return { total, byCat: Object.entries(byCat).sort((a, b) => b[1] - a[1]), byBranch: Object.entries(byBranch).sort((a, b) => b[1] - a[1]), count: monthRows.length };
  }, [expenses, monthF]);

  const exportCsv = () => {
    const rows = [['Date', 'Title', 'Category', 'Branch', 'Payee', 'Payee type', 'Pay type', 'Amount (INR)', 'Status', 'Method', 'Bank', 'Reference / Txn ID', 'UPI ID', 'Payee mobile', 'Cheque no.', 'Cheque bank', 'Cheque date', 'Payment date', 'Approved by', 'Paid by']];
    filtered.forEach((e) => rows.push([e.expenseDate, e.title, e.category, e.branch, e.payeeName, e.payeeType, empPayTypeLabel(e.employeePayType), e.amount, STATUS_META[e.status].label, methodLabel(e.paymentMethod), bankLabel(e.bankName), e.paymentRef || '', e.paymentUpiId || '', e.paymentMobile || '', e.chequeNumber || '', e.chequeBank || '', e.chequeDate || '', e.paymentDate || '', e.approvedByName || '', e.paidByName || '']));
    const csv = rows.map((r) => r.map((c) => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `expenses-${monthF}.csv`; a.click();
  };

  if (loading && !didLoad) return <div className="text-center text-slate-400 py-20 text-sm">Loading expenses…</div>;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-end justify-between mb-4 flex-wrap gap-3">
        <div><h1 className="text-2xl font-extrabold text-[#050A1F]">Expenses</h1><p className="text-sm text-slate-400">Raise expenses, get admin approval, then record payment to the vendor or employee.</p></div>
        <div className="flex gap-2"><button onClick={exportCsv} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">⬇ Export CSV</button><button onClick={() => setRaiseOpen(true)} className="rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ background: ORANGE }}>+ New expense</button></div>
      </div>
      {err && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm px-3 py-2 flex justify-between"><span>{err}</span><button onClick={() => setErr('')}>×</button></div>}

      <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
        {[
          { key: 'pending', label: 'Pending approval', value: counts.pending, color: '#F59E0B', bg: '#FFFBEB' },
          { key: 'approved', label: 'Approved · to pay', value: counts.approved, color: '#0EA5E9', bg: '#F0F9FF' },
          { key: 'paid', label: 'Paid this month', value: inr(data && data.paidThisMonth), color: '#0F9D58', bg: '#F0FDF4' },
          { key: 'total', label: 'Total this month', value: inr(data && data.totalThisMonth), color: '#8B5CF6', bg: '#F5F3FF', link: true },
        ].map((c) => (
          <div key={c.label} onClick={c.link ? () => setMonthlyOpen(true) : undefined} className={`rounded-2xl border border-slate-100 p-4 shadow-sm ${c.link ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`} style={{ background: c.bg }}>
            <div className="text-2xl font-extrabold" style={{ color: c.color }}>{c.value}</div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mt-1 flex items-center gap-1">{c.label}{c.link && <span className="text-[#8B5CF6] normal-case font-bold">· view months</span>}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-1.5 mb-4 bg-slate-100 p-1 rounded-xl w-fit items-center">
        {[['expenses', `Expenses · ${expenses.length}`], ['claims', `Claims${claims && claims.counts ? ` · ${(claims.counts.submitted || 0) + (claims.counts.hr_approved || 0) + (claims.counts.approved || 0)}` : ''}`], ['vendors', `Vendors · ${vendors.length}`], ['rollup', 'Monthly rollup']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`px-3.5 py-1.5 rounded-lg text-[12px] font-extrabold ${tab === id ? 'bg-white text-[#050A1F] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{label}</button>
        ))}
        {tab === 'expenses' && <button onClick={() => setCatOpen(true)} className="px-3 py-1.5 rounded-lg text-[12px] font-bold text-slate-400 hover:text-slate-600">⚙ Categories</button>}
      </div>

      {tab === 'expenses' && (<>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, payee…" className="rounded-lg border border-slate-300 px-3 py-2 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-orange-300" />
          <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-2 text-sm"><option value="">All statuses</option>{Object.keys(STATUS_META).map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}</select>
          <select value={branchF} onChange={(e) => setBranchF(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-2 text-sm"><option value="">All branches</option>{BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}</select>
          <select value={catF} onChange={(e) => setCatF(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-2 text-sm"><option value="">All categories</option>{cats.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <input type="month" value={monthF} onChange={(e) => setMonthF(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-2 text-sm" />
        </div>
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-400">No expenses match these filters.</div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50/80 text-[10px] uppercase tracking-wider text-slate-400 font-bold border-b border-slate-100">
                <th className="text-left px-4 py-3">Date</th><th className="text-left px-4 py-3">Title / Category</th><th className="text-left px-4 py-3">Branch</th><th className="text-left px-4 py-3">Payee</th><th className="text-right px-4 py-3">Amount</th><th className="text-left px-4 py-3">Invoice</th><th className="text-left px-4 py-3">Status</th><th className="text-right px-4 py-3">Action</th>
              </tr></thead>
              <tbody>
                {pageRows.map((e) => (
                  <tr key={e._id} className="border-t border-slate-50 hover:bg-orange-50/30 cursor-pointer" onClick={() => setDetail(e)}>
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{fmtDate(e.expenseDate)}</td>
                    <td className="px-4 py-3"><div className="font-bold text-[#050A1F]">{e.title}</div><div className="text-[11px] text-slate-400">{e.category || '—'}</div></td>
                    <td className="px-4 py-3"><BranchBadge b={e.branch} /></td>
                    <td className="px-4 py-3"><div className="flex items-center gap-2"><PayeeIcon type={e.payeeType} name={e.payeeName} /><span className="text-slate-600 text-xs">{e.payeeName || '—'}</span></div></td>
                    <td className="px-4 py-3 text-right font-extrabold text-[#050A1F] whitespace-nowrap">{inr(e.amount)}</td>
                    <td className="px-4 py-3">{e.invoiceUrl ? <a href={e.invoiceUrl} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()} className="text-[11px] font-bold text-sky-600">📎 {e.invoiceName || 'view'}</a> : <span className="text-[11px] text-slate-300">—</span>}</td>
                    <td className="px-4 py-3"><StatusBadge s={e.status} />{e.status === 'paid' && e.paymentMethod && <span className="text-[10px] text-slate-400 ml-1">{methodLabel(e.paymentMethod)}</span>}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap" onClick={(ev) => ev.stopPropagation()}>
                      {e.status === 'submitted' && isAdmin && <span className="inline-flex gap-1"><button onClick={() => setApproveFor(e)} className="text-[11px] font-bold text-white px-2.5 py-1 rounded" style={{ background: '#0F9D58' }}>Approve</button><button onClick={() => setRejectFor(e)} className="text-[11px] font-bold text-red-500 border border-red-200 px-2.5 py-1 rounded">Reject</button></span>}
                      {e.status === 'submitted' && !isAdmin && <span className="text-[11px] text-slate-400">Awaiting admin</span>}
                      {e.status === 'approved' && <button onClick={() => setPayFor(e)} className="text-[11px] font-bold text-white px-2.5 py-1 rounded" style={{ background: '#050A1F' }}>Mark paid</button>}
                      {e.status === 'paid' && <span className="text-[11px] text-slate-300">Done</span>}
                      {e.status === 'rejected' && <span className="text-[11px] text-slate-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-4">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 disabled:opacity-40">← Prev</button>
            <span className="text-xs font-bold text-slate-500">Page {page} of {pages}</span>
            <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 disabled:opacity-40">Next →</button>
          </div>
        )}
      </>)}

      {tab === 'vendors' && <VendorsTab vendors={vendors} onAdd={() => setVendorEdit({})} onEdit={(v) => setVendorEdit(v)} onHistory={(v) => setVendorHistory(v)} reload={load} setErr={setErr} />}

      {tab === 'claims' && <ClaimsTab claims={claims} isAdmin={isAdmin} onReview={setReviewFor} onDecide={decideClaim} onSettle={setSettleFor} onPay={setPayFor} onDetail={setDetail} />}

      {tab === 'rollup' && (
        <div>
          <div className="flex items-center gap-2 mb-4"><span className="text-sm font-bold text-slate-500">Month</span><input type="month" value={monthF} onChange={(e) => setMonthF(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-2 text-sm" /></div>
          <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
              <div className="text-sm font-bold text-[#050A1F] mb-1">By category</div>
              <div className="text-[11px] text-slate-400 mb-3">{rollup.count} expenses · {inr(rollup.total)} total</div>
              {rollup.byCat.length === 0 ? <div className="text-sm text-slate-400 py-4">No expenses this month.</div> : rollup.byCat.map(([c, amt]) => { const pct = rollup.total > 0 ? Math.round((amt / rollup.total) * 100) : 0; return <div key={c} className="mb-2.5"><div className="flex justify-between text-xs mb-1"><span className="font-semibold text-slate-600">{c}</span><span className="font-bold text-[#050A1F]">{inr(amt)} <span className="text-slate-400 font-normal">· {pct}%</span></span></div><div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: ORANGE }} /></div></div>; })}
            </div>
            <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
              <div className="text-sm font-bold text-[#050A1F] mb-3">By branch</div>
              {rollup.byBranch.length === 0 ? <div className="text-sm text-slate-400 py-4">No expenses this month.</div> : rollup.byBranch.map(([b, amt]) => { const pct = rollup.total > 0 ? Math.round((amt / rollup.total) * 100) : 0; return <div key={b} className="mb-2.5"><div className="flex justify-between text-xs mb-1"><span className="font-semibold text-slate-600">{b}</span><span className="font-bold text-[#050A1F]">{inr(amt)} <span className="text-slate-400 font-normal">· {pct}%</span></span></div><div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: '#4338CA' }} /></div></div>; })}
            </div>
          </div>
        </div>
      )}

      {raiseOpen && <RaiseExpenseModal user={user} isAdmin={isAdmin} cats={cats} vendors={vendors.filter((v) => v.active)} employees={employees} onClose={() => setRaiseOpen(false)} onSaved={() => { setRaiseOpen(false); load(); }} onAddVendor={() => setVendorEdit({})} />}
      {payFor && <PayModal expense={payFor} onClose={() => setPayFor(null)} onSaved={() => { setPayFor(null); load(); }} />}
      {reviewFor && <ClaimReviewModal claim={reviewFor} onClose={() => setReviewFor(null)} onSaved={() => { setReviewFor(null); load(); }} />}
      {settleFor && <ClaimSettleModal claim={settleFor} onClose={() => setSettleFor(null)} onSalary={() => { setSettleFor(null); load(); }} onPayNow={(c) => { setSettleFor(null); setPayFor(c); }} />}
      {rejectFor && <RejectModal expense={rejectFor} onClose={() => setRejectFor(null)} onConfirm={(reason) => decide(rejectFor, 'reject', reason)} />}
      {approveFor && <ApproveExpenseModal expense={approveFor} onClose={() => setApproveFor(null)} onConfirm={(payDueDate) => decide(approveFor, 'approve', '', payDueDate)} />}
      {detail && <ExpenseDrawer expense={detail} onClose={() => setDetail(null)} />}
      {vendorEdit && <VendorModal vendor={vendorEdit} cats={cats} onClose={() => setVendorEdit(null)} onSaved={() => { setVendorEdit(null); load(); }} setErr={setErr} />}
      {vendorHistory && <VendorHistoryDrawer vendor={vendorHistory} onClose={() => setVendorHistory(null)} />}
      {catOpen && <CategoryModal cats={cats} onClose={() => setCatOpen(false)} onSaved={(list) => { setCats(list); setCatOpen(false); }} setErr={setErr} />}
      {monthlyOpen && <MonthlyTotalsModal onClose={() => setMonthlyOpen(false)} />}
    </div>
  );
}

function VendorsTab({ vendors, onAdd, onEdit, onHistory, reload, setErr }) {
  const del = async (v) => {
    if (!window.confirm(`Delete vendor "${v.name}"? If they have past payments, they'll be deactivated instead.`)) return;
    try { await hrApi(`/vendors/${v._id}`, { method: 'DELETE' }); reload(); } catch (e) { setErr(e.message); }
  };
  return (
    <div>
      <div className="flex justify-end mb-3"><button onClick={onAdd} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: ORANGE }}>+ Add vendor</button></div>
      {vendors.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-400">No vendors yet. Add one to pay expenses.</div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50/80 text-[10px] uppercase tracking-wider text-slate-400 font-bold border-b border-slate-100">
              <th className="text-left px-4 py-3">Vendor</th><th className="text-left px-4 py-3">Contact</th><th className="text-left px-4 py-3">Category</th><th className="text-left px-4 py-3">GST</th><th className="text-left px-4 py-3">Branch</th><th className="text-right px-4 py-3">Actions</th>
            </tr></thead>
            <tbody>
              {vendors.map((v) => (
                <tr key={v._id} className="border-t border-slate-50 hover:bg-slate-50/50">
                  <td className="px-4 py-3"><div className="flex items-center gap-2"><PayeeIcon type="vendor" name={v.name} /><div><div className="font-bold text-[#050A1F]">{v.name}{!v.active && <span className="text-[10px] text-slate-400 ml-1">(inactive)</span>}{v.recurringPayment && v.recurringDay && <span className="text-[9px] font-extrabold text-violet-600 bg-violet-50 rounded px-1.5 py-0.5 ml-1.5">↻ {v.recurringDay}{['st', 'nd', 'rd'][((v.recurringDay % 10) - 1)] && ![11, 12, 13].includes(v.recurringDay) ? ['st', 'nd', 'rd'][((v.recurringDay % 10) - 1)] : 'th'}</span>}</div>{v.city && <div className="text-[11px] text-slate-400">{v.city}{v.state ? `, ${v.state}` : ''}</div>}</div></div></td>
                  <td className="px-4 py-3 text-xs text-slate-500">{v.contactPerson || '—'}{v.phone && <div className="text-slate-400">{v.phone}</div>}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{v.category || '—'}</td>
                  <td className="px-4 py-3 text-xs">{v.hasGst ? <span className="font-mono text-[11px] text-slate-600">{v.gstin}</span> : <span className="text-slate-300">No</span>}</td>
                  <td className="px-4 py-3 text-xs">{v.branch ? <BranchBadge b={v.branch} /> : <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => onHistory(v)} className="text-[11px] font-bold text-slate-500 border border-slate-200 px-2.5 py-1 rounded mr-1 hover:bg-slate-50">History</button>
                    <button onClick={() => onEdit(v)} className="text-[11px] font-bold text-blue-600 border border-blue-100 px-2.5 py-1 rounded mr-1 hover:bg-blue-50">Edit</button>
                    <button onClick={() => del(v)} className="text-[11px] font-bold text-red-500 border border-red-100 px-2.5 py-1 rounded hover:bg-red-50">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RaiseExpenseModal({ user, isAdmin, cats, vendors, employees, onClose, onSaved, onAddVendor }) {
  const allBranch = isAdmin || user.hrManagerAll || user.hrManagerScope === 'all' || !user.hrManagerScope;
  const lockedBranch = !allBranch ? (user.hrManagerScope || user.branch || '') : '';
  const [f, setF] = useState({ title: '', category: cats[0] || '', amount: '', expenseDate: new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10), branch: lockedBranch || 'Bhubaneswar', payeeType: 'vendor', vendorId: '', employeeId: '', employeePayType: '', description: '', modeIdx: '' });
  const [invoice, setInvoice] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [aiState, setAiState] = useState('');   // '', 'reading', 'done', 'failed'
  const [aiNote, setAiNote] = useState('');
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const readAsDataURL = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('Could not read file.')); r.readAsDataURL(file); });
  const pickInvoice = async (e) => {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    setUploading(true); setErr(''); setAiState(''); setAiNote('');
    let dataUrl = '';
    try { dataUrl = await readAsDataURL(file); } catch {}
    // 1) Upload to ImageKit so the file is attached to the expense.
    try { const safe = (f.title || 'expense').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30); const { url } = await uploadToImageKit(file, `/qtonix-hr/expenses/${safe}-${Date.now()}`, file.name); setInvoice({ url, name: file.name }); }
    catch (er) { setErr('Invoice upload failed. ' + (er.message || '')); setUploading(false); return; }
    setUploading(false);
    // 2) Ask the server to read the invoice and auto-fill (best-effort).
    if (!dataUrl) return;
    setAiState('reading');
    try {
      const r = await hrApi('/expenses/parse-invoice', { method: 'POST', body: JSON.stringify({ base64: dataUrl, fileName: file.name }) });
      if (r && r.ok && r.fields) {
        const fld = r.fields;
        setF((s) => ({
          ...s,
          title: s.title || fld.description || fld.vendorName || s.title,
          amount: s.amount || (fld.amount ? String(fld.amount) : s.amount),
          expenseDate: fld.invoiceDate && /^\d{4}-\d{2}-\d{2}$/.test(fld.invoiceDate) ? fld.invoiceDate : s.expenseDate,
          description: s.description || fld.description || '',
          vendorId: (s.payeeType === 'vendor' && r.matchedVendorId) ? String(r.matchedVendorId) : s.vendorId,
          category: (fld.category && cats.find((c) => c.toLowerCase() === String(fld.category).toLowerCase())) || s.category,
        }));
        setAiState('done');
        if (r.matchedVendorName) setAiNote(`Matched vendor: ${r.matchedVendorName}. Review the details below.`);
        else if (fld.vendorName) setAiNote(`Read "${fld.vendorName}". Pick or add the vendor below, then review.`);
        else setAiNote('Details filled from the invoice. Please review below.');
      } else { setAiState('failed'); setAiNote('Could not auto-read this file. Enter the details manually.'); }
    } catch { setAiState('failed'); setAiNote('Could not auto-read this file. Enter the details manually.'); }
  };
  const save = async () => {
    if (!f.title.trim()) { setErr('Title is required.'); return; }
    if (!(Number(f.amount) > 0)) { setErr('Enter a valid amount.'); return; }
    if (f.payeeType === 'vendor' && !f.vendorId) { setErr('Select a vendor.'); return; }
    if (f.payeeType === 'employee' && !f.employeeId) { setErr('Select an employee.'); return; }
    if (f.payeeType === 'employee' && !f.employeePayType) { setErr('Choose the payment type (TA, DA, Other, Advance or Incentive).'); return; }
    if (f.payeeType === 'employee' && f.employeePayType === 'other' && !f.description.trim()) { setErr('Please add details for an "Other expenses" payment.'); return; }
    setBusy(true); setErr('');
    try {
      const selVendor = vendors.find((v) => String(v._id) === String(f.vendorId));
      const selectedPaymentMode = (f.payeeType === 'vendor' && selVendor && Array.isArray(selVendor.paymentModes) && f.modeIdx !== '') ? selVendor.paymentModes[Number(f.modeIdx)] : null;
      await hrApi('/expenses', { method: 'POST', body: JSON.stringify({ ...f, amount: Number(f.amount), vendorId: f.vendorId || null, employeeId: f.employeeId || null, selectedPaymentMode, invoiceUrl: invoice ? invoice.url : '', invoiceName: invoice ? invoice.name : '' }) }); onSaved(); }
    catch (er) { setErr(er.message); } finally { setBusy(false); }
  };
  return (
    <ModalShell title="New expense" onClose={onClose} wide>
      {err && <div className="rounded-lg bg-red-50 border border-red-200 text-red-600 text-xs px-3 py-2 mb-3">{err}</div>}
      <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label="Title" full><input value={f.title} onChange={(e) => set('title', e.target.value)} className="inp" placeholder="e.g. Office WiFi — August" /></Field>
        <Field label="Category"><select value={f.category} onChange={(e) => set('category', e.target.value)} className="inp">{cats.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
        <Field label="Amount (₹)"><input type="number" value={f.amount} onChange={(e) => set('amount', e.target.value)} className="inp" placeholder="0" /></Field>
        <Field label="Expense date"><input type="date" value={f.expenseDate} onChange={(e) => set('expenseDate', e.target.value)} className="inp" /></Field>
        <Field label="Branch">{lockedBranch ? <input value={lockedBranch} disabled className="inp" style={{ background: '#f8fafc', color: '#64748b' }} /> : <select value={f.branch} onChange={(e) => set('branch', e.target.value)} className="inp">{BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}</select>}</Field>
        <Field label="Pay to" full>
          <div className="flex gap-2 mb-2">{[['vendor', 'Vendor'], ['employee', 'Employee']].map(([id, lbl]) => <button key={id} type="button" onClick={() => set('payeeType', id)} className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${f.payeeType === id ? 'border-orange-400 bg-orange-50 text-[#FF4500]' : 'border-slate-200 text-slate-600'}`}>{lbl}</button>)}</div>
          {f.payeeType === 'vendor' ? (
            <>
              <div className="flex gap-2"><select value={f.vendorId} onChange={(e) => { set('vendorId', e.target.value); set('modeIdx', ''); }} className="inp"><option value="">Select vendor…</option>{vendors.map((v) => <option key={v._id} value={v._id}>{v.name}</option>)}</select><button type="button" onClick={onAddVendor} className="rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-600 whitespace-nowrap">+ New</button></div>
              {(() => { const sv = vendors.find((v) => String(v._id) === String(f.vendorId)); const pm = (sv && Array.isArray(sv.paymentModes)) ? sv.paymentModes : []; if (!sv) return null; return (
                <div className="mt-2">
                  {pm.length === 0 ? <div className="text-[11px] text-amber-600">This vendor has no saved payment mode. Add one via Edit vendor.</div>
                    : <select value={f.modeIdx} onChange={(e) => set('modeIdx', e.target.value)} className="inp"><option value="">Payment mode (optional)…</option>{pm.map((m, i) => <option key={i} value={i}>{modeSummary(m)}</option>)}</select>}
                </div>
              ); })()}
            </>
          ) : (
            <>
              <select value={f.employeeId} onChange={(e) => set('employeeId', e.target.value)} className="inp"><option value="">Select employee…</option>{employees.map((em) => <option key={em._id || em.id} value={em._id || em.id}>{titleCase(em.name)}</option>)}</select>
              <div className="mt-2"><select value={f.employeePayType} onChange={(e) => set('employeePayType', e.target.value)} className="inp"><option value="">Payment type…</option>{EMP_PAY_TYPES.map(([id, lbl]) => <option key={id} value={id}>{lbl}</option>)}</select></div>
              {f.employeePayType === 'other' && <div className="mt-1 text-[11px] text-amber-600">Please add details below for an "Other expenses" payment.</div>}
            </>
          )}
        </Field>
        <Field label="Description" full><textarea rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} className="inp" placeholder="Optional notes" /></Field>
        <Field label="Invoice" full>
          <div className="flex items-center gap-2">{invoice ? <span className="text-xs text-green-600 font-bold">✓ {invoice.name} <span className="text-slate-400 font-normal">(attached)</span></span> : <span className="text-xs text-slate-400">Upload above to attach an invoice — optional.</span>}</div>
        </Field>
      </div>
      <div className="flex justify-end gap-2 mt-5"><button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button><button onClick={save} disabled={busy || uploading} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Submitting…' : 'Submit for approval'}</button></div>
    </ModalShell>
  );
}

// ===== Employee expense claims (HR/Admin review side) ======================
const CLAIM_STATUS = {
  submitted: { label: 'HR review', bg: '#FEF3C7', color: '#B45309' },
  hr_approved: { label: 'Admin approval', bg: '#E0E7FF', color: '#4338CA' },
  approved: { label: 'To settle', bg: '#DBEAFE', color: '#1D4ED8' },
  queued_for_payroll: { label: 'In next salary', bg: '#EDE9FE', color: '#6D28D9' },
  paid: { label: 'Paid', bg: '#DCFCE7', color: '#15803D' },
  rejected: { label: 'Rejected', bg: '#FEE2E2', color: '#B91C1C' },
};
function ClaimStatusBadge({ s }) { const m = CLAIM_STATUS[s] || { label: s, bg: '#F1F5F9', color: '#475569' }; return <span className="text-[10px] font-extrabold rounded px-1.5 py-0.5" style={{ background: m.bg, color: m.color }}>{m.label}</span>; }

function ClaimsTab({ claims, isAdmin, onReview, onDecide, onSettle, onPay, onDetail }) {
  const [statusF, setStatusF] = useState('');
  if (!claims) return <div className="text-sm text-slate-400 py-10 text-center">Loading claims…</div>;
  const rows = (claims.claims || []).filter((c) => !statusF || c.status === statusF);
  const c = claims.counts || {};
  const kpis = [['submitted', 'Awaiting HR', c.submitted || 0, '#B45309'], ['hr_approved', 'Awaiting admin', c.hr_approved || 0, '#4338CA'], ['approved', 'To settle', c.approved || 0, '#1D4ED8'], ['queued_for_payroll', 'In salary', c.queued_for_payroll || 0, '#6D28D9'], ['paid', 'Paid', c.paid || 0, '#15803D']];
  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {kpis.map(([id, label, n, color]) => (
          <button key={id} onClick={() => setStatusF(statusF === id ? '' : id)} className={`text-left rounded-2xl border p-3 bg-white ${statusF === id ? 'border-orange-300 ring-1 ring-orange-200' : 'border-slate-100'}`}>
            <div className="text-2xl font-extrabold" style={{ color }}>{n}</div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
          </button>
        ))}
      </div>
      {statusF && <button onClick={() => setStatusF('')} className="text-[11px] font-bold text-slate-400 mb-2 hover:text-slate-600">Clear filter ✕</button>}
      {rows.length === 0 ? (
        <div className="text-sm text-slate-400 py-10 text-center bg-white rounded-2xl border border-slate-100">No claims{statusF ? ' in this state' : ''}.</div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50/80 text-[10px] uppercase tracking-wider text-slate-400 font-bold border-b border-slate-100">
              <th className="text-left px-4 py-2.5">Employee</th><th className="text-left px-4 py-2.5">Claim</th><th className="text-left px-4 py-2.5">Type</th><th className="text-right px-4 py-2.5">Claimed</th><th className="text-right px-4 py-2.5">Reimbursable</th><th className="text-left px-4 py-2.5">Status</th><th className="text-right px-4 py-2.5">Action</th>
            </tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c._id} className="border-b border-slate-50 hover:bg-slate-50/50">
                  <td className="px-4 py-3"><div className="font-bold text-[#050A1F]">{titleCase(c.payeeName || '')}</div><div className="text-[11px] text-slate-400">{fmtDate(c.expenseDate)}{c.branch ? ` · ${c.branch}` : ''}</div></td>
                  <td className="px-4 py-3"><button onClick={() => onDetail(c)} className="text-left"><div className="font-semibold text-[#050A1F] hover:text-[#FF4500]">{c.title}</div>{c.invoiceUrl && <div className="text-[10px] text-sky-500">📎 invoice</div>}</button></td>
                  <td className="px-4 py-3 text-slate-500">{empPayTypeLabel(c.employeePayType) || '—'}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-500">{inr(c.claimedAmount)}</td>
                  <td className="px-4 py-3 text-right font-extrabold text-[#050A1F]">{c.approvedAmount != null ? inr(c.approvedAmount) : '—'}{c.approvedAmount != null && Number(c.approvedAmount) < Number(c.claimedAmount) && <div className="text-[9px] text-amber-600 font-bold">reduced</div>}</td>
                  <td className="px-4 py-3"><ClaimStatusBadge s={c.status} />{c.status === 'queued_for_payroll' && <div className="text-[9px] text-slate-400 mt-0.5">via payslip</div>}{c.status === 'paid' && c.paymentMethod === 'salary' && <div className="text-[9px] text-slate-400 mt-0.5">in salary</div>}</td>
                  <td className="px-4 py-3 text-right">
                    {c.status === 'submitted' && <button onClick={() => onReview(c)} className="rounded-lg px-3 py-1.5 text-[11px] font-bold text-white" style={{ background: ORANGE }}>Review</button>}
                    {c.status === 'hr_approved' && (isAdmin
                      ? <div className="flex gap-1.5 justify-end"><button onClick={() => onDecide(c, 'approve')} className="rounded-lg px-3 py-1.5 text-[11px] font-bold text-white" style={{ background: '#0F9D58' }}>Approve</button><button onClick={() => onDecide(c, 'reject')} className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-red-600 border border-red-200">Reject</button></div>
                      : <span className="text-[11px] text-slate-400">Awaiting admin</span>)}
                    {c.status === 'approved' && <button onClick={() => onSettle(c)} className="rounded-lg px-3 py-1.5 text-[11px] font-bold text-white" style={{ background: '#0EA5E9' }}>Settle</button>}
                    {c.status === 'queued_for_payroll' && <span className="text-[11px] text-violet-600 font-semibold">Next salary</span>}
                    {c.status === 'paid' && <span className="text-[11px] text-green-600 font-semibold">Paid</span>}
                    {c.status === 'rejected' && <span className="text-[11px] text-slate-400">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// HR reviews a submitted claim: set the reimbursable amount (≤ claimed) + notes.
function ClaimReviewModal({ claim, onClose, onSaved }) {
  const claimed = Number(claim.claimedAmount || claim.amount || 0);
  const [amount, setAmount] = useState(String(claimed));
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const submit = async (decision) => {
    if (decision === 'approve') {
      const a = Number(amount);
      if (!(a > 0)) { setErr('Enter the reimbursable amount.'); return; }
      if (a > claimed) { setErr(`Cannot exceed the claimed amount (${inr(claimed)}).`); return; }
    }
    setBusy(true); setErr('');
    try { await hrApi(`/expenses/${claim._id}/hr-review`, { method: 'POST', body: JSON.stringify({ decision, approvedAmount: Number(amount), notes }) }); onSaved(); }
    catch (er) { setErr(er.message); } finally { setBusy(false); }
  };
  const reduced = Number(amount) > 0 && Number(amount) < claimed;
  return (
    <ModalShell title="Review claim" onClose={onClose}>
      {err && <div className="rounded-lg bg-red-50 border border-red-200 text-red-600 text-xs px-3 py-2 mb-3">{err}</div>}
      <div className="rounded-xl bg-slate-50 p-3 mb-3">
        <div className="font-bold text-[#050A1F]">{claim.title}</div>
        <div className="text-[11px] text-slate-500 mt-0.5">{titleCase(claim.payeeName || '')} · {empPayTypeLabel(claim.employeePayType)} · claimed <b>{inr(claimed)}</b></div>
        {claim.description && <div className="text-[12px] text-slate-600 mt-1.5">{claim.description}</div>}
        {claim.invoiceUrl && <a href={claim.invoiceUrl} target="_blank" rel="noreferrer" className="inline-block text-[11px] font-bold text-sky-600 mt-1.5">📎 View invoice</a>}
      </div>
      <Field label="Reimbursable amount (₹)"><input value={amount} onChange={(e) => setAmount(e.target.value)} className="inp" placeholder="0" /></Field>
      {reduced && <div className="text-[11px] text-amber-600 mt-1">Reducing from {inr(claimed)} to {inr(Number(amount))}. Add a note explaining why.</div>}
      <div className="mt-3"><Field label="Notes to employee (optional)" full><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className="inp" placeholder="e.g. DA capped at policy limit; meal receipt not eligible." /></Field></div>
      <div className="flex justify-between gap-2 mt-5">
        <button onClick={() => submit('reject')} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-bold text-red-600 border border-red-200 disabled:opacity-50">Reject claim</button>
        <div className="flex gap-2"><button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button><button onClick={() => submit('approve')} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : 'Approve amount'}</button></div>
      </div>
      <div className="text-[11px] text-slate-400 mt-3">After you approve the amount, an admin gives final sign-off before it is settled.</div>
    </ModalShell>
  );
}

// After admin approval, choose how an approved claim is settled.
function ClaimSettleModal({ claim, onClose, onSalary, onPayNow }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const settle = async (method) => {
    setBusy(true); setErr('');
    try {
      await hrApi(`/expenses/${claim._id}/settle`, { method: 'POST', body: JSON.stringify({ settlementMethod: method }) });
      if (method === 'salary') onSalary();
      else onPayNow({ ...claim, status: 'approved' }); // open the pay window for cheque/cash
    } catch (er) { setErr(er.message); setBusy(false); }
  };
  return (
    <ModalShell title="Settle claim" onClose={onClose}>
      {err && <div className="rounded-lg bg-red-50 border border-red-200 text-red-600 text-xs px-3 py-2 mb-3">{err}</div>}
      <div className="rounded-xl bg-slate-50 p-3 mb-4">
        <div className="font-bold text-[#050A1F]">{claim.title}</div>
        <div className="text-[11px] text-slate-500 mt-0.5">Reimburse <b>{titleCase(claim.payeeName || '')}</b> · <b>{inr(claim.approvedAmount ?? claim.amount)}</b></div>
      </div>
      <div className="text-xs font-bold text-slate-500 mb-2">How would you like to settle this?</div>
      <div className="grid gap-2">
        <button onClick={() => settle('cheque')} disabled={busy} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 hover:border-orange-300 text-left disabled:opacity-50">
          <span className="w-9 h-9 rounded-lg bg-violet-100 text-violet-600 flex items-center justify-center text-lg">🧾</span>
          <span><span className="block text-sm font-bold text-[#050A1F]">Cheque</span><span className="block text-[11px] text-slate-400">Record cheque details on the next screen.</span></span>
        </button>
        <button onClick={() => settle('cash')} disabled={busy} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 hover:border-orange-300 text-left disabled:opacity-50">
          <span className="w-9 h-9 rounded-lg bg-green-100 text-green-600 flex items-center justify-center text-lg">💵</span>
          <span><span className="block text-sm font-bold text-[#050A1F]">Cash</span><span className="block text-[11px] text-slate-400">Mark as paid in cash on the next screen.</span></span>
        </button>
        <button onClick={() => settle('salary')} disabled={busy} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 hover:border-orange-300 text-left disabled:opacity-50">
          <span className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center text-lg">📅</span>
          <span><span className="block text-sm font-bold text-[#050A1F]">Add to next salary</span><span className="block text-[11px] text-slate-400">Included as a reimbursement line in the next payslip.</span></span>
        </button>
      </div>
    </ModalShell>
  );
}

function PayModal({ expense, onClose, onSaved }) {
  const sel = expense.selectedPaymentMode || null;
  // The vendor's saved bank account, for the full-details panel. Prefer the mode
  // chosen at raise time; fall back to any bank mode snapshotted on the expense.
  const bankMode = (sel && sel.type === 'bank') ? sel
    : (Array.isArray(expense.vendorPaymentModes) ? expense.vendorPaymentModes.find((m) => m && m.type === 'bank') : null) || null;
  const preMethod = sel && ['cash', 'bank', 'upi', 'cheque'].includes(sel.type) ? sel.type : 'cash';
  const [method, setMethod] = useState(preMethod);
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const [f, setF] = useState({
    paymentDate: today,
    paymentRef: '',
    bankName: 'kotak',
    paymentUpiId: sel && sel.type === 'upi' ? (sel.upiId || '') : '',
    paymentMobile: sel && sel.type === 'upi' ? (sel.mobile || '') : '',
    chequeNumber: '',
    chequeBank: '',
    chequeDate: today,
  });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const save = async () => {
    if (method === 'bank' && !f.paymentRef.trim()) { setErr('Transaction ID is required for a bank transfer.'); return; }
    if (method === 'upi') {
      if (!f.paymentUpiId.trim()) { setErr('UPI ID is required for a UPI payment.'); return; }
      if (!f.paymentRef.trim()) { setErr('UPI transaction / reference ID is required.'); return; }
    }
    if (method === 'cheque' && !f.chequeNumber.trim()) { setErr('Cheque number is required.'); return; }
    setBusy(true); setErr('');
    try { await hrApi(`/expenses/${expense._id}/pay`, { method: 'POST', body: JSON.stringify({ paymentMethod: method, ...f }) }); onSaved(); }
    catch (er) { setErr(er.message); } finally { setBusy(false); }
  };
  return (
    <ModalShell title={`Record payment · ${inr(expense.amount)}`} onClose={onClose}>
      {err && <div className="rounded-lg bg-red-50 border border-red-200 text-red-600 text-xs px-3 py-2 mb-3">{err}</div>}
      <div className="text-xs text-slate-500 mb-3">Paying <b>{expense.payeeName}</b> for “{expense.title}”.</div>
      {sel && <div className="text-[11px] rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-700 px-3 py-2 mb-3">Vendor's saved mode: <b>{modeSummary(sel)}</b>{sel.type === 'bank' && sel.ifsc ? ` · IFSC ${sel.ifsc}` : ''}{sel.type === 'bank' && sel.accountName ? ` · ${sel.accountName}` : ''}{sel.type === 'upi' && sel.mobile ? ` · ${sel.mobile}` : ''}</div>}

      {/* Full vendor bank-account details, so the transfer can be made without
          leaving this window. Pulled from the vendor's saved bank mode. */}
      {method === 'bank' && bankMode && (
        <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-3 mb-3">
          <div className="text-[10px] font-extrabold uppercase tracking-wide text-sky-700 mb-2 flex items-center gap-1.5">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18 M3 10h18 M5 6l7-3 7 3 M4 10v11 M20 10v11 M8 14v3 M12 14v3 M16 14v3" /></svg>
            Vendor bank account
          </div>
          <div className="grid gap-x-4 gap-y-1.5 text-[12px]" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div><span className="text-slate-400">Account name</span><div className="font-bold text-[#050A1F]">{bankMode.accountName || '—'}</div></div>
            <div><span className="text-slate-400">Account number</span><div className="font-bold text-[#050A1F] font-mono">{bankMode.accountNumber || '—'}</div></div>
            <div><span className="text-slate-400">Bank</span><div className="font-bold text-[#050A1F]">{bankMode.bankName || '—'}</div></div>
            <div><span className="text-slate-400">IFSC</span><div className="font-bold text-[#050A1F] font-mono">{bankMode.ifsc || '—'}</div></div>
            {bankMode.accountType && <div><span className="text-slate-400">Account type</span><div className="font-bold text-[#050A1F] capitalize">{bankMode.accountType}</div></div>}
          </div>
        </div>
      )}
      {method === 'bank' && !bankMode && <div className="text-[11px] rounded-lg bg-amber-50 border border-amber-200 text-amber-700 px-3 py-2 mb-3">No saved bank account for this vendor — confirm the account details before transferring.</div>}

      {/* Who the cheque should be written to. */}
      {method === 'cheque' && (
        <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3 mb-3">
          <div className="text-[10px] font-extrabold uppercase tracking-wide text-violet-700 mb-1">Cheque to be issued to</div>
          <div className="text-[15px] font-extrabold text-[#050A1F]">{(bankMode && bankMode.accountName) || expense.payeeName || '—'}</div>
          {expense.payeeType === 'vendor' && bankMode && bankMode.accountName && bankMode.accountName !== expense.payeeName && <div className="text-[11px] text-slate-500 mt-0.5">Vendor: {expense.payeeName}</div>}
        </div>
      )}

      <Field label="Payment method" full><div className="grid grid-cols-4 gap-2">{METHODS.map(([id, lbl]) => <button key={id} type="button" onClick={() => setMethod(id)} className={`rounded-lg border px-2 py-2 text-xs font-bold ${method === id ? 'border-orange-400 bg-orange-50 text-[#FF4500]' : 'border-slate-200 text-slate-600'}`}>{lbl}</button>)}</div></Field>
      <div className="grid gap-3 mt-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label="Date of payment"><input type="date" value={f.paymentDate} onChange={(e) => set('paymentDate', e.target.value)} className="inp" /></Field>

        {method === 'bank' && <Field label="Bank name"><select value={f.bankName} onChange={(e) => set('bankName', e.target.value)} className="inp">{BANKS.map(([id, lbl]) => <option key={id} value={id}>{lbl}</option>)}</select></Field>}
        {method === 'bank' && <Field label="Transaction ID" full><input value={f.paymentRef} onChange={(e) => set('paymentRef', e.target.value)} className="inp" placeholder="Enter bank transaction ID" /></Field>}

        {method === 'upi' && <Field label="UPI ID"><input value={f.paymentUpiId} onChange={(e) => set('paymentUpiId', e.target.value)} className="inp" placeholder="name@bank" /></Field>}
        {method === 'upi' && <Field label="Payee mobile (optional)"><input value={f.paymentMobile} onChange={(e) => set('paymentMobile', e.target.value)} className="inp" placeholder="Optional" /></Field>}
        {method === 'upi' && <Field label="UPI transaction / reference ID" full><input value={f.paymentRef} onChange={(e) => set('paymentRef', e.target.value)} className="inp" placeholder="Enter UPI txn / reference ID" /></Field>}

        {method === 'cheque' && <Field label="Cheque number"><input value={f.chequeNumber} onChange={(e) => set('chequeNumber', e.target.value)} className="inp" placeholder="Enter cheque number" /></Field>}
        {method === 'cheque' && <Field label="Bank drawn on"><input value={f.chequeBank} onChange={(e) => set('chequeBank', e.target.value)} className="inp" placeholder="e.g. HDFC Bank" /></Field>}
        {method === 'cheque' && <Field label="Cheque date"><input type="date" value={f.chequeDate} onChange={(e) => set('chequeDate', e.target.value)} className="inp" /></Field>}

        {method === 'cash' && <Field label="Reference (optional)" full><input value={f.paymentRef} onChange={(e) => set('paymentRef', e.target.value)} className="inp" placeholder="Optional" /></Field>}
      </div>
      <div className="flex justify-end gap-2 mt-5"><button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button><button onClick={save} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: '#0F9D58' }}>{busy ? 'Saving…' : 'Confirm payment'}</button></div>
    </ModalShell>
  );
}

// Admin approves an expense and optionally sets the date the vendor should be
// paid by. If set, admins + HR get a reminder 3 days before that date.
function ApproveExpenseModal({ expense, onClose, onConfirm }) {
  const [payDueDate, setPayDueDate] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); await onConfirm(payDueDate); setBusy(false); };
  const minDate = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  return (
    <ModalShell title="Approve expense" onClose={onClose}>
      <div className="rounded-xl bg-slate-50 p-3 mb-4">
        <div className="font-bold text-[#050A1F]">{expense.title}</div>
        <div className="text-[11px] text-slate-500 mt-0.5">{expense.payeeName} · {inr(expense.amount)} · {expense.branch}</div>
      </div>
      <Field label="Payment due date (optional)" full>
        <input type="date" min={minDate} value={payDueDate} onChange={(e) => setPayDueDate(e.target.value)} className="inp" />
      </Field>
      <div className="text-[11px] text-slate-400 mt-1.5">Set when this vendor should be paid by. Admins and HR will get a reminder 3 days before the due date if it isn't paid yet. Leave blank if not needed.</div>
      <div className="flex justify-end gap-2 mt-5"><button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button><button onClick={go} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: '#0F9D58' }}>{busy ? 'Approving…' : 'Approve expense'}</button></div>
    </ModalShell>
  );
}

function RejectModal({ expense, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  return (
    <ModalShell title="Reject expense" onClose={onClose}>
      <div className="text-xs text-slate-500 mb-3">Rejecting “{expense.title}” ({inr(expense.amount)}).</div>
      <Field label="Reason (optional)" full><textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className="inp" placeholder="Shared with the person who raised it." /></Field>
      <div className="flex justify-end gap-2 mt-4"><button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button><button onClick={() => onConfirm(reason)} className="rounded-lg px-5 py-2 text-sm font-bold text-white" style={{ background: '#DC2626' }}>Confirm reject</button></div>
    </ModalShell>
  );
}

function VendorModal({ vendor, cats, onClose, onSaved, setErr }) {
  const editing = vendor && vendor._id;
  const [f, setF] = useState({ name: vendor.name || '', contactPerson: vendor.contactPerson || '', phone: vendor.phone || '', email: vendor.email || '', address: vendor.address || '', city: vendor.city || '', state: vendor.state || '', zip: vendor.zip || '', hasGst: !!vendor.hasGst, gstin: vendor.gstin || '', category: vendor.category || '', branch: vendor.branch || '', recurringPayment: !!vendor.recurringPayment, recurringDay: vendor.recurringDay || '', recurringAmount: vendor.recurringAmount || '', recurringLabel: vendor.recurringLabel || '' });
  const [modes, setModes] = useState(Array.isArray(vendor.paymentModes) ? vendor.paymentModes : []);
  const [busy, setBusy] = useState(false); const [er, setEr] = useState('');
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const save = async () => {
    if (!f.name.trim()) { setEr('Vendor / company name is required.'); return; }
    if (f.hasGst && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(String(f.gstin).toUpperCase())) { setEr('Enter a valid 15-character GSTIN.'); return; }
    if (f.recurringPayment && !(Number(f.recurringDay) >= 1 && Number(f.recurringDay) <= 31)) { setEr('Enter a valid recurring payment day (1–31).'); return; }
    setBusy(true); setEr('');
    try { await hrApi(editing ? `/vendors/${vendor._id}` : '/vendors', { method: editing ? 'PUT' : 'POST', body: JSON.stringify({ ...f, gstin: f.hasGst ? String(f.gstin).toUpperCase() : '', paymentModes: modes, recurringDay: f.recurringDay ? Number(f.recurringDay) : null, recurringAmount: f.recurringAmount ? Number(f.recurringAmount) : null }) }); onSaved(); }
    catch (e) { setEr(e.message); } finally { setBusy(false); }
  };
  return (
    <ModalShell title={editing ? 'Edit vendor' : 'Add vendor'} onClose={onClose} wide>
      {er && <div className="rounded-lg bg-red-50 border border-red-200 text-red-600 text-xs px-3 py-2 mb-3">{er}</div>}
      <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label="Vendor / company name" full><input value={f.name} onChange={(e) => set('name', e.target.value)} className="inp" /></Field>
        <Field label="Contact person"><input value={f.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} className="inp" /></Field>
        <Field label="Phone number"><input value={f.phone} onChange={(e) => set('phone', e.target.value)} className="inp" /></Field>
        <Field label="Email"><input value={f.email} onChange={(e) => set('email', e.target.value)} className="inp" /></Field>
        <Field label="Category"><select value={f.category} onChange={(e) => set('category', e.target.value)} className="inp"><option value="">-</option>{cats.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
        <Field label="Address" full><textarea rows={2} value={f.address} onChange={(e) => set('address', e.target.value)} className="inp" placeholder="Street / building" /></Field>
        <Field label="City"><input value={f.city} onChange={(e) => set('city', e.target.value)} className="inp" /></Field>
        <Field label="State"><input value={f.state} onChange={(e) => set('state', e.target.value)} className="inp" /></Field>
        <Field label="ZIP / PIN"><input value={f.zip} onChange={(e) => set('zip', e.target.value)} className="inp" /></Field>
        <Field label="Branch"><select value={f.branch} onChange={(e) => set('branch', e.target.value)} className="inp"><option value="">-</option>{BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}</select></Field>
        <Field label="GST registered?" full>
          <div className="flex gap-2 items-center">{[['yes', 'Yes'], ['no', 'No']].map(([id, lbl]) => <button key={id} type="button" onClick={() => set('hasGst', id === 'yes')} className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${(f.hasGst ? 'yes' : 'no') === id ? 'border-orange-400 bg-orange-50 text-[#FF4500]' : 'border-slate-200 text-slate-600'}`}>{lbl}</button>)}{f.hasGst && <input value={f.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} maxLength={15} className="inp font-mono" placeholder="15-character GSTIN" style={{ flex: 1 }} />}</div>
        </Field>
      </div>
      <div className="mt-5 pt-4 border-t border-slate-100">
        <PaymentModesEditor modes={modes} setModes={setModes} />
      </div>
      <div className="mt-5 pt-4 border-t border-slate-100">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-sm font-bold text-[#050A1F]">Recurring monthly bill</div>
            <div className="text-[11px] text-slate-400">For rent, electricity, internet, etc. Admins + HR get a reminder 3 days before the due day each month.</div>
          </div>
          <button type="button" onClick={() => set('recurringPayment', !f.recurringPayment)} className={`rounded-full w-11 h-6 transition-colors ${f.recurringPayment ? 'bg-[#0F9D58]' : 'bg-slate-300'}`}><span className={`block w-5 h-5 bg-white rounded-full transition-transform ${f.recurringPayment ? 'translate-x-5' : 'translate-x-0.5'}`} /></button>
        </div>
        {f.recurringPayment && (
          <div className="grid gap-3 mt-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Field label="Pay by day of month"><select value={f.recurringDay} onChange={(e) => set('recurringDay', e.target.value)} className="inp"><option value="">Select day…</option>{Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}{['st', 'nd', 'rd'][((d % 10) - 1)] && ![11, 12, 13].includes(d) ? ['st', 'nd', 'rd'][((d % 10) - 1)] : 'th'}</option>)}</select></Field>
            <Field label="Typical amount (₹, optional)"><input value={f.recurringAmount} onChange={(e) => set('recurringAmount', e.target.value)} className="inp" placeholder="0" /></Field>
            <Field label="Label (optional)" full><input value={f.recurringLabel} onChange={(e) => set('recurringLabel', e.target.value)} className="inp" placeholder="e.g. Office rent, Electricity bill" /></Field>
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 mt-5"><button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button><button onClick={save} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : (editing ? 'Save changes' : 'Add vendor')}</button></div>
    </ModalShell>
  );
}

// Editor for a vendor's saved payment modes. Each mode carries its own fields.
function PaymentModesEditor({ modes, setModes }) {
  const [adding, setAdding] = useState('');
  const upd = (i, k, v) => setModes(modes.map((m, j) => j === i ? { ...m, [k]: v } : m));
  const remove = (i) => setModes(modes.filter((_, j) => j !== i));
  const add = (t) => {
    if (!t) return;
    if ((t === 'cash' || t === 'cheque') && modes.some((m) => m.type === t)) { setAdding(''); return; }
    setModes([...modes, t === 'bank' ? { type: 'bank', accountName: '', accountNumber: '', bankName: '', ifsc: '', accountType: 'Savings' } : t === 'upi' ? { type: 'upi', upiId: '', mobile: '' } : { type: t }]);
    setAdding('');
  };
  const LABEL = { cash: 'Cash', bank: 'Bank Transfer', upi: 'UPI', cheque: 'Cheque' };
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-bold text-slate-500">Payment modes <span className="font-normal text-slate-400">— how this vendor is paid</span></div>
        <select value={adding} onChange={(e) => add(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-600">
          <option value="">+ Add mode…</option>
          {['cash', 'bank', 'upi', 'cheque'].map((t) => <option key={t} value={t}>{LABEL[t]}</option>)}
        </select>
      </div>
      {modes.length === 0 ? <div className="text-xs text-slate-400 rounded-lg border border-dashed border-slate-200 p-3 text-center">No payment modes yet. Add at least one so HR can pay this vendor.</div>
        : <div className="space-y-2">
          {modes.map((m, i) => (
            <div key={i} className="rounded-xl border border-slate-200 p-3 bg-slate-50/50">
              <div className="flex items-center justify-between mb-2"><span className="text-[11px] font-extrabold uppercase tracking-wide text-[#4338CA]">{LABEL[m.type]}</span><button type="button" onClick={() => remove(i)} className="text-red-400 text-lg leading-none">×</button></div>
              {m.type === 'bank' && (
                <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <input value={m.accountName || ''} onChange={(e) => upd(i, 'accountName', e.target.value)} className="inp" placeholder="Account name" />
                  <input value={m.accountNumber || ''} onChange={(e) => upd(i, 'accountNumber', e.target.value)} className="inp" placeholder="Account number" />
                  <input value={m.bankName || ''} onChange={(e) => upd(i, 'bankName', e.target.value)} className="inp" placeholder="Bank name" />
                  <input value={m.ifsc || ''} onChange={(e) => upd(i, 'ifsc', e.target.value.toUpperCase())} maxLength={11} className="inp font-mono" placeholder="IFSC code" />
                  <select value={m.accountType || ''} onChange={(e) => upd(i, 'accountType', e.target.value)} className="inp"><option value="">Account type…</option><option>Savings</option><option>Current</option></select>
                </div>
              )}
              {m.type === 'upi' && (
                <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <input value={m.upiId || ''} onChange={(e) => upd(i, 'upiId', e.target.value)} className="inp" placeholder="UPI ID (name@bank)" />
                  <input value={m.mobile || ''} onChange={(e) => upd(i, 'mobile', e.target.value)} className="inp" placeholder="Mobile number" />
                </div>
              )}
              {(m.type === 'cash' || m.type === 'cheque') && <div className="text-[11px] text-slate-400">No extra details needed.</div>}
            </div>
          ))}
        </div>}
    </div>
  );
}

function CategoryModal({ cats, onClose, onSaved, setErr }) {
  const [list, setList] = useState(cats.slice());
  const [nw, setNw] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { const r = await hrApi('/expense-categories', { method: 'PUT', body: JSON.stringify({ categories: list }) }); onSaved(r.categories || list); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <ModalShell title="Expense categories" onClose={onClose}>
      <div className="text-xs text-slate-500 mb-3">Add or remove categories available when raising an expense.</div>
      <div className="space-y-1.5 max-h-64 overflow-y-auto mb-3">{list.map((c, i) => <div key={i} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-1.5"><span className="flex-1 text-sm text-slate-700">{c}</span><button onClick={() => setList(list.filter((_, j) => j !== i))} className="text-red-400 text-lg leading-none">×</button></div>)}</div>
      <div className="flex gap-2"><input value={nw} onChange={(e) => setNw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && nw.trim()) { setList([...list, nw.trim()]); setNw(''); } }} className="inp" placeholder="New category" /><button onClick={() => { if (nw.trim()) { setList([...list, nw.trim()]); setNw(''); } }} className="rounded-lg border border-slate-300 px-3 text-sm font-bold text-slate-600">Add</button></div>
      <div className="flex justify-end gap-2 mt-5"><button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button><button onClick={save} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : 'Save categories'}</button></div>
    </ModalShell>
  );
}

// Monthly totals across previous months, paginated (opened from the "Total
// this month" box). Fetches a server-computed per-month breakdown.
function MonthlyTotalsModal({ onClose }) {
  const [rows, setRows] = useState(null);
  const [page, setPage] = useState(1); const PER = 6;
  useEffect(() => { hrApi('/expenses/monthly').then((r) => setRows(r.months || [])).catch(() => setRows([])); }, []);
  const pages = rows ? Math.max(1, Math.ceil(rows.length / PER)) : 1;
  const pageRows = rows ? rows.slice((page - 1) * PER, page * PER) : [];
  return (
    <ModalShell title="Monthly expense totals" onClose={onClose}>
      {rows === null ? <div className="text-sm text-slate-400 py-6 text-center">Loading…</div>
        : rows.length === 0 ? <div className="text-sm text-slate-400 py-6 text-center">No expenses recorded yet.</div>
          : <>
            <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="bg-slate-50/80 text-[10px] uppercase tracking-wider text-slate-400 font-bold border-b border-slate-100"><th className="text-left px-4 py-2.5">Month</th><th className="text-right px-4 py-2.5">Expenses</th><th className="text-right px-4 py-2.5">Paid</th><th className="text-right px-4 py-2.5">Total</th></tr></thead>
                <tbody>
                  {pageRows.map((m) => (
                    <tr key={m.month} className="border-t border-slate-50">
                      <td className="px-4 py-2.5 font-bold text-[#050A1F]">{m.label}</td>
                      <td className="px-4 py-2.5 text-right text-slate-500">{m.count}</td>
                      <td className="px-4 py-2.5 text-right text-green-600 font-bold">{inr(m.paid)}</td>
                      <td className="px-4 py-2.5 text-right font-extrabold text-[#050A1F]">{inr(m.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-4">
                <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 disabled:opacity-40">← Prev</button>
                <span className="text-xs font-bold text-slate-500">Page {page} of {pages}</span>
                <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 disabled:opacity-40">Next →</button>
              </div>
            )}
          </>}
    </ModalShell>
  );
}

function ExpenseDrawer({ expense: e, onClose }) {
  const Row = ({ label, children }) => <div className="flex gap-3 py-2.5 border-b border-slate-50 last:border-0"><div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 w-32 shrink-0 pt-0.5">{label}</div><div className="text-sm text-slate-700 flex-1 min-w-0">{children}</div></div>;
  return (
    <DrawerShell onClose={onClose} title={e.title} subtitle={`${e.category || ''} · ${e.branch || ''}`}>
      <div className="flex items-center gap-2 mb-3"><StatusBadge s={e.status} /><span className="text-lg font-extrabold text-[#050A1F] ml-auto">{inr(e.amount)}</span></div>
      <Row label="Payee"><span className="inline-flex items-center gap-2"><PayeeIcon type={e.payeeType} name={e.payeeName} />{e.payeeName} <span className="text-[10px] text-slate-400 uppercase">({e.payeeType})</span></span></Row>
      {e.payeeType === 'employee' && e.employeePayType && <Row label="Payment type">{empPayTypeLabel(e.employeePayType)}</Row>}
      {e.isClaim && <>
        <Row label="Claim">Employee reimbursement</Row>
        <Row label="Claimed">{inr(e.claimedAmount)}</Row>
        {e.approvedAmount != null && <Row label="Reimbursable">{inr(e.approvedAmount)}{Number(e.approvedAmount) < Number(e.claimedAmount) ? <span className="text-[10px] text-amber-600 font-bold ml-1">(reduced)</span> : null}</Row>}
        {e.hrReviewNotes && <Row label="HR notes">{e.hrReviewNotes}</Row>}
        {e.hrReviewedByName && <Row label="HR reviewed by">{titleCase(e.hrReviewedByName)}{e.hrReviewedAt ? ` · ${fmtWhen(e.hrReviewedAt)}` : ''}</Row>}
        {e.settlementMethod && <Row label="Settlement">{({ cheque: 'Cheque', cash: 'Cash', salary: 'Added to salary' })[e.settlementMethod] || e.settlementMethod}</Row>}
      </>}
      <Row label="Expense date">{fmtDate(e.expenseDate)}</Row>
      {e.selectedPaymentMode && <Row label="Chosen mode">{modeSummary(e.selectedPaymentMode)}</Row>}
      <Row label="Description">{e.description || '—'}</Row>
      <Row label="Invoice">{e.invoiceUrl ? <a href={e.invoiceUrl} target="_blank" rel="noreferrer" className="text-sky-600 font-bold">📎 {e.invoiceName || 'View invoice'}</a> : '—'}</Row>
      <Row label="Raised by">{titleCase(e.raisedByName || '—')}</Row>
      {e.status === 'rejected' ? <><Row label="Rejected by">{titleCase(e.approvedByName || '—')}{e.approvedAt ? ` · ${fmtWhen(e.approvedAt)}` : ''}</Row><Row label="Reason">{e.rejectionReason || '—'}</Row></> : <Row label="Approved by">{e.approvedByName ? `${titleCase(e.approvedByName)}${e.approvedAt ? ` · ${fmtWhen(e.approvedAt)}` : ''}` : '—'}</Row>}
      {e.status === 'approved' && e.payDueDate && <Row label="Payment due">{fmtDate(e.payDueDate)} <span className="text-[10px] text-amber-600 font-bold">· reminder 3 days prior</span></Row>}
      {e.status === 'paid' && <><Row label="Payment method">{methodLabel(e.paymentMethod)}{e.bankName ? ` · ${bankLabel(e.bankName)}` : ''}</Row>
        {e.paymentMethod === 'upi' && <><Row label="UPI ID">{e.paymentUpiId || '—'}</Row>{e.paymentMobile ? <Row label="Payee mobile">{e.paymentMobile}</Row> : null}<Row label="UPI txn / ref ID">{e.paymentRef || '—'}</Row></>}
        {e.paymentMethod === 'cheque' && <><Row label="Cheque number">{e.chequeNumber || e.paymentRef || '—'}</Row>{e.chequeBank ? <Row label="Bank drawn on">{e.chequeBank}</Row> : null}{e.chequeDate ? <Row label="Cheque date">{fmtDate(e.chequeDate)}</Row> : null}</>}
        {(e.paymentMethod === 'bank' || e.paymentMethod === 'cash') && <Row label={e.paymentMethod === 'bank' ? 'Transaction ID' : 'Reference'}>{e.paymentRef || '—'}</Row>}
        <Row label="Date of payment">{fmtDate(e.paymentDate)}</Row><Row label="Paid by">{titleCase(e.paidByName || '—')}</Row></>}
    </DrawerShell>
  );
}

function VendorHistoryDrawer({ vendor, onClose }) {
  const [rows, setRows] = useState(null);
  const [pick, setPick] = useState(null);
  useEffect(() => { hrApi(`/vendors/${vendor._id}/history`).then((r) => setRows(r.expenses || [])).catch(() => setRows([])); }, [vendor._id]);
  const paid = (rows || []).filter((r) => r.status === 'paid');
  const totalPaid = paid.reduce((s, r) => s + Number(r.amount || 0), 0);
  return (
    <DrawerShell onClose={onClose} title={vendor.name} subtitle={`${vendor.city || ''}${vendor.state ? ', ' + vendor.state : ''}`} wide>
      {pick ? (
        <div><button onClick={() => setPick(null)} className="text-xs font-bold text-slate-400 mb-3">← Back to history</button><ExpenseDetailInline e={pick} /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 mb-4"><div className="rounded-xl bg-slate-50 p-3"><div className="text-lg font-extrabold text-[#050A1F]">{paid.length}</div><div className="text-[10px] font-bold uppercase text-slate-400">Payments made</div></div><div className="rounded-xl bg-green-50 p-3"><div className="text-lg font-extrabold text-green-700">{inr(totalPaid)}</div><div className="text-[10px] font-bold uppercase text-slate-400">Total paid</div></div></div>
          {vendor.gstin && <div className="text-[11px] text-slate-400 mb-3">GSTIN <span className="font-mono text-slate-600">{vendor.gstin}</span></div>}
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Payment history</div>
          {rows === null ? <div className="text-sm text-slate-400 py-4">Loading…</div> : rows.length === 0 ? <div className="text-sm text-slate-400 py-4">No expenses recorded for this vendor yet.</div> : <div className="space-y-2">{rows.map((r) => (
            <button key={r._id} onClick={() => setPick(r)} className="w-full text-left bg-white border border-slate-200 rounded-xl p-3 hover:border-orange-300"><div className="flex items-center justify-between"><span className="font-bold text-[#050A1F] text-sm">{r.title}</span><span className="font-extrabold text-[#050A1F]">{inr(r.amount)}</span></div><div className="flex items-center gap-2 mt-1"><StatusBadge s={r.status} /><span className="text-[11px] text-slate-400">{r.status === 'paid' ? `${methodLabel(r.paymentMethod)} · ${fmtDate(r.paymentDate)}` : fmtDate(r.expenseDate)}</span></div></button>
          ))}</div>}
        </>
      )}
    </DrawerShell>
  );
}

function ExpenseDetailInline({ e }) {
  const Row = ({ label, children }) => <div className="flex gap-3 py-2 border-b border-slate-50 last:border-0"><div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 w-28 shrink-0 pt-0.5">{label}</div><div className="text-sm text-slate-700 flex-1">{children}</div></div>;
  return (
    <div>
      <div className="flex items-center gap-2 mb-3"><StatusBadge s={e.status} /><span className="text-lg font-extrabold text-[#050A1F] ml-auto">{inr(e.amount)}</span></div>
      <Row label="Title">{e.title}</Row><Row label="Category">{e.category || '—'}</Row><Row label="Branch">{e.branch || '—'}</Row>
      <Row label="Expense date">{fmtDate(e.expenseDate)}</Row><Row label="Description">{e.description || '—'}</Row>
      <Row label="Invoice">{e.invoiceUrl ? <a href={e.invoiceUrl} target="_blank" rel="noreferrer" className="text-sky-600 font-bold">📎 {e.invoiceName || 'View'}</a> : '—'}</Row>
      <Row label="Approved by">{e.approvedByName ? titleCase(e.approvedByName) : '—'}</Row>
      {e.status === 'paid' && <><Row label="Method">{methodLabel(e.paymentMethod)}{e.bankName ? ` · ${bankLabel(e.bankName)}` : ''}</Row>
        {e.paymentMethod === 'upi' && <><Row label="UPI ID">{e.paymentUpiId || '—'}</Row>{e.paymentMobile ? <Row label="Payee mobile">{e.paymentMobile}</Row> : null}<Row label="UPI txn / ref ID">{e.paymentRef || '—'}</Row></>}
        {e.paymentMethod === 'cheque' && <><Row label="Cheque number">{e.chequeNumber || e.paymentRef || '—'}</Row>{e.chequeBank ? <Row label="Bank drawn on">{e.chequeBank}</Row> : null}{e.chequeDate ? <Row label="Cheque date">{fmtDate(e.chequeDate)}</Row> : null}</>}
        {(e.paymentMethod === 'bank' || e.paymentMethod === 'cash') && <Row label={e.paymentMethod === 'bank' ? 'Transaction ID' : 'Reference'}>{e.paymentRef || '—'}</Row>}
        <Row label="Paid on">{fmtDate(e.paymentDate)}</Row><Row label="Paid by">{titleCase(e.paidByName || '—')}</Row></>}
    </div>
  );
}

function ModalShell({ title, onClose, wide, children }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[140] p-4" onClick={onClose}>
      <div className={`bg-white rounded-2xl w-full ${wide ? 'max-w-2xl' : 'max-w-md'} shadow-2xl max-h-[90vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10"><div className="text-lg font-extrabold text-[#050A1F]">{title}</div><button onClick={onClose} className="text-slate-400 text-2xl leading-none">×</button></div>
        <div className="p-6"><style>{`.inp{width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px;font-size:14px;outline:none}.inp:focus{box-shadow:0 0 0 2px #fdba74}`}</style>{children}</div>
      </div>
    </div>
  );
}
function DrawerShell({ title, subtitle, onClose, wide, children }) {
  return (
    <div className="fixed inset-0 z-[130] flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className={`relative bg-white w-full ${wide ? 'max-w-lg' : 'max-w-md'} h-full shadow-2xl overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10"><div><div className="font-extrabold text-[#050A1F]">{title}</div>{subtitle && <div className="text-[11px] text-slate-400">{subtitle}</div>}</div><button onClick={onClose} className="text-slate-400 text-2xl leading-none">×</button></div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
function Field({ label, full, children }) {
  return <div style={full ? { gridColumn: '1 / -1' } : undefined}><div className="text-xs font-bold text-slate-500 mb-1.5">{label}</div>{children}</div>;
}

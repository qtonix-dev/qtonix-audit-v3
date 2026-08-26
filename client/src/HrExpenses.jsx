import React, { useState, useEffect, useMemo } from 'react';
import { hrApi } from './HrApp.jsx';
import { titleCase, Avatar, uploadToImageKit } from './HrParts.jsx';

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
const inr = (n) => `\u20B9${Number(n || 0).toLocaleString('en-IN')}`;
const fmtDate = (d) => { if (!d) return '\u2014'; try { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return d; } };
const fmtWhen = (iso) => { if (!iso) return '\u2014'; try { return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const methodLabel = (m) => (METHODS.find((x) => x[0] === m) || [null, ''])[1];
const bankLabel = (b) => (BANKS.find((x) => x[0] === b) || [null, ''])[1];

function StatusBadge({ s }) { const m = STATUS_META[s] || STATUS_META.submitted; return <span className="text-[10px] font-extrabold rounded px-1.5 py-0.5" style={{ background: m.bg, color: m.color }}>{m.label}</span>; }
function BranchBadge({ b }) { return <span className="text-[10px] font-extrabold rounded px-1.5 py-0.5" style={{ background: '#EEF2FF', color: '#4338CA' }}>{b || '\u2014'}</span>; }
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

  const load = () => {
    Promise.all([
      hrApi('/expenses').then((r) => setData(r)).catch((e) => setErr(e.message)),
      hrApi('/vendors').then((r) => setVendors(r.vendors || [])).catch(() => {}),
      hrApi('/expense-categories').then((r) => setCats(r.categories || [])).catch(() => {}),
      hrApi('/employees').then((r) => setEmployees(Array.isArray(r) ? r : (r.employees || []))).catch(() => {}),
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

  const decide = async (e, decision, reason) => {
    try { await hrApi(`/expenses/${e._id}/decide`, { method: 'POST', body: JSON.stringify({ decision, reason: reason || '' }) }); setRejectFor(null); load(); }
    catch (er) { setErr(er.message); }
  };

  const rollup = useMemo(() => {
    const monthRows = expenses.filter((e) => (e.expenseDate || '').slice(0, 7) === monthF);
    const byCat = {}; const byBranch = {}; let total = 0;
    monthRows.forEach((e) => {
      total += Number(e.amount || 0);
      byCat[e.category || 'Uncategorised'] = (byCat[e.category || 'Uncategorised'] || 0) + Number(e.amount || 0);
      byBranch[e.branch || '\u2014'] = (byBranch[e.branch || '\u2014'] || 0) + Number(e.amount || 0);
    });
    return { total, byCat: Object.entries(byCat).sort((a, b) => b[1] - a[1]), byBranch: Object.entries(byBranch).sort((a, b) => b[1] - a[1]), count: monthRows.length };
  }, [expenses, monthF]);

  const exportCsv = () => {
    const rows = [['Date', 'Title', 'Category', 'Branch', 'Payee', 'Payee type', 'Amount (INR)', 'Status', 'Method', 'Bank', 'Reference', 'Payment date', 'Approved by', 'Paid by']];
    filtered.forEach((e) => rows.push([e.expenseDate, e.title, e.category, e.branch, e.payeeName, e.payeeType, e.amount, STATUS_META[e.status].label, methodLabel(e.paymentMethod), bankLabel(e.bankName), e.paymentRef || '', e.paymentDate || '', e.approvedByName || '', e.paidByName || '']));
    const csv = rows.map((r) => r.map((c) => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `expenses-${monthF}.csv`; a.click();
  };

  if (loading && !didLoad) return <div className="text-center text-slate-400 py-20 text-sm">Loading expenses\u2026</div>;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-end justify-between mb-4 flex-wrap gap-3">
        <div><h1 className="text-2xl font-extrabold text-[#050A1F]">Expenses</h1><p className="text-sm text-slate-400">Raise expenses, get admin approval, then record payment to the vendor or employee.</p></div>
        <div className="flex gap-2"><button onClick={exportCsv} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">\u2B07 Export CSV</button><button onClick={() => setRaiseOpen(true)} className="rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ background: ORANGE }}>+ New expense</button></div>
      </div>
      {err && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm px-3 py-2 flex justify-between"><span>{err}</span><button onClick={() => setErr('')}>\u00D7</button></div>}

      <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
        {[
          { label: 'Pending approval', value: counts.pending, color: '#F59E0B', bg: '#FFFBEB' },
          { label: 'Approved \u00B7 to pay', value: counts.approved, color: '#0EA5E9', bg: '#F0F9FF' },
          { label: 'Paid this month', value: inr(data && data.paidThisMonth), color: '#0F9D58', bg: '#F0FDF4' },
          { label: 'Total this month', value: inr(data && data.totalThisMonth), color: '#8B5CF6', bg: '#F5F3FF' },
        ].map((c) => (
          <div key={c.label} className="rounded-2xl border border-slate-100 p-4 shadow-sm" style={{ background: c.bg }}>
            <div className="text-2xl font-extrabold" style={{ color: c.color }}>{c.value}</div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-1.5 mb-4 bg-slate-100 p-1 rounded-xl w-fit items-center">
        {[['expenses', `Expenses \u00B7 ${expenses.length}`], ['vendors', `Vendors \u00B7 ${vendors.length}`], ['rollup', 'Monthly rollup']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`px-3.5 py-1.5 rounded-lg text-[12px] font-extrabold ${tab === id ? 'bg-white text-[#050A1F] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{label}</button>
        ))}
        {tab === 'expenses' && <button onClick={() => setCatOpen(true)} className="px-3 py-1.5 rounded-lg text-[12px] font-bold text-slate-400 hover:text-slate-600">\u2699 Categories</button>}
      </div>

      {tab === 'expenses' && (<>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, payee\u2026" className="rounded-lg border border-slate-300 px-3 py-2 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-orange-300" />
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
                    <td className="px-4 py-3"><div className="font-bold text-[#050A1F]">{e.title}</div><div className="text-[11px] text-slate-400">{e.category || '\u2014'}</div></td>
                    <td className="px-4 py-3"><BranchBadge b={e.branch} /></td>
                    <td className="px-4 py-3"><div className="flex items-center gap-2"><PayeeIcon type={e.payeeType} name={e.payeeName} /><span className="text-slate-600 text-xs">{e.payeeName || '\u2014'}</span></div></td>
                    <td className="px-4 py-3 text-right font-extrabold text-[#050A1F] whitespace-nowrap">{inr(e.amount)}</td>
                    <td className="px-4 py-3">{e.invoiceUrl ? <a href={e.invoiceUrl} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()} className="text-[11px] font-bold text-sky-600">\uD83D\uDCCE {e.invoiceName || 'view'}</a> : <span className="text-[11px] text-slate-300">\u2014</span>}</td>
                    <td className="px-4 py-3"><StatusBadge s={e.status} />{e.status === 'paid' && e.paymentMethod && <span className="text-[10px] text-slate-400 ml-1">{methodLabel(e.paymentMethod)}</span>}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap" onClick={(ev) => ev.stopPropagation()}>
                      {e.status === 'submitted' && isAdmin && <span className="inline-flex gap-1"><button onClick={() => decide(e, 'approve')} className="text-[11px] font-bold text-white px-2.5 py-1 rounded" style={{ background: '#0F9D58' }}>Approve</button><button onClick={() => setRejectFor(e)} className="text-[11px] font-bold text-red-500 border border-red-200 px-2.5 py-1 rounded">Reject</button></span>}
                      {e.status === 'submitted' && !isAdmin && <span className="text-[11px] text-slate-400">Awaiting admin</span>}
                      {e.status === 'approved' && <button onClick={() => setPayFor(e)} className="text-[11px] font-bold text-white px-2.5 py-1 rounded" style={{ background: '#050A1F' }}>Mark paid</button>}
                      {e.status === 'paid' && <span className="text-[11px] text-slate-300">Done</span>}
                      {e.status === 'rejected' && <span className="text-[11px] text-slate-300">\u2014</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-4">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 disabled:opacity-40">\u2190 Prev</button>
            <span className="text-xs font-bold text-slate-500">Page {page} of {pages}</span>
            <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 disabled:opacity-40">Next \u2192</button>
          </div>
        )}
      </>)}

      {tab === 'vendors' && <VendorsTab vendors={vendors} onAdd={() => setVendorEdit({})} onEdit={(v) => setVendorEdit(v)} onHistory={(v) => setVendorHistory(v)} reload={load} setErr={setErr} />}

      {tab === 'rollup' && (
        <div>
          <div className="flex items-center gap-2 mb-4"><span className="text-sm font-bold text-slate-500">Month</span><input type="month" value={monthF} onChange={(e) => setMonthF(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-2 text-sm" /></div>
          <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
              <div className="text-sm font-bold text-[#050A1F] mb-1">By category</div>
              <div className="text-[11px] text-slate-400 mb-3">{rollup.count} expenses \u00B7 {inr(rollup.total)} total</div>
              {rollup.byCat.length === 0 ? <div className="text-sm text-slate-400 py-4">No expenses this month.</div> : rollup.byCat.map(([c, amt]) => { const pct = rollup.total > 0 ? Math.round((amt / rollup.total) * 100) : 0; return <div key={c} className="mb-2.5"><div className="flex justify-between text-xs mb-1"><span className="font-semibold text-slate-600">{c}</span><span className="font-bold text-[#050A1F]">{inr(amt)} <span className="text-slate-400 font-normal">\u00B7 {pct}%</span></span></div><div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: ORANGE }} /></div></div>; })}
            </div>
            <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
              <div className="text-sm font-bold text-[#050A1F] mb-3">By branch</div>
              {rollup.byBranch.length === 0 ? <div className="text-sm text-slate-400 py-4">No expenses this month.</div> : rollup.byBranch.map(([b, amt]) => { const pct = rollup.total > 0 ? Math.round((amt / rollup.total) * 100) : 0; return <div key={b} className="mb-2.5"><div className="flex justify-between text-xs mb-1"><span className="font-semibold text-slate-600">{b}</span><span className="font-bold text-[#050A1F]">{inr(amt)} <span className="text-slate-400 font-normal">\u00B7 {pct}%</span></span></div><div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: '#4338CA' }} /></div></div>; })}
            </div>
          </div>
        </div>
      )}

      {raiseOpen && <RaiseExpenseModal user={user} isAdmin={isAdmin} cats={cats} vendors={vendors.filter((v) => v.active)} employees={employees} onClose={() => setRaiseOpen(false)} onSaved={() => { setRaiseOpen(false); load(); }} onAddVendor={() => setVendorEdit({})} />}
      {payFor && <PayModal expense={payFor} onClose={() => setPayFor(null)} onSaved={() => { setPayFor(null); load(); }} />}
      {rejectFor && <RejectModal expense={rejectFor} onClose={() => setRejectFor(null)} onConfirm={(reason) => decide(rejectFor, 'reject', reason)} />}
      {detail && <ExpenseDrawer expense={detail} onClose={() => setDetail(null)} />}
      {vendorEdit && <VendorModal vendor={vendorEdit} cats={cats} onClose={() => setVendorEdit(null)} onSaved={() => { setVendorEdit(null); load(); }} setErr={setErr} />}
      {vendorHistory && <VendorHistoryDrawer vendor={vendorHistory} onClose={() => setVendorHistory(null)} />}
      {catOpen && <CategoryModal cats={cats} onClose={() => setCatOpen(false)} onSaved={(list) => { setCats(list); setCatOpen(false); }} setErr={setErr} />}
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
                  <td className="px-4 py-3"><div className="flex items-center gap-2"><PayeeIcon type="vendor" name={v.name} /><div><div className="font-bold text-[#050A1F]">{v.name}{!v.active && <span className="text-[10px] text-slate-400 ml-1">(inactive)</span>}</div>{v.city && <div className="text-[11px] text-slate-400">{v.city}{v.state ? `, ${v.state}` : ''}</div>}</div></div></td>
                  <td className="px-4 py-3 text-xs text-slate-500">{v.contactPerson || '\u2014'}{v.phone && <div className="text-slate-400">{v.phone}</div>}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{v.category || '\u2014'}</td>
                  <td className="px-4 py-3 text-xs">{v.hasGst ? <span className="font-mono text-[11px] text-slate-600">{v.gstin}</span> : <span className="text-slate-300">No</span>}</td>
                  <td className="px-4 py-3 text-xs">{v.branch ? <BranchBadge b={v.branch} /> : <span className="text-slate-300">\u2014</span>}</td>
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
  const [f, setF] = useState({ title: '', category: cats[0] || '', amount: '', expenseDate: new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10), branch: lockedBranch || 'Bhubaneswar', payeeType: 'vendor', vendorId: '', employeeId: '', description: '' });
  const [invoice, setInvoice] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const pickInvoice = async (e) => {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    setUploading(true); setErr('');
    try { const safe = (f.title || 'expense').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30); const { url } = await uploadToImageKit(file, `/qtonix-hr/expenses/${safe}-${Date.now()}`, file.name); setInvoice({ url, name: file.name }); }
    catch (er) { setErr('Invoice upload failed. ' + (er.message || '')); }
    finally { setUploading(false); }
  };
  const save = async () => {
    if (!f.title.trim()) { setErr('Title is required.'); return; }
    if (!(Number(f.amount) > 0)) { setErr('Enter a valid amount.'); return; }
    if (f.payeeType === 'vendor' && !f.vendorId) { setErr('Select a vendor.'); return; }
    if (f.payeeType === 'employee' && !f.employeeId) { setErr('Select an employee.'); return; }
    setBusy(true); setErr('');
    try { await hrApi('/expenses', { method: 'POST', body: JSON.stringify({ ...f, amount: Number(f.amount), vendorId: f.vendorId || null, employeeId: f.employeeId || null, invoiceUrl: invoice ? invoice.url : '', invoiceName: invoice ? invoice.name : '' }) }); onSaved(); }
    catch (er) { setErr(er.message); } finally { setBusy(false); }
  };
  return (
    <ModalShell title="New expense" onClose={onClose} wide>
      {err && <div className="rounded-lg bg-red-50 border border-red-200 text-red-600 text-xs px-3 py-2 mb-3">{err}</div>}
      <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label="Title" full><input value={f.title} onChange={(e) => set('title', e.target.value)} className="inp" placeholder="e.g. Office WiFi \u2014 August" /></Field>
        <Field label="Category"><select value={f.category} onChange={(e) => set('category', e.target.value)} className="inp">{cats.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
        <Field label="Amount (\u20B9)"><input type="number" value={f.amount} onChange={(e) => set('amount', e.target.value)} className="inp" placeholder="0" /></Field>
        <Field label="Expense date"><input type="date" value={f.expenseDate} onChange={(e) => set('expenseDate', e.target.value)} className="inp" /></Field>
        <Field label="Branch">{lockedBranch ? <input value={lockedBranch} disabled className="inp" style={{ background: '#f8fafc', color: '#64748b' }} /> : <select value={f.branch} onChange={(e) => set('branch', e.target.value)} className="inp">{BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}</select>}</Field>
        <Field label="Pay to" full>
          <div className="flex gap-2 mb-2">{[['vendor', 'Vendor'], ['employee', 'Employee']].map(([id, lbl]) => <button key={id} type="button" onClick={() => set('payeeType', id)} className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${f.payeeType === id ? 'border-orange-400 bg-orange-50 text-[#FF4500]' : 'border-slate-200 text-slate-600'}`}>{lbl}</button>)}</div>
          {f.payeeType === 'vendor' ? (
            <div className="flex gap-2"><select value={f.vendorId} onChange={(e) => set('vendorId', e.target.value)} className="inp"><option value="">Select vendor\u2026</option>{vendors.map((v) => <option key={v._id} value={v._id}>{v.name}</option>)}</select><button type="button" onClick={onAddVendor} className="rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-600 whitespace-nowrap">+ New</button></div>
          ) : (
            <select value={f.employeeId} onChange={(e) => set('employeeId', e.target.value)} className="inp"><option value="">Select employee\u2026</option>{employees.map((em) => <option key={em._id || em.id} value={em._id || em.id}>{titleCase(em.name)}</option>)}</select>
          )}
        </Field>
        <Field label="Description" full><textarea rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} className="inp" placeholder="Optional notes" /></Field>
        <Field label="Invoice" full>
          <div className="flex items-center gap-2"><label className={`inline-block rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold cursor-pointer hover:bg-slate-50 ${uploading ? 'opacity-50' : ''}`}>{uploading ? 'Uploading\u2026' : (invoice ? 'Replace file' : '\uD83D\uDCCE Upload invoice')}<input type="file" accept="image/*,application/pdf" className="hidden" onChange={pickInvoice} disabled={uploading} /></label>{invoice && <span className="text-xs text-green-600 font-bold">\u2713 {invoice.name}</span>}</div>
        </Field>
      </div>
      <div className="flex justify-end gap-2 mt-5"><button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button><button onClick={save} disabled={busy || uploading} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Submitting\u2026' : 'Submit for approval'}</button></div>
    </ModalShell>
  );
}

function PayModal({ expense, onClose, onSaved }) {
  const [method, setMethod] = useState('cash');
  const [f, setF] = useState({ paymentDate: new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10), paymentRef: '', bankName: 'kotak' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const save = async () => {
    if (method === 'bank' && !f.paymentRef.trim()) { setErr('Transaction ID is required for a bank transfer.'); return; }
    setBusy(true); setErr('');
    try { await hrApi(`/expenses/${expense._id}/pay`, { method: 'POST', body: JSON.stringify({ paymentMethod: method, ...f }) }); onSaved(); }
    catch (er) { setErr(er.message); } finally { setBusy(false); }
  };
  return (
    <ModalShell title={`Record payment \u00B7 ${inr(expense.amount)}`} onClose={onClose}>
      {err && <div className="rounded-lg bg-red-50 border border-red-200 text-red-600 text-xs px-3 py-2 mb-3">{err}</div>}
      <div className="text-xs text-slate-500 mb-3">Paying <b>{expense.payeeName}</b> for \u201C{expense.title}\u201D.</div>
      <Field label="Payment method" full><div className="grid grid-cols-4 gap-2">{METHODS.map(([id, lbl]) => <button key={id} type="button" onClick={() => setMethod(id)} className={`rounded-lg border px-2 py-2 text-xs font-bold ${method === id ? 'border-orange-400 bg-orange-50 text-[#FF4500]' : 'border-slate-200 text-slate-600'}`}>{lbl}</button>)}</div></Field>
      <div className="grid gap-3 mt-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Field label="Date of payment"><input type="date" value={f.paymentDate} onChange={(e) => set('paymentDate', e.target.value)} className="inp" /></Field>
        {method === 'bank' && <Field label="Bank name"><select value={f.bankName} onChange={(e) => set('bankName', e.target.value)} className="inp">{BANKS.map(([id, lbl]) => <option key={id} value={id}>{lbl}</option>)}</select></Field>}
        <Field label={method === 'bank' ? 'Transaction ID' : method === 'upi' ? 'UPI reference' : method === 'cheque' ? 'Cheque number' : 'Reference (optional)'} full={method !== 'bank'}><input value={f.paymentRef} onChange={(e) => set('paymentRef', e.target.value)} className="inp" placeholder={method === 'cash' ? 'Optional' : 'Enter reference'} /></Field>
      </div>
      <div className="flex justify-end gap-2 mt-5"><button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button><button onClick={save} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: '#0F9D58' }}>{busy ? 'Saving\u2026' : 'Confirm payment'}</button></div>
    </ModalShell>
  );
}

function RejectModal({ expense, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  return (
    <ModalShell title="Reject expense" onClose={onClose}>
      <div className="text-xs text-slate-500 mb-3">Rejecting \u201C{expense.title}\u201D ({inr(expense.amount)}).</div>
      <Field label="Reason (optional)" full><textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className="inp" placeholder="Shared with the person who raised it." /></Field>
      <div className="flex justify-end gap-2 mt-4"><button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button><button onClick={() => onConfirm(reason)} className="rounded-lg px-5 py-2 text-sm font-bold text-white" style={{ background: '#DC2626' }}>Confirm reject</button></div>
    </ModalShell>
  );
}

function VendorModal({ vendor, cats, onClose, onSaved, setErr }) {
  const editing = vendor && vendor._id;
  const [f, setF] = useState({ name: vendor.name || '', contactPerson: vendor.contactPerson || '', phone: vendor.phone || '', email: vendor.email || '', address: vendor.address || '', city: vendor.city || '', state: vendor.state || '', zip: vendor.zip || '', hasGst: !!vendor.hasGst, gstin: vendor.gstin || '', category: vendor.category || '', branch: vendor.branch || '' });
  const [busy, setBusy] = useState(false); const [er, setEr] = useState('');
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const save = async () => {
    if (!f.name.trim()) { setEr('Vendor / company name is required.'); return; }
    if (f.hasGst && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(String(f.gstin).toUpperCase())) { setEr('Enter a valid 15-character GSTIN.'); return; }
    setBusy(true); setEr('');
    try { await hrApi(editing ? `/vendors/${vendor._id}` : '/vendors', { method: editing ? 'PUT' : 'POST', body: JSON.stringify({ ...f, gstin: f.hasGst ? String(f.gstin).toUpperCase() : '' }) }); onSaved(); }
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
        <Field label="Category"><select value={f.category} onChange={(e) => set('category', e.target.value)} className="inp"><option value="">\u2014</option>{cats.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
        <Field label="Address" full><textarea rows={2} value={f.address} onChange={(e) => set('address', e.target.value)} className="inp" placeholder="Street / building" /></Field>
        <Field label="City"><input value={f.city} onChange={(e) => set('city', e.target.value)} className="inp" /></Field>
        <Field label="State"><input value={f.state} onChange={(e) => set('state', e.target.value)} className="inp" /></Field>
        <Field label="ZIP / PIN"><input value={f.zip} onChange={(e) => set('zip', e.target.value)} className="inp" /></Field>
        <Field label="Branch"><select value={f.branch} onChange={(e) => set('branch', e.target.value)} className="inp"><option value="">\u2014</option>{BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}</select></Field>
        <Field label="GST registered?" full>
          <div className="flex gap-2 items-center">{[['yes', 'Yes'], ['no', 'No']].map(([id, lbl]) => <button key={id} type="button" onClick={() => set('hasGst', id === 'yes')} className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${(f.hasGst ? 'yes' : 'no') === id ? 'border-orange-400 bg-orange-50 text-[#FF4500]' : 'border-slate-200 text-slate-600'}`}>{lbl}</button>)}{f.hasGst && <input value={f.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} maxLength={15} className="inp font-mono" placeholder="15-character GSTIN" style={{ flex: 1 }} />}</div>
        </Field>
      </div>
      <div className="flex justify-end gap-2 mt-5"><button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button><button onClick={save} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving\u2026' : (editing ? 'Save changes' : 'Add vendor')}</button></div>
    </ModalShell>
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
      <div className="space-y-1.5 max-h-64 overflow-y-auto mb-3">{list.map((c, i) => <div key={i} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-1.5"><span className="flex-1 text-sm text-slate-700">{c}</span><button onClick={() => setList(list.filter((_, j) => j !== i))} className="text-red-400 text-lg leading-none">\u00D7</button></div>)}</div>
      <div className="flex gap-2"><input value={nw} onChange={(e) => setNw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && nw.trim()) { setList([...list, nw.trim()]); setNw(''); } }} className="inp" placeholder="New category" /><button onClick={() => { if (nw.trim()) { setList([...list, nw.trim()]); setNw(''); } }} className="rounded-lg border border-slate-300 px-3 text-sm font-bold text-slate-600">Add</button></div>
      <div className="flex justify-end gap-2 mt-5"><button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button><button onClick={save} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving\u2026' : 'Save categories'}</button></div>
    </ModalShell>
  );
}

function ExpenseDrawer({ expense: e, onClose }) {
  const Row = ({ label, children }) => <div className="flex gap-3 py-2.5 border-b border-slate-50 last:border-0"><div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 w-32 shrink-0 pt-0.5">{label}</div><div className="text-sm text-slate-700 flex-1 min-w-0">{children}</div></div>;
  return (
    <DrawerShell onClose={onClose} title={e.title} subtitle={`${e.category || ''} \u00B7 ${e.branch || ''}`}>
      <div className="flex items-center gap-2 mb-3"><StatusBadge s={e.status} /><span className="text-lg font-extrabold text-[#050A1F] ml-auto">{inr(e.amount)}</span></div>
      <Row label="Payee"><span className="inline-flex items-center gap-2"><PayeeIcon type={e.payeeType} name={e.payeeName} />{e.payeeName} <span className="text-[10px] text-slate-400 uppercase">({e.payeeType})</span></span></Row>
      <Row label="Expense date">{fmtDate(e.expenseDate)}</Row>
      <Row label="Description">{e.description || '\u2014'}</Row>
      <Row label="Invoice">{e.invoiceUrl ? <a href={e.invoiceUrl} target="_blank" rel="noreferrer" className="text-sky-600 font-bold">\uD83D\uDCCE {e.invoiceName || 'View invoice'}</a> : '\u2014'}</Row>
      <Row label="Raised by">{titleCase(e.raisedByName || '\u2014')}</Row>
      {e.status === 'rejected' ? <><Row label="Rejected by">{titleCase(e.approvedByName || '\u2014')}{e.approvedAt ? ` \u00B7 ${fmtWhen(e.approvedAt)}` : ''}</Row><Row label="Reason">{e.rejectionReason || '\u2014'}</Row></> : <Row label="Approved by">{e.approvedByName ? `${titleCase(e.approvedByName)}${e.approvedAt ? ` \u00B7 ${fmtWhen(e.approvedAt)}` : ''}` : '\u2014'}</Row>}
      {e.status === 'paid' && <><Row label="Payment method">{methodLabel(e.paymentMethod)}{e.bankName ? ` \u00B7 ${bankLabel(e.bankName)}` : ''}</Row><Row label="Reference">{e.paymentRef || '\u2014'}</Row><Row label="Date of payment">{fmtDate(e.paymentDate)}</Row><Row label="Paid by">{titleCase(e.paidByName || '\u2014')}</Row></>}
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
        <div><button onClick={() => setPick(null)} className="text-xs font-bold text-slate-400 mb-3">\u2190 Back to history</button><ExpenseDetailInline e={pick} /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 mb-4"><div className="rounded-xl bg-slate-50 p-3"><div className="text-lg font-extrabold text-[#050A1F]">{paid.length}</div><div className="text-[10px] font-bold uppercase text-slate-400">Payments made</div></div><div className="rounded-xl bg-green-50 p-3"><div className="text-lg font-extrabold text-green-700">{inr(totalPaid)}</div><div className="text-[10px] font-bold uppercase text-slate-400">Total paid</div></div></div>
          {vendor.gstin && <div className="text-[11px] text-slate-400 mb-3">GSTIN <span className="font-mono text-slate-600">{vendor.gstin}</span></div>}
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Payment history</div>
          {rows === null ? <div className="text-sm text-slate-400 py-4">Loading\u2026</div> : rows.length === 0 ? <div className="text-sm text-slate-400 py-4">No expenses recorded for this vendor yet.</div> : <div className="space-y-2">{rows.map((r) => (
            <button key={r._id} onClick={() => setPick(r)} className="w-full text-left bg-white border border-slate-200 rounded-xl p-3 hover:border-orange-300"><div className="flex items-center justify-between"><span className="font-bold text-[#050A1F] text-sm">{r.title}</span><span className="font-extrabold text-[#050A1F]">{inr(r.amount)}</span></div><div className="flex items-center gap-2 mt-1"><StatusBadge s={r.status} /><span className="text-[11px] text-slate-400">{r.status === 'paid' ? `${methodLabel(r.paymentMethod)} \u00B7 ${fmtDate(r.paymentDate)}` : fmtDate(r.expenseDate)}</span></div></button>
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
      <Row label="Title">{e.title}</Row><Row label="Category">{e.category || '\u2014'}</Row><Row label="Branch">{e.branch || '\u2014'}</Row>
      <Row label="Expense date">{fmtDate(e.expenseDate)}</Row><Row label="Description">{e.description || '\u2014'}</Row>
      <Row label="Invoice">{e.invoiceUrl ? <a href={e.invoiceUrl} target="_blank" rel="noreferrer" className="text-sky-600 font-bold">\uD83D\uDCCE {e.invoiceName || 'View'}</a> : '\u2014'}</Row>
      <Row label="Approved by">{e.approvedByName ? titleCase(e.approvedByName) : '\u2014'}</Row>
      {e.status === 'paid' && <><Row label="Method">{methodLabel(e.paymentMethod)}{e.bankName ? ` \u00B7 ${bankLabel(e.bankName)}` : ''}</Row><Row label="Reference">{e.paymentRef || '\u2014'}</Row><Row label="Paid on">{fmtDate(e.paymentDate)}</Row><Row label="Paid by">{titleCase(e.paidByName || '\u2014')}</Row></>}
    </div>
  );
}

function ModalShell({ title, onClose, wide, children }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[140] p-4" onClick={onClose}>
      <div className={`bg-white rounded-2xl w-full ${wide ? 'max-w-2xl' : 'max-w-md'} shadow-2xl max-h-[90vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10"><div className="text-lg font-extrabold text-[#050A1F]">{title}</div><button onClick={onClose} className="text-slate-400 text-2xl leading-none">\u00D7</button></div>
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
        <div className="p-5 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10"><div><div className="font-extrabold text-[#050A1F]">{title}</div>{subtitle && <div className="text-[11px] text-slate-400">{subtitle}</div>}</div><button onClick={onClose} className="text-slate-400 text-2xl leading-none">\u00D7</button></div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
function Field({ label, full, children }) {
  return <div style={full ? { gridColumn: '1 / -1' } : undefined}><div className="text-xs font-bold text-slate-500 mb-1.5">{label}</div>{children}</div>;
}

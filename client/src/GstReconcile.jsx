import React, { useState, useEffect } from 'react';
import { API_BASE } from './config.js';
import { toast, confirmDialog } from './toast';

const api = async (path, opts = {}) => {
  const token = localStorage.getItem('qtx_token');
  const res = await fetch(API_BASE + '/api/gst-reconcile' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
};

const readB64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
const inr = (n) => n == null || n === '' ? '—' : '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n, cur) => n == null || n === '' ? '—' : (cur === 'USD' || !cur ? '$' : '') + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (cur && cur !== 'USD' ? ' ' + cur : '');
const monthName = (m) => { const mm = String(m || '').match(/^(\d{4})-(\d{2})$/); if (!mm) return m || ''; return `${['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+mm[2]]} ${mm[1]}`; };
const CURRENCIES = ['USD', 'EUR', 'GBP', 'AUD', 'CAD', 'SGD', 'AED', 'JPY', 'CHF', 'NZD', 'INR'];

function dateKey(d) {
  if (!d) return 0;
  let m = String(d).match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if (m) return +(`${m[3]}${m[2]}${m[1]}`);
  m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})$/); if (m) return +(`${m[1]}${m[2]}${m[3]}`);
  return 0;
}
// INV sequencer: "QS2W-26-075" -> 076, 077...
function invSeq(lastInv) {
  const s = String(lastInv || '').trim();
  const m = s.match(/^(.*?)(\d+)(\D*)$/);
  if (!m) { let n = 0; return () => { n++; return s ? `${s}-${n}` : String(n); }; }
  const prefix = m[1], width = m[2].length, suffix = m[3] || ''; let n = parseInt(m[2], 10);
  return () => { n++; return `${prefix}${String(n).padStart(width, '0')}${suffix}`; };
}
// Return a result whose active lines are date-sorted and INV-numbered ("Other" last).
function withInv(result, lastInv) {
  const r = JSON.parse(JSON.stringify(result));
  const active = (r.lines || []).filter((l) => !l.excluded).sort((a, b) => dateKey(a.txnDate) - dateKey(b.txnDate));
  const seq = invSeq(lastInv || r.lastInv);
  active.forEach((l) => { l.invNumber = seq(); });
  const map = new Map(active.map((l) => [l._uid, l.invNumber]));
  (r.lines || []).forEach((l) => { if (l.excluded) l.invNumber = null; else l.invNumber = map.get(l._uid) || l.invNumber; });
  r.lines = (r.lines || []).sort((a, b) => dateKey(a.txnDate) - dateKey(b.txnDate));
  const other = r.otherLine || r.interestLine;
  if (other && other.inr && !other.excluded) other.invNumber = seq();
  return r;
}
// Grouped totals by bank, computed from the finalized result (matches the table).
function groupBank(view) {
  if (!view) return { kotak: {}, indian: {}, totalReceived: 0 };
  const lines = (view.lines || []).filter((l) => !l.excluded);
  const other = view.otherLine || view.interestLine;
  const all = other && other.inr && !other.excluded ? [...lines, other] : lines;
  const sum = (p) => Math.round(all.filter(p).reduce((s, l) => s + (Number(l.inr) || 0), 0) * 100) / 100;
  const kotak = {
    stripe: sum((l) => l.account === 'Kotak' && l.merchant === 'Stripe'),
    wise: sum((l) => l.account === 'Kotak' && l.merchant === 'Wise'),
    inward: sum((l) => l.account === 'Kotak' && (l.kind === 'manual' || l.category === 'inward')),
    other: sum((l) => l.account === 'Kotak' && (l.kind === 'other' || l.merchant === 'Other')),
  };
  kotak.total = Math.round((kotak.stripe + kotak.wise + kotak.inward + kotak.other) * 100) / 100;
  const indian = { paypal: sum((l) => l.account === 'Indian Bank' && l.merchant === 'PayPal') };
  indian.total = indian.paypal;
  return { kotak, indian, totalReceived: Math.round((kotak.total + indian.total) * 100) / 100 };
}
function downloadBase64(base64, fileName, mime) {
  const bin = atob(base64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = fileName; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function FileSlot({ label, hint, file, accept, onPick, onClear }) {
  return (
    <div className={`rounded-xl border-2 border-dashed px-4 py-3 transition ${file ? 'border-emerald-300 bg-emerald-50' : 'border-slate-300 bg-slate-50 hover:border-violet-300'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[12.5px] font-bold text-slate-800">{label}</div>
          <div className="text-[11px] text-slate-500 truncate">{file ? `✓ ${file.name}` : hint}</div>
        </div>
        {file
          ? <button onClick={onClear} className="text-[11px] font-bold text-slate-400 hover:text-red-500 shrink-0">✕ Remove</button>
          : <label className="rounded-lg px-3 py-1.5 text-[11.5px] font-bold text-white cursor-pointer shrink-0" style={{ background: 'linear-gradient(135deg,#8B5CF6,#6366F1)' }}>Choose<input type="file" accept={accept} className="hidden" onChange={(e) => { if (e.target.files[0]) onPick(e.target.files[0]); e.target.value = ''; }} /></label>}
      </div>
    </div>
  );
}
function Stat({ label, value, sub, tone = 'slate' }) {
  const tones = { slate: 'text-slate-800', green: 'text-emerald-600', violet: 'text-violet-600', amber: 'text-amber-600', red: 'text-red-600', blue: 'text-sky-600' };
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-[16px] font-extrabold ${tones[tone]} mt-0.5`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}
function Row({ label, value, color = 'text-slate-700', muted }) {
  return (
    <div className="flex items-center justify-between py-1">
      <div className={`text-[12.5px] ${muted ? 'text-slate-400' : 'text-slate-600'}`}>• {label}</div>
      <div className={`text-[12.5px] font-bold ${muted ? 'text-slate-400' : color}`}>{value == null ? '—' : '₹' + Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
    </div>
  );
}
function Section({ title, desc, tone = 'slate', children }) {
  const bar = { slate: 'bg-slate-400', violet: 'bg-violet-500', green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500', blue: 'bg-sky-500' };
  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex">
        <div className={`w-1.5 ${bar[tone]}`} />
        <div className="flex-1 p-4">
          <div className="text-[14px] font-extrabold text-slate-800">{title}</div>
          {desc && <div className="text-[11.5px] text-slate-500 mt-0.5 mb-3 leading-relaxed">{desc}</div>}
          {children}
        </div>
      </div>
    </div>
  );
}

// Inline form to resolve a pending customer remittance.
function ManualForm({ pend, onAdd, onExclude }) {
  const [open, setOpen] = useState(false);
  const [currency, setCurrency] = useState('USD');
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('');
  const [merchant, setMerchant] = useState(pend.suggestMerchant || '');
  const submit = () => {
    if (!amount || !rate) { toast('Enter the amount and the conversion rate.', 'error'); return; }
    onAdd({ currency, foreignAmount: parseFloat(amount), rate: String(parseFloat(rate)), merchant: merchant.trim() || 'Customer' });
  };
  return (
    <div className="border-b border-slate-100 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[12.5px] font-bold text-slate-800">{pend.date} · {inr(pend.inr)} <span className="text-slate-400 font-normal">({pend.bank})</span></div>
          <div className="text-[11px] text-slate-500 truncate max-w-[360px]">{pend.desc}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setOpen((o) => !o)} className="rounded-lg px-3 py-1.5 text-[11px] font-bold text-white" style={{ background: 'linear-gradient(135deg,#0EA5E9,#38BDF8)' }}>{open ? 'Cancel' : '+ Add remittance details'}</button>
          <button onClick={onExclude} className="text-[11px] font-bold text-slate-400 hover:text-red-500">Exclude</button>
        </div>
      </div>
      {open && (
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 items-end bg-sky-50 rounded-lg p-3">
          <div>
            <label className="block text-[10.5px] font-bold text-slate-600 mb-0.5">Currency paid</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-[12px] font-semibold bg-white">
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10.5px] font-bold text-slate-600 mb-0.5">Amount customer paid</label>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="e.g. 650" className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-[12px] font-semibold" />
          </div>
          <div>
            <label className="block text-[10.5px] font-bold text-slate-600 mb-0.5">Kotak conversion rate</label>
            <input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" placeholder="e.g. 84.5" className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-[12px] font-semibold" />
          </div>
          <div className="flex gap-1.5">
            <div className="flex-1">
              <label className="block text-[10.5px] font-bold text-slate-600 mb-0.5">Merchant / customer</label>
              <input value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="Name" className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-[12px] font-semibold" />
            </div>
            <button onClick={submit} className="rounded-lg px-3 py-1.5 text-[12px] font-bold text-white self-end" style={{ background: 'linear-gradient(135deg,#059669,#10B981)' }}>Add</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function GstReconcile() {
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() === 0 ? 12 : now.getMonth()).padStart(2, '0')}`);
  const [lastInv, setLastInv] = useState('');
  const [indianBank, setIndianBank] = useState(null);
  const [kotak, setKotak] = useState(null);
  const [stripeCsv, setStripeCsv] = useState(null);
  const [paypalCsv, setPaypalCsv] = useState(null);
  const [fircs, setFircs] = useState([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [saved, setSaved] = useState([]);
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => { loadSaved(); }, []);
  async function loadSaved() { try { const r = await api('/list'); setSaved(r.items || []); } catch { /* noop */ } }

  async function run() {
    if (!indianBank && !kotak) { toast('Upload at least the Indian Bank or Kotak statement.', 'error'); return; }
    setRunning(true);
    try {
      const body = {
        month, lastInv: lastInv.trim(),
        indianBank: indianBank ? await readB64(indianBank) : null,
        kotak: kotak ? await readB64(kotak) : null,
        stripeCsv: stripeCsv ? await readB64(stripeCsv) : null,
        paypalCsv: paypalCsv ? await readB64(paypalCsv) : null,
        fircs: await Promise.all(fircs.map(async (f) => ({ name: f.name, base64: await readB64(f.file) }))),
      };
      const r = await api('/reconcile', { method: 'POST', body: JSON.stringify(body) });
      const res = r.result;
      (res.lines || []).forEach((l, i) => { l._uid = 'L' + i; });
      (res.pending || []).forEach((p, i) => { p._uid = 'P' + i; p.suggestMerchant = guessMerchant(p.desc); });
      setResult(res);
      toast('Reconciliation complete.', 'success');
    } catch (e) { toast(e.message, 'error'); }
    setRunning(false);
  }

  const finalized = () => result ? withInv(result, lastInv) : null;

  async function exportFile(kind) {
    try {
      const r = await api(`/export/${kind}`, { method: 'POST', body: JSON.stringify({ result: finalized() }) });
      downloadBase64(r.base64, r.fileName, kind === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf');
    } catch (e) { toast(e.message, 'error'); }
  }
  async function save() {
    try { await api('/save', { method: 'POST', body: JSON.stringify({ month, lastInv: lastInv.trim(), result: finalized() }) }); toast('Saved to CRM history.', 'success'); loadSaved(); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function openSaved(id) {
    try {
      const r = await api('/' + id); const it = r.item;
      setMonth(it.month); setLastInv(it.lastInv || '');
      const res = it.result; (res.lines || []).forEach((l, i) => { if (!l._uid) l._uid = 'L' + i; });
      (res.pending || []).forEach((p, i) => { if (!p._uid) p._uid = 'P' + i; p.suggestMerchant = guessMerchant(p.desc); });
      setResult(res); setShowSaved(false); toast(`Loaded ${monthName(it.month)}.`, 'success');
    } catch (e) { toast(e.message, 'error'); }
  }
  async function deleteSaved(id) {
    if (!(await confirmDialog({ title: 'Delete this saved month?', message: 'This removes the stored reconciliation.', confirmText: 'Delete' }))) return;
    try { await api('/' + id, { method: 'DELETE' }); loadSaved(); toast('Deleted.', 'success'); } catch (e) { toast(e.message, 'error'); }
  }

  // Mutations
  const excludeLine = (uid) => setResult((p) => ({ ...p, lines: p.lines.map((l) => l._uid === uid ? { ...l, excluded: true } : l) }));
  const excludePending = (uid) => setResult((p) => ({ ...p, pending: p.pending.map((x) => x._uid === uid ? { ...x, excluded: true, resolved: true } : x) }));
  const resolvePending = (pend, form) => setResult((p) => {
    const line = {
      _uid: 'M' + Date.now(), kind: 'manual', invNumber: null, txnDate: pend.date, inr: pend.inr,
      usd: form.foreignAmount, currency: form.currency, rate: form.rate, derivedUsd: false,
      ref: form.currency !== 'USD' ? form.currency : '', fircAdvice: null,
      merchant: form.merchant, account: 'Kotak', category: 'inward', matched: true, mismatch: null, excluded: false,
    };
    return { ...p, lines: [...p.lines, line], pending: p.pending.map((x) => x._uid === pend._uid ? { ...x, resolved: true } : x) };
  });

  const view = finalized();
  const other = view ? (view.otherLine || view.interestLine) : null;
  const g = groupBank(view);
  const activeLines = view ? view.lines.filter((l) => !l.excluded) : [];
  const activePending = view ? (view.pending || []).filter((p) => !p.resolved && !p.excluded) : [];

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-gradient-to-br from-[#050A1F] to-[#1a2547] text-white px-5 py-4">
        <div className="text-lg font-extrabold">PayPal, Stripe, Wise &amp; Other GST Reconciliation</div>
        <div className="text-[12.5px] text-slate-300 mt-1 leading-relaxed max-w-3xl">
          Pick a month and upload the statements. Every bank credit is read and shown in one date-ordered list with a running invoice number:
          PayPal (Indian Bank) matched to its FIRC; Stripe and Wise (Kotak) with USD worked out from that day’s rate; customer payments in
          another currency you confirm; and one combined “Other” line at the end (FD-maturity interest, small credits and any non-PayPal
          Indian Bank credit). Totals are grouped by bank. Export in your CA’s Excel format plus a full itemised PDF.
        </div>
        <button onClick={() => setShowSaved((s) => !s)} className="mt-2 text-[12px] font-bold text-violet-200 hover:text-white underline underline-offset-2">
          {showSaved ? 'Hide saved months' : `Saved months (${saved.length})`}
        </button>
      </div>

      {showSaved && (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          {saved.length === 0 ? <div className="text-[12.5px] text-slate-400 px-1 py-2">No saved months yet.</div> : (
            <div className="divide-y divide-slate-100">
              {saved.map((s) => (
                <div key={s._id} className="flex items-center justify-between py-2 px-1">
                  <div>
                    <div className="text-[13px] font-bold text-slate-800">{monthName(s.month)}</div>
                    <div className="text-[11px] text-slate-400">PayPal {inr(s.paypalInr)} · Stripe {inr(s.stripeInr)} · {s.pendingCount || 0} to review · {s.createdByName || ''}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => openSaved(s._id)} className="text-[11.5px] font-bold text-violet-600 hover:underline">Open</button>
                    <button onClick={() => deleteSaved(s._id)} className="text-[11.5px] font-bold text-slate-400 hover:text-red-500">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Setup */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[12px] font-bold text-slate-700 mb-1">Reconciliation month</label>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-[13px] font-semibold" />
          </div>
          <div>
            <label className="block text-[12px] font-bold text-slate-700 mb-1">Last invoice number <span className="font-normal text-slate-400">(previous month’s last INV)</span></label>
            <input value={lastInv} onChange={(e) => setLastInv(e.target.value)} placeholder="e.g. QS2W-26-075" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-[13px] font-semibold" />
            <div className="text-[11px] text-slate-400 mt-1">Numbers continue from here in date order (QS2W-26-075 → 076, 077…).</div>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <FileSlot label="Kotak Bank statement (PDF)" hint="Stripe, Wise, customer remittance + FD maturity" accept="application/pdf" file={kotak} onPick={setKotak} onClear={() => setKotak(null)} />
          <FileSlot label="Indian Bank statement (PDF)" hint="All PayPal inward remittance" accept="application/pdf" file={indianBank} onPick={setIndianBank} onClear={() => setIndianBank(null)} />
          <FileSlot label="PayPal transaction history (CSV)" hint="USD amount + conversion fee cross-check" accept=".csv,text/csv" file={paypalCsv} onPick={setPaypalCsv} onClear={() => setPaypalCsv(null)} />
          <FileSlot label="Stripe payout report (CSV)" hint="Payout net + transaction ID (no FIRC)" accept=".csv,text/csv" file={stripeCsv} onPick={setStripeCsv} onClear={() => setStripeCsv(null)} />
        </div>
        <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div>
              <div className="text-[12.5px] font-bold text-slate-800">PayPal FIRC documents (PDF)</div>
              <div className="text-[11px] text-slate-500">Upload every FIRC advice for the month — select several at once.</div>
            </div>
            <label className="rounded-lg px-3 py-1.5 text-[11.5px] font-bold text-white cursor-pointer shrink-0" style={{ background: 'linear-gradient(135deg,#8B5CF6,#6366F1)' }}>
              + Add FIRCs<input type="file" accept="application/pdf" multiple className="hidden" onChange={(e) => { const list = [...e.target.files].map((f) => ({ name: f.name, file: f })); setFircs((prev) => [...prev, ...list]); e.target.value = ''; }} />
            </label>
          </div>
          {fircs.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {fircs.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 rounded-full bg-white border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                  📄 {f.name.length > 26 ? f.name.slice(0, 24) + '…' : f.name}
                  <button onClick={() => setFircs((prev) => prev.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-500">✕</button>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={run} disabled={running} className="rounded-xl px-5 py-2.5 text-[13px] font-extrabold text-white disabled:opacity-60" style={{ background: 'linear-gradient(135deg,#FF6A00,#FF8A3D)' }}>
            {running ? 'Reconciling…' : '⚡ Run reconciliation'}
          </button>
          {view && <span className="text-[12px] text-slate-400">Showing {monthName(view.month)}. Resolve any pending items, then export or save.</span>}
        </div>
      </div>

      {view && (
        <div className="space-y-5">
          {/* Totals panel — total received on top, then grouped by bank */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex items-baseline justify-between border-b border-slate-100 pb-3 mb-3">
              <div className="text-[13px] font-bold text-slate-500 uppercase tracking-wide">Total received</div>
              <div className="text-[24px] font-extrabold text-slate-900">{inr(g.totalReceived)}</div>
            </div>
            <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1">
              {/* Kotak */}
              <div>
                <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                  <div className="text-[13px] font-extrabold text-slate-800">Kotak Bank</div>
                  <div className="text-[14px] font-extrabold text-slate-900">{inr(g.kotak.total)}</div>
                </div>
                <Row label="Stripe" value={g.kotak.stripe} color="text-emerald-600" />
                {g.kotak.wise > 0 && <Row label="Wise" value={g.kotak.wise} color="text-sky-600" />}
                <Row label="Inward remittance" value={g.kotak.inward} color="text-indigo-600" muted={!g.kotak.inward} />
                <Row label="Other" value={g.kotak.other} color="text-amber-600" />
              </div>
              {/* Indian Bank */}
              <div>
                <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                  <div className="text-[13px] font-extrabold text-slate-800">Indian Bank</div>
                  <div className="text-[14px] font-extrabold text-slate-900">{inr(g.indian.total)}</div>
                </div>
                <Row label="PayPal" value={g.indian.paypal} color="text-violet-600" />
                {activePending.length > 0 && (
                  <div className="mt-3 text-[12px] font-bold text-red-600">⚠ {activePending.length} credit(s) still need your input below.</div>
                )}
              </div>
            </div>
          </div>

          {(view.warnings || []).length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <div className="text-[12px] font-bold text-amber-700 mb-1">⚠ Please check</div>
              <ul className="text-[12px] text-amber-800 space-y-0.5 list-disc pl-5">{view.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => exportFile('xlsx')} className="rounded-lg px-4 py-2 text-[12.5px] font-bold text-white" style={{ background: 'linear-gradient(135deg,#059669,#10B981)' }}>⬇ Excel (CA format)</button>
            <button onClick={() => exportFile('pdf')} className="rounded-lg px-4 py-2 text-[12.5px] font-bold text-white" style={{ background: 'linear-gradient(135deg,#DC2626,#EF4444)' }}>⬇ PDF (itemised)</button>
            <button onClick={save} className="rounded-lg px-4 py-2 text-[12.5px] font-bold text-white" style={{ background: 'linear-gradient(135deg,#4F46E5,#6366F1)' }}>💾 Save month</button>
          </div>

          {/* Pending — do first */}
          {activePending.length > 0 && (
            <Section title={`Needs your input (${activePending.length})`} tone="red"
              desc="Credits that aren’t PayPal, Stripe or Wise. For a customer payment in another currency, add the currency, amount and Kotak’s conversion rate — it then joins the list in date order. Exclude anything that isn’t revenue (internal transfers, refunds).">
              {view.pending.filter((p) => !p.resolved && !p.excluded).map((p) => (
                <ManualForm key={p._uid} pend={p} onAdd={(form) => resolvePending(p, form)} onExclude={() => excludePending(p._uid)} />
              ))}
            </Section>
          )}

          {/* Unified reconciliation table */}
          <Section title={`Reconciliation — all transactions in date order (${activeLines.length})`} tone="violet"
            desc="One combined list with a running invoice number. PayPal shows FIRC values; Stripe & Wise show USD worked out from that day’s rate (marked ‘derived’). Red rows are PayPal credits with no FIRC match.">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px] min-w-[820px]">
                <thead><tr className="text-slate-500 text-left border-b border-slate-200">
                  <th className="py-1.5 pr-2">INV</th><th className="pr-2">Txn Date</th><th className="pr-2">Merchant</th><th className="pr-2 text-right">INR</th><th className="pr-2 text-right">USD / FCY</th><th className="pr-2 text-right">Rate</th><th className="pr-2">Ref</th><th className="pr-2">Account</th><th></th></tr></thead>
                <tbody>
                  {activeLines.map((l) => (
                    <tr key={l._uid} className={`border-b border-slate-100 ${l.matched === false ? 'bg-red-50' : ''}`}>
                      <td className="py-2 pr-2 font-mono text-[11px] font-bold text-slate-700">{l.invNumber}</td>
                      <td className="pr-2">{l.txnDate}</td>
                      <td className="pr-2">
                        <span className={`font-semibold ${l.merchant === 'PayPal' ? 'text-violet-600' : l.merchant === 'Stripe' ? 'text-emerald-600' : l.merchant === 'Wise' ? 'text-sky-600' : 'text-slate-700'}`}>{l.merchant}</span>
                      </td>
                      <td className="pr-2 text-right font-bold">{inr(l.inr)}</td>
                      <td className="pr-2 text-right">{money(l.usd, l.currency)}{l.derivedUsd && <span className="text-[9px] text-slate-400 align-super ml-0.5">der</span>}</td>
                      <td className="pr-2 text-right">{l.rate || '—'}</td>
                      <td className="pr-2 font-mono text-[10px] text-slate-400">{l.fircAdvice ? (l.ref || '') : (l.ref || (l.kind === 'stripe' ? 'no FIRC' : ''))}</td>
                      <td className="pr-2 text-slate-500 text-[11px]">{l.account}</td>
                      <td className="text-right"><button onClick={() => excludeLine(l._uid)} className="text-[11px] font-bold text-slate-300 hover:text-red-500">✕</button></td>
                    </tr>
                  ))}
                  {other && other.inr > 0 && !other.excluded && (
                    <tr className="border-b border-slate-100 bg-amber-50/50">
                      <td className="py-2 pr-2 font-mono text-[11px] font-bold text-slate-700">{other.invNumber}</td>
                      <td className="pr-2">{other.txnDate}</td>
                      <td className="pr-2"><span className="font-semibold text-amber-600">Other</span></td>
                      <td className="pr-2 text-right font-bold">{inr(other.inr)}</td>
                      <td className="pr-2 text-right">{money(other.usd)}{other.derivedUsd && <span className="text-[9px] text-slate-400 align-super ml-0.5">der</span>}</td>
                      <td className="pr-2 text-right">{other.rate || '—'}</td>
                      <td className="pr-2 text-[10px] text-slate-400">interest + misc ({other.count})</td>
                      <td className="pr-2 text-slate-500 text-[11px]">Kotak</td><td></td>
                    </tr>
                  )}
                </tbody>
                <tfoot><tr className="font-bold text-slate-800"><td colSpan={3} className="pt-2">Total received</td><td className="pt-2 text-right">{inr(g.totalReceived)}</td><td colSpan={5}></td></tr></tfoot>
              </table>
            </div>
          </Section>

          {/* Other line breakdown (interest + small credits + IB extras) */}
          {other && (other.breakdown || []).length > 0 && (
            <Section title="What’s inside the “Other” line" tone="amber"
              desc="FD-maturity interest, small miscellaneous credits, and any Indian Bank credit that isn’t PayPal or an internal transfer from Kotak — all combined into the single ‘Other’ line above, dated the last day of the month and converted at the month’s average rate. Sweep transfers (principal moving to/from the FD) are not counted.">
              <table className="w-full text-[12px]">
                <thead><tr className="text-slate-500 text-left border-b border-slate-200"><th className="py-1.5 pr-2">Date</th><th className="pr-2">Type</th><th className="pr-2 text-right">Amount</th></tr></thead>
                <tbody>
                  {other.breakdown.map((b, i) => (
                    <tr key={i} className="border-b border-slate-100"><td className="py-2 pr-2">{b.date}</td><td className="pr-2 font-semibold">{b.label}{b.gross ? <span className="text-slate-400 font-normal"> (deposit {inr(b.gross)})</span> : null}</td><td className="pr-2 text-right font-bold">{inr(b.inr)}</td></tr>
                  ))}
                </tbody>
                <tfoot><tr className="font-bold text-slate-700"><td colSpan={2} className="pt-2">Total Other</td><td className="pt-2 text-right">{inr(other.inr)}</td></tr></tfoot>
              </table>
            </Section>
          )}

          {/* Mismatches */}
          {((view.unmatchedFirc || []).length > 0 || (view.stripeMissingInBank || []).length > 0) && (
            <Section title="Mismatches to check" tone="red" desc="FIRC rows with no matching bank credit, or Stripe payouts not seen in Kotak.">
              {(view.unmatchedFirc || []).length > 0 && (
                <div className="mb-3">
                  <div className="text-[11.5px] font-bold text-slate-600 mb-1">FIRC without a bank credit ({view.unmatchedFirc.length})</div>
                  <table className="w-full text-[12px]"><tbody>
                    {view.unmatchedFirc.map((f, i) => <tr key={i} className="border-b border-slate-100 bg-red-50"><td className="py-1.5 pr-2">{f.txnDate}</td><td className="pr-2 text-right font-bold">{inr(f.inr)}</td><td className="pr-2 text-right">{money(f.usd)}</td><td className="pr-2 font-mono text-[10.5px]">{f.citiRef || '—'}</td></tr>)}
                  </tbody></table>
                </div>
              )}
              {(view.stripeMissingInBank || []).length > 0 && (
                <div className="text-[11.5px] text-amber-700">⚠ {view.stripeMissingInBank.length} Stripe payout(s) not found as a Kotak credit.</div>
              )}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function guessMerchant(desc) {
  const d = String(desc || '');
  // Pull a probable customer name token out of the bank narration.
  const m = d.match(/CRE001\s+([A-Z][A-Z ]{2,30})\s+TIP/i) || d.match(/\/([A-Z][A-Za-z ]{2,30})\//);
  return m ? m[1].trim().replace(/\s+/g, ' ') : '';
}

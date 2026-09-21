import React, { useState, useEffect } from 'react';
import { API_BASE } from './config.js';
import { toast, confirmDialog } from './toast';

const ORANGE = '#FF6A00';
const api = async (path, opts = {}) => {
  const token = localStorage.getItem('qtx_token');
  const res = await fetch(API_BASE + '/api/ticket-booking' + path, {
    ...opts,
    headers: { ...(opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
};
const titleCase = (s) => String(s || '').replace(/\b\w/g, (c) => c.toUpperCase());
const SRC = { viator: { l: 'Viator', bg: '#dbeafe', c: '#1d4ed8' }, gyg: { l: 'GYG', bg: '#fef3c7', c: '#b45309' }, direct: { l: 'Direct', bg: '#dcfce7', c: '#15803d' }, other: { l: 'Other', bg: '#f1f5f9', c: '#64748b' } };
const fmtDate = (iso, label) => label || (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '—');

// A name cell with a click-to-copy button (no need for Ctrl+C).
function CopyName({ text, id, copied, onCopy }) {
  if (!text) return <span className="text-slate-300">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 group">
      <span>{text}</span>
      <button onClick={() => onCopy(text, id)} title="Copy" className="opacity-0 group-hover:opacity-100 transition text-slate-400 hover:text-violet-600">
        {copied === id
          ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>
          : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>}
      </button>
    </span>
  );
}

export default function TicketBookingAdmin() {
  const [page, setPage] = useState('list'); // list | tobook | add | detail
  const [detailId, setDetailId] = useState(null);
  if (page === 'add') return <AddBookings onBack={() => setPage('list')} />;
  if (page === 'detail') return <BookingDetail id={detailId} onBack={() => setPage('list')} />;
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-2">
          <button onClick={() => setPage('list')} className={`px-3.5 py-2 rounded-lg text-[13px] font-bold ${page === 'list' ? 'text-white' : 'text-slate-500 bg-slate-100'}`} style={page === 'list' ? { background: '#050A1F' } : {}}>All bookings</button>
          <button onClick={() => setPage('tobook')} className={`px-3.5 py-2 rounded-lg text-[13px] font-bold ${page === 'tobook' ? 'text-white' : 'text-slate-500 bg-slate-100'}`} style={page === 'tobook' ? { background: '#050A1F' } : {}}>🎫 Tickets to book</button>
        </div>
        <button onClick={() => setPage('add')} className="rounded-lg px-4 py-2 text-[13px] font-bold text-white" style={{ background: `linear-gradient(135deg,${ORANGE},#FF4500)` }}>+ Add new booking</button>
      </div>
      {page === 'list' ? <BookingsList onOpen={(id) => { setDetailId(id); setPage('detail'); }} /> : <TicketsToBook onOpen={(id) => { setDetailId(id); setPage('detail'); }} />}
    </div>
  );
}

function BookingsList({ onOpen }) {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState(''); const [source, setSource] = useState(''); const [type, setType] = useState(''); const [status, setStatus] = useState('');
  const load = () => { const p = new URLSearchParams(); if (q) p.set('q', q); if (source) p.set('source', source); if (type) p.set('type', type); if (status) p.set('status', status); api(`/list?${p}`).then((r) => setRows(r.bookings || [])).catch((e) => toast(e.message)); };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q, source, type, status]);
  return (
    <div>
      <div className="flex gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]"><span className="absolute left-3 top-2.5 text-slate-400 text-sm">🔍</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reference, traveler…" className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-[13px]" /></div>
        <select value={source} onChange={(e) => setSource(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-[13px] bg-white"><option value="">All sources</option><option value="viator">Viator</option><option value="gyg">Get Your Guide</option><option value="direct">Direct</option><option value="other">Other</option></select>
        <select value={type} onChange={(e) => setType(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-[13px] bg-white"><option value="">All types</option><option value="regular">Regular</option><option value="last_minute">Last Minute</option></select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-[13px] bg-white"><option value="">All status</option><option value="new">New</option><option value="ticketed">Ticketed</option></select>
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead><tr className="bg-slate-50 text-[9.5px] uppercase text-slate-400 font-bold"><th className="text-left px-3 py-3">Reference</th><th className="text-left px-3 py-3">Source</th><th className="text-left px-3 py-3">Type</th><th className="text-left px-3 py-3">Travel date</th><th className="text-left px-3 py-3">Time</th><th className="text-left px-3 py-3">Lead traveler</th><th className="text-left px-3 py-3">Pax</th><th className="text-left px-3 py-3">Product</th><th className="text-left px-3 py-3">Status</th><th /></tr></thead>
          <tbody>
            {(rows || []).map((b) => { const src = SRC[b.source] || SRC.other; const green = b.status === 'ticketed' && !b.hasMismatch; const red = b.status === 'ticketed' && b.hasMismatch;
              return (
                <tr key={b.id} className="border-t border-slate-50" style={{ background: green ? '#f0fdf4' : red ? '#fef2f2' : undefined }}>
                  <td className="px-3 py-3 font-bold text-[#050A1F]">{b.reference}</td>
                  <td className="px-3 py-3"><span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background: src.bg, color: src.c }}>{src.l}</span></td>
                  <td className="px-3 py-3"><span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background: b.bookingType === 'last_minute' ? '#fee2e2' : '#f1f5f9', color: b.bookingType === 'last_minute' ? '#b91c1c' : '#64748b' }}>{b.bookingType === 'last_minute' ? 'Last Min' : 'Regular'}</span></td>
                  <td className="px-3 py-3 text-slate-600">{fmtDate(b.travelDate, b.travelDateLabel)}</td>
                  <td className="px-3 py-3 text-slate-600">{b.bookedTime || '—'}</td>
                  <td className="px-3 py-3 text-slate-700 font-semibold">{titleCase(b.leadTraveler || '')}</td>
                  <td className="px-3 py-3 text-slate-600">{b.adults}A{b.children ? ` · ${b.children}C` : ''}</td>
                  <td className="px-3 py-3 text-slate-500">{b.productName || '—'}</td>
                  <td className="px-3 py-3">{green ? <span className="text-green-600 font-bold text-[11px]">✓ {b.ocoNumber}</span> : red ? <span className="text-red-600 font-bold text-[11px]">⚠ {b.ocoNumber} · mismatch</span> : <span className="text-slate-400 text-[11px]">New — not ticketed</span>}</td>
                  <td className="px-3 py-3"><button onClick={() => onOpen(b.id)} className="text-[12px] font-bold text-blue-600">View</button></td>
                </tr>
              );
            })}
            {rows && rows.length === 0 && <tr><td colSpan={10} className="px-4 py-10 text-center text-slate-400 text-[13px]">No bookings match the filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AddBookings({ onBack }) {
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const parse = async () => { if (!text.trim()) return; setParsing(true); try { const r = await api('/parse', { method: 'POST', body: JSON.stringify({ text }) }); setRows(r.rows || []); if (!(r.rows || []).length) toast('No bookings could be parsed from that text.'); } catch (e) { toast(e.message); } setParsing(false); };
  const setRow = (i, obj) => setRows((s) => s.map((x, idx) => idx === i ? { ...x, ...obj } : x));
  const setTrav = (i, ti, obj) => setRows((s) => s.map((x, idx) => idx === i ? { ...x, travelers: x.travelers.map((t, k) => k === ti ? { ...t, ...obj } : t) } : x));
  const recomputeProduct = (row) => (row.bookingType === 'last_minute' ? `VIP ${row.bookedTime || ''}`.trim() : `TICKET & AUDIOGUIDED TOUR ${row.bookedTime || ''}`.trim());
  const saveAll = async () => { setBusy(true); try { const bookings = rows.map((r) => ({ ...r, productName: recomputeProduct(r) })); await api('/save', { method: 'POST', body: JSON.stringify({ bookings }) }); toast(`Saved ${rows.length} booking(s) ✓`); onBack(); } catch (e) { toast(e.message); setBusy(false); } };
  return (
    <div className="max-w-4xl">
      <button onClick={onBack} className="text-[13px] font-bold text-slate-500 mb-3">← Back to bookings</button>
      <h2 className="text-[18px] font-extrabold text-[#050A1F]">Add new booking</h2>
      <p className="text-[12.5px] text-slate-400 mb-4">Paste one or more confirmations (Viator / GetYourGuide). The system parses each into a card — review, set the booked time, then save all.</p>
      <div className="bg-white border border-slate-200 rounded-2xl p-4">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder="Paste booking confirmation text here…" className="w-full border border-slate-200 rounded-lg p-3 text-[12.5px] font-mono" />
        <button onClick={parse} disabled={parsing} className="mt-2.5 rounded-lg px-4 py-2 text-[13px] font-bold text-white" style={{ background: '#050A1F' }}>{parsing ? 'Parsing…' : '✨ Parse bookings'}</button>
      </div>
      {rows && rows.length > 0 && <>
        <div className="text-[11px] font-extrabold text-slate-400 uppercase mt-6 mb-3">Parsed — review ({rows.length})</div>
        {rows.map((r, i) => { const src = SRC[r.source] || SRC.other; return (
          <div key={i} className="bg-white border border-slate-200 rounded-2xl p-4 mb-3">
            <div className="flex items-center gap-2 mb-3"><b className="text-[14px] text-[#050A1F]">{r.reference}</b><span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background: src.bg, color: src.c }}>{src.l}</span><span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background: r.bookingType === 'last_minute' ? '#fee2e2' : '#f1f5f9', color: r.bookingType === 'last_minute' ? '#b91c1c' : '#64748b' }}>{r.bookingType === 'last_minute' ? 'Last Minute' : 'Regular'}</span></div>
            <div className="grid grid-cols-3 gap-2.5">
              <Fld label="Booking reference" v={r.reference} on={(v) => setRow(i, { reference: v })} />
              <Fld label="Travel date" v={r.travelDateLabel || r.travelDate || ''} on={(v) => setRow(i, { travelDateLabel: v })} />
              <Fld label="Lead traveler" v={r.leadTraveler || ''} on={(v) => setRow(i, { leadTraveler: v })} />
            </div>
            <div className="grid grid-cols-4 gap-2.5 mt-2.5">
              <Fld label="Adults" v={r.adults} on={(v) => setRow(i, { adults: Number(v) })} />
              <Fld label="Children (<18)" v={r.children} on={(v) => setRow(i, { children: Number(v) })} />
              <Fld label="Infants (<5)" v={r.infants} on={(v) => setRow(i, { infants: Number(v) })} />
              <Fld label="Total pax" v={r.pax} on={() => {}} disabled />
            </div>
            <div className="rounded-lg bg-orange-50 border border-orange-100 p-3 mt-3 flex items-center gap-3 flex-wrap">
              <span className="text-[12px] text-orange-800">Customer time: <b>{r.customerTime || '—'}</b></span>
              <span className="text-orange-700 text-[12px]">→ Booked:</span>
              <input value={r.bookedTime || ''} onChange={(e) => setRow(i, { bookedTime: e.target.value })} className="border border-orange-200 rounded-lg px-2.5 py-1.5 text-[13px] w-24 font-bold" />
              <span className="text-[11px] text-orange-500">+15 min (adjust for availability)</span>
              <span className="text-[12px] text-slate-600 ml-auto">Product: <b className="text-[#050A1F]">{recomputeProduct(r)}</b></span>
            </div>
            <div className="mt-3 border-t border-slate-100 pt-3">
              <div className="text-[10px] font-extrabold text-slate-400 uppercase mb-2">Travelers ({(r.travelers || []).length})</div>
              {(r.travelers || []).map((t, ti) => (
                <div key={ti} className="grid grid-cols-[80px_1fr_1fr_110px] gap-2 mb-1.5 items-center">
                  <span className="text-[12px] font-bold text-slate-600">{t.type} - {ti + 1}</span>
                  <input value={t.firstName} onChange={(e) => setTrav(i, ti, { firstName: e.target.value })} placeholder="First name" className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12.5px]" />
                  <input value={t.lastName} onChange={(e) => setTrav(i, ti, { lastName: e.target.value })} placeholder="Last name" className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12.5px]" />
                  <select value={t.type} onChange={(e) => setTrav(i, ti, { type: e.target.value })} className="border border-slate-200 rounded-lg px-2 py-1.5 text-[12px]">{['Adult', 'Child', 'Infant'].map((x) => <option key={x}>{x}</option>)}</select>
                </div>
              ))}
            </div>
          </div>
        ); })}
        <div className="flex justify-end"><button onClick={saveAll} disabled={busy} className="rounded-lg px-6 py-2.5 text-[13px] font-bold text-white disabled:opacity-50" style={{ background: `linear-gradient(135deg,${ORANGE},#FF4500)` }}>{busy ? 'Saving…' : 'Save all bookings'}</button></div>
      </>}
    </div>
  );
}
function Fld({ label, v, on, disabled }) { return <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">{label}</label><input value={v == null ? '' : v} disabled={disabled} onChange={(e) => on(e.target.value)} className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12.5px] disabled:bg-slate-50" /></div>; }

function BookingDetail({ id, onBack }) {
  const [b, setB] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState('');
  const copy = (text, cid) => { try { navigator.clipboard.writeText(text); setCopied(cid); setTimeout(() => setCopied(''), 1200); } catch {} };
  const load = () => api(`/${id}`).then(setB).catch((e) => toast(e.message));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);
  const upload = async (file) => {
    setUploading(true);
    try { const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
      const r = await api(`/${id}/upload-pdf`, { method: 'POST', body: JSON.stringify({ base64: b64 }) });
      toast(r.hasMismatch ? '⚠ Uploaded — some travelers have a mismatch' : '✓ Uploaded & verified — all match'); load();
    } catch (e) { toast(e.message); }
    setUploading(false);
  };
  if (!b) return <div className="text-slate-400 text-sm py-6">Loading…</div>;
  const src = SRC[b.source] || SRC.other;
  const verdict = (m) => m === 'ok' ? <span className="text-green-600 font-bold">✓</span> : m === 'time' ? <span className="text-red-600 font-bold">⚠ Time</span> : m === 'date' ? <span className="text-red-600 font-bold">⚠ Date</span> : m === 'missing' ? <span className="text-red-600 font-bold">⚠ Missing</span> : m === 'name' ? <span className="text-red-600 font-bold">⚠ Name</span> : '—';
  return (
    <div className="max-w-4xl">
      <button onClick={onBack} className="text-[13px] font-bold text-slate-500 mb-3">← Back to bookings</button>
      <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-4">
        <div className="flex items-start justify-between">
          <div><div className="text-[19px] font-extrabold text-[#050A1F]">{b.reference}</div><div className="text-[13px] text-slate-500 mt-0.5">{b.tourName || ''}</div><div className="flex gap-1.5 mt-2"><span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background: src.bg, color: src.c }}>{src.l}</span><span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background: b.bookingType === 'last_minute' ? '#fee2e2' : '#f1f5f9', color: b.bookingType === 'last_minute' ? '#b91c1c' : '#64748b' }}>{b.bookingType === 'last_minute' ? 'Last Minute' : 'Regular'}</span></div></div>
          {b.status === 'ticketed' && <div className="rounded-xl px-4 py-2 text-right border" style={{ background: b.hasMismatch ? '#fef2f2' : '#f0fdf4', borderColor: b.hasMismatch ? '#fecaca' : '#bbf7d0' }}><div className="text-[10px] font-bold uppercase" style={{ color: b.hasMismatch ? '#b91c1c' : '#15803d' }}>{b.hasMismatch ? '⚠ Ticketed · mismatch' : '✓ Ticketed · OCO'}</div><div className="text-[15px] font-extrabold" style={{ color: b.hasMismatch ? '#dc2626' : '#16a34a' }}>{b.ocoNumber}</div></div>}
        </div>
        <div className="grid grid-cols-5 gap-3 mt-4">
          {[['Travel date', fmtDate(b.travelDate, b.travelDateLabel)], ['Booked time', b.bookedTime || '—'], ['Lead traveler', titleCase(b.leadTraveler || '')], ['Pax', `${b.pax} (${b.adults}A · ${b.children}C)`], ['Product', b.productName || '—']].map(([l, v]) => (
            <div key={l} className="bg-slate-50 rounded-lg px-3 py-2.5"><div className="text-[9px] text-slate-400 uppercase font-bold">{l}</div><div className="text-[13px] font-bold text-[#050A1F] mt-0.5">{v}</div></div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between mb-2.5"><div className="text-[13px] font-extrabold text-[#050A1F]">Travelers & tickets</div>
        <label className="rounded-lg px-4 py-2 text-[12.5px] font-bold text-white cursor-pointer" style={{ background: 'linear-gradient(135deg,#8B5CF6,#6366F1)' }}>{uploading ? 'Reading PDF…' : '⬆ Upload ticket PDF'}<input type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files[0] && upload(e.target.files[0])} /></label>
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead><tr className="bg-slate-50 text-[9.5px] uppercase text-slate-400 font-bold"><th className="text-left px-4 py-2.5">Sl.No.</th><th className="text-left px-2 py-2.5">Traveler</th><th className="text-left px-2 py-2.5">First name</th><th className="text-left px-2 py-2.5">Last name</th><th className="text-left px-2 py-2.5">Type</th><th className="text-left px-2 py-2.5">Booked</th><th className="text-left px-2 py-2.5">Ticket time</th><th className="text-left px-2 py-2.5">OCO / page</th><th className="text-left px-2 py-2.5">Match</th></tr></thead>
          <tbody>
            {(b.travelers || []).map((t, i) => { const bad = t.match && t.match !== 'ok'; return (
              <tr key={i} className="border-t border-slate-50" style={{ background: bad ? '#fef2f2' : undefined }}>
                <td className="px-4 py-2.5 text-slate-500">{i + 1}</td>
                <td className="px-2 py-2.5 text-slate-600">{t.type} - {t.index || i + 1}</td>
                <td className="px-2 py-2.5 font-semibold"><CopyName text={t.firstName} id={`d${i}f`} copied={copied} onCopy={copy} /></td>
                <td className="px-2 py-2.5 font-semibold"><CopyName text={t.lastName} id={`d${i}l`} copied={copied} onCopy={copy} /></td>
                <td className="px-2 py-2.5 text-slate-500">{t.type}</td>
                <td className="px-2 py-2.5 text-slate-600">{b.bookedTime || '—'}</td>
                <td className="px-2 py-2.5" style={{ color: t.match === 'time' ? '#dc2626' : undefined, fontWeight: t.match === 'time' ? 700 : 400 }}>{t.ticketTime || (b.status === 'ticketed' ? '—' : '')}{t.match === 'time' ? ' ⚠' : ''}</td>
                <td className="px-2 py-2.5">{t.ocoNumber && t.pdfPage ? <a href={b.pdfUrl ? `${b.pdfUrl}#page=${t.pdfPage}` : '#'} target="_blank" rel="noreferrer" className="text-blue-600 font-bold">{t.ocoNumber}<span className="text-[10px] bg-slate-100 text-slate-500 rounded px-1.5 py-0.5 ml-1">p.{t.pdfPage}</span></a> : (b.status === 'ticketed' ? <span className="text-red-500">no ticket</span> : '—')}</td>
                <td className="px-2 py-2.5">{b.status === 'ticketed' ? verdict(t.match) : <span className="text-slate-300">—</span>}</td>
              </tr>
            ); })}
          </tbody>
        </table>
      </div>
      {b.status === 'ticketed' && <div className="text-[11.5px] text-slate-400 mt-2.5">Click an OCO to open the PDF at that traveler's page to print. Mismatches (name / date / time) show in red.</div>}
    </div>
  );
}

function TicketsToBook({ onOpen }) {
  const [dateFilter, setDateFilter] = useState('today'); // today|tomorrow|all|custom
  const [customDate, setCustomDate] = useState('');
  const [data, setData] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const iso = (d) => d.toISOString().slice(0, 10);
  // We book 1 day prior, so "Today" = tomorrow's travel date, "Tomorrow" = T+2.
  const tPlus1 = iso(new Date(Date.now() + 864e5));
  const tPlus2 = iso(new Date(Date.now() + 2 * 864e5));
  const activeDate = dateFilter === 'today' ? tPlus1 : dateFilter === 'tomorrow' ? tPlus2 : dateFilter === 'custom' ? customDate : '';
  const load = () => { const p = new URLSearchParams(); if (activeDate) p.set('date', activeDate); api(`/plan/tobook?${p}`).then(setData).catch((e) => toast(e.message)); };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dateFilter, customDate]);
  const [uploadFor, setUploadFor] = useState(null); // { ids, date, time }
  const [bulkOpen, setBulkOpen] = useState(false);
  // Merged bookings per ticket: { [ticketKey]: [bookingId, ...] } — extra bookings
  // combined onto a ticket. A merged booking is removed from its own ticket.
  const [merges, setMerges] = useState({});
  const [copied, setCopied] = useState('');
  const copy = (text, id) => { try { navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(''), 1200); } catch {} };
  const toggleMerge = (ticketKey, bookingId) => setMerges((m) => { const cur = m[ticketKey] || []; return { ...m, [ticketKey]: cur.includes(bookingId) ? cur.filter((x) => x !== bookingId) : [...cur, bookingId] }; });
  // All booking ids that have been merged onto SOME ticket (so we hide them from
  // their own ticket and from other suggestion lists).
  const mergedElsewhere = new Set(Object.values(merges).flat());
  const doUpload = async (file) => {
    try { const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
      const r = await api('/upload-group', { method: 'POST', body: JSON.stringify({ ids: uploadFor.ids, base64: b64 }) });
      toast(r.results.some((x) => x.hasMismatch) ? '⚠ Uploaded — some mismatches' : '✓ Booked & verified'); setUploadFor(null); load();
    } catch (e) { toast(e.message); }
  };
  const dbtn = (k, l) => <button onClick={() => { setDateFilter(k); setCustomDate(''); setExpanded(null); }} className={`px-3.5 py-1.5 rounded-lg text-[13px] font-bold border ${dateFilter === k ? 'text-white border-transparent' : 'text-slate-500 bg-white border-slate-200'}`} style={dateFilter === k ? { background: '#050A1F' } : {}}>{l}</button>;
  return (
    <div>
      <p className="text-[12.5px] text-slate-400 mb-4">Bookings still waiting for an official ticket, grouped by tour → time. One ticket holds max 8 pax; a booking is never split.</p>
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        {dbtn('today', 'Today')}{dbtn('tomorrow', 'Tomorrow')}{dbtn('all', 'All dates')}
        <input type="date" value={customDate} onChange={(e) => { setCustomDate(e.target.value); setDateFilter(e.target.value ? 'custom' : 'all'); setExpanded(null); }} className="border border-slate-200 rounded-lg px-3 py-1.5 text-[13px]" />
        <span className="text-[11.5px] text-slate-400">{dateFilter === 'today' ? `Today = tickets for tomorrow (${fmtDate(tPlus1)})` : dateFilter === 'tomorrow' ? `for ${fmtDate(tPlus2)}` : ''} {data ? `· ${data.pendingCount} pending` : ''}</span>
        <button onClick={() => setBulkOpen(true)} className="ml-auto rounded-lg px-3.5 py-1.5 text-[12.5px] font-bold text-white" style={{ background: 'linear-gradient(135deg,#8B5CF6,#6366F1)' }}>⬆ Bulk upload booked tickets</button>
      </div>
      {data && data.tours.length === 0 && <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-[13px] text-slate-400">No bookings waiting for tickets with these filters.</div>}
      {data && data.tours.map((tour) => (
        <div key={tour.tour} className="bg-white border border-slate-200 rounded-2xl overflow-hidden mb-5">
          <div className="px-5 py-3 flex items-center justify-between" style={{ background: '#050A1F' }}><h3 className="text-[15px] font-extrabold text-white">{tour.tour}</h3><span className="text-[11.5px] text-slate-400">{tour.ticketCount} ticket{tour.ticketCount !== 1 ? 's' : ''} to book · {tour.pax} travellers</span></div>
          <table className="w-full text-[12.5px]">
            <thead><tr className="bg-slate-50 text-[9.5px] uppercase text-slate-400 font-bold"><th className="text-left px-5 py-2.5">Date</th><th className="text-left px-2">Time</th><th className="text-left px-2">Bookings</th><th className="text-right px-2">Tickets</th><th className="text-right px-2">Travellers</th><th className="px-2" /></tr></thead>
            <tbody>
              {tour.slots.map((slot) => { const key = `${tour.tour}|${slot.date}|${slot.time}`; const open = expanded === key;
                return (
                  <React.Fragment key={key}>
                    <tr className="border-t border-slate-100 cursor-pointer" style={{ background: open ? '#f5f3ff' : undefined }} onClick={() => setExpanded(open ? null : key)}>
                      <td className="px-5 py-2.5">{fmtDate(slot.date)}</td><td className="px-2 font-bold">{slot.time}</td><td className="px-2 text-slate-500">{slot.bookings.length} booking{slot.bookings.length !== 1 ? 's' : ''}</td><td className="px-2 text-right font-extrabold text-violet-700">{slot.ticketCount}</td><td className="px-2 text-right font-bold">{slot.pax}</td><td className="px-2 text-right text-[11px] text-violet-700">{open ? '▲ hide plan' : '▼ show plan'}</td>
                    </tr>
                    {open && <tr className="border-t border-slate-100"><td colSpan={6} className="p-4" style={{ background: '#faf5ff' }}>
                      {slot.tickets.map((tk, bi) => {
                        const ticketKey = `${key}#${bi}`;
                        const baseIds = tk.items.map((m) => m.id);
                        // base members minus any that got merged onto ANOTHER ticket
                        const baseMembers = tk.items.filter((m) => !mergedElsewhere.has(m.id) || (merges[ticketKey] || []).includes(m.id));
                        // extra bookings merged onto THIS ticket (found across the whole tour)
                        const extraIds = merges[ticketKey] || [];
                        const allTourBookings = tour.slots.flatMap((s) => s.bookings);
                        const extras = allTourBookings.filter((b) => extraIds.includes(b.id) && !baseIds.includes(b.id));
                        const members = [...baseMembers, ...extras];
                        const usedPax = members.reduce((s, m) => s + m.pax, 0);
                        const free = 8 - usedPax;
                        // Ticket type of this ticket (from its base booking).
                        const ticketType = (members[0] && members[0].bookingType) || (tk.items[0] && tk.items[0].bookingType) || 'regular';
                        // Suggestions: SAME TOUR, SAME TYPE (general+general / lastmin+lastmin),
                        // not on this ticket, not merged elsewhere, that fit the free seats.
                        const candidates = allTourBookings.filter((b) =>
                          !members.some((m) => m.id === b.id) &&
                          !mergedElsewhere.has(b.id) &&
                          b.bookingType === ticketType &&
                          b.pax <= free && b.pax > 0);
                        // Group members by their booked time (for the sub-table headings).
                        const byTime = {};
                        members.forEach((m) => { (byTime[m.bookedTime || '—'] = byTime[m.bookedTime || '—'] || []).push(m); });
                        const timeGroups = Object.entries(byTime).sort((a, b) => a[0].localeCompare(b[0]));
                        let slNo = 0;
                        return (
                          <div key={bi} className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-3 last:mb-0">
                            <div className="px-4 py-2.5 flex items-center justify-between flex-wrap gap-2 border-b border-slate-100" style={{ background: '#faf5ff' }}>
                              <div className="text-[13px]"><b className="text-violet-800">Ticket {bi + 1}{extras.length > 0 ? ' — merged' : ` of ${slot.tickets.length}`}</b><span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: usedPax === 8 ? '#dcfce7' : '#fef3c7', color: usedPax === 8 ? '#15803d' : '#b45309' }}>{usedPax}/8 pax{free > 0 ? ` · ${free} free` : ' · full'}</span><span className="ml-2 text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background: ticketType === 'last_minute' ? '#fee2e2' : '#f1f5f9', color: ticketType === 'last_minute' ? '#b91c1c' : '#64748b' }}>{ticketType === 'last_minute' ? 'Last Minute' : 'Regular'}</span></div>
                              <button onClick={(e) => { e.stopPropagation(); setUploadFor({ ids: members.map((m) => m.id), date: slot.date, time: slot.time }); }} className="rounded-lg px-3 py-1.5 text-[11.5px] font-bold text-white" style={{ background: 'linear-gradient(135deg,#8B5CF6,#6366F1)' }}>🎟 Ticket booked — upload & mark as booked</button>
                            </div>
                            {timeGroups.map(([gtime, gmembers], gj) => { const ad = gmembers.reduce((s, m) => s + (m.adults || 0), 0); const ch = gmembers.reduce((s, m) => s + (m.children || 0), 0); const isMergedGroup = gmembers.every((m) => extraIds.includes(m.id));
                              return (
                                <div key={gtime}>
                                  {timeGroups.length > 1 && <div className="px-4 py-1.5 flex items-center gap-3 text-[11px] font-bold border-b border-slate-100" style={{ background: '#f8fafc' }}><span className="text-violet-700">⏱ {gtime}</span><span className="text-slate-600">{ad} Adult{ad !== 1 ? 's' : ''} · {ch} Child{ch !== 1 ? 'ren' : ''}</span>{isMergedGroup && <span className="text-amber-600 text-[10px]">merged ↩</span>}</div>}
                                  <table className="w-full text-[12px]"><thead><tr className="text-left text-[9px] uppercase text-slate-400 border-b border-slate-100"><th className="px-4 py-2">Sl.No.</th><th className="px-2">Booking ID</th><th className="px-2">Time</th><th className="px-2">Trav.</th><th className="px-2">First name</th><th className="px-2">Last name</th><th className="px-2">Type</th></tr></thead>
                                    <tbody>{gmembers.flatMap((bk) => (bk.travelers && bk.travelers.length ? bk.travelers : []).map((t, ti) => ({ bk, t, ti }))).map(({ bk, t, ti }) => { slNo++; const isExtra = extraIds.includes(bk.id); return (
                                      <tr key={`${bk.id}-${ti}`} className="border-b border-slate-50 last:border-0" style={{ background: isExtra ? '#fffbeb' : undefined }}>
                                        <td className="px-4 py-1.5 text-slate-500">{slNo}</td>
                                        <td className="px-2 py-1.5"><button onClick={() => onOpen(bk.id)} className="font-mono text-[11px] text-violet-700 underline">{bk.reference}</button></td>
                                        <td className="px-2 py-1.5 font-semibold text-slate-600">{bk.bookedTime}</td>
                                        <td className="px-2 py-1.5 text-slate-500">{ti + 1}</td>
                                        <td className="px-2 py-1.5"><CopyName text={t.firstName} id={`${bk.id}-${ti}-f`} copied={copied} onCopy={copy} /></td>
                                        <td className="px-2 py-1.5"><CopyName text={t.lastName} id={`${bk.id}-${ti}-l`} copied={copied} onCopy={copy} /></td>
                                        <td className="px-2 py-1.5 text-slate-500">{t.type}</td>
                                      </tr>
                                    ); })}</tbody>
                                  </table>
                                </div>
                              );
                            })}
                            {free > 0 && candidates.length > 0 && (
                              <div className="px-4 py-3 border-t border-dashed border-amber-200" style={{ background: '#fffbeb99' }}>
                                <div className="text-[10.5px] font-extrabold text-amber-800 uppercase tracking-wide mb-2">💡 {free} seat{free !== 1 ? 's' : ''} free — merge another {ticketType === 'last_minute' ? 'Last Minute' : 'Regular'} booking (same type only)</div>
                                <div className="flex flex-col gap-1.5">
                                  {candidates.map((b) => (
                                    <label key={b.id} className="flex items-center gap-2 text-[12.5px] cursor-pointer">
                                      <input type="checkbox" checked={extraIds.includes(b.id)} onChange={() => toggleMerge(ticketKey, b.id)} className="accent-violet-600" />
                                      <span className="font-mono text-[11px] text-violet-700">{b.reference}</span>
                                      <span className="font-semibold text-slate-700">{titleCase(b.leadTraveler || '')}</span>
                                      <span className="text-[11px] text-slate-500">{b.pax} pax @ {b.bookedTime}{b.travelDate !== slot.date ? ` · ${fmtDate(b.travelDate)}` : ''}</span>
                                    </label>
                                  ))}
                                </div>
                                <p className="text-[10.5px] text-slate-400 mt-1.5">Merged bookings ride on this ticket and are removed from their own — book & upload once for all.</p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </td></tr>}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
      {data && data.tours.length > 0 && <div className="rounded-xl px-5 py-3.5 flex items-center justify-between text-white text-[13px] font-bold" style={{ background: '#050A1F' }}><span>Grand total — {activeDate ? fmtDate(activeDate) : 'all dates'}</span><span>{data.grandTickets} tickets to book · {data.grandPax} travellers</span></div>}

      {bulkOpen && <BulkUpload onClose={() => setBulkOpen(false)} onDone={() => { setBulkOpen(false); load(); }} />}
      {uploadFor && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-[150] p-4" onClick={() => setUploadFor(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-[15px] font-extrabold text-[#050A1F] mb-1">Upload ticket PDF</div>
            <div className="text-[12.5px] text-slate-500 mb-4">{uploadFor.ids.length} booking(s) @ {uploadFor.time} · {fmtDate(uploadFor.date)}. Upload the official PDF to verify and mark as booked.</div>
            <label className="block rounded-lg border-2 border-dashed border-violet-300 text-violet-700 font-bold text-[13px] py-6 text-center cursor-pointer">⬆ Choose PDF<input type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files[0] && doUpload(e.target.files[0])} /></label>
          </div>
        </div>
      )}
    </div>
  );
}

// Bulk upload: drop many ticket PDFs, auto-match to bookings by name+date+time,
// review the ambiguous/unmatched, then link all at once.
function BulkUpload({ onClose, onDone }) {
  const [files, setFiles] = useState([]); // {name, base64}
  const [reading, setReading] = useState(false);
  const [result, setResult] = useState(null); // { matched, review, files, bookings }
  const [assign, setAssign] = useState({}); // reviewIndex -> bookingId
  const [busy, setBusy] = useState(false);
  const addFiles = async (list) => {
    const arr = [];
    for (const f of list) { const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); }); arr.push({ name: f.name, base64: b64 }); }
    setFiles((s) => [...s, ...arr]);
  };
  const read = async () => {
    if (!files.length) return; setReading(true);
    try { const r = await api('/bulk/read', { method: 'POST', body: JSON.stringify({ files }) }); setResult(r); } catch (e) { toast(e.message); }
    setReading(false);
  };
  const linkAll = async () => {
    if (!result) return; setBusy(true);
    const links = [];
    result.matched.forEach((m) => { links.push({ bookingId: m.bookingId, travelerIndex: m.travelerIndex, ticket: { code: m.ticket.code, time: m.ticket.time, dateIso: m.ticket.dateIso, page: m.ticket.page, oco: m.ticket.oco, pdfUrl: m.ticket.pdfUrl, pdfFileId: m.ticket.pdfFileId } }); });
    // manually-assigned review rows: match by name within the chosen booking
    result.review.forEach((rv, i) => { const bid = assign[i]; if (!bid) return; const bk = result.bookings.find((b) => b.id === bid); if (!bk) return; const tn = (rv.ticket.name || '').toLowerCase().replace(/[^a-z]/g, ''); let ti = bk.travelers.findIndex((full) => full.toLowerCase().replace(/[^a-z]/g, '') === tn); if (ti < 0) ti = 0; links.push({ bookingId: bid, travelerIndex: ti, ticket: { code: rv.ticket.code, time: rv.ticket.time, dateIso: rv.ticket.dateIso, page: rv.ticket.page, oco: rv.ticket.oco, pdfUrl: rv.ticket.pdfUrl, pdfFileId: rv.ticket.pdfFileId } }); });
    try { await api('/bulk/link', { method: 'POST', body: JSON.stringify({ links }) }); toast(`Linked ${links.length} ticket(s) ✓`); onDone(); } catch (e) { toast(e.message); setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-start justify-center z-[150] p-4 overflow-auto">
      <div className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl my-6" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div><div className="text-[16px] font-extrabold text-[#050A1F]">⬆ Bulk upload booked tickets</div><div className="text-[12px] text-slate-400">Drop all ticket PDFs — matched to bookings by name, date & time.</div></div>
          <button onClick={onClose} className="text-slate-400 text-2xl leading-none">×</button>
        </div>
        <div className="p-5">
          {!result ? (
            <>
              <label className="block border-2 border-dashed border-violet-300 rounded-xl bg-violet-50 py-8 text-center text-violet-700 font-bold text-[14px] cursor-pointer" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
                ⬆ Drop ticket PDFs here, or click to browse
                <div className="text-slate-400 font-medium text-[12px] mt-1">Multiple files · multi-page PDFs supported</div>
                <input type="file" accept="application/pdf" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
              </label>
              {files.length > 0 && <div className="flex flex-wrap gap-2 mt-3">{files.map((f, i) => <span key={i} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-[12px] text-slate-600 flex items-center gap-2">📄 {f.name}<button onClick={() => setFiles((s) => s.filter((_, k) => k !== i))} className="text-slate-400 hover:text-red-500">×</button></span>)}</div>}
              <div className="flex justify-end mt-4"><button onClick={read} disabled={!files.length || reading} className="rounded-lg px-5 py-2 text-[13px] font-bold text-white disabled:opacity-50" style={{ background: 'linear-gradient(135deg,#8B5CF6,#6366F1)' }}>{reading ? 'Reading…' : '✨ Read & auto-match'}</button></div>
            </>
          ) : (
            <>
              <div className="text-[11px] font-extrabold uppercase text-slate-500 mb-2.5 flex items-center gap-2">✓ Matched & linked <span className="text-[10px] font-bold bg-green-100 text-green-700 rounded-full px-2 py-0.5">{result.matched.length} tickets</span></div>
              <div className="border border-slate-200 rounded-xl overflow-hidden mb-5">
                <table className="w-full text-[12px]"><thead><tr className="bg-slate-50 text-[9px] uppercase text-slate-400 font-bold text-left"><th className="px-3 py-2">Ticket name</th><th className="px-2">Code</th><th className="px-2">Date · Time</th><th className="px-2">Booking</th><th className="px-2">Traveler</th><th className="px-2">Status</th></tr></thead>
                  <tbody>{result.matched.map((m, i) => (<tr key={i} className="border-t border-slate-50"><td className="px-3 py-2 font-semibold">{m.ticket.name}</td><td className="px-2 font-mono text-[10px] text-slate-500">{(m.ticket.code || '').slice(0, 8)}…</td><td className="px-2 text-slate-500">{m.ticket.dateIso ? fmtDate(m.ticket.dateIso) : ''} · {m.ticket.time}</td><td className="px-2 font-mono text-[11px] text-violet-700">{m.reference}</td><td className="px-2 text-slate-500">{m.travelerLabel}</td><td className="px-2 text-green-600 font-bold">✓ Linked</td></tr>))}
                    {result.matched.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-400">No confident matches.</td></tr>}</tbody>
                </table>
              </div>
              {result.review.length > 0 && <>
                <div className="text-[11px] font-extrabold uppercase text-slate-500 mb-2.5 flex items-center gap-2">⚠ Needs review — assign manually <span className="text-[10px] font-bold bg-amber-100 text-amber-700 rounded-full px-2 py-0.5">{result.review.length} tickets</span></div>
                <div className="border border-slate-200 rounded-xl overflow-hidden mb-5">
                  <table className="w-full text-[12px]"><thead><tr className="bg-slate-50 text-[9px] uppercase text-slate-400 font-bold text-left"><th className="px-3 py-2">Ticket name</th><th className="px-2">Date · Time</th><th className="px-2">Reason</th><th className="px-2">Assign to booking</th></tr></thead>
                    <tbody>{result.review.map((rv, i) => (<tr key={i} className="border-t border-slate-50" style={{ background: '#fef2f2' }}><td className="px-3 py-2 font-semibold">{rv.ticket.name}</td><td className="px-2 text-slate-500">{rv.ticket.dateIso ? fmtDate(rv.ticket.dateIso) : ''} · {rv.ticket.time}</td><td className="px-2 text-red-600 font-semibold text-[11px]">{rv.reason}</td>
                      <td className="px-2"><select value={assign[i] || ''} onChange={(e) => setAssign((s) => ({ ...s, [i]: e.target.value ? Number(e.target.value) : undefined }))} className="border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] w-full">
                        <option value="">Select booking…</option>
                        {(rv.candidates.length ? rv.candidates : result.bookings).map((c) => <option key={c.id} value={c.id}>{c.reference} · {titleCase((c.lead || c.leadTraveler) || '')}</option>)}
                      </select></td></tr>))}</tbody>
                  </table>
                </div>
              </>}
              <div className="flex justify-between items-center">
                <button onClick={() => { setResult(null); setFiles([]); }} className="text-[12.5px] font-bold text-slate-500">← Upload different files</button>
                <button onClick={linkAll} disabled={busy} className="rounded-lg px-6 py-2.5 text-[13px] font-bold text-white disabled:opacity-50" style={{ background: 'linear-gradient(135deg,#FF6A00,#FF4500)' }}>{busy ? 'Saving…' : `Save all linked (${result.matched.length + Object.values(assign).filter(Boolean).length})`}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

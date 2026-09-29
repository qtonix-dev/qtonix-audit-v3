import React, { useState, useEffect } from 'react';
import { API_BASE } from './config.js';

// Standalone CUSTOMER portal — a separate login that ONLY shows Ticket Booking.
// Customers can add bookings, upload the OCO PDF, and view/download tickets.
// No CRM/HRMS access whatsoever.
const TOKEN_KEY = 'qtx_ticket_token';
const ORANGE = '#FF6A00';
const titleCase = (s) => String(s || '').replace(/\b\w/g, (c) => c.toUpperCase());
const typeLabel = (t) => (t === 'last_minute' ? 'VIP' : t === 'arena' ? 'Arena AudioGuided' : 'Regular');
const TYPE_STYLE = { last_minute: { bg: '#ede9fe', c: '#6d28d9' }, arena: { bg: '#dcfce7', c: '#15803d' }, regular: { bg: '#f1f5f9', c: '#64748b' } };
const typeStyle = (t) => TYPE_STYLE[t] || TYPE_STYLE.regular;
const fmtDate = (iso, label) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : (label ? String(label).replace(/^[A-Za-z]{3},\s*/, '') : '—');
const displayTime = (b) => { if (b && b.status === 'ticketed') { const t = (b.travelers || []).find((x) => x.ticketTime); if (t && t.ticketTime) return t.ticketTime; } return (b && b.bookedTime) || '—'; };

const api = async (path, opts = {}) => {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(`${API_BASE}/api/ticket-portal${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { localStorage.removeItem(TOKEN_KEY); }
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
};

export default function TicketPortal() {
  const [customer, setCustomer] = useState(null);
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) { setChecking(false); return; }
    api('/me').then((r) => setCustomer(r.customer)).catch(() => localStorage.removeItem(TOKEN_KEY)).finally(() => setChecking(false));
  }, []);
  if (checking) return <Center>Loading…</Center>;
  if (!customer) return <Login onIn={(c) => setCustomer(c)} />;
  return <Portal customer={customer} onLogout={() => { localStorage.removeItem(TOKEN_KEY); setCustomer(null); }} />;
}

function Center({ children }) { return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui', color: '#64748b' }}>{children}</div>; }

function Login({ onIn }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await api('/login', { method: 'POST', body: JSON.stringify({ email, password }) }); localStorage.setItem(TOKEN_KEY, r.token); onIn(r.customer); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#050A1F,#0B1533)', fontFamily: 'system-ui, sans-serif', padding: 16 }}>
      <form onSubmit={submit} style={{ background: '#fff', borderRadius: 18, padding: 32, width: '100%', maxWidth: 400, boxShadow: '0 20px 60px rgba(0,0,0,.35)' }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#050A1F' }}>Qtonix<span style={{ color: ORANGE }}>.</span></div>
        <div style={{ fontSize: 14, color: '#64748b', marginTop: 4, marginBottom: 22 }}>🎟️ Ticket Booking — Customer Portal</div>
        <label style={lbl}>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoFocus style={inp} placeholder="you@company.com" />
        <label style={lbl}>Password</label>
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" style={inp} placeholder="••••••••" />
        {err && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 10 }}>{err}</div>}
        <button disabled={busy} style={{ marginTop: 18, width: '100%', border: 0, borderRadius: 10, padding: 12, fontSize: 15, fontWeight: 800, color: '#fff', background: `linear-gradient(90deg,${ORANGE},#FF4500)`, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 14, textAlign: 'center' }}>Access is provided by Qtonix. Contact your account manager for a login.</div>
      </form>
    </div>
  );
}

function Portal({ customer, onLogout }) {
  const [page, setPage] = useState('list'); // list | add | upload
  const [uploadId, setUploadId] = useState(null);
  return (
    <div style={{ minHeight: '100vh', background: '#f6f7f9', fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif' }}>
      <div style={{ background: '#050A1F', color: '#fff', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>Qtonix<span style={{ color: ORANGE }}>.</span></div>
        <span style={{ color: '#94a3b8', fontSize: 14, fontWeight: 600 }}>🎟️ Ticket Booking</span>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: '#cbd5e1' }}>{customer.name}{customer.company ? ` · ${customer.company}` : ''}</span>
        <button onClick={onLogout} style={{ fontSize: 12.5, fontWeight: 700, color: '#fff', background: 'rgba(255,255,255,.12)', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>Logout</button>
      </div>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: 20 }}>
        {page !== 'upload' && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button onClick={() => setPage('list')} style={tab(page === 'list')}>All bookings</button>
            <button onClick={() => setPage('add')} style={{ ...tab(false), marginLeft: 'auto', color: '#fff', background: `linear-gradient(135deg,${ORANGE},#FF4500)` }}>+ Add booking</button>
          </div>
        )}
        {page === 'list' && <BookingsList onUpload={(id) => { setUploadId(id); setPage('upload'); }} />}
        {page === 'add' && <AddBookings onBack={() => setPage('list')} />}
        {page === 'upload' && <UploadOco id={uploadId} customer={customer} onBack={() => setPage('list')} />}
      </div>
    </div>
  );
}

function BookingsList({ onUpload }) {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [date, setDate] = useState('');
  const [expanded, setExpanded] = useState(null);
  const load = () => { const p = new URLSearchParams(); if (q) p.set('q', q); if (status) p.set('status', status); if (date) p.set('date', date); api(`/list?${p}`).then((r) => setRows(r.bookings || [])).catch(() => setRows([])); };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q, status, date]);
  const token = localStorage.getItem(TOKEN_KEY);
  const dl = (b) => window.open(`${API_BASE}/api/ticket-portal/${b.id}/tickets.pdf?token=${encodeURIComponent(token)}`, '_blank');
  const dlPage = (b, page) => window.open(`${API_BASE}/api/ticket-portal/${b.id}/tickets.pdf?page=${page}&token=${encodeURIComponent(token)}`, '_blank');
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Search reference, traveler…" style={{ flex: 1, minWidth: 200, border: '1px solid #e2e8f0', borderRadius: 9, padding: '9px 12px', fontSize: 13 }} />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ border: '1px solid #e2e8f0', borderRadius: 9, padding: '8px 12px', fontSize: 13 }} />
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ border: '1px solid #e2e8f0', borderRadius: 9, padding: '8px 12px', fontSize: 13, background: '#fff' }}><option value="">All status</option><option value="new">To ticket</option><option value="ticketed">Ticketed</option></select>
      </div>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead><tr style={{ background: '#f8fafc', color: '#94a3b8', fontSize: 9.5, textTransform: 'uppercase', fontWeight: 800 }}><th style={th} /><th style={th}>Reference</th><th style={th}>Type</th><th style={th}>Travel date</th><th style={th}>Time</th><th style={th}>Lead traveler</th><th style={th}>Pax</th><th style={th}>Status</th><th style={th}>Action</th></tr></thead>
          <tbody>
            {(rows || []).map((b) => { const green = b.status === 'ticketed' && !b.hasMismatch; const open = expanded === b.id; const ticketed = b.status === 'ticketed';
              return (
                <React.Fragment key={b.id}>
                  <tr style={{ borderTop: '1px solid #f1f5f9', cursor: 'pointer', background: open ? '#f8fafc' : green ? '#f0fdf4' : undefined }} onClick={() => setExpanded(open ? null : b.id)}>
                    <td style={{ ...td, color: '#94a3b8', textAlign: 'center' }}>{open ? '▲' : '▼'}</td>
                    <td style={{ ...td, fontWeight: 700, color: '#050A1F' }}>{b.reference}</td>
                    <td style={td}><span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap', background: typeStyle(b.bookingType).bg, color: typeStyle(b.bookingType).c }}>{typeLabel(b.bookingType)}</span></td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDate(b.travelDate, b.travelDateLabel)}</td>
                    <td style={td}>{displayTime(b)}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{titleCase(b.leadTraveler || '')}</td>
                    <td style={td}>{b.adults}A{b.children ? ` · ${b.children}C` : ''}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{green ? <span style={{ color: '#16a34a', fontWeight: 700, fontSize: 11 }}>✓ {b.ocoNumber}</span> : <span style={{ color: '#94a3b8', fontSize: 11 }}>To ticket</span>}</td>
                    <td style={td} onClick={(e) => e.stopPropagation()}><button onClick={() => onUpload(b.id)} style={{ fontSize: 11.5, fontWeight: 700, color: '#fff', border: 'none', borderRadius: 8, padding: '5px 10px', background: 'linear-gradient(135deg,#8B5CF6,#6366F1)', cursor: 'pointer', whiteSpace: 'nowrap' }}>{ticketed ? 'Re-upload' : '⬆ Upload OCO'}</button></td>
                  </tr>
                  {open && <tr><td colSpan={9} style={{ padding: 0, background: '#f8fafc' }}>
                    <div style={{ padding: '16px 24px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
                        <div style={{ fontSize: 10.5, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase' }}>{b.tourName || 'Travelers & tickets'}</div>
                        {ticketed && (b.travelers || []).some((t) => t.pdfPage) && <button onClick={() => dl(b)} style={{ borderRadius: 8, padding: '6px 12px', fontSize: 11.5, fontWeight: 700, color: '#fff', border: 'none', background: 'linear-gradient(135deg,#8B5CF6,#6366F1)', cursor: 'pointer' }}>⬇ Download all tickets</button>}
                      </div>
                      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                          <thead><tr style={{ textAlign: 'left', fontSize: 9, textTransform: 'uppercase', color: '#94a3b8', borderBottom: '1px solid #f1f5f9' }}><th style={td2}>Sl.No.</th><th style={td2}>First name</th><th style={td2}>Last name</th><th style={td2}>Type</th><th style={td2}>Ticket time</th><th style={td2}>OCO / page</th></tr></thead>
                          <tbody>{(b.travelers || []).map((t, ti) => (
                            <tr key={ti} style={{ borderBottom: '1px solid #f6f7f9' }}>
                              <td style={td2}>{ti + 1}</td><td style={{ ...td2, fontWeight: 600 }}>{t.firstName}</td><td style={{ ...td2, fontWeight: 600 }}>{t.lastName}</td><td style={{ ...td2, color: '#64748b' }}>{t.type}</td><td style={td2}>{t.ticketTime || '—'}</td>
                              <td style={td2}>{t.ocoNumber && t.pdfPage ? <button onClick={() => dlPage(b, t.pdfPage)} style={{ color: '#2563eb', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>{t.ocoNumber} p.{t.pdfPage} ⬇</button> : '—'}</td>
                            </tr>
                          ))}</tbody>
                        </table>
                      </div>
                    </div>
                  </td></tr>}
                </React.Fragment>
              );
            })}
            {rows && rows.length === 0 && <tr><td colSpan={9} style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No bookings yet. Click “+ Add booking”.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AddBookings({ onBack }) {
  const [text, setText] = useState(''); const [parsing, setParsing] = useState(false);
  const [rows, setRows] = useState(null); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  const parse = async () => { if (!text.trim()) return; setParsing(true); setMsg(''); try { const r = await api('/parse', { method: 'POST', body: JSON.stringify({ text }) }); setRows(r.rows || []); if (!(r.rows || []).length) setMsg('No bookings could be parsed from that text.'); } catch (e) { setMsg(e.message); } setParsing(false); };
  const setRow = (i, obj) => setRows((s) => s.map((x, idx) => idx === i ? { ...x, ...obj } : x));
  const setTrav = (i, ti, obj) => setRows((s) => s.map((x, idx) => idx === i ? { ...x, travelers: x.travelers.map((t, k) => k === ti ? { ...t, ...obj } : t) } : x));
  const productFor = (r) => r.bookingType === 'last_minute' ? `VIP ${r.bookedTime || ''}`.trim() : r.bookingType === 'arena' ? `ARENA AUDIOGUIDED ${r.bookedTime || ''}`.trim() : `TICKET & AUDIOGUIDED TOUR ${r.bookedTime || ''}`.trim();
  const saveAll = async () => {
    setBusy(true); setMsg('');
    try {
      const bookings = rows.map((r) => ({ ...r, productName: productFor(r) }));
      const res = await api('/save', { method: 'POST', body: JSON.stringify({ bookings }) });
      const skipped = res.skipped || [];
      if (skipped.length) { setMsg(`Saved ${(res.saved || []).length} · skipped ${skipped.length} duplicate(s): ${skipped.map((s) => s.reference).join(', ')}`); setBusy(false); if ((res.saved || []).length) { const skipRefs = new Set(skipped.map((s) => String(s.reference).trim().toLowerCase())); setRows((s) => s.filter((r) => skipRefs.has(String(r.reference || '').trim().toLowerCase()))); } }
      else { onBack(); }
    } catch (e) { setMsg(e.message); setBusy(false); }
  };
  return (
    <div style={{ maxWidth: 860 }}>
      <button onClick={onBack} style={{ fontSize: 13, fontWeight: 700, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 12 }}>← Back to bookings</button>
      <h2 style={{ fontSize: 18, fontWeight: 800, color: '#050A1F', margin: '0 0 4px' }}>Add new booking</h2>
      <p style={{ fontSize: 12.5, color: '#94a3b8', marginBottom: 16 }}>Paste one or more confirmations (Viator / GetYourGuide). Review, set the time, then save.</p>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 16 }}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder="Paste booking confirmation text here…" style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 9, padding: 12, fontSize: 12.5, fontFamily: 'monospace' }} />
        <button onClick={parse} disabled={parsing} style={{ marginTop: 10, borderRadius: 9, padding: '8px 16px', fontSize: 13, fontWeight: 700, color: '#fff', background: '#050A1F', border: 'none', cursor: 'pointer' }}>{parsing ? 'Parsing…' : '✨ Parse bookings'}</button>
      </div>
      {msg && <div style={{ marginTop: 12, fontSize: 13, color: '#b45309', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 9, padding: '9px 12px' }}>{msg}</div>}
      {rows && rows.length > 0 && <>
        <div style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', margin: '22px 0 12px' }}>Parsed — review ({rows.length})</div>
        {rows.map((r, i) => (
          <div key={i} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 16, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 14, color: '#050A1F' }}>{r.reference}</b>
              <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: typeStyle(r.bookingType).bg, color: typeStyle(r.bookingType).c }}>{typeLabel(r.bookingType)}</span>
              <label style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 }}>Type
                <select value={r.bookingType || 'regular'} onChange={(e) => setRow(i, { bookingType: e.target.value })} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '4px 8px', fontSize: 12, fontWeight: 600, textTransform: 'none', color: '#334155' }}><option value="regular">Regular</option><option value="last_minute">VIP (Last minute)</option><option value="arena">Arena AudioGuided</option></select>
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <Fld label="Booking reference" v={r.reference} on={(v) => setRow(i, { reference: v })} />
              <Fld label="Travel date" v={r.travelDateLabel || r.travelDate || ''} on={(v) => setRow(i, { travelDateLabel: v })} />
              <Fld label="Lead traveler" v={r.leadTraveler || ''} on={(v) => setRow(i, { leadTraveler: v })} />
            </div>
            <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 9, padding: 12, marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ color: '#c2410c', fontSize: 12, fontWeight: 600 }}>Booked time (customer time):</span>
              <input value={r.bookedTime || ''} onChange={(e) => setRow(i, { bookedTime: e.target.value })} style={{ border: '1px solid #fed7aa', borderRadius: 8, padding: '6px 10px', fontSize: 13, width: 90, fontWeight: 700 }} />
              <span style={{ fontSize: 12, color: '#64748b', marginLeft: 'auto' }}>Product: <b style={{ color: '#050A1F' }}>{productFor(r)}</b></span>
            </div>
            <div style={{ marginTop: 12, borderTop: '1px solid #f1f5f9', paddingTop: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 8 }}>Travelers ({(r.travelers || []).length})</div>
              {(r.travelers || []).map((t, ti) => (
                <div key={ti} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr 110px', gap: 8, marginBottom: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b' }}>{t.type} - {ti + 1}</span>
                  <input value={t.firstName} onChange={(e) => setTrav(i, ti, { firstName: e.target.value })} placeholder="First name" style={inpSm} />
                  <input value={t.lastName} onChange={(e) => setTrav(i, ti, { lastName: e.target.value })} placeholder="Last name" style={inpSm} />
                  <select value={t.type} onChange={(e) => setTrav(i, ti, { type: e.target.value })} style={{ ...inpSm, background: '#fff' }}>{['Adult', 'Child', 'Infant'].map((x) => <option key={x}>{x}</option>)}</select>
                </div>
              ))}
            </div>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button onClick={saveAll} disabled={busy} style={{ borderRadius: 10, padding: '10px 24px', fontSize: 13, fontWeight: 800, color: '#fff', background: `linear-gradient(135deg,${ORANGE},#FF4500)`, border: 'none', cursor: 'pointer', opacity: busy ? 0.5 : 1 }}>{busy ? 'Saving…' : 'Save all bookings'}</button></div>
      </>}
    </div>
  );
}

function UploadOco({ id, customer, onBack }) {
  const [b, setB] = useState(null); const [busy, setBusy] = useState(false);
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const [email, setEmail] = useState(''); const [date, setDate] = useState(today);
  const [file, setFile] = useState(null); const [msg, setMsg] = useState('');
  useEffect(() => { api(`/${id}`).then(setB).catch((e) => setMsg(e.message)); }, [id]);
  const upload = async () => {
    if (!file) { setMsg('Choose the OCO PDF first.'); return; }
    setBusy(true); setMsg('');
    try {
      const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
      const r = await api(`/${id}/upload-pdf`, { method: 'POST', body: JSON.stringify({ base64: b64, bookedByEmail: email.trim(), bookedOnDate: date }) });
      setMsg(r.hasMismatch ? '⚠ Uploaded — some travelers have a mismatch. Please review with Qtonix.' : '✓ Uploaded & verified — all match.');
      setTimeout(onBack, 1400);
    } catch (e) { setMsg(e.message); setBusy(false); }
  };
  if (!b) return <div style={{ color: '#94a3b8', fontSize: 13, padding: '24px 0' }}>Loading…</div>;
  return (
    <div style={{ maxWidth: 560 }}>
      <button onClick={onBack} style={{ fontSize: 13, fontWeight: 700, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 12 }}>← Back to bookings</button>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 20 }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: '#050A1F' }}>{b.reference}</div>
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>{b.tourName || ''} · {b.leadTraveler ? titleCase(b.leadTraveler) : ''} · {b.pax} pax</div>
        <label style={lbl}>Which email did you book the ticket from?</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="e.g. bookings@yourcompany.com" style={inp} />
        <label style={lbl}>Booked on (date)</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inp} />
        <label style={lbl}>OCO ticket PDF</label>
        <label style={{ display: 'block', border: '2px dashed #c4b5fd', borderRadius: 10, color: '#6d28d9', fontWeight: 700, fontSize: 13, padding: '20px', textAlign: 'center', cursor: 'pointer' }}>{file ? `📄 ${file.name}` : '⬆ Choose PDF'}<input type="file" accept="application/pdf" style={{ display: 'none' }} onChange={(e) => { if (e.target.files[0]) setFile(e.target.files[0]); }} /></label>
        {msg && <div style={{ marginTop: 12, fontSize: 13, color: msg.startsWith('✓') ? '#15803d' : '#b45309', background: msg.startsWith('✓') ? '#f0fdf4' : '#fff7ed', border: `1px solid ${msg.startsWith('✓') ? '#bbf7d0' : '#fed7aa'}`, borderRadius: 9, padding: '9px 12px' }}>{msg}</div>}
        <button onClick={upload} disabled={busy} style={{ marginTop: 16, width: '100%', borderRadius: 10, padding: 12, fontSize: 14, fontWeight: 800, color: '#fff', background: 'linear-gradient(135deg,#8B5CF6,#6366F1)', border: 'none', cursor: 'pointer', opacity: busy ? 0.5 : 1 }}>{busy ? 'Uploading…' : 'Upload & verify'}</button>
      </div>
    </div>
  );
}

function Fld({ label, v, on }) { return <div><label style={{ ...lbl, marginTop: 0 }}>{label}</label><input value={v == null ? '' : v} onChange={(e) => on(e.target.value)} style={inpSm} /></div>; }

const lbl = { display: 'block', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', margin: '14px 0 6px' };
const inp = { width: '100%', border: '1px solid #cbd5e1', borderRadius: 9, padding: '10px 12px', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' };
const inpSm = { width: '100%', border: '1px solid #e2e8f0', borderRadius: 8, padding: '7px 10px', fontSize: 12.5, fontFamily: 'inherit', boxSizing: 'border-box' };
const th = { textAlign: 'left', padding: '11px 12px', whiteSpace: 'nowrap' };
const td = { padding: '11px 12px' };
const td2 = { padding: '7px 12px' };
const tab = (on) => ({ padding: '8px 14px', borderRadius: 9, fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer', color: on ? '#fff' : '#64748b', background: on ? '#050A1F' : '#eef1f5' });

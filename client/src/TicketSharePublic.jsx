import React, { useState, useEffect } from 'react';
import { API_BASE } from './config.js';

// Public, read-only view of the Ticket Booking module (token-gated, no login).
const titleCase = (s) => String(s || '').replace(/\b\w/g, (c) => c.toUpperCase());
const fmtDate = (iso, label) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : (label ? String(label).replace(/^[A-Za-z]{3},\s*/, '') : '—');
const typeLabel = (t) => (t === 'last_minute' ? 'VIP' : 'Regular');
const displayTime = (b) => { if (b && b.status === 'ticketed') { const t = (b.travelers || []).find((x) => x.ticketTime); if (t && t.ticketTime) return t.ticketTime; } return (b && b.bookedTime) || '—'; };

export default function TicketSharePublic() {
  const token = window.location.pathname.split('/').pop();
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState(''); const [date, setDate] = useState('');
  const [expanded, setExpanded] = useState(null);
  const api = (path) => fetch(`${API_BASE}/api/ticket-share${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`).then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Failed'); return d; });
  const load = () => { const p = new URLSearchParams(); if (q) p.set('q', q); if (date) p.set('date', date); api(`/list?${p}`).then((r) => setRows(r.bookings || [])).catch((e) => setErr(e.message)); };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q, date]);
  const dl = (b) => window.open(`${API_BASE}/api/ticket-share/${b.id}/tickets.pdf?token=${encodeURIComponent(token)}`, '_blank');
  const dlPage = (b, page) => window.open(`${API_BASE}/api/ticket-share/${b.id}/tickets.pdf?page=${page}&token=${encodeURIComponent(token)}`, '_blank');

  if (err) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui' }}><div style={{ textAlign: 'center', color: '#64748b' }}><div style={{ fontSize: 40 }}>🔗</div><div style={{ fontSize: 16, fontWeight: 700, marginTop: 8 }}>{err}</div></div></div>;

  return (
    <div style={{ minHeight: '100vh', background: '#f6f7f9', fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif' }}>
      <div style={{ background: '#050A1F', color: '#fff', padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>Qtonix<span style={{ color: '#FF6A00' }}>.</span></div>
        <span style={{ color: '#94a3b8', fontSize: 14, fontWeight: 600 }}>🎟️ Ticket Booking — shared view</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#64748b', background: 'rgba(255,255,255,.08)', borderRadius: 20, padding: '3px 10px' }}>Read-only</span>
      </div>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: 24 }}>
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Search reference, traveler…" style={{ flex: 1, minWidth: 200, border: '1px solid #e2e8f0', borderRadius: 9, padding: '9px 12px', fontSize: 13 }} />
          <label style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Travel date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ border: '1px solid #e2e8f0', borderRadius: 9, padding: '8px 12px', fontSize: 13 }} />
          {date && <button onClick={() => setDate('')} style={{ fontSize: 11.5, color: '#94a3b8', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer' }}>clear</button>}
        </div>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr style={{ background: '#f8fafc', color: '#94a3b8', fontSize: 9.5, textTransform: 'uppercase', fontWeight: 800 }}><th style={th} /><th style={th}>Reference</th><th style={th}>Type</th><th style={th}>Travel date</th><th style={th}>Time</th><th style={th}>Lead traveler</th><th style={th}>Pax</th><th style={th}>Product</th><th style={th}>Status</th></tr></thead>
            <tbody>
              {(rows || []).map((b) => { const green = b.status === 'ticketed' && !b.hasMismatch; const open = expanded === b.id; const ticketed = b.status === 'ticketed';
                return (
                  <React.Fragment key={b.id}>
                    <tr style={{ borderTop: '1px solid #f1f5f9', cursor: 'pointer', background: open ? '#f8fafc' : green ? '#f0fdf4' : undefined }} onClick={() => setExpanded(open ? null : b.id)}>
                      <td style={{ ...td, color: '#94a3b8', textAlign: 'center' }}>{open ? '▲' : '▼'}</td>
                      <td style={{ ...td, fontWeight: 700, color: '#050A1F' }}>{b.reference}</td>
                      <td style={td}><span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: b.bookingType === 'last_minute' ? '#ede9fe' : '#f1f5f9', color: b.bookingType === 'last_minute' ? '#6d28d9' : '#64748b' }}>{typeLabel(b.bookingType)}</span></td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDate(b.travelDate, b.travelDateLabel)}</td>
                      <td style={td}>{displayTime(b)}</td>
                      <td style={{ ...td, fontWeight: 600 }}>{titleCase(b.leadTraveler || '')}</td>
                      <td style={td}>{b.adults}A{b.children ? ` · ${b.children}C` : ''}</td>
                      <td style={{ ...td, color: '#64748b' }}>{b.productName || '—'}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{green ? <span style={{ color: '#16a34a', fontWeight: 700, fontSize: 11 }}>✓ {b.ocoNumber}</span> : <span style={{ color: '#94a3b8', fontSize: 11 }}>New</span>}</td>
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
              {rows && rows.length === 0 && <tr><td colSpan={9} style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No bookings.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
const th = { textAlign: 'left', padding: '11px 12px', whiteSpace: 'nowrap' };
const td = { padding: '11px 12px' };
const td2 = { padding: '7px 12px' };

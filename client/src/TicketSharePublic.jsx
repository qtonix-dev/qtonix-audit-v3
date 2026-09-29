import React, { useState, useEffect } from 'react';
import { API_BASE } from './config.js';

// Public, read-only view of the Ticket Booking module (token-gated, no login).
// Mirrors the admin "All bookings" layout: bookings grouped by travel date into
// Today / Tomorrow / dated sections, with a separate collapsed "Old bookings".
const titleCase = (s) => String(s || '').replace(/\b\w/g, (c) => c.toUpperCase());
const fmtDate = (iso, label) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : (label ? String(label).replace(/^[A-Za-z]{3},\s*/, '') : '—');
const typeLabel = (t) => (t === 'last_minute' ? 'VIP' : t === 'arena' ? 'Arena AudioGuided' : 'Regular');
const TYPE_STYLE = {
  last_minute: { bg: '#ede9fe', c: '#6d28d9' },
  arena: { bg: '#dcfce7', c: '#15803d' },
  regular: { bg: '#f1f5f9', c: '#64748b' },
};
const typeStyle = (t) => TYPE_STYLE[t] || TYPE_STYLE.regular;
const displayTime = (b) => { if (b && b.status === 'ticketed') { const t = (b.travelers || []).find((x) => x.ticketTime); if (t && t.ticketTime) return t.ticketTime; } return (b && b.bookedTime) || '—'; };

export default function TicketSharePublic() {
  const token = window.location.pathname.split('/').pop();
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState(''); const [date, setDate] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [collapsed, setCollapsed] = useState({}); // { dateKey: bool } user overrides
  const api = (path) => fetch(`${API_BASE}/api/ticket-share${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`).then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Failed'); return d; });
  const load = () => { const p = new URLSearchParams(); if (q) p.set('q', q); if (date) p.set('date', date); api(`/list?${p}`).then((r) => setRows(r.bookings || [])).catch((e) => setErr(e.message)); };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q, date]);
  const dl = (b) => window.open(`${API_BASE}/api/ticket-share/${b.id}/tickets.pdf?token=${encodeURIComponent(token)}`, '_blank');
  const dlPage = (b, page) => window.open(`${API_BASE}/api/ticket-share/${b.id}/tickets.pdf?page=${page}&token=${encodeURIComponent(token)}`, '_blank');

  // Date grouping — same rules as the admin list: past travel dates go under a
  // collapsed "Old bookings"; upcoming dates each get their own section; after
  // 7PM IST today's section auto-collapses.
  const istNow = new Date(Date.now() + 330 * 60000);
  const istToday = istNow.toISOString().slice(0, 10);
  const istTomorrow = new Date(istNow.getTime() + 864e5).toISOString().slice(0, 10);
  const isAfter7 = (istNow.getUTCHours() * 60 + istNow.getUTCMinutes()) >= (13 * 60 + 30); // 19:00 IST
  const grouped = React.useMemo(() => {
    const g = {}; const old = [];
    (rows || []).forEach((b) => { const d = b.travelDate || 'no-date'; if (d !== 'no-date' && d < istToday) old.push(b); else (g[d] = g[d] || []).push(b); });
    return { dates: Object.keys(g).sort(), g, old };
  }, [rows, istToday]);
  const autoCollapsed = (d) => isAfter7 && d === istToday;
  const isCollapsed = (d) => (collapsed[d] !== undefined ? collapsed[d] : autoCollapsed(d));
  const dateHeading = (d) => { if (d === istToday) return `Today · ${fmtDate(d)}`; if (d === istTomorrow) return `Tomorrow · ${fmtDate(d)}`; if (d === 'no-date') return 'No travel date'; return fmtDate(d); };

  if (err) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui' }}><div style={{ textAlign: 'center', color: '#64748b' }}><div style={{ fontSize: 40 }}>🔗</div><div style={{ fontSize: 16, fontWeight: 700, marginTop: 8 }}>{err}</div></div></div>;

  const TH = () => <thead><tr style={{ background: '#f8fafc', color: '#94a3b8', fontSize: 9.5, textTransform: 'uppercase', fontWeight: 800 }}><th style={th} /><th style={th}>Reference</th><th style={th}>Type</th><th style={th}>Travel date</th><th style={th}>Time</th><th style={th}>Lead traveler</th><th style={th}>Pax</th><th style={th}>Product</th><th style={th}>Status</th></tr></thead>;

  const renderRow = (b) => {
    const green = b.status === 'ticketed' && !b.hasMismatch; const open = expanded === b.id; const ticketed = b.status === 'ticketed';
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
  };

  const Section = ({ label, list, dkey, defaultOpen }) => {
    const col = collapsed[dkey] !== undefined ? collapsed[dkey] : !defaultOpen;
    return (
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden', marginBottom: 12 }}>
        <button onClick={() => setCollapsed((s) => ({ ...s, [dkey]: !col }))} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: '#f8fafc', border: 'none', borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#050A1F' }}>{label} <span style={{ color: '#94a3b8', fontWeight: 600 }}>· {list.length}</span></span>
          <span style={{ color: '#94a3b8', fontSize: 12 }}>{col ? '▼ show' : '▲ hide'}</span>
        </button>
        {!col && <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}><TH /><tbody>{list.map((b) => renderRow(b))}</tbody></table></div>}
      </div>
    );
  };

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

        {rows === null ? (
          <div style={{ color: '#94a3b8', fontSize: 13, padding: '24px 0' }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '40px 16px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No bookings.</div>
        ) : (
          <div>
            {grouped.dates.map((d) => <Section key={d} dkey={d} label={dateHeading(d)} list={grouped.g[d]} defaultOpen={!isCollapsed(d)} />)}
            {grouped.old.length > 0 && <Section dkey="__old" label="🗂 Old bookings" list={grouped.old} defaultOpen={false} />}
          </div>
        )}
      </div>
    </div>
  );
}
const th = { textAlign: 'left', padding: '11px 12px', whiteSpace: 'nowrap' };
const td = { padding: '11px 12px' };
const td2 = { padding: '7px 12px' };

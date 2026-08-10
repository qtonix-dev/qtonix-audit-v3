import React, { useEffect, useState } from 'react';
import { api } from './App.jsx';

// Bulk email history. Agents see their own campaigns; managers/admins see all.
// The list shows each send with its counts; opening one shows the header stats
// (sent date/time, template, sent/read/unread) and a per-recipient table with a
// green double-tick for read and a gray double-tick for unread.
export default function BulkEmailPage({ user }) {
  const [rows, setRows] = useState(null);
  const [openId, setOpenId] = useState(null);

  useEffect(() => { api('/gmail/bulk').then(setRows).catch(() => setRows([])); }, []);

  if (openId) return <BulkDetail id={openId} onBack={() => setOpenId(null)} />;

  return (
    <div className="max-w-5xl mx-auto px-6 py-6" style={{ fontFamily: "'Plus Jakarta Sans',system-ui,sans-serif" }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-2xl font-black text-[#050A1F]">Bulk email</div>
          <div className="text-sm text-slate-500">Newsletter-style sends to multiple leads. Select leads on the Leads page and click Email to start one.</div>
        </div>
      </div>

      {rows === null ? (
        <div className="text-slate-400 text-sm py-12 text-center">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-slate-400 text-sm py-16 text-center bg-white rounded-2xl border border-slate-100">
          <div className="text-4xl mb-2">📧</div>
          No bulk emails yet. Select leads on the Leads page and click <b>Email</b>.
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50/80 text-[10px] uppercase tracking-wider text-slate-400 font-bold border-b border-slate-100">
                <th className="text-left px-4 py-3">Sent</th>
                <th className="text-left px-4 py-3">Template</th>
                {user.role !== 'agent' && <th className="text-left px-4 py-3">By</th>}
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-center px-4 py-3">Sent</th>
                <th className="text-center px-4 py-3">Read</th>
                <th className="text-center px-4 py-3">Unread</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id} onClick={() => setOpenId(r._id)} className="border-t border-slate-50 hover:bg-blue-50/30 cursor-pointer">
                  <td className="px-4 py-3">
                    <div className="font-bold text-[#050A1F]">{fmtDate(r.scheduledFor || r.createdAt)}</div>
                    <div className="text-[11px] text-slate-400">{fmtTime(r.scheduledFor || r.createdAt)}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{r.templateName || '(custom)'}</td>
                  {user.role !== 'agent' && <td className="px-4 py-3 text-slate-500">{r.userName}</td>}
                  <td className="px-4 py-3"><StatusPill status={r.status} /></td>
                  <td className="px-4 py-3 text-center font-bold text-[#050A1F]">{r.sentCount}</td>
                  <td className="px-4 py-3 text-center font-bold text-green-600">{r.readCount}</td>
                  <td className="px-4 py-3 text-center font-bold text-slate-400">{r.unreadCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BulkDetail({ id, onBack }) {
  const [c, setC] = useState(null);
  useEffect(() => { api(`/gmail/bulk/${id}`).then(setC).catch(() => setC(false)); }, [id]);

  if (c === null) return <div className="max-w-5xl mx-auto px-6 py-12 text-slate-400 text-sm">Loading…</div>;
  if (c === false) return <div className="max-w-5xl mx-auto px-6 py-12 text-slate-400 text-sm">Campaign not found. <button onClick={onBack} className="text-blue-600 font-bold">Back</button></div>;

  return (
    <div className="max-w-5xl mx-auto px-6 py-6" style={{ fontFamily: "'Plus Jakarta Sans',system-ui,sans-serif" }}>
      <button onClick={onBack} className="text-sm font-bold text-slate-500 hover:text-[#050A1F] mb-3">← Back to bulk email</button>

      {/* Header stats */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 mb-4">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="text-xl font-black text-[#050A1F]">{c.templateName || '(custom)'}</div>
            <div className="text-sm text-slate-500 mt-0.5">{c.subject || '(no subject)'}</div>
            <div className="text-[12px] text-slate-400 mt-1">
              {c.status === 'scheduled' ? 'Scheduled for ' : 'Sent '}
              {fmtDate(c.scheduledFor || c.createdAt)} at {fmtTime(c.scheduledFor || c.createdAt)}
              {c.userName ? ` · by ${c.userName}` : ''}
            </div>
          </div>
          <div className="flex gap-6">
            <Stat label="Sent" value={c.sentCount} color="#050A1F" />
            <Stat label="Read" value={c.readCount} color="#16A34A" />
            <Stat label="Unread" value={c.unreadCount} color="#94A3B8" />
          </div>
        </div>
      </div>

      {/* Recipient table */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50/80 text-[10px] uppercase tracking-wider text-slate-400 font-bold border-b border-slate-100">
              <th className="text-left px-4 py-3">Lead</th>
              <th className="text-left px-4 py-3">Domain</th>
              <th className="text-left px-4 py-3">Email</th>
              <th className="text-left px-4 py-3">Preview</th>
              <th className="text-center px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {(c.recipients || []).map((r, i) => (
              <tr key={i} className="border-t border-slate-50">
                <td className="px-4 py-3 font-bold text-[#050A1F]">{r.leadName}</td>
                <td className="px-4 py-3 text-slate-500">{r.domain || '—'}</td>
                <td className="px-4 py-3 text-slate-500">{r.email || '—'}</td>
                <td className="px-4 py-3 text-slate-400 max-w-[280px]"><div className="truncate">{r.preview || '—'}</div></td>
                <td className="px-4 py-3 text-center">
                  {r.status === 'failed'
                    ? <span title={r.error} className="text-red-500 text-[11px] font-bold">Failed</span>
                    : <ReadTick read={r.read} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Double-tick: green when read, gray when unread (WhatsApp-style).
function ReadTick({ read }) {
  const color = read ? '#16A34A' : '#94A3B8';
  return (
    <span title={read ? 'Read' : 'Unread'} className="inline-flex items-center">
      <svg width="22" height="14" viewBox="0 0 22 14" fill="none">
        <path d="M1 7.5 L4.5 11 L11 3" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 7.5 L11.5 11 L18 3" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function Stat({ label, value, color }) {
  return (
    <div className="text-center">
      <div className="text-2xl font-black" style={{ color }}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400 font-bold">{label}</div>
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    sent: ['Sent', 'bg-green-100 text-green-700'],
    scheduled: ['Scheduled', 'bg-blue-100 text-blue-700'],
    sending: ['Sending', 'bg-amber-100 text-amber-700'],
    failed: ['Failed', 'bg-red-100 text-red-700'],
  };
  const [label, cls] = map[status] || [status, 'bg-slate-100 text-slate-500'];
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${cls}`}>{label}</span>;
}

function fmtDate(d) { try { return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return '—'; } }
function fmtTime(d) { try { return new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } }

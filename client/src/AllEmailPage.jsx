import React, { useEffect, useState, useCallback } from 'react';
import { api } from './App.jsx';
import { MailEditor } from './Leads.jsx';

// System folders shown in the left rail, in Gmail's order.
const FOLDERS = [
  { id: 'INBOX', label: 'Inbox', icon: 'M3 7l9 6 9-6M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7M3 7l9 6 9-6' },
  { id: 'STARRED', label: 'Starred', icon: 'M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.8 5.9 20.4l1.4-6.8L2.2 9l6.9-.7z' },
  { id: 'SENT', label: 'Sent', icon: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z' },
  { id: 'SPAM', label: 'Spam', icon: 'M12 2l9 4v6c0 5-3.8 8.7-9 10-5.2-1.3-9-5-9-10V6z' },
  { id: 'TRASH', label: 'Trash', icon: 'M4 7h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M6 7l1 13a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 17 20l1-13' },
  { id: 'ALL', label: 'All Mail', icon: 'M3 5h18v14H3zM3 5l9 8 9-8' },
];

// Gmail label-color swatches (a subset of the palette Gmail accepts).
const LABEL_COLORS = [
  { bg: '#fb4c2f', fg: '#ffffff' }, { bg: '#ffad47', fg: '#000000' }, { bg: '#fad165', fg: '#000000' },
  { bg: '#16a765', fg: '#ffffff' }, { bg: '#43d692', fg: '#000000' }, { bg: '#4a86e8', fg: '#ffffff' },
  { bg: '#a479e2', fg: '#ffffff' }, { bg: '#f691b3', fg: '#000000' }, { bg: '#cccccc', fg: '#000000' },
];

const fmtDate = (d) => {
  const dt = new Date(d); const now = new Date();
  const sameDay = dt.toDateString() === now.toDateString();
  return sameDay ? dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

export default function AllEmailPage({ user }) {
  const [mailboxes, setMailboxes] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [as, setAs] = useState(''); // selected mailbox userId (admin can switch)
  const [box, setBox] = useState('INBOX');
  const [labelId, setLabelId] = useState(null);
  const [labels, setLabels] = useState([]);
  const [messages, setMessages] = useState([]);
  const [nextPage, setNextPage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [openThread, setOpenThread] = useState(null); // {threadId, subject}
  const [showNewLabel, setShowNewLabel] = useState(false);
  const [labelMenuFor, setLabelMenuFor] = useState(null); // gmailMessageId
  const [notConnected, setNotConnected] = useState(false);
  const [composer, setComposer] = useState(null); // { mode, to, cc, subject, body, threadId, inReplyTo }

  const asParam = as ? `&as=${as}` : '';

  const loadMailboxes = useCallback(async () => {
    try {
      const d = await api('/gmail/all/mailboxes');
      setMailboxes(d.mailboxes || []); setIsAdmin(d.isAdmin);
      if (!d.mailboxes || d.mailboxes.length === 0) setNotConnected(true);
    } catch (e) { setErr(e.message); }
  }, []);

  const loadLabels = useCallback(async () => {
    try {
      const d = await api(`/gmail/all/labels?1=1${asParam}`);
      // Custom labels only (system ones are the folders in the rail).
      setLabels((d.labels || []).filter((l) => l.type === 'user'));
    } catch (e) { /* labels are best-effort */ }
  }, [as]);

  const loadFolder = useCallback(async (reset = true) => {
    setLoading(true); setErr('');
    try {
      const params = new URLSearchParams();
      params.set('box', labelId ? 'LABEL' : box);
      if (labelId) params.set('labelId', labelId);
      if (q) params.set('q', q);
      if (as) params.set('as', as);
      if (!reset && nextPage) params.set('pageToken', nextPage);
      const d = await api(`/gmail/all/folder?${params.toString()}`);
      setMessages((prev) => reset ? (d.messages || []) : [...prev, ...(d.messages || [])]);
      setNextPage(d.nextPageToken || null);
    } catch (e) { setErr(e.message); if (/connected mailbox/i.test(e.message)) setNotConnected(true); }
    finally { setLoading(false); }
  }, [box, labelId, q, as, nextPage]);

  useEffect(() => { loadMailboxes(); }, [loadMailboxes]);
  useEffect(() => { loadLabels(); }, [loadLabels]);
  useEffect(() => { loadFolder(true); /* eslint-disable-next-line */ }, [box, labelId, as]);

  const pickFolder = (id) => { setLabelId(null); setBox(id); setMessages([]); };
  const pickLabel = (id) => { setBox(''); setLabelId(id); setMessages([]); };

  const createLabel = async (name, color) => {
    try {
      await api('/gmail/all/labels', { method: 'POST', body: JSON.stringify({ name, color: color ? { backgroundColor: color.bg, textColor: color.fg } : undefined, as }) });
      setShowNewLabel(false); loadLabels();
    } catch (e) { setErr(e.message); }
  };
  const deleteLabel = async (id) => {
    if (!confirm('Delete this label? It will be removed from all emails in Gmail.')) return;
    try { await api(`/gmail/all/labels/${id}?${as ? `as=${as}` : ''}`, { method: 'DELETE' }); if (labelId === id) pickFolder('INBOX'); loadLabels(); }
    catch (e) { setErr(e.message); }
  };

  const applyLabel = async (msg, lid, has) => {
    try {
      await api(`/gmail/all/message/${msg.gmailMessageId}/labels`, { method: 'POST', body: JSON.stringify({ add: has ? [] : [lid], remove: has ? [lid] : [], as }) });
      setMessages((prev) => prev.map((m) => m.gmailMessageId === msg.gmailMessageId
        ? { ...m, labelIds: has ? m.labelIds.filter((x) => x !== lid) : [...(m.labelIds || []), lid] } : m));
    } catch (e) { setErr(e.message); }
  };

  const toggleStar = async (msg) => {
    const starred = !msg.starred;
    try {
      await api(`/gmail/all/message/${msg.gmailMessageId}/star`, { method: 'POST', body: JSON.stringify({ starred, as }) });
      setMessages((prev) => prev.map((m) => m.gmailMessageId === msg.gmailMessageId ? { ...m, starred } : m));
    } catch (e) { setErr(e.message); }
  };

  const deleteMessage = async (msg) => {
    if (msg.leadId) return;
    if (!confirm('Move this email to Trash in Gmail?')) return;
    try {
      await api(`/gmail/all/message/${msg.gmailMessageId}?${as ? `as=${as}` : ''}`, { method: 'DELETE' });
      setMessages((prev) => prev.filter((m) => m.gmailMessageId !== msg.gmailMessageId));
    } catch (e) { setErr(e.message); }
  };

  if (notConnected) {
    return (
      <div className="max-w-xl mx-auto text-center py-20">
        <div className="text-4xl mb-3">✉️</div>
        <div className="text-lg font-bold text-[#050A1F]">No mailbox connected</div>
        <div className="text-sm text-slate-500 mt-1">Connect your Gmail in the profile menu → Email settings to browse your mail here.</div>
      </div>
    );
  }

  const labelById = Object.fromEntries(labels.map((l) => [l.id, l]));

  return (
    <div className="flex gap-4 h-[calc(100vh-140px)]" style={{ fontFamily: "'Plus Jakarta Sans',system-ui,sans-serif" }}>
      {/* Left rail */}
      <div className="w-56 flex-shrink-0 flex flex-col">
        <button onClick={() => setComposer({ mode: 'new', to: [], cc: [], bcc: [], subject: '', body: '', threadId: null, inReplyTo: null })}
          className="mb-3 inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-bold text-white shadow-sm" style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          Compose
        </button>
        {isAdmin && mailboxes.length > 0 && (
          <select value={as} onChange={(e) => { setAs(e.target.value); setMessages([]); }} className="mb-3 rounded-lg border border-slate-300 px-2.5 py-2 text-xs">
            {mailboxes.map((m) => <option key={m.value} value={m.value === String(user.id) ? '' : m.value}>{m.label} ({m.email})</option>)}
          </select>
        )}
        <div className="space-y-0.5">
          {FOLDERS.map((f) => (
            <button key={f.id} onClick={() => pickFolder(f.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold text-left transition ${!labelId && box === f.id ? 'bg-orange-50 text-[#FF4500]' : 'text-slate-600 hover:bg-slate-100'}`}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d={f.icon} /></svg>
              {f.label}
            </button>
          ))}
        </div>

        {/* Labels */}
        <div className="mt-4">
          <div className="flex items-center justify-between px-3 mb-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Labels</span>
            <button onClick={() => setShowNewLabel(true)} title="Create label" className="text-slate-400 hover:text-[#FF4500]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
            </button>
          </div>
          <div className="space-y-0.5 max-h-64 overflow-auto">
            {labels.map((l) => (
              <div key={l.id} className={`group flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm cursor-pointer ${labelId === l.id ? 'bg-orange-50 text-[#FF4500]' : 'text-slate-600 hover:bg-slate-100'}`} onClick={() => pickLabel(l.id)}>
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: (l.color && l.color.backgroundColor) || '#94a3b8' }} />
                <span className="truncate flex-1">{l.name}</span>
                <button onClick={(e) => { e.stopPropagation(); deleteLabel(l.id); }} className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></svg></button>
              </div>
            ))}
            {labels.length === 0 && <div className="px-3 text-[11px] text-slate-400">No labels yet.</div>}
          </div>
        </div>
      </div>

      {/* Message list */}
      <div className="flex-1 bg-white rounded-2xl border border-slate-100 flex flex-col min-w-0">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 flex-shrink-0">
          <div className="relative flex-1">
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadFolder(true)}
              placeholder="Search mail…" className="w-full rounded-lg bg-slate-100 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-300" />
          </div>
          <button onClick={() => loadFolder(true)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">Refresh</button>
        </div>

        {err && <div className="mx-4 mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{err}</div>}

        <div className="flex-1 overflow-auto">
          {loading && messages.length === 0 && <div className="text-slate-400 text-sm py-16 text-center">Loading…</div>}
          {!loading && messages.length === 0 && <div className="text-slate-400 text-sm py-16 text-center">No emails in this folder.</div>}
          {messages.map((m) => (
            <div key={m.gmailMessageId}
              onClick={() => setOpenThread({ threadId: m.threadId, subject: m.subject })}
              className={`flex items-center gap-3 px-4 py-2.5 border-b border-slate-50 cursor-pointer hover:bg-slate-50 ${!m.isRead ? 'bg-blue-50/30' : ''}`}>
              <button onClick={(e) => { e.stopPropagation(); toggleStar(m); }} title="Star" className="flex-shrink-0 text-slate-300 hover:text-amber-400">
                <svg width="16" height="16" viewBox="0 0 24 24" fill={m.starred ? '#FBBF24' : 'none'} stroke={m.starred ? '#FBBF24' : 'currentColor'} strokeWidth="1.6"><path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.8 5.9 20.4l1.4-6.8L2.2 9l6.9-.7z" /></svg>
              </button>
              <div className={`w-44 truncate text-sm flex-shrink-0 ${!m.isRead ? 'font-bold text-[#050A1F]' : 'text-slate-600'}`}>
                {m.direction === 'outbound' ? `To: ${m.toEmail || '—'}` : (m.fromName || m.fromEmail)}
              </div>
              <div className="flex-1 min-w-0 flex items-center gap-2">
                <span className={`text-sm truncate ${!m.isRead ? 'font-semibold text-[#050A1F]' : 'text-slate-500'}`}>{m.subject || '(no subject)'}</span>
                <span className="text-xs text-slate-400 truncate">— {m.snippet}</span>
                {(m.labelIds || []).filter((id) => labelById[id]).map((id) => (
                  <span key={id} className="text-[9px] font-bold rounded px-1.5 py-0.5 flex-shrink-0" style={{ background: (labelById[id].color && labelById[id].color.backgroundColor) || '#e2e8f0', color: (labelById[id].color && labelById[id].color.textColor) || '#334155' }}>{labelById[id].name}</span>
                ))}
              </div>
              {m.hasAttachments && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-slate-400 flex-shrink-0"><path d="M21 12l-9 9a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8" /></svg>}
              <span className="text-xs text-slate-400 w-16 text-right flex-shrink-0">{fmtDate(m.sentAt)}</span>
              {/* Label + delete actions */}
              <div className="relative flex items-center gap-1 flex-shrink-0">
                <button onClick={(e) => { e.stopPropagation(); setLabelMenuFor(labelMenuFor === m.gmailMessageId ? null : m.gmailMessageId); }} title="Label" className="text-slate-300 hover:text-slate-600 p-1">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0l-6.2-6.2a2 2 0 0 1 0-2.8l7.2-7.2a2 2 0 0 1 1.4-.6H20a1 1 0 0 1 1 1v6.2a2 2 0 0 1-.4 1.2z" /><circle cx="16.5" cy="7.5" r="1" /></svg>
                </button>
                {labelMenuFor === m.gmailMessageId && (
                  <div onClick={(e) => e.stopPropagation()} className="absolute right-0 top-7 w-48 bg-white rounded-xl border border-slate-200 shadow-lg py-1.5 z-50 max-h-56 overflow-auto">
                    <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase">Apply label</div>
                    {labels.length === 0 && <div className="px-3 py-1.5 text-xs text-slate-400">Create a label first.</div>}
                    {labels.map((l) => {
                      const has = (m.labelIds || []).includes(l.id);
                      return (
                        <button key={l.id} onClick={() => applyLabel(m, l.id, has)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-slate-50 text-left">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ background: (l.color && l.color.backgroundColor) || '#94a3b8' }} />
                          <span className="flex-1 truncate">{l.name}</span>
                          {has && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#16a765" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>}
                        </button>
                      );
                    })}
                  </div>
                )}
                {!m.leadId ? (
                  <button onClick={(e) => { e.stopPropagation(); deleteMessage(m); }} title="Delete" className="text-slate-300 hover:text-red-500 p-1">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></svg>
                  </button>
                ) : (
                  <span title="Linked to a lead" className="text-slate-300 p-1"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></svg></span>
                )}
              </div>
            </div>
          ))}
          {nextPage && (
            <div className="text-center py-3">
              <button onClick={() => loadFolder(false)} disabled={loading} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">{loading ? 'Loading…' : 'Load more'}</button>
            </div>
          )}
        </div>
      </div>

      {openThread && <AllEmailThread threadId={openThread.threadId} subject={openThread.subject} as={as} onClose={() => setOpenThread(null)}
        onReply={(payload) => setComposer(payload)} />}
      {showNewLabel && <NewLabelModal onClose={() => setShowNewLabel(false)} onCreate={createLabel} />}
      {composer && <AllEmailComposer initial={composer} as={as}
        signature={(mailboxes.find((m) => (m.value === (as || String(user.id))))?.signature) || ''}
        onClose={() => setComposer(null)}
        onSent={() => { setComposer(null); loadFolder(true); }} />}
    </div>
  );
}

// Read-only thread viewer for All Email (fetched live from the browsed mailbox).
function AllEmailThread({ threadId, subject, as, onClose, onReply }) {
  const [messages, setMessages] = useState(null);
  const [err, setErr] = useState('');
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    api(`/gmail/all/thread/${threadId}?${as ? `as=${as}` : ''}`).then((d) => {
      const msgs = d.messages || [];
      setMessages(msgs);
      const exp = {}; msgs.forEach((m, i) => { exp[m.gmailMessageId || i] = i === msgs.length - 1; });
      setExpanded(exp);
    }).catch((e) => setErr(e.message));
  }, [threadId, as]);

  const latest = messages && messages.length ? messages[messages.length - 1] : null;

  // Build a quoted chain so the reply keeps context.
  const quote = (msg) => {
    const when = new Date(msg.sentAt).toLocaleString();
    const who = `${msg.fromName || ''} <${msg.fromEmail || ''}>`.trim();
    const inner = msg.bodyHtml || `<div style="white-space:pre-wrap">${(msg.bodyText || msg.snippet || '')}</div>`;
    return `<br><br><div style="border-left:2px solid #ccc;padding-left:10px;color:#555"><div>On ${when}, ${who} wrote:</div>${inner}</div>`;
  };

  const doReply = (mode) => {
    if (!latest) return;
    const recipients = mode === 'replyall'
      ? [...new Set([latest.fromEmail, ...String(latest.toEmail || '').split(',').map((x) => x.trim())].filter(Boolean))]
      : [latest.direction === 'inbound' ? latest.fromEmail : (String(latest.toEmail || '').split(',')[0] || '').trim()];
    onReply({
      mode, to: recipients.filter(Boolean), cc: [], bcc: [],
      subject: /^re:/i.test(subject || '') ? subject : `Re: ${subject || ''}`,
      body: quote(latest), threadId, inReplyTo: latest.rfcMessageId || undefined,
    });
    onClose();
  };
  const doForward = () => {
    if (!latest) return;
    onReply({
      mode: 'forward', to: [], cc: [], bcc: [],
      subject: /^fwd:/i.test(subject || '') ? subject : `Fwd: ${subject || ''}`,
      body: `<br><br>---------- Forwarded message ----------<br>From: ${latest.fromName || latest.fromEmail}<br>Subject: ${subject || ''}<br><br>${latest.bodyHtml || latest.snippet || ''}`,
      threadId: null, inReplyTo: null,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-[70] p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-3xl my-6 flex flex-col max-h-[88vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <h2 className="text-lg font-normal text-[#202124] pr-4 break-words">{subject || '(no subject)'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none flex-shrink-0">×</button>
        </div>
        <div className="px-6 py-4 overflow-y-auto flex-1">
          {err && <div className="mb-3 text-xs text-red-600">{err}</div>}
          {!messages && <div className="text-slate-400 text-sm py-6 text-center">Loading…</div>}
          {messages && messages.map((m, i) => {
            const k = m.gmailMessageId || i; const isOpen = !!expanded[k];
            return (
              <div key={k} className={`py-3 ${i > 0 ? 'border-t border-slate-100' : ''}`}>
                <div className="flex items-start gap-3 cursor-pointer" onClick={() => setExpanded((e) => ({ ...e, [k]: !e[k] }))}>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0" style={{ background: m.direction === 'outbound' ? '#FF6A0022' : '#6366F122', color: m.direction === 'outbound' ? '#FF4500' : '#4F46E5' }}>
                    {(m.fromName || m.fromEmail || '?').trim()[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-bold text-[#202124] truncate">{m.fromName || m.fromEmail}</div>
                      <div className="text-xs text-slate-400 flex-shrink-0">{new Date(m.sentAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
                    </div>
                    {!isOpen && <div className="text-xs text-slate-400 truncate">{m.snippet}</div>}
                  </div>
                </div>
                {isOpen && (
                  <div className="mt-2 pl-12">
                    <div className="text-sm text-slate-700 prose prose-sm max-w-none break-words overflow-x-auto" dangerouslySetInnerHTML={{ __html: m.bodyHtml || `<div style="white-space:pre-wrap">${(m.bodyText || m.snippet || '').replace(/</g, '&lt;')}</div>` }} />
                    {(m.attachments || []).length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {m.attachments.map((a, ai) => (
                          <span key={ai} className="inline-flex items-center gap-1.5 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-600">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
                            {a.filename}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {/* Sticky reply bar */}
        {latest && (
          <div className="flex gap-2 px-6 py-3 border-t border-slate-100 flex-shrink-0 bg-white rounded-b-xl">
            <button onClick={() => doReply('reply')} className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 17l-5-5 5-5M4 12h11a5 5 0 0 1 5 5v1" /></svg> Reply
            </button>
            <button onClick={() => doReply('replyall')} className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M7 17l-5-5 5-5M12 17l-5-5 5-5M9 12h9a4 4 0 0 1 4 4v1" /></svg> Reply all
            </button>
            <button onClick={doForward} className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M15 17l5-5-5-5M20 12H9a5 5 0 0 0-5 5v1" /></svg> Forward
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Full compose/reply/forward for All Email — sends from the browsed mailbox.
function AllEmailComposer({ initial, as, signature, onClose, onSent }) {
  const [to, setTo] = useState(initial.to || []);
  const [cc, setCc] = useState(initial.cc || []);
  const [bcc, setBcc] = useState(initial.bcc || []);
  const [showCc, setShowCc] = useState((initial.cc || []).length > 0);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState(initial.subject || '');
  const [body, setBody] = useState(initial.body || '');
  const [attachments, setAttachments] = useState([]); // {filename,mimeType,contentBase64}
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const fileInput = React.useRef(null);

  const onFile = (e) => {
    const files = Array.from(e.target.files || []);
    files.forEach((f) => {
      const reader = new FileReader();
      reader.onload = () => {
        const b64 = String(reader.result).split(',')[1];
        setAttachments((prev) => [...prev, { filename: f.name, mimeType: f.type || 'application/octet-stream', contentBase64: b64 }]);
      };
      reader.readAsDataURL(f);
    });
    e.target.value = '';
  };
  const removeAtt = (i) => setAttachments((prev) => prev.filter((_, idx) => idx !== i));
  const insertSignature = () => { if (signature) setBody((b) => `${b}<br><br>${signature}`); };

  const send = async () => {
    setErr('');
    if (to.length === 0) return setErr('Add at least one recipient.');
    if (!subject.trim()) return setErr('Add a subject.');
    setSending(true);
    try {
      await api('/gmail/all/send', { method: 'POST', body: JSON.stringify({
        to, cc: cc.join(', '), bcc: bcc.join(', '), subject, body,
        threadId: initial.threadId || undefined, inReplyTo: initial.inReplyTo || undefined,
        attachments, as: as || undefined,
      }) });
      onSent();
    } catch (e) { setErr(e.message); setSending(false); }
  };

  const title = initial.mode === 'forward' ? 'Forward' : initial.mode === 'replyall' ? 'Reply all' : initial.mode === 'reply' ? 'Reply' : 'New message';

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-[80] p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-2xl shadow-2xl my-6 flex flex-col max-h-[88vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#050A1F] text-white rounded-t-xl flex-shrink-0">
          <span className="text-sm font-semibold">{title}</span>
          <button onClick={onClose} className="text-slate-300 hover:text-white text-lg leading-none">×</button>
        </div>
        <div className="px-5 pt-3 space-y-2 overflow-y-auto flex-1 min-h-0">
          {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{err}</div>}
          <div className="flex items-start gap-2 border-b border-slate-100 pb-2">
            <span className="text-xs text-slate-400 w-12 pt-1.5">To</span>
            <div className="flex-1"><ChipInput value={to} onChange={setTo} placeholder="Recipients" /></div>
            <div className="flex gap-2 pt-1.5 text-xs font-semibold text-slate-400">
              {!showCc && <button onClick={() => setShowCc(true)}>Cc</button>}
              {!showBcc && <button onClick={() => setShowBcc(true)}>Bcc</button>}
            </div>
          </div>
          {showCc && <div className="flex items-start gap-2 border-b border-slate-100 pb-2"><span className="text-xs text-slate-400 w-12 pt-1.5">Cc</span><div className="flex-1"><ChipInput value={cc} onChange={setCc} placeholder="Cc" /></div></div>}
          {showBcc && <div className="flex items-start gap-2 border-b border-slate-100 pb-2"><span className="text-xs text-slate-400 w-12 pt-1.5">Bcc</span><div className="flex-1"><ChipInput value={bcc} onChange={setBcc} placeholder="Bcc" /></div></div>}
          <div className="border-b border-slate-100 pb-2">
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="w-full text-sm text-slate-700 outline-none" />
          </div>
          <div className="py-1">
            <MailEditor value={body} onChange={setBody} placeholder="Write your message…" minHeight={220}
              onAttach={() => fileInput.current?.click()} onInsertSignature={signature ? insertSignature : undefined} />
          </div>
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 pb-2">
              {attachments.map((a, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-600">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
                  {a.filename}
                  <button onClick={() => removeAtt(i)} className="text-slate-400 hover:text-red-500 ml-1">×</button>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 px-5 py-3 flex-shrink-0 border-t border-slate-100 bg-white rounded-b-xl">
          <button onClick={send} disabled={sending} className="rounded-full px-6 py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: '#1A73E8' }}>{sending ? 'Sending…' : 'Send'}</button>
          <button onClick={() => fileInput.current?.click()} title="Attach file" className="p-2 rounded-full hover:bg-slate-100 text-slate-500">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 12l-9 9a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8" /></svg>
          </button>
          <input ref={fileInput} type="file" multiple className="hidden" onChange={onFile} />
        </div>
      </div>
    </div>
  );
}

// Minimal recipient chip input (comma/enter to add).
function ChipInput({ value, onChange, placeholder }) {
  const [text, setText] = useState('');
  const add = () => { const v = text.trim().replace(/,$/, ''); if (v) { onChange([...value, v]); setText(''); } };
  return (
    <div className="flex flex-wrap items-center gap-1">
      {value.map((chip, i) => (
        <span key={i} className="inline-flex items-center gap-1 bg-slate-100 rounded-full px-2 py-0.5 text-xs text-slate-700">
          {chip}
          <button onClick={() => onChange(value.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-red-500">×</button>
        </span>
      ))}
      <input value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1)); }}
        onBlur={add} placeholder={value.length === 0 ? placeholder : ''} className="flex-1 min-w-[120px] text-sm outline-none py-1" />
    </div>
  );
}

function NewLabelModal({ onClose, onCreate }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(LABEL_COLORS[5]);
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[80] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-extrabold text-[#050A1F] mb-3">New label</h3>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Label name" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm mb-3" autoFocus />
        <div className="text-xs font-semibold text-slate-500 mb-1.5">Color</div>
        <div className="flex flex-wrap gap-2 mb-4">
          {LABEL_COLORS.map((c) => (
            <button key={c.bg} onClick={() => setColor(c)} className={`w-7 h-7 rounded-full ${color.bg === c.bg ? 'ring-2 ring-offset-2 ring-[#050A1F]' : ''}`} style={{ background: c.bg }} />
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={() => name.trim() && onCreate(name.trim(), color)} className="rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ background: '#050A1F' }}>Create</button>
        </div>
      </div>
    </div>
  );
}

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE } from './config.js';
import { toast, confirmDialog } from './toast';

// Pastel palette (Google-Keep-like).
const COLORS = {
  yellow: '#FEF3C7', blue: '#DBEAFE', green: '#DCFCE7', pink: '#FCE7F3',
  red: '#FEE2E2', purple: '#EDE9FE', teal: '#CCFBF1', white: '#FFFFFF',
};
const COLOR_KEYS = Object.keys(COLORS);
const FONT_PX = { small: '13px', medium: '14.5px', large: '17px' };
const titleCase = (s) => String(s || '').replace(/\b\w/g, (c) => c.toUpperCase());
const timeAgo = (d) => {
  if (!d) return '';
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const days = Math.floor(s / 86400);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// `base` is '/sticky-notes' (CRM) or '/hr/sticky-notes' (HRMS). `token` key differs.
export default function StickyNotes({ base = '/sticky-notes', tokenKey = 'qtx_token', onClose }) {
  const api = useCallback(async (path, opts = {}) => {
    const token = localStorage.getItem(tokenKey);
    const res = await fetch(`${API_BASE}/api${base}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }, [base, tokenKey]);

  const [notes, setNotes] = useState(null);
  const [meta, setMeta] = useState({ isAdmin: false, isManager: false, showEdits: false, owners: [], meId: null });
  const [q, setQ] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [tab, setTab] = useState('notes'); // notes | archive
  const [open, setOpen] = useState(null); // note being edited in overlay

  const load = useCallback(() => {
    const p = new URLSearchParams(); if (q) p.set('q', q); if (ownerFilter) p.set('owner', ownerFilter);
    api(`/?${p}`).then((r) => { setNotes(r.notes || []); setMeta({ isAdmin: r.isAdmin, isManager: r.isManager, showEdits: r.showEdits, owners: r.owners || [], meId: r.meId }); }).catch((e) => toast(e.message));
  }, [api, q, ownerFilter]);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q, ownerFilter]);

  const createNote = async () => {
    try { const r = await api('/', { method: 'POST', body: JSON.stringify({ title: '', body: '', color: 'yellow' }) }); await load(); setOpen(r.note); } catch (e) { toast(e.message); }
  };
  const patch = async (id, fields) => { try { const r = await api(`/${id}`, { method: 'PUT', body: JSON.stringify(fields) }); return r.note; } catch (e) { toast(e.message); } };
  const del = async (n) => {
    if (!(await confirmDialog({ title: 'Delete this note?', message: 'It moves to the archive (an admin can restore it).', confirmText: 'Delete', danger: true }))) return;
    try { await api(`/${n.id}`, { method: 'DELETE' }); load(); } catch (e) { toast(e.message); }
  };
  const togglePin = async (n) => { await patch(n.id, { pinned: !n.pinned }); load(); };
  const setColor = async (n, color) => { await patch(n.id, { color }); load(); };

  const pinned = (notes || []).filter((n) => n.pinned);
  const rest = (notes || []).filter((n) => !n.pinned);

  return (
    <div className="fixed inset-0 z-[120] flex" style={{ background: '#f1f3f6' }}>
      {/* left rail */}
      <div className="w-14 shrink-0 flex flex-col items-center pt-4 gap-3.5" style={{ background: '#050A1F' }}>
        <button onClick={onClose} title="Close" className="w-10 h-10 rounded-xl flex items-center justify-center text-lg text-slate-300 hover:bg-white/10">✕</button>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: 'linear-gradient(135deg,#FDE68A,#FBBF24)' }}>🗒️</div>
      </div>
      <div className="flex-1 overflow-auto">
        {/* top */}
        <div className="sticky top-0 z-10 px-7 pt-5 pb-3.5" style={{ background: '#f1f3f6', borderBottom: '1px solid #e8eaed' }}>
          <div className="flex items-center gap-4">
            <h1 className="text-[20px] font-extrabold text-[#050A1F] whitespace-nowrap">🗒️ Sticky Notes</h1>
            <div className="relative flex-1 max-w-[540px]"><span className="absolute left-3.5 top-3 text-slate-400">🔍</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your notes…" className="w-full bg-white border border-slate-200 rounded-xl py-3 pl-10 pr-3.5 text-[13.5px]" style={{ boxShadow: '0 1px 3px rgba(0,0,0,.05)' }} /></div>
            {tab === 'notes' && <button onClick={createNote} className="rounded-xl px-5 py-3 text-[13.5px] font-bold text-white whitespace-nowrap" style={{ background: 'linear-gradient(135deg,#FF6A00,#FF4500)', boxShadow: '0 3px 10px rgba(255,90,0,.3)' }}>+ New note</button>}
          </div>
          {(meta.isAdmin || meta.isManager) && (
            <div className="flex gap-2 mt-3.5 flex-wrap items-center">
              <button onClick={() => { setTab('notes'); setOwnerFilter(''); }} className={`text-[12px] font-bold px-3.5 py-1.5 rounded-full border ${tab === 'notes' && !ownerFilter ? 'text-white' : 'bg-white text-slate-500 border-slate-200'}`} style={tab === 'notes' && !ownerFilter ? { background: '#050A1F', borderColor: '#050A1F' } : {}}>All I can see</button>
              {tab === 'notes' && meta.owners.map((o) => <button key={o.id} onClick={() => setOwnerFilter(String(o.id))} className={`text-[12px] font-bold px-3.5 py-1.5 rounded-full border ${ownerFilter === String(o.id) ? 'text-white' : 'bg-white text-slate-500 border-slate-200'}`} style={ownerFilter === String(o.id) ? { background: '#050A1F', borderColor: '#050A1F' } : {}}>{o.id === meta.meId ? 'My notes' : titleCase(o.name)} ({o.count})</button>)}
              {meta.isAdmin && <button onClick={() => setTab('archive')} className={`text-[12px] font-bold px-3.5 py-1.5 rounded-full border ml-1 ${tab === 'archive' ? 'text-white' : 'bg-white text-slate-500 border-slate-200'}`} style={tab === 'archive' ? { background: '#050A1F', borderColor: '#050A1F' } : {}}>🗑 Archive</button>}
            </div>
          )}
        </div>

        {tab === 'archive' ? <ArchiveView api={api} /> : (
          notes === null ? <div className="p-8 text-slate-400 text-sm">Loading…</div> : notes.length === 0 ? (
            <div className="p-16 text-center text-slate-400"><div className="text-4xl mb-2">🗒️</div><div className="text-[14px] font-semibold">No notes yet</div><div className="text-[12.5px] mt-1">Click “+ New note” to jot your first sticky.</div></div>
          ) : (
            <div className="px-7 pb-8 pt-2" style={{ columnCount: 4, columnGap: '18px' }}>
              {pinned.length > 0 && <div style={{ columnSpan: 'all' }} className="text-[10.5px] font-extrabold uppercase text-slate-400 tracking-wide mt-4 mb-2">📌 Pinned</div>}
              {pinned.map((n) => <Card key={n.id} n={n} meta={meta} onOpen={() => setOpen(n)} onDelete={() => del(n)} onPin={() => togglePin(n)} onColor={(c) => setColor(n, c)} />)}
              {pinned.length > 0 && rest.length > 0 && <div style={{ columnSpan: 'all' }} className="text-[10.5px] font-extrabold uppercase text-slate-400 tracking-wide mt-4 mb-2">Recent</div>}
              {rest.map((n) => <Card key={n.id} n={n} meta={meta} onOpen={() => setOpen(n)} onDelete={() => del(n)} onPin={() => togglePin(n)} onColor={(c) => setColor(n, c)} />)}
            </div>
          )
        )}
      </div>

      {open && <NoteEditor note={open} api={api} meta={meta} onClose={() => { setOpen(null); load(); }} />}
    </div>
  );
}

function Card({ n, meta, onOpen, onDelete, onPin, onColor }) {
  const [showColors, setShowColors] = useState(false);
  const canManage = n.ownerId === meta.meId; // only owner gets actions
  const previewMax = 240;
  const bodyText = String(n.body || '').replace(/<\/(p|div|li|h[1-6])>/gi, '\n').replace(/<li[^>]*>/gi, '• ').replace(/<[^>]*>/g, '');
  return (
    <div onClick={onOpen} className="group relative rounded-2xl p-4 pb-3 mb-[18px] cursor-pointer border border-black/[.03]" style={{ breakInside: 'avoid', background: COLORS[n.color] || COLORS.yellow, boxShadow: '0 2px 6px rgba(0,0,0,.07)' }}>
      {n.pinned && <span className="absolute top-3 right-3 text-[12px] opacity-50 group-hover:opacity-0 transition">📌</span>}
      {canManage && (
        <div className="absolute top-2.5 right-2.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition" onClick={(e) => e.stopPropagation()}>
          <button onClick={onPin} title={n.pinned ? 'Unpin' : 'Pin'} className="w-7 h-7 rounded-lg bg-white/60 hover:bg-white text-[13px] flex items-center justify-center">📌</button>
          <div className="relative">
            <button onClick={() => setShowColors((s) => !s)} title="Color" className="w-7 h-7 rounded-lg bg-white/60 hover:bg-white text-[13px] flex items-center justify-center">🎨</button>
            {showColors && <div className="absolute top-8 right-0 bg-white rounded-xl shadow-lg border border-slate-100 p-2 flex gap-1.5 flex-wrap w-[132px] z-20">{COLOR_KEYS.map((c) => <button key={c} onClick={() => { onColor(c); setShowColors(false); }} className="w-6 h-6 rounded-full border-2" style={{ background: COLORS[c], borderColor: n.color === c ? '#57534e' : 'rgba(0,0,0,.06)' }} />)}</div>}
          </div>
          <button onClick={onDelete} title="Delete" className="w-7 h-7 rounded-lg bg-white/60 hover:bg-white text-[13px] flex items-center justify-center">🗑</button>
        </div>
      )}
      {n.title && <h3 className="text-[14.5px] font-extrabold text-slate-800 mb-1.5 pr-6" style={{ wordBreak: 'break-word' }}>{n.title}</h3>}
      <div className="text-[12.5px] leading-[1.55] text-slate-600 whitespace-pre-wrap" style={{ wordBreak: 'break-word' }}>{bodyText.slice(0, previewMax)}{bodyText.length > previewMax ? '…' : ''}</div>
      <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-black/[.06]">
        {!canManage && n.ownerName && <span className="text-[9.5px] font-bold rounded-full px-2 py-0.5" style={{ background: 'rgba(0,0,0,.07)', color: '#374151' }}>{titleCase(n.ownerName)}</span>}
        <span className="text-[10.5px] text-slate-500">{timeAgo(n.updatedAt)}</span>
        {meta.showEdits && n.editCount != null && <span className="text-[10px] text-slate-400">· {n.editCount} edit{n.editCount !== 1 ? 's' : ''}</span>}
      </div>
    </div>
  );
}

function NoteEditor({ note, api, meta, onClose }) {
  const readOnly = note.ownerId !== meta.meId;
  const [title, setTitle] = useState(note.title || '');
  const [color, setColor] = useState(note.color || 'yellow');
  const [fontSize, setFontSize] = useState(note.fontSize || 'medium');
  const [saved, setSaved] = useState(true);
  const bodyRef = useRef(null);
  const saveTimer = useRef(null);
  const lastSent = useRef({ title: note.title, body: note.body, color: note.color, fontSize: note.fontSize });

  // Set initial body once — never re-set from state (keeps the cursor in place).
  useEffect(() => { if (bodyRef.current) bodyRef.current.innerHTML = note.body || ''; /* eslint-disable-next-line */ }, []);

  const scheduleSave = useCallback(() => {
    if (readOnly) return;
    setSaved(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const payload = { title, body: bodyRef.current ? bodyRef.current.innerHTML : '', color, fontSize };
      if (payload.title === lastSent.current.title && payload.body === lastSent.current.body && payload.color === lastSent.current.color && payload.fontSize === lastSent.current.fontSize) { setSaved(true); return; }
      try { await api(`/${note.id}`, { method: 'PUT', body: JSON.stringify(payload) }); lastSent.current = payload; setSaved(true); } catch { setSaved(false); }
    }, 800);
  }, [title, color, fontSize, readOnly, api, note.id]);

  useEffect(() => { scheduleSave(); /* eslint-disable-next-line */ }, [title, color, fontSize]);

  const cmd = (command, val) => { if (readOnly) return; document.execCommand(command, false, val || null); bodyRef.current && bodyRef.current.focus(); scheduleSave(); };
  const applyFontSize = (fs) => { setFontSize(fs); if (bodyRef.current) { bodyRef.current.style.fontSize = FONT_PX[fs]; } };

  useEffect(() => { if (bodyRef.current) bodyRef.current.style.fontSize = FONT_PX[fontSize]; /* eslint-disable-next-line */ }, []);

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,.45)' }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-[620px] rounded-[20px] overflow-hidden shadow-2xl" style={{ background: COLORS[color] || COLORS.yellow }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-4">
          <input value={title} onChange={(e) => setTitle(e.target.value)} readOnly={readOnly} placeholder="Title" className="bg-transparent border-none text-[20px] font-extrabold text-slate-800 outline-none flex-1" />
          <span className="text-[11px] font-semibold flex items-center gap-1" style={{ color: readOnly ? '#b45309' : (saved ? '#16a34a' : '#94a3b8') }}>{readOnly ? '🔒 Read-only' : (saved ? '✓ Saved' : 'Saving…')}</span>
        </div>
        {(meta.showEdits || readOnly) && <div className="px-5 pt-1.5 text-[10.5px] flex gap-4" style={{ color: '#a16207' }}>
          {note.ownerName && readOnly && <span>Owner: {titleCase(note.ownerName)}</span>}
          <span>Created {new Date(note.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
          <span>Updated {timeAgo(note.updatedAt)}</span>
          {meta.showEdits && note.editCount != null && <span>{note.editCount} edits</span>}
        </div>}
        <div ref={bodyRef} contentEditable={!readOnly} suppressContentEditableWarning onInput={scheduleSave} className="px-5 py-3 min-h-[200px] max-h-[50vh] overflow-auto text-slate-700 outline-none leading-[1.7]" style={{ fontSize: FONT_PX[fontSize] }} />
        {!readOnly && (
          <div className="flex items-center gap-1 px-4 py-3" style={{ background: 'rgba(0,0,0,.05)', borderTop: '1px solid rgba(0,0,0,.06)' }}>
            <button onClick={() => cmd('bold')} className="w-8 h-8 rounded-lg hover:bg-black/10 font-extrabold text-stone-600">B</button>
            <button onClick={() => cmd('italic')} className="w-8 h-8 rounded-lg hover:bg-black/10 italic text-stone-600">I</button>
            <button onClick={() => cmd('strikeThrough')} className="w-8 h-8 rounded-lg hover:bg-black/10 line-through text-stone-600">S</button>
            <button onClick={() => cmd('insertUnorderedList')} className="w-8 h-8 rounded-lg hover:bg-black/10 text-stone-600 text-[16px]">•</button>
            <span className="w-px h-5 bg-black/10 mx-1" />
            <select value={fontSize} onChange={(e) => applyFontSize(e.target.value)} className="bg-transparent text-[12.5px] text-stone-600 font-semibold px-1.5 py-1.5 rounded-lg cursor-pointer outline-none"><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select>
            <span className="w-px h-5 bg-black/10 mx-1" />
            <div className="flex gap-1.5">{COLOR_KEYS.map((c) => <button key={c} onClick={() => setColor(c)} className="w-[22px] h-[22px] rounded-full border-2" style={{ background: COLORS[c], borderColor: color === c ? '#57534e' : 'rgba(0,0,0,.06)' }} />)}</div>
            <button onClick={onClose} className="ml-auto text-[13px] font-bold text-stone-500 hover:bg-black/10 px-3 py-1.5 rounded-lg">Close</button>
          </div>
        )}
        {readOnly && <div className="flex px-4 py-3" style={{ background: 'rgba(0,0,0,.05)' }}><button onClick={onClose} className="ml-auto text-[13px] font-bold text-stone-500 px-3 py-1.5 rounded-lg hover:bg-black/10">Close</button></div>}
      </div>
    </div>
  );
}

function ArchiveView({ api }) {
  const [rows, setRows] = useState(null);
  const load = () => api('/archive/list').then((r) => setRows(r.notes || [])).catch((e) => toast(e.message));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  const restore = async (n) => { try { await api(`/archive/${n.id}/restore`, { method: 'POST' }); toast('Restored to owner'); load(); } catch (e) { toast(e.message); } };
  const purge = async (n) => { if (!(await confirmDialog({ title: 'Delete forever?', message: 'This permanently removes the note. It cannot be undone.', confirmText: 'Delete forever', danger: true }))) return; try { await api(`/archive/${n.id}`, { method: 'DELETE' }); load(); } catch (e) { toast(e.message); } };
  return (
    <div className="px-7 pb-8 pt-4">
      <div className="text-[12px] text-slate-400 mb-4">Deleted notes across all users. Restore returns a note to its owner; delete forever removes it permanently.</div>
      {rows === null ? <div className="text-slate-400 text-sm">Loading…</div> : rows.length === 0 ? <div className="text-slate-400 text-[13px] py-10 text-center">Archive is empty.</div> : (
        <div style={{ columnCount: 4, columnGap: '18px' }}>
          {rows.map((n) => { const bodyText = String(n.body || '').replace(/<[^>]*>/g, ' ').trim(); return (
            <div key={n.id} className="rounded-2xl p-4 pb-3 mb-[18px] opacity-90" style={{ breakInside: 'avoid', background: COLORS[n.color] || COLORS.yellow, boxShadow: '0 2px 6px rgba(0,0,0,.07)' }}>
              <span className="inline-block text-[9.5px] font-bold rounded-full px-2 py-0.5 mb-2" style={{ background: 'rgba(0,0,0,.07)', color: '#374151' }}>{titleCase(n.ownerName || '')}</span>
              {n.title && <h3 className="text-[14px] font-extrabold text-slate-800 mb-1.5">{n.title}</h3>}
              <div className="text-[12px] text-slate-600 leading-[1.5]">{bodyText.slice(0, 180)}{bodyText.length > 180 ? '…' : ''}</div>
              <div className="flex items-center gap-3 mt-3 pt-2.5 border-t border-black/[.06]">
                <span className="text-[10px] text-slate-500">Deleted {timeAgo(n.archivedAt)}</span>
                <button onClick={() => restore(n)} className="text-[11px] font-bold text-blue-600">↩ Restore</button>
                <button onClick={() => purge(n)} className="text-[11px] font-bold text-red-600 ml-auto">Delete forever</button>
              </div>
            </div>
          ); })}
        </div>
      )}
    </div>
  );
}

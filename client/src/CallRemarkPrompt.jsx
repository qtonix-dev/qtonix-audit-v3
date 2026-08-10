import React, { useEffect, useState } from 'react';
import { api } from './App.jsx';

// Polls for completed CallHippo calls (credited to the current agent) that still
// need a remark, and pops a small form to capture it. Submitting saves the
// remark to the lead's timeline and adds a "Call Completed" activity. This is
// webhook-driven: it appears shortly after a call ends, not during the call
// (the extension dialer doesn't expose live call state to the page).
export default function CallRemarkPrompt() {
  const [pending, setPending] = useState([]);
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const rows = await api('/callhippo/pending-remarks');
        if (alive) setPending(Array.isArray(rows) ? rows : []);
      } catch { /* ignore */ }
    };
    poll();
    const t = setInterval(poll, 20000); // every 20s
    return () => { alive = false; clearInterval(t); };
  }, []);

  const current = pending[0];
  if (!current) return null;

  const submit = async () => {
    setBusy(true);
    try {
      await api(`/callhippo/logs/${current.id}/remark`, { method: 'POST', body: JSON.stringify({ remark }) });
      setRemark('');
      setPending((p) => p.slice(1));
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  };

  const skip = async () => {
    // Submitting an empty remark clears the flag without a note body.
    setBusy(true);
    try {
      await api(`/callhippo/logs/${current.id}/remark`, { method: 'POST', body: JSON.stringify({ remark: '' }) });
      setPending((p) => p.slice(1));
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  };

  const mins = Math.floor((current.durationSeconds || 0) / 60);
  const secs = (current.durationSeconds || 0) % 60;

  return (
    <div className="fixed bottom-5 right-5 z-[9997] w-80 bg-white rounded-2xl shadow-2xl border border-slate-200 p-4" style={{ fontFamily: "'Plus Jakarta Sans',system-ui,sans-serif" }}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xl">📞</span>
        <div className="text-sm font-black text-[#050A1F]">Call completed</div>
      </div>
      <div className="text-xs text-slate-500 mb-2">
        {current.direction === 'incoming' ? 'Incoming' : 'Outgoing'} call
        {current.leadName ? <> with <b>{current.leadName}</b></> : current.customerNumber ? <> with {current.customerNumber}</> : ''}
        {current.durationSeconds ? ` · ${mins}m ${secs}s` : ''}. Add a quick remark:
      </div>
      <textarea value={remark} onChange={(e) => setRemark(e.target.value)} autoFocus
        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm h-20 resize-none"
        placeholder="What was discussed, next steps…" />
      {current.recordingUrl && (
        <a href={current.recordingUrl} target="_blank" rel="noreferrer" className="inline-block text-[11px] font-semibold text-[#FF4500] hover:underline mt-1">▶ Listen to recording</a>
      )}
      <div className="flex gap-2 mt-2">
        <button onClick={skip} disabled={busy} className="flex-1 rounded-lg px-3 py-2 text-xs font-bold text-slate-500 bg-slate-100">Skip</button>
        <button onClick={submit} disabled={busy} className="flex-1 rounded-lg px-3 py-2 text-xs font-bold text-white" style={{ background: 'linear-gradient(90deg,#16A34A,#15803D)' }}>{busy ? 'Saving…' : 'Save remark'}</button>
      </div>
      {pending.length > 1 && <div className="text-[10px] text-slate-400 mt-1.5 text-center">{pending.length - 1} more call{pending.length - 1 === 1 ? '' : 's'} to note</div>}
    </div>
  );
}

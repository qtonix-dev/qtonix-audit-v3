import React, { useState, useEffect } from 'react';
import { api } from './App.jsx';

const usd = (n) => `$${Number(n || 0).toLocaleString()}`;
const initials = (name) => (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

function Avatar({ name, src, size = 40 }) {
  if (src) return <img src={src} alt={name} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  return (
    <div className="rounded-full bg-slate-200 text-slate-500 font-bold flex items-center justify-center shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.36 }}>{initials(name)}</div>
  );
}

const BANDS = {
  top: { label: 'Top performer', color: '#16A34A', bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', icon: '🏆',
    blurb: 'Hitting or beating target — recognise and keep them motivated.' },
  ok: { label: 'On track', color: '#2563EB', bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', icon: '👍',
    blurb: 'Progressing at a reasonable pace. A short check-in is enough.' },
  attention: { label: 'Needs attention', color: '#DC2626', bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', icon: '⚠️',
    blurb: 'Well behind target. Sit down 1-to-1 and agree a concrete plan.' },
  unrated: { label: 'No targets set', color: '#94A3B8', bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-500', icon: '—',
    blurb: 'No targets configured, so performance can’t be judged yet.' },
};

// Month picker covering the last 12 months.
function monthOptions() {
  const out = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
    });
  }
  return out;
}

function ReviewModal({ agent, period, onClose, onSaved }) {
  const r = agent.review || {};
  const [f, setF] = useState({
    feedback: r.feedback || '',
    actionPlan: r.actionPlan || '',
    metOn: r.metOn || new Date().toISOString().slice(0, 10),
    needsHr: !!r.needsHr,
  });
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState([]);
  useEffect(() => {
    api(`/reviews/history/${agent.agentId}`).then((h) => setHistory((h.items || []).filter((x) => x.period !== period))).catch(() => {});
  }, [agent.agentId, period]);

  const band = BANDS[agent.band] || BANDS.unrated;
  const inp = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400';

  const save = async () => {
    setBusy(true);
    try {
      await api('/reviews', {
        method: 'POST',
        body: JSON.stringify({
          agentId: agent.agentId, period, band: agent.band,
          snapshot: { salesUsd: agent.salesUsd, salesTarget: agent.salesTarget, pct: agent.pct, leadsGenerated: agent.leadsGenerated, conversions: agent.conversions },
          ...f,
        }),
      });
      onSaved();
    } catch (e) { alert(e.message); }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-2xl max-h-[88vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-4">
          <Avatar name={agent.name} src={agent.avatar} size={48} />
          <div className="flex-1">
            <h3 className="text-lg font-extrabold text-[#050A1F]">{agent.name}</h3>
            <div className="text-xs text-slate-400">{agent.team} · {agent.shift} · {agent.jobType === 'presales' ? 'Pre-Sales' : 'BDE'}</div>
          </div>
          <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${band.bg} ${band.text}`}>{band.icon} {band.label}</span>
        </div>

        {/* The numbers this conversation is based on */}
        <div className="grid grid-cols-4 gap-2 mb-4">
          {[
            { k: 'Sales', v: usd(agent.salesUsd), sub: agent.salesTarget ? `of ${usd(agent.salesTarget)} · ${agent.pct}%` : 'no target' },
            { k: 'Leads', v: agent.leadsGenerated, sub: agent.leadGenTarget ? `of ${agent.leadGenTarget} · ${agent.leadPct}%` : 'no target' },
            { k: 'Conversions', v: agent.conversions, sub: 'this month' },
            { k: 'Pipeline', v: usd(agent.pipelineUsd), sub: 'open deals' },
          ].map((x) => (
            <div key={x.k} className="rounded-lg bg-slate-50 border border-slate-100 p-2.5">
              <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{x.k}</div>
              <div className="text-base font-extrabold text-[#050A1F]">{x.v}</div>
              <div className="text-[10px] text-slate-400">{x.sub}</div>
            </div>
          ))}
        </div>

        <div className={`rounded-lg ${band.bg} border ${band.border} px-3 py-2 text-[11px] font-semibold ${band.text} mb-4`}>
          {band.blurb}
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">1-to-1 discussion notes</label>
            <textarea rows={4} className={inp} value={f.feedback} onChange={(e) => setF({ ...f, feedback: e.target.value })}
              placeholder="What was discussed? What's going well, what's blocking them?" />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">Agreed action plan</label>
            <textarea rows={3} className={inp} value={f.actionPlan} onChange={(e) => setF({ ...f, actionPlan: e.target.value })}
              placeholder="What will they do differently, and by when?" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Meeting held on</label>
              <input type="date" className={inp} value={f.metOn} onChange={(e) => setF({ ...f, metOn: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm font-bold text-slate-600 self-end pb-2">
              <input type="checkbox" checked={f.needsHr} onChange={(e) => setF({ ...f, needsHr: e.target.checked })} />
              Escalate to HR
            </label>
          </div>
        </div>

        {history.length > 0 && (
          <div className="mt-5">
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Previous reviews</div>
            <div className="space-y-2 max-h-40 overflow-auto">
              {history.map((h) => (
                <div key={h.id} className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-600">{h.period}</span>
                    <span className="text-[10px] text-slate-400">{h.reviewerName}{h.needsHr ? ' · HR flagged' : ''}</span>
                  </div>
                  {h.feedback && <div className="text-[11px] text-slate-500 mt-1">{h.feedback}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg px-6 py-2 text-sm font-bold text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>{busy ? 'Saving…' : 'Save review'}</button>
        </div>
      </div>
    </div>
  );
}

export default function Reviews({ user }) {
  const [period, setPeriod] = useState(monthOptions()[0].key);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [active, setActive] = useState(null);

  const load = () => {
    api(`/reviews?period=${period}`).then(setData).catch((e) => setErr(e.message));
  };
  useEffect(() => { setData(null); load(); /* eslint-disable-next-line */ }, [period]);

  if (err) return <div className="text-red-500 text-sm">{err}</div>;
  if (!data) return <div className="text-slate-400 text-sm py-12 text-center">Loading reviews…</div>;

  const agents = data.agents || [];
  const byBand = (b) => agents.filter((a) => a.band === b);
  const reviewed = agents.filter((a) => a.review && a.review.feedback).length;
  const hrFlagged = agents.filter((a) => a.review && a.review.needsHr).length;

  const Section = ({ band }) => {
    const meta = BANDS[band];
    const rows = byBand(band);
    if (rows.length === 0) return null;
    return (
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-base">{meta.icon}</span>
          <h2 className="text-sm font-extrabold text-[#050A1F]">{meta.label}</h2>
          <span className="text-[10px] font-bold rounded-full px-2 py-0.5" style={{ background: meta.color + '1a', color: meta.color }}>{rows.length}</span>
          <span className="text-[11px] text-slate-400 hidden sm:inline">· {meta.blurb}</span>
        </div>
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {rows.map((a) => {
            const done = a.review && a.review.feedback;
            return (
              <div key={a.agentId} onClick={() => setActive(a)}
                className={`rounded-xl border ${meta.border} bg-white p-4 cursor-pointer hover:shadow-md transition`}>
                <div className="flex items-center gap-3">
                  <Avatar name={a.name} src={a.avatar} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-sm text-[#050A1F] truncate">{a.name}</div>
                    <div className="text-[11px] text-slate-400">{a.team} · {a.shift}</div>
                  </div>
                  {done
                    ? <span className="text-[9px] font-bold rounded px-1.5 py-0.5 bg-green-100 text-green-700">REVIEWED</span>
                    : <span className="text-[9px] font-bold rounded px-1.5 py-0.5 bg-amber-100 text-amber-700">PENDING</span>}
                </div>
                <div className="mt-3">
                  <div className="flex items-end justify-between">
                    <span className="text-sm font-extrabold text-[#050A1F]">{usd(a.salesUsd)}{a.salesTarget > 0 && <span className="text-slate-300 font-normal"> / {usd(a.salesTarget)}</span>}</span>
                    {a.pct !== null && <span className="text-xs font-bold" style={{ color: meta.color }}>{a.pct}%</span>}
                  </div>
                  {a.salesTarget > 0 && (
                    <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden mt-1">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(3, Math.min(100, a.pct))}%`, background: meta.color }} />
                    </div>
                  )}
                  <div className="text-[10px] text-slate-400 mt-1.5">
                    {a.leadsGenerated} leads · {a.conversions} converted
                    {a.review && a.review.needsHr && <span className="ml-1 font-bold text-red-500">· HR flagged</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold text-[#050A1F]">Team reviews</h1>
          <div className="text-sm text-slate-400">
            {agents.length} team member{agents.length === 1 ? '' : 's'} · {reviewed} reviewed
            {hrFlagged > 0 && <span className="text-red-500 font-semibold"> · {hrFlagged} flagged for HR</span>}
          </div>
        </div>
        <select value={period} onChange={(e) => setPeriod(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600">
          {monthOptions().map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
      </div>

      {/* Groups the viewer is responsible for */}
      {(data.groups || []).length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          {data.groups.map((g) => (
            <span key={`${g.team}-${g.shift}`}
              className={`rounded-lg px-3 py-1.5 text-[11px] font-bold border ${g.adminLed ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-600'}`}>
              {g.team} · {g.shift} · {g.agentCount} agent{g.agentCount === 1 ? '' : 's'}
              {g.adminLed ? ' · admin-led' : ` · ${g.manager.name}`}
            </span>
          ))}
        </div>
      )}

      {agents.length === 0 ? (
        <div className="text-slate-400 text-sm py-16 text-center bg-white rounded-2xl border border-slate-100">
          <div className="text-4xl mb-2">👥</div>
          No agents to review{user.role === 'manager' ? ' in your groups' : ''} for this period.
        </div>
      ) : (
        <>
          <Section band="attention" />
          <Section band="top" />
          <Section band="ok" />
          <Section band="unrated" />
        </>
      )}

      {active && <ReviewModal agent={active} period={period} onClose={() => setActive(null)} onSaved={() => { setActive(null); load(); }} />}
    </div>
  );
}

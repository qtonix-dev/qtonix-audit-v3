import React, { useState, useEffect } from 'react';
import { hrApi } from './HrApp.jsx';

const ORANGE = 'linear-gradient(90deg,#FF6A00,#FF4500)';
const inp = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400';

const VERDICTS = [['definitely', 'Definitely', '#16A34A'], ['yes', 'Yes', '#2563EB'], ['no', 'No', '#DC2626'], ['not_sure', 'Not Sure', '#F59E0B']];
const DEFAULT_ATTRS = ['Communication skills', 'Technical skill', 'Ability to learn'];

export default function HrCandidateView({ candidateId, onClose }) {
  const [c, setC] = useState(null);
  const [tab, setTab] = useState('resume');
  const [err, setErr] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [showInterview, setShowInterview] = useState(false);

  const load = () => hrApi(`/candidates/${candidateId}`).then(setC).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [candidateId]);

  if (!c) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[120] p-4">
        <div className="bg-white rounded-2xl p-8 text-slate-400 text-sm">{err || 'Loading…'}</div>
      </div>
    );
  }

  const a = c.answers || {};
  const job = c.job;
  const stages = (job && job.stages) || [];
  const curStage = stages.find((s) => s.id === c.stage);
  const nextStage = (() => { const i = stages.findIndex((s) => s.id === c.stage); return i >= 0 && i < stages.length - 1 ? stages[i + 1] : null; })();
  const wa = (c.phone || '').replace(/[^0-9]/g, '');

  const act = async (fn) => { try { const updated = await fn(); if (updated) setC((s) => ({ ...updated, job: s.job })); } catch (e) { setErr(e.message); } };
  const moveNext = () => nextStage && act(() => hrApi(`/candidates/${c.id}/stage`, { method: 'PATCH', body: JSON.stringify({ stage: nextStage.id }) }));
  const reject = () => { if (window.confirm('Reject this candidate?')) act(() => hrApi(`/candidates/${c.id}/reject`, { method: 'POST', body: JSON.stringify({}) })); };

  const TABS = [['resume', 'Resume'], ['application', 'Application Form'], ['ai', 'AI Recruiter'], ['comments', 'Comments'], ['feedback', 'Feedback'], ['mail', 'Mail'], ['timeline', 'Timeline'], ['attachments', 'Attachments']];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-[120] p-4 overflow-auto">
      <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl my-4">
        {/* Header */}
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-start justify-between">
            <div className="flex gap-4">
              <div className="w-16 h-16 rounded-xl bg-orange-100 text-orange-700 flex items-center justify-center text-xl font-extrabold shrink-0">
                {(c.name || '?').split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <div className="text-xl font-extrabold text-[#050A1F]">{c.name}</div>
                  {a.age && <span className="text-slate-400 text-sm">{a.age}</span>}
                  {c.rejected && <span className="rounded-full bg-red-100 text-red-600 px-2 py-0.5 text-[10px] font-bold">Rejected</span>}
                </div>
                <div className="mt-1 text-sm text-slate-500 space-y-0.5">
                  {c.email && <div>✉️ {c.email}</div>}
                  <div className="flex flex-wrap gap-x-4">
                    {(c.currentLocation || a.city) && <span>📍 {c.currentLocation || a.city}</span>}
                    {c.phone && <span>📞 {c.phone}</span>}
                    {wa && <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" className="text-green-600 font-semibold">WhatsApp</a>}
                  </div>
                  <div className="flex flex-wrap gap-x-4 text-xs text-slate-400 pt-1">
                    <span>Source: <b className="text-slate-600">{c.source === 'public_form' ? 'Application form' : 'Manual'}</b></span>
                    {c.recruiterName && <span>Recruiter: <b className="text-slate-600">{c.recruiterName}</b></span>}
                    <span>Current stage: <b className="text-slate-600">{curStage ? curStage.label : c.stage}</b></span>
                  </div>
                </div>
              </div>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">×</button>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 mt-4">
            <button onClick={() => setShowFeedback(true)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">💬 Add Feedback</button>
            <button onClick={() => setShowInterview(true)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">📅 Schedule Interview</button>
            <button onClick={reject} disabled={c.rejected} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-500 disabled:opacity-50">⛔ Reject</button>
            {nextStage && !c.rejected && <button onClick={moveNext} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: ORANGE }}>Move to {nextStage.label} →</button>}
          </div>
          {err && <div className="mt-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm px-3 py-2">{err}</div>}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 border-b border-slate-100 overflow-x-auto">
          {TABS.map(([id, label]) => (
            <button key={id} onClick={() => id === 'feedback' ? setShowFeedback(true) : setTab(id)}
              className={`px-3 py-2.5 text-sm font-bold whitespace-nowrap border-b-2 -mb-px ${tab === id ? 'border-orange-500 text-orange-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              {label}{id === 'comments' && (c.comments || []).length ? ` (${c.comments.length})` : ''}
            </button>
          ))}
        </div>

        <div className="p-6 min-h-[300px]">
          {tab === 'resume' && <ResumeTab c={c} />}
          {tab === 'application' && <ApplicationTab c={c} a={a} job={job} />}
          {tab === 'ai' && <AiTab c={c} reload={load} setErr={setErr} />}
          {tab === 'comments' && <CommentsTab c={c} onAdd={(text) => act(() => hrApi(`/candidates/${c.id}/comments`, { method: 'POST', body: JSON.stringify({ text }) }))} />}
          {tab === 'mail' && <MailTab c={c} />}
          {tab === 'timeline' && <TimelineTab c={c} />}
          {tab === 'attachments' && <AttachmentsTab c={c} />}
        </div>
      </div>

      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)}
        onSubmit={async (payload) => { await act(() => hrApi(`/candidates/${c.id}/feedback`, { method: 'POST', body: JSON.stringify(payload) })); setShowFeedback(false); }} />}
      {showInterview && <InterviewModal onClose={() => setShowInterview(false)}
        onSubmit={async (payload) => { await act(() => hrApi(`/candidates/${c.id}/interview`, { method: 'POST', body: JSON.stringify(payload) })); setShowInterview(false); }} />}
    </div>
  );
}

function ResumeTab({ c }) {
  if (!c.resumeUrl) return <Empty>No resume uploaded.</Empty>;
  const isPdf = /\.pdf($|\?)/i.test(c.resumeUrl);
  return (
    <div>
      <div className="flex justify-end mb-2"><a href={c.resumeUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">Open / Download</a></div>
      {isPdf
        ? <iframe title="resume" src={c.resumeUrl} className="w-full h-[500px] rounded-lg border border-slate-200" />
        : <div className="text-center py-10"><a href={c.resumeUrl} target="_blank" rel="noreferrer" className="text-orange-600 font-bold">View resume file</a></div>}
    </div>
  );
}

function ApplicationTab({ c, a, job }) {
  const rows = [
    ['Notice Period', a.noticePeriod ? `${a.noticePeriod} days` : ''],
    ['Current Salary', a.currentCtc], ['Expected Salary', a.expectedCtc],
    ['Current Location', c.currentLocation || a.city], ['Portfolio', a.portfolio],
    ['Skills', (a.skills || []).join(', ')],
  ];
  const work = a.work || []; const edu = a.education || [];
  return (
    <div className="space-y-5 text-sm">
      <Grid rows={rows} />
      {work.length > 0 && (
        <div><H>Work Experience</H>{work.map((w, i) => (
          <div key={i} className="rounded-lg border border-slate-200 p-3 mb-2">
            <div className="font-semibold text-slate-700">{w.title || '—'} {w.company ? `@ ${w.company}` : ''}</div>
            <div className="text-xs text-slate-400">{w.start} – {w.current ? 'Present' : w.end}</div>
          </div>
        ))}</div>
      )}
      {edu.length > 0 && (
        <div><H>Education</H>{edu.map((e, i) => (
          <div key={i} className="rounded-lg border border-slate-200 p-3 mb-2">
            <div className="font-semibold text-slate-700">{e.course || ''} {e.specialization ? `(${e.specialization})` : ''}</div>
            <div className="text-xs text-slate-400">{e.institute} · {e.start} – {e.end}</div>
          </div>
        ))}</div>
      )}
      {/* Screening question answers */}
      {job && (job.questions || []).length > 0 && (
        <div><H>Screening Questions</H>{(job.questions || []).map((q) => (
          <div key={q.id} className="mb-2">
            <div className="text-xs font-bold text-slate-500">{q.question}</div>
            <div className="text-slate-700">{a[q.id] || <span className="text-slate-300">No answer</span>}</div>
          </div>
        ))}</div>
      )}
      {(a.linkedin || a.github || a.twitter || a.facebook || a.instagram) && (
        <div><H>Links</H><div className="flex flex-wrap gap-3 text-xs">
          {[['LinkedIn', a.linkedin], ['GitHub', a.github], ['Twitter', a.twitter], ['Facebook', a.facebook], ['Instagram', a.instagram]].filter(([, v]) => v).map(([k, v]) => <a key={k} href={v} target="_blank" rel="noreferrer" className="text-orange-600 font-semibold">{k}</a>)}
        </div></div>
      )}
    </div>
  );
}

function AiTab({ c, reload, setErr }) {
  const [busy, setBusy] = useState(false);
  const s = c.aiSummary;
  const run = async () => {
    setBusy(true); setErr('');
    try { await hrApi(`/candidates/${c.id}/ai-screen`, { method: 'POST' }); await reload(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const verdictColor = { strong_match: '#16A34A', possible_match: '#F59E0B', weak_match: '#DC2626' };
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-slate-500">AI screens this candidate against the job's skills, experience and description.</div>
        <button onClick={run} disabled={busy} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Screening…' : s ? '↻ Re-run' : '✨ Screen with AI'}</button>
      </div>
      {!s && !busy && <Empty>No AI assessment yet. Click “Screen with AI”.</Empty>}
      {s && (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-full flex items-center justify-center text-white text-xl font-extrabold" style={{ background: verdictColor[s.verdict] || '#64748B' }}>{s.matchScore}%</div>
            <div>
              <div className="text-base font-extrabold text-[#050A1F] capitalize">{(s.verdict || '').replace('_', ' ')}</div>
              <div className="text-sm text-slate-600">{s.summary}</div>
            </div>
          </div>
          {(s.strengths || []).length > 0 && <div><H>Strengths</H><ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">{s.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
          {(s.gaps || []).length > 0 && <div><H>Gaps</H><ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">{s.gaps.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
          {s.recommendation && <div className="rounded-lg bg-orange-50 border border-orange-200 p-3 text-sm text-slate-700"><b>Recommendation:</b> {s.recommendation}</div>}
        </div>
      )}
    </div>
  );
}

function CommentsTab({ c, onAdd }) {
  const [text, setText] = useState('');
  const list = c.comments || [];
  return (
    <div>
      <div className="flex gap-2 mb-4">
        <input className={inp} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note or comment…" onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { onAdd(text.trim()); setText(''); } }} />
        <button onClick={() => { if (text.trim()) { onAdd(text.trim()); setText(''); } }} className="rounded-lg px-4 py-2 text-sm font-bold text-white shrink-0" style={{ background: ORANGE }}>Post</button>
      </div>
      {list.length === 0 ? <Empty>No comments yet.</Empty> : (
        <div className="space-y-3">
          {list.map((cm) => (
            <div key={cm.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between"><div className="text-sm font-bold text-slate-700">{cm.by}</div><div className="text-xs text-slate-400">{fmt(cm.at)}</div></div>
              <div className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">{cm.text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MailTab({ c }) {
  return (
    <div className="text-center py-8">
      <div className="text-sm text-slate-500 mb-3">Send an email to this candidate.</div>
      <a href={`mailto:${c.email}`} className="rounded-lg px-4 py-2 text-sm font-bold text-white inline-block" style={{ background: ORANGE }}>✉️ Compose email</a>
      <div className="text-xs text-slate-400 mt-3">In-app mail threading can be added later.</div>
    </div>
  );
}

function TimelineTab({ c }) {
  const list = c.timeline || [];
  if (!list.length) return <Empty>No activity yet.</Empty>;
  return (
    <div className="relative pl-6">
      <div className="absolute left-2 top-1 bottom-1 w-px bg-slate-200" />
      {list.map((t) => (
        <div key={t.id} className="relative mb-4">
          <div className="absolute -left-[18px] top-1 w-3 h-3 rounded-full bg-orange-400 border-2 border-white" />
          <div className="text-sm text-slate-700">{t.text}</div>
          <div className="text-xs text-slate-400">{fmt(t.at)}</div>
        </div>
      ))}
    </div>
  );
}

function AttachmentsTab({ c }) {
  const list = c.attachments || [];
  return (
    <div>
      {c.resumeUrl && <a href={c.resumeUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 mb-2 hover:bg-slate-50"><span>📄</span><span className="text-sm font-semibold text-slate-700">Resume</span></a>}
      {list.map((f) => <a key={f.id} href={f.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 mb-2 hover:bg-slate-50"><span>📎</span><span className="text-sm font-semibold text-slate-700">{f.name}</span></a>)}
      {!c.resumeUrl && !list.length && <Empty>No attachments.</Empty>}
    </div>
  );
}

function FeedbackModal({ onClose, onSubmit }) {
  const [attrs, setAttrs] = useState(DEFAULT_ATTRS.map((name) => ({ name, rating: 0 })));
  const [verdict, setVerdict] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const setRating = (i, r) => setAttrs((a) => a.map((x, idx) => idx === i ? { ...x, rating: r } : x));
  const addAttr = () => setAttrs((a) => [...a, { name: '', rating: 0 }]);
  const submit = async () => { setBusy(true); await onSubmit({ skills: attrs.filter((a) => a.name.trim()), verdict: verdict || 'not_sure', note }); setBusy(false); };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130] p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[88vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="text-lg font-extrabold text-[#050A1F]">Feedback Form</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
        </div>
        <div className="p-6 overflow-auto">
          <div className="text-sm font-bold text-slate-600 mb-2">Skills / Attributes</div>
          {attrs.map((at, i) => (
            <div key={i} className="flex items-center justify-between gap-3 mb-2">
              <input className={inp} value={at.name} onChange={(e) => setAttrs((a) => a.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} placeholder="Attribute" />
              <Stars value={at.rating} onChange={(r) => setRating(i, r)} />
            </div>
          ))}
          <button onClick={addAttr} className="text-xs font-bold text-orange-600 mb-4">+ Add Skill</button>

          <div className="text-sm font-bold text-slate-600 mb-2">Evaluation score</div>
          <div className="grid grid-cols-4 gap-2 mb-4">
            {VERDICTS.map(([v, l, color]) => (
              <button key={v} onClick={() => setVerdict(v)} className={`rounded-lg border px-2 py-2 text-xs font-bold ${verdict === v ? 'text-white' : 'text-slate-600 border-slate-300'}`} style={verdict === v ? { background: color, borderColor: color } : {}}>{l}</button>
            ))}
          </div>
          <textarea className={inp} rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why do you think this candidate is a good fit?" />
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-5 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={submit} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Submitting…' : 'Submit Feedback'}</button>
        </div>
      </div>
    </div>
  );
}

function InterviewModal({ onClose, onSubmit }) {
  const [at, setAt] = useState('');
  const [mode, setMode] = useState('online');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130] p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="text-lg font-extrabold text-[#050A1F]">Schedule Interview</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
        </div>
        <div className="p-6 space-y-3">
          <div><div className="text-xs font-bold text-slate-500 mb-1">Date &amp; time</div><input className={inp} type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></div>
          <div><div className="text-xs font-bold text-slate-500 mb-1">Mode</div>
            <select className={inp} value={mode} onChange={(e) => setMode(e.target.value)}><option value="online">Online</option><option value="in_person">In person</option><option value="phone">Phone</option></select>
          </div>
          <div><div className="text-xs font-bold text-slate-500 mb-1">Notes</div><textarea className={inp} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-5 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={async () => { setBusy(true); await onSubmit({ at, mode, notes }); setBusy(false); }} disabled={busy || !at} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : 'Schedule'}</button>
        </div>
      </div>
    </div>
  );
}

// --- small helpers ---
function Stars({ value, onChange }) {
  return <div className="flex gap-0.5">{[1, 2, 3, 4, 5].map((n) => <button key={n} onClick={() => onChange(n)} className={n <= value ? 'text-amber-400' : 'text-slate-300 hover:text-amber-300'}>★</button>)}</div>;
}
function Grid({ rows }) {
  return <div className="grid grid-cols-2 gap-x-6 gap-y-3">{rows.filter(([, v]) => v).map(([k, v]) => <div key={k}><div className="text-xs font-bold text-slate-400">{k}</div><div className="text-slate-700">{v}</div></div>)}</div>;
}
function H({ children }) { return <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">{children}</div>; }
function Empty({ children }) { return <div className="text-center text-slate-400 text-sm py-10">{children}</div>; }
function fmt(iso) { try { return new Date(iso).toLocaleString(); } catch { return ''; } }

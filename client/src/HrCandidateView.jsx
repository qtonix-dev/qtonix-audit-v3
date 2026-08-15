import React, { useState, useEffect, useRef } from 'react';
import { hrApi, fileToBase64 } from './HrApp.jsx';
import { MailEditor, ChipInput } from './Leads.jsx';

const ORANGE = 'linear-gradient(90deg,#FF6A00,#FF4500)';
const inp = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400';

// Evaluation verdicts with an icon each (thumb/check/cross/question).
const VERDICTS = [
  ['definitely', 'Definitely', '#16A34A', 'M14 9V5a3 3 0 0 0-6 0v4H5l-2 9h14l2-9z M9 22h6'],
  ['yes', 'Yes', '#2563EB', 'M20 6L9 17l-5-5'],
  ['no', 'No', '#DC2626', 'M18 6L6 18M6 6l12 12'],
  ['not_sure', 'Not Sure', '#F59E0B', 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01'],
];
const DEFAULT_ATTRS = ['Communication skills', 'Technical skill', 'Ability to learn'];

// WhatsApp glyph.
const WA_PATH = 'M12 2a10 10 0 0 0-8.5 15.2L2 22l4.9-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.5-4-4.7-4.2-.1-.2-1-1.4-1-2.6s.6-1.8.9-2.1c.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.3 0 .5l-.4.5-.3.3c-.1.1-.2.3-.1.5.1.2.6 1 1.3 1.6.9.8 1.6 1 1.8 1.1.2.1.4.1.5-.1l.6-.8c.2-.2.4-.2.5-.1l1.8.9c.2.1.4.2.4.3.1.2.1.6 0 1z';

export default function HrCandidateView({ candidateId, onBack, onClose }) {
  const [c, setC] = useState(null);
  const [tab, setTab] = useState('resume');
  const [err, setErr] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [showInterview, setShowInterview] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const back = onBack || onClose || (() => {});

  const load = () => hrApi(`/candidates/${candidateId}`).then(setC).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [candidateId]);

  if (!c) return <div className="py-20 text-center text-slate-400 text-sm">{err || 'Loading…'}</div>;

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
    <div>
      <button onClick={back} className="text-xs font-bold text-slate-400 hover:text-slate-600 mb-3">← Back to candidates</button>
      <div className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-slate-100" style={{ background: 'linear-gradient(180deg,#fafbff,#fff)' }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-4">
              <div className="w-16 h-16 rounded-xl bg-orange-100 text-orange-700 flex items-center justify-center text-xl font-extrabold shrink-0">
                {(c.name || '?').split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="text-xl font-extrabold text-[#050A1F]">{c.name}</div>
                  {a.age && <span className="text-slate-400 text-sm">{a.age}</span>}
                  {wa && <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" title="Message on WhatsApp" className="text-[#25D366]"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d={WA_PATH} /></svg></a>}
                  {c.rejected && <span className="rounded-full bg-red-100 text-red-600 px-2 py-0.5 text-[10px] font-bold">Rejected</span>}
                  {curStage && !c.rejected && <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: curStage.color + '18', color: curStage.color }}>{curStage.label}</span>}
                </div>
                <div className="mt-1 text-sm text-slate-500 space-y-0.5">
                  {c.email && <div>✉️ {c.email}</div>}
                  <div className="flex flex-wrap gap-x-4">
                    {(c.currentLocation || a.city) && <span>📍 {c.currentLocation || a.city}</span>}
                    {c.phone && <span>📞 {c.phone}</span>}
                  </div>
                  <div className="flex flex-wrap gap-x-4 text-xs text-slate-400 pt-1">
                    <span>Source: <b className="text-slate-600">{c.source === 'public_form' ? 'Application form' : 'Manual'}</b></span>
                    {c.recruiterName && <span>Recruiter: <b className="text-slate-600">{c.recruiterName}</b></span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 pt-2">
                    <RatingStars value={c.rating || 0} onChange={async (r) => { await hrApi(`/candidates/${c.id}`, { method: 'PATCH', body: JSON.stringify({ rating: r }) }); load(); }} />
                    <TagEditor tags={c.tags || []} onChange={async (tags) => { await hrApi(`/candidates/${c.id}`, { method: 'PATCH', body: JSON.stringify({ tags }) }); load(); }} />
                  </div>
                </div>
              </div>
            </div>
            <button onClick={() => setShowEdit(true)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 shrink-0">✎ Edit</button>
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
            <button key={id} onClick={() => setTab(id)}
              className={`px-3 py-2.5 text-sm font-bold whitespace-nowrap border-b-2 -mb-px ${tab === id ? 'border-orange-500 text-orange-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              {label}{id === 'comments' && (c.comments || []).length ? ` (${c.comments.length})` : ''}{id === 'feedback' && (c.feedback || []).length ? ` (${c.feedback.length})` : ''}
            </button>
          ))}
        </div>

        <div className="p-6 min-h-[340px]">
          {tab === 'resume' && <ResumeTab c={c} />}
          {tab === 'application' && <ApplicationTab c={c} a={a} job={job} onSaved={load} />}
          {tab === 'ai' && <AiTab c={c} reload={load} setErr={setErr} />}
          {tab === 'comments' && <CommentsTab c={c} reload={load} />}
          {tab === 'feedback' && <FeedbackTab c={c} onAdd={() => setShowFeedback(true)} />}
          {tab === 'mail' && <MailTab c={c} />}
          {tab === 'timeline' && <TimelineTab c={c} />}
          {tab === 'attachments' && <AttachmentsTab c={c} />}
        </div>
      </div>

      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)}
        onSubmit={async (payload) => { await act(() => hrApi(`/candidates/${c.id}/feedback`, { method: 'POST', body: JSON.stringify(payload) })); setShowFeedback(false); setTab('feedback'); }} />}
      {showInterview && <InterviewModal candidateId={c.id} stages={stages} onClose={() => setShowInterview(false)} onDone={load} />}
      {showEdit && <EditModal c={c} onClose={() => setShowEdit(false)} onSaved={() => { setShowEdit(false); load(); }} />}
    </div>
  );
}

// ---------- Resume ----------
function ResumeTab({ c }) {
  if (!c.resumeUrl) return <Empty>No resume uploaded.</Empty>;
  const isPdf = /\.pdf($|\?)/i.test(c.resumeUrl);
  return (
    <div>
      <div className="flex justify-end mb-2"><a href={c.resumeUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">Open / Download</a></div>
      {isPdf
        ? <iframe title="resume" src={`${c.resumeUrl}#view=FitH`} className="w-full h-[640px] rounded-lg border border-slate-200" />
        : <div className="text-center py-10"><a href={c.resumeUrl} target="_blank" rel="noreferrer" className="text-orange-600 font-bold">View resume file</a></div>}
    </div>
  );
}

// ---------- Application Form ----------
function ApplicationTab({ c, a, job, onSaved }) {
  const [editWork, setEditWork] = useState(false);
  // Sort work: current company first, then by most-recent start date desc.
  const work = [...(a.work || [])].sort((x, y) => {
    if (x.current && !y.current) return -1;
    if (y.current && !x.current) return 1;
    return (yStart(y) - yStart(x));
  });
  const edu = a.education || [];
  const info = [
    ['Notice Period', a.noticePeriod ? `${a.noticePeriod} days` : ''],
    ['Current Salary', a.currentCtc], ['Expected Salary', a.expectedCtc],
    ['Current Location', c.currentLocation || a.city], ['Portfolio', a.portfolio],
  ];
  return (
    <div className="space-y-6 text-sm">
      <Card title="Basic details">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
          {info.filter(([, v]) => v).map(([k, v]) => (
            <div key={k}><dt className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{k}</dt><dd className="text-slate-700 mt-0.5">{v}</dd></div>
          ))}
        </dl>
        {(a.skills || []).length > 0 && (
          <div className="mt-4"><dt className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Skills</dt>
            <div className="flex flex-wrap gap-1.5">{a.skills.map((s, i) => <span key={i} className="rounded-full bg-slate-100 text-slate-600 px-2.5 py-1 text-xs font-semibold">{s}</span>)}</div>
          </div>
        )}
      </Card>

      <Card title="Work Experience" action={<button onClick={() => setEditWork(true)} className="text-xs font-bold text-orange-600">✎ Edit</button>}>
        {work.length === 0 ? <Empty>No work history.</Empty> : (
          <div className="relative pl-5">
            <div className="absolute left-1.5 top-1 bottom-1 w-px bg-slate-200" />
            {work.map((w, i) => (
              <div key={i} className="relative mb-4 last:mb-0">
                <div className="absolute -left-[15px] top-1.5 w-3 h-3 rounded-full border-2 border-white" style={{ background: w.current ? '#16A34A' : '#CBD5E1' }} />
                <div className="flex items-center gap-2">
                  <div className="font-bold text-slate-700">{w.title || '—'}{w.company ? ` · ${w.company}` : ''}</div>
                  {w.current && <span className="rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[10px] font-bold">Current</span>}
                </div>
                <div className="text-xs text-slate-400">{w.start || '?'} – {w.current ? 'Present' : (w.end || '?')}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {edu.length > 0 && (
        <Card title="Education">
          {edu.map((e, i) => (
            <div key={i} className="mb-3 last:mb-0">
              <div className="font-bold text-slate-700">{e.course || ''}{e.specialization ? ` (${e.specialization})` : ''}</div>
              <div className="text-xs text-slate-400">{e.institute} · {e.start} – {e.end}</div>
            </div>
          ))}
        </Card>
      )}

      {job && (job.questions || []).length > 0 && (
        <Card title="Screening Questions">
          {(job.questions || []).map((q) => (
            <div key={q.id} className="mb-3 last:mb-0">
              <div className="text-xs font-bold text-slate-500">{q.question}</div>
              <div className="text-slate-700">{a[q.id] || <span className="text-slate-300">No answer</span>}</div>
            </div>
          ))}
        </Card>
      )}

      {(a.linkedin || a.github || a.twitter || a.facebook || a.instagram) && (
        <Card title="Links">
          <div className="flex flex-wrap gap-3 text-xs">
            {[['LinkedIn', a.linkedin], ['GitHub', a.github], ['Twitter', a.twitter], ['Facebook', a.facebook], ['Instagram', a.instagram]].filter(([, v]) => v).map(([k, v]) => <a key={k} href={v} target="_blank" rel="noreferrer" className="text-orange-600 font-semibold">{k}</a>)}
          </div>
        </Card>
      )}

      {editWork && <WorkEditModal c={c} work={a.work || []} onClose={() => setEditWork(false)} onSaved={() => { setEditWork(false); onSaved(); }} />}
    </div>
  );
}
function yStart(w) { const m = String(w.start || '').match(/(\d{4})/); return m ? Number(m[1]) : 0; }

function WorkEditModal({ c, work, onClose, onSaved }) {
  const [rows, setRows] = useState(work.length ? work.map((w) => ({ ...w })) : [{ company: '', title: '', start: '', end: '', current: false }]);
  const [busy, setBusy] = useState(false);
  const set = (i, k, v) => setRows((r) => r.map((x, idx) => idx === i ? { ...x, [k]: v } : x));
  const add = () => setRows((r) => [...r, { company: '', title: '', start: '', end: '', current: false }]);
  const del = (i) => setRows((r) => r.filter((_, idx) => idx !== i));
  const save = async () => { setBusy(true); try { await hrApi(`/candidates/${c.id}`, { method: 'PATCH', body: JSON.stringify({ answers: { work: rows } }) }); onSaved(); } catch { setBusy(false); } };
  const F = 'rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm';
  return (
    <Modal title="Edit work experience" onClose={onClose} wide>
      <div className="space-y-3">
        {rows.map((w, i) => (
          <div key={i} className="rounded-lg border border-slate-200 p-3">
            <div className="grid grid-cols-2 gap-2">
              <input className={F} value={w.title} onChange={(e) => set(i, 'title', e.target.value)} placeholder="Job title" />
              <input className={F} value={w.company} onChange={(e) => set(i, 'company', e.target.value)} placeholder="Company" />
              <input className={F} value={w.start} onChange={(e) => set(i, 'start', e.target.value)} placeholder="Start (e.g. 01/2021)" />
              <input className={F} value={w.end} onChange={(e) => set(i, 'end', e.target.value)} placeholder="End" disabled={w.current} />
            </div>
            <div className="flex items-center justify-between mt-2">
              <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={!!w.current} onChange={(e) => set(i, 'current', e.target.checked)} /> Currently work here</label>
              <button onClick={() => del(i)} className="text-xs font-bold text-red-500">Remove</button>
            </div>
          </div>
        ))}
        <button onClick={add} className="text-xs font-bold text-orange-600">+ Add role</button>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
        <button onClick={save} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </Modal>
  );
}

// ---------- AI Recruiter ----------
function AiTab({ c, reload, setErr }) {
  const [busy, setBusy] = useState(false);
  const s = c.aiSummary;
  const run = async () => {
    setBusy(true); setErr('');
    try { await hrApi(`/candidates/${c.id}/ai-screen`, { method: 'POST' }); await reload(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const score10 = s ? (s.score10 != null ? s.score10 : Math.round((s.matchScore || 0) / 10)) : null;
  const color = score10 >= 7 ? '#16A34A' : score10 >= 4 ? '#F59E0B' : '#DC2626';
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
            <div className="w-24 h-24 rounded-full flex flex-col items-center justify-center text-white shrink-0" style={{ background: color }}>
              <div className="text-3xl font-extrabold leading-none">{score10}</div><div className="text-[10px] font-bold opacity-80">out of 10</div>
            </div>
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

// ---------- Comments (editable) ----------
function CommentsTab({ c, reload }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editText, setEditText] = useState('');
  const list = c.comments || [];
  const add = async () => { if (!text.trim()) return; setBusy(true); try { await hrApi(`/candidates/${c.id}/comments`, { method: 'POST', body: JSON.stringify({ text: text.trim() }) }); setText(''); await reload(); } finally { setBusy(false); } };
  const saveEdit = async (id) => { if (!editText.trim()) return; try { await hrApi(`/candidates/${c.id}/comments/${id}`, { method: 'PATCH', body: JSON.stringify({ text: editText.trim() }) }); setEditId(null); await reload(); } catch {} };
  return (
    <div>
      <div className="flex gap-2 mb-4">
        <input className={inp} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note or comment…" onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
        <button onClick={add} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-bold text-white shrink-0 disabled:opacity-50" style={{ background: ORANGE }}>Post</button>
      </div>
      {list.length === 0 ? <Empty>No comments yet.</Empty> : (
        <div className="space-y-3">
          {list.map((cm) => (
            <div key={cm.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-bold text-slate-700">{cm.by}</div>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span>{fmt(cm.at)}{cm.edited ? ' · edited' : ''}</span>
                  {editId !== cm.id && <button onClick={() => { setEditId(cm.id); setEditText(cm.text); }} className="font-bold text-orange-600">Edit</button>}
                </div>
              </div>
              {editId === cm.id ? (
                <div className="mt-2">
                  <textarea className={inp} rows={2} value={editText} onChange={(e) => setEditText(e.target.value)} />
                  <div className="flex justify-end gap-2 mt-1.5">
                    <button onClick={() => setEditId(null)} className="text-xs font-bold text-slate-400">Cancel</button>
                    <button onClick={() => saveEdit(cm.id)} className="text-xs font-bold text-orange-600">Save</button>
                  </div>
                </div>
              ) : <div className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">{cm.text}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Feedback (tab: list + add button → popup) ----------
function FeedbackTab({ c, onAdd }) {
  const list = c.feedback || [];
  const interviews = c.interviews || [];
  const vinfo = (v) => VERDICTS.find((x) => x[0] === v) || ['', v, '#64748B', ''];
  const panelInterviews = interviews.filter((iv) => (iv.panelists || []).length);
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-slate-500">HR and senior team members can submit their own feedback.</div>
        <button onClick={onAdd} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: ORANGE }}>+ Add feedback</button>
      </div>

      {/* Interview panel status */}
      {panelInterviews.length > 0 && (
        <div className="mb-5 space-y-2">
          <H>Interview panel</H>
          {panelInterviews.map((iv) => (
            <div key={iv.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-bold text-slate-700">{iv.roundLabel || 'Interview'}</div>
                <div className="text-xs text-slate-400">{fmt(iv.at)}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                {(iv.panelists || []).map((p) => {
                  const done = (iv.feedbackByPanelist || {})[p.id];
                  return (
                    <span key={p.id} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${done ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${done ? 'bg-green-500' : 'bg-amber-500'}`} />
                      {p.name} · {done ? 'Submitted' : 'Pending'}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {list.length === 0 ? <Empty>No feedback yet.</Empty> : (
        <div className="space-y-3">
          {list.map((f) => {
            const [, vlabel, vcolor, vpath] = vinfo(f.verdict);
            return (
              <div key={f.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-bold text-slate-700">{f.by}</div>
                    {f.roundLabel && <span className="rounded-full bg-slate-100 text-slate-500 px-2 py-0.5 text-[10px] font-bold">{f.roundLabel}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: vcolor + '18', color: vcolor }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={vpath} /></svg>{vlabel}
                    </span>
                    <span className="text-xs text-slate-400">{fmt(f.at)}</span>
                  </div>
                </div>
                {(f.skills || []).length > 0 && (
                  <div className="mt-2 space-y-1">
                    {f.skills.map((s, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-slate-600">{s.name}</span>
                        <Stars value={s.rating} readOnly />
                      </div>
                    ))}
                  </div>
                )}
                {f.note && <div className="text-sm text-slate-600 mt-2 whitespace-pre-wrap">{f.note}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- Mail (CRM Composer style) ----------
function MailTab({ c }) {
  const [data, setData] = useState(null);
  const [compose, setCompose] = useState(null);
  const load = () => hrApi(`/candidates/${c.id}/emails`).then(setData).catch((e) => setData({ connected: false, error: e.message }));
  useEffect(() => { load(); }, [c.id]);
  if (!data) return <Empty>Loading…</Empty>;
  if (!data.connected) return (
    <div className="text-center py-8">
      <div className="text-sm text-slate-500 mb-2">The shared recruitment mailbox isn't linked yet.</div>
      <div className="text-xs text-slate-400">Ask an admin to connect it in HR Admin → Recruitment mailbox.</div>
    </div>
  );
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs text-slate-400">Conversation from <b className="text-slate-600">{data.mailbox}</b></div>
        <button onClick={() => setCompose({ mode: 'new', to: [c.email], subject: '' })} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white inline-flex items-center gap-1.5" style={{ background: ORANGE }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16v16H4z" /><path d="M22 6l-10 7L2 6" /></svg> Compose
        </button>
      </div>
      {(data.messages || []).length === 0 ? <Empty>No emails with this candidate yet.</Empty> : (
        <div className="space-y-3">
          {data.messages.map((m) => (
            <div key={m.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-bold text-slate-700">{m.direction === 'outbound' ? 'Us' : (m.fromName || m.from)}</div>
                <div className="flex items-center gap-3">
                  <div className="text-xs text-slate-400">{fmt(m.date)}</div>
                  <button onClick={() => setCompose({ mode: 'reply', to: [c.email], subject: /^re:/i.test(m.subject || '') ? m.subject : `Re: ${m.subject || ''}`, inReplyTo: m.messageId || m.id, threadId: m.threadId })} className="inline-flex items-center gap-1 text-xs font-bold text-orange-600">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 17l-5-5 5-5" /><path d="M4 12h11a4 4 0 0 1 4 4v2" /></svg>Reply
                  </button>
                </div>
              </div>
              {m.subject && <div className="text-xs font-semibold text-slate-500 mt-0.5">{m.subject}</div>}
              <div className="text-sm text-slate-600 mt-1 line-clamp-4" dangerouslySetInnerHTML={{ __html: m.bodyHtml || m.snippet || '' }} />
            </div>
          ))}
        </div>
      )}
      {compose && <HrComposer candidate={c} initial={compose} onClose={() => setCompose(null)} onSent={() => { setCompose(null); load(); }} />}
    </div>
  );
}

const HR_AI_MODES = [
  ['interview_invite', 'Interview invite'], ['shortlist', 'Shortlist'], ['assignment', 'Assignment'],
  ['offer', 'Offer'], ['rejection', 'Rejection'], ['followup', 'Follow-up'],
  ['request_docs', 'Request documents'], ['custom', 'Custom prompt'],
];

// Gmail-style composer, mirroring the Sales CRM's Composer layout/design.
function HrComposer({ candidate, initial, onClose, onSent }) {
  const [to, setTo] = useState(initial.to || [candidate.email]);
  const [cc, setCc] = useState([]);
  const [bcc, setBcc] = useState([]);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState(initial.subject || '');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const [showAi, setShowAi] = useState(false);
  const [aiMode, setAiMode] = useState('interview_invite');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);

  const runAi = async () => {
    setAiBusy(true); setErr('');
    try {
      const r = await hrApi(`/candidates/${candidate.id}/emails/ai-draft`, { method: 'POST', body: JSON.stringify({ mode: aiMode, prompt: aiPrompt }) });
      if (r.subject) setSubject((s) => s || r.subject);
      if (r.body) setBody(r.body);
      setShowAi(false);
    } catch (e) { setErr(e.message); } finally { setAiBusy(false); }
  };
  const doSend = async () => {
    setErr('');
    if (!to.length) return setErr('Add at least one recipient.');
    if (!subject.trim()) return setErr('Add a subject.');
    setSending(true);
    try {
      await hrApi(`/candidates/${candidate.id}/emails/send`, { method: 'POST', body: JSON.stringify({ to: to.join(', '), cc: cc.join(', '), bcc: bcc.join(', '), subject, body, inReplyTo: initial.inReplyTo, threadId: initial.threadId }) });
      onSent();
    } catch (e) { setErr(e.message); setSending(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-[130] p-4 overflow-y-auto">
      <div className="bg-white rounded-xl w-full max-w-3xl shadow-2xl my-6 flex flex-col max-h-[88vh]">
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#050A1F] text-white rounded-t-xl flex-shrink-0">
          <span className="text-sm font-semibold">{initial.mode === 'reply' ? 'Reply' : 'New message'}</span>
          <button onClick={onClose} className="text-slate-300 hover:text-white text-lg leading-none">×</button>
        </div>
        <div className="px-5 pt-3 space-y-2 overflow-y-auto flex-1 min-h-0">
          {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{err}</div>}
          <div className="flex items-start gap-2 border-b border-slate-100 pb-2">
            <span className="text-xs text-slate-400 w-12 pt-1.5">To</span>
            <div className="flex-1"><ChipInput value={to} onChange={setTo} placeholder="Recipients" /></div>
            <div className="flex gap-2 pt-1.5 text-xs font-semibold text-slate-400">
              {!showCc && <button onClick={() => setShowCc(true)} className="hover:text-slate-600">Cc</button>}
              {!showBcc && <button onClick={() => setShowBcc(true)} className="hover:text-slate-600">Bcc</button>}
            </div>
          </div>
          {showCc && <div className="flex items-start gap-2 border-b border-slate-100 pb-2"><span className="text-xs text-slate-400 w-12 pt-1.5">Cc</span><div className="flex-1"><ChipInput value={cc} onChange={setCc} placeholder="Cc" /></div></div>}
          {showBcc && <div className="flex items-start gap-2 border-b border-slate-100 pb-2"><span className="text-xs text-slate-400 w-12 pt-1.5">Bcc</span><div className="flex-1"><ChipInput value={bcc} onChange={setBcc} placeholder="Bcc" /></div></div>}
          <div className="border-b border-slate-100 pb-2">
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="w-full text-sm text-slate-700 outline-none" />
          </div>
          {showAi && (
            <div className="rounded-lg border border-orange-200 bg-orange-50/50 p-3">
              <div className="flex flex-wrap gap-1.5 mb-2">
                {HR_AI_MODES.map(([v, l]) => (
                  <button key={v} onClick={() => setAiMode(v)} className={`rounded-full px-2.5 py-1 text-xs font-bold ${aiMode === v ? 'text-white' : 'bg-white text-slate-600 border border-slate-200'}`} style={aiMode === v ? { background: ORANGE } : {}}>{l}</button>
                ))}
              </div>
              {(aiMode === 'custom' || aiMode === 'assignment' || aiMode === 'request_docs') && (
                <textarea className={inp + ' mb-2'} rows={2} value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder="Add details for the AI…" />
              )}
              <button onClick={runAi} disabled={aiBusy} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{aiBusy ? 'Drafting…' : 'Generate draft'}</button>
            </div>
          )}
          <div className="py-1">
            <MailEditor value={body} onChange={setBody} placeholder="Write your message…" minHeight={200} maxHeight={340}
              onAiDraft={() => setShowAi((v) => !v)} />
          </div>
        </div>
        <div className="flex items-center gap-2 px-5 py-3 flex-shrink-0 border-t border-slate-100 bg-white rounded-b-xl">
          <button onClick={doSend} disabled={sending} className="rounded-full px-6 py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: '#1A73E8' }}>{sending ? 'Sending…' : 'Send'}</button>
          <button onClick={() => setShowAi((v) => !v)} className="p-2 rounded-full hover:bg-slate-100 text-orange-600 text-xs font-bold">✨ AI Draft</button>
        </div>
      </div>
    </div>
  );
}

// ---------- Timeline (CRM lead-details style) ----------
function TimelineTab({ c }) {
  const list = c.timeline || [];
  if (!list.length) return <Empty>No activity yet.</Empty>;
  const iconFor = (t) => {
    switch (t) {
      case 'applied': case 'imported': return '📥';
      case 'assigned': return '👤';
      case 'stage': return '↗️';
      case 'feedback': return '⭐';
      case 'interview': return '📅';
      case 'email': return '✉️';
      case 'reject': return '⛔';
      default: return '•';
    }
  };
  return (
    <div className="relative pl-8">
      <div className="absolute left-[14px] top-1 bottom-1 w-px bg-slate-200" />
      {list.map((t) => (
        <div key={t.id} className="relative mb-5 last:mb-0">
          <div className="absolute -left-8 top-0 w-7 h-7 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center text-xs">{iconFor(t.type)}</div>
          <div className="text-sm text-slate-700">{t.text}</div>
          <div className="text-xs text-slate-400 mt-0.5">{fmt(t.at)}{t.by ? ` · ${t.by}` : ''}</div>
        </div>
      ))}
    </div>
  );
}

// ---------- Attachments ----------
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

// ---------- Feedback modal (add) ----------
function FeedbackModal({ onClose, onSubmit }) {
  const [attrs, setAttrs] = useState(DEFAULT_ATTRS.map((name) => ({ name, rating: 0 })));
  const [verdict, setVerdict] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const setRating = (i, r) => setAttrs((a) => a.map((x, idx) => idx === i ? { ...x, rating: r } : x));
  const addAttr = () => setAttrs((a) => [...a, { name: '', rating: 0 }]);
  const delAttr = (i) => setAttrs((a) => a.filter((_, idx) => idx !== i));
  const submit = async () => { setBusy(true); await onSubmit({ skills: attrs.filter((a) => a.name.trim()), verdict: verdict || 'not_sure', note }); setBusy(false); };
  return (
    <Modal title="Feedback Form" onClose={onClose}>
      <div className="text-sm font-bold text-slate-600 mb-2">Skills / Attributes</div>
      {attrs.map((at, i) => (
        <div key={i} className="flex items-center justify-between gap-2 mb-2">
          <input className={inp} value={at.name} onChange={(e) => setAttrs((a) => a.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} placeholder="Attribute" />
          <Stars value={at.rating} onChange={(r) => setRating(i, r)} />
          <button onClick={() => delAttr(i)} title="Remove" className="text-slate-300 hover:text-red-500 shrink-0 w-6 text-center">×</button>
        </div>
      ))}
      <button onClick={addAttr} className="text-xs font-bold text-orange-600 mb-4">+ Add Skill</button>

      <div className="text-sm font-bold text-slate-600 mb-2">Evaluation score</div>
      <div className="grid grid-cols-4 gap-2 mb-4">
        {VERDICTS.map(([v, l, color, path]) => (
          <button key={v} onClick={() => setVerdict(v)} className={`rounded-lg border px-2 py-2 text-xs font-bold flex flex-col items-center gap-1 ${verdict === v ? 'text-white' : 'text-slate-600 border-slate-300'}`} style={verdict === v ? { background: color, borderColor: color } : {}}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>{l}
          </button>
        ))}
      </div>
      <textarea className={inp} rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why do you think this candidate is a good fit?" />
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="rounded-lg border border-slate-300 px-5 py-2 text-sm font-bold text-slate-600">Cancel</button>
        <button onClick={submit} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Submitting…' : 'Submit Feedback'}</button>
      </div>
    </Modal>
  );
}

// ---------- Interview modal (calendar + Meet) ----------
function InterviewModal({ candidateId, stages, onClose, onDone }) {
  const [at, setAt] = useState('');
  const [duration, setDuration] = useState(30);
  const [mode, setMode] = useState('online');
  const [round, setRound] = useState('');
  const [notes, setNotes] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);
  // Panelists from the employee list.
  const [emps, setEmps] = useState([]);
  const [dept, setDept] = useState('');
  const [picked, setPicked] = useState([]); // employee ids
  useEffect(() => { hrApi('/employees').then((r) => setEmps(r.filter((e) => e.active))).catch(() => {}); }, []);
  const depts = Array.from(new Set(emps.map((e) => e.department).filter(Boolean))).sort();
  const shown = emps.filter((e) => !dept || e.department === dept);
  const toggle = (id) => setPicked((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);

  const schedule = async () => {
    if (!at) { setErr('Pick a date and time.'); return; }
    setBusy(true); setErr('');
    try { const r = await hrApi(`/candidates/${candidateId}/schedule-interview`, { method: 'POST', body: JSON.stringify({ start: at, durationMins: duration, mode, round, notes, sendEmail, panelistIds: picked }) }); setResult(r); onDone && onDone(); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal title="Schedule Interview" onClose={onClose} wide>
      {result ? (
        <div className="text-center py-4">
          <div className="text-3xl mb-2">✅</div>
          <div className="font-bold text-[#050A1F] mb-2">Interview scheduled</div>
          {result.meetLink && <a href={result.meetLink} target="_blank" rel="noreferrer" className="text-orange-600 font-semibold text-sm block mb-2">{result.meetLink}</a>}
          <div className="text-xs text-slate-400">A Google Calendar invite{sendEmail ? ' and email' : ''} was sent to the candidate{picked.length ? ' and the panel' : ''}.</div>
          <button onClick={onClose} className="mt-4 rounded-lg px-5 py-2 text-sm font-bold text-white" style={{ background: ORANGE }}>Done</button>
        </div>
      ) : (
        <>
          {err && <div className="rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm px-3 py-2 mb-3">{err}</div>}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><div className="text-xs font-bold text-slate-500 mb-1">Round</div>
                <select className={inp} value={round} onChange={(e) => setRound(e.target.value)}>
                  <option value="">General interview</option>
                  {(stages || []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
              <div><div className="text-xs font-bold text-slate-500 mb-1">Mode</div><select className={inp} value={mode} onChange={(e) => setMode(e.target.value)}><option value="online">Online (Google Meet)</option><option value="in_person">In person</option><option value="phone">Phone</option></select></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><div className="text-xs font-bold text-slate-500 mb-1">Date &amp; time</div><input className={inp} type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></div>
              <div><div className="text-xs font-bold text-slate-500 mb-1">Duration (mins)</div><input className={inp} type="number" value={duration} onChange={(e) => setDuration(e.target.value)} /></div>
            </div>

            {/* Interview panel */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs font-bold text-slate-500">Interview panel {picked.length ? `(${picked.length})` : ''}</div>
                <select className="text-xs rounded-lg border border-slate-300 px-2 py-1" value={dept} onChange={(e) => setDept(e.target.value)}>
                  <option value="">All departments</option>
                  {depts.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="border border-slate-200 rounded-lg max-h-40 overflow-auto divide-y divide-slate-50">
                {shown.length === 0 ? <div className="p-3 text-xs text-slate-400">No employees found.</div> : shown.map((e) => (
                  <label key={e._id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer">
                    <input type="checkbox" checked={picked.includes(e._id)} onChange={() => toggle(e._id)} />
                    <span className="font-semibold text-slate-700">{e.name}</span>
                    <span className="text-xs text-slate-400">{e.designation || e.type}{e.department ? ` · ${e.department}` : ''}</span>
                  </label>
                ))}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">Panelists are added to the Google Calendar invite and can submit their feedback after the interview.</div>
            </div>

            <div><div className="text-xs font-bold text-slate-500 mb-1">Notes</div><textarea className={inp} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} /> Email the candidate the invite &amp; Meet link</label>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={onClose} className="rounded-lg border border-slate-300 px-5 py-2 text-sm font-bold text-slate-600">Cancel</button>
            <button onClick={schedule} disabled={busy || !at} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Scheduling…' : 'Schedule with Meet'}</button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ---------- Edit candidate modal (moved from list) ----------
function EditModal({ c, onClose, onSaved }) {
  const [d, setD] = useState({ name: c.name || '', email: c.email || '', phone: c.phone || '', currentLocation: c.currentLocation || '', ...(c.answers || {}) });
  const [busy, setBusy] = useState(false);
  const F = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
  const save = async () => {
    setBusy(true);
    try {
      await hrApi(`/candidates/${c.id}`, { method: 'PATCH', body: JSON.stringify({ name: d.name, email: d.email, phone: d.phone, currentLocation: d.currentLocation, answers: { currentCtc: d.currentCtc, expectedCtc: d.expectedCtc, noticePeriod: d.noticePeriod, portfolio: d.portfolio } }) });
      onSaved();
    } catch { setBusy(false); }
  };
  return (
    <Modal title="Edit candidate" onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-3">
        <div><Lbl>Name</Lbl><input className={F} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></div>
        <div><Lbl>Phone</Lbl><input className={F} value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} /></div>
        <div><Lbl>Email</Lbl><input className={F} value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} /></div>
        <div><Lbl>Location</Lbl><input className={F} value={d.currentLocation} onChange={(e) => setD({ ...d, currentLocation: e.target.value })} /></div>
        <div><Lbl>Current Salary</Lbl><input className={F} value={d.currentCtc || ''} onChange={(e) => setD({ ...d, currentCtc: e.target.value })} /></div>
        <div><Lbl>Expected Salary</Lbl><input className={F} value={d.expectedCtc || ''} onChange={(e) => setD({ ...d, expectedCtc: e.target.value })} /></div>
        <div><Lbl>Notice Period (days)</Lbl><input className={F} value={d.noticePeriod || ''} onChange={(e) => setD({ ...d, noticePeriod: e.target.value })} /></div>
        <div><Lbl>Portfolio</Lbl><input className={F} value={d.portfolio || ''} onChange={(e) => setD({ ...d, portfolio: e.target.value })} /></div>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
        <button onClick={save} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </Modal>
  );
}

// ---------- small helpers ----------
function Modal({ title, children, onClose, wide }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130] p-4">
      <div className={`bg-white rounded-2xl w-full ${wide ? 'max-w-lg' : 'max-w-md'} shadow-2xl max-h-[90vh] flex flex-col`}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="text-lg font-extrabold text-[#050A1F]">{title}</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
        </div>
        <div className="p-6 overflow-auto">{children}</div>
      </div>
    </div>
  );
}
function Stars({ value, onChange, readOnly }) {
  return <div className="flex gap-0.5">{[1, 2, 3, 4, 5].map((n) => <button key={n} disabled={readOnly} onClick={() => onChange && onChange(n)} className={n <= value ? 'text-amber-400' : 'text-slate-300'}>★</button>)}</div>;
}
// Candidate quick-rating (click a star; click the same star again to clear).
function RatingStars({ value, onChange }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[11px] font-bold text-slate-400">Rating</span>
      <div className="flex gap-0.5">{[1, 2, 3, 4, 5].map((n) => (
        <button key={n} onClick={() => onChange(n === value ? 0 : n)} className={n <= value ? 'text-amber-400' : 'text-slate-300 hover:text-amber-300'}>★</button>
      ))}</div>
    </div>
  );
}
// Editable tag chips.
function TagEditor({ tags, onChange }) {
  const [adding, setAdding] = useState(false);
  const [val, setVal] = useState('');
  const add = () => { const t = val.trim(); if (t && !tags.includes(t)) onChange([...tags, t]); setVal(''); setAdding(false); };
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {tags.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-600 px-2 py-0.5 text-[11px] font-semibold">
          {t}<button onClick={() => onChange(tags.filter((x) => x !== t))} className="text-slate-400 hover:text-red-500">×</button>
        </span>
      ))}
      {adding ? (
        <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} onBlur={add} onKeyDown={(e) => { if (e.key === 'Enter') add(); if (e.key === 'Escape') { setAdding(false); setVal(''); } }}
          className="rounded-full border border-slate-300 px-2 py-0.5 text-[11px] w-24" placeholder="tag…" />
      ) : (
        <button onClick={() => setAdding(true)} className="rounded-full border border-dashed border-slate-300 text-slate-400 hover:text-slate-600 px-2 py-0.5 text-[11px] font-semibold">+ Tag</button>
      )}
    </div>
  );
}
function Card({ title, action, children }) {
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3"><div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{title}</div>{action}</div>
      {children}
    </div>
  );
}
function H({ children }) { return <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">{children}</div>; }
function Lbl({ children }) { return <div className="text-[11px] font-bold text-slate-500 mb-1">{children}</div>; }
function Empty({ children }) { return <div className="text-center text-slate-400 text-sm py-10">{children}</div>; }
function fmt(iso) { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString(); }

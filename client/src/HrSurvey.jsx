import React, { useState, useEffect, useRef } from 'react';
import { hrApi as api } from './HrApp.jsx';

const ORANGE = 'linear-gradient(90deg,#FF6A00,#FF4500)';
const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF6A00] focus:border-transparent';
const SCALE_COLORS = ['#DC2626', '#F97316', '#CDDC39', '#84CC16', '#16A34A'];
const SURVEY_TEMPLATES = [
  { id: 'employee_mood', name: 'Employee Mood', available: true, desc: 'A quick pulse on how the team is feeling, with adaptive follow-ups.' },
  { id: 'employee_satisfaction', name: 'Employee Satisfaction', available: false, desc: 'Coming soon.' },
  { id: 'work_culture', name: 'Work Culture', available: false, desc: 'Coming soon.' },
];
const Trash = ({ size = 16 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M6 7l1 13a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 17 20l1-13" /></svg>;
const IconEdit = ({ size = 16 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>;
const IconTest = ({ size = 16 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 3h6M10 3v6l-4 8a2 2 0 0 0 1.8 3h8.4a2 2 0 0 0 1.8-3l-4-8V3" /></svg>;
const IconResults = ({ size = 16 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18M7 15l3-3 3 2 4-5" /></svg>;
const IconClose = ({ size = 16 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>;
const IconRerun = ({ size = 16 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5" /></svg>;
const IconLive = ({ size = 16 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 3l14 9-14 9V3z" /></svg>;
const IconOpen = ({ size = 16 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 6l6 6-6 6" /></svg>;
const IconPdf = ({ size = 16 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" /></svg>;

// Small bordered icon button matching the CRM/HRMS action-icon style.
function IconBtn({ title, onClick, children, color = 'slate', danger }) {
  const cls = danger ? 'border-red-200 text-red-400 hover:bg-red-50 hover:text-red-500'
    : color === 'green' ? 'border-slate-300 text-green-600 hover:bg-green-50'
    : color === 'blue' ? 'border-slate-300 text-blue-600 hover:bg-blue-50'
    : color === 'orange' ? 'border-slate-300 text-[#FF4500] hover:bg-orange-50'
    : 'border-slate-300 text-slate-500 hover:bg-slate-50';
  return <button title={title} aria-label={title} onClick={onClick} className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border transition ${cls}`}>{children}</button>;
}

// ============================ ADMIN ============================
export default function HrSurveyAdmin() {
  const [surveys, setSurveys] = useState([]);
  const [err, setErr] = useState('');
  const [detailId, setDetailId] = useState(null); // survey being viewed in detail
  const [createOpen, setCreateOpen] = useState(false);
  const [editSurvey, setEditSurvey] = useState(null); // survey being edited in the popup
  const [templatePick, setTemplatePick] = useState(false); // template chooser popup
  const load = () => api('/surveys').then((r) => setSurveys(r.surveys || [])).catch(() => {});
  useEffect(() => { load(); }, []);

  if (detailId) {
    const s = surveys.find((x) => x._id === detailId);
    return <SurveyDetail survey={s} surveyId={detailId} onBack={() => { setDetailId(null); load(); }} reload={load} />;
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-extrabold text-[#050A1F]">Team surveys</h2>
          <p className="text-sm text-slate-500">Run mood pulse surveys with your employees. Responses are analysed with AI.</p>
        </div>
        <button onClick={() => setTemplatePick(true)} className="rounded-lg px-4 py-2.5 text-sm font-bold text-white" style={{ background: ORANGE }}>+ Create survey</button>
      </div>
      {err && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{err}</div>}

      <SurveyList surveys={surveys} reload={load} setErr={setErr}
        onOpen={(s) => setDetailId(s._id)}
        onEdit={(s) => { setEditSurvey(s); setCreateOpen(true); }} />

      {/* Template chooser → opens the create popup for the available template. */}
      {templatePick && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130] p-4" onClick={() => setTemplatePick(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><div className="text-lg font-extrabold text-[#050A1F]">Choose a template</div><button onClick={() => setTemplatePick(false)} className="text-slate-400 text-xl leading-none">×</button></div>
            <div className="space-y-2">
              {SURVEY_TEMPLATES.map((t) => (
                <button key={t.id} disabled={!t.available} onClick={() => { if (!t.available) return; setEditSurvey(null); setTemplatePick(false); setCreateOpen(true); }}
                  className={`w-full text-left rounded-xl border p-3.5 transition ${t.available ? 'border-slate-200 hover:border-orange-300 hover:bg-orange-50/40' : 'opacity-60 cursor-not-allowed border-slate-200'}`}>
                  <div className="flex items-center justify-between"><span className="font-bold text-[#050A1F] text-sm">{t.name}</span>{!t.available && <span className="text-[10px] font-bold rounded-full bg-slate-200 text-slate-500 px-2 py-0.5">Coming Soon</span>}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{t.desc}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {createOpen && (
        <SurveyCreateModal survey={editSurvey} reload={load} setErr={setErr}
          onClose={() => { setCreateOpen(false); setEditSurvey(null); }} />
      )}
    </div>
  );
}

// The survey list table with icon actions.
function SurveyList({ surveys, reload, setErr, onOpen, onEdit }) {
  const [testTake, setTestTake] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const activate = (s) => setConfirmModal({ title: 'Make this survey live?', body: `“${s.name}” will be sent to all employees. Any test responses are cleared and a fresh response period begins.`, confirmLabel: 'Make live', tone: 'orange', onConfirm: async () => { await api(`/surveys/${s._id}/activate`, { method: 'POST' }); reload(); } });
  const rerun = (s) => setConfirmModal({ title: 'Re-run this survey?', body: `“${s.name}” re-opens for a new response period. Previous responses stay saved under their own period.`, confirmLabel: 'Re-run', tone: 'orange', onConfirm: async () => { await api(`/surveys/${s._id}/activate`, { method: 'POST' }); reload(); } });
  const closeSurvey = (s) => setConfirmModal({ title: 'Close this survey?', body: `“${s.name}” stops accepting responses. You can re-run it later.`, confirmLabel: 'Close', tone: 'slate', onConfirm: async () => { await api(`/surveys/${s._id}`, { method: 'PUT', body: JSON.stringify({ status: 'closed' }) }); reload(); } });
  const del = (s) => setConfirmModal({ title: 'Delete this survey?', body: `“${s.name}” will be removed. This can’t be undone.`, confirmLabel: 'Delete', tone: 'red', onConfirm: async () => { await api(`/surveys/${s._id}`, { method: 'DELETE' }); reload(); } });

  if (!surveys.length) return <div className="bg-white rounded-2xl border border-slate-200/70 p-10 text-center text-slate-400 text-sm">No surveys yet. Click “Create survey” to run your first one.</div>;
  return (
    <div className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase text-slate-400 border-b border-slate-100 bg-slate-50/50">
              <th className="text-left px-4 py-3 font-bold">Sl</th>
              <th className="text-left px-2 py-3 font-bold">Date</th>
              <th className="text-left px-2 py-3 font-bold">Survey name</th>
              <th className="text-center px-2 py-3 font-bold">Participants</th>
              <th className="text-center px-2 py-3 font-bold">Completed</th>
              <th className="text-center px-2 py-3 font-bold">Pending</th>
              <th className="text-left px-2 py-3 font-bold">Status</th>
              <th className="text-right px-4 py-3 font-bold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {surveys.map((s, i) => {
              const statusPill = s.status === 'active' ? <span className="inline-block rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[10px] font-bold">Active</span>
                : s.status === 'draft' ? <span className="inline-block rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-[10px] font-bold">Draft</span>
                : <span className="inline-block rounded-full bg-slate-100 text-slate-500 px-2 py-0.5 text-[10px] font-bold">Closed</span>;
              return (
                <tr key={s._id} className="border-b border-slate-50 hover:bg-slate-50/40">
                  <td className="px-4 py-3 text-slate-400 font-bold">{i + 1}</td>
                  <td className="px-2 py-3 text-slate-500 whitespace-nowrap text-xs">{fmtDate(s.createdAt)}</td>
                  <td className="px-2 py-3">
                    <button onClick={() => onOpen(s)} className="font-bold text-[#050A1F] hover:text-[#FF4500] text-left">{s.name}</button>
                    <div className="text-[11px] text-slate-400">{s.frequency.replace('_', '-')} · {(s.questions || []).length} question{(s.questions || []).length === 1 ? '' : 's'}</div>
                  </td>
                  <td className="px-2 py-3 text-center font-bold text-slate-600">{s.participants != null ? s.participants : '—'}</td>
                  <td className="px-2 py-3 text-center font-bold text-green-600">{s.completed != null ? s.completed : (s.responseCount || 0)}</td>
                  <td className="px-2 py-3 text-center font-bold text-amber-600">{s.pending != null ? s.pending : '—'}</td>
                  <td className="px-2 py-3">{statusPill}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <IconBtn title="View results" color="slate" onClick={() => onOpen(s)}><IconResults /></IconBtn>
                      <IconBtn title="Edit" color="slate" onClick={() => onEdit(s)}><IconEdit /></IconBtn>
                      <IconBtn title="Test the survey" color="blue" onClick={() => setTestTake(s)}><IconTest /></IconBtn>
                      {s.status === 'draft' && <IconBtn title="Make live" color="orange" onClick={() => activate(s)}><IconLive /></IconBtn>}
                      {s.status === 'active' && <IconBtn title="Close survey" color="slate" onClick={() => closeSurvey(s)}><IconClose /></IconBtn>}
                      {s.status === 'closed' && <IconBtn title="Re-run survey" color="orange" onClick={() => rerun(s)}><IconRerun /></IconBtn>}
                      <IconBtn title="Delete" danger onClick={() => del(s)}><Trash /></IconBtn>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {testTake && <SurveyTakeModal survey={testTake} testMode onClose={() => setTestTake(null)} onDone={() => setTestTake(null)} />}
      {confirmModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130] p-4" onClick={() => setConfirmModal(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 pt-5 pb-3"><div className="text-lg font-extrabold text-[#050A1F]">{confirmModal.title}</div><div className="text-sm text-slate-500 mt-1.5 leading-relaxed">{confirmModal.body}</div></div>
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={() => setConfirmModal(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
              <button onClick={async () => { const fn = confirmModal.onConfirm; setConfirmModal(null); try { await fn(); } catch (e) { setErr(e.message); } }} className="rounded-lg px-5 py-2 text-sm font-bold text-white" style={{ background: confirmModal.tone === 'red' ? '#DC2626' : confirmModal.tone === 'slate' ? '#475569' : 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>{confirmModal.confirmLabel}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Create/Edit survey popup. Reuses the question builder in a modal.
function SurveyCreateModal({ survey, reload, setErr, onClose }) {
  const editId = survey ? survey._id : null;
  const [name, setName] = useState(survey ? survey.name || '' : '');
  const [description, setDescription] = useState(survey ? survey.description || '' : '');
  const [frequency, setFrequency] = useState(survey ? survey.frequency || 'one_time' : 'one_time');
  const [questions, setQuestions] = useState(
    survey && (survey.questions || []).length
      ? survey.questions.map((q) => ({ ...q, options: q.options || [] }))
      : [{ id: 'q1', text: 'Our workplace is free from distraction', type: 'scale5', comment: true, options: [] }]
  );
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState('');
  const Q_TYPES = [['scale5', 'Rating scale (1–5)'], ['single_choice', 'Multiple choice (pick one)'], ['multi_choice', 'Multiple choice (pick many)'], ['short_answer', 'Short answer']];
  const isChoice = (t) => t === 'single_choice' || t === 'multi_choice';
  const addQ = () => setQuestions((qs) => [...qs, { id: `q${Date.now()}`, text: '', type: 'scale5', comment: false, options: [] }]);
  const patchQ = (i, patch) => setQuestions((qs) => qs.map((q, idx) => idx === i ? { ...q, ...patch } : q));
  const delQ = (i) => setQuestions((qs) => qs.filter((_, idx) => idx !== i));
  const setOpt = (qi, oi, val) => setQuestions((qs) => qs.map((q, idx) => idx === qi ? { ...q, options: q.options.map((o, j) => j === oi ? val : o) } : q));
  const addOpt = (qi) => setQuestions((qs) => qs.map((q, idx) => idx === qi ? { ...q, options: [...(q.options || []), ''] } : q));
  const delOpt = (qi, oi) => setQuestions((qs) => qs.map((q, idx) => idx === qi ? { ...q, options: q.options.filter((_, j) => j !== oi) } : q));
  const validQuestions = () => questions.filter((q) => { if (!q.text.trim()) return false; if (isChoice(q.type) && (q.options || []).filter((o) => o.trim()).length < 2) return false; return true; });

  const save = async () => {
    setLocalErr('');
    if (!name.trim()) return setLocalErr('Survey name is required.');
    const qs = validQuestions();
    if (!qs.length) return setLocalErr('Add at least one complete question (choice questions need 2+ options).');
    setBusy(true);
    try {
      if (editId) await api(`/surveys/${editId}`, { method: 'PUT', body: JSON.stringify({ name, description, frequency, questions: qs }) });
      else await api('/surveys', { method: 'POST', body: JSON.stringify({ name, description, template: 'employee_mood', frequency, questions: qs }) });
      reload(); onClose();
    } catch (e) { setLocalErr(e.message); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="text-lg font-extrabold text-[#050A1F]">{editId ? 'Edit survey' : 'Create survey'}</div>
          <button onClick={onClose} className="text-slate-400 text-xl leading-none">×</button>
        </div>
        <div className="p-6 space-y-3 overflow-y-auto">
          {localErr && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{localErr}</div>}
          <div><div className="text-xs font-bold text-slate-500 mb-1">Survey name</div><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. August Mood Check" /></div>
          <div><div className="text-xs font-bold text-slate-500 mb-1">Survey description</div><textarea className={inputCls} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A short note shown to the team." /></div>
          <div><div className="text-xs font-bold text-slate-500 mb-1">Frequency</div>
            <div className="flex gap-2">{[['one_time', 'One-time'], ['weekly', 'Weekly'], ['monthly', 'Monthly']].map(([v, l]) => (
              <button key={v} onClick={() => setFrequency(v)} className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${frequency === v ? 'border-orange-400 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-500'}`}>{l}</button>))}
            </div>
          </div>
          <div>
            <div className="text-xs font-bold text-slate-500 mb-2">Questions</div>
            <div className="space-y-3">
              {questions.map((q, i) => (
                <div key={q.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start gap-2">
                    <span className="text-xs font-bold text-slate-300 pt-2">{i + 1}</span>
                    <div className="flex-1 space-y-2">
                      <textarea className={inputCls} rows={1} value={q.text} onChange={(e) => patchQ(i, { text: e.target.value })} placeholder="Question text" />
                      <div className="flex items-center gap-2 flex-wrap">
                        <select className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600" value={q.type} onChange={(e) => patchQ(i, { type: e.target.value, options: isChoice(e.target.value) && !(q.options || []).length ? ['', ''] : q.options })}>
                          {Q_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500"><input type="checkbox" checked={!!q.comment} onChange={(e) => patchQ(i, { comment: e.target.checked })} /> Ask for a comment/note</label>
                        {q.type === 'scale5' && <span className="text-[10px] text-slate-400">Low scores (≤3) trigger AI follow-ups</span>}
                      </div>
                      {isChoice(q.type) && (
                        <div className="rounded-lg bg-slate-50 border border-slate-100 p-2.5">
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">Options</div>
                          <div className="space-y-1.5">{(q.options || []).map((o, oi) => (
                            <div key={oi} className="flex items-center gap-2"><span className="text-slate-300 text-xs">{q.type === 'multi_choice' ? '☐' : '○'}</span>
                              <input className={inputCls + ' py-1.5'} value={o} onChange={(e) => setOpt(i, oi, e.target.value)} placeholder={`Option ${oi + 1}`} />
                              <button onClick={() => delOpt(i, oi)} className="text-slate-300 hover:text-red-500"><Trash size={14} /></button>
                            </div>))}
                          </div>
                          <button onClick={() => addOpt(i)} className="text-[11px] font-bold text-[#FF4500] mt-1.5">+ Add option</button>
                        </div>
                      )}
                    </div>
                    {questions.length > 1 && <button onClick={() => delQ(i)} className="text-slate-300 hover:text-red-500 pt-2"><Trash size={16} /></button>}
                  </div>
                </div>
              ))}
            </div>
            <button onClick={addQ} className="text-xs font-bold text-[#FF4500] mt-3">+ Add question</button>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg px-6 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : (editId ? 'Save changes' : 'Save as draft')}</button>
        </div>
      </div>
    </div>
  );
}

// Survey detail page — lead-detail style. Shows results for a chosen period,
// AI analysis, and a PDF download.
function SurveyDetail({ survey, surveyId, onBack, reload }) {
  const [periods, setPeriods] = useState([]);
  const [period, setPeriod] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api(`/surveys/${surveyId}/periods`).then((r) => { setPeriods(r.periods || []); setPeriod((r.periods && r.periods[0]) || ''); }).catch(() => {}); }, [surveyId]);
  const loadResults = () => { setBusy(true); api(`/surveys/${surveyId}/results${period ? `?period=${encodeURIComponent(period)}` : ''}`).then(setData).catch((e) => setErr(e.message)).finally(() => setBusy(false)); };
  useEffect(() => { loadResults(); }, [surveyId, period]);
  const analyze = async () => { setAnalyzing(true); setErr(''); try { await api(`/surveys/${surveyId}/analyze`, { method: 'POST', body: JSON.stringify({ period }) }); loadResults(); } catch (e) { setErr(e.message); } finally { setAnalyzing(false); } };
  // Preview shows the HTML report in an iframe (browsers block PDFs in iframes).
  // Download fetches the PDF as a blob with the correct auth token.
  const preview = () => {
    setErr('');
    const token = localStorage.getItem('qtx_hr_token') || '';
    const url = `/api/hr/surveys/${surveyId}/report.html?period=${encodeURIComponent(period || '')}&token=${encodeURIComponent(token)}`;
    setPreviewUrl(url);
  };
  const downloadPdf = async () => {
    setPdfBusy(true); setErr('');
    try {
      const token = localStorage.getItem('qtx_hr_token');
      const res = await fetch(`/api/hr/surveys/${surveyId}/report.pdf${period ? `?period=${encodeURIComponent(period)}` : ''}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Could not generate the report.'); }
      const blobUrl = URL.createObjectURL(await res.blob());
      const a = document.createElement('a'); a.href = blobUrl; a.download = `${(survey && survey.name ? survey.name : 'survey').replace(/[^a-z0-9]+/gi, '-')}-${period}.pdf`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(blobUrl);
    } catch (e) { setErr(e.message); } finally { setPdfBusy(false); }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <button onClick={onBack} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-bold text-slate-500 hover:bg-slate-50">← Back</button>
        <div className="min-w-0">
          <h2 className="text-lg font-extrabold text-[#050A1F] truncate">{survey ? survey.name : 'Survey'}</h2>
          <p className="text-xs text-slate-400">Results &amp; AI sentiment analysis</p>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {periods.length > 0 && <select value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">{periods.map((p) => <option key={p} value={p}>{p}</option>)}</select>}
          <button onClick={analyze} disabled={analyzing || !data || data.total === 0} className="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: '#050A1F' }}>{analyzing ? 'Analysing…' : '✨ Analyse with AI'}</button>
          <button onClick={preview} disabled={!data || data.total === 0} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}><IconPdf size={15} />Preview report</button>
        </div>
      </div>
      {err && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{err}</div>}
      {busy ? <div className="text-slate-400 text-sm">Loading…</div> : !data ? null : <ResultsBody data={data} />}
      {previewUrl && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[140] p-4" onClick={() => setPreviewUrl(null)}>
          <div className="bg-white rounded-2xl w-full max-w-4xl h-[90vh] shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <div className="font-extrabold text-[#050A1F]">{survey ? survey.name : 'Survey'} — Report preview</div>
              <div className="flex items-center gap-2">
                <button onClick={downloadPdf} disabled={pdfBusy} className="rounded-lg px-4 py-1.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{pdfBusy ? 'Preparing…' : '↓ Download PDF'}</button>
                <button onClick={() => setPreviewUrl(null)} className="text-slate-400 text-xl leading-none px-1">×</button>
              </div>
            </div>
            <iframe title="survey-report" src={previewUrl} className="flex-1 w-full border-0 rounded-b-2xl bg-white" />
          </div>
        </div>
      )}
    </div>
  );
}


function SentimentCircle({ label, pct, color }) {
  const r = 34, c = 2 * Math.PI * r, off = c - (pct / 100) * c;
  return (
    <div className="bg-white rounded-2xl border border-slate-200/70 p-5 flex flex-col items-center">
      <svg width="90" height="90" viewBox="0 0 90 90" className="mb-2">
        <circle cx="45" cy="45" r={r} fill="none" stroke="#F1F5F9" strokeWidth="9" />
        <circle cx="45" cy="45" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 45 45)" />
        <text x="45" y="50" textAnchor="middle" className="font-extrabold" style={{ fontSize: 20, fill: '#050A1F' }}>{pct}%</text>
      </svg>
      <div className="text-sm font-bold text-[#050A1F]">{label}</div>
    </div>
  );
}

function SentimentBreakdown({ title, rows }) {
  if (!rows || !rows.length) return null;
  return (
    <div className="bg-white rounded-2xl border border-slate-200/70 p-5">
      <div className="text-sm font-extrabold text-[#050A1F] mb-3">{title}</div>
      <div className="space-y-2.5">{rows.map((r) => (
        <div key={r.key} className="flex items-center gap-3">
          <div className="w-32 truncate text-sm font-semibold text-slate-600">{r.key}</div>
          <div className="flex-1 h-4 rounded-full overflow-hidden flex bg-slate-100">
            <div style={{ width: `${r.positive}%`, background: '#16A34A' }} title={`Positive ${r.positive}%`} />
            <div style={{ width: `${r.neutral}%`, background: '#F59E0B' }} title={`Neutral ${r.neutral}%`} />
            <div style={{ width: `${r.negative}%`, background: '#DC2626' }} title={`Negative ${r.negative}%`} />
          </div>
          <div className="text-xs text-slate-400 w-24 text-right">{r.count} resp · {r.avgScore != null ? `${r.avgScore}/5` : '—'}</div>
        </div>))}
      </div>
    </div>
  );
}

function SurveyResults({ surveys }) {
  const [surveyId, setSurveyId] = useState('');
  const [periods, setPeriods] = useState([]);
  const [period, setPeriod] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  useEffect(() => { if (!surveyId && surveys.length) setSurveyId(String(surveys[0]._id)); }, [surveys]);
  useEffect(() => { if (!surveyId) return; api(`/surveys/${surveyId}/periods`).then((r) => { setPeriods(r.periods || []); setPeriod((r.periods && r.periods[0]) || ''); }).catch(() => {}); }, [surveyId]);
  const loadResults = () => { if (!surveyId) return; setBusy(true); api(`/surveys/${surveyId}/results${period ? `?period=${encodeURIComponent(period)}` : ''}`).then(setData).catch(() => {}).finally(() => setBusy(false)); };
  useEffect(() => { loadResults(); }, [surveyId, period]);
  const analyze = async () => { setAnalyzing(true); try { await api(`/surveys/${surveyId}/analyze`, { method: 'POST', body: JSON.stringify({ period }) }); loadResults(); } catch (e) { alert(e.message); } finally { setAnalyzing(false); } };
  if (!surveys.length) return <div className="bg-white rounded-2xl border border-slate-200/70 p-8 text-center text-slate-400 text-sm">Create a survey first.</div>;
  return (
    <div>
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <select value={surveyId} onChange={(e) => setSurveyId(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">{surveys.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</select>
        {periods.length > 0 && <select value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">{periods.map((p) => <option key={p} value={p}>{p}</option>)}</select>}
        <button onClick={analyze} disabled={analyzing || !data || data.total === 0} className="ml-auto rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: '#050A1F' }}>{analyzing ? 'Analysing…' : '✨ Analyse with AI'}</button>
      </div>
      {busy ? <div className="text-slate-400 text-sm">Loading…</div> : !data ? null : <ResultsBody data={data} />}
    </div>
  );
}

// Shared results renderer (used by the live results tab and the test-results modal).
function ResultsBody({ data }) {
  if (data.total === 0) return <div className="bg-white rounded-2xl border border-slate-200/70 p-8 text-center text-slate-400 text-sm">No responses yet for this period.</div>;
  const good = data.good || [];
  const improve = data.improve || [];
  const deptSummaries = data.departmentSummaries || [];
  return (
    <div className="space-y-6">
      <div className="text-xs text-slate-400">{data.total} response{data.total === 1 ? '' : 's'} · {data.analysed} analysed{data.analysedAt ? ` · last analysed ${new Date(data.analysedAt).toLocaleString()}` : ''}</div>
      {data.analysed === 0 && <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-sm text-amber-700">Click “Analyse with AI” to decode sentiment and surface themes from the responses.</div>}
      <div className="grid grid-cols-3 gap-4">
        <SentimentCircle label="Positive Sentiment" pct={data.sentiment.positive} color="#16A34A" />
        <SentimentCircle label="Neutral Sentiment" pct={data.sentiment.neutral} color="#F59E0B" />
        <SentimentCircle label="Negative Sentiment" pct={data.sentiment.negative} color="#DC2626" />
      </div>

      {/* Detailed overall summary */}
      {data.summary && (
        <div className="bg-white rounded-2xl border border-slate-200/70 p-5">
          <div className="text-sm font-extrabold text-[#050A1F] mb-2">Overall mood — detailed read</div>
          <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{data.summary}</p>
        </div>
      )}

      {/* Top 5 good / Top 5 to improve */}
      {(good.length || improve.length) && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl border border-green-100 p-5">
            <div className="text-sm font-extrabold text-green-700 mb-2">Top 5 good points</div>
            <ol className="space-y-1.5">{(good.length ? good : ['—']).map((g, i) => <li key={i} className="text-sm text-slate-600 flex gap-2"><span className="font-bold text-green-500 shrink-0">{i + 1}.</span>{g}</li>)}</ol>
          </div>
          <div className="bg-white rounded-2xl border border-amber-100 p-5">
            <div className="text-sm font-extrabold text-amber-700 mb-2">Top 5 to improve</div>
            <ol className="space-y-1.5">{(improve.length ? improve : ['—']).map((g, i) => <li key={i} className="text-sm text-slate-600 flex gap-2"><span className="font-bold text-amber-500 shrink-0">{i + 1}.</span>{g}</li>)}</ol>
          </div>
        </div>
      )}

      {/* By department — graph + AI summary per department */}
      {(data.byDepartment && data.byDepartment.length > 0) && (
        <div className="bg-white rounded-2xl border border-slate-200/70 p-5">
          <div className="text-sm font-extrabold text-[#050A1F] mb-3">By department</div>
          <div className="space-y-3">
            {data.byDepartment.map((r) => {
              const ds = deptSummaries.find((d) => (d.name || '').toLowerCase() === (r.key || '').toLowerCase());
              return (
                <div key={r.key} className="rounded-xl border border-slate-100 p-3">
                  <div className="flex items-center gap-3">
                    <div className="w-32 truncate text-sm font-bold text-slate-700">{r.key}</div>
                    <div className="flex-1 h-4 rounded-full overflow-hidden flex bg-slate-100">
                      <div style={{ width: `${r.positive}%`, background: '#16A34A' }} title={`Positive ${r.positive}%`} />
                      <div style={{ width: `${r.neutral}%`, background: '#F59E0B' }} title={`Neutral ${r.neutral}%`} />
                      <div style={{ width: `${r.negative}%`, background: '#DC2626' }} title={`Negative ${r.negative}%`} />
                    </div>
                    <div className="text-xs text-slate-400 w-24 text-right">{r.count} resp · {r.avgScore != null ? `${r.avgScore}/5` : '—'}</div>
                  </div>
                  {ds && ds.summary && <p className="text-[13px] text-slate-500 leading-relaxed mt-2 pl-1">{ds.summary}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* By team (branch) — kept as a compact graph */}
      <SentimentBreakdown title="By team" rows={data.byBranch} />

      {/* Individual responses — now with the AI's read of what each person thinks */}
      {data.responses && data.responses.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200/70 p-5">
          <div className="text-sm font-extrabold text-[#050A1F] mb-1">Individual responses</div>
          <div className="text-[11px] text-slate-400 mb-3">Each card shows the AI’s read of what the person actually thinks and feels. Hesitation = lingered noticeably or heavily self-edited on a question — a hint they may have answered diplomatically.</div>
          <div className="space-y-2">{data.responses.map((r) => {
            const sent = r.sentiment && r.sentiment.label;
            const sc = sent === 'positive' ? 'bg-green-100 text-green-700' : sent === 'negative' ? 'bg-red-100 text-red-700' : sent === 'neutral' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-400';
            return (
              <div key={r._id} className="rounded-xl border border-slate-100 px-3 py-2.5">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="w-36 min-w-0"><div className="text-sm font-bold text-[#050A1F] truncate">{r.employeeName || 'User'}</div><div className="text-[10px] text-slate-400 truncate">{r.department || '—'}{r.branch ? ` · ${r.branch}` : ''}</div></div>
                  <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${sc}`}>{sent || 'not analysed'}</span>
                  {r.sentiment && r.sentiment.tone && <span className="text-[11px] text-slate-500 italic">{r.sentiment.tone}</span>}
                  {r.hesitationCount > 0 && <span className="text-[10px] font-bold rounded-full px-2 py-0.5 bg-purple-100 text-purple-700" title={r.hesitationQuestions.join(' · ')}>⚠ hesitation ×{r.hesitationCount}</span>}
                  <div className="ml-auto text-xs text-slate-400 shrink-0">{r.avgScore != null ? `${r.avgScore.toFixed(1)}/5` : '—'}</div>
                </div>
                {r.sentiment && r.sentiment.summary
                  ? <p className="text-[13px] text-slate-600 leading-relaxed mt-2">{r.sentiment.summary}</p>
                  : (r.sentiment && r.sentiment.note ? <p className="text-[13px] text-slate-500 leading-relaxed mt-2">{r.sentiment.note}</p> : null)}
              </div>
            );
          })}</div>
        </div>
      )}
    </div>
  );
}

// Modal showing TEST results for a survey (period = 'test'), with analyse + clear.
function TestResultsModal({ survey, onClose }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const load = () => { setBusy(true); api(`/surveys/${survey._id}/results?period=test`).then(setData).catch(() => setData(null)).finally(() => setBusy(false)); };
  useEffect(() => { load(); }, [survey._id]);
  const analyze = async () => { setAnalyzing(true); try { await api(`/surveys/${survey._id}/analyze`, { method: 'POST', body: JSON.stringify({ period: 'test' }) }); load(); } catch (e) { alert(e.message); } finally { setAnalyzing(false); } };
  const clear = async () => { if (!window.confirm('Clear all test responses for this survey?')) return; try { await api(`/surveys/${survey._id}/test-responses`, { method: 'DELETE' }); load(); } catch (e) { alert(e.message); } };
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[140] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div><div className="text-lg font-extrabold text-[#050A1F]">Test results — {survey.name}</div><div className="text-xs text-blue-600 font-bold mt-0.5">🧪 Preview data only</div></div>
          <div className="flex items-center gap-2">
            <button onClick={analyze} disabled={analyzing || !data || data.total === 0} className="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: '#050A1F' }}>{analyzing ? 'Analysing…' : '✨ Analyse with AI'}</button>
            {data && data.total > 0 && <button onClick={clear} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-500">Clear</button>}
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
          </div>
        </div>
        <div className="p-6 overflow-y-auto">
          {busy ? <div className="text-slate-400 text-sm">Loading…</div> : !data || data.total === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-8 text-center text-slate-400 text-sm">No test responses yet. Click “Test” on the survey to take it, then come back here.</div>
          ) : <ResultsBody data={data} />}
        </div>
      </div>
    </div>
  );
}

// ============================ EMPLOYEE ============================
// Shown on the sales dashboard: popup + persistent banner until completed.
export function HrSurveyGate() {
  const [pending, setPending] = useState([]);
  const [openIdx, setOpenIdx] = useState(-1);
  // Show the pending surveys as a persistent notification banner. We do NOT
  // auto-open the popup on load/refresh — the user opens it themselves via
  // "Complete now" (or the notification box). This way a refresh no longer
  // throws the survey modal in their face every time.
  useEffect(() => { api('/surveys/pending').then((r) => setPending(r.pending || [])).catch(() => {}); }, []);
  const current = openIdx >= 0 ? pending[openIdx] : null;
  const done = (id) => { setPending((ps) => ps.filter((p) => p._id !== id)); setOpenIdx(-1); };
  if (!pending.length) return null;
  return (
    <>
      <div className="rounded-xl bg-gradient-to-r from-[#FF6A00] to-[#FF4500] text-white px-4 py-2.5 flex items-center justify-between gap-3 mb-4">
        <div className="text-sm font-semibold flex items-center gap-2">📝 You have {pending.length} pending survey{pending.length === 1 ? '' : 's'} to complete.</div>
        <button onClick={() => setOpenIdx(0)} className="rounded-lg bg-white/20 hover:bg-white/30 px-3 py-1.5 text-xs font-bold">Complete now</button>
      </div>
      {current && <SurveyTakeModal survey={current} onClose={() => setOpenIdx(-1)} onDone={() => done(current._id)} />}
    </>
  );
}

function SurveyTakeModal({ survey, onClose, onDone, testMode }) {
  const [answers, setAnswers] = useState({});
  const [phase, setPhase] = useState('main');
  const [followupQs, setFollowupQs] = useState([]);
  const [followupA, setFollowupA] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [showTestResults, setShowTestResults] = useState(false);
  const fuPath = testMode ? 'test-followups' : 'followups';
  const respondPath = testMode ? 'test-respond' : 'respond';
  const behavior = useRef({});
  const focusAt = useRef({});
  const beh = (qid) => (behavior.current[qid] = behavior.current[qid] || { timeMs: 0, backspaces: 0, changes: 0, answered: false });
  const onFocusQ = (qid) => { focusAt.current[qid] = Date.now(); beh(qid); };
  const onBlurQ = (qid) => { const t = focusAt.current[qid]; if (t) { beh(qid).timeMs += Date.now() - t; focusAt.current[qid] = 0; } };
  const onKeyText = (qid, e) => { if (e.key === 'Backspace' || e.key === 'Delete') beh(qid).backspaces += 1; };
  const noteChange = (qid) => { const b = beh(qid); if (b.answered) b.changes += 1; else b.answered = true; };
  const flushTimers = () => { Object.keys(focusAt.current).forEach((qid) => onBlurQ(qid)); };
  const patch = (qid, p) => setAnswers((a) => ({ ...a, [qid]: { ...(a[qid] || {}), ...p } }));
  const toggleChoice = (qid, opt) => setAnswers((a) => { const cur = (a[qid] && a[qid].choices) || []; const next = cur.includes(opt) ? cur.filter((c) => c !== opt) : [...cur, opt]; return { ...a, [qid]: { ...(a[qid] || {}), choices: next } }; });

  const isAnswered = (q) => { const a = answers[q.id] || {}; if (q.type === 'scale5') return !!a.score; if (q.type === 'single_choice') return a.choice != null && a.choice !== ''; if (q.type === 'multi_choice') return Array.isArray(a.choices) && a.choices.length > 0; if (q.type === 'short_answer') return !!(a.text && a.text.trim()); return true; };
  const allAnswered = (survey.questions || []).every(isAnswered);
  const anyLow = (survey.questions || []).some((q) => q.type === 'scale5' && (answers[q.id] || {}).score && answers[q.id].score <= 3);

  const proceed = async () => {
    setErr('');
    if (!allAnswered) return setErr('Please answer every question.');
    if (anyLow && phase === 'main') {
      setBusy(true);
      try { const r = await api(`/surveys/${survey._id}/${fuPath}`, { method: 'POST', body: JSON.stringify({ answers }) }); if (r.questions && r.questions.length) { setFollowupQs(r.questions); setPhase('followups'); setBusy(false); return; } } catch {}
      setBusy(false);
    }
    submit();
  };
  const submit = async () => {
    setBusy(true); setErr(''); flushTimers();
    const behaviorPayload = {}; Object.keys(behavior.current).forEach((qid) => { const b = behavior.current[qid]; behaviorPayload[qid] = { timeMs: b.timeMs, backspaces: b.backspaces, changes: b.changes }; });
    const followups = followupQs.map((q) => ({ question: q.text, answer: followupA[q.id] || 'No answer' }));
    try { const r = await api(`/surveys/${survey._id}/${respondPath}`, { method: 'POST', body: JSON.stringify({ answers, followups, behavior: behaviorPayload }) }); setSuccessMsg(r.message || 'Thank you for your feedback!'); setPhase('done'); }
    catch (e) { setErr(e.message); setBusy(false); }
  };

  const renderQuestion = (q, i) => {
    const a = answers[q.id] || {};
    return (
      <div key={q.id} className="mb-5" onMouseEnter={() => onFocusQ(q.id)}>
        <div className="text-sm font-bold text-[#050A1F] mb-2">{i + 1}. {q.text}</div>
        {q.type === 'scale5' && (<>
          <div className="flex items-center gap-1.5">{[1, 2, 3, 4, 5].map((n) => (
            <button key={n} onClick={() => { noteChange(q.id); onBlurQ(q.id); patch(q.id, { score: n }); }} className={`w-11 h-11 rounded-lg font-extrabold text-white transition ${a.score === n ? 'ring-2 ring-offset-2 ring-slate-400 scale-105' : 'opacity-80 hover:opacity-100'}`} style={{ background: SCALE_COLORS[n - 1] }}>{n}</button>))}
          </div>
          <div className="flex justify-between text-[10px] text-slate-400 mt-1 px-1"><span>Strongly Disagree</span><span>Strongly Agree</span></div>
        </>)}
        {q.type === 'single_choice' && (<div className="space-y-1.5">{(q.options || []).map((opt) => (
          <button key={opt} onClick={() => { noteChange(q.id); onBlurQ(q.id); patch(q.id, { choice: opt }); }} className={`w-full text-left flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm ${a.choice === opt ? 'border-[#FF6A00] bg-orange-50 text-orange-700 font-bold' : 'border-slate-200 text-slate-600'}`}>
            <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${a.choice === opt ? 'border-[#FF6A00]' : 'border-slate-300'}`}>{a.choice === opt && <span className="w-2 h-2 rounded-full bg-[#FF6A00]" />}</span>{opt}
          </button>))}
        </div>)}
        {q.type === 'multi_choice' && (<div className="space-y-1.5">{(q.options || []).map((opt) => { const on = ((a.choices) || []).includes(opt); return (
          <button key={opt} onClick={() => { noteChange(q.id); toggleChoice(q.id, opt); }} className={`w-full text-left flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm ${on ? 'border-[#FF6A00] bg-orange-50 text-orange-700 font-bold' : 'border-slate-200 text-slate-600'}`}>
            <span className={`w-4 h-4 rounded border-2 flex items-center justify-center ${on ? 'border-[#FF6A00] bg-[#FF6A00]' : 'border-slate-300'}`}>{on && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4"><path d="M20 6L9 17l-5-5" /></svg>}</span>{opt}
          </button>); })}
        </div>)}
        {q.type === 'short_answer' && (<textarea className={inputCls} rows={2} placeholder="Your answer" value={a.text || ''} onFocus={() => onFocusQ(q.id)} onBlur={() => onBlurQ(q.id)} onKeyDown={(e) => onKeyText(q.id, e)} onChange={(e) => patch(q.id, { text: e.target.value })} />)}
        {q.comment && q.type !== 'short_answer' && (<textarea className={inputCls + ' mt-2'} rows={2} placeholder="Write your comment (optional)" value={a.comment || ''} onFocus={() => onFocusQ(q.id)} onBlur={() => onBlurQ(q.id)} onKeyDown={(e) => onKeyText(q.id, e)} onChange={(e) => patch(q.id, { comment: e.target.value })} />)}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[140] p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div><div className="text-lg font-extrabold text-[#050A1F]">{survey.name}</div>{survey.description && phase !== 'done' && <div className="text-xs text-slate-400 mt-0.5">{survey.description}</div>}</div>
          <div className="flex items-center gap-2">
            {testMode && <button onClick={() => setShowTestResults(true)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">View test results</button>}
            {phase !== 'done' && <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>}
          </div>
        </div>
        <div className="p-6 overflow-y-auto">
          {testMode && phase !== 'done' && <div className="mb-3 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs font-bold text-blue-700">🧪 Test mode — this response is saved separately and won't affect live results.</div>}
          {err && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{err}</div>}
          {phase === 'main' && (survey.questions || []).map((q, i) => renderQuestion(q, i))}
          {phase === 'followups' && (<div>
            <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-blue-700 mb-4">Thanks for your honesty. A couple of quick yes/no questions to help us understand better.</div>
            {followupQs.map((q) => (<div key={q.id} className="mb-4"><div className="text-sm font-bold text-[#050A1F] mb-2">{q.text}</div>
              <div className="flex gap-2">{['Yes', 'No'].map((opt) => (<button key={opt} onClick={() => setFollowupA((a) => ({ ...a, [q.id]: opt }))} className={`px-5 py-2 rounded-lg text-sm font-bold border ${followupA[q.id] === opt ? 'border-[#FF6A00] bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-500'}`}>{opt}</button>))}</div>
            </div>))}
          </div>)}
          {phase === 'done' && (<div className="text-center py-6"><div className="text-4xl mb-3">💬</div><div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{successMsg}</div></div>)}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2 shrink-0">
          {phase === 'main' && <button onClick={proceed} disabled={busy} className="rounded-lg px-6 py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Please wait…' : 'Submit response'}</button>}
          {phase === 'followups' && <button onClick={submit} disabled={busy} className="rounded-lg px-6 py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Submitting…' : 'Submit response'}</button>}
          {phase === 'done' && <button onClick={onDone} className="rounded-lg px-6 py-2.5 text-sm font-bold text-white" style={{ background: '#050A1F' }}>Close</button>}
        </div>
      </div>
      {showTestResults && <TestResultsModal survey={survey} onClose={() => setShowTestResults(false)} />}
    </div>
  );
}

import React, { useState, useEffect, useRef } from 'react';
import { api } from './App.jsx';

const ORANGE = 'linear-gradient(90deg,#FF6A00,#FF4500)';
const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF6A00] focus:border-transparent';
const SCALE_COLORS = ['#DC2626', '#F97316', '#CDDC39', '#84CC16', '#16A34A'];
const SURVEY_TEMPLATES = [
  { id: 'employee_mood', name: 'Employee Mood', available: true, desc: 'A quick pulse on how the team is feeling, with adaptive follow-ups.' },
  { id: 'employee_satisfaction', name: 'Employee Satisfaction', available: false, desc: 'Coming soon.' },
  { id: 'work_culture', name: 'Work Culture', available: false, desc: 'Coming soon.' },
];
const Trash = ({ size = 16 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M6 7l1 13a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 17 20l1-13" /></svg>;

// ============================ ADMIN ============================
export default function CrmSurveyAdmin() {
  const [tab, setTab] = useState('create');
  const [surveys, setSurveys] = useState([]);
  const [err, setErr] = useState('');
  const load = () => api('/surveys').then((r) => setSurveys(r.surveys || [])).catch(() => {});
  useEffect(() => { load(); }, []);
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-extrabold text-[#050A1F]">Team survey</h2>
          <p className="text-sm text-slate-500">Run mood pulse surveys with the sales team. Responses are analysed with AI.</p>
        </div>
      </div>
      {err && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{err}</div>}
      <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 mb-5 w-max">
        <button onClick={() => setTab('create')} className={`px-4 py-1.5 rounded-md text-xs font-bold ${tab === 'create' ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>Create Survey</button>
        <button onClick={() => setTab('results')} className={`px-4 py-1.5 rounded-md text-xs font-bold ${tab === 'results' ? 'bg-white shadow text-[#050A1F]' : 'text-slate-500'}`}>Comments &amp; Sentiment Analysis</button>
      </div>
      {tab === 'create' && <SurveyCreate surveys={surveys} reload={load} setErr={setErr} />}
      {tab === 'results' && <SurveyResults surveys={surveys} />}
    </div>
  );
}

function SurveyCreate({ surveys, reload, setErr }) {
  const [template, setTemplate] = useState('employee_mood');
  const [editId, setEditId] = useState(null); // survey being edited (null = creating new)
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [frequency, setFrequency] = useState('one_time');
  const [questions, setQuestions] = useState([{ id: 'q1', text: 'Our workplace is free from distraction', type: 'scale5', comment: true, options: [] }]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [testTake, setTestTake] = useState(null); // survey being test-taken
  const [testResults, setTestResults] = useState(null); // survey whose test results are shown
  const [confirmModal, setConfirmModal] = useState(null); // { title, body, confirmLabel, tone, onConfirm }
  const Q_TYPES = [['scale5', 'Rating scale (1–5)'], ['single_choice', 'Multiple choice (pick one)'], ['multi_choice', 'Multiple choice (pick many)'], ['short_answer', 'Short answer']];
  const isChoice = (t) => t === 'single_choice' || t === 'multi_choice';
  const addQ = () => setQuestions((qs) => [...qs, { id: `q${Date.now()}`, text: '', type: 'scale5', comment: false, options: [] }]);
  const patchQ = (i, patch) => setQuestions((qs) => qs.map((q, idx) => idx === i ? { ...q, ...patch } : q));
  const delQ = (i) => setQuestions((qs) => qs.filter((_, idx) => idx !== i));
  const setOpt = (qi, oi, val) => setQuestions((qs) => qs.map((q, idx) => idx === qi ? { ...q, options: q.options.map((o, j) => j === oi ? val : o) } : q));
  const addOpt = (qi) => setQuestions((qs) => qs.map((q, idx) => idx === qi ? { ...q, options: [...(q.options || []), ''] } : q));
  const delOpt = (qi, oi) => setQuestions((qs) => qs.map((q, idx) => idx === qi ? { ...q, options: q.options.filter((_, j) => j !== oi) } : q));
  const validQuestions = () => questions.filter((q) => { if (!q.text.trim()) return false; if (isChoice(q.type) && (q.options || []).filter((o) => o.trim()).length < 2) return false; return true; });

  const resetForm = () => {
    setEditId(null); setName(''); setDescription(''); setFrequency('one_time');
    setQuestions([{ id: 'q1', text: 'Our workplace is free from distraction', type: 'scale5', comment: true, options: [] }]);
  };
  const startEdit = (s) => {
    setEditId(s._id); setName(s.name || ''); setDescription(s.description || ''); setFrequency(s.frequency || 'one_time');
    setQuestions((s.questions || []).length ? s.questions.map((q) => ({ ...q, options: q.options || [] })) : [{ id: 'q1', text: '', type: 'scale5', comment: false, options: [] }]);
    setMsg(''); setErr('');
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const launch = async () => {
    setMsg('');
    if (!name.trim()) return setErr('Survey name is required.');
    const qs = validQuestions();
    if (!qs.length) return setErr('Add at least one complete question (choice questions need 2+ options).');
    setBusy(true);
    try {
      if (editId) {
        await api(`/surveys/${editId}`, { method: 'PUT', body: JSON.stringify({ name, description, frequency, questions: qs }) });
        setMsg('Survey updated. Test it below, then click “Make live” to send it to the team.');
      } else {
        await api('/surveys', { method: 'POST', body: JSON.stringify({ name, description, template, frequency, questions: qs }) });
        setMsg('Survey saved as a draft — test it below, then click “Make live” to send it to the team.');
      }
      resetForm(); reload();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const closeSurvey = (s) => setConfirmModal({
    title: 'Close this survey?', body: `“${s.name}” will stop accepting responses. You can re-run it later.`,
    confirmLabel: 'Close survey', tone: 'slate',
    onConfirm: async () => { await api(`/surveys/${s._id}`, { method: 'PUT', body: JSON.stringify({ status: 'closed' }) }); reload(); },
  });
  const activate = (s) => setConfirmModal({
    title: 'Make this survey live?', body: `“${s.name}” will be sent to the sales team to respond. Any test responses will be cleared and a fresh response period begins.`,
    confirmLabel: 'Make live', tone: 'orange',
    onConfirm: async () => { await api(`/surveys/${s._id}/activate`, { method: 'POST' }); setMsg(`“${s.name}” is now live.`); reload(); },
  });
  const rerun = (s) => setConfirmModal({
    title: 'Re-run this survey?', body: `“${s.name}” will be re-opened for a new response period. Previous responses stay saved under their own period; new responses come in fresh.`,
    confirmLabel: 'Re-run survey', tone: 'orange',
    onConfirm: async () => { await api(`/surveys/${s._id}/activate`, { method: 'POST' }); setMsg(`“${s.name}” has been re-run and is live again.`); reload(); },
  });
  const del = (s) => setConfirmModal({
    title: 'Delete this survey?', body: `“${s.name}” will be removed. This can’t be undone.`,
    confirmLabel: 'Delete', tone: 'red',
    onConfirm: async () => { await api(`/surveys/${s._id}`, { method: 'DELETE' }); if (editId === s._id) resetForm(); reload(); },
  });

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div>
        {msg && <div className="mb-4 rounded-lg bg-green-50 border border-green-200 px-3 py-2.5 text-sm text-green-700">{msg}</div>}
        {editId ? (
          <div className="mb-5 rounded-xl border border-orange-300 bg-orange-50 px-4 py-3 flex items-center justify-between gap-3">
            <div className="text-sm font-bold text-orange-700">✏️ Editing “{name || 'survey'}”</div>
            <button onClick={resetForm} className="text-xs font-bold text-orange-600 underline">Start a new survey instead</button>
          </div>
        ) : (
          <>
            <div className="text-sm font-bold text-[#050A1F] mb-2">Select a template</div>
            <div className="space-y-2 mb-5">
              {SURVEY_TEMPLATES.map((t) => (
                <button key={t.id} disabled={!t.available} onClick={() => t.available && setTemplate(t.id)}
                  className={`w-full text-left rounded-xl border p-3 transition ${template === t.id && t.available ? 'border-orange-400 bg-orange-50' : 'border-slate-200'} ${!t.available ? 'opacity-60 cursor-not-allowed' : 'hover:border-slate-300'}`}>
                  <div className="flex items-center justify-between"><span className="font-bold text-[#050A1F] text-sm">{t.name}</span>{!t.available && <span className="text-[10px] font-bold rounded-full bg-slate-200 text-slate-500 px-2 py-0.5">Coming Soon</span>}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{t.desc}</div>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="bg-white rounded-2xl border border-slate-200/70 p-5 space-y-3">
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
                    <span className="text-slate-300 text-sm pt-2.5 font-bold">{i + 1}.</span>
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
          <div className="pt-1 flex items-center gap-2">
            <button onClick={launch} disabled={busy} className="rounded-lg px-6 py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : (editId ? 'Save changes' : 'Save as draft')}</button>
            {editId && <button onClick={resetForm} className="rounded-lg px-4 py-2.5 text-sm font-bold text-slate-500 border border-slate-200">Cancel edit</button>}
          </div>
        </div>
      </div>
      <div>
        <div className="text-sm font-bold text-[#050A1F] mb-2">Surveys</div>
        {surveys.length === 0 ? <div className="bg-white rounded-2xl border border-slate-200/70 p-8 text-center text-slate-400 text-sm">No surveys yet.</div> : (
          <div className="space-y-2">{surveys.map((s) => {
            const statusPill = s.status === 'active'
              ? <span className="text-green-600 font-bold">Active</span>
              : s.status === 'draft' ? <span className="text-amber-600 font-bold">Draft</span> : <span className="text-slate-400">Closed</span>;
            return (
            <div key={s._id} className="bg-white rounded-xl border border-slate-200/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0"><div className="font-bold text-[#050A1F] text-sm">{s.name}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{s.frequency.replace('_', '-')} · {(s.questions || []).length} question{(s.questions || []).length === 1 ? '' : 's'} · {statusPill}{s.status === 'active' ? ` · ${s.responseCount || 0} responses this period` : ''}</div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                  <button onClick={() => startEdit(s)} className="text-xs font-bold text-slate-600 border border-slate-200 rounded-lg px-2.5 py-1.5">Edit</button>
                  <button onClick={() => setTestTake(s)} className="text-xs font-bold text-blue-600 border border-blue-200 rounded-lg px-2.5 py-1.5">Test</button>
                  <button onClick={() => setTestResults(s)} className="text-xs font-bold text-slate-500 border border-slate-200 rounded-lg px-2.5 py-1.5">Test results</button>
                  {s.status === 'draft' && <button onClick={() => activate(s)} className="text-xs font-bold text-white rounded-lg px-2.5 py-1.5" style={{ background: ORANGE }}>Make live</button>}
                  {s.status === 'active' && <button onClick={() => closeSurvey(s)} className="text-xs font-bold text-slate-500 border border-slate-200 rounded-lg px-2.5 py-1.5">Close</button>}
                  {s.status === 'closed' && <button onClick={() => rerun(s)} className="text-xs font-bold text-white rounded-lg px-2.5 py-1.5" style={{ background: ORANGE }}>Re-run</button>}
                  <button onClick={() => del(s)} className="text-slate-300 hover:text-red-500"><Trash size={16} /></button>
                </div>
              </div>
            </div>);
          })}
          </div>
        )}
      </div>
      {testTake && <SurveyTakeModal survey={testTake} testMode onClose={() => setTestTake(null)} onDone={() => { setTestTake(null); }} />}
      {testResults && <TestResultsModal survey={testResults} onClose={() => setTestResults(null)} />}
      {confirmModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130] p-4" onClick={() => setConfirmModal(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 pt-5 pb-3">
              <div className="text-lg font-extrabold text-[#050A1F]">{confirmModal.title}</div>
              <div className="text-sm text-slate-500 mt-1.5 leading-relaxed">{confirmModal.body}</div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={() => setConfirmModal(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
              <button
                onClick={async () => { const fn = confirmModal.onConfirm; setConfirmModal(null); try { await fn(); } catch (e) { setErr(e.message); } }}
                className="rounded-lg px-5 py-2 text-sm font-bold text-white"
                style={{ background: confirmModal.tone === 'red' ? '#DC2626' : confirmModal.tone === 'slate' ? '#475569' : 'linear-gradient(90deg,#FF6A00,#FF4500)' }}>
                {confirmModal.confirmLabel}
              </button>
            </div>
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
  return (
    <div className="space-y-6">
      <div className="text-xs text-slate-400">{data.total} response{data.total === 1 ? '' : 's'} · {data.analysed} analysed{data.analysedAt ? ` · last analysed ${new Date(data.analysedAt).toLocaleString()}` : ''}</div>
      {data.analysed === 0 && <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-sm text-amber-700">Click “Analyse with AI” to decode sentiment and surface themes from the responses.</div>}
      <div className="grid grid-cols-3 gap-4">
        <SentimentCircle label="Positive Sentiment" pct={data.sentiment.positive} color="#16A34A" />
        <SentimentCircle label="Neutral Sentiment" pct={data.sentiment.neutral} color="#F59E0B" />
        <SentimentCircle label="Negative Sentiment" pct={data.sentiment.negative} color="#DC2626" />
      </div>
      {(data.summary || data.good.length || data.improve.length) && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl border border-green-100 p-5"><div className="text-sm font-extrabold text-green-700 mb-2">Top 3 good points</div><ul className="space-y-1.5">{(data.good.length ? data.good : ['—']).map((g, i) => <li key={i} className="text-sm text-slate-600 flex gap-2"><span className="text-green-500">✔</span>{g}</li>)}</ul></div>
          <div className="bg-white rounded-2xl border border-amber-100 p-5"><div className="text-sm font-extrabold text-amber-700 mb-2">Top 3 to improve</div><ul className="space-y-1.5">{(data.improve.length ? data.improve : ['—']).map((g, i) => <li key={i} className="text-sm text-slate-600 flex gap-2"><span className="text-amber-500">▲</span>{g}</li>)}</ul></div>
        </div>
      )}
      {data.summary && <div className="bg-white rounded-2xl border border-slate-200/70 p-5 text-sm text-slate-600"><b className="text-[#050A1F]">Overall mood:</b> {data.summary}</div>}
      <SentimentBreakdown title="By team" rows={data.byBranch} />
      {data.responses && data.responses.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200/70 p-5">
          <div className="text-sm font-extrabold text-[#050A1F] mb-1">Individual responses</div>
          <div className="text-[11px] text-slate-400 mb-3">Hesitation = lingered noticeably or heavily self-edited on a question — a hint they may have answered diplomatically. Fed to the AI for a deeper read.</div>
          <div className="space-y-1.5">{data.responses.map((r) => {
            const sent = r.sentiment && r.sentiment.label;
            const sc = sent === 'positive' ? 'bg-green-100 text-green-700' : sent === 'negative' ? 'bg-red-100 text-red-700' : sent === 'neutral' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-400';
            return (
              <div key={r._id} className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2">
                <div className="w-36 min-w-0"><div className="text-sm font-bold text-[#050A1F] truncate">{r.employeeName || 'User'}</div><div className="text-[10px] text-slate-400 truncate">{r.branch || '—'}</div></div>
                <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${sc}`}>{sent || 'not analysed'}</span>
                {r.sentiment && r.sentiment.tone && <span className="text-[11px] text-slate-500 italic">{r.sentiment.tone}</span>}
                {r.hesitationCount > 0 && <span className="text-[10px] font-bold rounded-full px-2 py-0.5 bg-purple-100 text-purple-700" title={r.hesitationQuestions.join(' · ')}>⚠ hesitation ×{r.hesitationCount}</span>}
                <div className="ml-auto text-xs text-slate-400 shrink-0">{r.avgScore != null ? `${r.avgScore.toFixed(1)}/5` : '—'}</div>
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
export function CrmSurveyGate() {
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
          {phase !== 'done' && <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>}
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
    </div>
  );
}

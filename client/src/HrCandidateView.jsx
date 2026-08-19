import React, { useState, useEffect, useRef } from 'react';
import { hrApi, fileToBase64, ResumeMatchBadge } from './HrApp.jsx';
import { titleCase } from './HrParts.jsx';
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

// Compact per-tab icons (stroke SVG paths).
const TAB_ICONS = {
  resume: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M9 13h6 M9 17h6',
  application: 'M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  ai: 'M12 2a2 2 0 0 1 2 2v1h1a3 3 0 0 1 3 3v1h1a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-1v1a3 3 0 0 1-3 3h-1v1a2 2 0 0 1-4 0v-1H9a3 3 0 0 1-3-3v-1H5a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2h1V8a3 3 0 0 1 3-3h1V4a2 2 0 0 1 2-2z',
  comments: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  feedback: 'M11.5 2l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3 8.2l5.9-.9z',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  offer: 'M12 1v22 M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M22 6l-10 7L2 6',
  timeline: 'M12 8v4l3 3 M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z',
  attachments: 'M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48',
};
function TabIcon({ name, active }) {
  const d = TAB_ICONS[name]; if (!d) return null;
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: active ? 1 : 0.7 }}>{d.split(' M').map((seg, i) => <path key={i} d={(i ? 'M' : '') + seg} />)}</svg>;
}

// WhatsApp glyph.
const WA_PATH = 'M12 2a10 10 0 0 0-8.5 15.2L2 22l4.9-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.5-4-4.7-4.2-.1-.2-1-1.4-1-2.6s.6-1.8.9-2.1c.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.3 0 .5l-.4.5-.3.3c-.1.1-.2.3-.1.5.1.2.6 1 1.3 1.6.9.8 1.6 1 1.8 1.1.2.1.4.1.5-.1l.6-.8c.2-.2.4-.2.5-.1l1.8.9c.2.1.4.2.4.3.1.2.1.6 0 1z';

export default function HrCandidateView({ candidateId, isAdmin, onBack, onClose, onDeleted, initialTab }) {
  const [c, setC] = useState(null);
  const [tab, setTab] = useState(initialTab || 'resume');
  const [err, setErr] = useState('');
  const [pendingHintShown, setPendingHintShown] = useState(false);
  const [offerNotice, setOfferNotice] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [showInterview, setShowInterview] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [activityModal, setActivityModal] = useState(null); // 'task' | 'call'
  const [showReject, setShowReject] = useState(false);
  const [rescoring, setRescoring] = useState(false);
  const [showSelfSchedule, setShowSelfSchedule] = useState(false);
  const back = onBack || onClose || (() => {});

  const load = () => hrApi(`/candidates/${candidateId}`).then(setC).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [candidateId]);
  // If this candidate was marked for hire but the offer isn't complete, guide HR
  // straight to the Offer tab (once).
  useEffect(() => {
    if (c && !pendingHintShown && c.offer && c.offer.pendingHire && c.offer.status !== 'accepted') {
      setPendingHintShown(true);
      if (!initialTab) setTab('offer');
      setOfferNotice(`Complete the offer process for ${c.name} before hiring. Once the offer is accepted, they'll move to Hired automatically.`);
    }
  }, [c, pendingHintShown, initialTab]);

  const rescoreMatch = async () => {
    setRescoring(true);
    try { const updated = await hrApi(`/candidates/${candidateId}/resume-match`, { method: 'POST' }); setC(updated); }
    catch (e) { setErr(e.message); } finally { setRescoring(false); }
  };

  const delCandidate = async () => {
    if (!window.confirm('Delete this candidate permanently? This cannot be undone.')) return;
    try { await hrApi(`/candidates/${candidateId}`, { method: 'DELETE' }); (onDeleted || back)(); }
    catch (e) { setErr(e.message); }
  };

  if (!c) return <div className="py-20 text-center text-slate-400 text-sm">{err || 'Loading…'}</div>;

  const a = c.answers || {};
  const job = c.job;
  const stages = (job && job.stages) || [];
  const curStage = stages.find((s) => s.id === c.stage);
  const nextStage = (() => { const i = stages.findIndex((s) => s.id === c.stage); return i >= 0 && i < stages.length - 1 ? stages[i + 1] : null; })();
  const wa = (c.phone || '').replace(/[^0-9]/g, '');

  const act = async (fn) => { try { const updated = await fn(); if (updated) setC((s) => ({ ...updated, job: s.job })); return updated; } catch (e) { setErr(e.message); } };
  const moveToStage = async (stageId) => {
    const updated = await act(() => hrApi(`/candidates/${c.id}/stage`, { method: 'PATCH', body: JSON.stringify({ stage: stageId }) }));
    // Moving to a rejected stage needs a reason — open the reject dialog.
    if (updated && updated.needsReason) { setShowReject(true); return; }
    // If the move to a hired stage was redirected because the offer isn't done,
    // jump to the Offer tab so HR can complete it.
    if (updated && updated.offerIncomplete) {
      setTab('offer'); setErr('');
      setOfferNotice(updated.message || `Complete the offer process before hiring ${c.name}. Once the offer is accepted, they'll move to Hired automatically.`);
    }
  };
  const moveNext = () => { if (nextStage) moveToStage(nextStage.id); };
  const reject = () => setShowReject(true);

  // The Offer tab belongs to the offer process — show it only when the candidate
  // is in an Offer/Hired stage, or an offer already has real activity. This keeps
  // it from lingering when a candidate is moved back to an earlier stage.
  const offerStageActive = (() => {
    const stageL = String(c.stage || '').toLowerCase();
    const HIRED = ['hired', 'onboarded', 'joined', 'selected'];
    if (HIRED.includes(stageL)) return true;
    const st = stages.find((s) => s.id === c.stage);
    if (st && ['offered', 'offer'].includes(String(st.id).toLowerCase())) return true;
    const o = c.offer || {};
    if (o.status === 'accepted' || o.pendingHire) return true;
    const hasProgress = (o.salaryDiscussions && o.salaryDiscussions.length) || (o.approvals && o.approvals.length) || o.loi || o.offerLetter;
    return !!hasProgress;
  })();
  const effectiveTab = (tab === 'offer' && !offerStageActive) ? 'resume' : tab;
  const TABS = [['resume', 'Resume'], ['application', 'Application'], ['ai', 'AI Recruiter'], ['comments', 'Comments'], ['feedback', 'Feedback'], ['activity', 'Activity'], ...(c.canViewInternal !== false && offerStageActive ? [['offer', 'Offer']] : []), ['mail', 'Mail'], ['timeline', 'Timeline'], ['attachments', 'Files']];

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
                  <ResumeMatchBadge match={c.resumeMatch} size="lg" />
                  <button onClick={rescoreMatch} disabled={rescoring} title="Re-score resume match" className="text-slate-300 hover:text-orange-500 disabled:opacity-40">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={rescoring ? 'animate-spin' : ''}><path d="M23 4v6h-6M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
                  </button>
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
                    <span>Source: <b className="text-slate-600">{({ manual: 'Manual', linkedin: 'LinkedIn', naukri: 'Naukri', indeed: 'Indeed', referral: 'Referral', careers_page: 'Careers page', public_form: 'Careers page' })[c.source] || 'Manual'}</b></span>
                    {c.recruiterName && <span>Recruiter: <b className="text-slate-600">{c.recruiterName}</b></span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 pt-2">
                    <RatingStars value={c.rating || 0} onChange={async (r) => { await hrApi(`/candidates/${c.id}`, { method: 'PATCH', body: JSON.stringify({ rating: r }) }); load(); }} />
                    <TagEditor tags={c.tags || []} onChange={async (tags) => { await hrApi(`/candidates/${c.id}`, { method: 'PATCH', body: JSON.stringify({ tags }) }); load(); }} />
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => setShowEdit(true)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">✎ Edit</button>
              {isAdmin && <button onClick={delCandidate} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-500">🗑 Delete</button>}
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 mt-4">
            <button onClick={() => setShowFeedback(true)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">💬 Add Feedback</button>
            <button onClick={() => setActivityModal('task')} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">✅ Add Task</button>
            <button onClick={() => setActivityModal('call')} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">📞 Add Call</button>
            <button onClick={() => setShowInterview(true)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">📅 Schedule Meeting</button>
            {c.canViewInternal !== false && <button onClick={() => setShowSelfSchedule(true)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">🗓️ Schedule Interview</button>}
            <button onClick={reject} disabled={c.rejected} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-500 disabled:opacity-50">⛔ Reject</button>
            {nextStage && !c.rejected && <button onClick={moveNext} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: ORANGE }}>Move to {nextStage.label} →</button>}
          </div>
          {err && <div className="mt-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm px-3 py-2">{err}</div>}
          {c.rejected && (
            <div className="mt-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2.5 flex items-start gap-2">
              <span className="shrink-0 mt-0.5">⛔</span>
              <span className="flex-1"><b>Rejected{c.rejectedAt ? ` on ${new Date(c.rejectedAt).toLocaleDateString()}` : ''}.</b> {c.rejectionReason ? <span>Reason: {c.rejectionReason}</span> : <span className="text-red-400">No reason recorded.</span>}</span>
            </div>
          )}
          {offerNotice && (
            <div className="mt-3 rounded-lg bg-sky-50 border border-sky-200 text-sky-800 text-sm px-3 py-2 flex items-start gap-2">
              <span className="shrink-0 mt-0.5">📝</span>
              <span className="flex-1">{offerNotice}</span>
              <button onClick={() => setOfferNotice('')} className="shrink-0 text-sky-400 hover:text-sky-600 font-bold">✕</button>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-0.5 px-3 border-b border-slate-100 overflow-x-auto">
          {TABS.map(([id, label]) => {
            const count = id === 'comments' ? (c.comments || []).length : id === 'feedback' ? (c.feedback || []).length : id === 'attachments' ? (c.attachments || []).length : 0;
            return (
              <button key={id} onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-[13px] font-bold whitespace-nowrap border-b-2 -mb-px transition ${effectiveTab === id ? 'border-orange-500 text-orange-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
                <TabIcon name={id} active={effectiveTab === id} />
                <span>{label}</span>
                {count > 0 && <span className={`rounded-full px-1.5 text-[10px] font-bold ${effectiveTab === id ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-400'}`}>{count}</span>}
              </button>
            );
          })}
        </div>

        <div className="p-6 min-h-[340px]">
          {effectiveTab === 'resume' && <ResumeTab c={c} />}
          {effectiveTab === 'application' && <ApplicationTab c={c} a={a} job={job} onSaved={load} />}
          {effectiveTab === 'ai' && <AiTab c={c} reload={load} setErr={setErr} />}
          {effectiveTab === 'comments' && <CommentsTab c={c} reload={load} />}
          {effectiveTab === 'feedback' && <FeedbackTab c={c} onAdd={() => setShowFeedback(true)} />}
          {effectiveTab === 'activity' && <ActivityTab c={c} reload={load} onAddTask={() => setActivityModal('task')} onAddCall={() => setActivityModal('call')} />}
          {effectiveTab === 'offer' && <OfferTab c={c} isAdmin={isAdmin} reload={load} />}
          {effectiveTab === 'mail' && <MailTab c={c} />}
          {effectiveTab === 'timeline' && <TimelineTab c={c} />}
          {effectiveTab === 'attachments' && <AttachmentsTab c={c} reload={load} />}
        </div>
      </div>

      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)}
        onSubmit={async (payload) => { await act(() => hrApi(`/candidates/${c.id}/feedback`, { method: 'POST', body: JSON.stringify(payload) })); setShowFeedback(false); setTab('feedback'); }} />}
      {showInterview && <InterviewModal candidateId={c.id} stages={stages} roundPanels={(c.job && c.job.roundPanels) || {}} onClose={() => setShowInterview(false)} onDone={load} />}
      {showEdit && <EditModal c={c} onClose={() => setShowEdit(false)} onSaved={() => { setShowEdit(false); load(); }} />}
      {activityModal && <ActivityModal kind={activityModal} candidateId={c.id} onClose={() => setActivityModal(null)} onSaved={() => { setActivityModal(null); load(); setTab('activity'); }} />}
      {showReject && <RejectModal candidateId={c.id} candidateEmail={c.email} onClose={() => setShowReject(false)} onReject={async (payload) => { await act(() => hrApi(`/candidates/${c.id}/reject`, { method: 'POST', body: JSON.stringify(payload) })); setShowReject(false); }} />}
      {showSelfSchedule && <SelfScheduleModal candidate={c} onClose={() => setShowSelfSchedule(false)} onSaved={() => { setShowSelfSchedule(false); load(); }} />}
    </div>
  );
}

// ---------- Resume ----------
function ResumeTab({ c }) {
  const [useGoogle, setUseGoogle] = useState(false);
  if (!c.resumeUrl) return <Empty>No resume uploaded.</Empty>;
  const isPdf = /\.pdf($|\?)/i.test(c.resumeUrl);
  // Some storage/CDN hosts send headers that stop a PDF rendering inline in an
  // iframe (the "content is blocked" message). Google's viewer reliably embeds
  // any public PDF URL, so offer it as a one-click fallback.
  const googleSrc = `https://docs.google.com/gview?embedded=1&url=${encodeURIComponent(c.resumeUrl)}`;
  // Hide the browser PDF viewer chrome (toolbar, side panes, filename, zoom,
  // page number, download) so only the document shows — we already have an
  // Open / Download action above.
  const directSrc = `${c.resumeUrl}#toolbar=0&navpanes=0&scrollbar=0&statusbar=0&view=FitH`;
  return (
    <div>
      <div className="flex justify-end gap-2 mb-2">
        {isPdf && <button onClick={() => setUseGoogle((v) => !v)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">{useGoogle ? 'Try direct view' : "Can't see it? Use viewer"}</button>}
        <a href={c.resumeUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">Open / Download</a>
      </div>
      {isPdf
        ? <iframe title="resume" src={useGoogle ? googleSrc : directSrc} className="w-full h-[640px] rounded-lg border border-slate-200" />
        : <div className="text-center py-10"><a href={c.resumeUrl} target="_blank" rel="noreferrer" className="text-orange-600 font-bold">View resume file</a></div>}
      {isPdf && !useGoogle && <div className="text-[11px] text-slate-400 mt-2 text-center">If the resume doesn't appear above, click “Can't see it? Use viewer”.</div>}
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

// ---------- Comments (chat-style, editable) ----------
function CommentsTab({ c, reload }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [internal, setInternal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editText, setEditText] = useState('');
  const [emps, setEmps] = useState([]);
  const [mention, setMention] = useState(null); // {query, start} when typing @…
  const [mentionIdx, setMentionIdx] = useState(0);
  const taRef = useRef(null);
  const canInternal = c.canViewInternal !== false; // HR/admin only
  const list = c.comments || [];
  useEffect(() => { hrApi('/employees').then((r) => setEmps((r || []).filter((e) => e.active && !e.isDirector))).catch(() => {}); }, []);
  // Detect an in-progress @mention at the caret and surface matching employees.
  const onText = (e) => {
    const v = e.target.value; setText(v);
    const caret = e.target.selectionStart || v.length;
    const upto = v.slice(0, caret);
    const m = upto.match(/@([\w.]*)$/);
    if (m) { setMention({ query: m[1].toLowerCase(), start: caret - m[0].length }); setMentionIdx(0); }
    else setMention(null);
  };
  const mentionMatches = mention ? emps.filter((e) => e.name && e.name.toLowerCase().replace(/\s+/g, '').startsWith(mention.query) || (e.name || '').toLowerCase().split(/\s+/).some((w) => w.startsWith(mention.query))).slice(0, 6) : [];
  const pickMention = (emp) => {
    const handle = '@' + (emp.name || '').trim().split(/\s+/).join('');
    const before = text.slice(0, mention.start);
    const after = text.slice((taRef.current && taRef.current.selectionStart) || text.length);
    const next = `${before}${handle} ${after}`;
    setText(next); setMention(null);
    setTimeout(() => { if (taRef.current) { taRef.current.focus(); const pos = (before + handle + ' ').length; taRef.current.setSelectionRange(pos, pos); } }, 0);
  };
  const add = async () => { if (!text.trim()) return; setBusy(true); try { await hrApi(`/candidates/${c.id}/comments`, { method: 'POST', body: JSON.stringify({ text: text.trim(), internal: canInternal && internal }) }); setText(''); setInternal(false); await reload(); } finally { setBusy(false); } };
  const saveEdit = async (id) => { if (!editText.trim()) return; try { await hrApi(`/candidates/${c.id}/comments/${id}`, { method: 'PATCH', body: JSON.stringify({ text: editText.trim() }) }); setEditId(null); await reload(); } catch {} };
  // Colour an avatar deterministically from the author's name.
  const AV = ['#2563EB', '#7C3AED', '#DB2777', '#059669', '#D97706', '#0891B2', '#DC2626'];
  const colorFor = (s) => AV[(String(s || '').split('').reduce((a, ch) => a + ch.charCodeAt(0), 0)) % AV.length];
  const initials = (s) => String(s || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  // Highlight @mentions inside the comment text.
  const renderText = (t) => String(t || '').split(/(@[\w.]+)/g).map((part, i) => /^@[\w.]+$/.test(part)
    ? <span key={i} className="font-bold text-orange-600 bg-orange-50 rounded px-1">{part}</span>
    : <span key={i}>{part}</span>);
  const onKeyDown = (e) => {
    if (mention && mentionMatches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx((i) => (i + 1) % mentionMatches.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx((i) => (i - 1 + mentionMatches.length) % mentionMatches.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(mentionMatches[mentionIdx]); return; }
      if (e.key === 'Escape') { setMention(null); return; }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add();
  };
  return (
    <div>
      {/* Composer card */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 mb-5 relative">
        <textarea
          ref={taRef}
          className="w-full bg-transparent text-sm outline-none resize-none placeholder:text-slate-400"
          rows={2}
          value={text}
          onChange={onText}
          placeholder="Share an update or note… type @name to notify a colleague"
          onKeyDown={onKeyDown} />
        {mention && mentionMatches.length > 0 && (
          <div className="absolute left-3 right-3 top-16 z-20 bg-white border border-slate-200 rounded-lg shadow-lg max-h-52 overflow-auto">
            {mentionMatches.map((e, i) => (
              <button key={e._id} onMouseDown={(ev) => { ev.preventDefault(); pickMention(e); }}
                className={`w-full text-left flex items-center gap-2 px-3 py-2 text-sm ${i === mentionIdx ? 'bg-orange-50' : 'hover:bg-slate-50'}`}>
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold" style={{ background: colorFor(e.name) }}>{initials(e.name)}</span>
                <span className="font-semibold text-slate-700">{titleCase(e.name)}</span>
                <span className="text-xs text-slate-400">{e.designation || e.type}{e.department ? ` · ${e.department}` : ''}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-200/70">
          {canInternal ? (
            <label className="flex items-center gap-2 text-xs text-slate-500 select-none cursor-pointer">
              <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="rounded" />
              <span className={internal ? 'text-amber-600 font-semibold' : ''}>🔒 Internal only</span>
              <span className="text-slate-300">·</span>
              <span className="text-[11px] text-slate-400">hidden from interview panel</span>
            </label>
          ) : <span className="text-[11px] text-slate-400">Press ⌘/Ctrl + Enter to post</span>}
          <button onClick={add} disabled={busy || !text.trim()} className="rounded-lg px-4 py-1.5 text-sm font-bold text-white shrink-0 disabled:opacity-40" style={{ background: ORANGE }}>{busy ? 'Posting…' : 'Post'}</button>
        </div>
      </div>

      {/* Thread */}
      {list.length === 0 ? (
        <div className="text-center py-10">
          <div className="text-4xl mb-2">💬</div>
          <div className="text-sm text-slate-400">No comments yet — start the conversation.</div>
        </div>
      ) : (
        <div className="space-y-4">
          {list.slice().reverse().map((cm) => (
            <div key={cm.id} className="flex gap-3">
              <span className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 mt-0.5" style={{ background: colorFor(cm.by) }}>{initials(cm.by)}</span>
              <div className="flex-1 min-w-0">
                <div className={`rounded-2xl rounded-tl-sm border p-3 ${cm.internal ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200 bg-white'}`}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="text-sm font-bold text-slate-700 flex items-center gap-2 min-w-0">
                      <span className="truncate">{cm.by}</span>
                      {cm.internal && <span className="rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-[10px] font-bold shrink-0">🔒 Internal</span>}
                    </div>
                    {editId !== cm.id && <button onClick={() => { setEditId(cm.id); setEditText(cm.text); }} className="text-[11px] font-bold text-slate-400 hover:text-orange-600 shrink-0">Edit</button>}
                  </div>
                  {editId === cm.id ? (
                    <div>
                      <textarea className={inp} rows={2} value={editText} onChange={(e) => setEditText(e.target.value)} />
                      <div className="flex justify-end gap-2 mt-1.5">
                        <button onClick={() => setEditId(null)} className="text-xs font-bold text-slate-400">Cancel</button>
                        <button onClick={() => saveEdit(cm.id)} className="text-xs font-bold text-orange-600">Save</button>
                      </div>
                    </div>
                  ) : <div className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">{renderText(cm.text)}</div>}
                </div>
                <div className="text-[11px] text-slate-400 mt-1 ml-1">{fmt(cm.at)}{cm.edited ? ' · edited' : ''}</div>
              </div>
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
  const [detail, setDetail] = useState(null); // full email being viewed
  const load = () => hrApi(`/candidates/${c.id}/emails`).then(setData).catch((e) => setData({ connected: false, error: e.message }));
  useEffect(() => { load(); }, [c.id]);
  const replyTo = (m) => {
    const when = m.date ? new Date(m.date).toLocaleString() : '';
    const who = `${m.fromName || ''} <${m.fromEmail || m.from || ''}>`.trim();
    const inner = m.bodyHtml || `<div style="white-space:pre-wrap">${(m.snippet || '')}</div>`;
    const quoted = `<br><br><div style="border-left:2px solid #ccc;padding-left:10px;color:#555"><div>On ${when}, ${who} wrote:</div>${inner}</div>`;
    setCompose({ mode: 'reply', to: [c.email], subject: /^re:/i.test(m.subject || '') ? m.subject : `Re: ${m.subject || ''}`, inReplyTo: m.messageId || m.id, threadId: m.threadId, body: quoted });
  };
  // The mailbox is unlinked only once we've loaded and it says so.
  const notConnected = data && !data.connected;
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs text-slate-400">{data ? (data.connected ? <>Conversation from <b className="text-slate-600">{data.mailbox}</b></> : 'Recruitment mailbox not linked') : 'Loading conversation…'}</div>
        <button onClick={() => setCompose({ mode: 'new', to: [c.email], subject: '' })} disabled={notConnected} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white inline-flex items-center gap-1.5 disabled:opacity-50" style={{ background: ORANGE }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16v16H4z" /><path d="M22 6l-10 7L2 6" /></svg> Compose
        </button>
      </div>
      {!data ? <Empty>Loading…</Empty>
        : notConnected ? (
          <div className="text-center py-8">
            <div className="text-sm text-slate-500 mb-2">The shared recruitment mailbox isn't linked yet.</div>
            <div className="text-xs text-slate-400">Ask an admin to connect it in HR Admin → Recruitment mailbox.</div>
          </div>
        ) : (data.messages || []).length === 0 ? <Empty>No emails with this candidate yet.</Empty> : (
        <div className="space-y-2">
          {data.messages.map((m) => (
            <button key={m.id} onClick={() => setDetail(m)} className="w-full text-left rounded-xl border border-slate-200 p-3 hover:border-orange-200 hover:bg-orange-50/30 transition">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${m.direction === 'outbound' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'}`}>
                    {m.direction === 'outbound' ? '↑ Sent' : '↓ Received'}
                  </span>
                  <span className="text-sm font-bold text-slate-700 truncate">{m.direction === 'outbound' ? 'Us' : (m.fromName || m.from)}</span>
                </div>
                <div className="text-xs text-slate-400 shrink-0">{fmt(m.date)}</div>
              </div>
              {m.subject && <div className="text-xs font-semibold text-slate-600 mt-1 truncate">{m.subject}</div>}
              <div className="text-xs text-slate-400 mt-0.5 truncate">{(m.snippet || String(m.bodyHtml || '').replace(/<[^>]+>/g, ' ')).slice(0, 120)}</div>
            </button>
          ))}
        </div>
      )}
      {detail && <EmailDetailModal m={detail} candidateEmail={c.email} onClose={() => setDetail(null)} onReply={() => { const d = detail; setDetail(null); replyTo(d); }} />}
      {compose && <HrComposer candidate={c} initial={compose} onClose={() => setCompose(null)} onSent={() => { setCompose(null); load(); }} />}
    </div>
  );
}

// Full email viewer — headers + full HTML body, with a Reply action.
function EmailDetailModal({ m, candidateEmail, onClose, onReply }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-[120] p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-lg font-extrabold text-[#050A1F] truncate">{m.subject || '(no subject)'}</div>
            <div className="text-xs text-slate-400 mt-1">
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold mr-2 ${m.direction === 'outbound' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'}`}>{m.direction === 'outbound' ? 'Sent' : 'Received'}</span>
              {fmt(m.date)}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none shrink-0">×</button>
        </div>
        <div className="px-6 py-3 border-b border-slate-50 text-xs text-slate-500 space-y-0.5">
          <div><span className="font-bold text-slate-400">From:</span> {m.direction === 'outbound' ? 'Recruitment mailbox' : (m.fromName ? `${m.fromName} <${m.from || m.fromEmail || candidateEmail}>` : (m.from || m.fromEmail || candidateEmail))}</div>
          <div><span className="font-bold text-slate-400">To:</span> {m.direction === 'outbound' ? (candidateEmail || m.to || m.toEmail || '') : 'Recruitment mailbox'}</div>
        </div>
        <div className="px-6 py-5 max-h-[55vh] overflow-auto text-sm text-slate-700 rich-text" dangerouslySetInnerHTML={{ __html: m.bodyHtml || m.snippet || '' }} />
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Close</button>
          <button onClick={onReply} className="rounded-lg px-5 py-2 text-sm font-bold text-white" style={{ background: ORANGE }}>Reply</button>
        </div>
      </div>
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
  const [body, setBody] = useState(initial.body || '');
  const [attachments, setAttachments] = useState([]); // {filename,mimeType,contentBase64}
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const fileInput = React.useRef(null);
  const [showAi, setShowAi] = useState(false);
  const [aiMode, setAiMode] = useState('interview_invite');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [signatures, setSignatures] = useState([]);
  const signature = (signatures.find((s) => s.isDefault) || signatures[0] || {}).body || '';
  useEffect(() => {
    hrApi('/email-templates').then((r) => setTemplates(r.templates || [])).catch(() => {});
    hrApi('/signatures').then((r) => setSignatures(r.signatures || [])).catch(() => {});
  }, []);
  const _ans = candidate.answers || {};
  const _work = (Array.isArray(_ans.work) && _ans.work[0]) || {};
  const fillPlaceholders = (str) => (str || '')
    .replace(/\{\{\s*candidate_name\s*\}\}/gi, candidate.name || '')
    .replace(/\{\{\s*first_name\s*\}\}/gi, String(candidate.name || '').split(' ')[0] || '')
    .replace(/\{\{\s*email\s*\}\}/gi, candidate.email || '')
    .replace(/\{\{\s*phone\s*\}\}/gi, candidate.phone || '')
    .replace(/\{\{\s*role\s*\}\}/gi, (candidate.job && candidate.job.title) || '')
    .replace(/\{\{\s*current_designation\s*\}\}/gi, _work.title || '')
    .replace(/\{\{\s*current_company\s*\}\}/gi, _work.company || '')
    .replace(/\{\{\s*location\s*\}\}/gi, candidate.currentLocation || _ans.city || '')
    .replace(/\{\{\s*expected_ctc\s*\}\}/gi, _ans.expectedCtc || '')
    .replace(/\{\{\s*notice_period\s*\}\}/gi, _ans.noticePeriod || '')
    .replace(/\{\{\s*recruiter_name\s*\}\}/gi, candidate.recruiterName || '')
    .replace(/\{\{\s*company\s*\}\}/gi, 'Qtonix');
  const applyTemplate = (t) => {
    if (!t) return;
    if (t.subject) setSubject(fillPlaceholders(t.subject));
    setBody(fillPlaceholders(t.body) + (signature ? `<br><br>${signature}` : ''));
  };
  const applySignature = (sig) => { if (sig) setBody((b) => `${b || ''}<br><br>${sig.body}`); };
  const insertDefaultSignature = () => { const sg = signatures.find((s) => s.isDefault) || signatures[0]; if (sg) applySignature(sg); };
  const onFile = async (e) => {
    const files = Array.from(e.target.files || []);
    for (const f of files) {
      try { const b64 = await fileToBase64(f); setAttachments((prev) => [...prev, { filename: f.name, mimeType: f.type || 'application/octet-stream', contentBase64: String(b64).split(',').pop() }]); } catch {}
    }
    e.target.value = '';
  };
  const removeAtt = (i) => setAttachments((prev) => prev.filter((_, idx) => idx !== i));

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
      await hrApi(`/candidates/${candidate.id}/emails/send`, { method: 'POST', body: JSON.stringify({ to: to.join(', '), cc: cc.join(', '), bcc: bcc.join(', '), subject, body, inReplyTo: initial.inReplyTo, threadId: initial.threadId, attachments }) });
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
          <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
            <span className="text-xs font-bold text-slate-400 w-12 shrink-0">To</span>
            <div className="flex-1 min-w-0"><ChipInput value={to} onChange={setTo} placeholder="Recipients" /></div>
            <div className="flex gap-2 text-xs font-semibold text-slate-400 shrink-0">
              {!showCc && <button onClick={() => setShowCc(true)} className="hover:text-slate-600">Cc</button>}
              {!showBcc && <button onClick={() => setShowBcc(true)} className="hover:text-slate-600">Bcc</button>}
            </div>
          </div>
          {showCc && <div className="flex items-center gap-2 border-b border-slate-100 pb-2"><span className="text-xs font-bold text-slate-400 w-12 shrink-0">Cc</span><div className="flex-1 min-w-0"><ChipInput value={cc} onChange={setCc} placeholder="Cc recipients" /></div></div>}
          {showBcc && <div className="flex items-center gap-2 border-b border-slate-100 pb-2"><span className="text-xs font-bold text-slate-400 w-12 shrink-0">Bcc</span><div className="flex-1 min-w-0"><ChipInput value={bcc} onChange={setBcc} placeholder="Bcc recipients" /></div></div>}
          {templates.length > 0 && (
            <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
              <span className="text-xs text-slate-400 w-12">Template</span>
              <select className="flex-1 text-sm text-slate-700 outline-none bg-transparent" defaultValue="" onChange={(e) => { const t = templates.find((x) => x.id === e.target.value); applyTemplate(t); e.target.value = ''; }}>
                <option value="">Insert a template…</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}
          {signatures.length > 0 && (
            <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
              <span className="text-xs text-slate-400 w-12">Signature</span>
              <select className="flex-1 text-sm text-slate-700 outline-none bg-transparent" defaultValue="" onChange={(e) => { const sg = signatures.find((x) => x.id === e.target.value); applySignature(sg); e.target.value = ''; }}>
                <option value="">Insert a signature…</option>
                {signatures.map((s) => <option key={s.id} value={s.id}>{s.name}{s.isDefault ? ' (default)' : ''}</option>)}
              </select>
            </div>
          )}
          <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
            <span className="text-xs font-bold text-slate-400 w-12 shrink-0">Subject</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="flex-1 min-w-0 text-sm text-slate-700 outline-none bg-transparent" />
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
              onAiDraft={() => setShowAi((v) => !v)}
              onAttach={() => fileInput.current?.click()}
              onInsertSignature={signatures.length ? insertDefaultSignature : undefined} />
            <input ref={fileInput} type="file" multiple className="hidden" onChange={onFile} />
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {attachments.map((a, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-600">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
                    {a.filename}<button onClick={() => removeAtt(i)} className="text-slate-400 hover:text-red-500 ml-1">×</button>
                  </span>
                ))}
              </div>
            )}
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
function AttachmentsTab({ c, reload }) {
  const list = c.attachments || [];
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [picking, setPicking] = useState(false); // doc-type chooser open
  const [docType, setDocType] = useState(null);   // chosen type awaiting file(s)
  const ref = useRef(null);
  const DOC_TYPES = [
    { id: 'Resume', label: 'Resume', icon: '📄', multi: false, hint: 'A single resume/CV file' },
    { id: 'Work Portfolio', label: 'Work Portfolio', icon: '🎨', multi: false, hint: 'Portfolio or samples of work' },
    { id: 'Task', label: 'Task — Multiple files', icon: '🗂️', multi: true, hint: 'Assignment / task submission (multiple files allowed)' },
    { id: 'Other', label: 'Other', icon: '📎', multi: false, hint: 'Any other document' },
  ];
  const choose = (t) => { setDocType(t); setPicking(false); setErr(''); setTimeout(() => ref.current?.click(), 50); };
  const upload = async (files) => {
    const arr = Array.from(files || []);
    if (!arr.length || !docType) return;
    for (const file of arr) { if (file.size > 10 * 1024 * 1024) { setErr(`"${file.name}" is too large (max 10MB).`); return; } }
    setBusy(true); setErr('');
    try {
      for (const file of arr) {
        const base64 = await fileToBase64(file);
        await hrApi(`/candidates/${c.id}/attachments`, { method: 'POST', body: JSON.stringify({ base64, fileName: file.name, docType: docType.id }) });
      }
      reload();
    } catch (e) { setErr(e.message); } finally { setBusy(false); setDocType(null); if (ref.current) ref.current.value = ''; }
  };
  const del = async (id) => { if (!window.confirm('Remove this attachment?')) return; try { await hrApi(`/candidates/${c.id}/attachments/${id}`, { method: 'DELETE' }); reload(); } catch {} };
  const badge = (t) => {
    const map = { 'Resume': 'bg-blue-100 text-blue-700', 'Work Portfolio': 'bg-purple-100 text-purple-700', 'Task': 'bg-amber-100 text-amber-700', 'Other': 'bg-slate-100 text-slate-500' };
    return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${map[t] || map.Other}`}>{t || 'Other'}</span>;
  };
  const iconFor = (t) => (DOC_TYPES.find((d) => d.id === t) || {}).icon || '📎';
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-slate-500">Resume, work portfolio, task files and any other documents.</div>
        <button onClick={() => !busy && setPicking(true)} disabled={busy} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Uploading…' : '⬆ Upload file'}</button>
        <input ref={ref} type="file" className="hidden" multiple={docType?.multi} onChange={(e) => upload(e.target.files)} />
      </div>
      {err && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm px-3 py-2">{err}</div>}

      {picking && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130] p-4" onClick={() => setPicking(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-100"><div className="text-lg font-extrabold text-[#050A1F]">What are you uploading?</div><div className="text-xs text-slate-400 mt-0.5">Pick a document type so files stay organised.</div></div>
            <div className="p-4 grid grid-cols-1 gap-2">
              {DOC_TYPES.map((t) => (
                <button key={t.id} onClick={() => choose(t)} className="w-full text-left flex items-center gap-3 rounded-xl border border-slate-200 p-3 hover:border-orange-400 hover:bg-orange-50/50 transition">
                  <span className="text-xl">{t.icon}</span>
                  <div className="min-w-0"><div className="font-bold text-[#050A1F] text-sm">{t.label}</div><div className="text-xs text-slate-400">{t.hint}</div></div>
                </button>
              ))}
            </div>
            <div className="px-6 py-3 border-t border-slate-100 flex justify-end"><button onClick={() => setPicking(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button></div>
          </div>
        </div>
      )}

      {c.resumeUrl && (
        <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3 mb-2 hover:bg-slate-50">
          <a href={c.resumeUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 min-w-0"><span>📄</span><span className="text-sm font-semibold text-slate-700 truncate">Resume</span></a>
          {badge('Resume')}
        </div>
      )}
      {list.map((f) => (
        <div key={f.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 mb-2 hover:bg-slate-50">
          <a href={f.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 min-w-0"><span>{iconFor(f.docType)}</span><span className="text-sm font-semibold text-slate-700 truncate">{f.name}</span></a>
          <div className="flex items-center gap-3 shrink-0">{badge(f.docType)}<span className="text-xs text-slate-400">{fmt(f.at)}</span><button onClick={() => del(f.id)} className="text-xs font-bold text-red-500">Remove</button></div>
        </div>
      ))}
      {!c.resumeUrl && !list.length && <Empty>No attachments yet.</Empty>}
    </div>
  );
}

// ---------- Activity (tasks & calls) ----------
function CandidateInterviewParticipants({ iv, candidate, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[140] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div><div className="text-lg font-extrabold text-[#050A1F]">{iv.roundLabel || 'Interview'}</div><div className="text-xs text-slate-400 mt-0.5">{fmt(iv.at)}{iv.by ? ` · scheduled by ${iv.by}` : ''}</div></div>
          <button onClick={onClose} className="text-slate-400 text-xl leading-none">×</button>
        </div>
        <div className="p-6 space-y-3">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wide">Participants</div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-2">
              <span className="w-7 h-7 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center text-xs font-bold">{(candidate.name || '?')[0]}</span>
              <div className="min-w-0"><div className="text-sm font-semibold text-slate-700 truncate">{candidate.name}</div><div className="text-[11px] text-slate-400 truncate">Candidate{candidate.email ? ` · ${candidate.email}` : ''}</div></div>
            </div>
            {(iv.panelists || []).map((p) => (
              <div key={p.id} className="flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-2">
                <span className="w-7 h-7 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-xs font-bold">{(p.name || '?')[0]}</span>
                <div className="min-w-0"><div className="text-sm font-semibold text-slate-700 truncate">{p.name}</div><div className="text-[11px] text-slate-400 truncate">Interviewer{p.email ? ` · ${p.email}` : ''}</div></div>
              </div>
            ))}
            {!(iv.panelists || []).length && <div className="text-xs text-slate-400 px-1">No panelists assigned.</div>}
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end">
          {iv.meetLink
            ? <a href={iv.meetLink} target="_blank" rel="noreferrer" className="rounded-lg px-5 py-2 text-sm font-bold text-white" style={{ background: ORANGE }}>Join Google Meet</a>
            : <span className="rounded-lg px-5 py-2 text-sm font-bold text-slate-400 bg-slate-100">No Meet link</span>}
        </div>
      </div>
    </div>
  );
}

function ActivityTab({ c, reload, onAddTask, onAddCall }) {
  const list = c.activities || [];
  const interviews = (c.interviews || []).slice().sort((a, b) => new Date(b.at) - new Date(a.at));
  const [partIv, setPartIv] = useState(null); // interview shown in participant popup
  const del = async (id) => { if (!window.confirm('Delete this activity?')) return; try { await hrApi(`/candidates/${c.id}/activities/${id}`, { method: 'DELETE' }); reload(); } catch {} };
  const toggleDone = async (a) => { try { await hrApi(`/candidates/${c.id}/activities/${a.id}`, { method: 'PATCH', body: JSON.stringify({ done: !a.done, mode: !a.done ? 'done' : 'scheduled' }) }); reload(); } catch {} };
  const prColor = (p) => p === 'High' ? '#DC2626' : p === 'Low' ? '#64748B' : '#F59E0B';
  return (
    <div>
      {interviews.length > 0 && (
        <div className="mb-5">
          <div className="text-sm font-extrabold text-[#050A1F] mb-2">Scheduled interviews</div>
          <div className="space-y-2">
            {interviews.map((iv) => (
              <div key={iv.id} className="rounded-lg border border-slate-200 p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-700 flex items-center gap-2">📹 {iv.roundLabel || 'Interview'}{iv.meetLink && <span className="rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-[10px] font-bold">Google Meet</span>}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{fmt(iv.at)}{(iv.panelists || []).length ? ` · ${iv.panelists.length} panelist${iv.panelists.length === 1 ? '' : 's'}` : ''}{iv.by ? ` · by ${iv.by}` : ''}</div>
                </div>
                <button onClick={() => setPartIv(iv)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 shrink-0">View</button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-slate-500">Tasks and calls for this candidate.</div>
        <div className="flex gap-2">
          <button onClick={onAddTask} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">✅ Add Task</button>
          <button onClick={onAddCall} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: ORANGE }}>📞 Add Call</button>
        </div>
      </div>
      {partIv && <CandidateInterviewParticipants iv={partIv} candidate={c} onClose={() => setPartIv(null)} />}
      {list.length === 0 ? <Empty>No tasks or calls yet.</Empty> : (
        <div className="space-y-2">
          {list.map((a) => (
            <div key={a.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  {a.kind === 'task' && <input type="checkbox" checked={!!a.done} onChange={() => toggleDone(a)} className="mt-1" />}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold uppercase tracking-wide" style={{ color: a.kind === 'call' ? '#2563EB' : '#7C3AED' }}>{a.kind === 'call' ? '📞 Call' : '✅ Task'}</span>
                      <span className={`text-sm font-semibold ${a.done ? 'line-through text-slate-400' : 'text-slate-700'}`}>{a.kind === 'call' ? a.agenda : a.title}</span>
                      {a.kind === 'task' && a.priority && <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: prColor(a.priority) + '18', color: prColor(a.priority) }}>{a.priority}</span>}
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${a.mode === 'done' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>{a.mode === 'done' ? 'Done' : 'Scheduled'}</span>
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {a.date && <span>{a.date}{a.time ? ` ${a.time}` : ''}</span>}
                      {a.assignedToName && <span> · → {a.assignedToName}</span>}
                      {a.reminderOn && <span> · 🔔 Reminder</span>}
                      {a.by && <span> · by {a.by}</span>}
                    </div>
                    {(a.description) && <div className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">{a.description}</div>}
                  </div>
                </div>
                <button onClick={() => del(a.id)} className="text-xs font-bold text-slate-300 hover:text-red-500 shrink-0">×</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Task/Call modal mirroring the Sales CRM (scheduled/done tabs).
function ActivityModal({ kind, candidateId, onClose, onSaved }) {
  const isCall = kind === 'call';
  const [mode, setMode] = useState('scheduled');
  const [f, setF] = useState({ title: '', agenda: '', date: '', time: '', description: '', priority: 'Medium', assignedToId: '', reminderOn: false });
  const [emps, setEmps] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  useEffect(() => { if (!isCall) hrApi('/employees').then((r) => setEmps(r.filter((e) => e.active))).catch(() => {}); }, [isCall]);
  const save = async () => {
    setBusy(true);
    try {
      const assignedTo = emps.find((e) => e._id === Number(f.assignedToId));
      const body = isCall
        ? { kind: 'call', mode, agenda: f.agenda, date: f.date, time: f.time, note: f.description, reminderOn: mode === 'scheduled' && f.reminderOn }
        : { kind: 'task', mode, title: f.title, date: f.date, description: f.description, priority: f.priority, assignedToId: f.assignedToId || null, assignedToName: assignedTo ? assignedTo.name : '' };
      await hrApi(`/candidates/${candidateId}/activities`, { method: 'POST', body: JSON.stringify(body) });
      onSaved();
    } catch (e) { alert(e.message); setBusy(false); }
  };
  return (
    <Modal title={isCall ? '📞 Add Call' : '✅ Add Task'} onClose={onClose}>
      <div className="flex gap-2 mb-4">
        {['scheduled', 'done'].map((m) => (
          <button key={m} onClick={() => setMode(m)} className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-bold border capitalize ${mode === m ? 'bg-[#050A1F] text-white border-transparent' : 'text-slate-500 border-slate-200'}`}>{m}</button>
        ))}
      </div>
      {isCall ? (
        <div className="space-y-3">
          <div><Lbl>Call agenda</Lbl><input className={inp} value={f.agenda} onChange={(e) => set('agenda', e.target.value)} placeholder="What's the call about?" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Lbl>Date</Lbl><input type="date" className={inp} value={f.date} onChange={(e) => set('date', e.target.value)} /></div>
            <div><Lbl>Time</Lbl><input type="time" className={inp} value={f.time} onChange={(e) => set('time', e.target.value)} /></div>
          </div>
          <div><Lbl>Note</Lbl><textarea rows={2} className={inp} value={f.description} onChange={(e) => set('description', e.target.value)} /></div>
          {mode === 'scheduled' && <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={f.reminderOn} onChange={(e) => set('reminderOn', e.target.checked)} /> 🔔 Remind me (in-app)</label>}
        </div>
      ) : (
        <div className="space-y-3">
          <div><Lbl>Task name</Lbl><input className={inp} value={f.title} onChange={(e) => set('title', e.target.value)} /></div>
          <div><Lbl>Date</Lbl><input type="date" className={inp} value={f.date} onChange={(e) => set('date', e.target.value)} /></div>
          <div><Lbl>Description</Lbl><textarea rows={2} className={inp} value={f.description} onChange={(e) => set('description', e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Lbl>Priority</Lbl><select className={inp} value={f.priority} onChange={(e) => set('priority', e.target.value)}>{['High', 'Medium', 'Low'].map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
            <div><Lbl>Assign to</Lbl><select className={inp} value={f.assignedToId} onChange={(e) => set('assignedToId', e.target.value)}><option value="">Unassigned</option>{emps.map((e) => <option key={e._id} value={e._id}>{e.name}{e.department ? ` · ${e.department}` : ''}</option>)}</select></div>
          </div>
        </div>
      )}
      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
        <button onClick={save} disabled={busy} className="rounded-lg px-6 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </Modal>
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
function InterviewModal({ candidateId, stages, roundPanels, onClose, onDone }) {
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
  const [autoFilled, setAutoFilled] = useState(false);
  useEffect(() => { hrApi('/employees').then((r) => setEmps(r.filter((e) => e.active))).catch(() => {}); }, []);
  // When the round changes, pre-fill the panel from the job's default for that
  // round (unless the user has already hand-picked panelists).
  const onRoundChange = (rid) => {
    setRound(rid);
    const def = (roundPanels && Array.isArray(roundPanels[rid])) ? roundPanels[rid] : [];
    if (def.length && (picked.length === 0 || autoFilled)) { setPicked(def.map(Number)); setAutoFilled(true); }
  };
  const depts = Array.from(new Set(emps.map((e) => e.department).filter(Boolean))).sort();
  const shown = emps.filter((e) => !dept || e.department === dept);
  const toggle = (id) => { setPicked((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]); setAutoFilled(false); };

  const schedule = async () => {
    if (!at) { setErr('Pick a date and time.'); return; }
    setBusy(true); setErr('');
    try { const r = await hrApi(`/candidates/${candidateId}/schedule-interview`, { method: 'POST', body: JSON.stringify({ start: at, durationMins: duration, mode, round, notes, sendEmail, panelistIds: picked }) }); setResult(r); onDone && onDone(); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal title="Schedule Meeting" onClose={onClose} wide>
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
                <select className={inp} value={round} onChange={(e) => onRoundChange(e.target.value)}>
                  <option value="">General interview</option>
                  {(stages || []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                {round && roundPanels && (roundPanels[round] || []).length > 0 && autoFilled && <div className="text-[10px] text-blue-500 mt-1">Panel pre-filled from this round's default.</div>}
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
                    <span className="font-semibold text-slate-700">{titleCase(e.name)}</span>
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
  const [d, setD] = useState({ name: c.name || '', email: c.email || '', phone: c.phone || '', currentLocation: c.currentLocation || '', recruiterId: c.recruiterId || '', jobPostId: c.jobPostId || '', ...(c.answers || {}) });
  const [emps, setEmps] = useState([]);
  const [jobsList, setJobsList] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { hrApi('/employees?hrDept=1').then((r) => setEmps(r || [])).catch(() => {}); }, []);
  useEffect(() => { hrApi('/job-posts').then((r) => setJobsList((r || []).filter((j) => j.status === 'published' || j.status === 'paused' || j._id === c.jobPostId))).catch(() => {}); }, []);
  const F = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
  const save = async () => {
    setBusy(true);
    try {
      await hrApi(`/candidates/${c.id}`, { method: 'PATCH', body: JSON.stringify({ name: d.name, email: d.email, phone: d.phone, currentLocation: d.currentLocation, recruiterId: d.recruiterId ? Number(d.recruiterId) : null, jobPostId: d.jobPostId ? Number(d.jobPostId) : null, answers: { currentCtc: d.currentCtc, expectedCtc: d.expectedCtc, noticePeriod: d.noticePeriod, portfolio: d.portfolio } }) });
      onSaved();
    } catch (e) { alert(e.message); setBusy(false); }
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
        <div className="col-span-2">
          <Lbl>Applied post</Lbl>
          <select className={F} value={d.jobPostId || ''} onChange={(e) => setD({ ...d, jobPostId: e.target.value })}>
            <option value="">— Select a job post —</option>
            {jobsList.map((j) => <option key={j._id} value={j._id}>{j.title}{j.status && j.status !== 'published' ? ` (${j.status})` : ''}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <Lbl>Assigned HR / recruiter</Lbl>
          <select className={F} value={d.recruiterId || ''} onChange={(e) => setD({ ...d, recruiterId: e.target.value })}>
            <option value="">— Unassigned —</option>
            {emps.map((e) => <option key={e._id} value={e._id}>{e.name}{e.designation ? ` · ${e.designation}` : ''}</option>)}
          </select>
          {c.recruiterName && <div className="text-[11px] text-slate-400 mt-1">Currently assigned to <b className="text-slate-500">{c.recruiterName}</b></div>}
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
        <button onClick={save} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </Modal>
  );
}

// ---------- Offer management (3-step) ----------
function OfferTab({ c, isAdmin, reload }) {
  const offer = c.offer;
  const [modal, setModal] = useState(null); // 'discussion' | 'approval' | 'loi' | 'letter'
  const op = async (body) => { try { await hrApi(`/candidates/${c.id}/offer`, { method: 'POST', body: JSON.stringify(body) }); reload(); } catch (e) { alert(e.message); } };
  const decide = async (approvalId, decision, counterOffer) => { try { await hrApi(`/candidates/${c.id}/offer/approve`, { method: 'POST', body: JSON.stringify({ approvalId, decision, counterOffer }) }); reload(); } catch (e) { alert(e.message); } };

  if (!offer || !offer.active) {
    return (
      <div className="text-center py-10">
        <div className="text-sm text-slate-500 mb-3">No offer in progress for this candidate.</div>
        <button onClick={() => op({ op: 'add_discussion', mode: 'phone', notes: 'Offer process started.' })} className="rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ background: ORANGE }}>Start offer process</button>
      </div>
    );
  }
  const STATUS = { discussion: 'Salary discussion', approval_pending: 'Awaiting approval', loi_sent: 'LOI sent', offer_sent: 'Offer sent', accepted: 'Accepted', declined: 'Declined' };
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-slate-700">Status:</span>
          <span className="rounded-full bg-orange-100 text-orange-700 px-2.5 py-0.5 text-xs font-bold">{STATUS[offer.status] || offer.status}</span>
        </div>
        <div className="flex gap-2">
          {offer.status !== 'accepted' && offer.status !== 'declined' && (offer.salaryDiscussions || []).length > 0 && <button onClick={() => setModal('accept')} className="rounded-lg border border-green-200 text-green-600 px-3 py-1.5 text-xs font-bold">Mark accepted</button>}
          {offer.status !== 'accepted' && offer.status !== 'declined' && (offer.salaryDiscussions || []).length > 0 && <button onClick={() => setModal('decline')} className="rounded-lg border border-red-200 text-red-500 px-3 py-1.5 text-xs font-bold">Mark declined</button>}
        </div>
      </div>

      <Card title="1 · Salary offers" action={<button onClick={() => setModal('discussion')} className="text-xs font-bold text-orange-600">+ Log salary offer</button>}>
        {(offer.salaryDiscussions || []).length === 0 ? <div className="text-sm text-slate-400">No salary offers logged yet.</div> : (
          <div className="space-y-2">
            {offer.salaryDiscussions.map((d) => {
              const accepted = offer.status === 'accepted' && offer.acceptedOfferId === d.id;
              return (
                <div key={d.id} className={`rounded-lg border p-3 ${accepted ? 'border-green-300 bg-green-50' : 'border-slate-100'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-slate-700 capitalize text-sm">{d.mode}{d.meetLink ? ' · Meet' : ''}</span>
                    <div className="flex items-center gap-2">{accepted && <span className="rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[10px] font-bold">✓ Accepted</span>}<span className="text-xs text-slate-400">{fmt(d.at)}</span></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-lg bg-slate-50 px-2.5 py-1.5"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Candidate ask</div><div className="font-bold text-[#050A1F]">{d.candidateAsk || '—'}</div></div>
                    <div className="rounded-lg bg-slate-50 px-2.5 py-1.5"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Offered</div><div className="font-bold text-[#050A1F]">{d.offered || '—'}</div></div>
                  </div>
                  {d.notes && <div className="text-slate-600 text-sm mt-1.5"><span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Remark: </span>{d.notes}</div>}
                  {d.meetLink && <a href={d.meetLink} target="_blank" rel="noreferrer" className="text-xs text-orange-600 font-semibold block mt-1">{d.meetLink}</a>}
                  <div className="text-[11px] text-slate-400 mt-1">Logged by {d.by}</div>
                </div>
              );
            })}
          </div>
        )}
        <button onClick={() => setModal('approval')} className="mt-3 rounded-lg border border-amber-200 text-amber-700 px-3 py-1.5 text-xs font-bold">⤴ Request management approval</button>
      </Card>

      {(offer.approvals || []).length > 0 && (
        <Card title="Management approvals">
          <div className="space-y-2">
            {offer.approvals.map((a) => (
              <div key={a.id} className="rounded-lg bg-slate-50 border border-slate-100 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-700">Candidate asked: {a.candidateAsk || '—'}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${a.status === 'pending' ? 'bg-amber-100 text-amber-700' : a.status === 'approved' ? 'bg-green-100 text-green-700' : a.status === 'countered' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-600'}`}>{a.status}</span>
                </div>
                {a.justification && <div className="text-xs text-slate-500 mt-0.5">{a.justification}</div>}
                {a.counterOffer && <div className="text-sm text-slate-700 mt-1">Counter-offer: <b>{a.counterOffer}</b> {a.decidedBy ? `(by ${a.decidedBy})` : ''}</div>}
                {isAdmin && a.status === 'pending' && (
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => decide(a.id, 'approved')} className="rounded-lg bg-green-600 text-white px-3 py-1 text-xs font-bold">Approve</button>
                    <button onClick={() => { const co = window.prompt('Counter-offer amount:'); if (co) decide(a.id, 'countered', co); }} className="rounded-lg bg-blue-600 text-white px-3 py-1 text-xs font-bold">Counter</button>
                    <button onClick={() => decide(a.id, 'rejected')} className="rounded-lg bg-red-500 text-white px-3 py-1 text-xs font-bold">Reject</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="2 · Letter of Intent" action={offer.status === 'accepted' ? <button onClick={() => setModal('loi')} className="text-xs font-bold text-orange-600">{offer.loi ? 'Resend LOI' : 'Send LOI'}</button> : null}>
        {offer.status !== 'accepted' ? <div className="text-sm text-slate-400">Mark the accepted salary offer first to unlock the LOI.</div>
          : offer.loi ? <div className="text-sm text-slate-600">Sent {fmt(offer.loi.sentAt)} by {offer.loi.by}. <span className="text-xs text-slate-400">({offer.loi.status})</span></div> : <div className="text-sm text-slate-400">Not sent yet.</div>}
      </Card>

      <Card title="3 · Offer Letter" action={offer.status === 'accepted' && offer.loi ? <button onClick={() => setModal('letter')} className="text-xs font-bold text-orange-600">{offer.offerLetter ? 'Resend' : 'Send offer letter'}</button> : null}>
        {offer.status !== 'accepted' ? <div className="text-sm text-slate-400">Available after the offer is accepted.</div>
          : !offer.loi ? <div className="text-sm text-slate-400">Send the LOI first.</div>
          : offer.offerLetter ? (
          <div className="text-sm text-slate-600">
            Sent {fmt(offer.offerLetter.sentAt)} by {offer.offerLetter.by}.
            {offer.offerLetter.fileUrl && <a href={offer.offerLetter.fileUrl} target="_blank" rel="noreferrer" className="text-orange-600 font-semibold ml-1">{offer.offerLetter.fileName || 'View letter'}</a>}
            <div className="mt-1 text-slate-700">{offer.finalCtc && <span>Final CTC: <b>{offer.finalCtc}</b> </span>}{offer.joiningDate && <span>· Joining: <b>{offer.joiningDate}</b></span>}</div>
          </div>
        ) : <div className="text-sm text-slate-400">Not sent yet.</div>}
      </Card>

      {modal === 'discussion' && <DiscussionModal candidateId={c.id} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
      {modal === 'accept' && <AcceptOfferModal offer={offer} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} candidateId={c.id} />}
      {modal === 'decline' && <DeclineOfferModal offer={offer} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} candidateId={c.id} />}
      {modal === 'approval' && <ApprovalModal onClose={() => setModal(null)} onSubmit={async (b) => { await op({ op: 'request_approval', ...b }); setModal(null); }} />}
      {modal === 'loi' && <LoiModal candidate={c} onClose={() => setModal(null)} onSent={() => { setModal(null); reload(); }} />}
      {modal === 'letter' && <OfferLetterModal candidate={c} onClose={() => setModal(null)} onSent={() => { setModal(null); reload(); }} />}
    </div>
  );
}

function DiscussionModal({ candidateId, onClose, onSaved }) {
  const [f, setF] = useState({ mode: 'phone', offered: '', candidateAsk: '', notes: '', at: '', durationMins: 30 });
  const [meet, setMeet] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const createMeet = async () => { if (!f.at) return alert('Pick a date & time first.'); setBusy(true); try { const r = await hrApi(`/candidates/${candidateId}/offer-meet`, { method: 'POST', body: JSON.stringify({ start: f.at, durationMins: f.durationMins, notes: f.notes }) }); setMeet(r.meetLink); } catch (e) { alert(e.message); } finally { setBusy(false); } };
  const save = async () => { setBusy(true); try { await hrApi(`/candidates/${candidateId}/offer`, { method: 'POST', body: JSON.stringify({ op: 'add_discussion', mode: f.mode, offered: f.offered, candidateAsk: f.candidateAsk, notes: f.notes, at: f.at ? new Date(f.at).toISOString() : undefined, meetLink: meet || '' }) }); onSaved(); } catch (e) { alert(e.message); setBusy(false); } };
  return (
    <Modal title="Log salary offer" onClose={onClose}>
      <div className="space-y-3">
        <div><Lbl>Mode</Lbl><select className={inp} value={f.mode} onChange={(e) => set('mode', e.target.value)}><option value="phone">Phone</option><option value="meet">Google Meet</option><option value="in_person">In person</option></select></div>
        {f.mode === 'meet' && (
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Lbl>Date &amp; time</Lbl><input type="datetime-local" className={inp} value={f.at} onChange={(e) => set('at', e.target.value)} /></div>
              <div><Lbl>Duration (mins)</Lbl><input type="number" className={inp} value={f.durationMins} onChange={(e) => set('durationMins', e.target.value)} /></div>
            </div>
            {meet ? <a href={meet} target="_blank" rel="noreferrer" className="text-xs text-orange-600 font-semibold block mt-2">{meet}</a>
              : <button onClick={createMeet} disabled={busy} className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">Create Meet link</button>}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div><Lbl>Candidate ask</Lbl><input className={inp} value={f.candidateAsk} onChange={(e) => set('candidateAsk', e.target.value)} placeholder="e.g. 10L" /></div>
          <div><Lbl>Offered</Lbl><input className={inp} value={f.offered} onChange={(e) => set('offered', e.target.value)} placeholder="e.g. 8L" /></div>
        </div>
        <div><Lbl>Remark</Lbl><textarea rows={2} className={inp} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Any notes about this offer / conversation" /></div>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
        <button onClick={save} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </Modal>
  );
}

function ApprovalModal({ onClose, onSubmit }) {
  const [candidateAsk, setAsk] = useState('');
  const [justification, setJust] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Request management approval" onClose={onClose}>
      <div className="space-y-3">
        <div><Lbl>Candidate's asking package</Lbl><input className={inp} value={candidateAsk} onChange={(e) => setAsk(e.target.value)} placeholder="e.g. 10L" /></div>
        <div><Lbl>Justification for management</Lbl><textarea rows={3} className={inp} value={justification} onChange={(e) => setJust(e.target.value)} placeholder="Why this candidate is worth it…" /></div>
        <div className="text-[11px] text-slate-400">Admins will see this request and respond with an approval or counter-offer.</div>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
        <button onClick={async () => { setBusy(true); await onSubmit({ candidateAsk, justification }); }} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Sending…' : 'Send request'}</button>
      </div>
    </Modal>
  );
}

// Mark Accepted — shows the last offered price (editable) + a note. Sets the
// final offered price (shown in the Hired tab) and moves to the Hired stage.
function AcceptOfferModal({ offer, candidateId, onClose, onDone }) {
  const last = (offer.salaryDiscussions || [])[0] || {};
  const [price, setPrice] = useState(last.offered || offer.finalCtc || '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!price.trim()) return alert('Enter the final offered price.');
    setBusy(true);
    try { await hrApi(`/candidates/${candidateId}/offer`, { method: 'POST', body: JSON.stringify({ op: 'set_status', status: 'accepted', acceptedOfferId: last.id, finalPrice: price.trim(), note: note.trim() }) }); onDone(); }
    catch (e) { alert(e.message); setBusy(false); }
  };
  return (
    <Modal title="Mark offer accepted" onClose={onClose}>
      <div className="space-y-3">
        <div className="text-sm text-slate-500">Confirm the final offered salary the candidate accepted. This shows in the Hired list, and the candidate moves to Hired.</div>
        <div><Lbl>Final offered price</Lbl><input className={inp} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 8L" /></div>
        {last.candidateAsk && <div className="text-xs text-slate-400">Candidate had asked: <b className="text-slate-600">{last.candidateAsk}</b></div>}
        <div><Lbl>Note</Lbl><textarea rows={3} className={inp} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Any note about the acceptance…" /></div>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
        <button onClick={go} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: '#16A34A' }}>{busy ? 'Saving…' : 'Confirm accepted'}</button>
      </div>
    </Modal>
  );
}

// Mark Declined — pre-fills the last candidate ask and our offered salary (both
// editable) + a note. Moves the candidate to Rejected.
function DeclineOfferModal({ offer, candidateId, onClose, onDone }) {
  const last = (offer.salaryDiscussions || [])[0] || {};
  const [ask, setAsk] = useState(last.candidateAsk || '');
  const [offered, setOffered] = useState(last.offered || '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await hrApi(`/candidates/${candidateId}/offer`, { method: 'POST', body: JSON.stringify({ op: 'set_status', status: 'declined', candidateAsk: ask.trim(), offered: offered.trim(), note: note.trim() }) }); onDone(); }
    catch (e) { alert(e.message); setBusy(false); }
  };
  return (
    <Modal title="Mark offer declined" onClose={onClose}>
      <div className="space-y-3">
        <div className="text-sm text-slate-500">Record the final numbers on the table. The candidate will be moved to Rejected.</div>
        <div className="grid grid-cols-2 gap-3">
          <div><Lbl>Candidate ask</Lbl><input className={inp} value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="e.g. 10L" /></div>
          <div><Lbl>Our offer</Lbl><input className={inp} value={offered} onChange={(e) => setOffered(e.target.value)} placeholder="e.g. 8L" /></div>
        </div>
        <div><Lbl>Note</Lbl><textarea rows={3} className={inp} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason / context for declining…" /></div>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
        <button onClick={go} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: '#DC2626' }}>{busy ? 'Saving…' : 'Confirm declined'}</button>
      </div>
    </Modal>
  );
}

function LoiModal({ candidate, onClose, onSent }) {
  const [subject, setSubject] = useState(`Letter of Intent — ${candidate.name}`);
  const [body, setBody] = useState(`<p>Dear ${candidate.name.split(' ')[0]},</p><p>We are pleased to confirm our intent to offer you a position. A formal offer letter will follow.</p>`);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await hrApi(`/candidates/${candidate.id}/offer-email`, { method: 'POST', body: JSON.stringify({ subject, body }) });
      await hrApi(`/candidates/${candidate.id}/offer`, { method: 'POST', body: JSON.stringify({ op: 'send_loi', subject, body, emailSent: true }) });
      onSent();
    } catch (e) { alert(e.message); setBusy(false); }
  };
  return (
    <Modal title="Send Letter of Intent" onClose={onClose} wide>
      <div className="space-y-3">
        <div><Lbl>Subject</Lbl><input className={inp} value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
        <div><Lbl>Message</Lbl><div className="rounded-lg border border-slate-300 min-h-[160px] p-3 text-sm" contentEditable suppressContentEditableWarning onInput={(e) => setBody(e.currentTarget.innerHTML)} dangerouslySetInnerHTML={{ __html: body }} /></div>
        <div className="text-[11px] text-slate-400">Sent from the shared recruitment mailbox. No attachment for the LOI.</div>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
        <button onClick={send} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Sending…' : 'Send LOI'}</button>
      </div>
    </Modal>
  );
}

function OfferLetterModal({ candidate, onClose, onSent }) {
  const [subject, setSubject] = useState(`Offer Letter — ${candidate.name}`);
  const [body, setBody] = useState(`<p>Dear ${candidate.name.split(' ')[0]},</p><p>Congratulations! Please find your offer letter attached.</p>`);
  const [finalCtc, setCtc] = useState('');
  const [joiningDate, setJoin] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  const send = async () => {
    if (!file) return alert('Attach the offer letter PDF.');
    setBusy(true);
    try {
      const base64 = await fileToBase64(file);
      const up = await hrApi(`/candidates/${candidate.id}/attachments`, { method: 'POST', body: JSON.stringify({ base64, fileName: file.name }) });
      const att = (up.attachments || [])[0];
      await hrApi(`/candidates/${candidate.id}/offer-email`, { method: 'POST', body: JSON.stringify({ subject, body, attachmentBase64: base64, attachmentName: file.name }) });
      await hrApi(`/candidates/${candidate.id}/offer`, { method: 'POST', body: JSON.stringify({ op: 'send_offer_letter', fileUrl: att ? att.url : '', fileName: file.name, finalCtc, joiningDate, emailSent: true }) });
      onSent();
    } catch (e) { alert(e.message); setBusy(false); }
  };
  return (
    <Modal title="Send Offer Letter" onClose={onClose} wide>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><Lbl>Final CTC</Lbl><input className={inp} value={finalCtc} onChange={(e) => setCtc(e.target.value)} placeholder="e.g. 9L" /></div>
          <div><Lbl>Joining date</Lbl><input type="date" className={inp} value={joiningDate} onChange={(e) => setJoin(e.target.value)} /></div>
        </div>
        <div><Lbl>Subject</Lbl><input className={inp} value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
        <div><Lbl>Message</Lbl><div className="rounded-lg border border-slate-300 min-h-[120px] p-3 text-sm" contentEditable suppressContentEditableWarning onInput={(e) => setBody(e.currentTarget.innerHTML)} dangerouslySetInnerHTML={{ __html: body }} /></div>
        <div>
          <Lbl>Offer letter (PDF)</Lbl>
          <button onClick={() => ref.current?.click()} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">{file ? `📎 ${file.name}` : 'Attach PDF'}</button>
          <input ref={ref} type="file" accept=".pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0])} />
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
        <button onClick={send} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Sending…' : 'Send offer letter'}</button>
      </div>
    </Modal>
  );
}

// Self-schedule setup: HR proposes slots + questions, panelists confirm, then
// the candidate books via a public link (which creates the Google Meet).
function SelfScheduleModal({ candidate, onClose, onSaved }) {
  const existing = candidate.selfSchedule || {};
  const [roundLabel, setRoundLabel] = useState(existing.roundLabel || 'Technical Round');
  const [durationMins, setDuration] = useState(existing.durationMins || 45);
  const [panelistIds, setPanelistIds] = useState(existing.panelistIds || []);
  const [slots, setSlots] = useState((existing.slots || []).map((s) => ({ id: s.id, at: s.at, confirmedBy: s.confirmedBy || [] })));
  const [questions, setQuestions] = useState(existing.questions || []);
  const [emps, setEmps] = useState([]);
  const [panelDept, setPanelDept] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { hrApi('/employees').then((r) => setEmps(r.filter((e) => e.active))).catch(() => {}); }, []);
  const panelDepts = [...new Set(emps.map((e) => e.department).filter(Boolean))].sort();
  const shownPanel = emps.filter((e) => !panelDept || e.department === panelDept);

  const publicLink = existing.token ? `${window.location.origin}/schedule/${existing.token}` : '';
  const togglePanelist = (id) => setPanelistIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  const addSlot = () => setSlots((s) => [...s, { id: `new${Date.now()}`, at: '', confirmedBy: [] }]);
  const setSlot = (i, at) => setSlots((s) => s.map((x, idx) => idx === i ? { ...x, at } : x));
  const rmSlot = (i) => setSlots((s) => s.filter((_, idx) => idx !== i));
  const addQ = (type) => setQuestions((q) => [...q, { id: `newq${Date.now()}`, type, prompt: '' }]);
  const setQ = (i, prompt) => setQuestions((q) => q.map((x, idx) => idx === i ? { ...x, prompt } : x));
  const rmQ = (i) => setQuestions((q) => q.filter((_, idx) => idx !== i));

  const nameOf = (id) => { const e = emps.find((x) => x._id === id); return e ? e.name : `#${id}`; };
  const save = async () => {
    const cleanSlots = slots.filter((s) => s.at).map((s) => ({ id: s.id.startsWith('new') ? undefined : s.id, at: new Date(s.at).toISOString(), confirmedBy: s.confirmedBy }));
    if (!cleanSlots.length) { alert('Add at least one time slot.'); return; }
    setBusy(true);
    try {
      await hrApi(`/candidates/${candidate.id}/self-schedule`, { method: 'POST', body: JSON.stringify({ roundLabel, durationMins: Number(durationMins), panelistIds, slots: cleanSlots, questions: questions.filter((q) => q.prompt.trim()) }) });
      onSaved();
    } catch (e) { alert(e.message); setBusy(false); }
  };
  const toLocalInput = (iso) => { if (!iso) return ''; const d = new Date(iso); const pad = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

  return (
    <Modal title="Schedule Interview" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><Lbl>Round label</Lbl><input className={inp} value={roundLabel} onChange={(e) => setRoundLabel(e.target.value)} /></div>
          <div><Lbl>Duration (mins)</Lbl><input type="number" className={inp} value={durationMins} onChange={(e) => setDuration(e.target.value)} /></div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <Lbl>Interview panel (they confirm their availability) {panelistIds.length ? `(${panelistIds.length})` : ''}</Lbl>
            <select className="text-xs rounded-lg border border-slate-300 px-2 py-1" value={panelDept} onChange={(e) => setPanelDept(e.target.value)}>
              <option value="">All departments</option>
              {panelDepts.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="border border-slate-200 rounded-lg max-h-40 overflow-auto divide-y divide-slate-50">
            {shownPanel.length === 0 ? <div className="p-3 text-xs text-slate-400">No employees found.</div> : shownPanel.map((e) => (
              <label key={e._id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer">
                <input type="checkbox" checked={panelistIds.includes(e._id)} onChange={() => togglePanelist(e._id)} />
                <span className="font-semibold text-slate-700">{titleCase(e.name)}</span>
                <span className="text-xs text-slate-400">{e.designation || e.type}{e.department ? ` · ${e.department}` : ''}</span>
              </label>
            ))}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Panelists confirm their availability; the candidate only sees confirmed slots.</div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1"><Lbl>Proposed time slots</Lbl><button onClick={addSlot} className="text-xs font-bold text-orange-600">+ Add slot</button></div>
          {slots.length === 0 ? <div className="text-xs text-slate-400">No slots yet.</div> : (
            <div className="space-y-2">
              {slots.map((s, i) => (
                <div key={s.id} className="flex items-center gap-2">
                  <input type="datetime-local" className={inp} value={toLocalInput(s.at)} onChange={(e) => setSlot(i, e.target.value)} />
                  {(s.confirmedBy || []).length > 0 && <span className="text-[10px] font-bold text-green-600 whitespace-nowrap">✓ {s.confirmedBy.length} confirmed</span>}
                  <button onClick={() => rmSlot(i)} className="text-slate-300 hover:text-red-500 shrink-0">×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1"><Lbl>Questions for the candidate</Lbl>
            <div className="flex gap-2"><button onClick={() => addQ('text')} className="text-xs font-bold text-orange-600">+ Question</button><button onClick={() => addQ('task')} className="text-xs font-bold text-purple-600">+ Task</button></div>
          </div>
          {questions.length === 0 ? <div className="text-xs text-slate-400">Optional — e.g. "Why are you leaving your current role?" or assign a take-home task.</div> : (
            <div className="space-y-2">
              {questions.map((q, i) => (
                <div key={q.id} className="flex items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${q.type === 'task' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-500'}`}>{q.type === 'task' ? 'Task' : 'Q'}</span>
                  <input className={inp} value={q.prompt} onChange={(e) => setQ(i, e.target.value)} placeholder={q.type === 'task' ? 'Describe the task…' : 'Question…'} />
                  <button onClick={() => rmQ(i)} className="text-slate-300 hover:text-red-500 shrink-0">×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {publicLink && (
          <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
            <div className="text-[11px] font-bold text-slate-500 mb-1">Candidate booking link {existing.booked ? '(booked ✓)' : ''}</div>
            <div className="flex items-center gap-2">
              <input readOnly className={inp + ' text-xs'} value={publicLink} onClick={(e) => e.target.select()} />
              <button onClick={() => { navigator.clipboard?.writeText(publicLink); }} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-600 shrink-0">Copy</button>
            </div>
            {existing.booked && <div className="text-xs text-green-600 font-semibold mt-1">Booked {fmt(existing.booked.at)}{existing.booked.meetLink ? ' · Meet created' : ''}.</div>}
            <div className="text-[11px] text-slate-400 mt-1">Only slots a panelist has confirmed show to the candidate. Share after panelists confirm.</div>
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Close</button>
        <button onClick={save} disabled={busy} className="rounded-lg px-6 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: ORANGE }}>{busy ? 'Saving…' : (publicLink ? 'Update' : 'Create link')}</button>
      </div>
    </Modal>
  );
}

// Reject with a required reason (HR picks from configured reasons or adds one).
function RejectModal({ candidateId, candidateEmail, onClose, onReject }) {
  const [reasons, setReasons] = useState([]);
  const [picked, setPicked] = useState('');
  const [custom, setCustom] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('reason'); // reason | email
  const [sendEmail, setSendEmail] = useState(true);
  const [drafting, setDrafting] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { hrApi('/rejection-reasons').then((r) => setReasons(r.reasons || [])).catch(() => {}); }, []);
  const addReason = async () => {
    const v = custom.trim(); if (!v) return;
    try { const r = await hrApi('/rejection-reasons', { method: 'POST', body: JSON.stringify({ reason: v }) }); setReasons(r.reasons || []); setPicked(v); setCustom(''); setAdding(false); } catch (e) { alert(e.message); }
  };
  const goEmail = async () => {
    if (!picked) return;
    setStep('email');
    if (candidateEmail && !body) {
      setDrafting(true); setErr('');
      try { const r = await hrApi(`/candidates/${candidateId}/reject-email/draft`, { method: 'POST', body: JSON.stringify({ reason: picked }) }); setSubject(r.subject || ''); setBody(r.body || ''); }
      catch (e) { setErr(e.message); setSendEmail(false); }
      finally { setDrafting(false); }
    }
  };
  const submit = async () => {
    setBusy(true);
    await onReject({ reason: picked, sendEmail: sendEmail && !!candidateEmail, subject, body });
  };
  return (
    <Modal title="Reject candidate" onClose={onClose} wide={step === 'email'}>
      {step === 'reason' ? (
        <>
          <div className="text-sm text-slate-500 mb-3">Pick a reason before sending the rejection. This is recorded on the candidate.</div>
          <div className="space-y-2 max-h-64 overflow-auto">
            {reasons.map((r) => (
              <label key={r} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                <input type="radio" name="reason" checked={picked === r} onChange={() => setPicked(r)} />
                <span className="text-slate-700">{r}</span>
              </label>
            ))}
          </div>
          {adding ? (
            <div className="flex gap-2 mt-2">
              <input className={inp} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="New reason…" onKeyDown={(e) => { if (e.key === 'Enter') addReason(); }} />
              <button onClick={addReason} className="rounded-lg px-3 py-2 text-xs font-bold text-white shrink-0" style={{ background: ORANGE }}>Add</button>
            </div>
          ) : <button onClick={() => setAdding(true)} className="text-xs font-bold text-orange-600 mt-2">+ Add a new reason</button>}
          <div className="flex justify-end gap-2 mt-5">
            <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">Cancel</button>
            <button onClick={goEmail} disabled={!picked} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: '#DC2626' }}>Next: email →</button>
          </div>
        </>
      ) : (
        <>
          {err && <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">{err}</div>}
          {!candidateEmail ? (
            <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5 text-sm text-slate-500 mb-3">No email on file for this candidate — they'll be rejected without an email.</div>
          ) : (
            <>
              <label className="flex items-center gap-2 text-sm text-slate-600 mb-3"><input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} /> Send a rejection email to {candidateEmail}</label>
              {sendEmail && (
                drafting ? <div className="text-sm text-slate-400 py-8 text-center">✨ Drafting a thoughtful rejection email…</div> : (
                  <div className="space-y-3">
                    <div><Lbl>Subject</Lbl><input className={inp} value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
                    <div><Lbl>Message</Lbl><div className="rounded-lg border border-slate-300 min-h-[180px] p-3 text-sm" contentEditable suppressContentEditableWarning onInput={(e) => setBody(e.currentTarget.innerHTML)} dangerouslySetInnerHTML={{ __html: body }} /></div>
                    <div className="text-[11px] text-slate-400">Drafted by AI — review and edit before sending.</div>
                  </div>
                )
              )}
            </>
          )}
          <div className="flex justify-between gap-2 mt-5">
            <button onClick={() => setStep('reason')} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">← Back</button>
            <button onClick={submit} disabled={busy || (sendEmail && candidateEmail && drafting)} className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: '#DC2626' }}>{busy ? 'Rejecting…' : (sendEmail && candidateEmail ? 'Reject & send email' : 'Reject candidate')}</button>
          </div>
        </>
      )}
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

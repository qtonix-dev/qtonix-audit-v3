import React, { useState, useMemo } from 'react';
import { API_BASE } from './config.js';
import { toast } from './toast';

const api = async (path, opts = {}) => {
  const token = localStorage.getItem('qtx_token');
  const res = await fetch(API_BASE + '/api/data-cleanup' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
};

const readB64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });

function downloadBase64(base64, fileName) {
  const bin = atob(base64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a'); a.href = url; a.download = fileName; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const REASON_PILL = {
  'Toll-free number': { bg: '#FEE2E2', fg: '#B91C1C' },
  '9-digit number (missing a digit)': { bg: '#FEE2E2', fg: '#B91C1C' },
  'Not a valid 10-digit number': { bg: '#FEE2E2', fg: '#B91C1C' },
  'Not a USA/Canada number': { bg: '#FEE2E2', fg: '#B91C1C' },
  'Fake / placeholder number': { bg: '#FEE2E2', fg: '#B91C1C' },
  'Duplicate number': { bg: '#FEF3C7', fg: '#B45309' },
  'Already checked in a previous upload': { bg: '#E0E7FF', fg: '#4338CA' },
  'Area code doesn’t match the state': { bg: '#FEF3C7', fg: '#B45309' },
  'Suspicious registrant name': { bg: '#FEF3C7', fg: '#B45309' },
  'Disposable / hidden-identity email': { bg: '#FEF3C7', fg: '#B45309' },
};

export default function DataCleanup() {
  const [files, setFiles] = useState([]);        // File[]
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);   // { headers, rows, summary, perFile, multi }
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [deepBusy, setDeepBusy] = useState(false);
  const [deepAvailable, setDeepAvailable] = useState(false);
  const [deepDone, setDeepDone] = useState(false);
  // The three admin exclusion choices (all OFF by default):
  const [excludeArea, setExcludeArea] = useState(false);   // free rule → affects /check
  const [excludeVoip, setExcludeVoip] = useState(false);   // line type → affects download
  const [excludeLandline, setExcludeLandline] = useState(false);

  React.useEffect(() => {
    api('/config').then((c) => setDeepAvailable(!!(c.deepCheck && c.deepCheck.available))).catch(() => {});
  }, []);

  // Line-type lookup: ANNOTATE each row with its type/carrier. We do NOT
  // auto-exclude here — the admin chooses which line types to include at
  // download time via the chooser, so nothing is dropped behind their back.
  const deepCheck = async () => {
    if (!result) return;
    setDeepBusy(true);
    try {
      const r = await api('/deep-check', { method: 'POST', body: JSON.stringify({ rows: result.rows.map((x) => ({ normalized: x.normalized, ok: x.ok })) }) });
      const res = r.results || {};
      setResult((prev) => {
        const rows = prev.rows.map((row) => {
          const v = row.normalized ? res[row.normalized] : null;
          if (!v || v.error) return row;
          return { ...row, lineType: v.lineType || row.lineType, carrier: v.carrier || row.carrier, apiChecked: true };
        });
        return { ...prev, rows };
      });
      setDeepDone(true);
      toast(`Line-type check done — ${r.called} looked up, ${r.fromCache} from cache${r.errors ? `, ${r.errors} errors` : ''}`);
    } catch (e) { toast(e.message); } finally { setDeepBusy(false); }
  };

  // Line types to KEEP at download = everything except the ones toggled off.
  const includeLineTypes = ['mobile', 'toll_free', 'unknown', ...(excludeLandline ? [] : ['landline']), ...(excludeVoip ? [] : ['voip'])];

  const addFiles = (list) => {
    const incoming = Array.from(list || []).filter((f) => /\.(xlsx|xls|csv)$/i.test(f.name));
    if (!incoming.length) return;
    // De-dupe by name+size so re-dropping the same file doesn't double it.
    setFiles((prev) => {
      const key = (f) => `${f.name}:${f.size}`;
      const seen = new Set(prev.map(key));
      return [...prev, ...incoming.filter((f) => !seen.has(key(f)))];
    });
    setResult(null); setDeepDone(false);
    uploadedRef.current = null; sessionRef.current = null;
  };

  const uploadedRef = React.useRef(null); // cached base64 payload so re-runs don't re-read files
  const sessionRef = React.useRef(null);  // stable id for this upload (so re-runs aren't "seen before")

  const run = async (areaOn = excludeArea) => {
    if (!files.length) return;
    setBusy(true);
    try {
      if (!uploadedRef.current) {
        uploadedRef.current = await Promise.all(files.map(async (f) => ({ name: f.name, base64: await readB64(f) })));
        sessionRef.current = `dc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      }
      const softExclude = areaOn ? ['area_state_mismatch'] : [];
      const r = await api('/check', { method: 'POST', body: JSON.stringify({ files: uploadedRef.current, softExclude, sessionId: sessionRef.current }) });
      setResult(r);
      setDeepDone(false); // a fresh check clears prior line-type annotations
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };

  // Re-run the check (reusing the cached upload) when the free Area≠state toggle
  // changes, so it instantly re-filters. (VoIP/Landline are download-time only.)
  React.useEffect(() => {
    if (result) run(excludeArea);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excludeArea]);

  // Admin can manually toggle a row back in / out before exporting.
  const toggleRow = (idx) => {
    setResult((r) => ({ ...r, rows: r.rows.map((row) => row.index === idx ? { ...row, ok: !row.ok } : row) }));
  };

  const exportClean = async () => {
    if (!result) return;
    setBusy(true);
    try {
      const baseName = files.length === 1 ? files[0].name : 'whois-combined';
      // Only apply the line-type chooser when a deep check actually ran.
      const body = { headers: result.headers, rows: result.rows, fileName: baseName };
      if (deepDone) body.includeLineTypes = includeLineTypes;
      const r = await api('/export/xlsx', { method: 'POST', body: JSON.stringify(body) });
      downloadBase64(r.base64, r.fileName);
      toast(`Downloaded — ${r.kept} kept, ${r.removed} removed`);
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };

  const s = result && result.summary;
  const shown = useMemo(() => {
    if (!result) return [];
    return onlyFlagged ? result.rows.filter((r) => !r.ok) : result.rows;
  }, [result, onlyFlagged]);

  // Kept = passes hard rules AND (if a deep check ran) its line type is selected.
  const ltOf = (r) => (r.lineType ? String(r.lineType).toLowerCase() : 'unknown');
  const passesLT = (r) => !deepDone || includeLineTypes.includes(ltOf(r));
  const keptCount = result ? result.rows.filter((r) => r.ok && passesLT(r)).length : 0;
  const removeCount = result ? result.rows.filter((r) => !(r.ok && passesLT(r))).length : 0;

  return (
    <div>
      <div className="mb-5">
        <div className="text-lg font-extrabold text-[#050A1F]">🧹 Data Cleanup — WHOIS phone validation</div>
        <div className="text-[13px] text-slate-500 mt-0.5">Upload a newly-registered-domain datasheet. Each registrant phone is checked and any that are <b>toll-free</b>, <b>9-digit</b>, or <b>not a USA/Canada</b> number is highlighted in red. Download a cleaned file with those rows removed.</div>
      </div>

      {/* Upload — multiple files allowed; all combined into one table + one download */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-5">
        <label className="block border-2 border-dashed border-orange-300 rounded-xl bg-orange-50 py-7 text-center text-[#B4531E] font-bold text-[14px] cursor-pointer"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
          ⬆ Drop one or more datasheets here, or click to browse
          <div className="text-slate-400 font-medium text-[12px] mt-1">.xlsx, .xls or .csv · multiple files combined into one table · must contain a <span className="font-mono">registrant_phone</span> column</div>
          <input type="file" multiple accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden"
            onChange={(e) => addFiles(e.target.files)} />
        </label>
        {files.length > 0 && <>
          <div className="mt-3 flex flex-wrap gap-2">
            {files.map((f, i) => (
              <span key={i} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-[12px] text-slate-600 flex items-center gap-2">
                📄 {f.name}
                <button onClick={() => setFiles((s) => s.filter((_, k) => k !== i))} className="text-slate-400 hover:text-red-500 font-bold">×</button>
              </span>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[12px] text-slate-400 font-semibold">{files.length} file{files.length > 1 ? 's' : ''} ready</span>
            <button onClick={run} disabled={busy} className="rounded-lg px-5 py-2 text-[13px] font-bold text-white disabled:opacity-50" style={{ background: 'linear-gradient(135deg,#FF6A00,#FF4500)' }}>{busy ? 'Checking…' : `✨ Check numbers (${files.length} file${files.length > 1 ? 's' : ''})`}</button>
          </div>
        </>}
      </div>

      {result && (
        <>
          {/* Summary tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <Tile label={`Total rows${result.multi ? ` · ${s.files} files` : ''}`} value={s.total} />
            <Tile label="Valid (dialer-ready)" value={s.valid} fg="#15803D" />
            <Tile label="Flagged" value={s.flagged} fg="#B91C1C" />
            <Tile label="Toll-free" value={s.toll_free} fg="#B91C1C" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <Tile label="9-digit / bad length" value={s.short_9_digit + s.wrong_length} fg="#B91C1C" />
            <Tile label="Not USA/Canada" value={s.not_us_canada} fg="#B91C1C" />
            <Tile label="Fake / placeholder" value={s.fake} fg="#B91C1C" />
            <Tile label="Duplicate (this upload)" value={s.duplicate} fg="#B45309" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <Tile label="Already checked before" value={s.seen_before} fg="#4338CA" />
            <Tile label="Area code ≠ state" value={s.area_state_mismatch} fg="#B45309" />
            <Tile label="Fake name (excluded)" value={s.fake_name} fg="#B91C1C" />
            <Tile label="Disposable email (excluded)" value={s.disposable_email} fg="#B91C1C" />
          </div>

          {/* Exclusion options — the THREE admin choices. Everything else
              (toll-free, bad length, non-US, fake number, fake name, disposable
              email, duplicates, seen-before) is excluded automatically. */}
          <div className="mb-5 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-[12px] font-extrabold text-[#050A1F] mb-2">Exclusion options <span className="font-semibold text-slate-400">— choose what to drop from the dialer file</span></div>
            <div className="flex flex-wrap gap-5">
              <label className="flex items-center gap-2 text-[12.5px] font-semibold text-slate-700">
                <input type="checkbox" checked={excludeArea} onChange={(e) => setExcludeArea(e.target.checked)} disabled={busy} />
                Area code ≠ state <span className="text-slate-400 font-normal">({s.area_state_mismatch} · free, VoIP/relocated signal)</span>
              </label>
              <label className={`flex items-center gap-2 text-[12.5px] font-semibold ${deepDone ? 'text-slate-700' : 'text-slate-300'}`}>
                <input type="checkbox" checked={excludeVoip} onChange={(e) => setExcludeVoip(e.target.checked)} disabled={!deepDone} />
                VoIP {deepDone ? <span className="text-slate-400 font-normal">({result.rows.filter((r) => r.ok && String(r.lineType).toLowerCase() === 'voip').length})</span> : <span className="text-slate-300 font-normal">(run deep check first)</span>}
              </label>
              <label className={`flex items-center gap-2 text-[12.5px] font-semibold ${deepDone ? 'text-slate-700' : 'text-slate-300'}`}>
                <input type="checkbox" checked={excludeLandline} onChange={(e) => setExcludeLandline(e.target.checked)} disabled={!deepDone} />
                Landline {deepDone ? <span className="text-slate-400 font-normal">({result.rows.filter((r) => r.ok && String(r.lineType).toLowerCase() === 'landline').length})</span> : <span className="text-slate-300 font-normal">(run deep check first)</span>}
              </label>
            </div>
            <div className="text-[11px] text-slate-400 mt-2">Always excluded: toll-free, 9-digit / bad length, non-US, fake/placeholder numbers, fake registrant names, disposable / hidden-identity emails, duplicates (this upload &amp; across all past uploads).</div>
          </div>

          {/* API accounting — shows the credit savings before any paid check. */}
          {deepAvailable && (s.api_cached > 0 || s.api_to_check > 0) && (
            <div className="mb-5 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-[12.5px] text-indigo-800">
              <b>NumVerify (paid) accounting:</b> {s.api_to_check} unique new valid number{s.api_to_check === 1 ? '' : 's'} would be looked up · {s.api_cached} already cached (free) · {s.seen_before} seen before (free, skipped). Only numbers that survive every free rule are ever sent to NumVerify — each checked once, then cached forever.
            </div>
          )}

          {/* Toolbar */}
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <label className="flex items-center gap-2 text-[12.5px] font-semibold text-slate-600">
              <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} /> Show only flagged rows
            </label>
            <div className="flex items-center gap-2">
              {deepAvailable && (
                <button onClick={deepCheck} disabled={deepBusy || busy} title="Look up line type (mobile/landline/VoIP) via NumVerify — only new, valid, uncached numbers are charged"
                  className="rounded-lg px-4 py-2 text-[13px] font-bold border disabled:opacity-50"
                  style={{ borderColor: '#6366F1', color: '#4338CA', background: '#EEF2FF' }}>
                  {deepBusy ? 'Checking line types…' : deepDone ? '✓ Line types checked' : `📞 Deep check line type (${s.api_to_check} new)`}
                </button>
              )}
              <button onClick={exportClean} disabled={busy} className="rounded-lg px-5 py-2 text-[13px] font-bold text-white disabled:opacity-50" style={{ background: '#050A1F' }}>
                {busy ? 'Preparing…' : `⬇ Download cleaned file (${keptCount} kept · ${removeCount} removed)`}
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="overflow-auto" style={{ maxHeight: '60vh' }}>
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-slate-50 text-[9px] uppercase text-slate-400 font-bold text-left">
                    <th className="px-3 py-2">#</th>
                    <th className="px-2 py-2">Phone</th>
                    <th className="px-2 py-2">Country</th>
                    <th className="px-2 py-2">Domain</th>
                    <th className="px-2 py-2">Registrant</th>
                    {result.multi && <th className="px-2 py-2">Source file</th>}
                    {deepDone && <th className="px-2 py-2">Line type</th>}
                    <th className="px-2 py-2">Issue</th>
                    <th className="px-2 py-2 text-right">Include?</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => {
                    const bad = !row.ok;
                    const domain = row.cells[0];
                    const regName = row.cells[4] || row.cells[5] || '';
                    return (
                      <tr key={row.index} className="border-t border-slate-50" style={bad ? { background: '#FEF2F2' } : {}}>
                        <td className="px-3 py-1.5 text-slate-400">{row.index + 2}</td>
                        <td className="px-2 py-1.5 font-mono" style={bad ? { color: '#B91C1C', fontWeight: 700 } : {}}>{row.phone || '—'}</td>
                        <td className="px-2 py-1.5 text-slate-500">{row.country || '—'}</td>
                        <td className="px-2 py-1.5 text-slate-600">{domain}</td>
                        <td className="px-2 py-1.5 text-slate-600">{regName}</td>
                        {result.multi && <td className="px-2 py-1.5 text-slate-400 text-[11px]">{row.srcFile || ''}</td>}
                        {deepDone && <td className="px-2 py-1.5 text-[11px]">{row.lineType ? <span className="font-semibold" style={{ color: row.lineType === 'mobile' ? '#15803D' : '#B45309' }}>{row.lineType}{row.carrier ? ` · ${row.carrier}` : ''}</span> : <span className="text-slate-300">—</span>}</td>}
                        <td className="px-2 py-1.5">
                          {bad
                            ? (row.reasonLabels || []).map((rl, i) => {
                              const p = REASON_PILL[rl] || { bg: '#FEE2E2', fg: '#B91C1C' };
                              return <span key={i} className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold mr-1 mb-0.5" style={{ background: p.bg, color: p.fg }}>{rl}</span>;
                            })
                            : <span className="text-green-600 font-bold">✓ OK</span>}
                          {/* Advisory soft signals (don't exclude unless enabled). */}
                          {(row.softReasonLabels || []).map((rl, i) => {
                            const p = REASON_PILL[rl] || { bg: '#FEF3C7', fg: '#B45309' };
                            return <span key={`s${i}`} className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold mr-1 mb-0.5" style={{ background: p.bg, color: p.fg }}>⚠ {rl}</span>;
                          })}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <button onClick={() => toggleRow(row.index)} className="rounded-md px-2.5 py-1 text-[11px] font-bold border"
                            style={row.ok ? { borderColor: '#BBF7D0', color: '#15803D', background: '#F0FDF4' } : { borderColor: '#FECACA', color: '#B91C1C', background: '#FEF2F2' }}>
                            {row.ok ? 'Included' : 'Excluded'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {shown.length === 0 && <tr><td colSpan={7 + (result.multi ? 1 : 0) + (deepDone ? 1 : 0)} className="px-3 py-6 text-center text-slate-400">No rows to show.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div className="text-[11px] text-slate-400 mt-2">The downloaded file has a <b>Cleaned</b> sheet (included rows only) and a <b>Removed</b> sheet listing the excluded numbers with their reason. Click a row’s Included/Excluded button to override a decision before downloading.</div>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, fg }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-3.5 py-3">
      <div className="text-[20px] font-extrabold leading-none" style={{ color: fg || '#050A1F' }}>{value}</div>
      <div className="text-[10.5px] text-slate-400 font-semibold mt-1.5 leading-tight">{label}</div>
    </div>
  );
}

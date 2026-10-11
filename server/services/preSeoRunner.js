/**
 * Pre-SEO report runner: orchestrates crawl → auto-capture → Claude analysis →
 * assemble report JSON. Runs in-process (best-effort, non-blocking) and updates
 * the PreSeoReport row's status/progress as it goes. PDF generation is a separate
 * step (generate()) so the user can review/edit the data first.
 */
const path = require('path');
const fs = require('fs/promises');
const { PreSeoReport, Settings } = require('../models');
const crawler = require('./crawler');
const { captureAuto } = require('./preSeoCapture');
const { buildReportData, refreshUploads } = require('./preSeoAnalyze');
const { renderPreSeo } = require('./renderer');
const { toRenderUrl, UPLOAD_DIR } = require('./preSeoStore');

function istNow() { return new Date(Date.now() + 330 * 60000); }
function monthYear() { return istNow().toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).toUpperCase(); }
function auditDate() { const d = istNow(); return `${d.getUTCDate()} ${d.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })} ${d.getUTCFullYear()}`; }

async function setStatus(id, patch) {
  try { const r = await PreSeoReport.findByPk(id); if (r) { Object.assign(r, patch); await r.save(); } } catch {}
}

// Kick off crawl + capture + analysis for a report (fire-and-forget).
async function run(reportId) {
  const report = await PreSeoReport.findByPk(reportId);
  if (!report) return;
  try {
    const s = await Settings.findOne();
    const anthropicKey = s && s.getKey ? s.getKey('anthropic') : null;
    const openaiKey = s && s.getKey ? s.getKey('openai') : null;
    const psKey = s && s.getKey ? s.getKey('pagespeed') : null;

    // Prefer runOptions (survives re-runs); fall back to the legacy data seed.
    const seed = report.data || {};
    const ro = report.runOptions || {};
    const sitemapUrl = ro.sitemapUrl || seed._sitemapUrl || '';
    const noSitemap = ro.noSitemap != null ? !!ro.noSitemap : !!seed._noSitemap;
    const accessMode = ro.accessMode || seed._accessMode || 'unsure';

    await setStatus(reportId, { status: 'capturing', progress: 10, currentStep: 'Fetching the website' });
    let crawl = {};
    try { crawl = await crawler.runTechnicalAudit(report.website, psKey, { sitemapUrl, noSitemap }); } catch (e) { console.error('[preSeo] crawl failed:', e.message); }
    crawl.website = report.website;
    crawl.domain = report.domain;
    await setStatus(reportId, { crawl, progress: 35, currentStep: 'Capturing screenshots' });

    // Auto screenshots (homepage, responsive, branded boxes) with red highlights.
    let shots = {};
    try { const cap = await captureAuto(crawl, reportId, (step) => setStatus(reportId, { currentStep: step })); shots = cap.shots || {}; } catch (e) { console.error('[preSeo] capture failed:', e.message); }
    // merge over any already-uploaded shots (uploads win)
    const existing = report.shots || {};
    const merged = { ...shots, ...existing };
    await setStatus(reportId, { shots: merged, status: 'analyzing', progress: 60, currentStep: 'Analysing with AI' });

    // Gather uploaded screenshots as base64 for Claude vision.
    const screenshots = await loadUploadedImages(merged);

    const seededServices = Array.isArray(ro.services) ? ro.services : (Array.isArray(seed._services) ? seed._services : []);
    const sm = crawl.sitemap || {};
    const totalPages = sm.urlCount && sm.urlCount > 0 ? sm.urlCount : null;
    const meta = {
      businessName: report.businessName || report.domain, shortName: (report.businessName || report.domain || '').split(' ')[0],
      monthYear: monthYear(), auditDate: auditDate(),
      pagesReviewed: totalPages || 1, totalPages,
      sitemapState: noSitemap ? 'none' : (sm.exists ? 'found' : 'missing'),
      preparedBy: report.createdByName || 'Adam G, Project Manager',
      preparedByRole: 'Project Manager',
      contactEmail: report.createdByEmail || 'adam@qtonix.com', contactPhone: '+91-8249016547',
      clientLogo: logoFor(crawl, report.domain),
      services: seededServices, accessMode,
    };
    const data = await buildReportData(crawl, meta, { anthropicKey, openaiKey }, screenshots);
    // attach shot urls into the data so the template can show them
    attachShots(data, merged);

    await setStatus(reportId, { data, status: 'ready', progress: 100, currentStep: 'Ready for review' });
  } catch (e) {
    console.error('[preSeo] run failed:', e.message);
    await setStatus(reportId, { status: 'failed', error: String(e.message || e).slice(0, 1000) });
  }
}

// Best-effort brand logo for the cover: prefer an apple-touch-icon or a
// <link rel="icon"> (usually the real logo mark), then og:image, and finally a
// high-res Google favicon — which works for any domain. Returns an absolute URL.
function logoFor(crawl, domain) {
  const html = (crawl && crawl.html) || '';
  const base = (crawl && crawl.finalUrl) || (domain ? `https://${domain}` : '');
  const abs = (u) => { try { return new URL(u, base).href; } catch { return ''; } };
  const attr = (tag, name, val) => {
    const re = new RegExp(`<${tag}[^>]*${name}=["']${val}["'][^>]*>`, 'i');
    const m = html.match(re); if (!m) return '';
    const h = m[0].match(/(?:href|content)=["']([^"']+)["']/i);
    return h ? abs(h[1]) : '';
  };
  // apple-touch-icon and shortcut/icon links are usually the brand mark.
  const touch = attr('link', 'rel', 'apple-touch-icon') || attr('link', 'rel', 'apple-touch-icon-precomposed');
  if (touch) return touch;
  const iconM = html.match(/<link[^>]*rel=["'][^"']*icon[^"']*["'][^>]*>/i);
  if (iconM) { const h = iconM[0].match(/href=["']([^"']+)["']/i); if (h) { const u = abs(h[1]); if (u && !/\.ico(\?|$)/i.test(u)) return u; } }
  const og = attr('meta', 'property', 'og:image') || attr('meta', 'name', 'og:image');
  if (og) return og;
  // Fallback: Google's favicon service at a usable size.
  const d = (domain || base || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  return d ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=128` : '';
}

async function loadUploadedImages(shots) {
  const out = [];
  for (const [key, v] of Object.entries(shots || {})) {
    if (!v || v.source !== 'upload' || !v.url) continue;
    try {
      let buf;
      if (/^https?:\/\//i.test(v.url)) {
        const res = await fetch(v.url); buf = Buffer.from(await res.arrayBuffer());
      } else if (v.url.startsWith('/uploads/')) {
        buf = await fs.readFile(path.join(UPLOAD_DIR, path.basename(v.url)));
      } else continue;
      const mime = /\.jpe?g($|\?)/i.test(v.url) ? 'image/jpeg' : 'image/png';
      out.push({ key, base64: buf.toString('base64'), mime });
    } catch {}
  }
  return out;
}

// Push shot urls into the report data's screenshot slots (ch1.homepageShot, and
// each chapter section .shot.img) by matching slot keys to the section labels.
function attachShots(data, shots) {
  const url = (k) => (shots[k] && shots[k].url) || null;
  if (url('homepage')) data.ch1.homepageShot = toPublic(url('homepage'));
  const bySlot = {
    '3.1': 'pagesource', '3.2': 'robots', '3.3': 'sitemap', '5.2': 'schema', '5.3': 'og', '4.4': 'responsive',
  };
  for (const ch of (data.chapters || [])) {
    for (const sec of (ch.sections || [])) {
      const slot = bySlot[sec.num];
      if (slot && url(slot) && sec.shot) { sec.shot.img = toPublic(url(slot)); }
      // also allow manual-upload slots keyed by section number (e.g. '2.1')
      if (url(sec.num) && sec.shot) sec.shot.img = toPublic(url(sec.num));
    }
  }
}
function toPublic(u) {
  // Remote (ImageKit) URLs load directly; local /uploads map to file:// for PDF.
  return toRenderUrl(u);
}

// Drop or trim sections that have nothing to show. Rule (per the report spec):
//   - A section flagged `manual` whose screenshot was NOT uploaded AND which has
//     no research-backed content (no `research` flag, no bullets, no table) is
//     removed entirely — no empty orange "[ PASTE SCREENSHOT HERE ]" box.
//   - A `manual` section with research content but no image keeps its content
//     and just loses the empty shot box.
//   - Auto-captured / research sections are always kept.
// A section is considered to "have content" if it carries a table, bullets,
// willdo, cols or weeks — i.e. something beyond the screenshot placeholder.
function hasBody(sec) {
  return !!(sec.table || (sec.bullets && sec.bullets.length) || sec.willdo || sec.cols || sec.weeks || sec.image);
}
function pruneSections(data) {
  for (const ch of (data.chapters || [])) {
    ch.sections = (ch.sections || []).filter((sec) => {
      const hasImg = !!(sec.shot && sec.shot.img);
      if (hasImg) return true;                 // uploaded/auto image → keep
      if (!sec.manual) return true;            // normal research section → keep
      // manual section, no image:
      if (sec.research && hasBody(sec)) {       // keep the researched content...
        delete sec.shot;                        // ...but remove the empty box
        return true;
      }
      return false;                             // nothing to show → drop section
    });
  }
  // A chapter with no sections left would render an empty band; drop it too.
  data.chapters = (data.chapters || []).filter((ch) => (ch.sections && ch.sections.length) || ch.stats);
}

// Generate the PDF from the (possibly edited) report data.
async function generate(reportId) {
  const report = await PreSeoReport.findByPk(reportId);
  if (!report || !report.data || !report.data.report) throw new Error('Report not analysed yet.');
  // Clean up the previous ImageKit PDF/HTML so regenerating doesn't orphan files.
  try {
    const ik = require('./imagekit');
    if (report.pdfFileId) ik.deleteFile(report.pdfFileId).catch(() => {});
    if (report.htmlFileId) ik.deleteFile(report.htmlFileId).catch(() => {});
  } catch {}
  await setStatus(reportId, { status: 'rendering', currentStep: 'Reading uploaded screenshots' });
  // Work on a deep copy so pruning/refresh for the PDF never mutates the stored
  // data (the user may upload more screenshots and regenerate).
  const pdfData = JSON.parse(JSON.stringify(report.data));

  // Read the uploaded screenshots now (they usually arrive in the review step,
  // after run()) and write a real per-section observation from each, plus the
  // live AI Answers section. This is why uploaded sections get relevant text.
  try {
    const s = await Settings.findOne();
    const keys = { anthropicKey: s && s.getKey ? s.getKey('anthropic') : null, openaiKey: s && s.getKey ? s.getKey('openai') : null };
    const screenshots = await loadUploadedImages(report.shots || {});
    const meta = {
      businessName: report.businessName || report.domain,
      shortName: (report.businessName || report.domain || '').split(' ')[0],
    };
    await setStatus(reportId, { currentStep: 'Analysing screenshots with AI' });
    await refreshUploads(pdfData, report.crawl || {}, meta, keys, screenshots);
    // persist the refreshed observations back to the stored data too, so the
    // review view and any re-download reflect them (without the prune).
    const stored = JSON.parse(JSON.stringify(pdfData));
    report.data = stored; report.changed('data', true); await report.save();
  } catch (e) { console.error('[preSeo] refresh uploads failed:', e.message); }

  await setStatus(reportId, { currentStep: 'Generating PDF' });
  // re-attach shots as file:// for the PDF, then drop empty/un-uploaded sections
  attachShots(pdfData, report.shots || {});
  pruneSections(pdfData);
  const { pdfPath, htmlPath, pdfUrl, htmlUrl, pdfFileId, htmlFileId } = await renderPreSeo(pdfData, `${report.domain}-${report.id}`);
  await setStatus(reportId, { status: 'complete', pdfPath, htmlPath, pdfUrl, htmlUrl, pdfFileId, htmlFileId, completedAt: new Date(), currentStep: 'Complete', progress: 100 });
  return { pdfPath, htmlPath, pdfUrl, htmlUrl };
}

// ---------------------------------------------------------------------------
// Pre-download AI verification. Before the PDF is offered for download, we
// re-read the factual fields in the report (business name, address(es), phone
// number(s), email) against the raw crawl evidence and ask Claude to catch
// obvious mistakes (e.g. an address that is actually marketing text, a name
// that doesn't match the site). Each field comes back as a "check" the user
// resolves in a popup: keep what's shown, use the AI's suggestion, type their
// own, or mark "no data found" (blank). The user can also choose, per field or
// for all, to let the AI decide.
//
// Returns { checks: [ { id, label, current, aiSuggestion, aiConfidence,
//   aiVerdict: 'ok'|'fix'|'uncertain', note, options:[...] } ], summary }.
// ---------------------------------------------------------------------------
async function verify(reportId) {
  const report = await PreSeoReport.findByPk(reportId);
  if (!report || !report.data) throw new Error('Report not analysed yet.');
  const data = report.data;
  const crawl = report.crawl || {};
  const nap = (crawl.nap) || {};
  const sc = nap.schema || {};

  // Current values as shown in the report (from the NAP table in data).
  const cur = {
    name: nap.name || '',
    addresses: Array.isArray(nap.addresses) ? nap.addresses : [],
    phones: Array.isArray(nap.phones) ? nap.phones : [],
    emails: Array.isArray(nap.emails) ? nap.emails : [],
  };

  // Evidence we give the model to judge against — straight from the crawl, so
  // the model checks the report values against what the site actually contains.
  const evidence = {
    domain: crawl.domain || report.domain,
    businessNameOnReport: report.businessName || '',
    schemaName: sc.schemaName || null,
    pageName: sc.pageName || null,
    schemaAddresses: sc.schemaAddresses || [],
    pageAddresses: sc.pageAddresses || [],
    schemaPhones: sc.schemaPhones || [],
    pagePhones: sc.pagePhones || [],
    reportName: cur.name,
    reportAddresses: cur.addresses,
    reportPhones: cur.phones,
    reportEmails: cur.emails,
    // a trimmed text sample so the model can sanity-check against real copy
    bodyTextSample: (crawl.bodyTextSample || '').slice(0, 1500),
  };

  let ai = null;
  try {
    const s = await Settings.findOne();
    const anthropicKey = s && s.getKey ? s.getKey('anthropic') : null;
    const openaiKey = s && s.getKey ? s.getKey('openai') : null;
    if (anthropicKey || openaiKey) {
      const { callAI } = require('./aiVisibility');
      const sys = 'You are a meticulous QA checker for a local-SEO audit report. You are given the business contact details (NAP) that a report will show, plus the raw evidence pulled from the website. Your job is to catch mistakes BEFORE the report is sent to a client. A value is WRONG if it is marketing/review copy rather than a real detail (e.g. an "address" that reads like "7 out of 5, award-winning brand of..."), if it mixes two things together, or if it clearly contradicts the site. Output ONLY JSON.';
      const prompt = `Evidence from the website:\n${JSON.stringify(evidence, null, 2)}\n\nFor EACH field below, judge the value the report will show:\n- name (business name)\n- address (may be multiple)\n- phone (may be multiple)\n- email (may be multiple)\n\nReturn JSON exactly:\n{\n  "checks": [\n    { "id": "name|address|phone|email", "verdict": "ok|fix|uncertain", "suggestion": "the corrected value you recommend, or empty string if there is no reliable value", "confidence": 0-100, "note": "one short plain-English reason" }\n  ]\n}\nRules:\n- "ok": the shown value is a real, clean detail. suggestion = the clean value.\n- "fix": the shown value is wrong or dirty and you are confident of the correct value. suggestion = the corrected value.\n- "uncertain": you cannot tell what the real value is from the evidence. suggestion = "" (empty).\n- Never invent an address or phone that is not supported by the evidence.\n- Keep addresses as a single clean line each; if multiple, join with " | ".`;
      const out = await callAI({ anthropicKey, openaiKey, system: sys, messages: [{ role: 'user', content: prompt }], maxTokens: 900 });
      try { ai = JSON.parse((out || '').replace(/```json|```/g, '').trim()); } catch { ai = null; }
    }
  } catch (e) { console.error('[preSeo] verify AI failed:', e.message); }

  const aiByField = {};
  if (ai && Array.isArray(ai.checks)) for (const c of ai.checks) if (c && c.id) aiByField[c.id] = c;

  // Rule-based safety net — runs even when the AI call is unavailable or returns
  // "ok" for something that is clearly dirty. Catches the classic failure where
  // an "address" is actually marketing/review copy.
  const JUNK = /(out of \d|award[- ]?winning|\bbrand\b|reviews?\b|\bstars?\b|rating|global leader|money[- ]back|guarantee|subscribe|newsletter)/i;
  const looksLikeAddress = (s) => /\d/.test(s) && /(street|st\.?|road|rd\.?|avenue|ave\.?|lane|drive|dr\.?|suite|floor|blvd|boulevard|way|court|unit|place|\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b|\b\d{5}\b)/i.test(s);
  const ruleVerdict = (id, val) => {
    if (!val) return { verdict: 'uncertain', note: 'Nothing was found for this field.' };
    if (id === 'address') {
      if (JUNK.test(val)) return { verdict: 'fix', note: 'The detected address looks like marketing or review text, not a real address.' };
      if (!looksLikeAddress(val)) return { verdict: 'uncertain', note: "This doesn't look like a complete street address — please confirm." };
    }
    if (id === 'name' && JUNK.test(val)) return { verdict: 'fix', note: 'The business name may contain extra marketing words.' };
    if (id === 'phone' && !/\d{6,}/.test(val.replace(/\D/g, ''))) return { verdict: 'uncertain', note: 'The phone number looks incomplete.' };
    return { verdict: 'ok', note: '' };
  };

  // Build the resolved check list the popup renders.
  const mk = (id, label, currentVal) => {
    const a = aiByField[id] || {};
    const rule = ruleVerdict(id, currentVal);
    // The stricter verdict wins: 'fix' > 'uncertain' > 'ok'.
    const rank = { fix: 2, uncertain: 1, ok: 0 };
    const aiV = a.verdict || null;
    const verdict = (rank[rule.verdict] >= rank[aiV] || !aiV) ? rule.verdict : aiV;
    return {
      id, label,
      current: currentVal,
      aiSuggestion: a.suggestion != null ? String(a.suggestion) : '',
      aiConfidence: a.confidence != null ? a.confidence : null,
      aiVerdict: verdict,
      note: a.note || rule.note || '',
    };
  };

  const checks = [
    mk('name', 'Business name', cur.name),
    mk('address', 'Address', cur.addresses.join(' | ')),
    mk('phone', 'Phone number', cur.phones.join(' | ')),
    mk('email', 'Email', cur.emails.join(' | ')),
  ];

  // Schema/brand consistency notes (informational — surfaced in the popup too).
  const notes = [];
  if (!sc.hasOrgSchema) notes.push('No Organization/LocalBusiness schema found — contact details are not machine-readable.');
  else if (!sc.napInSchema) notes.push('Schema present but it does not include the address or phone.');
  if (sc.brandMismatch) notes.push(`Brand name mismatch: schema says "${sc.brandMismatch.schema}", the site shows "${sc.brandMismatch.page}".`);
  if (sc.addressMismatch) notes.push('An address is shown on the site but missing from the schema.');
  if (sc.addressValueMismatch) notes.push('The schema address does not match the address shown on the page.');

  const needsReview = checks.some((c) => c.aiVerdict !== 'ok');
  return { checks, notes, needsReview };
}

// Apply the user's resolved NAP values back onto the stored report data, then
// (optionally) let the AI auto-fill anything the user left to "AI decide".
// resolutions: { name:{mode,value}, address:{...}, phone:{...}, email:{...} }
//   mode: 'keep' | 'ai' | 'custom' | 'blank'
async function applyVerification(reportId, resolutions) {
  const report = await PreSeoReport.findByPk(reportId);
  if (!report || !report.data) throw new Error('Report not analysed yet.');
  const crawl = report.crawl || {};
  const nap = Object.assign({}, crawl.nap || {});
  const multi = (v) => String(v || '').split('|').map((x) => x.trim()).filter(Boolean);

  // Re-run verify so 'ai' / 'keep' modes have the AI suggestion + current value.
  let v = null; try { v = await verify(reportId); } catch {}
  const byId = {}; if (v) for (const c of v.checks) byId[c.id] = c;

  const resolveField = (id) => {
    const r = (resolutions && resolutions[id]) || { mode: 'keep' };
    const c = byId[id] || {};
    if (r.mode === 'blank') return '';
    if (r.mode === 'custom') return r.value != null ? r.value : '';
    if (r.mode === 'ai') return c.aiSuggestion || (r.value != null ? r.value : '') || c.current || '';
    return c.current != null ? c.current : (r.value != null ? r.value : ''); // keep
  };

  nap.name = resolveField('name') || '';
  nap.addresses = multi(resolveField('address'));
  nap.phones = multi(resolveField('phone'));
  nap.emails = multi(resolveField('email'));
  nap.present = !!(nap.name || nap.addresses.length || nap.phones.length || nap.emails.length);

  // Persist onto crawl.nap AND rebuild the NAP section in data so the report
  // table/observations reflect the resolved values.
  crawl.nap = nap;
  report.crawl = crawl; report.changed('crawl', true);

  try {
    const { rebuildNapSection } = require('./preSeoAnalyze');
    if (typeof rebuildNapSection === 'function') {
      const data = JSON.parse(JSON.stringify(report.data));
      rebuildNapSection(data, crawl);
      report.data = data; report.changed('data', true);
    }
  } catch (e) { console.error('[preSeo] rebuild NAP failed:', e.message); }

  await report.save();
  return { ok: true, nap };
}

module.exports = { run, generate, setStatus, verify, applyVerification };

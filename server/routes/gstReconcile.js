// GST reconciliation routes (admin only; mounted under /api/gst-reconcile).
//
//   POST /reconcile     run the engine on uploaded files, return the result (no save)
//   POST /save          upsert a month's (admin-edited) reconciliation
//   GET  /list          saved months
//   GET  /:id           one saved month
//   DELETE /:id         delete a saved month
//   POST /export/xlsx   build the CA-format Excel from a result → { base64 }
//   POST /export/pdf    build a one-page PDF summary from a result → { base64 }

const express = require('express');
const router = express.Router();
const { GstReconciliation } = require('../models');
const engine = require('../services/reconcile');

const IN = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const b64ToBuffer = (s) => Buffer.from(String(s || '').replace(/^data:[^;]+;base64,/, ''), 'base64');
const b64ToText = (s) => b64ToBuffer(s).toString('utf8');

function actor(req) { return { id: req.user && req.user.id, name: (req.user && req.user.name) || 'Admin' }; }

// --- Run reconciliation on uploaded files (does NOT persist) ---------------
router.post('/reconcile', async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.month) return res.status(400).json({ error: 'Select a month first.' });
    if (!b.indianBank && !b.kotak) return res.status(400).json({ error: 'Upload at least the Indian Bank or Kotak statement.' });
    const inputs = {
      month: b.month,
      lastInv: b.lastInv || '',
      indianBank: b.indianBank ? b64ToBuffer(b.indianBank) : null,
      kotak: b.kotak ? b64ToBuffer(b.kotak) : null,
      fircs: Array.isArray(b.fircs) ? b.fircs.map((f) => ({ buffer: b64ToBuffer(f.base64 || f), name: f.name || 'FIRC' })) : [],
      stripeCsv: b.stripeCsv ? b64ToText(b.stripeCsv) : '',
      paypalCsv: b.paypalCsv ? b64ToText(b.paypalCsv) : '',
    };
    const result = await engine.reconcile(inputs);
    res.json({ ok: true, result });
  } catch (e) { next(e); }
});

// --- Save (upsert by month) -------------------------------------------------
router.post('/save', async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.month || !b.result) return res.status(400).json({ error: 'Nothing to save.' });
    const a = actor(req);
    const payload = {
      month: b.month,
      lastInv: b.lastInv || (b.result && b.result.lastInv) || null,
      status: b.status || 'final',
      result: JSON.stringify(b.result),
      createdById: a.id,
      createdByName: a.name,
    };
    let row = await GstReconciliation.findOne({ where: { month: b.month } });
    if (row) await row.update(payload); else row = await GstReconciliation.create(payload);
    res.json({ ok: true, item: row.toJSON() });
  } catch (e) { next(e); }
});

// --- List saved months ------------------------------------------------------
router.get('/list', async (req, res, next) => {
  try {
    const rows = await GstReconciliation.findAll({ order: [['month', 'DESC']] });
    // Light list (no heavy result payload).
    const items = rows.map((r) => {
      const j = r.toJSON(); const t = (j.result && j.result.totals) || {};
      return { _id: j._id, month: j.month, status: j.status, lastInv: j.lastInv,
        createdByName: j.createdByName, updatedAt: j.updatedAt,
        paypalInr: t.paypalInr, stripeInr: t.stripeInr, pendingCount: t.pendingCount ?? t.unclassifiedCount };
    });
    res.json({ items });
  } catch (e) { next(e); }
});

// --- One saved month --------------------------------------------------------
router.get('/:id', async (req, res, next) => {
  try {
    const row = await GstReconciliation.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found.' });
    res.json({ item: row.toJSON() });
  } catch (e) { next(e); }
});

// --- Delete -----------------------------------------------------------------
router.delete('/:id', async (req, res, next) => {
  try {
    const row = await GstReconciliation.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found.' });
    await row.destroy();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// --- Excel export (CA format) ----------------------------------------------
// Columns: Month | INV Number | Txn Date | INR Value | USD Value | Rate |
//          Citi UTR Ref | FIRC Advice No | Merchant | Account
router.post('/export/xlsx', async (req, res, next) => {
  try {
    const XLSX = require('xlsx');
    const result = (req.body && req.body.result) || {};
    const monthLabel = monthName(result.month);
    const wb = XLSX.utils.book_new();

    // --- Sheet 1: Reconciliation (CA format) — one date-sorted list ---
    const head = ['Month', 'INV Number', 'Txn Date', 'INR Value', 'USD Value', 'Rate', 'Ref (Citi UTR / Txn ID)', 'FIRC Advice No', 'Merchant', 'Account'];
    const rows = [head];
    for (const l of exportLines(result)) {
      const fircCol = l.fircAdvice || (l.kind === 'stripe' ? 'No FIRC (Stripe)' : l.kind === 'wise' ? 'No FIRC (Wise)' : (l.kind === 'other' || l.kind === 'interest') ? 'Other (interest + misc credits)' : l.kind === 'manual' ? (l.currency && l.currency !== 'USD' ? l.currency : 'Inward remittance') : '');
      rows.push([monthLabel, l.invNumber || '', l.txnDate || '', l.inr ?? '', l.usd ?? '', l.rate || '', l.ref || '', fircCol, l.merchant || '', l.account || '']);
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 10 }, { wch: 15 }, { wch: 12 }, { wch: 14 }, { wch: 11 }, { wch: 8 }, { wch: 22 }, { wch: 26 }, { wch: 14 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Reconciliation');

    // --- Sheet 2: Totals + review ---
    const g = groupedTotals(result);
    const sm = [['Summary', '']];
    sm.push(['Total received', g.totalReceived]);
    sm.push(['Kotak Bank (total)', g.kotak.total]);
    sm.push(['  Stripe', g.kotak.stripe]);
    sm.push(['  Wise', g.kotak.wise]);
    sm.push(['  Inward remittance', g.kotak.inward]);
    sm.push(['  Other', g.kotak.other]);
    sm.push(['Indian Bank (total)', g.indian.total]);
    sm.push(['  PayPal', g.indian.paypal]);
    sm.push(['', '']);
    for (const u of (result.pending || [])) { if (u.excluded || u.resolved) continue; sm.push(['Needs input (inward)', u.desc || '']); }
    for (const f of (result.unmatchedFirc || [])) sm.push(['FIRC without bank credit', `${f.txnDate || ''} · ${f.inr ?? ''} · ${f.citiRef || ''}`]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sm), 'Summary');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.json({ ok: true, base64: buf.toString('base64'), fileName: `GST-Reconciliation-${result.month || 'month'}.xlsx` });
  } catch (e) { next(e); }
});

// --- PDF summary (one page) -------------------------------------------------
router.post('/export/pdf', async (req, res, next) => {
  try {
    const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
    const result = (req.body && req.body.result) || {};
    const t = result.totals || {};
    // pdf-lib standard fonts (WinAnsi) can't encode ₹ — use "Rs." in the PDF.
    const RS = (n) => (n == null || n === '') ? '' : 'Rs.' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const US = (n) => (n == null || n === '') ? '' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const ascii = (s) => String(s == null ? '' : s).replace(/₹/g, 'Rs.').replace(/[^\x00-\xFF]/g, '');

    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const navy = rgb(0.02, 0.04, 0.12); const orange = rgb(1, 0.42, 0); const grey = rgb(0.4, 0.44, 0.5);
    const line0 = rgb(0.85, 0.87, 0.9);

    let page = doc.addPage([595, 842]); // A4 portrait
    let y = 802;
    const clip = (s, max) => { s = ascii(s); return s.length > max ? s.slice(0, max - 1) + '…'.replace('…', '.') : s; };
    const draw = (s, x, size, f = font, color = navy) => page.drawText(ascii(s), { x, y, size, font: f, color });
    const newPage = () => { page = doc.addPage([595, 842]); y = 802; };
    const ensure = (need) => { if (y - need < 48) { newPage(); } };

    // Column layout for the itemised table (x positions).
    const COL = { inv: 40, date: 118, inr: 175, usd: 250, rate: 305, ref: 345, merchant: 470, acct: 528 };
    function header() {
      draw('INV', COL.inv, 8, bold, grey); draw('Txn Date', COL.date, 8, bold, grey);
      page.drawText('INR', { x: COL.inr, y, size: 8, font: bold, color: grey });
      page.drawText('USD', { x: COL.usd, y, size: 8, font: bold, color: grey });
      draw('Rate', COL.rate, 8, bold, grey); draw('Ref', COL.ref, 8, bold, grey);
      draw('Merchant', COL.merchant, 8, bold, grey); draw('Acct', COL.acct, 8, bold, grey);
      y -= 4; page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.7, color: line0 }); y -= 12;
    }
    const rowLine = (l) => {
      ensure(16);
      if (y === 802) { /* fresh page from ensure handled below */ }
      draw(clip(l.invNumber || '', 14), COL.inv, 8.5, (l.kind === 'other' || l.kind === 'interest') ? bold : font);
      draw(l.txnDate || '', COL.date, 8.5);
      const inrTxt = RS(l.inr); const usdTxt = US(l.usd);
      page.drawText(inrTxt, { x: COL.inr, y, size: 8.5, font, color: navy });
      page.drawText(usdTxt + (l.derivedUsd ? '*' : ''), { x: COL.usd, y, size: 8.5, font, color: l.derivedUsd ? grey : navy });
      draw(l.rate || '', COL.rate, 8.5);
      draw(clip(l.ref || '', 22), COL.ref, 7.5, font, grey);
      draw(clip(l.merchant || '', 11), COL.merchant, 8.5, font, l.merchant === 'PayPal' ? rgb(0.35, 0.2, 0.8) : l.merchant === 'Stripe' ? rgb(0.02, 0.5, 0.3) : navy);
      draw(clip(l.account || '', 12), COL.acct, 7.5, font, grey);
      y -= 15;
    };

    // Title
    draw('Qtonix', 40, 20, bold, navy); page.drawText('.', { x: 96, y, size: 20, font: bold, color: orange });
    draw('GST Reconciliation', 120, 16, bold, navy);
    y -= 22; draw(`${monthName(result.month)}  -  PayPal, Stripe, Wise & other inward remittance`, 40, 10.5, font, grey);
    y -= 26;

    // Totals band — total received on top, then grouped by bank.
    const g = groupedTotals(result);
    draw('Total received', 40, 13, bold, orange); page.drawText(RS(g.totalReceived), { x: 300, y, size: 13, font: bold, color: navy }); y -= 22;
    const tl = (a, b, ind = 40, bd = bold) => { draw(a, ind, 9.5, bd); draw(b, 300, 9.5, font); y -= 14; };
    tl('Kotak Bank (total)', RS(g.kotak.total));
    tl('   • Stripe', RS(g.kotak.stripe), 50, font);
    if (g.kotak.wise) tl('   • Wise', RS(g.kotak.wise), 50, font);
    if (g.kotak.inward) tl('   • Inward remittance', RS(g.kotak.inward), 50, font);
    if (g.kotak.other) tl('   • Other', RS(g.kotak.other), 50, font);
    y -= 2;
    tl('Indian Bank (total)', RS(g.indian.total));
    tl('   • PayPal', RS(g.indian.paypal), 50, font);
    y -= 8;
    draw('Reconciliation — all transactions (date order)', 40, 12, bold, orange); y -= 16;
    header();

    for (const l of exportLines(result)) rowLine(l);

    // Grand total row
    ensure(20); y -= 2; page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.7, color: line0 }); y -= 13;
    const totInr = exportLines(result).reduce((s, l) => s + (Number(l.inr) || 0), 0);
    const totUsd = exportLines(result).reduce((s, l) => s + (Number(l.usd) || 0), 0);
    draw('TOTAL', COL.inv, 9, bold);
    page.drawText(RS(totInr), { x: COL.inr, y, size: 9, font: bold, color: navy });
    page.drawText(US(totUsd), { x: COL.usd, y, size: 9, font: bold, color: navy });
    y -= 18;

    // Still needs input
    const pend = (result.pending || []).filter((p) => !p.excluded && !p.resolved);
    if (pend.length) {
      ensure(40); draw('Still needs input (inward remittance)', 40, 11, bold, rgb(0.8, 0.2, 0.1)); y -= 15;
      for (const p of pend) { ensure(14); draw(`${p.date || ''}   ${RS(p.inr)}   ${clip(p.desc || '', 70)}`, 46, 8.5, font, grey); y -= 13; }
    }
    ensure(20); draw('* USD derived at the month’s average PayPal conversion rate (no FIRC for Stripe / Wise / Other).', 40, 8, font, grey); y -= 12;
    draw(`Generated ${new Date().toLocaleString('en-IN')}`, 40, 8, font, grey);

    const bytes = await doc.save();
    res.json({ ok: true, base64: Buffer.from(bytes).toString('base64'), fileName: `GST-Reconciliation-${result.month || 'month'}.pdf` });
  } catch (e) { next(e); }
});

function monthName(m) {
  const mm = String(m || '').match(/^(\d{4})-(\d{2})$/);
  if (!mm) return m || '';
  const names = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${names[parseInt(mm[2], 10)]} ${mm[1]}`;
}

// The rows to export, in order: active (non-excluded) reconciliation lines as the
// client has sorted and INV-numbered them, then the combined "Other" line last.
// The client merges any resolved inward credits into `lines` before sending.
function exportLines(result) {
  const out = (result.lines || []).filter((l) => !l.excluded);
  const other = result.otherLine || result.interestLine; // interestLine kept for old saved months
  if (other && other.inr && !other.excluded) out.push(other);
  return out;
}

// Grouped totals by bank for the summary band. Computed from the export lines so
// it always matches what is shown/exported.
function groupedTotals(result) {
  const lines = exportLines(result);
  const sum = (pred) => round2(lines.filter(pred).reduce((s, l) => s + (Number(l.inr) || 0), 0));
  const kotak = {
    stripe: sum((l) => l.account === 'Kotak' && l.merchant === 'Stripe'),
    wise: sum((l) => l.account === 'Kotak' && l.merchant === 'Wise'),
    inward: sum((l) => l.account === 'Kotak' && (l.kind === 'manual' || l.category === 'inward')),
    other: sum((l) => l.account === 'Kotak' && (l.kind === 'other' || l.merchant === 'Other')),
  };
  kotak.total = round2(kotak.stripe + kotak.wise + kotak.inward + kotak.other);
  const indian = { paypal: sum((l) => l.account === 'Indian Bank' && l.merchant === 'PayPal') };
  indian.total = indian.paypal;
  const totalReceived = round2(kotak.total + indian.total);
  return { kotak, indian, totalReceived };
}
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

module.exports = router;
module.exports.exportLines = exportLines;
module.exports.groupedTotals = groupedTotals;
module.exports.monthName = monthName;

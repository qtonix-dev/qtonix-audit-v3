// GST reconciliation engine for PayPal + Stripe inward remittance.
//
// Sources (all uploaded by admin for one month):
//   - Indian Bank statement (PDF) ...... receives ALL PayPal inward remittance
//   - Kotak Bank statement (PDF) ....... receives Stripe payouts + FD maturity / sweep
//   - PayPal FIRC advices (PDF, many) .. FEMA proof: per-txn USD / INR / rate / Citi UTR
//   - PayPal transaction history (CSV) . USD gross, conversion fee cross-check
//   - Stripe payout report (CSV) ....... payout net + transaction id (no FIRC exists)
//
// The engine:
//   1. Reads every CREDIT in Indian Bank + Kotak with date + description.
//   2. Classifies each as PayPal / Stripe / FD-interest / unclassified.
//   3. Any unclassified credit > ₹10,000 is surfaced for the admin to fill or delete.
//   4. PayPal credits are matched to a FIRC annexure row (USD, rate, Citi UTR, advice no).
//   5. Stripe credits are matched to the Stripe CSV payout (transaction id).
//   6. FD maturity / sweep interest is the sub-₹10,000 remainder, summed into ONE
//      "Interest received" line dated the last day of the month.
//
// All PDF parsing is positional (pdfjs-dist) so wrapped table cells are read by
// column, not by fragile reading-order regex.

const CLEAN = (s) => String(s == null ? '' : s).replace(/\s+/g, '');
const NUM = (s) => {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/[,\s₹]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// pdfjs v5 is ESM-only; load it once from CommonJS via dynamic import.
let _pdfjs = null;
async function pdfjs() {
  if (!_pdfjs) _pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return _pdfjs;
}

// Return positioned text items for every page: [{ page, s, x, y }].
async function pdfItems(buffer) {
  const lib = await pdfjs();
  const data = new Uint8Array(buffer);
  const doc = await lib.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      const s = (it.str || '').trim();
      if (s) out.push({ page: p, s, x: it.transform[4], y: it.transform[5] });
    }
  }
  try { await doc.destroy(); } catch { /* ignore */ }
  return out;
}

// Reading-order plain text of a page-group (y desc, then x asc), one line per y-band.
function itemsToLines(items) {
  const byY = {};
  for (const it of items) { const k = Math.round(it.y / 3) * 3; (byY[k] = byY[k] || []).push(it); }
  return Object.keys(byY).map(Number).sort((a, b) => b - a)
    .map((y) => byY[y].sort((a, b) => a.x - b.x).map((i) => i.s).join(' '));
}

// ---------------------------------------------------------------------------
// FIRC advice (PayPal) — one PDF covers a date range; annexure lists each txn.
// Columns by x: FIRC Advice(<215) | Bank | Acct | TransRef | CitiUTR(~290) |
//               CustRef | TxnDate(~440) | INR(~490) | USD(~550) | Rate(~620) | Pcode
// ---------------------------------------------------------------------------
async function parseFirc(buffer, fileName) {
  const items = await pdfItems(buffer);
  const pages = {};
  for (const it of items) { (pages[it.page] = pages[it.page] || []).push(it); }

  // Advice / Ref No — the "ADS...-<MON>-<YEAR>" token anywhere on page 1.
  let advice = null;
  const p1 = (pages[1] || []).map((i) => i.s).join(' ');
  const am = CLEAN(p1).match(/(ADS-?[A-Z0-9]*KHB[A-Z0-9]+-?[A-Z]{3}-?\d{4})/i)
          || CLEAN(p1).match(/(ADS-?[A-Z0-9]+-?[A-Z]{3}-?\d{4})/i);
  if (am) advice = am[1].toUpperCase();
  if (!advice && fileName) {
    const fm = CLEAN(fileName).match(/([A-Z0-9]{10,})/i);
    if (fm) advice = fm[1].toUpperCase();
  }

  const rows = [];
  for (const pg of Object.keys(pages).map(Number)) {
    if (pg === 1) continue; // page 1 is the certificate, not the annexure
    const pit = pages[pg];
    // Anchor a record on its INR value (INR column, decimal number).
    const anchors = pit.filter((i) => i.x >= 478 && i.x < 545 && /^[\d,]+\.\d+$/.test(i.s.replace(/\s/g, '')));
    for (const a of anchors) {
      const near = (lo, hi, test) => pit
        .filter((i) => i.x >= lo && i.x < hi && Math.abs(i.y - a.y) <= 14 && test(i))
        .sort((i, j) => Math.abs(i.y - a.y) - Math.abs(j.y - a.y));
      const citi = near(265, 335, (i) => /^CITIN\d/.test(CLEAN(i.s))).map((i) => CLEAN(i.s))[0] || null;
      const usd = near(545, 605, (i) => /^[\d,]+\.\d+$/.test(i.s.replace(/\s/g, ''))).map((i) => NUM(i.s))[0];
      const rate = near(605, 655, (i) => /^\d{2,3}$/.test(i.s.trim())).map((i) => i.s.trim())[0] || null;
      const dfr = pit.filter((i) => i.x >= 430 && i.x < 478 && Math.abs(i.y - a.y) <= 14)
        .sort((i, j) => j.y - i.y || i.x - j.x).map((i) => CLEAN(i.s)).join('');
      const inr = NUM(a.s);
      if (inr == null) continue;
      rows.push({
        advice,
        citiRef: citi,
        txnDate: normFircDate(dfr),
        inr,
        usd: usd == null ? null : round2(usd),
        rate: rate ? String(rate) : null,
      });
    }
  }
  return { advice, rows, source: fileName || 'FIRC' };
}

function normFircDate(d) {
  // FIRC dates come as MM/DD/YYYY → return DD/MM/YYYY (Indian convention on the CA sheet).
  const m = CLEAN(d).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return d || null;
  return `${m[2]}/${m[1]}/${m[3]}`;
}

// ---------------------------------------------------------------------------
// Indian Bank statement — every PayPal inward credit.
// Layout: "DD Mon YYYY  <details...>  INR <credit>  INR <balance>"  (TRANSFER FROM)
// Debits are "TRANSFER TO ... INR <debit> - INR <balance>".
// ---------------------------------------------------------------------------
async function parseIndianBank(buffer, fileName) {
  const items = await pdfItems(buffer);
  const byPage = {};
  for (const it of items) { (byPage[it.page] = byPage[it.page] || []).push(it); }
  let full = '';
  for (const pg of Object.keys(byPage).map(Number).sort((a, b) => a - b)) {
    full += itemsToLines(byPage[pg]).join('\n') + '\n';
  }
  // Split into transaction blocks that start with a date.
  const blocks = full.split(/(?=\d{2} [A-Za-z]{3} \d{4} )/);
  const credits = [];
  for (const b of blocks) {
    const m = b.match(/^(\d{2} [A-Za-z]{3} \d{4}) ([\s\S]*)/);
    if (!m) continue;
    const date = m[1]; const body = m[2];
    if (!/TRANSFER FROM/i.test(body)) continue; // credits only
    const amts = [...body.matchAll(/INR\s*([\d,]+\.\d+)/gi)].map((x) => NUM(x[1]));
    if (!amts.length) continue;
    const inr = amts[0]; // first INR after details = credit amount
    const cref = (CLEAN(body).match(/(CITIN\d+)/) || [])[1] || null;
    const isPaypal = /PAYPAL/i.test(body);
    // Was this credit an internal transfer from our own Kotak account?
    // Kotak's IFSC/NEFT tag is KKBK — those are own-money moves, not revenue.
    const fromKotak = /KKBK|KOTAK/i.test(body);
    credits.push({
      date: normStatementDate(date),
      rawDate: date,
      inr,
      citiRef: cref,
      isPaypal,
      fromKotak,
      desc: body.replace(/\s+/g, ' ').trim().slice(0, 120),
    });
  }
  return { credits, source: fileName || 'Indian Bank' };
}

// ---------------------------------------------------------------------------
// Kotak statement — Stripe payouts, FD maturity / sweep interest, other credits.
// Parsed POSITIONALLY so the Debit (Withdrawal) column is never mistaken for a
// credit. Columns by x:  serial(<60) | date(60-112) | description(112-350) |
//   Withdrawal/Dr(350-425) | Deposit/Cr(425-495) | Balance(495+).
// Only Deposit-column amounts count as credits.
// ---------------------------------------------------------------------------
async function parseKotak(buffer, fileName) {
  const items = await pdfItems(buffer);
  const byPage = {};
  for (const it of items) { (byPage[it.page] = byPage[it.page] || []).push(it); }

  const stripe = [];        // { inr, ref, date }
  const wise = [];          // Wise inward remittance credits { inr, date, desc }
  const fdInterest = [];     // { source, gross, interest, date, desc } — FD maturity only
  const smallCredits = [];   // misc credits ≤ ₹10,000 → folded into the "Other" line
  const otherCredits = [];   // larger unclassified credits (customer remittance → admin input)

  for (const pg of Object.keys(byPage).map(Number).sort((a, b) => a - b)) {
    const pit = byPage[pg];
    // Group into transaction rows by y-band. A row is anchored by a date token
    // in the date column (x 60-112, "DD Mon YYYY").
    const bands = {};
    for (const it of pit) { const k = Math.round(it.y / 5) * 5; (bands[k] = bands[k] || []).push(it); }
    for (const k of Object.keys(bands).map(Number)) {
      const row = bands[k];
      const dateItem = row.find((i) => i.x >= 60 && i.x < 112 && /\d{2} [A-Za-z]{3} \d{4}/.test(i.s));
      if (!dateItem) continue;
      const date = normStatementDate((row.filter((i) => i.x >= 60 && i.x < 112).sort((a, b) => a.x - b.x).map((i) => i.s).join(' ').match(/\d{2} [A-Za-z]{3} \d{4}/) || [])[0]);
      const desc = row.filter((i) => i.x >= 112 && i.x < 350).sort((a, b) => a.x - b.x).map((i) => i.s).join(' ');
      const deposit = row.filter((i) => i.x >= 425 && i.x < 495 && /^[\d,]+\.\d{2}$/.test(i.s.replace(/\s/g, ''))).map((i) => NUM(i.s))[0] || null;
      const ref = (desc.match(/(NEFTINW-\d+)/i) || [])[1] || '';

      if (deposit == null) continue; // Deposit (Cr) column only — never Withdrawal (Dr)

      if (/STRIPE INDIA/i.test(desc)) {
        stripe.push({ inr: deposit, ref, date, desc: desc.replace(/\s+/g, ' ').trim().slice(0, 90) });
      } else if (/WISE/i.test(desc)) {
        wise.push({ inr: deposit, date, desc: desc.replace(/\s+/g, ' ').trim().slice(0, 100) });
      } else if (/FD MATURITY PROCEEDS|FD PREMATURE/i.test(desc)) {
        // FD maturity credit only — interest is the sub-10,000 remainder.
        // Sweep "Trf From" is principal returning from the FD, NOT income — ignored.
        const interest = round2(deposit - Math.floor(deposit / 10000) * 10000);
        if (interest > 0 && interest < 10000) fdInterest.push({ source: 'FD maturity interest', gross: deposit, interest, date, desc: desc.replace(/\s+/g, ' ').trim().slice(0, 90) });
      } else if (/SWEEP TRF FROM|SWEEP TRANSFER|SWIP TRANSFER/i.test(desc)) {
        // Sweep principal moving to/from the FD — never income, ignored.
      } else if (deposit > 10000) {
        // Larger unclassified credit — a customer remittance the admin classifies.
        otherCredits.push({ date, inr: deposit, desc: desc.replace(/\s+/g, ' ').trim().slice(0, 120), bank: 'Kotak', excluded: false });
      } else {
        // Small misc credit → folded into the combined "Other" line.
        smallCredits.push({ date, inr: deposit, desc: desc.replace(/\s+/g, ' ').trim().slice(0, 90), bank: 'Kotak' });
      }
    }
  }
  return { stripe, wise, fdInterest, smallCredits, otherCredits, source: fileName || 'Kotak' };
}

function normStatementDate(d) {
  if (!d) return null;
  const m1 = String(d).match(/^(\d{2}) ([A-Za-z]{3}) (\d{4})$/);
  if (m1) return `${m1[1]}/${monthNum(m1[2])}/${m1[3]}`;
  const m2 = String(d).match(/^(\d{2})[-\/]([A-Za-z]{3})[-\/](\d{2,4})$/);
  if (m2) return `${m2[1]}/${monthNum(m2[2])}/${m2[3].length === 2 ? '20' + m2[3] : m2[3]}`;
  return String(d);
}
function monthNum(mon) {
  const M = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
  return M[String(mon).toLowerCase().slice(0, 3)] || mon;
}

// ---------------------------------------------------------------------------
// Stripe payout CSV — payouts = money that actually landed in Kotak.
// ---------------------------------------------------------------------------
function parseStripeCsv(text) {
  const rows = csvRows(text);
  if (!rows.length) return { payouts: [] };
  const head = rows[0].map((h) => h.trim());
  const idx = (name) => head.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const iId = idx('id'), iType = idx('Type'), iNet = idx('Net'), iDesc = idx('Description'),
    iTDate = idx('Transfer Date (UTC)'), iTransfer = idx('Transfer'), iCreated = idx('Created (UTC)');
  const payouts = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]; if (!row || !row.length) continue;
    if ((row[iType] || '').toLowerCase() !== 'payout') continue;
    payouts.push({
      txnId: row[iTransfer] || row[iId] || '',
      inr: Math.abs(NUM(row[iNet]) || 0),
      date: (row[iTDate] || row[iCreated] || '').split(' ')[0] || '',
      desc: row[iDesc] || 'STRIPE PAYOUT',
    });
  }
  return { payouts };
}

// ---------------------------------------------------------------------------
// PayPal transaction CSV — USD gross + currency-conversion fee cross-check.
// ---------------------------------------------------------------------------
function parsePaypalCsv(text) {
  const rows = csvRows(text);
  if (!rows.length) return { usdGross: 0, conversionFee: 0, rowCount: 0 };
  const head = rows[0].map((h) => h.trim());
  const idx = (name) => head.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const iType = idx('Type'), iCur = idx('Currency'), iGross = idx('Gross'), iFee = idx('Fee');
  let usdGross = 0, conversionFee = 0, rowCount = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]; if (!row || !row.length) continue;
    const type = (row[iType] || '');
    const cur = (row[iCur] || '').toUpperCase();
    const gross = NUM(row[iGross]) || 0;
    const fee = NUM(row[iFee]) || 0;
    rowCount++;
    // USD received: positive USD gross on payment-type rows.
    if (cur === 'USD' && gross > 0 && !/Conversion|Withdrawal|Transfer/i.test(type)) usdGross += gross;
    if (/Currency Conversion/i.test(type)) conversionFee += Math.abs(fee);
  }
  return { usdGross: round2(usdGross), conversionFee: round2(conversionFee), rowCount };
}

// Minimal RFC-4180 CSV parser (handles quotes + embedded commas/newlines).
function csvRows(text) {
  const out = []; let row = []; let cell = ''; let q = false;
  const s = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); out.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); out.push(row); }
  return out.filter((r) => r.some((x) => (x || '').trim() !== ''));
}

// ---------------------------------------------------------------------------
// INV number sequencing. "QS2W-26-075" -> next "QS2W-26-076".
// ---------------------------------------------------------------------------
function invSequencer(lastInv) {
  const s = String(lastInv || '').trim();
  const m = s.match(/^(.*?)(\d+)(\D*)$/); // prefix + trailing number (+ optional suffix)
  if (!m) { let n = 0; return () => { n++; return s ? `${s}-${n}` : String(n); }; }
  const prefix = m[1]; const width = m[2].length; let n = parseInt(m[2], 10); const suffix = m[3] || '';
  return () => { n++; return `${prefix}${String(n).padStart(width, '0')}${suffix}`; };
}

// ---------------------------------------------------------------------------
// Reconcile everything for one month.
//   inputs: { month, lastInv, indianBank:Buffer, kotak:Buffer,
//             fircs:[{buffer,name}], paypalCsv:string, stripeCsv:string }
// ---------------------------------------------------------------------------
async function reconcile(inputs) {
  const { month, lastInv } = inputs;
  const warnings = [];

  // Parse FIRC advices → flat annexure list.
  const fircRows = [];
  const fircMeta = [];
  for (const f of (inputs.fircs || [])) {
    try {
      const r = await parseFirc(f.buffer, f.name);
      fircMeta.push({ advice: r.advice, count: r.rows.length, source: r.source,
        inr: round2(r.rows.reduce((s, x) => s + (x.inr || 0), 0)),
        usd: round2(r.rows.reduce((s, x) => s + (x.usd || 0), 0)) });
      for (const row of r.rows) fircRows.push(row);
    } catch (e) { warnings.push(`FIRC "${f.name}" could not be read: ${e.message}`); }
  }

  // Indian Bank credits (PayPal).
  let ib = { credits: [] };
  if (inputs.indianBank) { try { ib = await parseIndianBank(inputs.indianBank, 'Indian Bank'); } catch (e) { warnings.push(`Indian Bank statement could not be read: ${e.message}`); } }

  // Kotak (Stripe + FD interest).
  let kotak = { stripe: [], fdInterest: [], otherCredits: [] };
  if (inputs.kotak) { try { kotak = await parseKotak(inputs.kotak, 'Kotak'); } catch (e) { warnings.push(`Kotak statement could not be read: ${e.message}`); } }

  // Stripe CSV payouts.
  const stripeCsv = inputs.stripeCsv ? parseStripeCsv(inputs.stripeCsv) : { payouts: [] };
  // PayPal CSV cross-check.
  const paypalCsv = inputs.paypalCsv ? parsePaypalCsv(inputs.paypalCsv) : null;

  // --- Match PayPal bank credits to FIRC rows (by INR, then Citi ref) ---
  const fircByInr = {};
  for (const f of fircRows) { const k = Math.round(f.inr); (fircByInr[k] = fircByInr[k] || []).push(f); }
  const usedFirc = new Set();

  // Daily PayPal FIRC rate (date → rate) + a monthly average, used to derive USD
  // for Stripe / Wise which have no FIRC of their own.
  const rateByDate = {};
  for (const f of fircRows) { if (f.txnDate && f.rate) rateByDate[f.txnDate] = parseFloat(f.rate); }
  const rateVals = fircRows.map((f) => parseFloat(f.rate)).filter((n) => Number.isFinite(n));
  const avgRate = rateVals.length ? rateVals.reduce((s, n) => s + n, 0) / rateVals.length : null;
  const rateFor = (date) => rateByDate[date] || avgRate || null;

  // PayPal lines (Indian Bank credits ↔ FIRC).
  const paypalCredits = ib.credits.filter((c) => c.isPaypal);
  const paypalLines = paypalCredits.map((c) => {
    const cands = (fircByInr[Math.round(c.inr)] || []).filter((f) => !usedFirc.has(f));
    const f = cands.find((x) => x.citiRef && c.citiRef && CLEAN(x.citiRef) === CLEAN(c.citiRef)) || cands[0] || null;
    if (f) usedFirc.add(f);
    return {
      kind: 'paypal', invNumber: null,
      txnDate: (f && f.txnDate) || c.date,
      inr: round2(c.inr),
      usd: f ? f.usd : null,
      rate: f ? f.rate : null,
      derivedUsd: false,
      ref: (f && f.citiRef) || c.citiRef || null,
      fircAdvice: f ? f.advice : null,
      merchant: 'PayPal', account: 'Indian Bank',
      matched: !!f, mismatch: !f ? 'No FIRC row for this credit' : null,
      excluded: false,
    };
  });

  // Stripe lines (Kotak "STRIPE INDIA" ↔ Stripe payout CSV). USD derived from the
  // day's PayPal FIRC rate, since Stripe issues no FIRC.
  const stripeLines = kotak.stripe.map((s) => {
    const p = stripeCsv.payouts.find((x) => Math.abs(x.inr - s.inr) < 1);
    const rt = rateFor(s.date);
    return {
      kind: 'stripe', invNumber: null,
      txnDate: s.date,
      inr: round2(s.inr),
      usd: rt ? round2(s.inr / rt) : null,
      rate: rt ? String(round2(rt)) : null,
      derivedUsd: !!rt,
      ref: (p && p.txnId) || s.ref || '',
      fircAdvice: null,
      merchant: 'Stripe', account: 'Kotak',
      matched: !!p, mismatch: p ? null : 'Stripe credit not found in payout report',
      excluded: false,
    };
  });

  // Wise lines (Kotak "WISE" inward remittance). USD derived from the day's rate;
  // admin can override currency / amount / rate via the manual form.
  const wiseLines = (kotak.wise || []).map((w) => {
    const rt = rateFor(w.date);
    return {
      kind: 'wise', invNumber: null,
      txnDate: w.date,
      inr: round2(w.inr),
      usd: rt ? round2(w.inr / rt) : null,
      rate: rt ? String(round2(rt)) : null,
      derivedUsd: !!rt,
      ref: '', fircAdvice: null,
      merchant: 'Wise', account: 'Kotak',
      matched: true, mismatch: null, excluded: false,
    };
  });

  // Unified, date-sorted list. INV numbers are assigned by the client from
  // `lastInv` over the active (non-excluded) rows so edits renumber cleanly.
  const lines = [...paypalLines, ...stripeLines, ...wiseLines].sort((a, b) => dateKey(a.txnDate) - dateKey(b.txnDate));

  // Larger unclassified Kotak credits → customer inward remittances the admin
  // classifies (currency / amount / rate) via the manual form, then they join `lines`.
  const pending = (kotak.otherCredits || []).map((c) => ({ ...c, bank: 'Kotak', excluded: false, category: 'inward' }))
    .sort((a, b) => dateKey(a.date) - dateKey(b.date));

  // Indian Bank credits that are neither PayPal nor an internal move from our own
  // Kotak account → treated as revenue and folded into the combined "Other" line.
  const ibOther = ib.credits.filter((c) => !c.isPaypal && !c.fromKotak)
    .map((c) => ({ date: c.date, inr: round2(c.inr), desc: c.desc, bank: 'Indian Bank', source: 'Indian Bank credit' }));
  // Internal transfers from Kotak into Indian Bank — own money, excluded entirely.
  const excludedInternal = ib.credits.filter((c) => !c.isPaypal && c.fromKotak)
    .map((c) => ({ date: c.date, inr: round2(c.inr), desc: c.desc, note: 'Internal transfer from Kotak (own account) — excluded' }));

  // FIRC rows that never matched a bank credit → possible missing bank entry.
  const unmatchedFirc = fircRows.filter((f) => !usedFirc.has(f)).map((f) => ({ ...f, note: 'FIRC row with no matching bank credit' }));
  // Stripe payouts in CSV not seen in Kotak.
  const stripeMissingInBank = stripeCsv.payouts
    .filter((p) => !kotak.stripe.some((s) => Math.abs(s.inr - p.inr) < 1))
    .map((p) => ({ ...p, note: 'Stripe payout not found as a Kotak credit' }));

  // --- Combined "Other" line (last): FD maturity interest + small misc credits
  // + non-PayPal / non-Kotak Indian Bank credits. USD/rate at the month's average
  // PayPal rate so it reads like a normal GST transaction. Merchant "Other", Kotak.
  const otherParts = [
    ...(kotak.fdInterest || []).map((x) => ({ date: x.date, inr: round2(x.interest), label: x.source, gross: x.gross })),
    ...(kotak.smallCredits || []).map((x) => ({ date: x.date, inr: round2(x.inr), label: 'Small credit (Kotak)' })),
    ...ibOther.map((x) => ({ date: x.date, inr: round2(x.inr), label: 'Indian Bank credit' })),
  ];
  const otherInr = round2(otherParts.reduce((s, x) => s + (x.inr || 0), 0));
  const monthEnd = lastDayOfMonth(month);
  const otherLine = otherInr > 0 ? {
    kind: 'other', invNumber: null,
    txnDate: monthEnd,
    inr: otherInr,
    usd: avgRate ? round2(otherInr / avgRate) : null,
    rate: avgRate ? String(round2(avgRate)) : null,
    derivedUsd: !!avgRate,
    ref: '', fircAdvice: null,
    merchant: 'Other', account: 'Kotak',
    matched: true, mismatch: null,
    count: otherParts.length,
    breakdown: otherParts,
    excluded: false,
  } : null;

  // Cross-check warning.
  const paypalInr = round2(paypalLines.reduce((s, x) => s + x.inr, 0));
  const fircInr = round2(fircRows.reduce((s, x) => s + (x.inr || 0), 0));
  if (Math.abs(paypalInr - fircInr) > 1 && fircRows.length) {
    warnings.push(`PayPal bank credits (₹${paypalInr.toLocaleString('en-IN')}) differ from FIRC total (₹${fircInr.toLocaleString('en-IN')}) by ₹${round2(paypalInr - fircInr).toLocaleString('en-IN')}.`);
  }

  // Base totals (grouped view is recomputed client-side after edits).
  const totals = {
    paypalInr, fircInr,
    paypalUsd: round2(paypalLines.reduce((s, x) => s + (x.usd || 0), 0)),
    fircUsd: round2(fircRows.reduce((s, x) => s + (x.usd || 0), 0)),
    stripeInr: round2(stripeLines.reduce((s, x) => s + x.inr, 0)),
    wiseInr: round2(wiseLines.reduce((s, x) => s + x.inr, 0)),
    otherInr,
    pendingCount: pending.length,
    lineCount: lines.length,
    avgRate: avgRate ? round2(avgRate) : null,
  };

  return {
    month,
    lastInv: lastInv || null,
    generatedAt: new Date().toISOString(),
    lines,            // unified, date-sorted (client assigns invNumber)
    pending,          // Kotak customer remittances needing admin input → Inward
    otherLine,        // combined Other line (FD interest + small + IB extras), month-end
    excludedInternal, // Kotak→Indian internal transfers, excluded (shown for info)
    unmatchedFirc,
    stripeMissingInBank,
    fircMeta,
    paypalCsv,
    avgRate: avgRate ? round2(avgRate) : null,
    totals,
    warnings,
  };
}

// DD/MM/YYYY (or YYYY-MM-DD) → sortable number.
function dateKey(d) {
  if (!d) return 0;
  let m = String(d).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return +(`${m[3]}${m[2]}${m[1]}`);
  m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return +(`${m[1]}${m[2]}${m[3]}`);
  return 0;
}

function lastDayOfMonth(month) {
  // month "YYYY-MM" → "DD/MM/YYYY" of the last day.
  const m = String(month || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return month;
  const y = parseInt(m[1], 10); const mm = parseInt(m[2], 10);
  const d = new Date(y, mm, 0).getDate();
  return `${String(d).padStart(2, '0')}/${m[2]}/${m[1]}`;
}

module.exports = {
  reconcile, parseFirc, parseIndianBank, parseKotak, parseStripeCsv, parsePaypalCsv,
  invSequencer, dateKey, _internals: { csvRows, pdfItems, lastDayOfMonth },
};

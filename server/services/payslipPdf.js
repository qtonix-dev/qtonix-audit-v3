/**
 * Generates a branded A4 payslip PDF, then password-protects it with qpdf.
 * Returns an encrypted PDF Buffer.
 */
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { amountInWords } = require('./payroll');

const NAVY = rgb(5 / 255, 10 / 255, 31 / 255);
const ORANGE = rgb(1, 74 / 255, 0);
const TEAL = rgb(15 / 255, 118 / 255, 110 / 255);
const CRIMSON = rgb(159 / 255, 18 / 255, 57 / 255);
const GREY = rgb(100 / 255, 116 / 255, 139 / 255);
const LIGHT = rgb(148 / 255, 163 / 255, 184 / 255);
const DARK = rgb(5 / 255, 10 / 255, 31 / 255);
const inr = (n) => 'Rs. ' + Math.round(Number(n) || 0).toLocaleString('en-IN');

async function buildPdf(p, company) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4 in points
  const W = 595.28, H = 841.89;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const M = 40; // margin
  const text = (s, x, y, size, f = font, color = DARK) => page.drawText(String(s == null ? '' : s), { x, y, size, font: f, color });
  const rightText = (s, xRight, y, size, f = font, color = DARK) => { const w = f.widthOfTextAtSize(String(s), size); page.drawText(String(s), { x: xRight - w, y, size, font: f, color }); };

  // Header band (navy).
  page.drawRectangle({ x: 0, y: H - 90, width: W, height: 90, color: NAVY });
  page.drawRectangle({ x: M, y: H - 68, width: 30, height: 30, color: ORANGE });
  text('Q', M + 9, H - 61, 18, bold, rgb(1, 1, 1));
  text('Qtonix', M + 42, H - 52, 18, bold, rgb(1, 1, 1));
  text('Qtonix Software Pvt. Ltd.', M + 42, H - 66, 8.5, font, LIGHT);
  rightText('PAY PERIOD', W - M, H - 40, 8, bold, LIGHT);
  rightText(p.monthLabel, W - M, H - 55, 14, bold, rgb(1, 1, 1));
  rightText(p.periodLabel, W - M, H - 68, 9, font, rgb(0.8, 0.85, 0.9));

  // Slip bar.
  page.drawRectangle({ x: 0, y: H - 112, width: W, height: 22, color: rgb(248 / 255, 250 / 255, 252 / 255) });
  const sb = 'SALARY SLIP  -  CONFIDENTIAL';
  text(sb, (W - font.widthOfTextAtSize(sb, 8)) / 2, H - 106, 8, bold, GREY);

  let y = H - 140;
  // Employee block.
  text(p.employeeName, M, y, 15, bold, DARK); y -= 15;
  text(`${p.designation || ''}${p.department ? '  -  ' + p.department : ''}`, M, y, 10, font, GREY); y -= 13;
  text(`${p.email || ''}    ${p.phone || ''}`.trim(), M, y, 9, font, LIGHT);
  // right identity
  let ry = H - 140;
  rightText(`Emp ID: ${p.employeeCode || '-'}`, W - M, ry, 9.5, font, GREY); ry -= 13;
  rightText(`Branch: ${p.branch || '-'}`, W - M, ry, 9.5, font, GREY); ry -= 13;
  rightText(`Pay date: ${p.payDateLabel || '-'}`, W - M, ry, 9.5, font, GREY);
  y -= 14;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.5, color: rgb(241 / 255, 245 / 255, 249 / 255) });
  y -= 16;

  // Meta cards.
  const meta = [['Days in month', p.daysInMonth], ['Working days', p.workingDays], ['Leave taken', p.leaveTaken], ['LOP days', p.lopDays]];
  const cardW = (W - 2 * M - 3 * 8) / 4;
  meta.forEach((mrow, i) => {
    const x = M + i * (cardW + 8);
    page.drawRectangle({ x, y: y - 40, width: cardW, height: 40, color: rgb(248 / 255, 250 / 255, 252 / 255), borderColor: rgb(238 / 255, 240 / 255, 244 / 255), borderWidth: 1 });
    const nStr = String(mrow[1]);
    text(nStr, x + (cardW - bold.widthOfTextAtSize(nStr, 14)) / 2, y - 20, 14, bold, DARK);
    const l = String(mrow[0]).toUpperCase();
    text(l, x + (cardW - font.widthOfTextAtSize(l, 6.5)) / 2, y - 33, 6.5, font, LIGHT);
  });
  y -= 56;

  // Earnings / Deductions columns.
  const colW = (W - 2 * M - 20) / 2;
  const drawTable = (x, title, color, rows, total, totalLabel) => {
    let ty = y;
    page.drawRectangle({ x, y: ty - 18, width: colW, height: 18, color });
    text(title.toUpperCase(), x + 8, ty - 13, 9, bold, rgb(1, 1, 1));
    ty -= 18;
    const startY = ty;
    rows.forEach((r) => {
      ty -= 20;
      text(r[0], x + 8, ty + 6, 10, font, DARK);
      rightText(inr(r[1]), x + colW - 8, ty + 6, 10, bold, DARK);
      page.drawLine({ start: { x: x, y: ty }, end: { x: x + colW, y: ty }, thickness: 0.5, color: rgb(246 / 255, 247 / 255, 249 / 255) });
    });
    ty -= 22;
    page.drawRectangle({ x, y: ty + 4, width: colW, height: 20, color: rgb(248 / 255, 250 / 255, 252 / 255) });
    text(totalLabel, x + 8, ty + 10, 10, bold, DARK);
    rightText(inr(total), x + colW - 8, ty + 10, 10, bold, DARK);
    // border
    page.drawRectangle({ x, y: ty + 4, width: colW, height: (startY - ty), borderColor: rgb(238 / 255, 240 / 255, 244 / 255), borderWidth: 1, color: undefined });
    return ty;
  };
  const eRows = [['Basic Pay', p.basic], ['Travel Allowance (TA)', p.ta], ['Incentive', p.incentive], ['Arrear', p.arrear], ['Reimbursement', p.reimbursement]];
  const dRows = [[`Loss of Pay (${p.lopDays} days)`, p._lopAmt], [`Late Entry (${p.lateDeductionDays} day)`, p._lateAmt], [`Deficit Hours (${p.deficitHours} h)`, p._deficitAmt], ['Advance Taken', p.advance], ['Other Deductions', p.otherDeduction]];
  const y1 = drawTable(M, 'Earnings', TEAL, eRows, p.grossEarnings, 'Gross Earnings');
  const y2 = drawTable(M + colW + 20, 'Deductions', CRIMSON, dRows, p.totalDeductions, 'Total Deductions');
  y = Math.min(y1, y2) - 18;

  // Net salary band.
  page.drawRectangle({ x: M, y: y - 46, width: W - 2 * M, height: 46, color: ORANGE });
  text('NET SALARY PAYABLE', M + 16, y - 27, 11, bold, rgb(1, 1, 1));
  rightText(inr(p.netSalary), W - M - 16, y - 32, 22, bold, rgb(1, 1, 1));
  y -= 60;
  // Amount in words (right-aligned).
  rightText(amountInWords(p.netSalary), W - M, y, 9, italic, GREY);
  y -= 26;

  // Note (just above footer).
  const noteH = 34;
  page.drawRectangle({ x: M, y: y - noteH, width: W - 2 * M, height: noteH, color: rgb(255 / 255, 251 / 255, 235 / 255), borderColor: rgb(253 / 255, 230 / 255, 138 / 255), borderWidth: 1 });
  text('Note: If you find any mismatch in this payslip, please reach out to the HR department at', M + 12, y - 15, 8.5, font, rgb(146 / 255, 64 / 255, 14 / 255));
  text('hr@qtonix.com within 7 days of issue.', M + 12, y - 26, 8.5, bold, rgb(146 / 255, 64 / 255, 14 / 255));

  // Footer.
  const fy = 60;
  page.drawLine({ start: { x: M, y: fy + 34 }, end: { x: W - M, y: fy + 34 }, thickness: 1, color: rgb(226 / 255, 232 / 255, 240 / 255) });
  const cLines = [
    company.name || 'Qtonix Software Pvt. Ltd.',
    company.address || 'Registered Office: 609, Utkal Signature, National Highway 5, Pahala, 270, Bhubaneswar, Odisha 751032',
    `Phone: ${company.phone || '+91-93488 78088'}   -   Generated ${p.generatedLabel}   -   (C) Qtonix Software Pvt. Ltd.`,
    'This is a computer-generated payslip and does not require a signature.',
  ];
  let fyy = fy + 22;
  cLines.forEach((l, i) => { const f = i === 0 ? bold : (i === 3 ? italic : font); const sz = i === 0 ? 9 : 7.5; const w = f.widthOfTextAtSize(l, sz); text(l, (W - w) / 2, fyy, sz, f, i === 0 ? GREY : LIGHT); fyy -= 11; });

  return Buffer.from(await doc.save());
}

// Encrypt with qpdf (user password). Returns encrypted Buffer.
function encrypt(buf, password) {
  return new Promise((resolve, reject) => {
    const tmp = os.tmpdir();
    const inFile = path.join(tmp, `ps-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
    const outFile = inFile.replace('.pdf', '-enc.pdf');
    fs.writeFileSync(inFile, buf);
    execFile('qpdf', ['--encrypt', password, password, '256', '--', inFile, outFile], (err) => {
      try {
        if (err) { fs.unlinkSync(inFile); return reject(err); }
        const out = fs.readFileSync(outFile);
        fs.unlinkSync(inFile); fs.unlinkSync(outFile);
        resolve(out);
      } catch (e) { reject(e); }
    });
  });
}

async function generatePayslipPdf(p, company, password) {
  const pdf = await buildPdf(p, company);
  if (!password) return pdf;
  try { return await encrypt(pdf, password); } catch { return pdf; } // fall back to unencrypted if qpdf missing
}

module.exports = { generatePayslipPdf, buildPdf };

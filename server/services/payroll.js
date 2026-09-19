/**
 * Payroll (Phase 1) — computes a payslip from HR-entered + auto-fetched figures.
 *
 * Formula (as agreed):
 *   perDay  = basic / 30
 *   perHour = perDay / shiftHours       (shift-based)
 *   lateDeductionDays = floor(consecutive/3)*0.5  +  floor(total/6)*0.5   (stack)
 *   grossEarnings   = basic + ta + incentive + arrear + reimbursement
 *   totalDeductions = lop*perDay + lateDeductionDays*perDay
 *                     + deficitHours*perHour + advance + otherDeduction
 *   net = grossEarnings - totalDeductions
 * Deficit hours are worked-day shortfalls only (LOP/leave/holiday excluded) so
 * they never double-count with LOP.
 */

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function roundR(n) { return Math.round(Number(n) || 0); }

function lateDeductionDays(consecutive, total) {
  const c = Math.max(0, Number(consecutive) || 0);
  const t = Math.max(0, Number(total) || 0);
  return Math.floor(c / 3) * 0.5 + Math.floor(t / 6) * 0.5;
}

// Compute all derived money fields from the raw inputs.
function computePayslip(p) {
  const basic = Number(p.basic) || 0;
  const shiftHours = Number(p.shiftHours) > 0 ? Number(p.shiftHours) : 8;
  const perDay = basic / 30;
  const perHour = perDay / shiftHours;
  const ldays = lateDeductionDays(p.lateConsecutive, p.lateTotal);
  const gross = basic + (Number(p.ta) || 0) + (Number(p.incentive) || 0) + (Number(p.arrear) || 0) + (Number(p.reimbursement) || 0);
  const lopAmt = (Number(p.lopDays) || 0) * perDay;
  const lateAmt = ldays * perDay;
  const deficitAmt = (Number(p.deficitHours) || 0) * perHour;
  const deductions = lopAmt + lateAmt + deficitAmt + (Number(p.advance) || 0) + (Number(p.otherDeduction) || 0);
  const net = gross - deductions;
  return {
    perDay: round2(perDay), perHour: round2(perHour), lateDeductionDays: ldays,
    grossEarnings: roundR(gross), totalDeductions: roundR(deductions), netSalary: roundR(net),
    // component amounts for the payslip display
    _lopAmt: roundR(lopAmt), _lateAmt: roundR(lateAmt), _deficitAmt: roundR(deficitAmt),
  };
}

// Auto-fetch attendance figures for an employee for a month from HRMS.
// Returns { workingDays, leaveTaken, lopDays, lateConsecutive, lateTotal, deficitHours }.
async function fetchAttendanceFigures(models, emp, month, helpers) {
  const { HrAttendance } = models;
  const { branchWeekendOff, shiftGrossMinutes, holidaysForMonth } = helpers;
  const rows = await HrAttendance.findAll({ where: { employeeId: emp.id, date: { [models.Op.like]: `${month}-%` } }, order: [['date', 'ASC']] });
  const holidays = holidaysForMonth ? await holidaysForMonth(month, emp.branch) : {};
  const shift = emp.shiftId && helpers.shiftById ? helpers.shiftById[emp.shiftId] : null;
  const shiftMin = shift ? shiftGrossMinutes(shift) : 8 * 60;
  const shiftHours = shiftMin ? shiftMin / 60 : 8;
  const toMin = (t) => { if (!t) return null; const [h, m] = String(t).slice(0, 5).split(':').map(Number); return h * 60 + (m || 0); };

  let workingDays = 0, leaveTaken = 0, lopDays = 0, lateTotal = 0, deficitMin = 0;
  let curConsec = 0, maxConsec = 0;
  for (const r of rows) {
    const ds = r.date;
    const off = (holidays && holidays[ds]) || (branchWeekendOff && branchWeekendOff(ds, emp.branch));
    if (off) { curConsec = 0; continue; }
    const st = r.status;
    if (st === 'leave' || st === 'half_day') { leaveTaken += (st === 'half_day' ? 0.5 : 1); curConsec = 0; continue; }
    if (st === 'lop') { lopDays += 1; curConsec = 0; continue; }
    if (st === 'absent') { lopDays += 1; curConsec = 0; continue; }
    // Present-ish day.
    if (r.loginTime || st === 'present' || st === 'late') {
      workingDays += 1;
      // Late?
      const late = r.late || (shift && r.loginTime && toMin(r.loginTime) > toMin(shift.startTime) + 10);
      if (late) { lateTotal += 1; curConsec += 1; if (curConsec > maxConsec) maxConsec = curConsec; }
      else curConsec = 0;
      // Deficit (worked-day shortfall only).
      if (r.loginTime && r.logoutTime) {
        let a = toMin(r.loginTime), b = toMin(r.logoutTime); if (b <= a) b += 1440;
        const worked = b - a;
        if (worked < shiftMin) deficitMin += (shiftMin - worked);
      }
    } else { curConsec = 0; }
  }
  return {
    workingDays, leaveTaken, lopDays,
    lateConsecutive: maxConsec, lateTotal,
    deficitHours: round2(deficitMin / 60),
    shiftHours: round2(shiftHours),
  };
}

// Amount in words (Indian numbering).
function amountInWords(num) {
  num = Math.round(Number(num) || 0);
  if (num === 0) return 'Zero Only';
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (n) => n < 20 ? a[n] : b[Math.floor(n / 10)] + (n % 10 ? ' ' + a[n % 10] : '');
  const three = (n) => (n >= 100 ? a[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + two(n % 100) : '') : two(n));
  let words = '';
  const crore = Math.floor(num / 10000000); num %= 10000000;
  const lakh = Math.floor(num / 100000); num %= 100000;
  const thousand = Math.floor(num / 1000); num %= 1000;
  const hundred = num;
  if (crore) words += three(crore) + ' Crore ';
  if (lakh) words += three(lakh) + ' Lakh ';
  if (thousand) words += three(thousand) + ' Thousand ';
  if (hundred) words += three(hundred);
  return 'Rupees ' + words.trim() + ' Only';
}

// The password for the protected PDF: first 4 letters of the name (uppercase) +
// year of joining. Falls back to payslip year if joining date is missing.
function payslipPassword(emp, month) {
  const name = String(emp.name || 'USER').replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 4).padEnd(4, 'X');
  let year = '';
  const jd = emp.joiningDate || (emp.profile && emp.profile.joiningDate);
  if (jd) { const m = String(jd).match(/(\d{4})/); if (m) year = m[1]; }
  if (!year) year = (month || '').slice(0, 4) || String(new Date().getFullYear());
  return name + year;
}

module.exports = { computePayslip, fetchAttendanceFigures, amountInWords, payslipPassword, lateDeductionDays, round2, roundR };

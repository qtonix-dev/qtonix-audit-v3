/**
 * The payslip email — matches the existing Qtonix HR email design, with an
 * optional AI "note from HR" section (positive / attendance) inserted after the
 * details card. The password example is generic (never a real employee name).
 */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const inr = (n) => '\u20B9' + Math.round(Number(n) || 0).toLocaleString('en-IN');

function noteBlock(text, kind) {
  if (!text) return '';
  const red = kind === 'attendance';
  const bg = red ? '#FEF2F2' : '#F0FDF4';
  const bar = red ? '#EF4444' : '#22C55E';
  const head = red ? '#B91C1C' : '#15803D';
  const body = red ? '#7f1d1d' : '#14532d';
  const label = red ? 'A note from HR' : 'A note from HR \uD83C\uDF89';
  return `
    <tr><td style="padding:20px 44px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bg};border-left:4px solid ${bar};border-radius:8px;">
        <tr><td style="padding:15px 20px;">
          <div style="font-size:11px;font-weight:800;color:${head};text-transform:uppercase;letter-spacing:.5px;">${label}</div>
          <div style="font-size:14px;color:${body};line-height:1.6;margin-top:7px;">${esc(text)}</div>
        </td></tr>
      </table>
    </td></tr>`;
}

function payslipEmailHtml({ firstName, monthLabel, periodLabel, payDateLabel, netSalary, notes }) {
  const positive = noteBlock(notes && notes.positive, 'positive');
  const attendance = noteBlock(notes && notes.attendance, 'attendance');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#EEF1F8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF1F8;padding:28px 12px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;">
  <tr><td align="center" style="padding:4px 0 20px;"><span style="font-size:23px;font-weight:800;color:#0B1F3A;letter-spacing:-.3px;">Qtonix<span style="color:#FF6A00;">.</span></span></td></tr>
  <tr><td style="background:#ffffff;border-radius:16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:16px;">
      <tr><td style="background:linear-gradient(135deg,#0B1F3A 0%,#122c52 100%);border-radius:16px 16px 0 0;padding:38px 44px 34px;">
        <div style="font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#8FB4FF;">Qtonix Payroll</div>
        <div style="font-size:27px;font-weight:800;color:#ffffff;line-height:1.2;margin-top:10px;">Your payslip for ${esc(monthLabel)}</div>
        <div style="font-size:15px;color:#C9D8FF;margin-top:11px;">Net salary payable: ${inr(netSalary)}</div>
      </td></tr>
      <tr><td style="padding:32px 44px 4px;">
        <p style="font-size:16px;color:#2B3B54;line-height:1.65;margin:0 0 15px;">Hi ${esc(firstName || 'there')},</p>
        <div style="font-size:16px;color:#2B3B54;line-height:1.65;">Please find your salary slip for <strong>${esc(monthLabel)}</strong> attached to this email as a PDF. It includes a full breakdown of your earnings and deductions for the month.</div>
      </td></tr>
      <tr><td style="padding:2px 44px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7FE;border:1px solid #E2E9F8;border-radius:12px;"><tr><td style="padding:20px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="font-size:13px;color:#8A93A6;padding:5px 0;">Pay period</td><td style="font-size:14px;color:#0B1F3A;font-weight:600;text-align:right;padding:5px 0;">${esc(periodLabel)}</td></tr>
            <tr><td style="font-size:13px;color:#8A93A6;padding:5px 0;">Pay date</td><td style="font-size:14px;color:#0B1F3A;font-weight:600;text-align:right;padding:5px 0;">${esc(payDateLabel)}</td></tr>
            <tr><td style="font-size:13px;color:#8A93A6;padding:5px 0;">Net salary payable</td><td style="font-size:14px;color:#16a34a;font-weight:700;text-align:right;padding:5px 0;">${inr(netSalary)}</td></tr>
          </table>
        </td></tr></table>
      </td></tr>
      ${positive}${attendance}
      <tr><td style="padding:20px 44px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFF7ED;border:1px solid #FDE7C9;border-radius:12px;"><tr><td style="padding:18px 22px;">
          <div style="font-size:13px;font-weight:800;color:#C2410C;text-transform:uppercase;letter-spacing:.5px;">\uD83D\uDD12 The PDF is password-protected</div>
          <div style="font-size:14px;color:#7C4A1E;line-height:1.6;margin-top:8px;">To open the payslip, enter this password:</div>
          <div style="font-size:14px;color:#7C4A1E;line-height:1.7;margin-top:6px;"><b>First 4 letters of your name (in capitals) + your year of joining</b></div>
          <div style="margin-top:10px;background:#ffffff;border:1px dashed #F0B27A;border-radius:8px;padding:10px 14px;font-size:14px;color:#0B1F3A;">Example: if your name is <b>Rahul</b> and you joined in <b>2021</b>, the password is <b style="letter-spacing:1px;">RAHU2021</b></div>
          <div style="font-size:12.5px;color:#9a6b3f;margin-top:10px;">If you have trouble opening it, please reach out to HR.</div>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:22px 44px 10px;"><div style="font-size:15px;color:#2B3B54;line-height:1.6;">If you notice any mismatch, please contact the HR department at <a href="mailto:hr@qtonix.com" style="color:#122c52;font-weight:600;">hr@qtonix.com</a> within 7 days of issue.</div></td></tr>
      <tr><td style="padding:10px 44px 38px;"><div style="border-top:1px solid #EAEEF6;padding-top:18px;">
        <div style="font-size:15px;font-weight:700;color:#0B1F3A;">HR Department</div>
        <div style="font-size:13px;color:#8A93A6;margin-top:2px;">Qtonix Software Pvt. Ltd.</div>
        <div style="font-size:13px;color:#8A93A6;margin-top:2px;">hr@qtonix.com</div>
      </div></td></tr>
    </table>
  </td></tr>
  <tr><td align="center" style="padding:18px 0 4px;"><div style="font-size:12px;color:#9AA3B5;">This is an automated payroll email from Qtonix.</div></td></tr>
</table>
</td></tr></table></body></html>`;
}

module.exports = { payslipEmailHtml };

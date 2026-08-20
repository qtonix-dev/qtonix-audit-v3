/**
 * Branded, responsive HTML email templates for HR/recruitment mail
 * (interview invitations, panel notices, reschedules). Table-based layout so it
 * renders consistently in Gmail, Outlook, Apple Mail. The hero uses a solid
 * navy background (email clients don't reliably render CSS gradients), with the
 * Qtonix brand mark and an orange CTA.
 *
 * All builders return a full HTML document string ready for gmail.sendMessage.
 */

const NAVY = '#0A0E28';
const NAVY2 = '#0435AC';
const ORANGE1 = '#FF6A00';
const ORANGE2 = '#FF4500';
const INK = '#1c2433';
const MUTED = '#6B7A99';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'there';
}

// A row in the details card: LABEL | value.
function detailRow(label, value) {
  if (!value) return '';
  return `<tr>
    <td style="padding:7px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${MUTED};width:110px;vertical-align:top;">${esc(label)}</td>
    <td style="padding:7px 0;font-size:15px;font-weight:600;color:${NAVY};line-height:1.4;">${value}</td>
  </tr>`;
}

/**
 * Core shell. opts:
 *  kicker, headline, subhead (role), greetingName, introHtml,
 *  details:[{label,value(html allowed)}], ctaLabel, ctaUrl, ctaNote,
 *  outroHtml, signature:{name,title,email}
 */
function shell(opts) {
  const {
    kicker = 'Qtonix Recruitment', headline = '', subhead = '',
    greetingName = '', introHtml = '', details = [], ctaLabel, ctaUrl, ctaNote = '',
    outroHtml = '', signature = {}, rawBody = null,
  } = opts;

  const detailRows = details.map((d) => detailRow(d.label, d.value)).join('');
  const detailsCard = detailRows ? `
    <tr><td style="padding:2px 44px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7FE;border:1px solid #E2E9F8;border-radius:12px;">
        <tr><td style="padding:20px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${detailRows}</table>
        </td></tr>
      </table>
    </td></tr>` : '';

  const cta = (ctaLabel && ctaUrl) ? `
    <tr><td align="center" style="padding:26px 44px 6px;">
      <a href="${esc(ctaUrl)}" style="display:inline-block;background:${ORANGE1};background:linear-gradient(90deg,${ORANGE1},${ORANGE2});color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;padding:15px 42px;border-radius:10px;">${esc(ctaLabel)}</a>
      ${ctaNote ? `<div style="font-size:13px;color:#8A93A6;margin-top:14px;line-height:1.5;">${ctaNote}</div>` : ''}
    </td></tr>` : '';

  const sig = signature && signature.name ? `
    <tr><td style="padding:22px 44px 38px;">
      <div style="border-top:1px solid #EAEEF6;padding-top:18px;">
        <div style="font-size:15px;font-weight:700;color:${NAVY};">${esc(signature.name)}</div>
        ${signature.title ? `<div style="font-size:13px;color:${MUTED};margin-top:2px;">${esc(signature.title)}</div>` : ''}
        ${signature.email ? `<div style="font-size:13px;color:${MUTED};margin-top:2px;">${esc(signature.email)}</div>` : ''}
      </div>
    </td></tr>` : '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#EEF1F8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF1F8;padding:28px 12px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;">

  <tr><td align="center" style="padding:4px 0 20px;">
    <span style="font-size:23px;font-weight:800;color:${NAVY};letter-spacing:-.3px;">Qtonix<span style="color:${ORANGE1};">.</span></span>
  </td></tr>

  <tr><td style="background:#ffffff;border-radius:16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:16px;">

      <tr><td style="background:${NAVY};background:linear-gradient(135deg,${NAVY} 0%,${NAVY2} 100%);border-radius:16px 16px 0 0;padding:38px 44px 34px;">
        <div style="font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#8FB4FF;">${esc(kicker)}</div>
        <div style="font-size:27px;font-weight:800;color:#ffffff;line-height:1.2;margin-top:10px;">${headline}</div>
        ${subhead ? `<div style="font-size:15px;color:#C9D8FF;margin-top:11px;">${esc(subhead)}</div>` : ''}
      </td></tr>

      <tr><td style="padding:32px 44px 6px;">
        ${rawBody != null
          ? `<div style="font-size:16px;color:${INK};line-height:1.65;">${rawBody}</div>`
          : `<p style="font-size:16px;color:${INK};line-height:1.65;margin:0 0 15px;">Hi ${esc(firstName(greetingName))},</p>
        <div style="font-size:16px;color:${INK};line-height:1.65;">${introHtml}</div>`}
      </td></tr>

      ${detailsCard}
      ${cta}

      ${outroHtml ? `<tr><td style="padding:20px 44px 4px;"><div style="font-size:15px;color:#4a5568;line-height:1.65;">${outroHtml}</div></td></tr>` : ''}

      ${sig}
    </table>
  </td></tr>

  <tr><td align="center" style="padding:24px 20px 6px;">
    <div style="font-size:13px;font-weight:700;color:${NAVY};">Qtonix</div>
    <div style="font-size:12px;color:#95A0B8;margin-top:6px;line-height:1.6;">This message was sent by the Qtonix recruitment team.<br>&copy; ${new Date().getFullYear()} Qtonix. All rights reserved.</div>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}

// ---- Public builders -------------------------------------------------------

// Candidate interview invitation.
function interviewInviteCandidate({ candidateName, role, roundLabel, whenText, durationMins, mode, meetLink, notes, signature }) {
  const modeText = mode === 'in_person' ? 'In person' : mode === 'phone' ? 'Phone call' : 'Google Meet (online)';
  const details = [
    { label: 'Date & time', value: esc(whenText) },
    durationMins ? { label: 'Duration', value: esc(`${durationMins} minutes`) } : null,
    roundLabel ? { label: 'Round', value: esc(roundLabel) } : null,
    { label: 'Mode', value: modeText },
    meetLink ? { label: 'Meeting link', value: `<a href="${esc(meetLink)}" style="color:${NAVY2};font-weight:600;">Join Google Meet</a>` } : null,
  ].filter(Boolean);
  return shell({
    kicker: 'Interview Invitation',
    headline: "You're invited to interview with us",
    subhead: role || '',
    greetingName: candidateName,
    introHtml: `Thank you for applying. We were impressed by your background and would like to invite you to ${roundLabel ? `the <strong>${esc(roundLabel)}</strong>` : 'an interview'}${role ? ` for the <strong>${esc(role)}</strong> role` : ''}. Please find the details below.`,
    details,
    ctaLabel: meetLink ? 'Join Google Meet' : null,
    ctaUrl: meetLink || null,
    ctaNote: 'A calendar invite is attached — open it to add this to your calendar and confirm you can make it.',
    outroHtml: `${notes ? `${esc(notes)}<br><br>` : ''}If you have any questions or need to reschedule, just reply to this email. We look forward to speaking with you.`,
    signature,
  });
}

// Panelist / interviewer notice.
function interviewInvitePanel({ panelistName, candidateName, role, roundLabel, whenText, durationMins, mode, meetLink, notes, signature }) {
  const modeText = mode === 'in_person' ? 'In person' : mode === 'phone' ? 'Phone call' : 'Google Meet (online)';
  const details = [
    { label: 'Candidate', value: esc(candidateName) },
    { label: 'Date & time', value: esc(whenText) },
    durationMins ? { label: 'Duration', value: esc(`${durationMins} minutes`) } : null,
    roundLabel ? { label: 'Round', value: esc(roundLabel) } : null,
    { label: 'Mode', value: modeText },
    meetLink ? { label: 'Meeting link', value: `<a href="${esc(meetLink)}" style="color:${NAVY2};font-weight:600;">Join Google Meet</a>` } : null,
  ].filter(Boolean);
  return shell({
    kicker: 'Interview Panel',
    headline: `You're on the panel for an interview`,
    subhead: role ? `${role}` : '',
    greetingName: panelistName,
    introHtml: `You've been added as a panelist for ${roundLabel ? `the <strong>${esc(roundLabel)}</strong>` : 'an interview'} with <strong>${esc(candidateName)}</strong>${role ? ` for the <strong>${esc(role)}</strong> role` : ''}. Details are below.`,
    details,
    ctaLabel: meetLink ? 'Join Google Meet' : null,
    ctaUrl: meetLink || null,
    ctaNote: 'A calendar invite is attached — please add it to your calendar.',
    outroHtml: `${notes ? `${esc(notes)}<br><br>` : ''}You can submit your feedback in the recruitment portal after the interview.`,
    signature,
  });
}

// Reschedule notice (candidate or panel — pass isPanel + candidateName).
function interviewReschedule({ recipientName, isPanel, candidateName, role, roundLabel, whenText, durationMins, mode, meetLink, notes, signature }) {
  const modeText = mode === 'in_person' ? 'In person' : mode === 'phone' ? 'Phone call' : 'Google Meet (online)';
  const details = [
    isPanel ? { label: 'Candidate', value: esc(candidateName) } : null,
    { label: 'New date & time', value: esc(whenText) },
    durationMins ? { label: 'Duration', value: esc(`${durationMins} minutes`) } : null,
    roundLabel ? { label: 'Round', value: esc(roundLabel) } : null,
    { label: 'Mode', value: modeText },
    meetLink ? { label: 'Meeting link', value: `<a href="${esc(meetLink)}" style="color:${NAVY2};font-weight:600;">Join Google Meet</a>` } : null,
  ].filter(Boolean);
  const intro = isPanel
    ? `The ${roundLabel ? `<strong>${esc(roundLabel)}</strong>` : 'interview'} with <strong>${esc(candidateName)}</strong>${role ? ` for the <strong>${esc(role)}</strong> role` : ''} has been rescheduled. Here are the new details.`
    : `Your ${roundLabel ? `<strong>${esc(roundLabel)}</strong>` : 'interview'}${role ? ` for the <strong>${esc(role)}</strong> role` : ''} has been rescheduled. Here are the new details.`;
  return shell({
    kicker: 'Interview Rescheduled',
    headline: 'Your interview has a new time',
    subhead: role || '',
    greetingName: recipientName,
    introHtml: intro,
    details,
    ctaLabel: meetLink ? 'Join Google Meet' : null,
    ctaUrl: meetLink || null,
    ctaNote: 'An updated calendar invite is attached — open it to refresh the time on your calendar.',
    outroHtml: `${notes ? `${esc(notes)}<br><br>` : ''}Apologies for any inconvenience. If this time doesn't work, just reply and we'll find another slot.`,
    signature,
  });
}

// Candidate application acknowledgement (thank-you).
function applicationThankYou({ candidateName, role, signature }) {
  return shell({
    kicker: 'Application Received',
    headline: 'Thank you for your interest',
    subhead: role || '',
    greetingName: candidateName,
    introHtml: `Thank you for applying${role ? ` for the <strong>${esc(role)}</strong> role` : ''} at Qtonix. We've received your application and our recruitment team will review it carefully.`,
    outroHtml: `If your profile matches what we're looking for, our HR team will be in touch with the next steps. We appreciate the time you took to apply and wish you the very best.`,
    signature: signature || { name: 'Qtonix Recruitment Team', title: 'Talent Acquisition · Qtonix', email: 'career@qtonix.com' },
  });
}

// Internal notification to the recruitment inbox on a new application.
function applicationInternalNotice({ candidateName, role, candidateEmail, candidatePhone, jobLocation, source, viewUrl }) {
  const details = [
    { label: 'Candidate', value: esc(candidateName) },
    role ? { label: 'Applied for', value: esc(role) } : null,
    candidateEmail ? { label: 'Email', value: `<a href="mailto:${esc(candidateEmail)}" style="color:${NAVY2};font-weight:600;">${esc(candidateEmail)}</a>` } : null,
    candidatePhone ? { label: 'Phone', value: esc(candidatePhone) } : null,
    jobLocation ? { label: 'Location', value: esc(jobLocation) } : null,
    source ? { label: 'Source', value: esc(source) } : null,
  ].filter(Boolean);
  return shell({
    kicker: 'New Application',
    headline: 'A candidate just applied',
    subhead: role || '',
    greetingName: 'team',
    introHtml: `A new candidate has submitted an application through the careers page${role ? ` for the <strong>${esc(role)}</strong> role` : ''}. Details are below.`,
    details,
    ctaLabel: viewUrl ? 'Open in recruitment portal' : null,
    ctaUrl: viewUrl || null,
    outroHtml: 'Please review and reach out to the candidate as appropriate.',
    signature: { name: 'Qtonix Recruitment System', title: 'Automated notification', email: 'career@qtonix.com' },
  });
}

// Candidate rejection — wraps the AI-drafted body (already paragraphed) in the
// branded shell. No CTA button; a gentle, respectful tone. The body already
// contains its own greeting, so it's passed as rawBody.
function rejectionEmail({ role, bodyHtml, signature }) {
  return shell({
    kicker: 'Update on Your Application',
    headline: 'An update on your application',
    subhead: role || '',
    rawBody: bodyHtml || '',
    signature,
  });
}

// Assessment / take-home task assigned to a candidate. CTA links to the public
// upload page; the details card carries the deadline and what to submit.
function taskAssignment({ candidateName, role, taskTitle, taskDetailsHtml, deadlineText, uploadUrl, signature }) {
  const details = [
    taskTitle ? { label: 'Task', value: esc(taskTitle) } : null,
    { label: 'Submit by', value: esc(deadlineText) },
    { label: 'How to submit', value: 'Upload your files on the secure link below' },
  ].filter(Boolean);
  return shell({
    kicker: 'Assessment Task',
    headline: 'A task for your application',
    subhead: role || '',
    greetingName: candidateName,
    introHtml: `As the next step${role ? ` for the <strong>${esc(role)}</strong> role` : ''}, we'd like you to complete a short task. ${taskDetailsHtml ? 'The details are below.' : ''}${taskDetailsHtml ? `<br><br><div style="background:#F4F7FE;border:1px solid #E2E9F8;border-radius:12px;padding:16px 18px;">${taskDetailsHtml}</div>` : ''}`,
    details,
    ctaLabel: uploadUrl ? 'Upload your files' : null,
    ctaUrl: uploadUrl || null,
    ctaNote: 'This link is active for 48 hours. You can upload multiple files. If the link expires, reply to this email and we\u2019ll reactivate it.',
    outroHtml: 'Please complete and submit within the deadline. If you have any questions, just reply to this email. Good luck!',
    signature,
  });
}

// Candidate's resume has been shortlisted — they've passed the initial review
// and will be moving forward to the interview stage. Warm, encouraging tone; no
// CTA button (HR schedules the interview separately and sends the invite).
function shortlistedEmail({ candidateName, role, signature }) {
  return shell({
    kicker: 'Application Update',
    headline: 'Great news — you\u2019ve been shortlisted!',
    subhead: role || '',
    greetingName: candidateName,
    introHtml: `We're pleased to let you know that your application${role ? ` for the <strong>${esc(role)}</strong> role` : ''} has been <strong>shortlisted</strong>. After reviewing your profile, our team would like to take your candidacy forward to the interview stage.`,
    outroHtml: `Our recruitment team will be in touch shortly with the interview details and next steps. There's nothing you need to do right now \u2014 just keep an eye on your inbox. Congratulations, and we look forward to speaking with you soon!`,
    signature,
  });
}

module.exports = {
  shortlistedEmail,
  taskAssignment,
  rejectionEmail,
  interviewInviteCandidate, interviewInvitePanel, interviewReschedule,
  applicationThankYou, applicationInternalNotice, shell,
};

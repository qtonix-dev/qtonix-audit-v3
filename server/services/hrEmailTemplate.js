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
    footerLine = 'This message was sent by the Qtonix recruitment team.',
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
    <div style="font-size:12px;color:#95A0B8;margin-top:6px;line-height:1.6;">${esc(footerLine)}<br>&copy; ${new Date().getFullYear()} Qtonix. All rights reserved.</div>
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

// Correction of a previously-sent assessment task. Same layout/fields as
// taskAssignment, but tells the candidate to ignore the earlier email and use
// the updated details. Reuses the SAME upload link (token reactivated).
function taskUpdated({ candidateName, role, taskTitle, taskDetailsHtml, deadlineText, uploadUrl, signature }) {
  const details = [
    taskTitle ? { label: 'Task', value: esc(taskTitle) } : null,
    { label: 'Submit by', value: esc(deadlineText) },
    { label: 'How to submit', value: 'Upload your files on the secure link below' },
  ].filter(Boolean);
  return shell({
    kicker: 'Assessment Task',
    headline: 'Updated task details',
    subhead: role || '',
    greetingName: candidateName,
    introHtml: `Please <strong>ignore the previous email</strong> about your task — the details have been updated.${role ? ` Here are the correct details for the <strong>${esc(role)}</strong> role.` : ' Here are the correct details.'}${taskDetailsHtml ? `<br><br><div style="background:#F4F7FE;border:1px solid #E2E9F8;border-radius:12px;padding:16px 18px;">${taskDetailsHtml}</div>` : ''}`,
    details,
    ctaLabel: uploadUrl ? 'Upload your files' : null,
    ctaUrl: uploadUrl || null,
    ctaNote: 'This link is active for 48 hours. You can upload multiple files. If the link expires, reply to this email and we\u2019ll reactivate it.',
    outroHtml: 'Sorry for the mix-up. Please complete and submit within the deadline. If you have any questions, just reply to this email. Good luck!',
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

// Acknowledgement after a candidate submits their assessment task (or the
// requested additional information). Warm, no CTA.
function taskReceived({ candidateName, role, isAdditional, signature }) {
  return shell({
    kicker: isAdditional ? 'Information Received' : 'Task Received',
    headline: isAdditional ? 'Thanks — we\u2019ve got your files' : 'Thank you for your submission',
    subhead: role || '',
    greetingName: candidateName,
    introHtml: isAdditional
      ? `Thank you for sending the additional information we requested${role ? ` for the <strong>${esc(role)}</strong> role` : ''}. We've received your files and our team will review them.`
      : `Thank you for completing and submitting your assessment task${role ? ` for the <strong>${esc(role)}</strong> role` : ''}. We've received your files and our team will review your work.`,
    outroHtml: `We'll get back to you if we need anything further. Thanks again for your effort and time.`,
    signature,
  });
}

// Interviewer requests additional information from the candidate. CTA links back
// to the (reopened) task upload page so they can submit more files.
function taskAdditionalInfoRequest({ candidateName, role, messageHtml, deadlineText, uploadUrl, signature }) {
  return shell({
    kicker: 'Additional Information Requested',
    headline: 'We\u2019d like a bit more from you',
    subhead: role || '',
    greetingName: candidateName,
    introHtml: `Thanks for your submission${role ? ` for the <strong>${esc(role)}</strong> role` : ''}. After reviewing it, our team would like some additional information.${messageHtml ? `<br><br><div style="background:#F4F7FE;border:1px solid #E2E9F8;border-radius:12px;padding:16px 18px;">${messageHtml}</div>` : ''}`,
    details: [{ label: 'Submit by', value: esc(deadlineText) }, { label: 'How to submit', value: 'Upload your files on the secure link below' }],
    ctaLabel: uploadUrl ? 'Upload additional files' : null,
    ctaUrl: uploadUrl || null,
    ctaNote: 'This link is active for 48 hours. You can upload multiple files.',
    outroHtml: 'If you have any questions, just reply to this email. Thank you!',
    signature,
  });
}

// ---- Employee celebration emails (auto-sent, founder-signed) --------------
// All three share the founder signature + a warm, non-recruitment footer line.
const FOUNDER_SIG = { name: 'Sandeep Kumar Swain', title: 'Founder / Director \u00b7 Qtonix', email: 'adam@qtonix.com' };
const CELEBRATION_FOOTER = 'Sent with warm wishes from Qtonix.';

// Birthday wish — sent on the employee's birthday.
function birthdayWish({ employeeName }) {
  return shell({
    kicker: 'A note from the Founder',
    headline: `Happy Birthday, ${esc(firstName(employeeName))}! \uD83C\uDF82`,
    subhead: 'Wishing you a wonderful year ahead.',
    greetingName: employeeName,
    introHtml: `On behalf of everyone at Qtonix, I want to wish you a very happy birthday. Days like today are a reminder of how lucky we are to have you on the team \u2014 your energy and dedication make a real difference.<br><br>I hope the year ahead brings you good health, growth, and plenty of moments worth celebrating. Take today to relax and enjoy yourself \u2014 you\u2019ve earned it.<br><br>Here\u2019s to you!`,
    signature: FOUNDER_SIG,
    footerLine: CELEBRATION_FOOTER,
  });
}

// Work anniversary — sent on the anniversary of the joining date (>= 1 year).
function workAnniversary({ employeeName, years, joinedText, department, branch }) {
  const yLabel = years === 1 ? '1st' : years === 2 ? '2nd' : years === 3 ? '3rd' : `${years}th`;
  const details = [
    joinedText ? { label: 'Joined Qtonix', value: esc(joinedText) } : null,
    { label: 'Years with us', value: esc(`${years} year${years === 1 ? '' : 's'}`) },
    (department || branch) ? { label: 'Team', value: esc([department, branch].filter(Boolean).join(' \u00b7 ')) } : null,
  ].filter(Boolean);
  return shell({
    kicker: 'A note from the Founder',
    headline: `Happy ${yLabel} Work Anniversary! \uD83C\uDFC6`,
    subhead: `${years} year${years === 1 ? '' : 's'} of making Qtonix better.`,
    greetingName: employeeName,
    introHtml: `Congratulations on completing <strong>${years} year${years === 1 ? '' : 's'}</strong> with Qtonix! It\u2019s a milestone worth pausing to celebrate.<br><br>Since the day you joined, you\u2019ve grown into someone the team leans on, and your contribution has shaped where we are today. Thank you for your commitment, your consistency, and the spirit you bring to work every day.<br><br>I\u2019m grateful to have you with us, and I\u2019m looking forward to all that the years ahead will bring.`,
    details,
    signature: FOUNDER_SIG,
    footerLine: CELEBRATION_FOOTER,
  });
}

// New-joinee welcome — sent when a new employee joins.
function welcomeJoinee({ employeeName, designation, department, branch }) {
  const details = [
    designation ? { label: 'Your role', value: esc(designation) } : null,
    (department || branch) ? { label: 'Team', value: esc([department, branch].filter(Boolean).join(' \u00b7 ')) } : null,
  ].filter(Boolean);
  return shell({
    kicker: 'A note from the Founder',
    headline: `Welcome to Qtonix, ${esc(firstName(employeeName))}! \uD83D\uDC4B`,
    subhead: 'We\u2019re glad to have you on board.',
    greetingName: employeeName,
    introHtml: `A very warm welcome to the Qtonix family! I\u2019m thrilled you\u2019ve chosen to build the next chapter of your career with us.<br><br>Every person here plays a part in what we\u2019re building, and I have no doubt you\u2019ll bring something valuable to the team. In your first few days, take the time to settle in, meet your colleagues, and ask plenty of questions \u2014 everyone here is happy to help.<br><br>We\u2019re excited to see all that you\u2019ll achieve. Welcome aboard!`,
    details,
    signature: FOUNDER_SIG,
    footerLine: CELEBRATION_FOOTER,
  });
}

// ===== Onboarding emails ===================================================
// Sent when the joining date is set: thank-you for choosing Qtonix + CTA to the
// onboarding document page. `introHtml`/`outroHtml` may be OpenAI-polished by the
// caller; sensible defaults are used otherwise.
function onboardingWelcome({ candidateName, role, joiningDateText, department, deadlineText, onboardingUrl, introHtml, outroHtml, signature }) {
  const details = [
    role ? { label: 'Your role', value: esc(role) } : null,
    joiningDateText ? { label: 'Joining date', value: esc(joiningDateText) } : null,
    department ? { label: 'Department', value: esc(department) } : null,
    deadlineText ? { label: 'Submit documents by', value: esc(deadlineText) } : null,
  ].filter(Boolean);
  return shell({
    kicker: 'Welcome to Qtonix',
    headline: `Welcome to Qtonix, ${esc(firstName(candidateName))}! \uD83C\uDF89`,
    subhead: role || '',
    greetingName: candidateName,
    introHtml: introHtml || `Thank you for choosing to build your career with us. We\u2019re thrilled to welcome you as our new <strong>${esc(role || 'team member')}</strong>${joiningDateText ? ` joining on <strong>${esc(joiningDateText)}</strong>` : ''}.<br><br>To get your setup and payroll started, please complete your onboarding details and upload a few documents using the secure link below.`,
    details,
    ctaLabel: onboardingUrl ? 'Complete your onboarding' : null,
    ctaUrl: onboardingUrl || null,
    ctaNote: deadlineText ? `Please complete this by ${esc(deadlineText)}. Your progress is saved automatically, so you can finish in more than one sitting.` : 'Your progress is saved automatically, so you can finish in more than one sitting.',
    outroHtml: outroHtml || `If you have any questions before your first day, just reply to this email or reach out to your HR contact. We can\u2019t wait to have you on board!`,
    signature: signature || { name: 'Qtonix Recruitment Team', title: 'Talent Acquisition \u00b7 Qtonix', email: 'career@qtonix.com' },
  });
}

// Confirmation to the candidate that their onboarding documents were received.
function onboardingReceived({ candidateName }) {
  return shell({
    kicker: 'Documents Received',
    headline: 'Thank you \u2014 we\u2019ve got your details',
    greetingName: candidateName,
    introHtml: `We\u2019ve received your onboarding details and documents. Our HR team will review everything and get in touch before your joining day.`,
    outroHtml: `Please remember to carry your <strong>original documents</strong> for verification on your first day. We look forward to welcoming you!`,
    signature: { name: 'Qtonix HR Team', title: 'People & Culture \u00b7 Qtonix', email: 'career@qtonix.com' },
  });
}

// Reminder if the candidate hasn't submitted documents yet.
function onboardingReminder({ candidateName, role, deadlineText, onboardingUrl, signature }) {
  return shell({
    kicker: 'Gentle Reminder',
    headline: `A quick reminder, ${esc(firstName(candidateName))}`,
    subhead: role || '',
    greetingName: candidateName,
    introHtml: `We\u2019re looking forward to your first day! We noticed your onboarding documents haven\u2019t come through yet.${deadlineText ? ` To keep everything on track, please complete them by <strong>${esc(deadlineText)}</strong>.` : ''}`,
    ctaLabel: onboardingUrl ? 'Complete your onboarding' : null,
    ctaUrl: onboardingUrl || null,
    ctaNote: 'It only takes a few minutes, and your progress saves automatically.',
    outroHtml: `If you\u2019ve already started, thank you \u2014 just pick up where you left off. Any trouble? Reply to this email.`,
    signature: signature || { name: 'Qtonix HR Team', title: 'People & Culture \u00b7 Qtonix', email: 'career@qtonix.com' },
  });
}

// Sent to the Project Manager + department Team Leads announcing a new joiner.
function onboardingSeniorNotice({ managerName, candidateName, role, department, joiningDateText, signature }) {
  const details = [
    role ? { label: 'Role', value: esc(role) } : null,
    department ? { label: 'Department', value: esc(department) } : null,
    joiningDateText ? { label: 'Joining date', value: esc(joiningDateText) } : null,
  ].filter(Boolean);
  return shell({
    kicker: 'New Team Member',
    headline: `${esc(firstName(candidateName))} is joining your team`,
    subhead: role || '',
    greetingName: managerName || 'there',
    introHtml: `Heads up \u2014 <strong>${esc(candidateName)}</strong> is joining${role ? ` as our new <strong>${esc(role)}</strong>` : ''}${joiningDateText ? ` on <strong>${esc(joiningDateText)}</strong>` : ''}. Please help us get them set up: confirm the seating arrangement, plan their first-week priorities, and be ready to welcome them.`,
    details,
    outroHtml: `HR will coordinate the desk, hardware, and accounts. If there\u2019s anything specific the role needs on day one, let us know.`,
    signature: signature || { name: 'Qtonix HR Team', title: 'People & Culture \u00b7 Qtonix', email: 'career@qtonix.com' },
  });
}

// Reporting details, sent to the candidate ~2 days before joining (docs complete).
function onboardingReportingDetails({ candidateName, role, joiningDateText, reportingTime, officeAddress, contactPerson, contactPhone, signature }) {
  const details = [
    joiningDateText ? { label: 'Joining date', value: esc(joiningDateText) } : null,
    reportingTime ? { label: 'Reporting time', value: esc(reportingTime) } : null,
    officeAddress ? { label: 'Office address', value: esc(officeAddress) } : null,
    contactPerson ? { label: 'Contact person', value: esc(contactPerson) + (contactPhone ? ` \u00b7 ${esc(contactPhone)}` : '') } : null,
  ].filter(Boolean);
  return shell({
    kicker: 'Your First Day',
    headline: `See you soon, ${esc(firstName(candidateName))}!`,
    subhead: role || '',
    greetingName: candidateName,
    introHtml: `We\u2019re all set for your first day. Here are your reporting details \u2014 please arrive a few minutes early and carry your <strong>original documents</strong> for verification.`,
    details,
    outroHtml: `If you have any trouble finding us or need to reach out on the day, use the contact above. Welcome aboard!`,
    signature: signature || { name: 'Qtonix HR Team', title: 'People & Culture \u00b7 Qtonix', email: 'career@qtonix.com' },
  });
}

// KPI & KRA email — the body is drafted by OpenAI and reviewed/edited by HR
// before sending, so this template just wraps the approved HTML body.
// Reply to a candidate's onboarding question. Mirrors the Application thank-you
// layout: kicker + headline + greeting + body, with their question quoted and
// HR's answer below.
function onboardingQueryReply({ candidateName, question, answer, hrName, signature }) {
  const q = esc(question || '').replace(/\n/g, '<br>');
  const a = esc(answer || '').replace(/\n/g, '<br>');
  const introHtml = `Thanks for reaching out during your onboarding. Here's the response to your question.`
    + `<div style="margin:16px 0 0;padding:14px 16px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;">`
    + `<div style="font-size:12px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px;">Your question</div>`
    + `<div style="font-size:14px;color:#334155;line-height:1.6;">${q}</div></div>`
    + `<div style="margin:12px 0 0;padding:14px 16px;background:#FFF7ED;border:1px solid #FED7AA;border-radius:10px;">`
    + `<div style="font-size:12px;font-weight:700;color:#EA580C;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px;">Our response</div>`
    + `<div style="font-size:14px;color:#334155;line-height:1.6;">${a}</div></div>`;
  return shell({
    kicker: 'Onboarding Support',
    headline: 'Response to your question',
    subhead: '',
    greetingName: candidateName,
    introHtml,
    outroHtml: `If you have any more questions before your first day, just reply to this email or use the question box on your onboarding page. We're glad to help.`,
    signature: signature || { name: hrName || 'Qtonix HR Team', title: 'People & Culture \u00b7 Qtonix', email: 'hr@qtonix.com' },
  });
}

function onboardingKpiKra({ employeeName, role, bodyHtml, signature }) {
  return shell({
    kicker: 'Your Goals & Responsibilities',
    headline: `Your KPIs & KRAs, ${esc(firstName(employeeName))}`,
    subhead: role || '',
    greetingName: employeeName,
    introHtml: bodyHtml || `Please find your key responsibilities and performance indicators below.`,
    outroHtml: `Take a little time to review these with your manager. They\u2019ll guide your first few months \u2014 and we\u2019re here to support you.`,
    signature: signature || { name: 'Qtonix HR Team', title: 'People & Culture \u00b7 Qtonix', email: 'hr@qtonix.com' },
  });
}

module.exports = {
  taskReceived, taskAdditionalInfoRequest,
  shortlistedEmail,
  taskAssignment,
  taskUpdated,
  rejectionEmail,
  interviewInviteCandidate, interviewInvitePanel, interviewReschedule,
  applicationThankYou, applicationInternalNotice, shell,
  birthdayWish, workAnniversary, welcomeJoinee,
  onboardingWelcome, onboardingReceived, onboardingReminder,
  onboardingSeniorNotice, onboardingReportingDetails, onboardingKpiKra, onboardingQueryReply,
};

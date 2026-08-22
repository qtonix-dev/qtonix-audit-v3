/**
 * Branded, responsive HTML email templates for Sales-CRM automated mail:
 *  - task/call reminders (15 min before a scheduled activity)
 *  - monthly sales-target congratulations (agent)
 *  - team-target congratulations (manager)
 *  - mid/late-month encouragement nudges (15th & 25th) for agents behind target
 *
 * Table-based layout so it renders consistently in Gmail, Outlook, Apple Mail.
 * Sent from the admin mailbox (adam@qtonix.com). All builders return a full
 * HTML document string ready for gmail.sendMessage.
 */

const NAVY = '#0A0E28';
const NAVY2 = '#0435AC';
const ORANGE1 = '#FF6A00';
const ORANGE2 = '#FF4500';
const GREEN = '#0F9D58';
const INK = '#1c2433';
const MUTED = '#6B7A99';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'there';
}
function detailRow(label, value) {
  if (!value) return '';
  return `<tr>
    <td style="padding:7px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${MUTED};width:120px;vertical-align:top;">${esc(label)}</td>
    <td style="padding:7px 0;font-size:15px;font-weight:600;color:${NAVY};line-height:1.4;">${value}</td>
  </tr>`;
}

/**
 * Core shell. opts:
 *  kicker, headline, subhead, greetingName, introHtml,
 *  details:[{label,value(html)}], ctaLabel, ctaUrl, ctaNote,
 *  outroHtml, heroColor (override hero gradient start), signature:{name,title,email}
 */
function shell(opts) {
  const {
    kicker = 'Qtonix Sales', headline = '', subhead = '', heroIcon = '',
    greetingName = '', introHtml = '', details = [], ctaLabel, ctaUrl, ctaNote = '',
    outroHtml = '', signature = {}, heroFrom = NAVY, heroTo = NAVY2, rawBody = null,
  } = opts;

  const detailRows = details.filter(Boolean).map((d) => detailRow(d.label, d.value)).join('');
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

      <tr><td style="background:${heroFrom};background:linear-gradient(135deg,${heroFrom} 0%,${heroTo} 100%);border-radius:16px 16px 0 0;padding:38px 44px 34px;">
        ${heroIcon ? `<div style="font-size:34px;line-height:1;margin-bottom:14px;">${heroIcon}</div>` : ''}
        <div style="font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#8FB4FF;">${esc(kicker)}</div>
        <div style="font-size:27px;font-weight:800;color:#ffffff;line-height:1.25;margin-top:10px;">${esc(headline)}</div>
        ${subhead ? `<div style="font-size:15px;color:#C9D8FF;margin-top:12px;">${subhead}</div>` : ''}
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
    <div style="font-size:12px;color:#95A0B8;margin-top:6px;line-height:1.6;">Automated message from the Qtonix Sales system.<br>&copy; ${new Date().getFullYear()} Qtonix. All rights reserved.</div>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}

const money = (n) => `$${Number(n || 0).toLocaleString()}`;

// ---- Builders --------------------------------------------------------------

// 1) Reminder ~15 min before a scheduled task/call for a lead.
function activityReminder({ agentName, kind, title, leadName, whenText, minutesLeft, details, signature }) {
  const isCall = kind === 'call';
  const label = isCall ? 'Call' : 'Task';
  return shell({
    kicker: `Upcoming ${label}`,
    headline: `Your ${label.toLowerCase()} is coming up`,
    subhead: `In about ${minutesLeft || 15} minutes`,
    greetingName: agentName,
    introHtml: `You have a <strong>${esc(label.toLowerCase())}</strong>${title ? ` — <strong>${esc(title)}</strong>` : ''} scheduled${leadName ? ` for <strong>${esc(leadName)}</strong>` : ''} in about <strong>${minutesLeft || 15} minutes</strong>. Get ready for it.`,
    details: [
      { label: label === 'Call' ? 'Call' : 'Task', value: esc(title || label) },
      leadName ? { label: 'Lead', value: esc(leadName) } : null,
      whenText ? { label: 'Scheduled at', value: esc(whenText) } : null,
      details ? { label: 'Details', value: esc(details).replace(/\n/g, '<br>') } : null,
    ],
    outroHtml: isCall ? 'Have the lead\u2019s history handy and dial in on time. Good luck!' : 'Take a moment to prepare so you can knock it out. You\u2019ve got this!',
    signature,
  });
}

// 2) Agent hit their monthly sales target.
function targetHit({ agentName, achievedUsd, targetUsd, signature }) {
  const over = Math.max(0, Math.round((achievedUsd || 0) - (targetUsd || 0)));
  const pct = targetUsd > 0 ? Math.round((achievedUsd / targetUsd) * 100) : 100;
  return shell({
    kicker: 'Target Achieved',
    heroFrom: '#0B7A43', heroTo: GREEN,
    heroIcon: '\uD83C\uDF89',
    headline: `You hit your target!`,
    subhead: `${pct}% of your monthly goal`,
    greetingName: agentName,
    introHtml: `Huge congratulations \u2014 you\u2019ve <strong>reached your monthly sales target</strong>! This is the result of real effort and consistency, and it hasn\u2019t gone unnoticed.`,
    details: [
      { label: 'Target', value: money(targetUsd) },
      { label: 'Achieved', value: `<span style="color:${GREEN};font-weight:700;">${money(achievedUsd)}</span>` },
      over > 0 ? { label: 'Over target', value: `+${money(over)}` } : null,
    ],
    outroHtml: 'Keep the momentum going \u2014 every sale from here is a bonus on an already great month. Well done! \uD83D\uDE80',
    signature,
  });
}

// 3) Manager hit their team target.
function teamTargetHit({ managerName, achievedUsd, targetUsd, signature }) {
  const over = Math.max(0, Math.round((achievedUsd || 0) - (targetUsd || 0)));
  const pct = targetUsd > 0 ? Math.round((achievedUsd / targetUsd) * 100) : 100;
  return shell({
    kicker: 'Team Target Achieved',
    heroFrom: '#0B7A43', heroTo: GREEN,
    heroIcon: '\uD83C\uDFC6',
    headline: `Your team hit its target!`,
    subhead: `${pct}% of the team goal`,
    greetingName: managerName,
    introHtml: `Congratulations \u2014 your team has <strong>reached its monthly target</strong>! Great leadership shows in results like this. Thank you for driving your team forward.`,
    details: [
      { label: 'Team target', value: money(targetUsd) },
      { label: 'Team achieved', value: `<span style="color:${GREEN};font-weight:700;">${money(achievedUsd)}</span>` },
      over > 0 ? { label: 'Over target', value: `+${money(over)}` } : null,
    ],
    outroHtml: 'Share the win with your team \u2014 they\u2019ll be glad to hear it came from the top. Onward! \uD83D\uDCAA',
    signature,
  });
}

// 4) Encouragement nudge (15th / 25th) for an agent behind target.
function encouragement({ agentName, achievedUsd, targetUsd, daysLeft, phase, signature }) {
  const gap = Math.max(0, Math.round((targetUsd || 0) - (achievedUsd || 0)));
  const pct = targetUsd > 0 ? Math.round((achievedUsd / targetUsd) * 100) : 0;
  const late = phase === 'late';
  return shell({
    kicker: late ? 'Final Stretch' : 'Mid-Month Check-in',
    heroFrom: ORANGE2, heroTo: ORANGE1,
    heroIcon: late ? '\u23F3' : '\uD83D\uDCAA',
    headline: late ? `${daysLeft} days left \u2014 let\u2019s finish strong` : `You\u2019re ${pct}% there \u2014 keep pushing!`,
    subhead: `${daysLeft} day${daysLeft === 1 ? '' : 's'} left this month`,
    greetingName: agentName,
    introHtml: late
      ? `We\u2019re in the final stretch of the month with <strong>${daysLeft} day${daysLeft === 1 ? '' : 's'} left</strong>. You\u2019re at <strong>${pct}%</strong> of your target \u2014 there\u2019s still time to close the gap, and every deal counts now.`
      : `Just a friendly nudge at the halfway mark. You\u2019re at <strong>${pct}%</strong> of your monthly target with <strong>${daysLeft} day${daysLeft === 1 ? '' : 's'} left</strong>. A focused push over the next couple of weeks can make all the difference.`,
    details: [
      { label: 'Target', value: money(targetUsd) },
      { label: 'Achieved', value: money(achievedUsd) },
      { label: 'Still to go', value: `<span style="color:${ORANGE2};font-weight:700;">${money(gap)}</span>` },
      { label: 'Days left', value: `${daysLeft}` },
    ],
    outroHtml: late
      ? 'Line up your best opportunities and give it everything. We believe you can do it \u2014 go get it! \uD83D\uDD25'
      : 'Prioritise your warmest leads and follow up on pending deals. You\u2019ve got this \u2014 let\u2019s make it a strong month! \uD83D\uDCAA',
    signature,
  });
}

// 5) New survey launched — sent to agents & managers from the HR mailbox.
function surveyLaunch({ recipientName, surveyName, description, deadlineText, surveyUrl, signature }) {
  return shell({
    kicker: 'Action Needed',
    heroIcon: '\uD83D\uDCCB',
    headline: 'A new survey needs your input',
    subhead: surveyName || '',
    greetingName: recipientName,
    introHtml: `A new survey${surveyName ? ` <strong>${esc(surveyName)}</strong>` : ''} has just been launched. Your honest feedback helps us make Qtonix a better place to work \u2014 it only takes a couple of minutes.${description ? `<br><br>${esc(description)}` : ''}<br><br><span style="display:inline-block;background:#EEF3FF;border:1px solid #D6E2FF;border-radius:10px;padding:10px 14px;font-size:13px;color:#0435AC;">\uD83D\uDD12 <strong>All responses are completely anonymous.</strong> Please answer honestly.</span>`,
    details: [
      surveyName ? { label: 'Survey', value: esc(surveyName) } : null,
      { label: 'Time needed', value: '~2 minutes' },
      deadlineText ? { label: 'Please complete by', value: esc(deadlineText) } : null,
    ],
    ctaLabel: surveyUrl ? 'Complete the survey' : null,
    ctaUrl: surveyUrl || null,
    ctaNote: 'Your responses are anonymous and help shape team decisions.',
    outroHtml: 'Thanks for taking the time \u2014 we read every response.',
    signature,
  });
}

// 6) Monthly team performance summary — 1st of the month, to all agents +
// managers. The narrative `bodyHtml` is AI-drafted; this wraps it with the
// tone-appropriate hero and appends the Top-3 + incentive tables.
function monthlySummary({ recipientName, monthLabel, teamPct, tone, bodyHtml, topPerformers, incentiveEarners, signature }) {
  // Tone → hero styling + headline. Tiers: achieved (green), close (blue),
  // focus (orange), low (red).
  const heroes = {
    achieved: { from: '#0B7A43', to: GREEN,     icon: '\uD83C\uDFC6', head: `${monthLabel} \u2014 target smashed!` },
    close:    { from: '#0435AC', to: '#2563EB', icon: '\uD83D\uDCAA', head: `${monthLabel} \u2014 good effort, let\u2019s push` },
    focus:    { from: '#B45309', to: ORANGE1,   icon: '\uD83C\uDFAF', head: `${monthLabel} \u2014 let\u2019s tighten our focus` },
    low:      { from: '#991B1B', to: '#DC2626', icon: '\uD83D\uDCCA', head: `${monthLabel} \u2014 an honest reset` },
  };
  const h = heroes[tone] || heroes.close;

  // Avatar cell: agent's photo, falling back to coloured initials.
  const avatarCell = (name, url) => {
    if (url) return `<img src="${esc(url)}" width="44" height="44" style="width:44px;height:44px;border-radius:50%;object-fit:cover;display:block;" alt="" />`;
    const init = String(name || '').split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
    const palette = ['#2563EB', '#7C3AED', '#0F9D58', '#FF6A00', '#E11D48', '#0891B2'];
    const c = palette[String(name || '').length % palette.length];
    return `<div style="width:44px;height:44px;border-radius:50%;background:${c};color:#fff;font-size:15px;font-weight:700;line-height:44px;text-align:center;">${esc(init)}</div>`;
  };

  // Top-3 performers card: image left, name + "x% of target · $xx" right.
  let topCard = '';
  if (Array.isArray(topPerformers) && topPerformers.length) {
    const rows = topPerformers.slice(0, 3).map((p, i, arr) => {
      const bb = i < arr.length - 1 ? 'border-bottom:1px solid #E2E9F8;' : '';
      const meta = [p.pct != null ? `${p.pct}% of target` : null, p.amount ? esc(p.amount) : null].filter(Boolean).join(' \u00b7 ');
      return `<tr>
        <td style="padding:14px 12px 14px 16px;width:56px;${bb}">${avatarCell(p.name, p.avatar)}</td>
        <td style="padding:14px 16px 14px 4px;${bb}">
          <div style="font-size:15px;font-weight:700;color:${NAVY};">${esc(p.name)}</div>
          ${meta ? `<div style="font-size:13px;color:${MUTED};margin-top:2px;">${meta}</div>` : ''}
        </td></tr>`;
    }).join('');
    topCard = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px;">
      <tr><td style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${MUTED};padding-bottom:8px;">\uD83C\uDFC5 Top 3 performers</td></tr>
      <tr><td><table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7FE;border:1px solid #E2E9F8;border-radius:12px;">${rows}</table></td></tr></table>`;
  }

  // Incentive earners table: name · achieved amount · achieved %.
  let incCard = '';
  if (Array.isArray(incentiveEarners) && incentiveEarners.length) {
    const rows = incentiveEarners.map((e, i, arr) => {
      const bb = i < arr.length - 1 ? 'border-bottom:1px solid #EEF1F8;' : '';
      return `<tr>
        <td style="padding:11px 16px;font-size:14px;color:${NAVY};${bb}">${esc(e.name)}${e.role === 'manager' ? ' <span style="color:#8A93A6;font-size:12px;">(mgr)</span>' : ''}</td>
        <td style="padding:11px 16px;font-size:14px;color:${NAVY};text-align:right;white-space:nowrap;${bb}">${e.amount ? esc(e.amount) : ''}</td>
        <td style="padding:11px 16px;font-size:13px;font-weight:700;color:${GREEN};text-align:right;white-space:nowrap;${bb}">${e.pct != null ? `${e.pct}%` : ''}</td>
      </tr>`;
    }).join('');
    incCard = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;">
      <tr><td style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${MUTED};padding-bottom:8px;">\uD83D\uDCB0 Incentive earners this month</td></tr>
      <tr><td><table width="100%" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border:1px solid #E2E9F8;border-radius:12px;">
        <tr style="background:#FAFBFE;"><td style="padding:9px 16px;font-size:11px;font-weight:700;color:${MUTED};text-transform:uppercase;">Name</td><td style="padding:9px 16px;font-size:11px;font-weight:700;color:${MUTED};text-transform:uppercase;text-align:right;">Achieved</td><td style="padding:9px 16px;font-size:11px;font-weight:700;color:${MUTED};text-transform:uppercase;text-align:right;">%</td></tr>
        ${rows}
      </table></td></tr></table>`;
  }

  return shell({
    kicker: 'Monthly Team Summary',
    heroFrom: h.from, heroTo: h.to, heroIcon: h.icon,
    headline: h.head,
    subhead: teamPct != null ? `Sales team \u00b7 ${teamPct}% of target` : '',
    greetingName: recipientName || 'Team',
    rawBody: `${bodyHtml}${topCard}${incCard}`,
    signature,
  });
}

// 8) Survey completion — thank-you after an agent submits their response.
function surveyDone({ recipientName, surveyName, signature }) {
  return shell({
    kicker: 'Response Received',
    heroFrom: '#0B7A43', heroTo: GREEN, heroIcon: '\u2705',
    headline: 'Thanks \u2014 your response is in!',
    subhead: surveyName || '',
    greetingName: recipientName,
    introHtml: `Thank you for completing${surveyName ? ` the <strong>${esc(surveyName)}</strong>` : ' the'} survey. Your feedback has been recorded anonymously and genuinely helps us make Qtonix a better place to work.`,
    outroHtml: 'We review every response and act on what we hear. Thanks again for taking the time. \uD83D\uDE4F',
    signature,
  });
}

module.exports = { shell, activityReminder, targetHit, teamTargetHit, encouragement, surveyLaunch, surveyDone, monthlySummary };

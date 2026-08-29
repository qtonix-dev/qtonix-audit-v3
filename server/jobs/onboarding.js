/**
 * Candidate onboarding scheduler (IST-aware, hourly).
 *
 * For every hired candidate with an onboarding blob + a joining date:
 *   • 7 days before  → activate the onboarding page + send the welcome email
 *                      (once), so the candidate can upload documents.
 *   • 3 days before  → if documents still not submitted, send a reminder.
 *   • 2 days before  → notify the Project Manager + department Team Leads of the
 *                      new joiner (once); and if documents are complete, send the
 *                      candidate their reporting details (time, office address
 *                      from the branch, contact person = reporting manager/HR).
 *
 * All sends dedupe via CrmEmailLog + one-shot timestamps on the onboarding blob,
 * so restarts never double-send.
 */
const gmail = require('../services/gmail');
const tpl = require('../services/hrEmailTemplate');
const { connectedMailboxes } = require('./crmReminders');

const INTERVAL_MS = Number(process.env.ONBOARDING_JOB_MS || 60 * 60 * 1000); // hourly
let timer = null;
let running = false;

function istDatePlus(n) {
  const ist = new Date(Date.now() + (5 * 60 + 30) * 60000);
  ist.setUTCDate(ist.getUTCDate() + n);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')}`;
}
function fmtDate(s) { try { return new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); } catch { return s; } }
function appUrl() { return (process.env.APP_URL || '').replace(/\/$/, ''); }

async function sendOnce(models, s, sender, { dedupeKey, type, to, toName, subject, bodyHtml, cc }) {
  const { CrmEmailLog } = models;
  if (!to) return false;
  if (await CrmEmailLog.findOne({ where: { dedupeKey } })) return true;
  let logRow;
  try { logRow = await CrmEmailLog.create({ dedupeKey, type, toName: toName || '', toEmail: to, subject: subject || '', status: 'pending' }); }
  catch { return true; }
  try {
    await gmail.sendMessage(s, sender.token, sender.email, { from: `"Qtonix HR" <${sender.email}>`, to, cc: cc || [], subject, bodyHtml });
    logRow.status = 'sent'; logRow.sentAt = new Date(); await logRow.save();
    return true;
  } catch (e) {
    logRow.status = 'failed'; logRow.error = String(e.message || e).slice(0, 500); await logRow.save();
    console.error('[onboarding-job] send failed:', e.message);
    return false;
  }
}

// The assigned HR (or recruiter) for a candidate's job.
async function hrContactFor(models, cand, job) {
  const { HrUser } = models;
  const ids = (job && Array.isArray(job.assignedHrIds)) ? job.assignedHrIds : [];
  if (ids.length) { const u = await HrUser.findByPk(ids[0]); if (u) return u; }
  if (cand.recruiterId) return HrUser.findByPk(cand.recruiterId);
  return null;
}

// Project Manager(s) + Team Leads of the joiner's department.
async function seniorsFor(models, job, cand) {
  const { HrUser, Op } = models;
  const dept = (job && job.department) || cand.department || '';
  const where = { active: true, type: { [Op.in]: ['manager', 'tl'] } };
  const all = await HrUser.findAll({ where });
  // PMs (managers) company-wide + TLs in the same department.
  return all.filter((u) => u.type === 'manager' || (u.type === 'tl' && dept && String(u.department || '').trim().toLowerCase() === String(dept).trim().toLowerCase()));
}

async function tick(models) {
  if (running) return; running = true;
  try {
    const { Settings, HrCandidate, HrJobPost, HrBranch } = models;
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    const pool = await connectedMailboxes(models);
    const sender = pool.find((m) => m.email === 'adam@qtonix.com') || pool.find((m) => /career|hr/i.test(m.email)) || pool[0];
    if (!sender) { running = false; return; }

    const d7 = istDatePlus(7), d3 = istDatePlus(3), d2 = istDatePlus(2);
    // Candidates in an onboarding window (joining date within the next 7 days).
    const cands = await HrCandidate.findAll({ where: { blacklisted: false } });
    let acted = 0;
    for (const cand of cands) {
      const onb = cand.onboarding;
      const offer = cand.offer || {};
      if (!onb || !offer.joiningDate) continue;
      const jd = String(offer.joiningDate).slice(0, 10);
      if (offer.notJoined) continue;
      const job = cand.jobPostId ? await HrJobPost.findByPk(cand.jobPostId) : null;
      const hr = await hrContactFor(models, cand, job);
      const hrSig = hr ? { name: hr.name, title: 'HR \u00b7 Qtonix', email: sender.email } : null;
      const joiningDateText = fmtDate(jd);
      const onbUrl = onb.token ? `${appUrl()}/onboarding/${onb.token}` : '';
      let dirty = false;

      // 7 days before → welcome + activate (once).
      if (jd === d7 && !onb.welcomeEmailSentAt) {
        const deadlineText = fmtDate(istDatePlus(4)); // ~3 days before joining
        const bodyHtml = tpl.onboardingWelcome({ candidateName: cand.name, role: job ? job.title : '', joiningDateText, department: job ? job.department : '', deadlineText, onboardingUrl: onbUrl, signature: hrSig });
        const okSent = await sendOnce(models, s, sender, { dedupeKey: `onbwelcome:${cand.id}:${jd}`, type: 'onboarding_welcome', to: cand.email, toName: cand.name, subject: `Welcome to Qtonix, ${String(cand.name).split(' ')[0]}! \u2013 Next Steps`, bodyHtml, cc: hr && hr.email ? [hr.email] : [] });
        if (okSent) { onb.welcomeEmailSentAt = new Date().toISOString(); if (!onb.activatedAt) onb.activatedAt = onb.welcomeEmailSentAt; dirty = true; acted++; }
      }

      // 3 days before → reminder if not submitted.
      if (jd === d3 && onb.status !== 'submitted' && !onb.reminderSentAt) {
        const deadlineText = fmtDate(istDatePlus(1));
        const bodyHtml = tpl.onboardingReminder({ candidateName: cand.name, role: job ? job.title : '', deadlineText, onboardingUrl: onbUrl, signature: hrSig });
        const okSent = await sendOnce(models, s, sender, { dedupeKey: `onbremind:${cand.id}:${jd}`, type: 'onboarding_reminder', to: cand.email, toName: cand.name, subject: `Reminder: complete your Qtonix onboarding`, bodyHtml, cc: hr && hr.email ? [hr.email] : [] });
        if (okSent) { onb.reminderSentAt = new Date().toISOString(); dirty = true; acted++; }
      }

      // 2 days before → notify seniors (once), + reporting details if docs done.
      if (jd === d2) {
        if (!onb.seniorNotifiedAt) {
          const seniors = await seniorsFor(models, job, cand);
          let anySent = false;
          for (const mgr of seniors) {
            if (!mgr.email) continue;
            const bodyHtml = tpl.onboardingSeniorNotice({ managerName: mgr.name, candidateName: cand.name, role: job ? job.title : '', department: job ? job.department : '', joiningDateText, signature: hrSig });
            const okSent = await sendOnce(models, s, sender, { dedupeKey: `onbsenior:${cand.id}:${jd}:${mgr.email}`, type: 'onboarding_senior', to: mgr.email, toName: mgr.name, subject: `New joiner: ${cand.name}${job ? ` (${job.title})` : ''}`, bodyHtml });
            anySent = anySent || okSent;
          }
          if (anySent) { onb.seniorNotifiedAt = new Date().toISOString(); dirty = true; acted++; }
        }
        if ((onb.status === 'submitted' || onb.docsComplete) && !onb.reportingSentAt) {
          const branch = (job && job.locations && job.locations[0]) || cand.branch || '';
          const branchRow = branch ? await HrBranch.findOne({ where: { name: branch } }) : null;
          const officeAddress = (branchRow && branchRow.address) || '';
          const bodyHtml = tpl.onboardingReportingDetails({ candidateName: cand.name, role: job ? job.title : '', joiningDateText, reportingTime: offer.joiningTime || '09:30', officeAddress: officeAddress || 'Will be shared by your HR contact', contactPerson: hr ? hr.name : '', contactPhone: hr ? hr.phone : '', signature: hrSig });
          const okSent = await sendOnce(models, s, sender, { dedupeKey: `onbreport:${cand.id}:${jd}`, type: 'onboarding_reporting', to: cand.email, toName: cand.name, subject: `Your first day at Qtonix \u2014 reporting details`, bodyHtml, cc: hr && hr.email ? [hr.email] : [] });
          if (okSent) { onb.reportingSentAt = new Date().toISOString(); dirty = true; acted++; }
        }
      }

      if (dirty) { cand.onboarding = onb; cand.changed('onboarding', true); await cand.save(); }
    }
    if (acted) console.log(`[onboarding-job] sent ${acted} onboarding email(s)`);
  } catch (e) {
    console.error('[onboarding-job] tick failed:', e.message);
  } finally { running = false; }
}

function start(models) {
  if (timer) return;
  setTimeout(() => tick(models), 40 * 1000);
  timer = setInterval(() => tick(models), INTERVAL_MS);
  console.log('[onboarding-job] started');
}

module.exports = { start, tick, istDatePlus, seniorsFor };

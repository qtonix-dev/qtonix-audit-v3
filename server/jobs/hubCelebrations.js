/**
 * Company celebrations job → posts to the #the-hub Buzz channel each morning:
 *   🎂 birthdays (today), 🎊 work anniversaries (today, ≥1 yr), 👋 new joinees
 *   (their first working day). One post per person per event per day, guarded by
 *   a dedupeKey so repeated ticks never double-post.
 *
 * Recognition and helping-hand shout-outs are posted event-driven from their own
 * endpoints (not here). This job only handles date-based celebrations.
 */
const { HrUser } = require('../models');
const { postCompanyCard } = require('../services/chatCompany');

const INTERVAL_MS = Number(process.env.HUB_CELEBRATION_MS || 30 * 60 * 1000); // every 30 min
const POST_HOUR = Number(process.env.HUB_CELEBRATION_HOUR || 9);              // ~9 AM IST
let timer = null; let running = false;

function istNow() { return new Date(Date.now() + 330 * 60000); }
function isSameMonthDay(d, ref) { const x = new Date(d); return x.getMonth() === ref.getMonth() && x.getDate() === ref.getDate(); }

async function runCelebrations(models) {
  const now = istNow();
  const dateStr = now.toISOString().slice(0, 10);
  const users = await (models.HrUser || HrUser).findAll({ where: { active: true } });
  for (const u of users) {
    const first = (u.name || '').split(' ')[0] || u.name;
    // Birthday today.
    if (u.birthday && isSameMonthDay(u.birthday, now)) {
      await postCompanyCard({
        kindTag: 'celebration_birthday',
        body: `🎂 It's ${u.name}'s birthday today! Let's shower them with wishes. 🎉`,
        meta: { userId: u.id }, dedupeKey: `bday-${u.id}-${dateStr}`,
      });
    }
    // Work anniversary today (≥ 1 year) OR new joinee (joined today, this year).
    if (u.joiningDate) {
      const jd = new Date(u.joiningDate);
      const years = now.getFullYear() - jd.getFullYear();
      if (isSameMonthDay(u.joiningDate, now)) {
        if (years >= 1) {
          await postCompanyCard({
            kindTag: 'celebration_anniversary',
            body: `🎊 ${u.name} completes ${years} year${years > 1 ? 's' : ''} at Qtonix today! Thank you for all you do. 🙌`,
            meta: { userId: u.id, years }, dedupeKey: `anniv-${u.id}-${dateStr}`,
          });
        }
      }
      // New joinee — their first working day (joined today), never "0 years".
      const daysSince = Math.round((now - jd) / 86400000);
      if (daysSince === 0) {
        await postCompanyCard({
          kindTag: 'celebration_joinee',
          body: `👋 Please welcome ${u.name} to the Qtonix family${u.department ? `, joining ${u.department}` : ''}! Say hi. 🎉`,
          meta: { userId: u.id }, dedupeKey: `joinee-${u.id}-${dateStr}`,
        });
      }
    }
  }
}

async function tick(models) {
  if (running) return; running = true;
  try {
    const now = istNow();
    if (now.getHours() === POST_HOUR) await runCelebrations(models);
  } catch (e) { console.error('[hub-celebrations] tick failed:', e.message); }
  running = false;
}

function start(models) {
  if (timer) return;
  timer = setInterval(() => tick(models), INTERVAL_MS);
  console.log('[hub-celebrations] scheduler started (posts ~' + POST_HOUR + ':00 IST to #the-hub)');
}

module.exports = { start, tick, runCelebrations };

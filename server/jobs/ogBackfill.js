/**
 * One-time backfill of AI share metadata (OG title/description) + the branded
 * share image for all EXISTING published job posts. Runs once on boot; a marker
 * on Settings (ogBackfillDone) prevents it from ever repeating.
 */
async function runOgBackfill(models) {
  const { HrJobPost, Settings } = models;
  const s = await Settings.findOne({ where: { singleton: 'settings' } });
  if (!s) return;
  if (s.ogBackfillDone) return; // already run
  try {
    const jobMeta = require('../services/jobMeta');
    const key = s.getKey ? s.getKey('openai') : null;
    const branding = s.hrCareers || {};

    // Build the branded OG image once (shared by every post + the careers page).
    try {
      const fs = require('fs');
      if (!fs.existsSync(jobMeta.ogImagePath())) await jobMeta.buildOgImage(branding.logo || '');
    } catch (e) { console.error('[og-backfill] image build failed:', e.message); }

    // Generate + cache meta for every published job that doesn't have it yet.
    const jobs = await HrJobPost.findAll({ where: { status: 'published' } });
    let done = 0;
    for (const job of jobs) {
      if (job.ogTitle && job.ogDescription) continue;
      try {
        const meta = await jobMeta.generateJobMeta(job, key);
        job.ogTitle = meta.title; job.ogDescription = meta.description; job.ogGeneratedAt = new Date();
        await job.save();
        done += 1;
      } catch (e) { console.error(`[og-backfill] job ${job.id} failed:`, e.message); }
    }

    // Careers-page meta.
    try {
      const careersMeta = await jobMeta.generateCareersMeta(jobs, branding, key);
      s.hrCareers = { ...(s.hrCareers || {}), ogTitle: careersMeta.title, ogDescription: careersMeta.description };
      s.changed('hrCareers', true);
    } catch (e) { console.error('[og-backfill] careers meta failed:', e.message); }

    s.ogBackfillDone = true;
    await s.save();
    console.log(`[og-backfill] done — generated meta for ${done} job(s).`);
  } catch (e) {
    console.error('[og-backfill] failed:', e.message);
  }
}

// Kick off shortly after boot so it doesn't delay startup.
function start(models) {
  setTimeout(() => { runOgBackfill(models).catch((e) => console.error('[og-backfill]', e.message)); }, 15 * 1000);
}

module.exports = { start, runOgBackfill };

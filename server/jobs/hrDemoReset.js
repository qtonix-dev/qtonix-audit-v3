/**
 * HRMS DEMO auto-reset — while the demo is enabled, reseed the sample data once
 * a day (early morning IST) so it always looks fresh for the next demo.
 */
const { Settings } = require('../models');
const hrDemo = require('../services/hrDemo');

const INTERVAL_MS = Number(process.env.HR_DEMO_RESET_MS || 60 * 60 * 1000); // hourly check
const RESET_HOUR = Number(process.env.HR_DEMO_RESET_HOUR || 4);             // ~4 AM IST
let timer = null; let running = false; let lastReset = '';

function istNow() { return new Date(Date.now() + 330 * 60000); }

async function tick() {
  if (running) return; running = true;
  try {
    const s = await Settings.findOne({ where: { singleton: 'settings' } });
    if (s && s.hrDemoEnabled) {
      const now = istNow();
      const day = now.toISOString().slice(0, 10);
      if (now.getHours() === RESET_HOUR && lastReset !== day) { await hrDemo.seedDemo(); lastReset = day; console.log('[hr-demo] daily reset done'); }
    }
  } catch (e) { console.error('[hr-demo] reset tick failed:', e.message); }
  running = false;
}

function start() {
  if (timer) return;
  timer = setInterval(tick, INTERVAL_MS);
  console.log('[hr-demo] auto-reset scheduler started (~' + RESET_HOUR + ':00 IST daily)');
}

module.exports = { start, tick };

/**
 * PROJECT CYCLES scheduler — for active recurring projects, spins up a new
 * monthly cycle on the start-date day (e.g. start 5th → new cycle on the 5th of
 * each month). Runs until the project is Paused or Cancelled. Idempotent: only
 * one cycle per project per calendar month.
 */
const { Project, ProjectCycle, ProjectTemplate } = require('../models');
const flow = require('../services/projectFlow');

const INTERVAL_MS = Number(process.env.PROJECT_CYCLE_MS || 60 * 60 * 1000); // hourly
let timer = null; let running = false;

function istNow() { return new Date(Date.now() + 330 * 60000); }

async function runCycles(models) {
  const now = istNow();
  const day = now.getDate();
  const ym = now.toISOString().slice(0, 7); // YYYY-MM
  const projects = await (models.Project || Project).findAll({ where: { status: 'active', recurring: true } });
  for (const p of projects) {
    if (!p.startDate) continue;
    const startDay = Number(String(p.startDate).slice(8, 10));
    // Trigger on the start-day (or the last day of a short month if start-day > days-in-month).
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const triggerDay = Math.min(startDay, daysInMonth);
    if (day !== triggerDay) continue;
    // Skip the very first month (cycle 1 is created at project creation? No — we
    // create the first cycle here too, but only if none exists this month).
    const existing = await (models.ProjectCycle || ProjectCycle).findOne({ where: { projectId: p.id } });
    const lastCycle = await (models.ProjectCycle || ProjectCycle).findOne({ where: { projectId: p.id }, order: [['cycleNumber', 'DESC']] });
    if (lastCycle && String(lastCycle.cycleStart).slice(0, 7) === ym) continue; // already have this month's cycle
    const template = p.templateId ? await (models.ProjectTemplate || ProjectTemplate).findByPk(p.templateId) : null;
    try { await flow.startCycle(p, template); } catch (e) { console.error('[project-cycles] startCycle failed for', p.id, e.message); }
  }
}

async function tick(models) {
  if (running) return; running = true;
  try { await runCycles(models); } catch (e) { console.error('[project-cycles] tick failed:', e.message); }
  running = false;
}

function start(models) {
  if (timer) return;
  timer = setInterval(() => tick(models), INTERVAL_MS);
  console.log('[project-cycles] scheduler started (monthly recurring cycles)');
}

module.exports = { start, tick, runCycles };

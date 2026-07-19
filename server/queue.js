/**
 * Job queue. BullMQ + Redis when REDIS_URL is set; otherwise an in-process
 * fallback so the app runs on a single box with no extra infrastructure.
 *
 * Audits take 60-180s. They must never run in the HTTP request cycle.
 */
const QUEUE_NAME = 'reports';
let queue = null;
let useRedis = !!process.env.REDIS_URL;

if (useRedis) {
  const { Queue } = require('bullmq');
  const IORedis = require('ioredis');
  const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  queue = new Queue(QUEUE_NAME, { connection });
}

// --- In-process fallback: serial, so we never blow the SE Ranking rate limit.
const localQueue = [];
let draining = false;

async function drain() {
  if (draining) return;
  draining = true;
  while (localQueue.length) {
    const id = localQueue.shift();
    try {
      const { runReport } = require('./jobs/runReport');
      await runReport(id);
    } catch (e) {
      console.error('[queue] job failed:', id, e.message);
    }
  }
  draining = false;
}

async function enqueueReport(reportId) {
  if (useRedis) {
    await queue.add('generate', { reportId }, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 10000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    });
    return;
  }
  localQueue.push(reportId);
  setImmediate(drain);
}

module.exports = { enqueueReport, QUEUE_NAME, useRedis };

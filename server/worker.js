/**
 * Standalone worker. Run only when REDIS_URL is set:
 *    node server/worker.js
 * Concurrency is 2: SE Ranking allows 5 req/sec and each report is chatty.
 */
require('dotenv').config();
const { initDb } = require('./models');
const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const { runReport } = require('./jobs/runReport');
const { QUEUE_NAME } = require('./queue');

if (!process.env.REDIS_URL) {
  console.error('REDIS_URL is not set. The API runs jobs in-process; no worker needed.');
  process.exit(1);
}

initDb({ sync: false }).then(() => {
  const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  const worker = new Worker(QUEUE_NAME, async (job) => runReport(job.data.reportId), {
    connection, concurrency: 2,
  });
  worker.on('completed', (job) => console.log('[worker] done', job.data.reportId));
  worker.on('failed', (job, err) => console.error('[worker] failed', job && job.data.reportId, err.message));
  console.log('Worker ready.');
});

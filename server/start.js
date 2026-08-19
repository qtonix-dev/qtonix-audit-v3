/**
 * Production launcher.
 *
 * Always starts the web server (server/index.js). When REDIS_URL is set, it
 * ALSO starts the report worker (server/worker.js) in the same container as a
 * child process, so report generation runs out-of-band without you having to
 * stand up a second Railway service.
 *
 * Why this exists: with Redis configured, the API only ENQUEUES report jobs —
 * something has to CONSUME them. Running the worker here keeps the deploy to a
 * single service while still moving the heavy audit work off the web process's
 * event loop (the cause of the AI-brief / report slowdowns under load).
 *
 * If you later prefer a dedicated worker service on Railway, set
 * RUN_WORKER=false on the web service and run `npm run worker` on the other.
 */
const { spawn } = require('child_process');
const path = require('path');

const hasRedis = !!process.env.REDIS_URL;
// Explicit override: RUN_WORKER=false disables the embedded worker even when
// REDIS_URL is present (use this if you run a separate worker service).
const runWorkerFlag = String(process.env.RUN_WORKER || '').toLowerCase();
const embedWorker = hasRedis && runWorkerFlag !== 'false' && runWorkerFlag !== '0' && runWorkerFlag !== 'no';

// --- Start the web server in-process. It owns the HTTP port and DB schema sync.
require(path.join(__dirname, 'index.js'));

if (embedWorker) {
  console.log('[start] REDIS_URL detected — launching embedded report worker.');
  const startWorker = () => {
    const child = spawn(process.execPath, [path.join(__dirname, 'worker.js')], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code, signal) => {
      console.error(`[start] worker exited (code=${code}, signal=${signal}). Restarting in 5s…`);
      // Keep the web server alive regardless; just respawn the worker.
      setTimeout(startWorker, 5000);
    });
    child.on('error', (err) => {
      console.error('[start] failed to spawn worker:', err.message);
    });
  };
  // Give the web server a head start so it finishes the boot-time schema sync
  // (the worker itself runs initDb with sync:false and only needs the tables to
  // already exist). This avoids a first-deploy race on a cold database.
  const delayMs = Number(process.env.WORKER_START_DELAY_MS || 20000);
  setTimeout(startWorker, delayMs);
} else if (hasRedis) {
  console.log('[start] REDIS_URL set but RUN_WORKER is disabled — not starting an embedded worker.');
} else {
  console.log('[start] No REDIS_URL — reports run in-process (single-service mode).');
}

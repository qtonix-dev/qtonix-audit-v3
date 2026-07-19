/** PM2 config. Use the worker only if REDIS_URL is set. */
module.exports = {
  apps: [
    {
      name: 'qtonix-audit-api',
      script: 'server/index.js',
      instances: 1,           // single instance: the in-process queue is not cluster-safe
      env: { NODE_ENV: 'production' },
      max_memory_restart: '600M',
    },
    {
      name: 'qtonix-audit-worker',
      script: 'server/worker.js',
      instances: 1,
      env: { NODE_ENV: 'production' },
      max_memory_restart: '1G',
      autorestart: true,
    },
  ],
};

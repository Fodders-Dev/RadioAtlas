const { join } = require('node:path');

module.exports = {
  apps: [
    {
      name: 'radioatlas-api',
      cwd: join(__dirname, 'apps/api'),
      script: 'dist/index.js',
      interpreter: 'node',
      exp_backoff_restart_delay: 2000,
      kill_timeout: 5000,
      listen_timeout: 10000,
      max_memory_restart: '512M',
      min_uptime: '10s',
      restart_delay: 2000,
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      }
    },
    {
      name: 'radioatlas-bot',
      cwd: join(__dirname, 'apps/bot'),
      script: 'dist/index.js',
      interpreter: 'node',
      exp_backoff_restart_delay: 2000,
      kill_timeout: 5000,
      min_uptime: '10s',
      restart_delay: 2000,
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      // station-intelligence metadata harvester — a SCHEDULED ONE-SHOT (cron),
      // NOT a resident process: cron_restart fires it on a schedule, it runs once
      // and exits (autorestart:false), pm2 waits for the next tick. GATED OFF —
      // HARVESTER_ENABLED:'0' below means merge+deploy is INERT (the script
      // no-ops and exits). Artem flips it to '1' + restarts to activate.
      //
      // cwd = apps/api so the script's `import 'dotenv/config'` loads the deployed
      // shared api.env (STATION_INTEL_DB_PATH). The script + its intel imports use
      // absolute / file-relative paths, so cwd doesn't affect resolution. It runs
      // under tsx (`node --import tsx`) because the intel modules are TS and not
      // part of the api's bundled dist; tsx is present after `npm ci`.
      name: 'radioatlas-harvester',
      cwd: join(__dirname, 'apps/api'),
      script: join(__dirname, 'scripts/harvestMetadata.mjs'),
      interpreter: 'node',
      interpreter_args: '--import tsx',
      autorestart: false,
      cron_restart: '7 * * * *', // hourly, off the top of the hour
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
        HARVESTER_ENABLED: '1', // <-- flip to '1' to activate (then pm2 restart)
        HARVEST_ORDER: 'stale',
        HARVEST_LIMIT: '200',
        HARVEST_CONCURRENCY: '2',
        HARVEST_PAUSE_MS: '500',
        HARVEST_MIN_INTERVAL_MS: '300',
        API_BASE: 'http://localhost:3001'
      }
    }
  ]
};

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
      // 512M was too tight for the /ai/chat working set: one Лира turn grows the
      // heap ~+77M (catalog/DeepSeek buffers), and a small burst of concurrent
      // chats spiked past 512M before GC ran → pm2 gracefully restarted the api
      // mid-request → Caddy saw EOF → intermittent 502s (~1/3 on heavy queries).
      // Not a leak (heap plateaus at ~373M one-at-a-time). The box has ~2GB free,
      // so give node room to GC under burst before pm2 trips. (task_25d9a620)
      max_memory_restart: '896M',
      // Make V8 COLLECT rather than grow. pm2 watches RSS; this bounds the old
      // space, and the gap between them (~90MB of code, stacks and
      // fragmentation, measured) is why the two numbers are not interchangeable
      // — sizing this from RSS is how you turn a graceful pm2 restart into a
      // fatal OOM.
      //
      // Measured against a real catalogue refresh, the process's heaviest
      // moment (2026-08-16, 62 423 stations, 71s refetch):
      //   default   rss 557MB  heapUsed 352MB  heapTotal 468MB
      //   640MB     rss 479MB  heapUsed 278MB  heapTotal 394MB, refresh fine
      // The cap is not even reached — 394 of 640 — so it changes V8's growth
      // policy rather than squeezing the working set, and it still leaves the
      // ~165MB of RSS headroom under max_memory_restart that a Лира turn (+67MB)
      // or a harvester tick (+42MB) needs.
      //
      // Why it is here at all: without it the process climbed to 959MB and pm2
      // killed it (2026-08-16 16:00), taking Home/Search/Browse down with it for
      // a minute — the catalogue endpoints queue behind a refresh.
      node_args: '--max-old-space-size=640',
      // 01:00 UTC = 04:00 Moscow, the quietest hour this product has.
      //
      // This is a MITIGATION, not a cure, and it is here because the note above
      // ("Not a leak — heap plateaus at ~373M") does not hold at a longer
      // horizon. Measured on production 2026-08-23, same process, two ages:
      //
      //             2h old            19h old
      //   rss       361 MB            689 MB
      //   heapUsed  157 MB            413 MB
      //   external   30 MB            194 MB
      //
      // About +19 MB of RSS an hour, seventeen hours running, with no plateau in
      // sight, and a restart returns it to 157 MB. The catalogue is NOT the
      // cause: one parsed copy of 62 870 stations measures 119 MB, which is
      // what the fresh heap already is. The cause is not yet found.
      //
      // Left alone, the process climbs until max_memory_restart reaps it at
      // 896 MB — six times in the pm2 log so far — at whatever hour it happens
      // to reach it, which is as likely to be evening as night. This makes that
      // moment predictable and cheap instead of random, and keeps our footprint
      // near 400 MB on a 3.9 GB box we share with other people's services.
      //
      // Delete it the day the growth is found and fixed, not before.
      cron_restart: '0 1 * * *',
      min_uptime: '10s',
      restart_delay: 2000,
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        // PERSISTENT metrics OUTSIDE the release dir, for the same reason as
        // STATION_INTEL_DB_PATH below. The default store path resolves next to
        // apps/api/dist, i.e. inside /opt/RadioAtlas/releases/<sha>/ - so every
        // deploy started an EMPTY store and prune_old_releases deleted the old
        // ones. Checked on 2026-08-15: three live release dirs held three
        // disjoint stores, and `ai_agent_run:*` / `ai_model_error:*` existed in
        // exactly one of them, which makes "watch the AI counters" impossible.
        OBSERVABILITY_STORE_PATH: '/opt/RadioAtlas/shared/data/observability/metrics.json',
        // Same reason again: the fallback catalogue snapshot defaults to
        // apps/api/data/, which on this box is inside the release directory, so
        // every deploy threw away the freshest copy of the catalogue and left
        // only the bundled artifact to fall back on.
        CATALOG_DATA_DIR: '/opt/RadioAtlas/shared/data/catalog'
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
        API_BASE: 'http://localhost:3001',
        // PERSISTENT db OUTSIDE the release dir — survives deploys + prune_old_releases.
        // Without this the harvester defaults to a release-relative path
        // (apps/api/data/station-intelligence.sqlite) recreated EMPTY on every
        // deploy → all accumulated coverage resets. shared/data persists.
        STATION_INTEL_DB_PATH: '/opt/RadioAtlas/shared/data/station-intelligence.sqlite'
      }
    }
  ]
};

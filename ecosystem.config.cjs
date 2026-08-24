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
      // CORRECTION, and it corrects THIS comment as first written. It claimed the
      // note above ("Not a leak — heap plateaus at ~373M") no longer held, on the
      // strength of two production samples at 2 h and 19 h of uptime. A 25-point
      // series taken the next day says the opposite, and the older note was right:
      //
      //   rss        oscillates 351-485 MB and comes back down on its own
      //              (484 flat for 40 min, then 372, then 366 flat for an hour)
      //   heapUsed   oscillates 156-185 MB, creeping ~2.4 MB/h
      //   external   steps up early — 27.6, 41.4, 50.4, 64.3 over four hours —
      //              and then PLATEAUS: 64.96 at seven hours
      //
      // So the working set saturates, exactly as the note above says. The 19 h
      // sample that looked alarming (689/413/194) came from a process that had
      // lived through a nightly scene batch and real traffic; a quiet one settles
      // near 400 MB RSS with external around 65 MB.
      //
      // The restart stays anyway, and the reason is smaller but still real: on a
      // 3.9 GB box shared with other people's services, our saturation point is
      // the largest single process on it, and `max_memory_restart` has reaped us
      // six times at 896 MB — at whatever hour we happened to get there. This
      // makes that moment predictable and cheap rather than random, at the cost
      // of two seconds of downtime when nobody is listening.
      //
      // What is NOT the cause, each ruled out by measurement: the catalogue (one
      // parsed copy of 62 870 stations is 119 MB, which is what a fresh heap
      // already is), the second profiled cache copy (a shallow spread shares the
      // strings — 11 MB), retained serialized payloads (no such cache exists),
      // the SQLite page cache (no cache_size pragma anywhere, the DB is 18 MB),
      // socket descriptors (196 orphaned at 4 h28, 195 at 6 h54 — a stable pool,
      // not a leak) and CPU (0.24%).
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

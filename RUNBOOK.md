# RUNBOOK

## Dev
```bash
npm install
npm run dev:webapp
npm run dev:bot
```

Use Node.js 24+ and npm 10+. The API account and station-intelligence stores use
`node:sqlite`, so older Node runtimes are not supported.

## Bot env
- `BOT_TOKEN`: Telegram bot token
- `WEBAPP_URL`: public webapp URL
- `API_URL`: API base used by the bot for billing, reachability, and AI calls. In production use the canonical URL `https://radioatlas.ru/api`, not a redirected alias such as `https://radioatlas.duckdns.org/api`.
- `WEBAPP_DEEPLINK`: optional deep link
- `INTERNAL_WEBHOOK_TOKEN`: shared secret used as the `X-Internal-Token` header on the bot → API billing webhook forward. Must match the API's `INTERNAL_WEBHOOK_TOKEN` exactly. Generate with `openssl rand -hex 32`. If unset, the bot logs a warning at startup and still **always replies** to the user with the T0.2b apology copy (rather than silent disappointment) — the forward itself is skipped.
- `AI_ENABLED`: set to `1` only when the API process also has `AI_ENABLED=1` and `DEEPSEEK_API_KEY` set. If bot AI is enabled while the API AI endpoint is missing or unreachable, private text messages degrade to the warm fallback.
- `SUPPORT_HANDLE`: where users are directed when a billing webhook forward fails or the bot env is misconfigured (T0.2b apology copy). Format is a Telegram handle like `@ahjkuio` (the default fallback) — switch to `@radioatlas_support` once that account is live. Each failure path also emits a single-line JSON stderr log: `event: 'billing_webhook_forward_skipped' | 'billing_webhook_forward_failed' | 'billing_webhook_succeeded_no_keyboard'`, `reason: 'empty-payload' | 'api-url-missing' | 'env-missing' | 'network' | 'http-<status>' | 'webapp-url-missing'`, plus `purchaseId`, `chargeId`, and on `reason: 'network'` an `error` string (extracted via `error.message`, since `JSON.stringify(new Error('x'))` is `'{}'`).

## API env
- `INTERNAL_WEBHOOK_TOKEN`: shared secret required on `POST /billing/telegram/webhook`. Requests without `X-Internal-Token` or with a mismatched value get 401. If the env is empty the route rejects every call (fail-closed). Must match the bot's `INTERNAL_WEBHOOK_TOKEN` exactly.
- `AI_ENABLED` + `DEEPSEEK_API_KEY`: enable the Mini App `/ai/chat` and internal `/internal/bot/ai-chat` endpoints. `AI_ENABLED=1` without a key leaves AI disabled and the bot should not be deployed with `AI_ENABLED=1` in that state.
- `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`, `AI_MAX_OUTPUT_TOKENS`, `AI_TIMEOUT_SEC`: optional AI runtime tuning.
- `AI_WEB_SEARCH_ENABLED` + `TAVILY_API_KEY`: optional grounded web search for factual questions; required for sourced song-creation context, documented author intent, and resolving a direct lyrics page. Without it Lira still offers a safe external lyrics search link and may interpret supplied text/metadata, but must not invent factual history.
- `BILLING_RECONCILE_ENABLED`: T0.2c reconcile sweep toggle. Defaults to enabled. Set to `0` in tests/CI (or for emergency stop) to keep the in-process `setInterval` from firing real `getStarTransactions` calls; the `/test/billing/trigger-reconcile` fixture endpoint stays available regardless and runs a single sweep cycle synchronously. Sweep needs `TELEGRAM_BOT_TOKEN`/`BOT_TOKEN` (already used by the invoice flow) — boot logs a warning and skips the sweep if the env is missing. Assumes single API instance; PM2 cluster mode would need a DB-side lease (see `billingReconciliation.ts` header). The sweep emits these structured stderr log events: `billing_reconcile_dead_letter` (`{purchaseId, attempts, lastError}` — fires once per row when `reconcile_attempts` crosses 4→5), `billing_reconcile_telegram_fetch_failed` (Telegram API outage, this tick skipped, no row state mutated), `billing_reconcile_grant_failed` (in-process `confirmBillingPurchase` threw — rare, row still attempts++ on next tick), `billing_reconcile_tick_crashed` (defensive catch around the whole tick — should never fire, indicates a bug).
- `ALLOWED_ORIGINS`: comma-separated allow-list of origins permitted to read the API cross-origin (exact match, case-insensitive on scheme+host). Required in production - the API process exits non-zero on boot if `NODE_ENV=production` and this is empty. In dev (any other `NODE_ENV`) it falls back to `http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174`. The production value at the time of writing is:
  ```
  ALLOWED_ORIGINS=https://radioatlas.duckdns.org,https://web.telegram.org,https://k.telegram.org,https://a.telegram.org,https://z.telegram.org
  ```
  Requests with no `Origin` header (curl, server-to-server, liveness probes) pass through with no CORS headers attached. Browsers receiving a response without `Access-Control-Allow-Origin` for a non-allow-listed origin will refuse the response automatically; the API does **not** 403 on a mismatched origin so that legitimate same-origin POSTs that happen to include an `Origin` header are not broken.
- `NODE_ENV`: set to `production` on every production deploy. Drives the `ALLOWED_ORIGINS` requirement above (and future production-only guards).
- `SCENE_ARTWORK_ENABLED`: optional cached station-atmosphere generator. Keep `0`
  until the Cloudflare account and token below are configured. Public web clients
  can only read cached scenes; they cannot start generation.
- `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`: Cloudflare Workers AI REST
  credentials for `@cf/black-forest-labs/flux-2-klein-4b`. The token needs only
  Workers AI Read and Edit permissions and must never use a `VITE_*` name.
- `SCENE_ARTWORK_DIR`: persistent absolute cache directory. Production should use
  `/opt/RadioAtlas/shared/scene-artwork`; do not store generated files inside a
  release directory because old releases are pruned.
- `SCENE_ARTWORK_DAILY_CAP`, `SCENE_ARTWORK_CONCURRENCY`,
  `SCENE_ARTWORK_QUEUE_MAX`, `SCENE_ARTWORK_STYLE_VERSION`: optional safety and
  cache-version controls. Defaults are deliberately conservative for the free
  Workers AI daily allowance.

### Test fixtures
`ENABLE_TEST_AUTH_FIXTURES=1` exists only for dev / CI / contract tests. It MUST NOT be set in production:
- The API process **refuses to boot** when `NODE_ENV=production` and `ENABLE_TEST_AUTH_FIXTURES=1` (boot assertion in `apps/api/src/index.ts`, fail-closed with exit 1 + fatal stderr).
- As defence-in-depth, `registerAuthRoutes` and `registerBillingRoutes` **also refuse to register the `/test/*` surfaces** if a caller bypasses the boot assertion and wires them with `nodeEnv: 'production'`. They log a fatal "test fixtures attempted to wire in production - refusing" line and skip the block; the rest of the API keeps serving traffic.
- When `NODE_ENV=production` and `ENABLE_TEST_AUTH_FIXTURES` is unset (the correct prod posture) the `/test/*` routes are simply **not registered** - hitting any of them returns 404.

Gated endpoints behind the flag (every one of these mints state on the live store and would let an unauthenticated caller forge sessions / flip billing if exposed):
- `POST /test/auth/seed-conflict`     — seed a current+incoming account pair and return a session token.
- `POST /test/auth/issue-session`     — mint a fresh session token for an arbitrary accountId.
- `POST /test/auth/expire-session`    — force a session row's `expires_at` into the past.
- `POST /test/auth/inspect-session`   — read `{ exists, expiresAt, accountId }` for a token.
- `POST /test/billing/seed-purchase`  — create a pending billing purchase row for an accountId (bypasses the Telegram round-trip used by `/billing/telegram/create-invoice`).

Additionally, `apps/api/src/googleAuth.ts` and `apps/api/src/vkAuth.ts` short-circuit their `fixture-google:` / `fixture-vk:` credential decoders on the same env var so the contract test credentials cannot be forged against a production deploy.

## Webapp env
- `VITE_TG_BOT`: bot username used to build share deep links
- `VITE_API_URL`: optional API base for catalog/proxy (empty by default)
- `VITE_AI_ENABLED`: Lira navigation flag. Vite dev defaults it on unless explicitly set to `0`; production requires `1`. Replies additionally require API `AI_ENABLED=1` plus `DEEPSEEK_API_KEY`.
- `VITE_GLOBE_SATELLITE_TILE_URL`: optional satellite tile template for close Globe zoom (`{z}/{x}/{y}` placeholders). Defaults to Esri World Imagery; leave empty only if you want the bundled Blue Marble fallback at every zoom level.

For local browser QA, run `npm run dev:webapp` and `npm run dev:api` in separate
terminals. If only Vite is running, `/api/image` proxy `ECONNREFUSED` messages are
expected; they do not mean the webapp command was wrong.

Lira song QA:
- With a known current track, ask «что сейчас играет?» in ordinary chat text:
  the Mini App must send bounded `track + stationName` context to `/ai/chat` and
  Lira must answer from it without a model call. When metadata is missing, she
  may name the active station but must not invent a track.
- Close and reopen Lira from the central navigation action, then reload the app:
  the same single local thread must return. Clearing it requires confirmation.
- Ask «включи The Weeknd»: the exact `Exclusively The Weeknd` catalog card must
  lead; a generic pop slate must not replace it.
- Ask for lyrics only: expect no full lyrics, an external source link, and no station cards.
- Ask about meaning: with Tavily enabled, expect a lyrics-content search before
  the meaning/context search, one short excerpt at most, and a full-text source
  button. Cleaned page text is model context only and is never returned wholesale.
- Ask about meaning and creation context: sourced facts stay distinct from interpretation.
- Paste lyrics for analysis: the reply may analyze them but must not echo long passages.
- Disable Tavily: expect an honest grounding limitation, not invented history.

Lyrics-content retrieval uses Tavily `include_raw_content: text` only on the
deterministic lyrics-analysis query. It consumes more provider credits than the
ordinary snippet path; keep the existing daily cap conservative and use a
licensed lyrics-display provider before ever rendering complete lyrics in-app.

## Deep link
- Share links use `startapp=station_<uuid>`; webapp auto-plays if station exists.

## Audio troubleshooting
- If stream fails, confirm `https://` and test with browser.
- For HLS streams, ensure `hls.js` loads (check console).
- Globe QA: dragging/settling may select a preview but must not switch audio; use a direct point tap or the visible Play action to tune.
- Feed QA: opening Feed while a station is already current must not auto-switch it; the active card play/pause control owns manual transport.
- Dock QA: collapse to the one-row live controller, open/close Full Player, and confirm the collapsed presentation is restored.
- Telegram WebView may block mixed content; keep https-only or add proxy.
- Track metadata is best-effort and depends on CORS/ICY support.
- Heavy metadata/fetch probing is protected server-side with rate limiting, in-flight dedupe, caching, and shared concurrency caps.
- Runtime gauges and latency percentiles are exposed at `/observability` and `/observability/prometheus`.

## User data
- Favorites + recently played are stored in browser localStorage per device.
- Copied track history is stored in localStorage per device.
- Theme Studio themes are stored locally in browser storage.
- The `?winamp=1` easter-egg/debug path is decorative Lite/Winamp only; it does not support Skin Lab or `.wsz` imports.

## Cache
- Client catalog responses use an IndexedDB TTL cache with localStorage fallback; Home summary TTL is 6 hours.
- Clear cache via Settings screen.
- The webapp build embeds a compact 32-station Home bootstrap derived from
  `artifacts/catalog-fast.json`; it renders before IndexedDB/API revalidation.
- The larger direct-Radio-Browser fallback stays lazy and is cached separately.
- Refresh catalog artifacts with `npm run catalog:update`.

## Legacy Lite/Winamp easter egg
- The main player uses the native RadioAtlas Full Player overlay.
- The legacy Lite/Winamp path is decorative only and can be opened with `?winamp=1` or the R++ brand gesture.
- Skin Lab and `.wsz`/`.zip` skin imports are removed from the runtime.

## Deploy (Telegram Mini App)
1. Host `apps/webapp` on HTTPS (Vercel recommended).
2. Create a bot via BotFather and set Web App URL (Menu Button).
3. Set `BOT_TOKEN` + `WEBAPP_URL` in `apps/bot/.env`.
4. Set `VITE_TG_BOT` in `apps/webapp/.env` and redeploy.

## Deploy (VPS)
1. Install Node 24+, Caddy, and Python 3.
2. Build webapp:
   ```bash
   npm install
   npm --workspace apps/webapp run build
   ```
3. Serve `apps/webapp/dist` with Caddy (the production edge); Caddy also reverse-proxies `/api` -> `127.0.0.1:3001`.
   `deploy/radioatlas.nginx.conf` is kept only as a reference for the `/api` proxy + gzip settings (nginx is not in the serving path).
4. If the old `radioatlas-static` service exists from a previous setup, retire it:
   ```bash
   bash /opt/RadioAtlas/current/deploy/server/install-radioatlas-static-origin.sh
   ```
5. Run bot:
   - `apps/bot/.env`: `BOT_TOKEN`, `WEBAPP_URL=https://your-domain`
   - use systemd or pm2 to keep it alive.
6. BotFather: set Web App URL to `https://your-domain`.

## Deploy (GitHub Actions -> VPS)
1. Add GitHub Actions secrets:
   - `SERVER_HOST`
   - `SERVER_USER`
   - `SERVER_SSH_KEY`
2. On the server, run `deploy/bootstrap-server.sh` once.
3. Fill or verify:
   - `/opt/RadioAtlas/shared/env/bot.env`
   - `/opt/RadioAtlas/shared/env/api.env`
   - `/opt/RadioAtlas/shared/env/webapp.env`
4. Push to the default branch (`master` right now; `main` is also supported by the workflow).

Deploy flow:
- Canonical workflow: `.github/workflows/deploy-server.yml`.
- GitHub Actions uploads the repository over SSH directly into `/opt/RadioAtlas/releases/<git_sha>`.
- The server runs `deploy/server/deploy-release.sh <git_sha>`.
- Shared env files from `/opt/RadioAtlas/shared/env` are copied into the release before build.
- `npm ci`, `npm --workspace apps/webapp run build`, `npm --workspace apps/api run build`, and `npm --workspace apps/bot run build` run on the server.
- The webapp build is pinned to the release SHA through `SOURCE_COMMIT=<git_sha>`.
  `deploy-release.sh` then requires at least one generated CSS asset ending in
  `-<short_sha>.css` before switching `/opt/RadioAtlas/current`. This prevents a
  stale VPS environment variable from reusing a one-year-immutable CSS URL.
- PM2 launches `apps/api/dist/index.js` and `apps/bot/dist/index.js` directly from the release workspace instead of routing through `npm --workspace`.
- `/opt/RadioAtlas/current` is switched to the new release after a successful build, then PM2 reloads from `ecosystem.config.cjs`.
- Deploy now waits for `http://127.0.0.1:3001/health` before reporting success, and dumps `pm2` status/logs if the API fails to come back.
- **T_audit_4 — external smoke**: after the SSH deploy returns, the workflow curls the **public** URL (`https://radioatlas.duckdns.org/api/health`) from the GH Actions runner with `--max-time 10 --retry 3 --retry-delay 5`. Non-2xx or a body missing `{ok:true}` **hard-fails** the job — this is the gate the 2026-05-27 incident bypassed (the in-script healthcheck hits `127.0.0.1:3001`, not the public Caddy edge). To run the same probe manually:
  ```
  curl -sS -o /tmp/smoke.json -w 'HTTP %{http_code}\n' --max-time 10 --retry 3 --retry-delay 5 https://radioatlas.duckdns.org/api/health && cat /tmp/smoke.json
  ```
  Expect `HTTP 200` + `{"ok":true}`.
- **T_audit_6 — chunk preservation**: `deploy-release.sh` rsyncs the previous release's `apps/webapp/dist/assets/*` into the new release additively (`rsync -a --ignore-existing`) before the symlink swap. Vite content-hashes chunks, so a deploy that rebuilds (say) `Home.tsx` would delete `Home-{oldHash}.js`; preserving it keeps every cached `index-*.js` resolvable for at least one more deploy. If a deeper chain still misses, the webapp's `ErrorBoundary` falls back to a single timestamp-guarded `location.reload()` (cooldown 10s — never loops on a genuinely broken build). Run `bash deploy/server/test-preserve-chunks.sh` to verify the rsync flags behave as expected (skips on hosts without `rsync`).
- After the release switch, Caddy serves the new `current/apps/webapp/dist` automatically: it resolves the `current` symlink per request, so no edge reload is needed. The deploy no longer touches nginx (T_infra_1).

## Incident capture
- Save current production logs and process state:
  - `bash /opt/RadioAtlas/current/deploy/server/capture-incident-artifacts.sh`
- Artifacts are stored under `/opt/RadioAtlas/shared/incidents/<timestamp>-radioatlas-incident`
- Saved data includes:
  - `journalctl -u caddy`
  - `pm2` logs and process list
  - `ss`, `ps`, `uptime`, `df`, `free`
  - parsed `remote_ip` / `user-agent` / `uri` summary for `radioatlas.duckdns.org`

## Health guard
- Install or refresh the automatic API health guard:
  - `bash /opt/RadioAtlas/current/deploy/server/install-health-guard.sh`
- This installs a `systemd` timer that checks `http://127.0.0.1:3001/health` every 2 minutes and restarts `radioatlas-api` through `pm2` if the API stops responding.

## Observability alerts
- Prometheus scrape target: `/observability/prometheus`
- Important gauges:
  - `runtime_process_cpu_percent`
  - `media_inflight_shared`
  - `media_inflight_metadata`
  - `media_inflight_fetch`
- Important counters:
  - `media_overload:*`
  - `media_rate_limit:*`
  - `error:GET:/metadata`
  - `error:GET:/fetch`

## API proxy (http streams + catalog)
1. Build and run:
   ```bash
   npm --workspace apps/api run build
   pm2 start /opt/RadioAtlas/apps/api/dist/index.js --name radioatlas-api --cwd /opt/RadioAtlas/apps/api
   ```
2. Caddy: reverse-proxy `/api` to `http://127.0.0.1:3001`.
3. Webapp env:
   - `VITE_API_URL=https://your-domain/api`
4. Runtime override:
   - Settings screen can override API base (saved to localStorage).

## Generated station atmosphere

Generation is an operator action, never a public browser action. Start the API
with scene artwork enabled, then seed a pack through the existing internal token:

```powershell
$env:RADIOATLAS_API_URL='http://127.0.0.1:3001'
$env:INTERNAL_WEBHOOK_TOKEN='same-value-as-apps-api-env'
npm run artwork:generate
```

Append one or more Radio Browser station UUIDs to generate only those scenes.
Without arguments the helper selects up to `SCENE_PACK_LIMIT` stations from the
catalog summary (default and hard maximum: 50). Stations sharing the same
country, vibe, and style version share one cached image. The current FLUX REST
endpoint returns JPEG despite its PNG schema, so the API validates both formats
and serves the byte-derived MIME type. Repeated app views do not consume Workers
AI quota.

Production deploys read `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` from
GitHub Actions secrets, write them only to `/opt/RadioAtlas/shared/env/api.env`,
and keep images in `/opt/RadioAtlas/shared/scene-artwork`. The deploy seeds at
most a small 16-station starter set while the persistent cache has fewer than
eight reusable `country + vibe` backgrounds; station logos are never replaced.

Operational checks:

- `GET /artwork/scene/:stationId` is read-only and returns scene status/URL.
- `POST /internal/artwork/scenes/generate` requires the exact
  `X-Internal-Token`; missing or wrong tokens fail closed.
- Keep `SCENE_ARTWORK_DAILY_CAP=60` and concurrency `1` for the initial free
  rollout. A failed provider request leaves the existing station artwork or
  procedural gradient intact.
- Changing the prompt art direction requires a new
  `SCENE_ARTWORK_STYLE_VERSION`; do not overwrite an approved visual pack in
  place.

## Extractor service (NewPipe-style, YouTube blocked)
1. Install Java 17 + Gradle.
2. Run:
   ```bash
   cd apps/extractor
   gradle run
   ```
3. API env:
   - `EXTRACTOR_URL=http://127.0.0.1:4001`
4. Webapp:
   - Search -> Links -> "Extract streams".

## Legacy debug tools
- Legacy webapp diagnostics scripts are stored in `tools/legacy-debug/webapp`.
- Run them from repo root, for example:
  - `node tools/legacy-debug/webapp/debug-icy.js`
  - `node tools/legacy-debug/webapp/check-top-radio.js`

## Auto-deploy to VPS (GitHub Actions)

This repo uses `.github/workflows/deploy-server.yml` as the single production deploy workflow for pushes to `master` or `main`.

### 1) Prepare server once
On VPS:
```bash
sudo bash /opt/RadioAtlas/current/deploy/server/bootstrap-server.sh
```

Create env files:
- `/opt/RadioAtlas/shared/env/api.env`
- `/opt/RadioAtlas/shared/env/bot.env`
- `/opt/RadioAtlas/shared/env/webapp.env`

Deploy script reads those files and injects them into each release before build.

### 2) Add GitHub secrets
In repo settings -> Secrets and variables -> Actions:
- `SERVER_HOST` (example: `212.69.84.167`)
- `SERVER_USER` (example: `root`)
- `SERVER_SSH_KEY` (private key matching a public key in `~/.ssh/authorized_keys` on server)

### 3) How release works
- Workflow uploads code to `/opt/RadioAtlas/releases/<git_sha>`
- Runs `deploy/server/deploy-release.sh <git_sha>` remotely
- Script runs `npm ci`, builds webapp/api/bot, switches `/opt/RadioAtlas/current` symlink, and verifies the local API health endpoint
- PM2 reloads services with the new release
- Keeps only last 5 releases

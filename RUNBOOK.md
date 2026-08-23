# RUNBOOK

## Dev
```bash
npm install
npm run dev:webapp
npm run dev:bot
```

Use Node.js 24+ and npm 10+. The API account and station-intelligence stores use
`node:sqlite`, so older Node runtimes are not supported.

## Node runtime on the VPS

Production runs **Node 24.19.0** (NodeSource apt, `node_24.x nodistro`) since
2026-08-15; it was 22.22.0 before. CI and `engines.node` track the same major on
purpose — a green gate on a runtime nobody runs proves less than it looks like.

The runtime is **shared with the neighbouring services on this box**, so an
upgrade is not a RadioAtlas-only decision. Who is affected:

- `rodnya-backend.service` and `rodnya-web-static.service` run `/usr/bin/node`
  directly and restart with it. Both are pure JS (no native modules), so a major
  bump is cheap — but they do need an explicit `systemctl restart`.
- FoddersGameBot runs under Docker Compose and uses its image's node. Unaffected.
- RadioAtlas's own native modules (`@resvg/resvg-js`, `lightningcss`, rollup,
  rolldown) are all N-API prebuilds and `npm ci` runs per deploy, so there is
  nothing to rebuild by hand.

Upgrade sequence that was actually used:

```bash
cp -a /etc/apt/sources.list.d/nodesource.list /root/nodesource.list.bak-$(date +%F-%H%M%S)
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main"   > /etc/apt/sources.list.d/nodesource.list
apt-get update && apt-get install -s -y nodejs   # dry run first: expect ONE Inst line
apt-get install -y nodejs
pm2 start /opt/RadioAtlas/current/ecosystem.config.cjs --update-env && pm2 save
systemctl restart rodnya-backend.service rodnya-web-static.service
```

⚠ **Do not use `pm2 update`.** It is the documented way to move the daemon onto
a new node, and on this box (pm2 6.0.14) it hung: it killed the God daemon and
every app, then never returned, leaving the API down and `:3001` refusing
connections. Recovery is to kill the stuck `pm2 update` process and start from
the ecosystem file, which is what the deploy script does anyway:

```bash
pkill -f "pm2 update"
pm2 start /opt/RadioAtlas/current/ecosystem.config.cjs --update-env
pm2 save
```

Verify the upgrade against all four surfaces, not just `/health`:

```bash
node -v && npm -v                                             # 24.x / 11.x
curl -sS http://127.0.0.1:3001/health                         # {"ok":true}
curl -sS -o /dev/null -w '%{http_code}
' http://127.0.0.1:8080/health   # rodnya backend
curl -sS -o /dev/null -w '%{http_code}
' http://127.0.0.1:8098/         # rodnya static
curl -sS -o /dev/null -D- http://127.0.0.1:3001/share/story/<uuid>.png | grep -i fallback
```

The story card is the one that matters most: an `x-radioatlas-fallback` header
means satori/resvg did NOT render and the native path is broken on the new
runtime. No header means it rendered live.

Rollback: restore the saved `nodesource.list`, `apt-get update`, then
`apt-get install -y --allow-downgrades nodejs=22.*`, and repeat the same restart
sequence.

## Bot env
- `BOT_TOKEN`: Telegram bot token
- `WEBAPP_URL`: public webapp URL
- `API_URL`: API base used by the bot for billing, reachability, and AI calls. In production use the canonical URL `https://radioatlas.ru/api`, not a redirected alias such as `https://radioatlas.duckdns.org/api`.
- `WEBAPP_DEEPLINK`: optional deep link
- `INTERNAL_WEBHOOK_TOKEN`: shared secret used as the `X-Internal-Token` header on the bot → API billing webhook forward. Must match the API's `INTERNAL_WEBHOOK_TOKEN` exactly. Generate with `openssl rand -hex 32`. If unset, the bot logs a warning at startup and still **always replies** to the user with the T0.2b apology copy (rather than silent disappointment) — the forward itself is skipped.
- `AI_ENABLED`: set to `1` only when the API process also has `AI_ENABLED=1` and the key selected by `AI_PROVIDER`. If bot AI is enabled while the API AI endpoint is missing or unreachable, private text messages degrade to the warm fallback.
- `SUPPORT_HANDLE`: where users are directed when a billing webhook forward fails or the bot env is misconfigured (T0.2b apology copy). Format is a Telegram handle like `@ahjkuio` (the default fallback) — switch to `@radioatlas_support` once that account is live. Each failure path also emits a single-line JSON stderr log: `event: 'billing_webhook_forward_skipped' | 'billing_webhook_forward_failed' | 'billing_webhook_succeeded_no_keyboard'`, `reason: 'empty-payload' | 'api-url-missing' | 'env-missing' | 'network' | 'http-<status>' | 'webapp-url-missing'`, plus `purchaseId`, `chargeId`, and on `reason: 'network'` an `error` string (extracted via `error.message`, since `JSON.stringify(new Error('x'))` is `'{}'`).

## API env
- `INTERNAL_WEBHOOK_TOKEN`: shared secret required on `POST /billing/telegram/webhook`. Requests without `X-Internal-Token` or with a mismatched value get 401. If the env is empty the route rejects every call (fail-closed). Must match the bot's `INTERNAL_WEBHOOK_TOKEN` exactly.
- `AI_ENABLED` + provider key: enable the Mini App `/ai/chat` and internal `/internal/bot/ai-chat` endpoints. `AI_PROVIDER=deepseek` (default) reads `DEEPSEEK_API_KEY`; `AI_PROVIDER=openai` reads `OPENAI_API_KEY`. A missing selected key leaves AI disabled.
- `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `AI_REASONING_EFFORT`, `AI_MAX_OUTPUT_TOKENS`, `AI_TIMEOUT_SEC`: optional model tuning. OpenAI defaults to `gpt-5.6-luna` through the Responses API. Keep DeepSeek as production default until the same representative Lira prompt set passes quality, latency, action-success, and token-cost comparison.
- `AI_WEB_SEARCH_ENABLED` + `TAVILY_API_KEY`: optional grounded web search for factual questions; required for sourced song-creation context, documented author intent, and resolving a direct lyrics page. Without it Lira still offers a safe external lyrics search link and may interpret supplied text/metadata, but must not invent factual history.
- `BILLING_RECONCILE_ENABLED`: T0.2c reconcile sweep toggle. Defaults to enabled. Set to `0` in tests/CI (or for emergency stop) to keep the in-process `setInterval` from firing real `getStarTransactions` calls; the `/test/billing/trigger-reconcile` fixture endpoint stays available regardless and runs a single sweep cycle synchronously. Sweep needs `TELEGRAM_BOT_TOKEN`/`BOT_TOKEN` (already used by the invoice flow) — boot logs a warning and skips the sweep if the env is missing. Assumes single API instance; PM2 cluster mode would need a DB-side lease (see `billingReconciliation.ts` header). The sweep emits these structured stderr log events: `billing_reconcile_dead_letter` (`{purchaseId, attempts, lastError}` — fires once per row when `reconcile_attempts` crosses 4→5), `billing_reconcile_telegram_fetch_failed` (Telegram API outage, this tick skipped, no row state mutated), `billing_reconcile_grant_failed` (in-process `confirmBillingPurchase` threw — rare, row still attempts++ on next tick), `billing_reconcile_tick_crashed` (defensive catch around the whole tick — should never fire, indicates a bug).
- `ALLOWED_ORIGINS`: comma-separated allow-list of origins permitted to read the API cross-origin (exact match, case-insensitive on scheme+host). Required in production - the API process exits non-zero on boot if `NODE_ENV=production` and this is empty. In dev (any other `NODE_ENV`) it falls back to `http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174`. The production value at the time of writing is:
  ```
  ALLOWED_ORIGINS=https://radioatlas.duckdns.org,https://web.telegram.org,https://k.telegram.org,https://a.telegram.org,https://z.telegram.org
  ```
  Requests with no `Origin` header (curl, server-to-server, liveness probes) pass through with no CORS headers attached. Browsers receiving a response without `Access-Control-Allow-Origin` for a non-allow-listed origin will refuse the response automatically; the API does **not** 403 on a mismatched origin so that legitimate same-origin POSTs that happen to include an `Origin` header are not broken.
- `NODE_ENV`: set to `production` on every production deploy. Drives the `ALLOWED_ORIGINS` requirement above (and future production-only guards).
- `CATALOG_CACHE_TTL_MS`: how long a fetched catalogue stays authoritative. Defaults to 6 hours. The rebuild is the API's memory high-water mark (292MB steady -> 789MB peak), so this is a memory knob as much as a freshness one; the web app caches its Home summary for 6h anyway. Minimum 60s.
- `CATALOG_DATA_DIR`: where the fallback catalogue snapshot is written. Production pins it to `/opt/RadioAtlas/shared/data/catalog`; the default resolves next to `apps/api/dist`, which on the VPS is inside the release directory, so every deploy discarded the freshest catalogue and left only the bundled artifact to fall back on. Tests point it at a temp directory — without it, the mirror-race integration test overwrites the developer's own 70MB snapshot with its two fixture stations.
- `OBSERVABILITY_STORE_PATH`: absolute path of the metrics file. Production pins it to `/opt/RadioAtlas/shared/data/observability/metrics.json` through `ecosystem.config.cjs`; leaving it unset resolves next to `apps/api/dist`, which on the VPS means inside the release directory and therefore wiped by the next deploy. See "Where the metrics live" below. `OBSERVABILITY_RETENTION_MS` (7 days) and `OBSERVABILITY_BACKUP_COUNT` (2) tune the same store.
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
- `VITE_AI_ENABLED`: Lira navigation flag. Vite dev defaults it on unless explicitly set to `0`; production requires `1`. Replies additionally require API `AI_ENABLED=1` plus the selected provider key.
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

Lira agent QA:
- With a station playing, ask «добавь текущую в очередь», repeat it, and confirm
  the first action appends once while the second is reported as already queued.
- Ask «добавь текущую в избранное», repeat it, then «убери текущую из
  избранного»; favorite state must be idempotent and match the last command.
- Ask «поставь на паузу» twice; playback pauses once and the second turn changes
  no state. Without an active station, queue/favorite commands return a bounded
  `needs_input` response.
- Inspect `/observability`: retained `agentRuns` include provider/model, route,
  status, steps, tool timings, verifier result, warnings, duration, and tokens.
- For a provider A/B, run the same prompt/locale/current-station fixtures once
  with `AI_PROVIDER=deepseek`, then with `AI_PROVIDER=openai`; do not compare
  unlike traffic or switch production from a single anecdotal answer.

### Dead-provider triage (model_error)

Every model failure degrades to a warm deterministic reply on purpose, so a
listener never sees an error — which means a dead provider is invisible unless
you look for it. Since 2026-08-14 the run carries the failure out:

- The agent run is recorded as `status: failed` with a `model_error:<kind>`
  warning. Kinds: `billing`, `auth`, `rate_limit`, `provider_unavailable`,
  `timeout`, `network`, `http`. A deliberately disabled model (`AI_ENABLED=0`
  or a missing key) is configuration, NOT a model error, and stays silent.
- Counters: `ai_model_error` and `ai_model_error:<provider>:<kind>`, visible in
  `/observability` and `/observability/prometheus`.
- `billing` and `auth` additionally raise an observability alert (and hit
  `OBSERVABILITY_ALERT_WEBHOOK` when configured), throttled to one alert per
  provider+kind per 15 minutes. The other kinds are counted, not alerted —
  they are expected to recover on their own.
- Alert on `ai_model_error:*:billing`, `ai_model_error:*:auth`, and on a
  sustained rise in `ai_agent_run:failed`. These counters are only meaningful
  because the store now survives a deploy — see "Where the metrics live".
  A window that shows `ai_chat_request` but no `ai_agent_run:*` at all means the
  process restarted, not that the runs vanished.
- `modelErrors` never reaches the browser; `/ai/chat` still returns only
  reply/stations/serviceLinks/sources/actions plus the bounded `run` object.

Check a provider balance directly (values are never printed, only status):

```bash
# DeepSeek — 402 "Insufficient Balance" is the 2026-08-14 production failure.
curl -sS https://api.deepseek.com/user/balance \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY"
```

Automated provider eval:
```bash
# No keys and no billable calls; validates fixtures, model names, and prices.
npm run eval:lira -- --dry-run

# With DEEPSEEK_API_KEY + OPENAI_API_KEY in apps/api/.env:
npm run eval:lira -- --provider=both --repeat=3 --out=artifacts/lira-provider-eval.json
```
The runner uses one fixed catalog and prompt suite, enforces action/station/
verifier limits, and records every reply for human quality review. Cost is an
uncached estimate. Price defaults can be overridden with
`LIRA_EVAL_{DEEPSEEK,OPENAI}_{INPUT,OUTPUT}_USD_PER_MTOK`; verify the linked
provider price pages before a production decision.

Lyrics-content retrieval uses Tavily `include_raw_content: text` only on the
deterministic lyrics-analysis query. It consumes more provider credits than the
ordinary snippet path; keep the existing daily cap conservative and use a
licensed lyrics-display provider before ever rendering complete lyrics in-app.

## Deep link
- Share links use `startapp=station_<uuid>`; webapp auto-plays if station exists.

## Running the E2E suite locally

Two failures here happen before a single spec runs, so they look like a broken
checkout rather than a broken environment. Both are environment.

### No browser is installed locally, and nothing but CI installs one

`npm run test:webapp` needs a browser binary, and nothing in this repository
downloads it for you. Neither `playwright` nor `@playwright/test` declares a
`postinstall`, so `npm ci` and `npm install` fetch the library and not the
browser. CI's `browser` job runs `npx playwright install --with-deps chromium`
itself, which is why it can run the suite on a bare runner and your checkout
cannot. Run the download once per Playwright revision — it is
pinned per version, not per machine, so a bump to `@playwright/test` (declared
`^1.47.2`, currently resolving to 1.57, which wants `chromium-1200`) re-raises
the same failure on a machine whose cache is full:

```bash
npx playwright install chromium
```

Without it the suite fails with `browserType.launch: Executable doesn't exist
at ...`. Chromium is sufficient: `apps/webapp/playwright.config.ts` declares no
`projects`, so the run never asks for Firefox or WebKit. Beware that a machine
which already has a Playwright cache from some other project — the MCP browser
tools populate one — passes this without the command, which is exactly how the
gap survived: it is invisible on every box that has already hit it elsewhere.

### `http://127.0.0.1:4311/health is already used`

`playwright.config.ts` spawns two servers of its own before testing: the API
through `npm --prefix ../api run serve:e2e` on port **4311**, and Vite on
`PLAYWRIGHT_WEBAPP_PORT` (default **5174**). Only the webapp port has an
environment override — the API port is a literal on line 6 of the config, so
there is no way to move the suite off 4311. `reuseExistingServer` is false
unless `PLAYWRIGHT_REUSE_SERVER=1`.

The abort is an HTTP probe, not a port check: Playwright GETs the configured
`url` and treats 2xx/3xx as "already used". So this exact message means another
**e2e API** is answering `/health`. Something else holding 4311 — anything not
speaking HTTP, or anything answering 404 there — produces no such message at
all; Playwright spawns its own API, which then dies on `EADDRINUSE` in the
server log. In the root `npm test` chain this lands last, after typecheck and
the api/bot/script suites have already passed, so what an orphan costs is the
final exit code and a minute, not the earlier results.

The usual culprit is an e2e API that outlived the run that spawned it.
`serve:e2e` is plain `tsx src/index.ts` with no watcher, so in a process list it
is indistinguishable from a dev API; the port is what identifies it, and
`curl http://127.0.0.1:4311/health` answering `{"ok":true}` when no suite is
running is the confirmation.

Find the owner and end it:

```bash
netstat -ano | grep :4311
```
```powershell
Get-NetTCPConnection -LocalPort 4311 -State Listen | ForEach-Object {
  Get-CimInstance Win32_Process -Filter "ProcessId = $($_.OwningProcess)" |
    Select-Object ProcessId, CreationDate, CommandLine
}
Stop-Process -Id <pid> -Force
```

Print the command line before killing anything: a bare PID in a section whose
premise is "you cannot tell these two apart" has you kill blind. The e2e API
reads `... tsx ... src/index.ts` with no `watch`; your own `npm run dev:api`
supervisor carries `watch` and sits on 3001.

The other escape is to let the suite attach to what is already there:

```bash
PLAYWRIGHT_REUSE_SERVER=1 npm run test:webapp
```

That is a diagnostic shortcut, not a fix, and it is the more dangerous of the
two. It attaches to whatever answers on 4311 and 5174 regardless of who started
it — an API from another worktree or another branch, serving a different account
store, a different observability store and a different catalogue than the config
would have handed a fresh server. (All three are pinned to temp paths by
`playwright.config.ts`; `CATALOG_DATA_DIR` only joined them on 2026-08-17, so
before that even a fresh e2e server was reading the developer's own snapshot.) A suite that passes that way has tested the
neighbouring checkout, which is how green results survive genuinely broken code.
Use it to iterate on a spec you are actively debugging, never to conclude that
the suite is green.

## Measuring geometry in an E2E test

`boundingBox()` returns the TRANSFORMED box. Any assertion about size or
position taken while a mount animation is in flight measures the animation, not
the product — and it only fails under parallel load, because contention decides
whether the round-trip lands inside the window.

The Feed is the sharp case: `.station-feed-overlay` animates from
`scale(0.965)` over 240ms, so a 44px control measures 42.46px and misses a
43.5px floor. Use the helper before measuring:

```ts
await waitForAnimationsToSettle(page, '.station-feed-overlay');
```

It waits only for FINITE animations — the Feed's live dot pulses forever, and
waiting on that hangs the test instead of fixing it.

Do not fix this class by loosening a threshold. The touch-target floor, the
no-overflow rule and the #86 never-auto-switch rule are product contracts; the
measurement is what was wrong, not the number.

The suite also runs the API through `apps/api`'s `serve:e2e` script, NOT `dev`.
`dev` is `tsx watch`: editing an API source while the suite runs restarts the
shared server mid-request and fails whichever specs are talking to it.

### Why `toBeVisible()` was not a gate

The failing test did wait — `await expect(page.locator('.station-feed-card-name')
.first()).toBeVisible()` — and it gated on nothing. That element is
`opacity: 0` until `[data-focus=true]`, and **Playwright counts an opacity-0
element as visible**: it checks display, visibility and a non-empty box. So the
wait resolved at the instant the overlay mounted, i.e. at t=0 of the animation.

The threshold arithmetic: the assertion passes only once the overlay's scale
reaches 43.5/44 = 0.98864, which on `cubic-bezier(0.22, 0.9, 0.24, 1)` is ~47ms
into the 240ms. A `toBeVisible()` on a fading-in element buys none of it.

### Three things not to reach for when this suite is red

- **`emulateMedia({ reducedMotion: 'reduce' })` or `animations: 'disabled'`** to
  settle geometry. Both work, and both quietly change the subject from "what a
  default-settings user gets" to "what a reduced-motion user gets". Wait for the
  animation instead.
- **Raising a tolerance** — `43.5` for the touch-target floor, `0.04` for the
  visual baselines, `toBeLessThanOrEqual(0)` for document overflow. These are the
  product contracts; the measurement is what was wrong, never the number.
- **`retries` in `playwright.config.ts`.** It would hide exactly the signal that
  made this diagnosable: a spec failing twice on the same line is a defect, and
  retries erase the difference between that and noise.

If a test ever needs Playwright's `page.clock`, install it AFTER boot, not
before `goto`: `clock.install()` fakes `requestIdleCallback`, which the app uses
to preload the playback runtime, so a pre-`goto` install deletes the code path
under test.

## Is a station's stream actually flaky?

`tools/probe-stream.mjs` reads a live stream and reports throughput plus every
gap in delivery, which answers the question a listener complaint cannot:

```bash
node tools/probe-stream.mjs "https://rr-00.hostingradio.ru/rr0096.aacp" 180 rodnye
node tools/probe-stream.mjs "http://127.0.0.1:3001/stream?url=<encoded>" 60 via-proxy
```

Run it on the VPS, not a laptop: a datacentre IP is what production actually
uses, and several hosts answer it differently (the probe sends a browser
User-Agent and follows redirects for that reason).

Read it like this, using the 2026-08-16 investigation of «Родные Нулевые» as the
worked example:

- **Throughput against the nominal bitrate** is the real health check. That
  station delivered 99 kbps against a declared 96 — no shortfall, nothing wrong.
- **Gaps are not automatically stalls.** It showed 27 gaps of 2-3s over three
  minutes and 95 over ten — every one of them between 2.0 and 3.3s, one every
  ~6 seconds: the server flushes in large blocks rather than streaming
  continuously. A flaky stream looks different: irregular gaps, and throughput
  that falls short of the nominal bitrate. A control station on the same box (TGRT FM) had none,
  so the pattern is that server's, not ours — and our `/stream` proxy reproduced
  it unchanged, adding nothing.
- A buffered `<audio>` element rides through a 3s delivery gap without
  `currentTime` ever going flat, so this cannot trip the 9s silent-stall
  watchdog. It does leave less margin on a mobile connection, which is the
  plausible reading of that listener's two genuine `audio_buffering_reconnect`
  events — as distinct from the four `audio_silent_stall` events, which were the
  watchdog bug fixed the same day.

## Audio troubleshooting
- If stream fails, confirm `https://` and test with browser.
- For HLS streams, ensure `hls.js` loads (check console).
- Globe QA: dragging/settling may select a preview but must not switch audio; use a direct point tap or the visible Play action to tune.
- Feed QA: opening Feed while a station is already current must not auto-switch it; the active card play/pause control owns manual transport.
- Dock QA: collapse to the one-row live controller, open/close Full Player, and confirm the collapsed presentation is restored.
- Telegram WebView may block mixed content; keep https-only or add proxy.
- Track metadata is best-effort and depends on CORS/ICY support.
- Silent-stall watchdog: it recovers a stream whose `currentTime` stays flat for
  9s while unpaused. It reads the position directly rather than trusting
  `timeupdate` delivery, because a backgrounded tab withholds those events while
  playback continues — before 2026-08-16 that made it tear down healthy streams
  the moment a listener returned to the app. `audio_silent_stall` climbing
  alongside `audio_visibility_change` is the signature of that class of bug.
- Heavy metadata/fetch probing is protected server-side with rate limiting, in-flight dedupe, caching, and shared concurrency caps.
- Runtime gauges and latency percentiles are exposed at `/observability` and `/observability/prometheus`.

## User data
- Favorites + recently played are stored in browser localStorage per device.
- Copied track history is stored in localStorage per device.
- Theme Studio themes are stored locally in browser storage.
- The `?winamp=1` easter-egg/debug path is decorative Lite/Winamp only; it does not support Skin Lab or `.wsz` imports.

## Writing a file the API cannot afford to lose

Three files here survive a restart and matter after it: the metrics store, the
fallback catalogue snapshot, and generated scene artwork. All three must be
written the same way, and `sceneArtwork.ts` has had it right all along:

```ts
const temporary = resolve(dir, `.${randomUUID()}.tmp`);
try {
  await writeFile(temporary, contents);
  await rename(temporary, target);      // atomic on POSIX
} catch (error) {
  await unlink(temporary).catch(() => {});
  throw error;
}
```

Every part earns its place, and two of them were learned the hard way on
2026-08-15:

- **rename, not writeFile.** A plain write is not atomic: a reader can see half
  a file, and a process killed mid-write leaves a truncated one. That is how the
  metrics store lost its history the first time.
- **A UNIQUE temp name.** A shared `<target>.tmp` collides as soon as two writes
  overlap — the first renames it away, the second fails `ENOENT`. It happened to
  the catalogue snapshot (fatal: the call sites are fire-and-forget, so the
  rejection killed the process) and then, hours later, to the metrics store.
- **Unlink on failure**, or a failed write leaves a stray file per attempt.
- **One writer at a time**, enforced inside the module. Debouncing the CALLER
  only spaces out when writes start, not how long they take.

## SQLite contention

`account-store.sqlite` has more than one opener: the API, a second API process
in any test or staging run, and the nightly backup unit that attaches to it at
04:20 UTC. It runs in WAL mode, but until 2026-08-15 it set no `busy_timeout`,
so a contended statement failed IMMEDIATELY with SQLITE_BUSY instead of waiting.

What that looks like from outside: `/catalog/summary` answering **502**, because
`listCatalogProfileOverrides` threw `database is locked` inside the profiled
catalogue build. In production that is a listener seeing a broken Home screen
because a backup happened to be running. It surfaced on CI, where two spawned
APIs shared one database file.

`PRAGMA busy_timeout = 5000` now matches what the station-intelligence store has
always had. Tests that spawn an API should also point `ACCOUNT_STORE_PATH` (and
`CATALOG_DATA_DIR`) at their own temp directory rather than sharing the
developer's.

## Backups

`account-store.sqlite` holds accounts, sessions, favourites, playlists, referrals,
the audit trail and Telegram Stars purchases. Until 2026-07-25 nothing backed it
up at all — the only systemd timers matching "backup" on that box belong to dpkg
and to two neighbouring projects.

**What runs now.** `radioatlas-sqlite-backup.timer`, nightly at 04:20 UTC, keeping
14 copies in `/opt/RadioAtlas/backups`. It uses `node:sqlite`'s `backup()` (the
online backup API) rather than `cp`, because the store is in WAL mode with a WAL
larger than the database, so a plain copy can capture a torn state. Every run
re-opens the snapshot it just wrote, runs `PRAGMA integrity_check`, and requires
the `accounts` table to be non-empty; a failure deletes the partial file and
exits non-zero, which shows up as a failed unit.

    systemctl status radioatlas-sqlite-backup.service
    journalctl -u radioatlas-sqlite-backup.service -n 20

**Restore.** Rehearsed on production data (18/18 tables, 6554/6554 rows,
0 differing) — do it the same way:

    gunzip -c /opt/RadioAtlas/backups/account-store-<stamp>.sqlite.gz > /tmp/restore.sqlite
    node -e 'const {DatabaseSync}=require("node:sqlite");
             const d=new DatabaseSync("/tmp/restore.sqlite",{readOnly:true});
             console.log(d.prepare("SELECT count(*) n FROM accounts").get());'
    # only once that looks right:
    pm2 stop radioatlas-api
    cp /tmp/restore.sqlite /opt/RadioAtlas/shared/data/account-store.sqlite
    rm -f /opt/RadioAtlas/shared/data/account-store.sqlite-wal           /opt/RadioAtlas/shared/data/account-store.sqlite-shm
    pm2 start radioatlas-api

Delete the stale `-wal`/`-shm` sidecars. Leaving them next to a restored database
is the classic way to lose the restore.

### Off-box replication — TODO, needs one manual step

Every copy currently lives on the same disk as its source, and `/opt` is at 92%.
The backup job prints a WARNING on every run until this is configured; that
warning is the reminder, do not silence it.

**Chosen destination: Cloudflare R2.** The account already exists (Workers AI
generates the scene backgrounds), a year of daily snapshots is ~1.31GB against a
10GB free tier, and R2 charges nothing for egress — which is exactly when you
need it. ⚠ The existing `CLOUDFLARE_API_TOKEN` is Workers-AI-scoped and returns
**403 on R2** (verified), so this needs its own token.

Owner steps (~2 minutes, must be done by a human — creating credentials is not
something the assistant does):

1. Cloudflare dashboard → R2 → create bucket `radioatlas-backups`, location
   automatic. Leave public access OFF.
2. R2 → Manage API tokens → Create API token.
   Permission **Object Read & Write**, scoped to that ONE bucket. No admin, no
   account-wide scope. Note the Access Key ID and Secret Access Key.
3. Append the two SECRET values to `/opt/RadioAtlas/shared/env/api.env` (this
   file is not in git). The account id defaults to the `CLOUDFLARE_ACCOUNT_ID`
   already in that file, and the bucket defaults to `radioatlas-backups`, so
   nothing else needs typing:

       R2_ACCESS_KEY_ID=<from step 2>
       R2_SECRET_ACCESS_KEY=<from step 2>

4. Verify: `systemctl start radioatlas-sqlite-backup.service` then
   `journalctl -u radioatlas-sqlite-backup.service -n 5`. Each line should end
   with `replicated <n>KB` instead of `not-configured`, and the WARNING should
   be gone.
5. Set a bucket lifecycle rule to expire objects after ~400 days, so the free
   tier is never the thing that breaks the backup.

The uploader is `deploy/server/s3put.mjs` — a dependency-free SigV4 PUT, since
the box has no rclone or aws-cli. Its signing is verified against AWS's own
published test vector in `s3put.test.mjs`, so the algorithm is known-good before
a real bucket exists; only the live credentials are untested.

## Cache
- Client catalog responses use an IndexedDB TTL cache with localStorage fallback; Home summary TTL is 6 hours.
- Clear cache via Settings screen.
<!-- Removed 2026-08-17: "The webapp build embeds a compact 32-station Home
     bootstrap derived from artifacts/catalog-fast.json". No such embed exists —
     no build step reads artifacts/, apps/webapp/public/ holds no station
     payload, and nothing in apps/webapp/src carries one. The line was written
     in July, three months after 271b38c deleted both the static file and the
     fetch that read it. It is left as a comment because this is the file
     CLAUDE.md tells you to read BEFORE diagnosing production, and a fabricated
     mechanism in it is worse than a gap. -->
- The larger direct-Radio-Browser fallback stays lazy and is cached separately.
- Refresh catalog artifacts with `npm run catalog:update`.
- `npm run geo:check` audits where the globe puts its dots: it runs the real
  `geoResolver.ts` over the whole dump with the state anchors the Globe builds,
  and fails if a synthesized dot lands in the wrong country, or if the artifact
  carries coordinates that are not coordinates (0,0 or out of range). Takes
  about 30s and reads `artifacts/catalog-full.json`; `CATALOG_PATH` points it
  at another dump.

## Legacy Lite/Winamp easter egg
- The main player uses the native RadioAtlas Full Player overlay.
- The legacy Lite/Winamp path is decorative only and can be opened with `?winamp=1` or the R++ brand gesture.
- Skin Lab and `.wsz`/`.zip` skin imports are removed from the runtime.

## Deploy (Telegram Mini App)
1. Host `apps/webapp` on HTTPS. Here that is the VPS in the next section,
   behind Caddy; a push to `master` is the deploy.
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
- Canonical workflow: `.github/workflows/deploy-server.yml`, and there is deliberately no second
  deploy config in the tree. A root `vercel.json` and an `apps/webapp/vercel.json` outlived the
  Vercel host they were written for and were deleted on 2026-08-17; the webapp one rewrote
  `/api/*` to `http://212.69.84.167:3001`, which stopped answering when the API moved to the
  loopback-only bind in `apps/api/src/index.ts` (still overridable with `API_BIND_HOST`, which
  nothing in the deploy sets). Caddy is the edge and `apps/webapp/src/lib/apiBase.ts` holds the
  canonical base. `deploy/post-deploy-smoke.sh` greps the served shell for a legacy Vercel origin
  and exits 1 on a hit, but nothing runs it: its only caller is a manual step in
  `deploy/OAUTH_SETUP.md`, and the workflow's own smoke is the inline `curl .../api/health`, which
  never fetches the shell. Recreate the Vercel files only alongside a Vercel workflow something
  actually runs.
- GitHub Actions uploads the repository over SSH directly into `/opt/RadioAtlas/releases/<git_sha>`.
- The server runs `deploy/server/deploy-release.sh <git_sha>`.
- Shared env files from `/opt/RadioAtlas/shared/env` are copied into the release before build.
- `npm ci`, `npm --workspace apps/webapp run build`, `npm --workspace apps/api run build`, and `npm --workspace apps/bot run build` run on the server.
- The webapp build is pinned to the release SHA through `SOURCE_COMMIT=<git_sha>`, which
  `apps/webapp/vite.config.ts` truncates to seven characters and compiles into the bundle as
  `__APP_COMMIT__`. `assert_webapp_build_provenance` in `deploy-release.sh` then greps the
  freshly built `dist/index.html` and `dist/assets` for that short SHA and aborts before
  switching `/opt/RadioAtlas/current` if it is missing. The hazard is real because the build
  runs on the VPS, whose own git checkout is frozen: without the check a release can be built
  from the wrong source and nothing downstream notices. This gate used to demand a CSS asset
  literally named `-<short_sha>.css`, which meant stamping the commit into asset filenames —
  and that rotated *every* chunk hash on *every* release (25 byte-identical 1MB maplibre
  copies piled up in one release's assets dir, and every listener re-downloaded the bundle
  after each deploy). The stamp is gone, the CSS hash is content-derived again, and the
  provenance grep guards the same hazard directly.
- PM2 launches `apps/api/dist/index.js` and `apps/bot/dist/index.js` directly from the release workspace instead of routing through `npm --workspace`.
- `/opt/RadioAtlas/current` is switched to the new release after a successful build, then PM2 reloads from `ecosystem.config.cjs`.
- Deploy now waits for `http://127.0.0.1:3001/health` before reporting success, and dumps `pm2` status/logs if the API fails to come back.
- **T_audit_4 — external smoke**: after the SSH deploy returns, the workflow curls the **public** URL (`https://radioatlas.ru/api/health`) from the GH Actions runner with `--max-time 10 --retry 3 --retry-delay 5`. Non-2xx or a body missing `{ok:true}` **hard-fails** the job — this is the gate the 2026-05-27 incident bypassed (the in-script healthcheck hits `127.0.0.1:3001`, not the public Caddy edge). It names the canonical host rather than the `radioatlas.duckdns.org` alias, and it must: the probe does not pass `--location`, so aiming it at a redirected alias would measure the redirect instead of the edge and fail the `!= 200` check on every deploy. To run the same probe manually:
  ```
  curl -sS -o /tmp/smoke.json -w 'HTTP %{http_code}\n' --max-time 10 --retry 3 --retry-delay 5 https://radioatlas.ru/api/health && cat /tmp/smoke.json
  ```
  Expect `HTTP 200` + `{"ok":true}`.
- **T_audit_6 — chunk preservation**: `deploy-release.sh` rsyncs the previous release's `apps/webapp/dist/assets/*` into the new release additively (`rsync -a --ignore-existing`) before the symlink swap. Vite content-hashes chunks, so a deploy that rebuilds (say) `Home.tsx` would delete `Home-{oldHash}.js`; preserving it keeps every cached `index-*.js` resolvable for at least one more deploy. It is additive but not unbounded: carried chunks older than `CHUNK_RETENTION_DAYS` (default **14**) are expired from the new release, which is safe because Caddy serves `index.html` as `no-store` — only a session that was already open across a deploy needs an old chunk, and those live hours. Without that expiry the carried assets compounded with the retired filename stamp into 661 files under 43 basenames in a single release. `npm run test:scripts` runs the rsync-flag test (it skips on hosts without `rsync`, so it proves something on Linux and CI, not on Windows).
- After the release switch, Caddy serves the new `current/apps/webapp/dist` automatically: it resolves the `current` symlink per request, so no edge reload is needed. The deploy no longer touches nginx (T_infra_1).

## 2026-08-17 — a deploy took 20 minutes and the site was unreachable for most of it

A push at 06:10 UTC took **20m44s** to deploy where every deploy before it took
about 1m10s, and for most of that window `https://radioatlas.ru/` timed out —
from the outside AND from the box itself. It was not a bad release: `current`
still pointed at the previous SHA the whole time, and the API answered
`http://127.0.0.1:3001/health` in **4ms** throughout. What was starved was the
edge, not the app.

What the box looked like during it:

```
load average: 10.7 → 14.8      (2 vCPU)
Mem: 3904 total, 127 free      Swap: 2047 total, 1610 used
vmstat: r=16-24, sy=69-71%, wa=0        # kernel time, not disk wait
rsync --server ... /opt/RadioAtlas/releases/<sha>/   ETIME 14:11
git-remote-https ... FoddersGameBot.git              # a NEIGHBOUR, mid-fetch
```

Two things had to line up. The push carried the nightly `chore: refresh catalog
artifacts` commit as well as its own, because that workflow's commit does not
trigger a deploy on its own — GitHub does not run workflows for pushes made with
`GITHUB_TOKEN` — so the first human push after it ships **both**. The deploy
rsync has no `--link-dest` and the release directory is created empty, so it
transfers the whole tree every time; with `artifacts/` changed that is about
107MB of JSON instead of a few hundred KB of delta. And a neighbouring service
happened to be fetching from GitHub at the same time on the same 2-core box.

Caddy stayed `active` and kept its listener on 443, but a request to it over
loopback timed out with zero bytes, which is what CPU starvation looks like from
the outside.

**What was changed afterwards, and what is still unproven.** The upload step now
passes `--link-dest` against `readlink -f current`, plus `--checksum` and
`--stats`. Two things were measured on the box before that shipped:

- `--link-dest` on its own would have linked NOTHING. rsync's quick check is
  size + mtime, and a git checkout stamps every file with the checkout time —
  `package.json` is byte-identical across two releases and its mtimes are nine
  minutes apart. `--checksum` is what makes the comparison real, and it is
  cheap: 0.107s to hash the 37MB catalogue, ~0.4s for the 132MB tree.
- Nothing can corrupt the previous release through it. rsync writes a changed
  file new and renames it, and every in-place write later in the deploy (`cp` of
  the env files, the `sed -i` on `apps/bot/.env`) targets a gitignored file that
  was never in the transfer.

Measured on the first deploy that used it, from `--stats`:

```
Number of regular files transferred: 3      (of 650)
Total file size: 89,304,773 bytes
sent 37,866 bytes  received 3,503 bytes     speedup 2,158
```

**It saves wire, not disk**, and that was not the intention going in: `-a`
preserves mtimes, a git checkout stamps every file with the checkout time, so
source and previous release always differ in a preserved attribute and rsync
copies from local disk instead of hard-linking. `stat -c %h` on the new release
is 1, and each release is still its own 132MB. Dropping `-t` would make it link;
untested, and 260MB is not worth another change to this path while the disk has
15GB free.

It is NOT proven to be the cure for the outage above: the evidence fits the
neighbour's concurrent fetch as well as it fits our payload, and the deploys
after it were back to about a minute either way. `--stats` is in the command so
the next slow deploy reports what it actually sent instead of leaving another
inference.

## 2026-08-19 — the site was down twice, for two different reasons, and nobody noticed

Two outages in one day, both invisible from inside the app, both found by
accident while doing unrelated work. This is the same family as the 2026-08-17
entry above: **the edge starved, not the app.** Three occurrences now.

**Morning, ~5 hours.** No TLS handshake completed — from outside AND from the box
on loopback — for our vhost and for a neighbour's on the same Caddy. Plain `:80`
answered in 8ms; our API answered `127.0.0.1:3001/health` in 18ms throughout. The
box had **135 MB free of 3904**, swap **1801/2047**, load average 8.9, and Caddy's
RSS had been squeezed to **12 MB**. The single largest process was ours:
`radioatlas-api` at **619 MB**, 5h uptime, no restarts. `pm2 restart
radioatlas-api` freed it (135 MB free to 1609, swap to 1555) and HTTPS returned
immediately with a 66ms handshake.

**Evening, again.** Same symptom, different cause, and this time NOT us. Memory
was fine — swap 896/2047 with 1151 MB free — but the box has **2 cores** and
`vmstat` reported **35% steal, sustained, with 0% idle**, system time above 40%.
squid and a neighbour's python were each burning ~50% CPU while our node sat at
**1% and answered in 6ms**. A TLS handshake is expensive arithmetic; with a third
of the CPU taken by the hypervisor and the rest contended, Caddy could not finish
one. Nothing in our code fixes that.

**Resolution.** The owner changed the server's IP (radioatlas.ru is now
77.67.89.164) and the VM landed on different hardware. Measured 3 hours later:
**steal 0%, idle 91-93%, load 0.18, swap 2 MB of 2047**, handshake 56ms from the
box and 0.79s from a Russian ISP. The move solved it; no tuning was needed.

**How to tell these apart quickly, because they look identical:**

    free -m                 # morning shape: free < 200 MB, swap near full
    vmstat 4 3              # evening shape: st ~35, id 0
    ps -eo rss,comm --sort=-rss | head    # who is actually biggest
    curl --resolve radioatlas.ru:443:127.0.0.1 https://radioatlas.ru/   # from the box

If memory is the shape and we are the biggest process, restarting our API is
correct and safe. If steal is the shape, it is the host, and neither restarting
nor `systemctl` on Caddy creates CPU — that one is an owner decision about where
the box lives. Never restart Caddy to "fix" it: it is shared with the
neighbours, and it was never the thing that was broken.

**Detection.** `.github/workflows/uptime.yml` now probes a full HTTPS request
from GitHub every 15 minutes and fails the job when the handshake does not
complete. It exists because ping, DNS and `http://` would each have reported
everything healthy for all five hours of the morning outage.

**Why the API process is often young.** `cron_restart: '0 1 * * *'` in
`ecosystem.config.cjs` restarts it daily at 01:00 UTC (04:00 Moscow). Measured
2026-08-23: RSS climbs about 19 MB an hour — 361 MB at two hours old, 689 MB at
nineteen, heap 157 to 413, external 30 to 194 — with no plateau, and a restart
returns it to the floor. Left alone it reaches `max_memory_restart` (896 MB) and
pm2 reaps it at whatever hour that happens to be. The scheduled restart makes
that moment predictable instead of random; it is NOT a fix, and the cause of the
growth is still open. A process with a few hours of uptime around 01:00 UTC is
therefore expected, not a symptom.

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

## Station metadata harvester

A pm2 cron one-shot (`radioatlas-harvester`, hourly at :07, `autorestart:false`)
that probes stations through our own `/metadata` and records observed tracks and
artists into `station-intelligence.sqlite`. It feeds Lira's recent-track/top-
artist enrichment and the generated-scene prompts. Between ticks pm2 shows it as
`stopped` with pid 0 — that is normal for a cron app, not a fault.

Read a run from the `done:` line in `radioatlas-harvester-out.log`:

```
done: processed=172 withTitle=114 withoutTitle=58 recorded=114 \
      failures=19 stationFailures=19 tripped=false pruned=0
```

- `processed=0` with `tripped=true` on consecutive runs is the failure mode to
  watch for. It means the run died on the head of the queue before touching
  anything, and — because `stale` order re-selects the least-recently-harvested
  stations first — the NEXT run will pick the same head. Confirm with
  `already-harvested stations on record:` staying frozen across runs.
- `stationFailures` counts individual unreachable streams (refused, DNS,
  timeout). Ordinary harvesting: a large number here is not an incident. These
  are stamped as attempted, so they rotate to the back of the queue.
- `failures - stationFailures` is upstream pressure from our OWN api (429/5xx).
  That is the number that should stay at zero; a persistent non-zero value means
  `/metadata` is rate-limiting or overloaded and the breaker is doing its job.

Run one pass by hand (it is a one-shot, so this is safe at any time):

```bash
cd /opt/RadioAtlas/current/apps/api
HARVESTER_ENABLED=1 HARVEST_ORDER=stale HARVEST_LIMIT=40 \
  API_BASE=http://127.0.0.1:3001 \
  STATION_INTEL_DB_PATH=/opt/RadioAtlas/shared/data/station-intelligence.sqlite \
  node --import tsx ../../scripts/harvestMetadata.mjs
```

`API_BASE` and `STATION_INTEL_DB_PATH` come from the pm2 `env` block in
`ecosystem.config.cjs`, NOT from `shared/env/api.env` — sourcing api.env alone
leaves the script on its defaults, which point at a dev port and a
release-local database. The give-away is `already-harvested stations on record:
0` plus every probe failing: that is the wrong database and a port with nothing
behind it, not a broken harvester.

Gate it off with `HARVESTER_ENABLED=0` in `ecosystem.config.cjs` (the script
no-ops and exits).

## Catalogue refresh memory

`getCatalog('full')` refreshes every `CATALOG_CACHE_TTL_MS` (6 hours since
2026-08-15, 30 minutes before that) and that refresh is the API's memory
high-water mark. Measured against the live
60 309-station catalogue on 2026-08-15, after pm2 killed the process four times
in one day (1020-1114MB against the 896MB `max_memory_restart`), once
mid-request for a real listener:

| what | cost |
| --- | --- |
| the catalogue parsed (steady state) | ~74MB of objects, ~130MB heap with its search index |
| `attachSearchIndex` | a full second copy of every station object, +48MB |
| refresh overlap (new copy built while the old is still referenced) | +134MB |
| **losing mirrors, before the fix** | **~74MB each, x3** |
| **`JSON.stringify` for the snapshot, before the fix** | **+137MB string, +69MB Buffer** |

Two of those were waste and are gone:

- **The mirror race did not stop the losers.** `RADIO_BROWSER_URLS` defaults to
  four mirrors, raced with `Promise.any`, each pulling up to 12 pages x 10 000
  stations. The winner settled the race and the other three kept downloading
  and accumulating their own complete catalogue. They now share an
  `AbortController` that fires the moment a winner exists. Besides the memory,
  this stops downloading the catalogue four times per refresh.
- **The snapshot was serialised whole.** `persistCatalogSnapshot` is now a
  chunked, temp-file-then-rename write; byte-identical output, peak measured at
  +40MB instead of +206MB.

Measured on production after both fixes (10s sampling, refresh triggered by hand
once the TTL had expired — the refresh is lazy and a quiet hour never triggers
one):

```
steady          292-294 MB
refresh         591 -> 789 MB peak -> 732 -> 480 MB
```

789MB against a 896MB cap. That is 107MB of headroom, and one Лира turn during
a refresh is roughly +80MB — so this is mitigated rather than solved, and the
remaining peak is the refresh legitimately holding two catalogues at once.

To reproduce the measurement: wait for the TTL to lapse (or start the API with
`CATALOG_CACHE_TTL_MS=60000`), then
`curl 'http://127.0.0.1:3001/catalog/summary?seed=$(date +%s)'` and sample
`ps -o rss= -p $(pm2 pid radioatlas-api)`. Note pm2 rewrites the process title,
so `ps | grep index.js` finds nothing — take the pid from pm2.

### The box is oversubscribed, and mostly not by us

Checked 2026-08-15 while `/catalog/summary` took 60s and then 13ms: **swap was
at 2000MB of 2047MB.** That is the real explanation for a request that hangs and
then answers instantly — the catalogue had been paged out and had to be faulted
back in.

Who is actually using the machine (RSS / swap):

```
RadioAtlas api   673 MB   (largest single process; not in the top swap users)
python main.py   334 MB   289 MB swapped
remnawave rw-*   360 MB   118 MB swapped
dockerd          175 MB
rodnya backend    83 MB
minio / searxng   67 / 37 MB   150 MB swapped (searxng)
```

Consequences for this service:

- **Do not raise `max_memory_restart`.** Giving RadioAtlas more resident memory
  takes it from a machine that is already swapping, and the processes that get
  pushed out are the neighbours.
- Reducing RadioAtlas's peak helps the whole box, which is why
  `CATALOG_CACHE_TTL_MS` now defaults to 6 hours: the refresh is the peak, and
  it used to happen 48 times a day.

### The heap cap, and why it is not the pm2 cap

`node_args: '--max-old-space-size=640'` on `radioatlas-api`. The two limits are
different things and confusing them is expensive:

- `max_memory_restart: 896M` watches **RSS** and ends in a graceful pm2 restart.
- `--max-old-space-size` bounds the **V8 old space** and ends in a fatal OOM.

RSS is heap plus external buffers, code, stacks and fragmentation — measured
here as ~90MB above `heapTotal`. Size the flag from the heap, never from RSS.

Measured against a real catalogue refresh, the heaviest moment the process has
(2026-08-16, 62 423 stations, a 71-second refetch):

```
default   rss 557MB  heapUsed 352MB  heapTotal 468MB
640MB     rss 479MB  heapUsed 278MB  heapTotal 394MB   refresh completed normally
```

The cap is never reached (394 of 640): it changes V8's growth policy rather than
squeezing the working set, which is the whole point — the process settles ~78MB
lower and still has ~165MB of RSS headroom under the pm2 cap for a Лира turn
(+67MB) or a harvester tick (+42MB).

To re-measure after any change to the catalogue path, run an API with a short
`CATALOG_CACHE_TTL_MS`, wait for the boot warm to FINISH, wait out the
hard-coded 5-minute profiled cache, then request `/catalog/search` and confirm
the response took tens of seconds — a fast answer means you measured a cache
hit, not a refresh. `runtime:heap_used_mb`, `runtime:heap_total_mb` and
`runtime:external_mb` are gauges on `/observability` for exactly this.

If the API starts getting memory-killed again, check these in order:

```bash
grep "exceeds --max-memory-restart" /root/.pm2/pm2.log | tail -5   # NOT in the app logs
pm2 jlist | node -pe '...'                                          # current rss
```

Idle RSS is ~400MB and that is expected — it is the catalogue. Anything above
~700MB sustained means a refresh overlapped with something else; the levers are
`CATALOG_MAX_PAGES` (12), `RADIO_BROWSER_URLS` (fewer mirrors), and
`CACHE_TTL_MS`. Do not raise `max_memory_restart` past ~900MB without checking
`free -m` first: the box has 3.9GB total and shares it with the rodnya services.

## Observability alerts
- Prometheus scrape target: `/observability/prometheus` (requires `X-Internal-Token`)
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

### Where the metrics live

`/opt/RadioAtlas/shared/data/observability/metrics.json`, pinned by
`OBSERVABILITY_STORE_PATH` in the api block of `ecosystem.config.cjs`.

This matters more than it looks. Until 2026-08-15 the path resolved next to
`apps/api/dist`, so the store lived **inside the release**: every deploy booted
against an empty file and `prune_old_releases` deleted the older ones. Three
live release directories held three disjoint stores, and the AI counters existed
in exactly one of them — which is why "watch `ai_model_error:*`" quietly could
not be done. The existing per-release stores were merged into the shared file
once, by hand, before the fix shipped.

Two guards keep it from coming back: the API logs
`[Observability] WARNING: metrics store ... sits inside a release directory` at
boot, `/observability` reports `persistence.ephemeral`, and
`apps/api/test/observability.storePath.test.ts` asserts the pm2 config points
outside `releases/`.

The file is written with write-then-`rename`, so a reader sees either the whole
previous state or the whole new one, and a process killed mid-write leaves the
previous file intact. Hydration falls back to `metrics.json.1.bak` /
`.2.bak` (copied at most once a minute) and preserves an unreadable live file as
`metrics.json.corrupt` instead of overwriting it.

That is not theoretical: on 2026-08-15, ninety minutes after the store was moved
here, pm2 restarted the API for exceeding `max_memory_restart` mid-flush, the
next boot read a truncated file, hydration failed, and the process wrote its own
near-empty state over the history (`ai_chat_request` went 6 → 3). Log lines to
watch for:

```
[Observability] recovered metrics from <path>.1.bak after an unreadable store
[Observability] kept the unreadable store as <path>.corrupt
```

The first means the safety net worked. The second means every copy was
unreadable and the file was set aside for inspection.

The store has exactly one writer at a time, enforced inside the store rather
than at the call site. The first version of this fix serialised only the
debounced path and used one shared `<store>.tmp`, which produced
`[Observability] failed to persist state ENOENT: rename …metrics.json.tmp` in
production within hours — the debounce spaces out when a flush STARTS, not how
long it takes. Temp names are now unique per write as well.

Read the current store without the API (for example while it is restarting):

```bash
node -e 'const o=require("/opt/RadioAtlas/shared/data/observability/metrics.json");
         console.log(Object.fromEntries(Object.entries(o.counters).filter(([k])=>k.startsWith("ai_"))))'
```

### Client events

`POST /observability/client-event` is the web app's only telemetry channel and
it is unauthenticated, so the accepted names are a **closed** list in
`apps/api/src/observability.ts` — the counter key is built from the name, and
counters are the one structure the age-based prune never touches.

Closed is not the same as short. Until 2026-08-15 the list held six
infrastructure names while the web app emitted 47, so every product, playback
and account-session event was answered `400 unknown event name`, dropped, and
logged as a console error in the listener's browser. The four families now
accepted:

- infrastructure: `client_error`, `deeplink_*`, `hls_error`, `share_story`
- product: `app_opened`, `play_attempt`, `play_success`, `stream_failure`,
  `skip`, `like`, `search_query`, `queue_*`, `station_*`, …
- playback runtime: `audio_*`
- account session: `session_*`

Adding a `reportProductEvent`/`reportSessionEvent`/`reportPlaybackEvent` name in
the web app without adding it here fails
`apps/api/test/observability.clientEvents.test.ts`, which reads the web app
sources rather than trusting a comment. To check a single name against a live
API:

```bash
curl -sS -X POST http://127.0.0.1:3001/observability/client-event   -H 'Content-Type: application/json' -d '{"name":"play_attempt"}'
```

`{"ok":true}` accepted, `{"error":"unknown event name"}` rejected.

### Playback counters: what `play_attempt` is not

`play_attempt` counts every play the UI starts. `play_success` counts the ones
that reached audio. **Their ratio is not a success rate**, and reading it as one
is an easy mistake — 248 attempts against 38 successes looks like a catastrophe
and is not.

The missing ones are supersessions: the Feed starts a play for every card it
passes and replaces all but the last. That path returned silently, so those
attempts left no trace at all. `play_superseded` now counts them, and the
arithmetic reconciles:

```
play_attempt  =  play_success + stream_failure + play_superseded + (in flight)
```

Read `play_success / (play_attempt - play_superseded)` when you want a success
rate, and treat a large `play_superseded` as ordinary Feed browsing rather than
a problem.

**Compute it from `counterWindows`, never from `counters`.** The store survives
deploys, so the top-level counters are totals since the file was created, and
they cannot be read as a rate across a change in what is counted: on 2026-08-17
they stood at 248 attempts, 38 successes, 1 supersede and 3 failures — 206
unaccounted for — which is not a 15% success rate but the sum of a pre-fix era
that did not count supersedes and a post-fix era with almost no traffic. The
payload carries `counterWindows.last1h` and `counterWindows.last24h`, each an
object of increments with a `since` timestamp, and only the counters that
actually moved:

```bash
node -e '
  const o = require("/tmp/o.json").counterWindows.last24h;
  const c = o.counters;
  const den = (c.play_attempt || 0) - (c.play_superseded || 0);
  console.log(`since ${new Date(o.since).toISOString()}: ${c.play_success || 0}/${den}`);
'
```

An empty window is an idle window, not a broken one — this box sees very little
traffic at night.

### Lira constraint, receipt and grounding counters

Three more things the roadmap says to watch, none of which emitted a number
before 2026-08-15. Same rule as the card gate: the retained agent run keeps no
prompt text, so these are counters, never transcripts.

**Explicit «без …» constraint filter.** The vocabulary in
`EXPLICIT_STATION_EXCLUSIONS` is small and hand-audited on purpose — a false
positive silently hides good stations — and the roadmap asks to grow it from
real misses.

- `ai_exclusion_clause` — the listener wrote an exclusion clause at all.
- `ai_exclusion_matched:<id>` — a known constraint fired. `<id>` always comes
  from the repo-owned list, never from chat text.
- `ai_exclusion_removed` — cards were actually removed.
- `ai_exclusion_unmatched` — **the miss counter.** A clause matched nothing the
  list knows. This is the evidence for widening the vocabulary; it does not say
  what was asked, and deliberately cannot.
- `ai_exclusion_emptied` — the constraint removed every card, so the turn fell
  back to external link search. Rare, and worse for the listener than a miss:
  the promise was kept so hard nothing is left to play.

`unmatched / clause` is the ratio to watch. High means the vocabulary is short.
`emptied` climbing means a `stationPattern` is too broad.

**Agent action receipts.** The browser reports what it actually did with an
action Lira proposed. These were parsed and fed back into the conversation, but
counted nowhere — so a client that FAILED to carry out a promised action left no
server-side trace.

- `ai_action_receipt:<kind>:<status>` — closed: six kinds x
  executed/skipped/failed.
- `ai_action_receipt_failed` — aggregate. Alert on a sustained rise: it means
  Lira is promising things the app cannot deliver.

**Grounding provider.** A capped or failing Tavily degrades silently — the
listener still gets a warm answer, just without the sources Lira was supposed to
cite. That is exactly how the 2026-08-14 model outage hid for a day.

- `ai_web_search:<ok|empty|capped|error|disabled>`
- `ai_web_search_degraded` — `capped` + `error`. Alert on a sustained rise; a
  steady stream means the daily cap or the key needs attention before anyone
  concludes Lira has "started making things up".

### Lira card-gate counters

The gate that keeps station cards off an answer to a question reports which
predicate fired. The retained agent run carries **no prompt text**, so these
counters are the only production evidence available for tuning those predicates
— there is nothing to grep for a transcript.

- `ai_cards_gate:knowledge` / `:song` / `:song_topic` / `:opinion` — the
  predicate matched this turn (a turn can match more than one).
- `ai_cards_gate_dropped` — the gate actually removed cards from the reply.
- `ai_cards_gate_released` — a predicate matched but `isExplicitMusicRequest`
  kept the cards («посоветуй джаз, почему бы и нет?»).

How to read it before widening any of these vocabularies:

- `ai_cards_gate:opinion` staying at 0 over a real traffic window means nobody
  phrases questions that way — that is an argument against widening it, not for.
- `ai_cards_gate_released` climbing means a predicate has grown greedy and is
  matching requests, and is being saved only by the escape hatch.
- `ai_cards_gate_dropped` far below the sum of the reason counters means the
  planner rarely had cards to drop, so the gate is mostly theoretical.

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
catalog summary (default and hard maximum: 50). Each station gets a stable
music-identity key from its UUID, safe name cue, curated genre profile, location,
and style version. Harvested recent tracks/top artists enrich the prompt when
available but stay out of the key, so an ordinary song transition does not spend
quota. The current FLUX REST
endpoint returns JPEG despite its PNG schema, so the API validates both formats
and serves the byte-derived MIME type. Repeated app views do not consume Workers
AI quota.

Production deploys read `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` from
GitHub Actions secrets, write them only to `/opt/RadioAtlas/shared/env/api.env`,
and keep images in `/opt/RadioAtlas/shared/scene-artwork`. The deploy seeds at
most a small 16-station starter set while the active style has fewer than eight
station-specific backgrounds. Old style versions coexist for rollback and do
not suppress seeding after a version bump. `SCENE_PACK_STATION_IDS` may prepend
comma-separated priority UUIDs; production currently reserves the first slot
for Yumi Co. Radio. Station logos are never replaced.

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
- Keeps the release `current` points at plus `RELEASE_KEEP_EXTRA` older ones — default 2, so
  three release directories survive — and `rm -rf`s the rest. Chunk preservation only ever
  reads the single previous release, so the extras exist purely for a manual rollback; at
  ~530MB each, a deeper history was costing gigabytes of a 59GB disk for a rollback depth
  nobody has used.

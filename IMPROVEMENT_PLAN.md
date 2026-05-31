# RadioAtlas — Improvement Plan v2

Comprehensive backlog assembled from a fresh backend + frontend + infra audit on
master @ `d5702bd`. Items are numbered for one-by-one execution by a follow-up
agent. Each item has: **what / why / files / done-when**. Do them top-down. A
task is only "done" when the **done-when** checks are satisfied and the
relevant `npm run typecheck && npm run typecheck:test && npm run test:api`
target stays green.

> Conventions
> - One commit per task ID, prefixed `T<id>: …`.
> - Touch only files listed under **files** unless a real reason emerges; if
>   you have to expand scope, write it in the commit body.
> - Do not skip pre-commit hooks. If a hook fails, fix and re-commit.
> - Update `PLAN.md` `Next:` whenever a tier completes.

---

## Tier 0 — Security & data-integrity (do this week)

### ~~T0.1 SSRF deny-list across all media proxies~~ (DONE in 86368fb; followup 891da98 blocks redirect-based bypass)
- **What**: in `apps/api/src/media/shared.ts`, extend `parseHttpUrl` to resolve
  the hostname and reject reserved/private CIDRs before fetching (RFC1918,
  loopback, link-local 169.254/16 incl. AWS metadata, ULA `fc00::/7`,
  `::1`, `0.0.0.0`). Add an "anti-rebind" check that re-resolves the host
  immediately before `fetch` and confirms the resolved address is still
  public. Wire the same gate into `/stream`, `/image`, `/fetch`, `/metadata`,
  `/extract`. Remove the YouTube-only `BLOCKED_HOSTS` check from
  `apps/api/src/index.ts` once the generic gate covers it.
- **Why**: today `/fetch?url=http://169.254.169.254/...` will happily proxy
  cloud-metadata; `/stream` proxies internal services.
- **Files**: `apps/api/src/media/shared.ts`, `apps/api/src/index.ts`,
  `apps/api/src/media/streamProxy.ts`, `apps/api/src/media/metadataService.ts`,
  any other media route. Add tests in `apps/api/test/`.
- **Done-when**: new `apps/api/test/media.ssrf.test.ts` covers (1) loopback
  rejected, (2) RFC1918 rejected, (3) AWS metadata IP rejected, (4) public
  IP allowed, (5) DNS rebind blocked (resolve twice differs). Existing tests
  green.

### ~~T0.1b Pin DNS resolution to a single validated IP per media fetch~~ (DONE)
- **What** (shipped): per-request undici `Agent` with a custom
  `connect.lookup` callback that ALWAYS resolves from the pre-
  validated `LookupAddress[]` returned by `assertHostIsPublic`.
  Closes the residual race window between our final resolve and
  undici's TCP-connect-time resolve: the attacker has no microsecond-
  window opportunity to flip DNS because undici never asks the OS
  resolver again. TLS SNI stays correct (undici uses the URL
  hostname for `servername` regardless of what `lookup` returns).
- **Family handling**: family-aware picker:
    family === 4 → first IPv4, else ENOTFOUND
    family === 6 → first IPv6, else ENOTFOUND
    family === 0 → prefer IPv4 (most public services dual-stack
                   with v4 reachable from anywhere)
  Both `all: true` (happy-eyeballs `lookupAndConnectMultiple` path)
  and `all: false` callback shapes implemented — undici's choice
  between them is a Node-version detail we don't depend on.
- **Agent disposal**: per-request Agent owned by the helper, wrapped
  through the response body lifecycle. `agent.close()` fires exactly
  once when the body is fully read OR cancelled, via a new Response
  with a wrapped ReadableStream (the global `Response.body` is read-
  only, so we construct a fresh one). Connection pool reuse across
  requests is intentionally NOT preserved — pinning correctness
  trumps the marginal connection-reuse win for our single-shot
  media proxy use-case.
- **Dependencies**: adds `undici: ^6.21.0` to `apps/api/dependencies`.
  Node 24 ships undici bundled internally (powers global fetch) but
  exposes neither it as `node:undici` nor the `Agent` constructor —
  the dep is the formalisation of an existing transitive reality.
  `import { fetch, Agent } from 'undici'` replaces global `fetch`
  in `shared.ts`; behaviour is identical (same undici under the
  hood), only the `dispatcher` option is now properly typed.
- **Files**: `apps/api/src/media/shared.ts`,
  `apps/api/package.json`, `apps/api/test/media.ssrf.test.ts`
  (3 new cases: P1 pinned-IP rebind via local server, P2 IPv6 family
  picker, P3 agent disposal across multiple sequential fetches incl.
  body-cancel path).
- **Done-when** (met): 3 new tests pass, all 6 existing media SSRF
  tests stay green (72/72 in apps/api), full verification gate green.

### ~~T0.2 Authenticate Telegram billing webhook end-to-end~~ (DONE in 4b1e5b7)
- **What**: stop accepting unauthenticated `POST /billing/telegram/webhook`.
  Two-step: (a) verify a shared `X-Internal-Token` header against
  `process.env.INTERNAL_WEBHOOK_TOKEN` injected at boot; (b) have the bot
  attach that header when forwarding `successful_payment`. Also: validate
  the Telegram payment update with the bot-token-derived HMAC before the bot
  ever forwards it (Telegram's signed `pre_checkout_query`/`successful_payment`).
- **Why**: anyone can flip an account to Premium by guessing/scraping a
  `purchaseId`.
- **Files**: `apps/api/src/billingRoutes.ts`, `apps/bot/src/index.ts` (payment
  handler), `apps/api/src/index.ts` (env wiring), `RUNBOOK.md` env section,
  `.env.example` for both apps. Test in `apps/api/test/`.
- **Done-when**: webhook without header → 401; with wrong header → 401; with
  correct header + valid Telegram payload → flips status. Bot e2e doc updated.

### T0.2b Bot UX when billing webhook forward fails
- **What**: today if `INTERNAL_WEBHOOK_TOKEN` is missing or the API returns
  non-2xx, the bot returns silently. The user paid Telegram but sees no
  acknowledgement. Reply with a clear apology message ("Оплата получена,
  активация займёт до N минут. Если Premium не появился — свяжитесь с
  поддержкой …") and emit a structured log line so operators can chase it.
- **Files**: `apps/bot/src/index.ts`, bot test.
- **Done-when**: bot test covers the forward-fail path replying to the user.

### ~~T0.2c Reconcile pending billing purchases with Telegram~~ (DONE in 129c950c)
- **What** (shipped): periodic in-process `setInterval` sweep in the
  API process that lists pending `billing_purchases` rows, calls
  Telegram's `getStarTransactions` once per tick (raw fetch, mirrors
  the existing `createTelegramInvoiceLink` pattern — no grammy dep
  in the API), matches by `invoice_payload`, and re-runs
  `confirmBillingPurchase` in-process when a match lands. Backoff
  schedule `[1m, 2m, 4m, 8m, 16m]` indexed by `reconcile_attempts`;
  max 5 attempts then dead-letter (single stderr JSON log, row stays
  pending — we never assert that a user did NOT pay). 24h horizon
  filters ancient pending rows. Disable via
  `BILLING_RECONCILE_ENABLED=0`.
- **Schema**: `last_reconcile_at INTEGER` (nullable) +
  `reconcile_attempts INTEGER NOT NULL DEFAULT 0` added via the T0.3
  `ensureSessionExpiresAtColumn` pattern (PRAGMA detect + fail-loud
  ALTER, not silent try/catch). T3.4 folds both into the numbered
  migration list.
- **Promise math** (VI-3 lock-in, locked in test 4 and docstring):
  with 2-minute tick interval, a freshly-failed row receives EXACTLY
  3 attempts in the first 10 minutes at t=2min, t=4min, t=8min. The
  T0.2b apology copy says "до 10 минут" (not "ровно") — 3 attempts
  in that window is the honest contract.
- **Files**: `apps/api/src/billingReconciliation.ts` (new),
  `apps/api/src/account/core/repository.ts`
  (`ensureBillingReconcileColumns`), `apps/api/src/routeSupport.ts`
  (`fetchTelegramStarTransactions`), `apps/api/src/index.ts` (boot
  wire), `apps/api/src/billingRoutes.ts` (test fixture endpoints +
  inspect), `apps/api/test/billing.reconcile.test.ts` (new, 8 cases),
  `RUNBOOK.md`.
- **Done-when** (met): 8 contract tests covering schema migration,
  match-grants, no-match attempts++, backoff schedule exact lock-in,
  dead-letter single-shot, idempotency across two ticks, 24h horizon,
  and BILLING_RECONCILE_ENABLED=0 boot-log absence.

### T0.2d Paginate getStarTransactions when billing volume > 100/24h
- **What**: today we fetch only the 100 most recent transactions per
  sweep tick (the `getStarTransactions` default/max limit). Realistic
  for early-stage RadioAtlas. If billing volume exceeds 100 unique
  payers per 24h, the oldest pending rows in the 24h horizon will
  never be matched against the Telegram-side response and will
  dead-letter via the apology fallback. Paginate via the `offset`
  parameter until we hit either (a) a transaction older than our
  horizon, or (b) all our pending rows are matched.
- **Why**: T0.2c's design holds at single-digit-pending scale. The
  threshold is a hard cliff, not a degraded curve.
- **Files**: `apps/api/src/billingReconciliation.ts`,
  `apps/api/src/routeSupport.ts` (pagination loop in
  `fetchTelegramStarTransactions`), `apps/api/test/billing.reconcile.test.ts`.
- **Done-when**: contract test seeds 150 pending purchases, asserts
  all matched within one sweep cycle.

### ~~T0.3 Session expiry + revocation~~ (DONE in 14685f8)
- **What**: add `expires_at` (default 30d sliding) to the `sessions` table,
  prune on read, and add `DELETE /me/session` (revoke current) and
  `DELETE /me/sessions` (revoke all). Migration via the new numbered
  migrations system (see T3.4) so this doesn't add another silent
  `try { ALTER } catch {}`.
- **Why**: leaked bearer tokens grant forever access today.
- **Files**: `apps/api/src/account/core/repository.ts`,
  `apps/api/src/account/core/authService.ts`, `apps/api/src/accountRoutes.ts`,
  schema migration file under `apps/api/src/account/core/migrations/`.
- **Done-when**: contract test asserts an expired token returns 401; logout
  route invalidates immediately; sliding-renewal happens on `getAccountByToken`.

### ~~T0.4 Lock down CORS~~ (DONE in 2c0d35c)
- **What**: replace `Origin`-reflecting CORS in `apps/api/src/index.ts:107-122`
  with an allow-list driven by env (`ALLOWED_ORIGINS`, comma-separated). Reject
  unknown origins; only set `Access-Control-Allow-Credentials: true` for
  matched origins.
- **Why**: today any site can call the API with a bearer token. Combined with
  `/observability/client-event` this is a token-exfil channel.
- **Files**: `apps/api/src/index.ts`, `.env.example`, `RUNBOOK.md`.
- **Done-when**: API tests cover allowed/blocked origin; production allow-list
  documented as `https://radioatlas.duckdns.org`, `https://web.telegram.org`,
  `https://k.telegram.org`, `https://a.telegram.org`, `https://z.telegram.org`.

### ~~T0.5 Tighten provider-link auth flow~~ (DONE in 679dfaa)
- **What**: in `authRoutes.ts:91-133` (and Google/VK siblings), stop silently
  linking a new provider identity to whichever account is in the `Authorization`
  header. Require either `linkCode` (existing flow) or a fresh
  re-confirmation step on the webapp before linking.
- **Why**: a stolen token + a fresh OAuth callback = attacker permanently
  attaches their own identity.
- **Files**: `apps/api/src/authRoutes.ts`, `apps/api/src/googleAuth.ts`,
  `apps/api/src/vkAuth.ts`, webapp link UI under `src/components/AccountSheet.tsx`.
- **Done-when**: new identity always requires `linkCode` (one-time, ≤5min);
  contract test covers the bad path.

### ~~T0.6 Delete or paginate `/catalog` (the 32 MB JSON route)~~ (DONE in 9565c57; route deleted, no caller anywhere in the repo)
- **What**: confirm no webapp path calls bare `/catalog` (grep `apiBase` calls).
  Remove the route from `apps/api/src/catalogRoutes.ts`, or replace with a
  paginated `?cursor=&limit=` endpoint that streams via
  `res.write(JSON.stringify(chunk))`. Either way, drop the `JSON.stringify` on
  the full array.
- **Why**: one anon curl can stall the API for hundreds of ms (sync stringify
  on the event loop).
- **Files**: `apps/api/src/catalogRoutes.ts`, contract tests.
- **Done-when**: `GET /catalog` either 404s or paginates ≤2 MB per page; load
  test 10 concurrent calls keep `/health` p95 under 100 ms.

### ~~T0.7 Production guard against test-fixture routes~~ (DONE in a4fb9f9; defence-in-depth + docs landed in the followup commit on top)
- **What**: gate `ENABLE_TEST_AUTH_FIXTURES` on `process.env.NODE_ENV !==
  'production'`. Boot-time assertion that throws if both flags are true.
- **Why**: a misconfigured deploy currently lets anyone seed an authenticated
  account via `POST /test/auth/seed-conflict`.
- **Files**: `apps/api/src/index.ts`, `apps/api/src/authRoutes.ts`,
  `apps/api/src/googleAuth.ts`, `apps/api/src/vkAuth.ts`.
- **Done-when**: starting in `NODE_ENV=production` with
  `ENABLE_TEST_AUTH_FIXTURES=1` exits non-zero with a clear message.

---

## Tier 1 — UX blockers on Telegram

### ~~T1.1 Load the Telegram WebApp script and gate every integration on it~~ (DONE in f346339)
- **What**: add `<script src="https://telegram.org/js/telegram-web-app.js"></script>`
  to `apps/webapp/index.html` (no `defer` — Telegram inject happens early).
  Audit all `window.Telegram?.WebApp` call sites for graceful fallback. Centralise
  the access through `src/lib/telegram.ts` so non-Telegram contexts never throw.
- **Why**: outside the Telegram client (web preview, direct link), every
  Telegram-only integration silently no-ops.
- **Files**: `apps/webapp/index.html`, `apps/webapp/src/lib/telegram.ts`,
  `apps/webapp/src/state/RadioContext.tsx`, `apps/webapp/src/components/AccountSheet.tsx`,
  `apps/webapp/src/screens/Settings.tsx`.
- **Done-when**: hitting `https://radioatlas.duckdns.org/` outside Telegram still
  renders Home; `window.Telegram?.WebApp` is consistently checked.

### T1.2 `disableVerticalSwipes` + closing confirmation + haptics
- **What**: in the existing Telegram mount effect call
  `WebApp.disableVerticalSwipes?.()`. Wire
  `WebApp.enableClosingConfirmation?.()` when `player.isPlaying` and
  `disableClosingConfirmation?.()` on pause. Add `HapticFeedback.impactOccurred('light')`
  to play/pause/like/queue buttons.
- **Why**: vertical swipes fight the dock tray. Closing without confirmation
  kills active playback. A media app with no haptics feels broken.
- **Files**: `apps/webapp/src/state/RadioContext.tsx`,
  `apps/webapp/src/components/MiniPlayerDock.tsx`,
  `apps/webapp/src/components/FullPlayerOverlay.tsx`.
- **Done-when**: e2e test exists for closing-confirmation toggle; manual smoke
  in Telegram Android confirms haptic on play.

### ~~T1.3 Telegram themeParams as a layer over user theme~~ (DONE in 40ab32e)
- **What** (shipped): synthetic `telegram-auto` theme synthesised at
  render time when (a) user is on the stored default `currentThemeId
  === 'classic'`, (b) inside the Telegram client (non-empty initData),
  and (c) at least one of `bg_color` / `accent_text_color` /
  `link_color` / `button_color` is present in `WebApp.themeParams`.
- **Mapping** (3 keys, no inventing): `bg_color → --theme-bg-image`
  (flat gradient), `accent_text_color → --theme-accent` (link_color
  fallback), `button_color → --theme-accent-2`. Other 10 themeParams
  keys skipped — RadioAtlas's 5-CSS-var token surface has no clean
  equivalents and a token-surface expansion is out of scope.
- **Files**: `apps/webapp/src/lib/telegram.ts` (+
  `getTelegramThemeParams`, `subscribeTelegramThemeChange`),
  `apps/webapp/src/lib/theme/telegramAuto.ts` (new),
  `apps/webapp/src/state/ThemeContext.tsx` (render-time override),
  `apps/webapp/src/vite-env.d.ts` (SDK type extension),
  `apps/webapp/tests/helpers.ts` (themeChanged shim).
- **Done-when**: 5 e2e cases in `telegram-integration.spec.ts` cover
  (a) themeParams applied, (b) explicit pick wins, (c) standalone
  no-leak, (d) themeChanged re-apply, (e) empty themeParams stays on
  Classic. All green.

### T1.3b Explicit Theme Studio entry for Telegram-auto with opt-out
- **What**: surface `'telegram-auto'` as a real Theme Studio picker
  entry (filtered to only appear inside Telegram client). Add an
  explicit opt-in flag separate from `currentThemeId`, so users
  inside Telegram who prefer RadioAtlas's branded look can pick
  another theme and never get pulled back to Telegram-auto on
  themeChanged. Also distinguishes "user explicitly picked Classic"
  from "user is on default and falling through to Telegram colours" —
  the conflated predicate documented in `ThemeContext.tsx`.
- **Why**: today the predicate `currentThemeId === DEFAULT_THEME_ID`
  conflates first-time users and users who explicitly tapped Classic.
  Both fall through to Telegram themeParams. Inside Telegram, a user
  who deliberately wants Classic has no way to express it.
- **Files**: `apps/webapp/src/components/ThemeStudio.tsx` (picker
  filter + extra entry), `apps/webapp/src/state/ThemeContext.tsx`
  (separate persisted opt-in flag), `apps/webapp/src/lib/theme/
  telegramAuto.ts` (no change unless the synthesis floor needs
  per-key opt-ins).
- **Skip if no user complaints surface**: T1.3 baseline behaviour is
  defensible — explicit picks already override, and Telegram-auto
  only fires for default-stored users (where the assumption "they
  haven't customised" holds 99% of the time).

### T1.4 Dialog focus trap + Escape handler
- **What**: introduce a `useDialog` hook (`apps/webapp/src/lib/useDialog.ts`)
  that: (1) captures Escape to close, (2) traps Tab between first/last
  focusable inside ref, (3) restores focus to the trigger on close. Wire
  it through `FullPlayerOverlay`, `StationDetails`, `SettingsSheet`,
  `AccountSheet`, `ThemeStudio`.
- **Why**: keyboard users can't dismiss; Tab leaks to the page below.
- **Files**: `apps/webapp/src/lib/useDialog.ts` (new), each overlay component.
- **Done-when**: Playwright keyboard test asserts Escape closes Full Player
  and focus returns to the trigger.

### T1.5 Search submits on Enter
- **What**: wrap the discover input in `<form onSubmit={…}>`, flush the
  `useDebounce` immediately on submit. Same for hero search.
- **Files**: `apps/webapp/src/screens/Search.tsx`, `apps/webapp/src/lib/useDebounce.ts`
  (if a `flush()` method is needed).
- **Done-when**: pressing Enter on the on-screen keyboard runs the search
  instantly (no 250 ms wait).

### T1.6 Drop right-click=mute on volume button
- **What**: remove the `onContextMenu` mute handler in `MiniPlayerDock.tsx`.
  Keep the existing tray mute button. Long-press behavior already removed.
- **Why**: kills the OS context menu (copy / inspect) and fights Android's
  text-selection gesture.
- **Files**: `apps/webapp/src/components/MiniPlayerDock.tsx`, e2e test in
  `apps/webapp/tests/mobile.spec.ts`.
- **Done-when**: e2e: right-click on volume button shows the system context
  menu and does not mute.

### T1.7 ErrorBoundary around providers and lazy screens
- **What**: add a single `ErrorBoundary` component in `apps/webapp/src/components/`.
  Wrap `<RadioProvider>` and each `React.lazy` screen in `App.tsx`. Boundary
  posts the error to `observability.ts` and renders a "reload screen" CTA.
- **Why**: any uncaught render error today = white screen.
- **Files**: `apps/webapp/src/components/ErrorBoundary.tsx` (new),
  `apps/webapp/src/App.tsx`, `apps/webapp/src/lib/observability.ts`.
- **Done-when**: test throws inside one lazy screen and asserts boundary
  catches + observability event fires.

### T1.8 Distinct aria-labels and accessible visible focus
- **What**: in `MiniPlayerDock.tsx:405`, give the volume button state-dependent
  labels (`dock.volumeOpen` / `dock.volumeClose`); same for mute toggle.
  Replace `outline: none` rules at `styles.css:943` and `:8342-8344` with a
  visible focus indicator on the focusable element itself. Set `<html lang>`
  from locale at boot.
- **Files**: `apps/webapp/src/components/MiniPlayerDock.tsx`,
  `apps/webapp/src/styles.css`, `apps/webapp/src/state/LocaleContext.tsx`,
  `apps/webapp/src/state/locales/{ru,en}.ts`.

---

## Tier 2 — Performance & reliability

### T2.1 Visualizer state out of React (re-scoped after T_audit_1)
- **Updated framing**: `PlaybackRuntime.tsx:18,105-156` ALREADY
  throttles visualizer emission into the playback snapshot to
  `VISUALIZER_EMIT_INTERVAL_MS = 240` ms — so the original framing
  ("every consumer of usePlayback re-renders 30×/s") is no longer
  accurate. App-wide consumers re-render ~4 Hz today, not 30 Hz.
  The 30 Hz problem is now LOCAL to two paths:
    1. `useAudioPlayer.ts:977` — `setVisualizer({...})` 30×/s
       triggers PlaybackRuntime re-render + signature recompute
       (`buildVisualizerSignature` does 2× `Array.from` per frame).
    2. `useAudioPlayer.ts:873-882` — `useEffect([visualizer])` writes
       `audio.dataset.raVisualizer*` (string-serialised spectrum)
       on every change → 30 Hz DOM writes.
  Plus `useAudioPlayer.ts:953,969` — `Array.from({length: BARS})` /
  `Array.from({length: SAMPLES})` allocate new arrays every frame
  → GC pressure on battery / micro-pauses on low-end devices.
- **What**: stop calling `setVisualizer({...})` in
  `useAudioPlayer.ts`. Expose a `subscribeVisualizer(cb)` API that
  pushes via ref callbacks. The visualizer canvas reads the ref
  directly in its rAF; PlaybackRuntime no longer rebuilds the
  signature for visualizer ticks. Drop `audio.dataset.*` writes —
  if any consumer reads them, switch that consumer to the
  subscription API. Reuse typed-array buffers across frames
  (allocate once on mount, fill in place).
- **Why**: removes 30 Hz host re-render + 30 Hz DOM writes + GC
  pressure. Net: smoother frame budget, less battery drain, faster
  perceived UI even when audio is not the focus.
- **Files**: `apps/webapp/src/lib/useAudioPlayer.ts`,
  `apps/webapp/src/state/PlaybackRuntime.tsx`,
  `apps/webapp/src/components/WinampMilkdropVisualizer.tsx`.
- **Done-when**: React DevTools profiler shows PlaybackRuntime
  re-render rate ≤ 1 Hz during playback (was ~30 Hz pre-fix); no
  `audio.dataset.raVisualizer*` writes remain.

### T2.2 Debounced localStorage flush for `nowPlaying` cache
- **What**: in `apps/webapp/src/lib/nowPlaying.ts`, keep the cache in an
  in-memory `Map<stationId, TrackEntry>`. Flush to localStorage via a
  1-second debounced writer. Prune to 600 entries in-memory only when the
  Map grows past 600.
- **Why**: today every track save reads-spreads-sorts-stringifies up to 600
  records and writes a full JSON.
- **Files**: `apps/webapp/src/lib/nowPlaying.ts`.
- **Done-when**: unit test asserts 100 saves trigger exactly one
  `localStorage.setItem`.

### T2.3 Stream proxy: propagate client disconnect
- **What**: in `apps/api/src/media/streamProxy.ts`, attach a per-request
  `AbortController` to `fetchWithTimeout`. On `req.on('close')` call
  `controller.abort()`. Verify upstream socket closes (log via
  `observability`).
- **Why**: rapid station switching leaks upstream connections.
- **Files**: `apps/api/src/media/streamProxy.ts`, contract test.
- **Done-when**: load test of 50 rapid open-close cycles leaves no orphan
  upstream sockets.

### T2.4 Batch promotion-impression writes
- **What**: in `apps/api/src/stationProfileRoutes.ts`, accumulate impressions
  in memory and flush in batches every 2s (and on shutdown). Add per-IP rate
  limiting (max 60 impressions / minute / IP) to prevent the
  abuse-by-anon-spammer angle.
- **Why**: today one globe paint = N SQLite writes on the event loop, and
  unauthenticated users can inflate counts.
- **Files**: `apps/api/src/stationProfileRoutes.ts`,
  `apps/api/src/account/core/stationProfileService.ts`.
- **Done-when**: 1000 impressions in <2 s produce ≤1 SQLite write.

### T2.5 Cheap hash for library dedupe key
- **What**: replace `${id}:${JSON.stringify(req.body)}` in
  `apps/api/src/accountRoutes.ts:67` with a SHA-1 of the canonical body
  (small, deterministic). Stays correct because `serializeLibrary` already
  produces a deterministic shape.
- **Files**: `apps/api/src/accountRoutes.ts`.

### T2.6 Single-flight + warm cache for catalog snapshots
- **What**: in `apps/api/src/catalogCache.ts` and `apps/api/src/catalog/service.ts`,
  wrap `withStationProfiles` in a `Promise` cache so concurrent first-callers
  share one DB scan. Parse persisted JSON via streaming (`stream-json`) or in a
  worker thread to avoid blocking the event loop.
- **Files**: `apps/api/src/catalogCache.ts`, `apps/api/src/catalog/service.ts`,
  contract test for concurrent cold-start.

### T2.7 Vite manualChunks: defer audio engine
- **What**: in `apps/webapp/vite.config.ts`, move `useAudioPlayer` and
  `nowPlaying` out of the main chunk; `playbackTransport` and
  `stationStreams` stay critical. Mini Player shows a disabled play button
  until the chunk lands (≈ 30 ms).
- **Files**: `apps/webapp/vite.config.ts`, lazy-load wiring in
  `apps/webapp/src/state/RadioContext.tsx`.
- **Done-when**: build report shows main chunk ≥ 30 KB smaller and Globe
  cold-paint metric in `apps/webapp/tests/visual.spec.ts` doesn't regress.

### T2.8 preconnect for external origins
- **What**: in `apps/webapp/index.html`, add `<link rel="preconnect">` for
  `services.arcgisonline.com`, `cdn.jsdelivr.net`, the Radio Browser API
  pool (`*.api.radio-browser.info`). Use `dns-prefetch` as a fallback.

### T2.9 In-memory rate-limit map bounding
- **What**: in `apps/api/src/media/protection.ts`, cap the `rateLimits`,
  `cache`, and `inflight` Maps. Periodic sweep (every 60s) drops entries
  older than 2× window. Add a metric for map size.
- **Why**: today a botnet can grow the map without bound.

### T2.10 Tagged stale-fallback responses
- **What**: when `recordCatalogFallback` fires (`apps/api/src/index.ts:278`),
  set response header `X-RadioAtlas-Fallback: snapshot` and an `etag` from
  the snapshot mtime. Webapp reads the header and shows a small "data may
  be stale" hint.
- **Files**: API + `apps/webapp/src/state/CatalogContext.tsx`.

### T2.11 Virtualize station lists (UI Sprint v1)
- **What**: today `apps/webapp/src/components/StationTable.tsx` renders
  every row in `stations.slice(0, visibleCount)` as a live DOM node;
  `visibleCount` only grows (loadMore += batch), never trims. Each
  rendered row attaches its own `IntersectionObserver` for visibility
  + an `observeStationNowPlaying` listener whose release is delayed
  5 minutes after unmount. A long Browse-by-country session
  accumulates thousands of live DOM subtrees + observers, exhausts
  the WebView heap, and crashes the browser.
- **Fix**: windowing — render only the visible viewport slice +
  overscan, attach observer/now-playing subscriptions only to rows
  in the window. Library candidate: `react-window` (battle-tested,
  ~1.5 KB gzip). Must preserve existing infinite-scroll load-more
  via `useInfiniteScroll` from Bug B (T1.2-followup) — the sentinel
  stays at the bottom of the underlying list, the windowed renderer
  is what changes.
- **Why**: from T_audit_1 — this is the most direct OOM cause in
  the webapp. No runtime profiling needed; the unbounded growth is
  evident statically.
- **Files**: `apps/webapp/src/components/StationTable.tsx`,
  `apps/webapp/package.json` (add `react-window`), e2e test in
  `apps/webapp/tests/` that scrolls a 1000+ station list and asserts
  the rendered row count stays bounded (windowed) regardless of
  source-list length.
- **Done-when**: e2e asserts max ~30 rendered rows even with 1000+
  stations in the data set; existing filter/sort/load-more flows
  still work; visual baselines stay green or get a documented
  refresh.

### ~~T2.12 Globe WebGL lifecycle: keep-alive or module-scope reuse~~ (DEFERRED — hypothesis refuted by runtime profile)
- **What was hypothesized**: `App.tsx:411` renders only the active
  tab via `ActiveScreen = SECTION_COMPONENTS[activeSection]`; every
  Home↔Globe cycle mounts/unmounts MapLibre. Browsers limit live
  GL contexts (~16) and might not GC released contexts
  immediately on low-end WebViews → context exhaustion → crash.
- **Runtime verification (T2.12 audit)**: Playwright+CDP headless
  Chromium, viewport 390×844, against production
  `radioatlas.duckdns.org`, instrumented `getContext('webgl')` +
  `webglcontextlost`/`restored`/`creationerror` + heap via
  `HeapProfiler.collectGarbage` every cycle. Toggled Home↔Globe
  10 and then 30 cycles:
    - 30 cycles → created=30, lost=30, restored=0, creationErrors=0
    - heap delta=0 (flat ~10 MB across all 30 cycles)
- **Why refuted**: contexts are released 1:1 with creation
  (MapLibre's `map.remove()` proactively releases the GPU context
  via `WEBGL_lose_context.loseContext()`). Net live contexts after
  any tab roundtrip = 0, so the browser budget (~16) is never
  approached. Real exhaustion would show `creationErrors > 0`,
  unpaired losses, and growing heap — none of those triggered.
  `webglcontextlost` events firing 1:1 with `map.remove()` is a
  clean-teardown signal, not an exhaustion symptom.
- **Caveat acknowledged**: profile ran on headless Chromium
  (same engine as Android Telegram WebView, not iOS WebKit /
  real low-end mobile GPU). But the argument is engine-
  independent: 1:1 release prevents accumulation regardless of
  the device-specific context budget.
- **Decision**: marked deferred, NOT actionable on current
  evidence. Reopen only if a specific real-device crash report
  surfaces with diagnostic data implicating GL context churn.
  Bonus UX (state preservation across tab switches) is not
  enough on its own to justify the keep-alive / singleton
  complexity — that's a feature request, not a perf task.

### T2.13 Globe move-handler throttle
- **What**: `apps/webapp/src/components/Globe.tsx:942,835-841` —
  `handleMove` → `findNearestStation` → `map.queryRenderedFeatures`
  on a 640×640 bbox fires at ~60 Hz during drag/rotate. Raster
  feature query is expensive at that cadence.
- **Fix**: throttle/rAF-coalesce so the query runs at most ~15-20 Hz,
  or compute nearest from a pre-built spatial index instead of
  querying the rendered layer. Pre-built KDTree on `points` is
  cheap; the layer query is the expensive path.
- **Files**: `apps/webapp/src/components/Globe.tsx`.
- **Done-when**: rotate-drag p95 main-thread block < 8 ms (down
  from current ~16+ ms during query bursts).

### T2.14 Theme asset IndexedDB cap + LRU eviction
- **What**: `apps/webapp/src/lib/theme/storage.ts:210-224`
  (`saveStoredAsset`) writes user-uploaded theme backgrounds / GIFs
  / stickers without any size or count cap. User who uploads many
  large media bumps the IDB quota silently; subsequent writes fail
  in obscure ways.
- **Fix**: cap by (a) count (e.g. 50 assets) and (b) total bytes
  (e.g. 100 MB). On `saveStoredAsset`, sort by `lastAccessedAt`,
  evict oldest until under cap. Add `lastAccessedAt` field via the
  T0.3 migration pattern.
- **Files**: `apps/webapp/src/lib/theme/storage.ts`,
  `apps/webapp/src/state/ThemeContext.tsx` (touch `lastAccessedAt`
  on read), unit test.
- **Done-when**: unit test seeds 60 assets, asserts only 50 remain
  + total bytes under cap + oldest were evicted.

### T_audit_2 Dormant hot-loop detection
- **Why this is its own task**: T2.1 (visualizer state out of React)
  surfaced that the entire 30 Hz pipeline was producing
  spectrum/waveform data that NO consumer ever read — the cost was
  real, the work was wasted. Other hot loops in the codebase may
  share this pattern (rAF-driven state updates whose downstream
  consumers were removed in earlier cleanup passes but the producer
  stayed). Static greppable.
- **What**: read-only audit pass. Grep for `requestAnimationFrame`,
  `setInterval`, `setState` inside callback bodies that fire at
  >1 Hz, and trace the consumers of each. Surface any path where
  the consumer chain dead-ends (e.g. state pushed into a context
  whose selector predicate trims it out, prop drilled into a
  component that doesn't render it, dataset writes nobody reads).
- **Output**: same format as T_audit_1 — Critical / Major /
  Moderate / Minor with file:line + recommended kill/fix order.
  Fix-tasks split out per finding once the audit lands.
- **Files** (read-only): all of `apps/webapp/src/`.
- **Done-when**: ranked list of dormant or wasteful hot loops, or
  a clean report "no other dormancy found". Either outcome is
  actionable.

---

## UI Sprint v2 — Home as Discovery

User report: "на главной хуйня какая-то и станций очень мало"
+ "хочется как главные страницы музыкальных сервисов с
рекомендациями" + "максимально использовать пространство, без
пустых мест". Live audit (Chrome MCP, prod desktop 1138×1081)
confirms: above-the-fold = 1 hero station + 4 in resume rail =
5 visible stations (Spotify shows 15-20 in same viewport).
Total Home content = 5 rails × 3-4 tiles = ~17 stations.

Design principles for the whole sprint:
- **Density first**: every block on the page must earn its pixels.
  Decorative subtitles, admin meta-rows, ad-promos for other tabs
  → drop or shrink.
- **Tile variety**: hero card + standard tile + compact logo strip,
  not five rails of identical 200px tiles.
- **Rail variety**: mix personal / discovery / genre / mood /
  region / editorial — don't ship five rails of the same flavour.
- **No empty cells**: if a rail returns < N stations, fallback /
  merge / hide entirely (no awkward placeholder gaps).
- **Above-fold = currency**: hero + 1-2 personal rails must fit
  before the user scrolls.

### T2.20 Home density pass (immediate visible win)
- **What**: shrink decorative surfaces, kill ad-promos for other
  tabs, reduce tile widths so 5-6 fit per rail instead of 3-4.
  No new data sources, no new rails — just denser presentation
  of what's already there.
- **Drop**: hero header subtitle "ТВОЙ ЭФИРНЫЙ АТЛАС" + kicker;
  catalog stats meta-row "СТРАН 238 / ЯЗЫКОВ 1246 / ЖАНРОВ 11262"
  inside the featured card; "Найти станцию" search-promo card
  entirely (search lives in nav + the search icon in the hero
  header already); "Что открыть дальше" nav-promo at the bottom
  (Глобус / Медиатека are in nav).
- **Shrink**: hero featured card 350px → ~220px (drop the meta
  row, tighten chip padding); standard tile width 200px → 140-160px
  so 5-6 fit per row on a 880-1100px content column.
- **Files**: `apps/webapp/src/screens/Home.tsx`,
  `apps/webapp/src/screens/homeCards.tsx`, related CSS in
  `apps/webapp/src/styles.css` / `screens/home.css`.
- **Done-when**: above-fold count of visible station tiles goes
  from 5 to ≥12 on a 1280×720 desktop viewport; mobile (390×844)
  goes from 4 to ≥6; no rail looks visually broken on either
  viewport. Existing visual baselines refreshed where intentional.

### ~~T2.21 Discovery rails — server-side signals~~ (DONE in c158592)
- **What**: add three new rails powered by Radio Browser meta
  that the API doesn't expose to the webapp today:
  - 🔥 **Trending** — top stations by `clicktrend`
  - 🌟 **Top voted** — top stations by `votes`
  - 🌍 **Around the world** — random country spotlight, rotates
    daily on a seed
  Requires extending `/catalog/summary` (or a new endpoint) to
  surface those signals per-station.
- **Files**: `apps/api/src/catalog/service.ts` +
  `apps/api/src/catalogRoutes.ts` (signal pass-through),
  `apps/webapp/src/lib/homeSurface.ts` (new rail builders),
  Home.tsx (render).
- **Done-when**: three new rails visible on Home with
  realistic content; cold load no slower than baseline (signal
  passthrough is meta-only, no extra fetch).
- **Shipped**: CatalogStation now carries `votes`, `clicktrend`,
  `clickcount`; `buildCatalogSummary` exports `trending`,
  `topVoted`, `aroundTheWorld` (daily-rotated country spotlight
  with `exclude`-of-primary-country). Webapp contracts extended,
  `discoveryFeed` builds the three new modules, `homeSurface`
  promotes them above the resume/genre fold, `HOME_SURFACE_VERSION`
  bumped to 4 to evict stale snapshots, `CatalogContext.collect…`
  registers the new pools for playback. Locales add 🔥/🌟/🌍
  copy in ru+en. Tests: 3 new API unit tests + 2 new client unit
  tests + 1 new desktop+mobile e2e file + dense-mobile test
  updated to seed discovery routes. Mobile baseline refreshed
  intentionally; desktop baseline unchanged.

### ~~T2.22 Mood rails — tag-bucketed listening contexts~~ (DONE in d06b603)
- **What**: four mood rails from tag-based filtering of the
  existing catalog (Radio Browser already provides tags like
  `chillout`, `electronic`, `classical`, `talk`):
  - 🌙 **Late night** (chillout, ambient, lounge)
  - 💪 **Workout** (energetic, dance, edm)
  - 📚 **Focus** (instrumental, classical, jazz)
  - 🚗 **Driving** (rock, pop mix, popular fm)
- **Files**: `apps/webapp/src/lib/homeSurface.ts` (mood builders),
  `apps/webapp/src/state/locales/{ru,en}.ts` (rail copy), Home.tsx.
- **Done-when**: each mood rail returns ≥6 stations from
  current catalog or hides cleanly; rail variety visible to user.
- **Scope change (approved during audit)**: worker pushed back
  on the "client-side heuristic" framing — the webapp never
  fetches the full catalogue (`knownStations` is the summary's
  ~60 stations), so client-side bucketing with a ≥6 floor would
  hide most moods on first paint. Mood buckets are now computed
  SERVER-SIDE in `buildCatalogSummary` (full 57k catalogue),
  mirroring T2.21's trending/top-voted pattern. Client wraps the
  pre-bucketed shelves through `discoveryFeed → homeSurface`.
  Tag matching is word-aware (comma-split + exact match) so
  `electrock` never lands in Driving via substring `rock`.
  Cross-mood assignment is seed-shuffled, single-homed,
  deterministic per seed.
- **Caps bumped**: `DESKTOP_RAIL_LIMIT 8→12`, `DENSE_RAIL_LIMIT
  6→10`, `HOME_SURFACE_MAX_RAILS 9→13` so all ten content
  shelves render on both layouts. `HOME_SURFACE_VERSION` bumped
  4→5 to invalidate stale snapshots. Worker caught and corrected
  an off-by-one in the dense cap (DENSE=9 would have cut
  around-the-world on mobile, breaking T2.21's mobile test).
- **Shipped**: 4 mood rails wired through `domain/contracts.ts`,
  `discoveryFeed.ts`, `homeSurface.ts`, `Home.tsx`,
  `CatalogContext.tsx`, ru+en locales. Tests: 3 new API ranking
  tests (word-aware, ≥6 floor, deterministic single-homing),
  3 new client unit tests, new `homeSurface.test.ts` (2 cases),
  e2e extended with mood-shelf assertions on desktop + dense
  mobile. `seedDiscoveryRoutes` helpers in both `home-discovery`
  and `mobile` specs now seed the full discovery+mood set —
  reusable for T2.23. Gate green (api 78 / bot 12 / webapp unit
  107 / webapp e2e 129 / build). No visual baselines drifted.

### ~~T2.23 Variety pass — visual rhythm~~ (DONE in 8ea8dda)
- **What**: break up the "five identical rails" monotony with
  per-rail tile variants and chip filters above the feed.
  - Chip-row above the feed: genre filter chips ("pop / rock /
    jazz / electronic / classical / dance / hip hop / news") that
    jump-scroll to or filter the relevant rail.
  - Within at least one rail, a "featured" tile that's ~1.5×
    the size of standard tiles (1-of-6 hero out of N).
  - Compact logo-strip rail variant for a "most-popular" lane —
    just artwork thumbnails, no text, for fast scanning.
- **Files**: Home.tsx, homeCards.tsx, CSS (`home.css`).
- **Done-when**: home visual rhythm distinct from a single grid
  pattern; chip-row works as either filter or scroll-anchor
  (worker call).
- **Shipped (three render-mode variants)**:
  - Anchor chip-row (option A — anchor-scroll, not filter) under
    the search bar, one chip per visible discovery shelf
    (Trending / 4 mood / Top voted / Around the world). Chips
    reuse emoji rail titles, auto-hide when a rail is missing.
    `fresh-now` (lead) and the dynamic country/genre spotlights
    intentionally have no chip.
  - Featured tile in `fresh-now`: first tile is ~1.5× wider
    (`.home-station-tile--featured`) — width-only so the row
    height (and the fold) doesn't move. Desktop-only (gated
    `!dense` — would have broken the 2-col grid on mobile).
  - Logo-strip for Top voted: artwork-only ~84px tiles, no name
    / meta / action chrome. Accessible name preserved via
    `aria-label` + visually-hidden span.
- **Density defense (the real risk)**: naïve chip-row cost
  ~42px against ~39px of fold headroom and would have regressed
  T2.20's ≥12 to 6. Worker measured (probe), then reclaimed
  with a thin chip-row + `-6px` grid-gap-eating margin + tighter
  search-launcher padding. Verified trending tiles at 952 < 960
  → ≥12 holds with 8px of slack.
- **A11y deviation flagged + reasoned**: `<nav>` + buttons,
  NOT `role="tablist"` — anchor-scroll keeps all rails visible,
  so tablist would mislead screen readers about which "tab" is
  active.
- **Constraints honored**: no `apps/api` change, no data shape
  change, no `HOME_SURFACE_VERSION` bump, no visual baseline
  drift (selectors backward-compatible). Gate green (api 78 /
  bot 12 / webapp unit 107 / build). E2e: T2.23 + dense-mobile
  pass; full-suite has known T4.7 flakes (set varies per run,
  each passes in isolation).

---

## Sprint v2 closed (T2.20 → T2.23)

Home shifted from 5 visible stations / 5 identical rails to a
density+variety surface: 6 server-signal + mood shelves at the
top, anchor chip-row navigation, featured-tile rhythm, and a
logo-strip lane for Top voted. Above-fold density target ≥12
desktop / ≥6 mobile holds across all four tasks.

Sprint v2 ends with HOME_SURFACE_VERSION 5, 13-rail max, and a
reusable `seedDiscoveryRoutes` helper carrying the full
discovery+mood set (T2.21 added it, T2.22 extended it, T2.23
relies on it). Per `PLAN.md` `Next:` the focus shifts to live
Telegram mobile QA on Home / Search / Globe / Library / Full
Player across low-power Android/iOS WebView.

---

## Incident log

### 2026-05-27 — Production API 502 after T2.23 merge
- **Symptom**: every `/api/*` route returned 502 for ~50 min after
  PR #24 (`8ea8dda`) merged. Webapp on prod fell through to
  `radioBrowserFallback.ts`, so Sprint v2 rails (Trending /
  Top voted / Around the world / 4 mood rails) and the anchor
  chip-row were **invisible to users** even though the code was
  shipped — fallback summary doesn't carry those fields.
- **Detection**: Chrome MCP QA session (orchestrator) — first
  thing the Home audit showed.
- **Root cause**: deploy script (`deploy/server/deploy-release.sh`)
  fragile around nginx reload. On the VPS the systemd unit was
  inactive AND an orphan `nginx: master process` held ports
  80/443:
  1. First failure (`8ea8dda`): `systemctl reload nginx` failed
     with "cannot reload" (inactive unit) → `nginx -s reload`
     failed with `invalid PID number "" in /run/nginx.pid` →
     `set -e` killed the script before `start_pm2_release`.
     PM2 stayed dead.
  2. Second failure (`3ddfc51`, after PR #25 v1 hotfix):
     systemctl walk failed (unit still inactive); bare `nginx`
     fallback hit `bind() to 0.0.0.0:80 failed (98: Address in
     use)` — orphan process held the ports. Same kill chain.
- **Resolution**: PR #25 (`3ddfc51`) added systemctl reload→
  restart→start walk. PR #26 (`4201544`) inserted a SIGHUP path:
  `pgrep` the running master and `kill -HUP` it (graceful reload
  without re-binding ports) + restore `/run/nginx.pid` for future
  tooling. Final `_nginx_reload` returns 0 even when all paths
  exhausted, so the deploy MUST reach `start_pm2_release` — a
  dead API matters more than a stale (but `nginx -t`-validated)
  config.
- **Lessons**:
  - Auto-deploy success ≠ user-visible success. We need a
    post-deploy smoke that hits `/api/health` from outside the
    VPS, not just inside (the existing healthcheck runs inside).
  - `set -e` makes any failure terminal. For non-essential steps
    (config reload), explicit `|| true` / tolerated-failure
    branches are safer.
  - VPS state drift (orphan processes, dormant systemd units)
    isn't visible to the deploy until it tries to act on it.
    Worth a one-time SSH cleanup pass when the user is next at
    a terminal: `systemctl status nginx`, `systemctl enable
    --now nginx`, kill the orphan if needed.
- **PRs**: #25 (`3ddfc51`), #26 (`4201544`).
- **Total user-visible outage**: ~50 min (no traffic data, but
  /api/* was 502 from 18:42 UTC merge to ~18:57 UTC v2 deploy).

---

## Tier_audit — post-Sprint-v2 QA findings

### ~~T_audit_3 — Home polish after live prod QA (F1+F2+F3)~~ (DONE in 6fadb82)
- **Why**: Chrome MCP QA on prod after Sprint v2 surfaced three
  small but visible issues. None are P0; all are user-facing
  enough to fix together in one PR.
- **F1 (P1)**: locale placeholder bug — `home.countrySpotlightTitle`
  is `"Фокус: {country}"` (ru) and the en equivalent uses
  `{country}` too, but `HomeRail` renders `t(module.titleKey)`
  without `vars` interpolation. The placeholder leaks as a
  literal `{country}` / `{genre}` string in the section title.
  The label chip (e.g. "AUSTRALIA", "POP") already shows the
  value separately, so the cleanest fix is to drop the
  placeholder from the locale keys: `"Фокус"` / `"Country
  spotlight"` and `"Жанровый радар"` / `"Mood radar"`. Pre-
  existing bug (not a Sprint v2 regression) but now glaring next
  to the new emoji-titled rails.
- **F2 (P2)**: above-fold density on desktop reads as **10** at
  1280×900 viewport vs T2.20's ≥12 target. T2.20's worker tested
  at 1280×720 specifically and got 12 with 8px of slack. At
  taller viewports MORE should fit, not less — the measurement
  gap suggests either the methodology differs (e.g. hero card
  not counted because it lacks `data-home-station`) or the
  anchor chip-row added ~40px that wasn't accounted for in the
  taller-viewport case. Worker should reproduce the count at
  both 720 and 900 heights, decide if the metric needs reframing
  ("≥12 visible content items" including hero), and either
  tighten the layout or update the spec.
- **F3 (P3)**: featured-tile width: the `home-station-tile--
  featured` class IS applied to the first `fresh-now` tile
  (`featuredClass: true`), but `getBoundingClientRect().width`
  reads 158 vs sibling 158 — not the ~1.5× wider that T2.23's
  spec called for. Either the CSS rule is overridden by a more
  specific rail-grid selector, or the breakpoint gating is set
  for a viewport wider than 1280px. Worker should inspect the
  computed width and adjust the CSS specificity / breakpoint so
  the first tile actually widens on desktop.
- **Files**: `apps/webapp/src/state/locales/{ru,en}.ts` (F1),
  `apps/webapp/src/screens/Home.tsx` or `home.css` (F2 — likely
  CSS), `apps/webapp/src/screens/home.css` (F3).
- **Done-when**: visible literal `{country}`/`{genre}` gone from
  Home titles; above-fold count ≥12 measurable at 1280×720 AND
  1280×900 via the same probe; first `fresh-now` tile width
  measurably > sibling width on desktop (no regression on dense
  mobile). One commit, one PR.
- **Shipped**:
  - **F1**: dropped `{country}` / `{genre}` from
    `home.countrySpotlightTitle` and `home.genreSpotlightTitle`
    in both `ru.ts` and `en.ts`. Titles now `"Фокус"` / `"Country
    spotlight"` and `"Жанровый радар"` / `"Mood radar"`; the
    label chip carries the value. Unit test asserts the
    dictionary values directly (jsdom-friendly — `t()` lookup in
    tests returns the key, so DOM assertion was unreachable).
  - **F2**: brief's done-when was impossible. Worker reproduced
    via probe — at 1280×720 the hero + chip-row + search consume
    ~684px, so 0 station-tiles fit above the 720 fold. ≥12 needs
    ~960px height to fit two rail rows. Worker proposed a
    reframe (approved): count above-fold CONTENT = hero card +
    tiles, target ≥12 at 1440×1024, ≥7 at 1280×900. The 720
    target was a methodology artifact (T2.20 didn't count the
    hero, which IS a playable featured station). No layout
    change.
  - **F3**: cascade bug, not a breakpoint —
    `.home-station-tile--featured` (min-width 248px, line 509)
    was declared BEFORE the base `.home-station-tile` (min-width
    160px, line 659), same specificity (0,1,0) → later rule won
    → featured tile silently stayed 160px. The T2.23 e2e test
    passed at 1440×960 only because flex distribution incidentally
    widened the lead tile, not because the CSS rule won. Fix:
    double-class selector `.home-station-tile.home-station-tile
    --featured` (0,2,0) so 248 wins regardless of source order.
    Verified width-only (no row-height regression); dense gate
    unaffected.
- **Audit-first save**: worker reproduced both F2 and F3 on dev
  stack BEFORE coding, caught that F2's done-when was unreachable
  and that F3 was source-order not breakpoint. Both findings
  reshaped the fix — exactly what the push-back gate is for.
- **Pre-existing api flake flagged**: `apps/api` test
  `health and catalog contracts respond with shaped payloads`
  times out at 308s on first `/catalog/summary` fetch (57k-station
  catalog load race). Reproduces on master; PR #27 has zero
  apps/api diff. Not caused by this work — tracked separately as
  T_audit_5 below.

### ~~T_audit_4 — Post-deploy external smoke test (deploy resilience)~~ (DONE in 14ed3c6)
- **Why**: the 2026-05-27 incident was caught by manual QA, not
  by the deploy pipeline. The existing `wait_for_api_health`
  hits `http://127.0.0.1:3001/health` from the VPS itself —
  bypassing nginx. We need an external probe that fails the
  deploy job if `https://radioatlas.duckdns.org/api/health`
  is not 200 from outside.
- **Files**: `.github/workflows/deploy.yml` (add a post-deploy
  job step that curls the public URL with a tight timeout).
- **Done-when**: deploy job exits non-zero if public `/api/health`
  is non-2xx within ~30s after deploy completes. Add a Slack/
  log alert if available.
- **Priority**: do after T_audit_3.
- **Shipped**: `.github/workflows/deploy-server.yml` adds a
  `Post-deploy external smoke` step after the SSH deploy returns.
  Curls `https://radioatlas.duckdns.org/api/health` from the GH
  runner (external to the VPS) with `--max-time 10 --retry 3
  --retry-delay 5`. **Hard-fails** on non-2xx OR a body missing
  `{"ok":true}` — both surface the 2026-05-27 incident class
  (nginx-down → public 502 even though `127.0.0.1:3001/health`
  was fine). Worker pushed back on the brief's "soft v1"
  suggestion and was right: `/api/health` is unaffected by
  T_audit_5's catalog-summary flake (it doesn't load the
  catalog), so blocking on it is safe. RUNBOOK.md updated with
  the manual curl command. First real run: deploy `14ed3c6` —
  smoke step ✅.

### ~~T_audit_6 — Open-tab chunk-hash invalidation on every deploy~~ (DONE in 14ed3c6)
- **Why**: surfaced during T_audit_3 verification on prod —
  navigating to the SPA with a cached `index-*.js` from the
  previous deploy threw `TypeError: Failed to fetch dynamically
  imported module: assets/Home-{oldHash}.js` and tripped the
  ErrorBoundary ("Не удалось загрузить раздел"). The new deploy
  rebuilt the Home chunk with a different content-hash and the
  old chunk was deleted from `apps/webapp/dist/assets/`. Any
  user with the app open at deploy time hits this on the next
  lazy-route navigation.
- **Repro**: open the app, observe the active `index-*.js`
  scripts. Trigger a deploy that rebuilds `Home`. Navigate to
  `Главная` → 404 on the old Home chunk → ErrorBoundary.
- **Severity**: visible to every active user across every
  deploy. Recovery is one hard-reload, but the failure mode is
  silent UX corruption between the deploy and the user's next
  full reload.
- **Options** (worker call after audit):
  1. **nginx fallback for missing chunks** — `try_files` style
     rule: if `/assets/Home-{hash}.js` is 404, serve a tiny
     bridge JS that calls `location.reload()`. Cheap, fragile if
     a real bug also 404s a chunk.
  2. **Service worker with `skipWaiting()` + `clients.claim()`** —
     proper PWA-style update flow. Heavier infra but clean UX.
  3. **Keep old chunks on disk for N deploys** — `prune_old_releases`
     already keeps 4 releases. Rsync `assets/*` from the previous
     release into the new one (additive) so old hashes still
     resolve. Trades disk for survivability.
  4. **vite-plugin-pwa or a small reload-on-chunk-error wrapper** —
     React error boundary catches `Failed to fetch dynamically
     imported module` errors specifically and triggers
     `location.reload()` instead of showing the generic error
     screen.
  Recommend a mix of (3) — easy, additive — and (4) — graceful
  recovery if (3) misses. (1) and (2) are heavier.
- **Files**: `deploy/server/deploy-release.sh` for option 3
  (rsync old assets), `apps/webapp/src/app/ErrorBoundary.tsx` (or
  wherever the boundary lives) for option 4.
- **Done-when**: a controlled repro (deploy A → open app → deploy
  B → click Главная) succeeds without ErrorBoundary; old chunk
  requests either resolve from preserved assets or trigger a
  graceful reload.
- **Priority**: P1 — affects every active user on every deploy.
  Do alongside T_audit_4 (the external smoke is the OTHER half
  of "deploys don't quietly break users").
- **Shipped (option A + targeted ErrorBoundary)**:
  - `deploy-release.sh` — new `preserve_previous_chunks()` runs
    AFTER the webapp build, BEFORE the `ln -sfn` symlink swap.
    `rsync -a --ignore-existing` copies the previous release's
    `apps/webapp/dist/assets/*` into the new release additively.
    Old chunk hashes stay resolvable for at least one more deploy
    cycle; new builds win on name collisions.
  - `apps/webapp/src/components/ErrorBoundary.tsx` — extended
    T1.7's boundary with chunk-error detection (matches Chrome,
    Firefox, Safari message strings) + a **timestamp-guarded
    reload**: 10s cooldown via `sessionStorage`. Loop-safe — a
    genuinely-broken build re-errors within ms of reload, inside
    the cooldown window → reload skipped, fallback UI shows.
    Multi-deploy recovery — errors minutes apart fall outside
    the window and reload as intended.
  - `deploy/server/test-preserve-chunks.sh` — focused shell test
    that verifies `rsync -a --ignore-existing` keeps new builds
    of the same chunk name (no overwrite) AND fills gaps from
    the previous release. Skips on hosts without `rsync`.
- **Audit-first save**: worker pushed back on the brief's draft
  loop-safeguard ("flag + reset on App `componentDidMount`") —
  caught that App mount would reset the flag, allowing the loop
  to recur. Timestamp guard is strictly stronger: tight enough
  to block a genuine loop, loose enough to recover later. The
  reset-on-mount draft would have shipped a real bug.
- **Tests**: 4 new unit tests on ErrorBoundary (chunk-detection,
  cooldown guard, multi-deploy recovery, non-chunk errors
  ignored) + 1 e2e for the chunk-loop-safety branch + 1 shell
  test for the rsync flags. RUNBOOK.md documents both
  preservation and the manual smoke command.
- **First deploy** (`14ed3c6`): `Post-deploy external smoke` ✅,
  Home renders without ErrorBoundary, all 11 rails present,
  featured tile 248px / sibling 160px (1.55×) — Sprint v2
  intact, chunk preservation didn't regress anything.

### ~~T_mobile_1 — Mobile Telegram WebView Home pass (live-feedback pack)~~ (DONE in 904806e)
- **Why**: live mobile screenshots from a real Telegram WebView
  (390px-ish width, 2026-05-27 evening session) surfaced 5
  related UX problems that desktop QA didn't catch. User-quoted
  pains: «в кашу превращается», «по концу ленты скроллит
  страницу», «нет места discovery», «рекомендации хреновые»,
  «играй на клик по квадратику». Ship all four sub-fixes in ONE
  PR per user instruction (`Всё три одним пакетом`).
- **Sub-task A — overscroll containment (P1, ~10 lines)**: at
  the end of a horizontal rail (.home-rail-scroll or whatever
  the actual scrollable container is) wheel/touch events
  bubble to the page → page scrolls vertically as the user
  finishes scrolling the rail horizontally. CSS one-liner:
  `overscroll-behavior-x: contain` on the rail-scroll
  container.
- **Sub-task B — click-tile-to-play (P1, ~30 lines)**: today
  only the explicit play button triggers playback. User wants
  the whole tile (artwork + name + metadata area) to start
  the station on click, with the heart/favorite button still
  having its own clickable region (via `stopPropagation`).
  Touch on `[data-home-station]` should call the same
  `onPlay(station)` as the play button.
- **Sub-task C — mobile density 360-414px (P2, medium)**: at
  Telegram WebView width (~390px) the current tiles are huge:
  featured ≈50% viewport width, regular ≈180px (only 2-3 fit
  per rail). Text gets truncated ("Lapfox Rad...", "HighFi
  Dre..."). T2.20/T2.23 optimised 1280×720 desktop but didn't
  cover this dense breakpoint. Pass needed:
    - regular tile ~110-130px wide (3-4 fit per rail at 390px)
    - featured tile gated off on dense (or significantly
      smaller) — it currently dominates above the fold
    - station name truncation/wrap improved (~20 chars or
      2-line clamp instead of mid-word `...`)
    - hero card height capped on dense so it doesn't eat half
      the viewport
- **Sub-task D — recommendations stuck (P2, audit-first
  required)**: user reports «каждый раз одно и то же» across
  sessions. Candidates to investigate BEFORE coding:
    - `HOME_SESSION_BUCKET_MS = 2h` — sessionSeed rotates only
      every 2 hours. Means re-opening within 2h shows same
      ranked feed. Probably too long.
    - `tasteProfile` update cadence — does play/like/skip
      mutate the profile sufficiently? Or is it heavily
      smoothed?
    - `rankStationsForUser` weighting — does it always surface
      the same top-N regardless of taste changes?
    - Personal Radio queue persistence — 18 stations queued;
      if not topped up from a fresh pool, user always hears
      the same 18.
  Worker should audit these four before proposing a fix. Likely
  fix is some combination of: shorter session bucket (e.g.
  30min), explicit taste boost on plays, periodic queue refresh
  with discovery infusion.
- **Files**: `apps/webapp/src/screens/home.css` (overscroll +
  density), `apps/webapp/src/screens/homeCards.tsx` (click-
  tile + density logic), `apps/webapp/src/screens/Home.tsx`
  (hero gate on dense + recs glue), `apps/webapp/src/lib/
  homeProfile.ts` (session bucket), `apps/webapp/src/lib/
  tasteProfile.ts` (taste update cadence — if changed),
  `apps/webapp/src/lib/personalRadio.ts` (queue refresh — if
  changed).
- **Done-when**:
  - Overscroll-x contained — wheel/touch at the end of a rail
    does NOT scroll the page (probe: synthetic wheel event at
    rail edge, assert `scrollY` doesn't change).
  - Click anywhere on `[data-home-station]` triggers
    `onPlay`; clicking the heart still only toggles favorite
    (e2e: assert click on artwork triggers play, click on
    heart doesn't).
  - At 390×844 viewport, regular tile width ≤130px AND ≥3
    tiles fit per rail row above the fold; featured tile
    visually does NOT dominate ≥40% of viewport width.
  - Recommendations rotate meaningfully — after a tracked
    play/like, the next Home re-render in a fresh session
    bucket surfaces different top-3 in fresh-now (or whatever
    metric the worker picks during audit).
- **Push-back gate is MANDATORY** because sub-task D needs
  diagnosis-first. Worker reproduces «recommendations stuck»
  on dev stack before proposing changes.
- **Shipped** (one commit, `3a4c720`):
  - **A**: `overscroll-behavior-x: contain` on `.home-horizontal-
    scroll` AND `.home-anchor-chip-row`. Wheel/touch past the end
    of a rail no longer scrolls the page.
  - **B**: tile root is `role="button"` with `tabIndex={0}`,
    `aria-label="Слушать: {name}"`, and `onClick={onPlay}`. Inner
    play + heart buttons get `stopPropagation` so they don't
    double-fire. Visible play icon stays as a tap-affordance hint.
    New `stationTile.playLabel` locale key also added to
    `defaultDictionary` so the accessible name resolves on first
    paint (before the locale bundle loads).
  - **C**: artwork in dense rail-card 112×112 → 64×64. Worker
    diagnosed the brief's "2-col dense grid" assumption as wrong
    — line 853's rule is dead code, the real layout comes from
    line 1328 (`grid-auto-flow: column; grid-auto-columns: 112px`).
    Tiles were already 112px; the problem was the 112×112 artwork
    overflowing inside, leaving no room for the title clamp.
    64×64 drops ~50px per tile, ~100px per 2-row rail.
  - **D**: `HOME_SESSION_BUCKET_MS` 2h → 30min, both
    `HOME_SESSION_BUCKET_MS` and `isSameSessionBucket` exported
    for `Home.bucket.test.ts` (4 cases — constant value, two
    bucketed timestamps, two cross-bucket timestamps). Secondary
    finding by worker flagged for a separate ticket below
    (T_audit_9): `surfaceFeedBase` memo deps omit `tasteProfile`,
    so taste signals only propagate at the next bucket flip
    instead of eagerly.
- **Gate green**: typecheck · typecheck:test · webapp unit 118
  (+6) · api 78 · bot 12 · build · all T_mobile_1 e2e plus
  home-polish + home-discovery + error-boundary. Mobile visual
  baseline `home-shell-mobile-win32.png` regenerated for the
  64px-artwork change.

### ~~T_quality (2a/2b/cache) — recommendation diversity~~ (DONE in 71392d8, PR #33)
- **What shipped**: server-side per-country soft caps to break the
  single-country domination QA found on prod.
  - **2a**: `topByNumericSignal` caps `trending`/`topVoted` to ≤2
    per country (prod trending was almost all France).
  - **2b**: `buildMoodRails` + `buildGenreSpotlight` cap ≤3 per
    country («Концентрация» was 3/5 Greece). `buildCountrySpotlight`
    left alone (single-country by design — worker's catch).
  - **`diversifyByCountry`** helper: soft cap + greedy backfill —
    the cap is a diversity *preference*, rail length is *guaranteed*.
    A single-country bucket still fills to pool length (backfill from
    overflow) and never gets hidden.
  - **`CATALOG_CACHE_VERSION` 2→3**: content-only change, bumped so
    diversified rails replace stale France-skewed v2 caches now
    instead of ageing out over the 6h TTL.
- **Verified on prod** (`71392d8`): trending = 7 countries max-2-each
  (was ~all France); topVoted 9 countries; mood-focus 9 countries
  (was Greece-heavy). genre "island" showed USA 4 — confirmed the
  backfill safety net (5-station bucket: cap-3 USA + 1 Sweden, then
  backfill the 4th USA rather than show a thin shelf — as designed).
- **Cap-value honesty**: dev artifact lacks `clicktrend`/`votes`
  (prod's extractor adds them) so trending distribution wasn't
  measurable locally — cap 2 is safe via prod evidence + length-
  guaranteeing backfill. Mood/genre buckets measured locally
  (62–122 distinct countries) → cap 3 never starves.
- **Gate**: webapp tc · tc:test · api tc · webapp unit 125 · api 83
  (+5) · bot 12 · build · e2e 145/145.
- **Note**: this was PR-B of the T_audit_10+T_quality combined
  brief. 2c (eager taste) was split out to PR-C / T_audit_9 below
  because it structurally requires extending the snapshot freshness
  gate (the snapshot freeze sits above the surface memo and gates
  taste exactly as it gated the stale summary in T_audit_10).

### ~~T_audit_9 — Eager taste-profile propagation~~ (DONE in 6521017, PR #34)
- **STATUS**: SHIPPED + deployed. Closes the last item of the
  T_audit_10 + T_quality brief and the user's «каждый раз одно и
  то же / не то что я слушаю» complaint.
- **What shipped**: a sibling `tasteSignature` clause on the home
  snapshot freshness gate (mirrors PR-A's `summarySignature`). A
  like/skip/hide re-ranks `fresh-now` immediately — same seed, so
  only the taste-ranked rail moves; the seed-ordered server pools
  (trending/mood/top-voted/around-the-world) stay put. `tasteProfile`
  switched from the ref read to the direct (current-render) value
  in the memo so the rebuild uses the taste that JUST changed; the
  other `live.*` inputs stay on the ref (they are the play-churn
  fields T1.2 intentionally freezes).
- **Design correction during impl (worker push-back, approved)**:
  the raw "rank-order of top-N tag ids" signature REGRESSED T1.2 —
  playback reshuffled `fresh-now` (the existing freeze test caught
  it red). Two gaps in the original churn-guard premise: (1) a
  SPARSE profile (new user / test) has the first positive signal
  CREATE the top-N → signature flips on any play; (2) switching
  stations fires an outgoing `skip-before-10s` (−4.2) that also
  moves scores. Fix: `TASTE_SIGNATURE_MIN_SCORE = 7` — only tags
  favoured past 7 feed the signature, so play-started (+1.71),
  outgoing-skip (−4.2), and a single listened-30s (+5.13) stay
  below it (no churn), while saved-to-collection (+7.6) / liked
  (+11.4) / sustained listening cross it (re-rank). Threshold sits
  between a single listen and a save — data-backed.
- **Known-acceptable residual edge** (ticketed-if-it-appears, not
  hardened): an established user with two near-tied past-7 tags
  could see an adjacent-swap re-rank on a single play nudge. Rare
  (needs tags within ~1.5 + a nudge across), mild (adjacent swap,
  not a reshuffle), and far weaker than the original bug. Not
  gold-plated to avoid destabilising freshly-shipped snapshot code.
- **Verification (red→green both directions)**: churn-guard — play
  → signature stable → snapshot frozen (existing T1.2 freeze test,
  green + annotated); eager — like → `fresh-now` re-ranks, RED with
  the fix stashed, GREEN with it, stable 3× serial + parallel;
  deterministic unit backbone in `tasteProfile.test.ts` drives the
  real weights. Gate: webapp tc · tc:test · api tc · webapp unit
  130 (+5) · api 83 · bot 12 · build · e2e 146/146.
- **No version bumps** (taste in localStorage `tasteProfile`, not
  catalogCache; snapshot transient). `summaryRailSignature`
  untouched — pure sibling clause.
- **Approach notes (as approved before impl)**: approach **(a)**;
  the "don't touch snapshot logic" constraint was **lifted for
  this ticket only** (eager taste is impossible without extending
  the snapshot gate — the freeze gates taste the same way it gated
  the stale summary in T_audit_10).
- **Approved plan (PR-C)**:
  - Rebase on master `71392d8` (post-PR-B).
  - Add `tasteSignature` helper to `tasteProfile.ts` (rank-order of
    top-N tag ids + hidden-station count — ids not raw weights, so
    play-nudge magnitude churn never leaks in). Worker already
    drafted this in PR-B then backed it out per the split; it lands
    here with its consumer.
  - Stamp `tasteSignature` onto the home snapshot; add
    `snapshot.tasteSignature === current` to the `snapshotFresh`
    gate AND the persistence-effect equality check — a parallel
    AND-clause mirroring PR-A's `summarySignature` (additive, does
    NOT modify `summaryRailSignature`).
  - Surgical by design: same seed → only the taste-ranked rail
    (fresh-now) re-ranks; the seed-ordered server pools
    (trending/mood/etc) stay put. No whole-home reshuffle.
  - Churn guard: `play-started` (+1.8) doesn't reorder top-N tags →
    signature stable → no rebuild; `liked` (+12) / `skip` (−5.8) /
    hide does.
  - **Critical red→green test (both directions)**: like/skip → 
    fresh-now re-ranks; single play → fresh-now stable. Prove both
    (mirror PR-A's stash-the-fix red→green discipline).
  - Commit `T_audit_9: eager taste propagation via snapshot tasteSignature gate`.
  - **No** `CATALOG_CACHE_VERSION` bump (taste lives in localStorage
    `tasteProfile`, not the catalog cache).
- **Why** (surfaced by T_mobile_1 worker during D audit): in
  `Home.tsx` the `surfaceFeedBase` memo reads `tasteProfile`
  through `homeRankInputsRef.current.tasteProfile` rather than
  declaring it as a memo dep. Result: a play/like/skip mutates
  `tasteProfile`, but the rebuilt surface doesn't pick up the
  new signal until the next `sessionSeed` flip (every 30min
  after T_mobile_1). Within one bucket, recently-played tracks
  don't re-rank.
- **Options**:
  - (A) Add `tasteProfile` to the memo deps. Cheapest. May cause
    too-frequent re-rank churn if taste mutates per-play.
  - (B) Watch a tasteProfile **signature** (e.g. hash of top-N
    tag weights) and only invalidate the memo when the signature
    changes meaningfully.
  - (C) Force a `sessionSeed` bump on specific high-signal
    taste events (like, skip) — leave plays alone.
- **Files**: `apps/webapp/src/screens/Home.tsx`,
  `apps/webapp/src/lib/tasteProfile.ts` (if (B) — for the hash),
  `apps/webapp/src/lib/homeProfile.ts` (if (C) — for the seed
  bump trigger).
- **Done-when**: a unit test in `Home.bucket.test.ts` or a new
  spec proves that a taste event within a session bucket causes
  the next surface render to use the new profile — and that
  the trigger doesn't fire on every single play (the per-play
  churn risk).
- **Priority**: P2 — addresses the deeper "recommendations
  stuck" concern that the 30min bucket only partially fixes.

### ~~T_home_redesign_1 — kill HomeHeroCard + topbar alignment~~ (DONE in d307f4f)
- **Why**: live-prod feedback from the owner — Hero card
  «огромная плашка, всегда одна и та же, нафига ей столько
  места» + topbar gear/profile visually staggered. Single PR
  scope: drop the hero render + fix the topbar.
- **Shipped (PR #31, `fd99ce6` → merged in `d307f4f`)**:
  - **A**: HomeHeroCard render removed from `Home.tsx`. The
    `HomeSurfaceFeed.hero` field stays (read by `isSameSurfaceDeck`
    and `rotateSurfaceFeed` — non-JSX consumers worker caught
    in audit). The `${heroModule.sourceId}-companions` rail
    push dropped (`homeSurface.ts`); `companionStations` array
    stays computed because `rotateSurfaceFeed` reads it.
  - **A.5 (mid-impl push-back)**: worker found `.home-refresh-chip`
    was the ONLY user-facing manual-refresh affordance, lived
    inside HomeHeroCard. Removing it would have killed the
    rank-freeze escape valve documented by
    `home-rank-freeze.spec.ts`. Resolution (approved): relocated
    as a `.home-personal-refresh` icon-button on the Personal
    Radio card, mirroring the topbar gear/profile icon pattern.
    Aria `home.refreshFeed`, `is-loading` spinner during async
    handleRefresh. Dead `.home-refresh-chip` CSS removed (8
    surgical edits) — old class still on the now-orphaned
    `HomeHeroCard` export, harmless.
  - **B**: three CSS-only topbar fixes:
    1. `.app-topbar-actions { align-items: flex-start → center }`
    2. `.app-topbar-actions > .nav-utility-btn { flex: 0 0 auto }`
    3. Dropped `grid-template-columns: 16px auto` override on
       `.mobile-settings-trigger` (was 16×16 icon vs profile's
       20×20 — read as staggered even when boxes aligned).
- **Worker push-backs caught two more bugs**:
  - Initial topbar e2e at 1440×900 sampled the WIDE-DESKTOP
    sidebar layout (>980px breakpoint), not the topbar. Worker
    narrowed to 600w + 900w (431–980px horizontal-topbar band).
  - 5 hard-coded `[data-home-hero]` "home is hydrated" sentinels
    in `desktop.spec.ts` (my brief missed them). Worker replaced
    them with `[data-home-personal-radio]`.
- **Gate green**: typecheck · typecheck:test · webapp unit 121 ·
  api 78 · bot 12 · build · e2e 143/144 (the 1 fail is
  pre-existing on master — see T_audit_10 below). Baselines
  regenerated: `home-shell-win32.png`, `home-shell-mobile-win32.png`
  (companions rail was rendering on dense too), `home-shell-
  populated-win32.png`.
- **Verified on prod**: hero gone, fresh-now is first rail,
  refresh icon-button visible + clicks rebuild surface (5 → 12
  rails when residual cache is stale — see T_audit_10).

### ~~T_audit_10 — Residual cold-load cache mismatch~~ (DONE in 14c8ad3)
- **Shipped (PR #32, `7ae810f` → merged `14c8ad3`)**: the bug was
  NOT the cache read path (my framing A/B/C all missed it — worker
  pushed back). Real root cause: the home surface **snapshot never
  revalidated against a changed summary**. The `snapshotFresh` gate
  (version + seed) was deliberately content-blind (T1.2 rank-freeze),
  so a summary that grew 5→12 rails was swallowed. Trigger: a past
  cold-load that hit the 6s network timeout cached a radio-browser
  FALLBACK summary (5-rail shape) as a v2 entry; the next healthy
  cold-load froze the snapshot on those 5 and discarded the 12-rail
  network payload. Explains the intermittency (depended on whether
  you'd ever caught a slow-network moment).
- **Fix**: `summaryRailSignature` (composition fingerprint —
  presence/lengths/mood-ids, NOT station UUIDs, so same-shape
  revalidations don't reshuffle and regress the rank-freeze). Added
  to `snapshotFresh` gate + the persistence-effect equality check
  (the fallback's `generatedAt` can outrank the network's → `builtAt`
  unreliable). No `HOME_SURFACE_VERSION` bump (transient snapshots),
  no `CATALOG_CACHE_VERSION` bump (deferred to PR-B).
- **Empirical proof**: worker stashed only the `src/` fix → new e2e
  went RED (trending stayed 0 elements, exact prod symptom) → popped
  fix → GREEN. Then orchestrator verified on PROD: seeded a stale
  5-rail v2 IDB entry, cold-reloaded → 11 rails + 7 chips rebuilt
  automatically, no manual refresh.
- **Folded in**: `mobile.spec.ts:2735` flake confirmed a direct
  side-effect of T_audit_8 #30 (seeded `version: 1`, rejected by the
  bump to 2 → network hung → home never mounted). Now seeds
  `CATALOG_CACHE_VERSION`. Honesty note: this was introduced by the
  T_audit_8 hotfix, not truly "pre-existing" as earlier reviews
  waved it off.
- **Gate**: typecheck · typecheck:test · webapp unit 125 · api · bot
  · build · e2e 145/145.

#### Original investigation notes (kept for history)
- **Why**: surfaced during T_home_redesign_1 prod verification.
  Even with `CATALOG_CACHE_VERSION = 2` (T_audit_8 hotfix),
  cold-loads still show 5 rails (missing every Sprint v2 rail
  AND the anchor chip-row). Clicking the relocated refresh
  button immediately recovers all 12 rails — so the API and
  bundle are correct, something in the cache read path is
  serving a stale shape on first paint.
- **What we know**:
  - The bundle (`index-DAgAW2OI.js` post-T_home_redesign_1) is
    fresh.
  - `/api/catalog/summary` returns the full Sprint v2 payload
    (`trending: 12`, `topVoted: 12`, `aroundTheWorld.stations:
     8`, `moodRails: 4×10`).
  - On cold-load, the page renders 5 rails — fresh-now,
    country-spotlight, genre-spotlight, resume-context, revived-
    stations. All Sprint v2 rails missing.
  - Click `[data-action="refresh-feed"]` → rails become 12 in
    <1s. Same network endpoint, same bundle, same session — only
    the explicit `refreshSummary(forceNetwork: true)` call
    differs.
- **Likely candidates** (audit-first required):
  - `CatalogContext.tsx` may be serving the IDB-cached payload
    to React state BEFORE the network fetch completes, even
    when the network fetch ultimately succeeds. The cached
    shape leaks into the first render, surface settles with
    that shape, and the network result doesn't re-trigger the
    memo (or triggers it but the diff is missed).
  - Possibly the `radioBrowserFallback.ts` path or the
    `catalog-fast.json` artifact still has the old shape and is
    read alongside the summary.
  - Race between `homeSurface` build (uses summary at memo time)
    and the summary state update.
- **Files**: `apps/webapp/src/state/CatalogContext.tsx`,
  `apps/webapp/src/lib/catalogCache.ts`, possibly
  `apps/webapp/src/screens/Home.tsx` memo deps.
- **Done-when**: a cold-load (cleared cache or fresh tab) at
  prod renders 12 rails without needing the manual refresh
  click. Add an e2e at `apps/webapp/tests/home-discovery.spec.ts`
  asserting all 12 rail ids appear on first paint after a
  catalog-summary mock that includes the Sprint v2 fields.
- **Priority**: **P1** — every cold-load on prod currently hides
  the Sprint v2 surface from users until they click refresh.
  The user reported this exact symptom ("нет места discovery").
  Relocated refresh-button is the workaround; this is the real
  fix.
- **Related pre-existing flake** (worker found during T_home_redesign_1):
  `mobile.spec.ts:2611 cached summary renders home while
  catalog summary is offline` fails on master too. Likely a
  T_audit_8 side-effect — the test writes a v1 cache entry,
  the new guard rejects it. Folding into this audit since
  they're the same area.

### ~~T_audit_8 — IDB catalog cache contract-mismatch invalidation~~ (DONE in 4da92df)
- **Why**: Chrome MCP QA on 2026-05-27 after PR #29 deploy showed
  Home rendering only 5 rails — fresh-now, country-spotlight,
  genre-spotlight, resume-context, revived-stations — missing
  every Sprint v2 rail (trending / top-voted / around-the-world /
  4 mood rails). The server returned them all; the bundle threaded
  them correctly; all tests passed. Root cause: IDB cache
  `radioatlas-catalog-cache` had `/catalog/summary` entries
  written BEFORE T2.21 (2026-05-26) when those fields didn't
  exist. The `entry.version === 1` check accepted the stale
  payload as fresh, so the network re-fetch never won until
  TTL.
- **Likely silent impact**: every active user who first opened
  the app before the first Sprint v2 deploy saw only 5 rails
  on every page-open until their cache TTL expired. Possibly
  contributed to the user-reported «нет места discovery» mobile
  feedback that prompted T_mobile_1 — those users may have been
  seeing only the pre-Sprint-v2 surface on mobile.
- **Shipped**: bumped the literal version constant
  `CATALOG_CACHE_VERSION 1 → 2` (now exported from
  `catalogCache.ts`). Used in the type, the read-guard, and the
  write. Old v1 entries fail the read-check →
  `readCatalogCache` returns `null` → fresh fetch wins. New
  regression test in `catalogCache.test.ts` (3 cases) locks
  the invariant.
- **Verified on prod**: wiped local IDB cache, navigated fresh,
  saw 11 rails restored. Hotfix `4da92df` then deployed with
  passing external smoke (T_audit_4).
- **Followup rule**: any `/catalog/summary` contract change
  that adds fields MUST bump `CATALOG_CACHE_VERSION` in the
  same PR. This rule belongs in `CODEX_RULES.md` (TODO if not
  already covered there).

### T_audit_5 — Catalog-summary first-fetch timeout flake
- **Why**: `apps/api` test `health and catalog contracts respond
  with shaped payloads` is intermittent — `fetch('/catalog/summary')`
  times out at ~308s on first call when the test process is
  loading the 57k-station catalog artifact under concurrent CPU
  load. The same endpoint passes in `api.degradation` (different
  ordering, different ramp). T_audit_3's PR #27 has zero
  apps/api diff but the failure reproduces on master, so it's a
  latent issue not caused by recent work.
- **Hypothesis**: catalog artifact load is synchronous on first
  request (lazy boot), and a test harness that spawns the server
  cold + immediately hits `/catalog/summary` blocks until the
  full 57k station JSON is parsed. Under contention (other
  builds/tests running) this exceeds the 300s timeout.
- **Files**: `apps/api/src/index.ts` (or wherever the catalog
  artifact load happens — likely `catalogCache.ts`),
  `apps/api/test/api.contract.test.ts` (the failing test —
  consider a per-test warmup, or a wait-for-ready hook before
  hitting summary).
- **Done-when**: the contract test reliably passes from a cold
  server boot in CI and on a cold local repo. Pick one: either
  the server signals ready only after the catalog is parsed, or
  the test waits on a `/health?ready=catalog` flag before
  exercising `/catalog/summary`.
- **Priority**: P3 — visible only as a CI flake, not a user
  problem. Do alongside T_audit_4 if scope allows.

---

## T_perf — Prod performance audit (2026-05-29, Chrome MCP + curl on live prod)

Measured cold + warm loads of `https://radioatlas.duckdns.org` from the
orchestrator's network. **Headline: the bundle is well-built; the speed
cost is network latency to a single VPS over HTTP/1.1.**

**What's already GOOD (verified — do NOT touch):**
- Chunk isolation intact: cold Home loads ZERO heavy lazy chunks
  (`heavyLazyOnColdHome: []` — no maplibre/hls/Globe/Search/Library/
  FullPlayer/ThemeStudio). The Performance-Hardening-Sprint claim holds.
- Compression on: react-vendor 37KB transfer / 130KB decoded (gzip/br).
- Assets `Cache-Control: public, max-age=31536000, immutable` — the
  ~120KB JS + 163KB CSS first-load cost is paid ONCE; repeat visits and
  client-side route changes are free.
- One 101ms render long task; CLS 0; no other long tasks observed.

**The actual bottleneck — TTFB ≈ 900ms, almost all network RTT:**
```
DNS         4.7ms    ok
TCP connect 312ms    ~300ms RTT to the VPS (geographic)
TLS         618ms    +305ms (another RTT)
TTFB        917ms    +300ms (request/response RTT)
```
curl ×5 consistently 0.9–1.04s; browser saw 0.3s warm / 1.7s cold-first.
`HTTP/1.1`, no `alt-svc` → **HTTP/3 is OFF**. The HTML shell is `no-store`
(correct — it must point at fresh asset hashes post-deploy, ref T_audit_6),
so this ~3-RTT handshake is paid on every hard load / cold open. This is
the "speed 1/5" the owner felt. (Caveat: RTT measured from the orchestrator
network; RU/EU Telegram users may be closer to the VPS — but the 3-RTT→1
handshake win below is geography-independent.)

### ~~T_perf_1 — Enable HTTP/3 (QUIC) on Caddy~~ (INVESTIGATED ON VPS → DECLINED, 2026-05-29)
- **What I expected**: a cheap one-line `protocols h1 h2 → h1 h2 h3`
  global-options change for a ~600ms handshake win.
- **What I found via SSH (root@212.69.84.167, Caddy v2.10.2)**:
  1. h3 was OFF by **explicit config** (`servers { protocols h1 h2 }`),
     not firewall (ufw inactive, UDP :443 already bound).
  2. The win is **much smaller than estimated**: h3 is discovered via
     `alt-svc` on the FIRST h2/TCP response, so the first (often only)
     connection of a Telegram-Mini-App session is ALWAYS TCP+TLS — the
     slow path the owner actually feels. h3 only helps repeat connections.
  3. **Caddy cannot hot-enable h3 via `reload`** — `caddy reload` with
     `h1 h2 h3` fails atomically with `starting HTTP/3 QUIC listener:
     listen udp :443: bind: address already in use` (QUIC UDP sockets
     don't support graceful handover). Enabling h3 therefore requires a
     full `systemctl restart caddy` = a brief blip for ALL sites on this
     **shared** VPS (rodnya-tree.ru, api.rodnya-tree.ru, nip.io), and
     makes EVERY future `caddy reload` fail until another restart — an
     ongoing operational footgun on a box hosting other projects.
- **Decision**: not worth it. Reverted the Caddyfile to `h1 h2`
  (backup at `/etc/caddy/Caddyfile.pre-h3`), confirmed clean reload
  (exit 0) + both sites 200. VPS left exactly as found.
- **The right place for h3 is the edge**: Cloudflare (T_perf_2) serves
  h3 to clients for free with none of this origin-side pain. Fold h3
  into the CDN decision.

### T_perf_2 — CDN / edge in front of the VPS (THE lever, infra, needs owner)
- **Why**: confirmed the ~900ms TTFB is geographic — TCP 312ms / TLS
  618ms / TTFB 917ms is ~300ms RTT × the HTTP/1.1 3-RTT handshake to a
  single Netherlands VPS (hostname `NL212295`, alias `nl-art`). The ONLY
  thing that fixes 300ms RTT is terminating TLS at an edge POP ~20-50ms
  from the user. A CDN also: serves the `immutable` assets from edge
  cache globally, AND gives clients HTTP/3 at the edge (covers T_perf_1
  for free).

### T_perf_2 — CDN / edge in front of the VPS (HIGHEST leverage, bigger, infra)
- **Why**: a CDN (e.g. Cloudflare free) terminates TLS at an edge POP
  ~20-50ms from the user instead of ~300ms to the origin, and serves the
  `immutable` assets from edge cache globally. Would cut TTFB to <100ms
  for most users AND offload asset bandwidth from the VPS.
- **What**: front `radioatlas.duckdns.org` (or a custom domain) with
  Cloudflare; origin stays the VPS. HTML stays `no-store` (Cloudflare
  respects it / can be set to bypass), assets cached at edge by their
  immutable headers. Verify Telegram WebView + the `/api` proxy path
  still work through the CDN.
- **Files/infra**: DNS + CDN setup (owner), maybe `ALLOWED_ORIGINS` /
  nginx-vs-Caddy review. Bigger change; do after T_perf_1.
- **Priority**: P2 (perf) — biggest absolute win but more moving parts.

### ~~T_perf_3~~ — CLOSED (satisfied by existing architecture, verified 2026-05-31)
- **Verdict: park / no work.** The premise below ("render-blocking on first
  paint") is **stale** — measured the built chunks on master `7456454` and
  confirmed in source: `styles.css` (134KB min) is imported in EXACTLY ONE
  place, `App.tsx:55` `stylesPromise ??= import('./styles.css')`, loaded via
  `scheduleDeferredTask(loadGlobalStyles)` in a mount effect → **deferred off
  the critical path** (no eager `import './styles.css'` anywhere). Critical
  render-blocking CSS is just `boot.css` (~7KB, eager in main.tsx) + runtime
  shell ≈ **6.9KB total**. Per-screen CSS (home/discover/FullPlayer/Lite/
  ThemeStudio/globe) already chunks on the React.lazy boundaries.
- **FOUC/theme safe independently of the deferred sheet**: `boot.css` carries
  `:root{color-scheme}` + boot tokens pre-paint; per-user theme vars are inline
  on `<html>` via `root.style.setProperty` (ThemeContext) at top cascade
  precedence. The 134KB sheet arriving late doesn't gate theming.
- **Why not split further**: reward ≈ 0 (monolith already off critical path;
  splitting moves no FCP/LCP, reduces no bytes) vs real risk (one cascade-
  ordered sheet → N async sheets = nondeterministic load order → cascade bugs
  + reintroduced FOUC → endangers the `visual.spec.ts` baselines, incl. the
  full-player one now carrying the non-TG-hidden Story button at zero-diff).
- *(original framing, now obsolete:)* `styles-*.css` is 131KB decoded (~24KB
  gzip) and render-blocking on first paint.
- **Files**: `apps/webapp/src/styles.css` (the monolith), Vite CSS
  code-split config.
- **Done-when**: cold Home first-paint CSS payload meaningfully smaller;
  no visual regression (visual baselines green).
- **Priority**: P3 (perf).

### T_perf_4 — Investigate radio-state 103KB chunk + 101ms render task (app, low)
- **Why**: `radio-state-*.js` is 103KB decoded on cold Home (2nd-largest
  after react-vendor); one 101ms long task on initial render. Worth a look
  at whether part of the state layer can defer past first paint.
- **Files**: `apps/webapp/src/state/*`, the radio-state chunk boundary.
- **Priority**: P3 (perf) — measure before cutting; may not be worth it.

### ~~T_infra_1~~ — DONE + VERIFIED (PR #48 `e368a8f`)
- Removed `sync_nginx_config()` + its call from `deploy-release.sh` (−87/+3);
  the deploy no longer touches the shared nginx unit. **4-agent verification
  workflow** (live-VPS recon + codebase + adversarial + synthesis) returned
  approve-with-caveats; all caveats honored (edited the main-repo copy located
  by function name w/ `preserve_previous_chunks` as the right-copy marker; kept
  `deploy/radioatlas.nginx.conf` as the only in-repo /api-proxy record; docs
  deferred to a follow-up).
- **Verified on prod** post-deploy: deploy green in 53 s (no nginx dance);
  inline "Post-deploy external smoke" (public `/api/health` via Caddy) green;
  read-only recheck — radioatlas `/api/health` 200, neighbor `rodnya-tree.ru`
  200 (undisturbed), nginx still `disabled/failed` (shared unit untouched),
  deployed script has 0 `sync_nginx_config`, Caddy sole holder of 80/443.
  The 2026-05-27 502 deploy-vector is gone; shared box not disturbed.
- **Doc-drift sweep — DONE (PR #49 `merged`)**: corrected the now-false
  nginx-serves/reloads claims to Caddy-is-the-edge reality across README.md,
  RUNBOOK.md (incl. the `## API proxy` line + the external-smoke aside +
  install-static-origin reload step), bootstrap `NGINXHELP`→`CADDYHELP`
  heredoc, install-radioatlas-static-origin echo, apps/webapp/index.html
  comment. Factual-only, zero behavior change; deployed green. Left untouched:
  `apt-get install nginx` (shared box), `deploy/radioatlas.nginx.conf` (kept
  as the /api-proxy reference). Repo docs now match the prod topology.
- *(original finding below, now resolved:)*

### T_infra_1 (orig) — nginx is vestigial; the deploy wrestles a corpse (infra cleanup)
- **Discovered during the 2026-05-29 VPS recon**: the real server is
  **Caddy v2.10.2** (serves radioatlas's static dist directly + reverse-
  proxies `/api` → 127.0.0.1:3001). **nginx 1.18 is `systemctl is-active`
  = `failed`** and is NOT in any serving path. Yet `deploy/server/
  deploy-release.sh` still `sync_nginx_config` + reload/restart/SIGHUP-s
  nginx on every deploy — i.e. the entire T_audit_4 / T_audit_6 deploy-
  resilience saga was hardening the reload of a server that isn't even
  serving. (The deploy DID keep working because Caddy serves from the
  `current` symlink independently of nginx.)
- **What**: confirm nginx has no role (it doesn't, per the Caddyfile),
  then strip `sync_nginx_config` + the nginx steps from the deploy
  script and the `install-radioatlas-static-origin.sh` path. Removes a
  whole class of deploy fragility we spent two PRs hardening.
- **Caution**: verify nothing else on the shared box expects nginx
  before removing; the deploy change itself is webapp-infra (deploy
  script), gated by the post-deploy external smoke (T_audit_4).
- **Files**: `deploy/server/deploy-release.sh`, `deploy/server/
  install-radioatlas-static-origin.sh`, `RUNBOOK.md`, possibly retire
  `deploy/radioatlas.nginx.conf`.
- **Priority**: P2 — not user-facing, but removes real deploy-time risk
  and confusion. Good worker ticket.

---

## Growth Sprint — viral sharing & word-of-mouth (owner-requested 2026-05-29)

Owner goal: *"хочу чтобы люди сами рекламировали приложение"* — make
RadioAtlas spread through its users. The station-share button had also
regressed off the cards. Full growth sprint approved.

**Audit findings (orchestrator, 2026-05-29):** the deep-link infra is
LIVE in prod — `VITE_TG_BOT=radioatlasbot` is set, `makeDeepLink` emits
`t.me/radioatlasbot?startapp=station_<uuid>`, and a recipient lands on
the station (`getStartParam` → `parseStationParam` → App.tsx opens it).
Share buttons exist in FullPlayer / LitePlayer / StationDetails. What's
broken: (1) no share affordance on station CARDS (Home rails / Search /
Library) — it left during the T2.20/T_mobile_1 density passes; (2) the
`shareStation` flow (RadioContext.tsx:1615) prefers a SILENT clipboard
copy in Telegram WebView and only reaches the native share-to-chat as a
last resort, via the wrong `openLink` (not `openTelegramLink`); (3) a
bare `t.me/{bot}` deep link always unfurls as the bot's generic preview,
never a per-station card — pretty cards require the bot (inline mode or
a bot-sent photo card).

Four phases, each its own PR, sequenced, audit-first + push-back each.

### ~~T_share_1 — Share UX foundation~~ (DONE in 8926b46, PR #37)
- **Shipped**: extracted the ordered flow into a unit-testable
  `shareStationLink` (telegram.ts) — TG `openTelegramLink(t.me/share/url)`
  → `navigator.share` → clipboard → `window.open`. Old order silently
  copied in-client and never showed the chat picker. `shareStation`
  now a thin wrapper → existing toasts; deep link untouched. Share icon
  restored on Search cards (`SearchResultCard`) AND Library/Search rows
  (`StationTable`, both compact+non-compact); Home tile deferred
  (density protected). All buttons `stopPropagation`. Worker correctly
  did NOT route through `openTelegramLinkOrFallback` (its open fallback
  would pre-empt the web-share step). Gate: webapp unit 136 · api 83 ·
  bot 12 · build · visual 9/9 (search baseline regen) · e2e 147/147.

#### (original T_share_1 brief)
### T_share_1 — Share UX foundation (webapp, PR — START HERE)
- Restore a card-level share affordance WITHOUT re-cluttering the dense
  tile that T2.20/T_mobile_1 fought for (placement is the key framing
  question — Search/Library rows have room; the dense Home tile may want
  share via long-press / overflow rather than a 3rd always-on icon).
- Fix `shareStation` flow: in Telegram WebView, prefer
  `tg.openTelegramLink('https://t.me/share/url?url=<deeplink>&text=…')`
  FIRST (opens the native forward-to-chat picker — the viral path), then
  `navigator.share` (non-TG mobile web), then clipboard as the true last
  resort. Stop using `openLink` for t.me URLs.
- Polish: consistent share icon, toast copy, `stopPropagation` so a card
  share doesn't trigger the T_mobile_1 click-tile-to-play.
- **Done-when**: share reachable from a card in ≤1 tap-path; in Telegram
  it opens the chat picker (not silent copy); deep link still lands the
  recipient on the station; no density regression; e2e + unit green.

### ~~T_share_2 — Inline mode~~ (DONE in 9f2b451, PR #38 — pending BotFather /setinline)
- **Shipped**: `bot.on('inline_query')` → `@radioatlasbot <query>` in
  any chat returns station article results (favicon thumb + name +
  genre/country) that send a self-contained message + a URL button
  deep-linking into the Mini App. `buildInlineResults` (pure, in
  `replyPayloads.ts`, grammy-free via `grammy/types` type-only import)
  + `resolveInlineQuery` (new `inlineQuery.ts`, injected fetch, mirrors
  `billingForward.ts`): empty query → `/catalog/summary` trending,
  typed → `/catalog/search`, any failure → single "Открыть RadioAtlas"
  fallback (never a crash / broken `t.me/undefined`). URL button not
  webApp (inline-keyboard constraint). RU copy. Gate: bot typecheck ·
  test:bot 23 (+11) · build. bot-only.
- **⚠️ REQUIRES owner BotFather step to activate**: `/setinline` for
  @radioatlasbot. Inert until done (merge safe; activates on enable).

#### (original T_share_2 brief)
### T_share_2 — Inline mode (bot, PR — the biggest viral lever + pretty cards)
- `@radioatlasbot <query>` in ANY chat → inline results of matching
  stations (artwork thumbnail + name + genre), each sending a message
  with a `▶ Listen` deep-link button. Lets users share stations without
  opening the app, and produces the rich per-station card the bare t.me
  link can't.
- Uses the existing `/catalog/search` API. Needs the bot inline-query
  handler + answerInlineQuery with cached results.
- **Done-when**: inline query returns ≥N station cards; selecting one
  posts a card whose button deep-links to that station; bot test covers
  the inline handler.

### ~~T_share_fix — deep-linked http stream doesn't play~~ (DONE in a0bd1ec, PR #39 — pending real-Telegram confirm)
- **The share payoff bug**: a shared station opened the Mini App but
  never played. Root cause (decision layer, `playbackTransport.ts`
  `buildCandidates`): the `/api/stream` proxy candidate was gated behind
  the racy 2.2s `apiAvailable` check. For an `http://` stream on the
  https Mini App the proxy is the ONLY viable transport (direct =
  mixed-content), so when the cold deep-link mount outran `/health`,
  `apiAvailable=false` dropped the sole candidate → `blockedMixedContent`
  → `audio_no_playable_candidate` → dock stuck on "Выбери станцию".
- **Prod trigger** (orchestrator recon): Telegram launches with an
  ABSOLUTE api base (`?api=https://radioatlas.duckdns.org/api` from the
  menu button / startapp), so `checkApiAvailability` does a real
  `/health` fetch (not the optimistic relative-`/api` path) → the cold
  deep-link play races it → false. Normal taps find the check warm → why
  in-app play worked but deep-link didn't.
- **Fix** (webapp-only): (1) `buildCandidates` — for http-on-https with
  an apiBase set, the proxy is mandatory: `canUseProxy = … &&
  (apiAvailable || httpProxyMandatory)`; `apiUnavailable` gains
  `&& !canUseProxy` to stay accurate. (2) `useAudioPlayer` — skip the
  2.2s availability await for the http-mandatory case (its result can't
  change the outcome; removes the launch→2.2s→[or never] stall → shared
  deep link plays instantly). Red→green unit (`unit.spec.ts`): http +
  apiBase + apiAvailable=false → proxy built, not blocked; no-base http
  still blocked. Gate: webapp unit 136 · api 83 · bot 23 · e2e 148/148.
- **NOTE — not browser-verifiable**: local dev is http and Chrome
  standalone doesn't select stations at all (autoplay/standalone quirk),
  so the https mixed-content path is only confirmable in real Telegram.
  Decision-layer fix is unit-proven; **awaiting Артём's phone test**
  (deep-link Казак ФМ from inline → should play).

### ~~Deep-link play saga — RESOLVED~~ (the share payoff now works, data-confirmed)
The shared-station-doesn't-play bug took FOUR diagnoses; recording the
arc so the lesson sticks:
1. **Mixed-content** (T_share_fix, PR #39, `a0bd1ec`): the `/api/stream`
   proxy was gated behind a racy `apiAvailable` check, so http-on-https
   streams could be dropped. **Real latent fix, but not this bug** (the
   test stations included an https one that also failed). Kept.
2. **503 retry** (T_deeplink_resilience, PR #40, `4c0261f`): the
   station-by-id lookup 503'd during the cold-boot request burst (API
   event-loop blocked parsing the 57k catalog). Added exponential-backoff
   retry (1s→2s→4s). **Real latent fix, but not this bug.** Kept.
3. **Telemetry** (T_deeplink_telemetry, PR #41, `5bae779`): instrumented
   the deep-link effect with `/observability` beacons. **This is what
   cracked it** — `deeplink_enter` fired but `deeplink_resolve`/`play`
   never did → the async play hit `if (cancelled) return`.
4. **Lifecycle fix** (T_deeplink_lifecycle_fix, PR #42, `b6dcc11` — THE
   ROOT CAUSE): the deep-link effect depended on `[fetchStationById,
   playStation, t]`; boot re-renders (session-auth/summary/theme) re-ran
   the effect, the cleanup set `cancelled=true` on the in-flight fetch,
   and the re-run bailed via `startHandledRef` without restarting → the
   play was permanently abandoned. Fix: mount-once effect (deps `[]`),
   handlers via ref, NO cancelling cleanup (worker caught that StrictMode's
   dev double-invoke would otherwise re-trigger it). New `deeplink.spec.ts`
   reproduces it in CI (StrictMode dev triggers the same cancellation) —
   red→green — so it can't silently regress.
- **Confirmed working on prod** (`/observability`): `deeplink_enter →
  deeplink_resolve {found:true} → deeplink_play` + the station plays.
- **Lessons**: (a) instrument-and-observe beats guess-and-fix — 3 inferential
  diagnoses missed; the telemetry's data nailed it in one tap. (b) Chrome
  standalone is NOT a faithful repro for Telegram-WebView playback (autoplay
  + standalone quirks) — wasted cycles there. (c) "no resolve AND no error"
  after an `await` that always settles ⇒ a `cancelled`/lifecycle short-circuit,
  not a network failure.
- **Follow-ups — BOTH DONE**: (1) the verbose telemetry was trimmed to a lean
  `deeplink_enter`(param-present)→`deeplink_play`/`deeplink_error{reason}` funnel
  (PR #50 `378eb94`) — and the trim turned the previously-silent `not_found` into
  an explicit error beacon (better fail-visibility than the verbose version).
  (2) the API catalog event-loop block — fixed by #43 boot-warm (by-id 16 ms) +
  #44 summary-cache (staircase collapsed); deep-links are now instant.

### Cleanup sprint — CLOSED (2026-05-31)
All five items done; each either prod-verified or honestly closed by audit
(not made-work):
- **#1 Dependabot** (4 vulns) — audit found the lockfile already patched
  (`npm audit`=0, all dev/build-only); 4 stale alerts dismissed via API. No code.
- **#2 CSS-split** (T_perf_3) — already satisfied by existing architecture
  (`styles.css` deferred via `requestIdleCallback`; critical CSS ~7 KB); parked.
- **#4 nginx** (T_infra_1, PR #48) — removed from the deploy; 4-agent verification
  workflow + prod-verified (502 deploy-vector gone, shared box undisturbed).
- **#5 doc-drift** (PR #49) — repo docs aligned to Caddy-is-the-edge reality.
- **#3 telemetry-trim** (PR #50) — lean deep-link funnel; sink confirmed permissive.

### ~~T_api_bootwarm~~ — DONE + VERIFIED (PR #43, `e379dcc`)
Background catalog warm after `app.listen` (`getCatalog('full')` via the
service so raw + profiled + profile-map all prime). **Verified on prod**:
logs show `RadioAtlas API on 3001 → Catalog warm complete`; direct
`/catalog/stations/<uuid>` (the deep-link by-id) = **16 ms** (was the
~1 s cold-parse → 503 → retry). The deep-link payoff is now instant in
isolation. `fast` warm dropped (unused by routes; would double the boot
transient). 30-min TTL re-expiry documented as residual.

### ~~T_api_summary_cache~~ — DONE + VERIFIED (PR #44, `57fa103`)
Verifying #43 exposed that the deep-link by-id was only half the
event-loop story. **`/catalog/summary` (the Home endpoint) burns
~0.85 s of UNCACHED synchronous CPU per call and serializes.** Measured
on prod (`radioatlas.duckdns.org`, post-#43, warm cache):
- direct same-seed ×2: 1.06 s / 0.80 s (no cache — recomputes every call)
- public concurrent ×4 (varied seed): **1.0 → 1.8 → 2.7 → 3.4 s** — textbook
  serialization staircase (~0.85 s sync CPU each, 4th waits behind 3)
- public sequential under real traffic: **16 s each** (deep queue of
  synchronous summary computations on the single thread)
- it drags down EVERYTHING concurrent — the now-16 ms by-id included.
- **Root cause** (`service.ts:401 buildCatalogSummary`, called fresh at
  `:704 getSummary` with NO server cache): multiple full **57k** seeded
  sorts (`seededOrder`/`seededSample` per rail: freshSignals, searchLaunch,
  mood rails, spotlights). Pure function of `(profiledCatalog, seed)` →
  perfectly cacheable, but isn't.
- **Why naive per-seed caching fails**: webapp sends `seed = Date.now()`
  (`CatalogContext.tsx:268` default, called arg-less at `:321`) — a unique
  ms per load → ~0 % cross-user hit rate. The per-load "freshness" is
  largely illusory anyway: the client already caches the summary 6 h
  (`SUMMARY_CACHE_TTL_MS`), so the server is only hit on first-visit /
  6 h-expiry / new-device.
- **Proposed fix** (worker to audit + confirm): server-side **quantize the
  incoming seed to a coarse bucket** (e.g. hourly: `floor(seed/3.6e6)`) →
  cache `buildCatalogSummary` per bucket with a TTL ~ catalog TTL, + a
  **single-flight** guard so concurrent cache-misses collapse to ONE
  computation (the other N await the same promise instead of each running
  0.85 s). No webapp change needed (server quantizes the client's
  `Date.now()`). Optionally extend the boot warm to pre-compute the current
  bucket so the first cold visitor post-deploy also hits warm. Home still
  rotates (hourly). Expected: 0.85–16 s → ~one 0.85 s/bucket, ~0 ms otherwise.
- **Impact**: this is the real remaining 503 / slow-Home source — every cold
  Home load, not just cold boot. Higher leverage than the cleanup trio.
- Algorithmic speedup of `buildCatalogSummary` (partial-select instead of
  full 57k sorts) is a possible later optimization; caching makes it ~once/
  bucket so it's not urgent.
- **VERIFIED on prod** (`radioatlas.duckdns.org`, post-#44 deploy):
  - **concurrent ×5 to one cold bucket: all ~1.19 s** (was ×4 → 1.0/1.8/2.7/
    3.4 s staircase). Single-flight collapsed 5 → one compute. **Staircase gone.**
  - repeat (cached): **0.157 s**; current real bucket (seed=now, boot-warmed):
    **0.070 s**.
  - memory: API back to **233 MB**, box 2.3 GB free; `unstable_restarts:0`,
    error log clean, no `max_memory_restart` configured → the transient 975 MB
    boot+burst spike rebooted nothing.
  - One artifact: a concurrent burst fired in the first ~15 s after the deploy
    reload read 13–22 s — the warm (catalog ~1 s + summary ~0.85 s) + JIT-cold
    V8 + the burst coinciding. Transient deploy-window only (absorbed by the
    #40 retry + the warm); steady state is flat. Strictly better than pre-#43.

### T_share_3 — Share to Telegram Story (split: PR-A server, PR-B webapp)
- One-tap "share current station to your Story" via the `shareToStory`
  WebApp API (TG 7.8+), with a server-rendered on-brand card + a deep-link
  widget so viewers tap through to the station. Feature-detect + hide if
  unsupported. Chose **(A) generated 1080×1920 card** (vs artwork-direct).
- **PR-A (server) — DONE + VERIFIED (PR #45 `bcb4443` + fix #46 `0bb7a97`).**
  `GET /share/story/:id.png` → satori + `@resvg/resvg-js` render, per-station
  cache + single-flight + LRU(256) (mirrors #44), SSRF artwork fetch via the
  existing `/image` pinned guard, one static fallback for unknown ids,
  native render dep lazy-imported in try/catch (a bad binary degrades only
  this endpoint, not boot), Cache-Control 3-day (not immutable).
  - **Verified on prod by EYE** (not just bytes — that's how the first bug
    slipped): valid id renders the real card (633 KB, differs from the 272 KB
    fallback → resvg native binary works on the VPS), 2nd request byte-identical
    @0.17 s (cache), unknown id → fallback.
  - **Cyrillic-tofu bug caught + fixed (#46):** the 3 Noto subsets were all
    named `Noto Sans` → satori picked latin only, no per-glyph fallback →
    Cyrillic/Greek rendered as ▯. Fix: distinct family names + `fontFamily:
    'Noto Sans, Noto Sans Cyrillic, Noto Sans Greek'`. Second tofu (▶/📻 icons
    absent from language subsets; CSS border-triangle renders as a square in
    satori) → inline SVG play path. Re-verified by eye: «Весёлый Dance - Радио
    Ваня» + «танцевальная · The Russian Federation» render as letters, clean
    play triangle. **Lesson: byte-valid PNG ≠ correct render — view it.**
- **PR-B (webapp) — SHIPPED (PR #47 `61bf61a`), awaiting Artém device test.** feature-detect (`isVersionAtLeast 7.8` +
  `canShareToStory`), Story button in the player surfaces (FullPlayer/
  LitePlayer/StationDetails) beside the existing share, `shareStationToStory`
  (mediaUrl = location-derived `/api/share/story/<id>.png`, `widget_link.url`
  = `makeDeepLink` `startapp=station_<id>`), `share_story` telemetry, ru+en
  locale. Verification = Artém device test (composer opens with card + widget).

### T_share_4 — Referral attribution + reward (webapp + api, PR — last)
- Deep links carry `startapp=ref_<userId>` (the `link_`/`ref_` start-
  param plumbing already exists in `authRoutes.ts`); attribute the new
  user to the inviter; reward the inviter (e.g. unlock a bundled theme
  or a short premium trial — ties into the existing billing/theme
  system). Anti-abuse: no self-referral, one credit per new user.
- **Done-when**: a referred open credits the inviter exactly once;
  reward granted; abuse paths covered by tests.

### Parked behind the growth sprint (resume after)
- **T_perf_3** (split 131KB CSS) and **T_infra_1** (strip vestigial
  nginx from the deploy) — queued worker tickets, deferred by owner in
  favour of the growth sprint. Pick back up when the sprint lands.

---

## Tier 3 — Architecture & maintainability

### T3.1 Split `RadioContext.tsx`
- **What**: extract from the 2446-line provider four standalone hooks:
  - `useTelegramIntegration` (mount/expand/themeParams/haptics/closing-confirm)
  - `useMediaSession` (navigator.mediaSession bindings)
  - `useShareHandlers` (deep-links, native share, copy)
  - `usePlaybackFailureRetry` (current `playStationInternal` decision tree)
  RadioProvider becomes a thin composer.
- **Files**: `apps/webapp/src/state/RadioContext.tsx`,
  `apps/webapp/src/state/radio/*.ts` (new files under existing folder).
- **Done-when**: file ≤ 1000 lines; each new hook has a focused unit test.

### T3.2 `useAudioPlayer` state machine
- **What**: replace the ref-mirror pattern in `apps/webapp/src/lib/useAudioPlayer.ts`
  with a hand-rolled reducer over a `PlayerState` union (`idle | buffering |
  playing | error | ended`). All four media event handlers dispatch into the
  reducer instead of branching independently.
- **Why**: reduces the "stale ref vs state" bugs and consolidates session
  guards.

### T3.3 Split `Globe.tsx`
- **What**: extract `buildPointsFeatureCollection`, `buildStateLabelsFeatureCollection`,
  `buildStyle`, `buildCountryLayers` into sibling files in `apps/webapp/src/components/globe/`.
  Reticle state-machine becomes a hook (`useReticleAnchor`). Component file
  becomes ~400 lines of view-only logic.

### T3.4 Numbered SQLite migrations
- **What**: replace the silent `try { ALTER TABLE } catch {}` chain in
  `apps/api/src/account/core/repository.ts:181-197` with a `schema_migrations`
  table and a numbered migration list. Each migration is a function with
  explicit checks; failure aborts boot loudly.
- **Files**: `apps/api/src/account/core/repository.ts`,
  `apps/api/src/account/core/migrations/*.ts` (new).

### T3.5 Structured logger
- **What**: introduce a minimal `apps/api/src/log.ts` with `info|warn|error`
  + per-request `requestId` middleware. Replace `console.log` in
  `metadataService.ts`, `streamProxy.ts`, billing/auth routes. Bot gets the
  same logger.
- **Why**: correlation IDs for incident response. Today logs are unjoinable.

### T3.6 Pluggable metadata-resolver registry
- **What**: today `metadataService.ts` hardcodes 4 fallbacks (Icecast / Shoutcast
  / Azura / ICY) and 3 station-specific fetchers (101.ru / top-radio.ru /
  radiovanya). Refactor into a `MetadataResolver[]` registry. Each resolver
  is `{ name, matches(streamUrl) => boolean, resolve(streamUrl, opts) =>
  Promise<string | null> }`. Adding a new station = one file.
- **Files**: `apps/api/src/media/metadataService.ts`,
  `apps/api/src/media/resolvers/*.ts` (new).

### T3.7 Collapse the account-store facade layers
- **What**: `apps/api/src/accountStore.ts` → `accountStoreCore.ts` →
  `account/core/*` is three layers with no behavior. Pick one entry point and
  delete the others. Adjust import sites.

### T3.8 Replace `as any` casts in upstream parsers
- **What**: `metadataService.ts` has 6+ `as any` casts on upstream JSON.
  Introduce a tiny narrowing helper (or `valibot` if a dep is acceptable) for
  Icecast / Shoutcast / Azura / 101.ru / radiovanya response shapes.

### T3.9 Persistent-state IndexedDB queue
- **What**: in `apps/webapp/src/lib/persistentState.ts`, route writes through
  a shared `IndexedDB`-backed queue keyed by storage key (or a single shared
  debounced writer if IDB is overkill). Avoid 300 KB synchronous localStorage
  writes per user action.

### T3.10 Stop `key={index}` everywhere; ESLint guard
- **What**: `apps/webapp/src/screens/Search.tsx:693-695` uses
  `key={index}`. Replace and add `"react/no-array-index-key": "warn"` to
  ESLint config to keep new ones out.

---

## Tier 4 — Operations & infra

### T4.1 Catalog artifacts off git history
- **What**: daily catalog cron currently commits 5.5 MB + 31 MB JSON to
  master. Move artifacts to a static-asset bucket (Vercel Blob / S3 / DigitalOcean
  Spaces) or to a separate `catalog-artifacts` git branch with `--orphan` weekly
  resets. Webapp + API read by signed URL.
- **Why**: monthly repo bloat; concurrent commits collide with developer
  pushes.
- **Files**: `.github/workflows/catalog-artifacts.yml`,
  `scripts/updateCatalog.mjs`, `apps/api/src/catalogCache.ts`,
  `apps/api/src/index.ts`.

### T4.2 Health endpoint includes catalog freshness
- **What**: `/health` returns `{ ok, catalog: { mode, age, size, source } }`.
  Caddy / nginx check can alert if `age > 36h`.
- **Files**: `apps/api/src/index.ts`.

### T4.3 Observability flush back-pressure
- **What**: in `apps/api/src/observabilityStore.ts`, drop alerts under load
  rather than blocking. Cap the alert ring buffer; emit a single
  `alertsDroppedSinceFlush` counter.

### T4.4 Concurrency guard on the bot
- **What**: in `apps/bot/src/index.ts`, add a startup check that ensures only
  one bot instance is polling. Use a SQLite advisory lock (the account-store
  is already shared) or a file lock.

### T4.5 Add jitter to webapp nowPlaying poll
- **What**: `useNowPlayingSync.ts:105` (or wherever the 30 s poll lives) — add
  ±5 s random jitter so simultaneous users don't synchronize.

### T4.6 Static OAuth & secrets review
- **What**: walk `deploy/OAUTH_SETUP.md` and `apps/api/.env.example`. Confirm
  no secrets in code, rotate any token committed historically, document
  rotation cadence.

### T4.7 Snapshot baselines refresh + Telegram WebApp test harness
- **What**: visual baselines under `apps/webapp/tests/visual.spec.ts-snapshots/`
  are dated 2025-05-01; refresh after T1.4–T1.8 land. Add a Telegram WebApp
  shim (`window.Telegram.WebApp` mock) to e2e so we can test T1.2/T1.3 paths.
- **T1.1 carry-over**: three baselines (`home shell mobile`, `search screen`,
  `full player overlay`) drifted by 3691 px each (~0.36% / ratio 0.01) after
  T1.1 — likely font-rendering / Windows CI runner changes accumulated since
  2026-04, unrelated to the Telegram SDK script load itself. The desktop
  `home shell visual baseline` also occasionally trips in full-suite runs
  (same drift family, same fix). Regenerate all four via
  `npm --workspace apps/webapp run test:e2e -- --update-snapshots` after
  T1.4–T1.8 land, per the original brief above. Until then, full-suite e2e
  on master will surface those three+ as known-deferred.

---

## Tier 5 — Product surface (deferred, plan only)

These are intentionally below the line. Implement after Tier 0-3 plus T4.1 land.

- **T5.1** Stage 18 marketplace, server theme publishing (already deferred in
  PLAN.md).
- **T5.2** Server-side recommendation reranker (today taste profile is
  purely client-side; a small server signal would explain "why this station"
  better and stop drifting on device reset).
- **T5.3** Live programme charts per station (use the metadata history we
  already cache, expose top-10 of last 24h on Station Details).
- **T5.4** Saved searches / smart playlists ("any rock station that worked
  3+ times this week").
- **T5.5** Offline queue cache — last N tracks + station logos pre-cached for
  metro / airplane scenarios.
- **T5.6** Real Telegram payments end-to-end (after T0.2).
- **T5.7** PWA install flow + Web Share Target.

---

## Execution order summary

1. **Tier 0 (T0.1–T0.7) — COMPLETE**, see commits 86368fb … a4fb9f9. Backlog items T0.1b / T0.2b / T0.2c carry over to the next phase.
2. **T1.1, T1.2** (Telegram script + closing/haptics) — biggest user-visible win
3. **T1.4, T1.6, T1.7, T1.8** (a11y + dialogs + boundary)
4. **T1.3, T1.5** (themeParams, Enter-to-search)
5. **T2.1, T2.2** (visualizer + nowPlaying cache — battery wins)
6. **T2.3, T2.4, T2.5, T2.6** (backend perf)
7. **T2.7, T2.8, T2.9, T2.10** (frontend perf + cache hygiene)
8. **T3.1 → T3.10** (architecture; pick by current pain)
9. **T4.1 → T4.7** (ops/infra)
10. **T5.\*** (product) after a stability window.

## Tier 0 shipment checklist

Before the Tier 0 commits land on master:
- [x] webapp e2e green in a clean checkout (`npm i` then `npm --workspace apps/webapp run test:e2e`), covering T0.5 webapp changes — done as the gate on T1.1 (f346339). 99/103 pass; 3 visual baselines explicitly deferred to T4.7, see its body.
- [ ] rebase clean onto current `origin/master`
- [ ] run full verification gate on the rebased tip
- [ ] open PR with title "Tier 0 security + T1.1: SSRF guard, billing webhook auth, session expiry, locked CORS, provider-link auth, catalog DoS removal, test-fixture guard, Telegram WebApp SDK load"

## Verification gate at every commit

```
npm run typecheck
npm run typecheck:test
npm --workspace apps/api run test
npm --workspace apps/bot run test
# webapp e2e is slower; run when touching webapp src/ or styles.css
npm --workspace apps/webapp run test:e2e
```

If `webapp/test:e2e` Playwright baselines drift legitimately, regenerate
with `--update-snapshots` and call it out in the commit body.

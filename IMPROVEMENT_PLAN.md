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

### T_audit_4 — Post-deploy external smoke test (deploy resilience)
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

### T_audit_6 — Open-tab chunk-hash invalidation on every deploy
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

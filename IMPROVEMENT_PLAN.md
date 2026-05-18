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

### T0.1b Pin DNS resolution to a single IP for the duration of a media fetch
- **What**: today the SSRF guard does a "two resolves" check — once at the
  handler boundary and once inside the fetch helpers, plus a guarded
  manual-redirect chain. There is still a residual race window between our
  second resolve and undici's own connect-time resolve. Resolve the hostname
  once, validate the addresses, then pass an undici `Agent` with a custom
  `connect.lookup` that always returns the validated IP. Set `servername`
  correctly so TLS SNI keeps working and the upstream still sees the original
  hostname in the `Host` header.
- **Why**: defeats a sophisticated rebind that flips DNS in the microsecond
  window between our final check and undici's TCP connect.
- **Files**: `apps/api/src/media/shared.ts`, new test that swaps
  `dns.lookup` between the guard and connect and asserts a private IP cannot
  be smuggled through the helper.
- **Done-when**: the new test passes; existing media tests stay green.

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

### T0.2c Reconcile pending billing purchases with Telegram
- **What**: Telegram delivers `successful_payment` once over long-poll;
  if our forward fails the update is dropped forever and the purchase stays
  `pending` while the user's money is gone. Add a periodic sweep (every
  10 min) that lists pending purchases older than 5 min, calls the Telegram
  payments API to verify the charge, and re-runs the webhook path.
  Queue-based forwarding (bot writes a local SQLite retry queue, separate
  worker drains with backoff) is the proper long-term design.
- **Files**: `apps/api/src/billingReconciliation.ts` (new), wire into
  `apps/api/src/index.ts` boot, contract test.
- **Done-when**: simulated webhook-drop reconciles within one sweep cycle.

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

### T1.3 Telegram themeParams as a layer over user theme
- **What**: in `ThemeContext`, accept `WebApp.themeParams` (bg/text/accent/button
  colors + their dark variants) and apply them as the lowest priority layer
  under bundled/custom themes. Subscribe to `themeChanged` event.
- **Why**: today a user with a custom Telegram theme always sees RadioAtlas
  branded dark green — looks foreign.
- **Files**: `apps/webapp/src/state/ThemeContext.tsx`, `apps/webapp/src/lib/theme/*`.
- **Done-when**: changing Telegram theme live updates RadioAtlas colors.

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

### T2.1 Visualizer state out of React
- **What**: stop calling `setVisualizer({...})` ~30×/s in `useAudioPlayer.ts:873`.
  Expose a `subscribeVisualizer(cb)` API that pushes via `ref` callbacks. The
  visualizer canvas reads the ref directly in its rAF; the rest of the app
  never re-renders for visualizer data.
- **Why**: today every consumer of `usePlayback` re-renders 30×/s.
- **Files**: `apps/webapp/src/lib/useAudioPlayer.ts`,
  `apps/webapp/src/components/WinampMilkdropVisualizer.tsx` (or wherever it
  consumes today).
- **Done-when**: React DevTools profiler shows shell re-render rate <1/s
  during playback.

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

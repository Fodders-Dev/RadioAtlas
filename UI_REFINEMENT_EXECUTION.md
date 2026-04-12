# UI Refinement Execution

Last updated: 2026-04-12 (pass 9)

## 1. Playback Stability

- [x] Create execution plan and track progress in markdown
- [x] Audit current playback candidate chain and error normalization
- [x] Reduce unnecessary API health checks on plain direct playback paths
- [x] Add fallback extraction path for non-direct `https` station sources
- [x] Improve runtime playback diagnostics surfaced from failed candidates
- [x] Verify `https mp3`, `https aac`, `https m3u8`, `http -> https`, and proxied fallback cases

## 2. UI Consistency

- [x] Remove repeated fallback station lists from Home and replace one side panel with a catalog pulse module
- [x] Unify section headers, empty states, and secondary actions
- [x] Fix all known text overflow cases in Home, Globe, Library, and player surfaces
- [x] Rebalance globe visuals into the same glass palette as the rest of the shell

## 3. Controls And Sizing

- [x] Increase tappable size of primary actions to a stable mobile-safe range
- [x] Increase hit area for dock controls, nav items, and station card actions
- [x] Re-check Telegram Mini App safe-area spacing after control sizing changes

## 4. Performance

- [x] Identify obvious playback-path latency caused by unnecessary API checks
- [x] Reduce shell render churn in heavy screens
- [x] Trim expensive CSS effects where they are decorative rather than useful
- [x] Re-measure shell responsiveness after the first optimization pass

## 5. Verification

- [x] Run web build after each substantial code pass
- [x] Run e2e after playback and UI updates settle
- [x] Perform manual MCP Playwright pass on Home, Search, Globe, Library, and player
- [x] Replace redundant Home hero blocks with role-based modules that read clearly on first glance
- [x] Add a first cloud-account layer for Telegram-backed library sync and account surfacing in the UI
- [x] Refactor cloud account model to support linked providers instead of a Telegram-only profile
- [x] Add account management sheet with Telegram link flow and Google sign-in slot
- [x] Replace JSON account persistence with SQLite-backed account/session/link storage
- [x] Add account audit trail and expose it in the account sheet
- [x] Add provider unlink operation with server-side guard rails
- [x] Surface merge rules directly in the account sheet so linking behavior is explicit
- [x] Add explicit library merge strategy selection for future provider links
- [x] Wire merge strategy through link requests and auth flows instead of silently forcing union merge
- [x] Add conflict preview with explicit favorites / recent / history counts for current and incoming accounts before confirming link
- [x] Add test auth fixture and browser e2e coverage for a real conflict-preview + confirm flow
- [x] Extract reusable browser auth-conflict fixture module and cover `combine` with a second e2e
- [x] Introduce shared web domain contracts for playback, metadata, cloud library, merge preview, and discovery feed
- [x] Move playback candidate planning into an explicit transport helper layer with typed candidates/failures
- [x] Replace interval-only now playing polling with structured snapshot state and adaptive retry/backoff
- [x] Move Home showcase logic into a reusable discovery feed builder with non-duplicative module selection
- [x] Add browser e2e coverage for metadata recovery and Home module de-duplication
- [x] Split the shell so heavy account/details/winamp code is only fetched on demand
- [x] Add shell-level skeleton fallbacks for lazy screens and sheets
- [x] Run a second discovery pass on Globe and Library using shared feed builders instead of ad-hoc JSX assembly

## Notes

- MCP Playwright was initially blocked on this machine by `EPERM: operation not permitted, mkdir 'C:\\Windows\\System32\\.playwright-mcp'`, but the session is now usable again through `browser_run_code` and `browser_snapshot` with explicit writable output storage under `C:\\Users\\fodde\\.codex\\tmp\\playwright-mcp`.
- Playback matrix results are stored in `output/playwright/playback-matrix.json`.
- Local visual regression artifacts for this pass are stored in `output/playwright/globe-mobile-refinement.png`, `output/playwright/library-mobile-refinement.png`, and `output/playwright/ui-refinement-check.json`.
- `checkApiAvailability()` now rejects non-JSON and non-`{ ok: true }` health responses, which fixes false-positive API detection when localhost ports are occupied by unrelated apps.
- Empty-state dock is now collapsed into a minimal peek handle, so `Library` and `Globe` are no longer covered by a full-width idle player shell on mobile.
- App shell screens and Settings are now lazy-loaded, which dropped the main `index` bundle from ~566 kB to ~373 kB in the production build.
- Search and Home now use deferred query paths before debounce, which reduces input churn on large catalog filtering without changing the visible UX.
- The main production `index` chunk is now ~231 kB; remaining heavy bundles are isolated in lazy `webamp-vendor` and `hls-vendor` chunks.
- Topbar, desktop nav, compact station cards, and the dock glass surfaces were rebalanced again so controls are larger and the shell reads more like one product instead of separate panels.
- `Home` no longer opens with a decorative duplicate hero; it now starts with search, discovery, map spotlight, current session, and account/sync modules with distinct jobs.
- The API now has a simple file-backed Telegram auth/session flow plus `/me` and `/me/library`, so favorites/recent/copied tracks can be synced once `TELEGRAM_BOT_TOKEN` is configured and the app is served behind the API.
- The account layer now uses a generic file-backed account store with linked providers, `/auth/telegram`, `/auth/google`, `/me`, `/me/library`, and `/me/link-request`.
- The API account layer now persists to `apps/api/data/account-store.sqlite` through the built-in `node:sqlite` runtime, with tables for accounts, providers, sessions, link requests, and audit events.
- The API now exposes recent account events through response envelopes and `/me/audit`, and the web account sheet renders that audit trail directly.
- The web app now has a dedicated account sheet and supports the practical merge flow: sign in on web with Google, generate a link request, then attach Telegram to that same cloud profile from the Mini App.
- `VITE_GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_ID` are now explicit environment requirements for Google sign-in; when they are missing the UI degrades to a clear explanatory state instead of a dead button.
- This machine still has an unrelated service occupying `localhost:3001`, so local verification was run against the API on `127.0.0.1:4301` to avoid false positives from чужой localhost service.
- MCP-authenticated verification of the linked-profile UI was completed against `http://127.0.0.1:4188/?api=http://127.0.0.1:4303` with a seeded bearer token, confirming visible audit events and no targeted overflow in the account sheet.
- The plain `browser_navigate` path can still hit a stale old process in the current desktop session, but live browser QA is no longer blocked because `browser_run_code` and `browser_snapshot` work against the local app.
- The account API now exposes `DELETE /me/providers/:kind`; unlinking records a `provider_unlinked` audit event and refuses to remove the last remaining sign-in method.
- The account sheet now renders explicit merge policy rules for favorites, recent, copied-track history, and provider unlink policy instead of leaving the merge behavior implicit.
- Browser-side unlink was initially blocked by CORS preflight because `DELETE` was missing from `Access-Control-Allow-Methods`; that transport bug is now fixed.
- MCP verification now covers the full unlink flow against `http://127.0.0.1:4189/?api=http://127.0.0.1:4306` with a seeded two-provider account: Telegram unlink succeeds, `provider_unlinked` appears in audit history, overflow stays empty, and the remaining last-provider unlink is both disabled in the UI and rejected with `400` on the API.
- Provider linking now supports three server-backed library resolution strategies: `combine`, `prefer-current`, and `prefer-incoming`.
- Store-level verification confirms the strategies affect merged data correctly: union mode keeps both libraries, `prefer-current` preserves only the current profile library, and `prefer-incoming` replaces it with the incoming provider library.
- MCP verification on `http://127.0.0.1:4192/?api=http://127.0.0.1:4308` confirms the account sheet renders the new strategy selector without overflow and that `/me/link-request` echoes the selected merge strategy back in the API contract.
- The account flow now exposes dedicated preview endpoints for Telegram and Google links, and the account sheet renders a three-card conflict preview with concrete `favorites / recent / history` counts for the current profile, incoming profile, and merged result before confirmation.
- Pass-8 store-level preview verification confirms the preview payload is conflict-aware and strategy-sensitive: with current counts `2 / 1 / 1` and incoming counts `1 / 2 / 1`, the preview result is `3 / 3 / 2` for `combine`, `2 / 1 / 1` for `prefer-current`, and `1 / 2 / 1` for `prefer-incoming`.
- Pass-8 MCP verification against `http://127.0.0.1:4192/?api=http://127.0.0.1:4309` confirms the account sheet still opens cleanly on mobile after the preview-card changes, the three strategy buttons are visible, and targeted account-sheet overflow is `[]`.
- Playwright now boots a dedicated fixture API on `127.0.0.1:4311` with `ENABLE_TEST_AUTH_FIXTURES=1`, seeds a Telegram current profile plus a conflicting Google incoming profile, and drives a real browser conflict flow through the account sheet.
- The browser e2e suite now covers the full confirm path: choose merge strategy, click the rendered Google fixture button, verify the preview card with concrete counts, confirm the merge, reopen the sheet, and confirm Google is now linked to the current profile.
- MCP verification against `http://127.0.0.1:4194/?api=http://127.0.0.1:4311` reproduced the same flow outside the test runner: the preview card surfaced current counts `2 / 1 / 1`, incoming counts `1 / 2 / 1`, displayed strategy-aware deltas for `prefer-incoming`, and after confirmation the Google provider card showed the linked fixture identity.
- The auth-conflict browser fixture now lives in a dedicated reusable test module, so account-flow specs no longer duplicate Google fixture wiring, session injection, or conflict seeding logic.
- The browser suite now covers both destructive and union paths: one e2e verifies `prefer-incoming`, and a second e2e verifies `combine` produces union counts before confirmation and still links the incoming Google identity after confirm.
- Pass-9 introduces `apps/webapp/src/domain/contracts.ts` as the shared contract layer for playback failures/candidates, metadata snapshots, cloud-library types, merge previews, and discovery modules instead of re-defining those shapes inside React state files.
- Playback candidate planning is now centralized in `apps/webapp/src/lib/playbackTransport.ts`; `useAudioPlayer()` keeps its old public shape for compatibility, but it now tracks typed `failure`, `transport.activeCandidate`, and `transport.recentFailures`.
- Metadata polling now uses `fetchNowPlayingSnapshot()` with source/failure attribution and adaptive retry scheduling instead of a fixed `setInterval`, which gives the shell a stable `nowPlayingState` contract and makes metadata degradation explicit.
- `Home` now consumes `createDiscoveryFeed()` from `apps/webapp/src/lib/discoveryFeed.ts`, so discovery buckets are built in one place and country/genre shelves stop falling back to already-visible stations when a unique shelf cannot be formed.
- The topbar now surfaces live now-playing or playback issue context instead of only repeating queue stats, and `Home` exposes deterministic module ids for visual QA and browser assertions.
- The browser suite now includes a real metadata recovery scenario through a mocked Nightride SSE flow plus an assertion that the major Home shelves do not repeat the same station across discovery modules.
- Pass-9 MCP verification against `http://127.0.0.1:4180/?api=http://127.0.0.1:4311` confirmed desktop/mobile shell loading, working mobile dock/navigation chrome, de-duplicated Home shelves, and no targeted overflow in the new discovery modules; the only remaining overflow hit was an already-ellipsized long account identity string in `account-profile-meta`.
- Pass-10 moves route, account-sheet, station-details, and Winamp-shell loading behind explicit lazy boundaries plus reusable import loaders, which cuts the production `index` chunk from ~264 kB to ~20 kB and keeps heavy code out of the startup path.
- The remaining large `webamp-core-vendor` and `hls-core-vendor` chunks are still upstream-sized, but they are now isolated behind explicit on-demand boundaries and a proactive Winamp preload when playback becomes relevant.
- Shell loading is no longer a raw text box: `AppScreenSkeleton` now provides screen, sheet, and overlay skeleton states so navigation and sheet opens degrade like an intentional music app instead of a blank pause.
- `createGlobeDiscoveryFeed()` and `createLibraryDiscoveryFeed()` now back the Globe and Library shells, which adds country-route shortcuts on the globe and a real library overview layer for return-to-air, cloud status, and journal preview without duplicating catalog lists.
- Pass-10 MCP verification against `http://127.0.0.1:4180/?api=http://127.0.0.1:3001` confirmed desktop Globe and mobile Library after the new discovery/skeleton pass; targeted overflow checks on `.globe-route-pill`, `.globe-selection-pill`, `.library-overview-card`, `.station-row`, `.player-dock-bar`, and `.mobile-nav-item` all returned `[]`.

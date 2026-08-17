# RadioAtlas Active Roadmap

Core listening roadmap through Stage 16 is closed. Public/shared/paid surfaces stay deferred until the radio loop is proven stable on real Telegram mobile devices.

## Radio Core Sprint (closed)

- [x] Runtime failure recovery
  - Startup failover still walks the queued station candidates.
  - Runtime playback errors now record playability + health failure once and try the next queued station silently.
  - Metadata-unavailable remains a passive now-playing state, not a negative playability signal.
- [x] Session events as ranking input
  - Local app state stores the latest 120 radio session events.
  - `queued`, `play-started`, `play-success`, `skip`, `like`, `hide`, and `failed` now bias Home, Search, and Personal Radio for the current session.
- [x] Search intent ranking
  - Multi-token queries like `jazz japan` reward tag/place/name coverage.
  - Explicit query intent outranks weak promoted or taste-biased matches.
- [x] Personal Radio and Home quality
  - Personal Radio avoids recently failed/hidden stations.
  - Dense Home dedupes the top recommendation/resume/rail slots without reintroducing reason-copy.
  - Empty-profile fallback is ranked through health/playability instead of raw shuffle.
- [x] Queue continuity
  - Personal Radio refills the tail near the end of the queue without changing the active station.
  - Search/Globe/Collection queues keep finite failover only.

## Player Loop Sprint (closed)

- [x] Queue-first Full Player
  - Full Player shows current + upcoming queue rows with play, move, and remove controls.
  - Current row stays protected from reorder but can be removed to fail over to the next station.
- [x] Queue continuity controls
  - `clearUpcoming` keeps the current station playing and removes only the queue tail.
  - `moveAtIndex` reorders upcoming stations without changing the active station.
- [x] Dock stays compact
  - Dock remains a quick controller; heavy queue edits live in Full Player.
- [x] Details and Library paths
  - Full Player keeps direct access to Station Details and can jump to the Library queue tab.

## Performance Hardening Sprint (closed)

- [x] Cold-start bundle hardening
  - React/ReactDOM are bundled from the app origin; no `esm.sh`/React CDN path remains.
  - Cold Home does not request Globe, HLS, fallback catalog, PlaybackRuntime, Theme Studio, Lite, or Full Player overlay chunks.
  - PlaybackRuntime mounts after idle or first playback intent; low-power Telegram WebView waits until playback is requested.
- [x] Catalog TTL cache
  - Added local IndexedDB cache with localStorage fallback for summary, search, areas, area stations, station details, and fallback dataset.
  - Fresh summary cache can render Home immediately while network refresh runs in the background.
  - Manual refresh still forces network and updates cache.
  - Clear cache now clears catalog TTL cache and last-known track cache.
- [x] Theme asset deferral
  - Theme startup loads manifests first, not every stored blob.
  - Asset object URLs are created only for the active theme and visible Theme Studio previews.
- [x] Persistent-state write hygiene
  - `usePersistentState` no longer writes on mount by default.
  - App/library/player storage writes are dirty-only; Home generated snapshot is session-local instead of an automatic localStorage write.
- [x] Legacy skin/zip cleanup
  - Removed unreachable Skin Lab / `.wsz` runtime files and `jszip` dependency.
  - Decorative Lite easter egg remains; Theme Studio is the real theme path.
- [x] Mobile performance gates
  - Added tests for CDN-free cold load, lazy chunk isolation, cached summary offline render, fallback catalog lazy load, and no mount-time persistent rewrites.

## Mobile Visual QA Sprint (done)

- [x] Stage A: fixed bottom stack
  - Add one safe bottom spacing contract for Home, Search, Library, and Globe scroll surfaces.
  - Last station cards must scroll above mini player + bottom nav on 360/390/412.
- [x] Stage B: Globe dense layer cleanup
  - Reduce competing text in the dense focus sheet.
  - Keep Tune Here controls and the reticle visually separated from the sheet.
  - Replace the decorative globe texture path with a mobile-safe satellite globe plus zoomed satellite map mode.
  - Invalidate stale tiny geo caches and load a larger geo fallback dataset when the API is unavailable.
- [x] Stage C: mobile topbar fit
  - Prevent long section titles like `Медиатека` from clipping on 360px.
  - Compact status chip copy on dense widths.
- [x] Stage D: Search result density
  - Make dense search result cards readable first: wider title, less duplicated action chrome.
  - Keep quick play/favorite reachable without horizontal overflow.
- [x] Stage E: Full Player queue polish
  - Reduce queue-row control noise on 360px.
  - Keep current/upcoming actions explicit enough for Telegram WebView.

## Discovery Feed Primary Surface (done)

- [x] Retire the Home `Моя волна` CTA as a user-facing surface.
  - Home now uses one large `Лента` hero in the primary slot with Feed and refresh as non-overlapping sibling actions.
  - The internal personal-radio/taste engines remain available for ranking and queue continuity.
- [x] Make Feed personal-fresh on every open.
  - Feed excludes favorites, recent stations, and the currently playing station before weighting.
  - Feed candidates are health/playability gated before they can autoplay on swipe.
  - Card 0 is pinned to the strongest available personal pick; each Home Feed open re-rolls a transient seed.
- [x] Refresh tests and visual baselines.
  - Home/feed selectors now use `[data-home-feed-entry]`.
  - Feed #86 no-auto-switch-on-open remains covered.
  - Home and Library mobile visual baselines were regenerated for the new hero/tab layout.

## Theme Studio (in progress)

- [x] 17.0 Hide Webamp behind easter-egg gate
  - Primary `winamp.expanded` path opens the native RadioAtlas `FullPlayerOverlay`.
  - Legacy Lite/Webamp path remains available only with `?winamp=1`.
  - Skin Lab / `.wsz` entry points are removed from Settings, dock tray, and legacy overlay controls.
  - Old Webamp/Skin Lab compatibility code is removed when unreachable; decorative Lite stays as the easter egg.
- [x] 17.1 Theme schema + IndexedDB storage
  - Add local theme/assets types and persistence for RadioAtlas shell themes.
- [x] 17.2 CSS theme injection
  - Apply accent, background, and font tokens across Home, Globe, Dock, and Full Player without React remounts.
- [x] 17.3 Theme Studio UI
  - Add the real Theme Studio sheet for bundled themes and one-tap apply.
  - Theme Studio opens from Settings and from the dock volume tray.
  - Bundled/custom cards support apply, remix, edit for custom themes, and delete for custom themes.
- [x] 17.4 Theme Builder
  - Add background print upload, accent, font, icon style, custom player icon uploads, and remix/edit saves for local themes.
- [x] 17.5 Decorative theme layers
  - Add fixed-slot stickers/GIFs/emoji reactions for the shell surfaces.
  - Builder can upload sticker/GIF assets and choose fixed slots/triggers.
- [x] 17.6 Webamp easter egg
  - Unlock the legacy Lite/Webamp path through the R++ brand gesture; keep `?winamp=1` as a dev bypass if useful.
- [x] 17.7 Generated bundled theme pack
  - Add RadioAtlas-generated SVG backgrounds and bundled Theme Studio presets for Aurora Field, Signal Grid, and Sunrise Dial.
- [x] 17.8 Local print uploads for shell/player themes
  - Theme Studio can save a user image print as a local background asset.
  - Dock and native Full Player consume the active theme print, not only accent colors.
  - Dock and native Full Player consume custom play/pause/next/prev/like icon assets.
- [x] 17.9 Drop dead Webamp boot pipeline
  - Legacy Lite is now a decorative-only easter egg.
  - Removed the unused Webamp boot/runtime/transport pipeline and nonexistent vendor module path.

## Deferred

- [ ] Stage 18: marketplace, server theme publishing, currency, moderation, copyright checks.

## Discovery freshness + Lira relevance (done)

- [x] Cross-session exposure demotion. New `lib/stationExposure.ts` decaying
  "shown/played" ledger; a soft rank penalty threads through the shared rankers
  (`rankStationsForUser`, Home `scoreStation`) so Лента, Home «Для тебя» and
  Personal Radio stop re-leading with «одно и то же» each open. The feed flushes
  the cards you actually landed on; the play path records plays. Search browse
  sinks recently-played stations to the tail (typed search stays relevance-first).
- [x] Lira genre relevance. `buildSearchResponse` gains an AI-path genre-relevance
  order (word-aware exact-tag > name > other, blended with quality) so a bare-genre
  ask returns actual genre stations, not the most-voted substring match. The HTTP
  Search ordering is unchanged (opt-in flag).
- [x] Lira curated routes for the two live misses: «соул(попсовый)» → real soul
  (not chillout/ambient); «популярное, но по мозгам не било / фоном / мягко» →
  soft pop / adult-contemporary / easy-listening (not a global dance grab-bag).

## UI/UX polish pass (done)

- [x] Home and Search interaction cleanup.
  - Whole station cards use one dedicated primary Play action instead of nested or duplicate Play targets; like/share remain independent keyboard actions.
  - Mobile Search is denser without horizontal overflow, has localized result counts, readable 44px quick actions, and case-insensitive country facets.
  - Home Feed entry and refresh are non-overlapping sibling actions inside one hero card; the complete subtitle remains visible at 360px and reduced-motion paths cover refresh/loading states.
- [x] Predictable discovery playback.
  - Globe drag/settle selects a preview but never surprise-switches audio; direct point taps and the visible Play CTA remain explicit tune actions.
  - Globe no longer duplicates the active station beside the persistent dock.
  - Feed exposes play/pause on the active card, restores focus to Home/navigation on close, and falls back to the snap-scroll index when an embedded Chromium misses an IntersectionObserver callback.
- [x] Player, Library, and Settings clarity.
  - Live dock can collapse to a one-row controller and restores that presentation after Full Player closes.
  - Full Player surfaces the next queue item, keeps complete action labels, and can jump directly to recent tracks.
  - Library preserves its selected tab and implements the native tab keyboard pattern; Settings groups destructive data actions into one divided card with inline confirmation and collapses developer diagnostics.
- [x] Shared visual and accessibility hardening.
  - Ordinary Home, station-row, and Settings content surfaces are flat and blur-free; topbar, dock, navigation, sheets, and immersive player/globe treatments retain glass where it helps hierarchy.
  - Mobile topbar and compact-dock controls are locked to at least 44px; navigation labels are 10px and station names remain 13–14px.
  - Dialogs skip backdrop controls for initial focus, restore focus consistently, and playback changes use one debounced polite live region.
  - Added mobile Settings, destructive-confirmation, developer-panel, compact-dock, and single-dock Globe visual coverage; refreshed affected 360px baselines.

## Responsive checkpoint before design reference (done)

- [x] Removed the 431–600px topbar breakpoint gap and the oversized mobile
  `fresh-now` grid; every compact discovery rail is now a bounded peek lane.
- [x] Restored compact Home search, added stable genre shortcuts, and made sparse
  catalog fallback rails available on wide layouts too.
- [x] Restored Lira in ordinary local Vite navigation and documented the separate
  API process needed for proxy images and real AI replies.

## Generated station atmosphere foundation (done)

- [x] Add a free-first Cloudflare Workers AI provider using FLUX.2 Klein 4B,
  with secrets confined to the API process.
- [x] Derive reusable scene keys from country, controlled station vibe, and a
  versioned art direction instead of generating per station view.
- [x] Add persistent PNG/JPEG caching with byte-derived MIME, single-flight
  generation, a daily cap, bounded concurrency/queueing, and an
  internal-token-protected batch command.
- [x] Keep the public scene endpoint read-only and preserve existing station
  logos/procedural gradients as fail-soft fallbacks.
- [x] Opt only immersive editorial surfaces (Home hero, active Feed backdrop,
  and Full Player backdrop) into cached scenes; station tiles, dock, Media
  Session, and all identity artwork keep the owner logo → favicon → procedural
  fallback chain.
- [x] Document local/VPS configuration and cover provider, auth, caching, and
  browser-client behavior with focused tests.

## Station-specific music scenes (done)

- [x] Replace shared `country + vibe` backgrounds with one versioned visual
  identity per station; keep location as secondary art direction.
- [x] Lead prompts with a safe station-name cue and a closed genre taxonomy,
  including city pop/anime/future funk and game-soundtrack profiles.
- [x] Enrich generation from harvested recent tracks and top artists while
  keeping track rotation out of the paid cache key.
- [x] Bump the production style to `atlas-music-v3`, seed by active style rather
  than total legacy file count, and cover the Yumi Co. Radio mismatch directly.

## Designer-reference Home (done)

- [x] Restore the computed live recommendation as a full-bleed Home hero with
  explicit Play/Pause, LIVE state, location/tags/current track, waveform, and a
  separate real station-logo badge.
- [x] Rebuild the first Home journey around 44px genre quick choices, compact
  Feed + refresh, search, `Попробуйте сейчас`, `Продолжить слушать`, and
  `Открой новые станции` rails.
- [x] Use the approved cyan night-radio hierarchy on mobile while giving wide
  Home a filled hero + utility side column instead of a narrow central desert.
- [x] Keep Lira centered between Search and Globe on mobile and in the matching
  position on desktop; keep the Home dock's volume/more/play controls usable.
- [x] Finish the mobile density/readability recovery after the first reference
  pass: bound the hero to 276–310px, restore visible genre shortcuts, separate
  station artwork/actions from two-line copy, and replace the stale ~300px Home
  bottom reserve with the measured dock/navigation stack.
- [x] Freeze the hero during play/like bursts, retain rail taste re-ranking, and
  preserve reduced-motion/focus contracts; add 360/390/426px geometry coverage
  for touch targets and non-overlapping card rows.

## Lira track intelligence (done)

- [x] Resolve explicitly named and trusted current now-playing tracks for lyrics,
  meaning, and creation-context questions.
- [x] Ground factual history and author intent in web sources while keeping
  interpretation clearly separate.
- [x] Keep copyrighted lyrics out of full-text responses: return a source link
  and at most a brief excerpt; analyze pasted text without repeating it at length.
- [x] Cover lyrics, meaning, current-track, and no-search fail-soft behavior with
  focused API/client tests.

## Lira Liquid Glass companion (done)

- [x] Replace the compact utility sheet with an immersive full-screen Liquid
  Glass conversation surface, quick prompts, persistent local thread, rich
  station/source cards, and a fixed keyboard-safe composer.
- [x] Retune Lira as a lively, confident music friend with light friendly
  flirting and explicit non-reciprocal romantic boundaries.
- [x] Send trusted now-playing metadata from the Mini App and make song-meaning
  turns read cleaned lyrics-page content before analysis when Tavily can provide
  it; keep output to one short excerpt plus the attributed full-text link.
- [x] Cover now-playing transport, raw-content search gating/cache separation,
  prompt-injection fencing, and the song-analysis path with focused tests.

## Lira playback context + exact artist stations (done)

- [x] Reuse the approved lyre mark across navigation, header, assistant bubbles,
  and typing state; remove the duplicate music-note glyphs.
- [x] Answer natural current-track questions directly from the trusted live
  player context and keep the active station available before metadata arrives.
- [x] Prefer exact artist-name station matches (including `Exclusively The
  Weeknd`) over generic genre slates without hijacking plain genre requests.
- [x] Make the one-chat model explicit in the UI: return through the Lira nav
  action, persistent local history, and confirmed clearing from the header.

## Catalog and metadata reliability audit (done)

- [x] Stop a six-second API cold start from pinning the reduced direct-browser
  fallback for six hours: paint the emergency catalog, retry the primary in the
  background, and cache only the recovered full summary.
- [x] Defer non-hero generated-scene lookups until a card approaches the
  viewport instead of probing every mounted Home rail on first paint.
- [x] Remember definitive 401/403/404/410 metadata endpoint misses for 30
  minutes so the active player does not repeat known-dead Icecast, Shoutcast,
  and Azura probes on every poll.
- [x] Cover the recovery/migration/probe behavior with unit and mobile E2E
  checks; pass the 463-test web unit suite and 106 mobile/desktop/Home flows.

## Lira bounded agent foundation (done)

- [x] Wrap the existing music brain as a typed Worker behind a bounded
  Supervisor with finite routes, task/run ids, runtime/tool ceilings, and
  deterministic fallback behavior.
- [x] Add code-owned action policy and verification; only catalog-grounded
  play/pause, queue, and favorite writes can reach the Mini App client.
- [x] Add a closed, idempotent browser action executor plus action receipts so
  a later turn can observe executed, skipped, or failed state changes.
- [x] Persist run/provider/model/status/step/tool/token telemetry in the existing
  observability store and cover the direct-action and fail-closed paths.
- [x] Generalize the model client: DeepSeek stays default, while opt-in OpenAI
  uses the Responses API and defaults to the cost-oriented `gpt-5.6-luna` tier.
- [x] Add a repeatable six-fixture provider A/B runner with identical catalog
  context, contract grading, reply capture, latency/tokens, and cost estimates.
- [x] Cover queue, favorite, play, pause, and returned action receipts through
  a full inside-Telegram Playwright path; isolate E2E observability persistence
  from local/dev metrics.

## Lira agent polish: constraint fidelity and action UX (done)

- [x] Reproduce recommendation failures against the public production UI:
  explicit «без DnB / shoegaze» and «без шансона / бардов» constraints were
  contradicted by the rendered station cards.
- [x] Enforce explicit negative genre/content constraints after every tool lane
  and before composition; if every catalog card is rejected, fall back to a
  clean external-service query that omits the forbidden clause.
- [x] Route Russian 2010s / modern Russian pop and electronic asks through
  language-scoped `russian pop`, `russian hits`, and electronic catalog searches
  instead of the chanson-heavy broad `russian` shelf; keep retro/classic-hits
  and spoken `russian programming` cards out of that modern lane.
- [x] Show polite, persistent receipts for real play, pause, queue, favorite,
  skipped, and failed actions so the listener can distinguish Lira's promise
  from the client's verified outcome.
- [x] Reduce external-link clutter to three primary services with a native,
  keyboard-accessible «ещё сервисы» disclosure for the remainder.

## Provider outage visibility (done)

- [x] 2026-08-14 incident: the DeepSeek balance hit zero, every model call
  returned `402 Insufficient Balance`, and production Lira answered only with
  deterministic fallbacks. Nothing alerted, because the run was still logged as
  `completed` with `warnings: []` and `verifierPassed: true`.
- [x] `modelClient` now classifies a failure into a closed `ModelErrorKind` set
  (`billing`, `auth`, `rate_limit`, `provider_unavailable`, `timeout`,
  `network`, `http`) without echoing provider prose into logs. A disabled model
  stays unclassified — configuration is not an outage.
- [x] `brain.ts` collects the kinds hit by the planner, vibe-tag, and composer
  calls; `agentRunner` reports the run as `failed` with `model_error:<kind>`
  warnings instead of a clean success.
- [x] `ai_model_error` / `ai_model_error:<provider>:<kind>` counters, plus a
  throttled observability alert for `billing` and `auth`. `modelErrors` is an
  operator signal only and is never returned to the browser.
- [x] Fixed on-box provider A/B (2026-08-14, repeat=1, six fixtures):
  OpenAI `gpt-5.6-luna` 6/6 contracts, median 6.2 s, $0.0065 for the run;
  DeepSeek 0/6 because of the exhausted balance. Once DeepSeek was topped up it
  answered normally again, so the comparison is NOT a quality verdict and
  DeepSeek remains the production default.
- [x] `apps/api/test/observability.access.test.ts` no longer hydrates the
  repo-local dev metrics store, so the suite is green on a developer machine
  that has run the API — not just on a clean CI checkout.

## Provider A/B with both providers funded (done)

- [x] 2026-08-15, six fixtures x three repeats, identical catalog context:
  DeepSeek `deepseek-v4-pro` 15/18 contracts, median 5.5 s, $0.0135;
  OpenAI `gpt-5.6-luna` 16/18, median 4.6 s, $0.0210. Latency and quality are
  close enough that cost keeps DeepSeek as the production default; OpenAI stays
  the evaluated alternative and the standby when DeepSeek is unavailable.
- [x] Both providers failed the SAME fixture, which made it a product gap rather
  than a model difference: «Почему людям так нравится джаз?» came back with
  station cards and an `open-station` action. None of the knowledge, song, or
  trivia predicates matched an open-ended opinion question, so whatever the
  planner had collected was attached to an answer nobody asked to listen to.
- [x] Added `isMusicOpinionQuestion` to the card gate — deliberately narrow, so a
  request wearing a question mark («почему бы не поставить что-то бодрое?»)
  keeps its cards.

## Harvester deadlock (done)

- [x] The hourly station-metadata harvester had been running to
  `processed=0 withTitle=0 recorded=0 failures=8 tripped=true` for hours,
  recording nothing. Two causes compounded: `harvestMetadata.mjs` reported "the
  fetch threw" as status 599, which fell inside the pipeline's 5xx
  "upstream is failing" range, so eight unreachable streams in a row tripped the
  circuit breaker; and a failed station was never stamped, so it kept
  `last_harvested_at` NULL, sorted first in the next run's `stale` order, and
  the same broken head was re-selected every hour.
- [x] Station-level probe failures now have their own, much larger budget and no
  longer count as upstream pressure; the sentinel is exported and imported
  instead of duplicated as a literal. A genuine network-wide outage still stops
  the run.
- [x] Every failed probe — station-level or upstream — is stamped through the new
  `markProbeFailure`, which records the attempt without asserting that the
  station has no metadata. That is what breaks the deadlock.
- [x] `stationFailures` is reported separately in the run summary, and RUNBOOK
  documents how to read a run and how to trigger one by hand.

## Metrics that survive a deploy (done)

- [x] The counters `PLAN.md` asked an operator to WATCH could not be watched.
  `/observability` reported
  `storePath: /opt/RadioAtlas/releases/<sha>/data/observability/metrics.json` —
  the store resolved next to `apps/api/dist`, so it lived inside the release.
  Every deploy booted the API against an empty file, and the disk cleanup from
  the previous session (`current + 2`) deletes the older releases outright.
  On 2026-08-15 three live release directories held three disjoint stores, and
  `ai_agent_run:*` / `ai_model_error:*` existed in exactly one of them.
- [x] `OBSERVABILITY_STORE_PATH` is pinned to
  `/opt/RadioAtlas/shared/data/observability/metrics.json` in
  `ecosystem.config.cjs`, next to the `STATION_INTEL_DB_PATH` line that already
  documents this exact failure mode for the harvester database.
- [x] The three surviving release stores were merged into the shared file before
  the fix shipped: counters summed (each store covers a disjoint window),
  gauges taken from the newest writer, ring buffers concatenated and re-trimmed.
  48 counters and the 4 retained agent runs were preserved.
- [x] The mistake cannot return silently: `isEphemeralStorePath` drives a boot
  WARNING, `/observability` exposes `persistence.ephemeral`, and a test asserts
  the pm2 config keeps the path outside `releases/`.
- [x] Read of the merged window: `ai_chat_request` 4, `ai_agent_run:completed`
  4, `ai_model_error` absent. DeepSeek is answering normally; the sample is too
  small to conclude anything else.

## Opinion-question gate: counted, because there are no transcripts (done)

- [x] "Re-check the gate against real transcripts" turned out to be impossible
  as written. A retained agent run carries provider, model, route, steps, tool
  timings, verifier result and tokens — deliberately no prompt text — so there
  is no transcript in telemetry to check it against, and there should not be.
- [x] The gate now reports itself instead: `ChatResult.cardGate` carries the
  closed set of predicates that matched, whether `isExplicitMusicRequest`
  rescued the cards, and how many cards were actually dropped. It is operator
  telemetry only; the `/ai/chat` response body is an explicit allow-list and
  never carries it.
- [x] Counters `ai_cards_gate:<reason>`, `ai_cards_gate_dropped` and
  `ai_cards_gate_released`. RUNBOOK documents how to read them: a reason at
  zero is an argument AGAINST widening it, and a rising `released` count is the
  signal that a predicate has grown greedy enough to match real requests.
- [x] Added the end-to-end coverage the A/B failure never had: an opinion
  question drops the planner's cards and returns `{kind:'none'}` rather than
  `open-station`, and a request wearing a question mark keeps them.

## VPS runtime: Node 22 -> 24 (done)

- [x] The box was on Node 22.22.0 while README and `node:sqlite` usage assumed
  24+. Upgraded via NodeSource `node_24.x` to **24.19.0** (npm 11.17.0).
- [x] The runtime is shared, so the blast radius was checked before touching it:
  `rodnya-backend` and `rodnya-web-static` run `/usr/bin/node` directly (pure
  JS, no native modules, `engines >=22`), FoddersGameBot runs in Docker and is
  unaffected, and RadioAtlas's native modules are all N-API prebuilds refetched
  by the per-deploy `npm ci`. Both rodnya units were restarted and verified.
- [x] `pm2 update` — the documented way to move the daemon to a new node —
  **hung** on pm2 6.0.14: it killed the daemon and every app and never
  returned, taking the API down. Recovery was `pm2 start ecosystem.config.cjs
  --update-env`, which is what the deploy script uses anyway. RUNBOOK now says
  not to use `pm2 update` on this box.
- [x] Verified after the upgrade: `/health`, public `https://radioatlas.ru/api/health`,
  `/catalog/summary`, a live Lira turn, the harvester one-shot (`processed=194
  failures=6 tripped=false`), and the story card rendering **live** rather than
  serving the static fallback — that last one is the only check that proves the
  native satori/resvg path survived the major bump.
- [x] CI and `engines.node` moved to the same major, so the gate keeps testing
  the runtime production actually runs. The nightly catalog-artifacts job left
  Node 20 (end-of-life since April 2026) even though it commits to master.
- [x] Incidental confirmation that the metrics fix works: the counters carried
  across a full pm2 daemon restart and a runtime replacement without resetting.

## Client telemetry that never landed (done)

- [x] Found by opening the production Mini App and reading the network log, not
  by a test: every page load fires `POST /api/observability/client-event`
  requests that come back **400**. Probed against production directly —
  `app_opened`, `session_state`, `home_station_impression` and `play_attempt`
  all answered `{"error":"unknown event name"}`, while `client_error` answered
  `{"ok":true}`.
- [x] Cause: the server's allow-list held the six infrastructure names it was
  written with, while the web app grew a 47-name product/playback/session
  vocabulary through the same endpoint. Every one of those events was dropped
  at the door and logged as a console error in the listener's browser — the
  app has been instrumented for behaviour it never actually recorded.
- [x] The list stays closed (the counter key is caller-supplied and counters are
  never pruned by age) but is now complete, grouped by family.
- [x] The comment claiming it was "kept in sync with call sites in the web app"
  is replaced by a test that reads the web app sources — both directions, so a
  stale name is caught as well as a missing one.

## Constraint, receipt and grounding telemetry (done)

- [x] Same finding as the card gate, three more times over. "Keep watching
  production constraint-filter and agent-receipt telemetry" could not be done:
  the constraint filter emitted one log line, action receipts were parsed and
  validated and then counted nowhere, and the grounding provider's own
  ok/empty/capped/error status reached the model as context and stopped there.
- [x] `ai_exclusion_*`: clause seen, which repo-owned id matched, cards removed,
  and — the one that decides whether to widen the vocabulary —
  `ai_exclusion_unmatched`, a listener excluding something the list does not
  know. Plus `ai_exclusion_emptied`, where the constraint was kept so
  thoroughly that no station survived.
- [x] `ai_action_receipt:<kind>:<status>` and `ai_action_receipt_failed`: a
  client that could not carry out an action Lira promised is now visible.
- [x] `ai_web_search:<status>` and `ai_web_search_degraded`: an exhausted Tavily
  cap or a provider outage stops being indistinguishable from Lira simply
  choosing not to cite anything.
- [x] Every key space stays closed and repo-owned. The excluded clause is
  reduced to a boolean — a counter key built from chat text would be unbounded
  key minting, and counters are never pruned by age.
- [x] Covered end to end through the brain (a known exclusion, an unknown one,
  and a plain request) plus the route-level counter contracts.
- [x] Production config checked while here: `AI_ENABLED=1`,
  `AI_WEB_SEARCH_ENABLED=1` with a Tavily key present, `AI_PROVIDER` unset so
  DeepSeek remains the default. So the lyrics path in production is the
  Tavily + safe Genius-search fallback described in SPEC; the licensed-provider
  decision is a purchase, not a code gap.

## The persistent metrics store had to survive being killed (done)

- [x] Ninety minutes after the store moved to a path that survives deploys, it
  lost history anyway: `ai_chat_request` went 6 → 3. Cause found in the logs —
  pm2 restarted the API for exceeding `max_memory_restart` mid-flush, the next
  boot read a truncated file (`Unexpected end of JSON input`), hydration failed,
  and the process then wrote its own near-empty state over everything.
- [x] Two defects, both harmless while the store was disposable and both fatal
  once it was not. `writeFile` is not atomic; and the backup rotation `rename`d
  the live file away BEFORE writing the new one, leaving a window with no store
  at all — several times a second under load.
- [x] Writes are now write-then-`rename`. Backups are copied after a successful
  write, at most once a minute instead of on every flush.
- [x] The rotated backups were written and never read. Hydration now falls back
  to them and preserves an unreadable live file as `.corrupt` rather than
  silently replacing it.
- [x] Covered by a test that reproduces the production shape: a truncated live
  file next to a good backup, a flush loop that reads the file on every
  iteration, and a cold start that must not be mistaken for corruption.

## What was eating 700MB (done)

- [x] Measured rather than guessed, against the real 60 309-station catalogue.
  Steady state is the catalogue itself: ~74MB of parsed objects, ~130MB heap
  once `attachSearchIndex` adds its full second copy of every station object.
  That is the ~400MB idle RSS and it is not waste.
- [x] The 30-minute refresh is the high-water mark, and two of its costs were
  pure waste:
  - **Four mirrors, no cancellation.** `RADIO_BROWSER_URLS` defaults to four
    endpoints raced with `Promise.any`, each pulling up to 12 pages x 10 000
    stations. The winner settled the race; the other three kept downloading and
    accumulating a complete catalogue each. Now they share an `AbortController`
    that fires as soon as a winner exists — which also stops fetching the whole
    catalogue four times every half hour.
  - **`JSON.stringify` of the whole catalogue** for the fallback snapshot: one
    68.5M-character string (+137MB on the heap, UTF-16 because of the Cyrillic)
    plus a +69MB Buffer for `writeFile`. Measured 206MB, in one shot, to write
    a file that only matters when the mirrors are down. Chunked write, measured
    peak +40MB, byte-identical output, and now written temp-then-rename so a
    kill mid-write cannot leave a truncated snapshot.
- [x] One hypothesis was measured and REJECTED: normalising in place instead of
  `.map(normalizeStation)` saved 2-3MB, not the expected 74MB — the replaced
  objects are not collected mid-loop anyway. Reverted rather than kept on faith.
  (The first harness that "showed" a 100MB difference was measuring GC lag: in
  both orderings, whichever variant ran second scored ~100MB worse. Each variant
  now runs in its own process.)
- [x] The mirror fix is covered by an integration test that races a fast mirror
  against slow ones and asserts the losers' sockets are actually disconnected —
  verified to fail without the `abort()`.

## Measured on production after the fix (2026-08-15)

Sampled every 10s for an hour, then a refresh triggered deliberately once the
30-minute TTL had expired (the refresh is lazy — it needs a request, so a quiet
hour never triggers one):

```
steady          292-294 MB   (flat across ~27 minutes)
refresh         591 -> 789 MB peak -> 732 -> 480 -> 474 MB
```

- **789MB against the 896MB cap.** Before: 1020-1114MB, four kills in a day.
  No kills since.
- **The headroom is 107MB, which is thin.** One Лира turn during a refresh
  (~+80MB) lands at ~870MB. This is mitigated, not comfortably solved.
- The remaining peak is structural: the refresh holds the previous catalogue
  and its search index while building the replacement. That is inherent to
  swapping atomically, not waste.

Options, in the order they should be considered, all of them the owner's call:

1. Raise `max_memory_restart` to ~1.1GB now that the peak is bounded and
   measured. The box has 3904MB total and ~978MB available at the moment of the
   spike, shared with the rodnya services — so this is a real tradeoff, not a
   free knob.
2. Stop `attachSearchIndex` copying every station object (`{...station}` per
   row). Worth ~48MB at steady state and ~48MB more at the peak, at the cost of
   mutating the cached catalogue rows in place.
3. Lower `CATALOG_MAX_PAGES` (12 pages x 10 000). That shrinks the catalogue
   itself, so it is a product decision rather than a memory one.

## Night pass: the box, not just the process (done)

- [x] `/catalog/summary` took 60s and then 13ms on the next call. Not a hang:
  **swap was at 2000MB of 2047MB**, the catalogue had been paged out, and the
  request was faulting it back in. RadioAtlas is the largest single process
  (673MB) but is NOT among the top swap users — the python bots, searxng and the
  remnawave containers are. The machine is oversubscribed as a whole.
- [x] That settles the earlier "raise the cap" option: **no**. More resident
  memory for RadioAtlas comes out of a machine that is already swapping, and it
  is the neighbours that get pushed out.
- [x] `CATALOG_CACHE_TTL_MS`, default **6 hours** instead of 30 minutes. The
  refresh IS the peak (292MB -> 789MB), and nothing downstream wanted 30
  minutes: the web app caches its Home summary for 6h, and Radio Browser's
  ~62 400 stations change by a handful a day. 48 spikes a day become 4.
- [x] `CATALOG_DATA_DIR`. The fallback snapshot also defaulted to a path inside
  the release directory — the same trap as the metrics store and the harvester
  database — so every deploy threw away the freshest catalogue. Production now
  writes it to `shared/data/catalog`.
- [x] Fixed a defect in my own test from the previous pass: the mirror-race
  integration test spawned the API with fake mirrors and persisted its two
  fixture stations over `apps/api/data/catalog-full.json`, i.e. `npm test`
  destroyed the developer's 70MB local snapshot. Proven fixed by comparing the
  file's size and mtime across a full suite run.

### Two more hypotheses measured and rejected

- Replacing `attachSearchIndex`'s per-station copy with a WeakMap side table:
  **20MB** of a 789MB peak, not the ~50MB expected. Not worth rewriting the
  search hot path and its contract test for 2.5%.
- "The fetch pulls ~110k stations and throws half away": wrong. Radio Browser
  publishes 62 369 and we keep 62 337. `MAX_PAGES=12` is a ceiling the paging
  loop never reaches.

## The memory does not spike, it ratchets (observing)

- [x] Kill #5 arrived at 20:43 on the code that ALREADY had the mirror-abort
  and chunked-snapshot fixes: 1010MB after 5.5 hours of uptime. So the earlier
  reading was incomplete — the process does not merely spike during a refresh
  and come back, it comes back a little higher each time.
- [x] The numbers fit a ratchet rather than a leak: boot at 15:08, ~480MB after
  the first refresh, 842MB at 20:41, killed at 1010MB. Eleven refreshes in
  between, roughly +33MB retained per refresh. V8 grows its heap to hold the
  transient and does not hand the pages back; repeatedly allocating and freeing
  60k-object arrays fragments what it keeps.
- [x] If that is the mechanism, the 6-hour TTL is the right lever and no further
  code is needed: four refreshes a day instead of forty-eight turns ~+65MB/hour
  into ~+130MB/day, against a process that is restarted by every deploy anyway.
- [x] **Measured.** Ordinary traffic does NOT ratchet: a Лира turn through the
  real Mini App took RSS from 425MB to 492MB and it was back to 426MB within 45
  seconds, then flat at ~425MB across the following samples. So the memory a
  request borrows is returned; only the catalogue refresh — a far larger
  transient — grows the heap permanently.
- [x] That makes the 6-hour TTL the right and sufficient lever: the same ~33MB
  per refresh now accrues 4 times a day instead of 48, against a process that
  every deploy restarts anyway.
- [ ] Still unproven, and only time can prove it: that no memory kill happens
  over several days. `grep "exceeds --max-memory-restart" /root/.pm2/pm2.log`
  stands at five; the fifth was 20:43 on the pre-TTL code. If it moves,
  `--max-old-space-size` (make V8 collect rather than grow) is the next lever —
  and a safer one than raising the pm2 cap on a box whose 2GB swap is full.

## A red CI that was a production bug (done)

- [x] `api.degradation` began failing with `502 !== 200` on CI and passing 4/4
  locally. It reproduced twice, so not a flake — but the suite printed the
  spawned API's stderr only when the process EXITED non-zero, which is the one
  failure mode it does not have. The explanation sat in an unread buffer.
- [x] With the assertion carrying that stderr, the cause was one line:
  `Error: database is locked` from `listCatalogProfileOverrides`, i.e. SQLite
  refusing a contended read while building the profiled catalogue.
- [x] The account store runs in WAL mode but set **no `busy_timeout`**, so a
  contended statement failed instantly instead of waiting. The
  station-intelligence store has always set it. This is a production bug, not a
  test artifact: the nightly backup unit opens the same database at 04:20 UTC,
  and a listener would get a 502 Home screen for the duration.
- [x] `PRAGMA busy_timeout = 5000` on the account store; both suites that spawn
  an API now get their own `ACCOUNT_STORE_PATH` and `CATALOG_DATA_DIR` instead
  of sharing the developer's files.

## The ratchet saturates (measured)

Four real catalogue refreshes against the live mirrors, on the current code,
in a local API with no other traffic (each round waited out BOTH the raw TTL and
the hard-coded 5-minute profiled-cache TTL, and each is confirmed by a ~70s
response — a cache hit answers in milliseconds):

```
after boot warm     193MB
after refresh 1     556MB   (+363)
after refresh 2     629MB   (+73)
after refresh 3     629MB   (+0)
after refresh 4     628MB   (-1)
```

- **It is not linear.** V8 grows the heap to fit the refresh working set over
  the first two refreshes and then stops: rounds three and four cost nothing.
  The plateau, ~629MB with no traffic at all, sits below the 896MB cap.
- So production's 480MB -> 1010MB over eleven refreshes was not eleven refreshes
  each keeping ~33MB. It was that plateau PLUS the traffic and the hourly
  harvester burst on top of it.
- Which makes the six-hour TTL worth more than the arithmetic suggested: the
  process now spends nearly all its life at the low baseline (437MB observed on
  production over an hour) instead of repeatedly climbing to the plateau.
- No further code change is justified by this evidence. The number to watch is
  still the kill counter.

The first version of this measurement was wrong and is worth remembering as a
trap: it drove `/catalog/summary`, which is served from an HOURLY bucket cache
and never reaches the catalogue, so four "refreshes" were four 3ms cache hits
that "proved" 0.3MB per refresh. A refresh needs a request that goes through the
profiled catalogue AND both caches lapsed, and it takes ~70 seconds — so the
response time is itself the check that a refresh happened.

## Nothing ratchets permanently (measured across a full cycle)

Production, 63 minutes of one-per-two-minute sampling across a complete
harvester cycle, no deploys in the window:

```
22:25 - 23:06   462-463MB    flat for 41 minutes, no traffic, no refresh
23:08           464MB        harvester tick starts
23:10           481MB
23:12           504MB        peak during the tick
23:14           416MB        tick ends - and it lands BELOW where it began
23:16 - 23:28   414-415MB    flat
```

- The hourly harvester burst costs **+42MB transiently and returns all of it**,
  settling ~48MB below the pre-tick baseline. The earlier 437 -> 468MB reading
  that suggested a per-tick ratchet was simply the transient caught mid-tick.
- Together with the other two measurements — a Лира turn returns its +67MB in
  45 seconds, and the refresh ratchet saturates after two rounds — **nothing in
  this process accumulates without bound.** The 480MB -> 1010MB climb before the
  fixes was refreshes every 30 minutes never letting the process leave the
  elevated plateau, not a leak.
- Kill counter frozen at five for over three hours, the fifth being 20:43 on the
  pre-TTL code.

## The first thing the new telemetry caught (done)

The client analytics unblocked yesterday morning recorded their first real
listening session overnight, and it described a defect nobody had reported:

```
play_attempt 11 / play_success 8      audio_silent_stall 4
audio_reconnect_scheduled 7           audio_reconnect_recovered 8
```

- Every one of those problems belongs to a **single listener on a single
  station**, «Родные Нулевые - Русское Радио», across a session where they put
  the phone away and came back four times.
- The tell: at 18:07:56, after the app had been hidden for almost two minutes,
  `audio_visibility_change` (visible) and `audio_silent_stall` arrive in the
  SAME second, followed by a reconnect.
- Cause: the silent-stall watchdog judged "no progress" from
  `Date.now() - lastProgress.at`, and that clock is refreshed by `timeupdate`
  events — which a backgrounded tab throttles or withholds while the audio keeps
  playing. So the first tick after the listener returned saw two minutes of
  apparent silence and tore down a healthy stream. For a radio app whose whole
  use case is a phone in a pocket, the watchdog was interrupting exactly the
  listening it exists to protect.
- Fix: the watchdog now reads `audio.currentTime` and refuses to recover when
  the position has actually MOVED, whatever the event clock says. Real position
  movement was already the definition of "alive" in `handleTimeUpdate`; the
  watchdog simply never consulted it, though it had been storing the position
  all along.
- `shouldRecoverFromSilentStall` keeps the whole decision, so the case is a unit
  test rather than a story: position moved + a 120s stale clock must NOT recover,
  a genuinely flat position still must. Verified to fail without the guard.

## The station itself: not flaky (measured)

Asked directly after the watchdog fix: was «Родные Нулевые - Русское Радио»
(`470bb4ed`, 96kbps AAC+) also just a bad stream? Probed from the VPS:

```
direct, 180s     99 kbps against a declared 96; 27 gaps of 2-3s, one every ~6s
direct, 600s     97 kbps; 95 gaps, ALL of them 2.0-3.3s, same ~6s rhythm
control TGRT FM  137 kbps, no gap >= 2s
via our /stream  same 6-second burst pattern, unchanged
```

- **Throughput is exactly nominal** — the stream is not starved and does not
  drop out. Ten minutes produced not one gap longer than 3.3s, i.e. no dropout
  at all beyond the regular rhythm. The station is healthy.
- The 2-3s gaps are its server flushing in blocks rather than streaming
  continuously. The control station has none, so it is that host's behaviour;
  our proxy passes it through without adding anything.
- A buffered `<audio>` rides through a 3s gap without `currentTime` going flat,
  so it cannot trip the 9s silent-stall watchdog. That confirms the four
  `audio_silent_stall` events were the watchdog bug, not the stream. The two
  `audio_buffering_reconnect` events are the ones plausibly explained by bursty
  delivery leaving thin margin on a mobile connection.
- `tools/probe-stream.mjs` keeps the method; RUNBOOK explains how to read it.

## Heap cap, measured before it shipped (done)

Kill #6 landed at 16:00 on 2026-08-16 — 959MB after 10 hours — so the six-hour
TTL made the climb slower, not absent. It also showed what the climb costs a
listener: during that window `/catalog/summary`, `/search` and `/areas` all
stopped answering for over a minute while `/health` stayed instant, because the
catalogue endpoints queue behind a refresh.

- Added `runtime:heap_used_mb`, `runtime:heap_total_mb` and
  `runtime:external_mb` gauges first. `--max-old-space-size` bounds the V8 old
  space, not RSS, and the gap between them is ~90MB of code, stacks and
  fragmentation — sizing the flag from RSS is how a graceful pm2 restart becomes
  a fatal OOM.
- Measured against a real refresh (62 423 stations, 71s refetch):
  ```
  default   rss 557MB  heapUsed 352MB  heapTotal 468MB
  640MB     rss 479MB  heapUsed 278MB  heapTotal 394MB   refresh completed fine
  ```
- Shipped `--max-old-space-size=640`. The cap is never reached, so it changes
  V8's growth policy rather than squeezing the working set: the process settles
  ~78MB lower and keeps ~165MB of RSS headroom under the pm2 cap.
- The first measurement of this was wrong in the now-familiar way: it waited a
  fixed 25s for the boot warm, the fetch was still running, and the "refresh"
  five minutes later hit a profiled cache that had only just been built. A 13ms
  response gave it away — a real refresh takes ~71 seconds.

## The attempt counter had no honest denominator (done)

A day of real telemetry read `play_attempt 248 / play_success 38` — a 15%
success rate, if the two were comparable. They are not:

- `RadioContext` starts a play, emits `play_attempt`, and when the result comes
  back `'playback superseded'` it returned **silently** — no success, no
  failure. The Feed supersedes a play on every swipe, so 248 - 38 - 3 = 207
  attempts had simply vanished.
- `play_superseded` now counts them, so the arithmetic reconciles and nobody
  else reads that ratio as a broken player. RUNBOOK gives the corrected formula.
- The API allow-list had to learn the name too, and the drift test written
  yesterday caught it immediately — which is exactly what it was for.

### A flake that nearly cost a good change

The full E2E suite went 240 -> 238 right after this change, twice, with
different specs failing each run. A control run with the change reverted came
back 240, which looked conclusive. It was luck: a SECOND control run also
returned 238, failing on `feed-filters.spec.ts:439` — the same spec that fails
in most runs regardless. The change is exonerated; the suite is simply flakier
on a loaded machine than the earlier three green runs suggested.

Worth keeping as method: one control run is not a control. The first
explanation this produced (throttling the event to reduce beacon volume) was a
fix for a problem that did not exist, and was reverted once the second control
landed.

## The E2E flake, measured and mostly gone (done)

The suite dropped 1-2 specs per run, different ones each time, all passing in
isolation — which had already cost one near-wrong decision earlier in the day.

**Cause found by arithmetic.** `.station-feed-overlay` mounts with
`animation: station-feed-expand 240ms`, starting at `transform: scale(0.965)`.
`boundingBox()` reports the TRANSFORMED box, so a 44px control measures
44 x 0.965 = **42.46px**, under the 43.5px floor the touch-target test asserts.
The test's only wait was for a card name to be visible — which happens at the
START of those 240ms. A serial full-suite run passes 240/240; parallel load only
decides whether the measuring round-trip lands inside the window.

Fixed with `waitForAnimationsToSettle` in `tests/helpers.ts`, which waits for
finite animations and then measures. The 43.5px threshold is untouched: the
contract is asserted on the settled geometry, which is what it always meant.

**The first version of that helper was worse than the bug** — it waited for ALL
animations, and the Feed has an infinite pulsing live dot that never leaves
`running`, so all 12 probe runs hung. Only finite animations can settle.

**Second cause: the suite ran the API under a file watcher.** The webServer
command was `npm --prefix ../api run dev` = `tsx watch`. Editing any API source
mid-run restarts the shared server and fails whichever specs are in a request —
indistinguishable from flakiness, and it explains several of the earlier
readings, taken while this session was editing files. Now `serve:e2e`, no
watcher.

Measured, full suite, same machine:

```
before          238, 238, 238, 240, 238      8 failures / 5 runs
after animation 239, 240, 240, 239, 240      2 failures / 5 runs
after watcher   240, 239, 239                2 failures / 3 runs, both visual
targeted probe  1 failure / 12 -> 0 / 180    feed-filters 44px floor
```

**Residual, and deliberately not fixed:** the two remaining failures are
screenshot baselines (`visual.spec.ts` library + theme studio) diffing 0.05-0.06
against a `maxDiffPixelRatio: 0.04` tolerance. That is 5-6% of the image, too
much for antialiasing — the baselines no longer match what the app renders.
Regenerating them now would bake in whatever the current content happens to be,
days before the design pass rewrites these screens anyway, and loosening the
tolerance would weaken the check. They belong to the baseline refresh already on
this list.

## Лира's glass was dead in the bundle, not in the design (done)

A guard written during the Search rebuild — `assertBackdropFilterOrder.mjs` —
was wired to nothing: no npm script, no workflow, no test. Its only mention in
the tracked tree was a CSS comment claiming it "enforces this mechanically".
Running it for the first time produced fourteen flags.

Measured on the real bundle before touching anything: 76 standard
`backdrop-filter` declarations against 89 prefixed ones. Twelve values existed
ONLY as `-webkit-backdrop-filter`, all of them in `ChatSheet.css` — the scrim,
the card, the header, the bubbles, the prompt cards, the station cards, the
input and the composer. The bundler treats the pair as one prefix group and
keeps the last of the two, so writing the standard property first deletes it.

The half that turns this from a style nit into a live defect: Chrome 148 answers
`CSS.supports('-webkit-backdrop-filter', 'blur(1px)')` with **false**. The
surviving declaration is one the browser does not parse, and the
`@supports not (backdrop-filter: ...)` fallback cannot fire either, because the
browser does support the standard property — what was missing was the
declaration. Every glass surface of the Лира chat has been shipping transparent
and unblurred in the engine Telegram uses on Android and on desktop.

Nothing could have caught it: Playwright runs the dev server, unminified, where
declaration order is irrelevant. Every screenshot showed perfect glass.

- Twelve pairs in `ChatSheet.css` reordered, prefixed first. After: 89 standard
  against 89 prefixed, nothing missing its twin.
- Two further flags — `StationPlaceCard.css` and `FullPlayerOverlay.css` — were
  NOT this bug: they had no prefixed twin at all, and the bundler adds one.
  Written out by hand anyway, because no build target is pinned anywhere in this
  repo, so that autoprefixing is a default rather than a decision.
- `src/glassPrefixOrder.test.ts` runs the guard inside the suite CI actually
  executes. Verified in both directions: reintroducing one reversed pair turns
  the suite red on `ChatSheet.css:18`.

## The guards that ran nowhere (done)

Finding the glass defect started the same question everywhere else: what else in
this repo is written as enforcement and executed by nothing? Four answers, all
now inside `npm run test:scripts`, which CI runs.

- **`geo:check`** audits the globe's country fallback across the whole dump —
  the path that places 49,230 of 62,407 stations, and the only thing that
  exercises it at scale. It read `apps/webapp/public/catalog-full.json`, which
  stopped existing when the dump moved to `artifacts/`, so it had been exiting
  ENOENT rather than checking anything. Repointed, it found one station at
  exactly 0,0 on its first real run. The resolver already refuses null island,
  so nothing was misdrawn; the artifact was carrying a value every consumer had
  to know to ignore, and `updateCatalog.mjs` now writes the pair as absent.
- **`test-prune-caches.sh` and `test-preserve-chunks.sh`** test the two failures
  that filled this VPS to 96% on 2026-08-14, and the rsync contract that decides
  whether a deploy serves half a bundle. Neither had an npm script; one was
  referenced in no file in the repository at all.
- **The Claude Code hooks** got a battery of their own, in both directions. A
  guard that blocks too much is a guard someone switches off: the bash one
  refused to commit a message quoting the commands it blocks, and the path one
  refused edits to `.env.example`.

Two things this did NOT fix, both worth knowing before trusting the numbers:

- `geo:check` reports one zeroed row until the nightly workflow regenerates the
  artifact. The row is upstream data, the fix is at the generator, and the gate
  stays fatal in the meantime — an earlier attempt deleted that gate to get a
  green command, which is exactly the shortcut this file exists to prevent.
- Its `stationsOutsideCountry: 0` is not the product's number. The script models
  the resolver's country-pool branch only: no per-station jitter, and no state
  anchors, which `GlobeScreen` feeds it in production. An adversarial replay of
  the real jitter over the same pools put 3.24% outside their country polygon,
  against this file's own 1% ceiling. The check is honest about the branch it
  measures and silent about the two it does not.

## The globe drew 583 stations in the wrong country (done)

The follow-up the last section promised, measured against the real resolver
rather than a copy of it. `geoResolver.ts` was loaded directly, fed the
catalogue in the shape `/catalog/points` ships, and given the state anchors
`GlobeScreen` builds; then d3-geo was asked whether each dot was inside the
polygon of the country the station claims.

**583 synthesized dots — 1.27% — were inside a NEIGHBOURING country.** 57
Mexican stations in the United States, 31 German in Czechia, 29 Dutch in
Germany, 22 Swiss in France. A further 1,162 sat outside every polygon, which
is mostly the 110m world being coarse around coastlines and not worth chasing.
The cause: a pool point is sampled inside the country, and then a fixed ±0.12°
jitter was added to it without asking whether the result was still home.

Two things had to survive the fix. The jitter exists so stations sharing a pool
point do not stack on one pixel: dropping straight back to the pool point cost
2,527 stations their own position and built a stack of 40 in Dubai, whose
anchor is two kilometres from the water. The offset now **mirrors before it
shrinks** — same radius, other side of the point — and only then steps down.

- Synthesized dots in another country: **583 → 0**. Off every polygon:
  1,162 → 1. Stacking: 0 → 0.
- The 158 dots still outside their country all come from Radio Browser's own
  coordinates, which we deliberately do not move. The ±2° bbox check that
  catches the gross ones is untouched.

### The globe's first mount got 2.3 seconds cheaper

Measuring the fix turned up something bigger. Sample pools were built eagerly:
2,048 rejection-sampled points for every country the payload touched, whether it
shipped 7,000 stations or eleven. Measured in Chrome on the real 59k payload,
that was **6.3 seconds** of the Globe's first mount — and resolving the stations
afterwards was 60ms. Essentially the whole wait was sampling, and most of it was
thrown away.

Points are now sampled per SLOT, on demand: a slot's point is a pure function of
(country, slot), so a country pays for the slots its stations actually land in.
Chrome, 59,039 points, alternating runs:

| | first mount | second pass |
| --- | --- | --- |
| before | 6182 / 6454 ms | 60 / 59 ms |
| after | 2758 / 2733 ms | 868 / 864 ms |

The second pass is dearer because that is where the containment check now lives
with the sampling already cached. A session pays 2.8s + 0.9s per re-resolve
instead of 6.3s + 0.06s, so the Globe is ahead after the first mount and stays
ahead for the two or three re-resolves a session actually does. Memoising the
resolved point per station would take the repeat cost to nothing at roughly 6MB
— measured as not worth it yet, and written down so it is not re-derived.

### And then France turned out to be half the remaining cost

Profiling the sampler over the real catalogue: rejection sampling costs
(slots used) ÷ (acceptance rate) containment tests, and one country was **49.7%
of all of it**. France accepts at 3%, because its 110m feature carries French
Guiana and the bounding box therefore runs from 54°W to 8°E across the Atlantic.
Greece, Indonesia, Chile, Japan and New Zealand followed, all for the same
reason: islands, or long thin land, in a box full of sea. The hundred-odd
countries with fewer than 128 stations were 6.5% of the work between them.

A country is now sampled one polygon part at a time, with the part chosen in
proportion to its true spherical area (`geoArea`), and the containment test run
against that part alone. Area-weighted choice followed by a uniform draw inside
the part is still a uniform draw over the country, so nothing about the picture
changes — verified against the real catalogue: mainland Greece is 93.0% of the
country's area and took 92.0% of its dots before, 92.1% after. There is a test
pinning that, and it passes on both samplers, which is the point of it.

| Chrome, 59,039 points | first mount | second pass |
| --- | --- | --- |
| eager pools (the original) | 6182 / 6454 ms | 60 / 59 ms |
| per-slot sampling | 2271 / 2261 ms | 748 / 762 ms |
| + area-weighted parts | **1415 / 1369 ms** | 756 / 757 ms |

The second pass is now the containment check on the jitter and nothing else.

### `geo:check` now runs the product's code

It used to carry its own copy of the algorithm: still 196 points per country
after the resolver moved to 2048, no jitter, no idea state anchors existed. It
reported `stationsOutsideCountry: 0` while the product was misplacing 583 dots.
It imports the resolver now, and it gates on the number that matters — a
synthesized dot in the wrong country is a hard failure.

It also found two rows the artifact should never have carried: one station at
exactly 0,0 and one with a latitude the Earth does not have. Both are normalised
away at the generator; until the nightly workflow rewrites the artifact,
`npm run geo:check` reports them and exits 1, which is the truth.

## The counters could not answer the question they exist for (done)

`Next:` says to watch the playback ratio. Reading it on production gave 248
`play_attempt`, 38 `play_success`, 1 `play_superseded`, 3 `stream_failure` — 206
attempts unaccounted for, and a "15% success rate" that is not a rate at all.
The reconciliation fix from 2026-08-16 works; what it cannot do is retroactively
count the supersedes that happened before it, and the store now survives deploys,
so the totals mix the two eras permanently. Every counter in this system has the
same problem the moment its meaning changes.

`/observability` now carries `counterWindows.last1h` and `.last24h`: per-hour
increments, only for counters that moved, with the timestamp the window really
starts at. An idle hour costs about twenty bytes, so a day of history is smaller
than one retained agent run. The windowing is two pure functions taking the
clock as an argument, and their test is the reason they are pure.

## The deploy that took twenty minutes (open)

Deploying the geo fix took 20m44s against a normal 1m10s, and
`https://radioatlas.ru/` timed out for most of it — while the API answered on
loopback in 4ms and `current` still pointed at the old release. The edge was
starved, not broken. Full evidence in `RUNBOOK.md`; the short version is that a
human push ships the nightly artifact commit along with its own (a
`GITHUB_TOKEN` commit does not trigger a deploy by itself), the upload rsync has
no `--link-dest` so it re-sends the whole tree, and 107MB of changed JSON on a
2-core box that a neighbour was also using pinned it.

**This recurs on the first push of any day.** The candidate fix is one rsync
flag, written out in the runbook, deliberately not shipped unattended: getting
it wrong fails every deploy, which is worse than a slow one.

## Next:

Next, watching rather than coding — every signal the roadmap asked for now
exists, survives a deploy, and has a documented way to be read:

- **Memory.** `grep -c "exceeds --max-memory-restart" /root/.pm2/pm2.log` stands
  at six; the sixth was 16:00 on 2026-08-16, before the heap cap. If it moves,
  check `runtime:heap_total_mb` first — sitting at 640 means the working set
  genuinely needs more, which is a different problem from V8 declining to
  collect.
- **Playback.** `play_success / (play_attempt - play_superseded)` is the success
  rate; the raw ratio is not — and read it from `counterWindows`, because the
  top-level counters are totals since the store file was created. Checked on
  2026-08-17: 248/38/1/3 cumulative, 206 attempts unaccounted for, all of it
  from before supersedes were counted at all. `audio_silent_stall` climbing alongside
  `audio_visibility_change` would mean the background-tab fix regressed.
- **Лира.** `ai_cards_gate:opinion` stuck at zero argues AGAINST widening the
  opinion vocabulary; `ai_cards_gate_released` climbing means a predicate has
  grown greedy. `ai_exclusion_unmatched` against `ai_exclusion_clause` decides
  whether the exclusion vocabulary is short. `ai_action_receipt_failed` means
  Lira promises what the app cannot do; `ai_web_search_degraded` means she
  answers without the sources she should cite — check the Tavily cap before
  concluding anything about answer quality. DeepSeek remains the production
  default; `AI_PROVIDER` is unset on the box.

Owner decisions, not code: 2GB of swap on the box is fully used and RadioAtlas
is not the main occupant; a licensed lyrics-content provider is a purchase, and
production runs Tavily plus the safe Genius-search fallback meanwhile. Approved
Lira visual baselines wait for the design pass.

Unproven and deliberately not touched, from an adversarial review of 17
candidate diagnoses (3 survived): `account-sync.spec.ts` paces clicks rather
than the 1400ms `CLOUD_LIBRARY_SYNC_DELAY_MS` commit window, and
`mobile.spec.ts`'s three-viewport overflow test shares one 30s budget across
three cold loads. Both failed ONCE, neither has recurred since the watcher fix,
and each edit is larger than the evidence. Reproduce first
(`--repeat-each=20 --workers=6`); if it will not reproduce, there is nothing to
fix.

Known flake, now narrowed: the full E2E suite is 240/240 most runs, and the
residual failures are the two `visual.spec.ts` baselines diffing 0.05-0.06
against a 0.04 tolerance. Regenerate those WITH the design pass, not before.
Any other spec failing twice on the same line is a real defect, not noise.

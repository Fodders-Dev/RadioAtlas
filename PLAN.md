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

## Next:

Next, and NOT a waiting item: **the API is being memory-killed under real
load.** Three restarts on 2026-08-15 (12:10:57, 12:11:27, 12:37:57) at
1114MB / 1012MB / 1031MB against the 896MB `max_memory_restart` cap, and the
12:10 one killed a real listener's `/api/ai/chat` mid-request — Caddy logged the
502 with their Telegram Android user agent. This is the #151 pattern recurring
above the cap it was raised to. Raising it again is not free: the box has 3.9GB
total and ~1.3GB available, shared with the neighbour services, so the next step
is finding what allocates ~700MB above the ~400MB idle baseline (the parsed
58MB catalog artifact and concurrent Лира working sets are the first suspects),
not another bump.

The rest is a WAITING item, not a coding one. Every signal the roadmap
asked to watch exists and survives a deploy; what is missing is traffic. Let
`ai_cards_gate:*`, `ai_exclusion_*`, `ai_action_receipt_*`, `ai_web_search_*`
and `ai_model_error:*` accumulate over a real window, then act on what they say:

- `ai_cards_gate:opinion` stuck at zero is an argument AGAINST widening the
  opinion vocabulary; `ai_cards_gate_released` climbing means a predicate has
  grown greedy enough to match real requests.
- `ai_exclusion_unmatched` against `ai_exclusion_clause` is the ratio that
  decides whether the hand-audited exclusion vocabulary is short.
  `ai_exclusion_emptied` climbing means a `stationPattern` is too broad.
- `ai_action_receipt_failed` means Lira is promising what the app cannot do.
- `ai_web_search_degraded` means she is answering without the sources she was
  supposed to cite — check the Tavily cap or key before concluding anything
  about answer quality.
- DeepSeek remains the production default; `AI_PROVIDER` is unset on the box.

Not code: a licensed lyrics-content provider is an owner purchase decision.
Production runs Tavily plus the safe Genius-search fallback today, which SPEC
already describes as an acceptable steady state. Approved Lira visual baselines
wait for the design pass to settle.

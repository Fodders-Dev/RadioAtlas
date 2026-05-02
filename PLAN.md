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

## Theme Studio (in progress)

- [x] 17.0 Hide Webamp behind easter-egg gate
  - Primary `winamp.expanded` path opens the native RadioAtlas `FullPlayerOverlay`.
  - Legacy Lite/Webamp path remains available only with `?winamp=1`.
  - Skin Lab / `.wsz` entry points are removed from Settings, dock tray, and legacy overlay controls.
  - Webamp/Skin Lab source files stay in the repo for the future easter egg path.
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

## Next:

Next: live Telegram mobile QA for one-tap radio recovery and Search ranking with real catalog data; keep Theme Studio local-only until a separate review opens Stage 18.

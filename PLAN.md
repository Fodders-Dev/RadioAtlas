# RadioAtlas Active Roadmap

Core listening roadmap through Stage 16 is closed. Public/shared/paid surfaces stay deferred until the radio loop is proven stable on real Telegram mobile devices.

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

## Deferred

- [ ] Stage 18: marketplace, server theme publishing, currency, moderation, copyright checks.

## Next:

Next: Stage 17 complete; keep Theme Studio local-only until a separate review opens Stage 18.

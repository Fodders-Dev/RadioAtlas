# RadioAtlas mobile QA — post Stages 1–6

## Summary

**Tests run on this machine** (`C:\Fodder's\Fodder's Island\Fodder's Dev\Radio++_tg`):
- `npm --workspace apps/webapp run build` → **OK**; no emitted JS chunks under 100 bytes after removing the empty Webamp manual chunk.
- `npm --workspace apps/webapp run test:e2e -- mobile.spec.ts` → **33/33 pass**.
- `npm --workspace apps/webapp run test:e2e -- visual.spec.ts --update-snapshots` → **9/9 pass**, baselines re-recorded.
- `npm --workspace apps/webapp run test:e2e -- visual.spec.ts` → **9/9 pass**.
- Live site `https://radioatlas.duckdns.org/` is a SPA and `WebFetch` returns the empty shell. I couldn't drive a real browser session from this harness, so live‑site QA is based on the test snapshot YAML the Playwright run captured (which reflects the same code that's deployed) plus code review.

## Codex pass status

- [x] P1-7: resume shelf uses `home.resumeShelfTitle` instead of repeating the hero kicker.
- [x] P1-8: dense Home hero now has one primary Listen action plus favorite, no secondary Explore CTA.
- [x] P1-9: Home hero trackline no longer renders the noisy explore hint when idle.
- [x] P1-11: Skin Lab preview shows museum screenshots when available and a labelled fallback otherwise.
- [x] P0-3: Webamp skin changes use `setSkinFromUrl` at runtime when available instead of forcing a full reboot.
- [x] P0-4: `useTransportSync` time-mode effect no longer depends on skin URL.
- [x] P0-1: removed the empty `webamp-core-vendor` manual chunk rule.
- [x] P0-5: collection detail close restores the previous Library scroll position after layout settles.
- [x] P0-2: visual baselines re-recorded and verified green.
- [x] P0-6: read-side-only coercion for legacy `tracks`/`history` Library tab state.
- [x] P1-10: dense Globe floating chip-row backdrop.
- [x] P1-12: extra Skin Lab entry from dock tray.
- [x] P2-13: dock title/peek selectors bumped so extracted dock CSS wins over deferred global CSS.
- [x] P2-14: dense Globe reticle is shifted clear of fixed controls and covered by mobile checks.
- [x] P2-15: dock volume long-press cancels on pointer drift.

Stages 1–6 broadly land what the plan asked for: skeleton hero, dense single‑rail Home, globe reticle + Tune Here + sticky focus sheet, mute tap + long‑press tray, queue/explore split, peek truncation, four library tabs with collection detail, followed rows that play/unfollow/route to globe, Skin Lab sheet reachable from Settings + Winamp overlay, dock CSS extracted to its own file. The mobile spec covers it well.

Claude called out three product deltas from the Stage 1-6 review; this Codex pass addressed the actionable app-side parts:

1. The mobile **Home was structurally cleaner** but still read as too many competing labels/actions. Done: dense hero now has one Listen action plus favorite, no idle hint span, and the resume shelf uses `home.resumeShelfTitle`.
2. **Skin Lab preview was a palette mock.** Done: museum results now render screenshot previews when available, with a labelled fallback for presets/uploads.
3. **Skin Lab discoverability was too buried.** Done: Settings/Lite entries remain, and a Skin Lab entry now exists in the dock volume tray.

The user's third ask ("чтобы люди могли выкладывать свои работы напрямую") is intentionally out of scope per the rules — see "Do not do yet" at the bottom.

---

## Findings (severity-ordered)

### P0 — bugs / regressions

**1. `webamp-core-vendor` chunk is 1 byte** ([apps/webapp/dist/assets/webamp-core-vendor-l0sNRNKZ.js](apps/webapp/dist/assets/webamp-core-vendor-l0sNRNKZ.js))
- Repro: `npm --workspace apps/webapp run build`, then `wc -c apps/webapp/dist/assets/webamp-core-vendor-*.js` → `1`.
- Expected: either real Webamp code in the chunk, or the manualChunks rule deleted so no empty chunk emits.
- Root cause: `manualChunks` at [vite.config.ts:131-133](apps/webapp/vite.config.ts:131) tries to bucket `node_modules/webamp` modules. `webamp/lazy` only re‑exports `webamp/built/lazy/index.js` which dynamically imports its own internal chunks; rollup tree‑shakes the re‑export down to nothing but still emits an empty chunk because the chunk name is registered.
- Minimal fix: drop the rule and let `webamp/lazy` keep its own dynamic boundary.
  ```
  // vite.config.ts:131
  - if (id.includes('node_modules/webamp')) {
  -   return 'webamp-core-vendor';
  - }
  ```
- Test: add a build‑artifact assertion in `mobile.spec.ts` (or a new `build.spec.ts`) — read `apps/webapp/dist/assets/`, assert no `*.js` < 100 bytes.

**2. Visual baselines stale; 5 specs fail** ([apps/webapp/tests/visual.spec.ts](apps/webapp/tests/visual.spec.ts))
- Repro: `npm --workspace apps/webapp run test:e2e -- visual.spec.ts` → fails on `home-shell-mobile`, `home-shell-populated`, `search-screen`, `library-screen` (16082 px diff ≈ 2%), `winamp-runtime-shell` (943 px diff).
- Expected: green CI for the new shell.
- Root cause: Stage 6 rebaselining was skipped. The text in the snapshot YAML matches the new Stage 1 home (kicker "Сейчас в фокусе", hero "Hamburg Transit", resume strip with three station tiles, no search launcher), so the diffs are intentional layout/typography deltas, not regressions.
- Minimal fix: `npm --workspace apps/webapp run test:e2e -- visual.spec.ts --update-snapshots` and commit. Also gate visual.spec.ts behind a non‑default project tag in playwright config so PR CI doesn't go red on minor pixel drift between machines.

**3. Skin change reboots Webamp from scratch** ([WinampPlayerShell.tsx:728](apps/webapp/src/components/WinampPlayerShell.tsx:728), [winampShell/boot.ts:103](apps/webapp/src/components/winampShell/boot.ts:103))
- Repro: open dock artwork → Lite overlay opens → open Skin Lab → Apply a museum skin → return to Lite. The whole Webamp instance is destroyed and rebuilt because `winamp.activeSkin.url` is in the boot effect deps.
- Expected: skin swap should call Webamp's runtime API, not re‑mount the shell.
- Root cause: Webamp instances expose `setSkinFromUrl(url)` (`WebampInstance` type already declares it elsewhere). The boot effect treats skin as a structural input.
- Minimal fix: pull `winamp.activeSkin.url` out of the boot deps; add a sibling effect that calls `webampRef.current.setSkinFromUrl(toAssetUrl(activeSkinUrl))` when the URL changes and the instance exists. Fall back to reboot only if `setSkinFromUrl` is absent.
- Test: `mobile.spec.ts` — open Lite, capture the inner Webamp DOM root id, apply a museum skin, assert the same root node is still in the document (not a new one).

**4. `useTransportSync` time‑mode effect tracks `activeSkinUrl`** ([useTransportSync.ts:131-145](apps/webapp/src/components/winampShell/useTransportSync.ts:131))
- Repro: change skin → effect re‑runs and silently dispatches `TOGGLE_TIME_MODE` if Webamp's stored mode is REMAINING. Side effect of fix #3.
- Expected: skin URL has nothing to do with time mode.
- Root cause: leftover dep from when this effect did skin reload.
- Minimal fix: remove `activeSkinUrl` from the dep array; rebind on `[webampReady, webampRef]`.

**5. `Library.tsx` collection detail scroll restore lands at top** ([Library.tsx:206-215](apps/webapp/src/screens/Library.tsx:206))
- Repro: at 360x780, scroll to the bottom collection card, open it, hit Back. Land at `scrollY = 0`, not where you were.
- Expected: scroll to the captured `collectionScrollYRef.current`.
- Root cause: `requestAnimationFrame` runs before the collections grid relayouts (the grid was unmounted while detail was open). The page has not yet grown back to its original height when scrollTo fires, so the browser clamps to `documentHeight`.
- Minimal fix: queue scroll restore after a layout settle:
  ```
  // Library.tsx:213
  - window.requestAnimationFrame(() => window.scrollTo({ top: collectionScrollYRef.current }));
  + window.requestAnimationFrame(() => {
  +   window.requestAnimationFrame(() => {
  +     window.scrollTo({ top: collectionScrollYRef.current, behavior: 'auto' });
  +   });
  + });
  ```
- Test: extend the existing `mobile library keeps four non-wrapping tabs and opens collection detail` spec — scroll, open detail, close, assert `await page.evaluate(() => window.scrollY)` is non‑zero (or matches captured value within ±10px).

**6. Library auto‑redirect away from `tracks`/`history` clobbers persisted shell state** ([Library.tsx:62-65](apps/webapp/src/screens/Library.tsx:62))
- Repro: localStorage has `libraryTab='tracks'` from a prior version. Open Library — runs `setLibraryTab('recent')` once on mount; if SessionContext later restores `tracks` again (e.g. from a sync round‑trip), there's a brief flash and a write‑back race.
- Expected: silently coerce on read, not on every mount.
- Root cause: the effect normalizes by writing back the new value.
- Minimal fix: read‑side coerce — derive `activeLibraryTab` (already done at [Library.tsx:179](apps/webapp/src/screens/Library.tsx:179)), drop the writeback effect entirely. The shell state can stay `'tracks'`; the UI just renders `'recent'` for it. If you must persist, write only when the user explicitly clicks a different tab.

---

### P1 — UX

**7. Hero kicker is the same string as the Resume strip section title** ([homeCards.tsx:165-168](apps/webapp/src/screens/homeCards.tsx:165), [Home.tsx:74-83](apps/webapp/src/screens/Home.tsx:74) for fallback hero, [homeSurface.ts](apps/webapp/src/lib/homeSurface.ts) `createHomeResumeModule`)
- Repro at 360x780, no station playing: page reads top‑to‑bottom: `Сейчас в фокусе` → station card → `Слушать / Изучить рядом / ❤` → `Сейчас в фокусе` again as the resume strip section title → another 2 station cards → rail.
- Expected: the hero owns "Сейчас в фокусе" (or whatever the discovery feed names it). The resume strip should say something like `Продолжить эфир` / `Снова в эфире` — locale already has `home.resumeShelfTitle` ("Продолжить эфир") and `home.revivedTitle` ("К чему вернуться") that aren't being used here.
- Root cause: `createHomeResumeModule` defaults `titleKey` to `'home.freshSignalsTitle'` for empty + active branches. Both the hero and the resume module use it.
- Minimal fix: change the resume module's `titleKey` to `'home.resumeShelfTitle'`. Don't add new copy; the string already exists in [ru.ts:206](apps/webapp/src/state/locales/ru.ts:206) and [en.ts](apps/webapp/src/state/locales/en.ts).

**8. Hero has three competing CTAs for one "play this radio" intent** ([homeCards.tsx:206-231](apps/webapp/src/screens/homeCards.tsx:206))
- Repro at 360x780: hero shows `Слушать` (primary), `Изучить рядом` (secondary, opens search), heart (icon, like). The user's literal feedback: «хочется послушать радио» — they want one giant button.
- Expected: Listen is huge; Heart is a small affordance; "Изучить рядом" is collapsible (move to a kebab or swipe action), or only shown on non‑dense.
- Root cause: dense layout uses the same three‑slot grid `minmax(0, 1fr) minmax(0, 1fr) 34px` ([home.css:727-730](apps/webapp/src/screens/home.css:727)).
- Minimal fix: at `screen-home-next[data-density='dense']`, drop the secondary `Изучить рядом` button and grow `home-primary-btn` to the full row:
  ```
  .home-hero-card.is-dense .home-hero-actions {
  -  display: grid;
  -  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 34px;
  +  display: grid;
  +  grid-template-columns: minmax(0, 1fr) 34px;
     gap: 6px;
  }
  .home-hero-card.is-dense .home-secondary-btn { display: none; }
  ```
- Test: extend `mobile home dense keeps only hero resume and one rail` — assert the hero exposes one primary action and one heart, no secondary explore button.

**9. Hero trackline copy is busy** ([homeCards.tsx:201-204](apps/webapp/src/screens/homeCards.tsx:201), [home.css:214-239](apps/webapp/src/screens/home.css:214))
- Repro: hero trackline shows `<strong>{stationTags || activeTrack}</strong> <span>{home.heroExploreHint}</span>`. On dense, [home.css:562-564](apps/webapp/src/screens/home.css:562) hides the span — good. But on default 412px width (still mobile, but `isCompactLayout` may evaluate false depending on `useCompactLayout` thresholds) the line reads `techno · industrial Похожее можно открыть через поиск` — long and noisy.
- Expected: keep tags only; drop the hint span entirely (or reuse it as `aria-describedby`).
- Minimal fix: stop rendering the second `<span>` when not actively playing. The `t('app.liveBadge')` branch is fine; the `t('home.heroExploreHint')` one is unhelpful.

**10. Globe dense floating chip‑row has no backdrop and looks orphaned** ([discover.css:367-378](apps/webapp/src/screens/discover.css:367), [GlobeScreen.tsx:288-326](apps/webapp/src/screens/GlobeScreen.tsx:288))
- Repro at 360x780: open Globe. The chip row containing `Tune here / Toggle Spin / Clear selection` is `position: fixed` at `bottom: var(--dock-offset-v2) + 42dvh + 18px`. It has no background of its own (just `display:grid; gap:10px` from [discover.css:77-81](apps/webapp/src/screens/discover.css:77)). The chips themselves have backdrops, so they survive on the canvas — but the container has no spatial cue connecting them to the globe or the focus sheet underneath.
- Expected: the floating row should look like a deliberate "globe controls" island, not chips levitating on the planet.
- Minimal fix: add a glass backdrop only to the dense floating variant:
  ```
  .screen-globe-minimal[data-density='dense'] .globe-command-footer {
  +  padding: 8px 10px;
  +  border-radius: 18px;
  +  background: rgba(8, 14, 24, 0.62);
  +  backdrop-filter: blur(18px) saturate(170%);
  +  -webkit-backdrop-filter: blur(18px) saturate(170%);
  +  border: 1px solid rgba(180, 223, 255, 0.18);
   }
  ```
- Test: visual baseline diff (after re‑recording per P0‑2). Or DOM check: `await expect(page.locator('.screen-globe-minimal[data-density=dense] .globe-command-footer')).toHaveCSS('backdrop-filter', /blur/)`.

**11. Skin Lab preview is a CSS palette mock, not the real shell** ([SkinLab.tsx:41-79](apps/webapp/src/components/SkinLab.tsx:41))
- Repro: open Skin Lab from Settings. The "Preview" card at the top renders a hard‑coded ASCII‑style box ("WINAMP / RadioAtlas Lab FM / Mock Song / 5 dots / playlist label"). Tapping a museum result repaints just the box's CSS vars. The user perceives the whole feature as "цвета меняются и всё".
- Expected: a real (silent) Webamp instance rendering the candidate skin, OR the museum's screenshot URL as the preview when available.
- Minimal fix (no big rewrite): replace the palette mock with the museum screenshot for `museum` source, and a bigger version of the existing `WIN`/`WSZ` fallback for presets/uploads. This already lives on `WinampMuseumSkin.screenshotUrl`. For uploads, render the active skin filename + a labelled placeholder until we add a real Webamp preview.
  ```
  // SkinLab.tsx:52-79
  - <div className="skin-lab-preview-shell" …>{...mock...}</div>
  + skin.source === 'museum' && skin.screenshotUrl ? (
  +   <img className="skin-lab-preview-image" src={skin.screenshotUrl} alt={skin.name} />
  + ) : (
  +   <div className="skin-lab-preview-fallback" data-preview-skin-source={skin.source}>
  +     <strong>{skin.name}</strong>
  +     <span>{t('skin.previewWillRender')}</span>
  +   </div>
  + )
  ```
  And add a CSS rule so the screenshot fits the preview surface (`width:100%; aspect-ratio: 4/3; object-fit: cover; border-radius: 16px`).
- Tests already assert `data-preview-skin-source` and `data-preview-skin-name` — keep those attributes on the wrapper so the spec stays green.
- Residual risk: the user may still want a live miniature shell. A second pass can swap the screenshot for a tiny `Webamp` instance booted with `initialTracks: []` and audio muted; the P0‑3 runtime-skin prerequisite is now fixed.

**12. Skin Lab discoverability is two trees deep** ([App.tsx:97-99](apps/webapp/src/App.tsx:97), [Settings.tsx:73-79](apps/webapp/src/screens/Settings.tsx:73), [WinampPlayerShell.tsx:1239](apps/webapp/src/components/WinampPlayerShell.tsx:1239), [LitePlayerOverlay.tsx:249](apps/webapp/src/components/LitePlayerOverlay.tsx:249))
- Repro: user lands cold, no station playing. To reach Skin Lab they need: gear icon → Settings → "Open Skin Lab". Or: gear → "Open fullscreen" → Lite overlay → "Open Skin Lab".
- Expected: at least one entry from a "main shell" surface so curious users can find the feature.
- Minimal fix: add a small "Skins" chip to the dock's volume tray header (`player-dock-tray-head` when `trayMode === 'volume'`) — it's already an open tray, has space, and naturally pairs "audio look + audio level". Don't add a new bottom‑nav item; don't add a hero entry.
- Residual risk: discoverability is improved through the dock tray, but there is still intentionally no Home/topbar entry. If a dedicated topbar chip is added later, hide it behind a feature flag.

---

### P2 — Touch / scroll / cascade hygiene

**13. `apps/webapp/src/styles.css` is still 8616 lines with many `.player-dock-*` / `.app-navigation-mobile` / `.mobile-nav-item` / `.library-tab-strip` rules redeclared in 5+ media queries.**
- Stage 6 only extracted dock CSS; the rest still lives in the global file.
- This isn't a bug today — it's a future‑regression vector. Specifically: the new `MiniPlayerDock.css` ships rules with `.player-dock .player-dock-title { font-size: 14px }` which **may collide** with later `.player-dock-bar .player-dock-title { font-size: 12px }` in `styles.css` depending on cascade order. Currently the dock CSS wins because it's imported first by the lazy chunk and `styles.css` is loaded *after* via the deferred `loadGlobalStyles()` ([App.tsx:48-54](apps/webapp/src/App.tsx:48), [App.tsx:129-133](apps/webapp/src/App.tsx:129)) — last sheet wins, so styles.css overrides the dock CSS for users who get to that idle import.
- Repro: in dev, with mobile dock visible, run `getComputedStyle(document.querySelector('.player-dock-title')).fontSize`. Expected `14px`. On a slow connection or after `loadGlobalStyles` resolves, you may flip to `12px`.
- Minimal fix: bump specificity in `MiniPlayerDock.css` to `.player-dock.player-dock-bar .player-dock-title { font-size: 14px; }` so it ties or wins regardless of import order, OR remove the duplicate `.player-dock-bar .player-dock-title` block in `styles.css` while you're touching it.
- Test: a tiny Playwright assertion that asserts `.player-dock-title` computed `font-size` is `14px` after `loadGlobalStyles` has resolved (e.g. after a `playHomeStation` + 200ms idle).

**14. Globe focus sheet + footer + dock + mobile nav stack on dense** ([discover.css:363-383](apps/webapp/src/screens/discover.css:363))
- Repro at 360x667 (older iPhones, popular in TG): four fixed bands stacked from the bottom: nav (~60px), dock (~52px), focus sheet (`max-height: min(42dvh, 320px)` ≈ 280px), floating footer (chip row). The globe canvas behind them is `clamp(360px, 52dvh, 430px)` ≈ 348px tall. The reticle ends up *under* the floating chip row.
- Expected: the reticle should sit roughly in the visually clear area of the globe.
- Minimal fix: when `data-density='dense'`, push the canvas anchor up so the reticle isn't covered. Either `transform: translateY(-12%)` on the canvas via the `.globe-reticle` parent, or move the reticle to `top: 38%` instead of `50%` on dense. The math here is forgiving — get it visually clear, then ship.
- Test: existing `mobile globe uses reticle tuning…` already asserts the reticle is visible. Add `expect(reticleBox.y + reticleBox.height/2).toBeLessThan(footerBox.y - 24)`.

**15. `dock-volume-btn` long‑press timer can leak when the user scrolls before lifting** ([MiniPlayerDock.tsx:147-161](apps/webapp/src/components/MiniPlayerDock.tsx:147))
- Repro: press and hold on dock volume, drag finger off the dock onto the page (causing the button to lose pointer capture but no `pointerleave` fires reliably on iOS). Timer fires, tray opens, but the user thinks they cancelled.
- Expected: any pointer movement above ~6px cancels the long‑press timer.
- Minimal fix: add a `onPointerMove` on `dock-volume-btn` that calls `clearVolumePressTimer()` if the move distance exceeds the same `DRAG_THRESHOLD`. Track pointer at down via a ref.
- Residual risk: pointer-drift cancellation is covered in mobile spec, but real iOS Telegram touch behavior should still be watched manually.

**16. SettingsSheet "Open lite fullscreen without active playback" path** ([Settings.tsx:80-87](apps/webapp/src/screens/Settings.tsx:80), already covered by mobile spec)
- No issue found. Test 25 covers this. Residual risk: still keeps the heavy Webamp boot eager when the user just wanted to look at Skin Lab; this is the third reason to fix P0‑3 (skin reboot).

---

### P3 — Things that look fine

- **Globe Tune Here, Clear‑resets‑zoom, retap‑deselect, single wheel listener** — covered by tests 5–8, code matches the plan ([GlobeScreen.tsx:167-182](apps/webapp/src/screens/GlobeScreen.tsx:167), [Globe.tsx:189-202](apps/webapp/src/components/Globe.tsx:189), `findNearestAreaToRotation` in [components/globe/selection.ts](apps/webapp/src/components/globe/selection.ts)).
- **Globe focus seed from `summary.countrySpotlight` → station coords → `areas[0]` fallback** ([GlobeScreen.tsx:184-233](apps/webapp/src/screens/GlobeScreen.tsx:184)) — solid.
- **`globeFocusRegionId` handoff from Library** ([Library.tsx:226-229](apps/webapp/src/screens/Library.tsx:226), [GlobeScreen.tsx:144-160](apps/webapp/src/screens/GlobeScreen.tsx:144)) — looks correct, the Library effect sets and the Globe effect consumes + clears.
- **Home one‑shot summary error banner** — covered by test 11; ref‑based dismissal looks right ([Home.tsx:359-364](apps/webapp/src/screens/Home.tsx:359)).
- **Dock peek mounts immediately, no 1.8s gap** — test 13 confirms. `dockMounted` state gone, dock wrapped in plain `Suspense` ([App.tsx:333-335](apps/webapp/src/App.tsx:333)).
- **Buffering does not double‑signal in track line** ([MiniPlayerDock.tsx:88-96](apps/webapp/src/components/MiniPlayerDock.tsx:88)) — when `playbackState` is non‑null, track text falls to `dock.currentTrackUnavailable` instead of `common.loading`. Confirmed by test 18.
- **Library inline collection creation, add‑current hidden when no station, followed rows play/unfollow/route to globe** — tests 20, 21, 22, 23 all green.
- **Uploaded skin object URL lifecycle** — `uploadedPreviewUrlRef` revoked on unmount and on next upload ([SkinLab.tsx:137-145](apps/webapp/src/components/SkinLab.tsx:137)) and `uploadedSkinUrlRef` is revoked again in `selectUploadedSkin` ([RadioContext.tsx:1238-1244](apps/webapp/src/state/RadioContext.tsx:1238)). Storage source after apply is `'preset'`, confirmed by test 27.
- **Collection add/remove uses the station id, not index** ([Library.tsx:683-686](apps/webapp/src/screens/Library.tsx:683)) — fixed; aria‑label includes station name. Good.

Residual risk: the Skin Lab still does not boot a separate muted Webamp instance inside the sheet; this pass uses museum screenshots as the low-risk MVP preview.

---

## Direct response to user feedback

> «На главной много непонятного текста, разбираться не хочется, а радио послушать хочется».

The two surgical changes that make Home feel like "tap to listen":

- Stop saying "Сейчас в фокусе" twice (P1‑7): rename the resume strip to `home.resumeShelfTitle` ("Продолжить эфир") — already in the locale dict.
- Drop "Изучить рядом" from the dense hero and make `Слушать` span the row (P1‑8) — minus one decision the user has to make.
- Drop the secondary hint span "Похожее можно открыть через поиск" from the trackline (P1‑9).

Combined, the dense Home becomes: skeleton → one labelled hero with one big Listen + heart → "Продолжить эфир" rail → one discovery rail → bottom nav. Everything else moves to non‑dense / desktop.

> «Скин лаб вообще хуй пойми как работает… вместо синего стало серым».

Two changes:

- Replace the fake `<PreviewShell>` palette mock with the museum's screenshot for the museum source, and a labelled placeholder for presets/uploads (P1‑11). This is what the user expects when they look at `skins.webamp.org` in the screenshot they shared — they see actual skins, not colored boxes.
- Stop rebooting Webamp on every skin change (P0‑3). Once the preview is visual, the user will start switching skins quickly; today every Apply tears down and re‑instantiates the runtime.

Concrete near‑term roadmap aligned with the user's "real Winamp variety, not just colors":

1. Fix the preview to show the museum screenshot (this PR).
2. Fix the boot effect to use `setSkinFromUrl` instead of remount (this PR).
3. Once Skin Lab feels real, swap the screenshot preview for a *muted* Webamp instance booted inside the lab sheet so the user sees the actual chrome before applying. Bigger change, schedule after the home/preview wins land.

> «Чтобы люди могли выкладывать свои работы напрямую в нашем приложении».

This is exactly the kind of feature that the rules say to gate behind "Home/Globe/Player/Collections/Skin Lab feel cohesive". Specifically it needs: account auth (have it), upload + storage backend (don't have it for skin assets, only catalog data + account sqlite), moderation (don't have it), public catalog endpoints (don't have it). Don't start before the steps above land. When you do, treat it as a Skin Lab v2 spec — separate plan, separate review.

---

## Do not do yet

- **Skin Lab builder / asset editor / public skin gallery / skin upload‑to‑server.** None of these exist; they need account + storage + moderation. Deferred per project rules.
- **Marketplace, Stars, paid packs.** Not now.
- **Public/Editorial Collections.** Same gate.
- **Big rewrite of `apps/webapp/src/styles.css`.** Stage 6 split out the dock; leave the rest until the file you're editing forces it. P2‑13 only asks for one specificity bump.
- **Any change to the `summary.countrySpotlight` algorithm** to "improve recommendations". The user's complaint is that the screen is *busy*, not that the picks are bad. Reduce text density first, then revisit picks based on signal.

---

## Minimal patch order for Codex

1. [x] P1‑7 — change resume module's `titleKey` to `home.resumeShelfTitle` (one line in `homeSurface.ts`).
2. [x] P1‑8 — collapse dense hero actions (CSS + remove the secondary button on dense in TSX).
3. [x] P1‑9 — drop the trackline hint span when not playing live.
4. [x] P1‑11 — replace `<PreviewShell>` body with museum screenshot or labelled fallback.
5. [x] P0‑3 + P0‑4 — switch skin swap to `setSkinFromUrl`; drop `activeSkinUrl` from the time‑mode effect.
6. [x] P0‑1 — delete the `webamp-core-vendor` manualChunks rule.
7. [x] P0‑5 — double‑rAF the collection detail scroll restore.
8. [x] P0‑2 — re‑record visual baselines after 1–7 land, in a separate "snapshots" commit so the diff stays reviewable.

Everything else (P0‑6, P1‑10, P1‑12, P2‑*) can ride a second PR or a follow‑up housekeeping pass. None of it blocks ship.

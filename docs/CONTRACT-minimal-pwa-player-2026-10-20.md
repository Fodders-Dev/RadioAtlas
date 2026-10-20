# Minimal native player inside the existing PWA

Owner explicitly authorized implementation with Luna, Astra review, and release
for physical iPhone testing. Sound remains broken outside the foreign PWA.
This is diagnostic isolation, not a declared fix of the background incident.

## Implementation contract

1. A developer-diagnostics entry in Settings navigates the CURRENT window to a
   same-origin `/audio-lab.html` document within the existing manifest scope.
   Explicitly stop the main player first. No new tab, external-browser helper,
   new installation, manifest identity change, data clearing or account mutation.
2. The Vite-built standalone document imports no React app/bootstrap/player,
   recovery engine, analytics, catalog, Telegram SDK, WebAudio or service-worker
   registration. It contains exactly one native audio element, native lean
   attributes matching Apple production: no crossOrigin, preload none,
   playsinline, autoplay false. No extra timer, silent element or keepalive.
3. Fixed known source: NoLife-Radio's `https://listen.nolife-radio.com/` through
   the existing same-origin `/api/stream?url=` route. Public catalog lookup on
   20 October confirmed this mount. Show source identity; no generic URL input,
   route fallback, retry, source replacement on resume or autoplay on visibility.
   One src assignment at document initialization; explicit Play calls native
   play, Pause calls pause, explicit Stop releases the source/handlers and leaves
   a terminal stopped screen with the report available. Returning to RadioAtlas
   stops/releases this element before same-window exit.
4. Minimal MediaSession metadata names this diagnostic player and NoLife;
   artwork uses our same-origin app icon. Standard Play/Pause and explicit Stop
   actions use the same direct handlers. No queue or Next/Previous in this
   single-station probe; clear seek actions independently and position state.
   Do not rebind after playing or manipulate AudioSession.type. Feature-detect
   and contain partial/throwing APIs. Keep metadata on Pause.
5. Display actual build, standalone/tab status, visibility, native media state,
   AudioSession type/state if available; unknown is honest. Outside standalone,
   show a visible warning that this is not the installed-PWA trial. Never infer
   audible output from currentTime/playing/active. Manual 'sound heard'/'silence'
   markers record the owner's observation separately.
6. Local-only bounded diagnostic journal: schema allowlist; no URLs, station IDs,
   accounts, raw error messages or automatic upload. Reuse core recorder only
   if it introduces NO app/recovery dependency or mutating side effects; otherwise
   separate minimal schema. Max 200 entries / 128KiB / 20 minutes; persist locally
   with exception containment and expiry checked on events (no new timer).
   Record native/lifecycle/media-command events, native promise outcome and
   throttled timeupdate progress, optional AudioSession statechange observer.
   No observer may call playback. Clipboard report with selectable text fallback.
   UI reads own state on events/explicit refresh only, not polling.
7. Clear accessible mobile UI: Play, Pause, Return, Copy report, sound markers;
   44px controls, normal text contrast, safe-area padding, long report scroll,
   narrow-screen fit. Technical detail belongs here because this is an explicit
   developer diagnostic. No app-wide redesign or release of A03/other UI WIP.

## Verification

Luna owns runtime/config/tests/locales; Sol owns docs, independent review,
browser inspection, full checks, integration and release. Astra reviews isolation
and interpretation. Regression checks cover default app no lab mount, same-window
entry after Stop, exactly one audio in lab, no AudioContext/timers/recovery,
no src replacement on Pause/Play/visibility, partial APIs, bounded journal,
clipboard fallback, returning without autoplay. Browser mocks test contracts,
not iPhone sound. Inspect lab and Settings entry at mobile and desktop sizes.

Both typechecks, full webapp units, serial full functional Playwright, build;
required same-SHA CI and deployment; public HTML and its actual JS build/source
route verified. Real-source foreground smoke has no media mocks and is labelled
Chromium only. Physical iPhone acceptance remains the owner's next step.

## Physical interpretation

From installed RadioAtlas: Моё → Настройки → Для разработчиков → Диагностика →
minimal player. Confirm standalone and release build, explicitly start NoLife,
hear it, background/lock and Pause/Play. Also compare foreign PWA foreground →
Home → foreign PWA foreground on one stream without changing source/commands.
Mark heard sound separately, export journal before further installation changes.
No further deletion is requested. Reproduction on this page demonstrates that
the full recovery engine is unnecessary for the failure; success alone does not
exonerate it, since navigation may reset native state. No raw native PID/audit
tokens can be established through this page.

---
paths:
  - "apps/webapp/src/**"
---

# Working in apps/webapp

## The cold start is a contract

This runs inside a Telegram WebView on a phone, often on mobile data. Home's
first paint must not pull the Globe, HLS, the fallback catalogue, the playback
runtime, Theme Studio, Lite or the Full Player overlay — those are lazy on
purpose and there are tests asserting it. React is bundled from our own origin;
no CDN import may come back.

**That includes fonts, and for months it did not.** `index.html` carried a
render-blocking stylesheet from a font CDN. Measured on the real bundle at
390x844: a REFUSED request still paints in ~356 ms, but a HANGING one — no
response, no refusal, which is what a filtered or throttled network produces —
gives **no paint at all within 25 seconds**, while every one of our own bytes has
arrived at 73 ms. Manrope is now self-hosted from `public/fonts/`, declared in
`boot.css` (the first stylesheet, so the request starts earliest) with
`font-display: swap`, and preloaded in `index.html` for the two subsets a
Russian-first UI always needs. One variable file per subset with Google's own
`unicode-range` split, so a page pays only for the scripts its text uses.

**And it included the Telegram SDK, which was the exception until it wasn't.**
`index.html` loaded it synchronously from `telegram.org`, and that host does not
answer from Russia: measured 2026-08-31 from the RU server, three attempts, DNS
resolves and TCP to :443 never connects — no response in 20 s, while the same
file is 200 in 0.10 s from the Netherlands box. A synchronous script that hangs
holds the parser, so the page never rendered, and radioatlas.ru would not open
on a Russian mobile network without a VPN. Moving to a Russian host did not help
because the blocker was never our host.

The old comment there argued the exception was safe: a failed load leaves
`window.Telegram` undefined and every call site degrades gracefully. True, and
beside the point — that is a REFUSED load. The SDK is now vendored into
`public/vendor/` and served from our own origin. It is also `async`: self-hosting
does not protect the parser when a particular VPN/mobile route hangs on one of
our own files. A real Chromium reproduction with that request held open still
had `document.body === null` after 5 s under the old synchronous tag. `defer` is
not an alternative because it still holds Vite's module execution; the app's
Telegram consumers snapshot immediately and subscribe to
`radioatlas:telegram-sdk-ready` for a late SDK. Refresh the vendored file with
`node scripts/updateTelegramSdk.mjs`.

⚠ The block is per-network, not universal. From the owner's home connection
`telegram.org` loads fine; from a datacentre and from Beeline mobile it does
not. So verify this class of thing FROM A SERVER or a phone — on a developer
machine everything looks healthy.

`src/criticalPathNoCdn.test.ts` is the guard and it now allows **no** external
script at all. It also requires the vendored Telegram SDK to stay async. Do not
add a font, stylesheet, script or icon from another origin — and if a display
face is ever added for a theme, it self-hosts too.

⚠ One of the same family is still open: `AccountSheet.tsx` injects
`telegram-widget.js` at runtime for the login button. It is `async` so it does
not block paint, and an always-visible bot deep-link chip covers the same job —
but its only fallback is `onerror`, which a HANG never fires, so from Russia
that slot stays blank rather than falling back.

## Playback is the product

- **The station never switches by itself.** Camera motion on the Globe, opening
  the Feed, a chip tap, a stream error — none of them may change what is
  playing. Only a direct user action does. This is the repo's oldest hard rule.
- Recovery paths (reconnect, candidate failover, silent-stall watchdog) run
  inside `useAudioPlayer`. When touching them, remember the listener's phone is
  usually in a pocket: a backgrounded tab throttles timers and withholds
  `timeupdate` while audio keeps playing, so anything judged from wall-clock
  time will misfire. Judge from `audio.currentTime` movement instead.
- On a secure RadioAtlas page, a direct HTTPS MP3/AAC is not proof that the
  listener has a usable route to it. Keep recognized direct audio first so a
  healthy stream does not spend our server bandwidth, but include the
  same-origin `/api/stream` candidate immediately after it. Gamesboro measured
  at `readyState=0` for 25–30 seconds over the direct route while the RU proxy
  sustained the advertised stream, so `radio.gamesboro.org` is the deliberately
  narrow exception and runs proxy-first. Do not broaden that host list without
  measuring both routes: every entry spends our server bandwidth. Extensionless
  and HLS streams remain proxy-first, while constrained mobile and Telegram
  runtimes may still force proxy-only playback.
- **A recovery path must never touch the element while `play()` is pending.**
  `audio.load()` on top of an unsettled `play()` rejects it with AbortError, the
  catch treats that as a dead candidate, and the watchdog and the candidate loop
  then walk the same list against each other until it is empty. That was a third
  of all plays failing on stations that answered in 88ms. The guard is
  `candidateSwitchGuard.ts`; `playPendingRef` is what it reads.
- **A supersede is not a failure.** `PlayAttemptOutcome` is three-valued for
  this reason: `superseded` means somebody newer owns the `<audio>` element — a
  second tap, a station picked directly, another walk of a list — not that the
  station is dead. Anything that reads it as failure advances to the next item
  and races whoever took over. Measured 2026-08-18: one «Перемешать избранное»
  produced 36 attempts in 191 ms, all superseded, ending on «нечего играть» over
  a library of 120 saved stations. Both walkers now go through
  `state/radio/queueWalk.ts`, and only its `exhausted` result may tell a listener
  their list is unplayable.

## Metadata: two slots, and the listener owns one

A now-playing refresh is a serial chain of up to ~6 probes and can hold its slot
for the better part of 20 seconds, and there are only two slots. So the queue
(`lib/metadataRefreshQueue.ts`) distinguishes a `listener` — the station somebody
is actually hearing — from a `preview`, which is a card on a shelf that can wait:
listeners are served first, AND previews may never occupy every slot, because
ordering alone does not help if both slots are already busy when the listener
arrives.

Any list surface that wants to show a track must use `resolveOnce` — one attempt,
never SSE, never the polling set — and must render NOTHING when there is no fresh
track. ~40% of stations never emit a title, and `isFreshNowPlayingTrack` is the
gate that stops a 14-day-old cached track being presented as live.

## Home: the listener's own stations outrank the catalogue

«К чему вернуться» (`revived-stations`) is the saved/followed stations and sits
SECOND in the rail pool, right behind the discovery shelf. Three things keep it
alive and all three were once broken at the same time, so do not undo one
thinking it is redundant:

- The hero blocks only ITS OWN station from the shelves. Its `companionStations`
  must not be blocked: they come from the same list, and on a phone they are not
  rendered at all — blocking them deleted three stations from the surface.
- `revivedStationsList` is NOT filtered against `blockedIds`. A saved station
  belongs to the shelf of saved stations first; a discovery shelf yields to it.
- The shelf is exempt from `HOME_MIN_RAIL_STATIONS`. That floor exists so a
  two-tile row of stations nobody asked for does not read as filler; one station
  somebody deliberately saved is not filler.

The first-run card promises «Сохранишь станцию, и она останется здесь». Anything
that makes that false again is a defect, not a layout preference.

## The head of index.html is a growth surface, not boilerplate

`index.html` carries the link preview: `description`, the Open Graph set and
`twitter:card`. Until they existed a link to RadioAtlas dropped into a chat
rendered a bare URL — no picture, no text — and sharing is the only way the first
listeners reach a product nobody has heard of. They are easy to delete by
accident, because that file is edited for other reasons, and nothing inside the
app looks different when they are gone. `src/linkPreview.test.ts` is the guard.

Two rules it enforces, both learned the hard way elsewhere in this repo:

- **No counts in a preview.** «46 048 станций» is true today and stale the first
  time the catalogue moves, and Telegram and Google cache a preview for a long
  time — so it becomes a number we cannot correct. The test fails on a
  three-digit run.
- **`og:image` must be a committed file, not a route.** A crawler must not depend
  on the API being up, and a preview pointing at a 404 renders an empty grey box
  instead of falling back to text. Redraw it with
  `node scripts/buildOgCover.mjs`, which uses the same satori + resvg pair and
  Noto fonts as the story cards.

## index.html is also the template for 5 000 station pages

`scripts/buildStationPages.mts` runs after `vite build` and produces one
indexable page per station at `dist/station/<uuid>.html` by substituting into the
BUILT shell: the `<title>`, the canonical link, six meta tags, and the contents of
`#root`. Caddy serves them with no new route, because it already runs
`try_files {path} /index.html` over `dist`.

**Flat `.html`, not `<uuid>/index.html`, and that is measured.** `try_files
{path}` on this host matches files but falls through on DIRECTORIES: probed
against production 2026-08-26, `/fonts/` returns the 5152-byte SPA shell,
byte-identical to `/`. The directory form would have failed silently in the worst
way — the SPA reads the path either way, so a human lands correctly and only the
crawler gets nothing. If you ever want the extensionless URL, it needs
`try_files {path} {path}/index.html /index.html` in the Caddyfile, and Caddy on
that box is also the edge for other people's services.

That makes several shapes in `index.html` load bearing, and the failure is the
nastiest kind — **the build still succeeds and every page silently inherits the
home page's title and description**, which is duplicate content across thousands
of URLs and ranks worse than having no pages at all. `src/prerenderAnchors.test.ts`
is the guard. Keep `<div id="root"></div>` empty, keep the canonical link on one
line, and keep a `content=""` on every rewritten meta tag.

Two content rules the generator obeys and any change to it must keep:

- **No popularity numbers on a page.** `votes`/`clickcount` decide WHICH stations
  get a page and are never printed on one. They are deliberately not projected
  onto the wire by `toStationLite` so popularity is never dressed up as a
  listener count, and a page sitting in Google's cache is the worst place to
  start doing it.
- **No raw tags.** The catalogue's tag soup is not a genre. `stationGenreSlug`
  plus the locale's `genre` dictionary is the filter; a station whose tags map to
  nothing simply gets no genre line. Country names come from `Intl.DisplayNames`
  against `countrycode`, not from a hand-written translation table.

**The pages link to each other, and that was not free before.** Measured against
production 2026-08-30: the home page a crawler receives carried ZERO links to
any station page (the SPA shell is empty for a crawler), and a station page
carried exactly one `<a>` — back home. All 5 000 were orphans, discoverable
through sitemap.xml and nothing else. A crawler will fetch that; it has no
reason to rank it, and a person who lands there has no way onward except
installing the app.

Each page now carries up to six neighbours — same country and genre first, then
country, then genre — drawn ONLY from the chosen set, so a link can never point
at a page that was not generated. 4 966 of 5 000 get links; the rest have
neither a country code nor a mappable genre. Body text went from 195 to ~370
characters, all of it the stations' own names. `src/stationPageRelated.test.ts`
holds the picker (mutation-checked); the build prints the linked count, so a
picker that silently returns nothing is visible rather than green.

The station set is `resolvePromotable` from the API — the same set the app
promotes — so proven-dead streams get no page and one broadcaster gets one page
rather than the nine rows Radio Browser lists it under. Do not reimplement that
choice here; import it.

`getStartParam` reads `/station/<uuid>` from the path as its LAST source, so a
visitor arriving from a search result opens that station while no existing
Telegram deep link changes meaning.

## Analytics

`reportProductEvent` names are typed in `lib/productAnalytics.ts` and must also
be added to the API's allow-list, or the event is rejected with 400 and silently
lost. `play_attempt` counts every play the UI starts, including the ones the
Feed supersedes on the next swipe — the honest success rate is
`play_success / (play_attempt - play_superseded)`.

**The name must be a quoted literal sitting directly inside the report call.**
`apps/api/test/observability.clientEvents.test.ts` reads these sources with a
regex to check the allow-list against reality, and it matches only that shape. A
computed name — a ternary picking between two events, a variable — reads as "not
emitted by the web app" and fails the API suite. Write two call sites instead.
The same regex also reads COMMENTS, so a comment that spells the pattern out
registers whatever name it quotes as a real event and fails the other half of
the same test. Both mistakes were made adding `audio_background_survived`.

Read rates from `counterWindows.<window>.counters`, never from the top-level
counters: those are totals since the store file was created and span every change
in what was counted. Measured 2026-08-26, the same box gave 34% success from
totals and **84%** from the last-24h window (42 of 50 non-superseded attempts).
The window is the true one. Note also that a window is `{since, counters}`, not a
flat map — reading it as flat makes a busy day look like an idle one.

## Persistence

`usePersistentState` deliberately does not write on mount. Storage writes are
dirty-only, and there is a test asserting that mounting the app rewrites
nothing. Do not "fix" that by writing eagerly.

## Running it locally: the API base is not obvious

On `http://localhost` the app uses `/api`, which the Vite dev server proxies —
and both halves of that had to be fixed before `npm run dev:webapp` +
`npm run dev:api` worked at all. The failure mode is silent and total: requests
land on the SPA fallback, every catalogue call returns `index.html` with a 200,
and the app renders an empty globe with nothing in the console. If you see no
stations anywhere, check `content-type` on `/api/catalog/points` before anything
else.

The proxy target reads `VITE_API_PROXY_PORT`, never `PORT` — in the dev server's
own process `PORT` is ITS port — and points at `127.0.0.1`, because the API
binds IPv4 only and Windows resolves `localhost` to `::1` first.

## The globe places a dot, so the dot must be in the right country

Only ~12k of 59k stations ship coordinates; the rest are synthesized by
`lib/geoResolver.ts`. A synthesized position is one WE chose, so it is verified
against the country polygon before it is returned — a fixed jitter used to push
583 of them across a border. If you touch that path, `npm run geo:check` is the
gate: it runs the real resolver over the whole catalogue and fails on a dot
drawn in the wrong country.

Sample points are created per slot on demand and cached, so a country costs what
its stations use, and a multi-part country is sampled one polygon at a time
weighted by that polygon's area. Both are load-bearing: a fixed 2048 points per
country was 6.3 of the 6.4 seconds the Globe spent on its first mount, and
sampling France's whole bounding box (Guiana included, 3% land) was half of what
remained. If you change the weighting, keep it proportional to area — anything
else moves dots off the islands.

## Glass: `-webkit-backdrop-filter` comes FIRST

The bundler keeps the last of the pair, and Chrome does not parse the `-webkit-`
spelling, so writing the standard property first deletes it from the production
bundle and the surface ships with no blur. No test can see it — Playwright runs
the unminified dev server — which is how the whole Лира chat shipped flat for
months. `npm --workspace apps/webapp run test:unit` runs the guard;
`scripts/assertBackdropFilterOrder.mjs` is the guard itself.

## Glass costs per INSTANCE, and the tiers are load bearing

`backdrop-filter` is the most expensive thing this UI does on a phone, and the
cost is not what anyone guesses. Measured on a Galaxy S20 FE against production
2026-08-29, browser trace, interleaved repeats agreeing within 1%: turning every
blur off took the GPU compositor thread from 9619ms to 3504ms (**-64%**) over a
fixed scroll, the six busy threads from 30.4s to 21.4s, and scroll input p99
from **311ms to 102ms**. Raster was 0.19s of a 23s scroll and the renderer main
thread was ~12% busy — so it is neither painting nor script.

**Per instance, not per pixel.** The whole page blurs 0.7 of a screen, but every
backdrop-filter is its own render pass and a tile-based mobile GPU flushes tile
memory on each one. Killing only the ~100 small repeated controls recovered the
entire win; the big signature surfaces — nav, dock, hero, sheets — cost
essentially nothing. Do not "optimise" those. Do think before adding a blur to
anything that repeats per station.

Three tiers, stamped once on `<html data-glass>` by `main.tsx`:

- `full` — the design as drawn.
- `lite` — low-power devices (`getDeviceProfile()`; `hardwareConcurrency <= 4`
  or `deviceMemory <= 4`, which is most mid-range Androids AND a GitHub Linux
  runner). Flattens the small repeated controls and hands them a substitute
  fill. `lite` is not "the blur removed": removing it outright was measured to
  break the play control, because the frost is what flattens artwork behind a
  44px disc. `lib/scenePlate.ts` samples the piece of scene under the control
  and writes `--station-plate` on the tile — a blur is a local average, so the
  average is the faithful replacement, and the scenes are same-origin so the
  canvas is not tainted.
- `off` — a DIAGNOSTIC, not a look. `?glass=off` turns every blur off so the
  same page can be measured twice.

**`lite` is not "less glass" — it is glass computed once.** `lib/scenePlate.ts`
takes the piece of scene under a tile's play control, blurs it in a canvas when
the bitmap decodes, and hands it over as a background image. That is what iOS
does: `UIVisualEffectView` blurs a SNAPSHOT and reuses it, while CSS
`backdrop-filter` re-blurs from nothing, in its own render pass, per element,
per frame. Our backdrop there is a static picture, so the blur is free to be
cached. Measured on the shipped build, 143 live blurs vs 9:

| | backdrop-filter | frosted snapshot |
| --- | --- | --- |
| GPU CompositorGpuThread | 10780ms | 3028ms (**-72%**) |
| all six busy threads | 31717ms | 21825ms (-31%) |
| scroll input p99 | 204ms | **89ms** |
| compositor gaps over 25ms | 7-10% | **0.5-0.7%** |

⚠ Read the gap distribution, not the "fps" you can compute from presentation
events — that comes out at 114-200, above the panel's 59.2Hz, because the event
counts surface submissions rather than frames. The p99 gap of 17.4ms (one vsync)
is the number that says frames are landing.

⚠ And do NOT raise `FROST_FILTER` to close the saturation gap against the real
blur. That was tried and shipped for one deploy: `saturate(420%)` moved measured
saturation from 0.41 toward 0.59 and turned an evening sky GREEN, because
averaging leaves tiny channel differences and multiplying them invents hues. The
metric improved while the colour became a lie.

**The two guards exist because this went wrong once, silently.** `?glass=off`
was written as `:root[data-glass='off'] *`, which weighs (0,2,0) — the same as
`.screen-home-next .home-action-btn`, which is `!important` in the lazily-loaded
Home chunk and therefore wins the tie. Half the blurs stayed on, the measurement
taken through the switch said blur was innocent, and that wrong answer was acted
on. Nothing errored. So: `scripts/assertGlassOverrideWins.mjs` (run from
`src/glassOverrideWins.test.ts`) recomputes the specificity of every override
against every blur declaration and fails if an override cannot win, and
`tests/glass-tier.spec.ts` asserts in a real browser that `?glass=off` leaves
EXACTLY zero. Both are mutation-verified against the historical selector.

The repeated attribute selectors in the override blocks are not a typo — they
are the weight. Do not "tidy" them; the script recomputes the arithmetic, so
let it tell you the count rather than guessing one.

`visual.spec.ts` pins the tier with `?glass=` rather than letting
`getDeviceProfile()` pick it, because the tier is derived from the HARDWARE the
test happens to run on — so the same spec can render two different apps on two
machines, and a screenshot suite whose subject depends on a core count is not
measuring what it claims to.

⚠ That is insurance, not a repair, and the difference is worth stating because
the first draft of this note asserted the repair. Regenerating the Linux
baselines after pinning changed **0 of 23**, so that runner was already
resolving to `full`; there was no live divergence to fix. Nothing here has ever
been observed rendering `lite` in CI.

## Changing how the chrome looks: ask the browser who wins

The nav, the player bar and the topbar are the most over-declared surfaces in
this codebase. The mobile nav's base fill alone is declared in THREE stylesheets
— `styles.css`, `screens/homeReference.css` and `boot.css` — and the player
bar's paint is claimed by nine rules across two files. A change made in the
obvious place is silently undone, produces no error, and looks in the diff
exactly like a change that worked.

That is not a hypothetical: the first attempt at the glass pass edited the
shared chrome block and moved NOTHING. A later single-class rule 100 lines down
restored the same alpha, and on Home a `[data-active-section='home']` rule in a
lazily-loaded chunk beats both. The nav still measured `rgba(13, 26, 43, 0.72)`
afterwards.

**Do not reason about it. Ask.** `CSS.getMatchedStylesForNode` over a CDP
session lists every matching rule in cascade order with its file and line:

```ts
const client = await page.context().newCDPSession(page);
await client.send('DOM.enable'); await client.send('CSS.enable');
// DOM.getDocument → DOM.querySelector → CSS.getMatchedStylesForNode
```

Ten seconds, and it answers what an hour of reading cannot. Then verify the
edit the same way — the winner should be your rule.

Three specific traps, all paid for:

- **`!important` is not beaten by weight.** Two rules keyed on
  `[data-low-power='true']` hit the chrome: one strips `backdrop-filter`, the
  other flattens `box-shadow` with `!important`. The second one is (0,3,0) —
  the same weight as the Home nav rule that loads after it — so raising
  specificity or moving the rule later does nothing.
- **`lowPower` catches ordinary phones.** It is true when `deviceMemory <= 4`,
  and Chrome rounds that down to a power of two and caps it at 8, so a 6 GB
  phone reports 4. The owner's 8-core Galaxy S20 FE trips it, and both rules
  above then stripped the glass from the nav and the dock — the two surfaces
  where it reads — while 144 blurs elsewhere on the page, over flat dark
  ground where a blur cannot show, kept running.
- **The chrome's `::before` / `::after` gloss layers do not render.** Nothing in
  the app gives `.app-navigation-mobile::before`, `.player-dock-bar::before` or
  `.app-topbar-v2::before` a `content`, so every gradient and border declared on
  them is dead CSS. Confirmed twice: `getComputedStyle(el, '::before').content`
  returns `none`, and a full sweep of all ten `content: ''` declarations finds
  no chrome selector. Adding a rule there paints nothing — and worse, a `mask`
  added by such a rule WOULD survive into the later gloss block and clip it if
  `content` ever appeared.

## Glass is legibility before it is looks

The chrome was made nearly opaque once, deliberately, because at a 0.32 fill the
nav's labels mixed into whatever scrolled underneath. Any change that makes it
glass again re-opens that, so the floor is measured:
`tests/glass-legibility.spec.ts` pins a deliberately bright band behind the bar,
screenshots the strip, hands the PNG back to the page, draws it on a canvas and
reads the contrast off the PIXELS. The DOM cannot answer this — it reports the
colour a rule declared and knows nothing about what a blur put behind the text.

Measured alpha against that gate (WCAG AA floor 4.5):

| fill | nav labels | | fill | dock title |
| --- | --- | --- | --- | --- |
| 0.72 | 7.81 | | 0.86 | 7.88 |
| 0.62 | 6.68 | | 0.78 | 6.45 |
| **0.52** | **5.49** | | **0.72** | **5.52** |
| 0.44 | 4.58 — the edge | | 0.62 | 4.23 — fails |
| 0.36 | 3.70 — fails | | 0.52 | 3.38 — fails |

⚠ Two estimators were tried first and both were useless. The median with nothing
behind the bar does not bite at all — dropping the fill to 0.04 changed nothing
over a dark page. The 90th percentile reads the ICONS as bright background and
reported 3.13:1 for chrome that was nearly opaque. The metric that works is the
median WITH a bright worst case behind it, which is the defect stated as a
number.

## The player bar is opaque for a picture that is usually not there

`MiniPlayerDock.css` turns the dock's `backdrop-filter` off, and it is right
about the case it describes: with a Theme Studio print active,
`--theme-bg-image` is an opaque photo covering the bar, nothing behind it can
show, and the blur is a filter pass with no output. `tests/mobile.spec.ts` pins
that — with a print applied the bar's computed `backgroundImage` must contain
`blob:`.

But every bundled theme and the default resolve that variable to a GRADIENT, so
the bar was opaque for a photograph that was not there. `ThemeContext` now
writes `data-theme-backdrop='image' | 'flat'`, and the flat case gets glass.
Keep the two cases apart; do not "simplify" them back together.

## The dock is the bar for the station you asked for, not only the one on air

`player.current` means ON AIR: `play()` clears it and only `handlePlaying` sets
it, so nothing can claim a station is playing before it is. Keep that.

What must NOT be gated on it is the dock. It was, and every station change
unmounted the player bar for as long as the stream took to connect — seconds on
a phone, longer when the candidate list gets walked. Reported as «нажимаю
следующую станцию и плеер пропадает, пока станция не заиграет», and it read as a
bug because it was one.

`player.pending` is the station that has been requested and has not produced
audio yet; the dock renders on `current ?? pending`. That also un-hid a state
the dock already had: its «Буферизация» pill reads `current && status ===
'buffering'`, which during buffering was unreachable code.

⚠ `tests/dock-while-connecting.spec.ts` installs its OWN slower `play()`,
because the shared media mock fires `playing` synchronously — the connecting
window is zero in the standard fixture, so a test written against it passes
whether or not the bug exists. Any future test about connecting behaviour needs
the same treatment.

## Stations before words on Home

Measured on production at 390x844, first run: hero 0-304, live-air strip to 364,
the explanatory card to 570, quick chips to 688, and the single shelf beginning
at 710 — with the floating nav at 772 and the first tile at 764. Eight pixels of
station before the nav covered it: a listener who had never heard this app saw
NO station without scrolling, having first been told in prose that it is live
radio.

The shelf now sits above the card and the chips: first tile at 440, six fully
visible. Nothing was removed and the shelf COUNT is untouched — the card and the
chips simply follow the thing they describe. If that order is ever revisited,
measure the first tile's top against the nav's, not the page's total height.

## Bottom chrome: reserve space for what is on screen, not for what could be

`--screen-bottom-safe-v2` is every screen's bottom scroll padding, and it used
to budget the mini player's height unconditionally. The dock renders NOTHING
while nothing is playing — `MiniPlayerDock` returns null on `!player.current`,
deliberately, so a dormant dock does not eat 66px and cover the rails — so that
budget was reserving ~96px (132px at ≤430px) for a control that was not there.

Invisible under ten shelves; not invisible on a first run. Measured against
production at 390×844: Home was **894px of content in an 844px viewport and the
document ran to 1228px** — a third of the page empty, under a screen that has
one shelf on it by design. That is what "пролистал ниже — там ничего нет" was,
and the padding manufactured it, not the shelf count.

The shell now carries `data-dock="bar" | "none"` (App.tsx, same `!player.current`
test as the dock's own), and `.app-shell-v2[data-dock='none']` drops the dock's
share. `--dock-offset-v2` stays in both states: that term is the clearance the
floating NAV needs, and the nav is always there.

⚠ It has to be the DERIVED properties that get re-declared on the shell, not a
term inside them. A custom property's `var()`s resolve against the element that
DECLARES the property, so `--fixed-bottom-stack-v2` declared on `:root` will
keep using `:root`'s terms no matter what the shell overrides. The same trap is
already documented at the `@media (max-width: 430px)` block for the nav height.

`tests/dock-reserve.spec.ts` holds both halves against each other — the reserve
is gone when idle AND the last tile still clears the nav when scrolled to the
bottom — because trimming the padding is the obvious way to break the thing the
padding exists for. Mutation-checked: pinning `data-dock` to `bar` puts the tail
back to 334px, the exact figure measured on production.

## Layout rules that are contracts, not preferences

Touch targets ≥ 44px, no document horizontal overflow at 360/390/412, and the
navigation/dock sizes in `PLAN.md`'s UI sections. If an assertion about one of
these fails intermittently, the measurement is racing an animation — see
`.claude/rules/e2e-tests.md`. Never relax the number.

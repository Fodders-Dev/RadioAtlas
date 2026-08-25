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

`src/criticalPathNoCdn.test.ts` is the guard. The only external script allowed is
the Telegram SDK. Do not add a font, stylesheet or icon from another origin —
and if a display face is ever added for a theme, it self-hosts too.

## Playback is the product

- **The station never switches by itself.** Camera motion on the Globe, opening
  the Feed, a chip tap, a stream error — none of them may change what is
  playing. Only a direct user action does. This is the repo's oldest hard rule.
- Recovery paths (reconnect, candidate failover, silent-stall watchdog) run
  inside `useAudioPlayer`. When touching them, remember the listener's phone is
  usually in a pocket: a backgrounded tab throttles timers and withholds
  `timeupdate` while audio keeps playing, so anything judged from wall-clock
  time will misfire. Judge from `audio.currentTime` movement instead.
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
indexable page per station at `dist/station/<uuid>/index.html` by substituting
into the BUILT shell: the `<title>`, the canonical link, six meta tags, and the
contents of `#root`. Caddy serves them with no new route, because it already runs
`try_files {path} /index.html` over `dist`.

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

## Layout rules that are contracts, not preferences

Touch targets ≥ 44px, no document horizontal overflow at 360/390/412, and the
navigation/dock sizes in `PLAN.md`'s UI sections. If an assertion about one of
these fails intermittently, the measurement is racing an animation — see
`.claude/rules/e2e-tests.md`. Never relax the number.

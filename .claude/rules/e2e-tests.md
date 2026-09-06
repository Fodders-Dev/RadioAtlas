---
paths:
  - "apps/webapp/tests/**"
  - "apps/webapp/playwright.config.ts"
---

# Working on the Playwright suite

240 specs, ~3 minutes in parallel. CI runs a **non-gating** job — a red run
never blocks a merge — because flakes in a blocking gate get the gate switched
off. That makes it your job to run it locally for UI work, to read the CI job
rather than the green tick, and to keep both trustworthy.

CI runs `npm --workspace apps/webapp run test:e2e:ci` — the whole suite at
`--workers=1`. Serial is the direct treatment for the documented flake cause
(the same specs failed twice in one parallel run here and were 225/225 on two
serial ones) and it is also what lets the screenshots capture: at the default
worker count a 1440×1688 clip failed on a runner with
`Protocol error (Page.captureScreenshot)`.

**Baselines are per platform.** Playwright appends `process.platform`, so every
screenshot has a `-win32.png` and a `-linux.png` and they are NOT
interchangeable — font rasterisation differs. Regenerate the one for the machine
you are on (`--update-snapshots` locally, the manual `visual-baselines.yml`
workflow for Linux) and never hand-copy one platform's file to the other. A
baseline with no spec referencing it is dead weight: two lived here for months
after their spec was deleted.

The job becomes a gate on evidence, not on optimism: twenty consecutive green
runs on CI hardware with no spec failing twice on the same line. The criterion
is written into `.github/workflows/ci.yml` next to the `continue-on-error` it
would delete.

## Measuring geometry

`boundingBox()` returns the **transformed** box. Anything measured while a mount
animation is in flight measures the animation. The Feed is the sharp case:
`.station-feed-overlay` animates from `scale(0.965)` over 240ms, so a 44px
control reads 42.46px and misses a 43.5px floor — intermittently, because
parallel load decides whether the round-trip lands inside the window.

```ts
await waitForAnimationsToSettle(page, '.station-feed-overlay');
```

The helper waits only for **finite** animations; the Feed's live dot pulses
forever and waiting on it hangs the test instead of fixing it.

`toBeVisible()` is not a settle gate: Playwright counts an `opacity: 0` element
as visible, so waiting for a fading-in element resolves at t=0 of its animation.

**Wait for the thing you are about to assert, not for a neighbour of it.** The
first CI run of the browser job failed on `visual.spec.ts` reading
`data-home-hero-mode` as `recommendation` after a play — it had waited for the
resume chip, which is a different render, and on a slower machine the chip wins.
The same spec passed six times in a row locally. Waiting on the attribute under
assertion costs nothing in strictness: if it never arrives, the wait times out
and the test still fails.

Read several elements' geometry in ONE `page.evaluate` — two `boundingBox()`
calls are two round-trips at different moments, and the test then measures the
difference between its own reads.

## Four things not to do when the suite is red

1. **Do not disable motion** (`emulateMedia({ reducedMotion })`,
   `animations: 'disabled'`) to settle geometry. It quietly changes the subject
   from what a default-settings user gets to what a reduced-motion user gets.
2. **Do not raise a tolerance.** 43.5px, `maxDiffPixelRatio: 0.04`, the overflow
   zero — all product contracts.
3. **Do not add `retries`.** It erases the only signal that separates a defect
   from noise.
4. **Do not conclude from one run.** A control run that passes proves nothing:
   a second control run on the same code failed on the same spec. If a spec
   fails twice on the same line, it is a defect; otherwise reproduce it first
   with `--repeat-each=12 --workers=6`.

## What this harness structurally cannot test

The dev server serves `http://localhost`, and `isSecureProxyContext()` in
`playbackTransport.ts` is strictly `location.protocol === 'https:'`. That is not
a detail — it decides which playback candidates exist at all:

- an **https** stream needs `apiAvailable`, which needs `needsApiAssist`, which
  for a plain `.mp3`/`.aac` needs a secure page. On http there is no proxy
  candidate, so there is exactly ONE candidate and nothing to fail over to;
- an **http** stream does get a proxy candidate, but `shouldForceProxyForHttp`
  then puts the proxy FIRST, so the direct route is never tried.

So the production ordering — direct first, same-origin proxy as fallback — has
no combination that reproduces here. Any spec written against "a stalled direct
candidate hands over to the proxy" fails for a reason that has nothing to do
with the code under test.

⚠ Before writing a playback-transport spec, check what `buildCandidates` would
return for your URL on an http page. It is cheaper than reading a failure that
looks like a product bug.

## Measuring playback against production, and the three ways it lies to you

The path above only exists on https, so it has to be measured against
radioatlas.ru with Playwright pointed at it. Doing that on 2026-09-01 produced
three consecutive numbers that were all meaningless, each for a different
reason, and each looked like a result:

1. **Hanging one station's URL and clicking "the first play control"** plays a
   DIFFERENT station. Hang every non-same-origin request instead, or pin the
   station and assert the element's `currentSrc` is the one you hung.
2. **A fresh context gets the FIRST-RUN Home**, which has no station tiles at
   all — the click found nothing and the run reported a timing anyway. Reach a
   station through Search, the way a listener does.
3. **Letting the run pick "a station with an audio extension"** keeps landing on
   `http://` ones, which are proxy-first by design. Ask the catalogue by name
   (`/api/catalog/search?q=…`) and take an `https://` row.

The spec should refuse to report a number when the first source was already the
proxy. A run that did not take the direct-first path is not a slow result, it is
no result.

## The acceptance run is a different animal from the suite

`playwright.acceptance.config.ts` (`apps/webapp/acceptance/`, `npm --workspace
apps/webapp run test:acceptance`) exists to demonstrate a user scenario to a
person: real `<audio>`, real decoding, real sockets, real backgrounding, video
on, minutes of real waiting. It is deliberately NOT in the gating suite —
`testDir` is `./acceptance`, which the gating config's `./tests` never reaches.

Writing one found four ways to produce convincing evidence of nothing. All four
were caught by an assertion, not by reading, and all four are cheap to repeat.

- **`mockStations` serves the audio.** It fulfills both
  `https://stream.example.com/**` and the API's `**/stream?url=**` with a 30 s
  silent WAV. The first run reported «currentTime advanced to 0.39s» — over
  **zero** connections to the stream server. A fully buffered file cannot stall,
  cannot die and cannot be starved, so every scenario about a dead stream would
  have passed for free. `page.unroute` both, and then **assert a non-zero count
  on the server** before anything else: that one line is what makes the rest of
  the run mean something.
- **Headless Chromium never backgrounds a page.** `page.bringToFront()` on a
  second tab left the first at `visibilityState === 'visible'`, so
  `visibilitychange` never fired. Anything about returning to the app must run
  `headless: false` and must ASSERT the flip — otherwise the run measures a page
  that never left.
- **Artifacts inside the Vite root reload the page.** Traces and screenshots
  written under `apps/webapp` are file changes the dev server watches, and it
  answers with an HMR `page reload` — mid-measurement, restarting the player,
  emptying the dock. Same trap as editing `src/` during a run, minus the human.
  Point `outputDir` and every screenshot outside `apps/webapp`.
- **The wrapper's exit code is not the suite's.** `npm run x > log 2>&1; echo
  $?` inside a backgrounded shell reported success while the log said
  `1 failed`. Put the real code IN the log (`(npm run x; echo "REAL_EXIT=$?")
  > log`) and grep for it.

Two more that are the ordinary rules biting in a new place: a loose
`getByRole('button', {name: /Слушать/})` picks up Home tiles as well as the dock
and starts a DIFFERENT station (scope it to `.player-dock-bar .dock-play-btn`),
and a station is not guaranteed to be on Home — reach it with `playHomeStation`,
which falls through to Search the way a listener does.

⚠ The API's SSRF guard refuses a loopback upstream, so the `/api/stream` proxy
candidate cannot serve a local fixture stream. That is correct and must be left
alone: the candidate walk falls through to the direct URL, which is the socket
worth measuring anyway.

## Testing what survives a restart

`page.reload()` is the closest thing this harness has to the OS killing the app:
it tears down every ref, timer and the audio element, then rebuilds from
storage. Two things make a restart test lie, and both were hit writing the first
one.

- ⚠⚠ **`addInitScript` re-runs on the reload.** `seedRadioState` writes
  `radio:player:v2` unconditionally, so the reload standing in for the OS kill
  ALSO wiped the queue the app had just persisted. The app restored nothing
  because there was nothing left, and it looked exactly like a broken feature.
  A real restart does not reset storage: seed **idempotently** (`if
  (!localStorage.getItem(k)) …`), and let the app write the state under test
  itself — otherwise the run is checking its own fixture.
- **Let the deferred write land.** Storage writes are debounced (~1.2s). Reload
  before that and you measure a queue that was never saved. Wait, then assert
  the key actually contains what you expect BEFORE reloading — that one line
  separates "the restore is broken" from "there was nothing to restore".

And the filter trap again, in a new costume: matching the fixture's PORT number
catches `/api/metadata?url=<encoded upstream>` as well as `/api/stream?url=`,
because the port is inside the encoded upstream. A metadata probe for the
station on screen is not playback. Match the audio path exactly and report the
rest separately.

## Checking playback against production after a deploy

`apps/webapp/acceptance/prodPlayback.mts` (`npx tsx acceptance/prodPlayback.mts`
from `apps/webapp`) is the post-deploy check: reach a station through Search at
390x844, prove `currentTime` moves, prove the player shows the station that was
pressed, then Pause and prove nothing restarts.

It lied three times before it told the truth, and every one was the
measurement:

- **`hasText` is a substring match.** Pinning «Radio Paradise Rock Mix FLAC»
  clicked «Radio Paradise Rock Mix FLAC+meta» — a different station, reported as
  a healthy recovery. This is trap #1 below, and it has now happened three times
  in one session. Match exactly, or match by index after enumerating.
- **A metadata probe is not playback.** Counting every request to the station's
  own origin reported «2 new stream requests after Pause» for a player that
  produced 0.02 s of audio in twenty seconds. Count the AUDIO path only, and
  report the rest separately rather than folding it in.
- ⚠⚠ **The catalogue API and the Search screen return different sets.** The
  showcase is deduplicated, so a row the API happily returns may not exist on
  screen at all. Pinning a station from the API and then hunting for it in the
  DOM is a race between two different answers. **Take the station from the
  screen** — the play button's `aria-label` carries the exact name — so the row
  that is clicked and the name that is asserted come from the same place.

⚠ And the release stamp: a string added to the player will NOT appear in
`index-*.js`, because the playback runtime is lazily loaded. Grep every chunk
(`grep -rl "<new string>" dist/assets`) or you will conclude a good deploy
never landed.

## Isolation

A spawned API must get its own `ACCOUNT_STORE_PATH`, `CATALOG_DATA_DIR` and
`OBSERVABILITY_STORE_PATH` in a temp directory. Without them a test wrote its
two fixture stations over the developer's real 70MB catalogue snapshot on every
`npm test`.

The suite starts the API through `apps/api`'s `serve:e2e`, never `dev` —
`dev` is `tsx watch`, and editing an API source mid-run restarts the shared
server and fails whichever specs are mid-request.

**The webapp side has the same trap and no such escape**: Vite runs in dev mode
with HMR on, so editing anything under `apps/webapp/src` mid-run pushes an
update into the browser. It reaches every module that imports the edited one, so
a one-line comment in `lib/geoResolver.ts` reloaded three screens and cost a
239/240 run whose single failure was `[data-home-feed-entry]` missing at page
load. Start the suite, then keep your hands off `src/` until it finishes; a
failure that only appears in a run you edited during is not a finding.

## `?glass=` is not the only switch the hardware flips

Pinning the glass tier does NOT pin `data-low-power`. `main.tsx` derives that
separately from `getDeviceProfile()`, and two rules keyed on it strip the
chrome's `backdrop-filter` with `!important`. It is true for
`prefers-reduced-motion`, a constrained network, `hardwareConcurrency <= 4` or
`deviceMemory <= 4` — so a 4-vCPU GitHub runner renders the low-power app while
a 12-core desktop renders the full-glass one, from the same URL.

That cost five days of a red CI job read as "an environment difference":
`glass-legibility` measured 5.49:1 locally and 3.10:1 on the runner, and the
runner was right — the nav genuinely failed WCAG AA wherever the blur is
stripped, which includes the owner's own phone.

Any spec whose subject is the chrome's appearance must pin BOTH switches and say
which one it is testing. `page.emulateMedia({ reducedMotion: 'reduce' })` is the
deterministic way into the low-power state, and it is also a real listener.
Assert the state you asked for actually rendered — otherwise a silently-normal
"low power" run reports a healthy number for a case nobody measured.

⚠ **Killing a run does not free its ports.** Playwright's two `webServer`
processes outlive the runner, so the next `playwright test` dies on
`http://127.0.0.1:4311/health is already used`. That failure exits the RUNNER,
not the suite — a `; echo exit=$?` after a pipe reports the pipe's status, so it
can read as a clean pass with zero tests. Check a real count, and clear the
ports first:

```powershell
foreach ($p in 4311, 5174) { Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force } }
```

Ports: each spawning suite owns a range, and an overlap takes down a
neighbouring suite rather than yours — which is why two of them overlapped for
months without anyone noticing. Taken as of 2026-08-17:

| Range | Suite |
| --- | --- |
| 34100–34599 | `api.contract` |
| 34600–34999 | `api.degradation` |
| 35100–35599 | `billing.webhook` |
| 35600–35999 | `billing.reconcile` |
| 36000–36099 | `session.lifecycle` |
| 36100–36499 | `cors` |
| 36600–36999 | `auth.providerLink` |
| 37100–37499 | `catalog.deleted` |
| 37500–38099 | `fixtures.production-guard` (three blocks) |
| 38200–38399 | `catalog.mirrorRace` |
| 38500–38699 | `auth.telegramCallback` |
| 4311 / 5174 | the Playwright suite's own API and Vite |

Suites that ask the OS for an ephemeral port (`media.ssrf`, `sceneArtwork`,
`shareRoutes`) need no range and are the better pattern for anything new.

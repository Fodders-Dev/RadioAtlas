import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';

import { mockStations, playHomeStation, seedRadioState, stations } from '../tests/helpers';
import { startLiveStream, type LiveStream } from './liveStreamServer';

/**
 * 0.1b.1 user acceptance — the four scenarios, through the real interface.
 *
 * ⚠ What makes this an ACCEPTANCE run rather than another unit test: nothing
 * about the player is mocked. Real `<audio>`, real decoding, real sockets, a
 * real `visibilitychange` produced by actually backgrounding the tab, and every
 * action taken by clicking the control a listener would click at 390x844.
 *
 * `installMediaMocks` is deliberately NOT used. It replaces `play()` and fires
 * `playing` synchronously, so the whole question — does the element produce
 * audio, or only claim to — cannot be asked through it.
 *
 * ⚠ ONE THING HERE IS DRIVEN RATHER THAN REAL, and it is named so nobody
 * reads more into this run than it earns: the hidden/visible transition.
 * Chromium under CDP automation reports `visible` no matter what — measured
 * three ways in `probeVisibility.mts` (a second page taking the front, a tab
 * opened in the same window, and minimising the window via
 * `Browser.setWindowBounds`), and still `visible` after dropping Playwright's
 * `--disable-renderer-backgrounding` family. So the transition is produced the
 * way the browser produces it — `document.visibilityState` plus a real
 * `visibilitychange` — and the run ASSERTS the page actually saw it.
 *
 * What that leaves unproven is the OS half: a phone may suspend or evict the
 * WebView entirely. That is exactly why the manual Telegram check in
 * `TEST_PLAN.md` stays mandatory and is not replaceable by this file.
 *
 * The stream death, by contrast, is completely real — a socket that stops
 * delivering samples.
 *
 * Three things are ground truth here, and none of them is the test's own
 * bookkeeping:
 *
 *   audio.currentTime   the only proof of sound this project accepts
 *   live.connections()  counted by the stream server, so «the app started
 *                       something by itself» is observed at the socket
 *   the DOM             what the listener can actually see and press
 */

/**
 * ⚠ Outside the Vite root. A screenshot written under `apps/webapp` is a file
 * change the dev server watches, and it answers with an HMR page reload that
 * restarts the player mid-measurement. See the config for the full note.
 */
const ART = process.env.ACCEPTANCE_ARTIFACTS || join(process.cwd(), '..', '..', 'acceptance-artifacts');
const shot = (name: string) => join(ART, name);

const STREAM_PORT = 39177;
const STATION = 'Tokyo FM';

/**
 * ⚠ The one fixture liberty taken, and why it is not a mock of the subject.
 *
 * The catalogue fixture points at `https://stream.example.com/...`, which
 * nothing serves. Repointing it at the local live stream changes WHERE the
 * audio comes from, not how the player behaves — every candidate build,
 * transport choice, event and recovery path is the shipped one.
 */
const usingLiveStream = (live: LiveStream) => {
  for (const station of stations) {
    station.url = live.url;
    station.url_resolved = live.url;
  }
};

type AudioSnapshot = {
  present: boolean;
  currentTime: number;
  paused: boolean;
  src: string;
  state: string | null;
};

const readAudio = (page: Page): Promise<AudioSnapshot> =>
  page.evaluate(() => {
    const el = document.querySelector('audio');
    return {
      present: Boolean(el),
      currentTime: el?.currentTime ?? -1,
      paused: el?.paused ?? true,
      src: el?.currentSrc || el?.getAttribute('src') || '',
      state: el?.getAttribute('data-ra-state') ?? null
    };
  });

/** Watch `currentTime` for real movement. Returns the samples it saw. */
const sampleProgress = async (page: Page, ms: number, step = 500) => {
  const samples: number[] = [];
  const rounds = Math.max(1, Math.round(ms / step));
  for (let i = 0; i < rounds; i += 1) {
    samples.push((await readAudio(page)).currentTime);
    await page.waitForTimeout(step);
  }
  samples.push((await readAudio(page)).currentTime);
  return samples;
};

/**
 * Put the page in the background and bring it back, asserting the app SAW it.
 *
 * ⚠ The assertion is the point. An earlier version used `bringToFront()` on a
 * second page and checked nothing; Chromium kept the page `visible`, so
 * `visibilitychange` never fired and the run would have "passed" scenario 1
 * having never backgrounded anything.
 */
const backgroundFor = async (page: Page, ms: number) => {
  const setVisibility = (value: 'hidden' | 'visible') =>
    page.evaluate((v) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
      document.dispatchEvent(new Event('visibilitychange'));
    }, value);

  await page.evaluate(() => {
    (window as unknown as { raSeen?: string[] }).raSeen = [];
    document.addEventListener('visibilitychange', () => {
      (window as unknown as { raSeen: string[] }).raSeen.push(document.visibilityState);
    });
  });

  const positionAtHide = (await readAudio(page)).currentTime;
  await setVisibility('hidden');
  expect(await page.evaluate(() => document.visibilityState), 'the page must be hidden').toBe(
    'hidden'
  );
  await page.waitForTimeout(ms);
  await setVisibility('visible');
  const seen = await page.evaluate(() => (window as unknown as { raSeen: string[] }).raSeen);
  expect(seen, 'the app must have observed both transitions').toEqual(['hidden', 'visible']);
  return { positionAtHide, hiddenMs: ms };
};

/**
 * The app's own rule, restated so a scenario can PROVE it reached the state it
 * claims: `advancedMs > hiddenMs * 0.5` is `survived`, anything less is `died`.
 */
const ALIVE_RATIO = 0.5;

/** Wait until the stream has genuinely been playing for a while, not one frame. */
const waitForSustainedAudio = async (page: Page, seconds: number, timeoutMs = 60_000) => {
  await page.waitForFunction(
    (target) => {
      const el = document.querySelector('audio') as HTMLAudioElement | null;
      return Boolean(el) && el!.currentTime >= target;
    },
    seconds,
    { timeout: timeoutMs }
  );
  return (await readAudio(page)).currentTime;
};

const waitForProgress = async (page: Page, timeoutMs = 25_000) => {
  const started = (await readAudio(page)).currentTime;
  await page.waitForFunction(
    (from) => {
      const el = document.querySelector('audio');
      return Boolean(el) && (el as HTMLAudioElement).currentTime > from + 0.35;
    },
    started,
    { timeout: timeoutMs }
  );
  return (await readAudio(page)).currentTime;
};

/**
 * The dock's own play/pause control — the only playback control a phone shows
 * once something is on air.
 *
 * ⚠ Scoped to `.dock-play-btn` and NOT to "a button labelled Слушать".
 * Home tiles carry that label too, so a loose selector clicks a TILE and starts
 * a different station — and the run then reports a healthy recovery for a
 * station nobody asked for. That mistake is already written down in
 * `.claude/rules/e2e-tests.md`, measured against production.
 *
 * It is also the control whose reachability scenario 3 is about: the dock
 * renders `player.current ?? player.pending` and the button is `disabled` on a
 * falsy `current`, so if a total failure ever dropped `pending` again, this
 * locator would find a disabled button rather than silently pass.
 */
const playPauseControl = (page: Page) => page.locator('.player-dock-bar .dock-play-btn');

test.describe.configure({ mode: 'serial' });

test('0.1b.1 acceptance: return, recover, fail, retry — at 390x844', async ({ page }) => {
  test.setTimeout(360_000);
  const live = await startLiveStream(STREAM_PORT);
  const evidence: string[] = [];
  const note = (line: string) => {
    evidence.push(line);
    // Surfaced in the run log so the record is readable without the video.
    console.log(`ACCEPT | ${line}`);
  };

  /**
   * What the BROWSER asked for, with timestamps.
   *
   * ⚠ Two independent observers, because the stream server alone cannot say WHO
   * connected. The API's proxy holds the upstream socket and could reconnect on
   * its own; attributing that to the web app would report a defect the product
   * does not have. A connection is charged to the app only when the browser
   * made a matching request.
   */
  const browserStreamRequests: { at: number; url: string }[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (/\/stream\?url=|39177/.test(url)) browserStreamRequests.push({ at: Date.now(), url });
  });

  try {
    usingLiveStream(live);
    await page.setViewportSize({ width: 390, height: 844 });
    await mockStations(page);
    // ⚠ Give the audio back to the real network.
    //
    // `mockStations` fulfills both the direct stream URL and the API's
    // `/stream?url=` proxy with a 30-second silent WAV. The first run of this
    // file went through that route and reported «currentTime advanced to
    // 0.39s» with ZERO connections on the stream server — a fully buffered file
    // playing happily, which can never stall, never die, and would have handed
    // scenario 1 a free pass. It was caught only because the counter lives on
    // the server rather than in the test.
    //
    // The API's own proxy candidate will be REFUSED for a loopback upstream by
    // the SSRF guard in `apps/api/src/media/shared.ts`, which is correct and is
    // deliberately left alone; the walk then reaches the direct candidate,
    // which is the socket this run measures.
    await page.unroute('https://stream.example.com/**');
    await page.unroute('**/stream?url=**');
    await seedRadioState(page, { activeSection: 'home' });
    await page.goto('/?api=/api&glass=full');

    // ---------------------------------------------------------------- play
    // ⚠ Through the helper, not through a hand-written Home selector: the
    // station is not guaranteed to be on the Home surface, and reaching it via
    // Search is what a listener does. The first draft assumed a tile and spent
    // six minutes timing out on a control that was never rendered.
    await playHomeStation(page, STATION);

    await expect(page.locator('.player-dock-bar')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.player-dock-title')).toContainText(STATION);
    const firstProgress = await waitForProgress(page);
    // ⚠ THE gate against the false pass above. If the audio did not come from
    // the stream server, nothing that follows means anything — a canned body
    // cannot be starved, dropped or refused.
    expect(
      live.connections(),
      'the audio must come from the real stream server, not from a canned body'
    ).toBeGreaterThan(0);
    // ⚠ Let it play properly before breaking it. The previous run starved the
    // stream 0.5 s after it started, so the "healthy stream that died while you
    // were away" was never healthy — it had produced half a second of audio.
    // Six seconds of real, decoded audio is also the first scenario's own
    // proof that the station works before anything goes wrong.
    const settled = await waitForSustainedAudio(page, 6);
    note(
      `on air: ${settled.toFixed(2)}s of real audio decoded over ${live.connections()} stream connection(s)`
    );
    await page.screenshot({ path: shot('01-on-air.png') });

    // ------------------------------------------- 1. return after a stream loss
    // The stream stops producing samples while we are away. The socket stays
    // open, so the element freezes with `paused === false` — the exact shape
    // production showed twice in one night. This half is entirely real.
    live.starve();
    // 20s away: past BACKGROUND_JUDGE_MIN_MS, so the verdict is `died`, not
    // `unknown`. `connectionsBeforeReturn` is sampled AFTER the away period on
    // purpose — anything the watchdog did while we were gone is legitimate
    // recovery and is not what scenario 1 forbids.
    // ⚠ 45 s, not 20 — and the length is arithmetic, not caution.
    //
    // At 20 s this scenario never reached the state in its own name. Chromium
    // plus the API proxy hold ~11 s of audio between them, so the stream kept
    // producing samples for 11 of the 20 hidden seconds: `advanced / hidden =
    // 0.55`, which is above `BACKGROUND_ALIVE_RATIO` and therefore `survived`.
    // No debt was owed, and the reconnect that followed was correct, designed
    // behaviour — the app was right and the test was wrong. The assertion below
    // is what stops that being mistaken for a defect a second time.
    const away = await backgroundFor(page, 45_000);
    const connectionsBeforeReturn = live.connections();
    const browserRequestsBeforeReturn = browserStreamRequests.length;
    const returnedAt = Date.now();
    const onReturn = await readAudio(page);
    const advancedWhileAway = onReturn.currentTime - away.positionAtHide;
    const aliveRatio = (advancedWhileAway * 1000) / away.hiddenMs;
    // ⚠ PROVE the precondition. Without this the run can assert «nothing
    // started by itself» about a stream the app correctly judged healthy — a
    // green result for a case that was never set up.
    expect(
      aliveRatio,
      `the background must be a DIED one: audio advanced ${advancedWhileAway.toFixed(1)}s of ${away.hiddenMs / 1000}s away (ratio ${aliveRatio.toFixed(2)}, must be under ${ALIVE_RATIO})`
    ).toBeLessThan(ALIVE_RATIO);
    note(
      `returned after ${away.hiddenMs / 1000}s away: paused=${onReturn.paused}, currentTime=${onReturn.currentTime.toFixed(2)}s, ` +
        `audio advanced ${advancedWhileAway.toFixed(1)}s (ratio ${aliveRatio.toFixed(2)} -> the app must call this DIED)`
    );

    // Nothing may make a sound before the listener asks. 25s covers the 3s
    // watchdog interval, its 9s threshold and two reconnect backoffs.
    const idleSamples = await sampleProgress(page, 25_000, 1_000);
    const afterIdle = await readAudio(page);
    // ⚠ Gather EVERYTHING before asserting anything.
    //
    // The first version asserted the browser-request list first, so the run
    // stopped there and never reported whether audio had actually resumed —
    // the difference between «Chromium re-fetched a stalled resource» and «the
    // radio started playing again», which are not the same defect and may not
    // even be the same owner. A diagnosis needs the whole picture, not the
    // first tripwire.
    const newBrowserRequests = browserStreamRequests.slice(browserRequestsBeforeReturn);
    const newServerHits = live.hits().filter((h) => h.at >= returnedAt);
    // ⚠ FORWARD progress, not `Math.abs`. A reattached source resets
    // `currentTime` to 0, and an absolute difference reads that reset as
    // «14 seconds of audio were produced» — the opposite of what happened. The
    // reattach is caught by the connection assertions, where it belongs.
    const audioMoved = afterIdle.currentTime - onReturn.currentTime;
    note(
      `AFTER RETURN, 25s, no Play pressed:
` +
        `      browser stream requests : ${newBrowserRequests.length} ${JSON.stringify(newBrowserRequests.map((r) => r.url.slice(0, 70)))}
` +
        `      server audio hits       : ${JSON.stringify(newServerHits.map((h) => ({ m: h.method, range: h.range || '(none)', ua: h.ua.slice(0, 24) })))}
` +
        `      currentTime             : ${onReturn.currentTime.toFixed(2)} -> ${afterIdle.currentTime.toFixed(2)} (moved ${audioMoved.toFixed(2)}s)
` +
        `      samples                 : ${idleSamples.map((s) => s.toFixed(1)).join(', ')}
` +
        `      paused                  : ${onReturn.paused} -> ${afterIdle.paused}`
    );

    // The listener's contract, in the order it matters to them:
    // first «did sound come back», then «did anything try».
    expect(audioMoved, 'no audio may be produced before the explicit Play').toBeLessThan(0.5);
    expect(afterIdle.currentTime, 'and the source may not be reattached').toBeGreaterThan(
      onReturn.currentTime - 0.5
    );
    // ⚠ «Nothing started» must mean «it CHOSE not to», never «there was
    // nothing to start». Without this the scenario would pass just as happily
    // over an element with no source at all.
    expect(afterIdle.src, 'the station must still be loaded, and simply not playing').not.toBe('');
    expect(
      (await page.locator('.player-dock-title').innerText()).trim(),
      'and the listener must still see the station they asked for'
    ).toContain(STATION);
    expect(
      live.connections(),
      'nothing may open the audio stream before the explicit Play'
    ).toBe(connectionsBeforeReturn);
    expect(
      newBrowserRequests.map((r) => r.url),
      'and the app must not even request one'
    ).toEqual([]);
    note(
      `SCENARIO 1 PASS — 25s after the return: ${live.connections() - connectionsBeforeReturn} new connections, currentTime ${onReturn.currentTime.toFixed(2)} -> ${afterIdle.currentTime.toFixed(2)} (samples ${idleSamples.map((s) => s.toFixed(1)).join(', ')})`
    );
    await page.screenshot({ path: shot('02-after-return-silent.png') });

    // ------------------------------------ 2. Play restores the SAME station
    live.feed();
    const control = playPauseControl(page);
    await expect(control).toBeVisible();
    await expect(control, 'the control must be pressable, not a disabled stub').toBeEnabled();
    const box = await control.boundingBox();
    expect(box!.width, 'the control is a real touch target').toBeGreaterThanOrEqual(44);
    expect(box!.height, 'the control is a real touch target').toBeGreaterThanOrEqual(44);

    // The UI may be showing Pause (the element never paused itself). Press
    // whatever is there until the player is actually asked to play.
    await control.click();
    await page.waitForTimeout(600);
    if ((await readAudio(page)).paused) {
      await playPauseControl(page).click();
    }

    const recovered = await waitForSustainedAudio(page, 3, 60_000);
    expect(live.connections(), 'the Play opened a NEW stream — a reconnect, not a resumed corpse').toBeGreaterThan(
      connectionsBeforeReturn
    );
    await expect(page.locator('.player-dock-title')).toContainText(STATION);
    note(
      `SCENARIO 2 PASS — Play reconnected ${STATION}: connections ${connectionsBeforeReturn} -> ${live.connections()}, currentTime moving again at ${recovered.toFixed(2)}s`
    );
    await page.screenshot({ path: shot('03-recovered.png') });

    // -------------------------------------------- 3. a total failure is honest
    live.refuse(true);
    // Every candidate now answers 502, so the walk runs out for real.
    await expect
      .poll(async () => (await readAudio(page)).paused || (await page.locator('.player-dock-bar').count()) === 0, {
        timeout: 60_000,
        intervals: [1000]
      })
      .toBeTruthy();
    await page.waitForTimeout(3_000);

    const dockVisible = await page.locator('.player-dock-bar').isVisible();
    const dockTitle = await page.locator('.player-dock-title').innerText().catch(() => '');
    expect(dockVisible, 'the source must stay on screen after a total failure').toBe(true);
    expect(dockTitle, 'and it must still be the station the listener asked for').toContain(STATION);

    const retry = playPauseControl(page);
    await expect(retry, 'a retry control must be reachable').toBeVisible();
    const retryBox = await retry.boundingBox();
    expect(retryBox!.width).toBeGreaterThanOrEqual(44);
    expect(retryBox!.height).toBeGreaterThanOrEqual(44);
    expect(await retry.isEnabled(), 'and it must be pressable').toBe(true);
    note(
      `SCENARIO 3 PASS — total failure keeps «${dockTitle.replace(/\s+/g, ' ').trim()}» on screen with a ${Math.round(retryBox!.width)}x${Math.round(retryBox!.height)} retry control`
    );
    await page.screenshot({ path: shot('04-total-failure.png') });

    // -------------------------------- 4. the retry works; Pause really stops
    live.refuse(false);
    const beforeRetry = live.connections();
    await retry.click();
    await page.waitForTimeout(600);
    if ((await readAudio(page)).paused) {
      await playPauseControl(page).click();
    }
    const retried = await waitForSustainedAudio(page, 3, 60_000);
    expect(live.connections(), 'the retry must actually open a stream').toBeGreaterThan(beforeRetry);
    await expect(page.locator('.player-dock-title')).toContainText(STATION);
    note(
      `SCENARIO 4a PASS — retry reconnected: connections ${beforeRetry} -> ${live.connections()}, currentTime ${retried.toFixed(2)}s`
    );
    await page.screenshot({ path: shot('05-retry-works.png') });

    // Pause, and then nothing at all for 25 seconds.
    await playPauseControl(page).click();
    await expect
      .poll(async () => (await readAudio(page)).paused, { timeout: 15_000, intervals: [500] })
      .toBe(true);
    const pausedAt = await readAudio(page);
    const connectionsAtPause = live.connections();
    await page.waitForTimeout(25_000);
    const afterPause = await readAudio(page);

    expect(afterPause.paused, 'a deliberate pause must stay paused').toBe(true);
    expect(live.connections(), 'and nothing may open a stream after it').toBe(connectionsAtPause);
    expect(
      Math.abs(afterPause.currentTime - pausedAt.currentTime),
      'and no audio may be produced'
    ).toBeLessThan(0.5);
    note(
      `SCENARIO 4b PASS — 25s after Pause: still paused, ${live.connections() - connectionsAtPause} new connections, currentTime ${pausedAt.currentTime.toFixed(2)} -> ${afterPause.currentTime.toFixed(2)}`
    );
    await page.screenshot({ path: shot('06-paused-stays-paused.png') });

    console.log('\nACCEPTANCE SUMMARY\n' + evidence.map((l) => `  - ${l}`).join('\n') + '\n');
  } finally {
    await live.close();
  }
});

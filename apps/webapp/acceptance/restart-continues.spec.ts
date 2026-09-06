import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';

import { mockStations, playHomeStation, stations } from '../tests/helpers';
import { startLiveStream, type LiveStream } from './liveStreamServer';

/**
 * 0.1b.2 acceptance — continuing after the OS killed the app.
 *
 * Reported on a Samsung S20 FE, Android 13: Android ended Telegram for memory
 * (`LOW_MEMORY`), and reopening RadioAtlas brought the finds back with an empty
 * player. Carrying on took a search instead of a tap.
 *
 * ⚠ The restart here is REAL, and that is the one thing this file has which the
 * unit and gating tests cannot: `page.reload()` tears the whole app down —
 * every ref, every timer, the audio element itself — and rebuilds it from
 * storage. That is the same starting point Android leaves behind. Nothing about
 * the player is mocked: real `<audio>`, real decoding, a real socket.
 *
 * The contract, in the listener's order:
 *
 *   after the restart   the station is there, and SILENT
 *   for thirty seconds  nothing opens a stream — long enough to catch the
 *                       deferred machinery, not just the first paint
 *   one press           the same station plays, and keeps playing
 */

const ART = process.env.ACCEPTANCE_ARTIFACTS || join(process.cwd(), '..', '..', 'acceptance-artifacts');
const shot = (name: string) => join(ART, name);

const STREAM_PORT = 39179;
const STATION = 'Tokyo FM';

const usingLiveStream = (live: LiveStream) => {
  for (const station of stations) {
    station.url = live.url;
    station.url_resolved = live.url;
  }
};

const readAudio = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('audio');
    return {
      currentTime: el?.currentTime ?? -1,
      paused: el?.paused ?? true,
      src: el?.currentSrc || el?.getAttribute('src') || ''
    };
  });

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

test('0.1b.2 acceptance: a full restart continues in one press — at 390x844', async ({ page }) => {
  test.setTimeout(300_000);
  const live = await startLiveStream(STREAM_PORT);
  const note = (line: string) => console.log(`ACCEPT | ${line}`);

  /**
   * ⚠ AUDIO requests only — `/api/stream?url=`, and nothing else.
   *
   * The first version also matched the port number, which appears inside the
   * ENCODED upstream of every `/api/metadata?url=` call too. It then reported
   * «a restart asked for a stream» about two metadata probes, for a player
   * whose `src` was empty and whose `currentTime` never left zero. Resolving a
   * track for the station on screen is not playback, and counting it as
   * playback invents a defect — the same mistake the production check made,
   * for the same reason.
   */
  const audioRequests: { at: number; url: string }[] = [];
  const otherRequests: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/stream?url=')) audioRequests.push({ at: Date.now(), url });
    else if (url.includes(String(STREAM_PORT))) otherRequests.push(url);
  });

  try {
    usingLiveStream(live);
    await page.setViewportSize({ width: 390, height: 844 });
    await mockStations(page);
    // ⚠⚠ NO `seedRadioState` here, and this cost a run to learn.
    //
    // `addInitScript` re-runs on EVERY navigation, `page.reload()` included, and
    // `seedRadioState` writes `radio:player:v2` unconditionally. So the reload
    // that stands in for the OS kill was also wiping the queue the app had just
    // persisted — the app restored nothing because there was nothing left to
    // restore, and the failure looked exactly like a broken feature.
    //
    // A real restart does not reset storage. So the seed here is idempotent:
    // it fills in only what is missing, and never touches what the app wrote.
    await page.addInitScript(() => {
      if (!localStorage.getItem('radio:api-url')) localStorage.setItem('radio:api-url', '/api');
    });
    await page.unroute('https://stream.example.com/**');
    await page.unroute('**/stream?url=**');
    await page.goto('/?api=/api&glass=full');

    // ---- play for real, so the app writes its own queue to storage ----
    await playHomeStation(page, STATION);
    await expect(page.locator('.player-dock-bar')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.player-dock-title')).toContainText(STATION);
    const settled = await waitForSustainedAudio(page, 5);
    expect(live.connections(), 'the audio must be real, from the stream server').toBeGreaterThan(0);
    note(`on air: ${settled.toFixed(2)}s of decoded audio over ${live.connections()} connection(s)`);

    // The 1200ms deferred write has to land before the restart, or the test
    // measures a queue that was never persisted.
    await page.waitForTimeout(2500);
    const storedBefore = await page.evaluate(() => localStorage.getItem('radio:player:v2'));
    expect(storedBefore, 'the app must have persisted a queue of its own').toContain(STATION);

    // ---------------------------- THE RESTART ----------------------------
    // Everything the OS took: refs, timers, the audio element, the hook.
    const connectionsBeforeRestart = live.connections();
    const requestsBeforeRestart = audioRequests.length;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.player-dock-bar').waitFor({ state: 'visible', timeout: 30_000 });

    const restored = await page.evaluate(() => {
      const bar = document.querySelector('.player-dock-bar');
      const play = bar?.querySelector('.dock-play-btn') as HTMLButtonElement | null;
      return {
        title: bar?.querySelector('.player-dock-title')?.textContent?.trim() ?? null,
        playLabel: play?.getAttribute('aria-label') ?? null,
        playDisabled: play?.disabled ?? null,
        statusPill: bar?.querySelector('.player-dock-status-pill')?.textContent?.trim() ?? null,
        dockAttr: document.querySelector('.app-shell-v2')?.getAttribute('data-dock') ?? null
      };
    });
    note(
      `after restart: «${restored.title}», control=«${restored.playLabel}», ` +
        `pill=${restored.statusPill ?? 'none'}, data-dock=${restored.dockAttr}`
    );
    expect(restored.title, 'the station must be back on screen').toContain(STATION);
    expect(restored.playLabel, 'offering Play, not Pause').toBe('Слушать');
    expect(restored.playDisabled, 'and pressable').toBe(false);
    expect(restored.statusPill, 'saying nothing untrue while it waits').toBeNull();
    expect(restored.dockAttr, 'with room reserved for it').toBe('bar');
    await page.screenshot({ path: shot('r1-restored-silent.png') });

    // ---- 30 seconds of proven silence, long enough for the deferred work ----
    const samples: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      samples.push((await readAudio(page)).currentTime);
      await page.waitForTimeout(1000);
    }
    const idle = await readAudio(page);
    note(
      `30s after the restart: ${live.connections() - connectionsBeforeRestart} new server connection(s), ` +
        `${audioRequests.length - requestsBeforeRestart} browser AUDIO request(s), ` +
        `${otherRequests.length} metadata probe(s) (not playback), ` +
        `currentTime ${idle.currentTime.toFixed(2)}, src=${idle.src ? 'attached' : 'empty'}`
    );
    expect(
      audioRequests.slice(requestsBeforeRestart).map((r) => r.url),
      'a restart may not ask for a stream'
    ).toEqual([]);
    expect(
      live.connections(),
      'and nothing may reach the stream server'
    ).toBe(connectionsBeforeRestart);
    expect(Math.max(...samples, idle.currentTime), 'no audio may be produced').toBeLessThan(0.05);

    // ------------------------- one press continues -------------------------
    await page.locator('.player-dock-bar .dock-play-btn').click();
    const resumed = await waitForSustainedAudio(page, 3, 60_000);
    expect(live.connections(), 'the press must open a stream').toBeGreaterThan(
      connectionsBeforeRestart
    );
    await expect(page.locator('.player-dock-title')).toContainText(STATION);
    note(
      `ONE PRESS: ${STATION} playing again, currentTime ${resumed.toFixed(2)}s, ` +
        `connections ${connectionsBeforeRestart} -> ${live.connections()}`
    );
    await page.screenshot({ path: shot('r2-one-press-continues.png') });
  } finally {
    await live.close();
  }
});

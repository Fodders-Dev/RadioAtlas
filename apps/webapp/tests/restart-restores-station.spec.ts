import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

/**
 * 0.1b.2 — continuing after the OS killed the app.
 *
 * Reported on a Samsung S20 FE, Android 13: the system ended Telegram for
 * memory, and reopening RadioAtlas brought every find back while the player was
 * empty. The station was still in the stored queue; nothing put it anywhere the
 * dock could see it, so carrying on took a search instead of a tap.
 *
 * The rule this file holds:
 *
 *   a full restart shows the last station and a working Play,
 *   makes NO sound of its own,
 *   and says nothing untrue while it waits.
 *
 * The audio half — thirty seconds of proven silence, then one press producing
 * sustained decoded audio — needs a real socket and lives in
 * `acceptance/restart-continues.spec.ts`. What is here is the deterministic
 * half, so it can gate every push.
 */

const HOME = '/?api=/api&glass=full';

const openRestarted = async (
  page: Page,
  options: { queue?: typeof stations } = {}
) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMediaMocks(page);
  await mockStations(page);
  // A queue with `currentIndex >= 0` is exactly what survives an OS kill.
  await seedRadioState(page, { activeSection: 'home', queue: options.queue ?? [] });
  await page.goto(HOME);
  await page.locator('.screen-home-next, [data-home-rail], [data-home-feed-entry]').first().waitFor({
    state: 'visible',
    timeout: 20_000
  });
};

/** Everything the dock is saying, read in ONE round trip. */
const dockState = (page: Page) =>
  page.evaluate(() => {
    const bar = document.querySelector('.player-dock-bar');
    const audio = document.querySelector('audio') as HTMLAudioElement | null;
    const play = bar?.querySelector('.dock-play-btn') as HTMLButtonElement | null;
    return {
      present: Boolean(bar),
      title: bar?.querySelector('.player-dock-title')?.textContent?.trim() ?? null,
      playLabel: play?.getAttribute('aria-label') ?? null,
      playDisabled: play?.disabled ?? null,
      // «Буферизация» / «Переподключаемся» / a transport error all render here.
      statusPill: bar?.querySelector('.player-dock-status-pill')?.textContent?.trim() ?? null,
      dockAttr: document.querySelector('.app-shell-v2')?.getAttribute('data-dock') ?? null,
      audioSrc: audio?.getAttribute('src') || audio?.currentSrc || '',
      audioPaused: audio?.paused ?? null,
      audioTime: audio?.currentTime ?? -1
    };
  });

test('a full restart brings the station back, silent, with a working Play', async ({ page }) => {
  await openRestarted(page, { queue: [stations[0]] });

  const dock = await dockState(page);
  expect(dock.present, 'the player must be on screen after a restart').toBe(true);
  expect(dock.title, 'and it must be the station that was playing').toContain(stations[0].name);

  // ⚠ Silent. The control offers to START, which is the whole promise: the
  // listener continues with one press and nothing decided that for them.
  expect(dock.playLabel, 'the control must offer Play, not Pause').toBe('Слушать');
  expect(dock.playDisabled, 'and it must be pressable').toBe(false);
  expect(dock.audioSrc, 'nothing may be attached before the listener asks').toBe('');
  expect(dock.audioTime, 'and no audio may have been produced').toBeLessThan(0.05);

  // ⚠ And it must not say anything untrue while it waits. A restored station is
  // not buffering, not reconnecting, and not broken — inventing any of those is
  // the same defect as the «БУФЕРИЗАЦИЯ»-over-silence debt, in a new place.
  expect(dock.statusPill, 'a waiting player must not claim to be doing something').toBeNull();
});

test('the shell reserves room for a restored dock, so the last card stays reachable', async ({
  page
}) => {
  await openRestarted(page, { queue: [stations[0]] });

  // ⚠ This is the defect 0.1b.1 shipped, caught here rather than on a phone:
  // the dock renders on `current ?? pending` while `data-dock` read `current`
  // alone, so a station held as `pending` drew the bar with no reserve behind
  // it and the last tile sat underneath. `dock-reserve.spec.ts` never had a
  // `pending` case, so nothing said so.
  const geometry = await page.evaluate(() => {
    const shell = document.querySelector('.app-shell-v2');
    const bar = document.querySelector('.player-dock-bar');
    const tiles = [...document.querySelectorAll('[data-home-station]')];
    const last = tiles.length ? tiles[tiles.length - 1] : null;
    // Read both boxes in the SAME evaluate: two `boundingBox()` calls are two
    // round-trips at different moments, and the test then measures the gap
    // between its own reads.
    return {
      dockAttr: shell?.getAttribute('data-dock') ?? null,
      barTop: bar ? Math.round(bar.getBoundingClientRect().top) : null,
      barVisible: bar ? bar.getBoundingClientRect().height > 0 : false,
      lastTileBottom: last ? Math.round(last.getBoundingClientRect().bottom) : null
    };
  });

  expect(geometry.barVisible, 'the bar is drawn').toBe(true);
  expect(geometry.dockAttr, 'so the shell must reserve room for it').toBe('bar');

  // Scroll to the very bottom and check the last card clears the bar.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(400);
  const atBottom = await page.evaluate(() => {
    const bar = document.querySelector('.player-dock-bar');
    const tiles = [...document.querySelectorAll('[data-home-station]')];
    const last = tiles.length ? tiles[tiles.length - 1] : null;
    return {
      barTop: bar ? Math.round(bar.getBoundingClientRect().top) : null,
      lastTileBottom: last ? Math.round(last.getBoundingClientRect().bottom) : null
    };
  });
  if (atBottom.lastTileBottom !== null && atBottom.barTop !== null) {
    expect(
      atBottom.lastTileBottom,
      'the last card must not sit under the restored player'
    ).toBeLessThanOrEqual(atBottom.barTop);
  }
});

test('a cleared queue stays cleared across a restart', async ({ page }) => {
  // ⚠ The owner's correction, and the reason there is no `playbackHistory`
  // fallback: `clearQueue()` empties the items, sets the index to -1 and calls
  // `stop()`. Restoring from history would put back a station the listener had
  // just deliberately removed, turning an explicit action into a suggestion.
  await openRestarted(page, { queue: [] });
  await page.waitForTimeout(1500);

  const dock = await dockState(page);
  expect(dock.present, 'nothing was queued, so nothing may come back').toBe(false);
  expect(dock.dockAttr, 'and no room may be reserved for it').toBe('none');
});

test('the restored station never overwrites what the listener picks next', async ({ page }) => {
  await openRestarted(page, { queue: [stations[0]] });
  await expect(page.locator('.player-dock-title')).toContainText(stations[0].name);

  // The listener starts something else. The restore ran once, at
  // initialisation, so there is nothing left to come back and undo this.
  const other = page.locator('[data-home-station]').filter({ hasText: stations[1].name }).first();
  if (await other.isVisible().catch(() => false)) {
    await other.locator('.home-station-primary-action').click();
    await expect(page.locator('.player-dock-title')).toContainText(stations[1].name, {
      timeout: 15_000
    });
    await page.waitForTimeout(1500);
    await expect(
      page.locator('.player-dock-title'),
      'the restored station must not reappear over the new one'
    ).toContainText(stations[1].name);
  }
});

import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

/**
 * The honesty gate for the redesigned Home block (`?air2=1`).
 *
 * A prototype with seven hand-set states only proves that a mock renders
 * `sound=true/false`. This asserts the thing that actually matters: the block
 * claims liveness ONLY when the app is producing audio, and offers «Сохранить
 * трек» ONLY when a track is really known.
 *
 * ⚠ Mutation this answers, in one edit: in `AirBlock.tsx` change
 *
 *     const onAir = mode === 'playing';
 * to
 *     const onAir = Boolean(current);
 *
 * That is defect (1)–(3) of docs/UI-MIGRATION-MAP.md §8 written back into the
 * new design — «В эфире» and the pulsing dot over a station that is merely
 * selected. Verified by running it, not by reading it: with that edit the
 * restored-station and paused cases go red.
 *
 * ⚠ Everything is read in ONE `page.evaluate` per assertion point, by selector.
 * `locator.evaluate` retries until the node is stable, and on a clean first run
 * Home re-renders often enough that it never is — the first draft of this file
 * burned its whole 30s budget there and looked exactly like a missing element.
 */

const LIVE_WORDS = /В ЭФИРЕ|В эфире|LIVE|Прямой эфир/;

type Snapshot = {
  present: boolean;
  mode: string | null;
  text: string;
  liveDot: number;
  saveDisabled: boolean | null;
  nextText: string | null;
  nextDisabled: boolean | null;
  height: number | null;
};

/** Wait for Home to be hydrated, then read the block in a single round trip. */
const readBlock = async (page: Page): Promise<Snapshot> => {
  // The repo's own "Home is hydrated" sentinel; ~65 e2e anchors use it.
  await page.locator('[data-home-feed-entry]').waitFor({ state: 'visible' });
  await page.waitForFunction(() => Boolean(document.querySelector('[data-air-block]')));
  return page.evaluate(() => {
    const el = document.querySelector('[data-air-block]') as HTMLElement | null;
    if (!el) {
      return {
        present: false,
        mode: null,
        text: '',
        liveDot: 0,
        saveDisabled: null,
        nextText: null,
        nextDisabled: null,
        height: null
      };
    }
    const pills = el.querySelectorAll('.air-block-pill');
    const save = pills[0] as HTMLButtonElement | undefined;
    const next = pills[pills.length - 1] as HTMLButtonElement | undefined;
    return {
      present: true,
      mode: el.getAttribute('data-mode'),
      text: (el.innerText || '').trim(),
      liveDot: el.querySelectorAll('.air-block-live').length,
      saveDisabled: save ? save.disabled : null,
      nextText: pills.length > 1 && next ? (next.innerText || '').trim() : null,
      nextDisabled: pills.length > 1 && next ? next.disabled : null,
      height: Math.round(el.getBoundingClientRect().height)
    };
  });
};

const seedRestored = (page: Page) =>
  // A queue with a current index is exactly what a restart leaves behind: the
  // station is known, nothing is playing, and Play must work.
  seedRadioState(page, {
    queue: [stations[0]],
    queueCurrentIndex: 0,
    stationCache: [stations[0]]
  });

test.describe('the redesigned Home block tells the truth about sound', () => {
  test.beforeEach(async ({ page }) => {
    await mockStations(page);
    await installMediaMocks(page);
  });

  test('nothing chosen yet: a compact offer, and nothing claims to be on air', async ({ page }) => {
    await seedRadioState(page);
    await page.goto('/?air2=1');

    const state = await readBlock(page);
    expect(state.present, 'the block must render on a clean first run').toBe(true);
    expect(state.mode).toBe('offer');
    expect(state.liveDot).toBe(0);
    expect(state.text).not.toMatch(LIVE_WORDS);
    // Compact is the point: the offer must not push the shelves off the screen.
    expect(state.height).toBeLessThanOrEqual(140);
  });

  test('a restored station comes back silent, and says so', async ({ page }) => {
    await seedRestored(page);
    await page.goto('/?air2=1');

    const state = await readBlock(page);
    expect(state.mode).toBe('ready');
    expect(state.liveDot).toBe(0);
    expect(state.text).not.toMatch(LIVE_WORDS);
    // No track is known while nothing plays, so the find cannot be caught.
    expect(state.saveDisabled).toBe(true);
  });

  test('playing claims liveness; pausing takes the claim back', async ({ page }) => {
    await seedRestored(page);
    await page.goto('/?air2=1');
    await readBlock(page);

    await page.locator('[data-air-block] .air-block-play').click();
    await expect(page.locator('[data-air-block]')).toHaveAttribute('data-mode', 'playing');
    const playing = await readBlock(page);
    expect(playing.liveDot).toBe(1);
    expect(playing.text).toMatch(LIVE_WORDS);

    await page.locator('[data-air-block] .air-block-play').click();
    await expect(page.locator('[data-air-block]')).toHaveAttribute('data-mode', 'paused');
    const paused = await readBlock(page);
    // The whole point: the station is still selected, and nothing says live.
    expect(paused.liveDot).toBe(0);
    expect(paused.text).not.toMatch(LIVE_WORDS);
    expect(paused.saveDisabled).toBe(true);
  });

  test('an empty queue is named, not silently turned into another action', async ({ page }) => {
    await seedRestored(page);
    await page.goto('/?air2=1');

    const state = await readBlock(page);
    expect(state.nextText).toMatch(/Конец очереди|End of queue/);
    expect(state.nextDisabled).toBe(true);
    // …and the feed is still offered, by its own handle right below.
    await expect(page.locator('[data-home-feed-entry]')).toBeVisible();
  });

  test('every control clears the 44px floor', async ({ page }) => {
    await seedRestored(page);
    await page.goto('/?air2=1');
    await readBlock(page);

    const boxes = await page.evaluate(() => {
      const root = document.querySelector('[data-air-block]') as HTMLElement;
      return Array.from(root.querySelectorAll('button')).map((el) => {
        const r = el.getBoundingClientRect();
        return {
          label: (el.getAttribute('aria-label') || el.textContent || '?').trim().slice(0, 32),
          w: Math.round(r.width),
          h: Math.round(r.height)
        };
      });
    });
    expect(boxes.length).toBeGreaterThan(2);
    for (const box of boxes) {
      expect(box.w, `${box.label} width`).toBeGreaterThanOrEqual(44);
      expect(box.h, `${box.label} height`).toBeGreaterThanOrEqual(44);
    }
  });
});

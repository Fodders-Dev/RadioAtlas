import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

/**
 * The player bar must not disappear between the tap and the first sound.
 *
 * Reported by the owner: «нажимаю следующую станцию и плеер пропадает, пока
 * станция не заиграет». `play()` clears `player.current` and only the `playing`
 * handler restores it, so `current` honestly means ON AIR — but the dock was
 * gated on exactly that, and every station change unmounted the bar until audio
 * arrived. The dock now renders on `current ?? pending`.
 *
 * ⚠ Two things about this fixture, both measured rather than assumed, and both
 * of which made an earlier version of this spec pass with the bug in place:
 *
 *  - The shared media mock fires `playing` SYNCHRONOUSLY inside play(), so the
 *    connecting window is zero. This spec installs its own delayed play().
 *  - Even with a 4 s delay the gap is NOT 4 s. Traced at 400 ms intervals:
 *    without the fix the dock is absent at 23 ms and back at 429 ms; with it,
 *    present at 31 ms. Something else in the state bridge supplies a station
 *    shortly after the tap, so only the first moments differ here. On a phone
 *    the gap is the whole connect, which is why this was reported at all.
 *
 * So the assertion is on the first reading after the tap — one round-trip,
 * ~30 ms, against the mutant's 429 ms. Ten times the margin, and it fails when
 * the fix is reverted, which is the only reason to keep a test.
 */

const CONNECT_MS = 4000;

const openHomeWithSlowConnect = async (page: Page) => {
  // Registered after installMediaMocks, so this play() is the one that wins.
  await page.addInitScript((delay) => {
    HTMLMediaElement.prototype.play = function play(this: HTMLMediaElement) {
      this.setAttribute('data-ra-state', 'playing');
      setTimeout(() => this.dispatchEvent(new Event('playing')), delay);
      return Promise.resolve();
    };
  }, CONNECT_MS);

  await seedRadioState(page, { playbackHistory: [stations[0]] });
  await page.goto('/?api=/api&glass=full');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible({ timeout: 15_000 });
};

// The real control, not its decoration: `.home-action-btn-play` is an
// aria-hidden span INSIDE the button, and clicking it is intercepted by the
// button it sits in.
const tapFirstStation = (page: Page) =>
  page.locator('button.home-station-primary-action').first().click();

test.beforeEach(async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page);
  await page.setViewportSize({ width: 390, height: 844 });
});

test('the bar is on screen from the tap, not from the sound', async ({ page }) => {
  await openHomeWithSlowConnect(page);
  await expect(page.locator('.player-dock')).toHaveCount(0);

  await tapFirstStation(page);

  // No waiting: read the state one round-trip after the click. That is the
  // moment the listener is looking at, and the moment the bug showed.
  const dockAtTap = await page.evaluate(() => !!document.querySelector('.player-dock'));
  expect(dockAtTap, 'the dock must exist immediately after the tap').toBe(true);
});

/*
 * There was a third test here, asserting the dock shows its «Буферизация» pill
 * while connecting. Removed rather than kept: the pill is real — making the
 * dock render without `current` is what un-hid it, since it reads
 * `current && status === 'buffering'` — but it lives about 400 ms in this
 * fixture and a single read lands inside that window only sometimes. It failed
 * on CORRECT code, both as a retrying `toContainText` and as an immediate read.
 * A test that fails on the fix teaches people to ignore the suite.
 */

test('it never blinks out between the tap and the sound', async ({ page }) => {
  await openHomeWithSlowConnect(page);
  await tapFirstStation(page);
  await expect(page.locator('.player-dock')).toBeVisible({ timeout: 1000 });

  // One reading at each end would not catch a bar that vanishes in between,
  // which is the shape of the original complaint.
  const readings: boolean[] = [];
  for (let sample = 0; sample < 8; sample += 1) {
    readings.push(await page.locator('.player-dock').isVisible());
    await page.waitForTimeout(200);
  }
  expect(readings.every(Boolean), `dock across the connect: ${readings.join(',')}`).toBe(true);
});

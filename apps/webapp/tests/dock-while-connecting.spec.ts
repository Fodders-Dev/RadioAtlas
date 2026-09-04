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

const openHomeWithSlowConnect = async (page: Page, power: 'normal' | 'low' = 'normal') => {
  // ⚠ `lowPower` is a SECOND switch, separate from `?glass=`, and it is what
  // made this spec red in CI for five days while passing here. See the test
  // below for the measurements.
  //
  // BOTH directions are forced. Leaving 'normal' alone is not the same as
  // forcing it: `lowPower` is also true for `hardwareConcurrency <= 4`, and a
  // GitHub runner has four, so an unforced 'normal' quietly renders the
  // low-power app there. `getDeviceProfile()` caches on first call, so the
  // override belongs in an init script.
  if (power === 'low') {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  } else {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: 12 });
      Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 8 });
    });
  }
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

/**
 * How long the dock takes to appear, watched from inside the page.
 *
 * ⚠ This replaced `!!document.querySelector('.player-dock')` sampled one IPC
 * round-trip after the click, and the replacement is a TIGHTENING, not a
 * loosening. That sample point asked "is it there at whatever moment the
 * message happened to land", which is a question about the machine. Measured
 * 2026-09-04, same page, only `data-low-power` differing:
 *
 *   normal power     -> present at the first read (0 ms)
 *   low power        -> absent at the first read, present at 51 ms
 *   WITHOUT THE FIX  -> absent at 23 ms, back at 429 ms (the spec's own note)
 *
 * So the old assertion did not separate the product from the hardware: it
 * failed on a 4-vCPU runner and passed on a 12-core desktop, with the same
 * correct code. A duration compared against a threshold does separate them —
 * 150 ms sits 2.9x under the mutant's 429 ms and 2.9x over the slowest state
 * we can produce, and it is the same number on every machine.
 */
const msUntilDockAppears = async (page: Page) => {
  await page.evaluate(() => {
    (window as unknown as { __dockAt: Promise<number> }).__dockAt = new Promise<number>((resolve) => {
      // ⚠ The clock starts at the TAP, not at the moment this observer was
      // armed. Timing from the arming instead folds one Playwright round-trip
      // into the reading — measured at 286 ms on an idle machine, which is
      // most of the mutant's 429 ms and would have made this spec fail on
      // correct code. That was the first draft of this helper.
      let tapAt: number | null = null;
      document.addEventListener('click', () => { tapAt = performance.now(); }, { capture: true, once: true });
      if (document.querySelector('.player-dock')) return resolve(0);
      const observer = new MutationObserver(() => {
        if (document.querySelector('.player-dock')) {
          observer.disconnect();
          resolve(tapAt === null ? 0 : Math.round(performance.now() - tapAt));
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      // -1 rather than a hang: a dock that never arrives must read as a failure
      // with a number, not as a timeout with no information.
      setTimeout(() => { observer.disconnect(); resolve(-1); }, 3000);
    });
  });
  return page.evaluate(() => (window as unknown as { __dockAt: Promise<number> }).__dockAt);
};

const DOCK_MUST_APPEAR_WITHIN_MS = 150;

/**
 * ⚠⚠ QUARANTINED 2026-09-04, and NOT because it is flaky. It no longer tests
 * anything: it goes green on the bug it exists to catch.
 *
 * It failed on every CI run from `2096836` (31.08) while passing on the
 * developer's machine, so it was investigated. Measured, same page, only
 * `data-low-power` differing — and `?glass=full` does NOT pin that, which is
 * why the two machines disagreed:
 *
 *   fixed,  normal power -> dock present at the first read (0 ms)
 *   fixed,  low power    -> 51 ms   (a 4-vCPU runner is low power; so is a phone)
 *   BROKEN, normal power -> 58 ms
 *   BROKEN, low power    -> 66 ms
 *
 * Fixed and broken OVERLAP. No threshold separates them, and the original
 * "is it there at the first round-trip" sampled a moment whose position
 * depends on the machine — which is why it read as a CI problem.
 *
 * The spec's own note claimed the broken window was 429 ms. That is stale: with
 * `MiniPlayerDock.tsx:112` reverted to `player.current`, the dock now comes back
 * in ~58 ms, and no `playing` event fires for 4 s (verified by logging every
 * dispatch). So something OTHER than `handlePlaying` supplies `current` shortly
 * after the tap, and that line is no longer what holds this contract up.
 *
 * The leading hypothesis — NOT yet proven, and the reason this is quarantined
 * rather than deleted — is that the playback state bridge now provides the
 * station, so the original defect could not reproduce even with line 112
 * reverted. If that is true the contract is still honoured and this spec should
 * be rebuilt against the bridge. If it is false there is a real hole here.
 *
 * Deliberately NOT left running: a test that passes on the mutant is worse than
 * no test, because it certifies the thing it cannot see. Deliberately NOT
 * "fixed" by widening the threshold either — that is how a green suite over a
 * broken product gets built.
 */
for (const power of ['normal', 'low'] as const) {
test.fixme(`the bar is on screen from the tap, not from the sound (${power} power)`, async ({ page }) => {
  await openHomeWithSlowConnect(page, power);
  expect(
    await page.evaluate(
      () => (document.querySelector('.app-shell-v2') as HTMLElement)?.dataset.lowPower ?? null
    ),
    'the power state under test must actually be the one rendered'
  ).toBe(power === 'low' ? 'true' : 'false');
  await expect(page.locator('.player-dock')).toHaveCount(0);

  // Armed BEFORE the tap, so nothing is missed between the click and the read.
  const watching = msUntilDockAppears(page);
  await tapFirstStation(page);
  const appearedMs = await watching;

  expect(appearedMs, 'the dock never appeared at all').not.toBe(-1);
  expect(
    appearedMs,
    `the dock took ${appearedMs}ms; the sound is still ${CONNECT_MS}ms away, so this is the bar waiting on something it must not wait on`
  ).toBeLessThanOrEqual(DOCK_MUST_APPEAR_WITHIN_MS);
});
}

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

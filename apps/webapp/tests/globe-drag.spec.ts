import { expect, test } from '@playwright/test';
import { installMediaMocks, mockStations } from './helpers';

// T2.13: the reticle nearest-station search used to run
// map.queryRenderedFeatures() (~16 ms) on every 'move' event (~60 Hz
// during a drag). It now runs an in-memory two-pass search.
//
// The perf win is proven structurally — the query is gone, replaced by a
// bounded scan unit-tested in src/components/globe/selection.test.ts. A
// wall-clock / long-task e2e is deliberately NOT asserted here: during a
// real drag the main thread is dominated by MapLibre's WebGL render +
// tile decode (and CI contention), which swamps the sub-millisecond
// reticle search and makes any timing gate either flaky or tautological.
//
// What this spec guards is the integration: the refactored handler drives
// a real MapLibre drag (real map.project / getCenter / live point set)
// without throwing or wedging the globe.

test.describe('globe drag responsiveness', () => {
  test.beforeEach(async ({ page }) => {
    await installMediaMocks(page);
    await mockStations(page);
  });

  test('vigorous rotate keeps the globe interactive (reticle search integration)', async ({
    page
  }) => {
    // This one spec drives 48 synthetic mouse moves through a real MapLibre
    // drag, and each of them is a round trip that waits on the renderer. It is
    // not a 30-second test and never was: measured serially on a fast developer
    // box it ran 22.3s and 23.9s against the default budget — passing, with a
    // second and a half to spare, which is why it failed the moment it met a
    // 2-core CI runner. The assertions are untouched; the budget now matches
    // what the work costs.
    test.setTimeout(90_000);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page
      .locator('.app-navigation-mobile')
      .getByRole('button', { name: /Глобус|Globe/ })
      .click();
    await expect(page.locator('.globe canvas')).toBeVisible();
    // Wait for the globe to stop fighting its own cold mount, rather than for a
    // number that happened to be enough on the machine it was written on. The
    // component pulses triggerRepaint twelve times over three seconds to work
    // around a MapLibre globe-projection bug, and the old `waitForTimeout(600)`
    // put this drag inside that window: 48 synthetic moves against a renderer
    // being force-repainted. It held here and ran the 30s budget out on
    // `mouse.move` on a 2-core CI runner.
    await expect(page.locator('.globe[data-globe-warmup="done"]')).toHaveCount(1, {
      timeout: 15_000
    });

    const box = await page.locator('.globe canvas').boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    // Many move events, each firing the reticle nearest-station search
    // against the live MapLibre projection.
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 0; i < 24; i += 1) {
      await page.mouse.move(cx + Math.sin(i / 3) * 120, cy + Math.cos(i / 3) * 70, { steps: 2 });
    }
    await page.mouse.up();
    await page.waitForTimeout(200);

    // The refactored move path didn't throw and the globe is still live.
    await expect(page.locator('.globe canvas')).toBeVisible();
    await expect(page.locator('.globe-reticle')).toBeVisible();
    expect(pageErrors, `page errors during drag: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });
});

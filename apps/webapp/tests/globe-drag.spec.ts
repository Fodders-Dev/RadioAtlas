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
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page
      .locator('.app-navigation-mobile')
      .getByRole('button', { name: /Глобус|Globe/ })
      .click();
    await expect(page.locator('.globe canvas')).toBeVisible();
    // Let MapLibre finish its first style/tile load so the drag exercises
    // steady-state move handling, not cold-mount work.
    await page.waitForTimeout(600);

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

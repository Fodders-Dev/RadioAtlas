import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations as seedFixture } from './helpers';

// T2.11b: long station lists are window-virtualized. These tests seed a
// 1000-station favorites library and assert that only a small window of
// rows is ever mounted (DOM + IntersectionObserver count stay bounded
// regardless of dataset size), and that jumping to the bottom is cheap.

const ROW_CAP = 30; // window + overscan at the 1280x720 e2e viewport
const makeStations = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    ...seedFixture[0],
    stationuuid: `virt-uuid-${index}`,
    name: `Virtual Station ${index}`
  }));

const installIntersectionObserverCounter = async (page: Page) => {
  await page.addInitScript(() => {
    const Native = window.IntersectionObserver;
    let live = 0;
    let max = 0;
    (window as unknown as { __ioStats__: () => { live: number; max: number } }).__ioStats__ =
      () => ({ live, max });
    class CountingObserver extends Native {
      constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) {
        super(cb, opts);
        live += 1;
        max = Math.max(max, live);
      }
      disconnect() {
        live = Math.max(0, live - 1);
        super.disconnect();
      }
    }
    (window as unknown as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver =
      CountingObserver;
  });
};

const countRenderedRows = (page: Page) =>
  page.locator('.screen-library-v2 [data-station-row]').count();

test.describe('station list virtualization', () => {
  test.beforeEach(async ({ page }) => {
    await installIntersectionObserverCounter(page);
    await installMediaMocks(page);
    await mockStations(page);
    await seedRadioState(page, {
      activeSection: 'library',
      libraryTab: 'favorites',
      favorites: makeStations(1000)
    });
    await page.goto('/');
    await page.locator('.screen-library-v2 [data-station-row]').first().waitFor({ state: 'visible' });
  });

  test('mounts only a bounded window of rows for a 1000-item list', async ({ page }) => {
    const atTop = await countRenderedRows(page);
    expect(atTop, 'rows rendered at top of a 1000-item list').toBeGreaterThan(0);
    expect(atTop, 'rows at top should be a small window, not the whole list').toBeLessThanOrEqual(
      ROW_CAP
    );

    // Jump to the bottom: the virtualizer reserves the full scroll height,
    // so the document scrolls; only a new window mounts.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    const atBottom = await countRenderedRows(page);
    expect(atBottom, 'rows at bottom should stay a bounded window').toBeGreaterThan(0);
    expect(atBottom, 'rows at bottom should stay a bounded window').toBeLessThanOrEqual(ROW_CAP);

    // Back to the top.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    const backAtTop = await countRenderedRows(page);
    expect(backAtTop).toBeLessThanOrEqual(ROW_CAP);
  });

  test('keeps live IntersectionObserver count bounded', async ({ page }) => {
    // Drive a scroll pass so rows recycle through several windows.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await page.waitForTimeout(200);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(200);

    const stats = await page.evaluate(() =>
      (window as unknown as { __ioStats__: () => { live: number; max: number } }).__ioStats__()
    );
    // Per-row now-playing observers exist only for mounted rows. Without
    // virtualization a 1000-item list would peak near 1000; with it the
    // peak stays within a window+overscan band (plus a handful of app-level
    // observers). The generous ceiling guards the order of magnitude.
    expect(stats.max, `peak live IntersectionObservers: ${stats.max}`).toBeLessThanOrEqual(60);
  });

  test('jumping to the bottom of 1000 rows settles quickly', async ({ page }) => {
    // Coarse catastrophic-regression guard. The precise structural win is
    // proven by the bounded-window test above (only a window mounts, never
    // 1000 rows). This wall-clock figure is dominated by rAF scheduling
    // jitter under a loaded CI runner, so the ceiling is generous — an
    // un-virtualized 1000-row mount would be multiple seconds AND blow the
    // ≤30 row cap. Measured ~300-450ms locally; 1500ms survives contention.
    const elapsed = await page.evaluate(async () => {
      const start = performance.now();
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))
      );
      return performance.now() - start;
    });
    expect(elapsed, `scroll-to-bottom settle time: ${elapsed}ms`).toBeLessThan(1500);
  });
});

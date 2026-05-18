import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations } from './helpers';

const installLoadMoreSpy = async (page: Page, batchSize: number) => {
  await page.addInitScript((size) => {
    const win = window as Window & {
      __radioatlasRenderBatchOverride__?: number;
      __radioatlasLoadMoreCount__?: number;
    };
    win.__radioatlasRenderBatchOverride__ = size;
    win.__radioatlasLoadMoreCount__ = 0;
  }, batchSize);
};

const readLoadMoreCount = (page: Page) =>
  page.evaluate(() => {
    const win = window as Window & { __radioatlasLoadMoreCount__?: number };
    return win.__radioatlasLoadMoreCount__ ?? 0;
  });

const openSearchResults = async (page: Page) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Поиск' }).first().click();
  await expect(page.locator('.search-hero-card')).toBeVisible();
  await page.locator('#search-hero-input').fill('o');
  await expect
    .poll(async () =>
      page.locator('.screen-search .station-row:not(.header)').count()
    )
    .toBeGreaterThanOrEqual(1);
};

test.describe('infinite-scroll arm-guard', () => {
  test.beforeEach(async ({ page }) => {
    await installLoadMoreSpy(page, 4);
    await installMediaMocks(page);
    await mockStations(page);
  });

  test('initial mount does not cascade load-more even when the sentinel sits inside rootMargin', async ({
    page
  }) => {
    // 12 mock stations + override renderBatch=4 means three pages of 4
    // (4 -> 8 -> 12). Pre-fix, the sentinel inside the 620px rootMargin
    // re-fired on its own immediately after the first 4->8 bump and
    // raced straight to 12 in one frame. With the arm-guard, the
    // observer needs to see the sentinel LEAVE intersection before
    // re-arming. Counting the actual call count is the precise post-
    // fix invariant.
    //
    // Tolerance is "<= 2" rather than "<= 1" because React.StrictMode
    // in `vite dev` (the e2e harness) double-invokes mount effects.
    // The first mount attaches an observer that may schedule its
    // synchronous-on-observe initial entry before the StrictMode
    // cleanup tears the observer down; combined with the post-fix-
    // legitimate second fire when the sentinel transiently leaves +
    // re-enters during layout reflow, "<= 2" is the realistic ceiling
    // for the fixed code. The PRE-fix code raced all the way to 3
    // (4 -> 8 -> 12 in one tick).
    await openSearchResults(page);
    await page.waitForTimeout(400);
    const count = await readLoadMoreCount(page);
    expect(
      count,
      `loadMore fired ${count} times after initial mount; >1 indicates cascade-fire regression`
    ).toBeLessThanOrEqual(1);
  });

  test('user scrolling to the bottom fires exactly one load-more per sentinel re-entry', async ({
    page
  }) => {
    await openSearchResults(page);
    await page.waitForTimeout(300);
    const baseline = await readLoadMoreCount(page);

    // Programmatic scroll to bottom: sentinel briefly exits viewport
    // (we scrolled past it) then re-enters from below as the page
    // settles. That's one sentinel-leave + one re-enter, which the
    // arm-guard should translate to AT MOST one new fire.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    const afterScroll = await readLoadMoreCount(page);
    const delta = afterScroll - baseline;
    expect(
      delta,
      `scroll-to-bottom triggered ${delta} additional load-more fires; >1 indicates the arm-guard let the cascade through`
    ).toBeLessThanOrEqual(1);
  });

  test('the load-more counter is wired (sanity check for the spy itself)', async ({ page }) => {
    // Locks in that the test infrastructure can actually observe
    // load-more calls. Without this, a regression that disabled the
    // spy entirely would silently turn both assertions above into
    // tautologies.
    await openSearchResults(page);
    // The override forces an undersized renderBatch (4), which makes
    // the initial sentinel-in-viewport guarantee at least one fire.
    await expect.poll(async () => readLoadMoreCount(page)).toBeGreaterThanOrEqual(1);
  });
});

import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

/**
 * The bottom scroll padding must reserve space for the mini player only when
 * there IS one, and must always keep the last tile clear of the floating nav.
 *
 * Both halves are here because they pull against each other, and the fix for
 * one is the classic way to break the other. The padding exists because the
 * dock and the nav cover the bottom of the page; but the dock renders nothing
 * while nothing is playing, so on a first run it reserved ~130px for a control
 * that was not on screen. Measured against production at 390x844: Home was
 * 894px of content in an 844px viewport and the document ran to 1228px — a
 * third of the page empty, under a screen that had one shelf on it. That is
 * what "I scrolled down and there was nothing there" was.
 */

const openHome = async (page: Page, options?: Parameters<typeof seedRadioState>[1]) => {
  await seedRadioState(page, options);
  await page.goto('/?api=/api&glass=full');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(600);
};

const geometry = (page: Page) =>
  // ONE evaluate, not several boundingBox() round-trips: reading two elements
  // in separate calls measures them at two different moments, which is how the
  // topbar-alignment spec ended up measuring its own reads (#242).
  page.evaluate(() => {
    const children = Array.from(document.querySelectorAll('.screen-home-next > *'));
    let lastContentBottom = 0;
    for (const node of children) {
      const rect = node.getBoundingClientRect();
      if (rect.height > 0) lastContentBottom = Math.max(lastContentBottom, rect.bottom + window.scrollY);
    }
    const nav = document.querySelector('.app-navigation-mobile');
    const navRect = nav?.getBoundingClientRect() ?? null;
    const tiles = Array.from(document.querySelectorAll('[data-home-station]'));
    const lastTile = tiles.length ? tiles[tiles.length - 1].getBoundingClientRect() : null;
    return {
      dockState: document.querySelector('.app-shell-v2')?.getAttribute('data-dock') ?? null,
      documentHeight: Math.round(document.documentElement.scrollHeight),
      lastContentBottom: Math.round(lastContentBottom),
      emptyTail: Math.round(document.documentElement.scrollHeight - lastContentBottom),
      navTop: navRect ? Math.round(navRect.top) : null,
      navVisible: Boolean(navRect && navRect.height > 0),
      lastTileBottom: lastTile ? Math.round(lastTile.bottom) : null,
      screenPaddingBottom: (() => {
        const screen = document.querySelector('.screen-home-next');
        return screen ? Math.round(parseFloat(getComputedStyle(screen).paddingBottom)) : null;
      })()
    };
  });

test.beforeEach(async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page);
  await page.setViewportSize({ width: 390, height: 844 });
});

test('nothing playing: the page does not reserve room for a dock that is not there', async ({ page }) => {
  await openHome(page);
  const before = await geometry(page);
  expect(before.dockState).toBe('none');

  // Assert the MECHANISM, not the aggregate: Home's own bottom padding is what
  // the dock reserve inflates. Measured in this fixture at 390x844 — 250px with
  // the reserve, 124px without. 200 fails if the reserve ever comes back and
  // does not fail on a few pixels of layout drift.
  expect(before.screenPaddingBottom).not.toBeNull();
  expect(before.screenPaddingBottom!).toBeLessThan(200);

  // The tail a listener actually scrolls through, as a coarser backstop: 342px
  // before this change, 216px after. The remaining 92px is NOT Home's — it sits
  // on the shared content container above it, is the same on every tab, and is
  // a separate change with a much wider blast radius.
  expect(before.emptyTail).toBeLessThan(240);
});

test('the last tile still clears the floating nav when scrolled to the bottom', async ({ page }) => {
  await openHome(page);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(400);

  const bottom = await geometry(page);
  // The contract the padding exists for. Trimming the dock's share must not
  // touch it: whatever is last on the page has to be readable, not tucked
  // under the navigation.
  expect(bottom.navVisible).toBe(true);
  expect(bottom.lastTileBottom).not.toBeNull();
  expect(bottom.navTop).not.toBeNull();
  expect(bottom.lastTileBottom!).toBeLessThanOrEqual(bottom.navTop!);
});

test('a listener with a station gets the dock reserve back', async ({ page }) => {
  await openHome(page, { playbackHistory: [stations[0]] });
  const idle = await geometry(page);

  await page.locator('[data-home-station]').first().click();
  await expect(page.locator('.app-shell-v2[data-dock="bar"]')).toBeAttached({ timeout: 15_000 });
  await page.waitForTimeout(600);
  const playing = await geometry(page);

  // Same page, one more fixed control over it, so the tail has to grow — this
  // is the half that proves the trim is conditional rather than just smaller.
  expect(playing.emptyTail).toBeGreaterThan(idle.emptyTail);
});

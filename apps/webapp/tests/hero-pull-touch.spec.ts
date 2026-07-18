import { expect, test } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState } from './helpers';

// Real TOUCH-device coverage for the hero pull-to-feed gesture.
//
// Why this file exists: the gesture's first implementation was DEAD ON TOUCH —
// Chromium's compositor cancels the pointer stream on a touch drag, so the
// pull never engaged on a phone, which is the primary target. Every other
// gesture test in this suite drives the mouse/pointer path, which cannot catch
// that class of bug. These drive real touch events over CDP on a touch-enabled
// context.
test.describe('pull-to-feed, touch device', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  const openHome = async (page: import('@playwright/test').Page) => {
    await installMediaMocks(page);
    await mockStations(page);
    await seedRadioState(page);
    await page.goto('/?api=/api');
    await expect(page.locator('[data-home-hero]')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => window.scrollTo(0, 0));
  };

  const dragOnHero = async (page: import('@playwright/test').Page, dy: number, steps = 14) => {
    const hero = page.locator('[data-home-hero]');
    const box = (await hero.boundingBox())!;
    const x = Math.round(box.x + box.width / 2);
    const y = Math.round(box.y + box.height * 0.45);
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y }]
    });
    for (let i = 1; i <= steps; i += 1) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y + Math.round((dy * i) / steps) }]
      });
      await page.waitForTimeout(16);
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(500);
  };

  test('A: a real downward touch drag on the hero opens the feed', async ({ page }) => {
    await openHome(page);
    await dragOnHero(page, 200);
    await expect(page.locator('.station-feed-overlay')).toBeVisible({ timeout: 4000 });
  });

  test('B: a short touch drag does NOT open the feed', async ({ page }) => {
    await openHome(page);
    await dragOnHero(page, 30);
    await expect(page.locator('.station-feed-overlay')).toHaveCount(0);
  });

  test('C: normal page scrolling still works and does not open the feed', async ({ page }) => {
    await openHome(page);
    // scroll DOWN the page (drag up) — must scroll, must not open the feed
    await dragOnHero(page, -260);
    const scrolled = await page.evaluate(() => window.scrollY);
    expect(scrolled, 'page must scroll when dragging up').toBeGreaterThan(0);
    await expect(page.locator('.station-feed-overlay')).toHaveCount(0);

    // and a downward drag while scrolled must scroll back, not open the feed
    await dragOnHero(page, 150);
    await expect(page.locator('.station-feed-overlay')).toHaveCount(0);
  });

  test('D: #86 — opening the feed by drag does not switch the playing station', async ({ page }) => {
    await installMediaMocks(page);
    await mockStations(page);
    await seedRadioState(page);
    await page.goto('/?api=/api');
    await expect(page.locator('[data-home-hero]')).toBeVisible({ timeout: 15_000 });

    await page.locator('[data-home-station] .home-station-primary-action').first().click();
    await expect(page.locator('.player-dock')).toBeVisible();
    const before = await page.evaluate(
      () => document.querySelector('.player-dock-title')?.textContent?.trim() || ''
    );

    await page.evaluate(() => window.scrollTo(0, 0));
    await dragOnHero(page, 200);
    await expect(page.locator('.station-feed-overlay')).toBeVisible({ timeout: 4000 });
    await page.waitForTimeout(1200);

    const after = await page.evaluate(
      () => document.querySelector('.player-dock-title')?.textContent?.trim() || ''
    );
    expect(after, 'opening the feed must not switch the station').toBe(before);
  });
});

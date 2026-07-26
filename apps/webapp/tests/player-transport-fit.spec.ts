import { expect, test } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState } from './helpers';

/**
 * The transport must FIT, at every width we ship to.
 *
 * 360px is the canonical Telegram webview, which means the `@media (max-width:
 * 380px)` block — not the 720px one — is what most listeners actually get. That
 * is easy to forget when styling at 400px in a desktop browser: the orb was
 * sized to 88px in the ≤720 block and silently overridden back to 64px on every
 * real phone.
 *
 * The stage is a fixed-height flex column with overflow:hidden, so growing a
 * control does not scroll — it CROPS, and a screenshot baseline happily records
 * the cropped result. Measure the geometry instead.
 */
for (const [width, height] of [
  [360, 780],
  [360, 640],
  [320, 640]
] as const) {
  test(`the transport and the stage foot fit at ${width}x${height}`, async ({ page }) => {
    await installMediaMocks(page);
    await mockStations(page);
    await page.setViewportSize({ width, height });
    await seedRadioState(page, { activeSection: 'search' });
    await page.goto('/?api=/api');

    await page.locator('#search-hero-input').first().fill('Tokyo');
    await expect(page.locator('[data-search-station-card]').first()).toBeVisible();
    await page.getByRole('button', { name: /Играть выдачу|Play results/ }).click();
    await expect(page.locator('.player-dock-bar')).toBeVisible();
    await page
      .locator('.player-dock-artwork-trigger')
      .evaluate((node) => (node as HTMLButtonElement).click());
    await expect(page.locator('[data-full-player-overlay]')).toBeVisible();
    await page.waitForTimeout(400);

    const geometry = await page.evaluate(() => {
      const controls = document.querySelector('.full-player-controls')!.getBoundingClientRect();
      const primary = document.querySelector('.full-player-primary-btn')!.getBoundingClientRect();
      const stage = document.querySelector('.full-player-main--stage')!.getBoundingClientRect();
      const foot = document.querySelector('.full-player-stage-foot')!.getBoundingClientRect();
      return {
        orb: Math.round(primary.width),
        orbIsRound: Math.abs(primary.width - primary.height) <= 1,
        overflowsLeft: controls.left < stage.left - 0.5,
        overflowsRight: controls.right > stage.right + 0.5,
        footBottom: Math.round(foot.bottom),
        viewportHeight: window.innerHeight
      };
    });

    expect(geometry.overflowsLeft, 'transport runs off the left edge').toBe(false);
    expect(geometry.overflowsRight, 'transport runs off the right edge').toBe(false);
    expect(geometry.orbIsRound, 'the primary control is not a circle').toBe(true);
    // A generous play target is the point of the redesign; guard the floor.
    expect(geometry.orb).toBeGreaterThanOrEqual(72);
    expect(geometry.footBottom).toBeLessThanOrEqual(geometry.viewportHeight);
  });
}

import { expect, test } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState } from './helpers';

/**
 * The mobile full player wants ~842px of stage on a 360x780 phone. Flexbox has to
 * take that shortfall out of something, and it used to take it out of the station
 * name: .full-player-hero was `flex: 0 0 auto` while .full-player-identity kept
 * the default `0 1 auto` AND carries `overflow: hidden`, so the identity block was
 * squeezed from the 143px it needed into 135px and the title's descenders were
 * sliced off mid-glyph. Measured on the regression: the h1 got a 18.9px box for a
 * 30.1px line.
 *
 * A screenshot baseline does not catch this - the crop looks like a font quirk,
 * and the diff is a handful of pixels. Assert the invariant directly: one line of
 * the title must always fit inside the title's own box.
 */
test.beforeEach(async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page);
});

for (const viewport of [
  { width: 360, height: 780, label: '360x780 Telegram webview' },
  { width: 360, height: 640, label: '360x640 short phone' }
]) {
  test(`the station title is never cropped at ${viewport.label}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
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

    const art = await page.evaluate(() => {
      const hero = document.querySelector('[data-full-player-overlay] .full-player-hero') as HTMLElement | null;
      if (!hero) return null;
      const r = hero.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });

    const title = await page.evaluate(() => {
      const h1 = document.querySelector('[data-full-player-overlay] h1') as HTMLElement | null;
      if (!h1) return null;
      const style = getComputedStyle(h1);
      return {
        text: h1.textContent,
        boxH: Math.round(h1.getBoundingClientRect().height * 100) / 100,
        lineBoxH: Math.round(parseFloat(style.lineHeight) * 100) / 100
      };
    });

    expect(title, 'the full player must render a station title').not.toBeNull();
    expect(
      title!.boxH,
      `"${title!.text}" got a ${title!.boxH}px box for a ${title!.lineBoxH}px line - the title is being cropped`
    ).toBeGreaterThanOrEqual(title!.lineBoxH - 0.5);

    // The hero is now sized off `height` so flex can shrink it, with
    // `aspect-ratio: 1` deriving the width. Any rule that ALSO sets `width`
    // silently defeats the aspect ratio and squashes the cover into a rectangle -
    // the short-screen block (max-height: 700px) did exactly that.
    expect(art, 'the full player must render hero artwork').not.toBeNull();
    expect(
      Math.abs(art!.w - art!.h),
      `hero artwork is ${art!.w}x${art!.h} - it must stay square`
    ).toBeLessThanOrEqual(1);
  });
}

import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

/**
 * The three glass tiers, asserted as contracts rather than looked at.
 *
 * This suite exists because of a specific silent failure. `?glass=off` is the
 * switch that answers "what do the backdrop-filters cost", and it was written
 * one class-weight too light to beat the `!important` blur declarations in the
 * lazily-loaded Home chunk. Measured against production 2026-08-29: with the
 * switch on, 71 of 141 backdrop-filters were still live. Nothing errored — the
 * page loaded, the app worked, and a measurement taken through the broken
 * switch said blur was innocent, which was acted on and was wrong. Blur was in
 * fact the dominant cost on a mid-range phone: -64% on the GPU compositor
 * thread and scroll input p99 from 311ms to 102ms once it really switched off.
 *
 * `scripts/assertGlassOverrideWins.mjs` checks the specificity arithmetic
 * statically. This checks the other half — that the rules match real elements
 * in a real browser — which arithmetic cannot.
 */

const openHome = async (page: Page, glass: 'full' | 'lite' | 'off') => {
  await seedRadioState(page, { playbackHistory: [stations[0]] });
  await page.goto(`/?api=/api&glass=${glass}`);
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.home-action-btn').first()).toBeVisible({ timeout: 15_000 });
};

/** Every element (and pseudo-element) currently painting a backdrop-filter. */
const activeBackdropFilters = (page: Page) =>
  page.evaluate(() => {
    let count = 0;
    for (const element of document.querySelectorAll('*')) {
      for (const pseudo of [null, '::before', '::after']) {
        const style = getComputedStyle(element, pseudo);
        const standard = style.backdropFilter;
        const prefixed = (style as CSSStyleDeclaration & { webkitBackdropFilter?: string })
          .webkitBackdropFilter;
        if ((standard && standard !== 'none') || (prefixed && prefixed !== 'none')) count += 1;
      }
    }
    return count;
  });

const playControlStyle = (page: Page) =>
  page.locator('.home-action-btn').first().evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      backdropFilter: style.backdropFilter,
      background: style.backgroundImage === 'none' ? style.backgroundColor : style.backgroundImage,
      backgroundColor: style.backgroundColor
    };
  });

test.beforeEach(async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page);
  await page.setViewportSize({ width: 390, height: 844 });
});

test('full is the drawn design: the play control is frosted', async ({ page }) => {
  await openHome(page, 'full');
  const style = await playControlStyle(page);
  // If this ever reads 'none', the tier below is not a tier — it is the app.
  expect(style.backdropFilter).toContain('blur');
});

test('off leaves NO backdrop-filter anywhere — that is the whole point of it', async ({ page }) => {
  await openHome(page, 'off');
  // Exactly zero. A diagnostic that disables "most" blurs cannot measure what
  // blur costs, and reports a confident wrong number instead of failing.
  expect(await activeBackdropFilters(page)).toBe(0);
});

test('lite flattens the repeated small controls', async ({ page }) => {
  await openHome(page, 'lite');
  const style = await playControlStyle(page);
  expect(style.backdropFilter).toBe('none');
});

test('lite SUBSTITUTES a plate, it does not merely delete the blur', async ({ page }) => {
  await openHome(page, 'lite');
  const style = await playControlStyle(page);

  // The design gives this control an almost invisible fill — rgba(255,255,255,
  // 0.035) — because the frost is what makes it readable over station artwork.
  // Deleting the blur and leaving that fill was measured to break it: plate
  // luminance stddev inside the 44px disc went from 0.033 (frosted) to 0.086,
  // i.e. raw photography competing with the glyph, and the play arrow sank into
  // bright images. So the tier owes this control a real plate.
  expect(style.background).not.toBe('none');
  const alpha = Number(/rgba?\([^)]*?,\s*([\d.]+)\s*\)/.exec(style.background)?.[1] ?? '1');
  expect(alpha).toBeGreaterThan(0.2);
});

test('lite leaves the big signature surfaces alone', async ({ page }) => {
  await openHome(page, 'lite');
  // Killing only the small repeated controls recovered the entire measured win
  // (-64% GPU compositor thread), so the large glass surfaces this product is
  // designed around cost effectively nothing and must not be flattened with
  // them. If this reaches 0 somebody has widened the tier into the design.
  expect(await activeBackdropFilters(page)).toBeGreaterThan(0);
});

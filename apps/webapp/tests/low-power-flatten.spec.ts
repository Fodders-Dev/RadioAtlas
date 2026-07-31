import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

// Regression guard for a pure-cascade bug: the low-power flatten policy
// (styles.css ~9925) strips backdrop-filter from the chrome surfaces with
// !important, but !important only decides ties against NON-important rivals.
// Several section-scoped glass rules also carry !important on backdrop-filter
// (they had to, to beat the normal-weight flatten policy at ~5605), so those
// pairs tie on importance and specificity breaks the tie. The Home topbar
// circles lost that tie —
//   .app-shell-v2[data-active-section='home'] .app-topbar-actions .nav-utility-btn
//   (screens/homeReference.css, (0,4,0))  vs  the policy's (0,3,0)
// — and kept a live blur+saturate+brightness+contrast pass on exactly the
// devices the mode exists to spare, while the box-shadow in the SAME policy
// block flattened normally (it had no !important rival). Nothing in the suite
// could see it: the markup, the layout and the screenshots are all identical
// either way. Only the computed style differs, so that is what we assert.
//
// This file is the reason a future glass override cannot quietly out-specify
// the policy again. If it fails, do not raise the override — raise the policy.

// Chromium exposes the alias as its own computed property. Both must be flat:
// a one-sided flatten is the shipped-twice bug #175 in reverse — blur alive in
// Telegram iOS, gone in Chrome, and no error anywhere.
const BACKDROP_PROPS = ['backdrop-filter', '-webkit-backdrop-filter'] as const;

// The exact selector list the policy block enumerates. Kept verbatim so a
// selector added there without a matching assertion here is an obvious diff.
const FLATTENED_SELECTORS = [
  '.glass-card',
  '.app-topbar-v2',
  '.player-dock-bar',
  '.player-dock-tray-panel',
  '.player-dock-tray',
  '.mobile-nav-item',
  '.app-navigation-mobile',
  '.nav-utility-btn'
] as const;

// Surfaces that are always on screen for the seeded Home at 360px. Asserting
// they were actually FOUND is what stops this test from passing vacuously if a
// class is renamed or the shell stops rendering them.
const ALWAYS_PRESENT = [
  '.glass-card',
  '.app-topbar-v2',
  '.nav-utility-btn',
  '.app-navigation-mobile',
  '.mobile-nav-item'
] as const;

type Sample = { selector: string; index: number; prop: string; value: string };

// hardwareConcurrency <= 4 is one of the four lowPower triggers in
// lib/deviceProfile.ts, and the only one that does not also flip
// prefers-reduced-motion — which would drag a dozen unrelated @media blocks
// into the result and make a passing assertion meaningless.
const forceLowPowerDevice = (page: Page) =>
  page.addInitScript(() => {
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      configurable: true,
      get: () => 2
    });
  });

// The control case has to be pinned too, or it silently inverts on any machine
// with four cores or less — and then it would assert glass on a shell that is
// legitimately in low-power mode.
const forceHighPowerDevice = (page: Page) =>
  page.addInitScript(() => {
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      configurable: true,
      get: () => 16
    });
    Object.defineProperty(navigator, 'deviceMemory', {
      configurable: true,
      get: () => 8
    });
  });

const readBackdropFilters = (page: Page, selectors: readonly string[]) =>
  page.evaluate(
    ({ selectorList, props }) => {
      const samples: Sample[] = [];
      const found: Record<string, number> = {};
      for (const selector of selectorList) {
        const elements = Array.from(document.querySelectorAll(selector));
        found[selector] = elements.length;
        elements.forEach((element, index) => {
          const computed = window.getComputedStyle(element);
          for (const prop of props) {
            samples.push({
              selector,
              index,
              prop,
              value: computed.getPropertyValue(prop).trim()
            });
          }
        });
      }
      return { samples, found };
    },
    { selectorList: [...selectors], props: [...BACKDROP_PROPS] }
  );

const openSeededHome = async (page: Page) => {
  await installMediaMocks(page);
  await mockStations(page);
  await seedRadioState(page, {
    activeSection: 'home',
    favorites: [stations[0]],
    recent: [stations[1]],
    stationCache: stations.slice(0, 4)
  });
  // 360px: below the 720px breakpoint, which is where the Home topbar
  // treatment that owns the losing !important rule actually applies.
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/?api=/api');
  await expect(page.locator('.app-topbar-actions .nav-utility-btn').first()).toBeVisible({
    timeout: 15_000
  });

  // WAIT FOR THE HOME CSS CHUNK, not just for the shell. screens/homeReference
  // .css rides along with the lazily-loaded Home screen, and the shell chrome —
  // topbar included — paints before that chunk arrives. Read the computed style
  // in that window and the losing rule is not in the cascade yet, so every
  // assertion here passes for the wrong reason: this test was green against the
  // known-broken CSS until this wait was added. `.home-quick-chip` is defined
  // only in homeReference.css, so its presence is the honest signal.
  await expect(page.locator('.screen-home-next .home-quick-chip').first()).toBeVisible({
    timeout: 15_000
  });
  // …and specifically wait for the rule that owns the losing !important to be in
  // the cascade. 48px comes from that exact block; without it the circle is the
  // shell's 44px. Geometry stands in for a declaration we cannot query directly.
  await expect(page.locator('.app-topbar-actions .nav-utility-btn').first()).toHaveCSS(
    'width',
    '48px'
  );
};

test.describe('low-power shell flatten', () => {
  test('every chrome surface computes backdrop-filter: none under data-low-power', async ({
    page
  }) => {
    await forceLowPowerDevice(page);
    await openSeededHome(page);

    // The fixture itself is load-bearing: if the device heuristic ever stops
    // treating 2 cores as low power, every assertion below would pass while
    // testing the ordinary high-power shell.
    await expect(page.locator('.app-shell-v2')).toHaveAttribute('data-low-power', 'true');

    const { samples, found } = await readBackdropFilters(page, FLATTENED_SELECTORS);

    for (const selector of ALWAYS_PRESENT) {
      expect(found[selector], `${selector} should be on screen`).toBeGreaterThan(0);
    }

    const unflattened = samples.filter(
      (sample) => sample.value !== '' && sample.value !== 'none'
    );
    expect(
      unflattened,
      `low-power mode must strip every backdrop-filter, still live: ${JSON.stringify(
        unflattened
      )}`
    ).toEqual([]);
  });

  test('the topbar / dock / nav plates keep their softer low-power shadow', async ({ page }) => {
    // The refinement block (styles.css ~10091) sits after the flatten block and
    // gives three plates a lighter shadow than the blanket 0 8px 16px. Both
    // blocks carry the same specificity weight on purpose, so the refinement
    // wins on source order alone — bump one without the other and it silently
    // loses. Nothing else would notice; this does.
    await forceLowPowerDevice(page);
    await openSeededHome(page);

    const shadow = await page.evaluate(() => {
      const topbar = document.querySelector('.app-topbar-v2');
      const nav = document.querySelector('.app-navigation-mobile');
      return {
        topbar: topbar ? window.getComputedStyle(topbar).boxShadow : null,
        nav: nav ? window.getComputedStyle(nav).boxShadow : null
      };
    });

    expect(shadow.topbar).toContain('6px 12px');
    expect(shadow.nav).toContain('6px 12px');
  });

  test('the same Home topbar circles DO carry glass on a normal device', async ({ page }) => {
    // The control. Without it the flatten assertion above could pass simply
    // because nobody puts a backdrop-filter on these elements any more, and the
    // guard would rot into a tautology.
    await forceHighPowerDevice(page);
    await openSeededHome(page);

    await expect(page.locator('.app-shell-v2')).toHaveAttribute('data-low-power', 'false');

    const { samples } = await readBackdropFilters(page, ['.app-topbar-actions .nav-utility-btn']);
    const live = samples.filter((sample) => sample.value.includes('blur('));

    expect(
      live.length,
      `expected glass on the Home topbar circles, got: ${JSON.stringify(samples)}`
    ).toBeGreaterThan(0);
  });
});

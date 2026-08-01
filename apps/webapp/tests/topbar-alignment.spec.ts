import { expect, test } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState } from './helpers';

// T_home_redesign_1 (sub-task B): the topbar settings + profile buttons used to
// render staggered because (a) the container was align-items: flex-start, and
// (b) the settings button overrode the base 20px icon column with 16px, so the
// inner svg was visibly smaller than profile's. Three CSS-only fixes in
// styles.css unify both:
//   1. .app-topbar-actions { align-items: center }
//   2. .app-topbar-actions > .nav-utility-btn { flex: 0 0 auto }
//   3. .mobile-settings-trigger no longer overrides grid-template-columns
//
// The relevant layout band is 431-980px wide:
//   - ≤430 → boot.css collapses both buttons to round icon-only 34×34
//     (display: grid, justify-items: center); they share a column, alignment
//     is moot.
//   - 431-980 → `.app-topbar-actions { grid-auto-flow: column }` puts them
//     side by side in the actual TOPBAR. This is the user-visible band where
//     the misalignment was reported.
//   - >980 → layout flips to a vertical SIDEBAR (`grid-auto-flow: row`,
//     `.nav-utility-btn { min-width: 180px }`); the buttons are intentionally
//     stacked vertically, so horizontal-baseline checks don't apply.
// The two viewports below sample the horizontal band at both ends.
const VIEWPORTS = [
  { label: 'tablet narrow (just above the ≤430 icon-only breakpoint)', width: 600, height: 900 },
  { label: 'tablet wide (just below the >980 sidebar breakpoint)', width: 900, height: 900 }
];

test.describe('T_home_redesign_1 topbar alignment', () => {
  test.beforeEach(async ({ page }) => {
    await installMediaMocks(page);
    await mockStations(page);
    await seedRadioState(page);
  });

  for (const vp of VIEWPORTS) {
    test(`settings + profile share a baseline and equal-sized icons @ ${vp.label}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/?api=/api');

      // Wait for the REAL Home, not the skeleton. `.mobile-settings-trigger`
      // is shell chrome and is visible while `.screen-skeleton-*` is still
      // shimmering, and the topbar is still growing at that point — measured
      // 43.4px -> 47.9px -> 48.0px over roughly 360ms after first paint.
      await expect(page.locator('[data-home-feed-entry]')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('.mobile-settings-trigger').first()).toBeVisible();
      await expect(page.locator('.app-topbar-primary-cta').first()).toBeVisible();

      // ⚠ Read every rect in ONE evaluate. This assertion used to call
      // settings.boundingBox() and profile.boundingBox() as two separate
      // protocol round-trips, so while the topbar was still settling it
      // sampled the two buttons at different instants and reported the layout
      // shift BETWEEN its own two reads as a misalignment. Measured at the
      // same moment: two-shot dy=1.234 while one-shot dy=0.000. That is the
      // whole of the flake — the buttons were never staggered.
      const readGeometry = () =>
        page.evaluate(() => {
          const settings = document.querySelector('.mobile-settings-trigger');
          const profile = document.querySelector('.app-topbar-primary-cta');
          if (!settings || !profile) return null;
          const settingsSvg = settings.querySelector('svg');
          const profileSvg = profile.querySelector('svg');
          if (!settingsSvg || !profileSvg) return null;
          const round = (value: number) => Math.round(value * 100) / 100;
          const sb = settings.getBoundingClientRect();
          const pb = profile.getBoundingClientRect();
          const ss = settingsSvg.getBoundingClientRect();
          const ps = profileSvg.getBoundingClientRect();
          return {
            dy: round(Math.abs(sb.y - pb.y)),
            svgDw: round(Math.abs(ss.width - ps.width)),
            svgDh: round(Math.abs(ss.height - ps.height)),
            // Part of the settle signature, not asserted on directly.
            heights: `${round(sb.height)}/${round(pb.height)}`
          };
        });

      // Settle: the same atomic reading twice in a row. Cheap, and it makes the
      // assertion describe the finished layout rather than a frame of it.
      let geometry = await readGeometry();
      await expect
        .poll(
          async () => {
            const next = await readGeometry();
            const stable = next !== null && JSON.stringify(next) === JSON.stringify(geometry);
            geometry = next;
            return stable;
          },
          { timeout: 10_000 }
        )
        .toBe(true);

      expect(geometry, 'topbar geometry').not.toBeNull();

      // Same top — center-aligned, no asymmetric flex-shrink.
      expect(geometry!.dy).toBeLessThanOrEqual(1);

      // Icons render at the same intrinsic size. Both buttons inherit
      // `.nav-utility-btn`'s 20px icon column post-fix, so the SVG bounding
      // boxes match.
      expect(geometry!.svgDw).toBeLessThanOrEqual(1);
      expect(geometry!.svgDh).toBeLessThanOrEqual(1);
    });
  }
});

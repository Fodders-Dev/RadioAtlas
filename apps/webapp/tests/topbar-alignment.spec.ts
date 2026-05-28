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

      const settings = page.locator('.mobile-settings-trigger').first();
      const profile = page.locator('.app-topbar-primary-cta').first();
      await expect(settings).toBeVisible({ timeout: 15_000 });
      await expect(profile).toBeVisible();

      const [settingsBox, profileBox] = await Promise.all([
        settings.boundingBox(),
        profile.boundingBox()
      ]);
      expect(settingsBox, 'settings boundingBox').not.toBeNull();
      expect(profileBox, 'profile boundingBox').not.toBeNull();

      // Same top within 1px — center-aligned, no asymmetric flex-shrink.
      expect(Math.abs(settingsBox!.y - profileBox!.y)).toBeLessThanOrEqual(1);

      // Icons render at the same intrinsic size. Both buttons inherit
      // `.nav-utility-btn`'s 20px icon column post-fix, so the SVG bounding
      // boxes match.
      const settingsSvg = await settings.locator('svg').first().boundingBox();
      const profileSvg = await profile.locator('svg').first().boundingBox();
      expect(settingsSvg, 'settings svg').not.toBeNull();
      expect(profileSvg, 'profile svg').not.toBeNull();
      expect(Math.abs(settingsSvg!.width - profileSvg!.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(settingsSvg!.height - profileSvg!.height)).toBeLessThanOrEqual(1);
    });
  }
});

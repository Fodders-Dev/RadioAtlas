import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

const viewports = [
  { name: 'phone-390x844', width: 390, height: 844 },
  { name: 'tablet-834x1112', width: 834, height: 1112 },
  { name: 'desktop-1440x900', width: 1440, height: 900 }
] as const;

const surfaces = [
  { name: 'Home', activeSection: 'home' as const, selector: '.calm-home' },
  { name: 'Library', activeSection: 'library' as const, selector: '.screen-library-v2' }
] as const;

for (const surface of surfaces) {
  for (const viewport of viewports) {
    test(`${surface.name} accessibility at ${viewport.name}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await mockStations(page);
      await installMediaMocks(page);
      await seedRadioState(page, {
        activeSection: surface.activeSection,
        favorites: stations.slice(0, 4),
        recent: stations.slice(0, 3),
        queue: stations.slice(0, 3),
        stationCache: stations
      });
      await page.goto('/?calm=1');

      const shell = page.locator('.app-shell-v2');
      await expect(shell).toHaveAttribute('data-calm', 'true');
      await expect(page.locator(surface.selector)).toBeVisible();

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const artifact = {
        surface: surface.name,
        viewport: `${viewport.width}x${viewport.height}`,
        url: page.url(),
        violations: results.violations
      };
      await testInfo.attach('accessibility-violations.json', {
        body: Buffer.from(JSON.stringify(artifact, null, 2)),
        contentType: 'application/json'
      });
      await testInfo.attach('screen.png', {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png'
      });
      if (surface.name === 'Home') {
        const lead = page.locator('.calm-story-lead');
        await testInfo.attach('calm-lead-caption.png', {
          body: await lead.screenshot(),
          contentType: 'image/png'
        });
        if (viewport.name === 'phone-390x844') {
          await page.evaluate(() => {
            document.documentElement.dataset.themeMode = 'dark';
          });
          await testInfo.attach('calm-lead-caption-dark-phone.png', {
            body: await lead.screenshot(),
            contentType: 'image/png'
          });
        }
      }

      expect(results.violations, JSON.stringify(artifact, null, 2)).toEqual([]);
    });
  }
}

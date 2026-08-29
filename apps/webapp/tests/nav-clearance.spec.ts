import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

/**
 * Every section, scrolled to its end, must leave its last content clear of the
 * floating navigation.
 *
 * This is the contract the bottom scroll padding exists for, and until now it
 * was only ever asserted on Home. That matters because the padding is currently
 * paid TWICE — `.app-shell-v2` reserves `--dock-offset-v2 + 8px` and every
 * screen reserves `--screen-bottom-safe-v2` on top, so a 72px nav is cleared
 * with 216px. Removing either half is only safe once something checks all four
 * surfaces, and "which screens rely on the shell's copy" is a sweep rather than
 * an assumption.
 *
 * So this spec exists first, and on purpose: it is the evidence any future trim
 * has to pass, and it is useful on its own even if nobody ever trims anything.
 */

const SECTIONS = ['home', 'search', 'globe', 'library'] as const;

const openApp = async (page: Page) => {
  await seedRadioState(page, { playbackHistory: [stations[0]] });
  await page.goto('/?api=/api&glass=full');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.app-navigation-mobile .mobile-nav-item').first()).toBeVisible({
    timeout: 15_000
  });
};

/**
 * The lowest thing a listener can actually read on this screen, and where the
 * nav starts. Read in ONE evaluate — two boundingBox() round-trips would be two
 * different moments, which is how a sibling spec ended up measuring its own
 * reads (#242).
 */
const clearance = (page: Page) =>
  page.evaluate(() => {
    const nav = document.querySelector('.app-navigation-mobile');
    const navRect = nav?.getBoundingClientRect() ?? null;
    // Candidates a listener is meant to reach: station rows/tiles and any
    // button. Purely decorative full-bleed layers (the globe canvas, scrims)
    // are excluded — they are SUPPOSED to run under the chrome.
    const nodes = Array.from(
      document.querySelectorAll(
        '[data-home-station], [data-station-row], .station-row, .home-station-tile, main button, main a'
      )
    );
    let lowest: { bottom: number; label: string } | null = null;
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      if (rect.height <= 0 || rect.width <= 0) continue;
      // Only things currently on screen: an element far below the fold is not
      // overlapped by anything.
      if (rect.top > window.innerHeight || rect.bottom < 0) continue;
      if (!lowest || rect.bottom > lowest.bottom) {
        lowest = {
          bottom: Math.round(rect.bottom),
          label: (node.className || '').toString().split(/\s+/).slice(0, 2).join(' ') || node.tagName
        };
      }
    }
    return {
      section: document.querySelector('.app-shell-v2')?.getAttribute('data-active-section') ?? null,
      navTop: navRect ? Math.round(navRect.top) : null,
      navVisible: Boolean(navRect && navRect.height > 0),
      lowest,
      atBottom:
        Math.abs(
          window.scrollY + window.innerHeight - document.documentElement.scrollHeight
        ) < 4
    };
  });

test.beforeEach(async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page);
  await page.setViewportSize({ width: 390, height: 844 });
});

for (const [index, section] of SECTIONS.entries()) {
  test(`${section}: the last reachable content clears the floating nav`, async ({ page }) => {
    await openApp(page);
    if (index > 0) {
      await page.locator('.app-navigation-mobile .mobile-nav-item').nth(index).click();
      await page.waitForTimeout(1200);
    }

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(500);

    const geometry = await clearance(page);
    expect(geometry.section).toBe(section);
    expect(geometry.navVisible).toBe(true);

    // A screen with nothing scrollable and nothing in the strip is not a
    // failure — but it is also not evidence, so say which it was.
    if (!geometry.lowest) {
      test.info().annotations.push({ type: 'note', description: `${section}: nothing measurable in view` });
      return;
    }
    expect(
      geometry.lowest.bottom,
      `${section}: "${geometry.lowest.label}" ends at ${geometry.lowest.bottom}, nav starts at ${geometry.navTop}`
    ).toBeLessThanOrEqual(geometry.navTop!);
  });
}

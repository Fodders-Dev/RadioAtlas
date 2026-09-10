import { test } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

test.skip(process.env.AIR_MEASURE !== '1', 'diagnostic');
test.use({ viewport: { width: 390, height: 748 } });

test('computed truth', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('radio:theme-current:v1', JSON.stringify('pastel'));
  });
  await mockStations(page);
  await installMediaMocks(page);
  await seedRadioState(page, {
    queue: [stations[0]],
    queueCurrentIndex: 0,
    stationCache: [stations[0]]
  });
  await page.goto('/?air2=1');
  await page.locator('[data-home-feed-entry]').waitFor({ state: 'visible' });
  await page.waitForTimeout(1200);

  const out = await page.evaluate(() => {
    const pick = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return { sel, missing: true };
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        sel,
        w: Math.round(r.width),
        bg: cs.backgroundColor,
        bgImage: cs.backgroundImage.slice(0, 48),
        border: cs.borderTopWidth + ' ' + cs.borderTopColor,
        shadow: cs.boxShadow.slice(0, 44),
        parentDisplay: el.parentElement ? getComputedStyle(el.parentElement).display : '?',
        parentCols: el.parentElement ? getComputedStyle(el.parentElement).gridTemplateColumns : '?'
      };
    };
    return {
      air2: document.documentElement.dataset.air2 || '(unset)',
      sheetCount: document.styleSheets.length,
      hasAir2Rule: Array.from(document.styleSheets).some((sheet) => {
        try {
          return Array.from(sheet.cssRules).some((r) => String((r as CSSStyleRule).selectorText || '').includes('data-air2'));
        } catch {
          return false;
        }
      }),
      navItem: pick('.mobile-nav-item'),
      navIcon: pick('.mobile-nav-item:not(.active) .mobile-nav-icon'),
      resume: pick('.home-station-tile-resume'),
      resumeList: pick('.home-resume-list')
    };
  });
  console.log(JSON.stringify(out, null, 2));
});

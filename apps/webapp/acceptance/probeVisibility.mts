/**
 * Which mechanisms actually background a page, so the app's own
 * `visibilitychange` fires?
 *
 * Measured rather than assumed, because two plausible ones do NOT:
 * headless keeps every page `visible`, and headed Playwright gives each page
 * its own WINDOW, so a second page taking focus never occludes the first.
 *
 *   npx tsx acceptance/probeVisibility.mts
 */
import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  headless: false,
  // ⚠ Playwright disables backgrounding by default for determinism, which is
  // precisely the behaviour this lane is about. Drop those three.
  ignoreDefaultArgs: [
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling'
  ]
});
const context = await browser.newContext();
const page = await context.newPage();
await page.goto('data:text/html,<title>subject</title><body>subject</body>');

// Record what the PAGE saw, not what we assume it saw.
await page.evaluate(() => {
  (window as unknown as { seen: string[] }).seen = [];
  document.addEventListener('visibilitychange', () => {
    (window as unknown as { seen: string[] }).seen.push(document.visibilityState);
  });
});

const state = () => page.evaluate(() => document.visibilityState);
const seen = () => page.evaluate(() => (window as unknown as { seen: string[] }).seen.join(','));

console.log('baseline           :', await state());

// 1. A second Playwright page taking the front.
const decoy = await context.newPage();
await decoy.goto('about:blank');
await decoy.bringToFront();
await page.waitForTimeout(1000);
console.log('after bringToFront :', await state(), '| events:', await seen());
await page.bringToFront();
await page.waitForTimeout(500);

// 2. A tab opened by the page itself, so it lands in the SAME window.
const [popup] = await Promise.all([
  page.waitForEvent('popup'),
  page.evaluate(() => window.open('about:blank', '_blank'))
]);
await popup.bringToFront();
await page.waitForTimeout(1000);
console.log('after same-window  :', await state(), '| events:', await seen());
await page.bringToFront();
await page.waitForTimeout(500);
await popup.close();

// 3. Minimising the window — what actually happens when an app goes away.
const cdp = await context.newCDPSession(page);
const { windowId } = (await cdp.send('Browser.getWindowForTarget')) as { windowId: number };
await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
await new Promise((r) => setTimeout(r, 1500));
console.log('after minimize     :', await state(), '| events:', await seen());
await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
await page.waitForTimeout(1000);
console.log('after restore      :', await state(), '| events:', await seen());

await browser.close();

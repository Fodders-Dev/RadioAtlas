// Swipe the dock sideways to walk the QUEUE — the owner's ask. The two safety
// cases below are the point of this file: #86 forbids the app switching station
// on its own, so a page scroll or a tap that merely starts on the dock must
// never advance it.
import { expect, test } from '@playwright/test';
import { installMediaMocks, installTelegramShim, mockStations, playHomeStation, seedRadioState, stations } from './helpers';

const setup = async (page: import('@playwright/test').Page) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installTelegramShim(page);
  await installMediaMocks(page);
  await mockStations(page);
  await seedRadioState(page, { queue: stations.slice(0, 3) });
  await page.goto('/');
  await playHomeStation(page, 'Tokyo FM');
  await page.waitForSelector('.player-dock-bar', { timeout: 20000 });
};

/** Real touch stream via CDP — a synthetic mouse drag would not prove anything. */
const touchDrag = async (page: import('@playwright/test').Page, from: {x:number;y:number}, to: {x:number;y:number}, steps = 6) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
  for (let i = 1; i <= steps; i += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }]
    });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
};

const currentStation = (page: import('@playwright/test').Page) =>
  page.locator('.player-dock-title').innerText();

test('swipe LEFT on the dock advances the queue', async ({ page }) => {
  await setup(page);
  const before = await currentStation(page);
  const box = (await page.locator('.player-dock-bar').boundingBox())!;
  const y = box.y + box.height / 2;
  await touchDrag(page, { x: box.x + box.width * 0.55, y }, { x: box.x + box.width * 0.12, y });
  await page.waitForTimeout(900);
  const after = await currentStation(page);
  expect(after).not.toBe(before);
});

test('a VERTICAL scroll that starts on the dock never changes the station (#86)', async ({ page }) => {
  await setup(page);
  const before = await currentStation(page);
  const box = (await page.locator('.player-dock-bar').boundingBox())!;
  const x = box.x + box.width * 0.5;
  await touchDrag(page, { x, y: box.y + box.height / 2 }, { x: x + 6, y: box.y - 180 });
  await page.waitForTimeout(700);
  const after = await currentStation(page);
  expect(after).toBe(before);
});

test('a TAP on the dock does not change the station', async ({ page }) => {
  await setup(page);
  const before = await currentStation(page);
  const box = (await page.locator('.player-dock-bar').boundingBox())!;
  await touchDrag(page, { x: box.x + box.width * 0.5, y: box.y + box.height / 2 }, { x: box.x + box.width * 0.5 + 3, y: box.y + box.height / 2 }, 2);
  await page.waitForTimeout(700);
  expect(await currentStation(page)).toBe(before);
});

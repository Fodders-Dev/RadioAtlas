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

const setupCalm = async (page: import('@playwright/test').Page, width = 390) => {
  await page.setViewportSize({ width, height: 844 });
  await installTelegramShim(page);
  await installMediaMocks(page);
  await mockStations(page);
  await seedRadioState(page, { queue: stations.slice(0, 3) });
  await page.goto('/?calm=1');
  await expect(page.locator('.calm-mini-info')).toContainText('Tokyo FM');
  await expect(page.locator('.calm-mini')).toHaveAttribute('data-status', 'idle');
};

const calmSwipe = async (page: import('@playwright/test').Page, direction: 'left' | 'right') => {
  const box = (await page.locator('.calm-mini-info').boundingBox())!;
  const from = box.x + box.width * (direction === 'left' ? 0.85 : 0.15);
  const to = box.x + box.width * (direction === 'left' ? 0.15 : 0.85);
  await touchDrag(page, { x: from, y: box.y + box.height / 2 }, { x: to, y: box.y + box.height / 2 });
};
const calmAudio = (page: import('@playwright/test').Page) => page.locator('audio').first();

test('calm mini: real touch walks next and previous from a restored station, stays collapsed and survives Feed', async ({ page }) => {
  await setupCalm(page);
  await calmSwipe(page, 'left');
  await expect(calmAudio(page)).toHaveAttribute('src', /osaka/);
  await expect(page.locator('.calm-mini')).toHaveAttribute('data-status', 'playing');
  await expect(page.locator('.station-feed-overlay')).toHaveCount(0);
  await calmSwipe(page, 'right');
  await expect(calmAudio(page)).toHaveAttribute('src', /tokyo/);
  await expect(page.locator('.station-feed-overlay')).toHaveCount(0);

  // An ordinary tap still opens Feed; returning mounts the swipe listeners again.
  await page.locator('.calm-mini-info').click();
  await expect(page.locator('.station-feed-overlay')).toBeVisible();
  await page.locator('.app-navigation-mobile').getByRole('button', { name: 'Главная', exact: true }).click();
  await expect(page.locator('.calm-mini-info')).toBeVisible();
  await calmSwipe(page, 'left');
  await expect(calmAudio(page)).toHaveAttribute('src', /osaka/);
  await expect(page.locator('.station-feed-overlay')).toHaveCount(0);
});

test('calm mini: scroll, short drag and cancel never switch or open Feed; controls stay separate', async ({ page }) => {
  await setupCalm(page);
  const info = (await page.locator('.calm-mini-info').boundingBox())!;
  const x = info.x + info.width / 2, y = info.y + info.height / 2;
  await touchDrag(page, { x, y }, { x: x + 5, y: y - 150 });
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 24, y, { steps: 4 });
  await page.mouse.up();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 80, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await cdp.detach();
  await expect(page.locator('.calm-mini-info')).toContainText('Tokyo FM');
  await expect(page.locator('.calm-mini')).toHaveAttribute('data-status', 'idle');
  await expect(page.locator('.station-feed-overlay')).toHaveCount(0);
  await expect(calmAudio(page)).not.toHaveAttribute('src', /stream/);

  await page.locator('.calm-mini-play').click();
  await expect(calmAudio(page)).toHaveAttribute('src', /tokyo/);
  const play = (await page.locator('.calm-mini-play').boundingBox())!;
  await touchDrag(page, { x: play.x + 22, y: play.y + 22 }, { x: play.x - 95, y: play.y + 22 });
  await expect(calmAudio(page)).toHaveAttribute('src', /tokyo/);
  await expect(page.locator('.station-feed-overlay')).toHaveCount(0);
});

test('calm mini: mouse drag and visible Next work at 320px, queue end does not random-pick', async ({ page }) => {
  await setupCalm(page, 320);
  const info = (await page.locator('.calm-mini-info').boundingBox())!;
  await page.mouse.move(info.x + info.width - 10, info.y + info.height / 2);
  await page.mouse.down();
  await page.mouse.move(info.x + 10, info.y + info.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(calmAudio(page)).toHaveAttribute('src', /osaka/);
  await expect(page.locator('.station-feed-overlay')).toHaveCount(0);
  await page.locator('.calm-mini-next').click();
  await expect(calmAudio(page)).toHaveAttribute('src', /kyoto/);
  await page.locator('.calm-mini-next').click();
  await expect(page.locator('.toast')).toContainText('В каталоге не нашлось рабочей станции');
  await expect(calmAudio(page)).toHaveAttribute('src', /kyoto/);
  for (const selector of ['.calm-mini-play', '.calm-mini-next']) {
    const box = (await page.locator(selector).boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

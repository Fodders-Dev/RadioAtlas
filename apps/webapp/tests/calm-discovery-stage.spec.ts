import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

const start = async (page: Page) => {
  await mockStations(page);
  await installMediaMocks(page);
};

test('cold Play seeds the whole visible discovery set', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await seedRadioState(page);
  await page.goto('/?calm=1');
  const stage = page.locator('[data-calm-discovery-stage]');
  const first = await stage.getAttribute('data-calm-offer');
  expect(await page.evaluate(() => document.querySelector('audio')?.getAttribute('src') ?? null)).toBeNull();
  await page.locator('[data-stage-play]').click();
  await expect(page.locator('[data-calm-player]')).toHaveAttribute('data-status', 'playing');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue?.sourceId)).toBe('home-calm');
  const queue = await page.evaluate(() => JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue);
  expect(queue.sourceId).toBe('home-calm');
  expect(queue.items.length).toBeGreaterThan(3);
  expect(queue.items[0].stationuuid).toBe(first);
});

test('rapid Next advances from the station currently buffering in a personal queue', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  const listenerQueue = stations.slice(0, 4);
  await seedRadioState(page, { queue: listenerQueue, queueCurrentIndex: 0, stationCache: listenerQueue });
  await page.goto('/?calm=1');
  await page.locator('[data-stage-play]').click();
  await expect(page.locator('[data-calm-player]')).toHaveAttribute('data-status', 'playing');
  await page.evaluate(() => {
    HTMLMediaElement.prototype.play = function () { return new Promise(() => {}); };
  });

  const next = page.locator('[data-stage-next]');
  await next.click();
  await expect(page.locator('[data-calm-discovery-stage]')).toHaveAttribute('data-calm-air', 'buffering');
  await next.click();
  await expect.poll(() => page.locator('[data-calm-discovery-stage]').getAttribute('data-calm-offer')).toBe(listenerQueue[2].stationuuid);
  await expect.poll(() => page.evaluate(() => {
    const queue = JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue;
    return { sourceId: queue?.sourceId, ids: queue?.items?.map((item: { stationuuid: string }) => item.stationuuid), index: queue?.currentIndex };
  })).toEqual({ sourceId: 'seeded-home', ids: listenerQueue.map((item) => item.stationuuid), index: 0 });
});

test('long place and station names wrap at 320px and reduced motion stays still', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await start(page);
  const longStation = {
    ...stations[0],
    stationuuid: 'fixture-long-radio',
    name: 'A Long Broadcast Name That Needs Two Lines',
    countrycode: '',
    country: 'United States of America and the Islands'
  };
  await seedRadioState(page, { queue: [longStation], queueCurrentIndex: 0, stationCache: [longStation] });
  await page.goto('/?calm=1');
  const stage = page.locator('[data-calm-discovery-stage]');
  await expect(stage).toBeVisible();
  await expect(stage).toHaveAttribute('data-calm-offer', longStation.stationuuid);
  await expect(page.locator('[data-stage-next]')).toHaveText(/Открывать новое/);
  await expect(page.locator('.calm-stage-country')).toContainText(longStation.country);
  await expect(page.locator('.calm-stage-station')).toContainText(longStation.name);
  const measured = await page.evaluate(() => {
    const country = document.querySelector<HTMLElement>('.calm-stage-country')!.getBoundingClientRect();
    const station = document.querySelector<HTMLElement>('.calm-stage-station')!.getBoundingClientRect();
    const next = document.querySelector<HTMLElement>('[data-stage-next]')!;
    const nextBox = next.getBoundingClientRect();
    return {
      width: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
      countryHeight: country.height,
      stationHeight: station.height,
      nextWidth: nextBox.width,
      nextHeight: nextBox.height,
      nextWhiteSpace: getComputedStyle(next).whiteSpace,
      countryAnimation: getComputedStyle(document.querySelector('.calm-stage-country')!).animationName
    };
  });
  expect(measured.width).toBeLessThanOrEqual(measured.viewport);
  expect(measured.countryHeight).toBeGreaterThan(44);
  expect(measured.stationHeight).toBeGreaterThan(17);
  expect(measured.nextWidth).toBeGreaterThanOrEqual(44);
  expect(measured.nextHeight).toBeGreaterThanOrEqual(44);
  expect(measured.nextWhiteSpace).toBe('normal');
  expect(measured.countryAnimation).toBe('none');
});

test('restored station stays paused through Globe and Feed navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await seedRadioState(page, { queue: [stations[0]], queueCurrentIndex: 0, stationCache: [stations[0]] });
  await page.goto('/?calm=1');
  const stage = page.locator('[data-calm-discovery-stage]');
  await expect(stage).toHaveAttribute('data-stage-status', 'paused');
  expect(await page.evaluate(() => document.querySelector('audio')?.getAttribute('src') ?? null)).toBeNull();

  await page.locator('[data-calm-entry="globe"]').click();
  await expect(page.locator('.app-shell-v2')).toHaveAttribute('data-active-section', 'globe');
  await page.locator('.app-navigation-mobile').getByRole('button', { name: 'Главная', exact: true }).click();
  await expect(stage).toBeVisible();
  await page.locator('[data-calm-entry="feed"]').click();
  await expect(page.locator('.station-feed-overlay')).toBeVisible();
  expect(await page.evaluate(() => document.querySelector('audio')?.getAttribute('src') ?? null)).toBeNull();
});

test('station details play keeps its position in the listener queue', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  const listenerQueue = stations.slice(0, 3);
  await seedRadioState(page, { queue: listenerQueue, queueCurrentIndex: 0, stationCache: listenerQueue });
  await page.goto('/?calm=1');
  const selected = listenerQueue[1];
  const row = page.locator(`[data-calm-live-station="${selected.stationuuid}"]`);
  await expect(row).toBeVisible();
  await row.locator('.calm-live-info').click();
  const source = page.locator(`[data-calm-source="${selected.stationuuid}"]`);
  await expect(source).toBeVisible();
  await source.locator('[data-source-play]').click();
  await expect.poll(() => page.evaluate(() => {
    const queue = JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue;
    return { sourceId: queue?.sourceId, ids: queue?.items?.map((item: { stationuuid: string }) => item.stationuuid), index: queue?.currentIndex };
  })).toEqual({ sourceId: 'seeded-home', ids: listenerQueue.map((item) => item.stationuuid), index: 1 });
});

test('the end of a personal queue offers a deliberate new deck', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await seedRadioState(page, { queue: [stations[0]], queueCurrentIndex: 0, stationCache: stations });
  await page.goto('/?calm=1');
  const before = stations[0].stationuuid;
  const next = page.locator('[data-stage-next]');
  await expect(next).toHaveText(/Открывать новое/);
  await next.click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue?.sourceId)).toBe('home-calm');
  await expect.poll(() => page.locator('[data-calm-discovery-stage]').getAttribute('data-calm-offer')).not.toBe(before);
});

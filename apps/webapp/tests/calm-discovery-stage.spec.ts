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
  const stageColors = await page.locator('.calm-stage-upnext').evaluate((el) => ({
    heading: getComputedStyle(el.querySelector('strong')!).color,
    source: getComputedStyle(el.querySelector('small')!).color
  }));
  expect(stageColors.heading).toBe('rgb(39, 59, 50)');
  expect(stageColors.source).toBe('rgb(82, 103, 91)');
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

test('country map is silent and explicit country Play installs that exact country snapshot', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  const listenerQueue = stations.slice(0, 4);
  await seedRadioState(page, { queue: listenerQueue, queueCurrentIndex: 0, stationCache: stations.slice(0, 8) });
  await page.goto('/?calm=1');
  const card = page.locator('[data-calm-country-card]').filter({ has: page.locator('[data-calm-country-map="Japan"]') }).first();
  const country = await card.getAttribute('data-calm-country');
  const expectedIds = stations.slice(0, 4).map((station) => station.stationuuid);
  expect(country).toBe('Japan');
  const originalQueue = await page.evaluate(() => JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue);
  await card.locator('[data-calm-country-map]').click();
  await expect(page.locator('.app-shell-v2')).toHaveAttribute('data-active-section', 'globe');
  expect(await page.evaluate(() => document.querySelector('audio')?.getAttribute('src') ?? null)).toBeNull();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue)).toEqual(originalQueue);

  await page.locator('.app-navigation-mobile').getByRole('button', { name: 'Главная', exact: true }).click();
  const countryCard = page.locator('[data-calm-country-card]').filter({ has: page.locator('[data-calm-country-play]') }).filter({ has: page.locator('[data-calm-country-map="Japan"]') }).first();
  await countryCard.locator('[data-calm-country-play]').click();
  await expect(page.locator('[data-calm-player]')).toHaveAttribute('data-status', 'playing');
  await expect.poll(() => page.evaluate(() => {
    const queue = JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue;
    return { sourceId: queue?.sourceId, ids: queue?.items?.map((item: { stationuuid: string }) => item.stationuuid) };
  })).toEqual({ sourceId: 'home-country', ids: expectedIds });
  const nextId = expectedIds[1];
  await page.locator('[data-stage-next]').click();
  await expect.poll(() => page.locator('[data-calm-discovery-stage]').getAttribute('data-calm-offer')).toBe(nextId);
});

test('explicit country switch skips browsing and advances between the two fixture countries', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  const japan = stations.slice(0, 4);
  const germany = stations.slice(4, 8);
  await seedRadioState(page, { queue: [japan[0]], queueCurrentIndex: 0, stationCache: [...japan, ...germany] });
  await page.goto('/?calm=1');
  const queueBeforeBrowse = await page.evaluate(() => JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue);
  await page.locator('[data-calm-country-map="Germany"]').click();
  await expect(page.locator('.app-shell-v2')).toHaveAttribute('data-active-section', 'globe');
  expect(await page.evaluate(() => document.querySelector('audio')?.getAttribute('src') ?? null)).toBeNull();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue)).toEqual(queueBeforeBrowse);

  await page.locator('.app-navigation-mobile').getByRole('button', { name: 'Главная', exact: true }).click();
  await page.locator('[data-calm-country-next]').click();
  await expect(page.locator('[data-calm-player]')).toHaveAttribute('data-status', 'playing');
  await expect.poll(() => page.locator('[data-calm-discovery-stage]').getAttribute('data-calm-offer')).toBe(germany[0].stationuuid);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue?.items?.map((item: { stationuuid: string }) => item.stationuuid))).toEqual(germany.map((station) => station.stationuuid));

  await page.locator('[data-calm-country-next]').click();
  await expect.poll(() => page.locator('[data-calm-discovery-stage]').getAttribute('data-calm-offer')).toBe(japan[0].stationuuid);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue?.items?.map((item: { stationuuid: string }) => item.stationuuid))).toEqual(japan.map((station) => station.stationuuid));
});

test('retry after a country stream failure retains the exact country deck', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  const germany = stations.slice(4, 8);
  await seedRadioState(page, { queue: [stations[0]], queueCurrentIndex: 0, stationCache: stations.slice(0, 8) });
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function () {
      const state = window as typeof window & { __allowCountryRetry?: boolean };
      if (!state.__allowCountryRetry) {
        this.dispatchEvent(new Event('error'));
        return Promise.reject(new Error('mock country stream failure'));
      }
      this.setAttribute('data-ra-state', 'playing');
      this.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    };
  });
  await page.goto('/?calm=1');
  await page.locator('[data-calm-country-card]').filter({ has: page.locator('[data-calm-country-map="Germany"]') }).locator('[data-calm-country-play]').click();
  await expect(page.locator('[data-calm-player]')).toHaveAttribute('data-status', 'error');
  await expect(page.locator('[data-stage-play]')).toHaveAttribute('aria-label', /Повторить/);
  await page.evaluate(() => { (window as typeof window & { __allowCountryRetry?: boolean }).__allowCountryRetry = true; });
  await page.locator('[data-stage-play]').click();
  await expect(page.locator('[data-calm-player]')).toHaveAttribute('data-status', 'playing');
  await expect.poll(() => page.evaluate(() => {
    const queue = JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue;
    return { sourceId: queue?.sourceId, ids: queue?.items?.map((item: { stationuuid: string }) => item.stationuuid) };
  })).toEqual({ sourceId: 'home-country', ids: germany.map((station) => station.stationuuid) });
});
test('country intent takes priority while its first station is buffering in the old queue', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  const listenerQueue = stations.slice(4, 8);
  await seedRadioState(page, { queue: listenerQueue, queueCurrentIndex: 0, stationCache: stations.slice(0, 8) });
  await page.goto('/?calm=1');
  const target = page.locator('[data-calm-country-card]').filter({ has: page.locator('[data-calm-country-play]') }).filter({ has: page.locator('[data-calm-country-map="Germany"]') }).first();
  const ids = stations.slice(4, 8).map((station) => station.stationuuid);
  expect(listenerQueue.map(station => station.stationuuid)).toContain(ids[0]);
  await page.evaluate(() => { HTMLMediaElement.prototype.play = function () { return new Promise(() => {}); }; });
  await target.locator('[data-calm-country-play]').click();
  await expect(page.locator('[data-calm-discovery-stage]')).toHaveAttribute('data-calm-air', 'buffering');
  await expect.poll(() => page.locator('[data-calm-discovery-stage]').getAttribute('data-calm-offer')).toBe(ids[0]);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue?.sourceId)).toBe('seeded-home');
  await page.locator('[data-stage-next]').click();
  await expect.poll(() => page.locator('[data-calm-discovery-stage]').getAttribute('data-calm-offer')).toBe(ids[1]);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue?.items?.map((item: { stationuuid: string }) => item.stationuuid))).toEqual(listenerQueue.map(item => item.stationuuid));
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
      viewport: document.documentElement.clientWidth,
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

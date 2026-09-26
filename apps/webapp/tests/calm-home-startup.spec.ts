import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

const catalogSummary = (items: typeof stations) => ({
  generatedAt: Date.now(),
  counts: { stations: items.length, countries: 1, languages: 1, genres: 1 },
  catalogPool: items,
  freshSignals: items,
  searchLaunch: items,
  sponsored: [],
  countrySpotlight: null,
  genreSpotlight: null,
  aroundTheWorld: null,
  moodRails: [],
  trending: [],
  topVoted: []
});

const observeLegacyHome = (page: Page) => page.addInitScript(() => {
  window.localStorage.removeItem('radio:catalog-cache:v1');
  indexedDB.deleteDatabase('radioatlas-catalog-cache');
  const win = window as typeof window & { __legacyHomeMounts?: number };
  win.__legacyHomeMounts = 0;
  const observer = new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches('.screen-home-next') || node.querySelector('.screen-home-next')) win.__legacyHomeMounts! += 1;
    }
  });
  observer.observe(document, { childList: true, subtree: true });
});

const legacyMountCount = (page: Page) => page.evaluate(() =>
  (window as typeof window & { __legacyHomeMounts?: number }).__legacyHomeMounts || 0
);

const attachReviewScreenshot = async (page: Page, testInfo: TestInfo, name: string) => {
  const image = await page.screenshot();
  const outputDir = resolve(testInfo.config.rootDir, '../../../output');
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, name), image);
  await testInfo.attach(name, { body: image, contentType: 'image/png' });
};

test('calm Home owns the first paint while the cold summary is pending', async ({ page }, testInfo) => {
  let releaseSummary!: () => void;
  let summaryStarted!: () => void;
  const held = new Promise<void>((resolve) => { releaseSummary = resolve; });
  const started = new Promise<void>((resolve) => { summaryStarted = resolve; });

  await observeLegacyHome(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await mockStations(page);
  await page.route('**/catalog/summary**', async (route) => {
    summaryStarted();
    await held;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(catalogSummary(stations)) });
  });
  await installMediaMocks(page);
  // Recreate a persisted paused listener so a cold first paint also preserves
  // the real reload context that exposed this regression.
  await seedRadioState(page, { queue: [stations[0]], stationCache: [stations[0]] });
  await page.goto('/?calm=1', { waitUntil: 'domcontentloaded' });
  await started;
  const restoredQueue = await page.evaluate(() => {
    const persisted = JSON.parse(window.localStorage.getItem('radio:player:v2') || 'null');
    return persisted?.queue?.items?.[persisted.queue.currentIndex]?.stationuuid || null;
  });
  expect(restoredQueue, 'the persisted paused listener remains selected during Home startup').toBe(stations[0].stationuuid);
  expect(await page.locator('audio').evaluateAll(elements => elements.every(element => {
    const audio = element as HTMLAudioElement;
    return audio.paused && audio.currentTime < 0.05;
  })), 'restoring the paused listener must not start audio').toBe(true);
  await expect(page.locator('[data-calm-home-startup]')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.screen-home-next, .home-feed-hero, .home-feed-entry')).toHaveCount(0);
  expect(await legacyMountCount(page), 'legacy Home must never mount during the gated cold request').toBe(0);
  await attachReviewScreenshot(page, testInfo, 'home-startup-loading.png');

  releaseSummary();
  await expect(page.locator('[data-calm-home]')).toBeVisible();
  expect(await legacyMountCount(page), 'legacy Home must not mount while Calm Home replaces startup').toBe(0);
});

test('settled empty calm Home offers retry and search, then opens the real catalogue', async ({ page }, testInfo) => {
  let summaries = 0;
  let retry = false;
  await observeLegacyHome(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await mockStations(page);
  await page.route('**/catalog/summary**', async (route) => {
    summaries += 1;
    const items = retry ? stations : [];
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(catalogSummary(items)) });
  });
  await page.route('**/catalog/search**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, nextCursor: null, facets: {} }) }));
  await installMediaMocks(page);
  await seedRadioState(page);
  await page.goto('/?calm=1');
  await expect(page.locator('[data-calm-home-startup]')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('[data-calm-home-startup]')).toContainText('Пока нет доступных станций');
  await attachReviewScreenshot(page, testInfo, 'home-startup-empty.png');
  retry = true;
  await page.locator('[data-calm-home-startup]').getByRole('button', { name: 'Повторить' }).click();
  await expect(page.locator('[data-calm-home]')).toBeVisible();
  expect(summaries).toBeGreaterThan(1);
  expect(await legacyMountCount(page)).toBe(0);
});

test('settled calm Home error offers retry and an explicit search route', async ({ page }, testInfo) => {
  let summaries = 0;
  let retry = false;
  await observeLegacyHome(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await mockStations(page);
  await page.route('**/catalog/summary**', async (route) => {
    summaries += 1;
    if (!retry) return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(catalogSummary(stations)) });
  });
  await page.route('**/catalog/search**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await page.route('**/catalog-fast.json', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.route('**/catalog-full.json', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  // Keep the offline fallback genuinely unavailable so the settled summary
  // failure reaches the calm recovery surface instead of changing the subject.
  await page.route('**/json/stations/search**', route => route.fulfill({ status: 503, body: 'unavailable' }));
  await page.route(/https:\/\/[^/]+\.api\.radio-browser\.info\//, route => route.fulfill({ status: 503, body: 'unavailable' }));
  await installMediaMocks(page);
  await seedRadioState(page);
  await page.goto('/?calm=1');
  await expect(page.locator('[data-calm-home-startup]')).toHaveAttribute('aria-busy', 'false', { timeout: 15000 });
  await expect(page.locator('[data-calm-home-startup]')).toContainText('Не удалось загрузить');
  await attachReviewScreenshot(page, testInfo, 'home-startup-error.png');
  await page.locator('[data-calm-home-startup]').getByRole('button', { name: 'Поиск' }).click();
  await expect(page.locator('[data-calm-search] h1')).toHaveText('Поиск');
  await page.locator('.app-navigation-mobile').getByRole('button', { name: 'Главная', exact: true }).click();
  await expect(page.locator('[data-calm-home-startup]')).toBeVisible();
  retry = true;
  await page.locator('[data-calm-home-startup]').getByRole('button', { name: 'Повторить' }).click();
  await expect(page.locator('[data-calm-home]')).toBeVisible();
  expect(summaries).toBeGreaterThan(1);
  expect(await legacyMountCount(page)).toBe(0);
});

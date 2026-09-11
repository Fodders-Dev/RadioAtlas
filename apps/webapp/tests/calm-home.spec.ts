import { expect, test, type Page, type Route } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations, waitForAnimationsToSettle } from './helpers';

// The calm Home in the A4 «Журнал» composition: one «Включай», stories over real
// catalogue filters with paged continuation, sources that open on the Globe,
// finds that never rebuild the screen.

const start = async (page: Page) => {
  await mockStations(page);
  await installMediaMocks(page);
  await seedRadioState(page);
};
const layout = (page: Page) => page.evaluate(() => ({
  offer: document.querySelector('[data-calm-offer]')?.getAttribute('data-calm-offer'),
  sections: [...document.querySelectorAll('.calm-section')].map(el => Math.round(el.getBoundingClientRect().top + window.scrollY)),
  width: document.documentElement.scrollWidth,
  viewport: window.innerWidth
}));
const audioSrc = (page: Page) => page.locator('audio').first().getAttribute('src');
// The journal cover rotates by day, so a story may be the lead or a rail card;
// open it wherever it sits today.
const openStory = async (page: Page, id: string) => {
  const lead = page.locator(`[data-calm-lead="${id}"] .calm-story-lead`);
  if (await lead.count()) await lead.click();
  else await page.locator(`[data-calm-story="${id}"]`).click();
};

// A catalogue big enough to page: 35 jazz stations in Germany, 35 electronic
// ones spread over small countries, plus the twelve fixture stations.
const catalogue = Array.from({ length: 70 }, (_, index) => ({
  ...stations[index % stations.length],
  stationuuid: 'atlas-' + index,
  name: 'Atlas fixture ' + index,
  tags: index < 35 ? 'jazz,ambient' : 'electronic,house',
  country: index < 35 ? 'Germany' : 'Country ' + Math.floor(index / 2),
  url: 'https://stream.example.com/atlas-' + index,
  url_resolved: 'https://stream.example.com/atlas-' + index,
  geo_lat: 50 + (index % 10) / 10,
  geo_long: 10 + (index % 10) / 10
}));
const night = catalogue.slice(0, 10);
const workout = catalogue.slice(35, 45);
const everything = [...catalogue, ...stations];

const richCatalogue = async (page: Page, options: { failFirstSearch?: boolean } = {}) => {
  await mockStations(page, { summaryHandler: route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      generatedAt: 1789000000000, counts: { stations: 82, countries: 12, languages: 3, genres: 4 },
      catalogPool: everything, freshSignals: stations, searchLaunch: catalogue,
      sponsored: [], countrySpotlight: null, genreSpotlight: null,
      aroundTheWorld: { label: 'Japan', stations: stations.filter(s => s.country === 'Japan') },
      moodRails: [{ id: 'mood-late-night', stations: night }, { id: 'mood-workout', stations: workout }]
    })
  }) });
  await page.route('**/catalog/stations/**', route => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() || '');
    const item = everything.find(s => s.stationuuid === id) || null;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ item }) });
  });
  await page.route('**/catalog/points**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    items: everything.map(s => ({ id: s.stationuuid, lat: s.geo_lat, lon: s.geo_long, country: s.country, state: s.state, name: s.name })),
    mappedStations: everything.length, totalStations: everything.length
  }) }));
  const requests: URLSearchParams[] = [];
  let failed = !options.failFirstSearch;
  await page.route('**/catalog/search**', (route: Route) => {
    const params = new URL(route.request().url()).searchParams;
    requests.push(params);
    if (!failed) { failed = true; return route.fulfill({ status: 502, body: '{}' }); }
    const pool = params.get('mood') === 'mood-workout' ? catalogue.slice(35)
      : params.get('mood') === 'mood-late-night' ? catalogue.slice(0, 35)
      : everything.filter(s => (!params.get('country') || s.country === params.get('country')) && (!params.get('tag') || s.tags.includes(params.get('tag')!)));
    const cursor = Number(params.get('cursor') || 0), limit = Number(params.get('limit') || 30);
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      items: pool.slice(cursor, cursor + limit), total: pool.length,
      nextCursor: cursor + limit < pool.length ? String(cursor + limit) : null,
      facets: { countries: [...new Set(everything.map(s => s.country))], tags: [], languages: [] }
    }) });
  });
  await installMediaMocks(page);
  return requests;
};

for (const width of [320, 390, 411]) for (const theme of ['journal', 'aurora-field']) {
  test(`calm ${width} ${theme}: play and capture keep Home in place`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await start(page);
    if (theme !== 'journal') await page.addInitScript(id => localStorage.setItem('radio:theme-current:v1', JSON.stringify(id)), theme);
    // A denied clipboard must still leave the find in the real library store.
    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } }));
    await page.goto('/?calm=1');
    await expect(page.locator('[data-calm-home]')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('[data-calm-player]')).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await waitForAnimationsToSettle(page, '.app-screen-frame');
    const before = await layout(page);
    expect(before.width).toBeLessThanOrEqual(before.viewport);
    // The recommendation «Включай» starts is the first visible starter row.
    await expect(page.locator('.calm-starters .calm-station-row').first()).toHaveAttribute('data-station-row', before.offer!);
    await page.locator('.calm-primary').click();
    const dock = page.locator('[data-calm-player]');
    await expect(dock).toHaveAttribute('data-status', 'playing');
    await expect(dock.locator('.calm-capture')).toBeVisible();
    // This is a UI-state mock. It does not prove audio progression on iPhone.
    const source = await audioSrc(page);
    await dock.locator('.calm-capture').click();
    await expect(dock.locator('.calm-capture')).toHaveAttribute('aria-pressed', 'true');
    // Mutation: removing copyTrack() from the capture handler must fail here.
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('radio:library:v2') || '{}').trackHistory?.length || 0)).toBe(1);
    const find = await page.evaluate(() => JSON.parse(localStorage.getItem('radio:library:v2') || '{}').trackHistory[0]);
    expect(find.stationId).toBe(before.offer);
    expect(find.track).toBeTruthy();
    expect(find.timestamp).toBeGreaterThan(0);
    expect(await layout(page)).toEqual(before);
    expect(await audioSrc(page)).toBe(source);
    await expect(dock).toHaveAttribute('data-status', 'playing');
    const geometry = await dock.evaluate(el => {
      const box = el.getBoundingClientRect();
      const nav = document.querySelector('.app-navigation-mobile')!.getBoundingClientRect();
      return { height: box.height, bottom: box.bottom, navTop: nav.top, targets: [...el.querySelectorAll('button')].map(b => [b.getBoundingClientRect().width, b.getBoundingClientRect().height]) };
    });
    expect(geometry.height).toBeLessThanOrEqual(82);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.navTop);
    for (const [w, h] of geometry.targets) { expect(w).toBeGreaterThanOrEqual(44); expect(h).toBeGreaterThanOrEqual(44); }
    // Every visible Home control clears the touch floor.
    const small = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.calm-home button')].filter(b => b.offsetParent).map(b => [b.getAttribute('aria-label') || b.textContent?.trim().slice(0, 30), b.getBoundingClientRect().width, b.getBoundingClientRect().height] as const).filter(([, w, h]) => w < 44 || h < 44));
    expect(small).toEqual([]);
    await page.screenshot({ path: `../../output/playwright/calm/real-${width}-${theme}.png` });
    await dock.getByRole('button', { name: 'Пауза', exact: true }).click();
    await expect(dock.locator('[data-live="true"]')).toHaveCount(0);
    await page.locator('.calm-find').scrollIntoViewIfNeeded();
    const lastRow = await page.locator('.calm-find').boundingBox();
    const playerBox = await dock.boundingBox();
    expect(lastRow!.y + lastRow!.height).toBeLessThanOrEqual(playerBox!.y);
    await page.locator('.calm-find').click();
    await expect(page.locator('.app-shell-v2')).toHaveAttribute('data-active-section', 'library');
  });
}

test('restored station opens the feed without starting playback, from the mini player and from the nav', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockStations(page); await installMediaMocks(page);
  await seedRadioState(page, { queue: [stations[0]], queueCurrentIndex: 0, stationCache: [stations[0]] });
  await page.goto('/?calm=1');
  const dock = page.locator('[data-calm-player]');
  await expect(dock).toBeVisible();
  await expect(dock.locator('[data-live="true"]')).toHaveCount(0);
  await expect(dock.locator('.calm-capture')).toHaveCount(0);
  await dock.locator('.calm-mini-info').click();
  await expect(page.locator('.station-feed-overlay')).toHaveAttribute('data-feed-player', 'true');
  await expect(page.locator('.station-feed-card').first()).toHaveAttribute('data-feed-station', stations[0].stationuuid);
  await expect(page.locator('.station-feed-card-content[data-focus="true"] .calm-feed-status')).toHaveAttribute('data-status', 'paused');
  await expect(page.locator('.app-shell-v2')).toHaveAttribute('data-winamp-expanded', 'false');
  await expect(dock).toHaveCount(0);
  await page.locator('.station-feed-close').click();
  // The nav's «Лента» is the same entry: the restored station, still silent.
  await page.locator('.app-navigation-mobile').getByRole('button', { name: 'Лента', exact: true }).click();
  await expect(page.locator('.station-feed-card').first()).toHaveAttribute('data-feed-station', stations[0].stationuuid);
  await expect(page.locator('.station-feed-card-content[data-focus="true"] .calm-feed-status')).toHaveAttribute('data-status', 'paused');
  expect(await page.locator('.calm-feed-status[data-status="playing"]').count()).toBe(0);
});

test('feed player captures, keeps the shared sleep timer and switches by deliberate paging', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await start(page);
  await page.goto('/?calm=1'); await page.locator('.calm-primary').click();
  await expect(page.locator('[data-calm-player]')).toHaveAttribute('data-status', 'playing');
  const source = await audioSrc(page);
  await page.locator('.calm-mini-info').click();
  const feed = page.locator('.station-feed-overlay');
  await expect(feed).toBeVisible();
  await waitForAnimationsToSettle(page, '.station-feed-overlay');
  expect(await audioSrc(page)).toBe(source);
  const first = page.locator('.station-feed-card').first();
  await expect(first.locator('.calm-feed-status')).toHaveAttribute('data-status', 'playing');
  await expect(first.locator('.calm-feed-track')).toHaveAttribute('data-feed-track', 'live');
  await first.locator('[data-feed-action="capture"]').click();
  await expect(first.locator('[data-feed-action="capture"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.station-feed-timer').click();
  const tools = page.locator('.feed-player-tools');
  await expect(tools).toBeVisible();
  await tools.getByRole('button', { name: '15 мин', exact: true }).click();
  await expect(tools.getByRole('button', { name: '15 мин', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(tools.locator('.feed-tools-heading output')).not.toHaveText('0:00');
  await tools.getByRole('slider').focus(); await page.keyboard.press('ArrowLeft');
  expect(await audioSrc(page)).toBe(source);
  await page.screenshot({ path: '../../output/playwright/calm/feed-tools.png' });
  await tools.locator('.feed-tools-close').click();
  await expect(tools).toHaveCount(0);
  await expect(page.locator('.station-feed-timer')).toContainText('14:');
  await page.screenshot({ path: '../../output/playwright/calm/feed-player.png' });
  // The real pager path: a deliberate step settles and starts card 1.
  await page.locator('.calm-feed-stepper button').last().click();
  await expect.poll(() => audioSrc(page)).not.toBe(source);
  await expect(page.locator('.station-feed-card-content[data-focus="true"] .calm-feed-status')).toHaveAttribute('data-status', 'playing');
  await page.locator('.station-feed-close').click();
  await expect(page.locator('[data-calm-player]')).toHaveAttribute('data-status', 'playing');
  await page.locator('.calm-mini-info').click();
  await page.locator('.station-feed-timer').click();
  await expect(tools.getByRole('button', { name: '15 мин', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await tools.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(tools.locator('.feed-tools-heading output')).toHaveText('Выкл');
});

test('journal Home: a story pages the real catalogue, a source opens on the Globe, and nothing switches the air', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requests = await richCatalogue(page);
  await seedRadioState(page, { stationCache: catalogue });
  await page.goto('/?calm=1');
  await expect(page.locator('[data-calm-home]')).toBeVisible();
  await page.locator('.calm-primary').click();
  await expect(page.locator('[data-calm-player]')).toHaveAttribute('data-status', 'playing');
  const source = await audioSrc(page);

  // The cover rotates by day among stories with loaded stations, so the jazz
  // story is opened wherever it sits today. Its sheet starts with loaded
  // sources and continues from the catalogue, page by page.
  await expect(page.locator('[data-calm-lead]')).toBeVisible();
  await openStory(page, 'jazz');
  const sheet = page.locator('[data-calm-browse="jazz"]');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.calm-station-row')).toHaveCount(3);
  await expect(sheet.locator('.calm-destination')).toHaveCount(6);
  await sheet.locator('.calm-more').click();
  await expect(sheet.locator('.calm-destination')).toHaveCount(30);
  await sheet.locator('.calm-more').click();
  await expect(sheet.locator('.calm-destination')).toHaveCount(35);
  await expect(sheet.locator('.calm-more')).toHaveCount(0);
  const jazzSeeds = requests.filter(q => q.get('tag') === 'jazz').map(q => q.get('seed'));
  expect(jazzSeeds.length).toBe(2);
  expect(new Set(jazzSeeds).size).toBe(1);
  expect(await audioSrc(page)).toBe(source);

  // A row's name opens the source; «Показать на карте» lands on its dot.
  const row = sheet.locator('.calm-station-row').first();
  const rowId = (await row.getAttribute('data-station-row'))!;
  await row.locator('.calm-source-open').click();
  const sourceSheet = page.locator(`[data-calm-source="${rowId}"]`);
  await expect(sourceSheet).toBeVisible();
  await expect(sourceSheet.locator('[data-source-favorite]')).toHaveAttribute('aria-pressed', 'false');
  await sourceSheet.locator('[data-source-favorite]').click();
  await expect(sourceSheet.locator('[data-source-favorite]')).toHaveAttribute('aria-pressed', 'true');
  await sourceSheet.locator('[data-source-map]').click();
  await expect(page.locator('.app-shell-v2')).toHaveAttribute('data-active-section', 'globe');
  await expect(page.locator('[data-globe-explorer]')).toHaveAttribute('data-ready', 'true', { timeout: 20_000 });
  await expect(page.locator('[data-selected-station]')).toHaveAttribute('data-selected-station', rowId);
  expect(await audioSrc(page)).toBe(source);

  // Back on Home the visit is intact: a genre chip opens its own sheet; the
  // mood story from the server rail opens with that rail's stations.
  await page.locator('.app-navigation-mobile').getByRole('button', { name: 'Главная', exact: true }).click();
  await expect(page.locator('[data-calm-home]')).toBeVisible();
  await openStory(page, 'mood-workout');
  const workoutSheet = page.locator('[data-calm-browse="mood-workout"]');
  await expect(workoutSheet.locator('.calm-station-row').first()).toHaveAttribute('data-station-row', workout[0].stationuuid);
  await workoutSheet.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.locator('.calm-chips').getByRole('button', { name: 'ELECTRONIC', exact: true }).click();
  await expect(page.locator('[data-calm-browse="electronic"] .calm-destination').first()).toBeVisible();
  await page.locator('[data-calm-browse="electronic"]').getByRole('button', { name: 'Закрыть', exact: true }).click();
  // The country of the day continues on the Globe at the same place.
  await expect(page.locator('[data-calm-around]')).toContainText('Japan');
  await page.locator('[data-calm-country-map]').first().click();
  await expect(page.locator('.app-shell-v2')).toHaveAttribute('data-active-section', 'globe');
  await expect(page.locator('.explorer-title strong')).toHaveText('Germany', { timeout: 20_000 });
  expect(await audioSrc(page)).toBe(source);
});

test('a failed catalogue page shows a retry inside the story and keeps the air', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await richCatalogue(page, { failFirstSearch: true });
  await seedRadioState(page, { stationCache: catalogue });
  await page.goto('/?calm=1');
  await page.locator('.calm-primary').click();
  await expect(page.locator('[data-calm-player]')).toHaveAttribute('data-status', 'playing');
  const source = await audioSrc(page);
  await openStory(page, 'jazz');
  const sheet = page.locator('[data-calm-browse="jazz"]');
  await sheet.locator('.calm-more').click();
  await expect(sheet.locator('.calm-shelf-footer')).toContainText('Не удалось загрузить');
  await expect(sheet.locator('.calm-destination')).toHaveCount(6);
  await sheet.locator('.calm-more').click();
  await expect(sheet.locator('.calm-destination')).toHaveCount(30);
  await sheet.locator('.calm-more').click();
  await expect(sheet.locator('.calm-destination')).toHaveCount(35);
  expect(await audioSrc(page)).toBe(source);
});

test('an explicit Classic stays Classic in the calm preview; only «never chose» opens on «Журнал»', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await page.goto('/?calm=1');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'journal');
  // Theme Studio: pick Classic through the real UI, not by writing storage.
  await page.locator('.calm-journal-heading').getByRole('button', { name: 'Оформление', exact: true }).click();
  const studio = page.locator('[data-theme-studio]');
  await expect(studio).toBeVisible();
  await studio.locator('[data-theme-card="classic"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'classic');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('radio:theme-chosen:v1'))).toBe('true');
  await page.reload();
  await expect(page.locator('[data-calm-home]')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'classic');
});

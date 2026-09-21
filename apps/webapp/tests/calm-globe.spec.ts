import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

// The calm Globe (A4 «Журнал»): sources on a map, playback only from an explicit
// Play, the list stable until «Искать здесь». Points come from the fixture
// stations' REAL coordinates; nothing here invents a position.

const points = () =>
  JSON.stringify({
    items: stations.map((s) => ({ id: s.stationuuid, lat: s.geo_lat, lon: s.geo_long, country: s.country, state: s.state, name: s.name })),
    mappedStations: stations.length,
    totalStations: stations.length
  });

const start = async (page: Page) => {
  await mockStations(page);
  await installMediaMocks(page);
  await seedRadioState(page);
  await page.route('**/catalog/points**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: points() }));
  // helpers.ts answers every by-id lookup with stations[0]; the Globe resolves
  // the row the listener picked, so answer by id.
  await page.route('**/catalog/stations/**', (route) => {
    const id = decodeURIComponent(route.request().url().split('/catalog/stations/')[1].split(/[?#]/)[0]);
    const item = stations.find((s) => s.stationuuid === id) || null;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ item }) });
  });
};

const openGlobe = async (page: Page) => {
  await page.goto('/?calm=1');
  await page.locator('.app-navigation-mobile').getByRole('button', { name: /Глобус|Globe/ }).click();
  const explorer = page.locator('[data-globe-explorer]');
  await expect(explorer).toHaveAttribute('data-ready', 'true', { timeout: 20_000 });
  await expect(page.locator('.explorer-map[data-globe-warmup="done"]')).toHaveCount(1, { timeout: 20_000 });
  return explorer;
};

const audioSrc = (page: Page) => page.evaluate(() => document.querySelector('audio')?.getAttribute('src') || null);

test('calm globe: city-level sources are visible and labelled without claiming a studio address', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  const cityLocation = { name: 'Moscow', lat: 55.75204, lon: 37.61781, geonameId: 524901 };
  await page.route('**/catalog/points**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    items: [
      { id: 'city-a', country: 'Russia', state: 'Moscow', name: 'City Radio A', cityLocation },
      { id: 'city-b', country: 'Russia', state: 'Москва', name: 'City Radio B', cityLocation },
      { id: 'unknown', country: 'Russia', name: 'Unknown Place' }
    ], mappedStations: 0, totalStations: 3
  }) }));
  await page.route('**/catalog/stations/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    item: { ...stations[0], stationuuid: 'city-a', name: 'City Radio A', country: 'Russia', state: 'Moscow', geo_lat: null, geo_long: null }
  }) }));
  await openGlobe(page);
  await expect(page.locator('[data-result-count]')).toHaveText('2 эфира');
  await expect(page.locator('.explorer-row').first()).toContainText('по городу');
  await page.locator('.explorer-row-name').first().click();
  await expect(page.locator('.source-preview-title')).toContainText('Moscow · по городу');
  expect(await audioSrc(page)).toBeNull();
  await page.locator('[data-selected-play]').click();
  await expect.poll(() => audioSrc(page)).toBe(stations[0].url_resolved);
});
const panelHeight = (page: Page) => page.locator('.explorer-panel').evaluate((el) => Math.round(el.getBoundingClientRect().height));
const assertTargets = async (page: Page) => {
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.screen-globe-explorer button')]
      .filter((b) => b.offsetParent)
      .map((b) => [b.getAttribute('aria-label') || b.textContent?.trim(), b.getBoundingClientRect().width, b.getBoundingClientRect().height] as const)
      .filter(([, w, h]) => w < 44 || h < 44)
  );
  expect(small, 'every visible control must be at least 44px').toEqual([]);
};

test('calm globe: country list, selection, explicit play, heart and find', async ({ page }) => {
  // One journey end to end: two real MapLibre drags with inertia, a country
  // flight and a details toggle. Measured serially at 13s green on a fast box
  // and 23s while a defect made a step retry, so the default 30s budget leaves
  // a 2-core runner nothing (same reasoning as globe-drag.spec.ts).
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  const explorer = await openGlobe(page);

  // Three fixture countries tie at four located stations; the largest-first
  // order falls back to the name, so a cold open lands on Brazil. Nothing plays.
  await expect(page.locator('.explorer-title strong')).toHaveText('Brazil');
  await expect(page.locator('[data-result-count]')).toHaveText('4 эфира');
  await expect(page.locator('.explorer-row')).toHaveCount(4);
  expect(await audioSrc(page)).toBeNull();
  expect(await panelHeight(page)).toBe(192);
  await assertTargets(page);

  // Name → the compact card (140px), the map keeps the deck clear, still silent.
  const first = page.locator('.explorer-row').first();
  const firstName = (await first.locator('strong').textContent())!.trim();
  await first.locator('.explorer-row-name').click();
  const card = page.locator('[data-selected-station]');
  await expect(card).toBeVisible();
  await expect(card.locator('.source-preview-title strong')).toHaveText(firstName);
  await expect.poll(() => panelHeight(page)).toBe(140);
  expect(await audioSrc(page)).toBeNull();
  await assertTargets(page);

  // Play is explicit. The station on air is the one the card shows.
  await card.locator('[data-selected-play]').click();
  const selectedId = (await card.getAttribute('data-selected-station'))!;
  const fixture = stations.find((s) => s.stationuuid === selectedId)!;
  await expect.poll(() => audioSrc(page)).toBe(fixture.url_resolved);
  await expect(page.locator('[data-calm-player]')).toHaveAttribute('data-status', 'playing');
  await expect(card.locator('.source-preview-title small')).toContainText('слушаем');
  const geometry = await page.evaluate(() => ({
    panelBottom: document.querySelector('.explorer-panel')!.getBoundingClientRect().bottom,
    miniTop: document.querySelector('[data-calm-player]')!.getBoundingClientRect().top
  }));
  expect(geometry.panelBottom, 'the card must clear the mini player').toBeLessThanOrEqual(geometry.miniTop);

  // Heart keeps the SOURCE — the real catalogue row, in the real library.
  await card.locator('[data-source-favorite]').click();
  await expect(card.locator('[data-source-favorite]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('radio:library:v2') || '{}').favorites?.map((f: { stationuuid: string }) => f.stationuuid) || [])).toContain(selectedId);

  // Details open by button: the live track and the bookmark for the FIND.
  await card.locator('[data-source-details]').click();
  await expect(explorer).toHaveAttribute('data-panel', 'expanded');
  await expect.poll(() => panelHeight(page)).toBe(276);
  const find = card.locator('[data-source-find]');
  await expect(find).toBeVisible();
  await expect(find.locator('strong')).toHaveText('Mock Song');
  await find.locator('.source-capture').click();
  await expect(find.locator('.source-capture')).toHaveAttribute('aria-pressed', 'true');
  // Mutation: dropping copyTrack() from the bookmark must fail here.
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('radio:library:v2') || '{}').trackHistory?.length || 0)).toBe(1);
  expect(await audioSrc(page), 'saving a find never touches the air').toBe(fixture.url_resolved);
  await expect(card).toBeVisible();

  // Details close by a downward drag on the heading; the click that ends the
  // drag is swallowed, and the air is untouched either way.
  const title = card.locator('.source-preview-title');
  const box = (await title.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + box.height / 2 + 90, { steps: 6 });
  await page.mouse.up();
  await expect(explorer).toHaveAttribute('data-panel', 'normal');
  await expect(card).toBeVisible();
  expect(await audioSrc(page)).toBe(fixture.url_resolved);

  // Back to the list: the station on air is marked and offers Pause.
  await card.locator('[data-back-to-list]').click();
  await expect(page.locator('.explorer-row[data-active] strong')).toHaveText(firstName);
  await expect(page.locator('.explorer-row[data-active] .explorer-row-play')).toHaveAttribute('aria-label', 'Пауза');

  // World and another country: the list follows, the air does not.
  await page.locator('.explorer-world').click();
  await expect(page.locator('.explorer-title strong')).toHaveText('Весь мир');
  await expect(page.locator('[data-result-count]')).toHaveText(`${stations.length} эфиров`);
  await page.locator('.explorer-country-switch').click();
  await page.locator('.calm-country-options button', { hasText: 'Japan' }).click();
  await expect(page.locator('.explorer-title strong')).toHaveText('Japan');
  await expect(page.locator('.explorer-row')).toHaveCount(4);
  expect(await audioSrc(page)).toBe(fixture.url_resolved);

  // Search filters the shown stations; the map takes the same subset.
  await page.locator('.explorer-heading .explorer-icon').first().click();
  const query = page.locator('.explorer-search-field input');
  await expect(query).toBeFocused();
  await query.fill('osaka');
  await expect(page.locator('.explorer-row')).toHaveCount(1);
  await expect(page.locator('.explorer-row strong')).toHaveText('Osaka Nights');
  await query.fill('nothing here');
  await expect(page.locator('.explorer-empty')).toBeVisible();
  await page.locator('.explorer-search-field .explorer-icon').click();
  await expect(page.locator('.explorer-row')).toHaveCount(4);
  await page.locator('.explorer-map-toggle').click();
  await expect(explorer).toHaveAttribute('data-panel', 'collapsed');
  await expect.poll(() => panelHeight(page)).toBe(65);
  await page.locator('.explorer-map-toggle').click();
  await expect(explorer).toHaveAttribute('data-panel', 'normal');

  // Moving the map never changes the list; «Искать здесь» does.
  // A real drag: a pause after mousedown and many steps, so a 2-core CI runner
  // cannot deliver down/up before MapLibre has seen movement past its click
  // tolerance — otherwise the gesture lands as a CLICK on the dot under the
  // cursor, the card opens and the list title is gone (seen on CI once).
  const canvas = page.locator('.explorer-map canvas');
  await expect.poll(() => panelHeight(page)).toBe(192);
  await expect.poll(() => canvas.evaluate(el => el.clientHeight === el.closest<HTMLElement>('.explorer-map')!.clientHeight)).toBe(true);
  const map = (await canvas.boundingBox())!;
  await page.mouse.move(map.x + map.width / 2, map.y + map.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(120);
  await page.mouse.move(map.x + map.width / 2 + 40, map.y + map.height / 2 + 20, { steps: 8 });
  await page.waitForTimeout(60);
  await page.mouse.move(map.x + map.width / 2 + 120, map.y + map.height / 2 + 60, { steps: 16 });
  await page.waitForTimeout(60);
  await page.mouse.up();
  await expect(page.locator('[data-search-here]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.explorer-title strong')).toHaveText('Japan');
  await expect(page.locator('.explorer-row')).toHaveCount(4);
  await page.locator('[data-search-here]').click();
  await expect(page.locator('.explorer-title strong')).toHaveText('В этой области');
  await expect(page.locator('[data-search-here]')).toHaveCount(0);
  expect(await audioSrc(page)).toBe(fixture.url_resolved);
  await page.screenshot({ path: '../../output/playwright/calm/globe-390.png' });
});

test('calm globe: Лира is asked about the selected source in its own words', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  const posted: string[] = [];
  await page.route('**/ai/chat**', async (route) => {
    posted.push(String(route.request().postDataJSON()?.message ?? ''));
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'ai disabled in e2e' }) });
  });
  await openGlobe(page);
  const row = page.locator('.explorer-row').first();
  const name = (await row.locator('strong').textContent())!.trim();
  await row.locator('.explorer-row-name').click();
  await expect.poll(async () => Number(await page.locator('.explorer-map').getAttribute('data-zoom'))).toBeCloseTo(6.1, 1);
  await page.locator('[data-ask-lira]').click();
  await expect(page.locator('[data-chat-sheet]')).toBeVisible();
  await expect(page.locator('.chat-row').first()).toContainText(name);
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0]).toContain(name);
  expect(await audioSrc(page), 'asking never starts audio').toBeNull();
  // Лира is a section: the nav stays reachable, and choosing «Глобус» there
  // leaves her the way it leaves any screen — the selected source is intact.
  await expect(page.locator('.app-navigation-mobile .mobile-nav-chat')).toHaveClass(/active/);
  await page.locator('.app-navigation-mobile').getByRole('button', { name: /Глобус|Globe/ }).click();
  await expect(page.locator('[data-chat-sheet]')).toHaveCount(0);
  await expect(page.locator('[data-selected-station]')).toBeVisible();
  await expect.poll(async () => Number(await page.locator('.explorer-map').getAttribute('data-zoom'))).toBeCloseTo(6.1, 1);
});

test('calm home: a country continues on the globe at the same place', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await page.goto('/?calm=1');
  const link = page.locator('[data-calm-country-map]').first();
  await expect(link).toBeVisible();
  const country = (await link.getAttribute('data-calm-country-map'))!;
  await link.click();
  await expect(page.locator('[data-globe-explorer]')).toHaveAttribute('data-ready', 'true', { timeout: 20_000 });
  await expect(page.locator('.explorer-title strong')).toHaveText(country);
  expect(await audioSrc(page)).toBeNull();
});

test('calm globe @320 light: no overflow, 44px floors, compact card', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await start(page);
  await page.addInitScript(() => localStorage.setItem('radio:theme-current:v1', JSON.stringify('pastel')));
  await openGlobe(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'light');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await assertTargets(page);
  await page.locator('.explorer-row-name').first().click();
  await expect(page.locator('[data-selected-station]')).toBeVisible();
  await expect.poll(() => panelHeight(page)).toBe(140);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await assertTargets(page);
  await page.screenshot({ path: '../../output/playwright/calm/globe-320-pastel.png' });
});

// One geographic place opens all co-located streams without a zoom cascade.
test('calm globe: one geographic dot opens all co-located streams; genre filtering and selection never play', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  const berlin = stations.find(s => s.stationuuid === 'uuid-berlin')!;
  const pileIds = Array.from({ length: 98 }, (_, i) => `pile-${i}`);
  await page.route('**/catalog/points**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    items: [
      ...stations.map(s => ({ id: s.stationuuid, lat: s.geo_lat, lon: s.geo_long, country: s.country, name: s.name })),
      ...pileIds.map((id, i) => ({ id, lat: berlin.geo_lat, lon: berlin.geo_long, country: 'Germany', name: `Pile ${i}`, genre: ['rock', 'jazz', 'chill'][i % 3] }))
    ], mappedStations: stations.length + 98, totalStations: stations.length + 98
  }) }));
  await openGlobe(page);
  await page.locator('.explorer-country-switch').click();
  await page.locator('.calm-country-options button', { hasText: 'Germany' }).click();
  const map = page.locator('.explorer-map');
  await expect(page.locator('.explorer-title strong')).toHaveText('Germany');
  await expect(map).toHaveAttribute('data-camera', 'idle');
  await page.waitForTimeout(800);
  await page.locator('[data-explorer-legend]').getByRole('button', { name: 'Джаз, соул, блюз', exact: true }).click();
  await expect(page.locator('[data-result-count]')).toHaveText('33 эфира');
  const box = (await page.locator('.explorer-map canvas').boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.click(cx, cy);
  await expect(page.locator('.explorer-title strong')).toHaveText('Эфиры в этом месте');
  await expect(page.locator('[data-result-count]')).toHaveText('33 эфира');
  await page.locator('[data-explorer-legend]').getByRole('button', { name: 'Все жанры', exact: true }).click();
  await expect(page.locator('[data-result-count]')).toHaveText('99 эфиров');
  expect(Number(await map.getAttribute('data-zoom'))).toBeCloseTo(3.1, 1);
  expect(await audioSrc(page)).toBeNull();
  // Every source is reachable in the same place, including the last page.
  for (let i = 0; i < 4; i++) await page.locator('.explorer-load-more').click();
  await expect(page.locator('.explorer-row')).toHaveCount(99);
  await page.locator('.explorer-row-name').last().click();
  await expect(page.locator('[data-selected-station]')).toHaveAttribute('data-selected-station', 'pile-97');
  await page.locator('[data-back-to-list]').click();
  await page.locator('[data-explorer-legend]').getByRole('button', { name: 'Джаз, соул, блюз', exact: true }).click();
  await expect(page.locator('[data-result-count]')).toHaveText('33 эфира');
  await expect(page.locator('.explorer-row')).toHaveCount(20);
  await page.locator('[data-explorer-legend]').getByRole('button', { name: 'Все жанры', exact: true }).click();
  await expect(page.locator('[data-result-count]')).toHaveText('99 эфиров');
  expect(await audioSrc(page)).toBeNull();
});

test('calm globe: a dense place keeps its expanded list position across Feed and Globe', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  const berlin = stations.find(s => s.stationuuid === 'uuid-berlin')!;
  const pileIds = Array.from({ length: 98 }, (_, i) => `return-pile-${i}`);
  await page.route('**/catalog/points**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    items: [
      ...stations.map(s => ({ id: s.stationuuid, lat: s.geo_lat, lon: s.geo_long, country: s.country, name: s.name })),
      ...pileIds.map((id) => ({ id, lat: berlin.geo_lat, lon: berlin.geo_long, country: 'Germany', name: id }))
    ],
    mappedStations: stations.length + pileIds.length,
    totalStations: stations.length + pileIds.length
  }) }));
  await page.route('**/catalog/stations/**', route => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() || '');
    const item = stations.find(s => s.stationuuid === id) || (pileIds.includes(id)
      ? { ...berlin, stationuuid: id, name: id }
      : null);
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ item }) });
  });

  await openGlobe(page);
  await page.locator('.explorer-country-switch').click();
  await page.locator('.calm-country-options button', { hasText: 'Germany' }).click();
  await expect(page.locator('.explorer-title strong')).toHaveText('Germany');
  const map = page.locator('.explorer-map');
  await expect(map).toHaveAttribute('data-camera', 'idle');
  const box = (await page.locator('.explorer-map canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.explorer-title strong')).toHaveText('Эфиры в этом месте');
  const results = page.locator('[data-explorer-results]');
  for (let i = 0; i < 4; i++) await page.locator('.explorer-load-more').click();
  await expect(page.locator('.explorer-row')).toHaveCount(99);
  await expect.poll(() => page.locator('.explorer-row').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-point-id')))).toEqual(['uuid-berlin', ...pileIds]);
  await page.locator('[data-explorer-legend]').getByRole('button', { name: 'Джаз, соул, блюз', exact: true }).click();
  await expect(results).toHaveJSProperty('scrollTop', 0);
  await page.locator('[data-explorer-legend]').getByRole('button', { name: 'Все жанры', exact: true }).click();
  await expect(page.locator('.explorer-row')).toHaveCount(20);
  for (let i = 0; i < 4; i++) await page.locator('.explorer-load-more').click();
  await expect(page.locator('.explorer-row')).toHaveCount(99);
  await results.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  const scrollBefore = await results.evaluate((element) => element.scrollTop);
  expect(scrollBefore).toBeGreaterThan(0);
  const last = page.locator('.explorer-row').last();
  const lastId = await last.getAttribute('data-point-id');
  const lastBox = await last.boundingBox();
  const resultsBox = await results.boundingBox();
  expect(lastBox).not.toBeNull();
  expect(resultsBox).not.toBeNull();
  expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(resultsBox!.y + resultsBox!.height + 1);
  await last.locator('.explorer-row-name').click();
  await expect(page.locator('[data-selected-station]')).toHaveAttribute('data-selected-station', lastId!);
  await page.locator('[data-selected-play]').click();
  await expect(page.locator('[data-calm-player]')).toHaveAttribute('data-status', 'playing');
  const beforeAudio = await audioSrc(page);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue)).toMatchObject({
    sourceId: 'globe-station',
    currentIndex: 0,
    items: [{ stationuuid: lastId }]
  });
  const beforeQueue = await page.evaluate(() => JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue);

  await page.locator('.app-navigation-mobile').getByRole('button', { name: 'Лента', exact: true }).click();
  await expect(page.locator('.station-feed-overlay')).toBeVisible();
  await page.locator('.app-navigation-mobile').getByRole('button', { name: 'Глобус', exact: true }).click();
  await expect(page.locator('[data-globe-explorer]')).toHaveAttribute('data-ready', 'true', { timeout: 20_000 });
  await expect(page.locator('.explorer-map[data-globe-warmup="done"]')).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator('[data-selected-station]')).toHaveAttribute('data-selected-station', lastId!);
  await expect(page.locator('.explorer-map')).toHaveAttribute('data-camera', 'idle');
  await page.locator('[data-back-to-list]').click();
  await expect(page.locator('.explorer-title strong')).toHaveText('Эфиры в этом месте');
  await expect(page.locator('.explorer-row')).toHaveCount(99);
  await expect.poll(() => results.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const scrollAfter = await results.evaluate((element) => element.scrollTop);
  expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThanOrEqual(2);
  await expect.poll(() => page.locator('.explorer-row').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-point-id')))).toEqual(['uuid-berlin', ...pileIds]);
  expect(await audioSrc(page)).toBe(beforeAudio);
  await expect(page.locator('audio')).toHaveAttribute('data-ra-state', 'playing');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue)).toEqual(beforeQueue);
});

test('calm globe: country catalogue action is available before pagination and preserves the air', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  const located = Array.from({ length: 41 }, (_, index) => ({
    id: `mixed-located-${index}`,
    lat: 52.52,
    lon: 13.405,
    country: 'Germany',
    state: 'Berlin',
    name: `Berlin Source ${index + 1}`
  }));
  const unlocated = [
    { ...stations[4], stationuuid: 'mixed-unlocated-a', name: 'Unlocated A', country: 'Germany', state: '', geo_lat: null, geo_long: null },
    { ...stations[4], stationuuid: 'mixed-unlocated-b', name: 'Unlocated B', country: 'Germany', state: '', geo_lat: null, geo_long: null }
  ];
  const locatedCatalog = located.map((point) => ({
    ...stations[4], stationuuid: point.id, name: point.name, country: point.country, state: point.state,
    geo_lat: point.lat, geo_long: point.lon
  }));
  await page.route('**/catalog/points**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ items: [...located, ...unlocated.map((station) => ({ id: station.stationuuid, country: station.country, name: station.name }))], mappedStations: located.length, totalStations: 43 })
  }));
  await page.route('**/catalog/search**', (route) => {
    const url = new URL(route.request().url());
    const items = url.searchParams.get('country') === 'Germany'
      ? [...unlocated, ...locatedCatalog]
      : stations;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items, total: items.length, nextCursor: null, facets: { countries: ['Japan', 'Germany', 'Brazil'], tags: [], languages: [] } })
    });
  });
  await page.route('**/catalog/stations/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ item: locatedCatalog.find((station) => station.stationuuid === new URL(route.request().url()).pathname.split('/').pop()) || unlocated[0] })
  }));
  await openGlobe(page);
  await expect(page.locator('.explorer-title strong')).toHaveText('Germany');
  await expect(page.locator('[data-result-count]')).toHaveText('41 эфир');
  const allCountry = page.locator('.explorer-list-meta [data-unlocated-list]');
  await expect(allCountry).toBeVisible();
  await expect(page.locator('.explorer-load-more')).toBeVisible();

  await page.locator('.explorer-row-play').first().click();
  await expect.poll(() => audioSrc(page)).toBe(stations[4].url_resolved);
  await expect(page.locator('[data-calm-player]')).toHaveAttribute('data-status', 'playing');
  const srcBeforeSheet = await audioSrc(page);
  const results = page.locator('[data-explorer-results]');
  await results.hover();
  await page.mouse.wheel(0, 240);
  await expect.poll(() => results.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const scrollBeforeSheet = await results.evaluate((element) => element.scrollTop);
  await allCountry.click();
  const sheet = page.locator('[data-calm-browse="Germany"]');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Unlocated A');
  expect(await audioSrc(page)).toBe(srcBeforeSheet);
  await expect(page.locator('[data-calm-player]')).toHaveAttribute('data-status', 'playing');
  await sheet.getByRole('button', { name: /Закрыть|Close/ }).click();
  await expect(allCountry).toBeFocused();
  expect(await audioSrc(page)).toBe(srcBeforeSheet);
  await expect.poll(() => results.evaluate((element) => element.scrollTop)).toBe(scrollBeforeSheet);

  // Filtered, world and place scopes must not present the unfiltered country action.
  await page.locator('[data-explorer-legend]').getByRole('button', { name: 'Джаз, соул, блюз', exact: true }).click();
  await expect(page.locator('.explorer-list-meta [data-unlocated-list]')).toHaveCount(0);
  await page.locator('[data-explorer-legend]').getByRole('button', { name: 'Все жанры', exact: true }).click();
  await page.locator('.explorer-heading .explorer-icon').first().click();
  await page.locator('.explorer-search-field input').fill('Berlin Source 1');
  await expect(page.locator('.explorer-list-meta [data-unlocated-list]')).toHaveCount(0);
  await page.locator('.explorer-search-field .explorer-icon').click();
  await page.locator('.explorer-world').click();
  await expect(page.locator('.explorer-list-meta [data-unlocated-list]')).toHaveCount(0);
  await page.locator('.explorer-country-switch').click();
  await page.locator('.calm-country-options button', { hasText: 'Germany' }).click();
  const map = page.locator('.explorer-map canvas');
  await expect(page.locator('.explorer-map')).toHaveAttribute('data-camera', 'idle');
  const mapBox = (await map.boundingBox())!;
  await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
  await expect(page.locator('.explorer-title strong')).toHaveText('Эфиры в этом месте');
  await expect(page.locator('.explorer-list-meta [data-unlocated-list]')).toHaveCount(0);
  expect(await audioSrc(page)).toBe(srcBeforeSheet);

  // The catalogue row itself remains an explicit play entry and carries the
  // country queue into Feed; opening the queue sheet never plays by itself.
  await page.locator('.explorer-country-switch').click();
  await page.locator('.calm-country-options button', { hasText: 'Germany' }).click();
  await expect(page.locator('.explorer-list-meta [data-unlocated-list]')).toBeVisible();
  await page.locator('.explorer-list-meta [data-unlocated-list]').click();
  const countrySheet = page.locator('[data-calm-browse="Germany"]');
  await countrySheet.locator('[data-discovery-station]').first().click();
  await expect(page.locator('[data-calm-player]')).toHaveAttribute('data-status', 'playing');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue?.sourceId)).toBe('globe-country');
  const persistedQueueIds = await page.evaluate(() => JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue?.items?.map((station: { stationuuid: string }) => station.stationuuid) || []);
  expect(persistedQueueIds).toContain('mixed-unlocated-a');
  await countrySheet.getByRole('button', { name: /Закрыть|Close/ }).click();
  await page.locator('.calm-mini-info').click();
  await expect(page.locator('[data-feed-player]')).toBeVisible();
  await expect(page.locator('[data-feed-station="mixed-unlocated-a"]')).toBeVisible();
});

test('calm globe: country catalogue retry stays silent after a failed first page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  let searchAttempts = 0;
  const unlocated = { ...stations[4], stationuuid: 'retry-unlocated', name: 'Retry Germany', country: 'Germany', state: '', geo_lat: null, geo_long: null };
  await page.route('**/catalog/points**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ items: [{ id: 'retry-located', lat: 52.52, lon: 13.405, country: 'Germany', name: 'Located Germany' }, { id: unlocated.stationuuid, country: 'Germany', name: unlocated.name }], mappedStations: 1, totalStations: 2 })
  }));
  await page.route('**/catalog/search**', (route) => {
    const country = new URL(route.request().url()).searchParams.get('country');
    if (country === 'Germany' && searchAttempts++ === 0) {
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'fixture failure' }) });
    }
    const items = country === 'Germany' ? [unlocated] : stations;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items, total: items.length, nextCursor: null, facets: { countries: ['Japan', 'Germany'], tags: [], languages: [] } })
    });
  });
  await openGlobe(page);
  const action = page.locator('.explorer-list-meta [data-unlocated-list]');
  await action.click();
  const sheet = page.locator('[data-calm-browse="Germany"]');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('[role="status"]')).toContainText('Не удалось загрузить');
  await expect(sheet.getByRole('button', { name: /Повторить|Retry/ })).toBeVisible();
  expect(await audioSrc(page), 'a failed catalogue page never starts sound').toBeNull();
  await sheet.getByRole('button', { name: /Повторить|Retry/ }).click();
  await expect(sheet.locator('[data-discovery-station]').first()).toContainText('Retry Germany');
  expect(await audioSrc(page), 'retry remains browse-only').toBeNull();
});

test('calm globe: an invalid points 200 shows retry, then recovers without touching the queue', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockStations(page);
  await installMediaMocks(page);
  await seedRadioState(page, {
    queue: [stations[0], stations[1]],
    queueCurrentIndex: 0,
    queueSourceId: 'seeded-globe',
    queueSourceLabel: 'Seeded Globe'
  });
  await page.route('https://*.api.radio-browser.info/**', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'fallback unavailable' }) })
  );
  let pointsRequests = 0;
  let primaryRecovered = false;
  await page.route('**/catalog/points**', (route) => {
    pointsRequests += 1;
    const payload = primaryRecovered ? JSON.parse(points()) : { items: [], mappedStations: 0, totalStations: 0 };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  await page.goto('/?calm=1');
  await page.locator('.app-navigation-mobile').getByRole('button', { name: /Глобус|Globe/ }).click();
  const explorer = page.locator('[data-globe-explorer]');
  await expect(explorer).toBeVisible();
  await expect(page.locator('.explorer-map-error')).toContainText(/Не удалось загрузить|Could not load/);
  await expect(page.getByRole('button', { name: /Повторить|Retry/ })).toBeVisible();
  expect(await audioSrc(page), 'invalid points never starts audio').toBeNull();
  const queueBefore = await page.evaluate(() => localStorage.getItem('radio:player:v2'));
  const countBeforeRetry = pointsRequests;

  primaryRecovered = true;
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: /Повторить|Retry/ }).click();
  await expect(explorer).toHaveAttribute('data-ready', 'true', { timeout: 20_000 });
  await expect(page.locator('.explorer-map[data-globe-warmup="done"]')).toHaveCount(1, { timeout: 20_000 });
  expect(await audioSrc(page), 'successful points retry remains browse-only').toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('radio:player:v2'))).toBe(queueBefore);
  expect(pointsRequests).toBeGreaterThan(countBeforeRetry);
});

test('calm globe: a playing selection survives invalid points recovery after returning from Home', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockStations(page);
  await installMediaMocks(page);
  await seedRadioState(page);
  await page.route('https://*.api.radio-browser.info/**', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'fallback unavailable' }) })
  );
  let primaryHealthy = true;
  await page.route('**/catalog/points**', (route) => {
    const payload = primaryHealthy ? JSON.parse(points()) : { items: [], mappedStations: 0, totalStations: 0 };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  await page.route('**/catalog/stations/**', (route) => {
    const id = decodeURIComponent(route.request().url().split('/catalog/stations/')[1].split(/[?#]/)[0]);
    const item = stations.find((station) => station.stationuuid === id) || null;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ item }) });
  });

  await page.goto('/?calm=1');
  await page.locator('.app-navigation-mobile').getByRole('button', { name: /Глобус|Globe/ }).click();
  await expect(page.locator('[data-globe-explorer]')).toHaveAttribute('data-ready', 'true', { timeout: 20_000 });
  await expect(page.locator('.explorer-map[data-globe-warmup="done"]')).toHaveCount(1, { timeout: 20_000 });

  const row = page.locator('.explorer-row').first();
  const selectedId = await row.getAttribute('data-point-id');
  expect(selectedId).toBeTruthy();
  const selectedFixture = stations.find((station) => station.stationuuid === selectedId)!;
  await row.locator('.explorer-row-name').click();
  const card = page.locator('[data-selected-station]');
  await expect(card).toHaveAttribute('data-selected-station', selectedId!);
  await card.locator('[data-selected-play]').click();
  await expect(page.locator('[data-calm-player]')).toHaveAttribute('data-status', 'playing');
  const playbackBefore = await page.evaluate(() => {
    const audio = document.querySelector('audio') as HTMLAudioElement | null;
    return { src: audio?.currentSrc || audio?.src || '', state: audio?.getAttribute('data-ra-state') || '' };
  });
  expect(playbackBefore.src).toBe(selectedFixture.url_resolved);
  expect(playbackBefore.state).toBe('playing');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue?.items?.length || 0)).toBeGreaterThan(0);
  const queueBefore = await page.evaluate(() => {
    const queue = JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue || {};
    return { ids: (queue.items || []).map((item: { stationuuid: string }) => item.stationuuid), index: queue.currentIndex, sourceId: queue.sourceId, sourceLabel: queue.sourceLabel };
  });

  await page.locator('.app-navigation-mobile').getByRole('button', { name: /Главная|Home/ }).click();
  await expect(page.locator('[data-calm-home]')).toBeVisible();
  primaryHealthy = false;
  await page.locator('.app-navigation-mobile').getByRole('button', { name: /Глобус|Globe/ }).click();
  await expect(page.locator('.explorer-map-error')).toContainText(/Не удалось загрузить|Could not load/);
  await expect(page.getByRole('button', { name: /Повторить|Retry/ })).toBeVisible();
  expect(await audioSrc(page)).toBe(playbackBefore.src);
  await expect(page.locator('audio')).toHaveAttribute('data-ra-state', 'playing');
  expect(await page.evaluate(() => {
    const queue = JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue || {};
    return { ids: (queue.items || []).map((item: { stationuuid: string }) => item.stationuuid), index: queue.currentIndex, sourceId: queue.sourceId, sourceLabel: queue.sourceLabel };
  })).toEqual(queueBefore);

  primaryHealthy = true;
  await page.getByRole('button', { name: /Повторить|Retry/ }).click();
  await expect(page.locator('[data-globe-explorer]')).toHaveAttribute('data-ready', 'true', { timeout: 20_000 });
  await expect(page.locator('.explorer-map[data-globe-warmup="done"]')).toHaveCount(1, { timeout: 20_000 });
  await expect.poll(() => page.locator('[data-selected-station]').getAttribute('data-selected-station')).toBe(selectedId);
  await expect(page.locator('[data-selected-station]')).toContainText(selectedFixture.name);
  await expect(page.locator('[data-selected-station]')).toContainText(selectedFixture.country);
  await expect(page.locator('[data-calm-player]')).toHaveAttribute('data-status', 'playing');
  expect(await audioSrc(page)).toBe(playbackBefore.src);
  await expect(page.locator('audio')).toHaveAttribute('data-ra-state', 'playing');
  expect(await page.evaluate(() => {
    const queue = JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue || {};
    return { ids: (queue.items || []).map((item: { stationuuid: string }) => item.stationuuid), index: queue.currentIndex, sourceId: queue.sourceId, sourceLabel: queue.sourceLabel };
  })).toEqual(queueBefore);
});

test('calm globe: desktop frame and map canvas stay inside the viewport after resize', async ({ page }) => {
  await start(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?calm=1');
  await page.locator('.app-navigation-mobile').getByRole('button', { name: /Глобус|Globe/ }).click();
  await expect(page.locator('[data-globe-explorer]')).toHaveAttribute('data-ready', 'true', { timeout: 20_000 });
  await expect(page.locator('.explorer-map[data-globe-warmup="done"]')).toHaveCount(1, { timeout: 20_000 });
  for (const viewport of [
    { width: 1024, height: 600 },
    { width: 1280, height: 720 },
    { width: 1440, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('[data-globe-explorer]')).toHaveAttribute('data-ready', 'true', { timeout: 20_000 });
    await expect(page.locator('.explorer-map[data-globe-warmup="done"]')).toHaveCount(1, { timeout: 20_000 });
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const stage = document.querySelector('.explorer-stage')?.getBoundingClientRect();
            const canvas = document.querySelector('.explorer-map canvas')?.getBoundingClientRect();
            return Boolean(stage && canvas && Math.abs(stage.width - canvas.width) < 2 && Math.abs(stage.height - canvas.height) < 2);
          }),
        { timeout: 10_000 }
      )
      .toBe(true);
    const metrics = await page.evaluate(() => {
      const rect = (selector: string) => {
        const element = document.querySelector(selector)?.getBoundingClientRect();
        return element ? { left: element.left, right: element.right, top: element.top, bottom: element.bottom } : null;
      };
      return {
        screen: rect('.screen-globe-explorer'),
        stage: rect('.explorer-stage'),
        canvas: rect('.explorer-map canvas'),
        controls: [...document.querySelectorAll<HTMLElement>('.explorer-map-heading, .explorer-zoom')].map((element) => {
          const box = element.getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
        })
      };
    });
    expect(metrics.screen).not.toBeNull();
    expect(metrics.stage).not.toBeNull();
    expect(metrics.canvas).not.toBeNull();
    expect(metrics.screen!.left).toBeGreaterThanOrEqual(0);
    expect(metrics.screen!.right).toBeLessThanOrEqual(viewport.width);
    expect(metrics.controls.every((box) => box.left >= 0 && box.right <= viewport.width)).toBe(true);
    expect(Math.abs(metrics.canvas!.left - metrics.stage!.left)).toBeLessThan(2);
    expect(Math.abs(metrics.canvas!.right - metrics.stage!.right)).toBeLessThan(2);
    expect(Math.abs(metrics.canvas!.top - metrics.stage!.top)).toBeLessThan(2);
    expect(Math.abs(metrics.canvas!.bottom - metrics.stage!.bottom)).toBeLessThan(2);
  }
});

// A sparse country: the catalogue knows stations there but none carries
// coordinates (Mongolia: nine stations, not one located). The map draws
// nothing invented; the list says how many exist and opens the real
// catalogue shelf for them, and they play from there.
test('calm globe: a country without located stations offers its catalogue list instead of an empty map', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  const mongolian = { ...stations[0], stationuuid: 'uuid-ub', name: 'Ulaanbaatar FM', country: 'Mongolia', state: '', geo_lat: null, geo_long: null, url_resolved: 'https://stream.example.com/ub', url: 'https://stream.example.com/ub' };
  await page.route('**/catalog/points**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          ...stations.map((s) => ({ id: s.stationuuid, lat: s.geo_lat, lon: s.geo_long, country: s.country, state: s.state, name: s.name })),
          { id: 'uuid-ub', country: 'Mongolia', name: 'Ulaanbaatar FM' },
          { id: 'uuid-ub-2', country: 'Mongolia', name: 'Gobi Radio' }
        ],
        mappedStations: stations.length,
        totalStations: stations.length + 2
      })
    })
  );
  await page.route('**/catalog/search**', (route) => {
    const url = new URL(route.request().url());
    const items = url.searchParams.get('country') === 'Mongolia' ? [mongolian] : stations;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items, total: items.length, nextCursor: null, facets: { countries: ['All', 'Japan', 'Germany', 'Brazil', 'Mongolia'], tags: [], languages: [] } })
    });
  });
  await openGlobe(page);
  await page.locator('.explorer-country-switch').click();
  await page.locator('.calm-country-options button', { hasText: 'Mongolia' }).click();
  await expect(page.locator('.explorer-title strong')).toHaveText('Mongolia');
  await expect(page.locator('[data-result-count]')).toHaveText('0 эфиров');
  const empty = page.locator('.explorer-empty');
  await expect(empty).toContainText('Без точных координат: 2');
  const allCountry = page.locator('.explorer-list-meta [data-unlocated-list]');
  await expect(allCountry).toBeVisible();
  await allCountry.click();
  const sheet = page.locator('[data-calm-browse="Mongolia"]');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.calm-destination, .calm-station-row').first()).toContainText('Ulaanbaatar FM');
  expect(await audioSrc(page), 'opening the list never starts sound').toBeNull();
  await sheet.getByRole('button', { name: /Закрыть|Close/ }).click();
  await expect(allCountry).toBeFocused();
});

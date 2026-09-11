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
  const canvas = page.locator('.explorer-map canvas');
  const map = (await canvas.boundingBox())!;
  await page.mouse.move(map.x + map.width / 2, map.y + map.height / 2);
  await page.mouse.down();
  await page.mouse.move(map.x + map.width / 2 + 120, map.y + map.height / 2 + 60, { steps: 12 });
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
  await page.locator('[data-ask-lira]').click();
  await expect(page.locator('[data-chat-sheet]')).toBeVisible();
  await expect(page.locator('.chat-row').first()).toContainText(name);
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0]).toContain(name);
  expect(await audioSrc(page), 'asking never starts audio').toBeNull();
  await page.locator('.chat-close-btn').click();
  await expect(page.locator('[data-chat-sheet]')).toHaveCount(0);
  await expect(page.locator('[data-selected-station]')).toBeVisible();
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

// Points that share ONE coordinate (the real catalogue has 373 such piles, up
// to 198 stations at one point) open as a fan on the map: leaves spread for
// legibility, each tied back to the shared point, so the spread is never read
// as real different addresses. Dots carry the API's coarse genre family as a
// colour, and the family's name in the legend and in every row.
test('calm globe: a pile of coincident points opens as a fan, a leaf selects, genres are named', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  const berlin = stations.find((s) => s.stationuuid === 'uuid-berlin')!;
  const pileIds = ['pile-1', 'pile-2', 'pile-3'];
  await page.route('**/catalog/points**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          ...stations.map((s) => ({ id: s.stationuuid, lat: s.geo_lat, lon: s.geo_long, country: s.country, state: s.state, name: s.name, genre: s.tags.includes('jazz') ? 'jazz' : undefined })),
          ...pileIds.map((id, index) => ({ id, lat: berlin.geo_lat, lon: berlin.geo_long, country: 'Germany', name: `Pile ${index + 1}`, genre: ['rock', 'talk', undefined][index] }))
        ],
        mappedStations: stations.length + 3,
        totalStations: stations.length + 3
      })
    })
  );
  await openGlobe(page);

  // The legend names every family and the neutral «no tag» case in words.
  await expect(page.locator('[data-explorer-legend] .explorer-legend-item')).toHaveCount(10);
  await expect(page.locator('[data-explorer-legend]')).toContainText('Рок и метал');
  await expect(page.locator('[data-explorer-legend]')).toContainText('Жанр не указан');

  // Germany now has four located stations on one point plus Hamburg.
  await page.locator('.explorer-country-switch').click();
  await page.locator('.calm-country-options button', { hasText: 'Germany' }).click();
  await expect(page.locator('.explorer-title strong')).toHaveText('Germany');
  await expect(page.locator('[data-result-count]')).toHaveText('7 эфиров');
  const rockRow = page.locator('.explorer-row[data-point-id="pile-1"]');
  await expect(rockRow.locator('small')).toContainText('Рок и метал');
  await expect(page.locator('.explorer-row[data-point-id="pile-3"] small')).not.toContainText('Рок');

  // The flight lands on the median of the country's points — the pile itself.
  // Tapping the group there zooms past the clustering limit and, because the
  // points still coincide, opens the fan instead of leaving dots on top of
  // each other.
  const canvas = page.locator('.explorer-map canvas');
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.waitForTimeout(900);
  await page.mouse.click(cx, cy);
  await expect(page.locator('.explorer-map')).toHaveAttribute('data-spider', '4', { timeout: 10_000 });
  await expect(page.locator('[data-result-count]')).toHaveText('4 эфира');
  expect(await audioSrc(page), 'exploring never starts sound').toBeNull();

  // A leaf sits 34px above the shared point; tapping it selects that source.
  await page.waitForTimeout(400);
  await page.mouse.click(cx, cy - 34);
  const card = page.locator('[data-selected-station]');
  await expect(card).toBeVisible();
  const picked = (await card.getAttribute('data-selected-station'))!;
  expect(['uuid-berlin', ...pileIds]).toContain(picked);
  expect(await audioSrc(page)).toBeNull();
  await page.screenshot({ path: process.env.CALM_GLOBE_SHOT || 'test-results/calm-globe-fan.png' });
});

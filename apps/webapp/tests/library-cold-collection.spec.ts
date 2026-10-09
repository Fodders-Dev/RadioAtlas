import { expect, test } from '@playwright/test';
import { ACCOUNT_FIXTURE_API_BASE, encodeGoogleFixtureCredential } from './authFixture';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

const collectionId = 'fresh-cloud-playlist';
const unavailableId = 'uuid-not-in-catalog';
const collectionStationIds = [
  stations[0].stationuuid,
  unavailableId,
  stations[1].stationuuid,
  stations[2].stationuuid,
  stations[3].stationuuid
];

const libraryState = (page: import('@playwright/test').Page) => page.evaluate(() => {
  const library = JSON.parse(localStorage.getItem('radio:library:v2') || '{}');
  const player = JSON.parse(localStorage.getItem('radio:player:v2') || '{}');
  return {
    favorites: library.favorites,
    recent: library.recent,
    stationCacheIds: (Object.values(library.stationCache || {}) as Array<{ stationuuid: string }>).map((station) => station.stationuuid),
    collectionIds: library.collections?.find((item: { id: string }) => item.id === 'fresh-cloud-playlist')?.stationIds,
    queueIds: player.queue?.items?.map((station: { stationuuid: string }) => station.stationuuid) ?? [],
    queueSourceId: player.queue?.sourceId ?? null,
    playCalls: (window as Window & { __coldCollectionPlayCalls?: number }).__coldCollectionPlayCalls ?? 0
  };
});

test('cold cloud playlist resolves before partial home Play and only starts on explicit Listen', async ({ page, request }) => {
  const credential = encodeGoogleFixtureCredential({
    sub: `cold-library-${Date.now()}`,
    name: 'Cold Library Fixture',
    email: 'cold-library@example.test'
  });
  const signIn = await request.post(`${ACCOUNT_FIXTURE_API_BASE}/auth/google`, {
    data: { credential }
  });
  expect(signIn.ok()).toBe(true);
  const session = await signIn.json() as { token: string };
  const headers = { Authorization: `Bearer ${session.token}` };
  const collection = {
    id: collectionId,
    name: 'Cold start stations',
    description: null,
    stationIds: collectionStationIds,
    isPublic: false,
    pinned: false,
    createdAt: 1,
    updatedAt: 1
  };
  const savedLibrary = await request.put(`${ACCOUNT_FIXTURE_API_BASE}/me/library`, {
    headers,
    data: {
      favorites: [stations[0]],
      recent: [stations[3]],
      collections: [collection]
    }
  });
  expect(savedLibrary.status(), savedLibrary.ok() ? '' : await savedLibrary.text()).toBe(200);

  const catalogLookups: string[] = [];
  let concurrentCatalogLookups = 0;
  let peakCatalogLookups = 0;
  await page.setViewportSize({ width: 390, height: 844 });
  await installMediaMocks(page);
  await mockStations(page, {
    summaryHandler: (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        generatedAt: 1,
        counts: { stations: 0, countries: 0, languages: 0, genres: 0 },
        catalogPool: [], freshSignals: [], searchLaunch: [], sponsored: [],
        countrySpotlight: null, genreSpotlight: null
      })
    })
  });
  // Use the real fixture stations for by-ID lookups and leave one ID genuinely
  // absent from the catalog so the owner playlist remains visibly incomplete.
  await page.route('**/catalog/stations/**', async (route) => {
    const stationId = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() || '');
    catalogLookups.push(stationId);
    const station = stations.find((candidate) => candidate.stationuuid === stationId);
    concurrentCatalogLookups += 1;
    peakCatalogLookups = Math.max(peakCatalogLookups, concurrentCatalogLookups);
    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(station ? { item: station } : { item: null })
      });
    } finally {
      concurrentCatalogLookups -= 1;
    }
  });
  await seedRadioState(page, {
    activeSection: 'library',
    libraryTab: 'collections',
    stationCache: [],
    collections: [],
    favorites: [],
    recent: [],
    seedOnlyIfAbsent: true
  });
  await page.addInitScript(({ token, apiBase }) => {
    localStorage.setItem('radio:session:v1', token);
    localStorage.setItem('radio:api-url', apiBase);
    (window as Window & { __coldCollectionPlayCalls?: number }).__coldCollectionPlayCalls = 0;
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      (window as Window & { __coldCollectionPlayCalls?: number }).__coldCollectionPlayCalls =
        ((window as Window & { __coldCollectionPlayCalls?: number }).__coldCollectionPlayCalls || 0) + 1;
      return originalPlay.call(this);
    };
  }, { token: session.token, apiBase: ACCOUNT_FIXTURE_API_BASE });

  await page.goto('/?calm=1');
  await expect.poll(async () => (await libraryState(page)).collectionIds).toEqual(collectionStationIds);
  await expect.poll(async () => (await libraryState(page)).favorites.map((station: { stationuuid: string }) => station.stationuuid))
    .toEqual([stations[0].stationuuid]);
  await expect.poll(async () => (await libraryState(page)).recent.map((station: { stationuuid: string }) => station.stationuuid))
    .toEqual([stations[3].stationuuid]);
  // Full favorite/recent StationLite values come from /me, while the station
  // cache remains cold. The favorite-derived first playlist can still render.
  expect((await libraryState(page)).stationCacheIds).toEqual([]);
  await expect(page.locator('.library-preview-featured')).toContainText('Cold start stations');
  expect((await libraryState(page)).queueIds).toEqual([]);
  expect((await libraryState(page)).playCalls).toBe(0);

  await page.locator('.library-preview-featured .library-preview-actions')
    .getByRole('button', { name: 'Слушать', exact: true }).click();
  const detail = page.locator('[data-library-collection-detail]');
  await expect(detail).toBeVisible();
  expect((await libraryState(page)).queueIds).toEqual([]);
  expect((await libraryState(page)).playCalls).toBe(0);
  await expect(detail).toContainText(stations[1].name);
  await expect(detail).toContainText(stations[2].name);
  await expect(detail).toContainText(stations[3].name);
  await expect(detail.locator('[data-library-collection-unavailable]')).toContainText(/1|одно/);
  await expect.poll(async () => (await libraryState(page)).stationCacheIds)
    .toEqual(expect.arrayContaining([stations[1].stationuuid, stations[2].stationuuid]));
  const displayedNames = await detail.locator('.library-detail-station-table .station-title .marquee-text').allTextContents();
  expect(displayedNames).toEqual([stations[0].name, stations[1].name, stations[2].name, stations[3].name]);
  expect((await libraryState(page)).collectionIds).toEqual(collectionStationIds);
  expect(catalogLookups.sort()).toEqual([unavailableId, stations[1].stationuuid, stations[2].stationuuid].sort());
  expect(peakCatalogLookups).toBeLessThanOrEqual(4);
  expect((await libraryState(page)).queueIds).toEqual([]);
  expect((await libraryState(page)).playCalls).toBe(0);

  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Главная', exact: true }).click();
  await expect(page.locator('[data-library-home]')).toHaveCount(0);
  expect((await libraryState(page)).queueIds).toEqual([]);
  expect((await libraryState(page)).playCalls).toBe(0);
  await page.reload();
  expect((await libraryState(page)).queueIds).toEqual([]);
  expect((await libraryState(page)).playCalls).toBe(0);

  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Моё', exact: true }).click();
  await expect(page.locator('[data-library-home]')).toBeVisible();
  await page.getByRole('button', { name: 'Открыть: Cold start stations', exact: true }).click();
  await expect(detail).toBeVisible();
  await expect.poll(async () => (await libraryState(page)).collectionIds).toEqual(collectionStationIds);
  await detail.locator('.library-collection-detail-actions').getByRole('button', { name: 'Слушать', exact: true }).click();
  await expect.poll(async () => (await libraryState(page)).queueIds).toEqual([
    stations[0].stationuuid,
    stations[1].stationuuid,
    stations[2].stationuuid,
    stations[3].stationuuid
  ]);
  expect((await libraryState(page)).queueSourceId).toBe(`collection-${collectionId}`);
  expect((await libraryState(page)).playCalls).toBeGreaterThan(0);
  expect((await libraryState(page)).collectionIds).toEqual(collectionStationIds);
});

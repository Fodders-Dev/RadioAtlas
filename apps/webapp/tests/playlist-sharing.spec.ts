import { expect, test, type Page } from '@playwright/test';
import { ACCOUNT_FIXTURE_API_BASE, encodeGoogleFixtureCredential } from './authFixture';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

const token = 'playlist-share-e2e-token';
const collectionId = 'playlist-share-e2e';
const orderedIds = [
  stations[0].stationuuid,
  'missing-station-000',
  stations[1].stationuuid,
  ...Array.from({ length: 125 }, (_, index) => `missing-station-${String(index + 1).padStart(3, '0')}`)
];
const playlist = {
  name: 'Night drive selection',
  description: 'Snapshot for a quiet evening',
  stationIds: orderedIds,
  updatedAt: 1780000000000
};
const collection = { id: collectionId, name: playlist.name, stationIds: orderedIds };

const seedPage = async (page: Page, options: { owner?: boolean; player?: boolean } = {}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockStations(page);
  await installMediaMocks(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => { (window as any).__copiedPlaylistUrl = text; }, readText: async () => '' }
    });
  });
  await seedRadioState(page, {
    activeSection: options.player ? 'home' : 'library',
    libraryTab: 'collections',
    collections: [collection],
    stationCache: [stations[0], stations[1], stations[4]],
    queue: options.player ? [stations[4]] : [],
    queueCurrentIndex: options.player ? 0 : -1,
    queueSourceId: options.player ? 'existing-queue' : null,
    queueSourceLabel: options.player ? 'Existing queue' : null
  });
  await page.route('**/share/collections/**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const url = new URL(route.request().url());
    if (url.pathname.endsWith(`/${token}`)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ playlist }) });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not found' }) });
  });
  await page.route('**/catalog/stations/**', async (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() || '');
    const station = stations.find((item) => item.stationuuid === id);
    if (station && [stations[0].stationuuid, stations[1].stationuuid].includes(id)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ item: station }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ item: null }) });
  });

  let sessionToken: string | undefined;
  if (options.owner) {
    const response = await page.request.post(`${ACCOUNT_FIXTURE_API_BASE}/auth/google`, {
      data: { credential: encodeGoogleFixtureCredential({ sub: `playlist-owner-${Date.now()}`, name: 'Playlist Owner' }) }
    });
    expect(response.ok(), await response.text()).toBe(true);
    sessionToken = ((await response.json()) as { token: string }).token;
    const saved = await page.request.put(`${ACCOUNT_FIXTURE_API_BASE}/me/library`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
      data: { favorites: [], recent: [], collections: [{ ...collection, description: null, isPublic: false }] }
    });
    expect(saved.status(), await saved.text()).toBe(200);
    await page.addInitScript(({ token: authToken, api }) => {
      localStorage.setItem('radio:session:v1', authToken);
      localStorage.setItem('radio:api-url', api);
    }, { token: sessionToken, api: ACCOUNT_FIXTURE_API_BASE });
  }
};

const openCollection = async (page: Page) => {
  if (page.url() === 'about:blank') await page.goto('/?calm=1');
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Моё', exact: true }).click();
  await page.getByRole('button', { name: `Открыть: ${playlist.name}`, exact: true }).click();
  return page.locator('.library-collection-detail');
};

const savedCollection = (page: Page) => page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('radio:library:v2') || '{}');
  return (state.collections || []).find((item: { id: string }) => item.id !== 'playlist-share-e2e');
});

test.describe('shared collection user journeys', () => {
  test('guest import keeps the complete ordered snapshot and does not alter the existing queue or start playback', async ({ page }) => {
    await seedPage(page, { player: true });
    await page.goto(`/?playlist=${token}`);
    await expect(page.locator('.shared-playlist-screen h1')).toHaveText(playlist.name);
    await expect(page.locator('.shared-playlist-row')).toHaveCount(128);
    await expect(page.locator('.shared-playlist-row.is-unavailable')).toHaveCount(126);

    const before = await page.evaluate(() => ({
      queueIds: JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue.items.map((item: { stationuuid: string }) => item.stationuuid),
      source: JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue.sourceId,
      audioSrc: document.querySelector('audio')?.getAttribute('src'),
      audioState: document.querySelector('audio')?.getAttribute('data-ra-state')
    }));
    await page.getByRole('button', { name: /Сохранить копию|Save a copy/ }).click();
    await expect(page.getByRole('button', { name: /Сохранено в плейлисты|Saved to playlists/ })).toBeDisabled();
    await expect.poll(() => savedCollection(page)).toMatchObject({ name: playlist.name, stationIds: orderedIds });
    const saved = await savedCollection(page) as { stationIds: string[] };
    expect(new Set(saved.stationIds).size).toBe(128);
    expect(await page.evaluate((name) => JSON.parse(localStorage.getItem('radio:library:v2') || '{}').collections.filter((item: { name: string }) => item.name === name).length, playlist.name)).toBe(2);
    const after = await page.evaluate(() => ({
      queueIds: JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue.items.map((item: { stationuuid: string }) => item.stationuuid),
      source: JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue.sourceId,
      audioSrc: document.querySelector('audio')?.getAttribute('src'),
      audioState: document.querySelector('audio')?.getAttribute('data-ra-state')
    }));
    expect(after).toEqual(before);

    await page.locator('.shared-playlist-back').click();
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Моё', exact: true }).click();
    await expect(page.getByRole('tabpanel', { name: 'Плейлисты' }).getByRole('button', { name: new RegExp(playlist.name) }).first()).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue.sourceId)).toBe('existing-queue');
  });

  test('Listen uses only available stations in original order as the full queue', async ({ page }) => {
    await seedPage(page);
    await page.goto(`/?playlist=${token}`);
    await expect(page.locator('.shared-playlist-row')).toHaveCount(128);
    await page.locator('.shared-playlist-actions').getByRole('button', { name: 'Слушать', exact: true }).click();
    await expect.poll(() => page.evaluate(() => {
      const queue = JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue;
      return { ids: queue.items?.map((item: { stationuuid: string }) => item.stationuuid), index: queue.currentIndex, source: queue.sourceId };
    })).toEqual({ ids: [stations[0].stationuuid, stations[1].stationuuid], index: 0, source: 'shared-playlist' });
  });

  test('playing a later available row keeps the full available queue and selects that row', async ({ page }) => {
    await seedPage(page);
    await page.goto(`/?playlist=${token}`);
    await expect(page.locator('.shared-playlist-row')).toHaveCount(128);
    await page.getByRole('button', { name: /Слушать с «Osaka Nights»|Listen from Osaka Nights/ }).click();
    await expect.poll(() => page.evaluate(() => {
      const queue = JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue;
      return { ids: queue.items?.map((item: { stationuuid: string }) => item.stationuuid), index: queue.currentIndex, source: queue.sourceId };
    })).toEqual({ ids: [stations[0].stationuuid, stations[1].stationuuid], index: 1, source: 'shared-playlist' });
  });

  test('owner publishes, reloads and copies a link, then revokes it while the collection remains', async ({ page }) => {
    await seedPage(page, { owner: true });
    let currentShare: { token: string; collectionId: string; name: string; description: string | null; stationIds: string[]; updatedAt: number } | null = null;
    let createPayload: unknown;
    await page.route(/\/me\/collection-shares(?:\/.*)?$/, async (route) => {
      const method = route.request().method();
      if (method === 'GET') return currentShare
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ share: currentShare }) })
        : route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not found' }) });
      if (method === 'POST') {
        createPayload = route.request().postDataJSON();
        currentShare = { token: 'owner-link-e2e', collectionId, name: playlist.name, description: null, stationIds: orderedIds, updatedAt: 1780000001000 };
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ share: currentShare }) });
      }
      if (method === 'DELETE') {
        currentShare = null;
        return route.fulfill({ status: 204, body: '' });
      }
      return route.fallback();
    });

    const detail = await openCollection(page);
    await detail.getByRole('button', { name: 'Поделиться', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Создать ссылку', exact: true }).click();
    await expect(page.locator('#collection-share-link')).toHaveValue(/playlist=owner-link-e2e/);
    expect(createPayload).toMatchObject({ collection: { id: collectionId, stationIds: orderedIds } });
    await dialog.locator('.collection-share-actions button').click();
    await expect(dialog.getByRole('status')).toContainText('Ссылка скопирована');
    expect(await page.evaluate(() => (window as any).__copiedPlaylistUrl)).toContain('playlist=owner-link-e2e');

    await dialog.getByRole('button', { name: 'Закрыть' }).click();
    await detail.getByRole('button', { name: 'Поделиться', exact: true }).click();
    await expect(page.locator('#collection-share-link')).toHaveValue(/playlist=owner-link-e2e/);
    await page.getByRole('dialog').getByRole('button', { name: 'Отключить ссылку', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Ссылка на плейлист отозвана');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('radio:library:v2') || '{}').collections.some((item: { id: string }) => item.id === 'playlist-share-e2e'))).toBe(true);
    await page.goto('/?playlist=owner-link-e2e');
    await expect(page.locator('.shared-playlist-state')).toContainText('Плейлист недоступен');
  });

  test('a failed revoke leaves the live link and collection available for retry', async ({ page }) => {
    await seedPage(page, { owner: true });
    const active = { token: 'owner-link-e2e', collectionId, name: playlist.name, description: null, stationIds: orderedIds, updatedAt: 1780000001000 };
    await page.route(/\/me\/collection-shares(?:\/.*)?$/, (route) => {
      if (route.request().method() === 'DELETE') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'unavailable' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ share: active }) });
    });
    const detail = await openCollection(page);
    await detail.getByRole('button', { name: 'Поделиться', exact: true }).click();
    await expect(page.locator('#collection-share-link')).toHaveValue(/playlist=owner-link-e2e/);
    await page.getByRole('dialog').getByRole('button', { name: 'Отключить ссылку', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Не удалось отозвать ссылку');
    await expect(page.locator('#collection-share-link')).toHaveValue(/playlist=owner-link-e2e/);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('radio:library:v2') || '{}').collections.some((item: { id: string }) => item.id === 'playlist-share-e2e'))).toBe(true);
  });

  test('guest share management opens the account sign-in prompt', async ({ page }) => {
    await seedPage(page);
    await page.goto('/?calm=1');
    const detail = await openCollection(page);
    await detail.getByRole('button', { name: 'Поделиться', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Войди, чтобы опубликовать ссылку или управлять ею.');
    await dialog.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page.locator('.account-sheet-panel')).toBeVisible();
  });
});

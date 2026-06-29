import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

// PR-4 (library batch): turn the ephemeral queue into a permanent Playlist in
// one action. The load-bearing part is the station CACHE: the queue holds
// StationLite that may not be in the cache, so the new playlist must remember
// them or it renders dangling (empty) rows. These tests seed a queue that is
// deliberately NOT in the station cache to exercise that path.

const [tokyo, osaka, kyoto] = stations;

const installPlayProbe = async (page: Page) => {
  await page.addInitScript(() => {
    (window as unknown as { __playSrcs: string[] }).__playSrcs = [];
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      (window as unknown as { __playSrcs: string[] }).__playSrcs.push(
        this.src || this.currentSrc || ''
      );
      this.setAttribute('data-ra-state', 'playing');
      this.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    };
  });
};

const STATION_SLUGS = stations.map((s) => s.url_resolved.split('/').pop() as string);
const distinctPlayedStations = (page: Page) =>
  page.evaluate((slugs) => {
    const srcs = (window as unknown as { __playSrcs: string[] }).__playSrcs;
    return slugs.filter((slug) => srcs.some((src) => src.includes(slug))).length;
  }, STATION_SLUGS);

const queueLength = (page: Page) =>
  page.evaluate(() => {
    const raw = window.localStorage.getItem('radio:player:v2');
    return raw ? JSON.parse(raw)?.queue?.items?.length ?? 0 : 0;
  });

// Seed the queue tab with an EMPTY station cache, then inject a multi-item queue
// straight into the persisted player state (runs after seedRadioState's init
// script). The queue's stations are therefore absent from the cache.
const seedUncachedQueue = async (page: Page) => {
  await seedRadioState(page, {
    activeSection: 'library',
    libraryTab: 'queue',
    queue: [],
    stationCache: [],
    collections: []
  });
  await page.addInitScript((items) => {
    const raw = window.localStorage.getItem('radio:player:v2');
    if (!raw) return;
    const state = JSON.parse(raw);
    state.queue = {
      items,
      currentIndex: 0,
      sourceId: 'seeded-queue',
      sourceLabel: 'Seeded Queue'
    };
    window.localStorage.setItem('radio:player:v2', JSON.stringify(state));
  }, [tokyo, osaka, kyoto]);
};

test.beforeEach(async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page);
  await installPlayProbe(page);
  await page.setViewportSize({ width: 390, height: 844 });
});

test('saving the queue creates a playlist whose stations resolve and are visible', async ({
  page
}) => {
  await seedUncachedQueue(page);
  await page.goto('/?api=/api');
  await expect.poll(() => queueLength(page)).toBe(3);

  // Start the queue so we can prove playback survives the save.
  // The queue hero «Слушать» (declutter #146 renamed it from «Слушать текущую»).
  await page.locator('.library-queue-hero-play').click();
  await expect(page.locator('.player-dock-bar')).toBeVisible();
  expect(await distinctPlayedStations(page)).toBe(1);

  // Save as playlist → inline name form (prefilled) → save.
  await page.getByRole('button', { name: /Сохранить как плейлист|Save as playlist/ }).click();
  const nameInput = page.locator('.library-save-queue-row input');
  await expect(nameInput).toBeVisible();
  await expect(nameInput).not.toHaveValue('');
  await nameInput.fill('Road trip');
  await page.locator('.library-save-queue-row').getByRole('button', { name: /Сохранить|Save/ }).click();

  // Lands on the Playlists tab with a toast and the new playlist.
  await expect(page.locator('.library-inline-toast')).toContainText(/Road trip/);
  const card = page.locator('.library-collection-card').filter({ hasText: 'Road trip' });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText(/3/); // count
  // THE critical assertion: the stations RESOLVE (not dangling) — the preview
  // shows real station rows, not the empty-playlist branch.
  await expect(card.locator('.station-title').first()).toBeVisible();
  await expect(card).toContainText(/Tokyo FM|Osaka Nights|Kyoto Groove/);
  await expect(card.getByText(/пустой|empty/i)).toHaveCount(0);

  // Open the detail and confirm all three stations are listed.
  await card.locator('.library-collection-title-button').click();
  await expect(page.locator('[data-library-collection-row]')).toHaveCount(3);

  // never-auto-switch: the save is a pure data-op — playback never moved.
  expect(await distinctPlayedStations(page)).toBe(1);
  expect(await queueLength(page)).toBe(3);
});

test('the save-as-playlist action is hidden when the queue is empty', async ({ page }) => {
  await seedRadioState(page, { activeSection: 'library', libraryTab: 'queue', queue: [] });
  await page.goto('/?api=/api');
  // Declutter #146: the queue hero + action row (incl. «Сохранить как плейлист»)
  // render ONLY when the queue is non-empty; an empty queue shows the empty-state.
  await expect(
    page.getByRole('button', { name: /Сохранить как плейлист|Save as playlist/ })
  ).toHaveCount(0);
});

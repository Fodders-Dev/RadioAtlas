import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations, waitForAnimationsToSettle } from './helpers';

const queueState = (page: Page) => page.evaluate(() => {
  const raw = window.localStorage.getItem('radio:player:v2');
  return raw ? JSON.parse(raw).queue as { items: Array<{ stationuuid: string }>; currentIndex: number } : null;
});

const playCalls = (page: Page) => page.evaluate(() =>
  (window as typeof window & { __feedQueuePlayCalls?: number }).__feedQueuePlayCalls ?? 0
);

const setup = async (
  page: Page,
  queue: typeof stations,
  currentIndex: number,
  sourceId?: string | null,
  viewport = { width: 390, height: 844 },
  sourceLabel = 'Seeded Home'
) => {
  await page.setViewportSize(viewport);
  await installMediaMocks(page);
  await mockStations(page);
  await seedRadioState(page, {
    activeSection: 'feed',
    queue,
    queueCurrentIndex: currentIndex,
    queueSourceId: sourceId === undefined ? 'seeded-home' : sourceId,
    queueSourceLabel: sourceLabel
  });
  await page.addInitScript(() => {
    (window as typeof window & { __feedQueuePlayCalls?: number }).__feedQueuePlayCalls = 0;
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      const windowWithProbe = window as typeof window & { __feedQueuePlayCalls?: number };
      windowWithProbe.__feedQueuePlayCalls = (windowWithProbe.__feedQueuePlayCalls ?? 0) + 1;
      return originalPlay.apply(this, args);
    };
  });
  await page.goto('/?calm=1');
  await expect(page.locator('.station-feed-overlay')).toBeVisible();
  await expect(page.locator('.station-feed-card').first()).toBeVisible();
  await waitForAnimationsToSettle(page, '.station-feed-card-content[data-focus="true"]');
};

const renderedStationIds = (page: Page) => page.locator('.station-feed-card').evaluateAll((cards) =>
  cards.map((card) => card.getAttribute('data-feed-station'))
);

const audioState = (page: Page) => page.evaluate(() => {
  const audio = document.querySelector('audio');
  return { src: audio?.getAttribute('src') ?? null, playing: audio?.getAttribute('data-ra-state') === 'playing' };
});

const setupMiniQueue = async (
  page: Page,
  queue: typeof stations,
  currentIndex: number,
  sourceId: string,
  viewport = { width: 390, height: 844 }
) => {
  await page.setViewportSize(viewport);
  await installMediaMocks(page);
  await mockStations(page);
  await seedRadioState(page, {
    activeSection: 'home',
    queue,
    queueCurrentIndex: currentIndex,
    queueSourceId: sourceId,
    queueSourceLabel: 'Избранное',
    stationCache: queue
  });
  await page.addInitScript(() => {
    (window as typeof window & { __feedQueuePlayCalls?: number }).__feedQueuePlayCalls = 0;
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      const windowWithProbe = window as typeof window & { __feedQueuePlayCalls?: number };
      windowWithProbe.__feedQueuePlayCalls = (windowWithProbe.__feedQueuePlayCalls ?? 0) + 1;
      return originalPlay.apply(this, args);
    };
  });
  await page.goto('/?calm=1');
  await expect(page.locator('[data-calm-player]')).toBeVisible();
  await page.locator('[data-calm-player] .calm-mini-info').click();
  await expect(page.locator('.station-feed-overlay')).toBeVisible();
  await waitForAnimationsToSettle(page, '.station-feed-card-content[data-focus="true"]');
};

for (const [size, currentIndex] of [[1, 0], [2, 1], [4, 2]] as const) {
  test(`explicit calm queue of ${size} keeps order, position and truthful status`, async ({ page }) => {
    const queue = stations.slice(0, size);
    await setup(page, queue, currentIndex);
    const expectedIds = queue.map((station) => station.stationuuid);
    await expect.poll(() => renderedStationIds(page)).toEqual(expectedIds);
    await expect(page.locator('.calm-slide-queue').first().locator('strong')).toHaveText(`Очередь · ${currentIndex + 1} из ${queue.length}`);
    await expect(page.locator('.calm-slide-queue').first().locator('small')).toHaveText('Seeded Home');
    await expect(page.locator('.station-feed-status')).toHaveText(`Seeded Home · ${currentIndex + 1} из ${queue.length}`);
    expect(await playCalls(page)).toBe(0);
  });
}

test('Calm Feed queue entry opens the canonical queue and returns without changing playback', async ({ page }) => {
  const queue = stations.slice(0, 3);
  await setupMiniQueue(page, queue, 1, 'favorites');
  const activeCard = page.locator('.station-feed-card-content[data-focus="true"]');
  await activeCard.locator('.calm-listen').click();
  await expect(activeCard.locator('.calm-feed-status')).toHaveAttribute('data-status', 'playing');
  const beforeAudio = await audioState(page);
  expect(beforeAudio.src).toBeTruthy();
  expect(beforeAudio.playing).toBe(true);
  const beforePlayCalls = await playCalls(page);
  const beforeQueue = await queueState(page);

  const queueButton = activeCard.locator('[data-feed-action="queue"]');
  await expect(queueButton.locator('strong')).toHaveText('Очередь · 2 из 3');
  await expect(queueButton.locator('small')).toHaveText('Избранное');
  await queueButton.focus();
  await page.keyboard.press('Enter');

  const queuePanel = page.locator('.library-queue-shell');
  await expect(queuePanel).toBeVisible();
  await expect(queuePanel).toBeFocused();
  await expect(page.getByRole('button', { name: 'К плееру', exact: true })).toBeVisible();
  expect(await queueState(page)).toEqual(beforeQueue);
  expect(await audioState(page)).toEqual(beforeAudio);
  expect(await playCalls(page)).toBe(beforePlayCalls);

  await page.getByRole('button', { name: 'К плееру', exact: true }).click();
  await expect(page.locator('.station-feed-overlay')).toBeVisible();
  await expect(page.locator('.station-feed-card:has(.station-feed-card-content[data-focus="true"])')).toHaveAttribute('data-feed-station', queue[1].stationuuid);
  expect(await queueState(page)).toEqual(beforeQueue);
  expect(await audioState(page)).toEqual(beforeAudio);
});

test('discovery queue entry reports the real queue count', async ({ page }) => {
  await setup(page, stations.slice(0, 2), 1, 'home-calm');
  const discoveryButton = page.locator('.station-feed-card-content[data-focus="true"] .calm-slide-queue');
  await expect(discoveryButton.locator('strong')).toHaveText('Очередь · 2');
  await expect(discoveryButton.locator('small')).toHaveText('Новые эфиры');
  await expect(discoveryButton.locator('strong')).not.toHaveText(/из/);
  await discoveryButton.click();
  await expect(page.locator('.library-queue-shell')).toBeVisible();
  await expect(page.locator('[data-queue-row]')).toHaveCount(2);
  expect(await queueState(page)).toMatchObject({ items: stations.slice(0, 2), currentIndex: 1 });
});

test('a paused singleton opens its queue and returns without starting playback', async ({ page }) => {
  await setupMiniQueue(page, [stations[0]], 0, 'favorites');
  expect(await playCalls(page)).toBe(0);
  await expect(page.locator('.station-feed-card-content[data-focus="true"] .calm-feed-status')).toHaveAttribute('data-status', 'paused');
  const beforeQueue = await queueState(page);
  const beforeAudio = await audioState(page);
  await page.locator('.station-feed-card-content[data-focus="true"] .calm-slide-queue').click();
  await expect(page.locator('.library-queue-shell')).toBeVisible();
  await expect(page.getByRole('button', { name: 'К плееру', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'К плееру', exact: true }).click();
  await expect(page.locator('.station-feed-overlay')).toBeVisible();
  expect(await playCalls(page)).toBe(0);
  expect(await queueState(page)).toEqual(beforeQueue);
  expect(await audioState(page)).toEqual(beforeAudio);
});

for (const viewport of [
  { width: 320, height: 700 },
  { width: 390, height: 844 },
  { width: 834, height: 1112 },
  { width: 1280, height: 720 },
  { width: 1440, height: 900 }
] as const) {
  test(`Calm queue entry stays reachable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await setup(page, stations.slice(0, 2), 1, 'favorites', viewport, 'Очень длинное название сохранённой очереди');
    const metrics = await page.locator('.station-feed-card-content[data-focus="true"] .calm-slide-queue').evaluate((node) => {
      const queueRect = node.getBoundingClientRect();
      const timerRect = node.parentElement?.querySelector<HTMLElement>('.calm-slide-timer')?.getBoundingClientRect();
      const inactive = Array.from(document.querySelectorAll<HTMLElement>('.station-feed-card-content[data-focus="false"] [data-feed-action="queue"]'));
      return {
        queue: { left: queueRect.left, right: queueRect.right, top: queueRect.top, bottom: queueRect.bottom, width: queueRect.width, height: queueRect.height },
        timer: timerRect ? { left: timerRect.left, right: timerRect.right, top: timerRect.top, bottom: timerRect.bottom } : null,
        inactiveTabs: inactive.map((button) => button.tabIndex),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth
      };
    });
    expect(metrics.queue.width).toBeGreaterThanOrEqual(44);
    expect(metrics.queue.height).toBeGreaterThanOrEqual(44);
    expect(metrics.queue.left).toBeGreaterThanOrEqual(0);
    expect(metrics.queue.right).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.queue.top).toBeGreaterThanOrEqual(0);
    expect(metrics.queue.bottom).toBeLessThanOrEqual(metrics.viewportHeight);
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    if (metrics.timer) {
      const separated = metrics.queue.right <= metrics.timer.left || metrics.timer.right <= metrics.queue.left || metrics.queue.bottom <= metrics.timer.top || metrics.timer.bottom <= metrics.queue.top;
      expect(separated).toBe(true);
    }
    expect(metrics.inactiveTabs.length).toBeGreaterThan(0);
    expect(metrics.inactiveTabs.every((tabIndex) => tabIndex === -1)).toBe(true);
  });
}

test('a two-station queue advances and returns through keyboard-accessible Feed controls', async ({ page }) => {
  await setup(page, stations.slice(0, 2), 0);
  const activeCard = () => page.locator('.station-feed-card:has(.station-feed-card-content[data-focus="true"])');
  await expect(activeCard()).toHaveAttribute('data-feed-station', stations[0].stationuuid);
  await activeCard().locator('[data-feed-action="next"]').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => queueState(page).then((state) => state?.currentIndex)).toBe(1);
  await expect(activeCard()).toHaveAttribute('data-feed-station', stations[1].stationuuid);
  await expect.poll(() => playCalls(page)).toBeGreaterThan(0);
  await activeCard().locator('[data-feed-action="prev"]').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => queueState(page).then((state) => state?.currentIndex)).toBe(0);
  await expect(activeCard()).toHaveAttribute('data-feed-station', stations[0].stationuuid);
});

for (const size of [1, 2] as const) {
  test(`the end of a ${size}-station queue opens discovery without starting audio`, async ({ page }) => {
    const queue = stations.slice(0, size);
    await setup(page, queue, queue.length - 1);
    await expect(page.locator('.calm-queue-end')).toBeVisible();
    const before = await queueState(page);
    await page.locator('.calm-queue-end').click();
    await expect(page.locator('.calm-queue-end')).toHaveCount(0);
    await expect.poll(() => playCalls(page)).toBe(0);
    expect(await queueState(page)).toMatchObject({ currentIndex: before?.currentIndex });
  });
}

for (const viewport of [
  { width: 320, height: 700 },
  { width: 390, height: 844 },
  { width: 834, height: 1112 },
  { width: 1024, height: 600 },
  { width: 1280, height: 720 }
] as const) {
  test(`queue continuation clears Play target at ${viewport.width}px`, async ({ page }) => {
    await setup(page, stations.slice(0, 2), 1, undefined, viewport);
    const geometry = await page.locator('.station-feed-card-content[data-focus="true"]').evaluate((card) => {
      const play = card.querySelector<HTMLElement>('.calm-listen')?.getBoundingClientRect();
      const continuation = card.querySelector<HTMLElement>('.calm-queue-end')?.getBoundingClientRect();
      const rail = card.querySelector<HTMLElement>('.calm-slide-rail')?.getBoundingClientRect();
      const capture = card.querySelector<HTMLElement>('.calm-feed-capture')?.parentElement?.getBoundingClientRect();
      return {
        playBottom: play?.bottom ?? null,
        continuationTop: continuation?.top ?? null,
        railBottom: rail?.bottom ?? null,
        captureBottom: capture?.bottom ?? null
      };
    });
    expect(geometry.playBottom).not.toBeNull();
    expect(geometry.continuationTop).not.toBeNull();
    expect(geometry.continuationTop!).toBeGreaterThanOrEqual(geometry.playBottom! + 8);
    expect(geometry.railBottom).not.toBeNull();
    expect(geometry.captureBottom).not.toBeNull();
    expect(geometry.continuationTop!).toBeGreaterThanOrEqual(geometry.railBottom! + 8);
    expect(geometry.continuationTop!).toBeGreaterThanOrEqual(geometry.captureBottom! + 8);
  });
}

for (const viewport of [
  { width: 320, height: 700 },
  { width: 390, height: 844 },
  { width: 834, height: 1112 },
  { width: 1024, height: 600 },
  { width: 1280, height: 720 }
] as const) {
  test(`enabled Calm rail controls receive real pointer clicks at ${viewport.width}px`, async ({ page }) => {
    await setup(page, stations.slice(0, 3), 1, undefined, viewport);
    const activeCard = () => page.locator('.station-feed-card:has(.station-feed-card-content[data-focus="true"])');
    const rail = activeCard().locator('.calm-slide-rail');
    const assertRailLayout = async () => {
      const layout = await rail.evaluate((node) => {
        const card = node.closest<HTMLElement>('.station-feed-card-content');
        const topbar = card?.querySelector<HTMLElement>('.calm-slide-top')?.getBoundingClientRect();
        const timer = card?.querySelector<HTMLElement>('.calm-slide-timer')?.getBoundingClientRect();
        const buttons = Array.from(node.querySelectorAll<HTMLButtonElement>('button:not([disabled])')).map((button) => {
          const rect = button.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return {
            width: rect.width,
            height: rect.height,
            top: rect.top,
            pointerHit: Boolean(hit && (hit === button || button.contains(hit)))
          };
        });
        return {
          headerBottom: topbar?.bottom ?? null,
          timerBottom: timer?.bottom ?? null,
          buttons
        };
      });
      expect(layout.buttons.length).toBeGreaterThan(0);
      expect(layout.buttons.every((button) => button.width >= 44 && button.height >= 44)).toBe(true);
      expect(layout.buttons.every((button) => button.pointerHit)).toBe(true);
      const clearance = Math.max(layout.headerBottom ?? 0, layout.timerBottom ?? 0) + 8;
      expect(layout.buttons.every((button) => button.top >= clearance)).toBe(true);
    };
    await assertRailLayout();

    await activeCard().locator('[data-feed-action="next"]').click();
    await expect.poll(() => queueState(page).then((state) => state?.currentIndex)).toBe(2);
    await expect(activeCard()).toHaveAttribute('data-feed-station', stations[2].stationuuid);
    await assertRailLayout();
    await activeCard().locator('[data-feed-action="prev"]').click();
    await expect.poll(() => queueState(page).then((state) => state?.currentIndex)).toBe(1);
    await expect(activeCard()).toHaveAttribute('data-feed-station', stations[1].stationuuid);
  });
}

test('reopening a personal queue preserves its position and paused audio state', async ({ page }) => {
  const queue = stations.slice(0, 4);
  await setup(page, queue, 2);
  await expect(page.locator('.calm-slide-queue').first().locator('strong')).toHaveText('Очередь · 3 из 4');
  await expect(page.locator('.calm-slide-queue').first().locator('small')).toHaveText('Seeded Home');
  await page.locator('.app-navigation-mobile').getByRole('button', { name: 'Главная', exact: true }).click();
  await expect(page.locator('.station-feed-overlay')).toHaveCount(0);
  await page.locator('.app-navigation-mobile').getByRole('button', { name: 'Лента', exact: true }).click();
  await expect(page.locator('.station-feed-overlay')).toBeVisible();
  await expect(page.locator('.calm-slide-queue').first().locator('strong')).toHaveText('Очередь · 3 из 4');
  await expect(page.locator('.calm-slide-queue').first().locator('small')).toHaveText('Seeded Home');
  await expect(page.locator('.calm-feed-status[data-status="paused"]')).toBeVisible();
  expect(await playCalls(page)).toBe(0);
});

for (const sourceId of ['home-calm', 'discovery-feed', null] as const) {
  test(`source ${sourceId ?? 'none'} stays out of personal calm queue mode`, async ({ page }) => {
    await setup(page, stations.slice(0, 2), 1, sourceId);
    await expect(page.locator('.calm-slide-queue').first().locator('strong')).toHaveText('Очередь · 2');
    await expect(page.locator('.calm-slide-queue').first().locator('strong')).not.toHaveText(/из 2/);
    await expect(page.locator('.calm-slide-queue').first().locator('small')).toHaveText('Новые эфиры');
    await expect(page.locator('.calm-queue-end')).toHaveCount(0);
    await expect(page.locator('.station-feed-status')).not.toHaveText(/Seeded Home|home-calm|discovery-feed/);
    expect(await playCalls(page)).toBe(0);
  });
}

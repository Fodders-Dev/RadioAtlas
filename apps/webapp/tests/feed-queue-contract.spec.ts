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
  viewport = { width: 390, height: 844 }
) => {
  await page.setViewportSize(viewport);
  await installMediaMocks(page);
  await mockStations(page);
  await seedRadioState(page, {
    activeSection: 'feed',
    queue,
    queueCurrentIndex: currentIndex,
    queueSourceId: sourceId === undefined ? 'seeded-home' : sourceId,
    queueSourceLabel: sourceId === undefined ? 'Seeded Home' : sourceId
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

for (const [size, currentIndex] of [[1, 0], [2, 1], [4, 2]] as const) {
  test(`explicit calm queue of ${size} keeps order, position and truthful status`, async ({ page }) => {
    const queue = stations.slice(0, size);
    await setup(page, queue, currentIndex);
    const expectedIds = queue.map((station) => station.stationuuid);
    await expect.poll(() => renderedStationIds(page)).toEqual(expectedIds);
    await expect(page.locator('.calm-slide-tab').first()).toHaveText(`Seeded Home · ${currentIndex + 1} из ${queue.length}`);
    await expect(page.locator('.station-feed-status')).toHaveText(`Seeded Home · ${currentIndex + 1} из ${queue.length}`);
    expect(await playCalls(page)).toBe(0);
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
  await expect(page.locator('.calm-slide-tab').first()).toHaveText('Seeded Home · 3 из 4');
  await page.locator('.app-navigation-mobile').getByRole('button', { name: 'Главная', exact: true }).click();
  await expect(page.locator('.station-feed-overlay')).toHaveCount(0);
  await page.locator('.app-navigation-mobile').getByRole('button', { name: 'Лента', exact: true }).click();
  await expect(page.locator('.station-feed-overlay')).toBeVisible();
  await expect(page.locator('.calm-slide-tab').first()).toHaveText('Seeded Home · 3 из 4');
  await expect(page.locator('.calm-feed-status[data-status="paused"]')).toBeVisible();
  expect(await playCalls(page)).toBe(0);
});

for (const sourceId of ['home-calm', 'discovery-feed', null] as const) {
  test(`source ${sourceId ?? 'none'} stays out of personal calm queue mode`, async ({ page }) => {
    await setup(page, stations.slice(0, 2), 1, sourceId);
    await expect(page.locator('.calm-slide-tab').first()).not.toHaveText(/из 2/);
    await expect(page.locator('.calm-queue-end')).toHaveCount(0);
    await expect(page.locator('.station-feed-status')).not.toHaveText(/Seeded Home|home-calm|discovery-feed/);
    expect(await playCalls(page)).toBe(0);
  });
}

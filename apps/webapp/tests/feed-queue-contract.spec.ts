import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations, waitForAnimationsToSettle } from './helpers';

const queueState = (page: Page) => page.evaluate(() => {
  const raw = window.localStorage.getItem('radio:player:v2');
  return raw ? JSON.parse(raw).queue as { items: Array<{ stationuuid: string }>; currentIndex: number; sourceId: string | null; sourceLabel: string | null } : null;
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

for (const sourceId of ['discovery-feed', 'home-calm', 'home-live'] as const) {
  test(`cold paused ${sourceId} queue restores its late position without starting audio through viewport changes`, async ({ page }) => {
    const queue = stations.slice(0, 8);
    const currentIndex = 5;
    const current = queue[currentIndex];
    await setup(page, queue, currentIndex, sourceId, { width: 390, height: 844 });

    const activeCard = () => page.locator('.station-feed-card:has(.station-feed-card-content[data-focus="true"])');
    const assertRestoredPause = async () => {
      await expect(activeCard())
        .toHaveAttribute('data-feed-station', current.stationuuid);
      await expect(activeCard().locator('.calm-feed-status')).toHaveAttribute('data-status', 'paused');
      await expect.poll(() => queueState(page).then((state) => state?.currentIndex)).toBe(currentIndex);
      expect(await playCalls(page)).toBe(0);
    };

    await assertRestoredPause();
    for (const viewport of [
      { width: 834, height: 1112 },
      { width: 1024, height: 768 },
      { width: 390, height: 844 }
    ]) {
      await page.setViewportSize(viewport);
      await waitForAnimationsToSettle(page, '.station-feed-card-content[data-focus="true"]');
      await page.waitForTimeout(300);
      await assertRestoredPause();
    }
  });
}

test('portrait tablet shows a full-height paused card and selects real upcoming queue rows explicitly', async ({ page }) => {
  const queue = stations.slice(0, 8);
  const initialIndex = 3;
  await setup(page, queue, initialIndex, 'favorites', { width: 834, height: 1112 });
  const activeCard = () => page.locator('.station-feed-card:has(.station-feed-card-content[data-focus="true"])');
  await expect(activeCard()).toHaveAttribute('data-feed-index', String(initialIndex));
  await expect(activeCard()).toHaveAttribute('data-feed-station', queue[initialIndex].stationuuid);
  await expect(activeCard().locator('.calm-feed-status')).toHaveAttribute('data-status', 'paused');
  expect(await playCalls(page)).toBe(0);

  const geometry = await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('.station-feed-scroller');
    const card = document.querySelector<HTMLElement>('.station-feed-card[data-feed-index="3"]');
    const content = card?.querySelector<HTMLElement>('.station-feed-card-content');
    const deck = document.querySelector<HTMLElement>('.calm-feed-deck');
    const nav = document.querySelector<HTMLElement>('.app-navigation-mobile');
    const rect = (node?: HTMLElement | null) => {
      const value = node?.getBoundingClientRect();
      return value ? { top: value.top, bottom: value.bottom, height: value.height } : null;
    };
    return {
      scrollerClientHeight: scroller?.clientHeight ?? 0,
      cardOffsetHeight: card?.offsetHeight ?? 0,
      cardCssHeight: card ? getComputedStyle(card).height : '',
      card: rect(card),
      content: rect(content),
      deck: rect(deck),
      nav: rect(nav),
      deckOverflowY: deck ? getComputedStyle(deck.querySelector('ol')!).overflowY : ''
    };
  });
  expect(geometry.scrollerClientHeight).toBe(680);
  expect(geometry.cardOffsetHeight).toBe(geometry.scrollerClientHeight);
  expect(geometry.cardCssHeight).toBe('680px');
  expect(geometry.content?.bottom).toBe(geometry.card?.bottom);
  expect(geometry.deck?.top).toBeGreaterThanOrEqual(geometry.card!.bottom + 8);
  expect(geometry.deckOverflowY).toBe('auto');
  expect(geometry.deck?.bottom).toBeLessThanOrEqual(geometry.nav!.top - 8);

  await page.locator(`[data-feed-deck-item="${queue[initialIndex + 1].stationuuid}"]`).click();
  await expect.poll(() => queueState(page).then((state) => state?.currentIndex)).toBe(initialIndex + 1);
  await expect(activeCard()).toHaveAttribute('data-feed-station', queue[initialIndex + 1].stationuuid);
  await expect.poll(() => playCalls(page)).toBeGreaterThan(0);
  await activeCard().locator('[data-feed-action="next"]').click();
  await expect.poll(() => queueState(page).then((state) => state?.currentIndex)).toBe(initialIndex + 2);
  await expect(activeCard()).toHaveAttribute('data-feed-station', queue[initialIndex + 2].stationuuid);
});

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

test('Calm Feed queue entry opens a local chooser and keeps Library editing explicit', async ({ page }) => {
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

  const chooser = page.getByRole('dialog', { name: 'Моя очередь' });
  await expect(chooser).toBeVisible();
  await expect(chooser.getByRole('heading', { name: 'Моя очередь' })).toBeVisible();
  await expect(chooser.getByText('Место 2 из 3')).toBeVisible();
  await expect(chooser.locator('[data-feed-queue-row]')).toHaveCount(2);
  await expect(chooser.locator('[data-feed-queue-row]').first()).toHaveAttribute('data-feed-queue-row', queue[1].stationuuid);
  const previousToggle = chooser.getByRole('button', { name: 'Ранее в наборе' });
  await expect(previousToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(chooser.locator(`[data-feed-queue-row="${queue[0].stationuuid}"]`)).toHaveCount(0);
  await previousToggle.focus();
  await page.keyboard.press('Tab');
  await expect(chooser.getByRole('button', { name: 'Редактировать очередь' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(chooser.locator('.feed-queue-peek-close')).toBeFocused();
  expect(await queueState(page)).toEqual(beforeQueue);
  expect(await audioState(page)).toEqual(beforeAudio);
  expect(await playCalls(page)).toBe(beforePlayCalls);

  await chooser.getByRole('button', { name: 'Редактировать очередь' }).click();
  const queuePanel = page.locator('.library-queue-shell');
  await expect(queuePanel).toBeVisible();
  await expect(queuePanel).toBeFocused();
  await expect(page.getByRole('button', { name: 'К плееру', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'К плееру', exact: true }).click();
  await expect(page.locator('.station-feed-overlay')).toBeVisible();
  await expect(page.locator('.station-feed-card:has(.station-feed-card-content[data-focus="true"])')).toHaveAttribute('data-feed-station', queue[1].stationuuid);
  expect(await queueState(page)).toEqual(beforeQueue);
  expect(await audioState(page)).toEqual(beforeAudio);
});

test('choosing an upcoming queue row plays through the same queue source and returns focus to that card', async ({ page }) => {
  const queue = stations.slice(0, 3);
  await setupMiniQueue(page, queue, 0, 'favorites');
  const originalQueue = await queueState(page);
  await page.locator('.station-feed-card-content[data-focus="true"] .calm-slide-queue').click();
  const chooser = page.getByRole('dialog', { name: 'Моя очередь' });
  await expect(chooser.locator('[data-feed-queue-row]')).toHaveCount(3);

  await chooser.getByRole('button', { name: `Включить: ${queue[1].name}` }).click();
  await expect(chooser).toHaveCount(0);
  const selectedCard = page.locator(`.station-feed-card[data-feed-index="1"]`);
  await expect(selectedCard).toHaveAttribute('data-feed-station', queue[1].stationuuid);
  await expect(selectedCard.locator('[data-feed-action="queue"]')).toBeFocused();
  await expect.poll(() => queueState(page)).toMatchObject({
    currentIndex: 1,
    sourceId: 'favorites',
    sourceLabel: 'Избранное'
  });
  await expect.poll(() => queueState(page).then((state) => state?.items.map((item) => item.stationuuid))).toEqual(
    originalQueue?.items.map((item) => item.stationuuid)
  );
  await expect.poll(() => playCalls(page)).toBeGreaterThan(0);
});

test('Escape closes the chooser and restores the trigger without moving the Feed or changing playback', async ({ page }) => {
  await setupMiniQueue(page, stations.slice(0, 3), 1, 'favorites');
  const trigger = page.locator('.station-feed-card-content[data-focus="true"] [data-feed-action="queue"]');
  const beforeQueue = await queueState(page);
  const beforeAudio = await audioState(page);
  await trigger.click();
  await expect(page.getByRole('dialog', { name: 'Моя очередь' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-feed-queue-peek]')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await queueState(page)).toEqual(beforeQueue);
  expect(await audioState(page)).toEqual(beforeAudio);
});

test('expanded history stays in one scroll body and keeps narrow rows usable', async ({ page }) => {
  const queue = stations.map((station, index) => index === 7 ? { ...station, name: 'Mosaique FM' } : station);
  await setupMiniQueue(page, queue, 6, 'favorites', { width: 320, height: 700 });
  await page.locator('.station-feed-card-content[data-focus="true"] [data-feed-action="queue"]').click();
  const chooser = page.getByRole('dialog', { name: 'Моя очередь' });
  const body = chooser.locator('[data-feed-queue-peek-body]');
  await chooser.getByRole('button', { name: 'Ранее в наборе' }).click();

  const metrics = await body.evaluate((scrollBody) => {
    const upcoming = scrollBody.querySelector<HTMLElement>('.feed-queue-peek-list');
    const target = scrollBody.querySelector<HTMLElement>('[data-feed-queue-index="8"]');
    const name = target?.querySelector<HTMLElement>('.feed-queue-peek-copy');
    const action = target?.querySelector<HTMLElement>('.feed-queue-peek-action');
    const targetRect = target?.getBoundingClientRect();
    const actionRect = action?.getBoundingClientRect();
    return {
      overflowY: getComputedStyle(scrollBody).overflowY,
      nestedScrollLists: Array.from(scrollBody.querySelectorAll<HTMLElement>('.feed-queue-peek-list')).filter((list) => {
        const style = getComputedStyle(list);
        return (style.overflowY === 'auto' || style.overflowY === 'scroll') && list.scrollHeight > list.clientHeight;
      }).length,
      bodyScrolls: scrollBody.scrollHeight > scrollBody.clientHeight,
      upcomingRowsHeight: upcoming?.getBoundingClientRect().height ?? 0,
      nameWidth: name?.getBoundingClientRect().width ?? 0,
      actionWithinRow: Boolean(targetRect && actionRect && actionRect.right <= targetRect.right && actionRect.left >= targetRect.left),
      bodyHasHorizontalOverflow: scrollBody.scrollWidth > scrollBody.clientWidth
    };
  });
  expect(metrics.overflowY).toBe('auto');
  expect(metrics.nestedScrollLists).toBe(0);
  expect(metrics.bodyScrolls).toBe(true);
  expect(metrics.upcomingRowsHeight).toBeGreaterThanOrEqual(6 * 54);
  expect(metrics.nameWidth).toBeGreaterThanOrEqual(90);
  expect(metrics.actionWithinRow).toBe(true);
  expect(metrics.bodyHasHorizontalOverflow).toBe(false);

  const laterHistoryRow = chooser.locator('[data-feed-queue-row="uuid-saopaulo"]');
  await laterHistoryRow.scrollIntoViewIfNeeded();
  await expect(laterHistoryRow).toBeInViewport();
  await laterHistoryRow.click();
  await expect(chooser).toHaveCount(0);
  await expect(page.locator('.station-feed-card:has(.station-feed-card-content[data-focus="true"])')).toHaveAttribute('data-feed-station', 'uuid-saopaulo');
});

test('discovery chooser names its deck and keeps the personal queue editor distinct', async ({ page }) => {
  await setup(page, stations.slice(0, 2), 1, 'home-calm');
  const discoveryButton = page.locator('.station-feed-card-content[data-focus="true"] .calm-slide-queue');
  await expect(discoveryButton.locator('strong')).toHaveText(/Открывать новое · \d+ из \d+/);
  await expect(discoveryButton.locator('small')).toHaveText('Новые эфиры');
  await discoveryButton.click();
  const chooser = page.getByRole('dialog', { name: 'Дальше в Ленте' });
  await expect(chooser).toBeVisible();
  await expect(chooser.getByRole('heading', { name: 'Дальше в Ленте' })).toBeVisible();
  await expect(chooser.locator('.bottom-sheet-kicker')).toHaveText('Подборка');
  expect(await chooser.locator('[data-feed-queue-row]').count()).toBeGreaterThan(1);
  await chooser.getByRole('button', { name: 'Редактировать очередь' }).click();
  await expect(page.locator('.library-queue-shell')).toBeVisible();
  await expect(page.locator('[data-queue-row]')).toHaveCount(2);
  expect(await queueState(page)).toMatchObject({ items: stations.slice(0, 2), currentIndex: 1 });
});

test('a paused singleton opens its chooser without starting playback', async ({ page }) => {
  await setupMiniQueue(page, [stations[0]], 0, 'favorites');
  expect(await playCalls(page)).toBe(0);
  await expect(page.locator('.station-feed-card-content[data-focus="true"] .calm-feed-status')).toHaveAttribute('data-status', 'paused');
  const beforeQueue = await queueState(page);
  const beforeAudio = await audioState(page);
  await page.locator('.station-feed-card-content[data-focus="true"] .calm-slide-queue').click();
  const chooser = page.getByRole('dialog', { name: 'Моя очередь' });
  await expect(chooser).toBeVisible();
  await expect(chooser.locator('[data-feed-queue-row]')).toHaveCount(1);
  expect(await playCalls(page)).toBe(0);
  expect(await queueState(page)).toEqual(beforeQueue);
  expect(await audioState(page)).toEqual(beforeAudio);
  await chooser.getByRole('button', { name: 'Редактировать очередь' }).click();
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
    await expect(page.locator('.calm-slide-queue').first().locator('strong')).toHaveText(/Открывать новое · \d+ из \d+/);
    await expect(page.locator('.calm-slide-queue').first().locator('strong')).not.toHaveText(/из 2/);
    await expect(page.locator('.calm-slide-queue').first().locator('small')).toHaveText('Новые эфиры');
    await expect(page.locator('.calm-queue-end')).toHaveCount(0);
    await expect(page.locator('.station-feed-status')).not.toHaveText(/Seeded Home|home-calm|discovery-feed/);
    expect(await playCalls(page)).toBe(0);
  });
}

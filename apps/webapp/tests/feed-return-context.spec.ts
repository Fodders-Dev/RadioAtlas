import { expect, test } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations, waitForAnimationsToSettle } from './helpers';

const SEEN = {
  'uuid-rio': { lastShownAt: Date.now() - 60_000, shownCount: 2 },
  'uuid-saopaulo': { lastShownAt: Date.now() - 120_000, shownCount: 1 }
};

test('Feed → Globe view → nav Feed restores the exact discovery card silently', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMediaMocks(page);
  await mockStations(page);
  await seedRadioState(page, {
    activeSection: 'feed',
    queue: stations.slice(0, 10),
    queueCurrentIndex: 4,
    queueSourceId: 'home-live10',
    queueSourceLabel: 'Эфиры сейчас',
    stationExposure: SEEN
  });
  await page.addInitScript(() => {
    (window as typeof window & { __returnFeedPlayCalls?: number }).__returnFeedPlayCalls = 0;
    (window as typeof window & { __returnFeedPlayStacks?: string[] }).__returnFeedPlayStacks = [];
    (window as typeof window & { __returnFeedPlayContexts?: Array<Record<string, unknown>> }).__returnFeedPlayContexts = [];
    const paused = new WeakMap<HTMLMediaElement, boolean>();
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
      configurable: true,
      get() { return paused.get(this) ?? true; }
    });
    HTMLMediaElement.prototype.play = function (...args) {
      const w = window as typeof window & { __returnFeedPlayCalls?: number };
      w.__returnFeedPlayCalls = (w.__returnFeedPlayCalls ?? 0) + 1;
      (window as typeof window & { __returnFeedPlayStacks?: string[] }).__returnFeedPlayStacks?.push(new Error().stack || '');
      const shell = document.querySelector<HTMLElement>('.app-shell-v2');
      const focused = document.querySelector<HTMLElement>('.station-feed-card-content[data-focus="true"]')?.closest<HTMLElement>('.station-feed-card');
      (window as typeof window & { __returnFeedPlayContexts?: Array<Record<string, unknown>> }).__returnFeedPlayContexts?.push({ section: shell?.dataset.activeSection, index: focused?.dataset.feedIndex, station: focused?.dataset.feedStation, scrollTop: document.querySelector<HTMLElement>('.station-feed-scroller')?.scrollTop });
      void args;
      paused.set(this, false);
      this.setAttribute('data-ra-state', 'playing');
      this.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      paused.set(this, true);
      this.setAttribute('data-ra-state', 'paused');
      this.dispatchEvent(new Event('pause'));
    };
  });
  await page.goto('/?calm=1');
  await expect(page.locator('.station-feed-overlay')).toBeVisible();

  const current = page.locator('.station-feed-card-content[data-focus="true"]');
  await current.locator('[data-feed-action="expand"]').click();
  await page.getByRole('button', { name: 'Новое для тебя' }).click();
  await expect(page.locator('.station-feed-status')).toContainText('Новое для тебя');
  const scroller = page.locator('.station-feed-scroller');
  await scroller.evaluate((element) => {
    element.scrollTop = element.clientHeight * 4;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  const focusedCard = page.locator('.station-feed-card[data-feed-index="4"] .station-feed-card-content[data-focus="true"]');
  await expect(focusedCard).toBeVisible();
  await waitForAnimationsToSettle(page, '.station-feed-card-content[data-focus="true"]');
  await expect.poll(() => scroller.evaluate((element) => Math.round(element.scrollTop / element.clientHeight))).toBe(4);
  const selectedCard = page.locator('.station-feed-card[data-feed-index="4"]');
  await expect(selectedCard).toHaveAttribute('data-feed-station', /.+/);
  const selectedId = await selectedCard.getAttribute('data-feed-station');
  const deckBefore = await page.locator('.station-feed-card').evaluateAll((cards) => cards.map((card) => card.getAttribute('data-feed-station')));
  await expect(selectedCard.locator('.calm-feed-status')).toHaveAttribute('data-status', 'playing');
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('radio:player:v2') || '{}');
    const queue = state.queue;
    return queue?.items?.[queue.currentIndex]?.stationuuid ?? null;
  })).toBe(selectedId);
  await selectedCard.locator('[data-feed-action="play"]').click();
  await expect(selectedCard.locator('.calm-feed-status')).toHaveAttribute('data-status', 'paused');
  await expect(page.locator('audio')).toHaveAttribute('data-ra-state', 'paused');
  const queueBefore = await page.evaluate(() => {
    const queue = JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue;
    return { sourceId: queue.sourceId, currentIndex: queue.currentIndex, ids: queue.items.map((station: { stationuuid: string }) => station.stationuuid) };
  });
  const audioBefore = await page.locator('audio').evaluate((audio) => ({ src: audio.getAttribute('src'), state: audio.getAttribute('data-ra-state') }));
  const playsBefore = await page.evaluate(() => (window as typeof window & { __returnFeedPlayCalls?: number }).__returnFeedPlayCalls ?? 0);

  await selectedCard.locator('[data-feed-action="place"]').click();
  await expect(page.locator('[data-globe-explorer]')).toBeVisible();
  const playsAtGlobe = await page.evaluate(() => (window as typeof window & { __returnFeedPlayCalls?: number }).__returnFeedPlayCalls ?? 0);
  await page.locator('.app-navigation-mobile').getByRole('button', { name: 'Лента', exact: true }).click();

  await expect(page.locator('.station-feed-overlay')).toBeVisible();
  await expect(page.locator('.station-feed-status')).toContainText('Новое для тебя');
  await expect(page.locator('.station-feed-card[data-feed-index="4"]')).toHaveAttribute('data-feed-station', selectedId!);
  expect(await page.locator('.station-feed-card').evaluateAll((cards) => cards.map((card) => card.getAttribute('data-feed-station')))).toEqual(deckBefore);
  await expect.poll(() => scroller.evaluate((element) => Math.round(element.scrollTop / element.clientHeight))).toBe(4);
  await page.locator('.station-feed-card-content[data-focus="true"] [data-feed-action="expand"]').click();
  await expect(page.locator('.feed-tools-filters [data-feed-filter="fresh"]')).toHaveAttribute('aria-pressed', 'true');
  const playsAfterReturn = await page.evaluate(() => (window as typeof window & { __returnFeedPlayCalls?: number }).__returnFeedPlayCalls ?? 0);
  expect(playsAfterReturn, JSON.stringify({ playsBefore, playsAtGlobe, contexts: await page.evaluate(() => (window as typeof window & { __returnFeedPlayContexts?: Array<Record<string, unknown>> }).__returnFeedPlayContexts ?? []), stacks: await page.evaluate(() => (window as typeof window & { __returnFeedPlayStacks?: string[] }).__returnFeedPlayStacks ?? []) })).toBe(playsBefore);
  expect(await page.evaluate(() => {
    const queue = JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue;
    return { sourceId: queue.sourceId, currentIndex: queue.currentIndex, ids: queue.items.map((station: { stationuuid: string }) => station.stationuuid) };
  })).toEqual(queueBefore);
  expect(await page.locator('audio').evaluate((audio) => ({ src: audio.getAttribute('src'), state: audio.getAttribute('data-ra-state') }))).toEqual(audioBefore);

  const playsBeforeNext = playsAfterReturn;
  const nextId = deckBefore[5];
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Ещё' })).toBeHidden();
  await page.locator('.station-feed-card[data-feed-index="4"] [data-feed-action="next"]').click();
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('radio:player:v2') || '{}');
    return state.queue?.items?.[state.queue.currentIndex]?.stationuuid ?? null;
  })).toBe(nextId);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __returnFeedPlayCalls?: number }).__returnFeedPlayCalls ?? 0)).toBe(playsBeforeNext + 1);

  await page.locator(`.station-feed-card[data-feed-index="5"][data-feed-station="${nextId}"] [data-feed-action="place"]`).click();
  await expect(page.locator('[data-globe-explorer]')).toBeVisible();
  await page.locator('.calm-mini-info').click();
  await expect(page.locator('.station-feed-card[data-feed-index="0"]')).toHaveAttribute('data-feed-station', nextId!);

  await page.locator('.station-feed-card[data-feed-index="0"] [data-feed-action="place"]').click();
  await expect(page.locator('[data-globe-explorer]')).toBeVisible();
  await page.locator('.calm-mini-next').click();
  const miniNextId = deckBefore[6];
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('radio:player:v2') || '{}');
    return state.queue?.items?.[state.queue.currentIndex]?.stationuuid ?? null;
  })).toBe(miniNextId);
  await page.locator('.app-navigation-mobile').getByRole('button', { name: 'Лента', exact: true }).click();
  await expect(page.locator('.station-feed-card[data-feed-index="0"]')).toHaveAttribute('data-feed-station', miniNextId!);
});

test('an edited Library queue invalidates the saved Feed visit', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMediaMocks(page);
  await mockStations(page);
  await seedRadioState(page, {
    activeSection: 'feed',
    queue: stations.slice(0, 10),
    queueCurrentIndex: 4,
    queueSourceId: 'home-live10',
    queueSourceLabel: 'Эфиры сейчас',
  });
  await page.addInitScript(() => {
    const paused = new WeakMap<HTMLMediaElement, boolean>();
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
      configurable: true,
      get() { return paused.get(this) ?? true; }
    });
    HTMLMediaElement.prototype.play = function () {
      paused.set(this, false);
      this.setAttribute('data-ra-state', 'playing');
      this.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      paused.set(this, true);
      this.setAttribute('data-ra-state', 'paused');
      this.dispatchEvent(new Event('pause'));
    };
  });
  await page.goto('/?calm=1');
  await expect(page.locator('.station-feed-overlay')).toBeVisible();
  const scroller = page.locator('.station-feed-scroller');
  await expect.poll(() => scroller.evaluate((element) => Math.round(element.scrollTop / element.clientHeight))).toBe(4);
  await expect(page.locator('.station-feed-card[data-feed-index="4"]')).toBeVisible();
  const currentCard = page.locator('.station-feed-card[data-feed-index="4"]');
  const currentId = stations[4].stationuuid;
  await expect(currentCard).toHaveAttribute('data-feed-station', currentId);
  await currentCard.locator('[data-feed-action="play"]').click();
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('radio:player:v2') || '{}');
    return state.queue?.items?.[state.queue.currentIndex]?.stationuuid ?? null;
  })).toBe(currentId);
  await expect(page.locator('audio')).toHaveAttribute('data-ra-state', 'playing');
  await currentCard.locator('[data-feed-action="play"]').click();
  await expect(page.locator('audio')).toHaveAttribute('data-ra-state', 'paused');
  const audioBefore = await page.locator('audio').evaluate((audio) => ({ src: audio.getAttribute('src'), state: audio.getAttribute('data-ra-state') }));
  const deckBefore = await page.locator('.station-feed-card').evaluateAll((cards) => cards.map((card) => card.getAttribute('data-feed-station')));
  await page.locator('.station-feed-card[data-feed-index="4"] [data-feed-action="place"]').click();
  await expect(page.locator('[data-globe-explorer]')).toBeVisible();
  await page.locator('.app-navigation-mobile').getByRole('button', { name: 'Моё', exact: true }).click();
  await expect(page.getByRole('tablist', { name: 'Медиатека' })).toBeVisible();
  await page.getByRole('tab', { name: /Очередь/ }).click();
  await expect(page.locator('.library-queue-shell')).toBeVisible();
  await page.getByRole('button', { name: 'Изменить', exact: true }).click();
  const queueBefore = await page.evaluate(() => {
    const queue = JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue;
    return { current: queue.items[queue.currentIndex].stationuuid, ids: queue.items.map((station: { stationuuid: string }) => station.stationuuid) };
  });
  await page.locator('[data-queue-row]').nth(5).getByRole('button', { name: 'Ниже' }).click();
  await expect.poll(() => page.evaluate(() => {
    const queue = JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue;
    return queue.items.map((station: { stationuuid: string }) => station.stationuuid);
  })).not.toEqual(queueBefore.ids);
  const queueAfter = await page.evaluate(() => {
    const queue = JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue;
    return { currentIndex: queue.currentIndex, current: queue.items[queue.currentIndex].stationuuid, ids: queue.items.map((station: { stationuuid: string }) => station.stationuuid) };
  });
  expect(queueAfter.current).toBe(queueBefore.current);
  expect(queueAfter.ids).not.toEqual(queueBefore.ids);
  await page.locator('.app-navigation-mobile').getByRole('button', { name: 'Лента', exact: true }).click();
  await expect(page.locator('.station-feed-overlay')).toBeVisible();
  expect(await page.locator('.station-feed-card').evaluateAll((cards) => cards.map((card) => card.getAttribute('data-feed-station')))).toEqual(queueAfter.ids);
  await expect(page.locator(`.station-feed-card[data-feed-index="${queueAfter.currentIndex}"]`)).toHaveAttribute('data-feed-station', currentId);
  await expect.poll(() => scroller.evaluate((element) => Math.round(element.scrollTop / element.clientHeight))).toBe(queueAfter.currentIndex);
  expect(await page.locator('audio').evaluate((audio) => ({ src: audio.getAttribute('src'), state: audio.getAttribute('data-ra-state') }))).toEqual(audioBefore);
});

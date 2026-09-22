import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

type HeadphoneProbe = {
  handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler | null>>;
  loads: string[];
  plays: string[];
  blocked: string;
  failure: 'error' | 'hang';
};

const setup = async (
  page: Page,
  options: {
    queue?: typeof stations;
    queueCurrentIndex?: number;
    queueSourceId?: string | null;
    playbackHistory?: typeof stations;
  } = {}
) => {
  await installMediaMocks(page);
  await mockStations(page);
  await seedRadioState(page, {
    queue: options.queue ?? stations.slice(0, 3),
    queueCurrentIndex: options.queueCurrentIndex,
    queueSourceId: options.queueSourceId,
    playbackHistory: options.playbackHistory
  });
  await page.addInitScript(() => {
    const probe: HeadphoneProbe = { handlers: {}, loads: [], plays: [], blocked: '', failure: 'error' };
    (window as unknown as { headphoneProbe: HeadphoneProbe }).headphoneProbe = probe;
    const original = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
    navigator.mediaSession.setActionHandler = (action, handler) => {
      probe.handlers[action] = handler;
      original(action, handler);
    };
    const paused = new WeakMap<HTMLMediaElement, boolean>();
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
      configurable: true, get() { return paused.get(this) ?? true; }
    });
    HTMLMediaElement.prototype.load = function () { probe.loads.push(this.src); };
    HTMLMediaElement.prototype.pause = function () {
      paused.set(this, true);
      this.setAttribute('data-ra-state', 'paused');
      this.dispatchEvent(new Event('pause'));
    };
    HTMLMediaElement.prototype.play = function () {
      probe.plays.push(this.src);
      paused.set(this, false);
      if (probe.blocked && this.src.includes(probe.blocked)) {
        this.setAttribute('data-ra-state', 'buffering');
        if (probe.failure === 'hang') return new Promise<void>(() => {});
        this.dispatchEvent(new Event('error'));
        return Promise.reject(new DOMException('Unavailable', 'NotSupportedError'));
      }
      this.setAttribute('data-ra-state', 'playing');
      this.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?calm=1');
  const initialStation = (options.queue ?? stations.slice(0, 3))[options.queueCurrentIndex ?? 0];
  await expect(page.locator('.calm-mini-info')).toContainText(initialStation.name);
  await page.locator('.calm-mini-play').click();
  await expect(page.locator('.calm-mini')).toHaveAttribute('data-status', 'playing');
  expect(await page.locator('audio.audio-hidden').evaluate((el: HTMLAudioElement) => el.autoplay)).toBe(false);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
};

// Invoke the callbacks actually registered by RadioContext, as the OS does.
// Native audio/network are mocked; this does not claim physical iOS coverage.
const command = (page: Page, action: MediaSessionAction) => page.evaluate((action) => {
  const handler = (window as unknown as { headphoneProbe: HeadphoneProbe }).headphoneProbe.handlers[action];
  if (!handler) throw new Error(`No OS handler for ${action}`);
  void handler({ action });
}, action);
const audio = (page: Page) => page.locator('audio.audio-hidden');

test('headphone pause/play are idempotent and reopen the stream while still hidden', async ({ page }) => {
  await setup(page);
  await command(page, 'pause');
  await expect(audio(page)).toHaveAttribute('data-ra-state', 'paused');
  await command(page, 'pause');
  await expect(audio(page)).toHaveAttribute('data-ra-state', 'paused');
  const before = await page.evaluate(() => (window as unknown as { headphoneProbe: HeadphoneProbe }).headphoneProbe.loads.length);
  await command(page, 'play');
  await expect(audio(page)).toHaveAttribute('data-ra-state', 'playing');
  await expect.poll(() => page.evaluate(() => (window as unknown as { headphoneProbe: HeadphoneProbe }).headphoneProbe.loads.length)).toBe(before + 1);
  await command(page, 'play');
  await expect(audio(page)).toHaveAttribute('data-ra-state', 'playing');
  expect(await page.evaluate(() => document.visibilityState)).toBe('hidden');
  expect(await page.evaluate(() => navigator.mediaSession.playbackState)).toBe('playing');
});

test('headphone Next walks past an unavailable station and retains OS controls', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { (window as unknown as { headphoneProbe: HeadphoneProbe }).headphoneProbe.blocked = 'osaka'; });
  await command(page, 'nexttrack');
  await expect(audio(page)).toHaveAttribute('src', /kyoto/);
  await expect(audio(page)).toHaveAttribute('data-ra-state', 'playing');
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.metadata?.title)).toContain('Kyoto');
  await command(page, 'pause');
  await expect(audio(page)).toHaveAttribute('data-ra-state', 'paused');
  await command(page, 'play');
  await expect(audio(page)).toHaveAttribute('data-ra-state', 'playing');
  expect(await page.evaluate(() => document.visibilityState)).toBe('hidden');
});

test('another headphone Next skips a hung station; duplicate Play cannot restart it', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const probe = (window as unknown as { headphoneProbe: HeadphoneProbe }).headphoneProbe;
    probe.blocked = 'osaka'; probe.failure = 'hang';
  });
  await command(page, 'nexttrack');
  await expect(audio(page)).toHaveAttribute('src', /osaka/);
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.metadata?.title)).toContain('Osaka');
  const before = await page.evaluate(() => (window as unknown as { headphoneProbe: HeadphoneProbe }).headphoneProbe.plays.length);
  await command(page, 'play');
  expect(await page.evaluate(() => (window as unknown as { headphoneProbe: HeadphoneProbe }).headphoneProbe.plays.length)).toBe(before);
  await command(page, 'nexttrack');
  await expect(audio(page)).toHaveAttribute('src', /kyoto/);
  await expect(audio(page)).toHaveAttribute('data-ra-state', 'playing');
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.metadata?.title)).toContain('Kyoto');
  await expect(page.locator('.toast').filter({ hasText: 'В каталоге не нашлось рабочей станции' })).toHaveCount(0);
});

test('queue removal waits for a pending station, then allows that resolved history row', async ({ page }) => {
  await setup(page, { queue: stations.slice(0, 3), queueCurrentIndex: 2 });
  await page.evaluate(() => {
    const probe = (window as unknown as { headphoneProbe: HeadphoneProbe }).headphoneProbe;
    probe.blocked = 'osaka';
    probe.failure = 'hang';
  });
  await command(page, 'previoustrack');
  await expect(audio(page)).toHaveAttribute('src', /osaka/);

  await page.locator('.mobile-nav-item').getByText(/Моё|Library/).click();
  await page.getByRole('tab', { name: /Очередь|Queue/ }).click();
  const pendingRow = page.locator('[data-queue-row]').filter({ hasText: 'Osaka Nights' });
  const pendingRemove = pendingRow.getByRole('button', {
    name: /Дождитесь подключения эфира|Wait for the broadcast to connect/
  });
  await expect(pendingRemove).toBeDisabled();
  const unrelatedPendingRemove = page
    .locator('[data-queue-row]')
    .filter({ hasText: 'Tokyo FM' })
    .getByRole('button', { name: /Дождитесь подключения эфира|Wait for the broadcast to connect/ });
  await expect(unrelatedPendingRemove).toBeDisabled();

  await command(page, 'nexttrack');
  await expect(audio(page)).toHaveAttribute('src', /kyoto/);
  await expect
    .poll(async () => page.locator('.calm-mini').getAttribute('data-status'))
    .toBe('playing');
  const resolvedRemove = page
    .locator('[data-queue-row]')
    .filter({ hasText: 'Osaka Nights' })
    .getByRole('button', { name: /Убрать|Remove/ });
  await expect(resolvedRemove).toBeEnabled();
  await resolvedRemove.click();
  await expect
    .poll(async () => {
      const queue = await page.evaluate(() => JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue);
      return queue.items.map((item: { stationuuid: string }) => item.stationuuid);
    })
    .toEqual([stations[0].stationuuid, stations[2].stationuuid]);
});

test('headphone Previous stays inside an explicitly selected queue before older history', async ({ page }) => {
  await setup(page, {
    queue: stations.slice(0, 3),
    queueCurrentIndex: 1,
    playbackHistory: [stations[3], stations[1]]
  });
  await expect(page.locator('.calm-mini-info')).toContainText('Osaka Nights');
  await expect(audio(page)).toHaveAttribute('src', /osaka/);
  await expect(audio(page)).toHaveAttribute('data-ra-state', 'playing');

  await command(page, 'previoustrack');
  await expect(audio(page)).toHaveAttribute('src', /tokyo/);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue)).toMatchObject({
    currentIndex: 0,
    sourceId: 'seeded-home'
  });
  await expect.poll(() => page.evaluate(() => {
    const queue = JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue;
    return queue.items.map((item: { stationuuid: string }) => item.stationuuid);
  })).toEqual(stations.slice(0, 3).map((station) => station.stationuuid));
});

test('headphone Previous at an explicit queue boundary does not escape to older history', async ({ page }) => {
  await setup(page, {
    queue: stations.slice(0, 3),
    queueCurrentIndex: 0,
    playbackHistory: [stations[3], stations[0]]
  });
  await expect(page.locator('.calm-mini-info')).toContainText('Tokyo FM');
  await expect(audio(page)).toHaveAttribute('src', /tokyo/);
  const playsBefore = await page.evaluate(() => (window as unknown as { headphoneProbe: HeadphoneProbe }).headphoneProbe.plays.length);

  await command(page, 'previoustrack');
  // Give the old history path a bounded chance to mutate audio; the negative
  // assertion below proves that an explicit boundary remains a no-op.
  await page.waitForTimeout(300);
  await expect(audio(page)).toHaveAttribute('src', /tokyo/);
  await expect.poll(() => page.evaluate(() => (window as unknown as { headphoneProbe: HeadphoneProbe }).headphoneProbe.plays.length)).toBe(playsBefore);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue)).toMatchObject({
    currentIndex: 0,
    sourceId: 'seeded-home'
  });
  await expect.poll(() => page.evaluate(() => {
    const queue = JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue;
    return queue.items.map((item: { stationuuid: string }) => item.stationuuid);
  })).toEqual(stations.slice(0, 3).map((station) => station.stationuuid));
});

for (const sourceId of ['history', null] as const) {
  test(`headphone Previous keeps ${sourceId ?? 'null'} queue compatibility`, async ({ page }) => {
    await setup(page, {
      queue: [stations[0], stations[1]],
      queueCurrentIndex: 1,
      queueSourceId: sourceId,
      playbackHistory: [stations[3], stations[1]]
    });
    await expect(audio(page)).toHaveAttribute('src', /osaka/);
    await command(page, 'previoustrack');
    await expect(audio(page)).toHaveAttribute('src', /sapporo/);
    await expect(audio(page)).toHaveAttribute('data-ra-state', 'playing');
  });
}

test('headphone Previous uses the pending queue position when the prior station hangs', async ({ page }) => {
  await setup(page, {
    queue: stations.slice(0, 3),
    queueCurrentIndex: 2,
    playbackHistory: [stations[3], stations[2]]
  });
  await page.evaluate(() => {
    const probe = (window as unknown as { headphoneProbe: HeadphoneProbe }).headphoneProbe;
    probe.blocked = 'osaka';
    probe.failure = 'hang';
  });

  await command(page, 'previoustrack');
  await expect(audio(page)).toHaveAttribute('src', /osaka/);
  await expect(audio(page)).toHaveAttribute('data-ra-state', 'buffering');
  await command(page, 'previoustrack');
  await expect(audio(page)).toHaveAttribute('src', /tokyo/);
  await expect(audio(page)).toHaveAttribute('data-ra-state', 'playing');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue.currentIndex)).toBe(0);
});

test('headphone Next returns to the queue item after a hung Previous', async ({ page }) => {
  await setup(page, {
    queue: stations.slice(0, 3),
    queueCurrentIndex: 2,
    playbackHistory: [stations[3], stations[2]]
  });
  await page.evaluate(() => {
    const probe = (window as unknown as { headphoneProbe: HeadphoneProbe }).headphoneProbe;
    probe.blocked = 'osaka';
    probe.failure = 'hang';
  });

  await command(page, 'previoustrack');
  await expect(audio(page)).toHaveAttribute('src', /osaka/);
  await command(page, 'nexttrack');
  await expect(audio(page)).toHaveAttribute('src', /kyoto/);
  await expect(audio(page)).toHaveAttribute('data-ra-state', 'playing');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue.currentIndex)).toBe(2);
});

test('headphone Previous cancels a hung Next back to the queue boundary', async ({ page }) => {
  await setup(page, {
    queue: stations.slice(0, 3),
    queueCurrentIndex: 0,
    playbackHistory: [stations[3], stations[0]]
  });
  await page.evaluate(() => {
    const probe = (window as unknown as { headphoneProbe: HeadphoneProbe }).headphoneProbe;
    probe.blocked = 'osaka';
    probe.failure = 'hang';
  });

  await command(page, 'nexttrack');
  await expect(audio(page)).toHaveAttribute('src', /osaka/);
  await command(page, 'previoustrack');
  await expect(audio(page)).toHaveAttribute('src', /tokyo/);
  await expect(audio(page)).toHaveAttribute('data-ra-state', 'playing');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue)).toMatchObject({
    currentIndex: 0,
    sourceId: 'seeded-home'
  });
});

test('opt-in playback diagnostics records OS commands and survives reload', async ({ page }) => {
  await setup(page);
  await page.locator('.app-navigation-mobile').getByRole('button', { name: 'Моё', exact: true }).click();
  await page.locator('[data-calm-library] [data-calm-settings]').click();
  const settings = page.locator('.settings-sheet');
  await expect(settings).toBeVisible();
  await settings.locator('summary').filter({ hasText: 'Для разработчиков' }).click();
  await settings.getByRole('button', { name: 'Показать', exact: true }).click();
  const start = settings.getByRole('button', { name: 'Начать на 20 минут', exact: true });
  await expect(start).toBeVisible();
  await start.click();
  await expect(settings).toContainText('Диагностика включена');

  // These are the callbacks registered by RadioContext, as the OS invokes them.
  await command(page, 'pause');
  await expect.poll(() => page.evaluate(() => {
    const entries = JSON.parse(localStorage.getItem('radio:playback-diagnostics:v1') || '{}').entries || [];
    const updates = entries.filter((entry: { event: string }) => entry.event === 'media_session_updated');
    return updates.at(-1)?.snapshot?.paused ?? null;
  })).toBe(true);
  await command(page, 'play');
  await expect
    .poll(() => page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('radio:playback-diagnostics:v1') || '{}');
      return state.entries?.map((entry: { event: string }) => entry.event) || [];
    }))
    .toEqual(expect.arrayContaining(['recording_started', 'media_pause_command', 'media_play_command']));

  await settings.getByRole('button', { name: 'Скопировать отчёт', exact: true }).click();
  await expect(settings.locator('textarea[aria-label="Отчёт диагностики"]')).toContainText('media_play_command');

  await page.reload();
  await page.locator('.app-navigation-mobile').getByRole('button', { name: 'Моё', exact: true }).click();
  await page.locator('[data-calm-library] [data-calm-settings]').click();
  const reloadedSettings = page.locator('.settings-sheet');
  await reloadedSettings.locator('summary').filter({ hasText: 'Для разработчиков' }).click();
  await reloadedSettings.getByRole('button', { name: 'Показать', exact: true }).click();
  await expect(reloadedSettings).toContainText('Сохранённый отчёт доступен');
  await reloadedSettings.getByRole('button', { name: 'Скопировать отчёт', exact: true }).click();
  await expect(reloadedSettings.locator('textarea[aria-label="Отчёт диагностики"]')).toContainText('media_pause_command');
});

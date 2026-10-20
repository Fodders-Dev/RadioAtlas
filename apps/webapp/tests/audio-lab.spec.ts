import { expect, test } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

test('standalone lab is isolated and native commands keep its one fixed source', async ({ page }) => {
  await page.addInitScript(() => {
    const probe = { srcAssignments: 0, loads: 0, plays: 0, pauses: 0, handlers: {} as Record<string, unknown> };
    (window as unknown as { labProbe: typeof probe }).labProbe = probe;
    const src = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      configurable: true,
      get() { return src?.get?.call(this) ?? ''; },
      set(value: string) { probe.srcAssignments += 1; src?.set?.call(this, value); }
    });
    HTMLMediaElement.prototype.play = function () { probe.plays += 1; return Promise.resolve(); };
    HTMLMediaElement.prototype.pause = function () { probe.pauses += 1; };
    HTMLMediaElement.prototype.load = function () { probe.loads += 1; };
    if (navigator.mediaSession) {
      navigator.mediaSession.setActionHandler = ((action: string, handler: unknown) => { probe.handlers[action] = handler; }) as typeof navigator.mediaSession.setActionHandler;
    }
  });
  await page.goto('/audio-lab.html');
  await expect(page.locator('audio')).toHaveCount(1);
  expect(await page.locator('audio').evaluate((el: HTMLAudioElement) => ({ autoplay: el.autoplay, preload: el.preload, crossOrigin: el.crossOrigin }))).toEqual({ autoplay: false, preload: 'none', crossOrigin: null });
  expect(await page.evaluate(() => (window as unknown as { labProbe: { srcAssignments: number } }).labProbe.srcAssignments)).toBe(1);
  const scripts = await page.locator('script[src]').evaluateAll((items) => items.map((item) => (item as HTMLScriptElement).src));
  expect(scripts.some((src) => /main|react-vendor|PlaybackRuntime|useAudioPlayer/i.test(src))).toBe(false);
  expect(scripts.every((src) => !/AudioContext|audioContext/i.test(src))).toBe(true);

  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const probe = await page.evaluate(() => (window as unknown as { labProbe: { srcAssignments: number; loads: number; plays: number; pauses: number; handlers: Record<string, unknown> } }).labProbe);
  expect(probe).toMatchObject({ srcAssignments: 1, loads: 0, plays: 1, pauses: 1 });
  expect(probe.handlers.seekto).toBeNull();
  expect(probe.handlers.seekbackward).toBeNull();
  expect(probe.handlers.seekforward).toBeNull();
  expect(probe.handlers.nexttrack).toBeNull();
  expect(probe.handlers.previoustrack).toBeNull();
});

test('Settings stops the app player before same-window navigation to the lab', async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page);
  await seedRadioState(page, { queue: stations.slice(0, 2) });
  await page.addInitScript(() => {
    const pause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.pause = function () {
      if (this.classList.contains('audio-hidden') && this.getAttribute('src')) {
        try { sessionStorage.setItem('audio-lab-main-stopped', 'yes'); } catch { /* test marker */ }
      }
      return pause.call(this);
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?calm=1');
  await page.locator('.calm-mini-play').click();
  await page.locator('.app-navigation-mobile').getByRole('button', { name: 'Моё', exact: true }).click();
  await page.locator('.library-preview-header').getByRole('button', { name: 'Настройки', exact: true }).click();
  const settings = page.locator('.settings-sheet');
  await settings.locator('summary').filter({ hasText: 'Для разработчиков' }).click();
  await settings.getByRole('button', { name: 'Открыть минимальный плеер', exact: true }).click();
  await expect(page).toHaveURL(/\/audio-lab\.html$/);
  expect(await page.evaluate(() => sessionStorage.getItem('audio-lab-main-stopped'))).toBe('yes');
  await expect(page.locator('audio')).toHaveCount(1);
});

test('partial MediaSession and clipboard failures stay contained; Stop defeats a late Play', async ({ page }) => {
  await page.addInitScript(() => {
    const probe = { handlers: {} as Record<string, MediaSessionActionHandler | null>, resolvePlay: null as null | (() => void) };
    (window as unknown as { labPartialProbe: typeof probe }).labPartialProbe = probe;
    HTMLMediaElement.prototype.play = function () {
      return new Promise<void>((resolve) => { probe.resolvePlay = resolve; });
    };
    if (navigator.mediaSession) {
      navigator.mediaSession.setActionHandler = ((action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
        if (action === 'seekbackward') throw new Error('unsupported');
        probe.handlers[action] = handler;
      }) as typeof navigator.mediaSession.setActionHandler;
    }
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => { throw new Error('unavailable'); } }
    });
  });
  await page.goto('/audio-lab.html');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  expect(await page.evaluate(() => navigator.mediaSession?.playbackState)).toBe('paused');
  await page.evaluate(() => {
    (window as unknown as { labPartialProbe: { resolvePlay: (() => void) | null } }).labPartialProbe.resolvePlay?.();
  });
  await expect.poll(() => page.evaluate(() => navigator.mediaSession?.playbackState)).not.toBe('playing');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Скопировать журнал', exact: true }).click();
  await expect(page.locator('#copy-status')).toContainText('Выделите текст');
  expect(await page.locator('#report').evaluate((el: HTMLTextAreaElement) => ({ focused: document.activeElement === el, selected: el.selectionEnd > el.selectionStart }))).toEqual({ focused: true, selected: true });
  const hasHandlers = await page.evaluate(() => {
    const handlers = (window as unknown as { labPartialProbe: { handlers: Record<string, unknown> } }).labPartialProbe.handlers;
    return { play: typeof handlers.play === 'function', pause: typeof handlers.pause === 'function', stop: typeof handlers.stop === 'function', seek: handlers.seekbackward };
  });
  expect(hasHandlers).toEqual({ play: true, pause: true, stop: true, seek: undefined });
  await page.evaluate(() => {
    const probe = (window as unknown as { labPartialProbe: { handlers: Record<string, MediaSessionActionHandler | null>; resolvePlay: (() => void) | null } }).labPartialProbe;
    probe.handlers.stop?.({ action: 'stop' } as MediaSessionActionDetails);
    probe.resolvePlay?.();
  });
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
  await expect(page.locator('#status')).toContainText('Плеер остановлен');
  expect(await page.locator('audio').getAttribute('src')).toBeNull();
});

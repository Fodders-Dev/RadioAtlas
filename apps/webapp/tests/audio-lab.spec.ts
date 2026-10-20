import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

type TrialProbeOptions = { initialType?: string; writeMode?: 'apply' | 'ignore' | 'throw'; readMode?: 'normal' | 'throw'; missingSession?: boolean; deferPlay?: boolean };

const installTrialProbe = async (page: Page, options: TrialProbeOptions = {}) => {
  await page.addInitScript((settings: TrialProbeOptions) => {
    const probe = {
      srcAssignments: 0, loads: 0, plays: 0, pauses: 0, order: [] as string[], writes: [] as string[],
      type: settings.initialType ?? 'auto', handlers: {} as Record<string, MediaSessionActionHandler | null>,
      writeMode: settings.writeMode ?? 'apply', readMode: settings.readMode ?? 'normal', resolvePlay: null as null | (() => void), deferPlay: settings.deferPlay ?? false
    };
    (window as unknown as { audioTrialProbe: typeof probe }).audioTrialProbe = probe;
    const src = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      configurable: true,
      get() { return src?.get?.call(this) ?? ''; },
      set(value: string) { probe.srcAssignments += 1; src?.set?.call(this, value); }
    });
    HTMLMediaElement.prototype.play = function () {
      probe.plays += 1; probe.order.push('native-play');
      this.dispatchEvent(new Event('play'));
      if (probe.deferPlay) return new Promise<void>((resolve) => { probe.resolvePlay = resolve; });
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () { probe.pauses += 1; probe.order.push('native-pause'); this.dispatchEvent(new Event('pause')); };
    HTMLMediaElement.prototype.load = function () { probe.loads += 1; };
    if (settings.missingSession) {
      Object.defineProperty(navigator, 'audioSession', { configurable: true, value: undefined });
    } else {
      const audioSession = {
        get type() { if (probe.readMode === 'throw') throw new Error('private'); return probe.type; },
        set type(value: string) {
          probe.writes.push(value); probe.order.push(`type:${value}`);
          if (probe.writeMode === 'throw') throw new Error('private');
          if (probe.writeMode !== 'ignore') probe.type = value;
        },
        get state() { return undefined; },
        addEventListener() {}, removeEventListener() {}
      };
      Object.defineProperty(navigator, 'audioSession', { configurable: true, value: audioSession });
    }
    const mediaSession = {
      metadata: null as MediaMetadata | null,
      playbackState: 'none' as MediaSessionPlaybackState,
      setActionHandler(action: string, handler: MediaSessionActionHandler | null) { probe.handlers[action] = handler; },
      setPositionState() {}
    };
    Object.defineProperty(navigator, 'mediaSession', { configurable: true, value: mediaSession });
  }, options);
};

test('standalone lab is isolated and native commands keep its one fixed source', async ({ page }) => {
  await installTrialProbe(page);
  await page.goto('/audio-lab.html');
  await expect(page.locator('audio')).toHaveCount(1);
  expect(await page.locator('audio').evaluate((el: HTMLAudioElement) => ({ autoplay: el.autoplay, preload: el.preload, crossOrigin: el.crossOrigin }))).toEqual({ autoplay: false, preload: 'none', crossOrigin: null });
  expect(await page.evaluate(() => (window as unknown as { audioTrialProbe: { srcAssignments: number; writes: string[] } }).audioTrialProbe.srcAssignments)).toBe(1);
  const scripts = await page.locator('script[src]').evaluateAll((items) => items.map((item) => (item as HTMLScriptElement).src));
  expect(scripts.some((src) => /main|react-vendor|PlaybackRuntime|useAudioPlayer/i.test(src))).toBe(false);
  expect(scripts.every((src) => !/AudioContext|audioContext/i.test(src))).toBe(true);

  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const probe = await page.evaluate(() => (window as unknown as { audioTrialProbe: { srcAssignments: number; loads: number; plays: number; pauses: number; handlers: Record<string, unknown>; writes: string[] } }).audioTrialProbe);
  expect(probe).toMatchObject({ srcAssignments: 1, loads: 0, plays: 1, pauses: 1 });
  expect(probe.writes).toEqual([]);
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

test('opt-in trial writes before first Play, survives Pause, marks real action sources and restores on Stop', async ({ page }) => {
  await installTrialProbe(page);
  await page.goto('/audio-lab.html');
  await page.locator('#audio-session-playback').check();
  expect(await page.evaluate(() => (window as unknown as { audioTrialProbe: { writes: string[] } }).audioTrialProbe.writes)).toEqual([]);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { audioTrialProbe: { plays: number } }).audioTrialProbe.plays)).toBe(1);
  const afterFirstPlay = await page.evaluate(() => (window as unknown as { audioTrialProbe: { writes: string[]; order: string[]; type: string } }).audioTrialProbe);
  expect(afterFirstPlay.writes).toEqual(['playback']);
  expect(afterFirstPlay.order.indexOf('type:playback')).toBeLessThan(afterFirstPlay.order.indexOf('native-play'));
  expect(afterFirstPlay.type).toBe('playback');
  await expect(page.locator('#audio-session-playback')).toBeDisabled();

  let report = JSON.parse(await page.locator('#report').inputValue());
  expect(report.sessionTrial).toMatchObject({ mode: 'playback', status: 'applied', choiceLocked: true, originalType: 'auto' });
  expect(report.journal.find((entry: { event: string }) => entry.event === 'play_requested')).toMatchObject({ commandSource: 'ui', sessionType: 'playback', sessionTrialStatus: 'applied' });

  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(await page.evaluate(() => (window as unknown as { audioTrialProbe: { type: string; writes: string[]; plays: number; loads: number; srcAssignments: number } }).audioTrialProbe)).toMatchObject({ type: 'playback', writes: ['playback'], plays: 1, loads: 0, srcAssignments: 1 });
  await page.evaluate(() => {
    const handlers = (window as unknown as { audioTrialProbe: { handlers: Record<string, MediaSessionActionHandler | null> } }).audioTrialProbe.handlers;
    handlers.play?.({ action: 'play' } as MediaSessionActionDetails);
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as { audioTrialProbe: { plays: number } }).audioTrialProbe.plays)).toBe(2);
  await page.evaluate(() => {
    const handlers = (window as unknown as { audioTrialProbe: { handlers: Record<string, MediaSessionActionHandler | null> } }).audioTrialProbe.handlers;
    handlers.pause?.({ action: 'pause' } as MediaSessionActionDetails);
  });
  await expect.poll(() => page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('radio:audio-lab:v1') || '{}');
    return data.entries?.some((entry: { event: string; commandSource?: string }) => entry.event === 'pause_requested' && entry.commandSource === 'media-session');
  })).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { audioTrialProbe: { writes: string[] } }).audioTrialProbe.writes)).toEqual(['playback']);

  await page.evaluate(() => {
    const handlers = (window as unknown as { audioTrialProbe: { handlers: Record<string, MediaSessionActionHandler | null> } }).audioTrialProbe.handlers;
    handlers.stop?.({ action: 'stop' } as MediaSessionActionDetails);
  });
  const afterStop = await page.evaluate(() => (window as unknown as { audioTrialProbe: { type: string; writes: string[]; loads: number; srcAssignments: number } }).audioTrialProbe);
  expect(afterStop).toMatchObject({ type: 'auto', writes: ['playback', 'auto'], loads: 1, srcAssignments: 1 });
  report = JSON.parse(await page.locator('#report').inputValue());
  expect(report.sessionTrial.status).toBe('restored');
  expect(report.journal.find((entry: { event: string }) => entry.event === 'stop_requested')).toMatchObject({ commandSource: 'media-session' });
  expect(report.mediaSessionHandlerRegistration).toMatchObject({ play: 'success', pause: 'success', stop: 'success' });
});

test('failed, ignored and unavailable category APIs are reported without blocking native Play', async ({ page, context }) => {
  const cases: Array<{ options: TrialProbeOptions; expectedStatus: string; expectedWrites: string[] }> = [
    { options: { missingSession: true }, expectedStatus: 'unavailable', expectedWrites: [] },
    { options: { readMode: 'throw' }, expectedStatus: 'original-unknown', expectedWrites: [] },
    { options: { writeMode: 'throw' }, expectedStatus: 'write-failed', expectedWrites: ['playback'] },
    { options: { writeMode: 'ignore' }, expectedStatus: 'write-ignored', expectedWrites: ['playback'] }
  ];
  for (let index = 0; index < cases.length; index += 1) {
    const activePage = index === 0 ? page : await context.newPage();
    const item = cases[index];
    await installTrialProbe(activePage, item.options);
    await activePage.goto('/audio-lab.html');
    await activePage.locator('#audio-session-playback').check();
    await activePage.getByRole('button', { name: 'Play', exact: true }).click();
    await expect.poll(() => activePage.evaluate(() => (window as unknown as { audioTrialProbe: { plays: number } }).audioTrialProbe.plays)).toBe(1);
    const result = await activePage.evaluate(() => {
      const probe = (window as unknown as { audioTrialProbe: { writes: string[] } }).audioTrialProbe;
      const report = JSON.parse((document.getElementById('report') as HTMLTextAreaElement).value);
      return { writes: probe.writes, trial: report.sessionTrial };
    });
    expect(result.writes).toEqual(item.expectedWrites);
    expect(result.trial.status).toBe(item.expectedStatus);
    expect(result.trial.choiceLocked).toBe(true);
    await expect(activePage.locator('#audio-session-playback')).toBeDisabled();
    if (index > 0) await activePage.close();
  }
});

test('release does not restore over a later external AudioSession type', async ({ page }) => {
  await installTrialProbe(page);
  await page.goto('/audio-lab.html');
  await page.locator('#audio-session-playback').check();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { audioTrialProbe: { type: string } }).audioTrialProbe.type)).toBe('playback');
  await page.evaluate(() => {
    const probe = (window as unknown as { audioTrialProbe: { type: string; handlers: Record<string, MediaSessionActionHandler | null> } }).audioTrialProbe;
    probe.type = 'ambient';
    probe.handlers.stop?.({ action: 'stop' } as MediaSessionActionDetails);
  });
  expect(await page.evaluate(() => (window as unknown as { audioTrialProbe: { type: string; writes: string[] } }).audioTrialProbe)).toMatchObject({ type: 'ambient', writes: ['playback'] });
  expect(JSON.parse(await page.locator('#report').inputValue()).sessionTrial.status).toBe('restore-skipped-changed');
});

test('Stop restores the owned category before a pending native Play can settle late', async ({ page }) => {
  await installTrialProbe(page, { deferPlay: true });
  await page.goto('/audio-lab.html');
  await page.locator('#audio-session-playback').check();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { audioTrialProbe: { plays: number; type: string } }).audioTrialProbe)).toMatchObject({ plays: 1, type: 'playback' });
  await page.evaluate(() => {
    const probe = (window as unknown as { audioTrialProbe: { handlers: Record<string, MediaSessionActionHandler | null> } }).audioTrialProbe;
    probe.handlers.stop?.({ action: 'stop' } as MediaSessionActionDetails);
  });
  expect(await page.evaluate(() => (window as unknown as { audioTrialProbe: { type: string; writes: string[] } }).audioTrialProbe)).toMatchObject({ type: 'auto', writes: ['playback', 'auto'] });
  expect(await page.evaluate(() => navigator.mediaSession?.playbackState)).toBe('none');
  await page.evaluate(() => {
    const probe = (window as unknown as { audioTrialProbe: { resolvePlay: (() => void) | null } }).audioTrialProbe;
    probe.resolvePlay?.();
  });
  await expect(page.locator('#status')).toContainText('Плеер остановлен');
  expect(await page.evaluate(() => navigator.mediaSession?.playbackState)).toBe('none');
  expect(JSON.parse(await page.locator('#report').inputValue()).sessionTrial.status).toBe('restored');
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
  expect(JSON.parse(await page.locator('#report').inputValue()).mediaSessionHandlerRegistration).toMatchObject({ play: 'success', pause: 'success', stop: 'success', seekbackward: 'failure' });
  await page.evaluate(() => {
    const probe = (window as unknown as { labPartialProbe: { handlers: Record<string, MediaSessionActionHandler | null>; resolvePlay: (() => void) | null } }).labPartialProbe;
    probe.handlers.stop?.({ action: 'stop' } as MediaSessionActionDetails);
    probe.resolvePlay?.();
  });
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
  await expect(page.locator('#status')).toContainText('Плеер остановлен');
  expect(await page.locator('audio').getAttribute('src')).toBeNull();
});

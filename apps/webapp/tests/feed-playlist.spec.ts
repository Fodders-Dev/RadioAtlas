import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, openLibraryCategory, seedRadioState, stations, waitForAnimationsToSettle } from './helpers';

type FeedMediaSessionProbe = {
  handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>>;
};

const openCurrentMore = async (page: Page) => {
  await waitForAnimationsToSettle(page, '.station-feed-overlay');
  const focusedContent = page.locator('.station-feed-card-content[data-focus="true"]');
  await expect(focusedContent).toBeVisible();
  const target = page.locator('.station-feed-card').filter({ has: focusedContent });
  await expect(target).toHaveAttribute('data-feed-station', /.+/);
  const stationId = await target.getAttribute('data-feed-station');
  expect(stationId).toBeTruthy();
  const selected = page.locator(`.station-feed-card[data-feed-station="${stationId}"]`);
  await selected.locator('[data-feed-action="expand"]').click();
  const tools = page.locator('.feed-player-tools');
  await expect(tools).toBeVisible();
  return { target: selected, stationId: stationId!, tools };
};

const mediaSessionCommand = (page: Page, action: MediaSessionAction) => page.evaluate(async (requestedAction) => {
  const handler = (window as unknown as { feedMediaSessionProbe: FeedMediaSessionProbe }).feedMediaSessionProbe.handlers[requestedAction];
  if (!handler) throw new Error(`No MediaSession handler registered for ${requestedAction}`);
  await handler({ action: requestedAction });
}, action);

declare global {
  interface Window {
    feedMediaSessionProbe?: FeedMediaSessionProbe;
  }
}

const installMediaSessionProbe = async (page: Page) => {
  await page.addInitScript(() => {
    const probe: FeedMediaSessionProbe = { handlers: {} };
    window.feedMediaSessionProbe = probe;
    if (!('mediaSession' in navigator)) return;
    const mediaSession = navigator.mediaSession;
    const original = mediaSession.setActionHandler.bind(mediaSession);
    mediaSession.setActionHandler = (action, handler) => {
      if (handler) probe.handlers[action] = handler;
      else delete probe.handlers[action];
      try { original(action, handler); } catch { /* keep the app's intent for unsupported actions */ }
    };
  });
};

const chooseTheme = async (page: Page, theme: 'classic' | 'journal') => {
  const nav = page.locator('.app-navigation-mobile');
  await nav.getByRole('button', { name: 'Главная', exact: true }).click();
  await page.getByRole('button', { name: 'Оформление', exact: true }).click();
  await page.locator(`[data-theme-card="${theme}"]`).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await nav.getByRole('button', { name: /Лента|Feed/ }).click();
};

const playerSnapshot = (page: Page) =>
  page.evaluate(() => {
    const player = JSON.parse(window.localStorage.getItem('radio:player:v2') || '{}');
    const queue = player.queue;
    const audio = document.querySelector('audio');
    return {
      queue: {
        items: queue?.items?.map((station: { stationuuid: string }) => station.stationuuid) ?? [],
        currentIndex: queue?.currentIndex ?? null,
        sourceId: queue?.sourceId ?? null,
        sourceLabel: queue?.sourceLabel ?? null
      },
      audio: audio
        ? { src: audio.getAttribute('src'), currentSrc: audio.currentSrc, paused: audio.paused, state: audio.getAttribute('data-ra-state') }
        : null
    };
  });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMediaMocks(page);
  await mockStations(page);
  await installMediaSessionProbe(page);
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
});

test('Feed More adds its selected card to a playlist without changing the live player and survives reload', async ({ page }) => {
  await seedRadioState(page, {
    seedOnlyIfAbsent: true,
    activeSection: 'feed',
    queue: stations.slice(0, 8),
    queueCurrentIndex: 0,
    queueSourceId: 'feed-playlist-test',
    queueSourceLabel: 'Feed test queue',
    stationCache: stations,
    collections: [{ id: 'personal-mix', name: 'Personal Mix', stationIds: [stations[1].stationuuid, stations[2].stationuuid, stations[3].stationuuid] }]
  });
  await page.goto('/?calm=1');
  const feed = page.locator('.station-feed-overlay');
  await expect(feed).toBeVisible();

  const current = page.locator('.station-feed-card[data-feed-index="0"]');
  await current.locator('[data-feed-action="play"]').click();
  await expect(current.locator('.calm-feed-status')).toHaveAttribute('data-status', 'playing');

  const { target, stationId, tools } = await openCurrentMore(page);
  expect(stationId).toBe(stations[0].stationuuid);
  const targetName = await target.locator('.station-feed-card-name').innerText();
  // Keep the More sheet pinned to the current card, then advance the real
  // registered OS/media transport handler while it remains open. This makes
  // the selected station non-current without relying on a Feed scroll timer.
  await mediaSessionCommand(page, 'nexttrack');
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem('radio:player:v2') || '{}');
    return state.queue?.items?.[state.queue?.currentIndex]?.stationuuid;
  })).toBe(stations[1].stationuuid);
  await expect(page.locator('audio')).toHaveAttribute('src', /\/osaka$/);
  await expect(page.locator('audio')).toHaveAttribute('data-ra-state', 'playing');
  await expect(tools.locator('header h2')).toHaveText(targetName);
  await expect.poll(() => playerSnapshot(page).then((snapshot) => snapshot.queue.items[snapshot.queue.currentIndex])).toBe(stations[1].stationuuid);
  const currentId = await page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem('radio:player:v2') || '{}');
    return state.queue?.items?.[state.queue?.currentIndex]?.stationuuid;
  });
  expect(stationId).not.toBe(currentId);
  const before = await playerSnapshot(page);
  expect(before.audio?.paused).toBe(false);
  expect(before.audio?.src).toBeTruthy();

  await tools.locator('[data-feed-add-to-playlist]').click();
  const picker = page.getByRole('dialog', { name: /Добавить в плейлист|Add to playlist/ });
  await expect(picker).toBeVisible();
  await expect(picker.locator('.station-playlist-target-name')).toHaveText(await target.locator('.station-feed-card-name').innerText());
  const existing = picker.locator('.station-playlist-option').filter({ hasText: 'Personal Mix' });
  await expect(existing).toBeVisible();
  await existing.click();

  await expect(page.locator('.feed-player-tools')).toHaveCount(0);
  await expect(feed).toBeVisible();
  await expect(page.locator('.toast')).toContainText(/Personal Mix/);
  await expect.poll(() => page.evaluate(() => {
    const library = JSON.parse(window.localStorage.getItem('radio:library:v2') || '{}');
    return library.collections?.find((collection: { id: string }) => collection.id === 'personal-mix')?.stationIds ?? [];
  })).toContain(stationId);
  await expect(target.locator('[data-feed-action="expand"]')).toBeFocused();
  expect(await playerSnapshot(page)).toEqual(before);
  await page.reload();
  await expect(page.locator('.station-feed-overlay')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const library = JSON.parse(window.localStorage.getItem('radio:library:v2') || '{}');
    return library.collections?.find((collection: { id: string }) => collection.id === 'personal-mix')?.stationIds ?? [];
  })).toContain(stationId);

  await page.locator('.app-navigation-mobile').getByRole('button', { name: 'Моё', exact: true }).click();
  await openLibraryCategory(page, 'collections');
  const collectionCard = page.locator('.library-collection-card').filter({ hasText: 'Personal Mix' });
  await expect(collectionCard).toBeVisible();
  await collectionCard.locator('.library-collection-title-button').click();
  const detail = page.locator('.library-collection-detail');
  await expect(detail).toBeVisible();
  const detailActions = detail.locator('.library-preview-detail-menu');
  await detailActions.locator('summary').click();
  await expect(detailActions).toBeVisible();
  await detailActions.getByRole('button', { name: /Порядок|Reorder/ }).click();
  const targetRow = page.locator(`[data-library-collection-row][data-station-id="${stationId}"]`);
  await expect(targetRow).toBeVisible();
  await targetRow.getByRole('button', { name: /Опустить|Move .* down/ }).click();
  await expect.poll(() => page.evaluate(() => {
    const library = JSON.parse(window.localStorage.getItem('radio:library:v2') || '{}');
    return library.collections?.find((collection: { id: string }) => collection.id === 'personal-mix')?.stationIds ?? [];
  })).toEqual([stations[1].stationuuid, stations[0].stationuuid, stations[2].stationuuid, stations[3].stationuuid]);
  const doneReordering = detail.getByRole('button', { name: /Готово|Done/ });
  if (await doneReordering.isVisible().catch(() => false)) await doneReordering.click();
  await detail.locator('.library-collection-detail-play').click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.localStorage.getItem('radio:player:v2') || '{}').queue?.sourceId)).toBe('collection-personal-mix');
  await page.locator('.app-navigation-mobile').getByRole('button', { name: /Лента|Feed/ }).click();
  await expect(page.locator('.station-feed-overlay')).toBeVisible();
  const focusedCard = page.locator('.station-feed-card-content[data-focus="true"]');
  await focusedCard.locator('[data-feed-action="expand"]').click();
  const more = page.locator('.feed-player-tools');
  await more.getByRole('button', { name: /Очередь|Queue/ }).click();
  await expect(page.locator('.calm-queue-shell')).toBeVisible();
  const beforeShuffle = await playerSnapshot(page);
  await page.getByRole('button', { name: /Перемешать следующие|Shuffle upcoming/ }).click();
  const afterShuffle = await playerSnapshot(page);
  expect(afterShuffle.queue.sourceId).toBe('collection-personal-mix');
  expect(afterShuffle.queue.items[afterShuffle.queue.currentIndex]).toBe(beforeShuffle.queue.items[beforeShuffle.queue.currentIndex]);
  expect([...afterShuffle.queue.items.slice(afterShuffle.queue.currentIndex + 1)].sort()).toEqual([...beforeShuffle.queue.items.slice(beforeShuffle.queue.currentIndex + 1)].sort());
  expect(afterShuffle.audio).toEqual(beforeShuffle.audio);
});

test('More keeps OS selection when the covered pager moves, including after closing', async ({ page }) => {
  await seedRadioState(page, { activeSection: 'feed', queue: stations.slice(0, 8), queueCurrentIndex: 0,
    queueSourceId: 'feed-playlist-test', stationCache: stations });
  await page.goto('/?calm=1');
  await waitForAnimationsToSettle(page, '.station-feed-overlay');
  await page.locator('.station-feed-card[data-feed-index="0"] [data-feed-action="play"]').click();
  await expect(page.locator('audio')).toHaveAttribute('data-ra-state', 'playing');
  const { tools } = await openCurrentMore(page);
  await expect(tools.locator('header h2')).toHaveText(stations[0].name);
  await mediaSessionCommand(page, 'nexttrack');
  await expect.poll(() => playerSnapshot(page).then(snapshot => snapshot.queue.currentIndex)).toBe(1);
  const before = await playerSnapshot(page);
  await page.locator('.station-feed-scroller').evaluate(el => { el.scrollTop = el.clientHeight * 2; });
  // Outlast the pager's debounce: covered layout/scroll activity is not a swipe.
  await page.waitForTimeout(600);
  expect(await playerSnapshot(page)).toEqual(before);
  await expect(tools.locator('header h2')).toHaveText(stations[0].name);
  await page.keyboard.press('Escape');
  await expect(tools).toHaveCount(0);
  await page.waitForTimeout(600);
  expect(await playerSnapshot(page)).toEqual(before);
  await page.keyboard.press('PageDown');
  await expect(page.locator('.station-feed-card[data-feed-index="1"] .station-feed-card-content')).toHaveAttribute('data-focus', 'true');
  await page.keyboard.press('PageDown');
  await expect.poll(() => playerSnapshot(page).then(snapshot => snapshot.queue.currentIndex)).toBe(2);
});

test('Feed playlist picker keeps More open on cancel and Escape, blocks blank names, and creates trimmed names', async ({ page }) => {
  await seedRadioState(page, {
    seedOnlyIfAbsent: true,
    activeSection: 'feed',
    queue: stations.slice(0, 8),
    queueCurrentIndex: 0,
    queueSourceId: 'feed-playlist-cancel-test',
    stationCache: stations
  });
  await page.goto('/?calm=1');
  await expect(page.locator('.station-feed-overlay')).toBeVisible();
  const { target, stationId, tools } = await openCurrentMore(page);
  const before = await playerSnapshot(page);

  await tools.locator('[data-feed-add-to-playlist]').click();
  const picker = page.getByRole('dialog', { name: /Добавить в плейлист|Add to playlist/ });
  await expect(picker).toBeVisible();
  const input = picker.getByLabel(/Название плейлиста|Playlist name/);
  const submit = picker.locator('.station-playlist-create button');
  await input.fill('   ');
  await expect(submit).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(tools).toBeVisible();
  await expect(tools.locator('[data-feed-add-to-playlist]')).toBeFocused();

  await tools.locator('[data-feed-add-to-playlist]').click();
  await input.fill('  Road trip  ');
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(tools).toHaveCount(0);
  await expect(page.locator('.station-feed-overlay')).toBeVisible();
  await expect(page.locator('.toast')).toContainText(/Road trip/);
  await expect.poll(() => page.evaluate((targetId) => {
    const library = JSON.parse(window.localStorage.getItem('radio:library:v2') || '{}');
    return library.collections?.find((collection: { name: string }) => collection.name === 'Road trip')?.stationIds ?? [];
  }, stationId)).toContain(stationId);
  await expect(target.locator('[data-feed-action="expand"]')).toBeFocused();
  expect(await playerSnapshot(page)).toEqual(before);
});

test('playlist choices preserve duplicates and full collections, and the picker stays readable in dark and light themes', async ({ page }) => {
  await seedRadioState(page, {
    seedOnlyIfAbsent: true,
    activeSection: 'feed',
    queue: stations.slice(0, 8),
    queueCurrentIndex: 0,
    queueSourceId: 'feed-playlist-limits-test',
    stationCache: stations,
    collections: [
      { id: 'duplicate-mix', name: 'Already has every fixture station', stationIds: stations.map((station) => station.stationuuid) },
      { id: 'full-mix', name: 'Full playlist ' + 'very long title '.repeat(6), stationIds: Array.from({ length: 128 }, (_, index) => `saved-${index}`) },
      ...Array.from({ length: 8 }, (_, index) => ({ id: `scroll-${index}`, name: `Scrollable playlist ${index + 1}`, stationIds: [] }))
    ]
  });
  await page.goto('/?calm=1');
  await expect(page.locator('.station-feed-overlay')).toBeVisible();
  const stationId = (await page.locator('.station-feed-card[data-feed-index="0"]').getAttribute('data-feed-station'))!;
  for (const theme of ['classic', 'journal'] as const) {
    await chooseTheme(page, theme);
    const { tools } = await openCurrentMore(page);
    await tools.locator('[data-feed-add-to-playlist]').click();
    const picker = page.getByRole('dialog', { name: /Добавить в плейлист|Add to playlist/ });
    await expect(picker).toBeVisible();
    const duplicate = picker.locator('.station-playlist-option').filter({ hasText: 'Already has every fixture station' });
    const full = picker.locator('.station-playlist-option').filter({ hasText: 'Full playlist' });
    await expect(duplicate).toBeDisabled();
    await expect(duplicate).toContainText(/Уже добавлена|Already added/);
    await expect(full).toBeDisabled();
    await expect(full).toContainText(/Лимит 128 станций|128 station limit/);

    const input = picker.getByLabel(/Название плейлиста|Playlist name/);
    const submit = picker.locator('.station-playlist-create button');
    await input.fill('Contrast sample');
    await expect(submit).toBeEnabled();
    await waitForAnimationsToSettle(page, '.station-playlist-dialog');
    for (const viewport of [{ width: 320, height: 844 }, { width: 390, height: 844 }, { width: 390, height: 480 }, { width: 834, height: 844 }, { width: 1440, height: 844 }]) {
      const { width, height } = viewport;
      await page.setViewportSize(viewport);
      const layout = await picker.evaluate((dialog) => {
      const card = dialog.querySelector<HTMLElement>('.station-playlist-dialog-card')!;
      const primary = dialog.querySelector<HTMLButtonElement>('.station-playlist-create button')!;
      const title = dialog.querySelector<HTMLElement>('.station-playlist-target-name')!;
      const fullOption = [...dialog.querySelectorAll<HTMLElement>('.station-playlist-option')].find((option) => option.classList.contains('full'))!;
      const options = dialog.querySelector<HTMLElement>('.station-playlist-options')!;
      const rect = card.getBoundingClientRect();
      const primaryRect = primary.getBoundingClientRect();
      const fullName = fullOption.querySelector<HTMLElement>('span')!;
      const fullNameStyle = getComputedStyle(fullName);
      const optionRows = [...dialog.querySelectorAll<HTMLElement>('.station-playlist-option')];
      const accentProbe = document.createElement('span');
      accentProbe.style.color = 'var(--accent)';
      document.body.append(accentProbe);
      const accentColor = getComputedStyle(accentProbe).color;
      accentProbe.style.color = 'var(--accent-ink)';
      const accentInk = getComputedStyle(accentProbe).color;
      accentProbe.style.color = 'var(--muted)';
      const mutedColor = getComputedStyle(accentProbe).color;
      accentProbe.remove();
      const primaryStyle = getComputedStyle(primary);
      const fullStatusStyle = getComputedStyle(fullOption.querySelector('em')!);
      return {
        viewport: window.innerWidth,
        theme: document.documentElement.dataset.theme,
        themeMode: document.documentElement.dataset.themeMode,
        docWidth: document.documentElement.scrollWidth,
        cardLeft: rect.left,
        cardRight: rect.right,
        cardHeight: rect.height,
        primaryHeight: primaryRect.height,
        primaryFont: Number.parseFloat(primaryStyle.fontSize),
        primaryUsesThemeAccent: primaryStyle.backgroundColor === accentColor && primaryStyle.color === accentInk,
        fullStatusFont: Number.parseFloat(fullStatusStyle.fontSize),
        fullStatusUsesMuted: fullStatusStyle.color === mutedColor,
        fullStatusOpacity: getComputedStyle(fullOption).opacity,
        duplicateHeight: dialog.querySelector<HTMLElement>('.station-playlist-option.active')!.getBoundingClientRect().height,
        longPlaylistNameWraps: fullNameStyle.whiteSpace !== 'nowrap' && fullName.getBoundingClientRect().height > Number.parseFloat(fullNameStyle.fontSize) * 1.4,
        optionRowsDoNotOverlap: optionRows.every((row, index) => {
          const rowRect = row.getBoundingClientRect();
          const titleRect = row.querySelector('span')!.getBoundingClientRect();
          const statusRect = row.querySelector('em')!.getBoundingClientRect();
          const previousRect = index ? optionRows[index - 1].getBoundingClientRect() : null;
          return titleRect.top >= rowRect.top && statusRect.bottom <= rowRect.bottom && (!previousRect || rowRect.top >= previousRect.bottom);
        }),
        listScrolls: options.scrollHeight > options.clientHeight
      };
      });
      expect(layout.theme).toBe(theme);
      expect(layout.themeMode).toBe(theme === 'journal' ? 'light' : 'dark');
      expect(layout.docWidth, `horizontal overflow at ${width}px in ${theme}`).toBeLessThanOrEqual(width);
      expect(layout.cardLeft).toBeGreaterThanOrEqual(0);
      expect(layout.cardRight).toBeLessThanOrEqual(width);
      expect(layout.primaryHeight).toBeGreaterThanOrEqual(44);
      expect(layout.primaryFont).toBeGreaterThanOrEqual(16);
      expect(layout.primaryUsesThemeAccent).toBe(true);
      expect(layout.fullStatusFont).toBeGreaterThanOrEqual(12);
      expect(layout.fullStatusUsesMuted).toBe(true);
      expect(layout.fullStatusOpacity).toBe('1');
      expect(layout.duplicateHeight).toBeGreaterThanOrEqual(44);
      expect(layout.longPlaylistNameWraps).toBe(true);
      expect(layout.optionRowsDoNotOverlap, `playlist rows overlap at ${width}x${height} in ${theme}`).toBe(true);
      expect(layout.listScrolls).toBe(true);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await picker.locator('.station-playlist-dialog-scrim').click({ position: { x: 2, y: 2 } });
    await expect(picker).toHaveCount(0);
    await expect(tools).toBeVisible();
    await expect(tools.locator('[data-feed-add-to-playlist]')).toBeFocused();
    await tools.locator('.feed-tools-close').click();
  }
  const unchanged = await page.evaluate((targetId) => {
    const library = JSON.parse(window.localStorage.getItem('radio:library:v2') || '{}');
    return {
      duplicate: library.collections?.find((collection: { id: string }) => collection.id === 'duplicate-mix')?.stationIds ?? [],
      full: library.collections?.find((collection: { id: string }) => collection.id === 'full-mix')?.stationIds ?? []
    };
  }, stationId);
  expect(unchanged.duplicate).toContain(stationId);
  expect(unchanged.full).toHaveLength(128);
  expect(unchanged.full).not.toContain(stationId);
});

test('the StationTable row action still uses the shared playlist picker', async ({ page }) => {
  await seedRadioState(page, {
    activeSection: 'library',
    libraryTab: 'favorites',
    favorites: [stations[2]],
    stationCache: stations,
    collections: [{ id: 'table-mix', name: 'Table Mix', stationIds: [] }]
  });
  await page.goto('/?calm=1');
  await openLibraryCategory(page, 'favorites');
  const row = page.locator('.screen-library-v2 [data-station-row]').first();
  await expect(row).toBeVisible();
  await row.locator('.station-compact-main').click();
  const actions = page.locator('.station-row-actions-sheet-list');
  await expect(actions).toBeVisible();
  await actions.getByRole('button', { name: /В плейлист|Add to playlist/ }).click();
  const picker = page.getByRole('dialog', { name: /Добавить в плейлист|Add to playlist/ });
  await expect(picker.locator('.station-playlist-target-name')).toContainText(stations[2].name);
  await picker.locator('.station-playlist-option').filter({ hasText: 'Table Mix' }).click();
  await expect.poll(() => page.evaluate(() => {
    const library = JSON.parse(window.localStorage.getItem('radio:library:v2') || '{}');
    return library.collections?.find((collection: { id: string }) => collection.id === 'table-mix')?.stationIds ?? [];
  })).toContain(stations[2].stationuuid);
});

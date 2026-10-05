import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, openLibraryCategory, seedRadioState, stations } from './helpers';

const readQueue = (page: Page) =>
  page.evaluate(() => {
    const raw = window.localStorage.getItem('radio:player:v2');
    const queue = raw ? JSON.parse(raw)?.queue : null;
    return queue
      ? {
          order: (queue.items ?? []).map((station: { stationuuid: string }) => station.stationuuid),
          currentIndex: queue.currentIndex
        }
      : null;
  });

const installPlayProbe = async (page: Page) => {
  await page.addInitScript(() => {
    (window as unknown as { __playCalls: number }).__playCalls = 0;
    const mockPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      (window as unknown as { __playCalls: number }).__playCalls += 1;
      return mockPlay.call(this);
    };
  });
};

const playCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __playCalls: number }).__playCalls);

test.beforeEach(async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page);
  await installPlayProbe(page);
  await page.setViewportSize({ width: 390, height: 844 });
});

test('calm queue separates the selected station and upcoming stations; earlier entries stay collapsed', async ({
  page
}) => {
  await seedRadioState(page, {
    activeSection: 'library',
    libraryTab: 'queue',
    queue: stations,
    queueCurrentIndex: 3
  });
  await page.goto('/?api=/api&calm=1');
  await openLibraryCategory(page, 'queue');

  const rows = page.locator('.calm-queue-list > [data-queue-row]');
  const stage = page.locator('[data-queue-current]');
  await expect(stage).toHaveAttribute('data-queue-current', stations[3].stationuuid);
  await expect(stage).toContainText(stations[3].name);
  await expect(stage).toHaveAttribute('data-stage-status', 'ready');
  await expect(rows.first()).toContainText(stations[4].name);
  await expect(rows.nth(1)).toContainText(stations[5].name);
  await expect(rows).toHaveCount(stations.length - 4);
  expect(await playCalls(page)).toBe(0);
  await expect(page.getByText(/Ранее · 3|Earlier · 3/)).toBeVisible();
  await expect(page.locator('.calm-queue-earlier-rows [data-queue-row]').first()).toBeHidden();
  await expect(page.locator('.library-queue-now-card')).toHaveCount(0);

  const firstRowsFit = await rows.nth(1).evaluate((row) => {
    const rowBottom = row.getBoundingClientRect().bottom;
    const overlay = [
      document.querySelector('[data-calm-player]'),
      document.querySelector('.app-navigation-mobile')
    ]
      .filter((element): element is Element => Boolean(element))
      .map((element) => element.getBoundingClientRect().top)
      .filter((top) => top > 0);
    return rowBottom < (overlay.length ? Math.min(...overlay) : window.innerHeight);
  });
  expect(firstRowsFit).toBe(true);
  await expect(page.getByRole('button', { name: /Изменить|Edit/ })).toBeVisible();
  await expect(page.locator('.calm-queue-primary-actions').getByRole('button', { name: /Очистить очередь|Clear queue/ })).toHaveCount(0);
});

test('editing does not start audio, keeps the current row protected, and changes order/removal', async ({
  page
}) => {
  await seedRadioState(page, {
    activeSection: 'library',
    libraryTab: 'queue',
    queue: stations,
    queueCurrentIndex: 3
  });
  await page.goto('/?api=/api&calm=1');
  await openLibraryCategory(page, 'queue');
  const before = await readQueue(page);

  await page.getByRole('button', { name: /Изменить|Edit/ }).click();
  await expect(page.locator('[data-queue-row]')).toHaveCount(stations.length);
  expect((await readQueue(page))?.order).toEqual(before?.order);
  const currentRow = page.locator('[data-queue-row]').filter({ hasText: stations[3].name });
  await expect(currentRow.locator('.library-queue-row-actions > button').last()).toBeDisabled();
  expect(await playCalls(page)).toBe(0);

  const movedRow = page.locator('[data-queue-row]').filter({ hasText: stations[5].name });
  await movedRow.getByRole('button', { name: /Выше|Move up/ }).click();
  await expect.poll(async () => (await readQueue(page))?.order).toEqual([
    stations[0].stationuuid,
    stations[1].stationuuid,
    stations[2].stationuuid,
    stations[3].stationuuid,
    stations[5].stationuuid,
    stations[4].stationuuid,
    ...stations.slice(6).map((station) => station.stationuuid)
  ]);

  const removableRow = page.locator('[data-queue-row]').filter({ hasText: stations[5].name });
  await removableRow.getByRole('button', { name: /Убрать|Remove/ }).click();
  await expect.poll(async () => (await readQueue(page))?.order).toEqual([
    stations[0].stationuuid,
    stations[1].stationuuid,
    stations[2].stationuuid,
    stations[3].stationuuid,
    stations[4].stationuuid,
    ...stations.slice(6).map((station) => station.stationuuid)
  ]);
  expect((await readQueue(page))?.currentIndex).toBe(before?.currentIndex);
  await page.getByRole('button', { name: /Готово|Done/ }).click();
  await expect(page.locator('.calm-queue-list.editing')).toHaveCount(0);
  expect((await readQueue(page))?.order).toEqual([
    stations[0].stationuuid,
    stations[1].stationuuid,
    stations[2].stationuuid,
    stations[3].stationuuid,
    stations[4].stationuuid,
    ...stations.slice(6).map((station) => station.stationuuid)
  ]);
  expect(await playCalls(page)).toBe(0);
});

test('queue library search remains available while results replace the tabs, then clearing restores Queue', async ({
  page
}) => {
  await seedRadioState(page, {
    activeSection: 'library',
    libraryTab: 'queue',
    queue: stations
  });
  await page.goto('/?api=/api&calm=1');
  await openLibraryCategory(page, 'queue');

  await page.getByText(/Поиск и плейлисты|Search and playlists/).click();
  const search = page.getByRole('searchbox', { name: /Поиск по медиатеке|Search your library/ });
  await search.fill('Tokyo');
  await search.fill('Tokyo FM');
  await expect(page.getByRole('region', { name: /Из медиатеки|From your library/ })).toBeVisible();
  await expect(search).toHaveValue('Tokyo FM');
  await page.getByRole('button', { name: /Очистить поиск|Clear search/ }).click();
  await expect(search).toBeFocused();
  await expect(page.getByRole('tab', { name: /Очередь|Queue/ })).toBeVisible();
  await expect(page.locator('.calm-queue-shell')).toBeVisible();
});

test('empty calm Queue offers Search and Globe without edit tools or a tall empty panel', async ({
  page
}) => {
  await seedRadioState(page, { activeSection: 'library', libraryTab: 'queue' });
  await page.goto('/?api=/api&calm=1');
  await openLibraryCategory(page, 'queue');

  const emptyState = page.locator('.library-queue-empty-state');
  await expect(emptyState).toBeVisible();
  await expect(emptyState).toContainText(/Очередь пока пустая|Queue is still empty/);
  await expect(page.getByRole('button', { name: /Изменить|Edit/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Перемешать|Shuffle queue/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Сохранить как плейлист|Save as playlist/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Очистить очередь|Clear queue/ })).toHaveCount(0);
  const emptyHeight = await emptyState.evaluate((element) => element.getBoundingClientRect().height);
  expect(emptyHeight).toBeLessThan(240);

  await page.getByText(/Поиск и плейлисты|Search and playlists/).click();
  await expect(page.getByRole('searchbox', { name: /Поиск по медиатеке|Search your library/ })).toBeVisible();
  await emptyState.getByRole('button', { name: /Открыть глобус|Open globe/ }).click();
  await expect(page.locator('[data-globe-explorer]')).toBeVisible();
});

test('saving from calm Queue makes a playlist without starting playback', async ({ page }) => {
  await seedRadioState(page, {
    activeSection: 'library',
    libraryTab: 'queue',
    queue: stations,
    queueCurrentIndex: 2
  });
  await page.goto('/?api=/api&calm=1');
  await openLibraryCategory(page, 'queue');

  await page.getByRole('button', { name: /Сохранить как плейлист|Save as playlist/ }).click();
  await page.locator('.library-save-queue-row input').fill('Calm queue');
  await page.locator('.library-save-queue-row').getByRole('button', { name: /Сохранить|Save/ }).click();

  await expect(page.locator('.library-inline-toast')).toContainText('Calm queue');
  const card = page.locator('.library-collection-card').filter({ hasText: 'Calm queue' });
  await expect(card).toBeVisible();
  await expect(card.locator('.station-title').first()).toBeVisible();
  expect(await playCalls(page)).toBe(0);
});

test('tablet Queue layout has readable calm surfaces and no horizontal overflow', async ({ page }) => {
  await seedRadioState(page, {
    activeSection: 'library',
    libraryTab: 'queue',
    queue: stations,
    queueCurrentIndex: 2,
    recent: stations.slice(0, 2)
  });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/?api=/api&calm=1');
  await openLibraryCategory(page, 'queue');

  await expect(page.locator('.calm-queue-shell')).toBeVisible();
  await expect(page.locator('.library-queue-now-card')).toHaveCount(0);
  for (const width of [320, 390, 1024, 1440]) {
    await page.setViewportSize({ width, height: width > 720 ? 900 : 844 });
    const readRows = page.locator('.calm-queue-list > [data-queue-row]');
    await expect(page.locator('[data-queue-current]')).toContainText(stations[2].name);
    await expect(readRows.first()).toContainText(stations[3].name);
    await expect(readRows.nth(1)).toContainText(stations[4].name);
    if (width === 320) {
      const readNameGeometry = await Promise.all([0, 1].map((index) =>
        readRows.nth(index).locator('.playlist-name').evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return { width: bounds.width, height: bounds.height };
        })
      ));
      for (const name of readNameGeometry) {
        expect(name.width).toBeGreaterThan(70);
        expect(name.height).toBeGreaterThan(18);
      }
    }
    await page.getByRole('button', { name: /Изменить|Edit/ }).click();
    const row = page.locator('.calm-queue-list > [data-queue-row]').nth(1);
    const geometry = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      ink: getComputedStyle(document.querySelector('.calm-library-category-head h1')!).color,
      inkToken: (() => {
        const shell = document.querySelector('.calm-queue-shell')!;
        const probe = document.createElement('span');
        probe.style.color = 'var(--calm-ink)';
        shell.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      })(),
      secondary: getComputedStyle(document.querySelector('.calm-queue-shell .library-queue-row .playlist-meta')!).color,
      secondaryToken: (() => {
        const shell = document.querySelector('.calm-queue-shell')!;
        const probe = document.createElement('span');
        probe.style.color = 'var(--calm-secondary)';
        shell.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      })()
    }));
    const rowGeometry = await row.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const name = element.querySelector('.playlist-name')!.getBoundingClientRect();
      const controls = element.querySelector('.library-queue-row-actions')!.getBoundingClientRect();
      const queueTitle = document.querySelector('.calm-library-category-head h1')!.getBoundingClientRect();
      const moveButtons = Array.from(element.querySelectorAll('.library-queue-move-btn'));
      const moveButtonHeight = moveButtons.length
        ? Math.min(...moveButtons.map((button) => button.getBoundingClientRect().height))
        : 0;
      return {
        left: bounds.left,
        right: bounds.right,
        nameWidth: name.width,
        queueTitleHeight: queueTitle.height,
        controlsLeft: controls.left,
        controlsRight: controls.right,
        moveButtonHeight
      };
    });
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.ink).toBe(geometry.inkToken);
    expect(geometry.secondary).toBe(geometry.secondaryToken);
    expect(rowGeometry.nameWidth).toBeGreaterThan(70);
    if (width === 320) expect(rowGeometry.queueTitleHeight).toBeLessThan(35);
    expect(rowGeometry.controlsLeft).toBeGreaterThanOrEqual(rowGeometry.left);
    expect(rowGeometry.controlsRight).toBeLessThanOrEqual(rowGeometry.right);
    expect(rowGeometry.moveButtonHeight).toBeGreaterThanOrEqual(44);
    await page.getByRole('button', { name: /Готово|Done/ }).click();
  }
  await expect(page.locator('.library-queue-rail')).toHaveCount(0);
  const stageColors = await page.locator('.calm-queue-shell').evaluate((element) => {
    const tokenColor = (token: string) => {
      const probe = document.createElement('span');
      probe.style.color = `var(${token})`;
      element.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    const stage = element.querySelector('.library-queue-stage')!;
    const tail = element.querySelector('.library-queue-main')!;
    return {
      ink: tokenColor('--calm-ink'),
      secondary: tokenColor('--calm-secondary'),
      title: getComputedStyle(stage.querySelector('.library-queue-stage-name')!).color,
      location: getComputedStyle(stage.querySelector('.library-queue-stage-meta')!).color,
      stageRight: stage.getBoundingClientRect().right,
      tailLeft: tail.getBoundingClientRect().left
    };
  });
  expect(stageColors.title).toBe(stageColors.ink);
  expect(stageColors.location).toBe(stageColors.secondary);
  expect(stageColors.tailLeft).toBeGreaterThan(stageColors.stageRight);

  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'custom-test';
    document.documentElement.dataset.themeMode = 'light';
    document.documentElement.dataset.themeBackdrop = 'image';
    document.documentElement.style.setProperty('--bg', '#f3ece4');
    document.documentElement.style.setProperty('--text', '#241a17');
    document.documentElement.style.setProperty('--theme-bg-image', 'linear-gradient(135deg, #071a30, #0a1830)');
  });
  await page.getByText(/Поиск и плейлисты|Search and playlists/).click();
  await expect.poll(() => page.evaluate(() => {
    const shell = document.querySelector('.calm-queue-shell')!;
    const inactiveTab = document.querySelector('.library-tab-chip:not(.active)')!;
    const stage = shell.querySelector('.library-queue-stage')!;
    return getComputedStyle(inactiveTab).backgroundColor === getComputedStyle(stage).backgroundColor;
  })).toBe(true);
  const materialContrast = await page.evaluate(() => {
    const luminance = (color: string) => {
      const srgb = color.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
      const channels = srgb
        ? srgb.slice(1, 4).map(Number)
        : (color.match(/[\d.]+/g)?.slice(0, 3).map((value) => Number(value) / 255) ?? []);
      const linear = channels.map((channel) => {
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    const ratio = (foreground: string, background: string) => {
      const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      return (values[0] + 0.05) / (values[1] + 0.05);
    };
    const alpha = (color: string) => {
      const slashAlpha = color.match(/\/\s*([\d.]+)\s*\)/);
      const commaAlpha = color.match(/,\s*([\d.]+)\s*\)$/);
      return Number(slashAlpha?.[1] ?? commaAlpha?.[1] ?? 1);
    };
    const head = document.querySelector('.calm-library-category-head')!;
    const shell = document.querySelector('.calm-queue-shell')!;
    const tools = document.querySelector('.calm-queue-tools')!;
    const inactiveTab = document.querySelector('.library-tab-chip:not(.active)')!;
    const stage = shell.querySelector('.library-queue-stage')!;
    const title = stage.querySelector('.library-queue-stage-name')!;
    const summary = tools.querySelector('summary')!;
    const headBackground = getComputedStyle(head).backgroundColor;
    const shellBackground = getComputedStyle(stage).backgroundColor;
    const toolsBackground = getComputedStyle(tools).backgroundColor;
    const tabBackground = getComputedStyle(inactiveTab).backgroundColor;
    return {
      headAlpha: alpha(headBackground),
      shellAlpha: alpha(shellBackground),
      toolsAlpha: alpha(toolsBackground),
      tabAlpha: alpha(tabBackground),
      head: ratio(getComputedStyle(head).color, headBackground),
      shell: ratio(getComputedStyle(title).color, shellBackground),
      tools: ratio(getComputedStyle(summary).color, toolsBackground),
      tab: ratio(getComputedStyle(inactiveTab).color, tabBackground)
    };
  });
  expect(materialContrast.headAlpha).toBe(1);
  expect(materialContrast.shellAlpha).toBe(1);
  expect(materialContrast.toolsAlpha).toBe(1);
  expect(materialContrast.tabAlpha).toBe(1);
  expect(materialContrast.head).toBeGreaterThanOrEqual(4.5);
  expect(materialContrast.shell).toBeGreaterThanOrEqual(4.5);
  expect(materialContrast.tools).toBeGreaterThanOrEqual(4.5);
  expect(materialContrast.tab).toBeGreaterThanOrEqual(4.5);
});

test('selected queue stage plays its exact index, pauses, and opens Feed without replacing the queue', async ({ page }) => {
  await seedRadioState(page, { activeSection: 'library', libraryTab: 'queue', queue: stations, queueCurrentIndex: 3, queueSourceId: 'personal', queueSourceLabel: 'My saved set' });
  await page.goto('/?calm=1');
  await openLibraryCategory(page, 'queue');
  const stage = page.locator('[data-queue-current]');
  const before = await readQueue(page);
  await expect(stage).toContainText('My saved set');
  expect(await playCalls(page)).toBe(0);
  await stage.getByRole('button', { name: `Слушать: ${stations[3].name}`, exact: true }).click();
  await expect(stage).toHaveAttribute('data-stage-status', 'playing');
  await expect.poll(() => page.locator('audio').getAttribute('src')).toContain('/sapporo');
  await stage.getByRole('button', { name: `Пауза: ${stations[3].name}`, exact: true }).click();
  await expect(stage).toHaveAttribute('data-stage-status', 'paused');
  const calls = await playCalls(page);
  await stage.getByRole('button', { name: 'В Ленту', exact: true }).click();
  await expect(page.locator('.station-feed-card-content[data-focus="true"]')).toContainText(stations[3].name);
  expect(await readQueue(page)).toEqual(before);
  expect(await playCalls(page)).toBe(calls);
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Моё', exact: true }).click();
  await openLibraryCategory(page, 'queue');
  await page.locator('.calm-queue-list > [data-queue-row]').first().getByRole('button', { name: /Слушать/ }).click();
  await expect(stage).toHaveAttribute('data-queue-current', stations[4].stationuuid);
  await expect(stage).toHaveAttribute('data-stage-status', 'playing');
  await expect.poll(async () => (await readQueue(page))?.currentIndex).toBe(4);
  expect((await readQueue(page))?.order).toEqual(before?.order);
});

for (const currentIndex of [-1, 0, 1]) {
  test(`two-station queue keeps an honest stage and end state at index ${currentIndex}`, async ({ page }) => {
    await seedRadioState(page, { activeSection: 'library', libraryTab: 'queue', queue: stations.slice(0, 2), queueCurrentIndex: currentIndex });
    await page.goto('/?calm=1');
    await openLibraryCategory(page, 'queue');
    const stage = page.locator('[data-queue-current]');
    await expect(stage).toHaveAttribute('data-queue-current', stations[Math.max(0, currentIndex)].stationuuid);
    await expect(stage).toHaveAttribute('data-stage-status', currentIndex < 0 ? 'start' : 'ready');
    await expect(page.locator('.calm-queue-list > [data-queue-row]')).toHaveCount(currentIndex === 1 ? 0 : 1);
    expect(await playCalls(page)).toBe(0);
    if (currentIndex === 1) {
      await expect(page.locator('.library-queue-end-state')).toContainText('Следующих станций');
      await expect(page.getByRole('button', { name: /Перемешать следующие/ })).toHaveCount(0);
    }
    await stage.getByRole('button', { name: /Слушать:/ }).click();
    await expect(stage).toHaveAttribute('data-stage-status', 'playing');
    await expect.poll(async () => (await readQueue(page))?.currentIndex).toBe(Math.max(0, currentIndex));
  });
}

test('a single unknown-genre station has no invented Pop label and stays playable', async ({ page }) => {
  const station = { ...stations[0], tags: '' };
  await seedRadioState(page, { activeSection: 'library', libraryTab: 'queue', queue: [station], queueCurrentIndex: -1, queueSourceLabel: null });
  await page.goto('/?calm=1');
  await openLibraryCategory(page, 'queue');
  const stage = page.locator('[data-queue-current]');
  await expect(stage.locator('.library-queue-stage-meta')).not.toContainText(/J-pop|Поп|Pop/);
  await expect(stage).toContainText('Свой набор');
  await expect(stage).not.toContainText('library.');
  await expect(page.locator('.library-queue-end-state')).toBeVisible();
  await stage.getByRole('button', { name: /Слушать:/ }).click();
  await expect(stage).toHaveAttribute('data-stage-status', 'playing');
  await expect(stage.locator('.library-queue-stage-grooves')).toHaveCSS('animation-name', 'library-queue-print-drift');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(stage.locator('.library-queue-stage-grooves')).toHaveCSS('animation-name', 'none');
});

test('short viewport keeps the selected station action above the dock', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 450 });
  await seedRadioState(page, { activeSection: 'library', libraryTab: 'queue', queue: stations, queueCurrentIndex: 3 });
  await page.goto('/?calm=1');
  await openLibraryCategory(page, 'queue');
  const action = page.locator('.library-queue-stage-primary');
  await expect(action).toBeVisible();
  const geometry = await action.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return { bottom: bounds.bottom, height: bounds.height, dockTop: document.querySelector('[data-calm-player]')!.getBoundingClientRect().top };
  });
  expect(geometry.height).toBeGreaterThanOrEqual(44);
  expect(geometry.bottom).toBeLessThan(geometry.dockTop);
});

test('pending Calm queue selection stays visible and blocks destructive edits until it resolves', async ({ page }) => {
  await seedRadioState(page, { activeSection: 'library', libraryTab: 'queue', queue: stations, queueCurrentIndex: 3 });
  await page.goto('/?calm=1');
  await openLibraryCategory(page, 'queue');
  await page.evaluate(() => {
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this.src.includes('/sapporo')) {
        const media = this;
        return new Promise<void>(resolve => {
          (window as unknown as { resolveQueuePlay: () => void }).resolveQueuePlay = () => {
            media.setAttribute('data-ra-state', 'playing');
            media.dispatchEvent(new Event('playing'));
            resolve();
          };
        });
      }
      return original.call(this);
    };
  });
  const stage = page.locator('[data-queue-current]');
  await stage.getByRole('button', { name: /Слушать:/ }).click();
  await expect(stage).toHaveAttribute('data-stage-status', 'buffering');
  await expect(stage).toHaveAttribute('data-queue-current', stations[3].stationuuid);
  await page.getByRole('button', { name: 'Изменить', exact: true }).click();
  await expect(page.getByRole('button', { name: /Перемешать следующие/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Очистить очередь', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Сохранить как плейлист', exact: true })).toBeEnabled();
  await expect(page.locator('[data-queue-row]').filter({ hasText: stations[5].name }).getByRole('button', { name: 'Выше', exact: true })).toBeDisabled();
  await page.evaluate(() => (window as unknown as { resolveQueuePlay: () => void }).resolveQueuePlay());
  await expect(page.locator('#queue-edit-pending-hint')).toHaveCount(0);
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await expect(stage).toHaveAttribute('data-stage-status', 'playing');
  await expect(stage).toHaveAttribute('data-queue-current', stations[3].stationuuid);
});

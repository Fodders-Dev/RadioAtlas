import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations, waitForAnimationsToSettle } from './helpers';

const start = async (page: Page, includeThirdCountry = false) => {
  await mockStations(page, includeThirdCountry ? { catalogPool: stations.slice(0, 12) } : undefined);
  await installMediaMocks(page);
};
const readQueue = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue);
const readFavoriteIds = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('radio:library:v2') || '{}').favorites?.map((item: { stationuuid: string }) => item.stationuuid) || []);
const touchDrag = async (page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 8) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
  for (let index = 1; index <= steps; index += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{
        x: from.x + ((to.x - from.x) * index) / steps,
        y: from.y + ((to.y - from.y) * index) / steps
      }]
    });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
};

test('cold Play seeds the whole visible discovery set', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await seedRadioState(page);
  await page.goto('/?calm=1');
  const stage = page.locator('[data-calm-discovery-stage]');
  const first = await stage.getAttribute('data-calm-offer');
  expect(await page.evaluate(() => document.querySelector('audio')?.getAttribute('src') ?? null)).toBeNull();
  await page.locator('[data-stage-play]').click();
  await expect(page.locator('[data-calm-player]')).toHaveAttribute('data-status', 'playing');
  await expect(stage.locator('.calm-stage-card')).toBeVisible();
  await expect(stage.locator('[data-calm-entry]')).toHaveCount(0);
  await expect(stage).toHaveAttribute('data-genre-family', /.+/);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue?.sourceId)).toBe('home-calm');
  const queueState = await readQueue(page);
  expect(queueState.items.length).toBeGreaterThan(3);
  expect(queueState.items[0].stationuuid).toBe(first);
});

test('Home card favorite saves the displayed station without changing playback or its queue', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await page.goto('/?calm=1');
  const stage = page.locator('[data-calm-discovery-stage]');
  const favorite = stage.locator('[data-stage-favorite]');
  await expect(stage).toBeVisible();
  const firstId = (await stage.getAttribute('data-calm-offer'))!;
  const firstName = (await stage.locator('.calm-stage-station').textContent())!.trim();
  await expect(favorite).toHaveAttribute('aria-pressed', 'false');
  await expect(favorite).toHaveAttribute('aria-label', `Добавить станцию в избранное: ${firstName}`);
  const quietQueue = await readQueue(page);
  await favorite.click();
  await expect(favorite).toHaveAttribute('aria-pressed', 'true');
  await expect(favorite).toHaveAttribute('aria-label', `Убрать станцию из избранного: ${firstName}`);
  await expect.poll(() => readFavoriteIds(page)).toContain(firstId);
  expect(await page.evaluate(() => document.querySelector('audio')?.getAttribute('src') ?? null)).toBeNull();
  expect(await readQueue(page)).toEqual(quietQueue);

  await stage.locator('[data-stage-play]').click();
  await expect(page.locator('[data-calm-player]')).toHaveAttribute('data-status', 'playing');
  const playingSource = await page.locator('audio').first().getAttribute('src');
  await expect.poll(async () => (await readQueue(page))?.items?.some((item: { stationuuid: string }) => item.stationuuid === firstId)).toBe(true);
  const playingQueue = await readQueue(page);
  expect(playingQueue.items[playingQueue.currentIndex].stationuuid).toBe(firstId);
  for (const expectedPressed of ['false', 'true']) {
    await favorite.click();
    await expect(favorite).toHaveAttribute('aria-pressed', expectedPressed);
    await expect(stage).toHaveAttribute('data-calm-offer', firstId);
    expect(await page.locator('audio').first().getAttribute('src')).toBe(playingSource);
    expect(await readQueue(page)).toEqual(playingQueue);
  }

  const nextId = playingQueue.items[playingQueue.currentIndex + 1]?.stationuuid;
  expect(nextId, 'the Home queue must have another station to verify favorite isolation').toBeTruthy();
  await stage.locator('[data-stage-next]').click();
  await expect(stage).toHaveAttribute('data-calm-offer', nextId!);
  await expect(favorite).toHaveAttribute('aria-pressed', 'false');

  // The next card arrives with a finite translate/rotate animation. Measuring
  // its heart mid-flight can start the coordinate drag on the card instead.
  await waitForAnimationsToSettle(page, '.calm-stage-card');
  const favoriteBox = await favorite.boundingBox();
  expect(favoriteBox, 'the favorite control must be measurable for the swipe exclusion check').not.toBeNull();
  expect(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('[data-stage-favorite]')), {
    x: favoriteBox!.x + favoriteBox!.width / 2,
    y: favoriteBox!.y + favoriteBox!.height / 2
  }), 'the coordinate drag must start on the favorite control').toBe(true);
  await page.mouse.move(favoriteBox!.x + favoriteBox!.width / 2, favoriteBox!.y + favoriteBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(favoriteBox!.x + favoriteBox!.width / 2 - 80, favoriteBox!.y + favoriteBox!.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(stage).toHaveAttribute('data-calm-offer', nextId!);
  await expect(favorite).toHaveAttribute('aria-pressed', 'false');

  await stage.locator('[data-stage-previous]').click();
  await expect(stage).toHaveAttribute('data-calm-offer', firstId);
  await expect(favorite).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => readFavoriteIds(page)).toContain(firstId);
  const savedQueue = await readQueue(page);
  await page.reload();
  await expect(stage).toHaveAttribute('data-calm-offer', firstId);
  await expect(favorite).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.querySelector('audio')?.getAttribute('src') ?? null)).toBeNull();
  await expect.poll(() => readFavoriteIds(page)).toContain(firstId);
  await favorite.click();
  await expect(favorite).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => readFavoriteIds(page)).not.toContain(firstId);
  expect(await page.evaluate(() => document.querySelector('audio')?.getAttribute('src') ?? null)).toBeNull();
  expect(await readQueue(page)).toEqual(savedQueue);
});

test('Home favorite button keeps clear contrast in the selected theme', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await page.goto('/?calm=1');
  const favorite = page.locator('[data-stage-favorite]');
  const previewTitle = page.locator('.calm-stage-preview-copy > strong').first();
  await expect(previewTitle).toBeVisible();
  for (const theme of ['classic', 'neon', 'journal']) {
    await page.locator('.calm-journal-heading').getByRole('button', { name: 'Оформление', exact: true }).click();
    await page.locator(`[data-theme-card="${theme}"]`).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    if (await favorite.getAttribute('aria-pressed') === 'true') {
      await favorite.click();
      await expect.poll(() => favorite.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 249, 235)');
    }
    const unselected = await favorite.evaluate((el) => ({
      background: getComputedStyle(el).backgroundColor,
      color: getComputedStyle(el).color,
      stroke: getComputedStyle(el.querySelector('svg path')!).stroke,
      box: el.getBoundingClientRect().toJSON()
    }));
    expect(unselected.background).toBe('rgb(255, 249, 235)');
    expect(unselected.color).toBe('rgb(48, 70, 57)');
    expect(unselected.stroke).toBe('rgb(48, 70, 57)');
    expect(unselected.box.width).toBeGreaterThanOrEqual(44);
    expect(unselected.box.height).toBeGreaterThanOrEqual(44);
    await expect.poll(() => previewTitle.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(48, 47, 40)');
    await favorite.click();
    await expect(favorite).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => favorite.evaluate((el) => ({
      background: getComputedStyle(el).backgroundColor,
      color: getComputedStyle(el).color,
      stroke: getComputedStyle(el.querySelector('svg path')!).stroke
    }))).toEqual({ background: 'rgb(169, 71, 48)', color: 'rgb(255, 248, 233)', stroke: 'rgb(255, 248, 233)' });
  }
});

test('rapid Next advances from the station currently buffering in a personal queue', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  const listenerQueue = stations.slice(0, 4);
  await seedRadioState(page, { queue: listenerQueue, queueCurrentIndex: 0, stationCache: listenerQueue });
  await page.goto('/?calm=1');
  await page.locator('[data-stage-play]').click();
  await expect(page.locator('[data-calm-player]')).toHaveAttribute('data-status', 'playing');
  await page.evaluate(() => { HTMLMediaElement.prototype.play = function () { return new Promise(() => {}); }; });
  const next = page.locator('[data-stage-next]');
  await next.click();
  await expect(page.locator('[data-calm-discovery-stage]')).toHaveAttribute('data-calm-air', 'buffering');
  await next.click();
  await expect.poll(() => page.locator('[data-calm-discovery-stage]').getAttribute('data-calm-offer')).toBe(listenerQueue[2].stationuuid);
  await expect.poll(async () => {
    const queueState = await readQueue(page);
    return { source: queueState.sourceId, ids: queueState.items.map((item: { stationuuid: string }) => item.stationuuid), index: queueState.currentIndex };
  }).toEqual({ source: 'seeded-home', ids: listenerQueue.map((item) => item.stationuuid), index: 0 });
});

test('rapid Previous backs up from the station currently buffering in a personal queue', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  const listenerQueue = stations.slice(0, 4);
  await seedRadioState(page, { queue: listenerQueue, queueCurrentIndex: 2, stationCache: listenerQueue });
  await page.goto('/?calm=1');
  await page.locator('[data-stage-play]').click();
  await expect(page.locator('[data-calm-player]')).toHaveAttribute('data-status', 'playing');
  await page.evaluate(() => { HTMLMediaElement.prototype.play = function () { return new Promise(() => {}); }; });
  const previous = page.locator('[data-stage-previous]');
  await previous.click();
  await expect(page.locator('[data-calm-discovery-stage]')).toHaveAttribute('data-calm-air', 'buffering');
  await previous.click();
  await expect.poll(() => page.locator('[data-calm-discovery-stage]').getAttribute('data-calm-offer')).toBe(listenerQueue[0].stationuuid);
  await expect.poll(async () => {
    const queueState = await readQueue(page);
    return { source: queueState.sourceId, ids: queueState.items.map((item: { stationuuid: string }) => item.stationuuid), index: queueState.currentIndex };
  }).toEqual({ source: 'seeded-home', ids: listenerQueue.map((item) => item.stationuuid), index: 2 });
});

test('story details arrive without blocking playback and stale station data never replaces the new card', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  const queue = stations.slice(0, 4);
  await seedRadioState(page, { queue, queueCurrentIndex: 0, stationCache: queue });
  let releaseFirst!: () => void;
  let firstRequested = false;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  await page.route('**/catalog/stations/*/story', async (route) => {
    const url = new URL(route.request().url());
    const stationId = url.pathname.split('/').at(-2);
    if (stationId === queue[0].stationuuid) {
      firstRequested = true;
      await firstGate;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ story: { description: 'Old station description', artworkUrl: 'https://assets.laut.fm/old.png', artists: ['Old Artist'], sourceUrl: 'https://laut.fm/tokyo', sourceLabel: 'laut.fm' } }) }).catch(() => undefined);
      return;
    }
    if (stationId === queue[1].stationuuid) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ story: { description: 'A warm late-night selection from the station, known for a deep catalog and familiar voices that reward a longer listen.', artworkUrl: 'https://assets.laut.fm/osaka.png', artists: ['Artist One', 'Artist Two', 'Artist Three'], sourceUrl: 'https://laut.fm/osakanights', sourceLabel: 'laut.fm' } }) });
      return;
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ story: null }) });
  });
  await page.goto('/?calm=1');
  const stage = page.locator('[data-calm-discovery-stage]');
  await expect(stage).toHaveAttribute('data-calm-offer', queue[0].stationuuid);
  await expect.poll(() => firstRequested).toBe(true);
  await page.locator('[data-stage-play]').click();
  await expect(page.locator('[data-calm-player]')).toHaveAttribute('data-status', 'playing');
  await page.locator('[data-stage-next]').click();
  await expect(stage).toHaveAttribute('data-calm-offer', queue[1].stationuuid);
  await expect(stage.locator('.calm-stage-description')).toContainText('A warm late-night selection from the station');
  await expect(stage.locator('.calm-stage-artists')).toContainText('Artist One · Artist Two · Artist Three');
  await expect(stage.locator('.calm-stage-source')).toHaveAttribute('href', 'https://laut.fm/osakanights');
  const fullDescription = 'A warm late-night selection from the station, known for a deep catalog and familiar voices that reward a longer listen.';
  await stage.locator('.calm-stage-info').click();
  const sourceSheet = page.locator(`[data-calm-source="${queue[1].stationuuid}"]`);
  await expect(sourceSheet.locator('.calm-source-story-description')).toHaveText(fullDescription);
  await expect(sourceSheet.locator('.calm-source-story-artists')).toContainText('Artist One · Artist Two · Artist Three');
  await page.keyboard.press('Escape');
  releaseFirst();
  await page.waitForTimeout(80);
  await expect(stage.locator('.calm-stage-description')).not.toContainText('Old station description');
  await expect(stage.locator('.calm-stage-artists')).not.toContainText('Old Artist');
});

test('missing station story uses its real genre and language as the compact fallback', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await seedRadioState(page);
  await page.route('**/catalog/stations/*/story', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ story: null }) }));
  await page.goto('/?calm=1');
  await expect(page.locator('.calm-stage-description')).toContainText('Japanese');
  await expect(page.locator('.calm-stage-art-label')).toBeVisible();
});

test('the cover stack swipes next and previous; tap and vertical drag stay inert', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  const queue = stations.slice(0, 4);
  await seedRadioState(page, { queue, queueCurrentIndex: 1, stationCache: queue });
  await page.goto('/?calm=1');
  const stage = page.locator('[data-calm-discovery-stage]');
  const stack = page.locator('[data-stage-cover-stack]');
  await expect(stage).toHaveAttribute('data-calm-offer', queue[1].stationuuid);
  const beforeTap = await readQueue(page);
  await stack.click({ position: { x: 65, y: 65 } });
  expect(await readQueue(page)).toEqual(beforeTap);
  expect(await page.evaluate(() => document.querySelector('audio')?.getAttribute('src') ?? null)).toBeNull();
  const drag = async (dx: number, dy: number) => {
    const box = await stack.boundingBox();
    if (!box) throw new Error('Cover stack is not visible');
    const x = box.x + box.width * .52;
    const y = box.y + box.height * .5;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 5 });
    await page.mouse.up();
  };
  await drag(-100, 0);
  await expect.poll(() => stage.getAttribute('data-calm-offer')).toBe(queue[2].stationuuid);
  await drag(100, 0);
  await expect.poll(() => stage.getAttribute('data-calm-offer')).toBe(queue[1].stationuuid);
  await drag(5, 60);
  await expect(stage).toHaveAttribute('data-calm-offer', queue[1].stationuuid);
});

test('the cover stack uses real touch for Next and leaves vertical page scroll available', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  const queue = stations.slice(0, 4);
  await seedRadioState(page, { queue, queueCurrentIndex: 0, stationCache: queue });
  await page.goto('/?calm=1');
  const stage = page.locator('[data-calm-discovery-stage]');
  const stack = page.locator('[data-stage-cover-stack]');
  const firstId = await stage.getAttribute('data-calm-offer');
  const box = await stack.boundingBox();
  if (!box) throw new Error('Cover stack is not visible');
  const x = Math.round(box.x + box.width * .52);
  const y = Math.round(box.y + box.height * .5);
  await touchDrag(page, { x, y }, { x: x + 5, y: y - 180 });
  await page.waitForTimeout(100);
  const afterScroll = await page.evaluate(() => window.scrollY);
  expect(afterScroll).toBeGreaterThan(0);
  await expect(stage).toHaveAttribute('data-calm-offer', firstId!);
  await page.evaluate(() => window.scrollTo(0, 0));
  const fresh = await stack.boundingBox();
  if (!fresh) throw new Error('Cover stack is not visible after scrolling back');
  const startX = Math.round(fresh.x + fresh.width * .52);
  const startY = Math.round(fresh.y + fresh.height * .5);
  await touchDrag(page, { x: startX, y: startY }, { x: startX - 110, y: startY });
  await expect.poll(() => stage.getAttribute('data-calm-offer')).toBe(queue[1].stationuuid);
});

test('Home stage keeps a portrait cover, real adjacent cards, and large controls at each width', async ({ page }) => {
  await start(page);
  const listenerQueue = stations.slice(0, 4);
  await seedRadioState(page, { queue: listenerQueue, queueCurrentIndex: 1, stationCache: stations });
  await page.goto('/?calm=1');
  await expect(page.locator('[data-stage-previous]')).toBeVisible();
  await waitForAnimationsToSettle(page, '.calm-stage-card');
  for (const width of [320, 390, 700, 834, 900, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const geometry = await page.evaluate(() => {
      const stage = document.querySelector<HTMLElement>('[data-calm-discovery-stage]')!;
      const name = document.querySelector<HTMLElement>('.calm-stage-station')!;
      const play = document.querySelector<HTMLElement>('[data-stage-play]')!;
      const previous = document.querySelector<HTMLElement>('[data-stage-previous]')!;
      const next = document.querySelector<HTMLElement>('[data-stage-next]')!;
      const cover = document.querySelector<HTMLElement>('.calm-stage-card')!;
      const art = document.querySelector<HTMLElement>('.calm-stage-art')!.getBoundingClientRect();
      const favorite = document.querySelector<HTMLElement>('[data-stage-favorite]')!.getBoundingClientRect();
      const actions = document.querySelector<HTMLElement>('.calm-stage-actions')!.getBoundingClientRect();
      const stageBox = stage.getBoundingClientRect();
      const deck = document.querySelector<HTMLElement>('.calm-stage-deck')!;
      const deckWidth = deck.getBoundingClientRect().width;
      const nameBox = name.getBoundingClientRect();
      const nextBox = next.getBoundingClientRect();
      const cardBox = cover.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        stageWidth: stageBox.width,
        stageLeft: stageBox.left,
        stageRight: stageBox.right,
        stageHeight: stage.getBoundingClientRect().height,
        nameSize: parseFloat(getComputedStyle(name).fontSize),
        playSize: Math.min(play.getBoundingClientRect().width, play.getBoundingClientRect().height),
        previousSize: Math.min(previous.getBoundingClientRect().width, previous.getBoundingClientRect().height),
        favoriteSize: Math.min(favorite.width, favorite.height),
        favoriteInArt: favorite.left >= art.left && favorite.top >= art.top && favorite.right <= art.right && favorite.bottom <= art.bottom,
        actionEdgeGap: stageBox.right - nextBox.right,
        cardControlGap: cardBox.right - nextBox.right,
        actionNameGap: actions.top - nameBox.bottom,
        coverWidth: cover.getBoundingClientRect().width,
        coverHeight: cover.getBoundingClientRect().height,
        deckWidth,
        previewBoxes: [...document.querySelectorAll<HTMLElement>('[data-stage-preview]')]
          .filter((preview) => getComputedStyle(preview).display !== 'none')
          .map((preview) => {
            const title = preview.querySelector<HTMLElement>('.calm-stage-preview-copy > strong');
            const titleBox = title?.getBoundingClientRect();
            const titleHit = titleBox && document.elementFromPoint(titleBox.left + titleBox.width / 2, titleBox.top + titleBox.height / 2);
            return {
              ...preview.getBoundingClientRect().toJSON(),
              title: titleBox?.toJSON(),
              titleVisible: !!title && !!titleHit && (title === titleHit || title.contains(titleHit))
            };
          })
      };
    });
    expect(geometry.overflow, 'horizontal overflow at ' + width + 'px').toBe(false);
    if (width <= 390) expect(geometry.stageHeight).toBeLessThanOrEqual(500);
    expect(geometry.nameSize).toBeGreaterThanOrEqual(width <= 390 ? 14 : 16);
    expect(geometry.playSize).toBeGreaterThanOrEqual(44);
    expect(geometry.previousSize).toBeGreaterThanOrEqual(44);
    expect(geometry.favoriteSize).toBeGreaterThanOrEqual(44);
    expect(geometry.favoriteInArt).toBe(true);
    expect(geometry.actionEdgeGap).toBeGreaterThanOrEqual(8);
    expect(geometry.cardControlGap).toBeGreaterThanOrEqual(8);
    expect(geometry.actionNameGap).toBeGreaterThanOrEqual(0);
    expect(geometry.coverWidth).toBeGreaterThanOrEqual(width === 320 ? 90 : 110);
    expect(geometry.coverWidth).toBeLessThanOrEqual(340);
    expect(geometry.coverHeight / geometry.coverWidth).toBeGreaterThan(1.2);
    expect(geometry.previewBoxes.length).toBe(width <= 599 || geometry.deckWidth < 700 ? 1 : 2);
    expect(geometry.previewBoxes.every((box) => box.left >= geometry.stageLeft - 1 && box.right <= geometry.stageRight + 1)).toBe(true);
    expect(geometry.previewBoxes.every((box) => box.title && box.title.width > 0 && box.title.height > 0 && (width < 600 || box.titleVisible)), `preview title must remain exposed at ${width}px: ${JSON.stringify(geometry.previewBoxes)}`).toBe(true);
    if (width >= 700) {
      expect(geometry.previewBoxes[0]).toBeDefined();
      expect(geometry.previewBoxes[0].width).toBeGreaterThanOrEqual(200);
      expect(geometry.previewBoxes[0].height).toBeGreaterThanOrEqual(440);
    }
  }
});

test('a real adjacent preview selects its own station at the correct queue index', async ({ page }) => {
  await page.setViewportSize({ width: 834, height: 900 });
  await start(page);
  const queue = stations.slice(0, 4);
  await seedRadioState(page, { queue, queueCurrentIndex: 0, stationCache: queue });
  await page.goto('/?calm=1');
  const stage = page.locator('[data-calm-discovery-stage]');
  const preview = page.locator(`[data-stage-preview="${queue[2].stationuuid}"]`);
  await expect(preview).toBeVisible();
  const previewBox = await preview.boundingBox();
  if (!previewBox) throw new Error('Second real queue preview is not measurable');
  await preview.click({ position: { x: previewBox.width - 34, y: previewBox.height * .72 } });
  await expect(stage).toHaveAttribute('data-calm-offer', queue[2].stationuuid);
  await expect(stage).toHaveAttribute('data-stage-turn', `${queue[2].stationuuid}:next`);
  await expect.poll(async () => {
    const currentQueue = await readQueue(page);
    return { source: currentQueue.sourceId, index: currentQueue.currentIndex, ids: currentQueue.items.map((item: { stationuuid: string }) => item.stationuuid) };
  }).toEqual({ source: 'seeded-home', index: 2, ids: queue.map((item) => item.stationuuid) });
});

test('favorite and info controls do not start a horizontal station swipe', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  const queue = stations.slice(0, 3);
  await seedRadioState(page, { queue, queueCurrentIndex: 0, stationCache: queue });
  await page.goto('/?calm=1');
  const stage = page.locator('[data-calm-discovery-stage]');
  const stack = page.locator('[data-stage-cover-stack]');
  const originalId = queue[0].stationuuid;
  for (const selector of ['[data-stage-favorite]', '.calm-stage-info']) {
    const control = stage.locator(selector);
    const box = await control.boundingBox();
    if (!box) throw new Error(`${selector} control is not measurable`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2, { steps: 5 });
    await expect(stack).not.toHaveAttribute('data-swipe-dx', /.+/);
    await page.mouse.up();
    await expect(stage).toHaveAttribute('data-calm-offer', originalId);
    if (selector === '.calm-stage-info') await page.keyboard.press('Escape');
  }
});

test('long station names fit at 320px and reduced motion stays still', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await start(page);
  const longStation = { ...stations[0], stationuuid: 'fixture-long-radio', name: 'A Long Broadcast Name That Needs Two Lines', countrycode: '', country: 'United States of America and the Islands' };
  const longQueue = [longStation, stations[1], stations[2]];
  await seedRadioState(page, { queue: longQueue, queueCurrentIndex: 0, stationCache: longQueue });
  await page.goto('/?calm=1');
  const stage = page.locator('[data-calm-discovery-stage]');
  const stack = page.locator('[data-stage-cover-stack]');
  await expect(stage).toBeVisible();
  await expect(stage).toHaveAttribute('data-calm-offer', longStation.stationuuid);
  await expect(page.locator('[data-stage-play]')).toBeVisible();
  await expect(page.locator('.calm-stage-details')).toContainText(longStation.country);
  await expect(page.locator('.calm-stage-station')).toContainText(longStation.name);
  const resting = await stack.evaluate((el) => getComputedStyle(el.querySelector('.calm-stage-card')!).transform);
  const stackBox = await stack.boundingBox();
  if (!stackBox) throw new Error('Cover stack is not visible');
  const x = stackBox.x + stackBox.width * .5;
  const y = stackBox.y + stackBox.height * .5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 100, y, { steps: 5 });
  await expect(stack).toHaveAttribute('data-swipe-dx', '-100');
  const duringDrag = await stack.evaluate((el) => ({
    transform: getComputedStyle(el.querySelector('.calm-stage-card')!).transform,
    duration: getComputedStyle(el.querySelector('.calm-stage-card')!).transitionDuration
  }));
  await page.mouse.up();
  const geometry = await page.evaluate(() => {
    const play = document.querySelector<HTMLElement>('[data-stage-play]')!.getBoundingClientRect();
    const cover = document.querySelector<HTMLElement>('.calm-stage-card')!.getBoundingClientRect();
    return { overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      playSize: Math.min(play.width, play.height), coverWidth: cover.width };
  });
  expect(geometry.overflow).toBe(false);
  expect(geometry.playSize).toBeGreaterThanOrEqual(44);
  expect(geometry.coverWidth).toBeGreaterThan(80);
  expect(duringDrag.transform).toBe(resting);
  expect(duringDrag.duration).toBe('0s');
  await stage.locator('[data-stage-next]').click();
  await expect(stage).not.toHaveAttribute('data-calm-offer', longStation.stationuuid);
  expect(await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running').length)).toBe(0);
});

test('restored station stays paused through Globe and Feed navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await seedRadioState(page, { queue: [stations[0]], queueCurrentIndex: 0, stationCache: [stations[0]] });
  await page.goto('/?calm=1');
  const stage = page.locator('[data-calm-discovery-stage]');
  await expect(stage).toHaveAttribute('data-stage-status', 'paused');
  expect(await page.evaluate(() => document.querySelector('audio')?.getAttribute('src') ?? null)).toBeNull();
  const nav = page.locator('.app-navigation-mobile');
  await nav.getByRole('button', { name: /Глобус|Globe/ }).click();
  await expect(page.locator('.app-shell-v2')).toHaveAttribute('data-active-section', 'globe');
  await nav.getByRole('button', { name: 'Главная', exact: true }).click();
  await expect(stage).toBeVisible();
  await nav.getByRole('button', { name: /Лента|Feed/ }).click();
  await expect(page.locator('.station-feed-overlay')).toBeVisible();
  expect(await page.evaluate(() => document.querySelector('audio')?.getAttribute('src') ?? null)).toBeNull();
});

test('station details Play keeps its position in the listener queue', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  const listenerQueue = stations.slice(0, 3);
  await seedRadioState(page, { queue: listenerQueue, queueCurrentIndex: 0, stationCache: listenerQueue });
  await page.goto('/?calm=1');
  const selected = listenerQueue[1];
  const row = page.locator('[data-calm-live-station=\"' + selected.stationuuid + '\"]');
  await expect(row).toBeVisible();
  await row.locator('.calm-live-info').click();
  const source = page.locator('[data-calm-source=\"' + selected.stationuuid + '\"]');
  await expect(source).toBeVisible();
  await source.locator('[data-source-play]').click();
  await expect.poll(async () => {
    const queueState = await readQueue(page);
    return { source: queueState.sourceId, ids: queueState.items.map((item: { stationuuid: string }) => item.stationuuid), index: queueState.currentIndex };
  }).toEqual({ source: 'seeded-home', ids: listenerQueue.map((station) => station.stationuuid), index: 1 });
});

test('a personal queue end stays intact until the listener explicitly opens discovery', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await seedRadioState(page, { queue: [stations[0]], queueCurrentIndex: 0, stationCache: stations });
  await page.goto('/?calm=1');
  const before = stations[0].stationuuid;
  const discovery = page.locator('[data-stage-discover]');
  const queueBefore = await readQueue(page);
  await expect(discovery).toBeVisible();
  await expect(discovery).toHaveText('Открывать новое');
  await expect(page.locator('[data-stage-preview]')).toHaveCount(0);
  await expect(page.locator('[data-calm-discovery-stage]')).toHaveAttribute('data-calm-offer', before);
  expect(await readQueue(page)).toEqual(queueBefore);
  const stack = page.locator('[data-stage-cover-stack]');
  const box = await stack.boundingBox();
  if (!box) throw new Error('End of queue card is not measurable');
  const x = box.x + box.width * .5;
  const y = box.y + box.height * .5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 100, y, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('[data-calm-discovery-stage]')).toHaveAttribute('data-calm-offer', before);
  expect(await readQueue(page)).toEqual(queueBefore);
  await discovery.click();
  await expect.poll(async () => (await readQueue(page)).sourceId).toBe('home-calm');
  await expect.poll(() => page.locator('[data-calm-discovery-stage]').getAttribute('data-calm-offer')).not.toBe(before);
});

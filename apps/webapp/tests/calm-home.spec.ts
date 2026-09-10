import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations, waitForAnimationsToSettle } from './helpers';

const start = async (page: Page) => {
  await mockStations(page);
  await installMediaMocks(page);
  await seedRadioState(page);
};
const layout = (page: Page) => page.evaluate(() => ({
  offer: document.querySelector('[data-calm-offer]')?.getAttribute('data-calm-offer'),
  sections: [...document.querySelectorAll('.calm-section')].map(el => Math.round(el.getBoundingClientRect().top + window.scrollY)),
  width: document.documentElement.scrollWidth,
  viewport: window.innerWidth
}));

for (const width of [320, 390, 411]) for (const theme of ['aurora-field', 'pastel']) {
  test(`calm ${width} ${theme}: play and capture keep Home in place`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await start(page);
    await page.addInitScript(id => localStorage.setItem('radio:theme-current:v1', JSON.stringify(id)), theme);
    // A denied clipboard must still leave the find in the real library store.
    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } }));
    await page.goto('/?calm=1');
    await expect(page.locator('[data-calm-home]')).toBeVisible();
    await expect(page.locator('[data-calm-player]')).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await waitForAnimationsToSettle(page, '.app-screen-frame');
    const before = await layout(page);
    expect(before.width).toBeLessThanOrEqual(before.viewport);
    await page.locator('.calm-primary').click();
    const dock = page.locator('[data-calm-player]');
    await expect(dock).toHaveAttribute('data-status', 'playing');
    await expect(dock.locator('.calm-capture')).toBeVisible();
    // This is a UI-state mock. It does not prove audio progression on iPhone.
    const source = await page.locator('audio').first().getAttribute('src');
    await dock.locator('.calm-capture').click();
    await expect(dock.locator('.calm-capture')).toHaveAttribute('aria-pressed', 'true');
    // Mutation: removing copyTrack() from the capture handler must fail here.
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('radio:library:v2') || '{}').trackHistory?.length || 0)).toBe(1);
    const find = await page.evaluate(() => JSON.parse(localStorage.getItem('radio:library:v2') || '{}').trackHistory[0]);
    expect(find.stationId).toBe(before.offer);
    expect(find.track).toBeTruthy();
    expect(find.timestamp).toBeGreaterThan(0);
    expect(await layout(page)).toEqual(before);
    expect(await page.locator('audio').first().getAttribute('src')).toBe(source);
    await expect(dock).toHaveAttribute('data-status', 'playing');
    const geometry = await dock.evaluate(el => {
      const box = el.getBoundingClientRect();
      const nav = document.querySelector('.app-navigation-mobile')!.getBoundingClientRect();
      return { height: box.height, bottom: box.bottom, navTop: nav.top, targets: [...el.querySelectorAll('button')].map(b => [b.getBoundingClientRect().width, b.getBoundingClientRect().height]) };
    });
    expect(geometry.height).toBeLessThanOrEqual(82);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.navTop);
    for (const [w, h] of geometry.targets) { expect(w).toBeGreaterThanOrEqual(44); expect(h).toBeGreaterThanOrEqual(44); }
    await page.screenshot({ path: `../../output/playwright/calm/real-${width}-${theme}.png` });
    await dock.getByRole('button', { name: 'Пауза', exact: true }).click();
    await expect(dock.locator('[data-live="true"]')).toHaveCount(0);
    await page.locator('.calm-find').scrollIntoViewIfNeeded();
    const lastRow = await page.locator('.calm-find').boundingBox();
    const playerBox = await dock.boundingBox();
    expect(lastRow!.y + lastRow!.height).toBeLessThanOrEqual(playerBox!.y);
    await page.locator('.calm-find').click();
    await expect(page.locator('.app-shell-v2')).toHaveAttribute('data-active-section', 'library');
  });
}

test('restored station has no live claim; full player keeps additional controls reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockStations(page); await installMediaMocks(page);
  await seedRadioState(page, { queue: [stations[0]], queueCurrentIndex: 0, stationCache: [stations[0]] });
  await page.goto('/?calm=1');
  const dock = page.locator('[data-calm-player]');
  await expect(dock).toBeVisible();
  await expect(dock.locator('[data-live="true"]')).toHaveCount(0);
  await expect(dock.locator('.calm-capture')).toHaveCount(0);
  await dock.locator('.calm-mini-info').click();
  await expect(page.locator('.app-shell-v2')).toHaveAttribute('data-winamp-expanded', 'true');
  await expect(dock).toHaveCount(0);
});

test('off by default', async ({ page }) => {
  await start(page); await page.goto('/');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();
  await expect(page.locator('[data-calm-home]')).toHaveCount(0);
});

test('country discovery previews real stations without changing playback', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await start(page);
  await page.goto('/?calm=1');
  await page.locator('.calm-primary').click();
  const dock = page.locator('[data-calm-player]');
  await expect(dock).toHaveAttribute('data-status', 'playing');
  const source = await page.locator('audio').first().getAttribute('src');
  const countries = page.getByRole('group', { name: 'Выбрать страну' });
  await countries.getByRole('button', { name: 'Japan', exact: true }).click();
  await expect(page.locator('[data-discovery-station="uuid-tokyo"]')).toBeVisible();
  await countries.getByRole('button', { name: 'Germany', exact: true }).click();
  await expect(page.locator('[data-discovery-station="uuid-tokyo"]')).toHaveCount(0);
  await expect(page.locator('.calm-destination').first()).toContainText('Germany');
  expect(await page.locator('audio').first().getAttribute('src')).toBe(source);
  await expect(dock).toHaveAttribute('data-status', 'playing');
  const next = await page.locator('.calm-destination').first().getAttribute('data-discovery-station');
  await page.locator('.calm-destination').first().click();
  const expected = stations.find(s => s.stationuuid === next)!;
  await expect(dock.locator('.calm-mini-info small')).toContainText(expected.name);
  await expect(dock).toHaveAttribute('data-status', 'playing');
  const nextSource = await page.locator('audio').first().getAttribute('src');
  await page.locator('.calm-globe-entry').click();
  await expect(page.locator('.app-shell-v2')).toHaveAttribute('data-active-section', 'globe');
  expect(await page.locator('audio').first().getAttribute('src')).toBe(nextSource);
});

test('saved find shows its actual source and returns there only on explicit play', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockStations(page); await installMediaMocks(page);
  await seedRadioState(page, { stationCache: [stations[0]], trackHistory: [{
    id: 'kept-find', stationId: stations[0].stationuuid, stationName: stations[0].name,
    track: 'An artist — A captured song', timestamp: Date.now()
  }] });
  await page.goto('/?calm=1');
  const find = page.locator('.calm-saved-find');
  await expect(find).toContainText('An artist — A captured song');
  await expect(find).toContainText('Tokyo FM');
  await expect(page.locator('[data-calm-player]')).toHaveCount(0);
  await find.getByRole('button', { name: /Вернуться на станцию/ }).click();
  await expect(page.locator('[data-calm-player]')).toHaveAttribute('data-status', 'playing');
  await expect(page.locator('.calm-mini-info small')).toContainText('Tokyo FM');
});

test('stream failure retains a retry; retry and browsing do not start another station', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await start(page);
  // Keep native WAV playback from racing our deliberately rejected play().
  // Media events in this state test come only from the test's play mock.
  await page.route('**/*', route => route.request().resourceType() === 'media' ? undefined : route.fallback());
  await page.addInitScript(() => { HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException('unsupported fixture', 'NotSupportedError')); });
  await page.goto('/?calm=1');
  await page.locator('.calm-primary').click();
  const dock = page.locator('[data-calm-player]');
  await expect(dock).toHaveAttribute('data-status', 'error');
  await expect(dock.locator('[data-live="true"]')).toHaveCount(0);
  await expect(dock.locator('.calm-capture')).toHaveCount(0);
  await page.evaluate(() => { HTMLMediaElement.prototype.play = function () { this.dispatchEvent(new Event('playing')); return Promise.resolve(); }; });
  await expect(dock.locator('.calm-mini-play')).toHaveAccessibleName('Повторить');
  await dock.locator('.calm-mini-play').click();
  await expect(dock).toHaveAttribute('data-status', 'playing');
  const source = await page.locator('audio').first().getAttribute('src');
  await page.locator('.calm-choose').click();
  await expect(page.locator('.station-feed-overlay')).toBeVisible();
  expect(await page.locator('audio').first().getAttribute('src')).toBe(source);
});

test('real Theme Studio image survives the Home and player composition', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await start(page);
  await page.goto('/?calm=1');
  await expect(page.locator('[data-calm-home]')).toBeVisible();
  await page.locator('.mobile-settings-trigger').click();
  await page.getByRole('button', { name: /Open Theme Studio|Открыть Theme Studio/ }).click();
  await page.getByLabel(/Name|Название/).fill('Calm custom');
  await page.locator('[data-theme-builder-print]').setInputFiles({ name: 'print.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="800"><rect width="400" height="800" fill="#fff3bf"/><path d="M0 0h200v800H0z" fill="#742d5c"/></svg>') });
  await page.getByRole('button', { name: /Save and apply|Сохранить и применить/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-backdrop', 'image');
  for (let i = 0; i < 2; i++) {
    const close = page.locator('.settings-sheet').last().locator('.settings-sheet-head .chip');
    if (await close.count()) await close.click();
  }
  await page.locator('.calm-primary').click();
  await expect(page.locator('[data-calm-player]')).toHaveAttribute('data-status', 'playing');
  await expect(page.locator('.calm-capture')).toBeVisible();
  // blur(0px) is still a backdrop root: the legacy entrance must not retain it.
  expect(await page.locator('.app-screen-frame').evaluate(el => getComputedStyle(el).filter)).toBe('none');
  expect(await page.locator('.calm-hero').evaluate(el => getComputedStyle(el).backdropFilter)).toContain('blur(');
  expect(await page.locator('.calm-home').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await page.screenshot({ path: '../../output/playwright/calm/real-custom.png' });
  expect((await layout(page)).width).toBeLessThanOrEqual(390);
});

test('connecting never claims live audio or exposes an old find', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await start(page);
  await page.route('**/*', route => route.request().resourceType() === 'media' ? undefined : route.fallback());
  await page.addInitScript(() => { HTMLMediaElement.prototype.play = () => new Promise(() => {}); });
  await page.goto('/?calm=1'); await page.locator('.calm-primary').click();
  const dock = page.locator('[data-calm-player]');
  await expect(dock).toHaveAttribute('data-status', 'buffering');
  await expect(dock.locator('[data-live="true"]')).toHaveCount(0);
  await expect(dock.locator('.calm-capture')).toHaveCount(0);
});

test('unknown track leaves station and playback usable without a fake save', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await start(page);
  await page.route('**/metadata?url=**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"title":null}' }));
  await page.route('**/status-json.xsl', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/fetch?url=**', route => route.fulfill({ status: 200, body: '' }));
  await page.goto('/?calm=1'); await page.locator('.calm-primary').click();
  const dock = page.locator('[data-calm-player]');
  await expect(dock).toHaveAttribute('data-status', 'playing');
  await expect(dock.locator('.calm-mini-info strong')).toHaveText('Tokyo FM');
  await expect(dock.locator('.calm-capture')).toHaveCount(0);
  await dock.getByRole('button', { name: 'Пауза', exact: true }).click();
  await expect(dock.locator('[data-live="true"]')).toHaveCount(0);
});

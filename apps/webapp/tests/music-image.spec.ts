import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

const readTransport = (page: Page) => page.evaluate(() => ({
  audio: document.querySelector('audio')?.getAttribute('src') ?? null,
  player: JSON.parse(localStorage.getItem('radio:player:v2') || '{}')
}));

test('music image is an explicit, local song subject; retries and questions send only framed text', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockStations(page);
  await installMediaMocks(page);
  await seedRadioState(page, { queue: [stations[0]], stationCache: stations });
  const imagePosts: Array<{ type: string | undefined; bytes: number }> = [];
  let capabilityReads = 0;
  await page.route('**/ai/music-image', async route => {
    if (route.request().method() === 'GET') {
      capabilityReads += 1;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ enabled: true, provider: 'gpt-6-luna' }) });
      return;
    }
    const body = route.request().postDataBuffer();
    imagePosts.push({ type: route.request().headers()['content-type'], bytes: body?.byteLength ?? 0 });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ candidates: [
      { artist: 'Image Artist', title: 'Image Song', uncertain: true },
      { artist: '', title: 'A title with no clear artist', uncertain: true }
    ] }) });
  });
  const chatPosts: Array<{ message: string }> = [];
  await page.route('**/ai/chat**', async route => {
    chatPosts.push(route.request().postDataJSON());
    if (chatPosts.length === 1) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'mock failure' }) });
      return;
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ reply: 'Mock Lira reply', stations: [], actions: [{ kind: 'none' }] }) });
  });
  await page.goto('/?calm=1');
  await page.getByRole('button', { name: 'Лира', exact: true }).click();
  const chat = page.locator('[data-chat-sheet]');
  await expect(chat.locator('[data-music-image-launch]')).toBeVisible();
  expect(capabilityReads).toBeGreaterThan(0);
  const before = await readTransport(page);
  await chat.locator('[data-music-image-launch]').click();
  const modal = page.locator('[data-music-image-dialog]');
  await modal.locator('input[type="file"]').setInputFiles({ name: 'private screenshot.png', mimeType: 'image/png', buffer: Buffer.from('mock image bytes') });
  await expect(modal.getByText('Изображение будет отправлено в GPT-6 Luna.', { exact: false })).toBeVisible();
  await expect(modal.locator('img')).toBeVisible();
  expect(imagePosts).toHaveLength(0);
  expect(chatPosts).toHaveLength(0);
  await expect(modal.getByRole('button', { name: 'Распознать', exact: true })).toBeEnabled();
  await modal.getByRole('button', { name: 'Распознать', exact: true }).click();
  await expect(modal.getByRole('button', { name: 'Image Song', exact: false })).toBeVisible();
  expect(imagePosts).toHaveLength(1);
  expect(imagePosts[0].type).toBe('image/png');
  expect(imagePosts[0].bytes).toBeGreaterThan(0);
  expect(await readTransport(page)).toEqual(before);

  await modal.getByRole('button', { name: /Image Song/ }).click();
  await expect(modal.getByLabel('Исполнитель')).toHaveValue('Image Artist');
  await expect(modal.getByLabel('Название песни')).toHaveValue('Image Song');
  await modal.getByRole('button', { name: 'Выбрать песню', exact: true }).click();
  await expect(chat.locator('[data-chat-music-image]')).toContainText('Image Artist — Image Song');
  const persistedBeforeUserText = await page.evaluate(() => Object.keys(localStorage).map(key => localStorage.getItem(key) || '').join('\n'));
  expect(persistedBeforeUserText).not.toContain('Image Artist');
  expect(chatPosts).toHaveLength(0);

  await chat.getByRole('textbox').fill('Проверь первое сообщение');
  await chat.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(chat.locator('.chat-retry-btn')).toBeVisible();
  const expected = 'О песне с картинки «Image Artist — Image Song»:\nПроверь первое сообщение';
  expect(chatPosts[0].message).toBe(expected);
  await chat.locator('.chat-retry-btn').click();
  await expect(chat.getByText('Mock Lira reply', { exact: true })).toBeVisible();
  expect(chatPosts[1].message).toBe(expected);

  await chat.locator('[data-music-image-question="similar"]').click();
  await expect(chat.getByText('Mock Lira reply', { exact: true })).toHaveCount(2);
  expect(chatPosts[2].message).toBe('О песне с картинки «Image Artist — Image Song»:\nПосоветуй три похожие песни');
  expect(await readTransport(page)).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('unsupported capability and invalid files stay local; English narrow view clips only visually', async ({ page }) => {
  await page.setViewportSize({ width: 834, height: 450 });
  await page.addInitScript(() => localStorage.setItem('radio:locale', JSON.stringify('en')));
  await mockStations(page);
  await page.route('**/ai/music-image', route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ enabled: false }) }));
  await page.route('**/ai/chat**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ reply: '', stations: [], actions: [{ kind: 'none' }] }) }));
  await page.goto('/?calm=1');
  await page.getByRole('button', { name: 'Lira', exact: true }).click();
  const chat = page.locator('[data-chat-sheet]');
  await expect(chat.locator('[data-music-image-launch]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('English song context keeps long titles bounded at tablet and desktop widths', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem('radio:locale', JSON.stringify('en')));
  await mockStations(page);
  const title = 'A very long song title that remains readable without being clipped from the recognized result';
  await page.route('**/ai/music-image', route => route.request().method() === 'GET'
    ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ enabled: true, provider: 'gpt-6-luna' }) })
    : route.fulfill({ contentType: 'application/json', body: JSON.stringify({ candidates: [{ artist: 'The Example Band', title, uncertain: false }] }) }));
  const posted: Array<{ message: string }> = [];
  await page.route('**/ai/chat**', route => {
    posted.push(route.request().postDataJSON());
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ reply: 'English reply', stations: [], actions: [{ kind: 'none' }] }) });
  });
  await page.goto('/?calm=1');
  await page.getByRole('button', { name: 'Lira', exact: true }).click();
  const chat = page.locator('[data-chat-sheet]');
  await chat.locator('[data-music-image-launch]').click();
  const modal = page.locator('[data-music-image-dialog]');
  await modal.locator('input[type="file"]').setInputFiles({ name: 'private.png', mimeType: 'image/png', buffer: Buffer.from('mock bytes') });
  await modal.getByRole('button', { name: 'Recognize', exact: true }).click();
  const candidate = modal.getByRole('button', { name: new RegExp(title) });
  await expect(candidate).toBeVisible();
  await candidate.click();
  await modal.getByRole('button', { name: 'Choose song', exact: true }).click();
  await expect(chat.locator('[data-chat-music-image] strong')).toHaveAttribute('title', `The Example Band — ${title}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await chat.getByRole('textbox').fill('What can you tell me?');
  await chat.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(chat.getByText('English reply', { exact: true })).toBeVisible();
  expect(posted[0].message).toBe(`About song from image “The Example Band — ${title}”:\nWhat can you tell me?`);
});

test('removing an image aborts pending work and a late result cannot replace a new image result', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockStations(page);
  let postCount = 0;
  let releaseFirst!: () => void;
  let firstPostSeen!: () => void;
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  const seenFirstPost = new Promise<void>(resolve => { firstPostSeen = resolve; });
  await page.route('**/ai/music-image', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ enabled: true, provider: 'gpt-6-luna' }) });
      return;
    }
    postCount += 1;
    if (postCount === 1) {
      firstPostSeen();
      await firstGate;
      try { await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ candidates: [{ artist: 'Old Artist', title: 'Old Track', uncertain: false }] }) }); } catch { /* The client aborted this request. */ }
      return;
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ candidates: [{ artist: 'New Artist', title: 'Fresh Track', uncertain: false }] }) });
  });
  await page.goto('/?calm=1');
  await page.getByRole('button', { name: 'Лира', exact: true }).click();
  const chat = page.locator('[data-chat-sheet]');
  await chat.locator('[data-music-image-launch]').click();
  const modal = page.locator('[data-music-image-dialog]');
  const input = modal.locator('input[type="file"]');
  await input.setInputFiles({ name: 'first.png', mimeType: 'image/png', buffer: Buffer.from('first') });
  await modal.getByRole('button', { name: 'Распознать', exact: true }).click();
  await seenFirstPost;
  await modal.getByRole('button', { name: 'Убрать изображение', exact: true }).click();
  await input.setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: Buffer.from('second') });
  await modal.getByRole('button', { name: 'Распознать', exact: true }).click();
  await expect(modal.getByRole('button', { name: /Fresh Track/ })).toBeVisible();
  releaseFirst();
  await expect(modal.getByRole('button', { name: /Old Track/ })).toHaveCount(0);
  expect(postCount).toBe(2);
});

test('invalid file selection makes no recognition or chat request', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockStations(page);
  let chatCalls = 0;
  let imagePosts = 0;
  await page.route('**/ai/music-image', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ enabled: true, provider: 'gpt-6-luna' }) });
      return;
    }
    imagePosts += 1;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ candidates: [] }) });
  });
  await page.route('**/ai/chat**', route => { chatCalls += 1; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ reply: '', stations: [], actions: [{ kind: 'none' }] }) }); });
  await page.goto('/?calm=1');
  await page.getByRole('button', { name: 'Лира', exact: true }).click();
  const chat = page.locator('[data-chat-sheet]');
  await chat.locator('[data-music-image-launch]').click();
  const modal = page.locator('[data-music-image-dialog]');
  await modal.locator('input[type="file"]').setInputFiles({ name: 'private.gif', mimeType: 'image/gif', buffer: Buffer.from('mock') });
  await expect(modal.getByRole('status')).toContainText('PNG, JPEG или WebP');
  expect(imagePosts).toBe(0);
  expect(chatCalls).toBe(0);
});

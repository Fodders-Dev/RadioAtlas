import { expect, test } from '@playwright/test';
import { installMediaMocks, installTelegramShim, mockStations, playHomeStation, seedRadioState, stations } from './helpers';

for (const { width, locale } of [
  { width: 390, locale: 'ru' },
  { width: 320, locale: 'ru' },
  { width: 320, locale: 'en' }
]) {
  test(`DeepSeek fallback warning fits a ${width}px ${locale} phone`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript((initialLocale) => localStorage.setItem('radio:locale', initialLocale), locale);
    await installMediaMocks(page);
    await installTelegramShim(page);
    await mockStations(page);
    await seedRadioState(page);
    await page.route('**/ai/chat', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        reply: 'GPT could not answer.', stations: [], serviceLinks: [], sources: [], actions: [],
        provider: { name: 'gpt-6-luna', fallback: false },
        providerFallback: { token: 'layout-ticket', reason: 'unavailable', provider: 'deepseek' }
      })
    }));

    await page.goto('/?api=http://127.0.0.1:4311');
    await page.locator('.mobile-nav-chat').click();
    const sheet = page.locator('[data-chat-sheet]');
    await sheet.locator('textarea').fill('Find radio');
    await sheet.getByRole('button', { name: /Отправить|Send/ }).click();
    const offer = sheet.getByRole('status').filter({ hasText: /GPT-6 Luna/ });
    await expect(offer).toBeVisible();
    await offer.evaluate(async (element) => {
      await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
    });

    const layout = await offer.evaluate((element) => {
      const notice = element.querySelector('span')!;
      const button = element.querySelector('button')!;
      const style = getComputedStyle(element);
      const noticeRect = notice.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      const containerRect = element.getBoundingClientRect();
      const availableWidth = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      return {
        availableWidth,
        noticeWidth: noticeRect.width,
        noticeScrollWidth: notice.scrollWidth,
        buttonHeight: buttonRect.height,
        buttonRight: buttonRect.right,
        contentRight: containerRect.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth
      };
    });
    expect(layout.noticeWidth, 'the warning text should use the available row width').toBeGreaterThanOrEqual(layout.availableWidth - 1);
    expect(layout.noticeScrollWidth, 'warning text must wrap inside its box').toBeLessThanOrEqual(layout.noticeWidth + 1);
    expect(layout.buttonHeight, 'the fallback action must keep its 44px touch target').toBeGreaterThanOrEqual(44);
    expect(layout.buttonRight, 'the fallback action must stay inside the warning card').toBeLessThanOrEqual(layout.contentRight + 1);
    expect(layout.documentWidth, 'the phone layout must not scroll horizontally').toBeLessThanOrEqual(layout.viewportWidth);
  });
}

test('Lira waits for explicit DeepSeek choice and retries the unchanged request once', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMediaMocks(page);
  await installTelegramShim(page);
  await mockStations(page);
  await seedRadioState(page);

  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/ai/chat', async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(payload);
    const body = requests.length === 1
      ? {
          reply: 'GPT could not answer.', stations: [], serviceLinks: [], sources: [], actions: [],
          provider: { name: 'gpt-6-luna', fallback: false },
          providerFallback: { token: 'ticket-1', reason: 'unavailable', provider: 'deepseek' }
        }
      : {
          reply: 'A calm station from Tokyo.', stations: [], serviceLinks: [], sources: [], actions: [],
          provider: { name: 'deepseek', fallback: true }
        };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.goto('/?api=http://127.0.0.1:4311');
  await page.locator('.mobile-nav-chat').click();
  const sheet = page.locator('[data-chat-sheet]');
  const question = 'Find a calm station from Tokyo';
  await sheet.locator('textarea').fill(question);
  await sheet.getByRole('button', { name: /Отправить|Send/ }).click();

  const offer = sheet.getByRole('status').filter({ hasText: /GPT-6 Luna|GPT-6 Luna/ });
  await expect(offer).toBeVisible();
  const fallbackAction = offer.getByRole('button', { name: /Продолжить через DeepSeek|Continue through DeepSeek/ });
  await offer.evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
  });
  const fallbackActionBox = await fallbackAction.boundingBox();
  expect(fallbackActionBox, 'the visible fallback action must have measurable bounds').not.toBeNull();
  expect(fallbackActionBox!.height, 'the fallback action must meet the 44px touch target').toBeGreaterThanOrEqual(44);
  await expect(sheet.getByText('GPT could not answer.')).toHaveCount(0);
  await expect(sheet.getByText(question, { exact: true })).toHaveCount(1);
  expect(requests).toHaveLength(1);
  expect(requests[0]).not.toHaveProperty('fallbackToken');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('radio:lira-thread:v1') || '[]')))
    .toEqual([expect.objectContaining({ role: 'user', text: question })]);
  const playerBefore = await page.evaluate(() => localStorage.getItem('radio:player:v2'));
  await expect.poll(() => page.evaluate(() => localStorage.getItem('radio:player:v2'))).toBe(playerBefore);

  await fallbackAction.click();
  await expect(sheet.getByText('A calm station from Tokyo.')).toBeVisible();
  await expect(sheet.getByText(question, { exact: true })).toHaveCount(1);
  expect(requests).toHaveLength(2);
  const { fallbackToken, ...retryWithoutTicket } = requests[1]!;
  expect(fallbackToken).toBe('ticket-1');
  expect(retryWithoutTicket).toEqual(requests[0]);
  await expect(sheet.getByText(/Ответ через DeepSeek|Answered through DeepSeek/)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('radio:player:v2'))).toBe(playerBefore);
  const storedThread = await page.evaluate(() => JSON.parse(localStorage.getItem('radio:lira-thread:v1') || '[]'));
  expect(storedThread).toHaveLength(2);
  expect(storedThread.some((message: { text: string }) => /GPT-6 Luna could not answer|GPT-6 Luna не смогла ответить/.test(message.text))).toBe(false);
});

test('clearing the chat while GPT is pending invalidates the late fallback offer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMediaMocks(page);
  await installTelegramShim(page);
  await mockStations(page);
  await seedRadioState(page);
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/ai/chat', async (route) => {
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    await firstGate;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        reply: 'GPT could not answer.', stations: [], serviceLinks: [], sources: [], actions: [],
        provider: { name: 'gpt-6-luna', fallback: false },
        providerFallback: { token: 'stale-ticket', reason: 'unavailable', provider: 'deepseek' }
      })
    });
  });

  await page.goto('/?api=http://127.0.0.1:4311');
  await page.locator('.app-navigation-mobile').getByRole('button', { name: 'Лира', exact: true }).click();
  const sheet = page.locator('[data-chat-sheet]');
  await sheet.locator('textarea').fill('Find ambient radio');
  await sheet.getByRole('button', { name: /Отправить|Send/ }).click();
  await expect.poll(() => requests.length).toBe(1);
  page.on('dialog', (dialog) => dialog.accept());
  await sheet.getByRole('button', { name: /Очистить чат|Clear chat/ }).click();
  releaseFirst();
  await expect(sheet.getByRole('status').filter({ hasText: /GPT-6 Luna/ })).toHaveCount(0);
  await expect(sheet.getByText('Find ambient radio', { exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('radio:lira-thread:v1'))).toBeNull();
  expect(requests).toHaveLength(1);
});

test('sending a new subject withdraws the old DeepSeek offer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMediaMocks(page);
  await installTelegramShim(page);
  await mockStations(page);
  await seedRadioState(page);

  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/ai/chat', async (route) => {
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    const body = requests.length === 1
      ? {
          reply: 'GPT could not answer.', stations: [], serviceLinks: [], sources: [], actions: [],
          provider: { name: 'gpt-6-luna', fallback: false },
          providerFallback: { token: 'old-subject-ticket', reason: 'unavailable', provider: 'deepseek' }
        }
      : {
          reply: 'The new subject stayed on GPT.', stations: [], serviceLinks: [], sources: [], actions: [],
          provider: { name: 'gpt-6-luna', fallback: false }
        };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.goto('/?api=http://127.0.0.1:4311');
  await page.locator('.mobile-nav-chat').click();
  const sheet = page.locator('[data-chat-sheet]');
  await sheet.locator('textarea').fill('Find ambient radio');
  await sheet.getByRole('button', { name: /Отправить|Send/ }).click();
  const offer = sheet.getByRole('status').filter({ hasText: /GPT-6 Luna/ });
  await expect(offer).toBeVisible();

  await sheet.locator('textarea').fill('Tell me about the new station');
  await sheet.getByRole('button', { name: /Отправить|Send/ }).click();
  await expect(offer).toHaveCount(0);
  await expect(sheet.getByText('The new subject stayed on GPT.')).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]).not.toHaveProperty('fallbackToken');
});

test('rapid consent clicks start one DeepSeek retry, which chat reset then discards', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMediaMocks(page);
  await installTelegramShim(page);
  await mockStations(page);
  await seedRadioState(page);

  let releaseRetry!: () => void;
  const retryGate = new Promise<void>((resolve) => { releaseRetry = resolve; });
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/ai/chat', async (route) => {
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    if (requests.length === 1) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reply: 'GPT could not answer.', stations: [], serviceLinks: [], sources: [], actions: [],
          provider: { name: 'gpt-6-luna', fallback: false },
          providerFallback: { token: 'pending-retry-ticket', reason: 'unavailable', provider: 'deepseek' }
        })
      });
      return;
    }
    await retryGate;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        reply: 'This late DeepSeek answer must be discarded.', stations: [], serviceLinks: [],
        sources: [], actions: [], provider: { name: 'deepseek', fallback: true }
      })
    });
  });

  await page.goto('/?api=http://127.0.0.1:4311');
  await page.locator('.mobile-nav-chat').click();
  const sheet = page.locator('[data-chat-sheet]');
  const question = 'Find ambient radio';
  await sheet.locator('textarea').fill(question);
  await sheet.getByRole('button', { name: /Отправить|Send/ }).click();
  const offer = sheet.getByRole('status').filter({ hasText: /GPT-6 Luna/ });
  await expect(offer).toBeVisible();
  const fallbackAction = offer.getByRole('button', { name: /Продолжить через DeepSeek|Continue through DeepSeek/ });
  const actionBox = await fallbackAction.boundingBox();
  expect(actionBox, 'the consent action must be measurable before the rapid clicks').not.toBeNull();
  await page.mouse.dblclick(actionBox!.x + actionBox!.width / 2, actionBox!.y + actionBox!.height / 2);
  await expect.poll(() => requests.length).toBe(2);

  page.on('dialog', (dialog) => dialog.accept());
  await sheet.getByRole('button', { name: /Очистить чат|Clear chat/ }).click();
  releaseRetry();

  await expect(sheet.getByText(question, { exact: true })).toHaveCount(0);
  await expect(sheet.getByText('This late DeepSeek answer must be discarded.')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('radio:lira-thread:v1'))).toBeNull();
  expect(requests).toHaveLength(2);
});

test('a delayed primary answer survives automatic listening-taste updates', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install();
  await installMediaMocks(page);
  await installTelegramShim(page);
  await mockStations(page);
  await seedRadioState(page, { queue: [stations[0]], queueCurrentIndex: 0, stationCache: [stations[0]] });

  let releaseChat!: () => void;
  const chatGate = new Promise<void>((resolve) => { releaseChat = resolve; });
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/ai/chat', async (route) => {
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    await chatGate;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        reply: 'The delayed GPT answer arrived.', stations: [], serviceLinks: [], sources: [],
        actions: [
          { actionId: 'delayed:pause', kind: 'pause', permission: 'write' },
          { actionId: 'delayed:favorite', kind: 'set-favorite', stationuuid: 'uuid-tokyo', desired: true, permission: 'write' }
        ],
        provider: { name: 'gpt-6-luna', fallback: false }
      })
    });
  });

  await page.goto('/?api=http://127.0.0.1:4311');
  await playHomeStation(page, 'Tokyo FM');
  await expect(page.locator('audio')).toHaveAttribute('data-ra-state', 'playing');
  await page.locator('.app-navigation-mobile').getByRole('button', { name: 'Лира', exact: true }).click();
  const sheet = page.locator('[data-chat-sheet]');
  await sheet.locator('textarea').fill('What is playing?');
  await sheet.getByRole('button', { name: /Отправить|Send/ }).click();
  await expect.poll(() => requests.length).toBe(1);

  await page.clock.fastForward(30_000);
  await expect.poll(() => page.evaluate(() => {
    const profile = JSON.parse(localStorage.getItem('radio:app:v2') || '{}').tasteProfile;
    return profile?.signals?.some((signal: { stationId: string }) => signal.stationId === 'uuid-tokyo') || false;
  })).toBe(true);
  releaseChat();
  await expect(sheet.getByText('The delayed GPT answer arrived.')).toBeVisible();
  await expect(page.locator('audio')).toHaveAttribute('data-ra-state', 'paused');
  await expect.poll(() => page.evaluate(() => {
    const library = JSON.parse(localStorage.getItem('radio:library:v2') || '{}');
    return library.favorites?.some((station: { stationuuid: string }) => station.stationuuid === 'uuid-tokyo') || false;
  })).toBe(true);
  expect(requests).toHaveLength(1);
});

test('a delayed DeepSeek answer survives automatic listening-taste updates after consent', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install();
  await installMediaMocks(page);
  await installTelegramShim(page);
  await mockStations(page);
  await seedRadioState(page, { queue: [stations[0]], queueCurrentIndex: 0, stationCache: [stations[0]] });

  let releaseFallback!: () => void;
  const fallbackGate = new Promise<void>((resolve) => { releaseFallback = resolve; });
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/ai/chat', async (route) => {
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    if (requests.length === 1) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reply: 'GPT could not answer.', stations: [], serviceLinks: [], sources: [], actions: [],
          provider: { name: 'gpt-6-luna', fallback: false },
          providerFallback: { token: 'delayed-fallback-ticket', reason: 'unavailable', provider: 'deepseek' }
        })
      });
      return;
    }
    await fallbackGate;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        reply: 'The delayed DeepSeek answer arrived.', stations: [], serviceLinks: [], sources: [],
        actions: [
          { actionId: 'fallback:pause', kind: 'pause', permission: 'write' },
          { actionId: 'fallback:favorite', kind: 'set-favorite', stationuuid: 'uuid-tokyo', desired: true, permission: 'write' }
        ],
        provider: { name: 'deepseek', fallback: true }
      })
    });
  });

  await page.goto('/?api=http://127.0.0.1:4311');
  await playHomeStation(page, 'Tokyo FM');
  await expect(page.locator('audio')).toHaveAttribute('data-ra-state', 'playing');
  await page.locator('.app-navigation-mobile').getByRole('button', { name: 'Лира', exact: true }).click();
  const sheet = page.locator('[data-chat-sheet]');
  await sheet.locator('textarea').fill('What is playing?');
  await sheet.getByRole('button', { name: /Отправить|Send/ }).click();
  const offer = sheet.getByRole('status').filter({ hasText: /GPT-6 Luna/ });
  await expect(offer).toBeVisible();

  // Automatic listening updates change the live taste snapshot, not the subject
  // of the question or the request captured for the explicit retry.
  await page.clock.fastForward(30_000);
  await expect.poll(() => page.evaluate(() => {
    const profile = JSON.parse(localStorage.getItem('radio:app:v2') || '{}').tasteProfile;
    return profile?.signals?.some((signal: { stationId: string }) => signal.stationId === 'uuid-tokyo') || false;
  })).toBe(true);
  await expect(offer).toBeVisible();

  const fallbackAction = offer.getByRole('button', { name: /Продолжить через DeepSeek|Continue through DeepSeek/ });
  await fallbackAction.click();
  await expect.poll(() => requests.length).toBe(2);
  const { fallbackToken, ...retryWithoutTicket } = requests[1]!;
  expect(fallbackToken).toBe('delayed-fallback-ticket');
  expect(retryWithoutTicket).toEqual(requests[0]);

  await page.clock.fastForward(30_000);
  await expect.poll(() => page.evaluate(() => {
    const profile = JSON.parse(localStorage.getItem('radio:app:v2') || '{}').tasteProfile;
    return profile?.signals?.some((signal: { stationId: string }) => signal.stationId === 'uuid-tokyo') || false;
  })).toBe(true);
  releaseFallback();
  await expect(sheet.getByText('The delayed DeepSeek answer arrived.')).toBeVisible();
  await expect(page.locator('audio')).toHaveAttribute('data-ra-state', 'paused');
  await expect.poll(() => page.evaluate(() => {
    const library = JSON.parse(localStorage.getItem('radio:library:v2') || '{}');
    return library.favorites?.some((station: { stationuuid: string }) => station.stationuuid === 'uuid-tokyo') || false;
  })).toBe(true);
  expect(requests).toHaveLength(2);
});

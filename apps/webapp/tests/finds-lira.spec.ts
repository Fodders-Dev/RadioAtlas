import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, openLibraryCategory, seedRadioState, stations } from './helpers';

const savedFinds = [
  { id: 'saved-numb', stationId: 'unavailable-source-1', stationName: 'Old Radio', track: 'Numb', timestamp: Date.now() - 60_000 },
  { id: 'saved-yellow', stationId: 'unavailable-source-2', stationName: 'Another Radio', track: 'Yellow', timestamp: Date.now() - 120_000 }
];

const openFinds = async (
  page: Page,
  width: number,
  finds = savedFinds,
  persistedThread: Array<{ id: number; role: 'user' | 'assistant'; text: string }> = []
) => {
  await page.setViewportSize({ width, height: width === 834 ? 1112 : width === 1440 ? 900 : 844 });
  await installMediaMocks(page);
  await mockStations(page);
  await seedRadioState(page, {
    activeSection: 'library', libraryTab: 'tracks', trackHistory: finds,
    queue: [stations[0]], queueCurrentIndex: 0, stationCache: [stations[0]]
  });
  await page.addInitScript((thread) => {
    if (thread.length) localStorage.setItem('radio:lira-thread:v1', JSON.stringify(thread));
    else localStorage.removeItem('radio:lira-thread:v1');
  }, persistedThread);
  await page.goto('/?api=/api&glass=full&calm=1');
  await openLibraryCategory(page, 'tracks');
  await expect(page.locator('[data-finds-search]')).toBeVisible({ timeout: 15_000 });
};

const startLivePlayer = async (page: Page, width: number) => {
  const nav = page.locator(width < 900 ? '.app-navigation-mobile' : '.app-navigation-desktop');
  await nav.getByRole('button', { name: 'Главная', exact: true }).click();
  await page.locator('[data-stage-play]').click();
  await expect(page.locator('[data-calm-player]')).toHaveAttribute('data-status', 'playing');
  await nav.getByRole('button', { name: 'Моё', exact: true }).click();
  await openLibraryCategory(page, 'tracks');
};

test('a saved find opens Lira without requests, explicitly frames only its first freeform turn, and can be cleared', async ({ page }) => {
  await openFinds(page, 390);
  await page.route('**/metadata?url=**', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ title: 'Get Lucky - Daft Punk' })
  }));
  await startLivePlayer(page, 390);
  await expect(page.locator('[data-calm-player]')).toContainText('Get Lucky');
  const transportBefore = await page.evaluate(() => ({
    src: document.querySelector('audio')?.getAttribute('src'),
    queue: JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue
  }));
  let chatCalls = 0;
  let sourceLookups = 0;
  const posted: Array<{ message: string; nowPlaying?: { stationUuid?: string; track?: string } }> = [];
  await page.route('**/catalog/stations/**', route => {
    sourceLookups += 1;
    return route.fulfill({ status: 404, body: '{}' });
  });
  await page.route('**/ai/chat**', route => {
    chatCalls += 1;
    posted.push(route.request().postDataJSON());
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ reply: 'Ответ Лиры', stations: [], actions: [{ kind: 'none' }] }) });
  });

  await page.locator('[data-find-more]').first().click();
  await expect(page.locator('[data-find-ask-lira]')).toBeVisible();
  await page.locator('[data-find-ask-lira]').click();
  const chat = page.locator('[data-chat-sheet]');
  await expect(chat).toBeVisible();
  await expect(chat.locator('[data-chat-saved-finding]')).toContainText('Numb');
  await expect(chat.locator('[data-chat-saved-finding]')).toContainText('Old Radio');
  await expect(chat.locator('[data-finding-question]')).toHaveCount(3);
  await expect(chat.locator('.chat-row--user')).toHaveCount(0);
  expect(chatCalls).toBe(0);
  expect(sourceLookups).toBe(0);

  await chat.getByRole('textbox').fill('Who recorded it?');
  await chat.getByRole('button', { name: 'Отправить', exact: true }).click();
  const framed = 'О сохранённой песне «Numb»:\nWho recorded it?';
  await expect(chat.locator('.chat-row--user').last()).toHaveText(framed);
  await expect.poll(() => chatCalls).toBe(1);
  expect(posted[0].message).toBe(framed);
  expect(posted[0].nowPlaying?.stationUuid).toBe(stations[0].stationuuid);
  expect(posted[0].nowPlaying?.track).toBe('Get Lucky - Daft Punk');

  await chat.getByRole('textbox').fill('What about the lyrics?');
  await chat.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(chat.locator('.chat-row--user').last()).toHaveText('What about the lyrics?');
  await expect.poll(() => chatCalls).toBe(2);
  expect(posted[1].message).toBe('What about the lyrics?');

  await page.getByRole('button', { name: 'Главная', exact: true }).click();
  await page.getByRole('button', { name: 'Моё', exact: true }).click();
  await openLibraryCategory(page, 'tracks');
  await page.locator('[data-find-more]').first().click();
  await page.locator('[data-find-ask-lira]').click();
  await expect(chat.locator('[data-chat-saved-finding]')).toContainText('Numb');
  await chat.locator('[data-finding-question="about"]').click();
  const reopenedSameFrame = 'О сохранённой песне «Numb»:\nРасскажи об этой песне';
  await expect(chat.locator('.chat-row--user').last()).toHaveText(reopenedSameFrame);
  await expect.poll(() => chatCalls).toBe(3);
  expect(posted[2].message).toBe(reopenedSameFrame);

  await page.getByRole('button', { name: 'Главная', exact: true }).click();
  await page.getByRole('button', { name: 'Моё', exact: true }).click();
  await openLibraryCategory(page, 'tracks');
  await page.locator('[data-find-more]').nth(1).click();
  await page.locator('[data-find-ask-lira]').click();
  await expect(chat.locator('[data-chat-saved-finding]')).toContainText('Yellow');
  await chat.getByRole('textbox').fill('Tell me more');
  await chat.getByRole('button', { name: 'Отправить', exact: true }).click();
  const secondFrame = 'О сохранённой песне «Yellow»:\nTell me more';
  await expect(chat.locator('.chat-row--user').last()).toHaveText(secondFrame);
  await expect.poll(() => chatCalls).toBe(4);
  expect(posted[3].message).toBe(secondFrame);

  await chat.locator('[data-chat-clear-finding]').click();
  await expect(chat.locator('[data-chat-saved-finding]')).toHaveCount(0);
  await chat.getByRole('textbox').fill('Tell me about the song');
  await chat.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(chat.locator('.chat-row--user').last()).toHaveText('Tell me about the song');
  await expect.poll(() => chatCalls).toBe(5);
  expect(posted[4].message).toBe('Tell me about the song');
  expect(sourceLookups).toBe(0);
  expect(await page.evaluate(() => ({
    src: document.querySelector('audio')?.getAttribute('src'),
    queue: JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue
  }))).toEqual(transportBefore);
});

for (const width of [320, 390, 834, 1440]) {
  test(`saved-finding choices stay visible and fit at ${width}px`, async ({ page }) => {
    await openFinds(page, width);
    await page.locator('[data-find-more]').first().click();
    await page.locator('[data-find-ask-lira]').click();
    const chat = page.locator('[data-chat-sheet]');
    await expect(chat.locator('[data-chat-finding-controls]')).toBeVisible();
    const geometry = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll<HTMLElement>('[data-finding-question]')];
      return {
        rightOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        buttons: buttons.map(button => {
          const box = button.getBoundingClientRect();
          return { width: box.width, height: box.height, right: box.right };
        })
      };
    });
    expect(geometry.rightOverflow).toBe(0);
    expect(geometry.buttons).toHaveLength(3);
    for (const button of geometry.buttons) {
      expect(button.width).toBeGreaterThanOrEqual(44);
      expect(button.height).toBeGreaterThanOrEqual(44);
      expect(button.right).toBeLessThanOrEqual(width + 1);
    }
  });
}

test('untrusted saved titles show clarification and disabled choices', async ({ page }) => {
  const invalidFind = [{ ...savedFinds[0], track: 'LIVE RADIO' }];
  await page.setViewportSize({ width: 390, height: 844 });
  await installMediaMocks(page);
  await mockStations(page);
  await seedRadioState(page, {
    activeSection: 'library', libraryTab: 'tracks', trackHistory: invalidFind,
    queue: [stations[0]], queueCurrentIndex: 0, stationCache: [stations[0]]
  });
  await page.addInitScript(() => localStorage.removeItem('radio:lira-thread:v1'));
  await page.addInitScript(() => localStorage.setItem('radio:lira-thread:v1', JSON.stringify([
    { id: 10, role: 'user', text: 'Расскажи про Radiohead — Creep' },
    { id: 11, role: 'assistant', text: 'История старой беседы о Creep.' }
  ])));
  await page.goto('/?api=/api&glass=full&calm=1');
  await openLibraryCategory(page, 'tracks');
  await expect(page.locator('[data-finds-search]')).toBeVisible({ timeout: 15_000 });
  await page.route('**/metadata?url=**', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ title: 'Get Lucky - Daft Punk' })
  }));
  await startLivePlayer(page, 390);
  await expect(page.locator('[data-calm-player]')).toContainText('Get Lucky');
  let sent: { message: string; nowPlaying?: { track?: string } } | undefined;
  await page.route('**/ai/chat**', route => {
    sent = route.request().postDataJSON();
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ reply: 'Какой исполнитель или название указать?', stations: [], actions: [{ kind: 'none' }] }) });
  });
  await page.locator('[data-find-more]').click();
  await page.locator('[data-find-ask-lira]').click();
  const chat = page.locator('[data-chat-sheet]');
  await expect(chat.getByText('Название не удалось распознать как песню. Уточни его в сообщении.')).toBeVisible();
  for (const button of await chat.locator('[data-finding-question]').all()) await expect(button).toBeDisabled();
  await chat.getByRole('textbox').fill('Кто исполняет эту песню?');
  await chat.getByRole('button', { name: 'Отправить', exact: true }).click();
  const framed = 'О сохранённой песне «Unknown»:\nКто исполняет эту песню?';
  await expect(chat.locator('.chat-row--user').last()).toHaveText(framed);
  await expect.poll(() => sent?.message).toBe(framed);
  expect(sent?.nowPlaying?.track).toBe('Get Lucky - Daft Punk');
});

test('keyboard entry focuses a visible saved-finding choice without touch autofocus', async ({ page }) => {
  await openFinds(page, 390);
  const more = page.locator('[data-find-more]').first();
  await more.focus();
  await more.press('Enter');
  const ask = page.locator('[data-find-ask-lira]');
  await expect(ask).toBeVisible();
  await ask.focus();
  await ask.press('Enter');
  const chat = page.locator('[data-chat-sheet]');
  await expect(chat.locator('[data-finding-question="about"]')).toBeFocused();
  await expect(chat.getByRole('textbox')).not.toBeFocused();
});

test('retry sends the captured saved-song frame once and does not nest it', async ({ page }) => {
  await openFinds(page, 390);
  const posted: Array<{ message: string; history: Array<{ role: string; text: string }> }> = [];
  let calls = 0;
  await page.route('**/ai/chat**', route => {
    calls += 1;
    posted.push(route.request().postDataJSON());
    if (calls === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ reply: 'Ответ после повтора', stations: [], actions: [{ kind: 'none' }] }) });
  });
  await page.locator('[data-find-more]').first().click();
  await page.locator('[data-find-ask-lira]').click();
  const chat = page.locator('[data-chat-sheet]');
  await chat.getByRole('textbox').fill('Tell me about it');
  await chat.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(chat.locator('.chat-retry-btn')).toBeVisible();
  const framed = 'О сохранённой песне «Numb»:\nTell me about it';
  await chat.locator('.chat-retry-btn').click();
  await expect(chat.getByText('Ответ после повтора', { exact: true })).toBeVisible();
  expect(calls).toBe(2);
  expect(posted.map(request => request.message)).toEqual([framed, framed]);
  expect(posted[1].history).toEqual([]);
});

test('an older in-flight answer cannot consume a newly opened finding subject', async ({ page }) => {
  await openFinds(page, 390);
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  let calls = 0;
  let firstSettled = false;
  const posted: Array<{ message: string }> = [];
  await page.route('**/ai/chat**', async route => {
    calls += 1;
    posted.push(route.request().postDataJSON());
    if (calls === 1) {
      await firstGate;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ reply: 'Старый ответ', stations: [], actions: [{ kind: 'none' }] }) });
      firstSettled = true;
      return;
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ reply: 'Ответ о Yellow', stations: [], actions: [{ kind: 'none' }] }) });
  });

  await page.locator('[data-find-more]').first().click();
  await page.locator('[data-find-ask-lira]').click();
  let chat = page.locator('[data-chat-sheet]');
  await chat.getByRole('textbox').fill('What about the singer?');
  await chat.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect.poll(() => calls).toBe(1);

  await page.getByRole('button', { name: 'Главная', exact: true }).click();
  await page.getByRole('button', { name: 'Моё', exact: true }).click();
  await openLibraryCategory(page, 'tracks');
  await page.locator('[data-find-more]').nth(1).click();
  await page.locator('[data-find-ask-lira]').click();
  chat = page.locator('[data-chat-sheet]');
  await expect(chat.locator('[data-chat-saved-finding]')).toContainText('Yellow');

  releaseFirst();
  await expect.poll(() => firstSettled).toBe(true);
  await chat.getByRole('textbox').fill('Who recorded it?');
  await chat.getByRole('button', { name: 'Отправить', exact: true }).click();
  const secondFrame = 'О сохранённой песне «Yellow»:\nWho recorded it?';
  await expect(chat.locator('.chat-row--user').last()).toHaveText(secondFrame);
  await expect.poll(() => calls).toBe(2);
  expect(posted[1].message).toBe(secondFrame);
});

test('long song context stays readable above its choices on a short phone', async ({ page }) => {
  const longTitle = 'The Cinematic Orchestra feat. Patrick Watson - To Build a Home (Live at Union Chapel)';
  await openFinds(page, 390, [{ ...savedFinds[0], track: longTitle }], [
    { id: 10, role: 'user', text: 'Tell me about Creep.' },
    { id: 11, role: 'assistant', text: 'A previous answer that should remain in the visible conversation area.' }
  ]);
  await page.locator('[data-find-more]').first().click();
  await page.locator('[data-find-ask-lira]').click();
  const chat = page.locator('[data-chat-sheet]');
  const title = chat.locator('[data-chat-saved-finding] strong');
  await expect(title).toHaveText(longTitle);
  const lineLimit = await title.evaluate(node => getComputedStyle(node).webkitLineClamp);
  expect(lineLimit).toBe('2');

  await page.setViewportSize({ width: 390, height: 450 });
  await page.evaluate(() => document.documentElement.style.setProperty('--tg-viewport-height', '450px'));
  const geometry = await page.evaluate(() => {
    const bounds = (selector: string) => {
      const node = document.querySelector<HTMLElement>(selector);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height };
    };
    return {
      context: bounds('[data-chat-saved-finding]'),
      choices: bounds('[data-chat-finding-controls]'),
      thread: bounds('.chat-sheet-thread'),
      composer: bounds('.chat-sheet-input'),
      composerGlass: bounds('.chat-composer-glass'),
      nav: bounds('.app-navigation-mobile'),
      player: bounds('[data-calm-player]'),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  });
  expect(geometry.context).not.toBeNull();
  expect(geometry.choices).not.toBeNull();
  expect(geometry.thread).not.toBeNull();
  expect(geometry.composerGlass).not.toBeNull();
  expect(geometry.player).not.toBeNull();
  expect(geometry.nav).not.toBeNull();
  expect(geometry.context!.bottom).toBeLessThanOrEqual(geometry.choices!.top + 1);
  expect(geometry.thread!.bottom).toBeLessThanOrEqual(geometry.context!.top + 1);
  expect(geometry.thread!.height).toBeGreaterThanOrEqual(40);
  expect(geometry.choices!.bottom).toBeLessThanOrEqual(geometry.composerGlass!.top + 1);
  expect(geometry.composerGlass!.bottom).toBeLessThanOrEqual(geometry.player!.top - 8);
  expect(geometry.player!.bottom).toBeLessThanOrEqual(geometry.nav!.top);
  expect(geometry.overflow).toBe(0);
});

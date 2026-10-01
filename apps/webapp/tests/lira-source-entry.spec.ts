import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

const transport = (page: Page) => page.evaluate(() => {
  const audio = document.querySelector('audio');
  const stored = JSON.parse(localStorage.getItem('radio:player:v2') || '{}');
  return { src: audio?.getAttribute('src') || null, paused: audio?.paused ?? true, queue: stored.queue };
});

for (const size of [{ width: 390, height: 844 }, { width: 834, height: 1112 }, { width: 1440, height: 900 }]) {
  test(`Home source opens Lira without sending, preserves another source and transport at ${size.width}`, async ({ page }) => {
    await page.setViewportSize(size);
    const selected = { ...stations[1], name: 'Osaka Nights — очень длинное название выбранного источника для проверки узкого экрана' };
    await mockStations(page, { catalogPool: [stations[0], selected, ...stations.slice(2, 8)] });
    await installMediaMocks(page);
    await seedRadioState(page, { queue: [stations[0], stations[1]], stationCache: stations.slice(0, 2) });
    // A source must remain clear even above an already saved conversation.
    await page.addInitScript(() => localStorage.setItem('radio:lira-thread:v1', JSON.stringify([
      { id: 1, role: 'user', text: 'Предыдущая беседа' },
      { id: 2, role: 'assistant', text: 'Сохранённый ответ' }
    ])));
    const posted: Array<{ message: string; nowPlaying?: { stationUuid?: string; track?: string }; agentContext?: { queueStationIds?: string[] } }> = [];
    await page.route('**/ai/chat**', async route => {
      posted.push(route.request().postDataJSON());
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ reply: 'Подбор по выбранному источнику', stations: [], actions: [{ kind: 'none' }] }) });
    });
    await page.goto('/?calm=1');
    await expect(page.locator(`[data-calm-live-station="${selected.stationuuid}"]`)).toBeVisible();
    const homeQueue = await page.locator('[data-calm-live-station]').evaluateAll(rows => rows.map(row => row.getAttribute('data-calm-live-station')));
    await page.locator(`[data-calm-live-station="${stations[0].stationuuid}"] .calm-live-open`).click();
    await expect(page.locator('[data-calm-player]')).toHaveAttribute('data-status', 'playing');
    // Prove metadata is present before checking that this source's track never
    // leaks into a question about the OTHER source, rather than winning a race.
    await expect(page.locator('[data-calm-player] strong')).toHaveText('Mock Song');
    if (size.width === 834) {
      await page.locator(`[data-calm-live-station="${stations[0].stationuuid}"] .calm-live-open`).click();
      await expect(page.locator('[data-calm-player]')).toHaveAttribute('data-status', 'paused');
    }
    // Persistence deliberately batches writes; wait for the Home play's new
    // queue before taking the baseline rather than comparing the seed on disk.
    await expect.poll(async () => (await transport(page)).queue.items.map((item: { stationuuid: string }) => item.stationuuid)).toEqual(homeQueue);
    const before = await transport(page);
    await page.locator(`[data-calm-live-station="${selected.stationuuid}"] .calm-live-info`).click();
    await page.locator('.calm-sheet-row').filter({ hasText: 'Спросить Лиру' }).click();
    const chat = page.locator('[data-chat-sheet]');
    const context = chat.locator('[data-chat-context-source]');
    await expect(context).toHaveAttribute('data-chat-context-source', selected.stationuuid);
    await expect(context).toContainText(selected.name);
    await expect(chat.getByRole('textbox')).toHaveValue('');
    await expect(chat.locator('.chat-row--user')).toHaveCount(1);
    expect(posted).toHaveLength(0);
    expect(await transport(page)).toEqual(before);

    // This explicit chip is the first network call. The OTHER playing source
    // and its track must never become facts about the source we selected.
    await chat.locator('[data-chat-prompts]').getByRole('button', { name: 'Похожее за границей', exact: true }).click();
    await expect(chat.locator('.chat-row--assistant').last()).toContainText('Подбор по выбранному источнику');
    expect(posted).toHaveLength(1);
    expect(posted[0].message).toBe('Найди похожее из другой страны, не включай');
    expect(posted[0].nowPlaying?.stationUuid).toBe(selected.stationuuid);
    expect(posted[0].nowPlaying?.track).toBeUndefined();
    expect(await transport(page)).toEqual(before);
    expect(posted[0].agentContext?.queueStationIds).toEqual(before.queue.items.map((item: { stationuuid: string }) => item.stationuuid).slice(0, 80));

    const clear = chat.getByRole('button', { name: 'Очистить чат', exact: true });
    await expect(clear).toBeVisible();
    const bounds = await clear.evaluate(button => {
      const box = button.getBoundingClientRect(), icon = button.querySelector('svg')!.getBoundingClientRect();
      return { width: box.width, height: box.height, iconInside: icon.left >= box.left && icon.right <= box.right && icon.top >= box.top && icon.bottom <= box.bottom };
    });
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.iconInside).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // Enter on the actual button keeps destructive confirmation available;
    // cancel preserves the conversation, UUID, source and transport.
    page.once('dialog', dialog => dialog.dismiss());
    await clear.focus();
    await clear.press('Enter');
    await expect(chat.locator('.chat-row--user')).toHaveCount(2);
    expect(await transport(page)).toEqual(before);

    const nav = page.locator(size.width < 900 ? '.app-navigation-mobile' : '.app-navigation-desktop');
    await nav.getByRole('button', { name: 'Главная', exact: true }).click();
    await expect(chat).toHaveCount(0);
    expect(await transport(page)).toEqual(before);
    await page.locator(`[data-calm-live-station="${stations[0].stationuuid}"] .calm-live-info`).click();
    await page.locator('.calm-sheet-row').filter({ hasText: 'Спросить Лиру' }).click();
    await expect(chat.locator('[data-chat-context-source]')).toHaveAttribute('data-chat-context-source', stations[0].stationuuid);
    expect(posted).toHaveLength(1);
    expect(await transport(page)).toEqual(before);
  });
}

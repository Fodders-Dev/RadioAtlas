import { expect, test } from '@playwright/test';
import {
  installMediaMocks,
  installTelegramShim,
  mockStations,
  seedRadioState,
  stations
} from './helpers';

type ChatRequest = {
  message?: string;
  agentContext?: { isPlaying?: boolean; queueStationIds?: string[] };
  actionReceipts?: Array<{ actionId?: string; kind?: string; status?: string }>;
};

const actionFor = (message: string) => {
  if (/очеред/i.test(message)) {
    return {
      reply: 'Добавила Osaka Nights в очередь.',
      action: { actionId: 'eval:enqueue', kind: 'enqueue', stationuuid: 'uuid-osaka', permission: 'write' }
    };
  }
  if (/избран/i.test(message)) {
    return {
      reply: 'Добавила Osaka Nights в избранное.',
      action: {
        actionId: 'eval:favorite',
        kind: 'set-favorite',
        stationuuid: 'uuid-osaka',
        desired: true,
        permission: 'write'
      }
    };
  }
  if (/включи/i.test(message)) {
    return {
      reply: 'Включаю Osaka Nights.',
      action: { actionId: 'eval:play', kind: 'play', stationuuid: 'uuid-osaka', permission: 'write' }
    };
  }
  return {
    reply: 'Поставила на паузу.',
    action: { actionId: 'eval:pause', kind: 'pause', permission: 'write' }
  };
};

test('Lira executes queue, favorite, play and pause actions and reports receipts', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMediaMocks(page);
  await installTelegramShim(page);
  await mockStations(page);
  await seedRadioState(page, { queue: [stations[0]], stationCache: [stations[1]] });

  // The common catalog fixture intentionally returns Tokyo for every id. This
  // action smoke needs the real requested row so grounding is tested end-to-end.
  await page.route('**/catalog/stations/**', async (route) => {
    const id = decodeURIComponent(route.request().url().split('/').pop() || '');
    const item = stations.find((station) => station.stationuuid === id) || null;
    await route.fulfill({
      status: item ? 200 : 404,
      contentType: 'application/json',
      body: JSON.stringify(item ? { item } : { error: 'not found' })
    });
  });

  const requests: ChatRequest[] = [];
  await page.route('**/ai/chat', async (route) => {
    const request = route.request().postDataJSON() as ChatRequest;
    requests.push(request);
    const selected = actionFor(request.message || '');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        reply: selected.reply,
        stations: [],
        serviceLinks: [],
        sources: [],
        actions: [selected.action],
        run: { runId: `run:${requests.length}`, status: 'completed', route: 'direct_action' }
      })
    });
  });

  await page.goto('/?api=http://127.0.0.1:4311');
  await page.locator('.mobile-nav-chat').click();
  const sheet = page.locator('[data-chat-sheet]');
  const textarea = sheet.locator('textarea');
  const send = async (message: string, reply: string) => {
    await textarea.fill(message);
    await sheet.getByRole('button', { name: /Отправить|Send/ }).click();
    await expect(sheet.getByText(reply)).toBeVisible();
  };

  await send('Добавь Osaka Nights в очередь', 'Добавила Osaka Nights в очередь.');
  await expect(sheet.getByText('Добавлено в очередь')).toBeVisible();
  await expect.poll(() =>
    page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('radio:player:v2') || '{}');
      return state.queue?.items?.map((item: { stationuuid: string }) => item.stationuuid) || [];
    })
  ).toContain('uuid-osaka');

  await send('Добавь Osaka Nights в избранное', 'Добавила Osaka Nights в избранное.');
  await expect(sheet.getByText('Избранное обновлено')).toBeVisible();
  await expect.poll(() =>
    page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('radio:library:v2') || '{}');
      return state.favorites?.map((item: { stationuuid: string }) => item.stationuuid) || [];
    })
  ).toContain('uuid-osaka');

  await send('Включи Osaka Nights', 'Включаю Osaka Nights.');
  await expect(sheet.getByText('Станция включена')).toBeVisible();
  await expect(page.locator('audio')).toHaveAttribute('data-ra-state', 'playing');

  await send('Поставь на паузу', 'Поставила на паузу.');
  await expect(sheet.getByText('Поставлено на паузу')).toBeVisible();
  await expect(page.locator('audio')).toHaveAttribute('data-ra-state', 'paused');

  expect(requests).toHaveLength(4);
  expect(requests[1]?.actionReceipts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ actionId: 'eval:enqueue', kind: 'enqueue', status: 'executed' })
    ])
  );
  expect(requests[3]?.agentContext?.isPlaying).toBe(true);
  expect(requests[3]?.actionReceipts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ actionId: 'eval:play', kind: 'play', status: 'executed' })
    ])
  );
});

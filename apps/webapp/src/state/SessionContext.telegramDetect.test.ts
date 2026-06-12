// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { readTelegramRuntimeState } from './SessionContext';

// HOTFIX-2 regression guard: index.html loads telegram-web-app.js
// unconditionally (T1.1), so window.Telegram.WebApp exists in EVERY browser.
// SDK presence must NOT flip telegramMiniApp — only signals Telegram itself
// injects count: a non-empty initData or the tgWebApp* launch params. The old
// `Boolean(webApp)` check made plain Safari identify as a Mini App, which
// hid the login widget (the #80 redirect flow became unreachable) and sent
// the bot chip into the "initData is not ready" error path.

type TelegramShape = NonNullable<Window['Telegram']>;

const installTelegram = (webApp: Record<string, unknown> | null) => {
  Object.defineProperty(window, 'Telegram', {
    configurable: true,
    value: webApp ? ({ WebApp: webApp } as TelegramShape) : undefined
  });
};

const setUrl = (search: string, hash = '') => {
  window.history.replaceState(null, '', `/${search}${hash}`);
};

afterEach(() => {
  installTelegram(null);
  setUrl('');
});

describe('readTelegramRuntimeState', () => {
  it('SDK loaded but idle (plain browser) → NOT a Mini App', () => {
    // Exactly what the CDN script produces in Safari/Chrome outside Telegram.
    installTelegram({ initData: '', initDataUnsafe: {}, platform: 'unknown' });
    setUrl('');
    const state = readTelegramRuntimeState();
    expect(state.available).toBe(false);
    expect(state.initData).toBe('');
    expect(state.hasUser).toBe(false);
  });

  it('SDK with populated initData (inside Telegram client) → Mini App', () => {
    installTelegram({
      initData: 'query_id=AA&user=%7B%22id%22%3A42%7D&hash=abc',
      initDataUnsafe: { user: { id: 42 } }
    });
    setUrl('');
    const state = readTelegramRuntimeState();
    expect(state.available).toBe(true);
    expect(state.initData).toContain('query_id=AA');
    expect(state.hasUser).toBe(true);
  });

  it('tgWebAppPlatform launch param (fresh tab before SDK fills) → Mini App', () => {
    installTelegram(null);
    setUrl('?tgWebAppPlatform=ios');
    expect(readTelegramRuntimeState().available).toBe(true);
  });

  it('tgWebAppData in the hash → Mini App with initData', () => {
    installTelegram(null);
    setUrl('', '#tgWebAppData=query_id%3DBB');
    const state = readTelegramRuntimeState();
    expect(state.available).toBe(true);
    expect(state.initData).toBe('query_id=BB');
  });

  it('startapp param → Mini App', () => {
    installTelegram(null);
    setUrl('?startapp=radio');
    expect(readTelegramRuntimeState().available).toBe(true);
  });

  it('clean browser, no SDK, clean URL → NOT a Mini App', () => {
    installTelegram(null);
    setUrl('');
    expect(readTelegramRuntimeState().available).toBe(false);
  });
});

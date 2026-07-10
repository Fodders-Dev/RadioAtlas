import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildTelegramShareUrl,
  canShareToStory,
  getStartParam,
  getTelegramThemeParams,
  getTelegramWebApp,
  isInsideTelegramClient,
  isVersionAtLeast,
  makeDeepLink,
  makeRecordDeepLink,
  openLinkOrFallback,
  openTelegramLinkOrFallback,
  shareStationLink,
  shareStationToStory,
  subscribeTelegramThemeChange,
  triggerHaptic,
  triggerSelectionHaptic,
  type TelegramWebApp
} from './telegram';

type TelegramShape = NonNullable<Window['Telegram']>;

const restoreTelegram = () => {
  Object.defineProperty(window, 'Telegram', {
    configurable: true,
    value: undefined
  });
};

const installTelegram = (webApp: Partial<TelegramWebApp> | null) => {
  const value: TelegramShape | undefined = webApp ? { WebApp: webApp as TelegramWebApp } : undefined;
  Object.defineProperty(window, 'Telegram', {
    configurable: true,
    value
  });
};

afterEach(() => {
  restoreTelegram();
});

describe('getTelegramWebApp', () => {
  it('returns null when window.Telegram is undefined', () => {
    restoreTelegram();
    expect(getTelegramWebApp()).toBe(null);
  });

  it('returns null when window.Telegram exists but WebApp is missing', () => {
    Object.defineProperty(window, 'Telegram', {
      configurable: true,
      value: {}
    });
    expect(getTelegramWebApp()).toBe(null);
  });

  it('returns the WebApp object when present', () => {
    installTelegram({ platform: 'ios', version: '8.0' });
    const tg = getTelegramWebApp();
    expect(tg).not.toBe(null);
    expect(tg?.platform).toBe('ios');
  });
});

describe('isInsideTelegramClient', () => {
  it('is false when Telegram is undefined', () => {
    restoreTelegram();
    expect(isInsideTelegramClient()).toBe(false);
  });

  it('is false when the SDK is loaded but initData is empty (standalone web)', () => {
    installTelegram({ platform: 'unknown', initData: '' });
    expect(isInsideTelegramClient()).toBe(false);
  });

  it('is true only when initData is a non-empty signed payload', () => {
    installTelegram({
      platform: 'ios',
      initData: 'auth_date=1746000000&hash=deadbeef'
    });
    expect(isInsideTelegramClient()).toBe(true);
  });
});

describe('openLinkOrFallback', () => {
  it('uses SDK openLink when available', () => {
    let captured: string | null = null;
    installTelegram({
      openLink: (url) => {
        captured = url;
      }
    });
    openLinkOrFallback('https://example.com/radio');
    expect(captured).toBe('https://example.com/radio');
  });

  it('falls back to window.open when SDK is not loaded', () => {
    restoreTelegram();
    const originalOpen = window.open;
    let captured: string | null = null;
    window.open = ((url: string) => {
      captured = url;
      return null;
    }) as typeof window.open;
    try {
      openLinkOrFallback('https://example.com/fallback');
      expect(captured).toBe('https://example.com/fallback');
    } finally {
      window.open = originalOpen;
    }
  });
});

describe('openTelegramLinkOrFallback', () => {
  it('prefers openTelegramLink when available', () => {
    let viaTelegramLink: string | null = null;
    let viaOpenLink: string | null = null;
    installTelegram({
      openTelegramLink: (url) => {
        viaTelegramLink = url;
      },
      openLink: (url) => {
        viaOpenLink = url;
      }
    });
    openTelegramLinkOrFallback('https://t.me/foo');
    expect(viaTelegramLink).toBe('https://t.me/foo');
    expect(viaOpenLink).toBe(null);
  });

  it('falls back to openLink when openTelegramLink is missing', () => {
    let captured: string | null = null;
    installTelegram({
      openLink: (url) => {
        captured = url;
      }
    });
    openTelegramLinkOrFallback('https://t.me/foo');
    expect(captured).toBe('https://t.me/foo');
  });
});

describe('triggerHaptic', () => {
  it('is silent when window.Telegram is undefined', () => {
    restoreTelegram();
    expect(() => triggerHaptic()).not.toThrow();
  });

  it('does NOT fire impactOccurred when SDK loaded but initData is empty (standalone web)', () => {
    let impactCalls = 0;
    installTelegram({
      platform: 'unknown',
      initData: '',
      HapticFeedback: {
        impactOccurred: () => {
          impactCalls += 1;
        }
      }
    });
    triggerHaptic('light');
    expect(impactCalls).toBe(0);
  });

  it('calls HapticFeedback.impactOccurred with the requested style when inside Telegram', () => {
    const styles: string[] = [];
    installTelegram({
      platform: 'ios',
      initData: 'auth_date=1746000000&hash=deadbeef',
      HapticFeedback: {
        impactOccurred: (style) => {
          styles.push(style);
        }
      }
    });
    triggerHaptic();
    triggerHaptic('medium');
    expect(styles).toEqual(['light', 'medium']);
  });
});

describe('triggerSelectionHaptic', () => {
  it('is silent when window.Telegram is undefined', () => {
    restoreTelegram();
    expect(() => triggerSelectionHaptic()).not.toThrow();
  });

  it('does NOT fire selectionChanged when SDK loaded but initData is empty (standalone web)', () => {
    let calls = 0;
    installTelegram({
      platform: 'unknown',
      initData: '',
      HapticFeedback: {
        selectionChanged: () => {
          calls += 1;
        }
      }
    });
    triggerSelectionHaptic();
    expect(calls).toBe(0);
  });

  it('calls HapticFeedback.selectionChanged when inside Telegram', () => {
    let calls = 0;
    installTelegram({
      platform: 'ios',
      initData: 'auth_date=1746000000&hash=deadbeef',
      HapticFeedback: {
        selectionChanged: () => {
          calls += 1;
        }
      }
    });
    triggerSelectionHaptic();
    expect(calls).toBe(1);
  });
});

describe('getTelegramThemeParams', () => {
  it('returns null on standalone web (no SDK)', () => {
    restoreTelegram();
    expect(getTelegramThemeParams()).toBe(null);
  });

  it('returns null when SDK loaded but initData is empty (standalone web)', () => {
    installTelegram({
      platform: 'unknown',
      initData: '',
      themeParams: { bg_color: '#ffffff' }
    });
    // Strict gate: even with themeParams populated, an empty initData
    // means we're on the canonical web build where the SDK was loaded
    // by the synchronous CDN script but not by the Telegram client.
    // Reading colours from there would leak them into standalone web.
    expect(getTelegramThemeParams()).toBe(null);
  });

  it('returns the params object when inside Telegram client', () => {
    installTelegram({
      platform: 'ios',
      initData: 'auth_date=1746000000&hash=deadbeef',
      themeParams: {
        bg_color: '#1a1a1a',
        accent_text_color: '#abcdef'
      }
    });
    const params = getTelegramThemeParams();
    expect(params).toEqual({
      bg_color: '#1a1a1a',
      accent_text_color: '#abcdef'
    });
  });

  it('returns a fresh clone each call so React state diffing works', () => {
    installTelegram({
      platform: 'ios',
      initData: 'auth_date=1&hash=abc',
      themeParams: { bg_color: '#111111' }
    });
    const first = getTelegramThemeParams();
    const second = getTelegramThemeParams();
    expect(first).toEqual(second);
    // The SDK mutates the same themeParams object in place between
    // themeChanged events. Without cloning, React's state setter
    // would bail on Object.is and the tokens would never refresh.
    expect(first).not.toBe(second);
  });

  it('returns null when themeParams is missing on the SDK (older Bot API)', () => {
    installTelegram({
      platform: 'ios',
      initData: 'auth_date=1&hash=abc'
      // no themeParams field
    });
    expect(getTelegramThemeParams()).toBe(null);
  });

  it('returns the empty object as-is when SDK reports zero keys', () => {
    installTelegram({
      platform: 'ios',
      initData: 'auth_date=1&hash=abc',
      themeParams: {}
    });
    // Empty `{}` is preserved (not collapsed to null). The synthesis
    // floor in lib/theme/telegramAuto.ts filters empty objects;
    // distinguishing "we know it's empty" vs. "we cannot tell" stays
    // available to other callers.
    expect(getTelegramThemeParams()).toEqual({});
  });
});

describe('subscribeTelegramThemeChange', () => {
  it('returns a no-op cleanup when SDK is not loaded', () => {
    restoreTelegram();
    const cleanup = subscribeTelegramThemeChange(() => {});
    expect(() => cleanup()).not.toThrow();
  });

  it('registers and unregisters via onEvent / offEvent', () => {
    const onCalls: Array<{ event: string; cb: () => void }> = [];
    const offCalls: Array<{ event: string; cb: () => void }> = [];
    installTelegram({
      platform: 'ios',
      initData: 'auth_date=1&hash=abc',
      onEvent: (event, cb) => {
        onCalls.push({ event, cb });
      },
      offEvent: (event, cb) => {
        offCalls.push({ event, cb });
      }
    });
    const cb = () => {};
    const cleanup = subscribeTelegramThemeChange(cb);
    expect(onCalls).toEqual([{ event: 'themeChanged', cb }]);
    cleanup();
    expect(offCalls).toEqual([{ event: 'themeChanged', cb }]);
  });
});

describe('getStartParam', () => {
  it('reads from initDataUnsafe.start_param when inside Telegram', () => {
    installTelegram({
      initData: 'auth_date=1&hash=abc',
      initDataUnsafe: { start_param: 'station_abc' }
    });
    expect(getStartParam()).toBe('station_abc');
  });

  it('falls back to URL params on standalone web', () => {
    restoreTelegram();
    const originalHref = window.location.href;
    window.history.replaceState(null, '', '/?station=station_xyz');
    try {
      expect(getStartParam()).toBe('station_xyz');
    } finally {
      window.history.replaceState(null, '', originalHref);
    }
  });
});

describe('shareStationLink (T_share_1 flow order)', () => {
  const payload = { url: 'https://t.me/radioatlasbot?startapp=station_abc', title: 'Tokyo FM', text: 'Listen live: Tokyo FM' };

  it('in a Telegram WebView opens the native chat picker FIRST and never touches clipboard/share', async () => {
    const calls: { openTelegramLink: string[]; share: number; clipboard: number } = {
      openTelegramLink: [],
      share: 0,
      clipboard: 0
    };
    const outcome = await shareStationLink(payload, {
      tg: { openTelegramLink: (url: string) => calls.openTelegramLink.push(url) } as unknown as TelegramWebApp,
      share: async () => {
        calls.share += 1;
      },
      clipboardWrite: async () => {
        calls.clipboard += 1;
      }
    });
    expect(outcome).toBe('telegram');
    expect(calls.openTelegramLink).toHaveLength(1);
    expect(calls.openTelegramLink[0]).toBe(buildTelegramShareUrl(payload.url, payload.text));
    expect(calls.openTelegramLink[0]).toContain('https://t.me/share/url?url=');
    // The bug being fixed: in-client users must NOT get a silent clipboard copy
    // (or a web share sheet) instead of the chat picker.
    expect(calls.clipboard).toBe(0);
    expect(calls.share).toBe(0);
  });

  it('outside Telegram uses the native web share sheet (not clipboard)', async () => {
    let sharedUrl: string | undefined;
    let clipboardCalls = 0;
    const outcome = await shareStationLink(payload, {
      tg: null,
      share: async (data) => {
        sharedUrl = data.url;
      },
      clipboardWrite: async () => {
        clipboardCalls += 1;
      }
    });
    expect(outcome).toBe('web-share');
    expect(sharedUrl).toBe(payload.url);
    expect(clipboardCalls).toBe(0);
  });

  it('falls back to clipboard when there is no Telegram and no web share sheet', async () => {
    let copied = '';
    const outcome = await shareStationLink(payload, {
      tg: null,
      share: null,
      clipboardWrite: async (text) => {
        copied = text;
      }
    });
    expect(outcome).toBe('clipboard');
    expect(copied).toBe(`${payload.title} ${payload.url}`);
  });

  it('falls through to clipboard when the web share sheet is dismissed/rejected', async () => {
    let copied = '';
    const outcome = await shareStationLink(payload, {
      tg: null,
      share: async () => {
        throw new Error('AbortError');
      },
      clipboardWrite: async (text) => {
        copied = text;
      }
    });
    expect(outcome).toBe('clipboard');
    expect(copied).toBe(`${payload.title} ${payload.url}`);
  });

  it('opens the share page in a new tab as the last resort', async () => {
    let opened = '';
    const outcome = await shareStationLink(payload, {
      tg: null,
      share: null,
      clipboardWrite: null,
      openExternal: (url) => {
        opened = url;
        return true;
      }
    });
    expect(outcome).toBe('opened');
    expect(opened).toBe(buildTelegramShareUrl(payload.url, payload.text));
  });

  it('reports failure when every channel is unavailable', async () => {
    const outcome = await shareStationLink(payload, {
      tg: null,
      share: null,
      clipboardWrite: null,
      openExternal: () => false
    });
    expect(outcome).toBe('failed');
  });
});

describe('isVersionAtLeast (T_share_3)', () => {
  it('compares Bot API versions NUMERICALLY (not lexically)', () => {
    expect(isVersionAtLeast('7.8', '7.8')).toBe(true);
    // numeric, not lexical: '7.10' < '7.8' as strings but 7.10 ≥ 7.8 as versions.
    expect(isVersionAtLeast('7.10', '7.8')).toBe(true);
    expect(isVersionAtLeast('8.0', '7.8')).toBe(true);
    expect(isVersionAtLeast('7.7', '7.8')).toBe(false);
    expect(isVersionAtLeast('6.9', '7.8')).toBe(false);
    expect(isVersionAtLeast(undefined, '7.8')).toBe(false);
  });
});

describe('canShareToStory (T_share_3 feature-detect)', () => {
  it('is false on standalone web (no SDK)', () => {
    restoreTelegram();
    expect(canShareToStory()).toBe(false);
  });

  it('is false when shareToStory is missing (older client)', () => {
    installTelegram({ version: '7.8', initData: 'auth_date=1&hash=a' });
    expect(canShareToStory()).toBe(false);
  });

  it('is false when the version is below 7.8', () => {
    installTelegram({ version: '7.7', initData: 'auth_date=1&hash=a', shareToStory: () => {} });
    expect(canShareToStory()).toBe(false);
  });

  it('is false when not inside a Telegram client (empty initData)', () => {
    installTelegram({ version: '7.8', initData: '', shareToStory: () => {} });
    expect(canShareToStory()).toBe(false);
  });

  it('is true with shareToStory + version ≥ 7.8 + inside the client', () => {
    installTelegram({ version: '7.8', initData: 'auth_date=1&hash=a', shareToStory: () => {} });
    expect(canShareToStory()).toBe(true);
  });
});

describe('shareStationToStory (T_share_3)', () => {
  it('is a no-op (returns false) when unsupported', () => {
    restoreTelegram();
    expect(shareStationToStory({ stationuuid: 'x', name: 'X' })).toBe(false);
  });

  it('calls shareToStory with the card media URL and a deep-link widget_link', () => {
    vi.stubEnv('VITE_TG_BOT', 'radioatlasbot');
    const captured = vi.fn<
      (url: string, params?: { widget_link?: { url: string; name?: string } }) => void
    >();
    installTelegram({
      version: '7.8',
      initData: 'auth_date=1&hash=a',
      shareToStory: captured
    });

    const ok = shareStationToStory({ stationuuid: 'abc-123', name: 'Tokyo FM' });
    expect(ok).toBe(true);
    expect(captured).toHaveBeenCalledTimes(1);
    const [url, params] = captured.mock.calls[0]!;
    expect(url).toContain('/api/share/story/abc-123.png');
    // widget_link must be the just-fixed startapp=station_<id> deep link.
    expect(params?.widget_link?.url).toBe(makeDeepLink('radioatlasbot', 'abc-123'));
    expect(params?.widget_link?.name).toBe('Tokyo FM');
    vi.unstubAllEnvs();
  });
});

describe('makeRecordDeepLink', () => {
  it('builds a ?start=rec_<id> link and strips a leading @ from the bot name', () => {
    expect(makeRecordDeepLink('radioatlasbot', 'abc-123')).toBe(
      'https://t.me/radioatlasbot?start=rec_abc-123'
    );
    expect(makeRecordDeepLink('@radioatlasbot', 'abc-123')).toBe(
      'https://t.me/radioatlasbot?start=rec_abc-123'
    );
  });
});

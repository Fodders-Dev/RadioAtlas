import { afterEach, describe, expect, it } from 'vitest';
import {
  getStartParam,
  getTelegramThemeParams,
  getTelegramWebApp,
  isInsideTelegramClient,
  openLinkOrFallback,
  openTelegramLinkOrFallback,
  subscribeTelegramThemeChange,
  triggerHaptic,
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

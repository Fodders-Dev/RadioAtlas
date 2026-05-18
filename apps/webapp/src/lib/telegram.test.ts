import { afterEach, describe, expect, it } from 'vitest';
import {
  getStartParam,
  getTelegramWebApp,
  isInsideTelegramClient,
  openLinkOrFallback,
  openTelegramLinkOrFallback,
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

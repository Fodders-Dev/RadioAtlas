// Centralised access to the Telegram WebApp SDK. index.html now loads
// telegram-web-app.js synchronously, so `window.Telegram.WebApp` exists
// in BOTH contexts post-load:
//
//   - inside the Telegram client:    SDK populated by Telegram's WebView
//                                    inject, full functionality.
//   - standalone web (canonical URL,
//     web preview, e2e harness):     SDK populated by the CDN script,
//                                    platform === 'unknown', initData
//                                    === '', methods like openInvoice
//                                    silently no-op.
//
// That means the pre-T1.1 idiom `if (window.Telegram?.WebApp) …` no
// longer answers "are we inside Telegram?" - it now answers "is the
// SDK loaded?". Those questions used to be the same; after T1.1 they
// diverge. To keep the existing non-Telegram fallback paths reachable
// on the standalone build, callers split into two camps:
//
//   getTelegramWebApp()       use when the SDK degrades gracefully off
//                             the client - openLink, ready, expand,
//                             setHeaderColor, themeParams reads.
//
//   isInsideTelegramClient()  use as a strict gate before calling
//                             openInvoice, HapticFeedback, isActive,
//                             or any other client-only surface where
//                             the SDK silently no-ops outside Telegram
//                             and the non-Telegram fallback must run
//                             instead. The canonical signal is a
//                             non-empty `initData` - Telegram HMAC-
//                             signs initData and only fills it inside
//                             the client; on standalone web it is
//                             always an empty string.

export type TelegramWebApp = NonNullable<NonNullable<Window['Telegram']>['WebApp']>;

export type TelegramOpenLinkOptions = { try_instant_view?: boolean };

const readWindowTelegram = (): TelegramWebApp | null => {
  if (typeof window === 'undefined') return null;
  return window.Telegram?.WebApp ?? null;
};

export const getTelegramWebApp = (): TelegramWebApp | null => readWindowTelegram();

export const isInsideTelegramClient = (): boolean => {
  const tg = readWindowTelegram();
  return Boolean(tg?.initData);
};

// Consolidates the "use SDK openLink, otherwise window.open" branch
// that was duplicated in StationDetails.tsx and RadioContext.tsx.
// Safe to call on standalone web: the SDK's openLink is documented
// to fall back to a regular window.open internally, but we still
// guard with `?.openLink` in case the SDK isn't loaded (CDN down,
// script blocked by CSP).
export const openLinkOrFallback = (
  url: string,
  options?: TelegramOpenLinkOptions
): void => {
  const tg = readWindowTelegram();
  if (tg?.openLink) {
    tg.openLink(url, options);
    return;
  }
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
};

// Telegram-specific share / login link. The chain mirrors the
// SessionContext call site: openTelegramLink (deep link UX) wins
// when available; otherwise openLink (generic); otherwise window.open.
export const openTelegramLinkOrFallback = (url: string): void => {
  const tg = readWindowTelegram();
  if (tg?.openTelegramLink) {
    tg.openTelegramLink(url);
    return;
  }
  if (tg?.openLink) {
    tg.openLink(url);
    return;
  }
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
};

const readUrlParamSource = (value: string) => {
  const normalized = value.trim().replace(/^#/, '');
  if (!normalized) {
    return new URLSearchParams();
  }
  if (normalized.startsWith('/')) {
    const queryIndex = normalized.indexOf('?');
    return new URLSearchParams(queryIndex >= 0 ? normalized.slice(queryIndex + 1) : '');
  }
  return new URLSearchParams(normalized);
};

export const getStartParam = (): string | null => {
  const tg = readWindowTelegram();
  const tgParam = tg?.initDataUnsafe?.start_param;
  if (tgParam) return tgParam;
  if (typeof window === 'undefined') return null;
  const searchParams = readUrlParamSource(window.location.search);
  const hashParams = readUrlParamSource(window.location.hash);
  return (
    searchParams.get('tgWebAppStartParam') ||
    searchParams.get('startapp') ||
    searchParams.get('start_param') ||
    searchParams.get('station') ||
    hashParams.get('tgWebAppStartParam') ||
    hashParams.get('startapp') ||
    hashParams.get('start_param') ||
    hashParams.get('station') ||
    null
  );
};

export const parseStationParam = (param: string): string => {
  let trimmed = param.trim();
  try {
    trimmed = decodeURIComponent(trimmed);
  } catch {
    // ignore decode failures
  }
  const match = trimmed.match(/station[_-](.+)$/i);
  if (match?.[1]) return match[1];
  return trimmed;
};

export const makeDeepLink = (botUsername: string, stationId: string) => {
  const safeBot = botUsername.replace(/^@/, '');
  return `https://t.me/${safeBot}?startapp=station_${stationId}`;
};

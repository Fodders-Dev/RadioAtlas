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

// T1.2: physical-feedback ping for genuine playback transport + like
// clicks (play/pause, next/prev, favorite). Strict client-only gate -
// HapticFeedback on standalone web silently no-ops in the SDK but is
// conceptually a Telegram-runtime surface, and we want intent to be
// explicit in case a future SDK version changes its mind. Default
// 'light' per the T1.2 brief; expanded styles available for future
// callers but not wired anywhere today.
export type TelegramHapticStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';

export const triggerHaptic = (style: TelegramHapticStyle = 'light'): void => {
  if (!isInsideTelegramClient()) return;
  const tg = readWindowTelegram();
  tg?.HapticFeedback?.impactOccurred?.(style);
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

// T_share_1: ordered station-share flow. The viral path is Telegram's native
// forward-to-chat picker, so in a Telegram WebView we open `t.me/share/url` via
// `openTelegramLink` FIRST (the old order tried navigator.share → silent
// clipboard first, so in-client users never saw the chat picker — they just got
// a quiet "link copied"). Outside Telegram we fall to the native web share
// sheet, then clipboard as a true last resort, then a plain new-tab open.
//
// NOT routed through openTelegramLinkOrFallback: its openLink/window.open
// fallback would pre-empt the navigator.share step, so we gate the Telegram
// branch on `openTelegramLink` presence and keep window.open as the FINAL
// fallback only. Effects are injectable so the ordering is unit-testable
// (mirrors the openTelegramLinkOrFallback test seam).
export type ShareStationPayload = { url: string; title: string; text: string };
export type ShareStationOutcome = 'telegram' | 'web-share' | 'clipboard' | 'opened' | 'failed';

type ShareStationDeps = {
  tg?: TelegramWebApp | null;
  share?: ((data: { title?: string; text?: string; url?: string }) => Promise<void>) | null;
  clipboardWrite?: ((text: string) => Promise<void>) | null;
  openExternal?: (url: string) => boolean;
};

export const buildTelegramShareUrl = (url: string, text: string) =>
  `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;

export const shareStationLink = async (
  { url, title, text }: ShareStationPayload,
  deps: ShareStationDeps = {}
): Promise<ShareStationOutcome> => {
  const shareUrl = buildTelegramShareUrl(url, text);
  const tg = deps.tg !== undefined ? deps.tg : getTelegramWebApp();

  // 1) Telegram WebView → native forward-to-chat picker (the viral path).
  if (tg?.openTelegramLink) {
    tg.openTelegramLink(shareUrl);
    return 'telegram';
  }

  // 2) Non-Telegram mobile web with a native share sheet.
  const share =
    deps.share !== undefined
      ? deps.share
      : typeof navigator !== 'undefined' && typeof navigator.share === 'function'
        ? navigator.share.bind(navigator)
        : null;
  if (share) {
    try {
      await share({ title, text, url });
      return 'web-share';
    } catch {
      // user dismissed or the sheet failed → fall through to clipboard
    }
  }

  // 3) True last resort: copy the link.
  const clipboardWrite =
    deps.clipboardWrite !== undefined
      ? deps.clipboardWrite
      : typeof navigator !== 'undefined' && navigator.clipboard?.writeText
        ? navigator.clipboard.writeText.bind(navigator.clipboard)
        : null;
  if (clipboardWrite) {
    try {
      await clipboardWrite(`${title} ${url}`);
      return 'clipboard';
    } catch {
      // ignore
    }
  }

  // 4) Last-ditch: open the Telegram share page in a new tab.
  const openExternal =
    deps.openExternal ??
    ((target: string) =>
      typeof window !== 'undefined'
        ? Boolean(window.open(target, '_blank', 'noopener,noreferrer'))
        : false);
  if (openExternal(shareUrl)) {
    return 'opened';
  }

  return 'failed';
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

// T1.3: per-user Telegram theme colors. The full 13-key surface is
// declared on `window.Telegram.WebApp.themeParams` in vite-env.d.ts;
// here we re-export a public alias and gate reads on
// `isInsideTelegramClient()` so the standalone-web fallback path
// (where the SDK loads but initData is empty) never picks up stale
// or partially-faked values.
//
// The shape MIRRORS the SDK exactly — Telegram clients send only
// the keys they have, never throw on missing ones. Callers must
// treat every field as optional and decide the floor (e.g.
// telegram-auto theme synthesis is suppressed when none of our 4
// source keys are present; see lib/theme/telegramAuto.ts).
export type TelegramThemeParams = {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
  header_bg_color?: string;
  accent_text_color?: string;
  section_bg_color?: string;
  section_header_text_color?: string;
  subtitle_text_color?: string;
  destructive_text_color?: string;
};

// Returns a fresh shallow clone of the SDK's themeParams object on
// every call. Two reasons:
//   1) Telegram MUTATES the same object in place between
//      themeChanged events. Without a clone, React state holds a
//      stale reference that === itself; setState's bail-out skips
//      the re-render and tokens never refresh.
//   2) The strict isInsideTelegramClient() gate (non-empty
//      initData) keeps the standalone-web SDK from leaking colors
//      into the canonical web build.
//
// Returns null in three cases that the caller can collapse to
// "fall back to default theme":
//   - SDK not loaded
//   - inside-but-no-themeParams (older Bot API version)
//   - themeParams shape is invalid (not a plain object)
//
// An EMPTY object `{}` is intentionally returned as-is (not null),
// so callers can distinguish "we know there are no params" from
// "we cannot tell". The synthesis floor in lib/theme/telegramAuto.ts
// filters empty objects.
export const getTelegramThemeParams = (): TelegramThemeParams | null => {
  if (!isInsideTelegramClient()) return null;
  const tg = readWindowTelegram();
  const raw = tg?.themeParams;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return { ...raw } as TelegramThemeParams;
};

// Subscribes to the SDK's themeChanged event. Returns an unsubscribe
// function — pair with useEffect cleanup so StrictMode's double-
// invoke mount doesn't leak listeners. Safe on standalone-web: if
// the SDK exposes neither onEvent nor offEvent, the subscribe is a
// no-op and the returned cleanup is also a no-op.
export const subscribeTelegramThemeChange = (
  callback: () => void
): (() => void) => {
  const tg = readWindowTelegram();
  if (!tg?.onEvent || !tg.offEvent) return () => {};
  tg.onEvent('themeChanged', callback);
  const offEvent = tg.offEvent;
  return () => {
    offEvent('themeChanged', callback);
  };
};

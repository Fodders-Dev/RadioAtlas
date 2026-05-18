import { getDeviceProfile } from './deviceProfile';
import { isInsideTelegramClient } from './telegram';

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

const readTelegramSearchParams = () => {
  if (typeof window === 'undefined') {
    return {
      initData: '',
      platform: '',
      version: '',
      hasStartParam: false
    };
  }
  const searchParams = readUrlParamSource(window.location.search);
  const hashParams = readUrlParamSource(window.location.hash);
  const readValue = (name: string) =>
    String(searchParams.get(name) || hashParams.get(name) || '').trim();
  return {
    initData: readValue('tgWebAppData'),
    platform: readValue('tgWebAppPlatform'),
    version: readValue('tgWebAppVersion'),
    hasStartParam:
      searchParams.has('tgWebAppStartParam') ||
      searchParams.has('startapp') ||
      searchParams.has('start_param') ||
      hashParams.has('tgWebAppStartParam') ||
      hashParams.has('startapp') ||
      hashParams.has('start_param')
  };
};

export const isTelegramMiniAppRuntime = () => {
  if (typeof window === 'undefined') return false;
  // Post-T1.1 the SDK populates window.Telegram.WebApp on standalone web
  // too, so a presence check alone returns true everywhere and breaks
  // downstream decisions (shouldForceProxyStreaming, the Winamp Lite
  // fullscreen rule). Use the strict client signal (initData) and keep
  // the query-param OR-branch so deep links opened in a fresh tab still
  // identify as Telegram-runtime when they carry tgWebApp* params.
  const search = readTelegramSearchParams();
  return (
    isInsideTelegramClient() ||
    Boolean(search.platform) ||
    Boolean(search.version) ||
    Boolean(search.initData) ||
    search.hasStartParam
  );
};

export const isTouchMobileRuntime = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const coarsePointer =
    window.matchMedia?.('(pointer: coarse)').matches ||
    window.matchMedia?.('(hover: none)').matches ||
    false;
  const hasTouchPoints = navigator.maxTouchPoints > 0;
  const narrowViewport = Math.min(window.innerWidth || 0, window.innerHeight || 0) <= 900;
  return narrowViewport && (coarsePointer || hasTouchPoints);
};

export const shouldForceProxyStreaming = () => {
  if (typeof window === 'undefined') return false;
  const profile = getDeviceProfile();
  return (
    isTelegramMiniAppRuntime() ||
    (isTouchMobileRuntime() && (profile.lowPower || profile.constrainedNetwork))
  );
};

export const shouldUseLiteWinampFullscreen = () => {
  if (typeof window === 'undefined') return false;
  const profile = getDeviceProfile();
  return isTouchMobileRuntime() && (profile.lowPower || isTelegramMiniAppRuntime());
};

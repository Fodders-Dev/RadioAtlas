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
  const tgParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
  if (tgParam) return tgParam;
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

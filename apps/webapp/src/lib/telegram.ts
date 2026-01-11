export const getStartParam = (): string | null => {
  const tgParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
  if (tgParam) return tgParam;
  const params = new URLSearchParams(window.location.search);
  return (
    params.get('tgWebAppStartParam') ||
    params.get('startapp') ||
    params.get('start_param') ||
    params.get('station') ||
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

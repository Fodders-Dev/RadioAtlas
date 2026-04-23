type BotUrlRuntimeInput = {
  apiUrl?: string;
  webAppUrl?: string;
  sourceCommit?: string;
};

const normalizeUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed).toString();
  } catch {
    return '';
  }
};

const inferWebAppUrl = (apiUrl: string) => {
  if (!apiUrl) return '';
  try {
    const url = new URL(apiUrl);
    url.pathname = '/';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
};

const resolveWebAppUrl = (configuredWebAppUrl: string, inferredWebAppUrl: string) => {
  if (!configuredWebAppUrl) return inferredWebAppUrl;
  if (!inferredWebAppUrl) return configuredWebAppUrl;
  const configuredOrigin = new URL(configuredWebAppUrl).origin;
  const inferredOrigin = new URL(inferredWebAppUrl).origin;
  if (configuredOrigin !== inferredOrigin) {
    console.warn(
      `WEBAPP_URL origin ${configuredOrigin} differs from API_URL origin ${inferredOrigin}; using API origin for bot web app links`
    );
    return inferredWebAppUrl;
  }
  return configuredWebAppUrl;
};

const stampUrl = (value: string, deployStamp: string, apiUrl: string) => {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (deployStamp) {
      url.searchParams.set('v', deployStamp);
    }
    if (apiUrl) {
      url.searchParams.set('api', apiUrl);
    }
    return url.toString();
  } catch {
    return value;
  }
};

export const createBotUrlRuntime = ({
  apiUrl: rawApiUrl = '',
  webAppUrl: rawWebAppUrl = '',
  sourceCommit = ''
}: BotUrlRuntimeInput) => {
  const apiUrl = normalizeUrl(rawApiUrl).replace(/\/+$/, '');
  const configuredWebAppUrl = normalizeUrl(rawWebAppUrl);
  const inferredWebAppUrl = inferWebAppUrl(apiUrl);
  const webAppUrl = resolveWebAppUrl(configuredWebAppUrl, inferredWebAppUrl);
  const deployStamp = String(sourceCommit).trim().slice(0, 7);

  return {
    apiUrl,
    webAppUrl,
    deployStamp,
    withSharedApi: (value: string) => stampUrl(value, deployStamp, apiUrl),
    withMiniAppParam: (param: string) => {
      if (!webAppUrl) return '';
      const url = new URL(webAppUrl);
      if (deployStamp) {
        url.searchParams.set('v', deployStamp);
      }
      url.searchParams.set('start', param);
      if (apiUrl) {
        url.searchParams.set('api', apiUrl);
      }
      return url.toString();
    }
  };
};

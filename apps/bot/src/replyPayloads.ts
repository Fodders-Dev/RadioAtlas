type ReplyPayload = {
  text: string;
  buttonLabel?: string;
  buttonUrl?: string;
};

type SharedUrlHelpers = {
  webAppUrl: string;
  withSharedApi: (value: string) => string;
  withMiniAppParam: (param: string) => string;
};

export const buildStartPayload = (
  helpers: SharedUrlHelpers,
  options: {
    username?: string | null;
    deepLink?: string;
  } = {}
): ReplyPayload => {
  const deepLink =
    options.deepLink ||
    (options.username ? `https://t.me/${options.username}?startapp=radio` : '');
  const lines = [
    'Добро пожаловать в RadioAtlas.',
    'Нажмите кнопку, чтобы открыть мини-приложение.',
    deepLink ? `Deep link: ${deepLink}` : ''
  ].filter(Boolean);

  return {
    text: lines.join('\n'),
    buttonLabel: helpers.webAppUrl ? 'Открыть радио' : undefined,
    buttonUrl: helpers.webAppUrl ? helpers.withSharedApi(helpers.webAppUrl) : undefined
  };
};

export const buildSupportPayload = (helpers: SharedUrlHelpers): ReplyPayload => ({
  text: 'Поддержать RadioAtlas можно прямо в мини-приложении через Telegram Stars.',
  buttonLabel: helpers.webAppUrl ? 'Поддержать RadioAtlas' : undefined,
  buttonUrl: helpers.webAppUrl ? helpers.withMiniAppParam('support') : undefined
});

export const buildPremiumPayload = (helpers: SharedUrlHelpers): ReplyPayload => ({
  text: 'Открываю экран Premium в RadioAtlas.',
  buttonLabel: helpers.webAppUrl ? 'Открыть Premium' : undefined,
  buttonUrl: helpers.webAppUrl ? helpers.withMiniAppParam('premium') : undefined
});

export const buildGiftPayload = (helpers: SharedUrlHelpers, rawPayload?: string | null): ReplyPayload => {
  const payload = rawPayload?.trim();
  const param = payload ? `gift:${payload}` : 'gift';
  return {
    text: 'Подарить Premium можно из мини-приложения.',
    buttonLabel: helpers.webAppUrl ? 'Подарить Premium' : undefined,
    buttonUrl: helpers.webAppUrl ? helpers.withMiniAppParam(param) : undefined
  };
};

export const buildSharePayload = (rawPayload?: string | null): ReplyPayload => {
  const payload = rawPayload?.trim();
  if (!payload) {
    return {
      text: 'Usage: /share <station_url>'
    };
  }

  return {
    text: `Share this station: ${payload}`
  };
};

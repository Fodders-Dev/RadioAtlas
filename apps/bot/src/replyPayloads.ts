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
  text: 'Платные функции пока закрыты. Откройте RadioAtlas и слушайте радио.',
  buttonLabel: helpers.webAppUrl ? 'Открыть RadioAtlas' : undefined,
  buttonUrl: helpers.webAppUrl ? helpers.withMiniAppParam('radio') : undefined
});

export const buildPremiumPayload = (helpers: SharedUrlHelpers): ReplyPayload => ({
  text: 'Платные функции пока закрыты. Сейчас RadioAtlas фокусируется на радио-ядре.',
  buttonLabel: helpers.webAppUrl ? 'Открыть RadioAtlas' : undefined,
  buttonUrl: helpers.webAppUrl ? helpers.withMiniAppParam('radio') : undefined
});

export const buildGiftPayload = (helpers: SharedUrlHelpers, rawPayload?: string | null): ReplyPayload => {
  void rawPayload;
  return {
    text: 'Подарки и платные функции пока закрыты. Откройте RadioAtlas и слушайте радио.',
    buttonLabel: helpers.webAppUrl ? 'Открыть RadioAtlas' : undefined,
    buttonUrl: helpers.webAppUrl ? helpers.withMiniAppParam('radio') : undefined
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

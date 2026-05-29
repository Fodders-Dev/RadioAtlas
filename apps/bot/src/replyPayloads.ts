import type { InlineQueryResultArticle } from 'grammy/types';

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

// T_share_2: inline-mode result builder. Pure formatter (no grammy at runtime —
// the InlineQueryResultArticle import is type-only and erased), mirroring the
// payload-builder seam above so it's unit-testable. The async fetch that feeds
// it lives in inlineQuery.ts (mirrors billingForward.ts).
//
// Telegram constraint: inline-result reply_markup CANNOT use web_app buttons —
// only URL buttons. So "▶ Слушать" is a URL button on the t.me deep link
// (t.me/<bot>?startapp=station_<uuid>), which the Mini App parses on landing
// (App.tsx) — the same deep link the webapp's makeDeepLink produces.
export type InlineStation = {
  stationuuid: string;
  name: string;
  favicon?: string | null;
  country?: string | null;
  tags?: string | null;
};

const INLINE_RESULT_LIMIT = 12;

const firstMeaningfulTag = (tags?: string | null) =>
  (tags || '')
    .split(',')
    .map((tag) => tag.trim())
    .find((tag) => tag && tag.toLowerCase() !== 'no tags') || '';

// Favicons are frequently empty or non-URL junk; only pass a thumb_url through
// when it's a real http(s) URL, otherwise omit it (the article renders fine).
const validThumbUrl = (favicon?: string | null) => {
  const value = (favicon || '').trim();
  return /^https?:\/\//i.test(value) ? value : undefined;
};

const stationDeepLink = (username: string, stationId: string) =>
  `https://t.me/${username}?startapp=station_${stationId}`;

// Graceful fallback shown when the API is down, the result set is empty, or the
// bot username is unavailable (so we never emit a broken t.me/undefined link).
const fallbackResult = (username: string): InlineQueryResultArticle => {
  const openLink = username ? `https://t.me/${username}?startapp=radio` : '';
  const intro = '🎧 RadioAtlas — радио со всего мира';
  return {
    type: 'article',
    id: 'open-radioatlas',
    title: 'Открыть RadioAtlas',
    description: 'Радиостанции со всего мира',
    input_message_content: {
      message_text: openLink ? `${intro}\n${openLink}` : intro
    },
    ...(openLink
      ? { reply_markup: { inline_keyboard: [[{ text: 'Открыть RadioAtlas', url: openLink }]] } }
      : {})
  };
};

export const buildInlineResults = (
  stations: InlineStation[],
  { username }: { username?: string | null }
): InlineQueryResultArticle[] => {
  const bot = (username || '').trim();
  // No username → can't build per-station deep links; degrade to the single
  // fallback rather than emitting broken links.
  if (!stations.length || !bot) {
    return [fallbackResult(bot)];
  }

  return stations.slice(0, INLINE_RESULT_LIMIT).map((station) => {
    const deepLink = stationDeepLink(bot, station.stationuuid);
    const genre = firstMeaningfulTag(station.tags);
    const country = (station.country || '').trim();
    const description = [genre, country].filter(Boolean).join(' · ');
    const thumbUrl = validThumbUrl(station.favicon);
    const messageText = `🎧 ${station.name}${genre ? ` — ${genre}` : ''}\nСлушать вживую: ${deepLink}`;

    return {
      type: 'article',
      id: station.stationuuid,
      title: station.name,
      ...(description ? { description } : {}),
      ...(thumbUrl ? { thumb_url: thumbUrl } : {}),
      input_message_content: { message_text: messageText },
      reply_markup: { inline_keyboard: [[{ text: '▶ Слушать', url: deepLink }]] }
    };
  });
};

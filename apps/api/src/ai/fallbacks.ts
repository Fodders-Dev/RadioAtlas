// Honest fallback replies for turns that could not produce a complete answer.
// Any cards or links still come only from verified tool results; prose never
// claims that a station is playing now or that a service contains a specific
// track.

import { cleanText } from './antiHallucination.js';
import type {
  ChatResult,
  ServiceLink,
  Surface,
  VerifiedStationRef,
  WebSource
} from './types.js';

export type FallbackReason =
  | 'disabled'
  | 'compose-error'
  | 'empty'
  | 'voice-unsafe'
  | 'capped'
  | 'unfinished'
  | 'no-matches';

const EMPTY_RESULT_LINES: Record<FallbackReason, string> = {
  disabled: 'Лира сейчас отключена. Попробуй вернуться чуть позже.',
  'compose-error': 'Не получилось собрать ответ на этот раз. Попробуй чуть позже.',
  empty: 'На этот запрос не получилось подготовить ответ. Попробуй ещё раз.',
  'voice-unsafe': 'Не хочу додумывать и рисковать неточным ответом. Попробуй спросить иначе.',
  capped: 'Я не успела обработать запрос из-за ограничения. Попробуй чуть позже.',
  unfinished: 'Я не успела закончить ответ. Можешь продолжить здесь чуть позже.',
  'no-matches': 'Подходящих эфиров по этому запросу сейчас не нашла. Можно попробовать другой жанр или смягчить ограничения.'
};

const STATIONS_LINE = (firstStationName?: string) => firstStationName
  ? `Нашла «${firstStationName}». Найденные эфиры — в карточках ниже.`
  : 'Найденные эфиры — в карточках ниже.';

const SERVICE_LINKS_LINE =
  'Подготовила ссылки на поиск в музыкальных сервисах. Открой нужный сервис и посмотри результаты там.';

const SOURCES_LINE =
  'Нашла источники по этому вопросу. Открой карточки источников, чтобы проверить подробности.';

const cleanStationName = (name: string): string => {
  const normalized = String(name || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  // Normalize the label as plain text here. The complete reply is cleaned for
  // its surface once below, avoiding double-escaping in Telegram.
  return cleanText(normalized, 'miniapp');
};

export const buildFallbackResult = (options: {
  surface: Surface;
  now: number;
  stations?: VerifiedStationRef[];
  serviceLinks?: ServiceLink[];
  sources?: WebSource[];
  reason: FallbackReason;
}): ChatResult => {
  const stations = (options.stations || []).slice(0, 5);
  const serviceLinks = options.serviceLinks || [];
  const sources = options.sources || [];

  // Prefer the closest usable next step: station cards, then service searches,
  // then factual citations. All returned resources remain available to the UI.
  let text: string;
  if (stations.length) {
    const firstName = cleanStationName(stations[0]!.name);
    text = STATIONS_LINE(firstName || undefined);
  } else if (serviceLinks.length) {
    text = SERVICE_LINKS_LINE;
  } else if (sources.length) {
    text = SOURCES_LINE;
  } else {
    text = EMPTY_RESULT_LINES[options.reason];
  }

  return {
    reply: cleanText(text, options.surface),
    stations,
    serviceLinks,
    sources,
    actions: [{ kind: 'none' }]
  };
};

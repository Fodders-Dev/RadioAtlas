import type { ToolObservation } from './types.js';

export type ReplyIntent = 'conversation' | 'clarification' | 'knowledge' | 'recommendation';
export type ReplySelection = 'stations' | 'services' | 'empty' | 'not-attempted' | 'failed';

export type ReplyContext = {
  intent: ReplyIntent;
  selection?: ReplySelection;
};

export type ReplyContextInput = {
  intent: ReplyIntent;
  observations: readonly ToolObservation[];
  stationCount: number;
  serviceLinkCount: number;
};

const STATION_LOOKUP_TOOLS = new Set([
  'search_stations',
  'find_stations_by_artist',
  'get_station',
  'discover_trending',
]);

export const buildReplyContext = ({
  intent,
  observations,
  stationCount,
  serviceLinkCount,
}: ReplyContextInput): ReplyContext => {
  if (intent !== 'recommendation') return { intent };
  if (stationCount > 0) return { intent, selection: 'stations' };
  if (serviceLinkCount > 0) return { intent, selection: 'services' };

  const lookups = observations.filter(({ tool }) => STATION_LOOKUP_TOOLS.has(tool));
  if (lookups.length === 0) return { intent, selection: 'not-attempted' };
  // A successful anchor lookup cannot turn another failed search into a
  // verified no-match. With no final resources, keep partial failure visible.
  if (lookups.some(({ error }) => Boolean(error))) return { intent, selection: 'failed' };
  return { intent, selection: 'empty' };
};

// Fixed, bounded guidance only. Observation contents and model-authored notes
// are deliberately never copied into this system instruction.
export const renderReplyContextInstruction = ({ intent, selection }: ReplyContext): string => {
  switch (intent) {
    case 'conversation':
      return 'Сейчас обычная беседа: отвечай на тему пользователя. Не предлагай подбор, саундтрек или запуск музыки по своей инициативе, даже в конце ответа. Прежнее предложение ассистента не означает согласия; «и?» продолжает тему человека. Не объясняй отсутствие станций, которых он не просил.';
    case 'clarification':
      return 'Задай один необходимый уточняющий вопрос. Не рекламируй каталог и не объясняй сбой инвентаря.';
    case 'knowledge':
      return 'Ответь на вопрос или дай объяснение без перехода к станциям. Различай отсутствие источников и неудачный поиск.';
    case 'recommendation':
      switch (selection) {
        case 'stations':
          return 'Рекомендуй только переданные станции и сохраняй их факты без изменений.';
        case 'services':
          return 'Предложи переданные ссылки как ссылки для поиска музыки в сервисах; это не гарантия наличия или воспроизведения. Не утверждай, что поиск станций состоялся.';
        case 'empty':
          return 'Скажи, что этот поиск не нашёл станций. Не утверждай, что весь каталог пуст.';
        case 'failed':
          return 'Скажи, что проверить станции не удалось. Не выдавай сбой за отсутствие совпадений.';
        case 'not-attempted':
        default:
          return 'Поиск станций не подтверждён. Не утверждай, что он выполнялся или что совпадений нет.';
      }
  }
};

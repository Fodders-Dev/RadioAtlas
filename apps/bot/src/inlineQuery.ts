// T_share_2: async orchestration for the bot's inline mode. Extracted from the
// `bot.on('inline_query', …)` handler in index.ts — exactly like billingForward.ts
// — so unit tests can inject a mocked fetch without booting grammy. The pure
// result formatter is buildInlineResults in replyPayloads.ts.
//
// Empty query → trending (one GET /catalog/summary → .trending) for the best
// first impression; a typed query → GET /catalog/search?q=…&limit=12. Any
// failure (no apiUrl, fetch throws, non-2xx, bad shape) degrades to the single
// "Открыть RadioAtlas" fallback result — never a crash or an empty answer.
import { buildInlineResults, type InlineStation } from './replyPayloads.js';
import type { InlineQueryResultArticle } from 'grammy/types';

export type InlineQueryDeps = {
  fetch: typeof fetch;
  apiUrl: string;
};

export type InlineQueryInput = {
  query: string;
  username?: string | null;
};

export type InlineQueryResolution = {
  results: InlineQueryResultArticle[];
  cacheTime: number;
};

const SEARCH_LIMIT = 12;
// Telegram caches the inline answer for this long, so trending-on-empty costs
// at most one /catalog/summary per user per minute.
const CACHE_TIME_SECONDS = 60;

const fetchStationList = async (
  deps: InlineQueryDeps,
  path: string,
  field: 'items' | 'trending'
): Promise<InlineStation[]> => {
  if (!deps.apiUrl) return [];
  const response = await deps.fetch(`${deps.apiUrl}${path}`);
  if (!response.ok) return [];
  const body = (await response.json()) as Record<string, unknown> | null;
  const list = body?.[field];
  return Array.isArray(list) ? (list as InlineStation[]) : [];
};

export const resolveInlineQuery = async (
  { query, username }: InlineQueryInput,
  deps: InlineQueryDeps
): Promise<InlineQueryResolution> => {
  const trimmed = query.trim();
  let stations: InlineStation[] = [];

  try {
    stations = trimmed
      ? await fetchStationList(
          deps,
          `/catalog/search?q=${encodeURIComponent(trimmed)}&limit=${SEARCH_LIMIT}`,
          'items'
        )
      : await fetchStationList(deps, '/catalog/summary', 'trending');
  } catch {
    // Network error / bad JSON → buildInlineResults([]) returns the fallback.
    stations = [];
  }

  return {
    results: buildInlineResults(stations, { username }),
    cacheTime: CACHE_TIME_SECONDS
  };
};

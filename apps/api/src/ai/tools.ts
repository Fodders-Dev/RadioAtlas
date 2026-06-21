// The 4 v1 tools + their planner-facing schemas + a safe runner. The planner
// (DeepSeek in PLANNER MODE) emits {action:'use_tool', tool, args}; runTool
// executes against the DI'd ToolProvider (catalog, in-process) or the
// deterministic music-link builder, and NEVER throws into the loop.

import { buildServiceSearchLinks } from './musicLinks.js';
import type {
  MusicService,
  PlannerDecision,
  ToolObservation,
  ToolProvider,
  WebSearchProvider
} from './types.js';

export const MAX_TOOL_STEPS = 3;

export type ToolSchema = {
  name: string;
  description: string;
  args: string;
};

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: 'search_stations',
    description:
      'Найти реальные радио-станции в полке под запрос/жанр/настроение/страну. Используй, когда человек хочет ВКЛЮЧИТЬ радио или просит посоветовать станцию.',
    args: '{ "query": string, "country"?: string, "language"?: string, "tag"?: string, "limit"?: number }'
  },
  {
    name: 'get_station',
    description:
      'Подтвердить одну конкретную станцию по её id и получить её играбельный поток. Бэкстоп против выдумок.',
    args: '{ "id": string }'
  },
  {
    name: 'discover_trending',
    description:
      'Что сейчас тепло звучит по настроениям (поздний вечер / тренировка / фокус / дорога). Используй, когда точного запроса нет или поиск пуст.',
    args: '{ "seed"?: string }'
  },
  {
    name: 'music_service_search',
    description:
      'Дать ссылки на музыкальные сервисы для КОНКРЕТНОГО трека/альбома/артиста (не радио): попса, андеграунд, саундтреки к фильмам и играм.',
    args: '{ "query": string }'
  },
  {
    name: 'web_search_factual',
    description:
      'Проверить ФАКТ или новость в вебе, когда нельзя выдумывать: жив ли артист, что у него нового, даты, релизы, события. Верни короткий запрос. Доступен НЕ всегда.',
    args: '{ "query": string }'
  }
];

// web_search_factual is only OFFERED to the planner when web search is active
// (see buildPlannerSystem); it stays in TOOL_SCHEMAS so parsePlannerDecision
// accepts it, but runTool refuses gracefully when the provider is absent.
export const WEB_SEARCH_TOOL = 'web_search_factual';

export const TOOL_NAMES = TOOL_SCHEMAS.map((schema) => schema.name);

// A query about a life/death/news status wants the freshest data (short cache).
const VOLATILE_FACT =
  /(жив|умер|сконча|погиб|сейчас|сегодня|новост|вышел|выйдет|релиз|концерт|тур|latest|today|news|recent|2024|2025|2026)/i;

// Stable signature for the "never call the same tool+args twice" dedup.
export const toolSignature = (tool: string, args: Record<string, unknown>): string => {
  const keys = Object.keys(args).sort();
  const normalized: Record<string, unknown> = {};
  for (const key of keys) normalized[key] = args[key];
  return `${tool}:${JSON.stringify(normalized)}`;
};

const asString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const asOptionalString = (value: unknown): string | undefined => {
  const text = asString(value);
  return text ? text : undefined;
};

const asLimit = (value: unknown): number | undefined => {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return undefined;
  return Math.min(8, Math.max(1, Math.floor(num)));
};

export const runTool = async (
  tool: string,
  args: Record<string, unknown>,
  ctx: { tools: ToolProvider; musicServices: MusicService[]; webSearch?: WebSearchProvider }
): Promise<ToolObservation> => {
  const base = { tool, args };
  try {
    switch (tool) {
      case 'search_stations': {
        const stations = await ctx.tools.searchStations({
          query: asString(args.query),
          country: asOptionalString(args.country),
          language: asOptionalString(args.language),
          tag: asOptionalString(args.tag),
          limit: asLimit(args.limit)
        });
        return { ...base, found: stations.length > 0, stations };
      }
      case 'get_station': {
        const station = await ctx.tools.getStation(asString(args.id));
        return { ...base, found: Boolean(station), stations: station ? [station] : [] };
      }
      case 'discover_trending': {
        const rails = await ctx.tools.discoverTrending(asOptionalString(args.seed));
        const stations = rails.flatMap((rail) => rail.stations).slice(0, 8);
        return {
          ...base,
          found: stations.length > 0,
          stations,
          note: rails.map((rail) => rail.label).filter(Boolean).join(', ') || undefined
        };
      }
      case 'music_service_search': {
        const query = asString(args.query);
        const serviceLinks = buildServiceSearchLinks(query, ctx.musicServices);
        return { ...base, found: serviceLinks.length > 0, serviceLinks };
      }
      case WEB_SEARCH_TOOL: {
        if (!ctx.webSearch) return { ...base, found: false, error: 'web search disabled' };
        const query = asString(args.query);
        if (!query) return { ...base, found: false };
        const outcome = await ctx.webSearch.search(query, { fresh: VOLATILE_FACT.test(query) });
        return {
          ...base,
          found: outcome.sources.length > 0,
          sources: outcome.sources,
          note: outcome.status
        };
      }
      default:
        return { ...base, found: false, error: `unknown tool: ${tool}` };
    }
  } catch (err) {
    return { ...base, found: false, error: err instanceof Error ? err.message : 'tool failed' };
  }
};

// Tolerant JSON-object extraction for the planner output: strips ```json
// fences, takes the first '{' to the last '}', tolerates trailing prose, and
// returns null on any parse failure (caller then treats it as a 'final' step).
export const extractJsonObject = (text: string): Record<string, unknown> | null => {
  let raw = String(text || '').trim();
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

export const parsePlannerDecision = (text: string): PlannerDecision => {
  const parsed = extractJsonObject(text);
  if (!parsed) return { action: 'final' };
  const action = parsed.action === 'use_tool' ? 'use_tool' : 'final';
  if (action === 'final') return { action: 'final', note: asOptionalString(parsed.note) };
  const tool = asString(parsed.tool);
  if (!TOOL_NAMES.includes(tool)) return { action: 'final', note: asOptionalString(parsed.note) };
  const args =
    parsed.args && typeof parsed.args === 'object'
      ? (parsed.args as Record<string, unknown>)
      : {};
  return { action: 'use_tool', tool, args, note: asOptionalString(parsed.note) };
};

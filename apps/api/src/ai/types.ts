// «Лира» AI music companion — shared core types. Pure data shapes, zero
// express/grammy/react imports. Both surfaces (Mini App in-process, Telegram
// over HTTP) call chatWithAssistant() with these.

export type Surface = 'miniapp' | 'telegram';

export type ChatTurn = { role: 'user' | 'assistant'; text: string };

export type ChatInput = {
  userMessage: string;
  history?: ChatTurn[];
  surface: Surface;
  locale?: string;
};

// A station the model is allowed to name — ONLY ever sourced from a tool
// observation (anti-hallucination). The edge (bot/webapp) renders these as
// cards / deep-link buttons.
export type VerifiedStationRef = {
  stationuuid: string;
  name: string;
  country: string;
  tags: string[];
  favicon: string;
  url_resolved: string;
  deepLink?: string;
};

export type MusicService =
  | 'yandex'
  | 'zvuk'
  | 'vk'
  | 'spotify'
  | 'soundcloud'
  | 'youtube';

// A safe search link to an external music service (links to the service's
// SEARCH page for a query — never a guessed track/album id, so it cannot
// hallucinate a specific resource).
export type ServiceLink = {
  service: MusicService;
  label: string;
  url: string;
  query: string;
};

// A factual web source surfaced by web_search_factual. The edge renders these
// as citation buttons. Snippets are UNTRUSTED text (hostile input) — they are
// sanitized + fenced before they ever reach the model (see untrustedData.ts).
export type WebSource = {
  title: string;
  url: string;
  snippet: string;
  score: number;
  publishedDate?: string;
};

export type AssistantAction = {
  kind: 'play' | 'open-station' | 'none';
  stationuuid?: string;
};

export type ChatUsage = { prompt: number; completion: number };

export type ChatResult = {
  reply: string;
  stations: VerifiedStationRef[];
  serviceLinks: ServiceLink[];
  sources: WebSource[];
  actions: AssistantAction[];
  usage?: ChatUsage;
};

// --- DeepSeek client config (server-only; the key lives in exactly one env) ---
export type DeepseekConfig = {
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  model: string;
  maxOutputTokens: number;
  timeoutSec: number;
};

// --- Tool layer ------------------------------------------------------------
export type SearchStationsArgs = {
  query: string;
  country?: string;
  language?: string;
  tag?: string;
  limit?: number;
};

export type TrendingRail = {
  id: string;
  label: string;
  stations: VerifiedStationRef[];
};

// DI seam: the api binds this to the in-process catalogService; tests bind a
// stub. music_service_search is deterministic (no network) and lives in
// musicLinks.ts, so it is NOT part of the provider.
export type ToolProvider = {
  searchStations: (args: SearchStationsArgs) => Promise<VerifiedStationRef[]>;
  getStation: (id: string) => Promise<VerifiedStationRef | null>;
  discoverTrending: (seed?: string) => Promise<TrendingRail[]>;
};

// One result of running a tool, fed back into the planner/composer as the
// ONLY grounding for volatile facts (station names/uuids, playability).
export type ToolObservation = {
  tool: string;
  args: Record<string, unknown>;
  found: boolean;
  stations?: VerifiedStationRef[];
  serviceLinks?: ServiceLink[];
  sources?: WebSource[];
  note?: string;
  error?: string;
};

// --- Web-search seam (Tavily only; key server-only, like DeepSeek) ----------
export type WebSearchOutcome =
  | { status: 'ok'; sources: WebSource[] }
  | { status: 'empty'; sources: [] }
  | { status: 'capped'; sources: [] }
  | { status: 'error'; sources: [] };

// DI seam: the api binds this to the Tavily client; tests bind a stub. Absent
// (undefined) ⇒ web search is OFF and the tool is never offered to the planner.
export type WebSearchProvider = {
  search: (query: string, opts: { fresh: boolean }) => Promise<WebSearchOutcome>;
};

export type PlannerDecision = {
  action: 'use_tool' | 'final';
  tool?: string;
  args?: Record<string, unknown>;
  note?: string;
};

export type AssistantDeps = {
  deepseek: DeepseekConfig;
  tools: ToolProvider;
  musicServices: MusicService[];
  // Optional web-search provider — when present, web_search_factual is offered
  // to the planner; when undefined, web search is OFF (default).
  webSearch?: WebSearchProvider;
  fetch: typeof fetch;
  log: (message: string) => void;
  now: () => number;
};

export type ToolServicesConfig = {
  // Which external music services to surface (env AI_MUSIC_SERVICES); ordered.
  musicServices: MusicService[];
};

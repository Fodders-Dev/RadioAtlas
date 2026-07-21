// «Лира» AI music companion — shared core types. Pure data shapes, zero
// express/grammy/react imports. Both surfaces (Mini App in-process, Telegram
// over HTTP) call chatWithAssistant() with these.

export type Surface = 'miniapp' | 'telegram';

export type ChatTurn = { role: 'user' | 'assistant'; text: string };

// Bounded, client-verified playback metadata. It lets a question such as
// «о чём этот трек?» resolve against the live player without exposing stream
// URLs or treating stale cached metadata as current.
export type NowPlayingContext = {
  track?: string;
  stationName?: string;
};

export type ChatInput = {
  userMessage: string;
  history?: ChatTurn[];
  surface: Surface;
  locale?: string;
  userTaste?: UserTasteContext;
  nowPlaying?: NowPlayingContext;
};

export type UserTasteContext = {
  favoriteStationIds?: string[];
  recentStationIds?: string[];
  hiddenStationIds?: string[];
  negativeStationIds?: string[];
  lastRecommendedStationIds?: string[];
  stationScores?: Record<string, number>;
  tagScores?: Record<string, number>;
  countryScores?: Record<string, number>;
  languageScores?: Record<string, number>;
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

// How strongly a find_stations_by_artist result is tied to the artist:
//  - 'curated': a Radio-Vanya station DEDICATED to that artist (owner-verified) —
//    Лира may state it plays the artist.
//  - 'name-match': a catalog station whose NAME merely matches the artist — Лира
//    says "по названию похоже", never that it plays them.
//  - 'none': no station; external service-search links only.
export type ArtistGrounding = 'curated' | 'name-match' | 'none';

// The curated artist-station the L1 resolver matched (curatedArtistIndex.ts).
// Carries the keys the catalog tool provider uses to fetch the LIVE card.
export type CuratedArtistHit = {
  stationuuid: string; // curated fallback uuid (live uuid resolved from catalog)
  artist: string;
  displayName: string;
  name: string; // full catalog station name («Радио Ваня — Дискотека Авария»)
  mount: string; // lowercased CDN mount, for live-row lookup
  matchTerms: string[]; // name + display + aliases, for substring fallback lookup
};

// DI seam: the api binds this to the in-process catalogService; tests bind a
// stub. music_service_search is deterministic (no network) and lives in
// musicLinks.ts, so it is NOT part of the provider.
export type ToolProvider = {
  searchStations: (args: SearchStationsArgs) => Promise<VerifiedStationRef[]>;
  getStation: (id: string) => Promise<VerifiedStationRef | null>;
  discoverTrending: (seed?: string) => Promise<TrendingRail[]>;
  // Artist-search seam (find_stations_by_artist). Optional so existing stub
  // providers/tests stay valid; when absent the tool falls straight to L4 links.
  //  - resolveArtistStation: fetch the LIVE catalog card for an L1 curated hit.
  //  - matchStationsByArtistName: L3 — catalog stations whose NAME matches the
  //    artist (token-prefix, NOT tags), ranked, capped.
  resolveArtistStation?: (hit: CuratedArtistHit) => Promise<VerifiedStationRef | null>;
  matchStationsByArtistName?: (artist: string) => Promise<VerifiedStationRef[]>;
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
  // Set ONLY by find_stations_by_artist — how strongly the cards tie to the
  // artist (drives the composer's "plays X" vs "name looks similar" guard).
  grounding?: ArtistGrounding;
  // The artist the find tool resolved against (for the composer's grounding note).
  artist?: string;
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
  search: (
    query: string,
    opts: { fresh: boolean; includeContent?: boolean }
  ) => Promise<WebSearchOutcome>;
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

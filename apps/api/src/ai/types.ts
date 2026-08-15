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
  /**
   * The station the listener is actually on. A NAME is not enough to answer
   * "tell me about this station" — two stations share a name often enough, and
   * the catalogue is keyed by uuid. With the id, the assistant can call the
   * existing get_station tool and answer from real catalogue data instead of
   * guessing from a string.
   */
  stationUuid?: string;
};

export type ChatInput = {
  userMessage: string;
  history?: ChatTurn[];
  surface: Surface;
  locale?: string;
  userTaste?: UserTasteContext;
  nowPlaying?: NowPlayingContext;
  agentContext?: AgentClientContext;
  actionReceipts?: ClientActionReceipt[];
  safetyIdentifier?: string;
};

export type AgentClientContext = {
  isPlaying?: boolean;
  queueStationIds?: string[];
};

export type ClientActionReceipt = {
  actionId: string;
  kind: AssistantAction['kind'];
  status: 'executed' | 'skipped' | 'failed';
  stationuuid?: string;
  detail?: string;
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
  actionId?: string;
  kind: 'play' | 'open-station' | 'enqueue' | 'set-favorite' | 'pause' | 'none';
  stationuuid?: string;
  desired?: boolean;
  permission?: 'read' | 'write';
};

export type ChatUsage = { prompt: number; completion: number };

/**
 * Why a model call failed, as an operator would triage it. `billing` and `auth`
 * need a human; `rate_limit`, `provider_unavailable`, `timeout`, and `network`
 * are expected to self-heal. A deliberately disabled model is NOT in this set —
 * that is configuration, not an outage.
 */
export type ModelErrorKind =
  | 'auth'
  | 'billing'
  | 'rate_limit'
  | 'provider_unavailable'
  | 'timeout'
  | 'network'
  | 'http';

export type ChatResult = {
  reply: string;
  stations: VerifiedStationRef[];
  serviceLinks: ServiceLink[];
  sources: WebSource[];
  actions: AssistantAction[];
  usage?: ChatUsage;
  agentRun?: AgentRunSummary;
  /**
   * Distinct model-failure kinds hit while producing this reply. A non-empty
   * list means the listener got a deterministic fallback INSTEAD of a model
   * answer — the run must not be reported as a clean success. Empty/undefined
   * on every healthy turn.
   */
  modelErrors?: ModelErrorKind[];
  /**
   * Why the station-card gate fired on this turn. Operator telemetry only: the
   * `/ai/chat` response body is an explicit allow-list and never carries it.
   *
   * The gate is the only thing standing between «Почему людям так нравится
   * джаз?» and a rack of stations nobody asked to hear, and the retained agent
   * run deliberately keeps no prompt text - so without this there is no way to
   * tell an over-firing gate from a gate that never fires at all.
   */
  cardGate?: CardGateSignal;
  /**
   * What the explicit negative-constraint filter did on this turn. Operator
   * telemetry only, same as `cardGate`: the `/ai/chat` body never carries it.
   */
  constraintFilter?: ConstraintFilterSignal;
  /** Grounding-provider outcomes for this turn, in call order. */
  webSearchStatuses?: WebSearchStatus[];
};

export type ConstraintFilterSignal = {
  /** How many «без …» / «кроме …» clauses the listener actually wrote. */
  clauses: number;
  /**
   * Which constraints fired, from the closed, repo-owned
   * `EXPLICIT_STATION_EXCLUSIONS` vocabulary. Never a user-supplied string —
   * a counter key built from chat text would be unbounded key minting.
   */
  matchedIds: string[];
  /** Station cards the constraint actually removed. */
  removedCards: number;
  /**
   * The listener wrote an exclusion clause that matched NO known constraint.
   * This is the "real miss" the roadmap wants the vocabulary expanded from —
   * it says the vocabulary is short, without retaining what was asked.
   */
  unmatchedClause: boolean;
  /** The constraint removed every card, so the turn fell back to link search. */
  emptiedEverything: boolean;
};

/**
 * Per-turn tally of the grounding provider's outcomes, keyed by the same closed
 * status set the provider already returns (`disabled` covers the tool being
 * offered while no provider is bound). Grounding degrades silently by design —
 * an exhausted Tavily quota or a provider outage just means Lira stops citing
 * sources — which is precisely why it needs a number, the same lesson the
 * 2026-08-14 DeepSeek billing outage taught about the model client.
 */
export type WebSearchStatus = 'ok' | 'empty' | 'capped' | 'error' | 'disabled';

/** Closed set - each value is a predicate that already exists in `brain.ts`. */
export type CardGateReason = 'knowledge' | 'song' | 'song_topic' | 'opinion';

export type CardGateSignal = {
  /** Predicates that matched this message. Empty when the turn is a plain ask. */
  reasons: CardGateReason[];
  /**
   * A predicate matched, but `isExplicitMusicRequest` kept the cards anyway -
   * «почему бы не поставить что-то бодрое?». A rise here is the signal that a
   * question-shaped predicate has grown too greedy.
   */
  released: boolean;
  /** How many verified cards the gate actually removed. */
  droppedCards: number;
};

export type AiModelProvider = 'deepseek' | 'openai';
export type ModelReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

// Server-only model config. `provider` is optional for backwards-compatible
// tests/config and defaults to DeepSeek; new runtime wiring always sets it.
export type AiModelConfig = {
  provider?: AiModelProvider;
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  model: string;
  maxOutputTokens: number;
  timeoutSec: number;
  reasoningEffort?: ModelReasoningEffort;
};

/** @deprecated Use AiModelConfig. Kept so downstream tests/config compile. */
export type DeepseekConfig = AiModelConfig;

export type AgentRunStatus = 'completed' | 'needs_input' | 'blocked' | 'failed';
export type AgentRoute = 'direct_action' | 'music_worker';

export type AgentToolTrace = {
  name: string;
  status: 'completed' | 'failed' | 'blocked';
  durationMs: number;
  error?: string;
};

export type AgentRunSummary = {
  runId: string;
  taskId: string;
  provider: AiModelProvider;
  model: string;
  status: AgentRunStatus;
  route: AgentRoute;
  steps: number;
  toolCalls: AgentToolTrace[];
  durationMs: number;
  verifierPassed: boolean;
  warnings: string[];
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
  model: AiModelConfig;
  tools: ToolProvider;
  musicServices: MusicService[];
  // Optional web-search provider — when present, web_search_factual is offered
  // to the planner; when undefined, web search is OFF (default).
  webSearch?: WebSearchProvider;
  fetch: typeof fetch;
  log: (message: string) => void;
  now: () => number;
  signal?: AbortSignal;
  safetyIdentifier?: string;
};

export type ToolServicesConfig = {
  // Which external music services to surface (env AI_MUSIC_SERVICES); ordered.
  musicServices: MusicService[];
};

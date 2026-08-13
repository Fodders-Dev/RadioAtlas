import { randomUUID } from 'node:crypto';
import { applyAssistantActionPolicy, verifyAgentResult } from './agentPolicy.js';
import { chatWithAssistant } from './brain.js';
import { buildFallbackResult } from './fallbacks.js';
import type {
  AgentRoute,
  AgentRunStatus,
  AgentRunSummary,
  AgentToolTrace,
  AssistantAction,
  AssistantDeps,
  ChatInput,
  ChatResult,
  ToolProvider,
  WebSearchProvider
} from './types.js';

export type AgentTask = {
  taskId: string;
  goal: string;
  context: {
    surface: ChatInput['surface'];
    locale?: string;
    hasCurrentStation: boolean;
    hasCurrentTrack: boolean;
  };
  constraints: string[];
  acceptanceCriteria: string[];
  allowedTools: string[];
};

export const AGENT_LIMITS = {
  maxSteps: 4,
  maxToolCalls: 6,
  maxRuntimeMs: 18_000,
  maxRetries: 1
} as const;

type DirectActionIntent =
  | { kind: 'pause' }
  | { kind: 'enqueue' }
  | { kind: 'set-favorite'; desired: boolean };

const PAUSE_INTENT =
  /(^|\s)(пауз[ауые]?|приостанови|останови\s+(?:музык|радио|воспроизвед)|выключи\s+(?:музык|радио)|pause|stop\s+(?:music|radio|playback))($|[\s!?.,])/i;
const ENQUEUE_INTENT =
  /(добав|постав|закин|отправ).{0,32}(очеред)|(?:add|put|send).{0,32}\bqueue\b|\bqueue\s+(?:this|current)\b/i;
const FAVORITE_ADD_INTENT =
  /(добав|сохран|полож).{0,32}(избран|любим)|(?:add|save).{0,32}\bfavou?rites?\b|\bfavou?rite.{0,16}\b(?:this|current)\b/i;
const FAVORITE_REMOVE_INTENT =
  /(убер|удал|сним).{0,32}(избран|любим)|(?:remove|delete).{0,32}\bfavou?rites?\b|\bunfavou?rite\b/i;
const DISCOVERY_INTENT = /(подбер|посовет|порекоменд|найд|поищ|что[- ]?нибудь|что[- ]?то\s+послуша)/i;
const CURRENT_TARGET = /(эту|этой|текущ|сейчас|играет|слушаю|this|current|playing)/i;

export const classifyDirectActionIntent = (
  message: string,
  _hasCurrentStation: boolean
): DirectActionIntent | null => {
  const text = String(message || '').trim();
  if (!text) return null;
  if (/^(?:что|зачем|почему|what|why)(?:\s|$)/i.test(text) && /[?]$/.test(text)) return null;
  if (PAUSE_INTENT.test(text)) return { kind: 'pause' };

  const targetsCurrent = CURRENT_TARGET.test(text) || (!DISCOVERY_INTENT.test(text) && text.split(/\s+/).length <= 7);
  // Route an explicit command here even when there is no current station: the
  // deterministic worker then returns needs_input instead of asking the model
  // to improvise an impossible write.
  if (!targetsCurrent) return null;
  if (FAVORITE_REMOVE_INTENT.test(text)) return { kind: 'set-favorite', desired: false };
  if (FAVORITE_ADD_INTENT.test(text)) return { kind: 'set-favorite', desired: true };
  if (ENQUEUE_INTENT.test(text)) return { kind: 'enqueue' };
  return null;
};

export const normalizeAgentTask = (input: ChatInput): AgentTask => ({
  taskId: randomUUID(),
  goal: String(input.userMessage || '').trim().slice(0, 2_000),
  context: {
    surface: input.surface,
    locale: input.locale,
    hasCurrentStation: Boolean(input.nowPlaying?.stationUuid),
    hasCurrentTrack: Boolean(input.nowPlaying?.track)
  },
  constraints: [
    'Use only registered domain tools',
    'Never invent station identities or URLs',
    'Client writes must pass application policy',
    'Stop within configured runtime and tool limits'
  ],
  acceptanceCriteria: [
    'Return a non-empty user-facing reply',
    'Ground every station action in catalog or trusted playback context',
    'Return only schema-valid, policy-allowed actions'
  ],
  allowedTools: [
    'search_stations',
    'find_stations_by_artist',
    'get_station',
    'discover_trending',
    'music_service_search',
    'web_search_factual',
    'player_action'
  ]
});

class AgentLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentLimitError';
  }
}

const instrumentCall = async <T>(
  name: string,
  traces: AgentToolTrace[],
  call: () => Promise<T>
): Promise<T> => {
  if (traces.length >= AGENT_LIMITS.maxToolCalls) {
    throw new AgentLimitError('max_tool_calls_reached');
  }
  const startedAt = Date.now();
  try {
    const result = await call();
    traces.push({ name, status: 'completed', durationMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'tool_failed';
    traces.push({
      name,
      status: error instanceof AgentLimitError ? 'blocked' : 'failed',
      durationMs: Date.now() - startedAt,
      error: message
    });
    throw error;
  }
};

const instrumentTools = (
  tools: ToolProvider,
  traces: AgentToolTrace[]
): ToolProvider => ({
  searchStations: (args) =>
    instrumentCall('search_stations', traces, () => tools.searchStations(args)),
  getStation: (id) => instrumentCall('get_station', traces, () => tools.getStation(id)),
  discoverTrending: (seed) =>
    instrumentCall('discover_trending', traces, () => tools.discoverTrending(seed)),
  ...(tools.resolveArtistStation
    ? {
        resolveArtistStation: (hit) =>
          instrumentCall('find_stations_by_artist:curated', traces, () =>
            tools.resolveArtistStation!(hit)
          )
      }
    : {}),
  ...(tools.matchStationsByArtistName
    ? {
        matchStationsByArtistName: (artist) =>
          instrumentCall('find_stations_by_artist:name', traces, () =>
            tools.matchStationsByArtistName!(artist)
          )
      }
    : {})
});

const instrumentWebSearch = (
  webSearch: WebSearchProvider | undefined,
  traces: AgentToolTrace[]
): WebSearchProvider | undefined =>
  webSearch
    ? {
        search: (query, options) =>
          instrumentCall('web_search_factual', traces, () =>
            webSearch.search(query, options)
          )
      }
    : undefined;

const directActionReply = (
  input: ChatInput,
  action: DirectActionIntent,
  stationName?: string
) => {
  const english = /^en(?:-|$)/i.test(String(input.locale || ''));
  if (action.kind === 'pause') {
    if (input.agentContext?.isPlaying === false) {
      return english ? 'Playback is already paused.' : 'Уже на паузе.';
    }
    return english ? 'Paused.' : 'Поставила на паузу.';
  }
  if (action.kind === 'enqueue') {
    return english
      ? `Added “${stationName || 'this station'}” to the queue.`
      : `Добавила «${stationName || 'эту станцию'}» в очередь.`;
  }
  if (action.desired) {
    return english
      ? `Saved “${stationName || 'this station'}” to favorites.`
      : `Добавила «${stationName || 'эту станцию'}» в избранное.`;
  }
  return english
    ? `Removed “${stationName || 'this station'}” from favorites.`
    : `Убрала «${stationName || 'эту станцию'}» из избранного.`;
};

const runDirectActionWorker = async (
  input: ChatInput,
  intent: DirectActionIntent,
  deps: AssistantDeps
): Promise<{ result: ChatResult; status: AgentRunStatus }> => {
  if (intent.kind === 'pause') {
    const alreadyPaused = input.agentContext?.isPlaying === false;
    return {
      result: {
        reply: directActionReply(input, intent),
        stations: [],
        serviceLinks: [],
        sources: [],
        actions: alreadyPaused ? [{ kind: 'none' }] : [{ kind: 'pause' }],
        usage: { prompt: 0, completion: 0 }
      },
      status: 'completed'
    };
  }

  const stationId = input.nowPlaying?.stationUuid;
  if (!stationId) {
    return {
      result: {
        reply: /^en(?:-|$)/i.test(String(input.locale || ''))
          ? 'Start a station first, then I can do that.'
          : 'Сначала включи станцию — тогда я смогу это сделать.',
        stations: [],
        serviceLinks: [],
        sources: [],
        actions: [{ kind: 'none' }],
        usage: { prompt: 0, completion: 0 }
      },
      status: 'needs_input'
    };
  }

  const station = await deps.tools.getStation(stationId).catch(() => null);
  if (!station) {
    return {
      result: {
        reply: /^en(?:-|$)/i.test(String(input.locale || ''))
          ? "I couldn't verify this station, so I didn't change anything."
          : 'Не смогла проверить эту станцию, поэтому ничего не меняла.',
        stations: [],
        serviceLinks: [],
        sources: [],
        actions: [{ kind: 'none' }],
        usage: { prompt: 0, completion: 0 }
      },
      status: 'failed'
    };
  }

  if (
    intent.kind === 'enqueue' &&
    input.agentContext?.queueStationIds?.includes(station.stationuuid)
  ) {
    return {
      result: {
        reply: /^en(?:-|$)/i.test(String(input.locale || ''))
          ? `“${station.name}” is already in the queue.`
          : `«${station.name}» уже есть в очереди.`,
        stations: [station],
        serviceLinks: [],
        sources: [],
        actions: [{ kind: 'none' }],
        usage: { prompt: 0, completion: 0 }
      },
      status: 'completed'
    };
  }

  if (intent.kind === 'set-favorite') {
    const favorite = Boolean(
      input.userTaste?.favoriteStationIds?.includes(station.stationuuid)
    );
    if (favorite === intent.desired) {
      return {
        result: {
          reply: intent.desired
            ? `«${station.name}» уже в избранном.`
            : `«${station.name}» уже не в избранном.`,
          stations: [station],
          serviceLinks: [],
          sources: [],
          actions: [{ kind: 'none' }],
          usage: { prompt: 0, completion: 0 }
        },
        status: 'completed'
      };
    }
  }

  const action: AssistantAction =
    intent.kind === 'enqueue'
      ? { kind: 'enqueue', stationuuid: station.stationuuid }
      : {
          kind: 'set-favorite',
          stationuuid: station.stationuuid,
          desired: intent.desired
        };
  return {
    result: {
      reply: directActionReply(input, intent, station.name),
      stations: [station],
      serviceLinks: [],
      sources: [],
      actions: [action],
      usage: { prompt: 0, completion: 0 }
    },
    status: 'completed'
  };
};

export const runLiraAgent = async (
  input: ChatInput,
  baseDeps: AssistantDeps
): Promise<ChatResult> => {
  const startedAt = Date.now();
  const runId = randomUUID();
  const task = normalizeAgentTask(input);
  const toolCalls: AgentToolTrace[] = [];
  const warnings: string[] = [];
  let steps = 1;
  const directIntent = input.surface === 'miniapp'
    ? classifyDirectActionIntent(
        input.userMessage,
        Boolean(input.nowPlaying?.stationUuid)
      )
    : null;
  const route: AgentRoute = directIntent ? 'direct_action' : 'music_worker';
  steps += 1;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new AgentLimitError('max_runtime_reached')),
    AGENT_LIMITS.maxRuntimeMs
  );
  const deps: AssistantDeps = {
    ...baseDeps,
    tools: instrumentTools(baseDeps.tools, toolCalls),
    webSearch: instrumentWebSearch(baseDeps.webSearch, toolCalls),
    signal: controller.signal,
    safetyIdentifier: input.safetyIdentifier
  };

  let status: AgentRunStatus = 'completed';
  let workerResult: ChatResult;
  try {
    steps += 1;
    if (directIntent) {
      const direct = await runDirectActionWorker(input, directIntent, deps);
      workerResult = direct.result;
      status = direct.status;
    } else {
      workerResult = await chatWithAssistant(input, deps);
    }
  } catch (error) {
    status = error instanceof AgentLimitError ? 'blocked' : 'failed';
    warnings.push(error instanceof Error ? error.message : 'worker_failed');
    workerResult = buildFallbackResult({
      surface: input.surface,
      now: baseDeps.now(),
      reason: status === 'blocked' ? 'capped' : 'compose-error'
    });
  } finally {
    clearTimeout(timeout);
  }

  if (controller.signal.aborted) {
    status = 'blocked';
    warnings.push('max_runtime_reached');
  }
  if (toolCalls.length >= AGENT_LIMITS.maxToolCalls) {
    warnings.push('max_tool_calls_reached');
  }

  const policy = applyAssistantActionPolicy(
    workerResult.actions,
    workerResult,
    input,
    runId
  );
  warnings.push(...policy.warnings);
  let policyResult: ChatResult = { ...workerResult, actions: policy.actions };
  steps += 1;
  const verification = verifyAgentResult(policyResult, input);
  if (!verification.passed) {
    status = 'failed';
    warnings.push(...verification.errors);
    policyResult = {
      ...buildFallbackResult({
        surface: input.surface,
        now: baseDeps.now(),
        reason: 'compose-error'
      }),
      usage: workerResult.usage
    };
  }

  const agentRun: AgentRunSummary = {
    runId,
    taskId: task.taskId,
    provider: baseDeps.model.provider || 'deepseek',
    model: baseDeps.model.model,
    status,
    route,
    steps: Math.min(steps, AGENT_LIMITS.maxSteps),
    toolCalls,
    durationMs: Date.now() - startedAt,
    verifierPassed: verification.passed,
    warnings: [...new Set(warnings)].slice(0, 12)
  };
  baseDeps.log(`agent_run ${JSON.stringify(agentRun)}`);
  return { ...policyResult, agentRun };
};

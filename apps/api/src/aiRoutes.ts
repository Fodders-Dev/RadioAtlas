// Mini App AI surface (in-process). POST /ai/chat runs the shared brain against
// the warm in-process catalog and returns the abstract { reply, stations,
// serviceLinks, actions } for the client to render. Provider keys live only
// in the runtime built here — it never reaches a client.
//
// createAssistantRuntime owns the ai-chat ProtectedMediaRoute guard (concurrency
// + the shared pool) AND a global rolling volume cap, so BOTH surfaces (Mini App
// /ai/chat and the internal bot endpoint) share one cost backstop and identical
// concurrency. The per-IP rate limit (429) stays at the HTTP layer via
// runtime.checkRateLimit so it can pre-empt the model call cheaply.

import type express from 'express';
import { runLiraAgent } from './ai/agentRunner.js';
import {
  createCatalogToolProvider,
  type CatalogServiceLike
} from './ai/catalogToolProvider.js';
import { buildFallbackResult } from './ai/fallbacks.js';
import { publicWebSources } from './ai/publicSources.js';
import { createRollingVolumeCap } from './ai/volumeCap.js';
import type {
  AssistantDeps,
  AgentClientContext,
  AiModelConfig,
  ChatInput,
  ChatResult,
  ChatTurn,
  ClientActionReceipt,
  DeepseekConfig,
  MusicService,
  NowPlayingContext,
  UserTasteContext,
  WebSearchProvider
} from './ai/types.js';
import { MediaOverloadError, ProtectedMediaRoute } from './media/protection.js';
import { appendAgentRun, appendAlert, bumpCounter, setGauge } from './observabilityStore.js';

const MAX_MESSAGE_CHARS = 2000;
const MAX_HISTORY_TURNS = 10;
const VOLUME_WINDOW_MS = 60_000;
const DEFAULT_MAX_CHATS_PER_WINDOW = 120;

export type AssistantRuntime = {
  chat: (input: ChatInput) => Promise<ChatResult>;
  checkRateLimit: (req: express.Request) => number | null;
};

export const createAssistantRuntime = (options: {
  catalog: CatalogServiceLike;
  model?: AiModelConfig;
  /** @deprecated Pass model instead. */
  deepseek?: DeepseekConfig;
  musicServices: MusicService[];
  // Optional Tavily-backed web search — omit to keep web search OFF (default).
  webSearch?: WebSearchProvider;
  maxChatsPerWindow?: number;
  now?: () => number;
  // Injectable for tests (mirrors the brain's DI'd fetch); defaults to global.
  fetch?: typeof fetch;
  log?: (message: string) => void;
}): AssistantRuntime => {
  const now = options.now || (() => Date.now());
  const model = options.model || options.deepseek;
  if (!model) throw new Error('assistant model config is required');
  const deps: AssistantDeps = {
    model,
    tools: createCatalogToolProvider(options.catalog),
    musicServices: options.musicServices,
    webSearch: options.webSearch,
    fetch: options.fetch || globalThis.fetch.bind(globalThis),
    log: options.log || (() => {}),
    now
  };
  const guard = new ProtectedMediaRoute<ChatResult>({
    routeName: 'ai-chat',
    maxConcurrency: 4,
    // Join the shared media pool so a burst of (slow) chats can't starve
    // /stream and /image, and vice-versa.
    sharedMaxConcurrency: 8,
    rateLimitPerWindow: 30,
    rateLimitWindowMs: VOLUME_WINDOW_MS
  });
  const volumeCap = createRollingVolumeCap({
    windowMs: VOLUME_WINDOW_MS,
    max: options.maxChatsPerWindow ?? DEFAULT_MAX_CHATS_PER_WINDOW,
    now
  });

  const chat = async (input: ChatInput): Promise<ChatResult> => {
    // Global cost backstop: over the per-window total → warm fallback, no
    // model call (this defeats the rotate-real-IPs flood the per-IP limiter
    // can't see).
    if (volumeCap.exceeded()) {
      bumpCounter('ai_chat_volume_capped');
      return buildFallbackResult({ surface: input.surface, now: now(), reason: 'capped' });
    }
    try {
      return await guard.run(null, () => runLiraAgent(input, deps));
    } catch (err) {
      // Concurrency overload is a capacity signal, not an error — degrade to a
      // warm fallback (200) rather than throwing, so both surfaces stay graceful.
      if (err instanceof MediaOverloadError) {
        bumpCounter('ai_chat_overload');
        return buildFallbackResult({ surface: input.surface, now: now(), reason: 'capped' });
      }
      throw err;
    }
  };

  return { chat, checkRateLimit: (req) => guard.checkRateLimit(req) };
};

// Shared history coercion (the internal bot endpoint reuses it).
export const parseChatHistory = (raw: unknown): ChatTurn[] => {
  if (!Array.isArray(raw)) return [];
  const turns: ChatTurn[] = [];
  for (const item of raw) {
    const role = (item as { role?: unknown })?.role;
    const text = (item as { text?: unknown })?.text;
    if ((role === 'user' || role === 'assistant') && typeof text === 'string' && text.trim()) {
      turns.push({ role, text: text.trim().slice(0, MAX_MESSAGE_CHARS) });
    }
  }
  return turns.slice(-MAX_HISTORY_TURNS);
};

const MAX_TRACK_CHARS = 180;
const MAX_STATION_NAME_CHARS = 120;

const parsePlaybackLabel = (raw: unknown, maxChars: number): string => {
  if (typeof raw !== 'string') return '';
  const value = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (value.length < 2) return '';
  return value.slice(0, maxChars);
};

export const parseNowPlayingContext = (raw: unknown): NowPlayingContext | undefined => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const track = parsePlaybackLabel(value.track, MAX_TRACK_CHARS);
  const stationName = parsePlaybackLabel(value.stationName, MAX_STATION_NAME_CHARS);
  // Shape-checked, not trusted: it is only ever used as a catalogue lookup key,
  // and a miss simply means the assistant answers without station facts.
  const rawUuid = typeof value.stationUuid === 'string' ? value.stationUuid.trim() : '';
  const stationUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawUuid)
    ? rawUuid.toLowerCase()
    : undefined;
  if (!track && !stationName && !stationUuid) return undefined;
  return {
    ...(track ? { track } : {}),
    ...(stationName ? { stationName } : {}),
    ...(stationUuid ? { stationUuid } : {})
  };
};

const MAX_TASTE_IDS = 80;
const MAX_TASTE_SCORES = 32;

const normalizeTasteLabel = (value: unknown) =>
  String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();

const parseTasteIds = (raw: unknown, limit = MAX_TASTE_IDS): string[] => {
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0)
    )
  ).slice(0, limit);
};

const parseTasteScoreMap = (raw: unknown): Record<string, number> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .map(([key, value]) => {
        const label = normalizeTasteLabel(key);
        const score = Number(value);
        if (!label || !Number.isFinite(score) || Math.abs(score) < 0.05) return null;
        return [label, Math.max(-40, Math.min(40, Number(score.toFixed(4))))] as const;
      })
      .filter((entry): entry is readonly [string, number] => entry !== null)
      .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]) || left[0].localeCompare(right[0]))
      .slice(0, MAX_TASTE_SCORES)
  );
};

const parseStationScoreMap = (raw: unknown): Record<string, number> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .map(([key, value]) => {
        const stationId = key.trim();
        const score = Number(value);
        if (!stationId || !Number.isFinite(score) || Math.abs(score) < 0.05) return null;
        return [stationId, Math.max(-40, Math.min(40, Number(score.toFixed(4))))] as const;
      })
      .filter((entry): entry is readonly [string, number] => entry !== null)
      .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]) || left[0].localeCompare(right[0]))
      .slice(0, MAX_TASTE_SCORES)
  );
};

export const parseUserTasteContext = (raw: unknown): UserTasteContext | undefined => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const favoriteStationIds = parseTasteIds(value.favoriteStationIds);
  const recentStationIds = parseTasteIds(value.recentStationIds);
  const hiddenStationIds = parseTasteIds(value.hiddenStationIds);
  const negativeStationIds = parseTasteIds(value.negativeStationIds);
  const lastRecommendedStationIds = parseTasteIds(value.lastRecommendedStationIds);
  const stationScores = parseStationScoreMap(value.stationScores);
  const tagScores = parseTasteScoreMap(value.tagScores);
  const countryScores = parseTasteScoreMap(value.countryScores);
  const languageScores = parseTasteScoreMap(value.languageScores);
  if (
    !favoriteStationIds.length &&
    !recentStationIds.length &&
    !hiddenStationIds.length &&
    !negativeStationIds.length &&
    !lastRecommendedStationIds.length &&
    !Object.keys(stationScores).length &&
    !Object.keys(tagScores).length &&
    !Object.keys(countryScores).length &&
    !Object.keys(languageScores).length
  ) {
    return undefined;
  }
  return {
    favoriteStationIds,
    recentStationIds,
    hiddenStationIds,
    negativeStationIds,
    lastRecommendedStationIds,
    stationScores,
    tagScores,
    countryScores,
    languageScores
  };
};

const ACTION_KINDS = new Set<ClientActionReceipt['kind']>([
  'play',
  'open-station',
  'enqueue',
  'set-favorite',
  'pause',
  'none'
]);
const ACTION_STATUSES = new Set<ClientActionReceipt['status']>([
  'executed',
  'skipped',
  'failed'
]);

export const parseAgentClientContext = (raw: unknown): AgentClientContext | undefined => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const queueStationIds = parseTasteIds(value.queueStationIds, 80);
  const isPlaying = typeof value.isPlaying === 'boolean' ? value.isPlaying : undefined;
  if (isPlaying === undefined && queueStationIds.length === 0) return undefined;
  return {
    ...(isPlaying === undefined ? {} : { isPlaying }),
    ...(queueStationIds.length ? { queueStationIds } : {})
  };
};

export const parseActionReceipts = (raw: unknown): ClientActionReceipt[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): ClientActionReceipt | null => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const value = item as Record<string, unknown>;
      const rawActionId = typeof value.actionId === 'string' ? value.actionId.trim().slice(0, 160) : '';
      const actionId = /^[a-zA-Z0-9._:-]{1,160}$/.test(rawActionId) ? rawActionId : '';
      const kind = value.kind as ClientActionReceipt['kind'];
      const status = value.status as ClientActionReceipt['status'];
      if (!actionId || !ACTION_KINDS.has(kind) || !ACTION_STATUSES.has(status)) return null;
      const rawStationId = typeof value.stationuuid === 'string'
        ? value.stationuuid.trim().slice(0, 160)
        : '';
      const stationuuid = /^[a-zA-Z0-9._:-]{1,160}$/.test(rawStationId) ? rawStationId : undefined;
      return { actionId, kind, status, ...(stationuuid ? { stationuuid } : {}) };
    })
    .filter((item): item is ClientActionReceipt => item !== null)
    .slice(-6);
};

export const parseSafetyIdentifier = (raw: unknown): string | undefined => {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  return /^[a-zA-Z0-9._:-]{8,128}$/.test(value) ? value : undefined;
};

// One alert per provider+kind per window. Without this, a dead provider would
// push an alert on every single turn and bury the 40-entry alert ring (and the
// webhook) under identical lines.
const MODEL_ERROR_ALERT_WINDOW_MS = 15 * 60_000;
const lastModelErrorAlertAt = new Map<string, number>();

export const shouldAlertModelError = (
  key: string,
  now: number,
  windowMs = MODEL_ERROR_ALERT_WINDOW_MS
) => {
  const previous = lastModelErrorAlertAt.get(key);
  if (previous !== undefined && now - previous < windowMs) return false;
  lastModelErrorAlertAt.set(key, now);
  return true;
};

export const recordChatTelemetry = (
  surface: 'miniapp' | 'telegram',
  startedAt: number,
  result: ChatResult
) => {
  bumpCounter('ai_chat_request');
  bumpCounter(`ai_chat_request:${surface}`);
  setGauge('ai_chat_latency_ms', Date.now() - startedAt);
  if (result.usage) {
    bumpCounter('ai_chat_tokens_prompt', result.usage.prompt);
    bumpCounter('ai_chat_tokens_completion', result.usage.completion);
  }
  const modelErrors = result.modelErrors || [];
  if (modelErrors.length) {
    const provider = result.agentRun?.provider || 'unknown';
    const model = result.agentRun?.model || 'unknown';
    const now = Date.now();
    bumpCounter('ai_model_error');
    modelErrors.forEach((kind) => {
      bumpCounter(`ai_model_error:${provider}:${kind}`);
      // `billing` and `auth` do not recover on their own — a human has to top
      // up or rotate a key, so those are the ones worth waking someone for.
      if (kind !== 'billing' && kind !== 'auth') return;
      if (!shouldAlertModelError(`${provider}:${kind}`, now)) return;
      appendAlert({
        kind: 'server-error',
        title: `ai_model_error:${kind}`,
        detail: `Lira provider ${provider} (${model}) is failing with "${kind}"; replies are deterministic fallbacks until it is fixed.`,
        ts: now
      });
    });
  }
  if (result.agentRun) {
    bumpCounter(`ai_agent_run:${result.agentRun.status}`);
    bumpCounter(`ai_agent_route:${result.agentRun.route}`);
    setGauge('ai_agent_steps', result.agentRun.steps);
    setGauge('ai_agent_tool_calls', result.agentRun.toolCalls.length);
    appendAgentRun({
      ...result.agentRun,
      surface,
      promptTokens: result.usage?.prompt || 0,
      completionTokens: result.usage?.completion || 0,
      ts: Date.now()
    });
  }
};

export const registerAiRoutes = (
  app: express.Express,
  options: { runtime: AssistantRuntime }
) => {
  app.post('/ai/chat', async (req, res) => {
    const retryAfter = options.runtime.checkRateLimit(req);
    if (retryAfter !== null) {
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ error: 'ai chat rate limit exceeded' });
      return;
    }

    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const locale = typeof req.body?.locale === 'string' ? req.body.locale : undefined;
    const history = parseChatHistory(req.body?.history);
    const startedAt = Date.now();

    try {
      // runtime.chat already applies the volume cap + concurrency guard and
      // degrades capacity overloads to a warm fallback, so the route only
      // handles genuine failures.
      const result = await options.runtime.chat({
        userMessage: message.slice(0, MAX_MESSAGE_CHARS),
        history,
        surface: 'miniapp',
        locale,
        userTaste: parseUserTasteContext(req.body?.userTaste),
        nowPlaying: parseNowPlayingContext(req.body?.nowPlaying),
        agentContext: parseAgentClientContext(req.body?.agentContext),
        actionReceipts: parseActionReceipts(req.body?.actionReceipts),
        safetyIdentifier: parseSafetyIdentifier(req.body?.safetyIdentifier)
      });
      recordChatTelemetry('miniapp', startedAt, result);
      res.json({
        reply: result.reply,
        stations: result.stations,
        serviceLinks: result.serviceLinks,
        // Snippets/raw page content are private grounding context. Never send
        // them to the browser; the UI only needs attribution metadata.
        sources: publicWebSources(result.sources),
        actions: result.actions,
        run: result.agentRun
          ? {
              runId: result.agentRun.runId,
              status: result.agentRun.status,
              route: result.agentRun.route
            }
          : undefined
      });
    } catch {
      bumpCounter('ai_chat_error');
      res.status(500).json({ error: 'chat failed' });
    }
  });
};

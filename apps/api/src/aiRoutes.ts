// Mini App AI surface (in-process). POST /ai/chat runs the shared brain against
// the warm in-process catalog and returns the abstract { reply, stations,
// serviceLinks, actions } for the client to render. The DeepSeek key lives only
// in the runtime built here — it never reaches a client.
//
// createAssistantRuntime owns the ai-chat ProtectedMediaRoute guard (concurrency
// + the shared pool) AND a global rolling volume cap, so BOTH surfaces (Mini App
// /ai/chat and the internal bot endpoint) share one cost backstop and identical
// concurrency. The per-IP rate limit (429) stays at the HTTP layer via
// runtime.checkRateLimit so it can pre-empt the DeepSeek call cheaply.

import type express from 'express';
import { chatWithAssistant } from './ai/brain.js';
import {
  createCatalogToolProvider,
  type CatalogServiceLike
} from './ai/catalogToolProvider.js';
import { buildFallbackResult } from './ai/fallbacks.js';
import { createRollingVolumeCap } from './ai/volumeCap.js';
import type {
  AssistantDeps,
  ChatInput,
  ChatResult,
  ChatTurn,
  DeepseekConfig,
  MusicService
} from './ai/types.js';
import { MediaOverloadError, ProtectedMediaRoute } from './media/protection.js';
import { bumpCounter, setGauge } from './observabilityStore.js';

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
  deepseek: DeepseekConfig;
  musicServices: MusicService[];
  maxChatsPerWindow?: number;
  now?: () => number;
  log?: (message: string) => void;
}): AssistantRuntime => {
  const now = options.now || (() => Date.now());
  const deps: AssistantDeps = {
    deepseek: options.deepseek,
    tools: createCatalogToolProvider(options.catalog),
    musicServices: options.musicServices,
    fetch: globalThis.fetch.bind(globalThis),
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
    // DeepSeek call (this defeats the rotate-real-IPs flood the per-IP limiter
    // can't see).
    if (volumeCap.exceeded()) {
      bumpCounter('ai_chat_volume_capped');
      return buildFallbackResult({ surface: input.surface, now: now(), reason: 'capped' });
    }
    try {
      return await guard.run(null, () => chatWithAssistant(input, deps));
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
        locale
      });
      recordChatTelemetry('miniapp', startedAt, result);
      res.json({
        reply: result.reply,
        stations: result.stations,
        serviceLinks: result.serviceLinks,
        actions: result.actions
      });
    } catch {
      bumpCounter('ai_chat_error');
      res.status(500).json({ error: 'chat failed' });
    }
  });
};

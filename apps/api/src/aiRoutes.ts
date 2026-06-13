// Mini App AI surface (in-process). POST /ai/chat resolves the optional session
// account, runs the shared brain against the warm in-process catalog, and
// returns the abstract { reply, stations, serviceLinks, actions } for the client
// to render. The DeepSeek key lives only in the runtime built here — it never
// reaches a client. createAssistantRuntime is also reused by the internal bot
// endpoint (registerBotRoutes), so the brain is authored once and behaves
// identically on both surfaces.

import type express from 'express';
import { getAccountByToken } from './accountStore.js';
import { chatWithAssistant } from './ai/brain.js';
import {
  createCatalogToolProvider,
  type CatalogServiceLike
} from './ai/catalogToolProvider.js';
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
import { getBearerToken } from './routeSupport.js';

const MAX_MESSAGE_CHARS = 2000;
const MAX_HISTORY_TURNS = 10;

export type AssistantRuntime = {
  chat: (input: ChatInput) => Promise<ChatResult>;
};

export const createAssistantRuntime = (options: {
  catalog: CatalogServiceLike;
  deepseek: DeepseekConfig;
  musicServices: MusicService[];
  log?: (message: string) => void;
}): AssistantRuntime => {
  const deps: AssistantDeps = {
    deepseek: options.deepseek,
    tools: createCatalogToolProvider(options.catalog),
    musicServices: options.musicServices,
    fetch: globalThis.fetch.bind(globalThis),
    log: options.log || (() => {}),
    now: () => Date.now()
  };
  return { chat: (input) => chatWithAssistant(input, deps) };
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
  const guard = new ProtectedMediaRoute<ChatResult>({
    routeName: 'ai-chat',
    maxConcurrency: 4,
    // Join the shared media pool so a burst of (slow) chats can't starve
    // /stream and /image, and vice-versa.
    sharedMaxConcurrency: 8,
    rateLimitPerWindow: 30,
    rateLimitWindowMs: 60_000
  });

  app.post('/ai/chat', async (req, res) => {
    const retryAfter = guard.checkRateLimit(req);
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

    const token = getBearerToken(req);
    const account = token ? await getAccountByToken(token).catch(() => null) : null;
    const locale = typeof req.body?.locale === 'string' ? req.body.locale : undefined;
    const history = parseChatHistory(req.body?.history);
    const startedAt = Date.now();

    try {
      const result = await guard.run(null, () =>
        options.runtime.chat({
          userMessage: message.slice(0, MAX_MESSAGE_CHARS),
          history,
          surface: 'miniapp',
          locale,
          userId: account?.id
        })
      );
      recordChatTelemetry('miniapp', startedAt, result);
      res.json({
        reply: result.reply,
        stations: result.stations,
        serviceLinks: result.serviceLinks,
        actions: result.actions
      });
    } catch (err) {
      if (err instanceof MediaOverloadError) {
        res.setHeader('Retry-After', String(err.retryAfterSec));
        res.status(429).json({ error: 'assistant is busy' });
        return;
      }
      bumpCounter('ai_chat_error');
      res.status(500).json({ error: 'chat failed' });
    }
  });
};

// «Лира» AI companion — Telegram glue (pure, DI'd fetch like inlineQuery.ts /
// recordStream.ts). The bot NEVER imports the brain and NEVER holds the DeepSeek
// key: it forwards the user's text to the api's internal endpoint behind the
// X-Internal-Token, then renders the abstract result as a message + inline
// keyboard. The grammy wiring (typing action, per-user limiter, ctx.reply) lives
// in index.ts.

export type AiChatStation = {
  stationuuid: string;
  name: string;
  country?: string | null;
};

export type AiServiceLink = {
  service: string;
  label: string;
  url: string;
  query: string;
};

export type AiChatResult = {
  reply: string;
  stations: AiChatStation[];
  serviceLinks: AiServiceLink[];
};

export type AiChatDeps = {
  fetch: typeof fetch;
  apiUrl: string;
  internalWebhookToken: string;
};

export type AiChatHistoryTurn = { role: 'user' | 'assistant'; text: string };

export type AiChatInput = {
  telegramId: string | number;
  text: string;
  history?: AiChatHistoryTurn[];
};

// Warm fallback shown whenever the round-trip fails (no apiUrl/token, network
// error, non-2xx, bad shape) — never a raw error.
export const AI_FALLBACK_TEXT =
  'Ой, я на секунду потеряла нить — напиши ещё разок чуть позже, и я подберу тебе что-нибудь тёплое под настроение.';

export const stationDeepLink = (username: string, stationId: string) =>
  `https://t.me/${username}?startapp=station_${stationId}`;

// v1: private chats only, real text, not a command, bounded length.
export const isAiEligibleMessage = (input: {
  text: string | undefined;
  chatType: string | undefined;
}): boolean => {
  if (input.chatType !== 'private') return false;
  const text = (input.text || '').trim();
  if (!text || text.startsWith('/')) return false;
  if (text.length > 1000) return false;
  return true;
};

export type AiLimiterVerdict = 'ok' | 'busy' | 'flood';

export type AiLimiter = {
  // 'busy' = one already in flight for this user (or the global cap is hit);
  // 'flood' = too many in the rolling window; 'ok' = accept (records a hit).
  verdict: (userId: string) => AiLimiterVerdict;
  acquire: (userId: string) => void;
  release: (userId: string) => void;
  // Number of tracked rolling-window buckets (for the prune-on-empty test).
  size: () => number;
};

// Per-user in-memory limiter (DI'd `now` for tests). The rolling-window Map is
// pruned-on-empty every verdict so one-off users can't grow it without limit
// (the recordStream limiter does the same on release).
export const createAiLimiter = (options: {
  windowMs: number;
  maxPerWindow: number;
  maxInflight: number;
  now: () => number;
}): AiLimiter => {
  const inflight = new Set<string>();
  const hits = new Map<string, number[]>();
  let globalInflight = 0;

  const prune = (t: number) => {
    for (const [id, stamps] of hits) {
      const live = stamps.filter((ts) => t - ts < options.windowMs);
      if (live.length === 0) hits.delete(id);
      else if (live.length !== stamps.length) hits.set(id, live);
    }
  };

  return {
    verdict: (userId) => {
      if (inflight.has(userId) || globalInflight >= options.maxInflight) return 'busy';
      const t = options.now();
      prune(t);
      const recent = hits.get(userId) ?? [];
      if (recent.length >= options.maxPerWindow) return 'flood';
      recent.push(t);
      hits.set(userId, recent);
      return 'ok';
    },
    acquire: (userId) => {
      inflight.add(userId);
      globalInflight += 1;
    },
    release: (userId) => {
      inflight.delete(userId);
      globalInflight = Math.max(0, globalInflight - 1);
    },
    size: () => hits.size
  };
};

export const requestAiChat = async (
  input: AiChatInput,
  deps: AiChatDeps
): Promise<AiChatResult | null> => {
  if (!deps.apiUrl || !deps.internalWebhookToken) return null;
  try {
    const response = await deps.fetch(`${deps.apiUrl}/internal/bot/ai-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': deps.internalWebhookToken
      },
      body: JSON.stringify({
        telegramId: String(input.telegramId),
        text: input.text,
        history: input.history || []
      })
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<AiChatResult> | null;
    if (!body || typeof body.reply !== 'string') return null;
    return {
      reply: body.reply,
      stations: Array.isArray(body.stations) ? body.stations : [],
      serviceLinks: Array.isArray(body.serviceLinks) ? body.serviceLinks : []
    };
  } catch {
    return null;
  }
};

// Pure keyboard layout: one row per station (deep link opens the Mini App and
// autoplays via parseStationParam), service links two-per-row. Returns
// {text,url}[][] so it unit-tests without grammy.
export const buildAiButtons = (
  result: AiChatResult,
  username: string
): Array<Array<{ text: string; url: string }>> => {
  const rows: Array<Array<{ text: string; url: string }>> = [];
  if (username) {
    for (const station of result.stations.slice(0, 5)) {
      if (!station?.stationuuid || !station.name) continue;
      rows.push([{ text: `▶ ${station.name}`, url: stationDeepLink(username, station.stationuuid) }]);
    }
  }
  let pending: Array<{ text: string; url: string }> = [];
  for (const link of result.serviceLinks) {
    if (!link?.url || !link.label) continue;
    pending.push({ text: link.label, url: link.url });
    if (pending.length === 2) {
      rows.push(pending);
      pending = [];
    }
  }
  if (pending.length) rows.push(pending);
  return rows;
};

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

export type AiSource = {
  title: string;
  url: string;
};

export type AiChatResult = {
  reply: string;
  stations: AiChatStation[];
  serviceLinks: AiServiceLink[];
  sources: AiSource[];
  provider?: { name: 'gpt-6-luna' | 'deepseek'; fallback: boolean };
  providerFallback?: { token: string; reason: 'unavailable' | 'budget'; provider: 'deepseek' };
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
  fallbackToken?: string;
};

export const AI_FALLBACK_OFFER_PREFIX = 'lira_ds:';
export type AiFallbackOffer = {
  callbackData: string;
  token: string;
  userId: string;
  chatId: string;
  input: Omit<AiChatInput, 'fallbackToken'>;
  generation: string;
  createdAt: number;
};

/** Bounded, expiring, one-use in-memory offers. The opaque callback id never
 * contains the API ticket and consumption binds it to the original private chat. */
export const createAiFallbackOffers = (options: {
  now: () => number;
  makeId: () => string;
  ttlMs?: number;
  maxOffers?: number;
  maxUsers?: number;
}) => {
  const ttlMs = options.ttlMs ?? 5 * 60_000;
  const maxOffers = Math.max(1, options.maxOffers ?? 2000);
  const maxUsers = Math.max(1, options.maxUsers ?? 5000);
  const offers = new Map<string, AiFallbackOffer>();
  const generations = new Map<string, { value: string; touchedAt: number }>();
  const pruneGenerations = () => {
    while (generations.size > maxUsers) {
      const oldest = [...generations.entries()].sort((a, b) => a[1].touchedAt - b[1].touchedAt)[0]?.[0];
      if (!oldest) break;
      generations.delete(oldest);
    }
  };
  const currentGeneration = (userId: string) => {
    const entry = generations.get(userId);
    if (entry) entry.touchedAt = options.now();
    return entry?.value || '';
  };
  const isCurrent = (userId: string, generation: string) =>
    Boolean(generation) && currentGeneration(userId) === generation;
  const prune = () => {
    const now = options.now();
    for (const [id, offer] of offers) if (now - offer.createdAt >= ttlMs) offers.delete(id);
    while (offers.size >= maxOffers) offers.delete(offers.keys().next().value as string);
  };
  return {
    invalidateUser(userId: string) {
      if (!userId) return;
      generations.set(userId, { value: options.makeId(), touchedAt: options.now() });
      pruneGenerations();
      for (const [id, offer] of offers) if (offer.userId === userId) offers.delete(id);
    },
    isCurrent(userId: string, generation: string) {
      return isCurrent(userId, generation);
    },
    currentGeneration,
    create(input: Omit<AiChatInput, 'fallbackToken'>, token: string, userId: string, chatId: string, generation: string) {
      if (!token || !userId || !chatId || chatId !== userId || !isCurrent(userId, generation)) return null;
      prune();
      const id = options.makeId().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
      const callbackData = `${AI_FALLBACK_OFFER_PREFIX}${id}`;
      if (!id || callbackData.length > 64) return null;
      offers.set(id, {
        callbackData,
        token,
        userId,
        chatId,
        input: { ...input, history: (input.history || []).map((turn) => ({ ...turn })) },
        generation,
        createdAt: options.now()
      });
      return callbackData;
    },
    consume(callbackData: string, userId: string, chatId: string) {
      prune();
      if (!callbackData.startsWith(AI_FALLBACK_OFFER_PREFIX)) return null;
      const id = callbackData.slice(AI_FALLBACK_OFFER_PREFIX.length);
      const offer = offers.get(id);
      if (!offer || offer.callbackData !== callbackData || offer.userId !== userId || offer.chatId !== chatId || chatId !== userId || !isCurrent(userId, offer.generation)) return null;
      offers.delete(id);
      return { ...offer, input: { ...offer.input, history: (offer.input.history || []).map((turn) => ({ ...turn })) } };
    },
    remove(callbackData: string) {
      if (callbackData.startsWith(AI_FALLBACK_OFFER_PREFIX)) offers.delete(callbackData.slice(AI_FALLBACK_OFFER_PREFIX.length));
    },
    size: () => offers.size
  };
};

/** Shared callback path: consume once, await user-visible callback handling,
 * revalidate, then make exactly one provider retry with the captured snapshot. */
export const runAiFallbackCallback = async (options: {
  offers: ReturnType<typeof createAiFallbackOffers>;
  callbackData: string;
  userId: string;
  chatId: string;
  beforeRequest: (offer: AiFallbackOffer) => Promise<boolean>;
  request: (input: AiChatInput) => Promise<AiChatResult | null>;
}): Promise<{ offer: AiFallbackOffer; result: AiChatResult | null } | null> => {
  const offer = options.offers.consume(options.callbackData, options.userId, options.chatId);
  if (!offer) return null;
  if (!await options.beforeRequest(offer)) return null;
  if (!options.offers.isCurrent(options.userId, offer.generation)) return null;
  const result = await options.request({ ...offer.input, fallbackToken: offer.token });
  if (!options.offers.isCurrent(options.userId, offer.generation)) return null;
  return { offer, result };
};

/** Store the one-use ticket only while the warning is actually deliverable. */
export const deliverAiFallbackOffer = async (options: {
  offers: ReturnType<typeof createAiFallbackOffers>;
  input: Omit<AiChatInput, 'fallbackToken'>;
  token: string;
  userId: string;
  chatId: string;
  generation: string;
  deliver: (callbackData: string) => Promise<void>;
}): Promise<string | null> => {
  const callbackData = options.offers.create(
    options.input, options.token, options.userId, options.chatId, options.generation
  );
  if (!callbackData) return null;
  try {
    await options.deliver(callbackData);
    if (!options.offers.isCurrent(options.userId, options.generation)) {
      options.offers.remove(callbackData);
      return null;
    }
    return callbackData;
  } catch (error) {
    options.offers.remove(callbackData);
    throw error;
  }
};

/** Write conversation history only after Telegram accepted the reply and the
 * originating user generation is still current. */
export const deliverAiChatReply = async (options: {
  isCurrent: () => boolean;
  deliver: () => Promise<void>;
  recordDeliveredReply: () => void;
}): Promise<boolean> => {
  if (!options.isCurrent()) return false;
  await options.deliver();
  if (!options.isCurrent()) return false;
  options.recordDeliveredReply();
  return true;
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
    const endpoint = `${deps.apiUrl}/internal/bot/ai-chat`;
    const payload = JSON.stringify({
      telegramId: String(input.telegramId),
      text: input.text,
      history: input.history || [],
      ...(input.fallbackToken ? { fallbackToken: input.fallbackToken } : {})
    });
    const init = (): RequestInit => ({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': deps.internalWebhookToken
      },
      body: payload
    });
    let response = await deps.fetch(endpoint, init());
    if (
      response.redirected &&
      response.url &&
      response.url !== endpoint &&
      (response.status === 404 || response.status === 405)
    ) {
      response = await deps.fetch(response.url, init());
    }
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<AiChatResult> | null;
    if (!body || typeof body.reply !== 'string') return null;
    return {
      reply: body.reply,
      stations: Array.isArray(body.stations) ? body.stations : [],
      serviceLinks: Array.isArray(body.serviceLinks) ? body.serviceLinks : [],
      sources: Array.isArray(body.sources) ? body.sources : [],
      provider: body.provider?.name === 'gpt-6-luna' || body.provider?.name === 'deepseek'
        ? { name: body.provider.name, fallback: body.provider.fallback === true }
        : undefined,
      providerFallback: body.providerFallback && typeof body.providerFallback.token === 'string' &&
        (body.providerFallback.reason === 'unavailable' || body.providerFallback.reason === 'budget') &&
        body.providerFallback.provider === 'deepseek'
        ? { token: body.providerFallback.token, reason: body.providerFallback.reason, provider: 'deepseek' }
        : undefined
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
  // Web-source citations — one row each (a title can be long), capped.
  for (const source of (result.sources || []).slice(0, 4)) {
    if (!source?.url || !source.title) continue;
    rows.push([{ text: `🔗 ${source.title.slice(0, 60)}`, url: source.url }]);
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

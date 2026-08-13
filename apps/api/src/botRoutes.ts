import { timingSafeEqual } from 'node:crypto';
import type express from 'express';
import { getAccountByProvider, listNudgeRecipients, recordBotReachability } from './accountStore.js';
import type { SyncedLibrary } from './accountStore.js';
import {
  parseChatHistory,
  recordChatTelemetry,
  type AssistantRuntime
} from './aiRoutes.js';
import { bumpCounter } from './observabilityStore.js';
import { publicWebSources } from './ai/publicSources.js';
import type { UserTasteContext } from './ai/types.js';

// Mirrors the billing webhook gate: constant-time compare, empty token fails closed.
const isValidInternalToken = (expected: string, provided: string | undefined): boolean => {
  if (!expected || !provided) return false;
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
};

const normalizeTasteLabel = (value: string | null | undefined) =>
  String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();

const addScore = (target: Record<string, number>, key: string, value: number) => {
  const normalized = normalizeTasteLabel(key);
  if (!normalized || !Number.isFinite(value) || value <= 0) return;
  target[normalized] = Number(((target[normalized] || 0) + value).toFixed(4));
};

const addSignedStationScore = (target: Record<string, number>, stationId: string, value: number) => {
  const normalized = stationId.trim();
  if (!normalized || !Number.isFinite(value) || value === 0) return;
  target[normalized] = Number(((target[normalized] || 0) + value).toFixed(4));
};

const buildUserTasteContext = (library: SyncedLibrary | null | undefined): UserTasteContext | undefined => {
  if (!library) return undefined;
  const stationScores: Record<string, number> = {};
  const tagScores: Record<string, number> = {};
  const countryScores: Record<string, number> = {};
  const languageScores: Record<string, number> = {};
  Object.entries(library.tasteProfile?.stationScores || {}).forEach(([key, value]) => addSignedStationScore(stationScores, key, value));
  Object.entries(library.tasteProfile?.tagScores || {}).forEach(([key, value]) => addScore(tagScores, key, value));
  Object.entries(library.tasteProfile?.countryScores || {}).forEach(([key, value]) => addScore(countryScores, key, value));
  Object.entries(library.tasteProfile?.languageScores || {}).forEach(([key, value]) => addScore(languageScores, key, value));

  for (const station of library.favorites || []) {
    String(station.tags || '')
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag && tag.toLowerCase() !== 'no tags')
      .slice(0, 5)
      .forEach((tag, index) => addScore(tagScores, tag, 10.5 * (index === 0 ? 1 : index === 1 ? 0.62 : 0.38)));
    addScore(countryScores, station.country, 5.2);
  }

  const favoriteStationIds = (library.favorites || [])
    .map((station) => station.stationuuid)
    .filter(Boolean)
    .slice(0, 200);

  const recentStationIds = (library.recent || [])
    .map((station) => station.stationuuid)
    .filter(Boolean)
    .slice(0, 80);
  const hiddenStationIds = (library.tasteProfile?.hiddenStationIds || []).filter(Boolean).slice(0, 160);
  const negativeStationIds = Object.entries(stationScores)
    .filter(([, value]) => value <= -4)
    .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))
    .map(([stationId]) => stationId)
    .slice(0, 80);

  if (
    !favoriteStationIds.length &&
    !recentStationIds.length &&
    !hiddenStationIds.length &&
    !negativeStationIds.length &&
    !Object.keys(stationScores).length &&
    !Object.keys(tagScores).length &&
    !Object.keys(countryScores).length
  ) {
    return undefined;
  }
  return {
    favoriteStationIds,
    recentStationIds,
    hiddenStationIds,
    negativeStationIds,
    stationScores,
    tagScores,
    countryScores,
    languageScores
  };
};

// R1 bot retention (PR-A). These endpoints touch chat_id + opt-in (PII), so they
// are INTERNAL-ONLY — gated by X-Internal-Token, never exposed publicly. They are
// the bot↔API seam: the bot records reachability on /start, and (PR-B) reads the
// recipient set. No message is sent here.
export const registerBotRoutes = (
  app: express.Express,
  options: {
    internalWebhookToken: string;
    // Provided only when AI is enabled — gates the /internal/bot/ai-chat
    // endpoint so AI-off deploys are byte-identical (no endpoint at all). The
    // bot calls this; the selected model-provider key never leaves the api process.
    aiRuntime?: AssistantRuntime | null;
  }
) => {
  const gate = (req: express.Request, res: express.Response): boolean => {
    const provided = req.header('x-internal-token') || undefined;
    if (!isValidInternalToken(options.internalWebhookToken, provided)) {
      res.status(401).json({ error: 'unauthorized' });
      return false;
    }
    return true;
  };

  // Bot /start calls this so we know which Telegram users can be DM'd.
  app.post('/internal/bot/reachable', async (req, res) => {
    if (!gate(req, res)) return;
    const telegramId =
      typeof req.body?.telegramId === 'string' || typeof req.body?.telegramId === 'number'
        ? String(req.body.telegramId).trim()
        : '';
    if (!telegramId) {
      res.status(400).json({ error: 'telegramId is required' });
      return;
    }
    try {
      await recordBotReachability(telegramId);
      res.json({ ok: true });
    } catch (err) {
      // Static client error; details to the server log only (no internals leak).
      console.error('internal/bot/reachable failed', err);
      res.status(500).json({ error: 'reachability failed' });
    }
  });

  // PR-B sender reads its recipient set here (opted-in ∧ reachable ∧ not recently
  // sent). Internal-only — the response carries chat_ids.
  app.get('/internal/bot/nudge-recipients', async (req, res) => {
    if (!gate(req, res)) return;
    try {
      const recipients = await listNudgeRecipients();
      res.json({ recipients });
    } catch (err) {
      console.error('internal/bot/nudge-recipients failed', err);
      res.status(500).json({ error: 'recipients failed' });
    }
  });

  // «Лира» AI companion — Telegram surface. The bot forwards {text, history?}
  // here behind the X-Internal-Token gate; we run the SAME shared brain with
  // surface:'telegram' and return the abstract result. runtime.chat already
  // applies the shared concurrency guard + global volume cap, so this endpoint
  // shares the api-side cost backstop with /ai/chat. The bot never imports the
  // brain and never holds a model-provider key. (No account lookup: the brain does
  // not use an account id in v1, so a per-call DB hit would be wasted.)
  const aiRuntime = options.aiRuntime;
  if (aiRuntime) {
    app.post('/internal/bot/ai-chat', async (req, res) => {
      if (!gate(req, res)) return;
      const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      if (!text) {
        res.status(400).json({ error: 'text is required' });
        return;
      }
      const telegramId =
        typeof req.body?.telegramId === 'string' || typeof req.body?.telegramId === 'number'
          ? String(req.body.telegramId).trim()
          : '';
      const history = parseChatHistory(req.body?.history);
      const startedAt = Date.now();
      try {
        const account = telegramId ? await getAccountByProvider('telegram', telegramId).catch(() => null) : null;
        const result = await aiRuntime.chat({
          userMessage: text.slice(0, 2000),
          history,
          surface: 'telegram',
          userTaste: buildUserTasteContext(account?.library)
        });
        recordChatTelemetry('telegram', startedAt, result);
        res.json({
          reply: result.reply,
          stations: result.stations.map((station) => ({
            stationuuid: station.stationuuid,
            name: station.name,
            country: station.country
          })),
          serviceLinks: result.serviceLinks,
          // Keep raw search/lyrics content server-side; Telegram needs only
          // link labels and URLs for its inline buttons.
          sources: publicWebSources(result.sources)
        });
      } catch (err) {
        bumpCounter('ai_chat_error');
        console.error('internal/bot/ai-chat failed', err);
        res.status(500).json({ error: 'chat failed' });
      }
    });
  }
};

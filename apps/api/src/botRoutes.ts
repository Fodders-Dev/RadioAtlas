import { timingSafeEqual } from 'node:crypto';
import type express from 'express';
import {
  getAccountByProvider,
  listNudgeRecipients,
  recordBotReachability
} from './accountStore.js';
import {
  parseChatHistory,
  recordChatTelemetry,
  type AssistantRuntime
} from './aiRoutes.js';
import { bumpCounter } from './observabilityStore.js';

// Mirrors the billing webhook gate: constant-time compare, empty token fails closed.
const isValidInternalToken = (expected: string, provided: string | undefined): boolean => {
  if (!expected || !provided) return false;
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
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
    // bot calls this; the DeepSeek key never leaves the api process.
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
      res.status(500).json({ error: err instanceof Error ? err.message : 'reachability failed' });
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
      res.status(500).json({ error: err instanceof Error ? err.message : 'recipients failed' });
    }
  });

  // «Лира» AI companion — Telegram surface. The bot forwards {telegramId, text,
  // history?} here behind the X-Internal-Token gate; we map the Telegram id to
  // an account (anonymous is fine — userId stays undefined), run the SAME shared
  // brain with surface:'telegram', and return the abstract result. The bot never
  // imports the brain and never holds the DeepSeek key.
  const aiRuntime = options.aiRuntime;
  if (aiRuntime) {
    app.post('/internal/bot/ai-chat', async (req, res) => {
      if (!gate(req, res)) return;
      const telegramId =
        typeof req.body?.telegramId === 'string' || typeof req.body?.telegramId === 'number'
          ? String(req.body.telegramId).trim()
          : '';
      const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      if (!text) {
        res.status(400).json({ error: 'text is required' });
        return;
      }
      const account = telegramId
        ? await getAccountByProvider('telegram', telegramId).catch(() => null)
        : null;
      const history = parseChatHistory(req.body?.history);
      const startedAt = Date.now();
      try {
        const result = await aiRuntime.chat({
          userMessage: text.slice(0, 2000),
          history,
          surface: 'telegram',
          userId: account?.id
        });
        recordChatTelemetry('telegram', startedAt, result);
        res.json({
          reply: result.reply,
          stations: result.stations.map((station) => ({
            stationuuid: station.stationuuid,
            name: station.name,
            country: station.country
          })),
          serviceLinks: result.serviceLinks
        });
      } catch (err) {
        bumpCounter('ai_chat_error');
        res.status(500).json({ error: err instanceof Error ? err.message : 'chat failed' });
      }
    });
  }
};

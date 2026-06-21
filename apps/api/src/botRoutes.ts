import { timingSafeEqual } from 'node:crypto';
import type express from 'express';
import { listNudgeRecipients, recordBotReachability } from './accountStore.js';
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
  // brain and never holds the DeepSeek key. (No account lookup: the brain does
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
      const history = parseChatHistory(req.body?.history);
      const startedAt = Date.now();
      try {
        const result = await aiRuntime.chat({
          userMessage: text.slice(0, 2000),
          history,
          surface: 'telegram'
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
          sources: result.sources
        });
      } catch (err) {
        bumpCounter('ai_chat_error');
        console.error('internal/bot/ai-chat failed', err);
        res.status(500).json({ error: 'chat failed' });
      }
    });
  }
};

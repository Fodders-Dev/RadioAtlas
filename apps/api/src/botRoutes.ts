import { timingSafeEqual } from 'node:crypto';
import type express from 'express';
import { listNudgeRecipients, recordBotReachability } from './accountStore.js';

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
  options: { internalWebhookToken: string }
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
};

// R1 bot retention (PR-A): tell the API that this Telegram user has started the
// bot, so a future nudge can DM them (Telegram only lets a bot message users who
// started it). FAIL-SAFE: this function never throws and never rejects — the
// /start onboarding reply must always happen regardless of API state. Mirrors
// the billingForward deps-injection shape so it's unit-testable.

export type ReachabilityDeps = {
  fetch: typeof fetch;
  apiUrl: string;
  internalWebhookToken: string;
  log: (line: string) => void;
};

export const recordReachability = async (
  deps: ReachabilityDeps,
  telegramId: string | number | undefined | null
): Promise<boolean> => {
  const id = telegramId === undefined || telegramId === null ? '' : String(telegramId).trim();
  if (!id) return false;
  if (!deps.apiUrl || !deps.internalWebhookToken) {
    deps.log('[R1] reachability skipped: API_URL or INTERNAL_WEBHOOK_TOKEN missing');
    return false;
  }
  try {
    const response = await deps.fetch(`${deps.apiUrl}/internal/bot/reachable`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': deps.internalWebhookToken
      },
      body: JSON.stringify({ telegramId: id })
    });
    if (!response.ok) {
      deps.log(`[R1] reachability non-2xx: ${response.status}`);
      return false;
    }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.log(`[R1] reachability fetch failed (onboarding unaffected): ${message}`);
    return false;
  }
};

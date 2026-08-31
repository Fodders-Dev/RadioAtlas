/**
 * Where this process reaches the Telegram Bot API.
 *
 * The API calls it for BILLING — `createInvoiceLink` and `getStarTransactions`
 * — so on a host that cannot reach Telegram, payments do not work. Measured
 * 2026-08-31 from the Russian box: TCP to api.telegram.org:443 never connects,
 * three attempts, no response in 20 s.
 *
 * Same shape and same rules as the bot's copy (`apps/bot/src/telegramApiRoot.ts`).
 * The two are deliberately duplicated rather than shared: these are separate
 * workspaces with no common package, and fifteen lines with their own test in
 * each is cheaper and clearer than a dependency between them. If one changes,
 * change both — the tests name each other.
 *
 * ⚠⚠ THE BOT TOKEN IS IN THE PATH OF EVERY CALL (`/bot<TOKEN>/method`).
 * Whatever this points at sees the token on every request, so it may only be a
 * host we own, over https, whose access log does not record request paths.
 */

export type TelegramApiRootResult =
  | { root: string; isDefault: boolean }
  | { error: string };

export const DEFAULT_TELEGRAM_API_ROOT = 'https://api.telegram.org';

/**
 * An invalid value is an ERROR rather than a fallback: falling back to
 * Telegram's own host would leave billing quietly pointed at somewhere it
 * cannot reach, which is indistinguishable from the outage this exists to fix.
 */
export const resolveTelegramApiRoot = (raw: string | undefined): TelegramApiRootResult => {
  const value = String(raw ?? '').trim();
  if (!value) return { root: DEFAULT_TELEGRAM_API_ROOT, isDefault: true };

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { error: `TELEGRAM_API_ROOT is not a URL: ${value}` };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { error: `TELEGRAM_API_ROOT must be http(s): ${value}` };
  }
  if (
    parsed.protocol === 'http:' &&
    parsed.hostname !== 'localhost' &&
    parsed.hostname !== '127.0.0.1'
  ) {
    return { error: `TELEGRAM_API_ROOT must be https for a remote host: ${value}` };
  }
  if (parsed.search || parsed.hash) {
    return { error: `TELEGRAM_API_ROOT must not carry a query or fragment: ${value}` };
  }

  return { root: parsed.toString().replace(/\/+$/, ''), isDefault: false };
};

/**
 * Resolved once at module load: this is deployment configuration, and a billing
 * call is not the moment to re-parse an environment variable.
 *
 * A bad value throws HERE, at startup, rather than on somebody's first attempt
 * to pay.
 */
const resolved = resolveTelegramApiRoot(process.env.TELEGRAM_API_ROOT);
if ('error' in resolved) {
  throw new Error(resolved.error);
}

export const telegramApiRoot = resolved.root;

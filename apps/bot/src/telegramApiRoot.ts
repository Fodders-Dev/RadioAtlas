/**
 * Where this process reaches the Telegram Bot API.
 *
 * Default is Telegram's own host, and that is right everywhere except the one
 * place this service now runs: measured 2026-08-31 from the Russian host,
 * `api.telegram.org` does not answer at all — TCP to :443 never connects, no
 * response in 20 s, three attempts. The bot there logs ETIMEDOUT in a loop and
 * serves nobody, while the copy on the Netherlands box does the work.
 *
 * So the host is configuration, and the plan is the same shape as the stream
 * proxy's foreign egress: everything runs on the Russian box, and only the
 * traffic that cannot work from there goes out through a host abroad.
 *
 * ⚠⚠ THE BOT TOKEN IS IN THE PATH OF EVERY BOT API CALL
 * (`/bot<TOKEN>/sendMessage`). Whatever this points at sees the token on every
 * request. So it may only ever be a host we own, over https, whose access log
 * does not record request paths. This is not a place for a public proxy, a
 * third-party relay, or a convenience URL somebody pastes from a forum.
 */

export type TelegramApiRootResult =
  | { root: string; isDefault: boolean }
  | { error: string };

export const DEFAULT_TELEGRAM_API_ROOT = 'https://api.telegram.org';

/**
 * Pure so the decision is testable without a network or a process.
 *
 * An invalid value is an ERROR rather than a fallback. Falling back to
 * Telegram's own host would leave the process running and unreachable, which
 * looks exactly like the broken state this exists to fix — and the operator
 * would have no way to tell a typo from a blockade.
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
  if (parsed.protocol === 'http:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    // The token is in the path. Plaintext to anywhere but this machine would
    // put it on the wire.
    return { error: `TELEGRAM_API_ROOT must be https for a remote host: ${value}` };
  }
  if (parsed.search || parsed.hash) {
    // grammY appends `/bot<token>/<method>`; a query string here would end up
    // in the middle of the URL and the call would 404 in a way nobody enjoys
    // debugging.
    return { error: `TELEGRAM_API_ROOT must not carry a query or fragment: ${value}` };
  }

  return { root: parsed.toString().replace(/\/+$/, ''), isDefault: false };
};

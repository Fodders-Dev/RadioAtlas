/**
 * Client half of live listener presence. Pure helpers only — the React wiring lives in
 * useListenerPresence.ts so this file stays trivially testable.
 *
 * See apps/api/src/listeningPresence.ts for the privacy design. The short version: the
 * token below is generated here, is scoped to a single station, is thrown away the moment
 * the station changes, and is never derived from anything about the user.
 */

/** Beat cadence while the app is on screen. */
export const BEAT_VISIBLE_MS = 30_000;
/** Backgrounded: browsers clamp hidden timers to ~60s anyway, so ask for what we can get. */
export const BEAT_HIDDEN_MS = 60_000;

/**
 * Below this the player says nothing. The viewer is themselves one of the count, so a 1
 * means "only you" — which is not information — and on a small app a 1 on a niche station
 * next to a co-presence claim is exactly the disclosure we do not want to make.
 */
export const PLAYER_MIN_LISTENERS = 2;

export const PRESENCE_OPT_OUT_KEY = 'radio:presence-opt-out:v1';

/**
 * Are we listening RIGHT NOW?
 *
 * `isPlaying` alone, deliberately. It is tempting to also count `status === 'buffering'` so
 * the line does not flicker during a rebuffer — but a rebuffer leaves `isPlaying` true, so
 * there is no flicker to fix, while `buffering && !isPlaying` is the INITIAL CONNECT, where
 * audio has never been heard. Counting that would book a listener for a station that may
 * never actually play.
 */
export const shouldReportListening = (args: {
  hasStation: boolean;
  isPlaying: boolean;
  optedIn: boolean;
}): boolean => args.optedIn && args.hasStation && args.isPlaying;

export const beatIntervalMs = (hidden: boolean): number =>
  hidden ? BEAT_HIDDEN_MS : BEAT_VISIBLE_MS;

/**
 * A fresh, opaque, single-station token. Rotated ONLY on station change — never on a timer:
 * with a 150s server TTL, a mid-session rotation leaves the old token alive alongside the
 * new one, counting one person as two for two and a half minutes. Nothing is lost by not
 * rotating, because the token is already scoped to one station and there is nothing to
 * correlate it with.
 */
export const createPresenceToken = (): string => {
  const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  if (cryptoApi?.getRandomValues) {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

export const isOptedOut = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(PRESENCE_OPT_OUT_KEY) === '1';
  } catch {
    return false;
  }
};

export const setOptedOut = (value: boolean): void => {
  try {
    if (value) {
      globalThis.localStorage?.setItem(PRESENCE_OPT_OUT_KEY, '1');
    } else {
      globalThis.localStorage?.removeItem(PRESENCE_OPT_OUT_KEY);
    }
  } catch {
    /* storage unavailable — presence just stays on for this session */
  }
};

const pluralRu = (n: number): 'слушатель' | 'слушателя' | 'слушателей' => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'слушатель';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'слушателя';
  return 'слушателей';
};

/**
 * The player line. Returns null whenever nothing may be shown — the caller renders nothing
 * at all rather than an empty element. The number quoted is OTHERS, not the total, because
 * the viewer already knows they are listening.
 *
 * Never returns a padded, rounded-up or estimated number: `count` is what the server
 * actually counted, and if it is below the threshold the answer is silence.
 */
export const formatListenerLine = (count: number | null): string | null => {
  if (count === null || !Number.isFinite(count) || count < PLAYER_MIN_LISTENERS) return null;
  const others = Math.floor(count) - 1;
  return `Ещё ${others} ${pluralRu(others)}`;
};

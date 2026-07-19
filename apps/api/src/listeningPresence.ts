/**
 * Live listener presence — how many RadioAtlas users are hearing a station RIGHT NOW.
 *
 * The catalog has no listener count (Radio Browser only exposes all-time clickcount and
 * community votes, neither of which means "listening now"), so rather than relabel a
 * popularity number we count our own.
 *
 * PRIVACY — the whole design, not a footnote:
 *   • Nothing is written to disk. Ever. The store is a Map that dies with the process.
 *   • No user id, no Telegram id, no IP, no account link is stored — not even hashed.
 *     What is stored is a token the CLIENT generates, which the server never resolves to
 *     a person and which the client throws away when it changes station.
 *   • Because a token is scoped to one station, there is nothing to correlate across
 *     stations even in memory: two tokens from the same person are indistinguishable
 *     from two tokens from two people.
 *   • The only thing derivable from the whole store is "N anonymous somebodies are on
 *     station X", and even that is exposed to clients only above a threshold (see the
 *     webapp side) so a count of 1 cannot tell you that one specific person is listening.
 *
 * ANTI-FABRICATION: the number returned is the true number of live tokens. It is never
 * seeded, padded, blended with popularity, or rounded up. If it is 0 it is 0.
 *
 * COST: bounded by construction. One entry per live listener (not per station), swept on
 * a cheap interval; an entry is ~100 bytes, so even 10k simultaneous listeners is ~1 MB —
 * comfortably inside the API's memory budget on a small VPS.
 */

/** A beat older than this means the listener is gone (missed ~2 beats at 60s hidden). */
export const PRESENCE_TTL_MS = 150_000;
/** How often expired entries are swept out. */
export const SWEEP_INTERVAL_MS = 30_000;
/** Refuse absurd tokens outright — they are client-generated. */
const MAX_TOKEN_LENGTH = 64;
const MAX_STATION_ID_LENGTH = 128;
/** Hard ceiling so a malicious client cannot grow the map without bound. */
export const MAX_LIVE_ENTRIES = 50_000;

type PresenceEntry = {
  stationId: string;
  expiresAt: number;
};

type PresenceStore = {
  /** token -> where it is listening. Flat: no empty-inner-map bookkeeping to leak. */
  entries: Map<string, PresenceEntry>;
  /** stationId -> live token count, kept in step with `entries` so reads are O(1). */
  counts: Map<string, number>;
};

const store: PresenceStore = { entries: new Map(), counts: new Map() };

const bump = (stationId: string, delta: number) => {
  const next = (store.counts.get(stationId) ?? 0) + delta;
  if (next > 0) {
    store.counts.set(stationId, next);
  } else {
    store.counts.delete(stationId);
  }
};

const dropEntry = (token: string) => {
  const existing = store.entries.get(token);
  if (!existing) return;
  store.entries.delete(token);
  bump(existing.stationId, -1);
};

export const sweepPresence = (now = Date.now()): number => {
  let removed = 0;
  for (const [token, entry] of store.entries) {
    if (entry.expiresAt <= now) {
      dropEntry(token);
      removed += 1;
    }
  }
  return removed;
};

const isSaneToken = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_TOKEN_LENGTH;

const isSaneStationId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_STATION_ID_LENGTH;

export type PresenceBeatResult =
  | { ok: true; stationId: string; listeners: number }
  | { ok: false; reason: 'invalid' | 'full' };

/**
 * Record (or refresh) one listener on one station and return that station's live count.
 *
 * The count comes back on the WRITE so the client needs no polling read at all: the thing
 * that is listening is the same thing that wants the number.
 *
 * A token that moves to another station is moved, not duplicated — the client rotates its
 * token on station change, but a stale token from a crashed tab simply expires.
 */
export const recordPresenceBeat = (
  rawToken: unknown,
  rawStationId: unknown,
  now = Date.now()
): PresenceBeatResult => {
  if (!isSaneToken(rawToken) || !isSaneStationId(rawStationId)) {
    return { ok: false, reason: 'invalid' };
  }
  const token = rawToken;
  const stationId = rawStationId;

  const existing = store.entries.get(token);
  if (existing) {
    if (existing.stationId !== stationId) {
      bump(existing.stationId, -1);
      bump(stationId, 1);
    }
    existing.stationId = stationId;
    existing.expiresAt = now + PRESENCE_TTL_MS;
  } else {
    if (store.entries.size >= MAX_LIVE_ENTRIES) {
      // Sweep once before refusing — the ceiling is usually stale entries, not real load.
      sweepPresence(now);
      if (store.entries.size >= MAX_LIVE_ENTRIES) {
        return { ok: false, reason: 'full' };
      }
    }
    store.entries.set(token, { stationId, expiresAt: now + PRESENCE_TTL_MS });
    bump(stationId, 1);
  }

  return { ok: true, stationId, listeners: store.counts.get(stationId) ?? 0 };
};

/** Explicit goodbye (pause, stop, page unload). Best-effort; the TTL is the real guarantee. */
export const releasePresence = (rawToken: unknown): boolean => {
  if (!isSaneToken(rawToken)) return false;
  const had = store.entries.has(rawToken);
  dropEntry(rawToken);
  return had;
};

export const getStationListeners = (stationId: string): number =>
  store.counts.get(stationId) ?? 0;

/** Stations with the most live listeners — the «Что слушают сейчас» surface. */
export const getLiveStations = (limit = 10): { stationId: string; listeners: number }[] =>
  [...store.counts.entries()]
    .map(([stationId, listeners]) => ({ stationId, listeners }))
    .sort((a, b) => b.listeners - a.listeners || a.stationId.localeCompare(b.stationId))
    .slice(0, Math.max(0, limit));

/** Test seam. */
export const __resetPresence = () => {
  store.entries.clear();
  store.counts.clear();
};

export const presenceSize = () => store.entries.size;

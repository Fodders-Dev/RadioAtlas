// Cross-session "exposure" memory: how recently / how often a station was SHOWN
// to the user (surfaced as a discovery card) or PLAYED. It exists to answer the
// single most-repeated owner complaint — «как ни зайдёшь, одна и та же поебота» —
// which the pre-existing signals could not: `recent` (20-deep) and the 8h session
// events only cover *played* stations and are used as HARD binary excludes, and a
// played station is actually *boosted* within 8h (getSessionStationScore). Nothing
// demoted a station the feed/Home merely SHOWED but the user swiped past, so every
// re-open re-led with the same top picks.
//
// This ledger records shown-but-unplayed impressions too, and exposes a DECAYING
// SOFT penalty (not a hard exclude — over-excluding starves small genres). Wired
// as one extra additive term into the shared rankers (rankStationsForUser, the
// Home scoreStation), so a station seen 5 minutes ago is demoted hard, one seen a
// few hours ago mildly, and one seen 3 days ago not at all — it rotates back in.
//
// Decay/idioms mirror radioSession.ts and tasteProfile.ts (half-life powers of ½,
// clamped age factor, capped record map) so the whole taste stack reads the same.

export type StationExposureEntry = {
  lastShownAt: number;
  shownCount: number;
  lastPlayedAt?: number;
};

export type StationExposureLedger = Record<string, StationExposureEntry>;

// Cap the ledger so it can't grow unbounded in localStorage; oldest activity is
// trimmed first (mirrors trimScores in tasteProfile.ts / MAX_RADIO_SESSION_EVENTS).
export const MAX_EXPOSURE_ENTRIES = 300;

// After this, an entry is pruned and contributes nothing — a station returns to
// full eligibility, so the demotion is a rotation, never a permanent ban.
const EXPOSURE_TTL_MS = 1000 * 60 * 60 * 24 * 3; // 3 days

// Penalty half-life. Short enough that within one browsing session repeated opens
// keep rotating in fresh stations, long enough that the "freshness" survives a few
// hours of coming back.
const EXPOSURE_HALF_LIFE_MS = 1000 * 60 * 60 * 4; // 4 hours

// Penalty magnitudes are tuned against rankStationsForUser's score scale (a strong
// taste match lands ~15-20; near-equal same-genre peers sit within a few points of
// each other). A shown penalty of ~2.4-5.5 reorders near-equal peers so a fresh one
// leads, without sinking a clearly stronger pick. See tasteProfile.rankStationsForUser.
const SHOWN_PENALTY_BASE = 2.4;
const SHOWN_PENALTY_STEP = 1.05; // added per extra impression, log-diminished
const SHOWN_PENALTY_CAP = 5.5;
const PLAYED_PENALTY = 3.2;
const PENALTY_CAP = 7.5;

const lastActivityOf = (entry: StationExposureEntry) =>
  Math.max(
    Number.isFinite(entry.lastShownAt) ? entry.lastShownAt : 0,
    entry.lastPlayedAt != null && Number.isFinite(entry.lastPlayedAt) ? entry.lastPlayedAt : 0
  );

// 1 at t=0, 0.5 after one half-life, 0 once past the TTL. Guards against clock
// skew (a future timestamp reads as fresh, not negative-age).
const ageFactor = (since: number, now: number) => {
  if (!Number.isFinite(since)) return 0;
  const age = now - since;
  if (age <= 0) return 1;
  if (age >= EXPOSURE_TTL_MS) return 0;
  return Math.pow(0.5, age / EXPOSURE_HALF_LIFE_MS);
};

export const normalizeExposureLedger = (
  ledger: StationExposureLedger | null | undefined,
  now = Date.now()
): StationExposureLedger => {
  if (!ledger || typeof ledger !== 'object') return {};
  const entries = Object.entries(ledger).filter(([id, entry]) => {
    if (!id || !entry || typeof entry !== 'object') return false;
    const last = lastActivityOf(entry);
    return last > 0 && now - last < EXPOSURE_TTL_MS;
  });
  if (entries.length <= MAX_EXPOSURE_ENTRIES) return Object.fromEntries(entries);
  entries.sort(([, left], [, right]) => lastActivityOf(right) - lastActivityOf(left));
  return Object.fromEntries(entries.slice(0, MAX_EXPOSURE_ENTRIES));
};

export const recordStationsShown = (
  ledger: StationExposureLedger | null | undefined,
  ids: Iterable<string>,
  now = Date.now()
): StationExposureLedger => {
  const next: StationExposureLedger = { ...(ledger || {}) };
  let changed = false;
  for (const id of ids) {
    if (!id) continue;
    const prev = next[id];
    next[id] = {
      lastShownAt: now,
      shownCount: Math.min(999, (prev?.shownCount || 0) + 1),
      lastPlayedAt: prev?.lastPlayedAt
    };
    changed = true;
  }
  if (!changed) return ledger || {};
  return normalizeExposureLedger(next, now);
};

export const recordStationPlayed = (
  ledger: StationExposureLedger | null | undefined,
  id: string,
  now = Date.now()
): StationExposureLedger => {
  if (!id) return ledger || {};
  const next: StationExposureLedger = { ...(ledger || {}) };
  const prev = next[id];
  next[id] = {
    // Playing implies it was surfaced; keep an existing shown timestamp/count but
    // don't inflate the count (the played term carries its own penalty).
    lastShownAt: prev?.lastShownAt ?? now,
    shownCount: prev?.shownCount ?? 0,
    lastPlayedAt: now
  };
  return normalizeExposureLedger(next, now);
};

// Positive number to SUBTRACT from a ranking score. 0 when the station is unknown
// or fully decayed.
export const getStationExposurePenalty = (
  ledger: StationExposureLedger | null | undefined,
  stationId: string,
  now = Date.now()
): number => {
  const entry = ledger?.[stationId];
  if (!entry) return 0;
  let penalty = 0;
  const shownAge = ageFactor(entry.lastShownAt, now);
  if (shownAge > 0) {
    const extra = Math.max(0, (entry.shownCount || 1) - 1);
    const strength = Math.min(SHOWN_PENALTY_CAP, SHOWN_PENALTY_BASE + Math.log2(1 + extra) * SHOWN_PENALTY_STEP);
    penalty += strength * shownAge;
  }
  if (entry.lastPlayedAt != null) {
    penalty += PLAYED_PENALTY * ageFactor(entry.lastPlayedAt, now);
  }
  return Math.min(PENALTY_CAP, penalty);
};

import type { PlaybackFailureKind } from '../domain/contracts';
import type { StationLite } from '../types';
import type { BehaviorProfile } from './homeProfile';
import {
  getStationHealthScore,
  isStationSuppressedByHealth,
  type StationHealthProfile
} from './stationHealth';
import {
  getSessionExcludedStationIds,
  getSessionStationScore,
  type RadioSessionEvent
} from './radioSession';

export type PlaybackOutcomeKind = 'success' | 'metadata-unavailable' | PlaybackFailureKind;

export type StationPlayabilitySignal = {
  stationId: string;
  successes: number;
  failures: number;
  hardFailures: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastEventAt: number;
  lastOutcome: PlaybackOutcomeKind;
};

export type StationPlayabilityProfile = {
  version: 1;
  signals: Record<string, StationPlayabilitySignal>;
};

type RankHomeOptions = {
  limit?: number;
  now?: number;
  healthProfile?: StationHealthProfile | null;
  sessionEvents?: RadioSessionEvent[];
};

type RankSearchOptions = {
  query: string;
  behaviorProfile: BehaviorProfile;
  playabilityProfile: StationPlayabilityProfile;
  healthProfile?: StationHealthProfile | null;
  now?: number;
  sessionEvents?: RadioSessionEvent[];
  // Optional per-station personal-taste boost (owner's «примесь рекомендаций в
  // поиск»). Passed as a callback so this module needn't import tasteProfile
  // (which imports it back — avoids a circular dependency). Clamped below so it
  // stays a TIE-BREAKER among near-equal matches and never overtakes the typed
  // query's intent term.
  tasteBoostFor?: (station: StationLite) => number;
};

export const DEFAULT_PLAYABILITY_PROFILE: StationPlayabilityProfile = {
  version: 1,
  signals: {}
};

const MAX_PLAYABILITY_SIGNALS = 180;
const PLAYABILITY_SIGNAL_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const RECENT_FAILURE_WINDOW_MS = 1000 * 60 * 60 * 6;
const RECENT_SUCCESS_WINDOW_MS = 1000 * 60 * 60 * 12;
const HARD_FAILURE_KINDS = new Set<PlaybackOutcomeKind>([
  'no-playable-candidate',
  'mixed-content',
  'unsupported-transport',
  'api-unavailable',
  'extract-failed',
  'attach-failed',
  'play-failed',
  'runtime-failed',
  'stream-unavailable'
]);

const normalize = (value?: string | null) => value?.trim().replace(/\s+/g, ' ').toLowerCase() || '';

const queryTokens = (query: string) =>
  normalize(query)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 6);

const firstTags = (station: StationLite, limit = 5) =>
  (station.tags || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag && tag.toLowerCase() !== 'no tags')
    .slice(0, limit);

const uniqueStations = (stations: StationLite[]) => {
  const seen = new Set<string>();
  const unique: StationLite[] = [];
  stations.forEach((station) => {
    if (seen.has(station.stationuuid)) return;
    seen.add(station.stationuuid);
    unique.push(station);
  });
  return unique;
};

const getSignal = (
  profile: StationPlayabilityProfile | null | undefined,
  stationId: string,
  now = Date.now()
) => {
  const signal = profile?.signals?.[stationId];
  if (!signal) return null;
  if (now - signal.lastEventAt > PLAYABILITY_SIGNAL_TTL_MS) return null;
  return signal;
};

const trimSignals = (
  signals: Record<string, StationPlayabilitySignal>,
  now: number
): Record<string, StationPlayabilitySignal> =>
  Object.fromEntries(
    Object.entries(signals)
      .filter(([, signal]) => now - signal.lastEventAt <= PLAYABILITY_SIGNAL_TTL_MS)
      .sort((left, right) => right[1].lastEventAt - left[1].lastEventAt)
      .slice(0, MAX_PLAYABILITY_SIGNALS)
  );

const isStationLike = (value: StationLite | string): value is StationLite =>
  typeof value !== 'string';

const stationIdOf = (station: StationLite | string) =>
  isStationLike(station) ? station.stationuuid : station;

export const getPlayabilityProfileUpdatedAt = (
  profile: StationPlayabilityProfile | null | undefined
) =>
  Object.values(profile?.signals || {}).reduce(
    (latest, signal) => Math.max(latest, signal.lastEventAt || 0),
    0
  );

export const recordPlaybackOutcome = (
  profile: StationPlayabilityProfile,
  station: StationLite | string,
  outcome: PlaybackOutcomeKind,
  now = Date.now()
): StationPlayabilityProfile => {
  if (outcome === 'metadata-unavailable' || outcome === 'superseded') {
    return profile?.version === 1 ? profile : DEFAULT_PLAYABILITY_PROFILE;
  }

  const stationId = stationIdOf(station);
  if (!stationId) return profile;

  const current = getSignal(profile, stationId, now);
  const base: StationPlayabilitySignal =
    current || {
      stationId,
      successes: 0,
      failures: 0,
      hardFailures: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastEventAt: now,
      lastOutcome: outcome
    };

  const nextSignal: StationPlayabilitySignal =
    outcome === 'success'
      ? {
          ...base,
          successes: Math.min(99, base.successes + 1),
          failures: Math.max(0, base.failures - 1),
          hardFailures: Math.max(0, base.hardFailures - 1),
          lastSuccessAt: now,
          lastEventAt: now,
          lastOutcome: outcome
        }
      : {
          ...base,
          failures: Math.min(99, base.failures + 1),
          hardFailures: Math.min(
            99,
            base.hardFailures + (HARD_FAILURE_KINDS.has(outcome) ? 1 : 0)
          ),
          lastFailureAt: now,
          lastEventAt: now,
          lastOutcome: outcome
        };

  return {
    version: 1,
    signals: trimSignals(
      {
        ...(profile?.signals || {}),
        [stationId]: nextSignal
      },
      now
    )
  };
};

// Window during which Radio Browser's own stream-check counts as
// "fresh enough to act on." If the last check is older than this,
// the station might be working again — only apply a mild
// penalty rather than excluding it.
const UPSTREAM_HEALTH_FRESH_MS = 24 * 60 * 60 * 1000;

/**
 * Score component derived from Radio Browser's own upstream check.
 *
 *   +6  station passed its last check, less than 24 h ago — strong
 *       "this works for everyone else right now" signal.
 *   +2  station passed its last check, but the check is stale.
 *   -8  station failed its last check, less than 24 h ago — the
 *       community's edge servers also can't connect.
 *   -3  station failed its last check, but the check is stale —
 *       might have recovered.
 *    0  no `lastcheckok` field on this artifact (predates the
 *       column).
 */
export const getUpstreamHealthScore = (
  station: StationLite,
  now = Date.now()
): number => {
  if (station.lastcheckok === undefined) return 0;
  const checkedAt = station.lastcheckok_at ?? null;
  const fresh = checkedAt !== null && now - checkedAt <= UPSTREAM_HEALTH_FRESH_MS;
  if (station.lastcheckok === 1) return fresh ? 6 : 2;
  return fresh ? -8 : -3;
};

/**
 * Stations that Radio Browser declares broken AND have been
 * checked in the last 24 h are excluded from background discovery
 * (Home rails, idle Search). Explicit Search queries still show
 * them — the user might know something the upstream doesn't.
 */
export const isStationHardHiddenByUpstream = (
  station: StationLite,
  now = Date.now()
): boolean => {
  if (station.lastcheckok !== 0) return false;
  const checkedAt = station.lastcheckok_at ?? null;
  if (checkedAt === null) return false;
  return now - checkedAt <= UPSTREAM_HEALTH_FRESH_MS;
};

export const getStationPlayabilityScore = (
  profile: StationPlayabilityProfile | null | undefined,
  station: StationLite | string,
  now = Date.now()
) => {
  const signal = getSignal(profile, stationIdOf(station), now);
  if (!signal) return 0;

  const lastSuccessAt = signal.lastSuccessAt || 0;
  const lastFailureAt = signal.lastFailureAt || 0;
  // Clamp BOTH ends: the lower bound is decay, the upper bound (1) guards a
  // backward clock correction. If lastEventAt is in the future relative to `now`
  // (device clock was running ahead, then NTP rewinds it), (now - lastEventAt)
  // goes negative and the factor would exceed 1, AMPLIFYING the score instead of
  // decaying it — pushing a stale station up/down the rail. min(1, …) prevents it.
  const ageFactor = Math.min(
    1,
    Math.max(0.35, 1 - (now - signal.lastEventAt) / PLAYABILITY_SIGNAL_TTL_MS)
  );
  const recentSuccess = lastSuccessAt && now - lastSuccessAt <= RECENT_SUCCESS_WINDOW_MS ? 1.7 : 0;
  const failureAfterSuccess = lastFailureAt > lastSuccessAt;
  const recentFailure =
    failureAfterSuccess && now - lastFailureAt <= RECENT_FAILURE_WINDOW_MS ? 3.2 : 0;
  const successScore = Math.min(8, signal.successes * 1.35) + recentSuccess;
  const failurePenalty =
    Math.min(10, signal.failures * 1.55 + signal.hardFailures * 2.15) + recentFailure;

  return (successScore - failurePenalty) * ageFactor;
};

export const isStationHardHiddenByPlayability = (
  profile: StationPlayabilityProfile | null | undefined,
  station: StationLite | string,
  now = Date.now()
) => {
  const signal = getSignal(profile, stationIdOf(station), now);
  if (!signal || signal.hardFailures < 2 || !signal.lastFailureAt) return false;
  const lastSuccessAt = signal.lastSuccessAt || 0;
  return signal.lastFailureAt > lastSuccessAt && now - signal.lastFailureAt <= RECENT_FAILURE_WINDOW_MS;
};

const stationQualityScore = (station: StationLite) =>
  (station.isVerified ? 1.2 : 0) + (station.isClaimed ? 0.45 : 0) - (station.promoted ? 0.35 : 0);

export const filterStationsByPlayability = (
  stations: StationLite[],
  profile: StationPlayabilityProfile | null | undefined,
  now = Date.now(),
  healthProfile?: StationHealthProfile | null
) =>
  uniqueStations(stations).filter(
    (station) =>
      !isStationHardHiddenByPlayability(profile, station, now) &&
      !isStationSuppressedByHealth(healthProfile, station, now)
  );

// Diversification window: when picking the next station for the
// final ranked list, look back at the previous DIVERSITY_WINDOW
// items and avoid any candidate whose primary country / primary
// tag matches one of them. Falls through to the highest-scoring
// remaining station once the candidate pool is exhausted.
//
// Effect: a home rail of 24 stations no longer reads as "8 Russian
// rock stations followed by 8 Russian pop stations" — it spreads
// the user's taste across countries, languages and genres so the
// rail looks like a curated mix instead of a sorted list.
const DIVERSITY_WINDOW = 3;

const stationDiversityKey = (station: StationLite): { country: string; tag: string } => {
  const country = normalize(station.country);
  const tag = firstTags(station, 1).map(normalize)[0] || '';
  return { country, tag };
};

const diversifyRanking = <T extends { station: StationLite; score: number }>(
  ranked: T[],
  windowSize = DIVERSITY_WINDOW
): T[] => {
  if (ranked.length <= 2 || windowSize <= 0) return ranked;
  const result: T[] = [];
  const remaining = [...ranked];
  while (remaining.length) {
    const recent = result.slice(-windowSize).map((item) => stationDiversityKey(item.station));
    const recentCountries = new Set(recent.map((entry) => entry.country).filter(Boolean));
    const recentTags = new Set(recent.map((entry) => entry.tag).filter(Boolean));
    let pickIndex = remaining.findIndex((candidate) => {
      const key = stationDiversityKey(candidate.station);
      const sharesCountry = key.country && recentCountries.has(key.country);
      const sharesTag = key.tag && recentTags.has(key.tag);
      // Acceptable if it differs on EITHER axis. Strict
      // "different on both" produced too few candidates and
      // the algorithm fell back to the head of the list constantly.
      return !sharesCountry || !sharesTag;
    });
    if (pickIndex < 0) pickIndex = 0;
    result.push(...remaining.splice(pickIndex, 1));
  }
  return result;
};

export const rankStationsForHome = (
  stations: StationLite[],
  profile: StationPlayabilityProfile | null | undefined,
  { limit = stations.length, now = Date.now(), healthProfile = null, sessionEvents = [] }: RankHomeOptions = {}
) => {
  const stationPool = uniqueStations(stations);
  const sessionExcludedIds = getSessionExcludedStationIds(sessionEvents, now);
  // Phase B-PR2: broken stations are no longer DROPPED from discovery — they
  // carry a 🚫/⚠ status badge instead of vanishing (Artem: «вместо того, чтобы
  // ее вообще не показывать, сделай значки»). They are still heavily DEMOTED:
  // the score terms below (playability + health*2.4 + upstream) are strongly
  // negative for a broken station, so over a real catalog they sink past the
  // rail's limit and only surface once the healthy pool is exhausted. The
  // shared filterStationsByPlayability stays in force for taste/queue/favorites
  // (autoplay must never pick a broken station). Session-excluded (recently
  // shown) stations are a diversity mechanism, not brokenness — still filtered.
  const ranked = stationPool
    .filter((station) => !sessionExcludedIds.has(station.stationuuid))
    .map((station, index) => ({
      station,
      index,
      score:
        getSessionStationScore(station, sessionEvents, stationPool, now) +
        getStationPlayabilityScore(profile, station, now) +
        getStationHealthScore(healthProfile, station, now) * 2.4 +
        getUpstreamHealthScore(station, now) +
        stationQualityScore(station)
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  return diversifyRanking(ranked).slice(0, limit).map((item) => item.station);
};

const queryIntentScore = (station: StationLite, query: string) => {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return 0;

  const name = normalize(station.name);
  const country = normalize(station.country);
  const state = normalize(station.state);
  const tags = firstTags(station).map(normalize);
  const language = normalize((station as StationLite & { language?: string }).language);
  const searchable = [name, country, state, normalize(station.tags)].join(' ');
  let score = 0;

  if (name === normalizedQuery) score += 80;
  else if (name.startsWith(normalizedQuery)) score += 62;
  else if (name.split(/\s+/).some((part) => part.startsWith(normalizedQuery))) score += 52;
  else if (name.includes(normalizedQuery)) score += 36;

  if (country === normalizedQuery || state === normalizedQuery) score += 26;
  if (tags.includes(normalizedQuery)) score += 24;
  if (tags.some((tag) => tag.startsWith(normalizedQuery))) score += 16;
  if (!score && searchable.includes(normalizedQuery)) score += 10;

  const tokens = queryTokens(query);
  if (tokens.length > 1) {
    const matchedBuckets = new Set<string>();
    let matchedTokenCount = 0;
    tokens.forEach((token) => {
      let tokenMatched = false;
      if (name === token) {
        score += 34;
        matchedBuckets.add('name');
        tokenMatched = true;
      } else if (name.startsWith(token)) {
        score += 26;
        matchedBuckets.add('name');
        tokenMatched = true;
      } else if (name.includes(token)) {
        score += 14;
        matchedBuckets.add('name');
        tokenMatched = true;
      }

      if (country === token || state === token || language === token) {
        score += 24;
        matchedBuckets.add('place');
        tokenMatched = true;
      } else if (country.startsWith(token) || state.startsWith(token) || language.startsWith(token)) {
        score += 16;
        matchedBuckets.add('place');
        tokenMatched = true;
      }

      if (tags.includes(token)) {
        score += 22;
        matchedBuckets.add('tag');
        tokenMatched = true;
      } else if (tags.some((tag) => tag.startsWith(token) || tag.includes(token))) {
        score += 12;
        matchedBuckets.add('tag');
        tokenMatched = true;
      }
      if (tokenMatched) matchedTokenCount += 1;
    });
    if (matchedBuckets.size >= Math.min(tokens.length, 2)) {
      score += 28;
    }
    if (matchedBuckets.has('place') && matchedBuckets.has('tag')) {
      score += 22;
    }
    if (matchedTokenCount === tokens.length) {
      score += 28;
    } else {
      score -= (tokens.length - matchedTokenCount) * 30;
    }
  }

  return score;
};

const behaviorScore = (station: StationLite, profile: BehaviorProfile) => {
  const stationScore = profile.stationScores[station.stationuuid] || 0;
  const countryScore = profile.countryScores[station.country?.trim() || ''] || 0;
  const stateScore = profile.stateScores[station.state?.trim() || ''] || 0;
  const tagScore = firstTags(station).reduce(
    (sum, tag, index) => sum + (profile.tagScores[tag] || 0) * (index === 0 ? 1 : 0.72),
    0
  );
  return stationScore * 0.32 + countryScore * 0.24 + stateScore * 0.18 + tagScore * 0.28;
};

export const rankStationsForSearch = (
  stations: StationLite[],
  {
    query,
    behaviorProfile,
    playabilityProfile,
    healthProfile = null,
    now = Date.now(),
    sessionEvents = [],
    tasteBoostFor
  }: RankSearchOptions
) => {
  const stationPool = uniqueStations(stations);
  const sessionExcludedIds = getSessionExcludedStationIds(sessionEvents, now);
  const explicitQuery = queryTokens(query).length > 1;
  // Personal-taste tie-breaker: clamped to ±TASTE_SEARCH_CAP and scaled down for
  // explicit multi-token queries, so it nudges among near-equal matches but can
  // never move a taste-favourite above the station the user actually typed
  // (intent scores reach 20-80).
  const TASTE_SEARCH_CAP = 8;
  const tasteBoost = (station: StationLite) => {
    if (!tasteBoostFor) return 0;
    const raw = tasteBoostFor(station);
    if (!Number.isFinite(raw) || raw === 0) return 0;
    const clamped = Math.max(-TASTE_SEARCH_CAP, Math.min(TASTE_SEARCH_CAP, raw));
    return clamped * (explicitQuery ? 0.28 : 0.6);
  };
  // Phase B-PR2: do NOT drop broken stations from search — show them (with a
  // 🚫/⚠ badge) so a user can still FIND a station they typed even if it is
  // currently unplayable. The score below already demotes broken stations
  // (negative playability/health/upstream terms), and for an explicit query the
  // reduced upstreamWeight keeps an exact-name match visible rather than buried
  // — the original deliberate behaviour, now extended to playability/health
  // failures too. filterStationsByPlayability is unchanged for taste/queue.
  const ranked = stationPool
    .map((station, index) => {
      const intent = queryIntentScore(station, query);
      const promotedBoost = intent >= 20 ? 0.1 : station.promoted ? 1 : 0;
      const sessionPenalty = sessionExcludedIds.has(station.stationuuid) ? -28 : 0;
      const behaviorBoost = behaviorScore(station, behaviorProfile) * (explicitQuery ? 0.28 : 1);
      // Upstream-health weight is lower for explicit queries: if
      // the user typed the exact name of a station Radio Browser
      // thinks is broken, we still want to show it (they might
      // know better, or want to add it to favorites for later).
      const upstreamWeight = explicitQuery ? 0.6 : 1.4;
      const score =
        intent +
        sessionPenalty +
        getSessionStationScore(station, sessionEvents, stationPool, now) +
        behaviorBoost +
        tasteBoost(station) +
        getStationPlayabilityScore(playabilityProfile, station, now) * 3.6 +
        getStationHealthScore(healthProfile, station, now) * 2.8 +
        getUpstreamHealthScore(station, now) * upstreamWeight +
        stationQualityScore(station) +
        promotedBoost;

      return {
        station,
        index,
        score
      };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index);
  // For an explicit query the user wants tight relevance — too much
  // diversification reorders the actually-best matches. Apply a
  // shorter window in that case. With no query (browse mode) use
  // the full window so the list reads as a varied catalog.
  return diversifyRanking(ranked, query.trim() ? 1 : DIVERSITY_WINDOW).map(
    (item) => item.station
  );
};

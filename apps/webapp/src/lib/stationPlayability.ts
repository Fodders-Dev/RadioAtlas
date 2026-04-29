import type { PlaybackFailureKind } from '../domain/contracts';
import type { StationLite } from '../types';
import type { BehaviorProfile } from './homeProfile';

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
};

type RankSearchOptions = {
  query: string;
  behaviorProfile: BehaviorProfile;
  playabilityProfile: StationPlayabilityProfile;
  now?: number;
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

export const getStationPlayabilityScore = (
  profile: StationPlayabilityProfile | null | undefined,
  station: StationLite | string,
  now = Date.now()
) => {
  const signal = getSignal(profile, stationIdOf(station), now);
  if (!signal) return 0;

  const lastSuccessAt = signal.lastSuccessAt || 0;
  const lastFailureAt = signal.lastFailureAt || 0;
  const ageFactor = Math.max(0.35, 1 - (now - signal.lastEventAt) / PLAYABILITY_SIGNAL_TTL_MS);
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
  now = Date.now()
) =>
  uniqueStations(stations).filter(
    (station) => !isStationHardHiddenByPlayability(profile, station, now)
  );

export const rankStationsForHome = (
  stations: StationLite[],
  profile: StationPlayabilityProfile | null | undefined,
  { limit = stations.length, now = Date.now() }: RankHomeOptions = {}
) =>
  filterStationsByPlayability(stations, profile, now)
    .map((station, index) => ({
      station,
      index,
      score: getStationPlayabilityScore(profile, station, now) + stationQualityScore(station)
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map((item) => item.station);

const queryIntentScore = (station: StationLite, query: string) => {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return 0;

  const name = normalize(station.name);
  const country = normalize(station.country);
  const state = normalize(station.state);
  const tags = firstTags(station).map(normalize);
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
  { query, behaviorProfile, playabilityProfile, now = Date.now() }: RankSearchOptions
) =>
  filterStationsByPlayability(stations, playabilityProfile, now)
    .map((station, index) => {
      const intent = queryIntentScore(station, query);
      const promotedBoost = intent >= 20 ? 0.1 : station.promoted ? 1 : 0;
      const score =
        intent +
        behaviorScore(station, behaviorProfile) +
        getStationPlayabilityScore(playabilityProfile, station, now) * 3.6 +
        stationQualityScore(station) +
        promotedBoost;

      return {
        station,
        index,
        score
      };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.station);

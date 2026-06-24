import type { FollowedRegion, FollowedStation, UserCollection } from '../domain/contracts';
import { stationsForRegions } from './regionRecommendations';
import type { AppSection, StationLite } from '../types';

type ScoreMap = Record<string, number>;
type TasteSignalKind = 'tag' | 'country' | 'state';
export type BehaviorActionKind = 'play' | 'favorite' | 'track-copy' | 'follow' | 'collection';

export type BehaviorProfile = {
  version: 1;
  lastUpdatedAt: number | null;
  actionCounts: {
    plays: number;
    likes: number;
    copies: number;
    follows: number;
    collections: number;
  };
  sectionVisits: Partial<Record<AppSection, number>>;
  tagScores: ScoreMap;
  countryScores: ScoreMap;
  stateScores: ScoreMap;
  stationScores: ScoreMap;
};

export type HomeTasteSignal = {
  kind: TasteSignalKind;
  label: string;
  score: number;
};

export type HomeRecommendationFeed = {
  profileReady: boolean;
  actionTotal: number;
  tasteSignals: HomeTasteSignal[];
  tunedForYou: StationLite[];
  becauseYouLiked: StationLite[];
  outsideOrbit: StationLite[];
  returnToAir: StationLite[];
};

type CreateHomeRecommendationFeedInput = {
  catalog: StationLite[];
  favorites: StationLite[];
  recent: StationLite[];
  queuePreview: StationLite[];
  playbackHistory: StationLite[];
  trackHistory: Array<{ stationId: string }>;
  collections: UserCollection[];
  followedStations: FollowedStation[];
  followedRegions?: FollowedRegion[];
  behaviorProfile: BehaviorProfile;
  currentStation: StationLite | null;
  rotationSeed: number;
};

const ACTION_WEIGHTS: Record<BehaviorActionKind, number> = {
  play: 3,
  favorite: 8,
  'track-copy': 10,
  follow: 6,
  collection: 5
};

const SCORE_LIMITS = {
  tags: 24,
  countries: 20,
  states: 20,
  stations: 80
} as const;

export const DEFAULT_BEHAVIOR_PROFILE: BehaviorProfile = {
  version: 1,
  lastUpdatedAt: null,
  actionCounts: {
    plays: 0,
    likes: 0,
    copies: 0,
    follows: 0,
    collections: 0
  },
  sectionVisits: {},
  tagScores: {},
  countryScores: {},
  stateScores: {},
  stationScores: {}
};

const normalizeLabel = (value?: string | null) =>
  value
    ?.trim()
    .replace(/\s+/g, ' ')
    .replace(/^#+/, '')
    .trim() || '';

const normalizeKey = (value?: string | null) => normalizeLabel(value).toLowerCase();

const firstTags = (station: StationLite, limit = 4) =>
  (station.tags || '')
    .split(',')
    .map((tag) => normalizeLabel(tag))
    .filter((tag) => tag && tag.toLowerCase() !== 'no tags')
    .slice(0, limit);

const addScore = (target: ScoreMap, label: string, score: number) => {
  if (!label || score <= 0) return;
  target[label] = (target[label] || 0) + score;
};

const trimScores = (source: ScoreMap, limit: number): ScoreMap =>
  Object.fromEntries(
    Object.entries(source)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, limit)
  );

const mergeUniqueStations = (...groups: Array<Array<StationLite | null | undefined>>) => {
  const seen = new Set<string>();
  const merged: StationLite[] = [];
  groups.forEach((group) => {
    group.forEach((station) => {
      if (!station || seen.has(station.stationuuid)) return;
      seen.add(station.stationuuid);
      merged.push(station);
    });
  });
  return merged;
};

const hashValue = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
};

// Mix a station's stable hash with the rotation seed (fmix finalizer) so any
// seed change genuinely permutes the order — `${id}:${seed}` would just shift
// every station's hash by the same amount. Returns 0..1. Mirrors
// tasteProfile.seededJitter (the «Моя Волна» fix).
const seededJitter = (id: string, seed: number) => {
  let h = (hashValue(id) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h % 1000) / 1000;
};

// «Для тебя» freshness: instead of always showing the top-N by score (which made
// the rail «каждый раз одно и то же» — the in-data score gradient between the
// leaders is wider than the old 0..1 rotationJitter could ever overcome, so the
// SAME top-N always won), rank by score, take a POOL of the strongest matches
// (limit × multiplier), then re-order WITHIN that pool by a blend of score and a
// seed-mixed jitter. Re-opening / «Обновить» mints a new seed → a genuinely
// different but still on-taste slice. Crucially scoreStation and the minScore
// gate are untouched and the pool boundary is by RAW score, so the rail stays
// on-taste; the blend keeps score in the key so the eager-taste re-rank survives
// (a like adds ≈+12, far past the jitter amplitude, so it still breaks a station
// to the front), and a fixed seed is deterministic so the T1.2 play-freeze holds.
const FRESH_POOL_MULTIPLIER = 2;
// Jitter swing added to the in-pool sort key. Comfortably above the score spread
// between near-equal same-tag peers (so seeds permute them → freshness) and well
// below a `liked` boost (so a like still wins → eager re-rank).
const FRESH_ROTATION_AMPLITUDE = 4;

const topEntries = (scores: ScoreMap, kind: TasteSignalKind, limit: number): HomeTasteSignal[] =>
  Object.entries(scores)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([label, score]) => ({
      kind,
      label,
      score
    }));

const buildAffinityProfile = (
  stationGroups: Array<{ stations: StationLite[]; weight: number }>
): BehaviorProfile => {
  let profile = DEFAULT_BEHAVIOR_PROFILE;
  stationGroups.forEach(({ stations, weight }) => {
    stations.forEach((station) => {
      profile = recordStationSignal(profile, station, 'play', weight);
    });
  });
  return profile;
};

const scoreStation = (station: StationLite, profile: BehaviorProfile, rotationSeed: number) => {
  const stationScore = profile.stationScores[station.stationuuid] || 0;
  const countryScore = profile.countryScores[normalizeLabel(station.country)] || 0;
  const stateScore = profile.stateScores[normalizeLabel(station.state)] || 0;
  const tagScore = firstTags(station).reduce((sum, tag, index) => {
    const multiplier = index === 0 ? 1 : index === 1 ? 0.8 : 0.62;
    return sum + (profile.tagScores[tag] || 0) * multiplier;
  }, 0);
  const qualityBoost = (station.isVerified ? 0.8 : 0) + (station.isClaimed ? 0.35 : 0) - (station.promoted ? 2.5 : 0);
  const rotationJitter = (hashValue(`${station.stationuuid}:${rotationSeed}`) % 1000) / 1000;
  return stationScore * 1.3 + tagScore * 1.7 + countryScore * 1.12 + stateScore * 0.9 + qualityBoost + rotationJitter;
};

const rankStations = (
  stations: StationLite[],
  profile: BehaviorProfile,
  rotationSeed: number,
  predicate: (station: StationLite) => boolean,
  limit: number,
  minScore = 1.25
) =>
  pickFreshSlice(
    stations
      .filter(predicate)
      .map((station) => ({
        station,
        score: scoreStation(station, profile, rotationSeed)
      }))
      .filter((item) => item.score >= minScore)
      .sort(
        (left, right) =>
          right.score - left.score || left.station.name.localeCompare(right.station.name)
      ),
    rotationSeed,
    limit
  );

// Take a pool of the top (limit × multiplier) score-ranked items and re-order it
// by `score + amplitude × seededJitter`, then return `limit` of them. The pool
// (top by RAW score) keeps the rail on-taste; the jitter term makes near-equal
// peers swap across seeds (freshness) while the score term keeps a strong like
// dominant (eager re-rank). With ≤ limit candidates the slice is the whole pool
// — still deterministic for a fixed seed, so the play-freeze snapshot is stable.
const pickFreshSlice = (
  ranked: Array<{ station: StationLite; score: number }>,
  rotationSeed: number,
  limit: number
): StationLite[] => {
  const pool = ranked.slice(0, Math.max(limit, limit * FRESH_POOL_MULTIPLIER));
  const freshKey = (item: { station: StationLite; score: number }) =>
    item.score + FRESH_ROTATION_AMPLITUDE * seededJitter(item.station.stationuuid, rotationSeed);
  pool.sort(
    (left, right) =>
      freshKey(right) - freshKey(left) ||
      left.station.name.localeCompare(right.station.name)
  );
  return pool.slice(0, limit).map((item) => item.station);
};

export const recordSectionVisit = (profile: BehaviorProfile, section: AppSection): BehaviorProfile => ({
  ...profile,
  lastUpdatedAt: Date.now(),
  sectionVisits: {
    ...profile.sectionVisits,
    [section]: Math.min(999, (profile.sectionVisits[section] || 0) + 1)
  }
});

export const recordStationSignal = (
  profile: BehaviorProfile,
  station: StationLite,
  action: BehaviorActionKind,
  weightOverride?: number
): BehaviorProfile => {
  const weight = weightOverride ?? ACTION_WEIGHTS[action];
  const nextTags = { ...profile.tagScores };
  const nextCountries = { ...profile.countryScores };
  const nextStates = { ...profile.stateScores };
  const nextStations = { ...profile.stationScores };

  addScore(nextStations, station.stationuuid, weight * 1.35);
  firstTags(station).forEach((tag, index) => {
    const multiplier = index === 0 ? 1 : index === 1 ? 0.84 : 0.66;
    addScore(nextTags, tag, weight * multiplier);
  });
  addScore(nextCountries, normalizeLabel(station.country), weight * 0.92);
  addScore(nextStates, normalizeLabel(station.state), weight * 0.74);

  return {
    ...profile,
    lastUpdatedAt: Date.now(),
    actionCounts: {
      plays: profile.actionCounts.plays + (action === 'play' ? 1 : 0),
      likes: profile.actionCounts.likes + (action === 'favorite' ? 1 : 0),
      copies: profile.actionCounts.copies + (action === 'track-copy' ? 1 : 0),
      follows: profile.actionCounts.follows + (action === 'follow' ? 1 : 0),
      collections: profile.actionCounts.collections + (action === 'collection' ? 1 : 0)
    },
    tagScores: trimScores(nextTags, SCORE_LIMITS.tags),
    countryScores: trimScores(nextCountries, SCORE_LIMITS.countries),
    stateScores: trimScores(nextStates, SCORE_LIMITS.states),
    stationScores: trimScores(nextStations, SCORE_LIMITS.stations)
  };
};

export const createHomeRecommendationFeed = ({
  catalog,
  favorites,
  recent,
  queuePreview,
  playbackHistory,
  trackHistory,
  collections,
  followedStations,
  followedRegions = [],
  behaviorProfile,
  currentStation,
  rotationSeed
}: CreateHomeRecommendationFeedInput): HomeRecommendationFeed => {
  const stationById = new Map<string, StationLite>();
  mergeUniqueStations(catalog, favorites, recent, queuePreview, playbackHistory).forEach((station) => {
    stationById.set(station.stationuuid, station);
  });

  const followedSeed = followedStations
    .map((item) => stationById.get(item.stationId) || null)
    .filter(Boolean) as StationLite[];
  const collectionSeed = collections
    .flatMap((collection) => collection.stationIds.map((stationId) => stationById.get(stationId) || null))
    .filter(Boolean) as StationLite[];
  const copiedTrackSeed = trackHistory
    .map((item) => stationById.get(item.stationId) || null)
    .filter(Boolean) as StationLite[];
  const historySeed = [...playbackHistory].slice(-8).reverse();
  const regionSeed = stationsForRegions(catalog, followedRegions, 16);

  const seedProfile = buildAffinityProfile([
    { stations: favorites, weight: 8 },
    { stations: followedSeed, weight: 7 },
    { stations: regionSeed, weight: 6 },
    { stations: collectionSeed, weight: 5 },
    { stations: copiedTrackSeed, weight: 9 },
    { stations: historySeed, weight: 4 }
  ]);

  const actionTotal =
    behaviorProfile.actionCounts.plays +
    behaviorProfile.actionCounts.likes +
    behaviorProfile.actionCounts.copies +
    behaviorProfile.actionCounts.follows +
    behaviorProfile.actionCounts.collections;

  const tasteSignals = [
    ...topEntries(behaviorProfile.tagScores, 'tag', 3),
    ...topEntries(behaviorProfile.countryScores, 'country', 2),
    ...topEntries(behaviorProfile.stateScores, 'state', 1)
  ]
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);

  const dominantCountry = topEntries(behaviorProfile.countryScores, 'country', 1)[0]?.label || '';
  const seenIds = new Set<string>(
    mergeUniqueStations(
      currentStation ? [currentStation] : [],
      queuePreview,
      recent.slice(0, 8),
      favorites.slice(0, 12)
    ).map((station) => station.stationuuid)
  );

  const tunedForYou = rankStations(
    catalog,
    behaviorProfile,
    rotationSeed,
    (station) => !seenIds.has(station.stationuuid),
    4,
    2.1
  );
  const reservedIds = new Set(tunedForYou.map((station) => station.stationuuid));
  const becauseYouLiked = rankStations(
    catalog,
    seedProfile,
    rotationSeed + 17,
    (station) => !reservedIds.has(station.stationuuid) && !seenIds.has(station.stationuuid),
    4,
    1.45
  );
  becauseYouLiked.forEach((station) => reservedIds.add(station.stationuuid));

  const outsideOrbit = rankStations(
    catalog,
    behaviorProfile,
    rotationSeed + 31,
    (station) =>
      !reservedIds.has(station.stationuuid) &&
      !seenIds.has(station.stationuuid) &&
      (!dominantCountry || normalizeKey(station.country) !== normalizeKey(dominantCountry)),
    4,
    1.15
  );

  const returnToAir = mergeUniqueStations(
    currentStation ? [currentStation] : [],
    queuePreview,
    recent.slice(0, 3),
    historySeed.slice(0, 2)
  ).slice(0, 4);

  return {
    profileReady: actionTotal >= 3 || tasteSignals.length > 0,
    actionTotal,
    tasteSignals,
    tunedForYou,
    becauseYouLiked,
    outsideOrbit,
    returnToAir
  };
};

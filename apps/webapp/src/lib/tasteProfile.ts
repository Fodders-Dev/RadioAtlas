import type { StationLite } from '../types';
import {
  filterStationsByPlayability,
  getStationPlayabilityScore,
  type StationPlayabilityProfile
} from './stationPlayability';
import {
  getStationHealthScore,
  type StationHealthProfile
} from './stationHealth';
import {
  getSessionExcludedStationIds,
  getSessionStationScore,
  type RadioSessionEvent
} from './radioSession';

export type TasteSignalAction =
  | 'play-started'
  | 'listened-30s'
  | 'skip-before-10s'
  | 'liked'
  | 'unliked'
  | 'saved-to-collection'
  | 'replayed-later'
  | 'station-failed';

export type TasteSessionMode = 'personal' | 'resume' | 'search' | 'globe' | 'collection';

export type TasteSignal = {
  stationId: string;
  action: TasteSignalAction;
  mode: TasteSessionMode;
  timestamp: number;
  weight: number;
};

export type TasteProfileV2 = {
  version: 2;
  lastUpdatedAt: number | null;
  signals: TasteSignal[];
  hiddenStationIds: string[];
  stationScores: Record<string, number>;
  tagScores: Record<string, number>;
  countryScores: Record<string, number>;
  languageScores: Record<string, number>;
  modeScores: Partial<Record<TasteSessionMode, number>>;
};

export type TasteRecommendationContext = {
  mode: TasteSessionMode;
  currentStation?: StationLite | null;
  seed?: number;
  limit?: number;
  now?: number;
  healthProfile?: StationHealthProfile | null;
  sessionEvents?: RadioSessionEvent[];
};

export const DEFAULT_TASTE_PROFILE_V2: TasteProfileV2 = {
  version: 2,
  lastUpdatedAt: null,
  signals: [],
  hiddenStationIds: [],
  stationScores: {},
  tagScores: {},
  countryScores: {},
  languageScores: {},
  modeScores: {}
};

const MAX_TASTE_SIGNALS = 240;
const MAX_STATION_SCORES = 140;
const MAX_TAG_SCORES = 36;
const MAX_COUNTRY_SCORES = 30;
const MAX_LANGUAGE_SCORES = 24;
const SIGNAL_TTL_MS = 1000 * 60 * 60 * 24 * 45;
const DECAY_HALF_LIFE_MS = 1000 * 60 * 60 * 24 * 10;
const ACTION_WEIGHTS: Record<TasteSignalAction, number> = {
  'play-started': 1.8,
  'listened-30s': 5.4,
  'skip-before-10s': -5.8,
  liked: 12,
  unliked: -10,
  'saved-to-collection': 8,
  'replayed-later': 5,
  'station-failed': -8
};

const normalizeLabel = (value?: string | null) =>
  value?.trim().replace(/\s+/g, ' ').replace(/^#+/, '').trim() || '';

const stationLanguage = (station: StationLite) =>
  normalizeLabel((station as StationLite & { language?: string }).language);

const firstTags = (station: StationLite, limit = 5) =>
  (station.tags || '')
    .split(',')
    .map(normalizeLabel)
    .filter((tag) => tag && tag.toLowerCase() !== 'no tags')
    .slice(0, limit);

const hashValue = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
};

// Mix a station's stable hash with the rotation seed so that changing the seed
// actually permutes the order. hashValue(`${id}:${seed}`) does NOT: the seed is
// a low-order suffix, so a new seed shifts every station's hash by the SAME
// amount and the relative order is preserved — which is why the rails looked
// frozen across re-opens / «Обновить». The fmix-style finalizer below avalanches
// the combined bits so any seed change reshuffles the whole set. Returns 0..1.
const seededJitter = (id: string, seed: number) => {
  let h = (hashValue(id) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h % 1000) / 1000;
};

const addScore = (target: Record<string, number>, key: string, value: number) => {
  if (!key || !Number.isFinite(value) || value === 0) return;
  target[key] = Number(((target[key] || 0) + value).toFixed(4));
};

const trimScores = (source: Record<string, number>, limit: number) =>
  Object.fromEntries(
    Object.entries(source)
      .filter(([, score]) => Math.abs(score) >= 0.08)
      .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]) || left[0].localeCompare(right[0]))
      .slice(0, limit)
  );

const decayFactor = (profile: TasteProfileV2, now: number) => {
  if (!profile.lastUpdatedAt) return 1;
  const age = Math.max(0, now - profile.lastUpdatedAt);
  return Math.max(0.22, Math.pow(0.5, age / DECAY_HALF_LIFE_MS));
};

const decayScores = (scores: Record<string, number>, factor: number) =>
  Object.fromEntries(
    Object.entries(scores)
      .map(([key, score]) => [key, Number((score * factor).toFixed(4))])
      .filter(([, score]) => Math.abs(Number(score)) >= 0.08)
  ) as Record<string, number>;

const trimSignals = (signals: TasteSignal[], now: number) =>
  signals
    .filter((signal) => now - signal.timestamp <= SIGNAL_TTL_MS)
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, MAX_TASTE_SIGNALS);

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

const qualityScore = (station: StationLite) =>
  (station.isVerified ? 1.15 : 0) + (station.isClaimed ? 0.4 : 0) - (station.promoted ? 0.2 : 0);

const FAVORITE_STATION_SCORE_FLOOR = 15;
const FAVORITE_PRIMARY_TAG_SCORE = 10.5;
const FAVORITE_COUNTRY_SCORE = 5.2;
const FAVORITE_LANGUAGE_SCORE = 4.1;

const applyScoreFloor = (target: Record<string, number>, key: string, value: number) => {
  if (!key || !Number.isFinite(value) || value <= 0) return;
  target[key] = Math.max(target[key] || 0, Number(value.toFixed(4)));
};

export const getTasteProfileUpdatedAt = (profile: TasteProfileV2 | null | undefined) =>
  profile?.lastUpdatedAt ||
  profile?.signals?.reduce((latest, signal) => Math.max(latest, signal.timestamp), 0) ||
  0;

const normalizeTasteProfile = (profile: TasteProfileV2 | null | undefined): TasteProfileV2 =>
  profile?.version === 2
    ? {
        ...DEFAULT_TASTE_PROFILE_V2,
        ...profile,
        hiddenStationIds: Array.isArray(profile.hiddenStationIds)
          ? profile.hiddenStationIds.filter(Boolean).slice(0, 160)
          : []
      }
    : DEFAULT_TASTE_PROFILE_V2;

// T_audit_9: a coarse fingerprint of what the user's taste currently FAVOURS —
// the rank-ordered ids of the top tags, plus the size of the hidden-station
// set. Home's surface memo reads the live tasteProfile through a ref (so a play
// burst doesn't re-shuffle rails mid-scroll), which also meant taste only
// propagated at the next 30-min session-bucket flip. The home snapshot now also
// carries this signature and the freshness gate compares it, so a meaningful
// taste shift re-ranks the surface eagerly — but a single `play-started`
// (+1.71 to its primary tag) nudges scores too little to reorder the top tags,
// while a `liked` (+11.4) / `skip-before-10s` (−2.44…−12) / hide does. Ids, not
// raw weights: magnitude churn from a play-nudge never leaks into the signature.
export const TASTE_SIGNATURE_TOP_TAGS = 8;
// Only tags the user has FAVOURED past this score feed the signature. This is
// the churn guard: a single play-started (+1.71 to its tag) or the incidental
// skip-before-10s on the outgoing station when you switch stations (−4.2) stay
// below it, so browsing/playing never reorders the top set → snapshot stays
// frozen (T1.2). An explicit liked (+11.4) or saved-to-collection (+7.6), or
// sustained listening, crosses it → the surface re-ranks. The threshold sits
// between a single listened-30s (≈5.1) and a save (≈7.6).
export const TASTE_SIGNATURE_MIN_SCORE = 7;

export const tasteSignature = (profile: TasteProfileV2 | null | undefined): string => {
  const normalized = normalizeTasteProfile(profile);
  const topTags = Object.entries(normalized.tagScores)
    .filter(([, score]) => score >= TASTE_SIGNATURE_MIN_SCORE)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, TASTE_SIGNATURE_TOP_TAGS)
    .map(([tag]) => tag)
    .join('>');
  return `${topTags}|h:${normalized.hiddenStationIds.length}`;
};

// Favorites are the most explicit taste signal in the product. Keep them as a
// pure ranking overlay so synced/legacy favorites influence recommendations even
// if their historical `liked` signals were never recorded or have decayed away.
export const withFavoriteTasteBoosts = (
  profile: TasteProfileV2 | null | undefined,
  favorites: StationLite[] | null | undefined
): TasteProfileV2 => {
  const base = normalizeTasteProfile(profile);
  const likedStations = uniqueStations((favorites || []).filter((station) => Boolean(station?.stationuuid)));
  if (!likedStations.length) return base;

  const stationScores = { ...base.stationScores };
  const tagFloors: Record<string, number> = {};
  const countryFloors: Record<string, number> = {};
  const languageFloors: Record<string, number> = {};

  likedStations.forEach((station) => {
    applyScoreFloor(stationScores, station.stationuuid, FAVORITE_STATION_SCORE_FLOOR);
    firstTags(station).forEach((tag, index) => {
      addScore(tagFloors, tag, FAVORITE_PRIMARY_TAG_SCORE * (index === 0 ? 1 : index === 1 ? 0.62 : 0.38));
    });
    addScore(countryFloors, normalizeLabel(station.country), FAVORITE_COUNTRY_SCORE);
    addScore(languageFloors, stationLanguage(station), FAVORITE_LANGUAGE_SCORE);
  });

  const tagScores = { ...base.tagScores };
  const countryScores = { ...base.countryScores };
  const languageScores = { ...base.languageScores };
  Object.entries(tagFloors).forEach(([tag, score]) => applyScoreFloor(tagScores, tag, score));
  Object.entries(countryFloors).forEach(([country, score]) => applyScoreFloor(countryScores, country, score));
  Object.entries(languageFloors).forEach(([language, score]) => applyScoreFloor(languageScores, language, score));

  return {
    ...base,
    stationScores: trimScores(stationScores, MAX_STATION_SCORES),
    tagScores: trimScores(tagScores, MAX_TAG_SCORES),
    countryScores: trimScores(countryScores, MAX_COUNTRY_SCORES),
    languageScores: trimScores(languageScores, MAX_LANGUAGE_SCORES)
  };
};

const mergeScoreMaps = (limit: number, ...sources: Array<Record<string, number> | null | undefined>) =>
  trimScores(
    sources.reduce<Record<string, number>>((scores, source) => {
      Object.entries(source || {}).forEach(([key, value]) => {
        if (!Number.isFinite(value)) return;
        addScore(scores, key, value);
      });
      return scores;
    }, {}),
    limit
  );

const scoreMapsMatch = (left: Record<string, number>, right: Record<string, number>) => {
  const leftEntries = Object.entries(left).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  const rightEntries = Object.entries(right).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([key, value], index) => {
      const candidate = rightEntries[index];
      return key === candidate?.[0] && value === candidate?.[1];
    })
  );
};

export const mergeTasteProfiles = (
  ...profiles: Array<TasteProfileV2 | null | undefined>
): TasteProfileV2 => {
  const validProfiles = profiles.map(normalizeTasteProfile);
  const latest = Math.max(0, ...validProfiles.map((profile) => profile.lastUpdatedAt || 0));
  const now = latest || Date.now();
  const signalMap = new Map<string, TasteSignal>();

  validProfiles
    .flatMap((profile) => profile.signals || [])
    .forEach((signal) => {
      if (!signal.stationId || !Number.isFinite(signal.timestamp) || !Number.isFinite(signal.weight)) return;
      const key = `${signal.stationId}:${signal.action}:${signal.mode}:${signal.timestamp}`;
      const previous = signalMap.get(key);
      if (!previous || Math.abs(signal.weight) > Math.abs(previous.weight)) {
        signalMap.set(key, signal);
      }
    });

  return {
    version: 2,
    lastUpdatedAt: latest || null,
    signals: trimSignals(Array.from(signalMap.values()), now),
    hiddenStationIds: Array.from(
      new Set(validProfiles.flatMap((profile) => profile.hiddenStationIds || []))
    ).slice(0, 160),
    stationScores: mergeScoreMaps(MAX_STATION_SCORES, ...validProfiles.map((profile) => profile.stationScores)),
    tagScores: mergeScoreMaps(MAX_TAG_SCORES, ...validProfiles.map((profile) => profile.tagScores)),
    countryScores: mergeScoreMaps(MAX_COUNTRY_SCORES, ...validProfiles.map((profile) => profile.countryScores)),
    languageScores: mergeScoreMaps(MAX_LANGUAGE_SCORES, ...validProfiles.map((profile) => profile.languageScores)),
    modeScores: mergeScoreMaps(MAX_LANGUAGE_SCORES, ...validProfiles.map((profile) => profile.modeScores))
  };
};

export const tasteProfilesMatch = (
  left: TasteProfileV2 | null | undefined,
  right: TasteProfileV2 | null | undefined
) => {
  const leftValue = normalizeTasteProfile(left);
  const rightValue = normalizeTasteProfile(right);
  return (
    leftValue.lastUpdatedAt === rightValue.lastUpdatedAt &&
    leftValue.hiddenStationIds.length === rightValue.hiddenStationIds.length &&
    leftValue.hiddenStationIds.every((stationId, index) => stationId === rightValue.hiddenStationIds[index]) &&
    leftValue.signals.length === rightValue.signals.length &&
    leftValue.signals.every((signal, index) => {
      const candidate = rightValue.signals[index];
      return (
        signal.stationId === candidate?.stationId &&
        signal.action === candidate?.action &&
        signal.mode === candidate?.mode &&
        signal.timestamp === candidate?.timestamp &&
        signal.weight === candidate?.weight
      );
    }) &&
    scoreMapsMatch(leftValue.stationScores, rightValue.stationScores) &&
    scoreMapsMatch(leftValue.tagScores, rightValue.tagScores) &&
    scoreMapsMatch(leftValue.countryScores, rightValue.countryScores) &&
    scoreMapsMatch(leftValue.languageScores, rightValue.languageScores) &&
    scoreMapsMatch(leftValue.modeScores as Record<string, number>, rightValue.modeScores as Record<string, number>)
  );
};

export const recordTasteSignal = (
  profile: TasteProfileV2,
  station: StationLite,
  action: TasteSignalAction,
  {
    mode = 'personal',
    now = Date.now(),
    weightOverride
  }: {
    mode?: TasteSessionMode;
    now?: number;
    weightOverride?: number;
  } = {}
): TasteProfileV2 => {
  const base = normalizeTasteProfile(profile);
  const weight = weightOverride ?? ACTION_WEIGHTS[action];
  if (!station.stationuuid || !Number.isFinite(weight) || weight === 0) return base;

  const factor = decayFactor(base, now);
  const nextStationScores = decayScores(base.stationScores, factor);
  const nextTagScores = decayScores(base.tagScores, factor);
  const nextCountryScores = decayScores(base.countryScores, factor);
  const nextLanguageScores = decayScores(base.languageScores, factor);
  const nextModeScores = { ...base.modeScores };

  addScore(nextStationScores, station.stationuuid, weight * (weight > 0 ? 1.28 : 1.45));
  firstTags(station).forEach((tag, index) => {
    const multiplier = weight > 0 ? (index === 0 ? 0.95 : 0.58) : index === 0 ? 0.42 : 0.22;
    addScore(nextTagScores, tag, weight * multiplier);
  });
  addScore(nextCountryScores, normalizeLabel(station.country), weight * (weight > 0 ? 0.62 : 0.28));
  addScore(nextLanguageScores, stationLanguage(station), weight * (weight > 0 ? 0.48 : 0.2));
  nextModeScores[mode] = Number((((nextModeScores[mode] || 0) * factor) + Math.abs(weight)).toFixed(4));

  return {
    version: 2,
    lastUpdatedAt: now,
    signals: trimSignals(
      [
        {
          stationId: station.stationuuid,
          action,
          mode,
          timestamp: now,
          weight
        },
        ...(base.signals || [])
      ],
      now
    ),
    hiddenStationIds: base.hiddenStationIds || [],
    stationScores: trimScores(nextStationScores, MAX_STATION_SCORES),
    tagScores: trimScores(nextTagScores, MAX_TAG_SCORES),
    countryScores: trimScores(nextCountryScores, MAX_COUNTRY_SCORES),
    languageScores: trimScores(nextLanguageScores, MAX_LANGUAGE_SCORES),
    modeScores: nextModeScores
  };
};

export const isStationHiddenFromRecommendations = (
  profile: TasteProfileV2 | null | undefined,
  station: StationLite | string
) => {
  const stationId = typeof station === 'string' ? station : station.stationuuid;
  if (!stationId) return false;
  return normalizeTasteProfile(profile).hiddenStationIds.includes(stationId);
};

export const hideStationFromTasteProfile = (
  profile: TasteProfileV2,
  station: StationLite | string,
  now = Date.now()
): TasteProfileV2 => {
  const base = normalizeTasteProfile(profile);
  const stationId = typeof station === 'string' ? station : station.stationuuid;
  if (!stationId || base.hiddenStationIds.includes(stationId)) return base;
  return {
    ...base,
    lastUpdatedAt: now,
    hiddenStationIds: [stationId, ...base.hiddenStationIds].slice(0, 160),
    stationScores: {
      ...base.stationScores,
      [stationId]: Math.min(-18, base.stationScores[stationId] || 0)
    }
  };
};

export const unhideStationFromTasteProfile = (
  profile: TasteProfileV2,
  station: StationLite | string,
  now = Date.now()
): TasteProfileV2 => {
  const base = normalizeTasteProfile(profile);
  const stationId = typeof station === 'string' ? station : station.stationuuid;
  if (!stationId || !base.hiddenStationIds.includes(stationId)) return base;
  return {
    ...base,
    lastUpdatedAt: now,
    hiddenStationIds: base.hiddenStationIds.filter((item) => item !== stationId)
  };
};

// Per-seed rotation strength for «Моя Волна» (see rankStationsForUser). A flat
// floor lets even low-taste matches rotate; the taste fraction widens the shuffle
// for stronger matches so a genre's near-equal stations vary run-to-run without
// a clearly stronger pick ever sinking below a weaker one.
const TASTE_ROTATION_FLOOR = 1.4;
const TASTE_ROTATION_TASTE_FRACTION = 0.22;

const tasteScore = (station: StationLite, profile: TasteProfileV2 | null | undefined) => {
  if (!profile || profile.version !== 2) return 0;
  const stationScore = profile.stationScores[station.stationuuid] || 0;
  const tagScore = firstTags(station).reduce(
    (sum, tag, index) => sum + (profile.tagScores[tag] || 0) * (index === 0 ? 1.05 : 0.64),
    0
  );
  const countryScore = profile.countryScores[normalizeLabel(station.country)] || 0;
  const languageScore = profile.languageScores[stationLanguage(station)] || 0;
  return stationScore * 0.58 + tagScore * 0.96 + countryScore * 0.62 + languageScore * 0.45;
};

export const rankStationsForUser = (
  stations: StationLite[],
  profile: TasteProfileV2 | null | undefined,
  playabilityProfile: StationPlayabilityProfile | null | undefined,
  {
    currentStation = null,
    seed = 0,
    limit = stations.length,
    now = Date.now(),
    healthProfile = null,
    sessionEvents = []
  }: TasteRecommendationContext = { mode: 'personal' }
) => {
  const currentId = currentStation?.stationuuid || null;
  const hiddenIds = new Set(normalizeTasteProfile(profile).hiddenStationIds);
  const stationPool = uniqueStations(stations);
  const sessionExcludedIds = getSessionExcludedStationIds(sessionEvents, now);
  return filterStationsByPlayability(stationPool, playabilityProfile, now, healthProfile)
    .filter((station) => station.stationuuid !== currentId && !hiddenIds.has(station.stationuuid))
    .filter((station) => !sessionExcludedIds.has(station.stationuuid))
    .map((station, index) => {
      const taste = tasteScore(station, profile);
      // Per-seed rotation so «Моя Волна» surfaces DIFFERENT likeable stations
      // each refresh/session instead of «каждый раз одно и то же». The old
      // jitter * 0.18 was swamped by taste scores in the tens; scale it to a
      // taste band (flat floor + a slice of the station's own taste) so it
      // reshuffles near-equal matches within the user's genres while a clearly
      // stronger match still leads. Seeded → deterministic per seed.
      const jitter = seededJitter(station.stationuuid, seed);
      const rotation = jitter * (TASTE_ROTATION_FLOOR + Math.max(0, taste) * TASTE_ROTATION_TASTE_FRACTION);
      const score =
        taste +
        getSessionStationScore(station, sessionEvents, stationPool, now) +
        getStationPlayabilityScore(playabilityProfile, station, now) * 2.8 +
        getStationHealthScore(healthProfile, station, now) * 2.4 +
        qualityScore(station) +
        rotation;

      return {
        station,
        index,
        score
      };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, Math.max(0, limit))
    .map((item) => item.station);
};

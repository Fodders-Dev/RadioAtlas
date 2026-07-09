import type { FollowedRegion, FollowedStation, UserCollection } from '../domain/contracts';
import type { StationLite } from '../types';
import {
  createHomeRecommendationFeed,
  type BehaviorProfile
} from './homeProfile';
import {
  type StationPlayabilityProfile
} from './stationPlayability';
import type { StationHealthProfile } from './stationHealth';
import { diversifyStationOrder } from './stationDiversity';
import {
  getSessionExcludedStationIds,
  recordRadioSessionEvent,
  type RadioSessionEvent,
  type RadioSessionMode
} from './radioSession';
import {
  isStationHiddenFromRecommendations,
  rankStationsForUser,
  withFavoriteTasteBoosts,
  type TasteProfileV2
} from './tasteProfile';
import { stationsForRegions } from './regionRecommendations';

export { recordRadioSessionEvent };
export type { RadioSessionEvent, RadioSessionMode };

export type RecommendationContext = {
  mode: RadioSessionMode;
  currentStation: StationLite | null;
  seed: number;
  limit?: number;
  now?: number;
};

export type PersonalRadioQueue = {
  mode: 'personal';
  sourceId: 'personal-radio';
  stations: StationLite[];
  builtAt: number;
};

export const PERSONAL_RADIO_QUEUE_LIMIT = 18;

const mergeStations = (...groups: StationLite[][]) => {
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

const stationsFromCollections = (catalog: StationLite[], collections: UserCollection[]) => {
  const stationById = new Map(catalog.map((station) => [station.stationuuid, station]));
  return collections.flatMap((collection) =>
    collection.stationIds
      .map((stationId) => stationById.get(stationId))
      .filter((station): station is StationLite => Boolean(station))
  );
};

const stationsFromFollows = (catalog: StationLite[], followedStations: FollowedStation[]) => {
  const stationById = new Map(catalog.map((station) => [station.stationuuid, station]));
  return followedStations
    .map((follow) => stationById.get(follow.stationId))
    .filter((station): station is StationLite => Boolean(station));
};

export const buildPersonalRadioQueue = ({
  catalog,
  favorites,
  recent,
  queuePreview,
  playbackHistory,
  trackHistory,
  collections,
  followedStations,
  followedRegions,
  behaviorProfile,
  playabilityProfile,
  tasteProfile,
  healthProfile,
  sessionEvents = [],
  context
}: {
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
  playabilityProfile: StationPlayabilityProfile;
  tasteProfile?: TasteProfileV2 | null;
  healthProfile?: StationHealthProfile | null;
  sessionEvents?: RadioSessionEvent[];
  context: RecommendationContext;
}): PersonalRadioQueue => {
  const limit = Math.max(1, Math.min(context.limit ?? PERSONAL_RADIO_QUEUE_LIMIT, 20));
  const now = context.now ?? Date.now();
  const effectiveTasteProfile = withFavoriteTasteBoosts(tasteProfile, favorites);
  const rankedCatalog = rankStationsForUser(catalog, effectiveTasteProfile, playabilityProfile, {
    mode: context.mode,
    currentStation: context.currentStation,
    seed: context.seed,
    limit: catalog.length,
    now,
    healthProfile,
    sessionEvents
  });
  const recommendationFeed = createHomeRecommendationFeed({
    catalog: rankedCatalog,
    favorites,
    recent,
    queuePreview,
    playbackHistory,
    trackHistory,
    collections,
    followedStations,
    followedRegions: followedRegions || [],
    behaviorProfile,
    currentStation: context.currentStation,
    rotationSeed: context.seed
  });
  const collectionStations = stationsFromCollections(rankedCatalog, collections);
  const followedStationPool = stationsFromFollows(rankedCatalog, followedStations);
  const followedRegionPool = stationsForRegions(rankedCatalog, followedRegions || [], 18);
  const currentId = context.currentStation?.stationuuid || null;
  const sessionExcludedIds = getSessionExcludedStationIds(sessionEvents, now);
  const queue = diversifyStationOrder(mergeStations(
    recommendationFeed.tunedForYou,
    recommendationFeed.becauseYouLiked,
    favorites,
    followedStationPool,
    followedRegionPool,
    collectionStations,
    recent,
    recommendationFeed.outsideOrbit,
    rankedCatalog
  ).filter(
    (station) =>
      station.stationuuid !== currentId &&
      !sessionExcludedIds.has(station.stationuuid) &&
      !isStationHiddenFromRecommendations(effectiveTasteProfile, station)
  ), {
    limit,
    maxPerCountry: 4,
    maxPerPrimaryTag: 5,
    maxPerNameKey: 1
  });

  return {
    mode: 'personal',
    sourceId: 'personal-radio',
    stations: queue,
    builtAt: Date.now()
  };
};

export const refillPersonalRadioQueueItems = ({
  currentItems,
  currentIndex,
  candidates,
  tailSize = PERSONAL_RADIO_QUEUE_LIMIT,
  maxItems = 120
}: {
  currentItems: StationLite[];
  currentIndex: number;
  candidates: StationLite[];
  tailSize?: number;
  maxItems?: number;
}) => {
  if (currentIndex < 0 || !currentItems.length) {
    return currentItems.slice(0, maxItems);
  }

  const existingIds = new Set(currentItems.map((station) => station.stationuuid));
  const additions = candidates.filter((station) => {
    if (existingIds.has(station.stationuuid)) return false;
    existingIds.add(station.stationuuid);
    return true;
  });
  const targetLength = Math.min(maxItems, currentIndex + 1 + tailSize);
  if (currentItems.length >= targetLength || !additions.length) {
    return currentItems.slice(0, maxItems);
  }

  return [...currentItems, ...additions].slice(0, targetLength);
};

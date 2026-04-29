import type { FollowedStation, UserCollection } from '../domain/contracts';
import type { StationLite } from '../types';
import {
  createHomeRecommendationFeed,
  type BehaviorProfile
} from './homeProfile';
import {
  rankStationsForHome,
  type StationPlayabilityProfile
} from './stationPlayability';

export type RadioSessionMode = 'personal' | 'resume' | 'search' | 'globe' | 'collection';

export type RadioSessionEvent = {
  stationId: string;
  action: 'queued' | 'play-started' | 'play-success' | 'skip' | 'like' | 'hide' | 'failed';
  mode: RadioSessionMode;
  timestamp: number;
};

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
const MAX_SESSION_EVENTS = 120;

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

export const recordRadioSessionEvent = (
  events: RadioSessionEvent[],
  event: RadioSessionEvent
): RadioSessionEvent[] => [event, ...events].slice(0, MAX_SESSION_EVENTS);

export const buildPersonalRadioQueue = ({
  catalog,
  favorites,
  recent,
  queuePreview,
  playbackHistory,
  trackHistory,
  collections,
  followedStations,
  behaviorProfile,
  playabilityProfile,
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
  behaviorProfile: BehaviorProfile;
  playabilityProfile: StationPlayabilityProfile;
  context: RecommendationContext;
}): PersonalRadioQueue => {
  const limit = Math.max(1, Math.min(context.limit ?? PERSONAL_RADIO_QUEUE_LIMIT, 20));
  const now = context.now ?? Date.now();
  const rankedCatalog = rankStationsForHome(catalog, playabilityProfile, {
    limit: catalog.length,
    now
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
    behaviorProfile,
    currentStation: context.currentStation,
    rotationSeed: context.seed
  });
  const collectionStations = stationsFromCollections(rankedCatalog, collections);
  const followedStationPool = stationsFromFollows(rankedCatalog, followedStations);
  const currentId = context.currentStation?.stationuuid || null;
  const queue = mergeStations(
    recommendationFeed.tunedForYou,
    recommendationFeed.becauseYouLiked,
    favorites,
    followedStationPool,
    collectionStations,
    recent,
    recommendationFeed.outsideOrbit,
    rankedCatalog
  ).filter((station) => station.stationuuid !== currentId);

  return {
    mode: 'personal',
    sourceId: 'personal-radio',
    stations: queue.slice(0, limit),
    builtAt: Date.now()
  };
};

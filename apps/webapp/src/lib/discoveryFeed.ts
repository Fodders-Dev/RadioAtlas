import type {
  DiscoveryFeed,
  DiscoveryMetrics,
  DiscoveryStationModule,
  FollowedRegion,
  FollowedStation,
  ProviderKind,
  SyncedTrackHistoryItem,
  UserCollection
} from '../domain/contracts';
import type { StationLite } from '../types';

const hashValue = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const seededSort = <T,>(items: T[], seed: number, pickKey: (item: T) => string) =>
  [...items].sort((left, right) => {
    const leftScore = hashValue(`${pickKey(left)}:${seed}`);
    const rightScore = hashValue(`${pickKey(right)}:${seed}`);
    return leftScore - rightScore;
  });

const firstMeaningfulTag = (value: string) =>
  value
    .split(',')
    .map((tag) => tag.trim())
    .find((tag) => tag && tag.toLowerCase() !== 'no tags') || '';

const uniqueStations = (stations: Array<StationLite | null | undefined>) => {
  const seen = new Set<string>();
  return stations.filter((station): station is StationLite => {
    if (!station || seen.has(station.stationuuid)) return false;
    seen.add(station.stationuuid);
    return true;
  });
};

const withoutStationIds = (stations: StationLite[], blockedIds: Set<string>) =>
  stations.filter((station) => !blockedIds.has(station.stationuuid));

const buildStationModule = (
  kind: DiscoveryStationModule['kind'],
  titleKey: string,
  copyKey: string,
  sourceId: string,
  stations: StationLite[],
  extras: Partial<DiscoveryStationModule> = {}
): DiscoveryStationModule => ({
  kind,
  titleKey,
  copyKey,
  sourceId,
  stations,
  ...extras
});

type GlobeAreaLike = {
  id: string;
  label: string;
  subtitle: string;
  count: number;
  stations: StationLite[];
};

export type GlobeDiscoveryRoute = {
  id: string;
  label: string;
  subtitle: string;
  count: number;
};

export type GlobeDiscoveryFeed = {
  hotAreas: GlobeDiscoveryRoute[];
  countryRoutes: GlobeDiscoveryRoute[];
  fallbackStations: StationLite[];
};

type CreateGlobeDiscoveryFeedInput = {
  areas: GlobeAreaLike[];
  selectedAreaId?: string | null;
  activeAreaId?: string | null;
  favorites: StationLite[];
  recent: StationLite[];
};

export type LibraryDiscoveryFeed = {
  returnToAir: StationLite[];
  favoritesPreview: StationLite[];
  journalPreview: SyncedTrackHistoryItem[];
  collectionsPreview: UserCollection[];
  followedStationsPreview: FollowedStation[];
  followedRegionsPreview: FollowedRegion[];
  unreadAlerts: number;
  cloudSummary: {
    mode: 'cloud' | 'local';
    providerKinds: ProviderKind[];
    updatedAt: number | null;
  };
};

type CreateLibraryDiscoveryFeedInput = {
  current: StationLite | null;
  queuePreview: StationLite[];
  recent: StationLite[];
  favorites: StationLite[];
  playbackHistory: StationLite[];
  trackHistory: SyncedTrackHistoryItem[];
  collections: UserCollection[];
  followedStations: FollowedStation[];
  followedRegions: FollowedRegion[];
  alerts: Array<{ readAt: number | null }>;
  linkedProviders: ProviderKind[];
  libraryUpdatedAt: number | null;
};

type DiscoveryFeedInput = {
  catalog: StationLite[];
  favorites: StationLite[];
  recent: StationLite[];
  queuePreview: StationLite[];
  followedStations: FollowedStation[];
  collections: UserCollection[];
  showcaseSeed: number;
  query: string;
  metrics: DiscoveryMetrics;
  includeSponsored?: boolean;
};

export const createDiscoveryFeed = ({
  catalog,
  favorites,
  recent,
  queuePreview,
  followedStations,
  collections,
  showcaseSeed,
  query,
  metrics,
  includeSponsored = true
}: DiscoveryFeedInput): DiscoveryFeed => {
  const promotedCatalog = catalog.filter((station) => station.promoted);
  const organicCatalog = catalog.filter((station) => !station.promoted);
  const baseCatalog = organicCatalog.length ? organicCatalog : catalog;
  const discoveryDeck = seededSort(baseCatalog, showcaseSeed, (station) => station.stationuuid);
  const freshSignalsPool = discoveryDeck.slice(0, 8);
  const freshSignals = freshSignalsPool.slice(0, 4);
  const searchLaunch = discoveryDeck.slice(4, 8);

  const countryBuckets = Array.from(
    baseCatalog.reduce((map, station) => {
      const key = station.country?.trim();
      if (!key) return map;
      const bucket = map.get(key) || { label: key, stations: [] as StationLite[] };
      bucket.stations.push(station);
      map.set(key, bucket);
      return map;
    }, new Map<string, { label: string; stations: StationLite[] }>())
  )
    .map(([, bucket]) => bucket)
    .filter((bucket) => bucket.stations.length >= 3);

  const tagBuckets = Array.from(
    baseCatalog.reduce((map, station) => {
      const key = firstMeaningfulTag(station.tags || '');
      if (!key) return map;
      const bucket = map.get(key) || [];
      bucket.push(station);
      map.set(key, bucket);
      return map;
    }, new Map<string, StationLite[]>())
  )
    .filter(([, bucket]) => bucket.length >= 3)
    .map(([label, stations]) => ({ label, stations }));

  const blockedIds = new Set<string>();
  const blockStations = (stations: StationLite[]) => {
    stations.forEach((station) => blockedIds.add(station.stationuuid));
  };
  blockStations(freshSignals);
  blockStations(searchLaunch);

  const pickUniqueBucket = <T extends { label: string; stations: StationLite[] }>(
    buckets: T[],
    seed: number,
    limit: number
  ) => {
    const sorted = seededSort(buckets, seed, (bucket) => bucket.label);
    for (const bucket of sorted) {
      const uniquePool = seededSort(uniqueStations(bucket.stations), seed + limit + 11, (station) => station.stationuuid);
      const filtered = withoutStationIds(uniquePool, blockedIds).slice(0, limit);
      if (filtered.length) {
        blockStations(filtered);
        return {
          bucket,
          stations: filtered
        };
      }
    }
    return null;
  };

  const countrySpotlight = pickUniqueBucket(countryBuckets, showcaseSeed + 17, 4);
  const genreSpotlight = pickUniqueBucket(tagBuckets, showcaseSeed + 41, 4);
  const resumeStations = uniqueStations([...queuePreview, ...recent, ...favorites]).slice(0, 4);

  const followedPool = uniqueStations(
    followedStations
      .map((follow) => catalog.find((station) => station.stationuuid === follow.stationId) || null)
      .filter(Boolean)
  );
  const revivedStationsList = withoutStationIds(
    seededSort(followedPool.length ? followedPool : favorites, showcaseSeed + 63, (station) => station.stationuuid),
    blockedIds
  ).slice(0, 4);
  blockStations(revivedStationsList);

  const collectionStationIds = new Set(collections.flatMap((collection) => collection.stationIds));
  const sessionDeltaStations = withoutStationIds(
    uniqueStations(
      [...recent, ...queuePreview, ...catalog.filter((station) => collectionStationIds.has(station.stationuuid))]
        .filter((station) => !favorites.some((favorite) => favorite.stationuuid === station.stationuuid))
    ),
    blockedIds
  ).slice(0, 4);
  blockStations(sessionDeltaStations);

  const sponsoredStations = includeSponsored
    ? seededSort(promotedCatalog, showcaseSeed + 91, (station) => station.stationuuid).slice(0, 3)
    : [];

  const normalizedQuery = query.trim().toLowerCase();
  const quickResults = normalizedQuery
    ? catalog
        .filter((station) =>
          [station.name, station.country, station.tags, station.language]
            .join(' ')
            .toLowerCase()
            .includes(normalizedQuery)
        )
        .slice(0, 4)
    : searchLaunch.length
      ? searchLaunch
      : freshSignals;

  const tagRadar = seededSort(tagBuckets, showcaseSeed + 67, (bucket) => bucket.label)
    .slice(0, 6)
    .map((bucket) => ({
      label: bucket.label,
      count: bucket.stations.length
    }));

  const resumeModules = [
    buildStationModule(
      'resume',
      'home.resumeShelfTitle',
      'home.resumeShelfCopy',
      'home-resume',
      resumeStations,
      { accent: 'primary' }
    )
  ];

  const revivedStations =
    revivedStationsList.length > 0
      ? buildStationModule(
          'revived-stations',
          'home.revivedTitle',
          'home.revivedCopy',
          'home-revived',
          revivedStationsList,
          { accent: 'secondary' }
        )
      : null;

  const sessionDelta =
    sessionDeltaStations.length > 0
      ? buildStationModule(
          'session-delta',
          'home.sessionDeltaTitle',
          'home.sessionDeltaCopy',
          'home-session-delta',
          sessionDeltaStations,
          { accent: 'accent' }
        )
      : null;

  const sponsoredModules = sponsoredStations.length
    ? [
        buildStationModule(
          'sponsored',
          'home.sponsoredTitle',
          'home.sponsoredCopy',
          'home-sponsored',
          sponsoredStations,
          { accent: 'accent', label: 'Sponsored' }
        )
      ]
    : [];

  const freshSignalsModule = buildStationModule(
    'fresh-signals',
    'home.freshSignalsTitle',
    'home.freshSignalsCopy',
    'home-fresh-signals',
    freshSignals,
    { accent: 'primary' }
  );

  const countrySpotlightModule = countrySpotlight
    ? buildStationModule(
        'country-spotlight',
        'home.countrySpotlightTitle',
        'home.countrySpotlightCopy',
        'home-country-spotlight',
        countrySpotlight.stations,
        { accent: 'secondary', label: countrySpotlight.bucket.label }
      )
    : null;

  const genreSpotlightModule = genreSpotlight
    ? buildStationModule(
        'genre-spotlight',
        'home.genreSpotlightTitle',
        'home.genreSpotlightCopy',
        'home-genre-spotlight',
        genreSpotlight.stations,
        { accent: 'accent', label: genreSpotlight.bucket.label }
      )
    : null;

  const hasSessionContext = queuePreview.length > 0 || recent.length > 0;
  const rankedDiscoveryModules = [
    freshSignalsModule,
    revivedStations,
    sessionDelta,
    countrySpotlightModule,
    genreSpotlightModule,
    sponsoredModules[0] || null
  ]
    .filter((module): module is DiscoveryStationModule => Boolean(module?.stations.length))
    .sort(
      (left, right) =>
        scoreDiscoveryModule(right, hasSessionContext, favorites.length > 0) -
        scoreDiscoveryModule(left, hasSessionContext, favorites.length > 0)
    );

  const primaryDiscoveryModule = rankedDiscoveryModules[0] || freshSignalsModule;

  return {
    quickResults,
    freshSignals: freshSignalsModule,
    countrySpotlight: countrySpotlightModule,
    resumeStations,
    resumeModules,
    genreSpotlight: genreSpotlightModule,
    revivedStations,
    sessionDelta,
    sponsoredModules,
    primaryDiscoveryModule,
    rankedDiscoveryModules,
    promoteDiscoveryAbove: hasSessionContext ? 'resume' : 'quick-search',
    tagRadar,
    metrics,
    freshnessStamp: showcaseSeed
  };
};


const scoreDiscoveryModule = (
  module: DiscoveryStationModule,
  hasSessionContext: boolean,
  hasFavorites: boolean
) => {
  const baseScoreByKind: Record<DiscoveryStationModule['kind'], number> = {
    'search-preview': 0,
    resume: 0,
    'fresh-signals': 70,
    'country-spotlight': 54,
    'genre-spotlight': 52,
    'catalog-pulse': 20,
    'revived-stations': hasFavorites ? 76 : 56,
    'session-delta': hasSessionContext ? 80 : 45,
    sponsored: 24
  };
  return baseScoreByKind[module.kind] || 10;
};

const pickDominantCountry = (stations: StationLite[]) => {
  const counts = new Map<string, number>();
  stations.forEach((station) => {
    const label = station.country?.trim();
    if (!label) return;
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  return Array.from(counts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] || '';
};

export const createGlobeDiscoveryFeed = ({
  areas,
  selectedAreaId,
  activeAreaId,
  favorites,
  recent
}: CreateGlobeDiscoveryFeedInput): GlobeDiscoveryFeed => {
  const hotAreas = areas.slice(0, 6).map((area) => ({
    id: area.id,
    label: area.label,
    subtitle: area.subtitle,
    count: area.count
  }));

  const routeMap = new Map<
    string,
    {
      id: string;
      label: string;
      subtitle: string;
      count: number;
    }
  >();

  areas.forEach((area) => {
    const routeLabel = pickDominantCountry(area.stations) || area.label;
    if (!routeLabel) return;
    const current = routeMap.get(routeLabel);
    if (!current || current.count < area.count) {
      routeMap.set(routeLabel, {
        id: area.id,
        label: routeLabel,
        subtitle: area.label !== routeLabel ? area.label : area.subtitle,
        count: area.count
      });
    }
  });

  const countryRoutes = Array.from(routeMap.values())
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, 6);

  const blockedAreaIds = new Set([selectedAreaId || '', activeAreaId || '']);
  const fallbackAreaIds = areas
    .filter((area) => !blockedAreaIds.has(area.id))
    .slice(0, 3)
    .map((area) => area.id);
  const fallbackStations = uniqueStations([
    ...recent,
    ...favorites,
    ...areas.filter((area) => fallbackAreaIds.includes(area.id)).flatMap((area) => area.stations)
  ]).slice(0, 5);

  return {
    hotAreas,
    countryRoutes,
    fallbackStations
  };
};

export const createLibraryDiscoveryFeed = ({
  current,
  queuePreview,
  recent,
  favorites,
  playbackHistory,
  trackHistory,
  collections,
  followedStations,
  followedRegions,
  alerts,
  linkedProviders,
  libraryUpdatedAt
}: CreateLibraryDiscoveryFeedInput): LibraryDiscoveryFeed => {
  const returnToAir = uniqueStations([
    current,
    ...queuePreview,
    ...recent,
    ...playbackHistory.slice().reverse()
  ]).slice(0, 4);

  return {
    returnToAir,
    favoritesPreview: uniqueStations(favorites).slice(0, 3),
    journalPreview: trackHistory.slice(0, 3),
    collectionsPreview: collections
      .slice()
      .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt - left.updatedAt)
      .slice(0, 3),
    followedStationsPreview: followedStations
      .slice()
      .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.createdAt - left.createdAt)
      .slice(0, 4),
    followedRegionsPreview: followedRegions
      .slice()
      .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.createdAt - left.createdAt)
      .slice(0, 4),
    unreadAlerts: alerts.filter((alert) => alert.readAt === null).length,
    cloudSummary: {
      mode: linkedProviders.length ? 'cloud' : 'local',
      providerKinds: linkedProviders,
      updatedAt: libraryUpdatedAt
    }
  };
};

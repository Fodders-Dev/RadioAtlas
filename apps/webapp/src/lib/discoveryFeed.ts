import type {
  CatalogMoodRail,
  CatalogSpotlight,
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

const seededJitter = (id: string, seed: number) => {
  let h = (hashValue(id) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h % 1000) / 1000;
};

const seededSort = <T,>(items: T[], seed: number, pickKey: (item: T) => string) =>
  [...items].sort((left, right) => {
    const leftScore = seededJitter(pickKey(left), seed);
    const rightScore = seededJitter(pickKey(right), seed);
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

// T2.22: maps a server mood-rail id to its locale title/copy + accent. The rail
// id doubles as the rail's data-home-rail attribute and its de-dup source id.
const MOOD_RAIL_CONFIG: Record<string, { titleKey: string; copyKey: string; accent: 'primary' | 'secondary' | 'accent' }> = {
  'mood-late-night': { titleKey: 'home.moodLateNightTitle', copyKey: 'home.moodLateNightCopy', accent: 'secondary' },
  'mood-workout': { titleKey: 'home.moodWorkoutTitle', copyKey: 'home.moodWorkoutCopy', accent: 'primary' },
  'mood-focus': { titleKey: 'home.moodFocusTitle', copyKey: 'home.moodFocusCopy', accent: 'accent' },
  'mood-driving': { titleKey: 'home.moodDrivingTitle', copyKey: 'home.moodDrivingCopy', accent: 'secondary' }
};

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
  // T2.21: pre-ranked server-signal pools (Radio Browser). These are NOT
  // re-ranked client-side — the server saw the full catalogue; the client only
  // wraps them into rail modules.
  trending?: StationLite[];
  topVoted?: StationLite[];
  aroundTheWorld?: CatalogSpotlight | null;
  moodRails?: CatalogMoodRail[];
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
  includeSponsored = true,
  trending = [],
  topVoted = [],
  aroundTheWorld = null,
  moodRails = []
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

  // T2.20: give spotlight rails a full shelf's worth of stations (a small pool
  // above the 6 a rail renders), so that after createHomeSurfaceFeed de-dupes
  // them against fresh-now the country/genre rails still fill a complete shelf
  // — Home then shows two full shelves above the fold instead of two half-rows.
  const countrySpotlight = pickUniqueBucket(countryBuckets, showcaseSeed + 17, 8);
  const genreSpotlight = pickUniqueBucket(tagBuckets, showcaseSeed + 41, 8);
  const resumeStations = uniqueStations([...queuePreview, ...recent, ...favorites]).slice(0, 4);

  const followedPool = uniqueStations(
    followedStations
      .map((follow) => catalog.find((station) => station.stationuuid === follow.stationId) || null)
      .filter(Boolean)
  );
  // Ten, not four. This list feeds TWO things: it outranks fresh-signals when the
  // listener has favourites (see scoreDiscoveryModule) and so becomes the hero,
  // and it is also the «К чему вернуться» shelf. At four, the hero and its three
  // companions consumed the entire list and the shelf could never render — the
  // real reason a saved station appeared nowhere below the fold, quite apart
  // from where the shelf sat in the rail order.
  // NOT filtered against `blockedIds`, unlike every other shelf here.
  //
  // `blockStations(freshSignals)` runs above and claims the whole discovery
  // pool. In production that pool already excludes the listener's own stations
  // (Home builds `discoveryCatalog` from `recommendationCatalog`), so the two
  // never met. But when the pool is small the exclusion is skipped, fresh-now
  // claims the favourites, and the shelf made OF those favourites came back
  // empty — the listener's own stations silently eaten by a shelf of
  // recommendations they did not ask for.
  //
  // A saved station belongs to the shelf of saved stations first. Anything else
  // yields to it, not the other way round.
  const revivedStationsList = seededSort(
    followedPool.length ? followedPool : favorites,
    showcaseSeed + 63,
    (station) => station.stationuuid
  ).slice(0, 10);
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

  // T2.21 server-signal rails. Pre-ranked by the API from the full catalogue;
  // the client only wraps them. They sit outside rankedDiscoveryModules so they
  // never compete to become the personalised hero — they are pure discovery.
  const trendingModule = trending.length
    ? buildStationModule(
        'trending',
        'home.trendingTitle',
        'home.trendingCopy',
        'home-trending',
        trending,
        { accent: 'primary' }
      )
    : null;

  const topVotedModule = topVoted.length
    ? buildStationModule(
        'top-voted',
        'home.topVotedTitle',
        'home.topVotedCopy',
        'home-top-voted',
        topVoted,
        { accent: 'secondary' }
      )
    : null;

  const aroundTheWorldModule = aroundTheWorld?.stations.length
    ? buildStationModule(
        'around-the-world',
        'home.aroundTheWorldTitle',
        'home.aroundTheWorldCopy',
        'home-around-the-world',
        aroundTheWorld.stations,
        { accent: 'accent', label: aroundTheWorld.label }
      )
    : null;

  // T2.22: wrap the server's pre-bucketed mood shelves. The rail id (sourceId)
  // is the data-home-rail attribute + de-dup key; locale copy comes from config.
  const moodRailModules = moodRails
    .map((rail) => {
      const config = MOOD_RAIL_CONFIG[rail.id];
      if (!config || !rail.stations.length) return null;
      return buildStationModule('mood', config.titleKey, config.copyKey, rail.id, rail.stations, {
        accent: config.accent
      });
    })
    .filter((module): module is DiscoveryStationModule => module !== null);

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
    trending: trendingModule,
    topVoted: topVotedModule,
    aroundTheWorld: aroundTheWorldModule,
    moodRails: moodRailModules,
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
    sponsored: 24,
    // T2.21 rails are pushed in a fixed shelf order (homeSurface), not ranked
    // into the hero — these weights only satisfy the exhaustive map.
    trending: 50,
    'top-voted': 48,
    'around-the-world': 40,
    // T2.22 moods are pushed in a fixed shelf order (homeSurface), never ranked
    // into the hero — this weight only satisfies the exhaustive map.
    mood: 42
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

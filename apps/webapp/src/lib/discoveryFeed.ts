import type { DiscoveryFeed, DiscoveryMetrics, DiscoveryStationModule } from '../domain/contracts';
import type { StationLite } from '../types';
import type { ProviderKind, SyncedTrackHistoryItem } from '../domain/contracts';

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

const uniqueStations = (stations: StationLite[]) => {
  const seen = new Set<string>();
  return stations.filter((station) => {
    if (seen.has(station.stationuuid)) return false;
    seen.add(station.stationuuid);
    return true;
  });
};

const withoutStationIds = (stations: StationLite[], blockedIds: Set<string>) =>
  stations.filter((station) => !blockedIds.has(station.stationuuid));

const withUniqueStationIds = (stations: StationLite[]) => {
  const seen = new Set<string>();
  return stations.filter((station) => {
    if (seen.has(station.stationuuid)) return false;
    seen.add(station.stationuuid);
    return true;
  });
};

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
  linkedProviders: ProviderKind[];
  libraryUpdatedAt: number | null;
};

type DiscoveryFeedInput = {
  catalog: StationLite[];
  favorites: StationLite[];
  recent: StationLite[];
  queuePreview: StationLite[];
  showcaseSeed: number;
  query: string;
  metrics: DiscoveryMetrics;
};

export const createDiscoveryFeed = ({
  catalog,
  favorites,
  recent,
  queuePreview,
  showcaseSeed,
  query,
  metrics
}: DiscoveryFeedInput): DiscoveryFeed => {
  const discoveryDeck = seededSort(catalog, showcaseSeed, (station) => station.stationuuid);
  const freshSignals = discoveryDeck.slice(0, 4);
  const searchLaunch = discoveryDeck.slice(4, 8);

  const countryBuckets = Array.from(
    catalog.reduce((map, station) => {
      const key = station.country?.trim();
      if (!key) return map;
      const bucket = map.get(key) || { label: key, stations: [] as StationLite[] };
      bucket.stations.push(station);
      map.set(key, bucket);
      return map;
    }, new Map<string, { label: string; stations: StationLite[] }>())
  )
    .map(([, bucket]) => bucket)
    .filter((bucket) => bucket.stations.length >= 4);

  const tagBuckets = Array.from(
    catalog.reduce((map, station) => {
      const key = firstMeaningfulTag(station.tags || '');
      if (!key) return map;
      const bucket = map.get(key) || [];
      bucket.push(station);
      map.set(key, bucket);
      return map;
    }, new Map<string, StationLite[]>())
  )
    .filter(([, bucket]) => bucket.length >= 4)
    .map(([label, stations]) => ({ label, stations }));

  const blockedIds = new Set<string>();
  freshSignals.forEach((station) => blockedIds.add(station.stationuuid));
  searchLaunch.forEach((station) => blockedIds.add(station.stationuuid));

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
        filtered.forEach((station) => blockedIds.add(station.stationuuid));
        return {
          bucket,
          stations: filtered
        };
      }
    }
    return null;
  };

  const countrySpotlight = pickUniqueBucket(countryBuckets, showcaseSeed + 17, 4);
  const genreSpotlight = pickUniqueBucket(tagBuckets, showcaseSeed + 41, 3);

  const revisitPool = uniqueStations([...queuePreview, ...recent, ...favorites]).filter(
    (station) => !blockedIds.has(station.stationuuid)
  );
  const resumeStations = revisitPool.slice(0, 4);

  const normalizedQuery = query.trim().toLowerCase();
  const quickResults = normalizedQuery
    ? catalog.filter((station) =>
        [station.name, station.country, station.tags].join(' ').toLowerCase().includes(normalizedQuery)
      ).slice(0, 4)
    : searchLaunch.length
      ? searchLaunch
      : freshSignals;

  const tagRadar = seededSort(tagBuckets, showcaseSeed + 67, (bucket) => bucket.label)
    .slice(0, 6)
    .map((bucket) => ({
      label: bucket.label,
      count: bucket.stations.length
    }));

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

  return {
    quickResults,
    freshSignals: buildStationModule(
      'fresh-signals',
      'home.freshSignalsTitle',
      'home.freshSignalsCopy',
      'home-fresh-signals',
      freshSignals,
      { accent: 'primary' }
    ),
    countrySpotlight: countrySpotlight
      ? buildStationModule(
          'country-spotlight',
          'home.countrySpotlightTitle',
          'home.countrySpotlightCopy',
          'home-country-spotlight',
          countrySpotlight.stations,
          { accent: 'secondary', label: countrySpotlight.bucket.label }
        )
      : null,
    resumeStations,
    genreSpotlight: genreSpotlight
      ? buildStationModule(
          'genre-spotlight',
          'home.genreSpotlightTitle',
          'home.genreSpotlightCopy',
          'home-genre-spotlight',
          genreSpotlight.stations,
          { accent: 'accent', label: genreSpotlight.bucket.label }
        )
      : null,
    tagRadar,
    metrics
  };
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
  const fallbackStations = withUniqueStationIds([
    ...recent,
    ...favorites,
    ...areas
      .filter((area) => fallbackAreaIds.includes(area.id))
      .flatMap((area) => area.stations)
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
  linkedProviders,
  libraryUpdatedAt
}: CreateLibraryDiscoveryFeedInput): LibraryDiscoveryFeed => {
  const returnToAir = withUniqueStationIds(
    [current, ...queuePreview, ...recent, ...playbackHistory.slice().reverse()].filter(Boolean) as StationLite[]
  ).slice(0, 4);

  return {
    returnToAir,
    favoritesPreview: withUniqueStationIds(favorites).slice(0, 3),
    journalPreview: trackHistory.slice(0, 3),
    cloudSummary: {
      mode: linkedProviders.length ? 'cloud' : 'local',
      providerKinds: linkedProviders,
      updatedAt: libraryUpdatedAt
    }
  };
};

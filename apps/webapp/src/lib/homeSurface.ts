import type {
  DiscoveryFeed,
  DiscoveryMetrics,
  DiscoveryStationModule
} from '../domain/contracts';
import type { StationLite } from '../types';

export type HomeHeroModule = {
  titleKey: string;
  copyKey: string;
  sourceId: string;
  accent: 'primary' | 'secondary' | 'accent';
  label: string | null;
  station: StationLite | null;
  companionStations: StationLite[];
  querySuggestion: string;
};

export type HomeRailModule = {
  id: string;
  titleKey: string;
  copyKey: string;
  sourceId: string;
  accent: 'primary' | 'secondary' | 'accent';
  label: string | null;
  stations: StationLite[];
};

export type HomeResumeModule = {
  titleKey: string;
  copyKey: string;
  queueCount: number;
  activeStationId: string | null;
  stations: StationLite[];
};

export type HomeSurfaceFeed = {
  version: 3;
  seed: number;
  builtAt: number;
  hero: HomeHeroModule;
  rails: HomeRailModule[];
  quickSearchChips: string[];
  metrics: DiscoveryMetrics;
};

type CreateHomeSurfaceFeedInput = {
  discoveryFeed: DiscoveryFeed;
  seed: number;
  builtAt?: number;
};

const hashValue = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const seededStations = (stations: StationLite[], seed: number) =>
  [...stations].sort((left, right) => {
    const leftScore = hashValue(`${left.stationuuid}:${seed}`);
    const rightScore = hashValue(`${right.stationuuid}:${seed}`);
    return leftScore - rightScore;
  });

const uniqueLabels = (values: Array<string | null | undefined>) => {
  const seen = new Set<string>();
  return values.filter((value): value is string => {
    const normalized = (value || '').trim();
    if (!normalized) return false;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const uniqueStations = (stations: Array<StationLite | null | undefined>) => {
  const seen = new Set<string>();
  return stations.filter((station): station is StationLite => {
    if (!station || seen.has(station.stationuuid)) return false;
    seen.add(station.stationuuid);
    return true;
  });
};

const firstMeaningfulTag = (station: StationLite | null) =>
  (station?.tags || '')
    .split(',')
    .map((tag) => tag.trim())
    .find((tag) => tag && tag.toLowerCase() !== 'no tags') || '';

const toRailModule = (
  id: string,
  module: DiscoveryStationModule,
  stations: StationLite[]
): HomeRailModule => ({
  id,
  titleKey: module.titleKey,
  copyKey: module.copyKey,
  sourceId: module.sourceId,
  accent: module.accent || 'primary',
  label: module.kind === 'sponsored' ? null : module.label || null,
  stations
});

const pickQuerySuggestion = (module: DiscoveryStationModule, station: StationLite | null) =>
  uniqueLabels([
    module.label,
    firstMeaningfulTag(station),
    station?.country || '',
    station?.state || '',
    station?.name || ''
  ])[0] || '';

const pickHeroModule = (discoveryFeed: DiscoveryFeed) =>
  discoveryFeed.primaryDiscoveryModule.stations.length
    ? discoveryFeed.primaryDiscoveryModule
    : discoveryFeed.freshSignals;

const pushRailModule = (
  target: HomeRailModule[],
  usedSourceIds: Set<string>,
  id: string,
  module: DiscoveryStationModule | null | undefined,
  blockedStationIds: Set<string>,
  seed: number
) => {
  if (!module || usedSourceIds.has(module.sourceId)) return;
  const stations = seededStations(module.stations, seed).filter(
    (station) => !blockedStationIds.has(station.stationuuid)
  );
  if (!stations.length) return;
  target.push(toRailModule(id, module, stations.slice(0, 6)));
  usedSourceIds.add(module.sourceId);
  stations.forEach((station) => blockedStationIds.add(station.stationuuid));
};

export const createHomeSurfaceFeed = ({
  discoveryFeed,
  seed,
  builtAt = Date.now()
}: CreateHomeSurfaceFeedInput): HomeSurfaceFeed => {
  const heroModule = pickHeroModule(discoveryFeed);
  const heroPool = seededStations(heroModule.stations, seed);
  const heroStation =
    heroPool[0] ||
    seededStations(discoveryFeed.quickResults, seed + 11)[0] ||
    seededStations(discoveryFeed.resumeStations, seed + 23)[0] ||
    null;
  const companionStations = uniqueStations(
    heroPool.filter((station) => station.stationuuid !== heroStation?.stationuuid)
  ).slice(0, 3);

  const hero: HomeHeroModule = {
    titleKey: heroModule.titleKey,
    copyKey: heroModule.copyKey,
    sourceId: heroModule.sourceId,
    accent: heroModule.accent || 'primary',
    label: heroModule.label || null,
    station: heroStation,
    companionStations,
    querySuggestion: pickQuerySuggestion(heroModule, heroStation)
  };

  const blockedStationIds = new Set<string>(
    uniqueStations([heroStation, ...companionStations]).map((station) => station.stationuuid)
  );
  const usedSourceIds = new Set<string>();
  const rails: HomeRailModule[] = [];

  if (companionStations.length) {
    rails.push(
      toRailModule(`${heroModule.sourceId}-companions`, heroModule, companionStations)
    );
  }

  pushRailModule(
    rails,
    usedSourceIds,
    'fresh-now',
    discoveryFeed.freshSignals,
    blockedStationIds,
    seed + 31
  );
  pushRailModule(
    rails,
    usedSourceIds,
    'resume-context',
    discoveryFeed.sessionDelta,
    blockedStationIds,
    seed + 43
  );
  pushRailModule(
    rails,
    usedSourceIds,
    'country-spotlight',
    discoveryFeed.countrySpotlight,
    blockedStationIds,
    seed + 59
  );
  pushRailModule(
    rails,
    usedSourceIds,
    'genre-spotlight',
    discoveryFeed.genreSpotlight,
    blockedStationIds,
    seed + 71
  );
  pushRailModule(
    rails,
    usedSourceIds,
    'revived-stations',
    discoveryFeed.revivedStations,
    blockedStationIds,
    seed + 83
  );
  pushRailModule(
    rails,
    usedSourceIds,
    'sponsored',
    discoveryFeed.sponsoredModules[0] || null,
    blockedStationIds,
    seed + 97
  );

  const quickSearchChips = uniqueLabels([
    hero.querySuggestion,
    discoveryFeed.countrySpotlight?.label || '',
    discoveryFeed.genreSpotlight?.label || '',
    ...discoveryFeed.tagRadar.map((item) => item.label)
  ]).slice(0, 6);

  return {
    version: 3,
    seed,
    builtAt,
    hero,
    rails: rails.slice(0, 3),
    quickSearchChips,
    metrics: discoveryFeed.metrics
  };
};

export const createHomeResumeModule = (input: {
  current: StationLite | null;
  queuePreview: StationLite[];
  recent: StationLite[];
  playbackHistory: StationLite[];
}): HomeResumeModule | null => {
  const stations = uniqueStations([
    input.current,
    ...input.queuePreview,
    ...input.recent,
    ...[...input.playbackHistory].reverse()
  ]).slice(0, 4);

  if (!stations.length) {
    return null;
  }

  return {
    titleKey: 'home.resumeShelfTitle',
    copyKey: 'home.resumeShelfCopy',
    queueCount: input.queuePreview.length,
    activeStationId: input.current?.stationuuid || null,
    stations
  };
};

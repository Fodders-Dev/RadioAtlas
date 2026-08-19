import type {
  CatalogSummary,
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
  version: 6;
  seed: number;
  builtAt: number;
  hero: HomeHeroModule;
  rails: HomeRailModule[];
  quickSearchChips: string[];
  metrics: DiscoveryMetrics;
  // T_audit_10: a fingerprint of the summary's RAIL COMPOSITION the surface was
  // built from. The snapshot freshness gate (Home.tsx) compares this so a
  // background revalidation that brings a fuller summary (e.g. a stale 5-rail
  // fallback cache replaced by the real 12-rail network payload) rebuilds the
  // surface instead of being frozen out by the seed/version gate. Composition —
  // not station UUIDs — so a same-shape revalidation causes no re-rank churn
  // (which would regress the T1.2 rank-freeze).
  summarySignature: string;
  // T_audit_9: a fingerprint of what the user's taste currently favours (top
  // tag rank-order + hidden count). Sibling to summarySignature: the snapshot
  // gate also compares this, so a like/skip/hide re-ranks the taste-driven
  // fresh-now rail eagerly instead of waiting for the next session-bucket flip.
  // A single play doesn't shift the top tags, so the snapshot stays frozen on
  // play — the T1.2 rank-freeze invariant is preserved.
  tasteSignature: string;
};

type CreateHomeSurfaceFeedInput = {
  discoveryFeed: DiscoveryFeed;
  seed: number;
  builtAt?: number;
  summarySignature?: string;
  tasteSignature?: string;
};

// T_audit_10: fingerprint the rail-bearing fields of a catalogue summary. Two
// summaries with the same shape (counts + which mood rails + spotlight presence)
// share a signature even if their station lists differ; a summary that gains or
// loses a rail pool gets a different one. Used to decide whether a cached home
// snapshot is still valid against the current summary.
export const summaryRailSignature = (summary: CatalogSummary | null | undefined): string => {
  if (!summary) return 'none';
  const moodIds = (summary.moodRails || [])
    .map((rail) => rail.id)
    .sort()
    .join('+');
  return [
    summary.countrySpotlight?.stations?.length ? 'cs' : '-',
    summary.genreSpotlight?.stations?.length ? 'gs' : '-',
    `tr${summary.trending?.length || 0}`,
    `tv${summary.topVoted?.length || 0}`,
    `atw${summary.aroundTheWorld?.stations?.length || 0}`,
    `mood:${moodIds}`
  ].join('|');
};

// Max stations rendered per rail (the rail is a horizontal shelf, not the full
// catalogue). Only these are reserved against later rails — see pushRailModule.
const RAIL_STATION_LIMIT = 6;

// T2.22: Home carries up to ten content shelves (fresh-now, Trending, country,
// genre, Top voted, four mood rails, Around the world) plus lower-priority
// personalised extras. Keep them all in the feed; the screen decides how many
// to render per layout (visibleRails).
const HOME_SURFACE_MAX_RAILS = 13;

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
  // T2.20: block only the stations we actually render, not the whole source
  // pool. The fresh-now module carries ~the entire catalogue, so blocking all
  // of it starved every later rail (country/genre/session spotlights resolved
  // to zero) and collapsed Home to a single 6-tile shelf. Reserving just the
  // displayed slice lets the remaining rails fill from the untouched catalogue.
  const shown = stations.slice(0, RAIL_STATION_LIMIT);
  target.push(toRailModule(id, module, shown));
  usedSourceIds.add(module.sourceId);
  shown.forEach((station) => blockedStationIds.add(station.stationuuid));
};

export const createHomeSurfaceFeed = ({
  discoveryFeed,
  seed,
  builtAt = Date.now(),
  summarySignature = 'none',
  tasteSignature = 'none'
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

  // The HERO is blocked from the shelves; its companions are not.
  //
  // Companions used to be blocked too, and that quietly deleted three stations
  // from the surface: on a phone they are not rendered at all
  // (homeCards.tsx drops them when dense/compact), and they are drawn from the
  // same pool as the hero — which, for a listener with favourites, is their own
  // saved stations. So the block protected nothing and starved the one shelf
  // able to show them. On desktop they do render beside the hero, where the
  // overlap is three small chips repeating three tiles; that is the cheaper
  // wrong than a shelf that never appears on the surface this product is used on.
  const blockedStationIds = new Set<string>(
    heroStation ? [heroStation.stationuuid] : []
  );
  const usedSourceIds = new Set<string>();
  const rails: HomeRailModule[] = [];

  // T_home_redesign_1: the "${hero}-companions" rail was the hero card's
  // contextual sidekick — with HomeHeroCard removed it becomes orphan. We
  // skip the push (those stations fall back into blockedStationIds and reach
  // the user via fresh-now naturally) but keep `companionStations` computed
  // above because rotateSurfaceFeed in Home.tsx still reads it to rotate the
  // deck across sessions.

  // T2.21 shelf order — personalised fresh-now first, then the new non-
  // personalised discovery rails interleaved with the spotlights for variety:
  // fresh-now · Trending · country · genre · Top voted · Around the world ·
  // then the lower-priority personalised extras (resume/revived/sponsored).
  pushRailModule(
    rails,
    usedSourceIds,
    'fresh-now',
    discoveryFeed.freshSignals,
    blockedStationIds,
    seed + 31
  );
  // SECOND, right behind the discovery shelf, because it is the listener's own.
  //
  // This shelf is their followed stations, or — far more often — their
  // favourites. It used to be pushed ELEVENTH, and a phone renders the first
  // ten (DENSE_RAIL_LIMIT), so on the surface this product is actually used on
  // it was never reachable at all. Liking a station made it vanish: it leaves
  // the recommendation pool the moment it is owned, and nothing on Home showed
  // it again. Meanwhile the first-run card promises «Сохранишь станцию, и она
  // останется здесь», and «здесь» did not exist.
  //
  // It stays behind `fresh-now` rather than replacing it: Home retitles
  // rails[0] to «Попробуйте сейчас» and previews what is playing on it, which
  // is the newcomer's entry point and belongs to nobody's library.
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
    'trending',
    discoveryFeed.trending,
    blockedStationIds,
    seed + 37
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
    'top-voted',
    discoveryFeed.topVoted,
    blockedStationIds,
    seed + 73
  );
  // T2.22: mood shelves (Late night · Workout · Focus · Driving) in fixed
  // display order. Each module's sourceId ("mood-late-night" …) is its rail id.
  discoveryFeed.moodRails.forEach((moodModule, index) => {
    pushRailModule(rails, usedSourceIds, moodModule.sourceId, moodModule, blockedStationIds, seed + 211 + index);
  });
  pushRailModule(
    rails,
    usedSourceIds,
    'around-the-world',
    discoveryFeed.aroundTheWorld,
    blockedStationIds,
    seed + 79
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
    version: 6,
    seed,
    builtAt,
    hero,
    rails: rails.slice(0, HOME_SURFACE_MAX_RAILS),
    quickSearchChips,
    metrics: discoveryFeed.metrics,
    summarySignature,
    tasteSignature
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

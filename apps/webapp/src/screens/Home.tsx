import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DiscoveryFeed,
  DiscoveryStationModule
} from '../domain/contracts';
import { createDiscoveryFeed } from '../lib/discoveryFeed';
import { createHomeRecommendationFeed } from '../lib/homeProfile';
import {
  createHomeResumeModule,
  createHomeSurfaceFeed,
  type HomeHeroModule,
  type HomeRailModule,
  type HomeSurfaceFeed
} from '../lib/homeSurface';
import {
  buildPersonalRadioQueue,
  PERSONAL_RADIO_QUEUE_LIMIT
} from '../lib/personalRadio';
import { getDeviceProfile } from '../lib/deviceProfile';
import { reportProductEvent } from '../lib/productAnalytics';
import { useCompactLayout } from '../lib/useCompactLayout';
import { useDebounce } from '../lib/useDebounce';
import { useCatalog } from '../state/CatalogContext';
import { useLocale } from '../state/LocaleContext';
import { useLibrary, usePlayback, useShell } from '../state/RadioContext';
import type { StationLite } from '../types';
import {
  filterStationsByPlayability,
  rankStationsForHome
} from '../lib/stationPlayability';
import {
  isStationHiddenFromRecommendations,
  rankStationsForUser
} from '../lib/tasteProfile';
import { AppScreenSkeleton } from '../components/AppScreenSkeleton';
import {
  HomeHeroCard,
  HomePersonalRadioCard,
  HomeRail,
  HomeResumeStrip,
  HomeSearchPreview
} from './homeCards';
import {
  DENSE_SEARCH_PREVIEW_LIMIT,
  SEARCH_PREVIEW_LIMIT,
  filterPreviewStations
} from './homePreview';
import './home.css';

const HOME_SESSION_BUCKET_MS = 1000 * 60 * 60 * 2;
const HOME_SURFACE_VERSION = 3;
const DENSE_RAIL_LIMIT = 3;
const DENSE_QUICK_CHIP_LIMIT = 2;

const mergeStations = (...collections: StationLite[][]) => {
  const merged = new Map<string, StationLite>();
  collections.forEach((items) => {
    items.forEach((station) => {
      merged.set(station.stationuuid, station);
    });
  });
  return Array.from(merged.values());
};

const toHomeDiscoveryModule = (
  kind: DiscoveryStationModule['kind'],
  sourceId: string,
  stations: StationLite[],
  accent: DiscoveryStationModule['accent'] = 'primary',
  titleKey = 'home.personalTitle',
  copyKey = 'home.freshSignalsCopy'
): DiscoveryStationModule => ({
  kind,
  titleKey,
  copyKey,
  sourceId,
  stations,
  accent
});

const applyRecommendationModules = (
  discoveryFeed: DiscoveryFeed,
  primaryStation: StationLite | null,
  railStations: StationLite[],
  returnToAir: StationLite[]
): DiscoveryFeed => {
  if (!primaryStation) return discoveryFeed;

  const heroModule = toHomeDiscoveryModule(
    'fresh-signals',
    'home-profile-hero',
    [primaryStation],
    'primary'
  );
  const railModule = railStations.length
    ? toHomeDiscoveryModule('fresh-signals', 'home-profile-rail', railStations, 'secondary')
    : discoveryFeed.freshSignals;

  return {
    ...discoveryFeed,
    quickResults: mergeStations(railStations, discoveryFeed.quickResults).slice(0, 4),
    freshSignals: railModule,
    resumeStations: returnToAir.length ? returnToAir : discoveryFeed.resumeStations,
    resumeModules: returnToAir.length
      ? [
          toHomeDiscoveryModule('resume', 'home-profile-return', returnToAir, 'primary'),
          ...discoveryFeed.resumeModules
        ]
      : discoveryFeed.resumeModules,
    primaryDiscoveryModule: heroModule,
    rankedDiscoveryModules: [heroModule, railModule, ...discoveryFeed.rankedDiscoveryModules]
  };
};

const buildFallbackCounts = (catalog: StationLite[]) => {
  const countries = new Set<string>();
  const languages = new Set<string>();
  const genres = new Set<string>();

  catalog.forEach((station) => {
    const country = station.country?.trim();
    const language = (station as { language?: string }).language?.trim();
    if (country) countries.add(country);
    if (language) languages.add(language);
    (station.tags || '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
      .forEach((tag) => genres.add(tag));
  });

  return {
    stations: catalog.length,
    countries: countries.size,
    languages: languages.size,
    genres: genres.size
  };
};

const isSameSessionBucket = (left: number | null, right: number) => {
  if (!left) return false;
  return Math.floor(left / HOME_SESSION_BUCKET_MS) === Math.floor(right / HOME_SESSION_BUCKET_MS);
};

const fallbackHero: HomeHeroModule = {
  titleKey: 'home.personalTitle',
  copyKey: 'home.freshSignalsCopy',
  sourceId: 'home-fallback',
  accent: 'primary',
  label: null,
  station: null,
  companionStations: [],
  querySuggestion: ''
};

const createFeedRail = (
  id: string,
  titleKey: string,
  copyKey: string,
  sourceId: string,
  stations: StationLite[]
): HomeRailModule => ({
  id,
  titleKey,
  copyKey,
  sourceId,
  accent: 'primary',
  label: null,
  stations
});

const buildSurfaceFeed = (input: {
  catalog: StationLite[];
  builtAt?: number;
  collections: ReturnType<typeof useLibrary>['collections'];
  favorites: StationLite[];
  followedStations: ReturnType<typeof useLibrary>['followedStations'];
  followedRegions: ReturnType<typeof useLibrary>['followedRegions'];
  behaviorProfile: ReturnType<typeof useLibrary>['behaviorProfile'];
  playabilityProfile: ReturnType<typeof useLibrary>['playabilityProfile'];
  tasteProfile: ReturnType<typeof useLibrary>['tasteProfile'];
  stationHealthProfile: ReturnType<typeof useLibrary>['stationHealthProfile'];
  radioSessionEvents: ReturnType<typeof useLibrary>['radioSessionEvents'];
  metrics: HomeSurfaceFeed['metrics'];
  queuePreview: StationLite[];
  recent: StationLite[];
  playbackHistory: StationLite[];
  trackHistory: ReturnType<typeof useLibrary>['trackHistory'];
  currentStation: StationLite | null;
  seed: number;
}) => {
  const rankedCatalog = rankStationsForUser(input.catalog, input.tasteProfile, input.playabilityProfile, {
    mode: 'personal',
    currentStation: input.currentStation,
    seed: input.seed,
    limit: input.catalog.length,
    healthProfile: input.stationHealthProfile,
    sessionEvents: input.radioSessionEvents
  });
  const recommendationFeed = createHomeRecommendationFeed({
    catalog: rankedCatalog,
    favorites: filterStationsByPlayability(input.favorites, input.playabilityProfile, undefined, input.stationHealthProfile),
    recent: filterStationsByPlayability(input.recent, input.playabilityProfile, undefined, input.stationHealthProfile),
    queuePreview: filterStationsByPlayability(input.queuePreview, input.playabilityProfile, undefined, input.stationHealthProfile),
    playbackHistory: filterStationsByPlayability(input.playbackHistory, input.playabilityProfile, undefined, input.stationHealthProfile),
    trackHistory: input.trackHistory,
    collections: input.collections,
    followedStations: input.followedStations,
    followedRegions: input.followedRegions,
    behaviorProfile: input.behaviorProfile,
    currentStation: input.currentStation,
    rotationSeed: input.seed
  });
  const discoveryFeed = createDiscoveryFeed({
    catalog: rankedCatalog,
    favorites: input.favorites,
    recent: input.recent,
    queuePreview: input.queuePreview,
    followedStations: input.followedStations,
    collections: input.collections,
    showcaseSeed: input.seed,
    query: '',
    metrics: input.metrics
  });
  const recommendationDeck = mergeStations(
    recommendationFeed.tunedForYou,
    recommendationFeed.becauseYouLiked,
    recommendationFeed.outsideOrbit,
    rankedCatalog
  );
  const primaryStation = recommendationDeck[0] || null;
  const railStations = recommendationDeck.filter(
    (station) => station.stationuuid !== primaryStation?.stationuuid
  );
  const personalizedDiscoveryFeed = applyRecommendationModules(
    discoveryFeed,
    primaryStation,
    railStations,
    recommendationFeed.returnToAir
  );
  return createHomeSurfaceFeed({
    discoveryFeed: personalizedDiscoveryFeed,
    seed: input.seed,
    builtAt: input.builtAt
  });
};

const isSameSurfaceDeck = (left: HomeSurfaceFeed | null, right: HomeSurfaceFeed | null) => {
  if (!left || !right) return false;
  if (left.hero.station?.stationuuid !== right.hero.station?.stationuuid) return false;
  if (left.rails.length !== right.rails.length) return false;
  return left.rails.every((leftRail, railIndex) => {
    const rightRail = right.rails[railIndex];
    if (!rightRail || leftRail.id !== rightRail.id) return false;
    if (leftRail.stations.length !== rightRail.stations.length) return false;
    return leftRail.stations.every(
      (station, stationIndex) =>
        station.stationuuid === rightRail.stations[stationIndex]?.stationuuid
    );
  });
};

const rotateSurfaceFeed = (surface: HomeSurfaceFeed): HomeSurfaceFeed => {
  const heroDeck = [surface.hero.station, ...surface.hero.companionStations].filter(
    (station): station is StationLite => Boolean(station)
  );
  if (heroDeck.length > 1) {
    const rotatedDeck = [...heroDeck.slice(1), heroDeck[0]];
    return {
      ...surface,
      seed: surface.seed + 1,
      hero: {
        ...surface.hero,
        station: rotatedDeck[0] || null,
        companionStations: rotatedDeck.slice(1, 4)
      }
    };
  }

  const [firstRail, ...restRails] = surface.rails;
  if (firstRail && firstRail.stations.length > 1) {
    const rotatedStations = [...firstRail.stations.slice(1), firstRail.stations[0]];
    return {
      ...surface,
      seed: surface.seed + 1,
      rails: [
        {
          ...firstRail,
          stations: rotatedStations
        },
        ...restRails
      ]
    };
  }

  return {
    ...surface,
    seed: surface.seed + 1
  };
};

export const Home = () => {
  const { summary, summaryLoading, summaryError, refreshSummary } = useCatalog();
  const {
    knownStations,
    favorites,
    recent,
    collections,
    followedStations,
    followedRegions,
    trackHistory,
    playbackHistory,
    behaviorProfile,
    playabilityProfile,
    tasteProfile,
    stationHealthProfile,
    radioSessionEvents,
    toggleFavorite,
    isFavorite
  } = useLibrary();
  const { player, queue, nowPlaying, playStation, playStationQueue } = usePlayback();
  const {
    setActiveSection,
    homeState,
    setHomeSnapshot,
    refreshHomeSurface,
    setSearchDraft
  } = useShell();
  const { t } = useLocale();
  const isCompactLayout = useCompactLayout();
  const lowPower = getDeviceProfile().lowPower;
  const denseLayout = isCompactLayout || lowPower;
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const sessionBucketPrimedRef = useRef(false);
  const dismissedSummaryErrorRef = useRef<string | null>(null);
  const homeImpressionSignatureRef = useRef('');
  const debouncedQuery = useDebounce(query, 180);

  const catalog = useMemo(
    () => mergeStations(summary?.catalogPool || [], knownStations),
    [knownStations, summary?.catalogPool]
  );
  const queuePreview = useMemo(() => {
    const startIndex = Math.max(queue.currentIndex, 0);
    return queue.items.slice(startIndex, startIndex + 4);
  }, [queue.currentIndex, queue.items]);
  const resumeQueuePreview = useMemo(
    () => filterStationsByPlayability(queuePreview, playabilityProfile, undefined, stationHealthProfile),
    [playabilityProfile, queuePreview, stationHealthProfile]
  );
  const resumeRecent = useMemo(
    () => filterStationsByPlayability(recent, playabilityProfile, undefined, stationHealthProfile),
    [playabilityProfile, recent, stationHealthProfile]
  );
  const resumePlaybackHistory = useMemo(
    () => filterStationsByPlayability(playbackHistory, playabilityProfile, undefined, stationHealthProfile),
    [playabilityProfile, playbackHistory, stationHealthProfile]
  );
  const counts = useMemo(
    () => summary?.counts || buildFallbackCounts(catalog),
    [catalog, summary?.counts]
  );
  const metrics = useMemo<HomeSurfaceFeed['metrics']>(
    () => ({
      stations: counts.stations,
      countries: counts.countries,
      languages: counts.languages,
      genres: counts.genres
    }),
    [counts]
  );
  const resumeModule = useMemo(
    () =>
      createHomeResumeModule({
        current: player.current,
        queuePreview: resumeQueuePreview,
        recent: resumeRecent,
        playbackHistory: resumePlaybackHistory
      }),
    [player.current, resumePlaybackHistory, resumeQueuePreview, resumeRecent]
  );
  const surfaceBuiltAt = Math.max(
    homeState.lastBuiltAt || 0,
    summary?.generatedAt || 0,
    homeState.sessionSeed
  );
  // T1.2-followup (Bug A): every click → play sequence fires TWO
  // session events (play-started + play-success) plus addRecent,
  // recordBehaviorForStation, recordTasteForStation, etc. — eight-
  // ish flips of live "ranking signal" state per single click. With
  // those references inside the dep array below, the memo re-runs,
  // buildSurfaceFeed re-runs, rankStationsForUser re-runs with a
  // fresh Date.now(), every home rail re-orders under the user's
  // finger right after they pressed play.
  //
  // The fix is the same ref-snapshot shape that `rankedCatalogRails`
  // (below) and Search.tsx's `rankedSearchResults` already use:
  // capture the live signals in a ref that updates AFTER render but
  // never participates in dep comparison. The memo only re-runs on
  // structural inputs (catalog, seed, snapshot, summary) and on
  // user-explicit library state (favorites, collections, followed*).
  // Bias still accumulates in the background — the user can hit
  // "Обновить витрину" to fold it back in, and the refreshHomeSurface
  // handler below reads the live values directly at click time.
  //
  // currentStation and queuePreview also live in the ref for the same
  // reason: a click → play flips player.current to the just-clicked
  // station AND mutates the queue (items append, currentIndex
  // advance), so queuePreview re-derives. Both feed rankStationsForUser
  // and createDiscoveryFeed via buildSurfaceFeed → if either stays in
  // the dep array, the home re-bakes mid-play with a NEW currentStation
  // bias, which re-ranks the catalog → fresh-now picks different
  // stations → the rail visibly shuffles under the user's finger.
  const homeRankInputsRef = useRef({
    behaviorProfile,
    playabilityProfile,
    tasteProfile,
    stationHealthProfile,
    radioSessionEvents,
    trackHistory,
    recent,
    playbackHistory,
    currentStation: player.current,
    queuePreview
  });
  useEffect(() => {
    homeRankInputsRef.current = {
      behaviorProfile,
      playabilityProfile,
      tasteProfile,
      stationHealthProfile,
      radioSessionEvents,
      trackHistory,
      recent,
      playbackHistory,
      currentStation: player.current,
      queuePreview
    };
  });

  const surfaceFeedBase = useMemo(() => {
    const snapshotFresh =
      homeState.snapshot &&
      homeState.snapshot.version === HOME_SURFACE_VERSION &&
      homeState.snapshot.seed === homeState.sessionSeed;
    if (snapshotFresh) {
      return homeState.snapshot;
    }
    if (summaryLoading && !summary) {
      return null;
    }
    if (!catalog.length) {
      return null;
    }
    const live = homeRankInputsRef.current;
    return buildSurfaceFeed({
      catalog,
      behaviorProfile: live.behaviorProfile,
      favorites,
      recent: live.recent,
      queuePreview: live.queuePreview,
      currentStation: live.currentStation,
      followedStations,
      followedRegions,
      collections,
      playbackHistory: live.playbackHistory,
      playabilityProfile: live.playabilityProfile,
      tasteProfile: live.tasteProfile,
      stationHealthProfile: live.stationHealthProfile,
      radioSessionEvents: live.radioSessionEvents,
      trackHistory: live.trackHistory,
      seed: homeState.sessionSeed,
      metrics,
      builtAt: surfaceBuiltAt
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    catalog,
    collections,
    favorites,
    followedStations,
    followedRegions,
    homeState.sessionSeed,
    homeState.snapshot,
    metrics,
    summary,
    summaryLoading,
    surfaceBuiltAt
  ]);
  const surfaceFeed = surfaceFeedBase;
  const currentStationId = player.current?.stationuuid || null;
  const activeTrack = currentStationId ? nowPlaying : null;
  const quickSearchChips = surfaceFeed?.quickSearchChips?.length
    ? surfaceFeed.quickSearchChips
    : [summary?.countrySpotlight?.label, summary?.genreSpotlight?.label]
        .filter((value): value is string => Boolean(value))
        .slice(0, denseLayout ? DENSE_QUICK_CHIP_LIMIT : 4);
  const searchPreviewStations = useMemo(() => {
    if (!debouncedQuery.trim()) {
      return [];
    }
    return filterPreviewStations(
      catalog,
      debouncedQuery,
      denseLayout ? DENSE_SEARCH_PREVIEW_LIMIT : SEARCH_PREVIEW_LIMIT
    );
  }, [catalog, debouncedQuery, denseLayout]);
  const surfaceRails = useMemo(() => surfaceFeed?.rails || [], [surfaceFeed?.rails]);
  const personalRadioQueue = useMemo(
    () => {
      const live = homeRankInputsRef.current;
      return buildPersonalRadioQueue({
        catalog,
        favorites,
        recent: live.recent,
        queuePreview: live.queuePreview,
        playbackHistory: live.playbackHistory,
        trackHistory: live.trackHistory,
        collections,
        followedStations,
        followedRegions,
        behaviorProfile: live.behaviorProfile,
        playabilityProfile: live.playabilityProfile,
        tasteProfile: live.tasteProfile,
        healthProfile: live.stationHealthProfile,
        sessionEvents: live.radioSessionEvents,
        context: {
          mode: 'personal',
          currentStation: live.currentStation,
          seed: homeState.sessionSeed,
          limit: PERSONAL_RADIO_QUEUE_LIMIT
        }
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      catalog,
      collections,
      favorites,
      followedStations,
      followedRegions,
      homeState.sessionSeed
    ]
  );
  // Note: rankedCatalogRails uses the same homeRankInputsRef snapshot
  // above. The post-rank `isStationHiddenFromRecommendations` filter
  // still reads `tasteProfile` from the ref so an explicit hide takes
  // effect on the next refresh (Обновить витрину button), not mid-
  // scroll.
  const rankedCatalogRails = useMemo(
    () => {
      const live = homeRankInputsRef.current;
      return rankStationsForHome(catalog, live.playabilityProfile, {
        limit: Math.min(catalog.length, 36),
        healthProfile: live.stationHealthProfile,
        sessionEvents: live.radioSessionEvents
      }).filter((station) => !isStationHiddenFromRecommendations(live.tasteProfile, station));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog, homeState.sessionSeed]
  );
  // T1.2-followup (Bug A, second mechanism): visibleRails' post-filter
  // blocks stations already used by the resume strip and the personal
  // radio "now-up" so we don't show the same tile twice on the home.
  // The problem: resumeModule re-derives from `player.current`,
  // `queuePreview`, `recent`, `playbackHistory` — ALL of which flip
  // during a click → play burst. Before play the block list was
  // [tokyo, osaka, kyoto, sapporo] (seeded queue), after play it was
  // [hamburg, berlin] (just-played + remainder of the now-set queue).
  // That swap caused fresh-now's visible slice to go from
  // [hamburg, berlin] to [kyoto, osaka, sapporo, tokyo] — a full
  // re-shuffle under the user's finger even though the underlying
  // surface.rails array (frozen via the snapshotFresh path above)
  // never changed.
  //
  // The fix: snapshot the block-set at session-seed boundary. We use
  // a lazy-init pattern (render-time conditional) so the ref is
  // available synchronously on the same render visibleRails runs.
  // It re-snapshots when homeState.sessionSeed advances (i.e., when
  // the user hits "Обновить витрину" or refreshHomeSurface fires).
  // Mutating a ref during render is safe here because (a) the
  // mutation is keyed by homeState.sessionSeed, so StrictMode's
  // double-invocation is a no-op on the second pass; (b) speculative
  // Concurrent rendering either hits the same `seed === current.seed`
  // check and bails, or sets a new seed that the next commit will use
  // idempotently.
  // The actual resume strip UI still re-renders live; only the
  // *blocking* set used by visibleRails is frozen — the visible
  // overlap on any in-session state change (play / favorite / hide /
  // queue add — where the rail's "first" station can briefly appear
  // in both blocks until the next "Обновить витрину" or surface
  // refresh) is acceptable per UX call; the rail re-shuffle is not.
  const sessionBlockedStationsRef = useRef<{
    seed: number | null;
    stations: string[];
  }>({ seed: null, stations: [] });
  if (sessionBlockedStationsRef.current.seed !== homeState.sessionSeed) {
    const blocked: string[] = [];
    if (personalRadioQueue.stations[0]) {
      blocked.push(personalRadioQueue.stations[0].stationuuid);
    }
    if (resumeModule?.stations.length) {
      const sliceLength = denseLayout ? 1 : resumeModule.stations.length;
      resumeModule.stations.slice(0, sliceLength).forEach((station) => {
        blocked.push(station.stationuuid);
      });
    }
    sessionBlockedStationsRef.current = {
      seed: homeState.sessionSeed,
      stations: blocked
    };
  }
  const visibleRails = useMemo(() => {
    const limit = denseLayout ? DENSE_RAIL_LIMIT : 3;
    const usedStationIds = new Set<string>(
      sessionBlockedStationsRef.current.stations
    );
    const rails: HomeRailModule[] = [];
    surfaceRails.forEach((rail) => {
      if (rails.length >= limit) return;
      const stations = rail.stations.filter((station) => !usedStationIds.has(station.stationuuid));
      if (!stations.length) return;
      stations.forEach((station) => usedStationIds.add(station.stationuuid));
      rails.push({ ...rail, stations });
    });
    if (!denseLayout || rails.length >= limit) return rails;

    const pickStations = (stations: StationLite[]) => {
      const merged = mergeStations(stations);
      const fresh = merged.filter((station) => !usedStationIds.has(station.stationuuid));
      const picked = (fresh.length >= 3 ? fresh : merged).slice(0, 6);
      picked.forEach((station) => usedStationIds.add(station.stationuuid));
      return picked;
    };
    const pushRail = (
      id: string,
      titleKey: string,
      copyKey: string,
      sourceId: string,
      stations: StationLite[]
    ) => {
      if (rails.length >= limit || rails.some((rail) => rail.id === id)) return;
      const picked = pickStations(stations);
      if (!picked.length) return;
      rails.push(createFeedRail(id, titleKey, copyKey, sourceId, picked));
    };

    pushRail(
      'home-new-stations',
      'home.newStationsTitle',
      'home.newStationsCopy',
      'home-new-stations',
      rankedCatalogRails
    );
    pushRail(
      'home-world-stations',
      'home.worldStationsTitle',
      'home.worldStationsCopy',
      'home-world-stations',
      catalog
    );
    pushRail(
      'home-personal-radio-rail',
      'home.personalTitle',
      'home.freshSignalsCopy',
      'home-personal-radio',
      personalRadioQueue.stations
    );

    return rails.slice(0, limit);
    // sessionBlockedStationsRef is read inside; it re-snapshots only on
    // homeState.sessionSeed change which is implicit through surfaceRails.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, denseLayout, personalRadioQueue.stations, rankedCatalogRails, surfaceRails]);

  useEffect(() => {
    const stationIds = mergeStations(
      personalRadioQueue.stations.slice(0, 12),
      visibleRails.flatMap((rail) => rail.stations.slice(0, 8))
    ).map((station) => station.stationuuid);
    if (!stationIds.length) return;
    const signature = `${denseLayout ? 'dense' : 'wide'}:${stationIds.join('|')}`;
    if (homeImpressionSignatureRef.current === signature) return;
    homeImpressionSignatureRef.current = signature;
    reportProductEvent(
      'home_station_impression',
      {
        stationIds,
        stationCount: stationIds.length,
        railCount: visibleRails.length,
        dense: denseLayout
      },
      {
        dedupeKey: `home_station_impression:${signature}`,
        dedupeMs: 60_000
      }
    );
  }, [denseLayout, personalRadioQueue.stations, visibleRails]);

  useEffect(() => {
    if (!summary || sessionBucketPrimedRef.current) return;
    sessionBucketPrimedRef.current = true;
    if (!homeState.lastBuiltAt) return;
    if (isSameSessionBucket(homeState.lastBuiltAt, Date.now())) return;
    refreshHomeSurface(summary.generatedAt || Date.now());
  }, [homeState.lastBuiltAt, refreshHomeSurface, summary]);

  useEffect(() => {
    if (!surfaceFeedBase) return;
    if (
      homeState.snapshot &&
      homeState.snapshot.seed === surfaceFeedBase.seed &&
      homeState.snapshot.builtAt === surfaceFeedBase.builtAt
    ) {
      return;
    }
    startTransition(() => {
      setHomeSnapshot(surfaceFeedBase);
    });
  }, [homeState.snapshot, setHomeSnapshot, surfaceFeedBase]);

  const openSearch = (value: string) => {
    const normalized = value.trim();
    startTransition(() => {
      setSearchDraft(normalized);
      setActiveSection('search');
    });
  };

  const handleRefresh = async () => {
    const seed = Date.now();
    setRefreshing(true);
    try {
      const nextSummary = await refreshSummary(seed, { forceNetwork: true });
      const effectiveSummary = nextSummary || summary;
      const nextCatalog = mergeStations(effectiveSummary?.catalogPool || [], knownStations);
      if (!effectiveSummary || !nextCatalog.length) {
        refreshHomeSurface(seed);
        return;
      }

      const nextSeed = seed;
      let nextSurface = buildSurfaceFeed({
        catalog: nextCatalog,
        builtAt: Math.max(effectiveSummary.generatedAt || 0, nextSeed),
        behaviorProfile,
        favorites,
        recent,
        queuePreview,
        currentStation: player.current,
        followedStations,
        followedRegions,
        collections,
        playbackHistory,
        playabilityProfile,
        tasteProfile,
        stationHealthProfile,
        radioSessionEvents,
        trackHistory,
        seed: nextSeed,
        metrics: effectiveSummary.counts
      });

      if (isSameSurfaceDeck(nextSurface, surfaceFeed)) {
        nextSurface = {
          ...rotateSurfaceFeed(nextSurface),
          seed: nextSeed + 1,
          builtAt: Date.now()
        };
      }

      startTransition(() => {
        setHomeSnapshot(nextSurface);
      });
    } finally {
      setRefreshing(false);
    }
  };

  const handleSummaryErrorRefresh = () => {
    if (summaryError) {
      dismissedSummaryErrorRef.current = summaryError;
    }
    void handleRefresh();
  };

  const handlePlayStation = (station: StationLite, playlist: StationLite[], sourceId: string) => {
    if (player.current?.stationuuid === station.stationuuid) {
      player.toggle();
      return;
    }

    playStation(station, {
      playlist,
      sourceId,
      sourceLabel: station.name
    });
  };
  const handlePlayPersonalRadio = () => {
    if (queue.sourceId === personalRadioQueue.sourceId && player.current) {
      player.toggle();
      return;
    }
    playStationQueue(personalRadioQueue.stations, {
      sourceId: personalRadioQueue.sourceId,
      sourceLabel: t('home.personalRadioTitle')
    });
  };
  const personalRadioActive = queue.sourceId === personalRadioQueue.sourceId && Boolean(player.current);
  const showHomeHeroSkeleton = summaryLoading && !surfaceFeed && !homeState.snapshot;
  const showSummaryErrorBanner =
    Boolean(summaryError) &&
    (!summary || catalog.length === 0) &&
    dismissedSummaryErrorRef.current !== summaryError;

  return (
    <section
      className="screen screen-home-next"
      data-density={denseLayout ? 'dense' : 'default'}
      data-low-power={lowPower ? 'true' : 'false'}
    >
      {showHomeHeroSkeleton ? (
        <AppScreenSkeleton section="home" scope="home-hero" />
      ) : (
        <>
          <HomePersonalRadioCard
            dense={denseLayout}
            queueCount={personalRadioQueue.stations.length}
            isPlaying={personalRadioActive && player.isPlaying}
            disabled={!personalRadioQueue.stations.length}
            onPlay={handlePlayPersonalRadio}
          />
          {!denseLayout ? (
            <HomeHeroCard
              module={surfaceFeed?.hero || fallbackHero}
              metrics={counts}
              dense={false}
              isActive={currentStationId === surfaceFeed?.hero.station?.stationuuid}
              activeTrack={activeTrack}
              liked={surfaceFeed?.hero.station ? isFavorite(surfaceFeed.hero.station.stationuuid) : false}
              refreshing={refreshing || (summaryLoading && !surfaceFeed)}
              onPlay={handlePlayStation}
              onToggleFavorite={toggleFavorite}
              onExplore={openSearch}
              onRefresh={handleRefresh}
            />
          ) : null}
        </>
      )}

      {showSummaryErrorBanner ? (
        <section
          className={`home-status-banner ${denseLayout ? 'is-dense' : ''}`.trim()}
          title={summaryError ?? undefined}
        >
          <div className="home-status-copy">
            <strong>{t('home.catalogUnavailableTitle')}</strong>
            {!denseLayout ? <span>{t('home.catalogUnavailableCopy')}</span> : null}
          </div>
          <button className="home-inline-link" type="button" onClick={handleSummaryErrorRefresh}>
            {t('home.refreshFeed')}
          </button>
        </section>
      ) : null}

      {!denseLayout ? (
        <section className="home-search-launcher">
          <div className="home-section-head">
            <div>
              <div className="home-section-title">{t('home.searchTitle')}</div>
              <div className="home-section-copy">{t('home.quickSearchCopy')}</div>
            </div>
            <div className="home-section-badge">
              {debouncedQuery.trim() ? searchPreviewStations.length : SEARCH_PREVIEW_LIMIT}
            </div>
          </div>

          <form
            className="home-search-form"
            onSubmit={(event) => {
              event.preventDefault();
              openSearch(query);
            }}
          >
            <label className="home-search-field" htmlFor="home-search-launcher">
              <input
                id="home-search-launcher"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('explore.quickSearchPlaceholder')}
                autoComplete="off"
              />
            </label>
            <button className="home-inline-link" type="submit">
              {t('home.openSearch')}
            </button>
          </form>

          {quickSearchChips.length ? (
            <div className="home-search-chip-row">
              {quickSearchChips.map((chip) => (
                <button
                  key={chip}
                  className="home-search-chip"
                  type="button"
                  onClick={() => setQuery(chip)}
                >
                  {chip}
                </button>
              ))}
            </div>
          ) : null}

          <HomeSearchPreview
            dense={false}
            query={debouncedQuery}
            stations={searchPreviewStations}
            currentStationId={currentStationId}
            activeTrack={activeTrack}
            isFavorite={isFavorite}
            onPlay={handlePlayStation}
            onToggleFavorite={toggleFavorite}
          />
        </section>
      ) : null}

      {resumeModule ? (
        <HomeResumeStrip
          dense={denseLayout}
          module={resumeModule}
          currentStationId={currentStationId}
          activeTrack={activeTrack}
          isFavorite={isFavorite}
          onPlay={handlePlayStation}
          onToggleFavorite={toggleFavorite}
        />
      ) : null}

      {visibleRails.map((module) => (
        <HomeRail
          key={module.id}
          dense={denseLayout}
          module={module}
          currentStationId={currentStationId}
          activeTrack={activeTrack}
          isFavorite={isFavorite}
          onPlay={handlePlayStation}
          onToggleFavorite={toggleFavorite}
          onExplore={openSearch}
        />
      ))}

      {!denseLayout ? (
        <section className="home-explore-card">
          <div className="home-section-head">
            <div>
              <div className="home-section-title">{t('home.exploreFooterTitle')}</div>
              <div className="home-section-copy">{t('home.exploreFooterCopy')}</div>
            </div>
            <div className="home-section-badge">
              {isCompactLayout ? t('home.mapKicker') : t('home.discoveryKicker')}
            </div>
          </div>

          <div className="home-explore-actions">
            <button className="home-secondary-btn" type="button" onClick={() => setActiveSection('globe')}>
              {t('home.openGlobe')}
            </button>
            <button className="home-primary-btn" type="button" onClick={() => setActiveSection('library')}>
              {t('home.openLibrary')}
            </button>
          </div>
        </section>
      ) : null}
    </section>
  );
};

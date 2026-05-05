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
    return buildSurfaceFeed({
      catalog,
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
      seed: homeState.sessionSeed,
      metrics,
      builtAt: surfaceBuiltAt
    });
  }, [
    catalog,
    collections,
    behaviorProfile,
    favorites,
    followedStations,
    followedRegions,
    homeState.sessionSeed,
    homeState.snapshot,
    metrics,
    playbackHistory,
    playabilityProfile,
    tasteProfile,
    stationHealthProfile,
    radioSessionEvents,
    player.current,
    queuePreview,
    recent,
    summary,
    summaryLoading,
    surfaceBuiltAt,
    trackHistory
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
    () =>
      buildPersonalRadioQueue({
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
        healthProfile: stationHealthProfile,
        sessionEvents: radioSessionEvents,
        context: {
          mode: 'personal',
          currentStation: player.current,
          seed: homeState.sessionSeed,
          limit: PERSONAL_RADIO_QUEUE_LIMIT
        }
      }),
    [
      behaviorProfile,
      catalog,
      collections,
      favorites,
      followedStations,
      followedRegions,
      homeState.sessionSeed,
      playbackHistory,
      playabilityProfile,
      tasteProfile,
      stationHealthProfile,
      radioSessionEvents,
      player.current,
      queuePreview,
      recent,
      trackHistory
    ]
  );
  // Snapshot the per-tick inputs so the home rails don't re-shuffle
  // every time the user plays/likes a station. Re-ranking still
  // happens when the catalog or hide-list (tasteProfile) changes,
  // and the user can force a fresh ordering via the "Обновить
  // витрину" button. Without this, every playback tick changed
  // radioSessionEvents → re-ran rankStationsForHome with a fresh
  // Date.now() → reordered the visible cards mid-scroll. Same root
  // cause as the Search list jitter, same fix.
  const homeRankInputsRef = useRef({
    playabilityProfile,
    stationHealthProfile,
    radioSessionEvents
  });
  useEffect(() => {
    homeRankInputsRef.current = {
      playabilityProfile,
      stationHealthProfile,
      radioSessionEvents
    };
  });
  const rankedCatalogRails = useMemo(
    () =>
      rankStationsForHome(catalog, homeRankInputsRef.current.playabilityProfile, {
        limit: Math.min(catalog.length, 36),
        healthProfile: homeRankInputsRef.current.stationHealthProfile,
        sessionEvents: homeRankInputsRef.current.radioSessionEvents
      }).filter((station) => !isStationHiddenFromRecommendations(tasteProfile, station)),
    [catalog, tasteProfile, homeState.sessionSeed]
  );
  const visibleRails = useMemo(() => {
    const limit = denseLayout ? DENSE_RAIL_LIMIT : 3;
    const usedStationIds = new Set<string>();
    personalRadioQueue.stations.slice(0, 1).forEach((station) => {
      usedStationIds.add(station.stationuuid);
    });
    resumeModule?.stations
      .slice(0, denseLayout ? 1 : resumeModule.stations.length)
      .forEach((station) => {
        usedStationIds.add(station.stationuuid);
      });
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
  }, [catalog, denseLayout, personalRadioQueue.stations, rankedCatalogRails, resumeModule, surfaceRails]);

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

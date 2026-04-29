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
  type HomeSurfaceFeed
} from '../lib/homeSurface';
import { getDeviceProfile } from '../lib/deviceProfile';
import { useCompactLayout } from '../lib/useCompactLayout';
import { useDebounce } from '../lib/useDebounce';
import { useCatalog } from '../state/CatalogContext';
import { useLocale } from '../state/LocaleContext';
import { useLibrary, usePlayback, useShell } from '../state/RadioContext';
import type { StationLite } from '../types';
import {
  filterStationsByPlayability,
  getPlayabilityProfileUpdatedAt,
  rankStationsForHome
} from '../lib/stationPlayability';
import { AppScreenSkeleton } from '../components/AppScreenSkeleton';
import {
  HomeHeroCard,
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
const DENSE_RAIL_LIMIT = 1;
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
  accent: DiscoveryStationModule['accent'] = 'primary'
): DiscoveryStationModule => ({
  kind,
  titleKey: 'home.freshSignalsTitle',
  copyKey: 'home.freshSignalsCopy',
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
  titleKey: 'home.freshSignalsTitle',
  copyKey: 'home.freshSignalsCopy',
  sourceId: 'home-fallback',
  accent: 'primary',
  label: null,
  station: null,
  companionStations: [],
  querySuggestion: ''
};

const buildSurfaceFeed = (input: {
  catalog: StationLite[];
  builtAt?: number;
  collections: ReturnType<typeof useLibrary>['collections'];
  favorites: StationLite[];
  followedStations: ReturnType<typeof useLibrary>['followedStations'];
  behaviorProfile: ReturnType<typeof useLibrary>['behaviorProfile'];
  playabilityProfile: ReturnType<typeof useLibrary>['playabilityProfile'];
  metrics: HomeSurfaceFeed['metrics'];
  queuePreview: StationLite[];
  recent: StationLite[];
  playbackHistory: StationLite[];
  trackHistory: ReturnType<typeof useLibrary>['trackHistory'];
  currentStation: StationLite | null;
  seed: number;
}) => {
  const rankedCatalog = rankStationsForHome(input.catalog, input.playabilityProfile);
  const recommendationFeed = createHomeRecommendationFeed({
    catalog: rankedCatalog,
    favorites: filterStationsByPlayability(input.favorites, input.playabilityProfile),
    recent: filterStationsByPlayability(input.recent, input.playabilityProfile),
    queuePreview: filterStationsByPlayability(input.queuePreview, input.playabilityProfile),
    playbackHistory: filterStationsByPlayability(input.playbackHistory, input.playabilityProfile),
    trackHistory: input.trackHistory,
    collections: input.collections,
    followedStations: input.followedStations,
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
    rankedCatalog
  );
  const primaryStation = recommendationFeed.profileReady
    ? recommendationDeck[0] || null
    : null;
  const railStations = recommendationFeed.profileReady
    ? mergeStations(
        recommendationFeed.tunedForYou,
        recommendationFeed.becauseYouLiked,
        recommendationFeed.outsideOrbit,
        rankedCatalog
      ).filter((station) => station.stationuuid !== primaryStation?.stationuuid)
    : [];
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
    trackHistory,
    playbackHistory,
    behaviorProfile,
    playabilityProfile,
    toggleFavorite,
    isFavorite
  } = useLibrary();
  const { player, queue, nowPlaying, playStation } = usePlayback();
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
  const debouncedQuery = useDebounce(query, 180);

  const catalog = useMemo(
    () => mergeStations(summary?.catalogPool || [], knownStations),
    [knownStations, summary?.catalogPool]
  );
  const queuePreview = useMemo(() => {
    const startIndex = Math.max(queue.currentIndex, 0);
    return queue.items.slice(startIndex, startIndex + 4);
  }, [queue.currentIndex, queue.items]);
  const recommendationStateUpdatedAt = useMemo(
    () =>
      Math.max(
        behaviorProfile.lastUpdatedAt || 0,
        getPlayabilityProfileUpdatedAt(playabilityProfile)
      ),
    [behaviorProfile.lastUpdatedAt, playabilityProfile]
  );
  const resumeQueuePreview = useMemo(
    () => filterStationsByPlayability(queuePreview, playabilityProfile),
    [playabilityProfile, queuePreview]
  );
  const resumeRecent = useMemo(
    () => filterStationsByPlayability(recent, playabilityProfile),
    [playabilityProfile, recent]
  );
  const resumePlaybackHistory = useMemo(
    () => filterStationsByPlayability(playbackHistory, playabilityProfile),
    [playabilityProfile, playbackHistory]
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
    homeState.sessionSeed,
    recommendationStateUpdatedAt
  );
  const surfaceFeedBase = useMemo(() => {
    const snapshotFresh =
      homeState.snapshot &&
      homeState.snapshot.seed === homeState.sessionSeed &&
      (!recommendationStateUpdatedAt ||
        homeState.snapshot.builtAt >= recommendationStateUpdatedAt);
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
      collections,
      playbackHistory,
      playabilityProfile,
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
    homeState.sessionSeed,
    homeState.snapshot,
    metrics,
    playbackHistory,
    playabilityProfile,
    player.current,
    queuePreview,
    recent,
    recommendationStateUpdatedAt,
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
  const visibleRails = useMemo(
    () => (surfaceFeed?.rails || []).slice(0, denseLayout ? DENSE_RAIL_LIMIT : 3),
    [denseLayout, surfaceFeed?.rails]
  );

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
      const nextSummary = await refreshSummary(seed);
      const effectiveSummary = nextSummary || summary;
      const nextCatalog = mergeStations(effectiveSummary?.catalogPool || [], knownStations);
      if (!effectiveSummary || !nextCatalog.length) {
        refreshHomeSurface(seed);
        return;
      }

      const nextSeed = seed;
      let nextSurface = buildSurfaceFeed({
        catalog: nextCatalog,
        builtAt: Math.max(
          effectiveSummary.generatedAt || 0,
          nextSeed,
          recommendationStateUpdatedAt
        ),
        behaviorProfile,
        favorites,
        recent,
        queuePreview,
        currentStation: player.current,
        followedStations,
        collections,
        playbackHistory,
        playabilityProfile,
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
        <HomeHeroCard
          module={surfaceFeed?.hero || fallbackHero}
          metrics={counts}
          dense={denseLayout}
          isActive={currentStationId === surfaceFeed?.hero.station?.stationuuid}
          activeTrack={activeTrack}
          liked={surfaceFeed?.hero.station ? isFavorite(surfaceFeed.hero.station.stationuuid) : false}
          refreshing={refreshing || (summaryLoading && !surfaceFeed)}
          onPlay={handlePlayStation}
          onToggleFavorite={toggleFavorite}
          onExplore={openSearch}
          onRefresh={handleRefresh}
        />
      )}

      {showSummaryErrorBanner ? (
        <section
          className={`home-status-banner ${denseLayout ? 'is-dense' : ''}`.trim()}
          title={summaryError}
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

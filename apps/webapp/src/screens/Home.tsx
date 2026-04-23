import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { createDiscoveryFeed } from '../lib/discoveryFeed';
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
  HomeHeroCard,
  HomeRail,
  HomeResumeStrip,
  HomeSearchPreview
} from './homeCards';
import './home.css';

const HOME_SESSION_BUCKET_MS = 1000 * 60 * 60 * 2;
const SEARCH_PREVIEW_LIMIT = 3;
const DENSE_SEARCH_PREVIEW_LIMIT = 2;
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

const filterPreviewStations = (catalog: StationLite[], rawQuery: string) => {
  const normalized = rawQuery.trim().toLowerCase();
  if (!normalized) return [];
  return catalog
    .filter((station) =>
      [
        station.name,
        station.country,
        station.state,
        (station as { language?: string }).language,
        station.tags
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalized)
    )
    .slice(0, SEARCH_PREVIEW_LIMIT);
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
  metrics: HomeSurfaceFeed['metrics'];
  queuePreview: StationLite[];
  recent: StationLite[];
  seed: number;
}) => {
  const discoveryFeed = createDiscoveryFeed({
    catalog: input.catalog,
    favorites: input.favorites,
    recent: input.recent,
    queuePreview: input.queuePreview,
    followedStations: input.followedStations,
    collections: input.collections,
    showcaseSeed: input.seed,
    query: '',
    metrics: input.metrics
  });
  return createHomeSurfaceFeed({
    discoveryFeed,
    seed: input.seed,
    builtAt: input.builtAt
  });
};

const surfaceSignature = (surface: HomeSurfaceFeed | null) =>
  JSON.stringify({
    hero: surface?.hero.station?.stationuuid || null,
    rails: (surface?.rails || []).map((rail) => ({
      id: rail.id,
      stations: rail.stations.map((station) => station.stationuuid)
    }))
  });

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
  const { summary, summaryLoading, summaryError, refreshSummary, searchStations } = useCatalog();
  const {
    knownStations,
    favorites,
    recent,
    collections,
    followedStations,
    playbackHistory,
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
  const [manualRefreshTick, setManualRefreshTick] = useState(0);
  const [searchResults, setSearchResults] = useState<StationLite[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const sessionBucketPrimedRef = useRef(false);
  const debouncedQuery = useDebounce(query, 180);

  const catalog = useMemo(
    () => mergeStations(summary?.catalogPool || [], knownStations),
    [knownStations, summary?.catalogPool]
  );
  const queuePreview = useMemo(() => {
    const startIndex = Math.max(queue.currentIndex, 0);
    return queue.items.slice(startIndex, startIndex + 4);
  }, [queue.currentIndex, queue.items]);
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
        queuePreview,
        recent,
        playbackHistory
      }),
    [playbackHistory, player.current, queuePreview, recent]
  );
  const surfaceBuiltAt = homeState.lastBuiltAt || summary?.generatedAt || homeState.sessionSeed;
  const surfaceFeedBase = useMemo(() => {
    if (homeState.snapshot && homeState.snapshot.seed === homeState.sessionSeed) {
      return homeState.snapshot;
    }
    if (!catalog.length) {
      return null;
    }
    return buildSurfaceFeed({
      catalog,
      favorites,
      recent,
      queuePreview,
      followedStations,
      collections,
      seed: homeState.sessionSeed,
      metrics,
      builtAt: surfaceBuiltAt
    });
  }, [
    catalog,
    collections,
    favorites,
    followedStations,
    homeState.sessionSeed,
    homeState.snapshot,
    metrics,
    queuePreview,
    recent,
    surfaceBuiltAt
  ]);
  const surfaceFeed = useMemo(() => {
    if (!surfaceFeedBase) {
      return null;
    }
    let nextSurface = surfaceFeedBase;
    const turns = manualRefreshTick % 4;
    for (let turn = 0; turn < turns; turn += 1) {
      nextSurface = rotateSurfaceFeed(nextSurface);
    }
    return nextSurface;
  }, [manualRefreshTick, surfaceFeedBase]);
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
    const previewStations = searchResults.length
      ? searchResults
      : filterPreviewStations(catalog, debouncedQuery);
    return previewStations.slice(0, denseLayout ? DENSE_SEARCH_PREVIEW_LIMIT : SEARCH_PREVIEW_LIMIT);
  }, [catalog, debouncedQuery, denseLayout, searchResults]);
  const visibleRails = useMemo(
    () => (surfaceFeed?.rails || []).slice(0, denseLayout ? DENSE_RAIL_LIMIT : 3),
    [denseLayout, surfaceFeed?.rails]
  );

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setSearchResults([]);
      setSearchTotal(0);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const response = await searchStations({
          q: debouncedQuery,
          limit: SEARCH_PREVIEW_LIMIT
        });
        if (cancelled) return;
        setSearchResults(response.items.slice(0, SEARCH_PREVIEW_LIMIT));
        setSearchTotal(response.total);
      } catch {
        if (cancelled) return;
        setSearchResults([]);
        setSearchTotal(0);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, searchStations]);

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
    setManualRefreshTick((value) => value + 1);
    const currentSignature = surfaceSignature(surfaceFeed);
    const optimisticSurface = surfaceFeed
      ? {
          ...rotateSurfaceFeed(surfaceFeed),
          seed,
          builtAt: seed
        }
      : null;
    if (surfaceFeed) {
      startTransition(() => {
        setHomeSnapshot(optimisticSurface!);
      });
    }
    try {
      const nextSummary = await refreshSummary(seed);
      const effectiveSummary = nextSummary || summary;
      const nextCatalog = mergeStations(effectiveSummary?.catalogPool || [], knownStations);
      if (!effectiveSummary || !nextCatalog.length) {
        refreshHomeSurface(seed);
        return;
      }

      let nextSeed = seed;
      let nextSurface = buildSurfaceFeed({
        catalog: nextCatalog,
        builtAt: effectiveSummary.generatedAt || nextSeed,
        favorites,
        recent,
        queuePreview,
        followedStations,
        collections,
        seed: nextSeed,
        metrics: effectiveSummary.counts
      });

      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (surfaceSignature(nextSurface) !== currentSignature) break;
        nextSeed += 97 + attempt * 13;
        nextSurface = buildSurfaceFeed({
          catalog: nextCatalog,
          builtAt: effectiveSummary.generatedAt || nextSeed,
          favorites,
          recent,
          queuePreview,
          followedStations,
          collections,
          seed: nextSeed,
          metrics: effectiveSummary.counts
        });
      }

      if (surfaceSignature(nextSurface) === currentSignature) {
        nextSurface =
          optimisticSurface ||
          ({
            ...rotateSurfaceFeed(nextSurface),
            seed: nextSeed + 1,
            builtAt: Date.now()
          } satisfies HomeSurfaceFeed);
      }

      startTransition(() => {
        setHomeSnapshot(nextSurface);
      });
    } finally {
      setRefreshing(false);
    }
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

  return (
    <section
      className="screen screen-home-next"
      data-density={denseLayout ? 'dense' : 'default'}
      data-low-power={lowPower ? 'true' : 'false'}
    >
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

      {summaryError ? (
        <section
          className={`home-status-banner ${denseLayout ? 'is-dense' : ''}`.trim()}
          title={summaryError}
        >
          <div className="home-status-copy">
            <strong>{t('home.catalogUnavailableTitle')}</strong>
            {!denseLayout ? <span>{t('home.catalogUnavailableCopy')}</span> : null}
          </div>
          <button className="home-inline-link" type="button" onClick={handleRefresh}>
            {t('home.refreshFeed')}
          </button>
        </section>
      ) : null}

      <section className="home-search-launcher">
        {!denseLayout ? (
          <div className="home-section-head">
            <div>
              <div className="home-section-title">{t('home.searchTitle')}</div>
              <div className="home-section-copy">{t('home.quickSearchCopy')}</div>
            </div>
            <div className="home-section-badge">
              {debouncedQuery.trim() ? searchTotal : SEARCH_PREVIEW_LIMIT}
            </div>
          </div>
        ) : null}

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
          dense={denseLayout}
          query={debouncedQuery}
          total={searchTotal}
          stations={searchPreviewStations}
          currentStationId={currentStationId}
          activeTrack={activeTrack}
          isFavorite={isFavorite}
          onPlay={handlePlayStation}
          onToggleFavorite={toggleFavorite}
          onOpenSearch={openSearch}
        />
      </section>

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

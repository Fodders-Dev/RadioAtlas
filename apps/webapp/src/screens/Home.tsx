import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CatalogMoodRail,
  CatalogSpotlight,
  DiscoveryFeed,
  DiscoveryStationModule
} from '../domain/contracts';
import { createDiscoveryFeed } from '../lib/discoveryFeed';
import { createHomeRecommendationFeed } from '../lib/homeProfile';
import {
  createHomeResumeModule,
  createHomeSurfaceFeed,
  summaryRailSignature,
  type HomeRailModule,
  type HomeSurfaceFeed
} from '../lib/homeSurface';
import { getDeviceProfile } from '../lib/deviceProfile';
import { useHeroPullToExpand } from '../lib/useHeroPullToExpand';
import { reportProductEvent } from '../lib/productAnalytics';
import { useCompactLayout } from '../lib/useCompactLayout';
import { useCatalog } from '../state/CatalogContext';
import { useLiveNow } from '../lib/useLiveNow';
import { useLocale } from '../state/LocaleContext';
import { useLibrary, usePlayback, useShell } from '../state/RadioContext';
import type { StationLite } from '../types';
import {
  filterStationsByPlayability,
  rankStationsForHome
} from '../lib/stationPlayability';
import { diversifyStationOrder } from '../lib/stationDiversity';
import {
  isStationHiddenFromRecommendations,
  rankStationsForUser,
  tasteSignature,
  withFavoriteTasteBoosts
} from '../lib/tasteProfile';
import { useTasteCandidatePool } from '../lib/useTasteCandidatePool';
import { AppScreenSkeleton } from '../components/AppScreenSkeleton';
import { HomeHeroCard, HomeRail, HomeResumeStrip } from './homeCards';
import './home.css';
import './homeReference.css';

// T_mobile_1 D: shortened from 2h to 30min. Re-opens within the bucket reuse
// the cached snapshot (same seed → identical ordering of every rail), which the
// live mobile feedback "каждый раз одно и то же" surfaced. 30min lets a user
// who closes Telegram and returns later in the same hour see a fresh shuffle
// while still avoiding a re-rank on every tab focus inside one session.
// Exported for the bucket unit test alongside isSameSessionBucket below.
export const HOME_SESSION_BUCKET_MS = 1000 * 60 * 30;
// Bumped to 6 after the responsive Home recovery so returning users do not keep
// a sparse cached surface created while the local API was unavailable.
const HOME_SURFACE_VERSION = 6;
// T2.22: room for the full discovery set — fresh-now · Trending · country ·
// genre · Top voted · Late night · Workout · Focus · Driving · Around the world
// — on both layouts (dense shows all ten; desktop also fits companions/resume).
const DESKTOP_RAIL_LIMIT = 12;
const DENSE_RAIL_LIMIT = 10;
// What a listener with no history sees: exactly one shelf, and specifically the
// one built from what other people already voted for.
const FIRST_RUN_RAIL_LIMIT = 1;
const FIRST_RUN_RAIL_ID = 'top-voted';
const HOME_MIN_RAIL_STATIONS = 3;

// «Быстрый выбор» — curated glass quick-pick chips under the hero (the reference
// look). Each opens the Поиск tab pre-filled with a mood/genre query.
const HOME_QUICK_CHIPS = [
  {
    key: 'trending',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M13.5 0.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z" />
      </svg>
    ),
    labelKey: 'home.chipTrending',
    query: 'hits'
  },
  {
    key: 'night',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M9.5 2c-1.82 0-3.53.5-5 1.35 2.99 1.73 5 4.95 5 8.65s-2.01 6.92-5 8.65C5.97 21.5 7.68 22 9.5 22c5.52 0 10-4.48 10-10S15.02 2 9.5 2z" />
      </svg>
    ),
    labelKey: 'home.chipNight',
    query: 'lofi chillout'
  },
  {
    key: 'workout',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M20.57 14.86L22 13.43 20.57 12 17 15.57 8.43 7 12 3.43 10.57 2 9.14 3.43 7.71 2 5.57 4.14 4.14 2.71 2.71 4.14l1.43 1.43L2 7.71l1.43 1.43L2 10.57 3.43 12 7 8.43 15.57 17 12 20.57 13.43 22l1.43-1.43L16.29 22l2.14-2.14 1.43 1.43 1.43-1.43-1.43-1.43L22 16.29z" />
      </svg>
    ),
    labelKey: 'home.chipWorkout',
    query: 'workout dance'
  },
  {
    key: 'driving',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z" />
      </svg>
    ),
    labelKey: 'home.chipDriving',
    query: 'rock classic'
  },
  {
    key: 'focus',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z" />
      </svg>
    ),
    labelKey: 'home.chipFocus',
    query: 'ambient piano'
  },
  {
    key: 'news',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M22 3l-1.67 1.67L18.67 3 17 4.67 15.33 3l-1.66 1.67L12 3l-1.67 1.67L8.67 3 7 4.67 5.33 3 3.67 4.67 2 3v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V3zM11 19H4v-6h7v6zm9 0h-7v-2h7v2zm0-4h-7v-2h7v2zm0-4H4V8h16v3z" />
      </svg>
    ),
    labelKey: 'home.chipNews',
    query: 'news'
  }
] as const;

// T2.23 variety pass — render-mode variants, looked up by rail id (no data
// shape change, no HOME_SURFACE_VERSION bump). fresh-now leads with a featured
// first tile; the "most-voted" lane renders as an artwork-only logo strip.
const railVariant = (railId: string): 'default' | 'featured-lead' | 'logo-strip' =>
  railId === 'fresh-now' ? 'featured-lead' : railId === 'top-voted' ? 'logo-strip' : 'default';

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

export const isSameSessionBucket = (left: number | null, right: number) => {
  if (!left) return false;
  return Math.floor(left / HOME_SESSION_BUCKET_MS) === Math.floor(right / HOME_SESSION_BUCKET_MS);
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
  // Cross-session exposure ledger: softly demote just-seen/played stations so
  // «Для тебя» stays fresh across opens (shared with the «Лента» feed).
  exposure?: ReturnType<typeof useLibrary>['stationExposure'] | null;
  metrics: HomeSurfaceFeed['metrics'];
  queuePreview: StationLite[];
  recent: StationLite[];
  playbackHistory: StationLite[];
  trackHistory: ReturnType<typeof useLibrary>['trackHistory'];
  currentStation: StationLite | null;
  seed: number;
  // T2.21: pre-ranked server-signal pools threaded from the catalogue summary.
  trending?: StationLite[];
  topVoted?: StationLite[];
  aroundTheWorld?: CatalogSpotlight | null;
  // T2.22: server-bucketed mood shelves threaded from the summary.
  moodRails?: CatalogMoodRail[];
  // T_audit_10: rail-composition fingerprint of the summary this surface is
  // built from, stamped onto the snapshot for the revalidation gate.
  summarySignature?: string;
  // T_audit_9: taste fingerprint stamped onto the snapshot so a like/skip/hide
  // re-ranks the surface eagerly (sibling to summarySignature).
  tasteSignature?: string;
}) => {
  const rankedCatalog = rankStationsForUser(input.catalog, input.tasteProfile, input.playabilityProfile, {
    mode: 'personal',
    currentStation: input.currentStation,
    seed: input.seed,
    limit: input.catalog.length,
    healthProfile: input.stationHealthProfile,
    sessionEvents: input.radioSessionEvents,
    exposure: input.exposure
  });
  const ownedStationIds = new Set<string>();
  input.favorites.forEach((station) => ownedStationIds.add(station.stationuuid));
  input.recent.forEach((station) => ownedStationIds.add(station.stationuuid));
  if (input.currentStation) ownedStationIds.add(input.currentStation.stationuuid);
  const isFreshRecommendation = (station: StationLite) => !ownedStationIds.has(station.stationuuid);
  const recommendationCatalog = rankedCatalog.filter(isFreshRecommendation);
  const discoveryCatalog = recommendationCatalog.length >= 12 ? recommendationCatalog : rankedCatalog;
  const personalizeStations = (stations: StationLite[] | undefined, seedOffset: number) =>
    diversifyStationOrder(
      rankStationsForUser(stations || [], input.tasteProfile, input.playabilityProfile, {
        mode: 'personal',
        currentStation: input.currentStation,
        seed: input.seed + seedOffset,
        limit: stations?.length || 0,
        healthProfile: input.stationHealthProfile,
        sessionEvents: input.radioSessionEvents,
        exposure: input.exposure
      }).filter(isFreshRecommendation),
      {
        limit: stations?.length || 0,
        maxPerCountry: 2,
        maxPerPrimaryTag: 3,
        maxPerNameKey: 1
      }
    );
  const personalizeSpotlight = (spotlight: CatalogSpotlight | null | undefined, seedOffset: number) =>
    spotlight
      ? {
          ...spotlight,
          stations: personalizeStations(spotlight.stations, seedOffset)
        }
      : null;
  const personalizedMoodRails = (input.moodRails || []).map((rail, index) => ({
    ...rail,
    stations: personalizeStations(rail.stations, 310 + index * 17)
  }));
  const recommendationFeed = createHomeRecommendationFeed({
    catalog: recommendationCatalog.length ? recommendationCatalog : rankedCatalog,
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
    rotationSeed: input.seed,
    exposure: input.exposure
  });
  const discoveryFeed = createDiscoveryFeed({
    catalog: discoveryCatalog,
    favorites: input.favorites,
    recent: input.recent,
    queuePreview: input.queuePreview,
    followedStations: input.followedStations,
    collections: input.collections,
    showcaseSeed: input.seed,
    query: '',
    metrics: input.metrics,
    trending: personalizeStations(input.trending, 101),
    topVoted: personalizeStations(input.topVoted, 137),
    aroundTheWorld: personalizeSpotlight(input.aroundTheWorld, 173),
    moodRails: personalizedMoodRails
  });
  const recommendationDeck = mergeStations(
    recommendationFeed.tunedForYou,
    recommendationFeed.becauseYouLiked,
    recommendationFeed.outsideOrbit,
    recommendationCatalog.length ? recommendationCatalog : rankedCatalog
  );
  const diversifiedRecommendationDeck = diversifyStationOrder(recommendationDeck, {
    limit: recommendationDeck.length,
    preserveFirst: true,
    maxPerCountry: 3,
    maxPerPrimaryTag: 4,
    maxPerNameKey: 1
  });
  const primaryStation = diversifiedRecommendationDeck[0] || null;
  const railStations = diversifiedRecommendationDeck.filter(
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
    builtAt: input.builtAt,
    summarySignature: input.summarySignature,
    tasteSignature: input.tasteSignature
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
  const { summary, summaryLoading, summaryError, refreshSummary, searchStations } = useCatalog();

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
    stationExposure,
    recordStationsShown,
    toggleFavorite,
    isFavorite
  } = useLibrary();
  const { player, queue, nowPlaying, playStation } = usePlayback();
  const {
    setActiveSection,
    homeState,
    setHomeSnapshot,
    refreshHomeSurface,
    rerollFeedSeed,
    setFeedEntryStation,
    setSearchDraft
  } = useShell();
  const { t } = useLocale();
  const isCompactLayout = useCompactLayout();
  const lowPower = getDeviceProfile().lowPower;
  // Low-power devices keep the same information architecture; only motion,
  // blur and decorative effects are reduced through data-low-power styles.
  // Coupling this flag to geometry turned wide laptops into a sparse mobile
  // layout, which was the source of the desktop "desert" regression.
  const denseLayout = isCompactLayout;
  const [refreshing, setRefreshing] = useState(false);
  const sessionBucketPrimedRef = useRef(false);
  const dismissedSummaryErrorRef = useRef<string | null>(null);
  const homeImpressionSignatureRef = useRef('');
  const homeExposureFlushedRef = useRef('');

  // ON-TASTE candidates from the FULL 60k catalog, scoped by the user's own
  // language/country (see tasteCandidates.ts for why NOT by tag alone). The
  // server pool is a generic slice, so without this the ranker could only ever
  // rank other people's stations — the owner's «рекомендации однообразные… у
  // меня в медиатеке совсем другой вкус». Merged, never substituted: discovery
  // must not collapse to what the user already likes, and a cold-start user
  // (no confident signal) gets exactly the previous behaviour.
  const effectiveTasteProfile = useMemo(
    () => withFavoriteTasteBoosts(tasteProfile, favorites),
    [favorites, tasteProfile]
  );
  const tasteCandidates = useTasteCandidatePool(
    effectiveTasteProfile,
    searchStations,
    homeState.sessionSeed
  );
  const catalog = useMemo(
    () => mergeStations(summary?.catalogPool || [], tasteCandidates, knownStations),
    [knownStations, summary?.catalogPool, tasteCandidates]
  );
  // «Что слушают сейчас»: real presence from our own counting. The server
  // already withholds any station below its privacy floor, so an empty list is
  // the honest common case while the app is small — and an empty list renders
  // NO block at all rather than a placeholder.
  const liveNow = useLiveNow(catalog);
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
    tasteProfile: effectiveTasteProfile,
    stationHealthProfile,
    radioSessionEvents,
    stationExposure,
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
      tasteProfile: effectiveTasteProfile,
      stationHealthProfile,
      radioSessionEvents,
      stationExposure,
      trackHistory,
      recent,
      playbackHistory,
      currentStation: player.current,
      queuePreview
    };
  });

  // T_audit_10: the rail-composition fingerprint of the CURRENT summary. The
  // snapshot stores the signature it was built from; when a background
  // revalidation swaps a stale 5-rail fallback-cache payload for the real
  // 12-rail network payload, this changes and the snapshot is no longer fresh,
  // so the surface rebuilds from the fuller summary instead of being frozen.
  const summarySignature = summaryRailSignature(summary);
  // T_audit_9: taste fingerprint of the CURRENT profile. The snapshot stores the
  // signature it was built from; a like/skip/hide changes it → snapshot is no
  // longer fresh → the surface rebuilds with the new taste (same seed, so only
  // the taste-ranked fresh-now rail re-orders; the seed-ordered server pools
  // stay put). A single play doesn't shift the top tags, so the signature is
  // stable and the snapshot stays frozen — preserving the T1.2 rank-freeze.
  const tasteSig = tasteSignature(effectiveTasteProfile);
  const surfaceFeedBase = useMemo(() => {
    const snapshotFresh =
      homeState.snapshot &&
      homeState.snapshot.version === HOME_SURFACE_VERSION &&
      homeState.snapshot.seed === homeState.sessionSeed &&
      homeState.snapshot.summarySignature === summarySignature &&
      homeState.snapshot.tasteSignature === tasteSig;
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
    const rebuiltSurface = buildSurfaceFeed({
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
      // T_audit_9 + favorites overlay: use the current effective taste directly.
      // The ref updates after render, so it can lag the just-changed like set;
      // the rest stay on the ref because they are play-churn fields we freeze.
      tasteProfile: effectiveTasteProfile,
      stationHealthProfile: live.stationHealthProfile,
      radioSessionEvents: live.radioSessionEvents,
      exposure: live.stationExposure,
      trackHistory: live.trackHistory,
      seed: homeState.sessionSeed,
      metrics,
      builtAt: surfaceBuiltAt,
      trending: summary?.trending,
      topVoted: summary?.topVoted,
      aroundTheWorld: summary?.aroundTheWorld,
      moodRails: summary?.moodRails,
      summarySignature,
      tasteSignature: tasteSig
    });
    // Likes are allowed to re-rank discovery shelves immediately, but the
    // recommended hero must not switch under the user's finger. Preserve it
    // inside the same seed + catalogue composition; explicit Refresh changes
    // the seed and therefore still advances the hero deck.
    const previousSurface = homeState.snapshot;
    const keepHero =
      previousSurface?.version === HOME_SURFACE_VERSION &&
      previousSurface.seed === homeState.sessionSeed &&
      previousSurface.summarySignature === summarySignature;
    return keepHero
      ? { ...rebuiltSurface, hero: previousSurface.hero }
      : rebuiltSurface;
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
    summarySignature,
    tasteSig,
    surfaceBuiltAt
  ]);
  const surfaceFeed = surfaceFeedBase;
  const currentStationId = player.current?.stationuuid || null;
  const activeTrack = currentStationId ? nowPlaying : null;
  // Owner ask #1: «Рекомендуем» shows what is ON AIR whenever anything is
  // loaded, and falls back to the frozen recommendation only when the player is
  // idle.
  //
  // Deliberately a PRESENTATION override, computed AFTER surfaceFeedBase and
  // never fed back into it. Putting player.current into buildSurfaceFeed would
  // re-run rankStationsForUser with a new currentStation bias and reshuffle
  // every rail under the user's finger — the exact regression
  // tests/home-rank-freeze.spec.ts guards, and the whole reason
  // homeRankInputsRef exists (see the essay above).
  // IDENTITY: the hero renders the loaded station. Deliberately NOT gated on
  // isPlaying — the card must not flip back to the recommendation every time the
  // user pauses.
  const heroNowPlaying = Boolean(player.current);
  // HONESTY: «Сейчас играет» and the LIVE dot are claims about the air, so they
  // are gated on real playback. A paused (or errored) station is still the hero,
  // but it reads «На паузе» and drops the LIVE badge — `player.current` outlives
  // both pause and failure, so presence alone would make the badge lie.
  const heroOnAir = heroNowPlaying && player.isPlaying;
  const recommendedHeroId = surfaceFeed?.hero.station?.stationuuid ?? null;
  const heroModule = useMemo(() => {
    const recommended = surfaceFeed?.hero ?? null;
    if (!recommended || !player.current) return recommended;
    // companionStations dropped: the on-air station has no "3 like it" set, and
    // HomeHeroCard's playlist becomes [current] — which handlePlayStation
    // short-circuits into a pause toggle before it ever reaches playStation, so
    // the hero's play button is a correct play/pause for the on-air station and
    // rewrites no queue.
    return {
      ...recommended,
      station: player.current,
      companionStations: [],
      sourceId: 'home-now-playing'
    };
  }, [surfaceFeed?.hero, player.current]);
  const surfaceRails = useMemo(() => surfaceFeed?.rails || [], [surfaceFeed?.rails]);
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
  // A user who has never played anything, never liked anything and has no
  // recents has not "chosen" yet — and the shop window is exactly wrong for
  // them. Measured on prod: a newcomer's first screen was 11 rails, 3315px and
  // ~64 station names they have no reason to care about.
  //
  // Deliberately derived from the LIBRARY (not from a "seen onboarding" flag):
  // it needs no new persisted state, it cannot desync, and it un-latches by
  // itself the moment the first station plays.
  const isFirstRun =
    !playbackHistory.length && !favorites.length && !recent.length;

  const visibleRails = useMemo(() => {
    // A first-time listener gets ONE shelf — not eleven, and not zero: an empty
    // screen under the hero reads as broken. «Top voted» is the shelf, chosen
    // deliberately: it is stations other people already liked, which is the
    // gentlest possible entry for someone who has chosen nothing yet. Everything
    // else opens the moment they play something, because isFirstRun reads the
    // library.
    const limit = isFirstRun
      ? FIRST_RUN_RAIL_LIMIT
      : denseLayout
        ? DENSE_RAIL_LIMIT
        : DESKTOP_RAIL_LIMIT;
    const usedStationIds = new Set<string>(
      sessionBlockedStationsRef.current.stations
    );
    const rails: HomeRailModule[] = [];
    const orderedSource = isFirstRun
      ? [...surfaceRails].sort((left, right) =>
          Number(right.id === FIRST_RUN_RAIL_ID) - Number(left.id === FIRST_RUN_RAIL_ID)
        )
      : surfaceRails;
    orderedSource.forEach((rail) => {
      if (rails.length >= limit) return;
      const stations = rail.stations.filter((station) => !usedStationIds.has(station.stationuuid));
      if (!stations.length) return;
      // T2.20: hide thin secondary shelves — a 1–2 tile row reads as clutter,
      // not a shelf — but always keep the primary rail so Home never renders
      // railless (matters only for tiny catalogues; production rails carry 6).
      if (rails.length > 0 && stations.length < HOME_MIN_RAIL_STATIONS) return;
      stations.forEach((station) => usedStationIds.add(station.stationuuid));
      rails.push({ ...rail, stations });
    });
    if (rails.length >= limit) return rails;

    const pickStations = (stations: StationLite[]) => {
      const merged = mergeStations(stations);
      const fresh = merged.filter((station) => !usedStationIds.has(station.stationuuid));
      // Fallback shelves may be shorter on a tiny/offline catalogue, but they
      // must never republish stations already visible in an earlier shelf.
      const picked = fresh.slice(0, 6);
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

    return rails.slice(0, limit);
    // sessionBlockedStationsRef is read inside; it re-snapshots only on
    // homeState.sessionSeed change which is implicit through surfaceRails.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, denseLayout, isFirstRun, rankedCatalogRails, surfaceRails]);

  useEffect(() => {
    const stationIds = mergeStations(
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
  }, [denseLayout, visibleRails]);

  // Record the «Для тебя» LEADERS into the exposure ledger so Home self-rotates —
  // otherwise Home consumes the freshness penalty but never writes it, and a user
  // who never opens the feed keeps seeing the same top picks. Only the fresh-now
  // head (not all ~80 rail stations — that would over-demote deep rails and blow
  // the ledger cap); those leaders are what re-appear as «одно и то же». Deduped
  // per surface; exposure is read via a ref so this doesn't rebuild Home mid-session
  // — the demotion lands on the NEXT build (bucket flip / «Обновить» / feed reroll).
  useEffect(() => {
    const leadRail = visibleRails.find((rail) => rail.id === 'fresh-now') || visibleRails[0];
    const leaderIds = (leadRail?.stations || [])
      .slice(0, 6)
      .map((station) => station.stationuuid)
      .filter(Boolean);
    if (!leaderIds.length) return;
    const signature = leaderIds.join('|');
    if (homeExposureFlushedRef.current === signature) return;
    homeExposureFlushedRef.current = signature;
    recordStationsShown(leaderIds);
  }, [visibleRails, recordStationsShown]);

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
      homeState.snapshot.builtAt === surfaceFeedBase.builtAt &&
      // T_audit_10: also re-persist when the rebuilt surface came from a
      // different summary composition (e.g. the cold-load fallback→network
      // swap). Without this the memo would rebuild the fuller surface on every
      // render but never cache it, since seed/builtAt can be unchanged when the
      // fallback's generatedAt happens to outrank the network's.
      homeState.snapshot.summarySignature === surfaceFeedBase.summarySignature &&
      // T_audit_9: likewise re-persist when taste changed. A like/skip rebuilds
      // fresh-now with the same seed and builtAt, so without this clause the new
      // surface would render but never be cached, and the memo would rebuild it
      // every render (the gate would keep seeing the stale snapshot's taste).
      homeState.snapshot.tasteSignature === surfaceFeedBase.tasteSignature
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
        tasteProfile: effectiveTasteProfile,
        stationHealthProfile,
        radioSessionEvents,
        exposure: stationExposure,
        trackHistory,
        seed: nextSeed,
        metrics: effectiveSummary.counts,
        trending: effectiveSummary.trending,
        topVoted: effectiveSummary.topVoted,
        aroundTheWorld: effectiveSummary.aroundTheWorld,
        moodRails: effectiveSummary.moodRails,
        summarySignature: summaryRailSignature(effectiveSummary),
        tasteSignature: tasteSignature(effectiveTasteProfile)
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
  // THE single feed-open path. The «Лента» button, the keyboard/screen-reader
  // activation of that same button, and the hero pull-down gesture all call this
  // one function — so they are #86-identical by construction and there is no
  // second, gesture-only route into StationFeed to reason about.
  //
  // Everything here must stay inside a user-gesture handler and out of any
  // effect: rerollFeedSeed would double-fire under StrictMode from an effect,
  // re-rolling the mix twice per open.
  const openFeed = useCallback(() => {
    // Pin the hero as feed card 0 — this is what makes «свайпнул героя, он вырос
    // в ленту» literally true (the expanded feed opens ON the same station the
    // card was showing) instead of a cross-fade into an unrelated station.
    setFeedEntryStation(heroModule?.station ?? null);
    rerollFeedSeed();
    setActiveSection('feed');
  }, [heroModule?.station, rerollFeedSeed, setActiveSection, setFeedEntryStation]);

  // Pull-down-to-expand. Touch drag, mouse drag and trackpad/wheel all commit
  // through openFeed above; the button remains the canonical, keyboard-reachable
  // path (a11y constraint C — the gesture is strictly additive).
  const { surfaceRef, pullPhase } = useHeroPullToExpand(openFeed);
  const showSummaryErrorBanner =
    Boolean(summaryError) &&
    (!summary || catalog.length === 0) &&
    dismissedSummaryErrorRef.current !== summaryError;
  const leadRail = visibleRails[0] || null;
  const secondaryRailsBase = leadRail
    ? visibleRails.filter((module) => module.id !== leadRail.id)
    : visibleRails;
  const newStationsRail = secondaryRailsBase.find((module) => module.id === 'home-new-stations');
  const secondaryRails = newStationsRail
    ? [newStationsRail, ...secondaryRailsBase.filter((module) => module.id !== newStationsRail.id)]
    : secondaryRailsBase;

  return (
    <section
      ref={surfaceRef}
      className="screen screen-home-next"
      data-density={denseLayout ? 'dense' : 'default'}
      data-low-power={lowPower ? 'true' : 'false'}
      data-hero-pull={pullPhase}
    >
      {showHomeHeroSkeleton ? (
        <AppScreenSkeleton section="home" scope="home-hero" />
      ) : surfaceFeed && heroModule ? (
        <HomeHeroCard
          dense={denseLayout}
          module={heroModule}
          nowPlaying={heroNowPlaying}
          onAir={heroOnAir}
          recommendedStationId={recommendedHeroId}
          isActive={heroNowPlaying}
          activeTrack={heroNowPlaying ? activeTrack : null}
          liked={heroModule.station ? isFavorite(heroModule.station.stationuuid) : false}
          refreshing={refreshing}
          onPlay={handlePlayStation}
          onToggleFavorite={toggleFavorite}
          onExplore={openSearch}
          onRefresh={handleRefresh}
          subscribeVisualizer={player.subscribeVisualizer}
          // Was passed unconditionally: a recommendation hero rendered a live
          // audio-reactive equalizer for audio it was not producing. The bars are
          // only honest when THIS station is the one on air.
          visualizerActive={player.visualizer.active && heroOnAir}
        />
      ) : (
        <AppScreenSkeleton section="home" scope="home-hero" />
      )}

      {/* The standalone «Лента» BLOCK is retired (owner ask #3): the hero IS the
          feed entry now — pull it down and it grows into the fullscreen Лента.
          What survives here is a slim grabber handle welded under the hero: the
          drag affordance, and — critically — the keyboard/screen-reader path,
          since a gesture-only entry point would be an a11y regression.

          The `home-feed-entry` class and the `data-home-feed-entry` attribute are
          preserved VERBATIM and rendered unconditionally (outside the skeleton /
          empty-hero branches): ~65 e2e anchors across 12 spec files use this
          element as the "Home is hydrated" sentinel, and StationFeed's
          resolveFeedReturnFocus restores focus to it by that exact selector.
          `[data-home-hero]` cannot serve either role — it is absent in the
          skeleton and empty states, which mobile.spec.ts asserts happens.

          `.home-surface-refresh` stays a sibling inside this wrapper — three
          specs depend on it and it has no second instance. */}
      <div className="home-feed-hero">
        <button
          type="button"
          className="home-feed-entry"
          data-home-feed-entry="true"
          onClick={openFeed}
          // Action-shaped, NOT the visible «Потяни вниз» copy: aria-label
          // replaces the element's text for a screen reader, and describing a
          // gesture is useless to someone activating this with Enter/Space. The
          // pull affordance stays in the visible subtitle where it is relevant.
          aria-label={t('home.feedEntryOpen')}
        >
          <span className="home-feed-entry-grip" aria-hidden="true" />
          <span className="home-feed-entry-copy">
            <span className="home-feed-entry-title">{t('home.feedEntryTitle')}</span>
            <span className="home-feed-entry-sub">{t('home.feedEntrySub')}</span>
          </span>
        </button>
        <button
          className={`home-surface-refresh ${refreshing ? 'is-loading' : ''}`.trim()}
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          aria-label={t('home.refreshFeed')}
          title={t('home.refreshFeed')}
          data-action="refresh-feed"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M17.7 6.3A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.76-4.24L13 11h8V3z" />
          </svg>
          <span>{t('home.refreshFeed')}</span>
        </button>
      </div>

      {/* First run: the shop window is gated off above, so this is what stands
          between the hero and an empty screen. Two sentences, both load-bearing
          — «живой эфир» is the shared-moment pillar, «останется здесь» is the
          never-lose-what-you-found one — plus an explicit way OUT to the whole
          catalogue so nobody feels walled in. Disappears the moment the first
          station plays, because isFirstRun reads the library. */}
      {isFirstRun ? (
        <section className="home-first-run" data-home-first-run>
          <h2 className="home-first-run-title">{t('home.firstRunTitle')}</h2>
          <p className="home-first-run-body">{t('home.firstRunBody')}</p>
          <button
            className="home-first-run-browse"
            type="button"
            // Empty query: land on Search with the full catalogue, not a result set.
            onClick={() => openSearch('')}
          >
            {t('home.firstRunBrowse')}
          </button>
        </section>
      ) : null}

      <section className="home-quick-chips-section">
        <div className="home-quick-chips-head">
          <h2>{t('home.quickChipsLabel')}</h2>
          <button
            className="home-section-see-all"
            type="button"
            onClick={() => openSearch('')}
          >
            {t('home.seeAll')}
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 5l1.4-1.4L18.8 12l-8.4 8.4L9 19l7-7-7-7Z" />
            </svg>
          </button>
        </div>
        <nav className="home-quick-chips" aria-label={t('home.quickChipsLabel')}>
          {HOME_QUICK_CHIPS.map((chip) => (
            <button
              key={chip.key}
              className="home-quick-chip"
              type="button"
              onClick={() => openSearch(chip.query)}
            >
              <span className="home-quick-chip-glyph" aria-hidden="true">
                {chip.icon}
              </span>
              {t(chip.labelKey)}
            </button>
          ))}
        </nav>
      </section>

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

      {leadRail ? (
        <HomeRail
          dense={denseLayout}
          module={{ ...leadRail, titleKey: 'home.tryNowTitle' }}
          variant={railVariant(leadRail.id)}
          currentStationId={currentStationId}
          activeTrack={activeTrack}
          isFavorite={isFavorite}
          onPlay={handlePlayStation}
          onToggleFavorite={toggleFavorite}
          onExplore={openSearch}
        />
      ) : null}

      {liveNow.length ? (
        <HomeRail
          dense={denseLayout}
          module={{
            id: 'home-live-now',
            titleKey: 'home.liveNowTitle',
            copyKey: 'home.liveNowCopy',
            sourceId: 'live-now',
            accent: 'primary',
            label: null,
            stations: liveNow.map((entry) => entry.station)
          }}
          variant="default"
          currentStationId={currentStationId}
          activeTrack={activeTrack}
          isFavorite={isFavorite}
          onPlay={handlePlayStation}
          onToggleFavorite={toggleFavorite}
          onExplore={openSearch}
        />
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
          onExplore={openSearch}
        />
      ) : null}

      {secondaryRails.map((module) => (
        <HomeRail
          key={module.id}
          dense={denseLayout}
          module={
            module.id === 'home-new-stations'
              ? { ...module, titleKey: 'home.discoverNewTitle' }
              : module
          }
          variant={railVariant(module.id)}
          currentStationId={currentStationId}
          activeTrack={activeTrack}
          isFavorite={isFavorite}
          onPlay={handlePlayStation}
          onToggleFavorite={toggleFavorite}
          onExplore={openSearch}
        />
      ))}
    </section>
  );
};

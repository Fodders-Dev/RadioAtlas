import type { Page } from '@playwright/test';
import type { BehaviorProfile } from '../src/lib/homeProfile';
import {
  DEFAULT_PLAYABILITY_PROFILE,
  type StationPlayabilityProfile
} from '../src/lib/stationPlayability';
import {
  DEFAULT_STATION_HEALTH_PROFILE,
  type StationHealthProfile
} from '../src/lib/stationHealth';
import {
  DEFAULT_TASTE_PROFILE_V2,
  type TasteProfileV2
} from '../src/lib/tasteProfile';
import { DEFAULT_NOTIFICATION_PREFERENCE } from '../src/lib/retention';
import type { RadioSessionEvent } from '../src/lib/radioSession';

export const stations = [
  {
    stationuuid: 'uuid-tokyo',
    name: 'Tokyo FM',
    url: 'https://stream.example.com/tokyo',
    url_resolved: 'https://stream.example.com/tokyo',
    homepage: 'https://tokyofm.example.com',
    favicon: '',
    tags: 'pop,jpop',
    country: 'Japan',
    countrycode: 'JP',
    state: 'Tokyo',
    language: 'Japanese',
    codec: 'MP3',
    bitrate: 128,
    geo_lat: 35.6895,
    geo_long: 139.6917
  },
  {
    stationuuid: 'uuid-osaka',
    name: 'Osaka Nights',
    url: 'https://stream.example.com/osaka',
    url_resolved: 'https://stream.example.com/osaka',
    homepage: 'https://osakanights.example.com',
    favicon: '',
    tags: 'jpop,night',
    country: 'Japan',
    countrycode: 'JP',
    state: 'Osaka',
    language: 'Japanese',
    codec: 'MP3',
    bitrate: 128,
    geo_lat: 34.6937,
    geo_long: 135.5023
  },
  {
    stationuuid: 'uuid-kyoto',
    name: 'Kyoto Groove',
    url: 'https://stream.example.com/kyoto',
    url_resolved: 'https://stream.example.com/kyoto',
    homepage: 'https://kyotogroove.example.com',
    favicon: '',
    tags: 'jpop,groove',
    country: 'Japan',
    countrycode: 'JP',
    state: 'Kyoto',
    language: 'Japanese',
    codec: 'AAC',
    bitrate: 96,
    geo_lat: 35.0116,
    geo_long: 135.7681
  },
  {
    stationuuid: 'uuid-sapporo',
    name: 'Sapporo City Pop',
    url: 'https://stream.example.com/sapporo',
    url_resolved: 'https://stream.example.com/sapporo',
    homepage: 'https://sapporocitypop.example.com',
    favicon: '',
    tags: 'jpop,citypop',
    country: 'Japan',
    countrycode: 'JP',
    state: 'Hokkaido',
    language: 'Japanese',
    codec: 'MP3',
    bitrate: 128,
    geo_lat: 43.0618,
    geo_long: 141.3545
  },
  {
    stationuuid: 'uuid-berlin',
    name: 'Berlin Pulse',
    url: 'https://stream.example.com/berlin',
    url_resolved: 'https://stream.example.com/berlin',
    homepage: 'https://berlinpulse.example.com',
    favicon: '',
    tags: 'techno,house',
    country: 'Germany',
    countrycode: 'DE',
    state: 'Berlin',
    language: 'German',
    codec: 'AAC',
    bitrate: 96,
    geo_lat: 52.52,
    geo_long: 13.405
  },
  {
    stationuuid: 'uuid-hamburg',
    name: 'Hamburg Transit',
    url: 'https://stream.example.com/hamburg',
    url_resolved: 'https://stream.example.com/hamburg',
    homepage: 'https://hamburgtransit.example.com',
    favicon: '',
    tags: 'techno,industrial',
    country: 'Germany',
    countrycode: 'DE',
    state: 'Hamburg',
    language: 'German',
    codec: 'AAC',
    bitrate: 96,
    geo_lat: 53.5511,
    geo_long: 9.9937
  },
  {
    stationuuid: 'uuid-munich',
    name: 'Munich Drive',
    url: 'https://stream.example.com/munich',
    url_resolved: 'https://stream.example.com/munich',
    homepage: 'https://munichdrive.example.com',
    favicon: '',
    tags: 'techno,drive',
    country: 'Germany',
    countrycode: 'DE',
    state: 'Bavaria',
    language: 'German',
    codec: 'MP3',
    bitrate: 128,
    geo_lat: 48.1351,
    geo_long: 11.582
  },
  {
    stationuuid: 'uuid-cologne',
    name: 'Cologne Wave',
    url: 'https://stream.example.com/cologne',
    url_resolved: 'https://stream.example.com/cologne',
    homepage: 'https://colognewave.example.com',
    favicon: '',
    tags: 'techno,wave',
    country: 'Germany',
    countrycode: 'DE',
    state: 'North Rhine-Westphalia',
    language: 'German',
    codec: 'AAC',
    bitrate: 96,
    geo_lat: 50.9375,
    geo_long: 6.9603
  },
  {
    stationuuid: 'uuid-rio',
    name: 'Rio Beats',
    url: 'https://stream.example.com/rio',
    url_resolved: 'https://stream.example.com/rio',
    homepage: 'https://riobeats.example.com',
    favicon: '',
    tags: 'samba,bossa',
    country: 'Brazil',
    countrycode: 'BR',
    state: 'Rio de Janeiro',
    language: 'Portuguese',
    codec: 'MP3',
    bitrate: 128,
    geo_lat: -22.9068,
    geo_long: -43.1729
  },
  {
    stationuuid: 'uuid-saopaulo',
    name: 'Sao Paulo Samba',
    url: 'https://stream.example.com/saopaulo',
    url_resolved: 'https://stream.example.com/saopaulo',
    homepage: 'https://saopaulosamba.example.com',
    favicon: '',
    tags: 'samba,latin',
    country: 'Brazil',
    countrycode: 'BR',
    state: 'Sao Paulo',
    language: 'Portuguese',
    codec: 'MP3',
    bitrate: 128,
    geo_lat: -23.5558,
    geo_long: -46.6396
  },
  {
    stationuuid: 'uuid-bahia',
    name: 'Bahia Groove',
    url: 'https://stream.example.com/bahia',
    url_resolved: 'https://stream.example.com/bahia',
    homepage: 'https://bahiagroove.example.com',
    favicon: '',
    tags: 'samba,groove',
    country: 'Brazil',
    countrycode: 'BR',
    state: 'Bahia',
    language: 'Portuguese',
    codec: 'AAC',
    bitrate: 96,
    geo_lat: -12.9714,
    geo_long: -38.5014
  },
  {
    stationuuid: 'uuid-brasilia',
    name: 'Brasilia Nights',
    url: 'https://stream.example.com/brasilia',
    url_resolved: 'https://stream.example.com/brasilia',
    homepage: 'https://brasilianights.example.com',
    favicon: '',
    tags: 'samba,night',
    country: 'Brazil',
    countrycode: 'BR',
    state: 'Federal District',
    language: 'Portuguese',
    codec: 'MP3',
    bitrate: 128,
    geo_lat: -15.7939,
    geo_long: -47.8828
  }
];

const FIXED_GENERATED_AT = Date.UTC(2026, 3, 20, 9, 0, 0);
const DEFAULT_HOME_SEED = 424242;

type SeedStation = (typeof stations)[number];
type SeedRadioStateOptions = {
  activeSection?: 'home' | 'feed' | 'search' | 'globe' | 'library';
  libraryTab?: string;
  homeSessionSeed?: number;
  behaviorProfile?: BehaviorProfile;
  playabilityProfile?: StationPlayabilityProfile;
  tasteProfile?: TasteProfileV2;
  stationHealthProfile?: StationHealthProfile;
  radioSessionEvents?: RadioSessionEvent[];
  // Shown-but-unplayed impressions (lib/stationExposure). The «Новое для тебя»
  // feed chip is gated on this being non-empty — its predicate is "not shown to
  // you recently", so with an empty ledger it excludes nothing and would rebuild
  // the identical deck.
  stationExposure?: Record<string, { lastShownAt: number; shownCount: number }>;
  favorites?: SeedStation[];
  recent?: SeedStation[];
  playbackHistory?: SeedStation[];
  queue?: SeedStation[];
  stationCache?: SeedStation[];
  collections?: Array<{
    id: string;
    name: string;
    stationIds: string[];
    isPublic?: boolean;
    updatedAt?: number;
    createdAt?: number;
    pinned?: boolean;
  }>;
  followedStations?: Array<{
    stationId: string;
    stationName: string;
    country: string;
    createdAt?: number;
    pinned?: boolean;
    alerts?: Array<'back-online' | 'track' | 'live-show'>;
  }>;
  followedRegions?: Array<{
    id: string;
    label: string;
    scope: 'country' | 'area';
    createdAt?: number;
    pinned?: boolean;
  }>;
  trackHistory?: Array<{
    id: string;
    stationId: string;
    stationName: string;
    track: string;
    timestamp: number;
  }>;
  alerts?: Array<{
    id: string;
    kind: 'station-back-online' | 'track-available' | 'live-show' | 'region-activity';
    stationId: string | null;
    regionId: string | null;
    title: string;
    body: string;
    createdAt: number;
    readAt: number | null;
  }>;
};

type MockStationsOptions = {
  authProviders?: {
    telegram?: boolean;
    google?: boolean;
    vk?: boolean;
  };
  summaryHandler?: Parameters<Page['route']>[1];
};

const buildStationCache = (items: SeedStation[]) =>
  Object.fromEntries(items.map((station) => [station.stationuuid, station]));

const createSilentWav = (durationMs = 30_000) => {
  const sampleRate = 8000;
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const frameCount = Math.max(1, Math.round((sampleRate * durationMs) / 1000));
  const dataSize = frameCount * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
};

export const mockStreamAudio = createSilentWav();

export const seedRadioState = async (
  page: Page,
  {
    activeSection = 'home',
    libraryTab = 'favorites',
    homeSessionSeed = DEFAULT_HOME_SEED,
    behaviorProfile,
    playabilityProfile = DEFAULT_PLAYABILITY_PROFILE,
    tasteProfile = DEFAULT_TASTE_PROFILE_V2,
    stationHealthProfile = DEFAULT_STATION_HEALTH_PROFILE,
    radioSessionEvents = [],
    stationExposure = {},
    favorites = [],
    recent = [],
    playbackHistory = [],
    queue = [],
    stationCache = [],
    collections = [],
    followedStations = [],
    followedRegions = [],
    trackHistory = [],
    alerts = []
  }: SeedRadioStateOptions = {}
) => {
  const cachedStations = buildStationCache([
    ...stationCache,
    ...favorites,
    ...recent,
    ...playbackHistory,
    ...queue
  ]);

  await page.addInitScript(
    ({ appState, libraryState, playerState }) => {
      window.localStorage.setItem('radio:api-url', '/api');
      window.localStorage.setItem('radio:app:v2', JSON.stringify(appState));
      window.localStorage.setItem('radio:library:v2', JSON.stringify(libraryState));
      window.localStorage.setItem('radio:player:v2', JSON.stringify(playerState));
    },
    {
      appState: {
        version: 2,
        shell: {
          version: 3,
          activeSection,
          playerPresentation: 'peek',
          libraryTab,
          detailsOpen: false,
          home: {
            sessionSeed: homeSessionSeed,
            lastBuiltAt: null,
            snapshot: null
          },
          searchDraft: ''
        },
        behaviorProfile: behaviorProfile || {
          version: 1,
          lastUpdatedAt: null,
          actionCounts: {
            plays: 0,
            likes: 0,
            copies: 0,
            follows: 0,
            collections: 0
          },
          sectionVisits: {},
          tagScores: {},
          countryScores: {},
          stateScores: {},
          stationScores: {}
        },
        playabilityProfile,
        tasteProfile,
        stationHealthProfile,
        radioSessionEvents,
        stationExposure
      },
      libraryState: {
        version: 2,
        favorites,
        recent,
        collections: collections.map((collection) => ({
          isPublic: false,
          updatedAt: FIXED_GENERATED_AT,
          createdAt: FIXED_GENERATED_AT,
          pinned: false,
          ...collection
        })),
        followedStations: followedStations.map((station) => ({
          createdAt: FIXED_GENERATED_AT,
          pinned: false,
          alerts: [],
          ...station
        })),
        followedRegions: followedRegions.map((region) => ({
          createdAt: FIXED_GENERATED_AT,
          pinned: false,
          ...region
        })),
        alerts,
        digests: [],
        notificationPreference: DEFAULT_NOTIFICATION_PREFERENCE,
        trackHistory,
        playbackHistory,
        stationCache: cachedStations
      },
      playerState: {
        version: 2,
        queue: {
          items: queue,
          currentIndex: queue.length ? 0 : -1,
          sourceId: queue.length ? 'seeded-home' : null,
          sourceLabel: queue.length ? 'Seeded Home' : null
        },
        skin: {
          source: 'preset',
          id: 'base-2.91'
        },
        layout: {
          version: 3,
          windowPositions: {},
          windowVisibility: {
            'equalizer-window': true,
            'playlist-window': true
          }
        }
      }
    }
  );
};

// T1.2: spyable Telegram WebApp shim for the inside-client e2e flow.
// installMediaMocks below already intercepts the SDK URL with an empty
// body so the real CDN script can't override what we inject here.
// installTelegramShim sets window.Telegram BEFORE the page loads via
// addInitScript and exposes a global collector that tests read with
// page.evaluate() to verify which SDK methods fired (and with what
// arguments). initData is a non-empty fixture string so
// isInsideTelegramClient() reads true everywhere it gates strict
// surfaces (closing confirmation, HapticFeedback, disableVerticalSwipes).
export const installTelegramShim = async (
  page: Page,
  options: {
    platform?: string;
    version?: string;
    initData?: string;
    // T1.3: optional themeParams payload. Default is empty `{}` so
    // existing T1.2 tests keep their behaviour (no synthetic
    // telegram-auto theme activation). Tests that want Telegram
    // colours applied pass `{ bg_color: '#xxx', ... }`.
    themeParams?: Record<string, string>;
  } = {}
) => {
  const platform = options.platform ?? 'ios';
  const version = options.version ?? '8.0';
  const initData = options.initData ?? 'auth_date=1746000000&hash=t12-fixture';
  const themeParams = options.themeParams ?? {};

  await page.addInitScript(
    ({
      resolvedPlatform,
      resolvedVersion,
      resolvedInitData,
      resolvedThemeParams
    }) => {
      type SpyState = {
        disableVerticalSwipes: number;
        enableClosingConfirmation: number;
        disableClosingConfirmation: number;
        impactOccurred: string[];
      };
      const state: SpyState = {
        disableVerticalSwipes: 0,
        enableClosingConfirmation: 0,
        disableClosingConfirmation: 0,
        impactOccurred: []
      };
      Object.defineProperty(window, '__radioatlasTelegramSpyState__', {
        configurable: true,
        value: state
      });

      // T1.3: themeParams + themeChanged event surface. Telegram
      // mutates `themeParams` in place between events; the shim
      // mirrors that contract — the property keeps the same object
      // reference, but its keys are overwritten when a test calls
      // window.__radioatlasTriggerThemeChange__(next). Listeners
      // are dispatched synchronously after the mutation so a
      // page.evaluate() awaits the resulting state transition.
      const themeParamsRef: Record<string, string> = { ...resolvedThemeParams };
      const themeListeners = new Set<() => void>();

      Object.defineProperty(window, 'Telegram', {
        configurable: true,
        value: {
          WebApp: {
            platform: resolvedPlatform,
            version: resolvedVersion,
            initData: resolvedInitData,
            initDataUnsafe: {
              auth_date: 1746000000,
              hash: 't12-fixture',
              user: { id: 1, first_name: 'Fixture' }
            },
            themeParams: themeParamsRef,
            onEvent: (event: string, callback: () => void) => {
              if (event === 'themeChanged') themeListeners.add(callback);
            },
            offEvent: (event: string, callback: () => void) => {
              if (event === 'themeChanged') themeListeners.delete(callback);
            },
            ready: () => {},
            expand: () => {},
            disableVerticalSwipes: () => {
              state.disableVerticalSwipes += 1;
            },
            enableClosingConfirmation: () => {
              state.enableClosingConfirmation += 1;
            },
            disableClosingConfirmation: () => {
              state.disableClosingConfirmation += 1;
            },
            HapticFeedback: {
              impactOccurred: (style: string) => {
                state.impactOccurred.push(style);
              }
            }
          }
        }
      });

      // T1.3 test hook. Mutates themeParams in place (matching
      // Telegram's real behaviour) then synchronously dispatches
      // listeners. Tests use page.evaluate() to invoke this for
      // the themeChanged re-apply case (e2e (d)).
      Object.defineProperty(window, '__radioatlasTriggerThemeChange__', {
        configurable: true,
        value: (next: Record<string, string>) => {
          Object.keys(themeParamsRef).forEach((key) => {
            delete themeParamsRef[key];
          });
          Object.assign(themeParamsRef, next);
          themeListeners.forEach((cb) => cb());
        }
      });
    },
    {
      resolvedPlatform: platform,
      resolvedVersion: version,
      resolvedInitData: initData,
      resolvedThemeParams: themeParams
    }
  );
};

export type TelegramSpyState = {
  disableVerticalSwipes: number;
  enableClosingConfirmation: number;
  disableClosingConfirmation: number;
  impactOccurred: string[];
};

export const readTelegramSpyState = (page: Page): Promise<TelegramSpyState> =>
  page.evaluate(() => {
    const value = (
      window as Window & { __radioatlasTelegramSpyState__?: TelegramSpyState }
    ).__radioatlasTelegramSpyState__;
    return (
      value ?? {
        disableVerticalSwipes: 0,
        enableClosingConfirmation: 0,
        disableClosingConfirmation: 0,
        impactOccurred: []
      }
    );
  });

export const installMediaMocks = async (page: Page) => {
  // Live listener presence: the e2e run beats against the REAL dev API, and the
  // store is process-global, so counts accumulate across tests and leak into
  // visual baselines («Ещё 1 слушатель» appearing under the station name).
  // Pin it to "nobody else is here", which is also the honest default: these
  // fixtures have exactly one listener, and at 1 the UI renders nothing.
  await page.route('**/listening/beat', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ listeners: 1 }) })
  );
  await page.route('**/listening/bye', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/listening/live', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ stations: [], minListeners: 3 }) })
  );
  // T1.1 added a synchronous <script src="https://telegram.org/js/
  // telegram-web-app.js"> at the top of index.html so the SDK is
  // available before React boots in production. In e2e we DON'T want
  // the real CDN script to run: it would override the deliberate
  // window.Telegram fixtures (undefined for non-Telegram tests, an
  // explicit shim for mobile.spec.ts) and also block page load on
  // network conditions that aren't part of what we're testing.
  // Returning a 200 with an empty body keeps the script tag inert -
  // window.Telegram stays exactly what the fixture set.
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: ''
    })
  );

  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function () {
      this.setAttribute('data-ra-state', 'playing');
      this.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      this.setAttribute('data-ra-state', 'paused');
      this.dispatchEvent(new Event('pause'));
    };
    HTMLMediaElement.prototype.load = function () {};
    window.ResizeObserver =
      window.ResizeObserver ||
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {},
        readText: async () => ''
      }
    });
  });
};

export const mockStations = async (
  page: Page,
  {
    authProviders = {
      telegram: false,
      google: false,
      vk: false
    },
    summaryHandler
  }: MockStationsOptions = {}
) => {
  const body = JSON.stringify(stations);
  const summaryBody = JSON.stringify({
    generatedAt: FIXED_GENERATED_AT,
    counts: {
      stations: stations.length,
      countries: 3,
      languages: 3,
      genres: 8
    },
    catalogPool: stations.slice(0, 8),
    freshSignals: stations.slice(0, 6),
    searchLaunch: stations.slice(0, 6),
    sponsored: stations.slice(0, 2),
    countrySpotlight: {
      label: 'Japan',
      stations: stations.slice(0, 4)
    },
    genreSpotlight: {
      label: 'jpop',
      stations: stations.slice(0, 4)
    }
  });
  const searchBody = JSON.stringify({
    items: stations,
    total: stations.length,
    nextCursor: null,
    facets: {
      countries: ['All', 'Japan', 'Germany', 'Brazil'],
      tags: ['All', 'jpop', 'techno', 'samba'],
      languages: ['All', 'Japanese', 'German', 'Portuguese'],
      continentCounts: [
        { id: 'Asia', count: 4 },
        { id: 'Europe', count: 4 },
        { id: 'South America', count: 4 }
      ],
      featuredCountries: [
        { key: 'jp', country: 'Japan', continent: 'Asia', count: 4 },
        { key: 'de', country: 'Germany', continent: 'Europe', count: 4 }
      ]
    }
  });
  const areaItems = [
    {
      id: 'asia-japan',
      lat: 35.68,
      lon: 139.69,
      label: 'Japan',
      subtitle: 'Asia',
      count: 4
    },
    {
      id: 'europe-germany',
      lat: 52.52,
      lon: 13.405,
      label: 'Germany',
      subtitle: 'Europe',
      count: 4
    },
    {
      id: 'europe-iceland',
      lat: 64.1466,
      lon: -21.9426,
      label: 'Iceland',
      subtitle: 'Europe',
      count: 2
    }
  ];
  const areaStationsById: Record<string, typeof stations> = {
    'asia-japan': stations.slice(0, 4),
    'europe-germany': stations.slice(4, 8),
    'europe-iceland': stations.slice(4, 6)
  };
  const areasBody = JSON.stringify({
    items: areaItems,
    mappedStations: stations.length,
    totalStations: stations.length
  });
  const areaStationsBody = (areaId: string) => {
    const area = areaItems.find((item) => item.id === areaId) || areaItems[0];
    return JSON.stringify({
      area,
      items: areaStationsById[area.id] || stations.slice(0, 4),
      nextCursor: null
    });
  };

  await page.route('**/catalog-fast.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body })
  );
  // Home performs one read-only lookup for its decorative hero atmosphere.
  // Keep visual tests deterministic and prove that no browser-side generation
  // endpoint is required for a complete surface.
  await page.route('**/artwork/scene/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'unavailable' })
    })
  );
  await page.route('**/catalog-full.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body })
  );
  await page.route('**/json/stations/search**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body })
  );
  await page.route(
    '**/catalog/summary**',
    summaryHandler ||
      ((route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: summaryBody }))
  );
  await page.route('**/catalog/search**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: searchBody })
  );
  await page.route('**/catalog/areas?**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: areasBody })
  );
  await page.route('**/catalog/areas/**/stations?**', (route) => {
    const match = route
      .request()
      .url()
      .match(/\/catalog\/areas\/([^/]+)\/stations/);
    const areaId = match ? decodeURIComponent(match[1]) : 'asia-japan';
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: areaStationsBody(areaId)
    });
  });
  await page.route('**/catalog/stations/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ item: stations[0] })
    })
  );
  await page.route('**/stations/**/profile', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        profile: {
          stationUuid: stations[0].stationuuid,
          ownerAccountId: null,
          isVerified: true,
          description: 'Mock station profile',
          scheduleNote: null
        }
      })
    })
  );
  await page.route('https://stream.example.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'audio/wav', body: mockStreamAudio })
  );
  await page.route('**/stream?url=**', (route) =>
    route.fulfill({ status: 200, contentType: 'audio/wav', body: mockStreamAudio })
  );
  await page.route('**/metadata?url=**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ title: 'Mock Song', logs: ['test'], source: 'test' })
    })
  );
  await page.route('**/status-json.xsl', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        icestats: {
          source: {
            listenurl: 'https://stream.example.com/tokyo',
            title: 'Mock Song'
          }
        }
      })
    })
  );
  await page.route('**/fetch?url=**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/plain', body: 'title=Mock Song' })
  );
  await page.route('**/extract?url=**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        type: 'stream',
        title: 'Extracted Demo',
        audioStreams: [
          {
            url: 'https://stream.example.com/extracted',
            bitrate: 128,
            averageBitrate: 128,
            format: 'MP3',
            mimeType: 'audio/mpeg',
            delivery: 'progressive'
          }
        ]
      })
    })
  );
  await page.route('**/observability/client-event', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  );
  await page.route('**/auth/providers', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        telegram: { configured: Boolean(authProviders.telegram), label: 'Telegram' },
        google: { configured: Boolean(authProviders.google), label: 'Google' },
        vk: { configured: Boolean(authProviders.vk), label: 'VK' }
      })
    })
  );
  await page.route('**/auth/telegram', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'telegram auth unavailable in tests' })
    })
  );
  await page.route('**/billing/telegram/products', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ products: [] }) })
  );
};

export const playHomeStation = async (page: Page, name: string) => {
  await page.locator('[data-home-feed-entry], [data-home-rail]').first().waitFor({ state: 'visible' });
  // T2.20 removed the Home search-launcher's inline preview list (the launcher
  // is now a compact form that navigates to the Search screen on submit). Play
  // straight from a Home rail tile if the station is on the surface, otherwise
  // fall through to the Search screen below.
  const homeRow = page.locator('[data-home-station]').filter({ hasText: name }).first();
  if (await homeRow.isVisible().catch(() => false)) {
    await homeRow.locator('.home-station-primary-action').click();
    return;
  }

  // Open Search via whichever navigation the current layout renders — the
  // mobile bottom bar or the desktop rail (T2.20 removed the Home preview path
  // that desktop used to rely on here).
  const mobileSearchNav = page
    .locator('.app-navigation-mobile')
    .getByRole('button', { name: /Поиск|Search/ });
  if (await mobileSearchNav.isVisible().catch(() => false)) {
    await mobileSearchNav.click();
  } else {
    await page.locator('.nav-rail-item').filter({ hasText: /Поиск|Search/ }).first().click();
  }
  // Search v3 (commit 8d06cbf) renamed the wrapper from
  // .search-command-card to .search-hero-card and gave the input the
  // stable `#search-hero-input` id. Match desktop.spec.ts's selector.
  const discoverInput = page.locator('#search-hero-input').first();
  await discoverInput.waitFor({ state: 'visible' });
  await discoverInput.fill(name);
  const row = page.locator('.station-row').filter({ hasText: name }).first();
  await row.waitFor({ state: 'visible' });
  await row.locator('.play-btn').first().click();
};

/**
 * Wait until nothing on the page is still animating, then measure.
 *
 * `boundingBox()` reports the TRANSFORMED box, so geometry read while a mount
 * animation is mid-flight is the animation's geometry, not the product's. The
 * Feed lands on `.station-feed-overlay { animation: station-feed-expand 240ms }`,
 * which starts at `scale(0.965)` — and 44px * 0.965 = 42.46px, under the 43.5px
 * floor the touch-target test asserts. That is the whole flake: the test's only
 * wait was for a card name to become visible, which happens at the START of
 * those 240ms.
 *
 * It only showed under parallel load (a serial full-suite run passes 240/240),
 * because contention decides whether the measuring round-trip lands inside the
 * window. Reproduce with:
 *   npx playwright test tests/feed-filters.spec.ts --grep "44px" --repeat-each=12 --workers=6
 *
 * This waits for the real thing rather than disabling motion, so the assertion
 * still describes what a user with default settings gets.
 */
export const waitForAnimationsToSettle = async (page: Page, selector = 'body') => {
  await page.waitForFunction(
    (root) => {
      const scope = document.querySelector(root);
      if (!scope) return false;
      const running = scope.getAnimations({ subtree: true }).filter((animation) => {
        if (animation.playState !== 'running') return false;
        // An INFINITE animation never leaves 'running' — the Feed has a pulsing
        // live dot — so waiting on it hangs forever. Only finite animations can
        // settle, and only those move geometry to a final resting place.
        const timing = animation.effect?.getComputedTiming?.();
        return timing ? timing.iterations !== Infinity : true;
      });
      return running.length === 0;
    },
    selector,
    { timeout: 5000 }
  );
};

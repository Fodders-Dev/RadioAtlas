import type { Page } from '@playwright/test';
import type { BehaviorProfile } from '../src/lib/homeProfile';
import {
  DEFAULT_PLAYABILITY_PROFILE,
  type StationPlayabilityProfile
} from '../src/lib/stationPlayability';

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
  activeSection?: 'home' | 'search' | 'globe' | 'library';
  libraryTab?: string;
  homeSessionSeed?: number;
  behaviorProfile?: BehaviorProfile;
  playabilityProfile?: StationPlayabilityProfile;
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
    favorites = [],
    recent = [],
    playbackHistory = [],
    queue = [],
    stationCache = [],
    collections = [],
    followedStations = [],
    followedRegions = [],
    trackHistory = []
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
        playabilityProfile
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
        alerts: [],
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

export const installMediaMocks = async (page: Page) => {
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
    // @ts-expect-error test shim
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
  await page.route('**/billing/telegram/products', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ products: [] }) })
  );
};

export const playHomeStation = async (page: Page, name: string) => {
  await page.locator('[data-home-personal-radio], [data-home-rail]').first().waitFor({ state: 'visible' });
  const searchInput = page.locator('#home-search-launcher').first();
  if (await searchInput.isVisible().catch(() => false)) {
    await searchInput.fill(name);
    await page.waitForTimeout(450);
    const row = page.locator('[data-home-search-preview] [data-home-station]').filter({ hasText: name }).first();
    await row.waitFor({ state: 'visible' });
    await row.locator('.home-action-btn-play').click();
    return;
  }

  const homeRow = page.locator('[data-home-station]').filter({ hasText: name }).first();
  if (await homeRow.isVisible().catch(() => false)) {
    await homeRow.locator('.home-action-btn-play').click();
    return;
  }

  await page.locator('.app-navigation-mobile').getByRole('button', { name: /Поиск|Search/ }).click();
  const discoverInput = page.locator('.search-command-card .search-bar input').first();
  await discoverInput.waitFor({ state: 'visible' });
  await discoverInput.fill(name);
  const row = page.locator('.station-row').filter({ hasText: name }).first();
  await row.waitFor({ state: 'visible' });
  await row.locator('button[aria-label="Воспроизвести"], button[aria-label="Play"], .station-compact-play').first().click();
};

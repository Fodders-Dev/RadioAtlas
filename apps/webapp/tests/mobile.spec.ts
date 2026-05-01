import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import {
  installMediaMocks,
  mockStations,
  playHomeStation,
  seedRadioState,
  stations
} from './helpers';
import {
  DENSE_SEARCH_PREVIEW_LIMIT,
  filterPreviewStations
} from '../src/screens/homePreview';
import { findNearestAreaToRotation } from '../src/components/globe/selection';
import {
  DEFAULT_PLAYABILITY_PROFILE,
  getStationPlayabilityScore,
  rankStationsForSearch,
  recordPlaybackOutcome
} from '../src/lib/stationPlayability';
import { buildPersonalRadioQueue } from '../src/lib/personalRadio';
import type { BehaviorProfile } from '../src/lib/homeProfile';
import {
  DEFAULT_TASTE_PROFILE_V2,
  hideStationFromTasteProfile,
  isStationHiddenFromRecommendations,
  mergeTasteProfiles,
  rankStationsForUser,
  recordTasteSignal
} from '../src/lib/tasteProfile';
import {
  DEFAULT_STATION_HEALTH_PROFILE,
  getStationHealthScore,
  isStationSuppressedByHealth,
  recordStationHealthSignal,
  resolveBestPlayableCandidate
} from '../src/lib/stationHealth';
import {
  normalizeTrustedTrackTitle,
  resolveNowPlayingTrust,
  upsertTrustedTrackHistory
} from '../src/lib/trackTrust';
import { createGeneratedArtworkPalette } from '../src/lib/artwork';
import { stationsForRegions } from '../src/lib/regionRecommendations';
import {
  DEFAULT_NOTIFICATION_PREFERENCE,
  buildListenerAlerts,
  buildRadioDigests
} from '../src/lib/retention';
import {
  PRODUCT_SURFACE_GUARDS,
  shouldExposeProductSurface
} from '../src/lib/productSurfaceGuards';

const UPLOAD_SKIN_PATH = fileURLToPath(new URL('../public/winamp-skins/base-2.91.wsz', import.meta.url));
const behaviorProfile = (overrides: Partial<BehaviorProfile> = {}): BehaviorProfile => ({
  version: 1,
  lastUpdatedAt: Date.UTC(2026, 3, 20, 9, 30, 0),
  actionCounts: {
    plays: 4,
    likes: 1,
    copies: 0,
    follows: 0,
    collections: 0
  },
  sectionVisits: {},
  tagScores: {},
  countryScores: {},
  stateScores: {},
  stationScores: {},
  ...overrides
});

test.beforeEach(async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page);
  await seedRadioState(page);
  await page.setViewportSize({ width: 390, height: 844 });
});

const enableTelegramMobileSafeMode = async (page: Page) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      configurable: true,
      value: 2
    });
    Object.defineProperty(navigator, 'deviceMemory', {
      configurable: true,
      value: 2
    });
    Object.defineProperty(navigator, 'maxTouchPoints', {
      configurable: true,
      value: 5
    });
    Object.defineProperty(window, 'Telegram', {
      configurable: true,
      value: {
        WebApp: {
          platform: 'ios',
          version: '8.0',
          initData: 'test-init-data',
          initDataUnsafe: {
            user: {
              id: 1
            }
          },
          ready() {},
          expand() {}
        }
      }
    });
  });
};

const expectNoHomeHorizontalOverflow = async (page: Page) => {
  const overflowing = await page.locator('.screen-home-next *').evaluateAll((nodes) =>
    nodes
      .filter((node) => {
        if (node.closest('.home-horizontal-scroll')) return false;
        const rect = node.getBoundingClientRect();
        return rect.left < -1 || rect.right > document.documentElement.clientWidth + 1;
      })
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          tag: node.tagName,
          className: String(node.getAttribute('class') || ''),
          left: rect.left,
          right: rect.right
        };
      })
  );
  expect(overflowing).toEqual([]);
};

const expectNoGlobeHorizontalOverflow = async (page: Page) => {
  const overflowing = await page.locator('.screen-globe-v2 *').evaluateAll((nodes) =>
    nodes
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.left < -1 || rect.right > document.documentElement.clientWidth + 1;
      })
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          tag: node.tagName,
          className: String(node.getAttribute('class') || ''),
          left: rect.left,
          right: rect.right
        };
      })
  );
  expect(overflowing).toEqual([]);
};

const expectNoDocumentHorizontalOverflow = async (page: Page) => {
  await expect
    .poll(
      async () =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        ),
      { timeout: 5000 }
    )
    .toBeLessThanOrEqual(0);
};

const summaryBody = (generatedAt = Date.UTC(2026, 3, 20, 9, 0, 0)) =>
  JSON.stringify({
    generatedAt,
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

const mockSkinMuseumSearch = async (page: Page) => {
  await page.route('**/__skin-preview.svg', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240"><rect width="320" height="240" fill="#261447"/><rect x="24" y="26" width="272" height="48" rx="10" fill="#8f6cff"/><rect x="24" y="92" width="156" height="42" rx="8" fill="#111827"/><rect x="24" y="154" width="272" height="58" rx="8" fill="#0f172a"/></svg>'
    });
  });

  const purpleSkin = {
    md5: 'purple-dream-md5',
    filename: 'Purple_Dream.wsz',
    download_url: 'http://127.0.0.1:5173/winamp-skins/base-2.91.wsz',
    screenshot_url: 'http://127.0.0.1:5173/__skin-preview.svg',
    museum_url: 'https://skins.webamp.org/skin/purple-dream-md5/Purple_Dream.wsz',
    nsfw: false
  };

  await page.route('https://skins.webamp.org/graphql', async (route) => {
    const body = route.request().postDataJSON() as { query?: string } | null;
    const responseBody = body?.query?.includes('fetch_skin_by_md5')
      ? { data: { fetch_skin_by_md5: purpleSkin } }
      : { data: { search_classic_skins: [purpleSkin] } };

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(responseBody)
    });
  });
};

test('home local preview filter caps dense results', () => {
  const matches = filterPreviewStations(stations, 'jpop', DENSE_SEARCH_PREVIEW_LIMIT);

  expect(matches.length).toBeLessThanOrEqual(DENSE_SEARCH_PREVIEW_LIMIT);
  expect(matches.map((station) => station.name)).toEqual(['Tokyo FM', 'Osaka Nights']);
});

test('globe nearest helper selects the reticle area', () => {
  const nearest = findNearestAreaToRotation(
    [
      { id: 'asia-japan', lat: 35.68, lon: 139.69 },
      { id: 'europe-iceland', lat: 64.1466, lon: -21.9426 },
      { id: 'south-america-brazil', lat: -22.9068, lon: -43.1729 }
    ],
    [21.9426, -64.1466, 0]
  );

  expect(nearest?.id).toBe('europe-iceland');
});

test('playability score demotes stream failures but ignores missing metadata', () => {
  const failed = recordPlaybackOutcome(
    recordPlaybackOutcome(DEFAULT_PLAYABILITY_PROFILE, stations[0], 'no-playable-candidate', 1000),
    stations[0],
    'mixed-content',
    2000
  );
  const withMetadataMiss = recordPlaybackOutcome(failed, stations[1], 'metadata-unavailable', 3000);
  const recovered = recordPlaybackOutcome(withMetadataMiss, stations[1], 'success', 4000);

  expect(getStationPlayabilityScore(failed, stations[0], 5000)).toBeLessThan(0);
  expect(getStationPlayabilityScore(withMetadataMiss, stations[1], 5000)).toBe(0);
  expect(getStationPlayabilityScore(recovered, stations[1], 5000)).toBeGreaterThan(0);
});

test('search ranking keeps exact playable matches above weak promoted matches', () => {
  const failedProfile = recordPlaybackOutcome(
    DEFAULT_PLAYABILITY_PROFILE,
    stations[0],
    'no-playable-candidate',
    1000
  );
  const searchStations = [
    { ...stations[4], name: 'Tokyo Promo Beats', promoted: true },
    stations[0],
    stations[1]
  ];
  const ranked = rankStationsForSearch(searchStations, {
    query: 'Tokyo FM',
    behaviorProfile: behaviorProfile({
      tagScores: { techno: 80 },
      countryScores: { Germany: 50 }
    }),
    playabilityProfile: failedProfile,
    now: 5000
  });

  expect(ranked[0].stationuuid).toBe('uuid-tokyo');
});

test('personal radio queue favors taste and skips hard failed stations', () => {
  const now = Date.now();
  const playabilityProfile = recordPlaybackOutcome(
    recordPlaybackOutcome(DEFAULT_PLAYABILITY_PROFILE, stations[4], 'no-playable-candidate', now - 1000),
    stations[4],
    'stream-unavailable',
    now
  );
  const queue = buildPersonalRadioQueue({
    catalog: stations,
    favorites: [],
    recent: [],
    queuePreview: [],
    playbackHistory: [],
    trackHistory: [],
    collections: [],
    followedStations: [],
    behaviorProfile: behaviorProfile({
      tagScores: { techno: 90 },
      countryScores: { Germany: 40 },
      stationScores: { 'uuid-berlin': 160, 'uuid-hamburg': 80 }
    }),
    playabilityProfile,
    context: {
      mode: 'personal',
      currentStation: null,
      seed: 424242,
      limit: 10,
      now
    }
  });

  expect(queue.stations.length).toBeGreaterThanOrEqual(6);
  expect(queue.stations.length).toBeLessThanOrEqual(10);
  expect(queue.stations[0].stationuuid).not.toBe('uuid-berlin');
  expect(queue.stations.map((station) => station.stationuuid)).toContain('uuid-hamburg');
});

test('taste profile v2 promotes liked stations and demotes early skips', () => {
  const now = Date.UTC(2026, 3, 20, 10, 0, 0);
  const likedProfile = recordTasteSignal(
    DEFAULT_TASTE_PROFILE_V2,
    stations[4],
    'liked',
    { mode: 'personal', now: now - 2000 }
  );
  const profile = recordTasteSignal(likedProfile, stations[5], 'skip-before-10s', {
    mode: 'personal',
    now
  });
  const ranked = rankStationsForUser(
    [stations[5], stations[6], stations[4], stations[0]],
    profile,
    DEFAULT_PLAYABILITY_PROFILE,
    {
      mode: 'personal',
      seed: 7,
      now
    }
  );

  expect(ranked[0].stationuuid).toBe('uuid-berlin');
  expect(ranked.findIndex((station) => station.stationuuid === 'uuid-hamburg')).toBeGreaterThan(
    ranked.findIndex((station) => station.stationuuid === 'uuid-munich')
  );
});

test('hidden stations stay out of recommendations and personal radio queues', () => {
  const now = Date.UTC(2026, 3, 20, 10, 5, 0);
  const profile = hideStationFromTasteProfile(DEFAULT_TASTE_PROFILE_V2, stations[4], now);
  const ranked = rankStationsForUser(
    [stations[4], stations[5], stations[6]],
    profile,
    DEFAULT_PLAYABILITY_PROFILE,
    {
      mode: 'personal',
      seed: 11,
      now
    }
  );
  const queue = buildPersonalRadioQueue({
    catalog: stations,
    favorites: [stations[4]],
    recent: [],
    queuePreview: [],
    playbackHistory: [],
    trackHistory: [],
    collections: [],
    followedStations: [],
    behaviorProfile: behaviorProfile({
      stationScores: { 'uuid-berlin': 200, 'uuid-hamburg': 80 }
    }),
    playabilityProfile: DEFAULT_PLAYABILITY_PROFILE,
    tasteProfile: profile,
    healthProfile: DEFAULT_STATION_HEALTH_PROFILE,
    context: {
      mode: 'personal',
      currentStation: null,
      seed: 11,
      limit: 8,
      now
    }
  });

  expect(isStationHiddenFromRecommendations(profile, stations[4])).toBe(true);
  expect(ranked.map((station) => station.stationuuid)).not.toContain('uuid-berlin');
  expect(queue.stations.map((station) => station.stationuuid)).not.toContain('uuid-berlin');
});

test('followed regions feed Home and personal radio station pools', () => {
  const regionStations = stationsForRegions(stations, [
    {
      id: 'asia-japan',
      label: 'Japan',
      scope: 'country',
      createdAt: 1,
      pinned: false
    }
  ]);

  expect(regionStations.map((station) => station.stationuuid)).toContain('uuid-tokyo');
  expect(regionStations.every((station) => station.country === 'Japan')).toBe(true);

  const queue = buildPersonalRadioQueue({
    catalog: stations,
    favorites: [],
    recent: [],
    queuePreview: [],
    playbackHistory: [],
    trackHistory: [],
    collections: [],
    followedStations: [],
    followedRegions: [
      {
        id: 'europe-germany',
        label: 'Germany',
        scope: 'country',
        createdAt: 1,
        pinned: false
      }
    ],
    behaviorProfile: behaviorProfile(),
    playabilityProfile: DEFAULT_PLAYABILITY_PROFILE,
    tasteProfile: DEFAULT_TASTE_PROFILE_V2,
    healthProfile: DEFAULT_STATION_HEALTH_PROFILE,
    context: {
      mode: 'personal',
      currentStation: null,
      seed: 42,
      limit: 6,
      now: Date.now()
    }
  });

  expect(queue.stations.some((station) => station.country === 'Germany')).toBe(true);
});

test('retention builds opt-in local alerts and digests without bot opt-in', () => {
  const copy = {
    trackAvailable: (stationName: string, track: string) => ({
      title: `${stationName} track`,
      body: track
    }),
    stationBackOnline: (stationName: string) => ({
      title: `${stationName} online`,
      body: 'back'
    }),
    regionActivity: (regionName: string, stationName: string) => ({
      title: regionName,
      body: stationName
    }),
    digest: (kind: 'continue-yesterday' | 'morning-mix' | 'evening-mix', stationNames: string[]) => ({
      title: kind,
      body: stationNames.join(', ')
    })
  };
  const preference = {
    ...DEFAULT_NOTIFICATION_PREFERENCE,
    telegramBotOptIn: false
  };
  const alerts = buildListenerAlerts({
    currentStation: stations[0],
    trustedTrack: 'Artist - Song',
    followedStations: [
      {
        stationId: stations[0].stationuuid,
        stationName: stations[0].name,
        country: stations[0].country,
        createdAt: 1,
        pinned: false,
        alerts: ['track']
      }
    ],
    followedRegions: [
      {
        id: 'asia-japan',
        label: 'Japan',
        scope: 'country',
        createdAt: 1,
        pinned: false
      }
    ],
    knownStations: stations,
    stationHealthProfile: DEFAULT_STATION_HEALTH_PROFILE,
    existingAlerts: [],
    notificationPreference: preference,
    copy,
    now: Date.UTC(2026, 3, 21, 8, 0, 0)
  });
  const digests = buildRadioDigests({
    recent: stations.slice(0, 2),
    playbackHistory: [],
    favorites: [],
    followedRegions: [],
    existingDigests: [],
    notificationPreference: preference,
    copy,
    now: Date.UTC(2026, 3, 21, 8, 0, 0)
  });

  expect(preference.telegramBotOptIn).toBe(false);
  expect(alerts.some((alert) => alert.kind === 'track-available')).toBe(true);
  expect(alerts.some((alert) => alert.kind === 'region-activity')).toBe(true);
  expect(digests.map((digest) => digest.kind)).toContain('continue-yesterday');
  expect(digests.map((digest) => digest.kind)).toContain('morning-mix');
});

test('generated artwork is stable per station and varies by seed', () => {
  const first = createGeneratedArtworkPalette(stations[0].stationuuid);
  const second = createGeneratedArtworkPalette(stations[0].stationuuid);
  const other = createGeneratedArtworkPalette(stations[1].stationuuid);

  expect(first).toEqual(second);
  expect(first).not.toEqual(other);
});

test('taste profile cloud merge keeps local and remote signals combine-first', () => {
  const now = Date.UTC(2026, 3, 20, 10, 0, 0);
  const remote = recordTasteSignal(DEFAULT_TASTE_PROFILE_V2, stations[0], 'liked', {
    mode: 'personal',
    now: now - 2000
  });
  const local = recordTasteSignal(DEFAULT_TASTE_PROFILE_V2, stations[4], 'skip-before-10s', {
    mode: 'search',
    now
  });
  const hiddenLocal = hideStationFromTasteProfile(local, stations[5], now + 1000);
  const merged = mergeTasteProfiles(remote, hiddenLocal);

  expect(merged.signals.map((signal) => signal.stationId)).toEqual(
    expect.arrayContaining(['uuid-tokyo', 'uuid-berlin'])
  );
  expect(merged.stationScores['uuid-tokyo']).toBeGreaterThan(0);
  expect(merged.stationScores['uuid-berlin']).toBeLessThan(0);
  expect(merged.hiddenStationIds).toContain('uuid-hamburg');
});

test('station health suppresses repeated failures but accepts metadata misses and proxy success', () => {
  const now = Date.UTC(2026, 3, 20, 10, 0, 0);
  const withMetadataMiss = recordStationHealthSignal(
    DEFAULT_STATION_HEALTH_PROFILE,
    stations[0],
    'metadata-unavailable',
    { now }
  );
  const failed = recordStationHealthSignal(
    recordStationHealthSignal(withMetadataMiss, stations[4], 'stream-failure', {
      now: now - 1000
    }),
    stations[4],
    'unsupported-transport',
    { now }
  );
  const httpStation = {
    ...stations[1],
    stationuuid: 'uuid-http-osaka',
    url: 'http://radio.example.com/osaka.mp3',
    url_resolved: 'http://radio.example.com/osaka.mp3'
  };
  const withProxySuccess = recordStationHealthSignal(failed, httpStation, 'proxy-success', {
    now,
    startupMs: 1200
  });
  const resolved = resolveBestPlayableCandidate(httpStation, withProxySuccess, {
    apiAvailable: true,
    apiBase: '/api'
  });

  expect(getStationHealthScore(withMetadataMiss, stations[0], now)).toBe(0);
  expect(getStationHealthScore(failed, stations[4], now)).toBeLessThan(0);
  expect(isStationSuppressedByHealth(failed, stations[4], now)).toBe(true);
  expect(getStationHealthScore(withProxySuccess, httpStation, now)).toBeGreaterThan(0);
  expect(resolved.preferredTransport).toBe('proxy');
  expect(resolved.suppressed).toBe(false);
});

test('track trust separates missing metadata from questionable streams and dedupes history', () => {
  const now = Date.UTC(2026, 3, 20, 11, 0, 0);
  const station = stations[0];

  expect(normalizeTrustedTrackTitle('{"status":"error"}', station)).toBeNull();
  expect(normalizeTrustedTrackTitle('Tokyo FM', station)).toBeNull();
  expect(normalizeTrustedTrackTitle('Perfume - Night Flight', station)).toBe('Perfume - Night Flight');
  expect(
    resolveNowPlayingTrust({
      station,
      track: null,
      metadataStatus: 'loading',
      playerStatus: 'playing',
      failure: null
    }).kind
  ).toBe('without-metadata');
  expect(
    resolveNowPlayingTrust({
      station,
      track: null,
      metadataStatus: 'unavailable',
      playerStatus: 'error',
      failure: {
        kind: 'unsupported-transport',
        message: 'media source not supported',
        recoverable: false
      }
    }).kind
  ).toBe('questionable-stream');

  const first = upsertTrustedTrackHistory(
    [],
    {
      id: 'track-1',
      stationId: station.stationuuid,
      stationName: station.name,
      track: 'Perfume - Night Flight',
      timestamp: now
    },
    10,
    now
  );
  const duplicate = upsertTrustedTrackHistory(
    first,
    {
      id: 'track-2',
      stationId: station.stationuuid,
      stationName: station.name,
      track: 'Perfume - Night Flight',
      timestamp: now + 1000
    },
    10,
    now + 1000
  );
  const garbage = upsertTrustedTrackHistory(
    duplicate,
    {
      id: 'track-3',
      stationId: station.stationuuid,
      stationName: station.name,
      track: 'Loading...',
      timestamp: now + 2000
    },
    10,
    now + 2000
  );

  expect(first).toHaveLength(1);
  expect(duplicate).toHaveLength(1);
  expect(garbage).toHaveLength(1);
});

for (const width of [360, 390]) {
  test(`mobile home dense shows personal radio and compact station rails at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 844 });
    await seedRadioState(page, {
      recent: [stations[0]],
      playbackHistory: [stations[1]],
      queue: [stations[2]]
    });

    await page.goto('/');
    await expect(page.locator('[data-home-personal-radio]')).toBeVisible();

    await expect(page.locator('.screen-home-next')).toHaveAttribute('data-density', 'dense');
    await expect(page.locator('.home-search-launcher')).toHaveCount(0);
    await expect(page.locator('#home-search-launcher')).toHaveCount(0);
    await expect(page.locator('[data-home-search-preview]')).toHaveCount(0);
    await expect(page.locator('.home-explore-card')).toHaveCount(0);
    await expect(page.locator('[data-home-hero]')).toHaveCount(0);
    await expect(page.locator('.home-hero-companions')).toHaveCount(0);
    await expect(page.locator('[data-home-personal-radio] .home-personal-play')).toHaveCount(1);
    await expect(page.locator('[data-home-resume="true"]')).toBeVisible();
    await expect(page.locator('[data-home-rail]')).toHaveCount(3);
    await expect(page.locator('[data-home-rail] .home-section-title').first()).toContainText(/Для тебя|For you/);
    await expect(page.locator('.screen-home-next')).not.toContainText(
      /Что изменилось|По твоим|Похожее на|часто слушаешь|Based on|liked/i
    );
    const compactHomeMetrics = await page.evaluate(() => {
      const topbar = document.querySelector('.app-topbar-v2')?.getBoundingClientRect();
      const personalRadio = document.querySelector('[data-home-personal-radio]')?.getBoundingClientRect();
      const railTiles = Array.from(document.querySelectorAll('[data-home-rail] [data-home-station]'));
      const visibleRailTiles = railTiles.filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.left >= -1 && rect.left < window.innerWidth - 24 && rect.top < window.innerHeight - 160;
      }).length;
      const railListStyle = window.getComputedStyle(
        document.querySelector('[data-home-rail] .home-horizontal-scroll') as Element
      );

      return {
        topbarHeight: topbar?.height || 0,
        personalRadioHeight: personalRadio?.height || 0,
        visibleRailTiles,
        railDisplay: railListStyle.display,
        railOverflowX: railListStyle.overflowX,
        railRows: railListStyle.gridTemplateRows
      };
    });
    expect(compactHomeMetrics.topbarHeight).toBeLessThanOrEqual(72);
    expect(compactHomeMetrics.personalRadioHeight).toBeLessThanOrEqual(72);
    expect(compactHomeMetrics.visibleRailTiles).toBeGreaterThanOrEqual(5);
    expect(compactHomeMetrics.railDisplay).toBe('grid');
    expect(compactHomeMetrics.railRows).not.toBe('none');
    expect(compactHomeMetrics.railOverflowX).toBe('auto');
    await expect(page.locator('.home-rail-scroll-controls').first()).toBeVisible();
    const firstRail = page.locator('[data-home-rail]').first();
    const railScroll = firstRail.locator('.home-horizontal-scroll');
    const beforeScrollLeft = await railScroll.evaluate((node) => node.scrollLeft);
    const afterWheelScrollLeft = await railScroll.evaluate((node) => {
      node.dispatchEvent(new WheelEvent('wheel', { deltaY: 360, bubbles: true, cancelable: true }));
      return node.scrollLeft;
    });
    const canScrollRail = await railScroll.evaluate((node) => node.scrollWidth > node.clientWidth);
    if (canScrollRail) {
      expect(afterWheelScrollLeft).toBeGreaterThan(beforeScrollLeft);
      await firstRail.locator('.home-rail-scroll-btn').last().click();
      const afterButtonScrollLeft = await railScroll.evaluate((node) => node.scrollLeft);
      expect(afterButtonScrollLeft).toBeGreaterThanOrEqual(afterWheelScrollLeft);
    }
    await expectNoHomeHorizontalOverflow(page);

    await page.locator('[data-home-personal-radio] .home-personal-play').click();
    await expect(page.locator('.player-dock-bar')).toBeVisible();
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const stored = window.localStorage.getItem('radio:player:v2');
          return stored ? JSON.parse(stored).queue?.sourceId : null;
        })
      )
      .toBe('personal-radio');
    const personalQueueState = await page.evaluate(() => {
      const stored = window.localStorage.getItem('radio:player:v2');
      return stored ? JSON.parse(stored).queue : null;
    });
    expect(personalQueueState?.sourceId).toBe('personal-radio');
    expect(personalQueueState?.items?.length).toBeGreaterThanOrEqual(6);
  });
}

test('mobile home promotes behavior-profile recommendations without reason copy', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedRadioState(page, {
    stationCache: stations,
    behaviorProfile: behaviorProfile({
      tagScores: { techno: 90 },
      countryScores: { Germany: 45 },
      stationScores: { 'uuid-berlin': 140 }
    })
  });

  await page.goto('/');
  await expect(page.locator('[data-home-rail] [data-home-station]').first()).toBeVisible();
  const recommendedStations = await page
    .locator('[data-home-rail] [data-home-station]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-home-station')));
  expect(recommendedStations).toContain('uuid-berlin');
  await expect(page.locator('.screen-home-next')).not.toContainText(/По твоим|Похожее на|часто слушаешь|Based on|liked/i);
});

test('mobile home demotes a repeatedly failed station from the primary hero', async ({ page }) => {
  const now = Date.now();
  const playabilityProfile = recordPlaybackOutcome(
    recordPlaybackOutcome(DEFAULT_PLAYABILITY_PROFILE, stations[4], 'no-playable-candidate', now - 1000),
    stations[4],
    'unsupported-transport',
    now
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await seedRadioState(page, {
    stationCache: stations,
    behaviorProfile: behaviorProfile({
      tagScores: { techno: 90 },
      countryScores: { Germany: 45 },
      stationScores: { 'uuid-berlin': 180, 'uuid-hamburg': 80 }
    }),
    playabilityProfile
  });

  await page.goto('/');
  await expect(page.locator('[data-home-personal-radio]')).toBeVisible();
  await expect(page.locator('[data-home-rail] [data-home-station]').first()).not.toHaveAttribute('data-home-station', 'uuid-berlin');
});

for (const width of [360, 390]) {
  test(`mobile globe uses reticle tuning and a visible focus sheet at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 844 });

    await page.goto('/');
    await page.locator('.app-navigation-mobile').getByRole('button', { name: /Глобус|Globe/ }).click();

    await expect(page.locator('.screen-globe-v2')).toHaveAttribute('data-density', 'dense');
    await expect(page.locator('.globe-reticle')).toBeVisible();
    await expect(page.locator('[data-globe-tune]')).toBeVisible();
    await expect(page.locator('[data-globe-play-region]')).toBeVisible();
    await expect(page.locator('.globe-hint')).not.toContainText(/scroll|колес/i);
    await expect(page.locator('.globe-focus-card .station-row').first()).toBeVisible();
    await expectNoGlobeHorizontalOverflow(page);

    const denseControlMetrics = await page.evaluate(() => {
      const reticle = document.querySelector('.globe-reticle')?.getBoundingClientRect();
      const footer = document.querySelector('.screen-globe-minimal[data-density="dense"] .globe-command-footer')?.getBoundingClientRect();
      const footerNode = document.querySelector('.screen-globe-minimal[data-density="dense"] .globe-command-footer');
      const footerStyle = footerNode ? window.getComputedStyle(footerNode) : null;
      return {
        reticleCenterY: reticle ? reticle.top + reticle.height / 2 : null,
        footerTop: footer?.top ?? null,
        footerBottom: footer?.bottom ?? null,
        footerBackground: footerStyle?.backgroundColor || '',
        footerBackdrop: footerStyle?.backdropFilter || ''
      };
    });
    expect(denseControlMetrics.reticleCenterY).not.toBeNull();
    expect(denseControlMetrics.footerTop).not.toBeNull();
    expect(denseControlMetrics.footerBottom).not.toBeNull();
    expect(
      denseControlMetrics.reticleCenterY! < denseControlMetrics.footerTop! - 24 ||
        denseControlMetrics.reticleCenterY! > denseControlMetrics.footerBottom! + 24
    ).toBe(true);
    expect(denseControlMetrics.footerBackground).not.toBe('rgba(0, 0, 0, 0)');

    const sheetRect = await page.locator('.globe-focus-card').evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        viewportHeight: window.innerHeight,
        scrollY: window.scrollY
      };
    });
    expect(sheetRect.top).toBeLessThan(sheetRect.viewportHeight - 80);
    expect(sheetRect.bottom).toBeGreaterThan(sheetRect.top + 80);
    expect(sheetRect.scrollY).toBe(0);

    await page.locator('[data-globe-play-region]').click();
    await expect(page.locator('.player-dock-bar')).toBeVisible();

    await page.locator('[data-globe-clear]').click();
    await expect(page.locator('.screen-globe-v2')).toHaveAttribute('data-zoom-level', '1.00');
    await expect(page.locator('[data-globe-clear]')).toHaveCount(0);

    await page.locator('[data-globe-tune]').click();
    await expect(page.locator('[data-globe-clear]')).toBeVisible();
    await expect(page.locator('.globe-focus-card .station-row').first()).toBeVisible();

    await page.locator('.globe-focus-card .station-compact-toggle').first().click();
    await expect(page.locator('.player-dock-bar')).toBeVisible();
  });
}

test('mobile globe retuning the selected area deselects instead of zooming further', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await page.locator('.app-navigation-mobile').getByRole('button', { name: /Глобус|Globe/ }).click();
  await expect(page.locator('.globe-focus-card .station-row').first()).toBeVisible();

  if (await page.locator('[data-globe-clear]').isVisible().catch(() => false)) {
    await page.locator('[data-globe-clear]').click();
  }
  await expect(page.locator('[data-globe-clear]')).toHaveCount(0);
  await expect(page.locator('.screen-globe-v2')).toHaveAttribute('data-zoom-level', '1.00');

  await page.locator('[data-globe-tune]').click();
  await expect(page.locator('[data-globe-clear]')).toBeVisible();
  const zoomAfterSelect = await page.locator('.screen-globe-v2').getAttribute('data-zoom-level');

  await page.locator('[data-globe-tune]').click();
  await expect(page.locator('[data-globe-clear]')).toHaveCount(0);
  await expect(page.locator('.screen-globe-v2')).toHaveAttribute('data-zoom-level', '1.00');
  expect(Number(zoomAfterSelect)).toBeGreaterThanOrEqual(1);
});

test('mobile globe wheel zoom keeps one canvas wheel listener', async ({ page }) => {
  await page.addInitScript(() => {
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    let wheelAdds = 0;
    let wheelRemoves = 0;

    EventTarget.prototype.addEventListener = function (...args) {
      if (args[0] === 'wheel' && this instanceof HTMLCanvasElement) {
        wheelAdds += 1;
      }
      return originalAdd.apply(this, args);
    };
    EventTarget.prototype.removeEventListener = function (...args) {
      if (args[0] === 'wheel' && this instanceof HTMLCanvasElement) {
        wheelRemoves += 1;
      }
      return originalRemove.apply(this, args);
    };
    Object.defineProperty(window, '__globeWheelListenerCounts', {
      configurable: true,
      value: () => ({ wheelAdds, wheelRemoves })
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('.app-navigation-mobile').getByRole('button', { name: /Глобус|Globe/ }).click();
  await expect(page.locator('.globe canvas')).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(() =>
        (window as typeof window & {
          __globeWheelListenerCounts?: () => { wheelAdds: number; wheelRemoves: number };
        }).__globeWheelListenerCounts?.().wheelAdds ?? 0
      )
    )
    .toBeGreaterThan(0);

  const before = await page.evaluate(() =>
    (window as typeof window & {
      __globeWheelListenerCounts: () => { wheelAdds: number; wheelRemoves: number };
    }).__globeWheelListenerCounts()
  );
  const canvasBox = await page.locator('.globe canvas').boundingBox();
  expect(canvasBox).not.toBeNull();
  await page.mouse.move(canvasBox!.x + canvasBox!.width / 2, canvasBox!.y + canvasBox!.height / 2);
  await page.mouse.wheel(0, -180);
  await expect(page.locator('.screen-globe-v2')).not.toHaveAttribute('data-zoom-level', '1.00');
  const after = await page.evaluate(() =>
    (window as typeof window & {
      __globeWheelListenerCounts: () => { wheelAdds: number; wheelRemoves: number };
    }).__globeWheelListenerCounts()
  );

  expect(after.wheelAdds).toBe(before.wheelAdds);
  expect(after.wheelRemoves).toBe(before.wheelRemoves);
});

test('home cold load shows hero skeleton while summary is pending', async ({ page }) => {
  await page.unroute('**/catalog/summary**');
  await page.route('**/catalog/summary**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: summaryBody()
    });
  });

  await page.goto('/');
  await expect(page.locator('.screen-skeleton-home-hero')).toBeVisible();
  await expect(page.locator('[data-home-personal-radio]')).toBeVisible();
});

test('home typing uses local preview without catalog search requests', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 900 });
  const searchRequests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/catalog/search') || url.includes('/json/stations/search')) {
      searchRequests.push(url);
    }
  });

  await page.goto('/');
  await expect(page.locator('#home-search-launcher')).toBeVisible();
  await page.locator('#home-search-launcher').fill('Tokyo');
  await page.waitForTimeout(450);

  expect(searchRequests).toEqual([]);
  await expect(page.locator('[data-home-search-preview] [data-home-station]')).toHaveCount(1);
});

test('search ranks playable tag matches above failed matches', async ({ page }) => {
  const now = Date.now();
  const playabilityProfile = recordPlaybackOutcome(
    recordPlaybackOutcome(DEFAULT_PLAYABILITY_PROFILE, stations[1], 'success', now - 2000),
    stations[0],
    'no-playable-candidate',
    now - 1000
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await seedRadioState(page, {
    activeSection: 'search',
    stationCache: stations,
    behaviorProfile: behaviorProfile({
      tagScores: { jpop: 40 },
      countryScores: { Japan: 20 }
    }),
    playabilityProfile
  });

  await page.goto('/');
  await expect(page.locator('.screen-search-v2')).toBeVisible();
  await page.locator('.search-command-card .search-bar input').first().fill('jpop');
  await expect(page.locator('.station-row').first()).toContainText('Osaka Nights');
});

test('mobile search uses compact result cards and can start a result queue', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedRadioState(page, {
    activeSection: 'search',
    stationCache: stations
  });

  await page.goto('/');
  await expect(page.locator('.screen-search-v2')).toBeVisible();
  await page.locator('.search-command-card .search-bar input').first().fill('jpop');
  await expect(page.locator('[data-search-station-card]')).toHaveCount(12);
  await expect(page.locator('[data-search-station-card]').first()).toContainText(/Tokyo FM|Osaka Nights/);
  await page.getByRole('button', { name: /Играть выдачу|Play results/ }).click();

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem('radio:player:v2');
        return raw ? JSON.parse(raw).queue?.sourceId : null;
      })
    )
    .toBe('search-results');
  await expect(page.locator('.player-dock-title')).toContainText(/Tokyo FM|Osaka Nights/);
});

test('home summary error banner is one-shot and clears after summary succeeds', async ({ page }) => {
  let attempts = 0;
  await page.unroute('**/catalog/summary**');
  await page.route('**/catalog/summary**', async (route) => {
    attempts += 1;
    if (attempts <= 2) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'summary fixture failed' })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: summaryBody(Date.UTC(2026, 3, 20, 10, 0, 0))
    });
  });
  await page.route('**/json/stations/topvote/**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'fallback fixture failed' })
    })
  );

  await page.goto('/');
  await expect(page.locator('.home-status-banner')).toBeVisible();
  await page.locator('.home-status-banner .home-inline-link').click();
  await expect(page.locator('.home-status-banner')).toHaveCount(0);
  await expect(page.locator('[data-home-personal-radio]')).toBeVisible();
  await expect(page.locator('.home-status-banner')).toHaveCount(0);
});

test('player peek label clamps long station names', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await expect(page.locator('.player-peek-label')).toBeVisible();
  const styles = await page.locator('.player-peek-label').evaluate((node) => {
    node.textContent = 'Very long station name aaa aaa aaa aaa aaa aaa aaa aaa aaa';
    const computed = window.getComputedStyle(node);
    return {
      maxWidth: computed.maxWidth,
      overflow: computed.overflow,
      textOverflow: computed.textOverflow,
      whiteSpace: computed.whiteSpace
    };
  });

  expect(styles.maxWidth).toBe('216px');
  expect(styles.overflow).toBe('hidden');
  expect(styles.textOverflow).toBe('ellipsis');
  expect(styles.whiteSpace).toBe('nowrap');
  await expectNoDocumentHorizontalOverflow(page);
});

test('mobile cold load mounts the peek dock immediately', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('.app-navigation-mobile')).toBeVisible();
  await expect(page.locator('.player-dock-peek')).toBeVisible({ timeout: 1000 });
});

test('dock separates empty explore from queue controls', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');

  await page.locator('.player-peek-handle').click();
  await expect(page.locator('.player-dock-bar')).toBeVisible();
  await expect(page.locator('.dock-queue-btn')).toHaveCount(0);
  await expect(page.locator('.dock-explore-btn')).toBeVisible();

  await page.locator('.dock-explore-btn').click();
  await expect(page.locator('.screen-search-v2')).toBeVisible();
});

test('dock shows queue control only when queue has items', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await seedRadioState(page, {
    queue: stations.slice(0, 3)
  });

  await page.goto('/');
  await page.locator('.player-peek-handle').click();
  await expect(page.locator('.player-dock-bar')).toBeVisible();
  await expect(page.locator('.dock-queue-btn')).toBeVisible();
  await expect(page.locator('.dock-explore-btn')).toHaveCount(0);

  await page.locator('.dock-queue-btn').click();
  await expect(page.locator('.player-dock-tray[data-mode="queue"]')).toBeVisible();
  await expect(page.locator('.screen-search-v2')).toHaveCount(0);
});

test('dock long station and track text stay readable without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await playHomeStation(page, 'Tokyo FM');

  const textStyles = await page.locator('.player-dock-title').evaluate((node) => {
    node.textContent = 'Very long station name aaa aaa aaa aaa aaa aaa aaa aaa aaa';
    const track = document.querySelector('.player-dock-track-button-text');
    if (track) {
      track.textContent = 'Very long track title bbb bbb bbb bbb bbb bbb bbb bbb';
    }
    const stationStyle = window.getComputedStyle(node);
    const trackStyle = track ? window.getComputedStyle(track) : null;
    return {
      stationFontSize: stationStyle.fontSize,
      stationFontWeight: stationStyle.fontWeight,
      stationWhiteSpace: stationStyle.whiteSpace,
      trackFontSize: trackStyle?.fontSize,
      trackFontWeight: trackStyle?.fontWeight,
      trackWhiteSpace: trackStyle?.whiteSpace,
      titleClient: node.clientWidth,
      titleScroll: node.scrollWidth,
      trackClient: track?.clientWidth || 0,
      trackScroll: track?.scrollWidth || 0
    };
  });

  expect(textStyles.stationFontSize).toBe('14px');
  expect(Number(textStyles.stationFontWeight)).toBeGreaterThanOrEqual(700);
  expect(textStyles.stationWhiteSpace).toBe('nowrap');
  expect(textStyles.trackFontSize).toBe('12px');
  expect(Number(textStyles.trackFontWeight)).toBeGreaterThanOrEqual(500);
  expect(textStyles.trackWhiteSpace).toBe('nowrap');
  await expectNoDocumentHorizontalOverflow(page);
});

test('dock volume tap toggles mute and long press opens tray', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await playHomeStation(page, 'Tokyo FM');

  const volumeButton = page.locator('.dock-volume-btn');
  await expect(volumeButton).toBeVisible();
  await expect(page.locator('.player-dock-tray[data-mode="volume"]')).toHaveCount(0);

  await volumeButton.click();
  await expect(volumeButton).toHaveAttribute('data-muted', 'true');
  await expect(page.locator('.player-dock-tray[data-mode="volume"]')).toHaveCount(0);
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const audio = document.querySelector('audio');
        return audio instanceof HTMLAudioElement ? audio.volume : null;
      })
    )
    .toBe(0);

  await volumeButton.click();
  await expect(volumeButton).toHaveAttribute('data-muted', 'false');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const audio = document.querySelector('audio');
        return audio instanceof HTMLAudioElement ? audio.volume : null;
      })
    )
    .toBeGreaterThan(0.5);

  const box = await volumeButton.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(120);
  await page.mouse.move(box!.x + box!.width / 2 + 18, box!.y + box!.height / 2);
  await page.waitForTimeout(520);
  await page.mouse.up();
  await expect(page.locator('.player-dock-tray[data-mode="volume"]')).toHaveCount(0);

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(520);
  await page.mouse.up();
  await expect(page.locator('.player-dock-tray[data-mode="volume"]')).toBeVisible();
  const trayMetrics = await page.locator('.player-dock-tray-panel').evaluate((node) => {
    const computed = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return {
      maxHeight: computed.maxHeight,
      overflowY: computed.overflowY,
      overscrollBehavior: computed.overscrollBehavior,
      height: rect.height,
      viewportHeight: window.innerHeight
    };
  });
  expect(trayMetrics.overflowY).toBe('auto');
  expect(trayMetrics.height).toBeLessThanOrEqual(Math.min(trayMetrics.viewportHeight * 0.4, 360) + 1);

  await page.locator('.player-dock-tray[data-mode="volume"] .dock-skin-btn').click();
  await expect(page.locator('[data-skin-lab]')).toBeVisible();
});

test('dock buffering status does not duplicate loading in the track line', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await playHomeStation(page, 'Tokyo FM');
  await expect(page.locator('.player-dock-bar')).toBeVisible();
  await page.waitForFunction(() => Boolean(document.querySelector('audio')));

  await page.evaluate(() => {
    const audio = document.querySelector('audio');
    audio?.dispatchEvent(new Event('waiting'));
  });

  await expect(page.locator('.player-dock-status-pill')).toContainText(/Буферизация|Buffering|Переподключение|Reconnecting/);
  await expect(page.locator('.player-dock-track-button-text')).not.toContainText(/Загрузка|Loading/i);
});

test('mobile library keeps four non-wrapping tabs and opens collection detail', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await seedRadioState(page, {
    activeSection: 'library',
    libraryTab: 'collections',
    stationCache: stations,
    collections: [
      {
        id: 'collection-japan',
        name: 'Japan set',
        stationIds: stations.slice(0, 5).map((station) => station.stationuuid)
      }
    ]
  });

  await page.goto('/');
  const tabs = page.locator('.library-tab-chip');
  await expect(tabs).toHaveCount(4);
  await expect(tabs.filter({ hasText: /Tracks|Треки|History|История/ })).toHaveCount(0);
  const tabStrip = await page.locator('.library-tab-strip').evaluate((node) => {
    const computed = window.getComputedStyle(node);
    const tops = Array.from(node.children).map((child) => child.getBoundingClientRect().top);
    return {
      flexWrap: computed.flexWrap,
      overflowX: computed.overflowX,
      rows: new Set(tops.map((top) => Math.round(top))).size
    };
  });
  expect(tabStrip.flexWrap).toBe('nowrap');
  expect(tabStrip.overflowX).toBe('auto');
  expect(tabStrip.rows).toBe(1);
  const tabScroll = await page.locator('.library-tab-strip').evaluate((node) => {
    const before = node.scrollLeft;
    node.scrollLeft = node.scrollWidth;
    return {
      before,
      after: node.scrollLeft,
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth
    };
  });
  expect(tabScroll.scrollWidth).toBeGreaterThan(tabScroll.clientWidth);
  expect(tabScroll.after).toBeGreaterThan(tabScroll.before);
  await expectNoDocumentHorizontalOverflow(page);

  await expect(page.locator('.library-collection-card')).toHaveCount(1);
  await expect(page.locator('[data-collection-artwork]')).toBeVisible();
  await expect(page.locator('.library-collection-card').getByRole('button', { name: /^Убрать$|^Remove$/ })).toHaveCount(0);
  await page.locator('.library-collection-card').getByRole('button', { name: /Открыть|Open/ }).first().click();
  await expect(page.locator('[data-library-collection-detail]')).toBeVisible();
  await expect(page.locator('[data-library-collection-row]')).toHaveCount(5);

  const detail = page.locator('[data-library-collection-detail]');
  await detail.getByRole('button', { name: /^Слушать$|^Play$/ }).first().click();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem('radio:player:v2');
        return raw ? JSON.parse(raw).queue : null;
      })
    )
    .toMatchObject({
      sourceId: 'collection-collection-japan',
      items: expect.arrayContaining([expect.objectContaining({ stationuuid: 'uuid-tokyo' })])
    });

  await detail.getByRole('button', { name: /Переименовать|Rename/ }).click();
  await detail.getByLabel(/Новое название|New collection name/).fill('Japan radio');
  await detail.getByRole('button', { name: /Сохранить|Save/ }).click();
  await expect(detail.locator('.section-title').first()).toContainText('Japan radio');

  await detail.getByRole('button', { name: /Порядок|Reorder/ }).click();
  const tokyoRow = page.locator('[data-library-collection-row][data-station-id="uuid-tokyo"]');
  await tokyoRow.getByRole('button', { name: /Опустить Tokyo FM|Move Tokyo FM down/ }).click();
  await expect(detail.locator('[data-library-collection-row]').first()).not.toHaveAttribute('data-station-id', 'uuid-tokyo');
  await tokyoRow.getByRole('button', { name: /Убрать Tokyo FM из коллекции|Remove Tokyo FM from collection/ }).click();
  await expect(tokyoRow).toHaveCount(0);
});

test('mobile library restores collection scroll after closing detail', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await seedRadioState(page, {
    activeSection: 'library',
    libraryTab: 'collections',
    stationCache: stations,
    collections: Array.from({ length: 8 }, (_, index) => ({
      id: `collection-${index}`,
      name: `Collection ${index + 1}`,
      stationIds: stations.slice(0, 4).map((station) => station.stationuuid)
    }))
  });

  await page.goto('/');
  const targetCard = page.locator('.library-collection-card').nth(6);
  await targetCard.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(0);

  await targetCard.getByRole('button', { name: /Открыть|Open/ }).click();
  await expect(page.locator('[data-library-collection-detail]')).toBeVisible();
  await page.locator('[data-library-collection-detail]').getByRole('button', { name: /Назад|Back/ }).click();
  await expect(page.locator('[data-library-collection-detail]')).toHaveCount(0);
  await page.waitForFunction(() => window.scrollY > 0);
  const after = await page.evaluate(() => window.scrollY);
  expect(after).toBeGreaterThan(0);
});

test('mobile library coerces legacy recent tabs without writing shell state', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await seedRadioState(page, {
    activeSection: 'library',
    libraryTab: 'tracks',
    stationCache: stations,
    recent: [stations[0]],
    playbackHistory: [stations[1]]
  });

  await page.goto('/');
  await expect(page.locator('.library-tab-chip.active')).toContainText(/Недавнее|Recent/);
  await page.waitForTimeout(220);
  const storedTab = await page.evaluate(() => {
    const raw = window.localStorage.getItem('radio:app:v2');
    if (!raw) return null;
    return (JSON.parse(raw) as { shell?: { libraryTab?: string } }).shell?.libraryTab || null;
  });
  expect(storedTab).toBe('tracks');
});

test('mobile library creates collections inline without native prompt', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await seedRadioState(page, {
    activeSection: 'library',
    libraryTab: 'collections',
    stationCache: stations
  });
  let promptCalled = false;
  page.on('dialog', async (dialog) => {
    promptCalled = true;
    await dialog.dismiss();
  });

  await page.goto('/');
  await page.getByRole('button', { name: /Новая коллекция|New collection/ }).first().click();
  await page.getByLabel(/Название коллекции|Collection name/).fill('Night drives');
  await page.getByRole('button', { name: /Сохранить|Save/ }).click();

  expect(promptCalled).toBe(false);
  await expect(page.locator('.library-collection-card').filter({ hasText: 'Night drives' })).toBeVisible();
});

test('mobile library hides add-current collection action without a current station', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await seedRadioState(page, {
    activeSection: 'library',
    libraryTab: 'collections',
    stationCache: stations,
    favorites: [stations[0]],
    recent: [stations[1]],
    collections: [
      {
        id: 'collection-empty',
        name: 'No fallback set',
        stationIds: []
      }
    ]
  });

  await page.goto('/');
  const collectionCard = page.locator('.library-collection-card').filter({ hasText: 'No fallback set' });
  await expect(collectionCard).toBeVisible();
  await expect(collectionCard.getByRole('button', { name: /Добавить текущее|Add current/ })).toHaveCount(0);
  await collectionCard.getByRole('button', { name: /Открыть|Open/ }).first().click();
  await expect(page.locator('[data-library-collection-detail]')).toBeVisible();
  await expect(page.getByRole('button', { name: /Добавить текущее|Add current/ })).toHaveCount(0);
  await expect(page.locator('[data-library-collection-row]')).toHaveCount(0);
});

test('mobile library followed stations can play and unfollow in place', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await seedRadioState(page, {
    activeSection: 'library',
    libraryTab: 'collections',
    stationCache: stations,
    followedStations: [
      {
        stationId: 'uuid-tokyo',
        stationName: 'Tokyo FM',
        country: 'Japan'
      }
    ]
  });

  await page.goto('/');
  const followRow = page.locator('.library-follow-row').filter({ hasText: 'Tokyo FM' });
  await followRow.getByRole('button', { name: /Слушать|Play/ }).click();
  await expect(page.locator('.player-dock-title')).toHaveText(/Tokyo FM/);

  await followRow.getByRole('button', { name: /Отписаться|Unfollow/ }).click();
  await expect(page.locator('.library-follow-row').filter({ hasText: 'Tokyo FM' })).toHaveCount(0);
});

test('mobile library followed regions route to focused globe area', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await seedRadioState(page, {
    activeSection: 'library',
    libraryTab: 'collections',
    stationCache: stations,
    followedRegions: [
      {
        id: 'asia-japan',
        label: 'Japan',
        scope: 'country'
      }
    ]
  });

  await page.goto('/');
  const regionRow = page.locator('.library-follow-row').filter({ hasText: 'Japan' });
  await expect(regionRow.locator('[data-region-artwork]')).toBeVisible();
  await regionRow.getByRole('button', { name: /^Слушать$|^Play$/ }).click();
  await expect(page.locator('.player-dock-title')).toHaveText(/Tokyo FM|Osaka Nights|Kyoto Groove|Sapporo City Pop/);
  await regionRow.getByRole('button', { name: /Открыть глобус|Open in Globe/ }).click();
  await expect(page.locator('.screen-globe-v2')).toBeVisible();
  await expect(page.locator('.globe-focus-card .section-title')).toHaveText(/Japan/);
  await expectNoGlobeHorizontalOverflow(page);
});

test('mobile startup stays free of playback runtime render loops', async ({ page }) => {
  const runtimeWarnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (text.includes('Maximum update depth exceeded')) {
      runtimeWarnings.push(text);
    }
  });

  await page.goto('/');
  await expect(page.locator('[data-home-personal-radio]')).toBeVisible();
  await page.waitForTimeout(600);

  expect(runtimeWarnings).toEqual([]);
});

test('mobile settings can open lite fullscreen shell without an active station', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-home-personal-radio]')).toBeVisible();

  await page.locator('.mobile-settings-trigger').click();
  await expect(page.locator('.settings-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Открыть полноэкранный плеер' }).click();

  await expect(page.locator('.winamp-compact.fullscreen-ui')).toBeVisible();
  await expect(page.locator('.winamp-compact[data-winamp-mode="lite"]')).toBeVisible();
  await expect(page.locator('[data-winamp-lite-panel="true"]')).toBeVisible();
});

test('mobile settings opens skin lab and applies a previewed museum skin', async ({ page }) => {
  await mockSkinMuseumSearch(page);
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await expect(page.locator('[data-home-personal-radio]')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-skin-source', 'preset');

  await page.locator('.mobile-settings-trigger').click();
  await expect(page.locator('.settings-panel')).toBeVisible();
  await page.getByRole('button', { name: /Открыть Skin Lab|Open Skin Lab/ }).click();

  await expect(page.locator('[data-skin-lab]')).toBeVisible();
  await page.locator('#skin-lab-search').fill('purple');
  const purpleCard = page.locator('.skin-lab-card').filter({ hasText: 'Purple_Dream.wsz' }).first();
  await expect(purpleCard).toBeVisible();

  await purpleCard.locator('.skin-lab-card-main').click();
  await expect(page.locator('.skin-lab-preview-shell')).toHaveAttribute('data-preview-skin-source', 'museum');
  await expect(page.locator('.skin-lab-preview-shell')).toHaveAttribute('data-preview-skin-name', 'Purple_Dream.wsz');
  await expect(page.locator('.skin-lab-preview-shell .skin-lab-preview-image')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-skin-source', 'preset');

  await page.locator('.skin-lab-preview-panel').getByRole('button', { name: /Применить|Apply/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-skin-source', 'museum');
  await expect(page.locator('html')).toHaveAttribute('data-skin-name', 'Purple_Dream.wsz');
});

test('mobile skin lab previews uploaded skins for the current session only', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await expect(page.locator('[data-home-personal-radio]')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-skin-source', 'preset');

  await page.locator('.mobile-settings-trigger').click();
  await page.getByRole('button', { name: /Открыть Skin Lab|Open Skin Lab/ }).click();
  await expect(page.locator('[data-skin-lab]')).toBeVisible();

  await page.locator('.skin-lab-upload input').setInputFiles(UPLOAD_SKIN_PATH);
  await expect(page.locator('.skin-lab-preview-shell')).toHaveAttribute('data-preview-skin-source', 'uploaded');
  await expect(page.locator('.skin-lab-preview-shell')).toHaveAttribute('data-preview-skin-name', 'base-2.91.wsz');
  await expect(page.locator('html')).toHaveAttribute('data-skin-source', 'preset');

  await page.locator('.skin-lab-preview-panel').getByRole('button', { name: /Применить|Apply/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-skin-source', 'uploaded');

  const storedSkinSource = await page.evaluate(() => {
    const raw = window.localStorage.getItem('radio:player:v2');
    if (!raw) return null;
    return (JSON.parse(raw) as { skin?: { source?: string } }).skin?.source || null;
  });
  expect(storedSkinSource).toBe('preset');

  await page.reload();
  await expect(page.locator('[data-home-personal-radio]')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-skin-source', 'preset');
});

test('mobile shell keeps dock and bottom nav separately tappable', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-home-personal-radio]')).toBeVisible();

  await expect(page.locator('.app-navigation-mobile')).toBeVisible();
  await expect(page.locator('.player-dock-peek')).toBeVisible();

  await playHomeStation(page, 'Tokyo FM');

  await expect(page.locator('.player-dock-bar')).toBeVisible();
  await expect(page.locator('.app-navigation-mobile')).toBeVisible();
  await expect(page.locator('.player-dock-title')).toContainText('Tokyo FM');

  await page.locator('.player-dock-artwork-trigger').evaluate((node) => {
    (node as HTMLButtonElement).click();
  });
  await expect(page.locator('.winamp-compact.fullscreen-ui')).toBeVisible();
  await expect(page.locator('.winamp-compact[data-winamp-mode="lite"]')).toBeVisible();
  await expect(page.locator('[data-winamp-lite-panel="true"]')).toBeVisible();

  await page.locator('.winamp-overlay-header .winamp-close-btn').click();
  await expect(page.locator('.player-dock-bar')).toBeVisible();
});

test('expanded player shows artwork, recent tracks, details and hide action', async ({ page }) => {
  await seedRadioState(page, {
    trackHistory: [
      {
        id: 'track-tokyo-1',
        stationId: 'uuid-tokyo',
        stationName: 'Tokyo FM',
        track: 'Mock Song',
        timestamp: Date.UTC(2026, 3, 20, 10, 0, 0)
      }
    ]
  });
  await page.goto('/');
  await expect(page.locator('[data-home-personal-radio]')).toBeVisible();

  await playHomeStation(page, 'Tokyo FM');
  await page.locator('.player-dock-artwork-trigger').evaluate((node) => {
    (node as HTMLButtonElement).click();
  });

  await expect(page.locator('.winamp-compact.fullscreen-ui')).toBeVisible();
  await expect(page.locator('.winamp-now-artwork').first()).toBeVisible();
  await expect(page.locator('.winamp-overlay-track-list')).toContainText('Mock Song');
  await expect(page.locator('.winamp-overlay-footer')).toContainText(/Детали|Details/);

  await page
    .locator('.winamp-overlay-footer')
    .getByRole('button', { name: /^Скрыть$|^Hide$/ })
    .first()
    .click();

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem('radio:app:v2');
        if (!raw) return [];
        return (JSON.parse(raw) as { tasteProfile?: { hiddenStationIds?: string[] } }).tasteProfile
          ?.hiddenStationIds || [];
      })
    )
    .toContain('uuid-tokyo');
});

test('station details exposes trust, recent tracks, report broken and recommendation hide', async ({ page }) => {
  await seedRadioState(page, {
    trackHistory: [
      {
        id: 'track-tokyo-2',
        stationId: 'uuid-tokyo',
        stationName: 'Tokyo FM',
        track: 'Mock Song',
        timestamp: Date.UTC(2026, 3, 20, 10, 5, 0)
      }
    ]
  });
  await page.goto('/');
  await expect(page.locator('[data-home-personal-radio]')).toBeVisible();

  await playHomeStation(page, 'Tokyo FM');
  await page.locator('.player-dock-station').click();

  await expect(page.locator('.details-card')).toBeVisible();
  await expect(page.locator('.details-artwork')).toBeVisible();
  await expect(page.locator('.details-card')).toContainText(/Надёжность|Stream trust/);
  await expect(page.locator('.details-card')).toContainText('Mock Song');

  await page.getByRole('button', { name: /Пожаловаться|Report broken/ }).click();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem('radio:app:v2');
        if (!raw) return null;
        return (JSON.parse(raw) as { stationHealthProfile?: { signals?: Record<string, { failures?: number }> } })
          .stationHealthProfile?.signals?.['uuid-tokyo']?.failures || 0;
      })
    )
    .toBeGreaterThan(0);

  await page.getByRole('button', { name: /^Скрыть$|^Hide$/ }).click();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem('radio:app:v2');
        if (!raw) return [];
        return (JSON.parse(raw) as { tasteProfile?: { hiddenStationIds?: string[] } }).tasteProfile
          ?.hiddenStationIds || [];
      })
    )
    .toContain('uuid-tokyo');
});

test('product analytics records app, home, search and playback events without raw query text', async ({ page }) => {
  const events: Array<{ name?: string; meta?: Record<string, unknown> }> = [];
  await page.route('**/observability/client-event', async (route) => {
    const raw = route.request().postData();
    if (raw) {
      events.push(JSON.parse(raw) as { name?: string; meta?: Record<string, unknown> });
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true })
    });
  });

  await page.goto('/');
  await expect(page.locator('[data-home-personal-radio]')).toBeVisible();
  await page.locator('.app-navigation-mobile').getByRole('button', { name: /Поиск|Search/ }).click();
  const discoverInput = page.locator('.search-command-card .search-bar input').first();
  await discoverInput.waitFor({ state: 'visible' });
  await discoverInput.fill('Tokyo');
  await page.waitForTimeout(500);
  await page.locator('.search-card-play, .station-compact-play').first().click();

  await expect.poll(() => events.map((event) => event.name)).toEqual(
    expect.arrayContaining([
      'app_opened',
      'home_station_impression',
      'search_query',
      'play_attempt',
      'play_success'
    ])
  );
  const searchEvent = events.find((event) => event.name === 'search_query');
  expect(searchEvent?.meta).toMatchObject({
    queryHash: expect.any(String),
    queryLength: 5
  });
  expect(JSON.stringify(searchEvent?.meta)).not.toContain('Tokyo');
});

test('mobile library queue survives navigation after playback starts', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-home-personal-radio]')).toBeVisible();

  await playHomeStation(page, 'Tokyo FM');
  await page.locator('.app-navigation-mobile').getByRole('button', { name: 'Медиатека' }).evaluate((node) => {
    (node as HTMLButtonElement).click();
  });
  await page
    .locator('.library-tab-chip')
    .filter({ hasText: 'Очередь' })
    .first()
    .evaluate((node) => {
      (node as HTMLButtonElement).click();
    });

  await expect(page.locator('.playlist-row.active')).toContainText('Tokyo FM');
  await expect(page.locator('.app-navigation-mobile')).toBeVisible();
});

test('telegram mobile playback sticks to proxy transport candidates', async ({ page }) => {
  await enableTelegramMobileSafeMode(page);
  await page.goto('/?tgWebAppPlatform=ios');
  await expect(page.locator('[data-home-personal-radio]')).toBeVisible();

  await playHomeStation(page, 'Tokyo FM');

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const audio = document.querySelector('audio');
        return audio instanceof HTMLAudioElement ? audio.dataset.raTransportMode || null : null;
      })
    )
    .toBe('proxy');
});

test('telegram mobile fullscreen falls back to lite winamp mode', async ({ page }) => {
  await enableTelegramMobileSafeMode(page);
  await page.goto('/?tgWebAppPlatform=ios');
  await expect(page.locator('[data-home-personal-radio]')).toBeVisible();

  await playHomeStation(page, 'Tokyo FM');
  await page.locator('.player-dock-artwork-trigger').evaluate((node) => {
    (node as HTMLButtonElement).click();
  });

  await expect(page.locator('.winamp-compact.fullscreen-ui')).toBeVisible();
  await expect(page.locator('.winamp-compact[data-winamp-mode="lite"]')).toBeVisible();
  await expect(page.locator('[data-winamp-lite-panel="true"]')).toBeVisible();
  await expect(page.locator('.winamp-overlay-visualizer-card')).toHaveCount(0);
});

test('deferred public and paid product surfaces stay disabled', () => {
  expect(PRODUCT_SURFACE_GUARDS).toMatchObject({
    billing: false,
    stars: false,
    marketplace: false,
    paidPacks: false,
    publicCollections: false,
    editorialPortal: false,
    ownerDashboard: false,
    stationClaims: false
  });
  expect(shouldExposeProductSurface('billing')).toBe(false);
  expect(shouldExposeProductSurface('publicCollections')).toBe(false);
  expect(shouldExposeProductSurface('stationClaims')).toBe(false);
});

test('home falls back to direct Radio Browser catalog when API summary fails', async ({ page }) => {
  await page.unroute('**/catalog/summary**');
  await page.route('**/catalog/summary**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'catalog offline' })
    })
  );
  await page.route('**/json/stations/topvote/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(stations)
    })
  );

  await page.goto('/');
  await expect(page.locator('[data-home-personal-radio]')).toBeVisible();
  await expect(page.locator('[data-home-rail] [data-home-station]').first()).toBeVisible();
  await expect(page.locator('.home-status-banner')).toHaveCount(0);
  await expectNoHomeHorizontalOverflow(page);
});

test('core mobile screens have no document overflow on 360 390 and 412 widths', async ({
  page
}) => {
  for (const width of [360, 390, 412]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(page.locator('[data-home-personal-radio]')).toBeVisible();
    await expectNoDocumentHorizontalOverflow(page);

    await page.locator('.app-navigation-mobile').getByRole('button', { name: /Поиск|Search/ }).click();
    await expect(page.locator('.search-command-card')).toBeVisible();
    await expectNoDocumentHorizontalOverflow(page);

    await page.locator('.app-navigation-mobile').getByRole('button', { name: /Глобус|Globe/ }).click();
    await expect(page.locator('.screen-globe-v2')).toBeVisible();
    await expectNoDocumentHorizontalOverflow(page);

    await page.locator('.app-navigation-mobile').getByRole('button', { name: /Медиатека|Library/ }).click();
    await expect(page.locator('.library-tab-strip')).toBeVisible();
    await expectNoDocumentHorizontalOverflow(page);
  }
});

test('home first useful paint does not load globe skin lab or winamp overlays', async ({
  page
}) => {
  const requested: string[] = [];
  page.on('request', (request) => {
    requested.push(request.url());
  });

  await page.goto('/');
  await expect(page.locator('[data-home-personal-radio]')).toBeVisible();

  expect(
    requested.some((url) =>
      /GlobeScreen|Globe\.tsx|SkinLab|WinampPlayerShell|LitePlayerOverlay|webamp/i.test(url)
    )
  ).toBe(false);
});

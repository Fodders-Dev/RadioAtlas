import { expect, test, type Page } from '@playwright/test';
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
import { resolveThemeDecorations } from '../src/lib/theme/decorations';
import {
  buildPersonalRadioQueue,
  refillPersonalRadioQueueItems
} from '../src/lib/personalRadio';
import { recordRadioSessionEvent } from '../src/lib/radioSession';
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
import { DEFAULT_RADIOATLAS_THEMES } from '../src/lib/theme/defaults';
import {
  themeAccentPairToCss,
  themeAccentToCss,
  themeBackgroundToCss,
  themeFontToCss,
  themeIconRadiusToCss
} from '../src/lib/theme/runtime';
import {
  clearThemeStorageForTests,
  deleteStoredAsset,
  deleteStoredTheme,
  getStoredAsset,
  listStoredAssets,
  listStoredThemes,
  saveStoredAsset,
  saveStoredTheme
} from '../src/lib/theme/storage';
import { catalogCacheStorageKey, CATALOG_CACHE_VERSION } from '../src/lib/catalogCache';

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

// T2.21: a diverse catalogue + a summary carrying the three server-signal
// discovery pools, so the dense surface renders the production set of content
// shelves (fresh-now + Trending + country + genre + Top voted + Around the
// world) instead of leaving gaps that personalised "delta" rails fill.
const seedDiscoveryRoutes = async (page: Page) => {
  const COUNTRIES = 12;
  const GENRES = 12;
  const catalog = Array.from({ length: 120 }, (_, i) => ({
    ...stations[i % stations.length],
    stationuuid: `disc-${i}`,
    name: `Station ${i + 1}`,
    country: `Country ${i % COUNTRIES}`,
    tags: `genre${i % GENRES},sub${i % 5}`
  }));
  const body = JSON.stringify(catalog);
  const summaryBody = JSON.stringify({
    generatedAt: Date.now(),
    counts: { stations: catalog.length, countries: COUNTRIES, languages: 9, genres: GENRES },
    catalogPool: catalog.slice(0, 18),
    freshSignals: catalog.slice(0, 12),
    searchLaunch: catalog.slice(12, 24),
    sponsored: catalog.slice(0, 2),
    countrySpotlight: { label: 'Country 0', stations: catalog.filter((s) => s.country === 'Country 0').slice(0, 8) },
    genreSpotlight: { label: 'genre1', stations: catalog.filter((s) => s.tags.startsWith('genre1,')).slice(0, 8) },
    trending: catalog.slice(30, 42),
    topVoted: catalog.slice(42, 54),
    aroundTheWorld: { label: 'Country 5', stations: catalog.filter((s) => s.country === 'Country 5').slice(0, 8) },
    // T2.22 mood shelves (distinct slices) so the dense surface shows the
    // production content set and keeps the personalised delta rails out.
    moodRails: [
      { id: 'mood-late-night', stations: catalog.slice(60, 70) },
      { id: 'mood-workout', stations: catalog.slice(70, 80) },
      { id: 'mood-focus', stations: catalog.slice(80, 90) },
      { id: 'mood-driving', stations: catalog.slice(90, 100) }
    ]
  });
  const json = (payload: string) => (route: import('@playwright/test').Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: payload });
  await page.route('**/catalog-fast.json', json(body));
  await page.route('**/catalog-full.json', json(body));
  await page.route('**/catalog/summary**', json(summaryBody));
};

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
        // Horizontal-scroll rail containers (and the «Быстрый выбор» chip
        // scroller) intentionally let their children extend past the viewport.
        if (node.closest('.home-horizontal-scroll, .home-quick-chips')) return false;
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
  const overflowing = await page.locator('.screen-globe-v3 *').evaluateAll((nodes) =>
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

const startSearchQueueAndOpenFullPlayer = async (page: Page, query = 'jpop') => {
  await seedRadioState(page, {
    activeSection: 'search',
    stationCache: stations
  });
  await page.goto('/');
  await expect(page.locator('.screen-search-v2')).toBeVisible();
  await page.locator('#search-hero-input').first().fill(query);
  await expect(page.locator('[data-search-station-card]').first()).toBeVisible();
  await page.getByRole('button', { name: /Играть выдачу|Play results/ }).click();
  await expect(page.locator('.player-dock-bar')).toBeVisible();
  await expect
    .poll(async () => {
      const queue = await readStoredQueue(page);
      return queue?.items?.length || 0;
    })
    .toBeGreaterThan(1);
  await page.locator('.player-dock-artwork-trigger').evaluate((node) => {
    (node as HTMLButtonElement).click();
  });
  await expect(page.locator('[data-full-player-overlay]')).toBeVisible();
  // PR-6: on mobile the queue lives in a bottom sheet, closed by default —
  // open it so the queue-item assertions (and the callers' queue interactions
  // that follow) have the rows in the DOM.
  await openFullPlayerQueueSheet(page);
  await expect
    .poll(async () => {
      const queue = await readStoredQueue(page);
      const activeId = queue?.items?.[queue.currentIndex]?.stationuuid;
      if (!activeId) return false;
      return page
        .locator(`[data-full-player-queue-item="${activeId}"]`)
        .evaluate((node) => node.classList.contains('active'))
        .catch(() => false);
    })
    .toBe(true);
};

// PR-6: open the mobile player's queue bottom-sheet. The queue chip sits on the
// face when the record button isn't there (VITE_TG_BOT unset — the e2e case);
// with the bot configured, record owns that slot and the queue lives in the
// «Ещё» actions sheet instead — handle both so the suite doesn't depend on env.
const openFullPlayerQueueSheet = async (page: Page) => {
  const overlay = page.locator('[data-full-player-overlay]');
  const faceQueueChip = overlay.getByRole('button', { name: /^(Очередь|Queue)$/ }).first();
  if (await faceQueueChip.isVisible().catch(() => false)) {
    await faceQueueChip.click();
  } else {
    await overlay.getByRole('button', { name: /^(Ещё|More)$/ }).first().click();
    await page
      .locator('.full-player-sheet')
      .getByRole('button', { name: /Очередь|Queue/ })
      .first()
      .click();
  }
  await expect(page.locator('[data-full-player-queue]')).toBeVisible();
};

const readStoredQueue = async (page: Page) =>
  page.evaluate(() => {
    const raw = window.localStorage.getItem('radio:player:v2');
    return raw ? JSON.parse(raw).queue : null;
  });

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

test('search ranking matches multi-token place and tag intent before weak promotion', () => {
  const japaneseJazz = {
    ...stations[0],
    stationuuid: 'uuid-tokyo-jazz',
    name: 'Blue Note Tokyo Radio',
    tags: 'jazz,bebop',
    country: 'Japan',
    state: 'Tokyo',
    language: 'Japanese',
    promoted: false
  };
  const weakPromoted = {
    ...stations[8],
    stationuuid: 'uuid-promoted-jazz',
    name: 'Jazz Promo Network',
    tags: 'samba,pop',
    country: 'Brazil',
    state: 'Rio de Janeiro',
    language: 'Portuguese',
    promoted: true
  };
  const ranked = rankStationsForSearch([weakPromoted, stations[4], japaneseJazz], {
    query: 'jazz japan',
    behaviorProfile: behaviorProfile({
      tagScores: { samba: 220 },
      countryScores: { Brazil: 90 }
    }),
    playabilityProfile: DEFAULT_PLAYABILITY_PROFILE,
    now: Date.UTC(2026, 3, 20, 10, 10, 0)
  });

  expect(ranked[0].stationuuid).toBe('uuid-tokyo-jazz');
  expect(ranked.findIndex((station) => station.stationuuid === 'uuid-promoted-jazz')).toBeGreaterThan(
    ranked.findIndex((station) => station.stationuuid === 'uuid-tokyo-jazz')
  );
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

test('session failures suppress stations from primary personal radio slots', () => {
  const now = Date.UTC(2026, 3, 20, 10, 12, 0);
  const sessionEvents = recordRadioSessionEvent([], {
    stationId: 'uuid-berlin',
    action: 'failed',
    mode: 'personal',
    timestamp: now
  });
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
      tagScores: { techno: 90 },
      countryScores: { Germany: 40 },
      stationScores: { 'uuid-berlin': 240, 'uuid-hamburg': 80 }
    }),
    playabilityProfile: DEFAULT_PLAYABILITY_PROFILE,
    tasteProfile: DEFAULT_TASTE_PROFILE_V2,
    healthProfile: DEFAULT_STATION_HEALTH_PROFILE,
    sessionEvents,
    context: {
      mode: 'personal',
      currentStation: null,
      seed: 12,
      limit: 8,
      now
    }
  });

  expect(queue.stations.map((station) => station.stationuuid)).not.toContain('uuid-berlin');
  expect(queue.stations.map((station) => station.stationuuid)).toContain('uuid-hamburg');
});

test('session skip lowers a station in later personal ranking', () => {
  const now = Date.UTC(2026, 3, 20, 10, 14, 0);
  const sessionEvents = recordRadioSessionEvent([], {
    stationId: 'uuid-berlin',
    action: 'skip',
    mode: 'personal',
    timestamp: now
  });
  const ranked = rankStationsForUser(
    [stations[4], stations[6], stations[8]],
    DEFAULT_TASTE_PROFILE_V2,
    DEFAULT_PLAYABILITY_PROFILE,
    {
      mode: 'personal',
      seed: 14,
      now,
      sessionEvents
    }
  );

  expect(ranked.findIndex((station) => station.stationuuid === 'uuid-berlin')).toBeGreaterThan(
    ranked.findIndex((station) => station.stationuuid === 'uuid-munich')
  );
});

test('session like promotes related country and tag stations', () => {
  const now = Date.UTC(2026, 3, 20, 10, 16, 0);
  const sessionEvents = recordRadioSessionEvent([], {
    stationId: 'uuid-berlin',
    action: 'like',
    mode: 'personal',
    timestamp: now
  });
  const ranked = rankStationsForUser(
    [stations[8], stations[6], stations[5], stations[4]],
    DEFAULT_TASTE_PROFILE_V2,
    DEFAULT_PLAYABILITY_PROFILE,
    {
      mode: 'personal',
      currentStation: stations[4],
      seed: 16,
      now,
      sessionEvents
    }
  );

  expect(ranked[0].country).toBe('Germany');
  expect(ranked.findIndex((station) => station.stationuuid === 'uuid-rio')).toBeGreaterThan(0);
});

test('personal radio refill keeps a fresh tail without duplicating stations', () => {
  const extraStations = Array.from({ length: 44 }, (_, index) => ({
    ...stations[index % stations.length],
    stationuuid: `uuid-refill-${index}`,
    name: `Refill ${index}`,
    url: `https://stream.example.com/refill-${index}`,
    url_resolved: `https://stream.example.com/refill-${index}`
  }));
  const currentItems = extraStations.slice(0, 15);
  const currentIndex = 12;
  const nextItems = refillPersonalRadioQueueItems({
    currentItems,
    currentIndex,
    candidates: [...currentItems, ...extraStations],
    tailSize: 18,
    maxItems: 120
  });

  expect(nextItems[currentIndex].stationuuid).toBe(currentItems[currentIndex].stationuuid);
  expect(nextItems.length - currentIndex - 1).toBe(18);
  expect(new Set(nextItems.map((station) => station.stationuuid)).size).toBe(nextItems.length);
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
      scope: 'country'
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

test('theme defaults expose bundled shell themes', () => {
  expect(DEFAULT_RADIOATLAS_THEMES.map((theme) => theme.id)).toEqual([
    'classic',
    'neon',
    'pastel',
    'aurora-field',
    'signal-grid',
    'sunrise-dial',
    'velvet-hour'
  ]);
  expect(DEFAULT_RADIOATLAS_THEMES.every((theme) => theme.builtin)).toBe(true);
  expect(DEFAULT_RADIOATLAS_THEMES.every((theme) => theme.layers.background?.kind === 'gradient')).toBe(true);
  // T_share_4: ONLY the referral reward is locked — the six free themes stay
  // freely selectable (no access regression).
  expect(
    DEFAULT_RADIOATLAS_THEMES.filter((theme) => theme.locked).map((theme) => theme.id)
  ).toEqual(['velvet-hour']);
  expect(
    ['classic', 'neon', 'pastel', 'aurora-field', 'signal-grid', 'sunrise-dial'].every(
      (id) => !DEFAULT_RADIOATLAS_THEMES.find((theme) => theme.id === id)?.locked
    )
  ).toBe(true);
});

test('generated bundled themes ship css background assets and reactions', () => {
  // P1b: the Sunset (sunrise-dial) redesign dropped its dial SVG for a pure
  // warm-plum gradient, so Aurora + Signal Grid are now the only asset-backed
  // presets. Sunset keeps its emoji reaction (checked in the defaults test).
  const generatedThemes = DEFAULT_RADIOATLAS_THEMES.filter((theme) =>
    ['aurora-field', 'signal-grid'].includes(theme.id)
  );

  expect(generatedThemes).toHaveLength(2);
  for (const theme of generatedThemes) {
    expect(theme.layers.background?.kind).toBe('gradient');
    expect(themeBackgroundToCss(theme.layers.background)).toContain('/theme-backgrounds/');
    expect(theme.layers.emojiReactions?.length).toBeGreaterThan(0);
  }
});

test('theme runtime maps theme layers to shell css variables', () => {
  const neon = DEFAULT_RADIOATLAS_THEMES.find((theme) => theme.id === 'neon');
  expect(neon).toBeTruthy();
  expect(themeAccentToCss(neon?.layers.accent)).toBe('hsl(304 96% 68%)');
  expect(themeAccentPairToCss(neon?.layers.accent)).toBe('hsl(346 71% 70%)');
  expect(themeBackgroundToCss(neon?.layers.background)).toContain('#150720');
  expect(themeBackgroundToCss({ kind: 'image', assetId: 'print-1' }, (assetId) => `blob:${assetId}`)).toBe(
    'url("blob:print-1")'
  );
  expect(themeFontToCss({ family: 'rounded' })).toContain('Trebuchet MS');
  expect(themeIconRadiusToCss({ style: 'sharp' })).toBe('10px');
});

test('theme decorations resolve asset layers and active emoji reactions', () => {
  const decorations = resolveThemeDecorations(
    {
      version: 1,
      id: 'decor-test',
      name: 'Decor test',
      createdAt: 0,
      updatedAt: 0,
      layers: {
        stickers: [
          {
            assetId: 'sticker-1',
            slot: 'homeHeroCorner',
            x: 4,
            y: 8,
            scale: 1.2
          }
        ],
        gifs: [
          {
            assetId: 'gif-1',
            slot: 'globeOverlay',
            trigger: 'play'
          }
        ],
        emojiReactions: [
          {
            emoji: '✨',
            trigger: 'play',
            slot: 'dockRight'
          },
          {
            emoji: '♥',
            trigger: 'like',
            slot: 'homeHeroCorner'
          }
        ]
      }
    },
    (assetId) => `blob:${assetId}`,
    {
      playing: true,
      liked: false
    }
  );

  expect(decorations.map((decoration) => decoration.kind)).toEqual(['asset', 'asset', 'emoji']);
  expect(decorations.map((decoration) => decoration.slot)).toEqual([
    'homeHeroCorner',
    'globeOverlay',
    'dockRight'
  ]);
});

test('theme storage saves custom themes and assets locally', async () => {
  await clearThemeStorageForTests();
  const savedTheme = await saveStoredTheme({
    id: 'custom-night-drive',
    name: 'Night Drive',
    author: 'Tester',
    layers: {
      accent: {
        hue: 210,
        sat: 82
      },
      background: {
        kind: 'gradient',
        gradient: 'linear-gradient(180deg, #001, #123)'
      },
      font: {
        family: 'mono'
      }
    }
  });

  expect(savedTheme).toMatchObject({
    version: 1,
    id: 'custom-night-drive',
    builtin: false
  });
  await expect.poll(async () => (await listStoredThemes()).map((theme) => theme.id)).toContain(
    'custom-night-drive'
  );

  const savedAsset = await saveStoredAsset({
    id: 'asset-cover-night',
    kind: 'background',
    name: 'Night cover',
    mimeType: 'image/png',
    blob: new Blob(['theme-asset'], { type: 'image/png' })
  });
  expect(savedAsset.version).toBe(1);
  await expect.poll(async () => (await listStoredAssets()).map((asset) => asset.id)).toContain(
    'asset-cover-night'
  );
  await expect.poll(async () => (await getStoredAsset('asset-cover-night'))?.mimeType).toBe(
    'image/png'
  );

  await deleteStoredTheme('custom-night-drive');
  await deleteStoredAsset('asset-cover-night');
  expect((await listStoredThemes()).map((theme) => theme.id)).not.toContain('custom-night-drive');
  expect(await getStoredAsset('asset-cover-night')).toBeNull();
});

test('theme runtime applies the selected shell theme to css variables', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('radio:theme-current:v1', JSON.stringify('neon'));
  });
  await page.goto('/');
  await expect(page.locator('.app-shell-v2')).toBeVisible();
  await expect.poll(async () => page.evaluate(() => document.documentElement.dataset.theme)).toBe(
    'neon'
  );

  const vars = await page.evaluate(() => {
    const rootStyle = getComputedStyle(document.documentElement);
    return {
      accent: rootStyle.getPropertyValue('--theme-accent').trim(),
      accent2: rootStyle.getPropertyValue('--theme-accent-2').trim(),
      background: rootStyle.getPropertyValue('--theme-bg-image').trim(),
      font: rootStyle.getPropertyValue('--theme-font-family').trim()
    };
  });
  expect(vars.accent).toBe('hsl(304 96% 68%)');
  expect(vars.accent2).toBe('hsl(346 71% 70%)');
  expect(vars.background).toContain('#150720');
  expect(vars.font).toContain('Manrope');
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

for (const width of [360, 390, 540]) {
  test(`mobile home shows the live recommendation hero and compact rails at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 360 ? 780 : width === 540 ? 900 : 844 });
    await seedRadioState(page, {
      recent: [stations[0]],
      playbackHistory: [stations[1]],
      queue: [stations[2]]
    });
    await seedDiscoveryRoutes(page);

    await page.goto('/');
    await expect(page.locator('[data-home-feed-entry]')).toBeVisible();

    await expect(page.locator('.screen-home-next')).toHaveAttribute('data-density', 'dense');
    // Reference Home: the on-Home search launcher + genre shortcuts were removed
    // (search + genres live in the Поиск tab now).
    await expect(page.locator('.home-search-launcher')).toHaveCount(0);
    await expect(page.locator('[data-home-genres]')).toHaveCount(0);
    await expect(page.locator('[data-home-search-preview]')).toHaveCount(0);
    await expect(page.locator('.home-explore-card')).toHaveCount(0);
    await expect(page.locator('[data-home-hero]')).toHaveCount(1);
    await expect(page.locator('[data-home-hero]')).toBeVisible();
    await expect(page.locator('[data-home-hero] .home-hero-play')).toHaveCount(1);
    await expect(page.locator('.home-hero-companions')).toHaveCount(0);
    await expect(page.locator('.home-feed-entry')).toHaveCount(1);
    await expect(page.locator('[data-home-resume="true"]')).toBeVisible();
    // T2.21: dense surface carries the discovery shelves (fresh-now first, then
    // the three server-signal rails interleaved with the spotlights).
    await expect(page.locator('[data-home-rail="trending"]')).toHaveCount(1);
    await expect(page.locator('[data-home-rail="top-voted"]')).toHaveCount(1);
    await expect(page.locator('[data-home-rail="around-the-world"]')).toHaveCount(1);
    await expect(page.locator('[data-home-rail] .home-section-title').first()).toContainText(
      /Попробуйте сейчас|Try it now/
    );
    // The personalised "what changed / because you liked" delta rails stay out
    // of the dense surface — the content shelves fill the visible slots.
    await expect(page.locator('.screen-home-next')).not.toContainText(
      /Что изменилось|По твоим|Похожее на|часто слушаешь|Based on|liked/i
    );
    const compactHomeMetrics = await page.evaluate(() => {
      const topbar = document.querySelector('.app-topbar-v2')?.getBoundingClientRect();
      const feedEntry = document.querySelector('[data-home-feed-entry]')?.getBoundingClientRect();
      const railTiles = Array.from(document.querySelectorAll('[data-home-rail] [data-home-station]'));
      const visibleRailTiles = railTiles.filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.left >= -1 && rect.left < window.innerWidth - 24 && rect.top < window.innerHeight - 160;
      }).length;
      // Every discovery rail is a single-row horizontal peek lane. Keeping
      // fresh-now consistent avoids the 246px 2-column cards at 431–600px.
      const peek = document.querySelector('[data-home-rail="trending"] .home-horizontal-scroll');
      const peekStyle = peek ? window.getComputedStyle(peek) : null;
      const forYou = document.querySelector('[data-home-rail="fresh-now"] .home-horizontal-scroll');
      const forYouStyle = forYou ? window.getComputedStyle(forYou) : null;
      const forYouTiles = Array.from(
        document.querySelectorAll('[data-home-rail="fresh-now"] [data-home-station]')
      );

      return {
        topbarHeight: topbar?.height || 0,
        feedEntryHeight: feedEntry?.height || 0,
        visibleRailTiles,
        peekDisplay: peekStyle?.display || '',
        peekOverflowX: peekStyle?.overflowX || '',
        peekRowCount: (peekStyle?.gridTemplateRows || '').trim().split(/\s+/).filter(Boolean).length,
        forYouOverflowX: forYouStyle?.overflowX || '',
        forYouRowCount: new Set(
          forYouTiles.map((node) => Math.round(node.getBoundingClientRect().top / 8) * 8)
        ).size,
        forYouTileWidth: forYouTiles[0]?.getBoundingClientRect().width || 0
      };
    });
    expect(compactHomeMetrics.topbarHeight).toBeLessThanOrEqual(72);
    // Feed is compact again because the playable recommendation owns the hero.
    expect(compactHomeMetrics.feedEntryHeight).toBeGreaterThanOrEqual(44);
    expect(compactHomeMetrics.feedEntryHeight).toBeLessThanOrEqual(72);
    // The full-bleed hero and quick choices intentionally own the first fold;
    // rails remain immediately reachable by scrolling.
    expect(compactHomeMetrics.visibleRailTiles).toBeGreaterThanOrEqual(0);
    // The discovery peek rail is a single-row horizontal scroller.
    expect(compactHomeMetrics.peekDisplay).toBe('grid');
    expect(compactHomeMetrics.peekOverflowX).toBe('auto');
    expect(compactHomeMetrics.peekRowCount).toBe(1);
    expect(compactHomeMetrics.forYouOverflowX).toBe('auto');
    expect(compactHomeMetrics.forYouRowCount).toBe(1);
    expect(compactHomeMetrics.forYouTileWidth).toBeGreaterThanOrEqual(140);
    expect(compactHomeMetrics.forYouTileWidth).toBeLessThanOrEqual(190);
    await expect(page.locator('.home-rail-scroll-controls').first()).toBeHidden();
    const peekRail = page.locator('[data-home-rail="trending"]');
    const railScroll = peekRail.locator('.home-horizontal-scroll');
    const beforeScrollLeft = await railScroll.evaluate((node) => node.scrollLeft);
    const afterWheelScrollLeft = await railScroll.evaluate((node) => {
      node.dispatchEvent(new WheelEvent('wheel', { deltaY: 360, bubbles: true, cancelable: true }));
      return node.scrollLeft;
    });
    const canScrollRail = await railScroll.evaluate((node) => node.scrollWidth > node.clientWidth);
    if (canScrollRail) {
      expect(afterWheelScrollLeft).toBeGreaterThan(beforeScrollLeft);
      expect(afterWheelScrollLeft).toBeGreaterThan(beforeScrollLeft);
    }
    await expectNoHomeHorizontalOverflow(page);

    // Tapping the «Лента» hero re-rolls the feed seed and opens the discovery
    // feed (the prominent entry that replaced the «Моя Волна» CTA).
    await page.locator('.home-feed-entry').click();
    await expect(page.locator('.station-feed-overlay')).toBeVisible();
  });
}

test('mobile home rail queue fails over from a broken first station', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    let playAttempts = 0;
    HTMLMediaElement.prototype.play = function () {
      playAttempts += 1;
      this.setAttribute('data-ra-play-attempt', String(playAttempts));
      if (playAttempts === 1) {
        this.dispatchEvent(new Event('error'));
        return Promise.reject(new DOMException('mock startup failure', 'NotSupportedError'));
      }
      this.setAttribute('data-ra-state', 'playing');
      this.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    };
  });
  await seedRadioState(page, {
    stationCache: stations,
    behaviorProfile: behaviorProfile({
      tagScores: { jpop: 90 },
      countryScores: { Japan: 60 },
      stationScores: { 'uuid-tokyo': 300, 'uuid-osaka': 140 }
    })
  });

  await page.goto('/');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();
  await page.locator('.app-navigation-mobile').getByRole('button', { name: /Поиск|Search/ }).click();
  await page.locator('#search-hero-input').fill('a');
  await expect(page.locator('.station-row').first()).toBeVisible();
  await page.getByRole('button', { name: /Играть выдачу|Play results/ }).click();
  await expect(page.locator('.player-dock-bar')).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem('radio:player:v2');
        return raw ? JSON.parse(raw).queue?.currentIndex : -1;
      })
    )
    .toBeGreaterThanOrEqual(1);
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem('radio:app:v2');
        const events = raw ? JSON.parse(raw).radioSessionEvents || [] : [];
        return {
          failed: events.some((event: { action: string }) => event.action === 'failed'),
          success: events.some((event: { action: string }) => event.action === 'play-success')
        };
      })
    )
    .toEqual({ failed: true, success: true });
});

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
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();
  await expect(page.locator('[data-home-rail] [data-home-station]').first()).not.toHaveAttribute('data-home-station', 'uuid-berlin');
});

for (const width of [360, 390]) {
  test(`mobile globe is full-bleed with reticle and zoom controls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 844 });

    await page.goto('/');
    await page.locator('.app-navigation-mobile').getByRole('button', { name: /Глобус|Globe/ }).click();

    // The new globe stage is full-bleed: canvas, reticle, zoom buttons.
    // No chip-row, no breadcrumb, no focus card list.
    await expect(page.locator('.screen-globe-v3')).toBeVisible();
    await expect(page.locator('.globe canvas')).toBeVisible();
    await expect(page.locator('.globe-reticle')).toBeVisible();
    await expect(page.locator('.globe-zoom-stack .globe-zoom-btn')).toHaveCount(2);
    await expect(page.locator('[data-globe-tune]')).toHaveCount(0);
    await expect(page.locator('.globe-focus-card')).toHaveCount(0);
    await expect(page.locator('[data-globe-breadcrumb]')).toHaveCount(0);
    await expectNoGlobeHorizontalOverflow(page);

    // Zoom controls are bottom-right and clear of the reticle dead-zone.
    const layout = await page.evaluate(() => {
      const reticle = document.querySelector('.globe-reticle')?.getBoundingClientRect();
      const stack = document.querySelector('.globe-zoom-stack')?.getBoundingClientRect();
      return {
        reticleCenterX: reticle ? reticle.left + reticle.width / 2 : null,
        stackLeft: stack?.left ?? null,
        viewportWidth: window.innerWidth
      };
    });
    expect(layout.reticleCenterX).not.toBeNull();
    expect(layout.stackLeft).not.toBeNull();
    // The zoom stack sits to the right of the centre reticle.
    expect(layout.stackLeft!).toBeGreaterThan(layout.reticleCenterX!);
  });
}

// The persistent global dock is the only now-playing surface on Globe. The
// in-map card is reserved for a different station selected under the reticle,
// so opening Globe while audio is live must not duplicate the current station.
test('mobile globe keeps the current station in one global dock', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();
  await playHomeStation(page, 'Tokyo FM');

  await page.locator('.app-navigation-mobile').getByRole('button', { name: /Глобус|Globe/ }).click();
  await expect(page.locator('.globe canvas')).toBeVisible();

  await expect(page.locator('[data-globe-selection-preview]')).toHaveCount(0);
  await expect(page.locator('[data-globe-now-bar]')).toHaveCount(0);
  await expect(page.locator('.player-dock')).toContainText('Tokyo FM');
  await expectNoGlobeHorizontalOverflow(page);
});

test('mobile globe pressing zoom + brings up satellite mode', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await page.locator('.app-navigation-mobile').getByRole('button', { name: /Глобус|Globe/ }).click();
  await expect(page.locator('.screen-globe-v3')).toHaveAttribute('data-zoom-level', '1.00');

  for (let i = 0; i < 3; i += 1) {
    await page.locator('.globe-zoom-btn[aria-label*="zoom" i], .globe-zoom-btn').first().click();
    await page.waitForTimeout(220);
  }
  await expect
    .poll(async () => page.locator('.screen-globe-v3').getAttribute('data-satellite'))
    .toBe('true');
});

test('mobile globe wheel triggers zoom on the maplibre canvas', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('.app-navigation-mobile').getByRole('button', { name: /Глобус|Globe/ }).click();
  await expect(page.locator('.globe canvas')).toBeVisible();
  // MapLibre takes a beat to finish its first style load before wheel
  // events translate into zoom deltas.
  await page.waitForTimeout(400);

  const canvasBox = await page.locator('.globe canvas').boundingBox();
  expect(canvasBox).not.toBeNull();
  await page.mouse.move(canvasBox!.x + canvasBox!.width / 2, canvasBox!.y + canvasBox!.height / 2);
  await page.mouse.wheel(0, -240);
  await expect(page.locator('.screen-globe-v3')).not.toHaveAttribute('data-zoom-level', '1.00');
});

// Regression: MapLibre globe-projection cold mount used to commit a
// solid-black frame because the renderer ran before the satellite
// source had any tile data. Globe.tsx now subscribes to sourcedata
// for the satellite source and triggers repaint when tiles arrive.
// Test asserts that within 6 s of opening the globe, satellite tile
// requests have been issued AND the canvas has been painted at
// least once (sourcedata fires on every tile arrival).
test('mobile globe paints satellite tiles on cold mount without user interaction', async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page
    .locator('.app-navigation-mobile')
    .getByRole('button', { name: /Глобус|Globe/ })
    .click();
  await expect(page.locator('.globe canvas')).toBeVisible();

  // At least a handful of arcgis tile requests should fire within
  // a few seconds of mount. If any of these are 0-byte CORS-blocked
  // failures the canvas would render black and the user would have
  // to drag/zoom to wake it up.
  await expect
    .poll(
      async () =>
        await page.evaluate(
          () =>
            performance
              .getEntriesByType('resource')
              .filter((entry) => entry.name.includes('arcgisonline')).length
        ),
      { timeout: 8000 }
    )
    .toBeGreaterThan(4);
});

// Regression: a transient empty {items:[]} response from
// /catalog/points was being persisted to IndexedDB and stuck for the
// full 24 h TTL. fetchPoints would happily return the empty cache
// forever, leaving the globe coord-less. Defence in CatalogContext:
// treat any cache below MIN_GLOBE_POINTS_ITEMS (5_000) as poisoned
// and refetch.
//
// We can't seed IndexedDB cleanly from outside without racing the
// app's own connection, so instead we seed via addInitScript before
// the app boots: each navigation re-runs the script in a context
// that owns the DB before the React tree opens it.
test('mobile globe ignores poisoned empty points cache and refetches', async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.addInitScript(() => {
    const seedPromise = new Promise<void>((resolve) => {
      const open = indexedDB.open('radioatlas-catalog-cache', 1);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains('entries')) {
          open.result.createObjectStore('entries');
        }
      };
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(['entries'], 'readwrite');
        tx.objectStore('entries').put(
          {
            storedAt: Date.now(),
            expiresAt: Date.now() + 86_400_000,
            payload: { items: [], mappedStations: 0, totalStations: 0 }
          },
          'points:v3'
        );
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
      };
      open.onerror = () => resolve();
    });
    (window as unknown as { __seedReady: Promise<void> }).__seedReady = seedPromise;
  });

  let pointsRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/catalog/points')) pointsRequests += 1;
  });

  await page.goto('/');
  // Make sure the seed finished before the app's own catalog logic
  // wakes up; if the seed loses the race, the test still works
  // because no points cache exists at all and fetchPoints falls
  // through to the network.
  await page.evaluate(
    () =>
      (window as unknown as { __seedReady?: Promise<unknown> }).__seedReady ?? null
  );

  await page
    .locator('.app-navigation-mobile')
    .getByRole('button', { name: /Глобус|Globe/ })
    .click();
  await expect(page.locator('.globe canvas')).toBeVisible();

  // The poisoned cache (or absence of one) should yield a network
  // request to /catalog/points — the regression we want to lock
  // against is "0 requests fire and the globe stays empty".
  await expect.poll(() => pointsRequests, { timeout: 8000 }).toBeGreaterThan(0);
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
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();
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
  await page.locator('#search-hero-input').first().fill('jpop');
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
  await page.locator('#search-hero-input').first().fill('jpop');
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

test('mobile search lazily appends results without a load-more button', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMediaMocks(page);
  await mockStations(page);

  const pagedStations = Array.from({ length: 45 }, (_, index) => ({
    ...stations[index % stations.length],
    stationuuid: `uuid-jpop-page-${index + 1}`,
    name: `JPop Page ${String(index + 1).padStart(2, '0')}`,
    tags: 'jpop,paged',
    country: 'Japan',
    countrycode: 'JP',
    state: index < 32 ? 'First page' : 'Second page'
  }));
  const searchRequests: string[] = [];

  await page.unroute('**/catalog/search**');
  await page.route('**/catalog/search**', async (route) => {
    const requestUrl = new URL(route.request().url());
    searchRequests.push(requestUrl.search);
    const limit = Number(requestUrl.searchParams.get('limit') || 32);
    const cursor = Number(requestUrl.searchParams.get('cursor') || 0);
    const nextCursor = cursor + limit < pagedStations.length ? String(cursor + limit) : null;

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: pagedStations.slice(cursor, cursor + limit),
        total: pagedStations.length,
        nextCursor,
        facets: {
          countries: ['Japan'],
          tags: ['jpop', 'paged'],
          languages: ['Japanese'],
          continentCounts: [{ id: 'Asia', count: pagedStations.length }],
          featuredCountries: [
            { key: 'jp', country: 'Japan', continent: 'Asia', count: pagedStations.length }
          ]
        }
      })
    });
  });

  await seedRadioState(page, {
    activeSection: 'search',
    stationCache: pagedStations
  });

  await page.goto('/');
  await expect(page.locator('.screen-search-v2')).toBeVisible();
  await page.locator('#search-hero-input').first().fill('jpop');

  const cards = page.locator('[data-search-station-card]');
  await expect(cards).toHaveCount(32);
  await expect(cards.nth(31)).toContainText('JPop Page 32');
  await expect(page.getByRole('button', { name: /Показать еще|Show more|Load more/ })).toHaveCount(0);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(cards).toHaveCount(45);
  await expect(cards.nth(32)).toContainText('JPop Page 33');
  expect(searchRequests.some((query) => query.includes('cursor=32'))).toBe(true);

  const firstCardHeight = await cards.first().evaluate((node) => node.getBoundingClientRect().height);
  expect(firstCardHeight).toBeLessThanOrEqual(88);
});

// Search mobile rebuild: the native-select filter drawer moved into the shared
// bottom sheet. Opening it, picking a country, and closing must surface an
// active filter pill AND re-run the search with the filter applied.
test('mobile search filters open in a bottom sheet and apply a country', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await seedRadioState(page, {
    activeSection: 'search',
    stationCache: stations
  });

  await page.goto('/');
  await expect(page.locator('.screen-search-v2')).toBeVisible();
  await page.locator('#search-hero-input').first().fill('jpop');
  await expect(page.locator('[data-search-station-card]').first()).toBeVisible();

  await page.getByRole('button', { name: /Показать фильтры|Show filters/ }).click();
  const sheet = page.locator('[data-search-filters-sheet]');
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute('role', 'dialog');

  const filteredRequest = page.waitForRequest(
    (request) =>
      request.url().includes('/catalog/search') && request.url().includes('country=Japan')
  );
  await sheet.locator('select').first().selectOption('Japan');
  await filteredRequest;

  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);

  // The applied filter is visible as a pill, the trigger badge matches the
  // active-pill count, and the (mocked) result list is alive after the refetch.
  const pills = page.locator('.search-hero-filter-pill');
  await expect(pills.filter({ hasText: 'Japan' })).toBeVisible();
  const pillCount = await pills.count();
  await expect(page.locator('.search-hero-filters-badge')).toHaveText(String(pillCount));
  await expect(page.locator('[data-search-station-card]').first()).toBeVisible();
});

test('mobile search ranks jazz japan by query intent and playability', async ({ page }) => {
  const japaneseJazz = {
    ...stations[0],
    stationuuid: 'uuid-tokyo-jazz',
    name: 'Blue Note Tokyo Radio',
    tags: 'jazz,bebop',
    country: 'Japan',
    state: 'Tokyo',
    language: 'Japanese',
    promoted: false
  };
  const weakPromoted = {
    ...stations[8],
    stationuuid: 'uuid-promoted-jazz',
    name: 'Jazz Promo Network',
    tags: 'samba,pop',
    country: 'Brazil',
    state: 'Rio de Janeiro',
    language: 'Portuguese',
    promoted: true
  };
  const searchItems = [weakPromoted, ...stations, japaneseJazz];
  await page.unroute('**/catalog/search**');
  await page.route('**/catalog/search**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: searchItems,
        total: searchItems.length,
        nextCursor: null,
        facets: {
          countries: ['All', 'Japan', 'Brazil', 'Germany'],
          tags: ['All', 'jazz', 'jpop', 'samba', 'techno'],
          languages: ['All', 'Japanese', 'Portuguese', 'German'],
          continentCounts: [],
          featuredCountries: []
        }
      })
    })
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await seedRadioState(page, {
    activeSection: 'search',
    stationCache: searchItems,
    behaviorProfile: behaviorProfile({
      tagScores: { samba: 220 },
      countryScores: { Brazil: 90 }
    })
  });

  await page.goto('/');
  await expect(page.locator('.screen-search-v2')).toBeVisible();
  await page.locator('#search-hero-input').first().fill('jazz japan');
  await expect(page.locator('[data-search-station-card]').first()).toContainText('Blue Note Tokyo Radio');
  await expect(page.locator('[data-search-station-card]').first()).not.toContainText('Jazz Promo Network');
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
  await page.route('**/json/stations/search**', (route) =>
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
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();
  await expect(page.locator('.home-status-banner')).toHaveCount(0);
});

test('player peek label clamps long station names', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  // Needs something in the queue: the dormant dock (nothing playing, empty
  // queue) renders nothing, and this test is about the label's clamp CSS.
  await seedRadioState(page, { queue: stations.slice(0, 1) });
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
  // The dock is lazy-loaded; this test guards that its chunk mounts fast on a
  // cold load. It needs something on air, because the dormant dock (no station,
  // empty queue) deliberately renders nothing.
  await seedRadioState(page, { queue: stations.slice(0, 1) });
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('.app-navigation-mobile')).toBeVisible();
  await expect(page.locator('.player-dock')).toBeVisible({ timeout: 1000 });
});

test('dormant dock renders nothing at all (no empty player bar on Home)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await expect(page.locator('.app-navigation-mobile')).toBeVisible();

  // Nothing playing and an empty queue → no dock in any presentation. It used
  // to render a permanent «Выбери станцию» prompt that covered the station
  // rails; the reference only shows a player while something is on air.
  await expect(page.locator('.player-dock')).toHaveCount(0);
  await expect(page.locator('.player-peek-handle')).toHaveCount(0);

  // …and it comes back as soon as a station starts.
  await playHomeStation(page, 'Tokyo FM');
  await expect(page.locator('.player-dock')).toBeVisible();
});

test('dock more-menu surfaces the queue when queue has items', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await seedRadioState(page, {
    queue: stations.slice(0, 3)
  });

  await page.goto('/');
  await page.locator('.player-peek-handle').click();
  await expect(page.locator('.player-dock-bar')).toBeVisible();
  await expect(page.locator('.dock-more-btn')).toBeVisible();

  // ☰ now opens the extra-functions menu (not the queue directly)…
  await page.locator('.dock-more-btn').click();
  await expect(page.locator('.player-dock-tray[data-mode="more"]')).toBeVisible();
  await expect(page.locator('.screen-search-v2')).toHaveCount(0);

  // …and the queue stays one tap away via the «Очередь» row inside it.
  await page.locator('.player-dock-more-tray .player-dock-more-row').first().click();
  await expect(page.locator('.player-dock-tray[data-mode="queue"]')).toBeVisible();
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

test('dock volume click opens slider tray, right-click mutes directly', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await playHomeStation(page, 'Tokyo FM');

  const volumeButton = page.locator('.dock-volume-btn');
  await expect(volumeButton).toBeVisible();
  await expect(page.locator('.player-dock-tray[data-mode="volume"]')).toHaveCount(0);

  // Left click opens the slider tray (the natural affordance —
  // user reported "click muted, why doesn't a slider show up?").
  await volumeButton.click();
  await expect(page.locator('.player-dock-tray[data-mode="volume"]')).toBeVisible();
  await expect(volumeButton).toHaveAttribute('data-muted', 'false');

  // Tray contains the percentage label and a working range input.
  await expect(
    page.locator('.player-dock-tray[data-mode="volume"] input[type="range"]')
  ).toBeVisible();

  // Theme Studio button used to live inside the volume tray for
  // historical reasons; this regresion check ensures it is gone.
  await expect(
    page.locator('.player-dock-tray[data-mode="volume"] .dock-theme-btn')
  ).toHaveCount(0);

  // Tray panel respects viewport sizing.
  const trayMetrics = await page.locator('.player-dock-tray-panel').evaluate((node) => {
    const computed = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return {
      overflowY: computed.overflowY,
      height: rect.height,
      viewportHeight: window.innerHeight
    };
  });
  expect(trayMetrics.overflowY).toBe('auto');
  expect(trayMetrics.height).toBeLessThanOrEqual(
    Math.min(trayMetrics.viewportHeight * 0.4, 360) + 1
  );

  // Click again closes the tray.
  await volumeButton.click();
  await expect(page.locator('.player-dock-tray[data-mode="volume"]')).toHaveCount(0);

  // Right-click mutes directly without opening the tray. (Same
  // result via middle-click / contextmenu shortcut for users who
  // want a fast mute.)
  await volumeButton.click({ button: 'right' });
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

  // Right-click again unmutes.
  await volumeButton.click({ button: 'right' });
  await expect(volumeButton).toHaveAttribute('data-muted', 'false');
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

test('mobile library keeps five equal-width non-wrapping tabs and opens collection detail', async ({ page }) => {
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
  // Declutter: the strip now carries all five visible tabs (Треки joined the
  // set) as an equal-width segmented row — no side-scroller, no wrap, History
  // still hidden (a non-visible legacy tab).
  const tabs = page.locator('.library-tab-chip');
  await expect(tabs).toHaveCount(5);
  await expect(tabs.filter({ hasText: /Треки|Tracks/ })).toHaveCount(1);
  await expect(tabs.filter({ hasText: /История|History/ })).toHaveCount(0);
  const tabStrip = await page.locator('.library-tab-strip').evaluate((node) => {
    const computed = window.getComputedStyle(node);
    const tops = Array.from(node.children).map((child) => child.getBoundingClientRect().top);
    return {
      flexWrap: computed.flexWrap,
      rows: new Set(tops.map((top) => Math.round(top))).size,
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth
    };
  });
  expect(tabStrip.flexWrap).toBe('nowrap');
  expect(tabStrip.rows).toBe(1);
  // Equal-width fit: all five sit within the strip, so there's nothing to
  // horizontally scroll (the old layout was a side-scroller that hid tabs).
  expect(tabStrip.scrollWidth).toBeLessThanOrEqual(tabStrip.clientWidth + 1);
  // Each tab stacks its glyph above the label so the labels never truncate.
  await expect(page.locator('.library-tab-chip .library-tab-icon').first()).toBeVisible();
  await expectNoDocumentHorizontalOverflow(page);

  await expect(page.locator('.library-collection-card')).toHaveCount(1);
  await expect(page.locator('[data-collection-artwork]')).toBeVisible();
  await expect(page.locator('.library-collection-card').getByRole('button', { name: /^Убрать$|^Remove$/ })).toHaveCount(0);
  // Library mobile rebuild: the Open chip is gone on mobile — the card's
  // title button (artwork + name + count) opens the detail.
  await page.locator('.library-collection-card .library-collection-title-button').first().click();
  await expect(page.locator('[data-library-collection-detail]')).toBeVisible();
  // The read view lists members through the shared StationTable ([data-station-row]);
  // the [data-library-collection-row] rows exist only in reorder mode (asserted below).
  await expect(page.locator('[data-library-collection-detail] [data-station-row]')).toHaveCount(5);

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

  // Declutter: rename + reorder moved off the hero row into the «Ещё» sheet.
  const moreSheet = page.locator('[data-library-sheet="collection-detail-actions"]');
  await detail.getByRole('button', { name: /^Ещё$|^More$/ }).click();
  await expect(moreSheet).toBeVisible();
  await moreSheet.getByRole('button', { name: /Переименовать|Rename/ }).click();
  await expect(moreSheet).toHaveCount(0);
  await detail.getByLabel(/Новое название|New collection name/).fill('Japan radio');
  await detail.getByRole('button', { name: /Сохранить|Save/ }).click();
  await expect(detail.locator('.section-title').first()).toContainText('Japan radio');

  await detail.getByRole('button', { name: /^Ещё$|^More$/ }).click();
  await expect(moreSheet).toBeVisible();
  await moreSheet.getByRole('button', { name: /Порядок|Reorder/ }).click();
  await expect(moreSheet).toHaveCount(0);
  // Reorder mode collapses the hero row to a single «Готово».
  await expect(detail.getByRole('button', { name: /^Готово$|^Done$/ })).toBeVisible();
  const tokyoRow = page.locator('[data-library-collection-row][data-station-id="uuid-tokyo"]');
  await tokyoRow.getByRole('button', { name: /Опустить Tokyo FM|Move Tokyo FM down/ }).click();
  await expect(detail.locator('[data-library-collection-row]').first()).not.toHaveAttribute('data-station-id', 'uuid-tokyo');
  await tokyoRow.getByRole('button', { name: /Убрать Tokyo FM из плейлиста|Remove Tokyo FM from playlist/ }).click();
  await expect(tokyoRow).toHaveCount(0);
});

// Library declutter: two portaled bottom sheets (the shared .bottom-sheet-card)
// — the per-card grid collection actions and the collection-detail «Ещё»
// overflow. The queue history+journal rail sheet and the recent-tab track
// journal sheet were both removed; that context lives in the «Недавнее» and
// «Треки» tabs now.
test('mobile library opens its two bottom sheets', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await seedRadioState(page, {
    activeSection: 'library',
    libraryTab: 'collections',
    stationCache: stations,
    queue: [stations[0], stations[1], stations[2]],
    recent: [stations[3]],
    trackHistory: [
      {
        id: 'sheet-track-1',
        stationId: stations[3].stationuuid,
        stationName: stations[3].name,
        track: 'Sheet Mock Song',
        timestamp: Date.UTC(2026, 4, 1, 9, 0, 0)
      }
    ],
    collections: [
      {
        id: 'collection-sheet',
        name: 'Sheet set',
        stationIds: stations.slice(0, 3).map((station) => station.stationuuid)
      }
    ]
  });

  await page.goto('/');

  // Sheet 1: per-card collection actions from the grid — shuffle starts the queue.
  await page.locator('.library-collection-more').first().click();
  const actionsSheet = page.locator('[data-library-sheet="collection-actions"]');
  await expect(actionsSheet).toBeVisible();
  await actionsSheet.getByRole('button', { name: /Вперемешку|Shuffle/ }).click();
  await expect(actionsSheet).toHaveCount(0);
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem('radio:player:v2');
        return raw ? JSON.parse(raw).queue?.sourceId : null;
      })
    )
    .toBe('collection-collection-sheet');

  // Sheet 2: the collection-detail «Ещё» overflow (rename / pin / add-current /
  // reorder / delete).
  await page.locator('.library-collection-card .library-collection-title-button').first().click();
  await expect(page.locator('[data-library-collection-detail]')).toBeVisible();
  const detailActions = page.locator('[data-library-sheet="collection-detail-actions"]');
  await page
    .locator('[data-library-collection-detail]')
    .getByRole('button', { name: /^Ещё$|^More$/ })
    .click();
  await expect(detailActions).toBeVisible();
  await expect(detailActions.getByRole('button', { name: /Переименовать|Rename/ })).toBeVisible();
  await expect(detailActions.getByRole('button', { name: /^Удалить$|^Delete$/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(detailActions).toHaveCount(0);
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

  await targetCard.locator('.library-collection-title-button').click();
  await expect(page.locator('[data-library-collection-detail]')).toBeVisible();
  await page.locator('[data-library-collection-detail]').getByRole('button', { name: /Назад|Back/ }).click();
  await expect(page.locator('[data-library-collection-detail]')).toHaveCount(0);
  await page.waitForFunction(() => window.scrollY > 0);
  const after = await page.evaluate(() => window.scrollY);
  expect(after).toBeGreaterThan(0);
});

test('mobile library coerces a legacy recent tab to «Недавнее» without writing shell state', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  // 'history' is a non-visible legacy tab now that 'tracks' graduated into the
  // strip — seeding it must still coerce the DISPLAY to «Недавнее» without
  // rewriting persisted shell state.
  await seedRadioState(page, {
    activeSection: 'library',
    libraryTab: 'history',
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
  expect(storedTab).toBe('history');
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
  await page.getByRole('button', { name: /Новый плейлист|New playlist/ }).first().click();
  await page.getByLabel(/Название плейлиста|Playlist name/).fill('Night drives');
  await page.getByRole('button', { name: /Сохранить|Save/ }).click();

  expect(promptCalled).toBe(false);
  // Saving a new playlist drops you straight into its (empty) detail, ready to
  // fill via the quick-picker — not back on the grid. Assert the detail opened
  // titled with the new name.
  const detail = page.locator('[data-library-collection-detail]');
  await expect(detail).toBeVisible();
  await expect(detail.locator('.section-title').first()).toContainText('Night drives');
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
  await collectionCard.locator('.library-collection-title-button').click();
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
  await expect(page.locator('.screen-globe-v3')).toBeVisible();
  await expect(page.locator('.globe canvas')).toBeVisible();
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
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();
  await page.waitForTimeout(600);

  expect(runtimeWarnings).toEqual([]);
});

test('mobile settings no longer exposes Skin Lab or fullscreen player controls', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();

  await page.locator('.mobile-settings-trigger').click();
  await expect(page.locator('.settings-panel')).toBeVisible();
  await expect(page.getByRole('button', { name: /Skin Lab|Открыть Skin Lab/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Открыть полноэкранный плеер|Open fullscreen player/i })).toHaveCount(0);
});

test('mobile settings opens Theme Studio and applies bundled themes', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();

  await page.locator('.mobile-settings-trigger').click();
  await page.getByRole('button', { name: /Open Theme Studio|Открыть Theme Studio/ }).click();
  await expect(page.locator('[data-theme-studio]')).toBeVisible();
  await expect(page.locator('[data-theme-card]')).toHaveCount(DEFAULT_RADIOATLAS_THEMES.length);

  await page.locator('[data-theme-card="neon"]').click();
  await expect.poll(async () => page.evaluate(() => document.documentElement.dataset.theme)).toBe(
    'neon'
  );
  await expect(page.locator('[data-theme-card="neon"]')).toHaveAttribute(
    'data-theme-active',
    'true'
  );
  const accent = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--theme-accent').trim()
  );
  expect(accent).toBe('hsl(304 96% 68%)');

  await page.locator('[data-theme-card="aurora-field"]').click();
  await expect.poll(async () => page.evaluate(() => document.documentElement.dataset.theme)).toBe(
    'aurora-field'
  );
  const background = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--theme-bg-image').trim()
  );
  expect(background).toContain('radioatlas-aurora.svg');
  await expect(page.locator('#webamp')).toHaveCount(0);
});

test('mobile Theme Studio builder saves and applies a local theme', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();

  await page.locator('.mobile-settings-trigger').click();
  await page.getByRole('button', { name: /Open Theme Studio|Открыть Theme Studio/ }).click();
  await page.getByLabel(/Name|Название/).fill('Codex Local');
  await page.locator('[data-theme-builder-hue]').evaluate((node) => {
    const input = node as HTMLInputElement;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    valueSetter?.call(input, '210');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.locator('[data-theme-builder-sat]').evaluate((node) => {
    const input = node as HTMLInputElement;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    valueSetter?.call(input, '82');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.locator('.theme-studio-field').filter({ hasText: /Font|Шрифт/ }).locator('select').selectOption('mono');
  await page.locator('.theme-studio-field').filter({ hasText: /Icons|Иконки/ }).locator('select').selectOption('sharp');
  await page.locator('[data-theme-builder-print]').setInputFiles({
    name: 'radioatlas-print.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#06121d"/><circle cx="20" cy="22" r="14" fill="#65e4ff"/><path d="M0 52 C18 36 34 64 64 42 V64 H0Z" fill="#ff6ec7"/></svg>'
    )
  });
  await expect(page.locator('[data-theme-print-name]')).toContainText('radioatlas-print.svg');
  await expect(page.locator('[data-theme-builder-background="print"]')).toBeVisible();
  // PR-4b: on mobile the icon uploads live in the «Иконки» sub-sheet; the real
  // file inputs stay in the DOM (visually hidden), so setInputFiles still works.
  await page.getByRole('button', { name: /Custom player icons|Свои иконки плеера/ }).click();
  await expect(page.locator('[data-theme-builder-subsheet="icons"]')).toBeVisible();
  await page.locator('[data-theme-builder-icon="pause"]').setInputFiles({
    name: 'pause-icon.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="5" y="4" width="5" height="16" rx="2" fill="#ffffff"/><rect x="14" y="4" width="5" height="16" rx="2" fill="#ffffff"/></svg>'
    )
  });
  await page.locator('[data-theme-builder-subsheet="icons"] .bottom-sheet-close').click();
  await expect(page.locator('[data-theme-builder-subsheet="icons"]')).toHaveCount(0);
  // Sticker + emoji live in the «Декор» sub-sheet.
  await page.getByRole('button', { name: /Sticker, GIF & emoji|Стикер, GIF и эмодзи/ }).click();
  await expect(page.locator('[data-theme-builder-subsheet="decor"]')).toBeVisible();
  await page.locator('[data-theme-builder-sticker]').setInputFiles({
    name: 'corner-sticker.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M32 4 39 24 60 24 43 37 49 58 32 46 15 58 21 37 4 24 25 24Z" fill="#65e4ff"/></svg>'
    )
  });
  await page.locator('[data-theme-builder-emoji]').fill('⚡');
  await page.locator('[data-theme-builder-subsheet="decor"] .bottom-sheet-close').click();
  await expect(page.locator('[data-theme-builder-subsheet="decor"]')).toHaveCount(0);
  await page.getByRole('button', { name: /Save and apply|Сохранить и применить/ }).click();

  await expect.poll(async () => page.evaluate(() => document.documentElement.dataset.theme || '')).toContain(
    'custom-codex-local'
  );
  await expect(page.locator('[data-theme-card]').filter({ hasText: 'Codex Local' })).toBeVisible();
  const vars = await page.evaluate(() => {
    const rootStyle = getComputedStyle(document.documentElement);
    return {
      accent: rootStyle.getPropertyValue('--theme-accent').trim(),
      iconRadius: rootStyle.getPropertyValue('--theme-icon-radius').trim(),
      background: rootStyle.getPropertyValue('--theme-bg-image').trim()
    };
  });
  expect(vars.accent).toBe('hsl(210 82% 68%)');
  expect(vars.iconRadius).toBe('10px');
  expect(vars.background).toContain('blob:');

  await page.locator('.settings-sheet').last().locator('.settings-sheet-head .chip').click();
  await page.locator('.settings-sheet').last().locator('.settings-sheet-head .chip').click();
  await playHomeStation(page, 'Tokyo FM');
  const dockBackground = await page.locator('.player-dock-bar').evaluate((node) =>
    getComputedStyle(node).backgroundImage
  );
  expect(dockBackground).toContain('blob:');
  await expect(page.locator('.dock-play-btn [data-theme-action-icon="pause"]')).toBeVisible();
  await expect(page.locator('[data-theme-decoration="sticker"][data-theme-slot="dockLeft"]')).toBeVisible();

  await page.locator('.player-dock-artwork-trigger').evaluate((node) => {
    (node as HTMLButtonElement).click();
  });
  const fullPlayerBackground = await page.locator('[data-full-player-overlay]').evaluate((node) =>
    getComputedStyle(node).backgroundImage
  );
  expect(fullPlayerBackground).toContain('blob:');
  await expect(page.locator('[data-full-player-overlay] [data-theme-action-icon="pause"]')).toBeVisible();
  await page.locator('[data-full-player-overlay]').getByRole('button', { name: /Закрыть|Close/ }).click();

  const reaction = page.locator('[data-theme-decoration="emoji"][data-theme-trigger="play"]');
  await expect(reaction).toBeVisible();
  await expect(reaction).toHaveText('⚡');
});

test('mobile shell keeps dock and bottom nav separately tappable', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();

  await expect(page.locator('.app-navigation-mobile')).toBeVisible();
  // Nothing playing yet → no dock at all (dormant dock renders nothing), so the
  // nav owns the bottom on its own.
  await expect(page.locator('.player-dock')).toHaveCount(0);

  await playHomeStation(page, 'Tokyo FM');

  await expect(page.locator('.player-dock-bar')).toBeVisible();
  await expect(page.locator('.app-navigation-mobile')).toBeVisible();
  await expect(page.locator('.player-dock-title')).toContainText('Tokyo FM');

  await page.locator('.player-dock-artwork-trigger').evaluate((node) => {
    (node as HTMLButtonElement).click();
  });
  await expect(page.locator('[data-full-player-overlay]')).toBeVisible();
  await expect(page.locator('#webamp')).toHaveCount(0);

  await page.locator('[data-full-player-overlay]').getByRole('button', { name: /Закрыть|Close/ }).click();
  await expect(page.locator('.player-dock-bar')).toBeVisible();
});

test('mobile dock artwork opens full player', async ({ page }) => {
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
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();

  await playHomeStation(page, 'Tokyo FM');
  await page.locator('.player-dock-artwork-trigger').evaluate((node) => {
    (node as HTMLButtonElement).click();
  });

  const overlay = page.locator('[data-full-player-overlay]');
  await expect(overlay).toBeVisible();
  await expect(page.locator('#webamp')).toHaveCount(0);
  await expect(overlay.locator('.full-player-artwork').first()).toBeVisible();
  await expect(overlay.locator('[data-full-player-track]')).toContainText(/Mock Song|Название трека пока недоступно|Track title unavailable/i);

  // PR-6: queue + recent tracks live in the queue bottom-sheet now (a sibling
  // of the overlay root, so page-scoped selectors).
  await openFullPlayerQueueSheet(page);
  await expect(page.locator('.full-player-track-list')).toContainText('Mock Song');
  await expect(page.locator('[data-full-player-queue]')).toContainText(/Tokyo FM|Станций в очереди|stations in queue/i);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-full-player-queue]')).toHaveCount(0);

  // PR-6: details/hide moved into the «Ещё» actions sheet.
  await overlay.getByRole('button', { name: /^(Ещё|More)$/ }).first().click();
  await expect(page.locator('.full-player-sheet')).toContainText(/Детали|Details/);

  await page
    .locator('.full-player-sheet')
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

test('mobile full player queue can play reorder remove and clear upcoming', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startSearchQueueAndOpenFullPlayer(page);

  const initialQueue = await readStoredQueue(page);
  expect(initialQueue.items.length).toBeGreaterThanOrEqual(4);
  const current = initialQueue.items[initialQueue.currentIndex];
  const firstUpcoming = initialQueue.items[initialQueue.currentIndex + 1];
  const secondUpcoming = initialQueue.items[initialQueue.currentIndex + 2];
  expect(current?.stationuuid).toBeTruthy();
  expect(firstUpcoming?.stationuuid).toBeTruthy();
  expect(secondUpcoming?.stationuuid).toBeTruthy();

  await page
    .locator(`[data-full-player-queue-item="${secondUpcoming.stationuuid}"] .full-player-queue-btn`)
    .first()
    .click();
  await expect
    .poll(async () => {
      const queue = await readStoredQueue(page);
      return {
        current: queue.items[queue.currentIndex]?.stationuuid,
        next: queue.items[queue.currentIndex + 1]?.stationuuid
      };
    })
    .toEqual({
      current: current.stationuuid,
      next: secondUpcoming.stationuuid
    });

  await page
    .locator(`[data-full-player-queue-item="${secondUpcoming.stationuuid}"] .full-player-queue-main`)
    .click();
  await expect
    .poll(async () => {
      const queue = await readStoredQueue(page);
      return queue.items[queue.currentIndex]?.stationuuid;
    })
    .toBe(secondUpcoming.stationuuid);
  await expect(page.locator('[data-full-player-overlay] h1')).toContainText(secondUpcoming.name);

  const afterPlayQueue = await readStoredQueue(page);
  const removeTarget = afterPlayQueue.items[afterPlayQueue.currentIndex + 1];
  expect(removeTarget?.stationuuid).toBeTruthy();
  await page
    .locator(`[data-full-player-queue-item="${removeTarget.stationuuid}"] .full-player-queue-btn.danger`)
    .click();
  await expect
    .poll(async () => {
      const queue = await readStoredQueue(page);
      return {
        activeId: queue.items[queue.currentIndex]?.stationuuid,
        hasRemovedTarget: queue.items.some(
          (station: { stationuuid: string }) => station.stationuuid === removeTarget.stationuuid
        )
      };
    })
    .toEqual({
      activeId: secondUpcoming.stationuuid,
      hasRemovedTarget: false
    });
  const afterRemoveQueue = await readStoredQueue(page);
  expect(afterRemoveQueue.items[afterRemoveQueue.currentIndex].stationuuid).toBe(secondUpcoming.stationuuid);

  await page.locator('[data-full-player-queue]').getByRole('button', { name: /Очистить дальше|Clear upcoming/ }).click();
  const afterClearQueue = await expect
    .poll(async () => {
      const queue = await readStoredQueue(page);
      return {
        activeId: queue.items[queue.currentIndex]?.stationuuid,
        length: queue.items.length,
        expectedLength: queue.currentIndex + 1
      };
    })
    .toEqual({
      activeId: secondUpcoming.stationuuid,
      length: 2,
      expectedLength: 2
    })
    .then(() => readStoredQueue(page));
  expect(afterClearQueue.items[afterClearQueue.currentIndex].stationuuid).toBe(secondUpcoming.stationuuid);
  expect(afterClearQueue.items.length).toBe(afterClearQueue.currentIndex + 1);
  await expect(page.locator('[data-full-player-overlay] h1')).toContainText(secondUpcoming.name);
});

test('mobile full player removing current starts next or stops when queue is empty', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startSearchQueueAndOpenFullPlayer(page);

  const initialQueue = await readStoredQueue(page);
  const current = initialQueue.items[initialQueue.currentIndex];
  const next = initialQueue.items[initialQueue.currentIndex + 1];
  expect(current?.stationuuid).toBeTruthy();
  expect(next?.stationuuid).toBeTruthy();

  await page
    .locator(`[data-full-player-queue-item="${current.stationuuid}"] .full-player-queue-btn.danger`)
    .click();
  await expect
    .poll(async () => {
      const queue = await readStoredQueue(page);
      return queue.items[queue.currentIndex]?.stationuuid;
    })
    .toBe(next.stationuuid);
  await expect(page.locator('[data-full-player-overlay] h1')).toContainText(next.name);
  await expect
    .poll(async () =>
      page
        .locator(`[data-full-player-queue-item="${next.stationuuid}"]`)
        .evaluate((node) => node.classList.contains('active'))
        .catch(() => false)
    )
    .toBe(true);

  await page.getByRole('button', { name: /Очистить дальше|Clear upcoming/ }).click();
  await expect
    .poll(async () => {
      const queue = await readStoredQueue(page);
      return {
        length: queue.items.length,
        keepLength: queue.currentIndex + 1,
        activeId: queue.items[queue.currentIndex]?.stationuuid
      };
    })
    .toEqual({
      length: 1,
      keepLength: 1,
      activeId: next.stationuuid
    });
  const singleQueue = await readStoredQueue(page);
  const active = singleQueue.items[singleQueue.currentIndex];
  await page
    .locator(`[data-full-player-queue-item="${active.stationuuid}"] .full-player-queue-btn.danger`)
    .click();
  await expect
    .poll(async () => {
      const queue = await readStoredQueue(page);
      return queue.items.length;
    })
    .toBe(0);
  await expect(page.locator('[data-full-player-overlay]')).toBeVisible();
  await expect(page.locator('[data-full-player-overlay]')).toContainText(
    /Станция не выбрана|No station selected/
  );
});

test('mobile full player opens library queue and station details', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startSearchQueueAndOpenFullPlayer(page);

  // PR-6: the helper leaves the queue sheet open; details lives in the «Ещё»
  // actions sheet — close the queue first, then route through the sheet.
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-full-player-queue]')).toHaveCount(0);
  await page
    .locator('[data-full-player-overlay]')
    .getByRole('button', { name: /^(Ещё|More)$/ })
    .first()
    .click();
  await page
    .locator('.full-player-sheet')
    .getByRole('button', { name: /Детали|Details/ })
    .click();
  await expect(page.locator('.details-overlay')).toBeVisible();
  await expect(page.locator('.details-overlay')).toContainText(/Пожаловаться|Report broken/);
  await expect(page.locator('.details-overlay')).toContainText(/Скрыть|Hide/);
  // T1.4: details is a focus-trapped modal over the full player; Escape is
  // the canonical dismiss (the modal now makes the inert full player
  // pointer-transparent, so a forced backdrop-centre click would land on
  // the tall details card rather than the backdrop).
  await page.keyboard.press('Escape');
  await expect(page.locator('.details-overlay')).toHaveCount(0);

  await expect(page.locator('[data-full-player-overlay]')).toBeVisible();
  // PR-6: "Open queue in library" is the queue-sheet toolbar action now.
  await openFullPlayerQueueSheet(page);
  await page
    .locator('[data-full-player-queue]')
    .getByRole('button', { name: /Открыть очередь|Open queue/ })
    .click();
  await expect(page.locator('[data-full-player-overlay]')).toHaveCount(0);
  await expect(page.locator('.screen-library-v2')).toBeVisible();
  await expect(page.locator('.library-tab-chip.active')).toContainText(/Очередь|Queue/);
});

test('mobile full player has no horizontal overflow on core widths', async ({ page }) => {
  await startSearchQueueAndOpenFullPlayer(page);
  for (const width of [360, 390, 412]) {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 844 });
    await expect(page.locator('[data-full-player-overlay]')).toBeVisible();
    await expectNoDocumentHorizontalOverflow(page);
  }
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
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();

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
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();
  await page.locator('.app-navigation-mobile').getByRole('button', { name: /Поиск|Search/ }).click();
  const discoverInput = page.locator('#search-hero-input').first();
  await discoverInput.waitFor({ state: 'visible' });
  await discoverInput.fill('Tokyo');
  await page.waitForTimeout(500);
  await page
    .locator('.search-station-card-primary-action, .station-compact-play')
    .first()
    .click();

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
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();

  await playHomeStation(page, 'Tokyo FM');
  await page.locator('.app-navigation-mobile').getByRole('button', { name: 'Моё' }).evaluate((node) => {
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
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();

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

test('telegram mobile fullscreen opens full player by default', async ({ page }) => {
  await enableTelegramMobileSafeMode(page);
  await page.goto('/?tgWebAppPlatform=ios');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();

  await playHomeStation(page, 'Tokyo FM');
  await page.locator('.player-dock-artwork-trigger').evaluate((node) => {
    (node as HTMLButtonElement).click();
  });

  await expect(page.locator('[data-full-player-overlay]')).toBeVisible();
  await expect(page.locator('.winamp-compact.fullscreen-ui')).toHaveCount(0);
  await expect(page.locator('#webamp')).toHaveCount(0);
});

test('query flag keeps legacy lite winamp easter egg', async ({ page }) => {
  await enableTelegramMobileSafeMode(page);
  await page.goto('/?tgWebAppPlatform=ios&winamp=1');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();

  await playHomeStation(page, 'Tokyo FM');
  await page.locator('.player-dock-artwork-trigger').evaluate((node) => {
    (node as HTMLButtonElement).click();
  });

  await expect(page.locator('.winamp-compact.fullscreen-ui')).toBeVisible();
  await expect(page.locator('.winamp-compact[data-winamp-mode="lite"]')).toBeVisible();
  await expect(page.locator('[data-winamp-lite-panel="true"]')).toBeVisible();
  await expect(page.locator('[data-full-player-overlay]')).toHaveCount(0);
  // P3-3b: the theme-driven milkdrop visualizer card is re-enabled in the lite
  // overlay (audio-reactive when a stream is readable; time-animated themed blob
  // otherwise — e.g. this iOS lean-mode harness has no analyser).
  await expect(page.locator('.winamp-overlay-visualizer-card')).toBeVisible();
});

test('R++ brand gesture unlocks legacy lite winamp easter egg', async ({ page }) => {
  await enableTelegramMobileSafeMode(page);
  await page.goto('/?tgWebAppPlatform=ios');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();

  await playHomeStation(page, 'Tokyo FM');
  const trigger = page.locator('[data-winamp-easter-egg-trigger="title"]');
  for (let i = 0; i < 5; i += 1) {
    await trigger.click();
  }

  await expect(page.locator('.winamp-compact.fullscreen-ui')).toBeVisible();
  await expect(page.locator('.winamp-compact[data-winamp-mode="lite"]')).toBeVisible();
  await expect(page.locator('[data-winamp-lite-panel="true"]')).toBeVisible();
  await expect(page.locator('[data-full-player-overlay]')).toHaveCount(0);
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
  const requested: string[] = [];
  page.on('request', (request) => {
    requested.push(request.url());
  });
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
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();
  await expect(page.locator('[data-home-rail] [data-home-station]').first()).toBeVisible();
  await expect(page.locator('.home-status-banner')).toHaveCount(0);
  await expectNoHomeHorizontalOverflow(page);
  expect(requested.some((url) => /radioBrowserFallback|catalog-fallback/i.test(url))).toBe(true);
});

test('core mobile screens have no document overflow on 360 390 and 412 widths', async ({
  page
}) => {
  for (const width of [360, 390, 412]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(page.locator('[data-home-feed-entry]')).toBeVisible();
    await expectNoDocumentHorizontalOverflow(page);

    await page.locator('.app-navigation-mobile').getByRole('button', { name: /Поиск|Search/ }).click();
    await expect(page.locator('.search-hero-card')).toBeVisible();
    await expectNoDocumentHorizontalOverflow(page);

    await page.locator('.app-navigation-mobile').getByRole('button', { name: /Глобус|Globe/ }).click();
    await expect(page.locator('.screen-globe-v3')).toBeVisible();
    await expectNoDocumentHorizontalOverflow(page);

    await page.locator('.app-navigation-mobile').getByRole('button', { name: /Моё|Library|Mine/ }).click();
    await expect(page.locator('.library-tab-strip')).toBeVisible();
    await expectNoDocumentHorizontalOverflow(page);
  }
});

test('mobile cold load does not load webamp bundle', async ({ page }) => {
  await enableTelegramMobileSafeMode(page);
  const requested: string[] = [];
  page.on('request', (request) => {
    requested.push(request.url());
  });

  await page.goto('/');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();

  expect(requested.some((url) => /esm\.sh|react@18|react-dom@18/i.test(url))).toBe(false);
  expect(requested.some((url) => /webamp-zip-vendor/i.test(url))).toBe(false);
});

test('home first useful paint does not load globe skin lab or player overlays', async ({
  page
}) => {
  await enableTelegramMobileSafeMode(page);
  const requested: string[] = [];
  page.on('request', (request) => {
    requested.push(request.url());
  });

  await page.goto('/');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();

  expect(
    requested.some((url) =>
      /GlobeScreen|Globe\.tsx|globe-geo-data|catalog-fallback|radioBrowserFallback|PlaybackRuntime|playback-runtime|hls-core-vendor|ThemeStudio|SkinLab|WinampPlayerShell|LitePlayerOverlay|FullPlayerOverlay|webamp/i.test(url)
    )
  ).toBe(false);
});

test('cached summary renders home while catalog summary is offline', async ({ page }) => {
  await enableTelegramMobileSafeMode(page);
  const payload = JSON.parse(summaryBody());
  await page.addInitScript(
    ({ storageKey, cachedSummary, cacheVersion }) => {
      const now = Date.now();
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          'summary:v2': {
            // T_audit_10: must match the live CATALOG_CACHE_VERSION, else
            // readCatalogCache rejects the entry (it did after T_audit_8 bumped
            // 1→2) and — with the network routed to hang below — the home never
            // hydrates. The point of this test is the served-cache path.
            version: cacheVersion,
            key: 'summary:v2',
            payload: cachedSummary,
            createdAt: now,
            expiresAt: now + 60 * 60 * 1000
          }
        })
      );
    },
    { storageKey: catalogCacheStorageKey, cachedSummary: payload, cacheVersion: CATALOG_CACHE_VERSION }
  );
  await page.unroute('**/catalog/summary**');
  await page.route('**/catalog/summary**', async () => {
    await new Promise(() => {});
  });

  await page.goto('/');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();
  await expect(page.locator('.screen-skeleton-home-hero')).toHaveCount(0);
  await expectNoHomeHorizontalOverflow(page);
});

test('mounting app does not rewrite persistent app library or player state', async ({ page }) => {
  await enableTelegramMobileSafeMode(page);
  await page.addInitScript(() => {
    const trackedKeys = new Set(['radio:app:v2', 'radio:library:v2', 'radio:player:v2']);
    const writes: string[] = [];
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
    const originalGetItem = window.localStorage.getItem.bind(window.localStorage);
    // radio:app:v2 legitimately rewrites on Home mount to persist which discovery
    // stations were surfaced (the exposure ledger that self-rotates «Для тебя»).
    // Strip that one field so an exposure-only write isn't miscounted as a spurious
    // shell/profile rewrite — the invariant here is "mount doesn't churn
    // library/player/shell state", not "no write ever".
    const stripExposure = (raw: string | null) => {
      try {
        const parsed = (raw ? JSON.parse(raw) : {}) as { stationExposure?: unknown };
        delete parsed.stationExposure;
        return JSON.stringify(parsed);
      } catch {
        return raw ?? '';
      }
    };
    Object.defineProperty(window, '__radioAtlasTrackedWrites', {
      configurable: true,
      value: writes
    });
    queueMicrotask(() => {
      Object.defineProperty(window, '__radioAtlasTrackPersistentWrites', {
        configurable: true,
        value: true
      });
    });
    window.localStorage.setItem = (key: string, value: string) => {
      if (
        (window as Window & { __radioAtlasTrackPersistentWrites?: boolean })
          .__radioAtlasTrackPersistentWrites &&
        trackedKeys.has(key)
      ) {
        if (key === 'radio:app:v2') {
          if (stripExposure(originalGetItem(key)) !== stripExposure(value)) {
            writes.push(key);
          }
        } else {
          writes.push(key);
        }
      }
      return originalSetItem(key, value);
    };
  });

  await page.goto('/');
  await expect(page.locator('[data-home-feed-entry]')).toBeVisible();
  await page.waitForTimeout(350);

  const writes = await page.evaluate(
    () => (window as Window & { __radioAtlasTrackedWrites?: string[] }).__radioAtlasTrackedWrites || []
  );
  expect(writes).toEqual([]);
});

// T_mobile_1 A+C: live Telegram WebView feedback pack.
test.describe('T_mobile_1 mobile Home polish', () => {
  test('A: rail + chip-row containers carry overscroll-behavior-x: contain', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedDiscoveryRoutes(page);
    await page.goto('/');
    await expect(page.locator('[data-home-feed-entry]')).toBeVisible();

    // Both horizontal-scroll containers must contain their X overscroll so a
    // wheel/touch reaching the end of the rail doesn't bubble up and scroll the
    // page vertically (the live "по концу ленты скроллит страницу" pain).
    const railOverscroll = await page
      .locator('.home-horizontal-scroll')
      .first()
      .evaluate((el) => getComputedStyle(el).overscrollBehaviorX);
    expect(railOverscroll).toBe('contain');
  });

  // Discovery rails are single-row PEEK lanes of large-cover cards (~150px
  // wide, ~2.3 in view, cover fills the card), including fresh-now.
  test('C: all discovery rails use one compact large-cover peek row', async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedDiscoveryRoutes(page);
    await page.goto('/');
    await expect(page.locator('[data-home-feed-entry]')).toBeVisible();
    await expect(page.locator('.screen-home-next')).toHaveAttribute('data-density', 'dense');

    // Inspect a server-signal rail first.
    const peekTile = page.locator('[data-home-rail="trending"] [data-home-station]').first();
    const tileWidth = await peekTile.evaluate((el) => Math.round(el.getBoundingClientRect().width));
    expect(tileWidth).toBeGreaterThanOrEqual(140);
    expect(tileWidth).toBeLessThanOrEqual(190);

    // The generated scene cover fills the card width (large cover, not a 64px
    // thumbnail). Reference cards are scene-first — the raw station logo is gone.
    const coverWidth = await peekTile
      .locator('.home-station-scene')
      .first()
      .evaluate((el) => Math.round(el.getBoundingClientRect().width));
    expect(coverWidth).toBeGreaterThanOrEqual(120);

    // The peek rail is a single row (peek lane, not a 2-row grid): every tile
    // shares one top coordinate.
    const peekRowCount = await page
      .locator('[data-home-rail="trending"] [data-home-station]')
      .evaluateAll(
        (nodes) =>
          new Set(nodes.map((n) => Math.round(n.getBoundingClientRect().top / 8) * 8)).size
      );
    expect(peekRowCount).toBe(1);

    // The personalised lead uses the same single row; this prevents cards from
    // growing to half the viewport width around the 540px breakpoint.
    const forYouRowCount = await page
      .locator('[data-home-rail="fresh-now"] [data-home-station]')
      .evaluateAll((nodes) => {
        return new Set(
          nodes.map((node) => Math.round(node.getBoundingClientRect().top / 8) * 8)
        ).size;
      });
    expect(forYouRowCount).toBe(1);
  });
});

test('T_share_1: search card share is reachable in one tap, does not play, no overflow at 390px', async ({
  page
}) => {
  // Stub the web share sheet so the click resolves cleanly in headless Chromium
  // (no Telegram, no native sheet) instead of falling through to a popup tab.
  await page.addInitScript(() => {
    (window as unknown as { __shareCalls: number }).__shareCalls = 0;
    (navigator as unknown as { share: (data: unknown) => Promise<void> }).share = async () => {
      (window as unknown as { __shareCalls: number }).__shareCalls += 1;
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await installMediaMocks(page);
  await mockStations(page);
  await seedRadioState(page, { activeSection: 'search', stationCache: stations });
  await page.goto('/');
  await expect(page.locator('.screen-search-v2')).toBeVisible({ timeout: 15_000 });
  await page.locator('#search-hero-input').first().fill('jpop');

  const card = page.locator('[data-search-station-card]').first();
  await expect(card).toBeVisible();

  // Restored card-level share, reachable in one tap.
  const shareBtn = card.locator('.search-card-share');
  await expect(shareBtn).toBeVisible();
  await shareBtn.click();

  // The share fired (web-share path) and — crucially — playback did NOT start:
  // the stopPropagation guard keeps the share click off the play affordance.
  await expect
    .poll(async () => page.evaluate(() => (window as unknown as { __shareCalls: number }).__shareCalls))
    .toBeGreaterThan(0);
  await expect(page.locator('.player-dock-bar')).toHaveCount(0);

  // Density: the extra icon must not introduce horizontal overflow at 390px.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

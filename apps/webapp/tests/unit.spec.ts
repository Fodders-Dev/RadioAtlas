import { expect, test } from '@playwright/test';
import {
  isBlocked,
  normalizeUrl,
  parseM3u,
  parsePls,
  pickBestStream
} from '../src/screens/search/linkUtils';
import { buildStationStreamTargets } from '../src/lib/stationStreams';
import { buildCandidates } from '../src/lib/playbackTransport';
import {
  catalogCacheStorageKey,
  clearCatalogCacheStorage,
  deleteCatalogCacheByPrefix,
  readCatalogCache,
  writeCatalogCache
} from '../src/lib/catalogCache';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const installWindowStorage = (href = 'https://radioatlas.test/') => {
  const storage = new MemoryStorage();
  const location = new URL(href);
  const windowValue = {
    localStorage: storage,
    location,
    Telegram: undefined,
    innerWidth: 1280,
    innerHeight: 720,
    matchMedia: () => ({ matches: false })
  } as unknown as Window;

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: windowValue
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage
  });

  return storage;
};

test.afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window');
  Reflect.deleteProperty(globalThis, 'localStorage');
});

test('manual link helpers normalize URLs, block only real blocked hosts, and parse playlists', () => {
  expect(isBlocked('https://www.youtube.com/watch?v=radio')).toBe(true);
  expect(isBlocked('https://music.youtube.com/watch?v=radio')).toBe(true);
  expect(isBlocked('https://notyoutube.com/radio.mp3')).toBe(false);

  expect(normalizeUrl(' https://example.com/live.mp3?utm_source=ad&keep=1 ')).toBe(
    'https://example.com/live.mp3?keep=1'
  );
  expect(normalizeUrl('not a url')).toBe('');

  expect(parseM3u('#EXTM3U\n#EXTINF:-1,Alpha\nstreams/live.mp3\n# ignored', 'https://radio.test/list.m3u')).toEqual([
    {
      url: 'https://radio.test/streams/live.mp3',
      name: 'Alpha'
    }
  ]);

  expect(parsePls('[playlist]\nFile1=/one.mp3\nTitle1=One\nFile2=https://cdn.test/two.aac', 'https://radio.test/pls')).toEqual([
    {
      url: 'https://radio.test/one.mp3',
      name: 'One'
    },
    {
      url: 'https://cdn.test/two.aac',
      name: undefined
    }
  ]);

  expect(
    pickBestStream([
      { url: 'https://cdn.test/low.mp3', bitrate: 64 },
      { url: 'https://cdn.test/high.mp3', averageBitrate: 192 },
      { url: '', bitrate: 320 }
    ])?.url
  ).toBe('https://cdn.test/high.mp3');
});

test('station stream targets canonicalize known broken direct URLs without duplicates', () => {
  const cityTargets = buildStationStreamTargets({
    name: 'Radio City',
    homepage: 'https://city.bg',
    url_resolved: 'http://31.13.223.148/city.mp3',
    url: 'http://31.13.223.148/city.mp3'
  });
  expect(cityTargets[0]).toContain('playerservices.streamtheworld.com');
  expect(new Set(cityTargets).size).toBe(cityTargets.length);

  const salueTargets = buildStationStreamTargets({
    name: 'Radio Salue',
    homepage: 'https://www.salue.de',
    url_resolved: 'https://stale.example.com/salue.mp3',
    url: 'https://stale.example.com/salue.mp3'
  });
  expect(salueTargets).toEqual(['https://internetradio.salue.de:8443/salue5']);
});

test('playback candidate planning handles direct, mixed-content, proxy-first, and hls cases', () => {
  installWindowStorage('https://radioatlas.test/?api=https%3A%2F%2Fapi.radioatlas.test');

  const direct = buildCandidates({
    url: 'https://cdn.radio.test/live.mp3',
    apiBase: '',
    apiAvailable: false
  });
  expect(direct.blockedMixedContent).toBe(false);
  expect(direct.candidates.map((candidate) => candidate.mode)).toEqual(['direct']);

  const mixed = buildCandidates({
    url: 'http://cdn.radio.test/live.mp3',
    apiBase: '',
    apiAvailable: false
  });
  expect(mixed.blockedMixedContent).toBe(true);
  expect(mixed.candidates[0]?.url).toBe('https://cdn.radio.test/live.mp3');

  const proxied = buildCandidates({
    url: 'https://cdn.radio.test/live.mp3',
    apiBase: 'https://api.radioatlas.test',
    apiAvailable: true
  });
  expect(proxied.candidates.map((candidate) => candidate.mode)).toEqual(['proxy', 'direct']);
  expect(proxied.candidates[0]?.url).toContain('/stream?url=');

  const hls = buildCandidates({
    url: 'https://cdn.radio.test/live/playlist.m3u8',
    apiBase: 'https://api.radioatlas.test',
    apiAvailable: true
  });
  expect(hls.candidates.map((candidate) => candidate.mode)).toEqual(['proxy', 'hls']);

  const unavailableApi = buildCandidates({
    url: 'https://cdn.radio.test/live/playlist.m3u8',
    apiBase: 'https://api.radioatlas.test',
    apiAvailable: false
  });
  expect(unavailableApi.apiUnavailable).toBe(true);
});

test('catalog cache uses local fallback, expires stale entries, and clears by prefix', async () => {
  const storage = installWindowStorage();
  await clearCatalogCacheStorage();

  await writeCatalogCache('summary:one', { count: 1 }, 10_000);
  await writeCatalogCache('search:one', { count: 2 }, 10_000);
  await expect(readCatalogCache<{ count: number }>('summary:one')).resolves.toMatchObject({
    payload: { count: 1 }
  });

  await deleteCatalogCacheByPrefix('summary:');
  await expect(readCatalogCache('summary:one')).resolves.toBeNull();
  await expect(readCatalogCache<{ count: number }>('search:one')).resolves.toMatchObject({
    payload: { count: 2 }
  });

  await writeCatalogCache('expired:one', { count: 3 }, -1);
  await expect(readCatalogCache('expired:one')).resolves.toBeNull();

  storage.setItem(catalogCacheStorageKey, '{broken');
  await expect(readCatalogCache('search:one')).resolves.toBeNull();
});

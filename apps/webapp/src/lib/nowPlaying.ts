import type { NowPlayingFailureKind, NowPlayingSnapshot, NowPlayingSource } from '../domain/contracts';
import type { StationLite } from '../types';
import { getApiBase } from './apiBase';
import { checkApiAvailability, markApiUnavailable } from './apiAvailability';
import { buildStationStreamTargets } from './stationStreams';
import { normalizeTrustedTrackTitle } from './trackTrust';

const STREAM_TITLE = /StreamTitle='([^']+)'/i;
const ICY_METADATA_ENCODINGS = ['utf-8', 'shift_jis'] as const;

const isTechnicalTrackPayload = (value: string) =>
  /^\{.*"(status|message|result|errorCode)".*\}\s*\d*$/i.test(value);

const decodeIcyStreamTitle = (metaBytes: Uint8Array) => {
  for (const encoding of ICY_METADATA_ENCODINGS) {
    try {
      const metadata = new TextDecoder(encoding).decode(metaBytes);
      const match = metadata.match(STREAM_TITLE);
      const title = normalizeTrackTitle(match?.[1]);
      if (title) return title;
    } catch {
      // Ignore unsupported browser decoders and keep trying fallbacks.
    }
  }

  return null;
};

type FetchNowPlayingOptions = {
  signal?: AbortSignal;
  lowImpact?: boolean;
};

type ObserveStationNowPlayingOptions = {
  passive?: boolean;
};

const buildSnapshot = (
  track: string | null,
  status: NowPlayingSnapshot['status'],
  source: NowPlayingSource,
  failureKind: NowPlayingFailureKind | null,
  recommendedPollMs: number
): NowPlayingSnapshot => ({
  track,
  status,
  source,
  failureKind,
  recommendedPollMs,
  updatedAt: track ? Date.now() : null
});

const isConstrainedApplePlayback = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const looksLikeIPad = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const isAppleMobile = /iPhone|iPad|iPod/i.test(ua) || looksLikeIPad;
  const isAppleWebKit = /AppleWebKit/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua);
  return isAppleMobile && isAppleWebKit;
};

export const shouldUseLowImpactMetadata = () => isConstrainedApplePlayback();

const isDocumentVisible = () =>
  typeof document === 'undefined' || document.visibilityState === 'visible';

const bindAbort = (controller: AbortController, signal?: AbortSignal) => {
  if (!signal) return () => {};
  if (signal.aborted) {
    controller.abort();
    return () => {};
  }
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  return () => signal.removeEventListener('abort', abort);
};

const concat = (left: Uint8Array, right: Uint8Array) => {
  const merged = new Uint8Array(left.length + right.length);
  merged.set(left, 0);
  merged.set(right, left.length);
  return merged;
};

const normalizeTrackTitle = (value?: string | null) => {
  if (isTechnicalTrackPayload(value || '')) return null;
  return normalizeTrustedTrackTitle(value);
};

const buildTrack = (artist?: string, title?: string) => {
  const parts = [normalizeTrackTitle(artist), normalizeTrackTitle(title)].filter(Boolean);
  if (!parts.length) return null;
  return parts.join(' - ');
};

const canAttemptDirectFetch = (url: string) => {
  try {
    return new URL(url, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
};

// 6 s ICY timeout was holding back the whole snapshot pipeline:
// the ICY probe is the slowest in-browser strategy, and most
// streams either respond with metadata in well under 1 s or never
// respond at all. 3.5 s catches the responsive ones and surrenders
// quickly when a stream is silent so we move to the server proxy.
const fetchIcy = async (
  url: string,
  timeoutMs = 3500,
  signal?: AbortSignal
): Promise<string | null> => {
  if (!url || !url.startsWith('https://')) return null;

  const controller = new AbortController();
  const unbindAbort = bindAbort(controller, signal);
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        'Icy-MetaData': '1'
      },
      signal: controller.signal
    });

    const metaintHeader =
      response.headers.get('icy-metaint') || response.headers.get('Icy-MetaInt');
    const metaint = Number(metaintHeader);

    if (!response.body || !Number.isFinite(metaint) || metaint <= 0) {
      return null;
    }

    const reader = response.body.getReader();
    let buffer = new Uint8Array(0);
    const maxBytes = metaint + 1 + 2048;

    while (true) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      buffer = concat(buffer, value);

      if (buffer.length >= metaint + 1) {
        const metaLength = buffer[metaint] * 16;
        if (metaLength === 0) return null;
        if (buffer.length >= metaint + 1 + metaLength) {
          const metaStart = metaint + 1;
          const metaBytes = buffer.slice(metaStart, metaStart + metaLength);
          return decodeIcyStreamTitle(metaBytes);
        }
      }

      if (buffer.length > maxBytes) {
        return null;
      }
    }
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
    unbindAbort();
    controller.abort();
  }

  return null;
};

const parseAzuraCast = (data: any): string | null => {
  if (!data) return null;
  const payload = Array.isArray(data) ? data[0] : data;
  const song = payload?.now_playing?.song;
  return normalizeTrackTitle(song?.text) || buildTrack(song?.artist, song?.title);
};

const fetchAzuraCast = async (
  host: string,
  apiBase: string,
  apiAvailable: boolean,
  signal?: AbortSignal
): Promise<string | null> => {
  const endpoints = [
    `https://${host}/api/nowplaying/1`,
    `https://${host}/api/nowplaying`
  ];

  for (const endpoint of endpoints) {
    try {
      let response: Response | null = null;
      if (canAttemptDirectFetch(endpoint)) {
        response = await fetch(endpoint, { cache: 'no-store', signal });
      } else if (apiBase && apiAvailable) {
        response = await fetch(`${apiBase}/fetch?url=${encodeURIComponent(endpoint)}`, {
          cache: 'no-store',
          signal
        });
      } else {
        continue;
      }
      if (!response.ok) continue;
      const data = await response.json();
      const track = parseAzuraCast(data);
      if (track) return track;
    } catch {
      continue;
    }
  }

  return null;
};

const isNightride = (url: string) => url.includes('nightride.fm');

const nightrideStationId = (url: string) => {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/([^/]+)\.(mp3|m3u8|flac)$/i);
    if (match?.[1]) return match[1];
  } catch {
    return null;
  }
  return null;
};

type NightrideListener = (station: string, track: string | null) => void;

let nightrideSource: EventSource | null = null;
const nightrideCache = new Map<string, string>();
const nightrideListeners = new Set<NightrideListener>();

const ensureNightrideSource = () => {
  if (nightrideSource) return;
  try {
    nightrideSource = new EventSource('https://nightride.fm/meta');
    nightrideSource.onmessage = (event) => {
      if (event.data === 'keepalive') return;
      try {
        const payload = JSON.parse(event.data) as Array<{
          station?: string;
          artist?: string;
          title?: string;
        }>;
        payload.forEach((item) => {
          if (!item?.station) return;
          const track = buildTrack(item.artist, item.title);
          if (track) {
            nightrideCache.set(item.station, track);
            nightrideListeners.forEach((listener) =>
              listener(item.station as string, track)
            );
          }
        });
      } catch {
        // ignore malformed payloads
      }
    };
    nightrideSource.onerror = () => {
      // allow reconnect by resetting source on error
      nightrideSource?.close();
      nightrideSource = null;
    };
  } catch {
    nightrideSource = null;
  }
};

// Close the shared SSE and drop its cache. Called when the last subscriber
// leaves: otherwise the EventSource lives forever and its onerror keeps
// reconnecting in the background, draining battery/data on mobile long after
// nothing on screen is listening. A later subscription re-opens it.
const teardownNightrideSource = () => {
  if (nightrideSource) {
    try {
      nightrideSource.close();
    } catch {
      // ignore — already closed / unsupported
    }
    nightrideSource = null;
  }
  nightrideCache.clear();
};

export const subscribeNowPlaying = (
  station: StationLite,
  onTrack: (track: string | null) => void
) => {
  const url = station.url_resolved;
  if (!url || !isNightride(url)) return null;
  const stationId = nightrideStationId(url);
  if (!stationId) return null;

  ensureNightrideSource();
  const handler: NightrideListener = (id, track) => {
    if (id === stationId) {
      onTrack(track);
    }
  };
  nightrideListeners.add(handler);

  const cached = nightrideCache.get(stationId);
  if (cached) {
    onTrack(cached);
  }

  return () => {
    nightrideListeners.delete(handler);
    // Last listener gone → tear the socket down so it can't reconnect forever.
    if (nightrideListeners.size === 0) {
      teardownNightrideSource();
    }
  };
};

type StationSnapshotListener = (snapshot: NowPlayingSnapshot) => void;

type StationSnapshotEntry = {
  key: string;
  station: StationLite;
  snapshot: NowPlayingSnapshot;
  listeners: Set<StationSnapshotListener>;
  inFlight: Promise<void> | null;
  timer: number | null;
  cleanupTimer: number | null;
  liveUnsubscribe: (() => void) | null;
};

const STATION_CACHE_TTL_MS = 5 * 60_000;
const LAST_KNOWN_TRACKS_STORAGE_KEY = 'radio:last-known-tracks:v2';
const LAST_KNOWN_TRACKS_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14;
const LAST_KNOWN_TRACKS_LIMIT = 600;
const MAX_METADATA_CONCURRENCY = 2;
const stationSnapshotEntries = new Map<string, StationSnapshotEntry>();
const queuedStationKeys = new Set<string>();
const refreshQueue: string[] = [];
let activeRefreshCount = 0;
let storedTrackCache: Record<string, { track: string; updatedAt: number }> | null = null;

const stationSnapshotKey = (station: StationLite) => station.stationuuid || station.url_resolved || station.name;

const idleSnapshot = (): NowPlayingSnapshot => ({
  track: null,
  status: 'idle',
  source: 'none',
  failureKind: null,
  recommendedPollMs: shouldUseLowImpactMetadata() ? 45_000 : 30_000,
  updatedAt: null
});

const readStoredTrackCache = (): Record<string, { track: string; updatedAt: number }> => {
  if (storedTrackCache) return storedTrackCache;
  if (typeof window === 'undefined') {
    storedTrackCache = {};
    return storedTrackCache;
  }
  try {
    const raw = window.localStorage.getItem(LAST_KNOWN_TRACKS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    storedTrackCache = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    storedTrackCache = {};
  }
  return storedTrackCache as Record<string, { track: string; updatedAt: number }>;
};

const persistStoredTrackCache = (cache: Record<string, { track: string; updatedAt: number }>) => {
  storedTrackCache = cache;
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LAST_KNOWN_TRACKS_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // ignore storage failures
  }
};

const getStoredTrack = (key: string) => {
  const cache = readStoredTrackCache();
  const entry = cache[key];
  if (!entry?.track || !entry.updatedAt) return null;
  // Treat future-dated entries as expired too: a backward clock correction makes
  // (now - updatedAt) negative, so a `> MAX_AGE` check alone would never expire a
  // weeks-old track and we'd surface it as the confident current «сейчас играет».
  const age = Date.now() - entry.updatedAt;
  if (age < 0 || age > LAST_KNOWN_TRACKS_MAX_AGE_MS) {
    delete cache[key];
    persistStoredTrackCache(cache);
    return null;
  }
  return entry;
};

const saveStoredTrack = (key: string, track: string, updatedAt = Date.now()) => {
  const cache = readStoredTrackCache();
  const nextEntries = Object.entries({
    ...cache,
    [key]: {
      track,
      updatedAt
    }
  })
    .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
    .slice(0, LAST_KNOWN_TRACKS_LIMIT);
  persistStoredTrackCache(Object.fromEntries(nextEntries));
};

const applyStoredTrackFallback = (
  key: string,
  snapshot: NowPlayingSnapshot
): NowPlayingSnapshot => {
  if (snapshot.track) {
    saveStoredTrack(key, snapshot.track, snapshot.updatedAt ?? Date.now());
    return snapshot;
  }
  const stored = getStoredTrack(key);
  if (!stored) return snapshot;
  return {
    ...snapshot,
    track: stored.track,
    status: 'ready',
    source: 'cache',
    failureKind: null,
    updatedAt: stored.updatedAt
  };
};

const emitStationSnapshot = (entry: StationSnapshotEntry) => {
  entry.listeners.forEach((listener) => listener(entry.snapshot));
};

const clearScheduledRefresh = (entry: StationSnapshotEntry) => {
  if (entry.timer) {
    window.clearTimeout(entry.timer);
    entry.timer = null;
  }
};

const clearCleanupTimer = (entry: StationSnapshotEntry) => {
  if (entry.cleanupTimer) {
    window.clearTimeout(entry.cleanupTimer);
    entry.cleanupTimer = null;
  }
};

const scheduleStationRefresh = (entry: StationSnapshotEntry, delayMs?: number) => {
  clearScheduledRefresh(entry);
  if (!entry.listeners.size) return;
  const baseDelay = delayMs ?? entry.snapshot.recommendedPollMs ?? 15_000;
  const waitMs = isDocumentVisible()
    ? Math.max(baseDelay, 60_000)
    : Math.max(baseDelay, 120_000);
  entry.timer = window.setTimeout(() => {
    queueStationSnapshotRefresh(entry.key);
  }, waitMs);
};

const releaseStationEntry = (entry: StationSnapshotEntry) => {
  clearScheduledRefresh(entry);
  clearCleanupTimer(entry);
  entry.liveUnsubscribe?.();
  entry.liveUnsubscribe = null;
  if (!entry.listeners.size) {
    stationSnapshotEntries.delete(entry.key);
  }
};

const getStationEntry = (station: StationLite) => {
  const key = stationSnapshotKey(station);
  const existing = stationSnapshotEntries.get(key);
  if (existing) {
    existing.station = station;
    return existing;
  }
  const created: StationSnapshotEntry = {
    key,
    station,
    snapshot: applyStoredTrackFallback(key, idleSnapshot()),
    listeners: new Set(),
    inFlight: null,
    timer: null,
    cleanupTimer: null,
    liveUnsubscribe: null
  };
  stationSnapshotEntries.set(key, created);
  return created;
};

const refreshStationSnapshot = async (entry: StationSnapshotEntry) => {
  if (entry.inFlight) return entry.inFlight;

  const lowImpact = shouldUseLowImpactMetadata();
  if (!entry.snapshot.track && entry.snapshot.status !== 'loading') {
    entry.snapshot = {
      ...entry.snapshot,
      status: 'loading',
      failureKind: null
    };
    emitStationSnapshot(entry);
  }

  entry.inFlight = (async () => {
    try {
      const snapshot = await fetchNowPlayingSnapshot(entry.station, undefined, {
        lowImpact
      });
      entry.snapshot = applyStoredTrackFallback(entry.key, snapshot);
      emitStationSnapshot(entry);
      scheduleStationRefresh(entry, entry.snapshot.recommendedPollMs);
    } catch {
      entry.snapshot = {
        track: entry.snapshot.track,
        status: entry.snapshot.track ? 'ready' : 'unavailable',
        source: entry.snapshot.source === 'none' ? 'none' : entry.snapshot.source,
        failureKind: 'unknown',
        recommendedPollMs: lowImpact ? 45_000 : 30_000,
        updatedAt: entry.snapshot.updatedAt
      };
      emitStationSnapshot(entry);
      scheduleStationRefresh(entry);
    } finally {
      entry.inFlight = null;
    }
  })();

  return entry.inFlight;
};

const pumpStationSnapshotQueue = () => {
  while (activeRefreshCount < MAX_METADATA_CONCURRENCY && refreshQueue.length) {
    const key = refreshQueue.shift();
    if (!key) break;
    queuedStationKeys.delete(key);
    const entry = stationSnapshotEntries.get(key);
    if (!entry || !entry.listeners.size || entry.inFlight) {
      continue;
    }
    activeRefreshCount += 1;
    void refreshStationSnapshot(entry).finally(() => {
      activeRefreshCount = Math.max(activeRefreshCount - 1, 0);
      pumpStationSnapshotQueue();
    });
  }
};

function queueStationSnapshotRefresh(key: string) {
  if (queuedStationKeys.has(key)) return;
  queuedStationKeys.add(key);
  refreshQueue.push(key);
  pumpStationSnapshotQueue();
}

export const observeStationNowPlaying = (
  station: StationLite,
  onSnapshot: StationSnapshotListener,
  options: ObserveStationNowPlayingOptions = {}
) => {
  const entry = getStationEntry(station);
  clearCleanupTimer(entry);
  entry.listeners.add(onSnapshot);
  onSnapshot(entry.snapshot);

  if (!options.passive && !entry.liveUnsubscribe) {
    const liveUnsubscribe = subscribeNowPlaying(entry.station, (track) => {
      if (track) {
        saveStoredTrack(entry.key, track);
      }
      entry.snapshot = {
        track,
        status: track ? 'ready' : 'unavailable',
        source: 'nightride-sse',
        failureKind: track ? null : 'metadata-unavailable',
        recommendedPollMs: 30_000,
        updatedAt: track ? Date.now() : null
      };
      emitStationSnapshot(entry);
      scheduleStationRefresh(entry, entry.snapshot.recommendedPollMs);
    });
    if (liveUnsubscribe) {
      entry.liveUnsubscribe = liveUnsubscribe;
    }
  }

  if (!options.passive) {
    if (
      entry.snapshot.status === 'idle' ||
      entry.snapshot.status === 'unavailable' ||
      (entry.snapshot.updatedAt !== null &&
        Date.now() - entry.snapshot.updatedAt >= entry.snapshot.recommendedPollMs)
    ) {
      queueStationSnapshotRefresh(entry.key);
    } else if (!entry.timer) {
      scheduleStationRefresh(entry, entry.snapshot.recommendedPollMs);
    }
  }

  return () => {
    entry.listeners.delete(onSnapshot);
    if (entry.listeners.size) return;
    clearScheduledRefresh(entry);
    entry.liveUnsubscribe?.();
    entry.liveUnsubscribe = null;
    entry.cleanupTimer = window.setTimeout(() => {
      releaseStationEntry(entry);
    }, STATION_CACHE_TTL_MS);
  };
};

const fetchWithTimeout = async (url: string, ms = 4000, signal?: AbortSignal) => {
  const controller = new AbortController();
  const unbindAbort = bindAbort(controller, signal);
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
    unbindAbort();
  }
};

const parseHostname = (value?: string | null) => {
  if (!value) return '';
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
};

const hasStationHost = (station: StationLite, host: string) => {
  const homepageHost = parseHostname(station.homepage);
  const streamHost = parseHostname(station.url_resolved);
  const streamSourceHost = parseHostname(station.url);
  return [homepageHost, streamHost, streamSourceHost].some((value) => value.includes(host));
};

const fetchJsonTarget = async <T>(
  target: string,
  apiBase: string,
  apiAvailable: boolean,
  signal?: AbortSignal
): Promise<T | null> => {
  if (canAttemptDirectFetch(target)) {
    try {
      const res = await fetchWithTimeout(target, 4500, signal);
      if (res.ok) {
        return (await res.json()) as T;
      }
    } catch {
      // ignore direct fetch failures
    }
  }

  if (apiBase && apiAvailable) {
    try {
      const res = await fetchWithTimeout(
        `${apiBase}/fetch?url=${encodeURIComponent(target)}`,
        4500,
        signal
      );
      if (res.ok) {
        return (await res.json()) as T;
      }
    } catch {
      markApiUnavailable(apiBase);
    }
  }

  return null;
};

const SALUE_RPIDS = [
  { matchers: ['top 40', 'channel4'], rpId: '1706' },
  { matchers: ['urlaub', 'urlaubs'], rpId: '1229' },
  { matchers: ['kinder'], rpId: '1705' },
  { matchers: ['weihnachts'], rpId: '1704' },
  { matchers: ['chillout'], rpId: '2799' },
  { matchers: ['goldies', 'top100'], rpId: '1402' },
  { matchers: ['in the mix', 'channel1'], rpId: '1371' },
  { matchers: ['80er'], rpId: '1231' },
  { matchers: ['90er'], rpId: '2674' },
  { matchers: ['2000er'], rpId: '2798' }
] as const;

const resolveSalueRpId = (station: StationLite) => {
  if (!hasStationHost(station, 'salue.de') && !hasStationHost(station, 'internetradio.salue.de')) {
    return null;
  }

  const name = station.name.toLowerCase().replace(/\s+/g, ' ').trim();
  const streamHaystack = `${station.url_resolved} ${station.url || ''}`.toLowerCase();
  const haystack = `${name} ${streamHaystack}`;
  const matched = SALUE_RPIDS.find(({ matchers }) =>
    matchers.some((matcher) => haystack.includes(matcher))
  );
  if (matched) {
    return matched.rpId;
  }

  const isMainStation = /^radio sal[üu]\s*$/.test(name);
  const isMainStream =
    streamHaystack.includes('/salue.mp3') ||
    streamHaystack.includes('/salue.aac') ||
    /(?:^|[^a-z0-9])salue5(?:\?|$)/.test(streamHaystack);

  return isMainStation || isMainStream ? '646' : null;
};

const fetchRadioplayerEvents = async (
  rpId: string,
  apiBase: string,
  apiAvailable: boolean,
  signal?: AbortSignal
): Promise<string | null> => {
  const endpoint = `https://core-search.radioplayer.cloud/276/qp/v4/events?rpId=${encodeURIComponent(rpId)}`;
  const data = await fetchJsonTarget<{
    results?: {
      now?: { artistName?: string; name?: string; song?: boolean };
      previous?: Array<{ artistName?: string; name?: string; song?: boolean }>;
    };
  }>(endpoint, apiBase, apiAvailable, signal);

  const now = data?.results?.now;
  if (now?.song) {
    const track = buildTrack(now.artistName, now.name);
    if (track) return track;
  }

  const previous = Array.isArray(data?.results?.previous) ? data?.results?.previous : [];
  for (let index = previous.length - 1; index >= 0; index -= 1) {
    const item = previous[index];
    if (!item?.song) continue;
    const track = buildTrack(item.artistName, item.name);
    if (track) return track;
  }

  return null;
};

const resolve101ChannelId = (station: StationLite) => {
  const homepageMatch = station.homepage?.match(/101\.ru\/radio\/channel\/(\d+)/i);
  if (homepageMatch?.[1]) {
    return homepageMatch[1];
  }

  const tryExtractFromUrl = (value?: string) => {
    if (!value) return null;
    try {
      const parsed = new URL(value);
      if (!parsed.hostname.includes('101.ru')) return null;
      const segments = parsed.pathname.split('/').filter(Boolean);
      for (let index = segments.length - 1; index >= 0; index -= 1) {
        const segment = segments[index];
        if (/^\d+$/.test(segment)) {
          return segment;
        }
      }
    } catch {
      return null;
    }
    return null;
  };

  return tryExtractFromUrl(station.url_resolved) || tryExtractFromUrl(station.url);
};

const fetch101Track = async (
  channelId: string,
  apiBase: string,
  apiAvailable: boolean,
  signal?: AbortSignal
): Promise<string | null> => {
  const endpoints = [
    `https://101.ru/api/channel/getTrackOnAir/${encodeURIComponent(channelId)}/channelchannel/?dataFormat=json`,
    `https://101.ru/api/channel/getTrackOnAir/${encodeURIComponent(channelId)}`
  ];

  for (const endpoint of endpoints) {
    const data = await fetchJsonTarget<{
      status?: number | string;
      result?: {
        short?: {
          title?: string;
          titleTrack?: string;
          titleExecutor?: string;
        };
      };
    }>(endpoint, apiBase, apiAvailable, signal);

    const short = data?.result?.short;
    const track =
      buildTrack(short?.titleExecutor, short?.titleTrack) ||
      normalizeTrackTitle(short?.title) ||
      null;
    if (track) {
      return track;
    }
  }

  return null;
};

const resolveCityMetacastSlug = (station: StationLite) => {
  const haystack = `${station.name} ${station.url_resolved} ${station.url || ''}`.toLowerCase();
  if (hasStationHost(station, 'city.bg') && /(?:radio\s*city|city\s*bulgaria|радио\s*city|\/city\.mp3)/i.test(haystack)) {
    return 'radiocity';
  }
  return null;
};

const fetchMetacastTrack = async (
  slug: string,
  apiBase: string,
  apiAvailable: boolean,
  signal?: AbortSignal
): Promise<string | null> => {
  const endpoint = `https://meta.metacast.eu/aim/?radio=${encodeURIComponent(slug)}`;
  const data = await fetchJsonTarget<{
    nowplaying?: Array<{
      artist?: string;
      title?: string;
      status?: string;
      type?: string;
    }>;
  }>(endpoint, apiBase, apiAvailable, signal);

  const items = Array.isArray(data?.nowplaying) ? data.nowplaying : [];
  const preferred =
    items.find((item) => item?.status === 'playing' && item?.type === 'song') ||
    items.find((item) => item?.type === 'song') ||
    items[0];

  return buildTrack(preferred?.artist, preferred?.title);
};

const fetchOfficialProviderTrack = async (
  station: StationLite,
  apiBase: string,
  apiAvailable: boolean,
  signal?: AbortSignal
): Promise<{ source: NowPlayingSource; track: string } | null> => {
  const oneOhOneChannelId = resolve101ChannelId(station);
  if (oneOhOneChannelId) {
    const track = await fetch101Track(oneOhOneChannelId, apiBase, apiAvailable, signal);
    if (track) {
      return {
        source: 'channel-api',
        track
      };
    }
  }

  const salueRpId = resolveSalueRpId(station);
  if (salueRpId) {
    const track = await fetchRadioplayerEvents(salueRpId, apiBase, apiAvailable, signal);
    if (track) {
      return {
        source: 'radioplayer-events',
        track
      };
    }
  }

  const citySlug = resolveCityMetacastSlug(station);
  if (citySlug) {
    const track = await fetchMetacastTrack(citySlug, apiBase, apiAvailable, signal);
    if (track) {
      return {
        source: 'metacast',
        track
      };
    }
  }

  return null;
};

const shouldPreferServerMetadata = (url: string) => {
  const normalized = url.toLowerCase();
  return (
    normalized.startsWith('http://') ||
    normalized.includes('playerservices.streamtheworld.com') ||
    normalized.includes('.m3u8')
  );
};

const fetchServerProxyTrack = async ({
  url,
  apiBase,
  apiAvailable,
  signal,
  logDebug
}: {
  url: string;
  apiBase: string;
  apiAvailable: boolean;
  signal?: AbortSignal;
  logDebug?: (msg: string) => void;
}) => {
  if (!apiBase || !apiAvailable || signal?.aborted) {
    return { apiFailed: false, track: null as string | null };
  }

  try {
    const res = await fetch(`${apiBase}/metadata?url=${encodeURIComponent(url)}`, {
      signal
    });

    if (res.ok) {
      let data: any;
      try {
        data = await res.json();
      } catch {
        // A 200 with an unparseable body (gateway HTML error page, a truncated
        // proxy reply) is NOT an API outage. Falling through to the outer catch
        // would call markApiUnavailable and black out EVERY station's server-proxy
        // strategy for 6s. Treat it as "no track this poll" instead.
        if (logDebug) logDebug('[SSR] 200 with non-JSON body');
        return { apiFailed: false, track: null };
      }
      if (data.logs && logDebug && Array.isArray(data.logs)) {
        data.logs.forEach((line: string) => logDebug(`[SSR] ${line}`));
      }
      return {
        apiFailed: false,
        track: normalizeTrackTitle(data.title || data.nowPlaying || null)
      };
    }

    try {
      const errorData = await res.json();
      if (errorData.logs && logDebug && Array.isArray(errorData.logs)) {
        errorData.logs.forEach((line: string) => logDebug(`[SSR FAIL] ${line}`));
      }
    } catch {
      if (logDebug) logDebug(`[SSR] API Error ${res.status}`);
    }

    return {
      apiFailed: false,
      track: null
    };
  } catch (error) {
    markApiUnavailable(apiBase);
    if (logDebug) logDebug(`[SSR] Fetch Fail: ${error}`);
    return {
      apiFailed: true,
      track: null
    };
  }
};

const fetchIcecastCORS = async (
  origin: string,
  path: string,
  apiBase: string,
  apiAvailable: boolean,
  signal?: AbortSignal
): Promise<string | null> => {
  const target = `${origin}/status-json.xsl`;
  let data: any = null;

  if (canAttemptDirectFetch(target)) {
    try {
      const res = await fetchWithTimeout(target, 4000, signal);
      if (res.ok) data = await res.json();
    } catch {
      // ignore direct failure
    }
  }

  if (!data && apiBase && apiAvailable) {
    try {
      const res = await fetchWithTimeout(
        `${apiBase}/fetch?url=${encodeURIComponent(target)}`,
        4000,
        signal
      );
      if (res.ok) data = await res.json();
    } catch {
      markApiUnavailable(apiBase);
    }
  }

  if (!data?.icestats?.source) return null;

  const source = data.icestats.source;
  const sources = Array.isArray(source) ? source : [source];
  const match = sources.find((s: any) =>
    s.listenurl?.endsWith(path) ||
    s.listenurl?.includes(path)
  );
  const best = match || sources[0];

  if (best) {
    if (best.artist && best.title) return buildTrack(best.artist, best.title);
    if (best.title) return normalizeTrackTitle(best.title);
  }

  return null;
};

const fetchShoutcastCORS = async (
  origin: string,
  apiBase: string,
  apiAvailable: boolean,
  signal?: AbortSignal
): Promise<string | null> => {
  const target = `${origin}/7.html`;
  let text: string | null = null;

  if (canAttemptDirectFetch(target)) {
    try {
      const res = await fetchWithTimeout(target, 4000, signal);
      if (res.ok) text = await res.text();
    } catch {
      // ignore
    }
  }

  if (!text && apiBase && apiAvailable) {
    try {
      const res = await fetchWithTimeout(
        `${apiBase}/fetch?url=${encodeURIComponent(target)}`,
        4000,
        signal
      );
      if (res.ok) text = await res.text();
    } catch {
      markApiUnavailable(apiBase);
    }
  }

  if (!text) return null;

  const bodyMatch = text.match(/<body[^>]*>(.*?)<\/body>/i);
  const content = bodyMatch ? bodyMatch[1] : text;

  const parts = content.split(',');
  if (parts.length >= 7) {
    return normalizeTrackTitle(parts[6]) || null;
  }
  return null;
};

export const fetchNowPlayingSnapshot = async (
  station: StationLite,
  logDebug?: (msg: string) => void,
  options: FetchNowPlayingOptions = {}
): Promise<NowPlayingSnapshot> => {
  const pollMs = options.lowImpact ? 45000 : 30000;
  const probeUrls = buildStationStreamTargets(station);
  if (!probeUrls.length) {
    return buildSnapshot(null, 'unavailable', 'none', 'metadata-unavailable', pollMs);
  }
  const { signal, lowImpact = false } = options;
  if (signal?.aborted) return buildSnapshot(null, 'idle', 'none', null, pollMs);
  const apiBase = getApiBase();
  const apiAvailable = apiBase
    ? await checkApiAvailability(apiBase, { timeoutMs: 1_000 })
    : false;
  if (apiBase && !apiAvailable && logDebug) {
    logDebug('[API] unavailable');
  }
  let apiProxyFailed = false;

  const officialTrack = await fetchOfficialProviderTrack(station, apiBase, apiAvailable, signal);
  if (officialTrack) {
    return buildSnapshot(officialTrack.track, 'ready', officialTrack.source, null, pollMs);
  }

  for (const url of probeUrls) {
    if (signal?.aborted) {
      return buildSnapshot(null, 'idle', 'none', null, pollMs);
    }

    let serverProxyTried = false;
    if (shouldPreferServerMetadata(url)) {
      serverProxyTried = true;
      const server = await fetchServerProxyTrack({
        url,
        apiBase,
        apiAvailable,
        signal,
        logDebug
      });
      apiProxyFailed = apiProxyFailed || server.apiFailed;
      if (server.track) {
        return buildSnapshot(server.track, 'ready', 'server-proxy', null, pollMs);
      }
    }

    try {
      const urlObj = new URL(url);
      const origin = urlObj.origin;
      const path = urlObj.pathname;

      const icecast = await fetchIcecastCORS(origin, path, apiBase, apiAvailable, signal);
      if (icecast) return buildSnapshot(icecast, 'ready', 'icecast', null, pollMs);

      const shoutcast = await fetchShoutcastCORS(origin, apiBase, apiAvailable, signal);
      if (shoutcast) return buildSnapshot(shoutcast, 'ready', 'shoutcast', null, pollMs);

      const azura = await fetchAzuraCast(urlObj.host, apiBase, apiAvailable, signal);
      if (azura) return buildSnapshot(azura, 'ready', 'azuracast', null, pollMs);
    } catch {
      // ignore URL parsing errors for base fetches
    }

    if (lowImpact || signal?.aborted) {
      if (lowImpact && !signal?.aborted && apiBase && apiAvailable && !serverProxyTried) {
        const server = await fetchServerProxyTrack({
          url,
          apiBase,
          apiAvailable,
          signal,
          logDebug
        });
        apiProxyFailed = apiProxyFailed || server.apiFailed;
        if (server.track) {
          return buildSnapshot(server.track, 'ready', 'server-proxy', null, pollMs);
        }
      }
      continue;
    }

    const icy = await fetchIcy(url, 3500, signal);
    if (icy) return buildSnapshot(icy, 'ready', 'icy-stream', null, pollMs);

    if (apiBase && apiAvailable && !signal?.aborted && !serverProxyTried) {
      const server = await fetchServerProxyTrack({
        url,
        apiBase,
        apiAvailable,
        signal,
        logDebug
      });
      apiProxyFailed = apiProxyFailed || server.apiFailed;
      if (server.track) {
        return buildSnapshot(server.track, 'ready', 'server-proxy', null, pollMs);
      }
    }
  }

  if (lowImpact || signal?.aborted) {
    if (logDebug) logDebug('[Metadata] low-impact mode: skipped stream probing');
    return buildSnapshot(
      null,
      signal?.aborted ? 'idle' : 'unavailable',
      'none',
      lowImpact ? 'low-impact-skipped' : null,
      pollMs
    );
  }

  return buildSnapshot(
    null,
    'unavailable',
    'none',
    apiBase && (!apiAvailable || apiProxyFailed) ? 'api-unavailable' : 'metadata-unavailable',
    pollMs
  );
};

export const fetchNowPlaying = async (
  station: StationLite,
  logDebug?: (msg: string) => void,
  options: FetchNowPlayingOptions = {}
) => {
  const snapshot = await fetchNowPlayingSnapshot(station, logDebug, options);
  return snapshot.track;
};

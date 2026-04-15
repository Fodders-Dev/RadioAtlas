import type { NowPlayingFailureKind, NowPlayingSnapshot, NowPlayingSource } from '../domain/contracts';
import type { StationLite } from '../types';
import { getApiBase } from './apiBase';
import { checkApiAvailability, markApiUnavailable } from './apiAvailability';

const STREAM_TITLE = /StreamTitle='([^']+)'/i;
const textDecoder = new TextDecoder('utf-8');

type FetchNowPlayingOptions = {
  signal?: AbortSignal;
  lowImpact?: boolean;
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

const buildTrack = (artist?: string, title?: string) => {
  const parts = [artist, title].filter(Boolean);
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

const fetchIcy = async (
  url: string,
  timeoutMs = 6000,
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
          const metadata = textDecoder.decode(metaBytes);
          const match = metadata.match(STREAM_TITLE);
          return match?.[1]?.trim() || null;
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
  return song?.text || buildTrack(song?.artist, song?.title);
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
  };
};

type StationSnapshotListener = (snapshot: NowPlayingSnapshot) => void;

type StationSnapshotEntry = {
  key: string;
  station: StationLite;
  snapshot: NowPlayingSnapshot;
  listeners: Set<StationSnapshotListener>;
  inFlight: Promise<void> | null;
  timer: ReturnType<typeof window.setTimeout> | null;
  cleanupTimer: ReturnType<typeof window.setTimeout> | null;
  liveUnsubscribe: (() => void) | null;
};

const STATION_CACHE_TTL_MS = 5 * 60_000;
const LAST_KNOWN_TRACKS_STORAGE_KEY = 'radio:last-known-tracks';
const LAST_KNOWN_TRACKS_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14;
const LAST_KNOWN_TRACKS_LIMIT = 600;
const MAX_METADATA_CONCURRENCY = 4;
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
  recommendedPollMs: shouldUseLowImpactMetadata() ? 45_000 : 15_000,
  updatedAt: null
});

const readStoredTrackCache = () => {
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
  return storedTrackCache;
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
  if (Date.now() - entry.updatedAt > LAST_KNOWN_TRACKS_MAX_AGE_MS) {
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
  const waitMs = Math.max(delayMs ?? entry.snapshot.recommendedPollMs ?? 15_000, 5_000);
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
        recommendedPollMs: lowImpact ? 45_000 : 15_000,
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
  onSnapshot: StationSnapshotListener
) => {
  const entry = getStationEntry(station);
  clearCleanupTimer(entry);
  entry.listeners.add(onSnapshot);
  onSnapshot(entry.snapshot);

  if (!entry.liveUnsubscribe) {
    const liveUnsubscribe = subscribeNowPlaying(entry.station, (track) => {
      if (track) {
        saveStoredTrack(entry.key, track);
      }
      entry.snapshot = {
        track,
        status: track ? 'ready' : 'unavailable',
        source: 'nightride-sse',
        failureKind: track ? null : 'metadata-unavailable',
        recommendedPollMs: 15_000,
        updatedAt: track ? Date.now() : null
      };
      emitStationSnapshot(entry);
      scheduleStationRefresh(entry, entry.snapshot.recommendedPollMs);
    });
    if (liveUnsubscribe) {
      entry.liveUnsubscribe = liveUnsubscribe;
    }
  }

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
    if (best.title) return best.title;
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
    return parts[6] || null;
  }
  return null;
};

export const fetchNowPlayingSnapshot = async (
  station: StationLite,
  logDebug?: (msg: string) => void,
  options: FetchNowPlayingOptions = {}
): Promise<NowPlayingSnapshot> => {
  const url = station.url_resolved;
  const pollMs = options.lowImpact ? 45000 : 15000;
  if (!url) return buildSnapshot(null, 'unavailable', 'none', 'metadata-unavailable', pollMs);
  const { signal, lowImpact = false } = options;
  if (signal?.aborted) return buildSnapshot(null, 'idle', 'none', null, pollMs);
  const apiBase = getApiBase();
  const apiAvailable = apiBase
    ? await checkApiAvailability(apiBase, { timeoutMs: 1_000 })
    : false;
  if (apiBase && !apiAvailable && logDebug) {
    logDebug('[API] unavailable');
  }

  try {
    const urlObj = new URL(url);
    const origin = urlObj.origin;
    const path = urlObj.pathname;

    // 1. Try generic Icecast JSON (fast, reliable if CORS allowed)
    const icecast = await fetchIcecastCORS(origin, path, apiBase, apiAvailable, signal);
    if (icecast) return buildSnapshot(icecast, 'ready', 'icecast', null, pollMs);

    // 2. Try generic Shoutcast (fast, reliable if CORS allowed)
    const shoutcast = await fetchShoutcastCORS(origin, apiBase, apiAvailable, signal);
    if (shoutcast) return buildSnapshot(shoutcast, 'ready', 'shoutcast', null, pollMs);

    // 3. Try AzuraCast API (specific to AzuraCast hosts)
    const azura = await fetchAzuraCast(urlObj.host, apiBase, apiAvailable, signal);
    if (azura) return buildSnapshot(azura, 'ready', 'azuracast', null, pollMs);

  } catch {
    // ignore URL parsing errors for base fetches
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

  // 4. Fallback: Try reading Icy Metadata from the stream itself
  // First, try client-side (unlikely to work without CORS)
  const icy = await fetchIcy(url, 6000, signal);
  if (icy) return buildSnapshot(icy, 'ready', 'icy-stream', null, pollMs);

  // 5. Final Resort: Server-side Metadata Proxy
  // Ask our own API server to connect and parse the metadata for us
  if (apiBase && apiAvailable && !signal?.aborted) {
    try {
      const res = await fetch(`${apiBase}/metadata?url=${encodeURIComponent(url)}`, {
        signal
      });

      let data: any = null;
      if (res.ok) {
        data = await res.json();

        if (data.logs && logDebug && Array.isArray(data.logs)) {
          data.logs.forEach((l: string) => logDebug(`[SSR] ${l}`));
        }

        const serverTrack = data.title || data.nowPlaying || null;
        if (serverTrack) return buildSnapshot(serverTrack, 'ready', 'server-proxy', null, pollMs);
      } else {
        // try parsing error response
        try {
          const errorData = await res.json();
          if (errorData.logs && logDebug && Array.isArray(errorData.logs)) {
            errorData.logs.forEach((l: string) => logDebug(`[SSR FAIL] ${l}`));
          }
        } catch {
          if (logDebug) logDebug(`[SSR] API Error ${res.status}`);
        }
      }
    } catch (e) {
      markApiUnavailable(apiBase);
      if (logDebug) logDebug(`[SSR] Fetch Fail: ${e}`);
      return buildSnapshot(null, 'unavailable', 'server-proxy', 'api-unavailable', pollMs);
    }
  }

  return buildSnapshot(
    null,
    'unavailable',
    'none',
    apiBase && !apiAvailable ? 'api-unavailable' : 'metadata-unavailable',
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

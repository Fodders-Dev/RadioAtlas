import type { StationLite } from '../types';

const STREAM_TITLE = /StreamTitle='([^']+)'/i;
const textDecoder = new TextDecoder('utf-8');

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

const fetchIcy = async (url: string, timeoutMs = 6000): Promise<string | null> => {
  if (!url || !url.startsWith('https://')) return null;

  const controller = new AbortController();
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

const fetchAzuraCast = async (host: string): Promise<string | null> => {
  const endpoints = [
    `https://${host}/api/nowplaying/1`,
    `https://${host}/api/nowplaying`
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { cache: 'no-store' });
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

export const fetchNowPlaying = async (station: StationLite) => {
  const url = station.url_resolved;
  if (!url) return null;

  try {
    const host = new URL(url).host;
    const azura = await fetchAzuraCast(host);
    if (azura) return azura;
  } catch {
    // ignore url parse errors
  }

  return fetchIcy(url);
};

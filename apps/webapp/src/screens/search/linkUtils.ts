import type { StationLite } from '../../types';
import type { ExternalLink, ExtractAudioStream } from './types';

const BLOCKED_HOSTS = ['youtube.com', 'youtu.be', 'music.youtube.com', 'youtube-nocookie.com'];

export const getHost = (value: string) => {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return '';
  }
};

export const isBlocked = (value: string) =>
  BLOCKED_HOSTS.some((host) => getHost(value).includes(host));

export const isPlaylistUrl = (value: string) => /\.(m3u8?|pls)(\?|#|$)/i.test(value);
export const isDirectAudioUrl = (value: string) =>
  /\.(mp3|aac|m4a|ogg|opus|flac|wav|aiff?|mp2)(\?|#|$)/i.test(value);

export const stripTrackingParams = (value: string) => {
  try {
    const url = new URL(value);
    const params = url.searchParams;
    Array.from(params.keys()).forEach((key) => {
      if (key.toLowerCase().startsWith('utm_')) {
        params.delete(key);
      }
    });
    url.search = params.toString();
    return url.toString();
  } catch {
    return value;
  }
};

export const normalizeUrl = (value: string) => {
  try {
    return stripTrackingParams(new URL(value.trim()).toString());
  } catch {
    return '';
  }
};

export const deriveName = (value: string) => {
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return 'External audio';
  }
};

export const pickBestStream = (streams: ExtractAudioStream[]) => {
  if (!streams.length) return null;
  return streams
    .filter((stream) => Boolean(stream.url))
    .sort((a, b) => {
      const score = (item: ExtractAudioStream) => Math.max(item.averageBitrate || 0, item.bitrate || 0);
      return score(b) - score(a);
    })[0];
};

export const toExternalStation = (item: ExternalLink): StationLite => ({
  stationuuid: `ext_${item.id}`,
  name: item.name,
  url_resolved: item.url,
  homepage: '',
  favicon: '',
  country: 'External',
  state: '',
  tags: 'external',
  geo_lat: null,
  geo_long: null,
  stationArtwork: null
});

export const parseM3u = (text: string, baseUrl: string) => {
  const items: { url: string; name?: string }[] = [];
  const lines = text.split(/\r?\n/);
  let pendingName: string | null = null;
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('#EXTINF')) {
      const parts = trimmed.split(',');
      if (parts.length > 1) {
        pendingName = parts.slice(1).join(',').trim();
      }
      return;
    }
    if (trimmed.startsWith('#')) return;
    try {
      const absolute = new URL(trimmed, baseUrl).toString();
      items.push({ url: absolute, name: pendingName || undefined });
    } catch {
      // ignore malformed lines
    } finally {
      pendingName = null;
    }
  });
  return items;
};

export const parsePls = (text: string, baseUrl: string) => {
  const urls = new Map<number, string>();
  const titles = new Map<number, string>();
  text.split(/\r?\n/).forEach((line) => {
    const fileMatch = line.match(/^File(\d+)=(.+)$/i);
    const titleMatch = line.match(/^Title(\d+)=(.+)$/i);
    if (fileMatch) {
      const idx = Number(fileMatch[1]);
      try {
        urls.set(idx, new URL(fileMatch[2].trim(), baseUrl).toString());
      } catch {
        // ignore malformed urls
      }
    }
    if (titleMatch) {
      titles.set(Number(titleMatch[1]), titleMatch[2].trim());
    }
  });
  return Array.from(urls.entries()).map(([idx, url]) => ({ url, name: titles.get(idx) }));
};

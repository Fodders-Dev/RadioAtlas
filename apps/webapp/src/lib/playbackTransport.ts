import type { PlaybackCandidate, PlaybackFailure, PlaybackFailureKind } from '../domain/contracts';
import type { StationLite } from '../types';
import { hasExplicitApiBase } from './apiBase';

type ExtractAudioStream = {
  url: string;
  bitrate?: number;
  averageBitrate?: number;
};

type ExtractItem = {
  url?: string;
};

type ExtractResponse = {
  type: 'stream' | 'playlist' | 'error';
  audioStreams?: ExtractAudioStream[];
  items?: ExtractItem[];
  error?: string;
};

export type CandidatePlan = {
  candidates: PlaybackCandidate[];
  blockedMixedContent: boolean;
  apiUnavailable: boolean;
};

const normalizeBase = (value?: string) => (value ? value.replace(/\/+$/, '') : '');

export const isHls = (url: string) => url.toLowerCase().includes('.m3u8');
export const isDirectAudioUrl = (url: string) =>
  /\.(mp3|aac|m4a|ogg|opus|flac|wav|aiff?|mp2)(\?|#|$)/i.test(url);

const isSecureProxyContext = () => {
  if (typeof window === 'undefined') return false;
  return window.location.protocol === 'https:';
};

const shouldPreferProxy = (apiBase: string) =>
  Boolean(normalizeBase(apiBase)) && (isSecureProxyContext() || hasExplicitApiBase());

export const isExternalStation = (station: StationLite) =>
  station.stationuuid.startsWith('ext_') ||
  station.country === 'External' ||
  station.tags?.includes('external');

const buildProxyUrl = (url: string, apiBase: string) =>
  `${normalizeBase(apiBase)}/stream?url=${encodeURIComponent(url)}`;

const pushUniqueCandidate = (
  items: PlaybackCandidate[],
  candidate: PlaybackCandidate
) => {
  if (!candidate.url) return;
  if (items.some((item) => item.url === candidate.url)) return;
  items.push(candidate);
};

const buildUrlVariants = (url: string) => {
  const directPreferred: string[] = [];
  const proxyInputs: string[] = [url];

  if (url.startsWith('http://')) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      if (
        host === 'fallout.fm' &&
        parsed.port === '8000' &&
        /^\/falloutfm\d+\.ogg$/i.test(parsed.pathname)
      ) {
        const upgraded = new URL(url);
        upgraded.protocol = 'https:';
        upgraded.port = '8444';
        directPreferred.push(upgraded.toString());
      }
      if (host === 'gyusyabu.ddo.jp' && parsed.pathname === '/') {
        const streamMount = new URL(url);
        streamMount.pathname = '/;stream.mp3';
        directPreferred.push(streamMount.toString().replace(/^http:\/\//, 'https://'));
        proxyInputs.push(streamMount.toString());
      }
    } catch {
      // ignore invalid URL
    }
    if (isDirectAudioUrl(url)) {
      directPreferred.push(url.replace(/^http:\/\//, 'https://'));
    }
  } else {
    directPreferred.push(url);
  }

  return {
    directPreferred: Array.from(new Set(directPreferred.filter(Boolean))),
    proxyInputs: Array.from(new Set(proxyInputs.filter(Boolean)))
  };
};

export const shouldAttemptStreamExtraction = (url: string) => !isDirectAudioUrl(url) && !isHls(url);

export const needsApiAssist = (station: StationLite, sourceUrls: string[]) =>
  sourceUrls.some(
    (url) =>
      url.startsWith('http://') ||
      isHls(url) ||
      (isSecureProxyContext() && url.startsWith('https://') && !isDirectAudioUrl(url))
  );

const modeForUrl = (url: string, isFallback: boolean): PlaybackCandidate['mode'] => {
  if (url.includes('/stream?url=')) return 'proxy';
  if (isHls(url)) return 'hls';
  if (isFallback) return 'extracted';
  return 'direct';
};

export const buildCandidates = ({
  url,
  apiBase,
  apiAvailable,
  isFallback = false
}: {
  url: string;
  apiBase: string;
  apiAvailable: boolean;
  isFallback?: boolean;
}): CandidatePlan => {
  const candidates: PlaybackCandidate[] = [];
  const normalizedBase = normalizeBase(apiBase);
  const isHttpLocal = typeof window !== 'undefined' && window.location.protocol === 'http:';
  const isHttpUrl = url.startsWith('http://') || url.startsWith('https://');
  const proxyRelevant = isHttpUrl || isHls(url) || !isDirectAudioUrl(url);
  const canUseProxy = Boolean(normalizedBase) && proxyRelevant && apiAvailable;
  const shouldPreferProxyCandidate = canUseProxy && shouldPreferProxy(normalizedBase);
  const shouldForceProxyForHttp = url.startsWith('http://') && canUseProxy;
  const blockedMixedContent = url.startsWith('http://') && !isHttpLocal && !canUseProxy;
  const { directPreferred, proxyInputs } = buildUrlVariants(url);

  const addDirect = (candidateUrl: string) =>
    pushUniqueCandidate(candidates, {
      url: candidateUrl,
      sourceUrl: url,
      mode: modeForUrl(candidateUrl, isFallback),
      label: isFallback ? 'resolved fallback' : 'direct stream',
      isFallback
    });
  const addProxy = (candidateUrl: string) =>
    pushUniqueCandidate(candidates, {
      url: buildProxyUrl(candidateUrl, normalizedBase),
      sourceUrl: candidateUrl,
      mode: 'proxy',
      label: isFallback ? 'proxy fallback' : 'proxy stream',
      isFallback
    });

  if (url.startsWith('http://')) {
    if (shouldForceProxyForHttp) {
      proxyInputs.forEach(addProxy);
    } else if (isHttpLocal) {
      directPreferred.forEach(addDirect);
      addDirect(url);
    } else if (directPreferred.length) {
      directPreferred.forEach(addDirect);
    }
    if (canUseProxy && !shouldForceProxyForHttp) {
      proxyInputs.forEach(addProxy);
    }
  } else {
    if (shouldPreferProxyCandidate) {
      proxyInputs.forEach(addProxy);
    }
    directPreferred.forEach(addDirect);
    if (canUseProxy && !shouldPreferProxyCandidate) {
      proxyInputs.forEach(addProxy);
    }
  }

  return {
    candidates,
    blockedMixedContent,
    apiUnavailable: Boolean(normalizedBase) && !apiAvailable && proxyRelevant && !blockedMixedContent
  };
};

const playbackFailureKindFromMessage = (message: string, options: { blockedMixedContent?: boolean; apiUnavailable?: boolean } = {}): PlaybackFailureKind => {
  if (options.blockedMixedContent || message === 'stream blocked/mixed content') return 'mixed-content';
  if (options.apiUnavailable || message === 'api unavailable') return 'api-unavailable';
  if (message === 'playback superseded') return 'superseded';
  if (message === 'no playable candidate') return 'no-playable-candidate';
  if (message === 'media source not supported') return 'unsupported-transport';
  if (message === 'media network error') return 'stream-unavailable';
  return 'unknown';
};

export const toPlaybackFailure = (
  message: string,
  options: {
    blockedMixedContent?: boolean;
    apiUnavailable?: boolean;
    url?: string;
    phase?: PlaybackFailure['phase'];
  } = {}
): PlaybackFailure => {
  const normalizedMessage = options.blockedMixedContent
    ? 'stream blocked/mixed content'
    : options.apiUnavailable
      ? 'api unavailable'
      : message || 'no playable candidate';
  const kind = playbackFailureKindFromMessage(normalizedMessage, options);
  return {
    kind,
    message: normalizedMessage,
    url: options.url,
    phase: options.phase,
    recoverable: !['mixed-content', 'unsupported-transport'].includes(kind)
  };
};

const pickBestStream = (streams: ExtractAudioStream[]) => {
  if (!streams.length) return null;
  return streams
    .filter((stream) => Boolean(stream.url))
    .sort((a, b) => {
      const score = (item: ExtractAudioStream) => Math.max(item.averageBitrate || 0, item.bitrate || 0);
      return score(b) - score(a);
    })[0];
};

export const resolveExternalStream = async (
  url: string,
  apiBase: string,
  log: (message: string) => void,
  depth = 0
): Promise<string | null> => {
  if (depth > 1) {
    log('extract: depth limit reached');
    return null;
  }
  const base = normalizeBase(apiBase);
  if (!base) {
    log('extract: api base missing');
    return null;
  }

  try {
    log(`extract: request ${url}`);
    const response = await fetch(`${base}/extract?url=${encodeURIComponent(url)}`);
    const data = (await response.json()) as ExtractResponse;
    if (!response.ok || data?.type === 'error') {
      const errorMsg = data?.error ? ` (${data.error})` : '';
      log(`extract: http ${response.status}${errorMsg}`);
      return null;
    }
    if (data.type === 'stream') {
      const best = pickBestStream(data.audioStreams || []);
      if (best?.url) {
        log(`extract: stream ${best.url}`);
        return best.url;
      }
      log('extract: no audio streams');
      return null;
    }
    const nextUrl = data.items?.find((item) => item.url)?.url;
    if (!nextUrl) {
      log('extract: playlist empty');
      return null;
    }
    log(`extract: playlist -> ${nextUrl}`);
    return resolveExternalStream(nextUrl, base, log, depth + 1);
  } catch (err) {
    log(`extract: failed (${err instanceof Error ? err.message : 'unknown'})`);
    return null;
  }
};

import type { PlaybackCandidate, PlaybackFailure, PlaybackFailureKind } from '../domain/contracts';
import type { StationLite } from '../types';
import { hasExplicitApiBase } from './apiBase';
import { shouldForceProxyStreaming } from './runtimeHints';

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

// These upstreams were measured from the listener route, not merely marked
// healthy by Radio Browser. Keep the list deliberately tiny: proxying every
// direct MP3 would turn our server into the default bandwidth path.
const PROXY_FIRST_UPSTREAM_HOSTS = new Set(['radio.gamesboro.org']);

const shouldPreferProxyForUpstream = (url: string) => {
  try {
    return PROXY_FIRST_UPSTREAM_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
};

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
      (shouldForceProxyStreaming() && url.startsWith('https://')) ||
      (isSecureProxyContext() && url.startsWith('https://'))
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
  // T_share_fix: an http:// stream on a secure (https) page can ONLY play via
  // the same-origin /api/stream proxy — the direct URL is mixed-content blocked.
  // The proxy is therefore mandatory here, not optional: gating it behind the
  // racy 2.2s apiAvailable check dropped the sole viable candidate on a cold
  // deep-link mount (audio_no_playable_candidate → dock stuck). apiAvailable
  // stays a proxy-vs-direct *preference* for https streams; for http-on-https it
  // must not be a gate. (Same-origin proxy: if the https app loaded, it's
  // reachable — and trying it and failing beats "no candidate".)
  const httpProxyMandatory =
    url.startsWith('http://') && !isHttpLocal && Boolean(normalizedBase);
  const canUseProxy =
    Boolean(normalizedBase) && proxyRelevant && (apiAvailable || httpProxyMandatory);
  const shouldForceProxyCandidate = canUseProxy && shouldForceProxyStreaming();
  // A filename extension says what the response should contain, not whether the
  // route can actually deliver it. Keep ordinary healthy MP3/AAC streams on the
  // direct path with the same-origin proxy as fallback. A tiny set of measured
  // bad routes is proxy-first instead: Gamesboro sat at readyState=0 for 25-30s
  // on direct while the RU proxy started immediately. Extensionless streams and
  // HLS keep their existing proxy-first order; constrained runtimes still force
  // the proxy.
  const measuredProxyFirst = canUseProxy && shouldPreferProxyForUpstream(url);
  const directAudioProxyFallback =
    url.startsWith('https://') &&
    isDirectAudioUrl(url) &&
    !shouldForceProxyCandidate &&
    !measuredProxyFirst;
  const shouldPreferProxyCandidate =
    measuredProxyFirst ||
    (canUseProxy && shouldPreferProxy(normalizedBase) && !directAudioProxyFallback);
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
    } else if (isHttpLocal && !shouldForceProxyCandidate) {
      directPreferred.forEach(addDirect);
      addDirect(url);
    } else if (directPreferred.length && !shouldForceProxyCandidate) {
      directPreferred.forEach(addDirect);
    }
    if (canUseProxy && !shouldForceProxyForHttp) {
      proxyInputs.forEach(addProxy);
    }
  } else {
    if (shouldForceProxyCandidate || shouldPreferProxyCandidate) {
      proxyInputs.forEach(addProxy);
    }
    if (!shouldForceProxyCandidate) {
      directPreferred.forEach(addDirect);
    }
    if (canUseProxy && !shouldPreferProxyCandidate && !shouldForceProxyCandidate) {
      proxyInputs.forEach(addProxy);
    }
  }

  return {
    candidates,
    blockedMixedContent,
    // `&& !canUseProxy`: when the proxy was built anyway (the http-on-https
    // mandatory case), the plan is NOT api-unavailable — we have a candidate.
    // Preserves the https-stream "API down → apiUnavailable" signal.
    apiUnavailable:
      Boolean(normalizedBase) && !apiAvailable && proxyRelevant && !blockedMixedContent && !canUseProxy
  };
};

const playbackFailureKindFromMessage = (message: string, options: { blockedMixedContent?: boolean; apiUnavailable?: boolean } = {}): PlaybackFailureKind => {
  if (options.blockedMixedContent || message === 'stream blocked/mixed content') return 'mixed-content';
  if (options.apiUnavailable || message === 'api unavailable') return 'api-unavailable';
  if (message === 'playback superseded') return 'superseded';
  if (message === 'no playable candidate') return 'no-playable-candidate';
  if (message === 'media source not supported') return 'unsupported-transport';
  if (message === 'media network error') return 'stream-unavailable';
  // The browser's own words, which are what actually arrive here most of the
  // time. Everything below used to fall through to 'unknown', and that single
  // gap is why a third of all plays could fail for weeks without anyone being
  // able to say why: the telemetry recorded `failureKind=unknown` while the raw
  // `detail` — sitting in the same event — said `The operation was aborted.`
  // DOMException.name is not always available by the time a message reaches
  // this function, so both the name and the message text are matched.
  const lowered = message.toLowerCase();
  if (lowered.includes('aborterror') || lowered.includes('operation was aborted')) {
    // Someone called load() or pause() over an unsettled play(). After the
    // candidate-switch guard this should be rare; if it climbs again, that guard
    // has a hole rather than the station being dead.
    return 'play-failed';
  }
  if (
    lowered.includes('notsupportederror') ||
    lowered.includes('operation is not supported') ||
    lowered.includes('no supported source')
  ) {
    return 'unsupported-transport';
  }
  if (lowered.includes('notallowederror') || lowered.includes("user didn't interact")) {
    // Autoplay policy: the listener has to tap, and that is not a broken stream.
    return 'play-failed';
  }
  if (lowered.includes('media decode error') || lowered.includes('decode')) {
    return 'unsupported-transport';
  }
  if (lowered.includes('networkerror') || lowered.includes('network error')) {
    return 'stream-unavailable';
  }
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

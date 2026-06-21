import type { PlaybackCandidate, PlaybackCandidateMode, PlaybackFailureKind } from '../domain/contracts';
import type { StationLite } from '../types';

export type StationHealthSignalKind =
  | 'direct-https-success'
  | 'proxy-success'
  | 'hls-success'
  | 'extracted-success'
  | 'startup-success'
  | 'stream-failure'
  | 'unsupported-transport'
  | 'mixed-content'
  | 'api-required-failed'
  | 'metadata-unavailable'
  | 'duplicate-detected';

export type StationHealthSignal = {
  stationId: string;
  successes: number;
  failures: number;
  hardFailures: number;
  directSuccesses: number;
  proxySuccesses: number;
  hlsSuccesses: number;
  extractedSuccesses: number;
  metadataMisses: number;
  duplicateHints: number;
  startupMsAvg: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastEventAt: number;
  lastKind: StationHealthSignalKind;
};

export type StationHealthProfile = {
  version: 1;
  signals: Record<string, StationHealthSignal>;
};

export type ResolveBestPlayableCandidateOptions = {
  apiAvailable?: boolean;
  apiBase?: string | null;
};

export type ResolvedPlayableCandidate = {
  station: StationLite;
  sourceUrl: string;
  preferredTransport: PlaybackCandidateMode | 'external';
  requiresProxy: boolean;
  playableScore: number;
  suppressed: boolean;
};

export const DEFAULT_STATION_HEALTH_PROFILE: StationHealthProfile = {
  version: 1,
  signals: {}
};

const MAX_HEALTH_SIGNALS = 220;
const HEALTH_SIGNAL_TTL_MS = 1000 * 60 * 60 * 24 * 21;
const RECENT_HEALTH_FAILURE_WINDOW_MS = 1000 * 60 * 60 * 12;
const HARD_HEALTH_FAILURES = new Set<StationHealthSignalKind>([
  'stream-failure',
  'unsupported-transport',
  'mixed-content',
  'api-required-failed'
]);

const stationIdOf = (station: StationLite | string) =>
  typeof station === 'string' ? station : station.stationuuid;

const getSignal = (
  profile: StationHealthProfile | null | undefined,
  station: StationLite | string,
  now = Date.now()
) => {
  const signal = profile?.signals?.[stationIdOf(station)];
  if (!signal) return null;
  if (now - signal.lastEventAt > HEALTH_SIGNAL_TTL_MS) return null;
  return signal;
};

const trimSignals = (
  signals: Record<string, StationHealthSignal>,
  now: number
): Record<string, StationHealthSignal> =>
  Object.fromEntries(
    Object.entries(signals)
      .filter(([, signal]) => now - signal.lastEventAt <= HEALTH_SIGNAL_TTL_MS)
      .sort((left, right) => right[1].lastEventAt - left[1].lastEventAt)
      .slice(0, MAX_HEALTH_SIGNALS)
  );

const isHlsUrl = (url: string) => /\.m3u8(?:[?#]|$)/i.test(url);

export const stationHealthSuccessKindForCandidate = (
  station: StationLite,
  candidate?: PlaybackCandidate | null
): StationHealthSignalKind => {
  if (candidate?.mode === 'proxy') return 'proxy-success';
  if (candidate?.mode === 'hls') return 'hls-success';
  if (candidate?.mode === 'extracted') return 'extracted-success';
  const url = candidate?.sourceUrl || station.url_resolved || station.url || '';
  if (isHlsUrl(url)) return 'hls-success';
  if (url.startsWith('http://')) return 'proxy-success';
  return 'direct-https-success';
};

export const stationHealthFailureKindForPlayback = (
  failure: PlaybackFailureKind
): StationHealthSignalKind => {
  if (failure === 'mixed-content') return 'mixed-content';
  if (failure === 'unsupported-transport') return 'unsupported-transport';
  if (failure === 'api-unavailable' || failure === 'extract-failed') return 'api-required-failed';
  return 'stream-failure';
};

export const recordStationHealthSignal = (
  profile: StationHealthProfile,
  station: StationLite | string,
  kind: StationHealthSignalKind,
  {
    now = Date.now(),
    startupMs = null
  }: {
    now?: number;
    startupMs?: number | null;
  } = {}
): StationHealthProfile => {
  const baseProfile = profile?.version === 1 ? profile : DEFAULT_STATION_HEALTH_PROFILE;
  const stationId = stationIdOf(station);
  if (!stationId) return baseProfile;

  const current = getSignal(baseProfile, stationId, now);
  const base: StationHealthSignal =
    current || {
      stationId,
      successes: 0,
      failures: 0,
      hardFailures: 0,
      directSuccesses: 0,
      proxySuccesses: 0,
      hlsSuccesses: 0,
      extractedSuccesses: 0,
      metadataMisses: 0,
      duplicateHints: 0,
      startupMsAvg: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastEventAt: now,
      lastKind: kind
    };

  if (kind === 'metadata-unavailable') {
    return {
      version: 1,
      signals: trimSignals(
        {
          ...(baseProfile.signals || {}),
          [stationId]: {
            ...base,
            metadataMisses: Math.min(99, base.metadataMisses + 1),
            lastEventAt: now,
            lastKind: kind
          }
        },
        now
      )
    };
  }

  const success = kind.endsWith('-success') || kind === 'startup-success';
  const nextStartupAvg =
    success && typeof startupMs === 'number' && Number.isFinite(startupMs)
      ? Math.round(base.startupMsAvg === null ? startupMs : base.startupMsAvg * 0.7 + startupMs * 0.3)
      : base.startupMsAvg;
  const nextSignal: StationHealthSignal = success
    ? {
        ...base,
        successes: Math.min(999, base.successes + 1),
        failures: Math.max(0, base.failures - 1),
        hardFailures: Math.max(0, base.hardFailures - 1),
        directSuccesses: base.directSuccesses + (kind === 'direct-https-success' ? 1 : 0),
        proxySuccesses: base.proxySuccesses + (kind === 'proxy-success' ? 1 : 0),
        hlsSuccesses: base.hlsSuccesses + (kind === 'hls-success' ? 1 : 0),
        extractedSuccesses: base.extractedSuccesses + (kind === 'extracted-success' ? 1 : 0),
        startupMsAvg: nextStartupAvg,
        lastSuccessAt: now,
        lastEventAt: now,
        lastKind: kind
      }
    : {
        ...base,
        failures: Math.min(999, base.failures + 1),
        hardFailures: Math.min(999, base.hardFailures + (HARD_HEALTH_FAILURES.has(kind) ? 1 : 0)),
        duplicateHints: base.duplicateHints + (kind === 'duplicate-detected' ? 1 : 0),
        lastFailureAt: now,
        lastEventAt: now,
        lastKind: kind
      };

  return {
    version: 1,
    signals: trimSignals(
      {
        ...(baseProfile.signals || {}),
        [stationId]: nextSignal
      },
      now
    )
  };
};

export const getStationHealthScore = (
  profile: StationHealthProfile | null | undefined,
  station: StationLite | string,
  now = Date.now()
) => {
  const signal = getSignal(profile, station, now);
  if (!signal) return 0;
  const ageFactor = Math.max(0.32, 1 - (now - signal.lastEventAt) / HEALTH_SIGNAL_TTL_MS);
  const lastSuccessAt = signal.lastSuccessAt || 0;
  const lastFailureAt = signal.lastFailureAt || 0;
  const recentFailure =
    lastFailureAt > lastSuccessAt && now - lastFailureAt <= RECENT_HEALTH_FAILURE_WINDOW_MS
      ? 4.5
      : 0;
  const transportSuccess =
    signal.directSuccesses * 1.4 +
    signal.proxySuccesses * 1.55 +
    signal.hlsSuccesses * 1.45 +
    signal.extractedSuccesses * 0.95;
  const startupBonus =
    signal.startupMsAvg === null
      ? 0
      : signal.startupMsAvg <= 2500
        ? 1.2
        : signal.startupMsAvg <= 7000
          ? 0.35
          : -0.8;
  const failurePenalty = signal.failures * 1.8 + signal.hardFailures * 2.4 + recentFailure;
  return (signal.successes * 0.9 + transportSuccess + startupBonus - failurePenalty) * ageFactor;
};

export const isStationSuppressedByHealth = (
  profile: StationHealthProfile | null | undefined,
  station: StationLite | string,
  now = Date.now()
) => {
  const signal = getSignal(profile, station, now);
  if (!signal || signal.hardFailures < 2 || !signal.lastFailureAt) return false;
  const lastSuccessAt = signal.lastSuccessAt || 0;
  return signal.lastFailureAt > lastSuccessAt && now - signal.lastFailureAt <= RECENT_HEALTH_FAILURE_WINDOW_MS;
};

// True when the station's MOST RECENT health event (within the signal TTL) was a
// metadata miss — i.e. we played it and it sent no track title. A playback
// SUCCESS overwrites lastKind to a *-success kind (recordStationHealthSignal), so
// a single good play/title clears this immediately. Deliberately NOT keyed on
// metadataMisses (that counter only increments, capped 99, and never resets — it
// would stick for the full 21-day TTL after a station resumes titles). Heuristic
// for the «нет названий» badge; Phase F swaps in the harvested supports_metadata.
export const isStationMetadataUnavailable = (
  profile: StationHealthProfile | null | undefined,
  station: StationLite | string,
  now = Date.now()
): boolean => {
  const signal = getSignal(profile, station, now);
  return Boolean(signal && signal.lastKind === 'metadata-unavailable');
};

export const resolveBestPlayableCandidate = (
  station: StationLite,
  healthProfile: StationHealthProfile | null | undefined,
  options: ResolveBestPlayableCandidateOptions = {}
): ResolvedPlayableCandidate => {
  const sourceUrl = station.url_resolved || station.url || '';
  const requiresProxy = sourceUrl.startsWith('http://');
  const hasApi = Boolean(options.apiAvailable && options.apiBase);
  const preferredTransport: ResolvedPlayableCandidate['preferredTransport'] = isHlsUrl(sourceUrl)
    ? 'hls'
    : requiresProxy && hasApi
      ? 'proxy'
      : requiresProxy
        ? 'external'
        : 'direct';

  return {
    station,
    sourceUrl,
    preferredTransport,
    requiresProxy,
    playableScore: getStationHealthScore(healthProfile, station),
    suppressed: isStationSuppressedByHealth(healthProfile, station)
  };
};

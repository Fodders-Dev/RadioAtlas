import type { PlaybackFailure, NowPlayingStatus } from '../domain/contracts';
import type { StationLite } from '../types';
import type { TrackHistoryItem } from '../state/radio/types';

export type NowPlayingTrustKind = 'with-metadata' | 'without-metadata' | 'questionable-stream';

export type NowPlayingTrust = {
  kind: NowPlayingTrustKind;
  track: string | null;
};

const TECHNICAL_PAYLOAD = /^\{.*"(status|message|result|errorCode|error)".*\}\s*\d*$/i;
const URL_LIKE = /^https?:\/\/\S+$/i;
const HTML_LIKE = /^<[^>]+>$/;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const FILLER_TITLES = new Set([
  '-',
  '--',
  '...',
  'loading',
  'loading...',
  'unknown',
  'unknown title',
  'unknown artist',
  'n/a',
  'none',
  'null',
  'undefined',
  'live',
  'live radio',
  'stream',
  'radio',
  'no title',
  'no artist',
  'metadata unavailable',
  'track metadata is not here yet',
  'трек ещё не пришёл',
  'трек еще не пришел',
  'загрузка'
]);
const QUESTIONABLE_FAILURES = new Set(['mixed-content', 'api-unavailable', 'unsupported-transport']);
const TRACK_HISTORY_DEDUPE_WINDOW_MS = 1000 * 60 * 60 * 6;

const normalizeComparable = (value?: string | null) =>
  value?.trim().replace(/\s+/g, ' ').toLowerCase() || '';

export const normalizeTrustedTrackTitle = (
  value?: string | null,
  station?: Pick<StationLite, 'name' | 'url_resolved' | 'url' | 'homepage'> | null
) => {
  if (typeof value !== 'string') return null;
  const cleaned = value
    .replace(/\0/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+-\s+-\s+/g, ' - ')
    .trim();
  if (!cleaned || cleaned.length < 2 || cleaned.length > 180) return null;
  if (cleaned.includes('\uFFFD') || CONTROL_CHARS.test(cleaned)) return null;
  if (TECHNICAL_PAYLOAD.test(cleaned) || URL_LIKE.test(cleaned) || HTML_LIKE.test(cleaned)) {
    return null;
  }
  if (/^(error|failed|exception|timeout|forbidden|unauthorized)\b/i.test(cleaned)) return null;
  if (/^(.)\1{5,}$/.test(cleaned)) return null;
  if (!/[a-zа-яё0-9]/i.test(cleaned)) return null;

  const comparable = normalizeComparable(cleaned);
  if (FILLER_TITLES.has(comparable)) return null;
  if (station) {
    const stationName = normalizeComparable(station.name);
    const stationUrl = normalizeComparable(station.url_resolved || station.url);
    const stationHomepage = normalizeComparable(station.homepage);
    if (comparable === stationName || comparable === stationUrl || comparable === stationHomepage) {
      return null;
    }
  }

  return cleaned;
};

export const resolveNowPlayingTrust = ({
  station,
  track,
  metadataStatus,
  playerStatus,
  failure
}: {
  station: StationLite | null;
  track?: string | null;
  metadataStatus: NowPlayingStatus;
  playerStatus: string;
  failure?: PlaybackFailure | null;
}): NowPlayingTrust => {
  const normalizedTrack = normalizeTrustedTrackTitle(track, station);
  if (normalizedTrack) {
    return {
      kind: 'with-metadata',
      track: normalizedTrack
    };
  }

  if (
    playerStatus === 'error' ||
    (failure && QUESTIONABLE_FAILURES.has(failure.kind)) ||
    metadataStatus === 'idle'
  ) {
    return {
      kind: 'questionable-stream',
      track: null
    };
  }

  return {
    kind: 'without-metadata',
    track: null
  };
};

export const upsertTrustedTrackHistory = (
  history: TrackHistoryItem[],
  entry: TrackHistoryItem,
  limit: number,
  now = entry.timestamp
) => {
  const trustedTrack = normalizeTrustedTrackTitle(entry.track, {
    name: entry.stationName,
    url_resolved: '',
    homepage: ''
  });
  if (!trustedTrack) return history;

  const normalizedStation = entry.stationId;
  const normalizedTrack = normalizeComparable(trustedTrack);
  const recentDuplicate = history.find(
    (item) =>
      item.stationId === normalizedStation &&
      normalizeComparable(item.track) === normalizedTrack &&
      Math.abs(now - item.timestamp) <= TRACK_HISTORY_DEDUPE_WINDOW_MS
  );
  if (recentDuplicate) return history;

  const nextEntry: TrackHistoryItem = {
    ...entry,
    track: trustedTrack
  };
  return [
    nextEntry,
    ...history.filter(
      (item) =>
        item.stationId !== normalizedStation ||
        normalizeComparable(item.track) !== normalizedTrack
    )
  ].slice(0, limit);
};

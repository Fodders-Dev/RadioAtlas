import type { StationLite } from '../types';

export type RadioSessionMode = 'personal' | 'resume' | 'search' | 'globe' | 'collection';

export type RadioSessionEvent = {
  stationId: string;
  action: 'queued' | 'play-started' | 'play-success' | 'skip' | 'like' | 'hide' | 'failed';
  mode: RadioSessionMode;
  timestamp: number;
};

export const MAX_RADIO_SESSION_EVENTS = 120;

const SESSION_EVENT_TTL_MS = 1000 * 60 * 60 * 8;
const DIRECT_ACTION_WEIGHTS: Record<RadioSessionEvent['action'], number> = {
  queued: 0.2,
  'play-started': 1.4,
  'play-success': 5.4,
  skip: -7.5,
  like: 10,
  hide: -120,
  failed: -96
};

const RELATED_ACTION_WEIGHTS: Record<RadioSessionEvent['action'], number> = {
  queued: 0,
  'play-started': 0.35,
  'play-success': 1.7,
  skip: -1.35,
  like: 7.6,
  hide: -2,
  failed: -1.6
};

const normalize = (value?: string | null) =>
  value?.trim().replace(/\s+/g, ' ').replace(/^#+/, '').toLowerCase() || '';

const stationLanguage = (station: StationLite) =>
  normalize((station as StationLite & { language?: string }).language);

const firstTags = (station: StationLite, limit = 5) =>
  (station.tags || '')
    .split(',')
    .map(normalize)
    .filter((tag) => tag && tag !== 'no tags')
    .slice(0, limit);

const recentEvents = (
  events: RadioSessionEvent[] | null | undefined,
  now = Date.now()
) =>
  (events || [])
    .filter(
      (event) =>
        event.stationId &&
        Number.isFinite(event.timestamp) &&
        now - event.timestamp <= SESSION_EVENT_TTL_MS
    )
    .slice(0, MAX_RADIO_SESSION_EVENTS);

const ageFactor = (event: RadioSessionEvent, now: number) =>
  Math.max(0.18, 1 - (now - event.timestamp) / SESSION_EVENT_TTL_MS);

export const recordRadioSessionEvent = (
  events: RadioSessionEvent[] | null | undefined,
  event: RadioSessionEvent
): RadioSessionEvent[] => {
  if (!event.stationId) return (events || []).slice(0, MAX_RADIO_SESSION_EVENTS);
  const next = [event, ...(events || [])];
  return next
    .filter((item, index) => {
      const duplicateIndex = next.findIndex(
        (candidate) =>
          candidate.stationId === item.stationId &&
          candidate.action === item.action &&
          candidate.mode === item.mode &&
          Math.abs(candidate.timestamp - item.timestamp) < 350
      );
      return duplicateIndex === index;
    })
    .slice(0, MAX_RADIO_SESSION_EVENTS);
};

export const getSessionExcludedStationIds = (
  events: RadioSessionEvent[] | null | undefined,
  now = Date.now()
) => {
  const excluded = new Set<string>();
  recentEvents(events, now).forEach((event) => {
    if (event.action === 'failed' || event.action === 'hide') {
      excluded.add(event.stationId);
    }
  });
  return excluded;
};

export const getSessionStationScore = (
  station: StationLite,
  events: RadioSessionEvent[] | null | undefined,
  stationPool: StationLite[] = [],
  now = Date.now()
) => {
  const candidatesById = new Map<string, StationLite>();
  stationPool.forEach((candidate) => candidatesById.set(candidate.stationuuid, candidate));
  candidatesById.set(station.stationuuid, station);

  const stationTags = new Set(firstTags(station));
  const country = normalize(station.country);
  const state = normalize(station.state);
  const language = stationLanguage(station);

  return recentEvents(events, now).reduce((score, event) => {
    const factor = ageFactor(event, now);
    if (event.stationId === station.stationuuid) {
      return score + DIRECT_ACTION_WEIGHTS[event.action] * factor;
    }

    const source = candidatesById.get(event.stationId);
    if (!source) return score;

    let related = 0;
    const sourceTags = firstTags(source);
    if (sourceTags.some((tag) => stationTags.has(tag))) related += 1;
    if (country && country === normalize(source.country)) related += 0.55;
    if (state && state === normalize(source.state)) related += 0.3;
    if (language && language === stationLanguage(source)) related += 0.35;

    if (!related) return score;
    return score + RELATED_ACTION_WEIGHTS[event.action] * Math.min(1.7, related) * factor;
  }, 0);
};

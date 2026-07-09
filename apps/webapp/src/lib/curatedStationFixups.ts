import type { StationLite } from '../types';

const RADIO_VANYA_HEALTHY_CHECK_AT = 1782000000000;

const RADIO_VANYA_FIXUPS: Record<string, Partial<StationLite>> = {
  'e9e50308-e8c8-4605-8888-38638f941f34': {
    name: 'Радио Ваня — Весёлый Дэнс',
    url: 'https://icecast-radiovanya.cdnvideo.ru/rv_Happy_Dance',
    url_resolved: 'https://icecast-radiovanya.cdnvideo.ru/rv_Happy_Dance',
    homepage: 'https://radiovanya.ru/',
    country: 'The Russian Federation',
    state: '',
    tags:
      'радио ваня, radio vanya, vanya, весёлый дэнс, радио ваня весёлый дэнс, happy dance, радио ваня happy dance, весёлый dance, весёлый данс, веселый дэнс, танцы, russian, россия',
    geo_lat: 55.7558,
    geo_long: 37.6173,
    lastcheckok: 1,
    lastcheckok_at: RADIO_VANYA_HEALTHY_CHECK_AT
  },
  '3e1e6384-ba86-4dd7-82f0-6ad163c6fc48': {
    name: 'Радио Ваня — Не лихие 90-е',
    url: 'https://icecast-radiovanya.cdnvideo.ru/rv_90',
    url_resolved: 'https://icecast-radiovanya.cdnvideo.ru/rv_90',
    homepage: 'https://radiovanya.ru/',
    country: 'The Russian Federation',
    state: 'Санкт-Петербург',
    tags:
      'радио ваня, radio vanya, vanya, не лихие 90-е, радио ваня не лихие 90-е, 90, радио ваня 90, 90-е, 90е, девяностые, 90s, не лихие 90, russian, россия',
    geo_lat: 55.7558,
    geo_long: 37.6173,
    lastcheckok: 1,
    lastcheckok_at: RADIO_VANYA_HEALTHY_CHECK_AT
  }
};

export const CURATED_STATION_FIXUP_IDS = new Set(Object.keys(RADIO_VANYA_FIXUPS));

const sameStationFields = (left: StationLite, right: StationLite) =>
  left.name === right.name &&
  left.url === right.url &&
  left.url_resolved === right.url_resolved &&
  left.homepage === right.homepage &&
  left.country === right.country &&
  left.state === right.state &&
  left.tags === right.tags &&
  left.geo_lat === right.geo_lat &&
  left.geo_long === right.geo_long &&
  left.lastcheckok === right.lastcheckok &&
  left.lastcheckok_at === right.lastcheckok_at;

export const applyCuratedStationFixup = <T extends StationLite>(station: T): T => {
  const fixup = RADIO_VANYA_FIXUPS[station.stationuuid];
  if (!fixup) return station;
  const next = {
    ...station,
    ...fixup,
    favicon: station.favicon && station.favicon !== 'null' ? station.favicon : fixup.favicon ?? ''
  } as T;
  return sameStationFields(station, next) ? station : next;
};

export const applyCuratedStationFixupsToList = <T extends StationLite>(stations: T[]): T[] => {
  let changed = false;
  const next = stations.map((station) => {
    const fixed = applyCuratedStationFixup(station);
    if (fixed !== station) changed = true;
    return fixed;
  });
  return changed ? next : stations;
};

export const applyCuratedStationFixupsToCache = (
  cache: Record<string, StationLite>
): Record<string, StationLite> => {
  let changed = false;
  const next: Record<string, StationLite> = {};
  Object.entries(cache).forEach(([id, station]) => {
    const fixed = applyCuratedStationFixup(station);
    next[id] = fixed;
    if (fixed !== station) changed = true;
  });
  return changed ? next : cache;
};

export const clearCuratedStationSignals = <
  T extends { version: 1; signals: Record<string, unknown> }
>(
  profile: T
): T => {
  let changed = false;
  const signals = { ...(profile.signals || {}) };
  CURATED_STATION_FIXUP_IDS.forEach((stationId) => {
    if (stationId in signals) {
      delete signals[stationId];
      changed = true;
    }
  });
  return changed ? ({ ...profile, signals } as T) : profile;
};

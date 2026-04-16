import type { Station, StationLite } from '../types';

const COUNTRY_LABELS: Record<string, string> = {
  'The United Kingdom Of Great Britain And Northern Ireland': 'United Kingdom',
  'The United States Of America': 'USA',
  'The Russian Federation': 'Russia',
  'Islamic Republic Of Iran': 'Iran',
  'Syrian Arab Republic': 'Syria'
};

const formatLocationPart = (value?: string) => {
  const cleaned = value?.trim();
  if (!cleaned) return '';
  return COUNTRY_LABELS[cleaned] || cleaned;
};

export const toLite = (station: Station | StationLite): StationLite => ({
  stationuuid: station.stationuuid,
  name: station.name,
  url: ('url' in station && station.url) || station.url_resolved,
  url_resolved: station.url_resolved,
  homepage: 'homepage' in station ? station.homepage : '',
  favicon: station.favicon,
  country: station.country,
  state: station.state,
  tags: station.tags,
  geo_lat: station.geo_lat ?? null,
  geo_long: station.geo_long ?? null
});

export const stationLocation = (station: Station | StationLite) => {
  const parts = [formatLocationPart(station.state), formatLocationPart(station.country)].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Unknown location';
};

export const stationTags = (station: Station | StationLite) => {
  const tags = station.tags
    ?.split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 3);
  return tags?.length ? tags.join(' · ') : 'No tags';
};

import type { Station, StationLite } from '../types';

export const toLite = (station: Station | StationLite): StationLite => ({
  stationuuid: station.stationuuid,
  name: station.name,
  url_resolved: station.url_resolved,
  favicon: station.favicon,
  country: station.country,
  state: station.state,
  tags: station.tags,
  geo_lat: station.geo_lat ?? null,
  geo_long: station.geo_long ?? null
});

export const stationLocation = (station: Station | StationLite) => {
  const parts = [station.state, station.country].filter(Boolean);
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

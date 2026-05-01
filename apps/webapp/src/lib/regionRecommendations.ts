import type { FollowedRegion } from '../domain/contracts';
import type { StationLite } from '../types';

const normalize = (value?: string | null) =>
  value?.trim().toLowerCase().replace(/\s+/g, ' ') || '';

const compact = (value?: string | null) => normalize(value).replace(/[^a-z0-9]+/g, '');

const regionTokens = (region: Pick<FollowedRegion, 'id' | 'label'>) =>
  Array.from(
    new Set(
      [region.label, region.id]
        .flatMap((value) => normalize(value).split(/[-_/|,]+/g))
        .map((value) => value.trim())
        .filter((value) => value.length >= 3)
    )
  );

export const stationMatchesRegion = (
  station: StationLite,
  region: Pick<FollowedRegion, 'id' | 'label' | 'scope'>
) => {
  const stationCountry = normalize(station.country);
  const stationState = normalize(station.state);
  const stationPlace = compact(`${station.country} ${station.state}`);
  const regionLabel = normalize(region.label);
  const regionId = compact(region.id);

  if (!regionLabel && !regionId) return false;
  if (stationCountry && stationCountry === regionLabel) return true;
  if (stationState && stationState === regionLabel) return true;
  if (regionId && stationPlace.includes(regionId)) return true;

  return regionTokens(region).some((token) => {
    const tokenCompact = compact(token);
    return (
      Boolean(tokenCompact && stationPlace.includes(tokenCompact)) ||
      stationCountry.includes(token) ||
      stationState.includes(token)
    );
  });
};

export const stationsForRegions = (
  stations: StationLite[],
  regions: Array<Pick<FollowedRegion, 'id' | 'label' | 'scope'>>,
  limit = stations.length
) => {
  if (!stations.length || !regions.length || limit <= 0) return [];
  const seen = new Set<string>();
  const matches: StationLite[] = [];

  regions.forEach((region) => {
    stations.forEach((station) => {
      if (seen.has(station.stationuuid) || !stationMatchesRegion(station, region)) return;
      seen.add(station.stationuuid);
      matches.push(station);
    });
  });

  return matches.slice(0, limit);
};

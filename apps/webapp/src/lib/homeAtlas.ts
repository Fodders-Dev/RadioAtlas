import type { StationLite } from '../types';

const LEGACY_COUNTRY_CODES: Record<string, string> = { UK: 'GB', FX: 'FR', SU: 'RU', YU: 'RS' };
const NATURAL_EARTH_HOME_CODES: Record<string, string> = { '250': 'FR', '643': 'RU', '688': 'RS', '826': 'GB' };

export const canonicalHomeCountryCode = (code: string | null | undefined): string | null => {
  const normalized = code?.trim().toUpperCase();
  return normalized ? LEGACY_COUNTRY_CODES[normalized] ?? normalized : null;
};

export const naturalEarthHomeCountryCode = (id: string, fallbackCode: string | null): string | null =>
  NATURAL_EARTH_HOME_CODES[id] ?? canonicalHomeCountryCode(fallbackCode);

export const hasActualMapCoordinate = (station: StationLite): boolean =>
  Number.isFinite(station.geo_lat) && Number.isFinite(station.geo_long)
  && station.geo_lat! >= -90 && station.geo_lat! <= 90
  && station.geo_long! >= -180 && station.geo_long! <= 180;

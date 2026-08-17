import { resolveStationCoords } from './geoResolver';
import type { CatalogArea } from '../domain/contracts';

/**
 * The area pills are the placeholder the globe shows until the per-station
 * points payload arrives. The API builds them by averaging the coordinates of
 * the stations in a bucket, and it aggregates ONLY stations that carry
 * coordinates — it has no country geometry to check them against, so Radio
 * Browser's bad rows go straight through. Measured on the live catalogue: eight
 * stations claim a latitude below 60°S, all eight are junk, and five of them
 * are Radio Caprice filed under Russia. That is why the placeholder drew
 * Russian pills in Antarctica and in the South Atlantic while the country's
 * 3,164 real stations were nowhere.
 *
 * The fix belongs here rather than in the API: the resolver already owns the
 * country polygons, already rejects coordinates outside a country's bounding
 * box, and already knows how to put a station somewhere sensible inside its
 * country. Running the pill through the same function that places the dots
 * means the two can never disagree — a second copy of the geometry in the API
 * is exactly the kind of drift that left `geo:check` auditing an algorithm the
 * globe had stopped using.
 */

// The API packs the country into `subtitle` when `label` is a state, and into
// `label` otherwise — in which case `subtitle` is the station count.
const STATION_COUNT_SUBTITLE = /^\d+\s+stations?$/i;

export const countryOfArea = (area: Pick<CatalogArea, 'label' | 'subtitle'>) =>
  STATION_COUNT_SUBTITLE.test(area.subtitle.trim()) ? area.label : area.subtitle;

export const placeArea = <T extends CatalogArea>(area: T): T => {
  const country = countryOfArea(area);
  if (!country) return area;
  const resolved = resolveStationCoords({
    stationuuid: area.id,
    country,
    geo_lat: area.lat,
    geo_long: area.lon
  });
  // A plausible cluster comes back verbatim (source 'station'), so nothing
  // moves for the pills that were already right.
  if (!resolved) return area;
  return { ...area, lat: resolved.lat, lon: resolved.lon };
};

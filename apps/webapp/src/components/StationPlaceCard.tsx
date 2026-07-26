import { useEffect, useMemo, useState } from 'react';
import type { StationLite } from '../types';
import './StationPlaceCard.css';

/**
 * "Where am I listening to?" — the one thing a radio atlas can answer that a
 * playlist cannot, and the reference layout's centrepiece.
 *
 * The country outline is REAL geometry (the same countries-110m topology the
 * globe uses), so this is a map and not an ornament. What it must never do is
 * imply precision we do not have:
 *
 *   - Only 21% of the catalogue carries geo_lat/geo_long (measured over the
 *     shipped artifact, 61 152 stations). Those get a pinpoint beacon and a
 *     coordinate readout.
 *   - Everyone else resolves to a country centroid or a sampled point, which is
 *     NOT where the station is. Those get the country lit as a whole and no pin,
 *     no coordinates — the honest statement is "this country", so that is what
 *     is drawn.
 *   - No country geometry at all → the card renders nothing and the surrounding
 *     layout closes up.
 *
 * d3-geo + topojson + the ~107KB topology live behind a dynamic import (39KB
 * gzipped) so the player chunk does not carry them; the card simply appears when
 * the geometry lands.
 */

const VIEW_W = 320;
const VIEW_H = 168;
const PAD = 14;

type PlaceGeometry = {
  path: string;
  marker: { x: number; y: number } | null;
  precise: boolean;
  lat: number;
  lon: number;
};

type StationPlaceCardProps = {
  station?: StationLite | null;
  label: string;
};

/** N/S + E/W decimal readout, the form the reference shows. */
export const formatCoordinate = (lat: number, lon: number) => {
  const ns = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}`;
  const ew = `${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;
  return `${ns} · ${ew}`;
};

export const StationPlaceCard = ({ station, label }: StationPlaceCardProps) => {
  const [geometry, setGeometry] = useState<PlaceGeometry | null>(null);
  const stationKey = station?.stationuuid || '';

  useEffect(() => {
    let alive = true;
    setGeometry(null);
    if (!station?.country) return () => {
      alive = false;
    };

    void Promise.all([import('../lib/geoResolver'), import('d3-geo')])
      .then(([geo, d3]) => {
        if (!alive) return;
        const record = geo.getCountryGeoIndex().resolveCountry(station.country);
        const feature = record?.feature as Parameters<typeof d3.geoPath>[0] | undefined;
        if (!feature) return;

        const projection = d3.geoMercator();
        try {
          projection.fitExtent(
            [
              [PAD, PAD],
              [VIEW_W - PAD, VIEW_H - PAD]
            ],
            feature as never
          );
        } catch {
          return;
        }

        const scale = projection.scale();
        // Countries that straddle the antimeridian (Russia, Fiji, Kiribati) make
        // fitExtent collapse to a world-sized scale. Drawing that reads as a
        // smear, so the card bows out rather than showing something wrong.
        if (!Number.isFinite(scale) || scale <= 0) return;

        const path = d3.geoPath(projection)(feature as never);
        if (!path) return;

        const resolved = geo.resolveStationCoords(station);
        const precise = resolved?.source === 'station';
        let marker: PlaceGeometry['marker'] = null;
        if (resolved && precise) {
          const point = projection([resolved.lon, resolved.lat]);
          if (point && Number.isFinite(point[0]) && Number.isFinite(point[1])) {
            marker = { x: point[0], y: point[1] };
          }
        }

        if (!resolved) return;
        setGeometry({ path, marker, precise, lat: resolved.lat, lon: resolved.lon });
      })
      .catch(() => {
        /* geometry is a bonus; never break the player over it */
      });

    return () => {
      alive = false;
    };
  }, [stationKey, station?.country]);

  const readout = useMemo(() => {
    if (!geometry?.precise) return '';
    return formatCoordinate(geometry.lat, geometry.lon);
  }, [geometry]);

  if (!geometry) return null;

  return (
    <section
      className="station-place-card"
      data-precise={geometry.precise ? 'true' : 'false'}
      data-station-place
      aria-label={label}
    >
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label={label} focusable="false">
        <path className="station-place-country" d={geometry.path} />
        {geometry.marker ? (
          <g
            className="station-place-beacon"
            transform={`translate(${geometry.marker.x} ${geometry.marker.y})`}
          >
            <circle className="station-place-ring" r="16" />
            <circle className="station-place-ring station-place-ring--late" r="16" />
            <circle className="station-place-dot" r="3.2" />
          </g>
        ) : null}
      </svg>
      <div className="station-place-meta">
        <span className="station-place-name">
          {[station?.state, station?.country].filter(Boolean).join(', ')}
        </span>
        {readout ? <span className="station-place-coords">{readout}</span> : null}
      </div>
    </section>
  );
};

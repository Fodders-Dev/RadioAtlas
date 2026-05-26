export type GlobeAreaLike = {
  id: string;
  lat: number;
  lon: number;
};

export type GlobePoint = {
  lat: number;
  lon: number;
};

type GeoDistance = (left: [number, number], right: [number, number]) => number;

const toRadians = (value: number) => (value * Math.PI) / 180;

const wrapLongitudeDelta = (value: number) => {
  if (value > 180) return value - 360;
  if (value < -180) return value + 360;
  return value;
};

const fallbackGeoDistance: GeoDistance = (left, right) => {
  const latA = toRadians(left[1]);
  const latB = toRadians(right[1]);
  const deltaLat = latB - latA;
  const deltaLon = toRadians(wrapLongitudeDelta(right[0] - left[0]));
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const haversine =
    sinLat * sinLat + Math.cos(latA) * Math.cos(latB) * sinLon * sinLon;
  return 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)));
};

export const rotationToCenterPoint = (rotation: [number, number, number]): GlobePoint => ({
  lat: -rotation[1],
  lon: -rotation[0]
});

export const findNearestAreaToPoint = <T extends GlobeAreaLike>(
  areas: T[],
  point: GlobePoint,
  geoDistance: GeoDistance = fallbackGeoDistance
) => {
  if (!areas.length) return null;
  const center: [number, number] = [point.lon, point.lat];
  return areas.reduce<T | null>((best, area) => {
    if (!best) return area;
    const distance = geoDistance([area.lon, area.lat], center);
    const bestDistance = geoDistance([best.lon, best.lat], center);
    if (distance !== bestDistance) return distance < bestDistance ? area : best;
    return area.id.localeCompare(best.id) < 0 ? area : best;
  }, null);
};

export const findNearestAreaToRotation = <T extends GlobeAreaLike>(
  areas: T[],
  rotation: [number, number, number],
  geoDistance?: GeoDistance
) => findNearestAreaToPoint(areas, rotationToCenterPoint(rotation), geoDistance);

export type ReticleProjector = (lon: number, lat: number) => { x: number; y: number };

const RETICLE_CANDIDATE_COUNT = 8;

// Reticle nearest-station pick. Replaces a per-move
// map.queryRenderedFeatures() raster query (~16 ms each, fired ~60 Hz
// during a drag) with an in-memory search. The `stations-dot` layer has
// no filter / zoom-hiding, so the rendered dots are exactly `points` —
// the search is equivalent. (T2.13)
//
// Two passes, so a ~54k-point set stays under ~1 ms:
//   1. Equirectangular squared distance to the viewport centre ranks all
//      points with cheap arithmetic (one shared cosLat, no projection).
//      Keep the K nearest.
//   2. Project ONLY those K to screen pixels and pick the one closest to
//      the reticle, honouring the lock radius — this reproduces the old
//      "nearest rendered dot to the crosshair within N px" semantics.
// Near the reticle (low projection distortion) the geo-nearest ranking
// contains the true pixel-nearest; K = 8 absorbs any local divergence.
export const pickNearestPointToReticle = <T extends { id: string; lat: number; lon: number }>(
  points: readonly T[],
  center: { lat: number; lon: number },
  viewport: { cx: number; cy: number },
  project: ReticleProjector,
  lockRadiusPx: number,
  candidateCount: number = RETICLE_CANDIDATE_COUNT
): string | null => {
  if (!points.length) return null;

  const cosLat = Math.cos(toRadians(center.lat));
  const top: T[] = [];
  const topDist: number[] = [];
  let worstDist = -Infinity;
  let worstIdx = -1;

  const recomputeWorst = () => {
    worstDist = -Infinity;
    for (let i = 0; i < topDist.length; i += 1) {
      if (topDist[i] > worstDist) {
        worstDist = topDist[i];
        worstIdx = i;
      }
    }
  };

  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    let deltaLon = point.lon - center.lon;
    if (deltaLon > 180) deltaLon -= 360;
    else if (deltaLon < -180) deltaLon += 360;
    const x = deltaLon * cosLat;
    const y = point.lat - center.lat;
    const distance = x * x + y * y;

    if (top.length < candidateCount) {
      top.push(point);
      topDist.push(distance);
      if (top.length === candidateCount) recomputeWorst();
    } else if (distance < worstDist) {
      top[worstIdx] = point;
      topDist[worstIdx] = distance;
      recomputeWorst();
    }
  }

  let nearestId: string | null = null;
  let nearestPx = Infinity;
  for (let i = 0; i < top.length; i += 1) {
    const projected = project(top[i].lon, top[i].lat);
    const dx = projected.x - viewport.cx;
    const dy = projected.y - viewport.cy;
    const px = dx * dx + dy * dy;
    if (px < nearestPx) {
      nearestPx = px;
      nearestId = top[i].id;
    }
  }

  return nearestPx > lockRadiusPx * lockRadiusPx ? null : nearestId;
};

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

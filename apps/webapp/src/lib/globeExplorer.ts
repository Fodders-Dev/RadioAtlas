import type { CatalogStationPoint } from '../domain/contracts';
import { resolveCountryCoords } from './geoResolver';

// Pure helpers behind the calm Globe (A4 «Журнал»): the map draws ONLY points
// that carry real coordinates, so nothing here invents a position. Station
// stubs built from a point are for lists and cards; playback always resolves
// the full station through the catalogue first.

export type ExplorerPoint = CatalogStationPoint & { lat: number; lon: number };

export type LatLon = { lat: number; lon: number };

export type MapBounds = { west: number; east: number; south: number; north: number };

export type PanelSize = 'normal' | 'expanded' | 'collapsed';

export const finitePoints = (items: CatalogStationPoint[]): ExplorerPoint[] =>
  items.filter(
    (point): point is ExplorerPoint =>
      Number.isFinite(point.lat) && Number.isFinite(point.lon) && Math.abs(point.lat as number) <= 90
  );

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

// The country's own stations decide where the camera lands: their median is
// robust against one mis-filed row. A country with no located stations falls
// back to the resolver's centroid, and only then to a neutral world view.
export const countryTarget = (points: ExplorerPoint[], country: string): LatLon => {
  const local = points.filter((point) => point.country === country);
  if (local.length) {
    return { lat: median(local.map((p) => p.lat)), lon: median(local.map((p) => p.lon)) };
  }
  return resolveCountryCoords(country) || { lat: 30, lon: 10 };
};

// Longitude wrap: a viewport straddling the antimeridian reports east < west
// (or an unwrapped east beyond 180°); both reduce to a positive span.
export const pointsInBounds = (points: ExplorerPoint[], bounds: MapBounds): ExplorerPoint[] => {
  let span = bounds.east - bounds.west;
  if (span < 0) span += 360;
  return points.filter((point) => {
    if (point.lat < bounds.south || point.lat > bounds.north) return false;
    if (span >= 360) return true;
    return ((point.lon - bounds.west + 720) % 360) <= span;
  });
};

export const countryCounts = (points: ExplorerPoint[]) => {
  const counts = new Map<string, number>();
  for (const point of points) {
    if (!point.country) continue;
    counts.set(point.country, (counts.get(point.country) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

// Sources a listener already has a history with come first, then the editorial
// showcase, then the catalogue in its own order. Personal before editorial:
// PRODUCT.md ranks «my own history with this source» above any global signal.
export const orderPoints = (
  points: ExplorerPoint[],
  personalIds: Iterable<string>,
  editorialIds: Iterable<string>
): ExplorerPoint[] => {
  const personal = new Set(personalIds);
  const editorial = new Set(editorialIds);
  const rank = (point: ExplorerPoint) => (personal.has(point.id) ? 0 : editorial.has(point.id) ? 1 : 2);
  return points
    .map((point, index) => ({ point, index, rank: rank(point) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.point);
};

export const filterPoints = (
  points: ExplorerPoint[],
  query: string,
  countryLabel: (country: string) => string
): ExplorerPoint[] => {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return points;
  return points.filter((point) =>
    `${point.name || ''} ${point.state || ''} ${countryLabel(point.country)} ${point.country}`
      .toLocaleLowerCase()
      .includes(needle)
  );
};

export const PANEL_DRAG_THRESHOLD_PX = 35;

// A vertical drag on the panel heading. Up always opens; down goes one step
// towards the map, and a selected source never collapses below its card.
export const nextPanelSize = (
  deltaY: number,
  current: PanelSize,
  hasSelection: boolean
): PanelSize => {
  if (Math.abs(deltaY) < PANEL_DRAG_THRESHOLD_PX) return current;
  if (deltaY < 0) return 'expanded';
  if (current === 'expanded') return 'normal';
  return hasSelection ? 'normal' : 'collapsed';
};

export const pluralForm = (count: number, locale: string): 'one' | 'few' | 'many' | 'other' => {
  try {
    const form = new Intl.PluralRules(locale).select(count);
    if (form === 'one' || form === 'few' || form === 'many') return form;
    return 'other';
  } catch {
    return 'other';
  }
};

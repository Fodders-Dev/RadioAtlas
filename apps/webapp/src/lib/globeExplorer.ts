import { GENRE_FAMILIES, type CatalogStationPoint, type GenreFamily } from '../domain/contracts';
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

// ---- Genre colours and display layout for coincident points ----------------

// One colour per coarse family (the API decides the family from the station's
// first recognised tag). Chosen to stay apart on the muted satellite ground and
// from the selection/on-air reds; colour is never the only cue — the legend
// and every list row carry the family's name too.
export const GENRE_COLORS: Record<GenreFamily, string> = {
  pop: '#f2a93b',
  rock: '#c4553d',
  electronic: '#3fa7c8',
  jazz: '#b2732a',
  classical: '#e9dcc1',
  chill: '#7fb69a',
  hiphop: '#8f6cc4',
  world: '#d9895a',
  talk: '#9aa3ad'
};

// A point without a recognised tag: neutral paper, not a guessed genre.
export const NEUTRAL_POINT_COLOR = '#f3e4c8';

export const pointColor = (genre: GenreFamily | undefined): string => (genre ? GENRE_COLORS[genre] : NEUTRAL_POINT_COLOR);

// MapLibre `match` expression on the feature's `genre` property.
export const genreColorExpression = (): unknown[] => [
  'match',
  ['get', 'genre'],
  ...GENRE_FAMILIES.flatMap((family) => [family, GENRE_COLORS[family]]),
  NEUTRAL_POINT_COLOR
];

// Display-only collision layout. Original coordinates stay on the station;
// at neighbourhood scale every visible station gets a dot, including all
// stations sharing a catalogue coordinate. A selected displaced dot gets a
// single tether back to that coordinate, never a web of 98 crossing lines.
export function spreadMapPoints<T extends { id: string; x: number; y: number }>(points: T[], width: number, height: number) {
  const gap = Math.max(4, Math.min(22, Math.sqrt(width * height / Math.max(points.length * 5, 1))));
  const used = new Set<string>();
  const cols = Math.max(1, Math.floor((width - 24) / gap));
  const rows = Math.max(1, Math.floor((height - 24) / gap));
  return [...points].sort((a, b) => a.id.localeCompare(b.id)).map(point => {
    const col = Math.max(0, Math.min(cols - 1, Math.round((point.x - 12) / gap)));
    const row = Math.max(0, Math.min(rows - 1, Math.round((point.y - 12) / gap)));
    let chosen = { x: col, y: row };
    let found = false;
    for (let r = 0; r < Math.max(cols, rows) && !found; r++) {
      for (let dy = -r; dy <= r && !found; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = col + dx, y = row + dy;
          if (x < 0 || x >= cols || y < 0 || y >= rows || used.has(`${x}:${y}`)) continue;
          chosen = { x, y }; found = true; break;
        }
      }
    }
    used.add(`${chosen.x}:${chosen.y}`);
    return { ...point, x: chosen.x * gap + 12, y: chosen.y * gap + 12, radius: Math.min(6, gap * .35) };
  });
}

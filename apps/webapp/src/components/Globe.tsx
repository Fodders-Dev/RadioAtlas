import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { feature as topoFeature } from 'topojson-client';
import worldData from '../assets/countries-110m.json';
import { pickNearestPointToReticle } from './globe/selection';
import './globe/globe.css';

// Natural Earth 50m admin_1 boundaries — only the federations that
// actually have multiple administrative tiers. Single-admin
// countries don't need state borders. ~670 KB gzipped from
// jsdelivr, lazily fetched once and cached at module scope so
// remounts don't re-download.
const ADMIN1_URL =
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_1_states_provinces_lakes.geojson';
let admin1Promise: Promise<GeoJSON.FeatureCollection> | null = null;
const fetchAdmin1 = (): Promise<GeoJSON.FeatureCollection> => {
  if (admin1Promise) return admin1Promise;
  admin1Promise = fetch(ADMIN1_URL)
    .then((res) => res.json() as Promise<GeoJSON.FeatureCollection>)
    .catch((err) => {
      // Reset so a later remount can retry; not a fatal error
      // — globe still works without admin-1 borders.
      admin1Promise = null;
      throw err;
    });
  return admin1Promise;
};

type GlobePoint = {
  id: string;
  lat: number;
  lon: number;
  label?: string;
  subtitle?: string;
  count?: number;
  // Free-text region from Radio Browser — the cluster key for the
  // state-labels layer. Stations inside the same `(country, state)`
  // tuple aggregate into a single label centred on their median
  // coordinate.
  state?: string;
  // Country surfaces in the points feature collection so we can
  // disambiguate same-named regions across countries.
  country?: string;
  // Station display name. At deep zoom we render it as a tiny
  // symbol-layer label next to its dot.
  name?: string;
};

type GlobeProps = {
  points: GlobePoint[];
  activeId?: string;
  selectedId?: string;
  focusPoint?: { lat: number; lon: number };
  onPick?: (id: string) => void;
  onPickCandidates?: (ids: string[]) => void;
  // Fires while the user is panning/zooming with the station whose
  // rendered dot sits closest to the reticle. The parent uses this to
  // soft-highlight the candidate station as the globe moves under the
  // crosshair.
  onReticleHover?: (stationId: string | null) => void;
  // Fires after a drag has settled with the same station as
  // `onReticleHover` reported. This is selection-only: the parent may
  // resolve a preview, but must not start audio without an explicit action.
  onReticleSettle?: (stationId: string) => void;
  totalCount?: number;
  geoCount?: number;
  zoomLevel?: number;
  onZoomChange?: (value: number) => void;
  hintText?: string;
  immersive?: boolean;
  statusText?: string;
};

const SATELLITE_TILE_URL =
  import.meta.env.VITE_GLOBE_SATELLITE_TILE_URL ||
  'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

const SATELLITE_ATTRIBUTION =
  '<a href="https://www.esri.com" target="_blank" rel="noreferrer">Esri</a> World Imagery';

// Map between the legacy 0–10 "scale" scaler the rest of the app uses
// and MapLibre's standard mercator zoom (0 = whole world, ~20 = street
// level). At scale=1 we want the planet to fill the viewport — that's
// roughly map zoom 2.4 with the globe projection.
const SCALE_BASE_OFFSET = 1.4;
const SCALE_TO_ZOOM = (scale: number) =>
  Math.max(0, Math.min(20, scale + SCALE_BASE_OFFSET));
const ZOOM_TO_SCALE = (zoom: number) =>
  Math.max(0, Math.min(10, zoom - SCALE_BASE_OFFSET));

// Finger-sized tap tolerance: a tap within this many CSS px of a station dot
// plays the nearest one (the dots themselves render ~1.4–5.4px, far too small
// to require a pixel-perfect hit on touch).
const TAP_PICK_RADIUS_PX = 46;

// Country polygons + centroids extracted from the same Natural Earth
// topology the resolver uses. Built once at module load — the file is
// already in the bundle for geoResolver.
const buildCountryLayers = () => {
  const topology = worldData as unknown as {
    objects: { countries: unknown };
  };
  const collection = topoFeature(
    topology as Parameters<typeof topoFeature>[0],
    (topology as { objects: { countries: Parameters<typeof topoFeature>[1] } })
      .objects.countries
  ) as GeoJSON.FeatureCollection<GeoJSON.MultiPolygon | GeoJSON.Polygon>;
  // Filter out features without a name (some Natural Earth rows are
  // disputed territories with empty properties — they'd render as
  // unlabelled polygons otherwise).
  const features = collection.features.filter(
    (item) => typeof item.properties?.name === 'string' && item.properties?.name
  );
  const polygons: GeoJSON.FeatureCollection<
    GeoJSON.MultiPolygon | GeoJSON.Polygon
  > = {
    type: 'FeatureCollection',
    features
  };
  // Compute a label point per country. We use bounding-box centre
  // here rather than d3 geoCentroid because a centroid for a
  // multi-polygon (USA + Alaska + Hawaii) lands in the Pacific. The
  // bbox centre puts the label inside the main land mass for almost
  // every territory.
  const labels: GeoJSON.FeatureCollection<GeoJSON.Point> = {
    type: 'FeatureCollection',
    features: features.map((item) => {
      const bbox = computeBoundingBox(item.geometry);
      const lon = bbox ? (bbox.minLon + bbox.maxLon) / 2 : 0;
      const lat = bbox ? (bbox.minLat + bbox.maxLat) / 2 : 0;
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: {
          name: String(item.properties?.name || '')
        }
      };
    })
  };
  return { polygons, labels };
};

const computeBoundingBox = (geometry: GeoJSON.Geometry) => {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  const visit = (coords: GeoJSON.Position) => {
    const [lon, lat] = coords;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  };
  const walk = (input: unknown) => {
    if (!Array.isArray(input)) return;
    if (typeof input[0] === 'number') {
      visit(input as GeoJSON.Position);
      return;
    }
    input.forEach(walk);
  };
  if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
    walk(geometry.coordinates);
  }
  if (!Number.isFinite(minLon)) return null;
  return { minLon, maxLon, minLat, maxLat };
};

let countryLayersCache:
  | { polygons: GeoJSON.FeatureCollection; labels: GeoJSON.FeatureCollection }
  | null = null;
const getCountryLayers = () => {
  if (!countryLayersCache) countryLayersCache = buildCountryLayers();
  return countryLayersCache;
};

const buildPointsFeatureCollection = (
  points: GlobePoint[]
): GeoJSON.FeatureCollection<GeoJSON.Point> => ({
  type: 'FeatureCollection',
  features: points.map((point) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [point.lon, point.lat] },
    properties: {
      id: point.id,
      label: point.label || '',
      subtitle: point.subtitle || '',
      count: point.count ?? 1,
      name: point.name || '',
      country: point.country || '',
      state: point.state || ''
    }
  }))
});

// Cluster stations by (country, state) and emit one label per
// cluster at the median location of its members. This becomes the
// "regions" layer that fills in mid-zoom — between country labels
// (z 2.6+) and individual station names (z 8+). Median rather
// than mean makes the label robust against outlier stations
// dropped into a country's bounding box but mis-tagged with that
// state's name.
const buildStateLabelsFeatureCollection = (
  points: GlobePoint[]
): GeoJSON.FeatureCollection<GeoJSON.Point> => {
  const clusters = new Map<
    string,
    { lats: number[]; lons: number[]; label: string; country: string }
  >();
  for (const point of points) {
    const country = point.country || '';
    const state = point.state || '';
    if (!country || !state) continue;
    const key = `${country}::${state}`;
    let bucket = clusters.get(key);
    if (!bucket) {
      bucket = { lats: [], lons: [], label: state, country };
      clusters.set(key, bucket);
    }
    bucket.lats.push(point.lat);
    bucket.lons.push(point.lon);
  }
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
  clusters.forEach((bucket) => {
    // 4-station floor: drops single mis-tagged outliers and very
    // tiny city-level clusters that would otherwise overlap their
    // neighbours and create label clutter.
    if (bucket.lats.length < 4) return;
    bucket.lats.sort((a, b) => a - b);
    bucket.lons.sort((a, b) => a - b);
    const lat = bucket.lats[Math.floor(bucket.lats.length / 2)];
    const lon = bucket.lons[Math.floor(bucket.lons.length / 2)];
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        name: bucket.label,
        country: bucket.country,
        count: bucket.lats.length
      }
    });
  });
  return { type: 'FeatureCollection', features };
};

const buildStyle = (): maplibregl.StyleSpecification => ({
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    satellite: {
      type: 'raster',
      tiles: [SATELLITE_TILE_URL],
      tileSize: 256,
      maxzoom: 19,
      attribution: SATELLITE_ATTRIBUTION
    },
    countries: {
      type: 'geojson',
      data: getCountryLayers().polygons
    },
    'country-labels': {
      type: 'geojson',
      data: getCountryLayers().labels
    },
    admin1: {
      type: 'geojson',
      // Populated asynchronously after mount; starts empty so the
      // style validates at construction time.
      data: { type: 'FeatureCollection', features: [] }
    },
    'state-labels': {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    },
    stations: {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    }
  },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#03081a' }
    },
    {
      id: 'satellite-imagery',
      type: 'raster',
      source: 'satellite',
      paint: {
        'raster-opacity': 1,
        'raster-fade-duration': 240
      }
    },
    // Country borders rendered above the satellite imagery but below
    // the station dots — gives the planet a clear "here be Russia /
    // here be Brazil" feel without the dots getting buried.
    {
      id: 'country-borders',
      type: 'line',
      source: 'countries',
      paint: {
        'line-color': 'rgba(220, 245, 255, 0.55)',
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          0, 0.4,
          3, 0.7,
          6, 1.1,
          10, 1.6
        ],
        'line-blur': 0.4,
        'line-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          0, 0.35,
          3, 0.55,
          6, 0.7,
          10, 0.8
        ]
      }
    },
    // Admin-1 borders for the 9 federations Natural Earth ships at
    // 50m: Russia, China, USA, Canada, Brazil, India, Indonesia,
    // Australia, South Africa — the territories where "where in
    // this country?" actually has a meaningful answer. Thinner and
    // more transparent than country borders so they don't compete
    // visually; fade out at low zoom so the world view stays clean.
    {
      id: 'admin1-borders',
      type: 'line',
      source: 'admin1',
      minzoom: 3.5,
      paint: {
        'line-color': 'rgba(220, 245, 255, 0.5)',
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          3.5, 0.3,
          5, 0.6,
          8, 1.0
        ],
        'line-blur': 0.4,
        'line-dasharray': [3, 2],
        'line-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          3.5, 0,
          4.2, 0.45,
          7, 0.6
        ]
      }
    },
    // Slim halo so country borders stay legible against bright
    // landmasses too (Sahara desert, snowy Russia in winter imagery).
    {
      id: 'country-borders-halo',
      type: 'line',
      source: 'countries',
      paint: {
        'line-color': 'rgba(8, 12, 26, 0.55)',
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          0, 1.4,
          3, 2.2,
          6, 3.0,
          10, 4.0
        ],
        'line-blur': 1.6,
        'line-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          0, 0.18,
          3, 0.28,
          6, 0.34,
          10, 0.4
        ]
      }
    },
    {
      id: 'country-labels',
      type: 'symbol',
      source: 'country-labels',
      // Country names appear at world-scale, fade out when state
      // labels take over so we don't stack two label tiers on top
      // of each other in the same patch of viewport.
      minzoom: 2.6,
      maxzoom: 6,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
        'text-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          2.6, 10,
          4, 12,
          6, 14
        ],
        'text-letter-spacing': 0.04,
        'text-allow-overlap': false,
        'text-padding': 6,
        'text-transform': 'uppercase'
      },
      paint: {
        'text-color': 'rgba(235, 247, 255, 0.92)',
        'text-halo-color': 'rgba(4, 8, 18, 0.85)',
        'text-halo-width': 1.4,
        'text-halo-blur': 0.6,
        'text-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          2.6, 0,
          3.2, 1,
          5.2, 1,
          6, 0
        ]
      }
    },
    {
      // Region / state / city tier — appears as countries fade.
      // Cluster centroids derived from station data, so labels
      // only show where stations actually live.
      id: 'state-labels',
      type: 'symbol',
      source: 'state-labels',
      minzoom: 4,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
        'text-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          4, 10,
          6, 12,
          8, 14
        ],
        'text-letter-spacing': 0.05,
        'text-allow-overlap': false,
        'text-padding': 4
      },
      paint: {
        'text-color': 'rgba(220, 240, 252, 0.95)',
        'text-halo-color': 'rgba(4, 8, 18, 0.9)',
        'text-halo-width': 1.3,
        'text-halo-blur': 0.5,
        'text-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          4, 0,
          4.8, 0.85,
          7.5, 0.85,
          8.5, 0.4
        ]
      }
    },
    {
      id: 'stations-glow',
      type: 'circle',
      source: 'stations',
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          0, 2,
          3, 4,
          6, 6,
          10, 9
        ],
        'circle-color': 'rgba(0, 255, 132, 0.18)',
        'circle-blur': 1.2
      }
    },
    {
      id: 'stations-dot',
      type: 'circle',
      source: 'stations',
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          0, 1.4,
          3, 2.4,
          6, 3.6,
          10, 5.4
        ],
        'circle-color': 'rgba(80, 255, 162, 0.92)',
        'circle-stroke-width': 0.5,
        'circle-stroke-color': 'rgba(220, 255, 240, 0.5)'
      }
    },
    {
      id: 'stations-active',
      type: 'circle',
      source: 'stations',
      filter: ['==', ['get', 'id'], '__none__'],
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          0, 5,
          6, 9,
          10, 14
        ],
        'circle-color': 'rgba(255, 255, 255, 0.96)',
        'circle-stroke-width': 2,
        'circle-stroke-color': 'rgba(0, 255, 132, 0.9)'
      }
    },
    {
      id: 'stations-selected',
      type: 'circle',
      source: 'stations',
      filter: ['==', ['get', 'id'], '__none__'],
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          0, 4,
          6, 7,
          10, 11
        ],
        'circle-color': 'rgba(180, 245, 255, 0.92)',
        'circle-stroke-width': 1.5,
        'circle-stroke-color': 'rgba(255, 255, 255, 0.85)'
      }
    },
    {
      // Station-name labels appear only at street-level zoom so we
      // don't carpet the planet with text. text-anchor:top puts the
      // label below the dot so the dot itself remains visible.
      id: 'stations-name',
      type: 'symbol',
      source: 'stations',
      minzoom: 8,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
        'text-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          8, 10,
          11, 13
        ],
        'text-anchor': 'top',
        'text-offset': [0, 0.7],
        'text-allow-overlap': false,
        'text-padding': 2,
        'text-optional': true
      },
      paint: {
        'text-color': 'rgba(244, 252, 255, 0.92)',
        'text-halo-color': 'rgba(4, 8, 18, 0.85)',
        'text-halo-width': 1.2,
        'text-halo-blur': 0.4
      }
    }
  ],
  // MapLibre 4+: pick globe projection. The map smoothly transitions to
  // mercator at higher zooms — exactly the Radio Garden feel.
  projection: { type: 'globe' }
});

export const Globe = ({
  points,
  activeId,
  selectedId,
  focusPoint,
  onPick,
  onReticleHover,
  onReticleSettle,
  zoomLevel,
  onZoomChange,
  hintText,
  statusText
}: GlobeProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const externalZoomRef = useRef<number | null>(null);
  const lastEmittedScaleRef = useRef<number>(1);
  // Callbacks referenced from event handlers attached once on the map;
  // refs keep them current without re-attaching on every render.
  const onPickRef = useRef(onPick);
  const onReticleHoverRef = useRef(onReticleHover);
  const onReticleSettleRef = useRef(onReticleSettle);
  // Reticle nearest-search reads the live point set without re-attaching
  // the once-mounted move handler when `points` swaps (overview areas vs
  // per-station sprinkle). (T2.13)
  const pointsRef = useRef(points);
  useEffect(() => {
    onPickRef.current = onPick;
    onReticleHoverRef.current = onReticleHover;
    onReticleSettleRef.current = onReticleSettle;
    pointsRef.current = points;
  });

  // Mount the map exactly once. Style and layers are loaded inside.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    if (mapRef.current) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const initialZoom = SCALE_TO_ZOOM(typeof zoomLevel === 'number' ? zoomLevel : 1);
    const map = new maplibregl.Map({
      container: node,
      style: buildStyle(),
      center: focusPoint ? [focusPoint.lon, focusPoint.lat] : [10, 30],
      zoom: initialZoom,
      attributionControl: { compact: true },
      cooperativeGestures: false,
      pitchWithRotate: false,
      dragRotate: false,
      maxPitch: 0,
      renderWorldCopies: true,
      fadeDuration: reduceMotion ? 0 : 200,
      // A finger tap on a dot jitters several px; the 3px default made those
      // taps register as a drag (so the tap-to-play click never fired and the
      // gesture fell through to a pan). 10px lets a slightly-imprecise tap still
      // count as a tap → plays the dot the user aimed at.
      clickTolerance: 10
    });

    mapRef.current = map;

    map.on('load', () => {
      setReady(true);
    });

    // MapLibre globe-projection cold-mount bug: tiles fetch + decode
    // but the renderer commits a black frame and never re-runs
    // until the camera moves. Three layered defences:
    //
    //   1. On every `sourcedata` event for the satellite source we
    //      call triggerRepaint() — pushes a fresh frame whenever a
    //      tile arrives, no matter how few.
    //   2. On the FIRST sourcedata event for satellite (regardless
    //      of isSourceLoaded), do the easeTo nudge that actually
    //      unlocks the pipeline. Waiting for isSourceLoaded was
    //      taking 5–15 s on production because the globe viewport
    //      pulls many tiles before the source is fully "loaded".
    //   3. A safety-net interval pulses triggerRepaint every 250 ms
    //      for the first 3 s after mount. If sourcedata fires too
    //      early to matter or if a CDN edge serves cached tiles
    //      from disk and skips the event entirely, the interval
    //      makes sure the camera still wakes up.
    let kickedFirstFrame = false;
    const kickFirstFrame = () => {
      if (kickedFirstFrame) return;
      kickedFirstFrame = true;
      try {
        const c = map.getCenter();
        map.easeTo({
          center: [c.lng + 0.0001, c.lat],
          duration: 0,
          essential: true
        });
        map.easeTo({ center: [c.lng, c.lat], duration: 0, essential: true });
      } catch {
        // ignore
      }
    };
    const handleSatelliteData = (
      e: maplibregl.MapDataEvent & { sourceId?: string; isSourceLoaded?: boolean }
    ) => {
      if (e.sourceId !== 'satellite') return;
      try {
        map.triggerRepaint();
      } catch {
        // ignore
      }
      if (!kickedFirstFrame) kickFirstFrame();
    };
    map.on('sourcedata', handleSatelliteData);

    // Safety-net pulse: even if no sourcedata fires (cached tiles,
    // weird CDN edge, etc.), this guarantees the camera composes a
    // first real frame within ~3 s of cold mount.
    let kickAttempts = 0;
    const kickInterval = window.setInterval(() => {
      kickAttempts += 1;
      try {
        map.triggerRepaint();
      } catch {
        // ignore
      }
      if (!kickedFirstFrame && kickAttempts >= 4) kickFirstFrame();
      if (kickAttempts >= 12) {
        window.clearInterval(kickInterval);
        map.off('sourcedata', handleSatelliteData);
      }
    }, 250);

    map.on('zoom', () => {
      if (!onZoomChange) return;
      const nextScale = ZOOM_TO_SCALE(map.getZoom());
      if (Math.abs(nextScale - lastEmittedScaleRef.current) < 0.01) return;
      lastEmittedScaleRef.current = nextScale;
      // We just changed zoom internally; remember the value so the
      // parent-prop sync effect doesn't bounce it back.
      externalZoomRef.current = nextScale;
      onZoomChange(nextScale);
    });

    // Forgiving tap-to-play: a tap doesn't need to land pixel-perfectly on a
    // (tiny) dot — pick the nearest point within a finger-sized radius of where
    // the user actually tapped. This is the reliable "aim at a point and it
    // plays" on touch, at ANY zoom (the old exact-hit `click` on 'stations-dot'
    // only fired when a dot was big enough to hit, i.e. zoomed in). A tap on
    // genuinely empty space resolves to null → nothing happens.
    map.on('click', (event) => {
      const nearest = pickNearestPointToReticle(
        pointsRef.current,
        { lat: event.lngLat.lat, lon: event.lngLat.lng },
        { cx: event.point.x, cy: event.point.y },
        (lon, lat) => map.project([lon, lat]),
        TAP_PICK_RADIUS_PX
      );
      if (nearest) onPickRef.current?.(nearest);
    });

    map.on('mouseenter', 'stations-dot', () => {
      const canvas = map.getCanvasContainer();
      canvas.style.cursor = 'pointer';
    });
    map.on('mouseleave', 'stations-dot', () => {
      const canvas = map.getCanvasContainer();
      canvas.style.cursor = '';
    });

    return () => {
      window.clearInterval(kickInterval);
      mapRef.current = null;
      map.remove();
    };
    // We deliberately don't depend on focusPoint/zoomLevel here — those are
    // synced through follow-up effects so the map instance stays alive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reticle selection: while the camera moves, highlight whichever
  // station's rendered dot is closest to the viewport centre. When
  // a deliberate drag settles, emit a selection-only event. Zoom-only
  // gestures and programmatic flights never commit a selection.
  const [reticleState, setReticleState] = useState<'idle' | 'aiming' | 'selected'>(
    'idle'
  );
  // Use a ref so the state-machine inside the once-mounted map
  // effect can flip the visual mode without forcing the effect to
  // re-attach when reticleState changes from React's perspective.
  const reticleStateRef = useRef<typeof reticleState>('idle');
  const setReticle = (next: typeof reticleState) => {
    reticleStateRef.current = next;
    setReticleState(next);
  };

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const SETTLE_DELAY_MS = 450;
    // At very wide world views the reticle spans too much geography for a
    // committed selection to feel honest. The default view is map zoom 2.4,
    // so this floor still allows selection from the normal globe view.
    const RETICLE_SELECT_MIN_ZOOM = 1.5;

    let lastHoverId: string | null = null;
    let userHasDragged = false;
    let settleTimeout: number | null = null;

    // Returns the station whose rendered dot is *visually* closest to
    // the reticle right now. The pixel cap means we only commit when
    // a dot is within the lock radius of the crosshair — beyond that the
      // user clearly aimed at empty space and we should not commit a selection.
    // The radius tapers at the newly-enabled low zoom levels (small planet,
    // dense dots) so a far-off dot can't snap under the crosshair, while the
    // zoom range that already worked (≥ ~2.5) keeps the proven 140 px cap.
    const lockRadiusForZoom = (zoom: number) => Math.min(140, 50 + zoom * 36);

    // Nearest rendered station dot to the crosshair, capped at the lock
    // radius. Backed by an in-memory two-pass search (see
    // pickNearestPointToReticle) instead of a per-move
    // map.queryRenderedFeatures() raster query, which cost ~16 ms each at
    // ~60 Hz and was the globe-drag jank source flagged in T_audit_1. (T2.13)
    const findNearestStation = (): string | null => {
      const canvas = map.getCanvasContainer();
      const center = map.getCenter();
      try {
        return pickNearestPointToReticle(
          pointsRef.current,
          { lat: center.lat, lon: center.lng },
          { cx: canvas.clientWidth / 2, cy: canvas.clientHeight / 2 },
          (lon, lat) => map.project([lon, lat]),
          lockRadiusForZoom(map.getZoom())
        );
      } catch {
        return null;
      }
    };

    const cancelSettle = () => {
      if (settleTimeout !== null) {
        window.clearTimeout(settleTimeout);
        settleTimeout = null;
      }
    };

    const handleMove = () => {
      const id = findNearestStation();
      if (id !== lastHoverId) {
        lastHoverId = id;
        onReticleHoverRef.current?.(id);
      }
    };

    // dragstart fires for translation drags only; pinch-zoom and
    // wheel-zoom fire zoomstart instead. So this flag only flips on
    // when the user is actively rotating/panning the planet, which
    // is the gesture that semantically means "I'm aiming at a new
    // station."
    const handleDragStart = (event: maplibregl.MapLibreEvent) => {
      if ((event as { originalEvent?: unknown }).originalEvent) {
        userHasDragged = true;
        setReticle('aiming');
      }
      cancelSettle();
    };

    // Schedule a settle. The actual "nearest station" decision is
    // re-computed *inside* the timer rather than at the moment we
    // queued it, because MapLibre's drag inertia keeps the camera
    // moving for ~300 ms after touch release. Picking the target at
    // dragend produced wildly wrong tunes (commit to a station the
    // user wasn't aiming at, on the other side of the viewport).
    const scheduleSettle = () => {
      cancelSettle();
      settleTimeout = window.setTimeout(() => {
        settleTimeout = null;
        // If the camera is still gliding (long inertia after a flick
        // or a programmatic easeTo), wait it out — re-arm a short
        // follow-up timer so we recompute once it actually stops.
        if (map.isMoving()) {
          settleTimeout = window.setTimeout(() => {
            settleTimeout = null;
            const id = findNearestStation();
            if (!id) {
              userHasDragged = false;
              setReticle('idle');
              return;
            }
            fireSettle(id);
          }, 300);
          return;
        }
        const id = findNearestStation();
        if (!id) {
          // Aimed at empty space — don't select, just relax the
          // reticle back to idle so the user can try again.
          userHasDragged = false;
          setReticle('idle');
          return;
        }
        fireSettle(id);
      }, SETTLE_DELAY_MS);
    };

    const fireSettle = (target: string) => {
      // Briefly confirm the lock. The parent resolves a selection preview;
      // audio remains untouched until the user taps a point or Play CTA.
      setReticle('selected');
      onReticleSettleRef.current?.(target);
      window.setTimeout(() => {
        if (reticleStateRef.current === 'selected') setReticle('idle');
      }, 520);
      userHasDragged = false;
    };

    // Dragging selects the station under the reticle after inertia ends. It does
    // not play it; the resolved preview exposes a native, keyboard-focusable
    // Play button. A direct click/tap on a dot remains an explicit play intent.
    const handleDragEnd = () => {
      if (!userHasDragged || map.getZoom() < RETICLE_SELECT_MIN_ZOOM) {
        cancelSettle();
        userHasDragged = false;
        if (reticleStateRef.current === 'aiming') setReticle('idle');
        return;
      }
      scheduleSettle();
    };

    const handleZoomEnd = () => {
      cancelSettle();
      userHasDragged = false;
      if (reticleStateRef.current === 'aiming') setReticle('idle');
    };

    map.on('dragstart', handleDragStart);
    map.on('dragend', handleDragEnd);
    map.on('zoomend', handleZoomEnd);
    map.on('move', handleMove);
    // Initial pass so the parent can highlight what the reticle sees
    // at mount time (without auto-playing).
    handleMove();

    return () => {
      map.off('dragstart', handleDragStart);
      map.off('dragend', handleDragEnd);
      map.off('zoomend', handleZoomEnd);
      map.off('move', handleMove);
      cancelSettle();
    };
  }, [ready]);

  // Push station points + derived state-label clusters into the
  // matching GeoJSON sources whenever the prop changes. Doing both
  // in a single effect keeps them updating in lockstep — the user
  // never sees stations from one payload mismatched with stale
  // labels from a previous payload.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const stations = map.getSource('stations') as maplibregl.GeoJSONSource | undefined;
    const stateLabels = map.getSource('state-labels') as
      | maplibregl.GeoJSONSource
      | undefined;
    if (stations) stations.setData(buildPointsFeatureCollection(points));
    if (stateLabels) stateLabels.setData(buildStateLabelsFeatureCollection(points));
  }, [points, ready]);

  // Load admin-1 borders once the map is mounted. Lazy fetch so the
  // initial paint doesn't block on a 670 KB download — borders fade
  // in when they arrive. Cached at module scope so route remounts
  // don't refetch.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let cancelled = false;
    fetchAdmin1()
      .then((collection) => {
        if (cancelled) return;
        const source = map.getSource('admin1') as
          | maplibregl.GeoJSONSource
          | undefined;
        if (source) source.setData(collection);
      })
      .catch(() => {
        // Silent failure — globe stays usable, just without
        // sub-national borders.
      });
    return () => {
      cancelled = true;
    };
  }, [ready]);

  // Active (currently playing) station: highlight via filter.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setFilter('stations-active', ['==', ['get', 'id'], activeId ?? '__none__']);
  }, [activeId, ready]);

  // Selected (last picked) station: separate halo so the eye finds it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setFilter('stations-selected', ['==', ['get', 'id'], selectedId ?? '__none__']);
  }, [ready, selectedId]);

  // Smoothly fly to a new focus point (e.g. user picked a station, or
  // GlobeScreen received a globeFocusRegionId from the library).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !focusPoint) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    map.easeTo({
      center: [focusPoint.lon, focusPoint.lat],
      duration: reduceMotion ? 0 : 700,
      essential: false
    });
  }, [focusPoint?.lat, focusPoint?.lon, ready]);

  // External zoom sync — when GlobeScreen owns the zoom (zoom +/- buttons,
  // pinch handler, programmatic flyTo), echo the value to the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || typeof zoomLevel !== 'number') return;
    if (externalZoomRef.current !== null && Math.abs(externalZoomRef.current - zoomLevel) < 0.01) {
      // We just emitted this value through the zoom handler; don't echo it
      // back into the map and risk a feedback loop.
      externalZoomRef.current = null;
      return;
    }
    const targetZoom = SCALE_TO_ZOOM(zoomLevel);
    if (Math.abs(map.getZoom() - targetZoom) < 0.02) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    map.easeTo({ zoom: targetZoom, duration: reduceMotion ? 0 : 320, essential: false });
  }, [ready, zoomLevel]);

  return (
    <div className="globe globe-maplibre" ref={containerRef}>
      <div
        className="globe-reticle"
        data-state={reticleState}
        aria-hidden="true"
      >
        <span className="globe-reticle-line globe-reticle-line-x" />
        <span className="globe-reticle-line globe-reticle-line-y" />
        <span className="globe-reticle-dot" />
      </div>
      {statusText || hintText ? (
        <div className="globe-overlay">
          {statusText ? <div className="globe-count">{statusText}</div> : null}
          {hintText ? <div className="globe-hint">{hintText}</div> : null}
        </div>
      ) : null}
    </div>
  );
};

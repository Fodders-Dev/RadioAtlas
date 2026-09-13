import { useEffect, useRef, type MutableRefObject } from 'react';
import maplibregl, { type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { feature as topoFeature } from 'topojson-client';
import worldData from '../../assets/countries-110m.json';
import { genreColorExpression, groupMapPlaces, type ExplorerPoint, type LatLon, type MapBounds } from '../../lib/globeExplorer';

// Geographic places remain visible at every scale. Co-located streams open
// together in the place list; map selection never starts playback.

export type ExplorerArea = { ids: string[]; bounds: MapBounds; center: LatLon; zoom: number };

export type ExplorerFlight = { center: LatLon; zoom: number; key: number };

type ExplorerMapProps = {
  points: ExplorerPoint[];
  selectedId: string | null;
  placeId: string | null;
  activeId: string | null;
  // A new `key` starts a camera move; the same key never replays it.
  flight: ExplorerFlight | null;
  onReady?: () => void;
  onPick: (id: string) => void;
  onGroup: (ids: string[]) => void;
  // Fires only after the LISTENER moved the map (drag, pinch, wheel, +/−),
  // never after a programmatic flight — the list must not jump under a finger.
  onUserMove: (area: ExplorerArea) => void;
  onError?: () => void;
};

export type ExplorerMapHandle = {
  area: () => ExplorerArea | null;
  zoom: () => number;
  zoomBy: (delta: number) => void;
};

const SATELLITE_TILE_URL =
  import.meta.env.VITE_GLOBE_SATELLITE_TILE_URL ||
  'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

const toCollection = (points: ExplorerPoint[]): GeoJSON.FeatureCollection<GeoJSON.Point> => ({
  type: 'FeatureCollection',
  features: points.map((point) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [point.lon, point.lat] },
    properties: { id: point.id, name: point.name || '', country: point.country || '', genre: point.genre || '' }
  }))
});

const toPlaces = (points: ExplorerPoint[]): GeoJSON.FeatureCollection<GeoJSON.Point> => ({
  type: 'FeatureCollection',
  features: groupMapPlaces(points).map(place => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [place.lon, place.lat] },
    properties: { id: place.id, count: place.count, genre: place.genre || '' }
  }))
});

let bordersCache: GeoJSON.FeatureCollection | null = null;
const borders = () => {
  if (!bordersCache) {
    const topology = worldData as unknown as { objects: { countries: unknown } };
    bordersCache = topoFeature(
      topology as Parameters<typeof topoFeature>[0],
      (topology as { objects: { countries: Parameters<typeof topoFeature>[1] } }).objects.countries
    ) as GeoJSON.FeatureCollection;
  }
  return bordersCache;
};

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const buildStyle = (points: ExplorerPoint[]): maplibregl.StyleSpecification => ({
  version: 8,
  projection: { type: 'globe' },
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    satellite: {
      type: 'raster',
      tiles: [SATELLITE_TILE_URL],
      tileSize: 256,
      maxzoom: 19,
      attribution: '<a href="https://www.esri.com" target="_blank" rel="noreferrer">Esri</a> World Imagery · <a href="https://www.geonames.org" target="_blank" rel="noreferrer">GeoNames</a>'
    },
    countries: { type: 'geojson', data: borders() },
    stations: { type: 'geojson', data: toPlaces(points) },
    selected: { type: 'geojson', data: EMPTY },
    active: { type: 'geojson', data: EMPTY },
    place: { type: 'geojson', data: EMPTY }
  },
  layers: [
    // Transparent sky: the app's own themed background shows around the planet.
    { id: 'sky', type: 'background', paint: { 'background-color': '#eadbc3', 'background-opacity': 0 } },
    {
      id: 'earth',
      type: 'raster',
      source: 'satellite',
      paint: { 'raster-saturation': -0.12, 'raster-contrast': 0.12, 'raster-brightness-max': 0.78, 'raster-fade-duration': 200 }
    },
    { id: 'borders', type: 'line', source: 'countries', paint: { 'line-color': '#ffe6bb', 'line-opacity': 0.36, 'line-width': 0.6 } },
    {
      id: 'active-halo',
      type: 'circle',
      source: 'active',
      paint: { 'circle-radius': 14, 'circle-color': '#ffd08a55', 'circle-stroke-color': '#ffe3b3', 'circle-stroke-width': 1.5, 'circle-blur': 0.2 }
    },
    {
      id: 'dots-glow', type: 'circle', source: 'stations',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 3, 5, 5, 10, 8],
        'circle-color': '#0d221c', 'circle-opacity': 0.6, 'circle-blur': 0.65
      }
    },
    {
      id: 'dots', type: 'circle', source: 'stations',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 0.9, 3, 1.35, 6, 2.2, 10, 3.5],
        'circle-color': genreColorExpression() as maplibregl.ExpressionSpecification,
        'circle-stroke-color': '#ffffff', 'circle-stroke-width': 0.35
      }
    },
    {
      id: 'place-ring', type: 'circle', source: 'place',
      paint: { 'circle-radius': 15, 'circle-color': '#fff4da', 'circle-opacity': 0.1,
        'circle-stroke-color': '#fff4da', 'circle-stroke-width': 1.5 }
    },
    {
      id: 'active-dot',
      type: 'circle',
      source: 'active',
      paint: { 'circle-radius': 6, 'circle-color': '#fff7e4', 'circle-stroke-color': '#a5452b', 'circle-stroke-width': 3 }
    },
    { id: 'selection-halo', type: 'circle', source: 'selected', paint: { 'circle-radius': 15, 'circle-color': '#ffe1a555', 'circle-stroke-color': '#fff2cbbb', 'circle-stroke-width': 1 } },
    { id: 'selection', type: 'circle', source: 'selected', paint: { 'circle-radius': 6, 'circle-color': '#a5452b', 'circle-stroke-color': '#fff5d9', 'circle-stroke-width': 3 } },
    {
      id: 'selection-name',
      type: 'symbol',
      source: 'selected',
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Open Sans Semibold'],
        'text-size': 12,
        'text-anchor': 'top',
        'text-offset': [0, 1.6],
        'text-max-width': 14,
        'text-allow-overlap': true
      },
      paint: { 'text-color': '#fff7e4', 'text-halo-color': '#324439', 'text-halo-width': 2 }
    }
  ]
});

export const ExplorerMap = ({
  points,
  selectedId,
  placeId,
  activeId,
  flight,
  onReady,
  onPick,
  onGroup,
  onUserMove,
  onError,
  handleRef
}: ExplorerMapProps & { handleRef?: MutableRefObject<ExplorerMapHandle | null> }) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const pointsRef = useRef(points);
  const callbacksRef = useRef({ onReady, onPick, onGroup, onUserMove, onError });
  const userMovedRef = useRef(false);
  const flightKeyRef = useRef<number | null>(null);
  useEffect(() => {
    callbacksRef.current = { onReady, onPick, onGroup, onUserMove, onError };
    pointsRef.current = points;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host || mapRef.current) return;
    let disposed = false;
    const map = new maplibregl.Map({
      container: host,
      style: buildStyle(pointsRef.current),
      center: [0, 25],
      zoom: 0.8,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      maxPitch: 0,
      clickTolerance: 12,
      // Our own observer below decides WHEN to resize; MapLibre's built-in one
      // would still stop() a pending drag on every animation frame.
      trackResize: false,
      fadeDuration: reduceMotion() ? 0 : 200
    });
    mapRef.current = map;

    const area = (): ExplorerArea => {
      const b = map.getBounds();
      const bounds = { west: b.getWest(), east: b.getEast(), south: b.getSouth(), north: b.getNorth() };
      const ids = pointsRef.current.filter((p) => b.contains([p.lon, p.lat])).map((p) => p.id);
      return { ids, bounds, center: { lat: map.getCenter().lat, lon: map.getCenter().lng }, zoom: map.getZoom() };
    };
    if (handleRef) {
      handleRef.current = {
        area: () => {
          if (!readyRef.current) return null;
          map.stop();
          return area();
        },
        zoom: () => map.getZoom(),
        zoomBy: (delta) => {
          userMovedRef.current = true;
          map.easeTo({ zoom: Math.max(0.6, Math.min(15, map.getZoom() + delta)), duration: reduceMotion() ? 0 : 320 });
        }
      };
    }

    // Camera state for whoever needs to wait for a flight to land (the specs
    // do: a tap during an ease interrupts it and leaves the group off-centre).
    host.dataset.camera = 'idle';
    host.dataset.moves = '0';
    let moves = 0;
    map.on('movestart', () => {
      host.dataset.camera = 'moving';
    });
    map.on('moveend', () => {
      moves += 1;
      host.dataset.moves = String(moves);
      host.dataset.camera = 'idle';
      host.dataset.zoom = map.getZoom().toFixed(2);
    });
    map.on('load', () => {
      if (disposed) return;
      readyRef.current = true;
      (map.getSource('stations') as GeoJSONSource).setData(toPlaces(pointsRef.current));
      map.triggerRepaint();
      callbacksRef.current.onReady?.();
    });
    map.on('dragstart', () => {
      userMovedRef.current = true;
    });
    map.on('zoomstart', (event) => {
      if ((event as { originalEvent?: unknown }).originalEvent) userMovedRef.current = true;
    });
    map.on('moveend', () => {
      if (!readyRef.current || disposed || !userMovedRef.current) return;
      userMovedRef.current = false;
      callbacksRef.current.onUserMove(area());
    });
    map.on('click', (event) => {
      if (!readyRef.current) return;
      // Small visual points, generous touch targets. Rank by distance to the
      // real position instead of inflating markers or moving them apart.
      const box: [[number, number], [number, number]] = [
        [event.point.x - 22, event.point.y - 22], [event.point.x + 22, event.point.y + 22]
      ];
      const hits = map.queryRenderedFeatures(box, { layers: ['dots'] });
      const distance = (hit: maplibregl.MapGeoJSONFeature) => {
        const p = map.project((hit.geometry as GeoJSON.Point).coordinates as [number, number]);
        return Math.hypot(p.x - event.point.x, p.y - event.point.y);
      };
      const hit = hits.filter(hit => distance(hit) <= 22).sort((a, b) => distance(a) - distance(b))[0];
      if (!hit) return;
      // Read the unquantized coordinate from the catalogue; rendered tile
      // geometry may have been rounded by the worker.
      const anchor = pointsRef.current.find(p => p.id === String(hit.properties.id));
      if (!anchor) return;
      const ids = pointsRef.current.filter(p => p.lat === anchor.lat && p.lon === anchor.lon).map(p => p.id);
      if (ids.length > 1) callbacksRef.current.onGroup(ids);
      else callbacksRef.current.onPick(anchor.id);
    });
    const pointer = () => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const reset = () => {
      map.getCanvas().style.cursor = '';
    };
    for (const layer of ['dots', 'place-ring', 'selection-halo']) {
      map.on('mouseenter', layer, pointer);
      map.on('mouseleave', layer, reset);
    }

    // MapLibre globe cold-mount workaround, same as the reticle Globe: the first
    // tiles arrive but the renderer commits nothing until the camera moves.
    let kicked = false;
    const kick = () => {
      if (kicked || disposed) return;
      kicked = true;
      requestAnimationFrame(() => {
        if (disposed) return;
        const c = map.getCenter();
        map.easeTo({ center: [c.lng + 0.0001, c.lat], duration: 0 });
        map.easeTo({ center: [c.lng, c.lat], duration: 0 });
      });
    };
    const satelliteData = (event: maplibregl.MapDataEvent & { sourceId?: string }) => {
      if (event.sourceId !== 'satellite') return;
      map.triggerRepaint();
      kick();
    };
    map.on('sourcedata', satelliteData);
    let attempts = 0;
    const warm = window.setInterval(() => {
      if (disposed) return;
      map.triggerRepaint();
      attempts += 1;
      if (attempts === 4) kick();
      if (attempts >= 12) {
        window.clearInterval(warm);
        map.off('sourcedata', satelliteData);
        host.dataset.globeWarmup = 'done';
      }
    }, 250);

    // The panel above the deck animates the map's height (240ms). MapLibre's
    // resize() calls map.stop(), which also discards a drag that has begun but
    // not yet passed the click tolerance — so resizing on every animation frame
    // made a pan started right after a panel toggle silently do nothing (found
    // by the e2e spec). Resize once the size has settled, never under a finger.
    let resizeTimer: number | null = null;
    let pointerDown = false;
    let resizePending = false;
    const settleResize = () => {
      if (disposed) return;
      if (pointerDown) {
        resizePending = true;
        return;
      }
      resizePending = false;
      map.resize();
      map.triggerRepaint();
    };
    const observer = new ResizeObserver(() => {
      if (disposed) return;
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null;
        settleResize();
      }, 80);
    });
    observer.observe(host);
    const onPointerDown = () => {
      pointerDown = true;
    };
    const onPointerUp = () => {
      pointerDown = false;
      // Let MapLibre receive mouseup before resize() calls stop(). Otherwise
      // the final pointerup can cancel the drag and leave a spurious click.
      if (resizePending) requestAnimationFrame(settleResize);
    };
    host.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    return () => {
      disposed = true;
      window.clearInterval(warm);
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      observer.disconnect();
      host.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      if (handleRef) handleRef.current = null;
      mapRef.current = null;
      readyRef.current = false;
      map.remove();
    };
    // Mounted once; everything else is synced by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncWhenReady = (apply: (map: maplibregl.Map) => void) => {
    const map = mapRef.current;
    if (!map) return;
    if (readyRef.current) {
      apply(map);
      return;
    }
    map.once('load', () => {
      if (mapRef.current === map) apply(map);
    });
  };

  useEffect(() => {
    syncWhenReady((map) => {
      (map.getSource('stations') as GeoJSONSource).setData(toPlaces(points));
    });
  }, [points]);

  useEffect(() => {
    syncWhenReady((map) => {
      const point = selectedId ? points.find((p) => p.id === selectedId) : null;
      (map.getSource('selected') as GeoJSONSource).setData(point ? toCollection([point]) : EMPTY);
    });
  }, [points, selectedId]);

  useEffect(() => {
    syncWhenReady(map => {
      const point = placeId ? points.find(p => p.id === placeId) : null;
      (map.getSource('place') as GeoJSONSource).setData(point ? toCollection([point]) : EMPTY);
    });
  }, [points, placeId]);

  useEffect(() => {
    syncWhenReady((map) => {
      const point = activeId ? points.find((p) => p.id === activeId) : null;
      (map.getSource('active') as GeoJSONSource).setData(point ? toCollection([point]) : EMPTY);
    });
  }, [points, activeId]);

  useEffect(() => {
    if (!flight || flightKeyRef.current === flight.key) return;
    flightKeyRef.current = flight.key;
    syncWhenReady((map) => {
      userMovedRef.current = false;
      map.easeTo({ center: [flight.center.lon, flight.center.lat], zoom: flight.zoom, duration: reduceMotion() ? 0 : 650 });
    });
  }, [flight]);

  return <div className="explorer-map" ref={hostRef} data-globe-warmup="active" />;
};

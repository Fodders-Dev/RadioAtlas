import { useEffect, useRef, type MutableRefObject } from 'react';
import maplibregl, { type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { feature as topoFeature } from 'topojson-client';
import worldData from '../../assets/countries-110m.json';
import { SPIDER_LIMIT, genreColorExpression, spiderOffsets, type ExplorerPoint, type LatLon, type MapBounds } from '../../lib/globeExplorer';

// The calm Globe's map (A4 «Журнал»): the same MapLibre globe, Natural Earth
// borders and Esri imagery as the reticle Globe, but the interaction is
// different on purpose — big single dots, clusters with their real counts, and
// a tap SELECTS. Playback is always a separate, explicit Play elsewhere.
//
// Dots are coloured by the coarse genre family the API derived from the
// station's tags (neutral when none). Points that share one coordinate — the
// catalogue has 373 such piles, the largest 198 stations at one point — open
// as a FAN: leaves spread on screen for legibility, each with a line back to
// the real point and a small anchor dot there, so the spread is never mistaken
// for real different addresses.

export type ExplorerArea = { ids: string[]; bounds: MapBounds; center: LatLon; zoom: number };

export type ExplorerFlight = { center: LatLon; zoom: number; key: number };

type ExplorerMapProps = {
  points: ExplorerPoint[];
  selectedId: string | null;
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

const CLUSTER_MAX_ZOOM = 13;
// A pile: what a cluster still holds past the zoom where clustering stops.
const PILE_ZOOM = CLUSTER_MAX_ZOOM + 1;

const DOT_STROKE = '#4a3726';

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
      attribution: '<a href="https://www.esri.com" target="_blank" rel="noreferrer">Esri</a> World Imagery'
    },
    countries: { type: 'geojson', data: borders() },
    stations: { type: 'geojson', data: toCollection(points), cluster: true, clusterRadius: 38, clusterMaxZoom: CLUSTER_MAX_ZOOM },
    selected: { type: 'geojson', data: EMPTY },
    active: { type: 'geojson', data: EMPTY },
    'spider-lines': { type: 'geojson', data: EMPTY },
    'spider-anchor': { type: 'geojson', data: EMPTY },
    spider: { type: 'geojson', data: EMPTY }
  },
  layers: [
    // Transparent sky: the app's own themed background shows around the planet.
    { id: 'sky', type: 'background', paint: { 'background-color': '#eadbc3', 'background-opacity': 0 } },
    {
      id: 'earth',
      type: 'raster',
      source: 'satellite',
      paint: { 'raster-saturation': -0.45, 'raster-contrast': -0.12, 'raster-brightness-min': 0.18, 'raster-fade-duration': 200 }
    },
    { id: 'borders', type: 'line', source: 'countries', paint: { 'line-color': '#ffe6bb', 'line-opacity': 0.36, 'line-width': 0.6 } },
    {
      id: 'active-halo',
      type: 'circle',
      source: 'active',
      paint: { 'circle-radius': 24, 'circle-color': '#ffd08a55', 'circle-stroke-color': '#ffe3b3', 'circle-stroke-width': 1.5, 'circle-blur': 0.2 }
    },
    { id: 'groups-shadow', type: 'circle', source: 'stations', filter: ['has', 'point_count'], paint: { 'circle-radius': 23, 'circle-color': '#3f5c4633', 'circle-blur': 0.5 } },
    {
      id: 'groups',
      type: 'circle',
      source: 'stations',
      filter: ['has', 'point_count'],
      paint: {
        'circle-radius': ['step', ['get', 'point_count'], 17, 50, 20, 200, 23],
        'circle-color': '#fff1d8',
        'circle-stroke-color': '#fffbee',
        'circle-stroke-width': 2,
        'circle-opacity': 0.95
      }
    },
    {
      id: 'counts',
      type: 'symbol',
      source: 'stations',
      filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Open Sans Semibold'], 'text-size': 12, 'text-allow-overlap': true },
      paint: { 'text-color': '#574631' }
    },
    {
      id: 'dots',
      type: 'circle',
      source: 'stations',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': 11,
        'circle-color': genreColorExpression() as maplibregl.ExpressionSpecification,
        'circle-stroke-color': DOT_STROKE,
        'circle-stroke-width': 1.5
      }
    },
    { id: 'spider-lines', type: 'line', source: 'spider-lines', paint: { 'line-color': '#fff4dc', 'line-opacity': 0.8, 'line-width': 1.2 } },
    {
      id: 'spider-anchor',
      type: 'circle',
      source: 'spider-anchor',
      paint: { 'circle-radius': 5, 'circle-color': DOT_STROKE, 'circle-stroke-color': '#fff4dc', 'circle-stroke-width': 1.5 }
    },
    {
      id: 'spider-dots',
      type: 'circle',
      source: 'spider',
      paint: {
        'circle-radius': ['case', ['get', 'active'], 12, 10],
        'circle-color': genreColorExpression() as maplibregl.ExpressionSpecification,
        'circle-stroke-color': ['case', ['get', 'active'], '#a5452b', DOT_STROKE],
        'circle-stroke-width': ['case', ['get', 'active'], 3, 1.5]
      }
    },
    {
      id: 'spider-name',
      type: 'symbol',
      source: 'spider',
      filter: ['==', ['get', 'active'], true],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Open Sans Semibold'],
        'text-size': 12,
        'text-anchor': 'top',
        'text-offset': [0, 1.4],
        'text-max-width': 14,
        'text-allow-overlap': true
      },
      paint: { 'text-color': '#fff7e4', 'text-halo-color': '#324439', 'text-halo-width': 2 }
    },
    {
      id: 'active-dot',
      type: 'circle',
      source: 'active',
      paint: { 'circle-radius': 12, 'circle-color': '#fff7e4', 'circle-stroke-color': '#a5452b', 'circle-stroke-width': 3 }
    },
    { id: 'selection-halo', type: 'circle', source: 'selected', paint: { 'circle-radius': 22, 'circle-color': '#ffe1a555', 'circle-stroke-color': '#fff2cbbb', 'circle-stroke-width': 1 } },
    { id: 'selection', type: 'circle', source: 'selected', paint: { 'circle-radius': 12, 'circle-color': '#a5452b', 'circle-stroke-color': '#fff5d9', 'circle-stroke-width': 3 } },
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
  const selectionRevisionRef = useRef(0);
  const flightKeyRef = useRef<number | null>(null);
  const selectedIdRef = useRef(selectedId);
  // The open fan, if any: its shared point, the zoom it opened at and its leaves.
  const spiderRef = useRef<{ anchor: [number, number]; zoom: number; leaves: ExplorerPoint[] } | null>(null);
  const spiderApiRef = useRef<{ render: () => void; close: () => void } | null>(null);
  useEffect(() => {
    callbacksRef.current = { onReady, onPick, onGroup, onUserMove, onError };
    pointsRef.current = points;
    selectedIdRef.current = selectedId;
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

    // ---- the fan ---------------------------------------------------------
    const renderSpider = () => {
      if (!readyRef.current || disposed) return;
      const spider = spiderRef.current;
      const linesSource = map.getSource('spider-lines') as GeoJSONSource | undefined;
      const anchorSource = map.getSource('spider-anchor') as GeoJSONSource | undefined;
      const leafSource = map.getSource('spider') as GeoJSONSource | undefined;
      if (!linesSource || !anchorSource || !leafSource) return;
      if (!spider) {
        linesSource.setData(EMPTY);
        anchorSource.setData(EMPTY);
        leafSource.setData(EMPTY);
        return;
      }
      const center = map.project(spider.anchor);
      const offsets = spiderOffsets(spider.leaves.length);
      const leaves: GeoJSON.Feature<GeoJSON.Point>[] = [];
      const lines: GeoJSON.Feature<GeoJSON.LineString>[] = [];
      spider.leaves.forEach((leaf, index) => {
        const offset = offsets[index];
        if (!offset) return;
        const at = map.unproject([center.x + offset.x, center.y + offset.y]);
        leaves.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [at.lng, at.lat] },
          properties: { id: leaf.id, name: leaf.name || '', genre: leaf.genre || '', active: leaf.id === selectedIdRef.current }
        });
        lines.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[leaf.lon, leaf.lat], [at.lng, at.lat]] },
          properties: {}
        });
      });
      linesSource.setData({ type: 'FeatureCollection', features: lines });
      anchorSource.setData({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: spider.anchor }, properties: {} }]
      });
      leafSource.setData({ type: 'FeatureCollection', features: leaves });
    };
    const closeSpider = () => {
      if (!spiderRef.current) return;
      spiderRef.current = null;
      host.dataset.spider = '';
      renderSpider();
    };
    const openSpider = (anchor: [number, number], leaves: ExplorerPoint[]) => {
      if (leaves.length < 2) return;
      spiderRef.current = { anchor, zoom: map.getZoom(), leaves: leaves.slice(0, SPIDER_LIMIT) };
      host.dataset.spider = String(leaves.length);
      renderSpider();
    };
    spiderApiRef.current = { render: renderSpider, close: closeSpider };
    map.on('move', renderSpider);
    map.on('resize', renderSpider);
    map.on('zoomend', () => {
      const spider = spiderRef.current;
      if (spider && Math.abs(map.getZoom() - spider.zoom) > 0.75) closeSpider();
    });

    map.on('load', () => {
      if (disposed) return;
      readyRef.current = true;
      (map.getSource('stations') as GeoJSONSource).setData(toCollection(pointsRef.current));
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
      const leafBox: [[number, number], [number, number]] = [
        [event.point.x - 14, event.point.y - 14],
        [event.point.x + 14, event.point.y + 14]
      ];
      const leaf = map.queryRenderedFeatures(leafBox, { layers: ['spider-dots'] })[0];
      if (leaf) {
        callbacksRef.current.onPick(String(leaf.properties.id));
        return;
      }
      const box: [[number, number], [number, number]] = [
        [event.point.x - 22, event.point.y - 22],
        [event.point.x + 22, event.point.y + 22]
      ];
      const hits = map.queryRenderedFeatures(box, { layers: ['groups', 'dots'] });
      const selected = map.queryRenderedFeatures(event.point, { layers: ['selection-halo'] })[0];
      // A tap on the selected source re-picks it — unless a group or a pile
      // sits under that same ring: then the listener is asking what else is
      // here, and the ring must not swallow the tap.
      const pileUnder =
        hits.some((hit) => hit.properties.cluster) ||
        new Set(hits.filter((hit) => !hit.properties.cluster).map((hit) => String(hit.properties.id))).size > 1;
      if (selected && !pileUnder) {
        callbacksRef.current.onPick(String(selected.properties.id));
        return;
      }
      const revision = ++selectionRevisionRef.current;
      if (!hits.length) {
        closeSpider();
        return;
      }
      const byId = new Map(pointsRef.current.map((point) => [point.id, point]));
      const distance = (hit: maplibregl.MapGeoJSONFeature) => {
        const projected = map.project((hit.geometry as GeoJSON.Point).coordinates as [number, number]);
        return Math.hypot(projected.x - event.point.x, projected.y - event.point.y);
      };
      hits.sort((a, b) => distance(a) - distance(b));
      const hit = hits[0];
      const source = map.getSource('stations') as GeoJSONSource;
      if (hit.properties.cluster) {
        void (async () => {
          try {
            const [leaves, zoom] = await Promise.all([
              source.getClusterLeaves(hit.properties.cluster_id, hit.properties.point_count, 0),
              source.getClusterExpansionZoom(hit.properties.cluster_id)
            ]);
            if (disposed || revision !== selectionRevisionRef.current) return;
            const ids = leaves.map((leaf) => String(leaf.properties?.id));
            callbacksRef.current.onGroup(ids);
            closeSpider();
            const center = (hit.geometry as GeoJSON.Point).coordinates as [number, number];
            // Past the clustering zoom the group is a pile of (near-)coincident
            // points: zooming alone would leave them on top of each other, so
            // the pile opens as a fan once the camera has settled.
            const pile = zoom >= PILE_ZOOM;
            if (pile) {
              // The list change above may already have re-synced the points
              // (which closes any open fan); the fan for THIS tap opens once
              // the camera settles, unless the map is gone.
              map.once('moveend', () => {
                if (disposed) return;
                openSpider(center, ids.map((id) => byId.get(id)).filter((p): p is ExplorerPoint => Boolean(p)));
              });
            }
            map.easeTo({
              center,
              zoom: Math.min(zoom, 15),
              duration: reduceMotion() ? 0 : 600
            });
          } catch {
            if (!disposed) callbacksRef.current.onError?.();
          }
        })();
        return;
      }
      const unique = [...new Set(hits.filter((p) => !p.properties.cluster).map((p) => String(p.properties.id)))];
      if (unique.length > 1) {
        // Several dots under one finger: list them AND fan them out here, each
        // leaf tied to its own real point.
        callbacksRef.current.onGroup(unique);
        openSpider(
          (hit.geometry as GeoJSON.Point).coordinates as [number, number],
          unique.map((id) => byId.get(id)).filter((p): p is ExplorerPoint => Boolean(p))
        );
      } else {
        callbacksRef.current.onPick(String(hit.properties.id));
      }
    });
    const pointer = () => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const reset = () => {
      map.getCanvas().style.cursor = '';
    };
    for (const layer of ['groups', 'dots', 'selection-halo', 'spider-dots']) {
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
      if (resizePending) settleResize();
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
      spiderApiRef.current = null;
      spiderRef.current = null;
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
    selectionRevisionRef.current += 1;
    spiderApiRef.current?.close();
    syncWhenReady((map) => (map.getSource('stations') as GeoJSONSource).setData(toCollection(points)));
  }, [points]);

  useEffect(() => {
    syncWhenReady((map) => {
      const point = selectedId ? points.find((p) => p.id === selectedId) : null;
      // A selected leaf of an open fan is marked on the fan itself; the
      // selection ring at the shared point would only sit under the anchor.
      const inSpider = Boolean(selectedId && spiderRef.current?.leaves.some((leaf) => leaf.id === selectedId));
      (map.getSource('selected') as GeoJSONSource).setData(point && !inSpider ? toCollection([point]) : EMPTY);
      spiderApiRef.current?.render();
    });
  }, [points, selectedId]);

  useEffect(() => {
    syncWhenReady((map) => {
      const point = activeId ? points.find((p) => p.id === activeId) : null;
      (map.getSource('active') as GeoJSONSource).setData(point ? toCollection([point]) : EMPTY);
    });
  }, [points, activeId]);

  useEffect(() => {
    if (!flight || flightKeyRef.current === flight.key) return;
    flightKeyRef.current = flight.key;
    spiderApiRef.current?.close();
    syncWhenReady((map) => {
      userMovedRef.current = false;
      map.easeTo({ center: [flight.center.lon, flight.center.lat], zoom: flight.zoom, duration: reduceMotion() ? 0 : 650 });
    });
  }, [flight]);

  return <div className="explorer-map" ref={hostRef} data-globe-warmup="active" />;
};

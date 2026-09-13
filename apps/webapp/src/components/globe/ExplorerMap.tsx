import { useEffect, useRef, type MutableRefObject } from 'react';
import maplibregl, { type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { feature as topoFeature } from 'topojson-client';
import worldData from '../../assets/countries-110m.json';
import { genreColorExpression, spreadMapPoints, type ExplorerPoint, type LatLon, type MapBounds } from '../../lib/globeExplorer';

// The calm Globe's map (A4 «Журнал»): the same MapLibre globe, Natural Earth
// borders and Esri imagery as the reticle Globe, but the interaction is
// different on purpose — big single dots, clusters with their real counts, and
// a tap SELECTS. Playback is always a separate, explicit Play elsewhere.
//
// Dots are coloured by the coarse genre family the API derived from the
// station's tags (neutral when none). Points that share one coordinate — the
// catalogue has many such piles — spread automatically at regional scale.
// Every visible source is represented, with no 24-source cap. Only a selected
// dot gets a tether to the original coordinate; the UI explains the offsets.

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

const CLUSTER_MAX_ZOOM = 3;
// Individual stations replace clusters at regional scale.
const DETAIL_ZOOM = CLUSTER_MAX_ZOOM + 1;

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
    stations: { type: 'geojson', data: toCollection(points), cluster: true, clusterRadius: 48, clusterMaxZoom: CLUSTER_MAX_ZOOM },
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
        'circle-radius': ['step', ['get', 'point_count'], 13, 50, 16, 200, 19],
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
      maxzoom: DETAIL_ZOOM,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 4, 5, 7],
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
        'circle-radius': ['case', ['get', 'active'], 9, ['get', 'radius']],
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
  // Visible individual stations at detail scale; display offsets never mutate catalogue coordinates.
  const spiderRef = useRef<{ leaves: ExplorerPoint[] } | null>(null);
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

    // ---- automatic detail points -----------------------------------------
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
      const bounds = map.getBounds();
      const width = host.clientWidth, height = host.clientHeight;
      const projected = pointsRef.current.filter(p => bounds.contains([p.lon, p.lat])).map(p => ({
        ...p, ...map.project([p.lon, p.lat])
      })).filter(p => p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height);
      const displayed = spreadMapPoints(projected, width, height);
      spider.leaves = projected;
      host.dataset.visiblePoints = String(displayed.length);
      const leaves: GeoJSON.Feature<GeoJSON.Point>[] = displayed.map(leaf => {
        const at = map.unproject([leaf.x, leaf.y]);
        return { type: 'Feature', geometry: { type: 'Point', coordinates: [at.lng, at.lat] },
          properties: { id: leaf.id, name: leaf.name || '', genre: leaf.genre || '', radius: leaf.radius, active: leaf.id === selectedIdRef.current } };
      });
      const selected = displayed.find(p => p.id === selectedIdRef.current);
      const tether = selected ? map.unproject([selected.x, selected.y]) : null;
      linesSource.setData(selected && tether ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[selected.lon, selected.lat], [tether.lng, tether.lat]] }, properties: {} }] } : EMPTY);
      anchorSource.setData(selected ? toCollection([selected]) : EMPTY);
      leafSource.setData({ type: 'FeatureCollection', features: leaves });
      // The detail source owns selection at its displayed position.
      (map.getSource('selected') as GeoJSONSource).setData(EMPTY);
    };
    const closeSpider = () => {
      spiderRef.current = null;
      host.dataset.visiblePoints = '0';
      renderSpider();
    };
    const refreshDetails = () => {
      host.dataset.detail = String(map.getZoom() >= DETAIL_ZOOM);
      if (map.getZoom() < DETAIL_ZOOM) {
        closeSpider();
        const selected = pointsRef.current.find(point => point.id === selectedIdRef.current);
        (map.getSource('selected') as GeoJSONSource | undefined)?.setData(selected ? toCollection([selected]) : EMPTY);
        return;
      }
      spiderRef.current ??= { leaves: [] };
      renderSpider();
    };
    spiderApiRef.current = { render: refreshDetails, close: closeSpider };
    map.on('moveend', refreshDetails);
    map.on('resize', refreshDetails);
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
      (map.getSource('stations') as GeoJSONSource).setData(toCollection(pointsRef.current));
      map.triggerRepaint();
      callbacksRef.current.onReady?.();
      refreshDetails();
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
      const leaf = map.queryRenderedFeatures(leafBox, { layers: ['spider-dots'] }).sort((a, b) => {
        const distance = (f: maplibregl.MapGeoJSONFeature) => { const p = map.project((f.geometry as GeoJSON.Point).coordinates as [number, number]); return Math.hypot(p.x - event.point.x, p.y - event.point.y); };
        return distance(a) - distance(b);
      })[0];
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
        return;
      }
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
            const leaves = await source.getClusterLeaves(hit.properties.cluster_id, hit.properties.point_count, 0);
            if (disposed || revision !== selectionRevisionRef.current) return;
            const ids = leaves.map((leaf) => String(leaf.properties?.id));
            callbacksRef.current.onGroup(ids);
            closeSpider();
            const center = (hit.geometry as GeoJSON.Point).coordinates as [number, number];
            // One tap reaches the individual dots. No recursive cluster hunt.
            const bounds = new maplibregl.LngLatBounds();
            leaves.forEach(leaf => bounds.extend((leaf.geometry as GeoJSON.Point).coordinates as [number, number]));
            const camera = map.cameraForBounds(bounds, { padding: 60, maxZoom: 6 });
            // Commit the destination immediately: opening the results may
            // resize the map, and resize() stops an unfinished camera ease.
            map.jumpTo({ center: camera?.center || center, zoom: Math.max(DETAIL_ZOOM, camera?.zoom || DETAIL_ZOOM) });
          } catch {
            if (!disposed) callbacksRef.current.onError?.();
          }
        })();
        return;
      }
      callbacksRef.current.onPick(String(hit.properties.id));
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
    syncWhenReady((map) => {
      (map.getSource('stations') as GeoJSONSource).setData(toCollection(points));
      spiderApiRef.current?.render();
    });
  }, [points]);

  useEffect(() => {
    syncWhenReady((map) => {
      const point = selectedId ? points.find((p) => p.id === selectedId) : null;
      // Detail selection belongs to the displayed dot; a second selection
      // ring at its catalogue coordinate would sit under the anchor.
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

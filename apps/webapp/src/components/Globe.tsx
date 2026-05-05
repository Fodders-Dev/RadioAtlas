import { useEffect, useRef, useState } from 'react';
import maplibregl, { type MapGeoJSONFeature } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './globe/globe.css';

type GlobePoint = {
  id: string;
  lat: number;
  lon: number;
  label?: string;
  subtitle?: string;
  count?: number;
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
  // Fires after the camera has been still for ~400 ms with the same
  // station as `onReticleHover` reported. The parent treats this as a
  // "play it" signal — Radio Garden style auto-tune.
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
      count: point.count ?? 1
    }
  }))
});

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
  const onReticleHoverRef = useRef(onReticleHover);
  const onReticleSettleRef = useRef(onReticleSettle);
  useEffect(() => {
    onReticleHoverRef.current = onReticleHover;
    onReticleSettleRef.current = onReticleSettle;
  });

  // Mount the map exactly once. Style and layers are loaded inside.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    if (mapRef.current) return;

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
      fadeDuration: 200
    });

    mapRef.current = map;

    map.on('load', () => {
      setReady(true);
    });

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

    map.on('click', 'stations-dot', (event) => {
      const feature = event.features?.[0] as MapGeoJSONFeature | undefined;
      const stationId = feature?.properties?.id;
      if (typeof stationId === 'string') {
        onPick?.(stationId);
      }
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
      mapRef.current = null;
      map.remove();
    };
    // We deliberately don't depend on focusPoint/zoomLevel here — those are
    // synced through follow-up effects so the map instance stays alive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reticle-snap: while the user pans/zooms, highlight whichever
  // station's rendered dot is closest to the viewport centre, and
  // when the camera settles for ~450 ms emit a settle event so the
  // parent can auto-tune to that station — Radio Garden style.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    let lastHoverId: string | null = null;
    let userHasDragged = false;
    let settleTimeout: number | null = null;

    const findNearestStation = (): string | null => {
      const canvas = map.getCanvasContainer();
      const cx = canvas.clientWidth / 2;
      const cy = canvas.clientHeight / 2;
      // Search radius in screen pixels — wide enough that the reticle
      // always finds *something* unless the viewport is genuinely
      // empty (middle of the Pacific etc.).
      const radius = 280;
      let features: MapGeoJSONFeature[] = [];
      try {
        features = map.queryRenderedFeatures(
          [
            [cx - radius, cy - radius],
            [cx + radius, cy + radius]
          ],
          { layers: ['stations-dot'] }
        ) as MapGeoJSONFeature[];
      } catch {
        return null;
      }
      if (!features.length) return null;
      let nearestId: string | null = null;
      let nearestDist = Infinity;
      for (const feature of features) {
        const id = feature.properties?.id;
        if (typeof id !== 'string') continue;
        const geom = feature.geometry;
        if (!geom || geom.type !== 'Point') continue;
        const [lon, lat] = geom.coordinates as [number, number];
        const pt = map.project([lon, lat]);
        const dx = pt.x - cx;
        const dy = pt.y - cy;
        const d = dx * dx + dy * dy;
        if (d < nearestDist) {
          nearestDist = d;
          nearestId = id;
        }
      }
      return nearestId;
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

    const handleMoveStart = (event: maplibregl.MapLibreEvent) => {
      // Only count direct user gestures (mouse / touch / wheel),
      // not the programmatic easeTo / flyTo we fire when the parent
      // updates focusPoint after a tap or library deeplink.
      if ((event as { originalEvent?: unknown }).originalEvent) {
        userHasDragged = true;
      }
      cancelSettle();
    };

    const handleMoveEnd = () => {
      cancelSettle();
      // Only auto-tune after the user actually moved the camera with
      // their own input. Programmatic easeTo calls from focusPoint
      // changes shouldn't hijack playback.
      if (!userHasDragged) return;
      const id = findNearestStation();
      if (!id) return;
      const target = id;
      settleTimeout = window.setTimeout(() => {
        onReticleSettleRef.current?.(target);
        // Wait for the next genuine user gesture before auto-tuning
        // again, so the post-pick easeTo animation doesn't re-trigger
        // the settle on a different nearby station.
        userHasDragged = false;
        settleTimeout = null;
      }, 450);
    };

    map.on('movestart', handleMoveStart);
    map.on('move', handleMove);
    map.on('moveend', handleMoveEnd);
    // Initial pass so the parent can highlight what the reticle sees
    // at mount time (without auto-playing).
    handleMove();

    return () => {
      map.off('movestart', handleMoveStart);
      map.off('move', handleMove);
      map.off('moveend', handleMoveEnd);
      cancelSettle();
    };
  }, [ready]);

  // Push station points into the GeoJSON source whenever the prop changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource('stations') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData(buildPointsFeatureCollection(points));
  }, [points, ready]);

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
    map.easeTo({
      center: [focusPoint.lon, focusPoint.lat],
      duration: 700,
      essential: true
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
    map.easeTo({ zoom: targetZoom, duration: 320 });
  }, [ready, zoomLevel]);

  return (
    <div className="globe globe-maplibre" ref={containerRef}>
      <div className="globe-reticle" aria-hidden="true">
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

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { resolveCountryCoords, resolveStationCoords } from '../lib/geoResolver';
import { useDebounce } from '../lib/useDebounce';
import { useCatalog } from '../state/CatalogContext';
import { useLibrary, usePlayback, useShell } from '../state/RadioContext';
import { useLocale } from '../state/LocaleContext';
import { StationArtwork } from '../components/StationArtwork';
import type { CatalogArea, CatalogStationPoint } from '../domain/contracts';
import type { StationLite } from '../types';
import './discover.css';

const Globe = lazy(() => import('../components/Globe').then((mod) => ({ default: mod.Globe })));

// Where the orthographic-with-bitmap fallback gives way to live satellite
// tiles. Below this any zoom feels like soft watercolour earth, above it
// you get street-level imagery. We keep the threshold low so the soft
// fallback only shows on the cold "see the whole planet" view.
const SATELLITE_THRESHOLD = 1.4;

export const GlobeScreen = () => {
  const { t } = useLocale();
  const { fetchAreas, fetchPoints, fetchStationById } = useCatalog();
  const { favorites, recent, followedRegions } = useLibrary();
  const { player, playStation } = usePlayback();
  const { globeFocusRegionId, setGlobeFocusRegionId } = useShell();
  const [zoomLevel, setZoomLevel] = useState(1);
  const [points, setPoints] = useState<CatalogStationPoint[]>([]);
  const [overviewAreas, setOverviewAreas] = useState<CatalogArea[]>([]);
  const [pickedStation, setPickedStation] = useState<StationLite | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  // When the user opens the globe through "Open in Globe" from a followed
  // region in the library, this is the lat/lon we snap to on entry. Once
  // applied, we clear globeFocusRegionId so the next mount stays neutral.
  const [externalFocus, setExternalFocus] = useState<{ lat: number; lon: number } | null>(null);
  const debouncedZoom = useDebounce(zoomLevel, 200);
  const overviewRequestRef = useRef(0);

  useEffect(() => {
    if (!globeFocusRegionId) return;
    const region =
      followedRegions.find(
        (item) =>
          item.id.toLowerCase() === globeFocusRegionId.toLowerCase() ||
          item.label.toLowerCase() === globeFocusRegionId.toLowerCase()
      ) || null;
    const label = region?.label || globeFocusRegionId;
    const coords = resolveCountryCoords(label);
    if (coords) {
      setExternalFocus(coords);
      setZoomLevel((value) => Math.max(value, 2));
    }
    setGlobeFocusRegionId(null);
  }, [followedRegions, globeFocusRegionId, setGlobeFocusRegionId]);

  // Per-station points — Radio Garden style sprinkle. Loaded once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetchPoints();
        if (cancelled) return;
        setPoints(response.items);
      } catch {
        // No-op — overview pills still render at low zoom.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchPoints]);

  // At cold zoom we still want chunky country pills so the planet doesn't
  // look empty before the points payload streams in. Refresh whenever the
  // user zooms out far enough to see the world.
  useEffect(() => {
    if (debouncedZoom >= SATELLITE_THRESHOLD) return;
    const requestId = overviewRequestRef.current + 1;
    overviewRequestRef.current = requestId;
    void (async () => {
      try {
        const response = await fetchAreas(debouncedZoom);
        if (overviewRequestRef.current !== requestId) return;
        setOverviewAreas(response.items);
      } catch {
        // Tolerate offline; points already cover the globe at higher zooms.
      }
    })();
  }, [debouncedZoom, fetchAreas]);

  const usePointsLayer = points.length > 0 && zoomLevel >= SATELLITE_THRESHOLD;

  const globePoints = useMemo(() => {
    if (usePointsLayer) {
      return points.map((point) => ({
        id: `station:${point.id}`,
        lat: point.lat,
        lon: point.lon,
        label: '',
        subtitle: point.country || ''
      }));
    }
    return overviewAreas.map((area) => ({
      id: area.id,
      lat: area.lat,
      lon: area.lon,
      label: area.label,
      subtitle: area.subtitle,
      count: area.count
    }));
  }, [overviewAreas, points, usePointsLayer]);

  // The first thing we tilt toward when the user enters the globe screen.
  // Prefer whatever they're playing; otherwise nudge to a recent / liked
  // station, otherwise leave the planet at its natural rest.
  const initialFocus = useMemo(() => {
    if (player.current) return resolveStationCoords(player.current);
    if (recent[0]) return resolveStationCoords(recent[0]);
    if (favorites[0]) return resolveStationCoords(favorites[0]);
    return null;
  }, [favorites, player.current, recent]);

  const focusPoint = pickedStation
    ? resolveStationCoords(pickedStation)
    : externalFocus || initialFocus;

  const handlePick = (id: string) => {
    if (!id.startsWith('station:')) return;
    const stationId = id.slice('station:'.length);
    setPickError(null);
    void (async () => {
      try {
        const station = await fetchStationById(stationId);
        if (!station) {
          setPickError(t('globe.pickFailed'));
          return;
        }
        setPickedStation(station);
        playStation(station, {
          sourceId: 'globe-station',
          sourceLabel: station.country || station.name
        });
      } catch {
        setPickError(t('globe.pickFailed'));
      }
    })();
  };

  // The selected station card collapses if the user pans away or stops a
  // station. Treat the dock player as the source of truth for "what's
  // currently playing" — `pickedStation` is just our last-tapped entry.
  const visibleStation = pickedStation || player.current || null;
  const isSatelliteMode = zoomLevel >= SATELLITE_THRESHOLD;
  const activeStationId = player.current?.stationuuid;
  const activePointId = activeStationId ? `station:${activeStationId}` : undefined;
  const selectedPointId =
    pickedStation && pickedStation.stationuuid ? `station:${pickedStation.stationuuid}` : activePointId;

  return (
    <section
      className="screen screen-globe-v3"
      data-zoom-level={zoomLevel.toFixed(2)}
      data-satellite={isSatelliteMode ? 'true' : 'false'}
    >
      <div className="globe-stage">
        <Suspense fallback={<div className="globe globe-loading-surface" />}>
          <Globe
            points={globePoints}
            activeId={activePointId}
            selectedId={selectedPointId}
            focusPoint={focusPoint ?? undefined}
            zoomLevel={zoomLevel}
            onZoomChange={setZoomLevel}
            onPick={handlePick}
            hintText=""
            statusText=""
            immersive
          />
        </Suspense>
        <div className="globe-zoom-stack" aria-label={t('globe.zoom')}>
          <button
            className="globe-zoom-btn"
            type="button"
            onClick={() => setZoomLevel((value) => Math.min(10, value + 0.6))}
            aria-label={t('globe.zoomIn')}
          >
            +
          </button>
          <button
            className="globe-zoom-btn"
            type="button"
            onClick={() => setZoomLevel((value) => Math.max(0.5, value - 0.6))}
            aria-label={t('globe.zoomOut')}
          >
            −
          </button>
        </div>
        {visibleStation ? (
          <div className="globe-now-playing" data-globe-now>
            <StationArtwork station={visibleStation} size="sm" className="globe-now-art" />
            <div className="globe-now-copy">
              <div className="globe-now-name" title={visibleStation.name}>
                {visibleStation.name}
              </div>
              <div className="globe-now-meta">
                {[
                  visibleStation.language?.split(',')[0]?.trim(),
                  visibleStation.country || visibleStation.state
                ]
                  .filter(Boolean)
                  .join(' · ') || t('globe.unknownLocation')}
              </div>
            </div>
            <button
              className="globe-now-close"
              type="button"
              onClick={() => setPickedStation(null)}
              aria-label={t('globe.clearSelection')}
              hidden={!pickedStation}
            >
              ✕
            </button>
          </div>
        ) : null}
        {pickError ? <div className="globe-error">{pickError}</div> : null}
      </div>
    </section>
  );
};

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildStateAnchors,
  resolveCountryCoords,
  resolveStationCoords,
  setStateAnchors
} from '../lib/geoResolver';
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
  // Whatever the reticle is hovering over right now, even before the
  // camera settles. Drives the highlighted halo on the globe.
  const [reticleStationId, setReticleStationId] = useState<string | null>(null);
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

  // Once per-station points have streamed in we ALWAYS render them, no
  // matter the zoom — switching datasets mid-zoom made dots jump from
  // country centroids to their real coordinates, which looked like the
  // map was sliding sideways under the user. Country-area pills only act
  // as a placeholder until the points payload arrives.
  const usePointsLayer = points.length > 0;

  // Pre-compute (country, state) anchors from stations that DO carry
  // explicit Radio Browser geo coords, then register globally so
  // resolveStationCoords can use them as fallback positions for
  // coord-less stations. Done in a layout effect so the anchors are
  // live before globePoints recomputes.
  useEffect(() => {
    if (!points.length) {
      setStateAnchors(null);
      return;
    }
    setStateAnchors(buildStateAnchors(points));
    return () => setStateAnchors(null);
  }, [points]);

  const globePoints = useMemo(() => {
    if (usePointsLayer) {
      // The API ships ~55k stations now; only ~11k carry explicit
      // geo_lat/geo_long. For the rest geoResolver drops the dot
      // deterministically inside the country's borders (seeded by the
      // station UUID), so Russia gets ~3.5k green dots instead of
      // showing up as a single pin in Brooklyn.
      const result: Array<{
        id: string;
        lat: number;
        lon: number;
        label: string;
        subtitle: string;
        country?: string;
        state?: string;
        name?: string;
      }> = [];
      points.forEach((point) => {
        const resolved = resolveStationCoords({
          stationuuid: point.id,
          country: point.country,
          state: point.state,
          geo_lat: point.lat,
          geo_long: point.lon
        });
        if (!resolved) return;
        // Only stations whose coordinates came directly from Radio
        // Browser ('station' source) carry their state forward to
        // the cluster builder. Country-pool fallbacks are synthesized
        // points inside the country's bbox and would poison the
        // state-label centroid with random in-country offsets.
        const carryGeoText = resolved.source === 'station';
        result.push({
          id: `station:${point.id}`,
          country: carryGeoText ? point.country : undefined,
          state: carryGeoText ? point.state : undefined,
          name: point.name,
          lat: resolved.lat,
          lon: resolved.lon,
          label: '',
          subtitle: point.country || ''
        });
      });
      return result;
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

  // While dragging, just light up the candidate dot under the reticle.
  // No fetch, no network, no playback — purely visual feedback so the
  // user can see what they'd snap to.
  const handleReticleHover = (stationId: string | null) => {
    setReticleStationId(stationId);
  };

  // Camera has been still for ~450 ms; if the candidate the reticle
  // landed on isn't already what's playing, route through the same
  // pick pipeline a tap would use.
  const handleReticleSettle = (stationId: string) => {
    if (!stationId.startsWith('station:')) return;
    const rawId = stationId.slice('station:'.length);
    if (player.current?.stationuuid === rawId) return;
    handlePick(stationId);
  };

  // The selected station card collapses if the user pans away or stops a
  // station. Treat the dock player as the source of truth for "what's
  // currently playing" — `pickedStation` is just our last-tapped entry.
  const visibleStation = pickedStation || player.current || null;
  const isSatelliteMode = zoomLevel >= SATELLITE_THRESHOLD;
  const activeStationId = player.current?.stationuuid;
  const activePointId = activeStationId ? `station:${activeStationId}` : undefined;

  // O(1) lookup so the reticle context pill can pull country / state /
  // name without re-walking the 54k points array on every hover tick.
  const pointsById = useMemo(() => {
    const map = new Map<string, CatalogStationPoint>();
    points.forEach((point) => map.set(point.id, point));
    return map;
  }, [points]);

  // Roughly approximate local time at a longitude. lon / 15° ≈ UTC
  // offset hours. Inaccurate for political timezones in countries
  // that span many longitudes (Russia, US, China) but good enough
  // for "what time of day is it there?" — the user can look at the
  // map and read "≈ 03:42" rather than guessing whether they're
  // probably waking the locals up.
  const formatLocalTime = (lon: number, now: Date): string => {
    const offsetMinutes = (lon / 15) * 60;
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
    const target = new Date(utcMs + offsetMinutes * 60_000);
    const hh = String(target.getHours()).padStart(2, '0');
    const mm = String(target.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  };

  // What the reticle is currently sitting over. Drives the floating
  // "where am I" card so the user sees country / region / station
  // *before* committing — solves the "I'm zoomed in and have no idea
  // which country this is" problem.
  const reticleContext = useMemo(() => {
    if (!reticleStationId || !reticleStationId.startsWith('station:')) return null;
    const rawId = reticleStationId.slice('station:'.length);
    const point = pointsById.get(rawId);
    if (!point) return null;
    const localTime =
      typeof point.lon === 'number' ? formatLocalTime(point.lon, new Date()) : null;
    return {
      country: point.country || '',
      state: point.state || '',
      name: point.name || '',
      localTime
    };
  }, [reticleStationId, pointsById]);
  // Highlight priority: explicitly tapped > reticle candidate > now
  // playing. The reticle hover wins over now-playing so the user gets
  // immediate visual feedback while panning, even if they're still
  // hearing the previous station before the settle fires.
  const selectedPointId =
    (pickedStation && pickedStation.stationuuid && `station:${pickedStation.stationuuid}`) ||
    reticleStationId ||
    activePointId;

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
            onReticleHover={handleReticleHover}
            onReticleSettle={handleReticleSettle}
            playbackActive={Boolean(player.isPlaying)}
            hintText=""
            statusText=""
            immersive
          />
        </Suspense>
        {reticleContext ? (
          <div className="globe-context-card" data-globe-context>
            {reticleContext.country ? (
              <div className="globe-context-country">{reticleContext.country}</div>
            ) : null}
            {reticleContext.state ? (
              <div className="globe-context-state">{reticleContext.state}</div>
            ) : null}
            {reticleContext.name ? (
              <div className="globe-context-name" title={reticleContext.name}>
                {reticleContext.name}
              </div>
            ) : null}
            {reticleContext.localTime ? (
              <div
                className="globe-context-time"
                title="Approximate local time"
              >
                ≈ {reticleContext.localTime}
              </div>
            ) : null}
          </div>
        ) : null}
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

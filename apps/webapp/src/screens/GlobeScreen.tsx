import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  buildStateAnchors,
  resolveCountryCoords,
  resolveStationCoords,
  setStateAnchors
} from '../lib/geoResolver';
import { placeArea } from '../lib/globeAreas';
import { formatLocalTime } from '../lib/localTime';
import { normalizeStationName } from '../lib/stationUtils';
import { useDebounce } from '../lib/useDebounce';
import { useDialog } from '../lib/useDialog';
import { useMobileLayout } from '../lib/useMobileLayout';
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

const sheetIcon = {
  play: <path d="M8 5v14l11-7L8 5Z" />,
  pause: <path d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z" />,
  clear: (
    <path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6 6.4 5Z" />
  ),
  share: (
    <path d="M18 16.1c-.76 0-1.44.3-1.96.77L8.9 12.7c.06-.23.1-.46.1-.7s-.04-.47-.1-.7l7.06-4.12A2.99 2.99 0 1 0 15 5c0 .24.04.47.1.7L8.04 9.82A3 3 0 1 0 8.04 14.2l7.13 4.18c-.05.2-.08.41-.08.62A2.91 2.91 0 1 0 18 16.1Z" />
  ),
  collapse: <path d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6 1.4-1.4Z" />
};

type GlobeStationSheetProps = {
  station: StationLite;
  picked: boolean;
  isPlaying: boolean;
  onToggle: () => void;
  onClear: () => void;
  // null when the Telegram bot isn't configured — the share entry simply
  // doesn't exist (first VITE_TG_BOT gate on this screen).
  onShare: (() => void) | null;
  onClose: () => void;
};

// Globe station-details bottom sheet — the first consumer of the shared
// .bottom-sheet-card recipe (promoted from PR-6's player sheet). Mounted only
// while open, with its own useDialog (nesting one dialog root inside another
// double-handles Tab — PR-6 lesson). PORTALED to document.body: the screen
// tree sits inside .app-shell-v2 { isolation: isolate } with the animated
// .app-screen-frame, whose stacking context would pin even z-130 BELOW the
// fixed dock/nav. From body the sheet stacks above everything and useDialog
// inerts #root as a whole — true modal semantics.
const GlobeStationSheet = ({
  station,
  picked,
  isPlaying,
  onToggle,
  onClear,
  onShare,
  onClose
}: GlobeStationSheetProps) => {
  const { t } = useLocale();
  const rootRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialog(rootRef, { isOpen: true, onClose });

  const coords = resolveStationCoords(station);
  const localTime = coords ? formatLocalTime(coords.lon, new Date()) : null;
  const placeLine =
    [
      station.language?.split(',')[0]?.trim(),
      station.state,
      station.country
    ]
      .filter(Boolean)
      .join(' · ') || t('globe.unknownLocation');

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={rootRef}
      className="bottom-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-globe-sheet
    >
      <button
        className="bottom-sheet-scrim"
        type="button"
        tabIndex={-1}
        data-dialog-backdrop
        onClick={onClose}
        aria-label={t('common.close')}
      />
      <div className="bottom-sheet-card">
        <span className="bottom-sheet-handle" aria-hidden="true" />
        <div className="bottom-sheet-head">
          <div>
            <div className="bottom-sheet-kicker">{t('nav.globe')}</div>
            <div className="bottom-sheet-title" id={titleId}>
              {normalizeStationName(station.name)}
            </div>
          </div>
          <button
            className="bottom-sheet-close"
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {sheetIcon.collapse}
            </svg>
          </button>
        </div>

        <div className="globe-sheet-body">
          <div className="globe-sheet-station">
            <StationArtwork station={station} size="card" className="globe-sheet-art" />
            <div className="globe-sheet-copy">
              <div className="globe-sheet-name">{normalizeStationName(station.name)}</div>
              <div className="globe-sheet-place">{placeLine}</div>
            </div>
          </div>

          <div className="globe-sheet-actions">
            <button
              className="globe-sheet-action"
              type="button"
              onClick={onToggle}
              aria-label={isPlaying ? t('common.pause') : t('common.play')}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {isPlaying ? sheetIcon.pause : sheetIcon.play}
              </svg>
              <span>{isPlaying ? t('common.pause') : t('common.play')}</span>
            </button>
            <button
              className="globe-sheet-action"
              type="button"
              onClick={onClear}
              disabled={!picked}
              aria-label={t('globe.clearSelection')}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {sheetIcon.clear}
              </svg>
              <span>{t('globe.clearSelection')}</span>
            </button>
            {onShare ? (
              <button
                className="globe-sheet-action"
                type="button"
                onClick={onShare}
                aria-label={t('common.share')}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {sheetIcon.share}
                </svg>
                <span>{t('common.share')}</span>
              </button>
            ) : null}
          </div>

          {coords ? (
            <div className="globe-sheet-readout" title="Approximate local time">
              {localTime ? `≈ ${localTime}` : null}
              {localTime ? ' · ' : null}
              {`${coords.lat.toFixed(1)}°, ${coords.lon.toFixed(1)}°`}
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
};

export const GlobeScreen = () => {
  const { t } = useLocale();
  const { fetchAreas, fetchPoints, fetchStationById } = useCatalog();
  const { favorites, recent, followedRegions } = useLibrary();
  const { player, playStation, shareStation } = usePlayback();
  const { globeFocusRegionId, setGlobeFocusRegionId } = useShell();
  const isMobileLayout = useMobileLayout();
  // The selection preview's details sheet (mobile only). The persistent dock
  // already owns the current station, so this sheet is only for a different
  // station selected under the reticle.
  const [sheetOpen, setSheetOpen] = useState(false);
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
  const pickRequestRef = useRef(0);

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
  // explicit Radio Browser geo coords. Used by resolveStationCoords
  // to pin coord-less stations into the right oblast / state.
  //
  // CRITICAL ordering: this useMemo MUST run and the module-level
  // anchor map MUST be set BEFORE the globePoints useMemo below.
  // Doing it in a useEffect (post-render) introduced a one-frame
  // race where dots got rendered through the country-bbox sampler
  // (anchors null), and then the picked-station easeTo computed
  // its target through the now-populated anchor map — so the
  // camera flew to a different location than the dot the user
  // had aimed at. Running synchronously in render eliminates that.
  const stateAnchorMap = useMemo(
    () => (points.length ? buildStateAnchors(points) : null),
    [points]
  );
  // setStateAnchors is a module-level mutation, NOT a React setter,
  // so calling it during render is fine (it doesn't trigger any
  // additional renders). Cleanup happens on unmount via the effect
  // below so old anchors don't leak into other screens.
  setStateAnchors(stateAnchorMap);
  useEffect(() => () => setStateAnchors(null), []);

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
    return overviewAreas.map((area) => {
      // The pill's own coordinates are an average of whatever the API had, and
      // the API cannot tell a Moscow station filed at 82°S from a real one.
      // placeArea runs it through the same resolver that places the dots.
      const placed = placeArea(area);
      return {
        id: placed.id,
        lat: placed.lat,
        lon: placed.lon,
        label: placed.label,
        subtitle: placed.subtitle,
        count: placed.count
      };
    });
    // stateAnchorMap is in the dep list so this recomputes whenever
    // a fresh anchor map lands — guarantees the dots and the
    // focusPoint use the SAME resolveStationCoords result.
  }, [overviewAreas, points, usePointsLayer, stateAnchorMap]);

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

  const startStation = (station: StationLite) => {
    setPickError(null);
    setPickedStation(null);
    setSheetOpen(false);
    if (player.current?.stationuuid === station.stationuuid) {
      if (!player.isPlaying) void player.toggle();
      return;
    }
    playStation(station, {
      sourceId: 'globe-station',
      sourceLabel: station.country || station.name
    });
  };

  const resolvePointStation = (id: string, playImmediately: boolean) => {
    if (!id.startsWith('station:')) return;
    const stationId = id.slice('station:'.length);
    const requestId = pickRequestRef.current + 1;
    pickRequestRef.current = requestId;
    setPickError(null);
    void (async () => {
      try {
        const station = await fetchStationById(stationId);
        if (pickRequestRef.current !== requestId) return;
        if (!station) {
          setPickError(t('globe.pickFailed'));
          return;
        }
        if (playImmediately) {
          startStation(station);
          return;
        }
        // Settling on the station that is already in the global dock should
        // not create a second copy of the same now-playing surface.
        if (player.current?.stationuuid === station.stationuuid) {
          setPickedStation(null);
          return;
        }
        setPickedStation(station);
      } catch {
        if (pickRequestRef.current !== requestId) return;
        setPickError(t('globe.pickFailed'));
      }
    })();
  };

  // A direct point tap/click is explicit playback intent.
  const handlePick = (id: string) => resolvePointStation(id, true);

  // While dragging, just light up the candidate dot under the reticle.
  // No fetch, no network, no playback — purely visual feedback so the
  // user can see what they'd snap to.
  const handleReticleHover = (stationId: string | null) => {
    setReticleStationId(stationId);
  };

  // Camera has been still for ~450 ms. Resolve a preview only — moving the
  // map never starts or switches audio.
  const handleReticleSettle = (stationId: string) => {
    if (!stationId.startsWith('station:')) return;
    resolvePointStation(stationId, false);
  };

  const isSatelliteMode = zoomLevel >= SATELLITE_THRESHOLD;
  const activeStationId = player.current?.stationuuid;
  const activePointId = activeStationId ? `station:${activeStationId}` : undefined;
  // This surface is a selection preview, not another now-playing controller.
  // Once the selected station becomes current, the global dock is sufficient.
  const previewStation =
    pickedStation && pickedStation.stationuuid !== activeStationId ? pickedStation : null;

  // O(1) lookup so the reticle context pill can pull country / state /
  // name without re-walking the 54k points array on every hover tick.
  const pointsById = useMemo(() => {
    const map = new Map<string, CatalogStationPoint>();
    points.forEach((point) => map.set(point.id, point));
    return map;
  }, [points]);

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
      id: rawId,
      country: point.country || '',
      state: point.state || '',
      name: point.name || '',
      localTime
    };
  }, [reticleStationId, pointsById]);
  // The live reticle candidate wins while panning; the committed preview then
  // remains highlighted over empty space, with now-playing as the fallback.
  const selectedPointId =
    reticleStationId ||
    (pickedStation && pickedStation.stationuuid && `station:${pickedStation.stationuuid}`) ||
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
            hintText=""
            statusText=""
            immersive
          />
        </Suspense>
        {!player.current && !pickedStation ? (
          // Discoverability: tap-to-play isn't obvious. A clear cue over the
          // globe, dismissed once the user picks/plays their first station.
          <div className="globe-tap-hint" role="note">
            {t('globe.tapToPlayHint')}
          </div>
        ) : null}
        {reticleContext ? (
          isMobileLayout ? (
            // Compact aim-readout pill: COUNTRY · region on the first line,
            // station · ≈time on the second (two lines max). pointer-events
            // none — it's a live readout over the canvas, not a control.
            <div className="globe-aim-pill" data-globe-context>
              <div className="globe-aim-primary">
                {[reticleContext.country, reticleContext.state].filter(Boolean).join(' · ')}
              </div>
              {reticleContext.name || reticleContext.localTime ? (
                <div className="globe-aim-secondary">
                  {[
                    reticleContext.name ? normalizeStationName(reticleContext.name) : '',
                    reticleContext.localTime ? `≈ ${reticleContext.localTime}` : ''
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              ) : null}
              {reticleContext.name && pickedStation?.stationuuid !== reticleContext.id ? (
                <button
                  className="globe-aim-cta"
                  type="button"
                  onClick={() => handlePick(`station:${reticleContext.id}`)}
                  aria-label={`${t('common.play')}: ${normalizeStationName(reticleContext.name)}`}
                >
                  {t('globe.aimTapCta')}
                </button>
              ) : null}
            </div>
          ) : (
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
              {reticleContext.name && pickedStation?.stationuuid !== reticleContext.id ? (
                <button
                  className="globe-aim-cta"
                  type="button"
                  onClick={() => handlePick(`station:${reticleContext.id}`)}
                  aria-label={`${t('common.play')}: ${normalizeStationName(reticleContext.name)}`}
                >
                  {t('globe.aimTapCta')}
                </button>
              ) : null}
            </div>
          )
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
        {previewStation ? (
          <div
            className={isMobileLayout ? 'globe-now-bar' : 'globe-now-playing'}
            data-globe-selection-preview
            data-globe-now-bar={isMobileLayout ? 'selection' : undefined}
            data-globe-now={isMobileLayout ? undefined : 'selection'}
          >
            {isMobileLayout ? (
              <button
                className="globe-selection-summary"
                type="button"
                onClick={() => setSheetOpen(true)}
                aria-label={`${t('winamp.stationDetails')}: ${normalizeStationName(previewStation.name)}`}
              >
                <StationArtwork station={previewStation} size="sm" className="globe-now-art" />
                <span className="globe-now-copy">
                  <span className="globe-now-name">
                    {normalizeStationName(previewStation.name)}
                  </span>
                  <span className="globe-now-meta">
                    {[
                      previewStation.language?.split(',')[0]?.trim(),
                      previewStation.country || previewStation.state
                    ]
                      .filter(Boolean)
                      .join(' · ') || t('globe.unknownLocation')}
                  </span>
                </span>
              </button>
            ) : (
              <>
                <StationArtwork station={previewStation} size="sm" className="globe-now-art" />
                <div className="globe-now-copy">
                  <div className="globe-now-name" title={previewStation.name}>
                    {normalizeStationName(previewStation.name)}
                  </div>
                  <div className="globe-now-meta">
                    {[
                      previewStation.language?.split(',')[0]?.trim(),
                      previewStation.country || previewStation.state
                    ]
                      .filter(Boolean)
                      .join(' · ') || t('globe.unknownLocation')}
                  </div>
                </div>
              </>
            )}
            <button
              className="globe-selection-play"
              type="button"
              onClick={() => startStation(previewStation)}
              aria-label={`${t('common.play')}: ${normalizeStationName(previewStation.name)}`}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {sheetIcon.play}
              </svg>
              <span>{t('common.play')}</span>
            </button>
            <button
              className="globe-now-close"
              type="button"
              onClick={() => {
                pickRequestRef.current += 1;
                setPickedStation(null);
                setSheetOpen(false);
              }}
              aria-label={t('globe.clearSelection')}
            >
              ✕
            </button>
          </div>
        ) : null}
        {pickError ? <div className="globe-error">{pickError}</div> : null}
      </div>
      {isMobileLayout && sheetOpen && previewStation ? (
        <GlobeStationSheet
          station={previewStation}
          picked={Boolean(pickedStation)}
          isPlaying={
            player.current?.stationuuid === previewStation.stationuuid && Boolean(player.isPlaying)
          }
          onToggle={() => startStation(previewStation)}
          onClear={() => {
            pickRequestRef.current += 1;
            setPickedStation(null);
            setSheetOpen(false);
          }}
          onShare={
            Boolean(import.meta.env.VITE_TG_BOT)
              ? () => shareStation(previewStation)
              : null
          }
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </section>
  );
};

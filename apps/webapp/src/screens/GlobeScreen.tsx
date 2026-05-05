import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { RegionArtwork } from '../components/RegionArtwork';
import { StationTable } from '../components/StationTable';
import { findNearestAreaToPoint } from '../components/globe/selection';
import { resolveCountryCoords, resolveStationCoords } from '../lib/geoResolver';
import { useCompactLayout } from '../lib/useCompactLayout';
import { useDebounce } from '../lib/useDebounce';
import { useCatalog } from '../state/CatalogContext';
import { useLibrary, usePlayback, useShell } from '../state/RadioContext';
import { useLocale } from '../state/LocaleContext';
import type { CatalogArea, CatalogStationPoint } from '../domain/contracts';
import type { StationLite } from '../types';
import './discover.css';

const PLACE_LIST_LIMIT = 40;
const Globe = lazy(() => import('../components/Globe').then((mod) => ({ default: mod.Globe })));

export const GlobeScreen = () => {
  const { t } = useLocale();
  const { summary, summaryLoading, fetchAreas, fetchAreaStations, fetchPoints, fetchStationById } =
    useCatalog();
  const { favorites, recent, followedRegions, toggleFollowRegion } = useLibrary();
  const { player, playStation, playStationQueue } = usePlayback();
  const { setActiveSection, setLibraryTab, globeFocusRegionId, setGlobeFocusRegionId } = useShell();
  const isCompactLayout = useCompactLayout();
  const [zoomLevel, setZoomLevel] = useState(1);
  const [areas, setAreas] = useState<CatalogArea[]>([]);
  const [points, setPoints] = useState<CatalogStationPoint[]>([]);
  const [mappedStations, setMappedStations] = useState(0);
  const [totalStations, setTotalStations] = useState(0);
  const [areasLoading, setAreasLoading] = useState(false);
  const [areasError, setAreasError] = useState<string | null>(null);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [selectedAreaLoading, setSelectedAreaLoading] = useState(false);
  const [selectedAreaError, setSelectedAreaError] = useState<string | null>(null);
  const [areaStationCache, setAreaStationCache] = useState<Record<string, StationLite[]>>({});
  const [tuneRequestKey, setTuneRequestKey] = useState(0);
  const [spinRequestKey, setSpinRequestKey] = useState(0);
  const [autoRotateEnabled, setAutoRotateEnabled] = useState(false);
  const [focusedRegionLabel, setFocusedRegionLabel] = useState<string | null>(null);
  const selectedAnchorRef = useRef<{ lat: number; lon: number } | null>(null);
  const seededAreaRef = useRef(false);
  const debouncedZoom = useDebounce(zoomLevel, 120);
  const areaZoomLevel = isCompactLayout ? Math.max(debouncedZoom + 1.2, 4) : debouncedZoom;

  useEffect(() => {
    let cancelled = false;
    setAreasLoading(true);
    setAreasError(null);
    void (async () => {
      try {
        const response = await fetchAreas(areaZoomLevel);
        if (cancelled) return;
        setAreas(response.items);
        setMappedStations(response.mappedStations);
        setTotalStations(response.totalStations);
      } catch (error) {
        if (cancelled) return;
        setAreas([]);
        setMappedStations(0);
        setTotalStations(0);
        setAreasError(error instanceof Error ? error.message : t('discover.apiUnavailable'));
      } finally {
        if (!cancelled) {
          setAreasLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [areaZoomLevel, fetchAreas, t]);

  // Per-station points: fetched once. The globe paints these as a dense
  // green sprinkle once you start zooming in (~1.6+), so the planet feels
  // like a real radio map instead of fat country pills.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetchPoints();
        if (cancelled) return;
        setPoints(response.items);
        setMappedStations((prev) => Math.max(prev, response.mappedStations));
        setTotalStations((prev) => Math.max(prev, response.totalStations));
      } catch {
        // Areas overview already covers the empty case; silently fall back.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchPoints]);

  useEffect(() => {
    if (!selectedAreaId) return;
    if (areaStationCache[selectedAreaId]) return;

    let cancelled = false;
    setSelectedAreaLoading(true);
    setSelectedAreaError(null);
    void (async () => {
      try {
        const response = await fetchAreaStations(selectedAreaId, { limit: PLACE_LIST_LIMIT });
        if (cancelled) return;
        setAreaStationCache((prev) =>
          prev[selectedAreaId] ? prev : { ...prev, [selectedAreaId]: response.items }
        );
      } catch (error) {
        if (cancelled) return;
        setSelectedAreaError(error instanceof Error ? error.message : t('discover.apiUnavailable'));
      } finally {
        if (!cancelled) {
          setSelectedAreaLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [areaStationCache, fetchAreaStations, selectedAreaId, t]);

  const areaById = useMemo(() => new Map(areas.map((area) => [area.id, area])), [areas]);
  const selectedArea = selectedAreaId ? areaById.get(selectedAreaId) || null : null;
  const selectedStations = selectedArea ? areaStationCache[selectedArea.id] || [] : [];
  // Below zoom 1.6 we keep area cluster pills (a clean overview); above
  // that we paint every individual station as a small dot — the Radio
  // Garden style sprinkle the user is asking for. We fall back to the
  // area pills if /catalog/points has not loaded yet.
  const useStationPoints = points.length > 0 && zoomLevel >= 1.6;
  const globePoints = useMemo(() => {
    if (useStationPoints) {
      return points.map((point) => ({
        id: `station:${point.id}`,
        lat: point.lat,
        lon: point.lon,
        label: '',
        subtitle: point.country || ''
      }));
    }
    return areas.map((area) => ({
      id: area.id,
      lat: area.lat,
      lon: area.lon,
      label: area.label,
      subtitle: area.subtitle,
      count: area.count
    }));
  }, [areas, points, useStationPoints]);

  const activeAreaId = useMemo(() => {
    if (!player.current) return undefined;
    return Object.entries(areaStationCache).find(([, stations]) =>
      stations.some((station) => station.stationuuid === player.current?.stationuuid)
    )?.[0];
  }, [areaStationCache, player.current]);

  const focusPoint = useMemo(() => {
    if (selectedArea) {
      return { lat: selectedArea.lat, lon: selectedArea.lon };
    }
    return player.current ? resolveStationCoords(player.current) : null;
  }, [player.current, selectedArea]);

  const fallbackStations = useMemo(() => {
    const seen = new Set<string>();
    return [player.current, ...recent, ...favorites]
      .filter((station): station is StationLite => Boolean(station))
      .filter((station) => {
        if (seen.has(station.stationuuid)) return false;
        seen.add(station.stationuuid);
        return true;
      })
      .slice(0, 5);
  }, [favorites, player.current, recent]);

  const isSelectedRegionFollowed = selectedArea
    ? followedRegions.some(
        (region) =>
          region.id === selectedArea.id ||
          Boolean(focusedRegionLabel && region.label.toLowerCase() === focusedRegionLabel.toLowerCase())
      )
    : false;

  useEffect(() => {
    if (!globeFocusRegionId || !areas.length) return;
    const requestedRegion =
      followedRegions.find(
        (region) =>
          region.id.toLowerCase() === globeFocusRegionId.toLowerCase() ||
          region.label.toLowerCase() === globeFocusRegionId.toLowerCase()
      ) || null;
    const requestedLabel = requestedRegion?.label || globeFocusRegionId;
    const normalizedRequest = requestedLabel.toLowerCase();
    const regionMatches = areas.filter(
      (area) =>
        area.id.toLowerCase() === globeFocusRegionId.toLowerCase() ||
        area.label.toLowerCase() === normalizedRequest ||
        area.subtitle.toLowerCase() === normalizedRequest
    );
    const targetArea =
      areaById.get(globeFocusRegionId) ||
      regionMatches.sort((left, right) => right.count - left.count)[0] ||
      null;
    if (!targetArea) return;
    seededAreaRef.current = true;
    selectedAnchorRef.current = { lat: targetArea.lat, lon: targetArea.lon };
    setFocusedRegionLabel(requestedRegion?.scope === 'country' ? requestedRegion.label : null);
    setSelectedAreaId(targetArea.id);
    setZoomLevel((value) => Math.max(value, 1));
    setGlobeFocusRegionId(null);
  }, [areaById, areas, followedRegions, globeFocusRegionId, setGlobeFocusRegionId]);

  const openLibraryRegions = () => {
    setLibraryTab('collections');
    setActiveSection('library');
  };

  const clearSelection = () => {
    selectedAnchorRef.current = null;
    setFocusedRegionLabel(null);
    setSelectedAreaId(null);
    setZoomLevel(1);
  };

  const handleSelectArea = (id: string) => {
    // Station-uuid picks (raw points mode) bypass the area flow entirely
    // and play the station like the Radio Garden tap-to-tune behaviour.
    if (id.startsWith('station:')) {
      const stationId = id.slice('station:'.length);
      void (async () => {
        try {
          const station = await fetchStationById(stationId);
          if (!station) return;
          playStation(station, {
            sourceId: 'globe-station',
            sourceLabel: station.country || station.name
          });
        } catch {
          // Silently ignore — the user will see no playback start.
        }
      })();
      return;
    }
    const area = areaById.get(id);
    if (!area) return;
    if (id === selectedAreaId) {
      clearSelection();
      return;
    }
    selectedAnchorRef.current = { lat: area.lat, lon: area.lon };
    setFocusedRegionLabel(null);
    setSelectedAreaId(id);
  };

  useEffect(() => {
    if (seededAreaRef.current || !areas.length) return;
    if (!summary && summaryLoading) return;
    if (selectedAreaId) {
      seededAreaRef.current = true;
      return;
    }

    const spotlightLabel = summary?.countrySpotlight?.label?.trim();
    const normalizedSpotlight = spotlightLabel?.toLowerCase();
    let seedArea =
      normalizedSpotlight
        ? areas.find(
            (area) =>
              area.label.toLowerCase() === normalizedSpotlight ||
              area.subtitle.toLowerCase() === normalizedSpotlight
          ) || null
        : null;

    if (!seedArea && spotlightLabel) {
      const coords = resolveCountryCoords(spotlightLabel);
      if (coords) {
        seedArea = findNearestAreaToPoint(areas, coords);
      }
    }

    if (!seedArea) {
      const stationSeed = player.current ?? favorites[0] ?? recent[0] ?? null;
      const coords = stationSeed ? resolveStationCoords(stationSeed) : null;
      if (coords) {
        seedArea = findNearestAreaToPoint(areas, coords);
      }
    }

    seedArea = seedArea ?? areas[0] ?? null;
    if (!seedArea) return;

    seededAreaRef.current = true;
    selectedAnchorRef.current = { lat: seedArea.lat, lon: seedArea.lon };
    setSelectedAreaId(seedArea.id);
  }, [
    areas,
    favorites,
    player.current,
    recent,
    selectedAreaId,
    summary,
    summaryLoading,
    summary?.countrySpotlight?.label
  ]);

  useEffect(() => {
    if (!selectedAreaId) return;
    if (areaById.has(selectedAreaId)) return;
    if (!selectedAnchorRef.current || !areas.length) {
      setSelectedAreaId(null);
      return;
    }
    const fallbackArea = findNearestAreaToPoint(areas, selectedAnchorRef.current);
    setSelectedAreaId(fallbackArea?.id || null);
  }, [areaById, areas, selectedAreaId]);

  const focusStations = selectedArea ? selectedStations : fallbackStations;
  const selectedLeadStation = selectedStations[0] || null;
  const selectedAreaTitle = focusedRegionLabel && selectedArea ? focusedRegionLabel : selectedArea?.label;
  const playRegionRadio = () => {
    if (!selectedStations.length || !selectedArea) return;
    playStationQueue(selectedStations, {
      sourceId: `globe-region-${selectedArea.id}`,
      sourceLabel: selectedAreaTitle || selectedArea.label
    });
  };

  const isSatelliteMode = zoomLevel >= 2.7;
  const breadcrumbLabel =
    isSatelliteMode && selectedArea ? selectedAreaTitle || selectedArea.label : null;

  return (
    <section
      className="screen screen-globe-v2 screen-globe-minimal"
      data-density={isCompactLayout ? 'dense' : 'regular'}
      data-zoom-level={zoomLevel.toFixed(2)}
      data-satellite={isSatelliteMode ? 'true' : 'false'}
    >
      <div className="glass-card globe-command-card">
        <div className="globe-command-top">
          <div className="section-title">{selectedArea ? selectedArea.label : t('explore.globeTitle')}</div>
          <div className="search-command-status" aria-live="polite">
            <span>{selectedArea ? t('globe.selectionCount') : t('globe.mappedAreas')}</span>
            <strong>{selectedArea ? selectedArea.count : areas.length}</strong>
          </div>
        </div>
        {breadcrumbLabel ? (
          <div className="globe-breadcrumb" aria-live="polite" data-globe-breadcrumb>
            <span className="globe-breadcrumb-glyph" aria-hidden="true">
              ◎
            </span>
            <strong className="globe-breadcrumb-label">{breadcrumbLabel}</strong>
            {selectedArea ? (
              <span className="globe-breadcrumb-meta">
                {t('globe.selectionCount')} <strong>{selectedArea.count}</strong>
              </span>
            ) : null}
            <button
              className="globe-breadcrumb-back"
              type="button"
              onClick={clearSelection}
              aria-label={t('globe.clearSelection')}
            >
              ✕
            </button>
          </div>
        ) : null}
        {areasError ? <div className="error">{areasError}</div> : null}
        <div className="globe-command-map">
          <Suspense fallback={<div className="globe globe-loading-surface" />}>
            <Globe
              points={globePoints}
              activeId={activeAreaId}
              selectedId={selectedAreaId || undefined}
              focusPoint={focusPoint ?? undefined}
              zoomLevel={zoomLevel}
              onZoomChange={setZoomLevel}
              onPick={handleSelectArea}
              tuneRequestKey={tuneRequestKey}
              spinRequestKey={spinRequestKey}
              onAutoRotateChange={setAutoRotateEnabled}
              hintText={
                isCompactLayout ? t('globe.controlsHintMobile') : t('globe.controlsHintDesktop')
              }
              immersive
              statusText={t('globe.status', {
                areas: areas.length,
                mapped: mappedStations,
                total: totalStations
              })}
            />
          </Suspense>
        </div>
        <div className="globe-zoom-controls" aria-label="Zoom">
          <button
            className="globe-zoom-btn"
            type="button"
            onClick={() => setZoomLevel((value) => Math.min(10, value + 0.75))}
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            className="globe-zoom-btn"
            type="button"
            onClick={() => setZoomLevel((value) => Math.max(0.5, value - 0.75))}
            aria-label="Zoom out"
          >
            -
          </button>
        </div>
        <div className="globe-command-footer" data-satellite={isSatelliteMode ? 'true' : 'false'}>
          <div
            className="chip-row globe-command-actions"
            data-has-selection={selectedArea ? 'true' : 'false'}
          >
            {!isSatelliteMode ? (
              <>
                <button
                  className="chip active globe-tune-chip"
                  type="button"
                  data-globe-tune
                  onClick={() => setTuneRequestKey((value) => value + 1)}
                >
                  {t('globe.tuneHere')}
                </button>
                <button
                  className={`chip ${autoRotateEnabled ? 'active' : ''}`}
                  type="button"
                  data-globe-spin
                  onClick={() => setSpinRequestKey((value) => value + 1)}
                >
                  {t('globe.toggleSpin')}
                </button>
              </>
            ) : null}
            {!isCompactLayout ? (
              <>
                <button className="chip" type="button" onClick={() => setActiveSection('search')}>
                  {t('home.openSearch')}
                </button>
                <button className="chip" type="button" onClick={openLibraryRegions}>
                  {t('home.openLibrary')}
                </button>
              </>
            ) : null}
            {selectedArea ? (
              <button
                className="chip"
                type="button"
                data-globe-clear
                onClick={clearSelection}
              >
                {t('globe.clearSelection')}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="glass-card globe-focus-card">
        <div className="search-results-head-minimal">
          <RegionArtwork
            region={
              selectedArea
                ? {
                    id: selectedArea.id,
                    label: selectedAreaTitle || selectedArea.label,
                    scope: focusedRegionLabel
                      ? 'country'
                      : selectedArea.subtitle === t('globe.areaSubtitle', { count: selectedArea.count })
                        ? 'area'
                        : 'country'
                  }
                : null
            }
            count={selectedArea?.count || areas.length}
            className="globe-focus-artwork"
          />
          <div>
            <div className="section-title">
              {selectedArea ? selectedAreaTitle || selectedArea.label : t('globe.nearby')}
            </div>
            <div className="globe-focus-copy">
              {selectedArea
                ? selectedArea.subtitle
                : areasLoading
                  ? t('common.loading')
                  : t('globe.idleCopy')}
            </div>
          </div>
          <div className="search-results-meta">
            <span>{selectedArea ? t('globe.selectionZoom') : t('globe.selectionCount')}</span>
            <strong>{selectedArea ? `${zoomLevel.toFixed(1)}x` : areas.length}</strong>
          </div>
        </div>

        {selectedArea ? (
          <>
            <div className="search-chip-row globe-selection-chip-row">
              <button
                className="search-mini-chip active"
                type="button"
                data-globe-play-region
                onClick={playRegionRadio}
                disabled={!selectedLeadStation}
              >
                <span className="search-mini-chip-label">{t('globe.playRegionRadio')}</span>
                <strong className="search-mini-chip-meta">
                  {selectedLeadStation?.name || selectedArea.subtitle}
                </strong>
              </button>
              <button
                className={`search-mini-chip ${isSelectedRegionFollowed ? 'active' : ''}`}
                type="button"
                onClick={() =>
                  toggleFollowRegion({
                    id: selectedArea.id,
                    label: selectedAreaTitle || selectedArea.label,
                    scope: focusedRegionLabel
                      ? 'country'
                      : selectedArea.subtitle === t('globe.areaSubtitle', { count: selectedArea.count })
                        ? 'area'
                        : 'country'
                  })
                }
              >
                <span className="search-mini-chip-label">
                  {isSelectedRegionFollowed ? t('globe.followingRegion') : t('globe.followRegion')}
                </span>
                <strong className="search-mini-chip-meta">{selectedArea.subtitle}</strong>
              </button>
            </div>
            {selectedAreaError ? <div className="error">{selectedAreaError}</div> : null}
            {isCompactLayout ? (
              <button
                className="station-row station-compact-toggle globe-dense-station-line"
                type="button"
                onClick={playRegionRadio}
                disabled={!selectedLeadStation}
                data-globe-dense-station
              >
                <span className="globe-dense-station-name">
                  {selectedLeadStation?.name || selectedArea.subtitle}
                </span>
                <span className="globe-dense-station-action">{t('common.play')}</span>
              </button>
            ) : selectedAreaLoading && !selectedStations.length ? (
              <div className="empty-state">{t('common.loading')}</div>
            ) : selectedStations.length ? (
              <StationTable
                stations={focusStations}
                compact
                sourceId="globe-area"
                nowPlayingMode="viewport"
              />
            ) : (
              <div className="empty-state">{t('stationTable.empty')}</div>
            )}
          </>
        ) : focusStations.length ? (
          <StationTable
            stations={focusStations}
            compact
            sourceId="globe-fallback-picks"
            nowPlayingMode="viewport"
          />
        ) : (
          <div className="empty-state">{t('globe.tapArea')}</div>
        )}
      </div>
    </section>
  );
};

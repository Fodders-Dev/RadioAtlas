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
import type { CatalogArea } from '../domain/contracts';
import type { StationLite } from '../types';
import './discover.css';

const PLACE_LIST_LIMIT = 40;
const Globe = lazy(() => import('../components/Globe').then((mod) => ({ default: mod.Globe })));

export const GlobeScreen = () => {
  const { t } = useLocale();
  const { summary, summaryLoading, fetchAreas, fetchAreaStations } = useCatalog();
  const { favorites, recent, followedRegions, toggleFollowRegion } = useLibrary();
  const { player, playStationQueue } = usePlayback();
  const { setActiveSection, setLibraryTab, globeFocusRegionId, setGlobeFocusRegionId } = useShell();
  const isCompactLayout = useCompactLayout();
  const [zoomLevel, setZoomLevel] = useState(1);
  const [areas, setAreas] = useState<CatalogArea[]>([]);
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
  const selectedAnchorRef = useRef<{ lat: number; lon: number } | null>(null);
  const seededAreaRef = useRef(false);
  const debouncedZoom = useDebounce(zoomLevel, 120);

  useEffect(() => {
    let cancelled = false;
    setAreasLoading(true);
    setAreasError(null);
    void (async () => {
      try {
        const response = await fetchAreas(debouncedZoom);
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
  }, [debouncedZoom, fetchAreas, t]);

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
  const globePoints = useMemo(
    () =>
      areas.map((area) => ({
        id: area.id,
        lat: area.lat,
        lon: area.lon,
        label: area.label,
        subtitle: area.subtitle,
        count: area.count
      })),
    [areas]
  );

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
    ? followedRegions.some((region) => region.id === selectedArea.id)
    : false;

  useEffect(() => {
    if (!globeFocusRegionId || !areas.length) return;
    const targetArea =
      areaById.get(globeFocusRegionId) ||
      areas.find(
        (area) =>
          area.id.toLowerCase() === globeFocusRegionId.toLowerCase() ||
          area.label.toLowerCase() === globeFocusRegionId.toLowerCase()
      ) ||
      null;
    if (!targetArea) return;
    seededAreaRef.current = true;
    selectedAnchorRef.current = { lat: targetArea.lat, lon: targetArea.lon };
    setSelectedAreaId(targetArea.id);
    setZoomLevel((value) => Math.max(value, 1));
    setGlobeFocusRegionId(null);
  }, [areaById, areas, globeFocusRegionId, setGlobeFocusRegionId]);

  const openLibraryRegions = () => {
    setLibraryTab('collections');
    setActiveSection('library');
  };

  const clearSelection = () => {
    selectedAnchorRef.current = null;
    setSelectedAreaId(null);
    setZoomLevel(1);
  };

  const handleSelectArea = (id: string) => {
    const area = areaById.get(id);
    if (!area) return;
    if (id === selectedAreaId) {
      clearSelection();
      return;
    }
    selectedAnchorRef.current = { lat: area.lat, lon: area.lon };
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
  const playRegionRadio = () => {
    if (!selectedStations.length || !selectedArea) return;
    playStationQueue(selectedStations, {
      sourceId: `globe-region-${selectedArea.id}`,
      sourceLabel: selectedArea.label
    });
  };

  return (
    <section
      className="screen screen-globe-v2 screen-globe-minimal"
      data-density={isCompactLayout ? 'dense' : 'regular'}
      data-zoom-level={zoomLevel.toFixed(2)}
    >
      <div className="glass-card globe-command-card">
        <div className="globe-command-top">
          <div className="section-title">{selectedArea ? selectedArea.label : t('explore.globeTitle')}</div>
          <div className="search-command-status" aria-live="polite">
            <span>{selectedArea ? t('globe.selectionCount') : t('globe.mappedAreas')}</span>
            <strong>{selectedArea ? selectedArea.count : areas.length}</strong>
          </div>
        </div>
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
              statusText={t('globe.status', {
                areas: areas.length,
                mapped: mappedStations,
                total: totalStations
              })}
            />
          </Suspense>
        </div>
        <div className="globe-command-footer">
          <div className="chip-row globe-command-actions">
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
                    label: selectedArea.label,
                    scope: selectedArea.subtitle === t('globe.areaSubtitle', { count: selectedArea.count }) ? 'area' : 'country'
                  }
                : null
            }
            count={selectedArea?.count || areas.length}
            className="globe-focus-artwork"
          />
          <div>
            <div className="section-title">
              {selectedArea ? selectedArea.label : t('globe.nearby')}
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
                    label: selectedArea.label,
                    scope:
                      selectedArea.subtitle === t('globe.areaSubtitle', { count: selectedArea.count })
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
            {selectedAreaLoading && !selectedStations.length ? (
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

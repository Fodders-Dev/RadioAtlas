import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { StationTable } from '../components/StationTable';
import { resolveStationCoords } from '../lib/geoResolver';
import { useDebounce } from '../lib/useDebounce';
import { useCatalog } from '../state/CatalogContext';
import { useLibrary, usePlayback, useShell } from '../state/RadioContext';
import { useLocale } from '../state/LocaleContext';
import type { CatalogArea } from '../domain/contracts';
import type { StationLite } from '../types';
import './discover.css';

const PLACE_LIST_LIMIT = 40;
const Globe = lazy(() => import('../components/Globe').then((mod) => ({ default: mod.Globe })));

const distanceSq = (left: { lat: number; lon: number }, right: { lat: number; lon: number }) => {
  const lat = left.lat - right.lat;
  const lon = left.lon - right.lon;
  return lat * lat + lon * lon;
};

export const GlobeScreen = () => {
  const { t } = useLocale();
  const { fetchAreas, fetchAreaStations } = useCatalog();
  const { favorites, recent, followedRegions, toggleFollowRegion } = useLibrary();
  const { player, playStation } = usePlayback();
  const { setActiveSection, setLibraryTab } = useShell();
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
  const selectedAnchorRef = useRef<{ lat: number; lon: number } | null>(null);
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

  const openLibraryRegions = () => {
    setLibraryTab('collections');
    setActiveSection('library');
  };

  const handleSelectArea = (id: string) => {
    const area = areaById.get(id);
    if (!area) return;
    selectedAnchorRef.current = { lat: area.lat, lon: area.lon };
    setSelectedAreaId(id);
    setZoomLevel((currentZoom) =>
      id === selectedAreaId
        ? Math.min(5.2, currentZoom + 0.95)
        : Math.max(2.35, Math.min(5.2, currentZoom + (currentZoom < 1.6 ? 1.45 : 0.8)))
    );
  };

  useEffect(() => {
    if (!selectedAreaId) return;
    if (areaById.has(selectedAreaId)) return;
    if (!selectedAnchorRef.current || !areas.length) {
      setSelectedAreaId(null);
      return;
    }
    const fallbackArea = areas.reduce((best, area) => {
      if (!best) return area;
      return distanceSq(area, selectedAnchorRef.current!) < distanceSq(best, selectedAnchorRef.current!)
        ? area
        : best;
    }, areas[0]);
    setSelectedAreaId(fallbackArea?.id || null);
  }, [areaById, areas, selectedAreaId]);

  const focusStations = selectedArea ? selectedStations : fallbackStations;
  const selectedLeadStation = selectedStations[0] || null;

  return (
    <section className="screen screen-globe-v2 screen-globe-minimal">
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
              hintText={t('globe.controlsHint')}
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
            <button className="chip" type="button" onClick={() => setActiveSection('search')}>
              {t('home.openSearch')}
            </button>
            <button className="chip" type="button" onClick={openLibraryRegions}>
              {t('home.openLibrary')}
            </button>
            {selectedArea ? (
              <button
                className="chip"
                type="button"
                onClick={() => {
                  selectedAnchorRef.current = null;
                  setSelectedAreaId(null);
                }}
              >
                {t('globe.clearSelection')}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="glass-card globe-focus-card">
        <div className="search-results-head-minimal">
          <div>
            <div className="section-title">
              {selectedArea ? selectedArea.label : t('globe.tapArea')}
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
                onClick={() =>
                  selectedLeadStation
                    ? playStation(selectedLeadStation, {
                        playlist: selectedStations,
                        sourceId: 'globe-area'
                      })
                    : undefined
                }
                disabled={!selectedLeadStation}
              >
                <span className="search-mini-chip-label">{t('common.play')}</span>
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

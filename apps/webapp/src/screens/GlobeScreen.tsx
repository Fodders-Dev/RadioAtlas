import { useEffect, useMemo, useRef, useState } from 'react';
import { Globe } from '../components/Globe';
import { createGlobeDiscoveryFeed } from '../lib/discoveryFeed';
import { StationTable } from '../components/StationTable';
import { resolveStationCoords } from '../lib/geoResolver';
import { toLite } from '../lib/stationUtils';
import type { StationLite } from '../types';
import { useLocale } from '../state/LocaleContext';
import { useRadio } from '../state/RadioContext';

type ResolvedStationPoint = {
  station: StationLite;
  lat: number;
  lon: number;
  country: string;
  state: string;
};

type GlobeArea = {
  id: string;
  lat: number;
  lon: number;
  label: string;
  subtitle: string;
  count: number;
  stations: StationLite[];
};

const PLACE_LIST_LIMIT = 40;
const GENERIC_STATE_KEYS = new Set([
  '',
  'unknown',
  'unknown location',
  'web',
  'the russian federation',
  'russia',
  'pangea'
]);

const normalizeText = (value?: string | null) =>
  value
    ?.trim()
    .replace(/\s+/g, ' ')
    .replace(/\(.*?\)/g, ' ')
    .trim() || '';

const normalizeKey = (value?: string | null) => normalizeText(value).toLowerCase();

const hasUsefulState = (state?: string | null, country?: string | null) => {
  const stateKey = normalizeKey(state);
  if (!stateKey || GENERIC_STATE_KEYS.has(stateKey)) return false;
  const countryKey = normalizeKey(country);
  return stateKey !== countryKey;
};

const bucketSizeForZoom = (zoomLevel: number) => {
  if (zoomLevel >= 5) return 1;
  if (zoomLevel >= 3.5) return 1.8;
  if (zoomLevel >= 2.4) return 3;
  if (zoomLevel >= 1.6) return 5;
  if (zoomLevel >= 1.1) return 8;
  return 13;
};

const bucketKeyForCoords = (lat: number, lon: number, bucketSize: number) => {
  const latBucket = Math.round((lat + 90) / bucketSize);
  const lonSpan = bucketSize / Math.max(0.42, Math.cos((Math.abs(lat) * Math.PI) / 180));
  const lonBucket = Math.round((lon + 180) / lonSpan);
  return `${bucketSize}:${latBucket}:${lonBucket}`;
};

const distanceSq = (left: { lat: number; lon: number }, right: { lat: number; lon: number }) => {
  const lat = left.lat - right.lat;
  const lon = left.lon - right.lon;
  return lat * lat + lon * lon;
};

export const GlobeScreen = () => {
  const { t } = useLocale();
  const {
    stations,
    player,
    favorites,
    recent,
    followedRegions,
    toggleFollowRegion,
    setActiveSection,
    setLibraryTab,
    playStation
  } = useRadio();
  const [zoomLevel, setZoomLevel] = useState(1);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const selectedAnchorRef = useRef<{ lat: number; lon: number } | null>(null);

  const favoriteIds = useMemo(
    () => new Set(favorites.map((station) => station.stationuuid)),
    [favorites]
  );

  const resolvedStations = useMemo(
    () =>
      stations
        .map((station) => {
          const coords = resolveStationCoords(station);
          if (!coords) return null;
          return {
            station: toLite(station),
            lat: coords.lat,
            lon: coords.lon,
            country: normalizeText(station.country) || t('explore.unknownLocation'),
            state: hasUsefulState(station.state, station.country) ? normalizeText(station.state) : ''
          };
        })
        .filter(Boolean) as ResolvedStationPoint[],
    [stations, t]
  );

  const areaBucketSize = useMemo(() => bucketSizeForZoom(zoomLevel), [zoomLevel]);

  const { globeAreas, areaById, stationAreaMap } = useMemo(() => {
    const groups = new Map<
      string,
      {
        latTotal: number;
        lonTotal: number;
        count: number;
        stations: StationLite[];
        countryCounts: Map<string, number>;
        stateCounts: Map<string, number>;
      }
    >();

    resolvedStations.forEach((entry) => {
      const key = bucketKeyForCoords(entry.lat, entry.lon, areaBucketSize);
      const current = groups.get(key) || {
        latTotal: 0,
        lonTotal: 0,
        count: 0,
        stations: [],
        countryCounts: new Map<string, number>(),
        stateCounts: new Map<string, number>()
      };

      current.latTotal += entry.lat;
      current.lonTotal += entry.lon;
      current.count += 1;
      current.stations.push(entry.station);
      current.countryCounts.set(entry.country, (current.countryCounts.get(entry.country) || 0) + 1);
      if (entry.state) {
        current.stateCounts.set(entry.state, (current.stateCounts.get(entry.state) || 0) + 1);
      }
      groups.set(key, current);
    });

    const currentStationId = player.current?.stationuuid;
    const sortStations = (left: StationLite, right: StationLite) => {
      const leftScore =
        (left.stationuuid === currentStationId ? 4 : 0) + (favoriteIds.has(left.stationuuid) ? 2 : 0);
      const rightScore =
        (right.stationuuid === currentStationId ? 4 : 0) +
        (favoriteIds.has(right.stationuuid) ? 2 : 0);
      if (leftScore !== rightScore) return rightScore - leftScore;
      return left.name.localeCompare(right.name);
    };

    const nextAreas = Array.from(groups.entries())
      .map(([id, group]) => {
        const countryEntries = Array.from(group.countryCounts.entries()).sort(
          (left, right) => right[1] - left[1]
        );
        const stateEntries = Array.from(group.stateCounts.entries()).sort(
          (left, right) => right[1] - left[1]
        );
        const country = countryEntries[0]?.[0] || t('explore.unknownLocation');
        const state = stateEntries[0]?.[0] || '';
        const stateShare = stateEntries[0] ? stateEntries[0][1] / group.count : 0;
        const sortedStations = [...group.stations].sort(sortStations);
        const label =
          state && stateShare >= 0.24 && normalizeKey(state) !== normalizeKey(country) ? state : country;
        const subtitle =
          label === state && normalizeKey(state) !== normalizeKey(country)
            ? country
            : t('globe.areaSubtitle', { count: group.count });
        return {
          id,
          lat: group.latTotal / group.count,
          lon: group.lonTotal / group.count,
          label,
          subtitle,
          count: group.count,
          stations: sortedStations
        } satisfies GlobeArea;
      })
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

    const nextAreaById = new Map(nextAreas.map((area) => [area.id, area]));
    const nextStationAreaMap = new Map<string, string>();
    nextAreas.forEach((area) => {
      area.stations.forEach((station) => nextStationAreaMap.set(station.stationuuid, area.id));
    });

    return {
      globeAreas: nextAreas,
      areaById: nextAreaById,
      stationAreaMap: nextStationAreaMap
    };
  }, [areaBucketSize, favoriteIds, player.current?.stationuuid, resolvedStations, t]);

  const selectedArea = selectedAreaId ? areaById.get(selectedAreaId) || null : null;
  const activeAreaId = player.current ? stationAreaMap.get(player.current.stationuuid) : undefined;

  const focusPoint = useMemo(() => {
    if (selectedArea) {
      return { lat: selectedArea.lat, lon: selectedArea.lon };
    }
    const current = player.current;
    if (!current) return null;
    const full = stations.find((station) => station.stationuuid === current.stationuuid) ?? current;
    return resolveStationCoords(full);
  }, [player.current, selectedArea, stations]);

  const contextualArea = selectedArea || (activeAreaId ? areaById.get(activeAreaId) || null : null);
  const contextualPreview = useMemo(
    () =>
      contextualArea?.stations
        .filter((station) => station.stationuuid !== player.current?.stationuuid)
        .slice(0, 5) || [],
    [contextualArea, player.current?.stationuuid]
  );
  const globeDiscovery = useMemo(
    () =>
      createGlobeDiscoveryFeed({
        areas: globeAreas,
        selectedAreaId,
        activeAreaId: activeAreaId || null,
        favorites,
        recent
      }),
    [activeAreaId, favorites, globeAreas, recent, selectedAreaId]
  );
  const isSelectedRegionFollowed = selectedArea
    ? followedRegions.some((region) => region.id === selectedArea.id)
    : false;
  const openLibraryRegions = () => {
    setLibraryTab('collections');
    setActiveSection('library');
  };
  const selectedLeadStation = selectedArea?.stations[0] || null;
  const focusStations = useMemo(() => {
    if (selectedArea) {
      return selectedArea.stations.slice(0, PLACE_LIST_LIMIT);
    }
    if (contextualPreview.length) {
      return contextualPreview;
    }
    return globeDiscovery.fallbackStations.slice(0, 5);
  }, [contextualPreview, globeDiscovery.fallbackStations, selectedArea]);

  useEffect(() => {
    if (!selectedAreaId) return;
    if (areaById.has(selectedAreaId)) return;
    if (!selectedAnchorRef.current || !globeAreas.length) {
      setSelectedAreaId(null);
      return;
    }
    const fallbackArea = globeAreas.reduce((best, area) => {
      if (!best) return area;
      return distanceSq(area, selectedAnchorRef.current!) < distanceSq(best, selectedAnchorRef.current!)
        ? area
        : best;
    }, globeAreas[0]);
    setSelectedAreaId(fallbackArea?.id || null);
  }, [areaById, globeAreas, selectedAreaId]);

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

  return (
    <section className="screen screen-globe-v2 screen-globe-minimal">
      <div className="glass-card globe-command-card">
        <div className="globe-command-top">
          <div className="section-title">{selectedArea ? selectedArea.label : t('explore.globeTitle')}</div>
          <div className="search-command-status" aria-live="polite">
            <span>{selectedArea ? t('globe.selectionCount') : t('globe.mappedAreas')}</span>
            <strong>{selectedArea ? selectedArea.count : globeAreas.length}</strong>
          </div>
        </div>
        <div className="globe-command-map">
          <Globe
            points={globeAreas.map((area) => ({
              id: area.id,
              lat: area.lat,
              lon: area.lon,
              label: area.label,
              subtitle: area.subtitle,
              count: area.count
            }))}
            activeId={activeAreaId}
            selectedId={selectedAreaId || undefined}
            focusPoint={focusPoint ?? undefined}
            zoomLevel={zoomLevel}
            onZoomChange={setZoomLevel}
            onPick={handleSelectArea}
            hintText={t('globe.controlsHint')}
            statusText={t('globe.status', {
              areas: globeAreas.length,
              mapped: resolvedStations.length,
              total: stations.length
            })}
          />
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
              {selectedArea
                ? selectedArea.label
                : contextualArea
                  ? contextualArea.label
                  : t('globe.tapArea')}
            </div>
            <div className="globe-focus-copy">
              {selectedArea
                ? selectedArea.subtitle
                : contextualArea
                  ? t('globe.contextualPicksCopy', { place: contextualArea.label })
                  : t('globe.idleCopy')}
            </div>
          </div>
          <div className="search-results-meta">
            <span>{selectedArea ? t('globe.selectionZoom') : t('globe.selectionCount')}</span>
            <strong>{selectedArea ? `${zoomLevel.toFixed(1)}x` : globeAreas.length}</strong>
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
                        playlist: selectedArea.stations,
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
            <StationTable stations={focusStations} compact sourceId="globe-area" />
          </>
        ) : (
          focusStations.length ? (
            <StationTable
              stations={focusStations}
              compact
              sourceId={contextualPreview.length ? 'globe-contextual-picks' : 'globe-fallback-picks'}
            />
          ) : (
            <div className="empty-state">{t('globe.tapArea')}</div>
          )
        )}
      </div>
    </section>
  );
};

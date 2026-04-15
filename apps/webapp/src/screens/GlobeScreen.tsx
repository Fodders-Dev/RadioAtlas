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

const pickDominantValue = (counts: Map<string, number>) =>
  Array.from(counts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] || '';

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
    playStation,
    playbackHistory
  } = useRadio();
  const [zoomLevel, setZoomLevel] = useState(1);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const picksRef = useRef<HTMLDivElement | null>(null);
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
        const topCountry = Array.from(group.countryCounts.entries()).sort(
          (left, right) => right[1] - left[1]
        )[0];
        const topState = Array.from(group.stateCounts.entries()).sort(
          (left, right) => right[1] - left[1]
        )[0];
        const country = topCountry?.[0] || t('explore.unknownLocation');
        const countryShare = topCountry ? topCountry[1] / group.count : 0;
        const state = topState?.[0] || '';
        const stateShare = topState ? topState[1] / group.count : 0;
        const isMixedArea = countryShare < 0.68;
        const sortedStations = [...group.stations].sort(sortStations);
        return {
          id,
          lat: group.latTotal / group.count,
          lon: group.lonTotal / group.count,
          label: isMixedArea ? t('globe.mixedArea') : state && stateShare >= 0.28 ? state : country,
          subtitle: !isMixedArea && state && normalizeKey(state) !== normalizeKey(country)
              ? country
              : t('globe.areaSubtitle', { count: group.count }),
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
  const activeArea = activeAreaId ? areaById.get(activeAreaId) || null : null;

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
  const recentMappedArea = useMemo(() => {
    const candidates = [player.current, ...recent, ...[...playbackHistory].reverse()];
    for (const station of candidates) {
      if (!station) continue;
      const areaId = stationAreaMap.get(station.stationuuid);
      if (!areaId) continue;
      const area = areaById.get(areaId);
      if (area) return area;
    }
    return null;
  }, [areaById, playbackHistory, player.current, recent, stationAreaMap]);
  const followedAreaRoutes = useMemo(
    () =>
      followedRegions
        .map((region) => areaById.get(region.id))
        .filter(Boolean) as GlobeArea[],
    [areaById, followedRegions]
  );
  const routeDeckAreas = useMemo(() => {
    const ordered = [selectedArea, activeArea, recentMappedArea, ...followedAreaRoutes, ...globeAreas]
      .filter(Boolean) as GlobeArea[];
    const seen = new Set<string>();
    return ordered.filter((area) => {
      if (seen.has(area.id)) return false;
      seen.add(area.id);
      return true;
    }).slice(0, 6);
  }, [activeArea, followedAreaRoutes, globeAreas, recentMappedArea, selectedArea]);
  const openLibraryRegions = () => {
    setLibraryTab('collections');
    setActiveSection('library');
  };

  useEffect(() => {
    if (!selectedArea) return;
    if (typeof window === 'undefined' || window.innerWidth > 860) return;
    const rect = picksRef.current?.getBoundingClientRect();
    if (!rect) return;
    const isOutsideViewport = rect.top < 72 || rect.bottom > window.innerHeight - 180;
    if (isOutsideViewport) {
      picksRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selectedArea]);

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
  };

  const handleSelectRoute = (id: string) => {
    handleSelectArea(id);
  };

  return (
    <section className="screen screen-globe-v2">
      <div className="glass-card globe-shell-card">
        <div className="globe-card-head">
          <div>
            <div className="shell-kicker">{t('globe.kicker')}</div>
            <div className="section-title">{t('explore.globeTitle')}</div>
            <div className="section-subtitle">{t('globe.heroSubtitle')}</div>
          </div>
          <div className="globe-chip">
            {selectedArea ? selectedArea.label : player.current ? t('explore.globeFocused') : t('globe.tapArea')}
          </div>
        </div>
        <Globe
          points={globeAreas.map((area) => ({
            id: area.id,
            lat: area.lat,
            lon: area.lon,
            label: area.label,
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
        <div className="globe-shell-deck">
          <div className="globe-metric-strip">
            <div className="search-shell-metric">
              <span>{t('globe.mappedAreas')}</span>
              <strong>{globeAreas.length}</strong>
            </div>
            <div className="search-shell-metric">
              <span>{t('globe.selectionCount')}</span>
              <strong>{resolvedStations.length}</strong>
            </div>
            <div className="search-shell-metric">
              <span>{t('library.followedRegionsTitle')}</span>
              <strong>{followedRegions.length}</strong>
            </div>
            <div className="search-shell-metric">
              <span>{t('globe.selectionZoom')}</span>
              <strong>{zoomLevel.toFixed(1)}x</strong>
            </div>
          </div>
          <div className="globe-shell-actions">
            {routeDeckAreas.map((area) => (
              <button
                key={`deck-${area.id}`}
                className={`globe-shell-route-chip ${selectedArea?.id === area.id ? 'active' : ''}`}
                type="button"
                onClick={() => handleSelectArea(area.id)}
              >
                <span>{area.label}</span>
                <strong>{area.count}</strong>
              </button>
            ))}
            <button className="chip" type="button" onClick={() => setActiveSection('search')}>
              {t('home.openSearch')}
            </button>
            <button className="chip" type="button" onClick={openLibraryRegions}>
              {t('home.openLibrary')}
            </button>
          </div>
        </div>
      </div>

      <div className="home-grid">
        <div className="home-main-stack">
          <div className="glass-card" ref={picksRef}>
            <div className="library-section-head">
              <div>
                <div className="section-title">
                  {selectedArea
                    ? t('globe.selectedTitle', {
                        place: selectedArea.label,
                        count: selectedArea.count
                      })
                    : t('globe.idleTitle')}
                </div>
                <div className="section-subtitle">
                  {selectedArea
                    ? t('globe.selectedCopy', { place: selectedArea.subtitle })
                    : t('globe.idleCopy')}
                </div>
              </div>
              {selectedArea && (
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
              )}
            </div>
            {selectedArea ? (
              <>
                <div className="globe-selection-meta">
                  <div className="globe-selection-pill">
                    <span>{t('globe.selectionArea')}</span>
                    <strong title={selectedArea.label}>{selectedArea.label}</strong>
                  </div>
                  <div className="globe-selection-pill">
                    <span>{t('globe.selectionCount')}</span>
                    <strong>{selectedArea.count}</strong>
                  </div>
                  <div className="globe-selection-pill">
                    <span>{t('globe.selectionZoom')}</span>
                    <strong>{zoomLevel.toFixed(1)}x</strong>
                  </div>
                </div>
                <div className="hero-chip-row">
                  <button
                    className="chip active"
                    type="button"
                    onClick={() =>
                      playStation(selectedArea.stations[0], {
                        playlist: selectedArea.stations,
                        sourceId: 'globe-area'
                      })
                    }
                  >
                    {t('common.play')}
                  </button>
                  <button
                    className={`chip ${isSelectedRegionFollowed ? 'active' : ''}`}
                    type="button"
                    onClick={() =>
                      toggleFollowRegion({
                        id: selectedArea.id,
                        label: selectedArea.label,
                        scope: selectedArea.subtitle === t('globe.areaSubtitle', { count: selectedArea.count }) ? 'area' : 'country'
                      })
                    }
                  >
                    {isSelectedRegionFollowed ? t('globe.followingRegion') : t('globe.followRegion')}
                  </button>
                  <button className="chip" type="button" onClick={() => setActiveSection('search')}>
                    {t('home.openSearch')}
                  </button>
                </div>
                <StationTable
                  stations={selectedArea.stations.slice(0, PLACE_LIST_LIMIT)}
                  compact
                  sourceId="globe-area"
                />
              </>
            ) : (
              <div className="globe-discovery-stack">
                <div className="globe-selection-meta">
                  <div className="globe-selection-pill">
                    <span>{t('globe.mappedAreas')}</span>
                    <strong>{globeAreas.length}</strong>
                  </div>
                  <div className="globe-selection-pill">
                    <span>{t('globe.selectionCount')}</span>
                    <strong>{resolvedStations.length}</strong>
                  </div>
                </div>
                <div className="section-subtitle">{t('globe.idleEmpty')}</div>
                <div className="globe-route-list">
                  {globeDiscovery.countryRoutes.slice(0, 4).map((route) => (
                    <button
                      key={`inline-${route.id}`}
                      className="globe-route-pill"
                      type="button"
                      onClick={() => handleSelectRoute(route.id)}
                    >
                      <span className="globe-route-pill-label" title={route.label}>
                        {route.label}
                      </span>
                      <strong>{t('globe.hotspotCount', { count: route.count })}</strong>
                    </button>
                  ))}
                </div>
                <div className="hero-chip-row">
                  <button className="chip active" type="button" onClick={() => setActiveSection('search')}>
                    {t('home.openSearch')}
                  </button>
                  <button className="chip" type="button" onClick={() => setActiveSection('home')}>
                    {t('nav.home')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <aside className="home-side-stack">
          <div className="glass-card globe-session-card">
            <div className="section-title">{t('home.resumeShelfTitle')}</div>
            <div className="section-subtitle">{t('home.resumeShelfCopy')}</div>
            {activeArea || recentMappedArea ? (
              <div className="globe-session-actions">
                {activeArea ? (
                  <button
                    className="globe-session-button active"
                    type="button"
                    onClick={() => handleSelectArea(activeArea.id)}
                  >
                    <span>{activeArea.label}</span>
                    <strong>{activeArea.subtitle}</strong>
                  </button>
                ) : null}
                {recentMappedArea && recentMappedArea.id !== activeArea?.id ? (
                  <button
                    className="globe-session-button"
                    type="button"
                    onClick={() => handleSelectArea(recentMappedArea.id)}
                  >
                    <span>{recentMappedArea.label}</span>
                    <strong>{recentMappedArea.subtitle}</strong>
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="library-empty-state">
                <div className="section-subtitle">{t('globe.idleEmpty')}</div>
              </div>
            )}
            <div className="hero-chip-row">
              <button className="chip" type="button" onClick={() => setActiveSection('search')}>
                {t('home.openSearch')}
              </button>
              <button className="chip" type="button" onClick={openLibraryRegions}>
                {t('home.openLibrary')}
              </button>
            </div>
          </div>

          {followedAreaRoutes.length ? (
            <div className="glass-card">
              <div className="section-title">{t('library.followedRegionsTitle')}</div>
              <div className="section-subtitle">{t('library.followedRegionsCopy')}</div>
              <div className="globe-route-list">
                {followedAreaRoutes.slice(0, 5).map((area) => (
                  <button
                    key={`followed-route-${area.id}`}
                    className={`globe-route-pill ${selectedArea?.id === area.id ? 'active' : ''}`}
                    type="button"
                    onClick={() => handleSelectArea(area.id)}
                  >
                    <span className="globe-route-pill-label" title={area.label}>
                      {area.label}
                    </span>
                    <strong title={area.subtitle}>{area.subtitle}</strong>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="glass-card globe-area-summary-card">
            <div className="section-title">{t('globe.hotAreasTitle')}</div>
            <div className="section-subtitle">{t('globe.hotAreasCopy')}</div>
            <div className="globe-hotspot-grid compact">
              {globeDiscovery.hotAreas.map((area) => (
                <button
                  key={area.id}
                  className={`globe-hotspot-btn ${selectedArea?.id === area.id ? 'active' : ''}`}
                  type="button"
                  onClick={() => handleSelectArea(area.id)}
                >
                  <span title={area.label}>{area.label}</span>
                  <strong>{t('globe.hotspotCount', { count: area.count })}</strong>
                </button>
              ))}
            </div>
          </div>

          <div className="glass-card">
            <div className="section-title">{t('globe.countryRoutesTitle')}</div>
            <div className="section-subtitle">{t('globe.countryRoutesCopy')}</div>
            <div className="globe-route-list">
              {globeDiscovery.countryRoutes.map((route) => (
                <button
                  key={route.id}
                  className={`globe-route-pill ${selectedArea?.id === route.id ? 'active' : ''}`}
                  type="button"
                  onClick={() => handleSelectRoute(route.id)}
                >
                  <span className="globe-route-pill-label" title={route.label}>
                    {route.label}
                  </span>
                  <strong title={route.subtitle}>{route.subtitle}</strong>
                </button>
              ))}
            </div>
            {followedRegions.length ? (
              <div className="hero-chip-row">
                {followedRegions.slice(0, 4).map((region) => (
                  <button
                    key={`followed-${region.id}`}
                    className="chip"
                    type="button"
                    onClick={() => handleSelectRoute(region.id)}
                  >
                    {region.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="glass-card">
            <div className="section-title">
              {contextualArea ? t('globe.contextualPicksTitle') : t('globe.liveQueue')}
            </div>
            <div className="section-subtitle">
              {contextualArea
                ? t('globe.contextualPicksCopy', { place: contextualArea.label })
                : t('globe.liveQueueEmpty')}
            </div>
            {contextualPreview.length ? (
              <StationTable stations={contextualPreview} compact sourceId="globe-contextual-picks" />
            ) : globeDiscovery.fallbackStations.length ? (
              <StationTable stations={globeDiscovery.fallbackStations} compact sourceId="globe-fallback-picks" />
            ) : (
              <div className="library-empty-state">
                <div className="section-subtitle">{t('globe.liveQueueEmpty')}</div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
};

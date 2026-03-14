import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Globe } from '../components/Globe';
import { StationTable } from '../components/StationTable';
import { useDebounce } from '../lib/useDebounce';
import { resolveStationCoords } from '../lib/geoResolver';
import { toLite } from '../lib/stationUtils';
import { useLocale } from '../state/LocaleContext';
import { useRadio } from '../state/RadioContext';

export const Explore = () => {
  const { stations, playStation, player, favorites, recent, queue } = useRadio();
  const { t } = useLocale();
  const [query, setQuery] = useState('');
  const [zoomLevel, setZoomLevel] = useState(1);
  const [pickList, setPickList] = useState<ReturnType<typeof toLite>[]>([]);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1024
  );
  const pickListRef = useRef<HTMLDivElement | null>(null);
  const debounced = useDebounce(query, 250);

  useEffect(() => {
    const handleResize = () => {
      setViewportWidth(window.innerWidth);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const hashCode = (value: string) => {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
    }
    return hash;
  };

  const globePoints = useMemo(() => {
    const mapped = stations
      .map((station) => {
        const coords = resolveStationCoords(station);
        if (!coords) return null;
        return {
          id: station.stationuuid,
          lat: coords.lat,
          lon: coords.lon,
          label: station.name,
          order: hashCode(station.stationuuid)
        };
      })
      .filter(Boolean) as Array<{
      id: string;
      lat: number;
      lon: number;
      label: string;
      order: number;
    }>;
    return mapped.sort((a, b) => a.order - b.order);
  }, [stations]);

  const visiblePoints = useMemo(() => {
    const isMobile = viewportWidth < 720;
    const cap = isMobile ? 5200 : 18000;
    const base = isMobile ? 1400 : 3600;
    const factor = isMobile ? 560 : 1100;
    const computed = Math.round(base + Math.pow(zoomLevel, 1.8) * factor);
    const maxPoints = Math.min(globePoints.length, Math.min(cap, computed));
    let slice = globePoints.slice(0, maxPoints);
    const activeId = player.current?.stationuuid;
    if (activeId && !slice.some((point) => point.id === activeId)) {
      const activePoint = globePoints.find((point) => point.id === activeId);
      if (activePoint) {
        slice = [activePoint, ...slice.slice(0, Math.max(0, maxPoints - 1))];
      }
    }
    return slice;
  }, [globePoints, zoomLevel, player.current?.stationuuid, viewportWidth]);

  const focusPoint = useMemo(() => {
    const current = player.current;
    if (!current) return null;
    const full = stations.find((station) => station.stationuuid === current.stationuuid) ?? current;
    return resolveStationCoords(full);
  }, [player.current?.stationuuid, stations]);

  const handlePickCandidates = useCallback(
    (ids: string[]) => {
      if (!ids.length) {
        setPickList([]);
        return;
      }
      const position = new Map(ids.map((id, index) => [id, index]));
      const next = stations
        .filter((station) => position.has(station.stationuuid))
        .sort((a, b) => {
          const orderA = position.get(a.stationuuid) ?? Number.MAX_SAFE_INTEGER;
          const orderB = position.get(b.stationuuid) ?? Number.MAX_SAFE_INTEGER;
          if (orderA !== orderB) return orderA - orderB;
          return a.name.localeCompare(b.name);
        })
        .map(toLite);
      setPickList(next);
    },
    [stations]
  );

  useEffect(() => {
    if (!pickList.length) return;
    pickListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [pickList]);

  const searchResults = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    if (!q) return [];
    return stations
      .filter((station) => station.name.toLowerCase().includes(q))
      .slice(0, 120)
      .map(toLite);
  }, [debounced, stations]);

  const trending = useMemo(() => stations.slice(0, 20).map(toLite), [stations]);
  const visibleCollection = query ? searchResults : trending;
  const listeningNow = useMemo(() => {
    const queued = queue.items.slice(0, 4);
    if (queued.length) return queued;
    if (recent.length) return recent.slice(0, 4);
    return trending.slice(0, 4);
  }, [queue.items, recent, trending]);
  const favoritePreview = useMemo(() => favorites.slice(0, 4), [favorites]);
  const recentPreview = useMemo(() => recent.slice(0, 4), [recent]);
  const leadStation = player.current ?? listeningNow[0] ?? null;
  const queueSourceLabel =
    queue.sourceLabel || (query ? t('explore.searchPicks') : t('explore.trendingPicks'));
  const liveStats = useMemo(
    () => [
      { label: t('explore.mapped'), value: globePoints.length.toLocaleString() },
      { label: t('explore.favorites'), value: favorites.length.toString() },
      { label: t('explore.queue'), value: queue.items.length.toString() }
    ],
    [favorites.length, globePoints.length, queue.items.length, t]
  );

  return (
    <section className="screen screen-explore">
      <div className="hero home-hero">
        <div className="hero-copy">
          <div className="home-kicker">{t('explore.kicker')}</div>
          <h1>{t('explore.title')}</h1>
          <p>{t('explore.subtitle')}</p>
          <div className="home-stat-row">
            {liveStats.map((item) => (
              <div key={item.label} className="home-stat-card">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </div>
        <div className="hero-pill">{t('explore.heroPill')}</div>
      </div>

      <div className="explore-layout">
        <div className="explore-main-column">
          <div className="globe-wrap globe-home-card">
            <div className="globe-card-head">
              <div>
                <div className="section-title">{t('explore.globeTitle')}</div>
                <div className="section-subtitle">{t('explore.globeSubtitle')}</div>
              </div>
              <div className="globe-chip">
                {player.current ? t('explore.globeFocused') : t('explore.globeTap')}
              </div>
            </div>
            <Globe
              points={visiblePoints}
              activeId={player.current?.stationuuid}
              focusPoint={focusPoint ?? undefined}
              totalCount={stations.length}
              geoCount={globePoints.length}
              zoomLevel={zoomLevel}
              onZoomChange={setZoomLevel}
              onPickCandidates={handlePickCandidates}
              onPick={(id) => {
                const picked = stations.find((station) => station.stationuuid === id);
                if (picked) {
                  playStation(picked, {
                    playlist: pickList.length ? pickList : visibleCollection,
                    sourceId: pickList.length
                      ? 'explore-pick'
                      : query
                        ? 'explore-search'
                        : 'explore-trending'
                  });
                  setPickList([]);
                }
              }}
            />
            <div className="globe-scroll-hint">
              {pickList.length
                ? t('explore.picksOpen', { count: pickList.length })
                : t('explore.picksHint')}
            </div>
          </div>

          <div className="home-module-grid">
            <div className="section explore-search-card home-search-card" data-home-section="search">
              <div className="section-title">{t('explore.quickSearchTitle')}</div>
              <div className="section-subtitle">{t('explore.quickSearchSubtitle')}</div>
              <div className="search-bar">
                <input
                  placeholder={t('explore.quickSearchPlaceholder')}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                {query && (
                  <button className="clear-btn" type="button" onClick={() => setQuery('')}>
                    {t('common.clear')}
                  </button>
                )}
              </div>
              <div className="home-search-meta">
                {query
                  ? t('explore.quickSearchMatches', { count: searchResults.length })
                  : t('explore.quickSearchIdle')}
              </div>
            </div>

            <div className="section home-feature-card" data-home-section="listening-now">
              <div className="section-title">{t('explore.resumeTitle')}</div>
              <div className="section-subtitle">
                {leadStation
                  ? t('explore.resumeReady', {
                      station: leadStation.name,
                      source: queueSourceLabel.toLowerCase()
                    })
                  : t('explore.resumeEmpty')}
              </div>
              <div className="home-action-row">
                <button
                  className="chip active"
                  type="button"
                  onClick={() => {
                    if (player.current) {
                      void player.toggle();
                      return;
                    }
                    if (leadStation) {
                      playStation(leadStation, {
                        playlist: listeningNow,
                        sourceId: queue.sourceId || 'explore-home'
                      });
                    }
                  }}
                  disabled={!leadStation}
                >
                  {player.current
                    ? player.isPlaying
                      ? t('common.pause')
                      : t('explore.resumeCurrent')
                    : t('explore.resumeStation')}
                </button>
                <button
                  className="chip"
                  type="button"
                  onClick={() => {
                    const next = listeningNow[1] ?? listeningNow[0];
                    if (next) {
                      playStation(next, {
                        playlist: listeningNow,
                        sourceId: queue.sourceId || 'explore-home'
                      });
                    }
                  }}
                  disabled={!listeningNow.length}
                >
                  {t('explore.nextPick')}
                </button>
              </div>
              <div className="home-mini-list">
                {listeningNow.length ? (
                  <StationTable
                    stations={listeningNow}
                    compact
                    sourceId={queue.sourceId || 'explore-home'}
                  />
                ) : (
                  <div className="empty-state">{t('explore.noQueue')}</div>
                )}
              </div>
            </div>
          </div>

          {pickList.length > 1 && (
            <div className="section nearby-picks-card" data-home-section="nearby" ref={pickListRef}>
              <div className="section-title">{t('explore.nearbyTitle', { count: pickList.length })}</div>
              <div className="section-subtitle">{t('explore.nearbySubtitle')}</div>
              <div className="pick-panel">
                {pickList.map((station) => (
                  <button
                    key={station.stationuuid}
                    className="pick-item"
                    type="button"
                    onClick={() => {
                      playStation(station, {
                        playlist: pickList,
                        sourceId: 'explore-pick'
                      });
                      setPickList([]);
                    }}
                  >
                    <div className="pick-name">{station.name}</div>
                    <div className="pick-meta">
                      {[station.state, station.country].filter(Boolean).join(', ') ||
                        t('explore.unknownLocation')}
                    </div>
                  </button>
                ))}
                <button className="pick-dismiss" type="button" onClick={() => setPickList([])}>
                  {t('explore.dismissNearby')}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="explore-side-column">
          <div className="section home-stack-card" data-home-section={query ? 'search-results' : 'trending'}>
            <div className="section-title">
              {query ? t('explore.resultTitle') : t('explore.trendingTitle')}
            </div>
            <div className="section-subtitle">
              {query
                ? t('explore.resultSubtitle')
                : t('explore.trendingSubtitle')}
            </div>
            <StationTable
              stations={query ? searchResults : trending}
              compact={!query}
              sourceId={query ? 'explore-search' : 'explore-trending'}
            />
          </div>

          <div className="section home-stack-card" data-home-section="favorites">
            <div className="section-title">{t('explore.favoritesTitle')}</div>
            <div className="section-subtitle">{t('explore.favoritesSubtitle')}</div>
            {favoritePreview.length ? (
              <StationTable stations={favoritePreview} compact sourceId="favorites" />
            ) : (
              <div className="empty-state">{t('explore.favoritesEmpty')}</div>
            )}
          </div>

          <div className="section home-stack-card" data-home-section="recent">
            <div className="section-title">{t('explore.recentTitle')}</div>
            <div className="section-subtitle">{t('explore.recentSubtitle')}</div>
            {recentPreview.length ? (
              <StationTable stations={recentPreview} compact sourceId="recent" />
            ) : (
              <div className="empty-state">{t('explore.recentEmpty')}</div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

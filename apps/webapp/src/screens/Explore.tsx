import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Globe } from '../components/Globe';
import { StationTable } from '../components/StationTable';
import { useDebounce } from '../lib/useDebounce';
import { useRadio } from '../state/RadioContext';
import { toLite } from '../lib/stationUtils';
import { resolveStationCoords } from '../lib/geoResolver';

export const Explore = () => {
  const { stations, playStation, player } = useRadio();
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
    const cap = isMobile ? 12000 : 30000;
    const base = isMobile ? 2200 : 6000;
    const factor = isMobile ? 900 : 1600;
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
    const full =
      stations.find((station) => station.stationuuid === current.stationuuid) ??
      current;
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

  return (
    <section className="screen">
      <div className="hero">
        <div>
          <h1>Explore the airwaves</h1>
          <p>Spin the globe and jump into a live stream from anywhere.</p>
        </div>
        <div className="hero-pill">Global live map</div>
      </div>

      <div className="section">
        <div className="section-title">Quick search</div>
        <div className="search-bar">
          <input
            placeholder="Search stations by name"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button className="clear-btn" type="button" onClick={() => setQuery('')}>
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="globe-wrap">
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
              playStation(picked);
              setPickList([]);
            }
          }}
        />
        <div className="globe-scroll-hint">
          {pickList.length
            ? `${pickList.length} stations near this point ↓`
            : 'Tap a glow point to tune in ↓'}
        </div>
      </div>

      {pickList.length > 1 && (
        <div className="section" ref={pickListRef}>
          <div className="section-title">Pick a station nearby ({pickList.length})</div>
          <div className="section-subtitle">
            Nearest matches are listed first. Choose one to start playback.
          </div>
          <div className="pick-panel">
            {pickList.map((station) => (
              <button
                key={station.stationuuid}
                className="pick-item"
                type="button"
                onClick={() => {
                  playStation(station);
                  setPickList([]);
                }}
              >
                <div className="pick-name">{station.name}</div>
                <div className="pick-meta">
                  {[station.state, station.country].filter(Boolean).join(', ') ||
                    'Unknown location'}
                </div>
              </button>
            ))}
            <button className="pick-dismiss" type="button" onClick={() => setPickList([])}>
              Close
            </button>
          </div>
        </div>
      )}

      {query ? (
        <div className="section">
          <div className="section-title">Search results</div>
          <StationTable stations={searchResults} />
        </div>
      ) : (
        <div className="section">
          <div className="section-title">Trending right now</div>
          <StationTable stations={trending} compact />
        </div>
      )}
    </section>
  );
};

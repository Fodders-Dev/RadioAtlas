import { geoBounds, geoCentroid } from 'd3-geo';
import { feature } from 'topojson-client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Globe } from '../components/Globe';
import { StationTable } from '../components/StationTable';
import { useDebounce } from '../lib/useDebounce';
import { useRadio } from '../state/RadioContext';
import { toLite } from '../lib/stationUtils';
import worldData from '../assets/countries-110m.json';

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

  const normalizeName = useCallback(
    (value: string) =>
      value
        .toLowerCase()
        .replace(/\(.*?\)/g, '')
        .replace(/[^a-z ]/g, ' ')
        .replace(/\bthe\b|\bof\b|\band\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    []
  );

  const [countryCenters, setCountryCenters] = useState(() => ({
    normalize: normalizeName,
    centers: new Map<string, [number, number]>(),
    bounds: new Map<string, [[number, number], [number, number]]>()
  }));

  useEffect(() => {
    const data = worldData as any;
    const features = feature(data, data.objects.countries).features as Array<{
      properties?: { name?: string };
    }>;
    const centers = new Map<string, [number, number]>();
    const bounds = new Map<string, [[number, number], [number, number]]>();

    features.forEach((item) => {
      const name = item.properties?.name;
      if (!name) return;
      const [lon, lat] = geoCentroid(item as any);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const key = normalizeName(name);
      centers.set(key, [lat, lon]);
      const boundsValue = geoBounds(item as any);
      if (boundsValue?.length === 2) {
        bounds.set(key, boundsValue as [[number, number], [number, number]]);
      }
    });

    setCountryCenters({
      normalize: normalizeName,
      centers,
      bounds
    });
  }, [normalizeName]);

  useEffect(() => {
    const handleResize = () => {
      setViewportWidth(window.innerWidth);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const aliases = useMemo(
    () => ({
      'russian federation': 'russia',
      'united states': 'united states america',
      'united states of america': 'united states america',
      usa: 'united states america',
      uk: 'united kingdom',
      'united kingdom great britain northern ireland': 'united kingdom',
      'korea republic of': 'south korea',
      'korea democratic peoples republic of': 'north korea',
      'iran islamic republic of': 'iran',
      'syrian arab republic': 'syria',
      'viet nam': 'vietnam',
      'tanzania united republic of': 'tanzania',
      'venezuela bolivarian republic of': 'venezuela',
      'bolivia plurinational state of': 'bolivia',
      'czechia': 'czech republic'
    }),
    []
  );

  const hashCode = (value: string) => {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
    }
    return hash;
  };

  const clampLat = (value: number) => Math.max(-85, Math.min(85, value));
  const clampLon = (value: number) => Math.max(-180, Math.min(180, value));

  const resolveCoords = useCallback((station: {
    stationuuid: string;
    geo_lat: number | null;
    geo_long: number | null;
    country?: string;
  }) => {
    if (station.geo_lat !== null && station.geo_long !== null) {
      return { lat: station.geo_lat, lon: station.geo_long };
    }
    const country = station.country?.trim();
    if (!country) return null;
    const normalized = countryCenters.normalize(country);
    const alias = aliases[normalized as keyof typeof aliases] || normalized;
    const bounds = countryCenters.bounds.get(alias);
    const seed = hashCode(station.stationuuid);
    const rand1 = (seed % 1000) / 1000;
    const rand2 = ((seed / 1000) % 1000) / 1000;
    if (bounds) {
      const [min, max] = bounds;
      const lonRange = max[0] - min[0];
      const latRange = max[1] - min[1];
      if (Number.isFinite(lonRange) && Number.isFinite(latRange)) {
        if (lonRange > 140 || latRange > 70) {
          const centroid = countryCenters.centers.get(alias);
          if (centroid) {
            return { lat: clampLat(centroid[0]), lon: clampLon(centroid[1]) };
          }
          return null;
        }
        const pad = 0.08;
        const lon = min[0] + lonRange * (pad + rand1 * (1 - pad * 2));
        const lat = min[1] + latRange * (pad + rand2 * (1 - pad * 2));
        return { lat: clampLat(lat), lon: clampLon(lon) };
      }
    }
    const centroid = countryCenters.centers.get(alias);
    if (!centroid) return null;
    return { lat: clampLat(centroid[0]), lon: clampLon(centroid[1]) };
  }, [aliases, countryCenters]);

  const globePoints = useMemo(() => {
    const mapped = stations
      .map((station) => {
        const coords = resolveCoords(station);
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
  }, [stations, resolveCoords]);

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
    return resolveCoords(full);
  }, [player.current?.stationuuid, stations, resolveCoords]);

  const handlePickCandidates = useCallback(
    (ids: string[]) => {
      if (!ids.length) {
        setPickList([]);
        return;
      }
      const next = ids
        .map((id) => stations.find((station) => station.stationuuid === id))
        .filter(Boolean)
        .map((station) => toLite(station!));
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
          {pickList.length ? 'Stations nearby ↓' : 'Scroll for stations ↓'}
        </div>
      </div>

      {pickList.length > 1 && (
        <div className="section" ref={pickListRef}>
          <div className="section-title">Pick a station nearby</div>
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

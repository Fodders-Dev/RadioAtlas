import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StationTable } from '../components/StationTable';
import { useRadio } from '../state/RadioContext';
import { toLite } from '../lib/stationUtils';
import type { Station } from '../types';
import { useInfiniteScroll } from '../lib/useInfiniteScroll';

const continentFor = (station: Station) => {
  const lat = station.geo_lat;
  const lon = station.geo_long;
  if (lat === null || lon === null) return 'Other';

  if (lat > 7 && lon < -30) return 'North America';
  if (lat < -10 && lon < -30) return 'South America';
  if (lat > 35 && lon > -25 && lon < 60) return 'Europe';
  if (lat >= -35 && lat <= 35 && lon >= -20 && lon <= 55) return 'Africa';
  if (lon >= 60 && lon <= 180 && lat >= -10) return 'Asia';
  if (lon >= 110 && lon <= 180 && lat < -10) return 'Oceania';
  return 'Other';
};

export const Browse = () => {
  const { stations } = useRadio();

  const groups = useMemo(() => {
    const result: Record<string, Record<string, Record<string, Station[]>>> = {};
    stations.forEach((station) => {
      const continent = continentFor(station);
      const country = station.country || 'Unknown';
      const region = station.state || 'Unknown';
      result[continent] ||= {};
      result[continent][country] ||= {};
      result[continent][country][region] ||= [];
      result[continent][country][region].push(station);
    });
    return result;
  }, [stations]);

  const continents = useMemo(() => Object.keys(groups).sort(), [groups]);
  const [activeContinent, setActiveContinent] = useState('Europe');
  const [activeCountry, setActiveCountry] = useState('');
  const [activeRegion, setActiveRegion] = useState('All');
  const [nameFilter, setNameFilter] = useState('');
  const [visibleCount, setVisibleCount] = useState(200);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (continents.length && !continents.includes(activeContinent)) {
      setActiveContinent(continents[0]);
    }
  }, [continents, activeContinent]);

  const countries = useMemo(() => {
    if (!groups[activeContinent]) return [];
    return Object.keys(groups[activeContinent]).sort();
  }, [groups, activeContinent]);

  useEffect(() => {
    if (countries.length && !countries.includes(activeCountry)) {
      setActiveCountry(countries[0]);
    }
  }, [countries, activeCountry]);

  const regions = useMemo(() => {
    const regionMap = groups[activeContinent]?.[activeCountry];
    if (!regionMap) return [];
    return ['All', ...Object.keys(regionMap).sort()];
  }, [groups, activeContinent, activeCountry]);

  useEffect(() => {
    if (!regions.length) return;
    if (!regions.includes(activeRegion)) {
      setActiveRegion(regions[0]);
    }
  }, [regions, activeRegion]);

  const stationsForCountry = useMemo(() => {
    const regionMap = groups[activeContinent]?.[activeCountry] ?? {};
    const list =
      activeRegion === 'All'
        ? Object.values(regionMap).flat()
        : regionMap[activeRegion] ?? [];
    const query = nameFilter.trim().toLowerCase();
    const filtered = query
      ? list.filter((station) => station.name.toLowerCase().includes(query))
      : list;
    return filtered;
  }, [groups, activeContinent, activeCountry, activeRegion, nameFilter]);

  useEffect(() => {
    setVisibleCount(200);
  }, [activeContinent, activeCountry, activeRegion, nameFilter]);

  const loadMore = useCallback(() => {
    setVisibleCount((prev) => Math.min(prev + 200, stationsForCountry.length));
  }, [stationsForCountry.length]);

  useInfiniteScroll(sentinelRef, {
    enabled: visibleCount < stationsForCountry.length,
    onLoadMore: loadMore
  });

  const visibleStations = useMemo(
    () => stationsForCountry.slice(0, visibleCount).map(toLite),
    [stationsForCountry, visibleCount]
  );

  return (
    <section className="screen">
      <div className="section">
        <div className="section-title">Browse</div>
        <div className="chip-row">
          {continents.map((continent) => (
            <button
              key={continent}
              className={`chip ${continent === activeContinent ? 'active' : ''}`}
              onClick={() => setActiveContinent(continent)}
              type="button"
            >
              {continent}
            </button>
          ))}
        </div>
      </div>

      <div className="section">
        <div className="section-subtitle">Countries</div>
        <div className="chip-row">
          {countries.map((country) => (
            <button
              key={country}
              className={`chip ${country === activeCountry ? 'active' : ''}`}
              onClick={() => setActiveCountry(country)}
              type="button"
            >
              {country}
            </button>
          ))}
        </div>
      </div>

      <div className="section">
        <div className="section-subtitle">Regions</div>
        <div className="chip-row">
          {regions.map((region) => (
            <button
              key={region}
              className={`chip ${region === activeRegion ? 'active' : ''}`}
              onClick={() => setActiveRegion(region)}
              type="button"
            >
              {region}
            </button>
          ))}
        </div>
      </div>

      <div className="section">
        <div className="section-subtitle">Filter by name</div>
        <div className="search-bar">
          <input
            placeholder="Station name"
            value={nameFilter}
            onChange={(event) => setNameFilter(event.target.value)}
          />
          {nameFilter && (
            <button
              className="clear-btn"
              type="button"
              onClick={() => setNameFilter('')}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <StationTable stations={visibleStations} />
      {visibleCount < stationsForCountry.length && (
        <div className="section">
          <button className="chip" type="button" onClick={loadMore}>
            Load more
          </button>
        </div>
      )}
      <div className="scroll-sentinel" ref={sentinelRef} />
    </section>
  );
};

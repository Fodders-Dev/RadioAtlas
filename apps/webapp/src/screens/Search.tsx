import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StationTable } from '../components/StationTable';
import { useDebounce } from '../lib/useDebounce';
import { useInfiniteScroll } from '../lib/useInfiniteScroll';
import { useRadio } from '../state/RadioContext';
import { toLite } from '../lib/stationUtils';

export const Search = () => {
  const { stations } = useRadio();
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(200);
  const [countryFilter, setCountryFilter] = useState('All');
  const [tagFilter, setTagFilter] = useState('All');
  const [languageFilter, setLanguageFilter] = useState('All');
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const debounced = useDebounce(query, 250);

  useEffect(() => {
    setVisibleCount(200);
  }, [stations.length, debounced, countryFilter, tagFilter, languageFilter]);

  const { countries, tags, languages } = useMemo(() => {
    const countryMap = new Map<string, number>();
    const tagMap = new Map<string, number>();
    const languageMap = new Map<string, number>();

    stations.forEach((station) => {
      const country = station.country?.trim();
      if (country) {
        countryMap.set(country, (countryMap.get(country) || 0) + 1);
      }
      const language = station.language?.trim();
      if (language) {
        languageMap.set(language, (languageMap.get(language) || 0) + 1);
      }
      const tagString = station.tags || '';
      tagString.split(',').forEach((tag) => {
        const clean = tag.trim().toLowerCase();
        if (!clean) return;
        tagMap.set(clean, (tagMap.get(clean) || 0) + 1);
      });
    });

    const top = (map: Map<string, number>, limit: number) =>
      Array.from(map.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([value]) => value);

    return {
      countries: ['All', ...top(countryMap, 60)],
      tags: ['All', ...top(tagMap, 80)],
      languages: ['All', ...top(languageMap, 40)]
    };
  }, [stations]);

  useEffect(() => {
    if (!countries.includes(countryFilter)) setCountryFilter('All');
  }, [countries, countryFilter]);

  useEffect(() => {
    if (!tags.includes(tagFilter)) setTagFilter('All');
  }, [tags, tagFilter]);

  useEffect(() => {
    if (!languages.includes(languageFilter)) setLanguageFilter('All');
  }, [languages, languageFilter]);

  const filtered = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    return stations
      .filter((station) => {
        const haystack = [
          station.name,
          station.tags,
          station.country,
          station.state,
          station.language
        ]
          .join(' ')
          .toLowerCase();
        if (q && !haystack.includes(q)) return false;
        if (countryFilter !== 'All' && station.country !== countryFilter) {
          return false;
        }
        if (languageFilter !== 'All' && station.language !== languageFilter) {
          return false;
        }
        if (tagFilter !== 'All') {
          const tagsLower = (station.tags || '').toLowerCase();
          if (!tagsLower.includes(tagFilter)) return false;
        }
        return true;
      });
  }, [debounced, stations, countryFilter, tagFilter, languageFilter]);

  const loadMore = useCallback(() => {
    setVisibleCount((prev) => Math.min(prev + 200, filtered.length));
  }, [filtered.length]);

  useInfiniteScroll(sentinelRef, {
    enabled: visibleCount < filtered.length,
    onLoadMore: loadMore
  });

  const results = useMemo(() => {
    const limit = Math.min(visibleCount, filtered.length);
    return filtered.slice(0, limit).map(toLite);
  }, [filtered, visibleCount]);

  return (
    <section className="screen">
      <div className="section">
        <div className="section-title">Search</div>
        <div className="section-subtitle">Full catalog with filters.</div>
        <div className="search-bar">
          <input
            placeholder="Search by name, tag, country, language"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button
              className="clear-btn"
              type="button"
              onClick={() => setQuery('')}
            >
              Clear
            </button>
          )}
        </div>
        <div className="filters">
          <select
            className="filter-select"
            value={countryFilter}
            onChange={(event) => setCountryFilter(event.target.value)}
          >
            {countries.map((country) => (
              <option key={country} value={country}>
                {country === 'All' ? 'All countries' : country}
              </option>
            ))}
          </select>
          <select
            className="filter-select"
            value={tagFilter}
            onChange={(event) => setTagFilter(event.target.value)}
          >
            {tags.map((tag) => (
              <option key={tag} value={tag}>
                {tag === 'All' ? 'All genres' : tag}
              </option>
            ))}
          </select>
          <select
            className="filter-select"
            value={languageFilter}
            onChange={(event) => setLanguageFilter(event.target.value)}
          >
            {languages.map((lang) => (
              <option key={lang} value={lang}>
                {lang === 'All' ? 'All languages' : lang}
              </option>
            ))}
          </select>
        </div>
        <div className="section-subtitle">
          {debounced.trim()
            ? `Results: ${filtered.length}`
            : `All stations: ${stations.length}`}
        </div>
      </div>
      <StationTable stations={results} />
      {visibleCount < filtered.length && (
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

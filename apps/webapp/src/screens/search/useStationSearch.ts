import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogCountryBucket } from '../../domain/contracts';
import { useDebounce } from '../../lib/useDebounce';
import { useInfiniteScroll } from '../../lib/useInfiniteScroll';
import type { ContinentId, StationLite } from '../../types';
import type {
  MergeStationsFn,
  SearchActiveFilter,
  SearchContinentCount,
  SearchContinentFilter,
  SearchStationsFn,
  TranslateFn
} from './types';

const CONTINENT_ORDER: Array<ContinentId | 'Other'> = [
  'Europe',
  'Asia',
  'North America',
  'South America',
  'Africa',
  'Oceania',
  'Antarctica',
  'Other'
];

type UseStationSearchOptions = {
  compactResults: boolean;
  mergeStations: MergeStationsFn;
  searchStations: SearchStationsFn;
  showStations: boolean;
  t: TranslateFn;
};

export const useStationSearch = ({
  compactResults,
  mergeStations,
  searchStations,
  showStations,
  t
}: UseStationSearchOptions) => {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [countryFilter, setCountryFilter] = useState('All');
  const [tagFilter, setTagFilter] = useState('All');
  const [languageFilter, setLanguageFilter] = useState('All');
  const [continentFilter, setContinentFilter] = useState<SearchContinentFilter>('All');
  const [countryQuery, setCountryQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchLoadingMore, setSearchLoadingMore] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<StationLite[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [countries, setCountries] = useState<string[]>(['All']);
  const [tags, setTags] = useState<string[]>(['All']);
  const [languages, setLanguages] = useState<string[]>(['All']);
  const [continentCounts, setContinentCounts] = useState<SearchContinentCount[]>([]);
  const [featuredCountries, setFeaturedCountries] = useState<CatalogCountryBucket[]>([]);

  const searchTokenRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const deferredQuery = useDeferredValue(query);
  const deferredCountryQuery = useDeferredValue(countryQuery);
  const debounced = useDebounce(deferredQuery, 250);
  const debouncedCountryQuery = useDebounce(deferredCountryQuery, 180);

  const runSearch = useCallback(
    async (cursor: string | null, append: boolean) => {
      const token = searchTokenRef.current + 1;
      searchTokenRef.current = token;
      if (append) {
        setSearchLoadingMore(true);
      } else {
        setSearchLoading(true);
        setSearchError(null);
      }

      try {
        const response = await searchStations({
          q: debounced,
          country: countryFilter !== 'All' ? countryFilter : undefined,
          tag: tagFilter !== 'All' ? tagFilter : undefined,
          language: languageFilter !== 'All' ? languageFilter : undefined,
          continent: continentFilter !== 'All' ? continentFilter : undefined,
          limit: compactResults ? 32 : 48,
          cursor
        });
        if (searchTokenRef.current !== token) return;
        setResults((prev) => (append ? mergeStations(prev, response.items) : response.items));
        setSearchTotal(response.total);
        setNextCursor(response.nextCursor);
        setCountries(['All', ...response.facets.countries]);
        setTags(['All', ...response.facets.tags]);
        setLanguages(['All', ...response.facets.languages]);
        setContinentCounts(
          CONTINENT_ORDER.map((id) => ({
            id,
            count: response.facets.continentCounts.find((item) => item.id === id)?.count || 0
          })).filter((item) => item.count > 0)
        );
        setFeaturedCountries(response.facets.featuredCountries);
        setSearchError(null);
      } catch (error) {
        if (searchTokenRef.current !== token) return;
        if (!append) {
          setResults([]);
          setSearchTotal(0);
          setNextCursor(null);
        }
        setSearchError(error instanceof Error ? error.message : t('discover.apiUnavailable'));
      } finally {
        if (searchTokenRef.current === token) {
          setSearchLoading(false);
          setSearchLoadingMore(false);
        }
      }
    },
    [
      compactResults,
      continentFilter,
      countryFilter,
      debounced,
      languageFilter,
      mergeStations,
      searchStations,
      t,
      tagFilter
    ]
  );

  useEffect(() => {
    if (!showStations) return;
    void runSearch(null, false);
  }, [runSearch, showStations]);

  useEffect(() => {
    if (!countries.includes(countryFilter)) setCountryFilter('All');
  }, [countries, countryFilter]);

  useEffect(() => {
    if (!tags.includes(tagFilter)) setTagFilter('All');
  }, [tags, tagFilter]);

  useEffect(() => {
    if (!languages.includes(languageFilter)) setLanguageFilter('All');
  }, [languages, languageFilter]);

  const loadMore = useCallback(() => {
    if (!nextCursor || searchLoading || searchLoadingMore) return;
    void runSearch(nextCursor, true);
  }, [nextCursor, runSearch, searchLoading, searchLoadingMore]);

  useInfiniteScroll(sentinelRef, {
    enabled: showStations && Boolean(nextCursor) && !searchLoadingMore,
    onLoadMore: loadMore
  });

  const visibleCountryBuckets = useMemo(() => {
    const q = debouncedCountryQuery.trim().toLowerCase();
    return featuredCountries
      .filter((bucket) => continentFilter === 'All' || bucket.continent === continentFilter)
      .filter((bucket) => (q ? bucket.country.toLowerCase().includes(q) : true));
  }, [continentFilter, debouncedCountryQuery, featuredCountries]);

  const featuredTags = useMemo(() => tags.filter((tag) => tag !== 'All').slice(0, 8), [tags]);

  const activeFilterCount =
    Number(Boolean(debounced.trim())) +
    Number(countryFilter !== 'All') +
    Number(tagFilter !== 'All') +
    Number(languageFilter !== 'All') +
    Number(continentFilter !== 'All');

  const activeFilters = useMemo(
    () =>
      [
        debounced.trim()
          ? {
              id: 'query',
              label: `"${debounced.trim()}"`,
              clear: () => setQuery('')
            }
          : null,
        countryFilter !== 'All'
          ? {
              id: 'country',
              label: countryFilter,
              clear: () => setCountryFilter('All')
            }
          : null,
        tagFilter !== 'All'
          ? {
              id: 'tag',
              label: tagFilter,
              clear: () => setTagFilter('All')
            }
          : null,
        languageFilter !== 'All'
          ? {
              id: 'language',
              label: languageFilter,
              clear: () => setLanguageFilter('All')
            }
          : null,
        continentFilter !== 'All'
          ? {
              id: 'continent',
              label: continentFilter,
              clear: () => setContinentFilter('All')
            }
          : null
      ].filter(Boolean) as SearchActiveFilter[],
    [continentFilter, countryFilter, debounced, languageFilter, tagFilter]
  );

  const resetSearchScope = useCallback(() => {
    setQuery('');
    setCountryQuery('');
    setCountryFilter('All');
    setTagFilter('All');
    setLanguageFilter('All');
    setContinentFilter('All');
  }, []);

  return {
    filtersOpen,
    setFiltersOpen,
    query,
    setQuery,
    countryFilter,
    setCountryFilter,
    tagFilter,
    setTagFilter,
    languageFilter,
    setLanguageFilter,
    continentFilter,
    setContinentFilter,
    countryQuery,
    setCountryQuery,
    searchLoading,
    searchLoadingMore,
    searchError,
    results,
    searchTotal,
    nextCursor,
    countries,
    tags,
    languages,
    continentCounts,
    featuredCountries,
    visibleCountryBuckets,
    featuredTags,
    activeFilterCount,
    activeFilters,
    sentinelRef,
    loadMore,
    resetSearchScope
  };
};

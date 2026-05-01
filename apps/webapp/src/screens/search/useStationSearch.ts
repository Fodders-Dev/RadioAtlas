import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogCountryBucket } from '../../domain/contracts';
import {
  hashAnalyticsValue,
  reportProductEvent
} from '../../lib/productAnalytics';
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

const SEARCH_HISTORY_KEY = 'radio:search-history:v1';
const MAX_SEARCH_HISTORY = 6;

const readSearchHistory = () => {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SEARCH_HISTORY_KEY) || '[]');
    return Array.isArray(parsed)
      ? parsed
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean)
          .slice(0, MAX_SEARCH_HISTORY)
      : [];
  } catch {
    return [];
  }
};

const writeSearchHistory = (items: string[]) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(items.slice(0, MAX_SEARCH_HISTORY)));
  } catch {
    // ignore storage failures
  }
};

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
  const [recentQueries, setRecentQueries] = useState<string[]>(readSearchHistory);

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
    if (!showStations) return;
    const normalized = debounced.trim();
    if (normalized.length < 2) return;
    const queryHash = hashAnalyticsValue(normalized.toLowerCase());
    reportProductEvent(
      'search_query',
      {
        queryHash,
        queryLength: normalized.length,
        tokenCount: normalized.split(/\s+/).filter(Boolean).length,
        countryFilter: countryFilter === 'All' ? null : countryFilter,
        tagFilter: tagFilter === 'All' ? null : tagFilter,
        languageFilter: languageFilter === 'All' ? null : languageFilter,
        continentFilter: continentFilter === 'All' ? null : continentFilter
      },
      {
        dedupeKey: `search_query:${queryHash}:${countryFilter}:${tagFilter}:${languageFilter}:${continentFilter}`,
        dedupeMs: 30_000
      }
    );
    const timeout = window.setTimeout(() => {
      setRecentQueries((previous) => {
        const next = [
          normalized,
          ...previous.filter((item) => item.toLowerCase() !== normalized.toLowerCase())
        ].slice(0, MAX_SEARCH_HISTORY);
        writeSearchHistory(next);
        return next;
      });
    }, 320);
    return () => window.clearTimeout(timeout);
  }, [continentFilter, countryFilter, debounced, languageFilter, showStations, tagFilter]);

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

  const applyRecentQuery = useCallback((value: string) => {
    setQuery(value);
    setFiltersOpen(false);
  }, []);

  const dismissRecentQuery = useCallback((value: string) => {
    setRecentQueries((previous) => {
      const next = previous.filter((item) => item !== value);
      writeSearchHistory(next);
      return next;
    });
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
    recentQueries,
    visibleCountryBuckets,
    featuredTags,
    activeFilterCount,
    activeFilters,
    sentinelRef,
    loadMore,
    resetSearchScope,
    applyRecentQuery,
    dismissRecentQuery
  };
};

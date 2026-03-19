import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StationTable } from '../components/StationTable';
import { useDebounce } from '../lib/useDebounce';
import { useInfiniteScroll } from '../lib/useInfiniteScroll';
import { useLocalStorage } from '../lib/useLocalStorage';
import { getApiBase } from '../lib/apiBase';
import { checkApiAvailability, markApiUnavailable } from '../lib/apiAvailability';
import { resolveContinent } from '../lib/geoResolver';
import { useLocale } from '../state/LocaleContext';
import { useRadio } from '../state/RadioContext';
import { toLite } from '../lib/stationUtils';
import type { ContinentId, CountryBucket, StationLite } from '../types';

type ExternalLink = {
  id: string;
  name: string;
  url: string;
  addedAt: number;
};

type ExtractAudioStream = {
  url: string;
  format?: string;
  mimeType?: string;
  bitrate?: number;
  averageBitrate?: number;
  delivery?: string;
};

type ExtractItem = {
  title?: string;
  url: string;
};

type ExtractResponse = {
  type: 'stream' | 'playlist';
  service?: string;
  url?: string;
  title?: string;
  uploader?: string;
  duration?: number;
  audioStreams?: ExtractAudioStream[];
  items?: ExtractItem[];
  error?: string;
};

const BLOCKED_HOSTS = [
  'youtube.com',
  'youtu.be',
  'music.youtube.com',
  'youtube-nocookie.com'
];

const CONTINENT_ORDER: ContinentId[] = [
  'Europe',
  'Asia',
  'North America',
  'South America',
  'Africa',
  'Oceania',
  'Antarctica',
  'Other'
];

const normalizeCountryKey = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();

const getHost = (value: string) => {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return '';
  }
};

const isBlocked = (value: string) => BLOCKED_HOSTS.some((host) => getHost(value).includes(host));
const isPlaylistUrl = (value: string) => /\.(m3u8?|pls)(\?|#|$)/i.test(value);
const isDirectAudioUrl = (value: string) => /\.(mp3|aac|m4a|ogg|opus|flac|wav|aiff?|mp2)(\?|#|$)/i.test(value);

const stripTrackingParams = (value: string) => {
  try {
    const url = new URL(value);
    const params = url.searchParams;
    Array.from(params.keys()).forEach((key) => {
      if (key.toLowerCase().startsWith('utm_')) {
        params.delete(key);
      }
    });
    url.search = params.toString();
    return url.toString();
  } catch {
    return value;
  }
};

const normalizeUrl = (value: string) => {
  try {
    return stripTrackingParams(new URL(value.trim()).toString());
  } catch {
    return '';
  }
};

const deriveName = (value: string) => {
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return 'External audio';
  }
};

const pickBestStream = (streams: ExtractAudioStream[]) => {
  if (!streams.length) return null;
  return streams
    .filter((stream) => Boolean(stream.url))
    .sort((a, b) => {
      const score = (item: ExtractAudioStream) => Math.max(item.averageBitrate || 0, item.bitrate || 0);
      return score(b) - score(a);
    })[0];
};

const toExternalStation = (item: ExternalLink): StationLite => ({
  stationuuid: `ext_${item.id}`,
  name: item.name,
  url_resolved: item.url,
  favicon: '',
  country: 'External',
  state: '',
  tags: 'external',
  geo_lat: null,
  geo_long: null
});

const parseM3u = (text: string, baseUrl: string) => {
  const items: { url: string; name?: string }[] = [];
  const lines = text.split(/\r?\n/);
  let pendingName: string | null = null;
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('#EXTINF')) {
      const parts = trimmed.split(',');
      if (parts.length > 1) {
        pendingName = parts.slice(1).join(',').trim();
      }
      return;
    }
    if (trimmed.startsWith('#')) return;
    try {
      const absolute = new URL(trimmed, baseUrl).toString();
      items.push({ url: absolute, name: pendingName || undefined });
    } catch {
      // ignore malformed lines
    } finally {
      pendingName = null;
    }
  });
  return items;
};

const parsePls = (text: string, baseUrl: string) => {
  const urls = new Map<number, string>();
  const titles = new Map<number, string>();
  text.split(/\r?\n/).forEach((line) => {
    const fileMatch = line.match(/^File(\d+)=(.+)$/i);
    const titleMatch = line.match(/^Title(\d+)=(.+)$/i);
    if (fileMatch) {
      const idx = Number(fileMatch[1]);
      try {
        urls.set(idx, new URL(fileMatch[2].trim(), baseUrl).toString());
      } catch {
        // ignore malformed urls
      }
    }
    if (titleMatch) {
      titles.set(Number(titleMatch[1]), titleMatch[2].trim());
    }
  });
  return Array.from(urls.entries()).map(([idx, url]) => ({ url, name: titles.get(idx) }));
};

export const Discover = () => {
  const { stations, playStation, player, recent } = useRadio();
  const { t } = useLocale();
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1024
  );
  const [mode, setMode] = useState<'stations' | 'links'>('stations');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(200);
  const [countryFilter, setCountryFilter] = useState('All');
  const [tagFilter, setTagFilter] = useState('All');
  const [languageFilter, setLanguageFilter] = useState('All');
  const [continentFilter, setContinentFilter] = useState<ContinentId | 'All'>('All');
  const [countryQuery, setCountryQuery] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkName, setLinkName] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [links, setLinks] = useLocalStorage<ExternalLink[]>('radio:links', []);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const debounced = useDebounce(query, 250);
  const debouncedCountryQuery = useDebounce(countryQuery, 180);
  const showStations = mode === 'stations';
  const apiBase = getApiBase();
  const [apiOnline, setApiOnline] = useState(true);

  const checkApiOnline = useCallback(async () => {
    if (!apiBase) {
      setApiOnline(false);
      return false;
    }
    const ok = await checkApiAvailability(apiBase, { timeoutMs: 1_000 });
    setApiOnline(ok);
    return ok;
  }, [apiBase]);

  useEffect(() => {
    if (linkError) {
      setLinkError(null);
    }
  }, [linkUrl, linkName, mode, linkError]);

  useEffect(() => {
    const handleResize = () => {
      setViewportWidth(window.innerWidth);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      const ok = await checkApiOnline();
      if (!active) return;
      setApiOnline(ok);
    };

    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 15_000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [checkApiOnline]);

  useEffect(() => {
    setVisibleCount(200);
  }, [stations.length, debounced, countryFilter, tagFilter, languageFilter, continentFilter]);

  const { countries, tags, languages, countryBuckets, continentCounts } = useMemo(() => {
    const countryMap = new Map<string, number>();
    const tagMap = new Map<string, number>();
    const languageMap = new Map<string, number>();
    const bucketMap = new Map<string, CountryBucket>();
    const continentMap = new Map<ContinentId, number>();

    stations.forEach((station) => {
      const country = station.country?.trim() || 'Unknown';
      const countryKey = normalizeCountryKey(country);
      const continent = resolveContinent(station.country);
      const lite = toLite(station);

      countryMap.set(country, (countryMap.get(country) || 0) + 1);
      continentMap.set(continent, (continentMap.get(continent) || 0) + 1);

      const existingBucket = bucketMap.get(countryKey);
      if (existingBucket) {
        existingBucket.count += 1;
        existingBucket.stations.push(lite);
      } else {
        bucketMap.set(countryKey, {
          key: countryKey,
          country,
          continent,
          count: 1,
          stations: [lite]
        });
      }

      const language = station.language?.trim();
      if (language) {
        languageMap.set(language, (languageMap.get(language) || 0) + 1);
      }

      (station.tags || '').split(',').forEach((tag) => {
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

    const orderedBuckets = Array.from(bucketMap.values())
      .map((bucket) => ({
        ...bucket,
        stations: bucket.stations.sort((left, right) => left.name.localeCompare(right.name))
      }))
      .sort((a, b) => {
        if (a.count !== b.count) return b.count - a.count;
        return a.country.localeCompare(b.country);
      });

    return {
      countries: ['All', ...top(countryMap, 80)],
      tags: ['All', ...top(tagMap, 80)],
      languages: ['All', ...top(languageMap, 40)],
      countryBuckets: orderedBuckets,
      continentCounts: CONTINENT_ORDER.map((continent) => ({
        id: continent,
        count: continentMap.get(continent) || 0
      })).filter((item) => item.count > 0)
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

  const visibleCountryBuckets = useMemo(() => {
    const q = debouncedCountryQuery.trim().toLowerCase();
    return countryBuckets
      .filter((bucket) => continentFilter === 'All' || bucket.continent === continentFilter)
      .filter((bucket) => (q ? bucket.country.toLowerCase().includes(q) : true));
  }, [continentFilter, countryBuckets, debouncedCountryQuery]);

  const featuredCountries = useMemo(() => visibleCountryBuckets.slice(0, 8), [visibleCountryBuckets]);
  const featuredTags = useMemo(() => tags.filter((tag) => tag !== 'All').slice(0, 8), [tags]);

  const filtered = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    return stations.filter((station) => {
      const haystack = [station.name, station.tags, station.country, station.state, station.language]
        .join(' ')
        .toLowerCase();
      if (q && !haystack.includes(q)) return false;
      if (countryFilter !== 'All' && station.country !== countryFilter) return false;
      if (languageFilter !== 'All' && station.language !== languageFilter) return false;
      if (continentFilter !== 'All' && resolveContinent(station.country) !== continentFilter) return false;
      if (tagFilter !== 'All' && !(station.tags || '').toLowerCase().includes(tagFilter)) return false;
      return true;
    });
  }, [debounced, stations, countryFilter, tagFilter, languageFilter, continentFilter]);

  const loadMore = useCallback(() => {
    setVisibleCount((prev) => Math.min(prev + 200, filtered.length));
  }, [filtered.length]);

  useInfiniteScroll(sentinelRef, {
    enabled: showStations && visibleCount < filtered.length,
    onLoadMore: loadMore
  });

  const results = useMemo(() => {
    const limit = Math.min(visibleCount, filtered.length);
    return filtered.slice(0, limit).map(toLite);
  }, [filtered, visibleCount]);
  const compactResults = viewportWidth < 720;

  const makeId = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const ensureApiAvailable = async () => {
    if (!apiBase) {
      setApiOnline(false);
      setLinkError(t('discover.apiUnavailable'));
      return false;
    }
    const ok = await checkApiOnline();
    if (!ok) {
      setLinkError(t('discover.apiUnavailable'));
    }
    return ok;
  };

  const addLinks = (items: ExternalLink[]) => {
    setLinks((prev) => {
      const existing = new Set(prev.map((item) => item.url));
      const seen = new Set<string>();
      const next = items.filter((item) => {
        if (seen.has(item.url)) return false;
        seen.add(item.url);
        return !existing.has(item.url);
      });
      return [...next, ...prev];
    });
  };

  const addSingleLink = () => {
    setLinkError(null);
    const normalized = normalizeUrl(linkUrl);
    if (!normalized) {
      setLinkError(t('discover.enterValidUrl'));
      return;
    }
    if (isBlocked(normalized)) {
      setLinkError(t('discover.youtubeBlocked'));
      return;
    }
    if (isPlaylistUrl(normalized)) {
      void importPlaylist(normalized);
      return;
    }
    if (!isDirectAudioUrl(normalized)) {
      if (!apiBase) {
        setLinkError(t('discover.extractorMissing'));
        return;
      }
      void extractLinkFor(normalized, linkName.trim());
      return;
    }
    const name = linkName.trim() || deriveName(normalized);
    addLinks([{ id: makeId(), name, url: normalized, addedAt: Date.now() }]);
    setLinkUrl('');
    setLinkName('');
  };

  const importPlaylist = async (source: string) => {
    setLinkError(null);
    const normalized = normalizeUrl(source);
    if (!normalized) {
      setLinkError(t('discover.enterPlaylistUrl'));
      return;
    }
    if (isBlocked(normalized)) {
      setLinkError(t('discover.youtubeBlocked'));
      return;
    }

    setLinkLoading(true);
    try {
      const fetchTargets: string[] = [normalized];
      const apiReady = apiBase ? await checkApiOnline() : false;
      if (apiReady) {
        fetchTargets.unshift(`${apiBase}/fetch?url=${encodeURIComponent(normalized)}`);
      }

      let response: Response | null = null;
      let lastStatus = 0;
      for (const fetchUrl of fetchTargets) {
        try {
          const next = await fetch(fetchUrl);
          if (!next.ok) {
            lastStatus = next.status;
            if (apiBase && fetchUrl.startsWith(`${apiBase}/`)) {
              setApiOnline(false);
            }
            continue;
          }
          response = next;
          break;
        } catch {
          if (apiBase && fetchUrl.startsWith(`${apiBase}/`)) {
            setApiOnline(false);
            markApiUnavailable(apiBase);
            continue;
          }
        }
      }

      if (!response) {
        if (apiBase && !apiReady) {
          throw new Error(t('discover.apiUnavailable'));
        }
        throw new Error(`Playlist fetch failed (${lastStatus || 0})`);
      }

      const text = await response.text();
      const lower = normalized.toLowerCase();
      const rawItems = lower.endsWith('.pls') || text.toLowerCase().includes('[playlist]')
        ? parsePls(text, normalized)
        : parseM3u(text, normalized);

      const cleanItems = rawItems
        .map((item) => ({ url: normalizeUrl(item.url), name: item.name }))
        .filter((item) => item.url && !isBlocked(item.url))
        .slice(0, 200);

      if (!cleanItems.length) {
        setLinkError(t('discover.noPlayableUrls'));
        return;
      }

      addLinks(
        cleanItems.map((item) => ({
          id: makeId(),
          name: item.name?.trim() || deriveName(item.url),
          url: item.url,
          addedAt: Date.now()
        }))
      );
      setLinkUrl('');
      setLinkName('');
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : t('common.importPlaylist'));
    } finally {
      setLinkLoading(false);
    }
  };

  const extractLinkFor = async (sourceUrl: string, nameOverride?: string) => {
    const normalized = normalizeUrl(sourceUrl);
    if (!apiBase) {
      setLinkError(t('discover.apiUnavailable'));
      return;
    }
    const canUseApi = await ensureApiAvailable();
    if (!canUseApi) return;
    setLinkLoading(true);
    try {
      const response = await fetch(`${apiBase}/extract?url=${encodeURIComponent(normalized)}`);
      const data = (await response.json()) as ExtractResponse;
      if (!response.ok || data?.type === 'error') {
        throw new Error(data?.error || `Extractor error (${response.status})`);
      }

      if (data.type === 'playlist') {
        const items = data.items?.filter((item) => item.url && !isBlocked(item.url)) || [];
        if (!items.length) {
          setLinkError(t('discover.noPlayableItems'));
          return;
        }
        addLinks(
          items.slice(0, 200).map((item) => ({
            id: makeId(),
            name: item.title?.trim() || deriveName(item.url),
            url: item.url,
            addedAt: Date.now()
          }))
        );
      } else {
        const best = pickBestStream(data.audioStreams || []);
        if (!best?.url) {
          setLinkError(t('discover.noPlayableStreams'));
          return;
        }
        const name = nameOverride?.trim() || data.title?.trim() || deriveName(normalized);
        addLinks([{ id: makeId(), name, url: best.url, addedAt: Date.now() }]);
      }

      setLinkUrl('');
      setLinkName('');
    } catch (err) {
      setApiOnline(false);
      markApiUnavailable(apiBase);
      setLinkError(err instanceof Error ? err.message : t('common.extractStreams'));
    } finally {
      setLinkLoading(false);
    }
  };

  const extractLink = async () => {
    setLinkError(null);
    const normalized = normalizeUrl(linkUrl);
    if (!normalized) {
      setLinkError(t('discover.enterValidUrl'));
      return;
    }
    if (isBlocked(normalized)) {
      setLinkError(t('discover.youtubeBlocked'));
      return;
    }
    if (!apiBase) {
      setLinkError(t('discover.extractorNotConfigured'));
      return;
    }
    await extractLinkFor(normalized, linkName.trim());
  };

  const handlePaste = async () => {
    setLinkError(null);
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setLinkUrl(text.trim());
      }
    } catch {
      setLinkError(t('discover.clipboardDenied'));
    }
  };

  const handleRemove = (id: string) => {
    setLinks((prev) => prev.filter((item) => item.id !== id));
  };

  const linkRecent = useMemo(() => recent.filter((item) => item.stationuuid.startsWith('ext_')), [recent]);

  return (
    <section className="screen screen-search screen-search-v2">
      <div className="glass-card search-shell-header">
        <div className="chip-row">
          <button
            className={`chip ${showStations ? 'active' : ''}`}
            type="button"
            onClick={() => setMode('stations')}
          >
            {t('discover.stationsMode')}
          </button>
          <button
            className={`chip ${showStations ? '' : 'active'}`}
            type="button"
            onClick={() => setMode('links')}
          >
            {t('discover.linksMode')}
          </button>
        </div>
      </div>

      {showStations ? (
        <>
          <div className="glass-card search-primary-card">
            <div className="search-bar">
              <input
                placeholder={t('discover.searchPlaceholder')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <button className="clear-btn" type="button" onClick={() => setQuery('')}>
                  {t('common.clear')}
                </button>
              )}
            </div>
            <div className="search-toolbar-row">
              <button
                className={`chip ${filtersOpen ? 'active' : ''}`}
                type="button"
                onClick={() => setFiltersOpen((prev) => !prev)}
              >
                {filtersOpen ? t('search.hideFilters') : t('search.showFilters')}
              </button>
              <div className="section-subtitle">
              {debounced.trim()
                ? t('discover.matches', { count: filtered.length })
                : t('discover.allStations', { count: stations.length })}
              </div>
            </div>

            {filtersOpen ? (
              <div className="search-filters-drawer">
                <div className="filters">
                  <select
                    className="filter-select"
                    value={countryFilter}
                    onChange={(event) => setCountryFilter(event.target.value)}
                  >
                    <option value="All">{t('discover.regionAll')}</option>
                    {countries.filter((country) => country !== 'All').map((country) => (
                      <option key={country} value={country}>
                        {country}
                      </option>
                    ))}
                  </select>
                  <select
                    className="filter-select"
                    value={tagFilter}
                    onChange={(event) => setTagFilter(event.target.value)}
                  >
                    <option value="All">{t('discover.tagTitle')}</option>
                    {tags.filter((tag) => tag !== 'All').map((tag) => (
                      <option key={tag} value={tag}>
                        {tag}
                      </option>
                    ))}
                  </select>
                  <select
                    className="filter-select"
                    value={languageFilter}
                    onChange={(event) => setLanguageFilter(event.target.value)}
                  >
                    <option value="All">{t('discover.regionAll')}</option>
                    {languages.filter((lang) => lang !== 'All').map((lang) => (
                      <option key={lang} value={lang}>
                        {lang}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="chip-row search-filter-chip-row">
                  <button
                    className={`chip ${continentFilter === 'All' ? 'active' : ''}`}
                    type="button"
                    onClick={() => setContinentFilter('All')}
                  >
                    {t('discover.regionAll')}
                  </button>
                  {continentCounts.map((item) => (
                    <button
                      key={item.id}
                      className={`chip ${continentFilter === item.id ? 'active' : ''}`}
                      type="button"
                      onClick={() => setContinentFilter(item.id)}
                    >
                      {item.id} · {item.count}
                    </button>
                  ))}
                </div>
                <div className="chip-row search-filter-chip-row">
                  {featuredTags.map((tag) => (
                    <button
                      key={tag}
                      className={`chip ${tagFilter === tag ? 'active' : ''}`}
                      type="button"
                      onClick={() => setTagFilter(tagFilter === tag ? 'All' : tag)}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
                <div className="search-bar discover-country-search">
                  <input
                    placeholder={t('discover.countrySearchPlaceholder')}
                    value={countryQuery}
                    onChange={(event) => setCountryQuery(event.target.value)}
                  />
                  {countryQuery && (
                    <button className="clear-btn" type="button" onClick={() => setCountryQuery('')}>
                      {t('common.clear')}
                    </button>
                  )}
                </div>
                {featuredCountries.length ? (
                  <div className="browse-list discover-country-list search-country-grid">
                    {featuredCountries.map((bucket) => (
                      <button
                        key={bucket.key}
                        className="browse-list-item"
                        type="button"
                        onClick={() => setCountryFilter(bucket.country)}
                      >
                        <div className="browse-title">{bucket.country}</div>
                        <div className="browse-meta">{bucket.count}</div>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="search-results-shell">
            <StationTable stations={results} sourceId="discover-stations" compact={compactResults} />
          </div>
          {visibleCount < filtered.length && (
            <div className="section">
              <button className="chip" type="button" onClick={loadMore}>
                {t('discover.loadMore')}
              </button>
            </div>
          )}
          <div className="scroll-sentinel" ref={sentinelRef} />
        </>
      ) : (
        <>
          <div className="glass-card home-search-card">
            <div className="section-title">{t('discover.linksTitle')}</div>
            <div className="section-subtitle">{t('discover.linksSubtitle')}</div>
            <div className="settings-card stack">
              <input
                className="settings-input"
                placeholder={t('discover.audioPlaceholder')}
                value={linkUrl}
                onChange={(event) => setLinkUrl(event.target.value)}
              />
              <input
                className="settings-input"
                placeholder={t('discover.titlePlaceholder')}
                value={linkName}
                onChange={(event) => setLinkName(event.target.value)}
              />
              <div className="settings-actions">
                <button className="chip" type="button" onClick={handlePaste}>
                  {t('common.paste')}
                </button>
                <button className="chip" type="button" onClick={addSingleLink}>
                  {t('common.addLink')}
                </button>
                <button
                  className="chip"
                  type="button"
                  onClick={extractLink}
                  disabled={linkLoading || !apiBase || !apiOnline}
                >
                  {t('common.extractStreams')}
                </button>
                <button
                  className="chip"
                  type="button"
                  onClick={() => importPlaylist(linkUrl)}
                  disabled={linkLoading}
                >
                  {linkLoading ? t('common.importing') : t('common.importPlaylist')}
                </button>
              </div>
            </div>
            {(!apiBase || !apiOnline) && <div className="error">{t('discover.extractorOffline')}</div>}
            {linkError && <div className="error">{linkError}</div>}
          </div>

          <div className="glass-card home-stack-card">
            <div className="section-title">{t('discover.linksSaved')}</div>
            {links.length ? (
              <div className="track-list">
                {links.map((link) => {
                  const station = toExternalStation(link);
                  const active = player.current?.stationuuid === station.stationuuid;
                  const isLong = link.name.length > 28;
                  return (
                    <div className="track-card" key={link.id}>
                      <div>
                        <div className={`station-title ${isLong ? 'marquee' : ''}`}>
                          <span className="marquee-text">{link.name}</span>
                        </div>
                        <div className="track-meta">{link.url}</div>
                      </div>
                      <div className="settings-actions">
                        <button
                          className="play-btn"
                          type="button"
                          onClick={() =>
                            active
                              ? player.toggle()
                              : playStation(station, {
                                  playlist: links.map(toExternalStation),
                                  sourceId: 'discover-links'
                                })
                          }
                          aria-label={t('discover.playLink')}
                        >
                          {active && player.isPlaying ? t('common.pause') : t('common.play')}
                        </button>
                        <button
                          className="link-btn"
                          type="button"
                          onClick={() => handleRemove(link.id)}
                          aria-label={t('common.remove')}
                        >
                          {t('common.remove')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state">{t('discover.linksEmpty')}</div>
            )}
          </div>

          <div className="glass-card home-stack-card">
            <div className="section-title">{t('discover.linksRecent')}</div>
            {linkRecent.length ? (
              <StationTable stations={linkRecent} compact sourceId="discover-links-recent" />
            ) : (
              <div className="empty-state">{t('discover.linksRecentEmpty')}</div>
            )}
          </div>
        </>
      )}
    </section>
  );
};

export const Search = Discover;

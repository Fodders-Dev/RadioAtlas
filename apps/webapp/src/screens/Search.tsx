import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StationTable } from '../components/StationTable';
import { useDebounce } from '../lib/useDebounce';
import { useInfiniteScroll } from '../lib/useInfiniteScroll';
import { useLocalStorage } from '../lib/useLocalStorage';
import { getApiBase } from '../lib/apiBase';
import { useRadio } from '../state/RadioContext';
import { toLite } from '../lib/stationUtils';
import type { StationLite } from '../types';

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

const getHost = (value: string) => {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return '';
  }
};

const isBlocked = (value: string) =>
  BLOCKED_HOSTS.some((host) => getHost(value).includes(host));

const isPlaylistUrl = (value: string) =>
  /\.(m3u8?|pls)(\?|#|$)/i.test(value);

const normalizeUrl = (value: string) => {
  try {
    return new URL(value.trim()).toString();
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
      const score = (item: ExtractAudioStream) =>
        Math.max(item.averageBitrate || 0, item.bitrate || 0);
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
  return Array.from(urls.entries()).map(([idx, url]) => ({
    url,
    name: titles.get(idx)
  }));
};

export const Search = () => {
  const { stations, playStation, player, recent } = useRadio();
  const [mode, setMode] = useState<'stations' | 'links'>('stations');
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(200);
  const [countryFilter, setCountryFilter] = useState('All');
  const [tagFilter, setTagFilter] = useState('All');
  const [languageFilter, setLanguageFilter] = useState('All');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkName, setLinkName] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [links, setLinks] = useLocalStorage<ExternalLink[]>(
    'radio:links',
    []
  );
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const debounced = useDebounce(query, 250);
  const showStations = mode === 'stations';
  const apiBase = getApiBase();

  useEffect(() => {
    if (linkError) {
      setLinkError(null);
    }
  }, [linkUrl, linkName, mode, linkError]);

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
    enabled: showStations && visibleCount < filtered.length,
    onLoadMore: loadMore
  });

  const results = useMemo(() => {
    const limit = Math.min(visibleCount, filtered.length);
    return filtered.slice(0, limit).map(toLite);
  }, [filtered, visibleCount]);

  const makeId = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

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
      setLinkError('Enter a valid URL');
      return;
    }
    if (isBlocked(normalized)) {
      setLinkError('YouTube links are blocked in this mode');
      return;
    }
    if (isPlaylistUrl(normalized)) {
      void importPlaylist(normalized);
      return;
    }
    const name = linkName.trim() || deriveName(normalized);
    addLinks([
      { id: makeId(), name, url: normalized, addedAt: Date.now() }
    ]);
    setLinkUrl('');
    setLinkName('');
  };

  const importPlaylist = async (source: string) => {
    setLinkError(null);
    const normalized = normalizeUrl(source);
    if (!normalized) {
      setLinkError('Enter a valid playlist URL');
      return;
    }
    if (isBlocked(normalized)) {
      setLinkError('YouTube links are blocked in this mode');
      return;
    }

    setLinkLoading(true);
    try {
      const fetchUrl = apiBase
        ? `${apiBase}/fetch?url=${encodeURIComponent(normalized)}`
        : normalized;
      const response = await fetch(fetchUrl);
      if (!response.ok) {
        throw new Error(`Playlist fetch failed (${response.status})`);
      }
      const text = await response.text();
      const lower = normalized.toLowerCase();
      const rawItems = lower.endsWith('.pls') || text.toLowerCase().includes('[playlist]')
        ? parsePls(text, normalized)
        : parseM3u(text, normalized);

      const cleanItems = rawItems
        .map((item) => ({
          url: normalizeUrl(item.url),
          name: item.name
        }))
        .filter((item) => item.url && !isBlocked(item.url))
        .slice(0, 200);

      if (!cleanItems.length) {
        setLinkError('No playable URLs found in the playlist');
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
      setLinkError(err instanceof Error ? err.message : 'Playlist import failed');
    } finally {
      setLinkLoading(false);
    }
  };

  const extractLink = async () => {
    setLinkError(null);
    const normalized = normalizeUrl(linkUrl);
    if (!normalized) {
      setLinkError('Enter a valid URL');
      return;
    }
    if (isBlocked(normalized)) {
      setLinkError('YouTube links are blocked in this mode');
      return;
    }
    if (!apiBase) {
      setLinkError('Extractor API not configured');
      return;
    }

    setLinkLoading(true);
    try {
      const response = await fetch(
        `${apiBase}/extract?url=${encodeURIComponent(normalized)}`
      );
      const data = (await response.json()) as ExtractResponse;
      if (!response.ok) {
        throw new Error(data?.error || `Extractor error (${response.status})`);
      }

      if (data.type === 'playlist') {
        const items =
          data.items?.filter((item) => item.url && !isBlocked(item.url)) || [];
        if (!items.length) {
          setLinkError('No playable items found');
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
          setLinkError('No playable audio streams found');
          return;
        }
        const name =
          linkName.trim() || data.title?.trim() || deriveName(normalized);
        addLinks([
          { id: makeId(), name, url: best.url, addedAt: Date.now() }
        ]);
      }

      setLinkUrl('');
      setLinkName('');
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Extraction failed');
    } finally {
      setLinkLoading(false);
    }
  };

  const handlePaste = async () => {
    setLinkError(null);
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setLinkUrl(text.trim());
      }
    } catch {
      setLinkError('Clipboard access denied');
    }
  };

  const handleRemove = (id: string) => {
    setLinks((prev) => prev.filter((item) => item.id !== id));
  };

  const linkRecent = useMemo(
    () => recent.filter((item) => item.stationuuid.startsWith('ext_')),
    [recent]
  );

  return (
    <section className="screen">
      <div className="section">
        <div className="section-title">Search</div>
        <div className="section-subtitle">
          {showStations
            ? 'Full catalog with filters.'
            : 'Save direct audio links or playlists. YouTube is blocked.'}
        </div>
        <div className="chip-row">
          <button
            className={`chip ${showStations ? 'active' : ''}`}
            type="button"
            onClick={() => setMode('stations')}
          >
            Stations
          </button>
          <button
            className={`chip ${showStations ? '' : 'active'}`}
            type="button"
            onClick={() => setMode('links')}
          >
            Links
          </button>
        </div>
      </div>

      {showStations ? (
        <>
          <div className="section">
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
        </>
      ) : (
        <>
          <div className="section">
            <div className="settings-card stack">
              <input
                className="settings-input"
                placeholder="Audio URL or playlist (.m3u/.pls)"
                value={linkUrl}
                onChange={(event) => setLinkUrl(event.target.value)}
              />
              <input
                className="settings-input"
                placeholder="Optional title"
                value={linkName}
                onChange={(event) => setLinkName(event.target.value)}
              />
              <div className="settings-actions">
                <button className="chip" type="button" onClick={handlePaste}>
                  Paste
                </button>
                <button className="chip" type="button" onClick={addSingleLink}>
                  Add link
                </button>
                <button
                  className="chip"
                  type="button"
                  onClick={extractLink}
                  disabled={linkLoading}
                >
                  Extract streams
                </button>
                <button
                  className="chip"
                  type="button"
                  onClick={() => importPlaylist(linkUrl)}
                  disabled={linkLoading}
                >
                  {linkLoading ? 'Importing...' : 'Import playlist'}
                </button>
              </div>
            </div>
            {linkError && <div className="error">{linkError}</div>}
          </div>

          <div className="section">
            <div className="section-title">Saved links</div>
            {links.length ? (
              <div className="track-list">
                {links.map((link) => {
                  const station = toExternalStation(link);
                  const active =
                    player.current?.stationuuid === station.stationuuid;
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
                            active ? player.toggle() : playStation(station)
                          }
                          aria-label="Play link"
                        >
                          {active && player.isPlaying ? 'Pause' : 'Play'}
                        </button>
                        <button
                          className="link-btn"
                          type="button"
                          onClick={() => handleRemove(link.id)}
                          aria-label="Remove link"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state">No saved links yet.</div>
            )}
          </div>

          {linkRecent.length > 0 && (
            <div className="section">
              <div className="section-title">Recently played links</div>
              <StationTable stations={linkRecent} compact />
            </div>
          )}
        </>
      )}
    </section>
  );
};

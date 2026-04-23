import { useEffect, useMemo, useState } from 'react';
import { StationTable } from '../components/StationTable';
import { useCatalog } from '../state/CatalogContext';
import { useLibrary, usePlayback, useShell } from '../state/RadioContext';
import { useLocale } from '../state/LocaleContext';
import type { StationLite } from '../types';
import { toExternalStation } from './search/linkUtils';
import { useExternalLinks } from './search/useExternalLinks';
import { useStationSearch } from './search/useStationSearch';
import './discover.css';

const mergeStations = (left: StationLite[], right: StationLite[]) => {
  const merged = new Map<string, StationLite>();
  left.forEach((station) => merged.set(station.stationuuid, station));
  right.forEach((station) => merged.set(station.stationuuid, station));
  return Array.from(merged.values());
};

export const Discover = () => {
  const { t } = useLocale();
  const { searchStations } = useCatalog();
  const { recent, playbackHistory } = useLibrary();
  const { playStation, player } = usePlayback();
  const { searchDraft, clearSearchDraft } = useShell();
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1024
  );
  const [mode, setMode] = useState<'stations' | 'links'>('stations');
  const showStations = mode === 'stations';
  const compactResults = viewportWidth < 720;

  const stationSearch = useStationSearch({
    compactResults,
    mergeStations,
    searchStations,
    showStations,
    t
  });
  const linksState = useExternalLinks({ mode, t });

  useEffect(() => {
    const draft = searchDraft.trim();
    if (!draft) return;
    setMode('stations');
    stationSearch.setQuery(draft);
    clearSearchDraft();
  }, [clearSearchDraft, searchDraft, stationSearch.setQuery]);

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const linkRecent = useMemo(
    () => recent.filter((item) => item.stationuuid.startsWith('ext_')),
    [recent]
  );

  const quickReturnStations = useMemo(() => {
    const seen = new Set<string>();
    return [player.current, ...recent, ...[...playbackHistory].reverse()]
      .filter((station): station is StationLite => Boolean(station))
      .filter((station) => {
        if (seen.has(station.stationuuid)) return false;
        seen.add(station.stationuuid);
        return true;
      })
      .slice(0, 4);
  }, [player.current, recent, playbackHistory]);

  const compactQuickReturnStations = quickReturnStations.slice(0, viewportWidth < 860 ? 3 : 4);

  return (
    <section className="screen screen-search screen-search-v2">
      <div className="glass-card search-command-card">
        <div className="search-command-top">
          <div className="chip-row search-mode-switcher">
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
          <div className="search-command-status" aria-live="polite">
            <span>{showStations ? t('search.resultsTitle') : t('discover.linksSaved')}</span>
            <strong>
              {showStations
                ? `${stationSearch.results.length}${stationSearch.nextCursor ? '+' : ''}/${stationSearch.searchTotal}`
                : linksState.links.length}
            </strong>
          </div>
        </div>

        {showStations ? (
          <div className="search-command-body">
            <div className="search-bar">
              <input
                placeholder={t('discover.searchPlaceholder')}
                value={stationSearch.query}
                onChange={(event) => stationSearch.setQuery(event.target.value)}
              />
              {stationSearch.query ? (
                <button className="clear-btn" type="button" onClick={() => stationSearch.setQuery('')}>
                  {t('common.clear')}
                </button>
              ) : null}
            </div>
            {!stationSearch.query.trim() && stationSearch.recentQueries.length ? (
              <div className="search-chip-row">
                {stationSearch.recentQueries.map((recentQuery) => (
                  <button
                    key={`recent-query-${recentQuery}`}
                    className="search-mini-chip"
                    type="button"
                    onClick={() => stationSearch.applyRecentQuery(recentQuery)}
                  >
                    <span className="search-mini-chip-label">{recentQuery}</span>
                    <strong className="search-mini-chip-meta">{t('search.recentQueryHint')}</strong>
                  </button>
                ))}
              </div>
            ) : null}
            <div className="search-toolbar-row search-toolbar-row-minimal">
              <button
                className={`chip ${stationSearch.filtersOpen ? 'active' : ''}`}
                type="button"
                onClick={() => stationSearch.setFiltersOpen((prev) => !prev)}
              >
                {stationSearch.filtersOpen ? t('search.hideFilters') : t('search.showFilters')}
              </button>
              <button
                className="chip"
                type="button"
                onClick={stationSearch.resetSearchScope}
                disabled={stationSearch.activeFilterCount === 0}
              >
                {t('search.clearAllFilters')}
              </button>
            </div>
            {stationSearch.activeFilters.length ? (
              <div className="search-chip-row">
                {stationSearch.activeFilters.map((filter) => (
                  <button
                    key={filter.id}
                    className="search-mini-chip"
                    type="button"
                    onClick={filter.clear}
                  >
                    <span className="search-mini-chip-label">{filter.label}</span>
                    <strong className="search-mini-chip-meta">{t('common.clear')}</strong>
                  </button>
                ))}
              </div>
            ) : null}

            {stationSearch.filtersOpen ? (
              <div className="search-filters-drawer search-filters-drawer-minimal">
                <div className="filters">
                  <select
                    className="filter-select"
                    value={stationSearch.countryFilter}
                    onChange={(event) => stationSearch.setCountryFilter(event.target.value)}
                  >
                    <option value="All">{t('discover.regionAll')}</option>
                    {stationSearch.countries
                      .filter((country) => country !== 'All')
                      .map((country) => (
                        <option key={country} value={country}>
                          {country}
                        </option>
                      ))}
                  </select>
                  <select
                    className="filter-select"
                    value={stationSearch.tagFilter}
                    onChange={(event) => stationSearch.setTagFilter(event.target.value)}
                  >
                    <option value="All">{t('discover.tagTitle')}</option>
                    {stationSearch.tags
                      .filter((tag) => tag !== 'All')
                      .map((tag) => (
                        <option key={tag} value={tag}>
                          {tag}
                        </option>
                      ))}
                  </select>
                  <select
                    className="filter-select"
                    value={stationSearch.languageFilter}
                    onChange={(event) => stationSearch.setLanguageFilter(event.target.value)}
                  >
                    <option value="All">{t('discover.regionAll')}</option>
                    {stationSearch.languages
                      .filter((lang) => lang !== 'All')
                      .map((lang) => (
                        <option key={lang} value={lang}>
                          {lang}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="search-bar">
                  <input
                    placeholder={t('search.countrySearchPlaceholder')}
                    value={stationSearch.countryQuery}
                    onChange={(event) => stationSearch.setCountryQuery(event.target.value)}
                  />
                </div>
                <div className="chip-row search-filter-chip-row">
                  <button
                    className={`chip ${stationSearch.continentFilter === 'All' ? 'active' : ''}`}
                    type="button"
                    onClick={() => stationSearch.setContinentFilter('All')}
                  >
                    {t('discover.regionAll')}
                  </button>
                  {stationSearch.continentCounts.map((item) => (
                    <button
                      key={item.id}
                      className={`chip ${stationSearch.continentFilter === item.id ? 'active' : ''}`}
                      type="button"
                      onClick={() => stationSearch.setContinentFilter(item.id)}
                    >
                      {item.id} · {item.count}
                    </button>
                  ))}
                </div>
                <div className="chip-row search-filter-chip-row">
                  {stationSearch.featuredTags.map((tag) => (
                    <button
                      key={tag}
                      className={`chip ${stationSearch.tagFilter === tag ? 'active' : ''}`}
                      type="button"
                      onClick={() =>
                        stationSearch.setTagFilter(stationSearch.tagFilter === tag ? 'All' : tag)
                      }
                    >
                      {tag}
                    </button>
                  ))}
                </div>
                {stationSearch.visibleCountryBuckets.length ? (
                  <div className="search-chip-row">
                    {stationSearch.visibleCountryBuckets.slice(0, 6).map((bucket) => (
                      <button
                        key={bucket.key}
                        className={`search-mini-chip ${
                          stationSearch.countryFilter === bucket.country ? 'active' : ''
                        }`}
                        type="button"
                        onClick={() =>
                          stationSearch.setCountryFilter(
                            stationSearch.countryFilter === bucket.country ? 'All' : bucket.country
                          )
                        }
                      >
                        <span className="search-mini-chip-label">{bucket.country}</span>
                        <strong className="search-mini-chip-meta">{bucket.count}</strong>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="search-links-stack">
            <div className="settings-card stack">
              <input
                className="settings-input"
                placeholder={t('discover.audioPlaceholder')}
                value={linksState.linkUrl}
                onChange={(event) => linksState.setLinkUrl(event.target.value)}
              />
              <input
                className="settings-input"
                placeholder={t('discover.titlePlaceholder')}
                value={linksState.linkName}
                onChange={(event) => linksState.setLinkName(event.target.value)}
              />
              <div className="settings-actions">
                <button className="chip" type="button" onClick={linksState.handlePaste}>
                  {t('common.paste')}
                </button>
                <button className="chip" type="button" onClick={linksState.addSingleLink}>
                  {t('common.addLink')}
                </button>
                <button
                  className="chip"
                  type="button"
                  onClick={linksState.extractLink}
                  disabled={linksState.linkLoading || !linksState.apiBase || !linksState.apiOnline}
                >
                  {t('common.extractStreams')}
                </button>
                <button
                  className="chip"
                  type="button"
                  onClick={() => void linksState.importPlaylist(linksState.linkUrl)}
                  disabled={linksState.linkLoading}
                >
                  {linksState.linkLoading ? t('common.importing') : t('common.importPlaylist')}
                </button>
              </div>
            </div>
            {(!linksState.apiBase || !linksState.apiOnline) ? (
              <div className="error">{t('discover.extractorOffline')}</div>
            ) : null}
            {linksState.linkError ? <div className="error">{linksState.linkError}</div> : null}
          </div>
        )}
      </div>

      {showStations ? (
        <>
          {compactQuickReturnStations.length ? (
            <div className="glass-card search-shortcuts-card">
              <div className="search-chip-row">
                {compactQuickReturnStations.map((station) => {
                  const isActive = player.current?.stationuuid === station.stationuuid;
                  return (
                    <button
                      key={`return-${station.stationuuid}`}
                      className={`search-mini-chip ${isActive ? 'active' : ''}`}
                      type="button"
                      onClick={() =>
                        playStation(station, {
                          playlist: quickReturnStations,
                          sourceId: 'resume'
                        })
                      }
                    >
                      <span className="search-mini-chip-label">{station.name}</span>
                      <strong className="search-mini-chip-meta">
                        {isActive ? t('common.play') : station.country || t('common.unknown')}
                      </strong>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="glass-card search-results-card">
            <div className="search-results-head-minimal">
              <div className="section-title">{t('search.resultsTitle')}</div>
              <div className="search-results-meta">
                <span>{t('common.view')}</span>
                <strong>
                  {stationSearch.results.length}/{stationSearch.searchTotal}
                </strong>
              </div>
            </div>
            {stationSearch.searchError ? <div className="error">{stationSearch.searchError}</div> : null}
            <div className="search-results-shell">
              {stationSearch.searchLoading && !stationSearch.results.length ? (
                <div className="empty-state">{t('common.loading')}</div>
              ) : stationSearch.results.length ? (
                <StationTable
                  stations={stationSearch.results}
                  sourceId="discover-stations"
                  compact={compactResults}
                  nowPlayingMode="viewport"
                />
              ) : (
                <div className="empty-state">{t('stationTable.empty')}</div>
              )}
            </div>
          </div>
          {stationSearch.nextCursor ? (
            <div className="section">
              <button
                className="chip"
                type="button"
                onClick={stationSearch.loadMore}
                disabled={stationSearch.searchLoadingMore}
              >
                {stationSearch.searchLoadingMore ? t('common.loading') : t('discover.loadMore')}
              </button>
            </div>
          ) : null}
          <div className="scroll-sentinel" ref={stationSearch.sentinelRef} />
        </>
      ) : (
        <>
          <div className="glass-card search-results-card">
            <div className="search-results-head-minimal">
              <div className="section-title">{t('discover.linksSaved')}</div>
              <div className="search-results-meta">
                <span>{t('common.view')}</span>
                <strong>{linksState.links.length}</strong>
              </div>
            </div>
            {linksState.links.length ? (
              <div className="track-list">
                {linksState.links.map((link) => {
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
                              ? void player.toggle()
                              : playStation(station, {
                                  playlist: linksState.links.map(toExternalStation),
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
                          onClick={() => linksState.removeLink(link.id)}
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

          {linkRecent.length ? (
            <div className="glass-card search-results-card">
              <div className="search-results-head-minimal">
                <div className="section-title">{t('discover.linksRecent')}</div>
                <div className="search-results-meta">
                  <span>{t('common.view')}</span>
                  <strong>{linkRecent.length}</strong>
                </div>
              </div>
              <StationTable stations={linkRecent} compact sourceId="discover-links-recent" />
            </div>
          ) : null}
        </>
      )}
    </section>
  );
};

export const Search = Discover;

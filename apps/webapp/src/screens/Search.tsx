import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { StationTable } from '../components/StationTable';
import { StationArtwork } from '../components/StationArtwork';
import { useCatalog } from '../state/CatalogContext';
import { useLibrary, usePlayback, useShell } from '../state/RadioContext';
import { useLocale } from '../state/LocaleContext';
import type { StationLite } from '../types';
import { normalizeStationName, stationLocation, stationTags } from '../lib/stationUtils';
import { useDialog } from '../lib/useDialog';
import { toExternalStation } from './search/linkUtils';
import { useExternalLinks } from './search/useExternalLinks';
import { useStationSearch } from './search/useStationSearch';
import { rankStationsForSearch } from '../lib/stationPlayability';
import './discover.css';

const mergeStations = (left: StationLite[], right: StationLite[]) => {
  const merged = new Map<string, StationLite>();
  left.forEach((station) => merged.set(station.stationuuid, station));
  right.forEach((station) => merged.set(station.stationuuid, station));
  return Array.from(merged.values());
};

type SearchResultCardProps = {
  station: StationLite;
  stations: StationLite[];
  sourceId: string;
};

const SearchResultCard = ({ station, stations, sourceId }: SearchResultCardProps) => {
  const { t } = useLocale();
  const { playStation, player, shareStation } = usePlayback();
  const { toggleFavorite, isFavorite } = useLibrary();
  const active = player.current?.stationuuid === station.stationuuid;
  const liked = isFavorite(station.stationuuid);
  const playLabel = active && player.isPlaying ? t('common.pause') : t('common.play');
  const tags = stationTags(station);
  const location = stationLocation(station);

  const toggleStation = () => {
    if (active) {
      void player.toggle();
      return;
    }
    playStation(station, {
      playlist: stations,
      sourceId,
      sourceLabel: t('radio.searchResults')
    });
  };

  return (
    <article
      className={`search-station-card station-row ${active ? 'active' : ''}`}
      data-search-station-card
      data-station-id={station.stationuuid}
    >
      <button
        className="search-station-card-main"
        type="button"
        onClick={toggleStation}
        aria-label={`${playLabel}: ${normalizeStationName(station.name)}`}
      >
        <StationArtwork station={station} size="card" />
        <span className="search-card-play-overlay" aria-hidden="true">
          {active && player.isPlaying ? 'II' : '>'}
        </span>
      </button>
      <div className="search-station-card-copy">
        <div className="search-card-title" title={normalizeStationName(station.name)}>
          {normalizeStationName(station.name)}
        </div>
        <div className="search-card-meta" title={location}>
          {location}
        </div>
        {tags ? (
          <div className="search-card-tags" title={tags}>
            {tags}
          </div>
        ) : null}
      </div>
      <div className="search-card-actions">
        <button className="play-btn search-card-play" type="button" onClick={toggleStation}>
          {playLabel}
        </button>
        <button
          className={`icon-btn search-card-fav ${liked ? 'active' : ''}`}
          type="button"
          onClick={() => toggleFavorite(station)}
          aria-label={liked ? t('stationTable.unfavorite') : t('stationTable.favorite')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 21.2l-1.4-1.3C5.4 15.4 2 12.3 2 8.4 2 5.6 4.2 3.5 7 3.5c1.6 0 3.2.7 4.2 2 1-1.3 2.6-2 4.2-2 2.8 0 5 2.1 5 4.9 0 3.9-3.4 7-8.6 11.4L12 21.2z" />
          </svg>
        </button>
        <button
          className="icon-btn search-card-share"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            void shareStation(station);
          }}
          aria-label={t('common.share')}
          title={t('common.share')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z" />
          </svg>
        </button>
      </div>
    </article>
  );
};

// Curated music-genre rail for the idle search screen. The
// auto-derived top tags from radio-browser facets are noisy
// ("estación", "méxico", "music") and feel boring. This list is
// what most music discovery apps actually surface — users
// recognise these labels at a glance. Each chip toggles the
// underlying tagFilter, so behaviour is identical to the old
// auto-derived rail; we just curate the labels.
const FEATURED_GENRES: ReadonlyArray<string> = [
  'pop',
  'rock',
  'jazz',
  'electronic',
  'hip hop',
  'classical',
  'dance',
  'indie',
  'blues',
  'reggae',
  'country',
  'metal',
  'ambient',
  'lounge',
  'soul',
  'funk',
  'latin',
  'house',
  'techno',
  'chillout',
  'folk',
  'world',
  'news',
  'talk',
  'sports',
  '80s',
  '90s',
  '00s'
];

// Hook-attached wheel handler that converts vertical deltas into
// horizontal scroll on a rail. Has to be attached via
// addEventListener with `{ passive: false }` — React's synthetic
// `onWheel` is passive by default, so `event.preventDefault()`
// silently no-ops there and the page kept scrolling vertically
// while the rail also scrolled horizontally. This direct listener
// blocks the page scroll cleanly.
type SearchFiltersSheetProps = {
  stationSearch: ReturnType<typeof useStationSearch>;
  onClose: () => void;
};

// Mobile filters bottom-sheet (≤720px) — the hero-card drawer's three NATIVE
// selects move here on the shared .bottom-sheet-card. Owner's call: selects
// stay native (full-width ≥48px rows; custom list UIs deferred). State is the
// EXISTING stationSearch.filtersOpen — no new state. PORTALED to document.body
// (Globe lesson: .app-shell-v2{isolation:isolate} + the animated screen frame
// pin even z-130 under the fixed dock — a sibling inside the screen tree is
// not enough), with its own useDialog (nested dialog roots double-handle Tab).
const SearchFiltersSheet = ({ stationSearch, onClose }: SearchFiltersSheetProps) => {
  const { t } = useLocale();
  const rootRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialog(rootRef, { isOpen: true, onClose });

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={rootRef}
      className="bottom-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-search-filters-sheet
    >
      <button
        className="bottom-sheet-scrim"
        type="button"
        onClick={onClose}
        aria-label={t('common.close')}
      />
      <div className="bottom-sheet-card">
        <span className="bottom-sheet-handle" aria-hidden="true" />
        <div className="bottom-sheet-head">
          <div>
            <div className="bottom-sheet-kicker">{t('nav.search')}</div>
            <div className="bottom-sheet-title" id={titleId}>
              {t('search.showFilters')}
            </div>
          </div>
          <button
            className="bottom-sheet-close"
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6 1.4-1.4Z" />
            </svg>
          </button>
        </div>

        <div className="search-filters-sheet-body">
          <label className="search-filters-field">
            <span className="search-filters-label">{t('search.scopeRegion')}</span>
            <input
              className="search-filters-country-query"
              type="search"
              inputMode="search"
              autoComplete="off"
              placeholder={t('discover.searchPlaceholder')}
              value={stationSearch.countryQuery}
              onChange={(event) => stationSearch.setCountryQuery(event.target.value)}
            />
            <select
              className="filter-select search-filters-select"
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
          </label>

          <label className="search-filters-field">
            <span className="search-filters-label">{t('search.genresTitle')}</span>
            <select
              className="filter-select search-filters-select"
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
          </label>

          <label className="search-filters-field">
            <span className="search-filters-label">{t('search.languagesTitle')}</span>
            <select
              className="filter-select search-filters-select"
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
          </label>

          <button
            className="search-filters-clear-all"
            type="button"
            onClick={stationSearch.resetSearchScope}
            disabled={stationSearch.activeFilterCount === 0}
          >
            {t('search.clearAllFilters')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

const useRailWheel = () => {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const handler = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      if (node.scrollWidth <= node.clientWidth) return;
      const maxScrollLeft = node.scrollWidth - node.clientWidth;
      const nextScrollLeft = Math.min(
        maxScrollLeft,
        Math.max(0, node.scrollLeft + event.deltaY)
      );
      if (nextScrollLeft === node.scrollLeft) return;
      event.preventDefault();
      node.scrollLeft = nextScrollLeft;
    };
    node.addEventListener('wheel', handler, { passive: false });
    return () => node.removeEventListener('wheel', handler);
  }, []);
  return ref;
};

export const Discover = () => {
  const { t } = useLocale();
  const { searchStations } = useCatalog();
  const {
    recent,
    playbackHistory,
    behaviorProfile,
    playabilityProfile,
    stationHealthProfile,
    radioSessionEvents
  } = useLibrary();
  const { playStation, playStationQueue, player } = usePlayback();
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
  // Three independent refs because each idle rail (continents,
  // countries, genres) is its own scroll container.
  const continentsRailRef = useRailWheel();
  const countriesRailRef = useRailWheel();
  const genresRailRef = useRailWheel();
  // Quick-return became a horizontal peek rail on mobile — same wheel-to-rail
  // conversion as the idle rails (no-op on desktop where the grid doesn't
  // overflow).
  const quickReturnRailRef = useRailWheel();

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
  // Only re-rank when the actual search inputs change (query string,
  // result array identity, or active filter set). The previous deps
  // included `radioSessionEvents`, `playabilityProfile`, etc. — those
  // tick on every play/pause/metadata update, and each tick re-ran
  // rankStationsForSearch with a fresh `now`, which silently re-
  // ordered the visible rows. The user perceived this as "the list
  // shuffles itself while I scroll, I can't read past the first
  // page". Now the order is captured at the moment the result list
  // arrives and stays put until the user types a new query or
  // changes a filter. Recommendation signals still feed back into
  // the *next* search, just not into the one the user is reading.
  //
  // The snapshot deliberately ignores changes to
  // behaviorProfile / playabilityProfile / sessionEvents /
  // stationHealthProfile — those are read once per snapshot via
  // refs so a stale closure problem can't quietly use frozen scoring
  // signals from app boot, but they don't trigger re-renders.
  const behaviorProfileRef = useRef(behaviorProfile);
  const playabilityProfileRef = useRef(playabilityProfile);
  const stationHealthProfileRef = useRef(stationHealthProfile);
  const radioSessionEventsRef = useRef(radioSessionEvents);
  useEffect(() => {
    behaviorProfileRef.current = behaviorProfile;
    playabilityProfileRef.current = playabilityProfile;
    stationHealthProfileRef.current = stationHealthProfile;
    radioSessionEventsRef.current = radioSessionEvents;
  });

  const rankedSearchResults = useMemo(
    () =>
      rankStationsForSearch(stationSearch.results, {
        query: stationSearch.query,
        behaviorProfile: behaviorProfileRef.current,
        playabilityProfile: playabilityProfileRef.current,
        healthProfile: stationHealthProfileRef.current,
        sessionEvents: radioSessionEventsRef.current
      }),
    [
      stationSearch.query,
      stationSearch.results,
      // include the active filter set so chip-toggles still reorder
      stationSearch.countryFilter,
      stationSearch.tagFilter,
      stationSearch.languageFilter,
      stationSearch.continentFilter
    ]
  );
  const searchQueue = useMemo(
    () => rankedSearchResults.slice(0, compactResults ? 18 : 24),
    [compactResults, rankedSearchResults]
  );
  const startSearchRadio = () => {
    if (!searchQueue.length) return;
    const query = stationSearch.query.trim();
    playStationQueue(searchQueue, {
      sourceId: 'search-results',
      sourceLabel: query ? t('search.queueFromQuery', { query }) : t('radio.searchResults')
    });
  };

  const trimmedQuery = stationSearch.query.trim();
  const queryActive = trimmedQuery.length > 0;
  const hasResults = rankedSearchResults.length > 0;
  const showSkeleton = stationSearch.searchLoading && !stationSearch.results.length;
  const filterCount = stationSearch.activeFilterCount;

  return (
    <section
      // Keep `screen-search-v2` alongside the new v3 class so existing
      // e2e selectors (and any vendor analytics rules pinned to v2)
      // still match. v3 governs the actual layout.
      className="screen screen-search screen-search-v2 screen-search-v3"
      data-search-mode={mode}
      data-query-active={queryActive ? 'true' : 'false'}
    >
      {showStations ? (
        <div className="glass-card search-hero-card">
          <div className="search-hero-input-row">
            {/* Hero input takes the full row so it reads as the
                primary action — earlier we had a "+ URL" button next
                to it, which users mistook for a "search" submit
                button. The URL importer now lives as a quiet
                tertiary link at the bottom of the idle screen. */}
            <label className="search-hero-input" htmlFor="search-hero-input">
              <svg
                className="search-hero-icon"
                viewBox="0 0 24 24"
                width="18"
                height="18"
                aria-hidden="true"
              >
                <path
                  fill="currentColor"
                  d="M10.5 3a7.5 7.5 0 015.92 12.13l4.22 4.22-1.41 1.41-4.22-4.22A7.5 7.5 0 1110.5 3zm0 2a5.5 5.5 0 100 11 5.5 5.5 0 000-11z"
                />
              </svg>
              <input
                id="search-hero-input"
                type="search"
                inputMode="search"
                autoComplete="off"
                placeholder={t('discover.searchPlaceholder')}
                value={stationSearch.query}
                onChange={(event) => stationSearch.setQuery(event.target.value)}
              />
              {stationSearch.query ? (
                <button
                  className="search-hero-clear"
                  type="button"
                  onClick={() => stationSearch.setQuery('')}
                  aria-label={t('common.clear')}
                >
                  ✕
                </button>
              ) : null}
            </label>
          </div>

          {!queryActive && stationSearch.recentQueries.length ? (
            <div className="search-hero-recent">
              <span className="search-hero-recent-label">{t('search.recentQueryHint')}</span>
              <div className="search-hero-recent-row">
                {stationSearch.recentQueries.slice(0, 6).map((recentQuery) => (
                  <button
                    key={`recent-query-${recentQuery}`}
                    className="search-hero-recent-chip"
                    type="button"
                    onClick={() => stationSearch.applyRecentQuery(recentQuery)}
                  >
                    {recentQuery}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {queryActive ? (
            compactResults ? (
              // ≤720: fixed count-left / filters-pill-right row instead of the
              // wrapping chip pile; play-all becomes a full-width primary
              // button below. "Clear all" lives in the filters sheet footer.
              <>
                <div className="search-hero-result-bar search-hero-result-bar--compact">
                  <div className="search-hero-result-count">
                    <strong>
                      {rankedSearchResults.length}
                      {stationSearch.nextCursor ? '+' : ''}
                    </strong>
                    <span>
                      / {stationSearch.searchTotal} {t('search.resultsMetric').toLowerCase()}
                    </span>
                  </div>
                  <button
                    className="search-hero-filters-pill"
                    type="button"
                    onClick={() => stationSearch.setFiltersOpen(true)}
                    aria-expanded={stationSearch.filtersOpen}
                    aria-haspopup="dialog"
                  >
                    {t('search.showFilters')}
                    {filterCount > 0 ? (
                      <em className="search-hero-filters-badge">{filterCount}</em>
                    ) : null}
                  </button>
                </div>
                <button
                  className="search-hero-play-all-wide"
                  type="button"
                  onClick={startSearchRadio}
                  disabled={!searchQueue.length}
                >
                  ▶ {t('search.playAllResults')}
                </button>
              </>
            ) : (
              <div className="search-hero-result-bar">
                <div className="search-hero-result-count">
                  <strong>
                    {rankedSearchResults.length}
                    {stationSearch.nextCursor ? '+' : ''}
                  </strong>
                  <span>
                    / {stationSearch.searchTotal} {t('search.resultsMetric').toLowerCase()}
                  </span>
                </div>
                <div className="search-hero-result-actions">
                  <button
                    className="chip search-hero-play-all"
                    type="button"
                    onClick={startSearchRadio}
                    disabled={!searchQueue.length}
                  >
                    ▶ {t('search.playAllResults')}
                  </button>
                  <button
                    className={`chip search-hero-filters-toggle ${
                      stationSearch.filtersOpen ? 'active' : ''
                    }`}
                    type="button"
                    onClick={() => stationSearch.setFiltersOpen((prev) => !prev)}
                    aria-expanded={stationSearch.filtersOpen}
                  >
                    {filterCount > 0
                      ? `${t('search.showFilters')} · ${filterCount}`
                      : stationSearch.filtersOpen
                        ? t('search.hideFilters')
                        : t('search.showFilters')}
                  </button>
                  {filterCount > 0 ? (
                    <button
                      className="chip search-hero-reset"
                      type="button"
                      onClick={stationSearch.resetSearchScope}
                    >
                      {t('search.clearAllFilters')}
                    </button>
                  ) : null}
                </div>
              </div>
            )
          ) : null}

          {queryActive && stationSearch.activeFilters.length ? (
            <div className="search-hero-active-filters">
              {stationSearch.activeFilters.map((filter) => (
                <button
                  key={filter.id}
                  className="search-hero-filter-pill"
                  type="button"
                  onClick={filter.clear}
                  aria-label={`${filter.label} — ${t('common.clear')}`}
                >
                  <span>{filter.label}</span>
                  <span className="search-hero-filter-pill-x" aria-hidden="true">
                    ✕
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {queryActive && stationSearch.filtersOpen && !compactResults ? (
            <div className="search-hero-drawer">
              <div className="search-hero-drawer-row">
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
            <div className="search-links-mode-back">
              <button className="chip" type="button" onClick={() => setMode('stations')}>
                ← {t('discover.stationsMode')}
              </button>
            </div>
          </div>
        )}

      {showStations && !queryActive ? (
        <>
          {compactQuickReturnStations.length ? (
            <div className="search-section">
              <div className="search-section-head">
                <span className="search-section-label">
                  {t('search.quickReturnTitle')}
                </span>
              </div>
              <div className="search-quick-return-row" ref={quickReturnRailRef}>
                {compactQuickReturnStations.map((station) => {
                  const isActive = player.current?.stationuuid === station.stationuuid;
                  return (
                    <button
                      key={`return-${station.stationuuid}`}
                      className={`search-quick-return-card ${isActive ? 'active' : ''}`}
                      type="button"
                      onClick={() =>
                        playStation(station, {
                          playlist: quickReturnStations,
                          sourceId: 'resume'
                        })
                      }
                    >
                      <StationArtwork station={station} size="sm" />
                      <div className="search-quick-return-copy">
                        <div className="search-quick-return-name">{normalizeStationName(station.name)}</div>
                        <div className="search-quick-return-meta">
                          {station.country || t('common.unknown')}
                        </div>
                      </div>
                      <span
                        className="search-quick-return-play"
                        aria-hidden="true"
                      >
                        {isActive && player.isPlaying ? '❚❚' : '▶'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {stationSearch.continentCounts.length ? (
            <div className="search-section">
              <div className="search-section-head">
                <span className="search-section-label">{t('search.scopeRegion')}</span>
              </div>
              <div className="search-rail search-rail-continent" ref={continentsRailRef}>
                <button
                  className={`search-rail-chip ${
                    stationSearch.continentFilter === 'All' ? 'active' : ''
                  }`}
                  type="button"
                  onClick={() => stationSearch.setContinentFilter('All')}
                >
                  <span className="search-rail-chip-label">{t('discover.regionAll')}</span>
                </button>
                {stationSearch.continentCounts.map((item) => (
                  <button
                    key={item.id}
                    className={`search-rail-chip ${
                      stationSearch.continentFilter === item.id ? 'active' : ''
                    }`}
                    type="button"
                    onClick={() =>
                      stationSearch.setContinentFilter(
                        stationSearch.continentFilter === item.id ? 'All' : item.id
                      )
                    }
                  >
                    <span className="search-rail-chip-label">{item.id}</span>
                    <strong className="search-rail-chip-count">{item.count}</strong>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {stationSearch.visibleCountryBuckets.length ? (
            <div className="search-section">
              <div className="search-section-head">
                <span className="search-section-label">
                  {t('search.countriesTitle')}
                </span>
              </div>
              <div className="search-rail" ref={countriesRailRef}>
                {stationSearch.visibleCountryBuckets.slice(0, 12).map((bucket) => (
                  <button
                    key={bucket.key}
                    className={`search-rail-chip ${
                      stationSearch.countryFilter === bucket.country ? 'active' : ''
                    }`}
                    type="button"
                    onClick={() =>
                      stationSearch.setCountryFilter(
                        stationSearch.countryFilter === bucket.country ? 'All' : bucket.country
                      )
                    }
                  >
                    <span className="search-rail-chip-label">{bucket.country}</span>
                    <strong className="search-rail-chip-count">{bucket.count}</strong>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="search-section">
            <div className="search-section-head">
              <span className="search-section-label">{t('search.genresTitle')}</span>
            </div>
            <div className="search-rail" ref={genresRailRef}>
              {FEATURED_GENRES.map((tag) => (
                <button
                  key={tag}
                  className={`search-rail-chip ${
                    stationSearch.tagFilter === tag ? 'active' : ''
                  }`}
                  type="button"
                  onClick={() =>
                    stationSearch.setTagFilter(stationSearch.tagFilter === tag ? 'All' : tag)
                  }
                >
                  <span className="search-rail-chip-label">{tag}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Tertiary action: import a custom audio URL. Lives down
              here so the empty search screen reads as a discovery
              tool first; advanced users can still find the importer
              at the bottom of the page. */}
          <div className="search-import-link-row">
            <button
              className="search-import-link"
              type="button"
              onClick={() => setMode('links')}
            >
              + {t('common.addLink') || 'Добавить URL'} ·{' '}
              <span className="search-import-link-meta">m3u / mp3 / pls</span>
            </button>
          </div>
        </>
      ) : null}

      {showStations && (queryActive || hasResults || showSkeleton) ? (
        <>
          <div className="glass-card search-results-card-v3">
            {stationSearch.searchError ? (
              <div className="error">{stationSearch.searchError}</div>
            ) : null}
            <div className="search-results-shell">
              {showSkeleton ? (
                <div
                  className="search-results-skeleton"
                  aria-busy="true"
                  aria-label={t('search.loadingResults')}
                >
                  {Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className="search-results-skeleton-row" />
                  ))}
                </div>
              ) : hasResults ? (
                compactResults ? (
                  <div className="search-result-grid">
                    {rankedSearchResults.slice(0, 24).map((station) => (
                      <SearchResultCard
                        key={`search-card-${station.stationuuid}`}
                        station={station}
                        stations={rankedSearchResults}
                        sourceId="search-results"
                      />
                    ))}
                  </div>
                ) : (
                  <StationTable
                    stations={rankedSearchResults}
                    sourceId="discover-stations"
                    compact={compactResults}
                    nowPlayingMode="viewport"
                  />
                )
              ) : (
                <div className="search-empty-state" role="status">
                  <span className="search-empty-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M10 4a6 6 0 014.47 10.01l4.26 4.26-1.41 1.41-4.26-4.26A6 6 0 1110 4zm0 2a4 4 0 100 8 4 4 0 000-8z" />
                    </svg>
                  </span>
                  <strong>
                    {trimmedQuery
                      ? t('search.noResultsFor', { query: trimmedQuery })
                      : t('stationTable.empty')}
                  </strong>
                  <span>
                    {t('home.quickSearchNoResultsCopy') ||
                      'Попробуй другое название, страну или жанр.'}
                  </span>
                  {trimmedQuery ? (
                    <button
                      className="chip"
                      type="button"
                      onClick={() => stationSearch.setQuery('')}
                    >
                      {t('search.clearSearch')}
                    </button>
                  ) : null}
                </div>
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
      ) : !showStations ? (
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
      ) : null}
      {queryActive && stationSearch.filtersOpen && compactResults ? (
        <SearchFiltersSheet
          stationSearch={stationSearch}
          onClose={() => stationSearch.setFiltersOpen(false)}
        />
      ) : null}
    </section>
  );
};

export const Search = Discover;

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { StationTable } from '../components/StationTable';
import { StationArtwork } from '../components/StationArtwork';
import { useCatalog } from '../state/CatalogContext';
import { useLibrary, usePlayback, useShell } from '../state/RadioContext';
import { useLocale } from '../state/LocaleContext';
import type { StationLite } from '../types';
import { formatCountryLabel, normalizeStationName } from '../lib/stationUtils';
import { useDialog } from '../lib/useDialog';
import { toExternalStation } from './search/linkUtils';
import { useExternalLinks } from './search/useExternalLinks';
import { useStationSearch } from './search/useStationSearch';
import { SearchResultRow } from './search/SearchResultRow';
import { useSearchNowPlayingSession } from './search/useSearchNowPlaying';
import { useVoiceSearch } from './search/useVoiceSearch';
import { SORT_LABEL_KEY, SORT_MODES, applySearchSort, type SearchSortMode } from './search/searchSort';
import { rankStationsForSearch } from '../lib/stationPlayability';
import { diversifyStationOrder } from '../lib/stationDiversity';
import { rankStationsForUser, tasteScore, withFavoriteTasteBoosts, type TasteProfileV2 } from '../lib/tasteProfile';
import './discover.css';

const mergeStations = (left: StationLite[], right: StationLite[]) => {
  const merged = new Map<string, StationLite>();
  left.forEach((station) => merged.set(station.stationuuid, station));
  right.forEach((station) => merged.set(station.stationuuid, station));
  return Array.from(merged.values());
};

const hasPersonalSearchTaste = (
  profile: TasteProfileV2 | null | undefined,
  favorites: StationLite[]
) =>
  favorites.length > 0 ||
  Boolean(
    profile?.hiddenStationIds?.length ||
      Object.keys(profile?.stationScores || {}).length ||
      Object.keys(profile?.tagScores || {}).length ||
      Object.keys(profile?.countryScores || {}).length ||
      Object.keys(profile?.languageScores || {}).length
  );

type SearchSortMenuProps = {
  sortMode: SearchSortMode;
  onSelect: (mode: SearchSortMode) => void;
  t: ReturnType<typeof useLocale>['t'];
};

// Deliberately NOT built on useDialog. useDialog is a MODAL primitive: it marks
// every sibling of its root `inert` while open. For a sort dropdown that means
// the trigger itself becomes inert, so tapping it a second time to dismiss the
// menu does nothing — a real bug for a non-modal popover. This is the standard
// lightweight listbox instead: Escape closes, an outside pointerdown closes,
// arrow keys move, and focus returns to the always-mounted trigger.
const SearchSortMenu = ({ sortMode, onSelect, t }: SearchSortMenuProps) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(
    (restoreFocus = true) => {
      setOpen(false);
      if (restoreFocus) triggerRef.current?.focus();
    },
    []
  );

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (listRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const options = Array.from(
        listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') || []
      );
      if (!options.length) return;
      event.preventDefault();
      const current = options.indexOf(document.activeElement as HTMLElement);
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const next = (current + delta + options.length) % options.length;
      options[next]?.focus();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    // Move focus into the menu so keyboard users are not stranded on the trigger.
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [close, open]);

  return (
    <div className="search-sort">
      <button
        ref={triggerRef}
        className="search-sort-trigger"
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${t('search.sortLabel')}: ${t(SORT_LABEL_KEY[sortMode])}`}
      >
        {/* The «Сортировка:» prefix is hidden below 430px (CSS) so the results
            count beside it never ellipsizes — at 390px the two together
            overflow the row. It stays in the accessible name at every width,
            so nothing is lost for assistive tech. */}
        <span className="search-sort-trigger-label">
          <span className="search-sort-trigger-prefix">{t('search.sortLabel')}: </span>
          {t(SORT_LABEL_KEY[sortMode])}
        </span>
        <span className="search-sort-caret" aria-hidden="true">
          ⌄
        </span>
      </button>
      {open ? (
        <div
          ref={listRef}
          className="search-sort-menu"
          role="listbox"
          aria-label={t('search.sortLabel')}
        >
          {SORT_MODES.map((mode) => (
            <button
              key={mode}
              className={`search-sort-option ${mode === sortMode ? 'active' : ''}`}
              type="button"
              role="option"
              aria-selected={mode === sortMode}
              onClick={() => {
                onSelect(mode);
                close();
              }}
            >
              {t(SORT_LABEL_KEY[mode])}
            </button>
          ))}
        </div>
      ) : null}
    </div>
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
        data-dialog-backdrop
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

          {/* Continent goes LAST. Country must remain the FIRST <select> in
              this sheet — mobile.spec.ts selects it positionally. Until now
              continentFilter was clearable via the active-filter pills but had
              no control in either filter UI. */}
          <label className="search-filters-field">
            <span className="search-filters-label">{t('search.filterContinent')}</span>
            <select
              className="filter-select search-filters-select"
              value={stationSearch.continentFilter}
              onChange={(event) =>
                stationSearch.setContinentFilter(
                  event.target.value as typeof stationSearch.continentFilter
                )
              }
            >
              <option value="All">{t('discover.regionAll')}</option>
              {stationSearch.continentCounts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id === 'Other' ? t('common.unknown') : item.id}
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
  const { t, locale } = useLocale();
  const { searchStations } = useCatalog();
  const {
    favorites,
    recent,
    playbackHistory,
    behaviorProfile,
    playabilityProfile,
    tasteProfile,
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
  // 5th rail: the filter chip row scrolls horizontally like the others.
  const filterChipRailRef = useRailWheel();
  const browseSeedRef = useRef(Date.now());

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
  const favoritesRef = useRef(favorites);
  const tasteProfileRef = useRef(tasteProfile);
  const stationHealthProfileRef = useRef(stationHealthProfile);
  const radioSessionEventsRef = useRef(radioSessionEvents);
  // Recently-played set, read through refs so it never re-triggers the snapshot
  // memo (same freeze contract as the scoring signals above). Used to demote
  // just-listened stations to the tail of a no-query browse so «одно и то же»
  // that you already heard stops leading the discovery list.
  const recentRef = useRef(recent);
  const playbackHistoryRef = useRef(playbackHistory);
  const playerCurrentIdRef = useRef(player.current?.stationuuid ?? null);
  const rankedSearchSnapshotRef = useRef<{
    signature: string;
    rawIds: string[];
    ranked: StationLite[];
  } | null>(null);
  useEffect(() => {
    behaviorProfileRef.current = behaviorProfile;
    playabilityProfileRef.current = playabilityProfile;
    favoritesRef.current = favorites;
    tasteProfileRef.current = tasteProfile;
    stationHealthProfileRef.current = stationHealthProfile;
    radioSessionEventsRef.current = radioSessionEvents;
    recentRef.current = recent;
    playbackHistoryRef.current = playbackHistory;
    playerCurrentIdRef.current = player.current?.stationuuid ?? null;
  });

  const rankedSearchResults = useMemo(
    () => {
      const query = stationSearch.query.trim();
      const signature = [
        query,
        stationSearch.countryFilter,
        stationSearch.tagFilter,
        stationSearch.languageFilter,
        stationSearch.continentFilter
      ].join('\u001f');
      const rawIds = stationSearch.results.map((station) => station.stationuuid);
      const previous = rankedSearchSnapshotRef.current;
      const isAppend =
        previous?.signature === signature &&
        rawIds.length >= previous.rawIds.length &&
        previous.rawIds.every((stationId, index) => rawIds[index] === stationId);

      // Stations the user just heard: push them to the tail of a no-query browse
      // so discovery leads with something new instead of what's already playing /
      // in their recents. Typed search is left untouched (relevance-first).
      const demotedIds = new Set<string>();
      recentRef.current.forEach((station) => demotedIds.add(station.stationuuid));
      playbackHistoryRef.current.forEach((station) => demotedIds.add(station.stationuuid));
      if (playerCurrentIdRef.current) demotedIds.add(playerCurrentIdRef.current);
      const demoteRecentlyPlayed = (list: StationLite[]) => {
        if (!demotedIds.size) return list;
        const fresh: StationLite[] = [];
        const played: StationLite[] = [];
        list.forEach((station) => (demotedIds.has(station.stationuuid) ? played : fresh).push(station));
        return played.length ? [...fresh, ...played] : list;
      };

      // Effective personal taste (favorites folded in) — a small tie-breaker so a
      // TYPED search leans toward the user's genres/countries among near-equal
      // matches (owner's «примесь рекомендаций в поиск»), clamped in the ranker so
      // it never outranks what the user actually typed. Zero effect with no taste.
      const effectiveSearchTaste = withFavoriteTasteBoosts(tasteProfileRef.current, favoritesRef.current);
      const rankPage = (page: StationLite[], seedOffset: number) => {
        if (!page.length) return [];
        if (query.length >= 2) {
          return rankStationsForSearch(page, {
            query: stationSearch.query,
            behaviorProfile: behaviorProfileRef.current,
            playabilityProfile: playabilityProfileRef.current,
            healthProfile: stationHealthProfileRef.current,
            sessionEvents: radioSessionEventsRef.current,
            tasteBoostFor: (station) => tasteScore(station, effectiveSearchTaste)
          });
        }

        const base = page;
        if (!hasPersonalSearchTaste(tasteProfileRef.current, favoritesRef.current)) {
          return demoteRecentlyPlayed(
            diversifyStationOrder(base, {
              limit: base.length,
              maxPerCountry: 4,
              maxPerPrimaryTag: 5,
              maxPerNameKey: 1
            })
          );
        }

        return demoteRecentlyPlayed(
          diversifyStationOrder(
            rankStationsForUser(base, effectiveSearchTaste, playabilityProfileRef.current, {
              mode: 'search',
              seed: browseSeedRef.current + seedOffset,
              limit: base.length,
              healthProfile: stationHealthProfileRef.current,
              sessionEvents: radioSessionEventsRef.current
            }),
            {
              limit: base.length,
              maxPerCountry: 4,
              maxPerPrimaryTag: 5,
              maxPerNameKey: 1
            }
          )
        );
      };

      const ranked =
        isAppend && previous
          ? mergeStations(
              previous.ranked,
              rankPage(stationSearch.results.slice(previous.rawIds.length), previous.rawIds.length)
            )
          : rankPage(stationSearch.results, 0);

      rankedSearchSnapshotRef.current = { signature, rawIds, ranked };
      return ranked;
    },
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
  // Sort is a PURE DOWNSTREAM PASS over the frozen ranking — deliberately not
  // part of the snapshot signature above. Nothing inside the rank-freeze memo
  // changed: it still recomputes only on query/filter change, so the list still
  // cannot reshuffle under the user's finger. 'relevance' returns the same array
  // reference, making the default path byte-identical to the previous render.
  const sortedSearchResults = useMemo(
    () => applySearchSort(rankedSearchResults, stationSearch.sortMode),
    [rankedSearchResults, stationSearch.sortMode]
  );
  const searchQueue = useMemo(
    () => sortedSearchResults.slice(0, compactResults ? 18 : 24),
    [compactResults, sortedSearchResults]
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

  // Per-search probe budget for the now-playing lookup. Resets when the user
  // changes what they are searching for, not when they scroll within a search.
  useSearchNowPlayingSession(
    [
      trimmedQuery,
      stationSearch.countryFilter,
      stationSearch.tagFilter,
      stationSearch.languageFilter,
      stationSearch.continentFilter
    ].join('')
  );

  const voice = useVoiceSearch({
    // Fills the query and nothing else — the mic can never start playback (#86).
    onTranscript: (value) => {
      stationSearch.setQuery(value);
      if (typeof document !== 'undefined') {
        document.getElementById('search-hero-input')?.focus();
      }
    },
    locale
  });

  // One chip per filter dimension, in a fixed order so chips never
  // unmount/remount as filters toggle (which would break focus and animation).
  // Continent has no chip until it is active: the reference does not draw one,
  // but activeFilterCount counts it, so an active continent MUST still produce a
  // `.search-hero-filter-pill` or the badge/pill-count equality breaks.
  const filterDimensions = [
    {
      id: 'country',
      titleKey: 'search.filterCountry',
      value: stationSearch.countryFilter !== 'All' ? stationSearch.countryFilter : null,
      clear: () => stationSearch.setCountryFilter('All'),
      alwaysShow: true
    },
    {
      id: 'tag',
      titleKey: 'search.filterGenre',
      value: stationSearch.tagFilter !== 'All' ? stationSearch.tagFilter : null,
      clear: () => stationSearch.setTagFilter('All'),
      alwaysShow: true
    },
    {
      id: 'language',
      titleKey: 'search.filterLanguage',
      value: stationSearch.languageFilter !== 'All' ? stationSearch.languageFilter : null,
      clear: () => stationSearch.setLanguageFilter('All'),
      alwaysShow: true
    },
    {
      id: 'continent',
      titleKey: 'search.filterContinent',
      value: stationSearch.continentFilter !== 'All' ? stationSearch.continentFilter : null,
      clear: () => stationSearch.setContinentFilter('All'),
      alwaysShow: false
    }
  ].filter((dimension) => dimension.alwaysShow || dimension.value);

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
            <label className="visually-hidden" htmlFor="search-hero-input">
              {t('discover.searchPlaceholder')}
            </label>
            <div className="search-hero-input">
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
            </div>
            {/* Voice search sits beside the field, NOT in .app-topbar-actions —
                that cluster is global chrome shared by every section, and this
                control belongs to Search only. Renders nothing at all when the
                platform cannot actually do speech recognition; see
                useVoiceSearch for why a constructor check alone is not enough. */}
            {voice.supported ? (
              <button
                className="search-hero-mic"
                type="button"
                onClick={voice.start}
                aria-label={voice.listening ? t('search.voiceListening') : t('search.voiceSearch')}
                aria-pressed={voice.listening}
                title={voice.listening ? t('search.voiceListening') : t('search.voiceSearch')}
                data-listening={voice.listening ? 'true' : 'false'}
              >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M12 14a3 3 0 003-3V6a3 3 0 10-6 0v5a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 006 6.92V21h2v-3.08A7 7 0 0019 11h-2z"
                  />
                </svg>
              </button>
            ) : null}
          </div>

          {voice.denied ? (
            <p className="search-hero-voice-error" role="status">
              {t('search.voiceDenied')}
            </p>
          ) : null}

          {/* Filter chips — compact only. At ≥720px the desktop drawer toggle
              already owns the /Показать фильтры/ accessible name, and a second
              match there would make desktop.spec's strict locator ambiguous. */}
          {showStations && compactResults ? (
            <div
              className="search-filter-chip-row"
              role="group"
              aria-label={t('search.filtersGroup')}
              ref={filterChipRailRef}
            >
              {filterDimensions.map((dimension) =>
                dimension.value ? (
                  <button
                    key={dimension.id}
                    className="search-hero-filter-pill search-filter-chip is-active"
                    type="button"
                    onClick={dimension.clear}
                    aria-label={`${t('search.removeFilter')}: ${dimension.value}`}
                  >
                    <span>{dimension.value}</span>
                    <span className="search-hero-filter-pill-x" aria-hidden="true">
                      ✕
                    </span>
                  </button>
                ) : (
                  <button
                    key={dimension.id}
                    className="search-filter-chip"
                    type="button"
                    onClick={() => stationSearch.setFiltersOpen(true)}
                    aria-haspopup="dialog"
                    aria-expanded={stationSearch.filtersOpen}
                  >
                    {t(dimension.titleKey)}
                    <span className="search-filter-chip-caret" aria-hidden="true">
                      ⌄
                    </span>
                  </button>
                )
              )}
              {/* «Ещё» — exactly ONE .search-hero-filters-pill in the DOM, always
                  mounted so useDialog can restore focus to it after the sheet
                  closes. aria-label wins over visible text, so the compound
                  label still matches /Показать фильтры/ while satisfying WCAG
                  2.5.3 (the visible «Ещё» is contained in the accessible name). */}
              <button
                className="search-hero-filters-pill search-filter-chip"
                type="button"
                onClick={() => stationSearch.setFiltersOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={stationSearch.filtersOpen}
                aria-label={`${t('search.moreFilters')} · ${t('search.showFilters')}`}
              >
                {t('search.moreFilters')}
                <span className="search-filter-chip-caret" aria-hidden="true">
                  ⌄
                </span>
                {filterCount > 0 ? (
                  <em className="search-hero-filters-badge">{filterCount}</em>
                ) : null}
              </button>
            </div>
          ) : null}

          {!queryActive && stationSearch.recentQueries.length ? (
            <div className="search-hero-recent">
              <span className="search-hero-recent-label">{t('search.recentQueryHint')}</span>
              <div className="search-hero-recent-row">
                {/* dismissRecentQuery was exported and consumed nowhere, so a
                    remembered query could not be deleted. Wired up here. */}
                {stationSearch.recentQueries.slice(0, 6).map((recentQuery) => (
                  <span className="search-hero-recent-chip-wrap" key={`recent-query-${recentQuery}`}>
                    <button
                      className="search-hero-recent-chip"
                      type="button"
                      onClick={() => stationSearch.applyRecentQuery(recentQuery)}
                    >
                      {recentQuery}
                    </button>
                    <button
                      className="search-hero-recent-dismiss"
                      type="button"
                      onClick={() => stationSearch.dismissRecentQuery(recentQuery)}
                      aria-label={`${t('search.removeRecentQuery')}: ${recentQuery}`}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {queryActive ? (
            compactResults ? (
              // ≤720: fixed count-left / filters-pill-right row instead of the
              // wrapping chip pile; play-all becomes a full-width primary
              // button below. "Clear all" lives in the filters sheet footer.
              // The count moved to the results header (which also carries the
              // sort control), and the filters pill moved into the chip row
              // above — both are now single-instance elements. Play-all stays
              // here, still gated on an active query.
              <button
                className="search-hero-play-all-wide"
                type="button"
                onClick={startSearchRadio}
                disabled={!searchQueue.length}
              >
                ▶ {t('search.playAllResults')}
              </button>
            ) : (
              <div className="search-hero-result-bar">
                <div className="search-hero-result-count">
                  <span>
                    {t('search.resultsShown', {
                      shown: `${rankedSearchResults.length}${stationSearch.nextCursor ? '+' : ''}`,
                      total: stationSearch.searchTotal
                    })}
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

          {/* Desktop only. On compact the chip row above already renders one
              `.search-hero-filter-pill` per active filter; rendering both would
              double the pill count and break its equality with the badge. */}
          {!compactResults && queryActive && stationSearch.activeFilters.length ? (
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
                    <span className="search-rail-chip-label">
                      {item.id === 'Other' ? t('common.unknown') : item.id}
                    </span>
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
                    <span className="search-rail-chip-label">
                      {formatCountryLabel(bucket.country)}
                    </span>
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
            {/* «Найдено станций: 124» — the colon form, because t() is a plain
                {token} replace with NO pluralization; «124 станции» would be
                wrong for 121/122/125. Rendered only once a real total exists, so
                there is no «Найдено станций: 0» flash while loading. */}
            {compactResults && stationSearch.searchTotal > 0 ? (
              <header className="search-results-header">
                <p className="search-results-count">
                  {t('search.resultsFound', { total: stationSearch.searchTotal })}
                </p>
                <SearchSortMenu
                  sortMode={stationSearch.sortMode}
                  onSelect={stationSearch.setSortMode}
                  t={t}
                />
              </header>
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
                    {sortedSearchResults.map((station) => (
                      <SearchResultRow
                        key={`search-card-${station.stationuuid}`}
                        station={station}
                        stations={sortedSearchResults}
                        sourceId="search-results"
                        nowPlayingEnabled
                      />
                    ))}
                  </div>
                ) : (
                  // Desktop keeps the frozen ranking: the sort control is
                  // compact-only, so desktop order must not move (its visual
                  // baseline is an exact-match, full-page shot).
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
          <div
            className="scroll-sentinel search-scroll-sentinel"
            ref={stationSearch.sentinelRef}
            aria-hidden="true"
          />
          {stationSearch.searchLoadingMore ? (
            <div className="search-loading-more" role="status">
              {t('common.loading')}
            </div>
          ) : null}
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
      {/* Un-gated from queryActive to match the chip row: filters are reachable
          on the idle screen too (which already renders a full result grid). */}
      {stationSearch.filtersOpen && compactResults ? (
        <SearchFiltersSheet
          stationSearch={stationSearch}
          onClose={() => stationSearch.setFiltersOpen(false)}
        />
      ) : null}
    </section>
  );
};

export const Search = Discover;

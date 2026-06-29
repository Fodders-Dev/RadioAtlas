import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CollectionArtwork } from '../components/CollectionArtwork';
import { RegionArtwork } from '../components/RegionArtwork';
import { StationTable } from '../components/StationTable';
import { createLibraryDiscoveryFeed } from '../lib/discoveryFeed';
import {
  buildLibrarySearchEntries,
  filterLibraryEntries,
  type LibrarySearchSource
} from '../lib/librarySearch';
import { stationsForRegions } from '../lib/regionRecommendations';
import { shuffleStations } from '../lib/shuffleStations';
import { normalizeStationName, stationLocation } from '../lib/stationUtils';
import { useDialog } from '../lib/useDialog';
import { useMobileLayout } from '../lib/useMobileLayout';
import { useLocale } from '../state/LocaleContext';
import { useLibrary, usePlayback, useShell } from '../state/RadioContext';
import { useSession } from '../state/SessionContext';
import type { LibraryTab, StationLite } from '../types';

const TAB_ORDER = ['favorites', 'queue', 'recent', 'tracks', 'collections'] as const;
const VISIBLE_LIBRARY_TABS = new Set<LibraryTab>(TAB_ORDER);

// Per-tab glyphs (Artem ask) — inline SVG in the AppNavigation style, tinted via
// `fill: currentColor`. Favorites=heart, Queue=queue-list, Recent=clock,
// Tracks=note, Collections=stack. Keyed off TAB_ORDER so it stays exhaustive
// over exactly the visible tabs (LibraryTab also has settings/history).
const TAB_ICONS: Record<(typeof TAB_ORDER)[number], JSX.Element> = {
  favorites: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 20.7 4.2 12.9a4.6 4.6 0 0 1 6.5-6.5l1.3 1.3 1.3-1.3a4.6 4.6 0 0 1 6.5 6.5L12 20.7Z" />
    </svg>
  ),
  queue: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6h12v2H4V6Zm0 5h12v2H4v-2Zm0 5h8v2H4v-2Zm12 .5v-5l4 2.5-4 2.5Z" />
    </svg>
  ),
  recent: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm-1 3v6l5 3 1-1.7-4-2.4V7h-2Z" />
    </svg>
  ),
  tracks: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6Z" />
    </svg>
  ),
  collections: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2 1 8l11 6 11-6-11-6Zm7.5 6L12 12.2 4.5 8 12 3.8 19.5 8ZM1 16l11 6 11-6-2.1-1.15L12 19.7 3.1 14.85 1 16Zm0-4 11 6 11-6-2.1-1.15L12 15.7 3.1 10.85 1 12Z" />
    </svg>
  )
};

type LibrarySheetProps = {
  sheetId: string;
  kicker: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
};

// Mobile bottom sheet for the Library (queue history+journal / track journal /
// per-card collection actions) — the shared .bottom-sheet-card recipe with its
// own useDialog, mounted only while open. PORTALED to document.body (Globe
// lesson: .app-shell-v2{isolation:isolate} + the animated .app-screen-frame
// pin even z-130 under the fixed dock — a sibling inside the screen tree is
// not enough).
const LibrarySheet = ({ sheetId, kicker, title, onClose, children }: LibrarySheetProps) => {
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
      data-library-sheet={sheetId}
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
            <div className="bottom-sheet-kicker">{kicker}</div>
            <div className="bottom-sheet-title" id={titleId}>
              {title}
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
        {children}
      </div>
    </div>,
    document.body
  );
};

export const Library = () => {
  const {
    knownStations,
    favorites,
    recent,
    collections,
    followedStations,
    followedRegions,
    alerts,
    digests,
    notificationPreference,
    trackHistory,
    playbackHistory,
    clearFavorites,
    clearRecent,
    clearTrackHistory,
    createCollection,
    saveQueueAsCollection,
    deleteCollection,
    toggleCollectionPinned,
    renameCollection,
    moveStationInCollection,
    addStationToCollection,
    removeStationFromCollection,
    toggleFollowStation,
    toggleFollowRegion,
    markAlertRead,
    markDigestRead,
    updateNotificationPreference
  } = useLibrary();
  const { queue, player, nowPlaying, playStation, playStationQueue, playLast } = usePlayback();
  const { setActiveSection, libraryTab, setLibraryTab, setGlobeFocusRegionId, setSearchDraft } =
    useShell();
  const {
    status: sessionStatus,
    profile,
    library: cloudLibrary,
    openAccountSheet,
    setBotOptIn
  } = useSession();
  // R1 (PR-A): after toggling opt-in we learn whether the user is reachable
  // (has started the bot). If opted-in but not reachable, we point them to it.
  const [botReachable, setBotReachable] = useState<boolean | null>(null);
  const botUsername = String(import.meta.env.VITE_TG_BOT || '').trim().replace(/^@/, '');
  const handleBotOptInToggle = async () => {
    const result = await setBotOptIn(!(profile?.botOptedIn ?? false));
    setBotReachable(result.optedIn ? result.reachable : null);
  };
  const { locale, t } = useLocale();
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1024
  );
  const [collectionSort, setCollectionSort] = useState<'pinned' | 'recent' | 'name'>('pinned');
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [collectionNameDraft, setCollectionNameDraft] = useState('');
  const [collectionRenameDraft, setCollectionRenameDraft] = useState('');
  const [renamingCollectionId, setRenamingCollectionId] = useState<string | null>(null);
  const [isCreatingCollection, setIsCreatingCollection] = useState(false);
  // Inline "save current queue as a playlist" form (queue tab) — reuses the
  // create-collection inline pattern, NOT a bottom sheet.
  const [isSavingQueue, setIsSavingQueue] = useState(false);
  const [queueSaveDraft, setQueueSaveDraft] = useState('');
  const [collectionNotice, setCollectionNotice] = useState<string | null>(null);
  const [collectionReorderMode, setCollectionReorderMode] = useState(false);
  // Bottom sheets: the per-card grid collection actions (mobile «···», holds the
  // card's collection id) and the collection-detail «Ещё» overflow (rename /
  // pin / add-current / reorder / delete). Both are PHONE-only — the sheet CSS is
  // scoped to ≤720px, so on desktop the detail card renders those actions inline
  // as chips instead of opening a sheet.
  const [collectionActionsId, setCollectionActionsId] = useState<string | null>(null);
  const [detailActionsOpen, setDetailActionsOpen] = useState(false);
  // Two-tap delete confirm: the first «Удалить» tap arms this id, the second
  // («Точно удалить?») commits. Lives inline in the detail row / S3 sheet — NOT
  // a new fixed element (would hit the z-130-under-dock trap).
  const [deleteArmedCollectionId, setDeleteArmedCollectionId] = useState<string | null>(null);
  // Inline "search my library" filter (favorites + recent + collections +
  // follows). Empty query = the tabs render exactly as before.
  const [librarySearch, setLibrarySearch] = useState('');
  const librarySearchInputRef = useRef<HTMLInputElement>(null);
  const isMobileLayout = useMobileLayout();
  const collectionScrollYRef = useRef(0);
  const pendingCollectionScrollRestoreRef = useRef<number | null>(null);

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!collectionNotice) return;
    const timeout = window.setTimeout(() => setCollectionNotice(null), 2800);
    return () => window.clearTimeout(timeout);
  }, [collectionNotice]);

  // An armed delete-confirm disarms itself if the user doesn't follow through.
  useEffect(() => {
    if (!deleteArmedCollectionId) return;
    const timeout = window.setTimeout(() => setDeleteArmedCollectionId(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [deleteArmedCollectionId]);

  useEffect(() => {
    if (selectedCollectionId !== null || pendingCollectionScrollRestoreRef.current === null) return;
    const scrollY = pendingCollectionScrollRestoreRef.current;
    let innerFrame = 0;
    const outerFrame = window.requestAnimationFrame(() => {
      innerFrame = window.requestAnimationFrame(() => {
        window.scrollTo({ top: scrollY, behavior: 'auto' });
        pendingCollectionScrollRestoreRef.current = null;
      });
    });
    return () => {
      window.cancelAnimationFrame(outerFrame);
      if (innerFrame) {
        window.cancelAnimationFrame(innerFrame);
      }
    };
  }, [selectedCollectionId]);

  const compactRows = viewportWidth < 720;
  const stationMap = useMemo(
    () => new Map(knownStations.map((station) => [station.stationuuid, station])),
    [knownStations]
  );

  // "Search my library" — a pure in-memory filter over the user's own union
  // (favorites + recent + collections + follows). NOT the 57k catalog (that
  // lives on the Search screen). Filters on every keystroke (the set is small).
  const librarySearchQuery = librarySearch.trim();
  const librarySearchEntries = useMemo(
    () =>
      buildLibrarySearchEntries({ favorites, recent, collections, followedStations, stationMap }),
    [favorites, recent, collections, followedStations, stationMap]
  );
  const librarySearchResults = useMemo(
    () => filterLibraryEntries(librarySearchEntries, librarySearchQuery),
    [librarySearchEntries, librarySearchQuery]
  );
  const librarySearchStations = useMemo(
    () => librarySearchResults.map((entry) => entry.station),
    [librarySearchResults]
  );
  const librarySearchSourceLabel = (source: LibrarySearchSource) => {
    switch (source.kind) {
      case 'favorite':
        return t('library.searchResultFromFavorites');
      case 'collection':
        return t('library.searchResultFromCollection', { name: source.name });
      case 'recent':
        return t('library.searchResultFromRecent');
      case 'followed':
        return t('library.searchResultFromFollowed');
    }
  };
  const librarySearchLabelFor = useMemo(() => {
    const labels = new Map<string, string>();
    librarySearchResults.forEach((entry) =>
      labels.set(entry.station.stationuuid, librarySearchSourceLabel(entry.source))
    );
    return (stationuuid: string) => labels.get(stationuuid);
    // librarySearchSourceLabel only closes over t (stable per locale).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [librarySearchResults, t]);

  const libraryFeed = useMemo(
    () =>
      createLibraryDiscoveryFeed({
        current: player.current,
        queuePreview: queue.items.slice(Math.max(queue.currentIndex, 0), Math.max(queue.currentIndex, 0) + 4),
        recent,
        favorites,
        playbackHistory,
        trackHistory,
        collections,
        followedStations,
        followedRegions,
        alerts,
        linkedProviders: profile?.linkedProviders || [],
        libraryUpdatedAt: cloudLibrary?.updatedAt || null
      }),
    [
      alerts,
      cloudLibrary?.updatedAt,
      collections,
      favorites,
      followedRegions,
      followedStations,
      playbackHistory,
      player.current,
      profile?.linkedProviders,
      queue.currentIndex,
      queue.items,
      recent,
      trackHistory
    ]
  );

  const formatTime = (value: number) =>
    new Date(value).toLocaleString(locale, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

  const unreadAlerts = alerts.filter((alert) => alert.readAt === null);
  const sortedCollections = useMemo(() => {
    const next = [...collections];
    if (collectionSort === 'name') {
      return next.sort((left, right) => left.name.localeCompare(right.name, locale));
    }
    if (collectionSort === 'recent') {
      return next.sort((left, right) => right.updatedAt - left.updatedAt);
    }
    return next.sort(
      (left, right) =>
        Number(right.pinned) - Number(left.pinned) ||
        right.updatedAt - left.updatedAt ||
        left.name.localeCompare(right.name, locale)
    );
  }, [collectionSort, collections, locale]);
  // The S3 sheet's target card; null when closed or if the collection was
  // deleted while the sheet was up.
  const collectionActionsSheet = useMemo(
    () =>
      collectionActionsId
        ? collections.find((collection) => collection.id === collectionActionsId) ?? null
        : null,
    [collectionActionsId, collections]
  );
  const recentStations = useMemo(() => {
    const seen = new Set<string>();
    return [player.current, ...recent, ...playbackHistory.slice().reverse()]
      .filter((station): station is StationLite => Boolean(station))
      .filter((station) => {
        if (seen.has(station.stationuuid)) return false;
        seen.add(station.stationuuid);
        return true;
      });
  }, [playbackHistory, player.current, recent]);
  const selectedCollection =
    selectedCollectionId ? collections.find((collection) => collection.id === selectedCollectionId) || null : null;
  const selectedCollectionStations = useMemo(() => {
    if (!selectedCollection) return [];
    return selectedCollection.stationIds
      .map((stationId) => stationMap.get(stationId))
      .filter(Boolean) as StationLite[];
  }, [selectedCollection, stationMap]);
  const followedStationRows = useMemo(
    () =>
      libraryFeed.followedStationsPreview.map((follow) => {
        const station = stationMap.get(follow.stationId) || null;
        const fallbackStation: StationLite =
          station || {
            stationuuid: follow.stationId,
            name: follow.stationName,
            url_resolved: '',
            homepage: '',
            favicon: '',
            tags: '',
            country: follow.country,
            state: '',
            geo_lat: null,
            geo_long: null
          };
        return {
          follow,
          station,
          fallbackStation
        };
      }),
    [libraryFeed.followedStationsPreview, stationMap]
  );
  const activeLibraryTab = VISIBLE_LIBRARY_TABS.has(libraryTab) ? libraryTab : 'recent';
  const tabCounts: Record<LibraryTab, number> = {
    favorites: favorites.length,
    tracks: trackHistory.length,
    queue: queue.items.length,
    recent: recentStations.length,
    history: playbackHistory.length,
    collections: collections.length,
    settings: 0
  };
  const returnToAirStations = libraryFeed.returnToAir;

  const beginCreateCollection = () => {
    setCollectionNameDraft('');
    setIsCreatingCollection(true);
  };
  const cancelCreateCollection = () => {
    setCollectionNameDraft('');
    setIsCreatingCollection(false);
  };
  const saveCollection = () => {
    const name = collectionNameDraft.trim();
    if (!name) return;
    createCollection(name);
    setCollectionNotice(t('library.collectionCreated', { name }));
    cancelCreateCollection();
  };
  const beginSaveQueue = () => {
    const defaultName = t('library.saveQueuePrompt', {
      date: new Date().toLocaleDateString(locale, { day: '2-digit', month: 'short' })
    });
    setQueueSaveDraft(defaultName.slice(0, 48));
    setIsSavingQueue(true);
  };
  const cancelSaveQueue = () => {
    setQueueSaveDraft('');
    setIsSavingQueue(false);
  };
  const saveQueueNow = () => {
    const name = queueSaveDraft.trim();
    if (!name || !queue.items.length) return;
    // Pure data-op: snapshots the queue into a new playlist (stations cached so
    // they resolve) and leaves playback untouched.
    saveQueueAsCollection(name);
    setCollectionNotice(t('library.queueSavedAsPlaylist', { name }));
    cancelSaveQueue();
  };
  const openCollectionDetail = (collectionId: string) => {
    collectionScrollYRef.current = typeof window !== 'undefined' ? window.scrollY : 0;
    setCollectionReorderMode(false);
    setRenamingCollectionId(null);
    setDetailActionsOpen(false);
    setSelectedCollectionId(collectionId);
  };
  const closeCollectionDetail = () => {
    pendingCollectionScrollRestoreRef.current = collectionScrollYRef.current;
    setSelectedCollectionId(null);
    setCollectionReorderMode(false);
    setRenamingCollectionId(null);
    setDetailActionsOpen(false);
  };
  const addCurrentToCollection = (collectionId: string, collectionName: string) => {
    if (!player.current) return;
    addStationToCollection(collectionId, player.current);
    setCollectionNotice(
      t('library.collectionAdded', {
        station: player.current.name,
        collection: collectionName
      })
    );
  };
  const openFollowedRegion = (regionId: string) => {
    setGlobeFocusRegionId(regionId);
    setActiveSection('globe');
  };
  const resolveCollectionStations = (collection: (typeof collections)[number]) =>
    collection.stationIds
      .map((stationId) => stationMap.get(stationId))
      .filter(Boolean) as StationLite[];
  const playCollection = (collection: (typeof collections)[number], shuffle = false) => {
    const collectionStations = resolveCollectionStations(collection);
    if (!collectionStations.length) return;
    playStationQueue(shuffle ? shuffleStations(collectionStations) : collectionStations, {
      sourceId: `collection-${collection.id}`,
      sourceLabel: collection.name
    });
  };
  const playFollowedRegion = (region: (typeof followedRegions)[number]) => {
    const regionStations = stationsForRegions(knownStations, [region], 16);
    if (!regionStations.length) return;
    playStationQueue(regionStations, {
      sourceId: `region-${region.id}`,
      sourceLabel: region.label
    });
  };
  const playDigest = (digest: (typeof digests)[number]) => {
    const digestStations = digest.stationIds
      .map((stationId) => stationMap.get(stationId))
      .filter(Boolean) as StationLite[];
    if (!digestStations.length) return;
    playStationQueue(digestStations, {
      sourceId: `digest-${digest.kind}`,
      sourceLabel: digest.title
    });
  };
  const beginRenameCollection = (collection: (typeof collections)[number]) => {
    setCollectionRenameDraft(collection.name);
    setRenamingCollectionId(collection.id);
  };
  const cancelRenameCollection = () => {
    setCollectionRenameDraft('');
    setRenamingCollectionId(null);
  };
  const saveCollectionRename = (collectionId: string) => {
    const name = collectionRenameDraft.trim();
    if (!name) return;
    renameCollection(collectionId, name);
    setCollectionNotice(t('library.collectionRenamed', { name }));
    cancelRenameCollection();
  };
  // First tap arms the inline confirm; the second tap (while armed) commits.
  const requestDeleteCollection = (collection: (typeof collections)[number]) => {
    if (deleteArmedCollectionId !== collection.id) {
      setDeleteArmedCollectionId(collection.id);
      return;
    }
    const wasOpen = selectedCollectionId === collection.id;
    deleteCollection(collection.id);
    // Clear every transient that points at the now-gone collection, or the
    // detail / sheet would render against a missing id.
    setDeleteArmedCollectionId(null);
    setCollectionActionsId(null);
    setDetailActionsOpen(false);
    setRenamingCollectionId(null);
    setCollectionRenameDraft('');
    setCollectionReorderMode(false);
    if (wasOpen) {
      closeCollectionDetail();
    }
    setCollectionNotice(t('library.collectionDeleted', { name: collection.name }));
  };
  // Rename from the «···» sheet: open the detail already in rename mode.
  const renameCollectionFromSheet = (collection: (typeof collections)[number]) => {
    setCollectionActionsId(null);
    setDeleteArmedCollectionId(null);
    openCollectionDetail(collection.id);
    beginRenameCollection(collection);
  };
  const addStationsToCollection = () => {
    setActiveSection('search');
  };
  const queueLeadStation =
    player.current ??
    (queue.currentIndex >= 0 ? queue.items[queue.currentIndex] : null) ??
    queue.items[0] ??
    null;
  const queueSourceLabel = queue.sourceLabel || t('radio.queueDefault');
  const recentSessionPreview = recentStations.slice(0, 4);
  const trackJournalPreview = trackHistory.slice(0, 4);
  const playHistoryStation = (station: StationLite) => {
    playStation(station, {
      playlist: recentStations.length ? recentStations : [station],
      sourceId: 'recent',
      sourceLabel: t('playlist.historyTitle')
    });
  };

  // Full copied-track journal entries — rendered only in the «Треки» tab now
  // (the recent-tab inline panel and its bottom sheet were removed).
  const renderTrackJournalEntries = () =>
    trackHistory.map((item) => (
      <div key={item.id} className="track-card">
        <div className="track-card-copy">
          <div className="track-title">{item.track}</div>
          <div className="track-meta">
            {item.stationName} · {formatTime(item.timestamp)}
          </div>
        </div>
        <button
          className="chip"
          type="button"
          onClick={() => navigator.clipboard.writeText(item.track)}
        >
          {t('common.copy')}
        </button>
      </div>
    ));

  // Queue rail content (station history + track journal previews) — shared
  // verbatim by the desktop side column and the mobile S1 bottom sheet.
  const renderQueueRailCards = () => (
    <>
      <div className="glass-card library-queue-side-card">
        <div className="section-title">{t('playlist.historyTitle')}</div>
        <div className="section-subtitle">{t('library.stationHistory')}</div>
        {recentSessionPreview.length ? (
          <div className="playlist-history-list">
            {recentSessionPreview.map((station) => (
              <button
                key={`${station.stationuuid}-${station.name}`}
                className="playlist-history-item library-history-button"
                type="button"
                onClick={() => playHistoryStation(station)}
              >
                <div className="playlist-history-name">{normalizeStationName(station.name)}</div>
                <div className="playlist-history-meta">{stationLocation(station)}</div>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-state">{t('playlist.historyEmpty')}</div>
        )}
      </div>

      <div className="glass-card library-queue-side-card">
        <div className="section-title">{t('favoritesScreen.journalTitle')}</div>
        <div className="section-subtitle">{t('library.trackJournalCollapsed')}</div>
        {trackJournalPreview.length ? (
          <div className="track-list">
            {trackJournalPreview.map((item) => (
              <div key={item.id} className="track-card">
                <div className="track-card-copy">
                  <div className="track-title">{item.track}</div>
                  <div className="track-meta">{item.stationName}</div>
                </div>
                <button
                  className="chip"
                  type="button"
                  onClick={() => navigator.clipboard.writeText(item.track)}
                >
                  {t('common.copy')}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">{t('favoritesScreen.journalEmpty')}</div>
        )}
      </div>
    </>
  );

  const renderCollectionStations = (collection: (typeof collections)[number]) => {
    const collectionStations = resolveCollectionStations(collection);

    if (!collectionStations.length) {
      return (
        <div className="empty-state library-empty-state">
          <div className="section-subtitle">{t('library.collectionEmpty')}</div>
          <div className="hero-chip-row">
            <button className="chip active" type="button" onClick={addStationsToCollection}>
              {t('library.addStationsToCollection')}
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="library-collection-preview">
        <StationTable
          stations={collectionStations.slice(0, compactRows ? 3 : 4)}
          compact
          sourceId={`collection-${collection.id}`}
        />
      </div>
    );
  };

  return (
    <section className="screen screen-library-v2">
      <div className="library-search-bar">
        <span className="library-search-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M10.5 4a6.5 6.5 0 1 0 4.05 11.58l4.44 4.44 1.41-1.41-4.44-4.44A6.5 6.5 0 0 0 10.5 4Zm0 2a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Z" />
          </svg>
        </span>
        <input
          ref={librarySearchInputRef}
          className="library-search-input"
          type="search"
          inputMode="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          placeholder={t('library.searchPlaceholder')}
          aria-label={t('library.searchPlaceholder')}
          value={librarySearch}
          onChange={(event) => setLibrarySearch(event.target.value)}
        />
        {librarySearch ? (
          <button
            type="button"
            className="library-search-clear"
            aria-label={t('library.searchClear')}
            onClick={() => {
              setLibrarySearch('');
              librarySearchInputRef.current?.focus();
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6 6.4 5Z" />
            </svg>
          </button>
        ) : null}
      </div>

      {librarySearchQuery ? (
        <div
          className="glass-card library-search-results"
          role="region"
          aria-label={t('library.searchResults')}
        >
          {!librarySearchEntries.length ? (
            <div className="empty-state library-empty-state">
              <div className="library-empty-title">{t('library.searchEmptyLibrary')}</div>
            </div>
          ) : librarySearchResults.length ? (
            <>
              <div className="library-search-result-bar">
                <span aria-live="polite">
                  {t('library.searchResultCount', { count: librarySearchResults.length })}
                </span>
              </div>
              <StationTable
                stations={librarySearchStations}
                compact={compactRows}
                sourceId="library-search"
                sourceLabelFor={librarySearchLabelFor}
                nowPlayingMode="viewport"
              />
            </>
          ) : (
            <div className="empty-state library-empty-state" aria-live="polite">
              <div className="library-empty-title">
                {t('library.searchNoResults', { query: librarySearchQuery })}
              </div>
              <div className="hero-chip-row">
                <button
                  className="chip active"
                  type="button"
                  onClick={() => {
                    setSearchDraft(librarySearchQuery);
                    setActiveSection('search');
                  }}
                >
                  {t('library.searchInCatalog')}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
      <div className="library-tab-strip" role="tablist" aria-label={t('library.title')}>
        {TAB_ORDER.map((tab) => (
          <button
            key={tab}
            className={`chip library-tab-chip ${activeLibraryTab === tab ? 'active' : ''}`}
            type="button"
            onClick={() => setLibraryTab(tab)}
          >
            <span className="library-tab-icon" aria-hidden="true">{TAB_ICONS[tab]}</span>
            <span className="library-tab-label">{t(`library.tabs.${tab}`)}</span>
            <strong className="library-tab-count">{tabCounts[tab]}</strong>
          </button>
        ))}
      </div>

      {activeLibraryTab === 'favorites' ? (
        <div className="glass-card">
          {/* The tab strip already names this surface — no duplicate title, just
              the compact Clear action (unified .library-tab-toolbar rhythm). */}
          <div className="library-tab-toolbar">
            <span className="library-tab-toolbar-lead" />
            <button className="chip" type="button" onClick={clearFavorites} disabled={!favorites.length}>
              {t('settings.clearFavorites')}
            </button>
          </div>
          {favorites.length ? (
            <StationTable
              stations={favorites}
              compact={compactRows}
              sourceId="favorites"
              nowPlayingMode="viewport"
            />
          ) : (
            <div className="empty-state library-empty-state">
              <div className="library-empty-title">{t('library.emptyFavoritesTitle')}</div>
              <div className="section-subtitle">{t('library.emptyFavoritesCopy')}</div>
              <div className="hero-chip-row">
                <button className="chip active" type="button" onClick={() => setActiveSection('search')}>
                  {t('home.openSearch')}
                </button>
                <button className="chip" type="button" onClick={() => setActiveSection('globe')}>
                  {t('home.openGlobe')}
                </button>
              </div>
              {sessionStatus !== 'authenticated' ? (
                <button className="chip active" type="button" onClick={openAccountSheet}>
                  {t('account.signInAndSync')}
                </button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {activeLibraryTab === 'queue' ? (
        <div className="glass-card library-queue-shell">
          <div className="library-section-head">
            <div>
              <div className="section-title">{t('playlist.title')}</div>
              <div className="section-subtitle">{queueSourceLabel}</div>
            </div>
          </div>
          {isSavingQueue ? (
            <form
              className="library-create-collection-row library-save-queue-row"
              onSubmit={(event) => {
                event.preventDefault();
                saveQueueNow();
              }}
            >
              <input
                value={queueSaveDraft}
                onChange={(event) => setQueueSaveDraft(event.target.value)}
                placeholder={t('library.createCollectionPrompt')}
                aria-label={t('library.saveQueueAsPlaylist')}
                autoFocus
              />
              <button className="chip active" type="submit" disabled={!queueSaveDraft.trim()}>
                {t('common.save')}
              </button>
              <button className="chip" type="button" onClick={cancelSaveQueue}>
                {t('common.cancel')}
              </button>
            </form>
          ) : null}
          {queue.items.length ? (
            <div className="library-queue-layout">
              <div className="library-queue-main">
                <div className="library-queue-now-card">
                  <div className="shell-kicker">{player.current ? t('dock.liveNow') : t('common.resume')}</div>
                  <div className="section-title">
                    {normalizeStationName(queueLeadStation?.name) || t('library.returnToAirEmptyTitle')}
                  </div>
                  <div className="section-subtitle">
                    {nowPlaying?.trim() ||
                      (queueLeadStation ? stationLocation(queueLeadStation) : t('playlist.empty'))}
                  </div>
                  <div className="hero-chip-row library-queue-hero-actions">
                    <button
                      className="chip active library-queue-hero-play"
                      type="button"
                      onClick={() => {
                        if (queueLeadStation) {
                          playStation(queueLeadStation, {
                            playlist: queue.items.length ? queue.items : [queueLeadStation],
                            sourceId: queue.sourceId || 'queue',
                            sourceLabel: queueSourceLabel
                          });
                        }
                      }}
                      disabled={!queueLeadStation}
                    >
                      {player.current && player.isPlaying ? t('playlist.playing') : t('common.play')}
                    </button>
                  </div>
                </div>

                <div className="chip-row library-queue-actions">
                  <button
                    className="chip"
                    type="button"
                    onClick={() => queue.shuffleQueue()}
                    disabled={queue.items.length <= 1}
                    aria-label={t('library.shuffleQueueAria')}
                  >
                    {t('library.shuffleQueue')}
                  </button>
                  <button className="chip" type="button" onClick={beginSaveQueue} disabled={!queue.items.length}>
                    {t('library.saveQueueAsPlaylist')}
                  </button>
                  <button className="chip" type="button" onClick={() => queue.clearQueue()} disabled={!queue.items.length}>
                    {t('playlist.clearQueue')}
                  </button>
                </div>

                <div className="playlist-list library-queue-list">
                  {queue.items.map((station, index) => {
                    const active =
                      index === queue.currentIndex && player.current?.stationuuid === station.stationuuid;
                    const nextUp = !active && index === Math.max(queue.currentIndex, 0) + 1;
                    return (
                      <div key={station.stationuuid} className={`playlist-row ${active ? 'active' : ''}`}>
                        <div className="playlist-order">{index + 1}</div>
                        <div className="playlist-body library-queue-row-copy">
                          <div className="library-queue-row-head">
                            <div className="playlist-name">{normalizeStationName(station.name)}</div>
                            {active ? (
                              <span className="library-status-pill active">{t('playlist.playing')}</span>
                            ) : nextUp ? (
                              <span className="library-status-pill">{t('common.next')}</span>
                            ) : null}
                          </div>
                          <div className="playlist-meta">{stationLocation(station)}</div>
                        </div>
                        <div className="playlist-actions">
                          <button className="chip" type="button" onClick={() => queue.playAtIndex(index)}>
                            {active && player.isPlaying ? t('playlist.playing') : t('common.play')}
                          </button>
                          <button className="chip" type="button" onClick={() => queue.removeAtIndex(index)}>
                            {t('common.remove')}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Desktop side column only. ≤720px the same context lives in
                  dedicated tabs now — station history in «Недавнее», the copied
                  track journal in «Треки» — so the queue tab stays a clean
                  hero + actions + list with no extra rail/sheet. */}
              {!isMobileLayout ? (
                <div className="library-queue-rail">{renderQueueRailCards()}</div>
              ) : null}
            </div>
          ) : (
            <div className="empty-state library-empty-state library-queue-empty-state">
              <div className="library-empty-title">{t('library.emptyQueueTitle')}</div>
              <div className="section-subtitle">{t('playlist.empty')}</div>
              <div className="hero-chip-row">
                <button className="chip active" type="button" onClick={() => setActiveSection('search')}>
                  {t('home.openSearch')}
                </button>
                <button className="chip" type="button" onClick={() => setActiveSection('globe')}>
                  {t('home.openGlobe')}
                </button>
                <button
                  className="chip"
                  type="button"
                  onClick={playLast}
                disabled={!returnToAirStations.length && !recentStations.length && !player.current}
                >
                  {t('common.resume')}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {activeLibraryTab === 'recent' ? (
        <div className="glass-card">
          {/* Curated: «Недавнее» is recent STATIONS only now — the copied-track
              journal lives solely in «Треки». Unified toolbar (subtitle + Clear). */}
          <div className="library-tab-toolbar">
            <div className="section-subtitle">{t('explore.recentSubtitle')}</div>
            <button className="chip" type="button" onClick={clearRecent} disabled={!recent.length}>
              {t('settings.clearRecent')}
            </button>
          </div>
          {recentStations.length ? (
            <StationTable
              stations={recentStations}
              compact={compactRows}
              sourceId="recent"
              nowPlayingMode="viewport"
            />
          ) : (
            <div className="empty-state library-empty-state">
              <div className="library-empty-title">{t('explore.recentTitle')}</div>
              <div className="section-subtitle">{t('explore.recentEmpty')}</div>
              <div className="hero-chip-row">
                <button className="chip active" type="button" onClick={() => setActiveSection('search')}>
                  {t('home.openSearch')}
                </button>
                <button className="chip" type="button" onClick={() => setActiveSection('home')}>
                  {t('nav.home')}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {activeLibraryTab === 'tracks' ? (
        <div className="glass-card">
          {/* Unified toolbar (subtitle + Clear) — the tab strip already labels
              this «Треки», so no duplicate section title. */}
          <div className="library-tab-toolbar">
            <div className="section-subtitle">{t('library.tracksSubtitle')}</div>
            <button
              className="chip"
              type="button"
              onClick={clearTrackHistory}
              disabled={!trackHistory.length}
            >
              {t('common.clear')}
            </button>
          </div>
          {trackHistory.length ? (
            <div className="track-list track-list-scroll">{renderTrackJournalEntries()}</div>
          ) : (
            <div className="empty-state library-empty-state">
              <div className="library-empty-title">{t('favoritesScreen.journalEmpty')}</div>
              <div className="section-subtitle">{t('library.tracksEmptyHint')}</div>
            </div>
          )}
        </div>
      ) : null}

      {activeLibraryTab === 'collections' ? (
        <div className="library-collections-stack">
          {collectionNotice ? (
            <div className="library-inline-toast" role="status">
              {collectionNotice}
            </div>
          ) : null}

          {selectedCollection ? (
            <div className="glass-card library-collection-detail" data-library-collection-detail>
              <div className="library-section-head">
                <div className="library-collection-detail-title">
                  <CollectionArtwork label={selectedCollection.name} stations={selectedCollectionStations} />
                  <div>
                  <button className="chip" type="button" onClick={closeCollectionDetail}>
                    {t('common.back')}
                  </button>
                  {renamingCollectionId === selectedCollection.id ? (
                    <form
                      className="library-rename-collection-row"
                      onSubmit={(event) => {
                        event.preventDefault();
                        saveCollectionRename(selectedCollection.id);
                      }}
                    >
                      <input
                        value={collectionRenameDraft}
                        onChange={(event) => setCollectionRenameDraft(event.target.value)}
                        placeholder={t('library.renameCollectionPrompt')}
                        aria-label={t('library.renameCollectionPrompt')}
                        autoFocus
                      />
                      <button className="chip active" type="submit" disabled={!collectionRenameDraft.trim()}>
                        {t('common.save')}
                      </button>
                      <button className="chip" type="button" onClick={cancelRenameCollection}>
                        {t('common.cancel')}
                      </button>
                    </form>
                  ) : (
                    <>
                      <div className="section-title">{selectedCollection.name}</div>
                      <div className="section-subtitle">
                        {t('library.collectionCount', { count: selectedCollection.stationIds.length })}
                      </div>
                    </>
                  )}
                  </div>
                </div>
                {/* Decluttered: ONE primary action (Слушать) + one secondary
                    (Вперемешку) + «Ещё» → detail-actions sheet (rename / pin /
                    add-current / reorder / delete). Reorder mode collapses the
                    row to a single «Готово» so the list is the focus. */}
                <div className="chip-row library-collection-detail-actions">
                  {collectionReorderMode ? (
                    <button
                      className="chip active"
                      type="button"
                      onClick={() => setCollectionReorderMode(false)}
                    >
                      {t('library.reorderDone')}
                    </button>
                  ) : (
                    <>
                      <button
                        className="chip active library-collection-detail-play"
                        type="button"
                        onClick={() => playCollection(selectedCollection)}
                        disabled={!selectedCollectionStations.length}
                      >
                        {t('library.playCollection')}
                      </button>
                      <button
                        className="chip"
                        type="button"
                        onClick={() => playCollection(selectedCollection, true)}
                        disabled={!selectedCollectionStations.length}
                      >
                        {t('library.shuffleCollection')}
                      </button>
                      {/* Mobile collapses the rest into «Ещё» → a bottom sheet; the
                          sheet's CSS is phone-only, so on desktop (>720px, where there
                          is room) render the same actions INLINE as chips instead —
                          otherwise the ungated sheet rendered unstyled and inerted the
                          whole app. */}
                      {isMobileLayout ? (
                        <button
                          className="chip"
                          type="button"
                          onClick={() => setDetailActionsOpen(true)}
                        >
                          {t('library.more')}
                        </button>
                      ) : (
                        <>
                          <button
                            className="chip"
                            type="button"
                            onClick={() => beginRenameCollection(selectedCollection)}
                          >
                            {t('library.renameCollection')}
                          </button>
                          <button
                            className={`chip ${selectedCollection.pinned ? 'active' : ''}`}
                            type="button"
                            onClick={() => toggleCollectionPinned(selectedCollection.id)}
                          >
                            {selectedCollection.pinned
                              ? t('library.unpinCollection')
                              : t('library.pinCollection')}
                          </button>
                          {player.current ? (
                            <button
                              className="chip"
                              type="button"
                              onClick={() =>
                                addCurrentToCollection(
                                  selectedCollection.id,
                                  selectedCollection.name
                                )
                              }
                            >
                              {t('library.addCurrentToCollection')}
                            </button>
                          ) : null}
                          <button
                            className={`chip ${collectionReorderMode ? 'active' : ''}`}
                            type="button"
                            onClick={() => setCollectionReorderMode((value) => !value)}
                          >
                            {collectionReorderMode
                              ? t('library.reorderDone')
                              : t('library.reorderMode')}
                          </button>
                          <button
                            className={`chip library-delete-chip ${
                              deleteArmedCollectionId === selectedCollection.id ? 'is-armed' : ''
                            }`}
                            type="button"
                            onClick={() => requestDeleteCollection(selectedCollection)}
                          >
                            {deleteArmedCollectionId === selectedCollection.id
                              ? t('library.deleteCollectionConfirm')
                              : t('library.deleteCollection')}
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>

              {selectedCollectionStations.length ? (
                <div className="library-detail-station-list">
                  {selectedCollectionStations.map((station, index) => (
                    <div
                      key={`${selectedCollection.id}-${station.stationuuid}`}
                      className="playlist-row library-detail-station-row"
                      data-library-collection-row
                      data-station-id={station.stationuuid}
                    >
                      <div className="playlist-order">{index + 1}</div>
                      <div className="playlist-body">
                        <div className="playlist-name">{normalizeStationName(station.name)}</div>
                        <div className="playlist-meta">{stationLocation(station)}</div>
                      </div>
                      <div className="playlist-actions">
                        <button
                          className="chip active"
                          type="button"
                          onClick={() =>
                            playStation(station, {
                              playlist: selectedCollectionStations,
                              sourceId: `collection-${selectedCollection.id}`,
                              sourceLabel: selectedCollection.name
                            })
                          }
                        >
                          {t('common.play')}
                        </button>
                        <button
                          className="chip"
                          type="button"
                          aria-label={t('library.removeStationFromCollection', {
                            station: normalizeStationName(station.name)
                          })}
                          onClick={() => removeStationFromCollection(selectedCollection.id, station.stationuuid)}
                        >
                          {t('common.remove')}
                        </button>
                        {collectionReorderMode ? (
                          <>
                            <button
                              className="chip"
                              type="button"
                              onClick={() => moveStationInCollection(selectedCollection.id, station.stationuuid, -1)}
                              disabled={index === 0}
                              aria-label={t('library.moveStationUp', {
                                station: normalizeStationName(station.name)
                              })}
                            >
                              {t('library.moveUp')}
                            </button>
                            <button
                              className="chip"
                              type="button"
                              onClick={() => moveStationInCollection(selectedCollection.id, station.stationuuid, 1)}
                              disabled={index === selectedCollectionStations.length - 1}
                              aria-label={t('library.moveStationDown', {
                                station: normalizeStationName(station.name)
                              })}
                            >
                              {t('library.moveDown')}
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state library-empty-state">
                  <div className="section-subtitle">{t('library.collectionEmpty')}</div>
                  <div className="hero-chip-row">
                    <button className="chip active" type="button" onClick={addStationsToCollection}>
                      {t('library.addStationsToCollection')}
                    </button>
                    {player.current ? (
                      <button
                        className="chip"
                        type="button"
                        onClick={() => addCurrentToCollection(selectedCollection.id, selectedCollection.name)}
                      >
                        {t('library.addCurrentToCollection')}
                      </button>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          ) : (
          <div className="glass-card">
            <div className="library-section-head">
              <div>
                <div className="section-title">{t('library.collectionsTitle')}</div>
                <div className="section-subtitle">{t('library.collectionsCopy')}</div>
              </div>
              <div className="chip-row">
                <button
                  className={`chip ${collectionSort === 'pinned' ? 'active' : ''}`}
                  type="button"
                  onClick={() => setCollectionSort('pinned')}
                >
                  {t('library.sortPinned')}
                </button>
                <button
                  className={`chip ${collectionSort === 'recent' ? 'active' : ''}`}
                  type="button"
                  onClick={() => setCollectionSort('recent')}
                >
                  {t('library.sortRecent')}
                </button>
                <button
                  className={`chip ${collectionSort === 'name' ? 'active' : ''}`}
                  type="button"
                  onClick={() => setCollectionSort('name')}
                >
                  {t('library.sortName')}
                </button>
                <button className="chip active" type="button" onClick={beginCreateCollection}>
                  {t('library.createCollection')}
                </button>
              </div>
            </div>
            {isCreatingCollection ? (
              <form
                className="library-create-collection-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveCollection();
                }}
              >
                <input
                  value={collectionNameDraft}
                  onChange={(event) => setCollectionNameDraft(event.target.value)}
                  placeholder={t('library.createCollectionPrompt')}
                  aria-label={t('library.createCollectionPrompt')}
                  autoFocus
                />
                <button className="chip active" type="submit" disabled={!collectionNameDraft.trim()}>
                  {t('common.save')}
                </button>
                <button className="chip" type="button" onClick={cancelCreateCollection}>
                  {t('common.cancel')}
                </button>
              </form>
            ) : null}
            <div className="library-collection-grid">
              {sortedCollections.length ? (
                sortedCollections.map((collection) => {
                  const collectionStations = resolveCollectionStations(collection);
                  return (
                  <div key={collection.id} className="library-collection-card">
                    <div className="library-collection-head">
                      <button
                        className="library-collection-title-button"
                        type="button"
                        onClick={() => openCollectionDetail(collection.id)}
                      >
                        <CollectionArtwork label={collection.name} stations={collectionStations} />
                        <div>
                          <div className="section-title">{collection.name}</div>
                          <div className="section-subtitle">
                            {t('library.collectionCount', { count: collection.stationIds.length })}
                          </div>
                        </div>
                      </button>
                      {/* Identical primary actions on BOTH layouts: Play +
                          Shuffle + «···». The title button opens the detail
                          (full action set); «···» opens the S3 sheet (same
                          actions). */}
                      <div className="chip-row library-collection-card-actions">
                        <button
                          className="chip active"
                          type="button"
                          onClick={() => playCollection(collection)}
                          disabled={!collection.stationIds.length}
                        >
                          {t('library.playCollection')}
                        </button>
                        <button
                          className="chip"
                          type="button"
                          onClick={() => playCollection(collection, true)}
                          disabled={!collection.stationIds.length}
                        >
                          {t('library.shuffleCollection')}
                        </button>
                        <button
                          className="chip library-collection-more"
                          type="button"
                          // Same overflow on both layouts, reaching the same
                          // action set: the S3 sheet on mobile, the detail
                          // chip-row on desktop (the bottom sheet is a mobile
                          // idiom; both surfaces carry Rename/Pin/Add/Delete).
                          onClick={() =>
                            isMobileLayout
                              ? setCollectionActionsId(collection.id)
                              : openCollectionDetail(collection.id)
                          }
                          aria-label={`${t('common.actions')}: ${collection.name}`}
                        >
                          ···
                        </button>
                      </div>
                    </div>
                    {renderCollectionStations(collection)}
                    {collection.stationIds.length ? (
                      <div className="library-collection-footer">
                        <button className="chip" type="button" onClick={() => openCollectionDetail(collection.id)}>
                          {t('library.seeAllStations')}
                        </button>
                        <span>{t('library.collectionOpenHint')}</span>
                      </div>
                    ) : null}
                  </div>
                  );
                })
              ) : (
                <div className="empty-state library-empty-state">
                  <div className="library-empty-title">{t('library.collectionsEmptyTitle')}</div>
                  <div className="section-subtitle">{t('library.collectionsEmptyCopy')}</div>
                  <div className="hero-chip-row">
                    <button className="chip active" type="button" onClick={beginCreateCollection}>
                      {t('library.createCollection')}
                    </button>
                    <button className="chip" type="button" onClick={() => setActiveSection('search')}>
                      {t('home.openSearch')}
                    </button>
                    <button className="chip" type="button" onClick={() => setActiveSection('globe')}>
                      {t('home.openGlobe')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          )}

          <div className="library-history-grid">
            <div className="glass-card">
              <div className="section-title">{t('library.followedStationsTitle')}</div>
              <div className="section-subtitle">{t('library.followedStationsCopy')}</div>
              {followedStationRows.length ? (
                <div className="playlist-history-list">
                  {followedStationRows.map(({ follow, station, fallbackStation }) => (
                    <div key={follow.stationId} className="playlist-history-item library-follow-row">
                      <div className="playlist-history-name">{follow.stationName}</div>
                      <div className="playlist-history-meta">{follow.country}</div>
                      <div className="chip-row library-follow-actions">
                        <button
                          className="chip active"
                          type="button"
                          disabled={!station}
                          onClick={() =>
                            station
                              ? playStation(station, {
                                  playlist: followedStationRows
                                    .map((row) => row.station)
                                    .filter(Boolean) as StationLite[],
                                  sourceId: 'followed-stations',
                                  sourceLabel: t('library.followedStationsTitle')
                                })
                              : undefined
                          }
                        >
                          {t('common.play')}
                        </button>
                        <button
                          className="chip"
                          type="button"
                          onClick={() => toggleFollowStation(fallbackStation)}
                        >
                          {t('library.unfollow')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">{t('library.followedStationsEmpty')}</div>
              )}
            </div>

            <div className="glass-card">
              <div className="section-title">{t('library.followedRegionsTitle')}</div>
              <div className="section-subtitle">{t('library.followedRegionsCopy')}</div>
              {libraryFeed.followedRegionsPreview.length ? (
                <div className="playlist-history-list">
                  {libraryFeed.followedRegionsPreview.map((region) => (
                    <div key={region.id} className="playlist-history-item library-follow-row">
                      <div className="library-follow-main">
                        <RegionArtwork region={region} />
                        <div>
                          <div className="playlist-history-name">{region.label}</div>
                          <div className="playlist-history-meta">{region.scope}</div>
                        </div>
                      </div>
                      <div className="chip-row library-follow-actions">
                        <button
                          className="chip active"
                          type="button"
                          onClick={() => playFollowedRegion(region)}
                          disabled={!stationsForRegions(knownStations, [region], 1).length}
                        >
                          {t('common.play')}
                        </button>
                        <button className="chip active" type="button" onClick={() => openFollowedRegion(region.id)}>
                          {t('library.openRegion')}
                        </button>
                        <button className="chip" type="button" onClick={() => toggleFollowRegion(region)}>
                          {t('library.unfollow')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">{t('library.followedRegionsEmpty')}</div>
              )}
            </div>
          </div>

          <div className="glass-card">
            <div className="library-section-head">
              <div>
                <div className="section-title">{t('library.alertsTitle')}</div>
                <div className="section-subtitle">{t('library.alertsCopy')}</div>
              </div>
              <div className="chip-row">
                <button
                  className={`chip ${notificationPreference.inAppAlerts ? 'active' : ''}`}
                  type="button"
                  onClick={() =>
                    updateNotificationPreference({
                      inAppAlerts: !notificationPreference.inAppAlerts
                    })
                  }
                >
                  {notificationPreference.inAppAlerts
                    ? t('library.alertsEnabled')
                    : t('library.alertsDisabled')}
                </button>
                <button
                  className={`chip ${profile?.botOptedIn ? 'active' : ''}`}
                  type="button"
                  disabled={!profile}
                  onClick={() => void handleBotOptInToggle()}
                >
                  {profile?.botOptedIn ? t('library.botOptedIn') : t('library.botOptIn')}
                </button>
                {/* R1 (PR-A): opted-in but the bot can't DM yet (never /start-ed) →
                    point the user at the bot. No message is sent until PR-B. */}
                {profile?.botOptedIn && botReachable === false && botUsername ? (
                  <a
                    className="chip"
                    href={`https://t.me/${botUsername}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t('library.botStartHint')}
                  </a>
                ) : null}
                <div className={`globe-selection-pill ${unreadAlerts.length ? 'active' : ''}`}>
                  <span>{t('library.alertsUnread')}</span>
                  <strong>{libraryFeed.unreadAlerts}</strong>
                </div>
              </div>
            </div>
            {digests.length ? (
              <div className="track-list track-list-scroll library-digest-list">
                {digests.slice(0, 4).map((digest) => (
                  <div key={digest.id} className={`track-card ${digest.readAt ? '' : 'active'}`}>
                    <div className="track-card-copy">
                      <div className="track-title">{digest.title}</div>
                      <div className="track-meta">{digest.body}</div>
                    </div>
                    <div className="chip-row">
                      <button
                        className="chip active"
                        type="button"
                        onClick={() => playDigest(digest)}
                        disabled={!digest.stationIds.some((stationId) => stationMap.has(stationId))}
                      >
                        {t('library.digestPlay')}
                      </button>
                      <button className="chip" type="button" onClick={() => markDigestRead(digest.id)}>
                        {digest.readAt ? t('library.alertRead') : t('library.alertMarkRead')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {alerts.length ? (
              <div className="track-list track-list-scroll">
                {alerts.slice(0, 8).map((alert) => (
                  <div key={alert.id} className={`track-card ${alert.readAt ? '' : 'active'}`}>
                    <div className="track-card-copy">
                      <div className="track-title">{alert.title}</div>
                      <div className="track-meta">{alert.body}</div>
                    </div>
                    <button className="chip" type="button" onClick={() => markAlertRead(alert.id)}>
                      {alert.readAt ? t('library.alertRead') : t('library.alertMarkRead')}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              !digests.length ? <div className="empty-state">{t('library.alertsEmpty')}</div> : null
            )}
          </div>
        </div>
      ) : null}
        </>
      )}

      {/* Bottom sheets (portal to document.body): the collection-detail «Ещё»
          overflow (both layouts) and the per-card grid actions (mobile «···»).
          The recent-tab track-journal sheet and the queue history+journal rail
          sheet are both gone — that context lives in the «Недавнее» and «Треки»
          tabs now. */}

      {/* Collection-detail «Ещё» overflow — PHONE-ONLY (the sheet CSS is scoped to
          ≤720px). Desktop renders these same actions inline as chips in the detail
          action row above; do NOT un-gate this or the unstyled sheet inerts #root. */}
      {isMobileLayout && detailActionsOpen && selectedCollection ? (
        <LibrarySheet
          sheetId="collection-detail-actions"
          kicker={t('library.collectionsTitle')}
          title={selectedCollection.name}
          onClose={() => {
            setDetailActionsOpen(false);
            setDeleteArmedCollectionId(null);
          }}
        >
          <div className="library-sheet-rows">
            <button
              className="library-sheet-action"
              type="button"
              onClick={() => {
                beginRenameCollection(selectedCollection);
                setDetailActionsOpen(false);
              }}
            >
              {t('library.renameCollection')}
            </button>
            <button
              className={`library-sheet-action ${selectedCollection.pinned ? 'active' : ''}`}
              type="button"
              onClick={() => {
                toggleCollectionPinned(selectedCollection.id);
                setDetailActionsOpen(false);
              }}
            >
              {selectedCollection.pinned
                ? t('library.unpinCollection')
                : t('library.pinCollection')}
            </button>
            {player.current ? (
              <button
                className="library-sheet-action"
                type="button"
                onClick={() => {
                  addCurrentToCollection(selectedCollection.id, selectedCollection.name);
                  setDetailActionsOpen(false);
                }}
              >
                {t('library.addCurrentToCollection')}
              </button>
            ) : null}
            <button
              className={`library-sheet-action ${collectionReorderMode ? 'active' : ''}`}
              type="button"
              onClick={() => {
                setCollectionReorderMode((value) => !value);
                setDetailActionsOpen(false);
              }}
            >
              {collectionReorderMode ? t('library.reorderDone') : t('library.reorderMode')}
            </button>
            <button
              className={`library-sheet-action library-sheet-action-danger ${
                deleteArmedCollectionId === selectedCollection.id ? 'is-armed' : ''
              }`}
              type="button"
              onClick={() => requestDeleteCollection(selectedCollection)}
            >
              {deleteArmedCollectionId === selectedCollection.id
                ? t('library.deleteCollectionConfirm')
                : t('library.deleteCollection')}
            </button>
          </div>
        </LibrarySheet>
      ) : null}

      {/* S3 per-card actions sheet (mobile «···» target; desktop «···» opens the
          detail instead). Mirrors the detail chip-row action set. Portals to
          document.body via LibrarySheet. */}
      {isMobileLayout && collectionActionsSheet ? (
        <LibrarySheet
          sheetId="collection-actions"
          kicker={t('library.collectionsTitle')}
          title={collectionActionsSheet.name}
          onClose={() => {
            setCollectionActionsId(null);
            setDeleteArmedCollectionId(null);
          }}
        >
          <div className="library-sheet-rows">
            <button
              className="library-sheet-action"
              type="button"
              onClick={() => {
                playCollection(collectionActionsSheet);
                setCollectionActionsId(null);
              }}
              disabled={!collectionActionsSheet.stationIds.length}
            >
              {t('library.playCollection')}
            </button>
            <button
              className="library-sheet-action"
              type="button"
              onClick={() => {
                playCollection(collectionActionsSheet, true);
                setCollectionActionsId(null);
              }}
              disabled={!collectionActionsSheet.stationIds.length}
            >
              {t('library.shuffleCollection')}
            </button>
            <button
              className="library-sheet-action"
              type="button"
              onClick={() => {
                openCollectionDetail(collectionActionsSheet.id);
                setCollectionActionsId(null);
                setDeleteArmedCollectionId(null);
              }}
            >
              {t('library.openCollection')}
            </button>
            <button
              className="library-sheet-action"
              type="button"
              onClick={() => renameCollectionFromSheet(collectionActionsSheet)}
            >
              {t('library.renameCollection')}
            </button>
            <button
              className={`library-sheet-action ${collectionActionsSheet.pinned ? 'active' : ''}`}
              type="button"
              onClick={() => {
                toggleCollectionPinned(collectionActionsSheet.id);
                setCollectionActionsId(null);
              }}
            >
              {collectionActionsSheet.pinned
                ? t('library.unpinCollection')
                : t('library.pinCollection')}
            </button>
            {player.current ? (
              <button
                className="library-sheet-action"
                type="button"
                onClick={() => {
                  addCurrentToCollection(collectionActionsSheet.id, collectionActionsSheet.name);
                  setCollectionActionsId(null);
                }}
              >
                {t('library.addCurrentToCollection')}
              </button>
            ) : null}
            <button
              className={`library-sheet-action library-sheet-action-danger ${
                deleteArmedCollectionId === collectionActionsSheet.id ? 'is-armed' : ''
              }`}
              type="button"
              onClick={() => requestDeleteCollection(collectionActionsSheet)}
            >
              {deleteArmedCollectionId === collectionActionsSheet.id
                ? t('library.deleteCollectionConfirm')
                : t('library.deleteCollection')}
            </button>
          </div>
        </LibrarySheet>
      ) : null}
    </section>
  );
};

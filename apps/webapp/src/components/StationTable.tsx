import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import type { NowPlayingSnapshot } from '../domain/contracts';
import { observeStationNowPlaying } from '../lib/nowPlaying';
import { getDeviceProfile } from '../lib/deviceProfile';
import type { StationLite } from '../types';
import type { BehaviorProfile } from '../lib/homeProfile';
import { stationLocation, stationTags } from '../lib/stationUtils';
import { normalizeTrustedTrackTitle, resolveNowPlayingTrust } from '../lib/trackTrust';
import { useLibrary, usePlayback } from '../state/RadioContext';
import { getRecommendationReason } from '../lib/recommendationReason';
import { useLocale } from '../state/LocaleContext';
import { StationArtwork } from './StationArtwork';

type StationTableProps = {
  stations: StationLite[];
  compact?: boolean;
  sourceId?: string;
  buildQueue?: boolean;
  nowPlayingMode?: 'active-only' | 'viewport';
};

declare global {
  interface Window {
    // T2.11a render spy: StationTable.test.tsx seeds this map and reads
    // per-station render counts to assert a playback tick re-renders
    // only the active row, not every mounted row. Never set in production.
    __radioatlasRowRenderCounts__?: Record<string, number>;
  }
}

// Lists longer than this are window-virtualized (only the visible
// window + overscan is mounted); shorter lists render as a plain flow.
// Below the threshold the virtualizer's setup cost (ResizeObserver per
// row, scroll-margin bookkeeping) isn't worth it, and embedded mini
// lists (e.g. the 3-4 row collection previews) shouldn't be treated as
// window-scrolled surfaces at all. (T2.11b)
const WINDOW_VIRTUALIZE_THRESHOLD = 50;
// Matches the `.station-row` contain-intrinsic-size placeholder; the
// virtualizer corrects it per row via measureElement (ResizeObserver).
const ROW_ESTIMATE_PX = 92;

const IDLE_ROW_SNAPSHOT: NowPlayingSnapshot = {
  track: null,
  status: 'idle',
  source: 'none',
  failureKind: null,
  recommendedPollMs: 30_000,
  updatedAt: null
};

// Only the currently-playing row needs live playback data (track,
// status, play/pause). Bundling it into one prop that is non-null
// ONLY for the active row means a playback tick changes the prop of
// exactly one row; every other memoized row sees a stable `null` and
// skips re-render. (T2.11a)
type ActivePlayback = Pick<
  ReturnType<typeof usePlayback>,
  'player' | 'nowPlaying' | 'nowPlayingStatus'
>;

type StationTableRowProps = {
  station: StationLite;
  index: number;
  compact?: boolean;
  nowPlayingMode: 'active-only' | 'viewport';
  // Parent-computed slices (lifted out of usePlayback/useLibrary so the
  // row no longer subscribes to either context directly — both change
  // on every now-playing tick).
  active: boolean;
  liked: boolean;
  hidden: boolean;
  behaviorProfile: BehaviorProfile | null | undefined;
  activePlayback: ActivePlayback | null;
  // Stable callbacks (parent keeps them referentially stable via refs).
  onPlay: (station: StationLite) => void;
  onToggleFavorite: (station: StationLite) => void;
  onToggleHidden: (station: StationLite, currentlyHidden: boolean) => void;
};

const StationTableRow = memo(({
  station,
  index,
  compact,
  nowPlayingMode,
  active,
  liked,
  hidden,
  behaviorProfile,
  activePlayback,
  onPlay,
  onToggleFavorite,
  onToggleHidden
}: StationTableRowProps) => {
  const { t } = useLocale();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const lowPower = getDeviceProfile().lowPower;
  const shouldWatchViewport = nowPlayingMode === 'viewport';
  const seedWindow = lowPower ? 1 : compact ? 2 : 3;
  const [isNearViewport, setIsNearViewport] = useState(() =>
    shouldWatchViewport ? active || index < seedWindow : active
  );
  const [snapshot, setSnapshot] = useState<NowPlayingSnapshot>(IDLE_ROW_SNAPSHOT);
  const shouldObserve = active || (shouldWatchViewport && isNearViewport);

  // Test-only render spy (see __radioatlasRowRenderCounts__). No-op in
  // production — the global is only set by StationTable.test.tsx.
  if (typeof window !== 'undefined' && window.__radioatlasRowRenderCounts__) {
    const counts = window.__radioatlasRowRenderCounts__;
    counts[station.stationuuid] = (counts[station.stationuuid] ?? 0) + 1;
  }

  useEffect(() => {
    if (active) {
      setIsNearViewport(true);
    }
  }, [active]);

  useEffect(() => {
    if (!shouldWatchViewport) {
      setIsNearViewport(active);
      return;
    }
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
      setIsNearViewport(true);
      return;
    }
    const node = rowRef.current;
    if (!node) {
      setIsNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const nextNearViewport = entries.some((entry) => entry.isIntersecting);
        setIsNearViewport(active || nextNearViewport);
      },
      {
        rootMargin: lowPower ? '120px 0px' : compact ? '220px 0px' : '320px 0px'
      }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [active, compact, lowPower, shouldWatchViewport]);

  useEffect(() => {
    if (!shouldObserve) return;
    return observeStationNowPlaying(station, setSnapshot, { passive: true });
  }, [shouldObserve, station]);

  const toggleHidden = () => {
    onToggleHidden(station, hidden);
  };
  // Why is this station here? "Часто слушаешь", "Любимый жанр · jazz",
  // "Часто слушаешь · Russia", "Промо", "Проверено" — pick one to
  // explain the row at a glance. null when there's no signal worth
  // surfacing, and we just show the station's existing flag chips
  // (verified / promoted / claimed) instead. Skipping if the row is
  // currently active so the now-playing UI takes precedence.
  const reason =
    !active && !hidden
      ? getRecommendationReason({ station, behaviorProfile, t })
      : null;
  const isActivePlaying = Boolean(active && activePlayback?.player.isPlaying);
  const playLabel = isActivePlaying ? t('common.pause') : t('common.play');
  const locationLabel = stationLocation(station);
  const tagsLabel = stationTags(station);
  const compactTags = (station.tags || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(' · ');

  const toggleStation = () => {
    if (active && activePlayback) {
      void activePlayback.player.toggle();
      return;
    }

    onPlay(station);
  };

  const activeTrust =
    active && activePlayback
      ? resolveNowPlayingTrust({
          station,
          track: activePlayback.nowPlaying,
          metadataStatus: activePlayback.nowPlayingStatus,
          playerStatus: activePlayback.player.status,
          failure: activePlayback.player.failure
        })
      : null;
  const activeTrack = activeTrust?.track || null;
  const displayTrack = activeTrack || normalizeTrustedTrackTitle(snapshot.track, station);
  const activeNowPlayingStatus = activePlayback?.nowPlayingStatus ?? 'idle';
  const displayStatus =
    active && !activeTrack && activeNowPlayingStatus !== 'idle'
      ? displayTrack
        ? 'ready'
        : 'unavailable'
      : displayTrack
        ? 'ready'
        : snapshot.status;
  const trackLabel =
    displayTrack || t('app.metadataUnavailable');
  // Only surface the "track unavailable" subtitle for the row that's
  // actually playing — for the other 47 rows the line was just dead
  // copy ("Трек ещё не пришёл" everywhere) that crowded the layout
  // and made every station look broken.
  const showTrackLine = active || Boolean(displayTrack);
  const showTagline = compact && Boolean(compactTags) && !displayTrack;

  return (
    <div
      ref={rowRef}
      className={`station-row ${active ? 'active' : ''}`}
      data-station-row=""
      data-track-status={displayTrack ? 'ready' : displayStatus}
      data-recommendation-hidden={hidden ? 'true' : undefined}
    >
      {compact ? (
        <div className="station-compact-shell">
          <button
            className="station-compact-main station-compact-toggle"
            type="button"
            onClick={toggleStation}
            aria-label={playLabel}
          >
            <StationArtwork station={station} size="card" />
            <div className="station-compact-copy">
              <div className="station-title" title={station.name}>
                <span className="marquee-text">{station.name}</span>
              </div>
              {reason ? (
                <span
                  className={`station-reason-chip station-reason-chip-${reason.kind}`}
                  title={reason.label}
                >
                  {reason.label}
                </span>
              ) : null}
              {/* When the reason chip is showing, hide the
                  verified / promoted catalog flags entirely.
                  The reason ("Часто слушаешь · Russia") is
                  always more informative than the catalog flag
                  ("Проверено") — stacking both makes the row
                  read as "two facts about this station" when
                  the user just wants one quick line. Claimed
                  has no reason equivalent, so it still renders
                  to mark the row as user-managed.
                  Without a reason chip, the original flag row
                  is preserved as the secondary signal. */}
              {!reason &&
              (station.isVerified || station.promoted || station.isClaimed) ? (
                <div className="chip-row station-inline-flags">
                  {station.isVerified ? (
                    <span className="chip active">{t('stationTable.verified')}</span>
                  ) : null}
                  {station.promoted ? (
                    <span className="chip">{t('stationTable.promoted')}</span>
                  ) : null}
                  {station.isClaimed && !station.isVerified ? (
                    <span className="chip">{t('stationTable.claimed')}</span>
                  ) : null}
                </div>
              ) : reason && station.isClaimed ? (
                <div className="chip-row station-inline-flags">
                  <span className="chip">{t('stationTable.claimed')}</span>
                </div>
              ) : null}
              {showTrackLine ? (
                <div className={`station-now-playing ${displayTrack ? '' : `is-${displayStatus}`}`.trim()} title={trackLabel}>
                  {trackLabel}
                </div>
              ) : null}
              <div className="station-location" title={locationLabel}>
                {locationLabel}
              </div>
              {showTagline ? (
                <div className="station-compact-tagline" title={compactTags}>
                  {compactTags}
                </div>
              ) : null}
            </div>
          </button>
          <div className="station-compact-actions">
            <button
              className="play-btn icon-only station-compact-play"
              onClick={toggleStation}
              type="button"
              aria-label={playLabel}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {isActivePlaying ? (
                  <path d="M7 5h4v14H7zm6 0h4v14h-4z" />
                ) : (
                  <path d="M8 5v14l11-7z" />
                )}
              </svg>
            </button>
            <button
              className={`icon-btn station-fav-btn ${liked ? 'active' : ''}`}
              onClick={() => onToggleFavorite(station)}
              type="button"
              aria-label={liked ? t('stationTable.unfavorite') : t('stationTable.favorite')}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 21.2l-1.4-1.3C5.4 15.4 2 12.3 2 8.4 2 5.6 4.2 3.5 7 3.5c1.6 0 3.2.7 4.2 2 1-1.3 2.6-2 4.2-2 2.8 0 5 2.1 5 4.9 0 3.9-3.4 7-8.6 11.4L12 21.2z" />
              </svg>
            </button>
            <button
              className={`icon-btn station-hide-btn ${hidden ? 'active' : ''}`}
              onClick={toggleHidden}
              type="button"
              aria-label={
                hidden
                  ? t('stationTable.unhideFromRecommendations') ||
                    'Показывать снова в рекомендациях'
                  : t('stationTable.hideFromRecommendations') ||
                    'Скрыть из рекомендаций'
              }
              title={
                hidden
                  ? t('stationTable.unhideFromRecommendations') ||
                    'Показывать снова в рекомендациях'
                  : t('stationTable.hideFromRecommendations') ||
                    'Скрыть из рекомендаций'
              }
            >
              {/* Eye-off icon when station is currently hidden,
                  open eye when normal — tap to toggle. */}
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {hidden ? (
                  <path d="M2.1 3.5 3.5 2.1l18.4 18.4-1.4 1.4-2.5-2.5A12 12 0 0 1 12 20c-5.5 0-10.1-3.4-12-8 .8-2 2.2-3.7 4-5L2.1 3.5zM12 7c2.8 0 5 2.2 5 5 0 .6-.1 1.2-.3 1.7l-2.3-2.3c0-.1.1-.3.1-.4 0-1.4-1.1-2.5-2.5-2.5-.1 0-.3 0-.4.1L9.3 6.3C10.1 7.1 11 7 12 7zm0 10c-3.7 0-7-1.7-9-4.5C4 11 5.5 9.5 7.4 8.6l1.6 1.6c-.6.6-.9 1.4-.9 2.3 0 1.9 1.6 3.5 3.5 3.5.9 0 1.7-.3 2.3-.9l1.6 1.6C14.3 16.6 13.2 17 12 17z" />
                ) : (
                  <path d="M12 5C5.5 5 1 12 1 12s4.5 7 11 7 11-7 11-7-4.5-7-11-7zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />
                )}
              </svg>
            </button>
          </div>
        </div>
      ) : (
        <>
          <button className="play-btn" onClick={toggleStation} type="button" aria-label={playLabel}>
            {playLabel}
          </button>
          <div className="station-name">
            <div className="station-name-head">
              <StationArtwork station={station} size="md" />
              <div className="station-name-stack">
                <div className="station-title" title={station.name}>
                  <span className="marquee-text">{station.name}</span>
                </div>
                {reason ? (
                  <span
                    className={`station-reason-chip station-reason-chip-${reason.kind}`}
                    title={reason.label}
                  >
                    {reason.label}
                  </span>
                ) : null}
                {!reason &&
                (station.isVerified || station.promoted || station.isClaimed) ? (
                  <div className="chip-row station-inline-flags">
                    {station.isVerified ? <span className="chip active">{t('stationTable.verified')}</span> : null}
                    {station.promoted ? <span className="chip">{t('stationTable.promoted')}</span> : null}
                    {station.isClaimed && !station.isVerified ? <span className="chip">{t('stationTable.claimed')}</span> : null}
                  </div>
                ) : reason && station.isClaimed ? (
                  <div className="chip-row station-inline-flags">
                    <span className="chip">{t('stationTable.claimed')}</span>
                  </div>
                ) : null}
                {showTrackLine ? (
                  <div className={`station-now-playing ${displayTrack ? '' : `is-${displayStatus}`}`.trim()} title={trackLabel}>
                    {trackLabel}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <div className="station-location">{locationLabel}</div>
          <div className="station-tags">{tagsLabel}</div>
          <div className="station-row-actions">
            <button
              className={`icon-btn ${liked ? 'active' : ''}`}
              onClick={() => onToggleFavorite(station)}
              type="button"
              aria-label={liked ? t('stationTable.unfavorite') : t('stationTable.favorite')}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 21.2l-1.4-1.3C5.4 15.4 2 12.3 2 8.4 2 5.6 4.2 3.5 7 3.5c1.6 0 3.2.7 4.2 2 1-1.3 2.6-2 4.2-2 2.8 0 5 2.1 5 4.9 0 3.9-3.4 7-8.6 11.4L12 21.2z" />
              </svg>
            </button>
            <button
              className={`icon-btn station-hide-btn ${hidden ? 'active' : ''}`}
              onClick={toggleHidden}
              type="button"
              aria-label={
                hidden
                  ? t('stationTable.unhideFromRecommendations') ||
                    'Показывать снова в рекомендациях'
                  : t('stationTable.hideFromRecommendations') ||
                    'Скрыть из рекомендаций'
              }
              title={
                hidden
                  ? t('stationTable.unhideFromRecommendations') ||
                    'Показывать снова в рекомендациях'
                  : t('stationTable.hideFromRecommendations') ||
                    'Скрыть из рекомендаций'
              }
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {hidden ? (
                  <path d="M2.1 3.5 3.5 2.1l18.4 18.4-1.4 1.4-2.5-2.5A12 12 0 0 1 12 20c-5.5 0-10.1-3.4-12-8 .8-2 2.2-3.7 4-5L2.1 3.5zM12 7c2.8 0 5 2.2 5 5 0 .6-.1 1.2-.3 1.7l-2.3-2.3c0-.1.1-.3.1-.4 0-1.4-1.1-2.5-2.5-2.5-.1 0-.3 0-.4.1L9.3 6.3C10.1 7.1 11 7 12 7zm0 10c-3.7 0-7-1.7-9-4.5C4 11 5.5 9.5 7.4 8.6l1.6 1.6c-.6.6-.9 1.4-.9 2.3 0 1.9 1.6 3.5 3.5 3.5.9 0 1.7-.3 2.3-.9l1.6 1.6C14.3 16.6 13.2 17 12 17z" />
                ) : (
                  <path d="M12 5C5.5 5 1 12 1 12s4.5 7 11 7 11-7 11-7-4.5-7-11-7zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />
                )}
              </svg>
            </button>
          </div>
        </>
      )}
    </div>
  );
});
StationTableRow.displayName = 'StationTableRow';

// Window-virtualized list body. Only mounted for lists past the
// threshold. Renders the visible window + overscan as absolutely
// positioned rows inside a full-height spacer, so the document keeps
// scrolling normally (the rest of the screen — topbar, filters, the
// Search server-pagination sentinel below — stay in flow). (T2.11b)
const VirtualizedStationRows = ({
  stations,
  gap,
  renderRow
}: {
  stations: StationLite[];
  gap: number;
  renderRow: (station: StationLite, index: number) => ReactNode;
}) => {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  // The list isn't at the top of the document, so the window virtualizer
  // needs its offset from the document top. getBoundingClientRect().top +
  // scrollY is robust to positioned ancestors (unlike offsetTop).
  // Re-measure on mount, on resize, and when the data set changes (a
  // filter / tab / query switch can change the height of everything
  // stacked above the list).
  useLayoutEffect(() => {
    const measure = () => {
      const node = listRef.current;
      if (!node) return;
      const next = node.getBoundingClientRect().top + window.scrollY;
      setScrollMargin((prev) => (Math.abs(prev - next) > 1 ? next : prev));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [stations]);

  const virtualizer = useWindowVirtualizer<HTMLDivElement>({
    count: stations.length,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: 5,
    gap,
    scrollMargin,
    getItemKey: (index) => {
      const station = stations[index];
      return station ? `${station.stationuuid}-${index}` : index;
    }
  });

  return (
    <div
      ref={listRef}
      style={{ position: 'relative', width: '100%', height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((virtualItem) => {
        const station = stations[virtualItem.index];
        if (!station) return null;
        return (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start - virtualizer.options.scrollMargin}px)`
            }}
          >
            {renderRow(station, virtualItem.index)}
          </div>
        );
      })}
    </div>
  );
};

export const StationTable = ({
  stations,
  compact,
  sourceId,
  buildQueue = true,
  nowPlayingMode = 'active-only'
}: StationTableProps) => {
  const { t } = useLocale();

  // Subscribe to the playback + library contexts ONCE here, then hand
  // each row only the primitive slices it needs. Previously every
  // StationTableRow read usePlayback()+useLibrary() directly, so a
  // single now-playing/currentTime tick — which re-renders RadioProvider
  // and therefore both context values (libraryValue's useMemo deps
  // include per-render predicate fns) — re-rendered every mounted row.
  // With the row memoized and these reads lifted up, only this component
  // plus the one active row (whose activePlayback prop changes) re-render
  // per tick. (T2.11a)
  const { player, nowPlaying, nowPlayingStatus, playStation } = usePlayback();
  const {
    favorites,
    behaviorProfile,
    toggleFavorite,
    hideStationFromRecommendations,
    unhideStationFromRecommendations,
    isStationHiddenFromRecommendations
  } = useLibrary();

  // The context action fns are recreated on every provider render;
  // closing over them directly would change the callback identity each
  // tick and defeat the row memo. Mirror the latest set in a ref and
  // expose [] -dep callbacks that read through it.
  const actionsRef = useRef({
    playStation,
    toggleFavorite,
    hideStationFromRecommendations,
    unhideStationFromRecommendations
  });
  actionsRef.current = {
    playStation,
    toggleFavorite,
    hideStationFromRecommendations,
    unhideStationFromRecommendations
  };
  const queueConfigRef = useRef({ stations, sourceId, buildQueue });
  queueConfigRef.current = { stations, sourceId, buildQueue };

  const handlePlay = useCallback((station: StationLite) => {
    const { stations: queueStations, sourceId: queueSourceId, buildQueue: queueBuild } =
      queueConfigRef.current;
    actionsRef.current.playStation(station, {
      playlist: queueBuild ? queueStations : undefined,
      sourceId: queueSourceId
    });
  }, []);
  const handleToggleFavorite = useCallback((station: StationLite) => {
    actionsRef.current.toggleFavorite(station);
  }, []);
  const handleToggleHidden = useCallback((station: StationLite, currentlyHidden: boolean) => {
    if (currentlyHidden) {
      actionsRef.current.unhideStationFromRecommendations(station);
    } else {
      actionsRef.current.hideStationFromRecommendations(station);
    }
  }, []);

  // O(1) favorite lookup per row instead of favorites.some() per row per
  // tick. Keyed on the favorites array, which is stable across playback
  // ticks (it only changes when the user toggles a favorite).
  const favoriteIds = useMemo(
    () => new Set(favorites.map((item) => item.stationuuid)),
    [favorites]
  );
  const activeStationId = player.current?.stationuuid ?? null;

  // Recreated every render (it closes over the per-tick playback state),
  // which is intended: the active row's activePlayback must refresh each
  // tick. The memoized rows still skip when their own props are unchanged.
  const renderRow = (station: StationLite, index: number) => {
    const active = station.stationuuid === activeStationId;
    return (
      <StationTableRow
        key={`${station.stationuuid}-${sourceId || 'stations'}-${index}`}
        station={station}
        index={index}
        compact={compact}
        nowPlayingMode={nowPlayingMode}
        active={active}
        liked={favoriteIds.has(station.stationuuid)}
        hidden={isStationHiddenFromRecommendations(station.stationuuid)}
        behaviorProfile={behaviorProfile}
        activePlayback={active ? { player, nowPlaying, nowPlayingStatus } : null}
        onPlay={handlePlay}
        onToggleFavorite={handleToggleFavorite}
        onToggleHidden={handleToggleHidden}
      />
    );
  };

  if (!stations.length) {
    return <div className="empty-state">{t('stationTable.empty')}</div>;
  }

  return (
    <div className={`station-table ${compact ? 'compact' : ''}`}>
      {!compact && (
        <div className="station-row header">
          <div>{t('stationTable.playColumn')}</div>
          <div>{t('stationTable.nameColumn')}</div>
          <div>{t('stationTable.locationColumn')}</div>
          <div>{t('stationTable.tagsColumn')}</div>
          <div>{t('stationTable.favoriteColumn')}</div>
        </div>
      )}
      {stations.length > WINDOW_VIRTUALIZE_THRESHOLD ? (
        <VirtualizedStationRows
          stations={stations}
          gap={compact ? 8 : 7}
          renderRow={renderRow}
        />
      ) : (
        stations.map((station, index) => renderRow(station, index))
      )}
    </div>
  );
};

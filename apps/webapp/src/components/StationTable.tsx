import { useCallback, useEffect, useRef, useState } from 'react';
import type { NowPlayingSnapshot } from '../domain/contracts';
import { observeStationNowPlaying } from '../lib/nowPlaying';
import { getDeviceProfile } from '../lib/deviceProfile';
import { useInfiniteScroll } from '../lib/useInfiniteScroll';
import type { StationLite } from '../types';
import { stationLocation, stationTags } from '../lib/stationUtils';
import { useLibrary, usePlayback } from '../state/RadioContext';
import { useLocale } from '../state/LocaleContext';
import { StationArtwork } from './StationArtwork';

type StationTableProps = {
  stations: StationLite[];
  compact?: boolean;
  sourceId?: string;
  buildQueue?: boolean;
  nowPlayingMode?: 'active-only' | 'viewport';
};

const IDLE_ROW_SNAPSHOT: NowPlayingSnapshot = {
  track: null,
  status: 'idle',
  source: 'none',
  failureKind: null,
  recommendedPollMs: 30_000,
  updatedAt: null
};

type StationTableRowProps = {
  station: StationLite;
  index: number;
  compact?: boolean;
  sourceId?: string;
  buildQueue: boolean;
  stations: StationLite[];
  nowPlayingMode: 'active-only' | 'viewport';
};

const StationTableRow = ({
  station,
  index,
  compact,
  sourceId,
  buildQueue,
  stations,
  nowPlayingMode
}: StationTableRowProps) => {
  const { playStation, player, nowPlaying, nowPlayingStatus } = usePlayback();
  const { toggleFavorite, isFavorite } = useLibrary();
  const { t } = useLocale();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const lowPower = getDeviceProfile().lowPower;
  const active = player.current?.stationuuid === station.stationuuid;
  const shouldWatchViewport = nowPlayingMode === 'viewport';
  const seedWindow = lowPower ? 1 : compact ? 2 : 3;
  const [isNearViewport, setIsNearViewport] = useState(() =>
    shouldWatchViewport ? active || index < seedWindow : active
  );
  const [snapshot, setSnapshot] = useState<NowPlayingSnapshot>(IDLE_ROW_SNAPSHOT);
  const shouldObserve = active || (shouldWatchViewport && isNearViewport);

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

  const liked = isFavorite(station.stationuuid);
  const playLabel = active && player.isPlaying ? t('common.pause') : t('common.play');
  const locationLabel = stationLocation(station);
  const tagsLabel = stationTags(station);
  const compactTags = (station.tags || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(' · ');

  const toggleStation = () => {
    if (active) {
      void player.toggle();
      return;
    }

    playStation(station, {
      playlist: buildQueue ? stations : undefined,
      sourceId
    });
  };

  const activeTrack = active ? nowPlaying?.trim() || null : null;
  const displayTrack = activeTrack || snapshot.track;
  const displayStatus =
    active && !activeTrack && nowPlayingStatus !== 'idle'
      ? snapshot.track
        ? 'ready'
        : nowPlayingStatus
      : displayTrack
        ? 'ready'
        : snapshot.status;
  const trackLabel =
    displayTrack || (displayStatus === 'loading' ? t('common.loading') : t('app.metadataUnavailable'));
  const showTagline = compact && Boolean(compactTags) && !displayTrack && displayStatus !== 'loading';

  return (
    <div
      ref={rowRef}
      className={`station-row ${active ? 'active' : ''}`}
      data-track-status={displayTrack ? 'ready' : displayStatus}
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
              {station.isVerified || station.promoted || station.isClaimed ? (
                <div className="chip-row station-inline-flags">
                  {station.isVerified ? <span className="chip active">{t('stationTable.verified')}</span> : null}
                  {station.promoted ? <span className="chip">{t('stationTable.promoted')}</span> : null}
                  {station.isClaimed && !station.isVerified ? <span className="chip">{t('stationTable.claimed')}</span> : null}
                </div>
              ) : null}
              <div className={`station-now-playing ${displayTrack ? '' : `is-${displayStatus}`}`.trim()} title={trackLabel}>
                {trackLabel}
              </div>
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
                {active && player.isPlaying ? (
                  <path d="M7 5h4v14H7zm6 0h4v14h-4z" />
                ) : (
                  <path d="M8 5v14l11-7z" />
                )}
              </svg>
            </button>
            <button
              className={`icon-btn station-fav-btn ${liked ? 'active' : ''}`}
              onClick={() => toggleFavorite(station)}
              type="button"
              aria-label={liked ? t('stationTable.unfavorite') : t('stationTable.favorite')}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 21.2l-1.4-1.3C5.4 15.4 2 12.3 2 8.4 2 5.6 4.2 3.5 7 3.5c1.6 0 3.2.7 4.2 2 1-1.3 2.6-2 4.2-2 2.8 0 5 2.1 5 4.9 0 3.9-3.4 7-8.6 11.4L12 21.2z" />
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
                {station.isVerified || station.promoted || station.isClaimed ? (
                  <div className="chip-row station-inline-flags">
                    {station.isVerified ? <span className="chip active">{t('stationTable.verified')}</span> : null}
                    {station.promoted ? <span className="chip">{t('stationTable.promoted')}</span> : null}
                    {station.isClaimed && !station.isVerified ? <span className="chip">{t('stationTable.claimed')}</span> : null}
                  </div>
                ) : null}
                <div className={`station-now-playing ${displayTrack ? '' : `is-${displayStatus}`}`.trim()} title={trackLabel}>
                  {trackLabel}
                </div>
              </div>
            </div>
          </div>
          <div className="station-location">{locationLabel}</div>
          <div className="station-tags">{tagsLabel}</div>
          <button
            className={`icon-btn ${liked ? 'active' : ''}`}
            onClick={() => toggleFavorite(station)}
            type="button"
            aria-label={liked ? t('stationTable.unfavorite') : t('stationTable.favorite')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 21.2l-1.4-1.3C5.4 15.4 2 12.3 2 8.4 2 5.6 4.2 3.5 7 3.5c1.6 0 3.2.7 4.2 2 1-1.3 2.6-2 4.2-2 2.8 0 5 2.1 5 4.9 0 3.9-3.4 7-8.6 11.4L12 21.2z" />
            </svg>
          </button>
        </>
      )}
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
  const lowPower = getDeviceProfile().lowPower;
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const renderBatch = compact ? (lowPower ? 12 : 18) : lowPower ? 16 : 24;
  const [visibleCount, setVisibleCount] = useState(() => Math.min(stations.length, renderBatch));

  useEffect(() => {
    setVisibleCount(Math.min(stations.length, renderBatch));
  }, [renderBatch, stations]);

  const loadMore = useCallback(() => {
    setVisibleCount((previous) => Math.min(stations.length, previous + renderBatch));
  }, [renderBatch, stations.length]);

  useInfiniteScroll(sentinelRef, {
    enabled: visibleCount < stations.length,
    rootMargin: compact ? '420px' : '620px',
    onLoadMore: loadMore
  });

  const renderedStations =
    visibleCount >= stations.length ? stations : stations.slice(0, visibleCount);

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
      {renderedStations.map((station, index) => {
        return (
          <StationTableRow
            key={`${station.stationuuid}-${sourceId || 'stations'}-${index}`}
            station={station}
            index={index}
            compact={compact}
            sourceId={sourceId}
            buildQueue={buildQueue}
            stations={stations}
            nowPlayingMode={nowPlayingMode}
          />
        );
      })}
      {visibleCount < stations.length ? <div ref={sentinelRef} className="station-table-sentinel" /> : null}
    </div>
  );
};

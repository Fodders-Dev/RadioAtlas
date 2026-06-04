import { useMemo, useRef, type ReactNode } from 'react';
import { stationLocation, stationTags } from '../lib/stationUtils';
import { useDialog } from '../lib/useDialog';
import { canShareToStory, shareStationToStory, triggerHaptic } from '../lib/telegram';
import { resolveNowPlayingTrust } from '../lib/trackTrust';
import { useLocale } from '../state/LocaleContext';
import { useLibrary, usePlayback, useShell } from '../state/RadioContext';
import type { StationLite } from '../types';
import { FullPlayerBackdrop } from './FullPlayerBackdrop';
import { FullPlayerVisualizer } from './FullPlayerVisualizer';
import { StationArtwork } from './StationArtwork';
import { ThemeActionIcon } from './ThemeActionIcon';
import './FullPlayerOverlay.css';

type FullPlayerOverlayProps = {
  onDetails?: () => void;
};

const actionIcon = {
  close: (
    <path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6 6.4 5Z" />
  ),
  previous: <path d="M7 6h2v12H7V6Zm3 6 8 6V6l-8 6Z" />,
  play: <path d="M8 5v14l11-7L8 5Z" />,
  pause: <path d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z" />,
  next: <path d="M6 6v12l8.5-6L6 6Zm9 0v12h2V6h-2Z" />,
  like: (
    <path d="M12 21.2l-1.4-1.3C5.4 15.4 2 12.3 2 8.4 2 5.6 4.2 3.5 7 3.5c1.6 0 3.2.7 4.2 2 1-1.3 2.6-2 4.2-2 2.8 0 5 2.1 5 4.9 0 3.9-3.4 7-8.6 11.4L12 21.2Z" />
  ),
  share: (
    <path d="M18 16.1c-.76 0-1.44.3-1.96.77L8.9 12.7c.06-.23.1-.46.1-.7s-.04-.47-.1-.7l7.06-4.12A2.99 2.99 0 1 0 15 5c0 .24.04.47.1.7L8.04 9.82A3 3 0 1 0 8.04 14.2l7.13 4.18c-.05.2-.08.41-.08.62A2.91 2.91 0 1 0 18 16.1Z" />
  ),
  external: (
    <path d="M19 19H5V5h7V3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7ZM14 3v2h3.6l-9.8 9.8 1.4 1.4L19 6.4V10h2V3h-7Z" />
  ),
  details: (
    <path d="M11 17h2v-6h-2v6Zm1-14a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 16a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm-1-9h2V7h-2v3Z" />
  ),
  hide: (
    <path d="M12 5c5 0 8.5 4.5 9.7 6.2.22.3.22.7 0 1C20.5 14 17 18.5 12 18.5S3.5 14 2.3 12.2a.86.86 0 0 1 0-1C3.5 9.5 7 5 12 5Zm0 2C8.5 7 5.8 9.7 4.4 11.7 5.8 13.8 8.5 16.5 12 16.5s6.2-2.7 7.6-4.8C18.2 9.7 15.5 7 12 7Zm0 1.5a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4Z" />
  ),
  copy: (
    <path d="M16 1H6a2 2 0 0 0-2 2v12h2V3h10V1Zm3 4H10a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H10V7h9v14Z" />
  ),
  up: <path d="M7 14.5 12 9l5 5.5-1.5 1.4L12 12l-3.5 3.9L7 14.5Z" />,
  down: <path d="m7 9.5 1.5-1.4L12 12l3.5-3.9L17 9.5 12 15 7 9.5Z" />,
  remove: (
    <path d="M7 6V4h10v2h4v2h-2v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8H3V6h4Zm0 2v11h10V8H7Zm2 2h2v7H9v-7Zm4 0h2v7h-2v-7Z" />
  )
};

const Icon = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {children}
  </svg>
);

const formatStationMeta = (station: StationLite | null, fallback: string) =>
  station ? `${stationLocation(station)} · ${stationTags(station)}` : fallback;

export const FullPlayerOverlay = ({ onDetails }: FullPlayerOverlayProps) => {
  const { t } = useLocale();
  const {
    player,
    queue,
    nowPlaying,
    nowPlayingStatus,
    playPrevious,
    playNext,
    playLast,
    copyTrack,
    openExternal,
    shareStation
  } = usePlayback();
  const {
    playbackHistory,
    trackHistory,
    toggleFavorite,
    isFavorite,
    hideStationFromRecommendations,
    unhideStationFromRecommendations,
    isStationHiddenFromRecommendations
  } = useLibrary();
  const { setActiveSection, setLibraryTab, winamp } = useShell();
  const rootRef = useRef<HTMLDivElement>(null);
  // Mounted only while open (App.tsx gates on winamp.expanded), so isOpen
  // is true for the hook's lifetime; close routes through setExpanded.
  // The dock that opened this unmounts while the overlay is up, so restore
  // focus to its re-mounted artwork trigger rather than the gone original.
  useDialog(rootRef, {
    isOpen: true,
    onClose: () => winamp.setExpanded(false),
    restoreFocusTo: () =>
      document.querySelector<HTMLElement>('.player-dock-artwork-trigger')
  });

  const current = player.current;
  const liked = current ? isFavorite(current.stationuuid) : false;
  const stationHidden = current ? isStationHiddenFromRecommendations(current.stationuuid) : false;
  const queueLabel = queue.sourceLabel || t('radio.queueDefault');
  const activeQueueIndex =
    queue.currentIndex >= 0
      ? queue.currentIndex
      : current
        ? queue.items.findIndex((station) => station.stationuuid === current.stationuuid)
        : -1;
  const canResume = Boolean(current || queue.items.length || playbackHistory.length);
  const canCopyTrack = Boolean(nowPlaying?.trim());
  const trust = resolveNowPlayingTrust({
    station: current,
    track: nowPlaying,
    metadataStatus: nowPlayingStatus,
    playerStatus: player.status,
    failure: player.failure
  });
  const displayTrack = trust.track || (current ? t('dock.currentTrackUnavailable') : t('winamp.noStation'));
  const queuePreview = useMemo(() => {
    if (!queue.items.length) return [];
    const start = Math.max(activeQueueIndex, 0);
    return queue.items.slice(start, start + 13);
  }, [activeQueueIndex, queue.items]);
  const recentTracks = useMemo(
    () =>
      (current
        ? trackHistory.filter((item) => item.stationId === current.stationuuid)
        : trackHistory
      )
        .filter((item) => item.track.trim())
        .slice(0, 4),
    [current, trackHistory]
  );

  const handlePrimary = () => {
    if (current) {
      void player.toggle();
      return;
    }
    playLast();
  };

  const handleDetails = () => {
    if (!current || !onDetails) return;
    onDetails();
  };

  const handleHideStation = () => {
    if (!current) return;
    if (stationHidden) {
      unhideStationFromRecommendations(current);
    } else {
      hideStationFromRecommendations(current);
    }
  };

  const openLibraryQueue = () => {
    setLibraryTab('queue');
    setActiveSection('library');
    winamp.setExpanded(false);
  };

  const renderQueueItem = (station: StationLite, index: number) => {
    const absoluteIndex = Math.max(activeQueueIndex, 0) + index;
    const active = current?.stationuuid === station.stationuuid;
    const canMoveUp = !active && absoluteIndex > Math.max(activeQueueIndex + 1, 0);
    const canMoveDown = !active && absoluteIndex < queue.items.length - 1;
    return (
      <article
        className={`full-player-queue-item ${active ? 'active' : ''}`}
        key={`${station.stationuuid}-${absoluteIndex}`}
        data-full-player-queue-item={station.stationuuid}
        data-queue-index={absoluteIndex}
      >
        <StationArtwork station={station} size="sm" />
        <button
          className="full-player-queue-main"
          type="button"
          onClick={() => queue.playAtIndex(absoluteIndex)}
          aria-label={`${active ? t('queue.nowPlaying') : t('common.play')}: ${station.name}`}
        >
          <strong>{station.name}</strong>
          <small>{stationLocation(station)}</small>
          {active ? <em>{t('queue.nowPlaying')}</em> : null}
        </button>
        <span className="full-player-queue-actions">
          <button
            className="full-player-queue-btn"
            type="button"
            onClick={() => queue.moveAtIndex(absoluteIndex, -1)}
            disabled={!canMoveUp}
            data-queue-action="move-up"
            aria-label={`${t('queue.moveUp')}: ${station.name}`}
          >
            <Icon>{actionIcon.up}</Icon>
          </button>
          <button
            className="full-player-queue-btn"
            type="button"
            onClick={() => queue.moveAtIndex(absoluteIndex, 1)}
            disabled={!canMoveDown}
            data-queue-action="move-down"
            aria-label={`${t('queue.moveDown')}: ${station.name}`}
          >
            <Icon>{actionIcon.down}</Icon>
          </button>
          <button
            className="full-player-queue-btn danger"
            type="button"
            onClick={() => queue.removeAtIndex(absoluteIndex)}
            data-queue-action="remove"
            aria-label={`${t('queue.remove')}: ${station.name}`}
          >
            <Icon>{actionIcon.remove}</Icon>
          </button>
        </span>
      </article>
    );
  };

  return (
    <div
      ref={rootRef}
      className="full-player-overlay fullscreen-ui"
      data-full-player-overlay
      role="dialog"
      aria-modal="true"
      aria-label={current?.name || t('dock.ready')}
    >
      <FullPlayerBackdrop active={player.visualizer.active} subscribe={player.subscribeVisualizer} />
      <header className="full-player-header">
        <div>
          <span className="full-player-kicker">{queueLabel}</span>
          <h2>{current?.name || t('dock.emptyTitle')}</h2>
        </div>
        <button
          className="full-player-icon-btn"
          type="button"
          onClick={() => winamp.setExpanded(false)}
          aria-label={t('details.close')}
        >
          <Icon>{actionIcon.close}</Icon>
        </button>
      </header>

      <main className="full-player-main">
        <section className="full-player-now" aria-label={t('winamp.currentStation')}>
          <div className="full-player-artwork-wrap">
            <StationArtwork station={current} size="card" className="full-player-artwork" />
          </div>
          <div className="full-player-copy">
            <p>{formatStationMeta(current, t('winamp.buildQueue'))}</p>
            <h1>{current?.name || t('winamp.noStation')}</h1>
            <button
              className="full-player-track"
              type="button"
              disabled={!canCopyTrack}
              onClick={() => {
                if (canCopyTrack) void copyTrack();
              }}
              data-full-player-track
            >
              <span>{displayTrack}</span>
              {canCopyTrack ? <Icon>{actionIcon.copy}</Icon> : null}
            </button>
          </div>
        </section>

        <FullPlayerVisualizer
          active={player.visualizer.active}
          subscribe={player.subscribeVisualizer}
        />

        <section className="full-player-controls" aria-label={t('dock.ready')}>
          <button
            className="full-player-icon-btn"
            type="button"
            onClick={() => {
              triggerHaptic();
              playPrevious();
            }}
            disabled={!canResume}
            aria-label={t('common.previous')}
          >
            <ThemeActionIcon name="prev">{actionIcon.previous}</ThemeActionIcon>
          </button>
          <button
            className={`full-player-primary-btn ${player.isPlaying ? 'active' : ''}`}
            type="button"
            onClick={() => {
              triggerHaptic();
              handlePrimary();
            }}
            disabled={!canResume}
            aria-label={player.isPlaying ? t('common.pause') : t('common.play')}
          >
            <ThemeActionIcon name={player.isPlaying ? 'pause' : 'play'}>
              {player.isPlaying ? actionIcon.pause : actionIcon.play}
            </ThemeActionIcon>
          </button>
          <button
            className="full-player-icon-btn"
            type="button"
            onClick={() => {
              triggerHaptic();
              playNext();
            }}
            disabled={!canResume}
            aria-label={t('common.next')}
          >
            <ThemeActionIcon name="next">{actionIcon.next}</ThemeActionIcon>
          </button>
        </section>

        <section className="full-player-actions" aria-label={t('common.actions')}>
          <button
            className={`full-player-action-chip ${liked ? 'active' : ''}`}
            type="button"
            onClick={() => {
              if (current) {
                triggerHaptic();
                toggleFavorite(current);
              }
            }}
            disabled={!current}
            aria-label={liked ? t('stationTable.unfavorite') : t('stationTable.favorite')}
          >
            <ThemeActionIcon name="like">{actionIcon.like}</ThemeActionIcon>
            <span>{liked ? t('stationTable.unfavorite') : t('stationTable.favorite')}</span>
          </button>
          <button
            className="full-player-action-chip"
            type="button"
            onClick={() => current && shareStation(current)}
            disabled={!current}
            aria-label={t('common.share')}
          >
            <Icon>{actionIcon.share}</Icon>
            <span>{t('common.share')}</span>
          </button>
          {canShareToStory() && (
            <button
              className="full-player-action-chip"
              type="button"
              onClick={() => current && shareStationToStory(current)}
              disabled={!current}
              aria-label={t('common.shareStory')}
            >
              <Icon>{actionIcon.share}</Icon>
              <span>{t('common.shareStory')}</span>
            </button>
          )}
          <button
            className="full-player-action-chip"
            type="button"
            onClick={() => current && openExternal(current)}
            disabled={!current?.url_resolved}
            aria-label={t('common.openBrowser')}
          >
            <Icon>{actionIcon.external}</Icon>
            <span>{t('common.openBrowser')}</span>
          </button>
          <button
            className="full-player-action-chip"
            type="button"
            onClick={handleDetails}
            disabled={!current || !onDetails}
            aria-label={t('winamp.stationDetails')}
          >
            <Icon>{actionIcon.details}</Icon>
            <span>{t('winamp.stationDetails')}</span>
          </button>
          <button
            className={`full-player-action-chip ${stationHidden ? 'active' : ''}`}
            type="button"
            onClick={handleHideStation}
            disabled={!current}
            aria-label={stationHidden ? t('details.showInRecommendations') : t('details.hideFromRecommendations')}
          >
            <Icon>{actionIcon.hide}</Icon>
            <span>{stationHidden ? t('details.showInRecommendations') : t('details.hideFromRecommendations')}</span>
          </button>
        </section>

        <section className="full-player-content-grid">
          <div className="full-player-panel" data-full-player-queue>
            <div className="full-player-panel-head">
              <h3>{t('winamp.upNext')}</h3>
              <span>{t('winamp.queueCount', { count: queue.items.length })}</span>
            </div>
            <div className="full-player-queue-toolbar">
              <button
                className="full-player-small-chip"
                type="button"
                onClick={queue.clearUpcoming}
                disabled={activeQueueIndex < 0 || activeQueueIndex >= queue.items.length - 1}
              >
                {t('queue.clearUpcoming')}
              </button>
              <button className="full-player-small-chip" type="button" onClick={openLibraryQueue}>
                {t('queue.openLibrary')}
              </button>
            </div>
            <div className="full-player-queue-list">
              {queuePreview.length ? (
                queuePreview.map(renderQueueItem)
              ) : (
                <div className="full-player-empty">{t('winamp.buildQueue')}</div>
              )}
            </div>
          </div>

          <div className="full-player-panel">
            <div className="full-player-panel-head">
              <h3>{t('winamp.recentTracks')}</h3>
              <span>{current ? current.country || t('common.unknown') : t('common.unknown')}</span>
            </div>
            <div className="full-player-track-list">
              {recentTracks.length ? (
                recentTracks.map((item) => (
                  <div className="full-player-track-row" key={item.id}>
                    <strong>{item.track}</strong>
                    <span>{item.stationName}</span>
                  </div>
                ))
              ) : (
                <div className="full-player-empty">{t('details.recentTracksEmpty')}</div>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

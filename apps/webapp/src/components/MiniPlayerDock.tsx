import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { stationLocation } from '../lib/stationUtils';
import { resolveNowPlayingTrust } from '../lib/trackTrust';
import { useLocale } from '../state/LocaleContext';
import { useLibrary, usePlayback, useShell } from '../state/RadioContext';
import { StationArtwork } from './StationArtwork';
import { ThemeActionIcon } from './ThemeActionIcon';
import './MiniPlayerDock.css';

type DockTrayMode = 'queue' | 'volume' | null;
const VOLUME_LONG_PRESS_CANCEL_PX = 6;

export const MiniPlayerDock = () => {
  const { t } = useLocale();
  const {
    player,
    nowPlaying,
    nowPlayingStatus,
    queue,
    playNext,
    playStation,
    copyTrack
  } = usePlayback();
  const {
    toggleFavorite,
    isFavorite
  } = useLibrary();
  const {
    playerPresentation,
    setPlayerPresentation,
    activeSection,
    setActiveSection,
    libraryTab,
    setLibraryTab,
    setDetailsOpen,
    setSkinLabOpen,
    winamp
  } = useShell();
  const [trayMode, setTrayMode] = useState<DockTrayMode>(null);
  const lastAudibleVolumeRef = useRef(player.volume || 0.8);
  const volumePressTimerRef = useRef<number | null>(null);
  const volumeLongPressTriggeredRef = useRef(false);
  const volumePointerStartRef = useRef<{ x: number; y: number } | null>(null);

  const current = player.current;
  const liked = current ? isFavorite(current.stationuuid) : false;
  const queueCount = Math.max(queue.items.length, 0);
  const isDormantDock = !current && queueCount === 0;
  const resolvedQueueIndex =
    queue.currentIndex >= 0
      ? queue.currentIndex
      : current
        ? queue.items.findIndex((station) => station.stationuuid === current.stationuuid)
        : -1;
  const queuePreviewStart = resolvedQueueIndex >= 0 ? resolvedQueueIndex : 0;
  const queuePreview = queue.items.slice(queuePreviewStart, queuePreviewStart + 3);
  const queueSourceLabel = queue.sourceLabel || t('radio.queueDefault');
  const queueProgressLabel = queueCount
    ? resolvedQueueIndex >= 0
      ? t('dock.queueProgress', { current: resolvedQueueIndex + 1, total: queueCount })
      : t('dock.queueCount', { count: queueCount })
    : current
      ? t('dock.liveNow')
      : t('dock.ready');
  const trackTrust = resolveNowPlayingTrust({
    station: current,
    track: nowPlaying,
    metadataStatus: nowPlayingStatus,
    playerStatus: player.status,
    failure: player.failure
  });
  const activeTrack = trackTrust.track || '';
  const playbackState =
    current && player.status === 'buffering'
      ? {
          label:
            player.transport.recentFailures.length > 0
              ? t('dock.reconnecting')
              : t('dock.buffering'),
          tone: 'warning'
        }
      : current &&
          player.failure &&
          ['mixed-content', 'api-unavailable', 'unsupported-transport'].includes(
            player.failure.kind
          )
        ? {
            label: t('dock.externalOpen'),
            tone: 'warning'
          }
        : current && player.transport.activeCandidate?.isFallback
          ? {
              label: t('dock.fallbackCandidate'),
              tone: 'accent'
            }
          : null;
  const stationTitle = current?.name || t('dock.emptyTitle');
  const trackTitle = activeTrack
    ? activeTrack
    : current
      ? t('dock.currentTrackUnavailable')
      : t('dock.emptySubtitle');
  const trackAriaLabel = activeTrack
    ? t('dock.copyCurrentTrack')
    : playbackState?.label || trackTitle;
  const volumePercent = Math.round(player.volume * 100);
  const isMuted = player.volume <= 0.01;
  const showQueueButton = queueCount > 0;
  const showExploreButton = !current && queueCount === 0;

  useEffect(() => {
    if (player.volume > 0.01) {
      lastAudibleVolumeRef.current = player.volume;
    }
  }, [player.volume]);

  useEffect(() => {
    if (playerPresentation !== 'bar') {
      setTrayMode(null);
    }
  }, [playerPresentation]);

  useEffect(
    () => () => {
      if (volumePressTimerRef.current !== null) {
        window.clearTimeout(volumePressTimerRef.current);
      }
    },
    []
  );

  const openLibraryTab = (tab: 'queue' | 'tracks' | 'history') => {
    setTrayMode(null);
    setLibraryTab(tab);
    setActiveSection('library');
  };

  const openSearch = () => {
    setTrayMode(null);
    setActiveSection('search');
  };

  const toggleMute = () => {
    player.setVolume(isMuted ? lastAudibleVolumeRef.current || 0.8 : 0);
  };

  const clearVolumePressTimer = () => {
    if (volumePressTimerRef.current === null) return;
    window.clearTimeout(volumePressTimerRef.current);
    volumePressTimerRef.current = null;
  };

  const handleVolumePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (trayMode === 'volume') return;
    clearVolumePressTimer();
    volumeLongPressTriggeredRef.current = false;
    volumePointerStartRef.current = { x: event.clientX, y: event.clientY };
    volumePressTimerRef.current = window.setTimeout(() => {
      volumePressTimerRef.current = null;
      volumeLongPressTriggeredRef.current = true;
      setTrayMode('volume');
    }, 450);
  };

  const handleVolumePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const start = volumePointerStartRef.current;
    if (!start || volumePressTimerRef.current === null) return;
    if (
      Math.abs(event.clientX - start.x) > VOLUME_LONG_PRESS_CANCEL_PX ||
      Math.abs(event.clientY - start.y) > VOLUME_LONG_PRESS_CANCEL_PX
    ) {
      clearVolumePressTimer();
    }
  };

  const handleVolumePointerEnd = () => {
    clearVolumePressTimer();
    volumePointerStartRef.current = null;
  };

  const handleVolumeClick = () => {
    clearVolumePressTimer();
    if (volumeLongPressTriggeredRef.current) {
      volumeLongPressTriggeredRef.current = false;
      return;
    }
    if (trayMode === 'volume') {
      setTrayMode(null);
      return;
    }
    toggleMute();
  };

  const openFullPlayer = () => {
    if (!current) return;
    setTrayMode(null);
    winamp.setExpanded(true);
  };

  const playQueuePreview = (stationId: string, fallbackIndex: number) => {
    const queueIndex = queue.items.findIndex((station) => station.stationuuid === stationId);
    if (queueIndex >= 0) {
      queue.playAtIndex(queueIndex);
      setTrayMode(null);
      return;
    }

    const station = queuePreview[fallbackIndex];
    if (!station) return;
    playStation(station, {
      playlist: queue.items.length ? queue.items : [station],
      sourceId: queue.sourceId || 'dock-queue',
      sourceLabel: queueSourceLabel
    });
    setTrayMode(null);
  };

  if (playerPresentation === 'expanded' && winamp.expanded) {
    return null;
  }

  if (playerPresentation === 'peek') {
    return (
      <div className="player-dock player-dock-peek" data-empty={isDormantDock ? 'true' : 'false'}>
        <button
          className={`player-peek-handle ${isDormantDock ? 'dormant' : ''}`}
          type="button"
          onClick={() => setPlayerPresentation('bar')}
        >
          <span className="player-peek-pill" />
          <span className="player-peek-label">{current ? current.name : t('dock.peekLabel')}</span>
          {!isDormantDock ? (
            <span className="player-peek-meta">
              {queueCount ? t('dock.queueCount', { count: queueCount }) : t('dock.peekHint')}
            </span>
          ) : null}
        </button>
      </div>
    );
  }

  return (
    <div
      className="player-dock player-dock-bar"
      data-has-station={current ? 'true' : 'false'}
      data-tray-open={trayMode ? 'true' : 'false'}
      data-track-trust={trackTrust.kind}
    >
      <div className="player-dock-media">
        <button
          className="player-dock-artwork-trigger"
          type="button"
          onClick={openFullPlayer}
          disabled={!current}
          aria-label={current ? t('dock.openWinamp') : stationTitle}
          title={current ? t('dock.openWinamp') : stationTitle}
        >
          <StationArtwork station={current} size="dock" />
        </button>
      </div>

      {trayMode ? (
        <div
          className="player-dock-tray"
          data-mode={trayMode}
          role="region"
          aria-label={trayMode === 'volume' ? t('dock.volume') : t('playlist.title')}
        >
          <div className="player-dock-tray-panel">
            {trayMode === 'volume' ? (
              <>
                <div className="player-dock-tray-head">
                  <div className="player-dock-tray-subtitle" aria-live="polite">
                    {volumePercent}%
                  </div>
                  <button
                    className="dock-mini-btn"
                    type="button"
                    onClick={() =>
                      player.setVolume(player.volume > 0.01 ? 0 : lastAudibleVolumeRef.current || 0.8)
                    }
                    aria-label={t('dock.volume')}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      {player.volume > 0.01 ? (
                        <path d="M5 9v6h4l5 4V5l-5 4H5Zm11.5 3a4.5 4.5 0 0 0-2.5-4.03v8.06A4.5 4.5 0 0 0 16.5 12Zm1.5 0c0 2.42-1.18 4.56-3 5.88v-1.95a5.49 5.49 0 0 0 0-7.86V6.12c1.82 1.32 3 3.46 3 5.88Z" />
                      ) : (
                        <path d="M15 12a5.5 5.5 0 0 1-.96 3.12l1.43 1.43A7.45 7.45 0 0 0 17 12c0-1.78-.62-3.42-1.66-4.7l-1.42 1.42A5.5 5.5 0 0 1 15 12ZM3.27 2 2 3.27 6.73 8H5v8h4l5 4v-6.73L18.73 18 20 16.73 3.27 2ZM12 8.83v6.34l-2.8-2.24-.57-.46H7V10h1.63l.57-.46L12 8.83Z" />
                      )}
                    </svg>
                  </button>
                </div>
                <label className="player-dock-volume" aria-label={t('dock.volume')}>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={volumePercent}
                    onChange={(event) => player.setVolume(Number(event.target.value) / 100)}
                  />
                </label>
                <div className="player-dock-tray-actions">
                  <button
                    className="chip dock-theme-btn"
                    type="button"
                    onClick={() => {
                      setTrayMode(null);
                      setSkinLabOpen(true);
                    }}
                  >
                    {t('theme.openStudio')}
                  </button>
                </div>
              </>
            ) : (
              <div className="player-dock-queue-tray">
                <div className="player-dock-tray-head player-dock-queue-head">
                  <div>
                    <div className="player-dock-tray-title">{queueSourceLabel}</div>
                    <div className="player-dock-tray-subtitle">{queueProgressLabel}</div>
                  </div>
                  <button
                    className={`dock-mini-btn ${
                      activeSection === 'library' && libraryTab === 'queue' ? 'active' : ''
                    }`}
                    type="button"
                    onClick={() => openLibraryTab('queue')}
                    aria-label={t('dock.queueOpen')}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M4 6h16v2H4V6Zm0 5h10v2H4v-2Zm0 5h16v2H4v-2Z" />
                    </svg>
                  </button>
                </div>
                {queuePreview.length ? (
                  <div className="player-dock-queue-list">
                    {queuePreview.map((station, index) => {
                      const queueIndex = queuePreviewStart + index;
                      const activePreview =
                        queueIndex === resolvedQueueIndex &&
                        current?.stationuuid === station.stationuuid;
                      return (
                        <button
                          key={`${station.stationuuid}-${queueIndex}`}
                          className={`player-dock-queue-item ${activePreview ? 'active' : ''}`}
                          type="button"
                          onClick={() => playQueuePreview(station.stationuuid, index)}
                        >
                          <strong>{station.name}</strong>
                          <span>{stationLocation(station)}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="player-dock-queue-empty">
                    <strong>{t('playlist.title')}</strong>
                    <span>{t('dock.queuePeekEmpty')}</span>
                    <button className="chip active" type="button" onClick={openSearch}>
                      {t('dock.queueEmptyCta')}
                    </button>
                  </div>
                )}
                <div className="chip-row player-dock-queue-actions">
                  <button
                    className="chip active"
                    type="button"
                    onClick={() => openLibraryTab('queue')}
                  >
                    {t('dock.queueOpen')}
                  </button>
                  <button className="chip" type="button" onClick={() => openLibraryTab('tracks')}>
                    {t('dock.copiedTracksOpen')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      <div className="player-dock-meta">
        <button
          className="player-dock-station"
          type="button"
          onClick={() => {
            if (current) {
              setDetailsOpen(true);
            }
          }}
          disabled={!current}
          title={current ? stationLocation(current) : undefined}
        >
          <div className="player-dock-title">{stationTitle}</div>
        </button>
        {playbackState ? (
          <div className={`player-dock-status-pill is-${playbackState.tone}`}>{playbackState.label}</div>
        ) : null}
        <button
          className={`player-dock-track-button ${activeTrack ? 'active' : ''}`}
          type="button"
          onClick={() => {
            if (activeTrack) {
              void copyTrack();
            }
          }}
          disabled={!activeTrack}
          aria-label={trackAriaLabel}
          title={trackAriaLabel}
        >
          <span className="player-dock-track-button-text">{trackTitle}</span>
          {activeTrack ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M16 1H6a2 2 0 0 0-2 2v12h2V3h10V1Zm3 4H10a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H10V7h9v14Z" />
            </svg>
          ) : null}
        </button>
      </div>

      <div className="player-dock-actions">
        {showQueueButton ? (
          <button
            className={`dock-icon-btn dock-queue-btn ${trayMode === 'queue' ? 'active' : ''}`}
            type="button"
            onClick={() => setTrayMode((prev) => (prev === 'queue' ? null : 'queue'))}
            aria-label={t('dock.queueOpen')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 6h16v2H4V6Zm0 5h10v2H4v-2Zm0 5h16v2H4v-2Z" />
            </svg>
          </button>
        ) : null}
        {showExploreButton ? (
          <button
            className="dock-icon-btn dock-explore-btn"
            type="button"
            onClick={openSearch}
            aria-label={t('dock.queueEmptyCta')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M10.5 4a6.5 6.5 0 0 1 5.16 10.45l4.45 4.44-1.42 1.42-4.44-4.45A6.5 6.5 0 1 1 10.5 4Zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z" />
            </svg>
          </button>
        ) : null}
        <button
          className={`dock-icon-btn dock-volume-btn ${trayMode === 'volume' ? 'active' : ''}`}
          type="button"
          data-muted={isMuted ? 'true' : 'false'}
          onPointerDown={handleVolumePointerDown}
          onPointerMove={handleVolumePointerMove}
          onPointerUp={handleVolumePointerEnd}
          onPointerLeave={handleVolumePointerEnd}
          onPointerCancel={handleVolumePointerEnd}
          onClick={handleVolumeClick}
          onContextMenu={(event) => event.preventDefault()}
          aria-label={isMuted ? t('dock.unmute') : t('dock.mute')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {isMuted ? (
              <path d="M3.27 2 2 3.27 6.73 8H5v8h4l5 4v-6.73L18.73 18 20 16.73 3.27 2ZM12 8.83v6.34l-2.8-2.24-.57-.46H7V10h1.63l.57-.46L12 8.83Z" />
            ) : (
              <path d="M5 9v6h4l5 4V5l-5 4H5Zm11.5 3a4.5 4.5 0 0 0-2.5-4.03v8.06A4.5 4.5 0 0 0 16.5 12Z" />
            )}
          </svg>
        </button>
        <button
          className={`dock-icon-btn dock-play-btn ${current && player.isPlaying ? 'active' : ''}`}
          type="button"
          onClick={() => {
            if (current) {
              void player.toggle();
            }
          }}
          disabled={!current}
          aria-label={player.isPlaying ? t('common.pause') : t('common.play')}
        >
          <ThemeActionIcon name={player.isPlaying ? 'pause' : 'play'}>
            {player.isPlaying ? (
              <path d="M7 5h4v14H7zm6 0h4v14h-4z" />
            ) : (
              <path d="M8 5v14l11-7z" />
            )}
          </ThemeActionIcon>
        </button>
        <button
          className="dock-icon-btn dock-next-btn"
          type="button"
          onClick={playNext}
          aria-label={t('common.next')}
        >
          <ThemeActionIcon name="next">
            <path d="M6 6v12l8.5-6L6 6Zm9 0v12h2V6h-2Z" />
          </ThemeActionIcon>
        </button>
        <button
          className={`dock-icon-btn dock-like-btn ${liked ? 'active' : ''}`}
          type="button"
          onClick={() => current && toggleFavorite(current)}
          disabled={!current}
          aria-label={liked ? t('stationTable.unfavorite') : t('stationTable.favorite')}
        >
          <ThemeActionIcon name="like">
            <path d="M12 21.2l-1.4-1.3C5.4 15.4 2 12.3 2 8.4 2 5.6 4.2 3.5 7 3.5c1.6 0 3.2.7 4.2 2 1-1.3 2.6-2 4.2-2 2.8 0 5 2.1 5 4.9 0 3.9-3.4 7-8.6 11.4L12 21.2z" />
          </ThemeActionIcon>
        </button>
      </div>
    </div>
  );
};

import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { normalizeStationName, stationLocation } from '../lib/stationUtils';
import { triggerHaptic } from '../lib/telegram';
import { resolveNowPlayingTrust } from '../lib/trackTrust';
import { SLEEP_TIMER_PRESETS_MIN, formatSleepRemaining } from '../lib/sleepTimer';
import { useLocale } from '../state/LocaleContext';
import { latestTrackForStation } from '../state/radio/helpers';
import { useLibrary, usePlayback, useShell } from '../state/RadioContext';
import { StationArtwork } from './StationArtwork';
import { ThemeActionIcon } from './ThemeActionIcon';
import './MiniPlayerDock.css';

type DockTrayMode = 'queue' | 'volume' | 'more' | null;

// Icons for the «Ещё» (more-functions) tray. Same glyphs as the full-player
// action sheet so the dock shortcut and the full player read identically —
// Artem wanted the ☰ button to surface the extra functions (sleep timer,
// share, open-in-browser, station details, hide-from-recs) Yandex/Spotify
// style, without having to open the full player to reach them.
const MORE_ICON = {
  more: 'M12 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm0 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm0 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z',
  queue:
    'M3 6h12v2H3V6Zm0 5h12v2H3v-2Zm0 5h8v2H3v-2Zm16-2.55V6h2v9.5a3.25 3.25 0 1 1-2-3.05ZM17.75 19a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z',
  details: 'M11 17h2v-6h-2v6Zm1-14a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 16a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm-1-9h2V7h-2v3Z',
  share:
    'M18 16.1c-.76 0-1.44.3-1.96.77L8.9 12.7c.06-.23.1-.46.1-.7s-.04-.47-.1-.7l7.06-4.12A2.99 2.99 0 1 0 15 5c0 .24.04.47.1.7L8.04 9.82A3 3 0 1 0 8.04 14.2l7.13 4.18c-.05.2-.08.41-.08.62A2.91 2.91 0 1 0 18 16.1Z',
  external:
    'M19 19H5V5h7V3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7ZM14 3v2h3.6l-9.8 9.8 1.4 1.4L19 6.4V10h2V3h-7Z',
  hide: 'M12 5c5 0 8.5 4.5 9.7 6.2.22.3.22.7 0 1C20.5 14 17 18.5 12 18.5S3.5 14 2.3 12.2a.86.86 0 0 1 0-1C3.5 9.5 7 5 12 5Zm0 2C8.5 7 5.8 9.7 4.4 11.7 5.8 13.8 8.5 16.5 12 16.5s6.2-2.7 7.6-4.8C18.2 9.7 15.5 7 12 7Zm0 1.5a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4Z',
  sleep: 'M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z'
} as const;

export const MiniPlayerDock = () => {
  const { t } = useLocale();
  const {
    player,
    nowPlaying,
    nowPlayingStatus,
    queue,
    playNext,
    playStation,
    copyTrack,
    openExternal,
    shareStation,
    sleepTimer,
    startSleepTimer,
    cancelSleepTimer
  } = usePlayback();
  const {
    toggleFavorite,
    isFavorite,
    trackHistory,
    hideStationFromRecommendations,
    unhideStationFromRecommendations,
    isStationHiddenFromRecommendations
  } = useLibrary();
  const {
    playerPresentation,
    setPlayerPresentation,
    activeSection,
    setActiveSection,
    libraryTab,
    setLibraryTab,
    setDetailsOpen,
    winamp
  } = useShell();
  const [trayMode, setTrayMode] = useState<DockTrayMode>(null);
  const lastAudibleVolumeRef = useRef(player.volume || 0.8);
  const artworkRef = useRef<HTMLButtonElement>(null);

  // P3-3d: subtle dock micro-reactivity. The always-visible dock artwork picks
  // up a faint accent glow that breathes with the audio energy, fed by the same
  // pump as the full-player spectrum/backdrop. Energy is written to --ra-energy
  // via DIRECT DOM — no React state per frame. We only subscribe while playback
  // is live (visualizer.active), so the pump never spins up just for the dock;
  // paused / no-data falls back to a calm CSS idle pulse.
  const visualizerActive = player.visualizer.active;
  const subscribeVisualizer = player.subscribeVisualizer;
  useEffect(() => {
    if (!visualizerActive) return undefined;
    let smoothed = 0;
    const unsubscribe = subscribeVisualizer((frame) => {
      const node = artworkRef.current;
      if (!node) return;
      const { spectrum } = frame;
      const count = Math.min(spectrum.length, 14);
      let sum = 0;
      for (let index = 0; index < count; index += 1) sum += spectrum[index] ?? 0;
      const energy = count > 0 ? sum / count : 0;
      smoothed += (energy - smoothed) * 0.25;
      node.style.setProperty('--ra-energy', smoothed.toFixed(3));
    });
    return () => {
      unsubscribe();
      artworkRef.current?.style.removeProperty('--ra-energy');
    };
  }, [visualizerActive, subscribeVisualizer]);

  const current = player.current;
  const liked = current ? isFavorite(current.stationuuid) : false;
  const stationHidden = current
    ? isStationHiddenFromRecommendations(current.stationuuid)
    : false;
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
  // Last-heard fallback (see FullPlayerOverlay): only once the live metadata has
  // resolved EMPTY ('unavailable'), never while loading; dimmed + labeled, never
  // copyable (the copy guard stays bound to activeTrack/live).
  const lastHeard = useMemo(
    () =>
      nowPlayingStatus === 'unavailable' && !trackTrust.track && current
        ? latestTrackForStation(trackHistory, current.stationuuid)
        : null,
    [nowPlayingStatus, trackTrust.track, current, trackHistory]
  );
  const isLastHeard = !activeTrack && Boolean(lastHeard);
  const playbackState: { label: string; tone: 'warning' | 'accent'; onAction?: () => void } | null =
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
            // A blocked transport can't play in-app, but the stream opens fine in
            // a browser — make the pill actually do that instead of being a label.
            label: t('dock.externalOpen'),
            tone: 'warning',
            onAction: () => openExternal(current)
          }
        : current && player.status === 'error'
          ? {
              // Stream exhausted / failed (e.g. no-playable-candidate): the play
              // button is disabled, so without this the dock is a silent dead end.
              // Give a one-tap retry.
              label: t('dock.retry'),
              tone: 'warning',
              onAction: () => playStation(current)
            }
          : current && player.transport.activeCandidate?.isFallback
            ? {
                label: t('dock.fallbackCandidate'),
                tone: 'accent'
              }
            : null;
  const stationTitle = normalizeStationName(current?.name) || t('dock.emptyTitle');
  const trackTitle = activeTrack
    ? activeTrack
    : lastHeard?.track
      ? lastHeard.track
      : current
        ? t('dock.currentTrackUnavailable')
        : t('dock.emptySubtitle');
  const trackAriaLabel = activeTrack
    ? t('dock.copyCurrentTrack')
    : isLastHeard
      ? t('dock.lastHeardAria', { track: lastHeard!.track })
      : playbackState?.label || trackTitle;
  const volumePercent = Math.round(player.volume * 100);
  const isMuted = player.volume <= 0.01;
  const showMoreButton = Boolean(current) || queueCount > 0;
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

  // Volume button UX: click = open the slider tray (the natural
  // affordance — that's what the speaker icon should do).
  // The mute icon lives inside the tray as a secondary action,
  // which is also where the user looks once the tray is open.
  // Right-click / middle-click on the volume button mutes
  // directly without opening the tray, for users who really do
  // want a one-click mute.
  const handleVolumeClick = () => {
    setTrayMode(trayMode === 'volume' ? null : 'volume');
  };
  const handleVolumeAuxClick = (event: PointerEvent<HTMLButtonElement>) => {
    // Only react to middle-click (button=1) and right-click
    // (button=2). Left-click already goes through onClick above.
    if (event.button === 1 || event.button === 2) {
      event.preventDefault();
      toggleMute();
    }
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
          ref={artworkRef}
          className="player-dock-artwork-trigger"
          data-dock-reactive
          data-active={visualizerActive ? 'true' : 'false'}
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
          aria-label={
            trayMode === 'volume'
              ? t('dock.volume')
              : trayMode === 'more'
                ? t('dock.more')
                : t('playlist.title')
          }
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
                    aria-label={t('dock.mute')}
                    aria-pressed={isMuted}
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
              </>
            ) : trayMode === 'more' ? (
              <div className="player-dock-more-tray">
                <div className="player-dock-tray-head">
                  <div className="player-dock-tray-title">{t('dock.more')}</div>
                </div>
                <div className="player-dock-more-list">
                  <button
                    className="player-dock-more-row"
                    type="button"
                    onClick={() => setTrayMode('queue')}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d={MORE_ICON.queue} />
                    </svg>
                    <span>{t('playlist.title')}</span>
                    {queueCount ? <em>{queueCount}</em> : null}
                  </button>
                  <button
                    className="player-dock-more-row"
                    type="button"
                    onClick={() => {
                      if (!current) return;
                      setTrayMode(null);
                      setDetailsOpen(true);
                    }}
                    disabled={!current}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d={MORE_ICON.details} />
                    </svg>
                    <span>{t('winamp.stationDetails')}</span>
                  </button>
                  <button
                    className="player-dock-more-row"
                    type="button"
                    onClick={() => {
                      if (current) void shareStation(current);
                      setTrayMode(null);
                    }}
                    disabled={!current}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d={MORE_ICON.share} />
                    </svg>
                    <span>{t('common.share')}</span>
                  </button>
                  <button
                    className="player-dock-more-row"
                    type="button"
                    onClick={() => {
                      if (current) openExternal(current);
                      setTrayMode(null);
                    }}
                    disabled={!current?.url_resolved}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d={MORE_ICON.external} />
                    </svg>
                    <span>{t('common.openBrowser')}</span>
                  </button>
                  <button
                    className={`player-dock-more-row ${stationHidden ? 'active' : ''}`}
                    type="button"
                    onClick={() => {
                      if (!current) return;
                      if (stationHidden) unhideStationFromRecommendations(current);
                      else hideStationFromRecommendations(current);
                      setTrayMode(null);
                    }}
                    disabled={!current}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d={MORE_ICON.hide} />
                    </svg>
                    <span>
                      {stationHidden
                        ? t('details.showInRecommendations')
                        : t('details.hideFromRecommendations')}
                    </span>
                  </button>
                </div>
                <div className="player-dock-more-sleep">
                  <div className="player-dock-tray-subtitle">
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      className="player-dock-more-sleep-icon"
                    >
                      <path d={MORE_ICON.sleep} />
                    </svg>
                    {t('settings.sleepTimerLabel')}
                    {sleepTimer.active ? ` · ${formatSleepRemaining(sleepTimer.remainingMs)}` : ''}
                  </div>
                  <div className="chip-row">
                    {sleepTimer.active ? (
                      <button className="chip active" type="button" onClick={() => cancelSleepTimer()}>
                        {t('settings.sleepStop')}
                      </button>
                    ) : (
                      SLEEP_TIMER_PRESETS_MIN.map((min) => (
                        <button
                          key={min}
                          className="chip"
                          type="button"
                          onClick={() => startSleepTimer(min)}
                        >
                          {min} {t('settings.sleepMin')}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>
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
                          <strong>{normalizeStationName(station.name)}</strong>
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
                  <button
                    className="chip"
                    type="button"
                    onClick={() => queue.shuffleQueue()}
                    disabled={queue.items.length <= 1}
                    aria-label={t('library.shuffleQueueAria')}
                  >
                    {t('library.shuffleQueue')}
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
          playbackState.onAction ? (
            <button
              type="button"
              className={`player-dock-status-pill is-${playbackState.tone}`}
              onClick={playbackState.onAction}
            >
              {playbackState.label}
            </button>
          ) : (
            <div className={`player-dock-status-pill is-${playbackState.tone}`}>
              {playbackState.label}
            </div>
          )
        ) : null}
        <button
          className={`player-dock-track-button ${activeTrack ? 'active' : ''}`}
          type="button"
          data-last-heard={isLastHeard ? 'true' : undefined}
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
        {showMoreButton ? (
          <button
            className={`dock-icon-btn dock-more-btn ${trayMode === 'more' ? 'active' : ''}`}
            type="button"
            onClick={() => setTrayMode((prev) => (prev === 'more' ? null : 'more'))}
            aria-label={t('dock.more')}
            aria-expanded={trayMode === 'more'}
            title={t('dock.more')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={MORE_ICON.more} />
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
          onClick={handleVolumeClick}
          onAuxClick={handleVolumeAuxClick}
          // Suppress the system context menu so a right-click can
          // mute without opening the browser's "Inspect Element"
          // dialog. The actual mute is handled in handleVolumeAuxClick
          // via the auxclick event.
          onContextMenu={(event) => {
            event.preventDefault();
            toggleMute();
          }}
          aria-label={t('dock.volume')}
          aria-expanded={trayMode === 'volume'}
          title={t('dock.volume')}
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
              triggerHaptic();
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
          onClick={() => {
            triggerHaptic();
            playNext();
          }}
          aria-label={t('common.next')}
        >
          <ThemeActionIcon name="next">
            <path d="M6 6v12l8.5-6L6 6Zm9 0v12h2V6h-2Z" />
          </ThemeActionIcon>
        </button>
        <button
          className={`dock-icon-btn dock-like-btn ${liked ? 'active' : ''}`}
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
          <ThemeActionIcon name="like">
            <path d="M12 21.2l-1.4-1.3C5.4 15.4 2 12.3 2 8.4 2 5.6 4.2 3.5 7 3.5c1.6 0 3.2.7 4.2 2 1-1.3 2.6-2 4.2-2 2.8 0 5 2.1 5 4.9 0 3.9-3.4 7-8.6 11.4L12 21.2z" />
          </ThemeActionIcon>
        </button>
      </div>
    </div>
  );
};

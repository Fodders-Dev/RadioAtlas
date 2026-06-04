import { useEffect, useState } from 'react';
import { canShareToStory, shareStationToStory } from '../lib/telegram';
import { useLocale } from '../state/LocaleContext';
import { useLibrary, usePlayback, useShell } from '../state/RadioContext';
import WinampOverlay from './winampShell/WinampOverlay';
import type { StationLite } from '../types';
import { StationArtwork } from './StationArtwork';
import './winampShell/winamp.css';

type ResponsiveExpandedMode = 'mobile' | 'desktop';

const getOverlayMode = (): ResponsiveExpandedMode =>
  typeof window !== 'undefined' && window.innerWidth < 760 ? 'mobile' : 'desktop';

export const LitePlayerOverlay = ({
  onDetails
}: {
  onDetails?: () => void;
}) => {
  const { t } = useLocale();
  const {
    player,
    queue,
    nowPlaying,
    playNext,
    playStation,
    playLast,
    copyTrack,
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
  const { winamp, openWebAppExternally } = useShell();
  const [expandedLayoutMode, setExpandedLayoutMode] = useState<ResponsiveExpandedMode>(() =>
    getOverlayMode()
  );

  const current = player.current;
  const liked = current ? isFavorite(current.stationuuid) : false;
  const stationHidden = current ? isStationHiddenFromRecommendations(current.stationuuid) : false;
  const canResume = Boolean(playbackHistory.length || queue.items.length);
  const trackTitle = nowPlaying?.trim() || '';
  const canCopyTrackTitle = Boolean(trackTitle);
  const queueLabel = queue.sourceLabel || t('radio.queueDefault');

  useEffect(() => {
    const syncMode = () => setExpandedLayoutMode(getOverlayMode());
    syncMode();
    window.addEventListener('resize', syncMode);
    window.addEventListener('orientationchange', syncMode);
    return () => {
      window.removeEventListener('resize', syncMode);
      window.removeEventListener('orientationchange', syncMode);
    };
  }, []);

  const transportButton = (
    <button
      className={`chip ${current && player.isPlaying ? 'active' : ''}`}
      type="button"
      onClick={() => {
        if (current) {
          void player.toggle();
          return;
        }
        playLast();
      }}
      disabled={!current && !canResume}
    >
      {current ? (player.isPlaying ? t('common.pause') : t('common.play')) : t('common.resume')}
    </button>
  );

  const nextButton = (
    <button className="chip" type="button" onClick={playNext}>
      {t('common.next')}
    </button>
  );

  const favoriteButton = (
    <button
      className={`icon-btn ${liked ? 'active' : ''}`}
      onClick={() => current && toggleFavorite(current)}
      type="button"
      disabled={!current}
      aria-label={liked ? t('stationTable.unfavorite') : t('stationTable.favorite')}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 21.2l-1.4-1.3C5.4 15.4 2 12.3 2 8.4 2 5.6 4.2 3.5 7 3.5c1.6 0 3.2.7 4.2 2 1-1.3 2.6-2 4.2-2 2.8 0 5 2.1 5 4.9 0 3.9-3.4 7-8.6 11.4L12 21.2z" />
      </svg>
    </button>
  );

  const appButton = (
    <button
      className="icon-btn"
      onClick={openWebAppExternally}
      type="button"
      title={t('common.openBrowser')}
      aria-label={t('common.openApp')}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M19 19H5V5h7V3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.6l-9.8 9.8 1.4 1.4L19 6.4V10h2V3h-7z" />
      </svg>
    </button>
  );

  const actionStrip = (
    <div className="winamp-actions overlay">
      {transportButton}
      {nextButton}
      {favoriteButton}
      {onDetails && (
        <button
          className="chip"
          onClick={() => current && onDetails()}
          type="button"
          disabled={!current}
        >
          {t('common.info')}
        </button>
      )}
      <button
        className={`chip ${stationHidden ? 'active' : ''}`}
        onClick={() =>
          current &&
          (stationHidden
            ? unhideStationFromRecommendations(current)
            : hideStationFromRecommendations(current))
        }
        type="button"
        disabled={!current}
      >
        {stationHidden ? t('details.showInRecommendations') : t('details.hideFromRecommendations')}
      </button>
      <button
        className="chip"
        onClick={() => current && shareStation(current)}
        type="button"
        disabled={!current}
      >
        {t('common.share')}
      </button>
      {canShareToStory() && (
        <button
          className="chip"
          onClick={() => current && shareStationToStory(current)}
          type="button"
          disabled={!current}
        >
          {t('common.shareStory')}
        </button>
      )}
      {appButton}
      <button className="chip" type="button" onClick={copyTrack} disabled={!canCopyTrackTitle}>
        {t('common.song')}
      </button>
    </div>
  );

  const trackLine = (
    <button
      className="winamp-trackline overlay"
      type="button"
      onClick={() => {
        if (canCopyTrackTitle) {
          void copyTrack();
        }
      }}
      disabled={!canCopyTrackTitle}
      title={canCopyTrackTitle ? t('winamp.copyTrackTitle') : t('winamp.trackUnavailable')}
      aria-label={
        canCopyTrackTitle
          ? `${t('winamp.copyTrackTitle')}: ${trackTitle}`
          : t('winamp.trackUnavailable')
      }
    >
      <span className="winamp-trackline-label">
        {trackTitle || current?.name || t('winamp.trackUnavailable')}
      </span>
    </button>
  );

  const playOverlayQueueStation = (station: StationLite) => {
    playStation(station, {
      playlist: queue.items.length ? queue.items : [station],
      sourceId: queue.sourceId || 'overlay-queue',
      sourceLabel: queueLabel
    });
  };

  const playOverlayHistoryStation = (station: StationLite) => {
    playStation(station, {
      playlist: playbackHistory.length ? playbackHistory : [station],
      sourceId: 'history',
      sourceLabel: t('playlist.historyTitle')
    });
  };

  const host = (
    <div className="winamp-lite-host">
      <div className="winamp-lite-panel" data-winamp-lite-panel="true">
        <div className="winamp-overlay-card">
          <div className="winamp-overlay-label">{t('winamp.currentStation')}</div>
          <div className="winamp-overlay-art-row">
            <StationArtwork station={current} size="card" className="winamp-now-artwork" />
            <div>
              <div className="winamp-overlay-title">{current?.name || t('winamp.noStation')}</div>
              <div className="winamp-overlay-copy">
                {player.status === 'buffering'
                  ? t('dock.buffering')
                  : trackTitle || t('winamp.trackUnavailable')}
              </div>
            </div>
          </div>
        </div>
        <div className="winamp-overlay-card">
          <div className="winamp-overlay-label">{t('winamp.nowTuned')}</div>
          <div className="winamp-overlay-title">{queueLabel}</div>
          <div className="winamp-overlay-copy">
            {t('winamp.queueReady', { count: queue.items.length })}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div
      className="winamp-compact fullscreen-ui"
      data-expanded-layout={expandedLayoutMode}
      data-winamp-mode="lite"
      role={expandedLayoutMode === 'mobile' ? 'dialog' : undefined}
      aria-modal={expandedLayoutMode === 'mobile' ? 'true' : undefined}
      style={
        expandedLayoutMode === 'mobile'
          ? {
              position: 'fixed',
              inset: '0',
              bottom: 'auto',
              left: '0',
              right: '0',
              width: '100vw',
              maxWidth: '100vw',
              height: '100vh',
              alignItems: 'stretch',
              justifyContent: 'stretch',
              overflow: 'hidden'
            }
          : {
              minHeight: '100%',
              height: '100%',
              alignItems: 'stretch',
              justifyContent: 'stretch'
            }
      }
    >
      <WinampOverlay
        actionStrip={actionStrip}
        current={current}
        expandedLayoutMode={expandedLayoutMode}
        host={host}
        loading={null}
        mainStyle={{
          flex: '1 1 auto',
          width: '100%',
          height: '100%',
          minHeight: 0,
          alignItems: 'stretch',
          justifyContent: 'flex-start',
          padding:
            expandedLayoutMode === 'mobile'
              ? 'calc(58px + env(safe-area-inset-top)) 8px calc(88px + env(safe-area-inset-bottom))'
              : 'calc(54px + env(safe-area-inset-top)) 10px calc(76px + env(safe-area-inset-bottom))'
        }}
        onClose={() => winamp.setExpanded(false)}
        onDetails={onDetails}
        onHideStation={() =>
          current &&
          (stationHidden
            ? unhideStationFromRecommendations(current)
            : hideStationFromRecommendations(current))
        }
        onPlayHistoryStation={playOverlayHistoryStation}
        onPlayQueueStation={playOverlayQueueStation}
        onResetLayout={() => {}}
        playbackHistory={playbackHistory}
        queue={queue}
        showVisualizer
        stationHidden={stationHidden}
        subscribeVisualizer={player.subscribeVisualizer}
        t={t}
        trackHistory={trackHistory}
        trackLine={trackLine}
        visualizer={{
          // P3-3b: the now theme-driven milkdrop is re-enabled and audio-reactive.
          // active/available follow real playback; live spectrum/waveform arrive
          // through subscribeVisualizer (the same pump as the canonical player —
          // one analyser), so these seed arrays stay empty. When there's no live
          // data (paused / iOS lean / silent) the canvas falls back to the
          // time-animated themed blob.
          active: player.visualizer.active,
          available: player.visualizer.available,
          spectrum: [],
          waveform: []
        }}
      />
    </div>
  );
};

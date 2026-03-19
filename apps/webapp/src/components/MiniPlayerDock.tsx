import { useEffect, useRef, useState } from 'react';
import { stationLocation } from '../lib/stationUtils';
import { useLocale } from '../state/LocaleContext';
import { useRadio } from '../state/RadioContext';

type DockTrayMode = 'history' | 'volume' | null;

export const MiniPlayerDock = () => {
  const { t } = useLocale();
  const {
    player,
    nowPlaying,
    nowPlayingStatus,
    queue,
    trackHistory,
    playNext,
    copyTrack,
    playerPresentation,
    setPlayerPresentation,
    setDetailsOpen,
    toggleFavorite,
    isFavorite,
    setActiveSection,
    setLibraryTab,
    winamp
  } = useRadio();
  const [trayMode, setTrayMode] = useState<DockTrayMode>(null);
  const lastAudibleVolumeRef = useRef(player.volume || 0.8);

  const current = player.current;
  const liked = current ? isFavorite(current.stationuuid) : false;
  const subtitle = current ? stationLocation(current) : t('dock.emptySubtitle');
  const queueCount = Math.max(queue.items.length, 0);
  const activeTrack = nowPlaying?.trim() || '';
  const primaryTitle = activeTrack || current?.name || t('dock.emptyTitle');
  const secondaryTitle = activeTrack
    ? current?.name || t('dock.emptySubtitle')
    : nowPlayingStatus === 'loading'
      ? t('common.loading')
      : nowPlayingStatus === 'unavailable'
        ? t('dock.currentTrackUnavailable')
        : subtitle;
  const tertiaryCopy = activeTrack && current ? subtitle : '';
  const historyPreview = trackHistory.slice(0, 5);
  const volumePercent = Math.round(player.volume * 100);

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

  if (playerPresentation === 'expanded' && winamp.expanded) {
    return null;
  }

  if (playerPresentation === 'peek') {
    return (
      <div className="player-dock player-dock-peek">
        <button
          className="player-peek-handle"
          type="button"
          onClick={() => setPlayerPresentation('bar')}
        >
          <span className="player-peek-pill" />
          <span>{current ? current.name : t('dock.peekLabel')}</span>
          <span className="player-peek-meta">
            {queueCount ? t('dock.queueCount', { count: queueCount }) : t('dock.peekHint')}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div
      className="player-dock player-dock-bar"
      data-has-station={current ? 'true' : 'false'}
      data-tray-open={trayMode ? 'true' : 'false'}
    >
      {trayMode ? (
        <div className="player-dock-tray" role="region" aria-label={trayMode === 'volume' ? t('dock.volume') : t('dock.copiedTracks')}>
          {trayMode === 'volume' ? (
            <div className="player-dock-tray-panel">
              <div className="player-dock-tray-head">
                <div>
                  <div className="player-dock-tray-title">{t('dock.volume')}</div>
                  <div className="player-dock-tray-subtitle">{volumePercent}%</div>
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
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 9v6h4l5 4V5l-5 4H5Z" />
                </svg>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={volumePercent}
                  onChange={(event) => player.setVolume(Number(event.target.value) / 100)}
                />
              </label>
            </div>
          ) : (
            <div className="player-dock-tray-panel">
              <div className="player-dock-tray-head">
                <div>
                  <div className="player-dock-tray-title">{t('dock.copiedTracks')}</div>
                  <div className="player-dock-tray-subtitle">
                    {trackHistory.length
                      ? t('library.trackJournalCount', { count: trackHistory.length })
                      : t('dock.copiedTracksEmpty')}
                  </div>
                </div>
                <button
                  className="dock-mini-btn"
                  type="button"
                  onClick={() => {
                    setActiveSection('library');
                    setLibraryTab('history');
                  }}
                >
                  {t('dock.copiedTracksOpen')}
                </button>
              </div>
              <div className="player-dock-tray-actions">
                <button
                  className="dock-mini-btn"
                  type="button"
                  onClick={() => {
                    if (activeTrack) {
                      void copyTrack();
                    }
                  }}
                  disabled={!activeTrack}
                >
                  {t('dock.copyCurrentTrack')}
                </button>
                <button
                  className={`dock-mini-btn ${liked ? 'active' : ''}`}
                  type="button"
                  onClick={() => current && toggleFavorite(current)}
                  disabled={!current}
                >
                  {liked ? t('stationTable.unfavorite') : t('stationTable.favorite')}
                </button>
                <button
                  className="dock-mini-btn"
                  type="button"
                  onClick={() => {
                    setActiveSection('library');
                    setLibraryTab('queue');
                  }}
                >
                  {t('dock.queueOpen')}
                </button>
                {trackHistory.length ? (
                  <button className="dock-mini-btn" type="button" onClick={() => void navigator.clipboard.writeText(trackHistory.map((item) => item.track).join('\n'))}>
                    {t('common.copy')}
                  </button>
                ) : null}
              </div>
              {historyPreview.length ? (
                <div className="player-dock-track-list">
                  {historyPreview.map((item) => (
                    <button
                      key={item.id}
                      className="player-dock-track-item"
                      type="button"
                      onClick={() => navigator.clipboard.writeText(item.track)}
                    >
                      <div className="player-dock-track-title">{item.track}</div>
                      <div className="player-dock-track-meta">{item.stationName}</div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="player-dock-empty">{t('dock.copiedTracksEmpty')}</div>
              )}
            </div>
          )}
        </div>
      ) : null}

      <button
        className="player-dock-collapse"
        type="button"
        onClick={() => {
          setTrayMode(null);
          setPlayerPresentation('peek');
        }}
      >
        <span />
        <span />
      </button>

      <button
        className="player-dock-meta"
        type="button"
        onClick={() => {
          if (current) {
            setDetailsOpen(true);
          }
        }}
      >
        <div className="player-dock-kicker">
          {activeTrack ? t('dock.trackLive') : current ? t('dock.liveNow') : t('dock.ready')}
        </div>
        <div className="player-dock-title">{primaryTitle}</div>
        <div className="player-dock-copy">{secondaryTitle}</div>
        {tertiaryCopy ? <div className="player-dock-subcopy">{tertiaryCopy}</div> : null}
      </button>

      <div className="player-dock-actions">
        <button
          className={`dock-icon-btn ${current && player.isPlaying ? 'active' : ''}`}
          type="button"
          onClick={() => {
            if (current) {
              void player.toggle();
            }
          }}
          disabled={!current}
          aria-label={player.isPlaying ? t('common.pause') : t('common.play')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {player.isPlaying ? (
              <path d="M7 5h4v14H7zm6 0h4v14h-4z" />
            ) : (
              <path d="M8 5v14l11-7z" />
            )}
          </svg>
        </button>
        <button className="dock-icon-btn" type="button" onClick={playNext} aria-label={t('common.next')}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6v12l8.5-6L6 6Zm9 0v12h2V6h-2Z" />
          </svg>
        </button>
        <button
          className={`dock-icon-btn ${trayMode === 'volume' ? 'active' : ''}`}
          type="button"
          onClick={() => setTrayMode((prev) => (prev === 'volume' ? null : 'volume'))}
          aria-label={t('dock.volume')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 9v6h4l5 4V5l-5 4H5Zm11.5 3a4.5 4.5 0 0 0-2.5-4.03v8.06A4.5 4.5 0 0 0 16.5 12Z" />
          </svg>
        </button>
        <button
          className={`dock-icon-btn ${trayMode === 'history' ? 'active' : ''}`}
          type="button"
          onClick={() => setTrayMode((prev) => (prev === 'history' ? null : 'history'))}
          aria-label={t('dock.more')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 10h14v2H5zm0-5h14v2H5zm0 10h14v2H5z" />
          </svg>
        </button>
        <button
          className="dock-expand-btn"
          type="button"
          onClick={() => {
            setTrayMode(null);
            setPlayerPresentation('expanded');
          }}
          aria-label={t('dock.openWinamp')}
        >
          <span className="dock-expand-btn-label">{t('dock.openWinamp')}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 6h10v2H7zm0 5h10v2H7zm0 5h7v2H7z" />
          </svg>
        </button>
      </div>
    </div>
  );
};

import { useMemo } from 'react';
import { useRadio } from '../state/RadioContext';
import { stationLocation } from '../lib/stationUtils';

export const MiniPlayer = ({
  onDetails
}: {
  onDetails?: () => void;
}) => {
  const {
    player,
    nowPlaying,
    nowPlayingStatus,
    recent,
    playPrevious,
    playNext,
    copyTrack,
    toggleFavorite,
    isFavorite,
    shareStation
  } = useRadio();

  const current = player.current;
  const statusLabel = useMemo(() => {
    if (!current) return 'Pick a station to start listening';
    if (player.status === 'buffering') return 'Buffering...';
    if (player.status === 'error') return 'Stream error, reconnecting';
    if (player.status === 'paused') return 'Paused';
    return 'Live';
  }, [current, player.status]);

  const trackLabel = useMemo(() => {
    if (!current) return null;
    if (nowPlaying) return `Now playing: ${nowPlaying}`;
    if (nowPlayingStatus === 'loading') return 'Fetching track...';
    if (nowPlayingStatus === 'unavailable') return 'Track info unavailable';
    return null;
  }, [current, nowPlaying, nowPlayingStatus]);

  const historyIndex = useMemo(() => {
    if (!current) return -1;
    return recent.findIndex((item) => item.stationuuid === current.stationuuid);
  }, [current, recent]);

  const canPrev = historyIndex >= 0 && historyIndex < recent.length - 1;
  const canNext = historyIndex > 0;
  const liked = current ? isFavorite(current.stationuuid) : false;

  return (
    <div className="mini-player">
      <div className="player-art">
        {current?.favicon ? (
          <img src={current.favicon} alt="" />
        ) : (
          <div className="player-fallback">FM</div>
        )}
      </div>
      <div className="player-meta">
        <div className="player-title">{current?.name ?? 'RadioAtlas'}</div>
        <div className="player-sub">{current ? stationLocation(current) : statusLabel}</div>
        {trackLabel && (
          <button
            className={`player-track ${nowPlaying ? 'track-copy' : ''}`}
            onClick={() => nowPlaying && copyTrack()}
            type="button"
            disabled={!nowPlaying}
            title={nowPlaying ? 'Copy track' : undefined}
          >
            {trackLabel}
          </button>
        )}
        <div className="player-status">{statusLabel}</div>
      </div>
      <div className="player-controls">
        <button
          className="icon-btn"
          onClick={playPrevious}
          type="button"
          disabled={!canPrev}
          aria-label="Previous station"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6h2v12H6V6zm3 6 9 6V6l-9 6z" />
          </svg>
        </button>
        <button
          className="player-btn primary"
          onClick={() => player.toggle()}
          type="button"
          disabled={!current}
        >
          {player.isPlaying ? 'Pause' : 'Play'}
        </button>
        <button
          className="icon-btn"
          onClick={playNext}
          type="button"
          disabled={!canNext}
          aria-label="Next station"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M16 6h2v12h-2V6zM6 18l9-6-9-6v12z" />
          </svg>
        </button>
        {onDetails && (
          <button
            className="player-btn"
            onClick={() => current && onDetails()}
            type="button"
            disabled={!current}
          >
            Info
          </button>
        )}
        {nowPlaying && (
          <button className="player-btn" onClick={copyTrack} type="button">
            Copy
          </button>
        )}
        <button
          className={`icon-btn ${liked ? 'active' : ''}`}
          onClick={() => current && toggleFavorite(current)}
          type="button"
          disabled={!current}
          aria-label={liked ? 'Unfavorite' : 'Favorite'}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 21.2l-1.4-1.3C5.4 15.4 2 12.3 2 8.4 2 5.6 4.2 3.5 7 3.5c1.6 0 3.2.7 4.2 2 1-1.3 2.6-2 4.2-2 2.8 0 5 2.1 5 4.9 0 3.9-3.4 7-8.6 11.4L12 21.2z" />
          </svg>
        </button>
        <button
          className="player-btn"
          onClick={() => current && shareStation(current)}
          type="button"
          disabled={!current}
        >
          Share
        </button>
        <div className="player-volume">
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={player.volume}
            onChange={(event) => player.setVolume(Number(event.target.value))}
          />
        </div>
      </div>
    </div>
  );
};

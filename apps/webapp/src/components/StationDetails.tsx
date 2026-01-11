import { useMemo } from 'react';
import type { MouseEvent } from 'react';
import { stationLocation, stationTags } from '../lib/stationUtils';
import { useRadio } from '../state/RadioContext';

type StationDetailsProps = {
  open: boolean;
  onClose: () => void;
};

export const StationDetails = ({ open, onClose }: StationDetailsProps) => {
  const {
    player,
    stations,
    nowPlaying,
    nowPlayingStatus,
      copyTrack,
      toggleFavorite,
      isFavorite,
      shareStation,
      openExternal
    } = useRadio();
  const current = player.current;
  const liked = current ? isFavorite(current.stationuuid) : false;

  const full = useMemo(() => {
    if (!current) return null;
    return stations.find((station) => station.stationuuid === current.stationuuid) ?? null;
  }, [stations, current]);

  if (!open || !current) return null;

  const info = full ?? current;
  const location = stationLocation(info);
  const tags = stationTags(info);
  const homepage = full?.homepage;
  const codec = full?.codec;
  const bitrate = full?.bitrate;

  const handlePlay = () => {
    player.toggle();
  };

  const openHomepage = () => {
    if (!homepage) return;
    const tg = window.Telegram?.WebApp;
    if (tg?.openLink) {
      tg.openLink(homepage);
      return;
    }
    window.open(homepage, '_blank', 'noopener,noreferrer');
  };

  const openLink = (event: MouseEvent<HTMLAnchorElement>, url: string) => {
    event.preventDefault();
    const tg = window.Telegram?.WebApp;
    if (tg?.openLink) {
      tg.openLink(url);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="details-overlay" role="dialog" aria-modal="true">
      <button
        className="details-backdrop"
        onClick={onClose}
        type="button"
        aria-label="Close details"
      />
      <div className="details-card">
        <div className="details-header">
          <div>
            <div className="details-title">{current.name}</div>
            <div className="details-sub">{location}</div>
          </div>
          <button className="chip" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="details-tags">{tags}</div>

        <div className="details-actions">
          <button className="player-btn primary" onClick={handlePlay} type="button">
            {player.isPlaying ? 'Pause' : 'Play'}
          </button>
          {nowPlaying && (
            <button className="player-btn" onClick={copyTrack} type="button">
              Copy track
            </button>
          )}
          <button
            className={`icon-btn ${liked ? 'active' : ''}`}
            onClick={() => toggleFavorite(current)}
            type="button"
            aria-label={liked ? 'Unfavorite' : 'Favorite'}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 21.2l-1.4-1.3C5.4 15.4 2 12.3 2 8.4 2 5.6 4.2 3.5 7 3.5c1.6 0 3.2.7 4.2 2 1-1.3 2.6-2 4.2-2 2.8 0 5 2.1 5 4.9 0 3.9-3.4 7-8.6 11.4L12 21.2z" />
            </svg>
          </button>
          <button className="player-btn" onClick={() => shareStation(current)} type="button">
            Share
          </button>
          <button className="player-btn" onClick={() => openExternal(current)} type="button">
            Stream
          </button>
          {homepage && (
            <button className="player-btn" onClick={openHomepage} type="button">
              Site
            </button>
          )}
        </div>

        <div className="details-grid">
          {(nowPlaying || nowPlayingStatus === 'unavailable') && (
            <div className="details-row">
              <span>Now playing</span>
              {nowPlaying ? (
                <button
                  className="track-copy"
                  onClick={copyTrack}
                  type="button"
                  title="Copy track"
                >
                  {nowPlaying}
                </button>
              ) : (
                <div>Unavailable</div>
              )}
            </div>
          )}
          <div className="details-row">
            <span>Stream URL</span>
            <a
              className="details-link"
              href={current.url_resolved}
              onClick={(event) => openLink(event, current.url_resolved)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {current.url_resolved}
            </a>
          </div>
          {homepage && (
            <div className="details-row">
              <span>Homepage</span>
              <a
                className="details-link"
                href={homepage}
                onClick={(event) => openLink(event, homepage)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {homepage}
              </a>
            </div>
          )}
          <div className="details-row">
            <span>Country</span>
            <div>{info.country || 'Unknown'}</div>
          </div>
          <div className="details-row">
            <span>Region</span>
            <div>{info.state || 'Unknown'}</div>
          </div>
          {codec && (
            <div className="details-row">
              <span>Codec</span>
              <div>{codec}</div>
            </div>
          )}
          {bitrate !== undefined && bitrate !== null && (
            <div className="details-row">
              <span>Bitrate</span>
              <div>{bitrate} kbps</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

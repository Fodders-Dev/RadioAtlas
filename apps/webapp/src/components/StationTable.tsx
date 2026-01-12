import type { StationLite } from '../types';
import { stationLocation, stationTags } from '../lib/stationUtils';
import { useRadio } from '../state/RadioContext';

type StationTableProps = {
  stations: StationLite[];
  compact?: boolean;
};

export const StationTable = ({ stations, compact }: StationTableProps) => {
  const { playStation, toggleFavorite, isFavorite, player } = useRadio();

  if (!stations.length) {
    return <div className="empty-state">No stations yet.</div>;
  }

  return (
    <div className={`station-table ${compact ? 'compact' : ''}`}>
      {!compact && (
        <div className="station-row header">
          <div>Play</div>
          <div>Name</div>
          <div>Location</div>
          <div>Tags</div>
          <div>Favorite</div>
        </div>
      )}
      {stations.map((station) => {
        const active = player.current?.stationuuid === station.stationuuid;
        const liked = isFavorite(station.stationuuid);
        const isLong = station.name.length > 26;
        return (
          <div
            key={station.stationuuid}
            className={`station-row ${active ? 'active' : ''}`}
          >
            <button
              className="play-btn"
              onClick={() => (active ? player.toggle() : playStation(station))}
              type="button"
            >
              {active && player.isPlaying ? 'Pause' : 'Play'}
            </button>
            <div className="station-name">
              <div className={`station-title ${isLong ? 'marquee' : ''}`}>
                <span className="marquee-text">{station.name}</span>
              </div>
              {compact && (
                <div className="station-fav">
                  <button
                    className={`icon-btn ${liked ? 'active' : ''}`}
                    onClick={() => toggleFavorite(station)}
                    type="button"
                    aria-label={liked ? 'Unfavorite' : 'Favorite'}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 21.2l-1.4-1.3C5.4 15.4 2 12.3 2 8.4 2 5.6 4.2 3.5 7 3.5c1.6 0 3.2.7 4.2 2 1-1.3 2.6-2 4.2-2 2.8 0 5 2.1 5 4.9 0 3.9-3.4 7-8.6 11.4L12 21.2z" />
                    </svg>
                  </button>
                </div>
              )}
              {compact && (
                <div className="station-location">{stationLocation(station)}</div>
              )}
            </div>
            {!compact && (
              <div className="station-location">{stationLocation(station)}</div>
            )}
            {!compact && <div className="station-tags">{stationTags(station)}</div>}
            {!compact && (
              <button
                className={`icon-btn ${liked ? 'active' : ''}`}
                onClick={() => toggleFavorite(station)}
                type="button"
                aria-label={liked ? 'Unfavorite' : 'Favorite'}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 21.2l-1.4-1.3C5.4 15.4 2 12.3 2 8.4 2 5.6 4.2 3.5 7 3.5c1.6 0 3.2.7 4.2 2 1-1.3 2.6-2 4.2-2 2.8 0 5 2.1 5 4.9 0 3.9-3.4 7-8.6 11.4L12 21.2z" />
                </svg>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};

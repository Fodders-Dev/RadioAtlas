import { stationLocation } from '../lib/stationUtils';
import { useRadio } from '../state/RadioContext';

export const Playlist = () => {
  const { queue, playback, playbackHistory } = useRadio();

  return (
    <section className="screen screen-playlist">
      <div className="section playlist-heading">
        <div className="section-title">Playlist</div>
        <div className="section-subtitle">
          {queue.sourceLabel || 'Playback queue'}
          {queue.items.length ? ` · ${queue.items.length} stations` : ''}
        </div>
        <div className="chip-row">
          <button
            className="chip"
            type="button"
            onClick={() => {
              if (queue.currentIndex >= 0) {
                queue.playAtIndex(queue.currentIndex);
              }
            }}
            disabled={queue.currentIndex < 0}
          >
            Play current
          </button>
          <button
            className="chip"
            type="button"
            onClick={() => queue.clearQueue()}
            disabled={!queue.items.length}
          >
            Clear queue
          </button>
        </div>
      </div>

      {!queue.items.length ? (
        <div className="empty-state">
          Start any station from Explore, Browse, Search, or Favorites to build a queue.
        </div>
      ) : (
        <div className="playlist-shell">
          <div className="playlist-list">
            {queue.items.map((station, index) => {
              const active =
                index === queue.currentIndex &&
                playback.currentStation?.stationuuid === station.stationuuid;
              return (
                <div
                  key={station.stationuuid}
                  className={`playlist-row ${active ? 'active' : ''}`}
                >
                  <div className="playlist-order">{index + 1}</div>
                  <div className="playlist-body">
                    <div className="playlist-name">{station.name}</div>
                    <div className="playlist-meta">{stationLocation(station)}</div>
                  </div>
                  <div className="playlist-actions">
                    <button className="chip" type="button" onClick={() => queue.playAtIndex(index)}>
                      {active && playback.isPlaying ? 'Playing' : 'Play'}
                    </button>
                    <button className="chip" type="button" onClick={() => queue.removeAtIndex(index)}>
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="section playlist-history-card">
            <div className="section-title">Playback history</div>
            {playbackHistory.length ? (
              <div className="playlist-history-list">
                {playbackHistory
                  .slice()
                  .reverse()
                  .slice(0, 8)
                  .map((station) => (
                    <div key={`${station.stationuuid}-${station.name}`} className="playlist-history-item">
                      <div className="playlist-history-name">{station.name}</div>
                      <div className="playlist-history-meta">{stationLocation(station)}</div>
                    </div>
                  ))}
              </div>
            ) : (
              <div className="empty-state">Playback history is empty.</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};

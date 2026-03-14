import { stationLocation } from '../lib/stationUtils';
import { useLocale } from '../state/LocaleContext';
import { useRadio } from '../state/RadioContext';

export const Playlist = () => {
  const { player, queue, playbackHistory } = useRadio();
  const { t } = useLocale();

  return (
    <section className="screen screen-playlist">
      <div className="section playlist-heading">
        <div className="section-title">{t('playlist.title')}</div>
        <div className="section-subtitle">
          {queue.sourceLabel || t('radio.queueDefault')}
          {queue.items.length ? ` - ${t('playlist.stationsCount', { count: queue.items.length })}` : ''}
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
            {t('playlist.playCurrent')}
          </button>
          <button
            className="chip"
            type="button"
            onClick={() => queue.clearQueue()}
            disabled={!queue.items.length}
          >
            {t('playlist.clearQueue')}
          </button>
        </div>
      </div>

      {!queue.items.length ? (
        <div className="empty-state">{t('playlist.empty')}</div>
      ) : (
        <div className="playlist-shell">
          <div className="playlist-list">
            {queue.items.map((station, index) => {
              const active =
                index === queue.currentIndex &&
                player.current?.stationuuid === station.stationuuid;
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
                      {active && player.isPlaying ? t('playlist.playing') : t('common.play')}
                    </button>
                    <button className="chip" type="button" onClick={() => queue.removeAtIndex(index)}>
                      {t('common.remove')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="section playlist-history-card">
            <div className="section-title">{t('playlist.historyTitle')}</div>
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
              <div className="empty-state">{t('playlist.historyEmpty')}</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};


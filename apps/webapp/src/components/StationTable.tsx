import type { StationLite } from '../types';
import { stationLocation, stationTags } from '../lib/stationUtils';
import { useRadio } from '../state/RadioContext';
import { useLocale } from '../state/LocaleContext';

type StationTableProps = {
  stations: StationLite[];
  compact?: boolean;
  sourceId?: string;
  buildQueue?: boolean;
};

export const StationTable = ({
  stations,
  compact,
  sourceId,
  buildQueue = true
}: StationTableProps) => {
  const { playStation, toggleFavorite, isFavorite, player } = useRadio();
  const { t } = useLocale();

  if (!stations.length) {
    return <div className="empty-state">{t('stationTable.empty')}</div>;
  }

  return (
    <div className={`station-table ${compact ? 'compact' : ''}`}>
      {!compact && (
        <div className="station-row header">
          <div>{t('stationTable.playColumn')}</div>
          <div>{t('stationTable.nameColumn')}</div>
          <div>{t('stationTable.locationColumn')}</div>
          <div>{t('stationTable.tagsColumn')}</div>
          <div>{t('stationTable.favoriteColumn')}</div>
        </div>
      )}
      {stations.map((station) => {
        const active = player.current?.stationuuid === station.stationuuid;
        const liked = isFavorite(station.stationuuid);
        const isLong = station.name.length > 26;
        const playLabel = active && player.isPlaying ? t('common.pause') : t('common.play');
        return (
          <div
            key={station.stationuuid}
            className={`station-row ${active ? 'active' : ''}`}
          >
            <button
              className={`play-btn ${compact ? 'icon-only' : ''}`}
              onClick={() =>
                active
                  ? player.toggle()
                  : playStation(station, {
                      playlist: buildQueue ? stations : undefined,
                      sourceId
                    })
              }
              type="button"
              aria-label={playLabel}
            >
              {compact ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {active && player.isPlaying ? (
                    <path d="M7 5h4v14H7zm6 0h4v14h-4z" />
                  ) : (
                    <path d="M8 5v14l11-7z" />
                  )}
                </svg>
              ) : (
                playLabel
              )}
            </button>
            <div className="station-name">
              <div className="station-name-head">
                <div className={`station-title ${isLong ? 'marquee' : ''}`}>
                  <span className="marquee-text">{station.name}</span>
                </div>
                {compact && (
                  <button
                    className={`icon-btn station-fav-btn ${liked ? 'active' : ''}`}
                    onClick={() => toggleFavorite(station)}
                    type="button"
                    aria-label={liked ? t('stationTable.unfavorite') : t('stationTable.favorite')}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 21.2l-1.4-1.3C5.4 15.4 2 12.3 2 8.4 2 5.6 4.2 3.5 7 3.5c1.6 0 3.2.7 4.2 2 1-1.3 2.6-2 4.2-2 2.8 0 5 2.1 5 4.9 0 3.9-3.4 7-8.6 11.4L12 21.2z" />
                    </svg>
                  </button>
                )}
              </div>
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
                aria-label={liked ? t('stationTable.unfavorite') : t('stationTable.favorite')}
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

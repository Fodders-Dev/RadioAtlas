import { StationTable } from '../components/StationTable';
import { useLocale } from '../state/LocaleContext';
import { useRadio } from '../state/RadioContext';

export const Favorites = () => {
  const { favorites, recent, trackHistory } = useRadio();
  const { locale, t } = useLocale();
  const lastPlayed = recent[0];
  const formatTime = (value: number) =>
    new Date(value).toLocaleString(locale, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

  return (
    <section className="screen screen-favorites">
      <div className="favorites-top-grid">
        <div className="section">
          <div className="section-title">{t('favoritesScreen.profileTitle')}</div>
          <div className="profile-card">
            <div>
              <div className="profile-name">{t('favoritesScreen.profileName')}</div>
              <div className="profile-sub">{t('favoritesScreen.profileDesc')}</div>
              {lastPlayed && (
                <div className="profile-last">
                  {t('favoritesScreen.lastPlayed', { station: lastPlayed.name })}
                </div>
              )}
            </div>
            <div className="profile-stats">
              <div>
                <span>{t('favoritesScreen.favorites')}</span>
                <strong>{favorites.length}</strong>
              </div>
              <div>
                <span>{t('favoritesScreen.recent')}</span>
                <strong>{recent.length}</strong>
              </div>
            </div>
          </div>
        </div>

        <div className="section">
          <div className="section-title">{t('favoritesScreen.journalTitle')}</div>
          {trackHistory.length === 0 ? (
            <div className="empty-state">{t('favoritesScreen.journalEmpty')}</div>
          ) : (
            <div className="track-list">
              {trackHistory.slice(0, 50).map((item) => (
                <div key={item.id} className="track-card">
                  <div>
                    <div className="track-title">{item.track}</div>
                    <div className="track-meta">
                      {item.stationName} - {formatTime(item.timestamp)}
                    </div>
                  </div>
                  <button
                    className="chip"
                    type="button"
                    onClick={() => navigator.clipboard.writeText(item.track)}
                  >
                    {t('common.copy')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="favorites-station-grid">
        <div className="section">
          <div className="section-title">{t('favoritesScreen.myStations')}</div>
          <StationTable stations={favorites} sourceId="favorites" buildQueue={false} />
        </div>
        <div className="section">
          <div className="section-title">{t('favoritesScreen.recentStations')}</div>
          <StationTable stations={recent} compact sourceId="recent" buildQueue={false} />
        </div>
      </div>
    </section>
  );
};


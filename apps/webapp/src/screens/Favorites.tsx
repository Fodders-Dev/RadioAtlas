import { StationTable } from '../components/StationTable';
import { useRadio } from '../state/RadioContext';

export const Favorites = () => {
  const { favorites, recent, trackHistory } = useRadio();
  const lastPlayed = recent[0];
  const formatTime = (value: number) =>
    new Date(value).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

  return (
    <section className="screen">
      <div className="section">
        <div className="section-title">Profile</div>
        <div className="profile-card">
          <div>
            <div className="profile-name">You</div>
            <div className="profile-sub">Favorites are saved on this device.</div>
            {lastPlayed && (
              <div className="profile-last">Last played: {lastPlayed.name}</div>
            )}
          </div>
          <div className="profile-stats">
            <div>
              <span>Favorites</span>
              <strong>{favorites.length}</strong>
            </div>
            <div>
              <span>Recent</span>
              <strong>{recent.length}</strong>
            </div>
          </div>
        </div>
      </div>
      <div className="section">
        <div className="section-title">Track journal</div>
        {trackHistory.length === 0 ? (
          <div className="empty-state">Copied tracks will appear here.</div>
        ) : (
          <div className="track-list">
            {trackHistory.slice(0, 50).map((item) => (
              <div key={item.id} className="track-card">
                <div>
                  <div className="track-title">{item.track}</div>
                  <div className="track-meta">
                    {item.stationName} · {formatTime(item.timestamp)}
                  </div>
                </div>
                <button
                  className="chip"
                  type="button"
                  onClick={() => navigator.clipboard.writeText(item.track)}
                >
                  Copy
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="section">
        <div className="section-title">My Stations</div>
        <StationTable stations={favorites} />
      </div>
      <div className="section">
        <div className="section-title">Recently played</div>
        <StationTable stations={recent} compact />
      </div>
    </section>
  );
};

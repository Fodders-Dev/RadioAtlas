import { useRadio } from '../state/RadioContext';

export const Settings = () => {
  const { clearCache, clearFavorites, clearRecent } = useRadio();

  return (
    <section className="screen">
      <div className="section">
        <div className="section-title">Settings</div>
        <div className="settings-card">
          <div>
            <div className="settings-label">Cache</div>
            <div className="settings-desc">Refresh catalog and globe data.</div>
          </div>
          <button className="chip" onClick={clearCache} type="button">
            Clear cache
          </button>
        </div>
        <div className="settings-card">
          <div>
            <div className="settings-label">Favorites</div>
            <div className="settings-desc">Reset saved stations.</div>
          </div>
          <button className="chip" onClick={clearFavorites} type="button">
            Clear favorites
          </button>
        </div>
        <div className="settings-card">
          <div>
            <div className="settings-label">Recently played</div>
            <div className="settings-desc">Clear local playback history.</div>
          </div>
          <button className="chip" onClick={clearRecent} type="button">
            Clear recent
          </button>
        </div>
      </div>
    </section>
  );
};

import { useEffect, useState } from 'react';
import { clearApiBase, getApiBase, setApiBase } from '../lib/apiBase';
import { useRadio } from '../state/RadioContext';

export const Settings = () => {
  const { clearCache, clearFavorites, clearRecent } = useRadio();
  const [apiUrl, setApiUrl] = useState('');

  useEffect(() => {
    setApiUrl(getApiBase() || '');
  }, []);

  const handleSaveApi = () => {
    const value = apiUrl.trim();
    if (!value) {
      clearApiBase();
      window.location.reload();
      return;
    }
    const ok = setApiBase(value);
    if (!ok) {
      window.alert('Invalid API URL. Use https://...');
      return;
    }
    window.location.reload();
  };

  const handleResetApi = () => {
    clearApiBase();
    setApiUrl('');
    window.location.reload();
  };

  return (
    <section className="screen">
      <div className="section">
        <div className="section-title">Settings</div>
        <div className="settings-card stack">
          <div>
            <div className="settings-label">API base</div>
            <div className="settings-desc">
              Proxy for stations without VPN (trycloudflare or server URL).
            </div>
          </div>
          <input
            className="settings-input"
            value={apiUrl}
            onChange={(event) => setApiUrl(event.target.value)}
            placeholder="https://your-api.example"
            type="url"
          />
          <div className="settings-actions">
            <button className="chip" onClick={handleSaveApi} type="button">
              Save & reload
            </button>
            <button className="chip" onClick={handleResetApi} type="button">
              Reset
            </button>
          </div>
        </div>
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

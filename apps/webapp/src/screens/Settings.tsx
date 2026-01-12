import { useEffect, useState } from 'react';
import { clearApiBase, getApiBase, setApiBase } from '../lib/apiBase';
import { useRadio } from '../state/RadioContext';

export const Settings = () => {
  const { clearCache, clearFavorites, clearRecent, openWebAppExternally, debugLogs } = useRadio() as any;
  const [apiUrl, setApiUrl] = useState('');
  const [showDebug, setShowDebug] = useState(false);

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
        <div className="section-title">Background Audio</div>
        <div className="settings-card">
          <div>
            <div className="settings-label">Open in System Browser</div>
            <div className="settings-desc">
              Recommended for reliable background playback.
            </div>
          </div>
          <button
            className="chip active"
            onClick={openWebAppExternally}
            type="button"
          >
            Open App
          </button>
        </div>
      </div>

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

      <div className="section">
        <div className="section-title">Diagnostics</div>
        <div className="settings-card stack">
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div>
              <div className="settings-label">Debug Mode</div>
              <div className="settings-desc">View logs and system info.</div>
            </div>
            <button
              className="chip"
              onClick={() => setShowDebug(!showDebug)}
              type="button"
            >
              {showDebug ? 'Hide' : 'Show'}
            </button>
          </div>
          {showDebug && (
            <div
              style={{
                marginTop: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                fontSize: 11,
                fontFamily: 'monospace',
                color: 'var(--muted)'
              }}
            >
              <div>
                <strong>UA:</strong> {navigator.userAgent}
              </div>
              <div>
                <strong>MediaSession:</strong>{' '}
                {'mediaSession' in navigator ? 'Supported' : 'Not supported'}
              </div>
              <div>
                <strong>TG Platform:</strong>{' '}
                {window.Telegram?.WebApp?.platform || 'Unknown'}
              </div>
              <div>
                <strong>TG Version:</strong>{' '}
                {window.Telegram?.WebApp?.version || 'Unknown'}
              </div>
              <div
                style={{
                  background: 'rgba(0,0,0,0.3)',
                  padding: 8,
                  borderRadius: 8,
                  maxHeight: 200,
                  overflowY: 'auto',
                  whiteSpace: 'pre-wrap'
                }}
              >
                {debugLogs?.length
                  ? debugLogs.map((log: string, i: number) => (
                    <div key={i}>{log}</div>
                  ))
                  : 'No logs yet...'}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

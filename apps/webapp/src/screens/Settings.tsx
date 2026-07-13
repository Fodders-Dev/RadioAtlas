import { useEffect, useRef, useState } from 'react';
import { clearApiBase, getApiBase, setApiBase } from '../lib/apiBase';
import { useCatalog } from '../state/CatalogContext';
import { useLocale } from '../state/LocaleContext';
import { useLibrary, usePlayback, useShell } from '../state/RadioContext';
import { APP_COMMIT, APP_VERSION, BUILD_TIME } from '../lib/buildInfo';
import { getTelegramWebApp, isInsideTelegramClient } from '../lib/telegram';
import { SLEEP_TIMER_PRESETS_MIN, formatSleepRemaining } from '../lib/sleepTimer';

type ClearAction = 'cache' | 'favorites' | 'recent';

export const Settings = () => {
  const { favorites, recent, clearFavorites, clearRecent } = useLibrary();
  const { clearCatalogCache } = useCatalog();
  const {
    sleepTimer,
    startSleepTimer,
    cancelSleepTimer,
    pauseOnHeadphoneUnplug,
    setPauseOnHeadphoneUnplug
  } = usePlayback();
  const {
    clearCache,
    openWebAppExternally,
    debugLogs,
    setSkinLabOpen
  } = useShell();
  const { locale, setLocale, t } = useLocale();
  const [apiUrl, setApiUrl] = useState('');
  const [showDebug, setShowDebug] = useState(false);
  const [pendingClearAction, setPendingClearAction] = useState<ClearAction | null>(null);
  const clearActionTriggerRefs = useRef<Partial<Record<ClearAction, HTMLButtonElement | null>>>({});
  const apiBase = getApiBase();

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
      window.alert(t('settings.invalidApi'));
      return;
    }
    window.location.reload();
  };

  const handleResetApi = () => {
    clearApiBase();
    setApiUrl('');
    window.location.reload();
  };

  const handleClearCache = () => {
    clearCatalogCache();
    clearCache();
  };

  const restoreClearActionFocus = (action: ClearAction) => {
    window.requestAnimationFrame(() => {
      const trigger = clearActionTriggerRefs.current[action];
      if (trigger && !trigger.disabled) {
        trigger.focus();
        return;
      }
      document.querySelector<HTMLElement>('[data-dialog-initial-focus]')?.focus();
    });
  };

  const handleCancelClear = (action: ClearAction) => {
    setPendingClearAction(null);
    restoreClearActionFocus(action);
  };

  const handleConfirmClear = (action: ClearAction) => {
    if (action === 'cache') {
      handleClearCache();
    } else if (action === 'favorites') {
      clearFavorites();
    } else {
      clearRecent();
    }
    setPendingClearAction(null);
    restoreClearActionFocus(action);
  };

  const renderClearAction = (
    action: ClearAction,
    label: string,
    confirmation: string,
    disabled = false
  ) => {
    const confirmationId = `settings-clear-${action}-confirmation`;
    const isPending = pendingClearAction === action;

    return (
      <>
        <button
          ref={(element) => {
            clearActionTriggerRefs.current[action] = element;
          }}
          className="chip"
          onClick={() => setPendingClearAction(action)}
          type="button"
          disabled={disabled}
          aria-expanded={isPending}
          aria-controls={isPending ? confirmationId : undefined}
        >
          {label}
        </button>
        {isPending ? (
          <div
            className="settings-actions"
            id={confirmationId}
            role="group"
            aria-label={confirmation}
          >
            <span className="settings-desc" aria-live="polite">
              {confirmation}
            </span>
            <button
              className="chip active"
              type="button"
              onClick={() => handleConfirmClear(action)}
            >
              {t('settings.confirmClear')}
            </button>
            <button className="chip" type="button" onClick={() => handleCancelClear(action)}>
              {t('common.cancel')}
            </button>
          </div>
        ) : null}
      </>
    );
  };

  return (
    <div className="screen screen-settings settings-panel">
      <div className="section">
        <div className="section-title">{t('settings.backgroundTitle')}</div>
        <div className="settings-card">
          <div>
            <div className="settings-label">{t('settings.openBrowserLabel')}</div>
            <div className="settings-desc">{t('settings.openBrowserDesc')}</div>
          </div>
          <button
            className="chip active"
            onClick={openWebAppExternally}
            type="button"
          >
            {t('common.openApp')}
          </button>
        </div>
      </div>

      <div className="section">
        <div className="section-title">{t('theme.title')}</div>
        <div className="settings-card">
          <div>
            <div className="settings-label">{t('theme.settingsLabel')}</div>
            <div className="settings-desc">{t('theme.settingsDesc')}</div>
          </div>
          <button className="chip active" onClick={() => setSkinLabOpen(true)} type="button">
            {t('theme.openStudio')}
          </button>
        </div>
      </div>

      <div className="section">
        <div className="section-title">{t('settings.generalTitle')}</div>
        <div className="settings-card stack">
          <div>
            <div className="settings-label">{t('locale.language')}</div>
            <div className="settings-desc">{t('locale.languageDesc')}</div>
          </div>
          <div className="settings-actions">
            <button
              className={`chip ${locale === 'ru' ? 'active' : ''}`}
              type="button"
              onClick={() => setLocale('ru')}
            >
              {t('locale.russian')}
            </button>
            <button
              className={`chip ${locale === 'en' ? 'active' : ''}`}
              type="button"
              onClick={() => setLocale('en')}
            >
              {t('locale.english')}
            </button>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-title">{t('settings.dataTitle')}</div>
        <div className="settings-card stack settings-data-card">
          <div className="settings-data-row">
            <div>
              <div className="settings-label">{t('settings.cacheLabel')}</div>
              <div className="settings-desc">{t('settings.cacheDesc')}</div>
            </div>
            <div className="settings-data-action">
              {renderClearAction(
                'cache',
                t('settings.clearCache'),
                t('settings.clearCacheConfirm')
              )}
            </div>
          </div>
          <div className="settings-data-row">
            <div>
              <div className="settings-label">{t('settings.favoritesLabel')}</div>
              <div className="settings-desc">{t('settings.favoritesDesc')}</div>
            </div>
            <div className="settings-data-action">
              {renderClearAction(
                'favorites',
                t('settings.clearFavorites'),
                t('settings.clearFavoritesConfirm', { count: favorites.length }),
                !favorites.length
              )}
            </div>
          </div>
          <div className="settings-data-row">
            <div>
              <div className="settings-label">{t('settings.recentLabel')}</div>
              <div className="settings-desc">{t('settings.recentDesc')}</div>
            </div>
            <div className="settings-data-action">
              {renderClearAction(
                'recent',
                t('settings.clearRecent'),
                t('settings.clearRecentConfirm', { count: recent.length }),
                !recent.length
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-title">{t('settings.sleepTitle')}</div>
        <div className="settings-card stack">
          <div>
            <div className="settings-label">{t('settings.sleepTimerLabel')}</div>
            <div className="settings-desc">{t('settings.sleepTimerDesc')}</div>
          </div>
          <div className="settings-actions">
            {SLEEP_TIMER_PRESETS_MIN.map((min) => (
              <button
                key={min}
                className={`chip ${sleepTimer.active && sleepTimer.minutes === min ? 'active' : ''}`}
                type="button"
                onClick={() => startSleepTimer(min)}
              >
                {min} {t('settings.sleepMin')}
              </button>
            ))}
            <button
              className={`chip ${sleepTimer.active ? '' : 'active'}`}
              type="button"
              onClick={cancelSleepTimer}
              disabled={!sleepTimer.active}
            >
              {t('settings.off')}
            </button>
          </div>
          {sleepTimer.active ? (
            <div className="settings-desc" aria-live="polite">
              {t('settings.sleepLeft')} {formatSleepRemaining(sleepTimer.remainingMs)}
            </div>
          ) : null}
        </div>
        <div className="settings-card">
          <div>
            <div className="settings-label">{t('settings.headphoneLabel')}</div>
            <div className="settings-desc">{t('settings.headphoneDesc')}</div>
          </div>
          <button
            className={`chip ${pauseOnHeadphoneUnplug ? 'active' : ''}`}
            type="button"
            role="switch"
            aria-checked={pauseOnHeadphoneUnplug}
            onClick={() => setPauseOnHeadphoneUnplug(!pauseOnHeadphoneUnplug)}
          >
            {pauseOnHeadphoneUnplug ? t('settings.on') : t('settings.off')}
          </button>
        </div>
      </div>

      <details className="section settings-developer-section">
        <summary className="section-title">{t('settings.developerTitle')}</summary>
        <div className="settings-card stack">
          <div>
            <label className="settings-label" htmlFor="settings-api-base">
              {t('settings.apiBaseLabel')}
            </label>
            <div className="settings-desc">{t('settings.apiBaseDesc')}</div>
          </div>
          <input
            id="settings-api-base"
            className="settings-input"
            value={apiUrl}
            onChange={(event) => setApiUrl(event.target.value)}
            placeholder={t('settings.apiPlaceholder')}
            type="url"
          />
          <div className="settings-actions">
            <button className="chip" onClick={handleSaveApi} type="button">
              {t('common.saveReload')}
            </button>
            <button className="chip" onClick={handleResetApi} type="button">
              {t('common.reset')}
            </button>
          </div>
        </div>

        <div className="settings-card stack">
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div>
              <div className="settings-label">{t('settings.diagnosticsTitle')}</div>
              <div className="settings-desc">{t('settings.debugDesc')}</div>
            </div>
            <button
              className="chip"
              onClick={() => setShowDebug(!showDebug)}
              type="button"
              aria-expanded={showDebug}
              aria-controls="settings-debug-details"
            >
              {showDebug ? t('common.hide') : t('common.show')}
            </button>
          </div>
          {showDebug ? (
            <div
              id="settings-debug-details"
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
                <strong>API Base:</strong> {apiBase || 'Not set'}
              </div>
              {isInsideTelegramClient() ? (
                <>
                  <div>
                    <strong>TG Platform:</strong>{' '}
                    {getTelegramWebApp()?.platform || 'unknown'}
                  </div>
                  <div>
                    <strong>TG Version:</strong>{' '}
                    {getTelegramWebApp()?.version || 'unknown'}
                  </div>
                </>
              ) : null}
              <div>
                <strong>Build:</strong> v{APP_VERSION}
              </div>
              <div>
                <strong>Commit:</strong> {APP_COMMIT}
              </div>
              <div>
                <strong>Built at:</strong> {new Date(BUILD_TIME).toLocaleString()}
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
                  ? debugLogs.map((log: string, i: number) => <div key={i}>{log}</div>)
                  : t('settings.noLogs')}
              </div>
            </div>
          ) : null}
        </div>
      </details>
    </div>
  );
};

import { useLocale } from '../state/LocaleContext';
import { useSession } from '../state/SessionContext';
import { useRadio } from '../state/RadioContext';

export const AccountCard = () => {
  const { t } = useLocale();
  const { setActiveSection } = useRadio();
  const {
    status,
    syncState,
    profile,
    library,
    error,
    isTelegramMiniApp,
    canOpenTelegram,
    signInWithTelegram,
    signOut,
    openTelegramAccess,
    openAccountSheet
  } = useSession();

  const favoritesCount = library?.favorites.length || 0;
  const recentCount = library?.recent.length || 0;
  const providerSummary = profile?.providers
    .map((provider) => provider.email || provider.username || provider.displayName)
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="glass-card account-card motion-rise motion-delay-1">
      <div className="library-section-head">
        <div>
          <div className="section-title">{t('account.title')}</div>
          <div className="section-subtitle">
            {status === 'authenticated'
              ? t('account.connectedCopy')
              : isTelegramMiniApp
                ? t('account.telegramCopy')
                : t('account.guestCopy')}
          </div>
        </div>
        <div className={`account-pill ${status}`}>
          {status === 'authenticated' ? t('account.connected') : t('account.local')}
        </div>
      </div>

      {profile ? (
        <div className="account-profile-line">
          <div className="account-avatar" aria-hidden="true">
            {profile.photoUrl ? (
              <img src={profile.photoUrl} alt="" />
            ) : (
              profile.displayName.charAt(0).toUpperCase()
            )}
          </div>
          <div className="account-profile-copy">
            <div className="account-profile-name">{profile.displayName}</div>
            <div className="account-profile-meta">
              {providerSummary || (profile.username ? `@${profile.username}` : t('account.telegramProvider'))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="account-stats">
        <div className="globe-selection-pill">
          <span>{t('library.tabs.favorites')}</span>
          <strong>{favoritesCount}</strong>
        </div>
        <div className="globe-selection-pill">
          <span>{t('library.tabs.recent')}</span>
          <strong>{recentCount}</strong>
        </div>
        <div className={`globe-selection-pill ${syncState === 'synced' ? 'active' : ''}`}>
          <span>{t('account.syncStatus')}</span>
          <strong>{t(`account.syncStates.${syncState}`)}</strong>
        </div>
      </div>

      {error ? <div className="error">{error}</div> : null}

      <div className="hero-chip-row account-actions">
        {status === 'authenticated' ? (
          <>
            <button className="chip active" type="button" onClick={() => setActiveSection('library')}>
              {t('home.openLibrary')}
            </button>
            <button className="chip" type="button" onClick={openAccountSheet}>
              {t('account.manage')}
            </button>
            <button className="chip" type="button" onClick={signOut}>
              {t('account.signOut')}
            </button>
          </>
        ) : (
          <>
            <button
              className="chip active"
              type="button"
              onClick={() => {
                void signInWithTelegram();
              }}
              disabled={!isTelegramMiniApp && !canOpenTelegram}
            >
              {t('account.telegramAction')}
            </button>
            {!isTelegramMiniApp ? (
              <button className="chip" type="button" onClick={openTelegramAccess}>
                {t('account.openTelegram')}
              </button>
            ) : null}
            <button className="chip" type="button" onClick={openAccountSheet}>
              {t('account.manage')}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

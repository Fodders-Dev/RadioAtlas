import { useLocale } from '../state/LocaleContext';
import { useSession } from '../state/SessionContext';

export const AccountCard = () => {
  const { locale, t } = useLocale();
  const {
    status,
    syncState,
    profile,
    library,
    error,
    isTelegramMiniApp,
    canOpenTelegram,
    openTelegramAccess,
    openAccountSheet
  } = useSession();

  const favoritesCount = library?.favorites.length || 0;
  const recentCount = library?.recent.length || 0;
  const providerSummary = profile?.providers
    .map((provider) => provider.email || provider.username || provider.displayName)
    .filter(Boolean)
    .join(' · ');
  const premiumBadge =
    profile?.premiumStatus === 'premium'
      ? t('account.premiumBadge')
      : profile?.supporterTier && profile.supporterTier !== 'none'
        ? t('account.supporterBadge')
        : null;
  const lastSyncLabel =
    status === 'authenticated' && library?.updatedAt
      ? t('account.connectedLastSync', {
          date: new Date(library.updatedAt).toLocaleString(locale, {
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          })
        })
      : t('account.connected');

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
          {status === 'authenticated' ? lastSyncLabel : t('account.local')}
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
        {premiumBadge ? (
          <div className="globe-selection-pill active">
            <span>{t('account.membership')}</span>
            <strong>{premiumBadge}</strong>
          </div>
        ) : null}
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

      {status !== 'authenticated' ? (
        <div className="account-onboarding-panel">
          <div className="account-onboarding-copy">
            <div className="section-title">{t('account.onboardingTitle')}</div>
            <div className="section-subtitle">{t('account.onboardingCopy')}</div>
          </div>
          <div className="hero-chip-row account-actions">
            <button className="chip active" type="button" onClick={openAccountSheet}>
              {t('account.signInAndSync')}
            </button>
            {!isTelegramMiniApp && canOpenTelegram ? (
              <button className="chip" type="button" onClick={openTelegramAccess}>
                {t('account.openTelegram')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};

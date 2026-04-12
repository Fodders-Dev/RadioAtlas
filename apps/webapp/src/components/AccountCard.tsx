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
    billingProducts,
    error,
    isTelegramMiniApp,
    canOpenTelegram,
    hasGoogleClient,
    signInWithTelegram,
    createTelegramInvoice,
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
  const supporterProduct = billingProducts.find((product) => product.id === 'support-small') || null;
  const premiumProduct = billingProducts.find((product) => product.id === 'premium-month') || null;
  const premiumBadge =
    profile?.premiumStatus === 'premium'
      ? t('account.premiumBadge')
      : profile?.supporterTier && profile.supporterTier !== 'none'
        ? t('account.supporterBadge')
        : null;

  const openInvoice = async (productId: NonNullable<typeof supporterProduct>['id']) => {
    const invoice = await createTelegramInvoice(productId);
    if (!invoice) return;
    const telegram = window.Telegram?.WebApp;
    if (telegram?.openInvoice) {
      telegram.openInvoice(invoice.invoiceLink);
      return;
    }
    window.open(invoice.invoiceLink, '_blank', 'noopener,noreferrer');
  };

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
            {isTelegramMiniApp || canOpenTelegram ? (
              <button
                className="chip"
                type="button"
                onClick={() => {
                  void signInWithTelegram();
                }}
              >
                {t('account.telegramAction')}
              </button>
            ) : null}
            {hasGoogleClient ? (
              <button className="chip" type="button" onClick={openAccountSheet}>
                {t('account.googleAction')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="hero-chip-row account-actions">
        {status === 'authenticated' ? (
          <>
            <button className="chip active" type="button" onClick={() => setActiveSection('library')}>
              {t('home.openLibrary')}
            </button>
            <button className="chip" type="button" onClick={openAccountSheet}>
              {t('account.manage')}
            </button>
            {premiumProduct && profile?.premiumStatus !== 'premium' ? (
              <button className="chip" type="button" onClick={() => void openInvoice(premiumProduct.id)}>
                {t('account.getPremium')}
              </button>
            ) : null}
            {supporterProduct ? (
              <button className="chip" type="button" onClick={() => void openInvoice(supporterProduct.id)}>
                {t('account.supportProject')}
              </button>
            ) : null}
            <button className="chip" type="button" onClick={signOut}>
              {t('account.signOut')}
            </button>
          </>
        ) : (
          <>
            {!isTelegramMiniApp && canOpenTelegram ? (
              <button className="chip" type="button" onClick={openTelegramAccess}>
                {t('account.openTelegram')}
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
};

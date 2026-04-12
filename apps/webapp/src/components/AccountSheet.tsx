import { useEffect, useRef, useState } from 'react';
import { useLocale } from '../state/LocaleContext';
import {
  useSession,
  type LibraryMergeStrategy,
  type SessionAuditEvent
} from '../state/SessionContext';
import { SettingsSheet } from './SettingsSheet';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: Record<string, string | number | boolean>
          ) => void;
          prompt: () => void;
        };
      };
    };
  }
}

type AccountSheetProps = {
  open: boolean;
  onClose: () => void;
};

const GOOGLE_SCRIPT_ID = 'google-identity-service';

const loadGoogleScript = async () => {
  if (window.google?.accounts?.id) return true;
  if (document.getElementById(GOOGLE_SCRIPT_ID)) {
    return new Promise<boolean>((resolve) => {
      window.setTimeout(() => resolve(Boolean(window.google?.accounts?.id)), 400);
    });
  }
  return new Promise<boolean>((resolve) => {
    const script = document.createElement('script');
    script.id = GOOGLE_SCRIPT_ID;
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(Boolean(window.google?.accounts?.id));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
};

const formatAuditTime = (value: number, locale: string) =>
  new Date(value).toLocaleString(locale, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });

const getAuditLabel = (event: SessionAuditEvent, t: (key: string) => string) =>
  t(`account.auditTypes.${event.type}`);

const formatProviderSummary = (
  providers: Array<'telegram' | 'google'>,
  t: (key: string) => string
) => providers.map((provider) => t(`account.providers.${provider}`)).join(' · ');

const formatDelta = (current: number | null, next: number) => {
  if (current === null) return null;
  const delta = next - current;
  if (!delta) return null;
  return delta > 0 ? `+${delta}` : String(delta);
};

export const AccountSheet = ({ open, onClose }: AccountSheetProps) => {
  const { locale, t } = useLocale();
  const {
    status,
    syncState,
    profile,
    auditTrail,
    error,
    billingProducts,
    pendingLinkPreview,
    hasGoogleClient,
    googleClientId,
    isTelegramMiniApp,
    signInWithTelegram,
    signInWithGoogleCredential,
    unlinkProvider,
    createLinkCode,
    previewTelegramLink,
    previewGoogleCredentialLink,
    confirmPendingLink,
    dismissPendingLink,
    createTelegramInvoice,
    signOut,
    openTelegramAccess
  } = useSession();
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [telegramHint, setTelegramHint] = useState<string | null>(null);
  const [unlinkBusyKind, setUnlinkBusyKind] = useState<'telegram' | 'google' | null>(null);
  const [mergeStrategy, setMergeStrategy] = useState<LibraryMergeStrategy>('combine');
  const telegramProvider = profile?.providers.find((provider) => provider.kind === 'telegram') || null;
  const googleProvider = profile?.providers.find((provider) => provider.kind === 'google') || null;
  const canUnlinkProvider = (profile?.providers.length || 0) > 1;
  const premiumProducts = billingProducts.filter((product) => product.kind === 'premium' || product.kind === 'gift-premium');
  const donationProducts = billingProducts.filter((product) => product.kind === 'donation');
  const shouldShowMergeControls = Boolean(profile?.providers.length || pendingLinkPreview);
  const shouldShowBilling = Boolean(profile && billingProducts.length);
  const shouldShowAudit = Boolean(profile && auditTrail.length);

  useEffect(() => {
    if (!open || status !== 'authenticated') return;
    setLinkBusy(false);
    setTelegramHint(null);
  }, [open, status]);

  useEffect(() => {
    if (!open || !hasGoogleClient || !googleButtonRef.current) return;

    let mounted = true;
    void loadGoogleScript().then((ready) => {
      if (!mounted || !ready || !googleButtonRef.current || !window.google?.accounts?.id) return;
      googleButtonRef.current.innerHTML = '';
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: ({ credential }) => {
          void (async () => {
            const preview = await previewGoogleCredentialLink(credential, undefined, mergeStrategy);
            if (preview && !preview.requiresConfirmation) {
              await signInWithGoogleCredential(credential, undefined, mergeStrategy);
            }
          })();
        }
      });
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        theme: 'outline',
        size: 'large',
        shape: 'pill',
        text: profile?.linkedProviders.includes('google') ? 'continue_with' : 'signin_with',
        width: 260
      });
    });

    return () => {
      mounted = false;
    };
  }, [googleClientId, hasGoogleClient, mergeStrategy, open, previewGoogleCredentialLink, profile?.linkedProviders, signInWithGoogleCredential]);

  const handleTelegramLink = async () => {
    setLinkBusy(true);
    setTelegramHint(null);
    try {
      if (isTelegramMiniApp) {
        const preview = await previewTelegramLink(undefined, mergeStrategy);
        if (!preview || !preview.requiresConfirmation) {
          await signInWithTelegram(undefined, mergeStrategy);
        }
        return;
      }
      const linkCode = await createLinkCode(mergeStrategy);
      if (linkCode) {
        setTelegramHint(t(`account.mergeStrategyHints.${mergeStrategy}`));
        openTelegramAccess(linkCode);
      } else {
        openTelegramAccess();
      }
    } finally {
      setLinkBusy(false);
    }
  };

  const handleUnlink = async (kind: 'telegram' | 'google') => {
    setUnlinkBusyKind(kind);
    try {
      await unlinkProvider(kind);
    } finally {
      setUnlinkBusyKind(null);
    }
  };

  const openInvoice = async (productId: (typeof billingProducts)[number]['id']) => {
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
    <SettingsSheet
      open={open}
      onClose={onClose}
      kicker={t('account.sheetKicker')}
      title={t('account.sheetTitle')}
    >
      <div className="settings-panel account-sheet-panel">
        <div className="glass-card account-sheet-hero">
          <div className="account-sheet-profile">
            <div className="account-avatar account-avatar-lg" aria-hidden="true">
              {profile?.photoUrl ? (
                <img src={profile.photoUrl} alt="" />
              ) : (
                (profile?.displayName || t('account.sheetGuestTitle')).charAt(0).toUpperCase()
              )}
            </div>
            <div className="account-sheet-profile-copy">
              <div className="section-title">{profile?.displayName || t('account.sheetGuestTitle')}</div>
              {profile ? (
                <div className="account-profile-meta">
                  {profile.email || (profile.username ? `@${profile.username}` : t('account.localProfile'))}
                </div>
              ) : null}
            </div>
          </div>
          <div className="section-subtitle">
            {profile
              ? t('account.sheetSubtitle')
              : t('account.sheetGuestCopy')}
          </div>
          <div className="account-stats">
            {profile ? (
              <div className="globe-selection-pill active">
                <span>{t('account.membership')}</span>
                <strong>
                  {profile.premiumStatus === 'premium'
                    ? t('account.premiumBadge')
                    : profile.supporterTier !== 'none'
                      ? t('account.supporterBadge')
                      : t('account.freeBadge')}
                </strong>
              </div>
            ) : null}
            <div className={`globe-selection-pill ${status === 'authenticated' ? 'active' : ''}`}>
              <span>{t('account.syncStatus')}</span>
              <strong>
                {status === 'authenticated'
                  ? t(`account.syncStates.${syncState}`)
                  : t('account.local')}
              </strong>
            </div>
            {profile?.providers.map((provider) => (
              <div key={`${provider.kind}-${provider.externalId}`} className="globe-selection-pill active">
                <span>{t(`account.providers.${provider.kind}`)}</span>
                <strong>
                  {provider.email || provider.username || provider.displayName}
                </strong>
              </div>
            ))}
          </div>
          {error ? <div className="error">{error}</div> : null}
          <div className="settings-actions account-sheet-hero-actions">
            {!profile ? (
              <>
                <button
                  className="chip active"
                  type="button"
                  onClick={() => {
                    void handleTelegramLink();
                  }}
                  disabled={linkBusy}
                >
                  {t('account.telegramAction')}
                </button>
                {hasGoogleClient ? (
                  <div className="account-google-slot account-google-slot-inline" ref={googleButtonRef} />
                ) : (
                  <button className="chip" type="button" disabled>
                    {t('account.googleTitle')}
                  </button>
                )}
              </>
            ) : (
              <>
                <button className="chip active" type="button" onClick={onClose}>
                  {t('common.close')}
                </button>
                <button className="chip" type="button" onClick={signOut}>
                  {t('account.signOut')}
                </button>
              </>
            )}
          </div>
        </div>

        {shouldShowMergeControls ? (
          <div className="glass-card account-provider-card">
            <div className="library-section-head">
              <div>
                <div className="section-title">{t('account.mergeResolutionTitle')}</div>
                <div className="section-subtitle">{t('account.mergeResolutionCopy')}</div>
              </div>
            </div>
            <div className="account-strategy-grid">
              {(['combine', 'prefer-current', 'prefer-incoming'] as LibraryMergeStrategy[]).map((option) => (
                <button
                  key={option}
                  className={`account-strategy-option ${mergeStrategy === option ? 'active' : ''}`}
                  type="button"
                  onClick={() => setMergeStrategy(option)}
                >
                  <span>{t(`account.mergeStrategies.${option}.title`)}</span>
                  <strong>{t(`account.mergeStrategies.${option}.copy`)}</strong>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {pendingLinkPreview?.requiresConfirmation ? (
          <div className="glass-card account-provider-card">
            <div className="library-section-head">
              <div>
                <div className="section-title">{t('account.mergePreviewTitle')}</div>
                <div className="section-subtitle">
                  {t('account.mergePreviewCopy').replace('{provider}', pendingLinkPreview.providerLabel)}
                </div>
              </div>
            </div>
            <div className="account-merge-preview-grid">
              {pendingLinkPreview.current ? (
                <div className="account-merge-preview-card">
                  <span>{t('account.mergePreviewCurrent')}</span>
                  <strong>{pendingLinkPreview.current.displayName}</strong>
                  <div className="account-merge-preview-meta">
                    {t('account.mergePreviewProviders')}: {formatProviderSummary(pendingLinkPreview.current.providers, t)}
                  </div>
                  <div>{t('account.mergePreviewFavorites')}: {pendingLinkPreview.current.counts.favorites}</div>
                  <div>{t('account.mergePreviewRecent')}: {pendingLinkPreview.current.counts.recent}</div>
                  <div>{t('account.mergePreviewHistory')}: {pendingLinkPreview.current.counts.trackHistory}</div>
                </div>
              ) : null}
              {pendingLinkPreview.incoming ? (
                <div className="account-merge-preview-card">
                  <span>{t('account.mergePreviewIncoming')}</span>
                  <strong>{pendingLinkPreview.incoming.displayName}</strong>
                  <div className="account-merge-preview-meta">
                    {t('account.mergePreviewProviders')}: {formatProviderSummary(pendingLinkPreview.incoming.providers, t)}
                  </div>
                  <div>{t('account.mergePreviewFavorites')}: {pendingLinkPreview.incoming.counts.favorites}</div>
                  <div>{t('account.mergePreviewRecent')}: {pendingLinkPreview.incoming.counts.recent}</div>
                  <div>{t('account.mergePreviewHistory')}: {pendingLinkPreview.incoming.counts.trackHistory}</div>
                </div>
              ) : null}
              <div className="account-merge-preview-card active">
                <span>{t('account.mergePreviewResult')}</span>
                <strong>{t(`account.mergeStrategies.${pendingLinkPreview.strategy}.title`)}</strong>
                <div className="account-merge-preview-meta">
                  {t('account.mergePreviewProviders')}: {formatProviderSummary(
                    [
                      ...(pendingLinkPreview.current?.providers || []),
                      ...(pendingLinkPreview.incoming?.providers || [])
                    ].filter((provider, index, array) => array.indexOf(provider) === index),
                    t
                  )}
                </div>
                <div>
                  {t('account.mergePreviewFavorites')}: {pendingLinkPreview.result.favorites}
                  {formatDelta(pendingLinkPreview.current?.counts.favorites ?? null, pendingLinkPreview.result.favorites) ? (
                    <span className="account-merge-preview-delta">
                      {t('account.mergePreviewDelta')} {formatDelta(pendingLinkPreview.current?.counts.favorites ?? null, pendingLinkPreview.result.favorites)}
                    </span>
                  ) : null}
                </div>
                <div>
                  {t('account.mergePreviewRecent')}: {pendingLinkPreview.result.recent}
                  {formatDelta(pendingLinkPreview.current?.counts.recent ?? null, pendingLinkPreview.result.recent) ? (
                    <span className="account-merge-preview-delta">
                      {t('account.mergePreviewDelta')} {formatDelta(pendingLinkPreview.current?.counts.recent ?? null, pendingLinkPreview.result.recent)}
                    </span>
                  ) : null}
                </div>
                <div>
                  {t('account.mergePreviewHistory')}: {pendingLinkPreview.result.trackHistory}
                  {formatDelta(pendingLinkPreview.current?.counts.trackHistory ?? null, pendingLinkPreview.result.trackHistory) ? (
                    <span className="account-merge-preview-delta">
                      {t('account.mergePreviewDelta')} {formatDelta(pendingLinkPreview.current?.counts.trackHistory ?? null, pendingLinkPreview.result.trackHistory)}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="settings-actions">
              <button
                className="chip active"
                type="button"
                onClick={() => {
                  void confirmPendingLink();
                }}
              >
                {t('account.mergeConfirm')}
              </button>
              <button className="chip" type="button" onClick={dismissPendingLink}>
                {t('account.mergeCancel')}
              </button>
            </div>
          </div>
        ) : null}

        <div className="glass-card account-provider-card">
          <div className="library-section-head">
            <div>
              <div className="section-title">{t('account.telegramTitle')}</div>
              <div className="section-subtitle">{t('account.telegramLinkCopy')}</div>
            </div>
            <div className="chip-row">
              <button
                className={`chip ${profile?.linkedProviders.includes('telegram') ? 'active' : ''}`}
                type="button"
                onClick={() => {
                  void handleTelegramLink();
                }}
                disabled={linkBusy}
              >
                {profile?.linkedProviders.includes('telegram')
                  ? t('account.connected')
                  : t('account.linkTelegram')}
              </button>
              {telegramProvider ? (
                <button
                  className="chip"
                  type="button"
                  onClick={() => {
                    void handleUnlink('telegram');
                  }}
                  disabled={!canUnlinkProvider || unlinkBusyKind === 'telegram'}
                  title={!canUnlinkProvider ? t('account.unlinkLastBlocked') : undefined}
                >
                  {t('account.unlink')}
                </button>
              ) : null}
            </div>
          </div>
          {telegramProvider ? (
            <div className="account-provider-value">
              {t('account.connectedAs')}: {telegramProvider.username ? `@${telegramProvider.username}` : telegramProvider.displayName}
            </div>
          ) : null}
          {telegramHint ? <div className="section-subtitle">{telegramHint}</div> : null}
        </div>

        <div className="glass-card account-provider-card">
          <div className="library-section-head">
            <div>
              <div className="section-title">{t('account.googleTitle')}</div>
              <div className="section-subtitle">{t('account.googleLinkCopy')}</div>
            </div>
            <div className="chip-row">
              {profile?.linkedProviders.includes('google') ? (
                <div className="account-pill authenticated">{t('account.connected')}</div>
              ) : null}
              {googleProvider ? (
                <button
                  className="chip"
                  type="button"
                  onClick={() => {
                    void handleUnlink('google');
                  }}
                  disabled={!canUnlinkProvider || unlinkBusyKind === 'google'}
                  title={!canUnlinkProvider ? t('account.unlinkLastBlocked') : undefined}
                >
                  {t('account.unlink')}
                </button>
              ) : null}
            </div>
          </div>
          {googleProvider ? (
            <div className="account-provider-value">
              {t('account.connectedAs')}: {googleProvider.email || googleProvider.displayName}
            </div>
          ) : null}
          {hasGoogleClient && !googleProvider && profile ? (
            <div className="account-google-slot" ref={googleButtonRef} />
          ) : (
            !googleProvider && profile ? <div className="section-subtitle">{t('account.googleUnavailable')}</div> : null
          )}
        </div>

        {shouldShowBilling ? (
          <div className="glass-card account-provider-card">
            <div className="library-section-head">
              <div>
                <div className="section-title">{t('account.billingTitle')}</div>
                <div className="section-subtitle">{t('account.billingCopy')}</div>
              </div>
            </div>
            <div className="account-policy-list compact">
              {(profile?.entitlements || []).map((entitlement) => (
                <div key={entitlement} className="account-policy-item">
                  {t(`account.entitlements.${entitlement}`)}
                </div>
              ))}
              {!profile?.entitlements.length ? (
                <div className="account-policy-item">{t('account.entitlements.cloud-sync')}</div>
              ) : null}
            </div>
            <div className="account-billing-grid">
              {premiumProducts.map((product) => (
                <button
                  key={product.id}
                  className="account-strategy-option"
                  type="button"
                  onClick={() => void openInvoice(product.id)}
                >
                  <span>{product.title}</span>
                  <strong>{product.amount} {product.currency}</strong>
                </button>
              ))}
              {donationProducts.map((product) => (
                <button
                  key={product.id}
                  className="account-strategy-option"
                  type="button"
                  onClick={() => void openInvoice(product.id)}
                >
                  <span>{product.title}</span>
                  <strong>{product.amount} {product.currency}</strong>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {shouldShowAudit ? (
          <div className="glass-card account-provider-card">
            <div className="library-section-head">
              <div>
                <div className="section-title">{t('account.auditTitle')}</div>
              </div>
            </div>
            <div className="account-audit-list">
              {auditTrail.slice(0, 5).map((event) => (
                <div key={event.id} className="account-audit-item">
                  <div className="account-audit-title">
                    {getAuditLabel(event, t)}
                    {event.providerKind ? ` · ${t(`account.providers.${event.providerKind}`)}` : ''}
                  </div>
                  <div className="account-audit-meta">{formatAuditTime(event.createdAt, locale)}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </SettingsSheet>
  );
};

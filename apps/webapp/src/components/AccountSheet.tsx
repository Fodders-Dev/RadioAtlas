import { useEffect, useRef, useState } from 'react';
import { useLocale } from '../state/LocaleContext';
import {
  useSession,
  type LibraryMergeStrategy,
  type SessionAuditEvent,
  type TelegramWidgetAuthData
} from '../state/SessionContext';
import { shouldExposeProductSurface } from '../lib/productSurfaceGuards';
import {
  getTelegramWebApp,
  isInsideTelegramClient,
  makeReferralLink,
  shareStationLink
} from '../lib/telegram';
import { SettingsSheet } from './SettingsSheet';

declare global {
  interface Window {
    __radioAtlasTelegramWidgetAuth__?: (user: unknown) => void;
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
const TELEGRAM_WIDGET_CALLBACK = '__radioAtlasTelegramWidgetAuth__';

const normalizeTelegramWidgetAuthData = (value: unknown): TelegramWidgetAuthData | null => {
  if (!value || typeof value !== 'object') return null;
  const payload = value as Record<string, unknown>;
  const id = Number(payload.id || 0);
  const firstName = String(payload.first_name || '').trim();
  const authDate = Number(payload.auth_date || 0);
  const hash = String(payload.hash || '').trim();
  if (!id || !firstName || !authDate || !hash) {
    return null;
  }
  return {
    id,
    first_name: firstName,
    auth_date: authDate,
    hash,
    ...(payload.last_name ? { last_name: String(payload.last_name) } : {}),
    ...(payload.username ? { username: String(payload.username) } : {}),
    ...(payload.photo_url ? { photo_url: String(payload.photo_url) } : {})
  };
};

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
  providers: Array<'telegram' | 'google' | 'vk'>,
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
    hasVkAuth,
    googleClientId,
    providerAvailability,
    isTelegramMiniApp,
    signInWithTelegram,
    signInWithTelegramWidget,
    signInWithGoogleCredential,
    beginVkAuth,
    unlinkProvider,
    createLinkCode,
    previewTelegramLink,
    previewTelegramWidgetLink,
    previewGoogleCredentialLink,
    confirmPendingLink,
    dismissPendingLink,
    createTelegramInvoice,
    refreshSession,
    signOut,
    openTelegramAccess
  } = useSession();
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const telegramWidgetRef = useRef<HTMLDivElement | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [telegramHint, setTelegramHint] = useState<string | null>(null);
  const [billingHint, setBillingHint] = useState<string | null>(null);
  const [billingBusyId, setBillingBusyId] = useState<(typeof billingProducts)[number]['id'] | null>(null);
  const [awaitingBillingReturn, setAwaitingBillingReturn] = useState(false);
  const [telegramWidgetFailed, setTelegramWidgetFailed] = useState(false);
  const [unlinkBusyKind, setUnlinkBusyKind] = useState<'telegram' | 'google' | 'vk' | null>(null);
  const [mergeStrategy, setMergeStrategy] = useState<LibraryMergeStrategy>('combine');
  const telegramProvider = profile?.providers.find((provider) => provider.kind === 'telegram') || null;
  const googleProvider = profile?.providers.find((provider) => provider.kind === 'google') || null;
  const vkProvider = profile?.providers.find((provider) => provider.kind === 'vk') || null;
  const telegramAvailability = providerAvailability.telegram;
  const googleAvailability = providerAvailability.google;
  const vkAvailability = providerAvailability.vk;
  const canUnlinkProvider = (profile?.providers.length || 0) > 1;
  const billingSurfaceEnabled =
    shouldExposeProductSurface('billing') && shouldExposeProductSurface('stars');
  const premiumProducts = billingSurfaceEnabled
    ? billingProducts.filter((product) => product.kind === 'premium' || product.kind === 'gift-premium')
    : [];
  const donationProducts = billingSurfaceEnabled
    ? billingProducts.filter((product) => product.kind === 'donation')
    : [];
  const shouldShowMergeControls = Boolean(profile?.providers.length || pendingLinkPreview);
  const shouldShowBilling = billingSurfaceEnabled && Boolean(profile && billingProducts.length);
  const shouldShowAudit = Boolean(profile && auditTrail.length);
  const canRenderGoogleButton = googleAvailability.configured && hasGoogleClient;
  const canStartVkAuth = hasVkAuth && vkAvailability.configured;
  const telegramBot = String(import.meta.env.VITE_TG_BOT || '').trim().replace(/^@/, '');
  // T_share_4: the invite card needs both a signed-in account (for ref_<id>) and
  // a bot username (to build the t.me link) — same feature-detect as the Story
  // button. Reward = the referral-theme entitlement on the profile.
  const canInvite = Boolean(profile && telegramBot);
  const hasReferralReward = Boolean(profile?.entitlements.includes('referral-theme'));
  const handleInviteShare = () => {
    if (!profile || !telegramBot) return;
    // Reuse the one ordered share flow (Telegram chat picker → web share →
    // clipboard → new tab); the deep link carries startapp=ref_<accountId>.
    void shareStationLink({
      url: makeReferralLink(telegramBot, profile.id),
      title: t('account.invite.shareTitle'),
      text: t('account.invite.shareText')
    });
  };
  const telegramWebLoginEnabled = String(import.meta.env.VITE_TELEGRAM_WEB_LOGIN || '') === '1';
  const canRenderTelegramWidget =
    !isTelegramMiniApp &&
    telegramAvailability.configured &&
    telegramWebLoginEnabled &&
    Boolean(telegramBot);

  useEffect(() => {
    if (!open || status !== 'authenticated') return;
    setLinkBusy(false);
    setTelegramHint(null);
    setBillingHint(null);
    setBillingBusyId(null);
    setAwaitingBillingReturn(false);
    setTelegramWidgetFailed(false);
  }, [open, status]);

  useEffect(() => {
    if (!open || !awaitingBillingReturn) return;

    const settleBillingReturn = () => {
      if (document.visibilityState === 'visible') {
        setAwaitingBillingReturn(false);
        void refreshSession().then((updated) => {
          setBillingBusyId(null);
          if (updated) {
            setBillingHint(t('account.billingPaidHint'));
          }
        });
      }
    };

    window.addEventListener('focus', settleBillingReturn);
    document.addEventListener('visibilitychange', settleBillingReturn);
    return () => {
      window.removeEventListener('focus', settleBillingReturn);
      document.removeEventListener('visibilitychange', settleBillingReturn);
    };
  }, [awaitingBillingReturn, open, refreshSession, t]);

  useEffect(() => {
    if (!open || !canRenderGoogleButton || !googleButtonRef.current) return;

    let mounted = true;
    void loadGoogleScript().then((ready) => {
      if (!mounted || !ready || !googleButtonRef.current || !window.google?.accounts?.id) return;
      googleButtonRef.current.innerHTML = '';
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: ({ credential }) => {
          void (async () => {
            // T0.5: provider link to an existing account now requires an
            // explicit linkCode minted by the account holder. Authenticated
            // users have a profile here; guests do not - and they only need
            // login / signup, not link.
            const linkCode = profile ? (await createLinkCode(mergeStrategy)) ?? undefined : undefined;
            const preview = await previewGoogleCredentialLink(credential, linkCode, mergeStrategy);
            if (preview && !preview.requiresConfirmation) {
              await signInWithGoogleCredential(credential, linkCode, mergeStrategy);
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
  }, [
    canRenderGoogleButton,
    createLinkCode,
    googleClientId,
    mergeStrategy,
    open,
    previewGoogleCredentialLink,
    profile,
    signInWithGoogleCredential
  ]);

  useEffect(() => {
    if (!open || !canRenderTelegramWidget || !telegramWidgetRef.current) return;

    let mounted = true;
    const container = telegramWidgetRef.current;
    setTelegramWidgetFailed(false);
    container.innerHTML = '';

    // Hotfix: data-onauth needs THIRD-PARTY cookies for oauth.telegram.org —
    // WebKit ITP (every iOS browser) and Huawei Browser block them, so the
    // callback silently never fires. GUESTS (the broken sign-in case) use
    // data-auth-url instead: a first-party TOP-LEVEL redirect to our API
    // callback, which validates the same signed payload and bounces back with
    // ?auth_provider=telegram&auth_result=success&token=… (handled by the
    // SessionContext return-handler). AUTHENTICATED users keep the onauth
    // path: linking needs linkCode + merge preview, which don't survive a
    // top-level redirect — and the always-visible bot deep-link chip below
    // covers them on ITP browsers.
    const useRedirectFlow = !profile;

    if (!useRedirectFlow) {
      window[TELEGRAM_WIDGET_CALLBACK] = (value: unknown) => {
        const authData = normalizeTelegramWidgetAuthData(value);
        if (!authData) {
          setTelegramHint(t('account.telegramGuestHint'));
          return;
        }
        void (async () => {
          setLinkBusy(true);
          setTelegramHint(null);
          try {
            const linkCode = profile ? (await createLinkCode(mergeStrategy)) ?? undefined : undefined;
            const preview = await previewTelegramWidgetLink(authData, linkCode, mergeStrategy);
            if (preview && !preview.requiresConfirmation) {
              await signInWithTelegramWidget(authData, linkCode, mergeStrategy);
            }
          } finally {
            if (mounted) {
              setLinkBusy(false);
            }
          }
        })();
      };
    }

    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.setAttribute('data-telegram-login', telegramBot);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '999');
    script.setAttribute('data-request-access', 'write');
    script.setAttribute('data-userpic', 'false');
    script.setAttribute('data-lang', locale.startsWith('ru') ? 'ru' : 'en');
    if (useRedirectFlow) {
      // Same-origin API path — never hardcode the domain.
      script.setAttribute('data-auth-url', `${window.location.origin}/api/auth/telegram/callback`);
    } else {
      script.setAttribute('data-onauth', `${TELEGRAM_WIDGET_CALLBACK}(user)`);
    }
    script.onerror = () => {
      if (!mounted) return;
      setTelegramWidgetFailed(true);
    };
    container.appendChild(script);

    return () => {
      mounted = false;
      delete window[TELEGRAM_WIDGET_CALLBACK];
      container.innerHTML = '';
    };
  }, [
    canRenderTelegramWidget,
    createLinkCode,
    locale,
    mergeStrategy,
    open,
    previewTelegramWidgetLink,
    profile,
    signInWithTelegramWidget,
    t,
    telegramBot
  ]);

  const handleTelegramLink = async () => {
    setLinkBusy(true);
    setTelegramHint(null);
    try {
      if (isTelegramMiniApp) {
        // T0.5: linking inside the Mini App now requires an explicit
        // linkCode minted by the account holder. Guests fall through with
        // no linkCode (login / create-new), authenticated users mint one
        // so the Telegram identity gets attached to their existing
        // account instead of spinning up a fresh one.
        const linkCode =
          profile ? (await createLinkCode(mergeStrategy)) ?? undefined : undefined;
        const preview = await previewTelegramLink(linkCode, mergeStrategy);
        if (!preview || !preview.requiresConfirmation) {
          await signInWithTelegram(linkCode, mergeStrategy);
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

  const handleUnlink = async (kind: 'telegram' | 'google' | 'vk') => {
    setUnlinkBusyKind(kind);
    try {
      await unlinkProvider(kind);
    } finally {
      setUnlinkBusyKind(null);
    }
  };

  const handleVkLink = async () => {
    setLinkBusy(true);
    try {
      const linkCode = profile ? (await createLinkCode(mergeStrategy)) ?? undefined : undefined;
      await beginVkAuth(linkCode, mergeStrategy);
    } finally {
      setLinkBusy(false);
    }
  };

  const providerHint = (kind: 'google' | 'vk') => {
    if (kind === 'google') {
      if (!googleAvailability.configured) return t('account.googleServerUnavailable');
      if (!hasGoogleClient) return t('account.googleUnavailable');
      return t('account.googleReady');
    }
    if (!vkAvailability.configured) return t('account.vkUnavailable');
    return t('account.vkReady');
  };

  const openInvoice = async (productId: (typeof billingProducts)[number]['id']) => {
    if (!billingSurfaceEnabled) return;
    setBillingBusyId(productId);
    setBillingHint(t('account.billingOpeningHint'));
    const invoice = await createTelegramInvoice(productId);
    if (!invoice) {
      setBillingBusyId(null);
      return;
    }
    // Strict client-only gate: the official SDK exposes openInvoice on
    // standalone web too (post-T1.1) but the call silently no-ops there
    // and never invokes our callback - the user would be stuck. Only
    // route through the SDK when we are genuinely inside the Telegram
    // client; the existing browser fallback below still serves
    // standalone users.
    const telegram = isInsideTelegramClient() ? getTelegramWebApp() : null;
    if (telegram?.openInvoice) {
      setBillingHint(t('account.billingReturnHint'));
      telegram.openInvoice(invoice.invoiceLink, (status: 'paid' | 'cancelled' | 'failed' | 'pending') => {
        setBillingBusyId(null);
        if (status === 'paid') {
          void refreshSession();
          setBillingHint(t('account.billingPaidHint'));
          return;
        }
        if (status === 'pending') {
          setAwaitingBillingReturn(true);
          setBillingHint(t('account.billingPendingHint'));
          return;
        }
        if (status === 'cancelled') {
          setBillingHint(t('account.billingCancelledHint'));
          return;
        }
        setBillingHint(t('account.billingFailedHint'));
      });
      return;
    }
    setAwaitingBillingReturn(true);
    setBillingHint(t('account.billingReturnHint'));
    if (telegram?.openTelegramLink) {
      telegram.openTelegramLink(invoice.invoiceLink);
      return;
    }
    if (telegram?.openLink) {
      telegram.openLink(invoice.invoiceLink);
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
          {!profile ? <div className="section-subtitle">{t('account.telegramGuestHint')}</div> : null}
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
                {/* Hotfix part 3: the bot deep-link chip renders ALONGSIDE the
                    widget, not instead of it. telegramWidgetFailed only fires
                    on script.onerror — the ITP "authorised and nothing
                    happened" case was an invisible dead end. */}
                {canRenderTelegramWidget && !telegramWidgetFailed ? (
                  <div
                    className="account-google-slot account-google-slot-inline account-telegram-slot"
                    ref={telegramWidgetRef}
                  />
                ) : null}
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
                {canRenderGoogleButton ? (
                  <div className="account-google-slot account-google-slot-inline" ref={googleButtonRef} />
                ) : (
                  <button className="chip" type="button" disabled title={providerHint('google')}>
                    {t('account.googleTitle')}
                  </button>
                )}
                <button
                  className={`chip ${canStartVkAuth ? '' : 'disabled'}`}
                  type="button"
                  onClick={() => {
                    void handleVkLink();
                  }}
                  disabled={!canStartVkAuth || linkBusy}
                  title={!canStartVkAuth ? providerHint('vk') : undefined}
                >
                  {t('account.vkAction')}
                </button>
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

        {canInvite ? (
          <div className="glass-card account-invite-card">
            <div className="library-section-head">
              <div>
                <div className="section-title">{t('account.invite.title')}</div>
                <div className="section-subtitle">{t('account.invite.subtitle')}</div>
              </div>
            </div>
            <div className="account-stats">
              <div className="globe-selection-pill active">
                <span>{t('account.invite.joinedLabel')}</span>
                <strong>{profile?.referralCount ?? 0}</strong>
              </div>
              <div className={`globe-selection-pill ${hasReferralReward ? 'active' : ''}`}>
                <span>{t('account.invite.rewardLabel')}</span>
                <strong>
                  {hasReferralReward
                    ? t('account.invite.rewardUnlocked')
                    : t('account.invite.rewardLocked')}
                </strong>
              </div>
            </div>
            <div className="settings-actions">
              <button className="chip" type="button" onClick={handleInviteShare}>
                {t('account.invite.shareCta')}
              </button>
            </div>
          </div>
        ) : null}

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

        {profile ? (
          <>
            <div className="glass-card account-provider-card">
              <div className="library-section-head">
                <div>
                  <div className="section-title">{t('account.telegramTitle')}</div>
                  <div className="section-subtitle">{t('account.telegramLinkCopy')}</div>
                </div>
                <div className="chip-row">
                  {telegramProvider ? (
                    <div className="account-pill authenticated">{t('account.connected')}</div>
                  ) : null}
                  {/* Hotfix part 3: always offer the bot deep-link next to the
                      widget — onerror never fires in the ITP silent-failure
                      case, so the chip can't be gated on telegramWidgetFailed. */}
                  {!telegramProvider ? (
                    <button
                      className="chip"
                      type="button"
                      onClick={() => {
                        void handleTelegramLink();
                      }}
                      disabled={linkBusy}
                    >
                      {t('account.linkTelegram')}
                    </button>
                  ) : null}
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
              {!telegramProvider && canRenderTelegramWidget && !telegramWidgetFailed ? (
                <div className="account-google-slot account-telegram-slot" ref={telegramWidgetRef} />
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
                  {profile.linkedProviders.includes('google') ? (
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
              {canRenderGoogleButton && !googleProvider ? (
                <div className="account-google-slot" ref={googleButtonRef} />
              ) : (
                !googleProvider ? <div className="section-subtitle">{providerHint('google')}</div> : null
              )}
            </div>

            <div className="glass-card account-provider-card">
              <div className="library-section-head">
                <div>
                  <div className="section-title">{t('account.vkTitle')}</div>
                  <div className="section-subtitle">{t('account.vkLinkCopy')}</div>
                </div>
                <div className="chip-row">
                  <button
                    className={`chip ${profile.linkedProviders.includes('vk') ? 'active' : ''}`}
                    type="button"
                    onClick={() => {
                      void handleVkLink();
                    }}
                    disabled={!canStartVkAuth || linkBusy}
                    title={!canStartVkAuth ? providerHint('vk') : undefined}
                  >
                    {profile.linkedProviders.includes('vk') ? t('account.connected') : t('account.vkAction')}
                  </button>
                  {vkProvider ? (
                    <button
                      className="chip"
                      type="button"
                      onClick={() => {
                        void handleUnlink('vk');
                      }}
                      disabled={!canUnlinkProvider || unlinkBusyKind === 'vk'}
                      title={!canUnlinkProvider ? t('account.unlinkLastBlocked') : undefined}
                    >
                      {t('account.unlink')}
                    </button>
                  ) : null}
                </div>
              </div>
              {vkProvider ? (
                <div className="account-provider-value">
                  {t('account.connectedAs')}: {vkProvider.email || vkProvider.username || vkProvider.displayName}
                </div>
              ) : null}
              {!vkProvider ? <div className="section-subtitle">{providerHint('vk')}</div> : null}
            </div>
          </>
        ) : null}

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
            {billingHint ? <div className="section-subtitle">{billingHint}</div> : null}
            <div className="account-billing-grid">
              {premiumProducts.map((product) => (
                <button
                  key={product.id}
                  className="account-strategy-option"
                  type="button"
                  onClick={() => void openInvoice(product.id)}
                  disabled={Boolean(billingBusyId)}
                  aria-busy={billingBusyId === product.id}
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
                  disabled={Boolean(billingBusyId)}
                  aria-busy={billingBusyId === product.id}
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

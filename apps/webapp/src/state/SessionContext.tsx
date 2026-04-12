import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  AuditEvent,
  BillingInvoice,
  BillingProduct,
  BillingProductId,
  CloudLibrary,
  LibraryMergeStrategy,
  MergePreview,
  ProviderKind,
  SessionProfile,
  SessionProviderInfo,
  SyncedTrackHistoryItem,
  UserCollection,
  FollowedRegion,
  FollowedStation,
  ListenerAlert
} from '../domain/contracts';
import { getApiBase } from '../lib/apiBase';
import type { StationLite } from '../types';

type LibraryCounts = {
  favorites: number;
  recent: number;
  trackHistory: number;
};

type AccountMergePreview = MergePreview;

type PendingLinkAction =
  | {
      providerKind: 'google';
      credential: string;
      linkCode?: string;
      preview: AccountMergePreview;
    }
  | {
      providerKind: 'telegram';
      linkCode?: string;
      preview: AccountMergePreview;
    };

type SessionAuditEvent = AuditEvent;

type SessionStatus = 'local' | 'authorizing' | 'authenticated' | 'error' | 'unavailable';
type SyncState = 'idle' | 'syncing' | 'synced' | 'error';

type SessionContextValue = {
  status: SessionStatus;
  syncState: SyncState;
  profile: SessionProfile | null;
  library: CloudLibrary | null;
  auditTrail: SessionAuditEvent[];
  error: string | null;
  accountSheetOpen: boolean;
  pendingLinkPreview: AccountMergePreview | null;
  isTelegramMiniApp: boolean;
  canUseCloud: boolean;
  canOpenTelegram: boolean;
  hasGoogleClient: boolean;
  googleClientId: string;
  billingProducts: BillingProduct[];
  signInWithTelegram: (linkCode?: string, mergeStrategy?: LibraryMergeStrategy) => Promise<void>;
  signInWithGoogleCredential: (
    credential: string,
    linkCode?: string,
    mergeStrategy?: LibraryMergeStrategy
  ) => Promise<void>;
  unlinkProvider: (kind: ProviderKind) => Promise<void>;
  createLinkCode: (mergeStrategy?: LibraryMergeStrategy) => Promise<string | null>;
  previewTelegramLink: (linkCode?: string, mergeStrategy?: LibraryMergeStrategy) => Promise<AccountMergePreview | null>;
  previewGoogleCredentialLink: (
    credential: string,
    linkCode?: string,
    mergeStrategy?: LibraryMergeStrategy
  ) => Promise<AccountMergePreview | null>;
  confirmPendingLink: () => Promise<void>;
  dismissPendingLink: () => void;
  signOut: () => void;
  replaceCloudLibrary: (library: Omit<CloudLibrary, 'updatedAt'>) => Promise<void>;
  updateCollections: (collections: UserCollection[]) => Promise<void>;
  updateFollows: (payload: {
    followedStations: FollowedStation[];
    followedRegions: FollowedRegion[];
  }) => Promise<void>;
  updateAlerts: (alerts: ListenerAlert[]) => Promise<void>;
  createTelegramInvoice: (
    productId: BillingProductId,
    recipientAccountId?: string | null
  ) => Promise<BillingInvoice | null>;
  openTelegramAccess: (linkCode?: string | null) => void;
  openAccountSheet: () => void;
  closeAccountSheet: () => void;
};

type SessionPayload = {
  token: string;
  profile: SessionProfile & { library: CloudLibrary };
  auditTrail: SessionAuditEvent[];
};

const mapProfile = (profile: SessionPayload['profile']): SessionProfile => ({
  id: profile.id,
  displayName: profile.displayName,
  username: profile.username,
  email: profile.email,
  photoUrl: profile.photoUrl,
  isPremium: profile.isPremium,
  premiumStatus: profile.premiumStatus,
  supporterTier: profile.supporterTier,
  entitlements: profile.entitlements,
  billingProvider: profile.billingProvider,
  linkedProviders: profile.linkedProviders,
  providers: profile.providers
});

const SESSION_STORAGE_KEY = 'radio:session:v1';
const SessionContext = createContext<SessionContextValue | null>(null);

const getTelegramInitData = () => window.Telegram?.WebApp?.initData || '';
const isTelegramMiniApp = () => Boolean(window.Telegram?.WebApp?.initDataUnsafe?.user);

const getStoredToken = () => {
  try {
    return localStorage.getItem(SESSION_STORAGE_KEY) || '';
  } catch {
    return '';
  }
};

const setStoredToken = (token: string) => {
  try {
    if (token) {
      localStorage.setItem(SESSION_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
};

export const SessionProvider = ({ children }: { children: ReactNode }) => {
  const [status, setStatus] = useState<SessionStatus>('local');
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [profile, setProfile] = useState<SessionProfile | null>(null);
  const [library, setLibrary] = useState<CloudLibrary | null>(null);
  const [auditTrail, setAuditTrail] = useState<SessionAuditEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [accountSheetOpen, setAccountSheetOpen] = useState(false);
  const [pendingLinkAction, setPendingLinkAction] = useState<PendingLinkAction | null>(null);
  const [billingProducts, setBillingProducts] = useState<BillingProduct[]>([]);
  const apiBase = getApiBase();
  const telegramMiniApp = typeof window !== 'undefined' && isTelegramMiniApp();
  const googleClientId = String(import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();
  const hasGoogleClient = Boolean(googleClientId);
  const canUseCloud = Boolean(apiBase);
  const canOpenTelegram = Boolean(import.meta.env.VITE_TG_BOT || telegramMiniApp);

  const applySessionPayload = useCallback((payload: SessionPayload) => {
    setStoredToken(payload.token);
    setProfile(mapProfile(payload.profile));
    setLibrary(payload.profile.library);
    setAuditTrail(payload.auditTrail || []);
    setStatus('authenticated');
    setSyncState('synced');
    setError(null);
    setPendingLinkAction(null);
    setAccountSheetOpen(false);
  }, []);

  const fetchProfile = useCallback(
    async (token: string) => {
      if (!apiBase || !token) return false;
      try {
        const response = await fetch(`${apiBase}/me`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        if (!response.ok) {
          if (response.status === 401 || response.status === 404) {
            setStoredToken('');
            setProfile(null);
            setLibrary(null);
            setAuditTrail([]);
            setStatus('local');
            setSyncState('idle');
            setError(null);
            return false;
          }
          throw new Error(`profile load failed (${response.status})`);
        }
        const data = (await response.json()) as { profile: SessionPayload['profile'] };
        applySessionPayload({
          token,
          profile: data.profile,
          auditTrail: data.auditTrail || []
        });
        return true;
      } catch (err) {
        setStoredToken('');
        setProfile(null);
        setLibrary(null);
        setAuditTrail([]);
        setStatus(apiBase ? 'error' : 'local');
        setError(err instanceof Error ? err.message : 'profile load failed');
        return false;
      }
    },
    [apiBase, applySessionPayload]
  );

  const createLinkCode = useCallback(async (mergeStrategy: LibraryMergeStrategy = 'combine') => {
    const token = getStoredToken();
    if (!apiBase || !token || !profile) return null;
    try {
      const response = await fetch(`${apiBase}/me/link-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ mergeStrategy })
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(failure?.error || `link request failed (${response.status})`);
      }
      const data = (await response.json()) as { code: string; auditTrail?: SessionAuditEvent[] };
      if (data.auditTrail) {
        setAuditTrail(data.auditTrail);
      }
      return data.code;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'link request failed');
      return null;
    }
  }, [apiBase, profile]);

  const previewTelegramLink = useCallback(
    async (linkCode?: string, mergeStrategy: LibraryMergeStrategy = 'combine') => {
      if (!apiBase) {
        setStatus('unavailable');
        setError('Cloud API is unavailable');
        return null;
      }

      const initData = getTelegramInitData();
      if (!initData) {
        return null;
      }

      try {
        const token = getStoredToken();
        const response = await fetch(`${apiBase}/auth/telegram/preview`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            initData,
            mergeStrategy,
            ...(linkCode ? { linkCode } : {})
          })
        });
        if (!response.ok) {
          const failure = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(failure?.error || `telegram auth preview failed (${response.status})`);
        }
        const data = (await response.json()) as { preview: AccountMergePreview };
        if (data.preview.requiresConfirmation) {
          setPendingLinkAction({
            providerKind: 'telegram',
            linkCode,
            preview: data.preview
          });
        } else {
          setPendingLinkAction(null);
        }
        setError(null);
        return data.preview;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'telegram auth preview failed');
        return null;
      }
    },
    [apiBase]
  );

  const previewGoogleCredentialLink = useCallback(
    async (
      credential: string,
      linkCode?: string,
      mergeStrategy: LibraryMergeStrategy = 'combine'
    ) => {
      if (!apiBase) {
        setStatus('unavailable');
        setError('Cloud API is unavailable');
        return null;
      }

      try {
        const token = getStoredToken();
        const response = await fetch(`${apiBase}/auth/google/preview`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            credential,
            mergeStrategy,
            ...(linkCode ? { linkCode } : {})
          })
        });
        if (!response.ok) {
          const failure = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(failure?.error || `google auth preview failed (${response.status})`);
        }
        const data = (await response.json()) as { preview: AccountMergePreview };
        if (data.preview.requiresConfirmation) {
          setPendingLinkAction({
            providerKind: 'google',
            credential,
            linkCode,
            preview: data.preview
          });
        } else {
          setPendingLinkAction(null);
        }
        setError(null);
        return data.preview;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'google auth preview failed');
        return null;
      }
    },
    [apiBase]
  );

  const signInWithTelegram = useCallback(
    async (linkCode?: string, mergeStrategy: LibraryMergeStrategy = 'combine') => {
      if (!apiBase) {
        setStatus('unavailable');
        setError('Cloud API is unavailable');
        return;
      }

      const initData = getTelegramInitData();
      if (!initData) {
        const botName = import.meta.env.VITE_TG_BOT as string | undefined;
        if (botName) {
          const suffix = linkCode ? `link_${linkCode}` : 'radio';
          const target = `https://t.me/${botName.replace(/^@/, '')}?startapp=${suffix}`;
          window.open(target, '_blank', 'noopener,noreferrer');
        } else {
          setStatus('error');
          setError('Telegram Mini App data is unavailable');
        }
        return;
      }

      setStatus('authorizing');
      setError(null);

      try {
        const token = getStoredToken();
        const response = await fetch(`${apiBase}/auth/telegram`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            initData,
            mergeStrategy,
            ...(linkCode ? { linkCode } : {})
          })
        });
        if (!response.ok) {
          const failure = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(failure?.error || `telegram auth failed (${response.status})`);
        }
        const payload = (await response.json()) as SessionPayload;
        applySessionPayload(payload);
      } catch (err) {
        setStatus('error');
        setSyncState('error');
        setError(err instanceof Error ? err.message : 'telegram auth failed');
      }
    },
    [apiBase, applySessionPayload]
  );

  const signInWithGoogleCredential = useCallback(
    async (
      credential: string,
      linkCode?: string,
      mergeStrategy: LibraryMergeStrategy = 'combine'
    ) => {
      if (!apiBase) {
        setStatus('unavailable');
        setError('Cloud API is unavailable');
        return;
      }

      setStatus('authorizing');
      setError(null);

      try {
        const token = getStoredToken();
        const response = await fetch(`${apiBase}/auth/google`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            credential,
            mergeStrategy,
            ...(linkCode ? { linkCode } : {})
          })
        });
        if (!response.ok) {
          const failure = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(failure?.error || `google auth failed (${response.status})`);
        }
        const payload = (await response.json()) as SessionPayload;
        applySessionPayload(payload);
      } catch (err) {
        setStatus('error');
        setSyncState('error');
        setError(err instanceof Error ? err.message : 'google auth failed');
      }
    },
    [apiBase, applySessionPayload]
  );

  const unlinkProvider = useCallback(
    async (kind: ProviderKind) => {
      const token = getStoredToken();
      if (!apiBase || !token || !profile) return;
      try {
        const response = await fetch(`${apiBase}/me/providers/${kind}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        if (!response.ok) {
          const failure = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(failure?.error || `provider unlink failed (${response.status})`);
        }
        const payload = (await response.json()) as {
          profile: SessionPayload['profile'];
          auditTrail?: SessionAuditEvent[];
        };
        setProfile(mapProfile(payload.profile));
        setLibrary(payload.profile.library);
        setAuditTrail(payload.auditTrail || []);
        setStatus('authenticated');
        setSyncState('synced');
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'provider unlink failed');
      }
    },
    [apiBase, profile]
  );

  const replaceCloudLibrary = useCallback(
    async (nextLibrary: Omit<CloudLibrary, 'updatedAt'>) => {
      const token = getStoredToken();
      if (!apiBase || !token || !profile) return;
      setSyncState('syncing');
      try {
        const response = await fetch(`${apiBase}/me/library`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify(nextLibrary)
        });
        if (!response.ok) {
          const failure = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(failure?.error || `library sync failed (${response.status})`);
        }
        const data = (await response.json()) as {
          profile: SessionPayload['profile'];
          auditTrail?: SessionAuditEvent[];
        };
        setLibrary(data.profile.library);
        setProfile(mapProfile(data.profile));
        setAuditTrail(data.auditTrail || []);
        setSyncState('synced');
        setError(null);
      } catch (err) {
        setSyncState('error');
        setError(err instanceof Error ? err.message : 'library sync failed');
      }
    },
    [apiBase, profile]
  );

  const updateCollections = useCallback(
    async (collections: UserCollection[]) => {
      const token = getStoredToken();
      if (!apiBase || !token || !profile) return;
      setSyncState('syncing');
      try {
        const response = await fetch(`${apiBase}/me/collections`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ collections })
        });
        if (!response.ok) {
          const failure = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(failure?.error || `collections sync failed (${response.status})`);
        }
        const data = (await response.json()) as {
          profile: SessionPayload['profile'];
          auditTrail?: SessionAuditEvent[];
        };
        setProfile(mapProfile(data.profile));
        setLibrary(data.profile.library);
        setAuditTrail(data.auditTrail || []);
        setSyncState('synced');
        setError(null);
      } catch (err) {
        setSyncState('error');
        setError(err instanceof Error ? err.message : 'collections sync failed');
      }
    },
    [apiBase, profile]
  );

  const updateFollows = useCallback(
    async (payload: { followedStations: FollowedStation[]; followedRegions: FollowedRegion[] }) => {
      const token = getStoredToken();
      if (!apiBase || !token || !profile) return;
      setSyncState('syncing');
      try {
        const response = await fetch(`${apiBase}/me/follows`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          const failure = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(failure?.error || `follows sync failed (${response.status})`);
        }
        const data = (await response.json()) as {
          profile: SessionPayload['profile'];
          auditTrail?: SessionAuditEvent[];
        };
        setProfile(mapProfile(data.profile));
        setLibrary(data.profile.library);
        setAuditTrail(data.auditTrail || []);
        setSyncState('synced');
        setError(null);
      } catch (err) {
        setSyncState('error');
        setError(err instanceof Error ? err.message : 'follows sync failed');
      }
    },
    [apiBase, profile]
  );

  const updateAlerts = useCallback(
    async (alerts: ListenerAlert[]) => {
      const token = getStoredToken();
      if (!apiBase || !token || !profile) return;
      setSyncState('syncing');
      try {
        const response = await fetch(`${apiBase}/me/alerts`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ alerts })
        });
        if (!response.ok) {
          const failure = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(failure?.error || `alerts sync failed (${response.status})`);
        }
        const data = (await response.json()) as {
          profile: SessionPayload['profile'];
          auditTrail?: SessionAuditEvent[];
        };
        setProfile(mapProfile(data.profile));
        setLibrary(data.profile.library);
        setAuditTrail(data.auditTrail || []);
        setSyncState('synced');
        setError(null);
      } catch (err) {
        setSyncState('error');
        setError(err instanceof Error ? err.message : 'alerts sync failed');
      }
    },
    [apiBase, profile]
  );

  const createTelegramInvoice = useCallback(
    async (productId: BillingProductId, recipientAccountId?: string | null) => {
      const token = getStoredToken();
      if (!apiBase || !token || !profile) return null;
      try {
        const response = await fetch(`${apiBase}/billing/telegram/create-invoice`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ productId, recipientAccountId: recipientAccountId || null })
        });
        if (!response.ok) {
          const failure = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(failure?.error || `invoice creation failed (${response.status})`);
        }
        const data = (await response.json()) as {
          purchaseId: string;
          product: BillingProduct;
          invoiceLink: string;
        };
        return {
          id: data.purchaseId,
          productId: data.product.id,
          title: data.product.title,
          amount: data.product.amount,
          currency: data.product.currency,
          invoiceLink: data.invoiceLink,
          createdAt: Date.now()
        } satisfies BillingInvoice;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'invoice creation failed');
        return null;
      }
    },
    [apiBase, profile]
  );

  const signOut = useCallback(() => {
    setStoredToken('');
    setProfile(null);
    setLibrary(null);
    setAuditTrail([]);
    setStatus('local');
    setSyncState('idle');
    setError(null);
    setPendingLinkAction(null);
    setAccountSheetOpen(false);
  }, []);

  const confirmPendingLink = useCallback(async () => {
    if (!pendingLinkAction) return;
    if (pendingLinkAction.providerKind === 'google') {
      await signInWithGoogleCredential(
        pendingLinkAction.credential,
        pendingLinkAction.linkCode,
        pendingLinkAction.preview.strategy
      );
      return;
    }

    await signInWithTelegram(
      pendingLinkAction.linkCode,
      pendingLinkAction.preview.strategy
    );
  }, [pendingLinkAction, signInWithGoogleCredential, signInWithTelegram]);

  const dismissPendingLink = useCallback(() => {
    setPendingLinkAction(null);
  }, []);

  const openTelegramAccess = useCallback((linkCode?: string | null) => {
    const botName = import.meta.env.VITE_TG_BOT as string | undefined;
    if (!botName) return;
    const suffix = linkCode ? `link_${linkCode}` : 'radio';
    const target = `https://t.me/${botName.replace(/^@/, '')}?startapp=${suffix}`;
    window.open(target, '_blank', 'noopener,noreferrer');
  }, []);

  useEffect(() => {
    if (!apiBase) {
      setStatus('local');
      return;
    }

    const initData = getTelegramInitData();
    const token = getStoredToken();

    if (initData) {
      void signInWithTelegram();
      return;
    }

    if (token) {
      void fetchProfile(token);
      return;
    }

    setStatus('local');
  }, [apiBase, fetchProfile, signInWithTelegram]);

  useEffect(() => {
    if (!apiBase) {
      setBillingProducts([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${apiBase}/billing/telegram/products`);
        if (!response.ok) return;
        const data = (await response.json()) as { products?: BillingProduct[] };
        if (!cancelled) {
          setBillingProducts(Array.isArray(data.products) ? data.products : []);
        }
      } catch {
        if (!cancelled) {
          setBillingProducts([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      syncState,
      profile,
      library,
      auditTrail,
      error,
      accountSheetOpen,
      pendingLinkPreview: pendingLinkAction?.preview || null,
      isTelegramMiniApp: telegramMiniApp,
      canUseCloud,
      canOpenTelegram,
      hasGoogleClient,
      googleClientId,
      billingProducts,
      signInWithTelegram,
      signInWithGoogleCredential,
      unlinkProvider,
      createLinkCode,
      previewTelegramLink,
      previewGoogleCredentialLink,
      confirmPendingLink,
      dismissPendingLink,
      signOut,
      replaceCloudLibrary,
      updateCollections,
      updateFollows,
      updateAlerts,
      createTelegramInvoice,
      openTelegramAccess,
      openAccountSheet: () => setAccountSheetOpen(true),
      closeAccountSheet: () => setAccountSheetOpen(false)
    }),
    [
      status,
      syncState,
      profile,
      library,
      auditTrail,
      error,
      accountSheetOpen,
      pendingLinkAction,
      telegramMiniApp,
      canUseCloud,
      canOpenTelegram,
      hasGoogleClient,
      googleClientId,
      billingProducts,
      signInWithTelegram,
      signInWithGoogleCredential,
      unlinkProvider,
      createLinkCode,
      previewTelegramLink,
      previewGoogleCredentialLink,
      confirmPendingLink,
      dismissPendingLink,
      signOut,
      replaceCloudLibrary,
      updateCollections,
      updateFollows,
      updateAlerts,
      createTelegramInvoice,
      openTelegramAccess
    ]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};

export const useSession = () => {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used inside SessionProvider');
  }
  return context;
};

export type { AccountMergePreview, LibraryCounts, SessionAuditEvent };
export type {
  BillingInvoice,
  BillingProduct,
  BillingProductId,
  CloudLibrary,
  FollowedRegion,
  FollowedStation,
  LibraryMergeStrategy,
  ListenerAlert,
  MergePreviewParty,
  ProviderKind,
  SessionProfile,
  SessionProviderInfo,
  SyncedTrackHistoryItem,
  UserCollection
} from '../domain/contracts';

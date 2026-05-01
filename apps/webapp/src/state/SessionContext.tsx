import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  AuditEvent,
  BillingInvoice,
  BillingProduct,
  BillingProductId,
  CloudLibrary,
  LibraryMergeStrategy,
  MergePreview,
  ProviderAvailability,
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
import { reportClientEvent } from '../lib/observability';
import { shouldExposeProductSurface } from '../lib/productSurfaceGuards';
import { cloudLibraryMatches } from './radio/helpers';
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
      authData?: TelegramWidgetAuthData;
      linkCode?: string;
      preview: AccountMergePreview;
    }
  | {
      providerKind: 'vk';
      authTicket: string;
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
  hasVkAuth: boolean;
  googleClientId: string;
  providerAvailability: Record<ProviderKind, ProviderAvailability>;
  billingProducts: BillingProduct[];
  signInWithTelegram: (linkCode?: string, mergeStrategy?: LibraryMergeStrategy) => Promise<void>;
  signInWithGoogleCredential: (
    credential: string,
    linkCode?: string,
    mergeStrategy?: LibraryMergeStrategy
  ) => Promise<void>;
  signInWithTelegramWidget: (
    authData: TelegramWidgetAuthData,
    linkCode?: string,
    mergeStrategy?: LibraryMergeStrategy
  ) => Promise<void>;
  beginVkAuth: (mergeStrategy?: LibraryMergeStrategy) => Promise<void>;
  unlinkProvider: (kind: ProviderKind) => Promise<void>;
  createLinkCode: (mergeStrategy?: LibraryMergeStrategy) => Promise<string | null>;
  previewTelegramLink: (linkCode?: string, mergeStrategy?: LibraryMergeStrategy) => Promise<AccountMergePreview | null>;
  previewTelegramWidgetLink: (
    authData: TelegramWidgetAuthData,
    linkCode?: string,
    mergeStrategy?: LibraryMergeStrategy
  ) => Promise<AccountMergePreview | null>;
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
  refreshSession: () => Promise<boolean>;
  openTelegramAccess: (linkCode?: string | null) => void;
  openAccountSheet: () => void;
  closeAccountSheet: () => void;
};

type SessionPayload = {
  token: string;
  profile: SessionProfile & { library: CloudLibrary };
  auditTrail: SessionAuditEvent[];
};

type TelegramWidgetAuthData = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

type ProviderConfigPayload = Record<
  ProviderKind,
  {
    configured: boolean;
    label: string;
  }
>;

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

const providerInfosMatch = (left: SessionProviderInfo[], right: SessionProviderInfo[]) =>
  left.length === right.length &&
  left.every((provider, index) => {
    const candidate = right[index];
    return (
      provider.kind === candidate?.kind &&
      provider.externalId === candidate?.externalId &&
      provider.displayName === candidate?.displayName &&
      provider.username === candidate?.username &&
      provider.email === candidate?.email &&
      provider.photoUrl === candidate?.photoUrl &&
      provider.isPremium === candidate?.isPremium &&
      provider.linkedAt === candidate?.linkedAt
    );
  });

const profilesMatch = (left: SessionProfile | null, right: SessionProfile | null) => {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.id === right.id &&
    left.displayName === right.displayName &&
    left.username === right.username &&
    left.email === right.email &&
    left.photoUrl === right.photoUrl &&
    left.isPremium === right.isPremium &&
    left.premiumStatus === right.premiumStatus &&
    left.supporterTier === right.supporterTier &&
    left.billingProvider === right.billingProvider &&
    left.entitlements.length === right.entitlements.length &&
    left.entitlements.every((entitlement, index) => entitlement === right.entitlements[index]) &&
    left.linkedProviders.length === right.linkedProviders.length &&
    left.linkedProviders.every((provider, index) => provider === right.linkedProviders[index]) &&
    providerInfosMatch(left.providers, right.providers)
  );
};

const auditTrailMatches = (left: SessionAuditEvent[], right: SessionAuditEvent[]) =>
  left.length === right.length &&
  left.every((event, index) => {
    const candidate = right[index];
    return (
      event.id === candidate?.id &&
      event.accountId === candidate?.accountId &&
      event.type === candidate?.type &&
      event.providerKind === candidate?.providerKind &&
      event.providerExternalId === candidate?.providerExternalId &&
      event.createdAt === candidate?.createdAt
    );
  });

const mapProviderAvailability = (
  payload: ProviderConfigPayload | null,
  {
    hasGoogleClient
  }: {
    hasGoogleClient: boolean;
  }
): Record<ProviderKind, ProviderAvailability> => ({
  telegram: {
    kind: 'telegram',
    status: payload?.telegram?.configured ? 'available' : 'unavailable',
    configured: Boolean(payload?.telegram?.configured),
    label: payload?.telegram?.label || 'Telegram',
    reason: payload?.telegram?.configured ? null : 'telegram-not-configured'
  },
  google: {
    kind: 'google',
    status: payload?.google?.configured
      ? hasGoogleClient
        ? 'available'
        : 'requires-client'
      : 'unavailable',
    configured: Boolean(payload?.google?.configured),
    label: payload?.google?.label || 'Google',
    reason: payload?.google?.configured
      ? hasGoogleClient
        ? null
        : 'google-client-missing'
      : 'google-not-configured'
  },
  vk: {
    kind: 'vk',
    status: payload?.vk?.configured ? 'server-only' : 'unavailable',
    configured: Boolean(payload?.vk?.configured),
    label: payload?.vk?.label || 'VK',
    reason: payload?.vk?.configured ? null : 'vk-not-configured'
  }
});

const SESSION_STORAGE_KEY = 'radio:session:v1';
const DEFAULT_PROVIDER_AVAILABILITY: Record<ProviderKind, ProviderAvailability> = {
  telegram: {
    kind: 'telegram',
    status: 'unavailable',
    configured: false,
    label: 'Telegram',
    reason: null
  },
  google: {
    kind: 'google',
    status: 'requires-client',
    configured: false,
    label: 'Google',
    reason: null
  },
  vk: {
    kind: 'vk',
    status: 'server-only',
    configured: false,
    label: 'VK',
    reason: null
  }
};
const SessionContext = createContext<SessionContextValue | null>(null);

type TelegramRuntimeState = {
  available: boolean;
  initData: string;
  hasUser: boolean;
};

const readUrlParamSource = (value: string) => {
  const normalized = value.trim().replace(/^#/, '');
  if (!normalized) {
    return new URLSearchParams();
  }
  if (normalized.startsWith('/')) {
    const queryIndex = normalized.indexOf('?');
    return new URLSearchParams(queryIndex >= 0 ? normalized.slice(queryIndex + 1) : '');
  }
  return new URLSearchParams(normalized);
};

const readTelegramSearchParams = () => {
  if (typeof window === 'undefined') {
    return {
      initData: '',
      platform: '',
      version: '',
      hasStartParam: false
    };
  }
  const searchParams = readUrlParamSource(window.location.search);
  const hashParams = readUrlParamSource(window.location.hash);
  const readValue = (name: string) =>
    String(searchParams.get(name) || hashParams.get(name) || '').trim();
  return {
    initData: readValue('tgWebAppData'),
    platform: readValue('tgWebAppPlatform'),
    version: readValue('tgWebAppVersion'),
    hasStartParam:
      searchParams.has('tgWebAppStartParam') ||
      searchParams.has('startapp') ||
      searchParams.has('start_param') ||
      hashParams.has('tgWebAppStartParam') ||
      hashParams.has('startapp') ||
      hashParams.has('start_param')
  };
};

const getTelegramWebApp = () =>
  typeof window !== 'undefined' ? window.Telegram?.WebApp || null : null;

const readTelegramRuntimeState = (): TelegramRuntimeState => {
  const webApp = getTelegramWebApp();
  const search = readTelegramSearchParams();
  const runtimeInitData = typeof webApp?.initData === 'string' ? webApp.initData.trim() : '';
  const initData = runtimeInitData || search.initData;
  const userId = Number(webApp?.initDataUnsafe?.user?.id || 0);
  return {
    available:
      Boolean(webApp) ||
      Boolean(search.platform) ||
      Boolean(search.version) ||
      Boolean(search.initData) ||
      search.hasStartParam,
    initData,
    hasUser: Number.isFinite(userId) && userId > 0
  };
};

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const resolveTelegramInitData = async (timeoutMs = 1500) => {
  const immediate = readTelegramRuntimeState().initData;
  if (immediate) return immediate;

  const webApp = getTelegramWebApp();
  webApp?.ready?.();
  webApp?.expand?.();

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await wait(120);
    const next = readTelegramRuntimeState().initData;
    if (next) return next;
  }
  return '';
};

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

type SessionTelemetryLibrary = Omit<CloudLibrary, 'updatedAt'> | CloudLibrary | null | undefined;

const readLibraryTelemetryCounts = (library: SessionTelemetryLibrary) => ({
  favorites: library?.favorites.length || 0,
  recent: library?.recent.length || 0,
  trackHistory: library?.trackHistory.length || 0,
  collections: library?.collections.length || 0,
  followedStations: library?.followedStations.length || 0,
  followedRegions: library?.followedRegions.length || 0,
  alerts: library?.alerts.length || 0,
  tasteSignals: library?.tasteProfile?.signals.length || 0
});

const buildLibraryTelemetrySignature = (library: SessionTelemetryLibrary) => {
  const counts = readLibraryTelemetryCounts(library);
  return [
    counts.favorites,
    counts.recent,
    counts.trackHistory,
    counts.collections,
    counts.followedStations,
    counts.followedRegions,
    counts.alerts,
    counts.tasteSignals
  ].join(':');
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
  const [providerAvailability, setProviderAvailability] = useState<
    Record<ProviderKind, ProviderAvailability>
  >(DEFAULT_PROVIDER_AVAILABILITY);
  const [telegramRuntime, setTelegramRuntime] = useState<TelegramRuntimeState>(() =>
    readTelegramRuntimeState()
  );
  const apiBase = getApiBase();
  const telegramMiniApp = telegramRuntime.available;
  const googleClientId = String(import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();
  const hasGoogleClient = Boolean(googleClientId);
  const hasVkAuth = providerAvailability.vk.configured;
  const canUseCloud = Boolean(apiBase);
  const canOpenTelegram = Boolean(import.meta.env.VITE_TG_BOT || telegramMiniApp);
  const profileRef = useRef(profile);
  const libraryRef = useRef(library);
  const queuedCloudLibraryRef = useRef<Omit<CloudLibrary, 'updatedAt'> | null>(null);
  const inFlightCloudLibraryRef = useRef<Omit<CloudLibrary, 'updatedAt'> | null>(null);
  const cloudLibrarySyncPromiseRef = useRef<Promise<void> | null>(null);

  profileRef.current = profile;
  libraryRef.current = library;

  const createSessionTelemetryMeta = useCallback(
    ({
      nextStatus,
      nextSyncState,
      nextProfile,
      nextLibrary,
      queuedLibrary,
      inFlightLibrary,
      nextError,
      nextAccountSheetOpen,
      extra
    }: {
      nextStatus?: SessionStatus;
      nextSyncState?: SyncState;
      nextProfile?: SessionProfile | null;
      nextLibrary?: SessionTelemetryLibrary;
      queuedLibrary?: SessionTelemetryLibrary;
      inFlightLibrary?: SessionTelemetryLibrary;
      nextError?: string | null;
      nextAccountSheetOpen?: boolean;
      extra?: Record<string, unknown>;
    } = {}) => ({
      status: nextStatus ?? status,
      syncState: nextSyncState ?? syncState,
      profileId: (nextProfile ?? profileRef.current)?.id || null,
      providerCount: (nextProfile ?? profileRef.current)?.providers.length || 0,
      linkedProviders: (nextProfile ?? profileRef.current)?.linkedProviders || [],
      premiumStatus: (nextProfile ?? profileRef.current)?.premiumStatus || 'free',
      libraryCounts: readLibraryTelemetryCounts(nextLibrary ?? libraryRef.current),
      queuedLibraryCounts: readLibraryTelemetryCounts(
        queuedLibrary ?? queuedCloudLibraryRef.current
      ),
      inFlightLibraryCounts: readLibraryTelemetryCounts(
        inFlightLibrary ?? inFlightCloudLibraryRef.current
      ),
      accountSheetOpen: nextAccountSheetOpen ?? accountSheetOpen,
      telegramMiniApp,
      canUseCloud,
      apiConfigured: Boolean(apiBase),
      hasError: Boolean(nextError ?? error),
      ...(extra || {})
    }),
    [accountSheetOpen, apiBase, canUseCloud, error, status, syncState, telegramMiniApp]
  );

  const reportSessionEvent = useCallback(
    (
      name: string,
      {
        detail = null,
        dedupeKey = name,
        dedupeMs,
        nextStatus,
        nextSyncState,
        nextProfile,
        nextLibrary,
        queuedLibrary,
        inFlightLibrary,
        nextError,
        nextAccountSheetOpen,
        extra
      }: {
        detail?: string | null;
        dedupeKey?: string | null;
        dedupeMs?: number;
        nextStatus?: SessionStatus;
        nextSyncState?: SyncState;
        nextProfile?: SessionProfile | null;
        nextLibrary?: SessionTelemetryLibrary;
        queuedLibrary?: SessionTelemetryLibrary;
        inFlightLibrary?: SessionTelemetryLibrary;
        nextError?: string | null;
        nextAccountSheetOpen?: boolean;
        extra?: Record<string, unknown>;
      } = {}
    ) => {
      reportClientEvent(name, {
        detail,
        dedupeKey,
        dedupeMs,
        meta: createSessionTelemetryMeta({
          nextStatus,
          nextSyncState,
          nextProfile,
          nextLibrary,
          queuedLibrary,
          inFlightLibrary,
          nextError,
          nextAccountSheetOpen,
          extra
        })
      });
    },
    [createSessionTelemetryMeta]
  );

  const resetCloudLibrarySyncQueue = useCallback(() => {
    queuedCloudLibraryRef.current = null;
    inFlightCloudLibraryRef.current = null;
    cloudLibrarySyncPromiseRef.current = null;
  }, []);

  const applySessionSnapshot = useCallback(
    (nextProfile: SessionPayload['profile'], nextAuditTrail?: SessionAuditEvent[]) => {
      const mappedProfile = mapProfile(nextProfile);
      const resolvedAuditTrail = nextAuditTrail || [];
      setProfile((previous) => (profilesMatch(previous, mappedProfile) ? previous : mappedProfile));
      setLibrary((previous) => (cloudLibraryMatches(previous, nextProfile.library) ? previous : nextProfile.library));
      setAuditTrail((previous) => (auditTrailMatches(previous, resolvedAuditTrail) ? previous : resolvedAuditTrail));
    },
    []
  );

  const applySessionPayload = useCallback((
    payload: SessionPayload,
    options?: {
      closeAccountSheet?: boolean;
    }
  ) => {
    const closeAccountSheet = options?.closeAccountSheet ?? true;
    const mappedProfile = mapProfile(payload.profile);
    setStoredToken(payload.token);
    resetCloudLibrarySyncQueue();
    applySessionSnapshot(payload.profile, payload.auditTrail);
    setStatus('authenticated');
    setSyncState('synced');
    setError(null);
    setPendingLinkAction(null);
    setAccountSheetOpen((previous) => (closeAccountSheet ? false : previous));
    reportSessionEvent('session_authenticated', {
      detail: mappedProfile.id,
      dedupeKey: `session_authenticated:${mappedProfile.id}:${payload.profile.library.updatedAt}`,
      nextStatus: 'authenticated',
      nextSyncState: 'synced',
      nextProfile: mappedProfile,
      nextLibrary: payload.profile.library,
      nextError: null,
      nextAccountSheetOpen: closeAccountSheet ? false : accountSheetOpen,
      extra: {
        auditTrailCount: payload.auditTrail.length
      }
    });
  }, [accountSheetOpen, applySessionSnapshot, reportSessionEvent, resetCloudLibrarySyncQueue]);

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
            resetCloudLibrarySyncQueue();
            setStoredToken('');
            setProfile(null);
            setLibrary(null);
            setAuditTrail([]);
            setStatus('local');
            setSyncState('idle');
            setError(null);
            reportSessionEvent('session_invalidated', {
              detail: `refresh:${response.status}`,
              dedupeKey: `session_invalidated:${response.status}`,
              nextStatus: 'local',
              nextSyncState: 'idle',
              nextProfile: null,
              nextLibrary: null,
              nextError: null
            });
            return false;
          }
          throw new Error(`profile load failed (${response.status})`);
        }
        const data = (await response.json()) as { profile: SessionPayload['profile'] };
        applySessionPayload({
          token,
          profile: data.profile,
          auditTrail: data.auditTrail || []
        }, {
          closeAccountSheet: false
        });
        return true;
      } catch (err) {
        resetCloudLibrarySyncQueue();
        setStoredToken('');
        setProfile(null);
        setLibrary(null);
        setAuditTrail([]);
        setStatus(apiBase ? 'error' : 'local');
        const message = err instanceof Error ? err.message : 'profile load failed';
        setError(message);
        reportSessionEvent('session_refresh_error', {
          detail: message,
          dedupeKey: `session_refresh_error:${message}`,
          dedupeMs: 15_000,
          nextStatus: apiBase ? 'error' : 'local',
          nextError: message,
          extra: {
            phase: 'refresh'
          }
        });
        return false;
      }
    },
    [apiBase, applySessionPayload, reportSessionEvent, resetCloudLibrarySyncQueue]
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

      const initData = await resolveTelegramInitData(telegramMiniApp ? 1800 : 0);
      if (!initData) {
        if (telegramMiniApp) {
          setError('Telegram Mini App data is not ready yet');
        }
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
    [apiBase, telegramMiniApp]
  );

  const previewTelegramWidgetLink = useCallback(
    async (
      authData: TelegramWidgetAuthData,
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
        const response = await fetch(`${apiBase}/auth/telegram/widget/preview`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            authData,
            mergeStrategy,
            ...(linkCode ? { linkCode } : {})
          })
        });
        if (!response.ok) {
          const failure = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(failure?.error || `telegram widget auth preview failed (${response.status})`);
        }
        const data = (await response.json()) as { preview: AccountMergePreview };
        if (data.preview.requiresConfirmation) {
          setPendingLinkAction({
            providerKind: 'telegram',
            authData,
            linkCode,
            preview: data.preview
          });
        } else {
          setPendingLinkAction(null);
        }
        setError(null);
        return data.preview;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'telegram widget auth preview failed');
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

      const initData = await resolveTelegramInitData(telegramMiniApp ? 2200 : 0);
      if (!initData) {
        if (telegramMiniApp) {
          setStatus('error');
          setError('Telegram Mini App data is not ready yet');
          return;
        }
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
    [apiBase, applySessionPayload, telegramMiniApp]
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

  const signInWithTelegramWidget = useCallback(
    async (
      authData: TelegramWidgetAuthData,
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
        const response = await fetch(`${apiBase}/auth/telegram/widget`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            authData,
            mergeStrategy,
            ...(linkCode ? { linkCode } : {})
          })
        });
        if (!response.ok) {
          const failure = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(failure?.error || `telegram widget auth failed (${response.status})`);
        }
        const payload = (await response.json()) as SessionPayload;
        applySessionPayload(payload);
      } catch (err) {
        setStatus('error');
        setSyncState('error');
        setError(err instanceof Error ? err.message : 'telegram widget auth failed');
      }
    },
    [apiBase, applySessionPayload]
  );

  const beginVkAuth = useCallback(
    async (mergeStrategy: LibraryMergeStrategy = 'combine') => {
      if (!apiBase) {
        setStatus('unavailable');
        setError('Cloud API is unavailable');
        return;
      }

      setStatus('authorizing');
      setError(null);

      try {
        const token = getStoredToken();
        const url = new URL(`${apiBase}/auth/vk/start`);
        url.searchParams.set('mergeStrategy', mergeStrategy);
        const response = await fetch(url.toString(), {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined
        });
        if (!response.ok) {
          const failure = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(failure?.error || `vk auth start failed (${response.status})`);
        }
        const data = (await response.json()) as { authUrl?: string };
        if (!data.authUrl) {
          throw new Error('vk auth url is missing');
        }
        window.location.assign(data.authUrl);
      } catch (err) {
        setStatus('error');
        setError(err instanceof Error ? err.message : 'vk auth start failed');
      }
    },
    [apiBase]
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

  const flushCloudLibrarySync = useCallback(async () => {
    if (cloudLibrarySyncPromiseRef.current || !queuedCloudLibraryRef.current) {
      return cloudLibrarySyncPromiseRef.current ?? Promise.resolve();
    }

    const token = getStoredToken();
    if (!apiBase || !token || !profileRef.current) {
      resetCloudLibrarySyncQueue();
      return;
    }

    const requestLibrary = queuedCloudLibraryRef.current;
    queuedCloudLibraryRef.current = null;
    inFlightCloudLibraryRef.current = requestLibrary;
    setSyncState('syncing');
    reportSessionEvent('session_sync_start', {
      detail: profileRef.current.id,
      dedupeKey: `session_sync_start:${profileRef.current.id}:${buildLibraryTelemetrySignature(requestLibrary)}`,
      dedupeMs: 2_000,
      nextSyncState: 'syncing',
      inFlightLibrary: requestLibrary,
      queuedLibrary: null,
      extra: {
        phase: 'cloud-library'
      }
    });

    const promise = (async () => {
      try {
        const response = await fetch(`${apiBase}/me/library`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify(requestLibrary)
        });
        if (!response.ok) {
          const failure = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(failure?.error || `library sync failed (${response.status})`);
        }
        const data = (await response.json()) as {
          profile: SessionPayload['profile'];
          auditTrail?: SessionAuditEvent[];
        };
        if (getStoredToken() !== token || !profileRef.current) {
          return;
        }
        applySessionSnapshot(data.profile, data.auditTrail);
        setSyncState('synced');
        setError(null);
        reportSessionEvent('session_sync_success', {
          detail: data.profile.id,
          dedupeKey: `session_sync_success:${data.profile.id}:${data.profile.library.updatedAt}`,
          nextSyncState: 'synced',
          nextProfile: mapProfile(data.profile),
          nextLibrary: data.profile.library,
          queuedLibrary: queuedCloudLibraryRef.current,
          inFlightLibrary: null,
          nextError: null,
          extra: {
            phase: 'cloud-library',
            auditTrailCount: data.auditTrail?.length || 0
          }
        });
      } catch (err) {
        setSyncState('error');
        const message = err instanceof Error ? err.message : 'library sync failed';
        setError(message);
        reportSessionEvent('session_sync_error', {
          detail: message,
          dedupeKey: `session_sync_error:${message}:${buildLibraryTelemetrySignature(requestLibrary)}`,
          dedupeMs: 15_000,
          nextSyncState: 'error',
          inFlightLibrary: requestLibrary,
          nextError: message,
          extra: {
            phase: 'cloud-library'
          }
        });
      } finally {
        inFlightCloudLibraryRef.current = null;
        cloudLibrarySyncPromiseRef.current = null;

        const queuedLibrary = queuedCloudLibraryRef.current;
        if (!queuedLibrary) {
          return;
        }
        if (cloudLibraryMatches(libraryRef.current, queuedLibrary)) {
          queuedCloudLibraryRef.current = null;
          reportSessionEvent('session_sync_noop', {
            dedupeKey: `session_sync_noop:${profileRef.current?.id || 'guest'}:${buildLibraryTelemetrySignature(queuedLibrary)}`,
            dedupeMs: 10_000,
            queuedLibrary: queuedLibrary,
            inFlightLibrary: null
          });
          return;
        }
        void flushCloudLibrarySync();
      }
    })();

    cloudLibrarySyncPromiseRef.current = promise;
    return promise;
  }, [apiBase, applySessionSnapshot, reportSessionEvent, resetCloudLibrarySyncQueue]);

  const replaceCloudLibrary = useCallback(
    async (nextLibrary: Omit<CloudLibrary, 'updatedAt'>) => {
      const token = getStoredToken();
      if (!apiBase || !token || !profileRef.current) return;
      if (
        cloudLibraryMatches(libraryRef.current, nextLibrary) ||
        cloudLibraryMatches(queuedCloudLibraryRef.current, nextLibrary) ||
        cloudLibraryMatches(inFlightCloudLibraryRef.current, nextLibrary)
      ) {
        reportSessionEvent('session_sync_skipped', {
          dedupeKey: `session_sync_skipped:${profileRef.current.id}:${buildLibraryTelemetrySignature(nextLibrary)}`,
          dedupeMs: 15_000,
          nextLibrary
        });
        return cloudLibrarySyncPromiseRef.current ?? Promise.resolve();
      }
      queuedCloudLibraryRef.current = nextLibrary;
      return flushCloudLibrarySync();
    },
    [apiBase, flushCloudLibrarySync, reportSessionEvent]
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
      if (!shouldExposeProductSurface('billing') || !shouldExposeProductSurface('stars')) {
        return null;
      }
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
    resetCloudLibrarySyncQueue();
    setStoredToken('');
    setProfile(null);
    setLibrary(null);
    setAuditTrail([]);
    setStatus('local');
    setSyncState('idle');
    setError(null);
    setPendingLinkAction(null);
    setAccountSheetOpen(false);
    reportSessionEvent('session_signed_out', {
      dedupeKey: `session_signed_out:${profileRef.current?.id || 'guest'}`,
      nextStatus: 'local',
      nextSyncState: 'idle',
      nextProfile: null,
      nextLibrary: null,
      nextError: null,
      nextAccountSheetOpen: false
    });
  }, [reportSessionEvent, resetCloudLibrarySyncQueue]);

  const refreshSession = useCallback(async () => {
    const token = getStoredToken();
    if (!token) return false;
    return fetchProfile(token);
  }, [fetchProfile]);

  const fetchProfileRef = useRef(fetchProfile);
  const signInWithTelegramRef = useRef(signInWithTelegram);
  const bootstrapSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    fetchProfileRef.current = fetchProfile;
  }, [fetchProfile]);

  useEffect(() => {
    signInWithTelegramRef.current = signInWithTelegram;
  }, [signInWithTelegram]);

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

    if (pendingLinkAction.providerKind === 'vk') {
      if (!apiBase) {
        setStatus('unavailable');
        setError('Cloud API is unavailable');
        return;
      }
      try {
        setStatus('authorizing');
        const response = await fetch(`${apiBase}/auth/vk/confirm`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            ticket: pendingLinkAction.authTicket,
            mergeStrategy: pendingLinkAction.preview.strategy
          })
        });
        if (!response.ok) {
          const failure = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(failure?.error || `vk auth confirm failed (${response.status})`);
        }
        const payload = (await response.json()) as SessionPayload;
        applySessionPayload(payload);
      } catch (err) {
        setStatus('error');
        setSyncState('error');
        setError(err instanceof Error ? err.message : 'vk auth confirm failed');
      }
      return;
    }

    if (pendingLinkAction.authData) {
      await signInWithTelegramWidget(
        pendingLinkAction.authData,
        pendingLinkAction.linkCode,
        pendingLinkAction.preview.strategy
      );
      return;
    }

    await signInWithTelegram(pendingLinkAction.linkCode, pendingLinkAction.preview.strategy);
  }, [
    apiBase,
    applySessionPayload,
    pendingLinkAction,
    signInWithGoogleCredential,
    signInWithTelegram,
    signInWithTelegramWidget
  ]);

  const dismissPendingLink = useCallback(() => {
    setPendingLinkAction(null);
  }, []);

  const openTelegramAccess = useCallback((linkCode?: string | null) => {
    const botName = import.meta.env.VITE_TG_BOT as string | undefined;
    if (!botName) {
      setError('Telegram bot deep link is not configured');
      return;
    }
    const suffix = linkCode ? `link_${linkCode}` : 'radio';
    const target = `https://t.me/${botName.replace(/^@/, '')}?startapp=${suffix}`;
    const telegram = window.Telegram?.WebApp;
    if (telegram?.openTelegramLink) {
      telegram.openTelegramLink(target);
      return;
    }
    if (telegram?.openLink) {
      telegram.openLink(target);
      return;
    }
    window.open(target, '_blank', 'noopener,noreferrer');
  }, [setError]);

  useEffect(() => {
    reportSessionEvent('session_state', {
      dedupeKey: `session_state:${status}:${syncState}:${profile?.id || 'guest'}:${buildLibraryTelemetrySignature(library)}`,
      dedupeMs: 30_000,
      nextStatus: status,
      nextSyncState: syncState,
      nextProfile: profile,
      nextLibrary: library,
      nextError: error,
      nextAccountSheetOpen: accountSheetOpen
    });
  }, [accountSheetOpen, error, library, profile, reportSessionEvent, status, syncState]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    let cancelled = false;
    const syncRuntime = () => {
      if (cancelled) return;
      const next = readTelegramRuntimeState();
      setTelegramRuntime((previous) =>
        previous.available === next.available &&
        previous.initData === next.initData &&
        previous.hasUser === next.hasUser
          ? previous
          : next
      );
    };

    syncRuntime();
    const webApp = getTelegramWebApp();
    webApp?.ready?.();
    webApp?.expand?.();

    const intervalId = window.setInterval(syncRuntime, 300);
    const timeoutId = window.setTimeout(() => window.clearInterval(intervalId), 6000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    if (!apiBase || typeof window === 'undefined') {
      return;
    }
    const url = new URL(window.location.href);
    const authProvider = url.searchParams.get('auth_provider');
    const authResult = url.searchParams.get('auth_result');
    if (authProvider !== 'vk' || !authResult) {
      return;
    }

    const cleanUrl = () => {
      ['auth_provider', 'auth_result', 'ticket', 'token', 'message'].forEach((key) =>
        url.searchParams.delete(key)
      );
      window.history.replaceState({}, document.title, url.toString());
    };

    if (authResult === 'success') {
      const token = url.searchParams.get('token') || '';
      cleanUrl();
      if (token) {
        void fetchProfile(token);
      }
      return;
    }

    if (authResult === 'preview') {
      const ticket = url.searchParams.get('ticket') || '';
      cleanUrl();
      if (!ticket) {
        return;
      }
      void (async () => {
        try {
          const response = await fetch(`${apiBase}/auth/vk/preview`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ticket })
          });
          if (!response.ok) {
            const failure = (await response.json().catch(() => null)) as { error?: string } | null;
            throw new Error(failure?.error || `vk auth preview failed (${response.status})`);
          }
          const data = (await response.json()) as { preview: AccountMergePreview };
          setPendingLinkAction({
            providerKind: 'vk',
            authTicket: ticket,
            preview: data.preview
          });
          setAccountSheetOpen(true);
          setError(null);
        } catch (err) {
          setStatus('error');
          setError(err instanceof Error ? err.message : 'vk auth preview failed');
        }
      })();
      return;
    }

    if (authResult === 'error') {
      const message = url.searchParams.get('message') || 'vk auth failed';
      cleanUrl();
      setStatus('error');
      setError(message);
    }
  }, [apiBase, fetchProfile]);

  useEffect(() => {
    if (!apiBase) {
      bootstrapSignatureRef.current = null;
      setStatus('local');
      return;
    }

    const token = getStoredToken();
    const bootstrapSignature = `${apiBase}|${telegramRuntime.initData || ''}|${token}`;
    if (bootstrapSignatureRef.current === bootstrapSignature) {
      return;
    }
    bootstrapSignatureRef.current = bootstrapSignature;

    if (telegramRuntime.initData) {
      void signInWithTelegramRef.current();
      return;
    }

    if (token) {
      void fetchProfileRef.current(token);
      return;
    }

    setStatus('local');
  }, [apiBase, telegramRuntime.initData]);

  useEffect(() => {
    if (!apiBase || !accountSheetOpen) {
      setProviderAvailability(
        mapProviderAvailability(null, {
          hasGoogleClient
        })
      );
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${apiBase}/auth/providers`);
        if (!response.ok) {
          throw new Error(`provider config failed (${response.status})`);
        }
        const data = (await response.json()) as ProviderConfigPayload;
        if (!cancelled) {
          setProviderAvailability(
            mapProviderAvailability(data, {
              hasGoogleClient
            })
          );
        }
      } catch {
        if (!cancelled) {
          setProviderAvailability(
            mapProviderAvailability(null, {
              hasGoogleClient
            })
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountSheetOpen, apiBase, hasGoogleClient]);

  useEffect(() => {
    if (
      !shouldExposeProductSurface('billing') ||
      !shouldExposeProductSurface('stars') ||
      !apiBase ||
      !accountSheetOpen ||
      status !== 'authenticated'
    ) {
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
  }, [accountSheetOpen, apiBase, status]);

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
      hasVkAuth,
      googleClientId,
      providerAvailability,
      billingProducts,
      signInWithTelegram,
      signInWithGoogleCredential,
      signInWithTelegramWidget,
      beginVkAuth,
      unlinkProvider,
      createLinkCode,
      previewTelegramLink,
      previewTelegramWidgetLink,
      previewGoogleCredentialLink,
      confirmPendingLink,
      dismissPendingLink,
      signOut,
      replaceCloudLibrary,
      updateCollections,
      updateFollows,
      updateAlerts,
      createTelegramInvoice,
      refreshSession,
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
      hasVkAuth,
      googleClientId,
      providerAvailability,
      billingProducts,
      signInWithTelegram,
      signInWithGoogleCredential,
      signInWithTelegramWidget,
      beginVkAuth,
      unlinkProvider,
      createLinkCode,
      previewTelegramLink,
      previewTelegramWidgetLink,
      previewGoogleCredentialLink,
      confirmPendingLink,
      dismissPendingLink,
      signOut,
      replaceCloudLibrary,
      updateCollections,
      updateFollows,
      updateAlerts,
      createTelegramInvoice,
      refreshSession,
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
  TelegramWidgetAuthData,
  LibraryMergeStrategy,
  ListenerAlert,
  MergePreviewParty,
  ProviderAvailability,
  ProviderKind,
  SessionProfile,
  SessionProviderInfo,
  SyncedTrackHistoryItem,
  UserCollection
} from '../domain/contracts';

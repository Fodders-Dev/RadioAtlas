import type { BillingProvider, PremiumStatus, SessionEntitlement, StoredAccount, SupporterTier, SyncedLibrary } from './types.js';
import { sanitizeLibrary } from './helpers.js';
import { applyEntitlementPreset, getAccountByIdSync, getDb, recordAuditEventSync, saveAccount } from './repository.js';

export const updateAccountLibrary = async (accountId: string, library: unknown) => {
  const db = await getDb();
  const current = getAccountByIdSync(db, accountId);
  if (!current) return null;
  const nextAccount: StoredAccount = {
    ...current,
    library: sanitizeLibrary(library),
    updatedAt: Date.now()
  };
  saveAccount(db, nextAccount);
  recordAuditEventSync(db, accountId, 'library_synced', {
    favorites: nextAccount.library.favorites.length,
    recent: nextAccount.library.recent.length,
    trackHistory: nextAccount.library.trackHistory.length,
    collections: nextAccount.library.collections.length,
    followedStations: nextAccount.library.followedStations.length,
    followedRegions: nextAccount.library.followedRegions.length,
    alerts: nextAccount.library.alerts.length
  });
  return getAccountByIdSync(db, accountId);
};

const patchAccountLibrary = async (
  accountId: string,
  patch: Partial<Pick<SyncedLibrary, 'collections' | 'followedStations' | 'followedRegions' | 'alerts'>>
) => {
  const db = await getDb();
  const current = getAccountByIdSync(db, accountId);
  if (!current) return null;
  const nextAccount: StoredAccount = {
    ...current,
    library: sanitizeLibrary({
      ...current.library,
      ...patch,
      updatedAt: Date.now()
    }),
    updatedAt: Date.now()
  };
  saveAccount(db, nextAccount);
  recordAuditEventSync(db, accountId, 'library_synced', {
    favorites: nextAccount.library.favorites.length,
    recent: nextAccount.library.recent.length,
    trackHistory: nextAccount.library.trackHistory.length,
    collections: nextAccount.library.collections.length,
    followedStations: nextAccount.library.followedStations.length,
    followedRegions: nextAccount.library.followedRegions.length,
    alerts: nextAccount.library.alerts.length
  });
  return getAccountByIdSync(db, accountId);
};

export const updateAccountCollections = async (accountId: string, collections: unknown) =>
  patchAccountLibrary(accountId, {
    collections: sanitizeLibrary({ collections }).collections
  });

export const updateAccountFollows = async (
  accountId: string,
  follows: { followedStations?: unknown; followedRegions?: unknown }
) =>
  patchAccountLibrary(accountId, {
    followedStations: sanitizeLibrary({ followedStations: follows.followedStations }).followedStations,
    followedRegions: sanitizeLibrary({ followedRegions: follows.followedRegions }).followedRegions
  });

export const updateAccountAlerts = async (accountId: string, alerts: unknown) =>
  patchAccountLibrary(accountId, {
    alerts: sanitizeLibrary({ alerts }).alerts
  });

export const updateAccountEntitlements = async (
  accountId: string,
  input: {
    premiumStatus: PremiumStatus;
    supporterTier: SupporterTier;
    entitlements: SessionEntitlement[];
    billingProvider: BillingProvider;
  }
) => {
  const db = await getDb();
  const current = getAccountByIdSync(db, accountId);
  if (!current) return null;
  const nextAccount = applyEntitlementPreset(
    current,
    input.premiumStatus,
    input.supporterTier,
    input.entitlements,
    input.billingProvider
  );
  saveAccount(db, nextAccount);
  recordAuditEventSync(db, accountId, 'entitlements_updated', {
    premiumStatus: nextAccount.premiumStatus,
    supporterTier: nextAccount.supporterTier,
    entitlements: nextAccount.entitlements
  });
  return getAccountByIdSync(db, accountId);
};

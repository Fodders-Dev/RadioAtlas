export type {
  AccountAuditEvent,
  AccountAuditEventType,
  AccountMergePreview,
  AccountProvider,
  BillingProduct,
  BillingProductId,
  BillingPurchase,
  BillingProvider,
  DatabaseLike,
  FollowedRegion,
  FollowedStation,
  LibraryCounts,
  LibraryMergeStrategy,
  ListenerAlert,
  MergePreviewParty,
  PremiumStatus,
  ProviderKind,
  SessionEntitlement,
  StationProfileRecord,
  StoredAccount,
  SupporterTier,
  SyncedLibrary,
  SyncedStation,
  SyncedTrackHistoryItem,
  UserCollection
} from './account/core/types.js';
export { recordAccountEvent, getAccountAuditTrail } from './account/core/auditService.js';
export {
  __forceSessionExpiryForTesting,
  __inspectSessionForTesting,
  consumeLinkRequest,
  createLinkRequest,
  createSessionForAccount,
  getAccountByToken,
  linkGoogleIdentity,
  linkTelegramIdentity,
  linkVkIdentity,
  peekLinkRequest,
  previewGoogleLink,
  previewTelegramLink,
  previewVkLink,
  revokeOtherSessions,
  revokeSession,
  unlinkProvider
} from './account/core/authService.js';
export {
  updateAccountAlerts,
  updateAccountCollections,
  updateAccountEntitlements,
  updateAccountFollows,
  updateAccountLibrary
} from './account/core/libraryService.js';
export {
  confirmBillingPurchase,
  createBillingPurchase,
  listBillingProducts
} from './account/core/billingService.js';
export {
  claimStationForAccount,
  getStationAnalytics,
  getStationProfile,
  listCatalogProfileOverrides,
  recordPromotionEvent,
  updateStationProfile
} from './account/core/stationProfileService.js';

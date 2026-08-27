export type {
  AccountAuditEvent,
  AccountAuditEventType,
  AccountMergePreview,
  AccountProvider,
  BillingProduct,
  BillingProductId,
  BillingPurchase,
  BillingProvider,
  BotSubscription,
  NudgeRecipient,
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
  getAccountByProvider,
  getAccountByToken,
  linkGoogleIdentity,
  linkTelegramIdentity,
  linkVkIdentity,
  peekLinkRequest,
  previewGoogleLink,
  previewTelegramLink,
  previewVkLink,
  revokeOtherSessions,
  deleteAccountCompletely,
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
  attributeReferral,
  getReferralCount,
  parseReferralParam,
  REFERRAL_REWARD_ENTITLEMENT,
  REFERRAL_REWARD_THRESHOLD
} from './account/core/referralService.js';
export {
  getBotOptInForAccount,
  listNudgeRecipients,
  NUDGE_COOLDOWN_MS,
  recordBotReachability,
  setBotOptIn,
  type BotOptInResult
} from './account/core/botSubscriptionService.js';
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

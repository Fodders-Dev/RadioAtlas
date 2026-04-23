import type { StationProfileRecord } from './types.js';
import { safeNumber, safeText } from './helpers.js';
import {
  getDb,
  getStationProfileSync,
  mapStationProfile,
  recordAuditEventSync,
  recordPromotionEventSync,
  upsertStationProfileSync
} from './repository.js';

export const claimStationForAccount = async (
  accountId: string,
  stationuuid: string,
  defaults: { displayName: string; websiteUrl?: string | null; description?: string | null; artworkUrl?: string | null }
) => {
  const db = await getDb();
  const current = getStationProfileSync(db, stationuuid);
  if (current?.ownerAccountId && current.ownerAccountId !== accountId) {
    throw new Error('station is already claimed');
  }
  const nextProfile: StationProfileRecord = {
    stationuuid,
    ownerAccountId: accountId,
    displayName: safeText(defaults.displayName, current?.displayName || 'Claimed station'),
    description: safeText(defaults.description) || current?.description || null,
    artworkUrl: safeText(defaults.artworkUrl) || current?.artworkUrl || null,
    websiteUrl: safeText(defaults.websiteUrl) || current?.websiteUrl || null,
    socialLinks: current?.socialLinks || [],
    scheduleNote: current?.scheduleNote || null,
    editorialPitch: current?.editorialPitch || null,
    isVerified: current?.isVerified || false,
    isPromoted: current?.isPromoted || false,
    promotedUntil: current?.promotedUntil || null,
    createdAt: current?.createdAt || Date.now(),
    updatedAt: Date.now()
  };
  upsertStationProfileSync(db, nextProfile);
  recordAuditEventSync(db, accountId, 'station_claimed', { stationuuid, displayName: nextProfile.displayName });
  return getStationProfileSync(db, stationuuid);
};

export const getStationProfile = async (stationuuid: string) => {
  const db = await getDb();
  return getStationProfileSync(db, stationuuid);
};

export const updateStationProfile = async (
  accountId: string,
  stationuuid: string,
  patch: Partial<Pick<StationProfileRecord, 'displayName' | 'description' | 'artworkUrl' | 'websiteUrl' | 'scheduleNote' | 'editorialPitch' | 'isPromoted' | 'promotedUntil'>> & {
    socialLinks?: Array<{ label: string; url: string }>;
  }
) => {
  const db = await getDb();
  const current = getStationProfileSync(db, stationuuid);
  if (!current || current.ownerAccountId !== accountId) {
    throw new Error('station profile is not owned by this account');
  }
  const nextProfile: StationProfileRecord = {
    ...current,
    displayName: safeText(patch.displayName) || current.displayName,
    description: safeText(patch.description) || current.description,
    artworkUrl: safeText(patch.artworkUrl) || current.artworkUrl,
    websiteUrl: safeText(patch.websiteUrl) || current.websiteUrl,
    scheduleNote: safeText(patch.scheduleNote) || current.scheduleNote,
    editorialPitch: safeText(patch.editorialPitch) || current.editorialPitch,
    socialLinks: Array.isArray(patch.socialLinks)
      ? patch.socialLinks
          .map((entry) => ({ label: safeText(entry.label), url: safeText(entry.url) }))
          .filter((entry) => entry.label && entry.url)
      : current.socialLinks,
    isPromoted: patch.isPromoted ?? current.isPromoted,
    promotedUntil: patch.promotedUntil ?? current.promotedUntil,
    updatedAt: Date.now()
  };
  upsertStationProfileSync(db, nextProfile);
  recordAuditEventSync(db, accountId, 'station_profile_updated', { stationuuid });
  return getStationProfileSync(db, stationuuid);
};

export const listCatalogProfileOverrides = async (): Promise<StationProfileRecord[]> => {
  const db = await getDb();
  return db.prepare('SELECT * FROM station_profiles').all().map(mapStationProfile);
};

export const recordPromotionEvent = async (
  stationuuid: string,
  eventType: 'impression' | 'click' | 'play-start' | 'favorite-after-click',
  sourceId?: string | null,
  accountId?: string | null
) => {
  const db = await getDb();
  recordPromotionEventSync(db, stationuuid, eventType, sourceId, accountId);
};

export const getStationAnalytics = async (accountId: string, stationuuid: string) => {
  const db = await getDb();
  const profile = getStationProfileSync(db, stationuuid);
  if (!profile || profile.ownerAccountId !== accountId) {
    throw new Error('station profile is not owned by this account');
  }
  const rows = db
    .prepare(`
      SELECT event_type, COUNT(*) as count
      FROM promotion_events
      WHERE stationuuid = ?
      GROUP BY event_type
    `)
    .all(stationuuid);
  const counts = rows.reduce<Record<string, number>>((acc, row) => {
    acc[safeText(row.event_type)] = safeNumber(row.count) ?? 0;
    return acc;
  }, {});
  return {
    stationuuid,
    impressions: counts.impression || 0,
    clicks: counts.click || 0,
    playStarts: counts['play-start'] || 0,
    favoriteAfterClick: counts['favorite-after-click'] || 0
  };
};

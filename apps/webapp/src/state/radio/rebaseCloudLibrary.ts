import type {
  CloudLibrary,
  FollowedRegion,
  FollowedStation,
  ListenerAlert,
  UserCollection
} from '../../domain/contracts';
import { mergeTasteProfiles, tasteProfilesMatch } from '../../lib/tasteProfile';
import type { StationLite } from '../../types';
import { MAX_RECENT } from './defaults';
import type { TrackHistoryItem } from './types';

export type LocalCloudLibrary = Omit<CloudLibrary, 'updatedAt'>;

const sameValue = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameValue(value, right[index]))
    );
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) => Object.prototype.hasOwnProperty.call(rightRecord, key) && sameValue(leftRecord[key], rightRecord[key])
    )
  );
};

const uniqueBy = <T,>(items: T[], keyOf: (item: T) => string) => {
  const result = new Map<string, T>();
  for (const item of items) {
    const key = keyOf(item);
    if (!result.has(key)) result.set(key, item);
  }
  return result;
};

/**
 * Rebase one device's edits since `base` over a newer server copy.
 * Deleting an item that existed in the base on either side wins over the
 * unchanged copy on the other side; independent additions are retained.
 */
const rebaseKeyed = <T,>(
  baseItems: T[],
  localItems: T[],
  remoteItems: T[],
  keyOf: (item: T) => string,
  mergeExisting: (base: T, local: T, remote: T) => T = (_base, local, remote) => ({
    ...remote,
    ...local
  })
): T[] => {
  const base = uniqueBy(baseItems, keyOf);
  const local = uniqueBy(localItems, keyOf);
  const remote = uniqueBy(remoteItems, keyOf);
  const merged = new Map<string, T>();

  for (const [key, item] of remote) {
    const baseItem = base.get(key);
    const localItem = local.get(key);
    if (baseItem) {
      // If either side removed a base entity, treat it as an intentional delete.
      if (!localItem) continue;
      merged.set(key, mergeExisting(baseItem, localItem, item));
      continue;
    }
    merged.set(key, localItem ? { ...item, ...localItem } : item);
  }

  for (const [key, item] of local) {
    if (!base.has(key) && !remote.has(key)) merged.set(key, item);
  }

  const baseOrder = Array.from(base.keys());
  const localOrder = Array.from(local.keys());
  const localOrderChanged = !sameValue(localOrder, baseOrder);
  const preferredOrder = localOrderChanged
    ? [...localOrder, ...Array.from(remote.keys()).filter((key) => !local.has(key))]
    : [...Array.from(remote.keys()), ...localOrder.filter((key) => !remote.has(key))];

  return preferredOrder.flatMap((key) => {
    const item = merged.get(key);
    return item === undefined ? [] : [item];
  });
};

const mergeFieldsChangedLocally = <T extends object>(base: T, local: T, remote: T): T => {
  const result = { ...remote } as Record<string, unknown>;
  const baseRecord = base as Record<string, unknown>;
  const localRecord = local as Record<string, unknown>;
  for (const key of Object.keys(localRecord)) {
    if (!sameValue(baseRecord[key], localRecord[key])) result[key] = localRecord[key];
  }
  return result as T;
};

const stationKey = (station: StationLite) => station.stationuuid;
const trackKey = (item: TrackHistoryItem) => `${item.stationId}\u0000${item.track.toLowerCase()}`;
const collectionKey = (item: UserCollection) => item.id;
const followedStationKey = (item: FollowedStation) => item.stationId;
const followedRegionKey = (item: FollowedRegion) => item.id;
const alertKey = (item: ListenerAlert) => item.id;

const rebaseCollectionStations = (base: string[], local: string[], remote: string[]) => {
  const baseKeys = new Set(base);
  const localKeys = new Set(local);
  const remoteKeys = new Set(remote);
  const retained = new Set<string>();

  for (const id of remote) {
    if (!baseKeys.has(id) || localKeys.has(id)) retained.add(id);
  }
  for (const id of local) {
    if (!baseKeys.has(id) || remoteKeys.has(id)) retained.add(id);
  }

  const localOrderChanged = !sameValue(local, base);
  const preferred = localOrderChanged
    ? [...local, ...remote.filter((id) => !localKeys.has(id))]
    : [...remote, ...local.filter((id) => !remoteKeys.has(id))];
  return preferred.filter((id, index) => retained.has(id) && preferred.indexOf(id) === index);
};

const mergeCollection = (base: UserCollection, local: UserCollection, remote: UserCollection): UserCollection => ({
  ...remote,
  name: local.name !== base.name ? local.name : remote.name,
  description: local.description !== base.description ? local.description : remote.description,
  isPublic: local.isPublic !== base.isPublic ? local.isPublic : remote.isPublic,
  pinned: local.pinned !== base.pinned ? local.pinned : remote.pinned,
  stationIds: rebaseCollectionStations(base.stationIds, local.stationIds, remote.stationIds),
  updatedAt: Math.max(base.updatedAt, local.updatedAt, remote.updatedAt)
});

const localTasteChanged = (base: CloudLibrary, local: LocalCloudLibrary) =>
  !tasteProfilesMatch(base.tasteProfile, local.tasteProfile);

const rebaseTaste = (base: CloudLibrary, local: LocalCloudLibrary, remote: CloudLibrary) => {
  if (!localTasteChanged(base, local)) return remote.tasteProfile ?? null;
  if (tasteProfilesMatch(base.tasteProfile, remote.tasteProfile) || tasteProfilesMatch(local.tasteProfile, remote.tasteProfile)) return local.tasteProfile;
  const previous = mergeTasteProfiles(base.tasteProfile);
  const changed = mergeTasteProfiles(local.tasteProfile);
  const current = mergeTasteProfiles(remote.tasteProfile);
  const merged = mergeTasteProfiles(current, changed);
  // Both devices carry the base scores. Add only the local delta, otherwise
  // every acknowledged save doubles the same listening history again.
  for (const key of ['stationScores', 'tagScores', 'countryScores', 'languageScores', 'modeScores'] as const) {
    const scores: Record<string, number> = {};
    const previousScores: Partial<Record<string, number>> = previous[key];
    const changedScores: Partial<Record<string, number>> = changed[key];
    const currentScores: Partial<Record<string, number>> = current[key];
    for (const label of new Set([...Object.keys(previousScores), ...Object.keys(changedScores), ...Object.keys(currentScores)])) {
      scores[label] = Number(((currentScores[label] || 0) + (changedScores[label] || 0) - (previousScores[label] || 0)).toFixed(4));
    }
    merged[key] = scores;
  }
  return mergeTasteProfiles(merged);
};

/**
 * Apply local edits relative to the last known cloud snapshot over the current
 * remote snapshot. The returned value is suitable for a full-library PUT.
 */
export const rebaseCloudLibrary = (
  base: CloudLibrary,
  local: LocalCloudLibrary,
  remote: CloudLibrary
): LocalCloudLibrary => {
  const collections = rebaseKeyed(
    base.collections,
    local.collections,
    remote.collections,
    collectionKey,
    mergeCollection
  );
  const tasteProfile = rebaseTaste(base, local, remote);

  return {
    favorites: rebaseKeyed(base.favorites, local.favorites, remote.favorites, stationKey, mergeFieldsChangedLocally),
    recent: rebaseKeyed(base.recent, local.recent, remote.recent, stationKey, mergeFieldsChangedLocally).slice(0, MAX_RECENT),
    trackHistory: rebaseKeyed(base.trackHistory, local.trackHistory, remote.trackHistory, trackKey, mergeFieldsChangedLocally),
    collections,
    followedStations: rebaseKeyed(
      base.followedStations,
      local.followedStations,
      remote.followedStations,
      followedStationKey,
      mergeFieldsChangedLocally
    ),
    followedRegions: rebaseKeyed(
      base.followedRegions,
      local.followedRegions,
      remote.followedRegions,
      followedRegionKey,
      mergeFieldsChangedLocally
    ),
    alerts: rebaseKeyed(base.alerts, local.alerts, remote.alerts, alertKey, mergeFieldsChangedLocally),
    tasteProfile
  };
};

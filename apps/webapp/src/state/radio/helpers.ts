import type {
  CloudLibrary,
  FollowedRegion,
  FollowedStation,
  ListenerAlert,
  UserCollection
} from '../../domain/contracts';
import { toLite } from '../../lib/stationUtils';
import { tasteProfilesMatch } from '../../lib/tasteProfile';
import type { Station, StationLite } from '../../types';
import { MAX_QUEUE_ITEMS } from './defaults';
import type { QueueSnapshot, TrackHistoryItem } from './types';

export const mergeUniqueStations = (...groups: Array<Array<StationLite | null | undefined>>) => {
  const merged: StationLite[] = [];
  const seen = new Set<string>();

  groups.forEach((group) => {
    group.forEach((station) => {
      if (!station?.stationuuid || seen.has(station.stationuuid)) return;
      const normalized = toLite(station);
      seen.add(normalized.stationuuid);
      merged.push(normalized);
    });
  });

  return merged;
};

export const normalizeStations = (stations: Array<Station | StationLite>) =>
  mergeUniqueStations(stations.map((station) => toLite(station))).slice(0, MAX_QUEUE_ITEMS);

export const mergeTrackHistory = (...groups: TrackHistoryItem[][]) => {
  const seen = new Set<string>();
  return groups
    .flat()
    .sort((left, right) => right.timestamp - left.timestamp)
    .filter((item) => {
      const key = `${item.stationId}:${item.track.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  // ⚠ No `.slice()` here on purpose. This is the merge that runs when somebody
  // signs in on a second device, and it used to cut the union to 200: 150 finds
  // on a phone plus 150 on a tablet became 200, and a hundred saved finds went
  // without a word. Sorting is newest-first, so the OLDEST were the ones lost.
};

// The most recent recorded track for a station (newest-first history → first
// match). Powers the player faces' dimmed "last heard" line when the live
// now-playing metadata is silent. Entries are already trust-filtered at write
// time, so a returned track is safe to show (but NOT live — see the faces).
export const latestTrackForStation = (
  history: TrackHistoryItem[],
  stationId?: string | null
): TrackHistoryItem | null => {
  if (!stationId) return null;
  for (const item of history) {
    if (item.stationId === stationId && item.track.trim()) return item;
  }
  return null;
};

export const stationsMatch = (left: StationLite[], right: StationLite[]) =>
  left.length === right.length &&
  left.every((station, index) => station.stationuuid === right[index]?.stationuuid);

export const trackHistoryMatch = (left: TrackHistoryItem[], right: TrackHistoryItem[]) =>
  left.length === right.length &&
  left.every(
    (item, index) =>
      item.stationId === right[index]?.stationId &&
      item.track === right[index]?.track &&
      item.timestamp === right[index]?.timestamp
  );

export const collectionsMatch = (left: UserCollection[], right: UserCollection[]) =>
  left.length === right.length &&
  left.every((item, index) => {
    const candidate = right[index];
    return (
      item.id === candidate?.id &&
      item.name === candidate?.name &&
      item.description === candidate?.description &&
      item.isPublic === candidate?.isPublic &&
      item.pinned === candidate?.pinned &&
      item.updatedAt === candidate?.updatedAt &&
      item.stationIds.length === candidate?.stationIds.length &&
      item.stationIds.every((stationId, stationIndex) => stationId === candidate?.stationIds[stationIndex])
    );
  });

export const followedStationsMatch = (left: FollowedStation[], right: FollowedStation[]) =>
  left.length === right.length &&
  left.every((item, index) => {
    const candidate = right[index];
    return (
      item.stationId === candidate?.stationId &&
      item.stationName === candidate?.stationName &&
      item.country === candidate?.country &&
      item.createdAt === candidate?.createdAt &&
      item.pinned === candidate?.pinned &&
      item.alerts.length === candidate?.alerts.length &&
      item.alerts.every((alert, alertIndex) => alert === candidate?.alerts[alertIndex])
    );
  });

export const followedRegionsMatch = (left: FollowedRegion[], right: FollowedRegion[]) =>
  left.length === right.length &&
  left.every((item, index) => {
    const candidate = right[index];
    return (
      item.id === candidate?.id &&
      item.label === candidate?.label &&
      item.scope === candidate?.scope &&
      item.createdAt === candidate?.createdAt &&
      item.pinned === candidate?.pinned
    );
  });

export const alertsMatch = (left: ListenerAlert[], right: ListenerAlert[]) =>
  left.length === right.length &&
  left.every((item, index) => {
    const candidate = right[index];
    return (
      item.id === candidate?.id &&
      item.kind === candidate?.kind &&
      item.stationId === candidate?.stationId &&
      item.regionId === candidate?.regionId &&
      item.title === candidate?.title &&
      item.body === candidate?.body &&
      item.createdAt === candidate?.createdAt &&
      item.readAt === candidate?.readAt
    );
  });

type ComparableCloudLibrary = Pick<
  CloudLibrary,
  | 'favorites'
  | 'recent'
  | 'trackHistory'
  | 'collections'
  | 'followedStations'
  | 'followedRegions'
  | 'alerts'
  | 'tasteProfile'
>;

const EMPTY_CLOUD_LIBRARY: ComparableCloudLibrary = {
  favorites: [],
  recent: [],
  trackHistory: [],
  collections: [],
  followedStations: [],
  followedRegions: [],
  alerts: [],
  tasteProfile: null
};

export const cloudLibraryMatches = (
  left: ComparableCloudLibrary | null | undefined,
  right: ComparableCloudLibrary | null | undefined
) => {
  const leftValue = left || EMPTY_CLOUD_LIBRARY;
  const rightValue = right || EMPTY_CLOUD_LIBRARY;
  return (
    stationsMatch(leftValue.favorites, rightValue.favorites) &&
    stationsMatch(leftValue.recent, rightValue.recent) &&
    trackHistoryMatch(leftValue.trackHistory, rightValue.trackHistory) &&
    collectionsMatch(leftValue.collections, rightValue.collections) &&
    followedStationsMatch(leftValue.followedStations, rightValue.followedStations) &&
    followedRegionsMatch(leftValue.followedRegions, rightValue.followedRegions) &&
    alertsMatch(leftValue.alerts, rightValue.alerts) &&
    tasteProfilesMatch(leftValue.tasteProfile, rightValue.tasteProfile)
  );
};

export const getQueueSourceLabel = (
  sourceId: string | null | undefined,
  sourceLabel: string | null | undefined,
  items: StationLite[],
  t: (key: string, vars?: Record<string, string | number>) => string
) => {
  if (sourceLabel?.trim()) return sourceLabel.trim();
  if (!sourceId) {
    return items.length === 1 ? items[0]?.name || t('radio.queueDefault') : t('radio.queueDefault');
  }
  if (sourceId === 'favorites') return t('radio.favorites');
  if (sourceId === 'recent') return t('radio.recent');
  if (sourceId === 'library-search') return t('library.searchResults');
  if (sourceId === 'search-stations' || sourceId === 'discover-stations') return t('radio.searchResults');
  if (sourceId === 'search-links' || sourceId === 'discover-links') return t('radio.savedLinks');
  if (sourceId === 'search-links-recent' || sourceId === 'discover-links-recent') return t('radio.recentLinks');
  if (sourceId === 'explore-trending') return t('radio.trending');
  if (sourceId === 'explore-search') return t('radio.exploreSearch');
  if (sourceId === 'explore-pick') return t('radio.nearby');
  if (sourceId.startsWith('browse-')) return t('radio.discoverResults');
  if (sourceId.startsWith('station-')) return items[0]?.name || 'Single station';
  return sourceId
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

export const snapshotsEqual = (left: QueueSnapshot, right: QueueSnapshot) =>
  left.currentIndex === right.currentIndex &&
  left.sourceId === right.sourceId &&
  left.sourceLabel === right.sourceLabel &&
  left.items.length === right.items.length &&
  left.items.every((station, index) => station.stationuuid === right.items[index]?.stationuuid);

export const clampQueueIndex = (items: StationLite[], index: number) => {
  if (!items.length) return -1;
  return Math.min(Math.max(index, 0), items.length - 1);
};

// Drag-reorder a queue: move `from` → `to`, keeping the currently-playing station
// pinned (its numeric index is recomputed to follow the reordered array, so what's
// playing NEVER changes — PR #86). The playing item itself can't be moved. Returns
// null on a no-op / invalid move so the caller can skip the state update.
export const reorderQueueItems = (
  items: StationLite[],
  currentIndex: number,
  from: number,
  to: number
): { items: StationLite[]; currentIndex: number } | null => {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return null;
  if (from === currentIndex) return null;
  const playing = currentIndex >= 0 && currentIndex < items.length ? items[currentIndex] : null;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (!moved) return null;
  next.splice(Math.min(Math.max(to, 0), next.length), 0, moved);
  const nextCurrentIndex = playing
    ? next.findIndex((station) => station.stationuuid === playing.stationuuid)
    : currentIndex;
  return { items: next, currentIndex: nextCurrentIndex };
};

export const resolveUpdater = <T,>(current: T, next: T | ((prev: T) => T)) =>
  typeof next === 'function' ? (next as (prev: T) => T)(current) : next;

export const mergeStationCache = (
  cache: Record<string, StationLite>,
  stations: Array<Station | StationLite | null | undefined>
) => {
  let changed = false;
  const nextCache = { ...cache };
  stations.forEach((station) => {
    if (!station?.stationuuid) return;
    const normalized = toLite(station);
    const previous = nextCache[normalized.stationuuid];
    if (
      previous &&
      previous.name === normalized.name &&
      previous.url_resolved === normalized.url_resolved &&
      previous.country === normalized.country &&
      previous.state === normalized.state &&
      previous.tags === normalized.tags &&
      previous.stationArtwork === normalized.stationArtwork &&
      previous.websiteUrl === normalized.websiteUrl
    ) {
      return;
    }
    nextCache[normalized.stationuuid] = normalized;
    changed = true;
  });
  return changed ? nextCache : cache;
};

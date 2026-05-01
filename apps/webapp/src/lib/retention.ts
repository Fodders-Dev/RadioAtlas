import type {
  FollowedRegion,
  FollowedStation,
  ListenerAlert,
  NotificationPreference,
  RadioDigest,
  RadioDigestKind
} from '../domain/contracts';
import type { StationHealthProfile } from './stationHealth';
import type { StationLite } from '../types';
import { stationsForRegions } from './regionRecommendations';

export const DEFAULT_NOTIFICATION_PREFERENCE: NotificationPreference = {
  version: 1,
  inAppAlerts: true,
  telegramBotOptIn: false,
  stationBackOnline: true,
  trackAlerts: true,
  regionActivity: true,
  morningMix: true,
  eveningMix: true,
  updatedAt: null
};

type RetentionCopy = {
  trackAvailable: (stationName: string, track: string) => { title: string; body: string };
  stationBackOnline: (stationName: string) => { title: string; body: string };
  regionActivity: (regionName: string, stationName: string) => { title: string; body: string };
  digest: (kind: RadioDigestKind, stationNames: string[]) => { title: string; body: string };
};

const MAX_ALERTS = 80;
const MAX_DIGESTS = 24;

const dayKey = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);

const hashValue = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
};

const uniqueStations = (...groups: StationLite[][]) => {
  const seen = new Set<string>();
  return groups.flat().filter((station) => {
    if (!station || seen.has(station.stationuuid)) return false;
    seen.add(station.stationuuid);
    return true;
  });
};

const preferences = (value: NotificationPreference | null | undefined): NotificationPreference =>
  value?.version === 1 ? value : DEFAULT_NOTIFICATION_PREFERENCE;

const followedStationFor = (station: StationLite, followedStations: FollowedStation[]) =>
  followedStations.find((follow) => follow.stationId === station.stationuuid) || null;

export const upsertListenerAlerts = (
  existing: ListenerAlert[],
  incoming: ListenerAlert[]
): ListenerAlert[] => {
  const byId = new Map<string, ListenerAlert>();
  [...incoming, ...existing].forEach((alert) => {
    if (!byId.has(alert.id)) {
      byId.set(alert.id, alert);
    }
  });
  return Array.from(byId.values())
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, MAX_ALERTS);
};

export const upsertRadioDigests = (
  existing: RadioDigest[],
  incoming: RadioDigest[]
): RadioDigest[] => {
  const byId = new Map<string, RadioDigest>();
  [...incoming, ...existing].forEach((digest) => {
    if (!byId.has(digest.id)) {
      byId.set(digest.id, digest);
    }
  });
  return Array.from(byId.values())
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, MAX_DIGESTS);
};

export const buildListenerAlerts = ({
  currentStation,
  trustedTrack,
  followedStations,
  followedRegions,
  knownStations,
  stationHealthProfile,
  existingAlerts,
  notificationPreference,
  copy,
  now = Date.now()
}: {
  currentStation: StationLite | null;
  trustedTrack: string | null;
  followedStations: FollowedStation[];
  followedRegions: FollowedRegion[];
  knownStations: StationLite[];
  stationHealthProfile: StationHealthProfile | null | undefined;
  existingAlerts: ListenerAlert[];
  notificationPreference: NotificationPreference | null | undefined;
  copy: RetentionCopy;
  now?: number;
}): ListenerAlert[] => {
  const pref = preferences(notificationPreference);
  if (!pref.inAppAlerts) return [];

  const existingIds = new Set(existingAlerts.map((alert) => alert.id));
  const next: ListenerAlert[] = [];
  const today = dayKey(now);

  if (currentStation) {
    const follow = followedStationFor(currentStation, followedStations);
    const followsTrack = follow?.alerts.includes('track');
    if (pref.trackAlerts && followsTrack && trustedTrack) {
      const trackId = `alert:track:${currentStation.stationuuid}:${hashValue(trustedTrack)}:${today}`;
      if (!existingIds.has(trackId)) {
        const text = copy.trackAvailable(currentStation.name, trustedTrack);
        next.push({
          id: trackId,
          kind: 'track-available',
          stationId: currentStation.stationuuid,
          regionId: null,
          title: text.title,
          body: text.body,
          createdAt: now,
          readAt: null
        });
      }
    }

    const followsBackOnline = follow?.alerts.includes('back-online');
    const healthSignal = stationHealthProfile?.signals?.[currentStation.stationuuid];
    if (
      pref.stationBackOnline &&
      followsBackOnline &&
      healthSignal?.lastFailureAt &&
      healthSignal.lastSuccessAt &&
      healthSignal.lastSuccessAt > healthSignal.lastFailureAt &&
      now - healthSignal.lastSuccessAt < 5 * 60 * 1000
    ) {
      const onlineId = `alert:online:${currentStation.stationuuid}:${today}`;
      if (!existingIds.has(onlineId)) {
        const text = copy.stationBackOnline(currentStation.name);
        next.push({
          id: onlineId,
          kind: 'station-back-online',
          stationId: currentStation.stationuuid,
          regionId: null,
          title: text.title,
          body: text.body,
          createdAt: now,
          readAt: null
        });
      }
    }
  }

  if (pref.regionActivity) {
    followedRegions.slice(0, 6).forEach((region) => {
      const station = stationsForRegions(knownStations, [region], 1)[0];
      if (!station) return;
      const regionId = `alert:region:${region.id}:${today}`;
      if (existingIds.has(regionId)) return;
      const text = copy.regionActivity(region.label, station.name);
      next.push({
        id: regionId,
        kind: 'region-activity',
        stationId: station.stationuuid,
        regionId: region.id,
        title: text.title,
        body: text.body,
        createdAt: now,
        readAt: null
      });
    });
  }

  return next;
};

export const buildRadioDigests = ({
  recent,
  playbackHistory,
  favorites,
  followedRegions,
  existingDigests,
  notificationPreference,
  copy,
  now = Date.now()
}: {
  recent: StationLite[];
  playbackHistory: StationLite[];
  favorites: StationLite[];
  followedRegions: FollowedRegion[];
  existingDigests: RadioDigest[];
  notificationPreference: NotificationPreference | null | undefined;
  copy: RetentionCopy;
  now?: number;
}): RadioDigest[] => {
  const pref = preferences(notificationPreference);
  if (!pref.inAppAlerts) return [];

  const existingIds = new Set(existingDigests.map((digest) => digest.id));
  const today = dayKey(now);
  const hour = new Date(now).getHours();
  const pool = uniqueStations(recent, playbackHistory.slice().reverse(), favorites);
  const next: RadioDigest[] = [];

  const pushDigest = (kind: RadioDigestKind, stations: StationLite[]) => {
    const stationIds = stations.map((station) => station.stationuuid).slice(0, 12);
    if (!stationIds.length) return;
    const id = `digest:${kind}:${today}`;
    if (existingIds.has(id)) return;
    const names = stations.map((station) => station.name).slice(0, 3);
    const text = copy.digest(kind, names);
    next.push({
      id,
      kind,
      title: text.title,
      body: text.body,
      stationIds,
      createdAt: now,
      readAt: null
    });
  };

  pushDigest('continue-yesterday', pool.slice(0, 10));

  if (pref.morningMix && hour >= 5 && hour < 12) {
    pushDigest('morning-mix', uniqueStations(favorites, recent, playbackHistory.slice().reverse()).slice(0, 12));
  }

  if (pref.eveningMix && hour >= 17 && hour < 24) {
    const regionStations = stationsForRegions(pool, followedRegions, 8);
    pushDigest('evening-mix', uniqueStations(regionStations, recent, favorites).slice(0, 12));
  }

  return next;
};

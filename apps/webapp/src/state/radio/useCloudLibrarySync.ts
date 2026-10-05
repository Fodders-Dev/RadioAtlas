import { useEffect, useRef } from 'react';
import type {
  CloudLibrary,
  FollowedRegion,
  FollowedStation,
  ListenerAlert,
  UserCollection
} from '../../domain/contracts';
import { MAX_RECENT } from './defaults';
import { rebaseCloudLibrary } from './rebaseCloudLibrary';
import {
  alertsMatch,
  cloudLibraryMatches,
  collectionsMatch,
  followedRegionsMatch,
  followedStationsMatch,
  mergeTrackHistory,
  mergeUniqueStations,
  stationsMatch,
  trackHistoryMatch
} from './helpers';
import type { StationLite } from '../../types';
import type { TrackHistoryItem } from './types';
import {
  mergeTasteProfiles,
  tasteProfilesMatch,
  type TasteProfileV2
} from '../../lib/tasteProfile';

type CloudSetter<T> = (next: T) => void;

type UseCloudLibrarySyncArgs = {
  sessionStatus: string;
  sessionProfileId: string | null | undefined;
  cloudLibrary: CloudLibrary | null | undefined;
  replaceCloudLibrary: (nextLibrary: Omit<CloudLibrary, 'updatedAt'>, options?: { defer?: boolean }) => Promise<unknown> | void;
  favorites: StationLite[];
  recent: StationLite[];
  trackHistory: TrackHistoryItem[];
  collections: UserCollection[];
  followedStations: FollowedStation[];
  followedRegions: FollowedRegion[];
  alerts: ListenerAlert[];
  tasteProfile: TasteProfileV2;
  setFavorites: CloudSetter<StationLite[]>;
  setRecent: CloudSetter<StationLite[]>;
  setTrackHistory: CloudSetter<TrackHistoryItem[]>;
  setCollections: CloudSetter<UserCollection[]>;
  setFollowedStations: CloudSetter<FollowedStation[]>;
  setFollowedRegions: CloudSetter<FollowedRegion[]>;
  setAlerts: CloudSetter<ListenerAlert[]>;
  setTasteProfile: CloudSetter<TasteProfileV2>;
};

export const useCloudLibrarySync = ({
  alerts,
  cloudLibrary,
  collections,
  favorites,
  followedRegions,
  followedStations,
  recent,
  replaceCloudLibrary,
  sessionProfileId,
  sessionStatus,
  setAlerts,
  setCollections,
  setFavorites,
  setFollowedRegions,
  setFollowedStations,
  setRecent,
  setTrackHistory,
  setTasteProfile,
  tasteProfile,
  trackHistory
}: UseCloudLibrarySyncArgs) => {
  const hydratedCloudProfileRef = useRef<string | null>(null);
  const acceptedCloudRef = useRef<CloudLibrary | null>(null);
  const awaitingLocalRef = useRef<Omit<CloudLibrary, 'updatedAt'> | null>(null);
  const submittedLocalRef = useRef<Omit<CloudLibrary, 'updatedAt'> | null>(null);

  useEffect(() => {
    if (sessionStatus !== 'authenticated') {
      hydratedCloudProfileRef.current = null;
      acceptedCloudRef.current = null;
      awaitingLocalRef.current = null;
      submittedLocalRef.current = null;
    }
  }, [sessionStatus]);

  useEffect(() => {
    if (
      sessionStatus !== 'authenticated' ||
      !sessionProfileId ||
      !cloudLibrary ||
      (hydratedCloudProfileRef.current === sessionProfileId && acceptedCloudRef.current === cloudLibrary)
    ) {
      return;
    }

    const alreadyHydrated = hydratedCloudProfileRef.current === sessionProfileId;
    const previousCloud = acceptedCloudRef.current;
    hydratedCloudProfileRef.current = sessionProfileId;
    acceptedCloudRef.current = cloudLibrary;

    if (alreadyHydrated && previousCloud) {
      const local = { favorites, recent, trackHistory, collections, followedStations, followedRegions, alerts, tasteProfile };
      const rebased = rebaseCloudLibrary(previousCloud, local, cloudLibrary);
      awaitingLocalRef.current = cloudLibraryMatches(rebased, local) ? null : rebased;
      if (!stationsMatch(rebased.favorites, favorites)) setFavorites(rebased.favorites);
      if (!stationsMatch(rebased.recent, recent)) setRecent(rebased.recent);
      if (!trackHistoryMatch(rebased.trackHistory, trackHistory)) setTrackHistory(rebased.trackHistory as TrackHistoryItem[]);
      if (!collectionsMatch(rebased.collections, collections)) setCollections(rebased.collections);
      if (!followedStationsMatch(rebased.followedStations, followedStations)) setFollowedStations(rebased.followedStations);
      if (!followedRegionsMatch(rebased.followedRegions, followedRegions)) setFollowedRegions(rebased.followedRegions);
      if (!alertsMatch(rebased.alerts, alerts)) setAlerts(rebased.alerts);
      if (rebased.tasteProfile && !tasteProfilesMatch(rebased.tasteProfile, tasteProfile)) setTasteProfile(rebased.tasteProfile);
      return;
    }

    const mergedFavorites = mergeUniqueStations(cloudLibrary.favorites, favorites);
    const mergedRecent = mergeUniqueStations(cloudLibrary.recent, recent).slice(0, MAX_RECENT);
    const mergedTrackHistory = mergeTrackHistory(cloudLibrary.trackHistory as TrackHistoryItem[], trackHistory);
    const mergedCollections = [...cloudLibrary.collections, ...collections]
      .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt - left.updatedAt)
      .filter((item, index, source) => source.findIndex((candidate) => candidate.id === item.id) === index)
      .slice(0, 24);
    const mergedFollowedStations = [...cloudLibrary.followedStations, ...followedStations]
      .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.createdAt - left.createdAt)
      .filter(
        (item, index, source) => source.findIndex((candidate) => candidate.stationId === item.stationId) === index
      )
      .slice(0, 80);
    const mergedFollowedRegions = [...cloudLibrary.followedRegions, ...followedRegions]
      .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.createdAt - left.createdAt)
      .filter((item, index, source) => source.findIndex((candidate) => candidate.id === item.id) === index)
      .slice(0, 40);
    const mergedAlerts = [...cloudLibrary.alerts, ...alerts]
      .sort((left, right) => right.createdAt - left.createdAt)
      .filter((item, index, source) => source.findIndex((candidate) => candidate.id === item.id) === index)
      .slice(0, 160);
    const mergedTasteProfile = tasteProfilesMatch(cloudLibrary.tasteProfile, tasteProfile)
      ? tasteProfile : mergeTasteProfiles(cloudLibrary.tasteProfile, tasteProfile);

    if (!stationsMatch(mergedFavorites, favorites)) {
      setFavorites(mergedFavorites);
    }
    if (!stationsMatch(mergedRecent, recent)) {
      setRecent(mergedRecent);
    }
    if (!trackHistoryMatch(mergedTrackHistory, trackHistory)) {
      setTrackHistory(mergedTrackHistory);
    }
    if (!collectionsMatch(mergedCollections, collections)) {
      setCollections(mergedCollections);
    }
    if (!followedStationsMatch(mergedFollowedStations, followedStations)) {
      setFollowedStations(mergedFollowedStations);
    }
    if (!followedRegionsMatch(mergedFollowedRegions, followedRegions)) {
      setFollowedRegions(mergedFollowedRegions);
    }
    if (!alertsMatch(mergedAlerts, alerts)) {
      setAlerts(mergedAlerts);
    }
    if (!tasteProfilesMatch(mergedTasteProfile, tasteProfile)) {
      setTasteProfile(mergedTasteProfile);
    }

    const remoteNeedsUpdate =
      !stationsMatch(mergedFavorites, cloudLibrary.favorites) ||
      !stationsMatch(mergedRecent, cloudLibrary.recent) ||
      !trackHistoryMatch(mergedTrackHistory, cloudLibrary.trackHistory as TrackHistoryItem[]) ||
      !collectionsMatch(mergedCollections, cloudLibrary.collections) ||
      !followedStationsMatch(mergedFollowedStations, cloudLibrary.followedStations) ||
      !followedRegionsMatch(mergedFollowedRegions, cloudLibrary.followedRegions) ||
      !alertsMatch(mergedAlerts, cloudLibrary.alerts) ||
      !tasteProfilesMatch(mergedTasteProfile, cloudLibrary.tasteProfile);

    awaitingLocalRef.current = { favorites: mergedFavorites, recent: mergedRecent, trackHistory: mergedTrackHistory, collections: mergedCollections, followedStations: mergedFollowedStations, followedRegions: mergedFollowedRegions, alerts: mergedAlerts, tasteProfile: mergedTasteProfile };

    if (remoteNeedsUpdate) {
      const mergedLibrary = {
        favorites: mergedFavorites,
        recent: mergedRecent,
        trackHistory: mergedTrackHistory,
        collections: mergedCollections,
        followedStations: mergedFollowedStations,
        followedRegions: mergedFollowedRegions,
        alerts: mergedAlerts,
        tasteProfile: mergedTasteProfile
      };
      submittedLocalRef.current = mergedLibrary;
      void replaceCloudLibrary(mergedLibrary);
    }
  }, [
    alerts,
    cloudLibrary,
    collections,
    favorites,
    followedRegions,
    followedStations,
    recent,
    replaceCloudLibrary,
    sessionProfileId,
    sessionStatus,
    setAlerts,
    setCollections,
    setFavorites,
    setFollowedRegions,
    setFollowedStations,
    setRecent,
    setTasteProfile,
    setTrackHistory,
    tasteProfile,
    trackHistory
  ]);

  useEffect(() => {
    if (
      sessionStatus !== 'authenticated' ||
      !sessionProfileId ||
      hydratedCloudProfileRef.current !== sessionProfileId
    ) {
      return;
    }

    const nextRecent = recent.slice(0, MAX_RECENT);
    // Finds go up whole. The cap that used to live here is gone: it silently
    // decided which of somebody's saved finds the server was allowed to know
    // about, and the server then merged against that truncated view.
    const nextTrackHistory = trackHistory;
    const nextLibrary = {
      favorites,
      recent: nextRecent,
      trackHistory: nextTrackHistory,
      collections,
      followedStations,
      followedRegions,
      alerts,
      tasteProfile
    };
    const sameAsCloud = cloudLibraryMatches(nextLibrary, cloudLibrary);

    // A cloud pull scheduled local setters in the preceding effect. Do not PUT
    // the old render back over that pull before those setters have committed.
    if (awaitingLocalRef.current) {
      if (!cloudLibraryMatches(nextLibrary, awaitingLocalRef.current)) return;
      awaitingLocalRef.current = null;
    }

    const previousSubmission = submittedLocalRef.current;
    if (previousSubmission && cloudLibraryMatches(previousSubmission, nextLibrary)) return;
    if (sameAsCloud && !previousSubmission) return;

    // Capture intent now, including an undo equal to the old cloud copy.
    // Delaying capture by 1.4s let an older ACK resurrect the removed station.
    // Session delays only network transmission and coalesces playback bursts;
    // edits made during a PUT remain one subsequent write.
    submittedLocalRef.current = nextLibrary;
    void replaceCloudLibrary(nextLibrary, { defer: true });
  }, [
    alerts,
    cloudLibrary?.alerts,
    cloudLibrary?.collections,
    cloudLibrary?.favorites,
    cloudLibrary?.followedRegions,
    cloudLibrary?.followedStations,
    cloudLibrary?.recent,
    cloudLibrary?.tasteProfile,
    cloudLibrary?.trackHistory,
    collections,
    favorites,
    followedRegions,
    followedStations,
    recent,
    replaceCloudLibrary,
    sessionProfileId,
    sessionStatus,
    tasteProfile,
    trackHistory
  ]);

  return {
    syncCloudLibraryImmediately: (nextLibrary: Omit<CloudLibrary, 'updatedAt'>) => {
      if (sessionStatus !== 'authenticated' || !sessionProfileId) return;
      void replaceCloudLibrary(nextLibrary);
    }
  };
};

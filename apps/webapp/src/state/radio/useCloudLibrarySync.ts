import { useEffect, useRef } from 'react';
import type {
  CloudLibrary,
  FollowedRegion,
  FollowedStation,
  ListenerAlert,
  UserCollection
} from '../../domain/contracts';
import { MAX_RECENT, MAX_TRACK_HISTORY } from './defaults';
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

type CloudSetter<T> = (next: T) => void;

const CLOUD_LIBRARY_SYNC_DELAY_MS = 1_400;

type UseCloudLibrarySyncArgs = {
  sessionStatus: string;
  sessionProfileId: string | null | undefined;
  cloudLibrary: CloudLibrary | null | undefined;
  replaceCloudLibrary: (nextLibrary: Omit<CloudLibrary, 'updatedAt'>) => Promise<unknown> | void;
  favorites: StationLite[];
  recent: StationLite[];
  trackHistory: TrackHistoryItem[];
  collections: UserCollection[];
  followedStations: FollowedStation[];
  followedRegions: FollowedRegion[];
  alerts: ListenerAlert[];
  setFavorites: CloudSetter<StationLite[]>;
  setRecent: CloudSetter<StationLite[]>;
  setTrackHistory: CloudSetter<TrackHistoryItem[]>;
  setCollections: CloudSetter<UserCollection[]>;
  setFollowedStations: CloudSetter<FollowedStation[]>;
  setFollowedRegions: CloudSetter<FollowedRegion[]>;
  setAlerts: CloudSetter<ListenerAlert[]>;
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
  trackHistory
}: UseCloudLibrarySyncArgs) => {
  const hydratedCloudProfileRef = useRef<string | null>(null);

  useEffect(() => {
    if (sessionStatus !== 'authenticated') {
      hydratedCloudProfileRef.current = null;
    }
  }, [sessionStatus]);

  useEffect(() => {
    if (
      sessionStatus !== 'authenticated' ||
      !sessionProfileId ||
      !cloudLibrary ||
      hydratedCloudProfileRef.current === sessionProfileId
    ) {
      return;
    }

    hydratedCloudProfileRef.current = sessionProfileId;

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

    const remoteNeedsUpdate =
      !stationsMatch(mergedFavorites, cloudLibrary.favorites) ||
      !stationsMatch(mergedRecent, cloudLibrary.recent) ||
      !trackHistoryMatch(mergedTrackHistory, cloudLibrary.trackHistory as TrackHistoryItem[]) ||
      !collectionsMatch(mergedCollections, cloudLibrary.collections) ||
      !followedStationsMatch(mergedFollowedStations, cloudLibrary.followedStations) ||
      !followedRegionsMatch(mergedFollowedRegions, cloudLibrary.followedRegions) ||
      !alertsMatch(mergedAlerts, cloudLibrary.alerts);

    if (remoteNeedsUpdate) {
      void replaceCloudLibrary({
        favorites: mergedFavorites,
        recent: mergedRecent,
        trackHistory: mergedTrackHistory,
        collections: mergedCollections,
        followedStations: mergedFollowedStations,
        followedRegions: mergedFollowedRegions,
        alerts: mergedAlerts
      });
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
    setTrackHistory,
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
    const nextTrackHistory = trackHistory.slice(0, MAX_TRACK_HISTORY);
    const nextLibrary = {
      favorites,
      recent: nextRecent,
      trackHistory: nextTrackHistory,
      collections,
      followedStations,
      followedRegions,
      alerts
    };
    const sameAsCloud = cloudLibraryMatches(nextLibrary, cloudLibrary);

    if (sameAsCloud) return;

    const timeout = window.setTimeout(() => {
      void replaceCloudLibrary(nextLibrary);
    }, CLOUD_LIBRARY_SYNC_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, [
    alerts,
    cloudLibrary?.alerts,
    cloudLibrary?.collections,
    cloudLibrary?.favorites,
    cloudLibrary?.followedRegions,
    cloudLibrary?.followedStations,
    cloudLibrary?.recent,
    cloudLibrary?.trackHistory,
    collections,
    favorites,
    followedRegions,
    followedStations,
    recent,
    replaceCloudLibrary,
    sessionProfileId,
    sessionStatus,
    trackHistory
  ]);

  return {
    syncCloudLibraryImmediately: (nextLibrary: Omit<CloudLibrary, 'updatedAt'>) => {
      if (sessionStatus !== 'authenticated' || !sessionProfileId) return;
      void replaceCloudLibrary(nextLibrary);
    }
  };
};

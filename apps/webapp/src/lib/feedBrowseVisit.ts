import type { FeedBrowseVisit } from '../state/radio/types';

export const isFeedBrowseVisitCompatible = (
  visit: FeedBrowseVisit | null | undefined,
  playbackSourceId: string | null,
  playbackStationId: string | null,
  playbackQueueIds: string[]
): boolean => Boolean(
  visit &&
  visit.playbackSourceId === playbackSourceId &&
  visit.playbackStationId === playbackStationId &&
  visit.playbackQueueIds.length === playbackQueueIds.length &&
  visit.playbackQueueIds.every((id, index) => id === playbackQueueIds[index])
);

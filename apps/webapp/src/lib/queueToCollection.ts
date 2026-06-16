import type { StationLite } from '../types';
import type { UserCollection } from '../domain/contracts';

// Cap mirrors addStationToCollection's slice(0, 128).
const MAX_COLLECTION_STATIONS = 128;

/**
 * Pure builder for "save the current queue as a playlist". Snapshots the queue's
 * stations into a new UserCollection: dedupes by stationuuid (preserving order)
 * and caps the list. Returns null for an empty name or empty queue.
 *
 * The `id` and `now` timestamp are injected so the result is deterministic and
 * unit-testable. The CALLER must also cache the queue's stations (remember
 * Stations) so the new playlist can resolve them via the stationMap — the ids
 * alone would render as dangling rows otherwise.
 */
export const buildQueueCollection = (
  name: string,
  queueStations: StationLite[],
  meta: { id: string; now: number }
): UserCollection | null => {
  const normalized = name.trim().slice(0, 48);
  if (!normalized || !queueStations.length) return null;

  const seen = new Set<string>();
  const stationIds: string[] = [];
  for (const station of queueStations) {
    if (seen.has(station.stationuuid)) continue;
    seen.add(station.stationuuid);
    stationIds.push(station.stationuuid);
  }

  return {
    id: meta.id,
    name: normalized,
    description: null,
    stationIds: stationIds.slice(0, MAX_COLLECTION_STATIONS),
    isPublic: false,
    updatedAt: meta.now,
    createdAt: meta.now,
    pinned: false
  };
};

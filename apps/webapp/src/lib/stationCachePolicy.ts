import type { StationLite } from '../types';

// Cache policy for `fetchStationById`. Both rules exist to kill the flaky
// "station not found in catalog" bug, whose root cause was a transient cold-boot
// 502/503 being cached as `null` for the whole 24h TTL.

// NEVER cache a null lookup. A null means a transient server failure (cold boot
// 5xx) or a radio-browser miss — caching it would return "not found" for 24h
// even though the very next request would succeed. A genuinely missing station
// is rare; re-requesting it is far cheaper than 24h of poisoning.
export const shouldCacheStationLookup = (
  item: StationLite | null
): item is StationLite => item != null;

// Resolve a read cache entry, treating an empty payload as a MISS (return null →
// the caller re-requests). This self-heals entries already poisoned with a null
// by an older build, immediately, without waiting out the 24h TTL.
export const resolveCachedStation = (
  entry: { payload: StationLite | null } | null | undefined
): StationLite | null => (entry?.payload ? entry.payload : null);

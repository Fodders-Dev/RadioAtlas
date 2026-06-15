import type { StationLite } from '../types';
import type { FollowedStation, UserCollection } from '../domain/contracts';
import { normalizeStationName, stationLocation } from './stationUtils';

// The source a matched station was pulled from, used for the non-tappable
// per-result label. `collection` carries the collection's display name.
export type LibrarySearchSource =
  | { kind: 'favorite' }
  | { kind: 'collection'; name: string }
  | { kind: 'recent' }
  | { kind: 'followed' };

export type LibrarySearchEntry = {
  station: StationLite;
  source: LibrarySearchSource;
};

type BuildInput = {
  favorites: StationLite[];
  recent: StationLite[];
  collections: UserCollection[];
  followedStations: FollowedStation[];
  // Resolves a stationId (collections/follows only hold ids) to a full record.
  stationMap: Map<string, StationLite>;
};

// Union of the user's own library — favorites + recent + every collection's
// stations + follows — deduped by stationuuid. Dedup PRIORITY (first wins, and
// also decides the label): favorite > collection(name) > recent > followed.
// Collections/follows that don't resolve to a cached station are skipped (they
// can't be played anyway), mirroring resolveCollectionStations in Library.
export const buildLibrarySearchEntries = ({
  favorites,
  recent,
  collections,
  followedStations,
  stationMap
}: BuildInput): LibrarySearchEntry[] => {
  const byId = new Map<string, LibrarySearchEntry>();
  const add = (station: StationLite | undefined, source: LibrarySearchSource) => {
    if (!station || byId.has(station.stationuuid)) return;
    byId.set(station.stationuuid, { station, source });
  };

  favorites.forEach((station) => add(station, { kind: 'favorite' }));
  collections.forEach((collection) =>
    collection.stationIds.forEach((id) =>
      add(stationMap.get(id), { kind: 'collection', name: collection.name })
    )
  );
  recent.forEach((station) => add(station, { kind: 'recent' }));
  followedStations.forEach((followed) =>
    add(stationMap.get(followed.stationId), { kind: 'followed' })
  );

  return [...byId.values()];
};

// Lower-cased "name + location + country + tags" blob the query matches against.
const haystack = (station: StationLite) =>
  [normalizeStationName(station.name), stationLocation(station), station.country, station.tags]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

// Case-insensitive substring filter over the library set. Empty query returns
// the full set unchanged (the caller renders the normal tabs in that case).
export const filterLibraryEntries = (
  entries: LibrarySearchEntry[],
  query: string
): LibrarySearchEntry[] => {
  const needle = query.trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter((entry) => haystack(entry.station).includes(needle));
};

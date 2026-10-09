import type { StationLite } from '../types';

export type SharedPlaylist = {
  name: string;
  description: string | null;
  stationIds: string[];
  updatedAt: number;
};

export const readSharedPlaylistToken = (search: string, startParam: string | null) => {
  const queryToken = new URLSearchParams(search).get('playlist')?.trim();
  if (queryToken) return queryToken;
  const match = startParam?.match(/^playlist_(.+)$/i);
  return match?.[1]?.trim() || null;
};

export const buildCollectionShareUrl = (token: string, origin: string) => {
  const url = new URL('/', origin);
  url.searchParams.set('playlist', token);
  return url.toString();
};

const shareMarkerPrefix = 'radio:collection-share-active:';
const shareMarkerKey = (accountId: string, collectionId: string) =>
  `${shareMarkerPrefix}${encodeURIComponent(collectionId)}:${encodeURIComponent(accountId)}`;

export const rememberCollectionShareState = (accountId: string, collectionId: string, active: boolean) => {
  try {
    const key = shareMarkerKey(accountId, collectionId);
    if (active) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch {
    // A missing local marker must never block the server-side share controls.
  }
};

export const hasRememberedCollectionShare = (collectionId: string) => {
  try {
    const prefix = `${shareMarkerPrefix}${encodeURIComponent(collectionId)}:`;
    return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .some((key) => Boolean(key?.startsWith(prefix) && localStorage.getItem(key) === '1'));
  } catch {
    return false;
  }
};

export const resolveStationsInOrder = async (
  stationIds: string[],
  fetchStation: (id: string) => Promise<StationLite | null>,
  concurrency = 4
): Promise<Array<StationLite | null>> => {
  const ids = stationIds.slice(0, 128);
  const stations: Array<StationLite | null> = Array(ids.length).fill(null);
  let nextIndex = 0;
  const workerCount = Math.min(ids.length, Math.max(1, Math.floor(concurrency)));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= ids.length) return;
        try {
          stations[index] = await fetchStation(ids[index]!);
        } catch {
          stations[index] = null;
        }
      }
    })
  );
  return stations;
};

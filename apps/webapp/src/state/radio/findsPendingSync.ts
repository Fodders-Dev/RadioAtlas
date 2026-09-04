import type { TrackHistoryItem } from './types';

/**
 * How many finds on this device the confirmed cloud copy does not have.
 *
 * This exists because the first version of `find_sync_failed` measured an
 * INTENTION, not a fact. It hung on a ref set inside `copyTrack` — "somebody
 * caught something in this browser session and we have not seen a `synced`
 * since" — which is narrower than `trackHistory.length > 0` and therefore
 * avoided the obvious false positive, but failed in the direction that matters:
 *
 * - A find already sitting on the device unsynced (saved while signed out,
 *   saved before a reload, saved on a previous visit) produced NO event and NO
 *   toast when the sync failed. That is the single most likely way to lose a
 *   find, and it was the one case the counter could not see.
 * - The ref lived in memory. A reload between the failure and the recovery lost
 *   the pairing, so recoveries were undercounted against failures.
 * - The watcher keyed on `syncState` CHANGING, and `setSyncState('error')` over
 *   an existing `'error'` is a no-op in React. A second failed flush in the same
 *   error state said nothing.
 *
 * The replacement proves the claim from data both sides already hold: the local
 * finds, and `cloudLibrary.trackHistory`, which is the last copy the SERVER
 * confirmed — replaced by `applySessionSnapshot` only on a 200 and untouched on
 * a failure. A non-zero answer is exactly "there is an unsynchronised change to
 * finds", which is the thing the event name claims.
 *
 * ⚠ Direction matters. This asks only whether the DEVICE holds something the
 * cloud lacks. The reverse — the cloud ahead of the device, which is the normal
 * state between sign-in and the hydration merge — is not a pending find and must
 * not be counted as one.
 *
 * The identity is the same `stationId:track` pair the merge and the server's
 * `uniqueTrackHistory` dedupe on, so "already in the cloud" here means the same
 * thing it means there. Timestamps are deliberately not part of it: two devices
 * that caught the same track off the same station hold one find, not two.
 */
export const findIdentity = (item: { stationId: string; track: string }) =>
  `${item.stationId}:${item.track.toLowerCase()}`;

export const countFindsPendingSync = (
  local: readonly TrackHistoryItem[] | null | undefined,
  cloud: readonly TrackHistoryItem[] | null | undefined
) => {
  if (!local?.length) return 0;
  // No cloud copy at all is not "everything is pending": it is a session with
  // nowhere to sync to, and the caller gates on `authenticated` for that. An
  // authenticated account with an empty library, however, genuinely has every
  // local find pending — hence an empty ARRAY counts, a missing one does not.
  if (!cloud) return 0;
  const known = new Set(cloud.map(findIdentity));
  let pending = 0;
  for (const item of local) {
    if (!known.has(findIdentity(item))) pending += 1;
  }
  return pending;
};

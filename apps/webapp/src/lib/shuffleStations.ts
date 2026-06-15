import type { StationLite } from '../types';
import type { QueueSnapshot } from '../state/radio/types';

/**
 * Seeded Fisher-Yates shuffle (extracted from Library's collection shuffle).
 *
 * WARNING: this shuffles the ENTIRE input array. A caller that has a
 * currently-playing item MUST exclude that item BEFORE calling and re-insert it
 * at the SAME index afterwards. Shuffling an array that still contains the
 * playing station would move it out from under `currentIndex` and silently
 * change what plays — a violation of the never-auto-switch policy (PR #86).
 * Use {@link reshuffleQueueSnapshot} for the queue-safe wrapper.
 */
export const shuffleStations = (
  items: StationLite[],
  seed: number = Date.now()
): StationLite[] => {
  const seeded = [...items];
  let cursor = seed % 2147483647;
  if (cursor <= 0) cursor += 2147483646;
  for (let index = seeded.length - 1; index > 0; index -= 1) {
    cursor = (cursor * 48271) % 2147483647;
    const swapIndex = cursor % (index + 1);
    [seeded[index], seeded[swapIndex]] = [seeded[swapIndex], seeded[index]];
  }
  return seeded;
};

const orderEquals = (left: StationLite[], right: StationLite[]) =>
  left.length === right.length &&
  left.every((item, index) => item.stationuuid === right[index]?.stationuuid);

/**
 * Queue-safe reshuffle. Pins the currently-playing item (`items[currentIndex]`),
 * shuffles ONLY the remaining items, then re-inserts the pinned item at the
 * SAME index — so `currentIndex` keeps pointing at the exact same station and
 * nothing about playback changes (never-auto-switch, PR #86). `sourceId` and
 * `sourceLabel` are carried through untouched.
 *
 * Pure: returns a new snapshot, performs NO playback side effects.
 *
 * If the shuffle happens to reproduce the original order it re-rolls ONCE; with
 * a very small queue (e.g. a single shuffleable item) the order can be
 * unavoidably identical — the caller still surfaces feedback to the user.
 *
 * `shuffle` is injected so tests can drive a deterministic permutation.
 */
export const reshuffleQueueSnapshot = (
  snapshot: QueueSnapshot,
  shuffle: (items: StationLite[]) => StationLite[] = shuffleStations
): QueueSnapshot => {
  const { items, currentIndex } = snapshot;
  if (items.length <= 1) return snapshot;

  const pinnedIndex =
    currentIndex >= 0 && currentIndex < items.length ? currentIndex : -1;

  // Nothing is playing: the whole array is free to move.
  if (pinnedIndex === -1) {
    let reordered = shuffle(items);
    if (orderEquals(reordered, items)) reordered = shuffle(items);
    return { ...snapshot, items: reordered };
  }

  const pinned = items[pinnedIndex];
  const rest = items.filter((_, index) => index !== pinnedIndex);
  const build = (shuffledRest: StationLite[]) => {
    const next = [...shuffledRest];
    next.splice(pinnedIndex, 0, pinned);
    return next;
  };

  let reordered = build(shuffle(rest));
  if (orderEquals(reordered, items)) reordered = build(shuffle(rest));

  // currentIndex is unchanged on purpose: the pinned item sits at the same slot.
  return { ...snapshot, items: reordered, currentIndex: pinnedIndex };
};

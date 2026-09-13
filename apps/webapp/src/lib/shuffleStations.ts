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
 * How many stations are still AHEAD of the playing one. With nothing playing
 * the whole queue is ahead. «Перемешать следующие» needs at least two of them
 * to mean anything, and the UI hides the action below that.
 */
export const upcomingCount = ({ items, currentIndex }: Pick<QueueSnapshot, 'items' | 'currentIndex'>): number =>
  currentIndex >= 0 && currentIndex < items.length ? items.length - currentIndex - 1 : items.length;

/**
 * «Перемешать следующие»: reorders ONLY the items after `currentIndex`.
 *
 * Everything up to and including the playing station keeps its place — the
 * played part is the session's history and the listener can step back through
 * it; the playing station stays under `currentIndex` so nothing about playback
 * changes (never-auto-switch, PR #86). The earlier version pinned the playing
 * item and shuffled everything else, which let already-played stations land
 * in the upcoming part: `[A, B, C*, D, E]` could become `[E, D, C*, A, B]`.
 *
 * Pure: returns a new snapshot, performs NO playback side effects. `sourceId`
 * and `sourceLabel` are carried through untouched.
 *
 * With fewer than two upcoming items there is nothing to reorder and the
 * snapshot comes back as is. If the shuffle reproduces the original order it
 * re-rolls ONCE; two items can still come back identical — the caller surfaces
 * feedback either way.
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

  const played = items.slice(0, pinnedIndex + 1);
  const upcoming = items.slice(pinnedIndex + 1);
  if (upcoming.length < 2) return snapshot;

  let reorderedTail = shuffle(upcoming);
  if (orderEquals(reorderedTail, upcoming)) reorderedTail = shuffle(upcoming);

  // currentIndex is unchanged on purpose: the played part is byte-identical.
  return { ...snapshot, items: [...played, ...reorderedTail], currentIndex: pinnedIndex };
};

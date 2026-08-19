import type { PlayAttemptOutcome } from './types';

/**
 * Trying a list of stations until one plays — and knowing when to stop.
 *
 * There is exactly one `<audio>` element. A walk of a list owns it while it
 * runs, and the whole difficulty is that it can lose that ownership halfway
 * through, in two different ways:
 *
 *  - **Somebody newer took over.** A second tap, a station picked directly from
 *    a list, another walk. The attempt comes back `superseded`. That is NOT a
 *    verdict on the station — it means this walk is no longer in charge, and
 *    the only correct move is to stop. Reading it as failure and advancing is
 *    how two walkers end up chewing through one list on one element, each
 *    superseding the other's attempt, until the list runs out and the listener
 *    is told there is nothing to play.
 *  - **This walk was replaced by a newer walk of its own kind.** `stillCurrent`
 *    goes false. Same conclusion, checked before and after every attempt,
 *    because an attempt can take seconds.
 *
 * Measured in production on 2026-08-18: one «Перемешать избранное» produced 36
 * attempts in 191 ms, every single one superseded, ending on «нечего играть»
 * over a library of 120 saved stations. The queue held 120 items and the walk
 * caps at 20, so at least two walkers were running — a second tap on a list
 * that had not visibly reacted yet.
 *
 * `exhausted` is the ONLY result that may tell the listener their list is
 * unplayable, because it is the only one where we actually tried and failed.
 */
export type QueueWalkResult =
  /** A station is playing. */
  | 'played'
  /** Every station we were allowed to try failed for a real reason. */
  | 'exhausted'
  /** We stopped because somebody else owns playback now. Say nothing. */
  | 'handedOver';

export const walkStationQueue = async <T>({
  items,
  maxAttempts,
  attempt,
  stillCurrent
}: {
  items: T[];
  /** Hard cap, so a 120-station library is not walked end to end. */
  maxAttempts: number;
  attempt: (item: T, index: number) => Promise<PlayAttemptOutcome>;
  /** False once a newer walk has taken over. */
  stillCurrent: () => boolean;
}): Promise<QueueWalkResult> => {
  const limit = Math.min(items.length, maxAttempts);

  for (let index = 0; index < limit; index += 1) {
    if (!stillCurrent()) return 'handedOver';
    const item = items[index];
    if (item === undefined || item === null) continue;

    const outcome = await attempt(item, index);
    if (outcome === 'played') return 'played';
    if (outcome === 'superseded') return 'handedOver';
    // Checked AFTER the attempt too: a newer walk can start while this one is
    // waiting on a slow station, and the loser must not resume walking.
    if (!stillCurrent()) return 'handedOver';
  }

  return 'exhausted';
};

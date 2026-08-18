/**
 * Who gets one of the two metadata slots, and in what order.
 *
 * A single now-playing refresh is a serial chain of up to ~6 probes and can hold
 * its slot for the better part of 20 seconds, so the ordering is not a detail:
 * it decides whether the line under the listener's finger updates now or in a
 * minute. Until Home began previewing a shelf there was only ever one kind of
 * caller and the question did not arise; six preview tiles make it the whole
 * question.
 *
 * Two rules, and they are different rules:
 *
 *  1. **Listeners are served first.** A `listener` refresh is queued ahead of
 *     every waiting `preview`. There is at most one playing station, so this
 *     does not turn into listeners starving each other.
 *  2. **Previews may never occupy every slot.** Ordering alone is not enough —
 *     if both slots are already busy previewing stations nobody chose, a
 *     listener that arrives a second later still waits ~20s behind them. So
 *     previews are capped strictly below the total, which keeps a slot
 *     permanently reachable for whoever is actually listening.
 *
 * Extracted from nowPlaying.ts as a pure, injectable queue because the policy is
 * invisible from the outside: get it wrong and nothing breaks, nothing throws
 * and no test fails — the player's track line just quietly takes a minute to
 * appear on a slow shelf.
 */

export type RefreshPriority = 'listener' | 'preview';

/**
 * Starts the work for `key`, or returns null if there is nothing to do (the
 * entry was released, or a refresh is already in flight). Returning null must
 * NOT consume a slot — a queue full of stale keys should drain instantly rather
 * than block live ones.
 */
export type RefreshRunner = (key: string) => Promise<unknown> | null;

export type MetadataRefreshQueue = {
  enqueue: (key: string, priority?: RefreshPriority) => void;
  /** Test/diagnostic view. Not used by the running app. */
  inspect: () => { queued: string[]; active: number; activePreviews: number };
};

export const createMetadataRefreshQueue = ({
  maxConcurrent,
  maxPreviewConcurrent,
  run
}: {
  maxConcurrent: number;
  /** Must be < maxConcurrent, or rule 2 above is not enforced at all. */
  maxPreviewConcurrent: number;
  run: RefreshRunner;
}): MetadataRefreshQueue => {
  const queue: Array<{ key: string; priority: RefreshPriority }> = [];
  const queuedKeys = new Set<string>();
  let active = 0;
  let activePreviews = 0;

  const pump = () => {
    let index = 0;
    while (active < maxConcurrent && index < queue.length) {
      const candidate = queue[index];
      if (candidate.priority === 'preview' && activePreviews >= maxPreviewConcurrent) {
        // Not "stop pumping": a listener further down the queue must still be
        // able to start while previews are held back.
        index += 1;
        continue;
      }
      queue.splice(index, 1);
      queuedKeys.delete(candidate.key);
      const started = run(candidate.key);
      if (!started) continue;
      active += 1;
      if (candidate.priority === 'preview') activePreviews += 1;
      void started.finally(() => {
        active = Math.max(active - 1, 0);
        if (candidate.priority === 'preview') {
          activePreviews = Math.max(activePreviews - 1, 0);
        }
        pump();
      });
    }
  };

  return {
    enqueue: (key, priority = 'listener') => {
      if (queuedKeys.has(key)) return;
      queuedKeys.add(key);
      if (priority === 'listener') {
        // Ahead of every waiting preview, behind every waiting listener.
        const firstPreview = queue.findIndex((item) => item.priority === 'preview');
        if (firstPreview === -1) queue.push({ key, priority });
        else queue.splice(firstPreview, 0, { key, priority });
      } else {
        queue.push({ key, priority });
      }
      pump();
    },
    inspect: () => ({
      queued: queue.map((item) => item.key),
      active,
      activePreviews
    })
  };
};

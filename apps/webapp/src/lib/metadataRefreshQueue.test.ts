import { describe, expect, it } from 'vitest';

import { createMetadataRefreshQueue } from './metadataRefreshQueue';

/**
 * The policy this file guards is invisible in the running app: get it wrong and
 * nothing throws, nothing looks broken, and the only symptom is that the track
 * line of the station somebody is LISTENING to takes a minute to appear because
 * six shelf previews got the slots first.
 *
 * A single refresh can hold its slot for ~20 seconds, so "a minute" is not
 * hyperbole — it is 6 previews ÷ 2 slots × 20s.
 */

const makeHarness = ({ maxConcurrent = 2, maxPreviewConcurrent = 1 } = {}) => {
  const started: string[] = [];
  const finish = new Map<string, () => void>();
  const queue = createMetadataRefreshQueue({
    maxConcurrent,
    maxPreviewConcurrent,
    run: (key) => {
      if (key.startsWith('gone-')) return null;
      started.push(key);
      return new Promise<void>((resolve) => finish.set(key, resolve));
    }
  });
  const settle = async (key: string) => {
    finish.get(key)?.();
    finish.delete(key);
    // Two microtask turns: one for the run promise, one for the .finally that
    // re-pumps.
    await Promise.resolve();
    await Promise.resolve();
  };
  return { queue, started, settle };
};

describe('who gets a metadata slot', () => {
  it('never lets previews take every slot, so a listener can always start', async () => {
    const { queue, started } = makeHarness();
    queue.enqueue('preview-a', 'preview');
    queue.enqueue('preview-b', 'preview');

    // Both were admitted to the queue, but only one may run: the second slot is
    // held for whoever is actually listening.
    expect(started).toEqual(['preview-a']);

    queue.enqueue('the-playing-station', 'listener');
    expect(started).toEqual(['preview-a', 'the-playing-station']);
  });

  it('serves a listener ahead of previews that were queued first', async () => {
    const { queue, started, settle } = makeHarness({ maxConcurrent: 1, maxPreviewConcurrent: 1 });
    queue.enqueue('preview-a', 'preview');
    queue.enqueue('preview-b', 'preview');
    queue.enqueue('preview-c', 'preview');
    queue.enqueue('the-playing-station', 'listener');

    expect(started).toEqual(['preview-a']);
    await settle('preview-a');
    // Not preview-b, even though it has been waiting longer.
    expect(started).toEqual(['preview-a', 'the-playing-station']);
  });

  it('keeps previews in the order the shelf asked for them', async () => {
    const { queue, started, settle } = makeHarness({ maxConcurrent: 1, maxPreviewConcurrent: 1 });
    queue.enqueue('preview-a', 'preview');
    queue.enqueue('preview-b', 'preview');
    queue.enqueue('preview-c', 'preview');

    await settle('preview-a');
    await settle('preview-b');
    expect(started).toEqual(['preview-a', 'preview-b', 'preview-c']);
  });

  it('defaults to listener priority, so an un-annotated caller is never starved', () => {
    const { queue, started } = makeHarness();
    queue.enqueue('preview-a', 'preview');
    queue.enqueue('unannotated');
    expect(started).toEqual(['preview-a', 'unannotated']);
  });

  it('does not queue the same key twice while it is waiting', async () => {
    const { queue, started, settle } = makeHarness({ maxConcurrent: 1, maxPreviewConcurrent: 1 });
    queue.enqueue('preview-a', 'preview');
    queue.enqueue('preview-b', 'preview');
    queue.enqueue('preview-b', 'preview');
    queue.enqueue('preview-b', 'preview');

    await settle('preview-a');
    await settle('preview-b');
    expect(started).toEqual(['preview-a', 'preview-b']);
    expect(queue.inspect().queued).toEqual([]);
  });

  it('spends no slot on a key whose entry has gone away', () => {
    // The runner returns null for a released entry. A queue full of those must
    // drain instantly instead of blocking live work — this is what the `continue`
    // in the pump is for.
    const { queue, started } = makeHarness();
    queue.enqueue('gone-1', 'preview');
    queue.enqueue('gone-2', 'preview');
    queue.enqueue('gone-3', 'preview');
    queue.enqueue('preview-a', 'preview');
    queue.enqueue('the-playing-station', 'listener');

    expect(started).toEqual(['preview-a', 'the-playing-station']);
    expect(queue.inspect().active).toBe(2);
  });

  it('releases the slot when a refresh finishes', async () => {
    const { queue, started, settle } = makeHarness();
    queue.enqueue('listener-1', 'listener');
    queue.enqueue('listener-2', 'listener');
    queue.enqueue('listener-3', 'listener');
    expect(started).toEqual(['listener-1', 'listener-2']);

    await settle('listener-1');
    expect(started).toEqual(['listener-1', 'listener-2', 'listener-3']);
    expect(queue.inspect().active).toBe(2);

    await settle('listener-2');
    await settle('listener-3');
    expect(queue.inspect().active).toBe(0);
  });

  it('lets previews resume once the listener is done with the slot', async () => {
    const { queue, started, settle } = makeHarness();
    queue.enqueue('preview-a', 'preview');
    queue.enqueue('preview-b', 'preview');
    queue.enqueue('listener-1', 'listener');
    expect(started).toEqual(['preview-a', 'listener-1']);

    await settle('preview-a');
    // preview-b may now take the one preview slot that just freed up.
    expect(started).toEqual(['preview-a', 'listener-1', 'preview-b']);
  });
});

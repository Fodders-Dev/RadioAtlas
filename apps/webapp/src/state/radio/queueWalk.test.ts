import { describe, expect, it } from 'vitest';

import { walkStationQueue } from './queueWalk';
import type { PlayAttemptOutcome } from './types';

/**
 * The production trace this file exists for, from 2026-08-18:
 *
 *   0ms   play_attempt    a76c54e8  q=120
 *   0ms   play_superseded ad239b28
 *   2ms   play_attempt    c8c5de5f  q=120
 *   8ms   play_attempt    54340297  q=120
 *   9ms   play_superseded c8c5de5f
 *
 * 36 attempts, 36 supersedes, zero successes, 191 ms — over a library of 120
 * saved stations, ending on «нечего играть». Note the interleave at 2/8/9 ms:
 * an attempt starting before the previous one has returned is only possible if
 * two walks are running, and the cap is 20 per walk, so 36 attempts proves it.
 *
 * The listener's version of this bug: you tap «Перемешать избранное», nothing
 * happens for a moment, you tap again — and the app tells you that none of the
 * 120 stations you saved can be played.
 */

const walk = (
  outcomes: PlayAttemptOutcome[],
  options: { maxAttempts?: number; stillCurrent?: () => boolean } = {}
) => {
  const tried: number[] = [];
  const result = walkStationQueue({
    items: outcomes.map((_, index) => `station-${index}`),
    maxAttempts: options.maxAttempts ?? 20,
    stillCurrent: options.stillCurrent ?? (() => true),
    attempt: async (_item, index) => {
      tried.push(index);
      return outcomes[index];
    }
  });
  return { result, tried };
};

describe('walking a list until something plays', () => {
  it('stops at the first station that plays', async () => {
    const { result, tried } = walk(['failed', 'failed', 'played', 'failed']);
    expect(await result).toBe('played');
    expect(tried).toEqual([0, 1, 2]);
  });

  it('reports exhausted only after really trying', async () => {
    const { result, tried } = walk(['failed', 'failed', 'failed']);
    expect(await result).toBe('exhausted');
    expect(tried).toEqual([0, 1, 2]);
  });

  it('STOPS on a supersede instead of racing whoever took over', async () => {
    // The defect. `superseded` used to be read as "this station is dead, try
    // the next" — which is how one tap burned 36 stations in 191 ms.
    const { result, tried } = walk(['failed', 'superseded', 'played', 'played']);
    expect(await result).toBe('handedOver');
    expect(tried).toEqual([0, 1]);
  });

  it('never claims the list is unplayable after handing over', async () => {
    // 'handedOver' is what stops the «нечего играть» toast being a lie. The
    // listener's favourites were never tried; somebody newer simply took the
    // audio element.
    const { result } = walk(['superseded', 'failed', 'failed']);
    expect(await result).not.toBe('exhausted');
  });

  it('gives up its turn the moment a newer walk starts', async () => {
    let current = true;
    const { result, tried } = walk(['failed', 'failed', 'failed', 'played'], {
      stillCurrent: () => current
    });
    // The newer walk begins while the first station is still being attempted.
    current = false;
    expect(await result).toBe('handedOver');
    expect(tried).toEqual([0]);
  });

  it('checks for a takeover BEFORE the first attempt too', async () => {
    const { result, tried } = walk(['played'], { stillCurrent: () => false });
    expect(await result).toBe('handedOver');
    expect(tried).toEqual([]);
  });

  it('honours the attempt cap on a long library', async () => {
    // 120 favourites, cap 20: the walk must not march through the whole
    // library. This is the cap that proved two walkers were running.
    const { result, tried } = walk(Array<PlayAttemptOutcome>(120).fill('failed'), {
      maxAttempts: 20
    });
    expect(await result).toBe('exhausted');
    expect(tried).toHaveLength(20);
  });

  it('says exhausted for an empty list rather than pretending it handed over', async () => {
    const { result, tried } = walk([]);
    expect(await result).toBe('exhausted');
    expect(tried).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { countAudioOutputs, shouldPauseOnDeviceChange } from './outputDeviceGuard';

describe('shouldPauseOnDeviceChange', () => {
  it('pauses only when an output device is removed WHILE playing', () => {
    expect(shouldPauseOnDeviceChange(2, 1, true)).toBe(true); // unplug while playing
    expect(shouldPauseOnDeviceChange(2, 1, false)).toBe(false); // not playing → ignore
    expect(shouldPauseOnDeviceChange(1, 2, true)).toBe(false); // plug-IN → never pause
    expect(shouldPauseOnDeviceChange(2, 2, true)).toBe(false); // no change
    expect(shouldPauseOnDeviceChange(0, 0, true)).toBe(false); // nothing enumerable
  });
});

describe('countAudioOutputs', () => {
  it('returns null when enumeration is unavailable', async () => {
    expect(await countAudioOutputs(undefined)).toBeNull();
    expect(await countAudioOutputs({} as never)).toBeNull();
  });

  it('counts only audiooutput devices', async () => {
    const mediaDevices = {
      enumerateDevices: async () =>
        [
          { kind: 'audiooutput' },
          { kind: 'audiooutput' },
          { kind: 'audioinput' },
          { kind: 'videoinput' }
        ] as MediaDeviceInfo[]
    };
    expect(await countAudioOutputs(mediaDevices)).toBe(2);
  });

  it('returns null when enumerateDevices throws (e.g. permission denied)', async () => {
    const mediaDevices = {
      enumerateDevices: async () => {
        throw new Error('denied');
      }
    };
    expect(await countAudioOutputs(mediaDevices)).toBeNull();
  });
});

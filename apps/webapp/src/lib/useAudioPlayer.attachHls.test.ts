import { describe, expect, it } from 'vitest';
import { attachHlsIfCurrent } from './useAudioPlayer';

// attachHlsIfCurrent is the supersede guard for the HLS branch of attachSource.
// attachSource awaits import('hls.js') before it can build the player; if the
// user switched stations during that gap, attaching now would hijack the shared
// <audio> from the newer session and orphan its Hls. The guard re-checks the
// session AFTER the import and bails before constructing/attaching.

class FakeHls {
  static built = 0;
  loaded: string | null = null;
  attached: HTMLMediaElement | null = null;
  destroyed = false;

  constructor(public config: Record<string, unknown>) {
    FakeHls.built += 1;
  }

  loadSource(url: string) {
    this.loaded = url;
  }

  attachMedia(media: HTMLMediaElement) {
    this.attached = media;
  }

  destroy() {
    this.destroyed = true;
  }
}

const fakeAudio = () => ({}) as HTMLMediaElement;

describe('attachHlsIfCurrent', () => {
  it('constructs, loads + attaches when the session is still current', () => {
    FakeHls.built = 0;
    const audio = fakeAudio();
    const hls = attachHlsIfCurrent(FakeHls as never, audio, 'https://x/live.m3u8', () => true) as FakeHls | null;

    expect(hls).not.toBeNull();
    expect(FakeHls.built).toBe(1);
    expect(hls?.loaded).toBe('https://x/live.m3u8');
    expect(hls?.attached).toBe(audio); // bound to the shared element
  });

  it('does NOT construct or attach when superseded → returns null', () => {
    FakeHls.built = 0;
    const audio = fakeAudio();
    const hls = attachHlsIfCurrent(FakeHls as never, audio, 'https://x/live.m3u8', () => false);

    // The whole point: never touch the shared <audio> (no attachMedia) and never
    // build an Hls that the caller would orphan.
    expect(hls).toBeNull();
    expect(FakeHls.built).toBe(0);
  });

  it('passes the provided config through to the constructor', () => {
    FakeHls.built = 0;
    const config = { enableWorker: false, marker: 'cfg' };
    const hls = attachHlsIfCurrent(
      FakeHls as never,
      fakeAudio(),
      'https://x/live.m3u8',
      () => true,
      config
    ) as FakeHls | null;

    expect(hls?.config).toBe(config);
  });
});

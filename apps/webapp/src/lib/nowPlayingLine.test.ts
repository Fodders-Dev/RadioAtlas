import { describe, expect, it } from 'vitest';
import {
  resolveNowPlayingLine,
  stationLooksSilent,
  SILENCE_VERDICT_AFTER_MS
} from './nowPlayingLine';

const station = (tags = '', name = 'Some Station') =>
  ({ name, tags, url_resolved: '', url: '', homepage: '' }) as never;

describe('resolveNowPlayingLine', () => {
  it('prefers the live track above everything', () => {
    expect(
      resolveNowPlayingLine({ station: station('jazz'), track: 'Oasis - Wonderwall', lastHeard: 'Old' })
    ).toEqual({ kind: 'track', text: 'Oasis - Wonderwall' });
  });

  it('falls to the last one we heard before describing the station', () => {
    expect(
      resolveNowPlayingLine({ station: station('jazz'), track: null, lastHeard: 'Miles Davis - So What' })
    ).toEqual({ kind: 'lastHeard', text: 'Miles Davis - So What' });
  });

  it('describes the station when there is no track at all', () => {
    expect(resolveNowPlayingLine({ station: station('deep house'), track: null })).toEqual({
      kind: 'genre',
      slug: 'deepHouse'
    });
  });

  // The last rung. Still true — you ARE listening to a live broadcast — which is
  // the whole point of the ladder: no rung is an apology.
  it('says it is a live broadcast when even the genre is unknown', () => {
    expect(resolveNowPlayingLine({ station: station('généraliste'), track: null })).toEqual({ kind: 'live' });
    expect(resolveNowPlayingLine({ station: station(''), track: null })).toEqual({ kind: 'live' });
    expect(resolveNowPlayingLine({ station: null, track: null })).toEqual({ kind: 'live' });
  });

  it('treats a whitespace-only track as no track', () => {
    expect(resolveNowPlayingLine({ station: station('jazz'), track: '   ' })).toEqual({
      kind: 'genre',
      slug: 'jazz'
    });
  });
});

describe('stationLooksSilent', () => {
  const base = {
    isPlaying: true,
    metadataStatus: 'unavailable',
    listeningSinceMs: 1_000_000,
    everHadTrack: false,
    now: 1_000_000 + SILENCE_VERDICT_AFTER_MS
  };

  it('says so once the threshold is reached while actually playing', () => {
    expect(stationLooksSilent(base)).toBe(true);
  });

  it('stays quiet until the threshold', () => {
    expect(stationLooksSilent({ ...base, now: base.listeningSinceMs + SILENCE_VERDICT_AFTER_MS - 1 })).toBe(false);
  });

  // ⚠⚠ The guard that makes this honest. Two branches of the metadata layer emit
  // an identical snapshot — one meaning "probed, nothing came", the other "there
  // was no URL to probe". Requiring audio to be playing makes that distinction
  // irrelevant: either way the listener is hearing something we cannot name.
  it('never accuses a station that is not actually playing', () => {
    expect(stationLooksSilent({ ...base, isPlaying: false })).toBe(false);
  });

  it('never accuses a station that has named a track this session', () => {
    expect(stationLooksSilent({ ...base, everHadTrack: true })).toBe(false);
  });

  it('waits while the metadata fetch is still in flight', () => {
    expect(stationLooksSilent({ ...base, metadataStatus: 'loading' })).toBe(false);
    expect(stationLooksSilent({ ...base, metadataStatus: 'idle' })).toBe(false);
  });

  it('says nothing before playback has started', () => {
    expect(stationLooksSilent({ ...base, listeningSinceMs: null })).toBe(false);
  });

  it('is long enough that an ordinary long record cannot trigger it', () => {
    // A 10-minute live set is normal on the stations most likely to be silent.
    expect(SILENCE_VERDICT_AFTER_MS).toBeGreaterThanOrEqual(60_000);
  });
});

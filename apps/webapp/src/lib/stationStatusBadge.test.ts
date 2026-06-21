import { describe, expect, it } from 'vitest';
import { getStationBadgeState, isStationBroken } from './stationStatusBadge';
import {
  DEFAULT_STATION_HEALTH_PROFILE,
  recordStationHealthSignal,
  type StationHealthSignalKind
} from './stationHealth';
import type { StationLite } from '../types';

const NOW = 1_700_000_000_000;

const station = (over: Partial<StationLite> = {}): StationLite =>
  ({
    stationuuid: 'u1',
    name: 'Test FM',
    url: 'https://x.example',
    url_resolved: 'https://x.example',
    country: 'US',
    tags: [],
    ...over
  }) as StationLite;

const record = (kind: StationHealthSignalKind, times: number, atOffset = 0) => {
  let profile = DEFAULT_STATION_HEALTH_PROFILE;
  for (let i = 0; i < times; i += 1) {
    profile = recordStationHealthSignal(profile, 'u1', kind, { now: NOW + atOffset });
  }
  return profile;
};

describe('getStationBadgeState', () => {
  it('none for a healthy station with no signals', () => {
    expect(getStationBadgeState(station(), {}, NOW)).toBe('none');
  });

  it('broken when Radio Browser just confirmed the station dead (upstream)', () => {
    const dead = station({ lastcheckok: 0, lastcheckok_at: NOW });
    expect(getStationBadgeState(dead, {}, NOW)).toBe('broken');
    expect(isStationBroken(dead, {}, NOW)).toBe(true);
  });

  it('broken when health is suppressed (>=2 recent hard failures)', () => {
    const healthProfile = record('stream-failure', 2);
    expect(getStationBadgeState(station(), { healthProfile }, NOW)).toBe('broken');
  });

  it('no-metadata when the last health event was a title miss', () => {
    const healthProfile = record('metadata-unavailable', 1);
    expect(getStationBadgeState(station(), { healthProfile }, NOW)).toBe('no-metadata');
  });

  it('clears no-metadata once a playback success follows (lastKind is overwritten)', () => {
    let healthProfile = recordStationHealthSignal(DEFAULT_STATION_HEALTH_PROFILE, 'u1', 'metadata-unavailable', {
      now: NOW
    });
    healthProfile = recordStationHealthSignal(healthProfile, 'u1', 'proxy-success', { now: NOW + 1000 });
    expect(getStationBadgeState(station(), { healthProfile }, NOW + 2000)).toBe('none');
  });

  it('prioritises broken over no-metadata', () => {
    const healthProfile = record('metadata-unavailable', 1);
    const dead = station({ lastcheckok: 0, lastcheckok_at: NOW });
    expect(getStationBadgeState(dead, { healthProfile }, NOW)).toBe('broken');
  });
});

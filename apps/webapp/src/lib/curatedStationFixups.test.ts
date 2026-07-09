import { describe, expect, it } from 'vitest';
import type { StationLite } from '../types';
import {
  applyCuratedStationFixup,
  clearCuratedStationSignals
} from './curatedStationFixups';

const oldHappyDance = (): StationLite => ({
  stationuuid: 'e9e50308-e8c8-4605-8888-38638f941f34',
  name: 'Весёлый Dance - Радио Ваня',
  url: 'https://dead.example/old',
  url_resolved: 'https://dead.example/old',
  homepage: '',
  favicon: '',
  country: 'Russia',
  state: '',
  tags: 'dance',
  geo_lat: null,
  geo_long: null,
  lastcheckok: 0,
  lastcheckok_at: Date.now()
});

describe('curatedStationFixups', () => {
  it('rewrites old Radio Vanya persisted stations to the live CDN mount', () => {
    const fixed = applyCuratedStationFixup(oldHappyDance());

    expect(fixed.name).toBe('Радио Ваня — Весёлый Дэнс');
    expect(fixed.url_resolved).toBe('https://icecast-radiovanya.cdnvideo.ru/rv_Happy_Dance');
    expect(fixed.url).toBe('https://icecast-radiovanya.cdnvideo.ru/rv_Happy_Dance');
    expect(fixed.lastcheckok).toBe(1);
  });

  it('drops stale local failure signals for fixed Radio Vanya stations', () => {
    const profile = {
      version: 1 as const,
      signals: {
        'e9e50308-e8c8-4605-8888-38638f941f34': { failures: 2 },
        unrelated: { failures: 2 }
      }
    };

    expect(clearCuratedStationSignals(profile).signals).toEqual({
      unrelated: { failures: 2 }
    });
  });
});

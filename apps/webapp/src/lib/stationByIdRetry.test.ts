import { describe, it, expect, vi } from 'vitest';
import {
  requestStationByIdWithRetry,
  stationByIdPath,
  STATION_BY_ID_RETRY_ATTEMPTS,
  type StationByIdRequest
} from './stationByIdRetry';
import type { StationLite } from '../types';

const station = (id: string): StationLite => ({
  stationuuid: id,
  name: `Station ${id}`,
  url_resolved: `https://stream/${id}`,
  homepage: '',
  favicon: '',
  country: '',
  state: '',
  tags: '',
  geo_lat: null,
  geo_long: null,
  stationArtwork: null,
  isClaimed: false,
  isVerified: false,
  promoted: false,
  description: null,
  websiteUrl: null,
  scheduleNote: null
});

const httpError = (status: number) =>
  Object.assign(new Error(`Catalog request failed (${status})`), { status });

// Deterministic, instant sleep so the exponential backoff doesn't slow the test.
const noopSleep = async () => {};

describe('requestStationByIdWithRetry (T_deeplink_resilience)', () => {
  it('rides out a transient 503 burst: 503, 503, 200 → resolves the station (does not bail to null)', async () => {
    let calls = 0;
    const request: StationByIdRequest = async () => {
      calls += 1;
      if (calls <= 2) throw httpError(503);
      return { item: station('kazak') };
    };

    const result = await requestStationByIdWithRetry(request, 'kazak', { sleep: noopSleep });

    expect(result?.stationuuid).toBe('kazak');
    expect(calls).toBe(3);
  });

  it('uses EXPONENTIAL backoff (1000, 2000, 4000) across the 4 attempts', async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const request: StationByIdRequest = async () => {
      throw httpError(503);
    };

    await expect(
      requestStationByIdWithRetry(request, 'kazak', { sleep })
    ).rejects.toThrow();

    // 4 attempts → 3 backoff waits, doubling each time. Guards against an
    // accidental regression to fixed backoff (which wouldn't cover the ~5.7s
    // worst-case cold parse).
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([1000, 2000, 4000]);
  });

  it('exhausts all attempts on a persistent 503, then throws so the caller can fall back', async () => {
    let calls = 0;
    const request: StationByIdRequest = async () => {
      calls += 1;
      throw httpError(503);
    };

    await expect(
      requestStationByIdWithRetry(request, 'kazak', { sleep: noopSleep })
    ).rejects.toThrow();
    expect(calls).toBe(STATION_BY_ID_RETRY_ATTEMPTS);
  });

  it('does NOT retry a definitive 404 — throws on the first attempt', async () => {
    let calls = 0;
    const request: StationByIdRequest = async () => {
      calls += 1;
      throw httpError(404);
    };

    await expect(
      requestStationByIdWithRetry(request, 'missing', { sleep: noopSleep })
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('retries a status-less network/parse blip (no .status) as transient', async () => {
    let calls = 0;
    const request: StationByIdRequest = async () => {
      calls += 1;
      if (calls === 1) throw new Error('Catalog temporarily unavailable');
      return { item: station('kazak') };
    };

    const result = await requestStationByIdWithRetry(request, 'kazak', { sleep: noopSleep });
    expect(result?.stationuuid).toBe('kazak');
    expect(calls).toBe(2);
  });

  it('attempts: 1 (the default non-deep-link path) does NOT retry, even on 503', async () => {
    let calls = 0;
    const sleep = vi.fn(async (_ms: number) => {});
    const request: StationByIdRequest = async () => {
      calls += 1;
      throw httpError(503);
    };

    await expect(
      requestStationByIdWithRetry(request, 'kazak', { attempts: 1, sleep })
    ).rejects.toThrow();
    expect(calls).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('resolves on the first try without sleeping', async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const request: StationByIdRequest = async () => ({ item: station('kazak') });

    const result = await requestStationByIdWithRetry(request, 'kazak', { sleep });
    expect(result?.stationuuid).toBe('kazak');
    expect(sleep).not.toHaveBeenCalled();
  });

  it('builds the canonical by-id path (encoded)', () => {
    expect(stationByIdPath('a/b uuid')).toBe('/catalog/stations/a%2Fb%20uuid');
  });
});

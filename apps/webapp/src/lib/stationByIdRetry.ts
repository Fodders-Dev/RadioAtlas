import type { StationLite } from '../types';

// T_deeplink_resilience: a station opened via deep link (?startapp=station_<uuid>)
// resolves through /catalog/stations/<uuid>. On a cold boot the app fires
// catalog-fast.json + summary + station-by-id concurrently, and the API 503s
// while it parses the 57k catalogue (Caddy upstream busy). The 503 is transient
// — it clears once the parse finishes (observed up to ~5.7s) — but the old path
// caught it, fell straight to the (CORS/slow) radio-browser by-id fallback,
// returned null, and the deep link silently never played.
//
// This retries the by-id lookup on transient failures with EXPONENTIAL backoff
// before the caller falls back: 1s → 2s → 4s across 4 attempts (last attempt at
// ~7s, covering the worst-case cold parse with headroom). The common case (503
// clears in 1-2s) resolves on attempt 2-3 quickly — exponential backoff
// optimises exactly that: fast common case, patient worst case.
//
// A 404 is a definitive not-found and is NOT retried.

export type StationByIdRequest = (path: string) => Promise<{ item: StationLite | null }>;

type RetryOptions = {
  attempts?: number;
  baseBackoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

export const STATION_BY_ID_RETRY_ATTEMPTS = 4;
const DEFAULT_BASE_BACKOFF_MS = 1000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isTransientFailure = (error: unknown) => {
  if (!(error instanceof Error)) return false;
  const status = (error as Error & { status?: number }).status;
  // A typed HTTP status: retry only server errors (5xx). 404 etc → give up.
  if (typeof status === 'number') return status >= 500;
  // No status → a network/parse blip (requestJson throws a bare Error for those)
  // → treat as transient.
  return true;
};

export const stationByIdPath = (stationId: string) =>
  `/catalog/stations/${encodeURIComponent(stationId)}`;

export const requestStationByIdWithRetry = async (
  request: StationByIdRequest,
  stationId: string,
  { attempts = STATION_BY_ID_RETRY_ATTEMPTS, baseBackoffMs = DEFAULT_BASE_BACKOFF_MS, sleep = defaultSleep }: RetryOptions = {}
): Promise<StationLite | null> => {
  const path = stationByIdPath(stationId);
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await request(path);
      return response.item || null;
    } catch (error) {
      lastError = error;
      const hasMoreAttempts = attempt + 1 < attempts;
      if (!hasMoreAttempts || !isTransientFailure(error)) {
        throw error;
      }
      // 1000, 2000, 4000, … — exponential so the common quick-clear resolves
      // fast while the worst-case cold parse still gets covered.
      await sleep(baseBackoffMs * 2 ** attempt);
    }
  }
  throw lastError;
};

import type express from 'express';
import {
  MAX_LIVE_ENTRIES,
  getLiveStations,
  getPresenceStats,
  recordPresenceBeat,
  releasePresence,
  sweepPresence
} from './listeningPresence.js';
import { setGauge } from './observabilityStore.js';

/**
 * Endpoints for live listener presence. See listeningPresence.ts for the privacy design.
 *
 * DELIBERATELY NOT using the shared ProtectedMediaRoute limiter, for two verified reasons:
 *   1. Its rate-limit path calls maybeAlert(), which appends `ip=…` to metrics.json with a
 *      7-day retention — and that file is served by the UNAUTHENTICATED /observability
 *      endpoint. Opting this route in would quietly start persisting client IPs against a
 *      feature whose entire point is that it stores nothing about anybody.
 *   2. Its rateLimits map is never pruned (pruneCache only touches the response cache).
 *      That is harmless on bursty media routes and a slow leak on a route every listener
 *      hits every 30 seconds.
 * So: a local fixed-window counter that sweeps itself and alerts nobody.
 */

const RATE_WINDOW_MS = 60_000;
/** A well-behaved client beats at most ~2/min; 20 leaves room for tabs and retries. */
const RATE_MAX_PER_WINDOW = 20;

/**
 * A station is only listed publicly once at least this many people are on it. Below the
 * threshold the fact "somebody is listening to X" stays inside the process: on a small
 * app, "1 listener" plus a niche station can point at one identifiable person.
 */
const MIN_PUBLIC_LISTENERS = 3;

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

const clientKey = (req: express.Request): string =>
  (req.ip || req.socket.remoteAddress || 'unknown').toString();

const overRateLimit = (req: express.Request, now = Date.now()): boolean => {
  const key = clientKey(req);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_MAX_PER_WINDOW;
};

const sweepBuckets = (now = Date.now()) => {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
};

export const registerListeningRoutes = (app: express.Express) => {
  /**
   * Heartbeat. Returns the station's live count on the WRITE, so a listening client never
   * needs a separate polling read to show the number.
   */
  app.post('/listening/beat', (req, res) => {
    if (overRateLimit(req)) {
      res.status(429).json({ error: 'too many beats' });
      return;
    }
    const result = recordPresenceBeat(req.body?.token, req.body?.stationId);
    if (!result.ok) {
      if (result.reason === 'full') {
        // Capacity, not client error: tell it to back off rather than to retry hard.
        res.status(503).json({ error: 'presence at capacity', capacity: MAX_LIVE_ENTRIES });
        return;
      }
      res.status(400).json({ error: 'token and stationId are required' });
      return;
    }
    res.json({ listeners: result.listeners });
  });

  /**
   * Explicit goodbye on pause/stop/unload. Sent with sendBeacon, so it must stay cheap and
   * must never require a response body. The TTL is the real guarantee — this only makes the
   * count drop promptly instead of within ~2.5 minutes.
   */
  app.post('/listening/bye', (req, res) => {
    releasePresence(req.body?.token);
    res.status(204).end();
  });

  /**
   * «Что слушают сейчас» — stations other people are on right now.
   * Only stations at or above MIN_PUBLIC_LISTENERS are listed; the response is honest about
   * being empty, and the client is expected to render nothing rather than invent filler.
   */
  app.get('/listening/live', (req, res) => {
    const raw = Number.parseInt(String(req.query.limit ?? '10'), 10);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 25) : 10;
    const stations = getLiveStations(MAX_LIVE_ENTRIES)
      .filter((entry) => entry.listeners >= MIN_PUBLIC_LISTENERS)
      .slice(0, limit);
    res.set('Cache-Control', 'no-store');
    res.json({ stations, minListeners: MIN_PUBLIC_LISTENERS });
  });
};

/**
 * Peaks, because an instantaneous reading of a small audience is always 0.
 *
 * `/listening/live` is empty whether three people are spread across three
 * stations or nobody has opened the app since Tuesday, and until now nothing
 * told those two apart — the claim that the k=3 floor is what keeps the feature
 * invisible had never been measured. These four gauges are the measurement, and
 * they carry counts only: no station id, no token, nothing that could point at
 * a person. The peaks reset each hour so a single busy minute last week cannot
 * masquerade as a healthy afternoon.
 */
const PEAK_WINDOW_MS = 3_600_000;
let peakListeners = 0;
let peakStationListeners = 0;
let peakWindowStartedAt = 0;

export const reportPresenceGauges = (now = Date.now()) => {
  if (now - peakWindowStartedAt >= PEAK_WINDOW_MS) {
    peakWindowStartedAt = now;
    peakListeners = 0;
    peakStationListeners = 0;
  }
  const stats = getPresenceStats();
  if (stats.listeners > peakListeners) peakListeners = stats.listeners;
  if (stats.topStation > peakStationListeners) peakStationListeners = stats.topStation;
  setGauge('presence:live_listeners', stats.listeners);
  setGauge('presence:live_stations', stats.stations);
  setGauge('presence:peak_listeners_1h', peakListeners);
  // The one that answers the actual question: has ANY single station ever had
  // enough people on it at once to clear MIN_PUBLIC_LISTENERS?
  setGauge('presence:peak_station_listeners_1h', peakStationListeners);
};

/** Boot wrapper: one interval sweeps both the presence store and the rate buckets. */
export const startPresenceSweeper = (intervalMs: number) => {
  const timer = setInterval(() => {
    sweepPresence();
    sweepBuckets();
    reportPresenceGauges();
  }, intervalMs);
  timer.unref?.();
  return timer;
};

/** Test seam. */
export const __resetPresencePeaks = () => {
  peakListeners = 0;
  peakStationListeners = 0;
  peakWindowStartedAt = 0;
};

/** Test seam. */
export const __resetRateLimits = () => buckets.clear();

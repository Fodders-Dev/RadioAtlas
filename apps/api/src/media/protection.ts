import type express from 'express';
import { appendAlert, bumpCounter, setGauge } from '../observabilityStore.js';

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type ProtectedRouteOptions = {
  routeName: 'metadata' | 'fetch';
  maxConcurrency: number;
  sharedMaxConcurrency: number;
  rateLimitPerWindow: number;
  rateLimitWindowMs: number;
};

export class MediaOverloadError extends Error {
  readonly retryAfterSec: number;

  constructor(message: string, retryAfterSec = 5) {
    super(message);
    this.name = 'MediaOverloadError';
    this.retryAfterSec = retryAfterSec;
  }
}

const clampPositiveInt = (value: number, fallback: number) =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;

const sharedState = {
  active: 0,
  maxActive: 10
};

const alertCooldowns = new Map<string, number>();

const maybeAlert = (key: string, title: string, detail: string) => {
  const now = Date.now();
  const previous = alertCooldowns.get(key) || 0;
  if (now - previous < 60_000) return;
  alertCooldowns.set(key, now);
  appendAlert({
    kind: 'server-error',
    title,
    detail,
    ts: now
  });
};

const pruneCache = <T,>(cache: Map<string, CacheEntry<T>>) => {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
};

const getClientIp = (req: express.Request) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0]!.trim();
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return forwarded[0].split(',')[0]!.trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
};

export class ProtectedMediaRoute<T> {
  private readonly routeName: ProtectedRouteOptions['routeName'];
  private readonly maxConcurrency: number;
  private readonly rateLimitPerWindow: number;
  private readonly rateLimitWindowMs: number;
  private readonly cache = new Map<string, CacheEntry<T>>();
  private readonly inflight = new Map<string, Promise<T>>();
  private readonly rateLimits = new Map<string, RateLimitBucket>();
  private active = 0;

  constructor(options: ProtectedRouteOptions) {
    this.routeName = options.routeName;
    this.maxConcurrency = clampPositiveInt(options.maxConcurrency, 4);
    this.rateLimitPerWindow = clampPositiveInt(options.rateLimitPerWindow, 120);
    this.rateLimitWindowMs = clampPositiveInt(options.rateLimitWindowMs, 60_000);
    sharedState.maxActive = clampPositiveInt(options.sharedMaxConcurrency, sharedState.maxActive);
    this.publishGauges();
  }

  private publishGauges() {
    setGauge(`media_inflight:${this.routeName}`, this.active);
    setGauge('media_inflight:shared', sharedState.active);
    setGauge(`media_limit:${this.routeName}`, this.maxConcurrency);
    setGauge('media_limit:shared', sharedState.maxActive);
  }

  private beginExecution() {
    this.active += 1;
    sharedState.active += 1;
    bumpCounter(`media_execution_started:${this.routeName}`);
    this.publishGauges();
  }

  private endExecution() {
    this.active = Math.max(0, this.active - 1);
    sharedState.active = Math.max(0, sharedState.active - 1);
    this.publishGauges();
  }

  private canStartExecution() {
    return this.active < this.maxConcurrency && sharedState.active < sharedState.maxActive;
  }

  checkRateLimit(req: express.Request) {
    const ip = getClientIp(req);
    const now = Date.now();
    const current = this.rateLimits.get(ip);
    if (!current || current.resetAt <= now) {
      this.rateLimits.set(ip, {
        count: 1,
        resetAt: now + this.rateLimitWindowMs
      });
      return null;
    }

    if (current.count >= this.rateLimitPerWindow) {
      const retryAfterSec = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      bumpCounter(`media_rate_limit:${this.routeName}`);
      maybeAlert(
        `media-rate-limit:${this.routeName}:${ip}`,
        `${this.routeName} rate limited`,
        `ip=${ip} retryAfter=${retryAfterSec}s`
      );
      return retryAfterSec;
    }

    current.count += 1;
    return null;
  }

  getCached(key: string) {
    pruneCache(this.cache);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return null;
    }
    bumpCounter(`media_cache_hit:${this.routeName}`);
    return entry.value;
  }

  setCached(key: string, value: T, ttlMs: number) {
    const normalizedTtl = clampPositiveInt(ttlMs, 1_000);
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + normalizedTtl
    });
  }

  async run(key: string, task: () => Promise<T>) {
    const existing = this.inflight.get(key);
    if (existing) {
      bumpCounter(`media_dedupe_hit:${this.routeName}`);
      return existing;
    }

    if (!this.canStartExecution()) {
      bumpCounter(`media_overload:${this.routeName}`);
      maybeAlert(
        `media-overload:${this.routeName}`,
        `${this.routeName} overloaded`,
        `routeActive=${this.active}/${this.maxConcurrency} sharedActive=${sharedState.active}/${sharedState.maxActive}`
      );
      throw new MediaOverloadError(`${this.routeName} is overloaded`);
    }

    this.beginExecution();
    const promise = (async () => {
      try {
        return await task();
      } finally {
        this.inflight.delete(key);
        this.endExecution();
      }
    })();

    this.inflight.set(key, promise);
    return promise;
  }
}

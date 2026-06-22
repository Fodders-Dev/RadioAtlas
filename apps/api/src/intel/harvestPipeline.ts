// Pure, DI'd metadata-harvest pipeline. No network, no DB, no clock of its own —
// every side effect is injected, so the whole thing is unit-testable. The manual
// script (scripts/harvestMetadata.mjs) wires the real /api/metadata fetch + the
// sqlite store into runHarvestBatch.

import type { StationIntelStore } from './stationIntelDb.js';

// ── 1. Parse "ARTIST - TITLE" ───────────────────────────────────────────────
// /api/metadata already cleans + filters placeholders and joins as "Artist -
// Title" (buildTrackTitle), so here we only need the split. Ported from the
// webapp trackTrust normaliser's cleanup (collapse whitespace, drop control
// chars, sane length) + the canonical " - " split (artist before the FIRST one).
// Control chars (< 0x20, DEL) or the unicode replacement char (mojibake) reject.
const hasUnsafeChar = (text: string): boolean => {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f || code === 0xfffd) return true;
  }
  return false;
};

export type ParsedTrack = { artist: string | null; title: string; raw: string };

export const parseTrackTitle = (value: string | null | undefined): ParsedTrack | null => {
  if (typeof value !== 'string') return null;
  const cleaned = value
    .replace(/\0/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+-\s+-\s+/g, ' - ')
    .trim();
  if (cleaned.length < 2 || cleaned.length > 200) return null;
  if (hasUnsafeChar(cleaned)) return null;
  if (!/[a-zа-яё0-9]/i.test(cleaned)) return null;

  const idx = cleaned.indexOf(' - ');
  if (idx > 0 && idx < cleaned.length - 3) {
    const artist = cleaned.slice(0, idx).trim();
    const title = cleaned.slice(idx + 3).trim();
    if (artist && title) return { artist, title, raw: cleaned };
  }
  return { artist: null, title: cleaned, raw: cleaned };
};

// ── 2. supports_metadata state machine ──────────────────────────────────────
// null = never checked, 0 = checked / no title, 1 = a real title was seen.
// Once a station has PROVEN it emits titles (1) it stays 1 even on a later empty
// pass (the title just wasn't playing that second); a station that has only ever
// shown nothing is 0.
export const nextSupportsMetadata = (current: 0 | 1 | null, hadTitle: boolean): 0 | 1 => {
  if (hadTitle) return 1;
  return current === 1 ? 1 : 0;
};

// ── 3. Batch selection (skip dead, rank by quality, cap) ────────────────────
export type HarvestCandidate = {
  stationUuid: string;
  urlResolved: string;
  lastcheckok?: 0 | 1 | null;
  quality?: number;
};

// A reachable http(s) stream only. lastcheckok===0 is a confirmed-dead station —
// probing it would be wasted load AND impolite to the origin; skip it. Unknown
// (null/undefined) is given a chance.
const isProbeable = (c: HarvestCandidate): boolean => {
  if (c.lastcheckok === 0) return false;
  if (!c.urlResolved) return false;
  return /^https?:\/\//i.test(c.urlResolved);
};

export const selectHarvestBatch = (
  candidates: HarvestCandidate[],
  options: { limit: number }
): HarvestCandidate[] => {
  const limit = Math.max(0, Math.floor(options.limit));
  return candidates
    .filter(isProbeable)
    .sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0))
    .slice(0, limit);
};

// A coarse quality proxy from the catalog artifact (which has bitrate/codec but
// NOT votes). reach dominates; lossless/AAC beat MP3; higher bitrate is better.
const CODEC_BONUS: Record<string, number> = { flac: 30, aac: 20, 'aac+': 20, ogg: 15, mp3: 10 };
export const harvestQualityScore = (station: {
  lastcheckok?: 0 | 1 | null;
  bitrate?: number | null;
  codec?: string | null;
  votes?: number | null;
}): number => {
  const reach = station.lastcheckok === 1 ? 1000 : station.lastcheckok === 0 ? -1000 : 0;
  const codec = CODEC_BONUS[String(station.codec || '').toLowerCase()] || 0;
  const bitrate = Math.min(40, Math.max(0, Number(station.bitrate) || 0) / 8);
  const votes = Math.log1p(Math.max(0, Number(station.votes) || 0)) * 5;
  return reach + codec + bitrate + votes;
};

// ── 4. Circuit breaker (consecutive 429/5xx → trip) ─────────────────────────
export class CircuitBreaker {
  private consecutive = 0;
  tripped = false;
  constructor(private readonly limit: number) {}
  recordSuccess(): void {
    this.consecutive = 0;
  }
  // Returns true once it trips.
  recordFailure(): boolean {
    this.consecutive += 1;
    if (this.consecutive >= this.limit) this.tripped = true;
    return this.tripped;
  }
}

// ── 5. The runner ───────────────────────────────────────────────────────────
export type MetadataFetchResult = {
  status: number;
  title: string | null;
  retryAfterMs?: number;
};

export type HarvestDeps = {
  // DI'd HTTP call to /api/metadata?url=… (returns status + cleaned title).
  fetchMetadata: (urlResolved: string) => Promise<MetadataFetchResult>;
  store: Pick<
    StationIntelStore,
    'recordObservation' | 'getSupportsMetadata' | 'setSupportsMetadata'
  >;
  now: () => number;
  concurrency?: number;
  perRequestPauseMs?: number;
  consecutiveFailLimit?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
};

export type HarvestSummary = {
  processed: number;
  withTitle: number;
  withoutTitle: number;
  recorded: number;
  failures: number;
  tripped: boolean;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const isRateLimit = (status: number) => status === 429;
const isServerError = (status: number) => status >= 500 && status < 600;

export const runHarvestBatch = async (
  batch: HarvestCandidate[],
  deps: HarvestDeps
): Promise<HarvestSummary> => {
  const concurrency = Math.max(1, deps.concurrency ?? 2);
  const pause = Math.max(0, deps.perRequestPauseMs ?? 0);
  const sleep = deps.sleep ?? defaultSleep;
  const log = deps.log ?? (() => {});
  const breaker = new CircuitBreaker(Math.max(1, deps.consecutiveFailLimit ?? 8));

  const summary: HarvestSummary = {
    processed: 0,
    withTitle: 0,
    withoutTitle: 0,
    recorded: 0,
    failures: 0,
    tripped: false
  };

  let cursor = 0;
  const next = (): HarvestCandidate | null => {
    if (breaker.tripped || cursor >= batch.length) return null;
    return batch[cursor++] ?? null;
  };

  const worker = async () => {
    for (let station = next(); station; station = next()) {
      let result: MetadataFetchResult;
      try {
        result = await deps.fetchMetadata(station.urlResolved);
      } catch (error) {
        summary.failures += 1;
        if (breaker.recordFailure()) {
          summary.tripped = true;
          log(`circuit breaker tripped after consecutive failures (fetch error)`);
        }
        if (pause) await sleep(pause);
        continue;
      }

      if (isRateLimit(result.status) || isServerError(result.status)) {
        summary.failures += 1;
        // Respect Retry-After on a 429 before the breaker decides.
        if (isRateLimit(result.status) && result.retryAfterMs) await sleep(result.retryAfterMs);
        if (breaker.recordFailure()) {
          summary.tripped = true;
          log(`circuit breaker tripped after ${deps.consecutiveFailLimit ?? 8} consecutive 429/5xx — stopping`);
        }
        if (pause) await sleep(pause);
        continue;
      }

      breaker.recordSuccess();
      summary.processed += 1;
      const parsed = result.status === 200 ? parseTrackTitle(result.title) : null;
      const hadTitle = Boolean(parsed);
      if (hadTitle && parsed) {
        summary.withTitle += 1;
        const recorded = deps.store.recordObservation({
          stationUuid: station.stationUuid,
          artist: parsed.artist,
          title: parsed.title,
          rawTitle: parsed.raw,
          observedAt: deps.now()
        });
        if (recorded) summary.recorded += 1;
      } else {
        summary.withoutTitle += 1;
      }
      const current = deps.store.getSupportsMetadata(station.stationUuid);
      deps.store.setSupportsMetadata(
        station.stationUuid,
        nextSupportsMetadata(current, hadTitle),
        deps.now(),
        hadTitle ? deps.now() : null
      );
      if (pause) await sleep(pause);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return summary;
};

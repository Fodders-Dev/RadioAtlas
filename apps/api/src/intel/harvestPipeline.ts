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

// HLS / stream-manifest attribute leaking in place of a track title — e.g.
// AUDIO="program_audio", CODECS="mp4a.40.2", BANDWIDTH=128000. An uppercase
// KEY= token or any key="…" shape is never a song; reject it.
const looksLikeManifestAttr = (text: string): boolean => /[A-Z][A-Z0-9_-]{2,}=|="/.test(text);

// A bare numeric ident ("6464", "1234567") is a station counter, not a song.
// Only digits + separators (no letters, no other symbols) → reject; a symbolic
// title like "2 + 2 = 5" keeps its + / = and survives.
const isCounterIdent = (text: string): boolean => /^[\d\s.\-]+$/.test(text);

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
  if (looksLikeManifestAttr(cleaned)) return null;

  const idx = cleaned.indexOf(' - ');
  if (idx > 0 && idx < cleaned.length - 3) {
    const artist = cleaned.slice(0, idx).trim();
    const title = cleaned.slice(idx + 3).trim();
    if (artist && title) {
      // "6464 - 6464" / "Jingle - Jingle": a token repeated on both sides is a
      // station counter / ident, not an artist+title pair.
      if (artist.toLowerCase() === title.toLowerCase()) return null;
      // "04 - Night Comes On": a pure 1–3 digit "artist" is a TRACK NUMBER, not
      // an artist — drop it and keep the title (rather than poisoning the
      // artist index with "04"). A 4-digit value (e.g. a year) is left intact.
      if (!/^\d{1,3}$/.test(artist)) {
        return { artist, title, raw: cleaned };
      }
      return isCounterIdent(title) ? null : { artist: null, title, raw: cleaned };
    }
  }
  if (isCounterIdent(cleaned)) return null;
  return { artist: null, title: cleaned, raw: cleaned };
};

// ── 1b. Reject non-artist "artists" before they pollute the index ────────────
// The structural "ARTIST - TITLE" split can't tell a real performer from a
// station ident the broadcaster dropped in the artist slot («RADIO BOB - The
// Best Rock», «SUNSHINE LIVE - …»), a placeholder («Unknown - …»), or a jingle —
// these dominated the early station_artist_index. We keep the OBSERVATION (the
// title is still useful) but drop the artist so "which stations play X" stays
// real. The caller passes the station's own name to catch the ident-leak case.
const NON_ARTIST_MARKERS = new Set([
  'unknown', 'unknown artist', 'n a', 'na', 'none', 'no artist', 'nil',
  'on air', 'onair', 'live', 'advert', 'advertisement', 'ad', 'ads',
  'jingle', 'commercial', 'commercial break', 'station id', 'id', 'ident',
  'various', 'various artists', 'va', 'top 40', 'now playing'
]);

const normalizeIdent = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[!?.,:;'"`«»()|/\\–—_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const isNonArtistName = (artist: string, stationName?: string | null): boolean => {
  const a = normalizeIdent(artist);
  if (!a) return true;
  if (NON_ARTIST_MARKERS.has(a)) return true;
  // A URL / domain in the artist slot is a stream ident, never a performer.
  if (/(^|\s)(www\.|https?:\/\/)|\.(com|net|fm|org|ru|de|fr|nl)(\b|\/)/i.test(artist)) return true;
  // A station that put its OWN name in the artist slot — the dominant junk
  // («RADIO BOB», «SUNSHINE LIVE», «90s90s», «NPO Radio 1»). Exact match only, so
  // a real performer can never be dropped by a loose substring.
  if (stationName) {
    const s = normalizeIdent(stationName);
    if (s && a === s) return true;
  }
  return false;
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
  // Catalog name — used only to reject the station's own ident leaking into the
  // artist slot (see isNonArtistName). Optional so older callers/tests still work.
  name?: string | null;
  urlResolved: string;
  lastcheckok?: 0 | 1 | null;
  quality?: number;
  // epoch ms of the last probe (from station_meta_state). null/undefined = never
  // harvested → sorts FIRST in 'stale' order.
  lastHarvestedAt?: number | null;
};

export type HarvestOrder = 'quality' | 'stale';

// A reachable http(s) stream only. lastcheckok===0 is a confirmed-dead station —
// probing it would be wasted load AND impolite to the origin; skip it. Unknown
// (null/undefined) is given a chance.
const isProbeable = (c: HarvestCandidate): boolean => {
  if (c.lastcheckok === 0) return false;
  if (!c.urlResolved) return false;
  return /^https?:\/\//i.test(c.urlResolved);
};

// Never-harvested stations sort before everyone (sentinel -Infinity); avoids the
// `(-Infinity) - (-Infinity) = NaN` trap of a plain subtraction comparator.
const staleKey = (c: HarvestCandidate): number =>
  c.lastHarvestedAt == null ? Number.NEGATIVE_INFINITY : c.lastHarvestedAt;

export const selectHarvestBatch = (
  candidates: HarvestCandidate[],
  options: { limit: number; order?: HarvestOrder }
): HarvestCandidate[] => {
  const limit = Math.max(0, Math.floor(options.limit));
  const order = options.order ?? 'quality';
  const probeable = candidates.filter(isProbeable);
  // 'stale' = least-recently-harvested-first (never-probed → oldest), so each run
  // takes a FRESH slice and the whole reachable catalog is covered over N runs.
  // Array.sort is stable → equal keys keep input order → idempotent.
  const sorted =
    order === 'stale'
      ? probeable.sort((a, b) => {
          const ka = staleKey(a);
          const kb = staleKey(b);
          return ka === kb ? 0 : ka < kb ? -1 : 1;
        })
      : probeable.sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0));
  return sorted.slice(0, limit);
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
  > &
    Partial<Pick<StationIntelStore, 'markProbeFailure'>>;
  now: () => number;
  concurrency?: number;
  perRequestPauseMs?: number;
  // GLOBAL minimum spacing between ANY two requests (across all workers) — the
  // ToS-at-scale rate floor. perRequestPauseMs is the additional per-worker
  // cooldown after each request.
  minRequestIntervalMs?: number;
  consecutiveFailLimit?: number;
  // Station-level probe failures get their own, much larger budget: a run of
  // dead streams is ordinary harvesting, not an outage. It still has a ceiling
  // so a genuine network-wide failure stops the run instead of grinding through
  // the whole batch.
  stationFailLimit?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
  // Routed to a LOUD channel (console.error) by the script so a tripped breaker
  // stands out in the pm2 logs. Falls back to log when not provided.
  onAlert?: (msg: string) => void;
};

export type HarvestSummary = {
  processed: number;
  withTitle: number;
  withoutTitle: number;
  recorded: number;
  failures: number;
  // Subset of `failures` caused by an individual station rather than upstream.
  stationFailures: number;
  tripped: boolean;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/**
 * The harvest script reports "the fetch threw" (DNS failure, connection
 * refused, timeout on a dead stream) with this synthetic status. It is NOT an
 * upstream HTTP status and must never be counted as one.
 *
 * It used to fall inside the 5xx range, so eight dead streams in a row looked
 * exactly like our own API failing and tripped the breaker. Combined with the
 * fact that a failed station was never stamped, that deadlocked the harvester:
 * unstamped stations sort first in 'stale' order, so every hourly run selected
 * the same broken head of the queue, tripped after 8, recorded nothing, and
 * left the queue identical for the next run. Production sat at
 * `processed=0 failures=8 tripped=true` for hours.
 */
export const STATION_PROBE_FAILED_STATUS = 599;

const isRateLimit = (status: number) => status === 429;
const isServerError = (status: number) =>
  status >= 500 && status < 600 && status !== STATION_PROBE_FAILED_STATUS;

export const runHarvestBatch = async (
  batch: HarvestCandidate[],
  deps: HarvestDeps
): Promise<HarvestSummary> => {
  const concurrency = Math.max(1, deps.concurrency ?? 2);
  const pause = Math.max(0, deps.perRequestPauseMs ?? 0);
  const minInterval = Math.max(0, deps.minRequestIntervalMs ?? 0);
  const sleep = deps.sleep ?? defaultSleep;
  const failLimit = Math.max(1, deps.consecutiveFailLimit ?? 8);
  const stationFailLimit = Math.max(1, deps.stationFailLimit ?? failLimit * 5);
  const alert = deps.onAlert ?? deps.log ?? (() => {});
  // Two budgets, because the two failures mean different things. Upstream
  // pressure (429/5xx from our own API) means back off NOW. A station that will
  // not answer means move on to the next station.
  const breaker = new CircuitBreaker(failLimit);
  const stationBreaker = new CircuitBreaker(stationFailLimit);

  const summary: HarvestSummary = {
    processed: 0,
    withTitle: 0,
    withoutTitle: 0,
    recorded: 0,
    failures: 0,
    stationFailures: 0,
    tripped: false
  };

  // Global rate floor: every request claims the next time slot so ANY two
  // requests (across all workers) are ≥ minInterval apart — ToS-at-scale safety.
  let nextSlot = 0;
  const acquireSlot = async () => {
    if (!minInterval) return;
    const slot = Math.max(deps.now(), nextSlot);
    nextSlot = slot + minInterval;
    const wait = slot - deps.now();
    if (wait > 0) await sleep(wait);
  };

  const trip = (reason: string) => {
    summary.tripped = true;
    alert(`[HARVEST-ALERT] circuit breaker tripped after ${failLimit} consecutive failures (${reason}) — stopping the run`);
  };

  let cursor = 0;
  const next = (): HarvestCandidate | null => {
    if (breaker.tripped || stationBreaker.tripped || cursor >= batch.length) return null;
    return batch[cursor++] ?? null;
  };

  // A station we could not reach is still a station we TRIED. Stamping it is
  // what keeps the stale-ordered queue moving; without it the same unreachable
  // head is re-selected on every run.
  const noteStationFailure = (station: HarvestCandidate, reason: string) => {
    summary.failures += 1;
    summary.stationFailures += 1;
    deps.store.markProbeFailure?.(station.stationUuid, deps.now());
    if (stationBreaker.recordFailure()) {
      summary.tripped = true;
      alert(
        `[HARVEST-ALERT] circuit breaker tripped after ${stationFailLimit} consecutive station failures (${reason}) — the network or every selected stream is unreachable`
      );
    }
  };

  const worker = async () => {
    for (let station = next(); station; station = next()) {
      await acquireSlot();
      let result: MetadataFetchResult;
      try {
        result = await deps.fetchMetadata(station.urlResolved);
      } catch {
        noteStationFailure(station, 'fetch error');
        if (pause) await sleep(pause);
        continue;
      }

      if (result.status === STATION_PROBE_FAILED_STATUS) {
        noteStationFailure(station, 'stream unreachable');
        if (pause) await sleep(pause);
        continue;
      }

      if (isRateLimit(result.status) || isServerError(result.status)) {
        summary.failures += 1;
        // Respect Retry-After on a 429 before the breaker decides.
        if (isRateLimit(result.status) && result.retryAfterMs) await sleep(result.retryAfterMs);
        // Upstream pushed back: stamp the station too, so a run cut short here
        // does not re-present the same head next time.
        deps.store.markProbeFailure?.(station.stationUuid, deps.now());
        if (breaker.recordFailure()) trip(`${result.status}`);
        if (pause) await sleep(pause);
        continue;
      }

      breaker.recordSuccess();
      stationBreaker.recordSuccess();
      summary.processed += 1;
      const parsed = result.status === 200 ? parseTrackTitle(result.title) : null;
      const hadTitle = Boolean(parsed);
      if (hadTitle && parsed) {
        summary.withTitle += 1;
        // Keep the observation (title) but drop a non-artist (station ident /
        // jingle / placeholder) so it never enters the artist index.
        const artist =
          parsed.artist && !isNonArtistName(parsed.artist, station.name) ? parsed.artist : null;
        const recorded = deps.store.recordObservation({
          stationUuid: station.stationUuid,
          artist,
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

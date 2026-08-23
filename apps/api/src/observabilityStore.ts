import { access, copyFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentRunSummary } from './ai/types.js';

export type SlowRequestEntry = {
  path: string;
  method: string;
  status: number;
  durationMs: number;
  ts: number;
};

export type ClientEventEntry = {
  name: string;
  source: 'client' | 'server';
  detail: string | null;
  meta: Record<string, unknown> | null;
  ts: number;
};

export type RequestSampleEntry = {
  path: string;
  method: string;
  status: number;
  durationMs: number;
  ts: number;
};

export type ObservabilityAlert = {
  kind: 'slow-request' | 'server-error' | 'client-event';
  title: string;
  detail: string;
  ts: number;
};

export type AgentRunTraceEntry = AgentRunSummary & {
  surface: 'miniapp' | 'telegram';
  promptTokens: number;
  completionTokens: number;
  ts: number;
};

type CounterMap = Map<string, number>;
type GaugeMap = Map<string, number>;

/**
 * One hour of counter INCREMENTS, not totals.
 *
 * Counters here are cumulative and the store now survives deploys, which makes
 * the totals unreadable as a rate: production showed 248 play_attempt against
 * 38 play_success and 1 play_superseded, a 15% success rate that is really the
 * sum of a pre-fix era when supersedes were not counted at all and a post-fix
 * era with almost no traffic in it. Nobody can subtract those by eye. Storing
 * per-hour increments lets `/observability` answer "in the last hour" and "in
 * the last day", which is the question the runbook actually asks.
 *
 * Increments, not snapshots, because an idle hour then costs ~20 bytes.
 */
export type CounterBucket = {
  /** Epoch hour: Math.floor(ts / 3_600_000). */
  hour: number;
  counters: Record<string, number>;
};

type PersistedObservabilityState = {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  slowRequests: SlowRequestEntry[];
  requestSamples: RequestSampleEntry[];
  clientEvents: ClientEventEntry[];
  agentRuns?: AgentRunTraceEntry[];
  alerts: ObservabilityAlert[];
  counterBuckets?: CounterBucket[];
  updatedAt: number | null;
};

const MAX_SLOW_REQUESTS = 40;
const MAX_REQUEST_SAMPLES = 300;
const MAX_CLIENT_EVENTS = 80;
const MAX_AGENT_RUNS = 80;
const MAX_ALERTS = 40;
const FLUSH_DELAY_MS = 250;
const ENTRY_RETENTION_MS = Number(process.env.OBSERVABILITY_RETENTION_MS || 1000 * 60 * 60 * 24 * 7);
const STORE_BACKUP_COUNT = Math.max(0, Number(process.env.OBSERVABILITY_BACKUP_COUNT || 2));
const alertWebhook = String(process.env.OBSERVABILITY_ALERT_WEBHOOK || '').trim();
const defaultStorePath = resolve(
  fileURLToPath(new URL('../../../data/observability/metrics.json', import.meta.url))
);
const storePath = resolve(process.env.OBSERVABILITY_STORE_PATH || defaultStorePath);

/**
 * A metrics file that lives inside `.../releases/<sha>/...` dies with its
 * release. Every deploy boots the API against an empty store, and
 * `prune_old_releases` deletes the previous ones outright - so a counter you
 * were asked to WATCH over time silently only ever describes the window since
 * the last push. Verified on production 2026-08-15: three concurrent release
 * directories held three disjoint metric stores, and the AI counters
 * (`ai_agent_run:*`, `ai_model_error:*`) existed in exactly one of them.
 *
 * Production must point `OBSERVABILITY_STORE_PATH` at the shared volume, the
 * same way `STATION_INTEL_DB_PATH` already does (see `ecosystem.config.cjs`).
 * This predicate exists so the mistake cannot silently return.
 */
export const isEphemeralStorePath = (candidate: string): boolean =>
  /[\\/]releases[\\/][^\\/]+[\\/]/.test(String(candidate || ''));

export const observabilityStorePath = storePath;

const counters: CounterMap = new Map();
const gauges: GaugeMap = new Map();
const counterBuckets: CounterBucket[] = [];
const slowRequests: SlowRequestEntry[] = [];
const requestSamples: RequestSampleEntry[] = [];
const clientEvents: ClientEventEntry[] = [];
const agentRuns: AgentRunTraceEntry[] = [];
const alerts: ObservabilityAlert[] = [];

let hydrated = false;
let hydratePromise: Promise<void> | null = null;
let flushTimer: NodeJS.Timeout | null = null;
let updatedAt: number | null = null;

const trimList = <T,>(target: T[], maxItems: number) => {
  target.splice(maxItems);
};

/** 24 hours of history plus the hour in progress. */
const MAX_COUNTER_BUCKETS = 25;
const HOUR_MS = 3_600_000;

/**
 * Adds an increment to the bucket for `now`'s hour, opening it if needed and
 * dropping anything older than the retention window. Exported for its own test:
 * everything interesting about windowed counters is in here and in
 * `summariseCounterWindows`, so both are pure and take their clock as an
 * argument rather than reading it.
 */
export const recordBucketIncrement = (
  buckets: CounterBucket[],
  key: string,
  amount: number,
  now: number
) => {
  const hour = Math.floor(now / HOUR_MS);
  let bucket = buckets.length ? buckets[buckets.length - 1] : undefined;
  if (!bucket || bucket.hour !== hour) {
    // An out-of-order timestamp (a clock step back) must not open a bucket
    // BEFORE one that already exists, or the window sums would double-count.
    if (bucket && hour < bucket.hour) {
      bucket.counters[key] = (bucket.counters[key] || 0) + amount;
      return;
    }
    bucket = { hour, counters: {} };
    buckets.push(bucket);
    while (buckets.length > MAX_COUNTER_BUCKETS) buckets.shift();
  }
  bucket.counters[key] = (bucket.counters[key] || 0) + amount;
};

/**
 * Sums the buckets covering the last `hours` hours. Returns only the counters
 * that actually moved, so an idle window is an empty object rather than 250
 * zeroes.
 */
export type CounterWindow = { since: number; counters: Record<string, number> };

const sumWindow = (buckets: CounterBucket[], currentHour: number, hours: number): CounterWindow => {
  const firstHour = currentHour - (hours - 1);
  const totals: Record<string, number> = {};
  let covered = false;
  for (const bucket of buckets) {
    if (bucket.hour < firstHour || bucket.hour > currentHour) continue;
    covered = true;
    for (const [key, value] of Object.entries(bucket.counters)) {
      totals[key] = (totals[key] || 0) + value;
    }
  }
  return {
    // The window starts at the top of its first hour, not `now - hours`,
    // because that is what the buckets actually cover.
    since: covered ? firstHour * HOUR_MS : currentHour * HOUR_MS,
    counters: totals
  };
};

export const summariseCounterWindows = (buckets: CounterBucket[], now: number) => {
  const currentHour = Math.floor(now / HOUR_MS);
  return {
    last1h: sumWindow(buckets, currentHour, 1),
    last24h: sumWindow(buckets, currentHour, 24)
  };
};

const pruneByAge = <T extends { ts: number }>(target: T[]) => {
  const cutoff = Date.now() - ENTRY_RETENTION_MS;
  for (let index = target.length - 1; index >= 0; index -= 1) {
    const entry = target[index];
    if (entry && entry.ts < cutoff) {
      target.splice(index, 1);
    }
  }
};

const backupPath = (index: number) => `${storePath}.${index}.bak`;

/**
 * Rotation used to `rename()` the live file into `.1.bak` and only then write a
 * new one, which leaves a window with NO store file at all — and it ran on
 * every flush, i.e. several times a second under load. Copy instead, after the
 * new state is safely in place, and not more often than this.
 */
const BACKUP_INTERVAL_MS = Math.max(0, Number(process.env.OBSERVABILITY_BACKUP_INTERVAL_MS || 60_000));
let lastBackupAt = 0;

const rotateStoreBackups = async (now: number) => {
  if (STORE_BACKUP_COUNT <= 0) return;
  if (now - lastBackupAt < BACKUP_INTERVAL_MS) return;
  try {
    await access(storePath);
  } catch {
    return;
  }
  lastBackupAt = now;

  for (let index = STORE_BACKUP_COUNT; index >= 2; index -= 1) {
    try {
      await copyFile(backupPath(index - 1), backupPath(index));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== 'ENOENT') throw error;
    }
  }
  await copyFile(storePath, backupPath(1));
};

let pendingWriteId = 0;

const scheduleFlush = () => {
  updatedAt = Date.now();
  if (flushTimer) {
    clearTimeout(flushTimer);
  }
  flushTimer = setTimeout(() => {
    flushTimer = null;
    // Chained, not fired-and-forgotten. The debounce only spaces out the START
    // of a flush; a slow write plus a fresh burst of counters used to leave two
    // flushes writing the same file at once, which is how they raced over the
    // temp name. Serialising also means the last one to run is the one that
    // wins, which is what a "latest state" snapshot wants anyway.
    void flushState().catch((error) => {
      console.error('[Observability] failed to persist state', error);
    });
  }, FLUSH_DELAY_MS);
};

/**
 * Read the store, falling back to the rotated backups. The backups existed
 * before this and were never read — so when the live file came back truncated
 * after a mid-write restart, the process started from nothing and then
 * overwrote the only good copies it had. An unreadable live file is kept aside
 * as `.corrupt` rather than silently replaced, so the next flush cannot destroy
 * the evidence.
 */
const readPersistedState = async (): Promise<PersistedObservabilityState | null> => {
  const candidates = [storePath];
  for (let index = 1; index <= STORE_BACKUP_COUNT; index += 1) candidates.push(backupPath(index));

  let liveFileWasCorrupt = false;
  for (const candidate of candidates) {
    let raw: string;
    try {
      raw = await readFile(candidate, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== 'ENOENT') {
        console.error(`[Observability] cannot read ${candidate}`, error);
      }
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as PersistedObservabilityState;
      if (candidate !== storePath) {
        console.error(`[Observability] recovered metrics from ${candidate} after an unreadable store`);
      }
      return parsed;
    } catch (error) {
      if (candidate === storePath) liveFileWasCorrupt = true;
      console.error(`[Observability] ${candidate} is not valid JSON`, error);
    }
  }

  if (liveFileWasCorrupt) {
    try {
      await rename(storePath, `${storePath}.corrupt`);
      console.error(`[Observability] kept the unreadable store as ${storePath}.corrupt`);
    } catch (error) {
      console.error('[Observability] could not preserve the unreadable store', error);
    }
  }
  return null;
};

const loadPersistedState = async () => {
  if (hydrated) return;
  if (!hydratePromise) {
    hydratePromise = (async () => {
      try {
        const parsed = await readPersistedState();
        if (!parsed) {
          hydrated = true;
          return;
        }
        Object.entries(parsed.counters || {}).forEach(([key, value]) => {
          if (typeof value === 'number' && Number.isFinite(value)) {
            counters.set(key, value);
          }
        });
        Object.entries(parsed.gauges || {}).forEach(([key, value]) => {
          if (typeof value === 'number' && Number.isFinite(value)) {
            gauges.set(key, value);
          }
        });
        // Absent in stores written before hourly buckets existed, and that is
        // the normal case on the first boot after this ships: the windows are
        // simply empty until an hour of traffic has accumulated.
        counterBuckets.splice(
          0,
          counterBuckets.length,
          ...(parsed.counterBuckets || [])
            .filter(
              (bucket): bucket is CounterBucket =>
                Boolean(bucket) &&
                typeof bucket.hour === 'number' &&
                Number.isFinite(bucket.hour) &&
                Boolean(bucket.counters)
            )
            .slice(-MAX_COUNTER_BUCKETS)
        );
        slowRequests.splice(0, slowRequests.length, ...(parsed.slowRequests || []).slice(0, MAX_SLOW_REQUESTS));
        requestSamples.splice(
          0,
          requestSamples.length,
          ...(parsed.requestSamples || []).slice(0, MAX_REQUEST_SAMPLES)
        );
        clientEvents.splice(0, clientEvents.length, ...(parsed.clientEvents || []).slice(0, MAX_CLIENT_EVENTS));
        agentRuns.splice(0, agentRuns.length, ...(parsed.agentRuns || []).slice(0, MAX_AGENT_RUNS));
        alerts.splice(0, alerts.length, ...(parsed.alerts || []).slice(0, MAX_ALERTS));
        pruneByAge(slowRequests);
        pruneByAge(requestSamples);
        pruneByAge(clientEvents);
        pruneByAge(agentRuns);
        pruneByAge(alerts);
        updatedAt = parsed.updatedAt ?? null;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException | undefined)?.code;
        if (code !== 'ENOENT') {
          console.error('[Observability] failed to hydrate persisted state', error);
        }
      } finally {
        hydrated = true;
      }
    })();
  }
  await hydratePromise;
};

/**
 * The store has exactly one writer, whoever asks. Serialising only inside
 * `scheduleFlush` left every other caller — a shutdown hook, a test, a future
 * "flush now" — free to collide, and two writers is what produced
 * `ENOENT: rename ...metrics.json.tmp` in production. Queue here and the
 * property holds for everyone, on every platform: Linux renames atomically,
 * Windows raises EPERM when two renames target the same destination at once.
 */
let writeChain: Promise<void> = Promise.resolve();

const flushState = async (): Promise<void> => {
  const run = writeChain.then(
    () => writeStateToDisk(),
    () => writeStateToDisk()
  );
  writeChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
};

const writeStateToDisk = async () => {
  await loadPersistedState();
  pruneByAge(slowRequests);
  pruneByAge(requestSamples);
  pruneByAge(clientEvents);
  pruneByAge(agentRuns);
  pruneByAge(alerts);
  trimList(slowRequests, MAX_SLOW_REQUESTS);
  trimList(requestSamples, MAX_REQUEST_SAMPLES);
  trimList(clientEvents, MAX_CLIENT_EVENTS);
  trimList(agentRuns, MAX_AGENT_RUNS);
  trimList(alerts, MAX_ALERTS);
  await mkdir(dirname(storePath), { recursive: true });
  const payload: PersistedObservabilityState = {
    counters: Object.fromEntries(counters.entries()),
    gauges: Object.fromEntries(gauges.entries()),
    slowRequests,
    requestSamples,
    clientEvents,
    agentRuns,
    alerts,
    counterBuckets,
    updatedAt
  };
  // Write-then-rename, because a plain writeFile is not atomic and this store
  // is no longer disposable. Production, 2026-08-15: pm2 restarted the API for
  // exceeding max_memory_restart WHILE a flush was in flight, the next boot
  // read a truncated file (`Unexpected end of JSON input`), hydration failed,
  // and the process then wrote its own near-empty state over everything that
  // had accumulated. rename(2) is atomic on POSIX, so a reader sees either the
  // whole previous file or the whole new one, and a process killed mid-write
  // leaves the previous one intact.
  // Unique per write. A shared `<store>.tmp` looked harmless right up until two
  // flushes overlapped in production: the first renamed the file away and the
  // second failed with `ENOENT: rename ...metrics.json.tmp`. Exactly the defect
  // the catalogue snapshot had, in the code that was written to fix it.
  pendingWriteId += 1;
  const pendingPath = `${storePath}.${process.pid}.${pendingWriteId}.tmp`;
  try {
    await writeFile(pendingPath, JSON.stringify(payload, null, 2), 'utf8');
    await rename(pendingPath, storePath);
  } catch (error) {
    await unlink(pendingPath).catch(() => {});
    throw error;
  }
  await rotateStoreBackups(Date.now());
};

const sendAlertWebhook = async (alert: ObservabilityAlert) => {
  if (!alertWebhook) return;
  try {
    await fetch(alertWebhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(alert)
    });
  } catch (error) {
    console.error('[Observability] failed to send alert webhook', error);
  }
};

const pushAlert = (alert: ObservabilityAlert) => {
  alerts.unshift(alert);
  trimList(alerts, MAX_ALERTS);
  scheduleFlush();
  void sendAlertWebhook(alert);
};

/**
 * Force a write now. Exists so the concurrency contract can be tested for real:
 * the debounced path only spaces out when a flush STARTS, and the production
 * failure (`ENOENT: rename ...metrics.json.tmp`) needed two of them writing at
 * once — which no amount of counter-bumping reproduces reliably from outside.
 */
export const flushObservabilityStore = () => flushState();

export const hydrateObservabilityStore = async () => {
  await loadPersistedState();
};

/**
 * A ceiling on how many DISTINCT counters may exist, because path normalisation
 * is a list somebody has to remember to extend and one day will not.
 *
 * Every key costs an entry here plus up to MAX_COUNTER_BUCKETS hourly buckets,
 * and the whole store is serialised to disk on every flush. Production was found
 * on 2026-08-23 carrying one counter per station whose scene had been fetched —
 * harmless at six, a memory and disk problem at 46 048, which is what it becomes
 * the day people actually browse.
 *
 * New keys are REFUSED rather than old ones evicted. These are cumulative
 * totals that people reconcile against each other (play_attempt against
 * play_success against play_superseded); silently dropping one to make room
 * would turn a number somebody trusts into a lie. Refusing is visible, and the
 * refusals are themselves counted.
 */
const MAX_COUNTER_KEYS = 2_000;
const COUNTER_OVERFLOW_KEY = 'observability:counter_keys_refused';

export const bumpCounter = (key: string, amount = 1) => {
  if (
    key !== COUNTER_OVERFLOW_KEY &&
    !counters.has(key) &&
    counters.size >= MAX_COUNTER_KEYS
  ) {
    bumpCounter(COUNTER_OVERFLOW_KEY, 1);
    return;
  }
  counters.set(key, (counters.get(key) || 0) + amount);
  recordBucketIncrement(counterBuckets, key, amount, Date.now());
  scheduleFlush();
};

/** Test seam: the ceiling is only observable through behaviour otherwise. */
export const counterKeyCount = () => counters.size;

export const appendSlowRequest = (entry: SlowRequestEntry) => {
  slowRequests.unshift(entry);
  trimList(slowRequests, MAX_SLOW_REQUESTS);
  scheduleFlush();
};

export const appendRequestSample = (entry: RequestSampleEntry) => {
  requestSamples.unshift(entry);
  trimList(requestSamples, MAX_REQUEST_SAMPLES);
  scheduleFlush();
};

export const appendClientEvent = (entry: ClientEventEntry) => {
  clientEvents.unshift(entry);
  trimList(clientEvents, MAX_CLIENT_EVENTS);
  scheduleFlush();
  if (
    entry.name === 'webamp_boot_failed' ||
    entry.name === 'hls_error' ||
    entry.name === 'session_sync_error'
  ) {
    pushAlert({
      kind: 'client-event',
      title: entry.name,
      detail: entry.detail || entry.name,
      ts: entry.ts
    });
  }
};

export const appendAgentRun = (entry: AgentRunTraceEntry) => {
  agentRuns.unshift(entry);
  trimList(agentRuns, MAX_AGENT_RUNS);
  scheduleFlush();
};

export const appendAlert = (alert: ObservabilityAlert) => {
  pushAlert(alert);
};

export const setGauge = (key: string, value: number) => {
  if (!Number.isFinite(value)) return;
  gauges.set(key, value);
  scheduleFlush();
};

export const adjustGauge = (key: string, delta: number) => {
  const current = gauges.get(key) || 0;
  setGauge(key, current + delta);
};

const quantile = (values: number[], q: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1));
  return sorted[index] || 0;
};

const buildLatencySummary = () => {
  const groups = new Map<string, number[]>();
  requestSamples.forEach((sample) => {
    const key = `${sample.method} ${sample.path}`;
    const values = groups.get(key) || [];
    values.push(sample.durationMs);
    groups.set(key, values);
  });
  return Array.from(groups.entries())
    .sort((left, right) => right[1].length - left[1].length)
    .map(([route, values]) => ({
      route,
      count: values.length,
      p50: quantile(values, 0.5),
      p95: quantile(values, 0.95),
      p99: quantile(values, 0.99)
    }));
};

export const getObservabilitySnapshot = () => ({
  counters: Object.fromEntries(counters.entries()),
  gauges: Object.fromEntries(gauges.entries()),
  slowRequests,
  requestSamples,
  latency: buildLatencySummary(),
  clientEvents,
  agentRuns,
  alerts,
  // Cumulative counters answer "how many ever"; these answer "how many now",
  // which is the only form in which a success rate means anything.
  counterWindows: summariseCounterWindows(counterBuckets, Date.now()),
  updatedAt,
  persistence: {
    storePath,
    ephemeral: isEphemeralStorePath(storePath),
    retentionMs: ENTRY_RETENTION_MS,
    backupCount: STORE_BACKUP_COUNT
  }
});

const metricName = (value: string) =>
  value
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();

export const renderPrometheusMetrics = () => {
  const lines = [
    '# HELP radioatlas_observability_counter Aggregated observability counters',
    '# TYPE radioatlas_observability_counter counter'
  ];
  counters.forEach((value, key) => {
    lines.push(`radioatlas_observability_counter{key="${metricName(key)}"} ${value}`);
  });
  lines.push('# HELP radioatlas_observability_gauge Runtime and concurrency gauges');
  lines.push('# TYPE radioatlas_observability_gauge gauge');
  gauges.forEach((value, key) => {
    lines.push(`radioatlas_observability_gauge{key="${metricName(key)}"} ${value}`);
  });
  lines.push('# HELP radioatlas_observability_slow_requests Number of retained slow request entries');
  lines.push('# TYPE radioatlas_observability_slow_requests gauge');
  lines.push(`radioatlas_observability_slow_requests ${slowRequests.length}`);
  lines.push('# HELP radioatlas_observability_request_samples Number of retained request samples');
  lines.push('# TYPE radioatlas_observability_request_samples gauge');
  lines.push(`radioatlas_observability_request_samples ${requestSamples.length}`);
  lines.push('# HELP radioatlas_observability_agent_runs Number of retained Lira agent runs');
  lines.push('# TYPE radioatlas_observability_agent_runs gauge');
  lines.push(`radioatlas_observability_agent_runs ${agentRuns.length}`);
  lines.push('# HELP radioatlas_request_latency_ms Request latency percentile gauges');
  lines.push('# TYPE radioatlas_request_latency_ms gauge');
  buildLatencySummary().forEach((entry) => {
    const route = metricName(entry.route);
    lines.push(`radioatlas_request_latency_ms{route="${route}",quantile="0.50"} ${entry.p50}`);
    lines.push(`radioatlas_request_latency_ms{route="${route}",quantile="0.95"} ${entry.p95}`);
    lines.push(`radioatlas_request_latency_ms{route="${route}",quantile="0.99"} ${entry.p99}`);
  });
  lines.push('# HELP radioatlas_observability_alerts Number of retained alert entries');
  lines.push('# TYPE radioatlas_observability_alerts gauge');
  lines.push(`radioatlas_observability_alerts ${alerts.length}`);
  return `${lines.join('\n')}\n`;
};

void loadPersistedState();

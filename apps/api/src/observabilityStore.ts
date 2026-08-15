import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
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

type PersistedObservabilityState = {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  slowRequests: SlowRequestEntry[];
  requestSamples: RequestSampleEntry[];
  clientEvents: ClientEventEntry[];
  agentRuns?: AgentRunTraceEntry[];
  alerts: ObservabilityAlert[];
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
const slowRequests: SlowRequestEntry[] = [];
const requestSamples: RequestSampleEntry[] = [];
const clientEvents: ClientEventEntry[] = [];
const agentRuns: AgentRunTraceEntry[] = [];
const alerts: ObservabilityAlert[] = [];

let hydrated = false;
let hydratePromise: Promise<void> | null = null;
let flushTimer: NodeJS.Timeout | null = null;
let flushPromise: Promise<void> | null = null;
let updatedAt: number | null = null;

const trimList = <T,>(target: T[], maxItems: number) => {
  target.splice(maxItems);
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

const rotateStoreBackups = async () => {
  if (STORE_BACKUP_COUNT <= 0) return;
  try {
    await access(storePath);
  } catch {
    return;
  }

  for (let index = STORE_BACKUP_COUNT; index >= 1; index -= 1) {
    const source = index === 1 ? storePath : backupPath(index - 1);
    const target = backupPath(index);
    try {
      await rename(source, target);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== 'ENOENT') {
        throw error;
      }
    }
  }
};

const scheduleFlush = () => {
  updatedAt = Date.now();
  if (flushTimer) {
    clearTimeout(flushTimer);
  }
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushPromise = flushState().catch((error) => {
      console.error('[Observability] failed to persist state', error);
    });
  }, FLUSH_DELAY_MS);
};

const loadPersistedState = async () => {
  if (hydrated) return;
  if (!hydratePromise) {
    hydratePromise = (async () => {
      try {
        const raw = await readFile(storePath, 'utf8');
        const parsed = JSON.parse(raw) as PersistedObservabilityState;
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

const flushState = async () => {
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
  await rotateStoreBackups();
  const payload: PersistedObservabilityState = {
    counters: Object.fromEntries(counters.entries()),
    gauges: Object.fromEntries(gauges.entries()),
    slowRequests,
    requestSamples,
    clientEvents,
    agentRuns,
    alerts,
    updatedAt
  };
  await writeFile(storePath, JSON.stringify(payload, null, 2), 'utf8');
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

export const hydrateObservabilityStore = async () => {
  await loadPersistedState();
};

export const bumpCounter = (key: string, amount = 1) => {
  counters.set(key, (counters.get(key) || 0) + amount);
  scheduleFlush();
};

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

import type express from 'express';
import os from 'node:os';
import {
  appendAlert,
  appendClientEvent,
  appendRequestSample,
  appendSlowRequest,
  bumpCounter,
  getObservabilitySnapshot,
  hydrateObservabilityStore,
  isEphemeralStorePath,
  observabilityStorePath,
  setGauge,
  renderPrometheusMetrics
} from './observabilityStore.js';

const normalizePath = (path: string) =>
  path
    .replace(/\/stations\/[^/]+/g, '/stations/:id')
    .replace(/\/areas\/[^/]+/g, '/areas/:id');

export const recordCatalogFallback = (source: 'snapshot' | 'artifact') => {
  bumpCounter(`catalog_fallback:${source}`);
};

export const recordClientEvent = (
  name: string,
  detail: string | null = null,
  meta: Record<string, unknown> | null = null
) => {
  bumpCounter(`client_event:${name}`);
  appendClientEvent({
    name,
    source: 'server',
    detail,
    meta,
    ts: Date.now()
  });
};

/**
 * Event names the web app is allowed to report. The counter key is built from
 * this value, so an open list means any caller can mint unlimited distinct
 * metric keys — and counters are the one structure the age-based prune never
 * touches. Kept in sync with reportClientEvent() call sites in the web app.
 */
const ALLOWED_CLIENT_EVENTS = new Set([
  'client_error',
  'deeplink_enter',
  'deeplink_error',
  'deeplink_play',
  'hls_error',
  'share_story'
]);

const hasInternalAccess = (candidate: string, configured: string | null | undefined) => {
  const expected = String(configured || '').trim();
  const provided = String(candidate || '').trim();
  return expected.length > 0 && provided === expected;
};

export const installObservability = (
  app: express.Express,
  options: { internalToken?: string | null } = {}
) => {
  void hydrateObservabilityStore();

  // A store that lives inside a release directory is wiped by the next deploy
  // and deleted by prune_old_releases. That is not worth refusing traffic over,
  // but an operator told to WATCH `ai_model_error:*` should not have to
  // discover on their own that the history keeps restarting.
  if (isEphemeralStorePath(observabilityStorePath)) {
    console.error(
      `[Observability] WARNING: metrics store ${observabilityStorePath} sits inside a release directory - ` +
        'every deploy resets it. Point OBSERVABILITY_STORE_PATH at a shared, non-release path.'
    );
  }

  let lastCpuUsage = process.cpuUsage();
  let lastCpuSampleTs = Date.now();
  const cpuAlertThreshold = Number(process.env.OBSERVABILITY_CPU_ALERT_PERCENT || 85);
  const sampleRuntime = () => {
    const now = Date.now();
    const elapsedMs = Math.max(1, now - lastCpuSampleTs);
    const usage = process.cpuUsage(lastCpuUsage);
    lastCpuUsage = process.cpuUsage();
    lastCpuSampleTs = now;
    const cpuPercent =
      ((usage.user + usage.system) / 1000 / elapsedMs / Math.max(1, os.cpus().length)) * 100;
    const load = os.loadavg();
    const rssMb = process.memoryUsage().rss / 1024 / 1024;
    setGauge('runtime:process_cpu_percent', Number(cpuPercent.toFixed(2)));
    setGauge('runtime:loadavg_1m', Number(load[0]?.toFixed(2) || 0));
    setGauge('runtime:loadavg_5m', Number(load[1]?.toFixed(2) || 0));
    setGauge('runtime:rss_mb', Number(rssMb.toFixed(2)));
    if (cpuPercent >= cpuAlertThreshold) {
      appendAlert({
        kind: 'server-error',
        title: 'radioatlas-api high cpu',
        detail: `cpu=${cpuPercent.toFixed(1)} load1=${load[0]?.toFixed(2) || 0}`,
        ts: now
      });
    }
  };
  sampleRuntime();
  const runtimeSampler = setInterval(sampleRuntime, 30_000);
  runtimeSampler.unref();

  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      const durationMs = Date.now() - startedAt;
      const normalizedPath = normalizePath(req.path);
      const slowThreshold = normalizedPath.startsWith('/catalog/search') ? 350 : 900;
      const counterKey = `${req.method}:${normalizedPath}`;

      bumpCounter(`request:${counterKey}`);
      appendRequestSample({
        path: normalizedPath,
        method: req.method,
        status: res.statusCode,
        durationMs,
        ts: Date.now()
      });
      if (res.statusCode >= 500) {
        bumpCounter(`error:${counterKey}`);
        appendAlert({
          kind: 'server-error',
          title: `${req.method} ${normalizedPath}`,
          detail: `status=${res.statusCode} duration=${durationMs}ms`,
          ts: Date.now()
        });
      }
      if (durationMs >= slowThreshold) {
        bumpCounter(`slow:${counterKey}`);
        const entry = {
          path: normalizedPath,
          method: req.method,
          status: res.statusCode,
          durationMs,
          ts: Date.now()
        };
        appendSlowRequest(entry);
        if (durationMs >= slowThreshold * 2) {
          appendAlert({
            kind: 'slow-request',
            title: `${req.method} ${normalizedPath}`,
            detail: `${res.statusCode} in ${durationMs}ms`,
            ts: entry.ts
          });
        }
        console.warn(
          `[Observability] slow request ${req.method} ${normalizedPath} ${res.statusCode} ${durationMs}ms`
        );
      }
    });
    next();
  });

  app.post('/observability/client-event', (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const detail = typeof req.body?.detail === 'string' ? req.body.detail.trim() : null;
    const meta =
      req.body?.meta && typeof req.body.meta === 'object' && !Array.isArray(req.body.meta)
        ? (req.body.meta as Record<string, unknown>)
        : null;
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    // Unauthenticated endpoint: never let the caller choose a metric key.
    if (!ALLOWED_CLIENT_EVENTS.has(name)) {
      res.status(400).json({ error: 'unknown event name' });
      return;
    }
    bumpCounter(`client_event:${name}`);
    appendClientEvent({
      name,
      source: 'client',
      detail,
      meta,
      ts: Date.now()
    });
    res.json({ ok: true });
  });

  // These were world-readable on production: `GET /api/observability` returned
  // 200 to anyone, including `persistence.storePath` (the absolute release path
  // on the box) and the clientEvents ring, which carries error detail straight
  // from browsers. Gate on the same internal token the scene-artwork webhook
  // uses. Note a loopback check would NOT work here: with `trust proxy 1` a
  // caller can put 127.0.0.1 in X-Forwarded-For and req.ip follows.
  const requireInternal: express.RequestHandler = (req, res, next) => {
    if (!hasInternalAccess(req.get('x-internal-token') || '', options.internalToken)) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    next();
  };

  app.get('/observability', requireInternal, (_req, res) => {
    res.json(getObservabilitySnapshot());
  });

  app.get('/observability/prometheus', requireInternal, (_req, res) => {
    res.type('text/plain; version=0.0.4');
    res.send(renderPrometheusMetrics());
  });
};

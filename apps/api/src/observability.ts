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

export const recordClientEvent = (name: string, detail: string | null = null) => {
  bumpCounter(`client_event:${name}`);
  appendClientEvent({
    name,
    source: 'server',
    detail,
    ts: Date.now()
  });
};

export const installObservability = (app: express.Express) => {
  void hydrateObservabilityStore();

  let lastCpuUsage = process.cpuUsage();
  let lastCpuSampleTs = Date.now();
  const cpuAlertThreshold = Number(process.env.OBSERVABILITY_CPU_ALERT_PERCENT || 85);
  const runtimeSampler = setInterval(() => {
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
  }, 30_000);
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
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    bumpCounter(`client_event:${name}`);
    appendClientEvent({
      name,
      source: 'client',
      detail,
      ts: Date.now()
    });
    res.json({ ok: true });
  });

  app.get('/observability', (_req, res) => {
    res.json(getObservabilitySnapshot());
  });

  app.get('/observability/prometheus', (_req, res) => {
    res.type('text/plain; version=0.0.4');
    res.send(renderPrometheusMetrics());
  });
};

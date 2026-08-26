import type express from 'express';
import os from 'node:os';
import { getHeapStatistics } from 'node:v8';
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

/**
 * Collapse identifiers out of a path BEFORE it becomes a counter key.
 *
 * Every distinct key here mints a counter plus up to 25 hourly buckets, and
 * nothing about a station id is bounded — there are 46 048 of them. Production
 * on 2026-08-23 was already carrying keys like
 * `request:GET:/artwork/scene/a2624589-8279-4be3-9ea0-514dcd29cef8`, one per
 * station whose scene had ever been fetched, and the store is persisted to disk.
 * With no listeners that was six keys; the day people arrive and browse, it is
 * one key per station they pass.
 *
 * `/stations/` and `/areas/` were collapsed from the start and cover their
 * `/catalog/...` prefixes too, since these are substring replacements. The three
 * added below were simply missed — which is the argument for the ceiling in
 * `bumpCounter` as well: the next route added here will be missed too.
 */
export const normalizePath = (path: string) =>
  path
    .replace(/\/stations\/[^/]+/g, '/stations/:id')
    .replace(/\/areas\/[^/]+/g, '/areas/:id')
    .replace(/\/artwork\/scene\/[^/]+/g, '/artwork/scene/:id')
    .replace(/\/artwork\/scenes\/[^/]+/g, '/artwork/scenes/:file')
    .replace(/\/share\/story\/[^/]+/g, '/share/story/:slug');

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
 * this value, so the list must stay CLOSED: an open one lets any caller mint
 * unlimited distinct metric keys, and counters are the one structure the
 * age-based prune never touches.
 *
 * It also has to be COMPLETE, which it was not. Only the six infrastructure
 * names below existed, while the web app has been emitting a full product,
 * playback and session vocabulary through the same endpoint — so every one of
 * those 41 events was answered `400 unknown event name`, dropped on the floor,
 * and logged as a console error in every listener's browser. Observed on
 * production 2026-08-15: a plain page load fired three of them.
 *
 * `apps/api/test/observability.clientEvents.test.ts` reads the web app sources
 * and fails if a name is emitted but not listed here — that is the actual
 * enforcement of "kept in sync", which a comment alone never was.
 */
const ALLOWED_CLIENT_EVENTS = new Set([
  // Infrastructure / diagnostics.
  'client_error',
  'deeplink_enter',
  'deeplink_error',
  'deeplink_play',
  'hls_error',
  'share_story',
  // Product analytics — `ProductAnalyticsEventName` in the web app.
  'app_opened',
  'home_station_impression',
  'home_now_playing_preview',
  'play_attempt',
  'play_success',
  // The Feed supersedes a play on every swipe; without this the attempt count
  // has no denominator anyone can reconcile.
  'play_superseded',
  'stream_failure',
  'skip',
  'like',
  'search_query',
  'queue_source',
  'queue_reorder',
  'queue_shuffle',
  'queue_enqueue',
  'queue_remove',
  'queue_clear_upcoming',
  'session_duration',
  'station_details_opened',
  'station_report_broken',
  'station_hidden',
  // Playback runtime — reportPlaybackEvent() in useAudioPlayer.
  'audio_api_unavailable',
  // The pair that finally answers whether playback SURVIVES the background.
  // `audio_background_resume_attempt` only ever said we went there; these two say
  // what happened, judged from position movement. Their ratio is the evidence for
  // or against ever building a native app — a TWA runs the same web engine and
  // would not change it.
  'audio_background_died',
  'audio_background_resume_attempt',
  'audio_background_survived',
  'audio_buffering_candidate_switch',
  'audio_buffering_reconnect',
  'audio_candidate_failed',
  'audio_fallback_candidate',
  'audio_lean_playback_mode',
  'audio_no_playable_candidate',
  'audio_playing',
  'audio_reconnect_recovered',
  'audio_reconnect_scheduled',
  'audio_silent_stall',
  'audio_visibility_change',
  // Account session — reportSessionEvent() in SessionContext.
  'session_authenticated',
  'session_invalidated',
  'session_refresh_error',
  'session_signed_out',
  'session_state',
  'session_sync_error',
  'session_sync_noop',
  'session_sync_skipped',
  'session_sync_start',
  'session_sync_success'
]);

export const allowedClientEvents = (): string[] => Array.from(ALLOWED_CLIENT_EVENTS);

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
  // Fixed for the life of the process, so read it once rather than per sample.
  const heapSizeLimit = getHeapStatistics().heap_size_limit;

  const sampleRuntime = () => {
    const now = Date.now();
    const elapsedMs = Math.max(1, now - lastCpuSampleTs);
    const usage = process.cpuUsage(lastCpuUsage);
    lastCpuUsage = process.cpuUsage();
    lastCpuSampleTs = now;
    const cpuPercent =
      ((usage.user + usage.system) / 1000 / elapsedMs / Math.max(1, os.cpus().length)) * 100;
    const load = os.loadavg();
    const memory = process.memoryUsage();
    const rssMb = memory.rss / 1024 / 1024;
    setGauge('runtime:process_cpu_percent', Number(cpuPercent.toFixed(2)));
    setGauge('runtime:loadavg_1m', Number(load[0]?.toFixed(2) || 0));
    setGauge('runtime:loadavg_5m', Number(load[1]?.toFixed(2) || 0));
    setGauge('runtime:rss_mb', Number(rssMb.toFixed(2)));
    // RSS is what pm2's max_memory_restart watches, but it is NOT what
    // --max-old-space-size bounds: that flag caps the V8 old space alone, and
    // setting it below the real working set turns a graceful pm2 restart into a
    // fatal OOM. Record the heap separately so the flag can be sized from
    // measurement instead of from RSS, which also carries external buffers,
    // code and fragmentation.
    setGauge('runtime:heap_used_mb', Number((memory.heapUsed / 1024 / 1024).toFixed(2)));
    setGauge('runtime:heap_total_mb', Number((memory.heapTotal / 1024 / 1024).toFixed(2)));
    setGauge('runtime:external_mb', Number(((memory.external + memory.arrayBuffers) / 1024 / 1024).toFixed(2)));
    // What V8 will ACTUALLY allow, straight from V8. `--max-old-space-size` is
    // passed by pm2, and pm2 also rewrites the process title — which clobbers
    // argv, so /proc/<pid>/cmdline cannot confirm the flag arrived. This gauge
    // can: it reads ~640 when the cap is in force and ~2GB or more when it is
    // not, whatever the config file claims.
    setGauge('runtime:heap_limit_mb', Number((heapSizeLimit / 1024 / 1024).toFixed(2)));
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

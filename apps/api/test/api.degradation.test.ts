import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const apiRoot = fileURLToPath(new URL('../', import.meta.url));
const apiPort = 34600 + Math.floor(Math.random() * 400);
const upstreamPort = apiPort + 500;
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const upstreamBaseUrl = `http://127.0.0.1:${upstreamPort}`;

let apiProcess: ChildProcessWithoutNullStreams | null = null;
let upstreamServer: Server | null = null;
let upstreamCounters = {
  statusJson: 0,
  shoutcast: 0,
  azura: 0,
  stream: 0,
  fetchSlow: 0,
  fetchCache: 0
};

const waitForServer = async (baseUrl: string, path = '/health') => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}${path}`);
      if (response.ok || response.status < 500) return;
    } catch {
      // server not ready yet
    }
    await delay(200);
  }
  throw new Error(`Server ${baseUrl}${path} did not start in time`);
};

type ObservabilityPayload = {
  counters: Record<string, number | undefined>;
};

type CatalogSummaryPayload = {
  counts: {
    stations: number;
  };
};

type ErrorPayload = {
  error: string;
  logs?: unknown[];
};

type ExtractPayload = {
  type: string;
  audioStreams: Array<{ url: string }>;
};

const getJson = async <T,>(path: string, init?: RequestInit) => {
  const response = await fetch(`${apiBaseUrl}${path}`, init);
  const body = (await response.json()) as T;
  return { response, body };
};

test.before(async () => {
  const observabilityDir = await mkdtemp(join(tmpdir(), 'radioatlas-observability-'));
  const observabilityStorePath = join(observabilityDir, 'metrics.json');

  upstreamServer = createServer(async (req, res) => {
    const url = new URL(req.url || '/', upstreamBaseUrl);

    if (url.pathname === '/catalog-source') {
      await delay(200);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
      return;
    }

    if (url.pathname === '/status-json.xsl' || url.pathname === '/7.html' || url.pathname === '/stream/slow') {
      if (url.pathname === '/status-json.xsl') upstreamCounters.statusJson += 1;
      if (url.pathname === '/7.html') upstreamCounters.shoutcast += 1;
      if (url.pathname === '/stream/slow') upstreamCounters.stream += 1;
      await delay(200);
      if (url.pathname === '/stream/slow') {
        res.writeHead(200, {
          'Content-Type': 'audio/mpeg',
          'icy-metaint': '16000'
        });
        res.end('slow');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('');
      }
      return;
    }

    if (url.pathname === '/api/nowplaying/1' || url.pathname === '/api/nowplaying') {
      upstreamCounters.azura += 1;
      await delay(50);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'missing' }));
      return;
    }

    if (url.pathname === '/fetch-slow') {
      upstreamCounters.fetchSlow += 1;
      await delay(40);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('slow fetch payload');
      return;
    }

    if (url.pathname === '/fetch-cache') {
      upstreamCounters.fetchCache += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, count: upstreamCounters.fetchCache }));
      return;
    }

    if (url.pathname === '/upstream-error') {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('upstream failed');
      return;
    }

    if (url.pathname === '/extract') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          type: 'stream',
          title: 'Extractor Proxy',
          audioStreams: [{ url: 'https://cdn.example.com/live.mp3', bitrate: 128 }]
        })
      );
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  await new Promise<void>((resolve, reject) => {
    upstreamServer!.once('error', reject);
    upstreamServer!.listen(upstreamPort, '127.0.0.1', () => resolve());
  });

  apiProcess = spawn(process.execPath, ['--import', 'tsx/esm', './src/index.ts'], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(apiPort),
      RADIO_BROWSER_URLS: `${upstreamBaseUrl}/catalog-source`,
      CATALOG_FETCH_TIMEOUT_MS: '50',
      METADATA_PROBE_TIMEOUT_MS: '50',
      METADATA_STREAM_TIMEOUT_MS: '50',
      STREAM_PROXY_TIMEOUT_MS: '100',
      METADATA_NEGATIVE_CACHE_TTL_MS: '1000',
      FETCH_CACHE_TTL_MS: '1000',
      FETCH_NEGATIVE_CACHE_TTL_MS: '1000',
      METADATA_CONCURRENCY: '1',
      FETCH_CONCURRENCY: '1',
      MEDIA_SHARED_CONCURRENCY: '1',
      METADATA_RATE_LIMIT_PER_WINDOW: '4',
      FETCH_RATE_LIMIT_PER_WINDOW: '4',
      OBSERVABILITY_STORE_PATH: observabilityStorePath,
      EXTRACTOR_URL: upstreamBaseUrl,
      ENABLE_TEST_AUTH_FIXTURES: '1',
      TELEGRAM_BOT_TOKEN: '',
      BOT_TOKEN: '',
      GOOGLE_CLIENT_ID: '',
      VK_CLIENT_ID: '',
      VK_CLIENT_SECRET: '',
      VK_REDIRECT_URI: '',
      WEBAPP_URL: 'https://radioatlas.test',
      MEDIA_SSRF_ALLOW_HOSTS: '127.0.0.1,localhost',
      ALLOWED_ORIGINS: 'http://127.0.0.1,http://localhost'
    }
  });

  let stderr = '';
  apiProcess.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  apiProcess.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(stderr);
    }
  });

  await waitForServer(apiBaseUrl);
});

test.after(async () => {
  if (apiProcess && !apiProcess.killed) {
    apiProcess.kill('SIGTERM');
    await delay(300);
    if (!apiProcess.killed) {
      apiProcess.kill('SIGKILL');
    }
  }
  if (upstreamServer) {
    await new Promise<void>((resolve, reject) => {
      upstreamServer!.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('slow catalog source falls back once across the boot/request herd and records observability', async () => {
  const { body: before } = await getJson<ObservabilityPayload>('/observability');
  const beforeFallbacks =
    Number(before.counters['catalog_fallback:artifact'] || 0) +
    Number(before.counters['catalog_fallback:snapshot'] || 0);

  const { response, body } = await getJson<CatalogSummaryPayload>('/catalog/summary?seed=19');
  assert.equal(response.status, 200);
  assert.equal(typeof body.counts.stations, 'number');

  const { body: after } = await getJson<ObservabilityPayload>('/observability');
  const afterFallbacks =
    Number(after.counters['catalog_fallback:artifact'] || 0) +
    Number(after.counters['catalog_fallback:snapshot'] || 0);
  assert.ok(afterFallbacks >= beforeFallbacks, 'fallback counters never move backwards');
  assert.equal(
    afterFallbacks,
    1,
    'boot warm and the first catalog request share one raw fallback flight'
  );
});

test('metadata timeout returns stable 404 contract', async () => {
  const target = encodeURIComponent(`${upstreamBaseUrl}/stream/slow`);
  const { response, body } = await getJson<ErrorPayload>(`/metadata?url=${target}`);
  assert.equal(response.status, 404);
  assert.equal(body.error, 'No metadata found');
  assert.ok(Array.isArray(body.logs));
});

test('metadata route dedupes in-flight probes and reuses negative cache', async () => {
  upstreamCounters = {
    statusJson: 0,
    shoutcast: 0,
    azura: 0,
    stream: 0,
    fetchSlow: 0,
    fetchCache: 0
  };

  const target = encodeURIComponent(`${upstreamBaseUrl}/stream/slow?case=dedupe`);
  const [first, second] = await Promise.all([
    getJson(`/metadata?url=${target}`),
    getJson(`/metadata?url=${target}`)
  ]);

  assert.equal(first.response.status, 404);
  assert.equal(second.response.status, 404);
  assert.ok(upstreamCounters.statusJson <= 1);
  assert.ok(upstreamCounters.shoutcast <= 1);
  assert.ok(upstreamCounters.azura <= 2);

  const cached = await getJson(`/metadata?url=${target}`);
  assert.equal(cached.response.status, 404);
  assert.ok(upstreamCounters.statusJson <= 1);
  assert.ok(upstreamCounters.shoutcast <= 1);
});

test('stream proxy surfaces upstream failures as 502', async () => {
  const target = encodeURIComponent(`${upstreamBaseUrl}/upstream-error`);
  const { response, body } = await getJson<ErrorPayload>(`/stream?url=${target}`);
  assert.equal(response.status, 502);
  assert.equal(body.error, 'Upstream 500');
});

test('fetch route sheds overload instead of hanging the process', async () => {
  const slowA = encodeURIComponent(`${upstreamBaseUrl}/fetch-slow?a=1`);
  const slowB = encodeURIComponent(`${upstreamBaseUrl}/fetch-slow?a=2`);
  const [left, right] = await Promise.all([
    fetch(`${apiBaseUrl}/fetch?url=${slowA}`),
    fetch(`${apiBaseUrl}/fetch?url=${slowB}`)
  ]);
  const statuses = [left.status, right.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [200, 503]);
});

test('metadata route enforces per-ip rate limit on uncached probes', async () => {
  const statuses: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    const target = encodeURIComponent(`${upstreamBaseUrl}/stream/slow?case=limit-${index}`);
    const response = await fetch(`${apiBaseUrl}/metadata?url=${target}`);
    statuses.push(response.status);
  }
  assert.equal(statuses.at(-1), 429);
});

test('configured extractor proxies extractor responses', async () => {
  const target = encodeURIComponent('https://example.com/watch?v=radio');
  const { response, body } = await getJson<ExtractPayload>(`/extract?url=${target}`);
  assert.equal(response.status, 200);
  assert.equal(body.type, 'stream');
  assert.equal(body.audioStreams.at(0)?.url, 'https://cdn.example.com/live.mp3');
});

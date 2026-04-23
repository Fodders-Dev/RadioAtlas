import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const apiRoot = fileURLToPath(new URL('../', import.meta.url));
const port = 34100 + Math.floor(Math.random() * 500);
const baseUrl = `http://127.0.0.1:${port}`;

let apiProcess: ChildProcessWithoutNullStreams | null = null;

const waitForServer = async () => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // server not ready yet
    }
    await delay(250);
  }
  throw new Error('API server did not start in time');
};

const getJson = async (path: string, init?: RequestInit) => {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json();
  return { response, body };
};

test.before(async () => {
  apiProcess = spawn(process.execPath, ['--import', 'tsx/esm', './src/index.ts'], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(port),
      ENABLE_TEST_AUTH_FIXTURES: '1',
      EXTRACTOR_URL: '',
      TELEGRAM_BOT_TOKEN: '',
      BOT_TOKEN: '',
      GOOGLE_CLIENT_ID: '',
      VK_CLIENT_ID: '',
      VK_CLIENT_SECRET: '',
      VK_REDIRECT_URI: '',
      WEBAPP_URL: 'https://radioatlas.test'
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

  await waitForServer();
});

test.after(async () => {
  if (!apiProcess || apiProcess.killed) return;
  apiProcess.kill('SIGTERM');
  await delay(300);
  if (!apiProcess.killed) {
    apiProcess.kill('SIGKILL');
  }
});

test('health and catalog contracts respond with shaped payloads', async () => {
  const { body: health } = await getJson('/health');
  assert.equal(health.ok, true);

  const { body: summary } = await getJson('/catalog/summary?seed=7');
  assert.equal(typeof summary.counts.stations, 'number');
  assert.ok(Array.isArray(summary.catalogPool));
  assert.ok(Array.isArray(summary.freshSignals));

  const { body: search } = await getJson('/catalog/search?q=jazz&limit=3');
  assert.ok(Array.isArray(search.items));
  assert.ok(search.items.length <= 3);

  const { body: areas } = await getJson('/catalog/areas?zoom=1.5');
  assert.ok(Array.isArray(areas.items));
});

test('auth fixture issues a reusable session and me endpoint returns profile', async () => {
  const { response: seedResponse, body: seed } = await getJson('/test/auth/seed-conflict', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ mergeStrategy: 'combine' })
  });
  assert.equal(seedResponse.status, 200);
  assert.ok(seed.token);
  assert.equal(typeof seed.currentAccountId, 'string');
  assert.equal(typeof seed.incomingCredential, 'string');

  const { response: meResponse, body: me } = await getJson('/me', {
    headers: {
      Authorization: `Bearer ${seed.token}`
    }
  });
  assert.equal(meResponse.status, 200);
  assert.equal(typeof me.profile.id, 'string');
  assert.ok(Array.isArray(me.auditTrail));
});

test('library sync no-ops when the payload is unchanged', async () => {
  const { body: seed } = await getJson('/test/auth/seed-conflict', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ mergeStrategy: 'combine' })
  });

  const authHeaders = {
    Authorization: `Bearer ${seed.token}`,
    'Content-Type': 'application/json'
  };
  const { response: beforeResponse, body: before } = await getJson('/me', {
    headers: authHeaders
  });
  assert.equal(beforeResponse.status, 200);

  const { response: syncResponse, body: synced } = await getJson('/me/library', {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify(before.profile.library)
  });
  assert.equal(syncResponse.status, 200);
  assert.equal(synced.auditTrail.length, before.auditTrail.length);
  assert.deepEqual(
    synced.auditTrail.map((event: { id: string }) => event.id),
    before.auditTrail.map((event: { id: string }) => event.id)
  );
});

test('billing, metadata, stream and extractor smokes return stable error contracts', async () => {
  const { response: providersResponse, body: providers } = await getJson('/auth/providers');
  assert.equal(providersResponse.status, 200);
  assert.equal(providers.telegram.configured, false);
  assert.equal(providers.google.configured, false);

  const { response: productsResponse, body: products } = await getJson('/billing/telegram/products');
  assert.equal(productsResponse.status, 200);
  assert.ok(Array.isArray(products.products));
  assert.ok(products.products.length > 0);

  const { response: webhookResponse, body: webhook } = await getJson('/billing/telegram/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  });
  assert.equal(webhookResponse.status, 400);
  assert.equal(webhook.error, 'purchaseId is required');

  const { response: metadataResponse, body: metadata } = await getJson('/metadata');
  assert.equal(metadataResponse.status, 400);
  assert.equal(metadata.error, 'url is required');

  const { response: streamResponse, body: stream } = await getJson('/stream');
  assert.equal(streamResponse.status, 400);
  assert.equal(stream.error, 'url is required');

  const imageFallbackResponse = await fetch(
    `${baseUrl}/image?url=${encodeURIComponent('http://127.0.0.1:9/logo.png')}`
  );
  assert.equal(imageFallbackResponse.status, 200);
  assert.match(imageFallbackResponse.headers.get('content-type') || '', /image\/svg\+xml/);
  assert.equal(imageFallbackResponse.headers.get('x-radioatlas-fallback'), 'artwork-unavailable');

  const { response: extractResponse, body: extract } = await getJson(
    '/extract?url=https%3A%2F%2Fexample.com'
  );
  assert.equal(extractResponse.status, 503);
  assert.equal(extract.error, 'extractor is not configured');
});

test('observability exposes persisted JSON and prometheus views', async () => {
  const clientEventResponse = await fetch(`${baseUrl}/observability/client-event`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: 'visual_regression_ping',
      detail: 'contract-test',
      meta: {
        scope: 'contracts',
        count: 3
      }
    })
  });
  assert.equal(clientEventResponse.status, 200);

  const { body: observability } = await getJson('/observability');
  assert.equal(typeof observability.counters['client_event:visual_regression_ping'], 'number');
  assert.equal(typeof observability.gauges['runtime:process_cpu_percent'], 'number');
  assert.ok(Array.isArray(observability.clientEvents));
  assert.equal(observability.clientEvents[0]?.meta?.scope, 'contracts');
  assert.ok(Array.isArray(observability.alerts));
  assert.ok(Array.isArray(observability.latency));
  assert.equal(typeof observability.persistence.storePath, 'string');

  const metricsResponse = await fetch(`${baseUrl}/observability/prometheus`);
  assert.equal(metricsResponse.status, 200);
  const metrics = await metricsResponse.text();
  assert.match(metrics, /radioatlas_observability_counter/);
  assert.match(metrics, /radioatlas_observability_gauge/);
  assert.match(metrics, /radioatlas_request_latency_ms/);
});

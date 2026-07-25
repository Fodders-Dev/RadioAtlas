import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const apiRoot = fileURLToPath(new URL('../', import.meta.url));
const port = 34100 + Math.floor(Math.random() * 500);
const baseUrl = `http://127.0.0.1:${port}`;

let apiProcess: ChildProcessWithoutNullStreams | null = null;

type HealthPayload = {
  ok: boolean;
};

type CatalogSummaryPayload = {
  counts: {
    stations: number;
  };
  catalogPool: unknown[];
  freshSignals: unknown[];
};

type ItemsPayload = {
  items: unknown[];
};

type SeedConflictPayload = {
  token: string;
  currentAccountId: string;
  incomingCredential: string;
};

type MePayload = {
  profile: {
    id: string;
    library: unknown;
  };
  auditTrail: Array<{ id: string }>;
};

type ProvidersPayload = {
  telegram: { configured: boolean };
  google: { configured: boolean };
};

type ProductsPayload = {
  products: unknown[];
};

type ErrorPayload = {
  error: string;
};

type OkPayload = {
  ok: boolean;
};

type StationProfilePayload = {
  profile: {
    stationuuid: string;
    ownerAccountId: string | null;
    displayName: string;
    description: string | null;
    websiteUrl: string | null;
    socialLinks: Array<{ label: string; url: string }>;
  };
};

type ObservabilityPayload = {
  counters: Record<string, number | undefined>;
  gauges: Record<string, number | undefined>;
  clientEvents: Array<{
    meta?: {
      scope?: string;
    };
  }>;
  alerts: unknown[];
  latency: unknown[];
  persistence: {
    storePath: string;
  };
};

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

// T_audit_5 seatbelt: a bounded timeout so any future hang (whatever the cause)
// fails fast with a clear message instead of silently eating the test runner's
// ~300s cap. The happy path is sub-second under CATALOG_ARTIFACT_ONLY, so this
// never trips in normal operation; it only converts a hang into a diagnosable
// failure. A caller-supplied signal still wins.
const getJson = async <T,>(path: string, init?: RequestInit) => {
  const response = await fetch(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(20000),
    ...init
  });
  const body = (await response.json()) as T;
  return { response, body };
};

test.before(async () => {
  apiProcess = spawn(process.execPath, ['--import', 'tsx/esm', './src/index.ts'], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(port),
      ENABLE_TEST_AUTH_FIXTURES: '1',
      // T_audit_5: serve the bundled catalogue artifact directly — this is a
      // payload-SHAPE contract test, so it must not depend on the live Radio
      // Browser network (the cold first /catalog/summary was hanging on the
      // 8s×MAX_PAGES live-fetch chain past the runner cap).
      CATALOG_ARTIFACT_ONLY: '1',
      EXTRACTOR_URL: '',
      TELEGRAM_BOT_TOKEN: '',
      BOT_TOKEN: '',
      GOOGLE_CLIENT_ID: '',
      VK_CLIENT_ID: '',
      VK_CLIENT_SECRET: '',
      VK_REDIRECT_URI: '',
      WEBAPP_URL: 'https://radioatlas.test',
      MEDIA_SSRF_ALLOW_HOSTS: '127.0.0.1,localhost',
      INTERNAL_WEBHOOK_TOKEN: 'contract-test-internal-token',
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
  const { body: health } = await getJson<HealthPayload>('/health');
  assert.equal(health.ok, true);

  const { body: summary } = await getJson<CatalogSummaryPayload>('/catalog/summary?seed=7');
  assert.equal(typeof summary.counts.stations, 'number');
  assert.ok(Array.isArray(summary.catalogPool));
  assert.ok(Array.isArray(summary.freshSignals));

  const { body: search } = await getJson<ItemsPayload>('/catalog/search?q=jazz&limit=3');
  assert.ok(Array.isArray(search.items));
  assert.ok(search.items.length <= 3);

  const { body: areas } = await getJson<ItemsPayload>('/catalog/areas?zoom=1.5');
  assert.ok(Array.isArray(areas.items));
});

test('T_api_bootwarm: a concurrent summary + station-by-id burst all return 200', async () => {
  // The cold-boot failure shape: the webapp fires /catalog/summary and
  // /catalog/stations/<uuid> concurrently; on a cold cache the first triggers
  // the synchronous ~57k parse + profile map, blocking the loop, and Caddy 503s
  // the other. The boot warm (index.ts, post-listen) primes the profiled 'full'
  // cache before traffic so the burst hits a warm cache. No Caddy in-test so we
  // can't observe the 503 directly, but this locks the burst path: both routes
  // resolve 200 and the by-id returns a shaped item. (CATALOG_ARTIFACT_ONLY here
  // makes the warm + lookups hermetic.)
  const [summary, station] = await Promise.all([
    getJson<CatalogSummaryPayload>('/catalog/summary?seed=11'),
    getJson<{ item: unknown }>('/catalog/stations/test-station-uuid')
  ]);
  assert.equal(summary.response.status, 200);
  assert.equal(typeof summary.body.counts.stations, 'number');
  assert.equal(station.response.status, 200);
  assert.ok('item' in station.body);
});

test('auth fixture issues a reusable session and me endpoint returns profile', async () => {
  const { response: seedResponse, body: seed } = await getJson<SeedConflictPayload>('/test/auth/seed-conflict', {
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

  const { response: meResponse, body: me } = await getJson<MePayload>('/me', {
    headers: {
      Authorization: `Bearer ${seed.token}`
    }
  });
  assert.equal(meResponse.status, 200);
  assert.equal(typeof me.profile.id, 'string');
  assert.ok(Array.isArray(me.auditTrail));
});

test('library sync no-ops when the payload is unchanged', async () => {
  const { body: seed } = await getJson<SeedConflictPayload>('/test/auth/seed-conflict', {
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
  const { response: beforeResponse, body: before } = await getJson<MePayload>('/me', {
    headers: authHeaders
  });
  assert.equal(beforeResponse.status, 200);

  const { response: syncResponse, body: synced } = await getJson<MePayload>('/me/library', {
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
  const { response: providersResponse, body: providers } = await getJson<ProvidersPayload>('/auth/providers');
  assert.equal(providersResponse.status, 200);
  assert.equal(providers.telegram.configured, false);
  assert.equal(providers.google.configured, false);

  const { response: productsResponse, body: products } = await getJson<ProductsPayload>('/billing/telegram/products');
  assert.equal(productsResponse.status, 200);
  assert.ok(Array.isArray(products.products));
  assert.ok(products.products.length > 0);

  const { response: webhookResponse, body: webhook } = await getJson<ErrorPayload>('/billing/telegram/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Token': 'contract-test-internal-token'
    },
    body: JSON.stringify({})
  });
  assert.equal(webhookResponse.status, 400);
  assert.equal(webhook.error, 'purchaseId is required');

  const { response: metadataResponse, body: metadata } = await getJson<ErrorPayload>('/metadata');
  assert.equal(metadataResponse.status, 400);
  assert.equal(metadata.error, 'url is required');

  const { response: streamResponse, body: stream } = await getJson<ErrorPayload>('/stream');
  assert.equal(streamResponse.status, 400);
  assert.equal(stream.error, 'url is required');

  const imageFallbackResponse = await fetch(
    `${baseUrl}/image?url=${encodeURIComponent('http://127.0.0.1:9/logo.png')}`
  );
  assert.equal(imageFallbackResponse.status, 200);
  assert.match(imageFallbackResponse.headers.get('content-type') || '', /image\/svg\+xml/);
  assert.equal(imageFallbackResponse.headers.get('x-radioatlas-fallback'), 'artwork-unavailable');

  const { response: extractResponse, body: extract } = await getJson<ErrorPayload>(
    '/extract?url=https%3A%2F%2Fexample.com'
  );
  assert.equal(extractResponse.status, 503);
  assert.equal(extract.error, 'extractor is not configured');
});

test('station profile, promotion and billing write routes keep stable contracts', async () => {
  const { body: seed } = await getJson<SeedConflictPayload>('/test/auth/seed-conflict', {
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
  const stationuuid = `contract-station-${Date.now()}`;

  const { response: missingClaimAuth, body: missingClaimAuthBody } = await getJson<ErrorPayload>(
    `/stations/${stationuuid}/claim`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ displayName: 'Contract Radio' })
    }
  );
  assert.equal(missingClaimAuth.status, 401);
  assert.equal(missingClaimAuthBody.error, 'authorization required');

  const { response: claimResponse, body: claimed } = await getJson<StationProfilePayload>(
    `/stations/${stationuuid}/claim`,
    {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        displayName: 'Contract Radio',
        websiteUrl: 'https://radioatlas.test/stations/contract',
        description: 'Contract profile'
      })
    }
  );
  assert.equal(claimResponse.status, 200);
  assert.equal(claimed.profile.stationuuid, stationuuid);
  assert.equal(claimed.profile.displayName, 'Contract Radio');

  const { response: profileResponse, body: profile } = await getJson<StationProfilePayload>(
    `/stations/${stationuuid}/profile`
  );
  assert.equal(profileResponse.status, 200);
  assert.equal(profile.profile.ownerAccountId, claimed.profile.ownerAccountId);

  const { response: updateResponse, body: updated } = await getJson<StationProfilePayload>(
    `/stations/${stationuuid}/profile`,
    {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        displayName: 'Contract Radio Updated',
        socialLinks: [{ label: 'Site', url: 'https://radioatlas.test' }]
      })
    }
  );
  assert.equal(updateResponse.status, 200);
  assert.equal(updated.profile.displayName, 'Contract Radio Updated');
  assert.equal(updated.profile.socialLinks[0]?.label, 'Site');

  const { response: missingPromotion, body: missingPromotionBody } = await getJson<ErrorPayload>(
    '/promotions/impression',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    }
  );
  assert.equal(missingPromotion.status, 400);
  assert.equal(missingPromotionBody.error, 'stationuuid is required');

  const { response: promotionResponse, body: promotion } = await getJson<OkPayload>(
    '/promotions/click',
    {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ stationuuid, sourceId: 'contract-test' })
    }
  );
  assert.equal(promotionResponse.status, 200);
  assert.equal(promotion.ok, true);

  const { response: missingInvoiceAuth, body: missingInvoiceAuthBody } = await getJson<ErrorPayload>(
    '/billing/telegram/create-invoice',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ productId: 'support-small' })
    }
  );
  assert.equal(missingInvoiceAuth.status, 401);
  assert.equal(missingInvoiceAuthBody.error, 'authorization required');

  const { response: invalidInvoice, body: invalidInvoiceBody } = await getJson<ErrorPayload>(
    '/billing/telegram/create-invoice',
    {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ productId: 'missing-product' })
    }
  );
  assert.equal(invalidInvoice.status, 400);
  assert.equal(invalidInvoiceBody.error, 'invalid billing product');
});

test('observability exposes persisted JSON and prometheus views', async () => {
  const clientEventResponse = await fetch(`${baseUrl}/observability/client-event`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      // Must be one of the names the web app actually reports: the counter key
      // is derived from it, so arbitrary names are refused now.
      name: 'client_error',
      detail: 'contract-test',
      meta: {
        scope: 'contracts',
        count: 3
      }
    })
  });
  assert.equal(clientEventResponse.status, 200);

  const inventedEvent = await fetch(`${baseUrl}/observability/client-event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'visual_regression_ping' })
  });
  assert.equal(inventedEvent.status, 400, 'an unauthenticated caller must not mint metric keys');

  // /observability is no longer world-readable: it published the release path
  // and the browser-error ring to anyone who asked.
  const closedObservability = await fetch(`${baseUrl}/observability`);
  assert.equal(closedObservability.status, 404, 'the snapshot must not be public');

  const { body: observability } = await getJson<ObservabilityPayload>('/observability', {
    headers: { 'x-internal-token': 'contract-test-internal-token' }
  });
  assert.equal(typeof observability.counters['client_event:client_error'], 'number');
  assert.equal(typeof observability.gauges['runtime:process_cpu_percent'], 'number');
  assert.ok(Array.isArray(observability.clientEvents));
  assert.equal(observability.clientEvents[0]?.meta?.scope, 'contracts');
  assert.ok(Array.isArray(observability.alerts));
  assert.ok(Array.isArray(observability.latency));
  assert.equal(typeof observability.persistence.storePath, 'string');

  const metricsResponse = await fetch(`${baseUrl}/observability/prometheus`, {
    headers: { 'x-internal-token': 'contract-test-internal-token' }
  });
  assert.equal(metricsResponse.status, 200);
  const metrics = await metricsResponse.text();
  assert.match(metrics, /radioatlas_observability_counter/);
  assert.match(metrics, /radioatlas_observability_gauge/);
  assert.match(metrics, /radioatlas_request_latency_ms/);
});

test('AI off (default): /ai/chat and the internal bot AI endpoint are not registered', async () => {
  // The contract server boots with no AI_ENABLED / DEEPSEEK_API_KEY, so the
  // assistant routes must not exist — the deploy is byte-identical to today.
  const chat = await fetch(`${baseUrl}/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'привет' })
  });
  assert.equal(chat.status, 404);

  const internal = await fetch(`${baseUrl}/internal/bot/ai-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Token': 'contract-test-internal-token' },
    body: JSON.stringify({ telegramId: '1', text: 'привет' })
  });
  assert.equal(internal.status, 404);
});

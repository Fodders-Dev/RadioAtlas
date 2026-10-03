import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { createTavilyRelayHandler } from './tavily-relay.mjs';

const VALID_KEY = 'tvly-test_key-123';
const VALID_BODY = {
  query: 'Tokyo radio history',
  search_depth: 'basic',
  max_results: 3,
  include_answer: false,
  include_raw_content: 'text'
};

const listen = async (server) => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
};

const close = async (server) => {
  if (!server.listening) return;
  const done = once(server, 'close');
  server.close();
  server.closeAllConnections?.();
  await done;
};

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

const responseFrom = (serverPort, {
  method = 'POST',
  path = '/tavily/search',
  headers = {},
  body,
  onRequest
} = {}) => new Promise((resolve, reject) => {
  const request = httpRequest({ hostname: '127.0.0.1', port: serverPort, method, path, headers }, (response) => {
    const chunks = [];
    response.on('data', (chunk) => chunks.push(chunk));
    response.once('end', () => resolve({
      status: response.statusCode,
      headers: response.headers,
      body: Buffer.concat(chunks).toString('utf8')
    }));
  });
  request.once('error', reject);
  onRequest?.(request);
  if (body !== undefined) request.write(body);
  request.end();
});

const startRelay = async (upstreamHandler, relayOptions = {}) => {
  const outboundOptions = [];
  const upstream = createServer(upstreamHandler);
  const upstreamPort = await listen(upstream);
  const injectedRequest = (options, callback) => {
    outboundOptions.push({ ...options, headers: { ...options.headers } });
    // Preserve the handler's fixed destination in outboundOptions; only this
    // test adapter rewrites the socket to the local HTTP fixture.
    return httpRequest({
      hostname: '127.0.0.1',
      port: upstreamPort,
      path: options.path,
      method: options.method,
      headers: options.headers
    }, callback);
  };
  const handler = createTavilyRelayHandler({ request: injectedRequest, ...relayOptions });
  let fallbackRequests = 0;
  const relay = createServer((req, res) => {
    if (handler(req, res)) return;
    fallbackRequests += 1;
    res.statusCode = 418;
    res.end('telegram fallback');
  });
  const relayPort = await listen(relay);
  return {
    relayPort,
    upstream,
    outboundOptions,
    get fallbackRequests() { return fallbackRequests; },
    close: async () => {
      await close(relay);
      await close(upstream);
    }
  };
};

const authorized = { authorization: `Bearer ${VALID_KEY}`, 'content-type': 'application/json' };
const post = (port, body = VALID_BODY, headers = authorized) => responseFrom(port, {
  headers,
  body: JSON.stringify(body)
});

test('forwards only validated fields to the fixed Tavily HTTPS destination', async (t) => {
  let receivedBody;
  let receivedHeaders;
  const fixture = await startRelay((req, res) => {
    const chunks = [];
    receivedHeaders = req.headers;
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      receivedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"results":[]}');
    });
  });
  t.after(fixture.close);

  const response = await post(fixture.relayPort, VALID_BODY, {
    ...authorized,
    host: 'attacker.example',
    'x-api-key': 'must-not-forward',
    'x-forwarded-host': 'attacker.example',
    cookie: 'secret=must-not-forward'
  });

  assert.equal(response.status, 200);
  assert.equal(response.body, '{"results":[]}');
  assert.deepEqual(receivedBody, VALID_BODY);
  assert.equal(receivedHeaders.authorization, `Bearer ${VALID_KEY}`);
  assert.equal(receivedHeaders['x-api-key'], undefined);
  assert.equal(receivedHeaders['x-forwarded-host'], undefined);
  assert.equal(receivedHeaders.cookie, undefined);
  assert.equal(fixture.outboundOptions.length, 1);
  const outbound = fixture.outboundOptions[0];
  assert.deepEqual({ hostname: outbound.hostname, port: outbound.port, method: outbound.method, path: outbound.path }, {
    hostname: 'api.tavily.com', port: 443, method: 'POST', path: '/search'
  });
  assert.deepEqual(Object.keys(outbound.headers).sort(), ['authorization', 'content-length', 'content-type']);
  assert.equal(outbound.headers.authorization, `Bearer ${VALID_KEY}`);
  assert.equal(outbound.headers['content-type'], 'application/json');
  assert.equal(Number(outbound.headers['content-length']), Buffer.byteLength(JSON.stringify(VALID_BODY)));
});

test('claims only the exact path, rejecting query strings and methods while leaving other paths to Telegram', async (t) => {
  const fixture = await startRelay((_req, res) => res.end('{"results":[]}'));
  t.after(fixture.close);

  const queryPath = await responseFrom(fixture.relayPort, {
    path: '/tavily/search?query=private', headers: authorized, body: '{}'
  });
  const wrongMethod = await responseFrom(fixture.relayPort, { method: 'GET', path: '/tavily/search' });
  const reservedPaths = await Promise.all(['/tavily', '/tavily/', '/tavily/other', '/tavily/search/'].map((path) =>
    responseFrom(fixture.relayPort, { method: 'POST', path, headers: authorized, body: '{}' })
  ));
  const telegram = await responseFrom(fixture.relayPort, { method: 'POST', path: '/bot123/sendMessage' });

  assert.equal(queryPath.status, 404);
  assert.equal(wrongMethod.status, 405);
  assert.deepEqual(reservedPaths.map((response) => response.status), [404, 404, 404, 404]);
  assert.equal(telegram.status, 418);
  assert.equal(fixture.fallbackRequests, 1);
  assert.equal(fixture.outboundOptions.length, 0);
});

test('rejects invalid credentials and unsafe or malformed JSON without outbound requests', async (t) => {
  const fixture = await startRelay((_req, res) => res.end('{"unexpected":true}'));
  t.after(fixture.close);

  const cases = [
    { headers: { authorization: 'Bearer tvly-bad.key', 'content-type': 'application/json' }, body: JSON.stringify(VALID_BODY), status: 401 },
    { headers: { authorization: 'Bearer tvly-' + 'a'.repeat(513), 'content-type': 'application/json' }, body: JSON.stringify(VALID_BODY), status: 401 },
    { headers: authorized, body: '{', status: 400 },
    { headers: authorized, body: JSON.stringify({ ...VALID_BODY, url: 'https://attacker.example' }), status: 400 },
    { headers: authorized, body: JSON.stringify({ ...VALID_BODY, api_key: VALID_KEY }), status: 400 },
    { headers: authorized, body: JSON.stringify({ ...VALID_BODY, search_depth: 'advanced' }), status: 400 },
    { headers: authorized, body: JSON.stringify({ ...VALID_BODY, max_results: 6 }), status: 400 },
    { headers: authorized, body: JSON.stringify({ ...VALID_BODY, max_results: 1.5 }), status: 400 },
    { headers: authorized, body: JSON.stringify({ ...VALID_BODY, include_answer: true }), status: 400 },
    { headers: authorized, body: JSON.stringify({ ...VALID_BODY, include_raw_content: 'html' }), status: 400 },
    { headers: authorized, body: JSON.stringify({ ...VALID_BODY, query: '  ' }), status: 400 },
    { headers: authorized, body: JSON.stringify({ ...VALID_BODY, query: 'q'.repeat(501) }), status: 400 },
    { headers: authorized, body: JSON.stringify({ ...VALID_BODY, target_url: 'https://attacker.example' }), status: 400 },
    { headers: authorized, body: JSON.stringify({ ...VALID_BODY, targetURL: 'https://attacker.example' }), status: 400 },
    { headers: authorized, body: JSON.stringify({ ...VALID_BODY, providerKey: VALID_KEY }), status: 400 },
    { headers: authorized, body: JSON.stringify({ ...VALID_BODY, body: { api_key: VALID_KEY } }), status: 400 },
    { headers: authorized, body: JSON.stringify({ ...VALID_BODY, query: 'x'.padStart(501, ' ') }), status: 400 }
  ];
  for (const item of cases) {
    const response = await responseFrom(fixture.relayPort, {
      headers: item.headers, body: item.body
    });
    assert.equal(response.status, item.status);
    assert.doesNotMatch(response.body, /tvly-/);
  }
  assert.equal(fixture.outboundOptions.length, 0);
});

test('caps request bodies at 8192 bytes and closes the incoming socket', async (t) => {
  const fixture = await startRelay((_req, res) => res.end('{}'));
  t.after(fixture.close);
  let clientSocket;
  const response = await responseFrom(fixture.relayPort, {
    headers: { ...authorized, 'content-length': String(8193) },
    body: 'x'.repeat(8193),
    onRequest: (request) => request.once('socket', (socket) => { clientSocket = socket; })
  });
  assert.equal(response.status, 413);
  assert.equal(response.headers.connection, 'close');
  assert.equal(fixture.outboundOptions.length, 0);
  await new Promise((resolve) => {
    if (clientSocket.destroyed) resolve();
    else clientSocket.once('close', resolve);
  });
});

test('applies an absolute deadline while the request body is still arriving', async (t) => {
  let upstreamCalls = 0;
  const fixture = await startRelay((_req, res) => { upstreamCalls += 1; res.end('{}'); }, { timeoutMs: 80 });
  t.after(fixture.close);
  let clientSocket;
  const responsePromise = new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: '127.0.0.1',
      port: fixture.relayPort,
      path: '/tavily/search',
      method: 'POST',
      headers: { ...authorized, 'content-length': '100' }
    }, (incoming) => {
      const chunks = [];
      incoming.on('data', (chunk) => chunks.push(chunk));
      incoming.once('end', () => resolve({
        status: incoming.statusCode,
        headers: incoming.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    request.once('socket', (socket) => { clientSocket = socket; });
    request.once('error', reject);
    request.write('{"query":');
    // Deliberately leave the body incomplete to prove the absolute deadline
    // starts before the relay has received all bytes.
  });
  const response = await responsePromise;
  assert.equal(response.status, 504);
  assert.equal(response.headers.connection, 'close');
  assert.equal(upstreamCalls, 0);
  await new Promise((resolve) => {
    if (clientSocket.destroyed) resolve();
    else clientSocket.once('close', resolve);
  });
});

test('enforces the concurrent cap and releases its slot after completion', async (t) => {
  const firstAccepted = deferred();
  const releaseFirst = deferred();
  let calls = 0;
  const fixture = await startRelay(async (req, res) => {
    calls += 1;
    if (calls === 1) {
      firstAccepted.resolve();
      await releaseFirst.promise;
    }
    req.resume();
    res.end('{"results":[]}');
  }, { maxConcurrent: 1, timeoutMs: 2_000 });
  t.after(() => { releaseFirst.resolve(); return fixture.close(); });

  const firstResponse = post(fixture.relayPort);
  await firstAccepted.promise;
  const rejected = await post(fixture.relayPort);
  assert.equal(rejected.status, 429);
  assert.equal(calls, 1);
  releaseFirst.resolve();
  assert.equal((await firstResponse).status, 200);
  assert.equal((await post(fixture.relayPort)).status, 200);
  assert.equal(calls, 2);
});

test('times out and destroys the upstream socket, then makes the slot available again', async (t) => {
  const firstAccepted = deferred();
  const firstClosed = deferred();
  let calls = 0;
  const fixture = await startRelay((req, res) => {
    calls += 1;
    if (calls === 1) {
      firstAccepted.resolve();
      res.once('close', firstClosed.resolve);
      return;
    }
    req.resume();
    res.end('{"ok":true}');
  }, { maxConcurrent: 1, timeoutMs: 100 });
  t.after(fixture.close);

  const timedOut = post(fixture.relayPort);
  await firstAccepted.promise;
  const response = await timedOut;
  assert.equal(response.status, 504);
  assert.doesNotMatch(response.body, /tvly-/);
  await firstClosed.promise;
  assert.equal((await post(fixture.relayPort)).status, 200);
  assert.equal(calls, 2);
});

test('client disconnect aborts the upstream socket and releases the slot', async (t) => {
  const firstAccepted = deferred();
  const firstClosed = deferred();
  let calls = 0;
  const fixture = await startRelay((req, res) => {
    calls += 1;
    if (calls === 1) {
      firstAccepted.resolve();
      res.once('close', firstClosed.resolve);
      return;
    }
    req.resume();
    res.end('{"ok":true}');
  }, { maxConcurrent: 1, timeoutMs: 2_000 });
  t.after(fixture.close);

  const client = httpRequest({ hostname: '127.0.0.1', port: fixture.relayPort, path: '/tavily/search', method: 'POST', headers: authorized });
  client.on('error', () => {});
  client.end(JSON.stringify(VALID_BODY));
  await firstAccepted.promise;
  client.destroy();
  await firstClosed.promise;
  assert.equal((await post(fixture.relayPort)).status, 200);
  assert.equal(calls, 2);
});

test('bounds upstream response buffering and destroys an oversized upstream response', async (t) => {
  const upstreamClosed = deferred();
  const fixture = await startRelay((_req, res) => {
    res.once('close', upstreamClosed.resolve);
    const chunk = Buffer.alloc(16 * 1024, 65);
    const interval = setInterval(() => res.write(chunk), 1);
    res.once('close', () => clearInterval(interval));
  }, { timeoutMs: 2_000 });
  t.after(fixture.close);

  const response = await post(fixture.relayPort);
  assert.equal(response.status, 502);
  assert.equal(response.headers.connection, 'close');
  assert.doesNotMatch(response.body, /tvly-/);
  await upstreamClosed.promise;
});

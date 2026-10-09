import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { createOpenAiRelayHandler } from './openai-relay.mjs';

const VALID_KEY = 'sk-proj-pilot_key-123';
const VALID_BODY = {
  model: 'gpt-6-luna',
  input: [
    { role: 'developer', content: 'Answer briefly.' },
    { role: 'user', content: 'Hello.' }
  ],
  max_output_tokens: 400,
  reasoning: { effort: 'low', context: 'current_turn' },
  text: { verbosity: 'low' },
  store: false
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
  path = '/openai/responses',
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
    // Keep the fixed HTTPS destination in the captured options; only this
    // test adapter rewrites the socket to its local HTTP fixture.
    return httpRequest({
      hostname: '127.0.0.1',
      port: upstreamPort,
      path: options.path,
      method: options.method,
      headers: options.headers
    }, callback);
  };
  const handler = createOpenAiRelayHandler({ request: injectedRequest, ...relayOptions });
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

test('forwards only the supported modelClient shape to fixed OpenAI Responses', async (t) => {
  const expectedBody = {
    ...VALID_BODY,
    text: {
      verbosity: 'low',
      format: {
        type: 'json_schema',
        name: 'bounded_result',
        strict: false,
        schema: { type: 'object', properties: { ok: { type: 'boolean' } } }
      }
    },
    safety_identifier: 'user-hash:abc123'
  };
  let receivedBody;
  let receivedHeaders;
  const fixture = await startRelay((req, res) => {
    const chunks = [];
    receivedHeaders = req.headers;
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      receivedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json', 'x-provider-detail': 'not forwarded' });
      res.end('{"output_text":"hello","usage":{"input_tokens":4,"output_tokens":2}}');
    });
  });
  t.after(fixture.close);

  const response = await post(fixture.relayPort, expectedBody, {
    ...authorized,
    host: 'attacker.example',
    'x-api-key': 'must-not-forward',
    'x-forwarded-host': 'attacker.example',
    cookie: 'secret=must-not-forward'
  });

  assert.equal(response.status, 200);
  assert.equal(response.body, '{"output_text":"hello","usage":{"input_tokens":4,"output_tokens":2}}');
  assert.equal(response.headers['x-provider-detail'], undefined);
  assert.deepEqual(receivedBody, expectedBody);
  assert.equal(receivedHeaders.authorization, `Bearer ${VALID_KEY}`);
  assert.equal(receivedHeaders['x-api-key'], undefined);
  assert.equal(receivedHeaders['x-forwarded-host'], undefined);
  assert.equal(receivedHeaders.cookie, undefined);
  assert.equal(fixture.outboundOptions.length, 1);
  const outbound = fixture.outboundOptions[0];
  assert.deepEqual({ hostname: outbound.hostname, port: outbound.port, method: outbound.method, path: outbound.path }, {
    hostname: 'api.openai.com', port: 443, method: 'POST', path: '/v1/responses'
  });
  assert.deepEqual(Object.keys(outbound.headers).sort(), ['authorization', 'content-length', 'content-type']);
  assert.equal(outbound.headers.authorization, `Bearer ${VALID_KEY}`);
  assert.equal(Number(outbound.headers['content-length']), Buffer.byteLength(JSON.stringify(expectedBody)));
});

test('claims the OpenAI namespace and never forwards path typos or methods to Telegram', async (t) => {
  const fixture = await startRelay((_req, res) => res.end('{}'));
  t.after(fixture.close);

  const query = await responseFrom(fixture.relayPort, {
    path: '/openai/responses?secret=private', headers: authorized, body: '{}'
  });
  const wrongMethod = await responseFrom(fixture.relayPort, {
    method: 'GET', path: '/openai/responses'
  });
  const reserved = await Promise.all([
    '/openai', '/openai/', '/openai/typo', '/openai/responses/', '/openai/responsesXYZ',
    '/openaiTypo', '/OpenAI/responses', '/%6fpenai/responses', '/openai%2Fresponses'
  ].map((path) => responseFrom(fixture.relayPort, {
    path, headers: authorized, body: '{}'
  })));
  const telegram = await responseFrom(fixture.relayPort, {
    path: '/bot123/sendMessage', headers: authorized, body: '{}'
  });

  assert.equal(query.status, 404);
  assert.equal(wrongMethod.status, 405);
  assert.deepEqual(reserved.map((response) => response.status), Array(9).fill(404));
  assert.equal(telegram.status, 418);
  assert.equal(fixture.fallbackRequests, 1);
  assert.equal(fixture.outboundOptions.length, 0);
});

test('rejects malformed, oversized-feature, and non-string input shapes without upstream calls', async (t) => {
  const fixture = await startRelay((_req, res) => res.end('{}'), { maxConcurrent: 1 });
  t.after(fixture.close);

  const cases = [
    { headers: { authorization: 'Bearer bad key', 'content-type': 'application/json' }, body: JSON.stringify(VALID_BODY), status: 401 },
    { headers: { authorization: `Bearer ${VALID_KEY}`, 'content-type': 'text/plain' }, body: JSON.stringify(VALID_BODY), status: 415 },
    { headers: authorized, body: '{', status: 400 },
    { headers: authorized, body: JSON.stringify({ ...VALID_BODY, model: 'gpt-5.6-luna' }), status: 400 },
    { headers: authorized, body: JSON.stringify({ ...VALID_BODY, store: true }), status: 400 },
    { headers: authorized, body: JSON.stringify({ ...VALID_BODY, store: undefined }), status: 400 },
    { headers: authorized, body: JSON.stringify({ ...VALID_BODY, max_output_tokens: 1001 }), status: 400 },
    { headers: authorized, body: JSON.stringify({ ...VALID_BODY, max_output_tokens: 0 }), status: 400 },
    { headers: authorized, body: JSON.stringify({ ...VALID_BODY, input: [{ role: 'user', content: [{ type: 'input_image' }] }] }), status: 400 },
    { headers: authorized, body: JSON.stringify({ ...VALID_BODY, input: [{ role: 'system', content: 'not modelClient shaped' }] }), status: 400 },
    { headers: authorized, body: JSON.stringify({ ...VALID_BODY, stream: true }), status: 400 },
    { headers: authorized, body: JSON.stringify({ ...VALID_BODY, background: true }), status: 400 },
    { headers: authorized, body: JSON.stringify({ ...VALID_BODY, tools: [{ type: 'web_search' }] }), status: 400 },
    { headers: authorized, body: JSON.stringify({ ...VALID_BODY, tool_choice: 'auto' }), status: 400 },
    { headers: authorized, body: JSON.stringify({ ...VALID_BODY, previous_response_id: 'resp_private' }), status: 400 },
    { headers: authorized, body: JSON.stringify({ ...VALID_BODY, reasoning: { effort: 'high', context: 'current_turn' } }), status: 400 },
    { headers: authorized, body: JSON.stringify({ ...VALID_BODY, text: { verbosity: 'high' } }), status: 400 }
  ];

  for (const item of cases) {
    const response = await responseFrom(fixture.relayPort, { headers: item.headers, body: item.body });
    assert.equal(response.status, item.status);
    assert.doesNotMatch(response.body, /sk-proj-/);
  }

  // Invalid requests release their slot; a subsequent valid request reaches
  // the injected upstream and is still bounded to one concurrent request.
  assert.equal((await post(fixture.relayPort)).status, 200);
  assert.equal(fixture.outboundOptions.length, 1);
});

test('caps declared and chunked request bodies at 128 KiB', async (t) => {
  const fixture = await startRelay((_req, res) => res.end('{}'));
  t.after(fixture.close);

  const declared = await responseFrom(fixture.relayPort, {
    headers: { ...authorized, 'content-length': String(128 * 1024 + 1) },
    body: 'x'.repeat(128 * 1024 + 1)
  });
  const chunked = await responseFrom(fixture.relayPort, {
    headers: authorized,
    body: 'x'.repeat(128 * 1024 + 1)
  });
  assert.equal(declared.status, 413);
  assert.equal(chunked.status, 413);
  assert.equal(fixture.outboundOptions.length, 0);
});

test('enforces the absolute deadline during a slow request upload', async (t) => {
  let upstreamCalls = 0;
  const fixture = await startRelay((_req, res) => { upstreamCalls += 1; res.end('{}'); }, { timeoutMs: 80 });
  t.after(fixture.close);

  const responsePromise = new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: '127.0.0.1',
      port: fixture.relayPort,
      path: '/openai/responses',
      method: 'POST',
      headers: { ...authorized, 'content-length': '100' }
    }, (incoming) => {
      const chunks = [];
      incoming.on('data', (chunk) => chunks.push(chunk));
      incoming.once('end', () => resolve({ status: incoming.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.once('error', reject);
    request.write('{"model":');
  });
  const response = await responsePromise;
  assert.equal(response.status, 504);
  assert.equal(response.body, '{"error":"upstream timeout"}');
  assert.equal(upstreamCalls, 0);
});

test('sanitizes upstream errors and releases its concurrency slot', async (t) => {
  let calls = 0;
  const fixture = await startRelay((req, res) => {
    calls += 1;
    req.resume();
    if (calls === 1) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(`{"error":"secret detail ${VALID_KEY}"}`);
      return;
    }
    res.end('{"ok":true}');
  }, { maxConcurrent: 1 });
  t.after(fixture.close);

  const failed = await post(fixture.relayPort);
  assert.equal(failed.status, 401);
  assert.equal(failed.body, '{"error":"upstream failure"}');
  assert.doesNotMatch(failed.body, /sk-proj-|secret detail/);
  assert.equal((await post(fixture.relayPort)).status, 200);
  assert.equal(calls, 2);
});

test('enforces the 1 MiB upstream response cap and destroys the response', async (t) => {
  const closed = deferred();
  const fixture = await startRelay((_req, res) => {
    res.once('close', closed.resolve);
    res.end(Buffer.alloc(1024 * 1024 + 1, 65));
  }, { timeoutMs: 2_000 });
  t.after(fixture.close);

  const response = await post(fixture.relayPort);
  assert.equal(response.status, 502);
  assert.equal(response.body, '{"error":"upstream failure"}');
  assert.equal(response.headers.connection, 'close');
  await closed.promise;
});

test('limits the default concurrency to two and releases slots after completion', async (t) => {
  const bothAccepted = deferred();
  const releaseBoth = deferred();
  let calls = 0;
  const fixture = await startRelay(async (req, res) => {
    calls += 1;
    if (calls <= 2) {
      if (calls === 2) bothAccepted.resolve();
      await releaseBoth.promise;
    }
    req.resume();
    res.end('{"ok":true}');
  }, { timeoutMs: 2_000 });
  t.after(() => { releaseBoth.resolve(); return fixture.close(); });

  const firstResponse = post(fixture.relayPort);
  const secondResponse = post(fixture.relayPort);
  await bothAccepted.promise;
  const rejected = await post(fixture.relayPort);
  assert.equal(rejected.status, 429);
  assert.equal(calls, 2);
  releaseBoth.resolve();
  assert.equal((await firstResponse).status, 200);
  assert.equal((await secondResponse).status, 200);
  assert.equal((await post(fixture.relayPort)).status, 200);
  assert.equal(calls, 3);
});

test('client disconnect aborts upstream work and frees the slot', async (t) => {
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

  const client = httpRequest({ hostname: '127.0.0.1', port: fixture.relayPort, path: '/openai/responses', method: 'POST', headers: authorized });
  client.on('error', () => {});
  client.end(JSON.stringify(VALID_BODY));
  await firstAccepted.promise;
  client.destroy();
  await firstClosed.promise;
  assert.equal((await post(fixture.relayPort)).status, 200);
  assert.equal(calls, 2);
});

test('times out a stalled upstream and releases the slot for the next request', async (t) => {
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
  }, { maxConcurrent: 1, timeoutMs: 80 });
  t.after(fixture.close);

  const timedOut = post(fixture.relayPort);
  await firstAccepted.promise;
  const response = await timedOut;
  assert.equal(response.status, 504);
  assert.equal(response.body, '{"error":"upstream timeout"}');
  await firstClosed.promise;
  assert.equal((await post(fixture.relayPort)).status, 200);
  assert.equal(calls, 2);
});

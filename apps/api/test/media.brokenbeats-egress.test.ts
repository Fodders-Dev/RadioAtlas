import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { __setSsrfAllowedHostsForTesting, __setSsrfDnsLookupForTesting } from '../src/media/shared.js';
import { prefersForeignEgress, readForeignEgressConfig } from '../src/media/foreignEgress.js';
import { createStreamHandler } from '../src/media/streamProxy.js';

test('Brokenbeats exact mount prefers the foreign stream and returns its bytes', async () => {
  const originalFetch = globalThis.fetch;
  const originalBase = process.env.MEDIA_FOREIGN_EGRESS_BASE;
  const calls: string[] = [];
  let relayStatus = 200;
  let directStatus = 200;
  process.env.MEDIA_FOREIGN_EGRESS_BASE = 'https://relay.test/api';
  assert.ok(readForeignEgressConfig(process.env, 1_000));
  assert.equal(prefersForeignEgress(new URL('https://stream.brokenbeats.net/tune')), true);
  __setSsrfAllowedHostsForTesting(['stream.brokenbeats.net', 'unrelated.example']);
  __setSsrfDnsLookupForTesting(async (host) => {
    if (host === '127.0.0.1') return [{ address: host, family: 4 }];
    return [{ address: '8.8.8.8', family: 4 }];
  });
  globalThis.fetch = (async (input: Parameters<typeof originalFetch>[0], init?: Parameters<typeof originalFetch>[1]) => {
    const url = String(input);
    if (url.startsWith('https://relay.test/')) calls.push(url);
    if (url.startsWith('https://relay.test/api/stream?')) {
      if (relayStatus !== 200) return new Response('relay failed', { status: relayStatus });
      let chunks = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (chunks === 3) return controller.close();
          controller.enqueue(new Uint8Array(16 * 1024).fill(0x64 + chunks++));
        }
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'audio/aac' } });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  const options = {
    userAgent: 'brokenbeats-egress-test',
    extractorUrl: '',
    metadataCacheTtlMs: 0,
    upstreamTimeoutMs: 1_000,
    streamStallTimeoutMs: 0,
    streamRateLimitPerWindow: 100,
    rateLimitWindowMs: 60_000
  };
  const directFetch = async (candidate: { url: URL }, _init: RequestInit) => {
    calls.push(candidate.url.toString());
    if (candidate.url.href === 'https://stream.brokenbeats.net/tune' && directStatus === 200) {
      const stalled = new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new Uint8Array(24_007).fill(0x64)); }
      });
      return new Response(stalled, { status: 200, headers: { 'content-type': 'audio/aac' } });
    }
    return new Response(new Uint8Array([0xff, 0xfb, 0x90]), {
      status: directStatus,
      headers: { 'content-type': 'audio/aac' }
    });
  };
  let handler = createStreamHandler(options, { fetchCandidate: directFetch as never });
  const server = createServer((incoming, outgoing) => {
    incoming.resume();
    const parsed = new URL(incoming.url || '/', 'http://127.0.0.1');
    Object.assign(incoming, {
      query: Object.fromEntries(parsed.searchParams),
      protocol: 'https',
      get: (name: string) => incoming.headers[name.toLowerCase()]
    });
    Object.assign(outgoing, {
      status(status: number) { outgoing.statusCode = status; return outgoing; },
      send(body: unknown) { outgoing.end(body); return outgoing; },
      json(body: unknown) { outgoing.setHeader('content-type', 'application/json'); outgoing.end(JSON.stringify(body)); return outgoing; }
    });
    void handler(incoming as never, outgoing as never).catch((error: unknown) => {
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.destroy(error instanceof Error ? error : undefined);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const proxyUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const response = await originalFetch(`${proxyUrl}/stream?url=${encodeURIComponent('https://stream.brokenbeats.net/tune')}`);
    assert.deepEqual(calls.map((url) => url.startsWith('https://relay.test') ? 'relay' : 'direct'), ['relay'], calls.join('\n'));
    assert.equal(response.status, 200);
    const relayedBytes = Buffer.from(await response.arrayBuffer());
    assert.equal(relayedBytes.byteLength, 3 * 16 * 1024, 'relay continued beyond the direct 24,007-byte stall prefix');
    assert.equal(relayedBytes[0], 0x64);
    assert.equal(response.headers.get('content-type'), 'audio/aac');

    calls.length = 0;
    const ordinary = await originalFetch(`${proxyUrl}/stream?url=${encodeURIComponent('https://unrelated.example/radio')}`);
    assert.equal(ordinary.status, 200);
    assert.deepEqual(calls.map((url) => url.startsWith('https://relay.test') ? 'relay' : 'direct'), ['direct']);

    calls.length = 0;
    directStatus = 503;
    const ordinaryFallback = await originalFetch(`${proxyUrl}/stream?url=${encodeURIComponent('https://unrelated.example/down')}`);
    assert.equal(ordinaryFallback.status, 200);
    assert.deepEqual(calls.map((url) => url.startsWith('https://relay.test') ? 'relay' : 'direct'), ['direct', 'relay']);

    calls.length = 0;
    directStatus = 200;
    relayStatus = 503;
    const preferredFailure = await originalFetch(`${proxyUrl}/stream?url=${encodeURIComponent('https://stream.brokenbeats.net/tune')}`);
    assert.equal(preferredFailure.status, 200);
    assert.deepEqual(calls.map((url) => url.startsWith('https://relay.test') ? 'relay' : 'direct'), ['relay', 'direct']);

    calls.length = 0;
    directStatus = 503;
    const bothFailed = await originalFetch(`${proxyUrl}/stream?url=${encodeURIComponent('https://stream.brokenbeats.net/tune')}`);
    assert.equal(bothFailed.status, 502);
    assert.deepEqual(calls.map((url) => url.startsWith('https://relay.test') ? 'relay' : 'direct'), ['relay', 'direct'], 'preferred relay is not attempted a second time');

    calls.length = 0;
    relayStatus = 200;
    directStatus = 200;
    delete process.env.MEDIA_FOREIGN_EGRESS_BASE;
    handler = createStreamHandler(options, { fetchCandidate: directFetch as never });
    const noConfig = await originalFetch(`${proxyUrl}/stream?url=${encodeURIComponent('https://stream.brokenbeats.net/tune')}`);
    assert.equal(noConfig.status, 200);
    assert.deepEqual(calls.map((url) => url.startsWith('https://relay.test') ? 'relay' : 'direct'), ['direct']);

    calls.length = 0;
    process.env.MEDIA_FOREIGN_EGRESS_BASE = 'https://relay.test/api';
    handler = createStreamHandler(options, { fetchCandidate: directFetch as never });
    const hopMarked = await originalFetch(
      `${proxyUrl}/stream?url=${encodeURIComponent('https://stream.brokenbeats.net/tune')}`,
      { headers: { 'x-radioatlas-egress-hop': '1' } }
    );
    assert.equal(hopMarked.status, 200);
    assert.deepEqual(calls.map((url) => url.startsWith('https://relay.test') ? 'relay' : 'direct'), ['direct']);

    calls.length = 0;
    const nearMatch = await originalFetch(`${proxyUrl}/stream?url=${encodeURIComponent('https://stream.brokenbeats.net/tune?x=1')}`);
    assert.equal(nearMatch.status, 200);
    assert.deepEqual(calls.map((url) => url.startsWith('https://relay.test') ? 'relay' : 'direct'), ['direct']);

    calls.length = 0;
    const privateTarget = await originalFetch(`${proxyUrl}/stream?url=${encodeURIComponent('http://127.0.0.1/tune')}`);
    assert.equal(privateTarget.status, 403);
    assert.deepEqual(calls, []);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    globalThis.fetch = originalFetch;
    if (originalBase === undefined) delete process.env.MEDIA_FOREIGN_EGRESS_BASE;
    else process.env.MEDIA_FOREIGN_EGRESS_BASE = originalBase;
    __setSsrfDnsLookupForTesting(null);
    __setSsrfAllowedHostsForTesting(null);
  }
});

test('the preferred target set is exact after URL normalization', async () => {
  for (const exact of [
    'https://stream.brokenbeats.net/tune',
    'https://stream.brokenbeats.net:443/tune',
    'https://STREAM.BROKENBEATS.NET/tune',
    'https://brokenbeats.net/stream/aac'
  ]) assert.equal(prefersForeignEgress(new URL(exact)), true, exact);
  for (const near of [
    'http://stream.brokenbeats.net/tune',
    'https://brokenbeats.net/tune',
    'https://www.brokenbeats.net/stream/aac',
    'https://stream.brokenbeats.net/tune/',
    'https://stream.brokenbeats.net/%74une',
    'https://stream.brokenbeats.net/tune?x=1',
    'https://user@stream.brokenbeats.net/tune'
  ]) assert.equal(prefersForeignEgress(new URL(near)), false, near);
});

test('preferred relay cancellation before headers and after body releases its upstream socket', async () => {
  const originalFetch = globalThis.fetch;
  const originalBase = process.env.MEDIA_FOREIGN_EGRESS_BASE;
  const relayPeers: import('node:net').Socket[] = [];
  const relayServer = createServer((incoming, outgoing) => {
    incoming.resume();
    relayPeers.push(incoming.socket);
    if (relayPeers.length === 1) return; // hold the first response before headers
    outgoing.writeHead(200, { 'content-type': 'audio/aac' });
    outgoing.write(Buffer.from([0xff, 0xfb, 0x90]));
    outgoing.write(Buffer.alloc(16 * 1024, 0x64));
    outgoing.write(Buffer.alloc(16 * 1024, 0x65));
  });
  const relaySockets = new Set<import('node:net').Socket>();
  relayServer.on('connection', (socket) => {
    relaySockets.add(socket);
    socket.on('close', () => relaySockets.delete(socket));
  });
  await new Promise<void>((resolve) => relayServer.listen(0, '127.0.0.1', resolve));
  const relayPort = (relayServer.address() as AddressInfo).port;
  const relayBase = `http://relay.test:${relayPort}/api`;
  process.env.MEDIA_FOREIGN_EGRESS_BASE = relayBase;
  __setSsrfAllowedHostsForTesting(['stream.brokenbeats.net']);
  __setSsrfDnsLookupForTesting(async () => [{ address: '8.8.8.8', family: 4 }]);
  globalThis.fetch = (async (input: Parameters<typeof originalFetch>[0], init?: Parameters<typeof originalFetch>[1]) => {
    const url = String(input);
    if (!url.startsWith(relayBase)) return originalFetch(input, init);
    const actual = new URL(url);
    actual.hostname = '127.0.0.1';
    actual.protocol = 'http:';
    return originalFetch(actual, init);
  }) as typeof fetch;

  let directCalls = 0;
  const handler = createStreamHandler({
    userAgent: 'brokenbeats-cancel-test',
    extractorUrl: '',
    metadataCacheTtlMs: 0,
    upstreamTimeoutMs: 5_000,
    streamStallTimeoutMs: 0,
    streamRateLimitPerWindow: 100,
    rateLimitWindowMs: 60_000
  }, {
    fetchCandidate: (async () => {
      directCalls += 1;
      throw new Error('direct request must not start after cancellation');
    }) as never
  });
  const proxyServer = createServer((incoming, outgoing) => {
    incoming.resume();
    const parsed = new URL(incoming.url || '/', 'http://127.0.0.1');
    Object.assign(incoming, {
      query: Object.fromEntries(parsed.searchParams),
      protocol: 'https',
      get: (name: string) => incoming.headers[name.toLowerCase()]
    });
    Object.assign(outgoing, {
      status(status: number) { outgoing.statusCode = status; return outgoing; },
      send(body: unknown) { outgoing.end(body); return outgoing; },
      json(body: unknown) { outgoing.setHeader('content-type', 'application/json'); outgoing.end(JSON.stringify(body)); return outgoing; }
    });
    void handler(incoming as never, outgoing as never).catch((error: unknown) => {
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.destroy(error instanceof Error ? error : undefined);
    });
  });
  await new Promise<void>((resolve) => proxyServer.listen(0, '127.0.0.1', resolve));
  const proxyUrl = `http://127.0.0.1:${(proxyServer.address() as AddressInfo).port}`;
  const waitClosed = async (peer: import('node:net').Socket) => {
    const deadline = Date.now() + 1_500;
    while (!peer.destroyed && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    return peer.destroyed;
  };
  try {
    const beforeHeaders = new AbortController();
    const pending = originalFetch(
      `${proxyUrl}/stream?url=${encodeURIComponent('https://stream.brokenbeats.net/tune')}`,
      { signal: beforeHeaders.signal }
    );
    const deadline = Date.now() + 1_000;
    while (relayPeers.length < 1 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(relayPeers[0], 'preferred relay accepted request before headers');
    beforeHeaders.abort(new Error('cancel before relay headers'));
    await assert.rejects(pending);
    assert.equal(await waitClosed(relayPeers[0]!), true, 'pre-header cancellation closed relay peer');
    assert.equal(directCalls, 0, 'pre-header cancellation never tries direct');

    const afterBody = originalFetch(`${proxyUrl}/stream?url=${encodeURIComponent('https://stream.brokenbeats.net/tune')}`);
    const response = await afterBody;
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    let relayedBytes = 0;
    while (relayedBytes <= 24_007) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false, 'relay remains live while delivering audio');
      relayedBytes += chunk.value.byteLength;
    }
    assert.ok(relayedBytes > 24_007, 'continuing relay passed the former direct stall prefix');
    const bodyPeer = relayPeers[1];
    assert.ok(bodyPeer, 'captured relay socket for delivered body');
    await reader.cancel();
    assert.equal(await waitClosed(bodyPeer), true, 'body cancellation closed relay peer');
    assert.equal(directCalls, 0, 'body cancellation never tries direct');
  } finally {
    proxyServer.closeAllConnections();
    await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
    relayServer.closeAllConnections();
    await new Promise<void>((resolve) => relayServer.close(() => resolve()));
    globalThis.fetch = originalFetch;
    if (originalBase === undefined) delete process.env.MEDIA_FOREIGN_EGRESS_BASE;
    else process.env.MEDIA_FOREIGN_EGRESS_BASE = originalBase;
    __setSsrfDnsLookupForTesting(null);
    __setSsrfAllowedHostsForTesting(null);
  }
});

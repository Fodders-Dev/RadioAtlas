import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { __setSsrfAllowedHostsForTesting, __setSsrfDnsLookupForTesting } from '../src/media/shared.js';
import { createStreamHandler } from '../src/media/streamProxy.js';

type Loopback = {
  server: Server;
  url: string;
  sockets: Set<Socket>;
  accepted: number;
  closed: number;
  isClosed: (socket: Socket) => boolean;
};

const listen = async (handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<Loopback> => {
  const sockets = new Set<Socket>();
  const closedSockets = new WeakSet<Socket>();
  let accepted = 0;
  let closed = 0;
  const server = createServer(handler);
  server.on('connection', (socket) => {
    accepted += 1;
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => {
      closed += 1;
      closedSockets.add(socket);
      sockets.delete(socket);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    server,
    url: `http://127.0.0.1:${port}`,
    sockets,
    isClosed: (socket) => closedSockets.has(socket),
    get accepted() { return accepted; },
    get closed() { return closed; }
  };
};

const closeLoopback = async (fixture: Loopback) => {
  // These are test-owned sockets. Force them down before close() so a failed
  // assertion cannot leave a live-radio fixture holding the test process open.
  for (const socket of fixture.sockets) socket.destroy();
  fixture.server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    fixture.server.close((error) => error ? reject(error) : resolve());
  });
};

const waitFor = async (condition: () => boolean, timeoutMs = 3_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  return condition();
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const quietUpstream = async () => {
  let requests = 0;
  const requestSockets: Socket[] = [];
  const fixture = await listen((_req, res) => {
    requests += 1;
    requestSockets.push(_req.socket);
    res.writeHead(200, { 'content-type': 'audio/mpeg', connection: 'keep-alive' });
    res.write(Buffer.from('radio-chunk'));
  });
  Object.defineProperty(fixture, 'requests', { get: () => requests });
  Object.defineProperty(fixture, 'requestSockets', { value: requestSockets });
  return fixture as Loopback & { readonly requests: number; requestSockets: Socket[] };
};

const waitForPeerClose = (fixture: Loopback, peer: Socket, timeoutMs = 3_000) =>
  waitFor(() => fixture.isClosed(peer), timeoutMs);

const startProxy = async () => {
  const handler = createStreamHandler({
    userAgent: 'media-body-lifecycle-test',
    extractorUrl: '',
    metadataCacheTtlMs: 0,
    upstreamTimeoutMs: 2_000,
    streamStallTimeoutMs: 0,
    streamRateLimitPerWindow: 100,
    rateLimitWindowMs: 60_000
  });
  return listen((incoming, outgoing) => {
    // Consume ordinary empty GET requests just as Express does. The abort tests
    // below exercise a closed response while the request itself was consumed.
    incoming.resume();
    const parsed = new URL(incoming.url || '/', 'http://127.0.0.1');
    Object.assign(incoming, {
      query: Object.fromEntries(parsed.searchParams),
      protocol: 'http',
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
};

const openLiveResponse = (proxy: Loopback, upstreamUrl: string) =>
  fetch(`${proxy.url}/stream?url=${encodeURIComponent(upstreamUrl)}`);

const openProxyRequest = (proxy: Loopback, upstreamUrl: string, signal?: AbortSignal) =>
  fetch(`${proxy.url}/stream?url=${encodeURIComponent(upstreamUrl)}`, { signal });

const prepareLoopback = () => {
  __setSsrfAllowedHostsForTesting(['127.0.0.1']);
  __setSsrfDnsLookupForTesting(async () => [{ address: '127.0.0.1', family: 4 }]);
};

const resetSsrfHooks = () => {
  __setSsrfDnsLookupForTesting(null);
  __setSsrfAllowedHostsForTesting(null);
};

test('cancelling a live client body closes the actual upstream peer socket', async () => {
  prepareLoopback();
  const upstream = await quietUpstream();
  const proxy = await startProxy();
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const requestIndex = upstream.requests;
    const response = await openLiveResponse(proxy, `${upstream.url}/silent`);
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    const first = await reader.read();
    assert.equal(first.done, false, 'client received the initial live chunk');
    assert.equal(await waitFor(() => upstream.requests > 0), true, 'upstream received the stream request');
    const peer = upstream.requestSockets[requestIndex];
    assert.ok(peer, 'captured the actual upstream peer socket');
    await reader.cancel();
    assert.equal(await waitForPeerClose(upstream, peer), true, 'upstream TCP peer closed after cancellation');
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.deepEqual(unhandled, [], 'cancellation produces no unhandled promise rejection');
  } finally {
    process.off('unhandledRejection', onUnhandled);
    await closeLoopback(proxy);
    await closeLoopback(upstream);
    resetSsrfHooks();
  }
});

test('repeated live-body cancellations do not retain upstream peer sockets', async () => {
  prepareLoopback();
  const upstream = await quietUpstream();
  const proxy = await startProxy();
  try {
    for (let iteration = 0; iteration < 4; iteration += 1) {
      const requestIndex = upstream.requests;
      const response = await openLiveResponse(proxy, `${upstream.url}/silent-${iteration}`);
      const reader = response.body!.getReader();
      assert.equal((await reader.read()).done, false);
      assert.equal(await waitFor(() => upstream.requests > requestIndex), true);
      const peer = upstream.requestSockets[requestIndex];
      assert.ok(peer);
      await reader.cancel();
      assert.equal(await waitForPeerClose(upstream, peer), true, `iteration ${iteration} released its peer socket`);
      assert.equal(await waitFor(() => upstream.sockets.size === 0), true, `iteration ${iteration} left no upstream sockets open`);
    }
    assert.equal(upstream.sockets.size, 0, 'no cancelled upstream peer socket remains open');
  } finally {
    await closeLoopback(proxy);
    await closeLoopback(upstream);
    resetSsrfHooks();
  }
});

test('an unconsumed client body backpressures a high-volume upstream before cancellation', async () => {
  prepareLoopback();
  const chunk = Buffer.alloc(64 * 1024, 0x52);
  const safetyCap = 32 * 1024 * 1024;
  let bytesWritten = 0;
  let waitingForDrain = false;
  let exceededSafetyCap = false;
  let peer: Socket | null = null;
  const upstream = await listen((req, res) => {
    peer = req.socket;
    res.writeHead(200, { 'content-type': 'audio/mpeg' });
    const pump = () => {
      while (!res.destroyed) {
        bytesWritten += chunk.byteLength;
        if (bytesWritten > safetyCap) {
          exceededSafetyCap = true;
          res.destroy();
          return;
        }
        if (!res.write(chunk)) {
          waitingForDrain = true;
          res.once('drain', () => {
            waitingForDrain = false;
            pump();
          });
          return;
        }
      }
    };
    pump();
  });
  const proxy = await startProxy();
  try {
    const response = await openLiveResponse(proxy, `${upstream.url}/bulk`);
    assert.equal(response.status, 200);
    assert.equal(await waitFor(() => upstream.sockets.size > 0), true, 'producer connected to the proxy');
    assert.equal(await waitFor(() => waitingForDrain || exceededSafetyCap, 5_000), true, 'producer reached downstream backpressure within the bounded test window');
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(exceededSafetyCap, false, 'unconsumed stream did not run away past the 32 MiB safety cap');
    assert.equal(waitingForDrain, true, 'producer remains blocked while client does not read');
    assert.ok(bytesWritten < safetyCap, `producer stayed bounded at ${bytesWritten} bytes`);

    assert.ok(peer, 'captured the actual upstream peer socket');
    await response.body!.cancel();
    assert.equal(await waitForPeerClose(upstream, peer), true, 'cancelling the stalled client body closes the upstream peer');
  } finally {
    await closeLoopback(proxy);
    await closeLoopback(upstream);
    resetSsrfHooks();
  }
});

test('aborting a client before upstream headers promptly closes the accepted peer', async () => {
  prepareLoopback();
  const accepted = deferred<Socket>();
  let peer: Socket | null = null;
  const upstream = await listen((req) => {
    req.resume();
    peer = req.socket;
    accepted.resolve(req.socket);
    // Hold headers until cleanup; the client cancellation must close this
    // accepted TCP peer instead of waiting for the 2-second fetch deadline.
  });
  const proxy = await startProxy();
  const controller = new AbortController();
  try {
    const client = openProxyRequest(proxy, `${upstream.url}/delayed-headers`, controller.signal);
    const acceptedPeer = await withTimeout(accepted.promise, 1_500, 'upstream request was not accepted');
    assert.equal(peer, acceptedPeer);
    const abortAt = Date.now();
    controller.abort(new Error('test client disconnected before headers'));
    await assert.rejects(client);
    assert.equal(await waitForPeerClose(upstream, acceptedPeer, 1_000), true, 'upstream peer closes within one second, before the two-second fetch deadline');
    assert.ok(Date.now() - abortAt < 1_500, 'cancellation did not wait for the upstream deadline');
  } finally {
    controller.abort();
    await closeLoopback(proxy);
    await closeLoopback(upstream);
    resetSsrfHooks();
  }
});

test('aborting one pending manifest client leaves a concurrent client response intact', async () => {
  prepareLoopback();
  const acceptedBoth = deferred<void>();
  const requests: Array<{ peer: Socket; response: ServerResponse }> = [];
  const upstream = await listen((req, res) => {
    req.resume();
    requests.push({ peer: req.socket, response: res });
    if (requests.length === 2) acceptedBoth.resolve();
  });
  const proxy = await startProxy();
  const firstController = new AbortController();
  try {
    const playlistUrl = `${upstream.url}/playlist.m3u8`;
    const firstClient = openProxyRequest(proxy, playlistUrl, firstController.signal);
    assert.equal(await waitFor(() => requests.length === 1), true, 'first manifest request reached upstream');
    const secondClient = openProxyRequest(proxy, playlistUrl);
    await withTimeout(acceptedBoth.promise, 1_500, 'second manifest request was not independently accepted');

    firstController.abort(new Error('first client disconnected'));
    await assert.rejects(firstClient);
    assert.equal(await waitForPeerClose(upstream, requests[0]!.peer, 1_000), true, 'first upstream peer was cancelled');
    assert.equal(upstream.isClosed(requests[1]!.peer), false, 'second upstream request remains alive');

    requests[1]!.response.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
    requests[1]!.response.end('#EXTM3U\n#EXTINF:5,\nsegment.ts\n');
    const secondResponse = await secondClient;
    assert.equal(secondResponse.status, 200);
    const body = await secondResponse.text();
    assert.ok(body.includes(`${proxy.url}/stream?url=${encodeURIComponent(`${upstream.url}/segment.ts`)}`), `manifest URI was rewritten: ${body}`);
    assert.equal(await waitForPeerClose(upstream, requests[1]!.peer), true, 'second response body was consumed and its upstream peer closed');
  } finally {
    firstController.abort();
    await closeLoopback(proxy);
    await closeLoopback(upstream);
    resetSsrfHooks();
  }
});

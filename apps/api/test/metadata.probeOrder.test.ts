import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { createMetadataHandler, shouldProbeAzuraCast } from '../src/media/metadataService.js';
import { __setSsrfAllowedHostsForTesting } from '../src/media/shared.js';

/**
 * /metadata was the slowest route this API serves: 12 468 of 23 604 production
 * requests were logged slow (>=900ms), and the retained slow entries peaked at
 * 14 451ms — longer than the 5s probe + 7s stream budget can explain.
 *
 * Two causes, both pinned here:
 *
 * 1. The three status probes ran under `Promise.all`, so every station waited
 *    for the SLOWEST of them even when the highest-priority one had already
 *    answered. Measured on 60 top-voted catalogue stations: three stations whose
 *    icecast status answered in 96-724ms still took ~10.7s because the
 *    AzuraCast probe was stuck in a TLS connect.
 *
 * 2. The AzuraCast probe is built as `https://<host>/api/nowplaying` with the
 *    stream's port attached, so for an `http:` stream on an explicit port it
 *    opens TLS against a plaintext audio port. It cannot answer — of 40 such
 *    stations in the catalogue sample it produced 0 titles and hit the deadline
 *    on 17.
 */

type Handler = ReturnType<typeof createMetadataHandler>;

const options = {
  userAgent: 'RadioAtlasTest/1.0',
  extractorUrl: '',
  metadataCacheTtlMs: 15_000,
  metadataProbeTimeoutMs: 5_000,
  metadataStreamTimeoutMs: 7_000,
  metadataRateLimitPerWindow: 1_000,
  rateLimitWindowMs: 60_000,
  metadataConcurrency: 4,
  sharedConcurrency: 8,
  fetchResponseLimitBytes: 262_144
};

const SLOW_MS = 2_000;

type Probe = { status: number; source: string | null; title: string | null; ms: number };

const callHandler = (handler: Handler, url: string): Promise<Probe> =>
  new Promise((resolve) => {
    const startedAt = Date.now();
    let status = 200;
    const req = { query: { url }, ip: '203.0.113.9', socket: { remoteAddress: '203.0.113.9' }, headers: {} };
    const res = {
      statusCode: 200,
      setHeader() {},
      status(code: number) {
        status = code;
        return this;
      },
      json(body: Record<string, unknown>) {
        resolve({
          status,
          source: (body?.source as string) ?? null,
          title: (body?.title as string) ?? null,
          ms: Date.now() - startedAt
        });
        return this;
      }
    };
    void handler(req as never, res as never);
  });

const icestats = (title: string) =>
  JSON.stringify({ icestats: { source: { listenurl: 'http://x/stream', title } } });

/**
 * A station whose icecast status answers at once while every other probe path
 * is slow. `hits` records what was actually requested.
 */
const startStation = async (): Promise<{ base: string; hits: string[]; server: Server }> => {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    const path = (req.url || '').split('?')[0] || '';
    hits.push(path);
    if (path === '/status-json.xsl') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(icestats('Fast Icecast - Answered First'));
      return;
    }
    // Everything else answers, but only after the deadline this test cares about.
    setTimeout(() => {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('slow');
    }, SLOW_MS);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, hits, server };
};

const closeServer = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

test('shouldProbeAzuraCast skips only the probe that cannot answer', () => {
  // http + explicit port: `https://host:port/api/nowplaying` is TLS against a
  // plaintext audio port. 0 titles / 17 deadline hits over 40 such stations.
  assert.equal(shouldProbeAzuraCast(new URL('http://radio.example.net:8000/live')), false);
  assert.equal(shouldProbeAzuraCast(new URL('http://198.51.100.7:18000/stream')), false);
  // Default-port hosts are where AzuraCast actually lives — keep probing them.
  assert.equal(shouldProbeAzuraCast(new URL('http://onair.example.it/listen/x/radio.mp3')), true);
  assert.equal(shouldProbeAzuraCast(new URL('https://stream.example.fr/radio/8000/128.mp3')), true);
  // An https stream port speaks TLS, so the probe is cheap and can answer.
  assert.equal(shouldProbeAzuraCast(new URL('https://icecast.example.com:8443/classic')), true);
  assert.equal(shouldProbeAzuraCast(new URL('https://icecast.example.com:443/classic')), true);
});

test('a fast icecast status is not held up by the slower probes', async () => {
  __setSsrfAllowedHostsForTesting(['127.0.0.1']);
  const station = await startStation();
  try {
    const handler = createMetadataHandler(options);
    const result = await callHandler(handler, `${station.base}/stream`);

    // Same answer as before: icecast still outranks shoutcast and azuracast.
    assert.equal(result.status, 200);
    assert.equal(result.source, 'icecast-status');
    assert.equal(result.title, 'Fast Icecast - Answered First');

    // ...but we no longer wait out the probes that lost.
    assert.ok(
      result.ms < SLOW_MS,
      `expected the icecast title back before the slow probes settled, took ${result.ms}ms`
    );

    // The AzuraCast probe is skipped outright for an http url on an explicit
    // port, so the station is never asked for it.
    assert.ok(
      !station.hits.some((path) => path.startsWith('/api/nowplaying')),
      `expected no AzuraCast probe, saw ${JSON.stringify(station.hits)}`
    );
    assert.ok(station.hits.includes('/status-json.xsl'));
  } finally {
    await closeServer(station.server);
    __setSsrfAllowedHostsForTesting(null);
  }
});

test('priority is unchanged: shoutcast still wins when icecast has nothing', async () => {
  __setSsrfAllowedHostsForTesting(['127.0.0.1']);
  const hits: string[] = [];
  const server = createServer((req, res) => {
    const path = (req.url || '').split('?')[0] || '';
    hits.push(path);
    if (path === '/status-json.xsl') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ icestats: {} }));
      return;
    }
    if (path === '/7.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body>1,1,0,64,0,128,Shoutcast Winner - Track</body></html>');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('no');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const handler = createMetadataHandler(options);
    const result = await callHandler(handler, `http://127.0.0.1:${port}/second-stream`);
    assert.equal(result.status, 200);
    assert.equal(result.source, 'shoutcast-status');
    assert.equal(result.title, 'Shoutcast Winner - Track');
  } finally {
    await closeServer(server);
    __setSsrfAllowedHostsForTesting(null);
  }
});

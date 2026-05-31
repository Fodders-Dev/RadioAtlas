import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { registerShareRoutes, type ShareRouteDeps } from '../src/shareRoutes.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const station = (id: string) => ({
  stationuuid: id,
  name: 'Tokyo FM',
  favicon: '', // no artwork → brand gradient card (no outbound fetch)
  country: 'Japan',
  tags: 'pop'
});

const startServer = async (over: Partial<ShareRouteDeps> = {}) => {
  const app = express();
  registerShareRoutes(app, {
    getStationById: async (id) => (id === 'good' ? station(id) : null),
    assetsDir: new URL('../assets/', import.meta.url),
    userAgent: 'RadioAtlas/1.0',
    ...over
  });
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  return { server, base: `http://127.0.0.1:${port}` };
};

test('GET /share/story/<valid>.png renders a valid PNG', async () => {
  const { server, base } = await startServer();
  try {
    const res = await fetch(`${base}/share/story/good.png`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.match(res.headers.get('cache-control') || '', /max-age=\d+/);
    assert.doesNotMatch(res.headers.get('cache-control') || '', /immutable/);
    const body = Buffer.from(await res.arrayBuffer());
    assert.ok(body.subarray(0, 8).equals(PNG_MAGIC), 'valid PNG signature');
    // No render fallback header on the real card.
    assert.equal(res.headers.get('x-radioatlas-fallback'), null);
  } finally {
    server.close();
  }
});

test('GET /share/story/<unknown>.png serves the static fallback (not a per-id render)', async () => {
  const { server, base } = await startServer();
  try {
    const res = await fetch(`${base}/share/story/does-not-exist.png`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal(res.headers.get('x-radioatlas-fallback'), 'story-card');
    const body = Buffer.from(await res.arrayBuffer());
    assert.ok(body.subarray(0, 8).equals(PNG_MAGIC));
  } finally {
    server.close();
  }
});

test('a repeat request for the same valid id is served (cache path) and stays a valid PNG', async () => {
  const { server, base } = await startServer();
  try {
    const first = Buffer.from(await (await fetch(`${base}/share/story/good.png`)).arrayBuffer());
    const second = Buffer.from(await (await fetch(`${base}/share/story/good.png`)).arrayBuffer());
    assert.ok(first.subarray(0, 8).equals(PNG_MAGIC));
    assert.ok(second.equals(first), 'cached render is byte-identical on the repeat request');
  } finally {
    server.close();
  }
});

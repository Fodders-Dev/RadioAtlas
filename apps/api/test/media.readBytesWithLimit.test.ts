import assert from 'node:assert/strict';
import test from 'node:test';

import { readBytesWithLimit } from '../src/media/shared.js';

// readBytesWithLimit is the bounded replacement for arrayBuffer() in the image
// proxy: it must return the body when under the cap, and ABORT (throw) the
// moment the running byte count exceeds it — so an oversized artwork URL with a
// missing/false content-length can't buffer the whole body into RAM and OOM.

test('returns the full body when it is under the cap', async () => {
  const res = new Response(new Uint8Array([1, 2, 3, 4, 5]));
  const out = await readBytesWithLimit(res, 1024);
  assert.equal(out.byteLength, 5);
  assert.deepEqual([...out], [1, 2, 3, 4, 5]);
});

test('throws once the body exceeds the cap', async () => {
  const res = new Response(new Uint8Array(2048));
  await assert.rejects(() => readBytesWithLimit(res, 1024), /exceeded 1024 bytes/);
});

test('returns an empty buffer for a bodyless response', async () => {
  const res = new Response(null, { status: 204 });
  const out = await readBytesWithLimit(res, 1024);
  assert.equal(out.byteLength, 0);
});

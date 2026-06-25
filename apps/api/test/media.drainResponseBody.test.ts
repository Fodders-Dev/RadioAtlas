import assert from 'node:assert/strict';
import test from 'node:test';

import { drainResponseBody } from '../src/media/shared.js';

// drainResponseBody is the cleanup the stream/image candidate loops call when
// they abandon a non-OK upstream response. Cancelling the body is what settles
// the agent-disposal wrapper and closes the pinned undici socket — so its
// contract (cancel when there's a body, swallow errors, no-op when bodyless) is
// the thing that prevents a per-failed-candidate Agent/socket leak.

const responseLike = (body: unknown) => ({ body }) as unknown as Response;

test('drainResponseBody cancels the body when present', async () => {
  let cancelled = false;
  await drainResponseBody(responseLike({ cancel: async () => {
    cancelled = true;
  } }));
  assert.equal(cancelled, true);
});

test('drainResponseBody is a no-op when there is no body', async () => {
  await assert.doesNotReject(() => drainResponseBody(responseLike(null)));
});

test('drainResponseBody swallows a cancel() rejection (best-effort)', async () => {
  await assert.doesNotReject(() =>
    drainResponseBody(responseLike({ cancel: async () => {
      throw new Error('body already settled');
    } }))
  );
});

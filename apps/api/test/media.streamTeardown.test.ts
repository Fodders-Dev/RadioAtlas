import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { wireClientDisconnectTeardown } from '../src/media/streamProxy.js';

// wireClientDisconnectTeardown is the leak fix for the live-stream proxy: when a
// client disconnects mid-stream (skip station / app close / network drop) the
// response closes before the (effectively infinite) live body ends, and Node's
// pipe leaves the upstream read + 512KB buffer dangling. Destroying the source
// on a PREMATURE close releases them; a normal completion must be left alone.

const fakeRes = (writableEnded: boolean) => {
  const emitter = new EventEmitter();
  return Object.assign(emitter, { writableEnded });
};

const fakeStream = () => {
  const state = { destroyed: false };
  return { state, destroy: () => {
    state.destroyed = true;
  } };
};

test('destroys source + buffer when the client disconnects before the stream ends', () => {
  const res = fakeRes(false);
  const source = fakeStream();
  const buffer = fakeStream();
  wireClientDisconnectTeardown(res as never, source, buffer);
  res.emit('close');
  assert.equal(source.state.destroyed, true);
  assert.equal(buffer.state.destroyed, true);
});

test('leaves the streams alone on a normal completion (writableEnded)', () => {
  const res = fakeRes(true);
  const source = fakeStream();
  const buffer = fakeStream();
  wireClientDisconnectTeardown(res as never, source, buffer);
  res.emit('close');
  assert.equal(source.state.destroyed, false);
  assert.equal(buffer.state.destroyed, false);
});

test('tears down every stream passed', () => {
  const res = fakeRes(false);
  const streams = [fakeStream(), fakeStream(), fakeStream()];
  wireClientDisconnectTeardown(res as never, ...streams);
  res.emit('close');
  for (const s of streams) assert.equal(s.state.destroyed, true);
});

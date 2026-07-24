import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { wireStreamStallTimeout } from '../src/media/streamProxy.js';

// wireStreamStallTimeout is the body-transfer watchdog for the live-stream
// proxy. fetchWithTimeout only bounds the HEADERS fetch, so a half-open upstream
// (200 + headers, then silence) holds a concurrency slot forever. The watchdog
// arms a timer that fires after an idle window with no `data`; every chunk
// re-arms it, end/close/error disarm it. `onIdle` decides on fire: true → keep
// watching (downstream backpressure, not an upstream stall), false → stop.

// Manual timer scheduler: the helper keeps at most one timer pending at a time,
// so fire() = "the idle window elapsed".
const manualTimers = () => {
  let seq = 0;
  const pending = new Map<number, () => void>();
  return {
    timers: {
      set: (callback: () => void) => {
        const id = ++seq;
        pending.set(id, callback);
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      clear: (handle: ReturnType<typeof setTimeout>) => {
        pending.delete(handle as unknown as number);
      }
    },
    fire: () => {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const cb of callbacks) cb();
    },
    pendingCount: () => pending.size
  };
};

test('fires onIdle after an idle window with no data, then stops when onIdle is false', () => {
  const src = new EventEmitter();
  const t = manualTimers();
  let idleCalls = 0;
  wireStreamStallTimeout(src as never, 100, () => {
    idleCalls += 1;
    return false; // upstream really stalled → tear down, don't re-arm
  }, t.timers);

  assert.equal(t.pendingCount(), 1, 'armed immediately');
  t.fire(); // idle window elapsed
  assert.equal(idleCalls, 1);
  assert.equal(t.pendingCount(), 0, 'stopped — no re-arm after a kill');

  t.fire(); // nothing pending
  assert.equal(idleCalls, 1, 'does not fire again after stopping');
});

test('a data chunk re-arms the timer — a healthy live stream never trips', () => {
  const src = new EventEmitter();
  const t = manualTimers();
  let idleCalls = 0;
  wireStreamStallTimeout(src as never, 100, () => {
    idleCalls += 1;
    return false;
  }, t.timers);

  // Data keeps arriving — every chunk re-arms, so onIdle is never reached.
  src.emit('data', Buffer.from('a'));
  src.emit('data', Buffer.from('b'));
  src.emit('data', Buffer.from('c'));
  assert.equal(idleCalls, 0, 'never fired while data flows');
  assert.equal(t.pendingCount(), 1, 'still exactly one armed timer');

  // ...but once the data STOPS, the next window trips it.
  t.fire();
  assert.equal(idleCalls, 1);
});

test('onIdle returning true re-arms (tolerates downstream backpressure)', () => {
  const src = new EventEmitter();
  const t = manualTimers();
  let idleCalls = 0;
  wireStreamStallTimeout(src as never, 100, () => {
    idleCalls += 1;
    return idleCalls < 2; // first tick: backpressure → keep watching; second: kill
  }, t.timers);

  t.fire(); // idle 1 → onIdle true → re-arm
  assert.equal(idleCalls, 1);
  assert.equal(t.pendingCount(), 1, 're-armed after a backpressure tick');

  t.fire(); // idle 2 → onIdle false → stop
  assert.equal(idleCalls, 2);
  assert.equal(t.pendingCount(), 0);
});

for (const endEvent of ['end', 'close', 'error'] as const) {
  test(`'${endEvent}' disarms the watchdog — onIdle never fires afterward`, () => {
    const src = new EventEmitter();
    const t = manualTimers();
    let idleCalls = 0;
    wireStreamStallTimeout(src as never, 100, () => {
      idleCalls += 1;
      return false;
    }, t.timers);

    src.emit(endEvent);
    assert.equal(t.pendingCount(), 0, 'timer cleared on stream end');
    t.fire();
    assert.equal(idleCalls, 0);
  });
}

test('the disposer stops the watchdog', () => {
  const src = new EventEmitter();
  const t = manualTimers();
  let idleCalls = 0;
  const stop = wireStreamStallTimeout(src as never, 100, () => {
    idleCalls += 1;
    return false;
  }, t.timers);

  stop();
  assert.equal(t.pendingCount(), 0);
  t.fire();
  assert.equal(idleCalls, 0);
});

test('idleMs <= 0 disables the watchdog (no timer, safe disposer)', () => {
  const src = new EventEmitter();
  const t = manualTimers();
  let idleCalls = 0;
  const stop = wireStreamStallTimeout(src as never, 0, () => {
    idleCalls += 1;
    return false;
  }, t.timers);

  assert.equal(t.pendingCount(), 0, 'nothing armed');
  src.emit('data', Buffer.from('a'));
  t.fire();
  assert.equal(idleCalls, 0);
  assert.doesNotThrow(() => stop());
});

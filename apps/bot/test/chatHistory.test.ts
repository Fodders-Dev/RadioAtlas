import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatHistory } from '../src/chatHistory.js';

test('an unknown user starts with empty history', () => {
  const h = createChatHistory({ now: () => 0 });
  assert.deepEqual(h.get('u1'), []);
});

test('record then get returns the exchange as user/assistant turns in order', () => {
  const h = createChatHistory({ now: () => 1000 });
  h.record('u1', 'радио для драки', 'Вот хардкор.');
  assert.deepEqual(h.get('u1'), [
    { role: 'user', text: 'радио для драки' },
    { role: 'assistant', text: 'Вот хардкор.' }
  ]);
});

test('history is per-user (one user never sees another)', () => {
  const h = createChatHistory({ now: () => 1 });
  h.record('u1', 'a', 'A');
  h.record('u2', 'b', 'B');
  assert.deepEqual(h.get('u1'), [
    { role: 'user', text: 'a' },
    { role: 'assistant', text: 'A' }
  ]);
  assert.deepEqual(h.get('u2'), [
    { role: 'user', text: 'b' },
    { role: 'assistant', text: 'B' }
  ]);
});

test('keeps only the last maxTurns turns (oldest exchange drops)', () => {
  const h = createChatHistory({ maxTurns: 4, now: () => 1 });
  h.record('u1', 'q1', 'a1');
  h.record('u1', 'q2', 'a2');
  h.record('u1', 'q3', 'a3'); // 6 turns → trimmed to last 4
  assert.deepEqual(h.get('u1'), [
    { role: 'user', text: 'q2' },
    { role: 'assistant', text: 'a2' },
    { role: 'user', text: 'q3' },
    { role: 'assistant', text: 'a3' }
  ]);
});

test('an idle conversation expires after ttlMs (a new topic does not bleed in)', () => {
  let clock = 0;
  const h = createChatHistory({ ttlMs: 1000, now: () => clock });
  h.record('u1', 'котёнок-поварёнок', 'JPop Kawaii');
  clock = 1500; // past the idle window
  assert.deepEqual(h.get('u1'), []);
  // and a fresh record after expiry starts clean, not appended to the stale turns
  h.record('u1', 'русский рок', 'Наше Радио');
  assert.deepEqual(h.get('u1'), [
    { role: 'user', text: 'русский рок' },
    { role: 'assistant', text: 'Наше Радио' }
  ]);
});

test('long turns are clamped so memory stays bounded', () => {
  const h = createChatHistory({ maxTextLen: 10, now: () => 1 });
  h.record('u1', 'x'.repeat(50), 'y'.repeat(50));
  assert.deepEqual(h.get('u1'), [
    { role: 'user', text: 'x'.repeat(10) },
    { role: 'assistant', text: 'y'.repeat(10) }
  ]);
});

test('empty user id or blank texts are ignored (no half-turns)', () => {
  const h = createChatHistory({ now: () => 1 });
  h.record('', 'q', 'a');
  h.record('u1', '   ', 'a');
  h.record('u1', 'q', '   ');
  assert.deepEqual(h.get('u1'), []);
});

test('over maxUsers, the least-recently-seen user is evicted', () => {
  let clock = 0;
  const h = createChatHistory({ maxUsers: 2, now: () => (clock += 1) });
  h.record('u1', 'a', 'A'); // seen @1
  h.record('u2', 'b', 'B'); // seen @2
  h.record('u3', 'c', 'C'); // seen @3 → u1 (oldest) evicted
  assert.deepEqual(h.get('u1'), []);
  assert.equal(h.get('u2').length, 2);
  assert.equal(h.get('u3').length, 2);
});

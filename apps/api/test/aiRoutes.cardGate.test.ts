import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

/**
 * `PLAN.md` asks to re-check the opinion-question gate "against real
 * transcripts" before widening its vocabulary. There are none: a retained agent
 * run carries provider, route, steps, timings and tokens — deliberately no
 * prompt text — so the only honest production evidence is a counter.
 *
 * These are the three questions worth answering about the gate, and each one is
 * a separate counter:
 *   - which predicate fires at all (`ai_cards_gate:<reason>`)
 *   - how often it actually removes cards (`ai_cards_gate_dropped`)
 *   - how often an explicit music request rescues them (`ai_cards_gate_released`)
 *
 * A reason that never fires is not an argument for widening it. A rising
 * `released` count is an argument that a predicate has grown too greedy.
 */
process.env.OBSERVABILITY_STORE_PATH =
  process.env.OBSERVABILITY_STORE_PATH ||
  join(tmpdir(), `radioatlas-observability-cardgate-${process.pid}.json`);

const { recordChatTelemetry } = await import('../src/aiRoutes.js');
const { getObservabilitySnapshot } = await import('../src/observabilityStore.js');
import type { CardGateSignal, ChatResult } from '../src/ai/types.js';

const counter = (key: string) => Number(getObservabilitySnapshot().counters[key] || 0);

const chatResult = (cardGate: CardGateSignal): ChatResult => ({
  reply: 'ok',
  stations: [],
  serviceLinks: [],
  sources: [],
  actions: [],
  cardGate
});

test('an opinion question that loses its cards is counted, not transcribed', () => {
  const before = {
    opinion: counter('ai_cards_gate:opinion'),
    dropped: counter('ai_cards_gate_dropped'),
    released: counter('ai_cards_gate_released')
  };

  recordChatTelemetry(
    'miniapp',
    Date.now(),
    chatResult({ reasons: ['opinion'], released: false, droppedCards: 3 })
  );

  assert.equal(counter('ai_cards_gate:opinion'), before.opinion + 1);
  assert.equal(counter('ai_cards_gate_dropped'), before.dropped + 1);
  assert.equal(counter('ai_cards_gate_released'), before.released, 'nothing was rescued here');
});

test('a request wearing a question mark is counted as released, not dropped', () => {
  const before = {
    song: counter('ai_cards_gate:song_topic'),
    dropped: counter('ai_cards_gate_dropped'),
    released: counter('ai_cards_gate_released')
  };

  recordChatTelemetry(
    'miniapp',
    Date.now(),
    chatResult({ reasons: ['song_topic'], released: true, droppedCards: 0 })
  );

  assert.equal(counter('ai_cards_gate:song_topic'), before.song + 1);
  assert.equal(counter('ai_cards_gate_dropped'), before.dropped, 'the cards survived');
  assert.equal(counter('ai_cards_gate_released'), before.released + 1);
});

test('an ordinary music request mints no gate counters at all', () => {
  const before = Object.keys(getObservabilitySnapshot().counters).filter((key) =>
    key.startsWith('ai_cards_gate')
  );
  const beforeValues = before.map(counter);

  recordChatTelemetry('miniapp', Date.now(), chatResult({ reasons: [], released: false, droppedCards: 0 }));

  assert.deepEqual(before.map(counter), beforeValues, 'a plain ask must stay invisible to this family');
});

test('the counter keys stay a closed set', () => {
  // Counters are the one structure the age-based prune never touches, so an
  // open-ended key would be a slow memory leak as well as unreadable telemetry.
  const keys = Object.keys(getObservabilitySnapshot().counters).filter((key) =>
    key.startsWith('ai_cards_gate')
  );
  const allowed = new Set([
    'ai_cards_gate:knowledge',
    'ai_cards_gate:song',
    'ai_cards_gate:song_topic',
    'ai_cards_gate:opinion',
    'ai_cards_gate_dropped',
    'ai_cards_gate_released'
  ]);
  for (const key of keys) {
    assert.equal(allowed.has(key), true, `unexpected counter key: ${key}`);
  }
});

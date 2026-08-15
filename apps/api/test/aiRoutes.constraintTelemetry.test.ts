import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

/**
 * Two things the roadmap says to WATCH in production, neither of which emitted
 * anything before this:
 *
 * 1. The explicit «без …» constraint filter. It logged a line and nothing else,
 *    so "expand the audited exclusion vocabulary from real misses" had no way
 *    to see a miss. `ai_exclusion_unmatched` is that miss: a listener excluded
 *    something the hand-audited list does not know.
 * 2. Action receipts. They were parsed, validated and fed to the next turn —
 *    and counted nowhere, so a client that FAILED to carry out an action Lira
 *    had promised left no trace on the server at all.
 *
 * Both key spaces are closed and repo-owned. The excluded clause itself is
 * reduced to a boolean and never becomes a counter key: a key built from chat
 * text is unbounded key minting, and counters are the one structure the
 * age-based prune never touches.
 */
process.env.OBSERVABILITY_STORE_PATH =
  process.env.OBSERVABILITY_STORE_PATH ||
  join(tmpdir(), `radioatlas-observability-constraints-${process.pid}.json`);

const { recordChatTelemetry } = await import('../src/aiRoutes.js');
const { getObservabilitySnapshot } = await import('../src/observabilityStore.js');
const { explicitStationExclusionIds } = await import('../src/ai/brain.js');
import type { ClientActionReceipt, ConstraintFilterSignal, ChatResult } from '../src/ai/types.js';

const counter = (key: string) => Number(getObservabilitySnapshot().counters[key] || 0);

const chatResult = (over: Partial<ChatResult> = {}): ChatResult => ({
  reply: 'ok',
  stations: [],
  serviceLinks: [],
  sources: [],
  actions: [],
  ...over
});

const constraint = (over: Partial<ConstraintFilterSignal> = {}): ConstraintFilterSignal => ({
  clauses: 0,
  matchedIds: [],
  removedCards: 0,
  unmatchedClause: false,
  emptiedEverything: false,
  ...over
});

test('a known exclusion that removes cards is counted by id', () => {
  const before = {
    clause: counter('ai_exclusion_clause'),
    chanson: counter('ai_exclusion_matched:chanson'),
    removed: counter('ai_exclusion_removed'),
    unmatched: counter('ai_exclusion_unmatched')
  };

  recordChatTelemetry(
    'miniapp',
    Date.now(),
    chatResult({
      constraintFilter: constraint({ clauses: 1, matchedIds: ['chanson'], removedCards: 4 })
    })
  );

  assert.equal(counter('ai_exclusion_clause'), before.clause + 1);
  assert.equal(counter('ai_exclusion_matched:chanson'), before.chanson + 1);
  assert.equal(counter('ai_exclusion_removed'), before.removed + 1);
  assert.equal(counter('ai_exclusion_unmatched'), before.unmatched, 'this one was understood');
});

test('an exclusion the vocabulary does not know is counted as a miss', () => {
  // This is the counter that decides whether the vocabulary should grow. It
  // says a miss happened; it deliberately does not say what was asked.
  const before = {
    clause: counter('ai_exclusion_clause'),
    unmatched: counter('ai_exclusion_unmatched'),
    removed: counter('ai_exclusion_removed')
  };

  recordChatTelemetry(
    'miniapp',
    Date.now(),
    chatResult({ constraintFilter: constraint({ clauses: 1, unmatchedClause: true }) })
  );

  assert.equal(counter('ai_exclusion_clause'), before.clause + 1);
  assert.equal(counter('ai_exclusion_unmatched'), before.unmatched + 1);
  assert.equal(counter('ai_exclusion_removed'), before.removed, 'nothing was removed');
});

test('a constraint that leaves nothing to listen to is counted separately', () => {
  const before = counter('ai_exclusion_emptied');
  recordChatTelemetry(
    'miniapp',
    Date.now(),
    chatResult({
      constraintFilter: constraint({
        clauses: 1,
        matchedIds: ['dnb'],
        removedCards: 6,
        emptiedEverything: true
      })
    })
  );
  assert.equal(counter('ai_exclusion_emptied'), before + 1);
});

test('a turn without any exclusion clause mints nothing', () => {
  const keys = Object.keys(getObservabilitySnapshot().counters).filter((key) =>
    key.startsWith('ai_exclusion')
  );
  const before = keys.map(counter);
  recordChatTelemetry('miniapp', Date.now(), chatResult({ constraintFilter: constraint() }));
  assert.deepEqual(keys.map(counter), before);
});

test('action receipts are counted by kind and status, with a failure aggregate', () => {
  const before = {
    played: counter('ai_action_receipt:play:executed'),
    queued: counter('ai_action_receipt:enqueue:skipped'),
    failed: counter('ai_action_receipt:set-favorite:failed'),
    aggregate: counter('ai_action_receipt_failed')
  };

  const receipts: ClientActionReceipt[] = [
    { actionId: 'a1', kind: 'play', status: 'executed' },
    { actionId: 'a2', kind: 'enqueue', status: 'skipped' },
    { actionId: 'a3', kind: 'set-favorite', status: 'failed' }
  ];
  recordChatTelemetry('miniapp', Date.now(), chatResult(), receipts);

  assert.equal(counter('ai_action_receipt:play:executed'), before.played + 1);
  assert.equal(counter('ai_action_receipt:enqueue:skipped'), before.queued + 1);
  assert.equal(counter('ai_action_receipt:set-favorite:failed'), before.failed + 1);
  assert.equal(counter('ai_action_receipt_failed'), before.aggregate + 1, 'only the failure aggregates');
});

test('grounding outcomes are counted, and a degraded one aggregates', () => {
  const before = {
    ok: counter('ai_web_search:ok'),
    capped: counter('ai_web_search:capped'),
    error: counter('ai_web_search:error'),
    degraded: counter('ai_web_search_degraded')
  };

  recordChatTelemetry(
    'miniapp',
    Date.now(),
    chatResult({ webSearchStatuses: ['ok', 'capped', 'error'] })
  );

  assert.equal(counter('ai_web_search:ok'), before.ok + 1);
  assert.equal(counter('ai_web_search:capped'), before.capped + 1);
  assert.equal(counter('ai_web_search:error'), before.error + 1);
  assert.equal(
    counter('ai_web_search_degraded'),
    before.degraded + 2,
    'capped and error both mean she answered without the sources she should have cited'
  );
});

test('a turn that never searched the web mints no grounding counters', () => {
  const keys = Object.keys(getObservabilitySnapshot().counters).filter((key) =>
    key.startsWith('ai_web_search')
  );
  const before = keys.map(counter);
  recordChatTelemetry('miniapp', Date.now(), chatResult({ webSearchStatuses: [] }));
  assert.deepEqual(keys.map(counter), before);
});

test('both key spaces stay closed', () => {
  const keys = Object.keys(getObservabilitySnapshot().counters);

  const exclusionIds = keys
    .filter((key) => key.startsWith('ai_exclusion_matched:'))
    .map((key) => key.slice('ai_exclusion_matched:'.length));
  for (const id of exclusionIds) {
    // Every id must be one the repo-owned vocabulary can actually produce, so
    // no counter key can originate in chat text.
    assert.ok(
      explicitStationExclusionIds(`без ${id}`).includes(id) || /^[a-z][a-z0-9_]*$/.test(id),
      `unexpected exclusion id: ${id}`
    );
  }

  const searchStatuses = new Set(['ok', 'empty', 'capped', 'error', 'disabled']);
  for (const key of keys.filter((candidate) => candidate.startsWith('ai_web_search:'))) {
    const status = key.slice('ai_web_search:'.length);
    assert.ok(searchStatuses.has(status), `unexpected web search status: ${status}`);
  }

  const receiptKinds = new Set(['play', 'open-station', 'enqueue', 'set-favorite', 'pause', 'none']);
  const receiptStatuses = new Set(['executed', 'skipped', 'failed']);
  for (const key of keys.filter((candidate) => candidate.startsWith('ai_action_receipt:'))) {
    const rest = key.slice('ai_action_receipt:'.length);
    const status = rest.slice(rest.lastIndexOf(':') + 1);
    const kind = rest.slice(0, rest.lastIndexOf(':'));
    assert.ok(receiptKinds.has(kind), `unexpected action kind: ${kind}`);
    assert.ok(receiptStatuses.has(status), `unexpected receipt status: ${status}`);
  }
});

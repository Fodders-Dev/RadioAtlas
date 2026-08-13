import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseActionReceipts,
  parseAgentClientContext,
  parseSafetyIdentifier
} from '../src/aiRoutes.js';

test('agent client context is bounded and de-duplicated', () => {
  const context = parseAgentClientContext({
    isPlaying: true,
    queueStationIds: ['station-1', 'station-1', '', ...Array.from({ length: 100 }, (_, i) => `s-${i}`)]
  });
  assert.equal(context?.isPlaying, true);
  assert.equal(context?.queueStationIds?.length, 80);
  assert.equal(context?.queueStationIds?.[0], 'station-1');
});

test('action receipts accept only finite enums and safe identifiers', () => {
  assert.deepEqual(
    parseActionReceipts([
      { actionId: 'run:1', kind: 'enqueue', status: 'executed', stationuuid: 'station-1', detail: 'ignored' },
      { actionId: 'run:\ninject', kind: 'pause', status: 'executed' },
      { actionId: 'run:2', kind: 'delete-account', status: 'executed' }
    ]),
    [{ actionId: 'run:1', kind: 'enqueue', status: 'executed', stationuuid: 'station-1' }]
  );
});

test('OpenAI safety identifier parser rejects control characters and oversized input', () => {
  assert.equal(parseSafetyIdentifier('lira:device-123'), 'lira:device-123');
  assert.equal(parseSafetyIdentifier('lira:\nspoof'), undefined);
  assert.equal(parseSafetyIdentifier(`lira:${'x'.repeat(130)}`), undefined);
});

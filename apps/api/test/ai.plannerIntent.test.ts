import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePlannerDecision } from '../src/ai/tools.js';

const parse = (value: unknown) => parsePlannerDecision(JSON.stringify(value));

test('keeps each allowlisted planner intent on final decisions', () => {
  const cases = ['recommend', 'chat', 'knowledge', 'clarify'] as const;
  for (const intent of cases) {
    assert.deepEqual(parse({ action: 'final', intent, note: 'final text' }), {
      action: 'final',
      note: 'final text',
      intent
    });
  }
});

test('preserves an allowlisted intent without changing valid tool parsing', () => {
  assert.deepEqual(parse({
    action: 'use_tool',
    tool: 'search_stations',
    args: { query: 'jazz', country: 'Japan' },
    note: 'search note',
    intent: 'recommend'
  }), {
    action: 'use_tool',
    tool: 'search_stations',
    args: { query: 'jazz', country: 'Japan' },
    note: 'search note',
    intent: 'recommend'
  });
});

test('omits missing or invalid intents and never infers intent from note', () => {
  for (const decision of [
    { action: 'final' },
    { action: 'final', intent: 'Recommend' },
    { action: 'final', intent: 'unknown' },
    { action: 'final', intent: { value: 'chat' } },
    { action: 'final', intent: ['chat'] },
    { action: 'final', intent: null },
    { action: 'final', intent: 7 },
    { action: 'final', note: 'recommend' }
  ]) {
    assert.equal(parse(decision).intent, undefined, JSON.stringify(decision));
  }
});

test('an invalid tool falls back to final while retaining an explicit valid intent', () => {
  assert.deepEqual(parse({
    action: 'use_tool',
    tool: 'admin_override',
    args: { unrestricted: true },
    note: 'bad tool',
    intent: 'clarify'
  }), {
    action: 'final',
    note: 'bad tool',
    intent: 'clarify'
  });
});

test('extracts a valid intent from the existing fenced-JSON format', () => {
  const decision = parsePlannerDecision('```json\n{"action":"final","intent":"knowledge","note":"answer directly"}\n```');
  assert.deepEqual(decision, { action: 'final', note: 'answer directly', intent: 'knowledge' });
});

test('invalid action still becomes final without inventing an intent', () => {
  assert.deepEqual(parse({ action: 'recommend', note: 'plain text' }), { action: 'final', note: 'plain text' });
});

test('semantic brief is accepted only for an explicit recommendation search or final',()=>{
  const semanticSearch = {kind:'hypothesis',tags:['drum and bass','breakbeat']};
  for(const action of ['use_tool','final']) assert.deepEqual(parse({action,intent:'recommend',tool:'search_stations',semanticSearch}).semanticSearch,semanticSearch);
  for(const intent of ['knowledge','chat','clarify',undefined]) assert.equal(parse({action:'use_tool',tool:'search_stations',intent,semanticSearch}).semanticSearch,undefined);
  for(const tool of ['get_station','find_stations_by_artist','admin_override']) assert.equal(parse({action:'use_tool',tool,intent:'recommend',semanticSearch}).semanticSearch,undefined);
  assert.equal(parse({action:'invalid',intent:'recommend',semanticSearch}).semanticSearch,undefined);
  assert.equal(parse({action:'final',intent:'recommend',semanticSearch:{...semanticSearch,tags:['jazz','<script>']}}).semanticSearch,undefined);
});

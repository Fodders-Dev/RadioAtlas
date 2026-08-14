import assert from 'node:assert/strict';
import test from 'node:test';
import { callModel } from '../src/ai/modelClient.js';

test('OpenAI provider uses Responses API with bounded structured output and safety id', async () => {
  let url = '';
  let requestBody: Record<string, unknown> = {};
  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    url = String(input);
    requestBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({ output_text: '{"action":"final"}', usage: { input_tokens: 7, output_tokens: 3 } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  const result = await callModel(
    {
      provider: 'openai',
      enabled: true,
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.test/v1/',
      model: 'gpt-5.6-luna',
      maxOutputTokens: 300,
      timeoutSec: 2,
      reasoningEffort: 'low'
    },
    [{ role: 'system', content: 'policy' }, { role: 'user', content: 'hello' }],
    {
      temperature: 0,
      maxTokens: 120,
      safetyIdentifier: 'lira:test-user',
      jsonSchema: { name: 'decision', schema: { type: 'object' } }
    },
    fetchMock
  );

  assert.equal(url, 'https://api.openai.test/v1/responses');
  assert.equal(requestBody.model, 'gpt-5.6-luna');
  assert.equal(requestBody.store, false);
  assert.equal(requestBody.safety_identifier, 'lira:test-user');
  assert.equal((requestBody.input as Array<{ role: string }>)[0]?.role, 'developer');
  assert.equal(
    (((requestBody.text as { format: { strict: boolean } }).format).strict),
    false
  );
  assert.equal(result.content, '{"action":"final"}');
  assert.deepEqual(result.usage, { prompt: 7, completion: 3 });
});

test('model failures carry an operator-facing kind, not just a message', async () => {
  const respondWith = (status: number) =>
    (async () =>
      new Response(JSON.stringify({ error: { message: 'nope' } }), {
        status,
        headers: { 'Content-Type': 'application/json' }
      })) as typeof fetch;

  const config = {
    provider: 'deepseek' as const,
    enabled: true,
    apiKey: 'test-key',
    baseUrl: 'https://deepseek.test',
    model: 'deepseek-v4-pro',
    maxOutputTokens: 200,
    timeoutSec: 2
  };
  const call = (status: number) =>
    callModel(config, [{ role: 'user', content: 'hi' }], { temperature: 0, maxTokens: 10 }, respondWith(status));

  // 402 is the exact production failure: an exhausted balance that used to be
  // indistinguishable from a healthy turn.
  assert.equal((await call(402)).errorKind, 'billing');
  assert.equal((await call(401)).errorKind, 'auth');
  assert.equal((await call(429)).errorKind, 'rate_limit');
  assert.equal((await call(503)).errorKind, 'provider_unavailable');
  assert.equal((await call(418)).errorKind, 'http');
  assert.equal((await call(402)).error, 'deepseek http 402');
});

test('a disabled model is configuration, not an outage, and stays unclassified', async () => {
  const result = await callModel(
    {
      provider: 'openai',
      enabled: false,
      apiKey: '',
      baseUrl: 'https://api.openai.test/v1',
      model: 'gpt-5.6-luna',
      maxOutputTokens: 200,
      timeoutSec: 2
    },
    [{ role: 'user', content: 'hi' }],
    { temperature: 0, maxTokens: 10 },
    globalThis.fetch
  );
  assert.equal(result.error, 'disabled');
  assert.equal(result.errorKind, undefined);
});

test('a network throw is classified without echoing provider prose', async () => {
  const boom = (async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:443');
  }) as typeof fetch;
  const result = await callModel(
    {
      provider: 'deepseek',
      enabled: true,
      apiKey: 'test-key',
      baseUrl: 'https://deepseek.test',
      model: 'deepseek-v4-pro',
      maxOutputTokens: 200,
      timeoutSec: 2
    },
    [{ role: 'user', content: 'hi' }],
    { temperature: 0, maxTokens: 10 },
    boom
  );
  assert.equal(result.errorKind, 'network');
});

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

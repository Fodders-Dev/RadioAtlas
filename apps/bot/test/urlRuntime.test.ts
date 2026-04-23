import assert from 'node:assert/strict';
import test from 'node:test';
import { createBotUrlRuntime } from '../src/urlRuntime.js';

test('url runtime prefers API origin when configured web app origin diverges', () => {
  const runtime = createBotUrlRuntime({
    apiUrl: 'https://radioatlas.duckdns.org/api',
    webAppUrl: 'https://radio-atlas-miniapp.vercel.app',
    sourceCommit: 'abcdef123456'
  });

  assert.equal(runtime.apiUrl, 'https://radioatlas.duckdns.org/api');
  assert.equal(runtime.webAppUrl, 'https://radioatlas.duckdns.org/');
  assert.match(runtime.withMiniAppParam('premium'), /start=premium/);
  assert.match(runtime.withMiniAppParam('premium'), /api=https%3A%2F%2Fradioatlas\.duckdns\.org%2Fapi/);
  assert.match(runtime.withMiniAppParam('premium'), /v=abcdef1/);
});

test('url runtime drops invalid inputs instead of producing broken links', () => {
  const runtime = createBotUrlRuntime({
    apiUrl: 'not a url',
    webAppUrl: '',
    sourceCommit: ''
  });

  assert.equal(runtime.apiUrl, '');
  assert.equal(runtime.webAppUrl, '');
  assert.equal(runtime.withMiniAppParam('support'), '');
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_TELEGRAM_API_ROOT,
  resolveTelegramApiRoot
} from '../src/telegramApiRoot.js';

/**
 * Billing reaches Telegram through a configurable host, because on the Russian
 * box Telegram's own host does not answer: measured 2026-08-31, TCP to
 * api.telegram.org:443 never connects, three attempts, no response in 20 s.
 * `createInvoiceLink` and `getStarTransactions` are the money paths, so this is
 * not a convenience.
 *
 * ⚠ Every call carries the bot token IN THE PATH, so these rules are about
 * where a token may travel.
 *
 * The bot has its own copy of this (apps/bot/src/telegramApiRoot.ts) with a
 * matching test — separate workspaces, no shared package. Change one, change
 * both.
 */

test('unset means Telegram itself', () => {
  for (const value of [undefined, '', '   ']) {
    assert.deepEqual(resolveTelegramApiRoot(value), {
      root: DEFAULT_TELEGRAM_API_ROOT,
      isDefault: true
    });
  }
});

test('a configured host is used, and normalised', () => {
  assert.deepEqual(resolveTelegramApiRoot('https://relay.example.test/tg///'), {
    root: 'https://relay.example.test/tg',
    isDefault: false
  });
});

test('a value that is not a URL is an error, not a silent fallback to Telegram', () => {
  // A fallback would leave billing pointed at a host it cannot reach, which
  // looks exactly like the outage this exists to fix.
  const result = resolveTelegramApiRoot('relay.example.test');
  assert.ok('error' in result);
  assert.match(result.error, /not a URL/);
});

test('plaintext to a remote host is refused: the token is in the path', () => {
  const result = resolveTelegramApiRoot('http://relay.example.test');
  assert.ok('error' in result);
  assert.match(result.error, /https/);
});

test('plaintext to this machine is allowed, for a local forwarder', () => {
  for (const value of ['http://localhost:8081', 'http://127.0.0.1:8081']) {
    assert.ok(!('error' in resolveTelegramApiRoot(value)), `${value} should be accepted`);
  }
});

test('a non-http scheme is refused', () => {
  for (const value of ['ftp://relay.test', 'file:///etc/passwd', 'socks5://127.0.0.1:1080']) {
    assert.ok('error' in resolveTelegramApiRoot(value), `${value} must be refused`);
  }
});

test('a query or fragment is refused, because the token and method are appended', () => {
  for (const value of ['https://relay.test/?token=1', 'https://relay.test/#x']) {
    assert.ok('error' in resolveTelegramApiRoot(value), `${value} must be refused`);
  }
});

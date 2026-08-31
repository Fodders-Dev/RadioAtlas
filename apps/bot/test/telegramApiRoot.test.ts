import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_TELEGRAM_API_ROOT,
  resolveTelegramApiRoot
} from '../src/telegramApiRoot.js';

/**
 * The bot talks to Telegram through a configurable host, because on the Russian
 * box Telegram's own host does not answer: measured 2026-08-31, TCP to
 * api.telegram.org:443 never connects, three attempts, no response in 20 s.
 *
 * ⚠ Every Bot API call carries the token IN THE PATH, so these rules are about
 * where a token is allowed to travel, not about tidiness.
 */

test('unset means Telegram itself, which is right everywhere but one box', () => {
  for (const value of [undefined, '', '   ']) {
    const result = resolveTelegramApiRoot(value);
    assert.deepEqual(result, { root: DEFAULT_TELEGRAM_API_ROOT, isDefault: true });
  }
});

test('a configured host is used, and normalised', () => {
  const result = resolveTelegramApiRoot('https://relay.example.test/tg///');
  assert.deepEqual(result, { root: 'https://relay.example.test/tg', isDefault: false });
});

test('a value that is not a URL stops the process instead of falling back', () => {
  // Falling back to api.telegram.org would leave the bot running and
  // unreachable — indistinguishable from the broken state this exists to fix,
  // and with no way to tell a typo from a blockade.
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
  // A tunnel endpoint bound to loopback never puts the token on a wire.
  for (const value of ['http://localhost:8081', 'http://127.0.0.1:8081']) {
    const result = resolveTelegramApiRoot(value);
    assert.ok(!('error' in result), `${value} should be accepted`);
  }
});

test('a non-http scheme is refused', () => {
  for (const value of ['ftp://relay.test', 'file:///etc/passwd', 'socks5://127.0.0.1:1080']) {
    const result = resolveTelegramApiRoot(value);
    assert.ok('error' in result, `${value} must be refused`);
  }
});

test('a query or fragment is refused, because grammy appends to this', () => {
  // The client builds `<root>/bot<token>/<method>`; a query here would land in
  // the middle of the URL and 404 in a way nobody enjoys debugging.
  for (const value of ['https://relay.test/?token=1', 'https://relay.test/#x']) {
    const result = resolveTelegramApiRoot(value);
    assert.ok('error' in result, `${value} must be refused`);
  }
});

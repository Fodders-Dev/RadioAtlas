import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EGRESS_HOP_HEADER,
  buildForeignEgressUrl,
  fetchViaForeignEgress,
  isEgressHop,
  readForeignEgressConfig
} from '../src/media/foreignEgress.js';

/**
 * The second way out, for stations the Russian host cannot reach.
 *
 * Measured 2026-08-31, 148 stations, two passes per host: 122 and 123 reachable
 * from the RU box, 135 both times from the Netherlands one, with eleven
 * consistently reachable only from NL. Half the catalogue is `http://` and so
 * can ONLY play through this proxy, which is why the server's own reachability
 * decides whether those stations play.
 */

test('the fallback is off unless a base is configured', () => {
  assert.equal(readForeignEgressConfig({}, 12_000), null);
  assert.equal(readForeignEgressConfig({ MEDIA_FOREIGN_EGRESS_BASE: '' }, 12_000), null);
  assert.equal(readForeignEgressConfig({ MEDIA_FOREIGN_EGRESS_BASE: '   ' }, 12_000), null);
});

test('a base that is not an http(s) URL is refused rather than half-used', () => {
  // A typo here would otherwise become a runtime failure on the one path that
  // only ever runs when something is already broken.
  assert.equal(readForeignEgressConfig({ MEDIA_FOREIGN_EGRESS_BASE: 'not a url' }, 12_000), null);
  assert.equal(
    readForeignEgressConfig({ MEDIA_FOREIGN_EGRESS_BASE: 'ftp://example.test' }, 12_000),
    null
  );
  assert.equal(
    readForeignEgressConfig({ MEDIA_FOREIGN_EGRESS_BASE: 'file:///etc/passwd' }, 12_000),
    null
  );
});

test('the configured base loses its trailing slash so the join is predictable', () => {
  const config = readForeignEgressConfig(
    { MEDIA_FOREIGN_EGRESS_BASE: 'https://relay.test/api///' },
    12_000
  );
  assert.ok(config);
  assert.equal(config.base, 'https://relay.test/api');
  assert.equal(config.timeoutMs, 12_000);
});

test('the timeout can be overridden, and nonsense falls back to the default', () => {
  const base = 'https://relay.test/api';
  assert.equal(
    readForeignEgressConfig(
      { MEDIA_FOREIGN_EGRESS_BASE: base, MEDIA_FOREIGN_EGRESS_TIMEOUT_MS: '30000' },
      12_000
    )?.timeoutMs,
    30_000
  );
  for (const bad of ['0', '-5', 'soon', '']) {
    assert.equal(
      readForeignEgressConfig(
        { MEDIA_FOREIGN_EGRESS_BASE: base, MEDIA_FOREIGN_EGRESS_TIMEOUT_MS: bad },
        12_000
      )?.timeoutMs,
      12_000,
      `MEDIA_FOREIGN_EGRESS_TIMEOUT_MS=${bad} must fall back`
    );
  }
});

test('the target is encoded, so a stream URL carrying its own query survives', () => {
  // Query strings are part of a stream's identity here — proxied stations use
  // ?q= / ?uri= / ?sid= — so losing them would fetch a different stream, or
  // none.
  const url = buildForeignEgressUrl(
    'https://relay.test/api',
    'http://ice.example/live?sid=1&fmt=mp3'
  );
  assert.equal(
    url,
    'https://relay.test/api/stream?url=http%3A%2F%2Fice.example%2Flive%3Fsid%3D1%26fmt%3Dmp3'
  );
  const roundTripped = new URL(url).searchParams.get('url');
  assert.equal(roundTripped, 'http://ice.example/live?sid=1&fmt=mp3');
});

test('a hop marks itself, and a marked request is recognised', () => {
  assert.equal(isEgressHop({}), false);
  assert.equal(isEgressHop({ [EGRESS_HOP_HEADER]: '0' }), false);
  assert.equal(isEgressHop({ [EGRESS_HOP_HEADER]: '1' }), true);
});

test('the hop header is sent, which is what stops two hosts ping-ponging', async () => {
  // If each host names the other, an unreachable station would bounce between
  // them until something timed out. The failure mode of that loop is a pegged
  // CPU and a listener hearing silence — no error anybody would see.
  const seen: Array<Record<string, string>> = [];
  const response = await fetchViaForeignEgress(
    { base: 'https://relay.test/api', timeoutMs: 1000 },
    'http://ice.example/live',
    { headers: { 'User-Agent': 'ra/test' } },
    async (_url, init) => {
      seen.push(init.headers);
      return new Response('audio', { status: 200 });
    }
  );
  assert.ok(response);
  assert.equal(seen.length, 1);
  const sent = seen[0];
  assert.ok(sent);
  assert.equal(sent[EGRESS_HOP_HEADER], '1');
  assert.equal(sent['User-Agent'], 'ra/test', 'the caller headers must survive');
});

test('a relay that answers badly yields null, so the station keeps its own error', async () => {
  // "The station is down" and "our relay is down" are different facts, and only
  // the first may be reported to a listener as a dead station.
  const result = await fetchViaForeignEgress(
    { base: 'https://relay.test/api', timeoutMs: 1000 },
    'http://ice.example/live',
    { headers: {} },
    async () => new Response('nope', { status: 502 })
  );
  assert.equal(result, null);
});

test('a relay that throws yields null rather than taking the request down', async () => {
  const result = await fetchViaForeignEgress(
    { base: 'https://relay.test/api', timeoutMs: 1000 },
    'http://ice.example/live',
    { headers: {} },
    async () => {
      throw new Error('connect ECONNREFUSED');
    }
  );
  assert.equal(result, null);
});

test('a refused relay response has its body released', async () => {
  // A discarded body keeps its agent pinned, and this path runs exactly when
  // things are already going wrong.
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('x'));
      controller.close();
    },
    cancel() {
      cancelled = true;
    }
  });
  const result = await fetchViaForeignEgress(
    { base: 'https://relay.test/api', timeoutMs: 1000 },
    'http://ice.example/live',
    { headers: {} },
    async () => new Response(body, { status: 503 })
  );
  assert.equal(result, null);
  assert.equal(cancelled, true, 'the refused body must be cancelled, not abandoned');
});

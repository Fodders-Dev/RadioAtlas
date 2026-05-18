import assert from 'node:assert/strict';
import type { LookupAddress } from 'node:dns';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import {
  __setSsrfAllowedHostsForTesting,
  __setSsrfDnsLookupForTesting,
  SsrfBlockedError,
  assertHostIsPublic,
  fetchWithDeadline,
  fetchWithTimeout,
  isPrivateIp,
  parseAndValidateHttpUrl
} from '../src/media/shared.js';

const ipv4 = (address: string): LookupAddress => ({ address, family: 4 });

test('isPrivateIp flags loopback, RFC1918, link-local and reserved space', () => {
  assert.equal(isPrivateIp('127.0.0.1'), true);
  assert.equal(isPrivateIp('127.255.255.254'), true);
  assert.equal(isPrivateIp('10.0.0.1'), true);
  assert.equal(isPrivateIp('192.168.1.1'), true);
  assert.equal(isPrivateIp('172.16.0.1'), true);
  assert.equal(isPrivateIp('172.31.255.255'), true);
  assert.equal(isPrivateIp('100.64.0.1'), true); // CGNAT
  assert.equal(isPrivateIp('169.254.169.254'), true); // AWS metadata
  assert.equal(isPrivateIp('0.0.0.0'), true);
  assert.equal(isPrivateIp('255.255.255.255'), true);
  assert.equal(isPrivateIp('224.0.0.1'), true); // multicast
  assert.equal(isPrivateIp('::1'), true);
  assert.equal(isPrivateIp('::'), true);
  assert.equal(isPrivateIp('fe80::1'), true);
  assert.equal(isPrivateIp('fc00::1'), true);
  assert.equal(isPrivateIp('fd12:3456:789a::1'), true);
  assert.equal(isPrivateIp('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateIp('not-an-ip'), true);
});

test('isPrivateIp allows public IPv4 and IPv6', () => {
  assert.equal(isPrivateIp('8.8.8.8'), false);
  assert.equal(isPrivateIp('1.1.1.1'), false);
  assert.equal(isPrivateIp('172.15.255.255'), false); // outside RFC1918 172.16/12
  assert.equal(isPrivateIp('172.32.0.1'), false);
  assert.equal(isPrivateIp('2606:4700:4700::1111'), false);
});

test('parseAndValidateHttpUrl rejects loopback literal with 403', async () => {
  const result = await parseAndValidateHttpUrl('http://127.0.0.1/test');
  assert.ok('error' in result);
  assert.equal(result.status, 403);
  assert.equal(result.error, 'host not allowed');
});

test('parseAndValidateHttpUrl rejects RFC1918 hostname resolved via DNS with 403', async () => {
  __setSsrfDnsLookupForTesting(async () => [ipv4('10.0.0.5')]);
  try {
    const result = await parseAndValidateHttpUrl('http://internal.example.com/status');
    assert.ok('error' in result);
    assert.equal(result.status, 403);
  } finally {
    __setSsrfDnsLookupForTesting(null);
  }
});

test('parseAndValidateHttpUrl rejects the AWS metadata IP literal', async () => {
  const result = await parseAndValidateHttpUrl('http://169.254.169.254/latest/meta-data/');
  assert.ok('error' in result);
  assert.equal(result.status, 403);
});

test('parseAndValidateHttpUrl allows a hostname resolved to a public IP', async () => {
  __setSsrfDnsLookupForTesting(async () => [ipv4('8.8.8.8')]);
  try {
    const result = await parseAndValidateHttpUrl('http://radio.example.com/stream');
    assert.ok('target' in result);
    assert.equal(result.target.hostname, 'radio.example.com');
  } finally {
    __setSsrfDnsLookupForTesting(null);
  }
});

test('parseAndValidateHttpUrl returns 400 for missing url and bad protocol', async () => {
  const empty = await parseAndValidateHttpUrl(undefined);
  assert.ok('error' in empty);
  assert.equal(empty.status, 400);
  assert.equal(empty.error, 'url is required');

  const wrongProtocol = await parseAndValidateHttpUrl('ftp://example.com/');
  assert.ok('error' in wrongProtocol);
  assert.equal(wrongProtocol.status, 400);
  assert.equal(wrongProtocol.error, 'invalid protocol');
});

test('assertHostIsPublic catches DNS rebinding on the second resolve', async () => {
  let call = 0;
  __setSsrfDnsLookupForTesting(async () => {
    call += 1;
    if (call === 1) return [ipv4('8.8.8.8')];
    return [ipv4('169.254.169.254')];
  });
  try {
    const first = await assertHostIsPublic('rebind.example.com');
    assert.equal(first[0]?.address, '8.8.8.8');

    await assert.rejects(
      assertHostIsPublic('rebind.example.com'),
      (error) =>
        error instanceof SsrfBlockedError && error.address === '169.254.169.254'
    );
  } finally {
    __setSsrfDnsLookupForTesting(null);
  }
});

test('assertHostIsPublic rejects when the resolver returns no records', async () => {
  __setSsrfDnsLookupForTesting(async () => []);
  try {
    await assert.rejects(
      assertHostIsPublic('empty.example.com'),
      (error) => error instanceof SsrfBlockedError
    );
  } finally {
    __setSsrfDnsLookupForTesting(null);
  }
});

const startControlServer = async (
  handler: (path: string) => { status: number; headers?: Record<string, string>; body?: string }
): Promise<{ url: string; port: number; server: Server; hits: string[] }> => {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    const path = req.url ?? '/';
    hits.push(path);
    const next = handler(path);
    res.writeHead(next.status, next.headers ?? {});
    res.end(next.body ?? '');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, port, server, hits };
};

const closeServer = (server: Server) =>
  new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

test('fetchWithDeadline blocks a 302 redirect that points at the AWS metadata IP', async () => {
  __setSsrfAllowedHostsForTesting(['127.0.0.1']);
  const control = await startControlServer(() => ({
    status: 302,
    headers: { Location: 'http://169.254.169.254/latest/meta-data/' },
    body: 'do-not-read-this-payload'
  }));
  try {
    await assert.rejects(
      fetchWithDeadline(`${control.url}/start`, {}, 5000),
      (error) =>
        error instanceof SsrfBlockedError && error.address === '169.254.169.254'
    );
    assert.equal(control.hits.length, 1, 'control server should be hit exactly once');
    assert.equal(control.hits[0], '/start');
  } finally {
    await closeServer(control.server);
    __setSsrfAllowedHostsForTesting(null);
  }
});

test('fetchWithTimeout blocks a redirect chain that lands on a private address', async () => {
  __setSsrfAllowedHostsForTesting(['127.0.0.1']);
  const control = await startControlServer((path) => {
    if (path === '/start') {
      return { status: 302, headers: { Location: '/hop' } };
    }
    return {
      status: 302,
      headers: { Location: 'http://10.0.0.5/internal' }
    };
  });
  try {
    await assert.rejects(
      fetchWithTimeout(`${control.url}/start`, {}, 5000),
      (error) => error instanceof SsrfBlockedError && error.address === '10.0.0.5'
    );
    assert.deepEqual(control.hits, ['/start', '/hop']);
  } finally {
    await closeServer(control.server);
    __setSsrfAllowedHostsForTesting(null);
  }
});

test('fetchWithDeadline rejects redirects that pile beyond the hop cap', async () => {
  __setSsrfAllowedHostsForTesting(['127.0.0.1']);
  const control = await startControlServer((path) => {
    const next = `${path}-x`;
    return { status: 302, headers: { Location: next } };
  });
  try {
    await assert.rejects(
      fetchWithDeadline(`${control.url}/r`, {}, 5000),
      (error) =>
        error instanceof SsrfBlockedError && /too many redirects/.test(error.reason)
    );
    assert.equal(control.hits.length, 6, 'should hit initial + 5 redirects');
  } finally {
    await closeServer(control.server);
    __setSsrfAllowedHostsForTesting(null);
  }
});

test('guarded fetch helpers still return the upstream response when no redirect is sent', async () => {
  __setSsrfAllowedHostsForTesting(['127.0.0.1']);
  const control = await startControlServer(() => ({
    status: 200,
    headers: { 'content-type': 'text/plain' },
    body: 'ok'
  }));
  try {
    const { response, cleanup } = await fetchWithDeadline(`${control.url}/payload`, {}, 5000);
    try {
      assert.equal(response.status, 200);
      assert.equal(await response.text(), 'ok');
    } finally {
      cleanup();
    }
    assert.deepEqual(control.hits, ['/payload']);
  } finally {
    await closeServer(control.server);
    __setSsrfAllowedHostsForTesting(null);
  }
});

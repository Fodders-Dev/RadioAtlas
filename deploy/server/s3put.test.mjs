import assert from 'node:assert/strict';
import test from 'node:test';
import { putObject, signRequest } from './s3put.mjs';

/**
 * The signing algorithm is checked against AWS's own published SigV4 test case
 * ("GET Object" from the Signature Version 4 test suite), so this code is
 * verified before any real bucket exists — the alternative would be shipping
 * unverified crypto and finding out during an actual restore.
 */
test('matches the AWS published SigV4 example signature', () => {
  const { signature } = signRequest({
    method: 'GET',
    host: 'examplebucket.s3.amazonaws.com',
    path: '/test.txt',
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
    service: 's3',
    amzDate: '20130524T000000Z',
    extraHeaders: { range: 'bytes=0-9' }
  });

  assert.equal(
    signature,
    'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    'signature must match the AWS reference vector'
  );
});

test('a different secret produces a different signature', () => {
  const base = {
    method: 'GET',
    host: 'examplebucket.s3.amazonaws.com',
    path: '/test.txt',
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    region: 'us-east-1',
    amzDate: '20130524T000000Z',
    extraHeaders: { range: 'bytes=0-9' }
  };
  const good = signRequest({ ...base, secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' });
  const bad = signRequest({ ...base, secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEz' });
  assert.notEqual(good.signature, bad.signature);
});

test('the PUT is addressed and signed the way R2 expects', async () => {
  const seen = {};
  const body = Buffer.from('backup-bytes');
  const result = await putObject({
    accountId: 'acct123',
    bucket: 'radioatlas-backups',
    key: 'account-store/2026-07-26.sqlite.gz',
    body,
    accessKeyId: 'AKIA_TEST',
    secretAccessKey: 'secret',
    now: new Date('2026-07-26T04:20:00.000Z'),
    fetchImpl: async (url, init) => {
      seen.url = url;
      seen.init = init;
      return { status: 200, ok: true, text: async () => '' };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(
    seen.url,
    'https://acct123.r2.cloudflarestorage.com/radioatlas-backups/account-store/2026-07-26.sqlite.gz',
    `unexpected target ${seen.url}`
  );
  assert.equal(seen.init.method, 'PUT');
  assert.match(seen.init.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=AKIA_TEST\/20260726\/auto\/s3\/aws4_request/);
  // The slash inside the key is a path separator, not an escaped character.
  assert.doesNotMatch(seen.url, /%2F/);
  assert.equal(seen.init.headers['x-amz-date'], '20260726T042000Z');
  assert.equal(seen.init.headers['content-length'], String(body.length));
});

test('a failed upload surfaces the provider response instead of swallowing it', async () => {
  const result = await putObject({
    accountId: 'acct123',
    bucket: 'b',
    key: 'k',
    body: Buffer.from('x'),
    accessKeyId: 'a',
    secretAccessKey: 's',
    fetchImpl: async () => ({ status: 403, ok: false, text: async () => 'AccessDenied' })
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.match(result.text, /AccessDenied/);
});

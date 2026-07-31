/**
 * Minimal AWS SigV4 signer + single-object PUT, for shipping backups off the box.
 *
 * Why hand-rolled: the API has five runtime dependencies and this runs on a
 * shared VPS with no rclone/aws-cli installed. A dependency-free PUT is ~60
 * lines, and the signing algorithm is verified against AWS's own published test
 * vector in deploy/server/s3put.test.mjs — so this is not "written and hoped
 * for", even before any real bucket exists.
 *
 * Cloudflare R2 speaks the S3 API, region is always "auto".
 */
import { createHash, createHmac } from 'node:crypto';

const sha256Hex = (value) => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();

/** RFC3986 escaping for a path segment — S3 keys may contain characters URLSearchParams would mangle. */
const encodeSegment = (segment) =>
  encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export const signRequest = ({
  method,
  host,
  path,
  payloadHash,
  accessKeyId,
  secretAccessKey,
  region = 'auto',
  service = 's3',
  amzDate,
  extraHeaders = {}
}) => {
  const dateStamp = amzDate.slice(0, 8);

  const headers = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...extraHeaders
  };
  const sortedNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const lowered = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value).trim()])
  );

  const canonicalHeaders = sortedNames.map((name) => `${name}:${lowered[name]}\n`).join('');
  const signedHeaders = sortedNames.join(';');
  const canonicalRequest = [
    method,
    path,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest)
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), service),
    'aws4_request'
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return {
    signature,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    headers: { ...headers, Authorization: undefined }
  };
};

/** Where an object lives, and the timestamp both the URL and the signature must agree on. */
const addressFor = ({ accountId, bucket, key, endpoint, now }) => ({
  host: endpoint || `${accountId}.r2.cloudflarestorage.com`,
  path: `/${encodeSegment(bucket)}/${key.split('/').map(encodeSegment).join('/')}`,
  amzDate: `${now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15)}Z`
});

/** PUT one object. Returns the response status; the caller decides what that means. */
export const putObject = async ({
  accountId,
  bucket,
  key,
  body,
  accessKeyId,
  secretAccessKey,
  endpoint,
  fetchImpl = fetch,
  now = new Date()
}) => {
  const { host, path, amzDate } = addressFor({ accountId, bucket, key, endpoint, now });
  const payloadHash = sha256Hex(body);

  const { authorization, headers } = signRequest({
    method: 'PUT',
    host,
    path,
    payloadHash,
    accessKeyId,
    secretAccessKey,
    amzDate,
    extraHeaders: { 'content-length': String(body.length) }
  });

  const response = await fetchImpl(`https://${host}${path}`, {
    method: 'PUT',
    headers: {
      Authorization: authorization,
      host: headers.host,
      'x-amz-content-sha256': headers['x-amz-content-sha256'],
      'x-amz-date': headers['x-amz-date'],
      'content-length': headers['content-length']
    },
    body
  });

  return { status: response.status, ok: response.ok, text: response.ok ? '' : await response.text() };
};

/**
 * GET one object back.
 *
 * Uploading is only half of a backup: until the bytes have been pulled down and
 * opened, "replicated 580KB" is a claim, not a fact. The box has no rclone and
 * no aws-cli, so the restore drill needs its own signed GET — same verified
 * signer, empty payload rather than a body.
 */
export const getObject = async ({
  accountId,
  bucket,
  key,
  accessKeyId,
  secretAccessKey,
  endpoint,
  fetchImpl = fetch,
  now = new Date()
}) => {
  const { host, path, amzDate } = addressFor({ accountId, bucket, key, endpoint, now });

  const { authorization, headers } = signRequest({
    method: 'GET',
    host,
    path,
    payloadHash: sha256Hex(''),
    accessKeyId,
    secretAccessKey,
    amzDate
  });

  const response = await fetchImpl(`https://${host}${path}`, {
    method: 'GET',
    headers: {
      Authorization: authorization,
      host: headers.host,
      'x-amz-content-sha256': headers['x-amz-content-sha256'],
      'x-amz-date': headers['x-amz-date']
    }
  });

  if (!response.ok) {
    return { status: response.status, ok: false, text: await response.text(), body: null };
  }
  return {
    status: response.status,
    ok: true,
    text: '',
    body: Buffer.from(await response.arrayBuffer())
  };
};

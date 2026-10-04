import assert from 'node:assert/strict';
import express from 'express';
import { request as httpRequest } from 'node:http';
import sharp from 'sharp';
import test from 'node:test';
import { registerMusicImageRoutes, __resetMusicImageRateState } from '../src/musicImageRoutes.js';
import { MUSIC_IMAGE_MAX_BYTES } from '../src/ai/musicImage.js';
import { ProtectedMediaRoute } from '../src/media/protection.js';
import type { AiModelConfig } from '../src/ai/types.js';

const config = (over: Partial<AiModelConfig> = {}): AiModelConfig => ({
  provider: 'deepseek', enabled: true, apiKey: 'test-secret',
  baseUrl: 'https://deepseek.invalid/v1', model: 'deepseek-v4-flash',
  timeoutSec: 8, maxOutputTokens: 1000, reasoningEffort: 'none', ...over
});

const fixtures = async () => {
  const raw = await sharp({ create: { width: 24, height: 18, channels: 3, background: '#c72e55' } })
    .jpeg({ quality: 90 }).withMetadata({ exif: { IFD0: { Artist: 'private metadata' } } }).toBuffer();
  return {
    jpeg: raw,
    png: await sharp(raw).png().toBuffer(),
    animatedPng: await animatedPng(await sharp(raw).png().toBuffer(), 24, 18),
    webp: await sharp(raw).webp().toBuffer(),
    animatedWebp: await animatedWebp(await sharp(raw).webp({ lossless: true }).toBuffer(), 24, 18)
  };
};

const pngCrc = (data: Buffer) => {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const pngChunk = (type: string, data: Buffer) => {
  const typeBytes = Buffer.from(type, 'ascii');
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(pngCrc(Buffer.concat([typeBytes, data])));
  return Buffer.concat([size, typeBytes, data, crc]);
};

const animatedPng = async (still: Buffer, width: number, height: number) => {
  const chunks = new Map<string, Buffer[]>();
  for (let offset = 8; offset + 12 <= still.length;) {
    const size = still.readUInt32BE(offset);
    const type = still.toString('ascii', offset + 4, offset + 8);
    const data = still.subarray(offset + 8, offset + 8 + size);
    chunks.set(type, [...(chunks.get(type) || []), data]);
    offset += size + 12;
    if (type === 'IEND') break;
  }
  const frameControl = (sequence: number) => {
    const data = Buffer.alloc(26);
    data.writeUInt32BE(sequence, 0);
    data.writeUInt32BE(width, 4);
    data.writeUInt32BE(height, 8);
    data.writeUInt16BE(1, 20);
    data.writeUInt16BE(10, 22);
    return data;
  };
  const animatedControl = Buffer.alloc(8);
  animatedControl.writeUInt32BE(2, 0);
  const frameDataSequence = Buffer.alloc(4);
  frameDataSequence.writeUInt32BE(2);
  const idat = Buffer.concat(chunks.get('IDAT') || []);
  return Buffer.concat([
    still.subarray(0, 8),
    pngChunk('IHDR', chunks.get('IHDR')?.[0] || Buffer.alloc(13)),
    pngChunk('acTL', animatedControl),
    pngChunk('fcTL', frameControl(0)),
    pngChunk('IDAT', idat),
    pngChunk('fcTL', frameControl(1)),
    pngChunk('fdAT', Buffer.concat([frameDataSequence, idat])),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
};

const animatedWebp = async (still: Buffer, width: number, height: number) => {
  const chunks: Array<{ type: string; part: Buffer }> = [];
  for (let offset = 12; offset < still.length;) {
    const size = still.readUInt32LE(offset + 4);
    chunks.push({ type: still.toString('ascii', offset, offset + 4), part: still.subarray(offset, offset + 8 + size + (size % 2)) });
    offset += 8 + size + (size % 2);
  }
  const frame = chunks.find((chunk) => chunk.type === 'VP8L')?.part;
  assert.ok(frame);
  const u24 = (n: number) => Buffer.from([n & 255, (n >> 8) & 255, (n >> 16) & 255]);
  const chunk = (type: string, data: Buffer) => {
    const header = Buffer.alloc(8);
    header.write(type);
    header.writeUInt32LE(data.length, 4);
    return Buffer.concat([header, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  const vp8x = Buffer.from([2, 0, 0, 0, ...u24(width - 1), ...u24(height - 1)]);
  const frameHeader = Buffer.concat([u24(0), u24(0), u24(width - 1), u24(height - 1), u24(100), Buffer.from([0])]);
  const anmf = chunk('ANMF', Buffer.concat([frameHeader, frame]));
  const body = Buffer.concat([
    Buffer.from('WEBP'), chunk('VP8X', vp8x), chunk('ANIM', Buffer.from([0, 0, 0, 0, 0, 0])), anmf, anmf
  ]);
  const riff = Buffer.alloc(8);
  riff.write('RIFF');
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
};

const listen = async (app: express.Express) => {
  app.set('trust proxy', 1);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { server, base: `http://127.0.0.1:${address.port}` };
};

const close = async (server: ReturnType<express.Express['listen']>) =>
  new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

const post = (base: string, bytes: Buffer, type = 'image/jpeg', ip = '127.0.0.1') => fetch(`${base}/ai/music-image`, {
  method: 'POST', headers: { 'Content-Type': type, 'X-Forwarded-For': ip }, body: bytes
});

test('music image capability is false outside the allow-listed DeepSeek vision configs', async () => {
  for (const model of [
    config({ provider: 'openai' }), config({ model: 'deepseek-v4-pro' }),
    config({ model: 'DeepSeek-V4-Flash' }), config({ enabled: false }), config({ apiKey: '' })
  ]) {
    const app = express();
    registerMusicImageRoutes(app, { model });
    const { server, base } = await listen(app);
    try {
      assert.deepEqual(await (await fetch(`${base}/ai/music-image`)).json(), { enabled: false });
      const response = await post(base, Buffer.from('x'));
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: 'unavailable' });
    } finally { await close(server); }
  }
  for (const model of ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']) {
    const app = express();
    registerMusicImageRoutes(app, { model: config({ model }) });
    const { server, base } = await listen(app);
    try { assert.deepEqual(await (await fetch(`${base}/ai/music-image`)).json(), { enabled: true }); }
    finally { await close(server); }
  }
});

test('one sanitized inline vision request yields a bounded, deduplicated allow-list', async () => {
  __resetMusicImageRateState();
  const files = await fixtures();
  const app = express();
  let calls = 0;
  let sent: Record<string, unknown> | undefined;
  registerMusicImageRoutes(app, {
    model: config(),
    fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
      calls++;
      sent = JSON.parse(String(init?.body));
      return Response.json({ choices: [{ message: { content: JSON.stringify({ candidates: [
        { artist: '  Artist  One ', title: '  Song  A ', uncertain: false },
        { artist: 'artist one', title: 'song a', uncertain: false },
        { artist: '', title: 'Unknown title', uncertain: false },
        { artist: 'Bad', title: 'https://example.com/song', uncertain: false },
        { artist: 'Bad', title: 'line\nbreak', uncertain: false },
        ...Array.from({ length: 8 }, (_, i) => ({ artist: `Artist ${i}`, title: `Song ${i}`, uncertain: true }))
      ] }) } }] });
    }) as typeof fetch
  });
  const { server, base } = await listen(app);
  try {
    const response = await post(base, files.jpeg);
    assert.equal(response.status, 200);
    const result = await response.json() as { candidates: Array<{ artist: string; title: string; uncertain: boolean }> };
    assert.equal(calls, 1);
    assert.equal(result.candidates.length, 5);
    assert.deepEqual(result.candidates[0], { artist: 'Artist One', title: 'Song A', uncertain: false });
    assert.deepEqual(result.candidates[1], { artist: '', title: 'Unknown title', uncertain: true });
    assert.equal(result.candidates[2]?.title, 'Song 0');
    assert.equal(Object.keys(result).join(','), 'candidates');

    assert.equal(sent?.model, 'deepseek-v4-flash');
    assert.equal(sent?.temperature, 0);
    assert.equal(sent?.max_tokens, 700);
    assert.deepEqual(sent?.thinking, { type: 'disabled' });
    assert.deepEqual(sent?.response_format, { type: 'json_object' });
    assert.equal(sent?.stream, false);
    const messages = sent?.messages as Array<{ role: string; content: unknown }>;
    assert.equal(messages.length, 2);
    const blocks = messages[1]?.content as Array<{ type: string; image_url?: { url: string } }>;
    assert.equal(blocks[1]?.type, 'image_url');
    const imageUrl = blocks[1]?.image_url?.url || '';
    assert.match(imageUrl, /^data:image\/jpeg;base64,/);
    const sanitized = Buffer.from(imageUrl.split(',')[1] || '', 'base64');
    const metadata = await sharp(sanitized).metadata();
    assert.equal(metadata.exif, undefined);
  } finally { await close(server); }
});

test('decodes PNG, JPEG, WebP and emits only sanitized PNG or JPEG bytes', async () => {
  __resetMusicImageRateState();
  const files = await fixtures();
  const app = express();
  const sentMimes: string[] = [];
  registerMusicImageRoutes(app, {
    model: config(),
    fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { messages: Array<{ content: unknown }> };
      const image = (request.messages[1]?.content as Array<{ image_url?: { url: string } }>)[1]?.image_url?.url || '';
      sentMimes.push(image.slice(5, image.indexOf(';')));
      return Response.json({ choices: [{ message: { content: '{"candidates":[]}' } }] });
    }) as typeof fetch
  });
  const { server, base } = await listen(app);
  try {
    for (const [type, bytes] of [['image/png', files.png], ['image/jpeg', files.jpeg], ['image/webp', files.webp]] as const) {
      assert.equal((await post(base, bytes, type, `192.0.2.${sentMimes.length + 1}`)).status, 200);
    }
    assert.deepEqual(sentMimes, ['image/png', 'image/jpeg', 'image/jpeg']);
  } finally { await close(server); }
});

test('invalid, spoofed, unsupported and oversized image inputs use closed error bodies', async () => {
  __resetMusicImageRateState();
  const generated = await fixtures();
  const validJpeg = generated.jpeg;
  const app = express();
  let calls = 0;
  registerMusicImageRoutes(app, { model: config(), fetch: (async () => { calls++; return Response.json({}); }) as typeof fetch });
  const { server, base } = await listen(app);
  try {
    let inputIndex = 1;
    for (const [bytes, type, status, error] of [
      [Buffer.from('not an image'), 'image/jpeg', 400, 'invalid_image'],
      [Buffer.from('x'), 'image/gif', 415, 'unsupported_image'],
      [validJpeg, 'image/png', 415, 'unsupported_image'],
      [generated.animatedPng, 'image/png', 415, 'unsupported_image'],
      [generated.animatedWebp, 'image/webp', 415, 'unsupported_image'],
      [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/png', 415, 'unsupported_image'],
      [await sharp({ create: { width: 4097, height: 1, channels: 3, background: '#fff' } }).jpeg().toBuffer(), 'image/jpeg', 415, 'unsupported_image'],
      [await sharp({ create: { width: 2900, height: 2800, channels: 3, background: '#fff' } }).jpeg({ quality: 30 }).toBuffer(), 'image/jpeg', 415, 'unsupported_image'],
      [Buffer.alloc(MUSIC_IMAGE_MAX_BYTES + 1), 'image/jpeg', 413, 'image_too_large']
    ] as const) {
      const response = await post(base, bytes, type, `198.51.100.${inputIndex++}`);
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { error });
    }
    assert.equal(calls, 0);
  } finally { await close(server); }
});

test('chunked oversized upload returns 413 promptly, closes deterministically, and frees the slot', async () => {
  __resetMusicImageRateState();
  const files = await fixtures();
  const app = express();
  let calls = 0;
  registerMusicImageRoutes(app, {
    model: config(), deadlineMs: 1000,
    fetch: (async () => {
      calls++;
      return Response.json({ choices: [{ message: { content: '{"candidates":[]}' } }] });
    }) as typeof fetch
  });
  const { server, base } = await listen(app);
  try {
    const started = Date.now();
    const result = await new Promise<{ status: number; connection: string | undefined; body: string }>((resolve, reject) => {
      let receivedResponse = false;
      const request = httpRequest(`${base}/ai/music-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg', 'Transfer-Encoding': 'chunked', 'X-Forwarded-For': '203.0.113.80' }
      }, (incoming) => {
        receivedResponse = true;
        const chunks: Buffer[] = [];
        incoming.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        incoming.on('end', () => resolve({
          status: incoming.statusCode || 0,
          connection: incoming.headers.connection,
          body: Buffer.concat(chunks).toString()
        }));
      });
      request.on('error', (error) => { if (!receivedResponse) reject(error); });
      request.write(Buffer.alloc(MUSIC_IMAGE_MAX_BYTES + 1));
      setTimeout(() => request.end(), 150);
    });
    assert.ok(Date.now() - started < 1000);
    assert.equal(result.status, 413);
    assert.equal(result.connection, 'close');
    assert.deepEqual(JSON.parse(result.body), { error: 'image_too_large' });
    const next = await post(base, files.jpeg, 'image/jpeg', '203.0.113.81');
    assert.equal(next.status, 200);
    assert.equal(calls, 1);
  } finally { await close(server); }
});

test('per-IP rate limit and single execution slot shed without queueing', async () => {
  __resetMusicImageRateState();
  const files = await fixtures();
  const app = express();
  let release: (() => void) | undefined;
  let call = 0;
  registerMusicImageRoutes(app, {
    model: config(),
    fetch: (async () => {
      call++;
      if (call === 1) return new Promise<Response>((resolve) => {
        release = () => resolve(Response.json({ choices: [{ message: { content: '{"candidates":[]}' } }] }));
      });
      return Response.json({ choices: [{ message: { content: '{"candidates":[]}' } }] });
    }) as typeof fetch
  });
  const { server, base } = await listen(app);
  try {
    const first = post(base, files.jpeg, 'image/jpeg', '203.0.113.1');
    await new Promise((resolve) => setTimeout(resolve, 30));
    const second = await post(base, files.jpeg, 'image/jpeg', '203.0.113.2');
    assert.equal(second.status, 429);
    assert.deepEqual(await second.json(), { error: 'rate_limited' });
    release?.();
    assert.equal((await first).status, 200);

    for (let i = 0; i < 3; i++) assert.equal((await post(base, files.jpeg, 'image/jpeg', '203.0.113.3')).status, 200);
    const fourth = await post(base, files.jpeg, 'image/jpeg', '203.0.113.3');
    assert.equal(fourth.status, 429);
  } finally { release?.(); await close(server); }
});

test('music-image global volume cap is 30 provider attempts per rolling hour', async () => {
  __resetMusicImageRateState();
  const files = await fixtures();
  const app = express();
  let calls = 0;
  registerMusicImageRoutes(app, {
    model: config(),
    fetch: (async () => {
      calls++;
      return Response.json({ choices: [{ message: { content: '{"candidates":[]}' } }] });
    }) as typeof fetch
  });
  const { server, base } = await listen(app);
  try {
    for (let i = 1; i <= 30; i++) {
      assert.equal((await post(base, files.jpeg, 'image/jpeg', `198.18.${Math.floor(i / 250)}.${i}`)).status, 200);
    }
    const capped = await post(base, files.jpeg, 'image/jpeg', '198.18.1.31');
    assert.equal(capped.status, 429);
    assert.deepEqual(await capped.json(), { error: 'rate_limited' });
    assert.equal(calls, 30);
  } finally { await close(server); }
});

test('music-image per-IP bucket map refuses new keys after its configured bound', () => {
  const guard = new ProtectedMediaRoute({
    routeName: 'ai-music-image', maxConcurrency: 1, sharedMaxConcurrency: 8,
    rateLimitPerWindow: 3, rateLimitWindowMs: 60_000, maxRateLimitKeys: 2
  });
  const request = (ip: string) => ({ ip, socket: { remoteAddress: ip } }) as unknown as import('express').Request;
  assert.equal(guard.checkRateLimit(request('192.0.2.1')), null);
  assert.equal(guard.checkRateLimit(request('192.0.2.2')), null);
  assert.notEqual(guard.checkRateLimit(request('192.0.2.3')), null);
  assert.equal(guard.rateLimitBucketCount, 2);
});

test('deadline maps to 504 and aborts the provider request', async () => {
  __resetMusicImageRateState();
  const files = await fixtures();
  const app = express();
  let aborted = false;
  registerMusicImageRoutes(app, {
    model: config(), deadlineMs: 30,
    fetch: (async (_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { aborted = true; reject(new Error('internal abort')); }, { once: true });
    })) as typeof fetch
  });
  const { server, base } = await listen(app);
  try {
    const response = await post(base, files.jpeg);
    assert.equal(response.status, 504);
    assert.deepEqual(await response.json(), { error: 'timeout' });
    assert.equal(aborted, true);
  } finally { await close(server); }
});

test('upload deadline returns a fixed 504 for a stalled body', async () => {
  __resetMusicImageRateState();
  const app = express();
  registerMusicImageRoutes(app, { model: config(), deadlineMs: 30 });
  const { server, base } = await listen(app);
  try {
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const request = httpRequest(`${base}/ai/music-image`, {
        method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '1000' }
      }, (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        incoming.on('end', () => resolve({ status: incoming.statusCode || 0, body: Buffer.concat(chunks).toString() }));
      });
      request.on('error', reject);
      request.write(Buffer.from([0xff, 0xd8, 0xff]));
    });
    assert.equal(response.status, 504);
    assert.deepEqual(JSON.parse(response.body), { error: 'timeout' });
  } finally { await close(server); }
});

test('disconnect keeps the concurrency slot until the provider promise settles', async () => {
  __resetMusicImageRateState();
  const files = await fixtures();
  const app = express();
  let resolveProvider: (() => void) | undefined;
  let providerStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => { providerStarted = resolve; });
  let calls = 0;
  registerMusicImageRoutes(app, {
    model: config(),
    fetch: (async () => {
      calls++;
      if (calls === 1) {
        providerStarted?.();
        return new Promise<Response>((resolve) => {
          resolveProvider = () => resolve(Response.json({ choices: [{ message: { content: '{"candidates":[]}' } }] }));
        });
      }
      return Response.json({ choices: [{ message: { content: '{"candidates":[]}' } }] });
    }) as typeof fetch
  });
  const { server, base } = await listen(app);
  try {
    const abort = new AbortController();
    const disconnected = postWithSignal(base, files.jpeg, abort.signal, '192.0.2.40').catch(() => undefined);
    await started;
    abort.abort();
    await disconnected;
    const shed = await post(base, files.jpeg, 'image/jpeg', '192.0.2.41');
    assert.equal(shed.status, 429);
    resolveProvider?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal((await post(base, files.jpeg, 'image/jpeg', '192.0.2.42')).status, 200);
  } finally { resolveProvider?.(); await close(server); }
});

test('provider errors and oversized provider replies never leak provider text', async () => {
  __resetMusicImageRateState();
  const files = await fixtures();
  let suffix = 1;
  for (const fetchImpl of [
    (async () => new Response('secret upstream message', { status: 500 })) as typeof fetch,
    (async () => new Response('x'.repeat(70_000), { headers: { 'Content-Type': 'application/json' } })) as typeof fetch,
    (async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('secret response read')); } }))) as typeof fetch,
    (async () => Response.json({ choices: [{ message: { content: 'not JSON' } }] })) as typeof fetch,
    (async () => Response.json({ choices: [{ message: { content: '{"songs":[]}' } }] })) as typeof fetch
  ]) {
    const app = express();
    registerMusicImageRoutes(app, { model: config(), fetch: fetchImpl });
    const { server, base } = await listen(app);
    try {
      const response = await post(base, files.jpeg, 'image/jpeg', `192.0.2.${suffix++}`);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: 'unavailable' });
    } finally { await close(server); }
  }
});

const postWithSignal = (base: string, bytes: Buffer, signal: AbortSignal, ip: string) => fetch(`${base}/ai/music-image`, {
  method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'X-Forwarded-For': ip }, body: bytes, signal
});

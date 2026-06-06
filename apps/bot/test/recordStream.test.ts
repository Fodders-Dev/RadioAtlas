import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFfmpegArgs,
  clampDuration,
  createRecordingLimiter,
  formatMskTimestamp,
  getStationById,
  recordStream,
  searchStations,
  type SpawnLike,
  type StationDeps
} from '../src/recordStream.js';

const apiUrl = 'http://127.0.0.1:3001';

const stubFetch = (
  handler: (url: string) => { ok: boolean; body: unknown }
): { fetch: typeof fetch; urls: string[] } => {
  const urls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    urls.push(url);
    const { ok, body } = handler(url);
    return { ok, json: async () => body } as Response;
  }) as typeof fetch;
  return { fetch: fetchImpl, urls };
};

// ---- station resolution ----

test('searchStations: hits /catalog/search?q=&limit=5 and returns items', async () => {
  const { fetch, urls } = stubFetch(() => ({
    ok: true,
    body: { items: [{ stationuuid: 'a', name: 'A' }, { stationuuid: 'b', name: 'B' }] }
  }));
  const items = await searchStations('jazz', { fetch, apiUrl } as StationDeps);
  assert.ok(urls[0].includes('/catalog/search?q=jazz&limit=5'), urls[0]);
  assert.equal(items.length, 2);
  assert.equal(items[0].stationuuid, 'a');
});

test('searchStations: blank query / no apiUrl short-circuits without fetch', async () => {
  let called = 0;
  const fetchImpl = (async () => {
    called += 1;
    return { ok: true, json: async () => ({ items: [] }) } as Response;
  }) as typeof fetch;
  assert.deepEqual(await searchStations('   ', { fetch: fetchImpl, apiUrl }), []);
  assert.deepEqual(await searchStations('jazz', { fetch: fetchImpl, apiUrl: '' }), []);
  assert.equal(called, 0);
});

test('searchStations: non-2xx / throw → empty list (no crash)', async () => {
  const fail = stubFetch(() => ({ ok: false, body: {} }));
  assert.deepEqual(await searchStations('x', { fetch: fail.fetch, apiUrl }), []);
  const thrower = (async () => {
    throw new Error('down');
  }) as typeof fetch;
  assert.deepEqual(await searchStations('x', { fetch: thrower, apiUrl }), []);
});

test('getStationById: hits /catalog/stations/:id and returns the item', async () => {
  const { fetch, urls } = stubFetch(() => ({
    ok: true,
    body: { item: { stationuuid: 'id-1', name: 'Tokyo FM', url_resolved: 'https://s/x' } }
  }));
  const station = await getStationById('id-1', { fetch, apiUrl });
  assert.ok(urls[0].endsWith('/catalog/stations/id-1'), urls[0]);
  assert.equal(station?.url_resolved, 'https://s/x');
});

test('getStationById: missing item / non-2xx → null', async () => {
  const empty = stubFetch(() => ({ ok: true, body: {} }));
  assert.equal(await getStationById('id', { fetch: empty.fetch, apiUrl }), null);
  const fail = stubFetch(() => ({ ok: false, body: {} }));
  assert.equal(await getStationById('id', { fetch: fail.fetch, apiUrl }), null);
});

// ---- duration ----

test('clampDuration: clamps to [30, 1800] and defaults on NaN', () => {
  assert.equal(clampDuration(0), 30);
  assert.equal(clampDuration(5 * 60), 300);
  assert.equal(clampDuration(99999), 1800);
  assert.equal(clampDuration(Number.NaN), 300);
});

// ---- ffmpeg args ----

test('buildFfmpegArgs: encodes duration, mp3 codec, metadata, and output path', () => {
  const args = buildFfmpegArgs({
    url: 'https://stream/x',
    durationSec: 900,
    stationName: 'Tokyo FM',
    outputPath: '/tmp/out.mp3',
    now: new Date('2026-06-05T12:00:00Z')
  });
  // input + duration
  assert.ok(args.includes('-i'));
  assert.equal(args[args.indexOf('-i') + 1], 'https://stream/x');
  assert.equal(args[args.indexOf('-t') + 1], '900');
  // mp3 @128k
  assert.equal(args[args.indexOf('-c:a') + 1], 'libmp3lame');
  assert.equal(args[args.indexOf('-b:a') + 1], '128k');
  // metadata carries the station name
  const titleArg = args[args.indexOf('-metadata') + 1];
  assert.ok(titleArg.startsWith('title=Tokyo FM — '), titleArg);
  assert.ok(args.includes('artist=Tokyo FM'));
  // network timeout present, video disabled, output last
  assert.ok(args.includes('-rw_timeout'));
  assert.ok(args.includes('-vn'));
  assert.equal(args[args.length - 1], '/tmp/out.mp3');
  // overwrite flag is first (don't hang on a leftover file from a failed candidate)
  assert.equal(args[0], '-y');
  // protocol whitelist is a network-only allowlist with NO 'file' (no local-file read)
  const whitelist = args[args.indexOf('-protocol_whitelist') + 1];
  assert.equal(whitelist, 'http,https,tcp,tls,crypto');
  assert.ok(!whitelist.split(',').includes('file'), whitelist);
  // and it sits before the input
  assert.ok(args.indexOf('-protocol_whitelist') < args.indexOf('-i'));
});

test('formatMskTimestamp: renders the time in Europe/Moscow (UTC+3)', () => {
  const stamp = formatMskTimestamp(new Date('2026-06-05T12:00:00Z'));
  assert.ok(stamp.includes('15:00'), stamp); // 12:00 UTC → 15:00 MSK
  assert.ok(stamp.includes('2026'), stamp);
});

// ---- concurrency limiter ----

test('createRecordingLimiter: enforces global=2 and per-user=1, release frees slots', () => {
  const limiter = createRecordingLimiter();
  assert.equal(limiter.tryAcquire(1), true);
  assert.equal(limiter.tryAcquire(1), false); // per-user cap
  assert.equal(limiter.tryAcquire(2), true);
  assert.equal(limiter.tryAcquire(3), false); // global cap
  assert.equal(limiter.activeCount, 2);
  limiter.release(1);
  assert.equal(limiter.activeCount, 1);
  assert.equal(limiter.tryAcquire(3), true);
});

// ---- recorder candidate loop (mock spawn + injected file size) ----

type Plan = { code: number };

const fakeSpawn = (plan: Plan[]): { spawn: SpawnLike; calls: () => number } => {
  let call = 0;
  const spawn: SpawnLike = () => {
    const index = call;
    call += 1;
    const listeners: Record<string, Array<(arg: unknown) => void>> = {};
    const proc = {
      on(event: string, listener: (arg: unknown) => void) {
        (listeners[event] ??= []).push(listener);
        return proc;
      },
      kill() {
        return true;
      }
    };
    queueMicrotask(() => {
      const code = plan[index]?.code ?? 0;
      (listeners.close ?? []).forEach((listener) => listener(code as unknown));
    });
    return proc as unknown as ReturnType<SpawnLike>;
  };
  return { spawn, calls: () => call };
};

const sizes = (values: number[]) => {
  let i = 0;
  return async () => values[i++] ?? 0;
};

const baseInput = {
  durationSec: 300,
  stationName: 'Tokyo FM',
  outputPath: '/tmp/rec.mp3'
};

test('recordStream: first candidate succeeds → ok with that url', async () => {
  const { spawn } = fakeSpawn([{ code: 0 }]);
  const result = await recordStream(
    { ...baseInput, streamCandidates: ['https://a/x', 'https://b/x'] },
    { ffmpegPath: '/bin/ffmpeg', spawn, probeSize: sizes([1_000_000]) }
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.url, 'https://a/x');
});

test('recordStream: falls over to the next candidate on non-zero exit', async () => {
  const { spawn } = fakeSpawn([{ code: 1 }, { code: 0 }]);
  const result = await recordStream(
    { ...baseInput, streamCandidates: ['https://bad/x', 'https://good/x'] },
    { ffmpegPath: '/bin/ffmpeg', spawn, probeSize: sizes([0, 800_000]) }
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.url, 'https://good/x');
});

test('recordStream: a near-empty file (exit 0) is rejected → next candidate', async () => {
  const { spawn } = fakeSpawn([{ code: 0 }, { code: 0 }]);
  const result = await recordStream(
    { ...baseInput, streamCandidates: ['https://silent/x', 'https://good/x'] },
    { ffmpegPath: '/bin/ffmpeg', spawn, probeSize: sizes([10, 500_000]) }
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.url, 'https://good/x');
});

test('recordStream: all candidates fail → all-failed', async () => {
  const { spawn } = fakeSpawn([{ code: 1 }, { code: 1 }]);
  const result = await recordStream(
    { ...baseInput, streamCandidates: ['https://a/x', 'https://b/x'] },
    { ffmpegPath: '/bin/ffmpeg', spawn, probeSize: sizes([0, 0]) }
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'all-failed');
});

test('recordStream: over the 49 MB cap → too-large', async () => {
  const { spawn } = fakeSpawn([{ code: 0 }]);
  const result = await recordStream(
    { ...baseInput, streamCandidates: ['https://huge/x'] },
    { ffmpegPath: '/bin/ffmpeg', spawn, probeSize: sizes([60 * 1024 * 1024]) }
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'too-large');
});

test('recordStream: non-http(s) candidates are dropped (file:// never reaches ffmpeg)', async () => {
  let spawned = 0;
  const { spawn } = fakeSpawn([]);
  const wrapped: SpawnLike = (command, args) => {
    spawned += 1;
    return spawn(command, args);
  };
  const result = await recordStream(
    { ...baseInput, streamCandidates: ['file:///etc/passwd', 'pipe:0', 'ftp://x/y'] },
    { ffmpegPath: '/bin/ffmpeg', spawn: wrapped, probeSize: sizes([0]) }
  );
  assert.equal(spawned, 0);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'no-candidates');
});

test('recordStream: an already-aborted signal → cancelled without spawning', async () => {
  let spawned = 0;
  const { spawn } = fakeSpawn([{ code: 0 }]);
  const wrapped: SpawnLike = (command, args) => {
    spawned += 1;
    return spawn(command, args);
  };
  const controller = new AbortController();
  controller.abort();
  const result = await recordStream(
    { ...baseInput, streamCandidates: ['https://a/x'] },
    { ffmpegPath: '/bin/ffmpeg', spawn: wrapped, signal: controller.signal }
  );
  assert.equal(spawned, 0);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'cancelled');
});

test('recordStream: guards — no ffmpeg path and no candidates', async () => {
  const { spawn } = fakeSpawn([]);
  const noFfmpeg = await recordStream(
    { ...baseInput, streamCandidates: ['https://a/x'] },
    { ffmpegPath: null, spawn }
  );
  assert.equal(noFfmpeg.ok, false);
  if (!noFfmpeg.ok) assert.equal(noFfmpeg.reason, 'no-ffmpeg');

  const noCandidates = await recordStream(
    { ...baseInput, streamCandidates: [] },
    { ffmpegPath: '/bin/ffmpeg', spawn }
  );
  assert.equal(noCandidates.ok, false);
  if (!noCandidates.ok) assert.equal(noCandidates.reason, 'no-candidates');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTracklistText,
  formatTimecode,
  normalizeTrustedTrackTitle,
  readIcyTracklist,
  type TracklistStation
} from '../src/icyTracklist.js';

// ---- ICY wire helpers -------------------------------------------------------

const enc = new TextEncoder();

// Build a raw ICY stream body: for each cycle, `metaint` audio bytes (zeros)
// then a metadata block — `null` = a 0-length block (no change this cycle),
// a string = `StreamTitle='...';` padded to a 16-byte multiple.
const buildIcyStream = (metaint: number, cycles: Array<string | null>): Uint8Array => {
  const parts: Uint8Array[] = [];
  for (const title of cycles) {
    parts.push(new Uint8Array(metaint)); // audio
    if (title == null) {
      parts.push(Uint8Array.from([0]));
      continue;
    }
    const raw = enc.encode(`StreamTitle='${title}';`);
    const blocks = Math.ceil(raw.length / 16);
    const padded = new Uint8Array(blocks * 16);
    padded.set(raw);
    parts.push(Uint8Array.from([blocks]));
    parts.push(padded);
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
};

const splitBytes = (bytes: Uint8Array, into: number): Uint8Array[] => {
  if (into <= 1) return [bytes];
  const size = Math.ceil(bytes.length / into);
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) chunks.push(bytes.subarray(i, i + size));
  return chunks;
};

// A fetch stub serving one or more candidate URLs. Each route is either an ICY
// body (metaint + bytes), a "no metadata" response (no icy-metaint header), or a
// thrown connect error.
type Route =
  | { kind: 'icy'; metaint: number; bytes: Uint8Array; splitInto?: number }
  | { kind: 'no-icy' }
  | { kind: 'error' };

const makeFetch = (routes: Record<string, Route>) => {
  const hits: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    hits.push(url);
    const route = routes[url] ?? { kind: 'no-icy' as const };
    if (route.kind === 'error') throw new Error('connect refused');
    if (route.kind === 'no-icy') {
      return {
        headers: { get: () => null },
        body: { getReader: () => ({ read: async () => ({ done: true }), cancel: async () => {} }) }
      } as unknown as Response;
    }
    const chunks = splitBytes(route.bytes, route.splitInto ?? 1);
    let idx = 0;
    return {
      headers: { get: (k: string) => (k.toLowerCase() === 'icy-metaint' ? String(route.metaint) : null) },
      body: {
        getReader: () => ({
          read: async () =>
            idx < chunks.length ? { value: chunks[idx++], done: false } : { value: undefined, done: true },
          cancel: async () => {}
        })
      }
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, hits };
};

// A clock returning queued timestamps (ms). First read = record start; the rest
// are the wall-clock receive times of each surfaced track.
const queuedClock = (values: number[]) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
};

const station: TracklistStation = {
  name: 'Indie Air',
  url_resolved: 'https://stream.example.com/indie',
  homepage: 'https://indieair.example.com'
};

// ---- parser / StreamTitle / timecodes ---------------------------------------

test('reads metaint blocks, normalizes titles, and timecodes by wall-clock from start', async () => {
  const bytes = buildIcyStream(16, ['Daft Punk - Aerodynamic', null, 'Justice - Genesis']);
  const { fetchImpl, hits } = makeFetch({ 'https://s/1': { kind: 'icy', metaint: 16, bytes } });
  const result = await readIcyTracklist(
    ['https://s/1'],
    { durationSec: 3600, station: null },
    { fetch: fetchImpl, now: queuedClock([1000, 1000, 181000]) } // start=1s, t0=+0s, t1=+180s
  );
  assert.deepEqual(hits, ['https://s/1']);
  assert.deepEqual(result, [
    { atSec: 0, title: 'Daft Punk - Aerodynamic' },
    { atSec: 180, title: 'Justice - Genesis' }
  ]);
});

test('dedups a CONSECUTIVE duplicate (same track still playing) but keeps a later repeat', async () => {
  const bytes = buildIcyStream(16, ['A - 1', 'A - 1', 'B - 2', 'A - 1']);
  const { fetchImpl } = makeFetch({ s: { kind: 'icy', metaint: 16, bytes } });
  const result = await readIcyTracklist(
    ['s'],
    { durationSec: 3600, station: null },
    { fetch: fetchImpl, now: queuedClock([0, 0, 10000, 20000]) }
  );
  assert.deepEqual(
    result.map((e) => e.title),
    ['A - 1', 'B - 2', 'A - 1'] // the immediate repeat dropped, the later one kept
  );
});

test('survives metadata blocks split ACROSS chunk boundaries (streaming state machine)', async () => {
  const bytes = buildIcyStream(16, ['Boards of Canada - Roygbiv', 'Aphex Twin - Xtal']);
  const { fetchImpl } = makeFetch({ s: { kind: 'icy', metaint: 16, bytes, splitInto: 13 } });
  const result = await readIcyTracklist(
    ['s'],
    { durationSec: 3600, station: null },
    { fetch: fetchImpl, now: queuedClock([0, 1000, 60000]) }
  );
  assert.deepEqual(
    result.map((e) => e.title),
    ['Boards of Canada - Roygbiv', 'Aphex Twin - Xtal']
  );
});

test('drops junk: station-name echo, bare domain, and filler placeholders', async () => {
  const bytes = buildIcyStream(16, [
    'Indie Air', // == station.name → dropped
    'indieair.example.com', // station homepage host → dropped
    'radiovanya.ru', // bare domain → dropped
    'loading', // filler → dropped
    'Real Artist - Real Song' // kept
  ]);
  const { fetchImpl } = makeFetch({ s: { kind: 'icy', metaint: 16, bytes } });
  const result = await readIcyTracklist(
    ['s'],
    { durationSec: 3600, station },
    { fetch: fetchImpl, now: queuedClock([0, 0]) }
  );
  assert.deepEqual(
    result.map((e) => e.title),
    ['Real Artist - Real Song']
  );
});

// ---- candidate selection / fail-isolation -----------------------------------

test('falls through a no-ICY candidate to the first that exposes ICY metadata', async () => {
  const bytes = buildIcyStream(16, ['Caravan Palace - Lone Digger']);
  const { fetchImpl, hits } = makeFetch({
    'https://dead': { kind: 'no-icy' },
    'https://live': { kind: 'icy', metaint: 16, bytes }
  });
  const result = await readIcyTracklist(
    ['https://dead', 'https://live'],
    { durationSec: 3600, station: null },
    { fetch: fetchImpl, now: queuedClock([0, 0]) }
  );
  assert.deepEqual(hits, ['https://dead', 'https://live']); // probed dead, then live
  assert.deepEqual(
    result.map((e) => e.title),
    ['Caravan Palace - Lone Digger']
  );
});

test('a station with NO ICY metadata → empty tracklist (silent, never throws)', async () => {
  const { fetchImpl } = makeFetch({ s: { kind: 'no-icy' } });
  const result = await readIcyTracklist(['s'], { durationSec: 3600, station: null }, { fetch: fetchImpl });
  assert.deepEqual(result, []);
});

test('a connect error on every candidate → empty tracklist, resolves (does not reject)', async () => {
  const { fetchImpl } = makeFetch({ a: { kind: 'error' }, b: { kind: 'error' } });
  const result = await readIcyTracklist(['a', 'b'], { durationSec: 3600, station: null }, { fetch: fetchImpl });
  assert.deepEqual(result, []);
});

test('a fetch that blows up synchronously is swallowed → empty, never throws', async () => {
  const boomFetch = (() => {
    throw new Error('boom');
  }) as unknown as typeof fetch;
  const result = await readIcyTracklist(['x'], { durationSec: 60, station: null }, { fetch: boomFetch });
  assert.deepEqual(result, []);
});

test('no candidates or non-positive window → empty without touching fetch', async () => {
  let called = false;
  const spy = (async () => {
    called = true;
    return {} as Response;
  }) as unknown as typeof fetch;
  assert.deepEqual(await readIcyTracklist([], { durationSec: 60 }, { fetch: spy }), []);
  assert.deepEqual(await readIcyTracklist(['s'], { durationSec: 0 }, { fetch: spy }), []);
  assert.equal(called, false);
});

// ---- formatting -------------------------------------------------------------

test('formatTimecode: m:ss under an hour, h:mm:ss at/over an hour', () => {
  assert.equal(formatTimecode(0), '0:00');
  assert.equal(formatTimecode(5), '0:05');
  assert.equal(formatTimecode(184), '3:04');
  assert.equal(formatTimecode(3600), '1:00:00');
  assert.equal(formatTimecode(3725), '1:02:05');
});

test('buildTracklistText: header + timecoded lines; empty entries → empty string', () => {
  assert.equal(buildTracklistText([]), '');
  const text = buildTracklistText([
    { atSec: 0, title: 'A - 1' },
    { atSec: 184, title: 'B - 2' }
  ]);
  assert.equal(text, '🎵 Треклист:\n0:00 — A - 1\n3:04 — B - 2');
});

test('normalizeTrustedTrackTitle: keeps real titles, rejects url/domain/control/placeholder', () => {
  assert.equal(normalizeTrustedTrackTitle('Artist - Song'), 'Artist - Song');
  assert.equal(normalizeTrustedTrackTitle('https://example.com/live'), null);
  assert.equal(normalizeTrustedTrackTitle('example.com'), null);
  assert.equal(normalizeTrustedTrackTitle('radio'), null);
  assert.equal(normalizeTrustedTrackTitle('��'), null);
  assert.equal(normalizeTrustedTrackTitle('Cool FM', { name: 'Cool FM' }), null);
});

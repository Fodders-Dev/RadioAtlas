import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

/**
 * `persistCatalogSnapshot` writes the fallback catalogue. It used to be
 * `writeFile(path, JSON.stringify(stations))`, which materialised the whole
 * 60k-station catalogue as one 68.5M-character string (+137MB on the heap,
 * UTF-16 because of the Cyrillic) plus a +69MB Buffer inside writeFile — 206MB
 * in one shot, on the same 30-minute refresh that already held two copies of
 * the catalogue, in a process pm2 was killing at 1020-1114MB.
 *
 * The chunked replacement introduced a bug of its own that CI caught and
 * production had merely not hit yet: with a single shared `<target>.tmp`, two
 * overlapping writes (boot warm-up + a request-triggered refresh) raced, the
 * second `rename` failed ENOENT, and because every call site is fire-and-forget
 * that unhandled rejection killed the API process. Both properties are pinned
 * here.
 */

const station = (index: number) => ({
  stationuuid: `uuid-${index}`,
  name: `Станция ${index}`,
  url_resolved: `http://stream.test/${index}`,
  tags: 'jazz,ambient',
  country: 'Россия'
});

const withDataDir = async (run: (ctx: { dir: string; mod: any }) => Promise<void>) => {
  const dir = await mkdtemp(join(tmpdir(), 'radioatlas-snapshot-'));
  // catalogCache resolves its data directory from import.meta.url, so the test
  // runs against a copy of the module rooted in a temp directory.
  const source = await readFile(new URL('../src/catalogCache.ts', import.meta.url), 'utf8');
  // The module resolves its data directory as `../data/` relative to itself, so
  // the copy has to sit one level down for the data directory to land in `dir`.
  await mkdir(join(dir, 'src'), { recursive: true });
  const modulePath = join(dir, 'src', 'catalogCache.ts');
  await writeFile(modulePath, source, 'utf8');
  const mod = await import(`file://${modulePath.split('\\').join('/')}`);
  try {
    await run({ dir, mod });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

test('the snapshot round-trips exactly what JSON.stringify would have written', async () => {
  await withDataDir(async ({ dir, mod }) => {
    const stations = Array.from({ length: 1200 }, (_, index) => station(index));
    await mod.persistCatalogSnapshot('full', stations);
    const written = await readFile(join(dir, 'data', 'catalog-full.json'), 'utf8');
    assert.equal(written, JSON.stringify(stations), 'chunking must not change a single byte');
    assert.deepEqual(await mod.readPersistedCatalog('full'), stations);
  });
});

test('an empty catalogue is still valid JSON', async () => {
  await withDataDir(async ({ dir, mod }) => {
    await mod.persistCatalogSnapshot('full', []);
    assert.equal(await readFile(join(dir, 'data', 'catalog-full.json'), 'utf8'), '[]');
  });
});

test('two overlapping writes do not fight over one temp file', async () => {
  // The exact CI failure: `ENOENT: rename '<target>.tmp' -> '<target>'` from the
  // second writer, after the first had already moved that shared file away.
  //
  // Deliberately NOT asserting that both writes succeed. On Linux — production —
  // rename(2) is atomic and both do. On Windows, replacing a file that is being
  // replaced concurrently can raise EPERM, which is a platform property, not
  // this bug; the call sites swallow and log it, so the snapshot simply is not
  // refreshed that round. What must hold everywhere: nobody trips over another
  // writer's temp file, a complete catalogue lands, and nothing is left behind.
  await withDataDir(async ({ dir, mod }) => {
    const first = Array.from({ length: 900 }, (_, index) => station(index));
    const second = Array.from({ length: 900 }, (_, index) => station(index + 10_000));
    const outcomes = await Promise.allSettled([
      mod.persistCatalogSnapshot('full', first),
      mod.persistCatalogSnapshot('full', second)
    ]);

    for (const outcome of outcomes) {
      if (outcome.status !== 'rejected') continue;
      const code = (outcome.reason as NodeJS.ErrnoException)?.code;
      assert.notEqual(code, 'ENOENT', 'a writer must never lose its own temp file to the other');
    }
    assert.ok(
      outcomes.some((outcome) => outcome.status === 'fulfilled'),
      'at least one writer must complete'
    );

    const written = await readFile(join(dir, 'data', 'catalog-full.json'), 'utf8');
    const parsed = JSON.parse(written) as Array<{ stationuuid: string }>;
    assert.equal(parsed.length, 900, 'the file must hold one complete catalogue, not a blend');
    const leftovers = (await readdir(join(dir, 'data'))).filter((name) => name.endsWith('.tmp'));
    assert.deepEqual(leftovers, [], 'no temp file may be left behind');
  });
});

test('a snapshot failure cannot reject into a fire-and-forget call site', async () => {
  // The call sites in index.ts are `persistCatalogSnapshotSafely`, which
  // swallows and logs. This asserts the underlying function still REPORTS the
  // failure, so the guard is a deliberate choice rather than a silent one.
  await withDataDir(async ({ dir, mod }) => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await assert.rejects(() => mod.persistCatalogSnapshot('full', [circular]));
    const leftovers = (await readdir(join(dir, 'data')).catch(() => [])).filter((name) =>
      name.endsWith('.tmp')
    );
    assert.deepEqual(leftovers, [], 'a failed write must not leave a temp file');
  });
});

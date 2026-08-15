import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/**
 * The catalogue mirrors are raced with `Promise.any`, and until 2026-08-15 the
 * losers were never stopped: the winner settled the race while the other three
 * kept downloading and kept accumulating their own complete copy of the
 * catalogue. Four mirrors x up to 12 pages x 10 000 stations is four full
 * catalogues resident at once, every 30 minutes.
 *
 * Production consequence, measured: a ~450MB API reached 1020-1114MB against a
 * 896MB pm2 cap and was killed four times on 2026-08-15 — once mid-request for
 * a real listener, whose /api/ai/chat Caddy logged as a 502.
 *
 * This test races a fast mirror against slow ones and asserts the slow ones are
 * actually disconnected. It is an integration test on purpose: `getCatalog` is
 * not exported, and the thing worth pinning is the socket closing, not a mock.
 */

const apiRoot = fileURLToPath(new URL('../', import.meta.url));
const apiPort = 35200 + Math.floor(Math.random() * 300);
const upstreamPort = apiPort + 400;
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const upstreamBaseUrl = `http://127.0.0.1:${upstreamPort}`;

let apiProcess: ChildProcessWithoutNullStreams | null = null;
let upstreamServer: Server | null = null;

const mirrors = {
  fastRequests: 0,
  slowRequests: 0,
  slowAborted: 0,
  slowCompleted: 0
};

const station = (index: number) => ({
  stationuuid: `uuid-${index}`,
  name: `Station ${index}`,
  url: `http://stream.test/${index}`,
  url_resolved: `http://stream.test/${index}`,
  homepage: '',
  favicon: '',
  country: 'Testland',
  countrycode: 'TL',
  state: '',
  tags: 'jazz',
  language: 'english',
  votes: 1,
  clickcount: 1,
  bitrate: 128,
  lastcheckok: 1
});

const waitForServer = async (baseUrl: string, path = '/health') => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}${path}`);
      if (response.ok || response.status < 500) return;
    } catch {
      // not up yet
    }
    await delay(200);
  }
  throw new Error(`Server ${baseUrl}${path} did not start in time`);
};

test.before(async () => {
  const observabilityDir = await mkdtemp(join(tmpdir(), 'radioatlas-mirror-race-'));

  upstreamServer = createServer(async (req, res) => {
    const url = new URL(req.url || '/', upstreamBaseUrl);

    if (url.pathname === '/fast') {
      mirrors.fastRequests += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // Fewer rows than `limit`, so fetchFromEndpoint stops after one page and
      // this mirror wins immediately.
      res.end(JSON.stringify([station(1), station(2)]));
      return;
    }

    if (url.pathname === '/slow') {
      mirrors.slowRequests += 1;
      let aborted = false;
      // `aborted` fires when the client disconnects before the response ends —
      // which is exactly what the losing mirror must experience.
      req.on('aborted', () => {
        aborted = true;
        mirrors.slowAborted += 1;
      });
      res.on('close', () => {
        if (!res.writableFinished && !aborted) mirrors.slowAborted += 1;
      });
      await delay(2500);
      if (res.writableEnded || res.destroyed) return;
      mirrors.slowCompleted += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([station(3)]));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  await new Promise<void>((resolve) => upstreamServer!.listen(upstreamPort, '127.0.0.1', resolve));

  apiProcess = spawn(process.execPath, ['--import', 'tsx/esm', './src/index.ts'], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(apiPort),
      INTERNAL_WEBHOOK_TOKEN: 'mirror-race-internal-token',
      // The fast mirror is listed first, but order is irrelevant: they all start
      // together and the fastest settles the race.
      RADIO_BROWSER_URLS: `${upstreamBaseUrl}/fast,${upstreamBaseUrl}/slow,${upstreamBaseUrl}/slow`,
      CATALOG_ARTIFACT_ONLY: '0',
      CATALOG_FETCH_TIMEOUT_MS: '8000',
      OBSERVABILITY_STORE_PATH: join(observabilityDir, 'metrics.json'),
      BILLING_RECONCILE_ENABLED: '0',
      AI_ENABLED: '0',
      TELEGRAM_BOT_TOKEN: '',
      BOT_TOKEN: '',
      GOOGLE_CLIENT_ID: '',
      VK_CLIENT_ID: '',
      VK_CLIENT_SECRET: '',
      VK_REDIRECT_URI: '',
      WEBAPP_URL: 'https://radioatlas.test',
      ALLOWED_ORIGINS: 'http://127.0.0.1,http://localhost'
    }
  });
  apiProcess.stdout.on('data', () => {});
  apiProcess.stderr.on('data', () => {});

  await waitForServer(apiBaseUrl);
});

test.after(async () => {
  apiProcess?.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    if (!upstreamServer) return resolve();
    upstreamServer.close(() => resolve());
  });
});

test('the losing mirrors are disconnected once one wins', async () => {
  // The boot warm-up already triggers getCatalog('full'); this makes the test
  // independent of that timing.
  const response = await fetch(`${apiBaseUrl}/catalog/summary`);
  assert.equal(response.status, 200);

  // Give the abort a moment to reach the sockets, but stay well inside the
  // slow mirror's 2.5s response so a pass cannot come from it simply finishing.
  await delay(600);

  assert.ok(mirrors.fastRequests > 0, 'the fast mirror must have been asked');
  assert.ok(mirrors.slowRequests > 0, 'the slow mirrors must have been started too');
  assert.ok(
    mirrors.slowAborted >= mirrors.slowRequests,
    `every slow mirror must be disconnected: ${mirrors.slowAborted}/${mirrors.slowRequests}`
  );
  assert.equal(mirrors.slowCompleted, 0, 'no losing mirror may run to completion');
});

test('the winning mirror still produces a usable catalogue', async () => {
  const response = await fetch(`${apiBaseUrl}/catalog/summary`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as { counts?: { stations?: number } };
  assert.ok((body.counts?.stations ?? 0) > 0, 'aborting the losers must not empty the catalogue');
});

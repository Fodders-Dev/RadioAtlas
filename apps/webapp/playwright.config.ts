import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.PLAYWRIGHT_WEBAPP_PORT || 5174);
const API_PORT = 4311;
const ACCOUNT_STORE_PATH = join(
  tmpdir(),
  'radioatlas-playwright',
  `account-store-${process.pid}-${Date.now()}.sqlite`
);
const OBSERVABILITY_STORE_PATH = join(
  tmpdir(),
  'radioatlas-playwright',
  `observability-${process.pid}-${Date.now()}.json`
);
// The third store the spawned API writes. Without it `catalogCache` resolves
// `../data/` relative to its own source file, so every e2e run read and rewrote
// the developer's own 70MB catalogue snapshot — the exact accident
// `.claude/rules/e2e-tests.md` was written about, still open here because the
// other two stores were pinned and this one was not. An empty directory is
// correct: the API falls back to the tracked artifact.
const CATALOG_DATA_DIR = join(
  tmpdir(),
  'radioatlas-playwright',
  `catalog-${process.pid}-${Date.now()}`
);
const REUSE_EXISTING_SERVER = process.env.PLAYWRIGHT_REUSE_SERVER === '1';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: {
    timeout: 5000
  },
  // `list` is what a person reads while it runs; `html` is what survives it.
  // Without an html reporter there is no playwright-report/ at all, so CI's
  // "upload the report on failure" step had nothing to upload and passed with a
  // warning — the report missing in exactly the case it is wanted.
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 720 }
  },
  webServer: [
    {
      // NOT `run dev` — that is `tsx watch`, a file WATCHER. Editing any API
      // source while the suite runs restarts the shared server mid-flight, and
      // whichever specs happen to be in a request at that moment fail. It looks
      // exactly like flakiness: a different spec each run, all passing in
      // isolation. The suite must not depend on whether someone is typing.
      command: 'npm --prefix ../api run serve:e2e',
      url: `http://127.0.0.1:${API_PORT}/health`,
      reuseExistingServer: REUSE_EXISTING_SERVER,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        PORT: String(API_PORT),
        GOOGLE_CLIENT_ID: 'test-google-client',
        ENABLE_TEST_AUTH_FIXTURES: '1',
        ACCOUNT_STORE_PATH,
        OBSERVABILITY_STORE_PATH,
        CATALOG_DATA_DIR,
        // Serve the committed artifact and never race the live Radio Browser
        // mirrors. `api.contract.test.ts` has done this since the day a cold
        // first request chained 8s × MAX_PAGES past the runner's cap, and the
        // browser suite has exactly the same problem with a worse blast radius:
        // /catalog/points is NOT stubbed by tests/helpers.ts, so a Globe spec
        // waits on somebody else's network inside a 30s timeout, and a request
        // arriving before the boot warm finishes starts a SECOND four-mirror
        // race — two full catalogues in memory next to Chromium and Vite.
        CATALOG_ARTIFACT_ONLY: '1',
        BILLING_RECONCILE_ENABLED: '0'
      }
    },
    {
      command: `npm run dev -- --host --port ${PORT}`,
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: REUSE_EXISTING_SERVER,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        VITE_API_PROXY_PORT: String(API_PORT),
        VITE_GOOGLE_CLIENT_ID: 'test-google-client'
      }
    }
  ]
});

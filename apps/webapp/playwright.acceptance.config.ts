import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The 0.1b.1 USER ACCEPTANCE run — separate from the gating suite on purpose.
 *
 * It is slow (minutes of real waiting, because the thing under test is what
 * happens over 25 real seconds), it records video, and it is a demonstration
 * for a person rather than a regression gate. `testDir` is `./acceptance`,
 * which the gating config's `./tests` never reaches, so nothing here can
 * lengthen the suite that runs on every push.
 *
 * ⚠ Its own ports. The gating suite owns 4311/5174 and the stream server owns
 * 39177; a collision takes down a neighbouring suite rather than this one,
 * which is how two ranges overlapped here for months unnoticed.
 */
const PORT = Number(process.env.ACCEPTANCE_WEBAPP_PORT || 5176);
const API_PORT = Number(process.env.ACCEPTANCE_API_PORT || 4313);

const isolated = (name: string) =>
  join(tmpdir(), 'radioatlas-acceptance', `${name}-${process.pid}`);

/**
 * ⚠ Artifacts live OUTSIDE `apps/webapp`, and that is not tidiness.
 *
 * The first run wrote traces and screenshots under the webapp, which is Vite's
 * root — so the dev server watched them, and writing a trace resource pushed an
 * HMR `page reload` into the browser mid-test. A reload restarts the player,
 * empties the dock and resets every measurement, while the run carries on
 * looking healthy. `.claude/rules/e2e-tests.md` records the same trap from the
 * other side (editing `src/` during a run); this is the version that needs no
 * human to trip it.
 */
const ARTIFACTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'acceptance-artifacts');
process.env.ACCEPTANCE_ARTIFACTS = ARTIFACTS;

export default defineConfig({
  testDir: './acceptance',
  timeout: 420_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 390, height: 844 },
    /**
     * ⚠ HEADED, and this is load bearing rather than cosmetic.
     *
     * The whole lane is about what happens when the app goes to the background
     * and comes back. Headless Chromium keeps every page `visible` — measured:
     * `bringToFront()` on a second tab left the first reporting
     * `visibilityState === 'visible'`, so `visibilitychange` never fired and
     * the run would have "passed" scenario 1 without ever backgrounding
     * anything. The test asserts the flip for exactly that reason.
     *
     * Headed, a second tab taking the front produces the real event, from the
     * real browser, on the real timeline.
     */
    headless: false,
    // The short screen recording the owner asked for.
    video: { mode: 'on', size: { width: 390, height: 844 } },
    trace: 'retain-on-failure'
  },
  outputDir: join(ARTIFACTS, 'runs'),
  webServer: [
    {
      command: 'npm --prefix ../api run serve:e2e',
      url: `http://127.0.0.1:${API_PORT}/health`,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        PORT: String(API_PORT),
        GOOGLE_CLIENT_ID: 'test-google-client',
        ENABLE_TEST_AUTH_FIXTURES: '1',
        ACCOUNT_STORE_PATH: `${isolated('account')}.sqlite`,
        OBSERVABILITY_STORE_PATH: `${isolated('observability')}.json`,
        CATALOG_DATA_DIR: isolated('catalog'),
        CATALOG_ARTIFACT_ONLY: '1',
        BILLING_RECONCILE_ENABLED: '0',
        /**
         * ⚠ The product's OWN allow-list, used here and nowhere near
         * production.
         *
         * `/api/stream` refuses upstreams that resolve to a private address —
         * correct, and not something to weaken for a test. But an http stream
         * on an http page is proxy-FIRST by design, so a loopback fixture
         * stream is unreachable without telling the guard about this one host.
         * `MEDIA_SSRF_ALLOW_HOSTS` exists for exactly that and is read from the
         * environment, so the shipped default stays "refuse".
         */
        MEDIA_SSRF_ALLOW_HOSTS: '127.0.0.1'
      }
    },
    {
      command: `npm run dev -- --host --port ${PORT}`,
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: false,
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

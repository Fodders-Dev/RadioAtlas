import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.PLAYWRIGHT_WEBAPP_PORT || 5174);
// Overridable for the same reason the webapp port is: two worktrees running the
// suite at once otherwise fight over one pair of ports. The failure is not a
// clean "port busy" — with PLAYWRIGHT_REUSE_SERVER=1 the run silently attaches
// to the OTHER worktree's dev server and asserts against that branch's code.
const API_PORT = Number(process.env.PLAYWRIGHT_API_PORT || 4311);
const ACCOUNT_STORE_PATH = join(
  tmpdir(),
  'radioatlas-playwright',
  `account-store-${process.pid}-${Date.now()}.sqlite`
);
const REUSE_EXISTING_SERVER = process.env.PLAYWRIGHT_REUSE_SERVER === '1';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: {
    timeout: 5000
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 720 }
  },
  webServer: [
    {
      command: 'npm --prefix ../api run dev',
      url: `http://127.0.0.1:${API_PORT}/health`,
      reuseExistingServer: REUSE_EXISTING_SERVER,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        PORT: String(API_PORT),
        GOOGLE_CLIENT_ID: 'test-google-client',
        ENABLE_TEST_AUTH_FIXTURES: '1',
        ACCOUNT_STORE_PATH
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

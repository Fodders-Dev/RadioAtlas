import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const PORT = 5173;
const API_PORT = 4311;
const ACCOUNT_STORE_PATH = fileURLToPath(new URL('../api/data/playwright-account-store.sqlite', import.meta.url));
const REUSE_EXISTING_SERVER = process.env.PLAYWRIGHT_REUSE_SERVER === '1' || !process.env.CI;

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
        VITE_GOOGLE_CLIENT_ID: 'test-google-client'
      }
    }
  ]
});

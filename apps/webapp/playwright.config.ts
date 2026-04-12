import { defineConfig } from '@playwright/test';

const PORT = 5173;
const API_PORT = 4311;

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
      reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === '1',
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        PORT: String(API_PORT),
        GOOGLE_CLIENT_ID: 'test-google-client',
        ENABLE_TEST_AUTH_FIXTURES: '1'
      }
    },
    {
      command: `npm run dev -- --host --port ${PORT}`,
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === '1',
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        VITE_GOOGLE_CLIENT_ID: 'test-google-client'
      }
    }
  ]
});

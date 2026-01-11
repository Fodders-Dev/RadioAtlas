import { defineConfig } from '@playwright/test';

const PORT = 5173;

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
  webServer: {
    command: `npm run dev -- --host --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe'
  }
});

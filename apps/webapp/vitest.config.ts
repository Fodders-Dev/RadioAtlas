import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Vitest is wired up for unit tests of pure-TS modules in src/lib
// (geoResolver, theme helpers, etc.) and small DOM-touching utilities
// that don't need a full app shell. Playwright still owns end-to-end
// flows under tests/.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Polyfill the topojson + JSON imports the resolver uses so node
    // resolves them through Vite's module graph.
    deps: {
      optimizer: {
        web: { include: ['d3-geo', 'topojson-client'] }
      }
    },
    // Most tests deal with topology data — keep the timeout generous
    // so first-time module resolution doesn't false-fail in CI.
    testTimeout: 8_000
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src')
    }
  }
});

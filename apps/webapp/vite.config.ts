import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json';
import { execSync } from 'node:child_process';

const buildTime = new Date().toISOString();
const commitHash = (() => {
  const explicit = String(process.env.SOURCE_COMMIT || process.env.GITHUB_SHA || '').trim();
  if (explicit) {
    return explicit.slice(0, 7);
  }
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
})();

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(buildTime),
    __APP_COMMIT__: JSON.stringify(commitHash)
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/src/components/WinampPlayerShell') || id.includes('/src/lib/winampBridge')) {
            return 'winamp-shell';
          }
          if (id.includes('node_modules/jszip')) {
            return 'webamp-zip-vendor';
          }
          if (id.includes('node_modules/webamp')) {
            return 'webamp-core-vendor';
          }
          if (id.includes('node_modules/hls.js')) {
            return 'hls-core-vendor';
          }
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) {
            return 'react-vendor';
          }
          if (id.includes('/src/lib/geoResolver') || id.includes('/src/assets/countries-110m.json')) {
            return 'globe-geo-data';
          }
          if (id.includes('node_modules/d3-geo') || id.includes('node_modules/topojson-client')) {
            return 'globe-vendor';
          }
          return undefined;
        }
      }
    }
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
});

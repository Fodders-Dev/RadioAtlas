import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json';
import { execSync } from 'node:child_process';
import { extname, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';

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

const PRECOMPRESSED_EXTENSIONS = new Set(['.js', '.css', '.html', '.json', '.svg']);
const MIN_PRECOMPRESS_SIZE = 1024;

const precompressStaticAssets = () => ({
  name: 'radioatlas-precompress-static-assets',
  apply: 'build',
  writeBundle(options: { dir?: string | null }, bundle: Record<string, unknown>) {
    if (!options.dir) {
      return;
    }

    for (const fileName of Object.keys(bundle)) {
      if (fileName.endsWith('.gz') || fileName.endsWith('.br')) {
        continue;
      }
      if (!PRECOMPRESSED_EXTENSIONS.has(extname(fileName))) {
        continue;
      }

      const filePath = join(options.dir, fileName);
      const source = readFileSync(filePath);
      if (source.byteLength < MIN_PRECOMPRESS_SIZE) {
        continue;
      }

      const gzipBuffer = gzipSync(source, { level: 9 });
      if (gzipBuffer.byteLength < source.byteLength) {
        writeFileSync(`${filePath}.gz`, gzipBuffer);
      }

      const brotliBuffer = brotliCompressSync(source, {
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]: 11
        }
      });
      if (brotliBuffer.byteLength < source.byteLength) {
        writeFileSync(`${filePath}.br`, brotliBuffer);
      }
    }
  }
});

export default defineConfig({
  plugins: [react(), precompressStaticAssets()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(buildTime),
    __APP_COMMIT__: JSON.stringify(commitHash)
  },
  build: {
    modulePreload: false,
    rollupOptions: {
      external: ['react', 'react-dom/client', 'react/jsx-runtime'],
      output: {
        paths: {
          react: 'https://esm.sh/react@18.3.1',
          'react-dom/client': 'https://esm.sh/react-dom@18.3.1/client',
          'react/jsx-runtime': 'https://esm.sh/react@18.3.1/jsx-runtime'
        },
        manualChunks(id) {
          if (id.includes('vite/preload-helper')) {
            return 'boot-preload';
          }
          if (
            id.includes('/src/RuntimeProviders') ||
            id.includes('/src/App.tsx') ||
            id.includes('/src/state/LocaleContext') ||
            id.includes('/src/state/localeDictionary') ||
            id.includes('/src/state/ThemeContext') ||
            id.includes('/src/lib/theme/') ||
            id.includes('/src/state/SessionContext') ||
            id.includes('/src/lib/authSession') ||
            id.includes('/src/state/CatalogContext') ||
            id.includes('/src/lib/apiBase') ||
            id.includes('/src/domain/contracts') ||
            id.includes('/src/components/SettingsSheet') ||
            id.includes('/src/components/Toast') ||
            id.includes('/src/lib/buildInfo') ||
            id.includes('/src/lib/screenLoaders') ||
            id.includes('/src/lib/telegram') ||
            id.includes('/src/lib/useCompactLayout')
          ) {
            return 'runtime-shell';
          }
          if (
            id.includes('/src/state/RadioContext') ||
            id.includes('/src/state/radio/') ||
            id.includes('/src/lib/persistentState') ||
            id.includes('/src/lib/deviceProfile') ||
            id.includes('/src/lib/silentAudio')
          ) {
            return 'radio-state';
          }
          if (
            id.includes('/src/components/MiniPlayerDock') ||
            id.includes('/src/components/StationArtwork')
          ) {
            return 'dock-shell';
          }
          if (id.includes('node_modules/jszip')) {
            return 'skin-zip-vendor';
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

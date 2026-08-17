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
      output: {
        // #180 stamped the build commit into CSS filenames because this
        // toolchain's CSS `[hash]` was NOT content-derived: a CSS-only edit
        // reused the same filename, and with `Cache-Control: immutable` the
        // Telegram WebView kept the old stylesheet forever.
        //
        // That is FIXED upstream now — measured: editing one CSS declaration
        // moves the hash (FullPlayerOverlay-C-wY5E8D -> -CRzT_Sz7) with the
        // commit held constant. The stamp is therefore redundant, and it was
        // actively harmful: chunk hashes are computed over a graph that includes
        // asset filenames, so a new commit rotated the name of EVERY chunk —
        // including the 1MB maplibre vendor chunk whose bytes never change.
        // Measured on prod: 25 byte-identical copies of maplibre-vendor (one md5,
        // 1,027,743 bytes each) in a single release, i.e. every deploy made every
        // listener re-download the whole bundle over mobile data.
        //
        // Isolated proof: with source unchanged, SOURCE_COMMIT=aaaaaaa produced
        // maplibre-vendor-BwL657R7.js and SOURCE_COMMIT=bbbbbbb produced
        // maplibre-vendor-DZpQDDZH.js.
        assetFileNames: 'assets/[name]-[hash][extname]',
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/');
          if (normalizedId.includes('vite/preload-helper')) {
            return 'boot-preload';
          }
          if (normalizedId.includes('node_modules/react') || normalizedId.includes('node_modules/scheduler')) {
            return 'react-vendor';
          }
          if (normalizedId.includes('/src/lib/radioBrowserFallback')) {
            return 'catalog-fallback';
          }
          if (normalizedId.includes('node_modules/hls.js')) {
            return 'hls-core-vendor';
          }
          if (
            normalizedId.includes('/src/state/radio/PlaybackRuntime') ||
            normalizedId.includes('/src/state/radio/useNowPlayingSync') ||
            normalizedId.includes('/src/lib/useAudioPlayer') ||
            normalizedId.includes('/src/lib/nowPlaying') ||
            normalizedId.includes('/src/lib/playbackTransport') ||
            normalizedId.includes('/src/lib/stationStreams') ||
            normalizedId.includes('/src/lib/apiAvailability')
          ) {
            return undefined;
          }
          if (normalizedId.includes('/src/lib/geoResolver') || normalizedId.includes('/src/assets/countries-110m.json')) {
            return 'globe-geo-data';
          }
          if (normalizedId.includes('node_modules/d3-geo') || normalizedId.includes('node_modules/topojson-client')) {
            return 'globe-vendor';
          }
          // MapLibre GL is the largest single dependency (~1 MB
          // raw, ~270 KB gzip) and almost never changes between
          // RadioAtlas releases. Putting it in its own chunk lets
          // the browser keep it cached across our deploys
          // independent of the Globe-screen application code, so
          // a globe-screen update doesn't force users to
          // re-download the renderer.
          if (
            normalizedId.includes('node_modules/maplibre-gl') ||
            normalizedId.includes('maplibre-gl/dist/maplibre-gl.css')
          ) {
            return 'maplibre-vendor';
          }
          if (
            normalizedId.includes('/src/RuntimeProviders') ||
            normalizedId.includes('/src/App.tsx') ||
            normalizedId.includes('/src/state/LocaleContext') ||
            normalizedId.includes('/src/state/localeDictionary') ||
            normalizedId.includes('/src/state/ThemeContext') ||
            normalizedId.includes('/src/lib/theme/') ||
            normalizedId.includes('/src/state/SessionContext') ||
            normalizedId.includes('/src/lib/authSession') ||
            normalizedId.includes('/src/state/CatalogContext') ||
            normalizedId.includes('/src/lib/apiBase') ||
            normalizedId.includes('/src/domain/contracts') ||
            normalizedId.includes('/src/components/SettingsSheet') ||
            normalizedId.includes('/src/components/Toast') ||
            normalizedId.includes('/src/lib/buildInfo') ||
            normalizedId.includes('/src/lib/screenLoaders') ||
            normalizedId.includes('/src/lib/telegram') ||
            normalizedId.includes('/src/lib/useCompactLayout')
          ) {
            return 'runtime-shell';
          }
          if (
            normalizedId.includes('/src/state/RadioContext') ||
            normalizedId.includes('/src/state/radio/') ||
            normalizedId.includes('/src/lib/persistentState') ||
            normalizedId.includes('/src/lib/deviceProfile')
          ) {
            return 'radio-state';
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
        // NOT process.env.PORT. In this process PORT means the port THIS dev
        // server listens on — every launcher sets it that way — so reading it
        // here pointed the proxy at the dev server itself. `/api/health` then
        // rewrote to `/health`, hit the SPA fallback and returned index.html
        // with a 200 and no proxy error in the log, so the app simply had no
        // catalogue: an empty globe, no stations, no Russia, nothing to explain
        // it. Only VITE_API_PROXY_PORT means "the API's port".
        //
        // 127.0.0.1, not localhost: the API binds to IPv4 only, and on Windows
        // `localhost` resolves to ::1 first, which is a connection refused that
        // Node's http client does not retry over IPv4.
        target: `http://127.0.0.1:${process.env.VITE_API_PROXY_PORT || 3001}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
});

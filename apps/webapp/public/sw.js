/* Service worker for RadioAtlas.
 *
 * It exists so the app can be INSTALLED — on a phone home screen, and on Windows
 * or macOS as a real window with its own icon, which is the whole desktop-app
 * request answered without a second program. An installable PWA needs a manifest
 * and a service worker with a fetch handler; this is the smallest honest one.
 *
 * WHAT IT CACHES: `/assets/` only. Vite content-hashes every file there, so a
 * changed file arrives under a changed name and a cached copy can never be
 * stale — cache-first is safe by construction, not by hope.
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH, and each one would be a real bug:
 *
 *   - `index.html`. The shell is served `Cache-Control: no-store` on purpose
 *     (see the note in index.html); caching it here would fight that and pin
 *     listeners to a dead release after a deploy. There is therefore no offline
 *     shell, and that is a choice: a radio app with no network has nothing to
 *     play anyway.
 *   - Audio. `/stream`, and every station URL, must reach the network untouched.
 *     A service worker sitting in front of a live audio body is a way to break
 *     playback in ways that are very hard to see.
 *   - The API. Catalogue and metadata answers go stale in minutes and have their
 *     own caching rules on the server.
 *
 * Anything not matched below is left alone — no `respondWith`, so the browser
 * behaves exactly as it would with no worker installed at all.
 */

// Bump when the caching RULES change. Hashed asset names make content changes
// self-versioning, so this is only about the policy in this file.
const CACHE = 'radioatlas-assets-v1';

self.addEventListener('install', (event) => {
  // Nothing is pre-cached: the asset names are build-generated and unknown here,
  // and guessing them would ship a worker that 404s on every deploy.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith('radioatlas-') && name !== CACHE).map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Same origin only, and only the content-hashed bundle directory.
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith('/assets/')) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;

      const response = await fetch(request);
      // Only store a complete, successful, same-origin answer. An opaque or
      // partial response cached here would be served forever as if it were whole.
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(request, response.clone());
      }
      return response;
    })()
  );
});

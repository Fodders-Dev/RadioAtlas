import { afterEach, describe, expect, it, vi } from 'vitest';

import { getApiBase } from './apiBase';

/**
 * `npm run dev:webapp` + `npm run dev:api` — the pair the README tells a new
 * developer to run — used to produce an app with no catalogue and nothing to
 * explain it. The default API base was `/api` only when the page was served
 * over https, so on http://localhost the base was empty, requests went to
 * `http://localhost:5173/catalog/points`, and Vite answered every one of them
 * with the SPA fallback: 200, text/html, no error anywhere. The globe simply
 * had zero stations, at every zoom, in every country.
 */

const atLocation = (href: string) => {
  const url = new URL(href);
  vi.stubGlobal('window', {
    location: {
      href,
      hostname: url.hostname,
      protocol: url.protocol,
      search: url.search
    },
    localStorage: {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined
    }
  });
  vi.stubGlobal('localStorage', window.localStorage);
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getApiBase', () => {
  it('uses the dev proxy on plain-http localhost', () => {
    atLocation('http://localhost:5173/');
    expect(getApiBase()).toBe('/api');
  });

  it('does the same for 127.0.0.1 and for a *.localhost host', () => {
    atLocation('http://127.0.0.1:5173/');
    expect(getApiBase()).toBe('/api');
    atLocation('http://app.localhost:5173/');
    expect(getApiBase()).toBe('/api');
  });

  it('keeps /api behind https, which is how production is served', () => {
    atLocation('https://radioatlas.ru/');
    expect(getApiBase()).toBe('/api');
  });

  it('stays empty on a plain-http host that is NOT local', () => {
    // Nothing promises a proxy there, and guessing one would send every
    // request into a 404 on someone else's server.
    atLocation('http://example.com/');
    expect(getApiBase()).toBe('');
  });

  it('an explicit ?api= still wins', () => {
    atLocation('http://localhost:5173/?api=http://127.0.0.1:4311');
    expect(getApiBase()).toBe('http://127.0.0.1:4311');
  });
});

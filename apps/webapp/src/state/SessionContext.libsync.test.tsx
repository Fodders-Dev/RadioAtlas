import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('../lib/apiBase', () => ({ getApiBase: () => 'http://test.local' }));
vi.mock('../lib/observability', () => ({ reportClientEvent: vi.fn() }));

import { SessionProvider, useSession } from './SessionContext';
import type { CloudLibrary } from '../domain/contracts';

type SessionContextValue = ReturnType<typeof useSession>;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const SESSION_KEY = 'radio:session:v1';

const emptyLibrary = (updatedAt = 1): CloudLibrary => ({
  favorites: [],
  recent: [],
  trackHistory: [],
  collections: [],
  followedStations: [],
  followedRegions: [],
  alerts: [],
  tasteProfile: null,
  updatedAt
});

const station = {
  stationuuid: 's-1',
  name: 'Test Station',
  url: '',
  url_resolved: '',
  homepage: '',
  favicon: '',
  country: '',
  state: '',
  tags: '',
  geo_lat: null,
  geo_long: null
} as unknown as CloudLibrary['favorites'][number];

const profileFixture = (library: CloudLibrary = emptyLibrary()) => ({
  id: 'acct-1',
  displayName: 'U',
  username: null,
  email: null,
  photoUrl: null,
  isPremium: false,
  premiumStatus: 'free',
  supporterTier: 'none',
  entitlements: [],
  billingProvider: null,
  linkedProviders: ['telegram'],
  providers: [
    {
      kind: 'telegram',
      externalId: '1',
      displayName: 'U',
      username: null,
      email: null,
      photoUrl: null,
      isPremium: false,
      linkedAt: 1
    }
  ],
  referralCount: 0,
  library
});

const jsonRes = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  }) as unknown as Response;

let putLibraryBodies: Array<{ favorites: unknown[] }> = [];
let libraryStatusQueue: number[] = [];
let authToken = 'token-1';

const installFetch = () => {
  putLibraryBodies = [];
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    if (url.endsWith('/me/library') && method === 'PUT') {
      const body = JSON.parse(String(init?.body)) as { favorites: unknown[] };
      putLibraryBodies.push(body);
      const status = libraryStatusQueue.shift() ?? 200;
      if (status !== 200) return jsonRes({ error: 'token expired' }, status);
      return jsonRes({ profile: profileFixture(emptyLibrary(2)), auditTrail: [] });
    }
    if (url.endsWith('/auth/telegram') && method === 'POST') {
      return jsonRes({ token: authToken, profile: profileFixture(), auditTrail: [] });
    }
    if (url.endsWith('/me')) {
      return jsonRes({ profile: profileFixture(), auditTrail: [] });
    }
    // /auth/providers, /billing/telegram/products, etc — fault-tolerant in code.
    return jsonRes({}, 200);
  }) as unknown as typeof fetch;
};

const installTelegram = (initData: string) => {
  Object.defineProperty(window, 'Telegram', {
    configurable: true,
    value: {
      WebApp: {
        initData,
        initDataUnsafe: {},
        platform: 'ios',
        ready: () => {},
        expand: () => {}
      }
    }
  });
};

const tick = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('SessionContext cloud library sync — token-expiry data-loss (T_stability)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let ctx: SessionContextValue | null = null;

  const Probe = () => {
    ctx = useSession();
    return null;
  };

  beforeEach(() => {
    libraryStatusQueue = [];
    authToken = 'token-1';
    localStorage.clear();
    Object.defineProperty(window, 'Telegram', { configurable: true, value: undefined });
    installFetch();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    ctx = null;
    vi.restoreAllMocks();
  });

  const mount = async () => {
    await act(async () => {
      root.render(createElement(SessionProvider, null, createElement(Probe)));
    });
    await tick();
  };

  const authenticate = async (token: string) => {
    authToken = token;
    installTelegram('auth_date=1&hash=abc');
    await act(async () => {
      await ctx!.signInWithTelegram();
    });
    await tick();
    expect(ctx!.status).toBe('authenticated');
  };

  it('re-queues a 401-failed library change and re-flushes it after re-auth (no data loss)', async () => {
    await mount();
    await authenticate('token-1');

    // The next library PUT 401s (token expired mid-flight).
    libraryStatusQueue = [401];
    await act(async () => {
      await ctx!.replaceCloudLibrary({ ...emptyLibrary(), favorites: [station] });
    });
    await tick();

    // The change reached the server once (the 401'd attempt) and is NOT silently
    // dropped — sync is in error, but the change is preserved for re-auth.
    expect(putLibraryBodies).toHaveLength(1);
    expect(putLibraryBodies[0]?.favorites).toHaveLength(1);
    expect(ctx!.syncState).toBe('error');

    // Re-authenticate (fresh token). The preserved change must re-flush.
    libraryStatusQueue = [200];
    await authenticate('token-2');
    await tick();

    expect(putLibraryBodies).toHaveLength(2);
    expect(putLibraryBodies[1]?.favorites).toHaveLength(1);
  });

  it('does not drop the queued change when the token is already gone at flush time', async () => {
    await mount();
    await authenticate('token-1');

    // Simulate the token vanishing before the flush runs (expired + cleared).
    localStorage.removeItem(SESSION_KEY);
    await act(async () => {
      await ctx!.replaceCloudLibrary({ ...emptyLibrary(), favorites: [station] });
    });
    await tick();

    // No PUT could happen (no token), but the change is NOT lost.
    expect(putLibraryBodies).toHaveLength(0);

    // Re-auth re-flushes the preserved change.
    libraryStatusQueue = [200];
    await authenticate('token-3');
    await tick();

    expect(putLibraryBodies).toHaveLength(1);
    expect(putLibraryBodies[0]?.favorites).toHaveLength(1);
  });
});

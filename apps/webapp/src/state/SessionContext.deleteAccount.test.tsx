import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('../lib/apiBase', () => ({ getApiBase: () => 'http://test.local' }));
vi.mock('../lib/observability', () => ({ reportClientEvent: vi.fn() }));

import { SessionProvider, useSession } from './SessionContext';
import type { CloudLibrary } from '../domain/contracts';

/**
 * `deleteAccount` is the only irreversible thing this context can do, and the
 * ORDER of its two steps is the whole safety property.
 *
 * The failure worth guarding: clearing the local session before the server has
 * confirmed. That leaves somebody logged out, believing they were deleted, while
 * their library sits on the server untouched — a lie told by the UI, and exactly
 * the thing an account-deletion feature exists to make impossible. So the last
 * test here fails the delete and asserts the person is STILL signed in.
 */

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

const profileFixture = () => ({
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
  providers: [{ kind: 'telegram', externalId: '1', displayName: 'U', username: null, email: null }],
  library: emptyLibrary(),
  referralCount: 0
});

const jsonRes = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

/** Every DELETE the context issued, so the URL and method can be asserted. */
let deleteCalls: Array<{ url: string; auth: string | null }> = [];
let deleteStatus = 200;

const installFetch = () => {
  deleteCalls = [];
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    if (method === 'DELETE') {
      const headers = (init?.headers || {}) as Record<string, string>;
      deleteCalls.push({ url, auth: headers.Authorization ?? null });
      if (deleteStatus !== 200) return jsonRes({ error: 'confirmation required' }, deleteStatus);
      return jsonRes({ ok: true, removed: { providers: 1, sessions: 1, auditEvents: 3, purchases: 0 } });
    }
    if (url.endsWith('/auth/telegram') && method === 'POST') {
      return jsonRes({ token: 'token-1', profile: profileFixture(), auditTrail: [] });
    }
    if (url.endsWith('/me')) {
      return jsonRes({ profile: profileFixture(), auditTrail: [] });
    }
    return jsonRes({}, 200);
  }) as unknown as typeof fetch;
};

const installTelegram = (initData: string) => {
  Object.defineProperty(window, 'Telegram', {
    configurable: true,
    value: {
      WebApp: { initData, initDataUnsafe: {}, platform: 'ios', ready: () => {}, expand: () => {} }
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

describe('SessionContext deleteAccount', () => {
  let container: HTMLDivElement;
  let root: Root;
  let ctx: SessionContextValue | null = null;

  const Probe = () => {
    ctx = useSession();
    return null;
  };

  beforeEach(() => {
    deleteStatus = 200;
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

  const mountAndAuthenticate = async () => {
    await act(async () => {
      root.render(createElement(SessionProvider, null, createElement(Probe)));
    });
    await tick();
    installTelegram('auth_date=1&hash=abc');
    await act(async () => {
      await ctx!.signInWithTelegram();
    });
    await tick();
    expect(ctx!.status).toBe('authenticated');
  };

  it('asks the API to delete, with the confirmation the server demands', async () => {
    await mountAndAuthenticate();
    await act(async () => {
      await ctx!.deleteAccount();
    });
    await tick();

    const call = deleteCalls.find((entry) => entry.url.includes('/me?'));
    expect(call, 'no DELETE /me was issued').toBeTruthy();
    // Without ?confirm=delete the API answers 400 — see accountRoutes.
    expect(call!.url).toContain('confirm=delete');
    expect(call!.auth).toBe('Bearer token-1');
  });

  it('signs out once the server has confirmed', async () => {
    await mountAndAuthenticate();
    await act(async () => {
      await ctx!.deleteAccount();
    });
    await tick();

    expect(ctx!.status).toBe('local');
    expect(ctx!.profile).toBeNull();
    expect(localStorage.getItem(SESSION_KEY) || '').toBe('');
  });

  it('reports success back to the caller', async () => {
    await mountAndAuthenticate();
    let result: boolean | undefined;
    await act(async () => {
      result = await ctx!.deleteAccount();
    });
    expect(result).toBe(true);
  });

  it('does NOT sign out when the server refuses, so nobody is told a lie', async () => {
    // The dangerous ordering: clear the session first, ask afterwards. That
    // leaves a person logged out and convinced they are gone while every saved
    // station is still on the server.
    deleteStatus = 400;
    await mountAndAuthenticate();

    let result: boolean | undefined;
    await act(async () => {
      result = await ctx!.deleteAccount();
    });
    await tick();

    expect(result).toBe(false);
    expect(ctx!.status).toBe('authenticated');
    expect(ctx!.profile).not.toBeNull();
    expect(ctx!.error).toBeTruthy();
  });
});

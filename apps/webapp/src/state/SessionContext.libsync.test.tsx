import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('../lib/apiBase', () => ({ getApiBase: () => 'http://test.local' }));
vi.mock('../lib/observability', () => ({ reportClientEvent: vi.fn() }));

import { SessionProvider, useSession } from './SessionContext';
import type { CloudLibrary } from '../domain/contracts';
import { useCloudLibrarySync } from './radio/useCloudLibrarySync';
import { DEFAULT_TASTE_PROFILE_V2 } from '../lib/tasteProfile';

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
let serverLibrary: CloudLibrary | null = null;
let profileGets = 0;
let failProfileGet = false;
let holdLibraryWrites = false;
let holdProfileGet = false;
let releaseProfile: (() => void) | null = null;
let releaseWrites: Array<() => void> = [];

const installFetch = () => {
  putLibraryBodies = [];
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    if (url.endsWith('/me/library') && method === 'PUT') {
      const body = JSON.parse(String(init?.body)) as { favorites: unknown[] };
      putLibraryBodies.push(body);
      const status = libraryStatusQueue.shift() ?? 200;
      if (status === 409) return jsonRes({ error: 'conflict', profile: profileFixture(serverLibrary!) }, 409);
      if (status !== 200) {
        const reply = jsonRes({ error: 'token expired' }, status);
        if (holdLibraryWrites) return await new Promise<Response>(resolve => { releaseWrites.push(() => resolve(reply)); });
        return reply;
      }
      if (serverLibrary) {
        serverLibrary = { ...JSON.parse(String(init?.body)), revision: `revision-${putLibraryBodies.length}`, updatedAt: putLibraryBodies.length + 10 };
        const reply = jsonRes({ profile: profileFixture(serverLibrary!), auditTrail: [] });
        if (holdLibraryWrites) return await new Promise<Response>(resolve => { releaseWrites.push(() => resolve(reply)); });
        return reply;
      }
      return jsonRes({ profile: profileFixture(emptyLibrary(2)), auditTrail: [] });
    }
    if (url.endsWith('/auth/telegram') && method === 'POST') {
      return jsonRes({ token: authToken, profile: profileFixture(serverLibrary ?? undefined), auditTrail: [] });
    }
    if (url.endsWith('/me')) {
      profileGets += 1;
      if (failProfileGet) throw new Error('offline');
      if (holdProfileGet) {
        holdProfileGet = false;
        const reply = jsonRes({ profile: profileFixture(serverLibrary ?? undefined), auditTrail: [] });
        return await new Promise<Response>(resolve => { releaseProfile = () => resolve(reply); });
      }
      return jsonRes({ profile: profileFixture(serverLibrary ?? undefined), auditTrail: [] });
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
  let hookCollections: CloudLibrary['collections'] = [];
  let editHookCollections: (next: CloudLibrary['collections']) => void;
  const ignoreCloudSetter = () => {};
  const HookProbe = () => {
    const session = useSession();
    const [collections, setCollections] = useState<CloudLibrary['collections']>([]);
    hookCollections = collections;
    editHookCollections = setCollections;
    useCloudLibrarySync({
      sessionStatus: session.status, sessionProfileId: session.profile?.id,
      cloudLibrary: session.library, replaceCloudLibrary: session.replaceCloudLibrary,
      collections, setCollections, favorites: [], recent: [], trackHistory: [], followedStations: [], followedRegions: [], alerts: [], tasteProfile: DEFAULT_TASTE_PROFILE_V2,
      setFavorites: ignoreCloudSetter, setRecent: ignoreCloudSetter, setTrackHistory: ignoreCloudSetter,
      setFollowedStations: ignoreCloudSetter, setFollowedRegions: ignoreCloudSetter, setAlerts: ignoreCloudSetter, setTasteProfile: ignoreCloudSetter
    });
    return null;
  };

  const Probe = () => {
    ctx = useSession();
    return null;
  };

  beforeEach(() => {
    libraryStatusQueue = [];
    authToken = 'token-1';
    serverLibrary = null;
    profileGets = 0;
    failProfileGet = false;
    holdLibraryWrites = false;
    holdProfileGet = false;
    releaseProfile = null;
    releaseWrites = [];
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

  const mount = async (withCloudHook = false) => {
    await act(async () => {
      root.render(createElement(SessionProvider, null, createElement(Probe), withCloudHook ? createElement(HookProbe) : null));
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

  it('pulls another device changes on foreground and keeps authentication on offline return', async () => {
    serverLibrary = { ...emptyLibrary(), revision: 'base' };
    await mount();
    await authenticate('token-1');
    serverLibrary = { ...serverLibrary, favorites: [station], revision: 'phone-added' };
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await tick();
    expect(ctx!.library?.favorites).toEqual([station]);
    expect(profileGets).toBe(1);
    expect(putLibraryBodies).toHaveLength(0);
    // A duplicate focus/pageshow is one pull, not a burst.
    await act(async () => { window.dispatchEvent(new Event('pageshow')); });
    expect(profileGets).toBe(1);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6_000);
    failProfileGet = true;
    await act(async () => { window.dispatchEvent(new Event('online')); });
    await tick();
    expect(ctx!.status).toBe('authenticated');
    expect(ctx!.library?.favorites).toEqual([station]);
    expect(localStorage.getItem(SESSION_KEY)).toBe('token-1');
  });

  it('does not apply a delayed pre-write GET over an acknowledged local addition', async () => {
    serverLibrary = { ...emptyLibrary(), revision: 'base' };
    await mount();
    await authenticate('token-1');
    holdProfileGet = true;
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(releaseProfile).not.toBeNull();
    await act(async () => { await ctx!.replaceCloudLibrary({ ...serverLibrary!, favorites: [station] }); });
    expect(ctx!.library?.favorites).toEqual([station]);
    await act(async () => { releaseProfile!(); });
    await tick();
    expect(ctx!.library?.favorites).toEqual([station]);
    expect(ctx!.library?.revision).toBe('revision-1');
  });

  it('keeps undoing an addition while its older PUT is still in flight', async () => {
    const base = { ...emptyLibrary(), revision: 'base' };
    serverLibrary = base;
    await mount();
    await authenticate('token-1');
    holdLibraryWrites = true;
    await act(async () => { void ctx!.replaceCloudLibrary({ ...base, favorites: [station] }); });
    await act(async () => { void ctx!.replaceCloudLibrary(base); });
    expect(releaseWrites).toHaveLength(1);
    await act(async () => { releaseWrites[0](); });
    await tick();
    expect(releaseWrites).toHaveLength(2);
    expect(putLibraryBodies[1].favorites).toEqual([]);
    expect(ctx!.library?.favorites).toEqual([]);
    await act(async () => { releaseWrites[1](); });
    await tick();
    expect(ctx!.library?.favorites).toEqual([]);
    expect(ctx!.syncState).toBe('synced');
  });

  it('old-token completion cannot clear or drain the newer in-flight write', async () => {
    serverLibrary = { ...emptyLibrary(), revision: 'base' };
    await mount();
    await authenticate('token-1');
    holdLibraryWrites = true;
    await act(async () => { void ctx!.replaceCloudLibrary({ ...serverLibrary!, favorites: [station] }); });
    await authenticate('token-2');
    const second = { ...station, stationuuid: 'second' };
    const third = { ...station, stationuuid: 'third' };
    await act(async () => { void ctx!.replaceCloudLibrary({ ...serverLibrary!, favorites: [second] }); });
    expect(releaseWrites).toHaveLength(2);
    await act(async () => { releaseWrites[0](); });
    await tick();
    await act(async () => { void ctx!.replaceCloudLibrary({ ...serverLibrary!, favorites: [third] }); });
    expect(releaseWrites).toHaveLength(2);
    await act(async () => { releaseWrites[1](); });
    await tick();
    expect(releaseWrites).toHaveLength(3);
    await act(async () => { releaseWrites[2](); });
    await tick();
    expect(ctx!.library?.favorites).toEqual([third]);
    expect(ctx!.syncState).toBe('synced');
  });

  it('rebases a stale write onto the latest server playlist without dropping either addition', async () => {
    const collection = { id: 'mix', name: 'Mix', description: '', isPublic: false, pinned: false, createdAt: 1, updatedAt: 1, stationIds: ['a'] };
    const base = { ...emptyLibrary(), revision: 'base', collections: [collection] };
    serverLibrary = base;
    await mount();
    await authenticate('token-1');
    serverLibrary = { ...base, revision: 'phone', collections: [{ ...collection, stationIds: ['a', 'phone'], updatedAt: 2 }] };
    libraryStatusQueue = [409, 200];
    await act(async () => { await ctx!.replaceCloudLibrary({ ...base, collections: [{ ...collection, stationIds: ['a', 'desktop'], updatedAt: 3 }] }); });
    await tick();
    expect(putLibraryBodies).toHaveLength(2);
    expect((putLibraryBodies[0] as unknown as { baseRevision: string }).baseRevision).toBe('base');
    expect((putLibraryBodies[1] as unknown as { baseRevision: string }).baseRevision).toBe('phone');
    expect(ctx!.library?.collections[0].stationIds).toEqual(['a', 'desktop', 'phone']);
    expect(ctx!.syncState).toBe('synced');
  });

  it('retries a failed write on return rather than silently discarding it', async () => {
    serverLibrary = { ...emptyLibrary(), revision: 'base' };
    await mount();
    await authenticate('token-1');
    libraryStatusQueue = [503, 200];
    await act(async () => { await ctx!.replaceCloudLibrary({ ...serverLibrary!, favorites: [station] }); });
    expect(ctx!.syncState).toBe('error');
    expect(putLibraryBodies).toHaveLength(1);
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await tick();
    expect(putLibraryBodies).toHaveLength(2);
    expect(ctx!.library?.favorites).toEqual([station]);
    expect(ctx!.syncState).toBe('synced');
  });

  for (const serverCommitted of [false, true]) {
    it(`does not resurrect an undone failed addition (server committed: ${serverCommitted})`, async () => {
      const base = { ...emptyLibrary(), revision: 'base' };
      serverLibrary = base;
      await mount();
      await authenticate('token-1');
      libraryStatusQueue = [503];
      await act(async () => { await ctx!.replaceCloudLibrary({ ...base, favorites: [station] }); });
      if (serverCommitted) {
        serverLibrary = { ...base, favorites: [station], revision: 'committed-with-lost-ack' };
        libraryStatusQueue = [409, 200];
      }
      await act(async () => { await ctx!.replaceCloudLibrary(base); });
      await act(async () => { window.dispatchEvent(new Event('focus')); });
      await tick();
      expect(ctx!.library?.favorites).toEqual([]);
      expect(serverLibrary!.favorites).toEqual([]);
      expect(ctx!.syncState).toBe('synced');
    });
  }

  it('retains the failed addition when the user adds another favorite before retry', async () => {
    const base = { ...emptyLibrary(), revision: 'base' };
    serverLibrary = base;
    await mount();
    await authenticate('token-1');
    libraryStatusQueue = [503];
    await act(async () => { await ctx!.replaceCloudLibrary({ ...base, favorites: [station] }); });
    const second = { ...station, stationuuid: 'second' };
    libraryStatusQueue = [409, 200];
    await act(async () => { await ctx!.replaceCloudLibrary({ ...base, favorites: [station, second] }); });
    expect(ctx!.library?.favorites).toEqual([station, second]);
  });

  it('keeps unseen remote additions when the user edits during a conflict retry', async () => {
    const collection = { id: 'mix', name: 'Mix', description: '', isPublic: false, pinned: false, createdAt: 1, updatedAt: 1, stationIds: ['a'] };
    const base = { ...emptyLibrary(), revision: 'base', collections: [collection] };
    serverLibrary = base;
    await mount();
    await authenticate('token-1');
    serverLibrary = { ...base, revision: 'phone', collections: [{ ...collection, stationIds: ['a', 'phone'], updatedAt: 2 }] };
    libraryStatusQueue = [409, 200];
    holdLibraryWrites = true;
    await act(async () => { void ctx!.replaceCloudLibrary({ ...base, collections: [{ ...collection, stationIds: ['a', 'desktop'], updatedAt: 3 }] }); });
    await tick();
    expect(releaseWrites).toHaveLength(1);
    await act(async () => { void ctx!.replaceCloudLibrary({ ...base, collections: [{ ...collection, stationIds: ['a', 'desktop', 'extra'], updatedAt: 4 }] }); });
    await act(async () => { releaseWrites[0](); });
    await tick();
    expect(releaseWrites).toHaveLength(2);
    await act(async () => { void ctx!.replaceCloudLibrary({ ...base, collections: [{ ...collection, stationIds: ['a', 'desktop', 'extra', 'third-edit'], updatedAt: 5 }] }); });
    await act(async () => { releaseWrites[1](); });
    await tick();
    expect(releaseWrites).toHaveLength(3);
    await act(async () => { releaseWrites[2](); });
    await tick();
    expect(ctx!.library?.collections[0].stationIds).toEqual(['a', 'desktop', 'extra', 'third-edit', 'phone']);
  });

  it('keeps unseen phone additions after a conflict retry fails and local editing continues', async () => {
    const collection = { id: 'mix', name: 'Mix', description: '', isPublic: false, pinned: false, createdAt: 1, updatedAt: 1, stationIds: ['a'] };
    const base = { ...emptyLibrary(), revision: 'base', collections: [collection] };
    serverLibrary = base;
    await mount();
    await authenticate('token-1');
    serverLibrary = { ...base, revision: 'phone', collections: [{ ...collection, stationIds: ['a', 'phone'], updatedAt: 2 }] };
    libraryStatusQueue = [409, 503];
    await act(async () => { await ctx!.replaceCloudLibrary({ ...base, collections: [{ ...collection, stationIds: ['a', 'desktop'], updatedAt: 3 }] }); });
    await act(async () => { await ctx!.replaceCloudLibrary({ ...base, collections: [{ ...collection, stationIds: ['a', 'desktop', 'extra'], updatedAt: 4 }] }); });
    expect(ctx!.library?.collections[0].stationIds).toEqual(['a', 'desktop', 'extra', 'phone']);
  });

  it('retries accumulated local additions when the older pending save fails before committing', async () => {
    const base = { ...emptyLibrary(), revision: 'base' };
    serverLibrary = base;
    await mount();
    await authenticate('token-1');
    libraryStatusQueue = [503];
    holdLibraryWrites = true;
    const second = { ...station, stationuuid: 'second' };
    const phone = { ...station, stationuuid: 'phone' };
    await act(async () => { void ctx!.replaceCloudLibrary({ ...base, favorites: [station] }); });
    await act(async () => { void ctx!.replaceCloudLibrary({ ...base, favorites: [station, second] }); });
    await act(async () => { releaseWrites[0](); });
    await tick();
    holdLibraryWrites = false;
    serverLibrary = { ...base, favorites: [phone], revision: 'phone' };
    libraryStatusQueue = [409, 200];
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await tick();
    expect(ctx!.library?.favorites).toEqual([station, second, phone]);
  });

  it('captures a playlist undo before the older acknowledgement reaches the real cloud hook', async () => {
    const collection = { id: 'mix', name: 'Mix', description: '', isPublic: false, pinned: false, createdAt: 1, updatedAt: 1, stationIds: ['a'] };
    const base = { ...emptyLibrary(), revision: 'base', tasteProfile: DEFAULT_TASTE_PROFILE_V2, collections: [collection] };
    serverLibrary = base;
    // Install the runtime before mount: otherwise the 300ms runtime poll
    // discovers it during our transmission delay and signs in a second time.
    installTelegram('auth_date=1&hash=abc');
    await mount(true);
    expect(ctx!.status).toBe('authenticated');
    holdLibraryWrites = true;
    await act(async () => { editHookCollections([{ ...collection, stationIds: ['a', 'desktop'], updatedAt: 2 }]); });
    // Old code only submits after 1.4s. Let that first add reach the server.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1_450)); });
    expect(vi.mocked(fetch).mock.calls.filter(([input]) => String(input).endsWith('/auth/telegram'))).toHaveLength(1);
    expect(releaseWrites).toHaveLength(1);
    await act(async () => { editHookCollections([collection]); });
    await act(async () => { releaseWrites[0](); });
    await tick();
    expect(hookCollections[0].stationIds).toEqual(['a']);
    await act(async () => { await vi.waitFor(() => expect(releaseWrites).toHaveLength(2), { timeout: 300 }); });
    await act(async () => { releaseWrites[1](); });
    await tick();
    expect(ctx!.library?.collections[0].stationIds).toEqual(['a']);
  });

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

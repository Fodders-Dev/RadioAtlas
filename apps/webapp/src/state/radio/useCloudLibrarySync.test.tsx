import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CloudLibrary, UserCollection } from '../../domain/contracts';
import { DEFAULT_TASTE_PROFILE_V2 } from '../../lib/tasteProfile';
import { useCloudLibrarySync } from './useCloudLibrarySync';
import type { TrackHistoryItem } from './types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type LocalLibrary = Omit<CloudLibrary, 'updatedAt'>;
type HarnessProps = {
  sessionStatus: string;
  sessionProfileId: string | null;
  cloudLibrary: CloudLibrary | null;
  replaceCloudLibrary: (library: LocalLibrary) => Promise<unknown> | void;
};

type HarnessControls = {
  collections: UserCollection[];
  setCollections: (next: UserCollection[] | ((previous: UserCollection[]) => UserCollection[])) => void;
};

const emptyLibrary = (): CloudLibrary => ({
  favorites: [],
  recent: [],
  trackHistory: [],
  collections: [],
  followedStations: [],
  followedRegions: [],
  alerts: [],
  tasteProfile: null,
  updatedAt: 1
});

const collection = (stationIds: string[], id = 'playlist'): UserCollection => ({
  id,
  name: 'My playlist',
  description: null,
  stationIds,
  isPublic: false,
  updatedAt: 1,
  createdAt: 1,
  pinned: false
});

let controls: HarnessControls | null = null;

const Harness = (props: HarnessProps) => {
  const [favorites, setFavorites] = useState<CloudLibrary['favorites']>([]);
  const [recent, setRecent] = useState<CloudLibrary['recent']>([]);
  const [trackHistory, setTrackHistory] = useState<TrackHistoryItem[]>([]);
  const [collections, setCollections] = useState<UserCollection[]>([]);
  const [followedStations, setFollowedStations] = useState<CloudLibrary['followedStations']>([]);
  const [followedRegions, setFollowedRegions] = useState<CloudLibrary['followedRegions']>([]);
  const [alerts, setAlerts] = useState<CloudLibrary['alerts']>([]);
  const [tasteProfile, setTasteProfile] = useState(DEFAULT_TASTE_PROFILE_V2);

  useCloudLibrarySync({
    ...props,
    favorites,
    recent,
    trackHistory,
    collections,
    followedStations,
    followedRegions,
    alerts,
    tasteProfile,
    setFavorites,
    setRecent,
    setTrackHistory,
    setCollections,
    setFollowedStations,
    setFollowedRegions,
    setAlerts,
    setTasteProfile
  });

  controls = { collections, setCollections };
  return null;
};

describe('useCloudLibrarySync remote collection updates', () => {
  let container: HTMLDivElement;
  let root: Root;
  let replaceCloudLibrary: ReturnType<typeof vi.fn>;
  let props: HarnessProps;
  let pendingAcknowledgements: Array<() => void>;

  const render = async (next: Partial<HarnessProps> = {}) => {
    props = { ...props, ...next };
    await act(async () => {
      root.render(createElement(Harness, props));
      await Promise.resolve();
    });
  };

  const advanceSyncDebounce = async () => {
    await act(async () => {
      vi.advanceTimersByTime(1_400);
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const acknowledgeReplace = async () => {
    const acknowledge = pendingAcknowledgements.shift();
    if (!acknowledge) throw new Error('no library PUT is waiting for acknowledgement');
    await act(async () => {
      acknowledge();
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    controls = null;
    pendingAcknowledgements = [];
    replaceCloudLibrary = vi.fn(
      () => new Promise<void>((resolve) => pendingAcknowledgements.push(resolve))
    );
    props = {
      sessionStatus: 'authenticated',
      sessionProfileId: 'account-1',
      cloudLibrary: emptyLibrary(),
      replaceCloudLibrary
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    controls = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('hydrates an initial cloud playlist without putting the stale empty state back', async () => {
    await render({ cloudLibrary: { ...emptyLibrary(), collections: [collection(['a'])] } });
    expect(controls?.collections).toEqual([collection(['a'])]);
    await advanceSyncDebounce();
    expect(replaceCloudLibrary).not.toHaveBeenCalled();
  });

  it('propagates same-account remote station additions without uploading the stale snapshot', async () => {
    const initial = { ...emptyLibrary(), collections: [collection(['a'])] };
    await render({ cloudLibrary: initial });
    const remoteUpdate = { ...initial, collections: [collection(['a', 'b', 'c'])], updatedAt: 2 };

    await render({ cloudLibrary: remoteUpdate });
    expect(controls?.collections).toEqual(remoteUpdate.collections);
    await advanceSyncDebounce();
    expect(replaceCloudLibrary).not.toHaveBeenCalled();
  });

  it('retains a remote playlist deletion and does not resurrect it from unchanged local state', async () => {
    const initial = { ...emptyLibrary(), collections: [collection(['a'])] };
    await render({ cloudLibrary: initial });

    await render({ cloudLibrary: { ...emptyLibrary(), updatedAt: 2 } });
    expect(controls?.collections).toEqual([]);
    await advanceSyncDebounce();
    expect(replaceCloudLibrary).not.toHaveBeenCalled();
  });

  it('captures local intent immediately and rebases it over a remote update', async () => {
    const initial = { ...emptyLibrary(), collections: [collection(['a'])] };
    await render({ cloudLibrary: initial });
    await act(async () => {
      controls?.setCollections([collection(['a', 'b'])]);
      root.render(createElement(Harness, props));
      await Promise.resolve();
    });

    const remoteUpdate = { ...initial, collections: [collection(['a', 'c'])], updatedAt: 2 };
    await render({ cloudLibrary: remoteUpdate });
    expect(controls?.collections).toEqual([collection(['a', 'b', 'c'])]);
    await advanceSyncDebounce();

    expect(replaceCloudLibrary).toHaveBeenCalledTimes(2);
    expect(replaceCloudLibrary.mock.calls[0]?.[0].collections).toEqual([collection(['a', 'b'])]);
    expect(replaceCloudLibrary.mock.calls[1]?.[0].collections).toEqual([collection(['a', 'b', 'c'])]);
    await acknowledgeReplace();
  });

  it('resets the accepted base when signing out and hydrating a different account', async () => {
    const accountOne = { ...emptyLibrary(), collections: [collection(['one'], 'account-one')] };
    await render({ cloudLibrary: accountOne });

    await act(async () => {
      controls?.setCollections([]);
      root.render(
        createElement(Harness, {
          ...props,
          sessionStatus: 'local',
          sessionProfileId: null,
          cloudLibrary: null
        })
      );
      props = { ...props, sessionStatus: 'local', sessionProfileId: null, cloudLibrary: null };
      await Promise.resolve();
    });

    const accountTwo = { ...emptyLibrary(), collections: [collection(['two'], 'account-two')] };
    await render({ sessionStatus: 'authenticated', sessionProfileId: 'account-2', cloudLibrary: accountTwo });
    expect(controls?.collections).toEqual(accountTwo.collections);
    await advanceSyncDebounce();
    expect(replaceCloudLibrary).not.toHaveBeenCalled();
  });
});

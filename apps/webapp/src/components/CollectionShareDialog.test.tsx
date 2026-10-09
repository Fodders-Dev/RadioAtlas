import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { UserCollection, CollectionShare } from '../domain/contracts';
import { hasRememberedCollectionShare } from '../lib/collectionShare';

const session = vi.hoisted(() => ({
  status: 'local' as 'local' | 'authenticated',
  profile: { id: 'account-a' },
  t: (key: string) => key,
  getCollectionShare: vi.fn(),
  publishCollectionShare: vi.fn(),
  revokeCollectionShare: vi.fn()
}));

vi.mock('../state/SessionContext', () => ({ useSession: () => session }));
vi.mock('../state/LocaleContext', () => ({ useLocale: () => ({ t: session.t }) }));

import { CollectionShareDialog } from './CollectionShareDialog';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const collection: UserCollection = {
  id: 'collection-1',
  name: 'Night drive',
  description: null,
  stationIds: ['one', 'two'],
  isPublic: false,
  updatedAt: 1,
  createdAt: 1,
  pinned: false
};
const share: CollectionShare = {
  token: 'opaque-token',
  collectionId: collection.id,
  name: collection.name,
  description: '',
  stationIds: collection.stationIds,
  updatedAt: 2
};

let container: HTMLDivElement;
let root: Root;
let originalClipboard: PropertyDescriptor | undefined;

const renderDialog = async (onLogin = vi.fn()) => {
  await act(async () => {
    root.render(createElement(CollectionShareDialog, {
      collection,
      open: true,
      onClose: vi.fn(),
      onLogin
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return onLogin;
};

const buttonByText = (text: string) =>
  Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent === text);

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

describe('collection sharing owner dialog', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    session.status = 'local';
    session.profile = { id: 'account-a' };
    session.getCollectionShare.mockReset().mockResolvedValue(null);
    session.publishCollectionShare.mockReset().mockResolvedValue(share);
    session.revokeCollectionShare.mockReset().mockResolvedValue(undefined);
    originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
    else Reflect.deleteProperty(navigator, 'clipboard');
    localStorage.clear();
  });

  it('offers the existing account sheet to guests without publishing', async () => {
    const onLogin = await renderDialog();
    expect(document.body.textContent).toContain('collectionShare.loginRequired');
    await act(async () => { buttonByText('collectionShare.login')?.click(); });
    expect(onLogin).toHaveBeenCalledTimes(1);
    expect(session.publishCollectionShare).not.toHaveBeenCalled();
  });

  it('loads without publishing, publishes only on request, then copies and revokes', async () => {
    session.status = 'authenticated';
    await renderDialog();
    expect(session.getCollectionShare).toHaveBeenCalledWith(collection.id);
    expect(session.publishCollectionShare).not.toHaveBeenCalled();

    await act(async () => { buttonByText('collectionShare.publish')?.click(); });
    expect(session.publishCollectionShare).toHaveBeenCalledWith(collection);
    const link = document.body.querySelector<HTMLInputElement>('#collection-share-link');
    expect(link?.value).toBe(`${window.location.origin}/?playlist=opaque-token`);

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await act(async () => { buttonByText('collectionShare.copy')?.click(); });
    expect(writeText).toHaveBeenCalledWith(link?.value);

    await act(async () => { buttonByText('collectionShare.revoke')?.click(); });
    expect(session.revokeCollectionShare).toHaveBeenCalledWith(collection.id);
    expect(document.body.querySelector('#collection-share-link')).toBeNull();
  });

  it('clears loading after retry success and retry failure', async () => {
    session.status = 'authenticated';
    session.getCollectionShare.mockRejectedValueOnce(new Error('offline'));
    await renderDialog();
    expect(document.body.textContent).toContain('collectionShare.loadError');
    expect(document.body.querySelector('[role="status"]')?.textContent).not.toBe('collectionShare.loading');

    session.getCollectionShare.mockResolvedValueOnce(share);
    await act(async () => { buttonByText('common.retry')?.click(); await Promise.resolve(); });
    expect(document.body.querySelector<HTMLInputElement>('#collection-share-link')?.value)
      .toBe(`${window.location.origin}/?playlist=opaque-token`);
    expect(document.body.querySelector('[role="status"]')?.textContent).not.toBe('collectionShare.loading');
  });

  it('clears loading after a retry failure', async () => {
    session.status = 'authenticated';
    session.getCollectionShare.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('still offline'));
    await renderDialog();
    await act(async () => { buttonByText('common.retry')?.click(); await Promise.resolve(); });
    expect(document.body.textContent).toContain('collectionShare.loadError');
    expect(buttonByText('common.retry')).toBeTruthy();
    expect(document.body.querySelector('[role="status"]')?.textContent).not.toBe('collectionShare.loading');
  });

  it('ignores an account A share lookup that resolves after switching to account B', async () => {
    session.status = 'authenticated';
    const oldLookup = deferred<CollectionShare | null>();
    session.getCollectionShare.mockReturnValueOnce(oldLookup.promise).mockResolvedValueOnce(null);
    await renderDialog();
    session.profile = { id: 'account-b' };
    await act(async () => {
      root.render(createElement(CollectionShareDialog, { collection, open: true, onClose: vi.fn(), onLogin: vi.fn() }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => { oldLookup.resolve(share); await Promise.resolve(); });
    expect(document.body.querySelector('#collection-share-link')).toBeNull();
  });

  it('clears account A link when account B lookup fails', async () => {
    session.status = 'authenticated';
    session.getCollectionShare.mockResolvedValueOnce(share);
    await renderDialog();
    expect(document.body.querySelector('#collection-share-link')).toBeTruthy();

    session.profile = { id: 'account-b' };
    session.getCollectionShare.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      root.render(createElement(CollectionShareDialog, { collection, open: true, onClose: vi.fn(), onLogin: vi.fn() }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.body.querySelector('#collection-share-link')).toBeNull();
    expect(document.body.textContent).toContain('collectionShare.loadError');
  });

  it('does not reveal a pending account A publish in account B after switching', async () => {
    session.status = 'authenticated';
    const pendingPublish = deferred<CollectionShare>();
    session.publishCollectionShare.mockReturnValueOnce(pendingPublish.promise);
    await renderDialog();
    await act(async () => { buttonByText('collectionShare.publish')?.click(); });

    session.profile = { id: 'account-b' };
    await act(async () => {
      root.render(createElement(CollectionShareDialog, { collection, open: true, onClose: vi.fn(), onLogin: vi.fn() }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(buttonByText('collectionShare.publish')?.hasAttribute('disabled')).toBe(false);
    await act(async () => { pendingPublish.resolve(share); await Promise.resolve(); });
    expect(document.body.querySelector('#collection-share-link')).toBeNull();
    expect(localStorage.getItem('radio:collection-share-active:collection-1:account-a')).toBeNull();
  });

  it('keeps account A marked active when B receives 404 and an old revoke completes', async () => {
    session.status = 'authenticated';
    const pendingRevoke = deferred<void>();
    session.getCollectionShare.mockResolvedValueOnce(share).mockResolvedValueOnce(null);
    session.revokeCollectionShare.mockReturnValueOnce(pendingRevoke.promise);
    await renderDialog();
    expect(hasRememberedCollectionShare(collection.id)).toBe(true);
    await act(async () => { buttonByText('collectionShare.revoke')?.click(); });

    session.profile = { id: 'account-b' };
    await act(async () => {
      root.render(createElement(CollectionShareDialog, { collection, open: true, onClose: vi.fn(), onLogin: vi.fn() }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => { pendingRevoke.resolve(); await Promise.resolve(); });

    expect(hasRememberedCollectionShare(collection.id)).toBe(true);
    expect(document.body.querySelector('#collection-share-link')).toBeNull();
  });
});

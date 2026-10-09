import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { StationLite } from '../types';

const ctx = vi.hoisted(() => ({
  catalog: { fetchStationById: vi.fn() },
  library: { copySharedCollection: vi.fn() },
  playback: { playStation: vi.fn(), playStationQueue: vi.fn() }
}));

vi.mock('../state/CatalogContext', () => ({ useCatalog: () => ctx.catalog }));
vi.mock('../state/RadioContext', () => ({
  useLibrary: () => ctx.library,
  usePlayback: () => ctx.playback
}));
vi.mock('../state/LocaleContext', () => ({
  useLocale: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      `${key}${values ? ` ${Object.entries(values).map(([name, value]) => `${name}=${value}`).join(' ')}` : ''}`
  })
}));
vi.mock('../components/StationArtwork', () => ({
  StationArtwork: ({ station }: { station: StationLite }) => createElement('span', null, station.stationuuid)
}));
vi.mock('./LibraryCollectionHome', () => ({
  CollectionSleeve: ({ collection }: { collection: { name: string } }) => createElement('span', null, collection.name)
}));

import { SharedPlaylistScreen } from './SharedPlaylistScreen';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const makeStation = (id: string): StationLite => ({
  stationuuid: id,
  name: id,
  url: `https://${id}.example/stream`,
  url_resolved: `https://${id}.example/stream`,
  homepage: '',
  favicon: '',
  country: 'Testland',
  state: '',
  tags: '',
  geo_lat: null,
  geo_long: null
});

let container: HTMLDivElement;
let root: Root;

const renderScreen = async (token = 'token-a') => {
  await act(async () => {
    root.render(createElement(SharedPlaylistScreen, { token, onClose: vi.fn() }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const flush = async () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

const buttonByText = (text: string) =>
  Array.from(container.querySelectorAll('button')).find((button) => button.textContent === text);

describe('shared playlist recipient view', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    ctx.catalog.fetchStationById.mockReset();
    ctx.library.copySharedCollection.mockReset().mockReturnValue(true);
    ctx.playback.playStation.mockReset();
    ctx.playback.playStationQueue.mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('shows ordered rows, reports unavailable stations, and changes playback only after a direct action', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ playlist: { name: 'Night drive', description: 'From Tokyo to Osaka', stationIds: ['one', 'missing', 'two'], updatedAt: 9 } })
    } as Response);
    ctx.catalog.fetchStationById.mockImplementation(async (id: string) => id === 'missing' ? null : makeStation(id));

    await renderScreen();

    expect(container.querySelector('.shared-playlist-copy h1')?.textContent).toBe('Night drive');
    expect(container.querySelector('.shared-playlist-count')?.textContent).toContain('available=2 total=3');
    expect(Array.from(container.querySelectorAll('.shared-playlist-station-name')).map((node) => node.textContent))
      .toEqual(['one', 'two']);
    expect(container.querySelectorAll('.shared-playlist-row.is-unavailable')).toHaveLength(1);
    expect(ctx.playback.playStationQueue).not.toHaveBeenCalled();

    await act(async () => { buttonByText('library.playCollection')?.click(); });
    expect(ctx.playback.playStationQueue.mock.calls[0]?.[0].map((station: StationLite) => station.stationuuid))
      .toEqual(['one', 'two']);

    const chosenRowButton = container.querySelector<HTMLButtonElement>('[aria-label="collectionShare.listenStation station=two"]');
    expect(chosenRowButton).not.toBeNull();
    await act(async () => { chosenRowButton?.click(); });
    expect(ctx.playback.playStation).toHaveBeenCalledWith(
      expect.objectContaining({ stationuuid: 'two' }),
      expect.objectContaining({ playlist: [expect.objectContaining({ stationuuid: 'one' }), expect.objectContaining({ stationuuid: 'two' })] })
    );
  });

  it('saves an atomic full-ID copy and ignores a rapid second tap', async () => {
    const stationIds = ['one', 'gone', 'two'];
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ playlist: { name: 'Night drive', description: null, stationIds, updatedAt: 9 } })
    } as Response);
    ctx.catalog.fetchStationById.mockImplementation(async (id: string) => id === 'gone' ? null : makeStation(id));
    await renderScreen();

    const save = buttonByText('collectionShare.saveCopy');
    expect(save).toBeDefined();
    await act(async () => { save?.click(); save?.click(); });

    expect(ctx.library.copySharedCollection).toHaveBeenCalledTimes(1);
    expect(ctx.library.copySharedCollection).toHaveBeenCalledWith({
      name: 'Night drive',
      description: null,
      stationIds,
      stations: [expect.objectContaining({ stationuuid: 'one' }), expect.objectContaining({ stationuuid: 'two' })]
    });
    expect(ctx.playback.playStationQueue).not.toHaveBeenCalled();
  });

  it('shows a revoked link as unavailable and retries a transient network failure', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 404 } as Response)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ playlist: { name: 'Again', description: null, stationIds: [], updatedAt: 9 } })
      } as Response);
    await renderScreen();
    expect(container.textContent).toContain('collectionShare.unavailable');
    expect(ctx.playback.playStationQueue).not.toHaveBeenCalled();

    await act(async () => { root.render(createElement(SharedPlaylistScreen, { token: 'token-b', onClose: vi.fn() })); });
    await flush();
    expect(container.textContent).toContain('collectionShare.networkError');
    await act(async () => { buttonByText('common.retry')?.click(); });
    await flush();
    expect(container.querySelector('.shared-playlist-copy h1')?.textContent).toBe('Again');
  });
});

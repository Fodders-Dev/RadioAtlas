import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StationPlaceCard, formatCoordinate } from './StationPlaceCard';
import type { StationLite } from '../types';

const station = (overrides: Partial<StationLite> = {}) =>
  ({
    stationuuid: 'uuid-x',
    name: 'Test FM',
    url: '',
    url_resolved: '',
    homepage: '',
    favicon: '',
    tags: '',
    country: 'Japan',
    countrycode: 'JP',
    state: 'Tokyo',
    language: '',
    codec: 'MP3',
    bitrate: 128,
    ...overrides
  }) as StationLite;

describe('formatCoordinate', () => {
  it('reads the way the reference does', () => {
    expect(formatCoordinate(35.6895, 139.6917)).toBe('35.6895° N · 139.6917° E');
  });

  it('names the southern and western hemispheres correctly', () => {
    expect(formatCoordinate(-33.8688, -151.2093)).toBe('33.8688° S · 151.2093° W');
  });
});

describe('StationPlaceCard', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const mount = async (node: Parameters<Root['render']>[0]) => {
    await act(async () => {
      root.render(node);
      await Promise.resolve();
    });
  };

  it('renders nothing at all without a country — the layout must close up', async () => {
    // 2.1% of the catalogue has no countrycode. The promise is that the band
    // disappears rather than showing an empty frame.
    await mount(createElement(StationPlaceCard, { station: station({ country: '' }), label: 'x' }));
    expect(container.querySelector('[data-station-place]')).toBeNull();
  });

  it('renders nothing while the geometry is still loading', async () => {
    // The topology is a dynamic import; the card must not reserve a blank box
    // in the stage before it lands.
    await mount(createElement(StationPlaceCard, { station: station(), label: 'x' }));
    expect(container.querySelector('[data-station-place]')).toBeNull();
  });

  it('renders nothing when there is no station', async () => {
    await mount(createElement(StationPlaceCard, { station: null, label: 'x' }));
    expect(container.querySelector('[data-station-place]')).toBeNull();
  });
});

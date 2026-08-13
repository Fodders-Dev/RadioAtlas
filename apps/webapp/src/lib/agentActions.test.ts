import { describe, expect, it, vi } from 'vitest';
import { executeAgentActions } from './agentActions';

const station = {
  stationuuid: 'station-1',
  name: 'Agent Radio',
  url_resolved: 'https://radio.example/stream'
};

describe('executeAgentActions', () => {
  it('executes only registered, grounded client writes and returns receipts', async () => {
    const play = vi.fn();
    const enqueue = vi.fn(() => true);
    const pause = vi.fn();
    const toggleFavorite = vi.fn();
    const receipts = await executeAgentActions(
      [
        { actionId: 'run:1', kind: 'play', stationuuid: station.stationuuid, permission: 'write' },
        { actionId: 'run:2', kind: 'enqueue', stationuuid: station.stationuuid, permission: 'write' },
        { actionId: 'run:3', kind: 'pause', permission: 'write' }
      ],
      {
        resolveStation: async () => station,
        play,
        enqueue,
        pause,
        isFavorite: () => false,
        toggleFavorite
      }
    );
    expect(play).toHaveBeenCalledWith(station);
    expect(enqueue).toHaveBeenCalledWith(station);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(receipts.map((item) => item.status)).toEqual(['executed', 'executed', 'executed']);
    expect(toggleFavorite).not.toHaveBeenCalled();
  });

  it('is idempotent for favorite and queue state', async () => {
    const toggleFavorite = vi.fn();
    const receipts = await executeAgentActions(
      [
        { actionId: 'run:1', kind: 'set-favorite', stationuuid: station.stationuuid, desired: true, permission: 'write' },
        { actionId: 'run:2', kind: 'enqueue', stationuuid: station.stationuuid, permission: 'write' }
      ],
      {
        resolveStation: async () => station,
        play: vi.fn(),
        enqueue: () => false,
        pause: vi.fn(),
        isFavorite: () => true,
        toggleFavorite
      }
    );
    expect(receipts.map((item) => item.status)).toEqual(['skipped', 'skipped']);
    expect(toggleFavorite).not.toHaveBeenCalled();
  });

  it('fails closed when write permission or station grounding is missing', async () => {
    const play = vi.fn();
    const receipts = await executeAgentActions(
      [
        { actionId: 'run:1', kind: 'play', stationuuid: station.stationuuid, permission: 'read' },
        { actionId: 'run:2', kind: 'play', stationuuid: 'missing', permission: 'write' }
      ],
      {
        resolveStation: async (id) => id === station.stationuuid ? station : null,
        play,
        enqueue: () => true,
        pause: vi.fn(),
        isFavorite: () => false,
        toggleFavorite: vi.fn()
      }
    );
    expect(receipts.map((item) => item.status)).toEqual(['failed', 'failed']);
    expect(play).not.toHaveBeenCalled();
  });
});

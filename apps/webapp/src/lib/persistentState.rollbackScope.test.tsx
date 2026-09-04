import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { usePersistentState } from './persistentState';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * The scope of `rollbackOnWriteError`, which the owner asked about before the
 * push and was right to.
 *
 * The rollback was added so a find the storage refused stops sitting in the
 * list looking saved. But the library is ONE object — favourites, recents,
 * collections, follows and finds all live under `radio:library:v2` — so a
 * rollback aimed at a find takes the whole key back with it. The question is
 * whether it can take back something that was already SAFE.
 *
 * It cannot, and the reason is worth stating rather than trusting: the rollback
 * does not undo a diff, it re-reads the key. Whatever storage actually holds is
 * what the app ends up showing, which is the definition of the promise being
 * kept — nothing confirmed is lost, and nothing unconfirmed is displayed as
 * though it were.
 *
 * The case that needed proving is two mutations inside one debounce window: the
 * hook coalesces them into a single write, so a failure loses both. That is
 * correct — neither ever reached the disk — but it means the visible loss is
 * wider than the toast's wording, which is recorded in PLAN.md rather than
 * papered over here.
 */

type Library = { favorites: string[]; finds: string[] };

const KEY = 'test:library';
const EMPTY: Library = { favorites: [], finds: [] };

let latest: {
  value: Library;
  setValue: (next: Library | ((prev: Library) => Library)) => void;
} | null = null;

const Harness = ({
  rollback,
  onWriteError,
  onWriteRecovered
}: {
  rollback: boolean;
  onWriteError?: (error: unknown) => void;
  onWriteRecovered?: () => void;
}) => {
  const [value, setValue] = usePersistentState<Library>(KEY, EMPTY, {
    writeDelayMs: 5,
    rollbackOnWriteError: rollback,
    onWriteError,
    onWriteRecovered
  });
  latest = { value, setValue };
  return null;
};

const stored = (): Library | null => {
  const raw = window.localStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as Library) : null;
};

describe('rollbackOnWriteError only gives back what was never written', () => {
  let container: HTMLDivElement;
  let root: Root;
  let realSetItem: typeof window.localStorage.setItem;
  let writes: number;
  let refuse: boolean;

  const flush = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
  };

  const mutate = async (next: (prev: Library) => Library) => {
    act(() => latest!.setValue(next));
  };

  beforeEach(() => {
    window.localStorage.clear();
    latest = null;
    writes = 0;
    refuse = false;
    realSetItem = window.localStorage.setItem.bind(window.localStorage);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string, value: string) => {
      if (key === KEY) {
        writes += 1;
        if (refuse) {
          // The real shape of this: Safari and mobile WebViews throw
          // QuotaExceededError once the origin's budget is gone.
          const error = new Error('QuotaExceededError');
          error.name = 'QuotaExceededError';
          throw error;
        }
      }
      realSetItem(key, value);
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const render = (options: Parameters<typeof Harness>[0]) =>
    act(() => root.render(createElement(Harness, options)));

  it('keeps a favourite that was already on disk when a later find fails to write', async () => {
    render({ rollback: true });

    await mutate((prev) => ({ ...prev, favorites: ['Tokyo FM'] }));
    await flush();
    expect(stored()?.favorites).toEqual(['Tokyo FM']);

    refuse = true;
    await mutate((prev) => ({ ...prev, finds: ['Artist - Title'] }));
    await flush();

    // ⚠ The defect this is guarding against: a rollback that reverted to some
    // remembered earlier snapshot rather than to the disk would take the
    // favourite with it, and «находка не врёт» would have been bought with
    // «избранное иногда откатывается».
    expect(latest!.value.favorites).toEqual(['Tokyo FM']);
    expect(latest!.value.finds).toEqual([]);
    expect(stored()?.favorites).toEqual(['Tokyo FM']);
  });

  it('drops BOTH of two mutations that shared one debounce window, and nothing older', async () => {
    render({ rollback: true });

    await mutate((prev) => ({ ...prev, favorites: ['Tokyo FM'] }));
    await flush();

    refuse = true;
    const writesBefore = writes;
    // Close enough together that the hook's timer is reset and only ONE write
    // is attempted, carrying both changes.
    await mutate((prev) => ({ ...prev, favorites: [...prev.favorites, 'Osaka Nights'] }));
    await mutate((prev) => ({ ...prev, finds: ['Artist - Title'] }));
    await flush();

    expect(writes - writesBefore, 'the two mutations coalesced into one write').toBe(1);
    // Both are gone, and that is right: neither reached the disk, so showing
    // either would be the same lie the rollback exists to stop. The confirmed
    // favourite from before the window is untouched.
    expect(latest!.value).toEqual({ favorites: ['Tokyo FM'], finds: [] });
    expect(stored()).toEqual({ favorites: ['Tokyo FM'], finds: [] });
  });

  it('does not retry the refused value, so a failure cannot spin', async () => {
    render({ rollback: true });
    refuse = true;

    await mutate((prev) => ({ ...prev, finds: ['Artist - Title'] }));
    await flush();
    const afterFailure = writes;

    // ⚠ The loop this closes: the rollback CHANGES state, and the write effect
    // is keyed on state. Without clearing the dirty flag the new value would
    // schedule another write, fail, roll back again — a quota error turning into
    // a permanent timer. Nothing has changed since, so nothing may be written.
    await flush();
    await flush();
    expect(writes).toBe(afterFailure);
  });

  it('accepts a later change and reports recovery once storage works again', async () => {
    const onWriteError = vi.fn();
    const onWriteRecovered = vi.fn();
    render({ rollback: true, onWriteError, onWriteRecovered });

    refuse = true;
    await mutate((prev) => ({ ...prev, finds: ['Artist - Title'] }));
    await flush();
    expect(onWriteError).toHaveBeenCalledTimes(1);

    refuse = false;
    await mutate((prev) => ({ ...prev, favorites: ['Tokyo FM'] }));
    await flush();

    // The rollback is not a dead end: the hook is usable afterwards, and the
    // recovery callback is what clears «не удалось сохранить» from the UI.
    expect(latest!.value.favorites).toEqual(['Tokyo FM']);
    expect(stored()?.favorites).toEqual(['Tokyo FM']);
    expect(onWriteRecovered).toHaveBeenCalledTimes(1);
  });

  it('leaves the three cache-shaped call sites exactly as they were', async () => {
    // Rollback is opt-in. `radio:app:v2`, `radio:player:v2` and the queue would
    // rather keep a value they could not write than lose it, and nothing
    // promised the person that those persisted.
    render({ rollback: false });
    refuse = true;

    await mutate((prev) => ({ ...prev, finds: ['Artist - Title'] }));
    await flush();

    expect(latest!.value.finds).toEqual(['Artist - Title']);
    expect(stored()).toBeNull();
  });
});

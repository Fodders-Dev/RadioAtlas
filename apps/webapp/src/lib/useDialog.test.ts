import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useDialog } from './useDialog';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const Harness = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  useDialog(rootRef, { isOpen, onClose });
  return createElement(
    'div',
    null,
    createElement('button', { id: 'trigger', key: 'trigger' }, 'trigger'),
    isOpen
      ? createElement(
          'div',
          { ref: rootRef, role: 'dialog', key: 'dialog' },
          createElement('button', { id: 'b1', key: 'b1' }, '1'),
          createElement('button', { id: 'b2', key: 'b2' }, '2'),
          createElement('button', { id: 'b3', key: 'b3' }, '3')
        )
      : null
  );
};

const byId = (id: string) => document.getElementById(id) as HTMLElement;
const pressKey = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    );
  });

describe('useDialog (T1.4)', () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = (isOpen: boolean, onClose: () => void) =>
    act(() => root.render(createElement(Harness, { isOpen, onClose })));

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('moves focus to the first focusable element on open', () => {
    render(true, () => {});
    expect(document.activeElement).toBe(byId('b1'));
  });

  it('traps Tab forward and wraps at the end', () => {
    render(true, () => {});
    pressKey('Tab');
    expect(document.activeElement).toBe(byId('b2'));
    pressKey('Tab');
    expect(document.activeElement).toBe(byId('b3'));
    pressKey('Tab');
    expect(document.activeElement).toBe(byId('b1'));
  });

  it('traps Shift+Tab backward and wraps at the start', () => {
    render(true, () => {});
    expect(document.activeElement).toBe(byId('b1'));
    pressKey('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(byId('b3'));
  });

  it('calls onClose on Escape', () => {
    const onClose = vi.fn();
    render(true, onClose);
    pressKey('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on Escape during IME composition', () => {
    const onClose = vi.fn();
    render(true, onClose);
    pressKey('Escape', { isComposing: true });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('makes background siblings inert while open and clears them on close', () => {
    render(false, () => {});
    expect(byId('trigger').hasAttribute('inert')).toBe(false);
    render(true, () => {});
    expect(byId('trigger').hasAttribute('inert')).toBe(true);
    render(false, () => {});
    expect(byId('trigger').hasAttribute('inert')).toBe(false);
  });

  it('restores focus to the trigger on close', () => {
    render(false, () => {});
    byId('trigger').focus();
    expect(document.activeElement).toBe(byId('trigger'));
    render(true, () => {}); // captures trigger, steals focus into the dialog
    expect(document.activeElement).toBe(byId('b1'));
    render(false, () => {}); // close -> restore
    expect(document.activeElement).toBe(byId('trigger'));
  });

  it('removes its keydown listener on unmount (no leak)', () => {
    const addSpy = vi.spyOn(HTMLDivElement.prototype, 'addEventListener');
    const removeSpy = vi.spyOn(HTMLDivElement.prototype, 'removeEventListener');
    render(true, () => {});
    act(() => root.unmount());
    // Re-create a root so afterEach's unmount is a no-op-safe.
    root = createRoot(container);
    const keydownAdds = addSpy.mock.calls.filter((call) => call[0] === 'keydown').length;
    const keydownRemoves = removeSpy.mock.calls.filter((call) => call[0] === 'keydown').length;
    expect(keydownAdds).toBeGreaterThan(0);
    expect(keydownRemoves).toBe(keydownAdds);
  });
});

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

  // REGRESSION (WCAG 2.1.2): a control inside a display:none ANCESTOR is not
  // rendered, but it still computes its OWN `display` normally. When isVisible()
  // only inspected the element's own style, such a control stayed in the cycle,
  // focus() on it silently no-opped so activeElement never moved, and the next
  // keypress recomputed to the same dead index — Tab wedged forever and every
  // control after it became unreachable. Hit live via the discovery feed's
  // collapsible filter-chip row.
  it('skips controls inside a collapsed (display:none) container instead of wedging Tab', () => {
    render(true, () => {});
    const dialog = byId('b1').parentElement as HTMLElement;
    const collapsed = document.createElement('div');
    collapsed.style.display = 'none';
    const buried = document.createElement('button');
    buried.id = 'buried';
    collapsed.appendChild(buried);
    // Inserted BETWEEN b1 and b2, so a wedge here would strand focus on b1.
    act(() => dialog.insertBefore(collapsed, byId('b2')));

    expect(document.activeElement).toBe(byId('b1'));
    pressKey('Tab');
    expect(document.activeElement).not.toBe(byId('buried'));
    expect(document.activeElement).toBe(byId('b2'));
    pressKey('Tab');
    expect(document.activeElement).toBe(byId('b3'));
  });

  // Same shape, but via the `hidden` attribute on the container — which a
  // stylesheet can and did override back to a visible `display`, so the
  // attribute is checked on ancestors in its own right.
  it('skips controls inside a [hidden] container', () => {
    render(true, () => {});
    const dialog = byId('b1').parentElement as HTMLElement;
    const collapsed = document.createElement('div');
    collapsed.hidden = true;
    const buried = document.createElement('button');
    buried.id = 'buried2';
    collapsed.appendChild(buried);
    act(() => dialog.insertBefore(collapsed, byId('b2')));

    pressKey('Tab');
    expect(document.activeElement).toBe(byId('b2'));
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

  // REGRESSION: Escape used to be dead as soon as focus left the dialog, and it
  // leaves more easily than it looks — a focused control that unmounts under the
  // user (the discovery feed's play orb belongs to the card you swipe away from)
  // drops activeElement to <body>, and the root-bound listener then never fired.
  // The documented dismissal mechanism was gone until the user blindly pressed
  // Tab to re-enter.
  it('closes on Escape even when focus has fallen out of the dialog', () => {
    const onClose = vi.fn();
    render(true, onClose);
    act(() => (document.activeElement as HTMLElement).blur());
    expect(document.activeElement).toBe(document.body);
    pressKey('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ...and Tab re-enters from there instead of leaking into the background.
  it('pulls Tab back into the dialog when focus has fallen to the body', () => {
    render(true, () => {});
    act(() => (document.activeElement as HTMLElement).blur());
    pressKey('Tab');
    expect(document.activeElement).toBe(byId('b1'));
  });

  // The listener is on the document now, so two open dialogs would both see the
  // same Escape (they share a node, so stopPropagation cannot separate them).
  // A dialog covered by another one is inert — that is the guard, and this pins
  // it: the covered dialog must not close when the one above it is dismissed.
  it('ignores keys while covered by a dialog above it (inert root)', () => {
    const onClose = vi.fn();
    render(true, onClose);
    const dialog = byId('b1').parentElement as HTMLElement;
    act(() => dialog.setAttribute('inert', ''));
    pressKey('Escape');
    expect(onClose).not.toHaveBeenCalled();
    act(() => dialog.removeAttribute('inert'));
    pressKey('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // The second guard: an event raised inside a DIFFERENT dialog belongs to that
  // dialog, never to this one.
  it('ignores keys raised inside another dialog', () => {
    const onClose = vi.fn();
    render(true, onClose);
    const other = document.createElement('div');
    other.setAttribute('role', 'dialog');
    const inner = document.createElement('button');
    other.appendChild(inner);
    document.body.appendChild(other);
    act(() => {
      inner.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
    });
    expect(onClose).not.toHaveBeenCalled();
    other.remove();
  });

  it('removes its keydown listener on unmount (no leak)', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
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

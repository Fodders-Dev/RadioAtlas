import { useEffect, useRef, type RefObject } from 'react';

type UseDialogOptions = {
  isOpen: boolean;
  onClose: () => void;
  // Optional override for where focus lands on close, resolved at close
  // time. Needed when the trigger unmounts while the dialog is open (e.g.
  // FullPlayerOverlay hides the dock that opened it, so the original
  // trigger element is gone and we point at its re-mounted equivalent).
  restoreFocusTo?: () => HTMLElement | null;
};

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

// A control belongs in the tab cycle only if NOTHING between it and the document
// root is display:none.
//
// Checking the element's OWN computed style is not enough, and the gap is a real
// keyboard trap (WCAG 2.1.2), hit live by the discovery feed's collapsible
// filter-chip row: an element inside a display:none ANCESTOR still computes its
// own `display` normally (a chip in a collapsed row reported `inline-flex`,
// while offsetParent was null and getClientRects() was empty). getFocusable
// therefore kept enumerating the chips, focus() on a non-rendered element
// silently no-ops so activeElement never moved, and nextIndex recomputed to the
// same dead chip on every keypress — Tab wedged and every control after it
// became unreachable.
//
// Browsers expose Element.checkVisibility() for exactly this, but jsdom
// implements neither it nor layout (getClientRects() is always empty there), so
// an ancestor walk over computed `display` is the one test that is correct in
// the browser AND unit-testable. Depth is small and this runs per Tab, not per
// frame.
const isVisible = (element: HTMLElement) => {
  const view = element.ownerDocument.defaultView;
  if (!view) return !element.hidden;
  let node: HTMLElement | null = element;
  while (node) {
    // Explicit, because a stylesheet can override the UA's `[hidden]{display:none}`
    // — which is precisely how the chip row started rendering while "hidden".
    if (node.hidden) return false;
    const style = view.getComputedStyle(node);
    if (style.display === 'none') return false;
    // `visibility` inherits, so the element's own computed value already
    // reflects any ancestor's `hidden` — testing it once is sufficient.
    if (node === element && style.visibility === 'hidden') return false;
    node = node.parentElement;
  }
  return true;
};

const getFocusable = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute('disabled') &&
      element.tabIndex !== -1 &&
      !element.closest('[data-dialog-backdrop]') &&
      isVisible(element)
  );

const focusElement = (element: HTMLElement | null | undefined) => {
  if (!element || !element.isConnected) return false;
  element.focus();
  return true;
};

// Accessible modal-dialog behaviour for the project's custom slide-up
// overlays. modern-web-guidance §11 prefers a native <dialog>, but
// explicitly blesses applying `inert` to outside content for "custom
// overlays ... where <dialog>'s top-layer/positioning behavior conflicts
// with the design" — which is exactly these themed, swipe-driven sheets
// (and <dialog closedby> isn't in Safari / the iOS Telegram WebView).
//
// On open: capture the trigger, focus `[data-dialog-initial-focus]` when
// provided, then the first focusable element that is not marked as a
// `[data-dialog-backdrop]` (or the dialog itself), make every sibling of the dialog root `inert` so the
// background is unreachable by pointer / keyboard / assistive tech, trap
// Tab within the dialog, and close on Escape. On close/unmount: undo the
// inerting, drop the listener, and restore focus to the trigger (falling
// back to <body> if it has left the DOM). (T1.4)
export const useDialog = (
  rootRef: RefObject<HTMLElement | null>,
  { isOpen, onClose, restoreFocusTo }: UseDialogOptions
) => {
  // Latest callbacks without re-running the open/close effect (which would
  // re-capture the trigger and re-steal focus on every parent render).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const restoreFocusToRef = useRef(restoreFocusTo);
  restoreFocusToRef.current = restoreFocusTo;

  useEffect(() => {
    const root = rootRef.current;
    if (!isOpen || !root) return;

    const doc = root.ownerDocument;
    const previouslyFocused = doc.activeElement as HTMLElement | null;

    // Background siblings become inert. Track only the ones we toggle so
    // we don't clear an `inert` a sibling already owned (e.g. a stacked
    // dialog below this one already inerted by its own useDialog).
    const inerted: HTMLElement[] = [];
    const parent = root.parentElement;
    if (parent) {
      Array.from(parent.children).forEach((child) => {
        if (child === root) return;
        if (!(child instanceof HTMLElement)) return;
        if (child.hasAttribute('inert')) return;
        child.setAttribute('inert', '');
        inerted.push(child);
      });
    }

    // Backdrop buttons remain available to pointer users, but are deliberately
    // excluded from both initial focus and the dialog's keyboard cycle. A
    // visible close button or another preferred control can opt in explicitly.
    const initialFocusable = getFocusable(root);
    const preferredInitialFocus = root.querySelector<HTMLElement>(
      '[data-dialog-initial-focus]'
    );
    const preferredIsUsable =
      preferredInitialFocus &&
      !preferredInitialFocus.hasAttribute('disabled') &&
      !preferredInitialFocus.closest('[data-dialog-backdrop]') &&
      isVisible(preferredInitialFocus);
    const initialTarget = preferredIsUsable ? preferredInitialFocus : initialFocusable[0];
    if (initialTarget) {
      initialTarget.focus();
      // A misplaced marker on a non-focusable node should not strand focus in
      // the background; fall back to the first known focusable control.
      if (doc.activeElement !== initialTarget) initialFocusable[0]?.focus();
    } else {
      if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
      root.focus();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      // ⚠ BOUND TO THE DOCUMENT, NOT TO `root` — deliberately (see the
      // addEventListener call below). A root-bound listener only fires while
      // focus is INSIDE the dialog, and focus leaves it more easily than it
      // looks: any focused control that unmounts under the user drops
      // activeElement to <body>, and from there Escape was simply dead until
      // they blindly pressed Tab to re-enter. Measured on the discovery feed:
      // Tab to the play orb, ArrowDown (the orb belongs to the card you just
      // left, so it unmounts), Escape — the overlay stayed open. Clicking any
      // non-focusable part of a dialog does the same thing.
      //
      // The two guards below are what keep document-binding safe for STACKED
      // dialogs, which this app really has (the theme-builder sub-sheet over
      // the settings sheet, the details sheet over the full player). Both
      // listeners sit on the same node, so `stopPropagation` cannot separate
      // them — only these can:
      //   1. a dialog whose root is inert is covered by a dialog above it (the
      //      one on top inerts its siblings on open) and must stay silent;
      //   2. an event that happened inside ANOTHER dialog belongs to that
      //      dialog. Every useDialog root in this codebase carries
      //      role="dialog", so `closest` identifies the owner exactly, and a
      //      nested dialog inside this root wins over this one — which is the
      //      correct precedence.
      // With focus on <body> neither guard matches for the topmost dialog, so
      // exactly one dialog acts.
      if (root.closest('[inert]')) return;
      const eventTarget = event.target;
      if (eventTarget instanceof Element) {
        const owner = eventTarget.closest('[role="dialog"]');
        if (owner && owner !== root) return;
      }

      if (event.key === 'Escape') {
        // IME composition uses Escape to cancel a candidate; don't treat
        // that as a dialog dismiss.
        if (event.isComposing) return;
        event.stopPropagation();
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = getFocusable(root);
      if (focusable.length === 0) {
        // Nothing to cycle through — keep focus pinned to the dialog.
        event.preventDefault();
        root.focus();
        return;
      }
      event.preventDefault();
      const active = doc.activeElement as HTMLElement | null;
      const currentIndex = active ? focusable.indexOf(active) : -1;
      const lastIndex = focusable.length - 1;
      let nextIndex: number;
      if (event.shiftKey) {
        nextIndex = currentIndex <= 0 ? lastIndex : currentIndex - 1;
      } else {
        nextIndex = currentIndex === -1 || currentIndex >= lastIndex ? 0 : currentIndex + 1;
      }
      focusable[nextIndex]?.focus();
    };

    // The Tab-cycle computation inside stays scoped to `root` — only the
    // LISTENING surface widens, so the trap's semantics are unchanged.
    doc.addEventListener('keydown', handleKeyDown);

    return () => {
      doc.removeEventListener('keydown', handleKeyDown);
      inerted.forEach((element) => element.removeAttribute('inert'));
      // Restore focus: an explicit target (resolved now, after the
      // background has re-rendered), else the captured trigger, else the
      // body as a last resort (WAI-ARIA APG).
      const explicitTarget = restoreFocusToRef.current?.() ?? null;
      const restored = focusElement(explicitTarget) || focusElement(previouslyFocused);
      if (!restored) {
        doc.body?.focus();
      }
      if (!explicitTarget && restoreFocusToRef.current) {
        window.setTimeout(() => {
          focusElement(restoreFocusToRef.current?.() ?? null);
        }, 0);
      }
    };
  }, [isOpen, rootRef]);
};

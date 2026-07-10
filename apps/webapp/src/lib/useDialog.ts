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

const isVisible = (element: HTMLElement) => {
  if (element.hidden) return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!style) return true;
  return style.display !== 'none' && style.visibility !== 'hidden';
};

const getFocusable = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute('disabled') && element.tabIndex !== -1 && isVisible(element)
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
// On open: capture the trigger, focus the first focusable element (or the
// dialog itself), make every sibling of the dialog root `inert` so the
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

    // Initial focus: first focusable, else the dialog root itself.
    const initialFocusable = getFocusable(root);
    if (initialFocusable.length > 0) {
      initialFocusable[0]?.focus();
    } else {
      if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
      root.focus();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
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

    root.addEventListener('keydown', handleKeyDown);

    return () => {
      root.removeEventListener('keydown', handleKeyDown);
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

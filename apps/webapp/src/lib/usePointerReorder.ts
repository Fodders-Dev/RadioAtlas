import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

// Library-free drag-to-reorder for a vertical list, built on Pointer Events so it
// works with mouse AND touch (Telegram WebView included). The drag lives on a
// dedicated HANDLE element: setPointerCapture routes every move/up to that handle
// (no window listeners, no lost pointers), and `touch-action: none` on the handle
// stops the initial touch from scrolling the page. The target index is measured
// from the live row rects, so it tolerates variable row heights.

export type PointerReorderHandleProps = {
  onPointerDown: (event: ReactPointerEvent) => void;
  onPointerMove: (event: ReactPointerEvent) => void;
  onPointerUp: (event: ReactPointerEvent) => void;
  onPointerCancel: (event: ReactPointerEvent) => void;
  style: { touchAction: 'none' };
};

export type UsePointerReorderResult = {
  containerRef: RefObject<HTMLDivElement>;
  draggingIndex: number | null;
  overIndex: number | null;
  getHandleProps: (index: number) => PointerReorderHandleProps;
};

export const usePointerReorder = (
  onReorder: (from: number, to: number) => void,
  options: { itemSelector: string; isLocked?: (index: number) => boolean } = { itemSelector: '[data-reorder-item]' }
): UsePointerReorderResult => {
  const { itemSelector, isLocked } = options;
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const draggingRef = useRef<number | null>(null);
  const overRef = useRef<number | null>(null);

  const indexAtPointer = useCallback(
    (clientY: number): number | null => {
      const container = containerRef.current;
      if (!container) return null;
      const rows = Array.from(container.querySelectorAll<HTMLElement>(itemSelector));
      if (!rows.length) return null;
      for (let index = 0; index < rows.length; index += 1) {
        const rect = rows[index].getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) {
          return isLocked?.(index) ? index + 1 : index;
        }
      }
      return rows.length - 1;
    },
    [itemSelector, isLocked]
  );

  const reset = useCallback(() => {
    draggingRef.current = null;
    overRef.current = null;
    setDraggingIndex(null);
    setOverIndex(null);
  }, []);

  const getHandleProps = useCallback(
    (index: number): PointerReorderHandleProps => ({
      style: { touchAction: 'none' },
      onPointerDown: (event) => {
        if (isLocked?.(index)) return;
        event.preventDefault();
        try {
          (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        } catch {
          // Some engines can refuse capture — the handler still works, just less robustly.
        }
        draggingRef.current = index;
        overRef.current = index;
        setDraggingIndex(index);
        setOverIndex(index);
      },
      onPointerMove: (event) => {
        if (draggingRef.current === null) return;
        const target = indexAtPointer(event.clientY);
        if (target === null || target === overRef.current) return;
        overRef.current = target;
        setOverIndex(target);
      },
      onPointerUp: () => {
        const from = draggingRef.current;
        const to = overRef.current;
        reset();
        if (from !== null && to !== null && from !== to) onReorder(from, to);
      },
      onPointerCancel: () => reset()
    }),
    [indexAtPointer, isLocked, onReorder, reset]
  );

  return { containerRef, draggingIndex, overIndex, getHandleProps };
};

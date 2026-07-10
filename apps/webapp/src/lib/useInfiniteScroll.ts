import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

type InfiniteScrollOptions = {
  enabled: boolean;
  rootMargin?: string;
  onLoadMore: () => void;
};

// Arm-guard'ed IntersectionObserver wrapper. Two failure modes the
// naive observe-then-callback shape produced post-T1.2:
//
//   1) Cascade fire. When `onLoadMore` only bumps a `visibleCount`
//      state, the sentinel often stays inside `rootMargin` (e.g. 620px
//      in StationTable) right after the freshly rendered batch lands.
//      The observer fires again on the next entry tick, bumps again,
//      cascades. Visible as a multi-frame layout reflow burst.
//
//   2) Concurrent observers from StrictMode + dep churn. React 18 +
//      StrictMode in `vite dev` double-invokes mount effects, and the
//      `onLoadMore` reference can flip on loading-state toggles in some
//      callers, both of which cause the effect to mount fresh observers
//      while older ones still have entries queued in the browser's IO
//      task source. Without a SHARED arm-guard the queued entries all
//      fire and each calls onLoadMore once.
//
// Fix: a single `armedRef` whose lifetime spans every observer instance
// the hook ever creates (useRef survives effect re-runs).
//   - It starts armed.
//   - The FIRST intersection entry (any observer) disarms it and calls
//     onLoadMore exactly once.
//   - It re-arms ONLY when an entry shows `isIntersecting === false` -
//     i.e. the user has genuinely scrolled the sentinel out of view +
//     rootMargin. That is the only true signal that the next load-more
//     should be allowed; mount-time effect churn alone can never re-arm.
//
// Notably we do NOT reset armedRef inside the effect body. That was the
// trap in the previous iteration: every mount put armed back to true,
// so each StrictMode-spawned observer saw a fresh `true` snapshot and
// fired anyway. The whole point of the guard is to be observer-instance
// independent.

export const useInfiniteScroll = (
  targetRef: RefObject<HTMLElement>,
  { enabled, rootMargin = '200px', onLoadMore }: InfiniteScrollOptions
) => {
  const armedRef = useRef(true);

  useEffect(() => {
    if (!enabled) {
      armedRef.current = true;
      return;
    }
    const target = targetRef.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (armedRef.current) {
              armedRef.current = false;
              onLoadMore();
            }
          } else {
            armedRef.current = true;
          }
        }
      },
      { rootMargin }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [enabled, onLoadMore, rootMargin, targetRef]);
};

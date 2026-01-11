import { useEffect } from 'react';
import type { RefObject } from 'react';

type InfiniteScrollOptions = {
  enabled: boolean;
  rootMargin?: string;
  onLoadMore: () => void;
};

export const useInfiniteScroll = (
  targetRef: RefObject<HTMLElement>,
  { enabled, rootMargin = '200px', onLoadMore }: InfiniteScrollOptions
) => {
  useEffect(() => {
    if (!enabled) return;
    const target = targetRef.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadMore();
        }
      },
      { rootMargin }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [enabled, onLoadMore, rootMargin, targetRef]);
};

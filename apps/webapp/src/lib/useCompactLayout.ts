import { useEffect, useState } from 'react';

const COMPACT_QUERY = '(max-width: 600px)';

const getInitialValue = () => {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(COMPACT_QUERY).matches;
};

export const useCompactLayout = () => {
  const [isCompact, setIsCompact] = useState(getInitialValue);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia(COMPACT_QUERY);
    const update = (event: MediaQueryListEvent) => setIsCompact(event.matches);
    setIsCompact(mediaQuery.matches);

    mediaQuery.addEventListener('change', update);
    return () => mediaQuery.removeEventListener('change', update);
  }, []);

  return isCompact;
};

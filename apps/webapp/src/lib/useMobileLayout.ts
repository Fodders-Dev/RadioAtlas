import { useEffect, useState } from 'react';

// The app-wide mobile breakpoint, locked at 720px by the redesign batch
// (PR-6 player, Globe, and the upcoming screens all branch here). It matches
// the CSS @media (max-width: 720px) blocks exactly so the JS branch and the
// stylesheet can never disagree. NOTE: useCompactLayout (600px) predates the
// lock and still drives the Home dense-layout — left untouched on purpose;
// new screen rebuilds should use this hook.
const MOBILE_LAYOUT_QUERY = '(max-width: 720px)';

export const useMobileLayout = () => {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(MOBILE_LAYOUT_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia(MOBILE_LAYOUT_QUERY);
    const update = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    setIsMobile(mediaQuery.matches);
    mediaQuery.addEventListener('change', update);
    return () => mediaQuery.removeEventListener('change', update);
  }, []);

  return isMobile;
};

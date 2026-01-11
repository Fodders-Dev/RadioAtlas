import { useEffect, useState } from 'react';

export const useDebounce = <T,>(value: T, delayMs: number) => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
};

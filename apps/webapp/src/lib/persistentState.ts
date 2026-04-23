import { useEffect, useRef, useState } from 'react';

type SetStateAction<T> = T | ((prev: T) => T);

const resolveNextValue = <T,>(previous: T, next: SetStateAction<T>) =>
  typeof next === 'function' ? (next as (prev: T) => T)(previous) : next;

export const usePersistentState = <T,>(
  key: string,
  initialValue: T,
  {
    writeDelayMs = 120,
    clearLegacyKeys = []
  }: {
    writeDelayMs?: number;
    clearLegacyKeys?: string[];
  } = {}
) => {
  const [value, setValueState] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored) {
        return JSON.parse(stored) as T;
      }
    } catch {
      // Ignore invalid persisted state and fall back to defaults.
    }
    return initialValue;
  });
  const writeTimerRef = useRef<number | null>(null);
  const clearedLegacyRef = useRef(false);

  useEffect(() => {
    if (clearedLegacyRef.current) return;
    clearedLegacyRef.current = true;
    clearLegacyKeys.forEach((legacyKey) => {
      try {
        window.localStorage.removeItem(legacyKey);
      } catch {
        // Ignore storage cleanup failures.
      }
    });
  }, [clearLegacyKeys]);

  useEffect(() => {
    if (writeTimerRef.current !== null) {
      window.clearTimeout(writeTimerRef.current);
    }
    writeTimerRef.current = window.setTimeout(() => {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // Ignore write failures.
      }
    }, writeDelayMs);

    return () => {
      if (writeTimerRef.current !== null) {
        window.clearTimeout(writeTimerRef.current);
        writeTimerRef.current = null;
      }
    };
  }, [key, value, writeDelayMs]);

  const setValue = (next: SetStateAction<T>) => {
    setValueState((previous) => resolveNextValue(previous, next));
  };

  const clearValue = () => {
    setValueState(initialValue);
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore cleanup failures.
    }
  };

  return [value, setValue, clearValue] as const;
};

import { useEffect, useRef, useState } from 'react';

type SetStateAction<T> = T | ((prev: T) => T);

const resolveNextValue = <T,>(previous: T, next: SetStateAction<T>) =>
  typeof next === 'function' ? (next as (prev: T) => T)(previous) : next;

export const usePersistentState = <T,>(
  key: string,
  initialValue: T,
  {
    writeDelayMs = 120,
    clearLegacyKeys = [],
    writeOnMount = false,
    onWriteError,
    onWriteRecovered,
    rollbackOnWriteError = false
  }: {
    writeDelayMs?: number;
    clearLegacyKeys?: string[];
    writeOnMount?: boolean;
    /**
     * Told when a write to storage throws — a full quota, a private window, a
     * WebView that refuses. Optional on purpose: omit it and the behaviour is
     * byte-for-byte what it was, which is what the three cache-shaped call
     * sites want. The library passes one because a find that fails to persist
     * must not be reported to its owner as saved.
     */
    onWriteError?: (error: unknown) => void;
    /** Told when a later write succeeds after one failed. */
    onWriteRecovered?: () => void;
    /**
     * Put the state BACK to whatever storage actually holds when a write fails.
     *
     * ⚠ Without this the app tells two stories at once. React state took the
     * change instantly, the write is debounced and fails afterwards, so the
     * listener sees «Не удалось сохранить находку» AND the find sitting in
     * «Находки» looking saved — until a reload takes it. Measured in a browser
     * with a thrown QuotaExceededError: the toast was honest and the list was
     * not.
     *
     * Off by default: the three cache-shaped call sites would rather keep a
     * value they could not write than lose it, and nothing promises the person
     * that those persisted.
     */
    rollbackOnWriteError?: boolean;
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
  const dirtyRef = useRef(writeOnMount);
  const writeFailedRef = useRef(false);

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
    if (!dirtyRef.current) {
      return;
    }
    if (writeTimerRef.current !== null) {
      window.clearTimeout(writeTimerRef.current);
    }
    writeTimerRef.current = window.setTimeout(() => {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
        const recovered = writeFailedRef.current;
        writeFailedRef.current = false;
        dirtyRef.current = false;
        if (recovered) onWriteRecovered?.();
      } catch (error) {
        // ⚠ Still swallowed for every caller that does not ask, because three of
        // the four call sites are caches where a failed write costs nothing and
        // a toast would be noise. But a caller CAN ask, and the library does:
        // a find is something a person pressed «Сохранить находку» for, and a
        // write that fails without a word means the app showed them a saved
        // find that will not survive the next reload.
        // `dirtyRef` stays true, so the next change retries — hence the
        // recovery callback above rather than a one-way error.
        writeFailedRef.current = true;
        if (rollbackOnWriteError) {
          // Give up on this value rather than retry it: `dirtyRef` goes false so
          // the effect below does not loop on the state change we are about to
          // make, and the state is pulled back to what storage really has. The
          // UI then says exactly as much as the disk does.
          dirtyRef.current = false;
          try {
            const persisted = window.localStorage.getItem(key);
            setValueState(persisted ? (JSON.parse(persisted) as T) : initialValue);
          } catch {
            setValueState(initialValue);
          }
        }
        onWriteError?.(error);
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
    setValueState((previous) => {
      const resolved = resolveNextValue(previous, next);
      if (!Object.is(previous, resolved)) {
        dirtyRef.current = true;
      }
      return resolved;
    });
  };

  const clearValue = () => {
    dirtyRef.current = false;
    setValueState(initialValue);
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore cleanup failures.
    }
  };

  return [value, setValue, clearValue] as const;
};

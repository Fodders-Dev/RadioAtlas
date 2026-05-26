import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocalStorage } from '../lib/useLocalStorage';
import {
  defaultDictionary,
  loadDictionary,
  type DictionaryTree,
  type DictionaryValue,
  type Locale
} from './localeDictionary';

const LocaleContext = createContext<{
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
} | null>(null);

const resolveValue = (locale: Locale, key: string): string => {
  const path = key.split('.');
  let current: DictionaryValue | undefined = defaultDictionary;

  if (locale !== 'ru') {
    return key;
  }

  for (const segment of path) {
    if (!current || typeof current === 'string') {
      return key;
    }
    current = current[segment];
  }

  return typeof current === 'string' ? current : key;
};

const sanitizeLocale = (value: Locale | string): Locale => (value === 'en' ? 'en' : 'ru');

const scheduleDeferredTask = (task: () => void, delayMs = 2400) => {
  if (typeof window === 'undefined') {
    task();
    return () => {};
  }
  const idleCallback = (
    window as typeof window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    }
  ).requestIdleCallback;
  const cancelIdleCallback = (
    window as typeof window & {
      cancelIdleCallback?: (handle: number) => void;
    }
  ).cancelIdleCallback;
  if (idleCallback) {
    const handle = idleCallback(task, { timeout: delayMs });
    return () => cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(task, delayMs);
  return () => window.clearTimeout(handle);
};

export const LocaleProvider = ({ children }: { children: ReactNode }) => {
  const [locale, setLocaleState] = useLocalStorage<Locale>('radio:locale', 'ru');
  const safeLocale = sanitizeLocale(locale);
  const [dictionary, setDictionary] = useState<DictionaryTree>(defaultDictionary);

  useEffect(() => {
    let cancelled = false;
    const cancelScheduledLoad = scheduleDeferredTask(() => {
      void loadDictionary(safeLocale).then((nextDictionary) => {
        if (!cancelled) {
          setDictionary(nextDictionary);
        }
      }).catch(() => {
        if (!cancelled) {
          setDictionary(defaultDictionary);
        }
      });
    });
    return () => {
      cancelled = true;
      cancelScheduledLoad();
    };
  }, [safeLocale]);

  // Keep the document language in sync so assistive tech pronounces
  // content with the right phonemes (index.html ships the default). (T1.8)
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = safeLocale;
    }
  }, [safeLocale]);

  const value = useMemo(
    () => ({
      locale: safeLocale,
      setLocale: (nextLocale: Locale) => setLocaleState(sanitizeLocale(nextLocale)),
      t: (key: string, vars?: Record<string, string | number>) => {
        const path = key.split('.');
        let current: DictionaryValue | undefined = dictionary;
        for (const segment of path) {
          if (!current || typeof current === 'string') {
            current = undefined;
            break;
          }
          current = current[segment];
        }
        const template =
          typeof current === 'string' ? current : resolveValue(safeLocale, key);
        if (!vars) return template;
        return template.replace(/\{(\w+)\}/g, (_, token) => String(vars[token] ?? `{${token}}`));
      }
    }),
    [dictionary, safeLocale, setLocaleState]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
};

export const useLocale = () => {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error('useLocale must be used inside LocaleProvider');
  }
  return context;
};

export type { Locale };

const STORAGE_KEY = 'radio:api-url';

const normalizeBase = (value?: string | null) => {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
};

export const getApiBase = () => {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const paramValue = params.get('api');
    const normalizedParam = normalizeBase(paramValue);
    if (normalizedParam) {
      try {
        localStorage.setItem(STORAGE_KEY, normalizedParam);
      } catch {
        // ignore storage errors
      }
      return normalizedParam;
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const normalizedStored = normalizeBase(stored);
      if (normalizedStored) return normalizedStored;
    } catch {
      // ignore storage errors
    }
  }

  return normalizeBase(import.meta.env.VITE_API_URL as string | undefined);
};

export const setApiBase = (value: string) => {
  const normalized = normalizeBase(value);
  if (!normalized) return false;
  try {
    localStorage.setItem(STORAGE_KEY, normalized);
  } catch {
    // ignore storage errors
  }
  return true;
};

export const clearApiBase = () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
};

export const API_STORAGE_KEY = STORAGE_KEY;

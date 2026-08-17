const STORAGE_KEY = 'radio:api-url';
// Canonical prod hosts. radioatlas.ru is the primary domain (BotFather Mini App
// URL); radioatlas.duckdns.org is kept as a dual-served fallback. Either one being
// the page host means a stale legacy (vercel) api base should be discarded.
const CANONICAL_PROD_HOSTS = new Set(['radioatlas.ru', 'www.radioatlas.ru', 'radioatlas.duckdns.org']);
const LEGACY_API_HOSTS = new Set(['radio-atlas-miniapp.vercel.app']);
const getEnvApiUrl = () =>
  normalizeBase(
    ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_API_URL || '')
  );

const normalizeBase = (value?: string | null) => {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';

  if (trimmed.startsWith('/')) {
    return trimmed.replace(/\/+$/, '');
  }

  try {
    const url = new URL(trimmed);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
};

const isSecureApiCandidate = () => {
  if (typeof window === 'undefined') return false;
  return window.location.protocol === 'https:';
};

const getCandidateHost = (value: string) => {
  if (!value || value.startsWith('/')) return '';
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
};

const shouldDiscardLegacyBase = (value: string) => {
  if (typeof window === 'undefined') return false;
  if (!CANONICAL_PROD_HOSTS.has(window.location.hostname.toLowerCase())) return false;
  return LEGACY_API_HOSTS.has(getCandidateHost(value));
};

// The dev server proxies /api to the API (see vite.config.ts), so on a local
// origin that prefix is as real as it is behind Caddy in production. Without
// this, `npm run dev:webapp` + `npm run dev:api` — the pair the README tells you
// to run — produced an app with NO catalogue and no error to explain it:
// requests went to `http://localhost:5173/catalog/points`, Vite answered with
// the SPA fallback, and the globe sat there with zero stations. The only way in
// was `?api=/api`, which is what the Playwright specs pass and nothing else
// documented.
const LOCAL_API_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const isLocalDevHost = () => {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.toLowerCase();
  return LOCAL_API_HOSTS.has(host) || host.endsWith('.localhost');
};

const getDefaultApiBase = () => {
  if (isSecureApiCandidate() || isLocalDevHost()) return '/api';
  return '';
};

export const getApiBase = () => {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const paramValue = params.get('api');
    const normalizedParam = normalizeBase(paramValue);
    if (normalizedParam) {
      if (shouldDiscardLegacyBase(normalizedParam)) {
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          // ignore storage errors
        }
        return getDefaultApiBase();
      }
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
      if (normalizedStored) {
        if (shouldDiscardLegacyBase(normalizedStored)) {
          localStorage.removeItem(STORAGE_KEY);
        } else {
          return normalizedStored;
        }
      }
    } catch {
      // ignore storage errors
    }
  }

  const envBase = getEnvApiUrl();
  if (envBase && shouldDiscardLegacyBase(envBase)) {
    return getDefaultApiBase();
  }
  if (envBase) return envBase;
  return getDefaultApiBase();
};

export const hasExplicitApiBase = () => {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const paramValue = params.get('api');
    const normalizedParam = normalizeBase(paramValue);
    if (normalizedParam && !shouldDiscardLegacyBase(normalizedParam)) return true;

    try {
      const stored = normalizeBase(localStorage.getItem(STORAGE_KEY));
      if (stored && !shouldDiscardLegacyBase(stored)) {
        return true;
      }
    } catch {
      // ignore storage errors
    }
  }

  const envBase = getEnvApiUrl();
  return Boolean(envBase) && !shouldDiscardLegacyBase(envBase);
};

export const setApiBase = (value: string) => {
  const normalized = normalizeBase(value);
  if (!normalized || shouldDiscardLegacyBase(normalized)) return false;
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

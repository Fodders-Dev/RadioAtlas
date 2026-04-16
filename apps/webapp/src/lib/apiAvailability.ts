const OK_TTL_MS = 20_000;
const FAIL_TTL_MS = 6_000;

type ApiState = {
  ok: boolean;
  ts: number;
  inFlight: Promise<boolean> | null;
};

const stateByBase = new Map<string, ApiState>();

const normalizeBase = (value?: string | null) => {
  if (!value) return '';
  return value.replace(/\/+$/, '');
};

const isOptimisticBase = (base: string) => {
  const normalized = normalizeBase(base);
  if (!normalized) return false;
  if (normalized.startsWith('/')) return true;
  if (typeof window === 'undefined') return false;
  try {
    return new URL(normalized, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
};

const buildHealthUrl = (base: string) => `${normalizeBase(base)}/health`;

const withTimeout = async (url: string, timeoutMs: number) => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal
    });
  } finally {
    window.clearTimeout(timeout);
  }
};

const isHealthyApiResponse = async (response: Response) => {
  if (!response.ok) return false;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return false;
  }

  try {
    const payload = (await response.json()) as { ok?: unknown };
    return payload?.ok === true;
  } catch {
    return false;
  }
};

const isFresh = (state: ApiState) => {
  const ttl = state.ok ? OK_TTL_MS : FAIL_TTL_MS;
  return Date.now() - state.ts < ttl;
};

const getState = (base: string) => {
  const key = normalizeBase(base);
  const existing = stateByBase.get(key);
  if (existing) return existing;
  const created: ApiState = {
    ok: false,
    ts: 0,
    inFlight: null
  };
  stateByBase.set(key, created);
  return created;
};

export const checkApiAvailability = async (
  base: string,
  {
    force = false,
    timeoutMs = 1_000
  }: {
    force?: boolean;
    timeoutMs?: number;
  } = {}
) => {
  const normalized = normalizeBase(base);
  if (!normalized) return false;
  if (isOptimisticBase(normalized)) {
    const state = getState(normalized);
    state.ok = true;
    state.ts = Date.now();
    return true;
  }

  const state = getState(normalized);
  if (!force && isFresh(state)) {
    return state.ok;
  }
  if (state.inFlight) {
    return state.inFlight;
  }

  state.inFlight = (async () => {
    try {
      const response = await withTimeout(buildHealthUrl(normalized), timeoutMs);
      state.ok = await isHealthyApiResponse(response);
      state.ts = Date.now();
      return state.ok;
    } catch {
      state.ok = false;
      state.ts = Date.now();
      return false;
    } finally {
      state.inFlight = null;
    }
  })();

  return state.inFlight;
};

export const markApiUnavailable = (base: string) => {
  const normalized = normalizeBase(base);
  if (!normalized) return;
  if (isOptimisticBase(normalized)) return;
  const state = getState(normalized);
  state.ok = false;
  state.ts = Date.now();
};

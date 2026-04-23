import { getApiBase } from './apiBase';

type ClientEventMetaValue =
  | string
  | number
  | boolean
  | null
  | ClientEventMetaValue[]
  | { [key: string]: ClientEventMetaValue };

type ClientEventMeta = Record<string, ClientEventMetaValue>;

type ClientEventOptions =
  | string
  | {
      detail?: string | null;
      meta?: ClientEventMeta | null;
      dedupeKey?: string | null;
      dedupeMs?: number;
    };

const sent = new Map<string, number>();
const MAX_META_DEPTH = 4;
const MAX_META_KEYS = 20;

const normalizeMetaValue = (value: unknown, depth = 0): ClientEventMetaValue => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Number(value.toFixed(3)) : null;
  }
  if (depth >= MAX_META_DEPTH) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_META_KEYS).map((item) => normalizeMetaValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_META_KEYS);
    return Object.fromEntries(
      entries.map(([key, item]) => [key, normalizeMetaValue(item, depth + 1)])
    );
  }
  return String(value);
};

const normalizeMeta = (meta: ClientEventMeta | null | undefined) => {
  if (!meta) return null;
  return Object.fromEntries(
    Object.entries(meta)
      .slice(0, MAX_META_KEYS)
      .map(([key, value]) => [key, normalizeMetaValue(value)])
  );
};

const shouldSend = (dedupeKey: string | null | undefined, dedupeMs?: number) => {
  if (!dedupeKey) return true;
  const now = Date.now();
  const previous = sent.get(dedupeKey);
  if (previous !== undefined) {
    if (dedupeMs === undefined) {
      return false;
    }
    if (now - previous < dedupeMs) {
      return false;
    }
  }
  sent.set(dedupeKey, now);
  return true;
};

export const reportClientEvent = (name: string, options: ClientEventOptions = {}) => {
  if (typeof window === 'undefined') return;

  const resolved =
    typeof options === 'string'
      ? {
          detail: options,
          dedupeKey: name,
          dedupeMs: undefined,
          meta: null
        }
      : {
          detail: options.detail?.trim() || null,
          dedupeKey: options.dedupeKey ?? name,
          dedupeMs: options.dedupeMs,
          meta: normalizeMeta(options.meta)
        };

  if (!shouldSend(resolved.dedupeKey, resolved.dedupeMs)) return;

  const base = getApiBase();
  if (!base) return;

  const url = `${base.replace(/\/+$/, '')}/observability/client-event`;
  const payload = JSON.stringify({
    name,
    detail: resolved.detail,
    meta: resolved.meta
  });

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon(url, blob);
      return;
    }
  } catch {
    // ignore beacon failures
  }

  void fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: payload,
    keepalive: true
  }).catch(() => undefined);
};

import { getApiBase } from './apiBase';

const sent = new Set<string>();

export const reportClientEvent = (name: string, dedupeKey = name) => {
  if (typeof window === 'undefined') return;
  if (sent.has(dedupeKey)) return;
  sent.add(dedupeKey);

  const base = getApiBase();
  if (!base) return;

  const url = `${base.replace(/\/+$/, '')}/observability/client-event`;
  const payload = JSON.stringify({ name });

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

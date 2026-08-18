import type { StationLite } from '../types';
import { reportClientEvent } from './observability';

export type ProductAnalyticsEventName =
  | 'app_opened'
  | 'home_station_impression'
  // How many of the previewing tiles on the first shelf were actually showing a
  // track a few seconds in. ~40% of stations never emit a title, so without this
  // there is no way to tell «the shelf came alive» from «the shelf looks exactly
  // as it did before» — and the whole case for the line is that a real track is
  // a reason to tap.
  | 'home_now_playing_preview'
  | 'play_attempt'
  | 'play_success'
  // A play that was replaced by a newer one before it could finish — the Feed
  // does this on every swipe. Without it, `play_attempt` has no honest
  // denominator.
  | 'play_superseded'
  | 'stream_failure'
  | 'skip'
  | 'like'
  | 'search_query'
  | 'queue_source'
  | 'queue_reorder'
  | 'queue_shuffle'
  | 'queue_enqueue'
  | 'queue_remove'
  | 'queue_clear_upcoming'
  | 'session_duration'
  | 'station_details_opened'
  | 'station_report_broken'
  | 'station_hidden';

export type ProductAnalyticsMetaValue =
  | string
  | number
  | boolean
  | null
  | ProductAnalyticsMetaValue[]
  | { [key: string]: ProductAnalyticsMetaValue };

const SESSION_KEY = 'radio:analytics-session:v1';

const createSessionId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export const getProductAnalyticsSessionId = () => {
  if (typeof window === 'undefined') return 'server';
  try {
    const current = window.sessionStorage.getItem(SESSION_KEY);
    if (current) return current;
    const next = createSessionId();
    window.sessionStorage.setItem(SESSION_KEY, next);
    return next;
  } catch {
    return 'session-unavailable';
  }
};

export const hashAnalyticsValue = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

export const stationAnalyticsMeta = (station: StationLite | null | undefined) => ({
  stationId: station?.stationuuid || null,
  country: station?.country || null,
  state: station?.state || null,
  tagCount: station?.tags?.split(',').filter((tag) => tag.trim()).length || 0
});

export const reportProductEvent = (
  name: ProductAnalyticsEventName,
  meta: Record<string, ProductAnalyticsMetaValue> = {},
  options: {
    dedupeKey?: string | null;
    dedupeMs?: number;
    detail?: string | null;
  } = {}
) => {
  reportClientEvent(name, {
    detail: options.detail ?? null,
    dedupeKey: options.dedupeKey ?? `${name}:${getProductAnalyticsSessionId()}`,
    dedupeMs: options.dedupeMs,
    meta: {
      sessionId: getProductAnalyticsSessionId(),
      ...meta
    }
  });
};

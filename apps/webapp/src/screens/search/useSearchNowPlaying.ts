import { useCallback, useEffect, useRef, useState } from 'react';
import type { NowPlayingSnapshot } from '../../domain/contracts';
import { getDeviceProfile } from '../../lib/deviceProfile';
import {
  isFreshNowPlayingTrack,
  observeStationNowPlaying,
  stationSnapshotKey
} from '../../lib/nowPlaying';
import { normalizeTrustedTrackTitle } from '../../lib/trackTrust';
import type { StationLite } from '../../types';

/**
 * Per-visible-row "now playing" for the Search results list.
 *
 * WHAT THIS IS NOT: it is not the desktop StationTable pattern. StationTable
 * observes with `{ passive: true }`, and passive suppresses ALL fetching — it
 * renders only what is already in memory or seeded from the 14-day localStorage
 * cache. Copying that call onto a fresh mobile search resolves ~nothing, and it
 * fails silently. To show real tracks the observation must be non-passive for a
 * BOUNDED subset, which is what the admission controller below exists to do.
 *
 * WHAT IT COSTS IF UNBOUNDED: 124 rows x ~5-8 origin probes drained through a
 * global concurrency of 2 is 10-15 minutes of outbound requests per user, and
 * a handful of concurrent users saturate the API's shared media concurrency and
 * start 503-ing each other on a box that has already OOM-restarted once.
 *
 * #86: this module imports nothing from RadioContext and cannot reach the
 * player. It is metadata-only, by construction.
 *
 * Architectural rule: the visible set NEVER enters React state. If the parent
 * held it, every scroll tick would re-render every mounted card. All controller
 * state is module-level and mutable; each row subscribes for its own key only.
 */

const SCROLL_SETTLE_MS = 400;
const SILENT_CACHE_KEY = 'radio:np-silent:v1';
const SILENT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SILENT_CACHE_LIMIT = 400;
// The API's own overload guard is a shared-concurrency limiter; when it starts
// refusing, hammering it is how a slow list becomes an outage.
const OVERLOAD_STREAK_LIMIT = 3;
const OVERLOAD_COOLDOWN_MS = 60_000;

type RowHandle = {
  key: string;
  station: StationLite;
  element: Element | null;
  /** Row-local setter: flips the row from cache-display to a real resolve. */
  grant: () => void;
};

type ControllerLimits = { budget: number; slots: number };

const limits = (): ControllerLimits => {
  const { lowPower } = getDeviceProfile();
  // Global metadata concurrency is 2; 3 keeps that pipe saturated with one
  // spare. More only queues staleness — rows you have already scrolled past.
  return lowPower ? { budget: 8, slots: 2 } : { budget: 24, slots: 3 };
};

const rows = new Map<string, RowHandle>();
const elementKeys = new Map<Element, string>();
const visibleKeys = new Set<string>();
/** Keys already granted a resolve slot this session — never probed twice. */
const attempted = new Set<string>();
const granted = new Set<string>();
let sharedObserver: IntersectionObserver | null = null;
let settleTimer: number | null = null;
let budgetUsed = 0;
let activeSlots = 0;
let sessionSignature = '';
let overloadStreak = 0;
let cooldownUntil = 0;
let scrollBound = false;

/* ------------------------------------------------------------------ *
 * Negative cache — a station that emitted nothing five minutes ago is
 * emitting nothing now. Persisted so the next session does not re-buy
 * the same 24 lottery tickets.
 * ------------------------------------------------------------------ */

type SilentCache = Record<string, number>;
let silentCache: SilentCache | null = null;

const readSilentCache = (): SilentCache => {
  if (silentCache) return silentCache;
  if (typeof window === 'undefined') {
    silentCache = {};
    return silentCache;
  }
  try {
    const raw = window.localStorage.getItem(SILENT_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    silentCache = parsed && typeof parsed === 'object' ? (parsed as SilentCache) : {};
  } catch {
    silentCache = {};
  }
  return silentCache;
};

const isKnownSilent = (key: string) => {
  const cache = readSilentCache();
  const at = cache[key];
  if (!at) return false;
  const age = Date.now() - at;
  // Negative ages come from a backward clock correction; treat as expired
  // rather than trusting them forever (same guard the track cache uses).
  if (age < 0 || age > SILENT_CACHE_TTL_MS) {
    delete cache[key];
    return false;
  }
  return true;
};

const markSilent = (key: string) => {
  if (typeof window === 'undefined') return;
  const cache = readSilentCache();
  cache[key] = Date.now();
  const entries = Object.entries(cache)
    .sort((left, right) => right[1] - left[1])
    .slice(0, SILENT_CACHE_LIMIT);
  silentCache = Object.fromEntries(entries);
  try {
    window.localStorage.setItem(SILENT_CACHE_KEY, JSON.stringify(silentCache));
  } catch {
    // ignore storage failures
  }
};

const clearSilent = (key: string) => {
  const cache = readSilentCache();
  if (!(key in cache)) return;
  delete cache[key];
  try {
    window.localStorage.setItem(SILENT_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // ignore storage failures
  }
};

/* ------------------------------------------------------------------ *
 * Admission
 * ------------------------------------------------------------------ */

const canAdmit = () => {
  if (typeof document !== 'undefined' && document.hidden) return false;
  if (Date.now() < cooldownUntil) return false;
  const { budget, slots } = limits();
  return budgetUsed < budget && activeSlots < slots;
};

const admit = () => {
  if (!canAdmit()) return;
  const { budget, slots } = limits();

  // Candidates: visible right now, never attempted, not known-silent.
  // Ranked by distance from viewport centre so the row under the user's eyes
  // resolves before the one clipping the fold.
  //
  // Note this is also why the global FIFO refresh queue is harmless here: keys
  // are enqueued only at the moment a slot frees, chosen from what is visible
  // AT THAT MOMENT. Rows the user has already scrolled past are never in it.
  const viewportCentre =
    typeof window !== 'undefined' ? window.innerHeight / 2 : 0;
  const candidates: Array<{ handle: RowHandle; distance: number }> = [];

  visibleKeys.forEach((key) => {
    if (attempted.has(key)) return;
    const handle = rows.get(key);
    if (!handle || !handle.element) return;
    if (isKnownSilent(key)) return;
    const rect = handle.element.getBoundingClientRect();
    candidates.push({
      handle,
      distance: Math.abs(rect.top + rect.height / 2 - viewportCentre)
    });
  });

  candidates.sort((left, right) => left.distance - right.distance);

  for (const candidate of candidates) {
    if (budgetUsed >= budget || activeSlots >= slots) break;
    const { key } = candidate.handle;
    attempted.add(key);
    granted.add(key);
    budgetUsed += 1;
    activeSlots += 1;
    candidate.handle.grant();
  }
};

const scheduleAdmit = () => {
  if (typeof window === 'undefined') return;
  if (settleTimer !== null) window.clearTimeout(settleTimer);
  // Settle delay: a flick through 40 rows must resolve nothing.
  settleTimer = window.setTimeout(() => {
    settleTimer = null;
    admit();
  }, SCROLL_SETTLE_MS);
};

const releaseSlot = (key: string) => {
  if (!granted.delete(key)) return;
  activeSlots = Math.max(0, activeSlots - 1);
  admit();
};

const noteOutcome = (key: string, snapshot: NowPlayingSnapshot) => {
  if (snapshot.failureKind === 'api-unavailable') {
    overloadStreak += 1;
    if (overloadStreak >= OVERLOAD_STREAK_LIMIT) {
      cooldownUntil = Date.now() + OVERLOAD_COOLDOWN_MS;
      overloadStreak = 0;
    }
    return;
  }
  overloadStreak = 0;
  if (snapshot.track) {
    clearSilent(key);
  } else if (snapshot.status === 'unavailable') {
    markSilent(key);
  }
};

const ensureObserver = () => {
  if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return null;
  if (sharedObserver) return sharedObserver;
  // ONE observer for the whole screen, not one per row: 124 elements on a
  // single observer. rootMargin is '0px' on purpose — StationTable's 320px is
  // right for an observer that only reads cache, and wrong for one that fetches.
  sharedObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const key = elementKeys.get(entry.target);
        if (!key) return;
        if (entry.isIntersecting) visibleKeys.add(key);
        else visibleKeys.delete(key);
      });
      scheduleAdmit();
    },
    { rootMargin: '0px', threshold: 0 }
  );
  return sharedObserver;
};

const bindScroll = () => {
  if (scrollBound || typeof window === 'undefined') return;
  scrollBound = true;
  window.addEventListener('scroll', scheduleAdmit, { passive: true });
  document.addEventListener('visibilitychange', scheduleAdmit);
};

/**
 * Parent-level session guard. Resets the per-search attempt budget when the
 * query/filter signature changes, so a new search buys a fresh set of probes
 * while scrolling within one search does not.
 */
export const useSearchNowPlayingSession = (signature: string) => {
  useEffect(() => {
    if (sessionSignature === signature) return;
    sessionSignature = signature;
    attempted.clear();
    budgetUsed = 0;
  }, [signature]);
};

type UseSearchNowPlayingResult = {
  /** Ref callback for the row element — registers it with the shared observer. */
  rowRef: (node: HTMLElement | null) => void;
  /** Display-ready, trust-filtered, freshness-gated track — or null. */
  track: string | null;
};

export const useSearchNowPlaying = (
  station: StationLite,
  enabled: boolean
): UseSearchNowPlayingResult => {
  const key = stationSnapshotKey(station);
  const [snapshot, setSnapshot] = useState<NowPlayingSnapshot | null>(null);
  const [resolving, setResolving] = useState(false);
  const nodeRef = useRef<HTMLElement | null>(null);
  const settledRef = useRef(false);

  const rowRef = useCallback(
    (node: HTMLElement | null) => {
      const observer = ensureObserver();
      const previous = nodeRef.current;
      if (previous && observer) {
        observer.unobserve(previous);
        elementKeys.delete(previous);
      }
      nodeRef.current = node;
      if (!node || !enabled) return;
      elementKeys.set(node, key);
      const handle = rows.get(key);
      if (handle) handle.element = node;
      observer?.observe(node);
    },
    [enabled, key]
  );

  // Register this row with the controller.
  useEffect(() => {
    if (!enabled) return;
    settledRef.current = false;
    const handle: RowHandle = {
      key,
      station,
      element: nodeRef.current,
      grant: () => setResolving(true)
    };
    rows.set(key, handle);
    bindScroll();
    return () => {
      if (rows.get(key) === handle) rows.delete(key);
      visibleKeys.delete(key);
      // Unmounting while holding a slot must hand it back, or a fast scroll
      // permanently starves the controller.
      releaseSlot(key);
      setResolving(false);
    };
  }, [enabled, key, station]);

  // Observe. `resolveOnce` for admitted rows, `passive` (cache display only)
  // for everyone else — a non-admitted row still shows a track the app already
  // knows, it just never spends a request to find one.
  useEffect(() => {
    if (!enabled) return;
    // observeStationNowPlaying emits the CURRENT snapshot synchronously on
    // subscribe. That echo is not a result, so slot accounting must not settle
    // on it — otherwise a row hands its slot back while its probe is still
    // running and the controller over-admits. Identity, not status, is the
    // reliable discriminator here: a stale cached track arrives as
    // status:'ready' and refreshStationSnapshot then never emits 'loading' for
    // it, so a status-based check would leak the slot until unmount instead.
    let sawInitialEmit = false;
    const settle = (next: NowPlayingSnapshot) => {
      settledRef.current = true;
      noteOutcome(key, next);
      releaseSlot(key);
    };
    return observeStationNowPlaying(
      station,
      (next) => {
        setSnapshot(next);
        if (!resolving || settledRef.current) return;
        if (!sawInitialEmit) {
          sawInitialEmit = true;
          // Already fresh → resolveOnce will not fetch at all, so this row is
          // done and its slot belongs to someone else immediately.
          if (isFreshNowPlayingTrack(next)) settle(next);
          return;
        }
        if (next.status === 'loading') return;
        settle(next);
      },
      resolving ? { resolveOnce: true } : { passive: true }
    );
  }, [enabled, key, resolving, station]);

  // Render contract. TWO mandatory filters, both anti-fabrication:
  //  1. freshness — applyStoredTrackFallback resurrects tracks up to 14 days
  //     old and stamps them 'ready'; presenting that as now-playing is a lie.
  //  2. trust — normalizeTrustedTrackTitle nulls station idents, bare domains
  //     and filler titles, which a large share of ICY-emitting stations send.
  // Anything that fails either filter renders NOTHING. No skeleton, no spinner,
  // no reserved height, no "—".
  const track =
    snapshot && isFreshNowPlayingTrack(snapshot)
      ? normalizeTrustedTrackTitle(snapshot.track, station)
      : null;

  return { rowRef, track };
};

/** Test-only reset so module-level controller state cannot leak between cases. */
export const __resetSearchNowPlayingForTests = () => {
  rows.clear();
  elementKeys.clear();
  visibleKeys.clear();
  attempted.clear();
  granted.clear();
  budgetUsed = 0;
  activeSlots = 0;
  sessionSignature = '';
  overloadStreak = 0;
  cooldownUntil = 0;
  silentCache = null;
};

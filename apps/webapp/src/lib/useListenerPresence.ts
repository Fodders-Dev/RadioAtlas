import { useEffect, useRef, useState } from 'react';
import { getApiBase } from './apiBase';
import {
  beatIntervalMs,
  createPresenceToken,
  isOptedOut,
  shouldReportListening
} from './listenerPresence';
import type { StationLite } from '../types';

/**
 * Reports "someone is listening to this station" while audio is playing, and returns the
 * station's live listener count as the server sees it.
 *
 * The count arrives on the WRITE — the beat response carries it — so a listening client
 * never needs a separate polling read.
 *
 * The hard part of this feature is not counting, it is STOPPING: a listener who is counted
 * but has gone away inflates the number, which is the one thing this must never do. Every
 * exit is covered here — pause, stop, station change, unmount, tab hidden, app closed —
 * with the server-side TTL as the backstop for the paths a browser never tells us about
 * (crash, force-quit, network death).
 */
export const useListenerPresence = (
  station: StationLite | null,
  isPlaying: boolean
): number | null => {
  const [listeners, setListeners] = useState<number | null>(null);
  const tokenRef = useRef<string | null>(null);
  const stationIdRef = useRef<string | null>(null);

  const stationId = station?.stationuuid ?? null;
  const active = shouldReportListening({
    hasStation: Boolean(stationId),
    isPlaying,
    optedIn: !isOptedOut()
  });

  useEffect(() => {
    if (!active || !stationId) {
      setListeners(null);
      return undefined;
    }

    // A token belongs to ONE station: rotate on change so nothing links two stations
    // together, and so the old station's count drops immediately rather than at TTL.
    if (stationIdRef.current !== stationId) {
      tokenRef.current = createPresenceToken();
      stationIdRef.current = stationId;
    }
    const token = tokenRef.current!;
    const base = getApiBase();
    let cancelled = false;
    let timer: number | undefined;

    const beat = async () => {
      try {
        const res = await fetch(`${base}/listening/beat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token, stationId })
        });
        if (!res.ok) {
          // 429/503 are back-pressure, not errors worth surfacing: stay silent and keep
          // beating on the normal cadence. The count simply stays unknown.
          if (!cancelled) setListeners(null);
          return;
        }
        const data = (await res.json()) as { listeners?: number };
        if (!cancelled && typeof data.listeners === 'number') setListeners(data.listeners);
      } catch {
        // Offline or API down. The UI shows nothing rather than a stale number.
        if (!cancelled) setListeners(null);
      }
    };

    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        if (cancelled) return;
        await beat();
        if (!cancelled) schedule();
      }, beatIntervalMs(document.visibilityState === 'hidden'));
    };

    void beat();
    schedule();

    // Backgrounding changes the cadence; it does NOT stop the count, because audio keeps
    // playing when the app is backgrounded — that is the whole point of a radio.
    const onVisibility = () => schedule();
    document.addEventListener('visibilitychange', onVisibility);

    /** Best-effort goodbye that survives the page going away. */
    const sayGoodbye = () => {
      const body = JSON.stringify({ token });
      const url = `${base}/listening/bye`;
      // sendBeacon is the only thing reliably delivered during unload.
      if (navigator.sendBeacon?.(url, new Blob([body], { type: 'application/json' }))) return;
      void fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true
      }).catch(() => {});
    };
    window.addEventListener('pagehide', sayGoodbye);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', sayGoodbye);
      sayGoodbye();
    };
  }, [active, stationId]);

  return active ? listeners : null;
};

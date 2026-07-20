import { useEffect, useState } from 'react';
import { getApiBase } from './apiBase';
import type { StationLite } from '../types';

/**
 * «Что слушают сейчас» — stations other RadioAtlas users are on right now.
 *
 * Backed by the presence store (apps/api/src/listeningPresence.ts). The server
 * already applies the privacy floor: it only lists a station once at least
 * MIN_PUBLIC_LISTENERS people are on it, so a small crowd can never point at one
 * identifiable person. This hook adds no floor of its own — it just refuses to
 * invent anything the server did not send.
 *
 * HONESTY: while the app is small this will legitimately be empty most of the
 * time. Empty means the block does not render at all — no placeholder rows, no
 * "пока тихо" filler that would read as a broken feature, and absolutely no
 * blending with popularity data to pad it out.
 */

const REFRESH_MS = 60_000;

export type LiveNowEntry = { station: StationLite; listeners: number };

export const useLiveNow = (catalog: StationLite[]): LiveNowEntry[] => {
  const [entries, setEntries] = useState<LiveNowEntry[]>([]);

  useEffect(() => {
    if (!catalog.length) return undefined;
    let cancelled = false;
    let timer: number | undefined;

    const load = async () => {
      try {
        const res = await fetch(`${getApiBase()}/listening/live?limit=12`);
        if (!res.ok) {
          if (!cancelled) setEntries([]);
          return;
        }
        const data = (await res.json()) as { stations?: { stationId: string; listeners: number }[] };
        if (cancelled) return;
        const byId = new Map(catalog.map((station) => [station.stationuuid, station]));
        // A station we cannot resolve is dropped rather than rendered as a
        // nameless row — the count is real but we have nothing to show for it.
        setEntries(
          (data.stations ?? [])
            .map((row) => {
              const station = byId.get(row.stationId);
              return station ? { station, listeners: row.listeners } : null;
            })
            .filter((row): row is LiveNowEntry => row !== null)
        );
      } catch {
        if (!cancelled) setEntries([]);
      }
    };

    void load();
    timer = window.setInterval(load, REFRESH_MS);

    // Nothing to show while the app is backgrounded, and a background tab
    // polling a live endpoint every minute is pure waste.
    const onVisibility = () => {
      window.clearInterval(timer);
      if (document.visibilityState === 'visible') {
        void load();
        timer = window.setInterval(load, REFRESH_MS);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [catalog]);

  return entries;
};

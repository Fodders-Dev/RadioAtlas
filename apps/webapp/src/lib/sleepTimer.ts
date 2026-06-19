import { useCallback, useEffect, useRef, useState } from 'react';

// Sleep timer: let the listener fall asleep to the radio and have it stop itself.
// The presets a user can pick (minutes).
export const SLEEP_TIMER_PRESETS_MIN = [15, 30, 45, 60] as const;

// Whole minutes only, positive, capped at 12h so a fat-fingered value can't park
// a timer for days.
export const normalizeSleepMinutes = (minutes: number): number | null => {
  if (!Number.isFinite(minutes)) return null;
  const rounded = Math.round(minutes);
  if (rounded <= 0) return null;
  return Math.min(rounded, 12 * 60);
};

export const sleepRemainingMs = (endsAt: number | null, now: number): number =>
  endsAt == null ? 0 : Math.max(0, endsAt - now);

// mm:ss for the countdown chip (e.g. 28:07). Hours fold into minutes (75:00).
export const formatSleepRemaining = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

export type SleepTimerControls = {
  active: boolean;
  minutes: number | null;
  remainingMs: number;
  start: (minutes: number) => void;
  cancel: () => void;
};

// Wall-clock timer (stores an absolute end time, not a ticking counter) so a
// background/throttled tab still elapses correctly. `onElapse` fires once when
// the time is up; the caller pauses playback there. A 1s interval drives the
// countdown only while a timer is active.
export const useSleepTimer = (onElapse: () => void): SleepTimerControls => {
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const onElapseRef = useRef(onElapse);

  useEffect(() => {
    onElapseRef.current = onElapse;
  }, [onElapse]);

  useEffect(() => {
    if (endsAt == null) {
      setRemainingMs(0);
      return undefined;
    }
    // One-shot per active timer: a backgrounded tab can run many missed interval
    // ticks in one batch before React re-renders and clears this effect, so guard
    // against firing onElapse (pausing) more than once.
    let fired = false;
    const tick = () => {
      const left = sleepRemainingMs(endsAt, Date.now());
      setRemainingMs(left);
      if (left <= 0 && !fired) {
        fired = true;
        setEndsAt(null);
        setMinutes(null);
        onElapseRef.current();
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [endsAt]);

  const start = useCallback((requested: number) => {
    const safe = normalizeSleepMinutes(requested);
    if (safe == null) return;
    setMinutes(safe);
    setEndsAt(Date.now() + safe * 60_000);
  }, []);

  const cancel = useCallback(() => {
    setEndsAt(null);
    setMinutes(null);
    setRemainingMs(0);
  }, []);

  return { active: endsAt != null, minutes, remainingMs, start, cancel };
};

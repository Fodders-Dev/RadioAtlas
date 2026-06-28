// Autoplay-on-landing settle logic for the Discovery Feed, extracted as a pure,
// DI-timer'd unit. A card "lands" when it's ≥60% visible (the screen decides
// that from IntersectionObserver) AND the scroll has settled. This debounces the
// landed index so a fast swipe through several cards triggers ONE play (the card
// you stopped on), never one play per card flicked past — which would thrash the
// player and fight the never-auto-switch spirit.

type TimerHandle = ReturnType<typeof setTimeout>;

type AutoplaySettlerDeps = {
  settleMs: number;
  onSettle: (index: number) => void;
  setTimer?: (callback: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
};

export type AutoplaySettler = {
  // Report the currently-landed card index (≥60% visible). Resets the settle
  // timer; only the index still landed after `settleMs` of quiet gets played.
  notify: (index: number) => void;
  // Mark `index` as already-played WITHOUT playing it, and drop any pending
  // settle. Used when the feed opens ON a card whose station is ALREADY current
  // (a station is playing/paused): the IntersectionObserver's initial fire for
  // that card must NOT auto-play it — opening «Лента» is not a swipe, so it must
  // never switch the persistent player (#86). The first play then comes from a
  // deliberate swipe to a DIFFERENT card.
  seedPlayed: (index: number) => void;
  // Forget the last-played index — the next landing always re-plays (used when
  // the feed re-opens so re-entering replays the focused card).
  reset: () => void;
  // Stop any pending timer (unmount / feed close).
  cancel: () => void;
};

const defaultSetTimer = (callback: () => void, ms: number) => setTimeout(callback, ms);
const defaultClearTimer = (handle: TimerHandle) => clearTimeout(handle);

export const createAutoplaySettler = ({
  settleMs,
  onSettle,
  setTimer = defaultSetTimer,
  clearTimer = defaultClearTimer
}: AutoplaySettlerDeps): AutoplaySettler => {
  let pending: number | null = null;
  let played: number | null = null;
  let handle: TimerHandle | null = null;

  const clear = () => {
    if (handle !== null) {
      clearTimer(handle);
      handle = null;
    }
  };

  return {
    notify: (index) => {
      // Already settled+playing this card and nothing else is scheduled → ignore
      // IntersectionObserver re-fires for the same card (no replay).
      if (index === played && pending === null) return;
      // Already waiting on this exact card → don't restart the timer needlessly.
      if (index === pending) return;
      pending = index;
      clear();
      handle = setTimer(() => {
        handle = null;
        const target = pending;
        pending = null;
        if (target !== null && target !== played) {
          played = target;
          onSettle(target);
        }
      }, settleMs);
    },
    seedPlayed: (index) => {
      clear();
      pending = null;
      played = index;
    },
    reset: () => {
      played = null;
    },
    cancel: () => {
      clear();
      pending = null;
    }
  };
};

// Decide where the feed opens and whether the landed card auto-plays on mount.
// #86: opening «Лента» must NOT switch the persistent player, because opening is
// not a swipe. So autoplay-on-open happens ONLY when nothing is currently loaded
// (open-to-discover). If a station is already current, the feed opens ON that
// station's card when it's in the feed (else card 0) with NO mount play — the
// first play then comes from a deliberate swipe to a DIFFERENT card.
export const resolveFeedEntry = (
  feed: ReadonlyArray<{ stationuuid: string }>,
  currentStationId: string | null | undefined
): { index: number; autoplayInitial: boolean } => {
  if (!currentStationId) return { index: 0, autoplayInitial: true };
  const index = feed.findIndex((station) => station.stationuuid === currentStationId);
  return { index: index >= 0 ? index : 0, autoplayInitial: false };
};
